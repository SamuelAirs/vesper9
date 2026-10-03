import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Outpost } from "../web/apps/outpost.js";
import { appContext, fakeCanvas, run } from "./helpers/app-context.mjs";
import { simulate } from "./helpers/outpost-bot.mjs";

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
const lastSave = (ctx) => ctx.calls.saved[ctx.calls.saved.length - 1];
const finiteDeep = (value, path = "s") => {
  if (typeof value === "number") assert.ok(Number.isFinite(value), path + " is " + value);
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) finiteDeep(v, path + "." + k);
};

// ---- the economy -------------------------------------------------------------------
test("cost and production formulas at several counts", () => {
  const s = E.freshState();
  for (const [i, n] of [[0, 0], [0, 10], [0, 50], [1, 25], [4, 100], [9, 300]]) {
    const want = Math.ceil(E.PROD[i].c * Math.pow(1.15, n));
    assert.equal(E.costOf(s, i, n), want, `cost of machine ${i} at ${n}`);
  }
  assert.equal(E.costOf(s, 0, 0), 10);
  // output: owned x base x milestone doublings x upgrades x global
  s.own[1] = 9;
  assert.ok(Math.abs(E.evaluate(s, null) - 9 * 1.2) < 1e-9);
  s.own[1] = 10; // the x10 milestone doubles it
  assert.ok(Math.abs(E.evaluate(s, null) - 10 * 1.2 * 2) < 1e-9);
  s.own[1] = 25;
  assert.ok(Math.abs(E.evaluate(s, null) - 25 * 1.2 * 4) < 1e-9);
  s.up[E.UPG.findIndex((u) => u.kind === "prod" && u.i === 1)] = 1;
  assert.ok(Math.abs(E.evaluate(s, null) - 25 * 1.2 * 8) < 1e-9);
  s.L = 10; // each bearing is +20%
  assert.ok(Math.abs(E.evaluate(s, null) - 25 * 1.2 * 8 * 3) < 1e-9);
  assert.ok(E.PROD.length >= 8, "a ladder of at least eight machines");
  for (let i = 1; i < E.PROD.length; i++) assert.ok(E.PROD[i].c > E.PROD[i - 1].c * 5 && E.PROD[i].r > E.PROD[i - 1].r * 3);
});

test("a synergy adds a percentage per source machine", () => {
  const s = E.freshState();
  s.own[0] = 5; s.own[1] = 20;
  const base = E.evaluate(s, null);
  const idx = E.UPG.findIndex((u) => u.kind === "syn" && u.dst === 0 && u.src === 1);
  s.up[idx] = 1;
  const dish = 5 * 0.2, mast = 20 * 1.2 * 2;
  assert.ok(Math.abs(base - (dish + mast)) < 1e-9);
  assert.ok(Math.abs(E.evaluate(s, null) - (dish * (1 + 0.02 * 20) + mast)) < 1e-9);
});

test("big numbers stay readable", () => {
  const cases = [[0, "0"], [7.35, "7.3"], [999, "999"], [1250, "1.25 K"], [12500, "12.5 K"], [125000, "125 K"], [3.4e6, "3.40 M"],
    [2.5e9, "2.50 B"], [1e12, "1.00 T"], [4.5e15, "4.50 Qa"], [1e33, "1.00 Dc"], [1e36, "1.00e36"], [2.5e120, "2.50e120"]];
  for (const [n, want] of cases) assert.equal(E.fmt(n), want, String(n));
  assert.equal(E.fmt(NaN), "0");
  assert.equal(E.fmt(Infinity), "MAX");
  assert.equal(E.fmt(-5), "0");
  assert.equal(E.dur(3 * 3600 + 5 * 60), "3 H 05 M");
});

// ---- a simulated player -------------------------------------------------------------
test("a mixed active/idle player reaches each layer on time, and the second run is much faster", () => {
  const { res } = simulate({ runs: 3, active: 150, cycle: 600, checkin: 150 });
  assert.equal(res.length, 3);
  const first = res[0], second = res[1];
  const L = first.layer;
  assert.ok(L["first machine"] < 0.25, "first machine within 15 s of play");
  assert.ok(L["first upgrade"] <= 5, "layer 2 (upgrades) within five minutes");
  assert.ok(L["first synergy"] <= 15, "synergies soon after");
  assert.ok(L["relocation shown"] >= 8, "the prestige layer is not shown at the very start");
  assert.ok(first.minutes >= 25 && first.minutes <= 60, "first relocation worth doing at " + first.minutes + " min");
  assert.ok(second.minutes < first.minutes * 0.8, `second run ${second.minutes} min vs first ${first.minutes} min`);
  assert.ok(res[2].minutes >= 8, "the third run is not a sprint: " + res[2].minutes + " min");
  assert.ok(first.gain >= 8);
});

test("a nearly idle player still gets there, slower", () => {
  const { res } = simulate({ runs: 2, active: 60, cycle: 600, checkin: 150 });
  assert.ok(res[0].minutes >= 30 && res[0].minutes <= 75, "casual first run " + res[0].minutes);
  assert.ok(res[1].minutes < res[0].minutes * 0.9);
});

test("a player who waits for bigger relocations reaches the deepest machine and stays finite", () => {
  const { res, app } = simulate({ runs: 6, maxMin: 300, ready: (s) => E.pendingOf(s) >= Math.max(8, s.L) });
  assert.ok(res.every((r) => r.minutes !== null), "every run finished");
  assert.ok(app.s.own[9] > 0, "the last machine was built");
  finiteDeep(app.s);
});

test("the first purchase comes within fifteen seconds of tapping through the interface alone", () => {
  const { app } = begin();
  const start = app.clk;
  while (app.s.sig < 10) { tap(app); advance(app, 0.3); } // about three taps a second
  press(app, 600); // hold: the ring opens
  assert.ok(app.ring, "the ring is open");
  advance(app, 0.9);
  press(app, 600); // hold on the highlighted machine
  assert.equal(app.s.own[0], 1);
  assert.ok(app.clk - start < 15, "first purchase after " + (app.clk - start) + " s");
});

// ---- the one-button interface -------------------------------------------------------
test("a tap gathers and shows a number; a hold opens the ring and the release does not choose", () => {
  const { ctx, app } = begin();
  tap(app);
  assert.equal(app.s.sig, 1);
  assert.ok(ctx.calls.tone.length >= 1);
  assert.ok(app.floats.some((f) => f.life > 0));
  app.s.sig = 500; app.dirty = true;
  app.down();
  advance(app, 0.5);
  assert.ok(app.ring, "ring open while still held");
  app.up({ durationMs: 500 });
  assert.equal(app.s.own.reduce((a, b) => a + b, 0), 0, "the release that opened the ring bought nothing");
  assert.equal(app.entries[0].kind, "close", "CLOSE is the first entry");
});

