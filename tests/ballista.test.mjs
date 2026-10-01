import test from "node:test";
import assert from "node:assert/strict";
import {
  Ballista, migrateSave, dailyGoal, loadout, zoneAt, sweepAngle, powerAt, timeToGround,
  ZONES, UPGRADES, PODS, FEATS, M, RISE, MIN_HOLD, SKIP_WIN,
} from "../web/apps/ballista.js";
import { Random } from "../web/engine/math.js";
import { appContext, fakeCanvas, run } from "./helpers/app-context.mjs";
import { playRun, campaign, shop } from "./helpers/ballista-bot.mjs";

const F = 1 / 60;
const tap = (app) => { app.down(); app.up(); };
function hold(app, seconds) { app.down(); run(app, seconds); app.up(); }
const mount = (options = {}) => { const ctx = appContext({ seed: 11, ...options }); return { ctx, app: new Ballista(ctx) }; };
// Starts a run and fires at `angle` with full power.
function fire(app, angle = 40) {
  if (app.phase !== "aim") tap(app);
  for (let i = 0; i < 400 && Math.abs(app.angle - angle) > 1.5; i++) app.update(F);
  app.down();
  for (let i = 0; i < 200 && app.power < 0.97; i++) app.update(F);
  app.up();
}
function finite(value, path = "app") {
  if (typeof value === "number") assert.ok(Number.isFinite(value), path + " is " + value);
  else if (ArrayBuffer.isView(value)) value.forEach((v, i) => assert.ok(Number.isFinite(v), path + "[" + i + "]"));
  else if (Array.isArray(value)) value.forEach((v, i) => finite(v, path + "[" + i + "]"));
  else if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) for (const k of Object.keys(value)) finite(value[k], path + "." + k);
}
const plainState = (app) => Object.fromEntries(Object.entries(app).filter(([k, v]) => !["c", "guard"].includes(k) && typeof v !== "function"));
const validLamps = (values) => values.length === 9 && values.every((v) => Number.isInteger(v) && v >= 0 && v <= 255);

// ---- the pieces --------------------------------------------------------------------------------

test("the aim sweeps inside its range and the power meter rises, peaks at RISE and falls", () => {
  for (let t = 0; t < 6; t += 0.05) { const a = sweepAngle(t); assert.ok(a >= 14 - 1e-9 && a <= 74 + 1e-9); }
  assert.equal(powerAt(0), 0);
  assert.ok(Math.abs(powerAt(RISE) - 1) < 1e-9);
  assert.ok(powerAt(RISE * 1.5) < 0.6);
  assert.ok(Math.abs(powerAt(RISE * 2)) < 1e-9);
});

test("zones start where they say, and every upgrade level makes the pod better", () => {
  ZONES.forEach((z, i) => { assert.equal(zoneAt(z.from), i); if (i) assert.equal(zoneAt(z.from - 1), i - 1); });
  const a = loadout([0, 0, 0, 0, 0], 0), b = loadout([5, 5, 5, 5, 5], 0);
  assert.ok(b.vmax > a.vmax && b.kicks > a.kicks && b.e > a.e && b.drag < a.drag && b.magnet > a.magnet);
  for (const u of UPGRADES) { assert.equal(u.cost.length, 5); u.cost.forEach((c, i) => i && assert.ok(c > u.cost[i - 1])); }
  assert.deepEqual(PODS.map((p) => p.need), [0, 4, 8]);
});

test("time to the ground is right for a falling body", () => {
  // from 100 px falling at 200 px/s: 100 = 200t + 210t^2
  const t = timeToGround(100, -200);
  assert.ok(Math.abs(200 * t + 0.5 * 420 * t * t - 100) < 1e-6);
  assert.equal(timeToGround(0, 0), 0);
});

// ---- input and flow --------------------------------------------------------------------------

test("title: a tap starts a run, a hold opens the workshop; a short press in the aim fires nothing", () => {
  const { app } = mount();
  assert.equal(app.phase, "title");
  hold(app, 0.6);
  assert.equal(app.phase, "shop");
  const b = mount().app;
  tap(b);
  assert.equal(b.phase, "aim");
  b.down(); run(b, MIN_HOLD - 0.05); b.up();
  assert.equal(b.phase, "aim", "a short press launched");
  hold(b, 0.5);
  assert.equal(b.phase, "fly");
  assert.ok(b.p.vx > 0 && b.p.vy > 0);
});

