const { test, expect, afterAll } = require('bun:test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wecli-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

require('../../src/cli.js').install_shims(tmp);
const { preview } = require('../../src/cli/models.js');

test('missing skin yields null skin counts and a warning', async () => {
	const loader = {
		vertices: new Array(9).fill(0), bones: [1], skins: [{ fileDataID: 555 }], animations: [1, 2],
		boundingBox: { min: [0, 0, 0], max: [1, 1, 1] }, textures: [],
		getSkin: async () => { throw new Error('Unable to load skin fileDataID 555'); }
	};
	const data = await preview('1', {}, { fileDataID: 1, fileName: 'x.m2', kind: 'M2', loader });
	expect(data.vertexCount).toBe(3);
	expect(data.triangleCount).toBeNull();
	expect(data.submeshCount).toBeNull();
	expect(data.animationCount).toBe(2);
	expect(data.groupCount).toBeNull();
	expect(data.warnings.length).toBe(1);
	expect(data.warnings[0]).toContain('555');
});

const run_cli = (args) => {
	const res = Bun.spawnSync([process.execPath, 'src/cli.js', ...args, '--data-dir', tmp], { cwd: ROOT });
	return JSON.parse(res.stdout.toString());
};
const ctx = ['--source', 'remote:us', '--build', '0'];

test('preview without --file is usage', () => {
	expect(run_cli(['preview', ...ctx]).error.code).toBe('usage');
});

const net = test.skipIf(process.env.WOW_EXPORT_CLI_NETWORK !== '1');

net('preview an M2 writes nothing and reports counts', () => {
	const exportDir = path.join(os.homedir(), 'wow.export');
	const list = () => fs.existsSync(exportDir) ? fs.readdirSync(exportDir) : [];
	const before = list();
	const env = run_cli(['preview', ...ctx, '--file', '125024']);
	expect(env.ok).toBe(true);
	expect(env.data).toMatchObject({ kind: 'M2', vertexCount: 641, triangleCount: 778, submeshCount: 2,
		boneCount: 59, animationCount: 32, warnings: [] });
	// murloc has 2 texture slots; one is a runtime (type) texture with FDID 0, which is not a file reference
	expect(env.data.textures.length).toBe(1);
	expect(env.actions.filter(a => a.rel === 'animations').length).toBe(1);
	expect(env.actions.filter(a => a.rel === 'export').length).toBe(5);
	expect(list()).toEqual(before);
	expect(fs.readdirSync(tmp).some(f => /\.(obj|gltf|glb|stl)$/i.test(f))).toBe(false);
}, 300000);

net('preview a WMO and reject a texture', () => {
	const wmo = run_cli(['search', ...ctx, '--type', 'model', '--query', '.wmo', '--limit', '1']).data.entries[0];
	const env = run_cli(['preview', ...ctx, '--file', String(wmo.fileDataID)]);
	expect(env.data.kind).toBe('WMO');
	expect(env.data.groupCount).toBeGreaterThan(0);
	expect(Array.isArray(env.data.doodadSets)).toBe(true);

	const tex = run_cli(['search', ...ctx, '--type', 'texture', '--limit', '1']).data.entries[0];
	const bad = run_cli(['preview', ...ctx, '--file', String(tex.fileDataID)]);
	expect(bad.error.code).toBe('unsupported-type');
	expect(bad.actions.map(a => a.rel)).toContain('inspect');
}, 600000);
