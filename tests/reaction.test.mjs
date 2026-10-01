// Light Trial depth: series of five, ranks from the best series, feats, the day's series and its
// streak, and the schema 2 save (a first-release save loads intact). The core rule is unchanged:
// the host writes no light while a trial is armed or its cue is showing.
import test from "node:test";
import assert from "node:assert/strict";
import { LightTrial, migrateTrial, trialRank, TRIAL_FEATS, SERIES, LOG_SIZE } from "../web/apps/reaction.js";
import { makeCtx, step, DT } from "./audit/harness.mjs";

// One trial on the simulator clock with a reaction of `ms`; returns the app.
function trial(g, ms, { source = "simulator", delay } = {}) {
  g.down({});
  if (delay !== undefined) g.delay = delay;
  g.event({ type: "cue", trial: g.trial, at_us: 1e6, generation: 0 });
  g.down({ source, at_us: 1e6 + ms * 1000, generation: 0 });
  step(g, 0.5); // past the gesture window, so the save is written
  return g;
}
const early = (g) => { g.down({}); g.down({}); step(g, 0.1); };
const textOf = (g) => {
  const painted = [];
  const g2d = new Proxy({}, { get: (t, k) => (k === "fillText" ? (s) => painted.push({ s: String(s), size: Number(/(\d+)px/.exec(t.font)?.[1]) }) : k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  g.draw(g2d);
  return painted;
};

test("five trials make a series, judged by its median; the next press starts a new one", () => {
  const c = makeCtx(1, { progress: {} }), g = new LightTrial(c);
  for (const ms of [240, 260, 500, 230, 250]) { assert.equal(g.done, null); trial(g, ms); }
  assert.ok(g.done, "the series did not finish");
  assert.equal(g.done.median, 250);
  assert.equal(g.done.spread, 270);
  assert.equal(g.done.clean, true);
  assert.equal(g.done.rank, trialRank(250));
  assert.equal(g.series.length, 0);
  assert.equal(g.sv.bs.simulator, 250);
  const words = textOf(g).map((x) => x.s).join(" | ");
  assert.match(words, /SERIES MEDIAN 250 ms/);
  assert.match(words, /FIRST SERIES|NEW FEAT/);
  trial(g, 300);
  assert.equal(g.done, null);
  assert.equal(g.series.length, 1);
});

test("ranks rise as the best series median falls; a better series replaces the best", () => {
  assert.equal(trialRank(0), "UNRANKED");
  assert.equal(trialRank(600), "NOVICE");
  const order = [440, 370, 300, 270, 240, 210, 190].map(trialRank);
  assert.equal(new Set(order).size, order.length, "each band has its own rank: " + order.join(","));
  const g = new LightTrial(makeCtx(2));
  for (let i = 0; i < SERIES; i++) trial(g, 320);
  assert.equal(g.rank(), trialRank(320));
  for (let i = 0; i < SERIES; i++) trial(g, 260);
  assert.equal(g.done.best, true);
  assert.equal(g.sv.bs.simulator, 260);
  for (let i = 0; i < SERIES; i++) trial(g, 400);
  assert.equal(g.done.best, false);
  assert.equal(g.sv.bs.simulator, 260, "a worse series replaced the best");
});

test("false starts do not count as trials but mark the series; a clean series earns COMPOSED", () => {
  const g = new LightTrial(makeCtx(3));
  trial(g, 300); early(g); assert.equal(g.falses, 1);
  for (let i = 0; i < SERIES - 1; i++) trial(g, 300);
  assert.equal(g.done.clean, false);
  assert.ok(!g.sv.ft.includes("clean"));
  assert.match(textOf(g).map((x) => x.s).join(" "), /EARLY STARTS/);
  for (let i = 0; i < SERIES; i++) trial(g, 300);
  assert.ok(g.sv.ft.includes("clean"));
  assert.equal(g.sv.st.falses, 1);
});

test("timing feats need a timed clock: keyboard trials count for the series but earn none", () => {
  const g = new LightTrial(makeCtx(4));
  for (let i = 0; i < SERIES; i++) trial(g, 180, { source: "keyboard" });
  // Keyboard timing comes from performance.now(), so the measured value is not 180; it is still a series.
  assert.ok(g.done);
  for (const id of ["t250", "t200", "m300", "m250", "steady"]) assert.ok(!g.sv.ft.includes(id), id + " from the keyboard");
  const h = new LightTrial(makeCtx(5));
  for (const ms of [190, 210, 200, 205, 220]) trial(h, ms);
  for (const id of ["series", "t250", "t200", "m300", "m250", "steady", "clean"]) assert.ok(h.sv.ft.includes(id), id);
});

test("changing clock mid-series starts a new series", () => {
  const g = new LightTrial(makeCtx(6));
  trial(g, 250); trial(g, 250);
  assert.equal(g.series.length, 2);
  trial(g, 250, { source: "node" });
  assert.equal(g.series.length, 1);
  assert.equal(g.seriesClock, "physical");
});

test("UNMOVED: under 300 ms after one of the longest waits only", () => {
  const g = new LightTrial(makeCtx(7));
  trial(g, 250, { delay: 2000 });
  assert.ok(!g.sv.ft.includes("unmoved"));
  trial(g, 250, { delay: 4000 });
  assert.ok(g.sv.ft.includes("unmoved"));
  assert.ok(TRIAL_FEATS.find((f) => f.id === "unmoved").hidden);
  // Armed delays stay inside what the node accepts.
  for (let i = 0; i < 200; i++) { g.down({}); assert.ok(g.delay >= 1300 && g.delay <= 4200); g.abort(); }
});

test("the day's series: the first finished series meets it, the streak follows consecutive days", () => {
  const c = makeCtx(8, { progress: { schema: 2, dl: { d: "2026-09-30", done: 1, streak: 2, last: "2026-09-30", best: 260 } } });
  const g = new LightTrial(c); g.dayKey = () => "2026-10-01";
  for (let i = 0; i < SERIES; i++) trial(g, 300);
  assert.equal(g.done.daily, true);
  assert.equal(g.sv.dl.streak, 3);
  assert.equal(g.sv.dl.best, 300);
  assert.ok(g.sv.ft.includes("streak"));
  for (let i = 0; i < SERIES; i++) trial(g, 280);
  assert.equal(g.done.daily, false, "the same day counted twice");
  assert.equal(g.sv.dl.best, 280);
  assert.equal(g.sv.dl.streak, 3);
  // A gap restarts the streak.
  const h = new LightTrial(makeCtx(9, { progress: c.log.saves.at(-1) })); h.dayKey = () => "2026-10-05";
  for (let i = 0; i < SERIES; i++) trial(h, 300);
  assert.equal(h.sv.dl.streak, 1);
});

test("every valid trial is saved once, as schema 2, keeping the first release's fields", () => {
  const old = { schema: 1, runs: 40, last: { metric: "physical", milliseconds: 231, summary: { count: 10, median: 240, best: 199, mean: 245 }, milestone: 10 }, milestone: 10 };
  const sv = migrateTrial(old);
  assert.equal(sv.schema, 2);
  assert.equal(sv.runs, 40); assert.equal(sv.milestone, 10);
  assert.deepEqual(sv.last, old.last);
  assert.equal(sv.st.trials, 40, "trials before the series existed are counted from the old run count");
  const c = makeCtx(10, { progress: old }), g = new LightTrial(c);
  trial(g, 250);
  assert.equal(c.log.saves.length, 1);
  const save = c.log.saves[0];
  assert.equal(save.runs, 41);
  assert.deepEqual(Object.keys(save.last).sort(), ["metric", "milestone", "milliseconds", "summary"]);
  assert.equal(save.st.trials, 41);
  early(g);
  assert.equal(c.log.saves.length, 1, "a false start wrote a save");
  for (const junk of [null, 5, "x", [], { runs: -1, bs: { physical: "fast" }, ft: ["t200", "t200", "zzz"], dl: { best: NaN } }]) {
    const m = migrateTrial(junk);
    assert.equal(m.schema, 2);
    assert.ok(m.runs >= 0 && m.bs.physical >= 0 && m.dl.best >= 0);
    assert.deepEqual(m.ft, junk?.ft ? ["t200"] : []);
  }
  assert.ok(JSON.stringify(save).length < 2048);
});

test("lamps: dark while armed and on the cue; a finished series runs its grade across the lamps, then dark", () => {
  const c = makeCtx(11), g = new LightTrial(c);
  for (let i = 0; i < SERIES - 1; i++) trial(g, 260);
  step(g, 3);
  g.down({});
  const armed = c.ledsNow.join();
  let writes = 0; const leds = c.leds; c.leds = (v) => { writes++; leds(v); };
  step(g, 2);
  g.event({ type: "cue", trial: g.trial, at_us: 1e6, generation: 0 });
  step(g, 0.3);
  assert.equal(writes, 0, "the host wrote light while armed");
  assert.equal(armed, "0,0,0,0,0,0,0,0,0");
  g.down({ source: "simulator", at_us: 1.26e6, generation: 0 });
  const seen = [];
  for (let i = 0; i < 60 * 3; i++) { g.update(DT); seen.push(c.ledsNow.slice()); }
  // The chase: one lamp at a time in the grade colour after the ordinary result glow.
  assert.ok(seen.some((v) => v[0] > 0 && v[3] === 0 && v[6] === 0) && seen.some((v) => v[6] > 0 && v[0] === 0 && v[3] === 0), "no chase");
  assert.ok(c.ledsNow.every((v) => v === 0), "lamps lit after the series");
});

test("title: rank, best series, today's series and a feat; all text at least 16 px in every phase", () => {
  const c = makeCtx(12), g = new LightTrial(c);
  let words = textOf(g);
  assert.match(words.map((x) => x.s).join(" | "), /RANK UNRANKED.*NO SERIES YET/);
  assert.match(words.map((x) => x.s).join(" | "), /TODAY: FINISH A SERIES/);
  assert.ok(words.every((x) => x.size >= 16));
  for (let i = 0; i < SERIES; i++) trial(g, 240);
  words = textOf(g);
  assert.ok(words.every((x) => x.size >= 16));
  g.phase = "title";
  assert.match(textOf(g).map((x) => x.s).join(" | "), /BEST SERIES 240 ms \(SIMULATOR\)/);
  g.down({});
  assert.ok(textOf(g).some((x) => x.s === "SERIES"));
});

test("training log: every finished series is kept (the last twenty), shown on the title, and read back", () => {
  const c = makeCtx(20, { progress: {} }), g = new LightTrial(c);
  g.dayKey = () => "2026-10-02";
  for (let s = 0; s < LOG_SIZE + 3; s++) for (let i = 0; i < SERIES; i++) trial(g, 300 - s);
  assert.equal(g.sv.log.length, LOG_SIZE);
  assert.deepEqual(g.sv.log.at(-1), { d: "2026-10-02", m: 300 - (LOG_SIZE + 2), k: "simulator" });
  const save = c.log.saves.at(-1);
  assert.equal(save.log.length, LOG_SIZE);
  assert.deepEqual(migrateTrial(save).log, save.log);
  assert.deepEqual(migrateTrial({ log: [null, { m: "x" }, { m: 250, k: "moon" }, { m: 240, k: "physical", d: 7 }] }).log, [{ d: "", m: 240, k: "physical" }]);
  g.phase = "title"; g.t = 1;
  assert.match(textOf(g).map((x) => x.s).join(" | "), /LAST 20 SERIES/);
  g.t = 10;
  assert.doesNotMatch(textOf(g).map((x) => x.s).join(" | "), /LAST 20 SERIES/, "the feats never get a turn");
});

test("while armed the screen shows the series to beat, and the lamps stay dark", () => {
  const c = makeCtx(21), g = new LightTrial(c);
  for (let i = 0; i < SERIES; i++) trial(g, 270);
  step(g, 3);
  g.down({});
  step(g, 0.5);
  assert.ok(c.ledsNow.every((v) => v === 0));
  assert.ok(textOf(g).some((x) => x.s === "TO BEAT: 270 ms"));
});
