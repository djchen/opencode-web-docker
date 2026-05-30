import { afterAll, describe, expect, test } from "bun:test";
import {
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { buildRuntimeBundle } from "../build/transpile-runtime";
import { makeTempDir } from "./temp-dir";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const generatorPath = path.join(repoRoot, "runtime/generate-nginx-config.sh");
const templatePath = path.join(repoRoot, "config/nginx.conf.template");
const serverStoreKey = "opencode.global.dat:server";
const defaultServerUrlKey = "opencode.settings.dat:defaultServerUrl";
const noStoreCacheControl = "no-store, no-cache, must-revalidate";
const immutableCacheControl = "public, max-age=31536000, immutable";
const staticWebCsp =
	"default-src 'self'; base-uri 'self'; connect-src * data:; font-src 'self' data:; frame-ancestors 'none'; img-src 'self' data: https:; media-src 'self' data:; object-src 'none'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'";

type RuntimeRoot = {
	root: string;
	configPath: string;
	runtimeConfigPath: (host: string) => string;
};

type GeneratorResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
	output: string;
};

type ValidationCase = {
	name: string;
	env: Record<string, string>;
	message: string;
};

let bundleDir: string | undefined;
let runtimeBundleSourcePromise: Promise<string> | undefined;

async function loadRuntimeBundleSource(): Promise<string> {
	runtimeBundleSourcePromise ??= (async () => {
		bundleDir = await mkdirTemp("runtime-bundle-generate-test-");
		await buildRuntimeBundle(bundleDir);
		return readFile(path.join(bundleDir, "runtime-bundle.js"), "utf8");
	})();

	return runtimeBundleSourcePromise;
}

async function mkdirTemp(prefix: string): Promise<string> {
	return mkdtemp(path.join(os.tmpdir(), prefix));
}

async function makeRuntimeRoot(): Promise<RuntimeRoot> {
	const root = await makeTempDir("generate-nginx-config-");
	await mkdir(path.join(root, "public"), { recursive: true });
	await mkdir(path.join(root, "runtime"), { recursive: true });
	await mkdir(path.join(root, "config"), { recursive: true });
	await mkdir(path.join(root, "runtime-configs"), { recursive: true });
	await writeFile(path.join(root, "public/index.html"), "<!doctype html>\n");
	await writeFile(
		path.join(root, "runtime/runtime-bundle.js"),
		await loadRuntimeBundleSource(),
	);
	await copyFile(templatePath, path.join(root, "config/nginx.conf.template"));

	return {
		root,
		configPath: path.join(root, "generated-nginx.conf"),
		runtimeConfigPath: (host) =>
			path.join(root, "runtime-configs", `${host}.js`),
	};
}

