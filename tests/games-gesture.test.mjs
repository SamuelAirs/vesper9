// Menu-gesture tolerance, run recording and the smaller game fixes beyond the audit's F-tests
// (tests/games.test.mjs). Each game remembers its state at every press; cancel() right after a
// click gesture restores the state from just before the gesture's first tap.
import test from "node:test";
import assert from "node:assert/strict";
import { OrbitLock, Moonrunner, Undertow, EchoVault, LightTrial, GlyphVault } from "../web/apps/games.js";
import { MorseSchool } from "../web/apps/morse.js";
import { makeCtx, makeRig, step, DT } from "./audit/harness.mjs";
import { gestureWithUpdates } from "./audit/bots.mjs";

const sameRun = (g, before, keys) => keys.every((k) => JSON.stringify(g[k]) === JSON.stringify(before[k]));
const snap = (g, keys) => Object.fromEntries(keys.map((k) => [k, structuredClone(g[k])]));

function killOrbit(c) { const g = new OrbitLock(c); g.down(); g.lives = 1; g.angle = 0; g.target = 3; g.down(); return g; }
function killRunner(c) { const g = new Moonrunner(c); g.down(); g.up(); g.shield = 0; g.obstacles = [{ x: 198, w: 40, h: 70, passed: false }]; g.update(DT); return g; }
function killUndertow(c) { const g = new Undertow(c); g.down(); g.up(); g.hull = 1; g.y = 10; g.update(DT); return g; }
function killGlyph(c) { const g = new GlyphVault(c); g.down(); step(g, 4); g.lives = 1; g.sequence = [0, 0, 0]; g.focus = 3; g.down(); return g; }
const killers = [["Orbit Lock", killOrbit], ["Moonrunner", killRunner], ["Undertow", killUndertow], ["Glyph Archive", killGlyph]];

const gestureCases = {
  "Orbit Lock": {
    keys: ["phase", "points", "lives", "target", "angle"],
    make: (c) => { const g = new OrbitLock(c); g.down(); g.points = 12; g.target = 0; g.angle = 3; return g; },
  },
  "Glyph Archive": {
    keys: ["phase", "round", "points", "lives", "entered", "sequence", "focus"],
    make: (c) => { const g = new GlyphVault(c); g.down(); step(g, 4); g.sequence = [4, 4, 4]; g.round = 6; g.points = 900; return g; },
  },
  Moonrunner: {
    keys: ["phase", "points", "distance", "y", "obstacles"],
    make: (c) => { const g = new Moonrunner(c); g.down(); g.up(); step(g, 1.0); g.obstacles = [{ x: 262, w: 40, h: 70, passed: false }]; return g; },
  },
  Undertow: {
    keys: ["phase", "points", "y", "vy", "gates"],
    make: (c) => { const g = new Undertow(c); g.down(); g.up(); g.y = 40; g.vy = -200; g.points = 5; return g; },
  },
};
for (const [name, { keys, make }] of Object.entries(gestureCases)) {
  for (const [clicks, pace, tapMs, gapMs] of [[4, "standard", 67, 50], [4, "quick", 60, 40], [4, "relaxed", 140, 200], [3, "standard", 67, 50]]) {
    test(`gesture ${name}: ${clicks} clicks at ${pace} pace leave the run as it was before the first tap`, () => {
      const settings = { menuClicks: clicks, gesturePace: pace };
      const c = makeCtx(21, { settings }), g = make(c), rig = makeRig(g, c, { clicks, pace });
      const before = snap(g, keys), saves = c.log.saves.length;
      for (let i = 0; i < clicks; i++) {
        rig.router.down({ source: "node", generation: 1, at_us: rig.now() * 1000 });
        for (let f = 0; f < Math.round(tapMs / 16.7); f++) g.update(DT);
        rig.wait(tapMs);
        rig.router.up({ source: "node", generation: 1, at_us: rig.now() * 1000 });
        if (i < clicks - 1) for (let f = 0; f < Math.round(gapMs / 16.7); f++) g.update(DT);
        rig.wait(gapMs);
      }
      assert.equal(rig.menuOpen, 1, "the gesture opened the menu");
      assert.ok(sameRun(g, before, keys), "run differs from the state before the gesture");
      assert.equal(c.log.saves.length, saves, "a finished run was recorded");
      rig.resume();
      assert.equal(g.phase, before.phase);
    });
  }
}