test("the ring puts affordable things first and offers buy-all", () => {
  const { app } = begin();
  app.s.sig = 5000; app.s.rt = 5000; app.s.maxTier = 2; app.dirty = true;
  app.recalc();
  app.openRing("main");
  const kinds = app.entries.map((e) => e.kind);
  assert.equal(kinds[0], "close");
  assert.deepEqual(kinds.slice(1, 3), ["panel", "sub"], "the statistics and songbook views sit right after CLOSE");
  const allAt = kinds.indexOf("all");
  assert.equal(allAt, 3, "buy-all follows the views");
  const firstLocked = app.entries.findIndex((e, i) => i > allAt && !e.aff && (e.kind === "prod" || e.kind === "upg"));
  const lastAff = app.entries.map((e, i) => (e.aff && (e.kind === "prod" || e.kind === "upg") ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
  assert.ok(firstLocked === -1 || lastAff < firstLocked, "affordable entries come before unaffordable ones");
  assert.ok(app.entries.length <= 18);
  assert.ok(app.entries[app.ring.idx].aff, "the highlight starts on something affordable");
  advance(app, 0.8);
  const before = app.s.sig;
  app.ring.idx = allAt; // BUY ALL
  app.ring.hiAt = app.clk - 1;
  press(app, 600);
  assert.ok(app.s.sig < before, "buy-all spent signal");
  assert.ok(app.s.own[0] > 1, "and bought several machines");
});

test("a hold on a freshly highlighted entry buys nothing (tap, tap, hold)", () => {
  const { app } = begin();
  app.s.sig = 5000; app.s.rt = 5000; app.s.maxTier = 1; app.dirty = true; app.recalc();
  app.openRing("main");
  advance(app, 1);
  tap(app); advance(app, 0.15); tap(app); advance(app, 0.15); // step twice
  const owned = app.s.own.join(), spent = app.s.sig;
  press(app, 500); // hold completes well inside the dwell
  assert.equal(app.s.own.join(), owned);
  assert.equal(app.s.sig, spent);
  // and the gesture's real shape: the hold goes on until the menu takes over and cancels
  tap(app); advance(app, 0.1);
  app.down(); advance(app, 0.9); app.cancel();
  assert.equal(app.s.own.join(), owned);
  assert.equal(app.ring, null);
  // after a steady pause the same hold does buy
  app.openRing("main"); advance(app, 1);
  const before = app.s.sig;
  press(app, 500);
  assert.ok(app.s.sig < before);
});

test("three quick taps then cancel gather, buy nothing and lose nothing", () => {
  const { ctx, app } = begin();
  tap(app); advance(app, 0.1); tap(app); advance(app, 0.1); tap(app);
  app.cancel();
  assert.equal(app.s.taps, 3);
  assert.equal(app.s.own.reduce((a, b) => a + b, 0), 0);
  assert.ok(ctx.calls.saved.length >= 1, "state saved on cancel");
  assert.deepEqual(ctx.calls.leds.at(-1), Array(9).fill(0));
});

test("the ring closes itself after a few seconds without input", () => {
  const { app } = begin();
  app.s.sig = 100; app.dirty = true; app.recalc();
  app.openRing("main");
  advance(app, 5);
  assert.ok(app.ring);
  advance(app, 3);
  assert.equal(app.ring, null);
});

test("relocation needs the deliberate path and a long hold", () => {
  const { app } = begin();
  app.s.rt = 1e9; app.s.sig = 0; app.dirty = true; app.recalc();
  assert.ok(app.pending() >= 8);
  app.openRing("main");
  const reloc = app.entries.findIndex((e) => e.kind === "sub" && e.sub === "reloc");
  assert.ok(reloc > 0);
  app.ring.idx = reloc; app.ring.hiAt = app.clk - 2;
  press(app, 600); // opens the confirmation list
  assert.equal(app.ring.menu, "reloc");
  assert.equal(app.s.runs, 0);
  advance(app, 1.5);
  app.ring.idx = 1; app.ring.hiAt = app.clk;
  press(app, 800); // too short and too soon
  assert.equal(app.s.runs, 0);
  advance(app, 1.5);
  app.ring.idx = 1;
  app.ring.hiAt = app.clk - 2;
  press(app, 1300);
  assert.equal(app.s.runs, 1);
  assert.ok(app.s.b >= 8);
});

test("relocating keeps bearings, tree and relics, resets the station, and the head start applies at once", () => {
  const { app } = begin();
  app.s.rt = 5e8; app.s.sig = 123; app.s.own[3] = 40; app.s.relics = 2; app.s.up[0] = 1; app.dirty = true; app.recalc();
  const p = app.pending();
  assert.ok(app.relocate());
  assert.equal(app.s.b, p);
  assert.equal(app.s.L, p);
  assert.equal(app.s.own[3], 0);
  assert.equal(app.s.up[0], 0);
  assert.equal(app.s.rt, 0);
  assert.equal(app.s.relics, 2);
  assert.equal(app.phase_, "card");
  assert.ok(app.buyNode(0), "head start level 1");
  assert.ok(app.s.own[0] >= 10 && app.s.sig >= 1000);
  assert.ok(app.rate > 0);
  assert.ok(app.buyNode(1) && app.tapValue() >= 2 * E.globalMult(app.s));
});

// ---- lamps ---------------------------------------------------------------------------
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

test("cancel and dispose leave the lamps off and the progress saved", () => {
  for (const how of ["cancel", "dispose", "pause"]) {
    const { ctx, app } = begin();
    tap(app); advance(app, 0.2);
    app[how]();
    assert.deepEqual(ctx.calls.leds.at(-1), Array(9).fill(0), how);
    assert.ok(ctx.calls.saved.length >= 1, how + " saves");
  }
});

// ---- offline progress and saving ------------------------------------------------------------
const midGame = () => {
  const made = begin();
  const { app } = made;
  app.s.own = [30, 25, 15, 8, 2, ...Array(E.NP - 5).fill(0)]; app.s.rt = 2e6; app.s.lt = 2e6; app.s.sig = 12345; app.s.maxTier = 4;
  app.s.up[0] = 1; app.s.up[3] = 1; app.s.taps = 321; app.dirty = true; app.recalc();
  app.save(true);
  return { ...made, saved: structuredClone(lastSave(made.ctx)), rate: app.rate };
};

test("saved state round-trips through a reload", () => {
  const { saved, app: a } = midGame();
  assert.equal(saved.v, E.SCHEMA);
  assert.ok(Number.isFinite(saved.t) && saved.t === wall);
  const { app: b } = boot({ progress: structuredClone(saved) });
  assert.deepEqual(b.s.own, a.s.own);
  assert.equal(b.s.sig, a.s.sig);
  assert.equal(b.s.taps, 321);
  assert.equal(b.s.up[0], 1);
  assert.equal(b.s.up[3], 1);
  assert.equal(b.s.up[1], 0);
  assert.equal(b.phase_, "play", "no summary after a moment away");
});

test("offline credit equals production over the time away, shown in a summary", () => {
  const { saved, rate } = midGame();
  wall += 3600 * 1000;
  const { app } = boot({ progress: structuredClone(saved) });
  assert.equal(app.phase_, "away");
  assert.equal(app.away.sec, 3600);
  assert.ok(Math.abs(app.away.gain - rate * 3600) < 1e-6 * rate * 3600);
  assert.ok(Math.abs(app.s.sig - (saved.sig + rate * 3600)) < 1e-6 * rate * 3600);
  assert.ok(app.s.lt > saved.lt);
  app.draw(fakeCanvas());
  app.down();
  assert.equal(app.phase_, "play");
  assert.equal(app.s.taps, 321, "the dismissing press did not gather");
});

test("offline credit is capped at eight hours, and the cap can be raised", () => {
  const { saved, rate } = midGame();
  wall += 100 * 3600 * 1000;
  const { app } = boot({ progress: structuredClone(saved) });
  assert.equal(app.away.sec, 8 * 3600);
  assert.ok(app.away.capped);
  assert.ok(Math.abs(app.away.gain - rate * 8 * 3600) < 1e-6 * rate * 8 * 3600);
  const raised = structuredClone(saved);
  raised.tree = [0, 0, 0, 2, 0, 0, 0, 0, 0, 0]; // deep storage: +8 h
  raised.up = [...raised.up, E.UPG.findIndex((u) => u.name === "BATTERY BANK I")];
  const { app: c } = boot({ progress: raised });
  assert.equal(c.away.sec, 20 * 3600);
});

test("a clock that moved backwards, or a save from the future, credits nothing and loses nothing", () => {
  const { saved } = midGame();
  wall -= 5000 * 1000; // the clock went back by 83 minutes
  const { app } = boot({ progress: structuredClone(saved) });
  assert.equal(app.s.sig, saved.sig);
  assert.equal(app.phase_, "away");
  assert.match(app.away.note, /CLOCK/);
  assert.equal(app.away.gain, 0);
  assert.deepEqual(app.s.own, saved.own);
  const future = structuredClone(saved);
  future.t = wall + 400 * 24 * 3600 * 1000;
  const { app: f } = boot({ progress: future });
  assert.equal(f.s.sig, saved.sig);
  assert.deepEqual(f.s.own, saved.own);
  // the next save carries a sane timestamp again
  f.save(true);
});

test("expeditions complete on the wall clock, in play and while away", () => {
  const { ctx, app } = begin();
  app.s.tree[5] = 2; app.s.own[2] = 10; app.s.rt = 1e5; app.dirty = true; app.recalc();
  assert.ok(app.launch(0)); assert.ok(app.launch(1));
  assert.equal(app.launch(2), false, "only two teams");
  const rate = app.rate, sig = app.s.sig;
  advance(app, 200); // the short survey (180 s) is back
  assert.equal(app.s.ex.length, 1);
  assert.ok(app.s.sig > sig + rate * 200 * 0.9 + rate * 60);
  app.save(true);
  const saved = structuredClone(lastSave(ctx));
  wall += 3600 * 1000;
  const { app: b } = boot({ progress: saved });
  assert.equal(b.s.ex.length, 0);
  assert.equal(b.away.found.length, 1);
  assert.equal(b.away.found[0].name, "FIELD TRAVERSE");
  // a clock moved far back never leaves a trip waiting longer than its length
  const odd = structuredClone(saved);
  odd.ex = [[2, wall + 400 * 24 * 3600 * 1000]];
  odd.t = wall - 10;
  const { app: c } = boot({ progress: odd });
  assert.ok(c.s.ex.length === 1 && c.s.ex[0].end - wall <= 5400 * 1000 + 1);
});

test("a flare appears, can be caught with a tap, and rewards the player", () => {
  const { app } = begin();
  app.s.rt = 1e4; app.dirty = true;
  let caught = 0;
  for (let i = 0; i < 6; i++) {
    app.flare = null; app.flareIn = 0.01;
    advance(app, 0.5);
    assert.ok(app.flare, "a flare appeared");
    const before = app.s.sig, boosts = app.boosts.length;
    tap(app);
    assert.equal(app.flare, null);
    assert.ok(app.s.sig > before || app.boosts.length > boosts);
    caught++;
  }
  assert.equal(caught, 6);
  assert.ok(app.boosts.length <= 4);
  app.flare = { x: 1, y: 1, t: 0.2, life: 14 };
  advance(app, 0.5);
  assert.equal(app.flare, null, "an uncaught flare fades");
});

test("older save shapes migrate without losing the outpost", () => {
  const v1 = { v: 1, ts: T0 - 10000, signal: 777, total: 5e5, prod: [12, 6, 2], upg: "1001", bearings: 5, relocs: 1, taps: 40 };
  const { s } = E.migrate(v1);
  assert.equal(s.sig, 777); assert.equal(s.rt, 5e5);
  assert.deepEqual(s.own.slice(0, 4), [12, 6, 2, 0]);
  assert.equal(s.up[0], 1); assert.equal(s.up[3], 1); assert.equal(s.up[1], 0);
  assert.equal(s.b, 5); assert.equal(s.L, 5); assert.equal(s.runs, 1); assert.equal(s.taps, 40);
  const noVersion = E.migrate({ signal: 10, prod: [3] }).s;
  assert.equal(noVersion.sig, 10); assert.equal(noVersion.own[0], 3);
  const { app } = boot({ progress: v1 });
  assert.equal(app.s.own[0], 12);
  app.save(true);
  assert.equal(lastSave(app.c).v, E.SCHEMA);
  // junk never throws and never poisons the state
  for (const junk of [null, undefined, 5, "x", [], { v: "no", own: "bad", up: 3, tree: { a: 1 }, sig: NaN, rt: -4, ex: [[9, 1], "x"], last: 4 },
    { v: 2, own: [1e99, -5, NaN, Infinity], up: [-1, 9999, "a"], tree: [99, 99], sig: Infinity }]) {
    const out = E.migrate(junk).s;
    finiteDeep(out);
    assert.ok(out.own.every((n) => n >= 0 && n <= 1500));
  }
});

test("a save from a newer version loads best-effort and keeps its unknown fields", () => {
  const { saved } = midGame();
  const newer = { ...saved, v: 7, shiny: { a: 1 }, level: 12 };
  const { app } = boot({ progress: newer });
  assert.deepEqual(app.s.own, saved.own);
  app.save(true);
  const out = lastSave(app.c);
  assert.deepEqual(out.shiny, { a: 1 });
  assert.equal(out.level, 12);
});

test("the save stays small late in the game", () => {
  const s = E.freshState();
  s.own.fill(1500); s.up.fill(1); s.tree = E.TREE.map((n) => n.max); s.sig = 1e149; s.rt = 1e149; s.lt = 1e149;
  s.L = 987654321; s.b = 123456789; s.relics = 20; s.runs = 999999; s.taps = 987654321012; s.play = 99999999; s.maxTier = 9;
  s.ex = [{ k: 2, end: 1.9e12 }, { k: 1, end: 1.9e12 }, { k: 0, end: 1.9e12 }];
  s.last = { signal: "1.00e149", bearings: 987654321, relocations: 999999 };
  const json = JSON.stringify(E.serialize(s, 1.9e12));
  assert.ok(json.length < 2000, "late save is " + json.length + " bytes");
  assert.ok(json.length < 8192);
  const back = E.migrate(JSON.parse(json)).s;
  assert.deepEqual(back.own, s.own);
  assert.equal(back.up.every((x) => x === 1), true);
});

test("no NaN or Infinity at the top of the range, in state, text, lamps or drawing", () => {
  const { ctx, app } = begin();
  const s = app.s;
  s.own.fill(1500); s.up.fill(1); s.tree = E.TREE.map((n) => n.max); s.sig = 1e149; s.rt = 1e149; s.lt = 1e149;
  s.L = 1e9; s.b = 1e9; s.relics = 20; s.maxTier = 9; s.tree[5] = 3;
  app.dirty = true; app.recalc();
  app.boosts.push({ k: "surge", t: 30, max: 30, mult: 7 }, { k: "frenzy", t: 15, max: 15, mult: 30 });
  const g = fakeCanvas();
  for (let i = 0; i < 30; i++) {
    run(app, 4, (k) => { if (k % 120 === 0) tap(app); });
    app.draw(g);
  }
  finiteDeep(app.s);
  assert.ok(Number.isFinite(app.rate) && Number.isFinite(app.tapValue()));
  app.buyAll(); app.pending(); app.recalc();
  for (const menu of ["main", "tree", "exp", "reloc"]) { app.openRing(menu); app.draw(g); app.closeRing(); }
  finiteDeep(lastSave(ctx));
  assert.ok(!/NaN|Infinity|undefined/.test(E.fmt(app.s.sig) + E.fmt(app.rate) + E.fmt(app.tapValue())), E.fmt(app.s.sig));
  for (const f of ctx.calls.leds) for (const v of f) assert.ok(Number.isInteger(v) && v >= 0 && v <= 255);
  assert.ok(JSON.stringify(lastSave(ctx)).length < 8192);
  // and a huge dt or a NaN dt cannot break anything
  app.update(1e9); app.update(NaN); app.update(-5);
  finiteDeep(app.s);
});

// ---- hygiene -------------------------------------------------------------------------
test("every screen draws, lists stay bounded, and the lifetime score rises", () => {
  const { ctx, app } = boot();
  const g = fakeCanvas();
  app.draw(g); // first-launch card
  app.down(); app.up({ durationMs: 50 });
  for (let i = 0; i < 300; i++) { tap(app); advance(app, 0.05); assert.ok(app.floats.length <= 12 && app.queue.length <= 16 && app.boosts.length <= 4); }
  app.draw(g);
  app.s.rt = 1e9; app.s.sig = 1e7; app.dirty = true; app.recalc();
  app.s.tree[5] = 1; app.s.L = 4; app.s.b = 4;
  for (const menu of ["main", "tree", "exp", "reloc"]) { app.openRing(menu); advance(app, 1); app.draw(g); app.closeRing(); }
  app.relocate(); app.draw(g);
  assert.ok(g.count.fillText > 50);
  assert.ok(ctx.calls.score.length >= 1);
  const scores = ctx.calls.score.map((x) => x[0]);
  assert.deepEqual(scores, [...scores].sort((a, b) => a - b));
  assert.ok(ctx.calls.hud.at(-1).length >= 2);
  assert.ok(ctx.calls.saved.every((x) => JSON.stringify(x).length < 8192));
});

test("update stays cheap", () => {
  const { app } = begin();
  app.s.own.fill(100); app.s.rt = 1e9; app.s.sig = 1e9; app.dirty = true;
  const g = fakeCanvas();
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 600; i++) { app.update(1 / 60); app.draw(g); }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 600;
  assert.ok(ms < 2, "update + draw averaged " + ms.toFixed(3) + " ms");
});

// ======================= schema 3: the song, statistics, goals, research =======================
const M = Outpost.music;
const hzNote = (hz) => Math.round(69 + 12 * Math.log2(hz / 440));
const fixture = (name) => JSON.parse(fs.readFileSync(new URL("./fixtures/" + name, import.meta.url), "utf8"));
// lead-voice notes played since tone call index `from`
const lead = (ctx, from) => ctx.calls.tone.slice(from).filter((c) => c[2] === "triangle" && c[1] >= 0.15).map((c) => hzNote(c[0]));

test("songbook: every melody is well formed and starts the way the printed tune does", (t) => {
  assert.ok(M.SONGS.length >= 15, "a good number of tunes");
  const anchors = {
    twinkle: "C4 C4 G4 G4 A4 A4 G4", ode: "E4 E4 F4 G4 G4 F4 E4 D4", jacques: "C4 D4 E4 C4 C4 D4 E4 C4", elise: "E5 D#5 E5 D#5 E5 B4 D5 C5 A4",
    greensleeves: "E4 G4 A4 B4 C5 B4 A4 F#4", scarborough: "E4 E4 B4 B4 F#4 G4 F#4 E4", grace: "D4 G4 B4 G4 B4 A4 G4 E4 D4",
    canon: "F#5 E5 D5 C#5 B4 A4 B4 C#5", jingle: "E4 E4 E4 E4 E4 E4 E4 G4 C4 D4 E4", row: "C4 C4 C4 D4 E4 E4 D4 E4 F4 G4",
    korobeiniki: "B4 F#4 G4 A4 G4 F#4 E4 E4", auld: "G3 C4 C4 C4 E4 D4 C4 D4", minuet: "D5 G4 A4 B4 C5 D5 G4 G4",
  };
  const ids = new Set();
  let prevAt = -1;
  M.SONGS.forEach((sg, i) => {
    const mel = M.MEL[i];
    assert.ok(!ids.has(sg.id)); ids.add(sg.id);
    assert.ok(sg.name.length <= 22, sg.name + " fits a ring row");
    assert.ok(sg.at >= prevAt); prevAt = sg.at;
    assert.ok(mel.n.length >= 16 && mel.n.length <= 130, sg.id + " length " + mel.n.length);
    assert.ok(mel.lo >= 53 && mel.hi <= 84, `${sg.id} range ${M.noteName(mel.lo)}..${M.noteName(mel.hi)} (about 175-1050 Hz)`);
    assert.ok(mel.ends.every((e, k) => e > (mel.ends[k - 1] ?? -1)) && mel.ends.at(-1) === mel.n.length - 1);
    assert.ok(mel.ends.length >= 2 && mel.ends[0] >= 2, "phrases kept");
    if (anchors[sg.id]) assert.equal(mel.n.slice(0, anchors[sg.id].split(" ").length).map(M.noteName).join(" "), anchors[sg.id], sg.id);
    let from = 0;
    t.diagnostic(sg.name + " (" + sg.by + ")  " + mel.ends.map((e) => { const s = mel.n.slice(from, e + 1).map(M.noteName).join(" "); from = e + 1; return s; }).join(" | "));
  });
  assert.equal(M.SONGS[0].at, 0, "the first tune is there from the start");
});

test("generated tunes: deterministic per seed, in range, stepwise, phrases end on stable tones", () => {
  const a = M.genTune(12345), b = M.genTune(12345);
  assert.deepEqual(a.n, b.n); assert.equal(a.name, b.name);
  assert.notDeepEqual(M.genTune(12346).n, a.n);
  let steps = 0, total = 0, leaps = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const mel = M.genTune(seed * 7919);
    assert.equal(mel.ends.length, 4); assert.equal(mel.n.length, 32);
    assert.ok(mel.lo >= 53 && mel.hi <= 84, "range " + seed);
    const scale = M.SCALES[mel.mode];
    const stable = new Set([0, scale[2], scale[mel.mode === "pent" ? 3 : 4]].map((i) => (mel.tonic + i) % 12));
    for (const e of mel.ends) assert.ok(stable.has(mel.n[e] % 12), `seed ${seed} phrase ends on ${M.noteName(mel.n[e])}`);
    assert.equal(mel.n[31] % 12, mel.tonic % 12, "last phrase ends on the tonic");
    for (let i = 1; i < mel.n.length; i++) { const d = Math.abs(mel.n[i] - mel.n[i - 1]); total++; if (d <= 4) steps++; if (d > 9) leaps++; }
    assert.ok(mel.n.every((m) => mel.pcs.has(m % 12)), "every note is in the scale");
  }
  assert.ok(steps / total > 0.8, "mostly stepwise: " + (steps / total).toFixed(2));
  assert.ok(leaps / total < 0.03, "wide leaps are rare: " + (leaps / total).toFixed(3));
  assert.equal(M.genName(1), M.genName(1));
});

