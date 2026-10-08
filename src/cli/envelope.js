/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const os = require('os');
const path = require('path');

const CLI_PATH = path.join(__dirname, '..', 'cli.js');

// mirrors constants.PATCH.REGIONS tags; constants.js cannot be required before the shims
const REGIONS = ['eu', 'us', 'kr', 'tw', 'cn'];

class CLIError extends Error {
	constructor(code, message, actions = [], data = null) {
		super(message);
		this.code = code;
		this.actions = actions;
		this.data = data;
	}
}

const ok = (data, actions = []) => ({ ok: true, data, actions });
const fail = (code, message, actions = [], data = null) => ({ ok: false, data, actions, error: { code, message } });

const to_argv = (name, args = {}) => {
	const flags = [];
	for (const [key, value] of Object.entries(args)) {
		if (value === false || value === null || value === undefined)
			continue;

		if (value === true)
			flags.push('--' + key);
		else if (Array.isArray(value))
			value.forEach(v => flags.push('--' + key, String(v)));
		else
			flags.push('--' + key, String(value));
	}

	return [process.execPath, CLI_PATH, ...(name ? [name] : []), ...flags];
};

const action = (rel, description, name, args = {}) =>
	({ rel, description, command: to_argv(name, args), request: { command: name, args } });

const entry_actions = (data_dir = null) => {
	const extra = data_dir ? { 'data-dir': data_dir } : {};
	return [
		action('entry', 'Describe what the tool can do and list the first actions.', null, extra),
		action('builds', 'List builds of a local install; replace <install-dir> with the World of Warcraft directory.',
			'builds', { source: 'local:<install-dir>', ...extra }),
		...REGIONS.map(tag => action('builds', `List builds available on the ${tag} CDN region.`,
			'builds', { source: 'remote:' + tag, ...extra }))
	];
};

const ctx_args = (source, build, data_dir) => ({ source, build, ...(data_dir ? { 'data-dir': data_dir } : {}) });

const build_actions = (source, builds, data_dir) =>
	builds.map(b => action('open-build', `Open ${b.label}`, 'open', ctx_args(source, b.index, data_dir)));

// keep in step with context.FILE_TYPE_LISTS (that module needs the CLI shims to load)
const FILE_TYPES = ['model', 'texture', 'sound', 'text', 'font'];

const context_actions = (ctx) => [
	...FILE_TYPES.map(type => action('search', `Search ${type} files; set --query to a substring.`, 'search', { ...ctx, type, query: '' })),
	action('search', 'Search files of every type; set --query to a substring.', 'search', { ...ctx, query: '' })
];

const file_actions = (ctx, entry) => {
	const args = { ...ctx, file: String(entry.fileDataID) };
	const actions = [action('inspect', `Inspect ${entry.fileName ?? args.file}.`, 'inspect', args)];
	if (entry.type === 'model')
		actions.push(action('preview', 'Render a preview image of this model.', 'preview', args),
			action('animations', 'List the animations of this model.', 'animations', args));
	return actions;
};

// --out falls back to the desktop default export dir (src/app.js) until the export command lands
const export_actions = (ctx, file, formats) => formats.map(format => action('export', `Export as ${format}.`, 'export',
	{ ...ctx, file: String(file.fileDataID), format, out: path.join(os.homedir(), 'wow.export') }));

module.exports = { export_actions, CLIError, ok, fail, action, to_argv, entry_actions, ctx_args, build_actions, context_actions, file_actions, FILE_TYPES, REGIONS };
