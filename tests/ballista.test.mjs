import test from "node:test";
import assert from "node:assert/strict";
import {
  Ballista, migrateSave, dailyGoal, loadout, zoneAt, sweepAngle, powerAt, timeToGround,
  ZONES, UPGRADES, PODS, FEATS, MODULES, SLOTS, SLOT3_FEATS, M, RISE, MIN_HOLD, SKIP_WIN, EARLY_WIN, LATE_WIN,
  contractText, contractProgress, chainMult, salvageFor, upCost, MARK_SPEED,
} from "../web/apps/ballista.js";
import { Random } from "../web/engine/math.js";
import { appContext, fakeCanvas, run } from "./helpers/app-context.mjs";
import { playRun, campaign, shop } from "./helpers/ballista-bot.mjs";

const F = 1 / 60;
const tap = (app) => { app.down(); app.up(); };
function hold(app, seconds) { app.down(); run(app, seconds); app.up(); }
// The workshop line `id` for this save (lines that do nothing yet are hidden).
const row = (app, id) => { const i = app.rows().indexOf(id); assert.ok(i >= 0, id + " is not shown"); return i; };
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
  assert.deepEqual(PODS.map((p) => p.need), [0, 4, 8, 14]);
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
  assert.equal(kicks, 2);
  tap(app);
  assert.equal(app.kicks, 1);
  assert.ok(app.p.vx > vx && app.p.vy > 0);
  run(app, 0.1);
  tap(app);
  assert.equal(app.kicks, 0);
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
  assert.equal(skipped.kicks, 2, "the skip used a thruster");
  assert.ok(skipped.vy > plain.vy * 1.3, skipped.vy + " vs " + plain.vy);
  assert.ok(skipped.vx > plain.vx);
});

test("a press near touchdown never spends a thruster: early does nothing, late is still a skip", () => {
  const descend = () => {
    const { app } = mount();
    fire(app, 30);
    app.features = []; app.nextX = 1e9;
    Object.assign(app.p, { x: 300, y: 200, vx: 400, vy: -300, mode: "air" });
    return app;
  };
  // early: a press a little before the window is ignored, and a second press in it still skips
  const early = descend(), kicks = early.kicks;
  let pressed = 0;
  for (let i = 0; i < 200 && early.p.vy < 0; i++) {
    const t = early.landIn();
    if (pressed === 0 && t > SKIP_WIN && t < SKIP_WIN + EARLY_WIN) { tap(early); pressed = 1; assert.equal(early.kicks, kicks, "early press spent a thruster"); assert.ok(early.early > 0); assert.equal(early.skip, null); }
    if (pressed === 1 && t >= 0 && t <= early.L.perfect * 0.5) { tap(early); pressed = 2; }
    early.update(F);
  }
  assert.equal(pressed, 2);
  assert.equal(early.R.perfect, 1);
  assert.equal(early.kicks, kicks);
  // late: a press just after a plain touchdown turns it into a good skip
  const late = descend(), plain = descend();
  for (let i = 0; i < 200 && late.p.y > 0.01 && late.p.vy <= 0; i++) { late.update(F); plain.update(F); }
  late.update(F); plain.update(F);
  for (let i = 0; i < Math.floor((LATE_WIN * 60) / 2); i++) { late.update(F); plain.update(F); }
  tap(late);
  assert.equal(late.kicks, kicks, "late press spent a thruster");
  assert.equal(late.R.good, 1);
  late.update(F); plain.update(F);
  assert.ok(late.p.vx > plain.p.vx && late.p.vy > plain.p.vy, late.p.vx + "," + late.p.vy + " vs " + plain.p.vx + "," + plain.p.vy);
  // after the late window a press is a thruster again
  const after = descend();
  for (let i = 0; i < 200 && after.p.vy <= 0; i++) after.update(F);
  for (let i = 0; i < Math.ceil(LATE_WIN * 60) + 2; i++) after.update(F);
  if (after.landIn() < 0) { tap(after); assert.equal(after.kicks, kicks - 1); }
});

