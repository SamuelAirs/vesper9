// The generator the host gives each app (Random.warm): the first draws after launch are no longer biased.
import test from "node:test";
import assert from "node:assert/strict";
import { Random, mixSeed } from "../web/engine/math.js";

// Chi-square of the first draw over `bins` equal bins, for launches `launches` milliseconds apart in a row.
function chiSquare(make, draws = 1, launches = 60000, bins = 100, start = 1790000000000) {
  const counts = Array(bins).fill(0);
  for (let i = 0; i < launches; i++) {
    const r = make(start + i);
    let v = 0;
    for (let k = 0; k < draws; k++) v = r.next();
    counts[Math.min(bins - 1, Math.floor(v * bins))]++;
  }
  const expected = launches / bins;
  return counts.reduce((sum, n) => sum + (n - expected) ** 2 / expected, 0);
}

test("the first draw of a plain Random seeded from consecutive milliseconds is measurably biased", () => {
  // 99 degrees of freedom: a fair generator scores about 99 (and almost never above 150).
  const plain = chiSquare((seed) => new Random(seed));
  assert.ok(plain > 300, "plain xorshift32 first-draw chi-square " + plain.toFixed(0));
});

test("Random.warm: the first draws after launch are as uniform as later ones", () => {
  for (const draws of [1, 2, 3, 8]) {
    const chi = chiSquare((seed) => Random.warm(seed), draws);
    assert.ok(chi < 150, `draw ${draws}: chi-square ${chi.toFixed(0)} over 100 bins`);
  }
  // Consecutive launches do not start alike either: the first two draws of neighbouring seeds are unrelated.
  let close = 0;
  for (let i = 0; i < 20000; i++) {
    const a = Random.warm(1790000000000 + i).next(), b = Random.warm(1790000000001 + i).next();
    if (Math.abs(a - b) < 0.01) close++;
  }
  assert.ok(close < 20000 * 0.02 * 1.5, "neighbouring launches are too alike: " + close);
});

test("Random.warm with no argument draws entropy, and an explicit seed stays reproducible", () => {
  const a = Random.warm(123), b = Random.warm(123);
  assert.deepEqual([a.next(), a.next(), a.next()], [b.next(), b.next(), b.next()]);
  assert.notEqual(Random.warm(123).next(), Random.warm(124).next());
  const firsts = new Set(Array.from({ length: 50 }, () => Random.warm().next()));
  assert.ok(firsts.size > 45, "launches in the same instant differ");
  assert.ok(Random.warm().next() < 1);
  // The plain constructor is unchanged, so every seeded test keeps its numbers.
  const plain = new Random(1979);
  assert.equal(plain.state, 1979);
});

test("mixSeed spreads nearby inputs over the whole range and never returns zero for small seeds", () => {
  const out = Array.from({ length: 1000 }, (_, i) => mixSeed(i));
  assert.equal(new Set(out).size, 1000);
  assert.ok(out.every((v) => v >= 0 && v <= 0xffffffff && Number.isInteger(v)));
  const high = out.filter((v) => v > 0x7fffffff).length;
  assert.ok(high > 400 && high < 600, "high bit balanced: " + high);
});
