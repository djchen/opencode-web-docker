# syntax=docker/dockerfile:1.7

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

COPY opencode ./opencode
COPY scripts/check-runtime-config-compat.mjs ./scripts/check-runtime-config-compat.mjs
COPY scripts/build-compat ./scripts/build-compat
COPY scripts/customization-css.mjs ./scripts/customization-css.mjs
COPY scripts/prepare-static-web.mjs ./scripts/prepare-static-web.mjs

RUN bun install --cwd opencode --frozen-lockfile
RUN bun ./scripts/check-runtime-config-compat.mjs
RUN bun run --cwd opencode/packages/app build
RUN bun ./scripts/prepare-static-web.mjs ./opencode/packages/app/dist /tmp/site

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

COPY --chown=sws:sws sws.toml /home/sws/sws.toml
COPY --chown=sws:sws runtime-config.sh /usr/local/bin/runtime-config.sh
COPY --chown=sws:sws --from=build /tmp/site/ /home/sws/public/

RUN chmod +x /usr/local/bin/runtime-config.sh

ENTRYPOINT ["/bin/sh", "/usr/local/bin/runtime-config.sh"]
CMD ["static-web-server", "-w", "/home/sws/sws.toml"]
