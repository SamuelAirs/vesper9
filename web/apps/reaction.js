import { C, text, circle, space, grid, banner } from "../engine/draw.js";
import { AppGuard } from "../engine/input.js";
import { LAMP, fill, only } from "../engine/lightshow.js";
import { LampBus } from "./game-kit.js";
import { num, dateKey, cleanDaily, meetDaily, dailyDone, liveStreak, cleanFeats, newlyMet, drawFeatTicker } from "./goals.js";

export function reactionSummary(values) {
  if (!values.length) return { count: 0, median: null, best: null, mean: null };
  const sorted = values.slice().sort((a,b) => a-b), n = sorted.length;
  return { count: n, median: Math.round((sorted[Math.floor((n-1)/2)] + sorted[Math.floor(n/2)]) / 2),
    best: sorted[0], mean: Math.round(sorted.reduce((a,b) => a+b, 0) / n) };
}
// ---------------------------------------------------------------------------------------------
// Light Trial. While a trial is armed and waiting the host writes no light at all: the node times
// the cue on the middle lamp itself. The lamps are used before arming and after the result only.
export function reactionGrade(ms) {
  if (ms < 200) return { word: "SHARP", color: LAMP.green };
  if (ms < 300) return { word: "GOOD", color: LAMP.cyan };
  if (ms < 450) return { word: "STEADY", color: LAMP.amber };
  return { word: "SLOW", color: LAMP.red };
}

