import test from "node:test";
import assert from "node:assert/strict";
import { Perihelion, migrateSave, dailyGoal } from "../web/apps/perihelion.js";
import { Random } from "../web/engine/math.js";
import { appContext, fakeCanvas, run } from "./helpers/app-context.mjs";

const DT = 1 / 60;
const start = (options) => {
  const ctx = appContext(options);
  const app = new Perihelion(ctx);
  app.down(); // leave the title
  app.up();
  app.down(); // the first run of a session waits parked until a second press launches it
  app.up();
  return { ctx, app };
};
const clone = (p) => ({ ...p });

// ---- a planning bot ---------------------------------------------------------
// It plays by simulating the game's own physics: when to press, then which
// release instant leads on to a safe catch of the next sun (two catches deep).
function value(app, q, depth) {
  const r = clone(q);
  let best = -Infinity;
  let waited = 0;
  for (let f = 1; f <= 180; f++) {
    app.stepProbe(r, DT);
    if (app.fate(r)) return best;
    if (f % 6) continue;
    const a = app.pickTarget(r);
    if (!a || a.x < r.x - 40) continue; // the bot only plays forward
    // Try pressing now and at two later instants; keep the best.
    const leaf = a.x - 0.4 * Math.max(0, Math.abs(r.y - 270) - 100);
    if (depth === 0) return Math.max(best, leaf);
    const s = clone(r);
    app.settle(s, a);
    const inner = bestRelease(app, s, depth - 1);
    best = Math.max(best, inner.score);
    if (++waited >= 2) return best;
  }
  return best;
}
function bestRelease(app, engaged, depth) {
  const p = clone(engaged);
  let best = { score: -Infinity, tau: 1 };
  const stride = depth ? 8 : 12;
  for (let step = 0; step < 330 / stride; step++) {
    if (p.t >= 0.4 || p.fuse <= 0) {
      const q = clone(p);
      app.detach(q);
      const s = value(app, q, depth);
      if (s > best.score) best = { score: s, tau: p.t };
    }
    let dead = false;
    for (let k = 0; k < stride && !dead; k++) {
      app.stepProbe(p, DT);
      if (app.fate(p)) dead = true;
      if (p.a.kind === "decay" && p.t >= 2.4) dead = true;
    }
    if (dead) break;
  }
  return best;
}
// A sloppy bot looks only one catch ahead, releases up to `jitter` seconds off its
// plan and takes `lag` frames to react: a stand-in for a decent human.
function makeBot(app, depth = 1, jitter = 0, lag = 0) {
  let tau = null, frame = 0, seen = 0;
  const noise = new Random(99);
  return (i) => {
    frame++;
    if (app.phase !== "play") return;
    const p = app.p;
    if (app.held && p.a) {
      if (p.t >= tau) { app.up(); tau = null; }
      return;
    }
    if (app.held) { if (!app.pending) app.up(); return; }
    if (frame % 2 || !app.pickTarget(p)) return;
    const a = app.pickTarget(p);
    if (a.x < p.x - 40 && !(p.y > 430 && p.vy > 0)) return; // forward only, unless falling out
    const s = clone(p);
    app.settle(s, a);
    const plan = bestRelease(app, s, depth);
    const urgent = p.y > 430 && p.vy > 0;
    if (Number.isFinite(plan.score) || urgent) {
      tau = (Number.isFinite(plan.score) ? plan.tau : 1) + noise.range(-jitter, jitter);
      app.down();
    }
  };
}
const memo = new Map();
const botRun = (seed, seconds) => {
  const key = seed + "/" + seconds;
  if (!memo.has(key)) memo.set(key, play(seed, seconds, (app) => makeBot(app)));
  return memo.get(key);
};
function play(seed, seconds, driver) {
  const { ctx, app } = start({ seed });
  const bot = driver?.(app);
  const stepper = bot ? (i) => bot(i) : null;
  let nan = false, maxAnchors = 0, maxVoids = 0, maxRelics = 0;
  run(app, seconds, (i) => {
    stepper?.(i);
    if (i % 30 === 0) {
      maxAnchors = Math.max(maxAnchors, app.anchors.length);
      maxVoids = Math.max(maxVoids, app.voids.length);
      maxRelics = Math.max(maxRelics, app.relics.length);
      for (const k of ["x", "y", "vx", "vy", "phi", "om"]) if (!Number.isFinite(app.p[k])) nan = true;
    }
  });
  return { ctx, app, nan, maxAnchors, maxVoids, maxRelics };
}

test("a planning bot crosses every region to the perihelion on most seeds and far outscores an idle probe", () => {
  // The flight is chaotic: the last bits of Math.sin differ between machines (the Pi's arm64
  // against an x86 host), so one seed's run can end differently. Three of five must arrive, and
  // every seed must get well into the journey.
  const rows = [];
  for (const seed of [11, 5, 41, 9, 33]) {
    const bot = botRun(seed, 360);
    const idle = play(seed, 120, null);
    rows.push({ seed, phase: bot.app.phase, reason: bot.app.reason, score: Math.floor(bot.app.scoreRaw), chain: bot.app.bestChain, catches: bot.app.catches, t: Math.round(bot.app.runT), cross: bot.app.cross, relics: bot.app.R.relics, near: bot.app.R.near, idleScore: Math.floor(idle.app.scoreRaw), idlePhase: idle.app.phase });
    const row = JSON.stringify(rows.at(-1));
    assert.equal(bot.nan, false);
    assert.deepEqual(bot.app.cross.slice(0, 2).map((c) => c[0]), [0, 1], "crossed the approach and the cluster: " + row);
    assert.equal(idle.app.phase, "over");
    assert.ok(Math.floor(bot.app.scoreRaw) > 20 * Math.max(1, Math.floor(idle.app.scoreRaw)), row);
    assert.ok(bot.app.catches > bot.app.runT * 0.3, "catches " + row);
  }
  // An arrival crossed every region from I to V (VI ends in the arrival), about when the dark quickens.
  const arrived = rows.filter((r) => r.reason === "arrived" && r.t < 300 && r.cross.map((c) => c[0]).join() === "0,1,2,3,4");
  assert.ok(arrived.length >= 3, "arrivals on at least three of five seeds: " + JSON.stringify(rows));
  if (process.env.PERI_REPORT) console.log(JSON.stringify(rows));
});

test("an idle probe falls out of the band and the run ends with a result", () => {
  const { ctx, app } = play(5, 20, null);
  assert.equal(app.phase, "over");
  assert.equal(app.reason, "fall");
  assert.equal(ctx.calls.score.length, 1);
  assert.equal(ctx.calls.saved.length, 1);
  assert.equal(ctx.calls.saved[0].last.reason, "FELL INTO THE DARK");
  app.draw(fakeCanvas());
  // Pressing right after death does not skip the result; a later press relaunches.
  app.crash("fall");
  app.down();
  assert.equal(app.phase, "over");
  run(app, 1, null);
  app.down();
  app.up();
  assert.equal(app.phase, "play");
});

