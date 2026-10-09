const { test, expect, afterAll } = require('bun:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { REGIONS, FILE_TYPES, context_actions, ctx_args } = require('../../src/cli/envelope');

const ROOT = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wecli-src-'));
const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'wecli-empty-'));
afterAll(() => [tmp, empty].forEach(d => fs.rmSync(d, { recursive: true, force: true })));

const NETWORK = process.env.WOW_EXPORT_CLI_NETWORK === '1';

const spawn = (argv) => {
	const start = performance.now();
	const res = Bun.spawnSync(argv, { cwd: ROOT });
	const out = res.stdout.toString();
	expect(out.trim().split('\n').length).toBe(1);
	return { env: JSON.parse(out), code: res.exitCode, ms: performance.now() - start };
};
const run_cli = (args) => spawn([process.execPath, 'src/cli.js', ...args, '--data-dir', tmp]);

test('unknown region is a usage error listing valid tags', () => {
	const { env, code } = run_cli(['builds', '--source', 'remote:xx']);
	expect(code).toBe(1);
	expect(env.error.code).toBe('usage');
	expect(env.error.message).toContain('eu, us, kr, tw, cn');
});

test('malformed or missing source is a usage error', () => {
	expect(run_cli(['builds', '--source', 'nope']).env.error.code).toBe('usage');
	expect(run_cli(['builds']).env.error.code).toBe('usage');
});

test('non-install directory is source-not-found with one builds action per region', () => {
	const { env } = run_cli(['builds', '--source', 'local:' + empty]);
	expect(env.error.code).toBe('source-not-found');
	expect(env.actions.filter(a => a.rel === 'builds').map(a => a.request.args.source))
		.toEqual(REGIONS.map(r => 'remote:' + r));
	for (const a of env.actions)
		expect(a.command).toContain('--data-dir');
});

test('open on a non-install directory keeps --data-dir in recovery actions', () => {
	const { env } = run_cli(['open', '--source', 'local:' + empty, '--build', '0']);
	expect(env.error.code).toBe('source-not-found');
	for (const a of env.actions)
		expect(a.command).toContain('--data-dir');
});

test('non-integer build is a usage error', () => {
	expect(run_cli(['open', '--source', 'remote:us', '--build', 'abc']).env.error.code).toBe('usage');
});

// WE-1 gap: the entry envelope's builds actions are runnable now that the command exists
test('entry builds actions are accepted by the builds command', () => {
	const builds = run_cli([]).env.actions.filter(a => a.rel === 'builds');

	const local = builds.find(a => a.request.args.source.startsWith('local:'));
	const argv = local.command.map(c => c === local.request.args.source ? 'local:' + empty : c);
	expect(spawn(argv).env.error.code).toBe('source-not-found');

	// remote tags must pass source validation (resolving them needs the network)
	const sources = builds.map(a => a.request.args.source).filter(s => s.startsWith('remote:'));
	expect(sources.length).toBe(REGIONS.length);
	const script = `require('./src/cli').install_shims(${JSON.stringify(tmp)});
		const { parse_source, FILE_TYPE_LISTS } = require('./src/cli/context');
		const regions = ${JSON.stringify(sources)}.map(s => parse_source(s).region);
		process.stdout.write(JSON.stringify({ regions, types: Object.keys(FILE_TYPE_LISTS) }) + '\\n');`;
	expect(spawn([process.execPath, '-e', script]).env).toEqual({ regions: REGIONS, types: FILE_TYPES });
});

test('context_actions: one search per type then one across all', () => {
	const acts = context_actions(ctx_args('remote:us', 0, tmp));
	expect(acts.map(a => a.request.args.type)).toEqual([...FILE_TYPES, undefined]);
	expect(acts.every(a => a.rel === 'search' && a.request.args.build === 0)).toBe(true);
});

test.skipIf(!NETWORK)('remote builds list with open-build actions', () => {
	const { env, ms } = run_cli(['builds', '--source', 'remote:us']);
	expect(env.ok).toBe(true);
	expect(env.data.builds.length).toBeGreaterThan(0);
	for (const b of env.data.builds) {
		expect(typeof b.label).toBe('string');
		expect(Number.isInteger(b.index)).toBe(true);
		expect(b.action.rel).toBe('open-build');
	}
	expect(ms).toBeLessThan(10000);
}, 30000);

test.skipIf(!NETWORK)('out-of-range build is build-not-found', () => {
	expect(run_cli(['open', '--source', 'remote:us', '--build', '9999']).env.error.code).toBe('build-not-found');
}, 30000);

test.skipIf(!NETWORK)('open reports counts and search actions; warm open is faster', () => {
	const first = run_cli(['open', '--source', 'remote:us', '--build', '0']);
	expect(first.env.ok).toBe(true);
	expect(first.env.data.counts.model).toBeGreaterThan(0);
	expect(first.env.actions.filter(a => a.rel === 'search').length).toBe(6);
	const second = run_cli(['open', '--source', 'remote:us', '--build', '0']);
	expect(second.env.ok).toBe(true);
	expect(second.ms).toBeLessThan(first.ms);
}, 300000);

test('is_network_error recognises wrapped CDN failures', () => {
	const { is_network_error } = require('../../src/cli/context');
	expect(is_network_error(new Error('All download attempts failed.'))).toBe(true);
	expect(is_network_error(new Error('Unable to retrieve CDN config file ab/cd from any CDN host. Last error: Unable to connect'))).toBe(true);
	expect(is_network_error(Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' }))).toBe(true);
	expect(is_network_error(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toBe(true);
	expect(is_network_error(Object.assign(new Error('x'), { code: 'ENOTFOUND' }))).toBe(true);
	expect(is_network_error(Object.assign(new Error('x'), { code: 'ConnectionRefused' }))).toBe(true);
	expect(is_network_error(new Error('HTTP 404 from remote CASC endpoint: x'))).toBe(false);
	expect(is_network_error(new TypeError('x is undefined'))).toBe(false);
});
