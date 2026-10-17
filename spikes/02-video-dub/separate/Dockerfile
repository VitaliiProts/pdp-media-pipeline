# Demucs on CPU: splits the original audio into the voice and everything else.
FROM python:3.11-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg time \
  && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir \
  --index-url https://download.pytorch.org/whl/cpu \
  --extra-index-url https://pypi.org/simple \
  torch==2.5.1 torchaudio==2.5.1 demucs==4.0.1 soundfile numpy
# Speaker gender classifier (wav2vec2) for picking male or female dub voices.
RUN pip install --no-cache-dir transformers==4.46.3
# Romanisation for the aligner, whose alphabet is a–z: Cyrillic, and diacritics in Latin scripts.
RUN pip install --no-cache-dir uroman==1.3.1.1
WORKDIR /spike
