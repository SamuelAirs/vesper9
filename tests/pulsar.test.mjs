import test from "node:test";
import assert from "node:assert/strict";
import { Pulsar } from "../web/apps/pulsar.js";
import { appContext, fakeCanvas, run } from "./helpers/app-context.mjs";

const OFFSET = Pulsar.INPUT_OFFSET;
const lampsOk = (ctx) => ctx.calls.leds.every((v) => v.length === 9 && v.every((x) => Number.isInteger(x) && x >= 0 && x <= 255));
const dark = (v) => v.every((x) => x === 0);

// A bot that reads the chart. `skill` is the chance it attempts a beat,
// `jitter` the spread of its timing in seconds (uniform, deterministic).
function play(app, seconds, { skill = 1, jitter = 0.04, seed = 7 } = {}) {
  let s = seed >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  let pressing = false, plan = null, release = 0;
  app.down();
  let steps = 0;
  run(app, seconds, () => {
    steps++;
    if (app.phase !== "play") return;
    if (pressing) {
      if (app.song - OFFSET >= release) { app.up(); pressing = false; }
      return;
    }
    if (!plan || plan.state !== "pending") {
      plan = app.notes.find((n) => n.state === "pending" && !n.bot) || null;
      if (plan) { plan.bot = true; plan.aim = plan.t + OFFSET + (rnd() * 2 - 1) * jitter; plan.go = rnd() < skill; }
    }
    if (plan && plan.go && app.song >= plan.aim) {
      app.down();
      pressing = true;
      release = plan.t + plan.len - 0.05 + (plan.len > 0 ? 0.05 : 0);
      if (plan.len === 0) release = app.song - OFFSET + 0.06;
      plan = null;
    }
  });
}

test("a seeded bot beats an idle player by a wide margin", () => {
  const bot = new Pulsar(appContext({ seed: 11 }));
  play(bot, 170);
  const idle = new Pulsar(appContext({ seed: 11 }));
  idle.down();
  run(idle, 240);
  assert.equal(idle.phase, "over");
  assert.ok(!idle.cleared);
  assert.ok(idle.song >= 17, "an idle newcomer lasts past the count-in and then some: " + idle.song);
  assert.ok(idle.score <= 0 || bot.score > idle.score * 20 + 1000, `bot ${bot.score} idle ${idle.score}`);
  assert.equal(bot.phase, "over", "the song has an end");
  assert.ok(bot.cleared, "competent bot resolves the signal");
  assert.equal(bot.phraseNo + 1, Pulsar.FINALE);
  assert.ok(bot.maxCombo > 100, "combo " + bot.maxCombo);
  assert.ok(bot.accuracy > 0.9, "accuracy " + bot.accuracy);
  console.log(`bot: score ${bot.score} combo ${bot.maxCombo} acc ${(bot.accuracy * 100).toFixed(1)}% phrase ${bot.phraseNo + 1} stab ${bot.stab.toFixed(2)}`);
  console.log(`idle: ended with score ${idle.score} at song ${idle.song.toFixed(1)}s, phrase ${idle.phraseNo + 1}`);
});

test("sloppy and missing players behave sensibly", () => {
  const sloppy = new Pulsar(appContext({ seed: 11 }));
  play(sloppy, 240, { skill: 0.85, jitter: 0.13, seed: 3 });
  const poor = new Pulsar(appContext({ seed: 11 }));
  play(poor, 240, { skill: 0.5, jitter: 0.1, seed: 5 });
  console.log(`sloppy (85% attempts, +-130ms): phase ${sloppy.phase} score ${sloppy.score} acc ${(sloppy.accuracy * 100).toFixed(0)}% phrase ${sloppy.phraseNo + 1}`);
  console.log(`poor (50% attempts): phase ${poor.phase} score ${poor.score} phrase ${poor.phraseNo + 1}`);
  assert.equal(poor.phase, "over");
  assert.ok(sloppy.score > poor.score);
});

