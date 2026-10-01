/* Micro-costs of the shared drawing helpers and host hot paths, in microseconds
   per call (minimum over 20 batches, so preemption on a busy Pi is filtered). */
const L = require("./lib.cjs");
(async () => {
  const svc = await L.startService();
  const browser = await L.launch();
  try {
    const { page } = await L.openPage(browser, svc);
    const r = await page.evaluate(async () => {
      const d = await import("/engine/draw.js"), v = window.vesper, g = v.g;
      const best = (fn, n) => { let m = Infinity; for (let b = 0; b < 20; b++) { const t = performance.now(); for (let i = 0; i < n; i++) fn(i); m = Math.min(m, (performance.now() - t) / n); } return +(m * 1000).toFixed(2); };
      g.setTransform(1, 0, 0, 1, 0, 0);
      const out = {};
      out["text() same font"] = best(() => d.text(g, "SCORE 0042", 100, 100, 22), 400);
      out["text() alternating 3 sizes"] = best((i) => d.text(g, "SCORE 0042", 100, 100, [13, 22, 37][i % 3]), 400);
      g.font = '22px "DejaVu Sans Mono",monospace';
      out["fillText only (fixed font)"] = best(() => g.fillText("SCORE 0042", 100, 100), 400);
      out["line()"] = best(() => d.line(g, 0, 0, 100, 100), 400);
      out["circle() stroke"] = best(() => d.circle(g, 100, 100, 20), 400);
      out["space(density 1) 100 stars"] = best((i) => d.space(g, i), 60);
      out["space(density .3)"] = best((i) => d.space(g, i, 0.3), 60);
      out["grid(90) 17 lines"] = best(() => d.grid(g, 90), 60);
      out["grid(60) 27 lines"] = best(() => d.grid(g, 60), 60);
      out["glyph()"] = best(() => d.glyph(g, 2, 100, 100, 17), 400);
      out["ambient() dashboard orrery"] = best((i) => d.ambient(v.ag, i, 450, 300), 60);
      out["banner()"] = best(() => d.banner(g, "TITLE", "subtitle"), 100);
      const items = [["DISTANCE", "123 m"], ["RELICS", 4], ["SECTOR", 2], ["BEST", 500]];
      out["hud() JSON.stringify key (unchanged)"] = best(() => JSON.stringify(items), 4000);
      v.frameTimes = Array.from({ length: 600 }, (_, i) => 16 + (i % 7) * 0.1);
      out["frameStats() sort 600 (Node Scope render)"] = best(() => v.frameStats(), 100);
      out["frameTimes push+shift (per frame)"] = best(() => { v.frameTimes.push(16.7); v.frameTimes.shift(); }, 4000);
      out["lights.flush() when idle (per frame, async)"] = best(() => v.lights.flush(true), 4000);
      return out;
    });
    console.log(JSON.stringify(r, null, 1));
    L.save("perf-micro.json", r);
  } finally { await browser.close(); svc.stop(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
