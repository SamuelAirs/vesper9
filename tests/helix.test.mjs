import test from "node:test";
import assert from "node:assert/strict";
import { Helix, FEATS, FIELDS, MODES, migrateSave, dailyGoal } from "../web/apps/helix.js";
import { appContext, fakeCanvas, run } from "./helpers/app-context.mjs";

const W = Helix.W, H = Helix.H;
const SEEN = new Uint32Array(W * H * 4 * 128); // (cell, heading, step) marks; a search owns one stamp value
let stamp = 0;
const SEEN2 = new Uint32Array(W * H * 4 * 128); // the same, for the nested room() search
let stamp2 = 0;
const key = (c, dir, d) => (c * 4 + dir) * 128 + Math.min(d, 127);
const SAFE = 30; // moves of room the bot wants after each fragment
const lampsOk = (ctx) => ctx.calls.leds.every((v) => v.length === 9 && v.every((x) => Number.isInteger(x) && x >= 0 && x <= 255));
const dark = (v) => v.every((x) => x === 0);
const tap = (app) => { app.down(); app.up(); };
const holdLeft = (app) => { app.down(); run(app, app.leftHold + 0.02); app.up(); };
const start = (seed = 1, options = {}) => {
  const ctx = appContext({ seed, ...options });
  const app = new Helix(ctx);
  tap(app);
  run(app, 1.3); // past the READY pause
  return { ctx, app };
};

// A planning bot with its own copy of the rules: it searches over (cell, heading), with the turns
// the mode allows each step, using the game's own neighbour rule (walls, wrapping, portals) and the
// trail blocked until the tail has passed it. It heads for the fragment (or a timed one). `careful`
// also demands that the plan ends with room to keep moving.
function blocker(app) {
  const trail = app.trail;
  return (c, d) => {
    if (app.obs[c]) return true;
    const k = trail.indexOf(c);
    return k >= 0 && d < k + 1 + app.pending;
  };
}
function plan(app, targets, careful, safe = SAFE) {
  const hc = app.head, block = blocker(app), turns = app.turns;
  stamp++;
  SEEN[key(hc, app.dir, 0)] = stamp;
  const queue = [{ c: hc, dir: app.dir, d: 0, first: null }];
  const forced = app.queue.length;
  for (let qi = 0; qi < queue.length;) {
    const s = queue[qi++];
    if (s.d > 50) continue;
    if (s.d > 0 && targets.includes(s.c) && (!careful || room(app, s, (c, d) => block(c, d - 2), safe))) return s.first;
    for (const turn of s.d < forced ? [app.queue[s.d]] : turns) {
      const dir = (s.dir + turn + 4) & 3;
      const c = app.nb(s.c, dir);
      if (c < 0 || block(c, s.d + 1) || SEEN[key(c, dir, s.d + 1)] === stamp) continue;
      SEEN[key(c, dir, s.d + 1)] = stamp;
      queue.push({ c, dir, d: s.d + 1, first: s.first === null ? turn : s.first });
    }
  }
  return null;
}
// After reaching the target, can the thread still make `safe` more moves?
function room(app, s, block, safe) {
  stamp2++;
  SEEN2[key(s.c, s.dir, s.d)] = stamp2;
  const queue = [{ c: s.c, dir: s.dir, d: s.d }];
  for (let qi = 0; qi < queue.length;) {
    const t = queue[qi++];
    if (t.d >= s.d + safe) return true;
    for (const turn of app.turns) {
      const dir = (t.dir + turn + 4) & 3;
      const c = app.nb(t.c, dir);
      if (c < 0 || block(c, t.d + 1) || SEEN2[key(c, dir, t.d + 1)] === stamp2) continue;
      SEEN2[key(c, dir, t.d + 1)] = stamp2;
      queue.push({ c, dir, d: t.d + 1 });
    }
  }
  return false;
}
// The first move from which the thread can live longest.
function survive(app) {
  const hc = app.head, block = blocker(app);
  let best = -1, bestMove = 0;
  for (const first of app.queue.length ? [app.queue[0]] : app.turns) {
    const dir0 = (app.dir + first + 4) & 3, c0 = app.nb(hc, dir0);
    if (c0 < 0 || block(c0, 1)) continue;
    stamp++;
    SEEN[key(c0, dir0, 1)] = stamp;
    const queue = [{ c: c0, dir: dir0, d: 1 }];
    let depth = 1;
    for (let qi = 0; qi < queue.length && depth < 60;) {
      const t = queue[qi++];
      depth = Math.max(depth, t.d);
      for (const turn of app.turns) {
        const dir = (t.dir + turn + 4) & 3, c = app.nb(t.c, dir);
        if (c < 0 || block(c, t.d + 1) || SEEN[key(c, dir, t.d + 1)] === stamp) continue;
        SEEN[key(c, dir, t.d + 1)] = stamp;
        queue.push({ c, dir, d: t.d + 1 });
      }
    }
    if (depth > best) { best = depth; bestMove = first; }
  }
  return bestMove;
}

