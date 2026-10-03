import test from "node:test";
import assert from "node:assert/strict";
import { HighBar, migrateSave } from "../web/apps/highbar.js";
import { PARKS, MAX_SPEED, SWING_CAP, SWING_OMEGA } from "../web/apps/highbar-content.js";
import { InputRouter } from "../web/engine/input.js";
import { appContext, run } from "./helpers/app-context.mjs";
import { SKY_ROUTES as ROUTES } from "./helpers/highbar-flow-routes.mjs";

const DT = 1 / 60;
// Current ordinary-input recordings recharge on decks between aerial chains.
// The old boost-era eight-second free-flight recordings are historical. Test
// useful sustained upper transfers and banking under dissipative web physics.
function ride(park = 0, mode = 2, start = 0) {
  const ctx = appContext({ settings: { knock: "medium" }, boardLed: true });
  const app = new HighBar(ctx); app.slot().guided = true;
  app.slot().goals = PARKS.map((_, i) => i < park ? [0, 1, 2] : []);
  app.parkId = park; app.mode = mode; app.practiceStart = start; app.start();
  return { app, ctx };
}
function airborneFixture(app, distance = 100, bar = 0) {
  const [bx, by] = app.park().bars[bar];
  Object.assign(app.p, { mode: "air", x: bx + distance * 0.6, y: by + distance * 0.8,
    vx: 100, vy: 0, rot: 0, rotV: 0, vert: 0, lastBar: -1 });
  app.air = { t: 0.4, rot: 0, x0: app.p.x, xMin: app.p.x, xMax: app.p.x,
    y0: app.p.y, apex: app.p.y, fromBar: -1, ollie: true, vert: false, dir: 1 };
}

for (const route of ROUTES) test(`ordinary park ${route.park + 1} drop-in sustains upper multi-catch flight and banks the same combo`, () => {
  const { app, ctx } = ride(route.park, 0), beforeSave = structuredClone(app.save);
  app.slot().line = 3;
  const upper = PARKS[route.park].floor - Math.min(...PARKS[route.park].platforms.map(p => p.y));
  const sky = PARKS[route.park].gaps.find(g => g.t === "sequence");
  const eligible = new Set();
  let chain = 0, free = 0, minY = Infinity, bars = new Set(), banked = false;
  const originalBank = app.bank.bind(app);
  app.bank = () => {
    if (eligible.has(app.combo) && app.combo.gaps.includes(sky.id)) banked = true;
    originalBank();
  };
  const events = route.input.split(" ").map(s => [+s.slice(1), s[0]]); let next = 0;
  for (let frame = 0; frame < route.frames; frame++) {
    while (events[next]?.[0] === frame) {
      const [, action] = events[next++];
      if (action === "D") app.down({ source: "node" });
      else if (action === "U") app.up({ source: "node", durationMs: (app.t - app.pt) * 1000 });
      else app.knock();
    }
    app.update(DT);
    const p = app.p;
    for (const value of [p.x, p.y, p.vx, p.vy, p.s, p.rot, app.camX, app.camY]) assert.ok(Number.isFinite(value));
    assert.ok(Math.hypot(p.vx, p.vy) < 2500, "gravity descent stays finite and within this course's energy envelope");
    if (p.mode === "ground") assert.ok(Math.abs(p.s) <= MAX_SPEED + 1e-9);
    if (p.mode === "bar") {
      assert.ok(Math.abs(p.om) <= SWING_OMEGA + 1e-9);
      assert.ok(Math.abs(p.om * p.r) <= SWING_CAP + 1e-9); bars.add(p.bar);
    }
    if (p.mode === "air" || p.mode === "bar") {
      chain += DT; if (p.mode === "air") free += DT; minY = Math.min(minY, p.y);
      const height = PARKS[route.park].floor - minY;
      if (chain > 3 && free > 1 && bars.size >= 3 && height > upper) eligible.add(app.combo);
    } else { chain = 0; free = 0; minY = Infinity; bars = new Set(); }
  }
  assert.ok(eligible.size, "a continuous upper chain must link real catches above the highest skate deck");
  assert.equal(banked, true, "the qualifying chain must land and bank, not an earlier unrelated combo");
  assert.equal(app.stats.bails, 0); assert.ok(app.score > 0); assert.equal(app.p.mode, "ground");
  assert.equal(ctx.calls.score.length, 0); app.finish(); app.guard.settle();
  assert.ok(ctx.calls.score.some(([value, metric]) => value === app.score && metric === "flow-v5"));
  assert.deepEqual(app.slot().styleBest, beforeSave.slots[0].styleBest, "changed physics must not rewrite style-v2 records");
  assert.equal(app.slot().flowBest[route.park], app.score);
});

