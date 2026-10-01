#!/usr/bin/env node
/* Developer tool: run the console in an isolated simulator at the real display
   size, drive the single button, and save screenshots.

   It starts its own simulated service on a free port with a temporary database,
   so it never touches the live console, the node or saved data. Needs Playwright
   (PLAYWRIGHT_PATH) and Chromium (TEST_BROWSER_BIN); see docs/TESTING.md.

   node scripts/dev-shot.cjs --app orbit --steps "wait:600;shot:title;tap;wait:900;shot:play"

   Options
     --app ID        cartridge to launch first (omit for the dashboard)
     --size WxH      viewport, default 1024x600 (Sam's display)
     --out DIR       where screenshots go, default test-output/shots
     --steps "…"     semicolon-separated actions, run in order:
         wait:MS            let the simulation run
         tap | tap:MS       press and release (default 80 ms)
         hold:MS            press, wait, release
         down | up          separate edges
         clicks:N[:GAP]     N quick taps, GAP ms apart (default 60)
         shot:NAME          save DIR/<app>-NAME.png
         launch:ID | home   change app
         key:NAME           press a keyboard key, e.g. key:Escape
         size:WxH           change the viewport
         eval:EXPRESSION    evaluate in the page and print the JSON result
   Exits 1 if the page or the host recorded any error. */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf("--" + name);
  return at >= 0 && at + 1 < args.length ? args[at + 1] : fallback;
};
const localPython = path.join(root, ".venv/bin/python");
const python = process.env.PYTHON || (fs.existsSync(localPython) ? localPython : "python3");
process.env.PYTHON = python;
const systemChromium = ["/usr/bin/chromium", "/usr/bin/chromium-browser"].find((p) => fs.existsSync(p));
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const port = require(path.join(root, "tests/free-port.cjs"))();
const origin = "http://127.0.0.1:" + port;
const out = path.resolve(option("out", path.join(root, "test-output/shots")));
const parseSize = (text) => {
  const [width, height] = String(text).split("x").map(Number);
  if (!width || !height) throw Error("Bad size: " + text);
  return { width, height };
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "vesper-shot-"));
  const server = spawn(python, ["-m", "vesper.server", "--simulate", "--http-port", String(port), "--data", data], { cwd: root });
  let logs = "";
  server.stdout.on("data", (d) => (logs += d));
  server.stderr.on("data", (d) => (logs += d));
  let browser, failed = false;
  try {
    for (let i = 0; ; i++) {
      try {
        if ((await fetch(origin + "/api/state")).ok) break;
      } catch {}
      if (i === 100) throw Error("Simulated service did not start:\n" + logs);
      await sleep(100);
    }
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.TEST_BROWSER_BIN || systemChromium || undefined,
      args: ["--no-sandbox", "--disable-gpu", "--mute-audio", "--autoplay-policy=no-user-gesture-required"],
    });
    const page = await browser.newPage({ viewport: parseSize(option("size", "1024x600")) });
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await page.goto(origin);
    await page.waitForFunction(() => window.vesper?.loaded);
    let app = option("app", "");
    if (app) {
      await page.evaluate((id) => vesper.launch(id), app);
      const mounted = await page.evaluate(() => vesper.meta?.id || null);
      if (mounted !== app) throw Error("Could not launch app: " + app);
    }
    const down = async () => {
      await page.keyboard.down("Space");
      await page.waitForFunction(() => !!vesper.input.press, null, { timeout: 2000 }).catch(() => {});
    };
    const up = async () => {
      await page.keyboard.up("Space");
      await page.waitForFunction(() => !vesper.input.press, null, { timeout: 2000 }).catch(() => {});
    };
    for (const raw of option("steps", "wait:500;shot:view").split(";").map((s) => s.trim()).filter(Boolean)) {
      const cut = raw.indexOf(":");
      const name = cut < 0 ? raw : raw.slice(0, cut), value = cut < 0 ? "" : raw.slice(cut + 1);
      if (name === "wait") await page.waitForTimeout(Number(value));
      else if (name === "tap" || name === "hold") {
        await down();
        await page.waitForTimeout(Number(value) || 80);
        await up();
      } else if (name === "down") await down();
      else if (name === "up") await up();
      else if (name === "clicks") {
        const [count, gap] = value.split(":").map(Number);
        for (let i = 0; i < count; i++) {
          await down();
          await page.waitForTimeout(55);
          await up();
          await page.waitForTimeout(gap || 60);
        }
      } else if (name === "shot") {
        const file = path.join(out, `${app || "dashboard"}-${value || "view"}.png`);
        await page.screenshot({ path: file });
        console.log("shot", file);
      } else if (name === "launch") {
        app = value;
        await page.evaluate((id) => vesper.launch(id), app);
      } else if (name === "home") {
        app = "";
        await page.evaluate(() => vesper.home());
      } else if (name === "key") await page.keyboard.press(value);
      else if (name === "size") await page.setViewportSize(parseSize(value));
      else if (name === "eval") console.log("eval", value, "=>", JSON.stringify(await page.evaluate(value)));
      else throw Error("Unknown step: " + raw);
    }
    const hostErrors = await page.evaluate(() => vesper.errors || []);
    if (pageErrors.length || hostErrors.length) {
      failed = true;
      console.error("ERRORS", JSON.stringify({ pageErrors, hostErrors }, null, 1));
    } else console.log("no page or host errors");
  } catch (error) {
    failed = true;
    console.error(String(error.stack || error));
  } finally {
    await browser?.close().catch(() => {});
    server.kill();
    fs.rmSync(data, { recursive: true, force: true });
  }
  process.exit(failed ? 1 : 0);
})();
