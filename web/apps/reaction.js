import { C, text, circle, space, grid, banner } from "../engine/draw.js";
import { AppGuard } from "../engine/input.js";
import { LAMP, fill, only, dim } from "../engine/lightshow.js";
import { LampBus } from "./game-kit.js";
import { num, dateKey, cleanFeats, newlyMet, todayOrder, drawToday } from "./goals.js";

export function reactionSummary(values) {
  if (!values.length) return { count: 0, median: null, best: null, mean: null };
  const sorted = values.slice().sort((a,b) => a-b), n = sorted.length;
  return { count: n, median: Math.round((sorted[Math.floor((n-1)/2)] + sorted[Math.floor(n/2)]) / 2),
    best: sorted[0], mean: Math.round(sorted.reduce((a,b) => a+b, 0) / n) };
}
// ---------------------------------------------------------------------------------------------
// Light Trial. While a trial is armed and waiting the host writes no light at all: the node times
// the cue on lamp II itself (the middle of three; the second of four on the current node). The lamps
// are used before arming and after the result only. With four lamps, lamp IV compares each trial
// with the mark to beat (versus()): green when faster, amber when close, red when slower.
export function reactionGrade(ms) {
  if (ms < 200) return { word: "SHARP", color: LAMP.green };
  if (ms < 300) return { word: "GOOD", color: LAMP.cyan };
  if (ms < 450) return { word: "STEADY", color: LAMP.amber };
  return { word: "SLOW", color: LAMP.red };
}

