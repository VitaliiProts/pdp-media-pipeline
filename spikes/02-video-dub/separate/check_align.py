"""How well the aligner times words of a dub language, on a dub whose phrase positions we know.

python separate/check_align.py DUB_DIR LANG

DUB_DIR is an output of dub.mjs: `voice.wav` holds every synthesised phrase at `place` for
`actual` seconds (silence trimmed), `report.json` has the text. The phrases of one turn become
one segment 0.3 s wider on each side, like a diarized transcript; after alignment the first and
last word of every phrase are compared with where the phrase really is. Runs with and without
romanisation.
"""

import json
import statistics
import sys

from align import align, load, load_audio

WIDEN = 0.3

dub_dir, lang = sys.argv[1:3]
placed = json.load(open(f"{dub_dir}/report.json"))["placed"]

turns = {}
for p in placed:
    turns.setdefault(p["turn"], []).append(p)
segments = [
    {
        "id": turn,
        "speaker": phrases[0]["speaker"],
        "start": phrases[0]["place"] - WIDEN,
        "end": phrases[-1]["place"] + phrases[-1]["actual"] + WIDEN,
        "text": " ".join(p["translated"] for p in phrases),
    }
    for turn, phrases in turns.items()
]

models = load()
waveform = load_audio(f"{dub_dir}/voice.wav")


def score(romanize):
    aligned = align(models, waveform, segments, romanize)
    starts, ends, unaligned, words_total = [], [], 0, 0
    for segment, (turn, phrases) in zip(aligned, turns.items()):
        words = segment["words"]
        at = 0
        for p in phrases:
            n = len(p["translated"].split())
            mine = [w for w in words[at : at + n] if w["score"] > 0]
            unaligned += n - len(mine)
            words_total += n
            at += n
            if not mine:
                continue
            starts.append(abs(mine[0]["start"] - p["place"]))
            ends.append(abs(mine[-1]["end"] - (p["place"] + p["actual"])))
            if romanize and max(starts[-1], ends[-1]) > 0.3:
                print(f"  {p['id']}: start {starts[-1]:.2f} end {ends[-1]:.2f} {p['translated']!r}")
                print("    " + " ".join(f"{w['word']}[{w['start']:.2f}-{w['end']:.2f} {w['score']}]" for w in mine))
    errors = starts + ends
    return {
        "lang": lang,
        "romanize": romanize,
        "phrases": len(starts),
        "startMean": round(statistics.mean(starts), 3),
        "startMax": round(max(starts), 3),
        "endMean": round(statistics.mean(ends), 3),
        "endMax": round(max(ends), 3),
        "within0.1s": f"{sum(e <= 0.1 for e in errors)}/{len(errors)}",
        "unalignedWords": f"{unaligned}/{words_total}",
    }


for romanize in (False, True):
    print(json.dumps(score(romanize), ensure_ascii=False))