test("the angle is fixed by the press and the speed by the release", () => {
  const { app } = mount();
  tap(app);
  run(app, 0.4);
  app.down();
  const angle = app.angle;
  run(app, RISE * 0.5);
  assert.equal(app.angle, angle, "the barrel moved while charging");
  app.up();
  const v = Math.hypot(app.p.vx, app.p.vy), want = app.L.vmax * (0.3 + 0.7 * powerAt(RISE * 0.5));
  assert.ok(Math.abs(v - want) < 2, v + " vs " + want);
  assert.ok(Math.abs(Math.atan2(app.p.vy, app.p.vx) * 180 / Math.PI - angle) < 0.01);
});

test("a thruster fires on a press in flight, and there are only as many as the loadout", () => {
  const { app } = mount();
  fire(app);
  run(app, 0.3);
  const vx = app.p.vx, kicks = app.kicks;
  assert.equal(kicks, 1);
  tap(app);
  assert.equal(app.kicks, 0);
  assert.ok(app.p.vx > vx && app.p.vy > 0);
  const vx2 = app.p.vx;
  tap(app);
  assert.equal(app.p.vx, vx2, "an empty thruster still pushed");
});

test("a press just before touchdown is a skip, and a perfect skip bounces higher and keeps more speed than none", () => {
  const drop = (press) => {
    const { app } = mount();
    fire(app, 30);
    app.features = []; app.nextX = 1e9; // open ground
    Object.assign(app.p, { x: 300, y: 200, vx: 400, vy: -300, mode: "air" });
    let pressed = false;
    for (let i = 0; i < 200 && app.p.vy < 0; i++) {
      const tti = app.skipWindow();
      if (press && !pressed && tti >= 0 && tti <= app.L.perfect * 0.5) { tap(app); pressed = true; }
      app.update(F);
    }
    return { vy: app.p.vy, vx: app.p.vx, perfect: app.R.perfect, kicks: app.kicks };
  };
  const plain = drop(false), skipped = drop(true);
  assert.equal(skipped.perfect, 1);
  assert.equal(skipped.kicks, 1, "the skip used a thruster");
  assert.ok(skipped.vy > plain.vy * 1.3, skipped.vy + " vs " + plain.vy);
  assert.ok(skipped.vx > plain.vx);
});

test("a sinkhole ends the run, unless the pod skips off it", () => {
  const into = (skip) => {
    const { app } = mount();
    fire(app, 30);
    app.features = [{ k: "pit", x: 380, w: 120, y: 0, h: 0, a: 0, used: 0 }]; app.nextX = 1e9;
    Object.assign(app.p, { x: 400, y: 60, vx: 100, vy: -320, mode: "air" });
    for (let i = 0; i < 60 && app.phase === "fly" && app.p.vy < 0; i++) {
      if (skip && app.skipWindow() >= 0 && !app.skip) tap(app);
      app.update(F);
    }
    return app;
  };
  const lost = into(false);
  assert.equal(lost.phase, "over");
  assert.equal(lost.reason, "pit");
  const saved = into(true);
  assert.equal(saved.phase, "fly");
  assert.equal(saved.R.pitskip, 1);
});

test("pads, boosters and mines throw the pod on; drifts and nets slow it", () => {
  const land = (k, extra = {}) => {
    const { app } = mount();
    fire(app, 30);
    app.features = [{ k, x: 380, w: 120, y: 0, h: 0, a: 0, used: 0, ...extra }]; app.nextX = 1e9;
    Object.assign(app.p, { x: 360, y: 30, vx: 300, vy: -250, mode: "air" });
    for (let i = 0; i < 40; i++) app.update(F);
    return app;
  };
  const ground = land("updraft", { x: 5000 });
  const pad = land("pad"), boost = land("boost"), mine = land("mine"), drift = land("drift");
  assert.ok(pad.p.y > ground.p.y + 40, "pad");
  assert.ok(boost.p.x > ground.p.x + 40, "boost");
  assert.ok(mine.p.y > pad.p.y, "mine");
  assert.ok(drift.p.vx < ground.p.vx, "drift");
  assert.equal(mine.R.mines, 1);
  assert.equal(pad.R.lifts + boost.R.lifts + mine.R.lifts, 3);
  const net = land("net", { x: 400, h: 200 });
  assert.ok(net.p.vx < 200, "net");
});

