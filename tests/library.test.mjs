// The Stacks (web/apps/library.js): shelf, reading, the reader menu, saved places and the lamps.
import test from "node:test";
import assert from "node:assert/strict";
import { Library, migrateSave, layoutChapter, wrap, pageAt, SIZES, SAVE_VERSION } from "../web/apps/library.js";
import { appContext, fakeCanvas, run } from "./helpers/app-context.mjs";

const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
const words = (n, seed = 0) => Array.from({ length: n }, (_, i) => ["star", "signal", "quiet", "orbit", "lamp", "dark"][(i + seed) % 6]).join(" ");
const CHAPTERS = [0, 1, 2].map((ch) => ({ title: "Part " + (ch + 1), blocks: [["h", "Part " + (ch + 1)], ...Array.from({ length: 30 }, (_, i) => ["p", words(40 + (i % 5) * 9, i + ch)])] }));
const BOOK = { id: "0123456789abcdef", file: "voyage.epub", format: "EPUB", title: "A Test Voyage", author: "Ada Example",
  chapters: CHAPTERS.map((c) => c.title), words: 9000, locked: null };
const LOCKED = { id: "fedcba9876543210", file: "bought.azw3", format: "AZW3", title: "Bought Book", author: "", chapters: [], words: 0,
  locked: "KINDLE", reason: "A Kindle book file. Kindle purchases are protected by DRM." };

function mount(options = {}) {
  const gets = [];
  const ctx = appContext({
    progress: options.progress,
    get: (path) => {
      gets.push(path);
      if (options.offline) return {};
      if (path === "library") return { books: [BOOK, LOCKED], folder: "/data/library", busy: null,
        shelf: [{ id: "pg84", title: "Frankenstein", author: "Mary Shelley", status: "" }] };
      const [, id, ch] = path.split("/");
      if (id === BOOK.id) return { id, chapter: +ch, count: 3, ...CHAPTERS[+ch] };
      return {};
    },
    ...options,
  });
  const app = new Library(ctx);
  return { ctx, app, gets };
}
const tap = (app) => { app.down({}); run(app, 0.08); app.up({ durationMs: 80 }); run(app, 0.1); };
const hold = (app) => { app.down({}); run(app, 0.8); app.up({ durationMs: 800 }); run(app, 0.1); };
async function openBook(app) {
  await settle();
  while (app.rows()[app.cursor].book?.id !== BOOK.id) tap(app);
  hold(app);
  await settle();
  run(app, 0.1);
}

test("a save is versioned; anything unreadable starts fresh and fields are cleaned and bounded", () => {
  assert.deepEqual(migrateSave(undefined), { v: SAVE_VERSION, last: null, size: 1, auto: 0, books: {} });
  assert.deepEqual(migrateSave("junk"), migrateSave(null));
  assert.deepEqual(migrateSave([1, 2]), migrateSave(null));
  // A save written by version 1 loads unchanged.
  const v1 = { v: 1, last: BOOK.id, size: 2, auto: 3, books: { [BOOK.id]: { ch: 2, para: 14, char: 120, f: 0.81, at: 1790000000 } } };
  assert.deepEqual(migrateSave(JSON.parse(JSON.stringify(v1))), v1);
  const bad = migrateSave({ v: 1, size: 9, auto: -1, last: 7, books: { a: { ch: -3, para: NaN, char: "x", f: 4, at: Infinity }, b: null } });
  assert.deepEqual(bad, { v: 1, last: null, size: 1, auto: 0, books: { a: { ch: 0, para: 0, char: 0, f: 1, at: 0 } } });
  const many = { v: 1, books: Object.fromEntries(Array.from({ length: 80 }, (_, i) => ["b" + i, { ch: 0, para: 0, char: 0, f: 0.5, at: i }])) };
  const kept = migrateSave(many);
  assert.equal(Object.keys(kept.books).length, 30);
  assert.ok("b79" in kept.books && !("b0" in kept.books), "the most recently read books are kept");
  assert.ok(JSON.stringify(kept).length < 8192);
});

test("word wrap stays inside its columns and remembers where each line starts", () => {
  const body = words(300) + " " + "x".repeat(130);
  for (const cols of [20, 46, 63]) {
    const lines = wrap(body, cols);
    for (const [part, at] of lines) {
      assert.ok(part.length <= cols, part);
      assert.equal(body.slice(at, at + part.length), part);
    }
    assert.equal(lines.map(([p]) => p).join("").replace(/ /g, ""), body.replace(/ /g, ""), "nothing lost or doubled");
  }
});

