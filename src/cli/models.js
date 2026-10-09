/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const path = require('path');
const { CLIError, action } = require('./envelope');
const { resolve_file, file_type_of } = require('./browse');

// required lazily: the js modules need the CLI shims installed first
const js = (name) => require(path.join('..', 'js', name));

const named = (fdid) => ({ fileDataID: fdid, fileName: js('casc/listfile').getByIDOrUnknown(fdid) });

async function load_model(value, ctx = {}) {
	const { fileDataID, fileName } = resolve_file(value);
	if (file_type_of(fileDataID) !== 'model')
		throw new CLIError('unsupported-type', `${fileName} is not a model`,
			[action('inspect', `Inspect ${fileName}.`, 'inspect', { ...ctx, file: String(fileDataID) })]);

	const mvu = js('ui/model-viewer-utils');
	const data = await js('core').view.casc.getFile(fileDataID);
	const type = mvu.detect_model_type_by_name(fileName) ?? mvu.detect_model_type(data);
	const [kind, loader] = type === mvu.MODEL_TYPE_M2 ? ['M2', new (js('3D/loaders/M2Loader'))(data)]
		: type === mvu.MODEL_TYPE_WMO ? ['WMO', new (js('3D/loaders/WMOLoader'))(data, fileDataID)]
			: ['M3', new (js('3D/loaders/M3Loader'))(data)];
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
	const listfile = js('casc/listfile');
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

module.exports = { load_model, preview };
