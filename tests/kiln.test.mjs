// KILN: the heat and its coast, the judging, the clays, the yard, the save, the lamps.
import test from "node:test";
import assert from "node:assert/strict";
import { Kiln, migrateSave, landing, stageSpec, dailyGoal, GRADE, PRACTICE } from "../web/apps/kiln.js";
import { appContext, fakeCanvas, run } from "./helpers/app-context.mjs";
import { Random } from "../web/engine/math.js";

const tap = (a) => { a.down(); a.up(); };
const hold = (a, s) => { a.down(); run(a, s); a.up(); };
function mount(options = {}) {
  const ctx = appContext({ seed: 7, ...options });
  return { ctx, app: new Kiln(ctx) };
}
// A potter who holds each pot once and lets go when the heat would settle near the band's centre,
// missing by about `sd` (heat units). It allows for a wandering band by looking ahead to when the
// heat will settle, as a player learns to.
function potter(app, seed, sd, seconds, g) {
  const r = new Random(seed);
  let pot = null, err = 0, at = 0;
  for (let i = 0; i < seconds * 60 && app.phase === "play"; i++) {
    const p = app.pot;
    if (p && !p.judged) {
      if (pot !== p) { pot = p; err = (r.next() + r.next() + r.next() - 1.5) * sd * 2; at = p.age + 0.25 + r.next() * 0.3; }
      if (!app.held && p.presses === 0 && p.age >= at) app.down();
      if (app.held) {
        const ahead = app.coast() * Math.log(Math.max(1, app.rate / 0.05));
        if (landing(app.heat, app.rate, app.coast()) >= app.centre(p.age + ahead) + err) app.up();
      }
    }
    app.update(1 / 60);
    if (g && i % 7 === 0) app.draw(g);
  }
}
const finite = (o, path = "") => {
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === "number") assert.ok(Number.isFinite(v), path + k + " is " + v);
    else if (v && typeof v === "object") finite(v, path + k + ".");
  }
};

test("released heat coasts on by rate times the kiln's inertia, and settles there", () => {
  assert.equal(landing(0.4, 0.5, 0.3), 0.55);
  const { app } = mount();
  tap(app);
  run(app, 0.6);
  app.down();
  run(app, 1.2);
  const expect = landing(app.heat, app.rate, app.coast());
  app.up();
  for (let i = 0; i < 300 && !app.pot.judged; i++) app.update(1 / 60);
  assert.ok(app.pot.judged);
  assert.ok(Math.abs(app.pot.final - expect) < 0.004, app.pot.final + " vs " + expect);
});

test("clays get hotter, lose the pyrometer, narrow, wander and bring draughts; open kilns stay possible", () => {
  assert.ok(stageSpec(0).pyro && stageSpec(1).pyro && !stageSpec(2).pyro);
  assert.ok(stageSpec(2).band < stageSpec(0).band);
  assert.ok(stageSpec(3).wander > 0 && stageSpec(4).draught);
  for (let i = 1; i < 40; i++) assert.ok(stageSpec(i).accel >= stageSpec(i - 1).accel);
  assert.ok(stageSpec(60).band >= 0.035 && stageSpec(60).accel <= 0.85);
});

test("a careful potter goes far and outscores an idle one, a careless one cracks early, nothing is NaN", () => {
  const g = fakeCanvas();
  const results = [1, 2, 3].map((seed) => {
    const { app } = mount({ seed });
    tap(app);
    assert.equal(app.phase, "play");
    potter(app, seed * 13, 0.02, 240, g);
    finite({ score: app.score, heat: app.heat, rate: app.rate, pot: app.pot, R: app.R, sv: app.sv, combo: app.combo });
    assert.ok(app.sq.length <= 8);
    return { score: app.score, far: Math.max(app.R.far, app.sv.far) };
  });
  for (const r of results) assert.ok(r.far >= 4 && r.score > 20000, JSON.stringify(r));
  const careless = mount({ seed: 4 }).app;
  tap(careless);
  potter(careless, 9, 0.12, 200);
  assert.equal(careless.phase, "over");
  const idle = mount({ seed: 5 }).app;
  tap(idle);
  run(idle, 40);
  assert.equal(idle.phase, "over", "unfired pots go cold and the run ends");
  assert.equal(idle.score, 0);
  assert.ok(Math.min(...results.map((r) => r.score)) > 10 * Math.max(1, careless.score));
});

