// The iPhone app's page (ios/build-web.py) in Chrome at iPhone, iPhone Duo and iPad sizes, with a
// stand-in for the app: window.webkit.messageHandlers.vesper records what the page posts, and the
// display's safe-area insets are set as the app's CSS reads them. It checks the two play layouts
// (sideways: the page's own play mode; upright: the game on top, the button below, split at the
// middle on a squarer screen), the button's messages, and the saves handed between app and page.
// It does not run Swift, WebKit, a phone, its haptics or its real insets: see docs/IOS.md.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), url = require("node:url");
const { spawnSync } = require("node:child_process");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const root = path.resolve(__dirname, "..");
if (!process.env.TEST_OUTPUT) throw new Error("Set TEST_OUTPUT to a disposable evidence directory outside the repository.");
const output = path.join(process.env.TEST_OUTPUT, "ios-page");
fs.mkdirSync(output, { recursive: true });
const html = path.join(output, "index.html");
const built = spawnSync(process.env.PYTHON || "python3", [path.join(root, "ios/build-web.py"), html], { cwd: root, encoding: "utf8" });
assert.equal(built.status, 0, "ios/build-web.py failed: " + built.stderr);

// Insets: what each display keeps for itself (status area, corners, home bar), in points.
const SIZES = {
  "phone": { w: 393, h: 852, sat: 59, sab: 34 },
  "phone-sideways": { w: 852, h: 393, sal: 59, sar: 59, sab: 21 },
  "small-phone-sideways": { w: 667, h: 375 },
  "duo-outer": { w: 466, h: 678, sat: 50, sab: 34 },
  "duo-upright": { w: 669, h: 951, sat: 82, sab: 34 },
  "duo-book": { w: 951, h: 669, sar: 84, sab: 34 },
  "ipad-upright": { w: 820, h: 1180, sat: 24, sab: 20 },
};
const STANDIN = `(() => {
  window.__posted = [];
  window.webkit = { messageHandlers: { vesper: { postMessage: (m) => window.__posted.push(JSON.parse(JSON.stringify(m))) } } };
})();`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
const check = (ok, what) => {
  results.push({ ok: !!ok, what });
  console.log((ok ? "ok    " : "FAIL  ") + what);
};

async function open(browser, size, native) {
  const context = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await context.addInitScript(STANDIN + (native ? `window.__vesperNative = ${JSON.stringify(native)};` : ""));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url.pathToFileURL(html).href);
  await page.waitForFunction(() => window.vesper?.loaded);
  const px = (v) => (v || 0) + "px";
  await page.addStyleTag({ content: `html.vesper-app { --sat: ${px(size.sat)}; --sar: ${px(size.sar)}; --sab: ${px(size.sab)}; --sal: ${px(size.sal)}; }` });
  await sleep(300);
  return { context, page, errors };
}
const measure = (page) => page.evaluate(() => {
  const rect = (e) => {
    if (!e || e.hidden) return null;
    const b = e.getBoundingClientRect();
    return b.width && b.height ? { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), b: Math.round(b.bottom) } : null;
  };
  const q = (selector) => rect(document.querySelector(selector));
  return {
    inner: [innerWidth, innerHeight], page: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
    viewport: document.querySelector('meta[name="viewport"]').content, playing: document.body.classList.contains("playing"),
    stage: q("#game-stage"), arcade: q("#arcade"), cap: q("#arcade .arcade-cap"), heading: q(".app-heading"), hud: q("#hud"),
    readout: q("#app-readout"), copy: q(".control-copy"), lights: q(".physical-lights"), pause: q("#pause-button"), mic: q("#mic-button"),
  };
});
const viewportOf = (page) => page.evaluate(() => document.querySelector('meta[name="viewport"]').content);

