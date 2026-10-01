// MOONRUNNER, the downhill run: physics, tricks, zones, orders, save migration, depot, lamps, and
// seeded bots (tests/helpers/runner-bot.mjs) that play through the real down()/up()/update().
import test from "node:test";
import assert from "node:assert/strict";
import { Moonrunner, migrateSave, ordersFor, orderText, ORDER_KINDS, ZONES, RIDES, WORKSHOP, dailyGoal, zoneAt, PX_M, SEG, CLEAN, STUMBLE, MIN_V } from "../web/apps/runner.js";
import { appContext, fakeCanvas } from "./helpers/app-context.mjs";
import { runnerBot } from "./helpers/runner-bot.mjs";

const DT = 1 / 60;
const TAU = Math.PI * 2;
const step = (g, seconds, each) => { for (let i = 0, n = Math.round(seconds * 60); i < n; i++) { each?.(); g.update(DT); } };
function started(options = {}) {
  const ctx = appContext(options), g = new Moonrunner(ctx);
  g.down(); g.up(); // the title screen starts a run on release
  return { ctx, g };
}
// Past the forgiving first stretch, a boulder under the sled ends the run.
function kill(g) { g.forgiveTo = 0; g.rocks.push({ x: g.r.x + 4, r: 20, done: false, hit: false }); g.update(DT); }
function play(seed, opts = {}, seconds = 300) {
  const { ctx, g } = started({ seed });
  const bot = opts.idle ? null : runnerBot(g, opts);
  let t = 0;
  while (g.phase === "play" && t < seconds) { bot?.(); g.update(DT); t += DT; }
  return { ctx, g, t };
}
// Every number in the game's plain state, at any depth.
function numbers(value, out = [], seen = new Set()) {
  if (typeof value === "number") out.push(value);
  else if (value && typeof value === "object" && !seen.has(value)) {
    seen.add(value);
    if (ArrayBuffer.isView(value)) out.push(...value);
    else for (const v of Object.values(value)) numbers(v, out, seen);
  }
  return out;
}
const plainState = (g) => Object.fromEntries(Object.entries(g).filter(([k, v]) => k !== "c" && k !== "guard" && k !== "lamps" && typeof v !== "function"));

// ---- bots ------------------------------------------------------------------------------------
test("a competent bot rides far and outscores a rider who never presses, on several seeds", () => {
  for (const seed of [1, 2, 3]) {
    const idle = play(seed, { idle: true }), good = play(seed, {}, 240);
    assert.equal(idle.g.phase, "over", "the idle rider survived");
    assert.ok(idle.t > 20, `a newcomer who does nothing dies in the first 20 s (${idle.t.toFixed(1)} s)`);
    assert.ok(idle.g.R.m < ZONES[2].from, "the idle rider got past the boulders");
    assert.ok(good.t > 120, `seed ${seed}: the bot died after ${good.t.toFixed(0)} s (${good.g.reason})`);
    assert.ok(good.g.scoreNow() > 6 * idle.g.scoreNow(), `seed ${seed}: ${good.g.scoreNow()} vs idle ${idle.g.scoreNow()}`);
    assert.ok(good.g.R.flips >= 3 && good.g.R.zone >= 3, JSON.stringify(good.g.R));
  }
});
test("flipping is worth it: the same bot scores more when it flips", () => {
  let flip = 0, plain = 0;
  for (const seed of [4, 5]) { flip += play(seed, {}, 150).g.scoreNow(); plain += play(seed, { flips: false }, 150).g.scoreNow(); }
  assert.ok(flip > plain * 1.15, `${flip} vs ${plain}`);
});
test("a sloppy rider (jumps 0.15 s late) dies much sooner than a careful one", () => {
  let sloppy = 0, careful = 0;
  for (const seed of [6, 7, 8]) { sloppy += play(seed, { lag: 0.15, flips: false }).t; careful += play(seed, { flips: false }).t; }
  assert.ok(sloppy < careful / 2, `sloppy ${sloppy.toFixed(0)} s, careful ${careful.toFixed(0)} s`);
});
test("a long run has no NaN anywhere and every list stays bounded", () => {
  const { ctx, g } = started({ seed: 9 });
  const bot = runnerBot(g);
  let worst = { ty: 0, rocks: 0, shards: 0, chasms: 0, rails: 0, vents: 0 };
  for (let i = 0; i < 60 * 200 && g.phase === "play"; i++) {
    bot(); g.update(DT);
    for (const k of Object.keys(worst)) worst[k] = Math.max(worst[k], g[k].length);
    if (i % 600 === 0) assert.ok(numbers(plainState(g)).every(Number.isFinite), "a number is not finite at frame " + i);
  }
  assert.ok(worst.ty < 60 && worst.rocks <= 24 && worst.shards <= 64 && worst.chasms <= 8 && worst.rails <= 8 && worst.vents <= 8, JSON.stringify(worst));
  assert.ok(numbers(plainState(g)).every(Number.isFinite));
  assert.ok(JSON.stringify(ctx.calls.saved.at(-1) || g.sv).length < 4096, "the save is small");
});

