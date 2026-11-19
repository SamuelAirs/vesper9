// The text floor in the iPhone app's page (ios/layer/80-text.js, web/engine/draw.js): every game on
// the layer's reviewed list, played a little in the four ways Sam's phone shows a game (the Duo part
// folded, opened like a book, closed, and a plain upright phone), with every piece of canvas text
// recorded as it is drawn. For each game and case it checks:
//   - no text is drawn under the floor (9 points as the picture is shown), but the named exemptions;
//   - no text is drawn off the 960 x 540 picture that was on it without the floor;
//   - no two pieces of text are drawn over each other in one frame that were apart without the floor;
// and that with the floor off the page draws the same text, at the same sizes and places, frame by
// frame, as the page built from the last commit (HEAD, exported with git archive): what changed in
// a game's file changes nothing until a floor is set.
//
// The page runs on a clock this check turns (performance.now, Date.now, requestAnimationFrame) and a
// seeded Math.random, so the same presses draw the same frames in every run.
//
//   node tests/ios-text-browser.cjs [--part 1/3] [--apps highbar,cairn] [--cases phone,duo-laptop]
//                                   [--try] [--long] [--pictures] [--pixels]
// The whole list takes about four minutes: on this shared PC run it in parts (--part 1/3, 2/3, 3/3).
// --try: the floor for the apps named even if they are not on the list (to review one).
// --long: Moonrunner rides a whole run to its result (about two minutes on its own).
// --pictures: each case's picture without the floor too, beside the one with it.
// --pixels: instead, the plain simulator (no app layer, as on the Pi) at 1024 x 600, from this tree
// and from HEAD, and each game's canvas compared pixel for pixel at three moments.
// Pictures are written to $TEST_OUTPUT/ios-text: <app>--<case>-<n>.png, n = the moments of the play.
// It does not run Swift, WebKit or a phone, and Chrome here draws another monospace face than iOS.
const fs = require("node:fs"), path = require("node:path"), url = require("node:url");
const { spawnSync, execSync } = require("node:child_process");
const { root, CASES, STANDIN, build, launch, checker } = require("./helpers/ios-page.cjs");

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf("--" + name); return i >= 0 ? args[i + 1] : fallback; };
const FOUR = ["duo-laptop", "duo-book", "duo-closed", "phone"];
const cases = opt("cases", FOUR.join(",")).split(",");
const PIXELS = args.includes("--pixels");
const TRY = args.includes("--try");
const FLOOR_PT = 9;

// Text a game draws under the floor on purpose, by app: the exact words (or a pattern), and why.
// Each is a label of the game's own picture, not something to read.
const EXEMPT = {};

// The presses each game gets: [frames to wait, frames to hold the button] in turn (60 frames a
// second). The default reaches the first screens and early play in most games.
const DEFAULT_PLAY = [[50, 5], "shot", [55, 5], [36, 27], "shot", [30, 5], [18, 5], [42, 54], "shot", [42, 5], [24, 5], [24, 18], [48, 0]];
const tap = (gap = 20) => [gap, 5], hold = (gap = 20) => [gap, 48];
const PLAYS = {
  // The workshop (a hold) and its lines read, then a shot fired and flown (from the default play).
  ballista: [hold(), "shot", tap(), tap(), "shot", tap(), tap(), tap(), "shot", tap(), tap(), tap(), "shot", tap(), tap(), tap(), tap(), "shot"],
  // An expedition: the first row chosen, routes scanned and travelled, a survey by a case tap.
  wayfinder: ["shot", hold(), "shot", tap(), tap(), "shot", hold(), tap(), hold(), "shot", ["knock", null], tap(), hold(), tap(), tap(), hold(), "shot"],
  // The hangar (a hold), its lines read, the guide's pages, then a run from the hangar.
  perihelion: [hold(), "shot", tap(), tap(), "shot", tap(), tap(), tap(), "shot", tap(), tap(), tap(), hold(), "shot", tap(), "shot", tap(), tap(), tap(), "shot",
    hold(), tap(), hold(), [60, 0], [20, 40], [30, 40], [30, 40], [30, 40], "shot", [30, 40], [30, 40], [30, 40], [200, 0], "shot"],
  // A run ridden by holds down the slopes; --long rides it to its end and the result (about two minutes).
  runner: args.includes("--long")
    ? [tap(30), [60, 0], "shot", ...Array.from({ length: 20 }, () => [24, 36]), "shot", ...Array.from({ length: 22 }, () => [24, 36]), [700, 0], "shot", tap(60), [90, 0], "shot"]
    : [tap(30), [60, 0], "shot", ...Array.from({ length: 14 }, () => [24, 36]), "shot"],
  // The campaign's first chart, played by taps, to its results.
  twinbeat: [hold(), [120, 5], "shot", ...Array.from({ length: 30 }, () => tap(25)), "shot", ...Array.from({ length: 40 }, () => tap(25)), [600, 0], "shot", tap(), "shot"],
  // Setup (a hold), line challenge chosen, the guide skipped, a line ridden to its end.
  highbar: [hold(), "shot", tap(), tap(), tap(), tap(), hold(), tap(), "shot", tap(), tap(), tap(), hold(), "shot",
    hold(), [90, 30], tap(30), tap(10), [40, 40], "shot", [60, 20], tap(25), tap(8), [90, 40], [200, 5], [400, 5], [400, 5], [400, 5], [900, 5], "shot", tap(60), tap(60), "shot"],
};

