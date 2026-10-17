"""Word timings for a transcript by forced alignment (torchaudio MMS_FA, CPU).

python separate/align.py AUDIO TRANSCRIPT_JSON OUT_JSON

Each transcript segment is aligned within its own window (±0.5 s), so a mistake stays local.
Words are lower-cased to the aligner alphabet (a–z and the apostrophe); a word with nothing
left (a number, a symbol) gets the timing of its neighbours.
"""

import json
import re
import sys
import time

import torch
import torchaudio

MARGIN = 0.5

audio_path, transcript_path, out_path = sys.argv[1:4]
started = time.time()

bundle = torchaudio.pipelines.MMS_FA
model = bundle.get_model(with_star=False).eval()
tokenizer = bundle.get_tokenizer()
aligner = bundle.get_aligner()
rate = bundle.sample_rate

waveform, sr = torchaudio.load(audio_path)
waveform = torchaudio.functional.resample(waveform.mean(0, keepdim=True), sr, rate)
loaded = time.time()

segments = json.load(open(transcript_path))["segments"]
result = []
for segment in segments:
    raw = segment["text"].split()
    clean = [re.sub(r"[^a-z']", "", w.lower()) for w in raw]
    keep = [i for i, w in enumerate(clean) if w]
    begin = max(0.0, segment["start"] - MARGIN)
    end = min(waveform.shape[1] / rate, segment["end"] + MARGIN)
    clip = waveform[:, int(begin * rate) : int(end * rate)]
    with torch.inference_mode():
        emission, _ = model(clip)
    spans = aligner(emission[0], tokenizer([clean[i] for i in keep]))
    ratio = clip.shape[1] / emission.shape[1] / rate
    timed = {}
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

json.dump(
    {"segments": result, "seconds": {"load": round(loaded - started, 1), "align": round(time.time() - loaded, 1)}},
    open(out_path, "w"),
    indent=1,
)
print(json.dumps({"segments": len(result), "load_s": round(loaded - started, 1), "align_s": round(time.time() - loaded, 1)}))
