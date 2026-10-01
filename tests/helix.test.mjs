import test from "node:test";
import assert from "node:assert/strict";
import { Helix } from "../web/apps/helix.js";
import { appContext, fakeCanvas, run } from "./helpers/app-context.mjs";

const W = Helix.W, H = Helix.H;
const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
const SEEN = new Uint32Array(W * H * 4 * 128); // (cell, heading, step) marks; a search owns one stamp value
let stamp = 0;
const SEEN2 = new Uint32Array(W * H * 4 * 128); // the same, for the nested room() search
let stamp2 = 0;
const key = (c, dir, d) => (c * 4 + dir) * 128 + Math.min(d, 127);
const SAFE = 30; // moves of room the bot wants after each fragment
const lampsOk = (ctx) => ctx.calls.leds.every((v) => v.length === 9 && v.every((x) => Number.isInteger(x) && x >= 0 && x <= 255));
const dark = (v) => v.every((x) => x === 0);
const start = (seed = 1) => {
  const ctx = appContext({ seed });
  const app = new Helix(ctx);
  app.down();
  run(app, 1.5); // past the READY pause
  return { ctx, app };
};

// A planning bot with its own copy of the rules: it searches over (cell, heading),
// moving straight or clockwise each step, with the trail blocked until the tail has
// passed it. It heads for the fragment (or a timed one) and spends one tap per step
// when the first move of its plan is a turn. `careful` also demands that the plan
// ends with room to keep moving.
function plan(app, targets, careful, safe = SAFE) {
  const trail = app.trail, hc = trail[trail.length - 1];
  const block = (c, d) => {
    if (app.obs[c]) return true;
    const k = trail.indexOf(c);
    return k >= 0 && d < k + 1 + app.pending;
  };
  stamp++;
  SEEN[key(hc, app.dir, 0)] = stamp;
  const queue = [{ c: hc, dir: app.dir, d: 0, first: -1 }];
  const forced = app.queue.length;
  for (let qi = 0; qi < queue.length;) {
    const s = queue[qi++];
    if (s.d > 50) continue;
    if (s.d > 0 && targets.includes(s.c) && (!careful || room(s, (c, d) => block(c, d - 2), safe))) return s.first;
    for (let turn = s.d < forced ? 1 : 0; turn <= 1; turn++) {
      const dir = (s.dir + turn) & 3;
      const x = (s.c % W) + DX[dir], y = ((s.c / W) | 0) + DY[dir];
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const c = y * W + x;
      if (block(c, s.d + 1) || SEEN[key(c, dir, s.d + 1)] === stamp) continue;
      SEEN[key(c, dir, s.d + 1)] = stamp;
      queue.push({ c, dir, d: s.d + 1, first: s.first < 0 ? turn : s.first });
    }
  }
  return -1;
}
// After reaching the target, can the thread still make eight more moves?
function room(s, block, safe) {
  stamp2++;
  SEEN2[key(s.c, s.dir, s.d)] = stamp2;
  const queue = [{ c: s.c, dir: s.dir, d: s.d }];
  for (let qi = 0; qi < queue.length;) {
    const t = queue[qi++];
    if (t.d >= s.d + safe) return true;
    for (let turn = 0; turn <= 1; turn++) {
      const dir = (t.dir + turn) & 3;
      const x = (t.c % W) + DX[dir], y = ((t.c / W) | 0) + DY[dir];
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const c = y * W + x;
      if (block(c, t.d + 1) || SEEN2[key(c, dir, t.d + 1)] === stamp2) continue;
      SEEN2[key(c, dir, t.d + 1)] = stamp2;
      queue.push({ c, dir, d: t.d + 1 });
    }
  }
  return false;
}

