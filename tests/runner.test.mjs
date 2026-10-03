// MOONRUNNER, the hill-flyer: physics, perfect slides, fever, daylight, obstacles, zones, orders,
// save migration, depot, lamps, and seeded bots (tests/helpers/runner-bot.mjs) that play through
// the real down()/up()/update().
import test from "node:test";
import assert from "node:assert/strict";
import { Moonrunner, GRIP, ZONE_T, migrateSave, ordersFor, orderText, ORDER_KINDS, ZONES, RIDES, WORKSHOP, dailyGoal, zoneAt, beaconsOf, PX_M, PERFECT, THUD, RILLE_V, MIN_V } from "../web/apps/runner.js";
import { appContext, fakeCanvas } from "./helpers/app-context.mjs";
import { runnerBot } from "./helpers/runner-bot.mjs";

const DT = 1 / 60;
const step = (g, seconds, each) => { for (let i = 0, n = Math.round(seconds * 60); i < n; i++) { each?.(); g.update(DT); } };
function started(options = {}) {
  const ctx = appContext(options), g = new Moonrunner(ctx);
  g.down(); g.up(); // the title screen starts a run on release
  return { ctx, g };
}
// Night has fallen and the sled has all but stopped: the run ends.
function kill(g) { g.T = 0; g.night = true; Object.assign(g.r, { air: false, v: 20, y: g.gy(g.r.x) }); g.update(DT); }
function play(seed, opts = {}, seconds = 400) {
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
// The middle of the first downslope (or climb) well ahead of the sled.
function slopeAhead(g, fromValley) {
  const i = g.kp.findIndex((p, k) => !!p.valley === fromValley && k + 1 < g.kp.length && p.x > g.r.x + 200);
  return (g.kp[i].x + g.kp[i + 1].x) / 2;
}
const onDownslope = (g) => slopeAhead(g, false), onUpslope = (g) => slopeAhead(g, true);
const clearAll = (g) => { g.chasms = []; g.pits = []; g.pads = []; g.vents = []; };
const finite = (g) => numbers(plainState(g)).filter((n) => n !== Infinity).every(Number.isFinite);
// Bring the sled down onto the hill at x, `diff` radians shallower than the slope there (it starts
// a hair below the ground, so it lands on the next step whatever the angle).
function landAt(g, x, diff, v = 600) {
  const a = g.slopeAt(x) - diff;
  Object.assign(g.r, { x, y: g.gy(x) + 3, air: true, airT: 0.6, vx: v * Math.cos(a), vy: v * Math.sin(a), tx: x - 200, hi: 40 });
  for (let i = 0; i < 5 && g.r.air; i++) g.update(DT);
}

// ---- bots ------------------------------------------------------------------------------------
test("a good player rides far and outscores a rider who never presses, on several seeds", () => {
  for (const seed of [1, 2, 3]) {
    const idle = play(seed, { idle: true }), good = play(seed);
    assert.equal(idle.g.phase, "over", "the idle rider never stopped");
    assert.equal(idle.g.reason, "night");
    assert.ok(idle.g.R.zone <= 1, "the idle rider got past the dunes");
    assert.ok(good.t > 120, `seed ${seed}: the bot's run ended after ${good.t.toFixed(0)} s`);
    assert.ok(good.g.scoreNow() > 6 * idle.g.scoreNow(), `seed ${seed}: ${good.g.scoreNow()} vs idle ${idle.g.scoreNow()}`);
    assert.ok(good.g.R.perfects >= 10 && good.g.R.zone >= 3 && good.g.R.fevers >= 1, JSON.stringify(good.g.R));
  }
});
test("skill shows: timing the dive beats playing by eye, which beats a sloppy player, which beats not pressing", () => {
  const total = (opts) => [4, 5, 6].reduce((n, seed) => n + play(seed, opts).g.scoreNow(), 0);
  const plan = total({}), eye = total({ plan: false }), idle = total({ idle: true }), sloppy = total({ lag: 0.15 });
  assert.ok(plan > eye * 1.5, `planned ${plan} vs eye ${eye}`);
  assert.ok(eye > idle * 3, `eye ${eye} vs idle ${idle}`);
  assert.ok(sloppy < plan * 0.75, `sloppy ${sloppy} vs planned ${plan}`);
});
test("a long run has no NaN anywhere and every list stays bounded", () => {
  const { ctx, g } = started({ seed: 9 });
  const bot = runnerBot(g);
  const worst = { kp: 0, shards: 0, chasms: 0, pits: 0, pads: 0, vents: 0 };
  for (let i = 0; i < 60 * 240 && g.phase === "play"; i++) {
    bot(); g.update(DT);
    for (const k of Object.keys(worst)) worst[k] = Math.max(worst[k], g[k].length);
    if (i % 600 === 0) assert.ok(finite(g), "a number is not finite at frame " + i);
  }
  assert.ok(worst.kp <= 48 && worst.shards <= 64 && worst.chasms <= 8 && worst.pits <= 8 && worst.pads <= 8 && worst.vents <= 8, JSON.stringify(worst));
  assert.ok(finite(g));
  assert.ok(JSON.stringify(ctx.calls.saved.at(-1) || g.sv).length < 4096, "the save is small");
});

// ---- physics -----------------------------------------------------------------------------------
test("holding dives: on a downslope it gains speed much faster, on a climb it loses speed faster", () => {
  const ride = (hold, where) => {
    const { g } = started({ seed: 10 });
    clearAll(g);
    const x = where(g);
    Object.assign(g.r, { x, y: g.gy(x), v: 400, air: false });
    if (hold) g.down();
    step(g, 0.25);
    return g.r.v;
  };
  const downHeld = ride(true, onDownslope), down = ride(false, onDownslope);
  assert.ok(downHeld - 400 > 1.8 * (down - 400), `held ${downHeld.toFixed(0)}, light ${down.toFixed(0)}`);
  const upHeld = ride(true, onUpslope), up = ride(false, onUpslope);
  assert.ok(upHeld < up - 20, `held ${upHeld.toFixed(0)}, light ${up.toFixed(0)}`);
});
test("a fast sled flies off a crest; a slow one rolls over it", () => {
  const over = (v) => {
    const { g } = started({ seed: 11 });
    clearAll(g);
    const crest = g.kp.find((p) => !p.valley && p.x > g.r.x + 300);
    const x = crest.x - 60;
    Object.assign(g.r, { x, y: g.gy(x), v, air: false });
    let flew = false;
    for (let i = 0; i < 40; i++) { g.update(DT); if (g.r.air && g.gy(g.r.x) - g.r.y > 6) flew = true; }
    return flew;
  };
  assert.ok(over(900), "a fast sled stayed on the ground");
  assert.ok(over(600), "a sled at about 110 km/h stayed on the ground: getting air should be easy");
  assert.ok(!over(MIN_V), "a crawling sled took off");
});
test("a perfect slide: speed, points, daylight and the chain; a thud breaks the chain", () => {
  const { g } = started({ seed: 12 });
  clearAll(g);
  const x = onDownslope(g);
  const pts = g.pts, T = g.T;
  landAt(g, x, 0.1);
  assert.equal(g.R.perfects, 1);
  assert.equal(g.chain, 1);
  assert.ok(g.r.v > 600 * 1.05, "no burst of speed: " + g.r.v);
  assert.ok(g.pts >= pts + 50);
  assert.ok(g.T > T - 0.2, "no daylight");
  landAt(g, x, -PERFECT + 0.05); // steeper than the slope, but inside the window
  assert.equal(g.chain, 2);
  landAt(g, x, -(THUD + 0.2)); // nose first into the hillside
  assert.equal(g.chain, 0);
  assert.equal(g.R.perfects, 2);
  assert.equal(g.R.chain, 2);
  assert.equal(g.phase, "play", "a thud ended the run");
});
test("a dive above a downslope bends the sled onto it; any landing keeps most of the speed", () => {
  const land = (hold) => {
    const { g } = started({ seed: 18 });
    clearAll(g);
    const x = onDownslope(g) - 120, th = g.slopeAt(x + 60);
    const flat = th - 0.6; // flying much flatter than the slope, a little above it
    Object.assign(g.r, { x, y: g.gy(x) - 60, air: true, airT: 0.6, vx: 600 * Math.cos(flat), vy: 600 * Math.sin(flat), tx: x - 200, hi: 60 });
    if (hold) g.down();
    let landed = null;
    const on = g.onLand.bind(g);
    g.onLand = (ev) => { landed = ev; on(ev); };
    for (let i = 0; i < 90 && !landed; i++) g.update(DT);
    return landed;
  };
  const held = land(true), light = land(false);
  assert.ok(held && held.diff <= PERFECT && held.th > 0.08, "the dive did not land as a perfect slide: " + JSON.stringify(held));
  assert.ok(light && light.dist > held.dist, "floating did not carry further than the dive");
  const b = started({ seed: 18 }).g;
  clearAll(b);
  const u = onUpslope(b);
  Object.assign(b.r, { x: u, y: b.gy(u) + 3, air: true, airT: 0.6, vx: 500, vy: 500, tx: u - 200 });
  b.update(DT);
  // A thud (here a dive straight into a climb) costs speed: it keeps about half of it.
  assert.ok(!b.r.air && Math.abs(b.r.v - 0.55 * Math.hypot(500, 500)) < 5, "a thud on a climb kept the wrong speed: " + b.r.v);
  // Any other landing keeps at least 70 percent.
  const c = started({ seed: 18 }).g;
  clearAll(c);
  const d = onUpslope(c);
  Object.assign(c.r, { x: d, y: c.gy(d) + 3, air: true, airT: 0.6, vx: 700, vy: 0, tx: d - 200 }); // level onto a climb: no slide, no thud
  c.update(DT);
  assert.equal(c.R.perfects, 0);
  assert.ok(!c.r.air && c.r.v >= 0.69 * 700, "a flat landing lost too much speed: " + c.r.v);
});
test("a dive a little too steep still lands as a perfect slide; a held or downhill sled does not skip off the ground", () => {
  const { g } = started({ seed: 19 });
  clearAll(g);
  const x = onDownslope(g);
  landAt(g, x, -(PERFECT + 0.08)); // 0.08 rad steeper than the window
  assert.equal(g.R.perfects, 1, "a near miss on the steep side was not perfect");
  landAt(g, x, PERFECT + 0.08); // as much too flat is not
  assert.equal(g.R.perfects, 1);
  // Held at speed over a crest and down the slope: no hops.
  const h = started({ seed: 19 }).g;
  clearAll(h);
  const crest = h.kp.find((p) => !p.valley && p.x > h.r.x + 600);
  const x0 = crest.x - 200;
  Object.assign(h.r, { x: x0, y: h.gy(x0), air: false, v: 1100, a: h.slopeAt(x0) });
  h.down();
  let launches = 0;
  const adv = h.advance.bind(h);
  h.advance = (r, dt, dive, probe) => { const ev = adv(r, dt, dive, probe); if (!probe && ev?.type === "launch") launches++; return ev; };
  for (let i = 0; i < 40; i++) h.update(DT);
  assert.equal(launches, 0, "a held sled skipped off the crest");
});
test("a skip over a bump is not a landing: it neither scores nor breaks the chain", () => {
  const { g } = started({ seed: 13 });
  clearAll(g);
  g.chain = 2;
  const x = onDownslope(g), th = g.slopeAt(x);
  Object.assign(g.r, { x, y: g.gy(x) - 1, air: true, airT: 0.05, vx: 600 * Math.cos(th), vy: 600 * Math.sin(th), tx: x - 10 });
  g.update(DT);
  assert.equal(g.chain, 2);
  assert.equal(g.R.perfects, 0);
});
test("three perfect slides in a row are fever: double points, for a while; the coil keeps one missed chain", () => {
  const { g } = started({ seed: 14, progress: { schema: 3, up: { coil: 1 } } });
  clearAll(g);
  const x = onDownslope(g);
  for (let k = 0; k < 3; k++) landAt(g, x, 0.05);
  assert.equal(g.R.fevers, 1);
  assert.ok(g.fever > 4.5 && g.fever <= 5, "fever is not five seconds: " + g.fever);
  landAt(g, x, -0.7); // a miss: the coil holds the chain once
  assert.equal(g.chain, 3);
  landAt(g, x, -0.7);
  assert.equal(g.chain, 0, "the coil held twice in one fever");
  const pts = g.pts;
  g.addPoints(10);
  assert.equal(g.pts - pts, 20);
  step(g, 8);
  assert.equal(g.fever, 0, "fever did not run out");
});
test("fever rises a level for every three more perfect slides: x3 points and a higher top speed", () => {
  const { g } = started({ seed: 44 });
  clearAll(g);
  const x = onDownslope(g);
  for (let k = 0; k < 3; k++) landAt(g, x, 0.05);
  assert.equal(g.feverLv, 1);
  const top = g.topSpeed();
  for (let k = 0; k < 3; k++) landAt(g, x, 0.05);
  assert.equal(g.feverLv, 2);
  assert.equal(g.R.feverLv, 3);
  assert.ok(g.topSpeed() > top);
  const pts = g.pts;
  g.addPoints(10);
  assert.equal(g.pts - pts, 30);
  step(g, 12);
  assert.equal(g.feverLv, 0, "the level outlived the fever");
});
test("a sunstone buys daylight; a survey beacon is found once for good, and a full zone pays a bonus but no daylight", () => {
  const { ctx, g } = started({ seed: 45 });
  clearAll(g);
  step(g, 0.2);
  const T = g.T, r = g.r;
  g.suns = [{ x: r.x + 4, y: r.y - 18, got: 0 }];
  g.update(DT);
  assert.equal(g.R.suns, 1);
  assert.ok(g.T > T + 3.5, "no daylight from the sunstone");
  // Three beacons of the mare.
  const sh = g.sv.sh;
  for (let k = 0; k < 3; k++) {
    g.beacons = [{ zi: 0, k, x: g.r.x + 4, found: 0, got: 0 }];
    Object.assign(g.r, { air: true, y: g.beaconY(g.beacons[0]) + 18, vy: 0, vx: 500 });
    g.update(DT);
  }
  assert.equal(g.sv.bc[0], 7);
  assert.equal(g.R.beacons, 3);
  assert.equal(g.sv.sh, sh + 150);
  kill(g);
  step(g, 3); // past the gesture window, so the save goes out
  assert.deepEqual(ctx.calls.saved.at(-1).bc.slice(0, 2), [7, 0]);
  // The next run starts with the usual daylight, and the mare's beacons are already found.
  g.down(); g.up();
  assert.equal(g.phase, "play");
  assert.equal(g.T, 35);
  assert.ok(g.beacons.filter((b) => b.zi === 0).every((b) => b.found));
  assert.deepEqual(beaconsOf(0), [80, 200, 320]);
});
test("daylight runs down; a new zone buys more; at night the sled coasts to a stop and the run ends", () => {
  const { ctx, g } = started({ seed: 15, progress: { schema: 3, up: { bat: 1 } } });
  assert.equal(g.T, 35, "workshop gear added daylight");
  step(g, 1);
  assert.ok(g.T < 34.1);
  const T = g.T;
  g.enterZone(1);
  assert.ok(g.T > T + ZONE_T[1] - 1);
  g.T = 0.01;
  step(g, 0.1);
  assert.ok(g.night);
  assert.equal(g.phase, "play", "the run ended before the sled stopped");
  for (let i = 0; i < 60 * 30 && g.phase === "play"; i++) g.update(DT);
  assert.equal(g.phase, "over");
  assert.equal(g.reason, "night");
  step(g, 3);
  assert.equal(ctx.calls.score.length, 1, "the score was not recorded exactly once");
  assert.equal(ctx.calls.saved.filter((s) => s.runs === 1).length, 1);
  assert.equal(ctx.calls.saved.at(-1).schema, 3);
});
test("a rille is flown by a sled fast enough at its rim; a slow one falls in and loses daylight", () => {
  const at = (v, bat = 0) => {
    const { g } = started({ seed: 16, progress: { schema: 3, up: { bat } } });
    clearAll(g);
    const crest = g.kp.find((p) => !p.valley && p.x > g.r.x + 300);
    const c = { x0: crest.x + 30, x1: crest.x + 230, done: false }; // the widest a rille is made
    g.chasms = [c];
    const x = crest.x + 20;
    Object.assign(g.r, { x, y: g.gy(x), v, air: false });
    const T = g.T;
    for (let i = 0; i < 90; i++) g.update(DT);
    return { g, c, lost: T - g.T };
  };
  const fast = at(RILLE_V);
  assert.equal(fast.g.R.chasms, 1, "a sled at RILLE_V did not clear the widest rille");
  assert.equal(fast.g.R.falls, 0);
  const slow = at(250);
  assert.equal(slow.g.R.falls, 1, "a slow sled cleared it");
  assert.ok(slow.lost > 8, "no daylight lost: " + slow.lost);
  assert.equal(slow.g.phase, "play");
  assert.ok(slow.g.r.x > slow.c.x1, "not set down past the rille");
  const grappled = at(250, 2);
  assert.ok(Math.abs(slow.lost - grappled.lost - 6) < 0.1, "the grapple did not take 6 s off the fall: " + (slow.lost - grappled.lost));
});
test("dust pits drag, a boost crystal throws the sled forward while held, a vent throws it high", () => {
  const roll = (fn, hold) => {
    const { g } = started({ seed: 17 });
    clearAll(g);
    const x = onDownslope(g);
    Object.assign(g.r, { x, y: g.gy(x), v: 500, air: false });
    fn(g, x);
    if (hold) g.down();
    let top = 0;
    for (let i = 0; i < 20; i++) { g.update(DT); top = Math.max(top, g.gy(g.r.x) - g.r.y); }
    return { v: g.r.v, top, g };
  };
  const plain = roll(() => {}, true);
  const pit = roll((g, x) => g.pits.push({ x0: x - 10, x1: x + 600 }), true);
  assert.ok(pit.v < plain.v - 100, `pit ${pit.v.toFixed(0)} vs ${plain.v.toFixed(0)}`);
  const pad = roll((g, x) => g.pads.push({ x0: x - 10, x1: x + 600, used: false }), true);
  assert.ok(pad.v > plain.v + 150, `crystal ${pad.v.toFixed(0)} vs ${plain.v.toFixed(0)}`);
  assert.equal(pad.g.R.pads, 1);
  const light = roll((g, x) => g.pads.push({ x0: x - 10, x1: x + 600, used: false }), false);
  assert.equal(light.g.R.pads, 0, "a crystal fired without a hold");
  const vent = roll((g, x) => g.vents.push({ x: x + 40, w: 60, used: false }), false);
  assert.ok(vent.top > 120 && vent.g.R.vents === 1, "vent height " + vent.top);
});

// ---- the hills ---------------------------------------------------------------------------------
test("the hills are smooth and continuous, and the camera follows the sled and pulls back with speed", () => {
  const { g } = started({ seed: 19 });
  const bot = runnerBot(g);
  let worst = 0, steep = 0, zoomFast = 1, zoomSlow = 0;
  for (let i = 0; i < 60 * 90 && g.phase === "play"; i++) {
    bot(); g.update(DT);
    if (g.phase !== "play") break;
    assert.equal(g.camX, g.r.x);
    assert.ok(g.zoom >= 0.42 && g.zoom <= 1.05);
    for (let k = 0; k < 4; k++) {
      const x0 = g.r.x + k * 300;
      worst = Math.max(worst, Math.abs(g.gy(x0 + 1) - g.gy(x0)));
      steep = Math.max(steep, Math.abs(g.slopeAt(x0)));
    }
    const s = Math.hypot(g.r.vx, g.r.vy);
    if (s > 1000) zoomFast = Math.min(zoomFast, g.zoom);
    if (s < 400) zoomSlow = Math.max(zoomSlow, g.zoom);
  }
  // The steepest hill is about 55 degrees (H <= 0.9 L), so 1 px across is at most ~1.43 px down.
  assert.ok(steep < 0.97, "a slope is too steep: " + steep);
  assert.ok(worst < Math.tan(0.97) + 0.05, "the ground jumps by " + worst + " px in 1 px");
  assert.ok(zoomFast < zoomSlow - 0.1, `zoom fast ${zoomFast}, slow ${zoomSlow}`);
});
test("hills come in sets of matching hills, each set sized to the sled's speed, for a steady beat", () => {
  const make = (v) => {
    const g = new Moonrunner(appContext({ seed: 43 }));
    g.start(); g.vRef = v; g.set = null; g.kp.length = 2;
    g.r.x = g.kp[1].x + 2000; g.extend(); // fill well past the start
    return g.kp.slice(2).map((p, i, a) => (i ? p.x - a[i - 1].x : 0)).slice(1);
  };
  const slow = make(500), fast = make(1100);
  // Within the first set (at least three hills = six half-waves) the lengths stay within 15%.
  const first = slow.slice(0, 6);
  assert.ok(Math.max(...first) / Math.min(...first) < 1.15, "the first set is uneven: " + first.map(Math.round));
  const mean = (a) => a.slice(0, 6).reduce((x, y) => x + y, 0) / 6;
  assert.ok(mean(fast) > mean(slow) * 1.5, `hills for a fast sled (${mean(fast) | 0}) are not longer than for a slow one (${mean(slow) | 0})`);
});
test("each zone adds its own thing: pits from II, rilles from III, crystals from IV, vents from V", () => {
  const seen = ZONES.map(() => new Set());
  for (let zi = 0; zi < ZONES.length; zi++) {
    const g = new Moonrunner(appContext({ seed: 20 + zi }));
    g.sv.far = 5; g.sv.sel.start = zi;
    g.start();
    const note = (x, kind) => { if (x > g.x0 + 3200) seen[zoneAt(x / PX_M)].add(kind); };
    for (let k = 0; k < 120; k++) {
      g.r.x += 300; g.extend();
      for (const q of g.pits) note(q.x0, "pit");
      for (const c of g.chasms) note(c.x0, "chasm");
      for (const p of g.pads) note(p.x0, "pad");
      for (const v of g.vents) note(v.x, "vent");
      g.prune();
    }
  }
  assert.deepEqual([...seen[0]], [], "the mare has obstacles");
  assert.ok(seen[1].has("pit") && !seen[1].has("chasm") && !seen[1].has("pad"), [...seen[1]].join());
  assert.ok(seen[2].has("chasm") && !seen[2].has("pad") && !seen[2].has("vent"), [...seen[2]].join());
  assert.ok(seen[3].has("pad") && !seen[3].has("vent"), [...seen[3]].join());
  assert.ok(seen[4].has("vent"), [...seen[4]].join());
  assert.ok(["pit", "chasm", "pad", "vent"].every((k) => seen[5].has(k)), [...seen[5]].join());
});
test("the first 150 m of every run have no rilles or dust pits, and every rille sits on a downslope", () => {
  for (const seed of [21, 22, 23]) {
    const { g } = started({ seed, progress: { schema: 3, far: 5, sel: { start: 4 } } });
    assert.ok(!g.chasms.some((c) => c.x0 < g.x0 + 3000) && !g.pits.some((p) => p.x0 < g.x0 + 3000));
    for (let k = 0; k < 40; k++) {
      g.r.x += 300; g.extend(); g.prune();
      for (const c of g.chasms) assert.ok(g.slopeAt(c.x0) >= 0 && c.x1 - c.x0 <= 200, JSON.stringify(c));
    }
  }
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
  assert.ok(ctx.calls.leds.at(-1).some((x) => x > 0), "no light at the end");
  step(g, 1);
  assert.ok(ctx.calls.leds.at(-1).every((x) => x === 0), "lamps lit on the result screen");
});
test("lamps in the air: the middle lamp is green when a landing now would be perfect, amber when not", () => {
  const { ctx, g } = started({ seed: 26 });
  clearAll(g);
  step(g, 3); // past the zone banner
  const x = onDownslope(g), th = g.slopeAt(x + 60);
  Object.assign(g.r, { x, y: g.gy(x) - 40, air: true, vx: 600 * Math.cos(th), vy: 600 * Math.sin(th) });
  g.update(DT);
  let v = ctx.calls.leds.at(-1);
  assert.ok(v[4] > v[3] && v[4] > 0, "not green: " + v);
  Object.assign(g.r, { x, y: g.gy(x) - 40, air: true, vx: 600, vy: -400 });
  g.update(DT);
  v = ctx.calls.leds.at(-1);
  assert.ok(v[3] > v[5] && v[3] > 0, "not amber: " + v);
});
test("lamps: the right lamp shows daylight, and blinks red for a rille ahead of a slow sled", () => {
  const { ctx, g } = started({ seed: 27 });
  clearAll(g);
  step(g, 3);
  let v = ctx.calls.leds.at(-1);
  assert.ok(v[8] > v[6], "plenty of daylight is not cyan: " + v);
  g.T = 12; step(g, 0.05);
  v = ctx.calls.leds.at(-1);
  assert.ok(v[6] > v[8], "low daylight is not amber: " + v);
  g.T = 30;
  const blinks = new Set();
  for (let i = 0; i < 20; i++) {
    g.chasms = [{ x0: g.r.x + 300, x1: g.r.x + 440, done: false }];
    Object.assign(g.r, { air: false, v: 200, y: g.gy(g.r.x) });
    g.t += 0.05; g.update(DT);
    v = ctx.calls.leds.at(-1);
    blinks.add(v[6] > 100 && v[7] < 60);
  }
  assert.equal(blinks.size, 2, "the right lamp does not blink red");
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
test("the menu gesture takes back its presses: three quick taps and cancel() leave the run going", () => {
  const { g } = started({ seed: 29 });
  step(g, 1);
  for (let i = 0; i < 3; i++) { g.down(); step(g, 0.06); g.up(); step(g, 0.06); }
  g.cancel();
  assert.equal(g.held, false);
  step(g, 0.5);
  assert.equal(g.phase, "play");
});

// ---- orders, levels, unlocks -------------------------------------------------------------------
test("orders: level 1 is the fixed introduction; every level has three different orders it can meet", () => {
  assert.deepEqual(ordersFor(1).map((o) => o.k), ["perfects", "dist", "shards"]);
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
  const { ctx, g } = started({ seed: 30, progress: { schema: 3, lv: 2, gd: [1, 1, 0] } });
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
  step(g, 50, bot);
  assert.equal(g.sv.gd[0], 1, "3 perfect slides were not marked");
  assert.equal(g.sv.gd[1], 1, "400 m was not marked");
  assert.equal(g.sv.gd[2], 1, "10 shards was not marked");
});
test("the zone order counts only a run from the start", () => {
  const { g } = started({ seed: 32, progress: { schema: 3, far: 3, sel: { start: 3 } } });
  assert.equal(ORDER_KINDS.zone.prog(g), 0);
});

// ---- save --------------------------------------------------------------------------------------
test("save: the first release's run record migrates (runs, last, milestone kept; milestones become shards)", () => {
  const old = { schema: 1, runs: 14, last: { metres: 812, relics: 31, milestone: 8 }, milestone: 9 };
  const sv = migrateSave(old);
  assert.equal(sv.schema, 3);
  assert.equal(sv.runs, 14);
  assert.deepEqual(sv.last, old.last);
  assert.equal(sv.milestone, 9);
  assert.equal(sv.sh, 45);
  assert.equal(sv.lv, 1);
  assert.deepEqual(migrateSave(JSON.parse(JSON.stringify(sv))), sv, "schema 3 does not round-trip");
  const { ctx, g } = started({ seed: 33, progress: old });
  step(g, 1); kill(g);
  const saved = ctx.calls.saved.at(-1);
  assert.equal(saved.runs, 15);
  assert.equal(saved.milestone, 9);
  assert.equal(saved.schema, 3);
});
test("save: the downhill test build (schema 2) keeps level, shards, sleds and records, and refunds its upgrades", () => {
  const old = { schema: 2, runs: 30, lv: 5, gd: [1, 0, 1], sh: 100, up: { mag: 2, hov: 2, lamp: 1 }, sel: { ride: 1, start: 2, trail: 1 }, far: 3, pb: [5000, 4000, 0], st: { m: 20000, best: 6000 } };
  const sv = migrateSave(old);
  assert.equal(sv.schema, 3);
  assert.equal(sv.lv, 5);
  assert.deepEqual(sv.gd, [0, 0, 0], "the old orders carried over");
  assert.equal(sv.sh, 100 + 150 + 450 + 120);
  assert.deepEqual(sv.up, { mag: 2, bat: 0, coil: 0 });
  assert.deepEqual(sv.sel, { ride: 1, start: 2, trail: 1 });
  assert.equal(sv.far, 3);
  assert.deepEqual(sv.pb, [5000, 4000, 0]);
  assert.equal(sv.st.m, 20000);
  assert.deepEqual(migrateSave(JSON.parse(JSON.stringify(sv))), sv, "schema 3 does not round-trip");
});
test("save: a schema 3 save from before the beacons gets none found, and a run from the start records its distance", () => {
  const old = { schema: 3, lv: 4, sh: 50, st: { m: 900 } };
  const sv = migrateSave(old);
  assert.deepEqual(sv.bc, [0, 0, 0, 0, 0, 0]);
  assert.equal(sv.st.bm, 0);
  assert.equal(sv.st.suns, 0);
  const { g } = started({ seed: 46, progress: old });
  step(g, 20, runnerBot(g));
  kill(g);
  assert.ok(g.sv.st.bm > 100 && g.sv.st.bm === Math.floor(g.R.m));
});
test("save: anything malformed becomes a clean schema 3", () => {
  for (const raw of [null, undefined, 7, "x", [], { lv: -4, sh: NaN, up: { mag: 99, bat: -1 }, sel: { ride: 9, start: -2 }, pb: "no", gd: "yes", st: { m: Infinity } }]) {
    const sv = migrateSave(raw);
    assert.equal(sv.schema, 3);
    assert.ok(sv.lv >= 1 && sv.up.mag <= 3 && sv.up.bat >= 0 && sv.sel.ride < RIDES.length && sv.sel.start >= 0);
    assert.ok(numbers(sv).every(Number.isFinite));
  }
});

// ---- depot, workshop, sleds --------------------------------------------------------------------
const press = (g, seconds) => { g.down(); step(g, seconds); g.up(); };
const DEPOT_ROW = (g) => ["RIDE OUT", "SLED", "START", "ZEN", "DAILY", "WORKSHOP", "ORDERS", "LOG"][g.cur];
test("depot: a hold on the title opens it, a tap moves to the next line, a hold chooses", () => {
  const ctx = appContext({ seed: 34, progress: { schema: 3, lv: 6, sh: 500 } }), g = new Moonrunner(ctx);
  press(g, 0.6);
  assert.equal(g.phase, "depot");
  press(g, 0.1);
  assert.equal(g.cur, 1);
  press(g, 0.6);
  assert.equal(g.sv.sel.ride, 1);
  press(g, 0.6);
  assert.equal(g.sv.sel.ride, 2);
  press(g, 0.6);
  assert.equal(g.sv.sel.ride, 0);
  const locked = new Moonrunner(appContext({ seed: 35 }));
  press(locked, 0.6); press(locked, 0.1); press(locked, 0.6);
  assert.equal(locked.sv.sel.ride, 0, "a locked sled was chosen");
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
test("the sleds differ: the SKIMMER floats longer, the HAULER drops sooner; a magnet reaches further", () => {
  const flight = (ride) => {
    const { g } = started({ seed: 36, progress: { schema: 3, lv: 9, sel: { ride } } });
    clearAll(g);
    const x = onDownslope(g);
    Object.assign(g.r, { x, y: g.gy(x) - 200, air: true, vx: 500, vy: -200 });
    let t = 0;
    while (g.r.air && t < 5) { g.update(DT); t += DT; }
    return t;
  };
  const sk = flight(1), su = flight(0), ha = flight(2);
  assert.ok(sk > su && su > ha, `skimmer ${sk}, surveyor ${su}, hauler ${ha}`);
  assert.ok(RIDES[2].dive > RIDES[0].dive && RIDES[2].maxV > RIDES[0].maxV);
  const m = started({ seed: 37, progress: { schema: 3, up: { mag: 2 } } }).g;
  step(m, 1);
  m.shards = [{ x: m.r.x + 60, y: m.r.y - 18 - 60, got: 0, pull: 0 }];
  step(m, 0.3);
  assert.equal(m.R.shards, 1);
});
test("only a run from the start sets the console record; other starts keep a best per sled", () => {
  const { ctx, g } = started({ seed: 38, progress: { schema: 3, far: 3, sel: { start: 2 } } });
  step(g, 3, runnerBot(g));
  kill(g);
  assert.equal(ctx.calls.score.length, 0);
  assert.ok(g.sv.pb[0] > 0);
});
test("zen: no clock and no score; a rille costs nothing and the ride goes on", () => {
  const ctx = appContext({ seed: 39, progress: { schema: 3, lv: 2 } }), g = new Moonrunner(ctx);
  g.start("zen");
  step(g, 1);
  assert.equal(g.T, Infinity);
  g.fall({ x0: g.r.x, x1: g.r.x + 100, done: false });
  step(g, 30, runnerBot(g));
  assert.equal(g.phase, "play");
  assert.equal(g.T, Infinity);
  g.pause(); g.dispose();
  assert.equal(ctx.calls.score.length, 0);
  assert.ok(g.sv.st.zen > 0, "zen metres were not banked");
});
test("daily run: the same hills for everyone on a date, different ones the next day; its goal is the console's order", () => {
  const make = (key) => { const g = new Moonrunner(appContext({ seed: Math.random() * 1e9 })); g.dayKey = () => key; g.start("daily"); g.r.x += 3000; g.extend(); return g; };
  const a = make("2026-10-01"), b = make("2026-10-01"), c = make("2026-10-02");
  assert.deepEqual(a.kp, b.kp);
  assert.notDeepEqual(a.kp, c.kp);
  assert.ok(dailyGoal("2026-10-01").text.length > 5);
  const ctx = appContext({ seed: 40, progress: { schema: 3, sh: 0, dl: { last: "2026-09-30", streak: 2 } } }), said = [];
  let met = 0;
  ctx.daily = (text) => said.push(text);
  ctx.dailyMet = () => met++;
  const g = new Moonrunner(ctx);
  assert.equal(said.length, 1);
  assert.match(said[0], /^Daily run: /);
  assert.equal(g.sv.dl.streak, undefined, "the old streak was kept");
  g.dayKey = () => "2026-10-01";
  g.start("daily");
  g.goalMet = () => true;
  step(g, 1);
  assert.ok(g.goalDone);
  kill(g);
  step(g, 3);
  assert.equal(met, 1, "the console was not told the order was met");
  assert.equal(g.sv.dl.done, 1);
  assert.ok(g.sv.sh >= 60, "the day's goal paid no shards");
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
  const ctx = appContext({ seed: 42, progress: { schema: 3, lv: 9, far: 5, sh: 999 } }), g = new Moonrunner(ctx);
  g.draw(g2d);
  press(g, 0.6);
  for (const v of ["menu", "workshop", "orders", "log"]) { g.view = v; g.draw(g2d); }
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
  g.T = 5; g.fever = 2; step(g, 0.1); g.draw(g2d); // the terminator and fever
  g.sv.sel.start = 5; g.start(); step(g, 3, runnerBot(g)); g.draw(fakeCanvas()); // the far side
  kill(g); step(g, 1); g.draw(g2d);
  assert.ok(sizes.length > 100);
  assert.ok(Math.min(...sizes) >= 16, "smallest text " + Math.min(...sizes));
});

test("from the crystals on the sled is on its own: less assist, a narrower perfect window, less daylight per zone", () => {
  const { g } = started({ seed: 61 });
  const at = (zi) => (ZONES[zi].from + 50) * PX_M;
  assert.equal(g.windowAt(at(0)), PERFECT);
  assert.equal(g.windowAt(at(2)), PERFECT);
  for (let zi = 3; zi < ZONES.length; zi++) {
    assert.ok(g.windowAt(at(zi)) < g.windowAt(at(zi - 1)), "zone " + zi + " is no narrower");
    assert.ok(GRIP[zi].assist < GRIP[zi - 1].assist, "zone " + zi + " has no less assist");
    assert.ok(ZONE_T[zi] < ZONE_T[zi - 1], "zone " + zi + " gives no less daylight");
  }
});
test("workshop gear adds no points: a perfect slide and a shard score the same with full gear", () => {
  const run = (up) => {
    const { g } = started({ seed: 62, progress: { schema: 3, up } });
    clearAll(g);
    const x = onDownslope(g), pts = g.pts;
    landAt(g, x, 0.05);
    g.shards = [{ x: g.r.x + 4, y: g.r.y - 18, got: 0 }];
    g.update(DT);
    return { pts: g.pts - pts, T: g.T, shards: g.R.shards };
  };
  const bare = run({}), full = run({ mag: 3, bat: 2, coil: 1 });
  assert.equal(full.shards, 1);
  assert.equal(full.pts, bare.pts);
  assert.equal(full.T, bare.T);
});
test("four lamps: speed, landing, chain and fever, daylight; fever no longer hides the landing lamp", () => {
  const { ctx, g } = started({ seed: 63 });
  clearAll(g);
  assert.equal(g.lampValues().length, 9, "a three-lamp node still gets nine values");
  ctx.lampCount = () => 4;
  const lamp = (v, i) => v.slice(i * 3, i * 3 + 3);
  const x = onDownslope(g);
  for (let k = 0; k < 2; k++) landAt(g, x, 0.05);
  g.fx.perfect = 0; g.fx.shard = 0;
  let v = g.lampValues();
  assert.equal(v.length, 12);
  assert.ok(lamp(v, 2)[1] > 0 && lamp(v, 1).every((c) => c === 0), "on the ground the chain is on the third lamp: " + v);
  assert.ok(lamp(v, 3).some((c) => c > 0), "no daylight on the fourth lamp");
  landAt(g, x, 0.05); // the third: fever
  assert.ok(g.fever > 0);
  g.fx.perfect = 0; g.fx.zone = 0; g.fx.order = 0;
  // In the air during fever: the landing lamp still says whether a landing now would be perfect.
  Object.assign(g.r, { x, y: g.gy(x) - 60, air: true, vx: 600 * Math.cos(g.slopeAt(x)), vy: 600 * Math.sin(g.slopeAt(x)) });
  v = g.lampValues();
  assert.ok(lamp(v, 1)[1] > lamp(v, 1)[2], "the landing lamp is not green in fever: " + lamp(v, 1));
  const w = lamp(v, 2);
  assert.ok(w[0] > 0 && w[0] >= w[1] && w[1] >= w[2] && w[2] > 0, "fever is not the white lamp on the third lamp: " + w);
});