test("the run ends in a loss, saves the score, and restarts after a pause", () => {
  const ctx = appContext({ seed: 5 });
  const app = new Pulsar(ctx);
  app.down();
  for (let i = 0; i < 120 * 60 && app.phase === "play"; i++) app.update(1 / 60);
  assert.equal(app.phase, "over");
  assert.equal(ctx.calls.score.length, 1);
  assert.equal(ctx.calls.saved.length, 1);
  assert.deepEqual(Object.keys(ctx.calls.saved[0].last).sort(), ["accuracy", "combo", "milestone", "phrases", "score"]);
  app.down(); // too soon after the end: ignored
  assert.equal(app.phase, "over");
  run(app, 1);
  app.down();
  assert.equal(app.phase, "play");
  app.draw(fakeCanvas());
});

test("the same seed gives the same chart; another seed differs", () => {
  const chart = (seed) => {
    const app = new Pulsar(appContext({ seed }));
    app.down();
    run(app, 60, () => app.notes.forEach((n) => { if (n.state === "pending") n.state = "done"; }));
    return app.notes.map((n) => [n.t.toFixed(3), n.lane, n.len.toFixed(3)].join()).join("|") + app.genEnd;
  };
  assert.equal(chart(3), chart(3));
  assert.notEqual(chart(3), chart(4));
});

test("difficulty rises: sparse quarters first, then off-beats, holds, faster tempos", () => {
  const app = new Pulsar(appContext({ seed: 9 }));
  app.down();
  // Generate 12 phrases and inspect them without playing.
  while (app.genIndex < 12) app.generate();
  const byPhrase = [];
  for (const p of app.phrases) {
    const inside = app.notes.filter((n) => n.t >= p.start && n.t < p.end);
    const slot = 30 / p.bpm;
    byPhrase[p.index] = {
      bpm: p.bpm,
      off: inside.filter((n) => Math.round((n.t - p.start) / slot) % 2 === 1).length,
      holds: inside.filter((n) => n.len > 0).length,
      count: inside.length,
    };
  }
  assert.equal(byPhrase[0].bpm, 80);
  assert.equal(byPhrase[0].off + byPhrase[1].off, 0);
  assert.equal(byPhrase[0].holds + byPhrase[1].holds + byPhrase[2].holds + byPhrase[3].holds, 0);
  assert.ok(byPhrase.slice(2, 6).some((p) => p.off > 0));
  assert.ok(byPhrase.slice(4, 12).some((p) => p.holds > 0));
  assert.ok(byPhrase[11].bpm > byPhrase[0].bpm + 25);
  // No two notes overlap or crowd: a hold's tail is clear before the next head.
  const sorted = app.notes.slice().sort((a, b) => a.t - b.t);
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i].t >= sorted[i - 1].t + sorted[i - 1].len + 0.1, "note " + i);
  for (const n of sorted) assert.ok([0, 1, 2].includes(n.lane));
});

test("no NaN, bounded lists, valid lamps that change, safe drawing", () => {
  const ctx = appContext({ seed: 21 });
  const app = new Pulsar(ctx);
  const g = fakeCanvas();
  app.draw(g);
  play(app, 150, { skill: 0.9, jitter: 0.08 });
  let maxNotes = 0;
  for (let i = 0; i < 20; i++) { run(app, 5); maxNotes = Math.max(maxNotes, app.notes.length, app.beats.length, app.phrases.length); app.draw(g); }
  for (const key of ["song", "score", "combo", "maxCombo", "stab", "accuracy", "t", "genEnd"]) assert.ok(Number.isFinite(app[key]), key);
  assert.ok(maxNotes < 120, "list length " + maxNotes);
  assert.ok(lampsOk(ctx));
  assert.ok(new Set(ctx.calls.leds.map((v) => v.join())).size > 50, "lamps vary");
  // each lamp is used during play
  for (const lane of [0, 1, 2]) assert.ok(ctx.calls.leds.some((v) => v[lane * 3] + v[lane * 3 + 1] + v[lane * 3 + 2] > 60), "lamp " + lane);
  // sustained light stays moderate; accents are short
  const bright = ctx.calls.leds.filter((v) => v.some((x) => x > 200)).length;
  assert.ok(bright / ctx.calls.leds.length < 0.2, "bright fraction " + bright / ctx.calls.leds.length);
});

