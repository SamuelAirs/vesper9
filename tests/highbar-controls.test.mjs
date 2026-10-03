import test from "node:test";
import assert from "node:assert/strict";
import { HighBar } from "../web/apps/highbar.js";
import { CATCH_LAG, STYLE_TIME, GUIDE } from "../web/apps/highbar-content.js";
import { InputRouter, GESTURE_PACES } from "../web/engine/input.js";
import { appContext, run, fakeCanvas } from "./helpers/app-context.mjs";

const DT = 1 / 60;
function ride(pace = "standard") {
  const ctx = appContext({ lampCount: 4, boardLed: true, settings: { knock: "medium", gesturePace: pace } });
  const app = new HighBar(ctx); app.mode = 2; app.start(); return { app, ctx };
}
// These isolated input-state fixtures exercise intent at an exact post/height.
// They are not claimed as reachable authored-route recordings.
function air(app, near = true) {
  const [x, y] = app.park().bars[8];
  Object.assign(app.p, { mode: "air", support: null, x: near ? x : 750, y: near ? y + 120 : 700,
    vx: 120, vy: -40, rot: 0, rotV: 0, tuck: false, vert: 0, lastBar: -1, lastBarT: 9 });
  app.air = { t: .5, rot: 0, x0: app.p.x, xMin: app.p.x, xMax: app.p.x,
    y0: app.p.y, apex: app.p.y, fromBar: -1, ollie: true, vert: false, dir: 1 };
}
const edge = (at, extra = {}) => ({ source: "node", generation: 3, at_us: at * 1e6, ...extra });

test("ground holds skate even within reach; release ollies and ground case taps are inert", () => {
  const { app } = ride(); const [x] = app.park().bars[0];
  Object.assign(app.p, { x, y: app.groundY(x) });
  assert.equal(app.pickBar(), -1);
  app.knock(edge(0)); assert.equal(app.manual, null); assert.equal(app.tapAt, -Infinity);
  app.down(edge(0)); assert.equal(app.p.crouch, true); assert.equal(app.pending, null);
  run(app, .3); app.up(edge(.3));
  assert.equal(app.p.mode, "air"); assert.equal(app.air.ollie, true); assert.equal(app.lastButtonTap, null);
});

test("a plain held air press catches only on its fresh edge, never automatically flips or recatches", () => {
  const { app } = ride(); air(app); assert.equal(app.pickBar(), 8);
  app.down(edge(0)); assert.equal(app.pressAction, "catch"); assert.ok(app.pending);
  run(app, app.catchDelay() + DT); assert.equal(app.p.mode, "bar"); assert.equal(app.pressed, true);
  app.up(edge(.3)); assert.equal(app.p.mode, "air"); assert.equal(app.p.tuck, false);
  assert.equal(app.pending, null); run(app, .1); assert.notEqual(app.p.mode, "bar");
  const free = ride().app; air(free, false); free.pickBar = () => -1;
  free.down(edge(0)); run(free, .2); assert.equal(free.p.tuck, false); assert.equal(free.pending, null);
});

for (const [pace, duration] of [["quick", .11], ["standard", .12], ["relaxed", .18]]) test(`${pace}: a real quick first tap near a post leaves the trajectory unchanged before second-hold flip`, () => {
  const { app } = ride(pace), baseline = ride(pace).app; air(app); air(baseline);
  app.down(edge(1)); run(app, duration); run(baseline, duration);
  assert.equal(app.p.mode, "air"); assert.deepEqual(app.p, baseline.p, "first tap cannot catch, redirect or drain air momentum");
  app.up(edge(1 + duration)); assert.ok(app.pickBar() >= 0);
  app.down(edge(1 + duration + .1)); assert.equal(app.pressAction, "flip"); assert.equal(app.p.tuck, true);
  assert.equal(app.pending, null); run(app, .1); assert.equal(app.p.mode, "air");
  app.up(edge(1.6)); assert.equal(app.p.tuck, false);
});

for (const [pace, timings] of Object.entries(GESTURE_PACES)) {
  test(`${pace}: the first completed tap uses source duration; a USB burst still flips`, () => {
    for (const [duration, flip] of [[timings.tapMs - 1, true], [timings.tapMs + 1, false]]) {
      const { app } = ride(pace); air(app);
      app.down(edge(5)); app.up(edge(5 + duration / 1000, { durationMs: duration }));
      assert.equal(app.t, 0, "source edges arrive without a render-clock advance");
      app.down(edge(5 + duration / 1000 + .1));
      assert.equal(app.pressAction === "flip", flip); assert.equal(app.p.tuck, flip);
    }
  });
}

