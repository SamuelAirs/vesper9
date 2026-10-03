import test from "node:test";
import assert from "node:assert/strict";
import { Twinbeat, LEVELS, makeChart, judgeNote, gradeRun, sanitizeTwinbeat, unlockedLevel, HIT_WINDOW, CENTER_WINDOW, MIN_NOTE_GAP } from "../web/apps/twinbeat.js";
import { appContext, fakeCanvas } from "./helpers/app-context.mjs";
import { InputRouter } from "../web/engine/input.js";

const DT = 1 / 60;
function mount(options = {}) { const ctx = appContext({ lampCount: 4, boardLed: true, ...options }); return { ctx, app: new Twinbeat(ctx) }; }
function stepTo(app, time) { for (let n = 0; app.songTime < time - 1e-8 && n < 10000; n++) app.update(Math.min(DT, time - app.songTime)); }
function play(app, { kind = "sides", source = "keyboard", delay = 0 } = {}) {
  for (const [i, note] of app.chart.notes.entries()) {
    stepTo(app, note.at + delay);
    if (kind === "button") { app.down({ source, at_us: 10 ** 12 + i * 700000 }); app.up({ durationMs: 25 }); }
    else app.knock({ source, at_us: 10 ** 12 + i * 700000, generation: 9, ...(kind === "sides" ? { side: note.side } : {}) });
  }
  for (let n = 0; app.phase === "play" && n < 500; n++) app.update(DT);
  assert.equal(app.phase, "result");
}

test("eight original charts are deterministic, bounded, two-lane and acoustically spaced", () => {
  assert.equal(LEVELS.length, 8);
  for (let i = 0; i < LEVELS.length; i++) {
    const chart = makeChart(i);
    assert.deepEqual(chart, makeChart(i));
    assert.ok(chart.notes.length >= 16 && chart.notes.length <= 64);
    assert.ok(chart.length >= 10 && chart.length <= 52);
    assert.ok(chart.notes.some((n) => n.side === "left") && chart.notes.some((n) => n.side === "right"));
    assert.equal(chart.notes[0].at, 0);
    for (let j = 1; j < chart.notes.length; j++) {
      assert.ok(chart.notes[j].at - chart.notes[j - 1].at >= MIN_NOTE_GAP - 1e-9, `level ${i + 1}, note ${j}`);
      assert.ok(chart.notes[j].at - chart.notes[j - 1].at > 2 * HIT_WINDOW);
    }
    assert.ok(chart.notes.every((n) => n.at < chart.length && typeof n.accent === "boolean"));
  }
});

test("timing boundaries are inclusive, centered separately, and never claim another lane", () => {
  const notes = [{ at: 1, side: "left" }, { at: 1.4, side: "right" }], unresolved = [null, null];
  for (const error of [-HIT_WINDOW, HIT_WINDOW]) assert.equal(judgeNote(notes, unresolved, 1 + error, "left", "sides").kind, "close");
  for (const error of [-CENTER_WINDOW, CENTER_WINDOW, 0]) assert.equal(judgeNote(notes, unresolved, 1 + error, "left", "sides").kind, "center");
  for (const error of [-HIT_WINDOW - 0.0001, HIT_WINDOW + 0.0001]) assert.equal(judgeNote(notes, unresolved, 1 + error, "left", "sides").kind, "empty");
  assert.deepEqual(judgeNote(notes, unresolved, 1.17, "right", "sides"), { kind: "wrong", index: 0 });
  assert.equal(judgeNote(notes, unresolved, NaN, "left", "sides").kind, "ignore");
});

test("generic/back/missing sides stay unsure; assist explicitly accepts them", () => {
  for (const side of [undefined, "back", "top", "unknown", null]) {
    const notes = [{ at: 0, side: "left" }];
    assert.equal(judgeNote(notes, [null], 0, side, "sides").kind, "unsure");
    assert.equal(judgeNote(notes, [null], 0, side, "assist").kind, "center");
  }
});

test("one event earns at most one note and a claimed note cannot be claimed twice", () => {
  const { app } = mount({ settings: { tapMode: "sides" } }); app.start(); stepTo(app, 0);
  const event = { source: "keyboard", side: "left", at_us: 99999999999 };
  app.knock(event); app.knock(event);
  assert.equal(app.stats.hits, 1); assert.equal(app.stats.points, 100); assert.equal(app.stats.faults, 0);
  app.update(0.16); app.knock(event); // a delayed transport duplicate
  assert.equal(app.stats.hits, 1); assert.equal(app.stats.faults, 0);
  assert.equal(app.judgements.filter(Boolean).length, 1);
});

