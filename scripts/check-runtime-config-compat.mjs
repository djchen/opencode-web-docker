import path from "node:path"
import { fileURLToPath } from "node:url"
import { contracts, failureHints, sources } from "./build-compat/index.mjs"
import { formatFailures, loadSources, runContracts, validateContracts } from "./build-compat/core.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
validateContracts(sources, contracts)
const files = await loadSources(root, sources)
const failures = runContracts(files, contracts)

if (failures.length) {
  throw new Error(
    [
      "OpenCode compatibility check failed.",
      "",
      ...formatFailures(failures),
      ...failureHints,
    ].join("\n"),
  )
}

console.log("OpenCode compatibility check passed")
