import test from "node:test";
import assert from "node:assert/strict";
import { HighBar, migrateSave } from "../web/apps/highbar.js";
import { InputRouter } from "../web/engine/input.js";
import { appContext, run, fakeCanvas } from "./helpers/app-context.mjs";
test("a real-controls session banks without case taps; optional style contributes distinct banked tricks", () => {
  function bot(style) {
    const { app } = ride(); let down = false, pressedAt = 0, tapAt = -9;
    const banked = new Set(), bank = app.bank.bind(app);
    app.bank = () => { for (const trick of app.combo.tricks) banked.add(trick.name); bank(); };
    for (let i = 0; i < 8000 && app.phase === "play"; i++) {
      const p = app.p, t = i / 60;
      if (i % 6 === 0) {
        let want = false;
        if (p.mode === "bar") want = !(p.held > 0.8 && p.vy < -120);
        else if (p.mode === "ground") want = app.combo.roll >= 0 ? false : down ? t - pressedAt < 0.65 : true;
        else if (p.mode === "air") {
          const dy = app.groundY(p.x) - p.y;
          const landing = (-p.vy + Math.sqrt(Math.max(0, p.vy * p.vy + 1300 * dy))) / 650;
          want = app.pickBar() >= 0 || (landing > 0.9 && Math.abs(app.air?.rot || 0) < 5.6);
        }
        if (want && !down) { app.down({ source: "keyboard" }); down = true; pressedAt = t; }
        if (!want && down) { app.up({ source: "keyboard", durationMs: (t - pressedAt) * 1000 }); down = false; }
        if (style && t - tapAt > 0.65 && (p.mode === "bar" || p.mode === "air" && app.air?.t > 0.2)) {
          app.knock(); tapAt = t;
        }
      }
      app.update(F);
    }
    return { app, banked };
  }
  const plain = bot(false), withStyle = bot(true), button = plain.app, styled = withStyle.app;
  assert.equal(button.phase, "over"); assert.equal(styled.phase, "over");
  assert.ok(button.stats.banks >= 10 && button.score > 3000, "button-only can bank and progress");
  assert.ok(button.slot().goals[0].length >= 3, "button-only can unlock THE YARD");
  assert.ok(["SHOVE-IT", "REGRIP"].some(name => withStyle.banked.has(name)), "case actions contribute actual banked tricks");
  assert.ok(!["SHOVE-IT", "REGRIP", "MANUAL"].some(name => plain.banked.has(name)), "button-only banks do not invent case tricks");
  assert.ok(styled.score > 3000 && styled.stats.banks > 0, "styled play can still bank and progress");
});

const F = 1 / 60;
function mount(options = {}) {
  const ctx = appContext({ settings: { knock: "medium", ...(options.settings || {}) }, ...options });
  ctx.lampCount = () => 4;
  const board = []; ctx.board = rgb => board.push([...rgb]);
  const app = new HighBar(ctx);
  return { app, ctx, board };
}
function ride(options) { const m = mount(options); m.app.slot().guided = true; m.app.start(); return m; }
function flat(app) {
  Object.assign(app.p, { mode: "ground", x: 700, y: app.groundY(700), s: 220, rot: 0, vx: 0, vy: 0 });
}
function air(app, { x = 700, y = app.park().floor - 330, vx = 100, vy = -260 } = {}) {
  Object.assign(app.p, { mode: "air", x, y, vx, vy, rot: 0, rotV: 0, tuck: false, vert: 0 });
  app.air = { t: 0.2, rot: 0, x0: x, xMin: x, xMax: x, y0: y, apex: y,
    fromBar: -1, ollie: true, vert: false, dir: Math.sign(vx) || 1 };
}
function reachGround(app) { for (let i = 0; i < 360 && app.p.mode === "air"; i++) app.update(F); }

