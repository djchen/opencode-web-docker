# OpenCode Web Docker

Self-host the [OpenCode](https://opencode.ai) web frontend as a static site with runtime configuration injection and sync for settings.

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
  -e OPENCODE_SERVER_URL=https://opencode-api.example.com \
  -e OPENCODE_SERVER_NAME='My Server' \
  -e OPENCODE_APP_TITLE='Hosted OpenCode' \
  ghcr.io/djchen/opencode-web-docker:latest
```

## Configuration

All configuration is via environment variables, applied at container start.

### Server

| Variable | Required | Default | Description |
|---|---|---|---|
| `OPENCODE_SERVER_URL` | **yes** | — | Backend URL |
| `OPENCODE_SERVER_NAME` | no | — | Display name shown in the UI |
| `OPENCODE_SERVER_USERNAME` | no | — | HTTP basic-auth username. Stored in browser localStorage |
| `OPENCODE_SERVER_PASSWORD` | no | — | HTTP basic-auth password. Stored in browser localStorage |
| `OPENCODE_APP_TITLE` | no | — | Browser tab title |

Rules:

- URLs are normalized by trimming whitespace, adding `http://` when missing, and removing trailing slashes.
- Startup fails fast on missing or empty `OPENCODE_SERVER_URL`.
- `OPENCODE_APP_TITLE`, when set, updates the browser tab title only. It does not change visible in-app branding.

**IMPORTANT**: `OPENCODE_SERVER_USERNAME` and `OPENCODE_SERVER_PASSWORD` are written into browser localStorage at runtime. **Do not set these for public deployments.** Let users enter credentials in the app instead.

### Settings Sync

When `OPENCODE_SETTINGS_SYNC_URL` is set, the web app pulls and pushes a allowlist of settings (fonts, keybinds, theme, layout, locale) to an external HTTPS endpoint.

| Variable | Required | Default | Description |
|---|---|---|---|
| `OPENCODE_SETTINGS_SYNC_URL` | no | — | Full URL for settings sync (empty = disabled) |
| `OPENCODE_SETTINGS_SYNC_INTERVAL` | no | `30` | Pull interval in seconds (min 5) |
| `OPENCODE_SETTINGS_SYNC_AUTH_HEADER` | no | — | Custom `Authorization` header value (e.g. `Bearer mytoken`) |
| `OPENCODE_SETTINGS_SYNC_USERNAME` | no | — | Username for HTTP Basic Auth (only when AUTH_HEADER is not set) |
| `OPENCODE_SETTINGS_SYNC_PASSWORD` | no | — | Password for HTTP Basic Auth (only when AUTH_HEADER is not set) |

Synced keys: `settings.v3`, `opencode-theme-id`, `opencode-color-scheme`, `opencode.global.dat:language`, `opencode.global.dat:layout`, `opencode.global.dat:layout.page`.

The sync URL is used as-is for both GET and PUT — no path segments are appended. The sync service must return `200` + JSON body on GET, and `200`/`204` on PUT. A `404` response on GET is treated as "no remote state yet" and triggers an initial push when local synced settings exist.

If `OPENCODE_SETTINGS_SYNC_AUTH_HEADER` is set, its value is sent as the `Authorization` header on every sync request. Otherwise, HTTP Basic Auth is used with `OPENCODE_SETTINGS_SYNC_USERNAME` and `OPENCODE_SETTINGS_SYNC_PASSWORD`.

**Note**: The sync service must return proper CORS headers allowing the web app's origin.

**IMPORTANT**: `OPENCODE_SETTINGS_SYNC_AUTH_HEADER`, `OPENCODE_SETTINGS_SYNC_USERNAME`, and `OPENCODE_SETTINGS_SYNC_PASSWORD` are embedded in browser-delivered JavaScript. **Do not set `OPENCODE_SETTINGS_SYNC_AUTH_HEADER` to a shared secret or service token.** Only use per-user, browser-safe credentials.

Example:

```yaml
OPENCODE_SERVER_URL: https://opencode-api.example.com
OPENCODE_SERVER_NAME: My Server
OPENCODE_APP_TITLE: Hosted OpenCode
OPENCODE_SETTINGS_SYNC_URL: https://api.example.com/v1/sync/users/opencode/settings
OPENCODE_SETTINGS_SYNC_AUTH_HEADER: "Bearer my-token"
```

## How It Works

1. **Build time** — The upstream OpenCode web app is built, then:
   - `build/prepare-static-web.ts` injects `<script src="/runtime-config.js">` and a static `<link rel="stylesheet" href="/opencode-web-customizations.css">` into `index.html` (before the module bundle), patches the app's default server URL logic to respect the runtime config, writes the customization CSS from `build/customization-css.ts` as a standalone asset, and patches only the JS assets referenced from `index.html` in place.
   - `build/check-runtime-config-compat.ts` validates that the upstream source still matches the assumptions made by those build and runtime patches. The Docker build fails if they diverge, prompting you to update the affected build or runtime scripts.
   - `build/transpile-runtime.ts` bundles the runtime TypeScript modules (`runtime/index.ts` → imports `runtime-config-core.ts`, `blob-sync.ts`, `sync-client.ts`) into a single IIFE file `dist/runtime/runtime-bundle.js` via `Bun.build()`.
2. **Run time** — `runtime/entrypoint.sh` (the container entrypoint) generates `/runtime-config.js` by concatenating a JS preamble (with env var assignments) and the pre-built `runtime-bundle.js`. The generated script is synchronous (no `await`) and runs as a blocking `<script>` before the app bundle. It writes the configured server into browser localStorage, removes `location.origin` when it would otherwise appear as a fake backend, avoids redundant writes, and sets `window.__OPENCODE_SERVER_URL`. If `OPENCODE_SETTINGS_SYNC_URL` is set, it also initializes the settings sync client.
3. **Serving** — [static-web-server](https://github.com/static-web-server/static-web-server) serves the static assets. `config/sws.toml` sets aggressive no-cache headers on `/runtime-config.js` and `/index.html`.

## Updating Upstream OpenCode

```sh
# Update to the latest release
./scripts/update-opencode-release.sh

# Or pin a specific version
./scripts/update-opencode-release.sh v1.0.0
```

Then rebuild the image (`docker build -t opencode-web-docker .`).

If the compatibility check fails, upstream has changed in a way that's incompatible with the patches — update `runtime/entrypoint.sh`, `runtime/runtime-config-core.ts`, or `runtime/sync-client.ts` before rebuilding.

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
