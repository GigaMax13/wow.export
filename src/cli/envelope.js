/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
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

module.exports = { CLIError, ok, fail, action, to_argv, entry_actions, REGIONS };
