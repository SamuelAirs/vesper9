import { TAU, clamp, wrapAngle } from "../engine/math.js";
import { C, text, line, circle, space, banner } from "../engine/draw.js";
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
//   kept in a versioned save (schema 2) that still carries the first release's fields;
// - two more ways to play, earned with feats and chosen by holding on the title or result screen:
//   RUSH (sixty seconds, no hull, a miss costs time; opens at a best of 20 locks) and ECLIPSE (every gate
//   is dark from the start; opens after 25 dark gates in all).
//   Only the standard game sets the console's best score; each mode keeps its own best.
const ORBIT_AHEAD_MAX = 4.5;
// Half-width of the gate (radians) and angular speed. The gate narrows until about 34 locks and the
// satellite speeds up quickly until 45, slowly after. The floor of 0.14 rad keeps the narrowest gate at about +-40 ms at top
// speed: tighter than that is the edge of human timing once the button and lamp latency are added.
export const orbitWindow = (points) => Math.max(0.14, 0.5 - points * 0.0105);
// Past 45 locks the satellite keeps gaining speed slowly (to 4.5 rad/s at 100), so a run still ends.
export const orbitSpeed = (points) => 1.15 + Math.min(points, 45) * 0.05 + Math.max(0, Math.min(points, 100) - 45) * 0.02;
// The perfect zone: the inner 30 % of the gate, and never more than 0.07 rad either side of its centre.
export const orbitPerfect = (points) => Math.min(0.3 * orbitWindow(points), 0.07);
export const SHIELD_CHAIN = 4;
export const DARK_FROM = 30;
// Is the gate for the lock after `points` locks a dark one? Every third from 30, every other from 50.
export const darkGate = (points) => points >= DARK_FROM && (points >= 50 ? points % 2 === 1 : points % 3 === 2);
const HULL_COLOR = [LAMP.red, LAMP.red, LAMP.amber, LAMP.green];
// Ways to play, each opened by something that shows the skill it asks for (not by a count of feats,
// which one good run can collect): `opens(sv)` says whether it is open, `how` says how to open it.
export const ORBIT_MODES = [
  { id: "standard", name: "STANDARD", opens: () => true, how: "", text: "Three hull points. The gate narrows, reverses and drifts." },
  { id: "rush", name: "RUSH", opens: (sv) => sv.st.best >= 20, how: "REACH 20 LOCKS", text: "Sixty seconds, no hull. A lock adds time back; a miss costs three seconds." },
  { id: "eclipse", name: "ECLIPSE", opens: (sv) => sv.st.dark >= 25, how: "LOCK 25 DARK GATES IN ALL", text: "Every gate is dark. Lamp I is the only guide." },
];
export const RUSH_TIME = 60, RUSH_MISS = 3, RUSH_SECTOR_BONUS = 4;
// A press on the title or result screen held this long changes the mode instead of starting.
export const MODE_HOLD = 0.45;
// Each sector tints the ring's ticks, so the run visibly travels.
const SECTOR_TINT = ["#314938", "#2f4a52", "#3f3a5a", "#523a40", "#4f4a2c", "#2c4f3e", "#46305a"];