test("a plain hold builds useful speed on every authored flat start, while passive cruise stays gentle", () => {
  for (let park = 0; park < 4; park++) {
    const held = ride(park, 2, 1).app, passive = ride(park, 2, 1).app;
    assert.equal(held.pickBar(), -1); held.down({ source: "node" });
    run(held, 0.5); run(passive, 0.5);
    assert.equal(held.p.mode, "ground"); assert.ok(Math.abs(held.p.s) > 385, `park${park}: pump must respond in half a second`);
    assert.ok(Math.abs(passive.p.s) < 300); assert.ok(Math.abs(held.p.s) > Math.abs(passive.p.s) + 150);
    assert.equal(held.pending, null); held.up({ source: "node", durationMs: 500 });
    assert.equal(held.p.mode, "air"); assert.equal(held.air.ollie, true);
  }
});

test("an ordinary drop-in responds to pushing immediately without starting an airborne catch", () => {
  for (let park = 0; park < 4; park++) {
    const { app } = ride(park); const speed = Math.abs(app.p.s);
    app.down({ source: "node" }); run(app, 0.3);
    assert.equal(app.p.mode, "ground"); assert.equal(app.pending, null); assert.ok(Math.abs(app.p.s) > speed + 100);
  }
});

test("a released or cancelled pending catch never grabs later", () => {
  for (const action of ["up", "cancel"]) {
    const { app } = ride(); airborneFixture(app); app.down({ source: "node" });
    assert.ok(app.pending); run(app, 0.05);
    if (action === "up") app.up({ source: "node", durationMs: 50 }); else app.cancel();
    assert.equal(app.pending, null); assert.equal(app.pressed, false); run(app, 0.15);
    assert.notEqual(app.p.mode, "bar");
  }
});

test("holding before a bar approaches does not invent a buffered catch; a fresh press still catches it", () => {
  const { app } = ride(); airborneFixture(app);
  const [bx, by] = app.park().bars[0]; Object.assign(app.p, { x: bx - 300, y: by + 45, vx: 300, vy: -100 });
  app.down({ source: "node" }); assert.equal(app.pending, null); run(app, 0.4);
  assert.equal(app.p.mode, "air"); assert.equal(app.pickBar(), 0);
  app.up({ source: "node", durationMs: 400 }); app.down({ source: "node" }); run(app, app.catchDelay() + DT);
  assert.equal(app.p.mode, "bar"); assert.equal(app.p.bar, 0);
});

test("a short-radius catch stays readable and bounded through swinging, regrip and release", () => {
  // An upper post isolates short-radius limits from real deck interceptions.
  const { app } = ride(); airborneFixture(app, 50, 8); app.p.vx = 450;
  app.down({ source: "node" }); run(app, app.catchDelay() + DT); assert.equal(app.p.mode, "bar");
  assert.ok(app.p.r < 200, "the catch uses the actual radius after the held-press interval");
  for (let frame = 0; frame < 120; frame++) {
    if (frame === 18) app.knock(); app.update(DT);
    assert.equal(app.p.mode, "bar"); assert.ok(Math.abs(app.p.om) <= 7 + 1e-9);
    assert.ok(Math.abs(app.p.om * app.p.r) <= SWING_CAP + 1e-9);
  }
  app.up({ source: "node", durationMs: 2100 }); assert.equal(app.p.mode, "air");
  assert.ok(Math.hypot(app.p.vx, app.p.vy) <= SWING_CAP + 1e-9);
});

test("a restored swing and a held swing both receive gravity without a hold-powered boost", () => {
  const passive = ride().app, pumping = ride().app;
  airborneFixture(passive); passive.down({ source: "node" }); run(passive, passive.catchDelay() + DT);
  assert.equal(passive.p.mode, "bar");
  // A menu rewind retains the physical bar state and consumes the held button.
  // Isolate that state from the drive comparison; it is not a route witness.
  Object.assign(passive.p, { phi: 0, om: 0.4 }); passive.pressed = false;
  pumping.p = structuredClone(passive.p); pumping.down({ source: "node" });
  run(passive, 0.1); run(pumping, 0.1);
  assert.equal(passive.p.mode, "bar"); assert.equal(pumping.p.mode, "bar");
  assert.ok(Math.abs(passive.p.om) <= 0.4); assert.equal(pumping.p.om, passive.p.om);
});

