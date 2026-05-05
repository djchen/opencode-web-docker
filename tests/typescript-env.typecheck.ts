import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe } from "bun:test";

const typecheckSmoke = {
	bunBuild: Bun.build,
	buffer: Buffer.from("ok"),
	cwd: process.cwd(),
	describe,
	importMetaMain: import.meta.main,
	pathSep: path.sep,
	readFile,
};

void typecheckSmoke;
