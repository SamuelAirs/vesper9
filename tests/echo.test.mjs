// Echo Vault (web/apps/echo.js): the Morse sending game, its spaced practice and its save.
import test from "node:test";
import assert from "node:assert/strict";
import { EchoVault, migrateEcho, schoolLetters, callSign, ORDER, WORDS, SHIELDS, SHIFT, FIRST_LETTERS, STATIONS, FEATS } from "../web/apps/echo.js";
import { MORSE } from "../web/apps/morse.js";
import { need, SPACING, tally, settle } from "../web/apps/learning.js";
import { appContext, fakeCanvas } from "./helpers/app-context.mjs";

const DT = 1 / 60;
const step = (g, s) => { for (let i = 0, n = Math.round(s * 60); i < n; i++) g.update(DT); };
const dark = (v) => v.every((x) => x === 0);
const lamps = (c) => c.calls.leds.at(-1) || Array(9).fill(0);
// One element keyed by a person: a dot 90 ms, a dash 380 ms at the default 10 wpm (dash line 240 ms).
function key(g, e) { const ms = e === "." ? 90 : 380; g.down(); step(g, ms / 1000); g.up({ durationMs: ms }); step(g, 0.1); }
function begin(g) { g.down(); g.up({ durationMs: 60 }); while (g.phase === "intro") { g.down(); g.up({ durationMs: 60 }); } }
const numbers = (o, path = "") => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? numbers(v, path + k + ".") : typeof v === "number" ? [[path + k, v]] : []));

// A player who knows `known` letters: waits `think` s, then keys the right code; otherwise waits it out.
// With `slip`, a letter it does not know is one wrong element (a single miss), not a wrong code.
function bot(g, { think = 0.5, known = () => true, seconds = 400, slip = false } = {}) {
  for (let i = 0; i < seconds * 60 && g.phase === "play"; i++) {
    if (g.stage === "send" && g.current() && g.letterT >= think && g.downAt === null && !g.input && g.missT <= 0) {
      const k = g.current();
      for (const e of known(k) ? MORSE[k] : slip ? (MORSE[k][0] === "." ? "-" : ".") : "..--..") { if (g.phase !== "play" || g.stage !== "send") break; key(g, e); }
    } else g.update(DT);
  }
}

test("Echo Vault save: nothing, a first-release run record and a schema 2 save all load as schema 2", () => {
  const empty = migrateEcho(undefined);
  assert.equal(empty.schema, 2); assert.equal(empty.pool, FIRST_LETTERS); assert.equal(empty.runs, 0);
  // What recordRun() wrote for the old memory game.
  const old = { schema: 1, runs: 7, last: { sequences: 5, milestone: 5, error: "PULSE 3: EXPECTED LONG" }, milestone: 9 };
  const v = migrateEcho(old);
  assert.equal(v.runs, 7); assert.equal(v.milestone, 9); assert.equal(v.last.sequences, 5);
  assert.deepEqual(v.letters, {}); assert.equal(v.session, 0);
  const round = migrateEcho(JSON.parse(JSON.stringify({ ...v, pool: 9, letters: { E: [3, 6, 20, 1], T: "junk", Q: [1, 2] } })));
  assert.equal(round.pool, 9); assert.deepEqual(round.letters, { E: [3, 6, 20, 1] }, "malformed records are dropped");
  assert.equal(migrateEcho({ schema: 2, pool: 999 }).pool, ORDER.length);
});

test("Echo Vault: a first-release save is kept, and the first run writes schema 2 on top of it", () => {
  const c = appContext({ seed: 3, progress: { schema: 1, runs: 7, last: { sequences: 5, milestone: 5 }, milestone: 9 } });
  const g = new EchoVault(c);
  begin(g); bot(g, { think: 0.4 });
  assert.equal(g.phase, "over");
  step(g, 2);
  const saved = c.calls.saved.at(-1);
  assert.equal(saved.schema, 2); assert.equal(saved.runs, 8); assert.ok(saved.milestone >= 9);
  assert.ok(JSON.stringify(saved).length < 8192);
  // The next launch reads it back unchanged.
  assert.deepEqual(migrateEcho(saved), saved);
});