// ---- physics and tricks -------------------------------------------------------------------------
test("a tap jumps without turning the sled; holding in the air turns it backwards", () => {
  const a = started({ seed: 10 }).g, b = started({ seed: 10 }).g;
  step(a, 0.5); step(b, 0.5);
  a.down(); a.update(DT); a.up();
  b.down();
  let top = Infinity;
  for (let i = 0; i < 30; i++) { a.update(DT); b.update(DT); top = Math.min(top, a.r.y - a.gy(a.r.x)); }
  assert.ok(top < -40, "the jump did not leave the ground");
  assert.equal(a.r.spin, 0, "a tap turned the sled");
  assert.ok(b.r.spin < -2, "holding did not turn the sled backwards: " + b.r.spin);
});
test("a clean landing of a full turn is a flip: points, combo, speed; landing upside down ends the run", () => {
  const { g } = started({ seed: 11 });
  step(g, 1);
  const r = g.r, pts = g.pts, v = r.v;
  // Set up a landing: one full turn done, board along the slope below.
  r.air = true; r.y = g.gy(r.x) - 2; r.vy = 400; r.vx = v; r.spin = -TAU; r.a = g.slopeAt(r.x + 8) - TAU; r.w = 0;
  for (let i = 0; i < 10 && r.air; i++) g.update(DT);
  assert.equal(g.R.flips, 1);
  assert.equal(g.combo, 1);
  assert.ok(g.pts >= pts + 100, "a flip is worth 100 at x1");
  const after = started({ seed: 11 }).g;
  step(after, 1);
  after.forgiveTo = 0;
  Object.assign(after.r, { air: true, y: after.gy(after.r.x) - 2, vy: 400, a: after.slopeAt(after.r.x) + Math.PI, spin: -Math.PI, w: 0 });
  for (let i = 0; i < 10 && after.phase === "play"; i++) after.update(DT);
  assert.equal(after.phase, "over");
  assert.equal(after.reason, "land");
});
test("a landing between clean and crash is a stumble: speed and combo are lost, the run goes on", () => {
  const { g } = started({ seed: 12 });
  step(g, 1);
  g.forgiveTo = 0; g.combo = 5; g.comboT = 2;
  const v = g.r.v = 500;
  Object.assign(g.r, { air: true, y: g.gy(g.r.x) - 2, vx: 500, vy: 400, a: g.slopeAt(g.r.x + 8) - (CLEAN + STUMBLE) / 2 - 0.05, spin: -0.7, w: 0 });
  for (let i = 0; i < 10 && g.r.air; i++) g.update(DT);
  assert.equal(g.phase, "play");
  assert.equal(g.combo, 0);
  assert.ok(g.r.v < v * 0.8);
  assert.equal(g.R.stumbles, 1);
});
test("the first 250 m forgive a crash; after that a boulder ends the run and it is recorded once", () => {
  const { ctx, g } = started({ seed: 13 });
  step(g, 0.5);
  g.rocks.push({ x: g.r.x + 4, r: 20, done: false, hit: false }); g.update(DT);
  assert.equal(g.phase, "play", "an early crash ended the run");
  assert.ok(g.inv > 0, "a tumble gives a moment of grace");
  step(g, 2);
  kill(g);
  assert.equal(g.phase, "over");
  assert.equal(g.reason, "rock");
  step(g, 3);
  assert.equal(ctx.calls.score.length, 1, "the score was not recorded exactly once");
  assert.equal(ctx.calls.saved.filter((s) => s.runs === 1).length, 1);
  assert.equal(ctx.calls.saved.at(-1).schema, 2);
});
test("hover pads catch one crash per tier", () => {
  const { g } = started({ seed: 14, progress: { schema: 2, up: { hov: 1 } } });
  step(g, 0.5);
  assert.equal(g.hovers, 1);
  kill(g);
  assert.equal(g.phase, "play");
  assert.equal(g.hovers, 0);
  step(g, 2);
  kill(g);
  assert.equal(g.phase, "over");
});
test("combos multiply trick points, run out on plain ground and surge the sled from three", () => {
  const { g } = started({ seed: 15 });
  step(g, 0.5);
  for (let i = 0; i < 6; i++) g.trickDone(1, 10, "T");
  assert.equal(g.mult(), 3);
  assert.equal(g.R.combo, 6);
  step(g, 3);
  assert.equal(g.combo, 0, "the combo did not run out");
});
test("a rille is cleared by a jump before its edge and swallows a sled that rides into it", () => {
  const { g } = started({ seed: 16, progress: { schema: 2, far: 2, sel: { start: 2 } } });
  // Start in the rilles; the bot jumps them.
  assert.equal(g.zone, 2);
  g.forgiveTo = 0;
  const bot = runnerBot(g, { flips: false });
  step(g, 40, bot);
  assert.ok(g.R.chasms >= 3, "rilles cleared " + g.R.chasms);
  const idle = started({ seed: 16, progress: { schema: 2, far: 2, sel: { start: 2 } } }).g;
  idle.forgiveTo = 0;
  step(idle, 40);
  assert.equal(idle.phase, "over");
});
test("cables are ground: points per metre, and a rille too wide to jump always has a cable over it", () => {
  const { g } = started({ seed: 17, progress: { schema: 2, far: 3, sel: { start: 3 } } });
  g.forgiveTo = 0;
  const bot = runnerBot(g, { flips: false });
  let wide = 0;
  for (let i = 0; i < 60 * 60 && g.phase === "play"; i++) {
    bot(); g.update(DT);
    for (const c of g.chasms) if (c.x1 - c.x0 > 200) {
      wide++;
      assert.ok(g.rails.some((rl) => rl.x0 < c.x0 && rl.x1 > c.x1), "a wide rille has no cable");
    }
  }
  assert.ok(wide > 0 && g.R.grind > 20, `wide ${wide}, grind ${g.R.grind}`);
});
test("a vent throws the sled high enough for a double flip", () => {
  const { g } = started({ seed: 18 });
  step(g, 0.5);
  g.vents.push({ x: g.r.x + 20, w: 56, used: false });
  let top = 0;
  for (let i = 0; i < 120; i++) { g.update(DT); top = Math.max(top, g.gy(g.r.x) - g.r.y); }
  assert.ok(top > 250, "vent height " + top);
});

