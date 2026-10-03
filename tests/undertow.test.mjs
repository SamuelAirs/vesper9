// UNDERTOW: the faster dive, zones, pearls, the dock (craft, start zone, daily dive, feats, log) and
// the save migration. The shared game tests (games*.test.mjs, engine.test.mjs, gesture-apps.test.mjs)
// still cover the column rules, the lamps and the menu gesture.
import test from "node:test";
import assert from "node:assert/strict";
import { Undertow, ZONES, CRAFTS, FEATS, UPGRADES, SPECIES, migrateSave, dailyGoal, nextGate, undertowSpeed, gateInterval } from "../web/apps/undertow.js";
import { appContext, fakeCanvas, run } from "./helpers/app-context.mjs";
import { Random } from "../web/engine/math.js";

const DT = 1 / 60;
const CX_TEST = 220; // the craft's screen x
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
  assert.ok(g.parked > 0, "the first dive of a session does not wait for a press");
  run(g, 1);
  assert.equal(g.gates.length, 0, "a column came while the craft was waiting");
  assert.equal(g.y, 270);
  tap(g);
  assert.equal(g.parked, 0);
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
  run(idle, 30); // the wait for a first press runs out after three seconds
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
  g.parked = 0; g.next = 99; g.gates = [{ ...nextGate(270, 0, rng), x: 500, cur: 300 }];
  const vy0 = g.vy; g.y = 270; g.update(DT);
  const { g: h } = dive(6);
  h.parked = 0; h.next = 99; h.gates = [{ ...nextGate(270, 0, rng), x: 500, cur: 0 }]; h.y = 270; h.update(DT);
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
  assert.equal(save.schema, 3);
  assert.equal(save.runs, 1);
  assert.ok(save.dm > 0 && save.dm === save.last.metres, "the deepest dive in metres was not kept");
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

test("the dock: tap moves, hold chooses; crafts are bought with pearls; start zones cycle; guide and log", () => {
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
  tap(g); tap(g); hold(g); // START (past REFIT)
  assert.equal(g.sv.sel.start, 1);
  hold(g); hold(g);
  assert.equal(g.sv.sel.start, 0, "start zones do not wrap");
  tap(g); tap(g); hold(g); // GUIDE
  assert.equal(g.view, "guide");
  tap(g); assert.equal(g.view, "menu");
  tap(g); hold(g); // LOG (feats are listed by the console logbook now)
  assert.equal(g.view, "log");
  tap(g); assert.equal(g.view, "menu");
  const canvas = fakeCanvas();
  for (const view of ["menu", "refit", "guide", "log"]) { g.view = view; g.draw(canvas); }
  g.view = "menu";
  tap(g); hold(g); // DIVE (from LOG, the last line)
  assert.equal(g.phase, "play");
  assert.ok(ctx.calls.saved.length >= 3);
});

test("the daily dive is the same for everyone on the same date, uses the skiff, and reports to the console logbook", () => {
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
  // The streak lives in the console logbook: the game states the daily goal as its order and says
  // when it is met, once a day; its own save keeps only today's best and whether it is done.
  const ctx = appContext({ seed: 3, progress: { schema: 2, dl: { d: yesterday, done: 1, streak: 2, last: yesterday, best: 4 } } });
  const book = { daily: [], met: 0, feats: [] };
  ctx.daily = (text) => book.daily.push(text);
  ctx.dailyMet = () => book.met++;
  ctx.feat = (id, name) => book.feats.push(id + ":" + name);
  const g = new Undertow(ctx);
  assert.equal(g.sv.dl.streak, undefined, "the game still keeps a streak of its own");
  g.daily = true; g.start();
  run(g, 1);
  assert.deepEqual(book.daily, ["Daily dive: " + dailyGoal(today).text]);
  g.goalMet = () => true;
  g.hull = 1; g.y = 600; g.update(DT); run(g, 2);
  assert.equal(g.sv.dl.d, today);
  assert.equal(g.sv.dl.done, 1);
  assert.equal(book.met, 1);
  g.daily = true; g.start(); g.goalMet = () => true;
  g.hull = 1; g.y = 600; g.update(DT); run(g, 2);
  assert.equal(book.met, 1, "the order was met twice in one day");
  assert.equal(ctx.calls.score.length, 0, "a daily dive set the console best");
});

