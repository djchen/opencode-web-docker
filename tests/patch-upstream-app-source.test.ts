import { describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	patchEntrySource,
	patchUpstreamAppSource,
} from "../build/patch-upstream-app-source";
import { makeTempDir } from "./temp-dir";

const patchFailurePattern =
	/build\/patch-upstream-app-source\.ts[\s\S]*getCurrentUrl\(\)[\s\S]*entry\.tsx[\s\S]*return location\.origin/;

function makeEntrySource(fallback: string): string {
	return [
		"const getCurrentUrl = () => {",
		'  if (location.hostname.includes("opencode.ai")) return "http://localhost:4096"',
		"  if (import.meta.env.DEV)",
		'    return "http://localhost:4096"',
		`  ${fallback}`,
		"}",
	].join("\n");
}

describe("patch-upstream-app-source", () => {
	test("patches expected getCurrentUrl source", () => {
		const updated = patchEntrySource(makeEntrySource("return location.origin"));

		expect(updated).toContain(
			"return window.__OPENCODE_SERVER_URL || location.origin",
		);
		expect(updated).not.toContain("  return location.origin");
	});

	test("patches only the final production fallback", () => {
		const updated = patchEntrySource(
			makeEntrySource(
				"if (selfHosted) return location.origin\n  return location.origin",
			),
		);

		expect(updated).toContain("if (selfHosted) return location.origin");
		expect(updated).toContain(
			"return window.__OPENCODE_SERVER_URL || location.origin\n}",
		);
	});

	test("is idempotent when already patched", () => {
		const content = makeEntrySource(
			"return window.__OPENCODE_SERVER_URL || location.origin",
		);

		expect(patchEntrySource(content)).toBe(content);
	});

	test("fails clearly when getCurrentUrl is missing", () => {
		expect(() => patchEntrySource("const x = 1")).toThrow(patchFailurePattern);
	});

	test("fails clearly when production fallback is missing", () => {
		expect(() =>
			patchEntrySource(makeEntrySource('return "http://example.com"')),
		).toThrow(patchFailurePattern);
	});

	test("fails clearly when production fallback expression changed", () => {
		expect(() =>
			patchEntrySource(makeEntrySource('return location.origin + "/api"')),
		).toThrow(patchFailurePattern);
	});

	test("patchUpstreamAppSource accepts a source directory", async () => {
		const sourceDir = await makeTempDir("patch-upstream-app-source-");
		const entryPath = path.join(sourceDir, "entry.tsx");
		await writeFile(entryPath, makeEntrySource("return location.origin"));

		patchUpstreamAppSource(sourceDir);

		expect(await readFile(entryPath, "utf8")).toContain(
			"window.__OPENCODE_SERVER_URL || location.origin",
		);
	});
});
