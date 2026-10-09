/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const fs = require('fs');
const path = require('path');
const { CLIError, export_actions } = require('./envelope');
const { EXPORT_FORMATS, resolve_file, file_type_of } = require('./browse');

// js modules are required lazily (inside functions): the CLI shims must be installed first

const TEXTURE_EXT = { PNG: '.png', WEBP: '.webp', RAW: '.blp' };

// unresolvable or missing values get fileDataID null: skipped by format validation, failed per file
const resolve = (value) => {
	try {
		const { fileDataID, fileName } = resolve_file(value);
		if (!require('../js/core').view.casc.fileExists(fileDataID))
			throw new Error('missing');
		return { fileDataID, fileName, type: file_type_of(fileDataID) };
	} catch {
		return { fileDataID: null, fileName: value, type: 'other' };
	}
};

// mirrors texture-exporter.js:exportFiles and tab_audio.js:export_sounds
async function write_file(file, format, data) {
	const core = require('../js/core');
	const ExportHelper = require('../js/casc/export-helper');
	const config = core.view.config;
	let target = ExportHelper.getExportPath(file.fileName);

	if (file.type === 'texture') {
		target = ExportHelper.replaceExtension(target, TEXTURE_EXT[format]);
	} else if (file.fileName.endsWith('.unk_sound')) {
		const { detectFileType, AUDIO_TYPE_OGG, AUDIO_TYPE_MP3 } = require('../js/ui/audio-helper');
		const kind = detectFileType(data);
		if (kind === AUDIO_TYPE_OGG)
			target = ExportHelper.replaceExtension(target, '.ogg');
		else if (kind === AUDIO_TYPE_MP3)
			target = ExportHelper.replaceExtension(target, '.mp3');
	}

	if (!config.overwriteFiles && await require('../js/generics').fileExists(target))
		return;

	if (file.type === 'texture' && format !== 'RAW') {
		const blp = new (require('../js/casc/blp'))(data);
		if (format === 'PNG')
			await blp.saveToPNG(target, config.exportChannelMask);
		else
			await blp.saveToWebP(target, config.exportChannelMask, 0, config.exportWebPQuality);
	} else {
		await data.writeToFile(target);
	}
}

// FileWriter.close() (OBJ/MTL writers) is fire-and-forget; the CLI exits right after, so track
// every write stream opened during an export and wait for it to flush before listing paths
const track_streams = () => {
	const pending = [];
	const create = fs.createWriteStream;
	fs.createWriteStream = (...args) => {
		const stream = create(...args);
		pending.push(new Promise(resolve => stream.once('close', resolve).once('error', resolve)));
		return stream;
	};
	return () => {
		fs.createWriteStream = create;
		return Promise.all(pending);
	};
};

// snapshot diffing, not mtime >= Date.now(): fs clocks are coarser than the wall clock
const snapshot = (out) => new Map(fs.readdirSync(out, { recursive: true })
	.map(rel => path.join(out, rel))
	.map(p => [p, fs.statSync(p)])
	.filter(([, s]) => s.isFile())
	.map(([p, s]) => [p, s.mtimeMs]));

const written_since = (out, before) => [...snapshot(out)]
	.filter(([p, m]) => before.get(p) !== m)
	.map(([p]) => p)
	.sort();

async function export_files({ files, format, out, ctx }) {
	format = format.toUpperCase();
	const resolved = files.map(resolve);
	for (const file of resolved) {
		if (file.fileDataID === null)
			continue;
		const valid = EXPORT_FORMATS[file.type];
		if (!valid.includes(format))
			throw new CLIError('unsupported-format', `${format} is not valid for ${file.type} ${file.fileName}; valid: ${valid.join(', ')}`,
				export_actions(ctx, file, valid));
	}

	out = path.resolve(out);
	try {
		fs.mkdirSync(out, { recursive: true });
		fs.accessSync(out, fs.constants.W_OK);
	} catch (e) {
		throw new CLIError('io', e.message);
	}

	const core = require('../js/core');
	const ExportHelper = require('../js/casc/export-helper');
	core.view.config.exportDirectory = out;

	const helper = new ExportHelper(resolved.length, 'file');
	helper.start();
	const results = [];
	for (const file of resolved) {
		const before = snapshot(out);
		const result = { ...file, ok: true, paths: [] };
		const flushed = track_streams();
		try {
			if (file.fileDataID === null)
				throw new Error(`No file ${file.fileName} in this build`);

			const data = await core.view.casc.getFile(file.fileDataID);
			if (file.type === 'model') {
				const { export_model } = require('../js/ui/model-viewer-utils');
				await export_model({ core, data, file_data_id: file.fileDataID, file_name: file.fileName, format,
					export_path: ExportHelper.getExportPath(file.fileName), helper, file_manifest: [] });
			} else {
				await write_file(file, format, data);
			}
			await flushed();
			helper.mark(file.fileName, true);
			result.paths = written_since(out, before);
		} catch (e) {
			await flushed();
			helper.mark(file.fileName, false, e.message, e.stack);
			Object.assign(result, { ok: false, error: e.message });
		}
		results.push(result);
	}
	helper.finish();

	return { out, format, results };
}

module.exports = { export_files };
