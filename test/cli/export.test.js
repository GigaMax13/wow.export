const { test, expect, afterAll } = require('bun:test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wecli-export-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

require('../../src/cli.js').install_shims(path.join(tmp, 'data'));
const core = require('../../src/js/core');
core.view = Object.assign(core.makeNewView(), {
	listfileModels: ['creature/murloc/murloc.m2 [125024]'],
	listfileTextures: [], listfileSounds: [], listfileText: [], listfileFonts: [],
	config: { overwriteFiles: true }
});
core.setToast = () => {};
const listfile = require('../../src/js/casc/listfile');
const { export_files } = require('../../src/cli/export');
const BufferWrapper = require('../../src/js/buffer');

const ctx = { source: 'remote:us', build: 0 };
const fresh = () => fs.mkdtempSync(path.join(tmp, 'out-'));
const caught = async (p) => {
	try {
		await p;
	} catch (e) {
		return e;
	}
	return null;
};

// bun shares the module registry across test files: put the real lookups back afterwards
const { getByFilename, getByID } = listfile;
afterAll(() => Object.assign(listfile, { getByFilename, getByID }));
listfile.getByFilename = () => undefined;
listfile.getByID = (id) => id === 125024 ? 'creature/murloc/murloc.m2' : `misc/${id}.txt`;
core.view.casc = { fileExists: (id) => id !== 999999999, getFile: async (id) => {
	if (id === 999999999)
		throw new Error('File 999999999 does not exist in root');
	return BufferWrapper.from(Buffer.from('raw-' + id));
} };

test('unsupported format rejects before writing, with export actions for valid formats', async () => {
	const out = fresh();
	const e = await caught(export_files({ files: ['125024'], format: 'png', out, ctx }));
	expect(e.code).toBe('unsupported-format');
	expect(e.actions.map(a => a.request.args.format)).toEqual(['OBJ', 'STL', 'GLTF', 'GLB', 'RAW']);
	expect(fs.readdirSync(out)).toEqual([]);
});

test('unwritable out → io', async () => {
	const e = await caught(export_files({ files: ['5'], format: 'RAW', out: '/dev/null/x', ctx }));
	expect(e.code).toBe('io');
});

test('one failing file does not stop the others', async () => {
	const out = fresh();
	const { results } = await export_files({ files: ['5', '999999999'], format: 'RAW', out, ctx });
	expect(results[0].ok).toBe(true);
	expect(results[0].paths).toEqual([path.join(out, 'misc/5.txt')]);
	expect(fs.readFileSync(results[0].paths[0], 'utf8')).toBe('raw-5');
	expect(results[1].ok).toBe(false);
	expect(results[1].error).toContain('999999999');
});

test('missing file fails per file under a non-RAW format', async () => {
	const { results } = await export_files({ files: ['999999999'], format: 'PNG', out: fresh(), ctx });
	expect(results[0].ok).toBe(false);
	expect(results[0].error).toContain('999999999');
	expect(results[0].paths).toEqual([]);
});

test('overwriteFiles false skips an existing target', async () => {
	const out = fresh();
	fs.mkdirSync(path.join(out, 'misc'));
	fs.writeFileSync(path.join(out, 'misc/6.txt'), 'keep');
	core.view.config.overwriteFiles = false;
	try {
		const { results } = await export_files({ files: ['6'], format: 'RAW', out, ctx });
		expect(results[0].ok).toBe(true);
		expect(fs.readFileSync(path.join(out, 'misc/6.txt'), 'utf8')).toBe('keep');
	} finally {
		core.view.config.overwriteFiles = true;
	}
});

const run_cli = (args) => {
	const res = Bun.spawnSync([process.execPath, 'src/cli.js', ...args, '--data-dir', path.join(tmp, 'data')], { cwd: ROOT });
	return JSON.parse(res.stdout.toString());
};
const net_ctx = ['--source', 'remote:us', '--build', '0'];

test('missing --file, --format or --out → usage', () => {
	const full = { '--file': '125024', '--format': 'OBJ', '--out': path.join(tmp, 'u') };
	for (const drop of Object.keys(full)) {
		const args = Object.entries(full).filter(([k]) => k !== drop).flat();
		expect(run_cli(['export', ...net_ctx, ...args]).error.code).toBe('usage');
	}
});

const net = test.skipIf(process.env.WOW_EXPORT_CLI_NETWORK !== '1');
const exp = (files, format, out = fresh()) =>
	run_cli(['export', ...net_ctx, ...files.flatMap(f => ['--file', String(f)]), '--format', format, '--out', out]);

net('model GLB', () => {
	const env = exp([125024], 'GLB');
	expect(env.ok).toBe(true);
	const glb = env.data.results[0].paths.find(p => p.endsWith('creature/murloc/murloc.glb'));
	expect(fs.readFileSync(glb).subarray(0, 4).toString()).toBe('glTF');
}, 300000);

net('model OBJ writes obj, mtl and png textures', () => {
	const paths = exp([125024], 'OBJ').data.results[0].paths;
	for (const ext of ['.obj', '.mtl', '.png'])
		expect(paths.some(p => p.endsWith(ext))).toBe(true);
}, 300000);

net('model PNG → unsupported-format', () => {
	const env = exp([125024], 'PNG');
	expect(env.error.code).toBe('unsupported-format');
	expect(env.actions.map(a => a.request.args.format)).toEqual(['OBJ', 'STL', 'GLTF', 'GLB', 'RAW']);
}, 300000);

net('texture PNG and WEBP', () => {
	const tex = run_cli(['search', ...net_ctx, '--type', 'texture', '--query', 'murloc', '--limit', '1']).data.entries[0];
	const png = exp([tex.fileDataID], 'PNG').data.results[0].paths[0];
	expect(png.endsWith('.png')).toBe(true);
	expect([...fs.readFileSync(png).subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
	const webp = exp([tex.fileDataID], 'WEBP').data.results[0].paths[0];
	expect(webp.endsWith('.webp') && fs.existsSync(webp)).toBe(true);
}, 300000);

net('sound RAW gets detected extension', () => {
	const snd = run_cli(['search', ...net_ctx, '--type', 'sound', '--limit', '1']).data.entries[0];
	const paths = exp([snd.fileDataID], 'RAW').data.results[0].paths;
	expect(paths.length).toBe(1);
	expect(/\.(ogg|mp3)$/.test(paths[0])).toBe(true);
}, 300000);

net('partial failure → export-failed with data', () => {
	const env = exp([125024, 999999999], 'RAW');
	expect(env.ok).toBe(false);
	expect(env.error.code).toBe('export-failed');
	expect(env.data.results[0].ok).toBe(true);
	expect(env.data.results[1].ok).toBe(false);
	expect(env.data.results[1].error).toBeTruthy();
}, 300000);

net('--out /dev/null/x → io', () => {
	expect(exp([125024], 'RAW', '/dev/null/x').error.code).toBe('io');
}, 300000);

net('same WMO exported twice is byte-identical', () => {
	const wmo = run_cli(['search', ...net_ctx, '--type', 'model', '--query', '.wmo', '--limit', '1']).data.entries[0];
	const obj = (env) => fs.readFileSync(env.data.results[0].paths.find(p => p.endsWith('.obj')));
	expect(obj(exp([wmo.fileDataID], 'OBJ')).equals(obj(exp([wmo.fileDataID], 'OBJ')))).toBe(true);
}, 600000);
