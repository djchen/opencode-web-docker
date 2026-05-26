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

async function expectFailure(
	name: string,
	expectedMessage: string,
	args: string[],
): Promise<void> {
	console.log(`==> ${name}`);
	const result = await outputFor(args);
	if (result.exitCode === 0)
		throw new Error(`Expected failure, but command succeeded for: ${name}`);

	process.stdout.write(result.output);

	if (!result.output.includes(expectedMessage)) {
		throw new Error(
			`Expected message not found for: ${name}\nExpected: ${expectedMessage}`,
		);
	}
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

async function expectGeneratedRuntimeConfigParses(
	name: string,
	args: string[],
): Promise<void> {
	console.log(`==> ${name}`);
	new Function(await capture(args));
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
	const entrypoint = ["sh", "-lc", "/docker-entrypoint.d/40-opencode-web.sh"];
	const generatedConfig = (host: string) =>
		`test -s /opt/opencode-web/runtime-configs/${host}.js && cat /opt/opencode-web/runtime-configs/${host}.js`;
	const multilineEnvValue = "before\nSERVER_9_HOST\nafter";

	await expectFailure(
		"reject legacy URL-only configuration",
		"SERVER_1_HOST and SERVER_1_BACKEND are required.",
		dockerRun(
			"-e",
			"SERVER_1_URL=http://api1.opencode.example.com",
			...entrypoint,
		),
	);
	await expectFailure(
		"reject malformed indexed env names",
		"Configured backend variable names must use unpadded integer indexes starting at 1. Invalid variable: SERVER_1FOO_HOST.",
		dockerRun("-e", "SERVER_1FOO_HOST=x", ...entrypoint),
	);
	await expectFailure(
		"reject padded backend indexes",
		"Configured backend variable names must use unpadded integer indexes starting at 1. Invalid variable: SERVER_01_HOST.",
		dockerRun("-e", "SERVER_01_HOST=web1.opencode.example.com", ...entrypoint),
	);
	await expectFailure(
		"reject non-contiguous backend indexes",
		"Configured backend indexes must be contiguous starting at 1. Missing index 2.",
		dockerRun(
			"-e",
			"SERVER_1_HOST=web1.opencode.example.com",
			"-e",
			"SERVER_1_BACKEND=http://api1.opencode.example.com",
			"-e",
			"SERVER_3_HOST=web3.opencode.example.com",
			"-e",
			"SERVER_3_BACKEND=http://api3.opencode.example.com",
			...entrypoint,
		),
	);
	await expectFailure(
		"reject missing host",
		"SERVER_1_HOST is required and must be a hostname-only ASCII DNS name. Use Punycode for IDNs.",
		dockerRun(
			"-e",
			"SERVER_1_BACKEND=http://api1.opencode.example.com",
			...entrypoint,
		),
	);
	await expectFailure(
		"reject missing backend",
		"SERVER_1_BACKEND is required and must be an absolute http(s) URL.",
		dockerRun("-e", "SERVER_1_HOST=web1.opencode.example.com", ...entrypoint),
	);
	await expectFailure(
		"reject protocol in host",
		"SERVER_1_HOST is required and must be a hostname-only ASCII DNS name. Use Punycode for IDNs.",
		dockerRun(
			"-e",
			"SERVER_1_HOST=https://web1.opencode.example.com",
			"-e",
			"SERVER_1_BACKEND=http://api1.opencode.example.com",
			...entrypoint,
		),
	);
	await expectFailure(
		"reject port in host",
		"SERVER_1_HOST is required and must be a hostname-only ASCII DNS name. Use Punycode for IDNs.",
		dockerRun(
			"-e",
			"SERVER_1_HOST=web1.opencode.example.com:8080",
			"-e",
			"SERVER_1_BACKEND=http://api1.opencode.example.com",
			...entrypoint,
		),
	);
	await expectFailure(
		"reject path in host",
		"SERVER_1_HOST is required and must be a hostname-only ASCII DNS name. Use Punycode for IDNs.",
		dockerRun(
			"-e",
			"SERVER_1_HOST=web1.opencode.example.com/app",
			"-e",
			"SERVER_1_BACKEND=http://api1.opencode.example.com",
			...entrypoint,
		),
	);
	await expectFailure(
		"reject direct unicode IDN host",
		"SERVER_1_HOST is required and must be a hostname-only ASCII DNS name. Use Punycode for IDNs.",
		dockerRun(
			"-e",
			"SERVER_1_HOST=täst.example.com",
			"-e",
			"SERVER_1_BACKEND=http://api1.opencode.example.com",
			...entrypoint,
		),
	);
	await expectFailure(
		"reject duplicate hosts",
		"Duplicate configured host after normalization: web1.opencode.example.com",
		dockerRun(
			"-e",
			"SERVER_1_HOST=web1.opencode.example.com",
			"-e",
			"SERVER_1_BACKEND=http://api1.opencode.example.com",
			"-e",
			"SERVER_2_HOST=web1.opencode.example.com",
			"-e",
			"SERVER_2_BACKEND=http://api2.opencode.example.com",
			...entrypoint,
		),
	);
	await expectFailure(
		"reject case-variant duplicate hosts",
		"Duplicate configured host after normalization: web1.opencode.example.com",
		dockerRun(
			"-e",
			"SERVER_1_HOST=Web1.OpenCode.Example.Com",
			"-e",
			"SERVER_1_BACKEND=http://api1.opencode.example.com",
			"-e",
			"SERVER_2_HOST=web1.opencode.example.com",
			"-e",
			"SERVER_2_BACKEND=http://api2.opencode.example.com",
			...entrypoint,
		),
	);
	await expectFailure(
		"reject backend without scheme",
		"SERVER_1_BACKEND is required and must be an absolute http(s) URL.",
		dockerRun(
			"-e",
			"SERVER_1_HOST=web1.opencode.example.com",
			"-e",
			"SERVER_1_BACKEND=api1.opencode.example.com",
			...entrypoint,
		),
	);
	await expectFailure(
		"reject backend with empty host after scheme",
		"SERVER_1_BACKEND is required and must be an absolute http(s) URL.",
		dockerRun(
			"-e",
			"SERVER_1_HOST=web1.opencode.example.com",
			"-e",
			"SERVER_1_BACKEND=http://",
			...entrypoint,
		),
	);

	await expectFinalImageLayout(
		"final image layout is sane",
		dockerRun(
			"-e",
			"SERVER_1_HOST=web1.opencode.example.com",
			"-e",
			"SERVER_1_BACKEND=http://api1.opencode.example.com",
		),
	);
	await expectSuccess(
		"ignore multiline env values while scanning backend vars",
		dockerRun(
			"-e",
			"SERVER_1_HOST=web1.opencode.example.com",
			"-e",
			"SERVER_1_BACKEND=http://api1.opencode.example.com",
			"-e",
			`UNRELATED_MULTILINE=${multilineEnvValue}`,
			"sh",
			"-lc",
			"/docker-entrypoint.d/40-opencode-web.sh && test -s /opt/opencode-web/runtime-configs/web1.opencode.example.com.js && test ! -e /opt/opencode-web/public/runtime-config.js",
		),
	);
	await expectSuccess(
		"clean stale generated runtime config files",
		dockerRun(
			"-e",
			"SERVER_1_HOST=web1.opencode.example.com",
			"-e",
			"SERVER_1_BACKEND=http://api1.opencode.example.com",
			"sh",
			"-lc",
			"touch /opt/opencode-web/runtime-configs/stale.js && /docker-entrypoint.d/40-opencode-web.sh && test -d /opt/opencode-web/runtime-configs && test ! -e /opt/opencode-web/runtime-configs/stale.js && test -s /opt/opencode-web/runtime-configs/web1.opencode.example.com.js",
		),
	);
	await expectSuccess(
		"generate valid host-based runtime payloads",
		dockerRun(
			"-e",
			"SERVER_1_HOST=web1.opencode.example.com",
			"-e",
			"SERVER_1_BACKEND=https://api1.opencode.example.com",
			"-e",
			"SERVER_1_NAME=Server 1",
			"-e",
			"SERVER_1_APP_TITLE=Server 1 Web",
			"-e",
			"SERVER_2_HOST=web2.opencode.example.com",
			"-e",
			"SERVER_2_BACKEND=https://api2.opencode.example.com/",
			"-e",
			"SERVER_2_APP_TITLE=Server 2 Web",
			"sh",
			"-lc",
			'/docker-entrypoint.d/40-opencode-web.sh && test -s /opt/opencode-web/runtime-configs/web1.opencode.example.com.js && test -s /opt/opencode-web/runtime-configs/web2.opencode.example.com.js && test -s /etc/nginx/conf.d/default.conf && test ! -e /opt/opencode-web/public/runtime-config.js && test -d /opt/opencode-web/public/assets && test -s /opt/opencode-web/public/opencode-web-customizations.css && ! grep -F "<style id=\\"opencode-web-customizations\\"" /opt/opencode-web/public/index.html >/dev/null && grep -F "<link rel=\\"stylesheet\\" href=\\"/opencode-web-customizations.css\\">" /opt/opencode-web/public/index.html >/dev/null',
		),
	);
	await expectSuccess(
		"runtime config generation is idempotent",
		dockerRun(
			"-e",
			"SERVER_1_HOST=web1.opencode.example.com",
			"-e",
			"SERVER_1_BACKEND=http://api1.opencode.example.com",
			"-e",
			"SERVER_2_HOST=web2.opencode.example.com",
			"-e",
			"SERVER_2_BACKEND=http://api2.opencode.example.com",
			"sh",
			"-lc",
			'/docker-entrypoint.d/40-opencode-web.sh && test "$(grep -c "server_name web" /etc/nginx/conf.d/default.conf)" -eq 2',
		),
	);

	await expectGeneratedRuntimeConfigApplies(
		"server 1 runtime-config applies only server 1",
		"Server 1 Web",
		"https://api1.opencode.example.com",
		"https://api1.opencode.example.com",
		'[{"url":"https://api1.opencode.example.com","name":"Server 1"}]',
		dockerRun(
			"-e",
			"SERVER_1_HOST=web1.opencode.example.com",
			"-e",
			"SERVER_1_BACKEND=https://api1.opencode.example.com",
			"-e",
			"SERVER_1_NAME=Server 1",
			"-e",
			"SERVER_1_APP_TITLE=Server 1 Web",
			"-e",
			"SERVER_2_HOST=web2.opencode.example.com",
			"-e",
			"SERVER_2_BACKEND=https://api2.opencode.example.com/",
			"sh",
			"-lc",
			`/docker-entrypoint.d/40-opencode-web.sh && ${generatedConfig("web1.opencode.example.com")}`,
		),
	);
	await expectGeneratedRuntimeConfigApplies(
		"server 2 runtime-config applies only server 2",
		"Server 2 Web",
		"https://api2.opencode.example.com",
		"https://api2.opencode.example.com",
		'[{"url":"https://api2.opencode.example.com","name":"Server 2"}]',
		dockerRun(
			"-e",
			"SERVER_1_HOST=web1.opencode.example.com",
			"-e",
			"SERVER_1_BACKEND=https://api1.opencode.example.com",
			"-e",
			"SERVER_1_NAME=Server 1",
			"-e",
			"SERVER_2_HOST=web2.opencode.example.com",
			"-e",
			"SERVER_2_BACKEND=https://api2.opencode.example.com/",
			"-e",
			"SERVER_2_NAME=Server 2",
			"-e",
			"SERVER_1_APP_TITLE=Server 1 Web",
			"-e",
			"SERVER_2_APP_TITLE=Server 2 Web",
			"sh",
			"-lc",
			`/docker-entrypoint.d/40-opencode-web.sh && ${generatedConfig("web2.opencode.example.com")}`,
		),
	);
	await expectGeneratedRuntimeConfigApplies(
		"generated runtime-config preserves unicode metadata",
		"你好 OpenCode",
		"https://api1.opencode.example.com",
		"https://api1.opencode.example.com",
		'[{"url":"https://api1.opencode.example.com","name":"München"}]',
		dockerRun(
			"-e",
			"SERVER_1_HOST=xn--tst-qla.example.com",
			"-e",
			"SERVER_1_BACKEND=https://api1.opencode.example.com",
			"-e",
			"SERVER_1_NAME=München",
			"-e",
			"SERVER_1_APP_TITLE=你好 OpenCode",
			"sh",
			"-lc",
			`/docker-entrypoint.d/40-opencode-web.sh && ${generatedConfig("xn--tst-qla.example.com")}`,
		),
	);
	await expectGeneratedRuntimeConfigParses(
		"generated runtime-config.js parses as JavaScript",
		dockerRun(
			"-e",
			"SERVER_1_HOST=web1.opencode.example.com",
			"-e",
			"SERVER_1_BACKEND=https://api1.opencode.example.com",
			"-e",
			"SERVER_1_NAME=Server 1",
			"-e",
			"SERVER_1_APP_TITLE=Hosted OpenCode",
			"sh",
			"-lc",
			`/docker-entrypoint.d/40-opencode-web.sh && ${generatedConfig("web1.opencode.example.com")}`,
		),
	);
	await expectGeneratedRuntimeConfigApplies(
		"normalizes uppercase scheme and hostname to lowercase",
		"OpenCode",
		"https://api1.opencode.example.com",
		"https://api1.opencode.example.com",
		'[{"url":"https://api1.opencode.example.com","name":""}]',
		dockerRun(
			"-e",
			"SERVER_1_HOST=WEB1.OPENCODE.EXAMPLE.COM",
			"-e",
			"SERVER_1_BACKEND=HTTPS://API1.OPENCODE.EXAMPLE.COM",
			"sh",
			"-lc",
			`/docker-entrypoint.d/40-opencode-web.sh && ${generatedConfig("web1.opencode.example.com")}`,
		),
	);
	await expectGeneratedRuntimeConfigApplies(
		"preserves URL path case while normalizing scheme and host",
		"OpenCode",
		"https://api.opencode.example.com/pAtH",
		"https://api.opencode.example.com/pAtH",
		'[{"url":"https://api.opencode.example.com/pAtH","name":""}]',
		dockerRun(
			"-e",
			"SERVER_1_HOST=web1.opencode.example.com",
			"-e",
			"SERVER_1_BACKEND=HTTPS://API.OPENCODE.EXAMPLE.COM/pAtH",
			"sh",
			"-lc",
			`/docker-entrypoint.d/40-opencode-web.sh && ${generatedConfig("web1.opencode.example.com")}`,
		),
	);
	await expectGeneratedRuntimeConfigApplies(
		"preserves port while normalizing scheme and host",
		"OpenCode",
		"http://api.opencode.example.com:8080",
		"http://api.opencode.example.com:8080",
		'[{"url":"http://api.opencode.example.com:8080","name":""}]',
		dockerRun(
			"-e",
			"SERVER_1_HOST=web1.opencode.example.com",
			"-e",
			"SERVER_1_BACKEND=HTTP://API.OPENCODE.EXAMPLE.COM:8080",
			"sh",
			"-lc",
			`/docker-entrypoint.d/40-opencode-web.sh && ${generatedConfig("web1.opencode.example.com")}`,
		),
	);
	await expectSuccess(
		"allow duplicate backend URLs across hosts",
		dockerRun(
			"-e",
			"SERVER_1_HOST=web1.opencode.example.com",
			"-e",
			"SERVER_1_BACKEND=http://api.opencode.example.com",
			"-e",
			"SERVER_2_HOST=web2.opencode.example.com",
			"-e",
			"SERVER_2_BACKEND=http://api.opencode.example.com/",
			"sh",
			"-lc",
			"/docker-entrypoint.d/40-opencode-web.sh && test -s /opt/opencode-web/runtime-configs/web1.opencode.example.com.js && test -s /opt/opencode-web/runtime-configs/web2.opencode.example.com.js",
		),
	);

	const containerId = await withNginxContainer(
		"nginx starts through official entrypoint",
		[
			"-e",
			"SERVER_1_HOST=web1.opencode.example.com",
			"-e",
			"SERVER_1_BACKEND=http://api1.opencode.example.com",
			"-e",
			"SERVER_2_HOST=web2.opencode.example.com",
			"-e",
			"SERVER_2_BACKEND=http://api2.opencode.example.com",
			imageTag,
		],
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

	console.log("==> All runtime-config regression checks passed");
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}
