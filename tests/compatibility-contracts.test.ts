import { describe, expect, test } from "bun:test";
import path from "node:path";
import { contracts, sources } from "./index";
import {
	formatFailures,
	loadSources,
	runContracts,
	validateContracts,
} from "./core";

const root = path.resolve(import.meta.dir, "..");

describe("upstream compatibility contracts", () => {
	test("repo patches still match the checked-out upstream sources", async () => {
		validateContracts(sources, contracts);
		const files = await loadSources(root, sources);
		const failures = runContracts(files, contracts);

		expect(failures, formatFailures(failures, contracts).join("\n")).toEqual(
			[],
		);
	});
});
