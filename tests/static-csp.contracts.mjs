const upstreamDefaultCspPattern = /const DEFAULT_CSP\s*=\s*"([^"]+)"/
const staticWebCspPattern = /Content-Security-Policy\s*=\s*"([^"]+)"/

const connectSrcAdditions = ["http:", "https:", "ws:", "wss:"]
const scriptSrcAdditions = ["'unsafe-inline'"]
const extraDirectives = {
  "base-uri": ["'self'"],
  "frame-ancestors": ["'none'"],
  "object-src": ["'none'"],
}

export const staticCspSources = {
  staticWebConfig: "config/sws.toml",
  uiRoutes: "opencode/packages/opencode/src/server/routes/ui.ts",
}

export function extractUpstreamDefaultCsp(source) {
  const match = source.match(upstreamDefaultCspPattern)
  if (!match) throw new Error("Could not locate DEFAULT_CSP in upstream ui.ts")
  return match[1]
}

export function extractStaticWebCsp(source) {
  const match = source.match(staticWebCspPattern)
  if (!match) throw new Error("Could not locate Content-Security-Policy in config/sws.toml")
  return match[1]
}

export function parseCsp(csp) {
  return new Map(
    csp
      .split(";")
      .map((directive) => directive.trim())
      .filter(Boolean)
      .map((directive) => {
        const [name, ...values] = directive.split(/\s+/)
        return [name, values]
      }),
  )
}

function mergeValues(values, additions) {
  return [...values, ...additions.filter((value) => !values.includes(value))]
}

export function buildExpectedStaticWebCsp(upstreamDefaultCsp) {
  const upstream = parseCsp(upstreamDefaultCsp)
  const expected = new Map(upstream.entries())

  expected.set("script-src", mergeValues(expected.get("script-src") ?? [], scriptSrcAdditions))
  expected.set("connect-src", mergeValues(expected.get("connect-src") ?? [], connectSrcAdditions))

  for (const [name, values] of Object.entries(extraDirectives)) {
    if (!expected.has(name)) expected.set(name, values)
  }

  return expected
}

function sameValues(actual, expected) {
  return actual.length === expected.length && [...actual].sort().every((value, index) => value === [...expected].sort()[index])
}

export function sameCsp(actual, expected) {
  const actualKeys = [...actual.keys()].sort()
  const expectedKeys = [...expected.keys()].sort()

  if (!sameValues(actualKeys, expectedKeys)) return false

  return actualKeys.every((key) => sameValues(actual.get(key) ?? [], expected.get(key) ?? []))
}

export function matchesUpstreamStaticCsp(files) {
  return sameCsp(
    parseCsp(extractStaticWebCsp(files.staticWebConfig)),
    buildExpectedStaticWebCsp(extractUpstreamDefaultCsp(files.uiRoutes)),
  )
}

export const staticCspContracts = [
  {
    area: "static-web CSP",
    checks: [
      {
        file: "staticWebConfig",
        message:
          "expected config/sws.toml CSP to match upstream DEFAULT_CSP, plus this wrapper's extra base-uri/frame-ancestors/object-src directives and broader connect-src for external backends",
        test: matchesUpstreamStaticCsp,
      },
    ],
  },
]

export const staticCspFailureHint =
  "Review config/sws.toml against opencode/packages/opencode/src/server/routes/ui.ts before building a new image against this upstream revision."