test("the terminator ends a run that stalls on a sun", () => {
  const { app } = start({ seed: 9 });
  // Hold on the first sun for as long as it takes.
  app.p.x = 200; app.p.y = 200; app.p.vx = 250; app.p.vy = 0;
  app.down();
  run(app, 0.1, null);
  assert.ok(app.p.a, "caught");
  run(app, 60, (i) => { if (app.phase === "play") app.held = true; });
  assert.equal(app.phase, "over");
  assert.ok(["dark", "fall", "top"].includes(app.reason));
});

test("swing conserves energy over a long hold and releases exactly on the tangent", () => {
  const { app } = start({ seed: 1 });
  const a = app.anchors[0];
  a.kind = "steady";
  const p = app.p;
  p.x = a.x - 90; p.y = a.y + 70; p.vx = 230; p.vy = -90;
  const speed0 = Math.hypot(p.vx, p.vy);
  app.engage(p, a);
  const G = 240;
  const energy = () => 0.5 * (p.r * p.om) ** 2 - G * p.r * Math.cos(p.phi);
  const e0 = energy();
  assert.ok(Math.abs(Math.hypot(p.vx, p.vy) - speed0) < 1e-9, "catch keeps speed");
  const r0 = p.r;
  assert.ok(Math.abs(r0 - Math.hypot(90, 70)) < 1e-9, "tether engages at the current distance");
  let worst = 0, maxRadius = 0;
  for (let i = 0; i < 60 * 60; i++) { // a full minute of simulated swinging
    app.stepProbe(p, DT);
    worst = Math.max(worst, Math.abs(energy() - e0) / Math.abs(e0));
    maxRadius = Math.max(maxRadius, Math.abs(Math.hypot(p.x - a.x, p.y - a.y) - r0));
  }
  assert.ok(worst < 1e-3, "relative energy drift " + worst);
  assert.ok(maxRadius < 1e-9, "line stays rigid");
  // Tangent release, from several angles.
  for (const hold of [0.4, 0.9, 1.7]) {
    const q = { ...app.p };
    app.engage(q, a);
    for (let i = 0; i < Math.round(hold * 60); i++) app.stepProbe(q, DT);
    const sp = Math.hypot(q.vx, q.vy);
    const rx = q.x - a.x, ry = q.y - a.y;
    app.detach(q);
    const dot = (q.vx * rx + q.vy * ry) / (Math.hypot(q.vx, q.vy) * Math.hypot(rx, ry));
    assert.ok(Math.abs(dot) < 1e-9, "tangent: radial component " + dot);
    assert.ok(Math.abs(Math.hypot(q.vx, q.vy) - sp) < 1e-9, "speed preserved");
    assert.equal(q.a, null);
  }
});

test("the reticle names the nearest sun ahead or above, a sun below only when nothing above is in reach, and one behind only when heading back or nothing is ahead", () => {
  const { app } = start({ seed: 2 });
  app.anchors.length = 0;
  const add = (x, y) => app.addAnchor(x, y, "steady");
  const near = add(300, 100), far = add(400, 150), behind = add(80, 200), below = add(260, 360);
  const p = { x: 200, y: 200, vx: 50, vy: 0, lastId: -1, back: 0 };
  assert.equal(app.pickTarget(p), near); // |(100,-100)| = 141
  p.vx = -50;
  assert.equal(app.pickTarget(p), behind, "heading back: the sun behind");
  p.back = 100;
  assert.equal(app.pickTarget(p), near, "but never one further back than the limit");
  p.vx = 50; p.back = 0;
  near.dead = true;
  assert.equal(app.pickTarget(p), far, "above wins over a nearer sun below");
  far.dead = true;
  assert.equal(app.pickTarget(p), below, "the solid tether can take a sun below");
  below.dead = true;
  assert.equal(app.pickTarget(p), behind, "nothing ahead: the sun behind");
  p.back = 100;
  assert.equal(app.pickTarget(p), null);
});

test("tricks: a stall above the sun and a loop round it pay flat points, at most three loops a tether", () => {
  const { app } = inRegion(0, 3);
  run(app, 0.2, null);
  app.anchors.length = 0;
  const a = app.addAnchor(app.p.x + 60, 260, "steady");
  const p = app.p;
  // A fast catch close to the sun: it loops.
  p.x = a.x; p.y = a.y + 60; p.vx = 330; p.vy = 0;
  app.engage(p, a);
  app.held = true;
  app.tether = { counted: false, flightAtCatch: 0, spin: 0, loops: 0, stalls: 0, skip: 0, back: false };
  const s0 = app.scoreRaw;
  run(app, 6, null);
  assert.equal(app.R.loops, 3, "three loops pay");
  assert.ok(app.scoreRaw - s0 >= 75);
  assert.ok(app.R.trickPts >= 75 && app.R.tricks >= 3);
  // A slow catch level with the sun swings up past level and stops: a stall.
  const b = app.addAnchor(p.x + 400, 300, "steady");
  app.up();
  p.x = b.x - 100; p.y = b.y + 5; p.vx = 0; p.vy = 200; p.om = 0;
  app.engage(p, b);
  app.held = true;
  app.tether = { counted: false, flightAtCatch: 0, spin: 0, loops: 0, stalls: 0, skip: 0, back: false };
  const st = app.R.stalls;
  run(app, 2.5, null);
  assert.ok(app.R.stalls > st, "stalled");
  assert.ok(app.sv.ft.includes("stall") && app.sv.ft.includes("loop"), "feats for both");
});

test("a paced run moves the screen on by itself and its left edge ends the run; it keeps its own best", () => {
  const ctx = appContext({ seed: 4, progress: { schema: 2, runs: 5, sel: { pace: 2 } } });
  const app = new Perihelion(ctx);
  app.launches = 1;
  app.down(); app.up();
  assert.equal(app.pace, 2);
  const cam0 = app.cam;
  app.p.g = 1e-9; app.p.vx = 0; app.p.vy = 0;
  run(app, 1, null);
  assert.ok(app.cam - cam0 > 120, "the screen moved on: " + (app.cam - cam0));
  run(app, 3, null);
  assert.equal(app.phase, "over");
  assert.equal(app.reason, "edge");
  assert.equal(ctx.calls.score.length, 0, "a paced run does not touch the console best");
  assert.ok(app.sv.pp[2] >= 0 && app.result.reason === "LEFT BEHIND BY THE PACE");
});

