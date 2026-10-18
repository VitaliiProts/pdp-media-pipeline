"""What one `audio-separate` pod needs: all three models in one process, then a whole job.

python separate/service_check.py AUDIO TRANSCRIPT_JSON [AUDIO TRANSCRIPT_JSON ...]

Loads Demucs, MMS_FA and the gender classifier, then for every clip separates the voice,
aligns the transcript on it and classifies speakers twice: from all pieces and from the three
longest per speaker. Prints resident memory after each step and the peak (VmHWM).
"""

import json
import sys
import time

import torch
import torchaudio
from demucs.apply import apply_model
from demucs.pretrained import get_model

import align
import gender


def memory():
    status = dict(line.split(":", 1) for line in open("/proc/self/status"))
    mib = lambda key: int(status[key].split()[0]) // 1024
    return {"rssMiB": mib("VmRSS"), "peakMiB": mib("VmHWM")}


def log(step, started, **extra):
    print(json.dumps({"step": step, "s": round(time.time() - started, 1), **memory(), **extra}), flush=True)


def separate(model, path):
    wav, sr = torchaudio.load(path)
    wav = torchaudio.functional.resample(wav, sr, model.samplerate)
    if wav.shape[0] == 1:
        wav = wav.repeat(2, 1)
    ref = wav.mean(0)
    wav = (wav - ref.mean()) / ref.std()
    with torch.inference_mode():
        sources = apply_model(model, wav[None], device="cpu", shifts=1, split=True, overlap=0.25, progress=False)[0]
    sources = sources * ref.std() + ref.mean()
    vocals = sources[model.sources.index("vocals")]
    background = sources.sum(0) - vocals
    return vocals, background, model.samplerate


log("start", time.time())
t = time.time()
demucs = get_model("htdemucs").eval()
log("load demucs", t)
t = time.time()
aligner = align.load()
log("load mms_fa + uroman", t)
t = time.time()
classifier = gender.load()
log("load gender", t)

args = sys.argv[1:]
for audio_path, transcript_path in zip(args[::2], args[1::2]):
    t = time.time()
    vocals, _, rate = separate(demucs, audio_path)
    log("separate", t, clip=audio_path, seconds=round(vocals.shape[1] / rate, 1))
    voice = torchaudio.functional.resample(vocals.mean(0, keepdim=True), rate, align.RATE)

    t = time.time()
    segments = align.align(aligner, voice, json.load(open(transcript_path))["segments"])
    log("align", t, words=sum(len(s["words"]) for s in segments))

    for max_pieces in (None, 3):
        t = time.time()
        result = gender.classify(classifier, voice, segments, max_pieces)
        speakers = {k: f"{v['gender']} {v['male']}" for k, v in result["speakers"].items()}
        log(f"gender max_pieces={max_pieces}", t, pieces=result["pieces"], speakers=speakers)
