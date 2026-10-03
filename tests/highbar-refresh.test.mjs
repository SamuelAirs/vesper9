import test from "node:test";
import assert from "node:assert/strict";
import { HighBar } from "../web/apps/highbar.js";
import { PARKS, LAND_TOL } from "../web/apps/highbar-content.js";
import { appContext, run } from "./helpers/app-context.mjs";

const DT = 1 / 60;
// Actual recorded ordinary Bowl drop-in. No physics/trick/score injection.
const GOLD_LINK = "D0 U42 D48 T54 U90 D96 T108 U144 T150 T192 D192 U234 D240 T252 U288 T294";
const FIRST_FLIGHT = "D0 U42 D48 U84 D90 U192 D264";
function ride(mode = 0, options = {}) {
  const ctx = appContext({ settings: { knock: "medium" }, ...options });
  const app = new HighBar(ctx); app.slot().guided = true; app.mode = mode; app.start();
  return { app, ctx };
}
function replay(app, input = GOLD_LINK, frames = 394) {
  const events = input.split(" ").map(s => [+s.slice(1), s[0]]); let next = 0;
  for (let frame = 0; frame < frames && app.phase === "play"; frame++) {
    while (events[next]?.[0] === frame) {
      const [, action] = events[next++];
      if (action === "D") app.down({ source: "node" });
      else if (action === "U") app.up({ source: "node", durationMs: (app.t - app.pt) * 1000 });
      else app.knock();
    }
    app.update(DT);
  }
}

test("all four FLAT SCHOOL starts are grounded and teach the ground action without a bar stealing the hold", () => {
  for (let park = 0; park < PARKS.length; park++) {
    const { app, ctx } = ride(2); app.parkId = park; app.practiceStart = 1; app.start();
    assert.equal(app.practiceLabel(), "FLAT SCHOOL"); assert.equal(app.p.mode, "ground");
    assert.equal(app.p.y, app.groundY(app.p.x)); assert.equal(app.pickBar(), -1);
    app.down({ source: "node" }); assert.equal(app.p.crouch, true); assert.equal(app.pending, null);
    run(app, 0.1); app.up({ source: "node", durationMs: 100 });
    assert.equal(app.p.mode, "air"); assert.equal(app.air.ollie, true);
    app.guard.settle(); assert.equal(ctx.calls.saved.length, 0);
  }
});

test("a real linked combo earns all three Bowl gold medals without changing legacy scoring", () => {
  const { app, ctx } = ride(1); app.slot().line = 2; app.start(); replay(app); app.guard.settle();
  assert.equal(app.score, 7150); assert.equal(app.stats.banks, 1);
  assert.equal(app.lastBank.variety, 5); assert.equal(app.lastBank.clean, 2);
  assert.deepEqual(app.slot().lineMedals[0], [3, 3, 3]); assert.equal(app.masteryCount(), 9);
  assert.deepEqual(app.slot().lineComboBest[0], [7150, 7150, 7150]);
  assert.deepEqual(app.slot().lineTimeBest[0], [0, 0, 6.53]);
  assert.equal(app.slot().runs, 0); assert.deepEqual(app.slot().lineBest[0], [0, 0, 0]);
  assert.equal(ctx.calls.score.length, 0); assert.ok(ctx.calls.saved.length > 0);
  app.finish();
  assert.equal(app.slot().lineBest[0][2], 7150); assert.equal(app.slot().runs, 1);
  assert.equal(ctx.calls.score.length, 0, "line attempts retain their existing private-record class");
});

test("practice checkpoints restore a real bank safely, identify the selected start and remain RAM only", () => {
  const { app, ctx } = ride(2), before = structuredClone(app.save);
  replay(app, FIRST_FLIGHT, 264); const checkpoint = structuredClone(app.practiceCheckpoint);
  assert.ok(checkpoint && checkpoint.park === 0); assert.equal(app.p.mode, "ground");
  app.resetPractice(true);
  assert.equal(app.p.x, checkpoint.x); assert.equal(app.p.s, checkpoint.s);
  assert.equal(app.practiceLabel(), "LAST SAFE BANK"); assert.equal(app.pickBar(), -1);
  assert.equal(app.score, 0); assert.equal(app.stats.banks, 0); assert.ok(app.resumeT > 0);
  run(app, 0.6); assert.equal(app.resumeT, 0); app.down({ source: "node" });
  assert.equal(app.p.crouch, true); app.cancel(); app.dispose();
  assert.deepEqual(app.save, before); assert.equal(ctx.calls.saved.length, 0); assert.equal(ctx.calls.score.length, 0);
  const fresh = new HighBar(ctx); assert.equal(fresh.practiceCheckpoint, null);
});