test("caught from above, the solid tether pivots the probe over the sun and keeps it at the same distance", () => {
  const { app } = start({ seed: 2 });
  app.anchors.length = 0;
  const a = app.addAnchor(400, 300, "steady");
  const p = { x: 340, y: 220, vx: 260, vy: 0, lastId: -1, g: 240, clk: 0 };
  assert.equal(app.pickTarget(p), a);
  app.engage(p, a);
  const r0 = p.r;
  let topY = null;
  for (let i = 0; i < 90 && topY === null; i++) {
    app.stepProbe(p, DT);
    assert.ok(Math.abs(Math.hypot(p.x - a.x, p.y - a.y) - r0) < 1e-9, "rigid");
    if (p.x >= a.x) topY = p.y;
  }
  assert.ok(topY !== null && topY < a.y - r0 + 2, "it passes over the top of the sun");
  const x0 = p.x, y0 = p.y;
  for (let i = 0; i < 10; i++) app.stepProbe(p, DT);
  assert.ok(p.x > x0 && p.y > y0, "and swings on down the far side");
});

test("three stray quick taps neither end the run nor bend the course much, and cancel keeps the run", () => {
  const seed = 77;
  const a = start({ seed }).app, b = start({ seed }).app;
  // Same first moments for both: then b gets three 80 ms taps with 130 ms gaps.
  run(a, 0.3, null); run(b, 0.3, null);
  for (let k = 0; k < 3; k++) {
    b.down();
    run(b, 0.08, null);
    b.up();
    run(b, 0.13, null);
  }
  b.down();
  run(b, 0.08, null);
  b.cancel(); // the fourth tap opens the menu
  assert.equal(b.held, false);
  run(a, 3 * 0.21 + 0.08, null);
  run(a, 0.5, null); run(b, 0.5, null);
  assert.equal(b.phase, "play");
  assert.ok(!b.p.a, "no tether left behind");
  assert.ok(Math.hypot(a.p.x - b.p.x, a.p.y - b.p.y) < 15, "course barely changed: " + Math.hypot(a.p.x - b.p.x, a.p.y - b.p.y));
  assert.ok(b.catches === 0 && b.chain === 0, "taps are not catches");
});

test("cancel and dispose mid-swing leave the lamps off and the tether released", () => {
  const { ctx, app } = start({ seed: 4 });
  run(app, 0.2, null);
  app.down();
  run(app, 0.5, null);
  assert.ok(app.p.a, "tethered");
  app.cancel();
  assert.equal(app.p.a, null);
  assert.deepEqual(ctx.calls.leds.at(-1), Array(9).fill(0));
  assert.equal(app.phase, "play");
  app.down();
  run(app, 0.3, null);
  app.dispose();
  assert.deepEqual(ctx.calls.leds.at(-1), Array(9).fill(0));
});

test("lamps are nine whole bytes, moderate, and change during play", () => {
  const { ctx } = botRun(11, 300);
  const seen = new Set();
  let peak = 0;
  for (const v of ctx.calls.leds) {
    assert.equal(v.length, 9);
    for (const x of v) { assert.ok(Number.isInteger(x) && x >= 0 && x <= 255, String(v)); peak = Math.max(peak, x); }
    seen.add(v.join());
  }
  assert.ok(seen.size > 40, "lamps vary: " + seen.size);
  assert.ok(peak > 150, "accents reach high: " + peak);
});

test("lamp instruments: height colour, speed fill, and swing spot", () => {
  const { ctx, app } = start({ seed: 6 });
  const read = () => { app.update(DT); return ctx.calls.leds.at(-1); };
  const place = (x, y, vx, vy) => { Object.assign(app.p, { x, y, vx, vy, a: null, lastId: 999 }); app.runT = 0; app.catchFlash = 0; };
  // Free flight at mid height, fast: green on all three lamps.
  place(300, 270, 420, 0);
  let v = read();
  for (const lamp of [0, 1, 2]) assert.ok(v[lamp * 3 + 1] > 40 && v[lamp * 3 + 1] > 3 * v[lamp * 3], "green on lamp " + lamp + ": " + v);
  // Slow: the right lamp falls dark first, the left stays lit (speed fills left to right).
  place(300, 270, 300, 0);
  v = read();
  assert.ok(v[1] > v[4] && v[4] > v[7], "speed fill left to right: " + v);
  // Toward the edge: amber, then red when about to fall out.
  place(300, 440, 420, 0);
  v = read();
  assert.ok(v[0] > 40 && v[1] > 20 && v[0] > v[1], "amber near the edge: " + v);
  place(300, 520, 420, 0);
  v = read();
  assert.ok(v[0] > 20 && v[1] < v[0] / 4, "red at the edge: " + v);
  // Tethered: one spot that follows the probe's angle around the sun.
  const a = app.anchors[0];
  Object.assign(app.p, { x: a.x - 120, y: a.y + 40, vx: 240, vy: 0, a: null, lastId: -1 });
  app.catchFlash = 0;
  app.engage(app.p, a);
  app.tether = { counted: false, flightAtCatch: 0 };
  const where = [];
  for (let i = 0; i < 90; i++) {
    app.update(DT);
    const l = ctx.calls.leds.at(-1);
    const sum = [l[0] + l[1] + l[2], l[3] + l[4] + l[5], l[6] + l[7] + l[8]];
    assert.ok(sum.filter((x) => x > 20).length <= 2, "a spot, not a fill: " + l);
    where.push(sum.indexOf(Math.max(...sum)));
  }
  assert.ok(new Set(where).size >= 2, "spot moves across the lamps: " + [...new Set(where)]);
});

test("a catch gives a bright accent and a new record flashes all three lamps", () => {
  const { ctx, app } = start({ seed: 8, best: 100 });
  Object.assign(app.p, { x: 250, y: 190, vx: 200, vy: 0 });
  app.down();
  run(app, 0.12, null); // the tether lands after a few frames
  assert.ok(app.p.a, "tethered");
  assert.ok(Math.max(...ctx.calls.leds.slice(-8).flat()) > 150, "accent");
  assert.ok(ctx.calls.tone.length > 0);
  app.up();
  // Cross the old best.
  app.scoreRaw = 101;
  const before = ctx.calls.leds.length;
  app.update(DT);
  const flash = ctx.calls.leds.slice(before).at(-1);
  assert.ok(flash[0] > 100 && flash[3] > 100 && flash[6] > 100, "all three lit: " + flash);
});

