import test from "node:test";
import assert from "node:assert/strict";
import { Cairn, migrateSave } from "../web/apps/cairn.js";
import { CAIRN_PHYSICS as P, PLATFORMS, CHECKPOINTS, SUMMIT, launchFor } from "../web/apps/cairn-content.js";
import { InputRouter } from "../web/engine/input.js";
import { appContext, fakeCanvas } from "./helpers/app-context.mjs";

// A recorded button-only climb. Values are facing and hold frames (60 Hz).
// This witness has no teleport, pose write, checkpoint injection or completion shortcut.
export const CAIRN_ROUTE = [[1,38],[1,42],[-1,38],[-1,42],[1,39],[1,44],[-1,39],[-1,41],
  [-1,52],[1,42],[1,40],[1,35],[-1,42],[-1,40],[-1,54],[1,40],[1,46],[1,38],
  [-1,43],[-1,39],[-1,41],[1,40],[1,41],[1,39],[-1,42],[-1,42],[-1,54],[1,41],[1,44]];

function rig(options = {}) {
  const ctx = appContext({ lampCount: 4, boardLed: true, ...options }), app = new Cairn(ctx);
  let now = 0, open = false, menus = 0, cancelling = false;
  ctx.cancelGesture = () => cancelling;
  const host = { epoch: 0, holdMs: () => 650, inputMode: () => open ? "menu" : "raw",
    escapePolicy: () => ({ pace: ctx.settings().gesturePace }), pressVisual() {}, holdVisual() {}, clickVisual() {},
    rawDown: e => app.down(e), rawUp: e => app.up(e), rawCancel: () => app.cancel(),
    requestMenu() { menus++; cancelling = true; router.cancel(); app.cancel(); app.pause(); cancelling = false; open = true; host.epoch++; } };
  const router = new InputRouter(host, () => now);
  const edge = action => router[action]({ source: "node", generation: 1, at_us: Math.round(now * 1000) });
  const r = { app, ctx, router, edge, menus: () => menus,
    step(n = 1) { for (let i = 0; i < n; i++) { now += 1000 / 60; router.update(); if (!open) app.update(1 / 60); } },
    press(n) { edge("down"); r.step(n); edge("up"); },
    resume() { open = false; host.epoch++; router.cancel(); app.resume(); },
    jump(dir, frames) {
      assert.ok(app.p.ground >= 0, "launch must start supported");
      if (app.p.facing !== dir) { r.press(4); r.step(20); }
      r.press(frames);
      let minimum = app.p.y, maximum = app.p.y, framesInAir = 0;
      for (; framesInAir < 600 && app.p.ground < 0; framesInAir++) {
        r.step(); minimum = Math.min(minimum, app.p.y); maximum = Math.max(maximum, app.p.y);
        assert.ok(470 - app.p.y + app.camera <= 486, "camera keeps the creature visible through a long fall");
      }
      assert.ok(framesInAir < 600, "flight must settle"); return { minimum, maximum, framesInAir };
    },
    climb(n = CAIRN_ROUTE.length) { if (app.phase === "title") r.press(4); for (let i = 0; i < n; i++) { r.jump(...CAIRN_ROUTE[i]); assert.equal(app.p.ground, i + 1, `recorded landing ${i + 1}`); } },
  };
  return r;
}

test("CAIRN: a real button-only route visits all 30 shelves, four regions and the summit", () => {
  const r = rig(); r.climb(); const a = r.app;
  assert.equal(a.phase, "over"); assert.equal(a.p.y, SUMMIT); assert.equal(a.save.summits, 1);
  assert.equal(a.save.checkpoint, 2); assert.equal(a.jumps, 29); assert.equal(a.falls, 0);
  assert.ok(a.save.bestSeconds > 45 && a.save.bestSeconds < 60); assert.equal(a.save.active, null);
  assert.equal(r.ctx.calls.score.at(-1)[0], 365);
  assert.equal(r.menus(), 0);
  const scoreCount = r.ctx.calls.score.length, saves = r.ctx.calls.saved.length;
  r.step(240); assert.equal(r.ctx.calls.score.length, scoreCount); assert.equal(r.ctx.calls.saved.length, saves);
  assert.equal(a.save.summits, 1);
});

