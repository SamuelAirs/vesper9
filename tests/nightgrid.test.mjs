import test from "node:test";
import assert from "node:assert/strict";
import { NightGrid, migrateSave, newGrid, makeForecasts, dispatch, crewChoices, applyCrew, NIGHTGRID_SCAN } from "../web/apps/nightgrid.js";
import { appContext, fakeCanvas, run } from "./helpers/app-context.mjs";

const press = (app, durationMs = 60) => { app.down({ source: "keyboard" }); app.up({ source: "keyboard", durationMs }); };
const choose = (app, index) => {
  run(app, 0.8);
  app.scanAt = app.t; app.scanOffset = index;
  press(app); assert.equal(app.review, index);
  run(app, 0.7); press(app);
};

test("save migration rejects junk, caps numbers, and never copies arbitrary last fields", () => {
  const cycle = {}; cycle.last = cycle;
  for (const raw of [undefined, null, true, 7, "x", [], {}, cycle, { runs: Infinity, last: { result: "x" } }, { runs: -3, milestone: 400, bestChain: 400 }]) {
    const saved = migrateSave(raw);
    assert.equal(saved.schema, 1);
    assert.ok(Number.isInteger(saved.runs) && saved.runs >= 0);
    assert.ok(saved.milestone <= 10 && saved.bestChain <= 10);
    assert.ok(JSON.stringify(saved).length < 1024);
  }
  const saved = migrateSave({ runs: 9, victories: 2, bestChain: 4, last: { score: 1234, service: 93, notes: "x".repeat(100000) } });
  assert.equal(saved.runs, 9); assert.equal(saved.last.score, 1234); assert.equal(saved.last.notes, undefined);
});

test("a limited feeder blocks power; a real spare feeder and live tie solve it", () => {
  const grid = newGrid(); grid.battery = 0; grid.cap = [2, 4, 2]; grid.links = [0, 0];
  const event = { need: [4, 2, 2], supply: 8 };
  const blocked = dispatch(grid, event, 0);
  assert.deepEqual(blocked.supplied, [2, 2, 2]);
  grid.links = [2, 0];
  const tied = dispatch(grid, event, 0);
  assert.deepEqual(tied.supplied, [4, 2, 2]);
  assert.deepEqual(tied.feederUsed, [2, 4, 2]);
  assert.deepEqual(tied.tieUsed, [2, 0]);
  assert.equal(tied.state.goodwill[0], 7); assert.ok(tied.points > blocked.points);
});

test("routing across two links consumes both capacities and never invents power", () => {
  const grid = newGrid(); grid.cap = [1, 1, 5]; grid.links = [2, 2]; grid.battery = 0;
  const routed = dispatch(grid, { need: [3, 1, 1], supply: 5 }, 0);
  assert.deepEqual(routed.supplied, [3, 1, 1]);
  assert.deepEqual(routed.tieUsed, [2, 2]);
  assert.deepEqual(routed.feederUsed, [1, 1, 3]);
  const short = dispatch(grid, { need: [3, 1, 1], supply: 3 }, 0);
  assert.equal(short.supplied.reduce((a, b) => a + b), 3);
  assert.ok(short.feederUsed.every((n, i) => n <= grid.cap[i]));
});

test("priorities and explicit reserve budgets produce distinct, predictable outcomes", () => {
  const grid = newGrid(); grid.cap = [4, 4, 4]; grid.links = [0, 0]; grid.water = 0; grid.battery = 3;
  const event = { need: [4, 4, 4], supply: 6 };
  const boost = dispatch(grid, event, 0), balance = dispatch(grid, event, 1), conserve = dispatch(grid, event, 2);
  assert.deepEqual(boost.supplied, [4, 3, 1]); assert.equal(boost.batteryUsed, 2);
  assert.deepEqual(balance.supplied, [1, 4, 2]); assert.equal(balance.batteryUsed, 1);
  assert.deepEqual(conserve.supplied, [1, 1, 4]); assert.equal(conserve.batteryUsed, 0);
  assert.equal(conserve.state.battery, 3);
  assert.equal(grid.battery, 3); assert.deepEqual(grid.goodwill, [6, 6, 6]);
});

