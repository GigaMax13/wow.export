/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseArgs } = require('util');
const { CLIError, ok, fail, entry_actions } = require('./cli/envelope');
const pkg = require('../package.json');

const DEFAULT_DATA_DIR = path.join(os.homedir(), '.wow.export-cli');

const OPTIONS = { 'data-dir': { type: 'string' } };

const COMMANDS = {
	'': async (args) => ok({
		name: 'wow.export',
		version: pkg.version,
		description: pkg.description,
		commands: Object.keys(COMMANDS).filter(Boolean)
	}, entry_actions(args['data-dir']))
};

// must run before the first require('./js/...'): those modules read nw/BUILD_RELEASE at load
const install_shims = (data_dir) => {
	globalThis.BUILD_RELEASE = true;
	Object.assign(console, { log: console.error }); // only the envelope may reach stdout
	fs.mkdirSync(data_dir, { recursive: true });
	globalThis.nw = {
		__dirname: path.join(__dirname, '..'),
		__cli: true,
		App: { dataPath: data_dir, argv: [], manifest: { version: pkg.version, flavour: 'cli', guid: 'cli' } },
		Shell: { openItem() {}, openExternal() {} }
	};
};

const install_core = () => {
	const core = require('./js/core');
	core.view = Object.assign(core.makeNewView(), {
		$watch(watch_path, cb, opts) {
			if (opts?.immediate)
				cb(watch_path.split('.').reduce((o, k) => o?.[k], core.view));
			return () => {};
		},
		restartApplication() {}
	});

	core.showLoadingScreen = (segments, title) => process.stderr.write((title ?? 'Loading...') + '\n');
	core.progressLoadingScreen = async (text) => { if (text) process.stderr.write(text + '\n'); };
	core.hideLoadingScreen = () => {};
	core.setToast = (type, message) => process.stderr.write(`[${type}] ${message}\n`);
};

const run = async (name, args) => {
	try {
		const handler = COMMANDS[name];
		if (!handler)
			throw new CLIError('usage', `Unknown command: ${name}`, entry_actions(args['data-dir']));

		return await handler(args);
	} catch (e) {
		if (e instanceof CLIError)
			return fail(e.code, e.message, e.actions, e.data);
		return fail('internal', e.message);
	}
};

let printed = false;
const emit = (envelope) => {
	if (printed)
		return;
	printed = true;
	process.stdout.write(JSON.stringify(envelope) + '\n');
	process.exit(envelope.ok ? 0 : 1);
};

const main = async () => {
	process.on('uncaughtException', e => emit(fail('internal', e?.message ?? String(e))));
	process.on('unhandledRejection', e => emit(fail('internal', e?.message ?? String(e))));

	let parsed;
	try {
		parsed = parseArgs({ args: Bun.argv.slice(2), options: OPTIONS, strict: true, allowPositionals: true });
	} catch (e) {
		return emit(fail('usage', e.message, entry_actions()));
	}

	const { values, positionals } = parsed;
	install_shims(values['data-dir'] ?? DEFAULT_DATA_DIR);
	install_core();
	await require('./js/config').load();
	emit(await run(positionals[0] ?? '', values));
};

if (require.main === module)
	main();

module.exports = { install_shims, run, COMMANDS, OPTIONS };