// ---- the slope ---------------------------------------------------------------------------------
test("the slope is smooth and continuous, and the camera moves exactly with the sled", () => {
  const { g } = started({ seed: 19 });
  const bot = runnerBot(g);
  let worst = 0;
  for (let i = 0; i < 60 * 60 && g.phase === "play"; i++) {
    const cam = g.camX, x = g.r.x;
    bot(); g.update(DT);
    if (g.phase === "play") assert.ok(Math.abs((g.camX - cam) - (g.r.x - x)) < 1e-6);
    for (let k = 0; k < 4; k++) {
      const x0 = g.r.x + k * 200;
      worst = Math.max(worst, Math.abs(g.gy(x0 + 1) - g.gy(x0)));
    }
  }
  assert.ok(worst < 4, "the ground jumps by " + worst + " px in 1 px");
});
test("each zone adds its own feature: boulders from II, rilles from III, cables from IV, vents from V", () => {
  const seen = ZONES.map(() => new Set());
  for (let zi = 0; zi < ZONES.length; zi++) {
    const g = new Moonrunner(appContext({ seed: 20 + zi }));
    g.sv.far = 5; g.sv.sel.start = zi;
    g.start();
    // Sweep the sled forward and file what the planner put down under the zone it lies in.
    const note = (x, kind) => { if (x > g.x0 + 2400) seen[zoneAt(x / PX_M)].add(kind); };
    for (let k = 0; k < 80; k++) {
      g.r.x += 300; g.extend();
      for (const q of g.rocks) note(q.x, "rock");
      for (const c of g.chasms) note(c.x0, "chasm");
      for (const rl of g.rails) note(rl.x0, "rail");
      for (const v of g.vents) note(v.x, "vent");
      g.prune();
    }
  }
  assert.deepEqual([...seen[0]], [], "the mare has hazards");
  assert.ok(seen[1].has("rock") && !seen[1].has("chasm") && !seen[1].has("rail"), [...seen[1]].join());
  assert.ok(seen[2].has("chasm") && !seen[2].has("rail") && !seen[2].has("vent"), [...seen[2]].join());
  assert.ok(seen[3].has("rail") && !seen[3].has("vent"), [...seen[3]].join());
  assert.ok(seen[4].has("vent"), [...seen[4]].join());
  assert.ok(["rock", "chasm", "rail", "vent"].every((k) => seen[5].has(k)), [...seen[5]].join());
});
test("the first 120 m of every run are free of hazards", () => {
  for (const seed of [21, 22, 23]) {
    const { g } = started({ seed, progress: { schema: 2, far: 5, sel: { start: 4 } } });
    assert.ok(!g.rocks.some((q) => q.x < g.x0 + 2400) && !g.chasms.some((c) => c.x0 < g.x0 + 2400) && !g.vents.length || g.vents.every((v) => v.x > g.x0 + 2400));
  }
});
test("plain rilles are narrow enough to jump at the slowest speed", () => {
  const { g } = started({ seed: 24, progress: { schema: 2, far: 5, sel: { start: 2 } } });
  let n = 0;
  for (let k = 0; k < 60; k++) {
    g.r.x += 300; g.extend(); g.prune();
    for (const c of g.chasms) if (!g.rails.some((rl) => rl.x0 < c.x0 && rl.x1 > c.x1)) { n++; assert.ok(c.x1 - c.x0 < MIN_V * 0.7, "width " + (c.x1 - c.x0)); }
  }
  assert.ok(n > 3);
});

