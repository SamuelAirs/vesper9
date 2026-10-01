/* Shared helpers for the performance audit scripts (tests/audit/perf-*.cjs).
   Starts an isolated simulated service on a free port with a temporary database,
   launches the system Chromium headless and muted, and reads /proc for CPU and
   memory. Never uses port 8799, serial ports, or real data. */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const freePort = require("../free-port.cjs");

const root = path.resolve(__dirname, "..", "..");
const out = process.env.AUDIT_OUT || path.join(root, "test-output", "audit");
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CLK = 100; // USER_HZ on Linux

async function startService(extra = [], cwd = root) {
  const port = freePort();
  if (port === 8799) throw new Error("port 8799 belongs to the live console");
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "vesper-audit-"));
  const server = spawn(
    process.env.PYTHON || "python3",
    ["-m", "vesper.server", "--simulate", "--http-port", String(port), "--data", data, ...extra],
    { cwd },
  );
  const svc = { port, origin: "http://127.0.0.1:" + port, data, server, pid: server.pid, logs: "" };
  server.stdout.on("data", (d) => (svc.logs += d));
  server.stderr.on("data", (d) => (svc.logs += d));
  const t0 = Date.now();
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(svc.origin + "/api/state")).ok) break;
    } catch {}
    if (i > 150) throw new Error("service did not start: " + svc.logs);
    await sleep(50);
  }
  svc.readyMs = Date.now() - t0;
  svc.stop = () => {
    server.kill("SIGTERM");
    fs.rmSync(data, { recursive: true, force: true });
  };
  return svc;
}

async function launch(opts = {}) {
  const args = ["--no-sandbox", "--mute-audio", "--disable-gpu", "--autoplay-policy=no-user-gesture-required",
    "--enable-precise-memory-info"];
  if (opts.fakeMic) args.push("--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream");
  return chromium.launch({ headless: true, executablePath: process.env.TEST_BROWSER_BIN || undefined, args });
}

// 1024 x 600 is the kiosk panel. coi=true serves the app with cross-origin
// isolation headers so performance.now() has 5 us instead of 100 us resolution.
async function openPage(browser, svc, { coi = false, wsLog = null, viewport = { width: 1024, height: 600 } } = {}) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (wsLog) // wsLog.on gates collection; entries are {dir, type, bytes, t}
    page.on("websocket", (ws) => {
      for (const ev of ["framesent", "framereceived"])
        ws.on(ev, ({ payload }) => {
          if (!wsLog.on) return;
          const text = typeof payload === "string";
          let type = "binary";
          if (text) { try { const j = JSON.parse(payload); type = ev === "framesent" ? "cmd:" + j.command : j.type; } catch { type = "?"; } }
          wsLog.push({ dir: ev === "framesent" ? "out" : "in", type, bytes: text ? Buffer.byteLength(payload) : payload.length, t: Date.now() });
        });
    });
  if (coi)
    await page.route("**/*", async (route) => {
      const r = await route.fetch();
      await route.fulfill({
        response: r,
        headers: { ...r.headers(), "cross-origin-opener-policy": "same-origin",
          "cross-origin-embedder-policy": "require-corp", "cross-origin-resource-policy": "same-origin" },
      });
    });
  await page.goto(svc.origin);
  await page.waitForFunction(() => window.vesper?.loaded);
  return { context, page, errors };
}

