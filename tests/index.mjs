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

export const sources = {
  ...runtimeConfigSources,
  ...prepareStaticWebSources,
}

export const contracts = [...runtimeConfigContracts, ...prepareStaticWebContracts]

export const failureHints = [runtimeConfigFailureHint, prepareStaticWebFailureHint]
