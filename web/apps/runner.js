import { clamp, overlaps } from "../engine/math.js";
import { C, text, line, circle, space, banner } from "../engine/draw.js";
import { LAMP, lamps, fill, only, meter, ramp, blink, dim } from "../engine/lightshow.js";
import { GestureGuard, LampBus, lampMax, announce, drawNote } from "./game-kit.js";

// ---------------------------------------------------------------------------------------------
// Moonrunner obstacles. STONE is the gentle opener; WALL and MESA cannot be cleared by a tap, so
// holding for height is a real part of the game from the sixth relic.
export const RUNNER_SHAPES = {
  STONE: { w: 44, h: 30, name: "STONE", to: { w: 44, h: 30 } },
  SPIRE: { w: 32, h: 76, name: "SPIRE", to: { w: 36, h: 88 } },
  RIDGE: { w: 76, h: 45, name: "RIDGE", to: { w: 150, h: 58 } },
  CRYSTAL: { w: 48, h: 62, name: "CRYSTAL", to: { w: 64, h: 76 } },
  WALL: { w: 36, h: 112, name: "WALL", hold: true, to: { w: 36, h: 128 } },
  MESA: { w: 190, h: 40, name: "MESA", hold: true, to: { w: 250, h: 46 } },
};
// A shape starts at its listed size and grows towards `to` over the first ninety relics, which
// narrows the window in which a tap (or a hold) clears it, so precision matters more and more.
export function runnerObstacle(rng, points) {
  const S = RUNNER_SHAPES;
  const pool = points < 3 ? [S.STONE]
    : points < 6 ? [S.STONE, S.RIDGE, S.CRYSTAL, S.SPIRE]
    : points < 14 ? [S.STONE, S.RIDGE, S.CRYSTAL, S.SPIRE, S.WALL]
    : [S.RIDGE, S.CRYSTAL, S.SPIRE, S.WALL, S.MESA];
  const { to, ...shape } = pool[rng.int(0, pool.length - 1)], k = Math.min(points, 90) / 90;
  return { x: 1020, ...shape, w: Math.round(shape.w + (to.w - shape.w) * k),
    h: Math.round(shape.h + (to.h - shape.h) * k), passed: false };
}
export const runnerSpeed = (points) => 250 + Math.min(points * 5, 150);
// Seconds until the next obstacle appears: it tightens with relics, and a jump that needed a hold
// leaves extra room to land.
export function runnerSpacing(rng, points, last) {
  const low = Math.max(1.2, 2.6 - points * 0.05);
  return rng.range(low, low + 0.6) + (last?.hold ? 0.5 : 0);
}
// ---------------------------------------------------------------------------------------------
const SHAPE_LAMP = { STONE: LAMP.green, SPIRE: LAMP.cyan, RIDGE: LAMP.amber, CRYSTAL: [200, 40, 160],
  WALL: LAMP.white, MESA: LAMP.violet };