// ---- /proc ----
const readFile = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } };
function procStat(pid) {
  const s = readFile(`/proc/${pid}/stat`);
  if (!s) return null;
  const rest = s.slice(s.lastIndexOf(")") + 2).split(" ");
  return { ppid: Number(rest[1]), ticks: Number(rest[11]) + Number(rest[12]), threads: Number(rest[17]) };
}
function procStatus(pid) {
  const s = readFile(`/proc/${pid}/status`);
  if (!s) return null;
  const g = (k) => Number(new RegExp(k + ":\\s+(\\d+)").exec(s)?.[1] || 0);
  return { rssKiB: g("VmRSS"), hwmKiB: g("VmHWM"), threads: g("Threads") };
}
function descendants(rootPid) {
  const kids = new Map();
  for (const d of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(d)) continue;
    const st = procStat(d);
    if (st) (kids.get(st.ppid) || kids.set(st.ppid, []).get(st.ppid)).push(Number(d));
  }
  const all = [], stack = [rootPid];
  while (stack.length) for (const k of kids.get(stack.pop()) || []) { all.push(k); stack.push(k); }
  return all;
}
function classify(pid) {
  const c = (readFile(`/proc/${pid}/cmdline`) || "").replace(/\0/g, " ");
  if (!/chrom/.test(c)) return null;
  const m = /--type=([\w-]+)/.exec(c);
  return m ? m[1] : "browser";
}
// CPU ticks of my own Chromium processes grouped by process type.
function chromiumTicks() {
  const by = {};
  for (const pid of descendants(process.pid)) {
    const cls = classify(pid);
    const st = cls && procStat(pid);
    if (st) by[cls] = (by[cls] || 0) + st.ticks;
  }
  return by;
}
// Per-thread CPU ticks of the busiest renderer, by thread name.
function rendererThreads() {
  const by = {};
  for (const pid of descendants(process.pid)) {
    if (classify(pid) !== "renderer") continue;
    for (const tid of fs.readdirSync(`/proc/${pid}/task`)) {
      const name = (readFile(`/proc/${pid}/task/${tid}/comm`) || "").trim();
      const s = readFile(`/proc/${pid}/task/${tid}/stat`);
      if (!s) continue;
      const rest = s.slice(s.lastIndexOf(")") + 2).split(" ");
      by[name] = (by[name] || 0) + Number(rest[11]) + Number(rest[12]);
    }
  }
  return by;
}
function systemBusy() {
  const f = readFile("/proc/stat").split("\n")[0].trim().split(/\s+/).slice(1).map(Number);
  const idle = f[3] + f[4];
  return { total: f.reduce((a, b) => a + b, 0), idle };
}
const diffMap = (a, b) => Object.fromEntries(Object.keys({ ...a, ...b }).map((k) => [k, (b[k] || 0) - (a[k] || 0)]));

// One measurement window: CPU of service + browser classes + whole machine.
async function cpuWindow(svc, ms, during) {
  const s0 = procStat(svc.pid).ticks, c0 = chromiumTicks(), t0 = rendererThreads(), m0 = systemBusy(), w0 = Date.now();
  if (during) await during(); else await sleep(ms);
  const secs = (Date.now() - w0) / 1000;
  const s1 = procStat(svc.pid).ticks, c1 = chromiumTicks(), t1 = rendererThreads(), m1 = systemBusy();
  const pct = (ticks) => +((ticks / CLK / secs) * 100).toFixed(2);
  const chrom = Object.fromEntries(Object.entries(diffMap(c0, c1)).map(([k, v]) => [k, pct(v)]));
  const threads = Object.fromEntries(Object.entries(diffMap(t0, t1)).map(([k, v]) => [k, pct(v)]).filter(([, v]) => v >= 0.5));
  const busyTotal = m1.total - m0.total, busyIdle = m1.idle - m0.idle;
  return {
    seconds: +secs.toFixed(1), servicePct: pct(s1 - s0), chromiumPct: chrom,
    chromiumTotalPct: +Object.values(chrom).reduce((a, b) => a + b, 0).toFixed(2), rendererThreadsPct: threads,
    machineBusyPct: +(((busyTotal - busyIdle) / busyTotal) * 100).toFixed(1), load1: os.loadavg()[0],
  };
}

// ---- statistics ----
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const pctl = (a, p) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; };
const r3 = (x) => +x.toFixed(3);
function summary(a) { return { n: a.length, mean: r3(mean(a)), p50: r3(pctl(a, 0.5)), p95: r3(pctl(a, 0.95)), max: r3(Math.max(0, ...a)) }; }
function slope(points) { // least squares y per x
  const n = points.length; if (n < 2) return 0;
  const mx = mean(points.map((p) => p[0])), my = mean(points.map((p) => p[1]));
  let nu = 0, de = 0; for (const [x, y] of points) { nu += (x - mx) * (y - my); de += (x - mx) ** 2; }
  return de ? nu / de : 0;
}
function save(name, data) {
  const file = path.join(out, name);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  console.log("wrote", file);
}

