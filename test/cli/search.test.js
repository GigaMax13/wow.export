const { test, expect, afterAll } = require('bun:test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wecli-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

require('../../src/cli.js').install_shims(tmp);
require('../../src/js/core').view = {
	listfileModels: ['creature/murloc/murloc.m2 [125024]', 'world/wmo/a.wmo [5]'],
	listfileTextures: ['creature/murloc/murloc.blp [7]'],
	listfileSounds: [], listfileText: [], listfileFonts: []
};
const { search, parse_page_args } = require('../../src/cli/browse.js');
const { file_actions } = require('../../src/cli/envelope');

const page = { offset: 0, limit: 100 };
const error_code = (fn) => {
	try {
		fn();
	} catch (e) {
		return e.code;
	}
	return null;
};

test('substring search is case-insensitive across all types', () => {
	const res = search({ query: 'MURLOC', ...page });
	expect(res.total).toBe(2);
	expect(res.entries).toEqual([
		{ fileDataID: 125024, fileName: 'creature/murloc/murloc.m2', type: 'model' },
		{ fileDataID: 7, fileName: 'creature/murloc/murloc.blp', type: 'texture' }
	]);
});

test('type filter limits to one list', () => {
	const res = search({ query: 'murloc', type: 'model', ...page });
	expect(res.entries.length).toBe(1);
	expect(res.entries[0].type).toBe('model');
});

test('numeric query finds the file by FDID', () => {
	expect(search({ query: '125024', ...page }).entries.map(e => e.fileDataID)).toContain(125024);
});

test('regex matches case-insensitively; bad regex is usage', () => {
	const res = search({ query: '^WORLD/.*\\.wmo', regex: true, ...page });
	expect(res.entries.map(e => e.fileName)).toEqual(['world/wmo/a.wmo']);
	expect(error_code(() => search({ query: '(', regex: true, ...page }))).toBe('usage');
});

test('zero matches is an empty page', () => {
	expect(search({ query: 'zzz', ...page })).toEqual({ entries: [], total: 0, offset: 0, limit: 100 });
});

test('paging returns exactly limit entries from offset', () => {
	const first = search({ query: '', offset: 0, limit: 1 });
	expect(first.entries.length).toBe(1);
	expect(first.total).toBe(3);
	expect(search({ query: '', offset: 2, limit: 1 }).entries[0].fileDataID).toBe(7);
});

test('parse_page_args caps limit and rejects bad values', () => {
	expect(parse_page_args({})).toEqual({ offset: 0, limit: 100, limitCapped: false });
	expect(parse_page_args({ limit: '5000' })).toEqual({ offset: 0, limit: 1000, limitCapped: true });
	for (const args of [{ offset: '-1' }, { limit: 'x' }, { limit: '0' }])
		expect(error_code(() => parse_page_args(args))).toBe('usage');
});

test('file_actions: inspect always, preview + animations for models', () => {
	const ctx = { source: 'remote:us', build: 0 };
	expect(file_actions(ctx, { fileDataID: 7, type: 'texture' }).map(a => a.rel)).toEqual(['inspect']);
	const acts = file_actions(ctx, { fileDataID: 5, type: 'model' });
	expect(acts.map(a => a.rel)).toEqual(['inspect', 'preview', 'animations']);
	expect(acts[0].request.args).toEqual({ ...ctx, file: '5' });
});

const run_cli = (args) => {
	const res = Bun.spawnSync([process.execPath, 'src/cli.js', ...args, '--data-dir', tmp], { cwd: ROOT });
	return JSON.parse(res.stdout.toString());
};

test('bad type or page args are usage before the context opens', () => {
	expect(run_cli(['search', '--source', 'remote:us', '--build', '0', '--type', 'bogus']).error.code).toBe('usage');
	expect(run_cli(['search', '--source', 'remote:us', '--build', '0', '--limit', 'x']).error.code).toBe('usage');
	expect(run_cli(['search', '--source', 'remote:us', '--build', '0', '--regex', '--query', '(']).error.code).toBe('usage');
});

test.skipIf(process.env.WOW_EXPORT_CLI_NETWORK !== '1')('remote model search pages with file actions', () => {
	const env = run_cli(['search', '--source', 'remote:us', '--build', '0', '--type', 'model', '--query', 'murloc', '--limit', '5']);
	expect(env.ok).toBe(true);
	expect(env.data.entries.length).toBe(5);
	const next = env.actions.find(a => a.rel === 'next-page');
	expect(next.command[next.command.indexOf('--offset') + 1]).toBe('5');
	for (const e of env.data.entries)
		expect(e.actions.map(a => a.rel)).toEqual(['inspect', 'preview', 'animations']);
}, 300000);