test("input refractory rejects ringing but permits every chart note", () => {
  const { app } = mount(); app.start(); stepTo(app, 0);
  app.knock({ source: "keyboard", at_us: 1 }); app.update(0.1); app.knock({ source: "keyboard", at_us: 2 });
  assert.equal(app.stats.hits, 1); assert.equal(app.stats.faults, 0);
  app.update(0.06); app.knock({ source: "keyboard", at_us: 3 });
  assert.equal(app.stats.hits, 1); assert.equal(app.stats.faults, 1);
});

test("wrong side and unsure cannot credit a note; a later correct retry remains possible", () => {
  const { app } = mount({ settings: { tapMode: "sides" } }); app.start(); stepTo(app, -0.18);
  app.knock({ source: "keyboard", side: "right" });
  assert.equal(app.stats.hits, 0); assert.equal(app.stats.faults, 1); assert.equal(app.judgements[0], null);
  stepTo(app, -0.01); app.knock({ source: "keyboard", side: "left" });
  assert.equal(app.stats.hits, 1); assert.equal(app.judgements[0], "center");
  stepTo(app, app.chart.notes[1].at); app.knock({ source: "keyboard" });
  assert.equal(app.stats.hits, 1); assert.equal(app.judgements[1], null); assert.match(app.feedback, /SIDE UNSURE/);
});

test("first note has the full early window after the count-in", () => {
  const { app } = mount(); app.start(); stepTo(app, -0.18);
  app.knock({ source: "keyboard" }); assert.equal(app.judgements[0], "close");
});

test("node case delay is provisional arrival correction, not an absolute node clock", () => {
  for (const delay of [0.09, 0.1, 0.13]) {
    const { app } = mount({ settings: { tapMode: "sides", latencyMs: 300 } });
    app.start(); stepTo(app, delay);
    app.knock({ source: "node", generation: 7, at_us: 987654321000, side: "left" });
    assert.equal(app.judgements[0], "center", `delay ${delay}`);
  }
});

test("corrected late acoustic arrival remains playable before retirement", () => {
  const { app } = mount({ settings: { tapMode: "sides" } }); app.start(); stepTo(app, 0.25);
  assert.equal(app.judgements[0], null);
  app.knock({ source: "node", at_us: 10 ** 13, side: "left" });
  assert.equal(app.judgements[0], "close");
  const missed = mount().app; missed.start(); stepTo(missed, 0.281);
  assert.equal(missed.judgements[0], "miss"); assert.equal(missed.stats.misses, 1);
  missed.update(0.1); assert.equal(missed.stats.misses, 1);
});

test("keyboard/simulator cases use no acoustic correction and buttons use console offset", () => {
  for (const source of ["keyboard", "simulator"]) {
    const { app } = mount({ settings: { latencyMs: 300 } }); app.start(); stepTo(app, 0);
    app.knock({ source }); assert.equal(app.judgements[0], "center");
  }
  for (const offset of [-150, 0, 300]) {
    const { app } = mount({ settings: { latencyMs: offset } }); app.start();
    stepTo(app, app.chart.notes[1].at + offset / 1000);
    app.down({ source: "node", at_us: 100000000 }); app.up({ durationMs: 20 });
    assert.equal(app.judgements[1], "center");
  }
});

test("fresh globally enabled side mode starts two-side; explicit assist choice survives reload", () => {
  const { app } = mount({ settings: { tapMode: "sides" } }); assert.equal(app.mode, "sides");
  const selected = mount({ settings: { tapMode: "sides" }, progress: { mode: "assist" } }).app; assert.equal(selected.mode, "assist");
});

test("hardware side mode requires ready status and never changes global settings", () => {
  for (const state of [null, { ready: false }, { ready: true, available: false }, { ready: true, enabled: false }]) {
    const ctx = appContext({ settings: { tapMode: "sides" }, state: { tapDirection: state } }); ctx.simulated = () => false;
    const app = new Twinbeat(ctx); assert.equal(app.mode, "assist"); app.cycleMode();
    assert.equal(app.mode, "assist"); assert.match(app.message, /Calibration > Tap direction/); assert.equal(ctx.calls.command.length, 0);
  }
  const ctx = appContext({ settings: { tapMode: "sides" }, state: { tapDirection: { ready: true, enabled: true, available: true } } }); ctx.simulated = () => false;
  assert.equal(new Twinbeat(ctx).mode, "sides");
});