test("CAIRN: early mistake loses 85 metres; late mistakes lose whole sections", () => {
  for (const [shelf, direction, hold, floor, minDrop] of [[7,-1,27,0,800], [16,1,28,8,1150], [26,1,34,17,1300]]) {
    const r = rig(); r.climb(shelf); const from = r.app.p.y;
    const flight = r.jump(direction, hold);
    assert.ok(from - flight.minimum > minDrop, `substantial fall from shelf ${shelf}`);
    assert.equal(r.app.p.ground, floor); assert.equal(r.app.falls, 1);
    assert.equal(r.app.save.checkpoint, PLATFORMS[floor].checkpoint);
  }
});

test("CAIRN: repeating full charge is not the recorded route", () => {
  const r = rig(); r.press(4); const reached = [];
  for (const [direction] of CAIRN_ROUTE) { r.jump(direction, 57); reached.push(r.app.p.ground); }
  assert.notEqual(r.app.phase, "over"); assert.ok(Math.max(...reached) < 15);
});

test("CAIRN: short releases turn; generic and optional side knocks remain supplementary", () => {
  const r = rig(); r.press(4); r.press(4); assert.equal(r.app.p.facing, -1); assert.equal(r.app.jumps, 0);
  r.app.knock({ side: "left" }); assert.equal(r.app.p.facing, 1, "generic mode ignores the side label");
  r.ctx.settings().tapMode = "sides"; r.app.knock({ side: "left" }); assert.equal(r.app.p.facing, -1);
  r.app.knock({ side: "right" }); assert.equal(r.app.p.facing, 1);
  r.app.knock({ side: "back" }); assert.equal(r.app.p.facing, -1);
});

test("CAIRN: source duration controls launch power even if edges arrive together", () => {
  const r = rig(); r.press(4); const a = r.app;
  a.down(); a.up({ durationMs: 800 });
  assert.equal(a.p.vx, launchFor(0.8).vx); assert.equal(a.p.vy, launchFor(0.8).vy);
  const pose = { ...a.p }; a.knock({ side: "left" }); a.down(); a.up({ durationMs: 1200 });
  assert.deepEqual(a.p, pose); assert.equal(a.jumps, 1);
});

test("CAIRN: airborne hold cannot turn into a landing jump", () => {
  const r = rig(); r.press(4); r.press(38); assert.equal(r.app.p.ground, -1);
  r.edge("down"); r.step(140); assert.ok(r.app.p.ground >= 0); const pose = { ...r.app.p };
  r.edge("up"); assert.deepEqual(r.app.p, pose); assert.equal(r.app.jumps, 1);
});

test("CAIRN: pause preserves exact mid-flight state; release after cancellation does nothing", () => {
  const r = rig(); r.press(4); r.press(38); r.step(10);
  const a = r.app, pose = { ...a.p }, seconds = a.elapsed;
  a.cancel(); a.pause(); a.update(1); a.up({ durationMs: 900 });
  assert.deepEqual(a.p, pose); assert.equal(a.elapsed, seconds);
  a.resume(); a.update(1 / 60); assert.notEqual(a.p.y, pose.y); assert.equal(a.jumps, 1);
});

test("CAIRN: ordinary cancelled charge has no ghost release or jump", () => {
  const r = rig(); r.press(4); r.edge("down"); r.step(40); const pose = { ...r.app.p };
  r.app.cancel(); r.app.up({ durationMs: 900 }); assert.deepEqual(r.app.p, pose); assert.equal(r.app.charge, 0);
  r.app.down(); r.app.up({ durationMs: 50 }); assert.equal(r.app.jumps, 0); assert.equal(r.app.p.facing, -pose.facing);
});

for (const pace of ["quick", "standard", "relaxed"]) test(`CAIRN: ${pace} tap/tap/hold menu fully restores play and durable writes`, () => {
  const r = rig({ settings: { gesturePace: pace } }); r.climb(3); r.step(35);
  const a = r.app, snapshot = a.guard.snapshot().saved, saved = r.ctx.calls.saved.length, scores = r.ctx.calls.score.length;
  r.press(4); r.step(3); r.press(4); r.step(3); r.edge("down"); r.step(120);
  assert.equal(r.menus(), 1); r.edge("up"); r.resume();
  assert.deepEqual(a.guard.snapshot().saved, snapshot); assert.equal(r.ctx.calls.saved.length, saved); assert.equal(r.ctx.calls.score.length, scores);
});

