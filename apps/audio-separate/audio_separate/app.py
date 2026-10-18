"""HTTP API (ADR-016, the zod schemas in apps/video-worker/src/dub/audio-separate/). One request
at a time per pod: separation takes the CPU and memory of the pod, so a busy pod answers 503
with Retry-After and the client asks again, maybe another pod."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .service import Service
from .storage import MissingObject

log = logging.getLogger("audio-separate")

BUSY_RETRY_AFTER_SECONDS = 5


class SeparateRequest(BaseModel):
    input: str = Field(min_length=1)
    vocals: str = Field(min_length=1)
    background: str = Field(min_length=1)


class Segment(BaseModel):
    id: str
    speaker: str
    start: float
    end: float
    text: str


class AnalyzeRequest(BaseModel):
    vocals: str = Field(min_length=1)
    segments: list[Segment]
    output: str = Field(min_length=1)


@dataclass
class AppState:
    """`service` is None until the models are loaded."""

    service: Service | None = None
    busy: bool = field(default=False)


def unavailable(reason: str) -> JSONResponse:
    return JSONResponse(
        {"error": reason},
        status_code=503,
        headers={"Retry-After": str(BUSY_RETRY_AFTER_SECONDS)},
    )


def create_app(state: AppState) -> FastAPI:
    app = FastAPI(title="audio-separate", docs_url=None, redoc_url=None)

    async def exclusive(fn, *args):
        # No await between the check and the set: one event loop, so no two requests pass.
        if state.service is None:
            return unavailable("models are loading")
        if state.busy:
            return unavailable("busy")
        state.busy = True
        try:
            return await run_in_threadpool(fn, *args)
        finally:
            state.busy = False

    @app.exception_handler(MissingObject)
    async def missing(_: Request, err: MissingObject) -> JSONResponse:
        return JSONResponse({"error": f"{err} not found"}, status_code=404)

    @app.get("/health/live")
    async def live() -> dict:
        return {"status": "ok"}

    @app.get("/health/ready")
    async def ready() -> JSONResponse:
        if state.service is None:
            return JSONResponse({"status": "loading"}, status_code=503)
        return JSONResponse({"status": "ok", "busy": state.busy})

    @app.post("/v1/separate")
    async def separate(body: SeparateRequest):
        return await exclusive(
            lambda: state.service.separate(body.input, body.vocals, body.background)
        )

    @app.post("/v1/analyze")
    async def analyze(body: AnalyzeRequest):
        segments = [s.model_dump() for s in body.segments]
        return await exclusive(lambda: state.service.analyze(body.vocals, segments, body.output))

    return app
