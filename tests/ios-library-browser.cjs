// The Stacks in the iPhone app's page (ios/build-web.py), with the books the app carries
// (ios/extras/books.py, ios/layer/60-library.js) and no service: the shelf lists the guide and
// the fifteen books, a book opens on its first page, pages turn, leaving and coming back finds
// the saved place, bookmarks and auto-turn are kept, and what needs the console (more classics,
// a USB drive) says so. Driven with the one button (Space): a tap is next, a hold of 0.75 s then
// release chooses. Nothing may be fetched over the network and the page must raise no error.
// It does not run Swift, WebKit or a phone: see docs/IOS.md.
const path = require("node:path");
const { CASES, sleep, build, launch, open, checker } = require("./helpers/ios-page.cjs");
const { output, html } = build("ios-library");
const { check, finish } = checker();

// Taps are spaced well past the menu gesture's gap, so two of them and a hold never open the system menu.
const tap = async (page) => { await page.keyboard.down("Space"); await sleep(70); await page.keyboard.up("Space"); await sleep(420); };
const hold = async (page) => { await page.keyboard.down("Space"); await sleep(750); await page.keyboard.up("Space"); await sleep(500); };
const taps = async (page, n) => { for (let i = 0; i < n; i++) await tap(page); };

// What The Stacks shows, read from the app itself (the page is drawn on a canvas).
const state = (page) => page.evaluate(() => {
  const app = vesper.app, pages = app.layoutReady && app.layoutReady() ? app.layout.pages : null;
  const words = (lines) => (lines || []).map((l) => l[1] || "").join(" ").trim();
  return {
    id: vesper.meta && vesper.meta.id, phase: app.phase, service: app.data && app.data.service, cursor: app.cursor,
    rows: app.rows ? app.rows().map((r) => r.label) : [], books: app.data ? app.data.books.map((b) => ({ id: b.id, title: b.title, start: b.start })) : [],
    book: app.book, pos: app.pos, page: app.page, pages: pages ? pages.length : 0, text: pages ? words(pages[app.page]).slice(0, 400) : "",
    notice: app.notice ? { title: app.notice.title, lines: app.notice.lines } : null, save: app.save, autoT: app.autoT,
  };
});
const shot = (page, name) => page.screenshot({ path: path.join(output, name + ".png") });