test("Echo Vault: letters Signal School has taught are open here, and words use only open letters", () => {
  const c = appContext({ seed: 5, state: { progress: { morse: { schema: 2, index: 10 } } } });
  assert.equal(schoolLetters(c), 10);
  const g = new EchoVault(c);
  assert.equal(g.poolSize(), 10);
  const open = new Set(ORDER.slice(0, 10));
  begin(g);
  for (let i = 0; i < 40; i++) { const w = g.pickWord(); assert.ok([...w].every((ch) => open.has(ch)), w); g.run.words = i; }
  assert.equal(schoolLetters(appContext()), 0, "no Signal School progress, nothing extra");
});

test("Echo Vault: the first run introduces E T A N, then asks each alone twice with its code shown", () => {
  const c = appContext({ seed: 6 }), g = new EchoVault(c);
  g.down(); g.up({ durationMs: 60 });
  assert.equal(g.phase, "intro"); assert.deepEqual(g.fresh, ["E", "T", "A", "N"]);
  step(g, 0.2); assert.ok(g.playing(), "the new letter is played");
  for (let i = 0; i < 4; i++) { g.down(); g.up({ durationMs: 60 }); }
  assert.equal(g.phase, "play"); assert.equal(g.word, "E");
  assert.ok(g.hintVisible(), "a new letter's code is shown at once");
  key(g, ".");
  assert.equal(g.word, "E"); assert.equal(g.run.letters, 1, "the second E");
});

test("Echo Vault: a dot under two units, a dash from two; a wrong element is a miss at once and costs a second", () => {
  const c = appContext({ seed: 7 }), g = new EchoVault(c);
  begin(g);
  g.queue = []; g.word = "K"; g.pos = 0; g.input = ""; g.left = g.total = 10; g.stage = "send";
  key(g, "-"); assert.equal(g.input, "-");
  key(g, "."); assert.equal(g.input, "-.");
  const before = g.left;
  key(g, ".");                                   // "-.." is D, not K
  assert.equal(g.run.misses, 1); assert.match(g.feedback, /HEARD D/);
  assert.ok(g.left < before - 0.9, "a miss costs a second");
  assert.ok(g.shown, "the code is shown after a miss");
  step(g, 0.6); assert.equal(g.input, "");
  for (const e of MORSE.K) key(g, e);
  assert.equal(g.stage, "clear");
});

test("Echo Vault: an unfinished letter counts as sent after the gap; a press of a second is no element", () => {
  const c = appContext({ seed: 8 }), g = new EchoVault(c);
  begin(g);
  g.queue = []; g.word = "KE"; g.pos = 0; g.input = ""; g.left = g.total = 20; g.stage = "send";
  key(g, "-"); key(g, ".");
  step(g, 1.1);
  assert.equal(g.run.misses, 1); assert.match(g.feedback, /HEARD N/);
  step(g, 0.6);
  g.down(); step(g, 1.1); g.up({ durationMs: 1100 });
  assert.equal(g.input, "", "a long hold keyed nothing");
});

test("Echo Vault: hints fade with strength; strength 4 shows the code only after a miss", () => {
  const c = appContext({ seed: 9 }), g = new EchoVault(c);
  begin(g);
  const at = (s, seconds) => { g.sv.letters.T = [s, 0, 5, 0]; g.word = "T"; g.pos = 0; g.shown = false; g.kind = "plain"; g.stage = "send"; g.letterT = seconds; return g.hintVisible(); };
  assert.equal(at(1, 1.4), false); assert.equal(at(1, 1.6), true);
  assert.equal(at(2, 2.9), false); assert.equal(at(2, 3.1), true);
  assert.equal(at(4, 60), false);
  g.shown = true; assert.equal(g.hintVisible(), true);
});

