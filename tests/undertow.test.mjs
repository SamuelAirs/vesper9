// UNDERTOW: the faster dive, zones, pearls, the dock (craft, start zone, daily dive, feats, log) and
// the save migration. The shared game tests (games*.test.mjs, engine.test.mjs, gesture-apps.test.mjs)
// still cover the column rules, the lamps and the menu gesture.
import test from "node:test";
import assert from "node:assert/strict";
import { Undertow, ZONES, CRAFTS, FEATS, migrateSave, dailyGoal, nextGate, undertowSpeed, gateInterval } from "../web/apps/undertow.js";
import { appContext, fakeCanvas, run } from "./helpers/app-context.mjs";
import { Random } from "../web/engine/math.js";

const DT = 1 / 60;
const dark = (v) => v.every((x) => x === 0);
const lampsOk = (ctx) => ctx.calls.leds.every((v) => v.length === 9 && v.every((x) => Number.isInteger(x) && x >= 0 && x <= 255));
const tap = (g) => { g.down(); g.up(); };
const hold = (g, s = 0.6) => { g.down(); run(g, s); g.up(); };
const dive = (seed = 1, options = {}) => {
  const ctx = appContext({ seed, ...options });
  const g = new Undertow(ctx);
  tap(g);
  return { ctx, g };
};
// A pilot that aims for the next opening with a braking lead, through the real button edges.
function pilot(g, seconds, lead = 0.36) {
  const zones = [];
  let t = 0;
  for (let i = 0; i < seconds * 60 && g.phase === "play"; i++) {
    const gate = g.gates.find((q) => q.x + 65 > 202);
    const want = g.y + g.vy * lead > (gate ? gate.center : 270);
    if (want && !g.held) g.down(); else if (!want && g.held) g.up();
    g.update(DT); t += DT;
    if (g.zone > zones.length) zones.push(t);
  }
  return { zones, t };
}
const finite = (o, path = "") => {
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === "number") assert.ok(Number.isFinite(v), path + k + " is " + v);
    else if (v && typeof v === "object" && !ArrayBuffer.isView(v) && k !== "c" && k !== "guard" && k !== "lamps") finite(v, path + k + ".");
  }
};

test("the dive starts at once: the first column arrives within two seconds and the Kelp Run inside twenty", () => {
  const { g } = dive(3);
  assert.equal(g.phase, "play");
  run(g, 0.9);
  assert.equal(g.gates.length, 1, "the first column had not appeared after 0.9 s");
  const { g: h } = dive(4);
  const { zones } = pilot(h, 25);
  assert.ok(zones[0] < 20, "the first new zone came at " + zones[0] + " s");
  assert.ok(undertowSpeed(0) >= 230 && gateInterval(0) <= 1.6, "the opening pace is the old slow one");
});

test("a pilot dives through every zone on several seeds, a new one every twenty seconds or so; an idle craft sinks out", () => {
  for (const seed of [1, 2, 3]) {
    const { g } = dive(seed);
    const { zones } = pilot(g, 400);
    assert.equal(zones.length, ZONES.length - 1, `seed ${seed}: reached ${zones.length} zones by passage ${g.points}`);
    for (let i = 1; i < zones.length; i++) assert.ok(zones[i] - zones[i - 1] < 30, `seed ${seed}: zone gap ${zones[i] - zones[i - 1]} s`);
    assert.ok(g.points >= 70);
    assert.ok(g.R.pearls > 20, "few pearls: " + g.R.pearls);
    assert.ok(g.R.cleanBest >= 10);
  }
  const { g: idle } = dive(1);
  run(idle, 30);
  assert.equal(idle.phase, "over");
  assert.ok(idle.points <= 2);
});

test("thrust is felt at once: a falling craft turns upward within 0.15 s and a held press shows the exhaust", () => {
  const { g } = dive(5);
  run(g, 0.3);
  g.down();
  run(g, 0.15);
  assert.ok(g.vy < 0, "still sinking after 0.15 s of thrust");
  const live = () => { let n = 0; for (let k = 0; k < g.parts.length; k += 5) if (g.parts[k + 4] > 0) n++; return n; };
  assert.ok(live() >= 1, "no exhaust while thrusting");
  const canvas = fakeCanvas();
  g.draw(canvas);
  assert.ok(canvas.count.fill > 4);
});

