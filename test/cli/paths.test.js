const { test, expect } = require('bun:test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

test('defaults the data dir to ~/.wow.export-cli when --data-dir is absent', () => {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wecli-home-'));
	try {
		const res = Bun.spawnSync([process.execPath, 'src/cli.js'], { cwd: ROOT, env: { ...process.env, HOME: home, USERPROFILE: home } });
		const env = JSON.parse(res.stdout.toString());
		expect(env.ok).toBe(true);
		expect(fs.existsSync(path.join(home, '.wow.export-cli', 'runtime.log'))).toBe(true);
		expect(env.actions[0].command).not.toContain('--data-dir');
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test('NW.js path: INSTALL_PATH and mmap.node path are unchanged', () => {
	const saved = globalThis.nw;
	const nw_dir = path.join(os.tmpdir(), 'nw-app');
	globalThis.nw = { __dirname: nw_dir, App: { dataPath: os.tmpdir(), manifest: { version: '0', flavour: 'x', guid: 'x' } } };
	const mod = require.resolve('../../src/js/constants');
	delete require.cache[mod];
	try {
		const constants = require(mod);
		const expected = process.platform === 'darwin' ? nw_dir : path.dirname(process.execPath);
		expect(constants.INSTALL_PATH).toBe(expected);
		expect(constants.resolve_mmap_path(expected, () => true)).toBe(path.join(expected, 'mmap.node'));
		expect(constants.resolve_mmap_path(expected, () => false))
			.toBe(path.join(expected, 'node_addons', 'mmap', 'build', 'Release', 'mmap.node'));
	} finally {
		delete require.cache[mod];
		globalThis.nw = saved;
	}
});