test("Echo Vault: a new letter opens after a run once every letter in play is strong enough, one at a time", () => {
  const c = appContext({ seed: 10 }), g = new EchoVault(c);
  for (const k of "ETA") g.sv.letters[k] = [2, 9, 9, 0];
  g.sv.letters.N = [1, 9, 9, 0];
  begin(g); g.dispose();
  assert.equal(g.result.unlocked, "I"); assert.equal(g.sv.pool, 5);
  const h = new EchoVault(appContext({ seed: 11, progress: c.calls.saved.at(-1) }));
  assert.equal(h.poolSize(), 5);
  begin(h); assert.deepEqual(h.fresh, ["I"], "the new letter is introduced on the next run");
  h.dispose(); assert.equal(h.result.unlocked, "", "I is not strong yet");
});

test("Echo Vault: a competent player opens the vault; an idle one is sealed with nothing", () => {
  const scores = [];
  for (const seed of [1, 2, 3]) {
    const c = appContext({ seed }), g = new EchoVault(c);
    begin(g); bot(g, { think: 0.5 });
    assert.equal(g.result.reason, "opened", "seed " + seed);
    assert.equal(g.sv.last.words, SHIFT);
    scores.push(g.sv.last.score);
  }
  const c = appContext({ seed: 4 }), idle = new EchoVault(c);
  begin(idle); step(idle, 300);
  assert.equal(idle.phase, "over"); assert.equal(idle.result.reason, "sealed");
  assert.equal(idle.sv.last.score, 0); assert.equal(idle.shields, 0);
  assert.ok(Math.min(...scores) > 2000, "competent scores " + scores);
});

test("Echo Vault: a player who confuses one letter loses shields on it and sees it to revisit", () => {
  const c = appContext({ seed: 12 }), g = new EchoVault(c);
  for (const k of "ETAN") g.sv.letters[k] = [3, 0, 9, 0];
  begin(g); bot(g, { think: 0.4, known: (k) => k !== "A" });
  assert.equal(g.phase, "over");
  assert.ok(g.sv.letters.A[0] < 3, "A dropped a step"); assert.ok(g.sv.letters.A[3] > 0);
  assert.ok(g.sv.letters.E[0] >= 3);
});

test("Echo Vault: echo transmissions hide the word, play it first, and a long hold replays it for a second", () => {
  const c = appContext({ seed: 13 }), g = new EchoVault(c);
  assert.equal(g.kindFor(6), "echo"); assert.equal(g.kindFor(5), "plain"); assert.equal(g.kindFor(10), "priority");
  assert.equal(g.kindFor(17), "echo");
  begin(g); g.queue = []; g.run.words = 6; g.nextWord();
  if (g.word.length === 1) { g.queue = ["TEA"]; g.nextWord(); }
  assert.equal(g.kind, "echo"); assert.equal(g.stage, "listen");
  const painted = []; const cv = fakeCanvas(); cv.fillText = (s) => painted.push(String(s)); g.draw(cv);
  assert.ok(painted.includes("?") && !painted.includes(g.word[0]), "the letters are hidden: " + painted.join("|"));
  let lit = false;
  for (let i = 0; i < 600 && g.stage === "listen"; i++) { g.update(DT); if (!dark(lamps(c))) lit = true; }
  assert.ok(lit, "the lamps carried the playback");
  assert.equal(g.stage, "send");
  const left = g.left;
  g.down(); step(g, 1.05); g.up({ durationMs: 1050 });
  assert.equal(g.stage, "listen"); assert.ok(g.left <= left - 0.9);
  assert.equal(g.menuActions().length, 1, "the menu offers the signal again");
});

test("Echo Vault lamps: whole numbers, varying in play, dark on the title and result, off after cancel/pause/dispose", () => {
  const c = appContext({ seed: 14 }), g = new EchoVault(c);
  step(g, 1); assert.ok(dark(lamps(c)), "dark on the title");
  begin(g); bot(g, { think: 0.5, seconds: 40 });
  const writes = c.calls.leds;
  assert.ok(writes.every((v) => v.length === 9 && v.every((x) => Number.isInteger(x) && x >= 0 && x <= 255)));
  assert.ok(new Set(writes.map((v) => v.join())).size >= 6);
  for (const how of ["cancel", "pause", "dispose"]) {
    const d = appContext({ seed: 15 }), h = new EchoVault(d);
    begin(h); step(h, 1.5); h.down(); step(h, 0.1);
    h[how]();
    assert.ok(dark(lamps(d)), how);
  }
  const e = appContext({ seed: 16 }), k = new EchoVault(e);
  begin(k); step(k, 300); step(k, 2);
  assert.equal(k.phase, "over"); assert.ok(dark(lamps(e)), "dark on the result screen");
});

