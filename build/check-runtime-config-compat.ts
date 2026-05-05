import path from "node:path";
import { contracts, sources } from "../tests/index";
import {
	formatFailures,
	loadSources,
	runContracts,
	validateContracts,
} from "../tests/core";

const root = path.resolve(import.meta.dir, "..");
validateContracts(sources, contracts);
const files = await loadSources(root, sources);
const failures = runContracts(files, contracts);

if (failures.length) {
	throw new Error(
		[
			"OpenCode compatibility check failed.",
			"",
			...formatFailures(failures, contracts),
		].join("\n"),
	);
}

console.log("OpenCode compatibility check passed");