test("perfect skips gain speed, and more along a chain; good skips lose a little", () => {
  const skipAt = (frac, chain) => {
    const { app } = mount();
    fire(app, 30);
    app.features = []; app.nextX = 1e9;
    Object.assign(app.p, { x: 300, y: 200, vx: 400, vy: -300, mode: "air" });
    app.chain = chain;
    let done = false;
    for (let i = 0; i < 200 && app.p.vy < 0; i++) {
      const tti = app.skipWindow();
      if (!done && tti >= 0 && tti <= frac) { tap(app); done = true; }
      app.update(F);
    }
    return app.p.vx;
  };
  const vxBefore = (() => { const { app } = mount(); fire(app, 30); app.features = []; app.nextX = 1e9; Object.assign(app.p, { x: 300, y: 200, vx: 400, vy: -300, mode: "air" }); for (let i = 0; i < 200 && app.p.vy < 0 && app.p.y > 5; i++) app.update(F); return app.p.vx; })();
  const perfect0 = skipAt(0.03, 0), perfect5 = skipAt(0.03, 5), good = skipAt(SKIP_WIN * 0.95, 0);
  assert.ok(perfect0 > vxBefore, perfect0 + " vs " + vxBefore);
  assert.ok(perfect5 > perfect0 * 1.05, perfect5 + " vs " + perfect0);
  assert.ok(good < vxBefore, good + " vs " + vxBefore);
});

