import { TAU, clamp, wrapAngle } from "../engine/math.js";
import { C, text, line, circle, space, banner, glyph } from "../engine/draw.js";
import { LAMP, lamps, fill, only, dim, blend, pulse } from "../engine/lightshow.js";
import { GestureGuard, LampBus, lampMax, announce, drawNote } from "./game-kit.js";
import { num, hashText, dateKey, cleanDaily, meetDaily, dailyDone, liveStreak, cleanFeats, newlyMet, closestFeat, rankOf, nextRank, drawFeatTicker, panel } from "./goals.js";

// ---------------------------------------------------------------------------------------------
// ORBIT LOCK. Press as the satellite crosses the amber gate. Around that unchanged core:
// - a lock near the gate's centre is PERFECT; four perfect locks in a row charge a shield that
//   absorbs the next mistimed press (not the slow decay of an idle hull);
// - from the 30th lock every third gate is DARK: nothing on the screen, only lamp I rising as the
//   satellite nears it;
// - feats, a daily order (the same for everyone on a date) with a streak, and a rank from feats,
//   kept in a versioned save (schema 2) that still carries the first release's fields.
const ORBIT_AHEAD_MAX = 4.5;
// Half-width of the gate (radians) and angular speed. Both keep changing for the whole run: the
// gate narrows until 40 locks and the satellite speeds up until 45.
export const orbitWindow = (points) => Math.max(0.08, 0.5 - points * 0.0105);
export const orbitSpeed = (points) => 1.15 + Math.min(points, 45) * 0.05;
// The perfect zone: the inner 30 % of the gate, and never more than 0.07 rad either side of its centre.
export const orbitPerfect = (points) => Math.min(0.3 * orbitWindow(points), 0.07);
export const SHIELD_CHAIN = 4;
export const DARK_FROM = 30;
// Is the gate for the lock after `points` locks a dark one?
export const darkGate = (points) => points >= DARK_FROM && points % 3 === 2;
const HULL_COLOR = [LAMP.red, LAMP.red, LAMP.amber, LAMP.green];

