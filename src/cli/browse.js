/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const { CLIError, FILE_TYPES } = require('./envelope');
const { FILE_TYPE_LISTS } = require('./context');

// js modules are required lazily (inside functions): the CLI shims must be installed first

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

const parse_int = (name, value, fallback) => {
	if (value === undefined)
		return fallback;
	if (!/^\d+$/.test(value))
		throw new CLIError('usage', `--${name} must be a non-negative integer`);
	return parseInt(value, 10);
};

const parse_page_args = (args) => {
	const offset = parse_int('offset', args.offset, 0);
	const limit = parse_int('limit', args.limit, DEFAULT_LIMIT);
	if (limit === 0)
		throw new CLIError('usage', '--limit must be at least 1');
	return { offset, limit: Math.min(limit, MAX_LIMIT), limitCapped: limit > MAX_LIMIT };
};

const validate_type = (type) => {
	if (type !== undefined && !FILE_TYPES.includes(type))
		throw new CLIError('usage', `--type must be one of: ${FILE_TYPES.join(', ')}`);
};

// mirrors listbox.js:filteredItems — matches against the whole "name [fid]" string
const make_predicate = (query, regex) => {
	if (regex) {
		let re;
		try {
			re = new RegExp(query.trim(), 'i');
		} catch (e) {
			throw new CLIError('usage', `Invalid regular expression: ${e.message}`);
		}
		return e => re.test(e);
	}

	const needle = query.trim().toLowerCase();
	return needle.length > 0 ? e => e.toLowerCase().includes(needle) : () => true;
};

const search = ({ query = '', regex = false, type, offset, limit }) => {
	validate_type(type);
	const match = make_predicate(query, regex);
	const view = require('../js/core').view;
	const { parseFileEntry } = require('../js/casc/listfile');

	const entries = [];
	let total = 0;
	for (const t of type ? [type] : FILE_TYPES) {
		for (const entry of view[FILE_TYPE_LISTS[t]] ?? []) {
			if (!match(entry))
				continue;

			if (total >= offset && entries.length < limit) {
				const { file_path, file_data_id } = parseFileEntry(entry);
				entries.push({ fileDataID: file_data_id, fileName: file_path, type: t });
			}
			total++;
		}
	}

	return { entries, total, offset, limit };
};

// formats the CLI can write per type; RAW = the file's bytes as stored
const EXPORT_FORMATS = {
	model: ['OBJ', 'STL', 'GLTF', 'GLB', 'RAW'],
	texture: ['PNG', 'WEBP', 'RAW'],
	sound: ['RAW'], text: ['RAW'], font: ['RAW'], other: ['RAW']
};

const not_found = (value) => new CLIError('file-not-found', `No file ${value} in this build`);

const resolve_file = (value) => {
	const listfile = require('../js/casc/listfile');
	let fileDataID = listfile.getByFilename(value);
	if (fileDataID === undefined) {
		if (!/^\d+$/.test(value))
			throw not_found(value);
		fileDataID = parseInt(value, 10);
	}
	return { fileDataID, fileName: listfile.getByID(fileDataID) ?? listfile.formatUnknownFile(fileDataID) };
};

// desktop categorisation: the list whose entry ends in " [fdid]"
const file_type_of = (fdid) => {
	const view = require('../js/core').view;
	const suffix = ` [${fdid}]`;
	return FILE_TYPES.find(t => (view[FILE_TYPE_LISTS[t]] ?? []).some(e => e.endsWith(suffix))) ?? 'other';
};

async function inspect(value) {
	const { fileDataID, fileName } = resolve_file(value);
	const { EncryptionError } = require('../js/casc/blte-reader');
	let data;
	try {
		data = await require('../js/core').view.casc.getFile(fileDataID);
		if (typeof data.processAllBlocks === 'function')
			data.processAllBlocks();
	} catch (e) {
		if (e instanceof EncryptionError)
			throw new CLIError('encrypted', e.message);
		if (/does not exist in root/.test(e.message))
			throw not_found(value);
		throw e;
	}

	const type = file_type_of(fileDataID);
	return { fileDataID, fileName, type, size: data.byteLength, formats: EXPORT_FORMATS[type] };
}

module.exports = { EXPORT_FORMATS, resolve_file, file_type_of, inspect, search, parse_page_args, validate_type, make_predicate };