// ---- series, ranks and feats --------------------------------------------------------------------
// Trials come in series of five on one clock. A series is judged by its median, so one slip does not
// spoil it; the best series median on the most trustworthy clock sets the rank. False starts do not
// count as trials but are remembered for the series. The daily part is simply: finish a series today.
export const SERIES = 5;
export const TRIAL_RANKS = [[Infinity, "NOVICE"], [450, "TRAINEE"], [380, "OBSERVER"], [320, "SPOTTER"], [280, "WATCHKEEPER"], [250, "SENTINEL"], [225, "VANGUARD"], [200, "QUICKSILVER"]];
// The rank for a best series median (0 = no series yet).
export function trialRank(ms) {
  if (!(ms > 0)) return "UNRANKED";
  let name = TRIAL_RANKS[0][1];
  for (const [limit, label] of TRIAL_RANKS) if (ms < limit) name = label;
  return name;
}
const CLOCKS = ["physical", "simulator", "keyboard"];
export const LOG_SIZE = 20;
// On-screen colours for the three discs, matching the node's lamps.
const DISC = { green: "#4fe07a", cyan: "#3ccab4", amber: "#f0a040", red: "#f06a50" };
const gradeDisc = (ms) => (ms < 200 ? DISC.green : ms < 300 ? DISC.cyan : ms < 450 ? DISC.amber : DISC.red);
const timed = (a) => a.metric !== "keyboard"; // keyboard timing is approximate: it earns no timing feats
export const TRIAL_FEATS = [
  { id: "series", name: "FIRST SERIES", text: "Finish a series of five trials.", n: 1, prog: (a) => (a.sv.st.series || 0) },
  { id: "t250", name: "QUICK", text: "A trial under 250 ms.", n: 1, prog: (a) => a.sv.st.t250 || 0 },
  { id: "t200", name: "SHARP", text: "A trial under 200 ms.", n: 1, prog: (a) => a.sv.st.t200 || 0 },
  { id: "m300", name: "RELIABLE", text: "A series median under 300 ms.", n: 1, prog: (a) => a.sv.st.m300 || 0 },
  { id: "m250", name: "KEEN", text: "A series median under 250 ms.", n: 1, prog: (a) => a.sv.st.m250 || 0 },
  { id: "steady", name: "STEADY HAND", text: "A series whose five trials lie within 60 ms.", n: 1, prog: (a) => a.sv.st.steady || 0 },
  { id: "clean", name: "COMPOSED", text: "A series without a false start.", n: 1, prog: (a) => a.sv.st.clean || 0 },
  { id: "streak", name: "DAILY PRACTICE", text: "Finish a series 3 days running.", n: 3, prog: (a) => a.sv.dl.streak },
  { id: "hundred", name: "HUNDRED", text: "Make 100 trials in all.", n: 100, prog: (a) => a.sv.st.trials },
  { id: "unmoved", name: "UNMOVED", text: "Under 300 ms after one of the longest waits.", hint: "The longest waits test the most.", n: 1, hidden: true, prog: (a) => a.sv.st.unmoved || 0 },
];
const FEAT_IDS = TRIAL_FEATS.map((f) => f.id);
// Bring any stored shape (nothing, schema 1 from recordRun, schema 2) to schema 2.
export function migrateTrial(raw) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const st = r.st && typeof r.st === "object" ? r.st : {};
  const bs = r.bs && typeof r.bs === "object" ? r.bs : {};
  const n = (v) => Math.max(0, Math.floor(num(v)));
  const flags = Object.fromEntries(["series", "t250", "t200", "m300", "m250", "steady", "clean", "unmoved"].map((k) => [k, n(st[k])]));
  return {
    schema: 2,
    runs: n(r.runs),
    last: r.last && typeof r.last === "object" ? r.last : {},
    milestone: n(r.milestone),
    ft: cleanFeats(r.ft, FEAT_IDS),
    st: { ...flags, trials: Math.max(n(st.trials), n(r.runs)), falses: n(st.falses) },
    bs: Object.fromEntries(CLOCKS.map((k) => [k, n(bs[k])])),
    dl: { ...cleanDaily(r.dl), best: n(r.dl?.best) },
    // The training log: the last LOG_SIZE series as { d: day, m: median, k: clock }.
    log: (Array.isArray(r.log) ? r.log : []).filter((e) => e && typeof e === "object" && n(e.m) > 0 && CLOCKS.includes(e.k))
      .slice(-LOG_SIZE).map((e) => ({ d: typeof e.d === "string" ? e.d.slice(0, 10) : "", m: n(e.m), k: e.k })),
  };
}
// The longest delay a trial can be armed with, and the part of it that counts as "one of the longest".
const DELAY_MIN = 1300, DELAY_MAX = 4200, LONG_WAIT = 3800;
// A press later than this after the cue is not a reaction: the trial is void and not counted.
export const TOO_SLOW = 1500;
export class LightTrial {
  constructor(ctx) {
    this.c = ctx;
    this.lamps = new LampBus(ctx);
    this.guard = new AppGuard(this, ctx);
    this.phase = "title";
    this.trial = 0;
    this.cueAt = 0;
    this.screenCueAt = 0;
    this.results = [];
    this.buckets = { physical: [], keyboard: [], simulator: [] };
    this.metric = ctx.simulated() ? "simulator" : "physical";
    this.cueGeneration = 0;
    this.last = null;
    this.fresh = false;   // the last result beat the saved best
    this.t = 0;
    this.sv = migrateTrial(ctx.progress?.());
    this.series = [];     // the current series: valid trials on one clock
    this.seriesClock = this.metric;
    this.falses = 0;      // false starts in the current series
    this.done = null;     // the series just finished: { median, spread, clean, best, rank, feats }
    this.delay = 0;       // the delay the current trial was armed with
    this.newFeats = [];
    this.goAt = 0;        // this.t when the cue arrived, for the timeout when nobody presses
    this.c.hint(
      "Wait for the MIDDLE light. Press once it turns green. Early presses fail.",
    );
  }
  falseStart() {
    this.phase = "early";
    this.c.tone(90, 0.18);
    // Left and right lamps alternate red twice; the middle lamp stays dark.
    this.lamps.flash(0.8, (e) => (Math.floor(e / 0.2) % 2 === 0 ? only(0, LAMP.red, 0.8) : only(2, LAMP.red, 0.8)));
  }
  // Too slow: the trial is void. Nothing is scored or saved and the series carries on.
  tooSlow() {
    this.c.command("cancel").catch(() => {});
    this.phase = "slow";
    this.last = null;
    this.c.tone(140, 0.2);
    this.lamps.flash(0.6, () => fill(LAMP.amber, 0.3));
  }
  down(event) {
    this.guard.mark();
    if (
      this.phase === "title" ||
      this.phase === "result" ||
      this.phase === "early" ||
      this.phase === "slow" ||
      this.phase === "error"
    ) {
      this.lamps.clear();
      this.fresh = false;
      if (this.done) { this.done = null; this.newFeats = []; }
      this.trial = this.c.rng.int(1, 0x7ffffffe);
      this.delay = this.c.rng.int(DELAY_MIN, DELAY_MAX);
      this.phase = "wait";
      this.cueAt = 0;
      this.last = null;
      this.c
        .command("reaction", {
          trial: this.trial,
          delay: this.delay,
        })
        .catch((error) => {
          if (this.c.alive()) {
            this.phase = "error";
            this.c.hint(error.message);
          }
        });
      return;
    }
    if (this.phase === "wait") {
      this.c.command("cancel").catch(() => {});
      this.falses++;
      this.sv.st.falses++;
      this.falseStart();
      return;
    }
    if (this.phase === "go") {
      const metric = event.source === "node" ? "physical" : event.source === "simulator" ? "simulator" : "keyboard";
      const nativeClock = metric !== "keyboard";
      if (nativeClock && (event.generation ?? 0) !== this.cueGeneration) { this.abort(); return; }
      const milliseconds = nativeClock
        ? (event.at_us - this.cueAt) / 1000
        : performance.now() - this.screenCueAt;
      if (milliseconds < 0) {
        this.falseStart();
        return;
      }
      if (milliseconds > TOO_SLOW) { this.tooSlow(); return; }
      this.last = Math.round(milliseconds);
      this.metric = metric;
      this.buckets[metric].push(this.last);
      this.buckets[metric] = this.buckets[metric].slice(-10);
      this.results = this.buckets[metric];
      this.phase = "result";
      this.c.tone(660, 0.15);
      // Scores use higher-is-better points, while the measured time stays visible.
      const points = Math.max(0, 1000 - this.last), saved = this.c.best?.(this.metric) ?? 0;
      this.fresh = points > saved && points > 0;
      this.c.score(points, this.metric);
      const finished = this.addToSeries(this.last);
      const sv = this.sv;
      sv.runs++;
      sv.last = { metric: this.metric, milliseconds: this.last, summary: reactionSummary(this.results), milestone: this.results.length };
      sv.milestone = Math.max(sv.milestone, this.results.length);
      this.c.saveProgress?.(JSON.parse(JSON.stringify(sv)))?.catch?.(this.c.error);
      // The grade colour on all three lamps, then dark; a new best sweeps white across first. A finished
      // series ends with its own grade running across the lamps three times.
      const grade = reactionGrade(this.last).color, sweep = this.fresh ? 0.36 : 0;
      const tail = finished ? 1.08 : 0, sgrade = finished ? reactionGrade(this.done.median).color : grade;
      this.lamps.flash(1.2 + sweep + tail, (e) => {
        if (e < sweep) return only(Math.min(2, Math.floor(e / 0.12)), LAMP.white, 0.9);
        if (e - sweep < 1.2) return fill(grade, e - sweep < 0.15 ? 0.8 : 0.33);
        return only(Math.floor((e - sweep - 1.2) / 0.12) % 3, sgrade, 0.7);
      });
    }
  }
  // Add a valid trial to the series; returns whether it finished the series.
  addToSeries(ms) {
    const st = this.sv.st;
    if (this.seriesClock !== this.metric) { this.series = []; this.falses = 0; this.seriesClock = this.metric; }
    this.series.push(ms);
    st.trials++;
    if (timed(this)) {
      if (ms < 250) st.t250 = 1;
      if (ms < 200) st.t200 = 1;
      if (ms < 300 && this.delay >= LONG_WAIT) st.unmoved = 1;
    }
    let finished = false;
    if (this.series.length >= SERIES) {
      finished = true;
      const median = reactionSummary(this.series).median, spread = Math.max(...this.series) - Math.min(...this.series);
      const clean = this.falses === 0, bs = this.sv.bs, before = bs[this.metric];
      st.series++;
      if (timed(this)) {
        if (median < 300) st.m300 = 1;
        if (median < 250) st.m250 = 1;
        if (spread < 60) st.steady = 1;
      }
      if (clean) st.clean = 1;
      const best = !before || median < before;
      if (best) bs[this.metric] = median;
      this.sv.log.push({ d: this.dayKey(), m: median, k: this.metric });
      this.sv.log = this.sv.log.slice(-LOG_SIZE);
      const dl = this.sv.dl, daily = meetDaily(dl, this.dayKey());
      dl.best = daily || !dl.best ? median : Math.min(dl.best, median);
      this.done = { median, spread, clean, best: best && !!before, first: !before, daily, rank: this.rank(), clock: this.metric };
      this.series = []; this.falses = 0;
    }
    const met = newlyMet(TRIAL_FEATS, this.sv.ft, this);
    this.sv.ft.push(...met);
    this.newFeats = this.newFeats.concat(met);
    if (met.length) this.c.tone(988, 0.12, "sine");
    return finished;
  }
  dayKey() { return dateKey(); }
  // The rank comes from the best series on the most trustworthy clock that has one.
  rankClock() { return CLOCKS.find((k) => this.sv.bs[k] > 0) || null; }
  rank() { const k = this.rankClock(); return trialRank(k ? this.sv.bs[k] : 0); }
  event(event) {
    if (event.type === "node_reset" || (event.type === "device" && !event.connected)) { this.abort(); return; }
    if (
      event.type === "cue" &&
      event.trial === this.trial &&
      this.phase === "wait"
    ) {
      this.cueAt = event.at_us;
      this.cueGeneration = event.generation ?? 0;
      this.screenCueAt = performance.now();
      this.goAt = this.t;
      this.phase = "go";
    }
  }
  // An interrupted trial (node reset or lost link): cancel it and go back to the title.
  abort() {
    this.c.command("cancel").catch(() => {});
    this.lamps.clear();
    if (this.phase === "wait" || this.phase === "go") this.phase = "title";
  }
  // An interruption clears the glow, but never while a trial is armed: the node owns the lamps then.
  up() { this.guard.release(); }
  cancel() {
    this.guard.rewind();
    if (this.phase !== "wait" && this.phase !== "go") this.lamps.clear();
  }
  pause() { this.guard.settle(); this.abort(); this.lamps.sleep(); }
  resume() { this.lamps.wake(); }
  dispose() {
    this.guard.settle();
    this.c.command("cancel").catch(() => {});
    this.lamps.sleep();
  }
  update(dt) {
    this.guard.tick(dt);
    this.t += dt;
    // Nobody pressed: give the press a little longer than the limit to arrive, then void the trial.
    if (this.phase === "go" && this.t - this.goAt > TOO_SLOW / 1000 + 0.4) this.tooSlow();
    // No host light while armed or waiting for the cue.
    if (this.phase !== "wait" && this.phase !== "go") this.lamps.frame(dt, null);
    const summary = reactionSummary(this.results);
    this.c.hud([
      ["LAST", this.last === null ? "—" : this.last + " ms"],
      ["SERIES", this.series.length + " / " + SERIES],
      ["MEDIAN", summary.median === null ? "—" : summary.median + " ms"],
      ["CLOCK", this.metric.toUpperCase()],
    ]);
  }
  draw(g) {
    space(g, this.t, 0.3);
    grid(g, 90);
    // The title keeps the middle of the screen for the banner; the discs appear once a trial starts.
    if (this.phase !== "title") this.drawDiscs(g);
    const grade = this.phase === "result" ? reactionGrade(this.last) : null;
    const title = {
      wait: "WAIT FOR THE MIDDLE LIGHT",
      go: "NOW",
      early: "TOO EARLY",
      slow: "TOO SLOW",
      result: this.last + " ms",
      error: "NODE UNAVAILABLE",
    }[this.phase];
    if (title) {
      text(
        g,
        title,
        480,
        312,
        36,
        this.phase === "early" || this.phase === "slow" ? C.amber : C.ink,
        "center",
      );
      if (grade) text(g, grade.word + (this.fresh ? " / NEW BEST" : ""), 480, 358, 24, this.fresh ? C.amber : C.muted, "center");
      if (this.phase === "slow") text(g, "PRESS WITHIN 1.5 SECONDS OF THE GREEN LIGHT / NOT COUNTED", 480, 358, 18, C.muted, "center");
      if (this.phase === "result" && this.metric === "keyboard")
        text(g, "KEYBOARD TIMING IS APPROXIMATE", 480, 392, 18, C.muted, "center");
      if (["result", "early", "slow", "error"].includes(this.phase) && !this.done)
        text(g, "PRESS FOR ANOTHER TRIAL", 480, 420, 22, C.amber, "center");
    }
    if (this.done && this.phase === "result") this.drawSeries(g);
    else if (this.phase !== "title") {
      // Five marks for the series: filled for trials made, a red bar per false start.
      for (let i = 0; i < SERIES; i++) circle(g, 400 + i * 40, 96, 9, i < this.series.length ? C.ink : C.line, i < this.series.length);
      text(g, "SERIES", 340, 96, 16, C.muted, "right");
      if (this.falses) text(g, this.falses + " EARLY", 620, 96, 16, C.red);
    }
    // The last ten results as bars: taller is slower, the scale runs to 600 ms.
    const bars = this.results;
    if (bars.length && this.phase !== "title" && !(this.done && this.phase === "result")) {
      const w = 36, gap = 12, x0 = 480 - (bars.length * (w + gap) - gap) / 2, base = 504;
      bars.forEach((ms, i) => {
        const h = Math.max(4, Math.min(1, ms / 600) * 60);
        g.fillStyle = i === bars.length - 1 && this.phase === "result" ? C.amber : C.muted;
        g.fillRect(x0 + i * (w + gap), base - h, w, h);
      });
      text(g, "RECENT TRIALS / TALLER IS SLOWER", 480, 526, 16, C.muted, "center");
    }
    if (this.phase === "title") {
      banner(
        g,
        "LIGHT TRIAL",
        "An honest measure of the moment between seeing and acting.",
      );
      this.drawGoals(g, 404);
    }
  }
  // The three discs mirror the node's lamps: a slow breath while armed (the screen only; the lamps
  // stay dark), the middle one green on the cue, and the grade colour after a result.
  drawDiscs(g) {
    const go = this.phase === "go", wait = this.phase === "wait", res = this.phase === "result" ? gradeDisc(this.last) : null;
    for (let i = 0; i < 3; i++) {
      const x = 290 + i * 190, y = 190;
      if (go && i === 1) { g.globalAlpha = 0.3; circle(g, x, y, 84, DISC.green, true); g.globalAlpha = 1; }
      if (res) { g.globalAlpha = 0.22; circle(g, x, y, 58, res, true); g.globalAlpha = 1; }
      circle(g, x, y, 58, go && i === 1 ? DISC.green : res || C.line, go && i === 1, res ? 3 : 2);
      g.globalAlpha = wait ? 0.35 + 0.35 * Math.sin(this.t * 2.2 + i * 0.6) : 1;
      circle(g, x, y, 66, wait ? C.muted : C.line);
      g.globalAlpha = 1;
      text(g, ["I", "II", "III"][i], x, y, 27, go && i === 1 ? C.bg : C.muted, "center");
    }
    // While armed: the mark to beat, the best series on this clock.
    const target = this.sv.bs[this.metric];
    if (wait && target) text(g, "TO BEAT: " + target + " ms", 480, 360, 18, C.muted, "center");
  }
  // The training log: one bar per series, taller is slower, the best one bright.
  drawLog(g, y, h) {
    const log = this.sv.log;
    if (log.length < 2) return false;
    const w = 22, gap = 6, x0 = 480 - (log.length * (w + gap) - gap) / 2, best = Math.min(...log.map((e) => e.m));
    log.forEach((e, i) => {
      const k = Math.max(0.08, Math.min(1, (e.m - 150) / 350)), bh = k * h;
      g.fillStyle = e.m === best ? C.amber : i === log.length - 1 ? C.ink : C.muted;
      g.fillRect(x0 + i * (w + gap), y + h - bh, w, bh);
    });
    text(g, "LAST " + log.length + " SERIES / TALLER IS SLOWER / BEST " + best + " ms", 480, y + h + 14, 16, C.muted, "center");
    return true;
  }
  // Rank, best series, the day's practice and one feat at a time (title screen).
  drawGoals(g, y) {
    const sv = this.sv, key = this.dayKey(), clock = this.rankClock(), streak = liveStreak(sv.dl, key);
    const best = clock ? "BEST SERIES " + sv.bs[clock] + " ms" + (clock === "physical" ? "" : " (" + clock.toUpperCase() + ")") : "NO SERIES YET";
    text(g, "RANK " + this.rank() + "   " + best + "   FEATS " + sv.ft.length + " / " + TRIAL_FEATS.length, 480, y, 18, C.ink, "center");
    text(g, (dailyDone(sv.dl, key) ? "TODAY'S SERIES DONE / BEST " + sv.dl.best + " ms" : "TODAY: FINISH A SERIES OF FIVE") + (streak > 1 ? "   STREAK " + streak : ""), 480, y + 28, 18, dailyDone(sv.dl, key) ? C.cyan : C.amber, "center");
    // With a training log the title shows it, and the feats take turns with it.
    if (Math.floor(this.t / 9) % 2 === 0 && this.drawLog(g, y + 46, 54)) return;
    drawFeatTicker(g, TRIAL_FEATS, sv.ft, this.t, y + 60);
  }
  // A finished series: median, spread, rank and anything new.
  drawSeries(g) {
    const d = this.done, lines = [];
    lines.push(["SERIES MEDIAN " + d.median + " ms / SPREAD " + d.spread + " ms" + (d.clean ? "" : " / EARLY STARTS"), C.ink]);
    lines.push([(d.best ? "NEW BEST SERIES / " : "") + "RANK " + d.rank + (d.daily ? " / TODAY'S SERIES DONE" : ""), d.best ? C.amber : C.cyan]);
    for (const id of this.newFeats.slice(0, 2)) lines.push(["NEW FEAT: " + TRIAL_FEATS.find((f) => f.id === id).name, C.amber]);
    const y = this.metric === "keyboard" ? 420 : 396;
    lines.forEach(([s, col], i) => text(g, s, 480, y + i * 26, 18, col, "center"));
    text(g, "PRESS TO START THE NEXT SERIES", 480, y + lines.length * 26 + 4, 18, C.amber, "center");
  }
}