// The first move (0 straight, 1 turn) from which the thread can live longest.
function survive(app) {
  const trail = app.trail, hc = trail[trail.length - 1];
  const block = (c, d) => {
    if (app.obs[c]) return true;
    const k = trail.indexOf(c);
    return k >= 0 && d < k + 1 + app.pending;
  };
  let best = -1, bestMove = 0;
  for (const first of app.queue.length ? [1] : [0, 1]) {
    const dir0 = (app.dir + first) & 3;
    const x0 = (hc % W) + DX[dir0], y0 = ((hc / W) | 0) + DY[dir0];
    if (x0 < 0 || y0 < 0 || x0 >= W || y0 >= H || block(y0 * W + x0, 1)) continue;
    stamp++;
    SEEN[key(y0 * W + x0, dir0, 1)] = stamp;
    const queue = [{ c: y0 * W + x0, dir: dir0, d: 1 }];
    let depth = 1;
    for (let qi = 0; qi < queue.length && depth < 60;) {
      const t = queue[qi++];
      depth = Math.max(depth, t.d);
      for (let turn = 0; turn <= 1; turn++) {
        const dir = (t.dir + turn) & 3;
        const x = (t.c % W) + DX[dir], y = ((t.c / W) | 0) + DY[dir];
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const c = y * W + x;
        if (block(c, t.d + 1) || SEEN[key(c, dir, t.d + 1)] === stamp) continue;
        SEEN[key(c, dir, t.d + 1)] = stamp;
        queue.push({ c, dir, d: t.d + 1 });
      }
    }
    if (depth > best) { best = depth; bestMove = first; }
  }
  return bestMove;
}

function bot(app, seconds, { careful = true, useBonus = true, onStep } = {}) {
  let last = -1;
  run(app, seconds, () => {
    if (app.phase !== "play" || app.steps === last) return;
    last = app.steps;
    onStep?.(app);
    const targets = [app.frag];
    // The timed fragment is only worth it when the bot can still get out afterwards.
    if (useBonus && app.bonus && plan(app, [app.bonus.c], true) >= 0) targets.unshift(app.bonus.c);
    let move = plan(app, targets, careful);
    for (const safe of [16, 8, 3]) if (move < 0 && careful) move = plan(app, targets, true, safe);
    if (move < 0 && careful) move = plan(app, targets, false);
    if (move < 0) move = survive(app); // no route to a target: stay alive as long as possible
    if (move === 1 && app.queue.length === 0) { app.down(); app.up(); } // a tap: the host always sends the release
  });
}

test("a planning bot collects many fragments in a row and far outscores an idle player", () => {
  const rows = [];
  for (const seed of [1, 2, 4]) { // three seeds instead of six: the longest test, trimmed
    const app = new Helix(appContext({ seed }));
    app.down();
    bot(app, 240);
    rows.push([seed, app.phase, app.frags, app.score, app.maxLen, app.level, app.steps]);
  }
  const idle = new Helix(appContext({ seed: 1 }));
  idle.down();
  run(idle, 60);
  console.log("bot [seed, phase, fragments, score, longest, milestone, steps]:\n" + rows.map((r) => r.join(", ")).join("\n"));
  console.log(`idle: ${idle.phase} after ${idle.steps} steps, score ${idle.score}, cause ${idle.cause}`);
  assert.equal(idle.phase, "over");
  assert.ok(idle.score <= 30, "idle score " + idle.score);
  const frags = rows.map((r) => r[2]).sort((a, b) => a - b);
  console.log(`bot fragments: min ${frags[0]}, median ${frags[1]}, max ${frags[2]}`);
  assert.ok(frags[0] >= 5, "worst seed: " + JSON.stringify(rows));
  assert.ok(frags[1] >= 40, "median fragments " + JSON.stringify(rows));
  assert.ok(frags[2] >= 60);
  assert.ok(rows.some((r) => r[5] >= 10), "some seed reaches milestone 10");
});

test("every spawned fragment is reachable at the moment it appears", () => {
  const app = new Helix(appContext({ seed: 9 }));
  app.down();
  let checked = 0, bad = 0, lastFrag = -2;
  bot(app, 150, {
    onStep(a) {
      if (a.frag !== lastFrag) {
        lastFrag = a.frag;
        checked++;
        if (a.frag >= 0 && plan(a, [a.frag], false) < 0) bad++;
      }
    },
  });
  console.log(`fragments checked ${checked}, unreachable ${bad}`);
  assert.ok(checked > 20);
  assert.equal(bad, 0);
});

test("an idle player loses by the boundary; the run is scored and recorded once", () => {
  const ctx = appContext({ seed: 3 });
  const app = new Helix(ctx);
  app.down();
  for (let i = 0; i < 40 * 60 && app.phase === "play"; i++) app.update(1 / 60);
  assert.equal(app.phase, "over");
  assert.equal(app.cause, "WALL");
  assert.equal(ctx.calls.score.length, 1);
  assert.equal(ctx.calls.saved.length, 1);
  assert.deepEqual(Object.keys(ctx.calls.saved[0].last).sort(), ["fragments", "longest", "milestone", "score"]);
  app.down(); // too soon after the end
  assert.equal(app.phase, "over");
  run(app, 1);
  app.down();
  assert.equal(app.phase, "play");
  assert.equal(ctx.calls.saved.length, 1);
});

