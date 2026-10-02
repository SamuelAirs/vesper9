import test from "node:test";
import assert from "node:assert/strict";
import { Crawlspace, migrateSave, SCAN_SECONDS, ACTION_LOCK } from "../web/apps/crawlspace.js";
import { appContext, fakeCanvas, run } from "./helpers/app-context.mjs";

const press = (a) => { a.down({ source: "keyboard" }); a.up({ source: "keyboard", durationMs: 60 }); };
const ready = (options = {}) => { const c = appContext(options), a = new Crawlspace(c); press(a); run(a, ACTION_LOCK + 0.1); return { a, c }; };
const choose = (a, index) => { a.lock = 0; a.scanT = index * SCAN_SECONDS + 0.4; press(a); };

test("opening is safe; swing preview matches the actual damage", () => {
  const { a } = ready();
  assert.equal(a.intent().hit, 0);
  const before = a.enemy.hp, p = a.preview(0);
  assert.equal(p.hit, 7);
  choose(a, 0);
  assert.equal(a.enemy.hp, before - p.hit);
  assert.equal(a.run.hp, 40);
  assert.equal(a.enemy.turn, 1);
});

test("brace trades damage for a cell; the drill spends cells and bypasses armor", () => {
  const { a } = ready();
  a.run.floor = 2; a.enterCombat("mouse"); a.enemy.turn = 1;
  const hp = a.run.hp, cells = a.run.cells;
  assert.equal(a.preview(0).taken, 9);
  assert.equal(a.preview(1).taken, 2);
  choose(a, 1);
  assert.equal(a.run.hp, hp - 2); assert.equal(a.run.cells, cells + 1);
  a.enemy.shield = 8; a.enemy.turn = 0;
  assert.equal(a.preview(0).hit, 0);
  const eHp = a.enemy.hp, drill = a.preview(2).hit;
  choose(a, 2);
  assert.equal(a.enemy.hp, eHp - drill);
  assert.equal(a.run.cells, cells - 1);
});

test("a finishing strike prevents the announced counterattack", () => {
  const { a } = ready();
  a.enterCombat("mouse"); a.enemy.hp = 1; a.enemy.turn = 1;
  const hp = a.run.hp;
  assert.equal(a.preview(0).taken, 0);
  choose(a, 0);
  assert.equal(a.view, "loot"); assert.equal(a.run.hp, hp);
});

test("gear creates distinct guard and full-battery synergies", () => {
  const { a } = ready();
  a.run.relics = ["gloves", "nails", "tape"];
  a.run.hp = 30; a.enterCombat("sump"); a.enemy.turn = 1;
  const hp = a.enemy.hp;
  choose(a, 1);
  assert.equal(a.run.hp, 31); assert.equal(a.enemy.hp, hp - 4); assert.equal(a.enemy.tapeHeals, 1);
  a.run.relics = ["cable", "fuse", "duck"]; a.run.cells = 6; a.enterCombat("owner");
  const p = a.preview(2);
  assert.equal(p.hit, 17); assert.equal(p.taken, 4);
  choose(a, 2);
  assert.equal(a.enemy.weak, 1); assert.equal(a.run.cells, 4);
  assert.equal(a.preview(2).hit, 11, "fuse bonus requires a full battery");
});

test("coffee-tin second swing and crowbar opening alter the best attack", () => {
  const { a } = ready();
  a.run.relics = ["tin", "crowbar"];
  a.enterCombat("sump"); a.enemy.turn = 2; a.enemy.swings = 1;
  assert.equal(a.preview(0).hit, 13);
  a.enemy.swings = 0;
  assert.equal(a.preview(0).hit, 9);
});

test("three slots force a real replacement and supplies preserve the build", () => {
  const { a } = ready();
  a.run.relics = ["cable", "tin", "gloves"]; a.run.cells = 6;
  a.view = "loot"; a.offers = ["duck", "fuse", "ration"];
  choose(a, 0);
  assert.equal(a.view, "replace"); assert.equal(a.pendingLoot, "duck");
  choose(a, 0);
  assert.deepEqual(a.run.relics, ["duck", "tin", "gloves"]);
  assert.ok(a.run.cells <= 4, "removing the lead reduces battery capacity");
  a.view = "loot"; a.offers = ["fuse", "nails", "ration"]; a.run.hp = 20;
  choose(a, 2);
  assert.deepEqual(a.run.relics, ["duck", "tin", "gloves"]); assert.equal(a.run.hp, 28);
});