test("a run rests and ends, scores its metres and saves, and the result screen offers again or the workshop", () => {
  const { ctx, app } = mount();
  const r = playRun(app, { thrust: false, skip: false });
  assert.equal(app.phase, "over");
  assert.ok(r.metres > 40, "metres " + r.metres);
  assert.equal(ctx.calls.score.at(-1)[0], r.metres);
  const saved = ctx.calls.saved.at(-1);
  assert.equal(saved.schema, 2);
  assert.equal(saved.runs, 1);
  assert.equal(saved.best, r.metres);
  assert.equal(saved.last.metres, r.metres);
  assert.ok(saved.salvage >= r.salvage - 1);
  hold(app, 0.6);
  assert.equal(app.phase, "shop");
});

// ---- the bot -----------------------------------------------------------------------------------

test("a careful player flies much farther than one who only fires, on the same fields", () => {
  const sum = (opts) => {
    let total = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const { app } = mount({ seed });
      total += playRun(app, { ...opts, jitter: new Random(seed) }).metres;
    }
    return total / 6;
  };
  const careful = sum({ skill: 1 }), idle = sum({ thrust: false, skip: false });
  assert.ok(careful > idle * 1.6, careful + " vs " + idle);
});

test("a campaign of runs with the workshop gets steadily farther and reaches new zones", () => {
  const { app, out } = campaign(30, 5, { skill: 0.6 });
  const early = out.slice(0, 5).reduce((a, o) => a + o.m, 0) / 5, late = out.slice(-5).reduce((a, o) => a + o.m, 0) / 5;
  assert.ok(late > early * 2, early + " -> " + late);
  assert.ok(app.sv.far >= 3, "zone " + app.sv.far);
  assert.ok(app.sv.up.reduce((a, b) => a + b) >= 10);
  assert.ok(app.sv.ft.length >= 5);
  // the save stays small and every number in the app stays finite, lists bounded
  assert.ok(JSON.stringify(app.sv).length < 4096);
  finite(plainState(app));
  assert.ok(app.features.length <= 60 && app.sq.length <= 12);
});

test("lamp values are always nine whole numbers 0-255 and change during play", () => {
  const { ctx, app } = mount();
  playRun(app, { skill: 0.8, jitter: new Random(2) });
  assert.ok(ctx.calls.leds.every(validLamps));
  assert.ok(new Set(ctx.calls.leds.map((v) => v.join())).size > 20);
});

// ---- tolerance -----------------------------------------------------------------------------

test("cancel() and dispose() at any moment leave the lamps off and nothing charging", () => {
  for (const at of [0.2, 0.9, 2.5]) {
    const { ctx, app } = mount();
    tap(app);
    app.down();
    run(app, at);
    app.cancel();
    assert.deepEqual(ctx.calls.leds.at(-1), Array(9).fill(0));
    assert.equal(app.charging, false);
    fire(app);
    run(app, at);
    app.dispose();
    assert.deepEqual(ctx.calls.leds.at(-1), Array(9).fill(0));
  }
});

test("three stray taps in flight do not end the run; tap, tap, hold and cancel() take back the thrusters", () => {
  const { ctx, app } = mount({ progress: { schema: 2, up: [0, 3, 0, 0, 0] } });
  fire(app);
  run(app, 0.4);
  const kicks = app.kicks, x = app.p.x;
  for (let i = 0; i < 3; i++) { app.down(); app.update(F); app.up(); app.update(F); app.update(F); }
  assert.equal(app.phase, "fly");
  assert.ok(app.kicks < kicks);
  run(app, 1);
  const before = { kicks: app.kicks, x: app.p.x, vx: app.p.vx, R: { ...app.R } };
  for (let i = 0; i < 2; i++) { app.down(); run(app, 4 / 60); app.up(); run(app, 3 / 60); }
  app.down();
  run(app, 1);
  app.cancel();
  assert.equal(app.phase, "fly");
  assert.deepEqual({ kicks: app.kicks, x: app.p.x, vx: app.p.vx, R: { ...app.R } }, before);
  assert.ok(app.p.x > x);
  assert.equal(ctx.calls.score.length, 0);
});