// ---- lamps -------------------------------------------------------------------------------------
test("lamps: always nine whole numbers 0-255, changing during play, dark on the title and result screens", () => {
  const ctx = appContext({ seed: 25 }), g = new Moonrunner(ctx);
  step(g, 1);
  assert.ok(ctx.calls.leds.every((v) => v.every((x) => x === 0)), "the title screen is lit");
  g.down(); g.up();
  const bot = runnerBot(g);
  step(g, 30, bot);
  const writes = ctx.calls.leds;
  assert.ok(writes.every((v) => v.length === 9 && v.every((x) => Number.isInteger(x) && x >= 0 && x <= 255)));
  assert.ok(new Set(writes.map((v) => v.join())).size > 20, "the lamps hardly change");
  kill(g);
  assert.ok(ctx.calls.leds.at(-1).some((x) => x > 0), "no red at the end");
  step(g, 1);
  assert.ok(ctx.calls.leds.at(-1).every((x) => x === 0), "lamps lit on the result screen");
});
test("lamps in the air: green when a landing now would be clean, red when it would crash", () => {
  const { ctx, g } = started({ seed: 26 });
  step(g, 1);
  const r = g.r;
  Object.assign(r, { air: true, y: g.gy(r.x) - 60, vy: -50, a: g.slopeAt(r.x + r.vx * 0.15), w: 0, spin: 0 });
  g.update(DT);
  let v = ctx.calls.leds.at(-1);
  assert.ok(v[1] > v[0] && v[1] > 0, "not green: " + v);
  Object.assign(r, { air: true, y: g.gy(r.x) - 60, vy: -50, a: g.slopeAt(r.x) + Math.PI, w: 0 });
  g.update(DT);
  v = ctx.calls.leds.at(-1);
  assert.ok(v[0] > v[1] * 2, "not red: " + v);
});
test("lamps on the ground: the right lamp brightens as a boulder closes and blinks when it is time to jump", () => {
  const { ctx, g } = started({ seed: 27 });
  step(g, 1);
  const r = g.r, levels = [];
  for (const ahead of [0.9, 0.6, 0.4]) {
    g.rocks = [{ x: r.x + r.v * ahead + 20, r: 18, done: false, hit: false }];
    g.update(DT);
    const v = ctx.calls.leds.at(-1);
    levels.push(v[6] + v[7] + v[8]);
    assert.ok(v[6] > v[8], "the right lamp is not amber: " + v);
  }
  assert.ok(levels[0] < levels[1] && levels[1] < levels[2], JSON.stringify(levels));
  const blinks = new Set();
  for (let i = 0; i < 12; i++) { g.rocks = [{ x: r.x + r.v * 0.2 + 20, r: 18, done: false, hit: false }]; g.t += 0.05; g.update(DT); blinks.add(ctx.calls.leds.at(-1)[6] > 100); }
  assert.ok(blinks.size === 2, "the right lamp does not blink in the last moment");
});
test("cancel, pause and dispose leave the lamps dark, and nothing is written while paused", () => {
  for (const how of ["cancel", "pause", "dispose"]) {
    const { ctx, g } = started({ seed: 28 });
    step(g, 2, runnerBot(g));
    g[how]();
    assert.ok(ctx.calls.leds.at(-1).every((x) => x === 0), how);
    if (how !== "cancel") { const n = ctx.calls.leds.length; step(g, 1); assert.equal(ctx.calls.leds.length, n, how + " wrote light"); }
  }
});
test("three quick taps followed by cancel() do not end the run", () => {
  const { g } = started({ seed: 29 });
  step(g, 1);
  g.forgiveTo = 0;
  for (let i = 0; i < 3; i++) { g.down(); step(g, 0.06); g.up(); step(g, 0.06); }
  g.cancel();
  step(g, 0.5);
  assert.equal(g.phase, "play");
});