test("expired, reversed, foreign-generation and mixed-clock tap prefixes cannot trigger a flip", () => {
  for (const second of [edge(2), edge(.05), edge(.2, { source: "keyboard" }), edge(.2, { generation: 4 }), { source: "node", generation: 3 }]) {
    const { app } = ride(); air(app); app.down(edge(0)); app.up(edge(.1));
    app.down(second); assert.notEqual(app.pressAction, "flip"); assert.equal(app.p.tuck, false);
  }
  const { app } = ride(); air(app); app.down(edge(0)); app.up(edge(.1, { source: "keyboard" }));
  assert.equal(app.pressed, true, "a foreign release cannot detach the source-owned hold");
  app.up(edge(.1)); assert.equal(app.pressed, false);
});

test("a short ground ollie can lead into a flip; a longer ground release preserves fresh catch intent", () => {
  for (const [duration, flip] of [[.1, true], [.3, false]]) {
    const { app } = ride(); app.down(edge(1)); app.up(edge(1 + duration));
    assert.equal(app.p.mode, "air"); app.down(edge(1 + duration + .1));
    assert.equal(app.pressAction === "flip", flip);
  }
});

test("cancel, pause and resume clear tap intent and pending catch without corrupting deck support", () => {
  for (const operation of ["cancel", "pause", "resume"]) {
    const { app } = ride(); air(app); app.down(edge(0)); app.up(edge(.1)); app[operation]();
    assert.equal(app.lastButtonTap, null); assert.equal(app.pressInput, null); assert.equal(app.pressAction, null);
    app.resumeT = 0; app.down(edge(.2)); assert.notEqual(app.pressAction, "flip");
    app.cancel(); app.up(edge(.3)); assert.equal(app.pressed, false);
    air(app); app.down(edge(.4)); assert.ok(app.pending); app[operation]();
    assert.equal(app.pending, null); assert.equal(app.pressed, false); assert.equal(app.p.tuck, false);
    const deck = app.park().platforms[0]; Object.assign(app.p, { mode: "ground", support: deck.id, crouch: false, tuck: false });
    app.pause(); app.resume(); assert.equal(app.p.support, deck.id);
  }
});

for (const pace of Object.keys(GESTURE_PACES)) test(`${pace}: universal two completed taps then third hold rewinds gameplay`, () => {
  const { app, ctx } = ride(pace); let now = 0, menus = 0, open = false;
  let router; const host = { epoch: 0, holdMs: () => 650, escapePolicy: () => ({ pace }), inputMode: () => open ? "menu" : "raw",
    pressVisual() {}, holdVisual() {}, clickVisual() {}, advance() {}, select() {},
    rawDown: e => app.down(e), rawUp: e => app.up(e), rawCancel: () => app.cancel(),
    requestMenu() { menus++; router.cancel(true, "node"); ctx.cancelGesture = () => true; app.cancel(); app.pause(); open = true; host.epoch++; } };
  router = new InputRouter(host, () => now);
  const before = structuredClone({ p: app.p, score: app.score, stats: app.stats, save: app.save, combo: app.combo });
  const tick = seconds => { for (let n = 0; n < Math.round(seconds * 60) && !open; n++) { now += 1000 / 60; router.update(); if (!open) app.update(DT); } };
  const emit = k => router[k](edge(now / 1000));
  for (let n = 0; n < 2; n++) { emit("down"); tick(.05); emit("up"); tick(.05); }
  emit("down"); tick(2);
  assert.equal(menus, 1); assert.deepEqual(app.p, before.p); assert.deepEqual(app.stats, before.stats);
  assert.equal(app.score, before.score); assert.deepEqual(app.save, before.save); assert.deepEqual(app.combo, before.combo);
  assert.equal(app.lastButtonTap, null); assert.equal(ctx.calls.saved.length, 0);
  router.up(edge(now / 1000 + .1)); app.resume(); run(app, .6); assert.equal(app.pressed, false); assert.equal(app.p.tuck, false);
});

