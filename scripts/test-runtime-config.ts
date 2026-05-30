#!/usr/bin/env bun
import { $ } from "bun";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

interface Options {
	buildImage: boolean;
	imageTag: string;
}

const usage = "usage: bun run test:runtime-config [--build] [image-tag]";

function parseArgs(args: string[]): Options {
	const options: Options = {
		buildImage: false,
		imageTag: "opencode-web-docker",
	};

	for (const arg of args) {
		if (arg === "--build") {
			options.buildImage = true;
			continue;
		}
		if (arg === "--help" || arg === "-h") {
			console.error(usage);
			process.exit(1);
		}
		if (arg.startsWith("-")) throw new Error(usage);
		options.imageTag = arg;
	}

	return options;
}

async function run(args: string[]): Promise<void> {
	const child = Bun.spawn(args, {
		stderr: "inherit",
		stdout: "inherit",
	});
	const exitCode = await child.exited;
	if (exitCode !== 0) throw new Error(`Command failed: ${args.join(" ")}`);
}

async function capture(args: string[]): Promise<string> {
	const child = Bun.spawn(args, {
		stderr: "pipe",
		stdout: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	if (exitCode !== 0) {
		process.stderr.write(stderr);
		throw new Error(`Command failed: ${args.join(" ")}`);
	}
	return stdout;
}

async function outputFor(args: string[]) {
	const child = Bun.spawn(args, {
		stderr: "pipe",
		stdout: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return {
		exitCode,
		output: `${stdout}${stderr}`,
	};
}

async function expectSuccess(name: string, args: string[]): Promise<void> {
	console.log(`==> ${name}`);
	await run(args);
}

async function expectFinalImageLayout(
	name: string,
	args: string[],
): Promise<void> {
	console.log(`==> ${name}`);
	await run([
		...args,
		"sh",
		"-lc",
		[
			"test -f /opt/opencode-web/config/nginx.conf.template",
			"test ! -e /opt/opencode-web/config/config",
			"test -f /opt/opencode-web/public/index.html",
			"test -d /opt/opencode-web/public/assets",
			"test -s /opt/opencode-web/public/opencode-web-customizations.css",
			"test ! -e /opt/opencode-web/public/runtime-config.js",
			'! grep -F "<style id=\\"opencode-web-customizations\\"" /opt/opencode-web/public/index.html >/dev/null',
			'grep -F "<link rel=\\"stylesheet\\" href=\\"/opencode-web-customizations.css\\">" /opt/opencode-web/public/index.html >/dev/null',
			"test -f /opt/opencode-web/runtime/generate-nginx-config.sh",
			"test -x /docker-entrypoint.d/40-opencode-web.sh",
			"test -f /opt/opencode-web/runtime/runtime-bundle.js",
			'test "$(id -un)" = nginx',
			'test "$(id -gn)" = nginx',
			'test "$(id -u)" -ne 0',
			"test -w /etc/nginx/conf.d",
			"test -w /opt/opencode-web/runtime-configs",
			"test -w /var/cache/nginx/client_temp",
			"test ! -w /opt/opencode-web/public",
		].join(" && "),
	]);
}

function evaluateRuntimeConfig(
	source: string,
	expectedTitle: string,
	expectedBootstrapUrl: string,
	expectedDefaultUrl: string,
	expectedListJson: string,
): void {
	const storage = new Map<string, string>();
	const context = {
		Buffer,
		JSON,
		TextDecoder,
		Uint8Array,
		atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
		console,
		document: { title: "OpenCode" },
		location: { origin: "http://frontend.opencode.example.com" },
		localStorage: {
			getItem: (key: string) => (storage.has(key) ? storage.get(key) : null),
			setItem: (key: string, value: string) => storage.set(key, value),
			removeItem: (key: string) => storage.delete(key),
		},
		window: {} as { __OPENCODE_SERVER_URL?: string },
	};

	vm.runInNewContext(source, context, { timeout: 1000 });

	const savedStateRaw = storage.get("opencode.global.dat:server");
	if (!savedStateRaw) throw new Error("Missing persisted server state");

	const savedState = JSON.parse(savedStateRaw) as {
		list: Array<{
			http?: { url?: string };
			url?: string;
			displayName?: string;
		}>;
	};
	const savedList = savedState.list.map((item) => ({
		url: item.http?.url ?? item.url,
		name: item.displayName ?? "",
	}));

	if (context.document.title !== expectedTitle)
		throw new Error(
			`Expected document.title=${JSON.stringify(expectedTitle)}, got ${JSON.stringify(context.document.title)}`,
		);
	if (context.window.__OPENCODE_SERVER_URL !== expectedBootstrapUrl) {
		throw new Error(
			`Expected bootstrap URL ${JSON.stringify(expectedBootstrapUrl)}, got ${JSON.stringify(context.window.__OPENCODE_SERVER_URL)}`,
		);
	}
	if (
		storage.get("opencode.settings.dat:defaultServerUrl") !== expectedDefaultUrl
	) {
		throw new Error(
			`Expected default server URL ${JSON.stringify(expectedDefaultUrl)}, got ${JSON.stringify(storage.get("opencode.settings.dat:defaultServerUrl"))}`,
		);
	}

	const expectedList = JSON.parse(expectedListJson);
	if (JSON.stringify(savedList) !== JSON.stringify(expectedList))
		throw new Error(
			`Expected server list ${expectedListJson}, got ${JSON.stringify(savedList)}`,
		);
}

async function expectGeneratedRuntimeConfigApplies(
	name: string,
	expectedTitle: string,
	expectedBootstrapUrl: string,
	expectedDefaultUrl: string,
	expectedListJson: string,
	args: string[],
): Promise<void> {
	console.log(`==> ${name}`);
	evaluateRuntimeConfig(
		await capture(args),
		expectedTitle,
		expectedBootstrapUrl,
		expectedDefaultUrl,
		expectedListJson,
	);
}

async function withNginxContainer(
	name: string,
	args: string[],
): Promise<string> {
	console.log(`==> ${name}`);
	const containerId = (await capture(["docker", "run", "-d", ...args])).trim();
	for (let attempt = 0; attempt < 9; attempt++) {
		const result = await outputFor([
			"docker",
			"exec",
			containerId,
			"wget",
			"-q",
			"--spider",
			"http://127.0.0.1:8080/health",
		]);
		if (result.exitCode === 0) return containerId;
		await Bun.sleep(1000);
	}

	try {
		await $`docker logs ${containerId}`.nothrow();
		throw new Error(`nginx did not become healthy for: ${name}`);
	} finally {
		await stopNginxContainer(containerId);
	}
}

async function stopNginxContainer(containerId: string): Promise<void> {
	await $`docker rm -f ${containerId}`.nothrow().quiet();
}

try {
	const { buildImage, imageTag } = parseArgs(process.argv.slice(2));
	const repoRoot = fileURLToPath(new URL("..", import.meta.url));

	if (buildImage) {
		console.log(`==> Building Docker image ${imageTag}`);
		await run(["docker", "build", "-t", imageTag, repoRoot]);
	} else if (
		(await outputFor(["docker", "image", "inspect", imageTag])).exitCode !== 0
	) {
		throw new Error(
			`Docker image ${imageTag} not found. Build it first or pass --build.`,
		);
	}

	const dockerRun = (...args: string[]) => {
		const commandIndex = args.indexOf("sh");
		const dockerOptions =
			commandIndex === -1 ? args : args.slice(0, commandIndex);
		const command = commandIndex === -1 ? [] : args.slice(commandIndex);
		return ["docker", "run", "--rm", ...dockerOptions, imageTag, ...command];
	};
	const runtimeEnv = [
		"-e",
		"SERVER_1_HOST=web1.opencode.example.com",
		"-e",
		"SERVER_1_BACKEND=http://api1.opencode.example.com",
		"-e",
		"SERVER_2_HOST=web2.opencode.example.com",
		"-e",
		"SERVER_2_BACKEND=http://api2.opencode.example.com",
	];
	const multilineEnvValue = "before\nSERVER_9_HOST\nafter";

	await expectFinalImageLayout(
		"final image layout and permissions are sane",
		dockerRun(...runtimeEnv),
	);
	await expectSuccess(
		"entrypoint ignores multiline unrelated env values on Alpine",
		dockerRun(
			...runtimeEnv,
			"-e",
			`UNRELATED_MULTILINE=${multilineEnvValue}`,
			"sh",
			"-lc",
			"/docker-entrypoint.d/40-opencode-web.sh && test -s /opt/opencode-web/runtime-configs/web1.opencode.example.com.js && test -s /etc/nginx/conf.d/default.conf",
		),
	);

	const containerId = await withNginxContainer(
		"nginx starts through official entrypoint",
		[...runtimeEnv, imageTag],
	);
	try {
		await expectGeneratedRuntimeConfigApplies(
			"nginx serves host 1 runtime config",
			"OpenCode",
			"http://api1.opencode.example.com",
			"http://api1.opencode.example.com",
			'[{"url":"http://api1.opencode.example.com","name":""}]',
			[
				"docker",
				"exec",
				containerId,
				"wget",
				"-q",
				"--header=Host: web1.opencode.example.com",
				"-O",
				"-",
				"http://127.0.0.1:8080/runtime-config.js",
			],
		);
		await expectGeneratedRuntimeConfigApplies(
			"nginx serves host 2 runtime config",
			"OpenCode",
			"http://api2.opencode.example.com",
			"http://api2.opencode.example.com",
			'[{"url":"http://api2.opencode.example.com","name":""}]',
			[
				"docker",
				"exec",
				containerId,
				"wget",
				"-q",
				"--header=Host: web2.opencode.example.com",
				"-O",
				"-",
				"http://127.0.0.1:8080/runtime-config.js",
			],
		);
		await expectGeneratedRuntimeConfigApplies(
			"nginx matches server when Host includes port",
			"OpenCode",
			"http://api2.opencode.example.com",
			"http://api2.opencode.example.com",
			'[{"url":"http://api2.opencode.example.com","name":""}]',
			[
				"docker",
				"exec",
				containerId,
				"wget",
				"-q",
				"--header=Host: web2.opencode.example.com:8080",
				"-O",
				"-",
				"http://127.0.0.1:8080/runtime-config.js",
			],
		);
		await expectSuccess("nginx unmatched host returns 404 except health", [
			"docker",
			"exec",
			containerId,
			"sh",
			"-lc",
			'wget -q --spider --header="Host: unmatched.example.com" http://127.0.0.1:8080/health && ! wget -q --spider --header="Host: unmatched.example.com" http://127.0.0.1:8080/runtime-config.js && ! wget -q --spider --header="Host: unmatched.example.com" http://127.0.0.1:8080/future/opencode/route',
		]);
		await expectSuccess("nginx configured host SPA route returns app shell", [
			"docker",
			"exec",
			containerId,
			"sh",
			"-lc",
			'wget -q --header="Host: web2.opencode.example.com" -O - http://127.0.0.1:8080/future/opencode/route | grep -q "/runtime-config.js"',
		]);
		await expectSuccess("nginx missing static file returns 404", [
			"docker",
			"exec",
			containerId,
			"sh",
			"-lc",
			'! wget -q --spider --header="Host: web2.opencode.example.com" http://127.0.0.1:8080/missing.js',
		]);
		await expectSuccess(
			"configured host app shell has no-store and CSP headers",
			[
				"docker",
				"exec",
				containerId,
				"sh",
				"-lc",
				'headers="$(wget -qS --header="Host: web1.opencode.example.com" -O /dev/null http://127.0.0.1:8080/ 2>&1)"; printf "%s\n" "$headers" | grep -qi "cache-control.*no-store" && printf "%s\n" "$headers" | grep -qi "content-security-policy"',
			],
		);
		await expectSuccess("hashed assets have long-lived cache headers", [
			"docker",
			"exec",
			containerId,
			"sh",
			"-lc",
			[
				"set -- /opt/opencode-web/public/assets/*",
				`asset="\${1##*/}"`,
				'headers="$(wget -qS --header="Host: web1.opencode.example.com" -O /dev/null "http://127.0.0.1:8080/assets/$asset" 2>&1)"',
				'printf "%s\n" "$headers" | grep -qi "cache-control.*immutable"',
				'printf "%s\n" "$headers" | grep -qi "content-security-policy"',
			].join(" && "),
		]);
	} finally {
		await stopNginxContainer(containerId);
	}

	console.log("==> Runtime-config Docker smoke checks passed");
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}