test("zones add currents, darkness and breathing openings", () => {
  const rng = new Random(5);
  const sample = (points) => Array.from({ length: 40 }, () => nextGate(270, points, rng));
  assert.ok(sample(5).every((q) => !q.cur && !q.breathe && !q.amp));
  assert.ok(sample(25).some((q) => q.cur), "no current in the Trench");
  assert.ok(sample(55).some((q) => q.breathe), "no breathing in the Vent Field");
  assert.ok(sample(75).some((q) => q.cur) && sample(75).some((q) => q.breathe), "the Deep lacks currents or breathing");
  // A current pushes the craft.
  const { g } = dive(6);
  g.next = 99; g.gates = [{ ...nextGate(270, 0, rng), x: 500, cur: 300 }];
  const vy0 = g.vy; g.y = 270; g.update(DT);
  const { g: h } = dive(6);
  h.next = 99; h.gates = [{ ...nextGate(270, 0, rng), x: 500, cur: 0 }]; h.y = 270; h.update(DT);
  assert.ok(g.vy > h.vy && g.vy > vy0, "the current did not push");
  // The Abyss pings and lights a column.
  const { g: a } = dive(7);
  a.points = 34; a.zone = 3; a.next = 99; a.gates = [{ ...nextGate(270, 34, rng), x: 900, cur: 0 }];
  let lit = 0;
  run(a, 2.2, () => { a.y = 270; a.vy = 0; a.grace = 1; lit = Math.max(lit, a.gates[0]?.lit || 0); });
  assert.ok(lit > 0, "the sonar never reached the column");
});

test("pearls are collected, clean streaks pay pearls, and a shield takes a hit", () => {
  const { g } = dive(8);
  g.next = 99;
  g.pearls = [{ x: 260, y: 270, gate: false, kind: 0, got: 0 }];
  run(g, 0.3, () => { g.y = 270; g.vy = 0; });
  assert.equal(g.R.pearls, 1);
  g.clean = 4;
  g.gates = [{ ...nextGate(270, 0, new Random(1)), x: 140, center: 270, base: 270, amp: 0, margin: 80 }];
  g.y = 270; g.update(DT);
  assert.equal(g.clean, 5);
  assert.equal(g.R.pearls, 4, "five clean passages did not pay three pearls");
  g.shield = 1; g.hull = 1; g.y = 10; g.update(DT);
  assert.equal(g.phase, "play", "the shield did not take the hit");
  assert.equal(g.shield, 0);
  assert.equal(g.R.shielded, 1);
});

test("a run ends, banks its pearls, reaches feats and is scored once; only dives from the shallows set a best", () => {
  const { ctx, g } = dive(9);
  pilot(g, 60);
  g.held = false; g.hull = 1; g.shield = 0; g.grace = 0; g.y = 600; g.update(DT);
  assert.equal(g.phase, "over");
  run(g, 2);
  assert.equal(ctx.calls.score.length, 1);
  const save = ctx.calls.saved.at(-1);
  assert.equal(save.schema, 2);
  assert.equal(save.runs, 1);
  assert.ok(save.bank >= g.R.pearls);
  assert.ok(save.ft.includes("kelp"));
  assert.equal(save.last.passages, g.points);
  assert.ok(save.far >= 1);
  assert.ok(JSON.stringify(save).length < 4096);
  // Starting in a later zone is not scored to the console.
  const c2 = appContext({ seed: 10, progress: { ...save, sel: { craft: 0, start: 1 } } });
  const h = new Undertow(c2);
  tap(h);
  assert.equal(h.points, ZONES[1].at);
  h.hull = 1; h.y = 600; h.update(DT); run(h, 2);
  assert.equal(c2.calls.score.length, 0);
});