// ---- bots: in-page players that press the simulated button via the real
// WebSocket path (vesper.softwareButton). They avoid four quick clicks. ----
const BOT_SOURCE = `(() => {
  const v = window.vesper;
  const press = (ms) => { v.softwareButton(true); setTimeout(() => v.softwareButton(false), ms); };
  let busyUntil = 0;
  const free = () => performance.now() >= busyUntil;
  const hold = (ms, gap = 200) => { busyUntil = performance.now() + ms + gap; press(ms); };
  const wrap = (a) => ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
  const MORSE = { A:".-",B:"-...",C:"-.-.",D:"-..",E:".",F:"..-.",G:"--.",H:"....",I:"..",J:".---",K:"-.-",L:".-..",M:"--",N:"-.",O:"---",P:".--.",Q:"--.-",R:".-.",S:"...",T:"-",U:"..-",V:"...-",W:".--",X:"-..-",Y:"-.--",Z:"--.." };
  let holdState = { on: false, since: 0 };
  const setHold = (want) => { // Undertow: hold/release with a minimum dwell so taps are not "quick clicks".
    const now = performance.now();
    if (want === holdState.on || now - holdState.since < 190) return;
    holdState = { on: want, since: now }; v.softwareButton(want);
  };
  const logic = {
    orbit(a) { if (a.phase !== "play") return free() && hold(80, 400); if (free() && Math.abs(wrap(a.angle - a.target)) < 0.07) hold(60, 150); },
    runner(a) {
      if (a.phase !== "play") return free() && hold(80, 400);
      const speed = 290 + Math.min(a.points * 10, 160);
      const o = a.obstacles.find((o) => o.x + o.w > 200);
      if (o && a.grounded && free() && o.x - 222 < speed * 0.42 && o.x - 222 > 0) hold(520, 300);
    },
    drift(a) {
      if (a.phase !== "play") { holdState = { on: false, since: 0 }; return free() && hold(80, 400); }
      const g = a.gates.find((g) => g.x + 65 > 200), target = g ? g.center : 270, pred = a.y + a.vy * 0.2;
      if (pred > target + 6) setHold(true); else if (pred < target - 6) setHold(false);
    },
    echo(a) {
      if (a.phase === "title" || a.phase === "over") return free() && hold(80, 400);
      if (a.phase === "listen" && free()) hold(a.sequence[a.entered.length] ? 480 : 90, 260);
    },
    reaction(a) {
      if (["title", "result", "early", "error"].includes(a.phase)) return free() && hold(80, 600);
      if (a.phase === "go" && free()) hold(80, 400);
    },
    glyphs(a) {
      if (a.phase === "title" || a.phase === "over") return free() && hold(80, 400);
      if (a.phase === "choose" && free() && a.focus === a.sequence[a.entered.length]) hold(60, 200);
    },
    morse(a) {
      if (a.summary) return free() && hold(80, 500);
      if (a.mode === "listen") {
        if (a.phase === "choose" && free() && a.pendingChoice == null && a.choices[a.focus] === a.target) hold(60, 400);
        return;
      }
      if (a.phase !== "key" || a.nextDelay > 0 || a.downAt !== null || !free()) return;
      const code = MORSE[a.target], i = a.input.length;
      if (i < code.length) hold(code[i] === "." ? 60 : 3 * a.unit, 130);
    },
  };
  const id = v.meta?.id;
  const fn = logic[id];
  window.__bot = { id, ticks: 0, stop: () => clearInterval(window.__bot.timer) };
  if (fn) window.__bot.timer = setInterval(() => { window.__bot.ticks++; if (v.menu || !v.app) return; try { fn(v.app); } catch (e) { window.__bot.error = String(e); } }, 8);
})()`;

const GAMES = ["orbit", "runner", "drift", "echo", "reaction", "glyphs", "morse"];
const INSTRUMENTS = ["timers", "transcribe", "environment", "diagnostics", "settings"];

async function launchApp(page, id, bot = true) {
  await page.evaluate(() => { window.__bot?.stop?.(); });
  await page.evaluate((id) => window.vesper.launch(id), id);
  await sleep(150);
  if (bot) await page.evaluate(BOT_SOURCE);
}

module.exports = { root, out, sleep, startService, launch, openPage, procStat, procStatus, chromiumTicks, rendererThreads, cpuWindow,
  mean, pctl, r3, summary, slope, save, BOT_SOURCE, GAMES, INSTRUMENTS, launchApp, descendants, classify, systemBusy };
