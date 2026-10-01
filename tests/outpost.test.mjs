import test from "node:test";
import assert from "node:assert/strict";
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
  assert.ok(first.minutes >= 30 && first.minutes <= 60, "first relocation worth doing at " + first.minutes + " min");
  assert.ok(second.minutes < first.minutes * 0.5, `second run ${second.minutes} min vs first ${first.minutes} min`);
  assert.ok(res[2].minutes < first.minutes * 0.5);
  assert.ok(first.gain >= 8);
});

test("a nearly idle player still gets there, slower", () => {
  const { res } = simulate({ runs: 2, active: 60, cycle: 600, checkin: 150 });
  assert.ok(res[0].minutes >= 30 && res[0].minutes <= 75, "casual first run " + res[0].minutes);
  assert.ok(res[1].minutes < res[0].minutes * 0.6);
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
  assert.equal(kinds[1], "all");
  const firstLocked = app.entries.findIndex((e, i) => i > 1 && !e.aff && (e.kind === "prod" || e.kind === "upg"));
  const lastAff = app.entries.map((e, i) => (e.aff && (e.kind === "prod" || e.kind === "upg") ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
  assert.ok(firstLocked === -1 || lastAff < firstLocked, "affordable entries come before unaffordable ones");
  assert.ok(app.entries.length <= 14);
  assert.ok(app.entries[app.ring.idx].aff, "the highlight starts on something affordable");
  advance(app, 0.8);
  const before = app.s.sig;
  app.ring.idx = 1; // BUY ALL
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
  app.s.own = [30, 25, 15, 8, 2, 0, 0, 0, 0, 0]; app.s.rt = 2e6; app.s.lt = 2e6; app.s.sig = 12345; app.s.maxTier = 4;
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