test("a first-release save migrates: runs, last result and milestone kept, reached zones open", () => {
  const old = { schema: 1, runs: 37, last: { passages: 23, reason: "COLUMN CONTACT", milestone: 4 }, milestone: 6 };
  const s = migrateSave(old);
  assert.equal(s.schema, 3);
  assert.equal(s.runs, 37);
  assert.deepEqual(s.last, old.last);
  assert.equal(s.milestone, 6);
  assert.equal(s.far, 2, "a best milestone of 6 (30 passages) reached the Trench");
  assert.equal(s.bank, 0);
  assert.deepEqual(s.own, [1, 0, 0]);
  assert.deepEqual(migrateSave(s), s, "migration is not idempotent");
  for (const junk of [null, undefined, 5, "x", [], { runs: -3, far: 99, ft: ["nope", "kelp", "kelp"], sel: { craft: 2 } }]) {
    const m = migrateSave(junk);
    assert.equal(m.schema, 3);
    assert.ok(m.runs >= 0 && m.far >= 0 && m.far < ZONES.length);
    assert.equal(m.sel.craft, 0, "an unowned craft stayed selected");
  }
  assert.deepEqual(migrateSave({ ft: ["nope", "kelp", "kelp"] }).ft, ["kelp"]);
  // The game loads the old save and the next run writes schema 3 with the history intact.
  const ctx = appContext({ seed: 2, progress: old });
  const g = new Undertow(ctx);
  tap(g); g.hull = 1; g.y = 600; g.update(DT); run(g, 2);
  const saved = ctx.calls.saved.at(-1);
  assert.equal(saved.schema, 3);
  assert.equal(saved.runs, 38);
  assert.equal(saved.milestone, 6);
});

test("feats: every feat can be reached by its counter, pays pearls once and goes to the console logbook once", () => {
  const ids = new Set(FEATS.map((f) => f.id));
  assert.equal(ids.size, FEATS.length);
  assert.ok(!ids.has("daily"), "the daily feat belongs to the console logbook");
  const sent = [];
  const { ctx, g } = dive(12);
  ctx.feat = (id, name) => sent.push(id + ":" + name);
  const bank = g.sv.bank;
  g.R.zone = 5; g.R.cleanBest = 10; g.R.noHitBest = 25; g.R.pearls = 20; g.sv.st.pearls = 480; g.R.shielded = 1;
  g.sv.runs = 24; g.R.daily = 1; g.R.skims = 5; g.R.lastBest = 15; g.R.found = SPECIES.map((s) => s.id);
  g.checkFeats();
  assert.equal(g.sv.ft.length, FEATS.length);
  assert.equal(g.sv.bank, bank + 15 * FEATS.length);
  g.checkFeats();
  assert.equal(g.sv.bank, bank + 15 * FEATS.length, "a feat paid twice");
  run(g, 1);
  assert.deepEqual(sent, FEATS.map((f) => f.id + ":" + f.name), "feats did not each reach the logbook once");
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
  let maxGates = 0, maxPearls = 0, maxLife = 0;
  const seenLife = new Set();
  for (let i = 0; i < 60 * 240 && g.phase === "play"; i++) {
    const gate = g.gates.find((q) => q.x + 65 > 202);
    const want = g.y + g.vy * 0.36 > (gate ? gate.center : 270);
    if (want && !g.held) g.down(); else if (!want && g.held) g.up();
    g.update(DT);
    maxGates = Math.max(maxGates, g.gates.length);
    maxPearls = Math.max(maxPearls, g.pearls.length);
    maxLife = Math.max(maxLife, g.life.length);
    for (const f of g.life) seenLife.add(f.id);
    if (i % 30 === 0) { g.draw(canvas); finite(g); }
  }
  assert.ok(maxGates <= 8 && maxPearls <= 24 && g.trail.length <= 30 && maxLife <= 6);
  assert.ok(seenLife.size >= 6, "sea life from only " + seenLife.size + " species was seen");
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
  g.sv.sp = SPECIES.map((s) => s.id);
  g.openDock(); for (const view of ["menu", "refit", "guide", "log"]) { g.view = view; g.draw(g2d); }
  g.phase = "title"; g.draw(g2d);
  assert.ok(sizes.length > 30);
  assert.ok(Math.min(...sizes) >= 16, "smallest text " + Math.min(...sizes));
});