// The page's clock and dice, turned only by window.__step(frames).
const CLOCK = `(() => {
  let now = 1000;
  const epoch = Date.UTC(2026, 10, 19, 23, 0, 0);
  performance.now = () => now;
  Date.now = () => epoch + now;
  let seed = 1979;
  Math.random = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  // The sound's clock too (a game may keep time by it).
  if (window.BaseAudioContext) Object.defineProperty(BaseAudioContext.prototype, "currentTime", { configurable: true, get: () => now / 1000 });
  const RealDate = Date;
  window.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(epoch + now); } static now() { return epoch + now; } };
  // Timers on the same clock: they run only as __step passes their time, so nothing the page does
  // on a timer (the simulated node, saves) lands between two presses differently in two runs.
  let queue = [], timers = [], nextId = 1;
  window.requestAnimationFrame = (run) => { queue.push(run); return queue.length; };
  window.cancelAnimationFrame = () => {};
  const add = (run, ms, every, args) => { const id = nextId++; timers.push({ id, run, at: now + Math.max(0, +ms || 0), every: every ? Math.max(1, +ms || 0) : 0, args }); return id; };
  const clear = (id) => { timers = timers.filter((one) => one.id !== id); };
  window.setTimeout = (run, ms, ...args) => add(run, ms, false, args);
  window.setInterval = (run, ms, ...args) => add(run, ms, true, args);
  window.clearTimeout = clear; window.clearInterval = clear;
  const due = () => {
    for (let guard = 0; guard < 1000; guard++) {
      const ready = timers.filter((one) => one.at <= now).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!ready) return;
      if (ready.every) ready.at += ready.every; else clear(ready.id);
      try { typeof ready.run === "function" ? ready.run(...ready.args) : 0; } catch (error) { console.error(error); }
    }
  };
  // The host's dice for each launch (engine/math.js Random.warm) draw on crypto too.
  crypto.getRandomValues = (array) => { for (let i = 0; i < array.length; i++) array[i] = Math.floor(Math.random() * 4294967296) & (array.BYTES_PER_ELEMENT === 4 ? -1 : 255); return array; };
  window.__reseed = (n) => { seed = n | 0; };
  window.__step = (frames) => {
    for (let i = 0; i < frames; i++) {
      now += 1000 / 60;
      due();
      const runs = queue; queue = [];
      for (const run of runs) run(now);
    }
  };
})();`;

