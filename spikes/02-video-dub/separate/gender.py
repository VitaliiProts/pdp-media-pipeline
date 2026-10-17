"""Gender of every speaker from the separated voice, for picking dub voices.

python separate/gender.py VOICE_AUDIO WORDS_JSON OUT_JSON

Every turn (first word to last word, from align.py) is cut into pieces of up to 5 s, the
size the classifier was trained on; per speaker the probabilities are averaged with the
length of each piece as its weight. MAX_PIECES=3 classifies only the longest pieces of each
speaker.
"""

import json
import os
import sys
import time

import torch

from align import load_audio

MODEL = "alefiury/wav2vec2-large-xlsr-53-gender-recognition-librispeech"
RATE = 16000
PIECE = float(os.environ.get("PIECE", "5"))
MIN_PIECE = 0.5


def load():
    from transformers import AutoFeatureExtractor, AutoModelForAudioClassification

    return {
        "extractor": AutoFeatureExtractor.from_pretrained(MODEL),
        "model": AutoModelForAudioClassification.from_pretrained(MODEL).eval(),
    }


def pieces_of(segments):
    """(speaker, turn id, start, end) for every piece of every turn."""
    pieces = []
    for segment in segments:
        words = segment["words"]
        start, end = words[0]["start"], words[-1]["end"]
        at = start
        while True:
            piece_end = min(end, at + PIECE)
            if piece_end - at >= MIN_PIECE or at == start:
                pieces.append((segment["speaker"], segment["id"], at, piece_end))
            at = piece_end
            if at >= end:
                break
    return pieces


def classify(models, waveform, segments, max_pieces=None):
    """`waveform`: mono, 16 kHz, shape (1, samples)."""
    pieces = pieces_of(segments)
    if max_pieces:
        by_speaker = {}
        for piece in sorted(pieces, key=lambda p: p[3] - p[2], reverse=True):
            by_speaker.setdefault(piece[0], [])
            if len(by_speaker[piece[0]]) < max_pieces:
                by_speaker[piece[0]].append(piece)
        pieces = [p for chosen in by_speaker.values() for p in chosen]

    totals, turns = {}, {}
    for speaker, turn, start, end in pieces:
        clip = waveform[0, int(start * RATE) : int(end * RATE)].numpy()
        inputs = models["extractor"](clip, sampling_rate=RATE, return_tensors="pt")
        with torch.inference_mode():
            male = float(torch.softmax(models["model"](**inputs).logits, -1)[0][1])
        for bucket, key in ((totals, speaker), (turns, (speaker, turn))):
            total = bucket.setdefault(key, [0.0, 0.0])
            total[0] += male * (end - start)
            total[1] += end - start

    speakers = {
        speaker: {"male": round(m / s, 3), "gender": "male" if m / s >= 0.5 else "female", "seconds": round(s, 1)}
        for speaker, (m, s) in totals.items()
    }
    return {
        "speakers": speakers,
        "turns": [{"id": t, "speaker": sp, "male": round(m / s, 3)} for (sp, t), (m, s) in turns.items()],
        "pieces": len(pieces),
    }


if __name__ == "__main__":
    audio_path, words_path, out_path = sys.argv[1:4]
    max_pieces = int(os.environ.get("MAX_PIECES", "0")) or None
    started = time.time()
    models = load()
    waveform = load_audio(audio_path)
    loaded = time.time()
    result = classify(models, waveform, json.load(open(words_path))["segments"], max_pieces)
    seconds = {"load": round(loaded - started, 1), "classify": round(time.time() - loaded, 1)}
    json.dump({"model": MODEL, **result, "seconds": seconds}, open(out_path, "w"), indent=1)
    print(json.dumps({"speakers": result["speakers"], "pieces": result["pieces"], **seconds}))