test("pages fit the reading area at every size, and a place is found again after a size change", () => {
  for (let size = 0; size < SIZES.length; size++) {
    const pages = layoutChapter(CHAPTERS[0].blocks, size);
    assert.ok(pages.length > 3);
    for (const page of pages) for (const item of page) assert.ok(item[4] + SIZES[size].lh <= 400, "a line falls off the page");
  }
  const small = layoutChapter(CHAPTERS[0].blocks, 0), large = layoutChapter(CHAPTERS[0].blocks, 2);
  const [, , para, char] = small[5][0];
  const page = large[pageAt(large, para, char)];
  const next = large[pageAt(large, para, char) + 1];
  assert.ok(page[0][2] < para || (page[0][2] === para && page[0][3] <= char));
  assert.ok(!next || next[0][2] > para || (next[0][2] === para && next[0][3] > char));
  assert.equal(pageAt(large, 1e9, 0), large.length - 1, "the end of a chapter is its last page");
});

test("the shelf lists the guide, the books, the classics and the USB import; a Kindle file explains itself", async () => {
  const { app } = mount();
  await settle();
  const labels = app.rows().map((r) => r.label);
  assert.deepEqual(labels, ["The Reader's Guide", "A Test Voyage", "Bought Book", "MORE CLASSICS", "IMPORT FROM USB DRIVE", "LEAVE THE LIBRARY"]);
  assert.match(app.rows()[2].sub, /LOCKED · KINDLE DRM/);
  tap(app); tap(app);
  hold(app);
  assert.equal(app.phase, "notice");
  assert.match(app.notice.lines[0], /DRM/);
  tap(app);
  assert.equal(app.phase, "shelf");
});

test("tap turns pages across chapters, hold opens the menu, and the place is saved and resumed", async () => {
  const { ctx, app, gets } = mount();
  await openBook(app);
  assert.equal(app.phase, "read");
  assert.ok(gets.includes("library/" + BOOK.id + "/0"));
  const pages = app.layout.pages.length;
  for (let i = 0; i < pages + 1; i++) { tap(app); await settle(); run(app, 0.05); }
  assert.equal(app.pos.ch, 1, "turned into the second chapter");
  assert.equal(app.page, 1);
  run(app, 4);
  const saved = ctx.calls.saved.at(-1);
  assert.equal(saved.v, SAVE_VERSION);
  assert.deepEqual({ ch: saved.books[BOOK.id].ch, para: saved.books[BOOK.id].para, char: saved.books[BOOK.id].char }, app.pos);
  assert.equal(saved.last, BOOK.id);
  assert.ok(saved.books[BOOK.id].f > 0.3 && saved.books[BOOK.id].f < 0.67);
  // The menu: previous page.
  hold(app);
  assert.equal(app.phase, "menu");
  tap(app);
  hold(app);
  assert.equal(app.phase, "read");
  assert.deepEqual([app.pos.ch, app.page], [1, 0]);
  const place = { ...app.pos };
  app.dispose();
  // A new visit opens the book where it was left, with the shelf on that book.
  const again = mount({ progress: ctx.calls.saved.at(-1) });
  await settle();
  assert.equal(again.app.rows()[again.app.cursor].book?.id, BOOK.id);
  hold(again.app);
  await settle();
  run(again.app, 0.1);
  assert.deepEqual(again.app.pos, place);
});

test("a text size change keeps the reader on the same passage", async () => {
  const { app } = mount();
  await openBook(app);
  for (let i = 0; i < 4; i++) tap(app);
  const first = app.layout.pages[app.page][0];
  hold(app);                    // menu
  for (let i = 0; i < 4; i++) tap(app);
  assert.match(app.rows()[app.cursor].label, /^TEXT/);
  hold(app);                    // MEDIUM -> LARGE, the menu stays open
  assert.equal(app.save.size, 2);
  assert.equal(app.phase, "menu");
  app.cursor = 0; hold(app);    // resume
  run(app, 0.1);
  const page = app.layout.pages[app.page];
  const startsBefore = page[0][2] < first[2] || (page[0][2] === first[2] && page[0][3] <= first[3]);
  assert.ok(startsBefore && page.some((l) => l[2] === first[2] || l[2] > first[2]));
});