test("Echo Vault: three stray taps never end a run; numbers stay finite and lists bounded", () => {
  const c = appContext({ seed: 17 }), g = new EchoVault(c);
  begin(g);
  for (let i = 0; i < 3; i++) { g.down(); g.up({ durationMs: 60 }); }
  g.cancel();
  assert.equal(g.phase, "play"); assert.equal(g.shields, SHIELDS);
  bot(g, { think: 0.3, seconds: 120 });
  for (const [k, v] of numbers(g.sv)) assert.ok(Number.isFinite(v), k);
  assert.ok(g.recent.length <= 8 && g.pulses.length <= 200);
  const cv = fakeCanvas();
  for (const phase of ["title", "card", "over"]) { g.phase = phase; g.draw(cv); }
});

test("Echo Vault: the result screen has a lockout, then a tap opens the vault again and a hold shows the code card", () => {
  const c = appContext({ seed: 18 }), g = new EchoVault(c);
  begin(g);
  for (let i = 0; i < 300 * 60 && g.phase !== "over"; i++) g.update(DT);
  assert.equal(g.phase, "over");
  step(g, 0.1); g.down(); g.up({ durationMs: 40 }); assert.equal(g.phase, "over");
  step(g, 0.6); g.down(); step(g, 0.6); g.up({ durationMs: 600 }); assert.equal(g.phase, "card");
  g.down(); g.up({ durationMs: 60 }); assert.equal(g.phase, "title");
  g.down(); g.up({ durationMs: 60 }); assert.notEqual(g.phase, "title");
});

test("Echo Vault: leaving mid-run scores and saves the run; leaving an idle title saves nothing", () => {
  const c = appContext({ seed: 19 }), g = new EchoVault(c);
  begin(g); bot(g, { think: 0.4, seconds: 20 });
  g.cancel(); g.pause(); g.dispose();
  assert.ok(c.calls.score.length >= 1); assert.equal(c.calls.saved.at(-1).last.reason, "left");
  const d = appContext({ seed: 20 }), h = new EchoVault(d);
  h.cancel(); h.pause(); h.dispose();
  assert.equal(d.calls.saved.length, 0); assert.equal(d.calls.score.length, 0);
});

test("Echo Vault: a full save stays small", () => {
  const full = migrateEcho({ schema: 2, pool: 26, letters: Object.fromEntries([...ORDER].map((k) => [k, [5, 999, 9999, 9999]])) });
  assert.ok(JSON.stringify(full).length < 2048);
  assert.ok(WORDS.every((w) => /^[A-Z]+$/.test(w)), "every word is plain letters");
});

test("Echo Vault depth: the last word of a shift is a station's call sign; keying it logs the station and reports feats to the console", () => {
  const c = appContext({ seed: 21 }), g = new EchoVault(c), feats = [];
  c.feat = (id, name) => feats.push([id, name]);
  begin(g);
  let sign = "", pool = [];
  for (let i = 0; i < 400 * 60 && g.phase === "play"; i++) {
    if (g.run.words === SHIFT - 1 && g.kind === "contact") { sign = g.word; pool = g.pool(); }
    if (g.stage === "send" && g.current() && g.letterT >= 0.5 && g.downAt === null && !g.input && g.missT <= 0)
      for (const e of MORSE[g.current()]) { if (g.phase !== "play" || g.stage !== "send") break; key(g, e); }
    else g.update(DT);
  }
  assert.equal(g.result.reason, "opened");
  assert.equal(sign, callSign(0, pool), "the call sign is built from open letters");
  assert.equal(g.result.station, STATIONS[0]); assert.equal(g.sv.stations, 1);
  assert.deepEqual(feats.find(([id]) => id === "first"), ["first", "FIRST CONTACT"], "the console's logbook hears of the feat");
  assert.ok(feats.every(([id, name]) => FEATS.some((f) => f.id === id && f.name === name)));
  step(g, 2); const saved = c.calls.saved.at(-1);
  assert.equal(saved.stations, 1); assert.ok(JSON.stringify(saved).length < 8192);
  for (const gone of ["xp", "contracts", "feats", "daily", "days"]) assert.equal(gone in saved, false, gone + " belongs to the console now");
});

