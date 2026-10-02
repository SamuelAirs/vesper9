// RELAY: the rhythms, the call and answer timeline, the judging, the stages, the songbook, the save, the lamps.
import test from "node:test";
import assert from "node:assert/strict";
import { Relay, RHYTHMS, MODES, migrateSave, stageSpec, dailyGoal, voice, byId, latency, WIN, LEARNED, MASTERED } from "../web/apps/relay.js";
import { appContext, fakeCanvas, run } from "./helpers/app-context.mjs";
import { Random } from "../web/engine/math.js";

const tap = (a) => { a.down(); a.up(); };
const hold = (a) => { a.down(); run(a, 0.6); a.up(); };
function mount(options = {}) {
  const ctx = appContext({ seed: 7, ...options });
  return { ctx, app: new Relay(ctx) };
}
// A player who taps every note of every answer with a timing error of about `sd` seconds.
function bot(app, seed, sd, seconds, g) {
  const r = new Random(seed), plan = new Map();
  for (let i = 0; i < seconds * 60 && app.phase === "play"; i++) {
    for (const s of app.segs) if (s.kind === "answer") for (const n of s.notes) {
      if (!plan.has(n)) plan.set(n, { at: n.t + (r.next() + r.next() + r.next() - 1.5) * sd * 2, done: false });
      const p = plan.get(n);
      if (!p.done && !n.done && app.rt + 1 / 120 >= p.at) { p.done = true; tap(app); }
    }
    app.update(1 / 60);
    if (g && i % 7 === 0) app.draw(g);
  }
}
const numbers = (o, path = "") => {
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === "number") assert.ok(Number.isFinite(v), path + k + " is " + v);
    else if (v && typeof v === "object" && !ArrayBuffer.isView(v)) numbers(v, path + k + ".");
  }
};
// Run until the answer of the current round is under way.
const toAnswer = (app) => { for (let i = 0; i < 1200 && !(app.seg() && app.seg().kind === "answer"); i++) app.update(1 / 60); return app.seg(); };

test("the rhythms are well formed: notes on the grid, in order, the bar dividing the pattern, every stage stocked", () => {
  const ids = new Set();
  for (const r of RHYTHMS) {
    assert.ok(!ids.has(r.id), r.id + " twice"); ids.add(r.id);
    assert.ok(r.on.length >= 2 && r.on.every((s, i) => Number.isInteger(s) && s >= 0 && s < r.steps && (i === 0 || s > r.on[i - 1])), r.id);
    assert.equal(r.steps % r.bar, 0, r.id);
    assert.ok(r.name.length <= 20 && r.note.length <= 52, r.id + " fits the screen");
    for (const s of r.on) assert.ok([0, 1, 2].includes(voice(r, s)));
  }
  for (let i = 0; i < 7; i++) assert.ok(RHYTHMS.filter((r) => r.stage === i).length >= 3, "stage " + i);
  // The son clave is the son clave: 3 + 3 + 4 + 2 + 4 sixteenths.
  assert.deepEqual(byId("son32").on, [0, 6, 12, 20, 24]);
  assert.deepEqual(byId("tresillo").on, [0, 6, 12]);
  assert.equal(voice(byId("four"), 0), 0);
  assert.equal(voice(byId("four"), 4), 1);
  assert.equal(voice(byId("offbeat"), 2), 2);
});

test("stages get faster; cycles narrow the windows but never below six tenths", () => {
  for (let i = 1; i < 7; i++) assert.ok(stageSpec(i).b1 >= 92, "stage " + i);
  assert.equal(stageSpec(0).carry, 0);
  assert.ok(stageSpec(4).carry > 0);
  assert.equal(stageSpec(6).win, 1);
  assert.ok(stageSpec(7).win < 1 && stageSpec(60).win === 0.6);
  assert.ok(stageSpec(60).b1 <= 160);
});

test("a run is one groove: count-in, then call and answer back to back with no gap", () => {
  const { app } = mount();
  app.start("relay");
  assert.deepEqual(app.segs.map((s) => s.kind), ["count", "call", "answer"]);
  for (let i = 1; i < app.segs.length; i++) assert.ok(Math.abs(app.segs[i].t0 - (app.segs[i - 1].t0 + app.segs[i - 1].dur)) < 1e-9);
  assert.equal(app.segs[1].r.id, "four", "the first stage introduces its rhythms in order");
  const end = app.nextT;
  run(app, end + 0.05);
  const call = app.segs.find((s) => s.kind === "call" && s.t0 >= end - 1e-9);
  assert.ok(call && Math.abs(call.t0 - end) < 1e-9, "the next call starts as the answer ends");
});