test("the aim screen predicts where a shot first lands, and shows the field to there", () => {
  const { app } = mount();
  tap(app);
  assert.equal(app.phase, "aim");
  assert.ok(app.features.some((f) => f.x > app.reach * 0.8), "the field is placed out to the reach");
  for (const [angle, power] of [[20, 0.5], [40, 1], [60, 0.8]]) {
    const { app: b } = mount();
    tap(b);
    const want = b.carry(angle, power);
    b.features = []; b.nextX = 1e9;
    b.angle = angle; b.power = power;
    b.fire();
    let x = 0;
    for (let i = 0; i < 1200 && b.phase === "fly"; i++) { b.update(F); if (b.p.y <= 0.6 && b.R.bounces + b.R.lifts > 0) { x = b.p.x; break; } if (b.p.mode !== "air") { x = b.p.x; break; } }
    assert.ok(Math.abs(x - want) < 30, angle + "/" + power + ": " + x + " vs " + want);
  }
  const g = fakeCanvas();
  app.draw(g);
  app.down(); run(app, 0.4); app.draw(g); app.up();
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
  assert.equal(saved.schema, 3);
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

test("upgrades do not outweigh skill: careful timing on a small loadout keeps up with a full one", () => {
  // bots with a hand's lag; `skill` sets how widely their skips scatter around the perfect moment
  const mean = (level, skill) => {
    const { app } = mount({ seed: 7 });
    app.sv.up = [level, level, level, level, level];
    const jitter = new Random(22);
    let total = 0;
    for (let r = 0; r < 16; r++) total += playRun(app, { skill, lag: 0.2, jitter }).metres;
    return total / 16;
  };
  const sharp0 = mean(0, 1), sharp2 = mean(2, 1), sharp5 = mean(5, 1), loose2 = mean(2, 0.2), loose5 = mean(5, 0.2);
  assert.ok(sharp2 > loose2 * 1.3, "skill at II: " + sharp2 + " vs " + loose2);
  assert.ok(sharp5 > loose5 * 1.3, "skill at V: " + sharp5 + " vs " + loose5);
  assert.ok(sharp2 > loose5 * 0.75, "a sharp II against a loose V: " + sharp2 + " vs " + loose5);
  assert.ok(sharp5 < sharp0 * 4.5, "upgrades: " + sharp0 + " -> " + sharp5);
});

test("a campaign of runs with the workshop gets steadily farther and reaches new zones", () => {
  const { app, out } = campaign(30, 5, { skill: 0.6 });
  // the first runs buy the cheap levels quickly; after that, skill carries more of the distance
  const early = out.slice(0, 2).reduce((a, o) => a + o.m, 0) / 2, late = out.slice(-5).reduce((a, o) => a + o.m, 0) / 5;
  assert.ok(late > early * 1.6, early + " -> " + late);
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
  app.cur = row(app, "RECORDS"); hold(app, 0.6); for (let i = 0; i < 6; i++) { app.draw(g); tap(app); } app.draw(g); hold(app, 0.6);
  app.cur = row(app, "CONTRACTS"); hold(app, 0.6); app.draw(g); tap(app);
  app.sv.mods = ["spring"];
  app.cur = row(app, "MODULES"); hold(app, 0.6); for (let i = 0; i < 12; i++) { app.draw(g); tap(app); }
  hold(app, 0.6); app.draw(g);
  for (let z = 0; z < ZONES.length; z++) { app.sv.far = z; app.draw(g); }
  app.phase = "fly"; for (let z = 0; z < ZONES.length; z++) { app.camX = ZONES[z].from * M - 300; app.draw(g); } // every zone's sky and silhouettes
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
  assert.ok(!app.rows().includes("POD"));
  app.sv.ft = FEATS.slice(0, 4).map((f) => f.id);
  app.cur = row(app, "POD"); hold(app, 0.6);
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
    app.cur = row(app, "DAILY");
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
    playRun(app, { skill: 1, aimPad: true, jitter: new Random(3) });
    for (const k in goals) most[k] = Math.max(most[k], goals[k](app));
  }
  // the hardest version of each goal
  assert.ok(most.metres >= 300, "metres " + most.metres);
  assert.ok(most.perfect >= 3, "perfect " + most.perfect);
  assert.ok(most.lifts >= 3, "lifts " + most.lifts);
  assert.ok(most.scrap >= 11, "scrap " + most.scrap);
});
// ---- saves -------------------------------------------------------------------------------------

// What the first Ballista (an artillery game) left behind: kit.js recordRun's record.
const V1 = { schema: 1, runs: 7, last: { score: 1840, stations: 4, shots: 19, accuracy: 42, milestone: 4 }, milestone: 4 };

test("a save from the first Ballista migrates: runs carry over, its record is kept, and it brings salvage", () => {
  const s = migrateSave(V1);
  assert.equal(s.schema, 3);
  assert.equal(s.ct.length, 3);
  assert.deepEqual(s.mods, []);
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

test("the app loads a first-Ballista save, plays, and writes schema 3 that keeps the old record", () => {
  const { ctx, app } = mount({ progress: V1 });
  assert.equal(app.sv.salvage, 140);
  app.draw(fakeCanvas());
  playRun(app, { skill: 0.7, jitter: new Random(4) });
  const saved = ctx.calls.saved.at(-1);
  assert.equal(saved.schema, 3);
  assert.equal(saved.runs, 8);
  assert.equal(saved.legacy.score, 1840);
  assert.ok(saved.salvage > 140);
});

test("migrateSave tolerates nothing, garbage and out-of-range values", () => {
  for (const raw of [undefined, null, 5, "x", [], {}, { schema: 2, up: "no", ft: ["nope", "pad", "pad"], pod: 9, far: -3, salvage: NaN, dl: 7, seen: { pad: 1, evil: 1 } }]) {
    const s = migrateSave(raw);
    assert.equal(s.schema, 3);
    assert.equal(s.ct.length, 3);
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

// ---- schema 3: contracts, modules, chains ------------------------------------------------------

// What the launcher wrote before modules and contracts (the first version of this PR): schema 2.
const V2 = {
  schema: 2, runs: 12, last: { metres: 640, salvage: 85, lifts: 2, skips: 3, reason: "CAME TO REST" }, milestone: 6, best: 640, salvage: 85,
  up: [2, 2, 1, 2, 1], pod: 1, pb: [640, 300, 0], far: 3, ft: ["m100", "m400", "pad", "skip1"],
  st: { metres: 4200, pads: 9, perfect: 14, mines: 1, scrap: 60, daily: 1 },
  dl: { d: "2026-10-01", best: 410, done: 1, streak: 1, last: "2026-10-01" }, seen: { pad: 1, drift: 1, skip: 1 },
};

test("a schema 2 save migrates to schema 3 and keeps everything it had", () => {
  const s = migrateSave(V2);
  assert.equal(s.schema, 3);
  for (const k of ["runs", "milestone", "best", "salvage", "pod", "far"]) assert.equal(s[k], V2[k], k);
  assert.deepEqual(s.up, V2.up);
  assert.deepEqual(s.ft, V2.ft);
  assert.deepEqual(s.st, V2.st);
  assert.deepEqual(s.dl, V2.dl);
  assert.deepEqual(s.last, V2.last);
  assert.deepEqual(s.pb, [640, 300, 0, 0]);
  assert.deepEqual(s.seen, V2.seen);
  assert.deepEqual([s.mods, s.eq, s.cdone, s.chain], [[], [], 0, 0]);
  assert.equal(s.ct.length, 3);
  assert.equal(new Set(s.ct.map((c) => c.k)).size, 3, "three different contracts");
  assert.ok(s.ct.every((c) => c.n > 0 && c.pay > 0 && contractText(c)));
  assert.deepEqual(migrateSave(JSON.parse(JSON.stringify(s))), s, "idempotent");
  assert.deepEqual(migrateSave(V2).ct, s.ct, "the same contracts every time");
});

test("a contract met by a run pays, counts and is replaced; a daily run takes none", () => {
  const { app } = mount({ progress: { schema: 3, best: 200 } });
  app.sv.ct = [{ k: "scrap", n: 2, pay: 77, left: 10 }, { k: "chain", n: 9, pay: 50, left: 10 }, { k: "lifts", n: 9, pay: 50, left: 10 }];
  app.startRun(false);
  app.R.scrap = 3;
  app.finish("rest");
  assert.equal(app.sv.cdone, 1);
  assert.ok(app.result.bounty >= 77);
  assert.deepEqual(app.result.contracts, ["Collect 2 scrap in one run."]);
  assert.notEqual(app.sv.ct[0].k, "scrap");
  assert.equal(app.sv.ct.length, 3);
  assert.equal(new Set(app.sv.ct.map((c) => c.k)).size, 3);
  const before = JSON.stringify(app.sv.ct);
  app.dayKey = () => "2026-10-02";
  app.startRun(true);
  app.R.scrap = 99; app.R.chain = 99; app.R.lifts = 99;
  app.finish("rest");
  assert.equal(JSON.stringify(app.sv.ct), before);
  assert.equal(app.sv.cdone, 1);
  assert.equal(contractProgress({ k: "unaided", n: 100 }, { m: 300, thrusts: 1 }), 0);
  // a job not met in ten runs is withdrawn and another posted
  app.sv.ct = [{ k: "chain", n: 10, pay: 50, left: 1 }, { k: "lifts", n: 9, pay: 50, left: 5 }, { k: "scrap", n: 99, pay: 50, left: 5 }];
  app.startRun(false);
  app.finish("rest");
  assert.notEqual(app.sv.ct[0].k, "chain");
  assert.equal(app.sv.ct[0].left, 10);
  assert.equal(app.sv.ct[1].left, 4);
  assert.equal(contractProgress({ k: "zone", n: 2 }, { m: 400 }), 2);
});

test("a chain grows with pads and perfect skips, ends on a plain landing, and multiplies salvage", () => {
  const { app } = mount();
  fire(app, 30);
  app.features = [{ k: "pad", x: 300, w: 60, y: 0, h: 0, a: 0, used: 0 }, { k: "pad", x: 900, w: 2000, y: 0, h: 0, a: 0, used: 0 }]; app.nextX = 1e9;
  Object.assign(app.p, { x: 320, y: 20, vx: 300, vy: -200, mode: "air" });
  for (let i = 0; i < 400 && app.R.lifts < 2; i++) app.update(F);
  assert.ok(app.chain >= 2, "chain " + app.chain);
  assert.ok(app.R.chain >= 2);
  app.features = []; // open ground: the next landing is plain
  for (let i = 0; i < 400 && app.chain; i++) app.update(F);
  assert.equal(app.chain, 0);
  assert.equal(chainMult(0), 1);
  assert.equal(chainMult(4), 1.4);
  assert.equal(chainMult(40), 2);
  assert.equal(salvageFor(80, 5, 2, 2), 2 * (5 + 10 + 10));
});

test("modules are built, fitted and removed in the workshop, within the slots", () => {
  const { ctx, app } = mount({ progress: { schema: 3, salvage: 5000, up: [2, 2, 2, 2, 2] } });
  assert.ok(!mount({ progress: { schema: 3, salvage: 5000 } }).app.rows().includes("MODULES"), "modules wait for the systems");
  hold(app, 0.6);
  app.cur = row(app, "MODULES"); hold(app, 0.6);
  assert.equal(app.view, "mods");
  hold(app, 0.6); // build SPRING TUNING: fitted at once
  tap(app); hold(app, 0.6); // SCRAP SCANNER
  tap(app); hold(app, 0.6); // BEACON RELAY: built, slots full
  assert.deepEqual(app.sv.mods, ["spring", "scanner", "relay"]);
  assert.deepEqual(app.sv.eq, ["spring", "scanner"]);
  assert.equal(app.sv.salvage, 5000 - 400 - 350 - 500);
  hold(app, 0.6); // relay again: slots full
  assert.match(app.need, /SLOTS ARE FULL/);
  app.mcur = 0; hold(app, 0.6); // remove spring
  app.mcur = 2; hold(app, 0.6); // fit relay
  assert.deepEqual(app.sv.eq, ["scanner", "relay"]);
  assert.deepEqual(ctx.calls.saved.at(-1).eq, ["scanner", "relay"]);
  app.mcur = MODULES.length; hold(app, 0.6);
  assert.equal(app.view, "menu");
  app.cur = 0; hold(app, 0.6);
  assert.deepEqual(app.mods, ["scanner", "relay"]);
  assert.equal(app.L.scrap, 4);
  assert.equal(app.L.relay, 2);
  // a third slot at SLOT3_FEATS feats
  app.sv.ft = FEATS.slice(0, SLOT3_FEATS).map((f) => f.id);
  assert.equal(app.slots(), SLOTS + 1);
});

test("module effects: the shell saves one sinkhole, the cutter parts nets, spring tuning throws higher", () => {
  const drop = (eq, k, extra = {}) => {
    const { app } = mount({ progress: { schema: 3, mods: eq, eq } });
    fire(app, 30);
    app.features = [{ k, x: 380, w: 120, y: 0, h: 0, a: 0, used: 0, ...extra }]; app.nextX = 1e9;
    Object.assign(app.p, { x: 360, y: 30, vx: 300, vy: -250, mode: "air" });
    for (let i = 0; i < 20 && app.phase === "fly"; i++) app.update(F);
    return app;
  };
  assert.equal(drop([], "pit").phase, "over");
  const shelled = drop(["shell"], "pit");
  assert.equal(shelled.phase, "fly");
  assert.equal(shelled.shell, 0);
  assert.ok(drop(["cutter"], "net", { x: 400, h: 200 }).p.vx > 200);
  assert.ok(drop([], "net", { x: 400, h: 200 }).p.vx < 120);
  assert.ok(drop(["spring"], "pad").p.vy > drop([], "pad").p.vy);
});

test("the daily run fits no modules", () => {
  const { app } = mount({ progress: { schema: 3, mods: ["burner", "rig"], eq: ["burner", "rig"] } });
  app.startRun(true);
  assert.deepEqual(app.mods, []);
  assert.equal(app.L.rig, 1);
  app.startRun(false);
  assert.deepEqual(app.mods, ["burner", "rig"]);
  assert.equal(app.L.rig, 1.25);
});

test("an overhaul needs every system at V and a second hold, then strips them for a faster mark", () => {
  const { ctx, app } = mount({ progress: { schema: 3, up: [5, 5, 5, 5, 4], salvage: 0 } });
  hold(app, 0.6);
  assert.ok(!app.rows().includes("OVERHAUL"), "no overhaul line before every system is at V");
  app.overhaul();
  assert.match(app.need, /EVERY SYSTEM/);
  app.sv.up[4] = 5;
  const v0 = loadout(app.sv.up, 0, [], 0).vmax;
  app.cur = row(app, "OVERHAUL");
  hold(app, 0.6);
  assert.equal(app.sv.mark, 0, "one hold overhauled");
  hold(app, 0.6);
  assert.equal(app.sv.mark, 1);
  assert.deepEqual(app.sv.up, [0, 0, 0, 0, 0]);
  assert.equal(ctx.calls.saved.at(-1).mark, 1);
  assert.ok(app.sv.ft.includes("mark2"));
  assert.ok(upCost(0, 0, 1) > UPGRADES[0].cost[0]);
  assert.ok(Math.abs(loadout([5, 5, 5, 5, 5], 0, [], 1).vmax - v0 * (1 + MARK_SPEED)) < 1e-6);
  // stepping away cancels a pending overhaul
  const b = mount({ progress: { schema: 3, up: [5, 5, 5, 5, 5] } }).app;
  hold(b, 0.6); b.cur = row(b, "OVERHAUL"); hold(b, 0.6); tap(b); b.cur = row(b, "OVERHAUL"); hold(b, 0.6);
  assert.equal(b.sv.mark, 0);
});