test("lists stay bounded and the world is generated ahead and dropped behind", () => {
  const r = botRun(9, 360);
  assert.ok(r.maxAnchors < 40 && r.maxVoids <= 30, `anchors ${r.maxAnchors} voids ${r.maxVoids}`);
  assert.ok(r.app.maxX > 27000, "went a long way: " + r.app.maxX);
  assert.ok(r.app.anchors[0].x > r.app.maxX - 1500);
  assert.ok(r.maxRelics <= 12);
  const g = fakeCanvas();
  r.app.draw(g);
  const prims = Object.values(g.count).reduce((a, b) => a + b, 0);
  assert.ok(prims < 400, "primitives per frame: " + prims);
});

test("a chain counts swings in a row but earns no points: the score is distance plus extras", () => {
  const r = botRun(202, 300);
  assert.ok(r.app.bestChain >= 6, "best chain " + r.app.bestChain);
  const { app } = start({ seed: 3 });
  app.anchors.length = 0; app.voids.length = 0; app.relics.length = 0;
  app.chain = 10;
  app.p.g = 1e-9; app.p.vy = 0; app.p.vx = 200;
  const s0 = app.scoreRaw, x0 = app.maxX;
  run(app, 1, null);
  assert.ok(Math.abs(app.scoreRaw - s0 - (app.maxX - x0) / 10) < 1e-6, "one point per Mkm, whatever the chain");
});

test("every screen draws and the title, play and result states are distinct", () => {
  const { app } = play(12, 20, (app) => makeBot(app));
  const g = fakeCanvas();
  app.draw(g);
  const fresh = new Perihelion(appContext());
  fresh.draw(g);
  assert.equal(fresh.phase, "title");
  app.crash("void");
  app.draw(g);
  assert.equal(app.phase, "over");
});

test("the first run of a session waits parked until a deliberate press; later runs start at once", () => {
  const ctx = appContext({ seed: 6 });
  const app = new Perihelion(ctx);
  app.down(); app.up(); // leave the title
  assert.equal(app.phase, "play");
  assert.ok(app.ready, "parked");
  const x0 = app.p.x, y0 = app.p.y;
  run(app, 10, null);
  assert.equal(app.p.x, x0);
  assert.equal(app.p.y, y0);
  assert.equal(app.phase, "play", "a hesitating newcomer is not killed");
  assert.equal(app.runT, 0);
  app.draw(fakeCanvas());
  assert.ok(ctx.calls.leds.at(-1).every((x) => x < 60), "parked lamps are dim");
  // Menu open and resume while parked changes nothing.
  app.cancel(); app.pause(); app.resume();
  assert.ok(app.ready);
  app.down(); // launches and throws the tether
  run(app, 0.5, null);
  assert.ok(!app.ready);
  assert.ok(app.p.a, "the launching press caught the first sun");
  app.up();
  // After a loss the next press starts a live run at once.
  app.crash("fall");
  run(app, 1, null);
  app.down(); app.up();
  assert.equal(app.phase, "play");
  assert.ok(!app.ready);
  const before = app.p.x;
  run(app, 0.5, null);
  assert.ok(app.p.x > before + 50, "moving");
});

test("the dark quickens after five minutes until it outpaces any probe", () => {
  const { app } = start({ seed: 2 });
  assert.equal(app.frontSpeed(), 36);
  app.runT = 300;
  assert.equal(app.frontSpeed(), 96);
  app.runT = 600;
  assert.ok(app.frontSpeed() > 250, "front " + app.frontSpeed());
  app.runT = 1200;
  assert.ok(app.frontSpeed() > 400);
  // The notice is announced once.
  app.runT = 301;
  app.p.x = 500; app.p.y = 200; app.p.vx = 280; app.p.vy = 0; app.front = 0;
  app.update(DT);
  assert.match(app.notice, /quickening/);
});

// ======================= depth: journey, relics, hangar, feats, save =======================
const fnv = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const FAR = { schema: 2, far: 5, runs: 5 };
const FEATS_SOME = ["chain5", "chain12", "ceil", "fast1", "fast2", "relic1", "relic3", "relic25", "near3", "long"];
// Start a live (not parked) run in region k of a save that has reached region 5.
const inRegion = (k, seed = 7, extra = {}) => {
  const ctx = appContext({ seed, progress: { ...FAR, sel: { start: k, probe: 0, trail: 0 }, ...extra } });
  const app = new Perihelion(ctx);
  app.launches = 1;
  app.down(); app.up(); // title -> run
  return { ctx, app };
};
const tap = (app, seconds) => { app.down(); run(app, seconds, null); app.up(); };
const sumOf = (v, i) => v[i * 3] + v[i * 3 + 1] + v[i * 3 + 2];
const snapOf = (app) => JSON.stringify(Object.fromEntries(Object.entries(app).filter(([k, v]) => k !== "c" && k !== "guard" && typeof v !== "function").map(([k, v]) => [k, ArrayBuffer.isView(v) ? Array.from(v) : v])));

test("a save made by the first release migrates: best score, runs and field record survive", () => {
  // Produced by the code before this change (25 s bot run, then crash("fall")); best score 672.
  const old = { schema: 1, runs: 1, last: { mkm: 672, chain: 8, catches: 11, reason: "FELL INTO THE DARK", milestone: 6 }, milestone: 6 };
  const sv = migrateSave(old);
  assert.equal(sv.schema, 2);
  assert.equal(sv.runs, 1);
  assert.deepEqual(sv.last, old.last);
  assert.equal(sv.milestone, 6);
  assert.equal(sv.far, 0);
  assert.deepEqual(sv.ft, []);
  const ctx = appContext({ seed: 3, best: 672, progress: old });
  const app = new Perihelion(ctx);
  assert.equal(app.c.best(), 672);
  app.down(); app.up(); app.down(); app.up();
  assert.equal(app.phase, "play");
  app.crash("fall");
  run(app, 1, null); // the save waits out any menu gesture that could still take it back
  const saved = ctx.calls.saved.at(-1);
  assert.equal(saved.schema, 2);
  assert.equal(saved.runs, 2, "the run count continues from the old save");
  assert.equal(saved.last.reason, "FELL INTO THE DARK");
  assert.ok(saved.milestone >= 6);
  assert.ok(JSON.stringify(saved).length < 8192);
  // Garbage and future shapes never throw and come out in range.
  for (const junk of [null, undefined, 5, "x", [], { far: 99, sel: { probe: -4, start: 77 }, ft: ["nope", "chain5", "chain5"], rb: "x", pb: [1], st: 3 }, { runs: NaN, far: NaN }]) {
    const m = migrateSave(junk);
    assert.ok(m.far >= 0 && m.far <= 5 && m.sel.probe >= 0 && m.sel.probe <= 2 && m.sel.start <= 5);
    assert.equal(m.rb.length, 6);
    assert.equal(m.pb.length, 3);
    assert.ok(m.ft.every((id) => id === "chain5"));
    assert.ok(Number.isInteger(m.runs));
  }
});