let browser;
(async () => {
  browser = await chromium.launch({ headless: true, executablePath: process.env.TEST_BROWSER_BIN || undefined,
    args: ["--no-sandbox", "--mute-audio", "--disable-gpu", "--autoplay-policy=no-user-gesture-required"] });

  for (const [name, size] of Object.entries(SIZES)) {
    const { context, page, errors } = await open(browser, size);
    await page.screenshot({ path: path.join(output, `${name}-dashboard.png`) });
    await page.evaluate(() => vesper.launch("orbit"));
    await sleep(500);
    await page.keyboard.down("Space"); await sleep(80); await page.keyboard.up("Space");
    await sleep(1200);
    const m = await measure(page);
    await page.screenshot({ path: path.join(output, `${name}-orbit.png`) });
    const [W, H] = m.inner, sat = size.sat || 0, sab = size.sab || 0, sal = size.sal || 0, sar = size.sar || 0;
    check(m.playing && m.page[0] <= W && m.page[1] <= H, `${name}: in play the page is one screen (${W} x ${H})`);
    check(m.mic === null, `${name}: no microphone button`);
    check(m.stage && m.stage.x >= 0 && m.stage.b <= H && m.stage.x + m.stage.w <= W, `${name}: the game is on screen`);
    if (W > H) {
      check(W >= 700 && H >= 400, `${name}: laid out at 700 x 400 or more`);
      check(m.lights.x >= sal - 1 && m.stage.x + m.stage.w <= W - sar + 1, `${name}: lamps and game clear of the corners`);
    } else if (!m.arcade || !m.cap) check(false, `${name}: the button is shown`);
    else {
      check(m.heading.y >= sat - 1 && m.lights.y >= sat - 1, `${name}: title and lamps below the status area`);
      check(m.arcade.w >= W - 2 && m.arcade.h >= 100, `${name}: the button's area is the full width and ${m.arcade.h} tall`);
      check(m.cap.y >= m.arcade.y - 1 && m.cap.b <= m.arcade.b + 1, `${name}: the cap (${m.cap.w}) is inside the button's area`);
      check(m.copy.b <= H - sab + 1, `${name}: hints above the home bar`);
      check(m.stage.b <= m.hud.y + 1 && m.hud.b <= m.readout.y + 1 && m.readout.b <= m.arcade.y + 1 && m.arcade.b <= m.copy.y + 1, `${name}: rows in order, none overlapping`);
      if (size.w / size.h >= 5 / 8) {
        check(m.stage.b <= H / 2 + 1, `${name}: the game ends at or above the middle (${m.stage.b} of ${H / 2})`);
        check(m.hud.y >= H / 2 - 1, `${name}: everything else starts at or below the middle`);
      } else check(m.stage.w === W, `${name}: the game is the full width`);
    }
    await page.keyboard.press("Escape");
    await sleep(300);
    await page.screenshot({ path: path.join(output, `${name}-menu.png`) });
    const hostErrors = await page.evaluate(() => vesper.errors || []);
    check(!errors.length && !hostErrors.length, `${name}: no page or console errors ${JSON.stringify({ errors, hostErrors })}`);
    await context.close();
  }

  { // The button and the app.
    const { context, page } = await open(browser, SIZES.phone);
    await page.evaluate(() => vesper.launch("orbit"));
    await sleep(600);
    const presses = async (from) => (await page.evaluate((n) => window.__posted.slice(n), from)).filter((m) => m.t === "press");
    let from = await page.evaluate(() => window.__posted.length), m = await measure(page);
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
    let { context, page } = await open(browser, SIZES.phone, { saved: { "vesper-demo": old } });
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
    ({ context, page } = await open(browser, SIZES.phone, { saved: {}, launch: "orbit" }));
    await sleep(500);
    check((await page.evaluate(() => vesper.meta?.id)) === "orbit", "the app named at launch is opened");
    await context.close();
  }

  { // The viewport: the page's own guess first, then only the app's numbers.
    const { context, page } = await open(browser, SIZES["phone-sideways"]);
    const guess = await viewportOf(page);
    check(guess.startsWith("width=868,"), "a phone held sideways is laid out 868 wide: " + guess);
    await page.evaluate(() => vesperApp.fit(393, 852));
    const upright = await viewportOf(page);
    check(upright.startsWith("width=device-width"), "the app says upright: " + upright);
    await page.evaluate(() => { vesperApp.fit(); window.dispatchEvent(new Event("resize")); });
    check((await viewportOf(page)) === upright, "after that the page's own guess is not used");
    await page.evaluate(() => vesperApp.fit(932, 430));
    check((await viewportOf(page)).startsWith("width=device-width"), "a large phone held sideways needs nothing");
    await context.close();
  }

  const failed = results.filter((row) => !row.ok);
  fs.writeFileSync(path.join(output, "result.json"), JSON.stringify({ passed: results.length - failed.length, failed: failed.map((row) => row.what) }, null, 2) + "\n");
  assert.equal(failed.length, 0, failed.length + " check(s) failed");
  console.log(`ios-page-browser: ${results.length} checks passed`);
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => browser?.close());