test("the tower's finite stored water and shops' two-shift donation create persistent strategy", () => {
  let grid = newGrid(); grid.cap = [2, 3, 1]; grid.links = [0, 0]; grid.water = 2;
  const event = { need: [2, 2, 2], supply: 6 };
  const first = dispatch(grid, event, 1);
  assert.equal(first.buffered, 1); assert.equal(first.harm[2], 0); assert.equal(first.state.water, 1);
  assert.equal(first.earnedKit, 0);
  const second = dispatch(first.state, event, 1);
  assert.equal(second.buffered, 1); assert.equal(second.state.water, 0); assert.equal(second.earnedKit, 1);
  const third = dispatch(second.state, event, 1);
  assert.equal(third.buffered, 0); assert.equal(third.harm[2], 1); assert.equal(third.state.chain, 0);
  assert.ok(third.state.goodwill[2] < second.state.goodwill[2]);
});

test("crew plans persist, cost resources, and do not mutate preview inputs", () => {
  const grid = newGrid(); const event = { need: [3, 4, 3], supply: 8 };
  const original = JSON.stringify(grid);
  const choices = crewChoices(grid, [event, event, event], 0);
  const fix = applyCrew(grid, event, choices[0]);
  assert.equal(fix.state.cap[choices[0].target], grid.cap[choices[0].target] + 1);
  assert.equal(fix.state.kits, grid.kits - 1);
  const smart = applyCrew(grid, event, choices[1]);
  assert.equal(smart.state.efficiency[choices[1].target], 1);
  assert.equal(smart.state.kits, 1);
  const supplies = applyCrew(grid, event, choices[2]);
  assert.equal(supplies.state.kits, 5); assert.equal(supplies.event.supply, 7);
  assert.equal(JSON.stringify(grid), original); assert.equal(event.supply, 8);
  const poor = newGrid(); poor.kits = 0;
  assert.equal(applyCrew(poor, event, crewChoices(poor, [event], 0)[0]).applied, false);
});

test("inspection freezes indefinitely, hold rethinks, and committed result equals its preview", () => {
  const ctx = appContext(); const app = new NightGrid(ctx); press(app);
  run(app, 0.8); press(app); const selected = app.review;
  run(app, 50); assert.equal(app.review, selected); assert.equal(app.shift, 0);
  press(app, 900); assert.equal(app.review, -1); assert.equal(app.stage, "crew");
  choose(app, 0); assert.equal(app.stage, "route");
  const predicted = JSON.stringify(app.previews[2].state);
  choose(app, 2); assert.equal(app.stage, "report");
  assert.equal(JSON.stringify(app.grid), predicted);
});

test("scanner applies bounded latency and selection does not drift after freezing", () => {
  const ctx = appContext({ settings: { latencyMs: 100 } }); const app = new NightGrid(ctx); press(app);
  run(app, NIGHTGRID_SCAN + 0.05); assert.equal(app.scanIndex(), 1);
  press(app); assert.equal(app.review, 0);
  run(app, 10); assert.equal(app.activeIndex(), 0);
});

test("ten shifts finish once, save once, and a result cannot be immediately skipped", () => {
  const ctx = appContext(); const app = new NightGrid(ctx); press(app);
  for (let round = 0; round < 10; round++) {
    choose(app, app.choices[1].available ? 1 : 2);
    assert.equal(app.stage, "route");
    const best = app.previews.map((p, i) => ({ i, value: p.state.goodwill.reduce((a, b) => a + b) * 200 + p.points + p.state.battery * 60 })).sort((a, b) => b.value - a.value)[0].i;
    choose(app, best); assert.equal(app.stage, "report");
    run(app, 1.6); press(app);
  }
  assert.equal(app.phase, "over"); assert.ok(app.t - app.startedAt >= 30);
  press(app); assert.equal(app.phase, "over");
  run(app, 2);
  assert.equal(ctx.calls.score.length, 1); assert.equal(ctx.calls.saved.length, 1);
  assert.equal(ctx.calls.saved[0].runs, 1); assert.equal(ctx.calls.saved[0].last.shifts, 10);
  assert.ok(JSON.stringify(ctx.calls.saved[0]).length < 1024);
});