test("the first region is generated exactly as before the journey was added", () => {
  // Digests of the first release's anchors and dark bodies below x = 4600 for these seeds.
  const golden = { 1: 842285061, 2: 2269738203, 3: 3358620448 };
  for (const seed of [1, 2, 3]) {
    const app = new Perihelion(appContext({ seed }));
    app.extend(4700);
    const s = app.anchors.filter((x) => x.x < 4600).map((x) => [Math.round(x.x), Math.round(x.y), x.kind].join()).join("|") + " V" + app.voids.filter((v) => v.x < 4600).map((v) => [Math.round(v.x), Math.round(v.y), Math.round(v.r)].join()).join("|");
    assert.equal(fnv(s), golden[seed], "seed " + seed);
    assert.equal(app.relics.length, 0, "no relics in the first region");
    assert.ok(app.anchors.filter((a) => a.x < 4600).every((a) => !a.orb && !a.pu && a.kind !== "sling"));
  }
});

test("each region adds its own rule to the world", () => {
  const seen = {}, from = [0, 5000, 9000, 13500, 18000, 22500];
  for (let k = 1; k <= 5; k++) {
    const { app } = inRegion(k, 21 + k);
    app.extend(app.p.x + 3600);
    const own = app.anchors.filter((a) => a.x > from[k]);
    seen[k] = { pairs: own.filter((a) => a.kind === "pair").length, pulses: own.filter((a) => a.kind === "pulse").length, voids: app.voids.length, relics: app.relics.length, suns: own.length };
  }
  const info = JSON.stringify(seen);
  assert.ok(seen[1].suns > seen[3].suns * 1.5, "the cluster is dense: " + info);
  assert.ok(seen[2].pairs >= 4 && seen[2].pairs % 2 === 0, "binaries come in pairs: " + info);
  assert.equal(seen[1].pairs + seen[3].pairs + seen[4].pairs + seen[5].pairs, 0);
  assert.ok(seen[5].pulses >= 3 && seen[4].pulses === 0, info);
  assert.ok(seen[4].voids > seen[1].voids + 4, "the dark field is crowded with dark bodies: " + info);
  for (let k = 1; k <= 5; k++) assert.ok(seen[k].relics >= 1, "relics from the cluster on, region " + k);
});

test("a binary's tether follows the moving sun, and the sun's velocity is carried into the release", () => {
  const { app } = inRegion(2, 9);
  const a = app.anchors.find((x) => x.kind === "pair");
  assert.ok(a && a.orb);
  const pivot = (clk) => ({ x: a.x + a.orb.R * Math.cos(a.orb.ph + a.orb.w * clk), y: a.y + a.orb.R * Math.sin(a.orb.ph + a.orb.w * clk) });
  const p = { x: 0, y: 0, vx: 250, vy: 0, a: null, r: 0, phi: 0, om: 0, t: 0, v0x: 0, v0y: 0, fuse: 0, lastId: -1, clk: 3, g: 240 };
  const c0 = pivot(3);
  p.x = c0.x - 110; p.y = c0.y + 30;
  app.engage(p, a);
  const r = p.r;
  let worst = 0;
  for (let i = 0; i < 90; i++) {
    app.stepProbe(p, DT);
    const c = pivot(p.clk);
    worst = Math.max(worst, Math.abs(Math.hypot(p.x - c.x, p.y - c.y) - r));
  }
  assert.ok(worst < 1e-6, "the line stays rigid about the moving sun: " + worst);
  app.detach(p);
  const w = a.orb.w, ang = a.orb.ph + w * p.clk, c = pivot(p.clk);
  const sun = { vx: -a.orb.R * w * Math.sin(ang), vy: a.orb.R * w * Math.cos(ang) };
  const rel = { x: p.vx - sun.vx, y: p.vy - sun.vy }, rad = { x: p.x - c.x, y: p.y - c.y };
  assert.ok(Math.abs(rel.x * rad.x + rel.y * rad.y) / (Math.hypot(rel.x, rel.y) * Math.hypot(rad.x, rad.y)) < 1e-9, "tangent relative to the sun");
  // A still sun is exactly as before: the line stays rigid.
  const s = app.anchors.find((x) => x.kind === "steady");
  const q = { x: s.x - 90, y: s.y + 70, vx: 230, vy: -90, a: null, lastId: -1, clk: 5, g: 240 };
  app.engage(q, s);
  for (let i = 0; i < 120; i++) app.stepProbe(q, DT);
  assert.ok(Math.abs(Math.hypot(q.x - s.x, q.y - s.y) - q.r) < 1e-9);
});

test("a pulsing sun can be caught only while lit, and a throw that lands in the dark is wasted", () => {
  const { app } = inRegion(5, 4);
  app.anchors.length = 0;
  const a = app.addAnchor(app.p.x + 150, app.p.y - 20, "pulse");
  a.pu = { per: 3, ph: 0, duty: 0.6 };
  const p = { x: app.p.x, y: app.p.y, vx: 0, vy: 0, lastId: -1, clk: 0.2 };
  assert.equal(app.pickTarget(p), a, "lit at 0.2 s");
  p.clk = 1.7; // lit until 1.8 s: the tether would land after it went dark
  assert.equal(app.pickTarget(p), null, "about to go dark");
  p.clk = 2.4;
  assert.equal(app.pickTarget(p), null, "dark");
  p.clk = 3.1;
  assert.equal(app.pickTarget(p), a, "lit again");
  Object.assign(app.p, { x: a.x - 150, y: a.y + 20, vx: 0, vy: 0, clk: 1.9, a: null, lastId: -1 });
  app.pending = a; app.held = true;
  app.land();
  assert.equal(app.p.a, null);
  assert.equal(app.pending, null);
});

test("the nebula's current pushes a probe in free flight and nowhere else", () => {
  const { app } = inRegion(3, 5);
  const fly = (x) => { const p = { x, y: 250, vx: 250, vy: 0, a: null, lastId: -1, clk: 0, g: 240 }; for (let i = 0; i < 60; i++) app.stepProbe(p, DT); return p; };
  const drop = (p) => p.y - 250;
  const outside = fly(9000), a = fly(15500), b = fly(14200), c = fly(16500);
  assert.ok(Math.abs(drop(outside) - 120) < 1.5, "plain gravity outside the nebula " + drop(outside));
  assert.ok([a, b, c].some((q) => Math.abs(drop(q) - drop(outside)) > 15), "the current bends the flight");
  const f = app.current(15000, { x: 0, y: 0 });
  assert.ok(Math.abs(f.y) <= 85 && Math.abs(f.x) <= 45);
  assert.equal(app.current(13500, { x: 0, y: 0 }).x, 0, "the current fades in at the region's edge");
  const s = app.anchors[0];
  const q = { x: 15000, y: 200, vx: 250, vy: 0, a: null, lastId: -1, clk: 0, g: 240 };
  s.x = 15150; s.y = 150; s.orb = undefined;
  app.engage(q, s);
  for (let i = 0; i < 100; i++) app.stepProbe(q, DT);
  assert.ok(Math.abs(Math.hypot(q.x - s.x, q.y - s.y) - q.r) < 1e-9, "the swing is untouched by it");
});

