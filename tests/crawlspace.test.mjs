import test from "node:test";
import assert from "node:assert/strict";
import { Crawlspace, migrateSave, ACTION_LOCK, GUIDE } from "../web/apps/crawlspace.js";
import { HOLD } from "../web/apps/after-hours-kit.js";
import { appContext, fakeCanvas, run } from "./helpers/app-context.mjs";

// A tap moves to the next card; a hold that is released does the card.
const tap = (a) => { a.down({ source: "keyboard" }); a.up({ source: "keyboard", durationMs: 60 }); };
const hold = (a) => { a.down({ source: "keyboard" }); a.up({ source: "keyboard", durationMs: HOLD * 1000 + 150 }); };
// From the title: the first press opens HOW TO PLAY (first run only); a hold skips the rest of it.
const ready = (options = {}) => {
  const c = appContext(options), a = new Crawlspace(c);
  tap(a); if (a.guide >= 0) hold(a);
  run(a, ACTION_LOCK + 0.1); return { a, c };
};
const choose = (a, index) => { a.lock = 0; while (a.cursor !== index) tap(a); hold(a); };

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
  for (let i = 0; i < 10; i++) hold(a);
  assert.equal(a.enemy.hp, hp); assert.equal(a.enemy.turn, turn);
});

test("a tap only moves to the next card; a released hold does that card", () => {
  const { a } = ready();
  assert.equal(a.cursor, 0);
  tap(a); assert.equal(a.cursor, 1); assert.equal(a.enemy.turn, 0);
  tap(a); tap(a); assert.equal(a.cursor, 0, "the cursor wraps");
  tap(a);
  // A hold that is still down does nothing yet; its release braces.
  a.down(); run(a, HOLD + 0.1); assert.equal(a.enemy.turn, 0);
  a.up({ durationMs: (HOLD + 0.1) * 1000 });
  assert.equal(a.enemy.braced, true); assert.equal(a.enemy.swings, 0); assert.equal(a.enemy.turn, 1);
  assert.equal(a.cursor, 1, "the cursor stays on the card just used");
});

test("first launch teaches the game; the guide is remembered and reopens from the menu", () => {
  const c = appContext(), a = new Crawlspace(c);
  tap(a); assert.equal(a.guide, 0); assert.equal(a.phase, "title");
  for (let page = 1; page < GUIDE.length; page++) { tap(a); assert.equal(a.guide, page); }
  tap(a); assert.equal(a.guide, -1); assert.equal(a.phase, "play");
  run(a, 3); assert.equal(c.calls.saved.at(-1).guided, true);
  const again = new Crawlspace(appContext({ progress: c.calls.saved.at(-1) }));
  tap(again); assert.equal(again.phase, "play", "no guide the second time");
  const turn = again.enemy.turn;
  again.menuActions().find((x) => x.label === "GAME GUIDE").run();
  assert.equal(again.guide, 0); hold(again);
  assert.equal(again.guide, -1); assert.equal(again.phase, "play"); assert.equal(again.enemy.turn, turn, "closing the guide takes no action");
  assert.equal(migrateSave({ schema: 1, runs: 4 }).guided, false, "older saves see the guide once");
});

test("win records exactly once and result lockout protects it", () => {
  const { a, c } = ready();
  a.run.floor = 3; a.run.room = 3; a.enterCombat("invoice"); a.enemy.hp = 1;
  choose(a, 0); assert.equal(a.phase, "over"); assert.equal(a.won, true);
  hold(a); assert.equal(a.phase, "over");
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
    run(a, 3); a.enemy.hp = 1;
    const picture = () => JSON.stringify({ phase: a.phase, view: a.view, run: a.run, enemy: a.enemy, offers: a.offers, sv: a.sv, rng: c.rng.state, t: a.t, cursor: a.cursor });
    const before = picture(), saves = c.calls.saved.length;
    for (let i = 0; i < 2; i++) { a.down(); run(a, 0.067); a.up(); run(a, 0.05); }
    a.down(); run(a, 1.12); a.cancel(); a.pause();
    assert.equal(picture(), before, pace); assert.equal(c.calls.saved.length, saves, pace); assert.equal(c.calls.score.length, 0);
    assert.deepEqual(c.calls.leds.at(-1), Array(9).fill(0)); a.resume();
  }
});

