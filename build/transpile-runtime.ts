const result = await Bun.build({
  entrypoints: ["runtime/index.ts"],
  outdir: "dist/runtime",
  target: "browser",
  format: "iife",
  naming: "runtime-bundle.js",
})

if (!result.success) {
  console.error("Runtime bundle build failed:")
  for (const log of result.logs) {
    console.error(log)
  }
  process.exit(1)
}

console.log(`Runtime bundle written to dist/runtime/runtime-bundle.js (${result.outputs[0]?.size} bytes)`)
