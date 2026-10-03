import test from "node:test";
import assert from "node:assert/strict";
import { HighBar, migrateSave } from "../web/apps/highbar.js";
import { PARKS, LINES, projectLanding } from "../web/apps/highbar-content.js";
import { InputRouter } from "../web/engine/input.js";
import { appContext } from "./helpers/app-context.mjs";
import { FIRST_FLIGHT, GOLD_LINK, SKY_ROUTES, SKY_GOLD } from "./helpers/highbar-flow-routes.mjs";

const DT = 1 / 60;
function ride(mode = 0, park = 0, line = 0, progress = {}) {
  let durable = structuredClone(progress);
  const ctx = appContext({ settings: { knock: "medium" } });
  ctx.progress = () => structuredClone(durable);
  ctx.saveProgress = save => { durable = structuredClone(save); ctx.calls.saved.push(structuredClone(save)); return Promise.resolve({ ok: true }); };
  const app = new HighBar(ctx);
  app.slot().guided = true; app.mode = mode; app.parkId = park; app.slot().line = line; app.start();
  return { app, ctx, durable: () => structuredClone(durable) };
}
function replay(app, route, each = () => {}) {
  const events = route.input.split(" ").map(s => [Number(s.slice(1)), s[0]]); let next = 0;
  for (let frame = 0; frame < route.frames && app.phase === "play"; frame++) {
    while (events[next]?.[0] === frame) {
      const action = events[next++][1];
      if (action === "D") app.down({ source: "node" });
      else if (action === "U") app.up({ source: "node", durationMs: (app.t - app.pt) * 1000 });
      else app.knock();
    }
    app.update(DT); if (each(frame)) break;
  }
}
function advance(app, frames) { for (let i = 0; i < frames; i++) app.update(DT); }

test("a prepared high-energy swing loses momentum and exhausts repeat awards without losing its release trick", () => {
  const { app } = ride(2);
  const bar = app.park().bars.length - 1, [x, y] = app.park().bars[bar];
  Object.assign(app.p, { mode: "air", x, y: y + 100, vx: 700, vy: 0 });
  assert.ok(app.grab(bar)); app.pressed = true;
  advance(app, 1800);
  assert.equal(app.p.mode, "bar"); assert.ok(app.combo.giants >= 5);
  assert.equal(app.combo.tricks.filter(t => t.name === "GIANT").length, 5);
  const exhausted = app.combo.sum;
  advance(app, 600); assert.equal(app.combo.sum, exhausted, "ten more seconds of orbiting cannot add points");
  app.up({ source: "node", durationMs: 69000 });
  assert.equal(app.p.mode, "air"); assert.ok(app.combo.tricks.some(t => t.name === "SWING"));
  assert.ok(app.comboValue() < 5000, "a prolonged single-bar camp cannot manufacture a large varied line");
});

test("a full awarded log still admits a novel move while repeat counters remain exhausted (capacity fixture)", () => {
  const { app } = ride(2);
  for (let i = 0; i < 8; i++) for (let j = 0; j < 5; j++) app.trick("FIXTURE " + i, 100);
  assert.equal(app.combo.tricks.length, 40); const sum = app.combo.sum;
  app.trick("NOVEL FIXTURE", 400); assert.equal(app.combo.tricks.length, 40);
  assert.ok(app.combo.tricks.some(t => t.name === "NOVEL FIXTURE"));
  app.trick("FIXTURE 0", 100); assert.equal(app.combo.sum, sum + 400);
  assert.equal(app.variety(), 9);
});

for (const route of SKY_ROUTES) test(`ordinary drop-in banks the ordered ${LINES[route.park][3].name} route`, () => {
  const { app, ctx } = ride(1, route.park, 3);
  const gap = PARKS[route.park].gaps.find(g => g.id === LINES[route.park][3].gap);
  let flightCatches = [], completedFlight = [], cursor = 0, height = 0;
  const grab = app.grab.bind(app), land = app.land.bind(app);
  // Approach landings may interrupt earlier partial attempts. Independently
  // require the successful ordered catches to occur in one suspended chain.
  app.grab = i => {
    const ok = grab(i);
    if (ok) {
      flightCatches.push(i);
      if (i === gap.bars[cursor]) cursor++;
      if (cursor === gap.bars.length && !completedFlight.length) {
        assert.equal(app.routeProgress().complete, true);
        completedFlight = flightCatches.slice();
      }
    }
    return ok;
  };
  app.land = (...args) => { flightCatches = []; cursor = 0; land(...args); };
  replay(app, route, () => {
    height = Math.max(height, app.park().floor - app.p.y);
  });
  app.guard.settle();
  assert.equal(app.phase, "over"); assert.equal(app.attemptResult.line, 3);
  assert.ok(completedFlight.length);
  cursor = 0; for (const index of completedFlight) if (index === gap.bars[cursor]) cursor++;
  assert.equal(cursor, gap.bars.length);
  assert.ok(height > app.park().floor - Math.min(...app.park().platforms.map(p => p.y)), "the rider flies above the highest skate deck");
  assert.ok(app.attemptResult.value > 0); assert.equal(app.slot().runs, 1);
  assert.ok(app.slot().lineMedals[route.park][3] >= 1); assert.ok(ctx.calls.saved.length > 0);
});

