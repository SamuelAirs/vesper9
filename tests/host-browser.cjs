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
  await page.evaluate(async () => vesper.event({ ...(await vesper.bridge.get('state')), type: 'state', controller: true }));
  await page.evaluate(() => vesper.event({ type: "timers", timers: [] }));

  // F10: leaving an app returns to its card on its sector.
  const target = await page.evaluate(async () => {
    const { SECTORS } = await import("/apps/catalog.js");
    const page = 1, index = 2; // the third card of the second sector
    return { id: SECTORS[page].apps[index], page, index };
  });
  await page.evaluate((id) => { vesper.launch(id); vesper.home(); }, target.id);
  const landed = await page.evaluate(() => ({ page: vesper.page, index: vesper.nav.index, focused: document.querySelector(".app-card.is-focused")?.dataset.app }));
  check("F10 dashboard focus returns to the card just left", landed.page === target.page && landed.index === target.index && landed.focused === target.id, JSON.stringify({ target, landed }));

  // The system menu has one entry point. A held press is cancelled and its release swallowed whoever asks
  // (the gesture, Escape, the PAUSE button, the voice command, and any later trigger such as a knock).
  const press = (down) => page.evaluate((down) => vesper.event({ type: "button", pressed: down, source: "simulator", generation: 1, at_us: performance.now() * 1000 }), down);
  for (const how of ["api", "key", "button", "voice"]) {
    await page.evaluate(() => { vesper.home(); vesper.launch("orbit"); window.__ups = 0; const a = vesper.app, up = a.up.bind(a); a.up = (e) => { window.__ups++; return up(e); }; });
    await press(true);
    await page.evaluate((how) => {
      if (how === "api") vesper.requestMenu("knock");
      else if (how === "key") document.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", key: "Escape", bubbles: true }));
      else if (how === "button") document.getElementById("pause-button").click();
      else vesper.event({ type: "voice", action: "pause", heard: "pause" });
    }, how);
    const opened = await page.evaluate(() => ({ menu: !!vesper.menu, press: !!vesper.input.press, blocked: vesper.input.blocked }));
    await press(false);
    const after = await page.evaluate(() => ({ ups: window.__ups, blocked: vesper.input.blocked, menu: !!vesper.menu, index: vesper.nav.index }));
    check(`the menu opens from "${how}": held input cancelled, its release consumed, nothing chosen`,
      opened.menu && !opened.press && opened.blocked && after.ups === 0 && !after.blocked && after.menu && after.index === 0, JSON.stringify({ opened, after }));
  }

  // Part 2 host fixes, through the real host. A ctx is captured at mount, as F3 does.
  const ctxOf = (id) => page.evaluate(async (id) => {
    const { APPS } = await import("/apps/registry.js");
    const meta = APPS.find((a) => a.id === id), create = meta.create;
    meta.create = (c) => { window.__ctx = c; return create(c); };
    vesper.launch(id);
    meta.create = create;
  }, id);
  // 1. launching starts with the first action highlighted, wherever the dashboard stood.
  await page.evaluate(() => { vesper.home(); vesper.page = 3; vesper.buildHome(2); });
  await page.evaluate(() => vesper.launch("lantern"));
  check("launching an instrument highlights its first action", await page.evaluate(() => vesper.nav.index) === 0, String(await page.evaluate(() => vesper.nav.index)));
  await page.evaluate(() => { vesper.home(); vesper.page = 4; vesper.buildHome(3); vesper.launch("oracle"); });
  check("... whatever card it was launched from", await page.evaluate(() => vesper.nav.index) === 0, String(await page.evaluate(() => vesper.nav.index)));
  // 2. ctx.actions(items, { focus }) lands the highlight on the named action after a re-render.
  await ctxOf("lantern");
  const focused = await page.evaluate(() => {
    const items = [{ label: "ONE", id: "one", run() {} }, { label: "TWO", id: "two", run() {} }, { label: "THREE", id: "three", run() {} }];
    window.__ctx.actions(items, { focus: "three" });
    const a = vesper.nav.index;
    window.__ctx.actions(items);
    const b = vesper.nav.index;
    window.__ctx.actions(items, { focus: "two" });
    const c = vesper.nav.index;
    window.__ctx.actions(items, { focus: "no such id" });
    return [a, b, c, vesper.nav.index];
  });
  check("ctx.actions focus names the row to highlight (and keeps it when not given)", JSON.stringify(focused) === "[2,2,1,1]", JSON.stringify(focused));
  // 3. an app can silence the host's step tick, and leaving the app resets that.
  const ticks = await page.evaluate(() => {
    const calls = []; const tone = vesper.synth.tone.bind(vesper.synth); vesper.synth.tone = (...a) => { calls.push(a); return tone(...a); };
    const out = {};
    vesper.advance(); out.normal = calls.length;
    window.__ctx.silentTicks(true); vesper.advance(); out.silenced = calls.length;
    window.__ctx.silentTicks(false); vesper.advance(); out.restored = calls.length;
    window.__ctx.silentTicks(true); vesper.launch("lantern"); vesper.advance(); out.afterRelaunch = calls.length;
    window.__ctx.silentTicks(true); vesper.home(); out.flag = vesper.silentTicks;
    vesper.synth.tone = tone;
    return out;
  });
  check("ctx.silentTicks mutes the step tick until the app turns it off or is left", ticks.normal === 1 && ticks.silenced === 1 && ticks.restored === 2 && ticks.afterRelaunch === 3 && ticks.flag === false, JSON.stringify(ticks));

  // The gesture through the real page: two taps move the dashboard highlight, the hold opens the menu and puts it back.
  await page.evaluate(() => { vesper.home(); vesper.page = 0; vesper.buildHome(2); });
  const gestureFrom = (events) => page.evaluate(async () => {
    const pause = (ms) => new Promise((r) => setTimeout(r, ms));
    const key = (type) => document.dispatchEvent(new KeyboardEvent(type, { code: "Space", key: " ", bubbles: true }));
    for (let i = 0; i < 2; i++) { key("keydown"); await pause(60); key("keyup"); await pause(60); }
    key("keydown");
    const seen = { moved: vesper.nav.index, hint: document.getElementById("escape-hint").textContent };
    for (let w = 0; w < 3000 && !vesper.menu; w += 25) await pause(25);
    seen.title = document.getElementById("control-title").textContent;
    seen.menu = !!vesper.menu;
    key("keyup");
    await pause(100);
    return seen;
  });
  const seen = await gestureFrom();
  const settled = await page.evaluate(() => ({ menu: !!vesper.menu, title: document.getElementById("menu-title").textContent, index: vesper.nav.index, prior: vesper.menu.prior.index }));
  check("dashboard: tap, tap moves the highlight, the hold opens the menu and chooses nothing", seen.moved === 4 && seen.menu && settled.menu && settled.title === "System channel" && settled.prior === 2 && !(await page.evaluate(() => vesper.meta)), JSON.stringify({ seen, settled }));
  check("the hint line shows the gesture while it is counted", /NOW HOLD|TAP · TAP · HOLD/.test(seen.hint) && /MENU/.test(seen.hint), seen.hint);
  await page.evaluate(() => vesper.closeMenu());
  check("closing the menu leaves the highlight where it was before the first tap", await page.evaluate(() => vesper.nav.index) === 2, String(await page.evaluate(() => vesper.nav.index)));
  // SYSTEM TOOLS in the system menu opens Calibration, Node Scope and Telemetry, which are off the dashboard.
  await page.evaluate(() => vesper.systemMenu());
  const entries = await labels();
  check("the system menu has SYSTEM TOOLS and CALIBRATION", entries.includes("SYSTEM TOOLS") && entries.includes("CALIBRATION / SETTINGS"), JSON.stringify(entries));
  await page.evaluate(() => vesper.nav.items.find((i) => i.element.textContent === "SYSTEM TOOLS").run());
  const tools = await labels();
  check("SYSTEM TOOLS lists Calibration, Node Scope and Telemetry", ["CALIBRATION", "NODE SCOPE", "TELEMETRY", "BACK"].every((n) => tools.includes(n)), JSON.stringify(tools));
  await page.evaluate(() => vesper.nav.items.find((i) => i.element.textContent === "NODE SCOPE").run());
  check("a system tool opens", await page.evaluate(() => vesper.meta?.id) === "diagnostics", "diagnostics");
  await page.evaluate(() => vesper.home());
  const back = await page.evaluate(() => ({ page: vesper.page, index: vesper.nav.index }));
  check("leaving a system tool returns to the dashboard card the player came from", back.page === 0 && back.index === 2, JSON.stringify(back));
  const onDash = await page.evaluate(async () => {
    const { SECTORS } = await import("/apps/catalog.js");
    const listed = SECTORS.flatMap((s) => s.apps), cards = [];
    for (let p = 0; p < SECTORS.length; p++) { vesper.page = p; vesper.buildHome(); cards.push(...[...document.querySelectorAll(".app-card")].map((e) => e.dataset.app)); }
    return { listed, cards };
  });
  check("the dashboard shows exactly the listed sectors, in order", JSON.stringify(onDash.cards) === JSON.stringify(onDash.listed) && !onDash.cards.includes("ephemeris") && !onDash.cards.includes("settings"), JSON.stringify(onDash.cards));
  await page.evaluate(() => vesper.launch("ephemeris"));
  check("Ephemeris is retired from the dashboard but still launches by id", await page.evaluate(() => vesper.meta?.id) === "ephemeris", "launched");
  await page.evaluate(() => vesper.home());

  // F3: ctx.leds rounds, clamps and ignores malformed arrays.
  const ledResult = await page.evaluate(async () => {
    const { APPS } = await import("/apps/registry.js");
    const meta = APPS.find((a) => a.id === "runner"), create = meta.create;
    let ctx; meta.create = (c) => { ctx = c; return create(c); };
    vesper.launch("runner");
    meta.create = create;
    vesper.lights.setScale(1); // this check is about rounding; the lamp level has its own tests
    vesper.lights.set(Array(9).fill(40));
    ctx.leds([0.5, 300, -4, 1, 2, 3, 4, 5, 6.6]);
    const rounded = vesper.lights.desired.slice(); // twelve: a three-lamp frame leaves the fourth lamp dark
    ctx.leds([1, 2, 3]);
    ctx.leds("red");
    return { rounded, kept: vesper.lights.desired.slice() };
  });
  check("F3 ctx.leds rounds and clamps", JSON.stringify(ledResult.rounded) === JSON.stringify([1, 255, 0, 1, 2, 3, 4, 5, 7, 0, 0, 0]), JSON.stringify(ledResult.rounded));
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

  const burst = await page.evaluate(() => {
    vesper.home(); vesper.launch('orbit'); vesper.input.cancel(false);
    vesper.app.begin(); Object.assign(vesper.app, { points: 5, lives: 3, angle: 0, target: Math.PI, shield: 0 });
    const savedBefore = JSON.stringify(vesper.state.progress.orbit || {});
    for (const [pressed, ms] of [[true, 0], [false, 50], [true, 100], [false, 150], [true, 200], [false, 2400]])
      vesper.event({ type: 'button', pressed, source: 'simulator', generation: 1, at_us: ms * 1000 });
    return { menu: !!vesper.menu, lives: vesper.app.lives, phase: vesper.app.phase,
      savedSame: savedBefore === JSON.stringify(vesper.state.progress.orbit || {}) };
  });
  check('USB burst gesture restores Orbit and records no lost run', burst.menu && burst.lives === 3 && burst.phase === 'play' && burst.savedSame, JSON.stringify(burst));
  const heldGesture = await page.evaluate(() => {
    vesper.home(); vesper.launch('highbar'); vesper.input.cancel(false); vesper.app.start();
    const app = vesper.app, [x, y] = app.park().bars[0];
    Object.assign(app.p, { mode: 'air', x, y: y + 70, vx: 100, vy: 0 }); app.grab(0);
    let cancels = 0, now = 0;
    const cancel = app.cancel.bind(app), clock = vesper.input.clock;
    app.cancel = () => { cancels++; cancel(); };
    vesper.input.clock = () => now;
    try {
      for (const [pressed, ms] of [[true, 0], [false, 40], [true, 100], [false, 140], [true, 200]]) {
        now = ms; vesper.event({ type: 'button', pressed, source: 'simulator', generation: 1, at_us: ms * 1000 });
      }
      now = 2400; vesper.input.update();
      const restored = app.p.mode;
      vesper.event({ type: 'button', pressed: false, source: 'simulator', generation: 1, at_us: now * 1000 });
      return { menu: !!vesper.menu, cancels, restored, afterRelease: app.p.mode };
    } finally { vesper.input.clock = clock; }
  });
  check('held-terminal gesture cancels once and keeps High Bar restored through release', heldGesture.menu && heldGesture.cancels === 1 && heldGesture.restored === 'bar' && heldGesture.afterRelease === 'bar', JSON.stringify(heldGesture));
  const taps = await page.evaluate(() => {
    vesper.home(); vesper.input.cancel(false); vesper.input.lastEdge = -Infinity; vesper.input.knockQuietUntil = -Infinity;
    vesper.state.settings.tapMode = 'generic'; vesper.nav.index = 2;
    const before = vesper.knocksMuted || 0;
    vesper.synth.shakeUntil = performance.now() + 350;
    vesper.event({ type: 'knock', side: 'right', source: 'simulator', generation: 1, at_us: 1000000 });
    const suppressed = vesper.nav.index === 2 && vesper.knocksMuted === before + 1;
    vesper.synth.shakeUntil = 0;
    vesper.event({ type: 'knock', side: 'right', source: 'simulator', generation: 1, at_us: 2000000 });
    const previous = vesper.nav.index === 1;
    const oldPage = vesper.page;
    document.getElementById('previous-sector-button').click();
    return { suppressed, previous, sectorChanged: vesper.page !== oldPage, lamps: vesper.lampCount(), board: vesper.hasBoardLed() };
  });
  check('generic case navigation reverses and low-tone guard still suppresses self taps', taps.suppressed && taps.previous && taps.sectorChanged, JSON.stringify(taps));
  check('Windows service simulator exposes the finished four-lamp node', taps.lamps === 4 && taps.board, JSON.stringify(taps));
  const records = await page.evaluate(() => {
    const scores = vesper.state.scores;
    try {
      vesper.state.scores = { highbar: 999999, 'highbar:style-v2': 99999, 'highbar:flow-v3': 9999, 'highbar:flow-v4': 321, 'wayfinder:region-0': 123, 'wayfinder:region-2': 9999 };
      vesper.page = 0; vesper.buildHome();
      return { style: vesper.primaryBest('highbar'), scout: vesper.primaryBest('wayfinder'),
        label: document.querySelector('[data-app="wayfinder"] .card-stat').textContent };
    } finally { vesper.state.scores = scores; vesper.cardStats(); }
  });
  check('flow scoring keeps both earlier High Bar records and region records separate', records.style === 321 && records.scout === 123 && records.label === 'SCOUT BEST 123', JSON.stringify(records));

  const gameMenus = await page.evaluate(() => {
    return ['crawlspace', 'supper', 'pocketlinks', 'nightgrid'].map(id => {
      vesper.home(); vesper.launch(id); vesper.systemMenu();
      vesper.activate(vesper.nav.items.find(item => item.element.textContent === 'GAME GUIDE'));
      const guide = !vesper.menu && !vesper.paused && vesper.app.guide === 0;
      vesper.systemMenu();
      vesper.activate(vesper.nav.items.find(item => /^NEW (HOUSE|SERVICE|ROUND|NIGHT)$/.test(item.element.textContent)));
      return { id, guide, started: !vesper.menu && !vesper.paused && vesper.app.guide === -1 };
    });
  });
  check('all After Hours guide and new-run actions close the overlay and resume', gameMenus.every(row => row.guide && row.started), JSON.stringify(gameMenus));

  await ctxOf('lantern');
  const previews = await page.evaluate(() => {
    const seen = [], items = ['one', 'two', 'three'].map(id => ({ id, label: id, run() {} }));
    const onFocus = (index, id) => seen.push([index, id]);
    window.__ctx.actions(items, { focus: 'one', onFocus });
    vesper.advance(1); vesper.advance(-1); vesper.nav.items[2].element.click();
    const inputs = seen.slice(), retired = vesper.nav.onFocus;
    vesper.systemMenu();
    window.__ctx.actions(items, { focus: 'two', onFocus });
    const background = seen.length;
    vesper.closeMenu();
    const resumed = seen.slice();
    vesper.home(); retired(0, 'one'); window.__ctx.actions(items, { onFocus });
    return { inputs, background, resumed, final: seen };
  });
  check('instrument previews follow all focus changes and respect menus/lifetime',
    JSON.stringify(previews.inputs) === JSON.stringify([[0,'one'],[1,'two'],[0,'one'],[2,'three']]) &&
    previews.background === 4 && previews.resumed.length === 5 && previews.resumed[4][1] === 'two' && previews.final.length === 5,
    JSON.stringify(previews));

  check("no uncaught page errors", pageErrors.length === 0, JSON.stringify(pageErrors));
  fs.writeFileSync(path.join(output, "host-browser.json"), JSON.stringify(results, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
})().catch((e) => { console.error(e, logs.slice(-1500)); process.exitCode = 1; })
  .finally(async () => { if (browser) await browser.close(); await require('./browser-cleanup.cjs')(server, data); });