test("the call sounds and lights its notes; a tap along with it costs nothing", () => {
  const { ctx, app } = mount();
  app.start("relay");
  const call = app.segs[1];
  run(app, call.t0 - app.rt + 0.02);
  assert.ok(ctx.calls.tone.some((t) => t[0] === 262), "the first note is the low voice");
  assert.ok(app.lampOut[0] > 0, "the low note lights the left lamp");
  tap(app);
  assert.equal(app.combo, 0);
  assert.equal(app.shields, 3);
  assert.equal(app.segs.find((s) => s.kind === "answer").extras, 0);
});

test("an answer is graded note by note; a wide tap is an extra, a note let by is a miss", () => {
  const { app } = mount();
  app.start("relay");
  const s = toAnswer(app), [a, b, c] = s.notes;
  run(app, a.t - app.rt + 0.02);
  tap(app);
  assert.equal(a.g, 0, "20 ms is PERFECT");
  assert.equal(app.fb.ms > 0, true, "late shows as late");
  run(app, b.t - app.rt - 0.08);
  tap(app);
  assert.equal(b.g, 1, "80 ms early is GOOD");
  run(app, (c.t - b.t) / 2 - 0.08);
  tap(app);
  assert.equal(s.extras, 1, "a tap between notes is an extra");
  run(app, s.t0 + s.dur - app.rt + 0.02);
  assert.ok(s.judged);
  assert.ok(s.notes.slice(2).every((n) => n.miss), "the notes let by are missed");
  assert.equal(app.shields, 3, "the first answer is the warm-up");
  assert.equal(app.segs.find((x) => x.kind === "call" && x.t0 > s.t0).r.id, s.r.id, "a lost answer is called again");
});

test("latency: with the console's calibration a late-arriving tap is judged where it was meant, and a miss waits for it", () => {
  // Every tap arrives 60 ms late. Uncalibrated, a steady player slips; calibrated, it plays as with no delay.
  const play = (latencyMs) => {
    const { app } = mount({ settings: { latencyMs } });
    app.start("relay");
    const r = new Random(5), plan = new Map();
    for (let i = 0; i < 150 * 60 && app.phase === "play"; i++) {
      for (const s of app.segs) if (s.kind === "answer") for (const n of s.notes) {
        if (!plan.has(n)) plan.set(n, { at: n.t + 0.06 + (r.next() + r.next() + r.next() - 1.5) * 0.06, done: false });
        const p = plan.get(n);
        if (!p.done && !n.done && app.rt + 1 / 120 >= p.at) { p.done = true; tap(app); }
      }
      app.update(1 / 60);
    }
    return [app.R.perfects + app.sv.st.perfects, (app.R.offSum + 0) / Math.max(1, app.R.offN), app.stage];
  };
  const [rawP, rawT] = play(0), [calP, calT] = play(60);
  assert.ok(calP > rawP * 1.5, "calibration restores the perfects: " + rawP + " -> " + calP);
  assert.ok(rawT > 40 && Math.abs(calT) < 20, "timing reads late uncalibrated, centred calibrated: " + rawT + " / " + calT);
  assert.equal(latency({ settings: () => ({ latencyMs: "x" }) }), 0);
  assert.equal(latency({ settings: () => ({ latencyMs: 900 }) }), 0.3);
  assert.equal(latency({}), 0);
});

test("resuming mid-run counts in four beats and calls the interrupted rhythm again, unjudged", () => {
  const { app } = mount();
  app.start("relay");
  const s = toAnswer(app);
  run(app, 0.3);
  const shields = app.shields, id = s.r.id;
  app.pause(); app.resume();
  assert.ok(!app.segs.includes(s), "the interrupted answer is dropped");
  run(app, 0.4);
  assert.deepEqual(app.segs.map((x) => x.kind).slice(0, 2), ["count", "call"]);
  assert.equal(app.segs[1].r.id, id);
  assert.equal(app.shields, shields);
  assert.equal(app.combo, 0);
});

test("scores stay in proportion: the multiplier tops out at x4", () => {
  const { app } = mount();
  app.start("relay");
  bot(app, 6, 0.01, 120);
  assert.ok(app.R.maxMult <= 4 && app.R.maxMult === 4);
  assert.ok(app.score < 120000, "two minutes of near-perfect play: " + app.score);
});

test("a clean answer scores a bonus and goes in the songbook; a lost one costs a shield and repeats", () => {
  const { app } = mount();
  app.start("relay");
  bot(app, 3, 0.01, 30);
  assert.ok(app.R.clean >= 3);
  assert.equal(app.sv.book.four, 1);
  assert.ok(app.newLearned.includes("four"));
  assert.ok(app.score > 1000);
  // Now let one go by.
  while (app.seg()?.kind !== "call") app.update(1 / 60);
  const s = toAnswer(app);
  assert.ok(s.notes.every((n) => !n.done));
  run(app, s.t0 + s.dur - app.rt + 0.02);
  assert.equal(app.shields, 2);
  assert.equal(app.combo, 0);
  run(app, 0.1);
  const next = app.segs.find((x) => x.kind === "call" && x.t0 >= s.t0);
  assert.equal(next.r.id, s.r.id, "the rhythm is called again");
});

