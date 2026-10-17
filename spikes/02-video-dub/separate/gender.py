"""Gender of every speaker from the separated voice, for picking dub voices.

python separate/gender.py VOICE_AUDIO WORDS_JSON OUT_JSON

Every turn (first word to last word, from align.py) is cut into pieces of up to 5 s, the
size the classifier was trained on; per speaker the probabilities are averaged with the
length of each piece as its weight.
"""

import json
import sys
import time

import torch
import torchaudio
from transformers import AutoFeatureExtractor, AutoModelForAudioClassification

MODEL = "alefiury/wav2vec2-large-xlsr-53-gender-recognition-librispeech"
LABELS = {0: "female", 1: "male"}
RATE = 16000
PIECE = 5.0
MIN_PIECE = 0.5

audio_path, words_path, out_path = sys.argv[1:4]
started = time.time()
extractor = AutoFeatureExtractor.from_pretrained(MODEL)
model = AutoModelForAudioClassification.from_pretrained(MODEL).eval()
waveform, sr = torchaudio.load(audio_path)
waveform = torchaudio.functional.resample(waveform.mean(0), sr, RATE)
loaded = time.time()

turns = []
totals = {}
for segment in json.load(open(words_path))["segments"]:
    words = segment["words"]
    start, end = words[0]["start"], words[-1]["end"]
    male, seconds = 0.0, 0.0
    at = start
    while end - at >= MIN_PIECE or at == start:
        piece_end = min(end, at + PIECE)
        clip = waveform[int(at * RATE) : int(piece_end * RATE)].numpy()
        inputs = extractor(clip, sampling_rate=RATE, return_tensors="pt")
        with torch.inference_mode():
            p = torch.softmax(model(**inputs).logits, -1)[0]
        male += float(p[1]) * (piece_end - at)
        seconds += piece_end - at
        at = piece_end
        if at >= end:
            break
    turns.append({"id": segment["id"], "speaker": segment["speaker"], "male": round(male / seconds, 3)})
    total = totals.setdefault(segment["speaker"], [0.0, 0.0])
    total[0] += male
    total[1] += seconds

speakers = {
    speaker: {
        "male": round(m / s, 3),
        "gender": "male" if m / s >= 0.5 else "female",
        "seconds": round(s, 1),
    }
    for speaker, (m, s) in totals.items()
}
json.dump(
    {
        "model": MODEL,
        "speakers": speakers,
        "turns": turns,
        "seconds": {"load": round(loaded - started, 1), "classify": round(time.time() - loaded, 1)},
    },
    open(out_path, "w"),
    indent=1,
)
print(json.dumps({"speakers": speakers, "load_s": round(loaded - started, 1), "classify_s": round(time.time() - loaded, 1)}))
