"""Word timings for a transcript by forced alignment (torchaudio MMS_FA, CPU).

python separate/align.py AUDIO TRANSCRIPT_JSON OUT_JSON

Each transcript segment is aligned within its own window (±0.5 s), so a mistake stays local.
Words are romanised (uroman: Cyrillic, and diacritics in Latin scripts) and lower-cased to the
aligner alphabet (a–z and the apostrophe); a word with nothing left (a number, a symbol) gets
the timing of its neighbours. ROMANIZE=0 only strips, as before uroman.
"""

import json
import os
import re
import sys
import time

import torch
import torchaudio

MARGIN = 0.5
RATE = 16000


def load():
    bundle = torchaudio.pipelines.MMS_FA
    from uroman import Uroman

    return {
        "model": bundle.get_model(with_star=False).eval(),
        "tokenizer": bundle.get_tokenizer(),
        "aligner": bundle.get_aligner(),
        "uroman": Uroman(),
    }


def to_alphabet(models, word, romanize=True):
    if romanize:
        word = models["uroman"].romanize_string(word)
    return re.sub(r"[^a-z']", "", word.lower())


def align(models, waveform, segments, romanize=True):
    """`waveform`: mono, 16 kHz, shape (1, samples)."""
    result = []
    for segment in segments:
        raw = segment["text"].split()
        clean = [to_alphabet(models, w, romanize) for w in raw]
        keep = [i for i, w in enumerate(clean) if w]
        begin = max(0.0, segment["start"] - MARGIN)
        end = min(waveform.shape[1] / RATE, segment["end"] + MARGIN)
        clip = waveform[:, int(begin * RATE) : int(end * RATE)]
        timed = {}
        spans = []
        if keep:
            with torch.inference_mode():
                emission, _ = models["model"](clip)
            spans = models["aligner"](emission[0], models["tokenizer"]([clean[i] for i in keep]))
            ratio = clip.shape[1] / emission.shape[1] / RATE
        for i, word_spans in zip(keep, spans):
            score = sum(s.score * len(s) for s in word_spans) / sum(len(s) for s in word_spans)
            timed[i] = (
                begin + word_spans[0].start * ratio,
                begin + word_spans[-1].end * ratio,
                score,
            )
        words = []
        for i, w in enumerate(raw):
            if i in timed:
                s, e, score = timed[i]
            else:
                prev = words[-1]["end"] if words else begin
                s = e = prev
                score = 0.0
            words.append({"word": w, "start": round(s, 3), "end": round(e, 3), "score": round(score, 2)})
        result.append({"id": segment["id"], "speaker": segment["speaker"], "words": words})
    return result


def load_audio(path):
    waveform, sr = torchaudio.load(path)
    return torchaudio.functional.resample(waveform.mean(0, keepdim=True), sr, RATE)


if __name__ == "__main__":
    audio_path, transcript_path, out_path = sys.argv[1:4]
    romanize = os.environ.get("ROMANIZE", "1") != "0"
    started = time.time()
    models = load()
    waveform = load_audio(audio_path)
    loaded = time.time()
    segments = align(models, waveform, json.load(open(transcript_path))["segments"], romanize)
    seconds = {"load": round(loaded - started, 1), "align": round(time.time() - loaded, 1)}
    json.dump({"segments": segments, "seconds": seconds}, open(out_path, "w"), indent=1)
    print(json.dumps({"segments": len(segments), "romanize": romanize, **seconds}))