test("a learned rhythm is answered by heart: its notation is hidden in the answer from stage III", () => {
  const { app } = mount();
  app.sv.book.tresillo = LEARNED;
  app.start("relay");
  app.stage = 2; app.rounds = 3; app.introduced = ["habanera", "charleston", "cinquillo"]; app.lastId = "habanera";
  app.repeat = byId("tresillo");
  app.segs = []; app.nextT = app.rt;
  app.startRound();
  assert.equal(app.segs.find((s) => s.kind === "answer").show, false);
  app.repeat = byId("habanera"); app.lastId = "";
  app.startRound();
  assert.equal(app.segs.filter((s) => s.kind === "answer").at(-1).show, true, "a new rhythm keeps its notation");
});

test("a steady player goes far and outscores a sloppy one; an idle run ends; nothing is NaN", () => {
  const far = [], sloppy = [];
  const g = fakeCanvas();
  for (const seed of [1, 2, 3]) {
    const a = mount({ seed }).app; a.start("relay"); bot(a, seed, 0.03, 240, g); far.push([a.stage, a.score]); numbers(a.R);
    const b = mount({ seed }).app; b.start("relay"); bot(b, seed, 0.11, 240); sloppy.push([b.stage, b.score, b.phase]);
  }
  assert.ok(far.every(([st]) => st >= 6), "steady reaches the late stages: " + JSON.stringify(far));
  assert.ok(sloppy.every(([st, sc, ph]) => ph === "over" && st < 6), "sloppy loses early: " + JSON.stringify(sloppy));
  assert.ok(Math.min(...far.map((x) => x[1])) > Math.max(...sloppy.map((x) => x[1])) * 3);
  const idle = mount().app;
  idle.start("relay");
  run(idle, 60);
  assert.equal(idle.phase, "over");
});

test("carry: from the waltz on, some answers come twice, the second from memory", () => {
  const { app } = mount();
  app.start("relay");
  app.stage = 4; app.rounds = 5;
  let carried = 0;
  for (let i = 0; i < 40; i++) {
    app.segs = []; app.nextT = app.rt;
    app.startRound();
    const ans = app.segs.filter((s) => s.kind === "answer");
    if (ans.length === 2) { carried++; assert.ok(ans[1].carry && !ans[1].show); }
  }
  assert.ok(carried > 4 && carried < 25, "about a third: " + carried);
});

test("the lamps carry the call: nine whole numbers, dark after cancel() and dispose()", () => {
  const { ctx, app } = mount();
  app.start("relay");
  run(app, 6);
  const sent = ctx.calls.leds;
  assert.ok(sent.length > 6);
  for (const v of sent) assert.ok(v.length === 9 && v.every((x) => Number.isInteger(x) && x >= 0 && x <= 255));
  app.cancel();
  assert.deepEqual(sent.at(-1), Array(9).fill(0));
  app.dispose();
  assert.deepEqual(sent.at(-1), Array(9).fill(0));
});

test("the songbook: a hold opens it, taps move, locked modes refuse, feats unlock accelerando", () => {
  const { app } = mount();
  hold(app);
  assert.equal(app.phase, "menu");
  const pick = (name) => { while (["RELAY", "DAILY", "STUDIO", "ACCEL", "KIT", "BOOK", "FEATS", "LOG"][app.cur] !== name) tap(app); hold(app); };
  pick("ACCEL");
  assert.equal(app.phase, "menu", "accelerando is locked without feats");
  pick("BOOK");
  assert.equal(app.view, "book");
  tap(app); assert.equal(app.page, 1);
  hold(app);
  assert.equal(app.view, "menu");
  app.sv.ft = ["first", "pocket", "sync", "clave"];
  pick("KIT");
  assert.equal(app.kit().name, "BELL");
  pick("ACCEL");
  assert.equal(app.phase, "play");
  assert.equal(app.mode, "accel");
  const b0 = app.bpm;
  bot(app, 4, 0.01, 40);
  assert.ok(app.bpm > b0 + 6, "accelerando speeds up each round");
});