test("Echo Vault save: ranks, contracts, streaks and feats from the last build are dropped; stations stay", () => {
  const old = migrateEcho({ schema: 1, runs: 3 });
  assert.equal(old.stations, 0);
  const odd = migrateEcho({ schema: 2, xp: 900, stations: 99, feats: ["first"], contracts: 4, daily: { day: "2026-10-01", id: 2, done: 1 }, days: { streak: 3 } });
  assert.equal(odd.stations, STATIONS.length);
  for (const gone of ["xp", "contracts", "feats", "daily", "days"]) assert.equal(gone in odd, false, gone);
  const g = new EchoVault(appContext({ seed: 30 })); begin(g); g.dispose(); // no ctx.feat (no console logbook): still fine
});

test("Echo Vault: a hold on the title shows the code card, a second the station log, a third goes back; every page draws", () => {
  const c = appContext({ seed: 22 }), g = new EchoVault(c);
  g.sv.stations = 5;
  const hold = () => { g.down(); step(g, 0.6); g.up({ durationMs: 600 }); };
  hold(); assert.equal(g.phase, "card"); assert.equal(g.page, "code"); g.draw(fakeCanvas());
  hold(); assert.equal(g.page, "log"); g.draw(fakeCanvas());
  hold(); assert.equal(g.phase, "title"); g.draw(fakeCanvas());
  hold(); g.down(); g.up({ durationMs: 60 }); assert.equal(g.phase, "title", "a tap on a page goes back");
});

test("Spaced practice settles a session as a whole: one slip among good answers still earns the step", () => {
  const t = {}, s = {};
  for (let i = 0; i < 9; i++) tally(t, s, "E", "clean");
  tally(t, s, "E", "miss");
  for (let i = 0; i < 2; i++) tally(t, s, "T", "clean");
  for (let i = 0; i < 4; i++) tally(t, s, "A", "miss");
  tally(t, s, "A", "clean");
  t.N = [3, 9, 20, 0]; tally(t, s, "N", "clean");
  const out = settle(t, s, 1);
  assert.equal(t.E[0], 2, "a new letter answered from memory 9 of 10 times goes straight to 2"); assert.equal(t.E[1], 1 + SPACING[2]);
  assert.deepEqual(t.E.slice(2), [9, 1]);
  assert.equal(t.T[0], 1, "two clean answers: one step");
  assert.equal(t.A[0], 0); assert.ok(t.A[1] <= 1, "mostly wrong: due again");
  assert.equal(t.N[0], 3, "a strong letter that is not due waits");
  assert.deepEqual(out.gained.sort(), ["E", "T"]); assert.deepEqual(out.revisit, ["A"]);
  const u = { K: [3, 1, 5, 0] }, v = {};
  tally(u, v, "K", "miss"); tally(u, v, "K", "miss"); tally(u, v, "K", "clean");
  settle(u, v, 4); assert.equal(u.K[0], 2, "mostly wrong drops one step"); assert.ok(u.K[1] <= 5, "and it is due again soon");
});

test("Echo Vault pacing: a player who keys 90% of letters right opens new letters shift after shift", () => {
  for (const seed of [31, 32, 33]) {
    let r = seed;
    const rand = () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648);
    const c = appContext({ seed }), g = new EchoVault(c);
    const sizes = [];
    for (let shift = 0; shift < 4; shift++) {
      begin(g); bot(g, { think: 0.5, known: () => rand() > 0.1, slip: true });
      assert.equal(g.phase, "over"); sizes.push(g.poolSize());
      step(g, 1); g.down(); g.up({ durationMs: 60 }); g.title?.();
    }
    assert.ok(sizes[0] >= FIRST_LETTERS + 1, `seed ${seed}: a fifth letter after the first shift (${sizes})`);
    assert.ok(sizes[3] >= FIRST_LETTERS + 3, `seed ${seed}: still opening letters (${sizes})`);
  }
});
