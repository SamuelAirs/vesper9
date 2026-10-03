// Tuning pass: the new mechanics are reachable, the lamps carry information in every game and are
// dark when they should be, and the menu-gesture rewind restores everything the new mechanics add.
import test from "node:test";
import assert from "node:assert/strict";
import { OrbitLock, orbitWindow, orbitSpeed } from "../web/apps/orbit.js";
import { Moonrunner } from "../web/apps/runner.js";
import { Undertow, nextGate } from "../web/apps/undertow.js";
import { EchoVault, echoHeard } from "../web/apps/echo.js";
import { LightTrial, reactionGrade } from "../web/apps/reaction.js";
import { GlyphVault } from "../web/apps/glyphs.js";
import { LampBus } from "../web/apps/game-kit.js";
import { MorseSchool } from "../web/apps/morse.js";
import { Random } from "../web/engine/math.js";
import { makeCtx, makeRig, step, DT } from "./audit/harness.mjs";
import { gestureWithUpdates } from "./audit/bots.mjs";

// A context that remembers every lamp write.
function lit(seed = 1, opts = {}) {
  const c = makeCtx(seed, opts), writes = [], real = c.leds;
  c.writes = writes;
  c.leds = (v) => { writes.push(v.slice()); real(v); };
  return c;
}
const dark = (v) => v.every((x) => x === 0);
const sum = (v, lamp) => v[lamp * 3] + v[lamp * 3 + 1] + v[lamp * 3 + 2];
const wholeNumbers = (writes) => writes.every((v) => v.length === 9 && v.every((x) => Number.isInteger(x) && x >= 0 && x <= 255));
const distinct = (writes) => new Set(writes.map((v) => v.join())).size;
// Moonrunner (the hill-flyer): night has fallen and the sled has all but stopped, so the run ends.
function killRunner(c) {
  const g = new Moonrunner(c); g.down(); g.up(); step(g, 0.2);
  g.T = 0; g.night = true; Object.assign(g.r, { air: false, v: 20, y: g.gy(g.r.x) }); g.update(DT);
  return g;
}

test("LampBus: whole numbers in steps of 8, no repeat writes, flash overlays, clear/sleep/wake", () => {
  const c = lit(), bus = new LampBus(c);
  bus.frame(DT, [10, 20, 30, 0, 0, 0, 255, 250, 3]);
  assert.deepEqual(c.writes.at(-1), [8, 24, 32, 0, 0, 0, 255, 248, 0]);
  const n = c.writes.length;
  bus.frame(DT, [10, 20, 30, 0, 0, 0, 255, 250, 3]);
  assert.equal(c.writes.length, n, "an unchanged picture was written again");
  bus.flash(0.1, () => Array(9).fill(200));
  assert.equal(c.ledsNow[0], 200, "a flash shows at once");
  for (let i = 0; i < 8; i++) bus.frame(DT, [8, 8, 8, 0, 0, 0, 0, 0, 0]);
  assert.equal(c.ledsNow[0], 8, "the flash ended and the resting picture returned");
  bus.clear(); assert.ok(dark(c.ledsNow));
  bus.frame(DT, Array(9).fill(80)); assert.equal(c.ledsNow[0], 80);
  bus.sleep(); assert.ok(dark(c.ledsNow));
  bus.frame(DT, Array(9).fill(80)); assert.ok(dark(c.ledsNow), "a sleeping bus wrote light");
  bus.wake(); bus.frame(DT, Array(9).fill(80)); assert.equal(c.ledsNow[0], 80);
});