for (const shelf of [7,28]) test(`CAIRN: menu rewinds a ${shelf === 7 ? "cairn" : "summit"} landing reached during the gesture`, () => {
  const r = rig(); r.climb(shelf); const [dir, frames] = CAIRN_ROUTE[shelf];
  if (r.app.p.facing !== dir) { r.press(4); r.step(20); } r.press(frames);
  const a = r.app, snapshot = a.guard.snapshot().saved, saved = r.ctx.calls.saved.length, scores = r.ctx.calls.score.length;
  r.press(4); r.step(3); r.press(4); r.step(3); r.edge("down"); r.step(75);
  assert.equal(a.p.ground, shelf + 1, "the award must actually happen before cancellation");
  assert.equal(r.ctx.calls.saved.length, saved); assert.equal(r.ctx.calls.score.length, scores);
  r.step(45); assert.equal(r.menus(), 1); r.edge("up"); r.resume();
  assert.deepEqual(a.guard.snapshot().saved, snapshot); assert.equal(r.ctx.calls.saved.length, saved); assert.equal(r.ctx.calls.score.length, scores);
});

test("CAIRN: burst-delivered source edges restore title and discard a speculative new run", () => {
  const r = rig(), before = r.app.guard.snapshot().saved;
  for (const [action, at] of [["down",0],["up",60],["down",110],["up",170],["down",220],["up",1900]])
    r.router[action]({ source: "node", generation: 1, at_us: at * 1000 });
  assert.equal(r.menus(), 1); r.resume(); assert.deepEqual(r.app.guard.snapshot().saved, before);
  assert.equal(r.ctx.calls.saved.length, 0); assert.equal(r.ctx.calls.score.length, 0);
});

test("CAIRN: crossing a cairn in the air does not unlock it", () => {
  const r = rig(); r.climb(7); r.press(57);
  while (r.app.p.y <= PLATFORMS[8].y && r.app.p.ground < 0) r.step();
  assert.ok(r.app.p.y > PLATFORMS[8].y); assert.equal(r.app.anchor, 0); assert.equal(r.app.save.checkpoint, 0);
});

test("CAIRN: leaving on an ordinary ledge or in flight resumes only at the earned cairn", () => {
  for (const shelf of [7, 12, 25]) {
    const r = rig(); r.climb(shelf); r.app.dispose(); const save = r.ctx.calls.saved.at(-1);
    const expected = shelf < 8 ? 0 : shelf < 17 ? 8 : 17;
    assert.equal(save.active.platform, expected);
    const again = rig({ progress: save }); again.press(4);
    assert.equal(again.app.p.ground, expected); assert.equal(again.app.p.vx, 0); assert.equal(again.app.p.vy, 0);
    assert.equal(again.app.held, false); assert.equal(again.app.charge, 0); assert.equal(again.app.eligible, false);
    assert.equal(again.app.save.highest, PLATFORMS[shelf].y);
  }
});

test("CAIRN: checkpoints survive a new base run, which must earn its own fall protection", () => {
  const r = rig(); r.climb(18); const stored = r.app.save.checkpoint;
  r.app.menuActions()[0].run(); assert.equal(r.app.p.ground, 0); assert.equal(r.app.anchor, 0);
  assert.equal(r.app.save.checkpoint, stored); assert.equal(r.app.eligible, true); assert.equal(r.app.elapsed, 0);
  r.app.menuActions()[1].run(); assert.equal(r.app.p.ground, CHECKPOINTS[stored]); assert.equal(r.app.eligible, false);
});

test("CAIRN: resumed summit is earned without overwriting the full-base time record", () => {
  const r = rig(); r.climb(17); r.app.dispose();
  const again = rig({ progress: r.ctx.calls.saved.at(-1) }); again.press(4);
  // The cairn's canonical centre is 600; the full route arrived at 604.2. A 39-frame
  // departure is the recorded legal adjustment for this distinct starting position.
  again.jump(1, 39);
  assert.equal(again.app.p.ground, 18);
  for (let i = 18; i < CAIRN_ROUTE.length; i++) again.jump(...CAIRN_ROUTE[i]);
  assert.equal(again.app.phase, "over"); assert.equal(again.app.save.summits, 1); assert.equal(again.app.save.bestSeconds, 0);
});

test("CAIRN: first-cairn resume has a button-only route through the remaining three sections", () => {
  const r = rig(); r.climb(8); r.app.dispose(); const again = rig({ progress: r.ctx.calls.saved.at(-1) }); again.press(4);
  for (let i = 8; i < CAIRN_ROUTE.length; i++) { again.jump(...CAIRN_ROUTE[i]); assert.equal(again.app.p.ground, i + 1); }
  assert.equal(again.app.phase, "over"); assert.equal(again.app.save.bestSeconds, 0);
});

