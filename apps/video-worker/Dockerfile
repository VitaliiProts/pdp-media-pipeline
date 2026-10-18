# syntax=docker/dockerfile:1.7
# Build context: repository root.
# Two images from one build: the default Alpine `runtime` for video.frames / video.transcode,
# and `--target dub` (Debian, ADR-016) for video.dub, which needs glibc for onnxruntime-node.
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /repo

FROM base AS build
ARG APP=@pdp/video-worker
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,sharing=locked pnpm fetch
COPY . .
# Scripts stay off: the onnxruntime-node postinstall only fetches CUDA libraries.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile --offline --ignore-scripts --filter "${APP}..."
RUN pnpm --filter "${APP}..." build
# onnxruntime-node carries binaries of every platform (287 MB) and none for musl.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,sharing=locked \
    pnpm --filter "${APP}" deploy --prod --prefer-offline --no-optional /out

FROM build AS build-dub
ARG APP=@pdp/video-worker
ARG TARGETARCH
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,sharing=locked \
    pnpm --filter "${APP}" deploy --prod --prefer-offline /out-dub
# Only the binary of this Linux architecture.
RUN arch=$([ "$TARGETARCH" = arm64 ] && echo arm64 || echo x64) \
  && bins=$(ls -d /out-dub/node_modules/.pnpm/onnxruntime-node@*/node_modules/onnxruntime-node/bin/napi-v*) \
  && for bin in $bins; do \
       for dir in "$bin"/*; do [ "${dir##*/}" = linux ] || rm -rf "$dir"; done; \
       for dir in "$bin"/linux/*; do [ "${dir##*/}" = "$arch" ] || rm -rf "$dir"; done; \
     done \
  && ls "$bin/linux/$arch"/*.node >/dev/null

# Supertonic 3 (OpenRAIL-M, attribution in LICENSE): the archived repository, pinned revision.
FROM alpine:3.22 AS supertonic
ARG SUPERTONIC_REVISION=3cadd1ee6394adea1bd021217a0e650ede09a323
RUN apk add --no-cache curl \
  && base=https://huggingface.co/Supertone/supertonic-3/resolve/${SUPERTONIC_REVISION} \
  && mkdir -p /opt/supertonic/onnx /opt/supertonic/voice_styles \
  && for f in duration_predictor.onnx text_encoder.onnx vector_estimator.onnx vocoder.onnx \
       tts.json unicode_indexer.json; do \
       curl -fsSL --retry 3 -o /opt/supertonic/onnx/$f $base/onnx/$f; done \
  && for v in M1 M2 M3 M4 M5 F1 F2 F3 F4 F5; do \
       curl -fsSL --retry 3 -o /opt/supertonic/voice_styles/$v.json $base/voice_styles/$v.json; done \
  && curl -fsSL --retry 3 -o /opt/supertonic/LICENSE $base/LICENSE

FROM node:${NODE_VERSION}-bookworm-slim AS dub
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg wget \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    SUPERTONIC_ASSETS_DIR=/opt/supertonic \
    VIDEO_JOB_TYPES=video.dub
WORKDIR /app
COPY --from=supertonic /opt/supertonic /opt/supertonic
COPY --from=build-dub /out-dub .
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health/live >/dev/null || exit 1
CMD ["node", "dist/main.js"]

FROM node:${NODE_VERSION}-alpine AS runtime
# ffmpeg and ffprobe come from the distro, so codecs get security updates with the base image.
RUN apk add --no-cache ffmpeg
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health/live >/dev/null || exit 1
CMD ["node", "dist/main.js"]
