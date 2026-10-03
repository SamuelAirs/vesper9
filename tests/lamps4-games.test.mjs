// Orbit Lock, Ricochet and Light Trial on the four-lamp node: every frame is twelve valid values, and
// lamp IV has a job of its own in each game. On the three-lamp node they still write nine.
import test from "node:test";
import assert from "node:assert/strict";
import { OrbitLock, orbitWindow, RUSH_TIME, SHIELD_CHAIN } from "../web/apps/orbit.js";
import { Ricochet } from "../web/apps/ricochet.js";
import { LightTrial, SERIES } from "../web/apps/reaction.js";
import { makeCtx, step, DT } from "./audit/harness.mjs";
import { appContext, run } from "./helpers/app-context.mjs";

const four = (ctx) => { ctx.lampCount = () => 4; return ctx; };
// n lamps' worth of valid values. On four lamps an all-dark nine-value frame (the shared lamp bus's
// "off") is fine too: the host pads it to twelve with lamp IV dark.
const bytes = (v) => v.every((x) => Number.isInteger(x) && x >= 0 && x <= 255);
const valid = (v, n) => bytes(v) && (v.length === n * 3 || (n === 4 && v.length === 9 && v.every((x) => x === 0)));
const lamp = (v, i) => v.slice(i * 3, i * 3 + 3);
const lit = (rgb) => rgb.some((x) => x > 0);
const greenish = (rgb) => rgb[1] > rgb[0] && rgb[1] > rgb[2];
const reddish = (rgb) => rgb[0] > rgb[1] && rgb[0] > rgb[2];
const textOf = (g) => {
  const painted = [];
  const g2d = new Proxy({}, { get: (t, k) => (k === "fillText" ? (s) => painted.push(String(s)) : k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  g.draw(g2d);
  return painted;
};

// ---- Orbit Lock -------------------------------------------------------------------------------
const perfect = (g) => { g.target = g.angle; g.down(); g.up(); };
const plain = (g) => { g.target = g.angle + orbitWindow(g.points) * 0.9; g.down(); g.up(); };
const miss = (g) => { g.target = g.angle + 3; g.down(); g.up(); };

test("Orbit Lock: lamp IV fills with the perfect chain and breathes while the shield is charged", () => {
  const c = four(makeCtx(31)), g = new OrbitLock(c);
  g.down(); step(g, 0.5);
  assert.ok(valid(c.ledsNow, 4));
  assert.ok(!lit(lamp(c.ledsNow, 3)), "lamp IV lit before any chain");
  const levels = [];
  for (let i = 0; i < SHIELD_CHAIN - 1; i++) { perfect(g); step(g, 0.5); levels.push(g.shieldLamp()[2]); }
  assert.ok(levels.every((v, i) => i === 0 || v > levels[i - 1]), "lamp IV does not fill with the chain: " + levels);
  perfect(g);
  assert.equal(g.shield, 1);
  const seen = [];
  for (let i = 0; i < 90; i++) { g.update(DT); seen.push(lamp(c.ledsNow, 3)[2]); }
  assert.ok(Math.max(...seen) > Math.min(...seen), "a charged shield does not breathe on lamp IV");
  // The hull lamp stays the hull's colour (green with three hull points): the shield has moved to IV.
  assert.ok(greenish(lamp(g.lampValues(), 1)));
  // Every flash (a lock, a spent shield, a lost hull point, the end) is twelve valid values.
  miss(g); assert.ok(valid(c.ledsNow, 4)); plain(g); assert.ok(valid(c.ledsNow, 4));
  for (let i = 0; i < 3; i++) { miss(g); assert.ok(valid(c.ledsNow, 4)); }
  assert.equal(g.phase, "over");
  for (let i = 0; i < 60; i++) { g.update(DT); assert.ok(valid(c.ledsNow, 4)); }
});

test("Orbit Lock: in a rush lamp IV is the clock, green at the start and red near the end", () => {
  const c = four(makeCtx(32, { progress: { schema: 3, st: { best: 20 } } })), g = new OrbitLock(c);
  g.mode = "rush"; g.begin();
  assert.ok(greenish(g.shieldLamp()), "the rush clock does not start green");
  g.clock = 5;
  const reds = [];
  for (let i = 0; i < 60; i++) { g.t += DT; reds.push(g.shieldLamp()); }
  assert.ok(reds.every((rgb) => rgb[0] >= rgb[1]), "the last seconds are not red");
  assert.ok(new Set(reds.map((rgb) => rgb.join())).size > 1, "the last ten seconds do not blink");
  assert.ok(RUSH_TIME > 10);
});

test("Orbit Lock: the three-lamp node still gets nine values, with the shield on the hull lamp", () => {
  const c = makeCtx(33), g = new OrbitLock(c);
  g.down(); step(g, 0.3);
  for (let i = 0; i < SHIELD_CHAIN; i++) perfect(g);
  step(g, 0.3);
  assert.ok(valid(c.ledsNow, 3));
  const hull = [];
  for (let i = 0; i < 90; i++) { g.update(DT); hull.push(lamp(c.ledsNow, 1).join()); }
  assert.ok(new Set(hull).size > 1, "the charged shield no longer breathes on the hull lamp");
});

// ---- Ricochet ---------------------------------------------------------------------------------
function live(seed) {
  const ctx = four(appContext({ seed })), app = new Ricochet(ctx);
  app.down(); app.up();
  while (app.sub !== "live") run(app, 0.05);
  return { ctx, app };
}
// Put the ball on a straight drop to x, falling, with nothing in the way, and the paddle at px going dir.
function drop(app, x, px, dir) {
  app.cells.fill(0); app.cells[0] = { hp: 1, hard: false, bonus: "" }; app.remaining = 1;
  const b = app.balls[0];
  b.x = x; b.y = 330; b.vx = 0; b.vy = 300; b.dirty = true;
  app.px = px; app.dir = dir; app.turnT = 0;
  app.predict(b);
  return b;
}

test("Ricochet: lamp IV is the reach lamp: green when the paddle will meet the ball, red when a tap would", () => {
  const { app } = live(41);
  // Under the ball already, with the ball about to land: green.
  let b = drop(app, 480, 480, 1);
  b.y = 450; b.dirty = true; app.predict(b);
  assert.ok(greenish(app.reachLamp()), "under the ball, not green: " + app.reachLamp());
  // Under it but with the ball far above: the paddle will have glided away (and a tap does no
  // better), so amber, not green.
  b.y = 250; b.dirty = true; app.predict(b);
  assert.ok(!app.meets(b, 1) && !app.meets(b, -1));
  // Ball on the left, paddle to its right going right: leaving it misses, a tap would reach it.
  drop(app, 300, 420, 1);
  assert.ok(reddish(app.reachLamp()), "heading away, not red: " + app.reachLamp());
  assert.ok(app.meets(app.balls[0], -1) && !app.meets(app.balls[0], 1));
  // Ball on the left, paddle going left toward it: green.
  drop(app, 300, 420, -1);
  assert.ok(greenish(app.reachLamp()));
  // The frame itself carries it as lamp IV.
  const v = app.lampValues();
  assert.ok(valid(v, 4));
  assert.deepEqual(lamp(v, 3), app.reachLamp());
});

test("Ricochet: the reach lamp counts the walls: a paddle that will bounce back in time is green", () => {
  const { app } = live(42);
  const lo = Ricochet.GEOM.L + app.padW / 2;
  // Paddle near the left wall going left, ball just right of it falling slowly: the wall turns the
  // paddle round in time, so leaving it alone works.
  const b = drop(app, lo + 70, lo + 30, -1);
  b.y = 420; b.dirty = true; app.predict(b);
  // Without the bounce the paddle would be far left of the wall's reach, nowhere near the ball.
  assert.ok(Math.abs(app.px - app.padSpeedNow() * app.eta(b) - b.pred) > app.padW / 2 + 4);
  assert.ok(app.meets(b, -1), "the wall bounce was not counted");
  assert.ok(greenish(app.reachLamp()));
});

test("Ricochet: twelve valid values in every phase, the pick on lamps I and IV, dark with no ball", () => {
  const ctx = four(appContext({ seed: 43 })), app = new Ricochet(ctx);
  for (let i = 0; i < 30; i++) app.update(1 / 60);
  assert.ok(ctx.calls.leds.every((v) => valid(v, 4)));
  app.down(); app.up();
  run(app, 3);
  assert.ok(ctx.calls.leds.every((v) => valid(v, 4)));
  app.sub = "serve";
  assert.ok(!lit(app.reachLamp()), "the reach lamp is lit with no ball in play");
  app.offer = { ids: ["wide", "spare"], cur: 0, t: 0 }; app.sub = "pick";
  let v = app.lampValues();
  assert.ok(lamp(v, 0)[2] > lamp(v, 3)[2], "the left card is not on lamp I");
  app.offer.cur = 1; v = app.lampValues();
  assert.ok(lamp(v, 3)[2] > lamp(v, 0)[2], "the right card is not on lamp IV");
  assert.ok(!lit(lamp(v, 1)) && !lit(lamp(v, 2)));
  app.sub = "live"; app.lives = 0; app.end();
  run(app, 1);
  assert.ok(ctx.calls.leds.every((v) => valid(v, 4)));
});

// ---- Light Trial ------------------------------------------------------------------------------
function trial(g, ms) {
  g.down({});
  g.event({ type: "cue", trial: g.trial, at_us: 1e6, generation: 0 });
  g.down({ source: "simulator", at_us: 1e6 + ms * 1000, generation: 0 });
}

test("Light Trial: lamp IV and disc IV compare each trial with the best series", () => {
  const c = four(makeCtx(51)), g = new LightTrial(c);
  assert.match(c.log.hints.at(-1), /LIGHT II/);
  // Nothing to beat yet: lamp IV stays dark on the first trial.
  trial(g, 300);
  assert.equal(g.vs, null);
  assert.ok(valid(c.ledsNow, 4) && !lit(lamp(c.ledsNow, 3)));
  step(g, 3);
  for (let i = 0; i < SERIES - 1; i++) { trial(g, 300); step(g, 3); }
  assert.equal(g.sv.bs.simulator, 300);
  trial(g, 250);
  step(g, 0.5); // past the white sweep of a new best
  assert.ok(greenish(lamp(c.ledsNow, 3)), "a faster trial is not green on lamp IV");
  assert.ok(textOf(g).includes("FASTER THAN 300 ms"));
  step(g, 3);
  trial(g, 320);
  step(g, 0.5);
  assert.ok(lamp(c.ledsNow, 3)[0] > 0 && lamp(c.ledsNow, 3)[2] === 0 && g.vs.word.startsWith("CLOSE"), "a close trial is not amber");
  step(g, 3);
  trial(g, 420);
  step(g, 0.5);
  assert.ok(reddish(lamp(c.ledsNow, 3)), "a slower trial is not red on lamp IV");
  assert.ok(textOf(g).includes("IV"));
});

test("Light Trial: on four lamps the host writes nothing while armed, and the series chase covers all four", () => {
  const c = four(makeCtx(52)), g = new LightTrial(c);
  for (let i = 0; i < SERIES - 1; i++) { trial(g, 260); step(g, 3); }
  g.down({});
  let writes = 0; const leds = c.leds; c.leds = (v) => { writes++; leds(v); };
  step(g, 2);
  g.event({ type: "cue", trial: g.trial, at_us: 1e6, generation: 0 });
  step(g, 0.3);
  assert.equal(writes, 0, "the host wrote light while armed");
  assert.ok(textOf(g).includes("WAIT FOR LIGHT II") || g.phase === "go");
  g.down({ source: "simulator", at_us: 1.26e6, generation: 0 });
  const seen = [];
  for (let i = 0; i < 60 * 4; i++) { g.update(DT); seen.push(c.ledsNow.slice()); }
  assert.ok(seen.every((v) => valid(v, 4)));
  for (let k = 0; k < 4; k++) assert.ok(seen.some((v) => lit(lamp(v, k)) && [0, 1, 2, 3].every((j) => j === k || !lit(lamp(v, j)))), "the chase never reaches lamp " + (k + 1));
  assert.ok(c.ledsNow.every((v) => v === 0), "lamps lit after the series");
});
