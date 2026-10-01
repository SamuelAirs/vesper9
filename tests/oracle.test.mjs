import test from "node:test";
import assert from "node:assert/strict";
import { appContext } from "./helpers/app-context.mjs";
import { Random } from "../web/engine/math.js";
import {
  Oracle, makeResult, defaultConfig, cleanConfig, rollFrame, resultLamps, tumbleResult,
  TICKS, TICK_COUNT, ROLL_SECONDS, IDLE_SECONDS, DICE, summary,
} from "../web/apps/oracle.js";

const wholeLamps = (v) => Array.isArray(v) && v.length === 9 && v.every((x) => Number.isInteger(x) && x >= 0 && x <= 255);
const lit = (v) => v.some((x) => x > 0);
const choose = (ctx, id) => ctx.currentActions.find((a) => a.id === id).run();

// A manual clock and animation-frame queue, installed only for tests that want animation.
function withFrames(fn) {
  const had = Object.getOwnPropertyDescriptor(globalThis, "requestAnimationFrame");
  const hadCancel = Object.getOwnPropertyDescriptor(globalThis, "cancelAnimationFrame");
  let queue = new Map(), nextId = 1;
  globalThis.requestAnimationFrame = (cb) => { queue.set(nextId, cb); return nextId++; };
  globalThis.cancelAnimationFrame = (id) => queue.delete(id);
  const env = {
    pending: () => queue.size,
    flush() { const q = [...queue.values()]; queue = new Map(); q.forEach((cb) => cb()); },
  };
  try { return fn(env); } finally {
    if (had) Object.defineProperty(globalThis, "requestAnimationFrame", had); else delete globalThis.requestAnimationFrame;
    if (hadCancel) Object.defineProperty(globalThis, "cancelAnimationFrame", hadCancel); else delete globalThis.cancelAnimationFrame;
  }
}
function clocked(app) {
  const clock = { ms: 1000 };
  app.now = () => clock.ms;
  return clock;
}
const advance = (app, clock, env, seconds, dt = 1 / 60) => {
  for (let t = 0; t < seconds - 1e-9; t += dt) { clock.ms += dt * 1000; env.flush(); }
};

test("results are uniform over many seeded rolls (chi-square)", () => {
  const rng = new Random(20260930);
  const chi = (counts, expected) => counts.reduce((sum, n) => sum + (n - expected) ** 2 / expected, 0);
  const N = 24000;
  // Critical values at p = 0.001 for the degrees of freedom used below.
  const critical = { 1: 10.83, 2: 13.82, 4: 18.47, 5: 20.52, 6: 22.46, 7: 24.32, 9: 27.88, 11: 31.26, 19: 43.82 };
  // Coin
  let counts = [0, 0];
  for (let i = 0; i < N; i++) counts[makeResult({ ...defaultConfig(), mode: "coin" }, rng).side === "HEADS" ? 0 : 1]++;
  assert.ok(chi(counts, N / 2) < critical[1], "coin " + counts);
  // Every die, one at a time
  for (const sides of DICE) {
    counts = Array(sides).fill(0);
    for (let i = 0; i < N; i++) counts[makeResult({ ...defaultConfig(), mode: "dice", die: sides, count: 1 }, rng).total - 1]++;
    const df = sides - 1;
    const limit = critical[df] ?? (df + 4.5 * Math.sqrt(2 * df) + 10); // 99 degrees of freedom: far past p = 0.001
    assert.ok(chi(counts, N / sides) < limit, `d${sides} chi=${chi(counts, N / sides)} counts=${counts}`);
  }
  // Each die inside a multi-dice roll is uniform as well
  counts = Array(6).fill(0);
  for (let i = 0; i < N / 6; i++) for (const v of makeResult({ ...defaultConfig(), mode: "dice", die: 6, count: 6 }, rng).values) counts[v - 1]++;
  assert.ok(chi(counts, N / 6) < critical[5], "6d6 faces " + counts);
  // Number with a range that does not divide evenly
  counts = Array(7).fill(0);
  for (let i = 0; i < N; i++) counts[makeResult({ ...defaultConfig(), mode: "number", max: 7 }, rng).value - 1]++;
  assert.ok(chi(counts, N / 7) < critical[6], "number " + counts);
  // Pick one of N, every N
  for (let n = 2; n <= 8; n++) {
    counts = Array(n).fill(0);
    for (let i = 0; i < N; i++) counts[makeResult({ ...defaultConfig(), mode: "decide", decideKind: "pick", pickN: n }, rng).choice - 1]++;
    assert.ok(chi(counts, N / n) < (critical[n - 1] ?? 30), `pick ${n} ${counts}`);
  }
  // Yes / no / ask again: five, five, two twelfths
  counts = [0, 0, 0];
  for (let i = 0; i < N; i++) counts[["YES", "NO", "ASK AGAIN"].indexOf(makeResult({ ...defaultConfig(), mode: "decide" }, rng).answer)]++;
  const expected = [N * 5 / 12, N * 5 / 12, N * 2 / 12];
  assert.ok(counts.reduce((s, n, i) => s + (n - expected[i]) ** 2 / expected[i], 0) < critical[2], "yesno " + counts);
});

