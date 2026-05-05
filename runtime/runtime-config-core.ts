import type { RuntimeConfigDeps, ServerListItem, ServerState } from "./types";

const defaultServerUrlKey = "opencode.settings.dat:defaultServerUrl";
const serverStoreKey = "opencode.global.dat:server";
const legacyServerStoreKey = "server.v3";

function warnIncompatibleStore(deps: RuntimeConfigDeps, reason: string) {
	deps.console.warn(
		"OpenCode runtime-config may be incompatible with this upstream build:",
		reason,
		"Review runtime/generate-nginx-config.sh and runtime/runtime-config-core.ts against upstream app persistence.",
	);
}

function normalizeUrl(input: unknown): string {
	if (typeof input !== "string") return "";
	const trimmed = input.trim();
	if (!trimmed) return "";
	const withProtocol = /^https?:\/\//i.test(trimmed)
		? trimmed
		: `http://${trimmed}`;
	try {
		const parsed = new URL(withProtocol);
		parsed.protocol = parsed.protocol.toLowerCase();
		parsed.hostname = parsed.hostname.toLowerCase();
		parsed.pathname = parsed.pathname.replace(/\/+$/, "");
		return parsed.toString().replace(/\/+$/, "");
	} catch {
		return withProtocol.replace(/\/+$/, "");
	}
}

function readState(deps: RuntimeConfigDeps): {
	raw: string | null;
	state: ServerState;
} {
	const raw = deps.localStorage.getItem(serverStoreKey);
	const empty: ServerState = { list: [], projects: {}, lastProject: {} };

	try {
		const parsed = JSON.parse(raw || "null") as ServerState | null;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			if (parsed !== null)
				warnIncompatibleStore(deps, "server store is not an object");
			return { raw, state: empty };
		}

		if (!Array.isArray(parsed.list)) {
			warnIncompatibleStore(deps, "server store list is not an array");
			parsed.list = [];
		}
		if (!parsed.projects || typeof parsed.projects !== "object") {
			warnIncompatibleStore(deps, "server store projects is not an object");
			parsed.projects = {};
		}
		if (!parsed.lastProject || typeof parsed.lastProject !== "object") {
			warnIncompatibleStore(deps, "server store lastProject is not an object");
			parsed.lastProject = {};
		}

		return { raw, state: parsed };
	} catch {
		warnIncompatibleStore(deps, "failed to parse persisted server store JSON");
		return { raw, state: { ...empty } };
	}
}

function isLocalHost(url: string) {
	const host = url.replace(/^https?:\/\//, "").split(":")[0];
	if (host === "localhost" || host === "127.0.0.1") return true;
}

function projectsKey(key: string) {
	if (!key) return "";
	if (key === "sidecar") return "local";
	if (isLocalHost(key)) return "local";
	return key;
}

function keepRuntimeMetadata<T>(values: Record<string, T>, runtimeKey: string) {
	const key = projectsKey(runtimeKey);
	if (!key || !(key in values)) return {};
	return { [key]: values[key]! };
}

function buildRuntimeServer() {
	const serverUrl = normalizeUrl(_b64d(configuredServer.url));
	const serverName = _b64d(configuredServer.name).trim();
	const server: ServerListItem = {
		type: "http",
		http: { url: serverUrl },
	};

	if (serverName) server.displayName = serverName;

	return server;
}

export function initRuntimeConfig(deps?: Partial<RuntimeConfigDeps>): void {
	const d: RuntimeConfigDeps = {
		localStorage: deps?.localStorage ?? localStorage,
		document: deps?.document ?? document,
		window: deps?.window ?? (window as Window & typeof globalThis),
		console: deps?.console ?? console,
	};

	try {
		const nextTitle = _b64d(appTitle).trim();
		if (nextTitle) {
			d.document.title = nextTitle;
		}

		const persisted = readState(d);
		const state = persisted.state;
		const runtimeServer = buildRuntimeServer();
		const persistedDefaultRaw =
			d.localStorage.getItem(defaultServerUrlKey) || "";
		const bootstrapUrl = runtimeServer.http!.url;

		const nextState: ServerState = {
			list: [runtimeServer],
			projects: keepRuntimeMetadata(state.projects, bootstrapUrl),
			lastProject: keepRuntimeMetadata(state.lastProject, bootstrapUrl),
		};
		const nextStateRaw = JSON.stringify(nextState);

		d.window.__OPENCODE_SERVER_URL = bootstrapUrl;

		if (persisted.raw !== nextStateRaw) {
			d.localStorage.setItem(serverStoreKey, nextStateRaw);
		}

		if (persistedDefaultRaw !== bootstrapUrl) {
			d.localStorage.setItem(defaultServerUrlKey, bootstrapUrl);
		}

		d.localStorage.removeItem(legacyServerStoreKey);
	} catch (error) {
		d.console.warn("Failed to apply OpenCode runtime config", error);
	}
}
