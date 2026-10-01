// Glyph Archive (web/apps/glyphs.js): the four wings, the match / no-match cards, spaced practice and the save.
import test from "node:test";
import assert from "node:assert/strict";
import { GlyphVault, WINGS, migrateGlyphs, plateRanges, CARDS, SEALS, PLATE_STRENGTH, FEATS } from "../web/apps/glyphs.js";
import { appContext, fakeCanvas } from "./helpers/app-context.mjs";

const DT = 1 / 60;
const step = (g, s) => { for (let i = 0, n = Math.round(s * 60); i < n; i++) g.update(DT); };
const dark = (v) => v.every((x) => x === 0);
const lamps = (c) => c.calls.leds.at(-1) || Array(9).fill(0);
const tap = (g) => { g.down(); step(g, 0.05); g.up({ durationMs: 50 }); };
const hold = (g) => { g.down(); step(g, 0.5); g.up({ durationMs: 500 }); };
function begin(g) { tap(g); while (g.phase === "intro") tap(g); }
// A player who gets `accuracy` of the cards right after `think` seconds (rng separate from the game's).
function bot(g, { think = 0.6, accuracy = 1, seed = 1 } = {}) {
  let r = seed * 7919 + 1;
  const rand = () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < 60 * 600 && (g.phase === "play" || g.phase === "intro"); i++) {
    if (g.phase === "intro") { tap(g); continue; }
    if (g.stage === "ask" && g.downAt === null && g.total - g.left >= think) {
      const match = rand() < accuracy ? g.card.truth : !g.card.truth;
      if (match) tap(g); else hold(g);
    } else g.update(DT);
  }
}

test("Glyph Archive decks: every wing's entries are distinct and the Braille cells are the standard ones", () => {
  for (const wing of WINGS) {
    const keys = wing.entries.map((e) => e.k), backs = wing.entries.map((e) => e.back);
    assert.equal(new Set(keys).size, keys.length, wing.id);
    assert.equal(new Set(backs).size, backs.length, wing.id);
  }
  const braille = WINGS[0].entries;
  assert.equal(braille.length, 26); assert.equal(new Set(braille.map((e) => e.cell)).size, 26);
  const cell = (k) => braille.find((e) => e.k === k).cell;
  assert.equal(cell("A"), 0b000001); assert.equal(cell("K"), 0b000101); assert.equal(cell("U"), 0b100101);
  assert.equal(cell("W"), 0b111010, "W is dots 2-4-5-6");
  assert.equal(WINGS[1].entries.length, 24); assert.equal(WINGS[3].entries.length, 26);
  assert.ok(WINGS[2].entries.every((e) => Number.isInteger(e.z) && e.z > 0));
});

test("Glyph Archive save: nothing, a first-release run record and a schema 2 save all load as schema 2", () => {
  const empty = migrateGlyphs(undefined);
  assert.equal(empty.schema, 2); assert.equal(empty.wing, 0); assert.deepEqual(Object.keys(empty.decks), WINGS.map((w) => w.id));
  const old = { schema: 1, runs: 12, last: { inscriptions: 6, score: 900, scanMs: 850, milestone: 6 }, milestone: 11 };
  const v = migrateGlyphs(old);
  assert.equal(v.runs, 12); assert.equal(v.milestone, 11); assert.equal(v.last.inscriptions, 6);
  assert.equal(v.decks.braille.open, 0);
  const odd = migrateGlyphs({ schema: 2, wing: 9, decks: { greek: { open: 99, session: 3, items: { ALPHA: [2, 5, 9, 1], BETA: [1], NOPE: [1, 1, 1, 1] } } } });
  assert.equal(odd.wing, WINGS.length - 1); assert.equal(odd.decks.greek.open, 24);
  assert.deepEqual(odd.decks.greek.items, { ALPHA: [2, 5, 9, 1] });
});

