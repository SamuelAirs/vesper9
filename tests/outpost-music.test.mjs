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

// ======================= cues in the tune's key, on the player's beat =======================
import { CUES, CUE_GAIN, POCKET_GAIN, cue, tick, tuneCue, degreeMidi, cueTiming, liveBeat } from "../web/apps/outpost-music.js";
const tuneCueOf = (app) => tuneCue(app, app.mel);

const hzMidi = (hz) => Math.round(69 + 12 * Math.log2(hz / 440));
// Keeps a steady beat of `beat` seconds for n taps.
const keepBeat = (app, beat, n) => {
  for (let i = 0; i < n; i++) { app.down(); advance(app, 0.05); app.up({ durationMs: 50 }); advance(app, beat - 0.05); }
};

test("every cue and interface tick is in the key of the tune being played, in a comfortable range", () => {
  const mels = [...M.MEL, ...Array.from({ length: 60 }, (_, i) => M.genTune(i * 104729 + 7))];
  const modes = new Set();
  for (const mel of mels) {
    modes.add(mel.mode);
    for (const [name, [deg]] of Object.entries(CUES)) {
      for (const d of deg) {
        const m = degreeMidi(mel, d);
        assert.ok(mel.pcs.has(m % 12), `${name} degree ${d} is ${M.noteName(m)}, outside ${mel.name}`);
        const hz = M.midiHz(m);
        assert.ok(hz > 200 && hz < 1800, `${name} at ${hz.toFixed(0)} Hz in ${mel.name}`);
      }
    }
  }
  assert.ok(["maj", "min", "dor", "pent"].every((x) => modes.has(x)), "checked in every mode: " + [...modes]);
  // ticks too: played through a game on the minor tune
  const { ctx, app } = begin();
  const gs = M.SONGS.findIndex((x) => x.id === "greensleeves");
  app.s.lt = 1e12; app.s.sg = gs; app.loadMelody();
  const n = ctx.calls.tone.length;
  for (let k = 0; k < 6; k++) tick(app, "step", k);
  tick(app, "page"); tick(app, "close"); tick(app, "afford");
  for (const c of ctx.calls.tone.slice(n)) assert.ok(app.mel.pcs.has(hzMidi(c[0]) % 12), "tick " + M.noteName(hzMidi(c[0])));
});

test("the same cue follows the tune's key: a purchase in E minor is not the purchase in C major", () => {
  const notes = (sid) => {
    const { app } = begin();
    app.s.lt = 1e12; app.s.sg = M.SONGS.findIndex((x) => x.id === sid); app.loadMelody();
    app.queue = []; cue(app, "buy");
    return app.queue.map((q) => hzMidi(q.hz));
  };
  const c = notes("twinkle"), e = notes("greensleeves");
  assert.equal(c.length, 4); assert.notDeepEqual(c, e);
  assert.deepEqual(c.map((m) => M.noteName(m)), ["G4", "C5", "E5", "G5"], "C major: fifth, octave, tenth, twelfth");
  assert.deepEqual(e.map((m) => M.noteName(m)), ["B4", "E5", "G5", "B5"], "E minor: the minor third");
});

test("cues are bells under the tune: sine, below the lead's level, never mistaken for the melody", () => {
  for (const [name, [, gap, len, wave]] of Object.entries(CUES)) {
    assert.equal(wave, "sine", name);
    assert.ok(gap >= 0.04 && len >= 0.06 && len <= 0.4, name);
  }
  const { ctx, app } = begin();
  advance(app, 1);
  const n = ctx.calls.tone.length;
  cue(app, "milestone"); advance(app, 1);
  const played = ctx.calls.tone.slice(n);
  assert.equal(played.length, CUES.milestone[0].length);
  assert.ok(played.every((c) => c[2] === "sine" && c[3] === CUE_GAIN && CUE_GAIN < 1));
});