test("each tap plays the next note at any tempo, wraps at the end, and a finished tune pays", () => {
  const { ctx, app } = begin();
  const mel = M.MEL[0], got = [];
  for (let i = 0; i < mel.n.length + 4; i++) {
    const before = ctx.calls.tone.length;
    tap(app);
    got.push(...lead(ctx, before));
    advance(app, [0.1, 0.5, 0.25][i % 3]);
  }
  assert.deepEqual(got, Array.from({ length: mel.n.length + 4 }, (_, i) => mel.n[i % mel.n.length]));
  assert.equal(app.s.st.md, 1); assert.equal(app.s.sc[0], 1);
  assert.equal(app.s.sp, 4);
  assert.ok(app.s.st.ph >= 5, "phrases counted");
  for (const c of ctx.calls.tone.filter((x) => x[2] === "triangle")) assert.ok(c[1] >= 0.15 && c[1] <= 0.6 && c[0] > 150 && c[0] < 1200);
  // two quick taps both sound (they overlap rather than cut each other)
  const n = ctx.calls.tone.length; tap(app); advance(app, 0.05); tap(app);
  assert.ok(lead(ctx, n).length >= 2);
});

test("a finished tune pays in proportion to the station, and phrase ends flash the lamps", () => {
  const { app } = begin();
  app.s.own[1] = 40; app.dirty = true; app.recalc();
  app.s.sp = app.mel.ends[0];
  const before = app.s.sig;
  tap(app); advance(app, 0.1);
  assert.equal(app.accent?.k, "phrase");
  app.s.sp = app.mel.n.length - 1;
  tap(app);
  assert.equal(app.accent?.k, "tune");
  assert.ok(app.s.st.hand > app.tapValue() * 3);
  assert.ok(app.s.sig > before);
  assert.match(app.note.text, /FIRST PLAYING|COMPLETE/);
});

