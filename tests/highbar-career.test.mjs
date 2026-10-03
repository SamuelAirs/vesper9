import test from "node:test";
import assert from "node:assert/strict";
import { HighBar, migrateSave } from "../web/apps/highbar.js";
import { PARKS } from "../web/apps/highbar-content.js";
import { InputRouter } from "../web/engine/input.js";
import { appContext, run, fakeCanvas } from "./helpers/app-context.mjs";

const DT = 1 / 60;
import { FIRST_FLIGHT as FIRST_ROUTE, GOLD_LINK as GOLD_ROUTE } from "./helpers/highbar-flow-routes.mjs";
const FIRST_FLIGHT = FIRST_ROUTE.input;
function mount(progress = {}, settings = {}) {
  let durable = structuredClone(progress);
  const ctx = appContext({ settings: { knock: "medium", ...settings } });
  ctx.progress = () => structuredClone(durable);
  ctx.saveProgress = value => {
    durable = structuredClone(value); ctx.calls.saved.push(structuredClone(value));
    return Promise.resolve({ queued: true });
  };
  const app = new HighBar(ctx);
  return { app, ctx, durable: () => structuredClone(durable) };
}
function ride(mode = 0) {
  const rig = mount(); rig.app.slot().guided = true; rig.app.mode = mode; rig.app.start(); return rig;
}
function replay(app, frames = FIRST_ROUTE.frames, input = FIRST_FLIGHT) {
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
function press(app, seconds = 0.06) {
  app.down({ source: "node" }); run(app, seconds);
  app.up({ source: "node", durationMs: seconds * 1000 });
}

test("schema-1 migration preserves every private slot and active career without aliasing", () => {
  const legacy = { schema: 1, slot: 2, slots: [0, 1, 2].map(i => ({
    runs: 10 + i, park: i, best: [100 + i, 200 + i, 300 + i, 400 + i], bestCombo: 1000 + i,
    goals: [[0, 1, 2], [0, 2, 4], [1, 2, 3], []], last: { score: 900 + i, combo: 600 + i, park: "old " + i },
  })) };
  const original = structuredClone(legacy), migrated = migrateSave(legacy);
  assert.equal(migrated.slot, 2); assert.equal(migrated.runs, 12); assert.equal(migrated.last.park, "old 2");
  for (let i = 0; i < 3; i++) {
    for (const field of ["runs", "park", "best", "goals", "last"]) assert.deepEqual(migrated.slots[i][field], legacy.slots[i][field]);
    assert.equal(migrated.slots[i].legacyRecords.styleV2.bestCombo, legacy.slots[i].bestCombo);
    assert.equal(migrated.slots[i].bestCombo, 0);
    assert.deepEqual(migrated.slots[i].lineComboBest, PARKS.map(() => [0, 0, 0, 0]));
    assert.deepEqual(migrated.slots[i].lineTimeBest, PARKS.map(() => [0, 0, 0, 0]));
    assert.deepEqual(migrated.slots[i].lineMedals, PARKS.map(() => [0, 0, 0, 0]));
  }
  migrated.slots[0].goals[0].push(4); migrated.slots[0].lineMedals[0][0] = 3;
  assert.deepEqual(legacy, original); assert.equal(migrated.slots[1].lineMedals[0][0], 0);
});

test("career migration is idempotent and bounds malformed mastery without erasing legacy bests", () => {
  const raw = { schema: 2, slot: 1, slots: [0, 1, 2].map(i => ({
    runs: 5 + i, best: [99900 + i], lineBest: [[87000 + i, 88000 + i, 89000 + i]],
    lineComboBest: [[Infinity, -8, 4e12]], lineTimeBest: [[NaN, -1, 1000]], lineMedals: [[5, -2, "gold"]],
    goals: PARKS.map(() => Array(1000).fill(1)), last: { park: "x".repeat(10000), score: 1234, combo: 999 },
  })) };
  const save = migrateSave(raw);
  assert.deepEqual(migrateSave(save), save);
  for (let i = 0; i < 3; i++) {
    const slot = save.slots[i]; assert.equal(slot.best[0], 99900 + i); assert.equal(slot.legacyRecords.styleV2.lineBest[0][0], 87000 + i); assert.equal(slot.lineBest[0][0], 0);
    for (const value of slot.lineComboBest.flat()) assert.ok(Number.isFinite(value) && value >= 0 && value <= 1e9);
    for (const value of slot.lineTimeBest.flat()) assert.ok(Number.isFinite(value) && value >= 0 && value <= 128);
    for (const value of slot.lineMedals.flat()) assert.ok(Number.isInteger(value) && value >= 0 && value <= 3);
    assert.ok(slot.last.park.length <= 24);
  }
  assert.ok(JSON.stringify(save).length < 6000, "bounded nested careers fit the service's 8192-character progress limit including spacing");
});

test("an actually banked line survives dispose and restart without counting a finished session", () => {
  for (const leave of ["dispose", "restart"]) {
    const rig = ride(), { app, ctx } = rig; replay(app); app.guard.settle();
    assert.ok(app.stats.banks >= 1); assert.ok(app.score > 3000);
    assert.ok(app.slot().goals[0].includes(1)); assert.ok(app.slot().lines[0].includes(0));
    assert.ok(app.lineRecord(0, 0).medal >= 1); assert.ok(ctx.calls.saved.length > 0);
    if (leave === "dispose") app.dispose(); else app.start();
    app.guard.settle(); const restored = mount(rig.durable()).app;
    assert.ok(restored.slot().goals[0].includes(1)); assert.ok(restored.slot().lines[0].includes(0));
    assert.equal(restored.slot().runs, 0); assert.equal(restored.slot().flowBest[0], 0); assert.equal(ctx.calls.score.length, 0);
  }
});

test("an unbanked actual flight cannot create a career checkpoint on exit", () => {
  const { app, ctx } = ride(); replay(app, 100);
  assert.equal(app.score, 0); assert.ok(["air", "bar"].includes(app.p.mode));
  app.dispose(); assert.equal(ctx.calls.saved.length, 0); assert.equal(ctx.calls.score.length, 0);
});

test("checkpoint payload is a snapshot even when AppGuard defers its delivery", () => {
  const rig = ride(), { app, ctx } = rig;
  app.down({ source: "node" }); app.update(DT); app.up({ source: "node", durationMs: 17 });
  const wanted = structuredClone(app.save); app.persist(); assert.equal(ctx.calls.saved.length, 0);
  app.slot().runs = 999; app.slot().goals[0].push(4); app.guard.settle();
  assert.deepEqual(rig.durable(), wanted, "speculative later state must not leak into the earlier deferred checkpoint");
});

test("practice banks and checkpoint resets never write any private career slot", () => {
  const rig = ride(2), { app, ctx } = rig, before = structuredClone(app.save);
  replay(app); assert.ok(app.score > 0); assert.ok(app.practiceCheckpoint);
  const checkpoint = structuredClone(app.practiceCheckpoint);
  app.resetPractice(true);
  assert.equal(app.p.x, checkpoint.x); assert.equal(app.score, 0); assert.equal(app.clock, 120);
  assert.ok(app.resumeT > 0); assert.equal(app.pressed, false);
  app.finish(); app.guard.settle();
  assert.deepEqual(app.save, before); assert.equal(ctx.calls.saved.length, 0); assert.equal(ctx.calls.score.length, 0);
});

test("practice start and pace selection remain temporary across all three saved careers", () => {
  const rig = ride(2), { app, ctx } = rig; const before = structuredClone(app.save);
  app.phase = "setup";
  for (const id of ["start", "pace"]) {
    app.cursor = app.setupItems().findIndex(item => item.id === id); assert.ok(app.cursor >= 0); press(app, 0.55);
  }
  assert.equal(app.practiceStart, 1); assert.equal(app.practiceSlow, true); app.start();
  assert.ok(Math.abs(app.p.x - PARKS[0].training.x) < 1);
  assert.deepEqual(app.save, before); app.dispose(); assert.equal(ctx.calls.saved.length, 0);
});

test("resume and guide return freeze physics, session time, and input until the grace period ends", () => {
  for (const viaGuide of [false, true]) {
    const { app } = ride(); run(app, 0.4);
    if (viaGuide) { app.menuActions().find(row => row.label === "GAME GUIDE").run(); app.menuPress(0.55); }
    else { app.pause(); app.resume(); }
    const before = { p: structuredClone(app.p), clock: app.clock, runTime: app.runTime, score: app.score };
    app.down({ source: "node" }); app.knock(); app.up({ source: "node", durationMs: 60 }); run(app, 0.3);
    assert.deepEqual({ p: app.p, clock: app.clock, runTime: app.runTime, score: app.score }, before);
    assert.equal(app.pressed, false); assert.equal(app.manual, null);
    run(app, 0.5); assert.ok(app.clock < before.clock); assert.notEqual(app.p.x, before.p.x);
  }
});

test("generic case navigation moves setup backward while the button cycles forward", () => {
  for (const side of [undefined, "left", "right", "back"]) {
    const { app } = ride(); app.phase = "setup"; app.cursor = 2;
    app.knock({ side }); assert.equal(app.cursor, 1); press(app); assert.equal(app.cursor, 2);
    assert.equal(app.pressed, false); assert.equal(app.manual, null);
  }
});

test("a held button after bail resumes pumping and its release ollies", () => {
  const { app } = ride(); app.bail(); app.down({ source: "node" }); run(app, 1.2);
  assert.equal(app.p.mode, "ground"); assert.equal(app.p.crouch, true);
  app.up({ source: "node", durationMs: 1200 }); assert.ok(["air", "bar"].includes(app.p.mode)); assert.ok(app.air.ollie);
});

test("actual menu gestures rewind speculative flight and consume the final release at every pace", () => {
  for (const pace of ["quick", "standard", "relaxed"]) {
    const rig = ride(), { app, ctx } = rig; replay(app, 100);
    ctx.settings().gesturePace = pace;
    let router, open = false, cancelling = false, menus = 0, now = 0;
    ctx.cancelGesture = () => cancelling;
    const original = { save: structuredClone(app.save), score: app.score, clock: app.clock, p: structuredClone(app.p) };
    const host = { epoch: 0, inputMode: () => open ? "menu" : "raw", holdMs: () => 650,
      escapePolicy: () => ({ pace }), pressVisual() {}, clickVisual() {}, holdVisual() {},
      rawDown: e => app.down(e), rawUp: e => app.up(e), rawCancel: () => app.cancel(),
      requestMenu() {
        cancelling = true; router.cancel(true, "node"); app.cancel(); app.pause(); cancelling = false;
        open = true; menus++; host.epoch++;
      } };
    router = new InputRouter(host, () => now);
    for (let frame = 0; frame <= 140; frame++) {
      const at = frame * 1000 / 60, event = { source: "node", generation: 1, at_us: at * 1000 };
      now = at;
      if ([0, 6, 12].includes(frame)) router.down(event);
      if ([3, 9, 140].includes(frame)) router.up(event);
      router.update(); if (!open) app.update(DT);
    }
    assert.equal(menus, 1); assert.deepEqual(app.save, original.save); assert.equal(app.score, original.score);
    assert.equal(app.clock, original.clock); assert.equal(app.p.x, original.p.x); assert.equal(app.p.y, original.p.y);
    assert.equal(app.pressed, false); assert.equal(ctx.calls.saved.length, 0); assert.equal(ctx.calls.score.length, 0);
  }
});

test("extended actual input keeps simulation state, save size, and drawable collections bounded", () => {
  const { app } = ride(2), canvas = fakeCanvas();
  for (let frame = 0; frame < 18000; frame++) {
    if (frame % 48 === 0) app.down({ source: "node" });
    if (frame % 48 === 38) app.up({ source: "node", durationMs: 633 });
    if (frame % 43 === 0) app.knock(); app.update(DT);
    if (frame % 120 === 0) {
      app.draw(canvas);
      for (const n of [app.p.x, app.p.y, app.p.rot, app.score, app.camX, app.camY]) assert.ok(Number.isFinite(n));
      assert.ok(app.parts.length <= 24); assert.ok(app.popups.length <= 6); assert.ok(app.trail.length <= 12);
      assert.ok(app.combo.tricks.length <= 40); assert.ok(JSON.stringify(app.save).length < 6000);
    }
  }
});

test("line mastery needs the target and clean trick variety; repetitions and sketchy landings cannot buy gold", () => {
  const { app } = ride(), line = app.challenge();
  const candidate = (names, cleanLandings = 0, sketchy = 0) => ({ ...app.freshCombo(),
    tricks: names.map(name => ({ name, pts: 99999 })), sum: names.length * 99999,
    maxFlip: 1, clean: cleanLandings > 0, cleanLandings, sketchy });
  assert.equal(app.lineMedal(line, candidate(["BACKFLIP"], 20)), 0, "a missing swing cannot be bought with score or clean count");
  assert.equal(app.lineMedal(line, candidate(["SWING", "BACKFLIP"])), 1);
  assert.equal(app.lineMedal(line, candidate(["SWING", "BACKFLIP", "AIR"], 1)), 2);
  assert.equal(app.lineMedal(line, candidate(["SWING", "BACKFLIP", "AIR", "OLLIE"], 2)), 3);
  assert.equal(app.lineMedal(line, candidate(["SWING", "BACKFLIP", "AIR", "OLLIE"], 2, 1)), 2);
  assert.equal(app.lineMedal(line, candidate(["SWING", "BACKFLIP", ...Array(35).fill("GIANT")], 20)), 2,
    "thirty-five repeated giants still provide only three trick types");
});

test("line PB is one matching bank, while only a chosen line attempt can set its time record", () => {
  for (const mode of [0, 1]) {
    const { app, ctx } = ride(mode); app.slot().lineBest[0][0] = 85000;
    replay(app); app.guard.settle(); const record = app.lineRecord(0, 0);
    assert.equal(record.best, app.bestCombo); assert.equal(record.best, app.score);
    assert.equal(app.slot().lineBest[0][0], 85000, "old full-attempt records remain separate");
    if (mode === 1) assert.equal(record.time, Math.round(FIRST_ROUTE.frames / 60 * 100) / 100); else assert.equal(record.time, 0);
    const before = structuredClone(record);
    app.trick("GIANT", 250); app.bank(); app.guard.settle();
    assert.deepEqual(app.lineRecord(0, 0), before, "an unrelated bank cannot inflate the matching line PB or shorten its time");
    assert.equal(ctx.calls.score.length, 0, "bank checkpoints do not post session leaderboards");
  }
});

test("half-speed practice advances physics and camera by physics time while grace uses real time", () => {
  const slow = ride(2).app, normal = ride(2).app;
  slow.practiceSlow = true; slow.resume(); const position = slow.p.x;
  run(slow, 0.5); assert.equal(slow.p.x, position); assert.ok(Math.abs(slow.resumeT - 0.1) < 1e-8);
  run(slow, 0.2); assert.equal(slow.resumeT, 0);
  slow.start(); slow.practiceSlow = true;
  for (let frame = 0; frame < 120; frame++) { slow.update(DT); normal.update(DT / 2); }
  for (const field of ["x", "y", "s", "rot"]) assert.ok(Math.abs(slow.p[field] - normal.p[field]) < 1e-8, field);
  assert.ok(Math.abs(slow.camX - normal.camX) < 1e-8); assert.ok(Math.abs(slow.camY - normal.camY) < 1e-8);
  assert.ok(Math.abs(slow.runTime - 1) < 1e-8); assert.equal(slow.clock, 120);
});

test("practice checkpoint from the previous park is not offered after an actual setup park choice", () => {
  const { app } = ride(2); replay(app); assert.ok(app.practiceCheckpoint);
  app.cancel(); // The system menu cancels the final held route edge before setup.
  app.slot().goals[0] = [0, 1, 2]; // The parked career permits visiting the next park.
  app.phase = "setup"; app.cursor = app.setupItems().findIndex(row => row.id === "park");
  press(app, 0.55); assert.equal(app.parkId, 1);
  assert.ok(!app.practiceSpawns().some(spawn => spawn.checkpoint));
  app.start(); assert.ok(!app.menuActions().some(row => row.label === "RESET TO LAST SAFE BANK"));
});

test("the recorded Rolling Link route earns all Bowl gold tiers through actual controls and survives reload", () => {
  const rig = ride(1), { app } = rig; app.slot().line = 2; app.start();
  replay(app, GOLD_ROUTE.frames, GOLD_ROUTE.input);
  app.guard.settle();
  for (let line = 0; line < 3; line++) assert.equal(app.lineRecord(0, line).medal, 3);
  assert.equal(app.lineRecord(0, 0).time, 0); assert.equal(app.lineRecord(0, 1).time, 0);
  assert.ok(app.lineRecord(0, 2).time > 0 && app.lineRecord(0, 2).time <= GOLD_ROUTE.frames / 60);
  assert.deepEqual(mount(rig.durable()).app.slot().lineMedals[0], [3, 3, 3, 0]);
});
