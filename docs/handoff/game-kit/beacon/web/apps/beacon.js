// BEACON — the reference cartridge for docs/GAME-KIT. A light sweeps back and forth across the three
// lamps (and across the screen). Press while it is on the middle lamp to bank a signal; the sweep speeds
// up with every catch. A press away from the middle costs one of three lives. Save schema 1.
import { C, space, text, circle, banner } from "../engine/draw.js";
import { clamp } from "../engine/math.js";
import { LAMP, spot, fill, dim, lamps } from "../engine/lightshow.js";
import { AppGuard } from "../engine/input.js";
import { LampBus } from "./game-kit.js";

const LOCKOUT = 0.6;   // a result screen ignores presses this long, so rhythm tapping cannot skip it
const LIVES = 3;
export const WINDOW = 0.11;                       // half-width of the catch zone, as a fraction of the sweep
export const speedAt = (catches) => 0.55 + Math.min(catches, 40) * 0.025;  // sweeps per second

// The console-wide timing offset (Calibration). Positive when presses register late. 0 when absent.
const latency = (ctx) => {
  const v = Number(ctx.settings?.()?.latencyMs);
  return Number.isFinite(v) ? clamp(v, -150, 300) / 1000 : 0;
};

// Bring whatever is stored (nothing, an older schema, junk) to schema 1. Never throw.
export function migrateSave(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const n = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  return {
    schema: 1,
    runs: n(r.runs),                                   // read by the host: field record, dashboard card
    milestone: n(r.milestone),                         // read by the host: field record
    last: r.last && typeof r.last === "object" ? r.last : {},  // read by the host: field record
    bestStreak: n(r.bestStreak),                       // this game's own
  };
}

export class Beacon {
  constructor(ctx) {
    this.c = ctx;
    this.lamps = new LampBus(ctx);                   // class instance: AppGuard leaves it alone
    this.sv = migrateSave(ctx.progress?.());
    this.t = 0;
    this.title();
    // Last line of the constructor: AppGuard snapshots every plain-data field from here on.
    this.guard = new AppGuard(this, ctx);
  }
  title() {
    this.phase = "title";
    this.pos = 0.5; this.dir = 1; this.catches = 0; this.lives = LIVES; this.streak = 0;
    this.flash = 0; this.miss = 0; this.overAt = 0;
    this.c.hint("Press while the light is on the middle lamp.");
  }
  start() {
    this.title();
    this.phase = "play";
    this.pos = 0; this.dir = 1;
  }
  // Where the light was when the player actually pressed, allowing for the timing offset.
  posAt(secondsAgo) {
    let p = this.pos - this.dir * speedAt(this.catches) * 2 * secondsAgo, d = this.dir;
    if (p < 0) { p = -p; d = -d; }
    if (p > 1) { p = 2 - p; d = -d; }
    return p;
  }
  down() {
    this.guard.mark();                                 // first line of down(): snapshot before anything changes
    if (this.phase === "title") { this.start(); return; }
    if (this.phase === "over") {
      if (this.t - this.overAt >= LOCKOUT) this.start();
      return;
    }
    const off = Math.abs(this.posAt(latency(this.c)) - 0.5);
    if (off <= WINDOW) {
      this.catches++; this.streak++; this.flash = 0.25;
      this.c.tone(440 + 40 * Math.min(this.catches, 20), 0.08, "triangle");
      this.lamps.flash(0.2, () => fill(LAMP.green));
    } else {
      this.lives--; this.streak = 0; this.miss = 0.4;
      this.c.tone(110, 0.2, "sawtooth");
      this.lamps.flash(0.35, () => fill(LAMP.red, 0.6));
      if (this.lives <= 0) this.end();
    }
    this.sv.bestStreak = Math.max(this.sv.bestStreak, this.streak);
  }
  up() { this.guard.release(); }
  end() {
    this.phase = "over"; this.overAt = this.t;
    const score = this.catches * 100;
    this.sv.runs++;
    this.sv.milestone = Math.max(this.sv.milestone, Math.floor(this.catches / 10));
    this.sv.last = { score, catches: this.catches, milestone: Math.floor(this.catches / 10) };
    this.c.score(score);                               // AppGuard holds this back while a gesture could still complete
    this.c.saveProgress(JSON.parse(JSON.stringify(this.sv)))?.catch?.(this.c.error);
  }
  cancel() {
    this.guard.rewind();                              // undoes the menu gesture's own taps, if that is what this was
    this.lamps.clear();
  }
  update(dt) {
    this.guard.tick(dt);
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt); this.miss = Math.max(0, this.miss - dt);
    if (this.phase === "play") {
      this.pos += this.dir * speedAt(this.catches) * 2 * dt;
      if (this.pos > 1) { this.pos = 2 - this.pos; this.dir = -1; }
      if (this.pos < 0) { this.pos = -this.pos; this.dir = 1; }
    }
    this.c.hud([["CAUGHT", this.catches], ["LIVES", "◆".repeat(Math.max(0, this.lives))], ["BEST", this.c.best()]]);
    // Resting picture: the moving light, plus a dim green marker on the middle lamp as the target.
    const rest = this.phase === "play"
      ? spot(this.pos, LAMP.amber).map((v, i) => Math.max(v, lamps(null, dim(LAMP.green, 0.15), null)[i]))
      : lamps(null, dim(LAMP.amber, 0.25 + 0.25 * Math.sin(this.t * 3)), null);
    this.lamps.frame(dt, rest);
  }
  draw(g) {
    space(g, this.t, 0.4);
    const x0 = 180, x1 = 780, y = 300;
    g.save();
    g.fillStyle = C.dark; g.fillRect(480 - WINDOW * (x1 - x0), y - 40, 2 * WINDOW * (x1 - x0), 80);
    g.restore();
    for (let i = 0; i < 3; i++) circle(g, x0 + i * (x1 - x0) / 2, y, 26, i === 1 ? C.cyan : C.line);
    if (this.phase === "play") circle(g, x0 + this.pos * (x1 - x0), y, 14, this.miss > 0 ? C.red : C.amber, true);
    if (this.flash > 0) circle(g, 480, y, 26 + 120 * (0.25 - this.flash), C.ink);
    if (this.phase === "title") banner(g, "BEACON", "Press while the light is on the middle lamp. Press to begin.");
    if (this.phase === "over") banner(g, "SIGNAL LOST", this.catches + " caught · best streak " + this.sv.bestStreak, C.amber);
    text(g, "STREAK " + this.streak, 480, 420, 18, C.muted, "center");
  }
  pause() { this.guard.settle(); this.lamps.sleep(); }
  resume() { this.lamps.wake(); }
  dispose() { this.guard.settle(); this.lamps.sleep(); }
}