test("sea life: each zone has its own two species; flying close logs one once and banks pearls", () => {
  assert.equal(SPECIES.length, 12);
  for (let z = 0; z < ZONES.length; z++) assert.equal(SPECIES.filter((s) => s.zone === z).length, 2);
  const { ctx, g } = dive(21);
  g.parked = 0; g.next = 99;
  run(g, 3, () => { g.y = 270; g.vy = 0; g.grace = 1; });
  assert.ok(g.life.length >= 1, "no sea life came in the first three seconds");
  assert.ok(g.life.every((f) => SPECIES.find((s) => s.id === f.id).zone === 0), "a creature from another zone");
  // A creature 80 px from the craft (inside the scan radius, not touching) is logged once the ring
  // fills, after about a quarter of a second; a touch logs at once; a species pays only once, even
  // when two of it are on screen.
  g.life = [{ id: "moon", x: CX_TEST + 80, y: 270, vx: 0, ph: 0, scan: 0, done: 0, fl: 0 },
    { id: "moon", x: 700, y: 270, vx: 0, ph: 0, scan: 0, done: 0, fl: 0 }];
  const keep = () => { g.y = 270; g.vy = 0; g.grace = 1; g.life[0].x = CX_TEST + 80; g.life[0].y = 270; };
  run(g, 0.15, keep);
  assert.equal(g.R.found.length, 0, "logged too soon");
  run(g, 0.2, keep);
  assert.deepEqual(g.R.found, ["moon"]);
  g.life[1].x = CX_TEST; g.life[1].y = 270;
  run(g, 0.5, () => { g.y = 270; g.vy = 0; g.grace = 1; });
  assert.equal(g.R.lifeP, 10, "a species paid twice");
  g.life = [{ id: "shoal", x: CX_TEST + 10, y: 280, vx: 0, ph: 0, scan: 0, done: 0, fl: 0 }];
  g.update(DT);
  assert.deepEqual(g.R.found, ["moon", "shoal"], "a touch did not log at once");
  g.R.found = ["moon"]; g.R.lifeP = 10;
  const bank = g.sv.bank;
  g.hull = 1; g.grace = 0; g.y = 600; g.update(DT); run(g, 1);
  assert.equal(g.sv.bank, bank + g.R.pearls + 10);
  assert.deepEqual(ctx.calls.saved.at(-1).sp, ["moon"]);
  // A logged species does not pay again on the next dive.
  tap(g);
  assert.ok(g.known("moon"));
  assert.equal(g.R.lifeP, 0);
});

