// Regression tests for the original games (web/apps/orbit.js and its siblings) and web/apps/morse.js. F1-F10 are the defects proven
// by the games audit (fleet/reports/audit-games.md); the audit's harness lives in tests/audit/.
import test from "node:test";
import assert from "node:assert/strict";
import { OrbitLock } from "../web/apps/orbit.js";
import { Moonrunner } from "../web/apps/runner.js";
import { Undertow } from "../web/apps/undertow.js";
import { EchoVault } from "../web/apps/echo.js";
import { LightTrial } from "../web/apps/reaction.js";
import { GlyphVault } from "../web/apps/glyphs.js";
import { MorseSchool } from "../web/apps/morse.js";
import { makeCtx, makeRig, step, DT } from "./audit/harness.mjs";

const dark = (v) => v.every((x) => x === 0);

// ---------------------------------------------------------------------------
// F1: the menu gesture used to destroy a run in Orbit Lock and Glyph Archive (it was four clicks then;
// it is tap, tap, hold now). All three presses reach the game; with a miss costing a life, the taps cost
// lives and the third press would end the run (score recorded) or start a fresh one.
test("F1a Orbit Lock: opening the menu with tap, tap, hold must not end the run", () => {
  const c = makeCtx(5), g = new OrbitLock(c), rig = makeRig(g, c);
  g.down();                               // leave the title screen
  g.points = 12;                          // a run with some progress
  g.target = 0; g.angle = 3;              // satellite on the far side of the dial
  rig.gesture();
  assert.equal(rig.menuOpen, 1, "the gesture opened the menu");
  // Opening the menu submits the score reached so far (F4), which is 12; nothing else is recorded.
  assert.deepEqual(c.log.scores.map((x) => x.n), [12], "run was ended and its score recorded by the gesture");
  assert.equal(c.log.saves.length, 0, "a run was recorded as finished");
  assert.equal(g.phase, "play");
  assert.equal(g.points, 12, "the run in progress was replaced by a fresh one");
  assert.equal(g.lives, 3, "the gesture's taps cost lives");
});

test("F1b Glyph Archive: opening the menu with tap, tap, hold must not end the run", () => {
  const c = makeCtx(5, { settings: { scanMs: 1e9 } }), g = new GlyphVault(c), rig = makeRig(g, c);
  g.down();
  step(g, 4);                             // inscription hidden, cursor frozen on glyph 0
  g.sequence = [4, 4, 4]; g.focus = 0;
  g.round = 6; g.points = 900;
  rig.gesture();
  assert.equal(rig.menuOpen, 1);
  assert.deepEqual(c.log.scores.map((x) => x.n), [900], "run was ended and its score recorded by the gesture");
  assert.equal(c.log.saves.length, 0, "a run was recorded as finished");
  assert.equal(g.round, 6, "the run in progress was replaced by a fresh one");
  assert.equal(g.lives, 3, "the gesture's taps cost attempts");
});

// ---------------------------------------------------------------------------
// F2: Moonrunner sets all three lamps red on death and never clears them.
test("F2 Moonrunner: lamps must not stay red through the next run", () => {
  const c = makeCtx(1), g = killRunner(c);
  assert.equal(g.phase, "over");
  assert.ok(c.ledsNow.some((x) => x > 0), "death flashes the lamps (setup check)");
  step(g, 0.7);                           // result screen, past the press lockout
  assert.deepEqual(c.ledsNow, Array(9).fill(0), "lamps still red on the result screen: " + c.ledsNow.join(","));
  g.down(); g.up();                       // restart
  step(g, 2);                             // well before the first obstacle arrives
  assert.equal(g.phase, "play");
  // A run in progress shows the dim speed colour (green at the start), never the death red.
  const red = [0, 3, 6].some((i) => c.ledsNow[i] > c.ledsNow[i + 1]);
  assert.ok(!red, "lamps are still red " + c.ledsNow.join(","));
});

