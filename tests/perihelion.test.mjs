import test from "node:test";
import assert from "node:assert/strict";
import { Perihelion } from "../web/apps/perihelion.js";
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
    if (!a) continue;
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
  let nan = false, maxAnchors = 0, maxVoids = 0;
  run(app, seconds, (i) => {
    stepper?.(i);
    if (i % 30 === 0) {
      maxAnchors = Math.max(maxAnchors, app.anchors.length);
      maxVoids = Math.max(maxVoids, app.voids.length);
      for (const k of ["x", "y", "vx", "vy", "phi", "om"]) if (!Number.isFinite(app.p[k])) nan = true;
    }
  });
  return { ctx, app, nan, maxAnchors, maxVoids };
}

test("a planning bot survives five simulated minutes on several seeds and far outscores an idle probe", () => {
  const rows = [];
  for (const [seed, seconds] of [[11, 300], [202, 150], [3003, 120]]) {
    const bot = botRun(seed, seconds);
    const idle = play(seed, 120, null);
    rows.push({ seed, phase: bot.app.phase, reason: bot.app.reason, score: Math.floor(bot.app.scoreRaw), chain: bot.app.bestChain, catches: bot.app.catches, maxX: Math.round(bot.app.maxX), idleScore: Math.floor(idle.app.scoreRaw), idlePhase: idle.app.phase });
    assert.equal(bot.nan, false);
    assert.equal(bot.app.phase, "play", `bot survived seed ${seed}: ${JSON.stringify(rows.at(-1))}`);
    assert.equal(idle.app.phase, "over");
    assert.ok(Math.floor(bot.app.scoreRaw) > 20 * Math.max(1, Math.floor(idle.app.scoreRaw)));
    assert.ok(bot.app.catches > seconds * 0.3, "catches " + bot.app.catches);
  }
  if (process.env.PERI_REPORT) console.log(JSON.stringify(rows, null, 1));
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

test("the reticle names the nearest sun ahead or above and ignores suns behind or below", () => {
  const { app } = start({ seed: 2 });
  app.anchors.length = 0;
  const add = (x, y) => app.addAnchor(x, y, "steady");
  const near = add(300, 100), far = add(400, 150), behind = add(80, 200), below = add(250, 400);
  const p = { x: 200, y: 200, vx: 0, vy: 0, lastId: -1 };
  assert.equal(app.pickTarget(p), near); // |(100,-100)| = 141 vs far 206
  near.dead = true;
  assert.equal(app.pickTarget(p), far);
  assert.notEqual(app.pickTarget(p), behind);
  assert.notEqual(app.pickTarget(p), below);
  p.lastId = far.id;
  assert.equal(app.pickTarget(p), null);
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
  const r = botRun(11, 300);
  assert.ok(r.maxAnchors < 40 && r.maxVoids <= 24, `anchors ${r.maxAnchors} voids ${r.maxVoids}`);
  assert.ok(r.app.maxX > 10000, "went a long way: " + r.app.maxX);
  assert.ok(r.app.anchors[0].x > r.app.maxX - 1500);
  const g = fakeCanvas();
  r.app.draw(g);
  const prims = Object.values(g.count).reduce((a, b) => a + b, 0);
  assert.ok(prims < 400, "primitives per frame: " + prims);
});

test("a chain of quick clean releases raises the multiplier; a stray tap does not", () => {
  const r = botRun(202, 150);
  assert.ok(r.app.bestChain >= 6, "best chain " + r.app.bestChain);
  assert.equal(r.app.multiplier() >= 1, true);
  const { app } = start({ seed: 3 });
  app.chain = 4;
  assert.equal(app.multiplier(), 3);
  app.chain = 0;
  assert.equal(app.multiplier(), 1);
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
