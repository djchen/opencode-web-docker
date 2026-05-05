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
- Each served hostname receives exactly one runtime server entry. On page load, the app's persisted server list is replaced with that hostname's runtime backend; saved server credentials and entries for other servers are not preserved.
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

Each configured web hostname gets its own exact nginx `server` block and its own `/runtime-config.js`. That runtime config injects exactly one backend and forces that backend as the browser default for that origin.

Route every web hostname to the same container or reverse proxy target. If TLS terminates in front of this container, the certificate must cover every web hostname as Subject Alternative Names (SANs). Each `opencode serve` backend must allow CORS from the matching web origin, for example `opencode serve --cors https://web1.opencode.example.com`.

Requests with an unmatched `Host` header never receive a generated runtime config or configured backend. Unmatched hosts return `404` for everything except `/health`, which returns `200`.

## How It Works

1. **Build:** the Docker build compiles the upstream app, injects the runtime bootstrap into `index.html`, patches the built frontend to use `window.__OPENCODE_SERVER_URL`, and runs a compatibility check so upstream persistence changes fail early.
2. **Runtime:** nginx's official entrypoint runs `/docker-entrypoint.d/40-opencode-web.sh`, which validates `SERVER_<N>_HOST` and `SERVER_<N>_BACKEND`, generates per-host runtime configs under `/opt/opencode-web/runtime-configs/<host>.js`, and writes `/etc/nginx/conf.d/default.conf` from `config/nginx.conf.template`.
3. **Serving:** nginx serves shared static files from `/opt/opencode-web/public`. Configured hosts get exact server blocks, `/runtime-config.js` aliases the matching generated config, extension-like missing static files return `404`, route-like extensionless paths fall back to `/index.html`, and only `/assets/` uses immutable caching.

## Verification

Run these from the repo root after `bun install --frozen-lockfile`:

- `bun test`
- `bun run typecheck`
- `bun run lint`
- `bun run format:check`
- `bun run test:compat`
- `bun run test:runtime-config -- --build`
- `docker build -t opencode-web-docker .`

Use `bun run format` to apply formatting locally. CI also runs `actionlint` and `shellcheck` on repo-owned workflows and shell scripts.

## Updating Upstream OpenCode

```sh
# Update to the latest release
bun run upstream:update

# Or pin a specific version
bun run upstream:update -- v1.0.0
```

Then run verification and rebuild the image with `docker build -t opencode-web-docker .`.

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