test("all four sky gold banks are reachable through actual extra ground links", () => {
  for (const route of SKY_GOLD) {
    const { app } = ride(1, route.park, 3); replay(app, route); app.guard.settle();
    assert.equal(app.phase, "over", PARKS[route.park].name);
    assert.equal(app.attemptResult.medal, 3); assert.equal(app.slot().lineMedals[route.park][3], 3);
    assert.ok(app.lastBank.clean >= 2); assert.equal(app.slot().runs, 1);
    assert.ok(app.attemptResult.time <= Math.round(route.frames / 60 * 100) / 100);
  }
});

// Controlled positions below are unit fixtures for interruption semantics,
// not evidence that a player can reach these posts or complete a challenge.
function fixtureCatch(app, i) {
  const [x, y] = app.park().bars[i];
  Object.assign(app.p, { mode: "air", x, y: y + 100, vx: 200, vy: 0, tuck: false, vert: 0 });
  app.air = { t: 0, rot: 0, x0: x, xMin: x, xMax: x, y0: y + 100, apex: y + 100, fromBar: -1, dir: 1 };
  assert.equal(app.grab(i), true);
}
test("wrong-order catches and interrupted upper routes cannot launder partial progress into a bank", () => {
  for (let park = 0; park < 4; park++) {
    const { app, ctx } = ride(2, park, 3), gap = app.park().gaps.find(g => g.t === "sequence");
    fixtureCatch(app, gap.bars[1]); assert.equal(app.routeProgress().step, 0);
    fixtureCatch(app, gap.bars[0]); assert.equal(app.routeProgress().step, 1);
    fixtureCatch(app, gap.bars.at(-1)); assert.equal(app.routeProgress().step, 1);
    Object.assign(app.p, { mode: "air", x: app.park().training.x, y: app.park().floor, rot: Math.atan(app.slope(app.park().training.x)), vx: 200, vy: 100 });
    app.air = { t: 0.6, rot: 0, xMin: app.p.x, xMax: app.p.x, y0: app.p.y, apex: app.p.y, dir: 1 };
    app.land(); assert.equal(app.routeProgress().step, 0);
    for (const i of gap.bars.slice(1)) fixtureCatch(app, i);
    assert.equal(app.routeProgress().complete, false); assert.ok(!app.combo.gaps.includes(gap.id));
    app.bank(); assert.ok(!app.lastBank.matched.includes(3)); assert.equal(app.attemptResult, null);
    app.guard.settle(); assert.equal(ctx.calls.saved.length, 0);
    for (const i of gap.bars) fixtureCatch(app, i);
    assert.equal(app.routeProgress().complete, true);
    app.bail(); assert.equal(app.routeProgress().step, 0); assert.equal(app.routeProgress().complete, false);
  }
});

test("a selected matching bank ends once, survives reload, and its immutable award is retained until retry", () => {
  const rig = ride(1, 0, 2), { app } = rig; replay(app, GOLD_LINK); app.guard.settle();
  assert.equal(app.phase, "over"); assert.equal(app.slot().runs, 1);
  const result = app.attemptResult; assert.ok(Object.isFrozen(result)); assert.equal(result.medal, 3);
  assert.equal(result.value, app.lastBank.value); assert.ok(result.bestImproved && result.medalImproved && result.timeImproved);
  assert.throws(() => { result.value = 0; }, TypeError);
  app.finish(); app.down({ source: "node" }); app.up({ source: "node", durationMs: 60 });
  assert.equal(app.attemptResult, result); assert.equal(app.slot().runs, 1);
  const restored = ride(1, 0, 2, rig.durable()).app;
  assert.equal(restored.lineRecord().best, result.value); assert.equal(restored.lineRecord().medal, 3);
  assert.equal(restored.lineRecord().time, result.time);
  app.nextLine(); assert.equal(app.slot().line, 3); assert.equal(app.phase, "play"); assert.equal(app.attemptResult, null);
});