// ---------------------------------------------------------------------------
// F3: a press 100 ms after the run ends restarts it, so a player who is tapping
// or holding rhythmically never sees the result screen.
function killOrbit(c) {
  const g = new OrbitLock(c); g.down(); g.lives = 1; g.angle = 0; g.target = 3; g.down(); return g;
}
function killRunner(c) {
  // Moonrunner is now a downhill run: past its forgiving first stretch, a boulder under the sled ends it.
  const g = new Moonrunner(c); g.down(); g.up(); step(g, 0.2);
  g.forgiveTo = 0; g.rocks.push({ x: g.r.x + 4, r: 20, done: false, hit: false }); g.update(DT); return g;
}
function killUndertow(c) {
  const g = new Undertow(c); g.down(); g.up(); g.hull = 1; g.y = 10; g.update(DT); return g;
}
function killGlyph(c) {
  const g = new GlyphVault(c); g.down(); step(g, 4); g.lives = 1; g.sequence = [0, 0, 0]; g.focus = 3; g.down(); return g;
}
function killEcho(c) {
  const g = new EchoVault(c); g.down(); step(g, 2.5); g.down(); g.up({ durationMs: 500 }); return g;
}
for (const [name, kill] of [["Orbit Lock", killOrbit], ["Moonrunner", killRunner], ["Undertow", killUndertow],
  ["Glyph Archive", killGlyph], ["Echo Vault", killEcho]]) {
  test(`F3 ${name}: the result screen survives a press 100 ms after the run ends`, () => {
    const c = makeCtx(2), g = kill(c);
    assert.equal(g.phase, "over", "run ended (setup check)");
    step(g, 0.1);
    g.down(); g.up?.({ durationMs: 40 });
    assert.equal(g.phase, "over", "the result screen was dismissed by a reflex press and a new run began");
  });
}

// ---------------------------------------------------------------------------
// F4: leaving a run (menu -> dashboard/restart) discards the score; the best
// score is only submitted when the run ends by dying.
for (const [name, build] of [
  ["Orbit Lock", (c) => { const g = new OrbitLock(c); g.down(); g.points = 30; return g; }],
  ["Moonrunner", (c) => { const g = new Moonrunner(c); g.down(); g.up(); step(g, 0.5); g.R.m = 1500; return g; }],
  ["Undertow", (c) => { const g = new Undertow(c); g.down(); g.up(); g.points = 30; return g; }],
  ["Glyph Archive", (c) => { const g = new GlyphVault(c); g.down(); g.round = 9; g.points = 1500; return g; }],
]) {
  test(`F4 ${name}: score earned so far is submitted when the player leaves mid-run`, () => {
    const c = makeCtx(3), g = build(c);
    g.cancel?.(); g.pause?.(); g.dispose?.();  // what Vesper.unmount() calls
    assert.ok(c.log.scores.length >= 1, "no score was submitted although the run had progress");
  });
}

// ---------------------------------------------------------------------------
// F5: Undertow awards the passage point when the gate's leading edge passes the
// craft, while the collision box still covers the craft for another ~0.4 s.
test("F5 Undertow: a gate that killed you is not counted as a passage", () => {
  const c = makeCtx(4), g = new Undertow(c);
  g.down(); g.up();
  g.next = 99; g.hull = 1;
  g.gates = [{ x: 215, center: 270, gap: 170, passed: false }];
  for (let i = 0; i < 4; i++) { g.y = 270; g.vy = 0; g.update(DT); }
  assert.equal(g.phase, "play");
  g.y = 100; g.vy = 0;                    // leave the opening while still inside the column
  g.update(DT);
  assert.equal(g.phase, "over");
  assert.equal(g.points, 0, "died inside the gate but scored " + g.points);
});

// ---------------------------------------------------------------------------
// F6: Orbit Lock early/late feedback uses wrapAngle on a target that can be up
// to 4.5 rad ahead; beyond pi it reports LATE for a press that is early.
test("F6 Orbit Lock: pressing 4 rad before the gate says EARLY", () => {
  const c = makeCtx(6), g = new OrbitLock(c);
  g.down();
  g.angle = 0; g.target = 4.0;
  g.down();
  assert.match(g.feedback, /EARLY/, "feedback was: " + g.feedback);
});

// ---------------------------------------------------------------------------
// F7: Echo Vault REPLAY can re-score a finished sequence and can revive a run
// that has already ended and been recorded.
test("F7a Echo Vault: REPLAY is not offered during the between-rounds pause", () => {
  const c = makeCtx(7), g = new EchoVault(c);
  g.down(); step(g, 2.5);
  g.down(); g.up({ durationMs: 100 }); g.down(); g.up({ durationMs: 500 });
  assert.equal(g.round, 1);
  assert.equal(g.phase, "between");
  assert.deepEqual(g.menuActions(), [], "REPLAY would let the same signal be credited again");
  // The same signal entered again after the pause is a new, longer one, not a second credit.
  step(g, 4);
  assert.equal(g.sequence.length, 3);
});

