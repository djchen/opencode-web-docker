import { describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	customizationCssFileName,
	injectHtml,
	prepareStaticWeb,
} from "../build/prepare-static-web";
import { makeTempDir } from "./temp-dir";

describe("prepare-static-web", () => {
	test("injectHtml adds runtime-config and customization asset tags before the module script", () => {
		const html = [
			"<html>",
			"  <head>",
			'    <script type="module" src="/assets/app.js"></script>',
			"  </head>",
			"</html>",
		].join("\n");

		const updated = injectHtml(html);

		expect(updated).toContain('<script src="/runtime-config.js"></script>');
		expect(updated).toContain(
			`<link rel="stylesheet" href="/${customizationCssFileName}">`,
		);
		expect(updated.indexOf("/runtime-config.js")).toBeLessThan(
			updated.indexOf('type="module"'),
		);
	});

	test("prepareStaticWeb writes the customization asset without mutating JS assets", async () => {
		const distDir = await makeTempDir("prepare-static-web-dist-");
		await writeFile(
			path.join(distDir, "assets-app.js"),
			"const x=window.location.origin;",
		);

		await writeFile(
			path.join(distDir, "index.html"),
			'<html><head><script type="module" src="/assets-app.js"></script></head><body></body></html>',
		);

		await prepareStaticWeb(distDir);

		const html = await readFile(path.join(distDir, "index.html"), "utf8");
		const css = await readFile(
			path.join(distDir, customizationCssFileName),
			"utf8",
		);
		const js = await readFile(path.join(distDir, "assets-app.js"), "utf8");

		expect(html).toContain("/runtime-config.js");
		expect(html).toContain(`/${customizationCssFileName}`);
		expect(css).toContain('[data-component="sidebar-rail"]');
		expect(js).toBe("const x=window.location.origin;");
	});
});
