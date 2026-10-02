import test from "node:test";
import assert from "node:assert/strict";
import { Supper, migrateSave, SCAN_SECONDS, RECIPES, UPGRADES } from "../web/apps/supper.js";
import { appContext, fakeCanvas, run } from "./helpers/app-context.mjs";

const tap = (app) => { app.down({ source: "keyboard" }); app.up({ source: "keyboard", durationMs: 60 }); };
const onPan = (app, i) => { app.scanT = i * SCAN_SECONDS + 0.6; app.actionCooldown = 0; app.pans[i].cooldown = 0; tap(app); };
const ready = (app, i) => { const p = app.pans[i]; if (p.state === "empty") app.beginPan(i); p.age = p.cook + 0.6; p.state = "ready"; };

test("opening offers a complete meal inside ten seconds, while premature plating wastes scarce stock", () => {
  const ctx = appContext(), app = new Supper(ctx);
  tap(app);
  assert.equal(app.phase, "play");
  assert.equal(app.pans[0].state, "cook");
  const initialStock = app.stock[0];
  onPan(app, 0);
  assert.equal(app.waste, 1);
  assert.equal(app.pans[0].state, "empty");
  onPan(app, 0);
  assert.equal(app.stock[0], initialStock - 1);
  assert.equal(app.meals, 0);
  ready(app, 0); onPan(app, 0);
  assert.equal(app.meals, 1);
  assert.ok(app.score >= RECIPES[0].value);

  const fresh = new Supper(appContext()); tap(fresh);
  run(fresh, 4.25); tap(fresh);
  assert.equal(fresh.meals, 1);
});

test("a meal needs every component; incomplete older tickets do not steal food", () => {
  const app = new Supper(appContext()); tap(app);
  app.queue = [
    { recipe: 6, guest: "TABLE 1", patience: 40, maxPatience: 40 },
    { recipe: 3, guest: "TABLE 2", patience: 40, maxPatience: 40 },
  ];
  ready(app, 0); onPan(app, 0);
  assert.equal(app.meals, 0);
  assert.equal(app.trays[0].length, 1);
  ready(app, 1); onPan(app, 1);
  assert.equal(app.meals, 1);
  assert.equal(app.queue.length, 1);
  assert.equal(app.queue[0].recipe, 6);
  assert.deepEqual(app.trays.map((a) => a.length), [0, 0, 0]);
});

test("plated food expires, overfull trays block overproduction, and burnt pans need cleaning", () => {
  const app = new Supper(appContext()); tap(app);
  app.queue = [{ recipe: 6, guest: "ONE", patience: 100, maxPatience: 100 }];
  app.schedule = []; app.nextOrder = 0;
  app.trays[1] = [{ age: app.trayLife() - 0.1, quality: 1 }, { age: 0, quality: 1 }];
  const before = app.stock[1]; onPan(app, 1);
  assert.equal(app.stock[1], before);
  run(app, 0.2);
  assert.equal(app.trays[1].length, 1);
  assert.equal(app.waste, 1);
  app.beginPan(2); app.pans[2].age = app.pans[2].cook + app.pans[2].ready + 1;
  app.pans[2].state = "burnt"; onPan(app, 2);
  assert.equal(app.burns, 1);
  assert.equal(app.pans[2].state, "empty");
  assert.equal(app.waste, 2);
});

test("a plain hold spends breath to slow time and never accidentally cooks or plates", () => {
  const app = new Supper(appContext()); tap(app);
  app.scanT = SCAN_SECONDS + 0.5;
  const stock = app.stock.slice(), age = app.pans[0].age, breath = app.breath;
  app.down({ source: "keyboard" }); run(app, 2); app.up({ source: "keyboard", durationMs: 2000 });
  assert.deepEqual(app.stock, stock);
  assert.equal(app.pans[1].state, "empty");
  assert.ok(app.pans[0].age - age < 0.8);
  assert.ok(app.breath < breath - 1.5);
  assert.equal(app.held, false);
});

