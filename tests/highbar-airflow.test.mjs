import test from "node:test";
import assert from "node:assert/strict";
import { HighBar, migrateSave } from "../web/apps/highbar.js";
import { PARKS, MAX_SPEED, SWING_CAP, SWING_OMEGA } from "../web/apps/highbar-content.js";
import { InputRouter } from "../web/engine/input.js";
import { appContext, run } from "./helpers/app-context.mjs";

const DT = 1 / 60;
// Independent recordings from ordinary drop-ins. A feedback pilot observed the
// software rider every100ms; these are real edges, never injected route state.
// All finish by releasing, descending, landing and rolling to bank the chain.
const ROUTES = [
  { park: 0, frames: 1043, input: "D0 U42 D48 U78 D84 U144 D150 U210 D258 U288 D294 U324 D330 U348 D354 U384 D390 U480 D486 U546 D636 U666 D672 U726 D732 U738 D744 U804 D810 U870" },
  { park: 1, frames: 1150, input: "D0 U42 D48 U78 D84 U144 D216 U258 D264 U276 D282 U312 D318 U348 D354 U390 D396 U414 D432 U462 D468 U528 D630 U660 D666 U672 D678 U732 D738 U744 D750 U804 D810 U822 D828 U858 D864 U876 D882 U912 D918 U978" },
  { park: 2, frames: 1087, input: "D0 U42 D48 U78 D84 U138 D144 U174 D180 U186 D192 U246 D252 U258 D264 U306 D312 U318 D324 U354 D360 U390 D396 U426 D432 U462 D468 U528 D612 U642 D648 U702 D708 U720 D726 U756 D762 U822 D918 U924" },
  { park: 3, frames: 1214, input: "D0 U42 D48 U54 D60 U90 D96 U156 D240 U270 D276 U336 D342 U348 D354 U408 D414 U420 D426 U498 D504 U534 D540 U660 D666 U672 D678 U750 D756 U816 D900 U930 D936 U984" },
];
function ride(park = 0, mode = 2, start = 0) {
  const ctx = appContext({ settings: { knock: "medium" }, boardLed: true });
  const app = new HighBar(ctx); app.slot().guided = true;
  app.slot().goals = PARKS.map((_, i) => i < park ? [0, 1, 2] : []);
  app.parkId = park; app.mode = mode; app.practiceStart = start; app.start();
  return { app, ctx };
}
function airborneFixture(app, distance = 100) {
  const [bx, by] = app.park().bars[0];
  Object.assign(app.p, { mode: "air", x: bx + distance * 0.6, y: by + distance * 0.8,
    vx: 100, vy: 0, rot: 0, rotV: 0, vert: 0, lastBar: -1 });
  app.air = { t: 0.4, rot: 0, x0: app.p.x, xMin: app.p.x, xMax: app.p.x,
    y0: app.p.y, apex: app.p.y, fromBar: -1, ollie: true, vert: false, dir: 1 };
}

