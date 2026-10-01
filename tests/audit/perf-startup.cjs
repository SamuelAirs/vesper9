/* Start-up: service readiness, navigation -> vesper.loaded, and bytes loaded.
   Cold = new browser context (empty cache); warm = reload with the HTTP cache.
   Usage: node tests/audit/perf-startup.cjs   (RUNS=8) */
const L = require("./lib.cjs");
const runs = Number(process.env.RUNS || 8);
const INIT = `(() => {
  const W = window.WebSocket;
  window.WebSocket = function (...a) { const ws = new W(...a); ws.addEventListener("message", (e) => { if (window.__stateAt === undefined && e.data.startsWith('{"type": "state"')) window.__stateAt = performance.now(); }); return ws; };
  window.WebSocket.prototype = W.prototype; for (const k of ["CONNECTING", "OPEN", "CLOSING", "CLOSED"]) window.WebSocket[k] = W[k];
})()`;

async function once(browser, svc, context, warm) {
  const page = warm ? context.pages()[0] : await context.newPage();
  const t0 = Date.now();
  if (warm) await page.reload(); else await page.goto(svc.origin);
  await page.waitForFunction(() => window.vesper?.loaded);
  const wall = Date.now() - t0;
  return page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0], res = performance.getEntriesByType("resource");
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    return { stateMsg: window.__stateAt, domContentLoaded: nav.domContentLoadedEventEnd, load: nav.loadEventEnd, fcp: fcp?.startTime ?? null,
      requests: res.length + 1, transferBytes: res.reduce((a, r) => a + r.transferSize, nav.transferSize), decodedBytes: res.reduce((a, r) => a + r.decodedBodySize, nav.decodedBodySize),
      resources: res.map((r) => ({ name: new URL(r.name).pathname, start: Math.round(r.startTime), end: Math.round(r.responseEnd), decoded: r.decodedBodySize, transfer: r.transferSize })) };
  }).then((r) => ({ ...r, wallMs: wall }));
}

(async () => {
  const svc = await L.startService();
  const browser = await L.launch();
  const result = { when: new Date().toISOString(), runs, serviceReadyMs: svc.readyMs, cold: [], warm: [] };
  try {
    for (let i = 0; i < runs; i++) {
      const context = await browser.newContext({ viewport: { width: 1024, height: 600 } });
      await context.addInitScript(INIT);
      result.cold.push(await once(browser, svc, context, false));
      result.warm.push(await once(browser, svc, context, true));
      await context.close();
    }
  } finally { await browser.close(); svc.stop(); }
  const med = (k, arr) => L.r3(L.pctl(arr.map((x) => x[k]), 0.5));
  result.summary = {};
  for (const m of ["cold", "warm"]) result.summary[m] = Object.fromEntries(["stateMsg", "domContentLoaded", "load", "fcp", "wallMs", "requests", "transferBytes", "decodedBytes"].map((k) => [k, { median: med(k, result[m]), min: L.r3(Math.min(...result[m].map((x) => x[k]))), max: L.r3(Math.max(...result[m].map((x) => x[k]))) }]));
  result.resources = result.cold[0].resources;
  console.log(JSON.stringify(result.summary, null, 1));
  L.save("perf-startup.json", result);
})().catch((e) => { console.error(e); process.exitCode = 1; });
