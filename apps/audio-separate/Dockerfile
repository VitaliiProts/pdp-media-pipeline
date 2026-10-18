# Build context: repository root.
FROM python:3.11-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    TORCH_HOME=/opt/models/torch \
    HF_HOME=/opt/models/hf
WORKDIR /app
# OpenMP runtime for torchaudio's native extension.
RUN apt-get update \
  && apt-get install -y --no-install-recommends libgomp1 \
  && rm -rf /var/lib/apt/lists/*
COPY apps/audio-separate/requirements.txt apps/audio-separate/requirements-ml.txt ./
RUN pip install --no-cache-dir \
      --index-url https://download.pytorch.org/whl/cpu \
      --extra-index-url https://pypi.org/simple \
      -r requirements-ml.txt -r requirements.txt

# Only models.py decides which weights are needed, so code changes keep this layer cached.
FROM base AS weights
COPY apps/audio-separate/audio_separate/__init__.py apps/audio-separate/audio_separate/models.py ./audio_separate/
RUN python -m audio_separate.models

FROM base
COPY --from=weights /opt/models /opt/models
COPY apps/audio-separate/audio_separate ./audio_separate
ENV HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    PORT=3000 \
    WORK_DIR=/tmp/audio-separate
USER 1000:1000
EXPOSE 3000
CMD ["python", "-m", "audio_separate.main"]