test("CAIRN: solid underside, lateral rebound and fast falling contacts cannot tunnel", () => {
  // Isolated collision fixtures, separate from the no-injection route witness above.
  const a = rig().app; a.start(true);
  a.p = { x: 400, y: 50, vx: 0, vy: 350, facing: 1, ground: -1 };
  for (let i = 0; i < 10; i++) a.update(1 / 60);
  assert.ok(a.p.y < PLATFORMS[1].y - PLATFORMS[1].h - P.height);
  assert.ok(a.p.vy < 0); assert.equal(a.p.ground, -1);
  a.p = { x: 350, y: 95, vx: 315, vy: 0, facing: 1, ground: -1 }; a.update(1 / 60);
  assert.ok(a.p.vx < 0); assert.ok(a.p.x <= 355);
  a.p = { x: 400, y: 112, vx: 0, vy: -950, facing: 1, ground: -1 }; a.update(1 / 60);
  assert.equal(a.p.ground, 1); assert.equal(a.p.y, 105); assert.equal(a.p.vy, 0);
});

test("CAIRN: precision at an upper ledge comes from a narrow, measurable release window", () => {
  const accepted = [];
  for (let hold = 35; hold <= 44; hold++) {
    const r = rig(); r.climb(17); r.jump(1, hold);
    if (r.app.p.ground === 18) accepted.push(hold);
  }
  assert.deepEqual(accepted, [38,39]);
});

test("CAIRN: hostile or obsolete saves become bounded plain data without velocity or held input", () => {
  const result = migrateSave({ schema: 1, physicsVersion: "cairn-v1", runs: Infinity, highest: 1e100, summits: -3, checkpoint: 100,
    bestSeconds: NaN, active: { platform: 17, anchor: 2, x: -Infinity, facing: -1, vx: 900, held: true, seconds: -3, jumps: 1e99 },
    extra: "x".repeat(10000), last: { height: Infinity, seconds: 1e99, jumps: NaN, falls: -3, summit: "yes" } });
  assert.equal(result.highest, SUMMIT); assert.equal(result.runs, 0); assert.equal(result.summits, 0);
  assert.equal(result.active.x, 600); assert.equal(result.active.seconds, 0); assert.equal(result.active.jumps, 1e7);
  assert.equal(result.active.vx, undefined); assert.equal(result.active.held, undefined); assert.ok(JSON.stringify(result).length < 800);
  assert.deepEqual(migrateSave(result), result);
  const old = migrateSave({ ...result, physicsVersion: "old", bestSeconds: 2 });
  assert.equal(old.active, null); assert.equal(old.checkpoint, 0); assert.equal(old.bestSeconds, 0);
  assert.equal(migrateSave({ ...result, active: { ...result.active, platform: 26 } }).active, null);
});

test("CAIRN: four lamps communicate full charge and cleanup owns all light output", () => {
  const r = rig(); r.press(4); r.edge("down"); r.step(60);
  const lamps = r.ctx.calls.leds.at(-1); assert.equal(lamps.length, 12);
  for (let i = 0; i < 4; i++) assert.ok(lamps.slice(i * 3, i * 3 + 3).some(v => v > 0));
  r.app.cancel(); r.app.pause(); const lights = r.ctx.calls.leds.length, boards = r.ctx.calls.board.length;
  r.app.update(1 / 60); assert.equal(r.ctx.calls.leds.length, lights); assert.equal(r.ctx.calls.board.length, boards);
  assert.deepEqual(r.ctx.calls.board.at(-1), [0,0,0]);
});

test("CAIRN: quiet canvas rendering and particle work remain bounded throughout the real route", () => {
  const r = rig(); const canvas = fakeCanvas(); r.app.draw(canvas); r.press(4);
  for (const input of CAIRN_ROUTE) { r.jump(...input); r.app.draw(canvas); assert.ok(r.app.parts.length <= 36); }
  assert.ok(canvas.count.fillText < 450); assert.ok(canvas.count.fillRect < 2500);
  assert.ok(r.app.camera >= 0 && r.app.camera <= SUMMIT - 100);
  const still = rig({ settings: { reducedMotion: true } }); still.climb(3); assert.equal(still.app.parts.length, 0);
});