// ----------------------------------------------------------------------------------- lamps per game
// A scripted stretch of play for each game: [name, build, play(g, c)].
const plays = {
  "Orbit Lock": (c) => {
    const g = new OrbitLock(c); g.down();
    for (let i = 0; i < 60 * 12; i++) {
      const d = g.ahead(), rate = orbitSpeed(g.points) - g.drift * g.dir;
      if (d / rate <= DT) g.down();
      g.update(DT);
    }
    return g;
  },
  Moonrunner: (c) => {
    const g = new Moonrunner(c); g.down(); g.up();
    for (let i = 0; i < 60 * 8; i++) { if (i % 90 === 20) { g.down(); g.up(); } g.update(DT); }
    return g;
  },
  Undertow: (c) => {
    const g = new Undertow(c); g.down();
    for (let i = 0; i < 60 * 10; i++) {
      const target = g.gates.find((q) => q.x + 65 > 202)?.center || 270;
      if (g.y + g.vy * 0.42 > target) { if (!g.held) g.down(); } else if (g.held) g.up();
      g.update(DT);
    }
    return g;
  },
  "Echo Vault": (c) => {
    const g = new EchoVault(c); g.down(); step(g, 2.4);
    g.down(); step(g, 0.1); g.up({ durationMs: 100 });
    g.down(); step(g, 0.5); g.up({ durationMs: 500 });
    step(g, 0.3);
    return g;
  },
  "Light Trial": (c) => {
    const g = new LightTrial(c); g.down({}); step(g, 0.2);
    g.event({ type: "cue", trial: g.trial, at_us: 1e6, generation: 0 });
    g.down({ source: "simulator", at_us: 1.2e6, generation: 0 });
    step(g, 0.5);
    return g;
  },
  "Glyph Archive": (c) => {
    const g = new GlyphVault(c); g.down(); step(g, 1);
    step(g, 4);
    g.focus = g.sequence[0]; g.down();
    step(g, 0.3);
    return g;
  },
  "Signal School": (c) => {
    const g = new MorseSchool(c); step(g, 0.2);
    g.down(); step(g, 0.1); g.up({ durationMs: 100 }); step(g, 0.9);
    g.down(); step(g, 0.5); g.up({ durationMs: 500 }); step(g, 0.2);
    return g;
  },
};
for (const [name, play] of Object.entries(plays)) {
  test(`lamps ${name}: nine whole numbers 0-255, varying during play`, () => {
    const c = lit(3), g = play(c);
    assert.ok(c.writes.length > 0, "the game never wrote a lamp");
    assert.ok(wholeNumbers(c.writes), "a write was not nine whole numbers 0-255");
    assert.ok(distinct(c.writes) >= 3, `only ${distinct(c.writes)} different lamp pictures during play`);
    assert.ok(g);
  });
  test(`lamps ${name}: off after cancel, pause and dispose; pause and dispose stay off`, () => {
    for (const how of ["cancel", "pause", "dispose"]) {
      const c = lit(4), g = play(c);
      g[how]?.();
      assert.ok(dark(c.ledsNow), `${how}: lamps still lit ${c.ledsNow.join()}`);
      if (how !== "cancel") {
        const before = c.writes.length;
        step(g, 1);
        assert.equal(c.writes.length, before, `${how}: the game wrote light after it stopped`);
        g.resume?.();
      }
    }
  });
}
for (const [name, make] of [["Orbit Lock", (c) => new OrbitLock(c)], ["Moonrunner", (c) => new Moonrunner(c)],
  ["Undertow", (c) => new Undertow(c)], ["Echo Vault", (c) => new EchoVault(c)], ["Light Trial", (c) => new LightTrial(c)],
  ["Glyph Archive", (c) => new GlyphVault(c)], ["Signal School", (c) => new MorseSchool(c)]]) {
  test(`lamps ${name}: dark on the title screen`, () => {
    const c = lit(5), g = make(c);
    step(g, 2);
    assert.ok(dark(c.ledsNow));
  });
}
for (const [name, kill, over] of [
  ["Orbit Lock", (c) => { const g = new OrbitLock(c); g.down(); g.lives = 1; g.angle = 0; g.target = 3; g.down(); return g; }],
  ["Moonrunner", killRunner],
  ["Undertow", (c) => { const g = new Undertow(c); g.down(); g.up(); g.hull = 1; g.y = 10; g.update(DT); return g; }],
  ["Echo Vault", (c) => { const g = new EchoVault(c); g.down(); step(g, 2.4); g.down(); g.up({ durationMs: 900 }); return g; }],
  ["Glyph Archive", (c) => { const g = new GlyphVault(c); g.down(); step(g, 4); g.lives = 1; g.sequence = [0, 0, 0]; g.focus = 3; g.down(); return g; }],
]) {
  test(`lamps ${name}: flash on death, dark on the result screen`, () => {
    const c = lit(6), g = kill(c);
    assert.equal(g.phase, "over");
    assert.ok(!dark(c.ledsNow), "no death flash");
    step(g, 1.5);
    assert.ok(dark(c.ledsNow), "lamps lit on the result screen: " + c.ledsNow.join());
  });
}