// Plays through the real button: a right turn is a tap, a left turn a press held until the game
// recognises it (the step waits for it).
function bot(app, seconds, { careful = true, useBonus = true, onStep } = {}) {
  let last = -1, holding = false;
  run(app, seconds, () => {
    if (holding) { if (!app.leftArmed) { app.up(); holding = false; } return; }
    if (app.phase !== "play" || app.steps === last || app.ready > 0) return;
    last = app.steps;
    onStep?.(app);
    const targets = [app.frag];
    // The timed fragment is only worth it when the bot can still get out afterwards.
    if (useBonus && app.bonus && plan(app, [app.bonus.c], true) !== null) targets.unshift(app.bonus.c);
    let move = plan(app, targets, careful);
    for (const safe of [16, 8, 3]) if (move === null && careful) move = plan(app, targets, true, safe);
    if (move === null && careful) move = plan(app, targets, false);
    if (move === null) move = survive(app); // no route to a target: stay alive as long as possible
    if (app.queue.length) return;
    if (move === 1) tap(app);
    else if (move === -1) { app.down(); holding = true; }
  });
}

test("a planning bot collects many fragments in a row and far outscores an idle player, in both turn modes", () => {
  const rows = [];
  for (const [seed, mode] of [[1, 0], [2, 0], [4, 0], [1, 1], [2, 1]]) {
    const app = new Helix(appContext({ seed, progress: { schema: 2, sel: { mode } } }));
    tap(app);
    bot(app, 240);
    rows.push([seed, MODES[mode].name, app.phase, app.frags, app.score, app.maxLen, app.level, app.steps]);
  }
  const idle = new Helix(appContext({ seed: 1 }));
  tap(idle);
  run(idle, 60);
  console.log("bot [seed, mode, phase, fragments, score, longest, milestone, steps]:\n" + rows.map((r) => r.join(", ")).join("\n"));
  console.log(`idle: ${idle.phase} after ${idle.steps} steps, score ${idle.score}, cause ${idle.cause}`);
  assert.equal(idle.phase, "over");
  assert.ok(idle.score <= 30, "idle score " + idle.score);
  const twin = rows.filter((r) => r[1] === "TWIN").map((r) => r[3]).sort((a, b) => a - b);
  assert.ok(twin[0] >= 20, "worst twin seed: " + JSON.stringify(rows));
  assert.ok(twin[1] >= 50, "median twin fragments " + JSON.stringify(rows));
  assert.ok(rows.some((r) => r[6] >= 10), "some seed reaches milestone 10");
  assert.ok(rows.filter((r) => r[1] === "SPIRAL").every((r) => r[3] >= 10), "spiral bot " + JSON.stringify(rows));
});

