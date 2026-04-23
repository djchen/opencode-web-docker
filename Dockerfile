# syntax=docker/dockerfile:1

FROM oven/bun:1.3.12 AS build

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    g++ \
    git \
    make \
    pkg-config \
    python3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Keep install inputs stable across ordinary source edits so bun install stays cached.
COPY opencode/package.json opencode/bun.lock opencode/bunfig.toml ./opencode/
COPY opencode/patches ./opencode/patches
COPY opencode/.husky ./opencode/.husky
COPY --parents \
  opencode/./packages/**/package.json \
  ./opencode/
COPY opencode/packages/opencode/script/fix-node-pty.ts ./opencode/packages/opencode/script/fix-node-pty.ts

RUN bun install --cwd opencode --frozen-lockfile

COPY opencode ./opencode
COPY build/check-runtime-config-compat.mjs ./build/check-runtime-config-compat.mjs
COPY tests ./tests
COPY build/customization-css.mjs ./build/customization-css.mjs
COPY build/prepare-static-web.mjs ./build/prepare-static-web.mjs
RUN bun ./build/check-runtime-config-compat.mjs
RUN bun run --cwd opencode/packages/app build
RUN bun ./build/prepare-static-web.mjs ./opencode/packages/app/dist

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

COPY --chown=sws:sws config/sws.toml /home/sws/sws.toml
COPY --chown=sws:sws runtime/entrypoint.sh /usr/local/bin/runtime-config.sh
COPY --chown=sws:sws runtime/runtime-config-core.js /usr/local/share/opencode-web/runtime-config-core.js
COPY --chown=sws:sws --from=build /app/opencode/packages/app/dist/ /home/sws/public/

RUN chmod +x /usr/local/bin/runtime-config.sh

HEALTHCHECK --interval=1m --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/index.html || exit 1

ENTRYPOINT ["/bin/sh", "/usr/local/bin/runtime-config.sh"]
CMD ["static-web-server", "-w", "/home/sws/sws.toml"]
