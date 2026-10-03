// The Encyclopedia (web/apps/encyclopedia.js): the home rows, reading, following links and coming
// back, the end-of-article "where next?", the saved place and the lamps.
import test from "node:test";
import assert from "node:assert/strict";
import { Encyclopedia, migrateWiki, WIKI_VERSION } from "../web/apps/encyclopedia.js";
import { appContext, fakeCanvas, run } from "./helpers/app-context.mjs";

const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
const words = (n, seed = 0) => Array.from({ length: n }, (_, i) => ["sun", "light", "planet", "orbit", "gas", "heat"][(i + seed) % 6]).join(" ");
const article = (title, n, links) => ({ path: title.replace(/ /g, "_"), title,
  blocks: [["h", title], ...Array.from({ length: n }, (_, i) => (i === 6 ? ["h", "Structure"] : ["p", words(50 + (i % 4) * 10, i)]))],
  links, sections: [[title, 0], ["Structure", 7]] });
const ARTICLES = {
  Sun: article("Sun", 24, [["star", "Star", 1], ["hydrogen", "Hydrogen", 20]]),
  Star: article("Star", 3, [["Sun", "Sun", 1]]),
  Hydrogen: article("Hydrogen", 3, []),
};
const STATUS = { status: "ready", title: "Tiny Wikipedia", articles: 3, date: "2026-09-01", main: "Sun",
  featured: { path: "Star", title: "Star" }, onThisDay: { path: "Hydrogen", title: "October 3" }, folder: "/data/encyclopedia" };

function mount(options = {}) {
  const gets = [];
  const ctx = appContext({
    get: (path) => {
      gets.push(path);
      if (options.status) return options.status;
      if (path === "encyclopedia") return STATUS;
      if (path === "encyclopedia/random") return { path: "Hydrogen", title: "Hydrogen" };
      const m = path.match(/^encyclopedia\/article\?path=(.*)$/);
      const a = m && ARTICLES[decodeURIComponent(m[1])];
      if (!a) throw new Error("404");
      return a;
    },
    ...options,
  });
  const app = new Encyclopedia(ctx);
  return { ctx, app, gets };
}
const tap = (app) => { app.down({}); run(app, 0.08); app.up({ durationMs: 80 }); run(app, 0.1); };
const hold = (app) => { app.down({}); run(app, 0.8); app.up({ durationMs: 800 }); run(app, 0.1); };

test("bookmarks and link trails persist; a generic case tap returns through the trail at the first page", async () => {
  const { app, ctx } = mount({ lampCount: 4 }); await settle(); app.open("Sun", "Sun", { trail: false }); await settle(); run(app, .1);
  app.bookmark(); app.follow("Hydrogen", "Hydrogen"); await settle(); run(app, .1); assert.equal(app.trail.length, 1);
  app.dispose(); const saved = JSON.parse(JSON.stringify(ctx.calls.saved.at(-1)));
  assert.equal(saved.trail.length, 1); assert.equal(saved.marks[0].path, "Sun");
  const again = mount({ progress: saved }).app; await settle(); again.rows()[0].run(); await settle(); run(again, .1);
  assert.equal(again.article.path, "Hydrogen"); again.knock({ side: "right" }); await settle(); run(again, .1);
  assert.equal(again.article.path, "Sun"); assert.equal(again.trail.length, 0);
  assert.ok(ctx.calls.leds.every((v) => v.length === 12)); assert.deepEqual(ctx.calls.board.at(-1), [0,0,0]);
});

test("Unicode-heavy bookmarks and trails stay below the service byte limit without losing the current article", () => {
  const place = (i) => ({ path: "P" + i + "😀".repeat(180), title: "😀".repeat(60), para: 0, char: 0 });
  const save = migrateWiki({ last: place(0), marks: Array.from({ length: 12 }, (_, i) => place(i)), trail: Array.from({ length: 12 }, (_, i) => place(i)), recent: Array.from({ length: 20 }, (_, i) => ({ ...place(i), f: .3 })) });
  assert.ok(new TextEncoder().encode(JSON.stringify(save)).length <= 7900); assert.equal(save.last.path, place(0).path);
});
const pick = async (app, label) => {
  const at = app.rows().findIndex((r) => r.label.startsWith(label));
  assert.ok(at >= 0, "no row " + label + " in " + app.rows().map((r) => r.label));
  while (app.cursor !== at) tap(app);
  hold(app);
  await settle();
  run(app, 0.1);
};

