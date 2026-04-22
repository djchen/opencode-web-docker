import { cp, readFile, readdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { customizationCss } from "./customization-css.mjs"

export const runtimeTag = '    <script src="/runtime-config.js"></script>\n'
export const customizationTag = `    <style id="opencode-web-customizations">\n${customizationCss}\n    </style>\n`
export const serverUrlPattern = /((?:window\.)?location\.hostname\.includes\("opencode\.ai"\)\s*\?\s*"[^"]+"\s*:)\s*((?:window\.)?location\.origin)/g

export function injectHtml(html) {
  const htmlInjections = []
  if (!html.includes("/runtime-config.js")) htmlInjections.push(runtimeTag)
  if (!html.includes('id="opencode-web-customizations"')) htmlInjections.push(customizationTag)
  if (!htmlInjections.length) return html

  const updated = html.includes('<script type="module"')
    ? html.replace('<script type="module"', `${htmlInjections.join("")}    <script type="module"`)
    : html.replace("</head>", `${htmlInjections.join("")}</head>`)

  if (!updated.includes("/runtime-config.js") || !updated.includes('id="opencode-web-customizations"')) {
    throw new Error("Failed to inject runtime-config or customization tags into built index.html")
  }

  return updated
}

export async function findJsFiles(dir) {
  const files = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await findJsFiles(fullPath))
    } else if (entry.name.endsWith(".js")) {
      files.push(fullPath)
    }
  }
  return files
}

export function patchBuiltJs(content) {
  const updated = content.replace(serverUrlPattern, "$1window.__OPENCODE_SERVER_URL||$2")
  return {
    updated,
    patched: updated !== content,
  }
}

export async function prepareStaticWeb(source, target) {
  if (!source || !target) {
    throw new Error("usage: bun scripts/prepare-static-web.mjs <source-dist> <target-dir>")
  }

  const htmlPath = path.join(target, "index.html")
  await cp(source, target, { recursive: true, force: true })

  const html = await readFile(htmlPath, "utf8")
  const updatedHtml = injectHtml(html)
  if (updatedHtml !== html) await writeFile(htmlPath, updatedHtml)

  let patched = false
  for (const filePath of await findJsFiles(target)) {
    const content = await readFile(filePath, "utf8")
    if (!content.includes("opencode.ai")) continue
    const result = patchBuiltJs(content)
    if (!result.patched) continue
    await writeFile(filePath, result.updated)
    patched = true
  }

  if (!patched) {
    throw new Error(
      [
        "Failed to patch getCurrentUrl fallback in built JS.",
        "The upstream app may have changed its getCurrentUrl implementation.",
        "Review opencode/packages/app/src/entry.tsx and update prepare-static-web.mjs accordingly.",
      ].join("\n"),
    )
  }
}

if (import.meta.main) {
  const [source, target] = process.argv.slice(2)
  await prepareStaticWeb(source, target)
}