test("the dock: tap moves, hold chooses; crafts are bought with pearls; start zones cycle; feats and log page", () => {
  const ctx = appContext({ seed: 11, progress: { schema: 2, runs: 4, bank: 160, far: 2, ft: [] } });
  const g = new Undertow(ctx);
  hold(g);
  assert.equal(g.phase, "dock");
  tap(g); // CRAFT
  hold(g);
  assert.equal(g.sv.sel.craft, 1, "the dart was not bought");
  assert.equal(g.sv.bank, 160 - CRAFTS[1].cost);
  hold(g);
  assert.equal(g.sv.sel.craft, 0, "the unaffordable bulwark was chosen");
  tap(g); hold(g); // START
  assert.equal(g.sv.sel.start, 1);
  hold(g); hold(g);
  assert.equal(g.sv.sel.start, 0, "start zones do not wrap");
  tap(g); tap(g); hold(g); // FEATS
  assert.equal(g.view, "feats");
  tap(g); assert.equal(g.page, 1);
  hold(g); assert.equal(g.view, "menu");
  tap(g); hold(g); // LOG
  assert.equal(g.view, "log");
  tap(g); assert.equal(g.view, "menu");
  const canvas = fakeCanvas();
  for (const view of ["menu", "feats", "log"]) { g.view = view; g.draw(canvas); }
  tap(g); tap(g); hold(g); // DIVE
  assert.equal(g.phase, "play");
  assert.ok(ctx.calls.saved.length >= 3);
});

test("the daily dive is the same for everyone on the same date, uses the skiff, and keeps a streak", () => {
  const goal = dailyGoal("2026-10-01");
  assert.deepEqual(goal, dailyGoal("2026-10-01"));
  assert.ok(goal.n > 0 && goal.text.length > 5);
  const columns = (seed) => {
    const ctx = appContext({ seed, progress: { schema: 2, own: [1, 1, 0], sel: { craft: 1 } } });
    const g = new Undertow(ctx);
    g.daily = true; g.start();
    assert.equal(g.craft.name, "SKIFF");
    run(g, 6, () => { g.y = 270; g.vy = 0; g.grace = 1; });
    return g.gates.map((q) => Math.round(q.base));
  };
  assert.deepEqual(columns(1), columns(2), "the daily dive differs between two launches");
  const key = new Date();
  const today = key.getFullYear() + "-" + String(key.getMonth() + 1).padStart(2, "0") + "-" + String(key.getDate()).padStart(2, "0");
  const y = new Date(key.getFullYear(), key.getMonth(), key.getDate() - 1);
  const yesterday = y.getFullYear() + "-" + String(y.getMonth() + 1).padStart(2, "0") + "-" + String(y.getDate()).padStart(2, "0");
  const ctx = appContext({ seed: 3, progress: { schema: 2, dl: { d: yesterday, done: 1, streak: 2, last: yesterday, best: 4 } } });
  const g = new Undertow(ctx);
  g.daily = true; g.start();
  g.goalMet = () => true;
  g.hull = 1; g.y = 600; g.update(DT); run(g, 2);
  assert.equal(g.sv.dl.d, today);
  assert.equal(g.sv.dl.streak, 3);
  assert.ok(g.sv.ft.includes("daily"));
  assert.equal(ctx.calls.score.length, 0, "a daily dive set the console best");
});

test("a first-release save migrates: runs, last result and milestone kept, reached zones open", () => {
  const old = { schema: 1, runs: 37, last: { passages: 23, reason: "COLUMN CONTACT", milestone: 4 }, milestone: 6 };
  const s = migrateSave(old);
  assert.equal(s.schema, 2);
  assert.equal(s.runs, 37);
  assert.deepEqual(s.last, old.last);
  assert.equal(s.milestone, 6);
  assert.equal(s.far, 2, "a best milestone of 6 (30 passages) reached the Trench");
  assert.equal(s.bank, 0);
  assert.deepEqual(s.own, [1, 0, 0]);
  assert.deepEqual(migrateSave(s), s, "migration is not idempotent");
  for (const junk of [null, undefined, 5, "x", [], { runs: -3, far: 99, ft: ["nope", "kelp", "kelp"], sel: { craft: 2 } }]) {
    const m = migrateSave(junk);
    assert.equal(m.schema, 2);
    assert.ok(m.runs >= 0 && m.far >= 0 && m.far < ZONES.length);
    assert.equal(m.sel.craft, 0, "an unowned craft stayed selected");
  }
  assert.deepEqual(migrateSave({ ft: ["nope", "kelp", "kelp"] }).ft, ["kelp"]);
  // The game loads the old save and the next run writes schema 2 with the history intact.
  const ctx = appContext({ seed: 2, progress: old });
  const g = new Undertow(ctx);
  tap(g); g.hull = 1; g.y = 600; g.update(DT); run(g, 2);
  const saved = ctx.calls.saved.at(-1);
  assert.equal(saved.schema, 2);
  assert.equal(saved.runs, 38);
  assert.equal(saved.milestone, 6);
});

