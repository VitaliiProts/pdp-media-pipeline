# The shape a `video-dub` image would need: glibc for onnxruntime-node, plus ffmpeg.
FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /spike
