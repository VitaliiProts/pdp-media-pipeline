from dataclasses import dataclass
from pathlib import Path

import boto3
import numpy as np
import pytest
from fastapi.testclient import TestClient
from moto import mock_aws

from audio_separate.app import AppState, create_app
from audio_separate.models import RATE, write_flac
from audio_separate.service import Service
from audio_separate.storage import S3Storage

BUCKET = "media"


class FakeModels:
    """A tone where the transcript says someone speaks, plus one line nobody transcribed."""

    def __init__(self) -> None:
        self.calls: list[str] = []

    def separate(self, source: Path, vocals: Path, background: Path) -> None:
        self.calls.append("separate")
        silence = np.zeros((2, RATE), dtype=np.float32)
        write_flac(vocals, silence, RATE)
        write_flac(background, silence, RATE)

    def load_voice(self, path: Path) -> np.ndarray:
        self.calls.append("load_voice")
        samples = np.zeros(10 * RATE, dtype=np.float32)
        for start, end in ((1.0, 3.0), (7.0, 8.0)):
            t = np.arange(int(start * RATE), int(end * RATE))
            samples[t] = 0.3 * np.sin(2 * np.pi * 200 * t / RATE)
        return samples

    def align(self, voice: np.ndarray, segments: list[dict]) -> list[dict]:
        self.calls.append("align")
        out = []
        for s in segments:
            words = s["text"].split()
            share = (s["end"] - s["start"]) / len(words)
            out.append(
                {
                    "id": s["id"],
                    "speaker": s["speaker"],
                    "words": [
                        {
                            "word": w,
                            "start": round(s["start"] + i * share, 3),
                            "end": round(s["start"] + (i + 1) * share, 3),
                            "score": 0.9,
                        }
                        for i, w in enumerate(words)
                    ],
                }
            )
        return out

    def male_probability(self, voice: np.ndarray, start: float, end: float) -> float:
        return 0.9 if start < 2 else 0.2


@dataclass
class Setup:
    client: TestClient
    s3: object
    models: FakeModels
    state: AppState

    def put(self, key: str, body: bytes = b"audio") -> None:
        self.s3.put_object(Bucket=BUCKET, Key=key, Body=body)

    def keys(self) -> list[str]:
        listing = self.s3.list_objects_v2(Bucket=BUCKET).get("Contents", [])
        return sorted(o["Key"] for o in listing)


@pytest.fixture
def setup():
    with mock_aws():
        s3 = boto3.client("s3", region_name="us-east-1")
        s3.create_bucket(Bucket=BUCKET)
        storage = S3Storage(
            endpoint=None,
            region="us-east-1",
            bucket=BUCKET,
            access_key="test",
            secret_key="test",
            force_path_style=True,
        )
        models = FakeModels()
        state = AppState(service=Service(storage, models))
        yield Setup(TestClient(create_app(state)), s3, models, state)
