// The case, on screen (ios/layer/50-case.*): the console's second input in the iPhone app's page.
// In every case the app is held in (tests/helpers/ios-page.cjs) it checks where the case plates
// lie while a game runs (outside the button's cap or the game's picture, clear of the safe areas,
// at least 44 points, nothing in the Duo's crease band) and where the CASE key lies otherwise; and
// in the phone and Duo cases that are played most it taps them: each plate and key posts one knock
// with its side to the app, the console's bridge hears one knock, the button is not pressed, the
// button does not knock, the button and a plate can be held together, and a CASE key steps the
// dashboard and the system menu back one item.
// It does not run Swift, WebKit, a phone or its haptics: see docs/IOS.md.
const path = require("node:path");
const { CASES, sleep, build, launch, open: openPage, play, checker } = require("./helpers/ios-page.cjs");
const { output, html } = build("ios-case");
const { check, finish } = checker();
const TAPPED = ["phone", "duo-closed", "duo-laptop", "duo-open-upright", "phone-sideways", "duo-book"];

// Rectangles in page pixels and the page's pixels per point.
const shapes = (page, windowWidth) => page.evaluate((windowWidth) => {
  const rect = (e) => {
    if (!e) return null;
    const style = getComputedStyle(e);
    if (style.display === "none" || style.visibility === "hidden" || e.closest("[hidden]")) return null;
    const b = e.getBoundingClientRect();
    return b.width && b.height ? { x: b.left, y: b.top, w: b.width, h: b.height, r: b.right, b: b.bottom } : null;
  };
  const canvas = document.getElementById("game"), box = canvas.getBoundingClientRect();
  const k = Math.min(box.width / 960, box.height / 540), pw = 960 * k, ph = 540 * k;
  const top = parseFloat(getComputedStyle(canvas).objectPosition.split(" ")[1]) === 0;
  const picture = box.width ? { x: box.left + (box.width - pw) / 2, w: pw, h: ph, y: top ? box.top : box.top + (box.height - ph) / 2 } : null;
  if (picture) { picture.r = picture.x + pw; picture.b = picture.y + ph; }
  const root = getComputedStyle(document.documentElement), px = (name) => parseFloat(root.getPropertyValue(name)) || 0;
  return {
    W: innerWidth, H: innerHeight, scale: windowWidth ? innerWidth / windowWidth : 1, mode: document.documentElement.dataset.case || "",
    safe: [px("--sat"), px("--sar"), px("--sab"), px("--sal")],
    left: rect(document.querySelector(".case-plate.case-left")), right: rect(document.querySelector(".case-plate.case-right")),
    deckKey: rect(document.querySelector(".control-deck .case-key")), menuKey: rect(document.querySelector(".menu-switch .case-key")),
    cap: rect(document.querySelector("#arcade .arcade-cap")), arcade: rect(document.getElementById("arcade")),
    menuArcade: rect(document.getElementById("menu-arcade")), stage: rect(document.getElementById("game-stage")), picture,
  };
}, windowWidth);
const overlap = (a, b) => !!(a && b) && Math.min(a.r, b.r) - Math.max(a.x, b.x) > 1 && Math.min(a.b, b.b) - Math.max(a.y, b.y) > 1;
const inBand = (a, band) => !!(a && band) && Math.min(a.b, band[1]) - Math.max(a.y, band[0]) > 1;
const big = (a, scale) => !!a && a.w / scale >= 44 && a.h / scale >= 44;
const size = (a, scale) => a ? `${Math.round(a.w / scale)} x ${Math.round(a.h / scale)} pt` : "missing";
const centre = (a) => [a.x + a.w / 2, a.y + a.h / 2];

// What a tap leaves behind: the messages posted to the app since `from`, and the knocks the
// console's bridge has emitted (recorded by listen()).
const listen = (page) => page.evaluate(() => {
  window.__knocks = [];
  vesper.bridge.addEventListener("event", (e) => { if (e.detail && e.detail.type === "knock") window.__knocks.push(e.detail); });
});
const mark = (page) => page.evaluate(() => ({ posted: window.__posted.length, knocks: window.__knocks.length }));
const since = (page, from) => page.evaluate((from) => {
  const posted = window.__posted.slice(from.posted);
  return { knocks: posted.filter((m) => m.t === "knock"), presses: posted.filter((m) => m.t === "press"), heard: window.__knocks.slice(from.knocks) };
}, from);
async function tap(page, point) {
  const from = await mark(page);
  await page.touchscreen.tap(point[0], point[1]);
  await sleep(250);
  return since(page, from);
}
const one = (got, side) => got.knocks.length === 1 && got.knocks[0].side === side && got.presses.length === 0 && got.heard.length === 1;
const said = (got) => JSON.stringify({ knocks: got.knocks, presses: got.presses.length, heard: got.heard.map((e) => e.side || null) });