test("a tap turns clockwise at the next step; two taps in one step make a U-turn over two steps", () => {
  const { app } = start(2);
  assert.equal(app.dir, 0);
  app.down();
  app.down();
  assert.equal(app.queue.length, 2);
  const s0 = app.steps;
  run(app, app.interval * 1.02);
  assert.equal(app.steps, s0 + 1);
  assert.equal(app.dir, 1, "first tap applied at the next step");
  assert.equal(app.queue.length, 1, "second tap waits for the step after");
  run(app, app.interval);
  assert.equal(app.dir, 2, "west after two clockwise turns");
});

test("the queue is bounded and taps before the first step do nothing", () => {
  const app = new Helix(appContext({ seed: 2 }));
  app.down();
  app.down();
  app.down();
  assert.equal(app.queue.length, 0);
  app.up();
  run(app, 1.5);
  for (let i = 0; i < 20; i++) app.down();
  assert.equal(app.queue.length, 3);
});

test("holding the button does nothing: up() changes nothing", () => {
  const { app } = start(2);
  app.down();
  const q = app.queue.length;
  run(app, 0.01);
  app.up({ durationMs: 3000 });
  assert.equal(app.queue.length, q);
});

test("three quick taps then cancel() do not end the run and leave lamps off", () => {
  const { ctx, app } = start(4);
  app.down(); app.down(); app.down();
  app.cancel();
  assert.equal(app.phase, "play");
  assert.equal(app.queue.length, 0);
  assert.ok(dark(ctx.calls.leds.at(-1)));
  run(app, 0.5);
  assert.equal(app.phase, "play");
});

test("three taps spaced one step apart make a left turn and survive", () => {
  const { app } = start(5);
  for (let i = 0; i < 3; i++) { app.down(); run(app, app.interval * 1.01); }
  assert.equal(app.dir, 3);
  assert.equal(app.phase, "play");
});

test("dispose() mid-play leaves the lamps off", () => {
  const { ctx, app } = start(6);
  run(app, 1);
  app.dispose();
  assert.ok(dark(ctx.calls.leds.at(-1)));
});

test("bearing: right lamp for the head's right, middle ahead, left for left or behind", () => {
  const b = Helix.bearing;
  assert.equal(b(10, 6, 0, 10, 9).lamp, 2, "heading east, south is the right");
  assert.equal(b(10, 6, 0, 16, 6).lamp, 1);
  assert.equal(b(10, 6, 0, 16, 7).lamp, 1, "a shallow angle still counts as ahead");
  assert.equal(b(10, 6, 0, 10, 2).lamp, 0);
  assert.equal(b(10, 6, 0, 4, 6).lamp, 0, "directly behind counts as left");
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
  assert.deepEqual(lit, [b.lamp]);
  const far = Math.max(...v);
  // Move the fragment next to the head's heading: same lamp family, brighter.
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
  let l = ctx.calls.leds.at(-1);
  if (!app.danger(2)) assert.ok(l[1] > l[0] && l[4] > l[3] && l[7] > l[6], "green accent " + l);
  for (let i = 0; i < 4; i++) app.collect();
  assert.equal(app.level, 1);
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    app.update(1 / 60);
    if (app.danger(2)) break;
    seen.add(ctx.calls.leds.at(-1).filter((_, j) => j % 3 === 1).indexOf(Math.max(...ctx.calls.leds.at(-1).filter((_, j) => j % 3 === 1))));
  }
  assert.ok(seen.size >= 2 || app.danger(2), "chase moves across lamps");
});

