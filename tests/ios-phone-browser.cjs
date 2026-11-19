// The iPhone app's page on a plain phone (ios/layer/25-phone.css), in Chrome with a stand-in for
// the app: upright (an iPhone, the Duo closed) and sideways (a phone laid out at 868 x 400, the
// Duo closed at 700 x 481, a small phone at 712 x 400). Not playing, every screen is one screen:
// the dashboard in every sector, three instruments and Calibration, the system menu and its
// submenus. The page as a whole never scrolls, the button's deck is on screen above the home bar,
// every card, sector and choice can be reached (scrolling its own row where it has one) and hit
// by a finger, and nothing is under the status area or the corners, or cut off at an edge.
// It also builds the page without 25-phone.css and checks that the Duo's fold, an iPad and every
// game measure exactly as they did: the phone's rules touch nothing else.
// It does not run Swift, WebKit, a phone or its real safe areas: see docs/IOS.md.
const fs = require("node:fs"), path = require("node:path");
const { CASES, sleep, build, launch, open, play, checker } = require("./helpers/ios-page.cjs");
const { output, html } = build("ios-phone");
const { check, finish } = checker();

// The same page without the phone's rules: the layer's parts are joined in name order, each
// after a comment naming it, so this file's part runs from its name to the next part's.
const without = path.join(output, "without-phone.html");
{
  const text = fs.readFileSync(html, "utf8");
  // A part's own comments start lines too, so the next part is found by its name's shape. (On
  // Windows the page is written with CRLF line ends.)
  const strip = (t, name) => {
    const at = t.search(new RegExp("/\\* " + name.replace(".", "\\.") + " \\*/\\r?\\n"));
    if (at < 0) return t;
    const next = /\n\/\* \d\d-[\w-]+\.(css|js) \*\/\r?\n/g;
    next.lastIndex = at + 1;
    const found = next.exec(t);
    return t.slice(0, at) + t.slice(found ? found.index + 1 : t.length);
  };
  const stripped = strip(strip(text, "25-phone.css"), "25-phone.js");
  const ours = "html.vesper-app:not([data-fold]) .console:not(.playing)";
  check(text.includes(ours) && !stripped.includes(ours) && !stripped.includes("25-phone") && stripped.includes("/* 30-fold.css */") && text.length - stripped.length > 5000,
    `the page is built with 25-phone.css, and once without it (${text.length - stripped.length} characters fewer)`);
  fs.writeFileSync(without, stripped);
}