test("an earlier real bank matching other lines cannot finish the selected sky target", () => {
  const { app } = ride(1, 0, 3); replay(app, FIRST_FLIGHT);
  assert.ok(app.stats.banks > 0); assert.ok(app.lastBank.matched.includes(0));
  assert.ok(!app.lastBank.matched.includes(3)); assert.equal(app.phase, "play"); assert.equal(app.attemptResult, null);
  assert.equal(app.slot().lineMedals[0][3], 0); assert.equal(app.slot().lineTimeBest[0][3], 0);
});

// Capture drawRider's actual transformed paths. The pre-save post tether is
// excluded; the character's lines and sampled arcs/ellipses are included.
function riderBounds(app) {
  let m = [1, 0, 0, 1, -app.camX, -app.camY], depth = 0, xs = [], ys = [];
  const stack = [], point = (x, y) => { if (depth) { xs.push(m[0] * x + m[2] * y + m[4]); ys.push(m[1] * x + m[3] * y + m[5]); } };
  const g = new Proxy({
    save() { stack.push(m.slice()); depth++; }, restore() { m = stack.pop(); depth--; },
    translate(x, y) { m[4] += m[0] * x + m[2] * y; m[5] += m[1] * x + m[3] * y; },
    scale(x, y) { m[0] *= x; m[1] *= x; m[2] *= y; m[3] *= y; },
    rotate(a) { const c = Math.cos(a), s = Math.sin(a), [a0, b, c0, d] = m; m[0] = a0 * c + c0 * s; m[1] = b * c + d * s; m[2] = c0 * c - a0 * s; m[3] = d * c - b * s; },
    moveTo: point, lineTo: point,
    arc(x, y, r, start, end) { for (let i = 0; i <= 64; i++) { const a = start + (end - start) * i / 64; point(x + r * Math.cos(a), y + r * Math.sin(a)); } },
    ellipse(x, y, rx, ry, rotation, start, end) { for (let i = 0; i <= 64; i++) { const a = start + (end - start) * i / 64, xx = rx * Math.cos(a), yy = ry * Math.sin(a); point(x + xx * Math.cos(rotation) - yy * Math.sin(rotation), y + xx * Math.sin(rotation) + yy * Math.cos(rotation)); } },
  }, { get: (o, k) => o[k] || (() => {}), set: (o, k, v) => { o[k] = v; return true; } });
  app.drawRider(g); return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
}
test("actual boundary and upper-chain frames retain the whole rendered spider horizontally", () => {
  for (const route of SKY_ROUTES) {
    const { app } = ride(2, route.park, 3);
    const check = () => { const b = riderBounds(app); assert.ok(b.left >= 2 && b.right <= 958, JSON.stringify({ park: route.park, x: app.p.x, camX: app.camX, bounds: b })); };
    check(); replay(app, route, () => { check(); });
  }
});

function pendingTarget() {
  const rig = ride(1); replay(rig.app, FIRST_FLIGHT, () => rig.app.p.mode === "ground" && rig.app.combo.roll > 0 && rig.app.meetsLine(rig.app.challenge(), rig.app.combo));
  assert.ok(rig.app.combo.roll > 0); assert.equal(rig.app.phase, "play"); rig.app.guard.settle(); return rig;
}
test("manual END forfeits an unrolled matching line while the natural bank counts exactly one run", () => {
  for (const natural of [false, true]) {
    const { app } = pendingTarget();
    if (natural) advance(app, 80); else app.menuActions().find(a => a.label === "END SESSION").run();
    app.guard.settle(); assert.equal(app.phase, "over"); assert.equal(app.slot().runs, 1);
    assert.equal(!!app.attemptResult, natural); assert.equal(app.stats.banks, natural ? 1 : 0);
    app.finish(); assert.equal(app.slot().runs, 1);
  }
});