test("F7b Echo Vault: REPLAY is not offered after ECHO DIVERGED, so an ended run cannot be revived", () => {
  const c = makeCtx(8), g = new EchoVault(c);
  g.down(); step(g, 2.5);
  g.down(); g.up({ durationMs: 500 });   // wrong first pulse
  assert.equal(g.phase, "over");
  assert.deepEqual(g.menuActions(), []);
  step(g, 4);
  assert.equal(g.phase, "over");
  assert.equal(g.round, 0);
});

test("F7c Echo Vault: REPLAY still works while receiving and entering a signal", () => {
  const c = makeCtx(8), g = new EchoVault(c);
  g.down(); step(g, 1);
  assert.equal(g.phase, "show");
  assert.equal(g.menuActions().length, 1);
  step(g, 2);
  assert.equal(g.phase, "listen");
  g.down(); g.up({ durationMs: 100 });
  g.menuActions()[0].run();
  assert.equal(g.phase, "show");
  assert.equal(g.entered.length, 0);
  step(g, 3);
  g.down(); g.up({ durationMs: 100 }); g.down(); g.up({ durationMs: 500 });
  assert.equal(g.round, 1);
});

// ---------------------------------------------------------------------------
// F8: lamps left lit in Light Trial after a result or an early press.
test("F8a Light Trial: lamps go dark again after a result", () => {
  const c = makeCtx(9), g = new LightTrial(c);
  g.down({});
  g.event({ type: "cue", trial: g.trial, at_us: 1e6, generation: 0 });
  g.down({ source: "simulator", at_us: 1.3e6, generation: 0 });
  assert.equal(g.phase, "result");
  assert.ok(!dark(c.ledsNow), "result lamps lit (setup check)");
  step(g, 10);
  assert.ok(dark(c.ledsNow), "lamps still lit 10 s after the result: " + c.ledsNow.join(","));
});

test("F8b Light Trial: lamps go dark again after an early press", () => {
  const c = makeCtx(9), g = new LightTrial(c);
  g.down({}); g.down({});
  assert.equal(g.phase, "early");
  assert.ok(!dark(c.ledsNow), "early lamps lit (setup check)");
  step(g, 10);
  assert.ok(dark(c.ledsNow), "lamps still lit 10 s after the early press: " + c.ledsNow.join(","));
});

// ---------------------------------------------------------------------------
// F9: Signal School review/listen answers advance the guided lesson index.
test("F9 Signal School: correct answers in review mode do not skip guided lessons", () => {
  const progress = { schema: 2, index: 2, correct: 2, attempts: 2,
    characters: { E: { seen: 1, correct: 1, streak: 1, due: 3 }, T: { seen: 1, correct: 1, streak: 1, due: 3 } } };
  const c = makeCtx(10, { progress }), g = new MorseSchool(c);
  g.start("review");
  for (let i = 0; i < 3; i++) { g.answer(g.target); step(g, 1.3); }
  assert.equal(g.learning.index, 2, `guided position moved from 2 to ${g.learning.index}; letters A, N, I would never be taught`);
  assert.equal(c.log.saves.at(-1).index, 2);
});

// ---------------------------------------------------------------------------
// F10: Signal School listen mode: resume() is meant to replay the interrupted
// signal, but its `!this.nextDelay` guard is false for the small negative value
// nextDelay keeps after the first answer.
test("F10 Signal School listen: resuming from the menu restarts an interrupted signal", () => {
  const c = makeCtx(11), g = new MorseSchool(c);
  g.start("listen");
  step(g, 4);
  assert.equal(g.phase, "choose");
  g.focus = g.choices.indexOf(g.target); g.down(); g.up({ durationMs: 80 });   // first answer
  step(g, 1.5);                                                                // next letter begins
  assert.equal(g.phase, "signal");
  step(g, 0.9);                                                                // mid-signal
  const midPulse = g.pulse;
  assert.ok(midPulse > 0, "signal is part-way through (setup check)");
  g.pause();                                                                   // menu opens
  g.resume();                                                                  // menu closes
  assert.equal(g.pulse, -1, `signal resumed mid-way at pulse ${g.pulse} with its sidetone cut instead of restarting (nextDelay=${g.nextDelay})`);
});