test("refits: bought level by level with pearls at the dock, used in dives, not on the daily dive", () => {
  const ctx = appContext({ seed: 22, progress: { schema: 2, runs: 4, bank: 700, far: 3 } });
  const g = new Undertow(ctx);
  hold(g); tap(g); tap(g); hold(g); // REFIT
  assert.equal(g.view, "refit");
  hold(g); hold(g); hold(g); // the magnet twice, then it is full
  assert.deepEqual(g.sv.up, [2, 0, 0, 0]);
  assert.equal(g.sv.bank, 700 - 120 - 260);
  tap(g); hold(g); // the assay
  assert.equal(g.sv.up[1], 1);
  assert.equal(g.sv.bank, 20);
  tap(g); hold(g); // the lure: too dear
  assert.equal(g.sv.up[2], 0);
  assert.equal(g.sv.bank, 20);
  tap(g); tap(g); hold(g); // BACK
  assert.equal(g.view, "menu");
  assert.equal(ctx.calls.saved.at(-1).up[0], 2);
  g.view = "menu"; g.cur = 0; hold(g); // DIVE
  assert.equal(g.phase, "play");
  assert.equal(g.hull, CRAFTS[0].hull, "a refit changed the hull: refits must never help survival");
  // The magnet reaches a pearl the bare craft would miss.
  g.parked = 0; g.next = 99;
  g.pearls = [{ x: 260, y: 305, gate: false, kind: 0, got: 0 }];
  run(g, 0.3, () => { g.y = 270; g.vy = 0; });
  assert.equal(g.R.pearls, 1, "the magnet did not reach");
  // The assay pays 5 for every fifth clean passage.
  g.clean = 4;
  g.gates = [{ ...nextGate(270, 0, new Random(1)), x: 140, center: 270, base: 270, amp: 0, margin: 80 }];
  g.y = 270; g.update(DT);
  assert.equal(g.R.pearls, 6, "the assay did not pay five");
  const d = new Undertow(appContext({ seed: 23, progress: { schema: 3, up: [2, 1, 1, 1] } }));
  d.daily = true; d.start();
  assert.equal(d.lv("magnet"), 0, "the daily dive used a refit");
  assert.equal(d.lv("assay"), 0);
});

test("a schema-2 save migrates to schema 3 with empty refits and guide, and junk is cleaned", () => {
  const two = { schema: 2, runs: 9, last: { passages: 30 }, milestone: 6, far: 2, bank: 55, own: [1, 1, 0], cb: [30, 12, 0], ft: ["kelp"], st: { pearls: 80, daily: 1, passages: 120 }, sel: { craft: 1, start: 2 }, dl: {} };
  const s = migrateSave(two);
  assert.equal(s.schema, 3);
  assert.deepEqual(s.up, [0, 0, 0, 0]);
  assert.deepEqual(s.sp, []);
  assert.equal(s.dm, 0);
  assert.equal(s.st.passages, 120);
  assert.deepEqual([s.runs, s.bank, s.far, s.sel.craft, s.sel.start], [9, 55, 2, 1, 2]);
  const junk = migrateSave({ schema: 3, up: [9, -1, "x"], sp: ["moon", "moon", "kraken"], dm: -4 });
  assert.deepEqual(junk.up, [UPGRADES[0].costs.length, 0, 0, 0]);
  assert.deepEqual(junk.sp, ["moon"]);
  assert.equal(junk.dm, 0);
  assert.deepEqual(migrateSave(s), s);
});

test("the Trench eases its currents in: none on its first columns, rarer and gentler early than late", () => {
  const stats = (from, to) => {
    const rng = new Random(5);
    let n = 0, on = 0, sum = 0;
    for (let i = 0; i < 4000; i++) {
      const q = nextGate(270, from + (i % (to - from)), rng);
      n++; if (q.cur) { on++; sum += Math.abs(q.cur); }
    }
    return { share: on / n, mean: on ? sum / on : 0 };
  };
  const first = stats(20, 22), early = stats(22, 26), late = stats(30, 34), deep = stats(70, 80);
  assert.equal(first.share, 0, "a current on the Trench's first two columns");
  assert.ok(early.share < late.share - 0.15, "early " + early.share + " late " + late.share);
  assert.ok(early.mean < 170 && late.mean > 210, "early " + early.mean + " late " + late.mean);
  assert.ok(deep.share > 0.4 && deep.mean >= 300);
});

test("sea life can be caught in passing: a laggy pilot that steers for creatures logs most of them", () => {
  // Sam (2026-10-03): "it's pretty much impossible to catch a fish, you swing past it". A pilot with
  // 200 ms of lag that steers for the next unlogged creature when no column is close.
  let seen = 0, caught = 0;
  for (const seed of [31, 32, 33, 34]) {
    const { g } = dive(seed);
    const lag = 12, q = [], missed = new Set();
    for (let i = 0; i < 40 * 60 && g.phase === "play"; i++) {
      g.grace = 1; // this test is about catching, not columns
      const f = g.life.find((o) => !o.done && o.x > CX_TEST && o.x < 960);
      const gate = g.gates.find((o) => o.x + 65 > 202);
      const target = f && (!gate || gate.x - 202 > f.x - CX_TEST) ? f.y : gate ? gate.center : 270;
      q.push(g.y + g.vy * 0.36 > target);
      const want = q.length > lag ? q[q.length - 1 - lag] : false;
      if (want && !g.held) g.down(); else if (!want && g.held) g.up();
      for (const o of g.life) if (!o.done && o.x < CX_TEST - 60) missed.add(o); // got past the craft
      g.update(DT);
    }
    seen += g.R.found.length + missed.size;
    caught += g.R.found.length;
  }
  assert.ok(caught >= 8 && caught / seen > 0.75, "caught " + caught + " of " + seen);
});

