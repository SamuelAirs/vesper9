// Source-module browser journey: deterministic host clock, ordinary DOM keyboard edges,
// one controlling Chrome page, a disposable browser profile and a loopback static server.
// It does not exercise a Pi, a physical button, achieved frame rate or service persistence.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const root = path.resolve(__dirname, "../web");
const output = process.env.TEST_OUTPUT;
if (!output) throw new Error("Set TEST_OUTPUT to a disposable evidence directory outside the repository.");
fs.mkdirSync(output, { recursive: true });
const assetHashes = Object.fromEntries(["cairn.js", "cairn-content.js", "cairn-view.js"].map(name =>
  [name, require("node:crypto").createHash("sha256").update(fs.readFileSync(path.join(root, "apps", name))).digest("hex")]));
const route = [[1,38],[1,42],[-1,38],[-1,42],[1,39],[1,44],[-1,39],[-1,41],[-1,52],
  [1,42],[1,40],[1,35],[-1,42],[-1,40],[-1,54],[1,40],[1,46],[1,38],[-1,43],[-1,39],
  [-1,41],[1,40],[1,41],[1,39],[-1,42],[-1,42],[-1,54],[1,41],[1,44]];
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const file = path.resolve(root, "." + (name === "/" ? "/index.html" : name));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404); res.end(); return; }
    res.setHeader("Content-Type", { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml" }[path.extname(file)] || "application/octet-stream");
    res.end(data);
  });
});
let browser;
(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({ headless: true, executablePath: process.env.TEST_BROWSER_BIN || undefined,
    args: ["--no-sandbox", "--mute-audio", "--disable-gpu"] });
  const page = await browser.newPage({ viewport: { width: 1024, height: 600 }, deviceScaleFactor: 1 });
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript(() => {
    window.VESPER_STANDALONE = true;
    window.testClock = 1000;
    Object.defineProperty(performance, "now", { value: () => window.testClock });
    window.requestAnimationFrame = callback => { window.testFrame = callback; return 1; };
    window.cairnFrames = (n = 1) => { for (let i = 0; i < n; i++) { window.testClock += 1000 / 60 + 1e-8; window.testFrame?.(window.testClock); } };
    window.cairnKey = (type, code = "Space") => document.dispatchEvent(new KeyboardEvent(type, { code, key: code === "Space" ? " " : code, bubbles: true }));
    window.cairnPress = n => { cairnKey("keydown"); cairnFrames(n); cairnKey("keyup"); };
    window.cairnLeap = (direction, frames) => {
      if (vesper.app.p.facing !== direction) { cairnPress(4); cairnFrames(20); }
      cairnPress(frames);
      for (let i = 0; i < 600 && vesper.app.p.ground < 0; i++) cairnFrames();
      return { ground: vesper.app.p.ground, x: vesper.app.p.x, y: vesper.app.p.y, phase: vesper.app.phase };
    };
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  await page.goto(url); await page.waitForFunction(() => window.vesper?.loaded);
  await page.locator('[data-app="cairn"]').click();
  await page.evaluate(() => cairnFrames(2));
  await page.screenshot({ path: path.join(output, "01-title.png") });
  await page.evaluate(() => cairnPress(4));
  const landings = [];
  for (let i = 0; i < route.length; i++) {
    const landing = await page.evaluate(([d, n]) => cairnLeap(d, n), route[i]);
    assert.equal(landing.ground, i + 1, `browser landing ${i + 1}`); landings.push(landing);
    if ([5, 10, 18, 25, 28].includes(i)) {
      await page.evaluate(() => cairnFrames(35));
      await page.screenshot({ path: path.join(output, `${String(i + 2).padStart(2, "0")}-shelf-${i + 1}.png`) });
    }
  }
  const summit = await page.evaluate(() => ({ save: vesper.app.save, errors: vesper.errors, mic: vesper.state.mic.mode,
    size: [innerWidth, innerHeight, document.documentElement.scrollWidth, document.documentElement.scrollHeight] }));
  assert.equal(summit.save.summits, 1); assert.equal(summit.save.last.height, 365); assert.equal(summit.mic, "off");
  assert.deepEqual(summit.size, [1024, 600, 1024, 600]); assert.deepEqual(summit.errors, []);
  // Start a genuine new ascent, then leave on shelf 12. Reload must return to cairn 1.
  await page.evaluate(() => { cairnFrames(60); cairnPress(4); });
  for (let i = 0; i < 12; i++) await page.evaluate(([d, n]) => cairnLeap(d, n), route[i]);
  await page.evaluate(() => cairnFrames(35));
  const before = await page.evaluate(() => JSON.stringify({ p: vesper.app.p, save: vesper.app.save, jumps: vesper.app.jumps, seconds: vesper.app.elapsed }));
  await page.evaluate(() => { cairnPress(4); cairnFrames(3); cairnPress(4); cairnFrames(3); cairnKey("keydown"); cairnFrames(120); cairnKey("keyup"); });
  assert.equal(await page.evaluate(() => !!vesper.menu), true);
  await page.evaluate(() => { cairnKey("keydown", "Escape"); cairnKey("keyup", "Escape"); });
  const after = await page.evaluate(() => JSON.stringify({ p: vesper.app.p, save: vesper.app.save, jumps: vesper.app.jumps, seconds: vesper.app.elapsed }));
  assert.equal(after, before);
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("vesper-demo") || "{}").progress?.cairn?.active?.anchor === 1);
  await page.reload(); await page.waitForFunction(() => window.vesper?.loaded);
  await page.locator('[data-app="cairn"]').click();
  await page.evaluate(() => { cairnFrames(2); cairnPress(4); cairnFrames(30); });
  const reloaded = await page.evaluate(() => ({ ground: vesper.app.p.ground, charge: vesper.app.charge, vx: vesper.app.p.vx,
    vy: vesper.app.p.vy, eligible: vesper.app.eligible, save: vesper.app.save, errors: vesper.errors }));
  assert.equal(reloaded.ground, 8); assert.equal(reloaded.eligible, false); assert.equal(reloaded.charge, 0);
  assert.equal(reloaded.vx, 0); assert.equal(reloaded.vy, 0); assert.equal(reloaded.save.summits, 1);
  await page.screenshot({ path: path.join(output, "31-reload-cairn.png") });
  // Exercise the actual host picker: metadata alone does not enable save slots.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "SAVE SLOT / 1 OF 4", exact: true }).click();
  await page.getByRole("button", { name: /^SLOT 2 \/ / }).click();
  assert.equal(await page.evaluate(() => vesper.slotOf("cairn")), 2);
  assert.equal(await page.evaluate(() => vesper.app.save.summits), 0);
  assert.equal(await page.evaluate(() => vesper.app.save.checkpoint), 0);
  await page.waitForFunction(() => !vesper.saves.status().pending);
  await page.reload(); await page.waitForFunction(() => window.vesper?.loaded);
  await page.locator('[data-app="cairn"]').click();
  assert.equal(await page.evaluate(() => vesper.slotOf("cairn")), 2, "chosen slot survives relaunch");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "SAVE SLOT / 2 OF 4", exact: true }).click();
  await page.getByRole("button", { name: /^SLOT 1 \/ / }).click();
  assert.equal(await page.evaluate(() => vesper.app.save.summits), 1, "fresh slot preserves the earned career");
  assert.equal(await page.evaluate(() => vesper.app.save.active.anchor), 1);
  const slots = { count: 4, selectedSurvivedReload: true, originalCareerPreserved: true };
  assert.deepEqual(errors, []); assert.deepEqual(reloaded.errors, []);
  fs.writeFileSync(path.join(output, "journey.json"), JSON.stringify({ evidence: "Windows Chrome; deterministic host clock; DOM keyboard input; browser-local fake saves", assetHashes, landings, summit, reloaded, slots, errors }, null, 2));
  console.log(JSON.stringify({ result: "pass", landings: landings.length, summitMetres: 365, reloadShelf: reloaded.ground, output }));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close(); server.close();
});
