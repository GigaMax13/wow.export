const { test, expect } = require('bun:test');
const fs = require('fs');

test('embed_webp_wasm serves the embedded encoder for the baked webp-wasm path', async () => {
	const { embed_webp_wasm } = require('../../src/cli.js');
	const read_file = fs.readFile;
	try {
		embed_webp_wasm();
		const buf = await new Promise((res, rej) => fs.readFile('/nowhere/webp-wasm/webp_node_enc.wasm', (e, b) => e ? rej(e) : res(b)));
		expect([...buf.subarray(0, 4)]).toEqual([0x00, 0x61, 0x73, 0x6d]);
		expect(await new Promise(res => fs.readFile('/nowhere/other.wasm', e => res(e?.code)))).toBe('ENOENT');
	} finally {
		fs.readFile = read_file;
	}
});
