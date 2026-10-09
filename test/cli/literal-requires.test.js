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

// the compiled bundle is strict: an undeclared assignment is a ReferenceError
test('log.js sets getErrorDump on globalThis, not as an implicit global', () => {
	const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'js', 'log.js'), 'utf8');
	expect(src).not.toMatch(/^getErrorDump\s*=/m);
	expect(src).toMatch(/^globalThis\.getErrorDump\s*=/m);
});
