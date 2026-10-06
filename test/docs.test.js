// Joshua Nunez
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { build } = require('../scripts/gen-docs');

test('docs/reference.md matches the code (run: node scripts/gen-docs.js)', () => {
  const written = fs.readFileSync(path.resolve(__dirname, '..', 'docs', 'reference.md'), 'utf8');
  assert.equal(written.trim(), build().trim());
});