// Light Trial: no host light at all between arming and the cue.
test("Light Trial: the host writes no light while a trial is armed and waiting, only before and after", () => {
  const c = lit(7), g = new LightTrial(c);
  g.down({});
  step(g, 0.1);
  const armed = c.writes.length;
  step(g, 3);            // waiting: the node will time the cue
  assert.equal(g.phase, "wait");
  assert.equal(c.writes.length, armed, "the host wrote lamps while waiting");
  g.event({ type: "cue", trial: g.trial, at_us: 1e6, generation: 0 });
  step(g, 0.5);          // go: the node's green cue is on the middle lamp
  assert.equal(g.phase, "go");
  assert.equal(c.writes.length, armed, "the host wrote lamps while the cue was showing");
  g.down({ source: "simulator", at_us: 1.2e6, generation: 0 });
  assert.ok(!dark(c.ledsNow), "no grade colour after the result");
});
test("Light Trial: a false start alternates red on the outer lamps and leaves the middle lamp dark", () => {
  const c = lit(8), g = new LightTrial(c);
  g.down({}); g.down({});
  assert.equal(g.phase, "early");
  const seen = [];
  for (let i = 0; i < 60; i++) { g.update(DT); seen.push(c.ledsNow.slice()); }
  assert.ok(seen.every((v) => v[3] === 0 && v[4] === 0 && v[5] === 0), "the middle lamp was lit");
  assert.ok(seen.some((v) => v[0] > 0 && v[6] === 0) && seen.some((v) => v[6] > 0 && v[0] === 0), "left and right did not alternate");
  assert.ok(dark(c.ledsNow));
});
test("Light Trial: grade colours and a new best", () => {
  assert.deepEqual([150, 250, 400, 600].map((ms) => reactionGrade(ms).word), ["SHARP", "GOOD", "STEADY", "SLOW"]);
  const c = lit(9, { best: 0 }); c.best = () => 700;
  const g = new LightTrial(c);
  g.down({}); g.event({ type: "cue", trial: g.trial, at_us: 1e6, generation: 0 });
  g.down({ source: "simulator", at_us: 1.15e6, generation: 0 });     // 150 ms: 850 points beats 700
  assert.equal(g.fresh, true);
  const sweep = []; for (let i = 0; i < 12; i++) { g.update(DT); sweep.push(c.ledsNow.slice()); }
  assert.ok(sweep.some((v) => v[0] > 0 && v[3] === 0 && v[6] === 0), "no white sweep started on the left lamp");
  const g2 = new LightTrial(lit(9)); g2.c.best = () => 990;
  g2.down({}); g2.event({ type: "cue", trial: g2.trial, at_us: 1e6, generation: 0 });
  g2.down({ source: "simulator", at_us: 1.3e6, generation: 0 });
  assert.equal(g2.fresh, false);
});