test("draw() runs in every phase and view, with the pod high above the screen", () => {
  const { app } = mount({ progress: { schema: 2, runs: 4, best: 300, salvage: 999, far: 5 } });
  const g = fakeCanvas();
  app.draw(g);
  tap(app);
  app.draw(g);
  app.down(); run(app, 0.4); app.draw(g); app.up();
  Object.assign(app.p, { y: 900 });
  for (const k of ["pad", "boost", "mine", "drift", "ice", "pit", "beacon", "net", "updraft", "gust", "scrap"]) app.place(k, app.p.x + 200);
  run(app, 0.2);
  app.draw(g);
  app.finish("pit");
  run(app, 1);
  app.draw(g);
  hold(app, 0.6);
  for (let i = 0; i < 10; i++) { app.draw(g); tap(app); }
  app.cur = 8; hold(app, 0.6); app.draw(g); tap(app); app.draw(g); hold(app, 0.6);
  app.cur = 9; hold(app, 0.6); app.draw(g);
  assert.ok(g.count.fillText > 50);
});

// ---- the workshop, pods, feats ---------------------------------------------------------------

test("the workshop buys a level with salvage, refuses without it, and saves", () => {
  const { ctx, app } = mount({ progress: { schema: 2, salvage: 50 } });
  hold(app, 0.6);
  assert.equal(app.phase, "shop");
  assert.equal(app.cur, 1, "the cursor starts on something affordable");
  hold(app, 0.6);
  assert.equal(app.sv.up[0], 1);
  assert.equal(app.sv.salvage, 50 - UPGRADES[0].cost[0]);
  assert.equal(ctx.calls.saved.at(-1).up[0], 1);
  hold(app, 0.6);
  assert.equal(app.sv.up[0], 1, "bought without the salvage");
  assert.match(app.need, /NEED/);
  // pods are locked until enough feats
  app.cur = 6; hold(app, 0.6);
  assert.equal(app.sv.pod, 0);
  app.sv.ft = FEATS.slice(0, 4).map((f) => f.id);
  hold(app, 0.6);
  assert.equal(app.sv.pod, 1);
  app.cur = 0; hold(app, 0.6);
  assert.equal(app.phase, "aim");
  assert.equal(app.podIx, 1);
  assert.ok(app.L.vmax > 560 && app.L.e > 0.4 + 0.05);
});

test("a feat is marked once, pays its bounty and shows on the result", () => {
  const { app } = mount();
  fire(app, 30);
  app.features = [{ k: "pad", x: 300, w: 200, y: 0, h: 0, a: 0, used: 0 }]; app.nextX = 1e9;
  Object.assign(app.p, { x: 320, y: 20, vx: 50, vy: -200, mode: "air" });
  run(app, 0.2);
  assert.equal(app.R.pads, 1);
  app.finish("rest");
  assert.ok(app.sv.ft.includes("pad"));
  assert.ok(app.newFeats.includes("pad"));
  assert.ok(app.result.bounty >= 30);
});

// ---- the daily run -------------------------------------------------------------------------

test("the daily run has the same field and loadout for everyone on a date, and does not touch the console best", () => {
  const day = (seed, up) => {
    const { ctx, app } = mount({ seed, progress: { schema: 2, up, pod: 0 } });
    app.dayKey = () => "2026-10-01";
    hold(app, 0.6);
    app.cur = 7;
    hold(app, 0.6);
    assert.equal(app.phase, "aim");
    assert.ok(app.daily);
    return { ctx, app };
  };
  const a = day(1, [0, 0, 0, 0, 0]), b = day(99, [5, 5, 5, 5, 5]);
  assert.deepEqual(a.app.features, b.app.features);
  assert.deepEqual(a.app.L, b.app.L);
  playRun(a.app, { skill: 1, jitter: new Random(1) });
  assert.equal(a.ctx.calls.score.length, 0);
  assert.equal(a.app.sv.dl.d, "2026-10-01");
  assert.ok(a.app.sv.dl.best > 0);
  assert.equal(a.app.sv.best, 0);
});

test("daily goals are fixed per date and meeting one counts a streak", () => {
  assert.deepEqual(dailyGoal("2026-10-01"), dailyGoal("2026-10-01"));
  const kinds = new Set();
  for (let d = 1; d <= 28; d++) kinds.add(dailyGoal("2026-10-" + String(d).padStart(2, "0")).kind);
  assert.equal(kinds.size, 4);
  const { app } = mount({ progress: { schema: 2, dl: { d: "2026-09-30", done: 1, streak: 3, last: "2026-09-30", best: 50 } } });
  app.dayKey = () => "2026-10-01";
  app.startRun(true);
  app.goalMet = () => true;
  app.finish("rest");
  assert.equal(app.sv.dl.streak, 4);
  assert.equal(app.sv.dl.done, 1);
  assert.ok(app.sv.ft.includes("daily"));
});