test("with no beat a cue keeps its own spacing; while a beat is kept its notes land on the beat", () => {
  const { app } = begin();
  advance(app, 3);
  assert.equal(liveBeat(app), 0);
  app.queue = []; const t0 = app.clk; cue(app, "buy");
  assert.deepEqual(app.queue.map((q) => +(q.at - t0).toFixed(4)), [0, 0.055, 0.11, 0.165]);
  // a steady 0.4 s beat, and a cue that arrives between taps
  keepBeat(app, 0.4, 8);
  advance(app, 0.13);
  const beat = liveBeat(app);
  assert.ok(Math.abs(beat - 0.4) < 0.03, "beat " + beat);
  app.queue = []; cue(app, "buy");
  const ats = app.queue.map((q) => q.at - app.lastGather), step = ats[1] - ats[0];
  assert.ok(Math.abs(beat / step - Math.round(beat / step)) < 1e-6, `the spacing ${step} divides the beat ${beat}`);
  assert.ok(Math.abs(step - 0.055) < 0.03, "near the cue's own spacing: " + step);
  for (const a of ats) assert.ok(Math.abs(a / step - Math.round(a / step)) < 1e-6, "on a subdivision: " + a);
  assert.ok(ats[0] >= app.clk - app.lastGather - 1e-9, "never in the past");
  // once the player stops, cues go back to their own timing
  advance(app, 3);
  assert.equal(liveBeat(app), 0);
  assert.equal(cueTiming(app, 0.07).gap, 0.07);
});

test("full groove adds a quiet bell to every note, and a sparkle once when it fills", () => {
  const { ctx, app } = begin();
  app.s.lt = 1e4;
  const n = ctx.calls.tone.length;
  keepBeat(app, 0.35, 10);
  assert.ok(!ctx.calls.tone.slice(n).some((c) => c[3] === POCKET_GAIN), "nothing extra before the groove is full");
  keepBeat(app, 0.35, 40);
  assert.ok(app.groove >= E.GROOVE_MAX, "groove filled: " + app.groove);
  const bells = ctx.calls.tone.slice(n).filter((c) => c[3] === POCKET_GAIN);
  assert.ok(bells.length >= 10, "a bell with each note in the pocket: " + bells.length);
  // the sparkle's notes, in order, among the cue tones (other cues, such as goals, can sound too)
  const sparkle = CUES.pocket[0].map((d) => Math.round(M.midiHz(degreeMidi(app.mel, d)))).join();
  const cues = ctx.calls.tone.slice(n).filter((c) => c[3] === CUE_GAIN).map((c) => Math.round(c[0]));
  let found = 0;
  for (let i = 0; i + 3 <= cues.length; i++) if (cues.slice(i, i + 3).join() === sparkle) found++;
  assert.equal(found, 1, "the sparkle plays once, not on every tap");
});

test("the songbook keeps growing through the long game", () => {
  const late = M.SONGS.filter((sg) => sg.at >= 1e14);
  assert.ok(late.length >= 5, "tunes still to find after 100 T: " + late.length);
  assert.ok(M.SONGS.at(-1).at >= 1e18, "the last arrives at " + M.SONGS.at(-1).at);
  const first = (id, n) => M.MEL[M.SONGS.findIndex((x) => x.id === id)].n.slice(0, n).map(M.noteName).join(" ");
  assert.equal(first("saints", 8), "C4 E4 F4 G4 C4 E4 F4 G4");
  assert.equal(first("largo", 6), "E4 G4 G4 E4 D4 C4");
  assert.equal(first("danube", 5), "D4 D4 F#4 A4 A4");
});

test("cues wait their turn, and a hum sounds the notes of the machines that are humming", () => {
  const { ctx, app } = begin();
  advance(app, 2);
  app.queue = [];
  tuneCueOf(app);
  const flourishEnd = Math.max(...app.queue.map((q) => q.at));
  const n = app.queue.length;
  // two machines owned and humming: the dish (C) and the drill (G)
  app.s.own[0] = 3; app.s.own[2] = 2; app.hum[0] = 100; app.hum[2] = 100;
  cue(app, "hum");
  const hum = app.queue.slice(n);
  assert.ok(hum.length >= 2 && hum[0].at > flourishEnd, "the hum starts after the flourish");
  assert.deepEqual([...new Set(hum.map((q) => hzMidi(q.hz) % 12))].sort((a, b) => a - b), [E.PROD[0].pc, E.PROD[2].pc].sort((a, b) => a - b));
  const from = ctx.calls.tone.length;
  advance(app, 2);
  assert.equal(app.queue.length, 0);
  assert.equal(ctx.calls.tone.length - from, n + hum.length, "everything played");
  // with nothing humming the hum falls back to the tune's own chord
  app.hum.fill(0); app.queue = []; cue(app, "hum");
  assert.equal(app.queue.length, CUES.hum[0].length);
});