test("four lamps: the gauge stays on lamps 1-3 and lamp 4 is the finder; three-lamp nodes are unchanged", () => {
  const ctx = appContext({ seed: 41 });
  ctx.lampCount = () => 4;
  const g = new Undertow(ctx);
  g.update(DT);
  tap(g);
  g.parked = 0; g.next = 99;
  g.life = [];
  run(g, 0.5, () => { g.y = 270; g.vy = 0; });
  const fourth = () => ctx.calls.leds.at(-1).slice(9);
  assert.ok(ctx.calls.leds.every((v) => v.length === 12 && v.every((x) => Number.isInteger(x) && x >= 0 && x <= 255)));
  assert.ok(fourth().some((x) => x > 0), "with nothing about, lamp 4 should show the zone's colour, dimly");
  // An unlogged creature ahead: green, brighter as it closes.
  g.life = [{ id: "moon", x: 800, y: 270, vx: 0, ph: 0, scan: 0, done: 0, fl: 0 }];
  let far = 0, close = 0;
  run(g, 0.6, () => { g.y = 270; g.vy = 0; g.grace = 1; g.life[0].x = 800; g.life[0].y = 270; far = Math.max(far, ctx.calls.leds.at(-1)[10]); });
  run(g, 0.6, () => { g.y = 270; g.vy = 0; g.grace = 1; g.life[0].x = 420; g.life[0].y = 270; g.life[0].scan = 0; close = Math.max(close, ctx.calls.leds.at(-1)[10]); });
  assert.ok(far > 0 && close > far, "the finder did not brighten: " + far + " / " + close);
  // A catch flashes it white (red and green both high).
  g.life[0].x = 225; g.life[0].y = 270; g.update(DT);
  const [r, gr] = fourth();
  assert.ok(g.R.found.includes("moon") && r > 150 && gr > 100, "no white flash on a catch: " + fourth());
  // Dark after cancel, and on the result screen.
  g.cancel();
  assert.ok(dark(ctx.calls.leds.at(-1)) && ctx.calls.leds.at(-1).length === 12);
  g.hull = 1; g.grace = 0; g.y = 600; g.update(DT); run(g, 1);
  assert.ok(dark(ctx.calls.leds.at(-1)));
  // A three-lamp node gets nine values, as before.
  const { ctx: c3, g: h } = dive(42);
  run(h, 1);
  assert.ok(c3.calls.leds.length > 0 && c3.calls.leds.every((v) => v.length === 9));
});

test("save slots: Undertow opts in, a fresh slot starts clean, and each slot's row names its zone and guide", () => {
  assert.equal(Undertow.saveSlots, true);
  const g = new Undertow(appContext({ seed: 51, progress: {} }));
  assert.equal(g.sv.runs, 0);
  assert.equal(g.sv.bank, 0);
  assert.deepEqual(g.sv.sp, []);
  assert.equal(g.slotSummary({}), "NO DIVES YET");
  const row = g.slotSummary({ schema: 3, runs: 12, far: 3, sp: ["moon", "shoal", "ray"] });
  assert.equal(row, "ABYSS · GUIDE 3/12");
  for (let far = 0; far < ZONES.length; far++) assert.ok(g.slotSummary({ runs: 1, far, sp: SPECIES.map((s) => s.id) }).length <= 24);
  assert.equal(g.slotSummary({ schema: 1, runs: 37, milestone: 6 }), "TRENCH · GUIDE 0/12", "a first-release save is summarised after migration");
});
