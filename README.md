# OpenCode Web Docker

Self-host the [OpenCode](https://opencode.ai) web frontend as a static site with runtime configuration injection for one or more `opencode serve` backends.

The container seeds configured servers into browser localStorage, overrides the HTML page title, and applies CSS customizations.

## Quick Start
### OpenCode Server
Run `opencode serve` to expose an endpoint that OpenCode clients can use.

Example: `opencode serve --port 4096 --cors https://opencode.example.com`

Set `--cors` to the web app origin that users open in the browser, such as `https://opencode.example.com`. Do not set it to the backend API URL.

Consider putting the `opencode serve` backend behind TLS with a reverse proxy, or exposing it through Tailscale, ZeroTier, etc.

Docs: https://opencode.ai/docs/server/

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

All configuration is provided through environment variables at container start.

| Variable | Required | Default | Description |
|---|---|---|---|
| `OPENCODE_SERVER_1_URL` | **yes** | none | First configured backend URL |
| `OPENCODE_SERVER_<N>_URL` | yes, for every configured index | none | Backend URL for server `N` |
| `OPENCODE_SERVER_<N>_NAME` | no | none | Name shown for server `N` in the server picker and current server button |
| `OPENCODE_FORCE_DEFAULT_SERVER` | no | `true` | `true` or unset forces server `1`; `false` preserves a valid browser default; integer `N` forces server `N` |
| `OPENCODE_APP_TITLE` | no | none | Overrides the HTML page title |

Rules:

- Configured indexes must be contiguous unpadded integers starting at `1`. Valid examples: `1`; `1,2`; `1,2,3`. Invalid examples: `01`; `1,3`.
- URLs are normalized by trimming whitespace, adding `http://` when missing, and removing trailing slashes.
- `OPENCODE_FORCE_DEFAULT_SERVER` accepts only the exact values `true`, `false`, or an integer index `N`.
- Startup fails fast on missing indexed URLs, non-contiguous indexes, duplicate normalized URLs, or an invalid `OPENCODE_FORCE_DEFAULT_SERVER` value.
- `OPENCODE_APP_TITLE`, when set, updates the HTML page title only. It does not change visible in-app branding.

Example:

```yaml
OPENCODE_SERVER_1_URL: https://opencode-api1.example.com
OPENCODE_SERVER_1_NAME: Server 1

OPENCODE_SERVER_2_URL: https://opencode-api2.example.com
OPENCODE_SERVER_2_NAME: Server 2

OPENCODE_FORCE_DEFAULT_SERVER: 1
OPENCODE_APP_TITLE: Hosted OpenCode
```

## How It Works

1. **Build:** the Docker build compiles the upstream app, injects the runtime bootstrap into `index.html`, patches the built frontend to use the selected backend, and runs a compatibility check so upstream persistence changes fail early.
2. **Runtime:** `runtime/entrypoint.sh` generates `/runtime-config.js`, seeds configured servers into browser localStorage, applies default-server selection, and sets `OPENCODE_APP_TITLE` when provided.
3. **Serving:** [static-web-server](https://github.com/static-web-server/static-web-server) serves the static assets. `config/sws.toml` disables caching for `/runtime-config.js` and `/index.html`.

Default server behavior:

- If `OPENCODE_FORCE_DEFAULT_SERVER` is unset or `true`, server `1` is selected on load.
- If `OPENCODE_FORCE_DEFAULT_SERVER` is an integer `N`, server `N` is selected on load.
- If `OPENCODE_FORCE_DEFAULT_SERVER=false`, the browser's existing default is preserved when it still points to a server in the merged list. Otherwise the wrapper falls back to server `1`.
- If a configured server already exists in browser storage, a non-empty `OPENCODE_SERVER_<N>_NAME` updates its display name. Unset or empty names keep the stored display name.

## Verification

Run these from the repo root after `bun install --frozen-lockfile`:

- `bun test`
- `bun run typecheck`
- `bun run lint`
- `bun run format:check`
- `./scripts/test-runtime-config.sh --build`
- `docker build -t opencode-web-docker .`

Use `bun run format` to apply formatting locally. CI also runs `actionlint` and `shellcheck` on repo-owned workflows and shell scripts.

## Updating Upstream OpenCode

```sh
# Update to the latest release
./scripts/update-opencode-release.sh

# Or pin a specific version
./scripts/update-opencode-release.sh v1.0.0
```

Then rebuild the image with `docker build -t opencode-web-docker .`.

If the compatibility check fails, upstream changed in a way that breaks the wrapper assumptions. Update the affected build or runtime scripts before rebuilding.

## Building from Source

```sh
git clone https://github.com/djchen/opencode-web-docker.git
cd opencode-web-docker
git submodule update --init --recursive
docker build -t opencode-web-docker .
```

## License

[MIT](LICENSE)
