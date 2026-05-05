import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { buildRuntimeBundle } from "../build/transpile-runtime";
import { initRuntimeConfig } from "../runtime/runtime-config-core";
import type { RuntimeConfigDeps } from "../runtime/types";

const serverStoreKey = "opencode.global.dat:server";
const defaultServerUrlKey = "opencode.settings.dat:defaultServerUrl";

const encodeBase64 = (value: string): string =>
	Buffer.from(value, "utf8").toString("base64");
const emptyServerState = () => ({ list: [], projects: {}, lastProject: {} });
const emptyServerStateRaw = () => JSON.stringify(emptyServerState());

type ConfiguredServer = { url: string; name: string };

function configuredServer(input: { url: string; name?: string }) {
	return {
		url: encodeBase64(input.url),
		name: encodeBase64(input.name ?? ""),
	};
}

function savedServerState(result: ReturnType<typeof runWithDeps>) {
	return JSON.parse(result.storage.get(serverStoreKey)!);
}

function savedServerUrls(result: ReturnType<typeof runWithDeps>): string[] {
	return savedServerState(result).list.map(
		(item: { http?: { url: string }; url?: string }) =>
			item.http?.url ?? item.url,
	);
}

let bundleDir: string | undefined;
let bundledRuntimeSourcePromise: Promise<string> | undefined;

async function loadBundledRuntimeSource(): Promise<string> {
	bundledRuntimeSourcePromise ??= (async () => {
		bundleDir = await mkdtemp(path.join(os.tmpdir(), "runtime-bundle-test-"));
		await buildRuntimeBundle(bundleDir);
		return readFile(path.join(bundleDir, "runtime-bundle.js"), "utf8");
	})();

	return bundledRuntimeSourcePromise;
}

afterAll(async () => {
	if (!bundleDir) return;
	await rm(bundleDir, { recursive: true, force: true });
});

type GlobalMocks = {
	configuredServer: ConfiguredServer;
	appTitle: string;
};

function setupGlobals(mocks: Partial<GlobalMocks>): GlobalMocks {
	const configuredServerValue =
		mocks.configuredServer ??
		configuredServer({ url: "https://api1.opencode.example.com" });
	const appTitle = mocks.appTitle ?? "";

	(globalThis as Record<string, unknown>).configuredServer =
		configuredServerValue;
	(globalThis as Record<string, unknown>).appTitle = appTitle;
	(globalThis as Record<string, unknown>)._b64d = (input: string): string => {
		if (!input) return "";
		const raw = Buffer.from(input, "base64").toString("binary");
		const bytes = new Uint8Array(raw.length);
		for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
		return new TextDecoder().decode(bytes);
	};

	return { configuredServer: configuredServerValue, appTitle };
}

function teardownGlobals() {
	delete (globalThis as Record<string, unknown>).configuredServer;
	delete (globalThis as Record<string, unknown>).appTitle;
	delete (globalThis as Record<string, unknown>)._b64d;
}

function runWithDeps(input: {
	storage?: Record<string, string>;
	appTitle?: string;
	configuredServer?: ConfiguredServer;
}) {
	const storage = new Map(Object.entries(input.storage ?? {}));
	const warnings: unknown[][] = [];
	const setCalls: Array<{ key: string; value: string }> = [];
	const removeCalls: string[] = [];
	const mockWindow: Record<string, unknown> = {};
	const mockDocument = { title: "OpenCode" };

	const deps: RuntimeConfigDeps = {
		localStorage: {
			getItem: (key: string) => (storage.has(key) ? storage.get(key)! : null),
			setItem: (key: string, value: string) => {
				setCalls.push({ key, value });
				storage.set(key, value);
			},
			removeItem: (key: string) => {
				removeCalls.push(key);
				storage.delete(key);
			},
			length: storage.size,
			clear: () => storage.clear(),
			key: (_index: number) => null,
		},
		document: mockDocument as unknown as Document,
		window: mockWindow as unknown as Window & typeof globalThis,
		console: { warn: (...args: unknown[]) => warnings.push(args) },
	};

	setupGlobals({
		configuredServer: input.configuredServer,
		appTitle: input.appTitle ?? "",
	});

	try {
		initRuntimeConfig(deps);
	} finally {
		teardownGlobals();
	}

	return {
		setCalls,
		removeCalls,
		storage,
		warnings,
		document: mockDocument,
		window: mockWindow,
	};
}

