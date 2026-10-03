import test from "node:test";
import assert from "node:assert/strict";
import { HighBar, migrateSave } from "../web/apps/highbar.js";
import { appContext, fakeCanvas, run } from "./helpers/app-context.mjs";

const F = 1 / 60;
const tap = (app, ms = 60) => { app.down({ source: "keyboard" }); app.up({ source: "keyboard", durationMs: ms }); };
const hold = (app, ms = 700) => { app.down({ source: "keyboard" }); app.up({ source: "keyboard", durationMs: ms }); };

function mount(options = {}) {
  const ctx = appContext(options);
  if (options.lamps) ctx.lampCount = () => options.lamps;
  const board = [];
  ctx.board = (rgb) => board.push(rgb.slice());
  const app = new HighBar(ctx);
  return { ctx, app, board };
}
function riding(options) {
  const m = mount(options);
  tap(m.app);
  assert.equal(m.app.phase, "play");
  return m;
}
// Put the rider in free flight at (x, y) with velocity (vx, vy), upright.
function fly(app, x, y, vx, vy) {
  Object.assign(app.p, { mode: "air", x, y, vx, vy, rot: 0, rotV: 0, tuck: false, vert: 0 });
  app.air = { t: 0, rot: 0, x0: x, xMin: x, xMax: x, y0: y, apex: y, fromBar: -1, ollie: false, vert: false, dir: Math.sign(vx) || 1 };
}
const untilMode = (app, mode, seconds = 6) => {
  for (let i = 0; i < seconds * 60 && app.p.mode !== mode; i++) app.update(F);
  return app.p.mode === mode;
};

test("a tap on the title starts a session that drops in and rolls", () => {
  const { app } = riding();
  const x0 = app.p.x;
  run(app, 1);
  assert.equal(app.p.mode, "ground");
  assert.ok(app.p.x > x0 + 200, "the drop-in carries the rider into the bowl");
  assert.ok(Math.abs(app.p.s) > 300);
});

test("a press near a bar grabs it and the swing follows a pendulum", () => {
  const { app } = riding();
  const [bx, by] = app.park().bars[0];
  fly(app, bx - 60, by + 120, 300, -50);
  assert.ok(app.pickBar() === 0, "the bar is marked as in reach");
  app.down({ source: "keyboard" });
  run(app, 0.1);
  assert.equal(app.p.mode, "bar");
  const r0 = Math.hypot(app.p.x - bx, app.p.y - by);
  run(app, 0.5);
  assert.ok(Math.abs(Math.hypot(app.p.x - bx, app.p.y - by) - r0) < 0.5, "a rigid line");
  app.up({ source: "keyboard", durationMs: 600 });
  assert.equal(app.p.mode, "air");
  assert.ok(app.combo.tricks.some((k) => k.name === "SWING"));
});

test("a short tap that ends before the grab lands does not grab", () => {
  const { app } = riding();
  const [bx, by] = app.park().bars[0];
  fly(app, bx - 60, by + 120, 300, -50);
  tap(app, 30);
  run(app, 0.1);
  assert.notEqual(app.p.mode, "bar");
});

test("a full turn round a bar is a GIANT, and repeats in one combo are worth less", () => {
  const { app } = riding();
  const [bx, by] = app.park().bars[1];
  fly(app, bx, by + 120, 900, 0);
  app.down({ source: "keyboard" });
  run(app, 3);
  const giants = app.combo.tricks.filter((k) => k.name === "GIANT");
  assert.ok(giants.length >= 2, "fast enough to go round twice");
  assert.ok(giants[1].pts < giants[0].pts);
  assert.equal(app.combo.giants, giants.length);
});

test("an upright landing banks the combo after the roll; a crooked one bails and loses it", () => {
  const { app } = riding();
  fly(app, 700, 300, 200, -100);
  app.trick("AIR", 200);
  assert.ok(untilMode(app, "ground"));
  assert.equal(app.score, 0, "nothing banks while the roll window is open");
  run(app, 1.3);
  assert.equal(app.score, 200);
  assert.equal(app.combo.tricks.length, 0);

  fly(app, 700, 300, 200, -100);
  app.trick("AIR", 200);
  app.p.rot = 2.5; app.p.rotV = 0;
  app.p.tuck = true; app.p.tuckDir = 0; // a tuck with no spin holds the bad angle
  assert.ok(untilMode(app, "bail"));
  assert.equal(app.combo.tricks.length, 0);
  run(app, 3);
  assert.equal(app.score, 200, "the bailed combo scored nothing");
  assert.equal(app.p.mode, "ground", "the rider gets back up");
  assert.ok(Math.abs(app.p.s) > 150, "and rolls on at a fair speed");
});