test("changing global side mode interrupts the run without guessing or saving", () => {
  const { app, ctx } = mount({ settings: { tapMode: "sides" } }); app.start(); stepTo(app, 0);
  ctx.settings().tapMode = "generic"; app.update(DT);
  assert.equal(app.phase, "home"); assert.match(app.message, /input changed/);
  assert.equal(ctx.calls.saved.length, 0); assert.equal(ctx.calls.score.length, 0);
  assert.ok(ctx.calls.leds.at(-1).every((v) => v === 0));
});

for (const mode of ["sides", "assist", "button"]) test(`${mode}: every campaign chart can be cleared through actual input, then reload retains unlocks`, () => {
  const { app, ctx } = mount({ settings: { tapMode: mode === "sides" ? "sides" : "generic" } });
  const career = mode === "sides" ? "sides" : "assist";
  assert.equal(app.start(1), false);
  for (let level = 0; level < LEVELS.length; level++) {
    assert.equal(app.start(level), true); play(app, { kind: mode });
    assert.equal(app.result.accuracy, 100); assert.equal(app.result.score, 10000); assert.equal(app.result.medal, 3);
    assert.equal(app.stats.hits, app.chart.notes.length);
    assert.equal(app.save.careers[career][level].cleared, true);
    assert.equal(unlockedLevel(app.save, career), Math.min(7, level + 1));
    app.update(0.5); // release AppGuard's last short-button possible gesture
  }
  assert.equal(ctx.calls.score.length, 8); assert.ok(ctx.calls.score.every(([, metric]) => metric === career));
  assert.equal(app.save.careers[career === "sides" ? "assist" : "sides"].filter((e) => e.cleared).length, 0);
  assert.equal(sanitizeTwinbeat(ctx.calls.saved.at(-1)).careers[career][7].cleared, true);
  assert.ok(new TextEncoder().encode(JSON.stringify(app.save)).length < 8192);
});

test("all native node charts are reachable with100ms detection delay including400ms gaps", () => {
  const { app } = mount({ settings: { tapMode: "sides" } });
  for (let level = 0; level < LEVELS.length; level++) {
    app.start(level); play(app, { kind: "sides", source: "node", delay: 0.1 });
    assert.equal(app.result.accuracy, 100); assert.equal(app.result.medal, 3);
  }
});

test("practice opens locked levels and cannot farm scores, runs, saves or career clears", () => {
  const { app, ctx } = mount(); const before = structuredClone(app.save);
  for (let i = 0; i < LEVELS.length; i++) { assert.equal(app.start(i, true), true); play(app, { kind: "assist" }); }
  app.pause(); app.dispose(); assert.deepEqual(app.save, before);
  assert.equal(ctx.calls.saved.length, 0); assert.equal(ctx.calls.score.length, 0);
});

test("medals and fault penalty reward skill; missed or wrong-input spamming cannot clear", () => {
  const base = { hits: 10, center: 8, points: 940, faults: 0 };
  assert.deepEqual(gradeRun(base, 10), { accuracy: 100, score: 9400, medal: 3, cleared: true });
  assert.equal(gradeRun({ ...base, hits: 9, center: 5 }, 10).medal, 2);
  assert.equal(gradeRun({ ...base, hits: 8, center: 0 }, 10).medal, 1);
  assert.equal(gradeRun({ ...base, hits: 7 }, 10).cleared, false);
  assert.equal(gradeRun({ ...base, faults: 10 }, 10).cleared, false);
  assert.ok(gradeRun({ ...base, faults: 1 }, 10).score < gradeRun(base, 10).score);
});