test("every spawned fragment is reachable at the moment it appears, with portals and in both modes", () => {
  for (const mode of [0, 1]) {
    const app = new Helix(appContext({ seed: 9, progress: { schema: 2, sel: { mode } } }));
    tap(app);
    let checked = 0, bad = 0, lastFrag = -2;
    bot(app, 150, {
      onStep(a) {
        if (a.frag !== lastFrag) {
          lastFrag = a.frag;
          checked++;
          if (a.frag >= 0 && plan(a, [a.frag], false) === null) bad++;
        }
      },
    });
    assert.ok(checked > 20, "checked " + checked);
    assert.equal(bad, 0);
  }
});

test("an idle player loses by the boundary; the run is scored and saved once", () => {
  const ctx = appContext({ seed: 3 });
  const app = new Helix(ctx);
  tap(app);
  for (let i = 0; i < 40 * 60 && app.phase === "play"; i++) app.update(1 / 60);
  assert.equal(app.phase, "over");
  assert.equal(app.cause, "WALL");
  run(app, 0.5);
  assert.equal(ctx.calls.score.length, 1);
  assert.equal(ctx.calls.saved.length, 1);
  assert.deepEqual(Object.keys(ctx.calls.saved[0].last).sort(), ["fragments", "longest", "milestone", "score"]);
  assert.equal(ctx.calls.saved[0].schema, 2);
  tap(app); // too soon after the end
  assert.equal(app.phase, "over");
  run(app, 1);
  tap(app);
  assert.equal(app.phase, "play");
  assert.equal(ctx.calls.saved.length, 1);
});

test("TWIN: a tap turns right at the next step, a held press turns left; two taps make a U-turn", () => {
  const { app } = start(2);
  assert.equal(app.dir, 0);
  tap(app);
  tap(app);
  assert.deepEqual(app.queue, [1, 1]);
  const s0 = app.steps;
  run(app, app.interval * 1.02);
  assert.equal(app.steps, s0 + 1);
  assert.equal(app.dir, 1, "first tap applied at the next step");
  assert.equal(app.queue.length, 1, "second tap waits for the step after");
  run(app, app.interval);
  assert.equal(app.dir, 2, "west after two right turns");
  holdLeft(app);
  run(app, app.interval * 1.02);
  assert.equal(app.dir, 1, "a held press turned left (west to south)");
});

test("TWIN: the step waits for an undecided press, so a left turn is never a step late", () => {
  const { app } = start(3);
  run(app, app.interval * 0.9);
  const s0 = app.steps, d0 = app.dir;
  app.down();
  run(app, app.leftHold - 0.03); // a step was due in this time
  assert.equal(app.steps, s0, "the thread stepped while the press was undecided");
  run(app, 0.05); // recognised as a left turn, and the waiting step happens with it
  assert.equal(app.steps, s0 + 1);
  assert.equal(app.dir, (d0 + 3) & 3);
  app.up();
  assert.equal(app.queue.length, 0, "the release added a turn");
  // The left-turn hold follows the console's gesture pace.
  assert.ok(Helix.leftHold({ gesturePace: "relaxed" }) > Helix.leftHold({ gesturePace: "quick" }));
});

test("SPIRAL: every press turns clockwise at once, as in the first release", () => {
  const { app } = start(2, { progress: { schema: 2, sel: { mode: 1 } } });
  app.down();
  assert.deepEqual(app.queue, [1], "the turn waits for nothing");
  run(app, 0.4);
  app.up();
  assert.equal(app.dir, 1);
  for (let i = 0; i < 3; i++) { tap(app); run(app, app.interval * 1.01); }
  assert.equal(app.dir, 0, "three more right turns: east again");
});

test("the queue is bounded and presses before the first step do nothing", () => {
  const app = new Helix(appContext({ seed: 2 }));
  tap(app);
  tap(app); tap(app);
  assert.equal(app.queue.length, 0);
  run(app, 1.3);
  for (let i = 0; i < 20; i++) tap(app);
  assert.equal(app.queue.length, 3);
});

