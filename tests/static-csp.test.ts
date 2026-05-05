import { describe, expect, test } from "bun:test";
import {
	buildExpectedStaticWebCsp,
	parseNginxAddHeaders,
} from "./static-csp.contracts";

describe("static CSP compatibility", () => {
	test("adds only deployment-specific directives to upstream CSP", () => {
		const expected = buildExpectedStaticWebCsp(
			"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; media-src 'self' data:; connect-src 'self' data:",
		);

		expect(expected.get("default-src")).toEqual(["'self'"]);
		expect(expected.get("script-src")).toEqual([
			"'self'",
			"'wasm-unsafe-eval'",
			"'unsafe-inline'",
		]);
		expect(expected.get("connect-src")).toEqual([
			"'self'",
			"data:",
			"http:",
			"https:",
			"ws:",
			"wss:",
		]);
		expect(expected.get("base-uri")).toEqual(["'self'"]);
		expect(expected.get("frame-ancestors")).toEqual(["'none'"]);
		expect(expected.get("object-src")).toEqual(["'none'"]);
	});

	test("does not override upstream directives when upstream starts defining them", () => {
		const expected = buildExpectedStaticWebCsp(
			"default-src 'self'; base-uri 'none'; frame-ancestors 'self'; object-src 'self'; connect-src *;",
		);

		expect(expected.get("base-uri")).toEqual(["'none'"]);
		expect(expected.get("frame-ancestors")).toEqual(["'self'"]);
		expect(expected.get("object-src")).toEqual(["'self'"]);
		expect(expected.get("connect-src")).toEqual(["*"]);
	});

	test("parses nginx add_header directives", () => {
		const headers = parseNginxAddHeaders(`
location / {
  add_header Cache-Control "no-store" always;
  add_header Content-Security-Policy "default-src 'self'" always;
}

location ^~ /assets/ {
  add_header Cache-Control "public, max-age=31536000, immutable" always;
}
`);

		expect(headers).toEqual([
			{
				name: "Cache-Control",
				value: "no-store",
			},
			{
				name: "Content-Security-Policy",
				value: "default-src 'self'",
			},
			{
				name: "Cache-Control",
				value: "public, max-age=31536000, immutable",
			},
		]);
	});
});