test("feats: every feat can be reached by its counter, and each pays pearls once", () => {
  const ids = new Set(FEATS.map((f) => f.id));
  assert.equal(ids.size, FEATS.length);
  const { g } = dive(12);
  const bank = g.sv.bank;
  g.R.zone = 5; g.R.cleanBest = 10; g.R.noHitBest = 25; g.R.pearls = 20; g.sv.st.pearls = 480; g.R.shielded = 1;
  g.sv.runs = 24; g.R.daily = 1; g.R.skims = 5; g.R.lastBest = 15;
  g.checkFeats();
  assert.equal(g.sv.ft.length, FEATS.length);
  assert.equal(g.sv.bank, bank + 15 * FEATS.length);
  g.checkFeats();
  assert.equal(g.sv.bank, bank + 15 * FEATS.length, "a feat paid twice");
});

test("three quick taps then cancel() keep the dive and leave the lamps off; dispose leaves them off", () => {
  const { ctx, g } = dive(13);
  pilot(g, 5);
  const points = g.points, phase = g.phase;
  for (let i = 0; i < 3; i++) { g.down(); g.update(DT); g.up(); g.update(DT); }
  g.cancel();
  assert.equal(g.phase, phase);
  assert.ok(g.points >= points);
  assert.ok(dark(ctx.calls.leds.at(-1)));
  g.update(DT);
  g.dispose();
  assert.ok(dark(ctx.calls.leds.at(-1)));
});

test("long dive: lamps valid and varied, no NaN, lists bounded, draw never throws in any phase or zone", () => {
  const { ctx, g } = dive(14);
  const canvas = fakeCanvas();
  let maxGates = 0, maxPearls = 0;
  for (let i = 0; i < 60 * 240 && g.phase === "play"; i++) {
    const gate = g.gates.find((q) => q.x + 65 > 202);
    const want = g.y + g.vy * 0.36 > (gate ? gate.center : 270);
    if (want && !g.held) g.down(); else if (!want && g.held) g.up();
    g.update(DT);
    maxGates = Math.max(maxGates, g.gates.length);
    maxPearls = Math.max(maxPearls, g.pearls.length);
    if (i % 30 === 0) { g.draw(canvas); finite(g); }
  }
  assert.ok(maxGates <= 8 && maxPearls <= 24 && g.trail.length <= 30);
  assert.ok(lampsOk(ctx));
  assert.ok(new Set(ctx.calls.leds.map((v) => v.join())).size > 20);
  if (g.phase === "play") { g.hull = 1; g.y = 600; g.update(DT); }
  run(g, 1, () => g.draw(canvas));
  assert.ok(dark(ctx.calls.leds.at(-1)), "lamps lit on the result screen");
  g.phase = "title"; g.draw(canvas);
});

test("canvas text is at least 16 px on every screen", () => {
  const sizes = [];
  const g2d = new Proxy({}, { get: (t, k) => (k === "fillText" ? () => sizes.push(Number(/(\d+(?:\.\d+)?)px/.exec(t.font)?.[1])) : k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  const { g } = dive(15, { progress: { schema: 2, runs: 3, bank: 20 } });
  pilot(g, 20); g.draw(g2d);
  g.hull = 1; g.y = 600; g.update(DT); run(g, 1); g.draw(g2d);
  g.openDock(); for (const view of ["menu", "feats", "log"]) { g.view = view; g.draw(g2d); }
  g.phase = "title"; g.draw(g2d);
  assert.ok(sizes.length > 30);
  assert.ok(Math.min(...sizes) >= 16, "smallest text " + Math.min(...sizes));
});