// ---- feats, ranks and the daily order --------------------------------------------------------
const life = (a, key) => (a.sv.st[key] || 0) + (a.R[key] || 0);
export const ORBIT_FEATS = [
  { id: "l10", name: "FIRST CONTACT", text: "Make 10 locks in one run.", n: 10, prog: (a) => a.points },
  { id: "l20", name: "DEEP FIELD", text: "Make 20 locks in one run.", n: 20, prog: (a) => a.points },
  { id: "l30", name: "FAR SIDE", text: "Make 30 locks in one run.", n: 30, prog: (a) => a.points },
  { id: "l40", name: "EVENT HORIZON", text: "Make 40 locks in one run.", n: 40, prog: (a) => a.points },
  { id: "shield", name: "CHARGED", text: "Chain 4 perfect locks to raise a shield.", n: SHIELD_CHAIN, prog: (a) => a.R.chainMax },
  { id: "chain8", name: "DEAD CENTRE", text: "Chain 8 perfect locks.", n: 8, prog: (a) => a.R.chainMax },
  { id: "perf15", name: "FINE TUNING", text: "Make 15 perfect locks in one run.", n: 15, prog: (a) => a.R.perfects },
  { id: "clean", name: "UNTOUCHED", text: "Reach 20 locks without losing hull.", n: 20, prog: (a) => a.R.clean },
  { id: "dark1", name: "BLIND LOCK", text: "Lock a dark gate.", n: 1, prog: (a) => a.R.dark },
  { id: "dark5", name: "NIGHT WATCH", text: "Lock 5 dark gates in one run.", n: 5, prog: (a) => a.R.dark },
  { id: "daily", name: "ON ORDERS", text: "Meet a daily order.", n: 1, prog: (a) => life(a, "daily") },
  { id: "streak", name: "ROUTINE", text: "Meet the daily order 3 days running.", n: 3, prog: (a) => a.sv.dl.streak },
  { id: "veteran", name: "VETERAN", text: "Make 1000 locks in all.", n: 1000, prog: (a) => life(a, "locks") },
  { id: "last", name: "LAST BREATH", text: "Make 10 locks on the last hull point.", hint: "One hull point can carry a long way.", n: 10, hidden: true, prog: (a) => a.R.lastStand },
  { id: "saved", name: "DEFLECTED", text: "Let a shield take a miss.", hint: "Some misses never land.", n: 1, hidden: true, prog: (a) => a.R.saves },
];
const FEAT_IDS = ORBIT_FEATS.map((f) => f.id);
export const ORBIT_RANKS = [[0, "CADET"], [2, "SPOTTER"], [4, "PILOT"], [7, "NAVIGATOR"], [10, "WAYFINDER"], [13, "ASTROGATOR"], [15, "FIXED STAR"]];
// Today's order, the same for everyone on the same date.
export function orbitOrder(key) {
  const h = hashText("orbit" + key), kind = h % 4, v = (h >>> 8) % 4;
  if (kind === 0) return { kind: "sector", n: 3 + v, text: "Reach sector " + (3 + v) + "." };
  if (kind === 1) return { kind: "chain", n: 3 + v, text: "Chain " + (3 + v) + " perfect locks." };
  if (kind === 2) return { kind: "perfects", n: 6 + 2 * v, text: "Make " + (6 + 2 * v) + " perfect locks in one run." };
  return { kind: "clean", n: 8 + 3 * v, text: "Reach " + (8 + 3 * v) + " locks without losing hull." };
}
// Bring any stored shape (nothing, schema 1 from recordRun, schema 2) to schema 2.
export function migrateOrbit(raw) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const st = r.st && typeof r.st === "object" ? r.st : {};
  const n = (v) => Math.max(0, Math.floor(num(v)));
  return {
    schema: 2,
    runs: n(r.runs),
    last: r.last && typeof r.last === "object" ? r.last : {},
    milestone: n(r.milestone),
    ft: cleanFeats(r.ft, FEAT_IDS),
    st: { locks: n(st.locks), perfects: n(st.perfects), dark: n(st.dark), daily: n(st.daily), best: Math.max(n(st.best), n(r.last?.locks)) },
    dl: cleanDaily(r.dl),
  };
}

// The finished run carries the save as it stood when the run ended; it is written once the gesture
// window has passed (GestureGuard), so a run ended by the menu gesture's own taps never reaches it.
class OrbitGuard extends GestureGuard {
  record(ended) {
    this.done.add(ended.id);
    this.c.score(...ended.score);
    this.c.saveProgress?.(ended.run)?.catch?.(this.c.error);
  }
}