// Every fillText on the game's canvas while __record is on: the words, the size in canvas pixels
// and the box the ink covers, both in the 960 x 540 picture's own units.
const RECORDER = `(() => {
  window.__frame = null;
  const P = CanvasRenderingContext2D.prototype, fill = P.fillText;
  P.fillText = function (value, x, y, ...rest) {
    const frame = window.__frame;
    if (frame && this.canvas && this.canvas.id === "game" && String(value).trim()) {
      const rs = (window.vesper && window.vesper.renderScale) || 1;
      const m = this.getTransform();
      const a = m.a / rs, b = m.b / rs, c = m.c / rs, d = m.d / rs, e = m.e / rs, f = m.f / rs;
      const px = +((/([\\d.]+)px/.exec(this.font) || [0, 0])[1]);
      const k = Math.hypot(a, b);
      const t = this.measureText(String(value));
      const corners = [[x - t.actualBoundingBoxLeft, y - t.actualBoundingBoxAscent], [x + t.actualBoundingBoxRight, y - t.actualBoundingBoxAscent],
        [x - t.actualBoundingBoxLeft, y + t.actualBoundingBoxDescent], [x + t.actualBoundingBoxRight, y + t.actualBoundingBoxDescent]]
        .map(([u, v]) => [a * u + c * v + e, b * u + d * v + f]);
      const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1]);
      frame.push({ t: String(value), px: Math.round(px * k * 1000) / 1000, x: Math.round((a * x + c * y + e) * 100) / 100, y: Math.round((b * x + d * y + f) * 100) / 100,
        align: this.textAlign, alpha: this.globalAlpha, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
    }
    return fill.call(this, value, x, y, ...rest);
  };
})();`;

// One app's visit: open it, then the presses, recording every sixth frame and the one after each
// press or release. Returns the frames and the floor the host set.
// A play is a list of [frames to wait, frames to hold] presses, "shot" (a picture, when asked for)
// and ["knock", side] (a case tap).
async function visit(page, id, keep, shoot) {
  const play = PLAYS[id] || DEFAULT_PLAY;
  const parts = [[]];
  for (const step of play) step === "shot" ? parts.push([]) : parts[parts.length - 1].push(step);
  await page.evaluate(({ id, keep }) => {
    const v = window.__visit = { frames: [], n: 0, keep };
    v.seen = (label) => { window.__frame = []; window.__step(1); v.frames.push({ label, texts: window.__frame }); window.__frame = null; };
    v.wait = (count, label) => { for (let i = 0; i < count; i++) { if (++v.n % v.keep === 0) v.seen(label + "+" + i); else window.__step(1); } };
    window.vesper.home();
    window.__step(3);
    window.__reseed(id.split("").reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7));
    window.vesper.launch(id);
    v.seen("open");
    v.floorPx = window.vesper.textFloorPx || 0;
    v.wait(30, "open");
  }, { id, keep });
  if (shoot) await shoot(0);
  for (let p = 0; p < parts.length; p++) {
    await page.evaluate(({ steps, p }) => {
      const v = window.__visit;
      steps.forEach((step, i) => {
        const tag = p + "." + i;
        if (step[0] === "knock") { window.vesper.softwareKnock(step[1] || null); v.seen("knock" + tag); return; }
        const [gap, hold] = step;
        v.wait(gap, "p" + tag);
        if (!hold) return;
        window.vesper.softwareButton(true);
        v.seen("down" + tag);
        v.wait(hold, "held" + tag);
        window.vesper.softwareButton(false);
        v.seen("up" + tag);
      });
      v.wait(12, "rest" + p);
    }, { steps: parts[p], p });
    if (shoot) await shoot(p + 1);
  }
  return page.evaluate(() => ({ frames: window.__visit.frames, floorPx: window.__visit.floorPx }));
}

