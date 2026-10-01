// MERIDIAN: the swing, the judging, the stages, the observatory, the save, the lamps.
import test from "node:test";
import assert from "node:assert/strict";
import { Meridian, migrateSave, swingX, crossing, stageSpec, dailyGoal, WIN, PRACTICE } from "../web/apps/meridian.js";
import { appContext, fakeCanvas, run } from "./helpers/app-context.mjs";
import { Random } from "../web/engine/math.js";

const tap = (a) => { a.down(); a.up(); };
function mount(options = {}) {
  const ctx = appContext({ seed: 7, ...options });
  return { ctx, app: new Meridian(ctx) };
}
// A player who taps every plain swing at its crossing with a timing error of about `sd` seconds,
// and lets red swings pass. It reads the swing from the game, as a player reads the light.
function bot(app, seed, sd, seconds, g) {
  const r = new Random(seed);
  let target = null, off = 0;
  for (let i = 0; i < seconds * 60 && app.phase === "play"; i++) {
    const gate = app.sw.gate;
    if (gate && !gate.done && gate.kind === "normal") {
      if (target !== gate) { target = gate; off = (r.next() + r.next() + r.next() - 1.5) * sd * 2; }
      if (app.rt + 1 / 120 >= gate.t + off) tap(app);
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

test("a half-swing is half a cosine and crosses the meridian once, or not at all for a feint", () => {
  const sw = { t0: 2, D: 1, x0: 2.15, x1: -0.15 };
  assert.equal(swingX(sw, 2), 2.15);
  assert.ok(Math.abs(swingX(sw, 3) + 0.15) < 1e-9);
  assert.ok(Math.abs(crossing(sw) - 2.5) < 1e-9, "a symmetric swing crosses at its middle");
  const off = { t0: 0, D: 1, x0: 2.0, x1: 0.4 };
  const at = crossing(off);
  assert.ok(at > 0 && at < 1 && Math.abs(swingX(off, at) - 1) < 1e-9, "an off-centre swing crosses where x = 1");
  assert.equal(crossing({ t0: 0, D: 1, x0: 2.1, x1: 1.5 }), null, "a feint never crosses");
});

test("stages get faster and add rules; cycles narrow the windows but never below six tenths", () => {
  assert.equal(stageSpec(0).red, 0);
  assert.ok(stageSpec(1).red > 0 && !stageSpec(1).drift);
  assert.ok(stageSpec(2).drift && stageSpec(3).blind > 0 && stageSpec(4).feint > 0);
  for (let i = 1; i < 30; i++) assert.ok(stageSpec(i).d1 <= stageSpec(i - 1).d1 + 1e-9 || i === 5, "stage " + i + " is not slower");
  assert.equal(stageSpec(4).win, 1);
  assert.ok(stageSpec(6).win < 1 && stageSpec(60).win === 0.6);
});

test("a steady player goes far and outscores an idle one, a sloppy one loses early, and nothing is NaN", () => {
  const g = fakeCanvas();
  const results = [1, 2, 3].map((seed) => {
    const { app } = mount({ seed });
    tap(app);
    assert.equal(app.phase, "play");
    bot(app, seed * 11, 0.04, 240, g);
    numbers({ score: app.score, rt: app.rt, t: app.t, sw: app.sw, prev: app.prev, R: app.R, sv: app.sv, clock: app.clock, combo: app.combo, trail: app.trail });
    assert.ok(app.trail.length <= 10 && app.sq.length <= 8);
    return { score: app.score, far: app.R.far, combo: app.bestCombo };
  });
  for (const r of results) assert.ok(r.far >= 4 && r.score > 20000, JSON.stringify(r));
  const sloppy = mount({ seed: 4 }).app;
  tap(sloppy);
  bot(sloppy, 9, 0.14, 120);
  assert.equal(sloppy.phase, "over", "a sloppy player's run ends");
  const idle = mount({ seed: 5 }).app;
  tap(idle);
  run(idle, 30);
  assert.equal(idle.phase, "over", "an idle run ends");
  assert.equal(idle.score, 0);
  assert.ok(Math.min(...results.map((r) => r.score)) > 50 * Math.max(1, sloppy.score));
});

test("a newcomer's first swings are practice: lapses and wide taps cost nothing", () => {
  const { app } = mount();
  tap(app);
  tap(app); // nowhere near a crossing
  assert.equal(app.shields, 3);
  assert.match(app.fb.word, /WIDE \/ PRACTICE/);
  run(app, 5.5);
  assert.equal(app.shields, 3, "the practice swings lapsed for free");
  run(app, 1);
  assert.ok(app.gates > PRACTICE);
  run(app, 6);
  assert.ok(app.shields < 3, "after practice a lapse costs a shield");
});

test("a strike is graded by its timing error; a late tap after a lapse is not charged twice", () => {
  const { app } = mount();
  tap(app);
  app.gates = PRACTICE + 1; // past practice
  const g = app.sw.gate;
  run(app, g.t - app.rt + WIN[0] / 2 - 1 / 120);
  tap(app);
  assert.equal(app.fb.word, "PERFECT");
  assert.equal(app.combo, 1);
  assert.ok(app.score > 0);
  // Let the next swing lapse, then tap a little late: one shield.
  const next = () => app.sw.gate && !app.sw.gate.done ? app.sw.gate : null;
  while (!next()) app.update(1 / 60);
  const gate = next();
  gate.practice = false;
  run(app, gate.t + WIN[2] - app.rt + 0.05);
  assert.equal(app.shields, 2);
  tap(app);
  assert.equal(app.fb.word, "LATE");
  assert.equal(app.shields, 2);
});

test("a red swing must pass: tapping it burns a shield, letting it go scores", () => {
  const { app } = mount();
  tap(app);
  const until = () => { while (!(app.sw.gate && !app.sw.gate.done)) app.update(1 / 60); return app.sw.gate; };
  let g = until();
  g.kind = "red"; g.practice = false;
  run(app, g.t - app.rt);
  tap(app);
  assert.equal(app.fb.word, "BURNED");
  assert.equal(app.shields, 2);
  run(app, 0.3);
  g = until();
  g.kind = "red"; g.practice = false;
  const before = app.score;
  run(app, g.t - app.rt + 0.3);
  assert.equal(app.R.held, 1);
  assert.ok(app.score > before);
  assert.equal(app.shields, 2);
});

test("the lamps carry the swing: nine whole numbers that change, dark after cancel() and dispose()", () => {
  const { ctx, app } = mount();
  tap(app);
  bot(app, 3, 0.03, 20);
  const frames = ctx.calls.leds;
  assert.ok(frames.length > 50, "the lamps follow the swing");
  for (const f of frames) assert.ok(f.length === 9 && f.every((v) => Number.isInteger(v) && v >= 0 && v <= 255));
  assert.ok(new Set(frames.map((f) => f.join())).size > 10);
  // The light moves: the left and right lamps take turns being brightest.
  assert.ok(frames.some((f) => f[0] + f[1] + f[2] > f[6] + f[7] + f[8] + 40) && frames.some((f) => f[6] + f[7] + f[8] > f[0] + f[1] + f[2] + 40));
  app.cancel();
  assert.deepEqual(ctx.calls.leds.at(-1), Array(9).fill(0));
  app.update(1 / 60);
  app.dispose();
  assert.deepEqual(ctx.calls.leds.at(-1), Array(9).fill(0));
  const n = ctx.calls.leds.length;
  run(app, 1);
  assert.equal(ctx.calls.leds.length, n, "nothing is written after dispose()");
});

test("the observatory: a hold opens it, taps move, locked modes refuse, feats unlock sprint and eclipse", () => {
  const { app } = mount();
  app.down(); run(app, 0.6); app.up();
  assert.equal(app.phase, "menu");
  const pick = (name) => { while (["SWING", "DAILY", "SPRINT", "ECLIPSE", "LIGHT", "FEATS", "LOG"][app.cur] !== name) tap(app); app.down(); run(app, 0.6); app.up(); };
  pick("SPRINT");
  assert.equal(app.phase, "menu", "sprint is locked without feats");
  pick("FEATS");
  assert.equal(app.view, "feats");
  tap(app); assert.equal(app.page, 1);
  app.down(); run(app, 0.6); app.up();
  assert.equal(app.view, "menu");
  app.sv.ft = ["first", "combo10", "drift"];
  pick("LIGHT");
  assert.equal(app.light().name, "GREEN");
  pick("SPRINT");
  assert.equal(app.phase, "play");
  assert.equal(app.mode, "sprint");
  run(app, 61);
  assert.equal(app.phase, "over", "a sprint ends on the clock");
});

test("only the plain run writes the console score; sprint keeps its own best", () => {
  const { ctx, app } = mount();
  app.sv.ft = ["first", "combo10", "drift"];
  app.start("sprint");
  bot(app, 5, 0.03, 70);
  run(app, 3);
  assert.equal(app.phase, "over");
  assert.equal(ctx.calls.score.length, 0);
  assert.ok(app.sv.best.sprint > 0);
  tap(app);
  assert.equal(app.mode, "sprint", "a tap on the result runs the same mode again");
  app.start("swing");
  run(app, 20);
  run(app, 3);
  assert.equal(app.phase, "over");
  assert.equal(ctx.calls.score.length, 1);
});

test("the daily run is the same for everyone on the day and keeps a streak", () => {
  const a = mount({ seed: 1 }).app, b = mount({ seed: 99 }).app;
  for (const app of [a, b]) { app.dayKey = () => "2026-10-02"; app.start("daily"); }
  const shape = (app) => { const out = []; for (let i = 0; i < 40; i++) { out.push([app.sw.x1.toFixed(4), app.sw.D.toFixed(4), app.sw.gate?.kind, app.sw.gate?.blind]); app.nextSwing(); } return JSON.stringify(out); };
  a.stage = b.stage = 4;
  assert.equal(shape(a), shape(b));
  const goal = dailyGoal("2026-10-02");
  assert.ok(goal.text.length > 5);
  const { app } = mount();
  app.dayKey = () => "2026-10-02";
  app.sv.dl = { d: "2026-10-01", best: 10, done: 1, streak: 3, last: "2026-10-01" };
  app.start("daily");
  app.goalMet = () => true;
  app.finish();
  assert.deepEqual([app.sv.dl.d, app.sv.dl.done, app.sv.dl.streak, app.sv.dl.last], ["2026-10-02", 1, 4, "2026-10-02"]);
  assert.equal(app.sv.st.daily, 1);
  assert.ok(app.sv.ft.includes("daily"));
});

test("save schema 1: anything stored loads, a saved game round-trips, unknown feats are dropped", () => {
  for (const raw of [undefined, null, 7, "x", [], { schema: 1, runs: 2, last: { score: 5 }, milestone: 1 }, { st: "no", best: [], ft: "first" }]) {
    const s = migrateSave(raw);
    assert.equal(s.schema, 1);
    numbers(s);
    assert.ok(Array.isArray(s.ft));
  }
  assert.equal(migrateSave({ schema: 1, runs: 2, milestone: 1 }).runs, 2, "the kit's run record keeps its count");
  const { ctx, app } = mount();
  tap(app);
  bot(app, 1, 0.05, 60);
  app.shields = 1; app.gates = 99; app.penalty("WIDE", false);
  run(app, 3);
  const saved = ctx.calls.saved.at(-1);
  assert.ok(saved && saved.schema === 1 && saved.runs === 1);
  assert.ok(JSON.stringify(saved).length < 4096);
  assert.deepEqual(migrateSave(JSON.parse(JSON.stringify(saved))), saved);
  const again = new Meridian(appContext({ progress: { ...saved, ft: [...saved.ft, "bogus", saved.ft[0]] } }));
  assert.deepEqual(again.sv.ft, saved.ft);
  assert.equal(again.sv.runs, 1);
});

test("every screen draws without throwing", () => {
  const { app } = mount();
  const g = fakeCanvas();
  app.draw(g);
  app.down(); run(app, 0.6); app.up(); app.draw(g);
  for (let i = 0; i < 9; i++) { tap(app); app.draw(g); }
  app.start("eclipse");
  run(app, 30, () => app.draw(g));
  run(app, 2); app.draw(g);
  assert.ok(g.count.fillText > 50);
});