test("a save is versioned; anything unreadable starts fresh and fields are cleaned and bounded", () => {
  assert.deepEqual(migrateWiki(undefined), { v: WIKI_VERSION, size: 1, auto: 0, last: null, recent: [] });
  assert.deepEqual(migrateWiki("junk"), migrateWiki(null));
  assert.deepEqual(migrateWiki([1]), migrateWiki(null));
  const v1 = { v: 1, size: 2, auto: 3, last: { path: "Sun", title: "Sun", para: 12, char: 40 }, recent: [{ path: "Sun", title: "Sun", f: 0.42 }] };
  assert.deepEqual(migrateWiki(JSON.parse(JSON.stringify(v1))), v1);
  const bad = migrateWiki({ size: 7, auto: "x", last: { path: "", para: 1 }, recent: [null, { path: "A", f: NaN }, { path: "A", f: 1 }, { path: "x".repeat(600) }, { path: "B", title: "B", f: 9 }] });
  assert.deepEqual(bad, { v: 1, size: 1, auto: 0, last: null, recent: [{ path: "A", title: "A", f: 0 }, { path: "B", title: "B", f: 1 }] });
  const many = migrateWiki({ recent: Array.from({ length: 50 }, (_, i) => ({ path: "Article_" + i + "_" + "y".repeat(60), title: "T".repeat(200), f: 0.5 })) });
  assert.equal(many.recent.length, 20);
  assert.ok(JSON.stringify(many).length < 8192);
});

test("home offers the article of the day, today, random and the front page; without a file it says what to do", async () => {
  const { app } = mount();
  await settle();
  assert.deepEqual(app.rows().map((r) => r.label), ["ARTICLE OF THE DAY", "ON THIS DAY", "RANDOM ARTICLE", "FRONT PAGE", "LEAVE THE ENCYCLOPEDIA"]);
  const g = fakeCanvas();
  app.draw(g);
  for (const status of [{ status: "missing", folder: "/data/encyclopedia" }, { status: "nolib" }, { status: "broken", error: "bad" }]) {
    const other = mount({ status }).app;
    await settle();
    assert.deepEqual(other.rows().map((r) => r.label), ["CHECK AGAIN", "SETUP GUIDE", "LEAVE THE ENCYCLOPEDIA"]);
    other.draw(g);
  }
  const offline = mount({ get: () => { throw new Error("down"); } }).app;
  await settle();
  assert.equal(offline.data.status.status, "offline");
  offline.draw(g);
});

test("read, follow a link, come back to the same place, and the end of an article asks where next", async () => {
  const { ctx, app } = mount();
  await settle();
  await pick(app, "FRONT PAGE");
  assert.equal(app.phase, "read");
  assert.equal(app.article.path, "Sun");
  const pages = app.layout.pages.length;
  assert.ok(pages > 3);
  tap(app); tap(app);
  assert.equal(app.page, 2);
  const place = { ...app.pos };
  hold(app);
  assert.equal(app.phase, "menu");
  await pick(app, "LINKS ON THIS PAGE");
  assert.equal(app.phase, "links");
  const links = app.rows().slice(1);
  assert.deepEqual(links.map((r) => r.label), ["hydrogen", "star"], "links further on come before those already passed");
  await pick(app, "star");
  assert.equal(app.article.path, "Star");
  assert.equal(app.trail.length, 1);
  hold(app);
  await pick(app, "BACK TO SUN");
  assert.equal(app.article.path, "Sun");
  assert.deepEqual(app.pos, place);
  assert.equal(app.trail.length, 0);
  // Read to the end: the last tap opens the links.
  for (let i = 0; i < pages + 2 && app.phase === "read"; i++) tap(app);
  assert.equal(app.phase, "links");
  app.draw(fakeCanvas());
  assert.equal(app.save.recent.find((r) => r.path === "Sun").f, 1);
  run(app, 4);
  assert.equal(ctx.calls.saved.at(-1).recent[0].path, "Sun");
});

test("sections jump, random opens an article, and a reopened app continues where it stopped", async () => {
  const { ctx, app } = mount();
  await settle();
  await pick(app, "FRONT PAGE");
  hold(app);
  await pick(app, "SECTIONS");
  await pick(app, "Structure");
  assert.equal(app.phase, "read");
  assert.equal(app.layout.pages[app.page][0][2] <= 7, true);
  assert.ok(app.page > 0);
  app.dispose();
  const saved = ctx.calls.saved.at(-1);
  const again = mount({ progress: saved }).app;
  await settle();
  assert.equal(again.rows()[0].label, "CONTINUE · Sun");
  await pick(again, "CONTINUE");
  assert.equal(again.page, app.page);
  hold(again);
  await pick(again, "ENCYCLOPEDIA HOME");
  await pick(again, "RANDOM ARTICLE");
  await settle(); run(again, 0.1);
  assert.equal(again.article.path, "Hydrogen");
  assert.equal(again.phase, "read");
});

