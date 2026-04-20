# OpenCode Web Docker

Self-host the [OpenCode](https://opencode.ai) web frontend as a static site with runtime configuration injection. Designed for scenarios where you run multiple OpenCode server backends and want to centrally host the frontend.

The OpenCode web app is normally tied to a single backend. This container decouples the frontend so it can be pointed at any `opencode serve` instance.

## Quick Start
### OpenCode Server
Run `opencode serve` to expose an endpoint that an OpenCode client (cli, desktop app, web, etc) can use.

Example: `opencode serve --port 4096 --cors https://opencode.example.com`
The `--cors` flag must specify the **frontend origin** (the URL where users access the web app), not the API URL.

Consider adding SSL to the OpenCode endpoint by using a reverse proxy or only exposing the endpoint through TailScale, ZeroTier, etc.

More Info: https://opencode.ai/docs/server/

### Docker Compose

```yaml
services:
  web:
    image: ghcr.io/djchen/opencode-web-docker:latest
    ports:
      - 8080:80
    environment:
      OPENCODE_SERVER_URL: http://opencode-api.example.com:4096
      OPENCODE_FORCE_DEFAULT_SERVER: true
```

```sh
docker compose up -d
```

### Docker CLI

```sh
docker run -d \
  --name opencode-web \
  -p 8080:80 \
  -e OPENCODE_SERVER_URL=http://opencode-api.example.com:4096 \
  -e OPENCODE_FORCE_DEFAULT_SERVER=true \
  ghcr.io/djchen/opencode-web-docker:latest
```

## Configuration

All configuration is via environment variables, applied at container start.

| Variable | Required | Default | Description |
|---|---|---|---|
| `OPENCODE_SERVER_URL` | **yes** | — | URL of the `opencode serve` backend (e.g. `http://host:4096`) |
| `OPENCODE_SERVER_NAME` | no | — | Display name shown for the server in the UI |
| `OPENCODE_FORCE_DEFAULT_SERVER` | no | `true` | Always select the configured server as the default on load |
| `OPENCODE_SERVER_USERNAME` | no | — | HTTP basic-auth username. **Warning:** stored in browser localStorage — do not set for public deployments |
| `OPENCODE_SERVER_PASSWORD` | no | — | HTTP basic-auth password. **Warning:** stored in browser localStorage — do not set for public deployments |

**IMPORTANT**: `OPENCODE_SERVER_USERNAME` and `OPENCODE_SERVER_PASSWORD` are written into browser localStorage at runtime. **Do not set these for public deployments.** Let users enter credentials in the app instead.


## How It Works

1. **Build time** — The upstream OpenCode web app is built and two small patches are applied:
   - `scripts/prepare-static-web.mjs` injects `<script src="/runtime-config.js">` into `index.html` (before the module bundle) and patches the app's default server URL logic to respect the runtime config.
   - `scripts/prepare-static-web.mjs` injects CSS that hides the Help button (links to OpenCode Discord) from the sidebar rail.
   - `scripts/check-runtime-config-compat.mjs` validates that the upstream source still matches the assumptions made by the build and runtime patches. The Docker build fails if they diverge, prompting you to update the affected scripts.
2. **Run time** — `runtime-config.sh` (the container entrypoint) generates `/runtime-config.js` from environment variables. This script writes the configured server, display name, and credentials into browser localStorage before the app loads.
3. **Serving** — [static-web-server](https://github.com/static-web-server/static-web-server) serves the static assets. `sws.toml` sets aggressive no-cache headers on `/runtime-config.js` and `/index.html` so browsers always fetch fresh config.

## Updating Upstream OpenCode

```sh
# Update to the latest release
./scripts/update-opencode-release.sh

# Or pin a specific version
./scripts/update-opencode-release.sh v1.0.0
```

Then rebuild the image (`docker build -t opencode-web-docker .`).

If the compatibility check fails, upstream has changed in a way that's incompatible with the patches — update the affected scripts before rebuilding.

## Building from Source

```sh
git clone https://github.com/djchen/opencode-web-docker.git
cd opencode-web-docker
git submodule update --init --recursive
docker build -t opencode-web-docker .
```

## License

[MIT](LICENSE)
