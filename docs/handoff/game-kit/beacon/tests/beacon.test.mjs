// Beacon: rules, save migration, and a smoke run of draw(). Runs with: node --test tests/beacon.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { Beacon, migrateSave, WINDOW } from "../web/apps/beacon.js";
import { appContext, fakeCanvas, run } from "./helpers/app-context.mjs";

const press = (app) => { app.down({ source: "keyboard" }); app.up({ source: "keyboard", durationMs: 60 }); };

test("a press on the middle lamp catches; three presses off it end the run and save", () => {
  const ctx = appContext();
  const app = new Beacon(ctx);
  press(app);                                   // title -> play
  assert.equal(app.phase, "play");
  app.pos = 0.5; press(app);
  assert.equal(app.catches, 1);
  for (let i = 0; i < 3; i++) { app.pos = 0.05; press(app); }
  assert.equal(app.phase, "over");
  run(app, 3);                                  // let AppGuard release the held score and save
  assert.deepEqual(ctx.calls.score.at(-1), [100, "default"]);
  assert.equal(ctx.calls.saved.at(-1).runs, 1);
});

test("the timing offset judges where the light was when the player pressed", () => {
  const ctx = appContext({ settings: { latencyMs: 100 } });
  const app = new Beacon(ctx);
  press(app);
  app.dir = 1; app.pos = 0.5 + WINDOW + 0.05;   // just past the zone now, inside it 100 ms ago
  press(app);
  assert.equal(app.catches, 1);
});

test("any stored shape migrates to schema 1", () => {
  for (const raw of [undefined, null, 7, "x", {}, { runs: -3, bestStreak: "a" }, { schema: 1, runs: 4, bestStreak: 9 }]) {
    const s = migrateSave(raw);
    assert.equal(s.schema, 1);
    assert.ok(Number.isInteger(s.runs) && s.runs >= 0);
  }
  assert.equal(migrateSave({ schema: 1, runs: 4, bestStreak: 9 }).bestStreak, 9);
});

test("a minute of play draws without throwing and stays inside its lamps contract", () => {
  const ctx = appContext();
  const app = new Beacon(ctx), g = fakeCanvas();
  run(app, 60, (i) => { if (i % 37 === 0) press(app); if (i % 10 === 0) app.draw(g); });
  for (const v of ctx.calls.leds) assert.ok(v.length === 9 && v.every((x) => Number.isInteger(x) && x >= 0 && x <= 255));
  app.dispose();
});
