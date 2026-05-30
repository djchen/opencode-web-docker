import path from "node:path";
import { customizationCss } from "./customization-css";

const runtimeTag = '<script src="/runtime-config.js"></script>\n';
export const customizationCssFileName = "opencode-web-customizations.css";
const customizationTag = `<link rel="stylesheet" href="/${customizationCssFileName}">\n`;

export function injectHtml(html: string): string {
	const htmlInjections: string[] = [];
	if (!html.includes("/runtime-config.js")) htmlInjections.push(runtimeTag);
	if (!html.includes(`/${customizationCssFileName}`))
		htmlInjections.push(customizationTag);
	if (!htmlInjections.length) return html;

	const updated = html.includes('<script type="module"')
		? html.replace(
				'<script type="module"',
				`${htmlInjections.join("")}    <script type="module"`,
			)
		: html.replace("</head>", `${htmlInjections.join("")}</head>`);

	if (
		!updated.includes("/runtime-config.js") ||
		!updated.includes(`/${customizationCssFileName}`)
	) {
		throw new Error(
			"Failed to inject runtime-config or customization asset tags into built index.html",
		);
	}

	return updated;
}

export async function prepareStaticWeb(distDir: string): Promise<void> {
	if (!distDir) {
		throw new Error("usage: bun build/prepare-static-web.ts <dist-dir>");
	}

	const htmlPath = path.join(distDir, "index.html");
	const customizationCssPath = path.join(distDir, customizationCssFileName);
	const html = await Bun.file(htmlPath).text();
	const updatedHtml = injectHtml(html);
	await Bun.write(customizationCssPath, `${customizationCss}\n`);
	if (updatedHtml !== html) await Bun.write(htmlPath, updatedHtml);
}

if (import.meta.main) {
	const [distDir] = process.argv.slice(2);
	if (!distDir) {
		throw new Error("usage: bun build/prepare-static-web.ts <dist-dir>");
	}
	await prepareStaticWeb(distDir);
}
