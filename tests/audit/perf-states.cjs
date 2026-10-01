/* Per-state cost matrix: for the dashboard, each game (bot-driven), and each
   instrument, measure (pass A, uninstrumented) CPU of the service and of each
   Chromium process type plus layout/style counts, then (pass B, instrumented)
   DOM churn per region and WebSocket messages/bytes per type.
   Usage: node tests/audit/perf-states.cjs  (STATE_SECONDS=20 MIC=1 MODEL=path) */
const L = require("./lib.cjs");
const seconds = Number(process.env.STATE_SECONDS || 20);

const DOM = `(() => {
  const m = (window.__dom = { records: 0, added: 0, removed: 0, by: {}, inner: { calls: 0, chars: 0, same: 0, by: {} } });
  const SEL = "#hud,#utility-content,#utility-actions,#app-grid,#menu-overlay,#toast,.masthead,.instrument-bar,.control-deck,#app-readout,#dashboard";
  const region = (n) => { const e = n.nodeType === 1 ? n : n.parentElement; const r = e && e.closest(SEL); return r ? r.id || r.className.split(" ")[0] : "other"; };
  const count = (n) => (n.nodeType === 1 ? 1 + n.getElementsByTagName("*").length : 1);
  window.__mo = new MutationObserver((list) => { for (const r of list) {
    m.records++; const b = (m.by[region(r.target)] ||= { records: 0, added: 0, removed: 0 }); b.records++;
    for (const n of r.addedNodes) { const c = count(n); m.added += c; b.added += c; }
    for (const n of r.removedNodes) { const c = count(n); m.removed += c; b.removed += c; } } });
  window.__mo.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  const d = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
  Object.defineProperty(Element.prototype, "innerHTML", { ...d, set(v) {
    const k = this.id || this.className || this.tagName, b = (m.inner.by[k] ||= { calls: 0, chars: 0, same: 0 });
    b.calls++; b.chars += String(v).length; m.inner.calls++; m.inner.chars += String(v).length;
    if (this.__last === v) { b.same++; m.inner.same++; } this.__last = v; return d.set.call(this, v); } });
})()`;

async function metrics(cdp) {
  const { metrics } = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(metrics.map((x) => [x.name, x.value]));
}
const diffM = (a, b) => ({
  layouts: b.LayoutCount - a.LayoutCount, styleRecalcs: b.RecalcStyleCount - a.RecalcStyleCount,
  scriptMs: +((b.ScriptDuration - a.ScriptDuration) * 1000).toFixed(0), layoutMs: +((b.LayoutDuration - a.LayoutDuration) * 1000).toFixed(0),
  styleMs: +((b.RecalcStyleDuration - a.RecalcStyleDuration) * 1000).toFixed(0), taskMs: +((b.TaskDuration - a.TaskDuration) * 1000).toFixed(0),
  nodes: b.Nodes, listeners: b.JSEventListeners,
});

async function goTo(page, id, bot) {
  await page.evaluate(async () => { window.__bot?.stop?.(); vesper.home(); for (const t of vesper.state.timers) await vesper.bridge.command("timer", { op: "remove", id: t.id }); });
  await L.sleep(200);
  if (id !== "dashboard") await L.launchApp(page, id, bot);
  if (id === "timers") await page.evaluate(() => vesper.bridge.command("timer", { op: "create", seconds: 1800, label: "AUDIT" }));
}

