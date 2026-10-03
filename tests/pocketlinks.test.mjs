import test from "node:test";
import assert from "node:assert/strict";
import { PocketLinks, GUIDE, migrateSave, makeCourse, shotBall, stepBall, powerAt, surfaceAt, COURSE_W, COURSE_H, BALL_R, HOLD_THRESHOLD, CHARGE_SECONDS, AIM_SPEED, MAX_STROKES } from "../web/apps/pocketlinks.js";
import { HOLD } from "../web/apps/after-hours-kit.js";
import { appContext as baseContext, fakeCanvas, run } from "./helpers/app-context.mjs";

// Players who have seen HOW TO PLAY; the guide itself has its own test.
const appContext = (options = {}) => baseContext({ progress: { schema: 1, guided: true }, ...options });

const press = (app, seconds = 0.07) => { app.down({ source: "keyboard" }); run(app, seconds); app.up({ source: "keyboard", durationMs: seconds * 1000 }); };
const flat = () => ({ tee: { x: 70, y: 160 }, cup: { x: 620, y: 50 }, walls: [], patches: [] });
function roll(ball, course, seconds = 14) { for (let i = 0; i < seconds * 120 && !ball.stopped; i++) stepBall(ball, course, 1 / 120); return ball; }

test("launch release cannot shoot; short taps change clubs; deliberate hold-release shoots once", () => {
  const app = new PocketLinks(appContext());
  press(app, 1.4);
  assert.equal(app.phase, "play"); assert.equal(app.stage, "aim"); assert.equal(app.strokes, 0);
  press(app, 0.08); assert.equal(app.club, 1); assert.equal(app.strokes, 0);
  run(app, 0.6); press(app, 0.08); assert.equal(app.club, 0);
  run(app, 0.6); press(app, 1.8); assert.equal(app.strokes, 1); assert.equal(app.stage, "rolling");
  app.up({ durationMs: 2000 }); assert.equal(app.strokes, 1);
});

test("calibration offsets the locked aiming angle and judged power, clamped safely", () => {
  const app = new PocketLinks(appContext({ settings: { latencyMs: 100 } }));
  press(app); run(app, 1);
  const angle = app.aimAt();
  app.down({}); assert.ok(Math.abs(app.lockedAim - (angle - AIM_SPEED * 0.1)) < 1e-9);
  run(app, 1.5); app.up({ durationMs: 1500 });
  const expectedPower = powerAt(1.4), expectedSpeed = 36 + expectedPower * 342;
  assert.ok(Math.abs(Math.hypot(app.ball.vx, app.ball.vy) - expectedSpeed) < 1e-7);
  assert.equal(new PocketLinks(appContext({ settings: { latencyMs: 10000 } })).latency(), 0.3);
  assert.equal(new PocketLinks(appContext({ settings: { latencyMs: "junk" } })).latency(), 0);
});

test("the charge rises and falls slowly, with no punitive timing cliff", () => {
  assert.equal(powerAt(HOLD_THRESHOLD), 0);
  assert.equal(powerAt(HOLD_THRESHOLD + CHARGE_SECONDS), 1);
  assert.ok(Math.abs(powerAt(HOLD_THRESHOLD + CHARGE_SECONDS * 2)) < 1e-8);
  assert.ok(Math.abs(powerAt(1) - powerAt(1.1)) < 0.04);
});

test("putts bank from real interior and outer geometry; a wedge clears an interior wall", () => {
  const c = flat(); c.walls = [{ x: 150, y: 110, w: 20, h: 100 }];
  const putt = shotBall(70, 160, 0, 0.7, 0), wedge = shotBall(70, 160, 0, 0.7, 1);
  for (let i = 0; i < 60; i++) { stepBall(putt, c, 1 / 120); stepBall(wedge, c, 1 / 120); }
  assert.ok(putt.banks > 0); assert.ok(putt.vx < 0); assert.ok(wedge.x > 170); assert.equal(wedge.banks, 0); assert.ok(wedge.flight > 0);
  const outer = shotBall(660, 160, 0, 0.7, 0); roll(outer, flat());
  assert.ok(outer.banks >= 1); assert.ok(outer.x >= BALL_R && outer.x <= COURSE_W - BALL_R);
});