test("Glyph Archive: a first-release save is kept, and the first session writes schema 2 on top of it", () => {
  const c = appContext({ seed: 2, progress: { schema: 1, runs: 12, last: { inscriptions: 6 }, milestone: 11 } });
  const g = new GlyphVault(c);
  begin(g); bot(g, { accuracy: 1 });
  assert.equal(g.phase, "over"); step(g, 2);
  const saved = c.calls.saved.at(-1);
  assert.equal(saved.schema, 2); assert.equal(saved.runs, 13); assert.ok(saved.milestone >= 11);
  assert.deepEqual(migrateGlyphs(saved), saved);
});

test("Glyph Archive: tap is MATCH, a hold answers NO MATCH at 0.4 s, and a card left alone is wrong", () => {
  const c = appContext({ seed: 3 }), g = new GlyphVault(c);
  begin(g);
  assert.equal(g.stage, "ask"); assert.equal(g.card.truth, true, "a new entry first comes as a true pair");
  tap(g); assert.equal(g.run.right, 1); assert.equal(g.stage, "show");
  step(g, 0.6); assert.equal(g.stage, "ask");
  g.card.truth = false;
  g.down(); step(g, 0.3); assert.equal(g.stage, "ask", "not yet");
  step(g, 0.12); assert.equal(g.stage, "show"); assert.equal(g.run.right, 2, "the hold answered NO MATCH");
  g.up({ durationMs: 600 });
  step(g, 0.6);
  // The press that answered is over; the next card is untouched by it.
  assert.equal(g.stage, "ask"); assert.equal(g.run.cards, 2);
  step(g, 6); assert.equal(g.run.wrong, 1, "a card left to run out is wrong"); assert.equal(g.seals, SEALS - 1);
  assert.equal(g.feedback, "TOO SLOW");
});

test("Glyph Archive: a hold still down when the next card comes does not answer it", () => {
  const c = appContext({ seed: 4 }), g = new GlyphVault(c);
  begin(g);
  g.down(); step(g, 0.45); assert.equal(g.stage, "show");
  step(g, 2); assert.equal(g.stage, "ask"); assert.equal(g.run.cards, 1, "the held press answered the next card too");
  g.up({ durationMs: 2500 }); assert.equal(g.run.cards, 1);
});

test("Glyph Archive: false pairs are confusable (Braille cells mostly one or two dots apart)", () => {
  const c = appContext({ seed: 5 }), g = new GlyphVault(c);
  g.sv.decks.braille.open = 26;
  for (const e of WINGS[0].entries) g.sv.decks.braille.items[e.k] = [3, 99, 5, 0];
  begin(g);
  const bits = (n) => n.toString(2).replaceAll("0", "").length;
  const gaps = [];
  for (let i = 0; i < 300; i++) {
    g.nextCard();
    if (!g.card.truth) gaps.push(bits(g.entry(g.card.k).cell ^ g.entry(g.card.other).cell));
  }
  assert.ok(gaps.length > 100 && gaps.every((d) => d > 0));
  assert.ok(gaps.filter((d) => d <= 2).length / gaps.length > 0.6, "near misses " + gaps.filter((d) => d <= 2).length + "/" + gaps.length);
});

test("Glyph Archive: four entries open first, two more once those are met and holding", () => {
  const c = appContext({ seed: 6 }), g = new GlyphVault(c);
  begin(g);
  assert.deepEqual(g.fresh, ["A", "B", "C", "D"]); assert.equal(g.deck().open, 4);
  g.dispose();
  for (const k of "ABC") g.sv.decks.braille.items[k] = [1, 0, 3, 0];
  g.sv.decks.braille.items.D = [0, 0, 3, 1];
  g.phase = "title"; g.start();
  assert.deepEqual(g.fresh, [], "D has not been met yet");
  g.phase = "title";
  g.sv.decks.braille.items.D = [1, 0, 3, 1]; g.start();
  assert.deepEqual(g.fresh, ["E", "F"]); assert.equal(g.deck().open, 6);
});

