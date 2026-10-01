import { TAU, clamp, wrapAngle } from "../engine/math.js";
import { C, text, line, circle, space, banner, glyph } from "../engine/draw.js";
import { LAMP, lamps, fill, only, dim } from "../engine/lightshow.js";
import { GestureGuard, LampBus, lampMax, announce, drawNote } from "./game-kit.js";

// ---------------------------------------------------------------------------------------------
const ORBIT_AHEAD_MAX = 4.5;
// Half-width of the gate (radians) and angular speed. Both keep changing for the whole run: the
// gate narrows until 40 locks and the satellite speeds up until 45.
export const orbitWindow = (points) => Math.max(0.08, 0.5 - points * 0.0105);
export const orbitSpeed = (points) => 1.15 + Math.min(points, 45) * 0.05;
const HULL_COLOR = [LAMP.red, LAMP.red, LAMP.amber, LAMP.green];
export class OrbitLock {
  constructor(ctx) {
    this.c = ctx;
    this.lamps = new LampBus(ctx);
    this.guard = new GestureGuard(this, ctx, ["angle", "target", "points", "lives", "flash", "feedback", "dir", "drift", "miss", "best0", "idle"]);
    this.reset();
  }
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
    this.best0 = this.c.best?.() ?? 0;
    this.note = ""; this.noteT = 0;
    this.feedback = "ACQUIRE THE AMBER GATE";
    this.t = 0;
    this.c.hint("Press when the satellite crosses the illuminated gate.");
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
    if (Math.abs(wrapAngle(this.angle - this.target)) < orbitWindow(this.points)) {
      this.points++;
      const p = this.points, sector = Math.floor(p / 5) + 1;
      this.feedback = p % 5 === 0 ? "SECTOR " + sector + " / ARRAY EXPANDS" : "SIGNAL LOCKED";
      const news = [];
      if (p % 5 === 0 && p >= 10) { this.dir = -this.dir; news.push("THE ORBIT REVERSES"); }
      if (p === 20) news.push("THE GATE NOW DRIFTS");
      if (p % 10 === 0 && this.lives < 3) { this.lives++; news.push("HULL REPAIRED"); }
      if (news.length) announce(this, news.join(" / "));
      this.drift = p >= 20 ? this.c.rng.range(-0.3, 0.3) : 0;
      this.target += this.dir * this.c.rng.range(1.2, ORBIT_AHEAD_MAX);
      this.c.tone(400 + Math.min(p, 45) * 22, 0.13);
      this.flash = 0.18; this.miss = null; this.idle = 0;
      if (p % 5 === 0) this.lamps.flash(0.4, () => fill(LAMP.white, 0.7));
      else this.lamps.flash(0.15, (e, T, a) => lampMax(a, fill(LAMP.green, 0.55)));
    } else {
      // The next gate is placed up to 4.5 rad ahead, so "early" covers that whole arc; a satellite
      // that has just gone past the gate is nearly a full turn from it.
      const early = this.ahead() <= ORBIT_AHEAD_MAX + 0.1;
      this.feedback = early ? "EARLY / WAIT FOR THE GATE" : "LATE / CATCH THE NEXT ORBIT";
      this.c.tone(95, 0.2, "sawtooth");
      // The lamp on the side of the error flashes: left when early, right when late.
      this.loseHull(early ? "early" : "late");
    }
  }
  loseHull(kind) {
    this.lives--;
    this.flash = 0.3; this.miss = kind;
    this.lamps.flash(0.3, () => (kind === "early" ? only(0, LAMP.red, 0.8) : kind === "late" ? only(2, LAMP.red, 0.8) : fill(LAMP.red, 0.6)));
    if (!this.lives) {
      this.guard.end([this.points], { locks: this.points, milestone: Math.floor(this.points / 5) });
      this.lamps.flash(0.6, (e, T) => fill(LAMP.red, 0.6 * (1 - e / T)));
    }
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
  dispose() { this.pause(); }
  // Left lamp: amber ramp as the satellite nears the gate, bright while it is inside; middle:
  // hull (green, amber, red); right: progress through the sector in cyan.
  lampValues() {
    const p = this.points, inside = Math.abs(wrapAngle(this.angle - this.target)) < orbitWindow(p);
    const rate = Math.max(0.5, orbitSpeed(p) - this.drift * this.dir);
    const near = clamp(1 - this.ahead() / rate / 1.2, 0, 1);
    const left = dim(LAMP.amber, inside ? 0.9 : 0.33 * near);
    return lamps(left, dim(HULL_COLOR[this.lives], 0.25), dim(LAMP.cyan, [0, 0.1, 0.17, 0.25, 0.33][p % 5]));
  }
  update(dt) {
    this.t += dt;
    this.guard.tick(dt);
    if (this.phase === "play") {
      this.angle += this.dir * dt * orbitSpeed(this.points);
      this.target += this.drift * dt;
      if ((this.idle += dt) >= 10) {
        this.idle = 0;
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
      ["HULL", this.lives ? "◇".repeat(this.lives) : "0"],
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
    circle(g, x, y, 67, C.line);
    glyph(g, 4, x, y, 30, C.muted);
    g.strokeStyle = this.flash > 0 && this.miss ? C.red : C.amber;
    g.lineWidth = 16;
    g.beginPath();
    const a = orbitWindow(this.points);
    g.arc(x, y, r, this.target - a, this.target + a);
    g.stroke();
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
    if (this.phase === "play") text(g, this.feedback, 480, 503, 24, C.ink, "center");
    drawNote(g, this);
    if (this.phase === "title")
      banner(
        g,
        "ORBIT LOCK",
        "Align the wandering satellite. Press inside the gate.",
      );
    if (this.phase === "over")
      banner(
        g,
        "SIGNAL LOST",
        `${this.points} locks acquired${this.points > this.best0 ? " / NEW BEST" : ""}`,
        C.amber,
      );
  }
}