test("sand and rough shorten the roll; ice lengthens it; slopes bend a putt", () => {
  const c = flat(); c.cup = { x: 620, y: 290 };
  const distances = {};
  for (const kind of ["green", "sand", "rough", "ice"]) {
    const terrain = { ...c, patches: kind === "green" ? [] : [{ x: 0, y: 0, w: 680, h: 328, type: kind }] };
    distances[kind] = roll(shotBall(40, 160, 0, 0.38, 0), terrain).x;
  }
  assert.ok(distances.sand < distances.rough); assert.ok(distances.rough < distances.green); assert.ok(distances.green < distances.ice);
  const slope = { ...c, patches: [{ x: 0, y: 0, w: 680, h: 328, type: "slope", ax: 0, ay: 30 }] };
  const b = roll(shotBall(40, 130, 0, 0.45, 0), slope);
  assert.ok(b.y > 140); assert.ok(b.stopped);
});

test("soft shots drop into the cup; fast putts may pass over it; airborne balls cannot hole", () => {
  const c = flat(); c.cup = { x: 130, y: 160 };
  const soft = roll(shotBall(80, 160, 0, 0.24, 0), c);
  assert.equal(soft.status, "holed");
  const hard = shotBall(110, 160, 0, 1, 0);
  for (let i = 0; i < 12; i++) stepBall(hard, c, 1 / 120);
  assert.notEqual(hard.status, "holed"); assert.ok(hard.x > 140);
  const airborne = shotBall(110, 160, 0, 0.3, 1);
  for (let i = 0; i < 25; i++) stepBall(airborne, c, 1 / 120);
  assert.notEqual(airborne.status, "holed"); assert.ok(airborne.flight > 0);
});

test("water offers either one penalty or a limited mulligan that refunds the shot", () => {
  const app = new PocketLinks(appContext()); press(app);
  app.course = flat(); app.course.patches = [{ x: 130, y: 100, w: 70, h: 120, type: "water" }];
  app.ball.x = 70; app.ball.y = 160; app.shoot(0.6, 0); run(app, 1);
  assert.equal(app.stage, "water"); assert.equal(app.strokes, 1);
  run(app, 0.7); press(app, 0.75);
  assert.equal(app.stage, "aim"); assert.equal(app.mulligans, 2); assert.equal(app.strokes, 0); assert.equal(app.ball.x, 70);
  app.shoot(0.6, 0); run(app, 1); run(app, 0.7); press(app);
  assert.equal(app.strokes, 2); assert.equal(app.mulligans, 2); assert.equal(app.stage, "aim");
});

test("all courses have clear tee/cup lies across their seeded variations", () => {
  for (let hole = 0; hole < 9; hole++) for (let variant = 0; variant < 256; variant++) {
    const c = makeCourse(hole, variant);
    for (const p of [c.tee, c.cup]) {
      assert.ok(p.x >= 29 && p.x <= COURSE_W - 29 && p.y >= 29 && p.y <= COURSE_H - 29);
      assert.notEqual(surfaceAt(c, p.x, p.y)?.type, "water");
      assert.ok(!c.walls.some((w) => p.x > w.x - BALL_R && p.x < w.x + w.w + BALL_R && p.y > w.y - BALL_R && p.y < w.y + w.h + BALL_R));
    }
  }
});

test("nine physically sunk holes produce a complete scorecard and exactly one bounded save", () => {
  const ctx = appContext(), app = new PocketLinks(ctx); press(app);
  for (let hole = 0; hole < 9; hole++) {
    assert.equal(app.hole, hole);
    app.ball.x = app.course.cup.x - 18; app.ball.y = app.course.cup.y;
    app.shoot(0.05, 0); run(app, 0.8);
    assert.equal(app.card.length, hole + 1); assert.equal(app.card[hole].strokes, 1);
    if (hole < 8) { run(app, 0.7); press(app); }
  }
  assert.equal(app.phase, "over"); run(app, 3);
  assert.equal(ctx.calls.score.length, 1); assert.equal(ctx.calls.saved.length, 1);
  assert.equal(ctx.calls.saved[0].runs, 1); assert.equal(ctx.calls.saved[0].last.holes, 9); assert.equal(ctx.calls.saved[0].last.aces, 9);
  assert.ok(JSON.stringify(ctx.calls.saved[0]).length < 1024);
  app.end(); app.dispose(); assert.equal(ctx.calls.saved.length, 1);
});