test("songbook menu: choose a tune, preview on highlight, order modes, shuffle", () => {
  const { ctx, app } = begin();
  app.s.lt = 5000; app.s.rt = 5000; app.s.sig = 0;
  const enter = (key) => { app.ring.idx = app.entries.findIndex((e) => e.key === key); app.ring.hiAt = app.clk - 1; press(app, 600); };
  app.openRing("main");
  enter("songs");
  assert.equal(app.ring.menu, "songs");
  assert.ok(app.entries[app.ring.idx].cur, "the highlight starts on the current tune");
  const songs = app.entries.filter((e) => e.kind === "song").map((e) => e.i);
  assert.deepEqual(songs, [0, 1, 2, 3], "only unlocked tunes are listed");
  assert.ok(app.entries.some((e) => e.kind === "info" && /LOCKED/.test(e.label)));
  // a tap steps and tastes the first phrase of the tune it lands on; the next step replaces the taste
  const n = ctx.calls.tone.length;
  tap(app); advance(app, 0.3);
  assert.ok(app.entries[app.ring.idx].kind === "song");
  assert.ok(ctx.calls.tone.length > n + 2, "a preview played");
  tap(app);
  assert.ok(app.queue.filter((q) => q.pv).length <= 8);
  enter("s2"); // ODE TO JOY
  assert.equal(app.ring, null, "choosing closes the ring");
  assert.equal(app.s.sg, 2); assert.equal(app.s.sp, 0);
  const m = ctx.calls.tone.length; tap(app);
  assert.deepEqual(lead(ctx, m), [M.MEL[2].n[0]]);
  // order: shuffle moves to another tune when one is finished
  app.s.sm = 1; app.s.sp = app.mel.n.length - 1; advance(app, 0.5); tap(app);
  assert.notEqual(app.s.sg, 2); assert.equal(app.s.sp, 0);
});

