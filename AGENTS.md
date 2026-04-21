**Workspace**

- Repo root packages a self-hosted static web deployment around upstream OpenCode.
- `opencode/` is a git submodule pointing at `https://github.com/anomalyco/opencode.git`.
- Do not modify files under `opencode/`. Treat upstream code as read-only; the only upstream change allowed here is updating the submodule pointer.
- Root changes belong in the repo root or `scripts/`.
- When inspecting upstream code for context, read the closest `AGENTS.md` inside `opencode/` (`opencode/AGENTS.md`, `opencode/packages/app/AGENTS.md`, etc.).

**Commands**

- First-time setup: `git submodule update --init --recursive`
- Build the Docker image: `docker build -t opencode-web-docker .` (or `bun run docker:build`)
- Published image: `ghcr.io/djchen/opencode-web-docker` (multi-platform: `linux/amd64`, `linux/arm64`)
- Quick upstream app build check: `bun run --cwd opencode/packages/app build`
- Bump upstream submodule to a release tag: `./scripts/update-opencode-release.sh [tag]` (or `bun run upstream:update` for latest)

**Root CI**

- `ci-lint.yml` runs `actionlint` on workflows and `shellcheck` (severity warning) on repo-owned `*.sh` files (excludes `opencode/`).
- `docker-publish.yml` builds on PRs and pushes to GHCR on `main` pushes and `v*` tags.
- `update-opencode-release.yml` runs daily (or on dispatch) to detect the latest upstream release, update the submodule, and open a PR.

**Static Web Flow**

- `Dockerfile` builds upstream `opencode/packages/app` and serves the assets with `static-web-server`.
- **Build-time**: `scripts/check-runtime-config-compat.mjs` validates that the localStorage keys and shape used by `runtime-config.sh` still match upstream source (`entry.tsx`, `persist.ts`, `server.tsx`). This check runs in the Docker build; if it fails, the upstream app has changed its persistence API and `runtime-config.sh` must be updated before rebuilding.
- **Build-time**: `scripts/prepare-static-web.mjs` injects `<script src="/runtime-config.js"></script>` into `index.html` before the module bundle so runtime config seeds localStorage before the app reads it. It also patches the built JS so `getCurrentUrl()` falls back to `window.__OPENCODE_SERVER_URL` instead of `location.origin`, removing the default localhost server and ensuring only the runtime-configured server appears.
- **Runtime**: `runtime-config.sh` generates `/runtime-config.js` from indexed container env vars. `OPENCODE_SERVER_1_URL` is required; additional servers use contiguous unpadded indexes (`OPENCODE_SERVER_2_URL`, etc.), with optional `NAME`, `USERNAME`, and `PASSWORD` fields per index. Legacy unsuffixed vars are rejected at startup. `OPENCODE_FORCE_DEFAULT_SERVER` defaults to `true`, accepts `false`, or a configured numeric index. The script writes all configured servers into the localStorage server store, keeps them first in index order, treats empty optional metadata values the same as omitted ones, sets `window.__OPENCODE_SERVER_URL` for the build-time JS patch, and removes `location.origin` when it is not one of the configured backends.
- `sws.toml` sets no-cache headers on `/runtime-config.js` and `/index.html`.
- A separate `opencode serve` instance must handle the API and must allow the app origin with `--cors`.
- **Security**: `OPENCODE_SERVER_<N>_USERNAME` and `OPENCODE_SERVER_<N>_PASSWORD` values are written into browser localStorage. Do not set them for public deployments; let users enter credentials in the app.

**Upstream OpenCode**

- The upstream default branch and CI base branch are `dev`, not `main`.
- Bun version is pinned to `1.3.12` in both `package.json` and the Dockerfile.
- Root verification is `docker build -t opencode-web-docker .`; there is no root test/lint/typecheck workflow beyond that.
- Upstream typecheck: `cd opencode && bun typecheck`
- Do not run `cd opencode && bun test`; it intentionally exits with "do not run tests from root". Use focused tests from package dirs (`cd opencode/packages/opencode && bun test`, `cd opencode/packages/app && bun test:unit`, etc.).
- For local browser UI work, run the backend from `opencode/packages/opencode` with `bun run --conditions=browser ./src/index.ts serve --port 4096`, run the app from `opencode/packages/app` with `bun dev -- --port 4444`, and use `http://localhost:4444`.

**Local Docker Cleanup**

- Local development and image verification leaves Docker artifacts. Clean up:
- Remove the project image: `docker rmi opencode-web-docker`
- Remove dangling images, stopped containers, and build cache: `docker system prune`
- Remove build cache: `docker builder prune`