test("damage pressure grows with enemy turns, never with thinking time", () => {
  const { a } = ready(); a.enterCombat("mouse"); a.enemy.turn = 1;
  const hp = a.run.hp, before = a.intent().hit;
  run(a, 120);
  assert.equal(a.run.hp, hp); assert.equal(a.enemy.turn, 1); assert.equal(a.intent().hit, before);
  a.enemy.turn += 6; assert.equal(a.intent().hit, before + 1);
});

test("presses during action resolution cannot advance a second turn", () => {
  const { a } = ready(); choose(a, 0);
  const hp = a.enemy.hp, turn = a.enemy.turn;
  for (let i = 0; i < 10; i++) press(a);
  assert.equal(a.enemy.hp, hp); assert.equal(a.enemy.turn, turn);
});

test("scan selection applies the calibrated latency at an action boundary", () => {
  const { a } = ready({ settings: { latencyMs: 200 } });
  a.scanT = SCAN_SECONDS + 0.08;
  assert.equal(a.selected(), 1); press(a);
  assert.equal(a.enemy.swings, 1); assert.equal(a.enemy.braced, false);
});

test("win records exactly once and result lockout protects it", () => {
  const { a, c } = ready();
  a.run.floor = 3; a.run.room = 3; a.enterCombat("invoice"); a.enemy.hp = 1;
  choose(a, 0); assert.equal(a.phase, "over"); assert.equal(a.won, true);
  press(a); assert.equal(a.phase, "over");
  a.end(true); run(a, 3);
  assert.equal(c.calls.score.length, 1);
  const save = c.calls.saved.at(-1);
  assert.equal(save.runs, 1); assert.equal(save.wins, 1); assert.equal(save.last.cleared, "YES"); assert.equal(save.active, null);
  assert.equal(migrateSave(save).last.cleared, "YES");
});

test("loss records once; the warranty is one use per run", () => {
  const { a, c } = ready();
  a.run.relics = ["warranty"]; a.run.hp = 1; a.enterCombat("invoice"); a.enemy.turn = 2;
  choose(a, 0); assert.equal(a.run.hp, 12); assert.equal(a.run.warrantyUsed, true);
  a.run.hp = 1; a.enemy.turn = 2; choose(a, 0); run(a, 3);
  assert.equal(a.phase, "over"); assert.equal(a.won, false); assert.equal(c.calls.score.length, 1);
  assert.equal(c.calls.saved.at(-1).last.cleared, "NO");
});

test("disposal checkpoints the actual combat and resumes the same RNG", () => {
  const { a, c } = ready({ seed: 0x1234abcd }); choose(a, 0); run(a, 2);
  const hp = a.run.hp, e = structuredClone(a.enemy), rng = c.rng.state;
  a.dispose();
  assert.deepEqual(c.calls.leds.at(-1), Array(9).fill(0));
  const resumed = ready({ progress: c.calls.saved.at(-1) });
  assert.equal(resumed.a.run.hp, hp); assert.deepEqual(resumed.a.enemy, e); assert.equal(resumed.c.rng.state, rng);
  assert.ok(JSON.stringify(c.calls.saved.at(-1)).length < 3000);
});

test("junk, giant records, and inherited catalog names migrate safely", () => {
  for (const raw of [null, undefined, 3, "junk", [], {}, { runs: -20, wins: Infinity, last: "abc" }, { runs: 1e100, last: { score: NaN, cleared: "YES", extra: "x".repeat(20000) } }]) {
    const sv = migrateSave(raw);
    assert.equal(sv.schema, 1); assert.ok(sv.runs >= 0 && Number.isInteger(sv.runs)); assert.ok(JSON.stringify(sv).length < 3000);
  }
  const { a } = ready();
  const saved = structuredClone(a.sv);
  for (const id of ["constructor", "__proto__", "toString", "unknown"]) {
    const corrupt = structuredClone(saved); corrupt.active.enemy.id = id;
    assert.equal(migrateSave(corrupt).active, null);
    const relic = structuredClone(saved); relic.active.run.relics = [id, "gloves"];
    assert.deepEqual(migrateSave(relic).active.run.relics, ["gloves"]);
  }
});

