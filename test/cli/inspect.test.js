const { test, expect, afterAll } = require('bun:test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wecli-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

require('../../src/cli.js').install_shims(tmp);
const core = require('../../src/js/core');
core.view = {
	listfileModels: ['creature/murloc/murloc.m2 [125024]'],
	listfileTextures: ['creature/murloc/murloc.blp [7]'],
	listfileSounds: [], listfileText: [], listfileFonts: []
};
const { EXPORT_FORMATS, file_type_of, inspect } = require('../../src/cli/browse.js');
const { export_actions } = require('../../src/cli/envelope');
const { EncryptionError } = require('../../src/js/casc/blte-reader');

const ctx = { source: 'remote:us', build: 0 };

test('EXPORT_FORMATS lists model formats', () => {
	expect(EXPORT_FORMATS.model).toEqual(['OBJ', 'STL', 'GLTF', 'GLB', 'RAW']);
});

test('export_actions emits one export action per format with --out', () => {
	const acts = export_actions(ctx, { fileDataID: 1 }, ['PNG', 'RAW']);
	expect(acts.length).toBe(2);
	expect(acts.every(a => a.rel === 'export')).toBe(true);
	expect(acts[0].command.join(' ')).toContain('--format PNG');
	expect(acts[1].command.join(' ')).toContain('--format RAW');
	expect(acts[0].command).toContain('--out');
	expect(acts[0].request.args.file).toBe('1');
});

test('file_type_of categorises by list, else other', () => {
	expect(file_type_of(125024)).toBe('model');
	expect(file_type_of(7)).toBe('texture');
	expect(file_type_of(4)).toBe('other');
});

const with_reader = async (reader, fn) => {
	core.view.casc = { getFile: async () => reader() };
	try {
		return await fn();
	} finally {
		delete core.view.casc;
	}
};

const code_of = async (p) => {
	try {
		await p;
	} catch (e) {
		return e;
	}
	return null;
};

test('missing root entry maps to file-not-found', async () => {
	const err = await with_reader(() => { throw new Error('fileDataID does not exist in root: 42'); }, () => code_of(inspect('42')));
	expect(err.code).toBe('file-not-found');
});

test('unknown key maps to encrypted naming the key', async () => {
	const reader = () => ({ processAllBlocks() { throw new EncryptionError('ABCDEF0123456789'); } });
	const err = await with_reader(reader, () => code_of(inspect('42')));
	expect(err.code).toBe('encrypted');
	expect(err.message).toContain('ABCDEF0123456789');
});

test('numeric value not in the listfile is treated as an FDID', async () => {
	const res = await with_reader(() => ({ byteLength: 10 }), () => inspect('42'));
	expect(res).toEqual({ fileDataID: 42, fileName: 'unknown/42', type: 'other', size: 10, formats: ['RAW'] });
});

const run_cli = (args) => {
	const res = Bun.spawnSync([process.execPath, 'src/cli.js', ...args, '--data-dir', tmp], { cwd: ROOT });
	return JSON.parse(res.stdout.toString());
};

test('inspect without --file is usage', () => {
	expect(run_cli(['inspect', '--source', 'remote:us', '--build', '0']).error.code).toBe('usage');
	expect(run_cli(['inspect', '--source', 'remote:us', '--build', '0', '--file', '1', '--file', '2']).error.code).toBe('usage');
});

const net = test.skipIf(process.env.WOW_EXPORT_CLI_NETWORK !== '1');
const remote = ['inspect', '--source', 'remote:us', '--build', '0', '--file'];

net('inspect a model by FDID and by path', () => {
	const env = run_cli([...remote, '125024']);
	expect(env.ok).toBe(true);
	expect(env.data.fileName).toBe('creature/murloc/murloc.m2');
	expect(env.data.type).toBe('model');
	expect(env.data.size).toBeGreaterThan(0);
	expect(env.actions.filter(a => a.rel === 'export').length).toBe(5);
	expect(env.actions.map(a => a.rel)).toContain('preview');
	expect(env.actions.map(a => a.rel)).toContain('animations');
	expect(run_cli([...remote, 'creature/murloc/murloc.m2']).data.fileDataID).toBe(125024);
	expect(run_cli([...remote, '999999999']).error.code).toBe('file-not-found');
}, 300000);