// ---- feats, ranks and the daily order --------------------------------------------------------
const life = (a, key) => (a.sv.st[key] || 0) + (a.R[key] || 0);
export const ORBIT_FEATS = [
  { id: "l10", name: "FIRST CONTACT", text: "Make 10 locks in one run.", n: 10, prog: (a) => a.points },
  { id: "l20", name: "DEEP FIELD", text: "Make 20 locks in one run.", n: 20, prog: (a) => a.points },
  { id: "l35", name: "FAR SIDE", text: "Make 35 locks in one run.", n: 35, prog: (a) => a.points },
  { id: "l50", name: "EVENT HORIZON", text: "Make 50 locks in one run.", n: 50, prog: (a) => a.points },
  { id: "shield", name: "CHARGED", text: "Chain 4 perfect locks to raise a shield.", n: SHIELD_CHAIN, prog: (a) => a.R.chainMax },
  { id: "chain8", name: "DEAD CENTRE", text: "Chain 8 perfect locks.", n: 8, prog: (a) => a.R.chainMax },
  { id: "perf15", name: "FINE TUNING", text: "Make 15 perfect locks in one run.", n: 15, prog: (a) => a.R.perfects },
  { id: "clean", name: "UNTOUCHED", text: "Reach 20 locks without losing hull.", n: 20, prog: (a) => a.R.clean },
  { id: "dark1", name: "BLIND LOCK", text: "Lock a dark gate.", n: 1, prog: (a) => a.R.dark },
  { id: "dark5", name: "NIGHT WATCH", text: "Lock 8 dark gates in one run.", n: 8, prog: (a) => a.R.dark },
  { id: "daily", name: "ON ORDERS", text: "Meet a daily order.", n: 1, prog: (a) => life(a, "daily") },
  { id: "streak", name: "ROUTINE", text: "Meet the daily order 3 days running.", n: 3, prog: (a) => a.sv.dl.streak },
  { id: "rush25", name: "AGAINST THE CLOCK", text: "Make 25 locks in one rush.", n: 25, prog: (a) => (a.mode === "rush" ? a.points : 0) },
  { id: "eclipse15", name: "TOTALITY", text: "Make 15 locks in one eclipse.", n: 15, prog: (a) => (a.mode === "eclipse" ? a.points : 0) },
  { id: "veteran", name: "VETERAN", text: "Make 1000 locks in all.", n: 1000, prog: (a) => life(a, "locks") },
  { id: "last", name: "LAST BREATH", text: "Make 10 locks on the last hull point.", hint: "One hull point can carry a long way.", n: 10, hidden: true, prog: (a) => a.R.lastStand },
  { id: "saved", name: "DEFLECTED", text: "Let a shield take a miss.", hint: "Some misses never land.", n: 1, hidden: true, prog: (a) => a.R.saves },
];
const FEAT_IDS = ORBIT_FEATS.map((f) => f.id);
export const ORBIT_RANKS = [[0, "CADET"], [2, "SPOTTER"], [4, "PILOT"], [7, "NAVIGATOR"], [10, "WAYFINDER"], [13, "ASTROGATOR"], [17, "FIXED STAR"]];
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
    mb: { rush: n(r.mb?.rush), eclipse: n(r.mb?.eclipse) },
    mode: ORBIT_MODES.some((m) => m.id === r.mode) ? r.mode : "standard",
  };
}

// The finished run carries the save as it stood when the run ended; it is written once the gesture
// window has passed (GestureGuard), so a run ended by the menu gesture's own taps never reaches it.
class OrbitGuard extends GestureGuard {
  record(ended) {
    this.done.add(ended.id);
    if (ended.score.length) this.c.score(...ended.score);
    this.c.saveProgress?.(ended.run)?.catch?.(this.c.error);
  }
}

