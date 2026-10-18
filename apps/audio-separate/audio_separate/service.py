"""The two operations over S3 keys. Both are idempotent: an output key that already exists is
returned without computing, so a retried dub job does not separate twice."""

from __future__ import annotations

import tempfile
from pathlib import Path

from opentelemetry import trace

from . import analysis
from .models import RATE, Models
from .storage import Storage

tracer = trace.get_tracer("audio-separate")


class Service:
    def __init__(self, storage: Storage, models: Models, work_dir: str | None = None) -> None:
        self.storage = storage
        self.models = models
        self.work_dir = work_dir
        if work_dir:
            Path(work_dir).mkdir(parents=True, exist_ok=True)

    def separate(self, source: str, vocals: str, background: str) -> dict:
        if self.storage.exists(vocals) and self.storage.exists(background):
            return {"vocals": vocals, "background": background}
        with tempfile.TemporaryDirectory(dir=self.work_dir) as tmp:
            dir = Path(tmp)
            with tracer.start_as_current_span("s3 download"):
                self.storage.download(source, dir / "audio")
            with tracer.start_as_current_span("demucs separate"):
                self.models.separate(dir / "audio", dir / "vocals.flac", dir / "background.flac")
            with tracer.start_as_current_span("s3 upload"):
                # The voice last: its key is what a retry checks first.
                self.storage.upload(background, dir / "background.flac", "audio/flac")
                self.storage.upload(vocals, dir / "vocals.flac", "audio/flac")
        return {"vocals": vocals, "background": background}

    def analyze(self, vocals: str, segments: list[dict], output: str) -> dict:
        if self.storage.exists(output):
            return self.storage.read_json(output)
        with tempfile.TemporaryDirectory(dir=self.work_dir) as tmp:
            path = Path(tmp) / "vocals"
            with tracer.start_as_current_span("s3 download"):
                self.storage.download(vocals, path)
            voice = self.models.load_voice(path)
        with tracer.start_as_current_span("mms_fa align") as span:
            aligned = self.models.align(voice, segments)
            span.set_attribute("dub.segments", len(segments))
        with tracer.start_as_current_span("gender classify") as span:
            pieces = analysis.longest_per_speaker(analysis.pieces_of(aligned))
            scored = [(p, self.models.male_probability(voice, p.start, p.end)) for p in pieces]
            span.set_attribute("dub.pieces", len(pieces))
        result = {
            "segments": aligned,
            "speakers": analysis.speakers_of(scored, analysis.speech_seconds(aligned)),
            "unrecognized": analysis.unrecognized(voice, RATE, aligned),
        }
        self.storage.write_json(output, result)
        return result