test("the result is decided at the press, from ctx.rng, before any animation", () => {
  withFrames((env) => {
    const probe = new Random(77), expect = [];
    const ctx = appContext({ seed: 77 });
    const app = new Oracle(ctx);
    clocked(app);
    app.cfg = { ...app.cfg, mode: "dice", die: 20, count: 1 };
    for (let i = 0; i < 1; i++) expect.push(probe.int(1, 20));
    choose(ctx, "roll");
    assert.equal(app.rolling, true);
    assert.equal(app.result.total, expect[0], "decided immediately");
    assert.equal(app.history[0], app.result, "recorded at the press");
    // The next draw from the generator is untouched by the animation
    env.flush(); env.flush();
    assert.equal(ctx.rng.int(1, 20), probe.int(1, 20));
    app.dispose();
  });
});

test("roll animation: about a second, ticks slow down, lamps tumble then land", () => {
  assert.ok(ROLL_SECONDS > 0.9 && ROLL_SECONDS < 1.2, "duration " + ROLL_SECONDS);
  const gaps = TICKS.map((t, i) => t - (TICKS[i - 1] || 0));
  for (let i = 1; i < gaps.length; i++) assert.ok(gaps[i] > gaps[i - 1], "gaps grow");
  const rng = new Random(5);
  const r = makeResult({ ...defaultConfig(), mode: "dice", die: 20, count: 1 }, rng);
  const seenLamp = new Set(), seenColour = new Set();
  let previous = 0;
  for (let t = 0; t < ROLL_SECONDS; t += 0.005) {
    const f = rollFrame(r, t);
    assert.ok(wholeLamps(f.leds));
    assert.ok(f.step >= previous && f.step <= TICK_COUNT);
    previous = f.step;
    assert.equal(f.done, false);
    const on = [0, 1, 2].filter((i) => f.leds.slice(i * 3, i * 3 + 3).some((x) => x > 0));
    assert.equal(on.length, 1, "one lamp chases");
    seenLamp.add(on[0]);
    seenColour.add(f.leds.slice(on[0] * 3, on[0] * 3 + 3).join());
  }
  assert.equal(seenLamp.size, 3);
  assert.ok(seenColour.size >= 3, "colours change");
  const done = rollFrame(r, ROLL_SECONDS + 0.01);
  assert.equal(done.done, true);
  assert.equal(done.face, r);
  assert.deepEqual(done.leds, resultLamps(r, 0.01));
  // Pure: same inputs, same outputs; garbage time does not throw
  assert.deepEqual(rollFrame(r, 0.3), rollFrame(r, 0.3));
  for (const bad of [NaN, -1, Infinity, undefined]) assert.ok(wholeLamps(rollFrame(r, bad).leds));
});

