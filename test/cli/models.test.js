const { test, expect, afterAll } = require('bun:test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wecli-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

require('../../src/cli.js').install_shims(tmp);
const { preview, describe_animations } = require('../../src/cli/models.js');

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

test('describe_animations maps entries with names and durations', () => {
	expect(describe_animations({ animations: [{ id: 0, variationIndex: 0, duration: 1000, flags: 0 }] }))
		.toEqual([{ id: '0.0', animationId: 0, index: 0, name: 'Stand', duration: 1000 }]);
	expect(describe_animations({ animations: [{ id: 65000, variationIndex: 0, duration: 5, flags: 0 }] })[0].name)
		.toBe('UnknownAnim_65000');
	expect(describe_animations({ animations: [] })).toEqual([]);
});

test('describe_animations resolves aliases and survives self-loops', () => {
	const anims = describe_animations({ animations: [
		{ id: 0, variationIndex: 0, duration: 1000, flags: 0 },
		{ id: 0, variationIndex: 1, duration: 0, flags: 0x40, aliasNext: 0 }
	] });
	expect(anims[1].index).toBe(0);
	expect(anims[1].duration).toBe(1000);
	expect(describe_animations({ animations: [{ id: 4, variationIndex: 0, duration: 1, flags: 0x40, aliasNext: 0 }] })[0].index).toBe(0);
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

net('animations lists an M2 and rejects a WMO', () => {
	const env = run_cli(['animations', ...ctx, '--file', '125024']);
	expect(env.ok).toBe(true);
	const anims = env.data.animations;
	expect(anims.length).toBe(32);
	const names = anims.map(a => a.name);
	for (const n of ['Stand', 'Walk', 'Run'])
		expect(names).toContain(n);
	for (const a of anims) {
		expect(a.id).toMatch(/^\d+\.\d+$/);
		expect(typeof a.duration).toBe('number');
	}

	const wmo = run_cli(['search', ...ctx, '--type', 'model', '--query', '.wmo', '--limit', '1']).data.entries[0];
	expect(run_cli(['animations', ...ctx, '--file', String(wmo.fileDataID)]).error.code).toBe('unsupported-type');
}, 600000);
