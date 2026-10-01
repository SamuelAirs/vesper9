/* Per-app frame cost: time in update() and draw() per rAF frame, the host's own
   overhead (frame() minus the app), rAF interval, canvas operations per frame.
   Usage: node tests/audit/perf-frames.cjs   (FRAME_SECONDS=25 AUDIT_OUT=dir)
   Pass 1 wraps update/draw/frame with performance.now() (cross-origin isolated,
   5 us clock). Pass 2 counts Canvas 2D calls per frame. */
const L = require("./lib.cjs");
const seconds = Number(process.env.FRAME_SECONDS || 25);

const WRAP = `(() => {
  const v = window.vesper, app = v.app, rec = (window.__rec = { frames: [], phase: {}, n: 0 });
  let upd = 0, drw = 0, nupd = 0;
  if (app && app.update) { const o = app.update.bind(app); app.update = (dt) => { const t = performance.now(); try { return o(dt); } finally { upd += performance.now() - t; nupd++; } }; }
  if (app && app.draw) { const o = app.draw.bind(app); app.draw = (g) => { const t = performance.now(); try { return o(g); } finally { drw += performance.now() - t; } }; }
  const f = (window.__origFrame ||= v.frame.bind(v));
  v.frame = (now) => {
    upd = drw = nupd = 0; const t = performance.now(); f(now); const total = performance.now() - t;
    rec.frames.push([total, upd, drw, nupd, now]);
    const p = v.app?.phase ?? "-"; rec.phase[p] = (rec.phase[p] || 0) + 1;
  };
})()`;
const COUNT = `(() => {
  const proto = CanvasRenderingContext2D.prototype, counts = (window.__ops = {}), frames = (window.__opFrames = { n: 0 });
  for (const k of Object.getOwnPropertyNames(proto)) {
    const d = Object.getOwnPropertyDescriptor(proto, k);
    if (typeof d.value === "function" && k !== "constructor") { const o = d.value; proto[k] = function (...a) { counts[k] = (counts[k] || 0) + 1; return o.apply(this, a); }; }
    else if (d.set && k !== "canvas") { const s = d.set; Object.defineProperty(proto, k, { ...d, set(x) { counts["set:" + k] = (counts["set:" + k] || 0) + 1; return s.call(this, x); } }); }
  }
  const f = window.vesper.frame.bind(window.vesper); window.vesper.frame = (n) => { frames.n++; f(n); };
})()`;

(async () => {
  const svc = await L.startService();
  const browser = await L.launch();
  const result = { when: new Date().toISOString(), seconds, viewport: "1024x600", apps: {} };
  try {
    const { page, errors } = await L.openPage(browser, svc, { coi: false });
    result.crossOriginIsolated = await page.evaluate(() => crossOriginIsolated);
    const targets = [["dashboard", false], ...L.GAMES.map((g) => [g, true]), ...L.INSTRUMENTS.map((g) => [g, false])];
    for (const [id, isGame] of targets) {
      const secs = isGame || id === "dashboard" ? seconds : 10;
      await page.evaluate(() => vesper.home());
      if (id !== "dashboard") await L.launchApp(page, id, isGame);
      await page.evaluate(WRAP);
      const cpu = await L.cpuWindow(svc, secs * 1000);
      // performance.now() is 100 us resolution here, so also time 300 back-to-back draws.
      const batchDrawMs = isGame || id === "dashboard" ? await page.evaluate(async () => {
        window.__bot?.stop?.(); const v = window.vesper, g = v.g, d = v.app ? v.app.draw?.bind(v.app) : () => { /* ambient */ };
        const m = await import("/engine/draw.js"); const run = v.app ? () => d(g) : () => m.ambient(v.ag, 1, 450, 300);
        for (let i = 0; i < 30; i++) run();
        const t = performance.now(); for (let i = 0; i < 300; i++) run(); return (performance.now() - t) / 300;
      }) : null;
      const rec = await page.evaluate(() => ({ frames: window.__rec.frames, phase: window.__rec.phase, bot: window.__bot ? { ticks: window.__bot.ticks, error: window.__bot.error } : null, errors: vesper.errors.slice() }));
      const fr = rec.frames, col = (i) => fr.map((f) => f[i]);
      const intervals = fr.slice(1).map((f, i) => f[4] - fr[i][4]);
      result.apps[id] = {
        frames: fr.length, fps: +(fr.length / cpu.seconds).toFixed(1), updatesPerSec: +(col(3).reduce((a, b) => a + b, 0) / cpu.seconds).toFixed(1),
        frameTotalMs: L.summary(col(0)), updateMs: L.summary(col(1)), drawMs: L.summary(col(2)),
        hostMs: L.summary(fr.map((f) => Math.max(0, f[0] - f[1] - f[2]))), rafIntervalMs: L.summary(intervals),
        batchDrawMs: batchDrawMs === null ? null : L.r3(batchDrawMs), phase: rec.phase, bot: rec.bot, appErrors: rec.errors, cpu,
      };
      console.log(id.padEnd(12), "draw", result.apps[id].drawMs.mean, "/", result.apps[id].drawMs.p95, " update", result.apps[id].updateMs.mean, "/", result.apps[id].updateMs.p95, " host", result.apps[id].hostMs.mean, " fps", result.apps[id].fps, JSON.stringify(rec.phase));
      await page.evaluate(() => { window.__bot?.stop?.(); });
    }
    // Pass 2: canvas operations per frame (separate pass; counting is intrusive).
    await page.reload(); await page.waitForFunction(() => window.vesper?.loaded);
    await page.evaluate(COUNT);
    result.canvasOpsPerFrame = {};
    for (const [id, isGame] of [["dashboard", false], ...L.GAMES.map((g) => [g, true])]) {
      await page.evaluate(() => { vesper.home(); window.__bot?.stop?.(); for (const k of Object.keys(window.__ops)) delete window.__ops[k]; window.__opFrames.n = 0; });
      if (id !== "dashboard") await L.launchApp(page, id, true);
      await page.evaluate(() => { for (const k of Object.keys(window.__ops)) delete window.__ops[k]; window.__opFrames.n = 0; });
      await L.sleep(8000);
      const r = await page.evaluate(() => ({ ops: { ...window.__ops }, n: window.__opFrames.n }));
      const per = Object.fromEntries(Object.entries(r.ops).map(([k, v]) => [k, +(v / r.n).toFixed(1)]).sort((a, b) => b[1] - a[1]));
      per.TOTAL_CALLS = +Object.entries(per).filter(([k]) => !k.startsWith("set:")).reduce((a, [, v]) => a + v, 0).toFixed(1);
      result.canvasOpsPerFrame[id] = per;
      console.log(id.padEnd(12), "canvas calls/frame", per.TOTAL_CALLS, JSON.stringify(per).slice(0, 220));
    }
    result.pageErrors = errors;
  } finally {
    await browser.close();
    svc.stop();
  }
  L.save("perf-frames.json", result);
})().catch((e) => { console.error(e); process.exitCode = 1; });