test("three quick taps then cancel() do not end the run and leave lamps off", () => {
  const { ctx, app } = start(4);
  tap(app); tap(app); tap(app);
  app.cancel();
  assert.equal(app.phase, "play");
  assert.equal(app.queue.length, 0);
  assert.ok(dark(ctx.calls.leds.at(-1)));
  run(app, 0.5);
  assert.equal(app.phase, "play");
});

test("dispose() mid-play leaves the lamps off", () => {
  const { ctx, app } = start(6);
  run(app, 1);
  app.dispose();
  assert.ok(dark(ctx.calls.leds.at(-1)));
});

test("bearing: right lamp for the head's right, left lamp for its left, middle ahead; behind lights both in TWIN", () => {
  const b = Helix.bearing;
  assert.equal(b(10, 6, 0, 10, 9).lamp, 2, "heading east, south is the right");
  assert.equal(b(10, 6, 0, 16, 6).lamp, 1);
  assert.equal(b(10, 6, 0, 16, 7).lamp, 1, "a shallow angle still counts as ahead");
  assert.equal(b(10, 6, 0, 10, 2).lamp, 0);
  assert.equal(b(10, 6, 0, 4, 6).lamp, -1, "directly behind: either way");
  assert.equal(b(10, 6, 0, 4, 6, false).lamp, 0, "SPIRAL: directly behind counts as left");
  assert.equal(b(10, 6, 0, 8, 9).lamp, 2, "behind and to the right: a tap helps");
  assert.equal(b(10, 6, 1, 4, 6).lamp, 2, "heading south, west is the right");
  assert.equal(b(10, 6, 3, 14, 6).lamp, 2, "heading north, east is the right");
  assert.equal(b(10, 6, 0, 13, 6).dist, 3);
});

test("the finder lights only the bearing lamp and is brighter when closer", () => {
  const { ctx, app } = start(8);
  const hc = app.head;
  const b = Helix.bearing(hc % W, (hc / W) | 0, app.dir, app.frag % W, (app.frag / W) | 0);
  assert.ok(!app.danger(2));
  const v = app.lampValues();
  const lit = [0, 1, 2].filter((i) => v[i * 3] + v[i * 3 + 1] + v[i * 3 + 2] > 0);
  assert.deepEqual(lit, b.lamp < 0 ? [0, 2] : [b.lamp]);
  const far = Math.max(...v);
  app.frag = hc + 3 < W * H ? hc + 3 : hc - 3;
  const near = Math.max(...app.lampValues());
  assert.ok(near >= far, `near ${near} far ${far}`);
  assert.ok(lampsOk(ctx));
});

test("danger: all three lamps pulse red when a wall is two steps ahead", () => {
  const { ctx, app } = start(8);
  app.runT = Helix.GRACE; // the walls are live from here on
  let sawRed = 0;
  for (let i = 0; i < 900 && app.phase === "play"; i++) {
    app.update(1 / 60);
    const l = ctx.calls.leds.at(-1);
    if (app.phase === "play" && app.danger(2)) {
      for (let k = 0; k < 3; k++) assert.ok(l[k * 3] > 0 && l[k * 3 + 1] * 8 < l[k * 3] && l[k * 3 + 2] === 0, "red on lamp " + k + ": " + l);
      sawRed++;
    }
  }
  assert.ok(sawRed > 3, "red frames " + sawRed);
  assert.equal(app.phase, "over");
  run(app, 2);
  assert.ok(dark(ctx.calls.leds.at(-1)), "dark on the result screen");
});

test("a collected fragment gives a green accent and a milestone runs a chase", () => {
  const { ctx, app } = start(3);
  app.collect();
  app.update(1 / 60);
  const l = ctx.calls.leds.at(-1);
  if (!app.danger(2)) assert.ok(l[1] > l[0] && l[4] > l[3] && l[7] > l[6], "green accent " + l);
  for (let i = 0; i < 4; i++) app.collect();
  assert.equal(app.level, 1);
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    app.update(1 / 60);
    if (app.danger(2)) break;
    const greens = ctx.calls.leds.at(-1).filter((_, j) => j % 3 === 1);
    seen.add(greens.indexOf(Math.max(...greens)));
  }
  assert.ok(seen.size >= 2 || app.danger(2), "chase moves across lamps");
});

