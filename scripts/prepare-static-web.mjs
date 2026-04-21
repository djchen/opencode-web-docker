import { cp, readFile, readdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { customizationCss } from "./customization-css.mjs"

const [source, target] = process.argv.slice(2)

if (!source || !target) {
  throw new Error("usage: bun scripts/prepare-static-web.mjs <source-dist> <target-dir>")
}

const runtimeTag = '    <script src="/runtime-config.js"></script>\n'
const customizationTag = `    <style id="opencode-web-customizations">\n${customizationCss}\n    </style>\n`
const htmlPath = path.join(target, "index.html")

await cp(source, target, { recursive: true, force: true })

const html = await readFile(htmlPath, "utf8")
const htmlInjections = []
if (!html.includes("/runtime-config.js")) htmlInjections.push(runtimeTag)
if (!html.includes('id="opencode-web-customizations"')) htmlInjections.push(customizationTag)
if (htmlInjections.length) {
  const updated = html.includes('<script type="module"')
    ? html.replace('<script type="module"', `${htmlInjections.join("")}    <script type="module"`)
    : html.replace("</head>", `${htmlInjections.join("")}</head>`)

  await writeFile(htmlPath, updated)

  if (!updated.includes("/runtime-config.js") || !updated.includes('id="opencode-web-customizations"')) {
    throw new Error(`Failed to inject runtime-config or customization tags into ${htmlPath}`)
  }
}

async function findJsFiles(dir) {
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

const serverUrlPattern = /((?:window\.)?location\.hostname\.includes\("opencode\.ai"\)\s*\?\s*"http:\/\/localhost:4096"\s*:)\s*((?:window\.)?location\.origin)/g

let patched = false
for (const filePath of await findJsFiles(target)) {
  const content = await readFile(filePath, "utf8")
  if (!content.includes("opencode.ai")) continue
  const updated = content.replace(serverUrlPattern, "$1window.__OPENCODE_SERVER_URL||$2")
  if (updated !== content) {
    await writeFile(filePath, updated)
    patched = true
  }
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
