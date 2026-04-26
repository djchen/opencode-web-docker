# syntax=docker/dockerfile:1

FROM oven/bun:1.3.13 AS build

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    g++ \
    git \
    make \
    python3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/opencode-web

# Keep install inputs stable across ordinary source edits so bun install stays cached.
COPY opencode/package.json opencode/bun.lock opencode/bunfig.toml ./opencode/
COPY opencode/patches ./opencode/patches
COPY --parents \
  opencode/./packages/**/package.json \
  ./opencode/
COPY opencode/packages/opencode/script/fix-node-pty.ts ./opencode/packages/opencode/script/fix-node-pty.ts

RUN bun install --cwd opencode --frozen-lockfile

COPY opencode ./opencode
COPY package.json bun.lock tsconfig.json ./
RUN bun install --frozen-lockfile
COPY build runtime tests config ./
RUN bun ./build/check-runtime-config-compat.ts
RUN bun run build:runtime
RUN bun run --cwd opencode/packages/app build
RUN bun ./build/prepare-static-web.ts ./opencode/packages/app/dist
RUN mkdir -p release/public release/runtime \
 && cp -r config/ release/config/ \
 && cp dist/runtime/runtime-bundle.js release/runtime/ \
 && cp runtime/entrypoint.sh release/runtime/ \
 && cp -r opencode/packages/app/dist/. release/public/

FROM ghcr.io/static-web-server/static-web-server:2-alpine

ARG VERSION=dev
ARG REVISION=unknown
ARG SOURCE_URL=https://github.com/djchen/opencode-web-docker

LABEL org.opencontainers.image.title="OpenCode Web Docker"
LABEL org.opencontainers.image.description="Static OpenCode web app container with runtime-config injection"
LABEL org.opencontainers.image.source="$SOURCE_URL"
LABEL org.opencontainers.image.version="$VERSION"
LABEL org.opencontainers.image.revision="$REVISION"
LABEL org.opencontainers.image.licenses="MIT"

WORKDIR /opt/opencode-web

COPY --chown=sws:sws --from=build /opt/opencode-web/release/ ./

HEALTHCHECK --interval=1m --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/index.html || exit 1

ENTRYPOINT ["/bin/sh", "/opt/opencode-web/runtime/entrypoint.sh"]
CMD ["static-web-server", "-w", "/opt/opencode-web/config/sws.toml"]