test("combo: a fragment taken quickly raises the multiplier, a slow one resets it", () => {
  const { app } = start(5);
  app.fragBorn = app.steps; app.fragPar = 5;
  app.collect();
  assert.equal(app.combo, 2);
  const s = app.score;
  app.fragBorn = app.steps; app.fragPar = 5;
  app.collect();
  assert.equal(app.combo, 3);
  assert.equal(app.score - s, 30, "x3 on a 10-point fragment");
  app.fragBorn = app.steps - 30; app.fragPar = 5;
  app.collect();
  assert.equal(app.combo, 1);
  assert.equal(app.R.comboBest, 3);
});

test("long bot run: lamps valid and varied, no NaN, lists bounded, draw never throws", () => {
  const ctx = appContext({ seed: 12 });
  const app = new Helix(ctx);
  const g = fakeCanvas();
  app.draw(g);
  tap(app);
  let maxTrail = 0;
  bot(app, 240, {
    onStep(a) {
      maxTrail = Math.max(maxTrail, a.trail.length);
      for (const k of ["score", "t", "dir", "frags", "level", "pending", "sinceCollect", "interval", "acc", "combo"]) assert.ok(Number.isFinite(a[k]), k);
      a.draw(g);
    },
  });
  assert.ok(lampsOk(ctx));
  assert.ok(new Set(ctx.calls.leds.map((x) => x.join())).size > 20);
  assert.ok(maxTrail <= 40);
  assert.ok(app.nObs <= 14);
  assert.ok(app.queue.length <= 3);
  app.update(NaN); app.update(-1); app.update(Infinity);
  app.draw(g);
  app.pause(); app.cancel(); app.dispose();
});

test("progression: timed fragments, obstacles, a phase pickup and portals all appear and are used", () => {
  const seen = { bonus: 0, obs: 0, pickup: false, portals: false, through: 0 };
  for (const seed of [3, 4]) {
    const app = new Helix(appContext({ seed }));
    tap(app);
    bot(app, 300, {
      onStep(a) {
        if (a.bonus) seen.bonus++;
        seen.obs = Math.max(seen.obs, a.nObs);
        if (a.pickup !== null) seen.pickup = true;
        if (a.portals) seen.portals = true;
        seen.through = Math.max(seen.through, a.R.portals);
      },
    });
  }
  console.log("progression", JSON.stringify(seen));
  assert.ok(seen.bonus > 0 && seen.obs >= 2 && seen.pickup && seen.portals);
});

test("a portal carries the head to its twin, heading unchanged", () => {
  const { app } = start(2);
  const hc = app.head, x = hc % W, y = (hc / W) | 0;
  const a = y * W + x + 1, b = 2 * W + 15;
  app.portals = [a, b];
  app.queue.length = 0;
  app.dir = 0;
  app.step();
  assert.equal(app.head, b);
  assert.equal(app.dir, 0);
  assert.equal(app.R.portals, 1);
  assert.equal(app.phase, "play");
});

test("a timed fragment expires and is removed", () => {
  const { app } = start(3);
  app.level = 1;
  app.bonus = { c: app.spawnCell(4, 20), life: 1, max: 1 };
  assert.ok(app.bonus.c >= 0);
  run(app, 0.5);
  assert.ok(app.bonus || app.phase !== "play");
  run(app, 0.6);
  assert.equal(app.bonus, null);
});

