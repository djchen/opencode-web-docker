import { describe, expect, test } from "bun:test"
import { every, formatFailures, match, runContracts, validateContracts } from "./core.mjs"

describe("runtime-config compatibility helpers", () => {
  test("runContracts returns grouped failure entries", () => {
    const contracts = [
      {
        area: "example area",
        checks: [
          match("entry", /keep me/, "expected entry marker"),
          every("server", [/first/, /second/], "expected server markers"),
        ],
      },
    ]

    const failures = runContracts(
      {
        entry: "missing",
        server: "first only",
      },
      contracts,
    )

    expect(failures).toEqual([
      { area: "example area", message: "expected entry marker" },
      { area: "example area", message: "expected server markers" },
    ])
  })

  test("formatFailures groups messages by area", () => {
    expect(
      formatFailures([
        { area: "patch A", message: "first failure" },
        { area: "patch A", message: "second failure" },
        { area: "patch B", message: "third failure" },
      ]),
    ).toEqual([
      "[patch A]",
      "- first failure",
      "- second failure",
      "",
      "[patch B]",
      "- third failure",
      "",
    ])
  })

  test("validateContracts rejects unknown source keys", () => {
    expect(() =>
      validateContracts(
        { entry: "path" },
        [{ area: "patch", checks: [match("missing", /x/, "expected marker")] }],
      ),
    ).toThrow("unknown source key in contract: patch: missing")
  })
})