test("flow migration preserves all three legacy careers and archives score/time PBs exactly once within the service budget", () => {
  const old = { schema: 2, slot: 2, slots: [0, 1, 2].map(i => ({ runs: 1e7, clean: 1e7, park: 3,
    goals: PARKS.map(() => [0, 1, 2, 3, 4]), lines: PARKS.map(() => [0, 1, 2]), medals: PARKS.map(() => 3),
    best: PARKS.map(() => 1e9 - i), bestCombo: 1e9 - i, styleBest: PARKS.map(() => 1e9 - i),
    lineBest: PARKS.map(() => [1e9, 1e9 - 1, 1e9 - 2]), lineComboBest: PARKS.map(() => [1e9, 1e9 - 1, 1e9 - 2]),
    lineTimeBest: PARKS.map(() => [127.99, 127.98, 127.97]), lineMedals: PARKS.map(() => [3, 3, 3]),
    last: { score: 1e9, combo: 1e9, park: "界".repeat(24) } })) };
  const original = structuredClone(old), save = migrateSave(old);
  assert.equal(save.slot, 2); assert.equal(save.schema, 5); assert.equal(save.scoreVersion, "flow-v5");
  for (let i = 0; i < 3; i++) {
    const slot = save.slots[i];
    for (const key of ["runs", "clean", "park", "goals", "lines", "medals", "best", "styleBest", "last"]) assert.deepEqual(slot[key], old.slots[i][key]);
    assert.deepEqual(slot.lineMedals, old.slots[i].lineMedals.map(row => [...row, 0]));
    for (const key of ["bestCombo", "styleBest", "lineBest", "lineComboBest", "lineTimeBest"]) assert.deepEqual(slot.legacyRecords.styleV2[key], old.slots[i][key]);
    assert.deepEqual(slot.flowBest, [0, 0, 0, 0]); assert.equal(slot.bestCombo, 0);
    assert.deepEqual(slot.lineBest, PARKS.map(() => [0, 0, 0, 0])); assert.deepEqual(slot.lineTimeBest, PARKS.map(() => [0, 0, 0, 0]));
    slot.flowBest.fill(1e9); slot.bestCombo = 1e9;
    slot.best.fill(1e9); slot.styleBest.fill(1e9);
    slot.legacyRecords.styleV2.bestCombo = 1e9; slot.legacyRecords.styleV2.styleBest.fill(1e9);
    for (const key of ["lineBest", "lineComboBest"]) for (const row of slot.legacyRecords.styleV2[key]) row.fill(1e9);
    for (const row of slot.lineBest) row.fill(1e9); for (const row of slot.lineComboBest) row.fill(1e9);
    for (const row of slot.lineTimeBest) row.fill(127.99);
  }
  assert.deepEqual(old, original); assert.deepEqual(migrateSave(save), save);
  // Python service uses json.dumps defaults: ASCII escapes plus spaces after
  // commas/colons. This safe superset also spaces punctuation inside strings.
  const serverJson = JSON.stringify(save).replace(/[\u007f-\uffff]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")).replace(/[:,]/g, "$& ");
  assert.ok(Buffer.byteLength(serverJson, "utf8") <= 8192, "maximum legitimate three careers plus archives must fit server validation");
});

test("source-confirmed menu gestures rewind accelerated physics and flow career state at every pace", () => {
  for (const pace of ["quick", "standard", "relaxed"]) {
    const { app, ctx } = ride(0, 0); run(app, 0.4); ctx.settings().gesturePace = pace;
    const before = { save: structuredClone(app.save), p: structuredClone(app.p), clock: app.clock, score: app.score };
    let router, now = 0, menu = false, cancelling = false, opens = 0;
    ctx.cancelGesture = () => cancelling;
    const host = { epoch: 0, inputMode: () => menu ? "menu" : "raw", holdMs: () => 650, escapePolicy: () => ({ pace }),
      pressVisual() {}, clickVisual() {}, holdVisual() {}, rawDown: e => app.down(e), rawUp: e => app.up(e), rawCancel: () => app.cancel(),
      requestMenu() { cancelling = true; router.cancel(true, "node"); app.cancel(); app.pause(); cancelling = false; menu = true; opens++; host.epoch++; } };
    router = new InputRouter(host, () => now);
    for (let frame = 0; frame <= 140; frame++) {
      now = frame * 1000 / 60; const edge = { source: "node", generation: 1, at_us: now * 1000 };
      if ([0, 6, 12].includes(frame)) router.down(edge); if ([3, 9, 140].includes(frame)) router.up(edge);
      router.update(); if (!menu) app.update(DT);
    }
    assert.equal(opens, 1); assert.deepEqual(app.save, before.save); assert.equal(app.clock, before.clock); assert.equal(app.score, before.score);
    assert.equal(app.p.x, before.p.x); assert.equal(app.p.y, before.p.y); assert.equal(app.pressed, false); assert.equal(app.pending, null);
    assert.equal(ctx.calls.saved.length, 0); assert.equal(ctx.calls.score.length, 0);
  }
});
