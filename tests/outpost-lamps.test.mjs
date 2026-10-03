// OUTPOST's lamps (web/apps/outpost-lamps.js): the status board, the note glow and the accents.
// Moved here from tests/outpost.test.mjs unchanged when the game was split into modules.
import test from "node:test";
import assert from "node:assert/strict";
import { Outpost } from "../web/apps/outpost.js";
import { appContext, run } from "./helpers/app-context.mjs";

const E = Outpost.econ;
const T0 = 1.8e12;
const realNow = Date.now;
let wall = T0;
test.beforeEach(() => { wall = T0; Date.now = () => wall; });
test.afterEach(() => { Date.now = realNow; });

const boot = (options) => {
  const ctx = appContext(options);
  const app = new Outpost(ctx);
  return { ctx, app };
};
// A started game: the first-launch card dismissed.
const begin = (options) => {
  const made = boot(options);
  if (made.app.phase_ !== "play") { made.app.down(); made.app.up({ durationMs: 50 }); }
  return made;
};
const advance = (app, seconds) => run(app, seconds, () => { wall += 1000 / 60; });
const press = (app, ms) => { app.down(); advance(app, ms / 1000); app.up({ durationMs: ms }); };
const tap = (app) => press(app, 60);

test("lamp values are nine whole numbers 0-255 and respond to play", () => {
  const { ctx, app } = begin();
  for (let i = 0; i < 40; i++) { tap(app); advance(app, 0.2); }
  app.s.sig = 50; app.dirty = true;
  advance(app, 10);
  for (const frame of ctx.calls.leds) {
    assert.equal(frame.length, 9);
    for (const v of frame) assert.ok(Number.isInteger(v) && v >= 0 && v <= 255, "lamp " + v);
  }
  assert.ok(new Set(ctx.calls.leds.map((f) => f.join())).size > 20, "lamps change during play");
  // sustained levels stay about a third of full
  const peak = Math.max(...ctx.calls.leds.slice(-300).map((f) => Math.max(...f)));
  assert.ok(peak <= 110, "sustained peak " + peak);
});

test("left lamp breathes faster as production grows, but never frantically", () => {
  const measure = (rate) => {
    const { ctx, app } = begin();
    app.s.own[0] = 1; app.rate = rate; app.out.fill(0); app.dirty = false; app.s.rt = 1e3;
    app.recalc(); app.rate = rate; // recalc recomputes it; force the value under test
    const frames = [];
    for (let i = 0; i < 60 * 40; i++) { app.rate = rate; app.update(1 / 60); frames.push(ctx.calls.leds.at(-1)[1]); }
    let crossings = 0;
    const mid = (Math.max(...frames) + Math.min(...frames)) / 2;
    for (let i = 1; i < frames.length; i++) if (frames[i - 1] < mid && frames[i] >= mid) crossings++;
    return crossings / 40;
  };
  const slow = measure(0), fast = measure(1e9);
  assert.ok(fast > slow * 2, `slow ${slow} Hz, fast ${fast} Hz`);
  assert.ok(fast < 1.0, "never frantic: " + fast + " Hz");
});

test("middle lamp fills toward the goal, then goes steady green when something is affordable", () => {
  const { ctx, app } = begin();
  app.s.rt = 100; app.s.sig = 2; app.dirty = true; app.recalc();
  app.update(1 / 60);
  const low = ctx.calls.leds.at(-1).slice(3, 6);
  app.s.sig = 8; app.dirty = true; app.update(1 / 60);
  const higher = ctx.calls.leds.at(-1).slice(3, 6);
  assert.ok(higher[0] > low[0], "amber grows as the goal nears");
  app.s.sig = 50; app.dirty = true; advance(app, 0.5);
  const green = ctx.calls.leds.at(-1).slice(3, 6);
  assert.ok(green[1] > green[0] * 2 && green[1] > 40, "green: " + green);
  const again = ctx.calls.leds.at(-1).slice(3, 6);
  advance(app, 0.4);
  assert.deepEqual(ctx.calls.leds.at(-1).slice(3, 6), again, "steady, not blinking");
});

