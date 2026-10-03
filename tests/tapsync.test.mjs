// Timing calibration (web/apps/tapsync.js) and the console-wide offset (web/engine/latency.js):
// a steady delay is measured to within 5 ms, uneven or too few taps are not offered, the result is
// saved from Calibration, and the menu gesture abandons a calibration in progress.
import test from "node:test";
import assert from "node:assert/strict";
import { TapSync, measure, describe, BEAT_S, LEAD_BEATS, TAP_BEATS, MIN_TAPS } from "../web/apps/tapsync.js";
import { latencyMs, latencySec } from "../web/engine/latency.js";
import { Settings } from "../web/apps/utilities.js";
import { appContext } from "./helpers/app-context.mjs";
import { Random } from "../web/engine/math.js";

const DT = 1 / 60;
// Run a calibration in which every beat from `from` on is tapped `delayMs` late, plus jitter.
function run({ delayMs = 0, jitterMs = 0, from = 0, skip = () => false, seed = 3 } = {}) {
  const rng = new Random(seed), c = appContext();
  let result = null;
  const s = new TapSync(c, (r) => (result = r));
  const taps = [];
  for (let k = from; k < LEAD_BEATS + TAP_BEATS; k++) if (!skip(k)) taps.push(k * BEAT_S + (delayMs + (rng.next() * 2 - 1) * jitterMs) / 1000);
  for (let i = 0; i < 2000 && !result; i++) {
    s.update(DT);
    while (taps.length && s.t >= taps[0]) { taps.shift(); s.down(); s.up(); }
  }
  return { result, c, s };
}

test("a steady delay is measured within the frame-clock's resolution", () => {
  for (const delayMs of [0, 40, 60, 120, -30]) {
    const { result } = run({ delayMs, jitterMs: 15 });
    assert.ok(result.ok, `${delayMs} ms: ok`);
    assert.equal(result.n, TAP_BEATS, "the listen beats are not counted");
    assert.ok(Math.abs(result.ms - delayMs) <= 20, `${delayMs} ms measured as ${result.ms}`);
  }
});

test("too few taps, or taps all over the place, are not offered as a result", () => {
  const few = run({ delayMs: 50, skip: (k) => k % 3 !== 0 }).result;
  assert.ok(few.n < MIN_TAPS && !few.ok);
  const wild = run({ jitterMs: 250, seed: 9 }).result;
  assert.equal(wild.ok, false, "spread ±" + wild.spread);
  const none = run({ skip: () => true }).result;
  assert.deepEqual(none, { ms: 0, spread: 0, n: 0, ok: false });
});

test("measure rounds to 5 ms and stays inside the setting's range; describe reads it out", () => {
  assert.equal(measure(Array(10).fill(43)).ms, 45);
  assert.equal(measure(Array(10).fill(900)).ms, 300);
  assert.equal(measure(Array(10).fill(-900)).ms, -150);
  assert.equal(describe(45), "45 ms LATE");
  assert.equal(describe(-20), "20 ms EARLY");
  assert.equal(describe(0), "ON TIME");
});

test("latencyMs reads the setting safely", () => {
  assert.equal(latencyMs({}), 0);
  assert.equal(latencyMs({ latencyMs: 55 }), 55);
  assert.equal(latencyMs({ latencyMs: 9999 }), 300);
  assert.equal(latencyMs({ latencyMs: NaN }), 0);
  assert.equal(latencySec({ latencyMs: 60 }), 0.06);
});

test("the beat sounds and lights the lamps, and the lamps end dark", () => {
  const { c } = run({ delayMs: 30 });
  assert.equal(c.calls.tone.length, LEAD_BEATS + TAP_BEATS);
  assert.ok(c.calls.leds.some((v) => v.some((x) => x > 0)));
  assert.ok(c.calls.leds.at(-1).every((x) => x === 0));
});

test("Calibration runs the tap-along on the canvas, then offers to save the result", () => {
  const c = appContext();
  let staged = 0; c.restage = () => staged++;
  const s = new Settings(c);
  const row = c.currentActions.find((a) => a.id === "timing");
  assert.match(row.label, /TIMING OFFSET \/ ON TIME/);
  row.run();
  assert.equal(s.navigation, false, "raw input while tapping");
  assert.equal(staged, 1);
  const taps = [];
  for (let k = 0; k < LEAD_BEATS + TAP_BEATS; k++) taps.push(k * BEAT_S + 0.05);
  for (let i = 0; i < 2000 && s.sync; i++) { s.update(DT); while (taps.length && s.sync && s.sync.t >= taps[0]) { taps.shift(); s.down(); s.up(); } }
  assert.equal(s.navigation, true, "back to the panel");
  assert.equal(staged, 2);
  const save = c.currentActions.find((a) => a.id === "sync-save");
  assert.ok(save, "a steady result can be saved");
  save.run();
  const sent = c.calls.command.find(([name, data]) => name === "settings" && data.key === "latencyMs");
  assert.ok(sent && Math.abs(sent[1].value - 50) <= 15, JSON.stringify(sent));
});

test("the menu gesture abandons a calibration in progress and saves nothing", () => {
  const c = appContext(); c.restage = () => {};
  const s = new Settings(c);
  s.startSync();
  for (let i = 0; i < 120; i++) s.update(DT);
  s.cancel(); s.pause();
  assert.equal(s.sync, null);
  assert.equal(s.navigation, true);
  assert.ok(!c.calls.command.some(([name, data]) => name === "settings" && data?.key === "latencyMs"));
  assert.ok(c.currentActions.some((a) => a.id === "timing"), "the normal Calibration list is back");
});