// ---- orders, levels, unlocks -------------------------------------------------------------------
test("orders: level 1 is the fixed introduction; every level has three different orders it can meet", () => {
  assert.deepEqual(ordersFor(1).map((o) => o.k), ["flips", "dist", "shards"]);
  for (let L = 2; L <= 60; L++) {
    const list = ordersFor(L);
    assert.equal(list.length, 3, "level " + L);
    assert.equal(new Set(list.map((o) => o.k)).size, 3);
    for (const o of list) {
      assert.ok(ORDER_KINDS[o.k].min <= L, `level ${L} has ${o.k}`);
      assert.ok(Number.isFinite(o.n) && o.n > 0);
      assert.ok(orderText(o).length < 50, orderText(o));
    }
  }
  assert.deepEqual(ordersFor(7), ordersFor(7), "orders are the same every time");
});
test("meeting all three orders raises the level at the end of the run and unlocks what that level gives", () => {
  const { ctx, g } = started({ seed: 30, progress: { schema: 2, lv: 2, gd: [1, 1, 0] } });
  assert.equal(g.sv.lv, 2);
  g.sv.gd[2] = 1;
  step(g, 1);
  kill(g);
  assert.equal(g.sv.lv, 3);
  assert.deepEqual(g.sv.gd, [0, 0, 0]);
  assert.ok(g.levelled.unlocks.includes("SKIMMER SLED"));
  assert.ok(g.sv.sh >= 60, "no shard bonus");
  assert.equal(ctx.calls.saved.at(-1).lv, 3);
  assert.deepEqual(g.orders, ordersFor(3));
});
test("an order met in the middle of a run is marked at once and kept", () => {
  const { g } = started({ seed: 31 });
  const bot = runnerBot(g);
  step(g, 40, bot);
  assert.equal(g.sv.gd[1], 1, "400 m was not marked");
  assert.equal(g.sv.gd[2], 1, "10 shards was not marked");
});
test("the zone order counts only a run from the start", () => {
  const { g } = started({ seed: 32, progress: { schema: 2, far: 3, sel: { start: 3 } } });
  assert.equal(ORDER_KINDS.zone.prog(g), 0);
});

