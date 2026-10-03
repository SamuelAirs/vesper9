import test from "node:test";
import assert from "node:assert/strict";
import { Ricochet, TURN_BOOST, TURN_TIME, migrateRicochet } from "../web/apps/ricochet.js";
import { Moonrunner } from "../web/apps/runner.js";
import { appContext, fakeCanvas, run } from "./helpers/app-context.mjs";
import { runnerBot } from "./helpers/runner-bot.mjs";
import { makeRig } from "./audit/harness.mjs";
import { withLogbook } from "./helpers/logbook-stub.mjs";

const DT = 1 / 60, G = Ricochet.GEOM;
const reached = (far = 9) => ({ schema: 3, runs: 4, milestone: far, st: { far, cells: 150, chambers: 8 } });
function practice(chamber, seed = 11) {
  const c = withLogbook(appContext({ seed, progress: reached() }));
  const g = new Ricochet(c);
  g.begin(chamber, true);
  return { c, g };
}

// Read the visible landing bracket and plan one button reversal. Simulate the
// actual paddle's speed, turn boost and wall reflections; never relocate a ball,
// change a cell, add lives or bypass the game's real collision/update path.
function pilot(g) {
  let pending = -1, last = -99;
  const predict = (frames, flip, target) => {
    const lo = G.L + g.padW / 2, hi = G.R - g.padW / 2;
    let x = g.px, dir = g.dir, turn = g.turnT, error = 0;
    for (let f = 0; f < frames + 3; f++) {
      if (f === flip) { dir = -dir; turn = TURN_TIME; }
      x += dir * g.padSpeedNow() * DT * (1 + TURN_BOOST * turn / TURN_TIME);
      turn = Math.max(0, turn - DT);
      if (x <= lo) { x = lo; dir = 1; } else if (x >= hi) { x = hi; dir = -1; }
      if (f >= frames - 3) error = Math.max(error, Math.abs(x - target));
    }
    return error;
  };
  return frame => {
    if (pending >= 0 && frame >= pending) { g.down(); g.up(); last = frame; pending = -1; }
    if (g.phase !== "play" || g.sub !== "live" || pending >= 0 || frame - last < 10 || frame % 3) return;
    const ball = g.balls.filter(b => b.pred !== null).sort((a, b) => g.eta(a) - g.eta(b))[0];
    if (!ball) return;
    const frames = Math.round(g.eta(ball) * 60);
    if (frames < 5 || frames > 150) return;
    const target = Math.max(G.L + g.padW / 2, Math.min(G.R - g.padW / 2, ball.pred));
    const keep = predict(frames, Infinity, target);
    if (keep < 16) return;
    let best = { error: keep - 6, at: -1 };
    for (let at = 2; at < frames; at += 2) {
      const error = predict(frames, at, target);
      if (error < best.error) best = { error, at };
    }
    if (best.at >= 0 && best.at <= 5) pending = frame + 2;
  };
}

test("reached chambers survive an abandoned run and old records retain their practice access", () => {
  const c = appContext(), g = new Ricochet(c);
  g.begin(); g.setupChamber(4);
  assert.equal(c.calls.saved.at(-1).st.far, 4);
  const saved = structuredClone(c.calls.saved.at(-1));
  g.dispose();
  const again = new Ricochet(appContext({ progress: saved }));
  assert.equal(again.practiceLimit(), 4);
  assert.equal(again.sv.runs, 0, "unlocking practice does not invent a finished run");
  assert.equal(migrateRicochet({ schema: 1, milestone: 7 }).st.far, 7);
  const legacy = reached(12), restored = migrateRicochet(legacy);
  assert.equal(restored.st.cells, 150); assert.equal(restored.st.chambers, 8); assert.equal(restored.runs, 4);
});

test("practice selection works with button only, case reverse, custom hold timing and a return row", () => {
  const c = appContext({ settings: { holdMs: 900 }, progress: reached(4) }), g = new Ricochet(c);
  g.openPractice(); assert.equal(g.practiceCursor, 4);
  g.knock(); assert.equal(g.practiceCursor, 3);
  g.down(); run(g, 0.8); g.up();
  assert.equal(g.phase, "practice"); assert.equal(g.practiceCursor, 4);
  g.down(); run(g, 0.95); g.up();
  assert.equal(g.phase, "play"); assert.equal(g.training, true); assert.equal(g.chamber, 4);
  g.openPractice(); g.down(); run(g, 0.1); g.up();
  assert.equal(g.practiceCursor, 0);
  g.down(); run(g, 0.95); g.up();
  assert.equal(g.phase, "title"); assert.equal(g.training, false);
  assert.equal(c.calls.saved.length, 0);
});

test("practice clear, loss, pause and disposal award no career records, feats or daily orders", () => {
  for (const outcome of ["clear", "loss", "leave"]) {
    const { c, g } = practice(9), original = JSON.stringify(g.sv);
    g.R.cells = 100; g.cellsBroken = 100; g.bestChain = 8;
    if (outcome === "clear") { g.clearChamber(); assert.equal(g.trainingCleared, true); assert.equal(g.phase, "over"); }
    if (outcome === "loss") { g.lives = 0; g.end(); assert.equal(g.trainingCleared, false); }
    g.cancel(); g.pause(); g.dispose();
    assert.equal(JSON.stringify(g.sv), original);
    assert.equal(c.calls.saved.length, 0); assert.equal(c.calls.score.length, 0);
    assert.equal(c.book.feats.length, 0); assert.equal(c.book.met, 0);
    assert.ok(c.calls.leds.at(-1).every(v => v === 0));
    g.draw(fakeCanvas());
  }
});