for (const route of ROUTES) test(`ordinary park ${route.park + 1} drop-in sustains high multi-catch flight, flips, then banks the same chain`, () => {
  const { app, ctx } = ride(route.park, 0), beforeSave = structuredClone(app.save);
  let chain = 0, free = 0, minY = Infinity, bars = new Set(), witness = null, banked = false;
  const originalBank = app.bank.bind(app);
  app.bank = () => {
    if (witness && app.combo.transfers >= witness.transfers && app.combo.maxFlip >= witness.flip) banked = true;
    originalBank();
  };
  const events = route.input.split(" ").map(s => [+s.slice(1), s[0]]); let next = 0;
  for (let frame = 0; frame < route.frames; frame++) {
    while (events[next]?.[0] === frame) {
      const [, action] = events[next++];
      if (action === "D") app.down({ source: "node" });
      else app.up({ source: "node", durationMs: (app.t - app.pt) * 1000 });
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
      if (!witness && chain > 8 && free > 8 && bars.size >= 3 && app.combo.transfers > 2 && app.combo.maxFlip >= 1
        && height > (route.park === 2 ? 1000 : 700)) witness = { transfers: app.combo.transfers, flip: app.combo.maxFlip, height };
    } else { chain = 0; free = 0; minY = Infinity; bars = new Set(); }
  }
  assert.ok(witness, "multiple real catches and flips must build height during one continuous suspended chain");
  assert.equal(banked, true, "the qualifying chain must land and bank, not an earlier unrelated combo");
  assert.equal(app.stats.bails, 0); assert.ok(app.score > 0); assert.equal(app.p.mode, "ground");
  assert.equal(ctx.calls.score.length, 0); app.finish(); app.guard.settle();
  assert.ok(ctx.calls.score.some(([value, metric]) => value === app.score && metric === "flow-v4"));
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

test("an ordinary drop-in responds to pumping immediately without changing initial press-to-catch semantics", () => {
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
  const [bx, by] = app.park().bars[0]; Object.assign(app.p, { x: bx - 240, y: by + 45, vx: 300 });
  app.down({ source: "node" }); assert.equal(app.pending, null); run(app, 0.2);
  assert.equal(app.p.mode, "air"); assert.equal(app.pickBar(), 0);
  app.up({ source: "node", durationMs: 200 }); app.down({ source: "node" }); run(app, 0.1);
  assert.equal(app.p.mode, "bar"); assert.equal(app.p.bar, 0);
});

test("a short-radius catch stays readable and bounded through pumping, regrip and release", () => {
  const { app } = ride(); airborneFixture(app, 50); app.p.vx = 900;
  app.down({ source: "node" }); run(app, 0.1); assert.equal(app.p.mode, "bar");
  assert.ok(app.p.r < 100);
  for (let frame = 0; frame < 120; frame++) {
    if (frame === 18) app.knock(); app.update(DT);
    assert.equal(app.p.mode, "bar"); assert.ok(Math.abs(app.p.om) <= 7 + 1e-9);
    assert.ok(Math.abs(app.p.om * app.p.r) <= SWING_CAP + 1e-9);
  }
  app.up({ source: "node", durationMs: 2100 }); assert.equal(app.p.mode, "air");
  assert.ok(Math.hypot(app.p.vx, app.p.vy) <= SWING_CAP + 1e-9);
});

test("a restored swing without a held button gets gravity, while a fresh hold adds leg drive", () => {
  const passive = ride().app, pumping = ride().app;
  airborneFixture(passive); passive.down({ source: "node" }); run(passive, 0.1);
  assert.equal(passive.p.mode, "bar");
  // A menu rewind retains the physical bar state and consumes the held button.
  // Isolate that state from the drive comparison; it is not a route witness.
  Object.assign(passive.p, { phi: 0, om: 0.4 }); passive.pressed = false;
  pumping.p = structuredClone(passive.p); pumping.down({ source: "node" });
  run(passive, 0.1); run(pumping, 0.1);
  assert.equal(passive.p.mode, "bar"); assert.equal(pumping.p.mode, "bar");
  assert.ok(Math.abs(passive.p.om) <= 0.4); assert.ok(pumping.p.om > passive.p.om + 0.2);
});

test("flow migration preserves all three legacy careers and archives score/time PBs exactly once within the service budget", () => {
  const old = { schema: 2, slot: 2, slots: [0, 1, 2].map(i => ({ runs: 1e7, clean: 1e7, park: 3,
    goals: PARKS.map(() => [0, 1, 2, 3, 4]), lines: PARKS.map(() => [0, 1, 2]), medals: PARKS.map(() => 3),
    best: PARKS.map(() => 1e9 - i), bestCombo: 1e9 - i, styleBest: PARKS.map(() => 1e9 - i),
    lineBest: PARKS.map(() => [1e9, 1e9 - 1, 1e9 - 2]), lineComboBest: PARKS.map(() => [1e9, 1e9 - 1, 1e9 - 2]),
    lineTimeBest: PARKS.map(() => [127.99, 127.98, 127.97]), lineMedals: PARKS.map(() => [3, 3, 3]),
    last: { score: 1e9, combo: 1e9, park: "界".repeat(24) } })) };
  const original = structuredClone(old), save = migrateSave(old);
  assert.equal(save.slot, 2); assert.equal(save.schema, 4); assert.equal(save.scoreVersion, "flow-v4");
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
