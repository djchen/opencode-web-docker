import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { customizationCss } from "./customization-css"

export const runtimeTag = '    <script src="/runtime-config.js"></script>\n'
export const customizationCssFileName = "opencode-web-customizations.css"
export const customizationTag = `    <link rel="stylesheet" href="/${customizationCssFileName}">\n`
export const serverUrlPattern =
  /((?:window\.)?location\.hostname\.includes\("opencode\.ai"\)\s*\?\s*"[^"]+"\s*:)\s*((?:window\.)?location\.origin)/g
export const referencedJsPattern =
  /<(?:script|link)\b[^>]+(?:src|href)=["']([^"']+\.js(?:\?[^"'#]*)?(?:#[^"']*)?)["'][^>]*>/g
export const serverUrlPatchedMarkers = [
  "window.__OPENCODE_SERVER_URL||location.origin",
  "window.__OPENCODE_SERVER_URL||window.location.origin",
]

export function injectHtml(html: string): string {
  const htmlInjections: string[] = []
  if (!html.includes("/runtime-config.js")) htmlInjections.push(runtimeTag)
  if (!html.includes(`/${customizationCssFileName}`)) htmlInjections.push(customizationTag)
  if (!htmlInjections.length) return html

  const updated = html.includes('<script type="module"')
    ? html.replace('<script type="module"', `${htmlInjections.join("")}    <script type="module"`)
    : html.replace("</head>", `${htmlInjections.join("")}</head>`)

  if (!updated.includes("/runtime-config.js") || !updated.includes(`/${customizationCssFileName}`)) {
    throw new Error("Failed to inject runtime-config or customization asset tags into built index.html")
  }

  return updated
}

export function getReferencedJsPaths(html: string): string[] {
  const referencedJsPaths = new Set<string>()

  for (const match of html.matchAll(referencedJsPattern)) {
    const assetPath = match[1]!.split("#", 1)[0]!.split("?", 1)[0]!
    if (/^(?:https?:)?\/\//.test(assetPath)) continue
    if (assetPath === "/runtime-config.js" || assetPath === "runtime-config.js") continue
    referencedJsPaths.add(assetPath)
  }

  return [...referencedJsPaths]
}

export interface PatchResult {
  updated: string
  patched: boolean
  serverUrlPatched: boolean
}

export function patchBuiltJs(content: string): PatchResult {
  let updated = content
  let serverUrlPatched = serverUrlPatchedMarkers.some((marker) => updated.includes(marker))

  if (!serverUrlPatched) {
    updated = updated.replace(serverUrlPattern, "$1window.__OPENCODE_SERVER_URL||$2")
    serverUrlPatched = updated !== content
  }

  return {
    updated,
    patched: updated !== content,
    serverUrlPatched,
  }
}

function resolveAssetPath(rootDir: string, assetPath: string): string {
  if (assetPath.startsWith("/")) return path.join(rootDir, assetPath.slice(1))
  return path.resolve(rootDir, assetPath)
}

export async function prepareStaticWeb(distDir: string): Promise<void> {
  if (!distDir) {
    throw new Error("usage: bun build/prepare-static-web.ts <dist-dir>")
  }

  const htmlPath = path.join(distDir, "index.html")
  const customizationCssPath = path.join(distDir, customizationCssFileName)
  const html = await readFile(htmlPath, "utf8")
  const updatedHtml = injectHtml(html)
  await writeFile(customizationCssPath, `${customizationCss}\n`)
  if (updatedHtml !== html) await writeFile(htmlPath, updatedHtml)

  let serverUrlPatched = false
  for (const assetPath of getReferencedJsPaths(updatedHtml)) {
    const filePath = resolveAssetPath(distDir, assetPath)
    const content = await readFile(filePath, "utf8")
    const result = patchBuiltJs(content)
    if (result.serverUrlPatched) serverUrlPatched = true
    if (!result.patched) continue
    await writeFile(filePath, result.updated)
  }

  if (!serverUrlPatched) {
    throw new Error(
      [
        "Failed to patch getCurrentUrl fallback in built JS.",
        "The upstream app may have changed its runtime-sensitive implementation.",
        "Review opencode/packages/app/src/entry.tsx and update prepare-static-web.ts accordingly.",
      ].join("\n"),
    )
  }
}

if (import.meta.main) {
  const distDir = process.argv[2]
  if (!distDir) {
    throw new Error("usage: bun build/prepare-static-web.ts <dist-dir>")
  }
  await prepareStaticWeb(distDir)
}
