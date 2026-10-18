"""What /v1/analyze computes around the models: pieces for the gender classifier, the verdict
per speaker and voice the recogniser missed. Plain numpy, so it is tested without the models."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

PIECE_SECONDS = 5.0
"""The length the classifier was trained on."""
MIN_PIECE_SECONDS = 0.5
MAX_PIECES_PER_SPEAKER = 3
"""Same verdict as all pieces on the spike clips, 6 s instead of 8.5 s a minute (ADR-016)."""

FRAME_SECONDS = 0.02
VOICE_BELOW_PEAK_DB = 30.0
"""A frame is voice when it is at most this much quieter than the loudest frame."""
VOICE_GAP_SECONDS = 0.15
"""Shorter silences join two stretches of voice into one."""
MIN_UNRECOGNIZED_SECONDS = 0.5


@dataclass(frozen=True)
class Piece:
    speaker: str
    start: float
    end: float

    @property
    def seconds(self) -> float:
        return self.end - self.start


def turn_span(segment: dict) -> tuple[float, float] | None:
    """First word to last word of an aligned segment; None without words."""
    words = segment["words"]
    if not words:
        return None
    return words[0]["start"], words[-1]["end"]


def pieces_of(segments: list[dict]) -> list[Piece]:
    """Every turn cut into pieces of up to PIECE_SECONDS; a short tail is dropped, a short turn
    is kept whole."""
    pieces = []
    for segment in segments:
        span = turn_span(segment)
        if span is None:
            continue
        start, end = span
        at = start
        while True:
            piece_end = min(end, at + PIECE_SECONDS)
            if piece_end - at >= MIN_PIECE_SECONDS or at == start:
                pieces.append(Piece(segment["speaker"], at, piece_end))
            at = piece_end
            if at >= end:
                break
    return [p for p in pieces if p.seconds > 0]


def longest_per_speaker(pieces: list[Piece], limit: int = MAX_PIECES_PER_SPEAKER) -> list[Piece]:
    chosen: dict[str, list[Piece]] = {}
    for piece in sorted(pieces, key=lambda p: p.seconds, reverse=True):
        mine = chosen.setdefault(piece.speaker, [])
        if len(mine) < limit:
            mine.append(piece)
    return [p for mine in chosen.values() for p in mine]


def speech_seconds(segments: list[dict]) -> dict[str, float]:
    """Per speaker, first to last word of every turn."""
    seconds: dict[str, float] = {}
    for segment in segments:
        span = turn_span(segment)
        if span is not None:
            seconds[segment["speaker"]] = seconds.get(segment["speaker"], 0.0) + span[1] - span[0]
    return seconds


def speakers_of(scored: list[tuple[Piece, float]], seconds: dict[str, float]) -> list[dict]:
    """Male probability per speaker, averaged over pieces with their length as the weight.
    A speaker without a single piece is left out: the worker treats it as unknown."""
    totals: dict[str, list[float]] = {}
    for piece, male in scored:
        total = totals.setdefault(piece.speaker, [0.0, 0.0])
        total[0] += male * piece.seconds
        total[1] += piece.seconds
    speakers = []
    for speaker, (weighted, length) in totals.items():
        male = weighted / length
        speakers.append(
            {
                "id": speaker,
                "gender": "male" if male >= 0.5 else "female",
                "maleProbability": round(min(1.0, max(0.0, male)), 3),
                "seconds": round(seconds.get(speaker, length), 2),
            }
        )
    return speakers


def voice_intervals(samples: np.ndarray, rate: int) -> list[tuple[float, float]]:
    """Stretches of voice in a separated vocal track, by frame energy against the loudest frame."""
    frame = max(1, int(FRAME_SECONDS * rate))
    count = len(samples) // frame
    if count == 0:
        return []
    frames = samples[: count * frame].astype(np.float64).reshape(count, frame)
    rms = np.sqrt(np.mean(frames**2, axis=1))
    peak = rms.max()
    if peak <= 1e-6:
        return []
    voiced = rms >= peak * 10 ** (-VOICE_BELOW_PEAK_DB / 20)

    intervals: list[list[float]] = []
    for i in np.flatnonzero(voiced):
        start, end = i * FRAME_SECONDS, (i + 1) * FRAME_SECONDS
        if intervals and start - intervals[-1][1] < VOICE_GAP_SECONDS:
            intervals[-1][1] = end
        else:
            intervals.append([start, end])
    return [(round(s, 3), round(e, 3)) for s, e in intervals]


def unrecognized(samples: np.ndarray, rate: int, segments: list[dict]) -> list[dict[str, float]]:
    """Voice of at least MIN_UNRECOGNIZED_SECONDS with no aligned word in it: a line the
    recogniser did not hear. Shown in the transcript, never dubbed."""
    words = [
        (w["start"], w["end"])
        for s in segments
        for w in s["words"]
        if w["score"] > 0 and w["end"] > w["start"]
    ]
    missed = []
    for start, end in voice_intervals(samples, rate):
        if end - start < MIN_UNRECOGNIZED_SECONDS:
            continue
        if any(ws < end and we > start for ws, we in words):
            continue
        missed.append({"start": start, "end": end})
    return missed