export class OrbitLock {
  constructor(ctx) {
    this.c = ctx;
    this.lamps = new LampBus(ctx);
    this.sv = migrateOrbit(ctx.progress?.());
    this.guard = new OrbitGuard(this, ctx, ["angle", "target", "points", "lives", "flash", "feedback", "dir", "drift", "miss", "best0", "idle",
      "chain", "shield", "dark", "R", "sv", "fresh", "orderMet", "perfectAt", "note", "noteT", "mode", "clock", "pressAt", "shake"]);
    this.mode = this.unlocked(this.sv.mode) ? this.sv.mode : "standard";
    this.pressAt = null; // a press on a menu screen waiting for its release (only once a mode is earned)
    this.parts = Array.from({ length: 36 }, () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0 }));
    this.rings = [];
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
    this.clock = RUSH_TIME; // seconds left in a rush
    this.shake = 0;
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
  unlocked(id) { const m = ORBIT_MODES.find((x) => x.id === id); return !!m && m.opens(this.sv); }
  modesOpen() { return ORBIT_MODES.filter((m) => this.unlocked(m.id)).length > 1; }
  modeInfo() { return ORBIT_MODES.find((m) => m.id === this.mode); }
  begin() {
    this.guard.stash();
    this.reset();
    this.phase = "play";
    if (this.mode === "eclipse") this.dark = true;
  }
  // Holding on a menu screen moves to the next earned mode.
  nextMode() {
    let i = ORBIT_MODES.findIndex((m) => m.id === this.mode);
    do i = (i + 1) % ORBIT_MODES.length; while (!this.unlocked(ORBIT_MODES[i].id));
    this.mode = ORBIT_MODES[i].id;
    this.sv.mode = this.mode;
    this.c.tone(520 + 120 * i, 0.06, "sine");
    this.c.saveProgress?.(JSON.parse(JSON.stringify(this.sv)))?.catch?.(this.c.error);
  }
  down() {
    this.guard.mark();
    if (this.phase !== "play") {
      if (this.guard.locked()) return;
      // Until a second mode is earned a press starts at once, as it always has; afterwards the
      // release decides: a tap plays, a hold changes the mode.
      if (this.modesOpen()) { this.pressAt = this.t; return; }
      this.begin();
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
      if (this.mode === "rush") this.loseTime(early ? "early" : "late");
      else this.loseHull(early ? "early" : "late");
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
    this.dark = this.mode === "eclipse" || darkGate(p);
    if (this.mode === "rush" && p % 5 === 0) { this.clock += RUSH_SECTOR_BONUS; news.push("+" + RUSH_SECTOR_BONUS + " SECONDS"); }
    this.burstAt(this.angle, perfect ? 16 : 9);
    this.rings.push({ r: 172, life: 0.5, perfect });
    if (this.rings.length > 4) this.rings.shift();
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
  // A rush has no hull: a miss costs seconds instead.
  loseTime(kind) {
    this.clock = Math.max(0, this.clock - RUSH_MISS);
    this.chain = 0; this.R.hurt = 1;
    this.flash = 0.3; this.miss = kind; this.shake = 0.25;
    this.lamps.flash(0.3, () => (kind === "early" ? only(0, LAMP.red, 0.8) : only(2, LAMP.red, 0.8)));
  }
  loseHull(kind) {
    this.shake = 0.3;
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
    if (this.mode === "standard") sv.st.best = Math.max(sv.st.best, this.points);
    else { this.modeBest0 = sv.mb[this.mode]; sv.mb[this.mode] = Math.max(sv.mb[this.mode], this.points); }
    // Lifetime tallies are now in the save, so the feats that count them must not count this run twice.
    R.locks = 0; R.daily = 0;
    this.checkFeats();
    const last = { locks: this.points, milestone: Math.floor(this.points / 5), perfects: R.perfects, chain: R.chainMax, ...(this.mode === "standard" ? {} : { mode: this.mode }) };
    sv.last = last;
    if (this.mode === "standard") sv.milestone = Math.max(sv.milestone, last.milestone);
    this.guard.end(this.mode === "standard" ? [this.points] : [], JSON.parse(JSON.stringify(sv)));
    this.lamps.flash(0.6, (e, T) => fill(LAMP.red, 0.6 * (1 - e / T)));
  }
  up() {
    this.guard.release();
    if (this.pressAt === null || this.phase === "play") { this.pressAt = null; return; }
    const held = this.t - this.pressAt;
    this.pressAt = null;
    if (held >= MODE_HOLD) this.nextMode();
    else this.begin();
  }
  cancel() { this.guard.rewind(); this.lamps.clear(); }
  // Leaving mid-run keeps the score reached so far (the server keeps the maximum).
  pause() {
    this.guard.settle();
    this.pressAt = null;
    if (this.phase === "play" && this.points > 0 && this.mode === "standard") this.c.score(this.points);
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
      if (this.mode === "rush") {
        this.clock -= dt;
        if (this.clock <= 0) { this.clock = 0; this.feedback = "TIME"; this.c.tone(330, 0.3, "triangle"); this.finish(); }
      } else if ((this.idle += dt) >= 10) {
        this.idle = 0;
        this.chain = 0;
        this.feedback = "NO SIGNAL / THE HULL DECAYS";
        this.c.tone(95, 0.2, "sawtooth");
        this.loseHull("idle");
      }
    }
    this.flash = Math.max(0, this.flash - dt);
    this.shake = Math.max(0, this.shake - dt);
    for (const q of this.parts) if (q.life > 0) { q.life -= dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 0.96; q.vy *= 0.96; }
    for (const ring of this.rings) ring.life -= dt;
    this.rings = this.rings.filter((ring) => ring.life > 0);
    if (this.noteT > 0) this.noteT -= dt;
    this.lamps.frame(dt, this.phase === "play" ? this.lampValues() : null);
    this.c.hud([
      ["SECTOR", Math.floor(this.points / 5) + 1],
      ["LOCKS", this.points],
      this.mode === "rush" ? ["TIME", Math.ceil(this.clock) + " s"] : ["HULL", (this.lives ? "◇".repeat(this.lives) : "0") + (this.shield ? " +◈" : "")],
      ["BEST", this.mode === "standard" ? this.c.best() : this.sv.mb[this.mode]],
    ]);
  }
  // Sparks thrown off the ring where a lock happened.
  burstAt(angle, n) {
    const rng = this.c.rng, x = 480 + Math.cos(angle) * 172, y = 266 + Math.sin(angle) * 172;
    for (let k = 0; k < n; k++) {
      const q = this.parts.find((p) => p.life <= 0);
      if (!q) return;
      // Cosmetic only: a fixed spread rather than the game's generator, so effects never change a run.
      const a = angle + Math.PI * (k / n - 0.5) * 1.6 + (k % 2 ? 0.2 : -0.2), v = 60 + ((k * 37) % 90);
      q.x = x; q.y = y; q.vx = Math.cos(a) * v; q.vy = Math.sin(a) * v; q.life = 0.5 + (k % 3) * 0.12;
    }
    void rng;
  }
  draw(g) {
    space(g, this.t);
    const sx = this.shake > 0 ? Math.sin(this.t * 90) * 6 * this.shake / 0.3 : 0;
    g.save?.();
    g.translate?.(sx, 0);
    const x = 480, y = 266, r = 172, sector = Math.floor(this.points / 5);
    const tint = this.phase === "play" ? SECTOR_TINT[sector % SECTOR_TINT.length] : C.line;
    // The dial: ticks every 6 degrees, longer every 30, tinted by sector.
    for (let i = 0; i < 60; i++) {
      const a = (i * TAU) / 60, long = i % 5 === 0;
      line(g, x + Math.cos(a) * (r + 22), y + Math.sin(a) * (r + 22), x + Math.cos(a) * (r + (long ? 33 : 26)), y + Math.sin(a) * (r + (long ? 33 : 26)), long ? C.muted : tint, long ? 2 : 1);
    }
    circle(g, x, y, r, tint);
    circle(g, x, y, r - 10, C.line, false, 0.8);
    this.drawPlanet(g, x, y);
    // Rings spreading from the dial after a lock.
    for (const ring of this.rings) {
      g.globalAlpha = Math.max(0, ring.life / 0.5) * 0.5;
      circle(g, x, y, ring.r + (0.5 - ring.life) * 70, ring.perfect ? C.ink : C.amber);
    }
    g.globalAlpha = 1;
    // A dark gate is drawn only when a press has just missed it, in red, so the miss can be read.
    const a = orbitWindow(this.points), missed = this.flash > 0 && this.miss;
    if (!this.dark || missed || this.phase !== "play") {
      const col = missed ? C.red : C.amber;
      g.globalAlpha = 0.18 + 0.08 * Math.sin(this.t * 5);
      g.strokeStyle = col; g.lineWidth = 34;
      g.beginPath(); g.arc(x, y, r, this.target - a * 1.15, this.target + a * 1.15); g.stroke();
      g.globalAlpha = 1;
      g.strokeStyle = col;
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
    } else {
      // Where a dark gate is, only a faint hint of the ring's edge flickers when lamp I is bright.
      const off = Math.abs(wrapAngle(this.angle - this.target));
      if (off < a) { g.globalAlpha = 0.25; circle(g, x, y, r + 14, C.amber); g.globalAlpha = 1; }
    }
    // The satellite: a long fading trail, a soft glow and a bright core with two panels.
    for (let i = 22; i >= 1; i--) {
      g.globalAlpha = (1 - i / 23) * 0.55;
      circle(g, x + Math.cos(this.angle - this.dir * i * 0.024) * r, y + Math.sin(this.angle - this.dir * i * 0.024) * r, i < 4 ? 4 : 2, this.shield ? C.cyan : C.ink, true);
    }
    const px = x + Math.cos(this.angle) * r, py = y + Math.sin(this.angle) * r;
    g.globalAlpha = 0.25; circle(g, px, py, 16, this.shield ? C.cyan : C.ink, true);
    g.globalAlpha = 1;
    const tx = -Math.sin(this.angle) * 11, ty = Math.cos(this.angle) * 11;
    line(g, px - tx, py - ty, px + tx, py + ty, C.muted, 4);
    circle(g, px, py, 7, C.ink, true);
    if (this.shield) circle(g, px, py, 12, C.cyan);
    // Sparks.
    g.fillStyle = C.amber;
    for (const q of this.parts) if (q.life > 0) { g.globalAlpha = Math.min(1, q.life * 2); g.fillRect(q.x - 2, q.y - 2, 4, 4); }
    g.globalAlpha = 1;
    g.restore?.();
    if (this.phase === "play" && this.points >= 10)
      text(g, this.dir > 0 ? "CLOCKWISE" : "COUNTER-CLOCKWISE", x, y + 92, 20, C.muted, "center");
    if (this.phase === "play" && this.dark) text(g, "DARK GATE / LAMP I", x, y - 92, 20, C.amber, "center");
    if (this.phase === "play") this.drawSide(g);
    if (this.phase === "play") text(g, this.feedback, 480, 503, 24, C.ink, "center");
    drawNote(g, this);
    if (this.phase === "title") {
      banner(g, "ORBIT LOCK", "Align the wandering satellite. Press inside the gate; its centre charges a shield.");
      this.drawGoals(g, 410);
    }
    if (this.phase === "over") this.drawResult(g);
  }
  // A small world at the centre: banded disc, a lit limb, and a moonlet on its own slow orbit.
  drawPlanet(g, x, y) {
    circle(g, x, y, 62, C.dark, true);
    g.globalAlpha = 0.6;
    for (const [dy, w] of [[-30, 50], [-12, 60], [8, 60], [28, 46]]) line(g, x - w, y + dy, x + w, y + dy, "#223b29", 6);
    g.globalAlpha = 1;
    g.strokeStyle = C.muted; g.lineWidth = 3;
    g.beginPath(); g.arc(x, y, 62, -2.4, -0.2); g.stroke();
    circle(g, x, y, 62, this.shield && this.phase === "play" ? C.cyan : C.line);
    const m = this.t * 0.4;
    circle(g, x, y, 92, C.line, false, 0.5);
    circle(g, x + Math.cos(m) * 92, y + Math.sin(m) * 92, 5, C.muted, true);
  }
  // Right-hand panel: the mode, the clock in a rush, the perfect chain and the shield.
  drawSide(g) {
    const m = this.modeInfo();
    if (this.mode !== "standard") text(g, m.name, 862, 96, 20, C.cyan, "center");
    if (this.mode === "rush") {
      const k = Math.max(0, Math.min(1, this.clock / RUSH_TIME));
      text(g, Math.ceil(this.clock) + " s", 862, 130, 30, this.clock < 10 ? C.red : C.ink, "center");
      g.fillStyle = C.line; g.fillRect(812, 152, 100, 8);
      g.fillStyle = this.clock < 10 ? C.red : C.amber; g.fillRect(812, 152, 100 * k, 8);
    }
    const y = this.mode === "rush" ? 196 : 130;
    if (this.chain > 0) {
      text(g, "x" + this.chain, 862, y, 30, C.amber, "center");
      text(g, "PERFECT", 862, y + 28, 16, C.muted, "center");
      // Pips toward the next shield.
      for (let i = 0; i < SHIELD_CHAIN; i++) circle(g, 832 + i * 20, y + 54, 5, i < this.chain % SHIELD_CHAIN || (this.shield && this.chain >= SHIELD_CHAIN) ? C.amber : C.line, true);
    }
    if (this.shield) text(g, "SHIELD", 862, y + 82, 18, C.cyan, "center");
  }
  // Rank, today's order, the mode and one feat at a time (title screen).
  drawGoals(g, y) {
    const sv = this.sv, n = sv.ft.length, key = this.dayKey(), next = nextRank(ORBIT_RANKS, n);
    const open = this.modesOpen(), rows = open ? 5 : 4;
    panel(g, y - 22, y + 30 * rows + 8);
    text(g, "RANK " + rankOf(ORBIT_RANKS, n) + "   FEATS " + n + " / " + ORBIT_FEATS.length + (next ? "   NEXT RANK AT " + next[0] : ""), 480, y, 18, C.ink, "center");
    const streak = liveStreak(sv.dl, key);
    text(g, (dailyDone(sv.dl, key) ? "TODAY'S ORDER MET" : "TODAY: " + orbitOrder(key).text) + (streak > 1 ? "   STREAK " + streak : ""), 480, y + 28, 18, dailyDone(sv.dl, key) ? C.cyan : C.amber, "center");
    let row = y + 56;
    if (open) {
      const m = this.modeInfo(), best = this.mode === "standard" ? sv.st.best : sv.mb[this.mode];
      text(g, "MODE " + m.name + (best ? "  BEST " + best : "") + "   HOLD: NEXT MODE", 480, row, 18, C.cyan, "center");
      row += 28;
    } else {
      const m = ORBIT_MODES[1];
      text(g, m.name + " MODE: " + m.how, 480, row, 16, C.muted, "center");
      row += 26;
    }
    drawFeatTicker(g, ORBIT_FEATS, sv.ft, this.t, row + 6);
  }
  // The result: one banner line, then at most four short lines that always fit above the hint line.
  drawResult(g) {
    const standard = this.mode === "standard", best0 = standard ? this.best0 : this.modeBest0 || 0;
    const title = this.mode === "rush" ? "TIME" : "SIGNAL LOST";
    banner(g, title, `${standard ? "" : this.modeInfo().name + ": "}${this.points} locks${this.points > best0 && this.points > 0 ? " · NEW BEST" : ""}`, C.amber);
    const lines = [];
    lines.push(["PERFECT " + this.R.perfects + "   BEST CHAIN " + this.R.chainMax + (this.R.dark ? "   DARK GATES " + this.R.dark : ""), C.ink]);
    if (this.orderMet) lines.push(["DAILY ORDER MET" + (this.sv.dl.streak > 1 ? " / STREAK " + this.sv.dl.streak : ""), C.cyan]);
    else lines.push(["TODAY: " + orbitOrder(this.dayKey()).text, C.muted]);
    if (this.fresh.length) {
      const names = this.fresh.map((id) => ORBIT_FEATS.find((f) => f.id === id).name);
      lines.push([(names.length > 1 ? "NEW FEATS: " : "NEW FEAT: ") + names.slice(0, 2).join(", ") + (names.length > 2 ? " +" + (names.length - 2) : ""), C.amber]);
    } else {
      const close = closestFeat(ORBIT_FEATS, this.sv.ft, this);
      if (close) lines.push([close, C.muted]);
    }
    if (this.modesOpen()) lines.push(["TAP: PLAY " + this.modeInfo().name + "   HOLD: NEXT MODE", C.cyan]);
    panel(g, 362, 374 + lines.length * 28);
    lines.forEach(([s, col], i) => text(g, s, 480, 384 + i * 28, 18, col, "center"));
  }
}