test("composer's desk unlocks generated tunes; the seed is saved and the same tune returns", () => {
  const { app } = begin();
  app.s.lt = 5000; app.s.dat = 10;
  assert.ok(app.startResearch(0));
  wall += 400 * 1000; advance(app, 1.2);
  assert.ok(E.hasRes(app.s, 0));
  app.openRing("songs"); app.rebuild(true);
  assert.ok(app.entries.some((e) => e.kind === "songnew") && app.entries.some((e) => e.key === "gen"));
  app.s.gs = 424242; app.s.sg = M.GEN_ID; app.s.sp = 0; app.loadMelody();
  const name = app.mel.name, notes = app.mel.n.slice();
  app.save(true);
  const { app: b } = boot({ progress: structuredClone(lastSave(app.c)) });
  assert.equal(b.mel.name, name); assert.deepEqual(b.mel.n, notes);
  // endless mode composes a fresh tune after each one
  b.s.sm = 2; b.s.sp = b.mel.n.length - 1; b.phase_ = "play"; b.gather();
  assert.equal(b.s.sg, M.GEN_ID); assert.notEqual(b.s.gs, 424242);
});

test("menu gesture: taps that belonged to it take their notes back; a plain ring-opening hold too", () => {
  const { app } = begin();
  tap(app); advance(app, 0.2); tap(app); advance(app, 0.2);
  assert.equal(app.s.sp, 2);
  app.down(); advance(app, 1.0); // our own hold opens the ring at 0.42 s; the host then cancels at its own time
  assert.ok(app.ring);
  assert.equal(app.s.sp, 2, "the press that opened the ring did not move the tune");
  app.cancel();
  assert.equal(app.s.sp, 0, "the two taps of the gesture are taken back");
  assert.equal(app.s.taps, 3, "their signal stays");
  // and without a cancel: tap, then a hold that only opens the ring
  tap(app); advance(app, 0.5);
  press(app, 600);
  assert.equal(app.s.sp, 1);
  app.closeRing();
  const { ctx, app: c } = begin();
  const n = ctx.calls.tone.length; tap(c); advance(c, 0.3);
  assert.deepEqual(lead(ctx, n), [M.MEL[0].n[0]]);
  // across a wrap: the tune comes back to where the gesture started
  c.s.sp = c.mel.n.length - 1; advance(c, 1.5);
  tap(c); advance(c, 0.2); tap(c); advance(c, 0.2);
  c.down(); advance(c, 1.0); c.cancel();
  assert.equal(c.s.sp, c.mel.n.length - 1);
});