test("Glyph Archive: a competent player catalogues the wing; an idle one is sealed with nothing", () => {
  const scores = [];
  for (const seed of [1, 2, 3]) {
    const c = appContext({ seed }), g = new GlyphVault(c);
    begin(g); bot(g, { accuracy: 0.97, seed });
    assert.equal(g.result.reason, "complete", "seed " + seed); assert.equal(g.run.cards, CARDS);
    scores.push(g.sv.last.score);
  }
  const c = appContext({ seed: 4 }), idle = new GlyphVault(c);
  begin(idle); step(idle, 60);
  assert.equal(idle.phase, "over"); assert.equal(idle.result.reason, "sealed"); assert.equal(idle.sv.last.score, 0);
  const guesser = new GlyphVault(appContext({ seed: 5 }));
  begin(guesser); bot(guesser, { accuracy: 0.5, seed: 5 });
  assert.ok(Math.min(...scores) > 3 * guesser.sv.last.score, `competent ${scores}, guessing ${guesser.sv.last.score}`);
});

test("Glyph Archive: entries grow stronger across sessions, and reverse cards come for the stronger ones", () => {
  const c = appContext({ seed: 7 }), g = new GlyphVault(c);
  for (let s = 0; s < 6; s++) { begin(g); bot(g, { accuracy: 0.98, seed: s + 1 }); step(g, 1); }
  const deck = g.sv.decks.braille;
  assert.ok(deck.open > 4, "more entries opened: " + deck.open);
  assert.ok(Object.values(deck.items).some((r) => r[0] >= 3), JSON.stringify(deck.items));
  assert.ok(Object.values(deck.items).every((r) => r[0] <= 5));
  let reversed = 0;
  begin(g); g.run.cards = 12;
  for (let i = 0; i < 200; i++) { g.nextCard(); if (g.card.reverse) reversed++; }
  assert.ok(reversed > 20, "reverse cards " + reversed);
});

test("Glyph Archive: a hold on the title changes the wing; the hold that ends a session does not", () => {
  const c = appContext({ seed: 8 }), g = new GlyphVault(c);
  hold(g); assert.equal(g.wing().id, "greek"); assert.equal(g.phase, "title");
  hold(g); hold(g); assert.equal(g.wing().id, "phonetic");
  hold(g); assert.equal(g.desk, true, "after the last wing comes the desk"); assert.equal(g.phase, "title");
  hold(g); assert.equal(g.desk, false); assert.equal(g.wing().id, "braille", "the wings wrap around");
  hold(g); begin(g); assert.equal(g.wing().id, "greek");
  g.seals = 1; g.card.truth = true;
  g.down(); step(g, 0.45); assert.equal(g.phase, "over");
  step(g, 0.5); g.up({ durationMs: 950 });
  assert.equal(g.wing().id, "greek", "the answering hold changed the wing");
  step(g, 1); assert.equal(c.calls.saved.at(-1).wing, 1);
});

test("Glyph Archive lamps: whole numbers, varying in play, dark on title and result, off after cancel/pause/dispose", () => {
  const c = appContext({ seed: 9 }), g = new GlyphVault(c);
  step(g, 1); assert.ok(dark(lamps(c)));
  begin(g); bot(g, { accuracy: 0.9 });
  const writes = c.calls.leds;
  assert.ok(writes.every((v) => v.length === 9 && v.every((x) => Number.isInteger(x) && x >= 0 && x <= 255)));
  assert.ok(new Set(writes.map((v) => v.join())).size >= 6);
  step(g, 2); assert.ok(dark(lamps(c)), "dark on the result screen");
  for (const how of ["cancel", "pause", "dispose"]) {
    const d = appContext({ seed: 10 }), h = new GlyphVault(d);
    begin(h); step(h, 1); h.down(); step(h, 0.2);
    h[how](); assert.ok(dark(lamps(d)), how);
  }
});