export class Moonrunner {
  constructor(ctx) {
    this.c = ctx;
    this.lamps = new LampBus(ctx);
    this.guard = new GestureGuard(this, ctx, ["y", "vy", "held", "obstacles", "distance", "points", "next", "grounded", "coyote", "buffer", "shield", "grace", "lastShape", "best0"]);
    this.reset();
  }
  reset() {
    this.phase = "title";
    this.ended = null;
    this.overAt = 0;
    this.y = 386;
    this.vy = 0;
    this.held = false;
    this.obstacles = [];
    this.distance = 0;
    this.points = 0;
    this.next = 1.2;
    this.grounded = true;
    this.coyote = 0.08;
    this.buffer = 0;
    this.shield = 2;   // two free collisions; one is earned back every 12 relics (never more than two)
    this.grace = 0;    // seconds of invulnerability after a shielded collision
    this.lastShape = null;
    this.best0 = this.c.best?.() ?? 0;
    this.note = ""; this.noteT = 0;
    this.t = 0;
    this.c.hint("Tap to jump. Hold for a higher, longer jump.");
  }
  get speed() { return runnerSpeed(this.points); }
  down() {
    this.guard.mark();
    if (this.phase !== "play") {
      if (this.guard.locked()) return;
      this.guard.stash();
      this.reset();
      this.phase = "play";
    }
    this.held = true;
    this.buffer = 0.12;
    this.jump();
  }
  up() {
    this.held = false;
    this.guard.release();
  }
  cancel() {
    this.guard.rewind();
    this.held = false;
    this.buffer = 0;
    this.lamps.clear();
  }
  pause() {
    this.guard.settle();
    if (this.phase === "play" && this.distance >= 1) this.c.score(Math.floor(this.distance));
    this.lamps.sleep();
  }
  resume() { this.lamps.wake(); }
  dispose() { this.pause(); }
  jump() {
    if (this.buffer > 0 && this.coyote > 0) {
      this.vy = -535;
      this.grounded = false;
      this.coyote = 0;
      this.buffer = 0;
      this.c.tone(180, 0.11, "triangle");
    }
  }
  // Dim speed colour (green, amber, red) on all lamps; as the next obstacle closes the lamps fill
  // left to right in its colour and go bright for the last half second, when the jump is due.
  lampValues() {
    const speed = this.speed;
    const base = dim(ramp((speed - 250) / 260, [LAMP.green, LAMP.amber, LAMP.red]), 0.16);
    if (this.grace > 0) return fill(LAMP.amber, 0.33 * blink(this.grace, 6));
    const o = this.obstacles.find((q) => !q.passed && q.x + q.w >= 190);
    if (!o) return lamps(base, base, base);
    const contact = (o.x - 228) / speed;
    const color = SHAPE_LAMP[o.name] || LAMP.cyan;
    return meter(clamp(1.25 - contact / 1.2, 0, 1), dim(color, contact < 0.6 ? 0.85 : 0.33), base);
  }
  update(dt) {
    this.t += dt;
    this.guard.tick(dt);
    if (this.noteT > 0) this.noteT -= dt;
    if (this.phase !== "play") {
      this.lamps.frame(dt, null);
      this.c.hud([
        ["DISTANCE", Math.floor(this.distance) + " m"],
        ["BEST", this.c.best()],
      ]);
      return;
    }
    const speed = this.speed;
    this.grace = Math.max(0, this.grace - dt);
    this.distance += (speed * dt) / 25;
    this.buffer = Math.max(0, this.buffer - dt);
    this.coyote = Math.max(0, this.coyote - dt);
    this.vy += (this.held && this.vy < 0 ? 800 : 1550) * dt;
    this.y += this.vy * dt;
    if (this.y >= 386) {
      this.y = 386;
      this.vy = 0;
      this.grounded = true;
      this.coyote = 0.08;
      this.jump();
    }
    this.next -= dt;
    if (this.next <= 0) {
      const o = runnerObstacle(this.c.rng, this.points);
      this.obstacles.push(o);
      this.next = runnerSpacing(this.c.rng, this.points, o);
      this.lastShape = o.name;
    }
    for (const o of this.obstacles) {
      o.x -= speed * dt;
      if (!o.passed && o.x + o.w < 190) {
        o.passed = true;
        this.points++;
        this.c.tone(620, 0.045);
        this.lamps.flash(0.08, (e, T, a) => lampMax(a, only(1, LAMP.white, 0.8)));
        if (this.points === 3) announce(this, "RIDGES AND SPIRES AHEAD");
        if (this.points === 6) announce(this, "TALL WALLS: HOLD TO CLEAR");
        if (this.points === 14) announce(this, "LONG MESAS: HOLD AND GLIDE");
        if (this.points % 12 === 0 && this.shield < 2) { this.shield++; announce(this, "SHIELD RESTORED"); }
      }
      if (
        !o.hit && overlaps(
          { x: 196, y: this.y + 5, w: 26, h: 34 },
          { x: o.x + 5, y: 430 - o.h + 6, w: o.w - 10, h: o.h - 6 },
        )
      ) {
        if (this.grace > 0) continue;
        if (this.shield > 0) {
          this.shield--; this.grace = 1.3; o.hit = true;
          this.c.tone(140, 0.25, "sawtooth");
          announce(this, "SHIELD LOST", 1.6);
          this.lamps.flash(0.35, () => fill(LAMP.amber, 0.7));
          continue;
        }
        this.guard.end([Math.floor(this.distance)], { metres: Math.floor(this.distance), relics: this.points, milestone: Math.floor(this.distance / 100) });
        this.c.tone(70, 0.4, "sawtooth");
        this.lamps.flash(0.6, (e, T) => fill(LAMP.red, 0.6 * (1 - e / T)));
        break;
      }
    }
    this.obstacles = this.obstacles.filter((o) => o.x > -250);
    this.lamps.frame(dt, this.phase === "play" ? this.lampValues() : null);
    this.c.hud([
      ["DISTANCE", Math.floor(this.distance) + " m"],
      ["RELICS", this.points],
      ["SHIELD", this.shield ? "◆".repeat(this.shield) : "0"],
      ["BEST", this.c.best()],
    ]);
  }
  draw(g) {
    space(g, this.t);
    circle(g, 730, 116, 60, "#233c2b", true);
    circle(g, 714, 109, 56, C.bg, true);
    for (let layer = 0; layer < 2; layer++) {
      g.fillStyle = layer ? "#1f3525" : "#14271c";
      g.beginPath();
      g.moveTo(0, 430);
      for (let i = -1; i < 12; i++) {
        const x = i * 110 - ((this.distance * (layer ? 4 : 1.5)) % 110);
        g.lineTo(x, 360 + Math.sin(i * 2.3 + layer) * 45);
        g.lineTo(x + 45, 300 + Math.cos(i * 3.2) * 60);
      }
      g.lineTo(960, 430);
      g.fill();
    }
    line(g, 0, 430, 960, 430, C.ink, 2);
    for (let i = 0; i < 20; i++) {
      const x = (i * 60 - this.distance * 15) % 1000;
      line(g, x, 445, x + 18, 445, C.line);
    }
    for (const o of this.obstacles) {
      g.fillStyle = o.hold ? "#5a5030" : "#385a3c";
      g.strokeStyle = o.hold ? C.amber : C.ink;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(o.x, 430);
      if (o.hold) {
        g.lineTo(o.x + o.w * 0.06, 430 - o.h);
        g.lineTo(o.x + o.w * 0.94, 430 - o.h);
      } else {
        g.lineTo(o.x + o.w * 0.2, 430 - o.h * 0.7);
        g.lineTo(o.x + o.w * 0.5, 430 - o.h);
      }
      g.lineTo(o.x + o.w, 430);
      g.closePath();
      g.fill();
      g.stroke();
      if (!o.hold) line(g, o.x + o.w * 0.5, 430 - o.h, o.x + o.w * 0.6, 430, C.muted);
      if (o.hold && !o.passed && o.x < 940) text(g, "HOLD", o.x + o.w / 2, 430 - o.h - 24, 22, C.amber, "center");
    }
    const bob =
      this.grounded && this.phase === "play" ? Math.sin(this.t * 20) * 2 : 0;
    g.globalAlpha = this.grace > 0 && Math.floor(this.grace * 10) % 2 ? 0.35 : 1;
    g.fillStyle = C.ink;
    g.fillRect(190, this.y + bob, 38, 35);
    g.fillStyle = C.bg;
    g.fillRect(211, this.y + 8 + bob, 13, 8);
    line(g, 201, this.y, 197, this.y - 15, C.ink, 2);
    circle(g, 197, this.y - 16, 3, C.amber, true);
    line(
      g,
      196,
      this.y + 36,
      192 + Math.sin(this.t * 18) * 5,
      this.y + 44,
      C.ink,
      3,
    );
    line(
      g,
      221,
      this.y + 36,
      225 - Math.sin(this.t * 18) * 5,
      this.y + 44,
      C.ink,
      3,
    );
    g.globalAlpha = 1;
    drawNote(g, this);
    if (this.phase === "title")
      banner(
        g,
        "MOONRUNNER",
        "Jump the crystal field. Tap for a hop, hold for height.",
      );
    if (this.phase === "over")
      banner(
        g,
        "EXPEDITION ENDED",
        `${Math.floor(this.distance)} metres${Math.floor(this.distance) > this.best0 ? " / NEW BEST" : ""}`,
        C.amber,
      );
  }
}