test("lamps carry the result", () => {
  const side = (l) => [0, 1, 2].map((i) => lit(l.slice(i * 3, i * 3 + 3)));
  assert.deepEqual(side(resultLamps({ kind: "coin", side: "HEADS" }, 0.5)), [true, false, false]);
  assert.deepEqual(side(resultLamps({ kind: "coin", side: "TAILS" }, 0.5)), [false, false, true]);
  const yes = resultLamps({ kind: "yesno", answer: "YES" }, 1), no = resultLamps({ kind: "yesno", answer: "NO" }, 1);
  assert.ok(yes[1] > yes[0] && yes[1] > yes[2], "green");
  assert.ok(no[0] > no[1] && no[0] > no[2], "red");
  const die = (total, extreme = null) => ({ kind: "dice", sides: 20, count: 1, values: [total], total, lo: 1, hi: 20, extreme });
  const level = (l) => l.reduce((a, b) => a + b, 0);
  const low = resultLamps(die(4), 1), mid = resultLamps(die(10), 1), high = resultLamps(die(18), 1);
  const litCount = (l) => side(l).filter(Boolean).length;
  assert.ok(litCount(low) <= litCount(mid) && litCount(mid) <= litCount(high));
  assert.ok(litCount(high) === 3 && litCount(low) >= 1);
  // Accents: maximum and minimum differ from each other and from ordinary rolls
  const max = resultLamps(die(20, "max"), 0.3), min = resultLamps(die(1, "min"), 0.0);
  assert.notDeepEqual(max, high); assert.notDeepEqual(min, low); assert.notDeepEqual(max, min);
  assert.equal(litCount(max), 3);
  // Pick one of N: position steady at the end of a blink count; blink count equals the choice
  const pick = { kind: "pick", n: 5, choice: 3 };
  let blinks = 0, was = false;
  for (let s = 0; s < 1.5; s += 0.01) { const all = side(resultLamps(pick, s)).every(Boolean); if (all && !was) blinks++; was = all; }
  assert.equal(blinks, 3);
  // Dark after the idle period, and levels stay moderate
  assert.ok(!lit(resultLamps(die(10), IDLE_SECONDS + 0.1)));
  for (const r of [die(10), die(20, "max"), die(1, "min"), pick, { kind: "yesno", answer: "YES" }]) {
    for (let s = -1; s < IDLE_SECONDS; s += 0.05) {
      const l = resultLamps(r, s);
      assert.ok(wholeLamps(l));
      assert.ok(Math.max(...l) <= 255);
    }
  }
  assert.ok(level(mid) < 3 * 255 * 1.2, "moderate");
});

test("every action in every view runs without throwing, and menus stay short", () => {
  withFrames((env) => {
    const ctx = appContext({ seed: 3 });
    const app = new Oracle(ctx);
    const clock = clocked(app);
    for (const mode of ["coin", "dice", "number", "decide"]) {
      app.setConfig({ mode });
      const visit = (depth) => {
        const items = ctx.currentActions;
        assert.ok(items.length >= 1 && items.length <= 8, `${app.view} has ${items.length}`);
        assert.ok(items.every((a) => typeof a.label === "string" && a.label && typeof a.run === "function"));
        if (depth > 4) return;
        for (const item of items) {
          if (item.id === "home") continue;
          const view = app.view;
          item.run();
          advance(app, clock, env, 1.4);
          if (app.view !== view) visit(depth + 1);
          app.view = view; app.render();
        }
      };
      app.view = "main"; app.render();
      visit(0);
      app.setConfig({ mode });
    }
    app.dispose();
    assert.deepEqual(ctx.calls.leds.at(-1), Array(9).fill(0));
  });
});

test("first action is roll; rolling twice quickly skips instead of re-rolling", () => {
  withFrames((env) => {
    const ctx = appContext({ seed: 11 });
    const app = new Oracle(ctx);
    const clock = clocked(app);
    assert.equal(ctx.currentActions[0].id, "roll");
    choose(ctx, "roll");
    const first = app.result;
    assert.equal(app.rolling, true);
    assert.deepEqual(ctx.currentActions.map((a) => a.id), ["skip"]);
    choose(ctx, "skip");
    assert.equal(app.rolling, false);
    assert.equal(app.result, first);
    assert.equal(app.history.length, 1);
    assert.equal(ctx.currentActions[0].id, "roll");
    // roll() itself during a roll also only skips
    choose(ctx, "roll");
    const second = app.result;
    app.roll();
    assert.equal(app.result, second);
    assert.equal(app.history.length, 2);
    clock.ms += 5000; env.flush();
    app.dispose();
  });
});