test("a real confirmed menu gesture rewinds a speculative matching bank, result, career and deferred writes", () => {
  for (const pace of ["quick", "standard", "relaxed"]) {
    const { app, ctx } = pendingTarget();
    while (app.combo.roll > 0.04) app.update(DT);
    app.guard.settle(); const before = structuredClone({ save: app.save, score: app.score, result: app.attemptResult, roll: app.combo.roll, p: app.p });
    const writes = ctx.calls.saved.length;
    let router, open = false, cancelling = false, now = 0, sawResult = false;
    ctx.settings().gesturePace = pace; ctx.cancelGesture = () => cancelling;
    const host = { epoch: 0, inputMode: () => open ? "menu" : "raw", holdMs: () => 650,
      escapePolicy: () => ({ pace }), pressVisual() {}, clickVisual() {}, holdVisual() {},
      rawDown: e => app.down(e), rawUp: e => app.up(e), rawCancel: () => app.cancel(),
      requestMenu() { cancelling = true; router.cancel(true, "node"); app.cancel(); app.pause(); cancelling = false; open = true; host.epoch++; } };
    router = new InputRouter(host, () => now);
    for (let frame = 0; frame <= 140; frame++) {
      now = frame * 1000 / 60; const e = { source: "node", generation: 1, at_us: now * 1000 };
      if ([0, 6, 12].includes(frame)) router.down(e);
      if ([3, 9, 140].includes(frame)) router.up(e);
      router.update(); if (!open) app.update(DT); sawResult ||= !!app.attemptResult;
    }
    assert.ok(sawResult, "target genuinely completed during the speculative first tap"); assert.ok(open);
    assert.equal(app.phase, "play"); assert.equal(app.attemptResult, null); assert.deepEqual(app.save, before.save);
    assert.equal(app.score, before.score); assert.equal(app.combo.roll, before.roll);
    assert.equal(app.p.x, before.p.x); assert.equal(app.pressed, false); assert.equal(ctx.calls.saved.length, writes);
  }
});

test("landing advice agrees with actual future landings at flats, sloping obstacles, rebound walls and vert returns", () => {
  const cases = [
    { park: 0, x: 750, height: 180, vx: 230, vy: 450, rot: .25, rotV: 6 },
    { park: 1, x: 1190, height: 130, vx: 360, vy: 400, rot: -.6, rotV: 5 },
    { park: 3, x: 16, height: 120, vx: -700, vy: 100, rot: 2, rotV: -4 },
    { park: 0, vert: -1, height: 190, vx: 0, vy: 270, rot: 1.5, rotV: 5 },
    { park: 2, x: 620, height: 50, vx: 500, vy: 500, rot: 1.1, rotV: 3, style: true },
  ];
  for (const c of cases) for (const dt of [1 / 30, 1 / 60, 1 / 120]) for (const slow of [false, true]) {
    const { app } = ride(2, c.park); app.practiceSlow = slow;
    const x = c.vert ? app.geo.lipL : c.x, y = (c.vert ? app.geo.lipY : app.groundY(x)) - c.height;
    Object.assign(app.p, { mode: "air", x, y, vx: c.vx, vy: c.vy, rot: c.rot, rotV: c.rotV, vert: c.vert || 0, tuck: true, tuckDir: -1 });
    app.air = { t: .3, rot: 0, x0: x, xMin: x, xMax: x, y0: y, apex: y, fromBar: -1, dir: 1, ...(c.style ? { style: { at: 0 } } : {}) };
    app.simulationStep = dt * (slow ? .5 : 1); const state = structuredClone({ p: app.p, air: app.air });
    const advice = app.flightAdvice(); assert.ok(advice); assert.deepEqual({ p: app.p, air: app.air }, state);
    // Actual release, then the actual runtime update loop. No projected poses are installed.
    app.pressed = true; app.up({ source: "node", durationMs: 300 }); let steps = 0;
    while (app.p.mode === "air" && steps++ < 1000) app.update(dt);
    assert.ok(app.landing); assert.equal(advice.kind, app.landing.kind, JSON.stringify({ c, dt, slow }));
    assert.ok(Math.abs(advice.off - app.landing.off) < 1e-9);
    assert.ok(Math.abs(advice.time - steps * app.simulationStep) < 1e-9);
    const projected = projectLanding(state.p, state.air, app.geo, x => app.groundY(x), x => app.slope(x), 0, dt * (slow ? .5 : 1));
    assert.equal(projected.kind, app.landing.kind);
  }
});

test("release advice distinguishes upward from downward phases and remains read-only (swing fixtures)", () => {
  const { app } = ride(2);
  for (const phi of [Math.PI / 2, -Math.PI / 2]) {
    Object.assign(app.p, { mode: "bar", bar: 0, phi, r: 150, om: 4, held: 1 });
    const before = structuredClone(app.p), advice = app.releaseAdvice(); assert.deepEqual(app.p, before);
    assert.equal(advice.phase, phi > 0 ? "rise" : "fall");
    app.letGo(); assert.equal(advice.vx, app.p.vx); assert.equal(advice.vy, app.p.vy);
  }
});