test("right lamp shows an expedition, a boost, a flare, then relocation readiness", () => {
  const { ctx, app } = begin();
  const right = () => ctx.calls.leds.at(-1).slice(6, 9);
  advance(app, 0.1);
  assert.deepEqual(right(), [0, 0, 0]);
  app.s.tree[5] = 1; app.s.own[1] = 5; app.recalc();
  assert.ok(app.launch(1));
  tap(app); advance(app, 8);
  const a = right();
  assert.ok(a[1] > a[0] && a[2] > a[0], "cyan-ish: " + a);
  advance(app, 600); tap(app); advance(app, 8);
  const b = right();
  assert.ok(b[1] > a[1], "brighter as the trip progresses");
  app.boosts.push({ k: "surge", t: 20, max: 30, mult: 7 });
  advance(app, 0.2);
  const v = right();
  assert.ok(v[0] > v[1] && v[2] > v[1], "violet: " + v);
  app.boosts.length = 0;
  app.flare = { x: 400, y: 200, t: 10, life: 14 };
  const seen = new Set();
  for (let i = 0; i < 40; i++) { advance(app, 0.05); seen.add(right().join()); }
  assert.ok(seen.size >= 2, "a flare blinks");
});

test("after a few minutes without input the lamps drop to a very dim version", () => {
  const { ctx, app } = begin();
  app.s.own[1] = 20; app.s.rt = 1e4; app.s.sig = 5; app.dirty = true; app.recalc();
  advance(app, 5);
  const bright = Math.max(...ctx.calls.leds.slice(-200).flat());
  advance(app, 400);
  const quiet = Math.max(...ctx.calls.leds.slice(-300).flat());
  assert.ok(quiet <= bright * 0.45 && quiet <= 40, `bright ${bright} quiet ${quiet}`);
  tap(app); advance(app, 3);
  assert.ok(Math.max(...ctx.calls.leds.slice(-60).flat()) > quiet, "input wakes the display");
});

test("purchase, milestone and flare accents differ", () => {
  const frames = (setup) => {
    const { ctx, app } = begin();
    app.s.rt = 1e6; app.s.sig = 1e6; app.dirty = true; app.recalc();
    advance(app, 3);
    const n = ctx.calls.leds.length;
    setup(app);
    advance(app, 0.5);
    return ctx.calls.leds.slice(n).map((f) => f.join());
  };
  const buy = frames((a) => { a.accent = { k: "buy", t: 0, dur: 0.35 }; });
  const mile = frames((a) => { a.accent = { k: "milestone", t: 0, dur: 0.9 }; });
  const flare = frames((a) => { a.accent = { k: "event", t: 0, dur: 0.7 }; });
  assert.notDeepEqual(buy, mile);
  assert.notDeepEqual(buy, flare);
  assert.notDeepEqual(mile, flare);
});

test("the lamps follow the notes (low left, high right) and fall back to the status board", () => {
  const { app } = begin();
  app.s.sp = 0; tap(app); // C4 is the bottom of Twinkle's range
  const low = app.lampValues();
  advance(app, 0.5);
  app.s.sp = 4; tap(app); // A4 is the top
  const high = app.lampValues();
  const sum = (v, i) => v[i * 3] + v[i * 3 + 1] + v[i * 3 + 2];
  assert.ok(sum(low, 0) > sum(low, 2) + 100, "a low note lights the left lamp");
  assert.ok(sum(high, 2) > sum(high, 0) + 100, "a high note lights the right lamp");
  advance(app, 0.6);
  assert.equal(app.noteFx, null);
  const rest = app.lampValues();
  assert.ok(rest.every((x) => Number.isInteger(x) && x >= 0 && x <= 255));
  assert.ok(rest[0] < 60 && rest[1] > rest[0] && sum(rest, 2) === 0, "left breathes green, the right lamp shows nothing to report");
  app.s.sp = app.mel.ends[0]; tap(app);
  assert.equal(app.accent.k, "phrase");
  const sweep = [];
  for (let i = 0; i < 20; i++) { advance(app, 0.02); sweep.push(app.lampValues().join()); }
  assert.ok(new Set(sweep).size > 4, "the phrase flourish moves");
});

test("groove lights the note glow brighter, and cyan when full, on the lamp for the note", () => {
  const { app } = begin();
  advance(app, 2);
  app.accent = null; app.flare = null; app.boosts.length = 0;
  app.noteFx = { pos: 0, t: 0 };
  app.groove = 0;
  const plain = app.lampValues();
  app.groove = E.GROOVE_MAX;
  const full = app.lampValues();
  assert.ok(Math.max(...full.slice(0, 3)) > Math.max(...plain.slice(0, 3)), `brighter: ${plain} -> ${full}`);
  assert.ok(full[2] > full[0], "cyan in full groove: " + full);
  assert.deepEqual(full.slice(3), plain.slice(3), "the middle and right status lamps are unchanged");
});
