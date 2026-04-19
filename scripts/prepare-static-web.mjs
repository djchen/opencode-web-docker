import { cp, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

const [source, target] = process.argv.slice(2)

if (!source || !target) {
  throw new Error("usage: bun scripts/prepare-static-web.mjs <source-dist> <target-dir>")
}

const runtimeTag = '    <script src="/runtime-config.js"></script>\n'
const htmlPath = path.join(target, "index.html")

await cp(source, target, { recursive: true, force: true })

const html = await readFile(htmlPath, "utf8")
if (html.includes('/runtime-config.js')) process.exit(0)

const updated = html.includes('<script type="module"')
  ? html.replace('<script type="module"', `${runtimeTag}    <script type="module"`)
  : html.replace("</head>", `${runtimeTag}</head>`)

await writeFile(htmlPath, updated)

if (!updated.includes("/runtime-config.js")) {
  throw new Error(`Failed to inject runtime-config script tag into ${htmlPath}`)
}