test("works without requestAnimationFrame: no animation, result at once, lamps dark by tick", () => {
  assert.equal(typeof globalThis.requestAnimationFrame, "undefined");
  const ctx = appContext({ seed: 9 });
  const app = new Oracle(ctx);
  const clock = clocked(app);
  app.setConfig({ mode: "decide" });
  choose(ctx, "roll");
  assert.equal(app.rolling, false);
  assert.ok(app.result);
  assert.ok(lit(ctx.calls.leds.at(-1)));
  assert.ok(ctx.calls.tone.length >= 1);
  app.tick();
  assert.ok(lit(ctx.calls.leds.at(-1)), "still lit before the idle time");
  clock.ms += (IDLE_SECONDS + 1) * 1000;
  app.tick();
  assert.deepEqual(ctx.calls.leds.at(-1), Array(9).fill(0));
  app.dispose();
});

test("animated roll drives lamps and ticking tones, then goes dark when idle", () => {
  withFrames((env) => {
    const ctx = appContext({ seed: 21 });
    const app = new Oracle(ctx);
    const clock = clocked(app);
    app.setConfig({ mode: "dice" });
    choose(ctx, "roll");
    const before = ctx.calls.tone.length;
    advance(app, clock, env, ROLL_SECONDS + 0.2);
    assert.equal(app.rolling, false);
    assert.equal(ctx.calls.tone.length - before, TICK_COUNT + 1, "ticks plus the landing tone");
    const leds = ctx.calls.leds;
    assert.ok(leds.length > 10 && leds.every(wholeLamps));
    assert.ok(new Set(leds.map((l) => l.join())).size >= 6, "lamps actually change " + new Set(leds.map((l) => l.join())).size + " of " + leds.length);
    advance(app, clock, env, IDLE_SECONDS + 0.5);
    assert.deepEqual(ctx.calls.leds.at(-1), Array(9).fill(0));
    assert.equal(env.pending(), 0, "the frame loop stops by itself");
    app.dispose();
  });
});

test("dispose and pause leave lamps off and nothing running; cancel is harmless", () => {
  withFrames((env) => {
    for (const how of ["dispose", "pause"]) {
      const ctx = appContext({ seed: 4 });
      const app = new Oracle(ctx);
      clocked(app);
      choose(ctx, "roll");
      assert.equal(env.pending(), 1);
      app.cancel();
      app[how]();
      assert.equal(env.pending(), 0);
      assert.deepEqual(ctx.calls.leds.at(-1), Array(9).fill(0));
      assert.equal(app.rolling, false);
      if (how === "pause") app.resume();
    }
    // frame firing after dispose does nothing
    const ctx = appContext({ seed: 4 });
    const app = new Oracle(ctx);
    clocked(app);
    choose(ctx, "roll");
    const queued = [...[0]];
    app.dispose();
    const count = ctx.calls.leds.length;
    app.frame();
    assert.equal(ctx.calls.leds.length, count);
    assert.equal(queued.length, 1);
  });
});

test("three stray taps (focus moves) lose nothing; history keeps ten, newest first", () => {
  const ctx = appContext({ seed: 8 });
  const app = new Oracle(ctx);
  clocked(app);
  app.setConfig({ mode: "number", max: 1000 });
  const seen = [];
  for (let i = 0; i < 14; i++) { choose(ctx, "roll"); seen.push(app.result.value); }
  assert.equal(app.history.length, 10);
  assert.deepEqual(app.history.map((r) => r.value), seen.slice(-10).reverse());
  choose(ctx, "history");
  assert.match(ctx.calls.content.at(-1), /HISTORY/);
  assert.match(ctx.calls.content.at(-1), new RegExp(`1-1000 / ${seen.at(-1)}`));
  assert.equal(ctx.calls.content.at(-1).split("1-1000 /").length - 1, 10);
});

