// Checks every prompt in js/prompts.js against the deck rules in CONTRIBUTING.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const PROMPTS = require('../js/prompts.js');

const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const categories = Object.entries(PROMPTS);

test('there is at least one category', () => {
  assert.ok(categories.length >= 1);
});

for (const [name, list] of categories) {
  test(`category "${name}" is well formed`, () => {
    assert.ok(name.length >= 2 && name.length <= 20, 'category names are 2 to 20 characters');
    assert.equal(name, name.trim(), 'category name has no surrounding spaces');
    assert.ok(Array.isArray(list), 'category value is a list');
    assert.ok(list.length >= 12, `needs at least 12 prompts, has ${list.length}`);
  });

  test(`prompts in "${name}" follow the rules`, () => {
    for (const p of list) {
      assert.equal(typeof p, 'string', `not text: ${p}`);
      assert.equal(p, p.trim(), `extra spaces: "${p}"`);
      assert.ok(!/\s{2,}/.test(p), `double space: "${p}"`);
      assert.ok(p.length >= 4 && p.length <= 55, `4 to 55 characters: "${p}" (${p.length})`);
      assert.ok(!/[.!?,;:]$/.test(p), `no trailing punctuation: "${p}"`);
      assert.ok(p[0] === p[0].toLowerCase(), `start lowercase (the game capitalizes): "${p}"`);
    }
  });
}

test('no duplicate prompts anywhere in the deck', () => {
  const seen = new Map();
  for (const [name, list] of categories) {
    for (const p of list) {
      const key = norm(p);
      assert.ok(!seen.has(key), `"${p}" in ${name} duplicates "${seen.get(key)}"`);
      seen.set(key, `${p}" in ${name}`);
    }
  }
});
