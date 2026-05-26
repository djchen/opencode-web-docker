# syntax=docker/dockerfile:1

FROM oven/bun:1.3.14 AS build

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/opencode-web

# Keep install inputs stable across ordinary source edits so bun install stays cached.
COPY opencode/package.json opencode/bun.lock opencode/bunfig.toml ./opencode/
COPY opencode/patches ./opencode/patches
COPY --parents \
  opencode/./packages/**/package.json \
  ./opencode/

RUN bun install --cwd opencode --frozen-lockfile --ignore-scripts

COPY opencode ./opencode
COPY package.json bun.lock tsconfig.json biome.json ./
RUN bun install --frozen-lockfile
COPY build ./build/
COPY runtime ./runtime/
COPY tests ./tests/
COPY config ./config/
RUN bun run test:compat
RUN bun run build:runtime
RUN OPENCODE_CHANNEL=prod bun run --cwd opencode/packages/app build -- --sourcemap false
RUN bun run build:prepare-static -- ./opencode/packages/app/dist
RUN mkdir -p release/public release/runtime release/config \
 && cp -r config/. release/config/ \
 && cp dist/runtime/runtime-bundle.js release/runtime/ \
 && cp runtime/generate-nginx-config.sh release/runtime/ \
 && cp -r opencode/packages/app/dist/. release/public/

FROM nginx:alpine-slim

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

COPY --from=build /opt/opencode-web/release/ ./
COPY --from=build /opt/opencode-web/release/runtime/generate-nginx-config.sh /docker-entrypoint.d/40-opencode-web.sh

RUN sed -i '/^pid /d' /etc/nginx/nginx.conf \
  && rm -f /etc/nginx/conf.d/default.conf \
  && mkdir -p \
    /etc/nginx/conf.d \
    /opt/opencode-web/runtime-configs \
    /var/cache/nginx/client_temp \
    /var/cache/nginx/proxy_temp \
    /var/cache/nginx/fastcgi_temp \
    /var/cache/nginx/uwsgi_temp \
    /var/cache/nginx/scgi_temp \
  && chown -R nginx:nginx \
    /etc/nginx/conf.d \
    /opt/opencode-web/runtime-configs \
    /var/cache/nginx \
  && chmod +x /docker-entrypoint.d/40-opencode-web.sh \
  && chmod -R a-w /opt/opencode-web/public

USER nginx:nginx

EXPOSE 8080

HEALTHCHECK --interval=1m --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/health || exit 1

CMD ["nginx", "-g", "pid /tmp/nginx.pid; daemon off;"]