test("stroke cap advances a hard hole instead of trapping the player; result lockout is respected", () => {
  const ctx = appContext(), app = new PocketLinks(ctx); press(app);
  app.strokes = MAX_STROKES - 1; app.shoot(0, Math.PI); run(app, 2);
  assert.equal(app.stage, "card"); assert.equal(app.card[0].picked, true);
  app.hole = 8; app.ready(); app.strokes = 4; app.finishHole();
  assert.equal(app.phase, "over"); app.down({}); app.up({ durationMs: 70 }); assert.equal(app.phase, "over");
  run(app, 0.7); press(app); assert.equal(app.phase, "play"); assert.equal(app.hole, 0); assert.equal(app.strokes, 0);
});

test("malformed saves normalize and never preserve unbounded or circular input", () => {
  const circular = {}; circular.last = circular;
  for (const input of [null, undefined, 3, "junk", [], circular, { runs: Infinity, last: { score: NaN, aces: 99999 }, milestone: -4 }, { bestStrokes: "42", last: new Array(10000).fill("junk") }]) {
    const s = migrateSave(input); assert.equal(s.schema, 1); assert.ok(Number.isInteger(s.runs)); assert.ok(s.runs >= 0);
    assert.ok(JSON.stringify(s).length < 1024); assert.ok(s.last.aces >= 0 && s.last.aces <= 9);
  }
  assert.equal(migrateSave({ runs: 4, bestStrokes: 31 }).bestStrokes, 31);
  assert.deepEqual(migrateSave(migrateSave(undefined)), migrateSave(undefined));
});

test("a displayed charge preview and the released shot share the same complete trajectory", () => {
  const app = new PocketLinks(appContext()); press(app);
  for (let hole = 0; hole < 9; hole++) for (const club of [0, 1]) {
    app.course = makeCourse(hole, 5); app.ball.x = app.course.tee.x; app.ball.y = app.course.tee.y;
    app.club = club; app.stage = "charge"; app.power = 0.78;
    app.lockedAim = Math.atan2(app.course.cup.y - app.ball.y, app.course.cup.x - app.ball.x);
    app.makePreview(); const predicted = { ...app.previewEnd };
    const actual = roll(shotBall(app.ball.x, app.ball.y, app.lockedAim, app.power, club), app.course);
    assert.equal(predicted.status, actual.status);
    assert.ok(Math.abs(predicted.x - actual.x) < 0.01 && Math.abs(predicted.y - actual.y) < 0.01);
  }
});

test("menu gesture rewinds club, stroke, aim, RNG and progress without a phantom shot", () => {
  const ctx = appContext(), app = new PocketLinks(ctx); press(app); run(app, 0.8);
  const before = app.guard.snapshot().saved, seed = ctx.rng.state;
  press(app, 0.067); run(app, 0.05); press(app, 0.067); run(app, 0.05);
  app.down({}); run(app, 1.05); app.cancel(); app.pause(); app.resume();
  const after = app.guard.snapshot().saved;
  for (const key of ["held", "consume"]) { delete before[key]; delete after[key]; }
  assert.deepEqual(after, before); assert.equal(ctx.rng.state, seed); assert.equal(ctx.calls.saved.length, 0);
  assert.equal(app.stage, "aim");
});

test("cancelling an ordinary charging hold drops it without spending a stroke", () => {
  const app = new PocketLinks(appContext()); press(app); run(app, 0.8); app.down({}); run(app, 0.8); app.cancel();
  assert.equal(app.stage, "aim"); assert.equal(app.strokes, 0); app.up({ durationMs: 1200 }); assert.equal(app.strokes, 0);
});

