/* Browser audit for the host. Isolated simulator on a free port; Chromium muted.
   Run: PYTHON=... PLAYWRIGHT_PATH=... TEST_BROWSER_BIN=... node tests/audit/host-browser.cjs */
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const root = path.resolve(__dirname, "../..");
const port = require("../free-port.cjs")();
const origin = "http://127.0.0.1:" + port;
const data = fs.mkdtempSync(path.join(os.tmpdir(), "vesper-audit-"));
const server = spawn(process.env.PYTHON || "python3", ["-m", "vesper.server", "--simulate", "--http-port", String(port), "--data", data], { cwd: root });
let logs = ""; server.stdout.on("data", (d) => (logs += d)); server.stderr.on("data", (d) => (logs += d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? "PASS " : "FAIL ") + name + " :: " + detail); };
let browser;
(async () => {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(origin + "/api/state")).ok) break; } catch {} await sleep(100); }
  browser = await chromium.launch({ headless: true, executablePath: process.env.TEST_BROWSER_BIN || undefined,
    args: ["--no-sandbox", "--mute-audio", "--disable-gpu"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(origin);
  await page.waitForFunction(() => window.vesper?.loaded);

  // B1: fault menu, then the 3 s hold / voice 'pause' path replaces it with the system menu.
  await page.evaluate(() => { vesper.launch("runner"); vesper.app.update = () => { throw new Error("boom"); }; });
  await page.waitForFunction(() => vesper.faulted);
  await page.evaluate(() => vesper.event({ type: "voice", action: "pause", heard: "pause" })); // same call the 3 s hold makes
  const labels = await page.evaluate(() => vesper.nav.items.map((i) => i.element.textContent));
  await page.evaluate(() => vesper.nav.items[0].run());
  const stillOpen = await page.evaluate(() => !!vesper.menu);
  check("B1 first item of the replaced menu (" + labels[0] + ") does something", !stillOpen, "menu still open after choosing it: " + stillOpen);

  // B4: link drops; timer badge keeps showing a frozen countdown.
  await page.evaluate(() => vesper.home());
  await page.evaluate(() => vesper.event({ type: "timers", timers: [{ id: "x", label: "T", running: true, remaining: 120, duration: 120 }] }));
  const before = await page.textContent("#timer-badge");
  await page.evaluate(() => vesper.event({ type: "offline" }));
  await page.waitForTimeout(3200);
  const after = await page.textContent("#timer-badge");
  check("B4 timer badge does not keep a frozen countdown while offline", before !== after || /OFFLINE|STALE|\?/.test(after), `before="${before}" after 3 s offline="${after}"`);

  fs.writeFileSync(path.join(process.env.TEST_OUTPUT || os.tmpdir(), "audit-host-browser.json"), JSON.stringify(results, null, 2));
})().catch((e) => { console.error(e, logs.slice(-1500)); process.exitCode = 1; })
  .finally(async () => { if (browser) await browser.close(); server.kill("SIGTERM"); fs.rmSync(data, { recursive: true, force: true }); });
