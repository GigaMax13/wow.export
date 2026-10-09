const { test, expect, afterAll } = require('bun:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { validate_request } = require('../../src/cli.js');

const ROOT = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wecli-session-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const spawn = () => Bun.spawn([process.execPath, 'src/cli.js', 'session', '--data-dir', tmp],
	{ cwd: ROOT, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });

const session = async (lines) => {
	const proc = spawn();
	proc.stdin.write(lines.join('\n') + '\n');
	proc.stdin.end();
	const out = await new Response(proc.stdout).text();
	const code = await proc.exited;
	return { code, envs: out.split('\n').filter(Boolean).map(l => JSON.parse(l)) };
};

test('one envelope per line, usage errors keep the session alive', async () => {
	const { code, envs } = await session(['{"command":""}', 'not json', '{"command":"frobnicate"}', '{"command":"","args":{"nope":1}}']);
	expect(code).toBe(0);
	expect(envs.map(e => e.ok ? true : e.error.code)).toEqual([true, 'usage', 'usage', 'usage']);
});

test('exits with 0 within 5 s of stdin closing', async () => {
	const proc = spawn();
	proc.stdin.end();
	const start = Date.now();
	expect(await proc.exited).toBe(0);
	expect(Date.now() - start).toBeLessThan(5000);
});

test('blank lines are ignored', async () => {
	const { envs } = await session(['{"command":""}', '', '   ', '{"command":""}']);
	expect(envs.length).toBe(2);
});

test('actions carry a request that can be sent back unchanged', async () => {
	const { envs: [entry] } = await session(['{"command":""}']);
	for (const a of entry.actions) {
		expect(a.request.command === null || typeof a.request.command === 'string').toBe(true);
		expect(typeof a.request.args).toBe('object');
	}
	const back = entry.actions.find(a => a.rel === 'entry').request;
	expect(back.args['data-dir']).toBe(tmp);
	const { envs: [env] } = await session([JSON.stringify(back)]);
	expect(env.error?.code).not.toBe('usage');
});

test('validate_request normalises like parseArgs', () => {
	const { name, args } = validate_request({ command: 'search', args: { limit: 5, regex: true, file: '1' } });
	expect(name).toBe('search');
	expect(args.limit).toBe('5');
	expect(args.regex).toBe(true);
	expect(args.file).toEqual(['1']);
	for (const bad of [{ command: 'search', args: { regex: 'yes' } }, { command: 'session' }, [], { command: '', args: [] }])
		expect(() => validate_request(bad)).toThrow(expect.objectContaining({ code: 'usage' }));
});

test.skipIf(process.env.WOW_EXPORT_CLI_NETWORK !== '1')('an opened build is reused across requests, even after a failure', async () => {
	const proc = spawn();
	const reader = proc.stdout.getReader();
	const decoder = new TextDecoder();
	let buf = '';
	let err = '';
	(async () => {
		for await (const c of proc.stderr)
			err += decoder.decode(c);
	})();

	const ask = async (req) => {
		const start = Date.now();
		proc.stdin.write(JSON.stringify(req) + '\n');
		while (!buf.includes('\n')) {
			const { value, done } = await reader.read();
			if (done)
				throw new Error('session closed');
			buf += decoder.decode(value);
		}
		const i = buf.indexOf('\n');
		const env = JSON.parse(buf.slice(0, i));
		buf = buf.slice(i + 1);
		return { env, ms: Date.now() - start };
	};

	const ctx = { source: 'remote:us', build: 0 };
	expect((await ask({ command: 'open', args: ctx })).env.ok).toBe(true);
	const loaded = err.length;
	expect((await ask({ command: 'inspect', args: { ...ctx, file: '999999999' } })).env.ok).toBe(false);
	for (const req of [{ command: 'search', args: { ...ctx, type: 'model', query: 'murloc' } },
		{ command: 'animations', args: { ...ctx, file: '125024' } }]) {
		const { env, ms } = await ask(req);
		expect(env.ok).toBe(true);
		expect(ms).toBeLessThan(5000);
	}
	expect(err.length).toBe(loaded);
	proc.stdin.end();
	expect(await proc.exited).toBe(0);
}, 300000);