test("holding in the air with no bar near tucks into a flip; letting go in time lands it", () => {
  const { app } = riding();
  fly(app, 700, 80, 120, -420);
  app.p.lastBar = -1;
  assert.equal(app.pickBar(), -1);
  app.down({ source: "keyboard" });
  assert.ok(app.p.tuck);
  let frames = 0;
  while (Math.abs(app.air.rot) < 5.6 && frames++ < 200) app.update(F);
  app.up({ source: "keyboard", durationMs: frames * 16 });
  assert.ok(untilMode(app, "ground"), "landed rather than bailed");
  assert.ok(app.combo.tricks.some((k) => /FLIP$/.test(k.name)), JSON.stringify(app.combo.tricks));
  assert.equal(app.combo.maxFlip, 1);
});

test("on the ground a hold crouches and the release pops an ollie", () => {
  const { app } = riding();
  Object.assign(app.p, { mode: "ground", x: 200, s: 300 });
  app.p.y = app.groundY(200);
  assert.equal(app.pickBar(), -1);
  app.down({ source: "keyboard" });
  assert.ok(app.p.crouch);
  app.up({ source: "keyboard", durationMs: 200 });
  assert.equal(app.p.mode, "air");
  assert.ok(app.air.ollie);
  assert.ok(untilMode(app, "ground", 2), "and lands");
});

test("the bowl walls are vert: the rider goes up and comes back down the same wall", () => {
  const { app } = riding();
  const g = app.geo;
  Object.assign(app.p, { mode: "ground", x: g.lipR - 30, s: 700 });
  assert.ok(untilMode(app, "air", 1));
  assert.equal(app.p.vert, 1);
  assert.equal(app.p.vx, 0);
  assert.ok(untilMode(app, "ground", 4));
  assert.ok(app.p.s < 0, "back down into the bowl");
  assert.ok(app.p.x < g.lipR);
});

test("a session ends on the clock, scores once and saves once", () => {
  const { ctx, app } = riding();
  app.clock = 0.5;
  run(app, 12);
  assert.equal(app.phase, "over");
  assert.equal(ctx.calls.score.length, 1);
  const saves = ctx.calls.saved.length;
  assert.ok(saves >= 1);
  const saved = ctx.calls.saved.at(-1);
  assert.equal(saved.schema, 1);
  assert.equal(saved.runs, 1);
  assert.equal(saved.slots[0].runs, 1);
  assert.ok(JSON.stringify(saved).length < 8192);
  run(app, 3);
  assert.equal(ctx.calls.saved.length, saves, "no saving every frame");
  tap(app);
  assert.equal(app.phase, "play", "a tap after the lockout rides again");
});

test("the result screen ignores presses during the lockout", () => {
  const { app } = riding();
  app.finish();
  tap(app);
  assert.equal(app.phase, "over");
  run(app, 0.7);
  tap(app);
  assert.equal(app.phase, "play");
});

test("goals are met by banked combos and three of them open the next park", () => {
  const { app } = riding();
  app.combo.tricks = [{ name: "BACKFLIP", pts: 300 }, { name: "GIANT", pts: 250 }, { name: "AIR", pts: 200 }, { name: "SWING", pts: 60 }];
  app.combo.sum = 810; app.combo.giants = 1; app.combo.maxFlip = 1;
  app.bank();
  assert.equal(app.score, 810 * 4);
  assert.deepEqual(app.slot().goals[0], [0, 1, 2, 3]);
  assert.ok(app.newGoals.some((s) => s.includes("THE YARD")));
  app.finish();
  run(app, 1);
  hold(app);
  assert.equal(app.phase, "setup");
  tap(app); // to PARK
  hold(app);
  assert.equal(app.parkId, 1);
  assert.equal(app.park().name, "THE YARD");
});

test("a locked park cannot be chosen", () => {
  const { app } = mount();
  hold(app);
  tap(app);
  hold(app);
  assert.equal(app.parkId, 0, "only THE BOWL is open on a new slot");
});