test("schema 1 migrates every private slot and active choice without changing historical records", () => {
  const raw = { schema: 1, slot: 2, slots: [0, 1, 2].map(i => ({
    runs: 5 + i, park: i, best: [101 + i, 202 + i, 303 + i, 404 + i], bestCombo: 900 + i,
    goals: [[0, 1, 2], [0, 1, 2], [0, 1, 2], []], last: { score: 500 + i, combo: 99, park: "P" + i }
  })) };
  const original = structuredClone(raw), next = migrateSave(raw);
  assert.deepEqual(raw, original, "migration does not mutate its input");
  assert.equal(next.slot, 2); assert.equal(next.schema, 3);
  for (let i = 0; i < 3; i++) {
    for (const key of ["runs", "park", "best", "goals", "last"]) assert.deepEqual(next.slots[i][key], original.slots[i][key]);
    assert.equal(next.slots[i].legacyRecords.styleV2.bestCombo, original.slots[i].bestCombo);
    assert.equal(next.slots[i].bestCombo, 0, "changed physics starts a separate combo PB");
    assert.deepEqual(next.slots[i].flowBest, [0, 0, 0, 0]);
    assert.deepEqual(next.slots[i].styleBest, [0, 0, 0, 0]);
    assert.deepEqual(next.slots[i].lines, [[], [], [], []]);
  }
  assert.ok(JSON.stringify(next).length < 8192);
  assert.deepEqual(migrateSave(next), next);
});

test("first launch teaches controls, and a replay guide returns to the exact running line", () => {
  const { app } = mount();
  app.menuPress(0); assert.equal(app.phase, "guide");
  for (let i = 0; i < 6; i++) app.menuPress(0);
  assert.equal(app.phase, "play"); assert.ok(app.slot().guided);
  const clock = app.clock, x = app.p.x;
  app.menuActions().find(a => a.label === "GAME GUIDE").run();
  run(app, 2); assert.equal(app.clock, clock, "the guide freezes play");
  app.menuPress(0.7);
  assert.equal(app.phase, "play"); assert.equal(app.p.x, x);
});

test("first-use teaching also follows park/setup selection, and controls follow guide/setup phases", () => {
  const { app, ctx } = mount();
  app.update(F); app.menuPress(0.7); app.update(F);
  assert.equal(app.phase, "setup");
  assert.equal(ctx.calls.controls.at(-1), "BUTTON: NEXT · CASE: PREVIOUS · HOLD: CHOOSE");
  app.menuPress(0.7); app.update(F);
  assert.equal(app.phase, "guide", "setup RIDE preserves the first-use lesson");
  assert.match(ctx.calls.controls.at(-1), /NEXT PAGE/);
  app.menuPress(0.7); app.update(F);
  assert.equal(app.phase, "play"); assert.ok(app.slot().guided);
  app.menuActions().find(a => a.label === "GAME GUIDE").run(); app.update(F);
  assert.match(ctx.calls.controls.at(-1), /NEXT PAGE/);
  app.menuPress(0.7); app.update(F);
  assert.match(ctx.calls.controls.at(-1), /PUMP/);
});

test("game menu actions resume the host after opening the guide, restarting or ending", () => {
  for (const label of ["GAME GUIDE", "RESTART SESSION", "END SESSION", "LEAVE PRACTICE"]) {
    const { app, ctx } = ride(); let resumed = 0; ctx.resume = () => resumed++;
    if (label === "LEAVE PRACTICE") { app.mode = 2; app.start(); }
    app.pause(); app.menuActions().find(a => a.label === label).run();
    assert.equal(resumed, 1, label + " closes the host menu");
    assert.equal(app.phase, label === "GAME GUIDE" ? "guide" : label === "RESTART SESSION" ? "play" : "over");
  }
});