test("phase: crossing the trail with a charge consumes it instead of dying", () => {
  const { app } = start(7);
  app.charge = 1;
  app.pending = 30; // the tail stays put while the head loops back into the body
  while (app.charge === 1 && app.phase === "play" && app.steps < 80) { tap(app); run(app, app.interval * 1.01); }
  assert.equal(app.charge, 0, "charge was used by a crossing or never needed");
  assert.equal(app.R.phased, 1);
  const b = start(7).app;
  b.pending = 30;
  for (let i = 0; i < 80 && b.phase === "play"; i++) { tap(b); run(b, b.interval * 1.01); }
  assert.equal(b.phase, "over");
  assert.equal(b.cause, "TRAIL");
});

test("milestones come every five fragments; speed rises with length; tail shortens while starved", () => {
  const { app } = start(3);
  assert.equal(app.interval, 0.24);
  for (let i = 0; i < 12; i++) app.collect();
  assert.equal(app.level, 2);
  assert.ok(app.frag >= 0);
  const long = [...app.trail];
  while (app.trail.length < 30) app.trail.push(long[0]);
  assert.equal(app.interval, 0.1, "fastest pace");
  const mid = app.interval;
  app.trail.length = 10;
  assert.ok(app.interval > mid);
  const s = start(10).app;
  s.pending = 0;
  s.trail.unshift(s.trail[0], s.trail[0]);
  s.cnt[s.trail[0]] += 2;
  const len = s.trail.length;
  s.sinceCollect = 12;
  run(s, s.interval * 8);
  assert.ok(s.trail.length < len || s.phase !== "play");
});

test("for the first twenty seconds the boundary turns the thread instead of killing it", () => {
  const ctx = appContext({ seed: 3 });
  const app = new Helix(ctx);
  tap(app);
  let wallTurns = 0, lastDir = app.dir;
  run(app, 1.2 + 19.5, () => {
    if (app.phase === "play" && app.ready <= 0) {
      if (app.dir !== lastDir) wallTurns++;
      lastDir = app.dir;
    }
  });
  assert.equal(app.phase, "play", "an idle newcomer is still alive at 19 s");
  assert.ok(wallTurns >= 3, "the wall turned the thread " + wallTurns + " times");
  assert.ok(lampsOk(ctx));
  app.draw(fakeCanvas());
  run(app, 15);
  assert.equal(app.phase, "over");
  assert.equal(app.cause, "WALL");
});

test("the soft wall turns a corner, and never into the trail", () => {
  const { app } = start(2);
  app.trail.length = 0;
  app.cnt.fill(0);
  app.pending = 0;
  const corner = (H - 1) * W + (W - 1);
  for (const c of [corner - 2 * W, corner - W, corner]) app.pushHead(c); // arrived from the north
  app.dir = 0;
  app.queue.length = 0;
  app.frag = 0;
  app.step();
  assert.equal(app.phase, "play");
  assert.equal(app.dir, 2, "east at the corner: south is a wall and north is the trail, so west");
  assert.equal(app.head, corner - 1);
  assert.equal(app.danger(2), "");
});

test("the countdown shows during the grace and the walls announce when they go live", () => {
  const app = new Helix(appContext({ seed: 5 }));
  tap(app);
  const texts = [];
  const spy = new Proxy(fakeCanvas(), { get(o, k) { return k === "fillText" ? (t) => texts.push(t) : o[k]; } });
  run(app, 3);
  app.draw(spy);
  assert.ok(texts.some((t) => /WALLS ARE SOFT FOR \d+ S/.test(t)), texts.join("|"));
  app.runT = Helix.GRACE - 0.01;
  app.trail.length = 0; app.cnt.fill(0);
  for (const c of [W * 6 + 3, W * 6 + 4, W * 6 + 5]) app.pushHead(c);
  app.dir = 0;
  run(app, 0.1);
  assert.match(app.news, /LIVE/);
});