test("Glyph Archive: three stray taps never end a session; numbers stay finite; every screen draws", () => {
  const c = appContext({ seed: 11 }), g = new GlyphVault(c);
  begin(g);
  for (let i = 0; i < 3; i++) { tap(g); step(g, 0.1); }
  assert.equal(g.phase, "play");
  const cv = fakeCanvas();
  for (let w = 0; w < WINGS.length; w++) {
    g.sv.wing = w; g.phase = "title"; g.draw(cv);
    begin(g); g.draw(cv); g.run.cards = 12; for (let i = 0; i < 20; i++) { g.nextCard(); g.draw(cv); }
    tap(g); g.draw(cv); g.dispose(); g.draw(cv);
  }
  const nums = JSON.stringify(g.sv).match(/-?[\d.]+(e[+-]?\d+)?/g) || [];
  assert.ok(nums.every((n) => Number.isFinite(Number(n))));
});

test("Glyph Archive: a save with every entry of every wing stays well under 8 KiB", () => {
  const decks = Object.fromEntries(WINGS.map((w) => [w.id, { session: 9999, open: w.entries.length,
    items: Object.fromEntries(w.entries.map((e) => [e.k, [5, 9999, 9999, 9999]])) }]));
  const full = migrateGlyphs({ schema: 2, runs: 99999, decks, last: { wing: "ELEMENTS", cards: 30, correct: 30, accuracy: 100, score: 9999, milestone: 30, reason: "complete" } });
  assert.ok(JSON.stringify(full).length < 6000, JSON.stringify(full).length);
});

test("Glyph Archive depth: every wing's plates cover its entries; a plate is restored once all its entries are strong", () => {
  for (const wing of WINGS) {
    const r = plateRanges(wing);
    assert.equal(r.length, wing.plates.length, wing.id);
    assert.equal(r[0].from, 0); assert.equal(r.at(-1).to, wing.entries.length, wing.id);
    for (let i = 1; i < r.length; i++) assert.equal(r[i].from, r[i - 1].to, wing.id);
  }
  const c = appContext({ seed: 23 }), g = new GlyphVault(c);
  const deck = g.sv.decks.braille; deck.open = 10;
  for (const e of WINGS[0].entries.slice(0, 10)) deck.items[e.k] = [PLATE_STRENGTH, 99, 5, 0];
  begin(g); bot(g, { accuracy: 1 });
  assert.equal(g.result.reason, "complete");
  assert.deepEqual(g.result.plates, [WINGS[0].plates[0][1]]); assert.deepEqual(g.sv.plates, ["braille:0"]);
  assert.ok(g.result.xp >= 100 + 40); assert.ok(g.sv.feats.includes("plate") && g.sv.feats.includes("first"));
  assert.ok(g.result.feats.length >= 2);
  step(g, 2); g.down(); step(g, 0.1); g.up({ durationMs: 60 }); begin(g); bot(g, { accuracy: 1 });
  assert.deepEqual(g.result.plates, [], "a restored plate is not restored twice"); assert.equal(g.sv.plates.length, 1);
});

test("Glyph Archive depth: new fields migrate safely, the desk draws, and a tap on the desk goes back", () => {
  const old = migrateGlyphs({ schema: 1, runs: 2 });
  assert.equal(old.xp, 0); assert.deepEqual(old.plates, []); assert.deepEqual(old.feats, []); assert.equal(old.daily, null);
  const odd = migrateGlyphs({ schema: 2, xp: 50.7, plates: ["braille:0", 7, ...Array(40).fill("greek:1")], feats: ["first", "zzz"] });
  assert.equal(odd.xp, 50); assert.equal(odd.plates.length, 32); assert.deepEqual(odd.feats, ["first"]);
  assert.ok(FEATS.every((f) => f.name.length <= 24));
  const c = appContext({ seed: 24 }), g = new GlyphVault(c);
  g.sv.wing = WINGS.length - 1; g.sv.plates = ["braille:0", "greek:2"]; g.sv.feats = ["first", "plate"];
  hold(g); assert.equal(g.desk, true); g.draw(fakeCanvas());
  tap(g); assert.equal(g.desk, false); assert.equal(g.phase, "title"); assert.equal(g.wing().id, "phonetic");
});