test("thirty seconds of mashing the button only moves between cards", () => {
  for (let seed = 1; seed <= 12; seed++) {
    const { a } = ready({ seed: Math.imul(seed, 0x9e3779b9) >>> 0 });
    for (let i = 0; i < 30 * 60; i++) { if (i % 3 === 0) tap(a); a.update(1 / 60); }
    assert.equal(a.phase, "play"); assert.equal(a.enemy.turn, 0); assert.equal(a.run.hp, 40);
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

test("deeper replay starts fresh and scales the enemy", () => {
  const { a } = ready(); a.end(true); run(a, 1); tap(a); hold(a);
  assert.equal(a.phase, "play"); assert.equal(a.run.heat, 1); assert.deepEqual(a.run.relics, []);
  assert.equal(a.enemy.maxHp, 23); assert.equal(a.run.hp, 40);
});

test("the system menu can revisit the unlocked heat after a fresh launch", () => {
  const app = new Crawlspace(appContext({ progress: { schema: 1, unlockedHeat: 3 } }));
  const actions = app.menuActions();
  assert.equal(actions.length, 3); assert.equal(actions[2].label, "HEAT 3 HOUSE");
  actions[2].run();
  assert.equal(app.phase, "play"); assert.equal(app.run.heat, 3); assert.equal(app.enemy.maxHp, 33);
  assert.equal(new Crawlspace(appContext()).menuActions().length, 2);
});

test("a minute of mixed input renders all states and keeps valid lamp bytes", () => {
  const { a, c } = ready({ seed: 0xfeedface }), g = fakeCanvas();
  run(a, 60, (i) => { if (i % 89 === 0) (i % 2 ? hold : tap)(a); if (i % 7 === 0) a.draw(g); });
  for (const values of c.calls.leds) assert.ok(values.length === 9 && values.every((v) => Number.isInteger(v) && v >= 0 && v <= 255));
  a.pause(); const count = c.calls.leds.length; run(a, 1); assert.equal(c.calls.leds.length, count); a.resume();
  a.dispose(); assert.deepEqual(c.calls.leds.at(-1), Array(9).fill(0));
});

test("four lamps: the cards on lamps 1-3, health on lamp 4", () => {
  const c = appContext({ progress: { schema: 1, guided: true } });
  c.lampCount = () => 4;
  const a = new Crawlspace(c); tap(a); run(a, 0.5);
  let frame = c.calls.leds.at(-1);
  assert.equal(frame.length, 12);
  assert.ok(frame[0] > 150 && frame[3] < 40 && frame[6] < 40, "the swing card's lamp is the bright one");
  assert.ok(frame[10] > frame[9], "full health is green on lamp 4");
  tap(a); run(a, 0.1); frame = c.calls.leds.at(-1);
  assert.ok(frame[4] > 100 && frame[0] < 40, "the brace card's lamp lights after a tap");
  a.run.hp = 6; run(a, 0.1); frame = c.calls.leds.at(-1);
  assert.ok(frame[9] > frame[10], "low health turns lamp 4 red");
  a.dispose(); assert.ok(c.calls.leds.at(-1).every((v) => v === 0), "every lamp, the fourth too, goes dark");
});

test("save slots: each slot is its own house, labelled by where the crawl stands", () => {
  assert.equal(Crawlspace.saveSlots, true);
  const { a, c } = ready(); run(a, 3);
  const saved = c.calls.saved.at(-1);
  assert.equal(a.slotSummary(saved), "LEVEL 1, ROOM 1/4");
  const deep = structuredClone(saved); deep.active.run.floor = 3; deep.active.run.room = 2; deep.active.run.heat = 9;
  assert.equal(a.slotSummary(deep), "LEVEL 3, ROOM 3/4 · H9");
  assert.equal(a.slotSummary({ schema: 1, runs: 7, wins: 2, unlockedHeat: 2 }), "2 CLEARED · HEAT 2");
  assert.equal(a.slotSummary({ schema: 1, runs: 3 }), "3 CRAWLS");
  assert.equal(a.slotSummary(null), "NO CRAWL YET");
  for (const value of [saved, deep, null, "junk", { runs: 1e100, wins: 1e100, unlockedHeat: 99 }]) assert.ok(a.slotSummary(value).length <= 24);
  // A fresh second slot starts a new house without repeating HOW TO PLAY.
  const second = appContext(); second.slot = () => ({ index: 2, count: 4, fresh: true });
  const b = new Crawlspace(second); tap(b);
  assert.equal(b.guide, -1); assert.equal(b.phase, "play"); assert.equal(b.run.floor, 1);
  const first = appContext(); first.slot = () => ({ index: 1, count: 4, fresh: true });
  const f = new Crawlspace(first); tap(f); assert.equal(f.guide, 0, "slot 1 on a new console still teaches");
});
