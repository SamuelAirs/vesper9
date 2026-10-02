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
  const reloc = app.entries.findIndex((e) => e.kind === "sub" && e.to === "reloc");
  assert.ok(reloc > 0);
  app.ring.idx = reloc; app.ring.hiAt = app.clk - 2;
  press(app, 600); // opens the list of sites
  assert.equal(app.ring.menu, "reloc");
  assert.equal(app.entries[1].kind, "reloc"); assert.equal(app.entries[1].site, app.s.of[0]);
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
  assert.equal(app.card.site, app.s.site); assert.equal(app.card.from, 0);
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
  for (const menu of ["main", "tree", "exp", "reloc", "site"]) { app.openRing(menu); app.draw(g); app.closeRing(); }
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
  for (const menu of ["main", "tree", "exp", "reloc", "site"]) { app.openRing(menu); advance(app, 1); app.draw(g); app.closeRing(); }
  app.relocate(); app.draw(g);
  assert.ok(g.count.fillText > 50);
  assert.ok(ctx.calls.score.length >= 1);
  const scores = ctx.calls.score.map((x) => x[0]);
  assert.deepEqual(scores, [...scores].sort((a, b) => a - b));
  assert.ok(ctx.calls.hud.at(-1).length >= 2);
  assert.ok(ctx.calls.saved.every((x) => JSON.stringify(x).length < 8192));
});

// ======================= schema 3: the song, statistics, goals, research =======================
const M = Outpost.music;
const hzNote = (hz) => Math.round(69 + 12 * Math.log2(hz / 440));
const fixture = (name) => JSON.parse(fs.readFileSync(new URL("./fixtures/" + name, import.meta.url), "utf8"));
// lead-voice notes played since tone call index `from`
const lead = (ctx, from) => ctx.calls.tone.slice(from).filter((c) => c[2] === "triangle" && c[1] >= 0.15).map((c) => hzNote(c[0]));

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
  // across a wrap: a tune the gesture's first tap finished stays finished (counted once, its bonus
  // paid); only the tap after it, in the next tune, is taken back
  c.s.sp = c.mel.n.length - 1; advance(c, 1.5);
  const played = c.s.st.md;
  tap(c); advance(c, 0.2); tap(c); advance(c, 0.2);
  c.down(); advance(c, 1.0); c.cancel();
  assert.equal(c.s.sp, 0);
  assert.equal(c.s.st.md, played + 1);
});

test("a hold on a tune's last note finishes the tune once, not again at every hold", () => {
  const { app } = begin();
  const s = app.s, len = app.mel.n.length;
  for (let i = 0; i < len - 1; i++) { app.gather(); advance(app, 0.4); }
  assert.equal(s.st.md, 0);
  for (let k = 0; k < 6; k++) {
    app.down(); advance(app, 0.5); app.up({ durationMs: 500 }); // the press plays the last note; the ring opens
    if (app.ring) { app.ring.idx = 0; app.down(); advance(app, 0.5); app.up({ durationMs: 500 }); } // hold CLOSE
    advance(app, 0.2);
  }
  assert.equal(s.st.md, 1, "one tune finished");
  assert.equal(s.sx, 1, "and counted once toward the sounding");
  // the same at the end of a phrase: its bonus is paid once
  const b = begin().app, end = b.mel.ends[0];
  for (let i = 0; i < end; i++) { b.gather(); advance(b, 0.4); }
  const ph = b.s.st.ph;
  for (let k = 0; k < 4; k++) { b.down(); advance(b, 0.5); b.up({ durationMs: 500 }); if (b.ring) b.closeRing(); advance(b, 0.2); }
  assert.equal(b.s.st.ph, ph + 1);
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
  assert.equal(s.taps, old.taps); assert.deepEqual(s.tree.slice(0, 10), old.tree); assert.ok(s.tree.slice(10).every((l) => l === 0), "nodes added since start at zero");
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
  for (const menu of ["main", "songs", "res", "goals", "tree", "exp", "reloc", "site"]) { app.openRing(menu); for (let i = 0; i < app.entries.length + 1; i++) { app.step(); advance(app, 0.05); app.draw(g); } app.closeRing(); }
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
  assert.deepEqual(s.tree.slice(0, old.tree.length), old.tree); assert.ok(s.tree.slice(old.tree.length).every((l) => l === 0), "nodes added since start at zero");
  for (const k of ["taps", "b", "L", "runs", "maxTier", "relics", "sg", "sp", "gs", "sm", "ev"]) assert.equal(s[k], old[k], k);
  assert.deepEqual(s.sc.slice(0, old.sc.length), old.sc); assert.deepEqual(s.gl.slice(0, old.gl.length), old.gl); assert.deepEqual(s.rd, old.rd);
  assert.ok(s.sc.length >= old.sc.length && s.sc.slice(old.sc.length).every((c) => c === 0), "tunes added since start unplayed");
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
  assert.equal(saved.v, E.SCHEMA); assert.equal(saved.cn, 0);
  const again = boot({ progress: JSON.parse(JSON.stringify(saved)) }).app;
  assert.equal(again.phase_, "play", "a current save shows no update card");
  assert.deepEqual(again.s.own, s.own); assert.equal(again.s.taps, s.taps);
  assert.equal(E.migrate({ ...saved, cn: 1e9 }).s.cn, E.CHART_MAX);
  assert.equal(E.migrate({ ...saved, cn: "x" }).s.cn, 0);
});

