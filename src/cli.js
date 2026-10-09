/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseArgs } = require('util');
const { CLIError, ok, fail, action, entry_actions, ctx_args, build_actions, context_actions, file_actions, export_actions } = require('./cli/envelope');
const context = require('./cli/context');
const browse = require('./cli/browse');
const models = require('./cli/models');
const { export_files } = require('./cli/export');
const pkg = require('../package.json');

const DEFAULT_DATA_DIR = path.join(os.homedir(), '.wow.export-cli');

const OPTIONS = { 'data-dir': { type: 'string' }, source: { type: 'string' }, build: { type: 'string' },
	query: { type: 'string' }, regex: { type: 'boolean' }, type: { type: 'string' }, offset: { type: 'string' }, limit: { type: 'string' },
	file: { type: 'string', multiple: true }, format: { type: 'string' }, out: { type: 'string' }
};

const COMMANDS = {
	'': async (args) => ok({
		name: 'wow.export',
		version: pkg.version,
		description: pkg.description,
		commands: Object.keys(COMMANDS).filter(Boolean)
	}, entry_actions(args['data-dir'])),

	builds: async (args) => {
		const builds = await context.list_builds(args.source, args['data-dir']);
		const actions = build_actions(args.source, builds, args['data-dir']);
		return ok({ source: args.source, builds: builds.map((b, i) => ({ ...b, action: actions[i] })) }, actions);
	},

	open: async (args) => {
		const ctx = await context.require_context(args);
		return ok({ source: ctx.source, build: ctx.build, label: ctx.label, counts: context.file_counts() },
			context_actions(ctx_args(ctx.source, ctx.build, args['data-dir'])));
	},

	search: async (args) => {
		// validate before require_context so usage errors don't cost a build load
		const { query = '', regex = false, type } = args;
		browse.validate_type(type);
		browse.make_predicate(query, regex);
		const { offset, limit, limitCapped } = browse.parse_page_args(args);

		const opened = await context.require_context(args);
		const ctx = ctx_args(opened.source, opened.build, args['data-dir']);
		const { entries, total } = browse.search({ query, regex, type, offset, limit });
		const next = offset + limit < total
			? [action('next-page', 'Fetch the next page', 'search', { ...ctx, query, regex, type, offset: offset + limit, limit })]
			: [];

		return ok({ query, regex, type: type ?? null, total, offset, limit, limitCapped,
			entries: entries.map(e => ({ ...e, actions: file_actions(ctx, e) })) }, [...next, ...context_actions(ctx)]);
	},

	inspect: async (args) => {
		if (args.file?.length !== 1)
			throw new CLIError('usage', 'inspect takes exactly one --file <fdid|path>');

		const opened = await context.require_context(args);
		const ctx = ctx_args(opened.source, opened.build, args['data-dir']);
		const info = await browse.inspect(args.file[0]);
		const model = info.type === 'model' ? file_actions(ctx, info).filter(a => a.rel !== 'inspect') : [];
		return ok(info, [...export_actions(ctx, info, info.formats), ...model]);
	},

	preview: async (args) => {
		if (args.file?.length !== 1)
			throw new CLIError('usage', 'preview takes exactly one --file <fdid|path>');

		const opened = await context.require_context(args);
		const ctx = ctx_args(opened.source, opened.build, args['data-dir']);
		const data = await models.preview(args.file[0], ctx);
		const file = String(data.fileDataID);
		const anims = data.kind === 'M2' ? [action('animations', 'List animations', 'animations', { ...ctx, file })] : [];
		return ok(data, [...anims, ...export_actions(ctx, data, browse.EXPORT_FORMATS.model)]);
	},

	animations: async (args) => {
		if (args.file?.length !== 1)
			throw new CLIError('usage', 'animations takes exactly one --file <fdid|path>');

		const opened = await context.require_context(args);
		const ctx = ctx_args(opened.source, opened.build, args['data-dir']);
		const data = await models.list_animations(args.file[0], ctx);
		return ok(data, export_actions(ctx, { fileDataID: data.fileDataID }, browse.EXPORT_FORMATS.model));
	},

	export: async (args) => {
		if (!args.file?.length || !args.format || !args.out)
			throw new CLIError('usage', 'export takes --file <fdid|path> (repeatable), --format <F> and --out <dir>');

		const opened = await context.require_context(args);
		const ctx = ctx_args(opened.source, opened.build, args['data-dir']);
		const data = await export_files({ files: args.file, format: args.format, out: args.out, ctx });
		const failed = data.results.filter(r => !r.ok).length;
		return failed ? fail('export-failed', `${failed} of ${data.results.length} files failed`, [], data) : ok(data, []);
	}
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
