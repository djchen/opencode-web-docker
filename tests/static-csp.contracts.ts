import { match } from "./core";
import type { Contract } from "./core";

const upstreamDefaultCspPattern = /const DEFAULT_CSP\s*=\s*"([^"]+)"/;
const upstreamCspFunctionPattern =
	/export const csp = \(hash = ""\) =>\s*\n\s*`(.+)`\s*\nexport const DEFAULT_CSP = csp\(\)/;
const emptyHashInterpolationPattern = /\$\{hash \? `[^`]+` : ""\}/g;
const addHeaderPattern = /add_header\s+([A-Za-z-]+)\s+"([^"]*)"\s+always;/g;
const noStoreCacheControl = "no-store, no-cache, must-revalidate";
const immutableCacheControl = "public, max-age=31536000, immutable";

export interface NginxHeader {
	name: string;
	value: string;
}

export function parseNginxAddHeaders(source: string): NginxHeader[] {
	return [...source.matchAll(addHeaderPattern)].map((match) => ({
		name: match[1]!,
		value: match[2]!,
	}));
}

function hasHeader(
	source: string,
	headerName: string,
	expected: string,
): boolean {
	return parseNginxAddHeaders(source).some(
		(header) => header.name === headerName && header.value === expected,
	);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const connectSrcAdditions = ["http:", "https:", "ws:", "wss:"];
const scriptSrcAdditions = ["'unsafe-inline'"];
const extraDirectives: Record<string, string[]> = {
	"base-uri": ["'self'"],
	"frame-ancestors": ["'none'"],
	"object-src": ["'none'"],
};

export const staticCspSources: Record<string, string> = {
	nginxConfigTemplate: "config/nginx.conf.template",
	runtimeGenerator: "runtime/generate-nginx-config.sh",
	uiShared: "opencode/packages/opencode/src/server/shared/ui.ts",
};

function extractUpstreamDefaultCsp(source: string): string {
	const cspMatch = source.match(upstreamDefaultCspPattern);
	if (cspMatch) return cspMatch[1]!;

	const cspFunctionMatch = source.match(upstreamCspFunctionPattern);
	if (cspFunctionMatch)
		return cspFunctionMatch[1]!.replace(emptyHashInterpolationPattern, "");

	throw new Error("Could not locate DEFAULT_CSP in upstream ui.ts");
}

function extractNginxCsp(source: string): string {
	const csp = parseNginxAddHeaders(source).find(
		(header) => header.name === "Content-Security-Policy",
	)?.value;
	if (!csp)
		throw new Error(
			"Could not locate Content-Security-Policy add_header in nginx config",
		);
	return csp;
}

function extractNginxCsps(source: string): string[] {
	const csps = parseNginxAddHeaders(source)
		.filter((header) => header.name === "Content-Security-Policy")
		.map((header) => header.value);
	if (csps.length === 0)
		throw new Error(
			"Could not locate Content-Security-Policy add_header in nginx config",
		);
	return csps;
}

function parseCsp(csp: string): Map<string, string[]> {
	return new Map(
		csp
			.split(";")
			.map((directive) => directive.trim())
			.filter(Boolean)
			.map((directive) => {
				const [name, ...values] = directive.split(/\s+/);
				return [name!, values] as const;
			}),
	);
}

function mergeValues(values: string[], additions: string[]): string[] {
	if (values.includes("*")) return values;
	return [...values, ...additions.filter((value) => !values.includes(value))];
}

export function buildExpectedStaticWebCsp(
	upstreamDefaultCsp: string,
): Map<string, string[]> {
	const upstream = parseCsp(upstreamDefaultCsp);
	const expected = new Map(upstream.entries());

	expected.set(
		"script-src",
		mergeValues(expected.get("script-src") ?? [], scriptSrcAdditions),
	);
	expected.set(
		"connect-src",
		mergeValues(expected.get("connect-src") ?? [], connectSrcAdditions),
	);

	for (const [name, values] of Object.entries(extraDirectives)) {
		if (!expected.has(name)) expected.set(name, values);
	}

	return expected;
}

function sameValues(actual: string[], expected: string[]): boolean {
	return (
		actual.length === expected.length &&
		[...actual]
			.sort()
			.every((value, index) => value === [...expected].sort()[index])
	);
}

function sameCsp(
	actual: Map<string, string[]>,
	expected: Map<string, string[]>,
): boolean {
	const actualKeys = [...actual.keys()].sort();
	const expectedKeys = [...expected.keys()].sort();

	if (!sameValues(actualKeys, expectedKeys)) return false;

	return actualKeys.every((key) =>
		sameValues(actual.get(key) ?? [], expected.get(key) ?? []),
	);
}

export function matchesUpstreamStaticCsp(
	files: Record<string, string>,
): boolean {
	return sameCsp(
		parseCsp(extractNginxCsp(files["nginxConfigTemplate"]!)),
		buildExpectedStaticWebCsp(extractUpstreamDefaultCsp(files["uiShared"]!)),
	);
}

function generatorCspMatchesTemplate(files: Record<string, string>): boolean {
	const templateCsp = extractNginxCsp(files["nginxConfigTemplate"]!);
	return extractNginxCsps(files["runtimeGenerator"]!).every(
		(csp) => csp === templateCsp,
	);
}

function assetLocationUsesImmutableCache(
	files: Record<string, string>,
): boolean {
	const source = files["runtimeGenerator"]!;
	const helperPattern = new RegExp(
		String.raw`write_asset_headers\(\) \{[\s\S]*add_header Cache-Control "${escapeRegExp(immutableCacheControl)}" always;`,
	);
	const assetLocationPattern =
		/location \^~ \/assets\/ \{[\s\S]*\$\(write_asset_headers\)[\s\S]*try_files \\\$uri =404;/;
	return helperPattern.test(source) && assetLocationPattern.test(source);
}

export const staticCspContracts: Contract[] = [
	{
		area: "nginx CSP",
		hint: "If upstream changed its DEFAULT_CSP directives, update config/nginx.conf.template and the generated nginx server blocks to match (plus the wrapper's additions); if the wrapper's extra directives changed intent, update the contract expectations.",
		checks: [
			{
				file: "nginxConfigTemplate",
				message:
					"expected config/nginx.conf.template CSP to match upstream DEFAULT_CSP, plus this wrapper's extra base-uri/frame-ancestors/object-src directives and broader connect-src for external backends",
				test: matchesUpstreamStaticCsp,
			},
			{
				file: "runtimeGenerator",
				message:
					"expected generated nginx server blocks to use the same CSP as config/nginx.conf.template",
				test: generatorCspMatchesTemplate,
			},
		],
	},
	{
		area: "nginx routing",
		hint: "The committed template must keep an unmatched-host default server with /health returning 200 and all other requests returning 404. Configured hosts are appended at the marker by runtime/generate-nginx-config.sh.",
		checks: [
			match(
				"nginxConfigTemplate",
				/listen 80 default_server;/,
				"expected nginx default server to listen on IPv4 port 80",
			),
			match(
				"nginxConfigTemplate",
				/listen \[::\]:80 default_server;/,
				"expected nginx default server to listen on IPv6 port 80",
			),
			match(
				"nginxConfigTemplate",
				/location = \/health \{[\s\S]*return 200/,
				"expected /health to return HTTP 200",
			),
			match(
				"nginxConfigTemplate",
				/location \/ \{[\s\S]*return 404;/,
				"expected unmatched hosts to return 404",
			),
			match(
				"nginxConfigTemplate",
				/^# OPENCODE_WEB_GENERATED_SERVERS$/m,
				"expected nginx template to contain generated server marker",
			),
			match(
				"runtimeGenerator",
				/server_name \$host;/,
				"expected generator to emit one exact-host nginx server block",
			),
			match(
				"runtimeGenerator",
				/alias \/opt\/opencode-web\/runtime-configs\/\$host\.js;/,
				"expected generated /runtime-config.js to alias the per-host runtime config",
			),
			match(
				"runtimeGenerator",
				/location ~ \\\\\.\[\^\/\]\+\$ \{[\s\S]*try_files \\\$uri =404;/,
				"expected extension-like static paths to 404 when missing",
			),
			match(
				"runtimeGenerator",
				/location \/ \{[\s\S]*try_files \\\$uri \\\$uri\/ \/index\.html;/,
				"expected route-like extensionless paths to fall back to the SPA shell",
			),
		],
	},
	{
		area: "nginx cache headers",
		hint: "Only /assets/ should use immutable caching. All other configured-host responses should use no-store, and all nginx add_header directives must include always so 404s retain CSP/cache headers.",
		checks: [
			{
				file: "runtimeGenerator",
				message: `expected generated nginx server blocks to set Cache-Control "${noStoreCacheControl}"`,
				test: (files) =>
					hasHeader(
						files["runtimeGenerator"]!,
						"Cache-Control",
						noStoreCacheControl,
					),
			},
			{
				file: "runtimeGenerator",
				message: `expected generated /assets/ location to set Cache-Control "${immutableCacheControl}"`,
				test: (files) =>
					hasHeader(
						files["runtimeGenerator"]!,
						"Cache-Control",
						immutableCacheControl,
					),
			},
			{
				file: "runtimeGenerator",
				message:
					"expected only the /assets/ nginx location to use immutable cache headers",
				test: assetLocationUsesImmutableCache,
			},
			match(
				"runtimeGenerator",
				/add_header Content-Security-Policy "[^"]+" always;/,
				"expected nginx CSP headers to be emitted with always",
			),
		],
	},
];