test("landing inside a wall joined to the cushion is resolved back onto the course", () => {
  const c = makeCourse(2, 0), b = shotBall(214, 5, 0, 0.5, 1);
  b.flight = 0.001; b.vx = 1; b.vy = 1;
  roll(b, c);
  assert.ok(b.stopped); assert.ok(b.x >= BALL_R && b.x <= COURSE_W - BALL_R); assert.ok(b.y >= BALL_R && b.y <= COURSE_H - BALL_R);
  assert.ok(!c.walls.some((w) => b.x > w.x && b.x < w.x + w.w && b.y > w.y && b.y < w.y + w.h));
});

test("two minutes of seeded variable play draw safely; lamps are finite, quiet on pause and off at exit", () => {
  const ctx = appContext({ seed: 42 }), app = new PocketLinks(ctx), g = fakeCanvas();
  let heldUntil = -1;
  for (let f = 0; f < 7200; f++) {
    if (f === heldUntil) { app.up({ durationMs: (f % 137 + 40) * 17 }); heldUntil = -1; }
    if (heldUntil < 0 && f % 91 === 0) { app.down({}); heldUntil = f + (f % 127) + 5; }
    app.update(1 / 60); if (f % 4 === 0) app.draw(g);
    assert.ok(Number.isFinite(app.ball.x) && Number.isFinite(app.ball.y));
  }
  for (const values of ctx.calls.leds) assert.ok(values.length === 9 && values.every((v) => Number.isInteger(v) && v >= 0 && v <= 255));
  app.pause(); const writes = ctx.calls.leds.length; run(app, 1); assert.equal(ctx.calls.leds.length, writes);
  app.resume(); app.dispose(); assert.deepEqual(ctx.calls.leds.at(-1), Array(9).fill(0));
});

test("first launch shows HOW TO PLAY once; the menu reopens it without losing the hole", () => {
  const ctx = baseContext(), app = new PocketLinks(ctx);
  press(app); assert.equal(app.guide, 0); assert.equal(app.phase, "title");
  press(app); assert.equal(app.guide, -1); assert.equal(app.phase, "play", GUIDE.length + " page guide, then the first tee");
  run(app, 3); assert.equal(ctx.calls.saved.at(-1).guided, true);
  const again = new PocketLinks(baseContext({ progress: ctx.calls.saved.at(-1) }));
  press(again); assert.equal(again.phase, "play");
  run(again, 0.5); press(again, 1.5); run(again, 0.2);
  const strokes = again.strokes, ball = { ...again.ball };
  again.menuActions()[0].run(); run(again, 4);
  assert.deepEqual({ x: again.ball.x, y: again.ball.y }, { x: ball.x, y: ball.y }, "the ball waits while the guide is open");
  press(again, HOLD + 0.1); assert.equal(again.guide, -1); assert.equal(again.strokes, strokes);
  assert.equal(migrateSave({ runs: 1 }).guided, false);
});

test("lamp 4 says where the shot will stop: green in the cup, red in the water", () => {
  const ctx = appContext(); ctx.lampCount = () => 4;
  const app = new PocketLinks(ctx); press(app); run(app, 0.3);
  assert.equal(ctx.calls.leds.at(-1).length, 12);
  app.previewEnd = { x: app.course.cup.x, y: app.course.cup.y, status: "holed" }; app.previewAt = app.t;
  app.update(1 / 60); let f = ctx.calls.leds.at(-1);
  assert.ok(f[10] > 150 && f[9] < 80, "holed: green");
  app.previewEnd = { x: 10, y: 10, status: "water" }; app.previewAt = app.t;
  app.update(1 / 60); f = ctx.calls.leds.at(-1);
  assert.ok(f[9] > 150 && f[10] < 40, "water: red");
  app.previewEnd = { x: app.course.cup.x - 20, y: app.course.cup.y, status: "stopped" }; app.previewAt = app.t;
  app.update(1 / 60); const near = ctx.calls.leds.at(-1)[9];
  app.previewEnd = { x: app.course.tee.x, y: app.course.tee.y, status: "stopped" }; app.previewAt = app.t;
  app.update(1 / 60); const far = ctx.calls.leds.at(-1)[9];
  assert.ok(near > far, "warmer the closer it stops to the cup");
  app.dispose(); assert.ok(ctx.calls.leds.at(-1).every((v) => v === 0));
});
