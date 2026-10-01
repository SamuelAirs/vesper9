import { TAU, clamp } from "../engine/math.js";
import { C, line, circle, space, banner, glyph } from "../engine/draw.js";
import { LAMP, fill, only, spot, blink, dim } from "../engine/lightshow.js";
import { GestureGuard, LampBus, lampMax, announce, drawNote } from "./game-kit.js";

export function nextGate(center, points, rng) {
  // Columns are at least 1.75 s apart; the centre moves by at most 85 px, less at the start.
  const reach = Math.min(85, 45 + points * 2);
  const base = clamp(center + rng.range(-reach, reach), 165, 375);
  // From the tenth passage the opening drifts up and down around its base.
  const amp = Math.min(70, Math.max(0, (points - 9) * 3));
  return { x: 1010, center: base, base, amp, phase: rng.range(0, TAU), age: 0,
    gap: Math.max(100, 270 - points * 3.4), passed: false };
}
// ---------------------------------------------------------------------------------------------
export const undertowSpeed = (points) => 170 + Math.min(points * 3.5, 150);
const UNDERTOW_Y = [22, 518];
export class Undertow {
  constructor(ctx) {
    this.c = ctx;
    this.lamps = new LampBus(ctx);
    this.guard = new GestureGuard(this, ctx, ["y", "vy", "held", "gates", "next", "lastCenter", "reason", "points", "trail", "hull", "grace", "best0"]);
    this.reset();
  }
  reset() {
    this.phase = "title";
    this.ended = null;
    this.overAt = 0;
    this.y = 270;
    this.vy = 0;
    this.held = false;
    this.gates = [];
    this.next = 1.4;
    this.lastCenter = 270;
    this.reason = "";
    this.points = 0;
    this.hull = 2;    // a column or a boundary costs one; another is earned every 12 passages (at most three)
    this.grace = 0;
    this.best0 = this.c.best?.() ?? 0;
    this.note = ""; this.noteT = 0;
    this.t = 0;
    this.trail = [];
    this.c.hint("Hold to rise. Release to sink. Pass through the openings.");
  }
  down() {
    this.guard.mark();
    if (this.phase !== "play") {
      if (this.guard.locked()) return;
      this.guard.stash();
      this.reset();
      this.phase = "play";
    }
    this.held = true;
  }
  up() {
    this.held = false;
    this.guard.release();
  }
  cancel() {
    this.guard.rewind();
    this.held = false;
    this.lamps.clear();
  }
  pause() {
    this.guard.settle();
    if (this.phase === "play" && this.points > 0) this.c.score(this.points);
    this.lamps.sleep();
  }
  resume() { this.lamps.wake(); }
  dispose() { this.pause(); }
  // A column or boundary hit costs one hull point and gives a moment of grace; the last one ends the run.
  hit(reason) {
    if (this.phase !== "play" || this.grace > 0) return;
    this.reason = reason;
    if (this.hull > 1) {
      this.hull--; this.grace = 1.4;
      this.c.tone(120, 0.25, "triangle");
      announce(this, "HULL BREACH", 1.6);
      this.lamps.flash(0.4, () => fill(LAMP.red, 0.7));
      return;
    }
    this.die(reason);
  }
  die(reason = "COLUMN CONTACT") {
    if (this.phase !== "play") return;
    this.reason = reason;
    this.held = false;
    this.hull = 0;
    this.guard.end([this.points], { passages: this.points, reason, milestone: Math.floor(this.points / 5) });
    this.c.tone(80, 0.35, "triangle");
    this.lamps.flash(0.6, (e, T) => fill(LAMP.red, 0.6 * (1 - e / T)));
  }
  // The craft is a cyan spot at its depth; the next opening is an amber spot that brightens as it
  // arrives, so the two coincide when you are lined up. Near the surface or the floor the end
  // lamp pulses red.
  lampValues() {
    const at = (y) => clamp((y - UNDERTOW_Y[0]) / (UNDERTOW_Y[1] - UNDERTOW_Y[0]), 0, 1);
    let out = spot(at(this.y), dim(LAMP.cyan, 0.33));
    const gate = this.gates.find((q) => q.x + 65 > 202);
    if (gate) {
      const eta = Math.max(0, gate.x - 202) / undertowSpeed(this.points);
      out = lampMax(out, spot(at(gate.center), dim(LAMP.amber, 0.12 + 0.2 * clamp(1 - eta / 2.2, 0, 1))));
    }
    if (this.grace > 0) return lampMax(out, fill(LAMP.red, 0.3 * blink(this.grace, 6)));
    if (this.y < 70 || this.y > 470) {
      const alarm = only(this.y < 70 ? 0 : 2, LAMP.red, 0.15 + 0.6 * blink(this.t, 4));
      out = lampMax(out, alarm);
    }
    return out;
  }
  update(dt) {
    this.t += dt;
    this.guard.tick(dt);
    if (this.noteT > 0) this.noteT -= dt;
    if (this.phase === "play") {
      this.grace = Math.max(0, this.grace - dt);
      this.vy = clamp(this.vy + (this.held ? -620 : 440) * dt, -255, 255);
      this.y += this.vy * dt;
      this.next -= dt;
      if (this.next <= 0) {
        const gate = nextGate(this.lastCenter, this.points, this.c.rng);
        this.lastCenter = gate.base;
        this.gates.push(gate);
        this.next = Math.max(1.75, 2.35 - this.points * 0.02);
      }
      const speed = undertowSpeed(this.points);
      for (const gate of this.gates) {
        gate.x -= speed * dt;
        gate.age += dt;
        if (gate.amp) gate.center = gate.base + gate.amp * Math.sin(gate.phase + gate.age * 0.9);
        // Credit once the craft's column is clear of the gate (the collision test below ends at 202).
        if (gate.x + 65 < 202 && !gate.passed) {
          gate.passed = true;
          this.points++;
          this.c.tone(550, 0.14);
          this.lamps.flash(0.1, (e, T, a) => lampMax(a, only(1, LAMP.green, 0.8)));
          if (this.points === 10) announce(this, "THE OPENINGS DRIFT");
          if (this.points === 20) announce(this, "NARROWER CHANNEL");
          if (this.points === 32) announce(this, "THE CURRENT QUICKENS");
          if (this.points === 45) announce(this, "THE CHANNEL PINCHES");
          if (this.points % 12 === 0 && this.hull < 3) { this.hull++; announce(this, "HULL REPAIRED"); }
        }
        if (
          gate.x < 246 &&
          gate.x + 65 > 202 &&
          (this.y - 14 < gate.center - gate.gap / 2 ||
            this.y + 14 > gate.center + gate.gap / 2)
        )
          this.hit("COLUMN CONTACT");
      }
      this.gates = this.gates.filter((o) => o.x > -90);
      if (this.y < UNDERTOW_Y[0] || this.y > UNDERTOW_Y[1]) {
        const top = this.y < UNDERTOW_Y[0];
        this.hit(top ? "SURFACE LIMIT / RELEASE TO DESCEND" : "DEPTH LIMIT / HOLD TO ASCEND");
        if (this.phase === "play") { this.y = clamp(this.y, UNDERTOW_Y[0] + 4, UNDERTOW_Y[1] - 4); this.vy = 0; }
      }
      this.trail.unshift({ x: 220, y: this.y });
      if (this.trail.length > 40) this.trail.pop();
      for (const p of this.trail) p.x -= speed * dt;
    }
    this.lamps.frame(dt, this.phase === "play" ? this.lampValues() : null);
    this.c.hud([
      ["PASSAGES", this.points],
      ["HULL", this.hull ? "◇".repeat(this.hull) : "0"],
      ["THRUST", this.held ? "ASCEND" : "DRIFT"],
      ["BEST", this.c.best()],
    ]);
  }
  draw(g) {
    space(g, this.t, 0.45);
    for (let i = 0; i < 8; i++) {
      g.beginPath();
      g.strokeStyle = "#1e3832";
      g.lineWidth = 1;
      for (let x = 0; x <= 960; x += 8) {
        const y = 60 + i * 65 + Math.sin(x / 100 + this.t * 0.3 + i) * 14;
        x ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    }
    for (const gate of this.gates) {
      const top = gate.center - gate.gap / 2,
        bottom = gate.center + gate.gap / 2;
      g.fillStyle = "#264a3e";
      g.fillRect(gate.x, 0, 65, top);
      g.fillRect(gate.x, bottom, 65, 540 - bottom);
      line(g, gate.x, top, gate.x + 65, top, C.cyan, 3);
      line(g, gate.x, bottom, gate.x + 65, bottom, C.cyan, 3);
      for (let y = 25; y < 540; y += 40)
        if (y < top - 10 || y > bottom + 10)
          glyph(g, 2, gate.x + 32, y, 10, "#548774");
    }
    this.trail.forEach((p, i) => {
      g.globalAlpha = (1 - i / 40) * 0.5;
      circle(g, p.x, p.y, 2, C.cyan, true);
    });
    g.globalAlpha = this.grace > 0 && Math.floor(this.grace * 10) % 2 ? 0.35 : 1;
    g.save();
    g.translate(220, this.y);
    g.rotate(this.vy * 0.0015);
    g.fillStyle = C.cyan;
    g.beginPath();
    g.moveTo(25, 0);
    g.lineTo(-15, -13);
    g.lineTo(-9, 0);
    g.lineTo(-15, 13);
    g.closePath();
    g.fill();
    circle(g, 0, 0, 4, C.bg, true);
    if (this.held) {
      g.strokeStyle = C.amber;
      g.beginPath();
      g.moveTo(-12, 7);
      g.lineTo(-30, 16 + Math.sin(this.t * 40) * 5);
      g.stroke();
    }
    g.restore();
    g.globalAlpha = 1;
    drawNote(g, this);
    if (this.phase === "title")
      banner(
        g,
        "UNDERTOW",
        "Hold to rise. Release to sink. Follow the silent current.",
        C.cyan,
      );
    if (this.phase === "over")
      banner(
        g,
        "PRESSURE LIMIT",
        `${this.points} passages${this.points > this.best0 ? " / NEW BEST" : ""} / ${this.reason}`,
        C.cyan,
      );
  }
}

