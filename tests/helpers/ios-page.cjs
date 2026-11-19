// Shared by the checks of the iPhone app's page (tests/ios-*-browser.cjs): build the page, open
// it in Chrome with a stand-in for the app, and the cases the app is held in.
//
// The stand-in: window.webkit.messageHandlers.vesper records what the page posts (window.__posted),
// window.__vesperNative is what the app hands over before the page runs, and vesperApp.fold() is
// called as the app calls it. Sam's iPhone Duo: inner display 951 x 669 points, the crease a
// 40-point band at 455.5, a status row of 82 at the top when turned upright, a status column of 84
// at the right when opened like a book, the home bar 34; closed, the outer display is 466 x 678.
// None of this runs Swift, WebKit or a phone: see docs/IOS.md.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), url = require("node:url");
const { spawnSync } = require("node:child_process");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const root = path.resolve(__dirname, "../..");

// What the app tells the page in each case. safe: top, right, bottom, left.
const plain = (w, h, safe) => ({ w, h, told: { posture: "plain", crease: null, safe, window: [w, h] } });
const across = (posture) => ({ w: 669, h: 951, told: { posture, crease: [0, 455.5, 669, 40], safe: [82, 0, 34, 0], window: [669, 951] } });
const down = (posture) => ({ w: 951, h: 669, told: { posture, crease: [455.5, 0, 40, 669], safe: [0, 84, 34, 0], window: [951, 669] } });
const CASES = {
  "phone": plain(393, 852, [59, 0, 34, 0]),
  "phone-sideways": plain(852, 393, [0, 59, 21, 59]),
  "small-phone-sideways": plain(667, 375, [0, 0, 0, 0]),
  "ipad-upright": plain(820, 1180, [24, 0, 20, 0]),
  "duo-closed": plain(466, 678, [50, 0, 34, 0]),
  "duo-closed-sideways": plain(678, 466, [0, 50, 21, 50]),
  "duo-laptop": across("laptop"),
  "duo-open-upright": across("openTall"),
  "duo-book": down("openBook"),
  "duo-half-book": down("halfBook"),
};
const STANDIN = `(() => {
  window.__posted = [];
  window.webkit = { messageHandlers: { vesper: { postMessage: (m) => window.__posted.push(JSON.parse(JSON.stringify(m))) } } };
})();`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The evidence folder for one check (under TEST_OUTPUT, outside the repository) and the page built into it.
function build(name) {
  if (!process.env.TEST_OUTPUT) throw new Error("Set TEST_OUTPUT to a disposable evidence directory outside the repository.");
  const output = path.join(process.env.TEST_OUTPUT, name);
  fs.mkdirSync(output, { recursive: true });
  const html = path.join(output, "index.html");
  const built = spawnSync(process.env.PYTHON || "python3", [path.join(root, "ios/build-web.py"), html], { cwd: root, encoding: "utf8" });
  assert.equal(built.status, 0, "ios/build-web.py failed: " + built.stderr);
  return { output, html };
}

const launch = () => chromium.launch({ headless: true, executablePath: process.env.TEST_BROWSER_BIN || undefined,
  args: ["--no-sandbox", "--mute-audio", "--disable-gpu", "--autoplay-policy=no-user-gesture-required"] });

// One page as the app would show it. given: what the app hands over before the page runs (the
// fold goes with it, as in the app). The page's errors are collected in `errors`.
async function open(browser, html, one, given = {}) {
  const context = await browser.newContext({ viewport: { width: one.w, height: one.h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await context.addInitScript(STANDIN + `window.__vesperNative = ${JSON.stringify({ saved: {}, fold: one.told, ...given })};`);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url.pathToFileURL(html).href);
  await page.waitForFunction(() => window.vesper?.loaded);
  await page.evaluate((told) => vesperApp.fold(told), one.told);
  await sleep(300);
  return { context, page, errors };
}

// Open an app and press the button once, which starts most games.
async function play(page, id = "orbit") {
  await page.evaluate((id) => vesper.launch(id), id);
  await sleep(500);
  await page.keyboard.down("Space"); await sleep(80); await page.keyboard.up("Space");
  await sleep(1200);
}

// check(ok, what) prints and remembers; finish(output, name) writes result.json and fails if any did.
function checker() {
  const results = [];
  const check = (ok, what) => {
    results.push({ ok: !!ok, what });
    console.log((ok ? "ok    " : "FAIL  ") + what);
  };
  const finish = (output, name) => {
    const failed = results.filter((row) => !row.ok);
    fs.writeFileSync(path.join(output, "result.json"), JSON.stringify({ passed: results.length - failed.length, failed: failed.map((row) => row.what) }, null, 2) + "\n");
    assert.equal(failed.length, 0, failed.length + " check(s) failed");
    console.log(`${name}: ${results.length} checks passed`);
  };
  return { check, finish };
}

module.exports = { root, CASES, STANDIN, sleep, build, launch, open, play, checker };
