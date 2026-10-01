/* Browser checks for the host's voice handling (web/main.js `voice()`): each command class acts through the
   host's own functions, refusals say so, settings and timers really change on the service. Voice events are
   injected through the same entry point the WebSocket uses; no audio is involved. Isolated simulator on a free
   port; Chromium muted. Run: PYTHON=... PLAYWRIGHT_PATH=... TEST_BROWSER_BIN=... node tests/voice-host.cjs */
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const root = path.resolve(__dirname, "..");
const port = require("./free-port.cjs")();
const origin = "http://127.0.0.1:" + port;
const data = fs.mkdtempSync(path.join(os.tmpdir(), "vesper-voicehost-"));
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
  const say = (action, extra = {}) => page.evaluate(([a, x]) => vesper.event({ type: "voice", action: a, heard: "computer " + a, ...x }), [action, extra]);
  const toast = () => page.textContent("#toast");
  const serverState = async () => (await fetch(origin + "/api/state")).json();

  // Navigation on the dashboard: next, previous, select, next sector.
  const index = () => page.evaluate(() => vesper.nav.index);
  const start = await index();
  await say("next");
  const afterNext = await index();
  check("next moves the highlight on", afterNext === start + 1, `${start} -> ${afterNext}`);
  check("next confirms with the item's name", /HEARD \/ computer next → [A-Z ]+/.test(await toast()), await toast());
  await say("previous");
  check("previous moves it back", (await index()) === start, String(await index()));
  await say("previous");
  check("previous wraps round to the last item", (await index()) === (await page.evaluate(() => vesper.nav.items.length)) - 1, String(await index()));
  await say("next");
  await say("sector");
  const sector = await page.evaluate(() => ({ page: vesper.page, label: document.getElementById("sector-label").textContent }));
  check("next sector changes the dashboard sector", sector.page === 1 && /SECTOR 02/.test(sector.label) && /SECTOR 02/.test(await toast()), JSON.stringify(sector) + " | " + (await toast()));
  const sectors = await page.evaluate(async () => (await import("/apps/catalog.js")).SECTORS.length);
  for (let i = 1; i < sectors; i++) await say("sector");
  check("next sector wraps round to the first sector", (await page.evaluate(() => vesper.page)) === 0, `${sectors} sectors, page ${await page.evaluate(() => vesper.page)}`);
  await page.evaluate(() => vesper.home());
  await say("select");
  const selected = await page.evaluate(() => ({ app: vesper.meta?.id, nav: vesper.app?.navigation }));
  check("select chooses the highlighted app", selected.app === "perihelion", JSON.stringify(selected));

  // Inside a game: navigation says so and does nothing.
  const before = await page.evaluate(() => ({ app: vesper.meta.id, index: vesper.nav.index, menu: !!vesper.menu }));
  for (const action of ["next", "previous", "select"]) {
    await say(action);
    const text = await toast();
    const after = await page.evaluate(() => ({ app: vesper.meta?.id, index: vesper.nav.index, menu: !!vesper.menu }));
    check(`${action} inside a game is refused`, /NOT IN A GAME/.test(text) && JSON.stringify(after) === JSON.stringify(before), text);
  }
  await say("resume");
  check("resume with no menu says so", /NOTHING TO RESUME/.test(await toast()), await toast());
  await say("pause");
  check("menu opens the system menu from a game", await page.evaluate(() => !!vesper.menu), "menu open");
  await say("next");
  check("next moves within the open menu", (await index()) === 1, String(await index()));
  await say("select");
  check("select in a menu runs the chosen item", await page.evaluate(() => !vesper.menu || vesper.nav.index !== 1), "menu item ran");
  await say("home");
  check("home returns to the dashboard", await page.evaluate(() => !vesper.app && !vesper.menu), "dashboard");
  await say("home");
  check("home on the dashboard says so", /ALREADY ON THE DASHBOARD/.test(await toast()), await toast());
  await say("launch", { app: "timers" });
  check("open <app> launches it", (await page.evaluate(() => vesper.meta?.id)) === "timers", "timers");
  await say("sector");
  check("next sector inside an instrument is refused", /DASHBOARD ONLY/.test(await toast()), await toast());
  await say("next");
  check("next moves the highlight in an instrument", (await index()) >= 1, String(await index()));

  // Timers: the last one is paused, resumed and cancelled through the host's timer command.
  await page.evaluate(() => vesper.bridge.command("timer", { op: "create", seconds: 600, label: "TEA" }));
  await page.waitForFunction(() => vesper.state.timers.length === 1);
  await say("timer_pause");
  await page.waitForFunction(() => vesper.state.timers[0] && !vesper.state.timers[0].running);
  check("pause timer pauses the last timer on the service", (await serverState()).timers[0].running === false, JSON.stringify((await serverState()).timers[0]));
  await say("timer_pause");
  check("pausing a paused timer says so", /ALREADY PAUSED/.test(await toast()), await toast());
  await say("timer_resume");
  await page.waitForFunction(() => vesper.state.timers[0]?.running);
  check("resume timer restarts it", (await serverState()).timers[0].running === true, "running");
  await say("ask", { about: "timers" });
  check("show timers answers on screen", /1 TIMER \/ \d\d:\d\d/.test(await toast()), await toast());
  await say("timer_cancel");
  await page.waitForFunction(() => vesper.state.timers.length === 0);
  check("cancel timer removes the last timer", (await serverState()).timers.length === 0, "none left");
  await say("timer_cancel");
  check("cancel timer with none says so", /NO TIMERS/.test(await toast()), await toast());

  // Settings through the host's settings command: lamps, sound, volume.
  await page.evaluate(() => vesper.home());
  await say("lamps", { to: "up" });
  await page.waitForFunction(() => vesper.state.settings.lampLevel === "full");
  check("lamps up raises the lamp level", (await serverState()).settings.lampLevel === "full", (await serverState()).settings.lampLevel);
  await say("lamps", { to: "up" });
  check("lamps up at full says so", /ALREADY AT FULL/.test(await toast()), await toast());
  await say("lamps", { to: "down" });
  await say("lamps", { to: "off" });
  await page.waitForFunction(() => vesper.state.settings.lampLevel === "off");
  check("lamps off turns the lamp level off", (await serverState()).settings.lampLevel === "off", "off");
  await say("lamps", { to: "on" });
  await page.waitForFunction(() => vesper.state.settings.lampLevel === "medium");
  check("lamps on restores medium", true, "medium");
  await say("sound", { to: "off" });
  await page.waitForFunction(() => vesper.state.settings.sound === false);
  check("sound off", (await serverState()).settings.sound === false, "off");
  await say("sound", { to: "on" });
  await page.waitForFunction(() => vesper.state.settings.sound === true);
  await say("volume", { to: "down" });
  await page.waitForFunction(() => vesper.state.settings.volume < 0.25);
  check("volume down is a valid setting", (await serverState()).settings.volume < 0.25, String((await serverState()).settings.volume));

  // Questions.
  await say("ask", { about: "time" });
  check("the time is shown", /TIME \/ \d\d:\d\d/.test(await toast()), await toast());
  await page.evaluate(() => vesper.event({ type: "sensor", temperature: 21.5, humidity: 41, at: Date.now() / 1000 }));
  await say("ask", { about: "temperature" });
  check("the temperature is shown in the owner's unit", /TEMPERATURE \/ [\d.]+ °[CF]/.test(await toast()), await toast());
  await say("ask", { about: "humidity" });
  check("the humidity is shown", /HUMIDITY \/ 41 % RH/.test(await toast()), await toast());

  // Monitor tab: a second tab changes nothing.
  const monitor = await browser.newPage();
  await monitor.goto(origin);
  await monitor.waitForFunction(() => window.vesper?.loaded);
  await monitor.evaluate(() => vesper.event({ type: "voice", action: "lamps", heard: "computer lamps off", to: "off" }));
  check("a monitor tab does not change settings", /MONITOR TAB/.test(await monitor.textContent("#toast")) && (await serverState()).settings.lampLevel === "medium", await monitor.textContent("#toast"));
  await monitor.close();

  // Dictation commands.
  await say("dictation_stop");
  check("stop dictation explains itself", /CANNOT HEAR COMMANDS/.test(await toast()), await toast());

  check("no page errors", pageErrors.length === 0, JSON.stringify(pageErrors));
  await browser.close();
  server.kill();
  const failed = results.filter((r) => !r.ok);
  console.log(failed.length ? "FAILED " + failed.length + " of " + results.length : "ALL " + results.length + " PASSED");
  process.exit(failed.length ? 1 : 0);
})().catch(async (error) => {
  console.error("ERROR", error, logs.slice(-1500));
  try { await browser?.close(); } catch {}
  server.kill();
  process.exit(1);
});