test("malformed/oversized persistence has fixed shape, bounded values and no detached unlocks", () => {
  for (const raw of [null, false, [], "bad", { careers: { assist: {}, sides: [null] }, runs: Infinity }]) {
    const save = sanitizeTwinbeat(raw); assert.equal(save.runs, 0); assert.equal(unlockedLevel(save, "sides"), 0); assert.equal(save.caseOffsetMs, 100);
  }
  const raw = { careers: { sides: Array(100).fill({ cleared: true, accuracy: 100, best: 10000, medal: 3, runs: 1 }), assist: [{ cleared: false, accuracy: 100 }, { cleared: true, accuracy: 100, medal: 3 }] }, caseOffsetMs: -1, last: { reason: "<script>", level: 999, score: Infinity } };
  const save = sanitizeTwinbeat(raw); assert.equal(save.careers.sides.length, 8); assert.equal(save.careers.assist[1].cleared, false); assert.equal(save.last.reason, "retry");
  assert.equal(save.last.level, 0); assert.equal(save.last.score, 0); assert.equal(save.caseOffsetMs, 100);
  assert.deepEqual(sanitizeTwinbeat(save), save);
});

test("pause/cancel/dispose clear both lamp pairs and board; pause/resume freezes pending notes", () => {
  const { app, ctx } = mount(); app.start(); stepTo(app, 0); app.knock({ source: "keyboard" });
  assert.ok(ctx.calls.leds.some((values) => values.some((v) => v > 0)));
  app.cancel(); assert.ok(ctx.calls.leds.at(-1).every((v) => v === 0)); assert.deepEqual(ctx.calls.board.at(-1), [0, 0, 0]);
  const time = app.songTime, stats = structuredClone(app.stats); app.pause(); app.update(10); assert.equal(app.songTime, time);
  app.resume(); const resume = app.output.resumeLeft; app.knock({ source: "keyboard" }); app.update(resume / 2);
  assert.equal(app.songTime, time); assert.deepEqual(app.stats, stats);
  app.update(resume / 2); assert.equal(app.songTime, time); app.update(DT); assert.ok(app.songTime > time);
  app.dispose(); const calls = ctx.calls.leds.length; app.update(2); app.down(); app.knock();
  assert.equal(ctx.calls.leds.length, calls); assert.ok(ctx.calls.leds.at(-1).every((v) => v === 0)); assert.deepEqual(ctx.calls.board.at(-1), [0, 0, 0]);
});

test("four lamps divide into cyan left and amber right pairs; three-lamp fallback stays bounded", () => {
  for (const count of [3, 4]) {
    const { app, ctx } = mount({ lampCount: count }); app.start(); stepTo(app, 0);
    app.output.cue("left", true); app.output.frame(0);
    const left = ctx.calls.leds.at(-1); assert.equal(left.length, count * 3); assert.ok(left.slice(0, 3).some((v) => v > 0));
    if (count === 4) assert.deepEqual(left.slice(0, 3), left.slice(3, 6));
    app.output.clear(); app.output.cue("right"); app.output.frame(0);
    const right = ctx.calls.leds.at(-1); assert.ok(right.slice(-3).some((v) => v > 0));
    if (count === 4) assert.deepEqual(right.slice(6, 9), right.slice(9, 12));
    assert.ok(right.every((v) => Number.isInteger(v) && v >= 0 && v <= 255));
  }
});

test("original synth stays above low-tone suppression with finite short envelopes and no stale burst", () => {
  const { app, ctx } = mount(); app.start(); play(app, { kind: "assist" });
  assert.ok(ctx.calls.tone.length > 20);
  for (const [hz, seconds, , gain] of ctx.calls.tone) { assert.ok(hz >= 196); assert.ok(seconds > 0 && seconds <= 0.055); assert.ok(gain > 0 && gain <= 0.45); }
  app.start(); const before = ctx.calls.tone.length; app.update(10); assert.ok(ctx.calls.tone.length - before <= 2);
});

test("button holds are immediate assist strikes with consumed release, never repeating", () => {
  const { app } = mount(); app.start(); stepTo(app, 0); app.down({ source: "keyboard" });
  assert.equal(app.stats.hits, 1); app.update(1.2); app.down({ repeat: true }); app.up({ durationMs: 1200 });
  assert.equal(app.stats.hits, 1); assert.equal(app.phase, "play");
  const side = mount({ settings: { tapMode: "sides" } }).app; side.start(); stepTo(side, 0); side.down(); side.up({ durationMs: 20 });
  assert.equal(side.stats.hits, 0); assert.equal(side.stats.faults, 0); assert.match(side.feedback, /ASSIST/);
});