// ----------------------------------------------------------------------------- Orbit Lock mechanics
test("Orbit Lock: the gate keeps narrowing and the satellite speeding up beyond the old 25-lock ceiling", () => {
  for (const [a, b] of [[0, 10], [10, 25], [25, 38]]) {
    assert.ok(orbitWindow(b) < orbitWindow(a));
  }
  assert.ok(orbitSpeed(40) > orbitSpeed(25));
  assert.ok(orbitWindow(60) >= 0.08, "the gate never closes completely");
});
test("Orbit Lock: from the tenth lock every sector reverses the orbit; from the twentieth the gate drifts", () => {
  const c = lit(11), g = new OrbitLock(c); g.down();
  const lock = () => { g.target = g.angle; g.down(); };
  for (let i = 0; i < 9; i++) lock();
  assert.equal(g.dir, 1);
  lock();                                   // tenth
  assert.equal(g.points, 10);
  assert.equal(g.dir, -1, "the orbit did not reverse");
  const before = g.angle; g.update(DT);
  assert.ok(g.angle < before, "the satellite did not move the other way");
  for (let i = 0; i < 9; i++) lock();
  assert.equal(g.points, 19); assert.equal(g.drift, 0);
  lock();
  assert.equal(g.points, 20);
  assert.notEqual(g.drift, 0, "the gate does not drift");
  const t = g.target; g.update(DT); assert.notEqual(g.target, t);
  // Early/late is still judged in the direction of travel.
  g.angle = 0; g.target = -3.9; g.dir = -1;
  g.down();
  assert.match(g.feedback, /EARLY/, "travelling the other way, a gate 3.9 rad ahead on that side is early");
  g.angle = 0; g.target = 1; g.dir = -1;
  g.down();
  assert.match(g.feedback, /LATE/, "travelling the other way, a gate just behind is late");
});
test("Orbit Lock: ten seconds without a lock costs hull, so waiting does not last forever", () => {
  const c = lit(12), g = new OrbitLock(c); g.down();
  step(g, 10.1);
  assert.equal(g.lives, 2);
  step(g, 21);
  assert.equal(g.phase, "over");
});
test("Orbit Lock: the result says NEW BEST only when the run beat the best, and HULL never reads empty", () => {
  const c = lit(13); c.best = () => 3;
  const g = new OrbitLock(c); g.down();
  g.points = 5; g.lives = 1; g.angle = 0; g.target = 3; g.down();
  assert.equal(g.phase, "over");
  let hull; c.hud = (items) => { hull = items.find((x) => x[0] === "HULL")[1]; };
  g.update(DT);
  assert.equal(hull, "0");
  const painted = [];
  g.draw(textRecorder(painted));
  assert.ok(painted.some((s) => /NEW BEST/.test(s)));
});
function textRecorder(painted) {
  return new Proxy({}, { get: (t, key) => key === "fillText" ? (s) => painted.push(String(s)) : (key in t ? t[key] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
}

// Moonrunner's mechanics (rebuilt as a downhill run) are tested in tests/runner.test.mjs.

// -------------------------------------------------------------------------------- Undertow mechanics
test("Undertow: the channel narrows continuously, the openings drift from the tenth passage, hull can be lost and earned", () => {
  const rng = new Random(3);
  assert.ok(nextGate(270, 0, rng).gap > nextGate(270, 30, rng).gap);
  assert.ok(nextGate(270, 45, rng).gap < nextGate(270, 30, rng).gap, "the gap stops narrowing at the old floor");
  assert.equal(nextGate(270, 5, rng).amp, 0);
  assert.ok(nextGate(270, 20, rng).amp > 0);
  const c = lit(17), g = new Undertow(c); g.down(); g.up();
  assert.equal(g.hull, 2);
  g.gates = [{ x: 220, center: 100, base: 100, amp: 0, phase: 0, age: 0, gap: 170, passed: false }]; g.y = 400; g.vy = 0; g.next = 99;
  g.update(DT);
  assert.equal(g.phase, "play"); assert.equal(g.hull, 1);
  const grace = g.grace; assert.ok(grace > 1);
  g.update(DT); assert.equal(g.hull, 1, "hit again during grace");
  g.grace = 0; g.y = 520; g.update(DT);
  assert.equal(g.phase, "over");
  const e = new Undertow(lit(18)); e.down(); e.up(); e.hull = 1; e.points = 11; e.next = 99;
  e.gates = [{ x: 140, center: 270, base: 270, amp: 0, phase: 0, age: 0, gap: 200, passed: false }]; e.y = 270; e.update(DT);
  assert.equal(e.hull, 2, "the twelfth passage did not repair the hull");
});
test("Undertow: a drifting opening really moves", () => {
  const g = new Undertow(lit(19)); g.down(); g.up(); g.next = 99;
  g.gates = [{ x: 900, center: 270, base: 270, amp: 40, phase: 0, age: 0, gap: 200, passed: false }];
  const centers = []; for (let i = 0; i < 120; i++) { g.y = 270; g.vy = 0; g.update(DT); centers.push(g.gates[0].center); }
  assert.ok(Math.max(...centers) - Math.min(...centers) > 30);
});
test("Undertow lamps: the craft is a cyan spot at its depth; near the surface the left lamp pulses red", () => {
  const c = lit(20), g = new Undertow(c); g.down(); g.up(); g.next = 99;
  g.y = 270; g.vy = 0; g.update(DT);
  assert.ok(c.ledsNow[4] > c.ledsNow[1] && c.ledsNow[4] > c.ledsNow[7], "the middle lamp should be brightest at mid depth");
  g.y = 40; g.vy = 0; g.update(DT);
  assert.ok(c.ledsNow[0] > c.ledsNow[3] && c.ledsNow[2] <= c.ledsNow[1], "the top lamp is the brightest near the surface");
  const reds = new Set(); g.grace = 0;
  for (let i = 0; i < 40; i++) { g.y = 40; g.vy = 0; g.update(DT); reds.add(c.ledsNow[0]); }
  assert.ok(reds.size >= 2, "the warning does not pulse");
});

// -------------------------------------------------------------------------------- Echo Vault mechanics
test("Echo Vault: a near-miss is forgiven while a wobble is in hand, a clear mistake is not", () => {
  assert.deepEqual(echoHeard(100, 0, 3), { side: 0, ok: true, wobble: false });
  assert.deepEqual(echoHeard(400, 0, 3), { side: 1, ok: true, wobble: true });
  assert.deepEqual(echoHeard(300, 1, 3), { side: 0, ok: true, wobble: true });
  assert.equal(echoHeard(400, 0, 0).ok, false, "no wobble left");
  assert.equal(echoHeard(520, 0, 3).ok, false, "a clearly long hold for a short pulse");
  assert.equal(echoHeard(200, 1, 3).ok, false, "a clearly short hold for a long pulse");
});
test("Echo Vault: a repeated 330 ms hold runs out of wobbles and ends the run", () => {
  const c = lit(21), g = new EchoVault(c); g.down();
  for (let n = 0; n < 40 && g.phase !== "over"; n++) {
    step(g, 0.1);
    while (g.phase === "show" || g.phase === "between") step(g, 0.1);
    for (let i = 0; i < g.sequence.length && g.phase === "listen"; i++) { g.down(); g.up({ durationMs: 330 }); }
  }
  assert.equal(g.phase, "over");
  assert.ok(g.round <= 5, "a fixed hold scored " + g.round);
});
test("Echo Vault: the hold gauge fills the lamps and turns cyan at 350 ms; the vault says what it heard", () => {
  const c = lit(22), g = new EchoVault(c); g.down(); step(g, 3);
  assert.equal(g.phase, "listen");
  g.down(); step(g, 0.15);
  assert.ok(sum(c.ledsNow, 0) > 0 && sum(c.ledsNow, 2) === 0, "only the first lamp at 150 ms");
  assert.ok(c.ledsNow[0] > c.ledsNow[1], "amber while short");
  step(g, 0.12);
  assert.ok(sum(c.ledsNow, 1) > 0, "the second lamp joins");
  step(g, 0.12);
  assert.ok(sum(c.ledsNow, 2) > 0, "all three lamps are lit by 350 ms");
  assert.ok(c.ledsNow[1] > c.ledsNow[0], "cyan, not amber, once long");
  const tones = []; c.synth.startTone = (hz) => tones.push(hz);
  step(g, 0.1);
  g.up({ durationMs: 480 });
  assert.equal(g.heard.side, 1);
  const painted = []; g.draw(textRecorder(painted));
  assert.ok(painted.some((s) => /HEARD LONG/.test(s)), painted.join("|"));
});
test("Echo Vault: the sidetone steps up at the long threshold", () => {
  const c = lit(23), tones = []; c.synth.startTone = (hz) => tones.push(hz);
  const g = new EchoVault(c); g.down(); step(g, 3);
  g.down(); step(g, 0.3); assert.deepEqual(tones, [440]);
  step(g, 0.1); assert.deepEqual(tones, [440, 660]);
  step(g, 1); assert.deepEqual(tones, [440, 660], "stepped more than once");
});
test("Echo Vault: playback quickens from the third sequence and goes dark from the eighth", () => {
  const g = new EchoVault(lit(24));
  g.round = 2; const base = g.tempo(); g.round = 6;
  assert.ok(g.tempo() < base);
  g.round = 60; assert.equal(g.tempo(), 0.55);
  g.round = 7; assert.equal(g.dark(), false); g.round = 8; assert.equal(g.dark(), true);
  g.phase = "show"; const painted = []; g.draw(textRecorder(painted));
  assert.ok(painted.some((s) => /DARK VAULT/.test(s)));
});
test("Echo Vault lamps: a short is one amber lamp, a long is three cyan lamps, a mismatch blinks the wanted colour", () => {
  const c = lit(25), g = new EchoVault(c); g.down();
  let sawShort = false, sawLong = false;
  for (let i = 0; i < 60 * 3; i++) {
    g.update(DT);
    const v = c.ledsNow;
    if (g.lit && !g.sequence[g.active] && sum(v, 1) > 0 && sum(v, 0) === 0 && sum(v, 2) === 0) sawShort = v[3] > v[5];
    if (g.lit && g.sequence[g.active] && sum(v, 0) > 0 && sum(v, 2) > 0) sawLong = v[1] > v[0];
  }
  assert.ok(sawShort, "no amber middle lamp for a short");
  assert.ok(sawLong, "no cyan bar for a long");
  step(g, 1);
  assert.equal(g.phase, "listen");
  g.down(); g.up({ durationMs: 900 });          // wrong: the first pulse is short
  assert.equal(g.phase, "over");
  const frames = []; for (let i = 0; i < 40; i++) { g.update(DT); frames.push(c.ledsNow.slice()); }
  const blinks = frames.filter((v, i) => !dark(v) && (i === 0 || dark(frames[i - 1]))).length;
  assert.ok(blinks >= 2, "blinked " + blinks);
  assert.ok(frames.find((v) => !dark(v))[0] > 0, "the expected short is amber (red channel on)");
});

// ------------------------------------------------------------------------------ Glyph Archive mechanics
test("Glyph Archive: the cursor quickens, scrambles from the sixth inscription, and the sequence keeps growing", () => {
  const g = new GlyphVault(lit(26)); g.down();
  const s0 = g.scanSeconds(); g.round = 10; assert.ok(g.scanSeconds() < s0);
  g.round = 100; assert.ok(Math.abs(g.scanSeconds() - 0.6 * 0.85) < 1e-9, "the floor is 60% of the chosen scan");
  g.round = 4; g.next(); assert.deepEqual(g.order, [0, 1, 2, 3, 4, 5]);
  g.round = 5; g.next(); assert.deepEqual([...g.order].sort(), [0, 1, 2, 3, 4, 5]); assert.notDeepEqual(g.order, [0, 1, 2, 3, 4, 5]);
  g.round = 12; g.next(); assert.equal(g.sequence.length, 9);
  g.round = 40; g.next(); assert.equal(g.sequence.length, 9);
});
test("Glyph Archive: the cursor visits every glyph once per pass in its order", () => {
  const g = new GlyphVault(lit(27, { settings: { scanMs: 600 } })); g.down(); g.round = 6; g.next(); step(g, 6);
  assert.equal(g.phase, "choose");
  const seen = []; let last = -1;
  for (let i = 0; i < 60 * 6; i++) { g.update(DT); if (g.focus !== last) { last = g.focus; seen.push(last); } }
  assert.deepEqual([...new Set(seen.slice(0, 6))].sort(), [0, 1, 2, 3, 4, 5]);
});
test("Glyph Archive: faster cursors pay more, and an attempt is restored every fourth inscription", () => {
  const pay = (round) => { const g = new GlyphVault(lit(28)); g.down(); g.round = round; g.next(); step(g, 6); g.sequence = [g.focus]; g.entered = []; const b = g.points; g.down(); return g.points - b; };
  assert.ok(pay(8) > 100 + 8 * 20, "a quickened cursor did not pay a bonus");
  const g = new GlyphVault(lit(29)); g.down(); g.next(); step(g, 6); g.round = 3; g.lives = 1; g.sequence = [g.focus]; g.entered = []; g.down();
  assert.equal(g.round, 4); assert.equal(g.lives, 2);
});
test("Glyph Archive lamps: memorising fades out, choosing shows progress and a tick on the cursor's third", () => {
  const c = lit(30), g = new GlyphVault(c); g.down();
  g.update(DT); const early = c.ledsNow[0];
  step(g, 2); assert.ok(c.ledsNow[0] < early, "the memorising light did not fade");
  step(g, 3);
  assert.equal(g.phase, "choose");
  g.entered = []; g.sequence = [0, 1, 2, 3]; g.entered = [0, 1];
  for (let i = 0; i < 90; i++) g.update(DT);
  g.update(DT);
  const frames = []; for (let i = 0; i < 120; i++) { g.update(DT); frames.push(c.ledsNow.slice()); }
  assert.ok(frames.some((v) => v[0] > 0), "no progress on the left lamp");
  assert.ok(distinct(frames) >= 2, "no cursor tick");
});

// ----------------------------------------------------------------------------------------- Signal School
test("Signal School: a letter must be answered correctly twice in a row before the lesson moves on", () => {
  const c = lit(31, { progress: { schema: 2, index: 0, correct: 0, attempts: 0, characters: {} } }), g = new MorseSchool(c);
  g.answer("E"); step(g, 1.4);
  assert.equal(g.target, "E"); assert.equal(g.index, 0);
  g.answer("T"); step(g, 2.5);                 // a wrong answer resets the run
  assert.equal(g.run, 0);
  g.answer("E"); step(g, 1.4); assert.equal(g.target, "E");
  g.answer("E"); step(g, 1.4);
  assert.equal(g.target, "T"); assert.equal(g.index, 1);
});
test("Signal School lamps: lamp I amber on key-down, all three cyan at the dash threshold, a dimming gap countdown", () => {
  const c = lit(32), g = new MorseSchool(c); step(g, 0.1);
  g.down(); step(g, 0.05);
  assert.ok(sum(c.ledsNow, 0) > 0 && sum(c.ledsNow, 1) === 0 && sum(c.ledsNow, 2) === 0, "lamp I only: " + c.ledsNow);
  assert.ok(c.ledsNow[0] > c.ledsNow[2], "amber while it is still a dot");
  step(g, 0.25);                                // past 2 * 120 ms
  assert.ok(sum(c.ledsNow, 1) > 0 && sum(c.ledsNow, 2) > 0, "all three at the threshold");
  assert.ok(c.ledsNow[1] > c.ledsNow[0], "cyan");
  g.up({ durationMs: 300 });
  step(g, 0.1); const a = c.ledsNow[0];
  step(g, 0.4); assert.ok(c.ledsNow[0] < a, "the gap countdown did not dim");
});
test("Signal School lamps: a wrong answer sweeps red and replays the correct signal on the middle lamp", () => {
  const c = lit(33), g = new MorseSchool(c); g.start("guided");
  g.answer("Z");
  const frames = []; for (let i = 0; i < 150; i++) { g.update(DT); frames.push(c.ledsNow.slice()); }
  assert.ok(frames.slice(0, 20).some((v) => v[0] > 0 && v[1] <= v[0]), "no red sweep");
  const middle = frames.filter((v) => v[3] + v[4] + v[5] > 0 && v[0] === 0 && v[6] === 0);
  assert.ok(middle.length > 10, "the correct signal was not shown on the middle lamp");
});
test("Signal School lamps: listen mode shows a dot as the middle lamp and a dash as three; the answer scan has a spot", () => {
  const c = lit(34), g = new MorseSchool(c); g.start("listen");
  const frames = []; for (let i = 0; i < 60 * 4 && g.phase === "signal"; i++) { g.update(DT); frames.push(c.ledsNow.slice()); }
  assert.ok(frames.some((v) => v[3] + v[4] + v[5] > 0 && v[0] === 0 && v[6] === 0) || frames.some((v) => v[0] > 0 && v[6] > 0));
  step(g, 1);
  assert.equal(g.phase, "choose");
  const scans = new Set(); for (let i = 0; i < 60 * 5; i++) { g.update(DT); scans.add(c.ledsNow.join()); }
  assert.ok(scans.size >= 3, "the lamps do not follow the highlighted answer");
});

// ---------------------------------------------------------------------------- legibility of canvas text
test("canvas text is at least 16 px everywhere in the games and Signal School", () => {
  const sizes = [];
  const g2d = new Proxy({}, { get: (t, k) => (k === "fillText" ? () => sizes.push(Number(/(\d+(?:\.\d+)?)px/.exec(t.font)?.[1])) : k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  const c = lit(40);
  const stages = [
    () => new OrbitLock(c), () => { const g = new OrbitLock(c); g.down(); g.points = 12; step(g, 1); return g; },
    () => new Moonrunner(c), () => { const g = new Moonrunner(c); g.down(); g.up(); step(g, 3); return g; },
    () => { const g = new Moonrunner(c); g.down(); step(g, 0.6); g.up(); return g; }, () => killRunner(c),
    () => new Undertow(c), () => { const g = new Undertow(c); g.down(); step(g, 1); return g; },
    () => new EchoVault(c), () => { const g = new EchoVault(c); g.down(); step(g, 3); g.down(); g.up({ durationMs: 500 }); return g; },
    () => new LightTrial(c), () => { const g = new LightTrial(c); g.down({}); return g; },
    () => { const g = new LightTrial(c); g.down({}); g.event({ type: "cue", trial: g.trial, at_us: 1e6 }); g.down({ source: "keyboard" }); return g; },
    () => new GlyphVault(c), () => { const g = new GlyphVault(c); g.down(); step(g, 1); return g; }, () => { const g = new GlyphVault(c); g.down(); step(g, 6); return g; },
    () => new MorseSchool(c), () => { const g = new MorseSchool(c); g.start("listen"); step(g, 4); return g; }, () => { const g = new MorseSchool(c); g.start("review"); return g; },
  ];
  for (const make of stages) { const g = make(); g.draw(g2d); }
  assert.ok(sizes.length > 50);
  assert.ok(Math.min(...sizes) >= 16, "smallest canvas text is " + Math.min(...sizes) + " px");
});

// ----------------------------------------------------------------- the menu-gesture rewind still restores
const guarded = {
  "Orbit Lock": { keys: ["phase", "points", "lives", "target", "angle", "dir", "drift", "idle", "miss", "feedback"],
    make: (c) => { const g = new OrbitLock(c); g.down(); g.points = 21; g.dir = -1; g.drift = 0.2; g.idle = 4; g.target = 0; g.angle = 3; return g; } },
  Moonrunner: { keys: ["phase", "r", "pts", "chain", "fever", "T", "night", "R", "chasms", "pads", "vents", "shards", "sv", "held"],
    make: (c) => { const g = new Moonrunner(c); g.down(); g.up(); step(g, 1); g.chain = 2; g.fever = 1.5; g.T = 21; g.chasms.push({ x0: g.r.x + 500, x1: g.r.x + 640, done: false }); return g; } },
  Undertow: { keys: ["phase", "points", "y", "vy", "gates", "hull", "grace", "trail", "lastCenter"],
    make: (c) => { const g = new Undertow(c); g.down(); g.up(); g.hull = 1; g.grace = 0.9; g.points = 14; g.y = 100; g.vy = -50; return g; } },
  "Glyph Archive": { keys: ["phase", "round", "points", "lives", "entered", "sequence", "focus", "order", "step", "scan", "wait"],
    make: (c) => { const g = new GlyphVault(c); g.down(); g.round = 7; g.next(); step(g, 6); g.points = 700; g.lives = 2; return g; } },
};
for (const [name, { keys, make }] of Object.entries(guarded)) {
  test(`gesture rewind restores every new field in ${name}`, () => {
    const c = lit(41, { settings: { gesturePace: "standard" } }), g = make(c), rig = makeRig(g, c);
    const before = Object.fromEntries(keys.map((k) => [k, structuredClone(g[k])]));
    // Tap, tap, hold with the game running throughout; the game is paused once the menu opens.
    gestureWithUpdates(g, rig);
    assert.equal(rig.menuOpen, 1);
    for (const k of keys) assert.deepEqual(g[k], before[k], `${name}.${k} was not restored`);
    assert.ok(dark(c.ledsNow), "lamps are lit while the menu is open");
    rig.resume();
  });
}
test("lamps come back after the menu closes", () => {
  const c = lit(42), g = new Moonrunner(c), rig = makeRig(g, c);
  g.down(); g.up(); g.next = 1e9;
  g.obstacles = [{ x: 420, w: 48, h: 62, name: "CRYSTAL", passed: false }];
  g.update(DT);
  assert.ok(!dark(c.ledsNow));
  g.pause(); assert.ok(dark(c.ledsNow));
  g.resume(); g.update(DT);
  assert.ok(!dark(c.ledsNow), "the lamps stayed dark after resume");
  void rig;
});

// The host calls these by name; a data field with the same name (a GlyphVault timer called `tick`
// once did) makes the host report "is not a function" in the browser, where unit tests cannot see it.
test("no game or Signal School has a field that shadows a host hook", () => {
  const hooks = ["down", "up", "cancel", "update", "draw", "event", "pause", "resume", "dispose", "menuActions", "tick", "navigation"];
  const c = lit(50);
  for (const make of [() => new OrbitLock(c), () => new Moonrunner(c), () => new Undertow(c), () => new EchoVault(c),
    () => new LightTrial(c), () => new GlyphVault(c), () => new MorseSchool(c)]) {
    const g = make();
    for (let i = 0; i < 120; i++) g.update(DT);
    for (const hook of hooks) assert.ok(g[hook] === undefined || typeof g[hook] === "function" || hook === "navigation", `${g.constructor.name}.${hook} is a ${typeof g[hook]}`);
  }
});