test("gesture: a death caused during the gesture is undone and never recorded", () => {
  const c = makeCtx(22), g = new Moonrunner(c), rig = makeRig(g, c);
  g.down(); g.up(); step(g, 0.5);
  g.obstacles = [{ x: 400, w: 60, h: 200, passed: false }];
  gestureWithUpdates(g, rig);
  assert.equal(rig.menuOpen, 1);
  assert.equal(g.phase, "play", "the gesture's own taps ended the run");
  assert.equal(c.log.saves.length, 0);
  assert.ok(g.obstacles.length >= 1);
});

test("gesture: taps that are too slow to be a gesture are never rewound by a later cancel()", () => {
  const c = makeCtx(23), g = new OrbitLock(c), rig = makeRig(g, c);
  g.down(); g.points = 4; g.target = 0; g.angle = 3;
  for (let i = 0; i < 3; i++) {
    rig.router.down({ source: "node", generation: 1, at_us: rig.now() * 1000 }); step(g, 0.1); rig.wait(100);
    rig.router.up({ source: "node", generation: 1, at_us: rig.now() * 1000 }); step(g, 0.6); rig.wait(600);
  }
  const lives = g.lives, phase = g.phase;
  assert.ok(lives < 3, "setup: the slow taps were misses");
  g.cancel();
  assert.equal(g.lives, lives);
  assert.equal(g.phase, phase);
});

test("gesture: ordinary misses spread over several seconds are never undone by cancel()", () => {
  const c = makeCtx(24), g = new OrbitLock(c);
  g.down(); g.target = 0; g.angle = 3;
  for (let i = 0; i < 2; i++) { g.down(); g.up(); step(g, 1.5); g.target = 0; g.angle = 3; }
  assert.equal(g.lives, 1);
  g.cancel();
  assert.equal(g.lives, 1, "an ordinary mistake was undone by a later cancel");
});

test("gesture: a deliberate quick four-tap burst only ever rewinds to its own first tap", () => {
  const c = makeCtx(40), g = new OrbitLock(c), rig = makeRig(g, c);
  g.down(); g.target = 0; g.angle = 3;
  g.down(); g.up();                        // an earlier miss, 2 s before the burst
  step(g, 2);
  assert.equal(g.lives, 2);
  g.target = 0; g.angle = 3;
  gestureWithUpdates(g, rig);
  assert.equal(g.lives, 2, "the earlier miss was undone or the burst's misses were kept");
});

test("gesture: edges are immediate, a tap changes the game on the very next step", () => {
  const c = makeCtx(25), g = new OrbitLock(c);
  g.down(); g.target = g.angle;
  g.down();
  assert.equal(g.points, 1, "the lock was not credited at once");
  const m = new Moonrunner(makeCtx(25)); m.down(); m.up();
  m.update(DT);
  assert.ok(m.vy < 0, "the jump did not start on the next frame");
  const u = new Undertow(makeCtx(25)); u.down(); u.update(DT);
  assert.ok(u.vy < 0);
});

test("gesture: on the result screen the result is kept, and recorded once when the menu opens", () => {
  const c = makeCtx(26), g = killOrbit(c), rig = makeRig(g, c);
  assert.equal(g.phase, "over");
  gestureWithUpdates(g, rig);
  assert.equal(rig.menuOpen, 1);
  assert.equal(g.phase, "over", "the result screen was replaced by a new run");
  assert.equal(c.log.saves.length, 1);
  assert.equal(c.log.scores.length, 1);
});

test("a finished run is recorded once, after the gesture window, and never twice", () => {
  for (const [name, kill] of killers) {
    const c = makeCtx(27), g = kill(c);
    step(g, 0.5);
    assert.equal(c.log.saves.length, 0, name + " recorded inside the gesture window");
    step(g, 2);
    assert.equal(c.log.saves.length, 1, name + " did not record the finished run");
    assert.equal(c.log.scores.length, 1);
    g.pause(); g.dispose(); step(g, 5);
    assert.equal(c.log.saves.length, 1, name + " recorded the run twice");
  }
});