// ---- save --------------------------------------------------------------------------------------
test("save: the first release's run record migrates (runs, last, milestone kept; milestones become shards)", () => {
  const old = { schema: 1, runs: 14, last: { metres: 812, relics: 31, milestone: 8 }, milestone: 9 };
  const sv = migrateSave(old);
  assert.equal(sv.schema, 2);
  assert.equal(sv.runs, 14);
  assert.deepEqual(sv.last, old.last);
  assert.equal(sv.milestone, 9);
  assert.equal(sv.sh, 45);
  assert.equal(sv.lv, 1);
  assert.deepEqual(migrateSave(JSON.parse(JSON.stringify(sv))), sv, "schema 2 does not round-trip");
  // The game starts on an old save, and its first finished run keeps the history.
  const { ctx, g } = started({ seed: 33, progress: old });
  step(g, 1); kill(g);
  const saved = ctx.calls.saved.at(-1);
  assert.equal(saved.runs, 15);
  assert.equal(saved.milestone, 9);
  assert.equal(saved.schema, 2);
});
test("save: anything malformed becomes a clean schema 2", () => {
  for (const raw of [null, undefined, 7, "x", [], { lv: -4, sh: NaN, up: { mag: 99 }, sel: { ride: 9, start: -2 }, pb: "no", gd: "yes", st: { m: Infinity } }]) {
    const sv = migrateSave(raw);
    assert.equal(sv.schema, 2);
    assert.ok(sv.lv >= 1 && sv.up.mag <= 3 && sv.sel.ride < RIDES.length && sv.sel.start >= 0);
    assert.ok(numbers(sv).every(Number.isFinite));
  }
});