test("a long hold freezes the world until release, so the menu hold cannot cost the run", () => {
  const { app } = start(6);
  app.runT = Helix.GRACE;
  app.down();
  run(app, Helix.FREEZE_AFTER + 0.2);
  const at = [app.steps, app.head, app.runT];
  assert.ok(app.frozen);
  run(app, 3);
  assert.deepEqual([app.steps, app.head, app.runT], at, "nothing moves while held");
  app.draw(fakeCanvas());
  app.up();
  assert.ok(!app.frozen);
  run(app, 0.5);
  assert.ok(app.steps > at[0], "runs on after release");
  app.down(); run(app, 1); app.cancel();
  assert.ok(!app.frozen);
});

test("TORUS wraps the edges; LATTICE has pillars; both are locked until enough feats", () => {
  const ctx = appContext({ seed: 2, progress: { schema: 2, ft: ["m3", "len", "phase"], sel: { field: 1 } } });
  const app = new Helix(ctx);
  assert.equal(app.field, 1);
  tap(app);
  run(app, 1.3);
  app.runT = Helix.GRACE;
  run(app, 12); // idle: straight across the right edge and back in on the left
  assert.equal(app.phase, "play", "the torus edge killed the thread");
  assert.ok(app.steps > W);
  const lat = new Helix(appContext({ progress: { schema: 2, ft: FEATS.slice(0, 6).map((f) => f.id), sel: { field: 2 } } }));
  assert.ok(lat.obs.reduce((a, b) => a + b, 0) >= 8, "no pillars");
  assert.equal(migrateSave({ ft: ["m3"], sel: { field: 2 } }).sel.field, 0, "a locked field stayed selected");
  assert.ok(FIELDS[1].need < FIELDS[2].need);
});

test("the hangar: tap moves, hold chooses; turns and fields cycle; feats and log page; a non-open field is not scored", () => {
  const ctx = appContext({ seed: 11, progress: { schema: 2, runs: 4, ft: ["m3", "len", "phase"] } });
  const app = new Helix(ctx);
  const hold = () => { app.down(); run(app, 0.6); app.up(); };
  hold();
  assert.equal(app.phase, "hangar");
  tap(app); hold(); // TURNS
  assert.equal(app.sv.sel.mode, 1);
  hold();
  assert.equal(app.sv.sel.mode, 0);
  tap(app); hold(); // FIELD
  assert.equal(app.sv.sel.field, 1, "TORUS is open with three feats");
  hold();
  assert.equal(app.sv.sel.field, 0, "LATTICE was chosen without six feats");
  hold();
  tap(app); tap(app); hold(); // FEATS
  assert.equal(app.view, "feats");
  tap(app); assert.equal(app.page, 1);
  hold(); assert.equal(app.view, "menu");
  tap(app); hold(); // LOG
  assert.equal(app.view, "log");
  const g = fakeCanvas();
  app.draw(g);
  tap(app); assert.equal(app.view, "menu");
  for (const view of ["feats", "menu"]) { app.view = view; app.draw(g); }
  tap(app); hold(); // PLAY, on the torus
  assert.equal(app.phase, "play");
  assert.equal(app.field, 1);
  app.die("TRAIL"); run(app, 1);
  assert.equal(ctx.calls.score.length, 0, "a torus run set the console best");
  assert.ok(ctx.calls.saved.length >= 4);
});

test("the daily run is the same for everyone on the same date, TWIN on the open field, and keeps a streak", () => {
  const goal = dailyGoal("2026-10-01");
  assert.deepEqual(goal, dailyGoal("2026-10-01"));
  const frags = (seed) => {
    const app = new Helix(appContext({ seed, progress: { schema: 2, ft: FEATS.map((f) => f.id), sel: { mode: 1, field: 2 } } }));
    app.daily = true; app.begin();
    assert.equal(app.mode, 0); assert.equal(app.field, 0);
    const out = [app.frag];
    for (let i = 0; i < 6; i++) { app.collect(); out.push(app.frag); }
    return out;
  };
  assert.deepEqual(frags(1), frags(2), "the daily layout differs between two launches");
  const now = new Date();
  const ymd = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const yesterday = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const ctx = appContext({ seed: 3, progress: { schema: 2, dl: { d: yesterday, done: 1, streak: 4, last: yesterday } } });
  const app = new Helix(ctx);
  app.daily = true; app.begin();
  app.goalMet = () => true;
  app.die("WALL"); run(app, 1);
  assert.equal(app.sv.dl.d, ymd(now));
  assert.equal(app.sv.dl.streak, 5);
  assert.ok(app.sv.ft.includes("daily"));
  assert.equal(ctx.calls.score.length, 0, "a daily run set the console best");
});

