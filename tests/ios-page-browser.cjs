// The iPhone app's page (ios/build-web.py) in Chrome at iPhone, iPhone Duo and iPad sizes, with a
// stand-in for the app: window.webkit.messageHandlers.vesper records what the page posts, and
// vesperApp.fold() is called as the app calls it, with the window's size, its safe areas and, for
// iPhone Duo, the crease (a 40-point band at the middle of its 951 x 669 inner display) and the
// posture. It checks the play layouts (sideways: the page's own play mode; upright: the game on
// top, the button below), that with the crease across every screen keeps what is looked at above
// it and what is touched below it with nothing in its band, the button's messages, and the saves
// handed between app and page, the console's own included.
// It does not run Swift, WebKit, a phone, its haptics or its real fold: see docs/IOS.md.
const path = require("node:path"), url = require("node:url");
const { CASES, STANDIN, sleep, build, launch, open: openPage, play, checker } = require("./helpers/ios-page.cjs");
const { output, html } = build("ios-page");
const { check, finish } = checker();
const open = (browser, one, given) => openPage(browser, html, one, given);

// Rectangles of what is on the page, and everything read or touched that lies in a band.
const measure = (page, band) => page.evaluate((band) => {
  const rect = (e) => {
    if (!e || e.closest("[hidden]")) return null;
    const b = e.getBoundingClientRect();
    return b.width && b.height ? { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), b: Math.round(b.bottom), r: Math.round(b.right) } : null;
  };
  const q = (selector) => rect(document.querySelector(selector));
  const canvas = document.getElementById("game"), box = canvas.getBoundingClientRect(), k = Math.min(box.width / 960, box.height / 540);
  const picture = box.width ? { w: Math.round(960 * k), h: Math.round(540 * k), y: box.top + (box.height - 540 * k) / 2, b: box.top + (box.height + 540 * k) / 2 } : null;
  const inBand = [];
  if (band) for (const e of document.querySelectorAll("button, a, canvas, h1, h2, p, time, .lamp, .hud-item, .app-readout, #control-hint, .hold-track, .card-name, .card-desc, .utility-panel, .eyebrow, #menu-description, .today-line")) {
    if (e.closest("[hidden]")) continue;
    const style = getComputedStyle(e);
    if (style.display === "none" || style.visibility === "hidden") continue;
    const b = e.getBoundingClientRect();
    if (!b.width || !b.height) continue;
    // Only the part that can be seen: a row that scrolls clips what is in it.
    let top = b.top, bottom = b.bottom;
    for (let p = e.parentElement; p; p = p.parentElement) {
      const ps = getComputedStyle(p);
      if (ps.display === "contents" || !/(auto|scroll|hidden)/.test(ps.overflowY)) continue;
      const pb = p.getBoundingClientRect();
      top = Math.max(top, pb.top);
      bottom = Math.min(bottom, pb.bottom);
    }
    if (bottom > top && Math.min(bottom, band[1]) - Math.max(top, band[0]) > 1) inBand.push((e.id ? "#" + e.id : "." + String(e.className).split(" ")[0]) + "@" + Math.round(top));
  }
  return {
    inner: [innerWidth, innerHeight], page: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
    viewport: document.querySelector('meta[name="viewport"]').content, playing: document.body.classList.contains("playing"),
    posture: document.documentElement.dataset.posture, fold: document.documentElement.dataset.fold || "",
    stage: q("#game-stage"), picture, arcade: q("#arcade"), cap: q("#arcade .arcade-cap"), heading: q(".app-heading"), hud: q("#hud"),
    readout: q("#app-readout"), copy: q(".control-copy"), lights: q(".physical-lights"), pause: q("#pause-button"), mic: q("#mic-button"),
    sector: q(".sector-head"), tabs: q(".section-line"), grid: q("#app-grid"), deck: q(".control-deck"),
    display: q("#utility-content"), actions: q("#utility-actions"), menuTitle: q("#menu-title"), menuActions: q("#menu-actions"),
    menuSwitch: q(".menu-switch"), inBand,
  };
}, band);
const viewportOf = (page) => page.evaluate(() => document.querySelector('meta[name="viewport"]').content);
let browser;
(async () => {
  browser = await launch();

  for (const [name, one] of Object.entries(CASES)) {
    const { context, page, errors } = await open(browser, one);
    const [sat, sar, sab, sal] = one.told.safe, crease = one.told.crease;
    const band = crease && crease[2] >= crease[3] ? [crease[1], crease[1] + crease[3]] : null; // only a crease across
    let m = await measure(page, band);
    const [W, H] = m.inner;
    await page.screenshot({ path: path.join(output, `${name}-dashboard.png`) });
    check(m.posture === one.told.posture && m.fold === (band ? "across" : crease ? "down" : ""), `${name}: the page knows the posture (${m.posture} ${m.fold})`);

    if (band) { // the dashboard: title above the crease, sectors and cards below it
      check(m.page[1] <= H && m.inBand.length === 0, `${name}: dashboard is one screen with nothing in the crease ${m.inBand}`);
      check(m.sector.y >= sat && m.sector.b <= band[0] + 1, `${name}: dashboard: the sector's title is above the crease, under the status row`);
      check(m.tabs.y >= band[1] - 1 && m.grid.y >= band[1] && m.deck.b <= H - sab + 1, `${name}: dashboard: sectors, cards and the button's deck are below it`);
      const cards = await page.evaluate(() => [...document.querySelectorAll("#app-grid .app-card")].map((e) => Math.round(e.getBoundingClientRect().width)));
      check(cards.length >= 3 && cards.slice(0, 3).every((w) => w > 150), `${name}: dashboard: three cards across (${cards.slice(0, 3)})`);
    }

    await play(page);
    m = await measure(page, band);
    await page.screenshot({ path: path.join(output, `${name}-orbit.png`) });
    check(m.playing && m.page[0] <= W && m.page[1] <= H, `${name}: in play the page is one screen (${W} x ${H})`);
    check(m.mic === null, `${name}: no microphone button`);
    check(m.stage && m.stage.x >= 0 && m.stage.b <= H && m.stage.r <= W, `${name}: the game is on screen (${m.picture.w} x ${m.picture.h})`);
    if (W > H) {
      check(W >= 700 && H >= 400, `${name}: laid out at 700 x 400 or more`);
      check(m.lights.x >= sal - 1 && m.stage.r <= W - sar + 1, `${name}: lamps and game clear of the corners and the status column`);
    } else if (!m.arcade || !m.cap) check(false, `${name}: the button is shown`);
    else {
      check(m.arcade.w >= W - 2 && m.arcade.h >= 100, `${name}: the button's area is the full width and ${m.arcade.h} tall`);
      check(m.cap.y >= m.arcade.y - 1 && m.cap.b <= m.arcade.b + 1, `${name}: the cap (${m.cap.w}) is inside the button's area`);
      check(m.copy.b <= H - sab + 1, `${name}: hints above the home bar`);
      check(m.hud.b <= m.readout.y + 1 && m.readout.b <= m.arcade.y + 1 && m.arcade.b <= m.copy.y + 1, `${name}: rows in order, none overlapping`);
      if (band) {
        check(m.inBand.length === 0, `${name}: play: nothing in the crease ${m.inBand}`);
        check(m.picture.y >= sat - 0.5 && m.picture.b <= band[0] + 0.5, `${name}: play: the picture is between the status row and the crease (${Math.round(m.picture.y)} to ${Math.round(m.picture.b)})`);
        check(m.picture.h >= band[0] - sat - 1 || m.picture.w >= W - 1, `${name}: play: the picture is as large as the upper half allows`);
        check(Math.min(m.lights.y, m.heading.y, m.hud.y) >= band[1] - 1, `${name}: play: lamps, title and numbers are below the crease`);
      } else {
        check(m.heading.y >= sat - 1 && m.lights.y >= sat - 1, `${name}: title and lamps below the status area`);
        check(m.stage.w === W && m.stage.b <= m.hud.y + 1, `${name}: the game is the full width, above its numbers`);
      }
    }

    await page.keyboard.press("Escape");
    await sleep(300);
    m = await measure(page, band);
    await page.screenshot({ path: path.join(output, `${name}-menu.png`) });
    if (band) {
      check(m.inBand.length === 0, `${name}: menu: nothing in the crease ${m.inBand}`);
      check(m.menuTitle.y >= sat && m.menuTitle.b <= band[0] && m.menuActions.y >= band[1] - 1 && m.menuSwitch.b <= H + 1, `${name}: menu: its name above the crease, its choices and button below`);
      const choices = await page.evaluate(() => { const all = [...document.querySelectorAll("#menu-actions > *")], box = document.getElementById("menu-actions").getBoundingClientRect(); return { n: all.length, seen: all.filter((e) => e.getBoundingClientRect().bottom <= box.bottom + 1).length }; });
      check(choices.n >= 5 && choices.seen === choices.n, `${name}: menu: all ${choices.n} choices show without scrolling`);
    }
    await page.keyboard.press("Escape");
    await sleep(200);

    if (band) { // an instrument: its display above the crease, its buttons below it
      await page.evaluate(() => vesper.launch("timers"));
      await sleep(600);
      m = await measure(page, band);
      await page.screenshot({ path: path.join(output, `${name}-timers.png`) });
      check(!m.playing && m.page[1] <= H && m.inBand.length === 0, `${name}: instrument is one screen with nothing in the crease ${m.inBand}`);
      check(m.lights.y >= sat - 1 && m.display.b <= band[0] + 1 && m.actions.y >= band[1] - 1 && m.deck.b <= H - sab + 1, `${name}: instrument: lamps and display above the crease, buttons and deck below`);
    }
    const hostErrors = await page.evaluate(() => vesper.errors || []);
    check(!errors.length && !hostErrors.length, `${name}: no page or console errors ${JSON.stringify({ errors, hostErrors })}`);
    await context.close();
  }

  { // Folding and unfolding while a game runs: the layout follows, and so does the canvas.
    const { context, page } = await open(browser, CASES["duo-open-upright"]);
    await play(page);
    const open1 = await measure(page);
    await page.setViewportSize({ width: 466, height: 678 });
    await page.evaluate((told) => vesperApp.fold(told), CASES["duo-closed"].told);
    await sleep(400);
    const closed = await measure(page);
    check(closed.posture === "plain" && closed.fold === "" && closed.stage.w === 466 && closed.heading.b <= closed.stage.y + 1, "closing the Duo mid-game: the plain upright layout on the outer display");
    await page.setViewportSize({ width: 669, height: 951 });
    await page.evaluate((told) => vesperApp.fold(told), CASES["duo-laptop"].told);
    await sleep(400);
    const laptop = await measure(page);
    check(laptop.posture === "laptop" && Math.abs(laptop.picture.b - open1.picture.b) < 1 && laptop.picture.w === open1.picture.w, "opening it again: the game is back above the crease");
    const backing = await page.evaluate(() => document.getElementById("game").width);
    check(backing >= 960, `the canvas is drawn at the size it is shown (${backing} pixels wide)`);
    await context.close();
  }

  { // The button and the app.
    const { context, page } = await open(browser, CASES.phone);
    await page.evaluate(() => vesper.launch("orbit"));
    await sleep(600);
    const presses = async (from) => (await page.evaluate((n) => window.__posted.slice(n), from)).filter((m) => m.t === "press");
    let from = await page.evaluate(() => window.__posted.length);
    const m = await measure(page);
    await page.touchscreen.tap(m.cap.x + m.cap.w / 2, m.cap.y + m.cap.h / 2);
    await sleep(200);
    check(JSON.stringify(await presses(from)) === JSON.stringify([{ t: "press", down: true }, { t: "press", down: false }]), "a tap on the button posts one press and one release");
    from = await page.evaluate(() => window.__posted.length);
    await page.touchscreen.tap(m.arcade.x + 30, m.arcade.y + 30);
    await sleep(200);
    check((await presses(from)).length === 2, "so does a tap in a corner of the button's area");
    from = await page.evaluate(() => window.__posted.length);
    await page.touchscreen.tap(m.stage.x + m.stage.w / 2, m.stage.y + m.stage.h / 2);
    await sleep(200);
    check((await presses(from)).length === 2, "and a tap on the game");
    from = await page.evaluate(() => window.__posted.length);
    await page.touchscreen.tap(m.pause.x + m.pause.w / 2, m.pause.y + m.pause.h / 2);
    await sleep(300);
    check((await presses(from)).length === 0 && (await page.evaluate(() => !!vesper.menu)), "MENU opens the menu and is not a press");
    check(await page.evaluate(() => window.__posted.some((m) => m.t === "ready")), "the page says when the console has loaded");
    await context.close();
  }

  { // Saves.
    const old = JSON.stringify({ scores: { orbit: 7 }, settings: {}, timers: [], progress: {} });
    let { context, page } = await open(browser, CASES.phone, { saved: { "vesper-demo": old } });
    check((await page.evaluate(() => vesper.state.scores.orbit)) === 7, "the app's copy is restored into an empty web view");
    const first = await page.evaluate(() => window.__posted[0]);
    check(first && first.t === "saves" && first.items["vesper-demo"] === old, "every saved item is posted once at start");
    await page.evaluate(() => vesper.bridge.command("score", { app: "orbit", score: 9 }));
    await sleep(100);
    const last = await page.evaluate(() => window.__posted.filter((m) => m.t === "save").pop());
    check(last && last.key === "vesper-demo" && JSON.parse(last.value).scores.orbit === 9, "a new best is posted when it is saved");
    await page.reload();
    await page.waitForFunction(() => window.vesper?.loaded);
    check((await page.evaluate(() => vesper.state.scores.orbit)) === 9, "an older copy from the app does not replace newer progress");
    await context.close();
    ({ context, page } = await open(browser, CASES.phone, { launch: "orbit" }));
    await sleep(500);
    check((await page.evaluate(() => vesper.meta?.id)) === "orbit", "the app named at launch is opened");
    await context.close();
  }

  { // The console's own saves, brought over: bests at the higher value, the file's progress in, the rest kept.
    const phone = JSON.stringify({ scores: { orbit: 12, cairn: 40 }, settings: { volume: 3 }, timers: [], progress: { orbit: { sector: 2 }, relay: { level: 1 } } });
    const file = { vesper9: "console-saves", version: 1, scores: { orbit: 9, cairn: 113, "highbar:flow-v5": 13840 }, progress: { orbit: { sector: 5 }, highbar: { park: 3 } } };
    const { context, page } = await open(browser, CASES.phone, { saved: { "vesper-demo": phone }, import: file });
    const state = await page.evaluate(() => ({ scores: vesper.state.scores, progress: vesper.state.progress, volume: vesper.state.settings.volume }));
    check(state.scores.orbit === 12 && state.scores.cairn === 113 && state.scores["highbar:flow-v5"] === 13840, "console saves: each best is the higher of the two");
    check(state.progress.orbit.sector === 5 && state.progress.highbar.park === 3 && state.progress.relay.level === 1, "console saves: the file's games replace the phone's, the others stay");
    check(state.volume === 3, "console saves: the phone's settings stay");
    const told = await page.evaluate(() => window.__posted.find((m) => m.t === "imported"));
    check(told && told.scores === 2 && told.progress === 2, "console saves: the app is told, so it sets the file aside");
    const kept = JSON.parse(await page.evaluate(() => window.__posted.find((m) => m.t === "saves").items["vesper-demo"]));
    check(kept.scores.cairn === 113 && kept.progress.highbar.park === 3, "console saves: the app's own copy has them at once");
    await context.close();
  }

  { // The viewport: the page's own guess first, then only the app's numbers.
    const context = await browser.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await context.addInitScript(STANDIN);
    const page = await context.newPage();
    await page.goto(url.pathToFileURL(html).href);
    await page.waitForFunction(() => window.vesper?.loaded);
    const guess = await viewportOf(page);
    check(guess.startsWith("width=868,"), "a phone held sideways is laid out 868 wide before the app speaks: " + guess);
    await page.evaluate(() => vesperApp.fold({ posture: "plain", crease: null, safe: [59, 0, 34, 0], window: [393, 852] }));
    const upright = await viewportOf(page);
    check(upright.startsWith("width=device-width"), "the app says upright: " + upright);
    await page.evaluate(() => { vesperApp.fit(); window.dispatchEvent(new Event("resize")); });
    check((await viewportOf(page)) === upright, "after that the page's own guess is not used");
    await page.evaluate(() => vesperApp.fold({ posture: "plain", crease: null, safe: [0, 59, 21, 59], window: [852, 393] }));
    const inset = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--sal").trim());
    check((await viewportOf(page)).startsWith("width=868,") && Math.abs(parseFloat(inset) - 59 * 868 / 852) < 0.02, `sideways again: 868 wide, and the safe areas scaled with it (${inset})`);
    await context.close();
  }

  finish(output, "ios-page-browser");
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => browser?.close());
