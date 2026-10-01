/* Five-minute rotation through all 12 apps (25 s each, bots play the games).
   Samples the service's /proc CPU and RSS every 5 s, the page's JS heap (exact,
   via CDP, plus after a forced GC), DOM node and listener counts.
   Usage: node tests/audit/perf-soak.cjs   (SOAK_SECONDS=300 SLICE=25) */
const fs = require("node:fs");
const L = require("./lib.cjs");
const total = Number(process.env.SOAK_SECONDS || 300), slice = Number(process.env.SLICE || 25);
const apps = [...L.GAMES, "timers", "environment", "transcribe", "diagnostics", "settings"];

async function heap(cdp, gc) {
  if (gc) await cdp.send("HeapProfiler.collectGarbage");
  const h = await cdp.send("Runtime.getHeapUsage");
  const { metrics } = await cdp.send("Performance.getMetrics");
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
  return { usedMiB: +(h.usedSize / 1048576).toFixed(2), totalMiB: +(h.totalSize / 1048576).toFixed(2), nodes: m.Nodes, listeners: m.JSEventListeners, documents: m.Documents };
}

(async () => {
  const svc = await L.startService();
  const browser = await L.launch();
  const result = { when: new Date().toISOString(), totalSeconds: total, sliceSeconds: slice, viewport: "1024x600", samples: [], segments: [] };
  try {
    const { page, context, errors } = await L.openPage(browser, svc);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable"); await cdp.send("Runtime.enable"); await cdp.send("HeapProfiler.enable");
    await page.evaluate(async () => { await vesper.bridge.command("settings", { key: "sound", value: false }); await vesper.bridge.command("timer", { op: "create", seconds: 1800, label: "SOAK" }); });
    result.serviceStart = { ...L.procStatus(svc.pid), fds: fs.readdirSync(`/proc/${svc.pid}/fd`).length, readyMs: svc.readyMs };
    result.pageHeapStart = await heap(cdp, true);
    const started = Date.now(); let cpuPrev = L.procStat(svc.pid).ticks, tPrev = started, i = 0;
    while (Date.now() - started < total * 1000) {
      const id = apps[i++ % apps.length];
      await page.evaluate(() => { window.__bot?.stop?.(); vesper.home(); });
      await L.launchApp(page, id, L.GAMES.includes(id));
      const segStart = Date.now();
      const cpu = await L.cpuWindow(svc, 0, async () => {
        const end = segStart + slice * 1000;
        while (Date.now() < end && Date.now() - started < total * 1000) {
          await L.sleep(5000);
          const now = Date.now(), st = L.procStat(svc.pid), sx = L.procStatus(svc.pid);
          result.samples.push({ t: Math.round((now - started) / 1000), app: id, servicePct: +(((st.ticks - cpuPrev) / 100 / ((now - tPrev) / 1000)) * 100).toFixed(2),
            rssKiB: sx.rssKiB, threads: sx.threads, fds: fs.readdirSync(`/proc/${svc.pid}/fd`).length, heap: await heap(cdp, false) });
          cpuPrev = st.ticks; tPrev = now;
        }
      });
      result.segments.push({ app: id, ...cpu });
      console.log(String(Math.round((Date.now() - started) / 1000)).padStart(4), "s", id.padEnd(12), "svc%", cpu.servicePct, "chromium%", cpu.chromiumTotalPct, "busy", cpu.machineBusyPct);
    }
    result.serviceEnd = { ...L.procStatus(svc.pid), fds: fs.readdirSync(`/proc/${svc.pid}/fd`).length };
    result.pageHeapEnd = await heap(cdp, true);
    result.rssSlopeKiBPerMin = +(L.slope(result.samples.map((s) => [s.t, s.rssKiB])) * 60).toFixed(1);
    result.heapSlopeMiBPerMin = +(L.slope(result.samples.map((s) => [s.t, s.heap.usedMiB])) * 60).toFixed(3);
    result.rssFirstLastKiB = [result.samples[0]?.rssKiB, result.samples.at(-1)?.rssKiB];
    result.pageErrors = errors; result.appErrors = await page.evaluate(() => vesper.errors.slice());
    result.pendingRequests = await page.evaluate(() => vesper.bridge.pending.size);
    result.frameStatsAtEnd = await page.evaluate(() => vesper.frameStats());
  } finally {
    await browser.close();
    svc.stop();
  }
  L.save("perf-soak.json", result);
})().catch((e) => { console.error(e); process.exitCode = 1; });