async function runBundledRuntimeConfig(input: {
	storage?: Record<string, string>;
	appTitle?: string;
	configuredServer?: ConfiguredServer;
}) {
	const bundleSource = await loadBundledRuntimeSource();
	const storage = new Map(Object.entries(input.storage ?? {}));
	const setCalls: Array<{ key: string; value: string }> = [];
	const warnings: unknown[][] = [];
	const script = [
		"function _b64d(s){try{return decodeURIComponent(escape(atob(s)))}catch(e){return atob(s)}}",
		`var configuredServer = ${JSON.stringify(
			input.configuredServer ??
				configuredServer({ url: "https://api1.opencode.example.com" }),
		)};`,
		`var appTitle = ${JSON.stringify(input.appTitle ?? "")};`,
		bundleSource,
	].join("\n");

	const context = {
		Buffer,
		JSON,
		TextDecoder,
		Uint8Array,
		atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
		console: { warn: (...args: unknown[]) => warnings.push(args) },
		document: { title: "OpenCode" },
		localStorage: {
			getItem: (key: string) => (storage.has(key) ? storage.get(key)! : null),
			setItem: (key: string, value: string) => {
				setCalls.push({ key, value });
				storage.set(key, value);
			},
			removeItem: (key: string) => {
				storage.delete(key);
			},
		},
		window: {},
	};

	vm.runInNewContext(script, context, { timeout: 1000 });

	return {
		setCalls,
		storage,
		warnings,
		document: context.document,
		window: context.window,
	};
}

