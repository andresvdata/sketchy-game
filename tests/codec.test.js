// Tests for the drawing codec. Run with `npm test` (Node 18+, no dependencies).
const test = require('node:test');
const assert = require('node:assert/strict');
const codec = require('../js/codec.js');

function randomStrokes(n, seed = 1) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const strokes = [];
  for (let i = 0; i < n; i++) {
    const p = [];
    let x = Math.floor(rnd() * 1001), y = Math.floor(rnd() * 1001);
    const len = 1 + Math.floor(rnd() * 80);
    for (let k = 0; k < len; k++) {
      p.push([x, y]);
      x = Math.max(0, Math.min(1000, x + Math.floor((rnd() - 0.5) * 120)));
      y = Math.max(0, Math.min(1000, y + Math.floor((rnd() - 0.5) * 120)));
    }
    strokes.push({ ci: Math.floor(rnd() * 9), si: Math.floor(rnd() * 3), p });
  }
  return strokes;
}

test('encode then decode returns the same strokes', () => {
  const strokes = randomStrokes(60, 7);
  const back = codec.decode(codec.encode(strokes));
  assert.deepEqual(back, strokes);
});

test('encoded output only uses URL-safe characters and "."', () => {
  const enc = codec.encode(randomStrokes(40, 3));
  assert.match(enc, /^[A-Za-z0-9\-_.]*$/);
});

test('empty and garbage input decode without throwing', () => {
  assert.deepEqual(codec.decode(''), []);
  assert.deepEqual(codec.decode(null), []);
  assert.doesNotThrow(() => codec.decode('!!!.@@@.A'));
  assert.doesNotThrow(() => codec.decode('zzzzzzzzzzzzzzzz'));
});

test('decoded coordinates are clamped to the 0..1000 grid', () => {
  // A stroke that walks far off the grid via large deltas.
  const s = [{ ci: 0, si: 0, p: [[990, 990], [1000, 1000]] }];
  const enc = codec.encode(s) + 'zzzz'; // append junk deltas
  for (const stroke of codec.decode(enc)) {
    for (const [x, y] of stroke.p) {
      assert.ok(x >= 0 && x <= 1000 && y >= 0 && y <= 1000);
    }
  }
});

test('rdp keeps endpoints and removes collinear points', () => {
  const line = Array.from({ length: 50 }, (_, i) => [i * 10, i * 10]);
  const out = codec.rdp(line, 1);
  assert.deepEqual(out, [[0, 0], [490, 490]]);
});

test('rdp keeps corners', () => {
  const pts = [[0, 0], [100, 0], [200, 0], [200, 100], [200, 200]];
  assert.deepEqual(codec.rdp(pts, 1), [[0, 0], [200, 0], [200, 200]]);
});

test('chunk splits and rejoins losslessly', () => {
  const enc = codec.encode(randomStrokes(200, 11));
  const chunks = codec.chunk(enc, 950, 3);
  assert.equal(chunks.flat().join(''), enc);
  for (const c of chunks) {
    assert.ok(c.length <= 3);
    for (const piece of c) assert.ok(piece.length <= 950);
  }
});

test('chunk of an empty drawing is a single empty chunk', () => {
  assert.deepEqual(codec.chunk('', 950, 3), [['']]);
});

test('encodeFitted stays under the size limit', () => {
  const huge = randomStrokes(800, 5);
  const enc = codec.encodeFitted(huge, 20000);
  assert.ok(enc.length <= 20000, `got ${enc.length}`);
  assert.ok(codec.decode(enc).length > 0);
});

test('palette and brush sizes line up with the style alphabet', () => {
  assert.equal(codec.COLORS.length, codec.COLOR_NAMES.length);
  assert.equal(codec.ERASE, codec.COLORS.length);
  // style char = ALPH[colorIndex * 3 + sizeIndex] must stay inside the alphabet
  assert.ok((codec.ERASE * 3 + codec.SZ.length - 1) < codec.ALPH.length);
});
