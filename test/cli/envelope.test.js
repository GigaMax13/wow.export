const { test, expect, afterAll } = require('bun:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { to_argv, fail, ok, REGIONS } = require('../../src/cli/envelope');

const ROOT = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wecli-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const run_cli = (args) => {
	const res = Bun.spawnSync([process.execPath, 'src/cli.js', ...args, '--data-dir', tmp], { cwd: ROOT });
	const out = res.stdout.toString();
	expect(out.trim().split('\n').length).toBe(1);
	return { env: JSON.parse(out), code: res.exitCode };
};

test('no args returns entry envelope', () => {
	const { env, code } = run_cli([]);
	expect(code).toBe(0);
	expect(env.ok).toBe(true);
	const builds = env.actions.filter(a => a.rel === 'builds').map(a => a.command.join(' '));
	expect(builds.some(c => c.includes('local:<install-dir>'))).toBe(true);
	for (const r of REGIONS)
		expect(builds.some(c => c.includes('remote:' + r))).toBe(true);

	for (const a of env.actions) {
		expect(a.rel.length > 0 && a.description.length > 0 && a.command.length > 0).toBe(true);
		expect(a.command).toContain('--data-dir');
	}

	// only the entry action is runnable until the builds command exists
	const entry = env.actions.find(a => a.rel === 'entry');
	const res = Bun.spawnSync(entry.command, { cwd: ROOT });
	expect(JSON.parse(res.stdout.toString()).error?.code).not.toBe('usage');
	expect(fs.existsSync(path.join(tmp, 'runtime.log'))).toBe(true);
});

for (const bad of [['frobnicate'], ['--nope']]) {
	test(`usage error: ${bad}`, () => {
		const { env, code } = run_cli(bad);
		expect(code).not.toBe(0);
		expect(env.ok).toBe(false);
		expect(env.error.code).toBe('usage');
		expect(env.actions.some(a => a.rel === 'entry')).toBe(true);
	});
}

test('non-CLIError maps to internal', async () => {
	const cli = require('../../src/cli');
	cli.COMMANDS.boom = async () => { throw new Error('x'); };
	const env = await cli.run('boom', {});
	delete cli.COMMANDS.boom;
	expect(env.ok).toBe(false);
	expect(env.error.code).toBe('internal');
});

test('to_argv', () => {
	expect(to_argv('search', { a: 'x', b: true, c: false, d: [1, 2] }).slice(2))
		.toEqual(['search', '--a', 'x', '--b', '--d', '1', '--d', '2']);
});

test('ok/fail shapes', () => {
	expect(fail('io', 'm')).toMatchObject({ ok: false, error: { code: 'io', message: 'm' } });
	expect('error' in ok({})).toBe(false);
});
