const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');

// bun build --compile only bundles statically analysable require('literal') calls
test('src/cli requires js modules by literal path only', () => {
	const dir = path.join(__dirname, '..', '..', 'src', 'cli');
	for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
		const src = fs.readFileSync(path.join(dir, f), 'utf8');
		expect(src).not.toMatch(/\bjs\('/);
		expect(src).not.toMatch(/require\((?!'[^']+'\))/);
	}
});
