/* Before/after comparison of two checkouts, interleaved so machine load from
   other work affects both equally. Each variant is a directory containing
   vesper/ and web/ (for example a copy of the tree before a change).
   Usage: VARIANTS="before=/path/a,after=/path/b" ROUNDS=4 WINDOW=15 \
          SCENARIOS=dashboard,runner node tests/audit/perf-ab.cjs
   Reports the median over rounds of CPU% per Chromium process type and the
   layout/style recalculation rate and DOM mutation records per second. */
const L = require("./lib.cjs");
const variants = (process.env.VARIANTS || "current=" + L.root).split(",").map((v) => v.split("="));
const rounds = Number(process.env.ROUNDS || 4), win = Number(process.env.WINDOW || 15);
const scenarios = (process.env.SCENARIOS || "dashboard,runner").split(",");
const med = (a) => L.r3(L.pctl(a, 0.5));

const MUT = `(() => { window.__mut = 0; window.__mo2 = new MutationObserver((l) => { window.__mut += l.length; }); window.__mo2.observe(document, { subtree: true, childList: true, attributes: true, characterData: true }); })()`;

async function measure(dir, scenario) {
  const svc = await L.startService([], dir);
  const browser = await L.launch();
  try {
    const { page, context } = await L.openPage(browser, svc);
    const cdp = await context.newCDPSession(page); await cdp.send("Performance.enable");
    await page.evaluate(() => vesper.bridge.command("settings", { key: "sound", value: false }));
    if (scenario.endsWith("-nocrt")) await page.evaluate(() => vesper.bridge.command("settings", { key: "crt", value: false }));
    if (scenario.endsWith("-reduced")) await page.evaluate(() => vesper.bridge.command("settings", { key: "reducedMotion", value: true }));
    const id = scenario.split("-")[0];
    if (id !== "dashboard" && id !== "diagnostics") await L.launchApp(page, id, true);
    if (scenario.startsWith("diagnostics-level")) // 8 microphone level events/s, as with the mic on
      await page.evaluate(() => { vesper.launch("diagnostics"); setInterval(() => vesper.event({ type: "level", value: 0.05, droppedChunks: 0 }), 125); });
    await L.sleep(2000);
    await page.evaluate(MUT);
    const get = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value]));
    const m0 = await get();
    const cpu = await L.cpuWindow(svc, win * 1000);
    const m1 = await get(), mut = await page.evaluate(() => window.__mut);
    return { ...cpu.chromiumPct, total: cpu.chromiumTotalPct, service: cpu.servicePct, busy: cpu.machineBusyPct,
      layoutsPerSec: (m1.LayoutCount - m0.LayoutCount) / cpu.seconds, stylePerSec: (m1.RecalcStyleCount - m0.RecalcStyleCount) / cpu.seconds,
      layoutMsPerSec: ((m1.LayoutDuration - m0.LayoutDuration) * 1000) / cpu.seconds, mutationsPerSec: mut / cpu.seconds,
      scriptMsPerSec: ((m1.ScriptDuration - m0.ScriptDuration) * 1000) / cpu.seconds };
  } finally { await browser.close(); svc.stop(); }
}

(async () => {
  const result = { when: new Date().toISOString(), window: win, rounds, variants: Object.fromEntries(variants), scenarios: {} };
  for (const sc of scenarios) {
    const raw = Object.fromEntries(variants.map(([n]) => [n, []]));
    for (let r = 0; r < rounds; r++) for (const [name, dir] of variants) raw[name].push(await measure(dir, sc));
    result.scenarios[sc] = {};
    for (const [name] of variants) {
      const keys = Object.keys(raw[name][0]);
      result.scenarios[sc][name] = Object.fromEntries(keys.map((k) => [k, med(raw[name].map((x) => x[k] ?? 0))]));
      result.scenarios[sc][name].raw = raw[name];
    }
    console.log(sc);
    for (const [name] of variants) { const x = result.scenarios[sc][name]; console.log("  ", name.padEnd(8), "chromium total%", x.total, "renderer", x.renderer, "gpu", x["gpu-process"], "browser", x.browser, "| layouts/s", x.layoutsPerSec, "style/s", x.stylePerSec, "mutations/s", x.mutationsPerSec, "layoutMs/s", x.layoutMsPerSec, "scriptMs/s", x.scriptMsPerSec, "| machine busy", x.busy); }
  }
  L.save("perf-ab-" + (process.env.TAG || "run") + ".json", result);
})().catch((e) => { console.error(e); process.exitCode = 1; });