let browser;
(async () => {
  browser = await launch();
  for (const name of ["duo-laptop", "phone"]) {
    const one = CASES[name];
    const { context, page, errors } = await open(browser, html, one);
    // Every request: the books' scripts are files beside the page; anything else is the network.
    const network = [], books = [];
    page.on("request", (r) => {
      const at = r.url();
      if (!/^(file|data|blob|about):/.test(at)) network.push(at);
      else if (at.indexOf("/ios-library/books/") >= 0) books.push(at.slice(at.indexOf("/ios-library/") + 13));
    });
    const loaded = async () => books.slice();

    check((await loaded()).length === 0, `${name}: no book is read before The Stacks opens`);
    await page.evaluate(() => vesper.launch("library"));
    await sleep(900);
    let s = await state(page);
    await shot(page, `${name}-shelf`);
    check(s.id === "library" && s.service === "ok", `${name}: The Stacks finds its books (${s.service})`);
    check(s.books.length === 15 && s.rows[0] === "The Reader's Guide" && s.rows.length >= 16, `${name}: the shelf lists the guide and ${s.books.length} books`);
    const titles = s.books.map((b) => b.title);
    check(["Dracula", "Frankenstein", "Treasure Island", "Pride and Prejudice"].every((t) => titles.some((x) => x.indexOf(t) >= 0)), `${name}: the shelf has the classics by name`);
    check(JSON.stringify(await loaded()) === JSON.stringify(["books/shelf.js"]), `${name}: only the shelf is read to show it (${await loaded()})`);

    // The first book: one tap to it, a hold to open it.
    await tap(page);
    s = await state(page);
    check(s.cursor === 1, `${name}: a tap moves to the first book (${s.rows[s.cursor]})`);
    await hold(page);
    await sleep(400);
    s = await state(page);
    const first = s.books[0];
    await shot(page, `${name}-first-page`);
    check(s.phase === "read" && s.book === first.id, `${name}: a hold opens ${first.title}`);
    check(s.pos.ch === first.start && s.page === 0 && s.pages > 1 && s.text.length > 100, `${name}: it opens on the first page of its first chapter (chapter ${s.pos.ch + 1}, ${s.pages} pages)`);
    const parts = (await loaded()).filter((n) => n !== "books/shelf.js");
    check(parts.length === 1 && parts[0].indexOf("books/" + first.id + "/") === 0, `${name}: opening it reads one part of it (${parts})`);
    const firstText = s.text;

    await taps(page, 3);
    s = await state(page);
    await shot(page, `${name}-paged`);
    check(s.phase === "read" && s.page === 3 && s.text && s.text !== firstText, `${name}: three taps turn three pages to new text (page ${s.page + 1})`);
    const place = { ch: s.pos.ch, para: s.pos.para, char: s.pos.char, page: s.page, text: s.text };

    // A bookmark from the reader's menu (hold; the fourth row).
    await hold(page);
    s = await state(page);
    check(s.phase === "menu" && s.rows[3] === "BOOKMARK THIS PAGE", `${name}: a hold opens the reader's menu`);
    await taps(page, 3);
    await hold(page);
    s = await state(page);
    check(s.phase === "read" && (s.save.marks || []).length === 1 && s.save.marks[0].book === first.id, `${name}: the page is bookmarked`);

    // Auto-turn: the seventh row, chosen once (160 words a minute), then back to the page.
    await hold(page);
    await taps(page, 6);
    await hold(page);
    s = await state(page);
    check(s.phase === "menu" && s.save.auto === 1 && /AUTO-TURN · 160 WPM/.test(s.rows[6]), `${name}: auto-turn is set (${s.rows[6]})`);
    await taps(page, 3);
    await hold(page);
    const before = (await state(page)).autoT;
    await sleep(1200);
    s = await state(page);
    check(s.phase === "read" && s.autoT > before + 0.8 && s.page === place.page, `${name}: auto-turn's clock runs on the page (${s.autoT.toFixed(1)} s)`);

    // Leave for the dashboard and come back: the shelf is at the same book, and it opens at the same place.
    await page.evaluate(() => vesper.home());
    await sleep(500);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("vesper-demo") || "{}"));
    const kept = Object.entries(stored.progress || {}).find(([k]) => k.indexOf("library") === 0);
    check(kept && kept[1].books && kept[1].books[first.id] && kept[1].books[first.id].ch === place.ch, `${name}: the place is saved with the console's saves`);
    await page.evaluate(() => vesper.launch("library"));
    await sleep(900);
    s = await state(page);
    check(s.phase === "shelf" && s.cursor === 1, `${name}: back in The Stacks, the shelf is at ${s.rows[s.cursor]}`);
    await hold(page);
    await sleep(400);
    s = await state(page);
    await shot(page, `${name}-saved-place`);
    check(s.phase === "read" && s.book === first.id && s.pos.ch === place.ch && s.page === place.page && s.text === place.text, `${name}: it opens at the saved place (chapter ${s.pos.ch + 1}, page ${s.page + 1})`);
    check(s.save.auto === 1 && (s.save.marks || []).length === 1, `${name}: auto-turn and the bookmark are kept`);

    // The chapter list, to the last chapter, which needs another part.
    await hold(page);                  // the reader's menu
    await taps(page, 5);               // CHAPTERS
    await hold(page);
    s = await state(page);
    check(s.phase === "chapters", `${name}: the chapter list opens`);
    const count = s.rows.length - 1;
    await page.evaluate((n) => { vesper.app.cursor = n; }, count);   // the last chapter (driving there takes a tap a row)
    await hold(page);
    await sleep(400);
    s = await state(page);
    check(s.phase === "read" && s.pos.ch === count - 1 && s.pages >= 1 && s.text.length > 0, `${name}: the last chapter opens (${s.pos.ch + 1} of ${count})`);

    // What the service answers for nothing, and that every other path still reaches the console.
    const asked = await page.evaluate(async () => {
      const out = {};
      try { await vesper.bridge.get("library/0000000000000000/0"); out.missing = "answered"; } catch (e) { out.missing = String(e.message); }
      try { await vesper.bridge.get("library/" + vesper.app.book + "/99999"); out.beyond = "answered"; } catch (e) { out.beyond = String(e.message); }
      const st = await vesper.bridge.get("state");
      out.state = !!(st && st.settings);
      return out;
    });
    check(/^Could not load library\//.test(asked.missing) && /^Could not load/.test(asked.beyond), `${name}: a book or chapter it does not have is refused as the service would (${asked.missing})`);
    check(asked.state, `${name}: other paths still go to the console`);

    if (name === "phone") {
      // More classics need the console's internet connection; a USB drive needs the console.
      await page.evaluate(() => vesper.home());
      await sleep(400);
      await page.evaluate(() => vesper.launch("library"));
      await sleep(900);
      s = await state(page);
      const more = s.rows.indexOf("MORE CLASSICS"), usb = s.rows.indexOf("IMPORT FROM USB DRIVE");
      check(more > 0 && usb > more, `${name}: MORE CLASSICS and IMPORT FROM USB DRIVE are on the shelf`);
      await page.evaluate((n) => { vesper.app.cursor = vesper.app.shelfCursor = n; }, more);
      await hold(page);
      s = await state(page);
      check(s.phase === "store" && s.rows.length === 17, `${name}: MORE CLASSICS lists the sixteen titles`);
      await tap(page);
      await hold(page);
      await sleep(300);
      s = await state(page);
      await shot(page, `${name}-more-classics`);
      check(s.phase === "notice" && s.notice.title === "DOWNLOAD FAILED" && /built into it/.test(s.notice.lines[0]), `${name}: fetching one says why not: ${s.notice && s.notice.lines.join(" / ")}`);
      await tap(page);
      s = await state(page);
      check(s.phase === "store", `${name}: and goes back to the list`);
      await page.evaluate((n) => { vesper.app.toShelf(); vesper.app.cursor = vesper.app.shelfCursor = n; }, usb);
      await hold(page);
      await sleep(300);
      s = await state(page);
      await shot(page, `${name}-usb`);
      check(s.phase === "notice" && /did not start: the app reads only the books built into it/.test(s.notice.lines[0]), `${name}: importing says why not: ${s.notice && s.notice.lines.join(" / ")}`);
      await tap(page);
      s = await state(page);
      check(s.phase === "shelf", `${name}: and goes back to the shelf`);
    }

    check(network.length === 0, `${name}: nothing was fetched over the network ${network.slice(0, 3)}`);
    check(errors.length === 0, `${name}: no page errors ${errors.slice(0, 3)}`);
    await context.close();
  }
  await browser.close();
  finish(output, "ios-library-browser");
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exit(1);
});