test("coin tally counts landed tosses", () => {
  const ctx = appContext({ seed: 31 });
  const app = new Oracle(ctx);
  clocked(app);
  for (let i = 0; i < 20; i++) choose(ctx, "roll");
  assert.equal(app.tally.HEADS + app.tally.TAILS, 20);
  assert.match(ctx.calls.content.at(-1), /TOSSES 20/);
  choose(ctx, "reset");
  assert.equal(app.tally.HEADS + app.tally.TAILS, 0);
});

test("preferences survive a save and restore round trip, and bad data is repaired", () => {
  const ctx = appContext({ seed: 2 });
  const app = new Oracle(ctx);
  app.setConfig({ mode: "dice", die: 12, count: 4 });
  app.setConfig({ max: 700 });
  app.setConfig({ decideKind: "pick", pickN: 7 });
  const saved = ctx.calls.saved.at(-1);
  assert.ok(JSON.stringify(saved).length < 8192);
  const again = new Oracle(appContext({ progress: JSON.parse(JSON.stringify(saved)) }));
  assert.deepEqual(again.cfg, app.cfg);
  for (const junk of [null, 5, "x", { mode: "nope", die: 7, count: 99, max: -4, pickN: NaN, decideKind: 3 }, { count: "3", max: "50" }]) {
    const c = cleanConfig(junk);
    assert.ok(MODES_OK(c));
    assert.doesNotThrow(() => new Oracle(appContext({ progress: junk })));
  }
  assert.equal(cleanConfig({ count: "3", max: "50" }).count, 3);
});
function MODES_OK(c) {
  return ["coin", "dice", "number", "decide"].includes(c.mode) && DICE.includes(c.die) && c.count >= 1 && c.count <= 6
    && c.max >= 2 && c.pickN >= 2 && c.pickN <= 8 && ["yesno", "pick"].includes(c.decideKind);
}

test("returning to the main list parks focus on ROLL first", () => {
  const ctx = appContext();
  const app = new Oracle(ctx);
  app.setConfig({ mode: "dice" });
  choose(ctx, "change"); choose(ctx, "die-type"); choose(ctx, "die-20");
  const tail = ctx.calls.actions.slice(-2);
  assert.deepEqual(tail[0].map((a) => a.id), ["roll"]);
  assert.equal(tail[1][0].id, "roll");
});

test("custom upper bound uses two steps and no menu exceeds eight items", () => {
  const ctx = appContext();
  const app = new Oracle(ctx);
  app.setConfig({ mode: "number" });
  choose(ctx, "change"); choose(ctx, "range-custom");
  assert.ok(ctx.currentActions.length <= 8);
  choose(ctx, "scale-100");
  assert.ok(ctx.currentActions.length <= 8);
  choose(ctx, "fig-3");
  assert.equal(app.cfg.max, 300);
  assert.equal(app.view, "main");
  assert.match(ctx.currentActions[1].label, /1-300/);
});

test("tumble faces stay in range and the record text is safe", () => {
  const rng = new Random(6);
  for (const cfg of [{ mode: "dice", die: 100, count: 6 }, { mode: "number", max: 3 }, { mode: "decide", decideKind: "pick", pickN: 8 }, { mode: "decide" }, { mode: "coin" }]) {
    const r = makeResult({ ...defaultConfig(), ...cfg }, rng);
    for (let step = 0; step < TICK_COUNT; step++) {
      const t = tumbleResult(r, step);
      if (t.kind === "dice") assert.ok(t.values.every((v) => v >= 1 && v <= t.sides) && Number.isFinite(t.total));
      if (t.kind === "number") assert.ok(t.value >= 1 && t.value <= r.hi);
      if (t.kind === "pick") assert.ok(t.choice >= 1 && t.choice <= r.n);
      assert.ok(typeof summary(t) === "string");
    }
  }
  const ctx = appContext({ seed: 12 });
  const app = new Oracle(ctx);
  clocked(app);
  app.setConfig({ mode: "dice", die: 100, count: 6 });
  choose(ctx, "roll");
  assert.ok(!ctx.calls.content.some((h) => /NaN|undefined/.test(h)));
});