// Everything read or touched on the screen as it is now (the menu's panel while it is open):
// the part of each that can be seen (a row that scrolls clips what is in it), whatever of it lies
// outside the safe area, touch targets under 44 points, rows whose content is cut off with no way
// to scroll to it, and whether anything but those rows has scrolled.
const audit = (page, safe) => page.evaluate(([sat, sar, sab, sal]) => {
  const W = innerWidth, H = innerHeight;
  const menu = !document.getElementById("menu-overlay").hidden;
  const scope = menu ? document.querySelector(".system-menu") : document.getElementById("console");
  const shown = (e) => {
    if (e.closest("[hidden]")) return false;
    for (let p = e; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.display === "none" || s.visibility === "hidden") return false;
    }
    const b = e.getBoundingClientRect();
    return b.width > 0 && b.height > 0;
  };
  const seen = (e) => { // the visible part, after every scrolling or clipping ancestor
    const b = e.getBoundingClientRect();
    let { top, bottom, left, right } = b;
    for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.display === "contents") continue;
      const pb = p.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(s.overflowY)) { top = Math.max(top, pb.top); bottom = Math.min(bottom, pb.bottom); }
      if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) { left = Math.max(left, pb.left); right = Math.min(right, pb.right); }
    }
    return bottom - top > 1 && right - left > 1 ? { top, bottom, left, right } : null;
  };
  const name = (e) => (e.id ? "#" + e.id : "." + String(e.className).split(" ")[0]) + (e.textContent ? "(" + e.textContent.trim().slice(0, 18) + ")" : "");
  const outside = [], small = [], cut = [];
  for (const e of scope.querySelectorAll("button, a, h1, h2, p, time, .lamp, .eyebrow, .card-name, .card-desc, .card-stat, .utility-panel, .app-readout, .app-description, #control-hint, .control-secondary, .hold-track, .connection, #menu-description, .menu-foot, .arcade-cap, .today-line")) {
    if (!shown(e)) continue;
    const v = seen(e);
    if (!v) continue;
    if (v.top < sat - 1 || v.bottom > H - sab + 1 || v.left < sal - 1 || v.right > W - sar + 1) outside.push(name(e) + "@" + [v.left, v.top, v.right, v.bottom].map(Math.round));
  }
  for (const e of scope.querySelectorAll(".sector-tab, .app-card, .scan-action, .utility-button, .menu-choice, #pause-button, #arcade, #menu-arcade")) {
    if (!shown(e)) continue;
    const b = e.getBoundingClientRect();
    if (b.width < 43.5 || b.height < 43.5) small.push(name(e) + " " + Math.round(b.width) + "x" + Math.round(b.height));
  }
  for (const e of scope.querySelectorAll("#app-grid, .sector-strip, #utility-content, #utility-actions, #menu-actions, #menu-description, .app-readout")) {
    if (!shown(e)) continue;
    const s = getComputedStyle(e);
    if (e.scrollHeight > e.clientHeight + 1 && !/(auto|scroll)/.test(s.overflowY) && s.overflowY !== "visible") cut.push(name(e) + " tall");
    if (e.scrollWidth > e.clientWidth + 1 && !/(auto|scroll)/.test(s.overflowX) && s.overflowX !== "visible") cut.push(name(e) + " wide");
  }
  const scrolled = [document.scrollingElement, document.body, document.getElementById("console"), document.getElementById("menu-overlay"), document.querySelector(".system-menu"), document.querySelector("main")]
    .filter((e) => e && (e.scrollTop || e.scrollLeft)).map(name);
  const box = (sel) => { const e = document.querySelector(sel); if (!e || !shown(e)) return null; const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; };
  return {
    W, H, menu, page: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
    playing: document.body.classList.contains("playing"), outside, small, cut, scrolled,
    deck: box(".control-deck"), cap: box(menu ? "#menu-arcade .arcade-cap" : "#arcade .arcade-cap"), copy: box(menu ? ".menu-switch" : ".control-copy"),
    display: box("#utility-content"), title: box(menu ? "#menu-title" : "#app-title"), sector: box("#sector-title"),
  };
}, safe);

// Each of a list scrolled into view in its own row, in turn: whether it is then wholly inside its
// row and the safe area, and is what a finger at its middle touches.
const reach = (page, selector, safe) => page.evaluate(([selector, [sat, sar, sab, sal]]) => {
  const W = innerWidth, H = innerHeight, missed = [];
  const all = [...document.querySelectorAll(selector)].filter((e) => !e.closest("[hidden]"));
  for (const e of all) {
    e.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    const b = e.getBoundingClientRect();
    let ok = b.top >= sat - 1 && b.bottom <= H - sab + 1 && b.left >= sal - 1 && b.right <= W - sar + 1;
    for (let p = e.parentElement; ok && p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.display === "contents") continue;
      const pb = p.getBoundingClientRect();
      if (/(auto|scroll|hidden)/.test(s.overflowY) && (b.top < pb.top - 1 || b.bottom > pb.bottom + 1)) ok = false;
      if (/(auto|scroll|hidden)/.test(s.overflowX) && (b.left < pb.left - 1 || b.right > pb.right + 1)) ok = false;
    }
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    if (!ok || !(hit && (hit === e || e.contains(hit)))) missed.push(e.textContent.trim().slice(0, 24) + "@" + [b.left, b.top, b.right, b.bottom].map(Math.round));
  }
  return { n: all.length, missed };
}, [selector, safe]);

