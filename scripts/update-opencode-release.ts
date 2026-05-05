#!/usr/bin/env bun
import { $ } from "bun";

const usage = `usage: bun run upstream:update [--dry-run] [tag]

Updates the opencode submodule to the latest v[0-9]* release tag, or to a
specific tag when provided.

Options:
  --dry-run   Resolve and validate the target tag without checking it out
  -h, --help  Show this help text`;

interface Options {
	dryRun: boolean;
	tag?: string;
}

function parseArgs(args: string[]): Options {
	const options: Options = { dryRun: false };

	for (const arg of args) {
		if (arg === "--dry-run") {
			options.dryRun = true;
			continue;
		}
		if (arg === "--help" || arg === "-h") {
			console.log(usage);
			process.exit(0);
		}
		if (arg.startsWith("-"))
			throw new Error(`Unknown option: ${arg}\n${usage}`);
		if (options.tag) throw new Error(`Only one tag may be provided.\n${usage}`);
		options.tag = arg;
	}

	return options;
}

async function text(args: string[]): Promise<string> {
	return (await $`${args}`.quiet()).text().trim();
}

async function tagExists(tag: string): Promise<boolean> {
	const result =
		await $`git -C opencode rev-parse --verify --quiet ${`refs/tags/${tag}`}`
			.nothrow()
			.quiet();
	return result.exitCode === 0;
}

try {
	const options = parseArgs(process.argv.slice(2));

	await $`git submodule sync --recursive opencode`;
	await $`git submodule update --init --recursive opencode`;
	await $`git -C opencode fetch --force --tags origin`;

	const tag =
		options.tag ??
		(
			await text([
				"git",
				"-C",
				"opencode",
				"tag",
				"--list",
				"v[0-9]*",
				"--sort=-version:refname",
			])
		).split("\n")[0];

	if (!tag)
		throw new Error("Could not determine an upstream opencode release tag.");

	if (!(await tagExists(tag))) {
		throw new Error(
			[
				`Unknown opencode tag: ${tag}`,
				"Run `git -C opencode tag --list 'v[0-9]*' --sort=-version:refname` to inspect available release tags.",
			].join("\n"),
		);
	}

	const current = await text([
		"git",
		"-C",
		"opencode",
		"describe",
		"--tags",
		"--always",
	]);

	if (current === tag) {
		console.log(`opencode already at ${tag}`);
		console.log(
			"Run verification when ready: bun test && bun run typecheck && bun run lint && bun run format:check && docker build -t opencode-web-docker .",
		);
		process.exit(0);
	}

	if (options.dryRun) {
		console.log(`Would update opencode submodule from ${current} to ${tag}`);
		process.exit(0);
	}

	await $`git -C opencode checkout --detach ${tag}`;
	console.log(`Updated opencode submodule from ${current} to ${tag}`);
	await $`git status --short opencode`;
	console.log(
		"Run verification when ready: bun test && bun run typecheck && bun run lint && bun run format:check && docker build -t opencode-web-docker .",
	);
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}
