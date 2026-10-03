// OUTPOST's sound (web/apps/outpost-music.js) and songbook (web/apps/outpost-songs.js).
// Moved here from tests/outpost.test.mjs unchanged when the game was split into modules.
import test from "node:test";
import assert from "node:assert/strict";
import { Outpost } from "../web/apps/outpost.js";
import { appContext, run } from "./helpers/app-context.mjs";

const E = Outpost.econ;
const T0 = 1.8e12;
const realNow = Date.now;
let wall = T0;
test.beforeEach(() => { wall = T0; Date.now = () => wall; });
test.afterEach(() => { Date.now = realNow; });

const boot = (options) => {
  const ctx = appContext(options);
  const app = new Outpost(ctx);
  return { ctx, app };
};
// A started game: the first-launch card dismissed.
const begin = (options) => {
  const made = boot(options);
  if (made.app.phase_ !== "play") { made.app.down(); made.app.up({ durationMs: 50 }); }
  return made;
};
const advance = (app, seconds) => run(app, seconds, () => { wall += 1000 / 60; });
const M = Outpost.music;

test("songbook: every melody is well formed and starts the way the printed tune does", (t) => {
  assert.ok(M.SONGS.length >= 15, "a good number of tunes");
  const anchors = {
    twinkle: "C4 C4 G4 G4 A4 A4 G4", ode: "E4 E4 F4 G4 G4 F4 E4 D4", jacques: "C4 D4 E4 C4 C4 D4 E4 C4", elise: "E5 D#5 E5 D#5 E5 B4 D5 C5 A4",
    greensleeves: "E4 G4 A4 B4 C5 B4 A4 F#4", scarborough: "E4 E4 B4 B4 F#4 G4 F#4 E4", grace: "D4 G4 B4 G4 B4 A4 G4 E4 D4",
    canon: "F#5 E5 D5 C#5 B4 A4 B4 C#5", jingle: "E4 E4 E4 E4 E4 E4 E4 G4 C4 D4 E4", row: "C4 C4 C4 D4 E4 E4 D4 E4 F4 G4",
    korobeiniki: "B4 F#4 G4 A4 G4 F#4 E4 E4", auld: "G3 C4 C4 C4 E4 D4 C4 D4", minuet: "D5 G4 A4 B4 C5 D5 G4 G4",
  };
  const ids = new Set();
  let prevAt = -1;
  M.SONGS.forEach((sg, i) => {
    const mel = M.MEL[i];
    assert.ok(!ids.has(sg.id)); ids.add(sg.id);
    assert.ok(sg.name.length <= 22, sg.name + " fits a ring row");
    assert.ok(sg.at >= prevAt); prevAt = sg.at;
    assert.ok(mel.n.length >= 16 && mel.n.length <= 130, sg.id + " length " + mel.n.length);
    assert.ok(mel.lo >= 53 && mel.hi <= 84, `${sg.id} range ${M.noteName(mel.lo)}..${M.noteName(mel.hi)} (about 175-1050 Hz)`);
    assert.ok(mel.ends.every((e, k) => e > (mel.ends[k - 1] ?? -1)) && mel.ends.at(-1) === mel.n.length - 1);
    assert.ok(mel.ends.length >= 2 && mel.ends[0] >= 2, "phrases kept");
    if (anchors[sg.id]) assert.equal(mel.n.slice(0, anchors[sg.id].split(" ").length).map(M.noteName).join(" "), anchors[sg.id], sg.id);
    let from = 0;
    t.diagnostic(sg.name + " (" + sg.by + ")  " + mel.ends.map((e) => { const s = mel.n.slice(from, e + 1).map(M.noteName).join(" "); from = e + 1; return s; }).join(" | "));
  });
  assert.equal(M.SONGS[0].at, 0, "the first tune is there from the start");
});

test("generated tunes: deterministic per seed, in range, stepwise, phrases end on stable tones", () => {
  const a = M.genTune(12345), b = M.genTune(12345);
  assert.deepEqual(a.n, b.n); assert.equal(a.name, b.name);
  assert.notDeepEqual(M.genTune(12346).n, a.n);
  let steps = 0, total = 0, leaps = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const mel = M.genTune(seed * 7919);
    assert.equal(mel.ends.length, 4); assert.equal(mel.n.length, 32);
    assert.ok(mel.lo >= 53 && mel.hi <= 84, "range " + seed);
    const scale = M.SCALES[mel.mode];
    const stable = new Set([0, scale[2], scale[mel.mode === "pent" ? 3 : 4]].map((i) => (mel.tonic + i) % 12));
    for (const e of mel.ends) assert.ok(stable.has(mel.n[e] % 12), `seed ${seed} phrase ends on ${M.noteName(mel.n[e])}`);
    assert.equal(mel.n[31] % 12, mel.tonic % 12, "last phrase ends on the tonic");
    for (let i = 1; i < mel.n.length; i++) { const d = Math.abs(mel.n[i] - mel.n[i - 1]); total++; if (d <= 4) steps++; if (d > 9) leaps++; }
    assert.ok(mel.n.every((m) => mel.pcs.has(m % 12)), "every note is in the scale");
  }
  assert.ok(steps / total > 0.8, "mostly stepwise: " + (steps / total).toFixed(2));
  assert.ok(leaps / total < 0.03, "wide leaps are rare: " + (leaps / total).toFixed(3));
  assert.equal(M.genName(1), M.genName(1));
});

test("the extra voices sit quietly under the lead: a fully voiced tap is about twice one note", () => {
  const { ctx, app } = begin();
  app.s.lt = 1e6;
  advance(app, 0.5);
  const n0 = ctx.calls.tone.length; app.gather();
  const single = ctx.calls.tone.slice(n0);
  assert.equal(single.length, 1);
  assert.ok(single[0][3] === undefined || single[0][3] === 1, "the lead alone is at full level");
  for (const k of E.VOICE) app.s.up[k] = 1;
  app.s.sp = 0; app.loadMelody();
  advance(app, 0.5);
  const n1 = ctx.calls.tone.length; app.gather();
  const full = ctx.calls.tone.slice(n1);
  assert.equal(full.length, 5, "lead, third, octave, bass and bell on the first note of a phrase");
  const gains = full.map((c) => c[3] ?? 1);
  assert.ok(gains.slice(1).every((x) => x > 0 && x <= 0.5), "every extra voice is at half the lead or less: " + gains);
  const sum = gains.reduce((a, b) => a + b, 0);
  assert.ok(sum <= 2.2, "the whole band sums to " + sum + " of one note (it was 5)");
});