test("studio: no shields, no score, ten rounds of rhythms not yet mastered, and it fills the book", () => {
  const { ctx, app } = mount();
  app.sv.book = { four: MASTERED, half: MASTERED };
  app.start("studio");
  run(app, 300);
  assert.equal(app.phase, "over");
  assert.equal(app.shields, 3);
  assert.equal(app.score, 0);
  assert.equal(ctx.calls.score.length, 0);
  const s = mount().app;
  s.sv.book = { four: MASTERED, half: MASTERED };
  s.start("studio");
  const seen = new Set();
  for (let i = 0; i < 30; i++) { s.segs = []; s.nextT = s.rt; s.startRound(); seen.add(s.segs.find((x) => x.kind === "call").r.id); }
  assert.ok(!seen.has("four") && !seen.has("half"), "mastered rhythms rest");
  const t = mount().app;
  t.start("studio");
  bot(t, 2, 0.01, 300);
  assert.ok(Object.values(t.sv.book).some((n) => n >= LEARNED));
});

test("only the plain run writes the console score", () => {
  const { ctx, app } = mount();
  app.start("relay");
  run(app, 60);
  assert.equal(app.phase, "over");
  assert.equal(ctx.calls.score.length, 1);
  app.sv.ft = ["first", "pocket", "sync", "clave"];
  app.start("accel");
  run(app, 60);
  assert.equal(ctx.calls.score.length, 1);
  tap(app); run(app, 1); tap(app);
  assert.equal(app.mode, "accel", "a tap on the result plays the same mode again");
});

test("the daily run is the same for everyone on the day and keeps a streak", () => {
  const a = mount({ seed: 1 }).app, b = mount({ seed: 99 }).app;
  const shape = (app) => { const out = []; for (let i = 0; i < 30; i++) { app.segs = []; app.nextT = app.rt; app.startRound(); out.push(app.segs.map((s) => s.kind + s.r.id).join()); } return out.join("|"); };
  for (const app of [a, b]) { app.dayKey = () => "2026-10-02"; app.start("daily"); app.stage = 7; }
  assert.equal(shape(a), shape(b));
  assert.ok(dailyGoal("2026-10-02").text.length > 5);
  const { app } = mount();
  app.dayKey = () => "2026-10-02";
  app.sv.dl = { d: "2026-10-01", best: 10, done: 1, streak: 3, last: "2026-10-01" };
  app.start("daily");
  app.goalMet = () => true;
  app.finish();
  assert.deepEqual([app.sv.dl.d, app.sv.dl.done, app.sv.dl.streak, app.sv.dl.last], ["2026-10-02", 1, 4, "2026-10-02"]);
  assert.ok(app.sv.ft.includes("daily"));
});

test("save schema 1: anything stored loads, a saved game round-trips, unknown feats and rhythms are dropped", () => {
  for (const raw of [undefined, null, 7, "x", [], { schema: 1, runs: 2, last: { score: 5 } }, { st: "no", best: [], ft: "first", book: [] }, { book: { four: -3, nope: 4, half: 1e9 } }]) {
    const s = migrateSave(raw);
    assert.equal(s.schema, 1);
    numbers(s);
    assert.ok(Array.isArray(s.ft));
    for (const [id, n] of Object.entries(s.book)) assert.ok(byId(id) && n >= 0 && n <= 999);
  }
  assert.deepEqual(migrateSave({ book: { four: -3, nope: 4, half: 1e9 } }).book, { four: 0, half: 999 });
  const { ctx, app } = mount();
  tap(app);
  bot(app, 1, 0.03, 60);
  app.shields = 1;
  const s = toAnswer(app);
  run(app, s.t0 + s.dur - app.rt + 0.05);
  run(app, 2);
  const saved = ctx.calls.saved.at(-1);
  assert.ok(saved && saved.schema === 1 && saved.runs === 1);
  assert.ok(Object.keys(saved.book).length >= 4);
  assert.ok(JSON.stringify(saved).length < 4096);
  assert.deepEqual(migrateSave(JSON.parse(JSON.stringify(saved))), saved);
  const again = new Relay(appContext({ progress: { ...saved, ft: [...saved.ft, "bogus", saved.ft[0]] } }));
  assert.deepEqual(again.sv.ft, saved.ft);
  assert.deepEqual(again.sv.book, saved.book);
});

test("every screen draws without throwing", () => {
  const { app } = mount();
  const g = fakeCanvas();
  app.draw(g);
  hold(app); app.draw(g);
  for (let i = 0; i < 9; i++) { tap(app); app.draw(g); }
  app.view = "book"; app.sv.book = { four: 1, son32: 5, five: 0 };
  for (let p = 0; p < 4; p++) { app.page = p; app.draw(g); }
  app.view = "log"; app.draw(g);
  app.start("relay");
  bot(app, 2, 0.04, 30, g);
  app.stage = 7;
  run(app, 30, () => app.draw(g));
  run(app, 2); app.draw(g);
  assert.ok(g.count.fillText > 50);
  assert.ok(Object.keys(MODES).length === 4 && WIN[0] < WIN[1]);
});
