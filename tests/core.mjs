import { readFile } from "node:fs/promises"
import path from "node:path"

export const match = (file, pattern, message) => ({
  file,
  message,
  test: (files) => pattern.test(files[file]),
})

export const every = (file, patterns, message) => ({
  file,
  message,
  test: (files) => patterns.every((pattern) => pattern.test(files[file])),
})

export async function loadSources(root, sources) {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(sources).map(async ([key, relativePath]) => [
        key,
        await readFile(path.join(root, relativePath), "utf8"),
      ]),
    ),
  )
}

export function validateContracts(sources, contracts) {
  const keys = new Set(Object.keys(sources))
  const unknown = contracts.flatMap((contract) =>
    contract.checks
      .map((check) => check.file)
      .filter((file) => !keys.has(file))
      .map((file) => `${contract.area}: ${file}`),
  )

  if (!unknown.length) return

  throw new Error(
    [
      "Invalid compatibility contracts.",
      ...unknown.map((entry) => `- unknown source key in contract: ${entry}`),
    ].join("\n"),
  )
}

export function runContracts(files, contracts) {
  return contracts.flatMap((contract) => {
    const failures = contract.checks
      .filter((check) => !check.test(files))
      .map((check) => ({
        area: contract.area,
        message: check.message,
      }))

    if (!failures.length) return []
    return failures
  })
}

export function formatFailures(failures, contracts = []) {
  const hintsByArea = new Map(
    contracts.filter((c) => c.hint).map((c) => [c.area, c.hint]),
  )

  const grouped = new Map()

  for (const failure of failures) {
    const list = grouped.get(failure.area) ?? []
    list.push(failure.message)
    grouped.set(failure.area, list)
  }

  return Array.from(grouped.entries()).flatMap(([area, messages]) => {
    const lines = [
      `[${area}]`,
      ...messages.map((message) => `- ${message}`),
    ]
    const hint = hintsByArea.get(area)
    if (hint) lines.push(`  → ${hint}`)
    lines.push("")
    return lines
  })
}
