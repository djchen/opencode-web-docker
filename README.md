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

See [`docker-compose.yaml`](./docker-compose.yaml) for a ready-to-run compose example.

```sh
docker compose up -d
```

### Docker CLI

```sh
docker run -d \
  --name opencode-web \
  -p 8080:80 \
  -e OPENCODE_SERVER_1_URL=https://opencode-api1.example.com \
  -e OPENCODE_SERVER_1_NAME='Server 1' \
  -e OPENCODE_SERVER_2_URL=https://opencode-api2.example.com \
  -e OPENCODE_SERVER_2_NAME='Server 2' \
  -e OPENCODE_FORCE_DEFAULT_SERVER=1 \
  ghcr.io/djchen/opencode-web-docker:latest
```

## Configuration

All configuration is via environment variables, applied at container start.

| Variable | Required | Default | Description |
|---|---|---|---|
| `OPENCODE_SERVER_1_URL` | **yes** | — | First configured backend URL |
| `OPENCODE_SERVER_<N>_URL` | yes, for every configured index | — | Backend URL for server `N` |
| `OPENCODE_SERVER_<N>_NAME` | no | — | Display name shown for server `N` in the UI |
| `OPENCODE_SERVER_<N>_USERNAME` | no | — | HTTP basic-auth username for server `N`. Stored in browser localStorage |
| `OPENCODE_SERVER_<N>_PASSWORD` | no | — | HTTP basic-auth password for server `N`. Stored in browser localStorage |
| `OPENCODE_FORCE_DEFAULT_SERVER` | no | `true` | `true` or unset forces server `1`; `false` preserves a valid browser default; integer `N` forces server `N` |
| `OPENCODE_APP_TITLE` | no | — | Browser tab title to apply after runtime config loads |

Rules:

- Configured indexes must be contiguous unpadded integers starting at `1`. Valid examples: `1`; `1,2`; `1,2,3`. Invalid examples: `01`; `1,3`.
- URLs are normalized by trimming whitespace, adding `http://` when missing, and removing trailing slashes.
- `OPENCODE_FORCE_DEFAULT_SERVER` accepts only the exact values `true`, `false`, or an integer index `N`.
- Startup fails fast on missing indexed URLs, non-contiguous indexes, duplicate normalized URLs, or an invalid `OPENCODE_FORCE_DEFAULT_SERVER` value.
- `OPENCODE_APP_TITLE`, when set, updates the browser tab title only. It does not change visible in-app branding.

Example:

```yaml
OPENCODE_SERVER_1_URL: https://opencode-api1.example.com
OPENCODE_SERVER_1_NAME: Server 1

OPENCODE_SERVER_2_URL: https://opencode-api2.example.com
OPENCODE_SERVER_2_NAME: Server 2

OPENCODE_FORCE_DEFAULT_SERVER: 1
OPENCODE_APP_TITLE: Hosted OpenCode
```

**IMPORTANT**: `OPENCODE_SERVER_<N>_USERNAME` and `OPENCODE_SERVER_<N>_PASSWORD` are written into browser localStorage at runtime. **Do not set these for public deployments.** Let users enter credentials in the app instead.


## How It Works

1. **Build time** — The upstream OpenCode web app is built, then:
   - `build/prepare-static-web.mjs` injects `<script src="/runtime-config.js">` and a static `<link rel="stylesheet" href="/opencode-web-customizations.css">` into `index.html` (before the module bundle), patches the app's default server URL logic to respect the runtime config, writes the customization CSS from `build/customization-css.mjs` as a standalone asset, and patches only the JS assets referenced from `index.html` in place.
   - `build/check-runtime-config-compat.mjs` validates that the upstream source still matches the assumptions made by those build and runtime patches. The Docker build fails if they diverge, prompting you to update the affected build or runtime scripts.
2. **Run time** — `runtime/entrypoint.sh` (the container entrypoint) generates `/runtime-config.js` from environment variables. This script writes all configured servers into browser localStorage before the app loads, keeps configured servers first in index order, preserves user-added non-configured servers, preserves `projects` and `lastProject`, avoids redundant localStorage rewrites when nothing changed, and removes `location.origin` when it would otherwise appear as a fake backend.
3. **Serving** — [static-web-server](https://github.com/static-web-server/static-web-server) serves the static assets. `config/sws.toml` sets aggressive no-cache headers on `/runtime-config.js` and `/index.html`. The wrapper's customization CSS ships as a regular static file, but the upstream app still emits runtime inline styles, so the CSP keeps `style-src 'self' 'unsafe-inline'`.

Default server behavior:

- If `OPENCODE_FORCE_DEFAULT_SERVER` is unset or `true`, server `1` is selected on load.
- If `OPENCODE_FORCE_DEFAULT_SERVER` is an integer `N`, server `N` is selected on load.
- If `OPENCODE_FORCE_DEFAULT_SERVER=false`, the browser's existing default is preserved when it still points to a server in the merged list; otherwise the wrapper falls back to server `1`.
- For configured servers already stored in the browser, non-empty env-provided `NAME`, `USERNAME`, and `PASSWORD` override stored values. Unset and empty values are treated the same, so stored optional metadata is preserved when the env omits a value or sets it to an empty string.

## Updating Upstream OpenCode

```sh
# Update to the latest release
./scripts/update-opencode-release.sh

# Or pin a specific version
./scripts/update-opencode-release.sh v1.0.0
```

Then rebuild the image (`docker build -t opencode-web-docker .`).

If the compatibility check fails, upstream has changed in a way that's incompatible with the patches — update `runtime/entrypoint.sh`, `runtime/runtime-config-core.js`, or the other affected build scripts before rebuilding.

Repository-owned verification:

- `docker build -t opencode-web-docker .`
- `bun test tests`
- `./scripts/test-runtime-config.sh --build`

## Building from Source

```sh
git clone https://github.com/djchen/opencode-web-docker.git
cd opencode-web-docker
git submodule update --init --recursive
docker build -t opencode-web-docker .
```

## License

[MIT](LICENSE)
