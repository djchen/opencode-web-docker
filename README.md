# OpenCode Web Docker

Self-host the [OpenCode](https://opencode.ai) web frontend as a static site with host-based runtime configuration injection for one or more `opencode serve` backends.

The container serves the same built app on multiple hostnames, injects the matching backend and title for each hostname, and applies CSS customizations.

## Quick Start
### OpenCode Server
Run `opencode serve` to expose an endpoint that OpenCode clients can use.

Example: `opencode serve --port 4096 --cors https://web1.opencode.example.com`

Set `--cors` to the web app origin that users open in the browser, such as `https://web1.opencode.example.com`. Do not set it to the backend API URL.

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
  -e SERVER_1_HOST=web1.opencode.example.com \
  -e SERVER_1_BACKEND=https://api1.opencode.example.com \
  -e SERVER_1_NAME='Server 1' \
  -e SERVER_1_APP_TITLE='OpenCode Server 1' \
  -e SERVER_2_HOST=web2.opencode.example.com \
  -e SERVER_2_BACKEND=https://api2.opencode.example.com \
  -e SERVER_2_NAME='Server 2' \
  -e SERVER_2_APP_TITLE='OpenCode Server 2' \
  ghcr.io/djchen/opencode-web-docker:latest
```

## Configuration

All configuration is provided through environment variables at container start.

| Variable | Required | Default | Description |
|---|---|---|---|
| `SERVER_1_HOST` | **yes** | none | First web hostname served by this container |
| `SERVER_1_BACKEND` | **yes** | none | Backend URL injected for the first hostname |
| `SERVER_<N>_HOST` | yes, for every configured index | none | Web hostname for server `N` |
| `SERVER_<N>_BACKEND` | yes, for every configured index | none | Backend URL injected for server `N` |
| `SERVER_<N>_NAME` | no | none | Display name stored for server `N` |
| `SERVER_<N>_APP_TITLE` | no | none | HTML page title for server `N` |

Rules:

- Configured indexes must be contiguous unpadded integers starting at `1`. Valid examples: `1`; `1,2`; `1,2,3`. Invalid examples: `01`; `1,3`.
- Hosts are hostname-only ASCII DNS names. They are trimmed and lowercased. Do not include protocol, port, path, whitespace, wildcards, or direct Unicode. Supply IDNs as Punycode, for example `xn--...`.
- Backend URLs must be absolute `http://` or `https://` URLs. They are normalized by trimming whitespace, lowercasing scheme and host, and removing trailing slashes.
- Startup fails fast on missing indexed hosts or backends, non-contiguous indexes, invalid hosts, or duplicate normalized hosts. Duplicate backend URLs are allowed.
- `SERVER_<N>_APP_TITLE`, when set, updates the HTML page title for that server's hostname only. It does not change visible in-app branding.

Example:

```yaml
SERVER_1_HOST: web1.opencode.example.com
SERVER_1_BACKEND: https://api1.opencode.example.com
SERVER_1_NAME: Server 1
SERVER_1_APP_TITLE: OpenCode Server 1

SERVER_2_HOST: web2.opencode.example.com
SERVER_2_BACKEND: https://api2.opencode.example.com
SERVER_2_NAME: Server 2
SERVER_2_APP_TITLE: OpenCode Server 2
```

## Host-Based Routing

Each configured web hostname gets its own SWS virtual host and its own `/runtime-config.js`. That runtime config injects exactly one backend and forces that backend as the browser default for that origin.

Route every web hostname to the same container or reverse proxy target. If TLS terminates in front of this container, the certificate must cover every web hostname as Subject Alternative Names (SANs). Each `opencode serve` backend must allow CORS from the matching web origin, for example `opencode serve --cors https://web1.opencode.example.com`.

Requests with an unmatched `Host` header never receive a generated runtime config or configured backend. They may receive the shared app shell for unknown SPA paths, but `/runtime-config.js` remains inert because no host-specific config exists for that host.

## How It Works

1. **Build:** the Docker build compiles the upstream app, injects the runtime bootstrap into `index.html`, patches the built frontend to use `window.__OPENCODE_SERVER_URL`, and runs a compatibility check so upstream persistence changes fail early.
2. **Runtime:** `runtime/entrypoint.sh` validates `SERVER_<N>_HOST` and `SERVER_<N>_BACKEND`, generates per-host roots under `/opt/opencode-web/vhosts/<host>/`, prepares an unmatched-host root without runtime config, and writes `/opt/opencode-web/config/sws.toml`.
3. **Serving:** [static-web-server](https://github.com/static-web-server/static-web-server) serves virtual-host roots for configured hosts and an inert root for unmatched hosts. `config/sws.toml` remains the base cache and CSP contract.

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