test("named-line coaching shows what is missing, ready, lost on bail and actually banked", () => {
  const { app } = ride(); app.mode = 1; app.slot().line = 2;
  assert.equal(app.lineProgress(), "NEED MANUAL · AIRS 0/2");
  app.combo.airs = 1; app.combo.manual = true;
  assert.equal(app.lineProgress(), "MANUAL OK · AIRS 1/2");
  app.combo.airs = 2; app.trick("MANUAL", 100);
  assert.equal(app.lineProgress(), "READY — LAND AND ROLL TO BANK");
  app.bail(); assert.equal(app.lineProgress(), "NEED MANUAL · AIRS 0/2");
});

test("style readiness requires enough actual flight time, including uphill and vert landings", () => {
  for (const scenario of [
    { x: 700, height: 70, vx: 100, vy: 600 },
    { x: 1350, height: 130, vx: 700, vy: -80 },
  ]) {
    const { app } = ride(); air(app, { ...scenario, y: app.park().floor - scenario.height });
    const control = ride().app; air(control, { ...scenario, y: control.park().floor - scenario.height });
    assert.ok(app.groundY(app.p.x) - app.p.y >= 65, "the old height-only gate would accept this tap");
    assert.equal(app.canStyle(), false);
    assert.deepEqual(app.restingLamps().slice(9), [0, 0, 0]);
    app.knock(); assert.equal(app.air.style, undefined);
    reachGround(app); reachGround(control);
    assert.deepEqual(app.p, control.p, "the rejected tap adds no landing penalty");
  }
  const { app } = ride();
  air(app, { x: app.geo.lipR, y: app.geo.lipY - 70, vx: 0, vy: 600 }); app.p.vert = 1;
  assert.equal(app.canStyle(), false); app.knock(); assert.equal(app.air.style, undefined);
  const ready = ride().app; air(ready, { y: ready.park().floor - 230, vy: -160 });
  assert.equal(ready.canStyle(), true); ready.knock(); reachGround(ready);
  assert.equal(ready.combo.shove, true, "a complete accepted shove-it still scores on an actual landing");
});

test("a manual links two actual airs; unattended balance eventually bails", () => {
  const { app } = ride();
  air(app); reachGround(app); assert.equal(app.p.mode, "ground"); assert.equal(app.combo.airs, 1);
  flat(app); app.knock(); assert.ok(app.manual); assert.equal(app.combo.roll, -1);
  run(app, 0.9); app.knock();
  app.down({ source: "node" }); app.up({ source: "node", durationMs: 200 });
  assert.equal(app.p.mode, "air"); assert.ok(app.combo.manual);
  reachGround(app); assert.equal(app.p.mode, "ground"); assert.ok(app.combo.airs >= 2);
  run(app, 1.3); assert.ok(app.slot().lines[0].includes(2), "ROLLING LINK is banked through real air/manual physics");
  flat(app); app.knock(); run(app, 4.9);
  assert.ok(app.stats.bails > 0, "ignoring the balance is risky");
});

test("generic case taps ignore classifier side, optional sides bias balance without requiring them", () => {
  const snaps = [undefined, "left", "right", "back"].map(side => {
    const { app } = ride(); flat(app); app.knock({ side }); run(app, 0.6); app.knock({ side });
    return structuredClone(app.manual);
  });
  for (const s of snaps) assert.deepEqual(s, snaps[0]);
  const { app } = ride({ settings: { knock: "medium", tapMode: "sides" } });
  flat(app); app.knock(); run(app, 0.6); const before = app.manual.balance;
  app.knock({ side: "left" }); assert.ok(app.manual.balance < before);
  run(app, 0.6); app.knock({ side: "right" });
  assert.ok(app.manual, "directional play is optional and a generic tap starts the complete action");
});