test("a sling sun adds speed to a clean release only, and never beyond its cap", () => {
  const { app } = inRegion(1, 6);
  const a = app.addAnchor(app.p.x + 100, app.p.y - 40, "sling");
  const mk = () => ({ x: a.x - 100, y: a.y + 60, vx: 260, vy: -40, a: null, lastId: -1, clk: 0, g: 240 });
  const p = mk(); app.engage(p, a);
  for (let i = 0; i < 30; i++) app.stepProbe(p, DT);
  const s0 = Math.hypot(p.vx, p.vy);
  app.detach(p);
  assert.ok(Math.abs(Math.hypot(p.vx, p.vy) / s0 - 1.08) < 1e-9, "x1.08");
  const q = mk(); app.engage(q, a);
  for (let i = 0; i < 8; i++) app.stepProbe(q, DT); // a stray tap
  const sq = Math.hypot(q.vx, q.vy);
  app.detach(q);
  assert.ok(Math.abs(Math.hypot(q.vx, q.vy) - sq) < 1e-9, "no gain from a stray tap");
  const f = mk(); f.vx = 440; f.vy = 0; app.engage(f, a);
  for (let i = 0; i < 30; i++) app.stepProbe(f, DT);
  app.detach(f);
  assert.ok(Math.hypot(f.vx, f.vy) <= 460 + 1e-9, "capped");
});

test("relics pay out, count, are explained once and saved; near passes score only past the approach", () => {
  const { ctx, app } = inRegion(1, 8);
  app.relics.length = 0;
  app.relics.push({ x: app.p.x + 40, y: app.p.y + 4, got: 0 });
  const s0 = app.scoreRaw;
  run(app, 0.3, null);
  assert.equal(app.R.relics, 1);
  assert.ok(app.scoreRaw > s0 + 24, "relic pays");
  assert.ok(app.sv.seen.relic, "its first appearance was explained");
  assert.ok(app.sv.ft.includes("relic1"), "FIRST FIND is earned");
  app.crash("fall");
  run(app, 1, null);
  assert.equal(ctx.calls.saved.at(-1).st.relics, 1);
  assert.equal(ctx.calls.saved.at(-1).last.relics, 1);
  // A near pass: edge about 16 px from the path.
  const { app: b } = inRegion(1, 8);
  b.voids.length = 0; b.relics.length = 0;
  Object.assign(b.p, { vx: 280, vy: 0 });
  b.voids.push({ x: b.p.x + 60, y: b.p.y + 6 + 14 + 16, r: 14, m: 999, s: 0 });
  b.p.g = 1e-9;
  run(b, 0.6, null);
  assert.ok(b.phase === "play" && b.voids[0].s === 1);
  assert.equal(b.R.near, 1);
  assert.ok(b.sv.seen.near);
  // The same pass in the approach pays nothing.
  const { app: c } = inRegion(0, 8);
  c.voids.length = 0;
  Object.assign(c.p, { vx: 280, vy: 0, g: 1e-9 });
  c.voids.push({ x: c.p.x + 60, y: c.p.y + 6 + 14 + 16, r: 14, m: 999, s: 0 });
  run(c, 0.6, null);
  assert.equal(c.R.near, 0);
});

test("hidden feats: two near passes in a row open THE EYE; a fifth bottom release opens PLUMB LINE", () => {
  const { app } = inRegion(4, 3);
  app.voids.length = 0;
  Object.assign(app.p, { vx: 280, vy: 0, g: 1e-9 });
  for (const dx of [50, 110]) app.voids.push({ x: app.p.x + dx, y: app.p.y + 6 + 14 + 16, r: 14, m: 999, s: 0 });
  run(app, 0.8, null);
  assert.equal(app.R.near, 2);
  assert.ok(app.sv.ft.includes("thread"));
  const { app: b } = inRegion(0, 3);
  b.R.bottom = 4;
  const a = b.anchors[0];
  Object.assign(b.p, { x: a.x, y: a.y + 90, vx: 260, vy: 0, a: null, lastId: -1 });
  b.engage(b.p, a); b.p.t = 0.6; b.tether = { counted: true, flightAtCatch: 0 };
  b.p.phi = 0.01;
  b.releaseTether();
  assert.equal(b.R.bottom, 5);
  assert.ok(b.sv.ft.includes("plumb"));
});

test("the swing sings: a note at the bottom of each pass, climbing with speed, and a soft fifth on a clean release", () => {
  const { ctx, app } = inRegion(0, 12);
  const a = app.anchors[0];
  Object.assign(app.p, { x: a.x - 90, y: a.y + 70, vx: 100, vy: 230 }); // already moving away: it locks at once
  app.down();
  run(app, 6, null);
  const tones = ctx.calls.tone.filter((t) => t[2] === "sine" && t[1] === 0.12);
  assert.ok(tones.length >= 2, "bottom notes while swinging: " + tones.length);
  for (const t of tones) assert.ok(t[0] >= 250 && t[0] <= 1300);
  assert.ok(app.noteHz(400) > app.noteHz(200));
  const n0 = ctx.calls.tone.length;
  app.up();
  run(app, 0.4, null);
  const after = ctx.calls.tone.slice(n0).map((t) => t[0]);
  assert.ok(after.length >= 3, "release ring: " + after);
  assert.ok(Math.abs(after.at(-1) / after.at(-2) - 1.5) < 1e-6, "a fifth: " + after);
});

