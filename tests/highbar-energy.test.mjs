import test from "node:test";
import assert from "node:assert/strict";
import { HighBar } from "../web/apps/highbar.js";
import { G, REACH, SWING_CAP, OLLIE, barLaunchVelocity, platformContact } from "../web/apps/highbar-content.js";
import { appContext } from "./helpers/app-context.mjs";

const DT = 1 / 60;
function ride(park = 0) {
  const app = new HighBar(appContext({ settings: { knock: "medium" } }));
  app.mode = 2; app.parkId = park; app.start(); return app;
}
function air(app, p) {
  Object.assign(app.p, { mode: "air", support: null, rot: 0, rotV: 0, tuck: false, vert: 0, lastBar: -1, ...p });
  app.air = { t: 0.5, rot: 0, x0: app.p.x, xMin: app.p.x, xMax: app.p.x,
    y0: app.p.y, apex: app.p.y, fromBar: -1, ollie: true, vert: false, dir: 1 };
}
function swing(app, pressed) {
  const bar = 8, [x, y] = app.park().bars[bar], r = 160;
  Object.assign(app.p, { mode: "bar", bar, support: null, r, phi: 0, om: 4,
    x, y: y + r, vx: 640, vy: 0, held: 0, phiAcc: 0, loops: 0 });
  app.air = null; app.pressed = pressed;
}
const energy = p => 0.5 * (p.r * p.om) ** 2 + G * p.r * (1 - Math.cos(p.phi));

test("a held web cannot add or sustain pendulum energy, and button state changes no swing force", () => {
  const held = ride(), released = ride(); swing(held, true); swing(released, false);
  const initial = energy(held.p); let peak = initial;
  for (let i = 0; i < 1200; i++) {
    held.stepBar(DT); released.stepBar(DT);
    assert.equal(held.p.mode, "bar"); assert.equal(released.p.mode, "bar");
    for (const key of ["x", "y", "om", "phi", "vx", "vy"]) assert.equal(held.p[key], released.p[key]);
    peak = Math.max(peak, energy(held.p));
  }
  assert.ok(peak <= initial * 1.0002, "integration cannot manufacture swing energy");
  assert.ok(energy(held.p) < initial * 0.9, "drag removes useful energy over a twenty-second hold");
});

test("release is the actual tangent at every phase, post type and hold length", () => {
  for (const kind of [undefined, "whip"]) for (const held of [0, 0.34, 0.35, 1, 20]) for (const phi of [-2, -Math.PI / 2, 0, Math.PI / 2, 2]) {
    const p = { r: 190, om: 3, phi, held }, before = structuredClone(p);
    const launch = barLaunchVelocity(p, kind);
    assert.deepEqual(p, before);
    assert.ok(Math.abs(launch.vx - p.r * p.om * Math.cos(phi)) < 1e-9);
    assert.ok(Math.abs(launch.vy + p.r * p.om * Math.sin(phi)) < 1e-9);
    assert.ok(Math.abs(Math.hypot(launch.vx, launch.vy) - 570) < 1e-9);
  }
  const down = barLaunchVelocity({ r: 190, om: 3, phi: -Math.PI / 2, held: 20 });
  const up = barLaunchVelocity({ r: 190, om: 3, phi: Math.PI / 2, held: 20 });
  assert.ok(down.vy > 0 && up.vy < 0, "good release timing earns rise; a falling release stays falling");
});

test("longer web catches preserve tangent momentum, lose radial energy and never snap the rider upward", () => {
  assert.equal(REACH, 260);
  for (const distance of [245, 285]) {
    const aligned = ride(), radial = ride(), [bx, by] = aligned.park().bars[8];
    air(aligned, { x: bx, y: by + distance, vx: 600, vy: 0 });
    air(radial, { x: bx, y: by + distance, vx: 0, vy: 600 });
    const pos = { x: aligned.p.x, y: aligned.p.y };
    assert.equal(aligned.grab(8), true); assert.equal(radial.grab(8), true);
    assert.deepEqual({ x: aligned.p.x, y: aligned.p.y }, pos);
    assert.equal(aligned.p.r, distance); assert.equal(radial.p.r, distance);
    assert.ok(Math.abs(aligned.p.r * aligned.p.om - 600) < 1e-9);
    assert.ok(Math.abs(radial.p.r * radial.p.om) > 0 && Math.abs(radial.p.r * radial.p.om) <= 60);
    assert.ok(Math.abs(radial.p.r * radial.p.om) < Math.abs(aligned.p.r * aligned.p.om) * 0.11);
    assert.ok(Math.abs(aligned.p.r * aligned.p.om) <= SWING_CAP);
  }
  const reach = ride(), [bx, by] = reach.park().bars[8];
  air(reach, { x: bx + Math.sqrt(245 ** 2 - 100 ** 2), y: by + 100, vx: 0, vy: 0 });
  assert.equal(reach.pickBar(), 8, "a fresh catch is available beyond the former 190px reach");
});