test("practice retry stays in the selected room while ordinary retry starts chamber one", () => {
  const { g } = practice(9);
  g.end(); run(g, 1); g.down(); g.up();
  assert.equal(g.chamber, 9); assert.equal(g.training, true); assert.equal(g.score, 0);
  assert.ok(Object.values(g.mods).every(v => v === 0));
  g.phase = "title"; g.down();
  assert.equal(g.chamber, 1); assert.equal(g.training, false);
});

test("opening practice from an ordinary run banks earned progress and closes the real menu action", () => {
  const c = appContext(), g = new Ricochet(c);
  g.begin(); g.setupChamber(4); g.score = 250; g.R.cells = 12;
  let resumed = 0; c.resume = () => { resumed++; };
  const action = g.menuActions()[0]; assert.match(action.label, /END RUN/);
  action.run();
  assert.equal(resumed, 1); assert.equal(g.phase, "practice");
  assert.equal(c.calls.score.at(-1)[0], 250);
  assert.equal(c.calls.saved.at(-1).runs, 1); assert.equal(g.sv.st.cells, 12);
});

for (const pace of ["quick", "standard", "relaxed"]) for (const screen of ["selector", "live"]) {
  test(`practice ${screen}: ${pace} tap tap hold restores state and awards nothing`, () => {
    const { c, g } = practice(4); c.settings().gesturePace = pace;
    if (screen === "selector") g.openPractice(); else run(g, 2);
    const rig = makeRig(g, c, { pace });
    const before = { phase: g.phase, cursor: g.practiceCursor, chamber: g.chamber, cells: JSON.stringify(g.cells), score: g.score, lives: g.lives };
    assert.ok(rig.gesture()); rig.resume();
    const after = { phase: g.phase, cursor: g.practiceCursor, chamber: g.chamber, cells: JSON.stringify(g.cells), score: g.score, lives: g.lives };
    assert.deepEqual(after, before); assert.equal(g.pressing, false);
    assert.equal(c.calls.saved.length, 0); assert.equal(c.calls.score.length, 0);
  });
}

test("a chamber reached by the canceled menu gesture cannot persist a practice unlock", () => {
  const c = appContext(), g = new Ricochet(c), rig = makeRig(g, c);
  g.begin();
  rig.router.down({ source: "node", generation: 1, at_us: 0 });
  g.setupChamber(4);
  assert.equal(c.calls.saved.length, 0, "new unlock waits while a gesture is possible");
  run(g, 0.067); rig.wait(67); rig.router.up({ source: "node", generation: 1, at_us: 67000 });
  run(g, 0.05); rig.wait(50);
  rig.router.down({ source: "node", generation: 1, at_us: 117000 });
  run(g, 0.067); rig.wait(67); rig.router.up({ source: "node", generation: 1, at_us: 184000 });
  run(g, 0.05); rig.wait(50);
  rig.router.down({ source: "node", generation: 1, at_us: 234000 });
  for (let frame = 0; frame < 200 && !rig.menu; frame++) { g.update(DT); rig.wait(1000 / 60); }
  assert.equal(rig.menu, true); assert.equal(g.chamber, 1); assert.equal(g.sv.st.far, 0);
  assert.equal(c.calls.saved.length, 0);
});

for (const chamber of [1, 4, 9]) {
  test(`actual practice physics: a button pilot clears chamber ${chamber} with baseline equipment`, () => {
    const { c, g } = practice(chamber), bot = pilot(g);
    const initialCells = g.remaining;
    for (let f = 0; f < 60 * 360 && g.phase === "play"; f++) { bot(f); g.update(DT); }
    assert.equal(g.phase, "over");
    assert.equal(g.trainingCleared, true, `room ${chamber}: broke ${g.cellsBroken}/${initialCells}, lives ${g.lives}`);
    assert.ok(Object.values(g.mods).every(v => v === 0));
    assert.equal(g.chamber, chamber); assert.equal(c.calls.saved.length, 0); assert.equal(c.calls.score.length, 0);
    console.log(JSON.stringify({ game: "ricochet", chamber, clear: g.trainingCleared, cells: g.cellsBroken, elapsed: +g.clock.toFixed(2), lives: g.lives, score: g.score }));
  });
}

test("Moonrunner actual simulation: early, middle and late unlocked starts retain playable physics", () => {
  const reports = [];
  for (const zone of [0, 3, 5]) {
    const c = appContext({ seed: 17, progress: { schema: 3, lv: 9, far: 5, sel: { start: zone } } }), g = new Moonrunner(c);
    g.start(); const bot = runnerBot(g);
    for (let f = 0; f < 60 * 60 && g.phase === "play"; f++) { bot(); g.update(DT); }
    assert.ok(g.R.m >= 500, `zone ${zone}: ${g.R.m}m`);
    assert.ok(g.R.perfects >= 2, `zone ${zone}: ${g.R.perfects} slides`);
    assert.ok([g.r.x, g.r.y, g.r.v, g.scoreNow()].every(Number.isFinite));
    reports.push({ zone: zone + 1, metres: Math.floor(g.R.m), perfects: g.R.perfects, score: g.scoreNow(), elapsed: +g.runT.toFixed(2), ended: g.phase === "over" });
  }
  console.log(JSON.stringify({ game: "moonrunner", reports }));
});
