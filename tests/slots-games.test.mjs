// Save slots for Orbit Lock and Light Trial (the shell's SAVE SLOT menu, engine/slots.js): both opt in
// and label each slot from its save. Ricochet stays on one save: it is a score attack whose upgrades
// last one run, so a second slot would only split its record.
import test from "node:test";
import assert from "node:assert/strict";
import { OrbitLock } from "../web/apps/orbit.js";
import { LightTrial } from "../web/apps/reaction.js";
import { Ricochet } from "../web/apps/ricochet.js";
import { makeCtx } from "./audit/harness.mjs";

test("Orbit Lock and Light Trial opt in to save slots; Ricochet does not", () => {
  assert.equal(OrbitLock.saveSlots, true);
  assert.equal(LightTrial.saveSlots, true);
  assert.ok(!Ricochet.saveSlots);
});

test("Orbit Lock's slot label: best run and open modes, from any save, never over 24 characters", () => {
  const g = new OrbitLock(makeCtx(1));
  assert.equal(g.slotSummary({}), "NO RUNS YET");
  assert.equal(g.slotSummary({ schema: 1, runs: 3, last: { locks: 14 } }), "BEST 14 LOCKS");
  assert.equal(g.slotSummary({ schema: 3, runs: 40, st: { best: 31, dark: 30 } }), "BEST 31 LOCKS · 3 MODES");
  assert.equal(g.slotSummary({ schema: 3, runs: 40, st: { best: 22 } }), "BEST 22 LOCKS · 2 MODES");
  for (const v of [null, 7, "x", [], { runs: 9, st: { best: 1e9, dark: 1e9 } }]) {
    const s = g.slotSummary(v);
    assert.equal(typeof s, "string"); assert.ok(s.length <= 24, s);
  }
});

test("Light Trial's slot label: rank and best series, from any save, never over 24 characters", () => {
  const g = new LightTrial(makeCtx(2));
  assert.equal(g.slotSummary({}), "NO SERIES YET");
  assert.equal(g.slotSummary({ schema: 1, runs: 12 }), "12 TRIALS, NO SERIES");
  assert.equal(g.slotSummary({ schema: 3, bs: { physical: 240, simulator: 200 } }), "SENTINEL · 240 ms");
  assert.equal(g.slotSummary({ schema: 3, bs: { simulator: 199 } }), "QUICKSILVER · 199 ms");
  for (const v of [null, 7, "x", [], { bs: { physical: 99999 }, st: { trials: 1e9 } }]) {
    const s = g.slotSummary(v);
    assert.equal(typeof s, "string"); assert.ok(s.length <= 24, s);
  }
});

test("a game on another slot reads and writes only what the shell gives it", () => {
  // The shell binds ctx.progress/saveProgress to the active slot; the game must not keep anything elsewhere.
  const c = makeCtx(3, { progress: { schema: 3, runs: 5, st: { best: 22 } } }), g = new OrbitLock(c);
  assert.equal(g.sv.st.best, 22);
  assert.ok(g.unlocked("rush"));
  const fresh = new OrbitLock(makeCtx(4, { progress: {} }));
  assert.equal(fresh.sv.st.best, 0);
  assert.ok(!fresh.unlocked("rush"), "a new slot starts with the modes closed");
});