const matrix = (width, value) => PARKS.map(() => Array(width).fill(value));
function maxArchive(flow = false) { return { bestCombo: 1e9, [flow ? "flowBest" : "styleBest"]: PARKS.map(() => 1e9), lineBest: matrix(3, 1e9), lineComboBest: matrix(3, 1e9), lineTimeBest: matrix(3, 127.99) }; }
function serviceJSON(value) {
  if (Array.isArray(value)) return "[" + value.map(serviceJSON).join(", ") + "]";
  if (value && typeof value === "object") return "{" + Object.entries(value).map(([k, v]) => serviceJSON(k) + ": " + serviceJSON(v)).join(", ") + "}";
  return JSON.stringify(value).replace(/[^\x00-\x7f]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}
test("all three released flow-v3 careers archive once without aliasing or losing achievements", () => {
  const old = { schema: 3, scoreVersion: "flow-v3", slot: 2, slots: [0, 1, 2].map(i => ({
    scoreVersion: "flow-v3", legacyRecords: { styleV2: maxArchive() }, ...maxArchive(true),
    runs: 100 + i, clean: 33 + i, guided: true, mode: 1, line: 2, park: 3,
    best: PARKS.map(() => 1e9), styleBest: PARKS.map(() => 1e9),
    goals: PARKS.map(p => p.goals.map((_, j) => j)), lines: PARKS.map(() => [0, 1, 2]),
    lineMedals: matrix(3, 3), medals: [3, 3, 3, 3], last: { score: 555 + i, combo: 444 + i, park: "OLD CAREER" },
  })) }, untouched = structuredClone(old), save = migrateSave(old);
  assert.equal(save.schema, 5); assert.equal(save.scoreVersion, "flow-v5"); assert.equal(save.slot, 2); assert.equal(save.runs, 102);
  for (let i = 0; i < 3; i++) {
    const s = save.slots[i]; assert.deepEqual(s.legacyRecords.flowV3, maxArchive(true)); assert.deepEqual(s.legacyRecords.styleV2, maxArchive());
    for (const key of ["runs", "clean", "guided", "mode", "line", "park", "goals", "lines", "best", "styleBest", "last"]) assert.deepEqual(s[key], old.slots[i][key]);
    assert.deepEqual(s.lineMedals, PARKS.map(() => [3, 3, 3, 0])); assert.equal(s.bestCombo, 0);
    assert.deepEqual(s.flowBest, [0, 0, 0, 0]); assert.deepEqual(s.lineBest, matrix(4, 0)); assert.deepEqual(s.lineTimeBest, matrix(4, 0));
  }
  assert.deepEqual(migrateSave(save), save); save.slots[0].legacyRecords.flowV3.lineBest[0][0] = 7;
  assert.equal(save.slots[1].legacyRecords.flowV3.lineBest[0][0], 1e9); assert.deepEqual(old, untouched);
  const direct = migrateSave({ schema: 2, slots: [{ ...maxArchive(), scoreVersion: "style-v2" }] });
  assert.equal(direct.slots[0].legacyRecords.flowV3, null); assert.deepEqual(direct.slots[0].legacyRecords.styleV2, maxArchive());
});

test("released mastery records migrate into a third archive within the High Bar service bound", () => {
  const save = migrateSave({ schema: 4, scoreVersion: "flow-v4", slot: 2, slots: [0, 1, 2].map(() => ({
    scoreVersion: "flow-v4", legacyRecords: { styleV2: maxArchive(), flowV3: maxArchive(true) },
    runs: 1e7, clean: 1e7, park: 3, mode: 2, line: 3, guided: false,
    best: [1e9, 1e9, 1e9, 1e9], styleBest: [1e9, 1e9, 1e9, 1e9], flowBest: [1e9, 1e9, 1e9, 1e9], bestCombo: 1e9,
    lineBest: matrix(4, 1e9), lineComboBest: matrix(4, 1e9), lineTimeBest: matrix(4, 127.99), lineMedals: matrix(4, 3),
    goals: PARKS.map(p => p.goals.map((_, i) => i)), lines: PARKS.map(() => [0, 1, 2, 3]), medals: [3, 3, 3, 3],
    last: { score: 1e9, combo: 1e9, park: "界".repeat(24) },
  })) });
  const payload = serviceJSON(save), bytes = Buffer.byteLength(payload, "utf8");
  assert.ok(bytes <= 16384); assert.ok(save.slots.every(slot => slot.legacyRecords.flowV4));
  assert.deepEqual(migrateSave(save), save); assert.deepEqual(JSON.parse(payload), save);
});