test("a good player meets each kind of daily goal on the daily loadout", () => {
  const goals = { metres: (a) => a.metres, perfect: (a) => a.R.perfect, lifts: (a) => a.R.lifts, scrap: (a) => a.R.scrap };
  const most = { metres: 0, perfect: 0, lifts: 0, scrap: 0 };
  for (let d = 1; d <= 8; d++) {
    const { app } = mount({ seed: d });
    app.dayKey = () => "2026-10-0" + d;
    app.startRun(true);
    playRun(app, { skill: 1, jitter: new Random(3) });
    for (const k in goals) most[k] = Math.max(most[k], goals[k](app));
  }
  // the hardest version of each goal
  assert.ok(most.metres >= 300, "metres " + most.metres);
  assert.ok(most.perfect >= 3, "perfect " + most.perfect);
  assert.ok(most.lifts >= 3, "lifts " + most.lifts);
  assert.ok(most.scrap >= 13, "scrap " + most.scrap);
});
// ---- saves -------------------------------------------------------------------------------------

// What the first Ballista (an artillery game) left behind: kit.js recordRun's record.
const V1 = { schema: 1, runs: 7, last: { score: 1840, stations: 4, shots: 19, accuracy: 42, milestone: 4 }, milestone: 4 };

test("a save from the first Ballista migrates: runs carry over, its record is kept, and it brings salvage", () => {
  const s = migrateSave(V1);
  assert.equal(s.schema, 2);
  assert.equal(s.runs, 7);
  assert.equal(s.salvage, 140);
  assert.equal(s.best, 0);
  assert.equal(s.milestone, 0);
  assert.deepEqual(s.up, [0, 0, 0, 0, 0]);
  assert.deepEqual(s.legacy, { runs: 7, score: 1840, stations: 4 });
  assert.deepEqual(s.last, {});
  // migration is idempotent and a migrated save survives a JSON round trip
  assert.deepEqual(migrateSave(JSON.parse(JSON.stringify(s))), s);
  assert.equal(migrateSave({ schema: 1, runs: 400 }).salvage, 300, "the grant is capped");
});

test("the app loads a first-Ballista save, plays, and writes schema 2 that keeps the old record", () => {
  const { ctx, app } = mount({ progress: V1 });
  assert.equal(app.sv.salvage, 140);
  app.draw(fakeCanvas());
  playRun(app, { skill: 0.7, jitter: new Random(4) });
  const saved = ctx.calls.saved.at(-1);
  assert.equal(saved.schema, 2);
  assert.equal(saved.runs, 8);
  assert.equal(saved.legacy.score, 1840);
  assert.ok(saved.salvage > 140);
});

test("migrateSave tolerates nothing, garbage and out-of-range values", () => {
  for (const raw of [undefined, null, 5, "x", [], {}, { schema: 2, up: "no", ft: ["nope", "pad", "pad"], pod: 9, far: -3, salvage: NaN, dl: 7, seen: { pad: 1, evil: 1 } }]) {
    const s = migrateSave(raw);
    assert.equal(s.schema, 2);
    assert.equal(s.up.length, UPGRADES.length);
    assert.ok(s.pod >= 0 && s.pod < PODS.length && s.far >= 0 && s.far < ZONES.length);
    finite(s);
  }
  const s = migrateSave({ schema: 2, ft: ["nope", "pad", "pad"], seen: { pad: 1, evil: 1 }, up: [9, -1, 2.7] });
  assert.deepEqual(s.ft, ["pad"]);
  assert.deepEqual(s.seen, { pad: 1 });
  assert.deepEqual(s.up, [5, 0, 2, 0, 0]);
});

test("metres are measured in tenths of the logical pixel scale", () => {
  assert.equal(M, 10);
  assert.ok(SKIP_WIN > 0.2 && SKIP_WIN < 0.5);
});

test("shopping from the result screen spends salvage on the cheapest system", () => {
  const { app } = mount({ progress: { schema: 2, salvage: 200 } });
  playRun(app, { thrust: false, skip: false });
  shop(app);
  assert.ok(app.sv.up.reduce((a, b) => a + b) >= 3);
  assert.equal(app.phase, "aim");
});