// ---- depot, workshop, rides --------------------------------------------------------------------
const press = (g, seconds) => { g.down(); step(g, seconds); g.up(); };
test("depot: a hold on the title opens it, a tap moves to the next line, a hold chooses", () => {
  const ctx = appContext({ seed: 34, progress: { schema: 2, lv: 6, sh: 500 } }), g = new Moonrunner(ctx);
  press(g, 0.6);
  assert.equal(g.phase, "depot");
  press(g, 0.1);
  assert.equal(g.cur, 1);
  press(g, 0.6); // RIDE: next unlocked sled
  assert.equal(g.sv.sel.ride, 1);
  press(g, 0.6);
  assert.equal(g.sv.sel.ride, 2);
  press(g, 0.6);
  assert.equal(g.sv.sel.ride, 0);
  const locked = new Moonrunner(appContext({ seed: 35 }));
  press(locked, 0.6); press(locked, 0.1); press(locked, 0.6);
  assert.equal(locked.sv.sel.ride, 0, "a locked sled was chosen");
  // Workshop: buy a magnet tier; a second purchase without shards is refused.
  while (DEPOT_ROW(g) !== "WORKSHOP") press(g, 0.1);
  press(g, 0.6);
  assert.equal(g.view, "workshop");
  press(g, 0.6);
  assert.equal(g.sv.up.mag, 1);
  assert.equal(g.sv.sh, 500 - WORKSHOP[0].tiers[0]);
  g.sv.sh = 10;
  press(g, 0.6);
  assert.equal(g.sv.up.mag, 1, "bought without shards");
  for (let i = 0; i < WORKSHOP.length; i++) press(g, 0.1);
  press(g, 0.6);
  assert.equal(g.view, "menu");
  g.cur = 0; press(g, 0.6);
  assert.equal(g.phase, "play");
  assert.equal(g.rideIx, 0);
});
const DEPOT_ROW = (g) => ["RIDE OUT", "RIDE", "START", "ZEN", "DAILY", "WORKSHOP", "ORDERS", "LOG"][g.cur];
test("the HAULER breaks small boulders; a magnet pulls shards from further away", () => {
  const { g } = started({ seed: 36, progress: { schema: 2, lv: 6, sel: { ride: 2 } } });
  step(g, 1);
  g.forgiveTo = 0;
  g.rocks.push({ x: g.r.x + 4, r: 16, done: false, hit: false }); g.update(DT);
  assert.equal(g.phase, "play", "the hauler did not break a small boulder");
  const m = started({ seed: 37, progress: { schema: 2, up: { mag: 2 } } }).g;
  step(m, 1);
  m.shards = [{ x: m.r.x + 60, off: 0, y: m.r.y - 18 - 60, got: 0, pull: 0 }];
  step(m, 0.3);
  assert.equal(m.R.shards, 1);
});
test("only a run from the start sets the console record; other starts keep a best per sled", () => {
  const { ctx, g } = started({ seed: 38, progress: { schema: 2, far: 3, sel: { start: 2 } } });
  step(g, 3, runnerBot(g));
  kill(g);
  assert.equal(ctx.calls.score.length, 0);
  assert.ok(g.sv.pb[0] > 0);
});
test("zen: no score, no end; a crash is a tumble and the ride goes on", () => {
  const ctx = appContext({ seed: 39, progress: { schema: 2, lv: 2 } }), g = new Moonrunner(ctx);
  g.start("zen");
  step(g, 1);
  for (let i = 0; i < 3; i++) { kill(g); step(g, 2); }
  assert.equal(g.phase, "play");
  g.pause(); g.dispose();
  assert.equal(ctx.calls.score.length, 0);
  assert.ok(g.sv.st.zen > 0, "zen metres were not banked");
});
test("daily run: the same slope for everyone on a date, a different one the next day, and a streak", () => {
  const make = (key) => { const g = new Moonrunner(appContext({ seed: Math.random() * 1e9 })); g.dayKey = () => key; g.start("daily"); g.r.x += 3000; g.extend(); return g; };
  const a = make("2026-10-01"), b = make("2026-10-01"), c = make("2026-10-02");
  assert.deepEqual(a.ty, b.ty);
  assert.notDeepEqual(a.ty, c.ty);
  assert.ok(dailyGoal("2026-10-01").text.length > 5);
  const g = new Moonrunner(appContext({ seed: 40, progress: { schema: 2, dl: { last: "2026-09-30", streak: 2 } } }));
  g.dayKey = () => "2026-10-01";
  g.start("daily");
  g.goalDone = true;
  step(g, 1); kill(g);
  assert.equal(g.sv.dl.streak, 3);
  assert.equal(g.sv.dl.done, 1);
});
test("leaving in the middle of a run banks it: the score, the stats and the shards are kept", () => {
  const { ctx, g } = started({ seed: 41 });
  step(g, 20, runnerBot(g));
  const shards = g.R.shards;
  g.cancel(); g.pause(); g.dispose();
  assert.ok(ctx.calls.score.length >= 1);
  assert.equal(ctx.calls.saved.at(-1).runs, 1);
  assert.equal(ctx.calls.saved.at(-1).sh, shards);
});

// ---- drawing ------------------------------------------------------------------------------------
test("every screen draws without throwing, with text of 16 px or more, and drawing changes nothing", () => {
  const sizes = [];
  const g2d = new Proxy({}, { get: (t, k) => (k === "fillText" ? () => sizes.push(Number(/(\d+)px/.exec(t.font)?.[1])) : k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  const ctx = appContext({ seed: 42, progress: { schema: 2, lv: 9, far: 5, sh: 999 } }), g = new Moonrunner(ctx);
  const views = [];
  g.draw(g2d); views.push("title");
  press(g, 0.6);
  for (const v of ["menu", "workshop", "orders", "log"]) { g.view = v; g.draw(g2d); views.push(v); }
  g.view = "menu"; g.cur = 0; press(g, 0.6);
  const bot = runnerBot(g);
  for (let i = 0; i < 60 * 30; i++) {
    bot(); g.update(DT);
    if (i % 20 === 0) {
      const before = JSON.stringify(plainState(g));
      g.draw(g2d);
      assert.equal(JSON.stringify(plainState(g)), before, "draw changed the game");
    }
  }
  g.sv.sel.start = 5; g.start(); step(g, 3, runnerBot(g)); g.draw(fakeCanvas()); // the far side
  kill(g); step(g, 1); g.draw(g2d);
  assert.ok(sizes.length > 100);
  assert.ok(Math.min(...sizes) >= 16, "smallest text " + Math.min(...sizes));
});