test("tap, tap, hold while reading: the two page turns are taken back and nothing is saved", async () => {
  const { ctx, app } = mount();
  await settle();
  await pick(app, "FRONT PAGE");
  run(app, 5);
  const before = { pos: { ...app.pos }, page: app.page, trail: app.trail.length }, saves = ctx.calls.saved.length;
  for (let i = 0; i < 2; i++) { app.down({}); run(app, 0.07); app.up({ durationMs: 70 }); run(app, 0.05); }
  app.down({}); run(app, 1.0);
  app.cancel(); app.pause();
  assert.deepEqual({ pos: app.pos, page: app.page, trail: app.trail.length }, before);
  assert.equal(ctx.calls.saved.length, saves);
});

test("lamps: nine whole numbers, cyan for the trail and while holding, dark after dispose; nothing is NaN", async () => {
  const { ctx, app } = mount();
  await settle();
  await pick(app, "FRONT PAGE");
  hold(app);
  await pick(app, "LINKS ON THIS PAGE");
  await pick(app, "star");
  for (let i = 0; i < 2; i++) tap(app);
  app.down({}); run(app, 0.7);
  const holding = ctx.calls.leds.at(-1);
  app.up({ durationMs: 700 }); run(app, 0.1);
  for (const values of ctx.calls.leds) {
    assert.equal(values.length, 9);
    for (const v of values) assert.ok(Number.isInteger(v) && v >= 0 && v <= 255);
  }
  assert.ok(holding[4] > holding[3], "the hold shows in cyan");
  assert.ok(Math.max(...ctx.calls.leds.flat()) <= 160, "kept moderate");
  const g = fakeCanvas();
  for (const phase of ["menu", "links", "sections", "recent", "home"]) { app.go(phase); app.draw(g); run(app, 0.1); }
  const { c, guard, lamps, data, layout, ...plain } = app;
  assert.ok(!JSON.stringify(plain, (k, v) => (typeof v === "number" && !Number.isFinite(v) ? "BAD" : v)).includes("BAD"));
  app.dispose();
  assert.deepEqual(ctx.calls.leds.at(-1), Array(9).fill(0));
});

test("an article that fails to load says so and a tap tries again", async () => {
  const { app, gets } = mount();
  await settle();
  app.open("Nowhere", "Nowhere", { trail: false });
  await settle(); run(app, 0.1);
  assert.ok(app.data.failed.has("Nowhere"));
  app.draw(fakeCanvas());
  const asked = gets.length;
  tap(app);
  await settle();
  assert.ok(gets.length > asked, "asked again");
});

test("recently read articles keep their own places across another article and reload", async () => {
  const { app, ctx } = mount(); await settle(); app.open("Sun", "Sun", { trail: false }); await settle(); run(app, .1);
  tap(app); tap(app); const position = { ...app.pos }, page = app.page;
  app.open("Star", "Star", { trail: false }); await settle(); run(app, .1); app.dispose();
  const saved = JSON.parse(JSON.stringify(ctx.calls.saved.at(-1)));
  const again = mount({ progress: saved }).app; await settle();
  again.go("recent"); again.rows().find(row => row.label === "Sun").run(); await settle(); run(again, .1);
  assert.equal(again.page, page); assert.deepEqual(again.pos, position);
  assert.equal(migrateWiki(saved).recent.find(row => row.path === "Sun").para, position.para);
});

test("a link-free article ends with button choices and automatic turning stops there", async () => {
  const { app } = mount(); await settle(); app.open("Hydrogen", "Hydrogen", { trail: false }); await settle(); run(app, .1);
  app.save.auto = 3;
  run(app, 120);
  assert.equal(app.phase, "notice"); assert.equal(app.notice.title, "ARTICLE COMPLETE");
  assert.equal(app.save.recent.find(row => row.path === "Hydrogen").f, 1);
  const time = app.autoT; run(app, 20); assert.equal(app.autoT, time);
  tap(app); assert.equal(app.phase, "read", "a tap stays on the last page");
  app.turn(1); hold(app); assert.equal(app.phase, "home", "hold returns to home");
});
