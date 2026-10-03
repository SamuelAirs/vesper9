import test from "node:test";
import assert from "node:assert/strict";
import { Supper, migrateSave, RECIPES, UPGRADES, GUIDE } from "../web/apps/supper.js";
import { HOLD } from "../web/apps/after-hours-kit.js";
import { appContext as baseContext, fakeCanvas, run } from "./helpers/app-context.mjs";

// Players who have seen HOW TO PLAY; the guide itself has its own test.
const appContext = (options = {}) => baseContext({ progress: { schema: 1, guided: true }, ...options });
// A tap moves to the next pan; a hold that is released uses it.
const tap = (app) => { app.down({ source: "keyboard" }); app.up({ source: "keyboard", durationMs: 60 }); };
const hold = (app) => { app.down({ source: "keyboard" }); app.up({ source: "keyboard", durationMs: HOLD * 1000 + 150 }); };
const onPan = (app, i) => { app.actionCooldown = 0; app.pans[i].cooldown = 0; while (app.cursor !== i) tap(app); hold(app); };
const ready = (app, i) => { const p = app.pans[i]; if (p.state === "empty") app.beginPan(i); p.age = p.cook + 0.6; p.state = "ready"; };

test("opening offers a complete meal inside ten seconds; using a cooking pan wastes nothing", () => {
  const ctx = appContext(), app = new Supper(ctx);
  tap(app);
  assert.equal(app.phase, "play");
  assert.equal(app.pans[0].state, "cook");
  const initialStock = app.stock[0];
  onPan(app, 0);
  assert.equal(app.waste, 0);
  assert.equal(app.pans[0].state, "cook", "a release on a cooking pan only says to wait");
  ready(app, 0); onPan(app, 0);
  assert.equal(app.meals, 1);
  assert.ok(app.score >= RECIPES[0].value);
  onPan(app, 0);
  assert.equal(app.stock[0], initialStock - 1);
  assert.equal(app.pans[0].state, "cook");

  const fresh = new Supper(appContext()); tap(fresh);
  run(fresh, 4.25); hold(fresh);
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

test("a hold slows the kitchen while it lasts; its release uses the pan you are on", () => {
  const app = new Supper(appContext()); tap(app);
  tap(app); assert.equal(app.cursor, 1);
  const stock = app.stock.slice(), age = app.pans[0].age, breath = app.breath;
  app.down({ source: "keyboard" }); run(app, 2);
  assert.deepEqual(app.stock, stock, "nothing happens while the button is down");
  assert.ok(app.pans[0].age - age < 0.8, "rice cooked slowly during the hold");
  assert.ok(app.breath < breath - 1.5);
  app.up({ source: "keyboard", durationMs: 2000 });
  assert.equal(app.pans[1].state, "cook"); assert.equal(app.stock[1], stock[1] - 1);
  assert.equal(app.held, false);
});

test("taps only move between pans and never touch the food", () => {
  const app = new Supper(appContext()); tap(app);
  ready(app, 0);
  const before = JSON.stringify({ pans: app.pans, stock: app.stock, trays: app.trays });
  for (let i = 0; i < 7; i++) tap(app);
  assert.equal(app.cursor, 1);
  assert.equal(JSON.stringify({ pans: app.pans, stock: app.stock, trays: app.trays }), before);
  assert.equal(app.meals, 0);
});

test("first launch teaches the game once; HOW TO PLAY reopens from the menu", () => {
  const ctx = baseContext(), app = new Supper(ctx);
  tap(app); assert.equal(app.guide, 0); assert.equal(app.phase, "title");
  for (let page = 1; page < GUIDE.length; page++) { tap(app); assert.equal(app.guide, page); }
  tap(app); assert.equal(app.guide, -1); assert.equal(app.phase, "play");
  run(app, 3); assert.equal(ctx.calls.saved.at(-1).guided, true);
  const world = app.worldT;
  app.menuActions()[0].run(); run(app, 5);
  assert.equal(app.worldT, world, "the kitchen waits while the guide is open");
  hold(app); assert.equal(app.guide, -1); assert.equal(app.phase, "play");
  assert.equal(migrateSave({ runs: 2 }).guided, false);
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

test("new players survive at least thirty seconds; tapping alone uses no food", () => {
  for (const mode of ["idle", "spam"]) {
    const app = new Supper(appContext()); tap(app);
    const stock = app.stock.slice();
    run(app, 31, (i) => { if (mode === "spam" && i % 6 === 0) tap(app); });
    assert.equal(app.phase, "play");
    assert.equal(app.hearts, 6);
    if (mode === "spam") { assert.equal(app.meals, 0); assert.deepEqual(app.stock, stock); }
  }
});

// A player who reads the tickets: moves to the pan that needs using with taps, then holds and releases.
// The hold is real time on the clock, as on the console (the kitchen runs slowly meanwhile).
function kitchenBot(app) {
  if (app.held) {
    if (app.t - app.pressAt >= HOLD + 0.05) app.up({ source: "keyboard", durationMs: Math.round((app.t - app.pressAt) * 1000) });
    return;
  }
  const use = (i) => { if (app.cursor !== i) tap(app); else app.down({ source: "keyboard" }); };
  if (app.phase === "upgrade") {
    if (app.t - app.phaseAt < 1) return;
    const priority = ["drawer", "host", "iron", "prep", "flame", "batch"];
    const wanted = app.offers.slice().sort((a, b) => priority.indexOf(UPGRADES[a].id) - priority.indexOf(UPGRADES[b].id))[0];
    use(app.offers.indexOf(wanted));
    return;
  }
  if (app.phase !== "play" || app.actionCooldown > 0) return;
  const need = [0, 0, 0];
  const orders = app.queue.map((order) => order.recipe);
  if (app.nextOrder < app.schedule.length && app.schedule[app.nextOrder].at - app.waveClock < 14) orders.push(app.schedule[app.nextOrder].recipe);
  for (const recipe of orders) RECIPES[recipe].need.forEach((n, j) => { need[j] += n; });
  const wants = (i) => {
    const p = app.pans[i];
    if (p.cooldown > 0) return false;
    if (p.state === "burnt" || p.state === "ready" && app.trays[i].length < app.trayMax()) return true;
    return p.state === "empty" && app.stock[i] > 0 && need[i] > app.trays[i].length;
  };
  // Ready food first (it burns), then a pan that needs starting.
  const order = [0, 1, 2].sort((a, b) => (app.pans[b].state === "ready") - (app.pans[a].state === "ready"));
  const target = order.find(wants);
  if (target !== undefined) use(target);
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

test("four lamps: the pans on lamps 1-3, the table closest to leaving on lamp 4", () => {
  const ctx = appContext(); ctx.lampCount = () => 4;
  const app = new Supper(ctx); tap(app); run(app, 0.2);
  let frame = ctx.calls.leds.at(-1);
  assert.equal(frame.length, 12);
  assert.ok(frame[0] > 100 && frame[1] > 30 && frame[2] < 40, "rice is cooking: amber, and brightest because you are on it");
  assert.ok(frame[10] > frame[9], "a patient table is green");
  app.queue[0].patience = app.queue[0].maxPatience * 0.1;
  let reds = 0;
  run(app, 1, () => { const f = ctx.calls.leds.at(-1); if (f[9] > 100 && f[10] < 60) reds++; });
  assert.ok(reds > 0, "a table about to leave blinks red");
  app.queue = []; run(app, 0.1); frame = ctx.calls.leds.at(-1);
  assert.deepEqual(frame.slice(9), [0, 0, 0], "no tables, lamp 4 dark");
  app.dispose(); assert.ok(ctx.calls.leds.at(-1).every((v) => v === 0));
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