test("one-way decks catch a fast swept crossing even when the frame ends beyond the edge", () => {
  const app = ride(), deck = app.park().platforms[0];
  air(app, { x: deck.x2 - 5, y: deck.y - 1, vx: 900, vy: 600 });
  app.stepAir(DT);
  assert.equal(app.p.mode, "ground"); assert.equal(app.p.support, deck.id);
  assert.equal(app.p.y, deck.y); assert.ok(app.p.x < deck.x2);
  const upward = ride(); air(upward, { x: 500, y: deck.y + 4, vx: 0, vy: -600 });
  upward.stepAir(DT); assert.equal(upward.p.mode, "air"); assert.ok(upward.p.y < deck.y);
  assert.equal(platformContact([deck], deck.x2 + 1, deck.y, deck.x2 + 20, deck.y + 20), null);
});

test("decks support ground kicks, ordinary ollies and momentum-preserving edge departures", () => {
  const app = ride(), deck = app.park().platforms[0];
  Object.assign(app.p, { mode: "ground", support: deck.id, x: deck.x1 + 10, y: deck.y, s: 220, crouch: true });
  for (let i = 0; i < 32; i++) app.stepGround(DT);
  assert.equal(app.p.mode, "ground"); assert.ok(app.p.s > 400); assert.equal(app.p.y, deck.y);
  app.ollie(); assert.equal(app.p.support, null); assert.equal(app.p.vy, -OLLIE); assert.equal(app.p.mode, "air");
  Object.assign(app.p, { mode: "ground", support: deck.id, x: deck.x2 - 1, y: deck.y, s: 600, crouch: false });
  app.stepGround(DT);
  assert.equal(app.p.mode, "air"); assert.equal(app.p.support, null); assert.equal(app.p.vy, 0);
  assert.ok(app.p.vx > 599 && app.p.x > deck.x2); assert.equal(app.p.y, deck.y);
});

test("landing forecasts and style readiness use the deck that actually intercepts a descent", () => {
  const app = ride(), deck = app.park().platforms[0];
  air(app, { x: 480, y: deck.y - 30, vx: 100, vy: 350, rot: 0.4, rotV: 1 });
  const forecast = app.flightAdvice();
  assert.ok(forecast && forecast.time < 0.15); assert.equal(app.canStyle(), false);
  let time = 0;
  while (app.p.mode === "air" && time < 1) { app.stepAir(DT); time += DT; }
  assert.equal(app.p.support, deck.id); assert.equal(app.landing.kind, forecast.kind);
  assert.ok(Math.abs(time - forecast.time) < 1e-9); assert.ok(Math.abs(app.landing.off - forecast.off) < 1e-9);
});

test("the original floor still catches riders below elevated decks", () => {
  const app = ride(); air(app, { x: 750, y: app.park().floor - 3, vx: 150, vy: 400 });
  app.stepAir(DT); assert.equal(app.p.mode, "ground"); assert.equal(app.p.support, null);
  assert.equal(app.p.y, app.groundY(app.p.x)); assert.equal(app.p.rot, Math.atan(app.slope(app.p.x)));
});

test("a held landing immediately uses the same ground drive as an ordinary ground hold", () => {
  const held = ride(), released = ride();
  for (const app of [held, released]) {
    const deck = app.park().platforms[0];
    air(app, { x: (deck.x1 + deck.x2) / 2, y: deck.y - 1, vx: 280, vy: 80 });
    app.pressed = app === held;
    app.stepAir(DT);
    assert.equal(app.p.mode, "ground"); assert.equal(app.p.support, deck.id);
    assert.equal(app.p.crouch, app === held); assert.equal(app.p.tuck, false);
  }
  const initialDifference = held.p.s - released.p.s;
  held.stepGround(DT); released.stepGround(DT);
  assert.ok(held.p.s - released.p.s > initialDifference + 5, "the already held button supplies ordinary ground acceleration");
});