test("a gesture crossing finish rewinds chart, stats, career and deferred scores", () => {
  const { app, ctx } = mount(); app.start(); stepTo(app, app.chart.length - 0.1);
  const before = { songTime: app.songTime, phase: app.phase, stats: structuredClone(app.stats), save: structuredClone(app.save), judgements: app.judgements.slice() };
  for (let i = 0; i < 2; i++) { app.down(); app.update(0.05); app.up({ durationMs: 50 }); app.update(0.05); }
  app.down(); for (let i = 0; i < 100; i++) app.update(DT);
  assert.equal(app.phase, "result"); assert.equal(ctx.calls.saved.length, 0); assert.equal(ctx.calls.score.length, 0);
  ctx.cancelGesture = () => true; app.cancel(); app.pause();
  assert.equal(app.songTime, before.songTime); assert.equal(app.phase, before.phase); assert.deepEqual(app.stats, before.stats); assert.deepEqual(app.save, before.save); assert.deepEqual(app.judgements, before.judgements);
  assert.equal(ctx.calls.saved.length, 0); assert.equal(ctx.calls.score.length, 0);
});

for (const [pace, tap, gap] of [["quick", 60, 40], ["standard", 67, 50], ["relaxed", 150, 250]]) {
  for (const nearEnd of [false, true]) test(`${pace} real router gesture during ${nearEnd ? "finishing" : "active"} chart rewinds without saves`, () => {
    const { app, ctx } = mount({ settings: { gesturePace: pace } }); app.start();
    stepTo(app, nearEnd ? app.chart.length - 0.1 : 0.8);
    let now = 0, open = false, cancelling = false;
    ctx.cancelGesture = () => cancelling;
    const host = {
      epoch: 0, inputMode: () => open ? "menu" : "raw", holdMs: () => 650, escapePolicy: () => ({ pace }),
      pressVisual() {}, holdVisual() {}, clickVisual() {}, advance() {}, select() {},
      rawDown: (e) => app.down(e), rawUp: (e) => app.up(e), rawCancel: () => app.cancel(),
      requestMenu() { cancelling = true; router.cancel(true, "node"); cancelling = false; open = true; app.pause(); },
    };
    const router = new InputRouter(host, () => now);
    const edge = (method) => router[method]({ source: "node", generation: 19, at_us: now * 1000 });
    const advance = (ms) => { for (let n = 0; n < Math.ceil(ms / (1000 / 60)); n++) { now += 1000 / 60; router.update(); if (!open) app.update(DT); } };
    const picture = () => { const state = app.guard.snapshot().saved; delete state.held; delete state.hold; return state; };
    const before = picture();
    for (let i = 0; i < 2; i++) { edge("down"); advance(tap); edge("up"); advance(gap); }
    edge("down"); advance(2500);
    assert.equal(open, true); assert.deepEqual(picture(), before);
    assert.equal(ctx.calls.saved.length, 0); assert.equal(ctx.calls.score.length, 0);
    edge("up"); assert.deepEqual(picture(), before, "the terminal release was consumed");
    app.resume(); assert.deepEqual(picture(), before); assert.ok(app.output.resumeLeft > 0);
  });
}

test("system menu actions close through host resume and restart supplies only the fresh count-in", () => {
  const { app, ctx } = mount(); let resumed = 0; ctx.resume = () => { resumed++; app.resume(); };
  app.start(); stepTo(app, 1); app.pause(); app.menuActions()[1].run();
  assert.equal(resumed, 1); assert.equal(app.phase, "play"); assert.equal(app.songTime, -4 * app.chart.period); assert.equal(app.output.resumeLeft, 0);
  app.pause(); app.menuActions()[0].run(); assert.equal(resumed, 2); assert.equal(app.phase, "home"); assert.equal(app.output.live, true);
});

test("all canvas screens and manual pages draw in logical coordinates", () => {
  const { app } = mount(); const canvas = fakeCanvas();
  app.draw(canvas); app.go("songs"); app.draw(canvas); app.practice = true; app.draw(canvas); app.go("guide"); app.draw(canvas); app.guidePage = 1; app.draw(canvas);
  app.start(); app.draw(canvas); stepTo(app, 0); app.draw(canvas); app.pause(); app.resume(); app.draw(canvas); app.output.resumeLeft = 0; play(app, { kind: "assist" }); app.draw(canvas);
  assert.ok(canvas.count.fillText > 50); assert.equal(canvas.count.save, canvas.count.restore);
});