test("lamps swell before a beat, flash green on perfect and red on miss", () => {
  const ctx = appContext({ seed: 2 });
  const app = new Pulsar(ctx);
  app.down();
  const first = () => app.notes.find((n) => n.state === "pending");
  run(app, 1.2); // into the count-in; the first beat is at song 0
  let n = first();
  const lane = n.lane;
  const level = () => ctx.calls.leds.at(-1).slice(lane * 3, lane * 3 + 3).reduce((a, b) => a + b, 0);
  const early = (() => { run(app, (n.t - app.song) - 0.8); return level(); })();
  run(app, 0.7);
  const late = level();
  assert.ok(late > early + 30, `swell ${early} -> ${late}`);
  run(app, n.t - (app.song - OFFSET) - 0.001 + 0.02);
  app.down();
  assert.equal(n.state, "done");
  app.up();
  run(app, 0.05);
  const v = ctx.calls.leds.at(-1).slice(lane * 3, lane * 3 + 3);
  assert.ok(v[1] > v[0] && v[1] > v[2] && v[1] > 100, "green flash " + v);
  // ignore the next beat: red flash on its lane
  const m = first();
  run(app, m.t - app.song + 0.5);
  assert.equal(m.state, "missed");
  const r = ctx.calls.leds.slice(-40).some((x) => { const l = x.slice(m.lane * 3, m.lane * 3 + 3); return l[0] > 100 && l[1] < 30; });
  assert.ok(r, "red flash on miss");
});

test("a hold keeps its lamp lit, and is judged head to tail", () => {
  const ctx = appContext({ seed: 6 });
  const app = new Pulsar(ctx);
  app.down();
  while (app.genIndex < 8) app.generate();
  const h = app.notes.find((n) => n.len > 0);
  assert.ok(h, "chart has a hold");
  // Skip to the hold without penalty by resolving earlier notes.
  const skip = (n) => { for (const x of app.notes) if (x !== n && x.t < n.t) x.state = "done"; };
  skip(h);
  app.song = h.t - 0.3;
  app.stab = 1;
  run(app, 0.3 + OFFSET);
  app.down();
  assert.equal(h.state, "held");
  const lane = h.lane;
  const lit = [];
  run(app, h.len * 0.9, () => lit.push(ctx.calls.leds.at(-1).slice(lane * 3, lane * 3 + 3).reduce((a, b) => a + b, 0)));
  assert.ok(lit.every((x) => x > 40), "lamp stays lit while held");
  run(app, h.len * 0.1 + 0.02);
  app.up();
  assert.equal(h.state, "done");
  assert.ok(app.combo >= 2);
  // Letting go early drops the hold.
  const ctx2 = appContext({ seed: 6 });
  const b = new Pulsar(ctx2);
  b.down();
  while (b.genIndex < 8) b.generate();
  const h2 = b.notes.find((n) => n.len > 0);
  for (const x of b.notes) if (x !== h2 && x.t < h2.t) x.state = "done";
  b.song = h2.t - 0.3;
  run(b, 0.3 + OFFSET);
  b.down();
  run(b, h2.len * 0.4);
  b.up();
  assert.equal(h2.state, "missed");
  assert.equal(b.combo, 0);
});

test("a three-second hold during play is harmless", () => {
  const ctx = appContext({ seed: 8 });
  const app = new Pulsar(ctx);
  app.down();
  run(app, 4); // let the count-in finish and a beat or two pass
  const before = app.stab;
  app.down();
  run(app, 3);
  assert.ok(app.stab > before - 0.2, "one press costs little: " + (before - app.stab));
  app.cancel(); // what the host does when the menu opens
  app.up();
  assert.equal(app.phase, "play");
});

test("three quick taps then cancel do not end the run", () => {
  for (const when of [0.5, 3, 20]) {
    const ctx = appContext({ seed: 4 });
    const app = new Pulsar(ctx);
    app.down(); // starts the run
    run(app, when);
    const before = app.stab;
    for (let i = 0; i < 3; i++) { app.down(); run(app, 0.07); app.up(); run(app, 0.07); }
    app.cancel();
    assert.equal(app.phase, "play");
    // The taps (and at most one beat that slipped by meanwhile) cost little. Measured
    // against the stability at the moment of the first tap: a player who idled for 20 s
    // before tapping is not blamed for the idling.
    assert.ok(app.stab > before - 0.15 && app.stab > 0, `${when}: ${before} -> ${app.stab}`);
  }
  // also from the title: three taps and cancel, no run lost
  const t = new Pulsar(appContext());
  for (let i = 0; i < 3; i++) { t.down(); t.up(); }
  t.cancel();
  assert.ok(t.phase === "play" || t.phase === "title");
});

