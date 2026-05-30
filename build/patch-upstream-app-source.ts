import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const pristineFallbackPattern =
	/\n([ \t]*)return\s+location\.origin\s*;?[ \t]*(\n\})$/;
const patchedFallbackPattern =
	/\n([ \t]*)return\s+window\.__OPENCODE_SERVER_URL\s*\|\|\s*location\.origin\s*;?[ \t]*(\n\})$/;
const getCurrentUrlPattern =
	/const\s+getCurrentUrl\s*=\s*\(\)\s*=>\s*\{[\s\S]*?\n\}/g;
const patchedFallback =
	"return window.__OPENCODE_SERVER_URL || location.origin";

export function patchEntrySource(content: string): string {
	const matches = [...content.matchAll(getCurrentUrlPattern)];
	if (matches.length !== 1)
		throwPatchError("missing or ambiguous getCurrentUrl()");

	const match = matches[0]!;
	const getCurrentUrlSource = match[0];
	if (patchedFallbackPattern.test(getCurrentUrlSource)) {
		return content;
	}
	if (!pristineFallbackPattern.test(getCurrentUrlSource)) {
		throwPatchError("missing production fallback");
	}
	const start = match.index!;

	return `${content.slice(0, start)}${getCurrentUrlSource.replace(
		pristineFallbackPattern,
		(_fallback, indent: string, close: string) =>
			`\n${indent}${patchedFallback}${close}`,
	)}${content.slice(start + getCurrentUrlSource.length)}`;
}

export function patchUpstreamAppSource(appSourceDir: string): void {
	if (!appSourceDir) {
		throw new Error(
			"usage: bun ./build/patch-upstream-app-source.ts <app-src-dir>",
		);
	}

	const entryPath = path.join(path.resolve(appSourceDir), "entry.tsx");
	const content = readFileSync(entryPath, "utf8");
	const updated = patchEntrySource(content);
	if (updated !== content) writeFileSync(entryPath, updated);
}

function throwPatchError(reason: string): never {
	throw new Error(
		[
			`build/patch-upstream-app-source.ts failed to patch getCurrentUrl() in entry.tsx: ${reason}.`,
			"Expected the final production fallback to be `return location.origin` or `return window.__OPENCODE_SERVER_URL || location.origin`.",
			"Update build/patch-upstream-app-source.ts if upstream changed this source shape.",
		].join("\n"),
	);
}

if (import.meta.main) {
	const [appSourceDir] = process.argv.slice(2);
	patchUpstreamAppSource(appSourceDir ?? "");
}