test("gesture rewind restores combat, RNG, and any pending save at every pace", () => {
  for (const pace of ["standard", "quick", "relaxed"]) {
    const { a, c } = ready({ settings: { gesturePace: pace } });
    a.enemy.hp = 1;
    const picture = () => JSON.stringify({ phase: a.phase, view: a.view, run: a.run, enemy: a.enemy, offers: a.offers, sv: a.sv, rng: c.rng.state, t: a.t, scan: a.scanT });
    const before = picture(), saves = c.calls.saved.length;
    for (let i = 0; i < 2; i++) { a.down(); run(a, 0.067); a.up(); run(a, 0.05); }
    a.down(); run(a, 1.12); a.cancel(); a.pause();
    assert.equal(picture(), before, pace); assert.equal(c.calls.saved.length, saves, pace); assert.equal(c.calls.score.length, 0);
    assert.deepEqual(c.calls.leds.at(-1), Array(9).fill(0)); a.resume();
  }
});

test("even immediate repeated swings survive the opening thirty seconds", () => {
  for (let seed = 1; seed <= 12; seed++) {
    const a = new Crawlspace(appContext({ seed: Math.imul(seed, 0x9e3779b9) >>> 0 })); press(a);
    for (let i = 0; i < 30 * 60; i++) { if (i % 3 === 0) press(a); a.update(1 / 60); assert.equal(a.phase, "play", "seed " + seed + " ended at " + i / 60); }
  }
});

const relicRank = (id) => { const index = ["gloves", "nails", "duck", "fuse", "vac", "tin", "tape", "crowbar", "thermos", "magnet", "cable", "warranty"].indexOf(id); return index < 0 ? 99 : index; };
function tacticalChoice(a) {
  if (a.view === "replace") return a.run.relics.reduce((best, id, i) => relicRank(id) > relicRank(a.run.relics[best]) ? i : best, 0);
  if (a.view === "loot") {
    const best = a.offers.reduce((b, id, i) => relicRank(id) < relicRank(a.offers[b]) ? i : b, 0);
    return a.run.relics.length === 3 && relicRank(a.offers[best]) >= Math.max(...a.run.relics.map(relicRank)) ? 2 : best;
  }
  if (a.view === "route") {
    const heal = a.offers.findIndex((id) => id === "repair" || id === "rewire" && a.run.cells >= 2);
    return a.run.hp < 31 && heal >= 0 ? heal : 0;
  }
  if (a.preview(0).lethal) return 0;
  if (a.preview(2).lethal) return 2;
  return a.intent().hit >= 3 && a.run.cells < (a.run.relics.includes("cable") ? 6 : 4) ? 1 : 2;
}

test("reading intents clears full seeded runs; blindly swinging does not", () => {
  for (const seed of [0x9e3779b9, 0x3c6ef372, 0xdaa66d2b, 0x78dde6e4]) {
    const good = ready({ seed }).a, bad = ready({ seed }).a;
    for (let turns = 0; good.phase === "play" && turns < 220; turns++) choose(good, tacticalChoice(good));
    assert.equal(good.won, true, "tactical seed " + seed);
    assert.equal(good.run.relics.length, 3);
    for (let turns = 0; bad.phase === "play" && turns < 220; turns++) choose(bad, 0);
    assert.equal(bad.phase, "over"); assert.equal(bad.won, false);
  }
});

test("deeper replay starts fresh and scales the enemy, not the scan speed", () => {
  const { a } = ready(); a.end(true); run(a, 1); a.scanT = SCAN_SECONDS + 0.3; press(a);
  assert.equal(a.phase, "play"); assert.equal(a.run.heat, 1); assert.deepEqual(a.run.relics, []);
  assert.equal(a.enemy.maxHp, 23); assert.equal(a.run.hp, 40);
});

test("the system menu can revisit the unlocked heat after a fresh launch", () => {
  const app = new Crawlspace(appContext({ progress: { schema: 1, unlockedHeat: 3 } }));
  const actions = app.menuActions();
  assert.equal(actions.length, 2); assert.equal(actions[1].label, "HEAT 3 HOUSE");
  actions[1].run();
  assert.equal(app.phase, "play"); assert.equal(app.run.heat, 3); assert.equal(app.enemy.maxHp, 33);
  assert.equal(new Crawlspace(appContext()).menuActions().length, 1);
});

test("a minute of mixed input renders all states and keeps valid lamp bytes", () => {
  const { a, c } = ready({ seed: 0xfeedface }), g = fakeCanvas();
  run(a, 60, (i) => { if (i % 89 === 0) press(a); if (i % 7 === 0) a.draw(g); });
  for (const values of c.calls.leds) assert.ok(values.length === 9 && values.every((v) => Number.isInteger(v) && v >= 0 && v <= 255));
  a.pause(); const count = c.calls.leds.length; run(a, 1); assert.equal(c.calls.leds.length, count); a.resume();
  a.dispose(); assert.deepEqual(c.calls.leds.at(-1), Array(9).fill(0));
});