test("cancel and dispose mid-play leave lamps dark and tones off", () => {
  let stops = 0;
  for (const how of ["cancel", "dispose"]) {
    const ctx = appContext({ seed: 3 });
    ctx.synth.stopTone = () => { stops++; };
    const app = new Pulsar(ctx);
    app.down();
    while (app.genIndex < 8) app.generate();
    const h = app.notes.find((n) => n.len > 0);
    for (const x of app.notes) if (x !== h && x.t < h.t) x.state = "done";
    app.song = h.t - 0.2;
    run(app, 0.2 + OFFSET);
    app.down();
    assert.equal(h.state, "held");
    assert.ok(!dark(ctx.calls.leds.at(-1)));
    app[how]();
    assert.ok(dark(ctx.calls.leds.at(-1)), how + " lamps dark");
    assert.equal(app.holdNote, null);
    app.up(); // a stale release must not throw
  }
  assert.ok(stops >= 2);
  const ctx = appContext();
  const title = new Pulsar(ctx);
  run(title, 3);
  assert.ok(ctx.calls.leds.at(-1).every((x) => x < 60), "title lamps are dim");
  assert.ok(ctx.calls.leds.some((v) => !dark(v)), "title lamps breathe");
  title.dispose();
  assert.ok(dark(ctx.calls.leds.at(-1)));
});

test("result screen lamps are dim and everything survives garbage input", () => {
  const ctx = appContext({ seed: 1 });
  const app = new Pulsar(ctx);
  app.down();
  run(app, 100);
  assert.equal(app.phase, "over");
  run(app, 2);
  assert.ok(ctx.calls.leds.at(-1).every((x) => x < 60));
  app.draw(fakeCanvas());
  app.update(0); app.update(NaN); app.up(); app.cancel(); app.pause(); app.event?.({});
  app.dispose();
  assert.ok(lampsOk(ctx));
});

test("the song ends: a finished run is saved with a stability bonus, lamps go green and dim", () => {
  const ctx = appContext({ seed: 11 });
  const app = new Pulsar(ctx);
  play(app, 170);
  assert.ok(app.cleared);
  assert.ok(app.bonus > 1500, "bonus " + app.bonus);
  assert.equal(ctx.calls.score.length, 1);
  assert.equal(ctx.calls.score[0][0], app.score);
  assert.equal(ctx.calls.saved.length, 1);
  run(app, 2);
  const lamp = ctx.calls.leds.at(-1);
  assert.ok(lamp.every((x) => x < 60), "result lamps are dim");
  assert.ok(lamp.some((x) => x > 0), "result lamps breathe");
  assert.equal(app.genIndex, Pulsar.FINALE, "no phrase generated past the finale");
  app.draw(fakeCanvas());
  run(app, 1);
  app.down();
  assert.equal(app.phase, "play");
  assert.ok(!app.cleared && app.bonus === 0, "a new run starts clean");
});

test("the title and result screens keep their text clear of the strike circles", () => {
  // Strike circles top out at STRIKE_Y - 34 = 396 in logical pixels.
  const rows = [];
  const g = fakeCanvas();
  const wrapped = new Proxy(g, { get(o, k) {
    if (k === "fillText") return (t, x, y) => rows.push([t, y]);
    return o[k];
  } });
  const title = new Pulsar(appContext());
  title.draw(wrapped);
  const result = new Pulsar(appContext({ seed: 2 }));
  result.down();
  run(result, 100);
  run(result, 1);
  result.draw(wrapped);
  const labels = rows.filter(([t]) => !["LOW", "MID", "HIGH"].includes(t));
  assert.ok(labels.length > 8, "text was drawn");
  for (const [t, y] of labels) assert.ok(y < 392, `${t} at y=${y} overlaps the strike circles`);
});