test("auto-turn turns the page on its own at the chosen pace", async () => {
  const { app } = mount();
  await openBook(app);
  app.save.auto = 3; // 300 words a minute
  const start = app.page;
  run(app, 60);
  assert.ok(app.page >= start + 2, "pages turned: " + (app.page - start));
});

test("tap, tap, hold while reading: the two page turns are taken back and nothing is saved", async () => {
  const { ctx, app } = mount();
  await openBook(app);
  run(app, 5);
  const before = { pos: { ...app.pos }, page: app.page }, saves = ctx.calls.saved.length;
  for (let i = 0; i < 2; i++) { app.down({}); run(app, 0.07); app.up({ durationMs: 70 }); run(app, 0.05); }
  app.down({}); run(app, 1.0);
  app.cancel(); app.pause();
  assert.deepEqual({ pos: app.pos, page: app.page }, before);
  assert.equal(ctx.calls.saved.length, saves);
  app.resume();
  run(app, 1);
  assert.equal(app.phase, "read");
});

test("lamps: nine whole numbers, they follow the chapter, cyan fills while holding, dark after dispose", async () => {
  const { ctx, app } = mount();
  await openBook(app);
  for (let i = 0; i < 6; i++) tap(app);
  app.down({}); run(app, 0.7);
  const holding = ctx.calls.leds.at(-1);
  app.up({ durationMs: 700 }); run(app, 0.1);
  for (const values of ctx.calls.leds) {
    assert.equal(values.length, 9);
    for (const v of values) assert.ok(Number.isInteger(v) && v >= 0 && v <= 255);
  }
  assert.ok(new Set(ctx.calls.leds.map(String)).size > 3, "the lamps change");
  assert.ok(holding[4] > holding[3], "the hold shows in cyan");
  assert.ok(Math.max(...ctx.calls.leds.flat()) <= 160, "kept moderate");
  app.dispose();
  assert.deepEqual(ctx.calls.leds.at(-1), Array(9).fill(0));
});

test("without the book service the guide still reads, and nothing is NaN in any screen", async () => {
  const { app } = mount({ offline: true });
  await settle();
  assert.equal(app.data.service, "offline");
  assert.deepEqual(app.rows().map((r) => r.label), ["The Reader's Guide", "LEAVE THE LIBRARY"]);
  hold(app);
  assert.equal(app.phase, "read");
  const g = fakeCanvas();
  for (let i = 0; i < 40; i++) { tap(app); app.draw(g); }
  assert.equal(app.phase, "notice", "the end of the guide");
  assert.equal(app.notice.title, "THE END");
  app.draw(g);
  hold(app);
  assert.equal(app.phase, "shelf");
  const { c, guard, lamps, data, layout, ...plain } = app;
  const numbers = JSON.stringify(plain, (k, v) => (typeof v === "number" && !Number.isFinite(v) && v !== 1e9 ? "BAD" : v));
  assert.ok(!numbers.includes("BAD"));
});

test("the USB import and a classic download go through the service and report back", async () => {
  const { ctx, app } = mount();
  await settle();
  while (app.rows()[app.cursor].label !== "IMPORT FROM USB DRIVE") tap(app);
  hold(app);
  assert.deepEqual(ctx.calls.command.at(-1), ["library_import", {}]);
  assert.equal(app.phase, "notice");
  tap(app);
  assert.equal(app.phase, "notice", "a tap does not leave while the import runs");
  app.event({ type: "library", op: "import", ok: true, copied: 2 });
  assert.match(app.notice.lines[0], /Copied 2 books/);
  tap(app);
  app.cursor = app.rows().findIndex((r) => r.label === "MORE CLASSICS");
  hold(app);
  assert.equal(app.phase, "store");
  assert.equal(app.rows()[app.cursor].label, "Frankenstein");
  hold(app);
  assert.deepEqual(ctx.calls.command.at(-1), ["library_fetch", { item: "pg84" }]);
  app.event({ type: "library", op: "fetch", ok: false, error: "network unreachable" });
  assert.equal(app.phase, "notice");
  assert.match(app.notice.lines.join(" "), /internet/);
  const g = fakeCanvas();
  app.draw(g);
  tap(app);
  assert.equal(app.phase, "store");
  app.draw(g);
});
