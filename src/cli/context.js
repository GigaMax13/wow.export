/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const path = require('path');
const { CLIError, action, REGIONS } = require('./envelope');

// required lazily: the js modules need the CLI shims installed first
const js = (name) => require(path.join('..', 'js', name));

const FILE_TYPE_LISTS = { model: 'listfileModels', texture: 'listfileTextures', sound: 'listfileSounds', text: 'listfileText', font: 'listfileFonts' };

const region_tags = () => js('constants').PATCH.REGIONS.map(r => r.tag);

const parse_source = (spec) => {
	const tags = region_tags();
	const m = /^(remote|local):(.+)$/.exec(spec ?? '');
	if (!m)
		throw new CLIError('usage', `--source must be remote:<region> or local:<dir>; valid regions: ${tags.join(', ')}`);

	if (m[1] === 'local')
		return { kind: 'local', dir: m[2] };

	if (!tags.includes(m[2]))
		throw new CLIError('usage', `Unknown region "${m[2]}"; valid regions: ${tags.join(', ')}`);

	return { kind: 'remote', region: m[2] };
};

const NETWORK_CODES = new Set(['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ConnectionRefused', 'FailedToOpenSocket']);
const NETWORK_NAMES = new Set(['TimeoutError', 'AbortError']);
// wrapper messages from generics.downloadFile and casc-source-remote getCDNConfig drop the original error
const is_network_error = (e) => NETWORK_CODES.has(e?.code) || NETWORK_NAMES.has(e?.name) ||
	/fetch|network|socket|getaddrinfo|timed out|All download attempts failed|Unable to retrieve CDN config/i.test(e?.message ?? '');
const network_error = (region) => new CLIError('network', `Unable to reach the ${region} CDN region.`);

const region_actions = (data_dir) => REGIONS.map(tag => action('builds', `List builds available on the ${tag} CDN region.`,
	'builds', { source: 'remote:' + tag, ...(data_dir ? { 'data-dir': data_dir } : {}) }));

const init_source = async (src, data_dir) => {
	const core = js('core');
	core.view.selectedCDNRegion = { tag: src.region ?? js('constants').PATCH.DEFAULT_REGION };

	if (src.kind === 'local') {
		const CASCLocal = js('casc/casc-source-local');
		const casc = new CASCLocal(src.dir);
		try {
			await casc.init();
		} catch (e) {
			if (e.code === 'ENOENT' || e.code === 'ENOTDIR')
				throw new CLIError('source-not-found', `No World of Warcraft installation at ${src.dir}`, region_actions(data_dir));
			throw e;
		}
		return casc;
	}

	const CASCRemote = js('casc/casc-source-remote');
	const casc = new CASCRemote(src.region);
	await casc.init();
	if (casc.getProductList().length === 0)
		throw network_error(src.region);
	return casc;
};

async function list_builds(source_spec, data_dir = null) {
	const casc = await init_source(parse_source(source_spec), data_dir);
	return casc.getProductList().map(p => ({ label: p.label, index: p.buildIndex }));
}

let active = null;
let keys_loaded = false;

async function open_build(source_spec, build_index, data_dir = null) {
	if (active && active.source === source_spec && active.build === build_index)
		return active;

	const src = parse_source(source_spec);
	const core = js('core');

	const casc = await init_source(src, data_dir);
	const product = casc.getProductList().find(p => p.buildIndex === build_index);
	if (!product)
		throw new CLIError('build-not-found', `No build with index ${build_index} in ${source_spec}`);

	if (active) {
		active.casc.cleanup();
		js('mmap').release_virtual_files();
		active = null;
	}

	await js('casc/listfile').preload();
	await js('casc/dbd-manifest').preload();
	if (!keys_loaded) {
		await js('casc/tact-keys').load();
		keys_loaded = true;
	}

	try {
		await casc.load(build_index);
	} catch (e) {
		if (src.kind === 'remote' && is_network_error(e))
			throw network_error(src.region);
		throw e;
	}

	core.events.emit('casc-source-changed');
	active = { source: source_spec, build: build_index, label: product.label, casc };
	return active;
}

async function require_context(args) {
	const build = Number(args.build);
	if (args.build === undefined || !/^\d+$/.test(String(args.build)))
		throw new CLIError('usage', `--build must be a non-negative integer, got "${args.build ?? ''}"`);
	return open_build(args.source, build, args['data-dir']);
}

const file_counts = () => {
	const view = js('core').view;
	return Object.fromEntries(Object.entries(FILE_TYPE_LISTS).map(([type, key]) => [type, view[key]?.length ?? 0]));
};

// open_build is exported per WE-2's interface: session mode calls it directly
module.exports = { FILE_TYPE_LISTS, parse_source, list_builds, open_build, require_context, file_counts, is_network_error };