test("statistics: counts by source, persistence, and where counting began", () => {
  const { ctx, app } = begin();
  assert.equal(app.s.fk, 1, "a new outpost knows its founding date");
  for (let i = 0; i < 10; i++) { tap(app); advance(app, 0.2); }
  const st = app.s.st;
  assert.equal(app.s.taps, 10); assert.equal(st.rtaps, 10); assert.equal(st.nt, 10);
  assert.ok(st.hand >= 10 && st.mach === 0);
  app.s.own[0] = 5; app.dirty = true; app.recalc();
  advance(app, 30);
  assert.ok(st.mach > 0 && Math.abs(st.mach - app.rate * 30) < 0.02 * st.mach + 1e-6);
  assert.ok(Math.abs(app.s.lt - (st.hand + st.mach + st.off + st.bon)) < 1e-6 * app.s.lt, "lifetime equals the sum of the sources");
  assert.ok(st.peak >= app.rate && st.tp > 30);
  app.s.sig = 1e4; app.dirty = true; app.recalc(); assert.ok(app.buyProd(0)); assert.equal(st.buys, 1);
  app.save(true);
  const { app: b } = boot({ progress: structuredClone(lastSave(ctx)) });
  assert.deepEqual(b.s.st, { ...app.s.st, hand: b.s.st.hand, mach: b.s.st.mach, peak: b.s.st.peak, tp: b.s.st.tp, off: b.s.st.off, bon: b.s.st.bon, rhand: b.s.st.rhand, rmach: b.s.st.rmach });
  assert.equal(b.s.st.taps ?? 0, 0); assert.equal(b.s.st.nt, 10); assert.equal(b.s.fk, 1);
  assert.ok(Math.abs(b.s.st.hand - st.hand) < 0.01 * st.hand);
  // time away is counted and offline signal is its own figure
  wall += 7200 * 1000;
  const { app: c } = boot({ progress: structuredClone(lastSave(ctx)) });
  assert.equal(c.s.st.ta, 7200); assert.ok(c.s.st.off > 0);
});

test("the statistics view: reached from the ring, tap turns the page, hold closes, no notes while open", () => {
  const { ctx, app } = begin();
  app.s.st.hand = 1234567; app.s.fk = 0; app.s.f = T0;
  app.openRing("main");
  app.ring.idx = app.entries.findIndex((e) => e.key === "stats"); app.ring.hiAt = app.clk - 1;
  press(app, 600);
  assert.ok(app.panel && !app.ring);
  const taps = app.s.taps, tones = ctx.calls.tone.length;
  const g = fakeCanvas();
  for (let pg = 0; pg < 3; pg++) { app.draw(g); assert.equal(app.panel.page, pg); tap(app); advance(app, 0.1); }
  assert.equal(app.panel.page, 0, "pages wrap");
  assert.equal(app.s.taps, taps, "taps in the view do not gather");
  assert.ok(lead(ctx, tones).length === 0, "and play no melody notes");
  press(app, 600);
  assert.equal(app.panel, null);
  assert.match(E.fmtDate(T0), /^\d{1,2} [A-Z]{3} \d{4}$/);
  assert.equal(E.fmtInt(1234567), "1,234,567");
});

test("a save written by the current (schema 2) build loads, keeps everything, and gains the new features", () => {
  const old = fixture("outpost-save-v2-mid.json");
  assert.equal(old.v, 2);
  // upgrade indices never moved: the first fifty are exactly what the old build had
  const names = fixture("outpost-upgrades-v2.json");
  assert.deepEqual(E.UPG.slice(0, names.length).map((u) => [u.kind, u.name, u.cost]), names);
  wall = old.t + 30 * 1000;
  const { ctx, app } = boot({ progress: structuredClone(old) });
  const s = app.s;
  assert.deepEqual(s.own.slice(0, 10), old.own); assert.deepEqual(s.own.slice(10), [0, 0]);
  assert.deepEqual([...s.up].map((x, i) => (x ? i : -1)).filter((i) => i >= 0), old.up);
  assert.equal(s.taps, old.taps); assert.deepEqual(s.tree.slice(0, 10), old.tree); assert.deepEqual(s.tree.slice(10), [0, 0, 0]);
  assert.equal(s.relics, old.relics); assert.equal(s.runs, old.runs); assert.equal(s.L, old.L); assert.equal(s.b, old.b);
  assert.equal(s.maxTier, old.maxTier); assert.equal(s.play >= old.play, true); assert.deepEqual(s.last, old.last);
  assert.equal(s.ex.length, 1); assert.equal(s.ex[0].k, 1); assert.equal(s.ex[0].end, old.ex[0][1]);
  assert.ok(s.lt >= old.lt && s.sig >= old.sig, "nothing lost");
  // new features
  assert.equal(s.fk, 0, "counting began at the migration, and says so"); assert.equal(s.f, wall);
  assert.equal(s.st.nt, 0); assert.equal(s.sg, 0); assert.equal(s.sp, 0); assert.deepEqual(s.rd, []);
  assert.ok(s.gl.length >= 6, "goals already met are credited");
  assert.ok(s.dat >= 2 * s.gl.length && s.dat < 2 * s.gl.length + 2, "2 data per goal met, plus the away trickle");
  assert.equal(E.unlockedN(s), 11, "1.2 B lifetime signal opens eleven of the seventeen tunes at once");
  assert.equal(app.phase_, "news");
  assert.equal(ctx.calls.leds.length > 0, true);
  const g = fakeCanvas(); app.draw(g);
  app.down(); assert.equal(app.phase_, "play"); app.up({ durationMs: 40 });
  assert.equal(s.taps, old.taps, "the dismissing press did not gather");
  tap(app); assert.equal(s.taps, old.taps + 1);
  app.save(true);
  const saved = lastSave(ctx);
  assert.equal(saved.v, E.SCHEMA); assert.ok(JSON.stringify(saved).length < 8192);
  // the new save is a fixed point
  const { app: again } = boot({ progress: structuredClone(saved) });
  assert.equal(again.phase_, "play"); assert.deepEqual(again.s.gl, s.gl); assert.deepEqual(again.s.own, s.own); assert.equal(again.s.fk, 0);
  // junk in the new fields never poisons the state
  for (const bad of [{ ...saved, st: 5, gl: "x", rd: [99, -1], rs: [[9, 1]], sc: 3, sg: 77, gs: "no", sp: -4 }, { ...saved, st: { hand: NaN, tp: Infinity }, dat: -5 }]) {
    const out = E.migrate(bad).s; finiteDeep(out);
    boot({ progress: bad }).app.draw(g);
  }
});

test("goals pay +1% output and data, hidden ones fire on their trigger, and the next goal is shown", () => {
  const { app } = begin();
  const s = app.s;
  for (let i = 0; i < 100; i++) { tap(app); advance(app, 0.1); }
  advance(app, 1.2);
  assert.ok(s.gl.includes(0), "WARMING UP at 100 taps");
  assert.ok(s.dat >= 2);
  assert.ok(Math.abs(E.globalMult(s) - (1 + 0.01 * s.gl.length)) < 1e-9);
  assert.notEqual(app.nextGoal, null); assert.ok(!E.GOALS[app.nextGoal].hid);
  // presto: twelve taps inside under two seconds
  for (let i = 0; i < 12; i++) { app.gather(); advance(app, 0.1); }
  assert.ok(s.ev & E.EV.presto);
  advance(app, 1.2);
  assert.ok(s.gl.includes(E.GOALS.findIndex((x) => x.n === "PRESTO")));
  // a whole tune without stopping
  app.s.sp = 0; app.lastNoteAt = app.clk;
  for (let i = 0; i < app.mel.n.length; i++) { app.gather(); advance(app, 0.3); }
  assert.ok(s.ev & E.EV.perfect);
  // the goals list shows hints for hidden goals
  app.openRing("goals"); app.rebuild(true);
  assert.ok(app.entries.some((e) => e.label === "HIDDEN GOAL" && /HINT/.test(e.lines[0])));
});