test("the lamps point at relics and dark bodies by side, count down a pulsing sun, and wear each region's colour", () => {
  const { ctx, app } = inRegion(1, 14);
  app.relics.length = 0; app.voids.length = 0;
  const lampsNow = () => { app.update(DT); return ctx.calls.leds.at(-1); };
  const hold = (x, y) => Object.assign(app.p, { x, y, vx: 260, vy: 0, a: null, lastId: 999, g: 1e-9 });
  hold(app.p.x, 270);
  app.relics.push({ x: app.p.x + 150, y: 150, got: 0 });
  let v = lampsNow();
  assert.ok(v[0] > 40 && v[1] > 30 && v[2] > 20, "white on the left lamp (above): " + v);
  app.relics[0].y = 400;
  v = lampsNow();
  assert.ok(v[6] > 40 && v[7] > 30 && v[8] > 20, "white on the right lamp (below): " + v);
  app.relics.length = 0;
  app.voids.push({ x: app.p.x + 80, y: app.p.y + 5, r: 16, m: 999, s: 0 });
  let sawRed = false;
  for (let i = 0; i < 40; i++) { hold(app.p.x, 270); v = lampsNow(); if (v[3] > 40 && v[4] < 30) sawRed = true; }
  assert.ok(sawRed, "red on the middle lamp");
  const colourIn = (k, x) => {
    const { ctx: c2, app: a2 } = inRegion(k, 2);
    a2.voids.length = 0; a2.relics.length = 0; a2.anchors.length = 0; a2.addAnchor(x + 5000, 100, "steady");
    Object.assign(a2.p, { x, y: 270, vx: 420, vy: 0, a: null, lastId: 999 });
    a2.catchFlash = 0; a2.regFlash = 0; a2.bannerT = 0;
    a2.update(DT);
    return c2.calls.leds.at(-1);
  };
  const vi = colourIn(2, 10000), bl = colourIn(3, 14000), ye = colourIn(5, 23000), wh = colourIn(1, 6000), gr = colourIn(0, 2000);
  assert.ok(vi[0] > vi[1] && vi[2] > vi[1] * 2, "violet " + vi);
  assert.ok(bl[2] > bl[0] && bl[2] > bl[1], "blue " + bl);
  assert.ok(ye[0] > 50 && ye[1] > 40 && ye[2] < 5, "yellow " + ye);
  assert.ok(wh[0] > 50 && wh[1] > 40 && wh[2] > 30, "white " + wh);
  assert.ok(gr[1] > gr[0] * 3, "green " + gr);
  // A pulsing sun ahead: lit, the bar drains from the right; dark, only the middle lamp blinks.
  const { ctx: c3, app: a3 } = inRegion(5, 2);
  a3.voids.length = 0; a3.relics.length = 0; a3.anchors.length = 0;
  const pu = a3.addAnchor(a3.p.x + 220, 150, "pulse");
  pu.pu = { per: 3, ph: 0, duty: 0.6 };
  Object.assign(a3.p, { y: 270, vx: 0, vy: 0, a: null, lastId: -1, g: 1e-9 });
  a3.regFlash = 0; a3.catchFlash = 0; a3.bannerT = 0;
  const read = (clk) => { a3.p.clk = clk; a3.update(DT); a3.p.clk = clk; const l = c3.calls.leds.at(-1); return [sumOf(l, 0), sumOf(l, 1), sumOf(l, 2)]; };
  const early = read(0.05), late = read(1.6);
  assert.ok(early[0] > 0 && early[2] > 0, "all three lit soon after relighting: " + early);
  assert.ok(late[2] === 0 && late[0] > 0, "the bar has drained from the right: " + late);
  let mid = new Set();
  for (let k = 0; k < 30; k++) { const r = read(2.2 + k * 0.01); assert.ok(r[0] === 0 && r[2] === 0); mid.add(r[1] > 0); }
  assert.equal(mid.size, 2, "the middle lamp blinks while the sun is dark");
});

test("the hangar: a hold opens it, taps move, holds choose; locked things stay locked until feats unlock them", () => {
  const ctx = appContext({ seed: 5, progress: { schema: 2, far: 3, runs: 5, ft: ["chain5", "relic1", "near3"] } });
  const app = new Perihelion(ctx);
  assert.equal(app.phase, "title");
  app.down(); run(app, 0.7, null); app.up();
  assert.equal(app.phase, "hangar");
  const press = (s) => { app.down(); run(app, s, null); app.up(); };
  assert.equal(app.cur, 1);
  press(0.1); assert.equal(app.cur, 2);
  for (let i = 0; i < 8; i++) press(0.1);
  assert.equal(app.cur, 1);
  press(0.6);
  assert.equal(app.sv.sel.probe, 0, "BALLAST is locked at 3 feats");
  app.sv.ft.push("sling");
  press(0.6);
  assert.equal(app.sv.sel.probe, 1, "BALLAST unlocked at 4 feats");
  assert.equal(ctx.calls.saved.at(-1).sel.probe, 1, "the choice is saved");
  press(0.1);
  for (let i = 0; i < 6; i++) press(0.6);
  assert.equal(app.sv.sel.start, 2, "start region cycles through 0..3 only");
  const g = fakeCanvas();
  app.draw(g);
  while (app.cur !== 6) press(0.1);
  press(0.6); assert.equal(app.view, "feats");
  app.draw(g); press(0.1); assert.equal(app.page, 1); app.draw(g); press(0.1); press(0.1); press(0.6);
  assert.equal(app.view, "menu");
  press(0.1); press(0.6); assert.equal(app.view, "log");
  app.draw(g); press(0.1); assert.equal(app.view, "menu");
  press(0.1); press(0.6); assert.equal(app.view, "guide");
  for (let i = 0; i < 5; i++) { app.draw(g); press(0.1); }
  assert.equal(app.page, 0, "the guide's five pages wrap");
  press(0.6); assert.equal(app.view, "menu");
  press(0.1);
  assert.equal(app.cur, 0);
  press(0.6);
  assert.equal(app.phase, "play");
  assert.equal(app.probeIx, 1);
  assert.equal(app.p.g, 240 * 0.8);
  assert.ok(app.p.x > 9000 && app.reg === 2);
  app.crash("fall");
  run(app, 1, null);
  tap(app, 0.1);
  assert.equal(app.phase, "play", "a tap on the result screen launches again");
});

test("probes handle differently, and each can be flown by the planning bot", () => {
  const gs = [];
  for (const probe of [0, 1, 2]) {
    const { app } = inRegion(0, 31, { ft: FEATS_SOME, sel: { probe, start: 0, trail: 0 } });
    assert.equal(app.probeIx, probe);
    gs.push(app.p.g);
    const bot = makeBot(app);
    run(app, 40, (i) => bot(i));
    assert.equal(app.phase, "play", "probe " + probe + " survived 40 s: " + app.reason + " at " + Math.round(app.maxX));
    for (const k of ["x", "y", "vx", "vy", "phi", "om"]) assert.ok(Number.isFinite(app.p[k]));
  }
  assert.ok(gs[1] < gs[0] && gs[2] > gs[0]);
});