test("scan selection is latched on press, calibrated, and unaffected by release crossing a boundary", () => {
  const app = new Supper(appContext({ settings: { latencyMs: 150 } })); tap(app);
  app.scanT = SCAN_SECONDS + 0.1;
  ready(app, 0);
  app.down({ source: "keyboard" }); run(app, 0.08); app.up({ source: "keyboard", durationMs: 80 });
  assert.equal(app.meals, 1, "150ms correction selects rice rather than newly focused greens");
  assert.equal(app.pans[1].state, "empty");
});

test("upgrades change the actual resource and scheduling rules", () => {
  const a = new Supper(appContext()), b = new Supper(appContext()); tap(a); tap(b);
  b.mods = ["batch", "iron", "drawer", "host", "prep"];
  b.pans[1].state = "empty"; a.pans[1].state = "empty";
  a.beginPan(1); b.beginPan(1);
  assert.equal(b.pans[1].count, 2);
  assert.equal(a.pans[1].count, 1);
  assert.ok(b.pans[1].cook > a.pans[1].cook);
  assert.ok(b.pans[1].ready > a.pans[1].ready);
  assert.equal(b.trayMax(), 4); assert.equal(b.trayLife(), 40); assert.equal(b.breathMax(), 12);
  b.queue = [{ recipe: 0, guest: "A", patience: 10, maxPatience: 40 }, { recipe: 5, guest: "B", patience: 10, maxPatience: 40 }];
  b.trays[0] = [{ age: 0, quality: 1 }]; b.completeMeals();
  assert.equal(b.queue[0].patience, 14);
});

test("saves are bounded, migration drops junk, a finished run saves and scores exactly once", () => {
  const junk = [null, undefined, 5, "oops", [], { runs: -3, wins: Infinity, milestone: 900, last: { score: NaN, meals: 8, mystery: "x".repeat(9000) } }];
  for (const value of junk) {
    const save = migrateSave(value);
    assert.equal(save.schema, 1);
    assert.ok(Number.isInteger(save.runs) && save.runs >= 0);
    assert.ok(save.milestone <= 4);
    assert.ok(JSON.stringify(save).length < 800);
  }
  const ctx = appContext(), app = new Supper(ctx); tap(app);
  app.meals = 24; app.completedWaves = 4; app.end(true); app.end(true);
  const savedScore = app.score; tap(app);
  assert.equal(app.phase, "over", "result lockout preserves result");
  run(app, 3);
  assert.equal(ctx.calls.score.length, 1); assert.equal(ctx.calls.saved.length, 1);
  assert.equal(ctx.calls.score[0][0], savedScore);
  assert.equal(ctx.calls.saved[0].runs, 1);
  assert.equal(ctx.calls.saved[0].wins, 1);
  tap(app); assert.equal(app.phase, "play");
  assert.equal(ctx.calls.saved[0].last.meals, 24, "save object is not mutated by a new run");
});

test("tap-tap-hold menu gesture restores food, scores, RNG, and lamp lifetime", () => {
  for (const pace of ["quick", "standard", "relaxed"]) {
    const ctx = appContext({ settings: { gesturePace: pace } }), app = new Supper(ctx); tap(app); run(app, 3);
    const before = { pans: structuredClone(app.pans), stock: app.stock.slice(), meals: app.meals, worldT: app.worldT, rng: ctx.rng.state };
    app.down({ source: "keyboard" }); run(app, 0.06); app.up({ source: "keyboard", durationMs: 60 }); run(app, 0.06);
    app.down({ source: "keyboard" }); run(app, 0.06); app.up({ source: "keyboard", durationMs: 60 }); run(app, 0.06);
    app.down({ source: "keyboard" }); run(app, 1.2); app.cancel();
    assert.deepEqual(app.pans, before.pans); assert.deepEqual(app.stock, before.stock);
    assert.equal(app.meals, before.meals); assert.equal(app.worldT, before.worldT); assert.equal(ctx.rng.state, before.rng);
    assert.equal(app.held, false); assert.deepEqual(ctx.calls.leds.at(-1), Array(9).fill(0));
    app.pause(); const count = ctx.calls.leds.length; run(app, 1); assert.equal(ctx.calls.leds.length, count);
    app.resume(); run(app, 0.1); assert.ok(ctx.calls.leds.length > count);
    app.dispose(); assert.deepEqual(ctx.calls.leds.at(-1), Array(9).fill(0));
  }
});