// Tap one of a list (by its words) where a finger would, once it is scrolled into view.
async function tapOn(page, selector, words) {
  const at = await page.evaluate(([selector, words]) => {
    const e = [...document.querySelectorAll(selector)].find((x) => x.textContent.trim().startsWith(words));
    if (!e) return null;
    e.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    const b = e.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }, [selector, words]);
  if (at) { await page.touchscreen.tap(at.x, at.y); await sleep(450); }
  return !!at;
}

// One screen, judged. what: its name in the report; then whether the deck is shown.
function judge(name, what, a, safe) {
  const [sat, sar, sab, sal] = safe;
  check(a.page[0] <= a.W && a.page[1] <= a.H && a.scrolled.length === 0, `${name}: ${what}: one screen, the page does not scroll (${a.page}) ${a.scrolled}`);
  // A game keeps 20-play.css and the page's own play mode: this file does not judge its layout.
  if (a.playing) return;
  check(a.outside.length === 0, `${name}: ${what}: nothing under the status area, the corners or the home bar, or cut off ${a.outside.slice(0, 4)}`);
  check(a.cut.length === 0, `${name}: ${what}: nothing cut off with no way to scroll to it ${a.cut}`);
  check(a.small.length === 0, `${name}: ${what}: every touch target at least 44 points ${a.small.slice(0, 4)}`);
  const deck = a.cap && a.copy && a.cap.top >= sat - 1 && a.cap.bottom <= a.H - sab + 1 && a.copy.bottom <= a.H - sab + 1 && a.cap.left >= sal - 1 && a.copy.right <= a.W - sar + 1;
  check(deck, `${name}: ${what}: ${a.menu ? "the menu's own button" : "the button's deck"} on screen, above the home bar`);
}

// Rectangles of every element, to compare one build with the other.
const layout = (page) => page.evaluate(() => [...document.body.querySelectorAll("*")]
  .filter((e) => !e.closest("svg") || e.tagName === "svg")
  .map((e) => { const b = e.getBoundingClientRect(); return [e.id || e.className.baseVal || e.className, Math.round(b.left * 10), Math.round(b.top * 10), Math.round(b.width * 10), Math.round(b.height * 10)].join(" "); }));