test("save slots are separate, and erasing needs a second hold", () => {
  const { ctx, app } = riding();
  app.score = 5000; app.finish();
  assert.equal(app.slot().runs, 1);
  run(app, 1);
  hold(app); // setup
  tap(app); tap(app); // to SAVE SLOT
  hold(app);
  assert.equal(app.save.slot, 1);
  assert.equal(app.slot().runs, 0, "slot 2 is a fresh save");
  assert.equal(ctx.calls.saved.at(-1).runs, 0, "the host's run count follows the slot");
  hold(app); hold(app); // back to slot 1
  assert.equal(app.save.slot, 0);
  assert.equal(app.slot().runs, 1);
  tap(app); // to ERASE
  hold(app);
  assert.equal(app.slot().runs, 1, "the first hold only asks");
  hold(app);
  assert.equal(app.slot().runs, 0);
  assert.equal(app.save.slots.length, 3);
});

test("a saved game comes back in its slot and park", () => {
  const { app } = riding();
  app.slot().goals[0] = [0, 1, 2];
  app.save.slot = 2; app.save.slots[2].goals[0] = [0, 1, 2]; app.save.slots[2].park = 1; app.save.slots[2].runs = 4;
  const back = mount({ progress: JSON.parse(JSON.stringify(app.save)) }).app;
  assert.equal(back.save.slot, 2);
  assert.equal(back.parkId, 1);
  assert.equal(back.save.runs, 4);
  assert.equal(back.save.milestone, 3);
});

test("migrateSave survives junk and keeps what is valid", () => {
  for (const junk of [null, undefined, 3, "x", [], { schema: 9 }, { slots: "no" }, { slots: [null, 5, { goals: "x" }] }, { slot: 99 }, { slot: -4, slots: [{ runs: -3, best: [NaN] }] }]) {
    const s = migrateSave(junk);
    assert.equal(s.schema, 1);
    assert.equal(s.slots.length, 3);
    assert.ok(s.slot >= 0 && s.slot < 3);
    assert.equal(typeof s.runs, "number");
    assert.equal(typeof s.milestone, "number");
  }
  const s = migrateSave({ slot: 1, slots: [{}, { runs: 7, park: 3, goals: [[0, 1, 1, 9, 2], [], [], []], best: [1200] }] });
  assert.deepEqual(s.slots[1].goals[0], [0, 1, 2]);
  assert.equal(s.slots[1].park, 0, "a park that is not open falls back to the first");
  assert.equal(s.runs, 7);
  assert.equal(s.milestone, 3);
});

test("lamps: four on the new node, three on the old one, dark after leaving; the board LED is an accent", () => {
  for (const lamps of [3, 4]) {
    const { ctx, app, board } = riding({ lamps });
    run(app, 2);
    assert.ok(ctx.calls.leds.length > 0);
    assert.ok(ctx.calls.leds.every((v) => v.length === lamps * 3), "lamp frames match the node");
    app.combo.tricks = [1, 2, 3, 4, 5].map((i) => ({ name: "T" + i, pts: 100 }));
    app.combo.sum = 500;
    app.bank();
    run(app, 0.1);
    assert.ok(board.some((rgb) => rgb.some((v) => v > 0)), "a big combo lights the board LED");
    run(app, 2);
    assert.deepEqual(board.at(-1), [0, 0, 0], "and it goes dark again");
    app.dispose();
    assert.ok(ctx.calls.leds.at(-1).every((v) => v === 0));
  }
});

test("a session of random play in every park draws without throwing", () => {
  for (let park = 0; park < 4; park++) {
    const { ctx, app } = mount({ seed: 11 + park, lamps: 4 });
    app.save.slots[0].goals = [[0, 1, 2], [0, 1, 2], [0, 1, 2], []];
    app.parkId = park;
    tap(app);
    const g = fakeCanvas();
    let down = false;
    run(app, 130, (i) => {
      if (i % 3 === 0 && app.phase === "play") {
        const r = ctx.rng.next();
        if (!down && r < 0.08) { app.down({ source: "keyboard" }); down = true; }
        else if (down && r < 0.12) { app.up({ source: "keyboard", durationMs: 300 }); down = false; }
      }
      if (i % 2 === 0) app.draw(g);
      for (const v of [app.p.x, app.p.y, app.camX, app.camY, app.score]) assert.ok(Number.isFinite(v));
    });
    assert.equal(app.phase, "over", "park " + park + " session ended");
    app.draw(g);
    hold(app);
    app.draw(g);
  }
});