test("the first pots are practice; then a pot outside its band costs a shelf", () => {
  const { app } = mount();
  tap(app);
  for (let i = 0; i < PRACTICE; i++) { run(app, 0.6); hold(app, 0.3); run(app, 2); }
  assert.equal(app.shelves, 3);
  assert.match(app.fb?.word || "SOFT / PRACTICE", /PRACTICE/);
  while (app.pot.judged) app.update(1 / 60);
  assert.equal(app.pot.practice, false);
  run(app, 0.6); hold(app, 0.3); run(app, 2);
  assert.equal(app.shelves, 2, "a soft pot cracked");
  while (app.pot.judged) app.update(1 / 60);
  hold(app, 6);
  assert.equal(app.shelves, 1, "holding to the top slumps the pot");
});

test("one clean hold scores double what the same pot scores with feathering", () => {
  const fire = (presses) => {
    const { app } = mount();
    tap(app);
    app.potN = 9; app.newPot(); app.pot.centre = 0.5; app.pot.practice = false;
    run(app, 0.6);
    for (let k = 0; k < presses; k++) {
      app.down();
      // Hold until this press would land at its share of the way to the centre.
      const goal = 0.5 * (k + 1) / presses;
      for (let i = 0; i < 600 && landing(app.heat, app.rate, app.coast()) < goal; i++) app.update(1 / 60);
      app.up();
      if (k < presses - 1) for (let i = 0; i < 600 && app.rate > 0; i++) app.update(1 / 60); // settled; touch again before it is judged
    }
    for (let i = 0; i < 300 && !app.pot.judged; i++) app.update(1 / 60);
    return { app, d: Math.abs(app.pot.final - 0.5) / app.pot.half };
  };
  const one = fire(1), four = fire(4);
  assert.ok(one.d <= GRADE[0] && four.d <= GRADE[1], JSON.stringify([one.d, four.d]));
  assert.match(one.app.fb.word, /CLEAN/);
  assert.doesNotMatch(four.app.fb.word, /CLEAN/);
  assert.equal(four.app.R.feather, 1, "four touches earn the hidden feat's progress");
  assert.ok(one.app.score >= 2 * 60, "a clean pot scores double");
});

test("the lamps carry the heat and the band: nine whole numbers that change, dark after cancel() and dispose()", () => {
  const { ctx, app } = mount();
  tap(app);
  potter(app, 2, 0.02, 25);
  const frames = ctx.calls.leds;
  assert.ok(frames.length > 40);
  for (const f of frames) assert.ok(f.length === 9 && f.every((v) => Number.isInteger(v) && v >= 0 && v <= 255));
  assert.ok(new Set(frames.map((f) => f.join())).size > 10);
  // The band is shown in cyan (green and blue above red) and the heat in red to white (red above blue).
  assert.ok(frames.some((f) => f[4] > f[3] && f[5] > f[3]) || frames.some((f) => f[1] > f[0] && f[2] > f[0]), "a cyan band spot");
  assert.ok(frames.some((f) => f[0] > 40 && f[2] < f[0] / 2), "a warm heat meter");
  app.cancel();
  assert.deepEqual(ctx.calls.leds.at(-1), Array(9).fill(0));
  app.update(1 / 60);
  app.dispose();
  assert.deepEqual(ctx.calls.leds.at(-1), Array(9).fill(0));
  const n = ctx.calls.leds.length;
  run(app, 1);
  assert.equal(ctx.calls.leds.length, n, "nothing is written after dispose()");
});