test("the daily run is the same world for the same date and a different one for another", () => {
  const worldOn = (key, seed) => {
    const ctx = appContext({ seed });
    const app = new Perihelion(ctx);
    app.dayKey = () => key;
    app.startDaily();
    app.extend(app.p.x + 3000);
    return JSON.stringify([app.anchors.map((a) => [a.x, a.y, a.kind]), app.voids.map((v) => [v.x, v.y])]);
  };
  assert.equal(worldOn("2026-10-01", 1), worldOn("2026-10-01", 999), "independent of the console's generator");
  assert.notEqual(worldOn("2026-10-01", 1), worldOn("2026-10-02", 1));
  assert.deepEqual(dailyGoal("2026-10-01"), dailyGoal("2026-10-01"));
  const kinds = new Set();
  for (let d = 1; d <= 28; d++) kinds.add(dailyGoal("2026-11-" + String(d).padStart(2, "0")).kind);
  assert.equal(kinds.size, 4, "all four goals come up");
  const ctx = appContext({ seed: 2, best: 300, progress: { schema: 2, far: 1, runs: 4 } });
  const app = new Perihelion(ctx);
  app.dayKey = () => "2026-10-01";
  app.startDaily();
  assert.ok(app.daily && app.startReg === 0);
  app.R.relics = 9; app.bestChain = 99; app.catches = 999; app.R.far = 5;
  app.scoreRaw = 500;
  app.crash("fall");
  run(app, 1, null);
  assert.ok(app.goalDone);
  assert.equal(ctx.calls.score.length, 0, "a daily run does not raise the console's best distance");
  const saved = ctx.calls.saved.at(-1);
  assert.equal(saved.dl.d, "2026-10-01");
  assert.equal(saved.dl.best, 500);
  assert.equal(saved.dl.streak, 1);
  assert.ok(saved.ft.includes("daily"));
});

test("reaching the perihelion ends the run as an arrival with a bonus, a feat and a saved count", () => {
  const { ctx, app } = inRegion(5, 17);
  Object.assign(app.p, { x: 27990, y: 250, vx: 300, vy: 0 });
  app.maxX = 27990; app.front = 27000;
  const s0 = app.scoreRaw;
  run(app, 0.2, null);
  assert.equal(app.phase, "over");
  assert.equal(app.reason, "arrived");
  assert.ok(app.scoreRaw >= s0 + 400);
  run(app, 1, null);
  const saved = ctx.calls.saved.at(-1);
  assert.equal(saved.st.arrivals, 1);
  assert.ok(saved.ft.includes("arrive"));
  assert.equal(saved.last.reason, "THE PERIHELION IS REACHED");
  assert.equal(ctx.calls.score.length, 0, "a run begun in a later region is not a console record");
  run(app, 3, null);
  app.draw(fakeCanvas());
  assert.ok(ctx.calls.leds.at(-1).some((x) => x > 0), "the arrival glows");
});

test("regions are announced once, with a banner, a flash and a motif; crossing times are kept", () => {
  const { ctx, app } = inRegion(0, 41, { far: 0 });
  Object.assign(app.p, { x: 4990, y: 250, vy: -60 });
  app.maxX = 4990; app.front = 4000;
  run(app, 0.3, null);
  assert.equal(app.reg, 1);
  assert.ok(app.bannerT > 0 && /CLUSTER/.test(app.notice));
  assert.ok(Math.max(...ctx.calls.leds.slice(-15).flat()) > 40);
  assert.equal(app.sv.far, 1);
  run(app, 0.8, null);
  assert.deepEqual(ctx.calls.tone.filter((t) => t[1] === 0.22).map((t) => t[0]), [440, 523, 659], "the region's motif of three notes, once");
  app.draw(fakeCanvas());
  app.runT = 40; app.regT = 10; app.catches = 9; app.regC = 0;
  Object.assign(app.p, { x: 8995, y: 250, vy: -60 });
  app.maxX = 8995; app.front = 8000;
  run(app, 0.3, null);
  assert.equal(app.reg, 2);
  assert.equal(app.cross.at(-1)[0], 1);
  assert.ok(app.sv.rb[1] > 0);
  assert.equal(app.R.fast1, 1, "crossed the cluster on few catches");
});

test("every region draws within the primitive budget and the result screen draws", () => {
  for (let k = 0; k <= 5; k++) {
    const { app } = inRegion(k, 50 + k);
    run(app, 1.5, null);
    app.extend(app.p.x + 1500);
    const g = fakeCanvas();
    app.draw(g);
    const prims = Object.values(g.count).reduce((a, b) => a + b, 0);
    assert.ok(prims < 400, `region ${k} primitives ${prims}`);
    app.crash("void");
    app.deadT = 1;
    app.draw(g);
  }
});

test("the menu gesture (tap, tap, hold, cancel) takes back every new piece of state", () => {
  const { ctx, app } = inRegion(1, 61);
  app.p.g = 1e-9; app.p.vy = 0;
  run(app, 2, null);
  app.relics.push({ x: app.p.x + 45, y: app.p.y, got: 0 });
  const before = snapOf(app), rng0 = ctx.rng.state, saves = ctx.calls.saved.length;
  for (let i = 0; i < 2; i++) { app.down(); run(app, 0.07, null); app.up(); run(app, 0.05, null); }
  app.down();
  run(app, 1.1, null); // the hold: a relic is collected, feats may be earned
  app.sv.far = 5; app.sv.ft.push("sling");
  app.cancel();
  assert.equal(snapOf(app), before);
  assert.equal(ctx.rng.state, rng0);
  assert.equal(ctx.calls.saved.length, saves, "nothing saved by the gesture");
  for (const where of ["title", "over", "hangar"]) {
    const c2 = appContext({ seed: 62, progress: { schema: 2, far: 2, runs: 5 } });
    const a2 = new Perihelion(c2);
    if (where === "over") { a2.launches = 1; a2.down(); a2.up(); a2.crash("fall"); run(a2, 1, null); }
    if (where === "hangar") { a2.down(); run(a2, 0.7, null); a2.up(); }
    const b2 = snapOf(a2);
    for (let i = 0; i < 2; i++) { a2.down(); run(a2, 0.07, null); a2.up(); run(a2, 0.05, null); }
    a2.down(); run(a2, 1.1, null);
    a2.cancel();
    assert.equal(snapOf(a2), b2, where);
  }
});

test("a long run keeps every list bounded, the numbers finite, and the save small", () => {
  const bot = botRun(202, 300);
  assert.equal(bot.nan, false);
  const { app } = bot;
  assert.ok(app.anchors.length < 40 && app.voids.length <= 30 && app.relics.length <= 12 && app.sq.length <= 12);
  assert.ok(JSON.stringify(app.sv).length < 4096, "save size " + JSON.stringify(app.sv).length);
});