describe("runtime-config-core", () => {
	test("replaces persisted servers with the runtime server and prunes old metadata", () => {
		const state = {
			list: [
				{
					type: "http",
					http: {
						url: "http://persisted.example.com",
						username: "old-user",
						password: "old-pass",
					},
					displayName: "Persisted",
				},
				{
					type: "http",
					http: { url: "http://frontend.opencode.example.com" },
					displayName: "Frontend",
				},
				{
					type: "http",
					http: { url: "http://custom.example.com" },
					displayName: "Custom",
				},
			],
			projects: {
				"http://persisted.example.com": [{ worktree: "/keep", expanded: true }],
				"http://custom.example.com": [{ worktree: "/drop", expanded: true }],
			},
			lastProject: {
				"http://persisted.example.com": "/keep",
				"http://custom.example.com": "/drop",
			},
		};

		const result = runWithDeps({
			configuredServer: configuredServer({
				url: "http://persisted.example.com",
				name: "Renamed",
			}),
			storage: {
				"server.v3": JSON.stringify({ list: ["http://legacy.example.com"] }),
				[serverStoreKey]: JSON.stringify(state),
			},
		});

		const saved = savedServerState(result);
		expect(saved.projects).toEqual({
			"http://persisted.example.com": [{ worktree: "/keep", expanded: true }],
		});
		expect(saved.lastProject).toEqual({
			"http://persisted.example.com": "/keep",
		});
		expect(savedServerUrls(result)).toEqual(["http://persisted.example.com"]);
		expect(saved.list[0].displayName).toBe("Renamed");
		expect(saved.list[0].http.username).toBeUndefined();
		expect(saved.list[0].http.password).toBeUndefined();
		expect(result.setCalls.map((call) => call.key)).toEqual([
			serverStoreKey,
			defaultServerUrlKey,
		]);
		expect(result.removeCalls).toContain("server.v3");
		expect(result.storage.has("server.v3")).toBe(false);
		expect(result.window.__OPENCODE_SERVER_URL).toBe(
			"http://persisted.example.com",
		);
		expect(result.storage.get(defaultServerUrlKey)).toBe(
			"http://persisted.example.com",
		);
	});

	test("clears stale server fields and preserves local runtime metadata", () => {
		const result = runWithDeps({
			configuredServer: configuredServer({ url: "http://localhost:4096" }),
			storage: {
				[serverStoreKey]: JSON.stringify({
					list: [
						{
							type: "http",
							http: {
								url: "http://localhost:4096",
								username: "old-user",
								password: "old-pass",
							},
							displayName: "Old Local",
						},
					],
					projects: {
						local: [{ worktree: "/keep-local", expanded: true }],
						"http://custom.example.com": [
							{ worktree: "/drop", expanded: true },
						],
					},
					lastProject: {
						local: "/keep-local",
						"http://custom.example.com": "/drop",
					},
				}),
			},
		});

		const saved = savedServerState(result);
		expect(saved.list).toEqual([
			{
				type: "http",
				http: { url: "http://localhost:4096" },
			},
		]);
		expect(saved.projects).toEqual({
			local: [{ worktree: "/keep-local", expanded: true }],
		});
		expect(saved.lastProject).toEqual({ local: "/keep-local" });
	});

	test("skips localStorage writes when the effective config is unchanged", () => {
		const state = {
			list: [
				{
					type: "http",
					http: { url: "https://api1.opencode.example.com" },
					displayName: "Server 1",
				},
			],
			projects: {
				"https://api1.opencode.example.com": [
					{ worktree: "/keep", expanded: true },
				],
			},
			lastProject: { "https://api1.opencode.example.com": "/keep" },
		};

		const result = runWithDeps({
			configuredServer: configuredServer({
				url: "https://api1.opencode.example.com",
				name: "Server 1",
			}),
			storage: {
				[defaultServerUrlKey]: "https://api1.opencode.example.com",
				[serverStoreKey]: JSON.stringify(state),
			},
		});

		expect(result.setCalls).toHaveLength(0);
		expect(result.window.__OPENCODE_SERVER_URL).toBe(
			"https://api1.opencode.example.com",
		);
	});

	test("removes the current origin fallback and forces the injected backend as default", () => {
		const result = runWithDeps({
			configuredServer: configuredServer({
				url: "https://api1.opencode.example.com",
				name: "Server 1",
			}),
			storage: {
				[defaultServerUrlKey]: "http://frontend.opencode.example.com",
				[serverStoreKey]: JSON.stringify({
					list: [
						{
							type: "http",
							http: { url: "http://frontend.opencode.example.com" },
							displayName: "Frontend",
						},
						{
							type: "http",
							http: { url: "http://custom.example.com" },
							displayName: "Custom",
						},
					],
					projects: {},
					lastProject: {},
				}),
			},
		});

		expect(savedServerUrls(result)).toEqual([
			"https://api1.opencode.example.com",
		]);
		expect(result.storage.get(defaultServerUrlKey)).toBe(
			"https://api1.opencode.example.com",
		);
	});

	test("warns and recovers from an incompatible persisted store", () => {
		const result = runWithDeps({
			configuredServer: configuredServer({
				url: "https://api1.opencode.example.com",
				name: "Server 1",
			}),
			storage: {
				[serverStoreKey]: JSON.stringify({
					list: {},
					projects: null,
					lastProject: "broken",
				}),
			},
		});

		const saved = savedServerState(result);
		expect(saved.list).toHaveLength(1);
		expect(saved.projects).toEqual({});
		expect(saved.lastProject).toEqual({});
		expect(result.warnings.length).toBeGreaterThan(0);
	});

	test("warns and recovers from malformed persisted JSON", () => {
		const result = runWithDeps({
			configuredServer: configuredServer({
				url: "https://api1.opencode.example.com",
				name: "Server 1",
			}),
			storage: {
				[serverStoreKey]: "not json",
			},
		});

		expect(savedServerUrls(result)).toEqual([
			"https://api1.opencode.example.com",
		]);
		expect(savedServerState(result).projects).toEqual({});
		expect(result.warnings.length).toBeGreaterThan(0);
	});

	test("sets document.title when appTitle is configured", () => {
		const result = runWithDeps({
			configuredServer: configuredServer({
				url: "https://api1.opencode.example.com",
				name: "Server 1",
			}),
			storage: {
				[serverStoreKey]: emptyServerStateRaw(),
			},
			appTitle: encodeBase64("My Hosted OpenCode"),
		});

		expect(result.document.title).toBe("My Hosted OpenCode");
	});

	for (const testCase of [
		{
			name: "normalizes uppercase scheme and hostname to lowercase",
			inputUrl: "HTTPS://OPENCODE-API1.EXAMPLE.COM",
			expectedUrl: "https://opencode-api1.example.com",
		},
		{
			name: "lowercases scheme and host but preserves path case",
			inputUrl: "HTTPS://OPENCODE-API.EXAMPLE.COM/pAtH",
			expectedUrl: "https://opencode-api.example.com/pAtH",
		},
		{
			name: "preserves port while normalizing scheme and host",
			inputUrl: "HTTPS://OPENCODE-API.EXAMPLE.COM:8080",
			expectedUrl: "https://opencode-api.example.com:8080",
		},
	]) {
		test(testCase.name, () => {
			const result = runWithDeps({
				configuredServer: configuredServer({ url: testCase.inputUrl }),
				storage: {
					[serverStoreKey]: emptyServerStateRaw(),
				},
			});

			expect(savedServerUrls(result)).toEqual([testCase.expectedUrl]);
			expect(result.window.__OPENCODE_SERVER_URL).toBe(testCase.expectedUrl);
		});
	}

	test("bundled runtime artifact executes correctly with unicode metadata", async () => {
		const result = await runBundledRuntimeConfig({
			configuredServer: configuredServer({
				url: "https://api1.opencode.example.com",
				name: "München",
			}),
			appTitle: encodeBase64("你好 OpenCode"),
			storage: {
				[serverStoreKey]: emptyServerStateRaw(),
			},
		});

		const saved = JSON.parse(result.storage.get(serverStoreKey)!);

		expect(result.document.title).toBe("你好 OpenCode");
		expect(
			(result.window as { __OPENCODE_SERVER_URL?: string })
				.__OPENCODE_SERVER_URL,
		).toBe("https://api1.opencode.example.com");
		expect(result.storage.get(defaultServerUrlKey)).toBe(
			"https://api1.opencode.example.com",
		);
		expect(
			saved.list.map((item: { http: { url: string } }) => item.http.url),
		).toEqual(["https://api1.opencode.example.com"]);
		expect(saved.list[0].displayName).toBe("München");
	});
});