test("the menu gesture rewinds selected/committed work and RNG on all three paces", () => {
  for (const gesturePace of ["quick", "standard", "relaxed"]) {
    const ctx = appContext({ settings: { gesturePace } }); const app = new NightGrid(ctx);
    press(app); run(app, 1); app.review = 0; app.reviewAt = app.t - 1;
    const before = JSON.stringify({ grid: app.grid, stage: app.stage, shift: app.shift, review: app.review });
    app.down(); run(app, 0.06); app.up({ durationMs: 60 }); run(app, 0.08);
    app.down(); run(app, 0.06); app.up({ durationMs: 60 }); run(app, 0.08);
    app.down(); run(app, 1.6); app.cancel();
    assert.equal(JSON.stringify({ grid: app.grid, stage: app.stage, shift: app.shift, review: app.review }), before, gesturePace);
    assert.equal(ctx.calls.score.length, 0); assert.equal(ctx.calls.saved.length, 0);
  }
});

test("a minute of rapid input has no novice early loss, draws safely and respects lamp lifecycle", () => {
  const ctx = appContext(); const app = new NightGrid(ctx), g = fakeCanvas();
  let firstOver = Infinity;
  run(app, 60, (i) => {
    if (i % 5 === 0) press(app);
    if (i % 10 === 0) app.draw(g);
    if (app.phase === "over") firstOver = Math.min(firstOver, app.t);
  });
  assert.ok(firstOver >= 30);
  for (const picture of ctx.calls.leds) assert.ok(picture.length === 9 && picture.every((v) => Number.isInteger(v) && v >= 0 && v <= 255));
  app.pause(); const count = ctx.calls.leds.length; run(app, 1); assert.equal(ctx.calls.leds.length, count);
  app.resume(); run(app, 0.1); assert.ok(ctx.calls.leds.length > count);
  app.dispose(); assert.deepEqual(ctx.calls.leds.at(-1), Array(9).fill(0));
});

test("forecasts are seeded, first shifts are humane, and thoughtful runs can win across seeds", () => {
  const a = appContext({ seed: 231 }), b = appContext({ seed: 231 });
  assert.deepEqual(makeForecasts(a.rng), makeForecasts(b.rng));
  let wins = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const ctx = appContext({ seed: seed * 919 }); const forecasts = makeForecasts(ctx.rng);
    assert.deepEqual(forecasts[0].need, [2, 2, 2]);
    let states = [newGrid()];
    for (let shift = 0; shift < 10; shift++) {
      const next = [];
      for (const grid of states) for (const choice of crewChoices(grid, forecasts, shift)) {
        const plan = applyCrew(grid, forecasts[shift], choice); if (!plan.applied) continue;
        for (let policy = 0; policy < 3; policy++) next.push(dispatch(plan.state, plan.event, policy).state);
      }
      const value = (s) => s.goodwill.reduce((a, b) => a + b) * 250 + Math.min(...s.goodwill) * 250 + s.score * 0.35 + s.kits * 90 + s.battery * 60 + s.efficiency.reduce((a, b) => a + b) * (10 - shift) * 140 + s.cap.reduce((a, b) => a + b) * (10 - shift) * 50;
      next.sort((a, b) => value(b) - value(a));
      // Equivalent policies on the easy first shift must not crowd distinct plans out of the beam.
      const seen = new Set();
      states = next.filter((state) => {
        const key = JSON.stringify(state);
        if (seen.has(key)) return false;
        seen.add(key); return true;
      }).slice(0, 8);
    }
    if (states.some((s) => s.goodwill.every((n) => n > 0) && s.goodwill.reduce((a, b) => a + b) >= 12)) wins++;
  }
  assert.ok(wins >= 15, "thoughtful planning should win most test nights: " + wins + "/20");
});