// Turn the page's clock until the console has loaded (and, in the app's page, the layer has seen it).
async function loaded(page, also) {
  for (let i = 0; i < 600; i++)
    if (await page.evaluate((also) => { window.__step(3); return !!(window.vesper?.loaded && eval(also)()); }, String(also))) return;
  throw new Error("the page did not load");
}
async function openPage(browser, html, one, floorOn) {
  const context = await browser.newContext({ viewport: { width: one.w, height: one.h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await context.addInitScript(CLOCK + RECORDER + STANDIN + `window.__vesperNative = ${JSON.stringify({ saved: {}, fold: one.told })};`);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url.pathToFileURL(html).href);
  await loaded(page, () => window.vesperLayer && window.vesperApp.fold && (window.vesperApp.textFloor || !document.querySelector("#vesper-app-js").textContent.includes("80-text")));
  await page.evaluate((told) => { vesperApp.fold(told); window.__step(5); }, one.told);
  await new Promise((resolve) => setTimeout(resolve, 150));
  if (!floorOn) await page.evaluate(() => { if (vesperApp.textFloor) vesperApp.textFloor(0); });
  // --try: the floor for any app, listed or not (one page pixel is one point upright), to review one.
  if (floorOn && TRY) await page.evaluate((pt) => window.vesper.textFloor(() => pt), FLOOR_PT);
  return { context, page, errors };
}

// The page as it was at HEAD (built once per commit into the evidence folder).
function buildBase(output, plain) {
  const head = execSync("git rev-parse --short HEAD", { cwd: root, encoding: "utf8" }).trim();
  const src = path.join(output, "base-" + head);
  if (!fs.existsSync(path.join(src, "web"))) {
    fs.mkdirSync(src, { recursive: true });
    execSync(`git archive HEAD web scripts vesper ios books | tar -x -C "${src.replace(/\\/g, "/")}"`, { cwd: root, shell: "bash" });
  }
  const html = path.join(src, plain ? "sim/index.html" : "page/index.html");
  if (!fs.existsSync(html)) build_(src, html, plain);
  return html;
}
function build_(src, html, plain) {
  fs.mkdirSync(path.dirname(html), { recursive: true });
  const script = plain
    ? ["-c", `import runpy,sys; runpy.run_path(r"${path.join(src, "scripts/build-demo.py")}")["build"](__import__("pathlib").Path(r"${html}"))`]
    : [path.join(src, "ios/build-web.py"), html];
  const done = spawnSync(process.env.PYTHON || "python3", script, { cwd: src, encoding: "utf8" });
  if (done.status !== 0) throw new Error("build failed: " + done.stderr);
}

const overlaps = (texts) => {
  const out = new Set();
  const shown = texts.filter((one) => one.alpha > 0.05);
  for (let i = 0; i < shown.length; i++)
    for (let j = i + 1; j < shown.length; j++) {
      const p = shown[i].box, q = shown[j].box;
      // Ink that crosses by more than a pixel each way; text drawn twice in one place (a shadow,
      // a glow) is one piece of text.
      if (shown[i].t === shown[j].t && Math.abs(shown[i].x - shown[j].x) < 4 && Math.abs(shown[i].y - shown[j].y) < 4) continue;
      if (Math.min(p[2], q[2]) - Math.max(p[0], q[0]) > 1 && Math.min(p[3], q[3]) - Math.max(p[1], q[1]) > 1)
        out.add([shown[i].t, shown[j].t].sort().join(" | "));
    }
  return out;
};
const offPicture = (one) => one.alpha > 0.05 && (one.box[0] < -0.5 || one.box[1] < -0.5 || one.box[2] > 960.5 || one.box[3] > 540.5);
const exempt = (id, one) => (EXEMPT[id] || []).some(([what]) => (what instanceof RegExp ? what.test(one.t) : what === one.t));
const rows = (f) => JSON.stringify(f.texts.map((one) => [one.t, one.px, one.x, one.y, one.align]));
const sameText = (a, b) => a.length === b.length && a.every((f, i) => rows(f) === rows(b[i]));
// The first frame that differs, for the message.
const firstDiff = (a, b) => {
  const i = a.findIndex((f, n) => !b[n] || rows(f) !== rows(b[n]));
  if (i < 0) return a.length === b.length ? "" : "frame counts " + a.length + " / " + b.length;
  const x = a[i].texts, y = b[i] ? b[i].texts : [];
  const j = x.findIndex((one, n) => !y[n] || JSON.stringify([one.t, one.px, one.x, one.y]) !== JSON.stringify([y[n].t, y[n].px, y[n].x, y[n].y]));
  return a[i].label + ": " + JSON.stringify(x[j] && [x[j].t, x[j].px, x[j].x, x[j].y]) + " vs " + JSON.stringify(y[j] && [y[j].t, y[j].px, y[j].x, y[j].y]);
};

async function textCheck(browser, output, apps) {
  const { check } = checker_;
  const mine = build("ios-text").html;
  const base = buildBase(output, false);
  const record = async (html, one, floorOn, label) => {
    const { context, page, errors } = await openPage(browser, html, one, floorOn);
    const out = {};
    for (const id of apps) {
      // A picture only while the game's canvas is shown (a game can hand back to the dashboard).
      const shoot = label ? (n) => page.locator("#game").screenshot({ path: path.join(output, `${id}--${label}-${n}.png`), timeout: 1500 }).catch(() => null) : null;
      out[id] = await visit(page, id, 6, shoot);
    }
    const shown = await page.evaluate(() => { const r = document.getElementById("game").getBoundingClientRect(); return Math.min(r.width / 960, r.height / 540); });
    await context.close();
    return { out, errors, shown };
  };
  const before = await record(base, CASES.phone, false, null);
  const off = await record(process.env.SAMEBASE ? base : mine, CASES.phone, false, "phone-off");
  check(off.errors.length === 0 && before.errors.length === 0, "no page errors with the floor off or at HEAD " + JSON.stringify([...off.errors, ...before.errors]));
  const summary = {};
  for (const id of apps) {
    check(sameText(off.out[id].frames, before.out[id].frames), `${id}: with the floor off, the same text at the same sizes and places as at HEAD (${off.out[id].frames.length} frames) ${firstDiff(off.out[id].frames, before.out[id].frames)}`);
    check(off.out[id].floorPx === 0, `${id}: no floor set while the floor is off`);
  }
  for (const name of cases) {
    const one = CASES[name];
    // Without the floor the text is the same in every case (the picture's own units, the same
    // frames), so the phone's run serves them all; --pictures also takes each case's own.
    const offHere = name === "phone" || !args.includes("--pictures") ? off : await record(mine, one, false, name + "-off");
    const on = await record(mine, one, true, name);
    check(on.errors.length === 0, `${name}: no page errors with the floor on ` + JSON.stringify(on.errors));
    // One page pixel is one point in all four cases (the page is laid out at the display's size).
    const floorPx = FLOOR_PT / on.shown;
    for (const id of apps) {
      const frames = on.out[id].frames, was = offHere.out[id].frames;
      check(Math.abs(on.out[id].floorPx - floorPx) < 0.01, `${id} ${name}: the floor is ${FLOOR_PT} pt as shown (${floorPx.toFixed(2)} px, host ${on.out[id].floorPx.toFixed(2)})`);
      check(frames.length === was.length && frames.every((f, i) => f.label === was[i].label), `${id} ${name}: the same frames with the floor on and off`);
      const under = new Set(), off_ = new Set(), wasOff = new Set(), added = new Set();
      let smallest = Infinity, smallestOff = Infinity, count = 0;
      frames.forEach((frame, i) => {
        const before_ = overlaps(was[i] ? was[i].texts : []);
        for (const one of frame.texts) {
          count++;
          if (one.alpha > 0.05 && !exempt(id, one)) smallest = Math.min(smallest, one.px);
          if (one.px < floorPx - 0.01 && !exempt(id, one)) under.add(one.t + " @" + one.px);
          if (offPicture(one)) off_.add(one.t);
        }
        for (const one of (was[i] ? was[i].texts : [])) {
          if (offPicture(one)) wasOff.add(one.t);
          if (one.alpha > 0.05) smallestOff = Math.min(smallestOff, one.px);
        }
        for (const pair of overlaps(frame.texts)) if (!before_.has(pair)) added.add(frame.label + ": " + pair);
      });
      const newOff = [...off_].filter((t) => !wasOff.has(t));
      check(under.size === 0, `${id} ${name}: no text under the floor ${[...under].slice(0, 6).join("; ")}`);
      check(newOff.length === 0, `${id} ${name}: no text off the picture that was on it ${newOff.slice(0, 6).join("; ")}`);
      check(added.size === 0, `${id} ${name}: no text over other text that was apart ${[...added].slice(0, 6).join("; ")}`);
      summary[id] = summary[id] || {};
      summary[id][name] = { pieces: count, smallestBeforePt: Math.round(smallestOff * on.shown * 10) / 10, smallestAfterPt: Math.round(smallest * on.shown * 10) / 10,
        offBefore: [...wasOff], overlapsAdded: [...added].length };
    }
  }
  fs.writeFileSync(path.join(output, "summary.json"), JSON.stringify(summary, null, 1) + "\n");
}

// The Pi's and the simulator's page: no layer, no floor. Pixel for pixel the same as at HEAD.
async function pixelCheck(browser, output, apps) {
  const { check } = checker_;
  const plain = (dir) => { const html = path.join(dir, "index.html"); fs.mkdirSync(dir, { recursive: true });
    const done = spawnSync(process.env.PYTHON || "python3", ["-c", `import runpy,pathlib; runpy.run_path(r"${path.join(root, "scripts/build-demo.py")}")["build"](pathlib.Path(r"${html}"))`], { cwd: root, encoding: "utf8" });
    if (done.status !== 0) throw new Error(done.stderr); return html; };
  const mine = plain(path.join(output, "sim"));
  const base = buildBase(output, true);
  const shoot = async (html, tag) => {
    const context = await browser.newContext({ viewport: { width: 1024, height: 600 }, deviceScaleFactor: 1 });
    await context.addInitScript(CLOCK);
    const page = await context.newPage();
    await page.goto(url.pathToFileURL(html).href);
    await loaded(page, () => true);
    await page.evaluate(() => window.__step(5));
    const shots = {};
    for (const id of apps) {
      shots[id] = [];
      await page.evaluate((id) => { window.vesper.home(); window.__step(3); window.__reseed(42); window.vesper.launch(id); window.__step(40); }, id);
      shots[id].push(await page.locator("#game").screenshot());
      await page.evaluate(() => { window.vesper.softwareButton(true); window.__step(5); window.vesper.softwareButton(false); window.__step(70); });
      shots[id].push(await page.locator("#game").screenshot());
      await page.evaluate(() => { window.vesper.softwareButton(true); window.__step(40); window.vesper.softwareButton(false); window.__step(90); });
      shots[id].push(await page.locator("#game").screenshot());
      fs.writeFileSync(path.join(output, `${id}--sim-${tag}.png`), shots[id][2]);
    }
    await context.close();
    return shots;
  };
  const a = await shoot(base, "head"), b = await shoot(mine, "now");
  for (const id of apps) a[id].forEach((png, i) => check(png.equals(b[id][i]), `${id}: the simulator at 1024 x 600, moment ${i + 1}, pixel for pixel as at HEAD (${png.length} bytes)`));
}

const checker_ = checker();
let browser;
(async () => {
  const name = PIXELS ? "ios-text-pixels" : "ios-text";
  const output = path.join(process.env.TEST_OUTPUT || "", name);
  if (!process.env.TEST_OUTPUT) throw new Error("Set TEST_OUTPUT to a disposable evidence directory outside the repository.");
  fs.mkdirSync(output, { recursive: true });
  // The list is the layer's own: read from the file, so the check follows it.
  const layer = fs.readFileSync(path.join(root, "ios/layer/80-text.js"), "utf8");
  const listed = JSON.parse((/var REVIEWED = (\[[^\]]*\])/.exec(layer) || [0, "[]"])[1].replace(/'/g, '"'));
  // --part 2/3: the second of three even shares of the list (each run stays under two minutes).
  const [part, parts] = (opt("part", "1/1")).split("/").map(Number);
  const share = Math.ceil(listed.length / parts);
  const apps = opt("apps", "") ? opt("apps", "").split(",") : listed.slice((part - 1) * share, part * share);
  browser = await launch();
  if (PIXELS) await pixelCheck(browser, output, opt("apps", "") ? apps : ["highbar", "cairn", "orbit", "outpost", "pocketlinks"]);
  else {
    checker_.check(TRY || apps.every((id) => listed.includes(id)), "every app checked is on the layer's list");
    if (apps.length) await textCheck(browser, output, apps);
  }
  await browser.close();
  checker_.finish(output, name);
})().catch(async (error) => { console.error(error); if (browser) await browser.close(); process.exit(1); });