test("air style has a broad window, scores once on landing and never on a late tap or bail", () => {
  const { app } = ride(); air(app); app.knock();
  assert.ok(app.air.style);
  run(app, 0.5); app.knock(); reachGround(app);
  assert.equal(app.p.mode, "ground");
  assert.equal(app.combo.tricks.filter(t => t.name === "SHOVE-IT").length, 1);
  run(app, 1.3); assert.ok(app.score > 0);
  const scored = app.score;
  air(app, { y: app.groundY(700) - 30, vy: 200 }); app.knock();
  assert.equal(app.air.style, undefined);
  app.p.rot = 2; app.p.tuck = true; app.p.tuckDir = 0; reachGround(app);
  assert.equal(app.p.mode, "bail"); assert.equal(app.score, scored);
});

test("regrip is one boost per catch and never slows an already fast swing", () => {
  const { app } = ride(); const [x, y] = app.park().bars[1];
  air(app, { x, y: y + 120, vx: 900, vy: 0 }); app.grab(1); app.p.held = 0.2;
  const speed = app.p.om; app.knock(); const boost = app.p.om;
  assert.ok(boost >= speed);
  run(app, 0.5); const before = app.p.om; app.knock(); assert.equal(app.p.om, before);
  app.letGo(); assert.ok(app.combo.regrip);
  assert.equal(app.combo.tricks.filter(t => t.name === "REGRIP").length, 1);
});

test("a shove-it requires a straighter landing than the same ordinary flight", () => {
  for (const styled of [false, true]) {
    const { app } = ride();
    air(app, { y: app.park().floor - 230, vx: 0, vy: 0 });
    if (styled) { app.knock(); assert.ok(app.air.style, "the style request is accepted high enough to finish"); }
    // Controlled unit fixture isolates the landing rule from a pilot's choices.
    app.p.rot = .65; app.p.rotV = 0; app.p.tuck = true; app.p.tuckDir = 0;
    reachGround(app);
    assert.equal(app.p.mode, styled ? "bail" : "ground");
  }
});

test("repeated giants do not farm the multiplier, while different tricks improve a line", () => {
  const { app } = ride();
  for (let i = 0; i < 20; i++) app.trick("GIANT", 250);
  assert.equal(app.comboValue(), app.combo.sum);
  app.trick("SWING", 60);
  assert.equal(app.comboValue(), app.combo.sum * 2);
  assert.equal(app.stats.variety, 0, "an unbanked trick is not a career medal");
});

test("practice is untimed and cannot farm goals, lines, medals, bests or console scores", () => {
  const { app, ctx } = ride(); app.mode = 2; app.start();
  const before = structuredClone(app.save);
  app.combo.tricks = ["BACKFLIP", "SWING", "AIR", "MANUAL", "SHOVE-IT"].map(name => ({ name, pts: 900 }));
  Object.assign(app.combo, { sum: 4500, maxFlip: 3, clean: true, manual: true, airs: 3 });
  app.stats.clean = 4; app.bank(); run(app, 130); assert.equal(app.phase, "play");
  app.finish(); assert.deepEqual(app.save, before);
  assert.equal(ctx.calls.score.length, 0); assert.equal(ctx.calls.saved.length, 0);
});

test("ending in flight forfeits an unlanded line instead of banking it for free", () => {
  const { app } = ride(); air(app); app.trick("GIANT", 250);
  app.finish(); assert.equal(app.score, 0); assert.equal(app.bestCombo, 0);
});

test("overtime keeps an active manual alive, then banks only after a safe finish", () => {
  const { app } = ride(); flat(app); app.trick("OLLIE", 40); app.knock(); app.clock = 0.1;
  run(app, 0.8);
  assert.equal(app.phase, "play", "a manual is still an active last trick");
  assert.ok(app.manual); assert.equal(app.score, 0);
  app.down({ source: "keyboard" }); app.up({ source: "keyboard", durationMs: 60 });
  reachGround(app); run(app, 1.3);
  assert.equal(app.phase, "over"); assert.ok(app.score > 0);
  const cutoff = ride().app; flat(cutoff); cutoff.trick("OLLIE", 40); cutoff.knock(); cutoff.clock = -7.99;
  cutoff.update(F); assert.equal(cutoff.phase, "over"); assert.equal(cutoff.score, 0, "the eight-second cutoff still forfeits an unfinished manual");
});