async function run(label, id, bot, page, cdp, svc, wsLog) {
  await goTo(page, id, bot);
  await L.sleep(1500);
  const m0 = await metrics(cdp);
  const cpu = await L.cpuWindow(svc, seconds * 1000);
  const layout = diffM(m0, await metrics(cdp));
  // Pass B
  await page.evaluate(DOM);
  wsLog.length = 0; wsLog.on = true;
  const w0 = Date.now(); await L.sleep(seconds * 1000); const secs = (Date.now() - w0) / 1000; wsLog.on = false;
  const dom = await page.evaluate(() => { window.__mo.disconnect(); return window.__dom; });
  const by = {};
  for (const f of wsLog) { const k = f.dir + " " + f.type; (by[k] ||= { msgs: 0, bytes: 0 }); by[k].msgs++; by[k].bytes += f.bytes; }
  const rate = (x) => +(x / secs).toFixed(2);
  const ws = Object.fromEntries(Object.entries(by).map(([k, v]) => [k, { msgsPerSec: rate(v.msgs), bytesPerSec: rate(v.bytes) }]));
  const out = {
    cpu, layoutPerSec: { layouts: rate(layout.layouts), styleRecalcs: rate(layout.styleRecalcs), scriptMsPerSec: rate(layout.scriptMs), layoutMsPerSec: rate(layout.layoutMs), styleMsPerSec: rate(layout.styleMs) },
    domNodes: layout.nodes, jsListeners: layout.listeners,
    dom: { records: rate(dom.records), addedNodesPerSec: rate(dom.added), removedNodesPerSec: rate(dom.removed),
      innerHTMLWritesPerSec: rate(dom.inner.calls), innerHTMLCharsPerSec: rate(dom.inner.chars), identicalRewritesPerSec: rate(dom.inner.same),
      byRegion: Object.fromEntries(Object.entries(dom.by).map(([k, v]) => [k, { records: rate(v.records), added: rate(v.added), removed: rate(v.removed) }])),
      innerHTMLByTarget: Object.fromEntries(Object.entries(dom.inner.by).map(([k, v]) => [k, { callsPerSec: rate(v.calls), charsPerSec: rate(v.chars), identicalPerSec: rate(v.same) }])) },
    ws: { totalMsgsPerSec: rate(wsLog.length), totalBytesPerSec: rate(wsLog.reduce((a, f) => a + f.bytes, 0)), byType: ws },
  };
  console.log(label.padEnd(26), "svc%", cpu.servicePct, "chromium%", cpu.chromiumTotalPct, "renderer", cpu.chromiumPct.renderer, "gpu", cpu.chromiumPct["gpu-process"], "busy", cpu.machineBusyPct,
    "| ws", out.ws.totalMsgsPerSec, "msg/s", out.ws.totalBytesPerSec, "B/s | dom +", out.dom.addedNodesPerSec, "nodes/s", out.dom.innerHTMLWritesPerSec, "innerHTML/s", out.dom.innerHTMLCharsPerSec, "ch/s");
  return out;
}

(async () => {
  const model = process.env.MODEL || "";
  const result = { when: new Date().toISOString(), seconds, viewport: "1024x600", states: {} };
  const svc = await L.startService(model ? ["--model", model] : []);
  let browser = await L.launch();
  try {
    const wsLog = []; wsLog.on = false;
    const { page, context, errors } = await L.openPage(browser, svc, { wsLog });
    const cdp = await context.newCDPSession(page); await cdp.send("Performance.enable");
    await page.evaluate(() => vesper.bridge.command("settings", { key: "sound", value: false }));
    const states = [["dashboard (no timers)", "dashboard", false], ...L.GAMES.map((g) => [g, g, true]), ...L.INSTRUMENTS.map((g) => [g, g, false])];
    for (const [label, id, bot] of states) result.states[label] = await run(label, id, bot, page, cdp, svc, wsLog);
    // A timer that finished and was never removed keeps the 1 Hz broadcast alive.
    await page.evaluate(async () => { for (const t of vesper.state.timers) await vesper.bridge.command("timer", { op: "remove", id: t.id }); await vesper.bridge.command("timer", { op: "create", seconds: 5, label: "DONE" }); });
    await L.sleep(7000);
    result.states["dashboard (finished timer left in list)"] = await run("dashboard (finished timer)", "dashboard", false, page, cdp, svc, wsLog);
    result.pageErrors = errors;
    await context.close();
    if (process.env.MIC !== "0" && model) { // microphone on with a synthetic (fake device) source
      await browser.close(); browser = await L.launch({ fakeMic: true });
      const wl = []; wl.on = false;
      const p2 = await L.openPage(browser, svc, { wsLog: wl });
      const c2 = await p2.context.newCDPSession(p2.page); await c2.send("Performance.enable");
      await p2.page.evaluate(() => vesper.bridge.command("settings", { key: "sound", value: false }));
      await goTo(p2.page, "diagnostics", false);
      const r = await p2.page.evaluate(async () => { try { await vesper.setMic("commands"); return "ok"; } catch (e) { return String(e.message); } });
      result.micStart = r;
      if (r === "ok") { await L.sleep(3000); result.states["diagnostics + microphone (commands, fake source)"] = await run("diagnostics + mic", "diagnostics", false, p2.page, c2, svc, wl); }
      await p2.page.evaluate(() => vesper.setMic("off").catch(() => {}));
    }
  } finally {
    await browser.close();
    svc.stop();
  }
  L.save("perf-states.json", result);
})().catch((e) => { console.error(e); process.exitCode = 1; });