test("confirmed USB menu bursts rewind the source sequence even when no simulation frames intervene", () => {
  const { app, ctx } = ride(); const before = structuredClone(app.p);
  app.down(edge(1)); app.up(edge(1.06)); app.down(edge(1.12)); app.up(edge(1.18)); app.down(edge(1.24));
  ctx.cancelGesture = () => true; app.cancel(); app.pause(); assert.deepEqual(app.p, before);
  assert.equal(app.lastButtonTap, null); assert.equal(app.pending, null); assert.equal(app.pressed, false);
});

test("generic air taps upgrade one shove into one kickflip, with a fresh completion window and no double score", () => {
  const { app } = ride(); air(app, false); assert.equal(app.canStyle(), true);
  app.knock(edge(1)); assert.equal(app.air.style.kind, "shove");
  app.air.t += .2; app.knock(edge(1.2)); assert.equal(app.air.style.kind, "kickflip");
  const at = app.air.style.at; app.knock(edge(1.35)); assert.equal(app.air.style.at, at);
  app.air.t = at + STYLE_TIME + .01; app.endAir(false);
  assert.equal(app.combo.tricks.filter(t => t.name === "KICKFLIP").length, 1);
  assert.equal(app.combo.tricks.filter(t => t.name === "SHOVE-IT").length, 0); assert.equal(app.combo.shove, true);
  assert.equal(app.air, null); app.knock(edge(1.4)); assert.equal(app.combo.tricks.filter(t => t.name === "KICKFLIP").length, 1);
});

test("kickflip upgrade requires the same air, matching source clock, 120–450ms and enough clearance", () => {
  for (const second of [edge(1.1), edge(1.46), edge(1.2, { source: "keyboard" }), edge(1.2, { generation: 4 })]) {
    const { app } = ride(); air(app, false); app.knock(edge(1)); app.knock(second); assert.equal(app.air.style.kind, "shove");
  }
  const { app } = ride(); air(app, false); app.knock(edge(1));
  const deck = app.park().platforms[0]; Object.assign(app.p, { x: deck.x1 + 20, y: deck.y - 2, vy: 300 });
  app.knock(edge(1.2)); assert.equal(app.air.style.kind, "shove");
  app.air.t += STYLE_TIME - .01; app.endAir(false); assert.equal(app.combo.tricks.some(t => t.name === "SHOVE-IT"), false);
});

test("bar regrips add style without changing speed; release advice and lamps have no build-duration promise", () => {
  const { app } = ride(); air(app); app.grab(8); app.p.held = 1;
  const om = app.p.om; app.knock(edge(1)); assert.equal(app.p.regrip, true); assert.equal(app.p.om, om);
  const before = app.releaseAdvice(); app.p.held = 0; assert.deepEqual(app.releaseAdvice(), before);
  assert.notEqual(before.phase, "build");
  const ground = ride().app; assert.deepEqual(ground.restingLamps().slice(9), [0, 0, 0]);
  const words = GUIDE.flat().join(" "); assert.doesNotMatch(words, /manual|regrip boost|hold to build height/i);
  ground.draw(fakeCanvas());
});

test("catch cues describe fresh edges, pause grace, and decks stop the practice trajectory", () => {
  const { app } = ride(); air(app);
  const g = fakeCanvas(), words = []; g.fillText = s => words.push(String(s));
  app.drawCoach(g); assert.ok(words.some(s => /PRESS \+ HOLD: B/.test(s)));
  app.pressed = true; app.pending = null; words.length = 0; app.drawCoach(g);
  assert.ok(words.some(s => /RELEASE \/ PRESS: B/.test(s)), "continuing a stale hold cannot catch");
  app.resumeT = .5; words.length = 0; app.drawCoach(g);
  assert.ok(words.includes("RESUMING / RELEASE BUTTON")); assert.ok(!words.includes("RELEASE TO RESUME"));
  app.resumeT = 0; const deck = app.park().platforms[0];
  Object.assign(app.p, { mode: "air", x: (deck.x1 + deck.x2) / 2, y: deck.y - 40, vx: 0, vy: 300 });
  const points = []; g.fillRect = (x, y) => points.push([x, y]); app.drawTrajectory(g);
  assert.ok(points.length > 0 && points.length < 18); assert.ok(points.every(q => q[1] < deck.y));
});
