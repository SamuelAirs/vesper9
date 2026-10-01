/* Optional end-to-end checks. Install Playwright; see docs/TESTING.md. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn, execFileSync } = require("node:child_process");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const root = path.resolve(__dirname, "..");
const port = require("./free-port.cjs")();
const origin = "http://127.0.0.1:" + port;
const data = fs.mkdtempSync(path.join(os.tmpdir(), "vesper-browser-"));
const output = process.env.TEST_OUTPUT || path.join(root, "test-output");
fs.mkdirSync(output, { recursive: true });
// Isolated fake notes exercise browsing and export; never touch user transcripts.
execFileSync(process.env.PYTHON || "python3", ['-c', `
from vesper.storage import Store
import sys
store=Store(sys.argv[1])
for n in range(12):
 sid=store.start_session()
 for line in range(26): store.line(sid, 'Fixture note %d / line %d' % (n,line))
 store.end_session(sid)
store.close()
`, data], {cwd:root});
const server = spawn(
  process.env.PYTHON || "python3",
  ["-m", "vesper.server", "--simulate", "--http-port", String(port), "--data", data],
  { cwd: root },
);
let logs = "";
server.stdout.on("data", (d) => (logs += d));
server.stderr.on("data", (d) => (logs += d));
let browser;
// The menu gesture, tap, tap, hold, timed inside the page so a busy machine's automation round trips
// cannot stretch the taps past the gesture window. The hold lasts until the menu is open (or 3 s).
const menuGesture = (page, pressMs = 55, gapMs = 60) => page.evaluate(async ([pressMs, gapMs]) => {
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const key = (type) => document.dispatchEvent(new KeyboardEvent(type, { code: "Space", key: " ", bubbles: true }));
  for (let i = 0; i < 2; i++) { key("keydown"); await pause(pressMs); key("keyup"); await pause(gapMs); }
  key("keydown");
  for (let waited = 0; waited < 3000 && !vesper.menu; waited += 25) await pause(25);
  key("keyup");
}, [pressMs, gapMs]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function button(page, ms = 80) {
  await page.keyboard.down("Space");
  await page.waitForFunction(() => !!vesper.input.press);
  await page.waitForTimeout(ms);
  await page.keyboard.up("Space");
  await page.waitForFunction(() => !vesper.input.press);
}
(async () => {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(origin + "/api/state")).ok) break;
    } catch {}
    if (i === 79) throw Error("Service did not start: " + logs);
    await sleep(100);
  }
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.TEST_BROWSER_BIN || undefined,
    args: [
      "--no-sandbox",
      "--mute-audio",
      "--disable-gpu",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 1366, height: 1100 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
  await page.waitForFunction(() => window.vesper?.loaded);
  const firstSector = require("../vesper/catalog.json").sectors[0].apps.length;
  assert.equal(await page.locator(".app-card").count(), firstSector, "the first sector's games are shown");
  await page.screenshot({
    path: path.join(output, "VESPER-9-Dashboard.png"),
    fullPage: true,
  });
  await button(page);
  assert.equal(await page.evaluate(() => vesper.nav.index), 1);
  await button(page, 800);
  assert.equal(await page.evaluate(() => vesper.meta.id), "orbit");
  await button(page, 3150);
  assert.equal(await page.locator("#menu-overlay").isVisible(), false, "a plain game hold must not open the menu");
  // A stalled frame can still break one sequence on a busy machine; allow a few attempts.
  for (let attempt = 0; attempt < 4 && !(await page.locator("#menu-overlay").isVisible()); attempt++) {
    if (attempt) await page.waitForTimeout(1500);
    await menuGesture(page);
    await page.waitForTimeout(150);
  }
  assert.equal(await page.locator("#menu-overlay").isVisible(), true);
  // The on-screen switch remains usable inside a modal.
  await page.locator("#menu-arcade").click({ delay: 80 });
  await page.waitForFunction(() => vesper.nav.index === 1);
  assert.equal(await page.evaluate(() => vesper.nav.index), 1);
  await page.keyboard.press("Escape");
  const games = [
    "orbit",
    "runner",
    "drift",
    "echo",
    "reaction",
    "glyphs",
    "morse",
  ];
  for (const app of games) {
    await page.evaluate((id) => vesper.launch(id), app);
    await page.waitForTimeout(100);
    await button(page);
    await page.waitForTimeout(160);
    await button(page, 260);
    await page.waitForTimeout(120);
    assert.equal(await page.locator("#game-stage").isVisible(), true, app);
    assert.deepEqual(await page.evaluate(() => vesper.errors), [], app);
    if (app === "orbit")
      await page.screenshot({
        path: path.join(output, "VESPER-9-Orbit.png"),
        fullPage: true,
      });
  }
  for (const app of [
    "timers",
    "transcribe",
    "environment",
    "diagnostics",
    "settings",
  ]) {
    await page.evaluate((id) => vesper.launch(id), app);
    await page.waitForTimeout(200);
    assert.equal(await page.locator("#utility-stage").isVisible(), true, app);
    assert.ok((await page.locator(".utility-button").count()) >= 2, app);
  }
  // Every other registered cartridge: mount it, press, hold, wait and leave, with no errors,
  // the right stage visible, and the lamps dark again a moment after returning home.
  const exercised = new Set([...games, "timers", "transcribe", "environment", "diagnostics", "settings"]);
  const others = (await page.evaluate(async () => {
    const { CARTRIDGES } = await import("/apps/catalog.js");
    return CARTRIDGES.map((c) => c.id);
  })).filter((id) => !exercised.has(id));
  for (const app of others) {
    await page.evaluate((id) => vesper.launch(id), app);
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => vesper.meta?.id), app, app);
    const instrument = await page.evaluate(() => !!vesper.app.navigation);
    assert.equal(await page.locator(instrument ? "#utility-stage" : "#game-stage").isVisible(), true, app);
    if (instrument) assert.ok((await page.locator(".utility-button").count()) >= 1, app);
    await button(page);
    await page.waitForTimeout(300);
    await button(page, instrument ? 760 : 400);
    await page.waitForTimeout(600);
    assert.deepEqual(await page.evaluate(() => vesper.errors), [], app);
    await page.evaluate(() => vesper.home());
    await page.waitForFunction(() => !vesper.app);
    assert.equal(await page.evaluate(() => vesper.state.mic.mode), "off", app + " left the microphone on");
    exercised.add(app);
  }
  await page.evaluate(() => vesper.launch("timers"));
  await page
    .getByRole("button", { name: "CREATE TIMER / 00:30", exact: true })
    .click();
  await page.waitForFunction(() => vesper.state.timers.length === 1);
  await page
    .getByRole("button", { name: "PAUSE / FIELD TIMER / 00:30", exact: true })
    .click();
  await page.waitForFunction(() => !vesper.state.timers[0].running);
  await page
    .getByRole("button", { name: "START / FIELD TIMER / 00:30", exact: true })
    .click();
  await page.waitForFunction(() => vesper.state.timers[0].running);
  // Configure a custom timer through the real wizard.
  await page.getByRole('button', {name:'CUSTOM TIMER / HH:MM:SS',exact:true}).click();
  for (const digit of [0,0,0,0,4,5]) await page.getByRole('button',{name:'DIGIT / '+digit,exact:true}).click();
  await page.getByRole('button',{name:'TEA',exact:true}).click();
  await page.getByRole('button',{name:'START / 00:45 / TEA',exact:true}).click();
  await page.waitForFunction(()=>vesper.state.timers.some(t=>t.label==='TEA'&&t.duration===45));
  // Older sessions and long notes are both navigable.
  await page.evaluate(()=>vesper.launch('transcribe'));
  await page.waitForFunction(()=>vesper.app.sessions.length===12);
  // The list of saved notes is its own screen now (the note itself gets the room).
  await page.getByRole('button',{name:'SAVED NOTES',exact:true}).click();
  await page.getByRole('button',{name:'OLDER NOTES',exact:true}).click();
  await page.waitForFunction(()=>vesper.app.offset===5&&vesper.app.sessions.length===7);
  const older=await page.evaluate(()=>vesper.app.sessions[0].id);
  // The action list is rebuilt just after the sessions arrive; wait for the entry itself.
  await page.waitForFunction(id=>vesper.nav.items.some(i=>i.id==='note-'+id),older);
  await page.evaluate(id=>{ const a=vesper.nav.items.find(i=>i.id==='note-'+id);a.run(); },older);
  await page.waitForFunction(id=>vesper.app.selected===id&&vesper.app.lines.length===26,older);
  await page.getByRole('button',{name:'NEXT TEXT PAGE',exact:true}).click();
  assert.equal(await page.evaluate(()=>vesper.app.linePage),1);
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'EXPORT SELECTED NOTE',exact:true}).click()]);
  assert.ok(download.suggestedFilename().includes(older.slice(0,8)));
  // Mode changes are available in the physical-button menu, not hidden settings.
  await page.evaluate(()=>vesper.launch('morse'));
  await menuGesture(page);
  await page.getByRole('button',{name:'SIGNAL SCHOOL / LISTEN & IDENTIFY',exact:true}).click();
  await page.waitForFunction(()=>vesper.app.mode==='listen'&&vesper.app.phase==='choose');
  assert.match(await page.locator('#control-hint').textContent(), /HIGHLIGHTED ANSWER/);
  await page.evaluate(()=>vesper.app.focus=vesper.app.choices.indexOf(vesper.app.target));
  await button(page,60);
  await page.waitForFunction(()=>vesper.app.sessionCorrect===1);
  await page.screenshot({path:path.join(output,'VESPER-9-Signal-School.png'),fullPage:true});
  // The retired context cannot navigate or command the current cartridge.
  await page.evaluate(()=>{window.retired=vesper.app.c;vesper.launch('orbit');});
  await page.evaluate(async()=>{retired.home();retired.pattern([{ms:100,values:Array(9).fill(200)}]);await retired.command('leds',{values:Array(9).fill(222)});});
  assert.equal(await page.evaluate(()=>vesper.meta.id),'orbit');
  await page.waitForTimeout(150);
  assert.notEqual(await page.evaluate(()=>vesper.state.leds[0]),222);
  // A menu transition must preserve a held-across-reset block until release.
  await page.evaluate(()=>{vesper.event({type:'node_reset',generation:2});vesper.event({type:'node_status',button:true,mic:false,generation:2});});
  assert.equal(await page.evaluate(()=>vesper.input.blocked),true);
  await page.evaluate(()=>vesper.event({type:'button',pressed:false,source:'simulator',generation:2,at_us:1000000}));
  assert.equal(await page.evaluate(()=>vesper.input.blocked),false);
  assert.equal(await page.evaluate(()=>vesper.nav.index),0);
  await button(page,750);
  // Device recovery and an effect exit resolve to a usable, dark state.
  await page.evaluate(()=>{vesper.event({type:'node_reset',generation:2});vesper.event({type:'node_status',button:false,mic:false,generation:2});});
  assert.equal(await page.evaluate(()=>vesper.input.blocked),false);
  await button(page,750); // Resume, using the first intended fresh press.
  assert.equal(await page.evaluate(()=>!!vesper.menu),false);
  // The default lamp level (medium, 0.5) halves the pattern colours: 120 reaches the lamps as 60.
  await page.evaluate(async()=>{await vesper.app.c.pattern([{ms:3000,values:Array(9).fill(120)}]);});
  await page.waitForFunction(()=>vesper.state.leds[0]===60);
  await page.evaluate(()=>vesper.home());
  // Leaving the app ends its pattern; the dashboard's own host lamp layer (a focus spot) may then
  // light the lamps, so "dark" is now "no longer the app's colour and the host owns the lamps".
  await page.waitForFunction(()=>vesper.lights.owner==="host"&&vesper.state.leds.every(n=>n!==60));
  await page.evaluate(() => vesper.launch("diagnostics"));
  await page
    .getByRole("button", { name: "TEST COLOUR / OFF", exact: true })
    .click();
  await page.waitForFunction(() => vesper.state.leds[0] === 90); // 180 at the default medium lamp level (0.5)
  await page.evaluate(() => vesper.launch("settings"));
  await page.getByRole("button", { name: "SOUND / ON", exact: true }).click();
  await page.waitForFunction(() => vesper.state.settings.sound === false);
  await page.evaluate(() => vesper.home());
  await page.reload();
  await page.waitForFunction(() => vesper.loaded);
  assert.equal(await page.evaluate(() => vesper.state.settings.sound), false);
  assert.equal(await page.evaluate(() => vesper.state.timers.length), 2);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: path.join(output, "VESPER-9-Mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(() => vesper.launch("runner"));
  await page.waitForTimeout(100);
  const stage = await page.locator("#game-stage").boundingBox();
  assert.ok(
    stage.y + stage.height <= 720,
    "entire game stage fits a 720p display",
  );
  const deck = await page.locator(".control-deck").boundingBox();
  assert.ok(deck.y + deck.height <= 720, "switch and status fit 720p");
  assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), "whole console fits 720p");
  await page.screenshot({
    path: path.join(output, "VESPER-9-720p.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1366, height: 1100 });
  await page.goto("file://" + path.join(root, "VESPER-9-Simulator.html"));
  await page.waitForFunction(() => vesper.loaded);
  assert.equal(
    await page.locator("style").count(),
    1,
    "standalone CSS is embedded",
  );
  assert.equal(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--phosphor")
        .trim(),
    ),
    "#d6efa4",
  );
  assert.equal(await page.evaluate(() => vesper.state.simulated), true);
  await button(page, 800);
  assert.equal(await page.evaluate(() => vesper.meta.id), "perihelion");
  await button(page);
  assert.deepEqual(errors, []);
  const result = {
    passed: true,
    appsExercised: exercised.size,
    checks: [
      "single-button navigation",
      "tap, tap, hold menu gesture and uninterrupted game hold",
      "modal switch",
      "every app mounts and updates",
      "timer create/pause/resume and custom duration/label",
      "saved note pages and selected export",
      "Morse listening mode",
      "retired app callbacks blocked",
      "device recovery and pattern cleanup",
      "full console fits 720p",
      "LED commands",
      "settings persistence",
      "responsive layout",
      "standalone bundle",
    ],
    pageErrors: errors,
  };
  fs.writeFileSync(
    path.join(output, "browser-results.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
})()
  .catch((e) => {
    console.error(e);
    console.error(logs.slice(-2500));
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
    server.kill("SIGTERM");
    fs.rmSync(data, { recursive: true, force: true });
  });
