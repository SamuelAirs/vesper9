// Save slots (web/engine/slots.js): slot 1 is the save every game already had, other slots get their
// own progress ids, the slot record is cleaned on load, and a slot's row says what it holds.
import test from "node:test";
import assert from "node:assert/strict";
import { SLOT_COUNT, slotKey, cleanSlots, activeSlot, setActive, isEmpty, noteSaved, forget, describeSlot } from "../web/engine/slots.js";

test("slot 1 is the existing save; other slots have their own ids", () => {
  assert.equal(SLOT_COUNT, 4);
  assert.equal(slotKey("outpost"), "outpost");
  assert.equal(slotKey("outpost", 1), "outpost");
  assert.equal(slotKey("outpost", 3), "outpost#3");
  assert.equal(slotKey("outpost", 9), "outpost", "an impossible slot falls back to the first");
});

test("the slot record is cleaned on load and starts every game on slot 1", () => {
  assert.deepEqual(cleanSlots(undefined), { v: 1, active: {}, at: {} });
  const book = cleanSlots({ active: { outpost: 2, perihelion: 1, ballista: 7, "a#2": 3, tideline: "2" }, at: { "outpost#2": "2026-10-03", outpost: "bad" }, junk: 1 });
  assert.deepEqual(book, { v: 1, active: { outpost: 2 }, at: { "outpost#2": "2026-10-03" } });
  assert.equal(activeSlot(book, "outpost"), 2);
  assert.equal(activeSlot(book, "perihelion"), 1);
  assert.deepEqual(cleanSlots([1, 2]), { v: 1, active: {}, at: {} });
});

test("switching slots, save dates and clearing", () => {
  const book = cleanSlots({});
  assert.equal(setActive(book, "outpost", 3), true);
  assert.equal(setActive(book, "outpost", 3), false, "already there");
  assert.equal(setActive(book, "outpost", 5), false);
  assert.equal(activeSlot(book, "outpost"), 3);
  assert.equal(setActive(book, "outpost", 1), true);
  assert.deepEqual(book.active, {}, "slot 1 is not stored");
  assert.equal(noteSaved(book, "outpost", 2, "2026-10-03"), true);
  assert.equal(noteSaved(book, "outpost", 2, "2026-10-03"), false, "once a day is enough");
  assert.equal(forget(book, "outpost", 2), true);
  assert.equal(forget(book, "outpost", 2), false);
  assert.deepEqual(cleanSlots(JSON.parse(JSON.stringify(book))), book, "the record survives a round trip");
});

test("each slot's row: empty, the game's own summary, or its runs", () => {
  assert.equal(isEmpty(undefined), true);
  assert.equal(isEmpty({}), true);
  assert.equal(isEmpty({ v: 6 }), false);
  assert.equal(describeSlot({}, "", null), "EMPTY · NEW SAVE");
  assert.equal(describeSlot({ runs: 1 }, "2026-10-03"), "1 RUN · 2026-10-03");
  assert.equal(describeSlot({ runs: 12 }, ""), "12 RUNS");
  assert.equal(describeSlot({ v: 6 }, ""), "SAVED");
  assert.equal(describeSlot({ day: 14 }, "", (v) => "Day " + v.day + " · 6 buildings"), "DAY 14 · 6 BUILDINGS");
  assert.equal(describeSlot({ runs: 2 }, "", () => { throw new Error("broken"); }), "2 RUNS", "a broken summary falls back");
  assert.equal(describeSlot({ runs: 2 }, "", () => "x".repeat(80)).length, 32);
});
