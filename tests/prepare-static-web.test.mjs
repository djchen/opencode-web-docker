import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import {
  customizationCssFileName,
  getReferencedJsPaths,
  injectHtml,
  patchBuiltJs,
  prepareStaticWeb,
} from "../build/prepare-static-web.mjs"

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
  test("injectHtml adds runtime-config and customization asset tags before the module script", () => {
    const html = [
      "<html>",
      "  <head>",
      '    <script type="module" src="/assets/app.js"></script>',
      "  </head>",
      "</html>",
    ].join("\n")

    const updated = injectHtml(html)

    expect(updated).toContain('<script src="/runtime-config.js"></script>')
    expect(updated).toContain(`<link rel="stylesheet" href="/${customizationCssFileName}">`)
    expect(updated.indexOf('/runtime-config.js')).toBeLessThan(updated.indexOf('/assets/app.js'))
  })

  test("patchBuiltJs injects runtime bootstrap before location.origin fallback", () => {
    const content = 'const x=location.hostname.includes("opencode.ai")?"http://localhost:9999":location.origin;'
    const result = patchBuiltJs(content)

    expect(result.patched).toBe(true)
    expect(result.updated).toContain('window.__OPENCODE_SERVER_URL||location.origin')
    expect(result.serverUrlPatched).toBe(true)
  })

  test("patchBuiltJs treats already-patched runtime hooks as satisfied without rewriting", () => {
    const content = 'const x=location.hostname.includes("opencode.ai")?"http://localhost:9999":window.__OPENCODE_SERVER_URL||location.origin;'
    const result = patchBuiltJs(content)

    expect(result.patched).toBe(false)
    expect(result.serverUrlPatched).toBe(true)
    expect(result.updated).toBe(content)
  })

  test("getReferencedJsPaths returns only local JS assets from index.html", () => {
    const html = [
      '<link rel="modulepreload" href="/assets/chunk-1.js?x=1">',
      '<script type="module" src="./assets/app.js"></script>',
      '<script src="https://cdn.example.com/remote.js"></script>',
    ].join("\n")

    expect(getReferencedJsPaths(html)).toEqual(["/assets/chunk-1.js", "./assets/app.js"])
  })

  test("prepareStaticWeb writes the customization asset and patches only referenced JS assets in place", async () => {
    const distDir = await makeTempDir("prepare-static-web-dist-")
    await writeFile(
      path.join(distDir, "assets-app.js"),
      'const x=window.location.hostname.includes("opencode.ai")?"http://localhost:4096":window.location.origin;',
    )
    await writeFile(path.join(distDir, "unused.js"), 'return{ready:p,healthy:u,isLocal:S,setActive:h,add:f,remove:m}')

    await writeFile(
      path.join(distDir, "index.html"),
      '<html><head><script type="module" src="/assets-app.js"></script></head><body></body></html>',
    )

    await prepareStaticWeb(distDir)

    const html = await readFile(path.join(distDir, "index.html"), "utf8")
    const css = await readFile(path.join(distDir, customizationCssFileName), "utf8")
    const js = await readFile(path.join(distDir, "assets-app.js"), "utf8")
    const untouched = await readFile(path.join(distDir, "unused.js"), "utf8")

    expect(html).toContain('/runtime-config.js')
    expect(html).toContain(`/${customizationCssFileName}`)
    expect(css).toContain('[data-component="sidebar-rail"]')
    expect(js).toContain('window.__OPENCODE_SERVER_URL||window.location.origin')
    expect(untouched).not.toContain('window.__OPENCODE_SERVER_URL')
  })

  test("prepareStaticWeb can rerun on an already-patched dist", async () => {
    const distDir = await makeTempDir("prepare-static-web-rerun-")
    await writeFile(
      path.join(distDir, "assets-app.js"),
      'const x=window.location.hostname.includes("opencode.ai")?"http://localhost:4096":window.location.origin;',
    )
    await writeFile(
      path.join(distDir, "index.html"),
      '<html><head><script type="module" src="/assets-app.js"></script></head><body></body></html>',
    )

    await prepareStaticWeb(distDir)
    const once = await readFile(path.join(distDir, "assets-app.js"), "utf8")

    await prepareStaticWeb(distDir)
    const twice = await readFile(path.join(distDir, "assets-app.js"), "utf8")

    expect(twice).toBe(once)
  })
})