test("half-speed practice uses half simulation time while keeping AppGuard and app input clocks real", () => {
  const normal = ride(2).app, slow = ride(2).app;
  slow.practiceSlow = true;
  for (let frame = 0; frame < 90; frame++) { normal.update(DT); slow.update(DT * 2); }
  for (const key of ["x", "y", "s", "vx", "vy", "rot"]) assert.ok(Math.abs(normal.p[key] - slow.p[key]) < 1e-9, key);
  assert.ok(Math.abs(normal.runTime - slow.runTime) < 1e-9);
  assert.ok(Math.abs(slow.t - normal.t * 2) < 1e-9);
  assert.ok(Math.abs(slow.guard.t - slow.t) < 1e-9);
  assert.equal(slow.clock, 120);
  slow.mode = 1; slow.start(); slow.update(DT);
  assert.ok(Math.abs(slow.runTime - DT) < 1e-9); assert.ok(Math.abs(slow.clock - (45 - DT)) < 1e-9);
});

test("camera easing has the same elapsed-time response across render rates and looks ahead in either direction", () => {
  const cameras = [30, 60, 120].map(hz => {
    const { app } = ride(2); Object.assign(app.p, { mode: "ground", x: 950, y: app.groundY(950), s: 400 });
    app.camX = 0; app.camY = -300;
    for (let frame = 0; frame < hz; frame++) app.placeCamera(false, 1 / hz);
    return app;
  });
  for (const app of cameras.slice(1)) {
    assert.ok(Math.abs(app.camX - cameras[0].camX) < 1e-9);
    assert.ok(Math.abs(app.camY - cameras[0].camY) < 1e-9);
  }
  const app = cameras[0]; app.p.s = 500; app.placeCamera(true); const right = app.camX;
  app.p.s = -500; app.placeCamera(true); assert.ok(right > app.camX);
  Object.assign(app.p, { mode: "air", vx: 10000, vy: -10000 }); app.placeCamera(true);
  assert.ok(app.camX <= PARKS[0].w - 960); assert.ok(app.camY >= Math.min(0, PARKS[0].h - 540) - 360);
});

test("landing feedback reports the actual clean, safe, sketchy or bail judgement on normal and shove landings", () => {
  for (const style of [false, true]) for (const [off, kind] of [[0.1, "clean"], [0.45, "safe"], [0.76, "sketchy"], [1.01, "bail"]]) {
    const { app } = ride(2), tol = LAND_TOL * (style ? 0.7 : 1);
    Object.assign(app.p, { mode: "air", x: 750, vx: 250, vy: 80, rot: Math.atan(app.slope(750)) + off * tol });
    app.air = { t: 0.5, rot: 0, x0: 750, xMin: 750, xMax: 750, y0: app.p.y, apex: app.p.y, fromBar: -1, ollie: true, vert: false, dir: 1,
      ...(style ? { style: { at: 0, dir: 1 } } : {}) };
    app.land(); assert.equal(app.landing.kind, kind, `${style ? "shove" : "normal"} ${off}`);
    assert.ok(Math.abs(app.landing.off - off * tol) < 1e-9);
    assert.equal(app.combo.cleanLandings, kind === "clean" ? 1 : 0);
    assert.equal(app.combo.sketchy, kind === "sketchy" ? 1 : 0);
    if (kind === "bail") assert.match(app.landing.reason, /RELEASE EARLIER/);
  }
});

test("ground speed lamp ignores stale airborne velocity and follows actual ground speed", () => {
  const { app } = ride(2, { lampCount: 4 });
  Object.assign(app.p, { mode: "ground", s: 150, vx: 900, vy: -1000 });
  const slow = app.restingLamps().slice(0, 3);
  app.p.vx = -10; app.p.vy = 10; assert.deepEqual(app.restingLamps().slice(0, 3), slow);
  app.p.s = -600; assert.ok(app.restingLamps().slice(0, 3).some((v, i) => v > slow[i]));
});

test("improving an existing line medal celebrates on the board and ends within its bound", () => {
  const { app, ctx } = ride(1, { boardLed: true });
  app.slot().goals[0] = [0, 1, 2, 3, 4]; app.slot().lines[0] = [0, 1, 2];
  app.slot().lineMedals[0] = [1, 1, 1]; app.slot().line = 2; app.start(); replay(app);
  assert.equal(app.lastBank.newMedal, true); assert.ok(app.board > 0.9 && app.board <= 1.2);
  assert.ok(ctx.calls.board.some(rgb => rgb.some(v => v > 0)));
  run(app, 1.3); assert.equal(app.board, 0); assert.deepEqual(ctx.calls.board.at(-1), [0, 0, 0]);
});
