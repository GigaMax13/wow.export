/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const { CLIError, action } = require('./envelope');
const { resolve_file, file_type_of } = require('./browse');

// js modules are required lazily (inside functions): the CLI shims must be installed first

const named = (fdid) => ({ fileDataID: fdid, fileName: require('../js/casc/listfile').getByIDOrUnknown(fdid) });

async function load_model(value, ctx = {}) {
	const { fileDataID, fileName } = resolve_file(value);
	if (file_type_of(fileDataID) !== 'model')
		throw new CLIError('unsupported-type', `${fileName} is not a model`,
			[action('inspect', `Inspect ${fileName}.`, 'inspect', { ...ctx, file: String(fileDataID) })]);

	const mvu = require('../js/ui/model-viewer-utils');
	const data = await require('../js/core').view.casc.getFile(fileDataID);
	const type = mvu.detect_model_type_by_name(fileName) ?? mvu.detect_model_type(data);
	const [kind, loader] = type === mvu.MODEL_TYPE_M2 ? ['M2', new (require('../js/3D/loaders/M2Loader'))(data)]
		: type === mvu.MODEL_TYPE_WMO ? ['WMO', new (require('../js/3D/loaders/WMOLoader'))(data, fileDataID)]
			: ['M3', new (require('../js/3D/loaders/M3Loader'))(data)];
	await loader.load();
	return { fileDataID, fileName, kind, loader };
}

const EMPTY = { vertexCount: null, triangleCount: null, submeshCount: null, boneCount: null, boundingBox: null,
	textures: [], skinCount: null, animationCount: null, groupCount: null, doodadSets: null };

async function describe_m2(m) {
	const out = { vertexCount: m.vertices.length / 3, boneCount: m.bones.length, skinCount: m.skins.length,
		animationCount: m.animations.length, boundingBox: { min: m.boundingBox.min, max: m.boundingBox.max },
		textures: m.textures.filter(t => t.fileDataID > 0).map(t => named(t.fileDataID)), warnings: [] };
	try {
		const skin = await m.getSkin(0);
		out.triangleCount = skin.triangles.length / 3;
		out.submeshCount = skin.subMeshes.length;
	} catch (e) {
		out.warnings.push(`missing skin ${m.skins[0]?.fileDataID ?? 0}: ${e.message}`);
	}
	return out;
}

const describe_wmo = (w) => {
	// classic WMOs store offsets into textureNames, not FDIDs (as in WMOExporter)
	const listfile = require('../js/casc/listfile');
	const to_fdid = (t) => w.textureNames ? listfile.getByFilename(w.textureNames[t] ?? '') ?? 0 : t;
	const ids = new Set(w.materials.flatMap(m => [m.texture1, m.texture2, m.texture3].map(to_fdid)).filter(id => id > 0));
	return { groupCount: w.groupCount, doodadSets: w.doodadSets.map(s => s.name),
		boundingBox: { min: w.boundingBox1, max: w.boundingBox2 }, textures: [...ids].map(named), warnings: [] };
};

const describe_m3 = (m) => ({ vertexCount: m.vertices.length / 3, triangleCount: m.indices.length / 3,
	submeshCount: m.geosets.length, warnings: [] });

const DESCRIBE = { M2: describe_m2, WMO: describe_wmo, M3: describe_m3 };

// model is injectable for tests; never writes files
async function preview(value, ctx = {}, model = null) {
	const { fileDataID, fileName, kind, loader } = model ?? await load_model(value, ctx);
	return { fileDataID, fileName, kind, ...EMPTY, ...await DESCRIBE[kind](loader) };
}

// follows aliasNext while flagged 0x40; the visited set stops self-loops and cycles
const resolve_alias = (anims, i) => {
	const seen = new Set();
	while ((anims[i].flags & 0x40) === 0x40 && !seen.has(i) && anims[anims[i].aliasNext]) {
		seen.add(i);
		i = anims[i].aliasNext;
	}
	return i;
};

const describe_animations = (source) => {
	const get_name = require('../js/3D/AnimMapper').get_anim_name;
	return require('../js/ui/model-viewer-utils').extract_animations({ m2: source }).filter(a => a.id !== 'none').map(a => {
		const index = resolve_alias(source.animations, a.m2Index);
		return { id: a.id, animationId: a.animationId, index, name: get_name(a.animationId), duration: source.animations[index].duration };
	});
};

// mirrors M2RendererGL: animations come from the skeleton (its parent when set); a missing .skel falls back to the M2
async function animation_source(m2) {
	if (!m2.skeletonFileID)
		return m2;
	const casc = require('../js/core').view.casc;
	const SKELLoader = require('../js/3D/loaders/SKELLoader');
	const load = async (id) => { const s = new SKELLoader(await casc.getFile(id)); await s.load(); return s; };
	try {
		const skel = await load(m2.skeletonFileID);
		return skel.parent_skel_file_id > 0 ? await load(skel.parent_skel_file_id) : skel;
	} catch {
		return m2;
	}
}

async function list_animations(value, ctx = {}) {
	const { fileDataID, fileName, kind, loader } = await load_model(value, ctx);
	if (kind !== 'M2')
		throw new CLIError('unsupported-type', `${fileName} is ${kind}, animations are listed for M2 models only`,
			[action('preview', `Preview ${fileName}.`, 'preview', { ...ctx, file: String(fileDataID) })]);
	return { fileDataID, fileName, animations: describe_animations(await animation_source(loader)) };
}

module.exports = { load_model, preview, list_animations, describe_animations };