test("leaving or restarting right after a run ends still records that run once", () => {
  for (const [name, kill] of killers) {
    const c = makeCtx(28), g = kill(c);
    step(g, 0.2);
    g.pause();
    assert.equal(c.log.saves.length, 1, name + " lost the finished run on pause");
    g.dispose();
    assert.equal(c.log.saves.length, 1);
  }
  const c = makeCtx(29), g = killOrbit(c);
  step(g, 0.7);
  g.down();
  assert.equal(g.phase, "play");
  step(g, 2.1);
  assert.equal(c.log.saves.length, 1, "restarting lost the previous run");
  g.pause(); g.dispose();
  assert.equal(c.log.saves.length, 1, "the previous run was recorded twice");
});

test("Echo Vault: leaving mid-run keeps the sequences completed, an unscored run submits nothing", () => {
  const c = makeCtx(30), g = new EchoVault(c);
  g.down(); step(g, 2.5);
  g.down(); g.up({ durationMs: 100 }); g.down(); g.up({ durationMs: 500 });
  step(g, 1.1);
  g.pause();
  assert.deepEqual(c.log.scores.map((x) => x.n), [1]);
  const d = new EchoVault(makeCtx(31)); d.down(); d.pause();
  assert.equal(d.c.log.scores.length, 0, "a zero score was submitted");
});

test("Echo Vault: the result screen has a lockout but accepts a press afterwards", () => {
  const c = makeCtx(32), g = new EchoVault(c);
  g.down(); step(g, 2.5); g.down(); g.up({ durationMs: 500 });
  assert.equal(g.phase, "over");
  step(g, 0.7);
  g.down();
  assert.equal(g.phase, "show");
});

test("F5b Undertow: a clean passage is credited once the craft has cleared the column", () => {
  const c = makeCtx(33), g = new Undertow(c);
  g.down(); g.up(); g.next = 99;
  g.gates = [{ x: 215, center: 270, gap: 170, passed: false }];
  let credited = null;
  for (let i = 0; i < 120 && g.phase === "play"; i++) {
    g.y = 270; g.vy = 0; g.update(DT);
    if (g.points && credited === null) credited = g.gates[0].x;
  }
  assert.equal(g.points, 1);
  assert.ok(credited + 65 < 202 && credited + 65 > 202 - 4, "credited at x=" + credited);
});

test("F6b Orbit Lock: a press just after the gate has gone by says LATE, one before it says EARLY", () => {
  const c = makeCtx(34), g = new OrbitLock(c);
  g.down();
  g.target = 1; g.angle = 1.6;
  g.down();
  assert.match(g.feedback, /LATE/);
  g.target = 3; g.angle = 0.2;
  g.down();
  assert.match(g.feedback, /EARLY/);
});

test("F8c Light Trial: a new trial started during the lamp glow is not darkened by the old timer", () => {
  const c = makeCtx(35), g = new LightTrial(c);
  g.down({});
  g.event({ type: "cue", trial: g.trial, at_us: 1e6, generation: 0 });
  g.down({ source: "simulator", at_us: 1.3e6, generation: 0 });
  step(g, 0.3);
  g.down({});
  c.ledsNow = [1, 2, 3, 4, 5, 6, 7, 8, 9]; // stand-in for the node-driven lamps
  step(g, 3);
  assert.deepEqual(c.ledsNow, [1, 2, 3, 4, 5, 6, 7, 8, 9], "the old timer wrote over the new trial");
});

test("F9b Signal School: guided and listen answers still advance the guided lesson", () => {
  const c = makeCtx(36, { progress: { schema: 2, index: 0, correct: 0, attempts: 0, characters: {} } }), g = new MorseSchool(c);
  g.answer(g.target);
  assert.equal(g.learning.index, 0, "one correct answer must not advance the lesson");
  g.answer(g.target);
  assert.equal(g.learning.index, 1);
  g.start("listen"); step(g, 4);
  g.answer(g.target); g.answer(g.target);
  assert.equal(g.learning.index, 2);
});
