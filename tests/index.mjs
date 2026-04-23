import {
  prepareStaticWebContracts,
  prepareStaticWebFailureHint,
  prepareStaticWebSources,
} from "./prepare-static-web.contracts.mjs"
import {
  runtimeConfigContracts,
  runtimeConfigFailureHint,
  runtimeConfigSources,
} from "./runtime-config.contracts.mjs"
import {
  staticCspContracts,
  staticCspFailureHint,
  staticCspSources,
} from "./static-csp.contracts.mjs"

export const sources = {
  ...runtimeConfigSources,
  ...prepareStaticWebSources,
  ...staticCspSources,
}

export const contracts = [...runtimeConfigContracts, ...prepareStaticWebContracts, ...staticCspContracts]

export const failureHints = [runtimeConfigFailureHint, prepareStaticWebFailureHint, staticCspFailureHint]