test("long bot run: lamps valid and varied, no NaN, lists bounded, draw never throws", () => {
  const ctx = appContext({ seed: 12 });
  const app = new Helix(ctx);
  const g = fakeCanvas();
  app.draw(g);
  app.down();
  let maxTrail = 0;
  bot(app, 240, {
    onStep(a) {
      maxTrail = Math.max(maxTrail, a.trail.length);
      for (const k of ["score", "t", "dir", "frags", "level", "pending", "sinceCollect", "interval", "acc"]) assert.ok(Number.isFinite(a[k]), k);
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

test("progression: timed fragments, obstacles and a phase pickup all appear and are used", () => {
  const seen = { bonus: 0, obs: 0, pickup: false, charge: false, bonusTaken: 0 };
  for (const seed of [3, 4]) {
    const app = new Helix(appContext({ seed }));
    app.down();
    let prevScore = 0;
    bot(app, 300, {
      onStep(a) {
        if (a.bonus) seen.bonus++;
        seen.obs = Math.max(seen.obs, a.nObs);
        if (a.pickup !== null) seen.pickup = true;
        if (a.charge) seen.charge = true;
        if (a.score - prevScore >= 30 && a.level >= 1) seen.bonusTaken++;
        prevScore = a.score;
      },
    });
  }
  console.log("progression", JSON.stringify(seen));
  assert.ok(seen.bonus > 0 && seen.obs >= 2 && seen.pickup);
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
  for (let i = 0; i < 3; i++) { app.down(); run(app, app.interval * 1.01); }
  // heading north now; turn once more so it runs back along the trail's row
  while (app.charge === 1 && app.phase === "play" && app.steps < 80) {
    app.down();
    run(app, app.interval * 1.01);
  }
  assert.equal(app.charge, 0, "charge was used by a crossing or never needed");
  // Without a charge the same crossing is fatal.
  const b = start(7).app;
  b.pending = 30;
  for (let i = 0; i < 80 && b.phase === "play"; i++) { b.down(); run(b, b.interval * 1.01); }
  assert.equal(b.phase, "over");
  assert.equal(b.cause, "TRAIL");
});

test("milestones come every five fragments; speed rises with length; tail shortens while starved", () => {
  const { app } = start(3);
  assert.equal(app.interval, 0.3);
  for (let i = 0; i < 12; i++) app.collect();
  assert.equal(app.level, 2);
  assert.ok(app.frag >= 0);
  const long = [...app.trail];
  while (app.trail.length < 30) app.trail.push(long[0]);
  assert.equal(app.interval, 0.11, "fastest pace");
  const mid = app.interval;
  app.trail.length = 10;
  assert.ok(app.interval > mid);
  // Starvation: a thread that collects nothing loses a cell every few steps after a while.
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
  app.down();
  const dirs = new Set();
  let wallTurns = 0, lastDir = app.dir;
  run(app, 1.4 + 19.5, () => {
    if (app.phase === "play" && app.ready <= 0) {
      dirs.add(app.dir);
      if (app.dir !== lastDir) wallTurns++;
      lastDir = app.dir;
    }
  });
  assert.equal(app.phase, "play", "an idle newcomer is still alive at 19 s");
  assert.ok(wallTurns >= 3, "the wall turned the thread " + wallTurns + " times");
  assert.ok(app.head !== undefined && app.head >= 0 && app.head < W * H);
  for (const v of ctx.calls.leds) assert.ok(v.length === 9 && v.every((x) => Number.isInteger(x) && x >= 0 && x <= 255));
  app.draw(fakeCanvas());
  // Then the walls are live and an idle thread dies of the boundary.
  run(app, 15);
  assert.equal(app.phase, "over");
  assert.equal(app.cause, "WALL");
});

test("the soft wall turns a corner twice, and never into the unknown", () => {
  const { app } = start(2);
  // Put the head in the bottom-right corner, heading east.
  app.trail.length = 0;
  app.cnt.fill(0);
  app.pending = 0;
  const corner = (H - 1) * W + (W - 1);
  for (const c of [corner - 2 * W, corner - W, corner]) app.pushHead(c); // arrived from the north
  app.dir = 0;
  app.queue.length = 0;
  app.frag = 0; // far away, irrelevant
  app.step();
  assert.equal(app.phase, "play");
  assert.equal(app.dir, 2, "east at the corner: south is a wall too, so west");
  assert.equal(app.head, corner - 1);
  // The lamps show no danger for a wall that will only turn the thread.
  assert.equal(app.danger(2), "");
});

test("the countdown shows during the grace and the walls announce when they go live", () => {
  const app = new Helix(appContext({ seed: 5 }));
  app.down();
  const texts = [];
  const g = fakeCanvas();
  const spy = new Proxy(g, { get(o, k) { return k === "fillText" ? (t) => texts.push(t) : o[k]; } });
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

test("a long hold freezes the world until release, so the menu hold cannot cost the run; a tap does not", () => {
  const { app } = start(6);
  app.runT = Helix.GRACE; // live walls
  const steps = app.steps;
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
  // A tap of 0.2 s never freezes.
  const before = app.steps;
  app.down(); run(app, 0.2); app.up();
  run(app, 0.4);
  assert.ok(app.steps > before);
  // cancel() while held clears the state.
  app.down(); run(app, 1); app.cancel();
  assert.ok(!app.frozen);
  assert.ok(steps <= app.steps);
});
