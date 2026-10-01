// Orbit Lock depth: perfect locks and the shield, dark gates, feats, the daily order and streak,
// and the schema 2 save (with a schema 1 save from the first release loading intact).
import test from "node:test";
import assert from "node:assert/strict";
import { OrbitLock, orbitWindow, orbitSpeed, orbitPerfect, darkGate, migrateOrbit, orbitOrder, ORBIT_FEATS, SHIELD_CHAIN, DARK_FROM } from "../web/apps/orbit.js";
import { makeCtx, makeRig, step, DT } from "./audit/harness.mjs";
import { gauss, gestureWithUpdates } from "./audit/bots.mjs";

// A lock exactly on the gate's centre (perfect) or just inside its edge (plain).
const perfect = (g) => { g.target = g.angle; g.down(); g.up(); };
const plain = (g) => { g.target = g.angle + orbitWindow(g.points) * 0.9; g.down(); g.up(); };
const miss = (g) => { g.target = g.angle + 3; g.down(); g.up(); };
const onDay = (g, key) => { g.dayKey = () => key; return g; };
// An order of each kind, found by scanning dates (the order is a pure function of the date).
function dayWith(kind) {
  for (let d = 1; d < 400; d++) {
    const key = "2026-" + String(1 + Math.floor(d / 29) % 12).padStart(2, "0") + "-" + String(1 + (d % 28)).padStart(2, "0");
    if (orbitOrder(key).kind === kind) return key;
  }
  throw new Error("no day with " + kind);
}
function textOf(g) {
  const painted = [];
  const g2d = new Proxy({}, { get: (t, k) => (k === "fillText" ? (s) => painted.push({ s: String(s), size: Number(/(\d+)px/.exec(t.font)?.[1]) }) : k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  g.draw(g2d);
  return painted;
}

test("perfect locks: the zone is the gate's centre and shrinks with it, never wider than the gate", () => {
  for (const p of [0, 10, 25, 40, 60]) {
    assert.ok(orbitPerfect(p) < orbitWindow(p));
    assert.ok(orbitPerfect(p) <= 0.07);
  }
  assert.ok(orbitPerfect(40) < orbitPerfect(10));
  const g = new OrbitLock(makeCtx(1)); g.down();
  perfect(g);
  assert.equal(g.chain, 1); assert.equal(g.R.perfects, 1); assert.match(g.feedback, /PERFECT/);
  plain(g);
  assert.equal(g.points, 2); assert.equal(g.chain, 0, "a plain lock keeps the chain");
});

test("four perfect locks in a row charge a shield; it takes one mistimed press and no hull", () => {
  const g = new OrbitLock(makeCtx(2)); g.down();
  for (let i = 0; i < SHIELD_CHAIN - 1; i++) perfect(g);
  assert.equal(g.shield, 0);
  perfect(g);
  assert.equal(g.shield, 1, "no shield after " + SHIELD_CHAIN + " perfect locks");
  const target = g.target;
  miss(g);
  assert.equal(g.lives, 3, "the shielded miss cost hull");
  assert.equal(g.shield, 0);
  assert.equal(g.chain, 0);
  assert.equal(g.R.saves, 1);
  assert.match(g.feedback, /SHIELD SPENT/);
  assert.notEqual(g.target, target + 99); // the gate is not moved by the miss
  miss(g);
  assert.equal(g.lives, 2, "the shield worked twice");
  // Only one shield at a time.
  for (let i = 0; i < SHIELD_CHAIN * 2; i++) perfect(g);
  assert.equal(g.shield, 1);
});

test("a shield does not stop the hull decaying when nothing is locked for ten seconds", () => {
  const g = new OrbitLock(makeCtx(3)); g.down();
  for (let i = 0; i < SHIELD_CHAIN; i++) perfect(g);
  assert.equal(g.shield, 1);
  g.target = g.angle + 3; g.drift = 0;
  step(g, 10.1);
  assert.equal(g.lives, 2);
  assert.equal(g.shield, 1, "idle decay spent the shield");
});

test("dark gates: from the 30th lock every third gate shows only on lamp I", () => {
  const dark = [];
  for (let p = 0; p < 45; p++) if (darkGate(p)) dark.push(p);
  assert.equal(dark[0], 32);
  assert.ok(dark.every((p) => p >= DARK_FROM && p % 3 === 2));
  const c = makeCtx(4), g = new OrbitLock(c); g.down();
  while (g.points < 32) plain(g);
  assert.equal(g.dark, true);
  // The gate is not painted: no 16-wide arc. Count arcs drawn at the gate's radius.
  let arcs = 0;
  const g2d = new Proxy({}, { get: (t, k) => (k === "arc" ? () => { if (t.lineWidth === 16) arcs++; } : k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  g.draw(g2d);
  assert.equal(arcs, 0, "a dark gate was drawn");
  assert.ok(textOf(g).some((x) => /DARK GATE/.test(x.s)));
  // Lamp I is white at the gate's centre, amber elsewhere inside it, dim far away.
  g.drift = 0; g.target = g.angle;
  g.update(DT); g.target = g.angle;
  assert.deepEqual(g.lampValues().slice(0, 3), [230, 180, 135]);
  g.target = g.angle + orbitWindow(g.points) * 0.8;
  assert.equal(g.lampValues()[0], 230); // amber 0.9
  assert.equal(g.lampValues()[1], 99);
  perfect(g);
  assert.equal(g.R.dark, 1);
  assert.equal(g.dark, false);
  // A miss on a dark gate shows it in red.
  while (!g.dark) plain(g);
  arcs = 0; miss(g); g.draw(g2d);
  assert.ok(arcs > 0, "a missed dark gate was not shown");
});

test("feats: met during the run, announced once, kept in the save with the run", () => {
  const c = makeCtx(5, { progress: {} }), g = new OrbitLock(c); g.down();
  for (let i = 0; i < 10; i++) plain(g);
  assert.ok(g.sv.ft.includes("l10"));
  assert.deepEqual(g.fresh, ["l10"]);
  assert.match(g.note, /FIRST CONTACT/);
  for (let i = 0; i < 3; i++) miss(g);
  assert.equal(g.phase, "over");
  assert.equal(c.log.saves.length, 0, "saved inside the gesture window");
  step(g, 2.2);
  assert.equal(c.log.saves.length, 1);
  const save = c.log.saves[0];
  assert.equal(save.schema, 2);
  assert.equal(save.runs, 1);
  assert.deepEqual(save.ft, ["l10"]);
  assert.equal(save.st.locks, 10);
  assert.equal(save.st.best, 10);
  assert.deepEqual(save.last, { locks: 10, milestone: 2, perfects: 0, chain: 0 });
  assert.equal(save.milestone, 2);
  assert.deepEqual(c.log.scores.map((s) => s.n), [10]);
  // The next run starts from the save, and the result screen names the new feat.
  const painted = textOf(g).map((x) => x.s).join(" | ");
  assert.match(painted, /NEW FEAT: FIRST CONTACT/);
  const h = new OrbitLock(makeCtx(6, { progress: save }));
  assert.deepEqual(h.sv.ft, ["l10"]);
  h.down(); for (let i = 0; i < 10; i++) plain(h);
  assert.deepEqual(h.fresh, [], "an earned feat was earned again");
});

test("lifetime feats count every run once: VETERAN at 1000 locks in all", () => {
  const c = makeCtx(7, { progress: { schema: 2, runs: 50, st: { locks: 995 } } }), g = new OrbitLock(c);
  g.down();
  for (let i = 0; i < 4; i++) plain(g);
  assert.ok(!g.sv.ft.includes("veteran"));
  plain(g);
  assert.ok(g.sv.ft.includes("veteran"), "999 + 1");
  for (let i = 0; i < 3; i++) miss(g);
  step(g, 2.2);
  assert.equal(c.log.saves[0].st.locks, 1000);
});

test("hidden feats show a hint on the title until earned", () => {
  const hidden = ORBIT_FEATS.filter((f) => f.hidden);
  assert.ok(hidden.length >= 2 && hidden.every((f) => f.hint));
  const g = new OrbitLock(makeCtx(8));
  const at = ORBIT_FEATS.indexOf(hidden[0]);
  g.t = at * 3 + 0.1;
  const words = textOf(g).map((x) => x.s).join(" | ");
  assert.match(words, /\? \? \?/);
  assert.ok(words.includes(hidden[0].hint));
  assert.ok(!words.includes(hidden[0].name));
});

test("daily order: the same for a date, met mid-run, streak grows on consecutive days and restarts after a gap", () => {
  assert.deepEqual(orbitOrder("2026-10-01"), orbitOrder("2026-10-01"));
  const kinds = new Set(); for (let d = 1; d <= 28; d++) kinds.add(orbitOrder("2026-02-" + String(d).padStart(2, "0")).kind);
  assert.equal(kinds.size, 4, "all order kinds occur");
  const key = dayWith("sector"), o = orbitOrder(key);
  const c = makeCtx(9, { progress: { schema: 2, dl: { d: "x", done: 0, streak: 4, last: "2000-01-01" } } });
  const g = onDay(new OrbitLock(c), key); g.down();
  while (Math.floor(g.points / 5) + 1 < o.n) { assert.equal(g.orderMet, false); plain(g); }
  assert.equal(g.orderMet, true);
  assert.equal(g.sv.dl.streak, 1, "a streak survived a gap");
  assert.match(g.note, /DAILY ORDER MET/);
  for (let i = 0; i < 3; i++) miss(g);
  step(g, 2.2);
  const save = c.log.saves[0];
  assert.equal(save.dl.done, 1); assert.equal(save.dl.d, key); assert.equal(save.st.daily, 1);
  assert.ok(save.ft.includes("daily"));
  // The next day continues the streak; the same day does not count twice.
  const [y, m, d] = key.split("-").map(Number);
  const next = new Date(y, m - 1, d + 1), nextKey = next.getFullYear() + "-" + String(next.getMonth() + 1).padStart(2, "0") + "-" + String(next.getDate()).padStart(2, "0");
  const again = onDay(new OrbitLock(makeCtx(10, { progress: save })), key); again.down();
  for (let i = 0; i < 30; i++) plain(again);
  assert.equal(again.sv.dl.streak, 1);
  const h = onDay(new OrbitLock(makeCtx(11, { progress: save })), nextKey);
  h.R.chainMax = 99; h.R.perfects = 99; h.R.clean = 99; h.points = 99; h.phase = "play";
  h.checkOrder();
  assert.equal(h.sv.dl.streak, 2);
});

test("leaving mid-run keeps a daily order met on the way, but a menu pause saves nothing", () => {
  const key = dayWith("sector"), c = makeCtx(12, { progress: {} }), g = onDay(new OrbitLock(c), key);
  g.down();
  while (!g.orderMet) plain(g);
  g.pause(); g.resume();
  assert.equal(c.log.saves.length, 0);
  g.dispose();
  assert.equal(c.log.saves.length, 1);
  assert.equal(c.log.saves[0].dl.done, 1);
});

test("migration: a first-release save loads with its runs, milestone and last result intact", () => {
  const old = { schema: 1, runs: 7, last: { locks: 23, milestone: 4 }, milestone: 6 };
  const sv = migrateOrbit(old);
  assert.equal(sv.schema, 2);
  assert.equal(sv.runs, 7); assert.equal(sv.milestone, 6);
  assert.deepEqual(sv.last, { locks: 23, milestone: 4 });
  assert.equal(sv.st.best, 23);
  assert.deepEqual(sv.ft, []);
  for (const junk of [null, undefined, 3, "x", [], { runs: "a", ft: ["l10", "nope", "l10"], st: { locks: -5 }, dl: { streak: NaN, d: 4 } }]) {
    const m = migrateOrbit(junk);
    assert.equal(m.schema, 2);
    assert.ok(Number.isFinite(m.runs) && m.runs >= 0);
    assert.ok(m.st.locks >= 0);
    assert.ok(Array.isArray(m.ft) && new Set(m.ft).size === m.ft.length && m.ft.every((id) => ORBIT_FEATS.some((f) => f.id === id)));
    assert.equal(typeof m.dl.d, "string");
  }
  // A run on top of the old save keeps counting from it.
  const c = makeCtx(13, { progress: old }), g = new OrbitLock(c); g.down();
  plain(g); for (let i = 0; i < 3; i++) miss(g);
  step(g, 2.2);
  assert.equal(c.log.saves[0].runs, 8);
  assert.equal(c.log.saves[0].milestone, 6);
  assert.ok(JSON.stringify(c.log.saves[0]).length < 2048);
});

test("the menu gesture takes back the chain, the shield, the run's tallies and any feat it earned", () => {
  const c = makeCtx(14), g = new OrbitLock(c), rig = makeRig(g, c);
  g.down();
  for (let i = 0; i < 9; i++) perfect(g);
  g.target = 0; g.angle = 3;
  const keys = ["chain", "shield", "R", "sv", "fresh", "points", "lives", "orderMet"];
  const before = Object.fromEntries(keys.map((k) => [k, structuredClone(g[k])]));
  gestureWithUpdates(g, rig);
  assert.equal(rig.menuOpen, 1);
  for (const k of keys) assert.deepEqual(g[k], before[k], k + " was not restored");
});

test("title: dark lamps, rank, today's order and a feat; all text at least 16 px", () => {
  const c = makeCtx(15), g = new OrbitLock(c);
  step(g, 1);
  assert.ok(c.ledsNow.every((v) => v === 0));
  const painted = textOf(g);
  const words = painted.map((x) => x.s).join(" | ");
  assert.match(words, /RANK CADET/);
  assert.match(words, /TODAY: /);
  assert.match(words, /FEATS 0 \/ 15/);
  assert.ok(painted.every((x) => x.size >= 16));
  g.down(); for (let i = 0; i < 3; i++) miss(g);
  assert.ok(textOf(g).every((x) => x.size >= 16));
});

test("tuning: a timing player with 50 ms of error reaches the dark gates; the shield adds only a little", () => {
  const results = [];
  for (let seed = 1; seed <= 8; seed++) {
    const c = makeCtx(seed), g = new OrbitLock(c); g.down();
    let at = null, t = 0;
    for (let i = 0; i < 60 * 900 && g.phase === "play"; i++) {
      t += DT;
      if (at === null) at = t + g.ahead() / (orbitSpeed(g.points) - g.drift * g.dir) + gauss(c.rng, 0.05);
      if (t >= at) { g.down(); g.up(); at = null; }
      g.update(DT);
    }
    assert.equal(g.phase, "over");
    results.push({ locks: g.points, perfects: g.R.perfects, saves: g.R.saves });
  }
  const mean = results.reduce((a, r) => a + r.locks, 0) / results.length;
  const saves = results.reduce((a, r) => a + r.saves, 0) / results.length;
  console.log("orbit bot 50 ms:", results.map((r) => r.locks + "/" + r.perfects + "/" + r.saves).join(" "));
  assert.ok(mean >= 30 && mean <= 50, "mean locks " + mean);
  assert.ok(saves <= 2, "shields saved " + saves + " misses a run");
});
