// The handheld edition (ios/layer/15-edition.js, web/apps/edition.js) in the app's page, in Chrome
// with the stand-in for the app: the six apps that need the Pi are on no sector and in no list, the
// one button never lands on one, no sector is empty, the system menu has no MICROPHONE line, the
// day's picks are shown apps, the handheld's words are the ones on screen, Twinbeat judges a case
// plate at the moment it is touched, and Light Trial keeps a touch time as a touch time. Then the
// standalone page without the app's layer (scripts/build-demo.py), where everything is as it was.
// It does not run Swift, WebKit or a phone: see docs/IOS.md.
const path = require("node:path"), url = require("node:url"), fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const { root, CASES, sleep, build, launch, open: openPage, checker } = require("./helpers/ios-page.cjs");
const { output, html } = build("ios-edition");
const { check, finish } = checker();

const HIDDEN = ["transcribe", "resonance", "environment", "diagnostics", "telemetry", "encyclopedia"];
const ONE_BUTTON = ["duo-laptop", "phone"];
const catalog = (() => {
  const data = JSON.parse(fs.readFileSync(path.join(root, "vesper/catalog.json"), "utf8"));
  return { sectors: data.sectors, apps: Object.fromEntries(data.apps.map((a) => [a.id, a])) };
})();

// The one button is the Space key here, as in the other checks: a tap, or a hold that chooses.
async function tap(page) { await page.keyboard.down("Space"); await sleep(50); await page.keyboard.up("Space"); await sleep(230); }
async function hold(page) { await sleep(800); await page.keyboard.down("Space"); await sleep(850); await page.keyboard.up("Space"); await sleep(400); }
const focused = (page) => page.evaluate(() => {
  const e = vesper.nav.items[vesper.nav.index]?.element;
  return { page: vesper.page, app: e?.dataset?.app || null, id: e?.id || null, menu: !!vesper.menu, inApp: !!vesper.app };
});

// Every sector as the page shows it: its name and the cards on it.
const dashboard = (page) => page.evaluate(async () => {
  const out = [], start = vesper.page;
  const count = document.querySelectorAll("#sector-strip button").length;
  for (let i = 0; i < count; i++) {
    vesper.page = i; vesper.buildHome();
    out.push({ name: document.getElementById("sector-title").textContent.toUpperCase(), cards: [...document.querySelectorAll("#app-grid .app-card")].map((c) => c.dataset.app) });
  }
  vesper.page = start; vesper.buildHome();
  return { tabs: [...document.querySelectorAll("#sector-strip button")].map((b) => b.textContent), pages: out };
});
const menuLabels = (page) => page.evaluate(() => [...document.querySelectorAll("#menu-actions button")].map((b) => b.textContent));

// Shared by both pages: what the system menu, its tools and HOW TO USE say.
async function menus(page) {
  const got = {};
  await page.evaluate(() => vesper.systemMenu());
  got.system = await menuLabels(page);
  await page.evaluate(() => vesper.systemTools());
  got.tools = await menuLabels(page);
  got.toolsText = await page.evaluate(() => document.getElementById("menu-description").textContent);
  await page.evaluate(() => vesper.closeMenu());
  got.howTo = await page.evaluate(() => vesper.howToUse());
  return got;
}
// One app opened: its description, its control line, its readout, its actions.
const opened = (page, id) => page.evaluate(async (id) => {
  vesper.launch(id);
  await new Promise((r) => setTimeout(r, 300));
  return { description: document.getElementById("app-description").textContent, controls: document.getElementById("control-hint").textContent,
    readout: document.getElementById("app-readout").textContent, actions: [...document.querySelectorAll("#utility-actions button")].map((b) => b.textContent),
    content: document.getElementById("utility-content").textContent, rows: vesper.app?.rows ? vesper.app.rows().map((r) => r.label) : [] };
}, id);

