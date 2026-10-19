"""Entry point: serves health at once and loads the models in the background; readiness turns on
when they are in memory (~6 s from the image). A failed load stops the process."""

from __future__ import annotations

import json
import logging
import os
import sys
import threading

import uvicorn

from .app import AppState, create_app
from .service import Service
from .storage import S3Storage
from .telemetry import configure_telemetry

log = logging.getLogger("audio-separate")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry = {"level": record.levelname.lower(), "msg": record.getMessage(), "name": record.name}
        if record.exc_info:
            entry["err"] = self.formatException(record.exc_info)
        return json.dumps(entry)


def env(name: str, default: str | None = None) -> str:
    value = os.environ.get(name, default)
    if value is None:
        raise SystemExit(f"{name} is required")
    return value


def threads() -> int:
    """PyTorch takes every core of the node otherwise and slows down 2–3x under the CPU quota."""
    return int(os.environ.get("TORCH_THREADS") or os.environ.get("OMP_NUM_THREADS") or "2")


def main() -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    logging.basicConfig(level=env("LOG_LEVEL", "info").upper(), handlers=[handler])

    access_key = os.environ.get("S3_ACCESS_KEY") or None
    secret_key = os.environ.get("S3_SECRET_KEY") or None
    if (access_key is None) != (secret_key is None):
        raise SystemExit("S3_ACCESS_KEY and S3_SECRET_KEY are set together or not at all")
    storage = S3Storage(
        endpoint=os.environ.get("S3_ENDPOINT") or None,
        region=env("S3_REGION", "us-east-1"),
        bucket=env("S3_BUCKET"),
        access_key=access_key,
        secret_key=secret_key,
        force_path_style=env("S3_FORCE_PATH_STYLE", "true") == "true",
    )
    state = AppState()
    app = create_app(state)
    configure_telemetry(app)

    def load() -> None:
        try:
            from .models import TorchModels

            state.service = Service(storage, TorchModels(threads()), os.environ.get("WORK_DIR"))
            log.info("models loaded")
        except Exception:
            log.exception("could not load the models")
            os._exit(1)

    threading.Thread(target=load, name="load-models", daemon=True).start()
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=int(env("PORT", "3000")),
        log_level="warning",
        access_log=False,
        timeout_graceful_shutdown=int(env("SHUTDOWN_GRACE_SECONDS", "30")),
    )


if __name__ == "__main__":
    main()