test("research: costs data, runs on the wall clock (also while away), unlocks a machine and an expedition", () => {
  const { app } = begin();
  const s = app.s;
  s.lt = 2e11; s.rt = 2e11; s.dat = 500; s.tree[5] = 1; s.tree[11] = 1;
  assert.ok(!E.tierOpen(s, 10) && !app.buyProd(10));
  assert.ok(app.startResearch(0)); assert.ok(app.startResearch(3));
  assert.ok(!app.startResearch(4), "two benches only");
  assert.equal(s.dat, 500 - 4 - 40);
  assert.ok(!app.launch(3), "the far expedition needs its chart");
  wall += 6000 * 1000; advance(app, 1.2);
  assert.deepEqual(s.rd.slice().sort(), [0, 3]);
  assert.ok(app.launch(3), "far traverse unlocked");
  assert.ok(app.startResearch(4));
  s.sig = 0; app.save(true);
  wall += 4 * 3600 * 1000;
  const { app: b } = boot({ progress: structuredClone(lastSave(app.c)) });
  assert.equal(b.phase_, "away");
  assert.ok(b.away.done.includes("COLD STAR CHARTS"));
  assert.ok(E.tierOpen(b.s, 10) && !E.tierOpen(b.s, 11));
  b.s.sig = 1e14; b.s.rt = 1e14; b.dirty = true; b.recalc();
  assert.ok(b.buyProd(10));
  assert.ok(b.items.some((it) => it.key === "p10") || b.s.own[10] > 0);
  b.s.rd.push(5); assert.ok(E.tierOpen(b.s, 11));
  // a clock that went backwards never makes a project wait longer than its length
  const { app: c } = begin(); c.s.lt = 1e4; c.s.dat = 9; c.startResearch(0);
  c.s.rs[0].end = wall + 1e12; wall += 1000; c.collectResearch(wall, null);
  assert.ok(c.s.rs[0].end <= wall + 360 * 1000 + 1);
});

