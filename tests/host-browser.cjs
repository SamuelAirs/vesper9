/* Browser regression checks for the host (web/main.js) that need a real DOM: fault-menu flow,
   lifecycle exceptions, timer badge while offline, dashboard focus, ctx.leds and lost-release
   recovery through the real event path. Isolated simulator on a free port; Chromium muted.
   Run: PYTHON=... PLAYWRIGHT_PATH=... TEST_BROWSER_BIN=... node tests/host-browser.cjs */
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const root = path.resolve(__dirname, "..");
const port = require("./free-port.cjs")();
const origin = "http://127.0.0.1:" + port;
const data = fs.mkdtempSync(path.join(os.tmpdir(), "vesper-hostbrowser-"));
const output = process.env.TEST_OUTPUT || path.join(root, "test-output");
fs.mkdirSync(output, { recursive: true });
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
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto(origin);
  await page.waitForFunction(() => window.vesper?.loaded);
  const labels = () => page.evaluate(() => vesper.nav.items.map((i) => i.element.textContent));

  // F5 + F7: after an app fault the system menu is the fault menu; no dead RESUME, one restart entry.
  await page.evaluate(() => { vesper.launch("runner"); vesper.app.update = () => { throw new Error("boom"); }; });
  await page.waitForFunction(() => vesper.faulted);
  const first = await labels();
  check("F7 fault menu has a single restart entry", first.filter((l) => /RESTART/.test(l)).length === 1 && !first.includes("RESTART APP"), JSON.stringify(first));
  await page.evaluate(() => vesper.event({ type: "voice", action: "pause", heard: "pause" })); // same call the 3 s hold makes
  const replaced = await labels();
  check("F5 the replaced menu offers no RESUME", !replaced.some((l) => /RESUME|RETURN TO DASHBOARD/.test(l)), JSON.stringify(replaced));
  check("F5 menu still names the failure", (await page.textContent("#menu-title")) === "Application stopped", await page.textContent("#menu-title"));
  await page.evaluate(() => vesper.nav.items[0].run());
  await page.waitForFunction(() => !vesper.faulted && !vesper.menu, null, { timeout: 3000 }).catch(() => {});
  check("F5 first item restarts the app", await page.evaluate(() => !vesper.faulted && !vesper.menu && vesper.meta?.id === "runner"), "restarted");

  // F8: a throwing tick opens the recovery menu once, and does not loop.
  await page.evaluate(() => { vesper.errors.length = 0; vesper.app.tick = () => { throw new Error("tick-boom"); }; });
  await page.waitForFunction(() => vesper.faulted, null, { timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(3200);
  const tickInfo = await page.evaluate(() => ({ faulted: vesper.faulted, menu: !!vesper.menu, title: document.getElementById("menu-title").textContent, n: vesper.errors.filter((e) => /tick-boom/.test(e)).length }));
  check("F8 tick exception opens the recovery menu once", tickInfo.faulted && tickInfo.menu && tickInfo.title === "Application stopped" && tickInfo.n === 1, JSON.stringify(tickInfo));
  await page.evaluate(() => vesper.home());

  // F8: a throwing resume does the same.
  await page.evaluate(() => { vesper.launch("runner"); vesper.errors.length = 0; vesper.app.resume = () => { throw new Error("resume-boom"); }; vesper.systemMenu(); });
  await page.evaluate(() => vesper.closeMenu());
  const resumeInfo = await page.evaluate(() => ({ faulted: vesper.faulted, menu: !!vesper.menu, title: document.getElementById("menu-title").textContent }));
  check("F8 resume exception opens the recovery menu", resumeInfo.faulted && resumeInfo.menu && resumeInfo.title === "Application stopped", JSON.stringify(resumeInfo));
  await page.evaluate(() => vesper.home());

  // F6: link drops; the badge keeps counting from the deadline and is marked stale.
  await page.evaluate(() => vesper.event({ type: "timers", timers: [{ id: "x", label: "T", running: true, remaining: 120, duration: 120, deadline: Date.now() / 1000 + 120 }] }));
  const before = await page.textContent("#timer-badge");
  await page.evaluate(() => vesper.event({ type: "offline" }));
  await page.waitForTimeout(3200);
  const after = await page.textContent("#timer-badge");
  check("F6 timer badge counts down and is marked stale while offline", before !== after && /STALE/.test(after) && !/STALE/.test(before), `before="${before}" after 3 s offline="${after}"`);
  await page.evaluate(() => vesper.event({ type: "timers", timers: [] }));

  // F10: leaving an app returns to its card on its sector.
  const target = await page.evaluate(async () => {
    const { CARTRIDGES } = await import("/apps/catalog.js");
    const i = CARTRIDGES.length > 7 ? CARTRIDGES.length > 14 ? 14 : 7 : 0;
    return { id: CARTRIDGES[i].id, page: Math.floor(i / 6), index: i % 6 };
  });
  await page.evaluate((id) => { vesper.launch(id); vesper.home(); }, target.id);
  const landed = await page.evaluate(() => ({ page: vesper.page, index: vesper.nav.index, focused: document.querySelector(".app-card.is-focused")?.dataset.app }));
  check("F10 dashboard focus returns to the card just left", landed.page === target.page && landed.index === target.index && landed.focused === target.id, JSON.stringify({ target, landed }));

  // F3: ctx.leds rounds, clamps and ignores malformed arrays.
  const ledResult = await page.evaluate(async () => {
    const { APPS } = await import("/apps/registry.js");
    const meta = APPS.find((a) => a.id === "runner"), create = meta.create;
    let ctx; meta.create = (c) => { ctx = c; return create(c); };
    vesper.launch("runner");
    meta.create = create;
    vesper.lights.set(Array(9).fill(40));
    ctx.leds([0.5, 300, -4, 1, 2, 3, 4, 5, 6.6]);
    const rounded = vesper.lights.desired.slice();
    ctx.leds([1, 2, 3]);
    ctx.leds("red");
    return { rounded, kept: vesper.lights.desired.slice() };
  });
  check("F3 ctx.leds rounds and clamps", JSON.stringify(ledResult.rounded) === JSON.stringify([1, 255, 0, 1, 2, 3, 4, 5, 7]), JSON.stringify(ledResult.rounded));
  check("F3 ctx.leds ignores malformed arrays", JSON.stringify(ledResult.kept) === JSON.stringify(ledResult.rounded), JSON.stringify(ledResult.kept));

  // F1: through the real event path, a lost release is recovered by node_status.
  await page.evaluate(() => vesper.home());
  await page.evaluate(() => { vesper.launch("runner"); window.__downs = 0; const app = vesper.app, down = app.down?.bind(app); app.down = (e) => { window.__downs++; return down?.(e); }; });
  await page.evaluate(() => vesper.event({ type: "button", pressed: true, source: "simulator", generation: 1, at_us: performance.now() * 1000 })); // release never arrives
  await page.waitForTimeout(400);
  await page.evaluate(() => vesper.event({ type: "node_status", button: false, generation: 1, leds: null }));
  const pressAfter = await page.evaluate(() => !!vesper.input.press);
  await page.evaluate(() => vesper.event({ type: "button", pressed: true, source: "simulator", generation: 1, at_us: performance.now() * 1000 }));
  const downs = await page.evaluate(() => window.__downs);
  check("F1 lost release recovered by node_status; next press reaches the game", !pressAfter && downs === 2, `press outstanding after status=${pressAfter} downs=${downs}`);

  check("no uncaught page errors", pageErrors.length === 0, JSON.stringify(pageErrors));
  fs.writeFileSync(path.join(output, "host-browser.json"), JSON.stringify(results, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
})().catch((e) => { console.error(e, logs.slice(-1500)); process.exitCode = 1; })
  .finally(async () => { if (browser) await browser.close(); server.kill("SIGTERM"); fs.rmSync(data, { recursive: true, force: true }); });