let browser;
(async () => {
  browser = await launch();
  const PHONES = ["phone", "duo-closed", "phone-sideways", "duo-closed-sideways", "small-phone-sideways"];

  for (const name of PHONES) {
    const one = CASES[name], safe = one.told.safe;
    const { context, page, errors } = await open(browser, html, one);
    // The app hands the safe areas in points; the page may be laid out wider (sideways), so its
    // own numbers are used.
    const scaled = await page.evaluate(() => ["--sat", "--sar", "--sab", "--sal"].map((v) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(v)) || 0));
    const shot = (what) => page.screenshot({ path: path.join(output, `${name}-${what}.png`) });

    // The dashboard, in every sector: each tab tapped where a finger would.
    const tabs = await page.evaluate(() => document.querySelectorAll(".sector-tab").length);
    const tabReach = await reach(page, ".sector-tab", scaled);
    check(tabs >= 5 && tabReach.missed.length === 0, `${name}: dashboard: all ${tabs} sectors can be reached and tapped ${tabReach.missed}`);
    let sectorsOk = 0;
    const cardsSeen = [];
    for (let i = 0; i < tabs; i++) {
      const at = await page.evaluate((i) => { const e = document.querySelectorAll(".sector-tab")[i]; e.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" }); const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, i);
      await page.touchscreen.tap(at.x, at.y);
      await sleep(150);
      if ((await page.evaluate(() => vesper.page)) === i) sectorsOk++;
      await page.evaluate(() => document.getElementById("app-grid").scrollTo(0, 0));
      const a = await audit(page, scaled);
      judge(name, `dashboard sector ${i + 1}`, a, scaled);
      check(a.sector && a.sector.top >= scaled[0], `${name}: dashboard sector ${i + 1}: the sector's title is shown, under the status area`);
      const cards = await reach(page, "#app-grid .app-card", scaled);
      cardsSeen.push(cards.n);
      check(cards.n > 0 && cards.missed.length === 0, `${name}: dashboard sector ${i + 1}: all ${cards.n} cards can be reached ${cards.missed}`);
      const actions = await reach(page, ".dashboard-actions .scan-action", scaled);
      check(actions.n === 3 && actions.missed.length === 0, `${name}: dashboard sector ${i + 1}: the three sector buttons can be reached ${actions.missed}`);
      await page.evaluate(() => document.getElementById("app-grid").scrollTo(0, 0));
      if (i === 0) await shot("dashboard");
    }
    check(sectorsOk === tabs, `${name}: dashboard: a tap on each sector shows it (${sectorsOk} of ${tabs}; cards ${cardsSeen})`);

    // Three instruments, and Calibration (the longest list of buttons).
    for (const id of ["timers", "morse", "lantern", "settings"]) {
      await page.evaluate((id) => vesper.launch(id), id);
      await sleep(450);
      const a = await audit(page, scaled);
      await shot(id);
      judge(name, id, a, scaled);
      if (!a.playing) {
        check(a.display && a.title && a.title.top >= scaled[0] && a.display.bottom - a.display.top >= 80, `${name}: ${id}: its title and its display are shown (${a.display && Math.round(a.display.bottom - a.display.top)} tall)`);
        const buttons = await reach(page, "#utility-actions .utility-button", scaled);
        check(buttons.n > 0 && buttons.missed.length === 0, `${name}: ${id}: all ${buttons.n} buttons can be reached ${buttons.missed}`);
        const menu = await reach(page, "#pause-button", scaled);
        check(menu.missed.length === 0, `${name}: ${id}: MENU can be reached`);
        await page.evaluate(() => { document.getElementById("utility-actions").scrollTo(0, 0); document.getElementById("utility-content").scrollTo(0, 0); });
      }
    }
    await page.evaluate(() => vesper.home());
    await sleep(300);

    // The system menu (Escape), then the way into its two long ones by a finger: SYSTEM TOOLS
    // (a submenu), CALIBRATION / SETTINGS (an instrument, above); and the operator's notes, the
    // longest word.
    await page.keyboard.press("Escape");
    await sleep(300);
    let a = await audit(page, scaled);
    await shot("menu");
    judge(name, "menu", a, scaled);
    let choices = await reach(page, "#menu-actions > *", scaled);
    check(a.menu && choices.n >= 5 && choices.missed.length === 0, `${name}: menu: all ${choices.n} choices can be reached ${choices.missed}`);
    // The handheld edition shows no SYSTEM TOOLS (Calibration has its own line), so that menu is
    // opened as the console would, to judge a second menu's layout all the same.
    check(!(await page.evaluate(() => [...document.querySelectorAll("#menu-actions > *")].some((e) => /SYSTEM TOOLS/.test(e.textContent)))), `${name}: menu: no SYSTEM TOOLS line on a handheld`);
    await page.evaluate(() => vesper.systemTools());
    await sleep(300);
    check((await page.evaluate(() => document.getElementById("menu-title").textContent)) === "System tools", `${name}: the system tools' menu opens`);
    a = await audit(page, scaled);
    await shot("tools");
    judge(name, "system tools", a, scaled);
    choices = await reach(page, "#menu-actions > *", scaled);
    check(choices.n >= 2 && choices.missed.length === 0, `${name}: system tools: all ${choices.n} choices can be reached ${choices.missed}`);
    await tapOn(page, "#menu-actions > *", "BACK");
    check(await tapOn(page, "#menu-actions > *", "HOW TO USE VESPER") && (await page.evaluate(() => document.getElementById("menu-title").textContent)) === "Operator notes", `${name}: menu: HOW TO USE VESPER is tapped and opens`);
    a = await audit(page, scaled);
    await shot("notes");
    judge(name, "operator notes", a, scaled);
    choices = await reach(page, "#menu-actions > *", scaled);
    const word = await page.evaluate(() => { const e = document.getElementById("menu-description"); return { h: e.clientHeight, all: e.scrollHeight }; });
    check(choices.n === 2 && choices.missed.length === 0 && word.h >= 40, `${name}: operator notes: the word shows (${word.h} of ${word.all}, scrolling) and both choices can be reached ${choices.missed}`);
    await tapOn(page, "#menu-actions > *", "BACK");
    check(await tapOn(page, "#menu-actions > *", "CALIBRATION / SETTINGS") && (await page.evaluate(() => vesper.meta?.id)) === "settings", `${name}: menu: CALIBRATION / SETTINGS is tapped and opens`);
    // Its own menu from inside an instrument, by MENU.
    await tapOn(page, "#pause-button", "");
    await sleep(200);
    a = await audit(page, scaled);
    judge(name, "menu over Calibration", a, scaled);
    choices = await reach(page, "#menu-actions > *", scaled);
    check(a.menu && choices.missed.length === 0, `${name}: menu over Calibration: all ${choices.n} choices can be reached ${choices.missed}`);

    const hostErrors = await page.evaluate(() => vesper.errors || []);
    check(!errors.length && !hostErrors.length, `${name}: no page or console errors ${JSON.stringify({ errors, hostErrors })}`);
    await context.close();
  }

  // Untouched: the Duo's fold (across and like a book), an iPad, and every game anywhere. The
  // two builds measure the same, element by element.
  const same = async (one, steps) => {
    const pages = [];
    for (const file of [html, without]) {
      const { context, page, errors } = await open(browser, file, one);
      pages.push({ context, page, errors });
    }
    const out = [];
    for (const [what, step] of steps) {
      for (const p of pages) await step(p.page);
      const [a, b] = await Promise.all(pages.map((p) => layout(p.page)));
      const diff = a.length === b.length ? a.filter((row, i) => row !== b[i]) : ["count " + a.length + " vs " + b.length];
      out.push([what, diff]);
    }
    for (const p of pages) await p.context.close();
    return out;
  };
  const instrument = (id) => async (page) => { await page.evaluate((id) => vesper.launch(id), id); await sleep(600); };
  const escape = async (page) => { await page.keyboard.press("Escape"); await sleep(300); };
  const unfolded = [["dashboard", async () => {}], ["timers", instrument("timers")], ["Calibration", instrument("settings")], ["the menu", escape], ["system tools", async (page) => { await page.evaluate(() => vesper.systemTools()); await sleep(300); }],
    ["Orbit Lock", (page) => play(page)], ["the menu in a game", escape]];
  for (const name of ["duo-laptop", "duo-book", "ipad-upright"]) {
    for (const [what, diff] of await same(CASES[name], unfolded))
      check(diff.length === 0, `${name}: ${what} measures exactly as without 25-phone.css ${diff.slice(0, 3)}`);
  }
  // The comparison does see a difference where there is one: the phone's own dashboard.
  const [[, changed]] = await same(CASES.phone, [["dashboard", async () => {}]]);
  check(changed.length > 20, `phone: the dashboard does measure differently without 25-phone.css (${changed.length} elements)`);
  // On the phones only the games: they keep 20-play.css.
  for (const name of PHONES) {
    const games = [["Orbit Lock", (page) => play(page)], ["Morse", instrument("morse")]];
    for (const [what, diff] of await same(CASES[name], games))
      check(diff.length === 0, `${name}: ${what} (a game) measures exactly as without 25-phone.css ${diff.slice(0, 3)}`);
  }

  finish(output, "ios-phone-browser");
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => browser?.close());