test("flow scores are separate from both earlier bests and LINE RUN only records a met challenge", () => {
  const { app, ctx } = ride(); app.slot().best[0] = 50000; flat(app);
  app.trick("OLLIE", 40); app.bank(); app.finish();
  assert.equal(app.slot().best[0], 50000);
  assert.equal(app.slot().styleBest[0], 0);
  assert.equal(app.slot().flowBest[0], 40);
  assert.deepEqual(ctx.calls.score[0], [40, "flow-v3"]);
  app.mode = 1; app.start(); assert.equal(app.clock, 45);
  flat(app); app.trick("OLLIE", 40); app.bank(); app.finish();
  assert.equal(app.slot().lineBest[0][0], 0);
  assert.equal(ctx.calls.score.length, 1);
});

test("a medal needs banked trick variety and clean riding, not a high repeated-giant score", () => {
  const { app } = ride(); flat(app);
  for (let i = 0; i < 40; i++) app.trick("GIANT", 250);
  app.stats.clean = 10; app.bank(); app.finish(); assert.equal(app.slot().medals[0], 0);
  app.start(); flat(app);
  for (const name of ["SWING", "BACKFLIP", "AIR", "MANUAL", "SHOVE-IT"]) app.trick(name, 200);
  app.stats.clean = 3; app.bank(); app.finish(); assert.equal(app.slot().medals[0], 3);
});

test("four lamps have different readable jobs and no board accent survives pause or exit", () => {
  const { app, board } = ride(); air(app);
  const rgb = app.restingLamps(); assert.equal(rgb.length, 12);
  assert.notDeepEqual(rgb.slice(0, 3), rgb.slice(3, 6));
  assert.notDeepEqual(rgb.slice(6, 9), rgb.slice(9, 12));
  app.board = 1; app.update(F); assert.ok(board.at(-1).some(v => v > 0));
  app.pause(); assert.deepEqual(board.at(-1), [0, 0, 0]);
  app.resume(); app.update(F); assert.deepEqual(board.at(-1), [0, 0, 0]);
  app.draw(fakeCanvas()); app.dispose();
});

test("actual High Bar restores a burst-delivered menu gesture and consumes the terminal release", () => {
  for (const pace of ["quick", "standard", "relaxed"]) {
    const { app, ctx } = ride({ settings: { gesturePace: pace } });
    let cancelling = false, menus = 0, open = false;
    ctx.cancelGesture = () => cancelling;
    const original = { phase: app.phase, x: app.p.x, score: app.score, runs: app.slot().runs };
    let router;
    const host = { epoch: 0, inputMode: () => open ? "menu" : "raw", holdMs: () => 650,
      escapePolicy: () => ({ pace }), pressVisual() {}, clickVisual() {}, holdVisual() {},
      rawDown: e => app.down(e), rawUp: e => app.up(e), rawCancel: () => app.cancel(),
      requestMenu() { cancelling = true; const p = router.press;
        router.cancel(router.blocked || !!p, router.blockSource || p?.event.source);
        app.cancel(); app.pause(); cancelling = false; open = true; menus++; host.epoch++; } };
    router = new InputRouter(host, () => 0);
    for (const [down, at] of [[true, 0], [false, 40], [true, 100], [false, 140], [true, 200], [false, 2200]]) {
      const e = { source: "node", generation: 1, at_us: at * 1000 }; down ? router.down(e) : router.up(e);
    }
    assert.equal(menus, 1);
    assert.deepEqual({ phase: app.phase, x: app.p.x, score: app.score, runs: app.slot().runs }, original);
    assert.equal(app.pressed, false); assert.equal(ctx.calls.saved.length, 0);
  }
});