test("new players survive at least thirty seconds; spam consumes food without winning", () => {
  for (const mode of ["idle", "spam"]) {
    const app = new Supper(appContext()); tap(app);
    run(app, 31, (i) => { if (mode === "spam" && i % 6 === 0) tap(app); });
    assert.equal(app.phase, "play");
    assert.equal(app.hearts, 6);
    if (mode === "spam") { assert.equal(app.meals, 0); assert.ok(app.waste >= 8); }
  }
});

function kitchenBot(app) {
  if (app.phase === "upgrade") {
    if (app.t - app.phaseAt < 1) return;
    const priority = ["drawer", "host", "iron", "prep", "flame", "batch"];
    const wanted = app.offers.slice().sort((a, b) => priority.indexOf(UPGRADES[a].id) - priority.indexOf(UPGRADES[b].id))[0];
    if (app.offers[app.focusAt()] === wanted) tap(app);
    return;
  }
  if (app.phase !== "play" || app.actionCooldown > 0) return;
  const i = app.focusAt(), p = app.pans[i];
  if (p.cooldown > 0) return;
  if (p.state === "burnt" || p.state === "ready" && app.trays[i].length < app.trayMax()) { tap(app); return; }
  if (p.state !== "empty" || !app.stock[i]) return;
  const need = [0, 0, 0];
  const orders = app.queue.map((order) => order.recipe);
  if (app.nextOrder < app.schedule.length && app.schedule[app.nextOrder].at - app.waveClock < 14) orders.push(app.schedule[app.nextOrder].recipe);
  for (const recipe of orders) RECIPES[recipe].need.forEach((n, j) => { need[j] += n; });
  if (need[i] > app.trays[i].length) tap(app);
}

test("a ticket-reading player can finish all four services, across seeded order and upgrade variations", () => {
  for (const seed of [3, 17, 1979, 4501]) {
    const ctx = appContext({ seed }), app = new Supper(ctx); tap(app);
    for (let frame = 0; frame < 60 * 420 && app.phase !== "over"; frame++) {
      kitchenBot(app); app.update(1 / 60);
    }
    assert.equal(app.phase, "over", "seed " + seed + " reached an ending");
    assert.equal(app.won, true, "seed " + seed + ": " + app.meals + " meals; " + app.missed + " missed");
    assert.equal(app.completedWaves, 4);
    assert.ok(app.meals >= 20, "ticket reader serves most of the house");
    assert.ok(app.serviceT >= 180 && app.serviceT < 350, "several-minute service length");
  }
});

test("a minute of varied inputs draws safely and emits only finite 9-channel lamps", () => {
  const ctx = appContext(), app = new Supper(ctx), g = fakeCanvas();
  let pressed = false;
  run(app, 65, (i) => {
    if (i % 53 === 0 && !pressed) { app.down({ source: "keyboard" }); pressed = true; }
    if (i % 53 === 7 && pressed) { app.up({ source: "keyboard", durationMs: 116 }); pressed = false; }
    if (i % 10 === 0) app.draw(g);
  });
  app.phase = "upgrade"; app.offers = [0, 1, 2]; app.draw(g);
  app.phase = "over"; app.draw(g);
  for (const values of ctx.calls.leds) assert.ok(values.length === 9 && values.every((n) => Number.isInteger(n) && n >= 0 && n <= 255));
  assert.ok(!g.count.createLinearGradient && !g.count.createRadialGradient);
  app.dispose(); assert.deepEqual(ctx.calls.leds.at(-1), Array(9).fill(0));
});