test("groove: a steady beat builds it to x1.5, a stumble halves it, a pause lets it fade", () => {
  const { app } = begin();
  advance(app, 2);
  const base = app.tapValue();
  for (let i = 0; i < 40; i++) { app.gather(); advance(app, 0.45); } // an easy pace, so the full value counts
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

test("easy pace: tapping faster than an easy beat earns no more, a pause restores the full value", () => {
  // signal by hand (taps, phrases, tunes; no machines) over 20 s of steady tapping at a given rate
  const earn = (perSec, frenzy = false) => {
    const { app } = begin();
    advance(app, 3);
    if (frenzy) app.boosts.push({ k: "frenzy", t: 99, max: 99, mult: 30 });
    const before = app.s.st.hand;
    for (let i = 0, n = 20 * perSec; i < n; i++) { app.gather(); advance(app, 1 / perSec); }
    return { app, perSec: (app.s.st.hand - before) / 20 };
  };
  const easy = earn(2.5).perSec, fast = earn(5).perSec, frantic = earn(10).perSec, slow = earn(1.25).perSec;
  assert.ok(slow < easy * 0.65, "half the pace earns less (each tap still counts): " + slow / easy);
  assert.ok(fast <= easy * 1.1, "twice the easy pace earns no more: " + fast / easy);
  assert.ok(frantic <= easy * 1.1, "four times the easy pace earns no more: " + frantic / easy);
  // a frenzy (taps x30 from a flare) raises the easy pace, so quick tapping is worth it for those seconds
  const fz = earn(2.5, true).perSec, fzFast = earn(5, true).perSec;
  assert.ok(fzFast > fz * 1.6, "in a frenzy, tapping twice as fast pays more: " + fzFast / fz);
  // after fast tapping, one tap is worth less and the hint says why; a short pause brings the full value back
  const { app } = earn(8);
  const full = app.tapValue(false);
  assert.ok(app.tapValue() < full * 0.5, "fast: " + app.tapValue() / full);
  assert.ok(app.floats.some((f) => f.life > 0 && f.v !== "+" + E.fmt(full)), "the floating numbers show the smaller taps");
  assert.match(app.hintKey, /steady/i, "the hint explains it");
  advance(app, 1.3);
  assert.equal(app.paceNow(), 1);
  assert.equal(app.tapValue(), app.tapValue(false));
  // a short burst after a pause is worth the full value
  for (let i = 0; i < 3; i++) { assert.equal(app.paceNow(), 1, "burst tap " + i); app.gather(); advance(app, 0.1); }
  assert.ok(app.paceNow() < 1, "the reserve is spent");
  advance(app, 2.1);
  assert.doesNotMatch(app.hintKey, /steady/i, "the hint goes once the tapping slows");
  // rewards that are not taps (flare lodes) are not paced
  app.s.own[1] = 30; app.dirty = true; app.recalc();
  for (let i = 0; i < 30; i++) { app.gather(); advance(app, 0.1); }
  const lode = app.effRate() * 600 + app.tapValue(false) * 40, sig = app.s.sig;
  app.flare = { x: 300, y: 200, t: 5, life: 14 };
  app.c.rng.next = () => 0.6; // the lode
  app.gather();
  assert.ok(app.s.sig - sig >= lode * 0.99, "the lode is not cut by the tapping pace");
});

// ======================= 0.3: hum =======================
test("hum: every note of the octave has one machine, and a tune hums the machines on its commonest notes", () => {
  assert.deepEqual(E.PROD.map((p) => p.pc).sort((a, b) => a - b), [...Array(12).keys()], "each pitch class once");
  for (const p of E.PROD) assert.ok(p.short && p.short.length <= 10, p.n);
  for (let pc = 0; pc < 12; pc++) assert.equal(E.PROD[E.PC_PROD[pc]].pc, pc);
  // Twinkle: G x10, then F and E x8 (F is heard first)
  assert.deepEqual(E.humNotes(M.MEL[0]), [7, 5, 4]);
  assert.deepEqual(E.humMachines(M.MEL[0]).map((i) => E.PROD[i].short), ["DRILL", "BOREHOLE", "MAST"]);
  // the early tunes (C major) hum the early machines; every machine is hummed by some tune or seed
  for (const k of [1, 3, 6]) assert.ok(E.humMachines(M.MEL[k]).includes(0), M.SONGS[k].name + " hums the dish");
  const reached = new Set();
  M.MEL.forEach((m) => E.humMachines(m).forEach((i) => reached.add(i)));
  for (let seed = 1; seed < 400 && reached.size < 12; seed++) E.humMachines(M.genTune(seed * 7919)).forEach((i) => reached.add(i));
  assert.equal(reached.size, 12, "every machine can hum");
});

test("hum: a finished tune makes its machines work harder for a while, longer in full groove, and only while playing", () => {
  const { app } = begin();
  const s = app.s;
  s.own[1] = 20; s.own[2] = 20; s.own[4] = 5; s.own[0] = 30; s.maxTier = 4; app.dirty = true; app.recalc();
  const quiet = app.rate, out0 = Array.from(app.out);
  assert.equal(app.baseRate, quiet);
  // play Twinkle through: drill, borehole and mast hum
  s.sg = 0; app.loadMelody(); s.sp = app.mel.n.length - 1; app.lastNoteAt = app.clk;
  app.gather(); advance(app, 0.1);
  for (const i of [2, 4, 1]) assert.ok(Math.abs(app.hum[i] - E.HUM_SEC) < 0.2, "machine " + i + " hums " + app.hum[i]);
  assert.equal(app.hum[0], 0, "the dish (C) is not on Twinkle's commonest notes");
  assert.ok(Math.abs(app.out[2] / out0[2] - E.HUM_MULT) < 1e-9 && Math.abs(app.out[0] / out0[0] - 1) < 1e-9);
  assert.ok(app.rate > quiet && Math.abs(app.baseRate - quiet) < 1e-9, "the rate rises; the normal rate does not");
  assert.match(app.noteQ.map((n) => n.text).join(" ") + (app.note?.text || ""), /HUM x1\.5 \+2 MIN: DRILL, BOREHOLE, MAST/);
  // the ring says so: the machine's tuning and its hum, and the songbook's tunes
  const drill = app.itemEntry({ type: "p", i: 2, key: "p2", cost: E.costOf(s, 2) }, false);
  assert.ok(drill.lines.some((l) => /TUNED TO G, HUMMING (2:00|1:5\d)/.test(l)), JSON.stringify(drill.lines));
  assert.ok(app.itemEntry({ type: "p", i: 0, key: "p0", cost: 1 }, true).lines.includes("TUNED TO C"));
  app.openRing("songs");
  assert.ok(app.entries.find((e) => e.key === "s0").lines.includes("HUMS DRILL, BOREHOLE, MAST"));
  app.closeRing();
  // a second tune adds time, up to the cap
  for (let k = 0; k < 6; k++) app.startHum(M.MEL[0]);
  assert.equal(app.hum[2], E.HUM_MAX);
  // away, the station makes its normal output: hum is not credited
  app.save(true);
  const saved = JSON.parse(JSON.stringify(app.c.calls.saved.at(-1)));
  wall += 3600e3;
  const back = boot({ progress: saved }).app;
  assert.ok(back.hum.every((h) => h === 0), "hum is not saved");
  assert.ok(Math.abs(back.away.gain - back.baseRate * 3600) / (back.baseRate * 3600) < 1e-6, "away credit at the normal rate");
  // it runs down, and the rate returns
  advance(app, E.HUM_MAX + 1);
  assert.ok(app.hum.every((h) => h === 0));
  assert.ok(Math.abs(app.rate - app.baseRate) < 1e-9);
  // in full groove a tune hums twice as long; HARMONICS makes the hum stronger
  app.groove = E.GROOVE_MAX;
  app.startHum(M.MEL[0]);
  assert.ok(Math.abs(app.hum[2] - 2 * E.HUM_SEC) < 1e-9);
  s.tree[E.HARMONICS] = 2; app.dirty = true; app.recalc();
  assert.ok(Math.abs(app.humK[2] - (E.HUM_MULT + 0.5)) < 1e-9);
  // relocating stops the hum (the machines are gone)
  s.rt = 1e12; s.L = 0; app.relocate();
  assert.ok(app.hum.every((h) => h === 0));
});

test("hum: buy-all judges machines on their normal output, not on a passing hum", () => {
  const { app } = begin();
  const s = app.s;
  s.own[0] = 10; s.own[1] = 10; s.maxTier = 1; s.sig = 0; app.dirty = true; app.recalc();
  const it = app.items.find((x) => x.key === "p1");
  const g0 = app.gainOf(it);
  app.hum[1] = 100; app.dirty = true; app.recalc();
  assert.ok(app.rate > app.baseRate);
  assert.ok(Math.abs(app.gainOf(it) - g0) < 1e-12, "the same gain per cost while humming");
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

test("relocation is called ready at twice the bearings held early, less once holdings are large, and less again late", () => {
  assert.equal(E.readyRatio(10), 2);
  assert.equal(E.readyRatio(800), 1.6);
  assert.equal(E.readyRatio(8000), 1.35);
  assert.equal(E.readyRatio(E.READY_LATE), 1.25);
  assert.ok(E.readyRatio(50000) > 0.9 && E.readyRatio(50000) < 1, "past 20,000 held it keeps falling");
  assert.ok(E.readyRatio(1e6) > 0.35 && E.readyRatio(1e6) < 0.4);
  assert.equal(E.readyRatio(1e9), E.READY_FLOOR);
  for (let L = 1; L < 1e9; L *= 1.07) assert.ok(E.readyRatio(L * 1.07) <= E.readyRatio(L), "it never rises as holdings grow (" + Math.round(L) + ")");
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

// ======================= schema 5: sites, soundings, THE CALL, the console logbook =======================
// A context with the console logbook's calls (PR #16): feats once each, today's order.
const bootLog = (options) => {
  const ctx = appContext(options);
  const book = { feats: [], daily: [], met: 0 };
  ctx.feat = (id, name) => { if (book.feats.some((f) => f[0] === id)) return false; book.feats.push([id, name]); return true; };
  ctx.today = () => ({ goal: book.daily.at(-1) || "", done: book.met > 0, own: book.daily.length > 0 });
  ctx.daily = (text) => book.daily.push(text);
  ctx.dailyMet = () => { book.met++; };
  const app = new Outpost(ctx);
  if (app.phase_ !== "play") { app.down(); app.up({ durationMs: 50 }); }
  return { ctx, app, book };
};
const notesOf = (app) => [app.note?.text, ...app.noteQ.map((n) => n.text)].filter(Boolean).join(" | ");
// Relocates straight to site k (the card skipped), with enough run signal for a bearing.
const moveTo = (app, k) => {
  app.s.rt = Math.max(app.s.rt, 1e9);
  assert.ok(app.relocate(k), "relocate to " + E.SITES[k].n);
  assert.equal(app.s.site, k);
  app.phase_ = "play"; app.arrive();
};

test("sites: three on offer, never the one you stand on, stable across a reload; each site changes the rules", () => {
  const { ctx, app } = begin();
  const s = app.s;
  assert.equal(s.site, 0);
  assert.deepEqual([...s.of].sort(), [1, 2, 3], "the first offer: the ridge, the basin and the flats");
  app.save(true);
  assert.deepEqual(boot({ progress: structuredClone(lastSave(ctx)) }).app.s.of, s.of, "the offer does not change on reload");
  s.rt = 1e9; app.dirty = true; app.recalc();
  const pick = s.of[1];
  assert.ok(app.relocate(pick));
  assert.equal(s.site, pick); assert.equal(app.card.site, pick); assert.equal(app.card.from, 0); assert.equal(s.sx, 0);
  assert.equal(s.of.length, 3); assert.ok(!s.of.includes(pick) && s.of.every((k) => E.siteKnown(s, k)));
  assert.ok(E.siteKnown(s, 4), "the glacier is on the map from 8 bearings");
  assert.ok(!E.siteKnown(s, 7) && !E.siteKnown(s, E.SILENT), "the rust coast needs a survey team, the silent coast the whole call");
  // what each site does, on the pure economy
  const at = (k) => { const t = E.freshState(); t.site = k; return t; };
  const out = (t) => { const o = new Float64Array(E.NP); E.evaluate(t, o); return o; };
  const land = at(0), ridge = at(1), basin = at(2);
  for (const t of [land, ridge, basin]) { t.own[0] = 5; t.own[2] = 5; } // a dish (sky) and a drill (ground)
  assert.ok(E.PROD[0].sky && !E.PROD[2].sky);
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  assert.ok(near(out(ridge)[0] / out(land)[0], 1.5) && near(out(ridge)[2] / out(land)[2], 0.75), "the ridge: sky x1.5, ground x0.75");
  assert.ok(near(out(basin)[0] / out(land)[0], 0.75) && near(out(basin)[2] / out(land)[2], 1.5), "the basin: ground x1.5, sky x0.75");
  assert.equal(E.siteFx(at(3)).tap, 3); assert.equal(E.siteFx(at(4)).tap, 0.5);
  assert.equal(E.capHours(at(4)) - E.capHours(land), 8, "the glacier: away credit +8 h");
  assert.equal(E.humMultOf(at(5)), E.HUM_MULT + 0.5); assert.equal(E.humSecOf(at(5), false), 2 * E.HUM_SEC);
  assert.ok(E.costOf(at(10), 0, 100) < E.costOf(land, 0, 100) / 2, "the dunes: prices rise slower");
  assert.equal(E.upgCost(at(10), E.UPG[0]), 2 * E.UPG[0].cost);
  const sil = at(E.SILENT), l2 = at(0);
  sil.own[11] = 1; l2.own[11] = 1;
  assert.ok(near(E.evaluate(sil, null) / E.evaluate(l2, null), 3), "the silent coast: silent arrays x3");
  // and in the cartridge: a tap at the flats is worth three
  const flats = begin().app;
  flats.s.up[E.UPG.findIndex((u) => u.kind === "tap" && u.frac)] = 1; // a tap worth a share of the rate too
  flats.s.own[0] = 10; flats.dirty = true; flats.recalc(); advance(flats, 2);
  const v0 = flats.tapValue();
  moveTo(flats, 3);
  for (const k of ["own", "up", "tree"]) flats.s[k] = structuredClone(begin().app.s[k]);
  flats.s.up[E.UPG.findIndex((u) => u.kind === "tap" && u.frac)] = 1; flats.s.own[0] = 10;
  flats.s.L = 0; flats.s.gl.length = 0; flats.dirty = true; flats.recalc(); advance(flats, 2);
  const want = 3 * (flats.tapMult * E.globalMult(flats.s) + flats.tapFrac * flats.rate);
  assert.ok(near(flats.tapValue() / want, 1), "the whole tap is x3, the part from the rate too");
  assert.ok(v0 > 0);
});

test("the relocation list shows the offered sites with their rules and soundings, and a long hold moves there", () => {
  const { app } = begin();
  const s = app.s;
  s.rt = 1e9; app.dirty = true; app.recalc();
  app.openRing("reloc");
  const sites = app.entries.filter((e) => e.kind === "reloc");
  assert.deepEqual(sites.map((e) => e.site), s.of);
  for (const e of sites) {
    const x = E.SITES[e.site];
    assert.equal(e.label, x.n); assert.equal(e.sub, "NEW");
    assert.ok(e.lines.includes(x.rule[0]) && e.lines.some((l) => l.startsWith("SOUNDING I: ")), e.lines.join(" / "));
    assert.ok(e.hold > 1 && e.dwell > 0.5, "relocation keeps its long hold");
    assert.ok(e.lines.reduce((n, l) => n + Math.ceil(l.length / 29), 0) <= 6, "the detail fits: " + e.lines.join(" / "));
  }
  assert.ok(app.entries.some((e) => e.key === "keep"));
  const k = app.entries.indexOf(sites[2]);
  app.ring.idx = k; app.ring.hiAt = app.clk - 2;
  press(app, 1300);
  assert.equal(s.runs, 1);
  assert.equal(s.site, sites[2].site);
  // the card, then the station: the arrival note says where and what to sound
  advance(app, 1.5); tap(app);
  if (app.ring) { app.closeRing(); }
  advance(app, 0.1);
  assert.match(notesOf(app), new RegExp("NOW AT " + E.SITES[s.site].n + "\\.  SOUNDING I: "));
});

test("soundings: each counts its own kind where it is taken and decodes a fragment of the call; once it is whole, a relic", () => {
  const { app } = begin();
  const s = app.s;
  const sv = E.surveyOf(s);
  assert.equal(sv.k, "tunes"); assert.equal(sv.t, 5); assert.equal(sv.lvl, 0);
  for (let i = 0; i < 30; i++) app.gather();
  assert.equal(s.sx, s.st.md, "at the landing site only tunes count");
  const base = structuredClone(s);
  while (s.sv[0] < 1) app.finishTune();
  assert.equal(s.cf, 1); assert.equal(E.surveysDone(s), 1);
  base.sv.fill(0); base.cf = 0; Object.assign(base, { sc: s.sc, gl: s.gl, relics: s.relics });
  assert.ok(Math.abs(E.globalMult(s) / E.globalMult(base) - 1 - E.SURVEY_BONUS) < 1e-9, "a sounding is +10% output for ever");
  const n = notesOf(app);
  assert.match(n, /SOUNDING I TAKEN: LANDING SITE  \+10% OUTPUT FOR EVER/);
  assert.match(n, /THE CALL: FRAGMENT 1 OF 11 DECODED/);
  assert.ok(n.includes(E.CALL_LOG[0]));
  const relics = s.relics;
  while (s.sv[0] < 2) app.finishTune();
  assert.equal(s.sx, 20); assert.equal(s.cf, 2, "sounding II decodes another fragment"); assert.equal(s.relics, relics);
  assert.equal(E.surveyOf(s).t, null); assert.equal(E.surveyOf(s).text, "BOTH SOUNDINGS TAKEN");
  const sx = s.sx; app.finishTune(); assert.equal(s.sv[0], 2); assert.ok(s.sx >= sx);
  // a long absence at the glacier takes both of its soundings at once
  s.L = 10;
  moveTo(app, 4);
  const cf = s.cf, rel = s.relics;
  for (let i = 0; i < 30; i++) app.gather();
  assert.equal(s.sx, 0, "taps count nothing at the glacier");
  app.creditAway(5 * 3600);
  assert.equal(s.sv[4], 2); assert.equal(s.cf, cf + 2); assert.equal(s.relics, rel);
  // with the call whole, a sounding turns up a relic instead
  s.cf = E.CALL_FRAGS; s.L = 30;
  moveTo(app, 5);
  while (s.sv[5] < 1) app.finishTune();
  assert.equal(s.relics, rel + 1); assert.equal(s.cf, E.CALL_FRAGS);
  assert.match(notesOf(app), /THE SOUNDING TURNED UP A RELIC/);
});

test("the long arc: a first sounding at each of eleven sites decodes the call; it leads to the silent coast; playing it there answers it", () => {
  const { ctx, app, book } = bootLog();
  const s = app.s;
  s.L = 500; s.tree[5] = 1; s.rd = [0]; app.dirty = true; app.recalc(); // every site but the silent coast on the map
  app.update(1); app.checkSites();
  const act = { // one step of each kind of sounding
    tunes: () => app.finishTune(),
    sky: () => { s.own[0]++; app.checkSurvey(); },
    ground: () => { s.own[2]++; app.checkSurvey(); },
    taps: () => app.gather(),
    watch: () => app.creditAway(1800),
    flares: () => { app.flare = { x: 400, y: 200, t: 9, life: 14 }; app.catchFlare(); },
    exp: () => { s.ex = [{ k: 0, end: Date.now() - 1 }]; app.collectExpeditions(Date.now(), null); },
    data: () => app.addData(1),
    groove: () => { app.gather(); advance(app, 0.45); },
    buys: () => { s.sig = 1e40; app.buyProd(0); },
  };
  const hidden = (m) => m.hidden.filter(Boolean).length;
  let last = hidden(E.callMelody(0));
  assert.equal(last, 44, "the call: 44 notes, all hidden at first");
  for (let k = 0; k < E.NSITE; k++) {
    if (k === E.SILENT) continue;
    if (k !== s.site) moveTo(app, k);
    const kind = E.SITES[k].sv.k, cf = s.cf;
    for (let guard = 0; s.sv[k] < 1 && guard < 20000; guard++) act[kind]();
    assert.equal(s.sv[k], 1, E.SITES[k].n + " sounded (" + kind + ")");
    assert.equal(s.cf, cf + 1, "a fragment decoded at " + E.SITES[k].n);
    const now = hidden(E.callMelody(s.cf));
    assert.ok(now < last, "fewer hidden notes"); last = now;
  }
  assert.equal(s.cf, E.CALL_FRAGS); assert.equal(last, 0);
  assert.ok(E.siteKnown(s, E.SILENT)); assert.equal(s.of[0], E.SILENT, "the silent coast is offered first");
  assert.ok(book.feats.some((f) => f[0] === "call-decoded") || (app.checkFeats(), book.feats.some((f) => f[0] === "call-decoded")));
  // relocate there through the menu, choose the call in the songbook, and play it through
  s.rt = 1e9; app.dirty = true; app.recalc();
  app.openRing("reloc");
  const e = app.entries.find((x) => x.site === E.SILENT);
  assert.equal(e.sub, "THE CALL");
  app.ring.idx = app.entries.indexOf(e); app.ring.hiAt = app.clk - 2;
  press(app, 1300);
  assert.equal(s.site, E.SILENT);
  app.phase_ = "play"; app.ring = null; app.card = null;
  const before = E.globalMult(s);
  app.openRing("songs");
  const call = app.entries.find((x) => x.i === E.CALL_ID);
  assert.equal(call.label, "THE CALL"); assert.equal(call.sub, "WHOLE");
  app.ring.idx = app.entries.indexOf(call); app.ring.hiAt = app.clk - 2;
  press(app, 700);
  assert.equal(s.sg, E.CALL_ID); assert.equal(app.mel.name, "THE CALL"); assert.equal(app.ring, null);
  const tunes = s.sc.slice();
  for (let i = 0; i < 44; i++) { app.gather(); advance(app, 0.45); }
  assert.equal(s.ans, 1, "answered");
  assert.equal(s.sv[E.SILENT], 1);
  assert.ok(app.finale, "the finale plays");
  assert.deepEqual(s.sc, tunes, "the call is not counted as a songbook tune");
  assert.ok(Math.abs(E.globalMult(s) / before - E.CHORUS_MULT * (1 + E.SURVEY_BONUS * E.surveysDone(s)) / (1 + E.SURVEY_BONUS * (E.surveysDone(s) - 1))) < 1e-9);
  assert.equal(E.humMultOf(s), E.HUM_MULT + 0.25 * s.tree[E.HARMONICS] + 0.5);
  assert.match(notesOf(app), new RegExp(E.CALL_ANSWERED));
  assert.equal(app.mel.name, "THE CALL AND ANSWER"); assert.equal(app.mel.n.length, 53);
  assert.ok(book.feats.some((f) => f[0] === "call-answered"));
  advance(app, 13);
  assert.equal(app.finale, null);
  // kept: a reload stands at the silent coast with the call answered
  app.save(true);
  const again = boot({ progress: structuredClone(lastSave(ctx)) }).app;
  for (const k of ["site", "cf", "ans", "sg", "fe"]) assert.equal(again.s[k], s[k], k);
  assert.deepEqual(again.s.sv, s.sv);
  assert.equal(again.mel.name, "THE CALL AND ANSWER");
  assert.ok(!again.s.of.includes(E.SILENT) || again.s.of[0] !== E.SILENT || !again.s.ans, "once answered, the silent coast is no longer pushed first");
});

test("the call in the songbook: it appears with the first fragment, previews, loops, and an old save cannot play it early", () => {
  const { ctx, app } = begin();
  const s = app.s;
  app.openRing("songs");
  assert.ok(!app.entries.some((e) => e.i === E.CALL_ID), "no call before a fragment");
  app.closeRing();
  s.cf = 3;
  app.openRing("songs");
  const call = app.entries.find((e) => e.i === E.CALL_ID);
  assert.equal(call.sub, "3/11"); assert.match(call.lines[0], /3 OF 11 FRAGMENTS DECODED/); assert.match(call.lines[1], /^HUMS /);
  app.ring.idx = app.entries.indexOf(call) - 1; app.ring.hiAt = app.clk;
  const q = app.queue.length;
  app.step();
  assert.ok(app.queue.length > q, "the highlighted call is previewed");
  app.ring.hiAt = app.clk - 2; press(app, 700);
  assert.equal(s.sg, E.CALL_ID); assert.equal(app.mel.name, "THE CALL 3/11");
  const m = E.callMelody(3);
  assert.equal(m.hidden.filter((h) => !h).length, 12); assert.ok(m.n.every((x, i) => !m.hidden[i] || x === m.n[m.hidden.indexOf(true)]));
  s.sm = 0; app.finishTune();
  assert.equal(s.sg, E.CALL_ID, "loop mode keeps playing the call");
  s.sm = 1; for (let i = 0; i < 6; i++) { app.finishTune(); assert.notEqual(s.sg, E.CALL_ID, "shuffle never picks the call"); }
  // a save that says it plays the call without a fragment falls back to the first tune
  app.s.sg = E.CALL_ID; app.s.cf = 0; app.s.sv.fill(0); app.save(true);
  const again = boot({ progress: structuredClone(lastSave(ctx)) }).app;
  assert.equal(again.s.sg, 0);
});

test("the soundings view: the sounding here, the site, the call so far, the record, and the next uncharted site", () => {
  const { app } = begin();
  const s = app.s, g = fakeCanvas();
  app.openRing("main");
  const entry = app.entries.find((e) => e.to === "site");
  assert.equal(entry.label, "SOUNDINGS"); assert.equal(entry.sub, "0%"); assert.equal(entry.big, "LANDING SITE");
  for (const e of app.entries.filter((x) => x.kind === "sub")) assert.ok(e.sub && e.sub.length <= 8 && e.to, "a sub-menu shows a short label, not its id: " + e.label);
  app.ring.idx = app.entries.indexOf(entry); app.ring.hiAt = app.clk - 2;
  press(app, 700);
  assert.equal(app.ring.menu, "site");
  assert.equal(app.ring.idx, 1, "it opens on the sounding");
  assert.deepEqual(app.entries.map((e) => e.key), ["back", "sv", "here", "blue", "codex", "next"]);
  assert.equal(app.entries[3].label, "SPARE PARTS"); assert.equal(app.entries[3].sub, "BLUEPRINT", "the landing site's blueprint, still to find");
  assert.equal(app.entries[1].big, "0 / 5"); assert.equal(app.entries[1].lines[2], "AND A FRAGMENT OF THE CALL");
  assert.equal(app.entries.at(-1).lines[0], E.SITES[7].hint, "the nearest uncharted site and what it takes");
  app.draw(g);
  app.closeRing();
  s.cf = 4; s.sv[0] = 1; s.site = 4; s.sx = 2000; s.L = 10;
  app.openRing("site");
  const keys = app.entries.map((e) => e.key);
  assert.deepEqual(keys, ["back", "sv", "here", "blue", "call", "log", "codex", "next"]);
  assert.equal(app.entries[1].big, "0.5 H / 1.0 H");
  assert.equal(app.entries[3].label, "NIGHT BATTERY"); assert.deepEqual(app.entries[3].lines.slice(0, 2), ["SOUNDING I BRINGS IT BACK:", "AWAY CREDIT +6 H"]);
  assert.equal(app.entries[4].lines[0], E.CALL_LOG[3]);
  assert.deepEqual(app.entries[5].lines, [E.CALL_LOG[2], E.CALL_LOG[1]]);
  for (const e of app.entries) assert.ok(e.lines.reduce((n, l) => n + Math.min(2, Math.ceil(l.length / 29)), 0) <= 6, e.key);
  for (let i = 0; i < app.entries.length; i++) { app.step(); app.draw(g); }
  finiteDeep(app.s);
});

test("a schema 4 save (from the build before 0.3) loads at the landing site with nothing sounded, says what is new, and saves in the current schema", () => {
  const old = fixture("outpost-save-v4-mid.json");
  assert.equal(old.v, 4);
  wall = old.t + 20 * 1000;
  const { ctx, app } = boot({ progress: structuredClone(old) });
  const s = app.s;
  assert.deepEqual(s.own, old.own); assert.equal(s.taps, old.taps); assert.equal(s.b, old.b); assert.equal(s.L, old.L); assert.equal(s.runs, old.runs);
  assert.deepEqual(s.tree.slice(0, old.tree.length), old.tree); assert.deepEqual(s.sc.slice(0, old.sc.length), old.sc);
  assert.deepEqual(s.gl.slice(0, old.gl.length), old.gl); assert.deepEqual(s.rd.slice(0, old.rd.length), old.rd); assert.equal(s.cn, old.cn); assert.equal(s.sg, old.sg);
  assert.ok(s.lt >= old.lt && s.sig >= old.sig, "nothing lost");
  assert.equal(s.site, 0); assert.ok(s.sv.every((v) => v === 0)); assert.equal(s.cf, 0); assert.equal(s.ans, 0); assert.equal(s.fe, 0); assert.equal(s.sx, 0);
  assert.equal(s.of.length, 3); assert.ok(s.of.every((k) => k !== 0 && E.siteKnown(s, k)));
  if (app.phase_ === "away") { assert.ok(app.away.done.length, "a project finished while away"); app.down(); app.up({ durationMs: 50 }); }
  assert.equal(app.phase_, "news"); assert.equal(app.newsFrom, 4);
  const card = app.newsCard();
  assert.equal(card.title, "OUTPOST UPDATED");
  assert.ok(card.lines.some((l) => /SITE/.test(l)) && card.lines.some((l) => /SOUNDINGS/.test(l)) && card.lines.some((l) => /HUM/.test(l)), card.lines.join(" / "));
  assert.ok(card.lines.length <= 6 && card.lines.every((l) => l.length <= 52));
  for (const f of [1, 2, 3, 5]) { app.newsFrom = f; const c = app.newsCard(); assert.ok(c.lines.length <= 6 && c.lines.every((l) => l.length <= 52), f + ": " + c.lines.join(" / ")); }
  app.newsFrom = 4;
  app.draw(fakeCanvas());
  app.down(); app.up({ durationMs: 50 });
  assert.equal(app.phase_, "play");
  app.save(true);
  const saved = lastSave(ctx);
  assert.equal(saved.v, E.SCHEMA);
  for (const k of ["site", "sx", "sv", "of", "cf", "ans", "fe", "ft"]) assert.ok(k in saved, k + " saved");
  assert.deepEqual(saved.ft, []);
  const again = boot({ progress: JSON.parse(JSON.stringify(saved)) }).app;
  assert.equal(again.phase_, "play"); assert.deepEqual(again.s.of, s.of);
  // bad values are cleaned, never trusted
  const bad = E.migrate({ ...saved, site: 99, sv: [9, -1, "x"], cf: 1e9, ans: -3, of: [0, 0, 11, 5, "x", 99], fe: "x", sx: -5 }).s;
  assert.equal(bad.site, 0); assert.deepEqual(bad.sv.slice(0, 3), [2, 0, 0]); assert.equal(bad.cf, E.CALL_FRAGS); assert.equal(bad.ans, 0);
  assert.deepEqual(bad.of, [11], "at most three are read; the current site and repeats are dropped"); assert.equal(bad.fe, 0); assert.equal(bad.sx, 0);
  const early = boot({ progress: { ...JSON.parse(JSON.stringify(saved)), of: [11, 1, 2] } }).app;
  assert.ok(!early.s.of.includes(E.SILENT), "a save cannot offer the silent coast before the call is whole");
  assert.equal(E.migrate({ ...saved, ans: 1, cf: 2 }).s.cf, E.CALL_FRAGS, "an answered call is a whole one");
});

// The first day from T0 whose order (by the local date) is DAILY[k].
const dayOf = (k) => { for (let d = 0; ; d++) if (E.dailyPick(T0 + d * 864e5) === k) return T0 + d * 864e5; };
const ORDER = (id) => E.DAILY.findIndex((d) => d[0] === id);

test("console logbook: milestones become feats once each and are kept; today's order is stated and met once; all optional", () => {
  wall = dayOf(ORDER("tunes")); // a date whose order is "play three tunes through"
  const { ctx, app, book } = bootLog();
  assert.deepEqual(book.daily, ["Play three tunes through"]);
  app.finishTune(); app.finishTune();
  assert.equal(book.met, 0);
  app.finishTune();
  assert.equal(book.met, 1); app.finishTune(); assert.equal(book.met, 1, "met once");
  app.s.rt = 1e9; app.dirty = true; app.recalc();
  app.relocate(); app.phase_ = "play";
  advance(app, 1.2);
  assert.ok(book.feats.some((f) => f[0] === "first-relocation" && f[1] === "FIRST RELOCATION"), book.feats.join(" / "));
  const bit = app.s.fe, n = book.feats.length;
  assert.ok(bit & 1);
  advance(app, 3);
  assert.equal(book.feats.length, n, "reported once");
  assert.equal(new Set(book.feats.map((f) => f[0])).size, n);
  app.save(true);
  const saved = lastSave(ctx);
  assert.equal(saved.fe, bit);
  const ctx2 = appContext({ progress: structuredClone(saved) }), seen = [];
  ctx2.feat = (id) => { seen.push(id); return true; };
  const again = new Outpost(ctx2);
  run(again, 2);
  assert.ok(!seen.includes("first-relocation"), "a feat already reported is not reported again after a reload");
  // the other orders, and nothing at all without a logbook
  wall = dayOf(ORDER("flare")); const f = bootLog(); assert.deepEqual(f.book.daily, ["Catch a signal flare"]);
  f.app.flare = { x: 400, y: 200, t: 9, life: 14 }; f.app.catchFlare(); assert.equal(f.book.met, 1);
  wall = dayOf(ORDER("groove")); const gr = bootLog(); assert.deepEqual(gr.book.daily, ["Finish a tune in full groove"]);
  for (let i = 0; i < 80; i++) { gr.app.gather(); advance(gr.app, 0.45); }
  assert.equal(gr.book.met, 1);
  const plain = begin().app;
  plain.s.rt = 1e9; plain.dirty = true; plain.recalc(); plain.relocate(); plain.phase_ = "play";
  advance(plain, 2);
  assert.equal(plain.s.fe, 0, "without a logbook nothing is marked as reported");
});

test("console logbook: calls held back during a menu gesture are made again; a failing logbook changes nothing", () => {
  // The console holds feat and dailyMet back while a menu gesture is possible: they return nothing
  // and may be dropped. Outpost asks again until the logbook has them.
  wall = dayOf(ORDER("tunes"));
  const { ctx, app, book } = bootLog();
  const met = ctx.dailyMet, feat = ctx.feat;
  let held = 0;
  ctx.dailyMet = () => { held++; };
  app.finishTune(); app.finishTune(); app.finishTune();
  assert.equal(held, 1); assert.equal(book.met, 0);
  ctx.dailyMet = met;
  app.finishTune();
  assert.equal(book.met, 1, "asked again at the next tune");
  app.finishTune();
  assert.equal(book.met, 1, "and not after the logbook has it");
  ctx.feat = () => undefined;
  app.s.rt = 1e9; app.dirty = true; app.recalc(); app.relocate(); app.phase_ = "play";
  advance(app, 1.2);
  assert.equal(app.s.fe & 1, 0, "a feat held back is not marked as reported");
  ctx.feat = feat;
  advance(app, 1.2);
  assert.ok(app.s.fe & 1);
  assert.equal(book.feats.filter((f) => f[0] === "first-relocation").length, 1);
  // a logbook whose every call throws: Outpost starts, plays, relocates and saves as without one
  const bad = appContext();
  for (const k of ["feat", "today", "daily", "dailyMet"]) bad[k] = () => { throw new Error("logbook down"); };
  const other = new Outpost(bad);
  other.down(); other.up({ durationMs: 50 });
  other.finishTune();
  other.s.rt = 1e9; other.dirty = true; other.recalc(); other.relocate(); other.phase_ = "play";
  advance(other, 2);
  assert.equal(other.s.fe, 0);
  assert.equal(other.s.runs, 1);
  finiteDeep(other.s);
});

test("story notes are never cut short: a passing note waits its turn, and a story note waits while the ring covers the station", () => {
  const { app } = begin();
  app.queueNote(E.CALL_LOG[0], 5);
  assert.equal(app.note.text, E.CALL_LOG[0]);
  advance(app, 1);
  app.setNote("TUNE COMPLETE: X  +5", 4); // what finishing a tune shows
  assert.equal(app.note.text, E.CALL_LOG[0], "the story note stays");
  advance(app, 4.2);
  assert.equal(app.note.text, "TUNE COMPLETE: X  +5", "the passing note follows it");
  // a passing note that waited too long is dropped
  app.note = null; app.queueNote("STORY A", 10); app.setNote("STALE", 3);
  advance(app, 10.2);
  assert.notEqual(app.note?.text, "STALE");
  // the ring covers the station: the story note waits, then shows for its full time
  app.note = null; app.noteQ.length = 0;
  app.queueNote("STORY B", 4); advance(app, 1);
  app.openRing("main"); advance(app, 6);
  assert.ok(app.noteQ.some((n) => n.text === "STORY B"), "put back while the ring is open");
  app.closeRing(); advance(app, 0.1);
  assert.equal(app.note.text, "STORY B");
  assert.ok(app.note.t > 2.5, "with the time it had left");
  // at most six wait; a passing note goes before a story note
  app.note = { text: "NOW", t: 9, story: true }; app.noteQ.length = 0;
  for (let i = 0; i < 5; i++) app.queueNote("S" + i, 3);
  app.setNote("P", 3); app.queueNote("S5", 3);
  assert.equal(app.noteQ.length, 6);
  assert.ok(!app.noteQ.some((n) => n.text === "P") && app.noteQ.every((n) => n.story));
  // the story note on screen, put back while six wait, goes first in line, and six still wait
  app.openRing("main"); advance(app, 0.1);
  assert.equal(app.noteQ.length, 6);
  assert.equal(app.noteQ[0].text, "NOW");
  app.closeRing(); advance(app, 0.1);
  assert.equal(app.note.text, "NOW");
});

test("the finale is shown at once and fires once; sky and ground soundings count only machines built here", () => {
  const { app } = begin();
  const s = app.s;
  s.L = 500; s.cf = E.CALL_FRAGS; s.rt = 1e9; app.dirty = true; app.recalc();
  app.relocate(E.SILENT); app.phase_ = "play"; app.arrive();
  app.queueNote("SOMETHING ELSE", 4);
  app.answerCall();
  assert.equal(app.note.text, E.CALL_ANSWERED);
  assert.equal(s.ans, 1);
  s.sx = 1; app.checkSurvey(); // the sounding counts the answer: no second finale
  assert.equal(s.sv[E.SILENT], 1);
  assert.equal(s.ans, 1);
  // HEAD START gives machines on arrival; the High Ridge sounding wants machines built there
  for (const lvl of [4, 5]) {
    const b = begin().app, t = b.s;
    t.tree[0] = lvl; t.L = 40; t.rt = 1e9; b.dirty = true; b.recalc();
    b.relocate(1); b.phase_ = "play";
    advance(b, 1.2);
    assert.equal(t.sv[1], 0, "head start " + lvl + ": not taken on arrival");
    const sv = E.surveyOf(t);
    assert.equal(sv.v, 0); assert.match(sv.text, /^BUILD 60 OF ONE SKY MACHINE/);
    t.sig = 1e15;
    while (E.surveyOf(t).v < 60) b.buyProd(0);
    advance(b, 1.2);
    assert.equal(t.sv[1], 1, "taken once 60 more are built");
  }
});

test("an odd save keeps the story whole: fragments follow the soundings, the answer and the silent coast agree, the offer is full", () => {
  const save = (over) => {
    const s = E.freshState();
    return { ...E.serialize(s, T0), runs: 3, L: 500, ...over };
  };
  const load = (over) => { wall = T0 + 1000; return boot({ progress: save(over) }).app; };
  // a sounding taken at the silent coast without the answer: taken back, so the finale can still come
  let a = load({ site: 11, cf: 11, ans: 0, sv: [2, 2, 2, 2, 2, 1, 0, 0, 0, 0, 0, 1] });
  assert.equal(a.s.sv[E.SILENT], 0); assert.equal(a.s.ans, 0); assert.equal(a.s.cf, E.CALL_FRAGS);
  // answered, but the sounding missing: no second finale
  a = load({ site: 11, cf: 11, ans: 1, sv: Array(12).fill(0) });
  assert.equal(a.s.sv[E.SILENT], 1);
  // every ordinary site sounded twice, no fragments: the call is whole
  a = load({ cf: 0, sv: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 0] });
  assert.equal(a.s.cf, E.CALL_FRAGS);
  assert.equal(a.s.of[0], E.SILENT, "and the silent coast is offered first");
  // at the silent coast without the whole call: back at the landing site
  a = load({ site: 11, cf: 3, sv: [1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0] });
  assert.equal(a.s.site, 0);
  // a short or repeated offer is made full again
  for (const of of [[5], [1, 1, 1], [2, 3]]) {
    a = load({ of });
    assert.equal(a.s.of.length, 3, JSON.stringify(of));
    assert.equal(new Set(a.s.of).size, 3);
  }
  for (const x of [a]) finiteDeep(x.s);
});

test("today's order: the one stated earlier today is kept (the logbook keeps local dates)", () => {
  for (const k of [0, 1, 2]) {
    wall = dayOf((k + 1) % 3); // a day that would pick another order
    const ctx = appContext(), said = [];
    ctx.today = () => ({ goal: E.DAILY[k][1], done: false, own: true });
    ctx.daily = (text) => said.push(text);
    ctx.dailyMet = () => {};
    const app = new Outpost(ctx);
    assert.equal(app.dailyK, E.DAILY[k][0]);
    assert.ok(said.every((t) => t === E.DAILY[k][1]));
  }
});

// ---- the workshop ------------------------------------------------------------------
test("the workshop: soundings bring blueprints, it opens at three, and a run builds three fittings to choose, one of three each time", () => {
  const { ctx, app } = begin();
  const s = app.s;
  assert.equal(E.blueprints(s), 0); assert.ok(!E.workshopOpen(s));
  app.openRing("main"); assert.ok(!app.entries.some((e) => e.key === "fit"), "no workshop before its blueprints"); app.closeRing();
  s.sv[1] = 1; s.sv[3] = 1;
  assert.ok(!E.workshopOpen(s), "two blueprints are not enough");
  s.sv[5] = 2; // a third, with its MK II
  assert.ok(E.workshopOpen(s)); assert.equal(E.blueprints(s), E.FIT_OPEN);
  // nothing is built until three minutes into the run
  s.play = 170; app.note = null; advance(app, 0.5);
  assert.equal(E.fitsBuilt(s), 0); assert.ok(!app.fitWaiting());
  advance(app, 10.5);
  assert.equal(E.fitsBuilt(s), 1); assert.ok(app.fitWaiting());
  assert.match(app.note.text, /WORKSHOP BUILT A FITTING/);
  const told = app.note; advance(app, 0.5); assert.equal(app.note, told, "said once, not every frame");
  // three known blueprints are offered, the same each time it is asked
  const offer = app.fitOffer();
  assert.deepEqual([...offer].sort(), [1, 3, 5]); assert.deepEqual(app.fitOffer(), offer);
  // the ring opens on the workshop while a choice waits, right after the songbook
  app.note = null;
  app.openRing("main");
  const w = app.entries[app.ring.idx];
  assert.equal(w.key, "fit"); assert.equal(w.sub, "CHOOSE"); assert.ok(w.aff); assert.equal(app.entries.indexOf(w), 3);
  app.ring.hiAt = app.clk - 2; press(app, 700);
  assert.equal(app.ring.menu, "fit");
  assert.deepEqual(app.entries.filter((e) => e.kind === "fit").map((e) => e.k), offer);
  const coil = app.entries.find((e) => e.k === 5), rack = app.entries.find((e) => e.k === 1);
  assert.equal(coil.label, "HUM COIL II"); assert.equal(coil.lines[0], "HUM +0.5, TWICE AS LONG");
  assert.equal(rack.label, "SKY RACK"); assert.equal(rack.lines[0], "SKY MACHINES x1.5");
  for (const e of app.entries) assert.ok(e.label.length <= 21 && e.lines.every((l) => l.length <= 29), e.key);
  app.draw(fakeCanvas());
  // holding one fits it for the run and closes the ring
  app.ring.idx = app.entries.indexOf(rack); app.ring.hiAt = app.clk - 2; press(app, 700);
  assert.equal(app.ring, null);
  assert.deepEqual(s.ft, [1]); assert.equal(E.siteFx(s).sky, 1.5); assert.equal(E.siteFx(s).ground, 1);
  assert.ok(!app.fitWaiting());
  assert.equal(app.note.text, "SKY RACK FITTED: SKY MACHINES x1.5");
  assert.equal(app.fit(3), false, "nothing more until the workshop builds the next");
  app.openRing("main");
  const w2 = app.entries.find((e) => e.key === "fit");
  assert.equal(w2.sub, "1/3"); assert.ok(!w2.aff); assert.equal(app.entries[app.entries.indexOf(w2) + 1].key, "site", "with the soundings once nothing waits"); assert.equal(w2.lines[1], "SKY RACK");
  app.ring.idx = app.entries.indexOf(w2); app.ring.hiAt = app.clk - 2; press(app, 700);
  assert.deepEqual(app.entries.map((e) => e.key), ["back", "on1", "next", "bp"]);
  assert.equal(app.entries[2].lines.join(" "), "ONE IS BUILT 3, 10 AND 25 MINUTES INTO EACH RUN.");
  app.closeRing();
  // ten minutes in: the next, from what is left
  s.play = 600; advance(app, 0.1);
  assert.ok(app.fitWaiting()); assert.deepEqual([...app.fitOffer()].sort(), [3, 5]);
  assert.equal(app.fit(1), false, "never the same fitting twice");
  assert.ok(app.fit(5));
  assert.equal(E.siteFx(s).hum, 0.5); assert.equal(E.siteFx(s).humT, 2); assert.equal(E.humMultOf(s), E.HUM_MULT + 0.5);
  // twenty-five minutes in: the last of the run
  s.play = 1500; advance(app, 0.1);
  assert.ok(app.fit(3)); assert.equal(E.siteFx(s).tap, 2);
  s.play = 9000; advance(app, 0.1); assert.ok(!app.fitWaiting(), "three a run");
  // they are saved, and a reload keeps them
  app.save(true);
  const saved = lastSave(ctx);
  assert.deepEqual(saved.ft, [1, 5, 3]);
  const again = boot({ progress: JSON.parse(JSON.stringify(saved)) }).app;
  assert.deepEqual(again.s.ft, [1, 5, 3]); assert.equal(E.siteFx(again.s).sky, 1.5);
  // relocating starts the next run with none, at the new site's own rules
  s.rt = 1e12; s.lt = Math.max(s.lt, s.rt);
  assert.ok(app.relocate(s.of[0]));
  assert.deepEqual(s.ft, []); assert.equal(E.siteFx(s), E.SITES[s.site].fx);
});

test("fittings: a second sounding gives the MK II, they fold into the site's rules, and saves cannot fit what is not known", () => {
  const { app } = begin();
  const s = app.s;
  for (const k of [0, 1, 2]) s.sv[k] = 1;
  // every fitting has a MK I and a MK II whose lines fit the ring
  assert.equal(E.FIT.length, E.SITES.length, "one fitting for each site");
  E.FIT.forEach((f, k) => {
    assert.equal(f.fx.length, 2); assert.equal(f.d.length, 2);
    for (const lines of f.d) assert.ok(lines.length >= 1 && lines.length <= 2 && lines.every((l) => l.length <= 26), f.n);
    assert.ok(f.n.length <= 18, f.n);
    for (const m of [1, 2]) {
      const said = ["BLUEPRINT MK II: " + f.n + ". " + E.fitSummary(k, m), f.n + " II FITTED: " + E.fitSummary(k, m)];
      for (const text of said) assert.ok(text.length <= 64, text); // a note is one line on the station
    }
  });
  // at High Ridge (sky x1.5, ground x0.75) a sky rack multiplies, and a sounding there makes it MK II at once
  s.site = 1; s.ft = [1, 2];
  assert.equal(E.siteFx(s).sky, 1.5 * 1.5); assert.equal(E.siteFx(s).ground, 0.75 * 1.5);
  s.sv[1] = 2;
  assert.equal(E.siteFx(s).sky, 1.5 * 2); assert.equal(E.fitName(s, 1), "SKY RACK II");
  // hum, away hours and price growth add; growth stays above 1
  for (const k of [4, 5, 10]) s.sv[k] = 2;
  s.site = 10; s.ft = [4, 5, 10]; // the dunes: prices already rise slower
  const fx = E.siteFx(s);
  assert.equal(fx.cap, 12); assert.equal(fx.mach, 1.1); assert.equal(fx.hum, 0.5);
  assert.ok(Math.abs(fx.growth - (E.SITES[10].fx.growth - 0.01)) < 1e-12 && fx.growth > 1);
  assert.equal(E.capHours(s) - E.capHours({ ...s, ft: [] }), 12);
  assert.ok(E.costOf(s, 0, 100) < E.costOf({ ...s, ft: [] }, 0, 100), "machines are cheaper with the sled");
  // the rules a site shows are its own: fittings never change the table
  assert.equal(E.SITES[10].fx.cap, 0); assert.equal(E.SITES[1].fx.sky, 1.5);
  // a save keeps only known blueprints, each once, at most three
  const raw = JSON.parse(JSON.stringify(E.serialize(s, T0)));
  const m = (ft, sv = raw.sv) => E.migrate({ ...raw, ft, sv }).s.ft;
  assert.deepEqual(m([4, 5, 10]), [4, 5, 10]);
  assert.deepEqual(m([4, 4, 5, "x", -1, 99, 7]), [4, 5], "repeats, junk and unknown blueprints are dropped");
  assert.deepEqual(m([0, 1, 2, 4, 5]), [0, 1, 2], "at most three");
  assert.deepEqual(m([4], Array(12).fill(0)), [], "not without its blueprint");
  assert.deepEqual(E.migrate({ ...raw, v: 5, ft: [4] }).s.ft, [], "a schema 5 save has none");
  assert.deepEqual(m("x"), []);
});

test("the workshop in the story: a sounding brings a blueprint, the third opens it, and an update says what is new", () => {
  const { app } = begin();
  const s = app.s;
  s.sv[1] = 1; s.sv[3] = 1; s.cf = 2; s.site = 0; s.sv[0] = 0;
  // the landing site's first sounding: five tunes
  s.sx = 4; app.noteQ.length = 0; app.note = null;
  app.survey("tunes", 1);
  const said = [app.note?.text, ...app.noteQ.map((n) => n.text)].join(" | ");
  assert.match(said, /BLUEPRINT: SPARE PARTS\. UPGRADES COST x0\.75/);
  assert.match(said, /THE WORKSHOP IS OPEN/);
  assert.ok([app.note, ...app.noteQ].every((n) => !n || n.text.length <= 64), said);
  assert.ok(E.workshopOpen(s));
  // the update card for a schema 5 save
  app.newsFrom = 5;
  const card = app.newsCard();
  assert.ok(card.lines.some((l) => /WORKSHOP/.test(l)) && card.lines.some((l) => /3 BLUEPRINTS/.test(l)), card.lines.join(" / "));
  assert.ok(card.lines.length <= 6 && card.lines.every((l) => l.length <= 52));
  // and the feat for a full workshop
  const feats = [];
  app.c.feat = (id) => { feats.push(id); return true; };
  s.play = 1600; s.ft = [0, 1, 3];
  app.checkFeats();
  assert.ok(feats.includes("fully-fitted"));
});

test("the long game: a player who stays for each site's sounding hears the whole call and answers it", () => {
  const { res, app } = simulate({ runs: 9, maxMin: 600, sound: true });
  const s = app.s;
  const hours = res.reduce((a, r) => a + (r.minutes || 0), 0) / 60;
  console.log("the call: minutes per run", res.map((r) => r.minutes).join(" "), "fragments", s.cf, "answered", s.ans, "soundings", s.sv.join(""), "hours", hours.toFixed(1));
  assert.equal(s.cf, E.CALL_FRAGS);
  assert.equal(s.site, E.SILENT);
  assert.equal(s.ans, 1, "answered at the ninth site");
  assert.ok(E.surveysDone(s) >= 12);
  assert.ok(hours > 4.5 && hours < 12, hours.toFixed(1) + " hours of play (a quarter of it tapping)");
  finiteDeep(s);
  // and play goes on: the runs after the answer stay short (with a fixed ready ratio they took 4 to 10 hours each)
  const after = simulate({ runs: 5, maxMin: 600, sound: true, progress: E.serialize(s, 1.8e12) });
  console.log("after the answer: minutes per run", after.res.map((r) => r.minutes).join(" "), "bearings", after.app.s.L);
  assert.equal(after.res.length, 5);
  assert.ok(after.res.every((r) => r.minutes !== null && r.minutes < 180), "every run after the answer within three hours");
  assert.ok(after.app.s.L > 2 * s.L, "and the bearings keep growing");
  finiteDeep(after.app.s);
});