test("a first-release save migrates: runs, last result and milestone kept", () => {
  const old = { schema: 1, runs: 12, last: { score: 140, fragments: 9, longest: 14, milestone: 1 }, milestone: 3 };
  const s = migrateSave(old);
  assert.equal(s.schema, 2);
  assert.equal(s.runs, 12);
  assert.deepEqual(s.last, old.last);
  assert.equal(s.milestone, 3);
  assert.deepEqual(s.sel, { mode: 0, field: 0 });
  assert.deepEqual(migrateSave(s), s, "migration is not idempotent");
  for (const junk of [null, undefined, 7, "x", [], { runs: -1, bm: "no", sel: { mode: 9, field: -4 }, ft: ["x", "m3", "m3"] }]) {
    const m = migrateSave(junk);
    assert.equal(m.schema, 2);
    assert.ok(m.runs >= 0 && m.sel.mode >= 0 && m.sel.mode < MODES.length && m.sel.field === 0);
    assert.equal(m.bm.length, MODES.length);
  }
  assert.deepEqual(migrateSave({ ft: ["x", "m3", "m3"] }).ft, ["m3"]);
  const ctx = appContext({ seed: 4, progress: old });
  const app = new Helix(ctx);
  tap(app); run(app, 1.3);
  app.die("WALL"); run(app, 1);
  const saved = ctx.calls.saved.at(-1);
  assert.equal(saved.runs, 13);
  assert.equal(saved.milestone, 3);
  assert.ok(JSON.stringify(saved).length < 4096);
});

test("feats: each is reached by its counter and recorded once", () => {
  const ids = new Set(FEATS.map((f) => f.id));
  assert.equal(ids.size, FEATS.length);
  const { app } = start(13);
  app.level = 6; app.maxLen = 24; app.frags = 20;
  Object.assign(app.R, { comboBest: 5, bonus: 5, phased: 1, portals: 1, frags: 500, daily: 1, edgeBest: 12, hairpins: 10 });
  app.checkFeats();
  // The mode and field feats need their own runs.
  assert.deepEqual(FEATS.map((f) => f.id).filter((id) => !app.sv.ft.includes(id)).sort(), ["lattice", "spiral", "torus"]);
  app.sv.sel.mode = 1; app.checkFeats();
  app.sv.sel.field = 1; app.checkFeats();
  app.sv.sel.field = 2; app.checkFeats();
  assert.equal(app.sv.ft.length, FEATS.length);
  const n = app.newFeats.length;
  app.checkFeats();
  assert.equal(app.newFeats.length, n, "a feat was recorded twice");
});

test("canvas text is at least 16 px on every screen", () => {
  const sizes = [];
  const g2d = new Proxy({}, { get: (t, k) => (k === "fillText" ? () => sizes.push(Number(/(\d+(?:\.\d+)?)px/.exec(t.font)?.[1])) : k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  const app = new Helix(appContext({ seed: 14, progress: { schema: 2, runs: 2 } }));
  app.draw(g2d);
  tap(app); run(app, 0.5); app.draw(g2d); run(app, 4); app.draw(g2d);
  app.die("WALL"); run(app, 1); app.draw(g2d);
  app.openHangar(); for (const view of ["menu", "feats", "log"]) { app.view = view; app.draw(g2d); }
  assert.ok(sizes.length > 30);
  assert.ok(Math.min(...sizes) >= 16, "smallest text " + Math.min(...sizes));
});