test("voices: upgrades need the research, add notes to each tap and make tunes pay more", () => {
  const { ctx, app } = begin();
  const s = app.s; s.lt = 1e7; s.rt = 1e7; s.sig = 1e9; s.dat = 50;
  app.dirty = true; app.recalc();
  assert.ok(!app.items.some((it) => it.key === "u" + E.VOICE[0]), "hidden before SECOND VOICE");
  s.rd.push(0, 1); app.dirty = true; app.recalc();
  assert.ok(app.items.some((it) => it.key === "u" + E.VOICE[0]) && !app.items.some((it) => it.key === "u" + E.VOICE[1]), "in order");
  const n0 = ctx.calls.tone.length; tap(app); const single = ctx.calls.tone.length - n0;
  for (const k of E.VOICE) { s.up[k] = 1; }
  advance(app, 1);
  const n1 = ctx.calls.tone.length; tap(app); const full = ctx.calls.tone.length - n1;
  assert.ok(full > single + 2, "more voices per tap");
  const hz = ctx.calls.tone.slice(n1).map((c) => c[0]);
  assert.ok(hz.every((h) => h > 50 && h < 4000 && Number.isFinite(h)));
  assert.equal(app.voices(), 4);
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

test("the late machines and new upgrades are valid, and the station grows in stages", () => {
  assert.equal(E.NP, 12); assert.equal(E.NS, M.SONGS.length);
  for (let i = 1; i < E.PROD.length; i++) assert.ok(E.PROD[i].c > E.PROD[i - 1].c * 5 && E.PROD[i].r > E.PROD[i - 1].r * 3);
  const s = E.freshState();
  assert.equal(E.stageOf(s), 0);
  for (let i = 0; i < 12; i++) { s.own[i] = 1; assert.ok(E.stageOf(s) <= 6); }
  assert.equal(E.stageOf(s), 6);
  const g = fakeCanvas();
  const { app } = begin();
  for (let k = 0; k <= 6; k++) { app.s.own.fill(0); for (let i = 0; i < [0, 1, 3, 5, 7, 9, 11][k]; i++) app.s.own[i] = 1; app.draw(g); }
  assert.ok(E.READY_RATIO === undefined || true);
  const r = E.freshState(); r.rt = 1.2e5 * 20 ** 4; r.L = 12;
  assert.equal(E.readyOf(r), false, "12 held, 20 on offer: not twice as many");
  r.L = 9; assert.equal(E.readyOf(r), true);
});

test("every menu and view draws, with the late-game state, without NaN", () => {
  const { ctx, app } = begin();
  const s = app.s, g = fakeCanvas();
  s.own.fill(1500); s.up.fill(1); s.tree = E.TREE.map((n) => n.max); s.sig = 1e149; s.rt = 1e149; s.lt = 1e149; s.L = 1e9; s.b = 1e9;
  s.dat = 1e11; s.rd = [0, 1, 2, 3, 4, 5]; s.gl = E.GOALS.map((_, i) => i); s.sc.fill(1e6); s.st.hand = 1e140; s.st.mach = 1e140; s.st.peak = 1e140;
  s.rs = [{ k: 5, end: wall + 1e6 }]; app.dirty = true; app.recalc();
  for (const menu of ["main", "songs", "res", "goals", "tree", "exp", "reloc"]) { app.openRing(menu); for (let i = 0; i < app.entries.length + 1; i++) { app.step(); advance(app, 0.05); app.draw(g); } app.closeRing(); }
  app.panel = { page: 0 }; for (let p = 0; p < 3; p++) { app.panel.page = p; app.draw(g); }
  app.panel = null; app.phase_ = "news"; app.draw(g); app.phase_ = "play";
  app.s.sg = M.GEN_ID; app.loadMelody(); for (let i = 0; i < 70; i++) { app.gather(); advance(app, 0.1); }
  finiteDeep(app.s); finiteDeep(lastSave(ctx) ?? {});
  assert.ok(app.queue.length <= 16);
  const json = JSON.stringify(E.serialize(app.s, 1.9e12));
  assert.ok(json.length < 4000, "late save with every new field is " + json.length + " bytes");
});

// ======================= schema 4: groove, quieter voices, constellations =======================
test("a schema 3 save (from the previous build) loads with everything kept and the new features at zero", () => {
  const old = fixture("outpost-save-v3-late.json");
  assert.equal(old.v, 3);
  wall = old.t + 20 * 1000;
  const { ctx, app } = boot({ progress: structuredClone(old) });
  const s = app.s;
  assert.deepEqual(s.own, old.own);
  assert.deepEqual([...s.up].map((x, i) => (x ? i : -1)).filter((i) => i >= 0), old.up);
  assert.deepEqual(s.tree, old.tree);
  for (const k of ["taps", "b", "L", "runs", "maxTier", "relics", "sg", "sp", "gs", "sm", "ev"]) assert.equal(s[k], old[k], k);
  assert.deepEqual(s.sc, old.sc); assert.deepEqual(s.gl.slice(0, old.gl.length), old.gl); assert.deepEqual(s.rd, old.rd);
  assert.deepEqual(s.rs.map((e) => [e.k, e.end]), old.rs);
  for (const k of Object.keys(old.st)) assert.ok(s.st[k] >= old.st[k], "statistic " + k + " kept"); // a few grow with the 20 s away
  assert.equal(s.fk, old.fk, "statistics are not restarted"); assert.equal(s.f, old.f);
  assert.ok(s.lt >= old.lt && s.sig >= old.sig && s.dat >= old.dat, "nothing lost");
  assert.equal(s.cn, 0); assert.equal(s.st.gb, 0); assert.equal(s.st.gt, 0);
  assert.equal(app.phase_, "news", "the update card says what is new");
  assert.equal(app.newsFrom, 3);
  const g = fakeCanvas(); app.draw(g);
  app.down(); app.up({ durationMs: 50 });
  assert.equal(app.phase_, "play");
  app.save(true);
  const saved = lastSave(ctx);
  assert.equal(saved.v, 4); assert.equal(saved.cn, 0);
  const again = boot({ progress: JSON.parse(JSON.stringify(saved)) }).app;
  assert.equal(again.phase_, "play", "a schema 4 save shows no update card");
  assert.deepEqual(again.s.own, s.own); assert.equal(again.s.taps, s.taps);
  assert.equal(E.migrate({ ...saved, cn: 1e9 }).s.cn, E.CHART_MAX);
  assert.equal(E.migrate({ ...saved, cn: "x" }).s.cn, 0);
});

test("the extra voices sit quietly under the lead: a fully voiced tap is about twice one note", () => {
  const { ctx, app } = begin();
  app.s.lt = 1e6;
  advance(app, 0.5);
  const n0 = ctx.calls.tone.length; app.gather();
  const single = ctx.calls.tone.slice(n0);
  assert.equal(single.length, 1);
  assert.ok(single[0][3] === undefined || single[0][3] === 1, "the lead alone is at full level");
  for (const k of E.VOICE) app.s.up[k] = 1;
  app.s.sp = 0; app.loadMelody();
  advance(app, 0.5);
  const n1 = ctx.calls.tone.length; app.gather();
  const full = ctx.calls.tone.slice(n1);
  assert.equal(full.length, 5, "lead, third, octave, bass and bell on the first note of a phrase");
  const gains = full.map((c) => c[3] ?? 1);
  assert.ok(gains.slice(1).every((x) => x > 0 && x <= 0.5), "every extra voice is at half the lead or less: " + gains);
  const sum = gains.reduce((a, b) => a + b, 0);
  assert.ok(sum <= 2.2, "the whole band sums to " + sum + " of one note (it was 5)");
});

test("groove: a steady beat builds it to x1.5, a stumble halves it, a pause lets it fade", () => {
  const { app } = begin();
  advance(app, 2);
  const base = app.tapValue();
  for (let i = 0; i < 40; i++) { app.gather(); advance(app, 0.3); }
  assert.equal(app.groove, E.GROOVE_MAX);
  assert.equal(app.grooveMult(), 1.5);
  assert.ok(app.tapValue() / base >= 1.5, "full groove: x" + app.tapValue() / base);
  assert.ok(app.s.ev & E.EV.groove);
  assert.ok(app.s.st.gt >= 5 && app.s.st.gb === E.GROOVE_MAX);
  // a stumble: one gap far off the beat
  advance(app, 0.4); app.gather();
  assert.equal(app.groove, E.GROOVE_MAX / 2);
  // a pause of a few seconds fades it away
  advance(app, 5);
  assert.equal(app.groove, 0);
  // irregular tapping never builds much
  const r = { v: 7 };
  for (let i = 0; i < 60; i++) { app.gather(); r.v = (r.v * 48271) % 2147483647; advance(app, 0.15 + (r.v % 100) / 100 * 0.6); }
  assert.ok(app.groove < E.GROOVE_MAX / 2, "random gaps: groove " + app.groove);
  // a slow steady beat counts too, and the header shows it
  for (let i = 0; i < 30; i++) { app.gather(); advance(app, 0.9); }
  assert.equal(app.groove, E.GROOVE_MAX);
  const g = fakeCanvas(); app.draw(g);
  app.checkGoals(false);
  assert.ok(app.s.gl.includes(E.GOALS.findIndex((x) => x.n === "IN THE POCKET")));
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

test("constellations: shown from 1000 bearings, each multiplies all output, costs grow, the sky draws them", () => {
  const { app } = begin();
  const s = app.s;
  s.L = 900; s.b = 900;
  app.openRing("tree");
  assert.ok(!app.entries.some((e) => e.kind === "chart"), "locked under 1000");
  assert.ok(app.entries.some((e) => e.key === "chartl"), "but announced");
  s.L = 1200; s.b = 5000;
  app.rebuild();
  const entry = app.entries.find((e) => e.kind === "chart");
  assert.ok(entry && entry.aff && entry.label === "CHART THE KEY");
  const g0 = E.globalMult(s);
  app.ring.idx = app.entries.indexOf(entry); app.downAge = 5;
  app.choose(entry, 1);
  assert.equal(s.cn, 1);
  assert.equal(s.b, 5000 - E.chartCost(0));
  assert.ok(Math.abs(E.globalMult(s) / g0 - E.CHART_MULT) < 1e-9);
  for (let k = 1; k < 20; k++) assert.ok(E.chartCost(k) > E.chartCost(k - 1));
  assert.equal(E.chartName(0), "THE KEY");
  assert.equal(E.chartName(12), "DEEP KEY 2");
  while (app.chartNext()) { /* spend */ }
  assert.ok(s.cn >= 4 && s.b < E.chartCost(s.cn));
  // a big sky draws within a modest budget
  s.cn = 40;
  const g = fakeCanvas();
  app.closeRing(); app.draw(g);
  assert.ok((g.count.lineTo || 0) < 400 && (g.count.fillRect || 0) < 200);
  finiteDeep(s);
});

test("relocation is called ready at twice the bearings held early, less once holdings are large", () => {
  assert.equal(E.readyRatio(10), 2);
  assert.equal(E.readyRatio(800), 1.6);
  assert.equal(E.readyRatio(8000), 1.35);
  assert.equal(E.readyRatio(50000), 1.25);
  const s = E.freshState();
  s.L = 8000; s.rt = E.PRESTIGE_K * Math.pow(8000 * 1.36, 4);
  assert.equal(E.readyOf(s), true);
  s.rt = E.PRESTIGE_K * Math.pow(8000 * 1.3, 4);
  assert.equal(E.readyOf(s), false);
});

test("the late game no longer walls: nine relocations, the eighth within two hours, constellations bought", () => {
  const { res, app } = simulate({ runs: 9, maxMin: 300 });
  console.log("late game minutes per run:", res.map((r) => r.minutes).join(" "), "constellations", app.s.cn);
  assert.ok(res.every((r) => r.minutes !== null), "every run finished");
  assert.ok(res[7].minutes < 120, "the eighth run took " + res[7].minutes + " min (it did not finish in four hours before)");
  assert.ok(app.s.cn >= 3);
  finiteDeep(app.s);
});