let browser;
(async () => {
  browser = await launch();

  for (const name of ["duo-laptop", "phone", "duo-closed"]) {
    const one = CASES[name];
    const { context, page, errors } = await openPage(browser, html, one);
    check(await page.evaluate(() => window.VESPER_EDITION?.name === "handheld"), `${name}: the page is given the handheld edition`);

    // The dashboard: no hidden app on any sector, no empty sector, the rest as the catalog has it.
    const d = await dashboard(page);
    const cards = d.pages.flatMap((p) => p.cards);
    check(HIDDEN.every((id) => !cards.includes(id)), `${name}: none of the six is on a sector's page (${cards.length} cards)`);
    check(d.pages.length === d.tabs.length && d.pages.every((p) => p.cards.length > 0), `${name}: every sector shown has cards: ${d.pages.map((p) => p.name + " " + p.cards.length).join(", ")}`);
    check(!d.tabs.includes("LISTEN"), `${name}: the LISTEN sector, left empty, is gone: ${d.tabs.join(" ")}`);
    const expected = catalog.sectors.map((s) => s.apps.filter((id) => !HIDDEN.includes(id) && catalog.apps[id])).filter((a) => a.length);
    check(JSON.stringify(d.pages.map((p) => p.cards)) === JSON.stringify(expected), `${name}: every other card is where the catalog puts it`);
    await page.screenshot({ path: path.join(output, `${name}-dashboard.png`) });

    // The one button, through the whole dashboard and back to the first sector.
    if (ONE_BUTTON.includes(name)) {
      const landed = new Set(), visited = new Set();
      await page.evaluate(() => { vesper.page = 0; vesper.buildHome(); });
      let f = await focused(page), steps = 0;
      while (steps < 120) {
        visited.add(f.page);
        if (f.app) landed.add(f.app);
        if (f.id === "sector-button") {
          const from = f.page;
          await hold(page);
          f = await focused(page);
          check(!f.menu && !f.inApp && f.page === (from + 1) % d.pages.length, `${name}: NEXT SECTOR chosen with a hold goes from sector ${from + 1} to ${f.page + 1}`);
          if (f.page === 0) break;
          continue;
        }
        await tap(page);
        f = await focused(page);
        steps++;
      }
      check(visited.size === d.pages.length, `${name}: the button reached all ${d.pages.length} sectors`);
      check(cards.every((id) => landed.has(id)), `${name}: and landed on all ${cards.length} cards`);
      check(HIDDEN.every((id) => !landed.has(id)), `${name}: and never on a hidden app`);
    }

    // The system menu and its tools.
    const m = await menus(page);
    check(!m.system.some((l) => /MICROPHONE/.test(l)), `${name}: the system menu has no MICROPHONE line: ${m.system.join(" | ")}`);
    check(JSON.stringify(m.tools) === JSON.stringify(["CALIBRATION", "BACK"]), `${name}: SYSTEM TOOLS lists only Calibration: ${m.tools.join(" | ")}`);
    check(!/Node Scope|Telemetry/.test(m.toolsText), `${name}: and does not describe the hidden tools`);
    check(/In a game the two case plates beside the button are the case, left and right\./.test(m.howTo) && / Calibration is under SYSTEM TOOLS in the system menu\.$/.test(m.howTo) && !/Space|Node Scope|Listen/.test(m.howTo),
      `${name}: HOW TO USE VESPER: ${m.howTo}`);
    await page.evaluate(() => vesper.systemMenu());
    await page.screenshot({ path: path.join(output, `${name}-menu.png`) });
    await page.evaluate(() => vesper.closeMenu());

    // The day's three, and a day picked with a hidden app (a console's saves brought over) picked again.
    const picks = await page.evaluate(() => {
      const before = vesper.logbook().picks.map((p) => p.a);
      vesper.book.picks = [{ a: "resonance", goal: "x", target: 0, own: 0, done: 0 }, ...vesper.book.picks.slice(1)];
      const after = vesper.logbook().picks.map((p) => p.a);
      vesper.todayLine();
      return { before, after, line: document.getElementById("today-line").textContent };
    });
    check(picks.before.length === 3 && picks.before.every((id) => !HIDDEN.includes(id) && cards.includes(id)), `${name}: today's picks are on the dashboard: ${picks.before.join(", ")}`);
    check(picks.after.length === 3 && picks.after.every((id) => !HIDDEN.includes(id) && cards.includes(id)), `${name}: a day picked with a hidden app is picked again: ${picks.after.join(", ")}`);
    check(!/RESONANCE|FIELD NOTES/.test(picks.line), `${name}: the TODAY line names no hidden app`);

    // The handheld's words.
    check(await page.evaluate(() => { vesper.knockVisual(true); const t = document.getElementById("escape-hint").textContent; vesper.knockVisual(false); return t === "CASE AGAIN: BACK"; }),
      `${name}: one CASE tap says CASE AGAIN: BACK`);
    const twin = await opened(page, "twinbeat");
    check(twin.description === catalog.apps.twinbeat.handheld.description && twin.controls === "TAP: NEXT · HOLD RELEASE: SELECT · CASE: PREVIOUS", `${name}: Twinbeat's description is the handheld's`);
    check(!twin.rows.some((l) => /CASE DELAY/.test(l)) && twin.rows.some((l) => l.startsWith("INPUT MODE")), `${name}: Twinbeat's console has no CASE DELAY ESTIMATE: ${twin.rows.join(" | ")}`);
    await page.screenshot({ path: path.join(output, `${name}-twinbeat.png`) });
    const trial = await opened(page, "reaction");
    check(trial.description === catalog.apps.reaction.handheld.description && trial.controls === "BUTTON: TOUCH-TIMED TRIAL", `${name}: Light Trial: ${trial.description} / ${trial.controls}`);
    const cal = await opened(page, "settings");
    check(cal.actions.includes("CASE PLATES / GENERIC") && !cal.actions.some((l) => /KNOCK|TAP DIRECTION|VOICE/.test(l)), `${name}: Calibration: ${cal.actions.join(" | ")}`);
    check(/CASE PLATES at LEFT \/ RIGHT/.test(cal.content) && !/computer|microphone/i.test(cal.content), `${name}: Calibration's note names the plates, not the voice`);
    await page.screenshot({ path: path.join(output, `${name}-calibration.png`) });
    const timers = await opened(page, "timers");
    check(/Timers keep time while VESPER is closed\.$/.test(timers.readout), `${name}: Chronometer: ${timers.readout}`);
    const library = await opened(page, "library");
    check(library.description === catalog.apps.library.handheld.description, `${name}: The Stacks: ${library.description}`);
    await page.evaluate(() => vesper.home());

    // Twinbeat, two sides on the plates: each tap is judged at the song time it was touched, less
    // nothing (no case delay, TIMING OFFSET 0), within the same touch.
    await page.evaluate(() => vesper.bridge.command("settings", { key: "tapMode", value: "sides" }));
    await sleep(100);
    await page.evaluate(() => {
      vesper.launch("twinbeat");
      const app = vesper.app;
      window.__strikes = [];
      const strike = app.strike.bind(app);
      app.strike = (side, event, kind) => {
        const songTime = app.songTime, now = performance.now(), result = strike(side, event, kind);
        window.__strikes.push({ side, kind, source: event.source, songTime, lagMs: now - event.at_us / 1000, result });
        return result;
      };
      app.start(0);
    });
    const plate = async (side) => {
      const box = await page.evaluate((side) => { const b = document.querySelector(".case-plate.case-" + side).getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; }, side);
      await page.touchscreen.tap(box[0], box[1]);
    };
    for (let n = 0; n < 4; n++) {
      // Wait for the next note, then touch its plate.
      const next = await page.evaluate(() => { const a = vesper.app, i = a.chart.notes.findIndex((x, k) => a.judgements[k] === null && x.at > a.songTime + 0.05); return i < 0 ? null : { wait: (a.chart.notes[i].at - a.songTime) * 1000, side: a.chart.notes[i].side }; });
      if (!next) break;
      await sleep(Math.max(0, next.wait - 15));
      await plate(next.side);
      await sleep(120);
    }
    const strikes = await page.evaluate(() => ({ strikes: window.__strikes, notes: vesper.app.chart.notes, offset: vesper.app.save.caseOffsetMs }));
    const judged = strikes.strikes.filter((s) => s.result.index >= 0 && s.result.error !== undefined);
    check(strikes.strikes.length === 4 && strikes.strikes.every((s) => s.kind === "case" && s.source === "simulator"), `${name}: Twinbeat: four plate taps reached the game as case taps (${strikes.strikes.length})`);
    check(judged.length >= 3 && judged.every((s) => Math.abs(s.result.error - (s.songTime - strikes.notes[s.result.index].at)) < 1e-9),
      `${name}: Twinbeat: each judged at the song time of the touch, nothing taken off (the save's case delay is ${strikes.offset} ms): ${judged.map((s) => Math.round(s.result.error * 1000) + " ms " + s.result.kind).join(", ")}`);
    check(strikes.strikes.every((s) => s.lagMs >= 0 && s.lagMs < 5), `${name}: Twinbeat: judged within the touch's own event (${strikes.strikes.map((s) => s.lagMs.toFixed(1)).join(", ")} ms after it)`);
    await page.screenshot({ path: path.join(output, `${name}-twinbeat-play.png`) });
    await page.evaluate(() => { vesper.home(); return vesper.bridge.command("settings", { key: "tapMode", value: "generic" }); });

    // Light Trial: one trial with the on-screen button. Its time is a touch time, said to be one.
    await page.evaluate(() => vesper.launch("reaction"));
    await sleep(400);
    const cap = await page.evaluate(() => { const b = document.querySelector("#arcade .arcade-cap").getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
    await page.touchscreen.tap(cap[0], cap[1]);
    await page.waitForFunction(() => vesper.app.phase === "go", null, { timeout: 8000 });
    await page.touchscreen.tap(cap[0], cap[1]);
    await sleep(700);
    const lt = await page.evaluate(() => ({ phase: vesper.app.phase, metric: vesper.app.metric, last: vesper.app.last,
      hud: [...document.querySelectorAll("#hud .hud-item")].map((e) => [...e.children].map((c) => c.textContent).join(" ")),
      scores: Object.keys(JSON.parse(localStorage.getItem("vesper-demo") || "{}").scores || {}).filter((k) => k.startsWith("reaction")) }));
    check(lt.phase === "result" && lt.metric === "simulator", `${name}: Light Trial: a touch trial (${lt.last} ms) on the phone's own clock, never the node's (${lt.metric})`);
    check(lt.hud.includes("CLOCK TOUCH"), `${name}: Light Trial: the HUD says CLOCK TOUCH: ${lt.hud.join(" | ")}`);
    check(lt.scores.includes("reaction:simulator") && !lt.scores.includes("reaction:physical"), `${name}: Light Trial: its best is kept as reaction:simulator: ${lt.scores.join(", ")}`);
    await page.screenshot({ path: path.join(output, `${name}-reaction-result.png`) });

    check(errors.length === 0, `${name}: no page errors ${errors.slice(0, 2).join(" / ")}`);
    await context.close();
  }

  // The standalone page without the app's layer: the console's own edition, as before.
  const plain = path.join(output, "standalone.html");
  const built = spawnSync(process.env.PYTHON || "python3", ["-c", "import runpy,sys; runpy.run_path(sys.argv[1])['build'](__import__('pathlib').Path(sys.argv[2]))", path.join(root, "scripts/build-demo.py"), plain], { cwd: root, encoding: "utf8" });
  check(built.status === 0, "scripts/build-demo.py builds the standalone page " + (built.stderr || ""));
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url.pathToFileURL(plain).href);
    await page.waitForFunction(() => window.vesper?.loaded);
    check(await page.evaluate(() => window.VESPER_EDITION === undefined), "standalone: no edition is given");
    const d = await dashboard(page);
    check(JSON.stringify(d.pages.map((p) => p.cards)) === JSON.stringify(catalog.sectors.map((s) => s.apps.filter((id) => catalog.apps[id]))) && d.tabs.includes("LISTEN"),
      `standalone: every sector and card as the catalog has them: ${d.tabs.join(" ")}`);
    const m = await menus(page);
    check(m.system.some((l) => l === "MICROPHONE / OFF"), `standalone: the system menu has its MICROPHONE line`);
    check(JSON.stringify(m.tools) === JSON.stringify(["CALIBRATION", "NODE SCOPE", "TELEMETRY", "BACK"]), `standalone: SYSTEM TOOLS: ${m.tools.join(" | ")}`);
    check(m.howTo.includes("Space or the on-screen arcade button also works.") && m.howTo.endsWith("Calibration, Node Scope and Telemetry are under SYSTEM TOOLS in the system menu."), "standalone: HOW TO USE VESPER is the console's");
    const twin = await opened(page, "twinbeat");
    check(twin.description === catalog.apps.twinbeat.description && twin.rows.includes("CASE DELAY ESTIMATE · 100 MS"), "standalone: Twinbeat keeps its description and CASE DELAY ESTIMATE");
    const trial = await opened(page, "reaction");
    check(trial.description === catalog.apps.reaction.description && trial.controls === catalog.apps.reaction.controls, "standalone: Light Trial's own words");
    const cal = await opened(page, "settings");
    check(["KNOCK SENSITIVITY / MEDIUM", "TAP DIRECTION / NOT CALIBRATED", "VOICE COMMANDS"].every((l) => cal.actions.includes(l)) && !cal.actions.some((l) => /CASE PLATES/.test(l)), "standalone: Calibration keeps knock sensitivity, tap direction and voice");
    const timers = await opened(page, "timers");
    check(/Timers follow the Pi clock across restarts\.$/.test(timers.readout), "standalone: Chronometer keeps the Pi clock");
    await page.evaluate(() => vesper.knockVisual(true));
    check((await page.evaluate(() => document.getElementById("escape-hint").textContent)) === "KNOCK AGAIN: BACK", "standalone: KNOCK AGAIN: BACK");
    await page.evaluate(() => vesper.home());
    await page.screenshot({ path: path.join(output, "standalone-dashboard.png") });
    check(errors.length === 0, `standalone: no page errors ${errors.slice(0, 2).join(" / ")}`);
    await context.close();
  }

  finish(output, "ios-edition-browser");
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => browser?.close());
