// MERIDIAN: the swing, the called lamp, the judging, the stages, the observatory, the save, the lamps.
import test from "node:test";
import assert from "node:assert/strict";
import { Meridian, migrateSave, swingX, gateTime, stageSpec, dailyGoal, starsEarned, skyPlace, WIN, PRACTICE, SIDE, STARS_PER, SKY_SIZE, LAMP_LAG } from "../web/apps/meridian.js";
import { appContext, fakeCanvas, run } from "./helpers/app-context.mjs";
import { Random } from "../web/engine/math.js";

const tap = (a) => { a.down(); a.up(); };
function mount(options = {}) {
  const ctx = appContext({ seed: 7, ...options });
  return { ctx, app: new Meridian(ctx) };
}
// The pass of the called lamp still to be judged (an end lamp is reached as one half-swing ends).
const open = (app) => [app.sw.gate, app.prev].find((g) => g && !g.done) || null;
// A player who taps every plain pass of the called lamp with a timing error of about `sd` seconds,
// and lets red swings pass. It reads the swing from the game, as a player reads the light.
function bot(app, seed, sd, seconds, g) {
  const r = new Random(seed);
  let target = null, off = 0;
  for (let i = 0; i < seconds * 60 && app.phase === "play"; i++) {
    const gate = open(app);
    if (gate && gate.kind === "normal") {
      if (target !== gate) { target = gate; off = (r.next() + r.next() + r.next() - 1.5) * sd * 2; }
      if (app.rt + 1 / 120 >= gate.t + off + app.lag()) tap(app);
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

test("a half-swing is half a cosine and reaches each lamp once: through it, or arriving at the turn", () => {
  const sw = { t0: 2, D: 1, x0: 2, x1: 0 };
  assert.equal(swingX(sw, 2), 2);
  assert.ok(Math.abs(swingX(sw, 3)) < 1e-9);
  assert.ok(Math.abs(gateTime(sw, 1) - 2.5) < 1e-9, "a full swing passes the middle at its midpoint");
  assert.equal(gateTime(sw, 0), 3, "the far lamp is reached at the turn");
  assert.equal(gateTime(sw, 2), null, "the lamp it leaves belongs to the swing before");
  const feint = { t0: 0, D: 1, x0: 2, x1: 1.4 };
  assert.equal(gateTime(feint, 1), null, "a feint never reaches the middle");
  assert.equal(gateTime(feint, 0), null);
  const back = { t0: 1, D: 0.5, x0: 1.4, x1: 2 };
  assert.equal(gateTime(back, 2), 1.5, "after a feint the light returns to the lamp it came from");
});

test("stages get faster and add rules; cycles narrow the windows but never below six tenths", () => {
  assert.equal(stageSpec(0).red, 0);
  assert.ok(stageSpec(1).red > 0 && !stageSpec(1).drift);
  assert.ok(stageSpec(2).drift && stageSpec(3).blind > 0 && stageSpec(4).feint > 0);
  for (let i = 1; i < 30; i++) assert.ok(stageSpec(i).d1 <= stageSpec(i - 1).d1 + 1e-9 || i === 5, "stage " + i + " is not slower");
  assert.equal(stageSpec(4).win, 1);
  assert.ok(stageSpec(6).win < 1 && stageSpec(60).win === 0.6);
  assert.deepEqual(SIDE, ["LEFT", "MIDDLE", "RIGHT"]);
});

test("a steady player goes far and outscores an idle one, a sloppy one loses early, and nothing is NaN", () => {
  const g = fakeCanvas();
  const results = [1, 2, 3].map((seed) => {
    const { app } = mount({ seed });
    tap(app);
    assert.equal(app.phase, "play");
    bot(app, seed * 11, 0.04, 240, g);
    numbers({ score: app.score, rt: app.rt, t: app.t, sw: app.sw, prev: app.prev, R: app.R, sv: app.sv, clock: app.clock, combo: app.combo });
    assert.ok(app.sq.length <= 8);
    return { score: app.score, far: app.R.far, combo: app.bestCombo };
  });
  for (const r of results) assert.ok(r.far >= 4 && r.score > 20000, JSON.stringify(r));
  const sloppy = mount({ seed: 4 }).app;
  tap(sloppy);
  bot(sloppy, 9, 0.2, 120);
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
  tap(app); // nowhere near a pass of the called lamp
  assert.equal(app.shields, 3);
  assert.match(app.fb.word, /WIDE \/ PRACTICE/);
  for (let i = 0; i < 1800 && app.gates <= PRACTICE; i++) app.update(1 / 60);
  assert.ok(app.gates > PRACTICE);
  assert.equal(app.shields, 3, "the practice swings lapsed for free");
  run(app, 6);
  assert.ok(app.shields < 3, "after practice a lapse costs a shield");
});

test("a strike is graded by its timing error; a late tap after a lapse is not charged twice", () => {
  const { app } = mount();
  tap(app);
  app.gates = PRACTICE + 1; // past practice
  const g = app.sw.gate;
  run(app, g.t + app.lag() - app.rt + WIN[0] / 2 - 1 / 120);
  tap(app);
  assert.equal(app.fb.word, "PERFECT");
  assert.equal(app.combo, 1);
  assert.ok(app.score > 0);
  // Let the next swing lapse, then tap a little late: one shield.
  while (!open(app)) app.update(1 / 60);
  const gate = open(app);
  gate.practice = false;
  run(app, gate.t + WIN[2] * 1.35 + app.lag() - app.rt + 0.02);
  assert.equal(app.shields, 2);
  tap(app);
  assert.equal(app.fb.word, "LATE");
  assert.equal(app.shields, 2);
});

test("latency: a tap is judged at its arrival minus the lamp lag and the console's calibration", () => {
  const judge = (latencyMs, after) => {
    const { app } = mount({ settings: { latencyMs } });
    tap(app);
    app.gates = PRACTICE + 1;
    const g = app.sw.gate;
    run(app, g.t + after - app.rt - 1 / 120);
    tap(app);
    return [app.fb.word, app.fb.ms];
  };
  assert.equal(LAMP_LAG, 0.035);
  // 115 ms after the gate on the game clock: the lamp lag alone leaves 80 ms (GOOD on the middle lamp,
  // PERFECT on an end lamp's wider window); a calibration of 80 ms makes it exact.
  const [, raw] = judge(0, 0.115);
  assert.ok(raw >= 70 && raw <= 85, "lamp lag taken off: " + raw);
  const [word, ms] = judge(80, 0.115);
  assert.equal(word, "PERFECT");
  assert.ok(Math.abs(ms) <= 8, "calibrated: " + ms);
  // Nonsense settings are clamped, never NaN.
  const { app } = mount({ settings: { latencyMs: "x" } });
  assert.equal(app.lag(), LAMP_LAG);
  assert.equal(mount({ settings: { latencyMs: 5000 } }).app.lag(), LAMP_LAG + 0.3);
  // A late, calibrated tap is not lapsed before it arrives.
  const b = mount({ settings: { latencyMs: 120 } }).app;
  tap(b); b.gates = PRACTICE + 1;
  const g = b.sw.gate;
  run(b, g.t + 0.1 - b.rt);
  assert.ok(!g.done, "the gate is still open 100 ms after on a 120 ms console");
});

test("the lamps show red exactly when the screen calls a red swing, and the called lamp is marked clearly", () => {
  const { app } = mount();
  tap(app);
  app.stage = 2; app.gates = 99;
  let reds = 0;
  for (let i = 0; i < 2400; i++) {
    app.shields = 3;
    app.update(1 / 60);
    if (app.sw.gate?.kind === "red") reds++;
    const g = app.sw.gate, v = app.lampOut;
    const red = !!g && g.kind === "red";
    const reddish = [0, 1, 2].some((k) => v[k * 3] > 60 && v[k * 3 + 1] < v[k * 3] / 3 && v[k * 3 + 2] < v[k * 3] / 3);
    if (reddish && app.phase === "play" && !app.lamps.fx) assert.ok(red, "red lamp without a red call at frame " + i);
  }
  assert.ok(reds > 100, "red swings came up: " + reds);
  const { app: b } = mount();
  tap(b);
  run(b, 0.05);
  const m = b.lampOut.slice(b.target * 3, b.target * 3 + 3);
  assert.ok(Math.max(...m) >= 30, "the marker is visible: " + m);
});

test("a red swing must pass: tapping it burns a shield, letting it go scores", () => {
  const { app } = mount();
  tap(app);
  const until = () => { while (!open(app)) app.update(1 / 60); return open(app); };
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
  const called = app.target;
  run(app, g.t - app.rt + 0.3);
  assert.equal(app.R.held, 1);
  assert.equal(app.target, called, "the call stands after a red swing: catch the next pass");
  assert.ok(app.score > before);
  assert.equal(app.shields, 2);
});

test("each catch calls a lamp: all three come up, never one three times running, and the screen shows the call", () => {
  const { app } = mount({ seed: 12 });
  tap(app);
  const calls = [];
  let last = -1;
  const orig = app.call.bind(app);
  app.call = () => { orig(); calls.push(app.target); };
  bot(app, 4, 0.03, 90);
  assert.ok(calls.length > 30);
  assert.deepEqual([...new Set(calls)].sort(), [0, 1, 2]);
  for (let i = 2; i < calls.length; i++) assert.ok(!(calls[i] === calls[i - 1] && calls[i] === calls[i - 2]), "three in a row at " + i);
  const texts = [];
  const g = fakeCanvas();
  g.fillText = (t) => texts.push(String(t));
  app.phase = "play"; app.target = 0; app.draw(g);
  assert.ok(texts.includes("LEFT"));
  last = texts.length;
  assert.ok(last > 0);
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
  const pick = (name) => { while (["SWING", "DAILY", "SPRINT", "ECLIPSE", "LIGHT", "SKY", "FEATS", "LOG"][app.cur] !== name) tap(app); app.down(); run(app, 0.6); app.up(); };
  pick("SPRINT");
  assert.equal(app.phase, "menu", "sprint is locked without feats");
  pick("SKY");
  assert.equal(app.view, "sky");
  tap(app);
  assert.equal(app.view, "menu", "a tap leaves the sky chart");
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

test("save schema 2: anything stored loads, a saved game round-trips, unknown feats are dropped", () => {
  for (const raw of [undefined, null, 7, "x", [], { schema: 1, runs: 2, last: { score: 5 }, milestone: 1 }, { st: "no", best: [], ft: "first" }, { schema: 2, sky: -4 }, { schema: 2, sky: 999 }]) {
    const s = migrateSave(raw);
    assert.equal(s.schema, 2);
    numbers(s);
    assert.ok(Array.isArray(s.ft));
    assert.ok(s.sky >= 0 && s.sky <= SKY_SIZE);
  }
  assert.equal(migrateSave({ schema: 1, runs: 2, milestone: 1 }).runs, 2, "the kit's run record keeps its count");
  const { ctx, app } = mount();
  tap(app);
  bot(app, 1, 0.05, 60);
  app.shields = 1; app.gates = 99; app.penalty("WIDE", false);
  run(app, 3);
  const saved = ctx.calls.saved.at(-1);
  assert.ok(saved && saved.schema === 2 && saved.runs === 1);
  assert.ok(JSON.stringify(saved).length < 4096);
  assert.deepEqual(migrateSave(JSON.parse(JSON.stringify(saved))), saved);
  const again = new Meridian(appContext({ progress: { ...saved, ft: [...saved.ft, "bogus", saved.ft[0]] } }));
  assert.deepEqual(again.sv.ft, saved.ft);
  assert.equal(again.sv.runs, 1);
  assert.equal(again.sv.sky, saved.sky);
});

test("a schema 1 save migrates to schema 2 with a star for every stage it had reached", () => {
  const old = { schema: 1, runs: 9, far: 4, ft: ["first", "drift"], st: { hits: 300 }, best: { swing: 5000, combo: 22 }, sel: { light: 1 }, dl: { d: "2026-10-01", best: 900, done: 1, streak: 2, last: "2026-10-01" } };
  const s = migrateSave(old);
  assert.equal(s.schema, 2);
  assert.equal(s.sky, 4);
  assert.deepEqual([s.runs, s.far, s.st.hits, s.best.swing, s.best.combo, s.sel.light, s.dl.streak], [9, 4, 300, 5000, 22, 1, 2]);
  assert.deepEqual(s.ft, ["first", "drift"]);
  assert.equal(migrateSave({ schema: 2, far: 4, sky: 0 }).sky, 0, "a schema 2 save keeps its own sky");
});

test("the sky: stars for stages and sequences, added up across runs, never past the last star", () => {
  assert.equal(starsEarned(0, 0), 0);
  assert.equal(starsEarned(3, 5), 5);
  assert.equal(starsEarned(-1, -3), 0);
  assert.equal(skyPlace(0), "THE PLUMB LINE  0 / " + STARS_PER);
  assert.equal(skyPlace(STARS_PER + 3), "THE KEEL  3 / " + STARS_PER);
  assert.equal(skyPlace(SKY_SIZE), "THE WHOLE SKY IS LIT");
  const { app } = mount();
  app.start("swing");
  app.R.far = 2; app.R.seqs = 3; app.R.offSum = 0;
  app.finish();
  assert.equal(app.sv.sky, 3);
  assert.equal(app.starsNew, 3);
  app.start("swing");
  app.sv.sky = SKY_SIZE - 1; app.R.far = 5;
  app.finish();
  assert.equal(app.sv.sky, SKY_SIZE);
  assert.equal(app.starsNew, 1);
  assert.ok(app.sv.ft.includes("sky"), "a whole constellation is the STARGAZER feat");
});

test("sequences: from stage VI a call can be two or three lamps, caught in order for a bonus; a miss breaks it", () => {
  const { app } = mount();
  app.start("swing");
  app.stage = 5; app.gates = 99;
  let made = 0;
  for (let i = 0; i < 40; i++) {
    app.call();
    if (app.seqAll.length) {
      made++;
      assert.equal(app.seqAll.length, 2, "stage VI calls twos");
      for (let k = 1; k < app.seqAll.length; k++) assert.notEqual(app.seqAll[k], app.seqAll[k - 1]);
      assert.equal(app.target, app.seqAll[0]);
      assert.deepEqual(app.seq, app.seqAll.slice(1));
      app.seq = []; app.seqAll = [];
    }
  }
  assert.ok(made > 5 && made < 35, "about half the calls are sequences: " + made);
  // Catch one in order.
  app.seqAll = [0, 2]; app.seq = [2]; app.target = 0;
  app.call(); // the sequence moves on to its second lamp
  assert.equal(app.target, 2);
  const before = app.score, seqs = app.R.seqs;
  app.hit({ t: app.rt, p: 2, kind: "normal", blind: false, done: true, end: true }, 0);
  assert.equal(app.R.seqs, seqs + 1);
  assert.equal(app.fb.word, "SEQUENCE");
  assert.ok(app.score - before > 100, "a completed sequence pays a bonus");
  // A miss in the middle of one breaks it.
  app.seqAll = [1, 0, 2]; app.seq = [0, 2];
  app.penalty("WIDE", true);
  assert.deepEqual([app.seq, app.seqAll], [[], []]);
  // Cycles can call threes.
  app.stage = 6;
  let three = false;
  for (let i = 0; i < 80 && !three; i++) { app.call(); three = app.seqAll.length === 3; app.seq = []; }
  assert.ok(three, "a cycle calls a three");
});

test("every catch records how early or late it was: the last twelve, and the run's average", () => {
  const { app } = mount();
  app.start("swing");
  for (let i = 0; i < 15; i++) app.hit({ t: app.rt - 0.02, p: 1, kind: "normal", blind: false, done: true, end: false }, 0);
  assert.equal(app.offs.length, 12);
  assert.ok(app.offs.every((ms) => ms === 20));
  assert.equal(app.fb.ms, 20);
  app.shields = 1; app.gates = 99; app.penalty("WIDE", false);
  assert.equal(app.phase, "over");
  assert.equal(app.timing, 20);
  assert.equal(app.timingText(), "20 ms LATE ON AVERAGE");
  const b = mount().app;
  b.start("swing"); b.shields = 1; b.gates = 99; b.penalty("WIDE", false);
  assert.equal(b.timing, null, "too few catches for an average");
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
  app.sv.sky = 13; app.starsNew = 2; app.timing = -14; app.draw(g);
  app.openMenu(); app.view = "sky"; app.draw(g);
  app.start("swing"); app.stage = 6; app.gates = 99; app.seqAll = [0, 2, 1]; app.seq = [2, 1]; app.offs = [-40, 10, 90]; app.sock = [0.3, 0, 0]; app.sockCol = ["#fff", "", ""];
  run(app, 0.2, () => app.draw(g));
  assert.ok(g.count.fillText > 50);
});