async function runGenerator(
	fixture: RuntimeRoot,
	input: { env?: Record<string, string> } = {},
): Promise<GeneratorResult> {
	const args = [
		"env",
		"-i",
		`PATH=${process.env.PATH ?? ""}`,
		`OPENCODE_WEB_RUNTIME_ROOT=${fixture.root}`,
		`OPENCODE_WEB_NGINX_CONFIG_PATH=${fixture.configPath}`,
	];

	for (const [name, value] of Object.entries(input.env ?? {})) {
		args.push(`${name}=${value}`);
	}
	args.push("sh", generatorPath);

	const child = Bun.spawn(args, {
		stderr: "pipe",
		stdout: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);

	return {
		exitCode,
		stdout,
		stderr,
		output: `${stdout}${stderr}`,
	};
}

function assertSuccess(result: GeneratorResult): void {
	if (result.exitCode !== 0) {
		throw new Error(`Expected generator to succeed, got:\n${result.output}`);
	}
}

function expectedServerBlock(input: { root: string; host: string }): string {
	return [
		"server {",
		"  listen 8080;",
		"  listen [::]:8080;",
		`  server_name ${input.host};`,
		`  root ${input.root}/public;`,
		"  index index.html;",
		`  add_header Cache-Control "${noStoreCacheControl}" always;`,
		`  add_header Content-Security-Policy "${staticWebCsp}" always;`,
		"",
		"  location = /health {",
		"    default_type text/plain;",
		'    return 200 "ok\\n";',
		"  }",
		"",
		"  location = /runtime-config.js {",
		`    alias ${input.root}/runtime-configs/${input.host}.js;`,
		"  }",
		"",
		"  location ^~ /assets/ {",
		`    add_header Cache-Control "${immutableCacheControl}" always;`,
		`    add_header Content-Security-Policy "${staticWebCsp}" always;`,
		"    try_files $uri =404;",
		"  }",
		"",
		"  location ~ \\.[^/]+$ {",
		"    try_files $uri =404;",
		"  }",
		"",
		"  location / {",
		"    try_files $uri $uri/ /index.html;",
		"  }",
		"}",
	].join("\n");
}

function countMatches(source: string, pattern: RegExp): number {
	return [...source.matchAll(pattern)].length;
}

function evaluateRuntimeConfig(
	source: string,
	expected: { title: string; backendUrl: string; name: string },
): void {
	const storage = new Map<string, string>();
	const context = {
		Buffer,
		JSON,
		TextDecoder,
		Uint8Array,
		atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
		console,
		document: { title: "OpenCode" },
		location: { origin: "http://frontend.opencode.example.com" },
		localStorage: {
			getItem: (key: string) => (storage.has(key) ? storage.get(key)! : null),
			setItem: (key: string, value: string) => storage.set(key, value),
			removeItem: (key: string) => storage.delete(key),
		},
		window: {} as { __OPENCODE_SERVER_URL?: string },
	};

	expect(() => new Function(source)).not.toThrow();
	vm.runInNewContext(source, context, { timeout: 1000 });

	const savedStateRaw = storage.get(serverStoreKey);
	expect(savedStateRaw).toBeTruthy();
	const savedState = JSON.parse(savedStateRaw!) as {
		list: Array<{
			http?: { url?: string };
			url?: string;
			displayName?: string;
		}>;
	};

	expect(context.document.title).toBe(expected.title);
	expect(context.window.__OPENCODE_SERVER_URL).toBe(expected.backendUrl);
	expect(storage.get(defaultServerUrlKey)).toBe(expected.backendUrl);
	expect(
		savedState.list.map((item) => ({
			url: item.http?.url ?? item.url,
			name: item.displayName ?? "",
		})),
	).toEqual([{ url: expected.backendUrl, name: expected.name }]);
}

async function expectFailure(
	env: Record<string, string>,
	expectedMessage: string,
): Promise<void> {
	const fixture = await makeRuntimeRoot();
	const result = await runGenerator(fixture, { env });

	expect(result.exitCode).not.toBe(0);
	expect(result.output).toContain(expectedMessage);
}

afterAll(async () => {
	if (!bundleDir) return;
	await rm(bundleDir, { recursive: true, force: true });
});

describe("generate-nginx-config", () => {
	const hostError =
		"SERVER_1_HOST is required and must be a hostname-only ASCII DNS name. Use Punycode for IDNs.";
	const backendError =
		"SERVER_1_BACKEND is required and must be an absolute http(s) URL.";
	const validHost = "web1.opencode.example.com";
	const validBackend = "http://api1.opencode.example.com";

	const validationCases: ValidationCase[] = [
		{
			name: "missing SERVER_1_HOST and SERVER_1_BACKEND",
			env: {},
			message: "SERVER_1_HOST and SERVER_1_BACKEND are required.",
		},
		{
			name: "legacy URL-only configuration",
			env: { SERVER_1_URL: validBackend },
			message: "SERVER_1_HOST and SERVER_1_BACKEND are required.",
		},
		{
			name: "malformed indexed env names",
			env: { SERVER_1FOO_HOST: "x" },
			message:
				"Configured backend variable names must use unpadded integer indexes starting at 1. Invalid variable: SERVER_1FOO_HOST.",
		},
		{
			name: "padded indexes",
			env: { SERVER_01_HOST: validHost },
			message:
				"Configured backend variable names must use unpadded integer indexes starting at 1. Invalid variable: SERVER_01_HOST.",
		},
		{
			name: "non-contiguous indexes",
			env: {
				SERVER_1_HOST: validHost,
				SERVER_1_BACKEND: validBackend,
				SERVER_3_HOST: "web3.opencode.example.com",
				SERVER_3_BACKEND: "http://api3.opencode.example.com",
			},
			message:
				"Configured backend indexes must be contiguous starting at 1. Missing index 2.",
		},
		{
			name: "missing host",
			env: { SERVER_1_BACKEND: validBackend },
			message: hostError,
		},
		{
			name: "missing backend",
			env: { SERVER_1_HOST: validHost },
			message: backendError,
		},
		{
			name: "host with protocol",
			env: {
				SERVER_1_HOST: `https://${validHost}`,
				SERVER_1_BACKEND: validBackend,
			},
			message: hostError,
		},
		{
			name: "host with port",
			env: {
				SERVER_1_HOST: `${validHost}:8080`,
				SERVER_1_BACKEND: validBackend,
			},
			message: hostError,
		},
		{
			name: "host with path",
			env: {
				SERVER_1_HOST: `${validHost}/app`,
				SERVER_1_BACKEND: validBackend,
			},
			message: hostError,
		},
		{
			name: "wildcard host",
			env: {
				SERVER_1_HOST: "*.opencode.example.com",
				SERVER_1_BACKEND: validBackend,
			},
			message: hostError,
		},
		{
			name: "host with whitespace",
			env: {
				SERVER_1_HOST: "web 1.opencode.example.com",
				SERVER_1_BACKEND: validBackend,
			},
			message: hostError,
		},
		{
			name: "direct unicode IDN host",
			env: {
				SERVER_1_HOST: "t\u00e4st.example.com",
				SERVER_1_BACKEND: validBackend,
			},
			message: hostError,
		},
		{
			name: "duplicate normalized hosts",
			env: {
				SERVER_1_HOST: validHost,
				SERVER_1_BACKEND: validBackend,
				SERVER_2_HOST: validHost,
				SERVER_2_BACKEND: "http://api2.opencode.example.com",
			},
			message:
				"Duplicate configured host after normalization: web1.opencode.example.com",
		},
		{
			name: "case-variant duplicate hosts",
			env: {
				SERVER_1_HOST: "Web1.OpenCode.Example.Com",
				SERVER_1_BACKEND: validBackend,
				SERVER_2_HOST: validHost,
				SERVER_2_BACKEND: "http://api2.opencode.example.com",
			},
			message:
				"Duplicate configured host after normalization: web1.opencode.example.com",
		},
		{
			name: "backend without scheme",
			env: {
				SERVER_1_HOST: validHost,
				SERVER_1_BACKEND: "api1.opencode.example.com",
			},
			message: backendError,
		},
		{
			name: "backend with empty host after scheme",
			env: {
				SERVER_1_HOST: validHost,
				SERVER_1_BACKEND: "http://",
			},
			message: backendError,
		},
	];

	for (const validationCase of validationCases) {
		test(`rejects ${validationCase.name}`, async () => {
			await expectFailure(validationCase.env, validationCase.message);
		});
	}

	test("generates host-specific runtime payloads and nginx server blocks", async () => {
		const fixture = await makeRuntimeRoot();
		const result = await runGenerator(fixture, {
			env: {
				SERVER_1_HOST: "Web1.OpenCode.Example.Com",
				SERVER_1_BACKEND: "HTTPS://API1.OPENCODE.EXAMPLE.COM",
				SERVER_1_NAME: "Server 1",
				SERVER_1_APP_TITLE: "Server 1 Web",
				SERVER_2_HOST: "web2.opencode.example.com",
				SERVER_2_BACKEND: "https://api2.opencode.example.com/",
				SERVER_2_NAME: "Server 2",
				SERVER_2_APP_TITLE: "Server 2 Web",
			},
		});

		assertSuccess(result);
		expect(result.stdout).toBe("");
		expect(result.stderr).toBe("");
		expect(
			await Bun.file(
				fixture.runtimeConfigPath("web1.opencode.example.com"),
			).exists(),
		).toBe(true);
		expect(
			await Bun.file(
				fixture.runtimeConfigPath("web2.opencode.example.com"),
			).exists(),
		).toBe(true);
		expect(
			await Bun.file(
				path.join(fixture.root, "public/runtime-config.js"),
			).exists(),
		).toBe(false);

		const nginxConfig = await readFile(fixture.configPath, "utf8");
		expect(nginxConfig).not.toContain("# OPENCODE_WEB_GENERATED_SERVERS");
		expect(nginxConfig).toContain("listen 8080 default_server;");
		expect(nginxConfig).toContain("listen [::]:8080 default_server;");
		expect(nginxConfig).toContain(
			expectedServerBlock({
				root: fixture.root,
				host: "web1.opencode.example.com",
			}),
		);
		expect(nginxConfig).toContain(
			expectedServerBlock({
				root: fixture.root,
				host: "web2.opencode.example.com",
			}),
		);
		expect(
			countMatches(nginxConfig, /server_name web\d\.opencode\.example\.com;/g),
		).toBe(2);

		evaluateRuntimeConfig(
			await readFile(
				fixture.runtimeConfigPath("web1.opencode.example.com"),
				"utf8",
			),
			{
				title: "Server 1 Web",
				backendUrl: "https://api1.opencode.example.com",
				name: "Server 1",
			},
		);
		evaluateRuntimeConfig(
			await readFile(
				fixture.runtimeConfigPath("web2.opencode.example.com"),
				"utf8",
			),
			{
				title: "Server 2 Web",
				backendUrl: "https://api2.opencode.example.com",
				name: "Server 2",
			},
		);
	});

	for (const normalizationCase of [
		{
			name: "lowercases uppercase scheme and host",
			backend: "HTTPS://API1.OPENCODE.EXAMPLE.COM",
			expected: "https://api1.opencode.example.com",
		},
		{
			name: "preserves URL path case",
			backend: "HTTPS://API.OPENCODE.EXAMPLE.COM/pAtH",
			expected: "https://api.opencode.example.com/pAtH",
		},
		{
			name: "preserves port",
			backend: "HTTP://API.OPENCODE.EXAMPLE.COM:8080",
			expected: "http://api.opencode.example.com:8080",
		},
		{
			name: "removes trailing slash",
			backend: "https://API.OPENCODE.EXAMPLE.COM/path/",
			expected: "https://api.opencode.example.com/path",
		},
	]) {
		test(`normalizes backend URL: ${normalizationCase.name}`, async () => {
			const fixture = await makeRuntimeRoot();
			const result = await runGenerator(fixture, {
				env: {
					SERVER_1_HOST: validHost,
					SERVER_1_BACKEND: normalizationCase.backend,
				},
			});

			assertSuccess(result);
			evaluateRuntimeConfig(
				await readFile(fixture.runtimeConfigPath(validHost), "utf8"),
				{
					title: "OpenCode",
					backendUrl: normalizationCase.expected,
					name: "",
				},
			);
		});
	}

	test("allows duplicate backend URLs across hosts", async () => {
		const fixture = await makeRuntimeRoot();
		const result = await runGenerator(fixture, {
			env: {
				SERVER_1_HOST: validHost,
				SERVER_1_BACKEND: "http://api.opencode.example.com",
				SERVER_2_HOST: "web2.opencode.example.com",
				SERVER_2_BACKEND: "http://api.opencode.example.com/",
			},
		});

		assertSuccess(result);
		evaluateRuntimeConfig(
			await readFile(fixture.runtimeConfigPath(validHost), "utf8"),
			{
				title: "OpenCode",
				backendUrl: "http://api.opencode.example.com",
				name: "",
			},
		);
		evaluateRuntimeConfig(
			await readFile(
				fixture.runtimeConfigPath("web2.opencode.example.com"),
				"utf8",
			),
			{
				title: "OpenCode",
				backendUrl: "http://api.opencode.example.com",
				name: "",
			},
		);
	});

	test("preserves unicode runtime metadata for Punycode hosts", async () => {
		const fixture = await makeRuntimeRoot();
		const result = await runGenerator(fixture, {
			env: {
				SERVER_1_HOST: "xn--tst-qla.example.com",
				SERVER_1_BACKEND: "https://api1.opencode.example.com",
				SERVER_1_NAME: "M\u00fcnchen",
				SERVER_1_APP_TITLE: "\u4f60\u597d OpenCode",
			},
		});

		assertSuccess(result);
		evaluateRuntimeConfig(
			await readFile(
				fixture.runtimeConfigPath("xn--tst-qla.example.com"),
				"utf8",
			),
			{
				title: "\u4f60\u597d OpenCode",
				backendUrl: "https://api1.opencode.example.com",
				name: "M\u00fcnchen",
			},
		);
	});

	test("removes stale runtime configs and remains idempotent", async () => {
		const fixture = await makeRuntimeRoot();
		const stalePath = fixture.runtimeConfigPath("stale");
		const env = {
			SERVER_1_HOST: validHost,
			SERVER_1_BACKEND: validBackend,
			SERVER_2_HOST: "web2.opencode.example.com",
			SERVER_2_BACKEND: "http://api2.opencode.example.com",
		};

		await writeFile(stalePath, "stale");
		assertSuccess(await runGenerator(fixture, { env }));
		expect(await Bun.file(stalePath).exists()).toBe(false);
		assertSuccess(await runGenerator(fixture, { env }));

		const nginxConfig = await readFile(fixture.configPath, "utf8");
		expect(
			countMatches(nginxConfig, /server_name web\d\.opencode\.example\.com;/g),
		).toBe(2);
	});

	test("ignores multiline unrelated env values while scanning backend vars", async () => {
		const fixture = await makeRuntimeRoot();
		const result = await runGenerator(fixture, {
			env: {
				SERVER_1_HOST: validHost,
				SERVER_1_BACKEND: validBackend,
				UNRELATED_MULTILINE: "before\nSERVER_9_HOST\nafter",
			},
		});

		assertSuccess(result);
		expect(await Bun.file(fixture.runtimeConfigPath(validHost)).exists()).toBe(
			true,
		);
	});

	for (const prerequisiteCase of [
		{
			name: "runtime bundle",
			removePath: (fixture: RuntimeRoot) =>
				path.join(fixture.root, "runtime/runtime-bundle.js"),
			message: (fixture: RuntimeRoot) =>
				`Missing runtime bundle at ${path.join(fixture.root, "runtime/runtime-bundle.js")}`,
		},
		{
			name: "nginx config template",
			removePath: (fixture: RuntimeRoot) =>
				path.join(fixture.root, "config/nginx.conf.template"),
			message: (fixture: RuntimeRoot) =>
				`Missing nginx config template at ${path.join(fixture.root, "config/nginx.conf.template")}`,
		},
		{
			name: "public root",
			removePath: (fixture: RuntimeRoot) => path.join(fixture.root, "public"),
			message: (fixture: RuntimeRoot) =>
				`Missing public root at ${path.join(fixture.root, "public")}`,
		},
	]) {
		test(`fails when ${prerequisiteCase.name} is missing`, async () => {
			const fixture = await makeRuntimeRoot();
			await rm(prerequisiteCase.removePath(fixture), {
				recursive: true,
				force: true,
			});
			const result = await runGenerator(fixture, {
				env: { SERVER_1_HOST: validHost, SERVER_1_BACKEND: validBackend },
			});

			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain(prerequisiteCase.message(fixture));
		});
	}

	test("fails when nginx template is missing the generated server marker", async () => {
		const fixture = await makeRuntimeRoot();
		await writeFile(
			path.join(fixture.root, "config/nginx.conf.template"),
			"server {}\n",
		);
		const result = await runGenerator(fixture, {
			env: { SERVER_1_HOST: validHost, SERVER_1_BACKEND: validBackend },
		});

		expect(result.exitCode).not.toBe(0);
		expect(result.output).toContain(
			`Missing nginx server marker in ${path.join(fixture.root, "config/nginx.conf.template")}`,
		);
	});
});
