# Demucs on CPU: splits the original audio into the voice and everything else.
FROM python:3.11-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg time \
  && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir \
  --index-url https://download.pytorch.org/whl/cpu \
  --extra-index-url https://pypi.org/simple \
  torch==2.5.1 torchaudio==2.5.1 demucs==4.0.1 soundfile numpy
WORKDIR /spike
