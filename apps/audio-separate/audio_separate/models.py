"""The three models of one pod, ported from spike 02 (separate/*.py): Demucs `htdemucs`,
torchaudio `MMS_FA` with `uroman`, and a wav2vec2 gender classifier. Weights come from
TORCH_HOME and HF_HOME inside the image; `python -m audio_separate.models` fills them at build."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Protocol

import numpy as np
import soundfile

RATE = 16_000
ALIGN_MARGIN_SECONDS = 0.5
"""Each segment is aligned in its own window, so a mistake stays local."""
GENDER_MODEL = "alefiury/wav2vec2-large-xlsr-53-gender-recognition-librispeech"


class Models(Protocol):
    def separate(self, source: Path, vocals: Path, background: Path) -> None: ...
    def load_voice(self, path: Path) -> np.ndarray: ...
    def align(self, voice: np.ndarray, segments: list[dict]) -> list[dict]: ...
    def male_probability(self, voice: np.ndarray, start: float, end: float) -> float: ...


def write_flac(path: Path, samples: np.ndarray, rate: int) -> None:
    """`samples`: (channels, frames) in -1..1."""
    soundfile.write(str(path), np.clip(samples, -1, 1).T, rate, format="FLAC", subtype="PCM_16")


class TorchModels:
    def __init__(self, threads: int) -> None:
        import torch
        import torchaudio
        from demucs.pretrained import get_model
        from transformers import AutoFeatureExtractor, AutoModelForAudioClassification
        from uroman import Uroman

        torch.set_num_threads(threads)
        self.torch = torch
        self.torchaudio = torchaudio
        self.demucs = get_model("htdemucs").eval()
        bundle = torchaudio.pipelines.MMS_FA
        self.aligner_model = bundle.get_model(with_star=False).eval()
        self.tokenizer = bundle.get_tokenizer()
        self.aligner = bundle.get_aligner()
        self.uroman = Uroman()
        self.extractor = AutoFeatureExtractor.from_pretrained(GENDER_MODEL)
        self.classifier = AutoModelForAudioClassification.from_pretrained(GENDER_MODEL).eval()

    def _read(self, path: Path, rate: int):
        data, source_rate = soundfile.read(str(path), dtype="float32", always_2d=True)
        wav = self.torch.from_numpy(data.T.copy())
        if source_rate != rate:
            wav = self.torchaudio.functional.resample(wav, source_rate, rate)
        return wav

    def separate(self, source: Path, vocals: Path, background: Path) -> None:
        from demucs.apply import apply_model

        rate = self.demucs.samplerate
        wav = self._read(source, rate)
        if wav.shape[0] == 1:
            wav = wav.repeat(2, 1)
        ref = wav.mean(0)
        mean, std = ref.mean(), ref.std().clamp_min(1e-8)
        with self.torch.inference_mode():
            sources = apply_model(
                self.demucs,
                ((wav - mean) / std)[None],
                device="cpu",
                shifts=1,
                split=True,
                overlap=0.25,
                progress=False,
            )[0]
        sources = sources * std + mean
        voice = sources[self.demucs.sources.index("vocals")]
        write_flac(vocals, voice.numpy(), rate)
        write_flac(background, (sources.sum(0) - voice).numpy(), rate)

    def load_voice(self, path: Path) -> np.ndarray:
        return self._read(path, RATE).mean(0).numpy()

    def _alphabet(self, word: str) -> str:
        """The aligner knows a–z and the apostrophe: every word is romanised (Cyrillic, and
        diacritics in Latin scripts) and lower-cased."""
        return re.sub(r"[^a-z']", "", self.uroman.romanize_string(word).lower())

    def align(self, voice: np.ndarray, segments: list[dict]) -> list[dict]:
        waveform = self.torch.from_numpy(voice)[None]
        duration = waveform.shape[1] / RATE
        result = []
        for segment in segments:
            raw = segment["text"].split()
            clean = [self._alphabet(w) for w in raw]
            keep = [i for i, w in enumerate(clean) if w]
            begin = max(0.0, segment["start"] - ALIGN_MARGIN_SECONDS)
            end = min(duration, segment["end"] + ALIGN_MARGIN_SECONDS)
            clip = waveform[:, int(begin * RATE) : int(end * RATE)]
            timed = {}
            if keep and clip.shape[1] > RATE // 10:
                with self.torch.inference_mode():
                    emission, _ = self.aligner_model(clip)
                spans = self.aligner(emission[0], self.tokenizer([clean[i] for i in keep]))
                ratio = clip.shape[1] / emission.shape[1] / RATE
                for i, word_spans in zip(keep, spans, strict=True):
                    frames = sum(len(s) for s in word_spans)
                    score = sum(s.score * len(s) for s in word_spans) / frames
                    timed[i] = (
                        begin + word_spans[0].start * ratio,
                        begin + word_spans[-1].end * ratio,
                        score,
                    )
            words = []
            for i, word in enumerate(raw):
                if i in timed:
                    start, stop, score = timed[i]
                else:
                    # A number or a symbol: nothing to align, the time of its neighbour.
                    start = stop = words[-1]["end"] if words else begin
                    score = 0.0
                words.append(
                    {
                        "word": word,
                        "start": round(start, 3),
                        "end": round(stop, 3),
                        "score": round(float(score), 2),
                    }
                )
            result.append({"id": segment["id"], "speaker": segment["speaker"], "words": words})
        return result

    def male_probability(self, voice: np.ndarray, start: float, end: float) -> float:
        clip = voice[int(start * RATE) : int(end * RATE)]
        inputs = self.extractor(clip, sampling_rate=RATE, return_tensors="pt")
        with self.torch.inference_mode():
            logits = self.classifier(**inputs).logits
        return float(self.torch.softmax(logits, -1)[0][1])


if __name__ == "__main__":
    # Downloads every weight into TORCH_HOME and HF_HOME, for the image build.
    TorchModels(threads=1)
    print("models ready")