let browser;
(async () => {
  browser = await launch();

  for (const [name, held] of Object.entries(CASES)) {
    const { context, page, errors } = await openPage(browser, html, held);
    const windowWidth = held.told.window[0], crease = held.told.crease;
    const band = crease && crease[2] >= crease[3] ? [crease[1], crease[1] + crease[3]] : null;
    const tapped = TAPPED.includes(name);
    await listen(page);
    // Side knocks count only with the setting that uses them (Twinbeat's tapMode "sides").
    await page.evaluate(() => vesper.bridge.command("settings", { key: "tapMode", value: "sides" }));
    await sleep(150);

    // The dashboard: the CASE key beside the button, no plates.
    let s = await shapes(page, windowWidth);
    check(s.deckKey && !s.left && !s.right, `${name}: dashboard: a CASE key and no plates`);
    if (s.deckKey) {
      await page.evaluate(() => document.querySelector(".control-deck .case-key").scrollIntoView({ block: "center" }));
      await sleep(150);
      s = await shapes(page, windowWidth);
      check(big(s.deckKey, s.scale) && !inBand(s.deckKey, band) && !overlap(s.deckKey, s.arcade), `${name}: dashboard: the key is ${size(s.deckKey, s.scale)}, beside the button, out of the crease`);
      await page.screenshot({ path: path.join(output, `${name}-dashboard.png`) });
      if (tapped) {
        const nav = () => page.evaluate(() => ({ index: vesper.nav.index, n: vesper.nav.items.length }));
        const before = await nav();
        const got = await tap(page, centre(s.deckKey));
        const after = await nav();
        check(one(got, null), `${name}: dashboard: the key posts one knock with no side and the console hears it ${said(got)}`);
        check(before.n > 1 && after.index === (before.index + before.n - 1) % before.n, `${name}: dashboard: the key moves the focus to the previous item (${before.index} to ${after.index} of ${before.n})`);
        await sleep(900);
        const button = await tap(page, centre(s.cap));
        check(button.presses.length === 2 && button.knocks.length === 0 && button.heard.length === 0, `${name}: dashboard: the button is pressed and does not knock`);
      }
    }

    // A game: the plates, and the button between them.
    await play(page, "twinbeat");
    s = await shapes(page, windowWidth);
    await page.screenshot({ path: path.join(output, `${name}-play.png`) });
    const [sat, sar, sab, sal] = s.safe;
    const sideways = s.W > s.H;
    check(s.left && s.right && !s.deckKey, `${name}: play: two plates and no key${sideways ? ` (${s.mode})` : ""}`);
    if (s.left && s.right) {
      check(big(s.left, s.scale) && big(s.right, s.scale), `${name}: play: plates of ${size(s.left, s.scale)} and ${size(s.right, s.scale)}`);
      check(s.left.x >= sal - 1 && s.right.r <= s.W - sar + 1 && s.left.y >= sat - 1 && Math.max(s.left.b, s.right.b) <= s.H - sab + 1, `${name}: play: the plates are clear of the safe areas`);
      check(s.left.r < s.right.x && Math.abs(s.left.x - sal) < 2 && Math.abs(s.W - sar - s.right.r) < 2, `${name}: play: one plate at the left, one at the right`);
      check(!inBand(s.left, band) && !inBand(s.right, band), `${name}: play: the plates are out of the crease`);
      if (sideways) {
        if (s.mode === "over") check(true, `${name}: play: no free room beside the picture, the plates lie on its lower corners`);
        else check(!overlap(s.left, s.picture) && !overlap(s.right, s.picture) && s.left.y >= s.stage.y - 1 && s.left.b <= s.stage.b + 1, `${name}: play: the plates are in the stage, off the picture (${s.mode})`);
      } else {
        check(!overlap(s.left, s.cap) && !overlap(s.right, s.cap), `${name}: play: the plates leave the button's cap free`);
        check(Math.abs(s.left.y - s.arcade.y) < 2 && Math.abs(s.left.b - s.arcade.b) < 2 && s.left.w <= s.W * 0.25, `${name}: play: the plates are the button row's height at its outer ends`);
      }
    }
    if (tapped && s.left && s.right) {
      for (const side of ["left", "right"]) {
        const got = await tap(page, centre(s[side]));
        check(one(got, side) && got.heard[0].side === side, `${name}: play: the ${side} plate knocks on the ${side}, the console hears it, no press ${said(got)}`);
        await sleep(200);
      }
      const button = sideways ? centre(s.picture) : centre(s.cap);
      const pressed = await tap(page, button);
      check(pressed.presses.length === 2 && pressed.knocks.length === 0 && pressed.heard.length === 0, `${name}: play: the button is pressed and does not knock`);

      // The button and a plate held together (two fingers): both count, and lifting the plate's
      // finger does not let go of the button.
      const cdp = await context.newCDPSession(page);
      // touchStart lists every finger down; touchEnd lists the fingers lifted.
      const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([id, [x, y]]) => ({ x, y, id })) });
      const from = await mark(page);
      const plate = centre(s.left);
      await touch("touchStart", [[1, button]]); await sleep(150);
      await touch("touchStart", [[1, button], [2, plate]]); await sleep(150);
      const both = await page.evaluate(() => ({ button: vesper.state.device.button === true, plate: document.querySelector(".case-plate.case-left").classList.contains("down") }));
      await page.screenshot({ path: path.join(output, `${name}-held.png`) });
      await touch("touchEnd", [[2, plate]]); await sleep(150);
      const after = await page.evaluate(() => ({ button: vesper.state.device.button === true, plate: document.querySelector(".case-plate.case-left").classList.contains("down") }));
      const mid = await since(page, from);
      await touch("touchEnd", [[1, button]]); await sleep(200);
      const done = await since(page, from);
      await page.screenshot({ path: path.join(output, `${name}-play-after.png`) });
      check(both.button && both.plate && one({ ...mid, presses: [] }, "left") && mid.presses.length === 1 && mid.presses[0].down === true,
        `${name}: play: button and plate held together: the button is down and the plate knocks ${said(mid)}`);
      check(after.button && !after.plate && done.presses.length === 2 && done.presses[1].down === false && !(await page.evaluate(() => vesper.state.device.button)),
        `${name}: play: lifting the plate leaves the button held; lifting the button lets it go`);
      await cdp.detach();
    }

    // The system menu: its own CASE key beside its button.
    await page.keyboard.press("Escape");
    await sleep(1100);
    // A menu taller than the screen scrolls; its switch row is at the end of it.
    await page.evaluate(() => document.querySelector(".menu-switch .case-key")?.scrollIntoView({ block: "nearest" }));
    await sleep(150);
    s = await shapes(page, windowWidth);
    await page.screenshot({ path: path.join(output, `${name}-menu.png`) });
    check(s.menuKey && big(s.menuKey, s.scale) && !inBand(s.menuKey, band) && !overlap(s.menuKey, s.menuArcade) && s.menuKey.b <= s.H + 1,
      `${name}: menu: the key is ${size(s.menuKey, s.scale)}, beside its button, out of the crease`);
    if (tapped && s.menuKey) {
      const nav = () => page.evaluate(() => ({ index: vesper.nav.index, n: vesper.nav.items.length, open: !!vesper.menu }));
      const before = await nav();
      const got = await tap(page, centre(s.menuKey));
      const after = await nav();
      check(one(got, null), `${name}: menu: the key posts one knock with no side and the console hears it ${said(got)}`);
      check(after.open && before.n > 1 && after.index === (before.index + before.n - 1) % before.n, `${name}: menu: the key moves the focus to the previous choice (${before.index} to ${after.index} of ${before.n})`);
      if (name === "phone") { // two quick taps go back: the menu closes
        await sleep(900);
        await page.touchscreen.tap(...centre(s.menuKey));
        await sleep(250);
        await page.touchscreen.tap(...centre(s.menuKey));
        await sleep(300);
        check(!(await page.evaluate(() => !!vesper.menu)), `${name}: menu: two quick taps on the key close it`);
      }
    }
    const hostErrors = await page.evaluate(() => vesper.errors || []);
    check(!errors.length && !hostErrors.length, `${name}: no page or console errors ${JSON.stringify({ errors, hostErrors })}`);
    await context.close();
  }

  { // The plates follow the phone as it turns: upright, then sideways, then upright again.
    const { context, page } = await openPage(browser, html, CASES.phone);
    await play(page, "orbit");
    let s = await shapes(page, 393);
    const upright = !!(s.left && s.right) && s.mode === "";
    await page.setViewportSize({ width: 852, height: 393 });
    await page.evaluate((told) => vesperApp.fold(told), CASES["phone-sideways"].told);
    await sleep(400);
    s = await shapes(page, 852);
    const turned = s.mode === "sides" && !overlap(s.left, s.picture) && big(s.left, s.scale);
    await page.setViewportSize({ width: 393, height: 852 });
    await page.evaluate((told) => vesperApp.fold(told), CASES.phone.told);
    await sleep(400);
    s = await shapes(page, 393);
    check(upright && turned && s.mode === "" && s.left && !overlap(s.left, s.cap), "turning the phone mid-game: the plates move from the button's row to the picture's margins and back");
    await context.close();
  }

  finish(output, "ios-case-browser");
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => browser?.close());
