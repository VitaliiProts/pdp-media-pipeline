import numpy as np

from audio_separate.analysis import (
    Piece,
    longest_per_speaker,
    pieces_of,
    speakers_of,
    speech_seconds,
    unrecognized,
    voice_intervals,
)

RATE = 16_000


def segment(speaker, start, end, score=1.0, sid="1"):
    return {
        "id": sid,
        "speaker": speaker,
        "words": [
            {"word": "a", "start": start, "end": (start + end) / 2, "score": score},
            {"word": "b", "start": (start + end) / 2, "end": end, "score": score},
        ],
    }


def tone(spans, seconds, rate=RATE):
    """Silence with a 200 Hz tone in each (start, end) span."""
    samples = np.zeros(int(seconds * rate), dtype=np.float32)
    for start, end in spans:
        t = np.arange(int(start * rate), int(end * rate))
        samples[t] = 0.3 * np.sin(2 * np.pi * 200 * t / rate)
    return samples


def test_turns_are_cut_into_pieces_of_up_to_five_seconds_without_short_tails():
    pieces = pieces_of([segment("A", 1.0, 12.2), segment("B", 20.0, 20.3)])
    assert [(p.speaker, p.start, p.end) for p in pieces] == [
        ("A", 1.0, 6.0),
        ("A", 6.0, 11.0),
        # 1.2 s tail is long enough to keep.
        ("A", 11.0, 12.2),
        # A short turn is kept whole.
        ("B", 20.0, 20.3),
    ]
    assert pieces_of([segment("A", 0.0, 5.3)])[-1].end == 5.0


def test_turns_without_words_have_no_pieces():
    assert pieces_of([{"id": "1", "speaker": "A", "words": []}]) == []


def test_only_the_longest_pieces_of_each_speaker_are_classified():
    pieces = [Piece("A", 0, s) for s in (1, 5, 2, 4)] + [Piece("B", 0, 3)]
    chosen = longest_per_speaker(pieces, 3)
    assert sorted((p.speaker, p.end) for p in chosen) == [("A", 2), ("A", 4), ("A", 5), ("B", 3)]


def test_speakers_average_by_piece_length_and_report_all_their_speech():
    scored = [(Piece("A", 0, 4), 0.9), (Piece("A", 4, 5), 0.1), (Piece("B", 0, 2), 0.2)]
    seconds = speech_seconds([segment("A", 0, 5), segment("A", 10, 13), segment("B", 0, 2)])
    assert speakers_of(scored, seconds) == [
        {"id": "A", "gender": "male", "maleProbability": 0.74, "seconds": 8.0},
        {"id": "B", "gender": "female", "maleProbability": 0.2, "seconds": 2.0},
    ]


def test_voice_is_found_by_energy_and_short_gaps_are_bridged():
    samples = tone([(1.0, 2.0), (2.1, 3.0), (5.0, 5.2)], 6.0)
    assert voice_intervals(samples, RATE) == [(1.0, 3.0), (5.0, 5.2)]


def test_silence_has_no_voice():
    assert voice_intervals(np.zeros(RATE, dtype=np.float32), RATE) == []


def test_voice_without_any_aligned_word_is_unrecognized():
    samples = tone([(1.0, 3.0), (4.0, 5.0), (6.0, 6.3)], 7.0)
    aligned = [segment("A", 1.2, 2.8), segment("B", 4.2, 4.6, score=0.0, sid="2")]
    # 1–3 s has words; 4–5 s only words the aligner could not place; 6–6.3 s is too short.
    assert unrecognized(samples, RATE, aligned) == [{"start": 4.0, "end": 5.0}]
