// The console logbook (web/engine/logbook.js): today's three, generic and own orders, the streak,
// feats, and loading any saved record (none, damaged, oversized) into a valid version-1 book.
import test from "node:test";
import assert from "node:assert/strict";
import * as Log from "../web/engine/logbook.js";

const GAMES = ["perihelion", "outpost", "ballista", "tideline", "orbit", "ricochet", "runner", "reaction", "echo", "glyphs"];

test("today's three are stable for a date, distinct, and change with the date", () => {
  const a = Log.pickToday("2026-10-02", GAMES), b = Log.pickToday("2026-10-02", GAMES);
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, 3);
  assert.ok(a.every((id) => GAMES.includes(id)));
  const week = new Set();
  for (let d = 1; d <= 7; d++) week.add(Log.pickToday("2026-10-0" + d, GAMES).join());
  assert.ok(week.size >= 6, "the picks move day to day");
  assert.deepEqual(Log.pickToday("2026-10-02", ["orbit"]), ["orbit"], "fewer games than picks");
});

test("a generic order is met by a score that reaches 60% of the best, or by any finished run", () => {
  const book = Log.cleanLogbook(null);
  Log.ensureDay(book, "2026-10-02", GAMES, (id) => (id === book.picks?.[0]?.a ? 0 : 0));
  const [first, second] = book.picks;
  first.target = 100; first.goal = "Score 100 or more";
  second.target = 0;
  assert.equal(Log.noteScore(book, first.a, 99), false);
  assert.equal(Log.noteScore(book, first.a, 100, "keyboard"), false, "another score class does not count");
  assert.equal(Log.noteScore(book, first.a, 100), true);
  assert.equal(Log.noteScore(book, first.a, 500), false, "met once");
  assert.equal(Log.noteScore(book, second.a, 1, "physical"), true, "no best: any finished run");
  assert.equal(Log.noteScore(book, "not-picked", 999), false);
  assert.equal(Log.doneCount(book), 2);
  assert.equal(book.met["2026-10-02"], 2);
});

test("targets come from each game's best at the start of the day", () => {
  const book = Log.cleanLogbook({});
  Log.ensureDay(book, "2026-10-02", GAMES, () => 250);
  assert.ok(book.picks.every((p) => p.target === 150 && p.goal === "Score 150 or more"));
  assert.equal(Log.ensureDay(book, "2026-10-02", GAMES, () => 9999), false, "the same day keeps its orders");
  assert.ok(Log.ensureDay(book, "2026-10-03", GAMES, () => 0));
  assert.ok(book.picks.every((p) => p.goal === "Finish a run" && !p.done));
});

test("a game's own order replaces the generic one and only the game can meet it", () => {
  const book = Log.cleanLogbook({});
  Log.ensureDay(book, "2026-10-02", GAMES);
  const app = book.picks[0].a;
  assert.equal(Log.ownOrder(book, app, "Reach the third region in the daily run"), true);
  assert.equal(Log.ownOrder(book, app, "Reach the third region in the daily run"), false, "unchanged");
  assert.equal(Log.ownOrder(book, "not-picked", "x"), false);
  assert.equal(Log.noteScore(book, app, 1e9), false, "a score does not meet an own order");
  assert.equal(Log.meetOrder(book, app), true);
  assert.equal(Log.ownOrder(book, app, "something else"), false, "a met order stays as it was");
});

test("the streak counts days in a row with an order met, ending today or yesterday", () => {
  const book = Log.cleanLogbook({ met: { "2026-09-29": 1, "2026-09-30": 3, "2026-10-01": 1 } });
  assert.equal(Log.streak(book, "2026-10-02"), 3, "yesterday still counts");
  book.met["2026-10-02"] = 1;
  assert.equal(Log.streak(book, "2026-10-02"), 4);
  assert.equal(Log.streak(book, "2026-10-04"), 0, "a missed day ends it");
  assert.equal(Log.dayBefore("2026-03-01"), "2026-02-28");
});

test("feats are kept once per game and id, newest last, at most MAX_FEATS", () => {
  const book = Log.cleanLogbook({});
  assert.equal(Log.addFeat(book, "orbit", "lock10", "TEN LOCKS", "2026-10-02"), true);
  assert.equal(Log.addFeat(book, "orbit", "lock10", "TEN LOCKS", "2026-10-02"), false);
  assert.equal(Log.addFeat(book, "ricochet", "lock10", "SAME ID, OTHER GAME", "2026-10-02"), true);
  assert.equal(Log.addFeat(book, "orbit", "", "nameless", "2026-10-02"), false);
  for (let i = 0; i < 100; i++) Log.addFeat(book, "runner", "f" + i, "F" + i, "2026-10-02");
  assert.equal(book.feats.length, Log.MAX_FEATS);
  assert.equal(book.feats.at(-1).i, "f99");
});

test("any saved record loads as a valid version-1 logbook that fits the service's 8 KB limit", () => {
  for (const raw of [undefined, null, 7, "x", [], { v: 9, day: "bad", picks: "x", met: [], feats: {} },
    { day: "2026-10-02", picks: [{ a: "orbit", goal: 5, target: "x", done: 1 }, null, {}], met: { "2026-10-02": 9, junk: 1 }, feats: [{ a: "orbit", i: "a" }, { a: "orbit", i: "a" }, 3] }]) {
    const book = Log.cleanLogbook(raw);
    assert.equal(book.v, 1);
    assert.ok(Array.isArray(book.picks) && Array.isArray(book.feats) && typeof book.met === "object");
    assert.deepEqual(Log.cleanLogbook(JSON.parse(JSON.stringify(book))), book, "clean is stable");
  }
  const odd = Log.cleanLogbook({ day: "2026-10-02", picks: [{ a: "orbit", goal: 5, target: "x", done: 1 }], met: { "2026-10-02": 9, junk: 1 }, feats: [{ a: "orbit", i: "a" }, { a: "orbit", i: "a" }] });
  assert.deepEqual(odd.picks, [{ a: "orbit", goal: "", target: 0, own: 0, done: 1 }]);
  assert.deepEqual(odd.met, { "2026-10-02": 3 });
  assert.equal(odd.feats.length, 1);
  // The largest book the logbook keeps.
  const big = Log.cleanLogbook({});
  Log.ensureDay(big, "2026-10-02", GAMES, () => 1e12);
  for (const p of big.picks) Log.ownOrder(big, p.a, "X".repeat(200));
  for (let d = 0; d < 90; d++) big.met[`2026-${String(1 + (d % 12)).padStart(2, "0")}-${String(1 + (d % 28)).padStart(2, "0")}`] = 3;
  for (let i = 0; i < 200; i++) Log.addFeat(big, "y".repeat(60) + i, "z".repeat(60) + i, "n".repeat(60), "2026-10-02");
  const size = JSON.stringify(Log.cleanLogbook(big)).length;
  assert.ok(size < 8192, size + " bytes");
});
