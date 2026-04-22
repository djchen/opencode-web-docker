import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { injectHtml, patchBuiltJs, prepareStaticWeb } from "../prepare-static-web.mjs"

const tempDirs = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeTempDir(prefix) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

describe("prepare-static-web", () => {
  test("injectHtml adds runtime-config and customization tags before the module script", () => {
    const html = [
      "<html>",
      "  <head>",
      '    <script type="module" src="/assets/app.js"></script>',
      "  </head>",
      "</html>",
    ].join("\n")

    const updated = injectHtml(html)

    expect(updated).toContain('<script src="/runtime-config.js"></script>')
    expect(updated).toContain('id="opencode-web-customizations"')
    expect(updated.indexOf('/runtime-config.js')).toBeLessThan(updated.indexOf('type="module"'))
  })

  test("patchBuiltJs injects runtime bootstrap before location.origin fallback", () => {
    const content = 'const x=location.hostname.includes("opencode.ai")?"http://localhost:9999":location.origin;'
    const result = patchBuiltJs(content)

    expect(result.patched).toBe(true)
    expect(result.updated).toContain('window.__OPENCODE_SERVER_URL||location.origin')
  })

  test("prepareStaticWeb copies assets, injects tags, and patches built JS", async () => {
    const source = await makeTempDir("prepare-static-web-source-")
    const target = await makeTempDir("prepare-static-web-target-")

    await writeFile(
      path.join(source, "index.html"),
      '<html><head><script type="module" src="/assets/app.js"></script></head><body></body></html>',
    )
    await writeFile(
      path.join(source, "app.js"),
      'const x=window.location.hostname.includes("opencode.ai")?"http://localhost:4096":window.location.origin;',
    )

    await prepareStaticWeb(source, target)

    const html = await readFile(path.join(target, "index.html"), "utf8")
    const js = await readFile(path.join(target, "app.js"), "utf8")

    expect(html).toContain('/runtime-config.js')
    expect(html).toContain('id="opencode-web-customizations"')
    expect(js).toContain('window.__OPENCODE_SERVER_URL||window.location.origin')
  })
})
