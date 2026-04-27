**Workspace**

- Repo root packages a self-hosted static web deployment around upstream OpenCode.
- `opencode/` is a git submodule pointing at `https://github.com/anomalyco/opencode.git`.
- Do not modify files under `opencode/`. Treat upstream code as read-only. The only upstream change allowed here is updating the submodule pointer.
- Root changes belong in the repo root, `build/`, `runtime/`, `config/`, or `scripts/`.
- When inspecting upstream code for context, read the closest `AGENTS.md` inside `opencode/`.
- Runtime code lives in `runtime/*.ts` and is bundled into `dist/runtime/runtime-bundle.js` by `build/transpile-runtime.ts`.

**Commands**

- First-time setup: `git submodule update --init --recursive`
- Build Docker image: `docker build -t opencode-web-docker .` or `bun run docker:build`
- Published image: `ghcr.io/djchen/opencode-web-docker` (`linux/amd64`, `linux/arm64`)
- Quick upstream app build check: `bun run --cwd opencode/packages/app build`
- Build runtime bundle: `bun run build:runtime`
- Tests: `bun test`
- Typecheck: `bun run typecheck`
- Lint: `bun run lint`
- Format: `bun run format`
- Format check: `bun run format:check`
- Runtime regression check: `./scripts/test-runtime-config.sh --build`
- Update upstream submodule: `./scripts/update-opencode-release.sh [tag]` or `bun run upstream:update`

**Root CI**

- `ci-lint.yml` runs on pull requests to `main`, pushes to `main`, and manual dispatch. It builds the Docker image, runs runtime regression checks on pull requests, then runs tests, typecheck, lint, format checks, `actionlint`, and `shellcheck` on repo-owned `*.sh` files.
- `docker-publish.yml` runs on `main` pushes, `v*` tags, and manual dispatch. It publishes multi-platform images to GHCR.
- `update-opencode-release.yml` runs daily or on manual dispatch to update the submodule and open a PR.

**Static Web Flow**

- `Dockerfile` builds upstream `opencode/packages/app` and serves the result with `static-web-server`.
- `build/prepare-static-web.ts` injects `/runtime-config.js` and the repo stylesheet into `index.html`, then patches the built frontend so it reads `window.__OPENCODE_SERVER_URL` instead of falling back to `location.origin`.
- `build/check-runtime-config-compat.ts` guards the local patches against upstream persistence changes during Docker builds.
- `build/transpile-runtime.ts` bundles `runtime/index.ts` into `dist/runtime/runtime-bundle.js`.
- `runtime/entrypoint.sh` serializes env vars safely into `/runtime-config.js`, writes configured servers into localStorage, supports `OPENCODE_FORCE_DEFAULT_SERVER`, and removes `location.origin` when it is not configured.
- `config/sws.toml` disables caching for `/runtime-config.js` and `/index.html`.
- A separate `opencode serve` instance must handle the API and allow the app origin with `--cors`.
- Security: `OPENCODE_SERVER_<N>_USERNAME` and `OPENCODE_SERVER_<N>_PASSWORD` are written into browser localStorage. Do not set them for public deployments.

**Upstream OpenCode**

- The upstream default branch and CI base branch are `dev`, not `main`.
- Bun version is pinned in both `package.json` and `Dockerfile`; keep them in sync.
- Primary root verification is `docker build -t opencode-web-docker .`. Focused repo checks are `bun test`, `bun run typecheck`, `bun run lint`, `bun run format:check`, and `./scripts/test-runtime-config.sh --build`.
- Upstream typecheck: `cd opencode && bun typecheck`
- Do not run `cd opencode && bun test`; it intentionally fails. Use focused package tests such as `cd opencode/packages/opencode && bun test` or `cd opencode/packages/app && bun test:unit`.
- For local browser UI work, run the backend from `opencode/packages/opencode` with `cd opencode/packages/opencode && bun run --conditions=browser ./src/index.ts serve --port 4096`, run the app from `opencode/packages/app` with `cd opencode/packages/app && bun dev -- --port 4444`, and use `http://localhost:4444`.

**Local Docker Cleanup**

- Remove the project image: `docker rmi opencode-web-docker`
- Remove stopped containers, dangling images, and build cache: `docker system prune`
- Remove build cache only: `docker builder prune`