test("the yard: a hold opens it, taps move, locked modes refuse, the shelf and feats open, a trial ends after twelve pots", () => {
  const { ctx, app } = mount();
  app.down(); run(app, 0.6); app.up();
  assert.equal(app.phase, "menu");
  const pick = (name) => { while (["FIRING", "DAILY", "TRIAL", "BY LAMP", "SHELF", "FEATS", "LOG"][app.cur] !== name) tap(app); app.down(); run(app, 0.6); app.up(); };
  pick("TRIAL");
  assert.equal(app.phase, "menu", "the trial is locked without feats");
  pick("SHELF");
  assert.equal(app.view, "shelf");
  tap(app);
  assert.equal(app.view, "menu");
  pick("FEATS");
  tap(app); assert.equal(app.page, 1);
  app.down(); run(app, 0.6); app.up();
  app.sv.ft = ["first", "perfect", "clean5"];
  pick("TRIAL");
  assert.equal(app.mode, "trial");
  run(app, 12 * 7.5);
  assert.equal(app.phase, "over", "twelve cold pots end a trial");
  assert.equal(app.fired, 12);
  assert.equal(ctx.calls.score.length, 0, "a trial keeps its own best");
});

test("the plain firing writes the console score once; a tap on the result fires again in the same mode", () => {
  const { ctx, app } = mount();
  tap(app);
  run(app, 40);
  run(app, 3);
  assert.equal(app.phase, "over");
  assert.equal(ctx.calls.score.length, 1);
  tap(app);
  assert.equal(app.phase, "play");
  assert.equal(app.mode, "firing");
});

test("the daily firing is the same for everyone on the day and keeps a streak", () => {
  const a = mount({ seed: 1 }).app, b = mount({ seed: 99 }).app;
  for (const app of [a, b]) { app.dayKey = () => "2026-10-02"; app.start("daily"); app.stage = 5; }
  const shape = (app) => { const out = []; for (let i = 0; i < 30; i++) { app.newPot(); out.push([app.pot.centre.toFixed(5), app.pot.draught.toFixed(5), app.pot.wander?.per.toFixed(5)]); } return JSON.stringify(out); };
  assert.equal(shape(a), shape(b));
  assert.ok(dailyGoal("2026-10-02").text.length > 5);
  const { app } = mount();
  app.dayKey = () => "2026-10-02";
  app.sv.dl = { d: "2026-10-01", best: 10, done: 1, streak: 2, last: "2026-10-01" };
  app.start("daily");
  app.goalMet = () => true;
  app.finish();
  assert.deepEqual([app.sv.dl.d, app.sv.dl.done, app.sv.dl.streak], ["2026-10-02", 1, 3]);
  assert.ok(app.sv.ft.includes("daily"));
});

test("save schema 1: anything stored loads, a saved game round-trips, unknown feats and glazes are dropped", () => {
  for (const raw of [undefined, null, 3, "x", [], { schema: 1, runs: 4, last: { score: 9 }, milestone: 2 }, { st: [], gl: "celadon", best: "no" }]) {
    const s = migrateSave(raw);
    assert.equal(s.schema, 1);
    finite(s);
    assert.ok(Array.isArray(s.ft) && Array.isArray(s.gl));
  }
  assert.equal(migrateSave({ schema: 1, runs: 4, milestone: 2 }).runs, 4, "the kit's run record keeps its count");
  const { ctx, app } = mount();
  tap(app);
  potter(app, 3, 0.02, 60);
  app.shelves = 1; app.potN = 99; app.crack("SOFT", false);
  run(app, 3);
  const saved = ctx.calls.saved.at(-1);
  assert.ok(saved && saved.schema === 1 && saved.runs === 1 && saved.gl.length > 0);
  assert.ok(JSON.stringify(saved).length < 4096);
  assert.deepEqual(migrateSave(JSON.parse(JSON.stringify(saved))), saved);
  const again = new Kiln(appContext({ progress: { ...saved, ft: [...saved.ft, "bogus"], gl: [...saved.gl, "plastic", saved.gl[0]] } }));
  assert.deepEqual(again.sv.ft, saved.ft);
  assert.deepEqual(again.sv.gl, saved.gl);
});

test("every screen draws without throwing", () => {
  const { app } = mount();
  const g = fakeCanvas();
  app.draw(g);
  app.down(); run(app, 0.6); app.up(); app.draw(g);
  for (let i = 0; i < 9; i++) { tap(app); app.draw(g); }
  app.sv.gl = ["celadon"];
  app.start("dark");
  potter(app, 1, 0.03, 30, g);
  app.start("firing"); app.stage = 4;
  potter(app, 1, 0.03, 30, g);
  app.finish(); app.draw(g);
  assert.ok(g.count.fillText > 50);
});