export class OrbitLock {
  constructor(ctx) {
    this.c = ctx;
    this.lamps = new LampBus(ctx);
    this.sv = migrateOrbit(ctx.progress?.());
    this.guard = new OrbitGuard(this, ctx, ["angle", "target", "points", "lives", "flash", "feedback", "dir", "drift", "miss", "best0", "idle",
      "chain", "shield", "dark", "R", "sv", "fresh", "orderMet", "perfectAt", "note", "noteT"]);
    this.reset();
  }
  dayKey() { return dateKey(); }
  reset() {
    this.phase = "title";
    this.ended = null;
    this.overAt = 0;
    this.angle = -Math.PI / 2;
    this.target = 0.5;
    this.points = 0;
    this.lives = 3;
    this.flash = 0;
    this.miss = null;
    this.idle = 0;     // seconds since the last lock: ten without one costs a hull point
    this.dir = 1;      // direction of travel: reverses every sector from the tenth lock
    this.drift = 0;    // the gate itself slides (rad/s) from the twentieth lock
    this.chain = 0;    // perfect locks in a row
    this.shield = 0;   // 1 while a shield is charged
    this.dark = false; // the current gate shows only on the lamps
    this.perfectAt = -9;
    // This run's tallies, for feats and the daily order.
    this.R = { perfects: 0, chainMax: 0, clean: 0, dark: 0, lastStand: 0, saves: 0, daily: 0, locks: 0, hurt: 0 };
    this.fresh = [];   // feats earned this run
    this.orderMet = false;
    this.best0 = this.c.best?.() ?? 0;
    this.note = ""; this.noteT = 0;
    this.feedback = "ACQUIRE THE AMBER GATE";
    this.t = 0;
    this.c.hint("Press when the satellite crosses the illuminated gate. Hit its centre to charge a shield.");
  }
  // Radians the satellite still has to travel, in its direction, to reach the gate.
  ahead() { return ((((this.target - this.angle) * this.dir) % TAU) + TAU) % TAU; }
  down() {
    this.guard.mark();
    if (this.phase !== "play") {
      if (this.guard.locked()) return;
      this.guard.stash();
      this.reset();
      this.phase = "play";
      return;
    }
    const off = Math.abs(wrapAngle(this.angle - this.target));
    if (off < orbitWindow(this.points)) this.lock(off < orbitPerfect(this.points));
    else {
      // The next gate is placed up to 4.5 rad ahead, so "early" covers that whole arc; a satellite
      // that has just gone past the gate is nearly a full turn from it.
      const early = this.ahead() <= ORBIT_AHEAD_MAX + 0.1;
      this.feedback = early ? "EARLY / WAIT FOR THE GATE" : "LATE / CATCH THE NEXT ORBIT";
      this.chain = 0;
      if (this.shield) {
        // The shield takes the miss: no hull lost, the gate stays where it is.
        this.shield = 0; this.R.saves++;
        this.feedback += " / SHIELD SPENT";
        this.flash = 0.3; this.miss = early ? "early" : "late";
        this.c.tone(240, 0.12, "triangle");
        this.lamps.flash(0.35, () => fill(LAMP.cyan, 0.6));
        this.checkFeats();
        return;
      }
      this.c.tone(95, 0.2, "sawtooth");
      // The lamp on the side of the error flashes: left when early, right when late.
      this.loseHull(early ? "early" : "late");
    }
  }
  lock(perfect) {
    const wasDark = this.dark;
    this.points++;
    this.R.locks++;
    const p = this.points, sector = Math.floor(p / 5) + 1;
    if (wasDark) this.R.dark++;
    if (!this.R.hurt) this.R.clean = p;
    if (this.lives === 1) this.R.lastStand++;
    const news = [];
    if (perfect) {
      this.chain++; this.R.perfects++; this.perfectAt = this.t;
      this.R.chainMax = Math.max(this.R.chainMax, this.chain);
      if (this.chain % SHIELD_CHAIN === 0 && !this.shield) { this.shield = 1; news.push("SHIELD CHARGED"); }
    } else this.chain = 0;
    this.feedback = p % 5 === 0 ? "SECTOR " + sector + " / ARRAY EXPANDS"
      : (wasDark ? "DARK GATE LOCKED" : perfect ? "PERFECT LOCK" : "SIGNAL LOCKED") + (this.chain > 1 ? " x" + this.chain : "");
    if (p % 5 === 0 && p >= 10) { this.dir = -this.dir; news.push("THE ORBIT REVERSES"); }
    if (p === 20) news.push("THE GATE NOW DRIFTS");
    if (p === DARK_FROM) news.push("DARK GATES AHEAD / WATCH LAMP I");
    if (p % 10 === 0 && this.lives < 3) { this.lives++; news.push("HULL REPAIRED"); }
    this.drift = p >= 20 ? this.c.rng.range(-0.3, 0.3) : 0;
    this.target += this.dir * this.c.rng.range(1.2, ORBIT_AHEAD_MAX);
    this.dark = darkGate(p);
    const hz = 400 + Math.min(p, 45) * 22;
    this.c.tone(hz, 0.13);
    if (perfect) this.c.tone(hz * 1.5, 0.1, "triangle");
    this.flash = 0.18; this.miss = null; this.idle = 0;
    if (p % 5 === 0) this.lamps.flash(0.4, () => fill(LAMP.white, 0.7));
    else if (perfect) this.lamps.flash(0.18, (e, T, a) => lampMax(a, fill(LAMP.white, 0.5 * (1 - e / T) + 0.2)));
    else this.lamps.flash(0.15, (e, T, a) => lampMax(a, fill(LAMP.green, 0.55)));
    this.checkOrder(news);
    this.checkFeats(news);
    // The announcement line holds about 60 characters at its size; the most important news comes first.
    let line = "";
    for (const item of news) if (!line || line.length + 3 + item.length <= 60) line = line ? line + " / " + item : item;
    if (line) announce(this, line);
  }
  loseHull(kind) {
    this.lives--;
    this.R.hurt = 1;
    this.chain = 0;
    this.flash = 0.3; this.miss = kind;
    this.lamps.flash(0.3, () => (kind === "early" ? only(0, LAMP.red, 0.8) : kind === "late" ? only(2, LAMP.red, 0.8) : fill(LAMP.red, 0.6)));
    if (!this.lives) this.finish();
  }
  // Has the daily order been met during this run?
  orderDone() {
    const o = orbitOrder(this.dayKey()), R = this.R;
    if (o.kind === "sector") return Math.floor(this.points / 5) + 1 >= o.n;
    if (o.kind === "chain") return R.chainMax >= o.n;
    if (o.kind === "perfects") return R.perfects >= o.n;
    return R.clean >= o.n;
  }
  checkOrder(news = []) {
    if (this.orderMet || !this.orderDone()) return;
    this.orderMet = true;
    if (meetDaily(this.sv.dl, this.dayKey())) {
      this.R.daily = 1;
      news.unshift("DAILY ORDER MET" + (this.sv.dl.streak > 1 ? " / STREAK " + this.sv.dl.streak : ""));
      this.c.tone(784, 0.1, "sine"); this.c.tone(1047, 0.18, "sine");
    }
  }
  // Feats are marked the moment they are met; the save is written when the run is recorded.
  checkFeats(news) {
    for (const id of newlyMet(ORBIT_FEATS, this.sv.ft, this)) {
      this.sv.ft.push(id); this.fresh.push(id);
      const name = ORBIT_FEATS.find((f) => f.id === id).name;
      if (news) news.push("FEAT: " + name); else announce(this, "FEAT: " + name);
    }
  }
  finish() {
    const sv = this.sv, R = this.R;
    sv.runs++;
    sv.st.locks += R.locks; sv.st.perfects += R.perfects; sv.st.dark += R.dark; sv.st.daily += R.daily;
    sv.st.best = Math.max(sv.st.best, this.points);
    // Lifetime tallies are now in the save, so the feats that count them must not count this run twice.
    R.locks = 0; R.daily = 0;
    this.checkFeats();
    const last = { locks: this.points, milestone: Math.floor(this.points / 5), perfects: R.perfects, chain: R.chainMax };
    sv.last = last;
    sv.milestone = Math.max(sv.milestone, last.milestone);
    this.guard.end([this.points], JSON.parse(JSON.stringify(sv)));
    this.lamps.flash(0.6, (e, T) => fill(LAMP.red, 0.6 * (1 - e / T)));
  }
  up() { this.guard.release(); }
  cancel() { this.guard.rewind(); this.lamps.clear(); }
  // Leaving mid-run keeps the score reached so far (the server keeps the maximum).
  pause() {
    this.guard.settle();
    if (this.phase === "play" && this.points > 0) this.c.score(this.points);
    this.lamps.sleep();
  }
  resume() { this.lamps.wake(); }
  // Leaving for good mid-run: a daily order met or a feat earned on the way is kept.
  dispose() {
    const keep = this.phase === "play" && (this.orderMet || this.fresh.length);
    this.pause();
    if (keep) this.c.saveProgress?.(JSON.parse(JSON.stringify(this.sv)))?.catch?.(this.c.error);
  }
  // Left lamp: amber ramp as the satellite nears the gate, bright while it is inside (white at its
  // centre once the gates go dark, where it is the only guide); middle: hull (green, amber, red), with a
  // slow cyan breath while a shield is charged; right: progress through the sector in cyan.
  lampValues() {
    const p = this.points, off = Math.abs(wrapAngle(this.angle - this.target)), inside = off < orbitWindow(p);
    const rate = Math.max(0.5, orbitSpeed(p) - this.drift * this.dir);
    const near = clamp(1 - this.ahead() / rate / 1.2, 0, 1);
    const left = this.dark && off < orbitPerfect(p) ? dim(LAMP.white, 0.9) : dim(LAMP.amber, inside ? 0.9 : 0.33 * near);
    const hull = this.shield ? blend(HULL_COLOR[this.lives], LAMP.cyan, 0.3 + 0.6 * pulse(this.t, 0.7)) : HULL_COLOR[this.lives];
    return lamps(left, dim(hull, 0.25), dim(LAMP.cyan, [0, 0.1, 0.17, 0.25, 0.33][p % 5]));
  }
  update(dt) {
    this.t += dt;
    this.guard.tick(dt);
    if (this.phase === "play") {
      this.angle += this.dir * dt * orbitSpeed(this.points);
      this.target += this.drift * dt;
      if ((this.idle += dt) >= 10) {
        this.idle = 0;
        this.chain = 0;
        this.feedback = "NO SIGNAL / THE HULL DECAYS";
        this.c.tone(95, 0.2, "sawtooth");
        this.loseHull("idle");
      }
    }
    this.flash = Math.max(0, this.flash - dt);
    if (this.noteT > 0) this.noteT -= dt;
    this.lamps.frame(dt, this.phase === "play" ? this.lampValues() : null);
    this.c.hud([
      ["SECTOR", Math.floor(this.points / 5) + 1],
      ["LOCKS", this.points],
      ["HULL", (this.lives ? "◇".repeat(this.lives) : "0") + (this.shield ? " +◈" : "")],
      ["BEST", this.c.best()],
    ]);
  }
  draw(g) {
    space(g, this.t);
    const x = 480,
      y = 266,
      r = 172;
    for (let i = 0; i < 60; i++) {
      const a = (i * TAU) / 60;
      line(
        g,
        x + Math.cos(a) * (r + 22),
        y + Math.sin(a) * (r + 22),
        x + Math.cos(a) * (r + (i % 5 ? 26 : 33)),
        y + Math.sin(a) * (r + (i % 5 ? 26 : 33)),
        C.line,
      );
    }
    circle(g, x, y, r, C.line);
    circle(g, x, y, r - 10, C.line, false, 0.8);
    circle(g, x, y, 67, this.shield && this.phase === "play" ? C.cyan : C.line);
    glyph(g, 4, x, y, 30, C.muted);
    // A dark gate is drawn only when a press has just missed it, in red, so the miss can be read.
    const a = orbitWindow(this.points), missed = this.flash > 0 && this.miss;
    if (!this.dark || missed || this.phase !== "play") {
      g.strokeStyle = missed ? C.red : C.amber;
      g.lineWidth = 16;
      g.beginPath();
      g.arc(x, y, r, this.target - a, this.target + a);
      g.stroke();
      // The perfect zone: a thin bright mark at the gate's centre.
      if (!missed) {
        const k = orbitPerfect(this.points);
        g.strokeStyle = this.t - this.perfectAt < 0.25 ? "#ffffff" : C.ink;
        g.lineWidth = 4;
        g.beginPath();
        g.arc(x, y, r, this.target - k, this.target + k);
        g.stroke();
      }
    }
    for (let i = 14; i >= 0; i--) {
      g.globalAlpha = (1 - i / 15) * 0.7;
      circle(
        g,
        x + Math.cos(this.angle - this.dir * i * 0.028) * r,
        y + Math.sin(this.angle - this.dir * i * 0.028) * r,
        i === 0 ? 8 : 2,
        C.ink,
        true,
      );
    }
    g.globalAlpha = 1;
    if (this.phase === "play" && this.points >= 10)
      text(g, this.dir > 0 ? "CLOCKWISE" : "COUNTER-CLOCKWISE", x, y + 80, 22, C.muted, "center");
    if (this.phase === "play" && this.dark) text(g, "DARK GATE / LAMP I", x, y - 80, 20, C.amber, "center");
    if (this.phase === "play" && this.chain > 0) text(g, "PERFECT x" + this.chain + (this.shield ? "  SHIELD" : ""), 860, 120, 18, this.shield ? C.cyan : C.amber, "center");
    else if (this.phase === "play" && this.shield) text(g, "SHIELD", 860, 120, 18, C.cyan, "center");
    if (this.phase === "play") text(g, this.feedback, 480, 503, 24, C.ink, "center");
    drawNote(g, this);
    if (this.phase === "title") {
      banner(g, "ORBIT LOCK", "Align the wandering satellite. Press inside the gate; its centre charges a shield.");
      this.drawGoals(g, 410);
    }
    if (this.phase === "over") this.drawResult(g);
  }
  // Rank, today's order and one feat at a time (title screen).
  drawGoals(g, y) {
    const sv = this.sv, n = sv.ft.length, key = this.dayKey(), next = nextRank(ORBIT_RANKS, n);
    panel(g, y - 22, y + 128);
    text(g, "RANK " + rankOf(ORBIT_RANKS, n) + "   FEATS " + n + " / " + ORBIT_FEATS.length + (next ? "   NEXT RANK AT " + next[0] : ""), 480, y, 18, C.ink, "center");
    const streak = liveStreak(sv.dl, key);
    text(g, (dailyDone(sv.dl, key) ? "TODAY'S ORDER MET" : "TODAY: " + orbitOrder(key).text) + (streak > 1 ? "   STREAK " + streak : ""), 480, y + 30, 18, dailyDone(sv.dl, key) ? C.cyan : C.amber, "center");
    drawFeatTicker(g, ORBIT_FEATS, sv.ft, this.t, y + 66);
  }
  drawResult(g) {
    banner(g, "SIGNAL LOST", `${this.points} locks acquired${this.points > this.best0 ? " / NEW BEST" : ""}`, C.amber);
    const lines = [];
    lines.push(["PERFECT " + this.R.perfects + "   BEST CHAIN " + this.R.chainMax + (this.R.dark ? "   DARK GATES " + this.R.dark : ""), C.ink]);
    if (this.orderMet) lines.push(["DAILY ORDER MET" + (this.sv.dl.streak > 1 ? " / STREAK " + this.sv.dl.streak : ""), C.cyan]);
    else lines.push(["TODAY: " + orbitOrder(this.dayKey()).text, C.muted]);
    for (const id of this.fresh.slice(0, 2)) lines.push(["NEW FEAT: " + ORBIT_FEATS.find((f) => f.id === id).name, C.amber]);
    if (this.fresh.length > 2) lines.push(["AND " + (this.fresh.length - 2) + " MORE FEATS", C.amber]);
    const close = closestFeat(ORBIT_FEATS, this.sv.ft, this);
    if (close && lines.length < 5) lines.push([close, C.muted]);
    panel(g, 372, 384 + lines.length * 28);
    lines.forEach(([s, col], i) => text(g, s, 480, 392 + i * 28, 18, col, "center"));
  }
}