// ---- series, ranks and feats --------------------------------------------------------------------
// Trials come in series of five on one clock. A series is judged by its median, so one slip does not
// spoil it; the best series median on the most trustworthy clock sets the rank. False starts do not
// count as trials but are remembered for the series. Feats go to the console's logbook (ctx.feat); on
// the days the logbook picks Light Trial, its order is simply: finish a series.
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
  { id: "hundred", name: "HUNDRED", text: "Make 100 trials in all.", n: 100, prog: (a) => a.sv.st.trials },
  { id: "unmoved", name: "UNMOVED", text: "Under 300 ms after one of the longest waits.", hint: "The longest waits test the most.", n: 1, hidden: true, prog: (a) => a.sv.st.unmoved || 0 },
];
const FEAT_IDS = TRIAL_FEATS.map((f) => f.id);
const ORDER = { text: "Finish a series of five." };
// Bring any stored shape (nothing, schema 1 from recordRun, schema 2 with its own daily streak) to
// schema 3. The streak now lives in the console's logbook, so it goes.
export function migrateTrial(raw) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const st = r.st && typeof r.st === "object" ? r.st : {};
  const bs = r.bs && typeof r.bs === "object" ? r.bs : {};
  const n = (v) => Math.max(0, Math.floor(num(v)));
  const flags = Object.fromEntries(["series", "t250", "t200", "m300", "m250", "steady", "clean", "unmoved"].map((k) => [k, n(st[k])]));
  return {
    schema: 3,
    runs: n(r.runs),
    last: r.last && typeof r.last === "object" ? r.last : {},
    milestone: n(r.milestone),
    ft: cleanFeats(r.ft, FEAT_IDS),
    st: { ...flags, trials: Math.max(n(st.trials), n(r.runs)), falses: n(st.falses) },
    bs: Object.fromEntries(CLOCKS.map((k) => [k, n(bs[k])])),
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
  // Save slots: each slot is one person's record (rank, best series per clock, training log), so
  // two people can share the console without mixing their times.
  static saveSlots = true;
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
    this.vs = null;       // the last trial against the mark to beat (lamp IV), or null
    // Today's order, only on the days the logbook picks Light Trial and while it is not yet met.
    this.order = todayOrder(ctx, ORDER);
    this.goAt = 0;        // this.t when the cue arrived, for the timeout when nobody presses
    this.c.hint(
      (ctx.lampCount?.() === 4 ? "Wait for LIGHT II." : "Wait for the MIDDLE light.") + " Press once it turns green. Early presses fail.",
    );
  }
  falseStart() {
    this.phase = "early";
    this.c.tone(90, 0.18);
    // Lamps I and III alternate red twice; the cue lamp (II) stays dark.
    const n = this.lampN();
    this.lamps.flash(0.8, (e) => (Math.floor(e / 0.2) % 2 === 0 ? only(0, LAMP.red, 0.8, n) : only(2, LAMP.red, 0.8, n)));
  }
  // Too slow: the trial is void. Nothing is scored or saved and the series carries on.
  tooSlow() {
    this.c.command("cancel").catch(() => {});
    this.phase = "slow";
    this.last = null;
    this.c.tone(140, 0.2);
    this.lamps.flash(0.6, () => fill(LAMP.amber, 0.3, this.lampN()));
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
      this.vs = this.versus(this.last);
      const finished = this.addToSeries(this.last);
      const sv = this.sv;
      sv.runs++;
      sv.last = { metric: this.metric, milliseconds: this.last, summary: reactionSummary(this.results), milestone: this.results.length };
      sv.milestone = Math.max(sv.milestone, this.results.length);
      this.c.saveProgress?.(JSON.parse(JSON.stringify(sv)))?.catch?.(this.c.error);
      // The grade colour on lamps I to III, then dark; a new best sweeps white across first. With four
      // lamps, lamp IV holds the verdict against the mark to beat meanwhile. A finished series ends with
      // its own grade running across every lamp three times.
      const n = this.lampN(), grade = reactionGrade(this.last).color, sweep = this.fresh ? 0.36 : 0, vs = this.vs;
      const tail = finished ? 0.36 * n : 0, sgrade = finished ? reactionGrade(this.done.median).color : grade;
      this.lamps.flash(1.2 + sweep + tail, (e) => {
        if (e < sweep) return only(Math.min(n - 1, Math.floor(e / 0.12)), LAMP.white, 0.9, n);
        if (e - sweep < 1.2) {
          const out = fill(grade, e - sweep < 0.15 ? 0.8 : 0.33);
          return n === 4 ? out.concat(vs ? dim(vs.lamp, 0.55) : LAMP.off) : out;
        }
        return only(Math.floor((e - sweep - 1.2) / 0.12) % n, sgrade, 0.7, n);
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
      const daily = !!this.order;
      if (daily) { this.order = null; this.c.dailyMet?.(); }
      this.done = { median, spread, clean, best: best && !!before, first: !before, daily, rank: this.rank(), clock: this.metric };
      this.series = []; this.falses = 0;
    }
    const met = newlyMet(TRIAL_FEATS, this.sv.ft, this);
    this.sv.ft.push(...met);
    for (const id of met) this.c.feat?.(id, TRIAL_FEATS.find((f) => f.id === id).name);
    this.newFeats = this.newFeats.concat(met);
    if (met.length) this.c.tone(988, 0.12, "sine");
    return finished;
  }
  dayKey() { return dateKey(); }
  // The slot row's label: the rank and best series on the most trustworthy clock (24 characters at most).
  slotSummary(value) {
    const sv = migrateTrial(value), k = CLOCKS.find((c) => sv.bs[c] > 0);
    if (!k) return sv.st.trials ? sv.st.trials + " TRIALS, NO SERIES" : "NO SERIES YET";
    return (trialRank(sv.bs[k]) + " · " + sv.bs[k] + " ms").slice(0, 24);
  }
  lampN() { return this.c.lampCount?.() === 4 ? 4 : 3; }
  // The mark a trial is measured against: the best series on this clock, else this series so far.
  // Returns { lamp, disc, word } or null when there is nothing to beat yet.
  versus(ms) {
    const mark = this.sv.bs[this.metric] || (this.seriesClock === this.metric && this.series.length ? reactionSummary(this.series).median : 0);
    if (!(mark > 0)) return null;
    if (ms <= mark) return { lamp: LAMP.green, disc: DISC.green, word: "FASTER THAN " + mark + " ms" };
    if (ms <= mark * 1.1) return { lamp: LAMP.amber, disc: DISC.amber, word: "CLOSE TO " + mark + " ms" };
    return { lamp: LAMP.red, disc: DISC.red, word: "SLOWER THAN " + mark + " ms" };
  }
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
      wait: this.lampN() === 4 ? "WAIT FOR LIGHT II" : "WAIT FOR THE MIDDLE LIGHT",
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
  // The discs mirror the node's lamps: a slow breath while armed (the screen only; the lamps stay
  // dark), disc II green on the cue, and the grade colour after a result. A fourth disc, on a
  // four-lamp node, shows the verdict against the mark to beat.
  drawDiscs(g) {
    const go = this.phase === "go", wait = this.phase === "wait", res = this.phase === "result" ? gradeDisc(this.last) : null;
    const n = this.lampN(), gap = n === 4 ? 170 : 190;
    for (let i = 0; i < n; i++) {
      const x = 480 + (i - (n - 1) / 2) * gap, y = 190;
      if (i === 3) { this.drawVersus(g, x, y, wait); continue; }
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
  // Disc IV: dark while armed and on the cue, the verdict's colour after a result, with its words under it.
  drawVersus(g, x, y, wait) {
    const vs = this.phase === "result" ? this.vs : null;
    if (vs) { g.globalAlpha = 0.22; circle(g, x, y, 58, vs.disc, true); g.globalAlpha = 1; }
    circle(g, x, y, 58, vs ? vs.disc : C.line, false, vs ? 3 : 2);
    g.globalAlpha = wait ? 0.35 + 0.35 * Math.sin(this.t * 2.2 + 1.8) : 1;
    circle(g, x, y, 66, wait ? C.muted : C.line);
    g.globalAlpha = 1;
    text(g, "IV", x, y, 27, C.muted, "center");
    if (vs) text(g, vs.word, x, y + 86, 16, vs.disc, "center");
    else if (this.phase !== "result") text(g, "VS BEST", x, y + 86, 16, C.muted, "center");
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
  // Rank, best series, today's order and the training log (title screen).
  drawGoals(g, y) {
    const sv = this.sv, clock = this.rankClock();
    const best = clock ? "BEST SERIES " + sv.bs[clock] + " ms" + (clock === "physical" ? "" : " (" + clock.toUpperCase() + ")") : "NO SERIES YET";
    text(g, "RANK " + this.rank() + "   " + best, 480, y, 18, C.ink, "center");
    const row = drawToday(g, this.c, this.order, y + 28) ? y + 46 : y + 18;
    this.drawLog(g, row, 54);
  }
  // A finished series: median, spread, rank and anything new.
  drawSeries(g) {
    const d = this.done, lines = [];
    lines.push(["SERIES MEDIAN " + d.median + " ms / SPREAD " + d.spread + " ms" + (d.clean ? "" : " / EARLY STARTS"), C.ink]);
    lines.push([(d.best ? "NEW BEST SERIES / " : "") + "RANK " + d.rank + (d.daily ? " / TODAY'S ORDER MET" : ""), d.best ? C.amber : C.cyan]);
    const y = this.metric === "keyboard" ? 420 : 396;
    lines.forEach(([s, col], i) => text(g, s, 480, y + i * 26, 18, col, "center"));
    text(g, "PRESS TO START THE NEXT SERIES", 480, y + lines.length * 26 + 4, 18, C.amber, "center");
  }
}

