import { TAU, clamp, wrapAngle, overlaps } from "../engine/math.js";
import {
  C,
  text,
  line,
  circle,
  diamond,
  space,
  grid,
  banner,
  glyph,
} from "../engine/draw.js";

export function recordRun(ctx, result) {
  const previous = ctx.progress?.() || {};
  ctx.saveProgress?.({ schema: 1, runs: (previous.runs || 0) + 1, last: result,
    milestone: Math.max(previous.milestone || 0, result.milestone || 0) })?.catch?.(ctx.error);
}
export function runnerObstacle(rng, points) {
  const shapes = [{ w: 32, h: 76, name: 'SPIRE' }, { w: 76, h: 45, name: 'RIDGE' }, { w: 48, h: 62, name: 'CRYSTAL' }];
  const index = points < 3 ? 2 : rng.int(0, 2);
  return { x: 1020, ...shapes[index], passed: false };
}
export function nextGate(center, points, rng) {
  // At least 2.25 seconds between columns; center changes by at most 85 px.
  return { x: 1010, center: clamp(center + rng.range(-85, 85), 165, 375),
    gap: Math.max(170, 225 - points * 2), passed: false };
}
export function reactionSummary(values) {
  if (!values.length) return { count: 0, median: null, best: null, mean: null };
  const sorted = values.slice().sort((a,b) => a-b), n = sorted.length;
  return { count: n, median: Math.round((sorted[Math.floor((n-1)/2)] + sorted[Math.floor(n/2)]) / 2),
    best: sorted[0], mean: Math.round(sorted.reduce((a,b) => a+b, 0) / n) };
}

export class OrbitLock {
  constructor(ctx) {
    this.c = ctx;
    this.reset();
  }
  reset() {
    this.phase = "title";
    this.angle = -Math.PI / 2;
    this.target = 0.5;
    this.points = 0;
    this.lives = 3;
    this.flash = 0;
    this.feedback = "ACQUIRE THE AMBER GATE";
    this.t = 0;
    this.c.hint("Press when the satellite crosses the illuminated gate.");
  }
  down() {
    if (this.phase !== "play") {
      this.reset();
      this.phase = "play";
      return;
    }
    const window = Math.max(0.16, 0.4 - this.points * 0.01);
    if (Math.abs(wrapAngle(this.angle - this.target)) < window) {
      this.points++;
      this.feedback = this.points % 5 === 0 ? "SECTOR " + (Math.floor(this.points / 5) + 1) + " / ARRAY EXPANDS" : "SIGNAL LOCKED";
      this.target += this.c.rng.range(1.2, 4.5);
      this.c.tone(400 + this.points * 22, 0.13);
      this.c.leds([30, 120, 20, 80, 180, 40, 30, 120, 20]);
      this.flash = 0.18;
    } else {
      this.lives--;
      this.feedback = wrapAngle(this.angle - this.target) < 0 ? "EARLY / WAIT FOR THE GATE" : "LATE / CATCH THE NEXT ORBIT";
      this.flash = 0.3;
      this.c.tone(95, 0.2, "sawtooth");
      this.c.leds([180, 25, 8, 0, 0, 0, 180, 25, 8]);
      if (!this.lives) {
        this.phase = "over";
        this.c.score(this.points);
        recordRun(this.c, { locks: this.points, milestone: Math.floor(this.points / 5) });
      }
    }
  }
  update(dt) {
    this.t += dt;
    if (this.phase === "play")
      this.angle += dt * (1.25 + Math.min(this.points, 25) * 0.07);
    if (this.flash > 0 && (this.flash -= dt) <= 0)
      this.c.leds([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    this.c.hud([
      ["SECTOR", Math.floor(this.points / 5) + 1],
      ["LOCKS", this.points],
      ["HULL", "◇".repeat(this.lives)],
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
    g.strokeStyle = C.amber;
    g.lineWidth = 16;
    g.beginPath();
    const a = Math.max(0.16, 0.4 - this.points * 0.01);
    g.arc(x, y, r, this.target - a, this.target + a);
    g.stroke();
    for (let i = 14; i >= 0; i--) {
      g.globalAlpha = (1 - i / 15) * 0.7;
      circle(
        g,
        x + Math.cos(this.angle - i * 0.028) * r,
        y + Math.sin(this.angle - i * 0.028) * r,
        i === 0 ? 8 : 2,
        C.ink,
        true,
      );
    }
    g.globalAlpha = 1;
    text(
      g,
      String(this.points).padStart(2, "0"),
      x,
      y + 95,
      26,
      C.ink,
      "center",
    );
    text(g, "PERIHELION ARRAY", 30, 30, 13, C.muted);
    text(g, this.feedback, 480, 503, 15, C.muted, "center");
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
        `${this.points} locks acquired / press to relaunch`,
        C.amber,
      );
  }
}
export class Moonrunner {
  constructor(ctx) {
    this.c = ctx;
    this.reset();
  }
  reset() {
    this.phase = "title";
    this.y = 386;
    this.vy = 0;
    this.held = false;
    this.obstacles = [];
    this.distance = 0;
    this.points = 0;
    this.next = 1.5;
    this.grounded = true;
    this.coyote = 0.08;
    this.buffer = 0;
    this.t = 0;
    this.c.hint("Tap to jump. Hold briefly for a higher jump.");
  }
  down() {
    if (this.phase !== "play") {
      this.reset();
      this.phase = "play";
    }
    this.held = true;
    this.buffer = 0.12;
    this.jump();
  }
  up() {
    this.held = false;
  }
  cancel() {
    this.held = false;
    this.buffer = 0;
  }
  jump() {
    if (this.buffer > 0 && this.coyote > 0) {
      this.vy = -535;
      this.grounded = false;
      this.coyote = 0;
      this.buffer = 0;
      this.c.tone(180, 0.11, "triangle");
    }
  }
  update(dt) {
    this.t += dt;
    if (this.phase !== "play") {
      this.c.hud([
        ["DISTANCE", Math.floor(this.distance) + " m"],
        ["BEST", this.c.best()],
      ]);
      return;
    }
    const speed = 290 + Math.min(this.points * 10, 160);
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
      this.obstacles.push(runnerObstacle(this.c.rng, this.points));
      this.next = this.c.rng.range(2.0, 2.5);

    }
    for (const o of this.obstacles) {
      o.x -= speed * dt;
      if (!o.passed && o.x + o.w < 190) {
        o.passed = true;
        this.points++;
        this.c.tone(620, 0.045);
      }
      if (
        overlaps(
          { x: 196, y: this.y + 5, w: 26, h: 34 },
          { x: o.x + 5, y: 430 - o.h + 6, w: o.w - 10, h: o.h - 6 },
        )
      ) {
        this.phase = "over";
        this.c.score(Math.floor(this.distance));
        this.c.tone(70, 0.4, "sawtooth");
        this.c.leds([160, 20, 0, 160, 20, 0, 160, 20, 0]);
        recordRun(this.c, { metres: Math.floor(this.distance), relics: this.points, milestone: Math.floor(this.distance / 100) });
        break;
      }
    }
    this.obstacles = this.obstacles.filter((o) => o.x > -100);
    this.c.hud([
      ["DISTANCE", Math.floor(this.distance) + " m"],
      ["RELICS", this.points],
      ["SECTOR", Math.floor(this.distance / 100) + 1],
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
      g.fillStyle = "#385a3c";
      g.strokeStyle = C.ink;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(o.x, 430);
      g.lineTo(o.x + o.w * 0.2, 430 - o.h * 0.7);
      g.lineTo(o.x + o.w * 0.5, 430 - o.h);
      g.lineTo(o.x + o.w, 430);
      g.closePath();
      g.fill();
      g.stroke();
      line(g, o.x + o.w * 0.5, 430 - o.h, o.x + o.w * 0.6, 430, C.muted);
    }
    const bob =
      this.grounded && this.phase === "play" ? Math.sin(this.t * 20) * 2 : 0;
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
    text(g, "MARE / 1979-B", 30, 30, 13, C.muted);
    text(
      g,
      "THE MOON DOES NOT REMEMBER YOUR FOOTSTEPS.",
      480,
      490,
      13,
      C.muted,
      "center",
    );
    if (this.phase === "title")
      banner(
        g,
        "MOONRUNNER",
        "Jump the crystal field. A longer hold carries you higher.",
      );
    if (this.phase === "over")
      banner(
        g,
        "EXPEDITION ENDED",
        `${Math.floor(this.distance)} metres / press to return to the surface`,
        C.amber,
      );
  }
}

export class Undertow {
  constructor(ctx) {
    this.c = ctx;
    this.reset();
  }
  reset() {
    this.phase = "title";
    this.y = 270;
    this.vy = 0;
    this.held = false;
    this.gates = [];
    this.next = 1.4;
    this.lastCenter = 270;
    this.reason = "";
    this.points = 0;
    this.t = 0;
    this.trail = [];
    this.c.hint("Hold to rise. Release to sink. Pass through the openings.");
  }
  down() {
    if (this.phase !== "play") {
      this.reset();
      this.phase = "play";
    }
    this.held = true;
    this.c.leds([0, 20, 30, 0, 70, 100, 0, 20, 30]);
  }
  up() {
    this.held = false;
    this.c.leds([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  }
  cancel() {
    this.up();
  }
  die(reason = "COLUMN CONTACT") {
    if (this.phase !== "play") return;
    this.phase = "over";
    this.reason = reason;
    this.held = false;
    this.c.score(this.points);
    recordRun(this.c, { passages: this.points, reason, milestone: Math.floor(this.points / 5) });
    this.c.tone(80, 0.35, "triangle");
  }
  update(dt) {
    this.t += dt;
    if (this.phase === "play") {
      this.vy = clamp(this.vy + (this.held ? -620 : 440) * dt, -255, 255);
      this.y += this.vy * dt;
      this.next -= dt;
      if (this.next <= 0) {
        const gate = nextGate(this.lastCenter, this.points, this.c.rng);
        this.lastCenter = gate.center;
        this.gates.push(gate);
        this.next = 2.25;
      }
      const speed = 180 + Math.min(this.points * 4, 80);
      for (const gate of this.gates) {
        gate.x -= speed * dt;
        if (gate.x < 210 && !gate.passed) {
          gate.passed = true;
          this.points++;
          this.c.tone(550, 0.14);
        }
        if (
          gate.x < 246 &&
          gate.x + 65 > 202 &&
          (this.y - 14 < gate.center - gate.gap / 2 ||
            this.y + 14 > gate.center + gate.gap / 2)
        )
          this.die();
      }
      this.gates = this.gates.filter((o) => o.x > -90);
      if (this.y < 22 || this.y > 518) this.die(this.y < 22 ? "SURFACE LIMIT / RELEASE TO DESCEND" : "DEPTH LIMIT / HOLD TO ASCEND");
      this.trail.unshift({ x: 220, y: this.y });
      if (this.trail.length > 40) this.trail.pop();
      for (const p of this.trail) p.x -= speed * dt;
    }
    this.c.hud([
      ["PASSAGES", this.points],
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
    g.globalAlpha = 1;
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
    text(g, "PELAGIC SURVEY / DEPTH UNKNOWN", 30, 30, 13, C.cyan);
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
        `${this.points} passages / ${this.reason} / press to descend`,
        C.cyan,
      );
  }
}

export class EchoVault {
  constructor(ctx) {
    this.c = ctx;
    this.reset();
  }
  reset() {
    this.phase = "title";
    this.sequence = [0, 1];
    this.entered = [];
    this.round = 0;
    this.feedback = "";
    this.index = 0;
    this.lit = false;
    this.wait = 0;
    this.active = -1;
    this.held = false;
    this.holdAt = 0;
    this.t = 0;
    this.c.hint("Watch the pulse pattern. Repeat short taps and longer holds.");
  }
  demonstrate() {
    this.phase = "show";
    this.index = 0;
    this.lit = false;
    this.wait = 0.6;
    this.entered = [];
    this.active = -1;
    this.c.hint("Receive the signal. Your turn follows the final pulse.");
  }
  down() {
    if (this.phase === "title" || this.phase === "over") {
      this.reset();
      this.demonstrate();
      return;
    }
    if (this.phase === "listen") {
      this.held = true;
      this.holdAt = this.t;
      this.c.synth.startTone(440);
      this.c.leds([50, 90, 20, 50, 90, 20, 50, 90, 20]);
    }
  }
  up(event) {
    if (this.phase === "listen" && this.held) {
      this.held = false;
      this.c.synth.stopTone();
      this.c.leds([0, 0, 0, 0, 0, 0, 0, 0, 0]);
      const value = event.durationMs >= 350 ? 1 : 0;
      this.entered.push(value);
      if (value !== this.sequence[this.entered.length - 1]) {
        this.phase = "over";
        this.c.score(this.round);
        this.feedback = `PULSE ${this.entered.length}: EXPECTED ${this.sequence[this.entered.length - 1] ? "LONG" : "SHORT"}`;
        recordRun(this.c, { sequences: this.round, milestone: this.round, error: this.feedback });
        this.c.tone(100, 0.3);
      } else if (this.entered.length === this.sequence.length) {
        this.round++;
        this.c.tone(740, 0.2);
        this.phase = "between";
        this.wait = 1;
      }
    }
  }
  cancel() {
    this.held = false;
    this.c.synth.stopTone();
    this.c.leds([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  }
  menuActions() {
    return [{ label: 'REPLAY CURRENT SIGNAL', run: () => { this.demonstrate(); this.c.resume?.(); } }];
  }
  resume() {
    if (this.phase === 'show') this.demonstrate();
  }
  update(dt) {
    this.t += dt;
    this.wait -= dt;
    if (this.phase === "show" && this.wait <= 0) {
      if (this.lit) {
        this.lit = false;
        this.active = -1;
        this.index++;
        this.wait = 0.28;
        this.c.leds([0, 0, 0, 0, 0, 0, 0, 0, 0]);
      } else if (this.index >= this.sequence.length) {
        this.phase = "listen";
        this.c.hint("Your turn: short < 0.35s · long ≥ 0.35s.");
      } else {
        this.lit = true;
        this.active = this.index;
        this.wait = this.sequence[this.index] ? 0.62 : 0.18;
        const lights = Array(9).fill(0);
        lights.splice((this.index % 3) * 3, 3, 100, 180, 50);
        this.c.leds(lights);
        this.c.tone(330 + (this.index % 3) * 110, this.wait);
      }
    } else if (this.phase === "between" && this.wait <= 0) {
      if (this.sequence.length < 10) this.sequence.push(this.c.rng.int(0, 1));
      else
        this.sequence = Array.from({ length: 10 }, () => this.c.rng.int(0, 1));
      this.demonstrate();
    }
    this.c.hud([
      ["SEQUENCES", this.round],
      ["RETURNED", `${this.entered.length} / ${this.sequence.length}`],
      [
        "SIGNAL",
        this.phase === "show"
          ? "RECEIVE"
          : this.phase === "listen"
            ? "TRANSMIT"
            : "STANDBY",
      ],
      ["BEST", this.c.best()],
    ]);
  }
  draw(g) {
    space(g, this.t, 0.3);
    for (let i = 0; i < 3; i++) {
      const x = 310 + i * 170;
      circle(
        g,
        x,
        175,
        39,
        this.active % 3 === i && this.active >= 0 ? C.ink : C.line,
        this.active % 3 === i && this.active >= 0,
      );
      text(
        g,
        ["I", "II", "III"][i],
        x,
        175,
        22,
        this.active % 3 === i && this.active >= 0 ? C.bg : C.muted,
        "center",
      );
    }
    const size = Math.min(67, 660 / this.sequence.length);
    for (let i = 0; i < this.sequence.length; i++) {
      const x = 480 + (i - (this.sequence.length - 1) / 2) * size,
        y = 305;
      const show = this.phase === "show" || i < this.entered.length;
      const color = i < this.entered.length ? C.ink : C.amber;
      if (show) {
        if (this.sequence[i]) line(g, x - 18, y, x + 18, y, color, 7);
        else circle(g, x, y, 6, color, true);
      } else diamond(g, x, y, 5, C.line);
      if (i === this.active) line(g, x - 20, y + 23, x + 20, y + 23, C.ink, 2);
    }
    text(
      g,
      this.phase === "listen"
        ? "THE VAULT IS LISTENING."
        : this.phase === "between"
          ? "SIGNAL ACCEPTED."
          : "RECEIVE / REMEMBER / RETURN",
      480,
      415,
      17,
      C.muted,
      "center",
    );
    if (this.phase === "title")
      banner(
        g,
        "ECHO VAULT",
        "Remember a growing sequence of short and long pulses.",
      );
    if (this.phase === "over")
      banner(
        g,
        "ECHO DIVERGED",
        `${this.feedback} / ${this.round} sequences / press to restart`,
        C.amber,
      );
  }
}

export class LightTrial {
  constructor(ctx) {
    this.c = ctx;
    this.phase = "title";
    this.trial = 0;
    this.cueAt = 0;
    this.screenCueAt = 0;
    this.results = [];
    this.buckets = { physical: [], keyboard: [], simulator: [] };
    this.metric = ctx.simulated() ? "simulator" : "physical";
    this.cueGeneration = 0;
    this.last = null;
    this.t = 0;
    this.c.hint(
      "Wait for the MIDDLE light. Press once it turns green. Early presses fail.",
    );
  }
  down(event) {
    if (
      this.phase === "title" ||
      this.phase === "result" ||
      this.phase === "early" ||
      this.phase === "error"
    ) {
      this.trial = this.c.rng.int(1, 0x7ffffffe);
      this.phase = "wait";
      this.cueAt = 0;
      this.last = null;
      this.c
        .command("reaction", {
          trial: this.trial,
          delay: this.c.rng.int(1300, 4200),
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
      this.phase = "early";
      this.c.command("cancel").catch(() => {});
      this.c.leds([150, 15, 0, 0, 0, 0, 150, 15, 0]);
      this.c.tone(90, 0.18);
      return;
    }
    if (this.phase === "go") {
      const metric = event.source === "node" ? "physical" : event.source === "simulator" ? "simulator" : "keyboard";
      const nativeClock = metric !== "keyboard";
      if (nativeClock && (event.generation ?? 0) !== this.cueGeneration) { this.pause(); return; }
      const milliseconds = nativeClock
        ? (event.at_us - this.cueAt) / 1000
        : performance.now() - this.screenCueAt;
      if (milliseconds < 0) {
        this.phase = "early";
        return;
      }
      this.last = Math.round(milliseconds);
      this.metric = metric;
      this.buckets[metric].push(this.last);
      this.buckets[metric] = this.buckets[metric].slice(-10);
      this.results = this.buckets[metric];
      this.phase = "result";
      this.c.tone(660, 0.15);
      // Scores use higher-is-better points, while the measured time stays visible.
      this.c.score(Math.max(0, 1000 - this.last), this.metric);
      recordRun(this.c, { metric: this.metric, milliseconds: this.last, summary: reactionSummary(this.results), milestone: this.results.length });
      this.c.leds([20, 100, 20, 20, 100, 20, 20, 100, 20]);
    }
  }
  event(event) {
    if (event.type === "node_reset" || (event.type === "device" && !event.connected)) { this.pause(); return; }
    if (
      event.type === "cue" &&
      event.trial === this.trial &&
      this.phase === "wait"
    ) {
      this.cueAt = event.at_us;
      this.cueGeneration = event.generation ?? 0;
      this.screenCueAt = performance.now();
      this.phase = "go";
    }
  }
  pause() {
    this.c.command("cancel").catch(() => {});
    this.c.leds(Array(9).fill(0));
    if (this.phase === "wait" || this.phase === "go") this.phase = "title";
  }
  dispose() {
    this.c.command("cancel").catch(() => {});
  }
  update(dt) {
    this.t += dt;
    const summary = reactionSummary(this.results);
    this.c.hud([
      ["LAST", this.last === null ? "—" : this.last + " ms"],
      [
        "MEAN / " + this.results.length,
        this.results.length
          ? Math.round(
              this.results.reduce((a, b) => a + b, 0) / this.results.length,
            ) + " ms"
          : "—",
      ],
      ["MEDIAN", summary.median === null ? "—" : summary.median + " ms"],
      ["CLOCK", this.metric.toUpperCase()],
    ]);
  }
  draw(g) {
    space(g, this.t, 0.3);
    grid(g, 90);
    if (this.c.state?.()?.scores?.reaction !== undefined)
      text(g, 'LEGACY RECORD RETAINED / TIMING SOURCE UNKNOWN', 30, 32, 12, C.muted);
    const go = this.phase === "go";
    for (let i = 0; i < 3; i++) {
      circle(
        g,
        290 + i * 190,
        250,
        58,
        i === 1 && go ? C.ink : C.line,
        i === 1 && go,
      );
      circle(g, 290 + i * 190, 250, 66, C.line);
      text(
        g,
        ["I", "II", "III"][i],
        290 + i * 190,
        250,
        27,
        i === 1 && go ? C.bg : C.muted,
        "center",
      );
    }
    const title = {
      wait: "WAIT FOR THE MIDDLE LIGHT",
      go: "NOW",
      early: "TOO EARLY",
      result: this.last + " ms",
      error: "NODE UNAVAILABLE",
    }[this.phase];
    if (title) {
      text(
        g,
        title,
        480,
        385,
        32,
        this.phase === "early" ? C.amber : C.ink,
        "center",
      );
      if (["result", "early", "error"].includes(this.phase))
        text(g, "PRESS FOR ANOTHER TRIAL", 480, 440, 15, C.muted, "center");
    }
    if (this.phase === "title")
      banner(
        g,
        "LIGHT TRIAL",
        "An honest measure of the moment between seeing and acting.",
      );
  }
}

export class GlyphVault {
  constructor(ctx) {
    this.c = ctx;
    this.reset();
  }
  reset() {
    this.phase = "title";
    this.sequence = [];
    this.entered = [];
    this.round = 0;
    this.points = 0;
    this.lives = 3;
    this.focus = 0;
    this.wait = 0;
    this.scan = 0;
    this.scanMs = this.c.settings().scanMs || 850;
    this.flash = 0;
    this.t = 0;
    this.c.hint(
      "Memorize the inscription. Press as each matching glyph is highlighted.",
    );
  }
  next() {
    this.sequence = Array.from(
      { length: Math.min(3 + Math.floor(this.round / 2), 7) },
      () => this.c.rng.int(0, 5),
    );
    this.entered = [];
    this.phase = "watch";
    this.wait = 2.5 + this.sequence.length * 0.4;
    this.focus = 0;
    this.scan = 0;
  }
  down() {
    if (this.phase === "title" || this.phase === "over") {
      this.reset();
      this.next();
      return;
    }
    if (this.phase !== "choose") return;
    if (this.focus === this.sequence[this.entered.length]) {
      this.entered.push(this.focus);
      this.c.tone(500 + this.entered.length * 65, 0.1);
      if (this.entered.length === this.sequence.length) {
        this.points += 100 + this.round * 20;
        this.round++;
        this.phase = "between";
        this.wait = 1.3;
      }
    } else {
      this.lives--;
      this.flash = 0.45;
      this.c.tone(110, 0.18);
      if (this.lives <= 0) {
        this.phase = "over";
        this.c.score(this.points, "scan" + this.scanMs);
        recordRun(this.c, { inscriptions: this.round, score: this.points, scanMs: this.scanMs, milestone: this.round });
      }
    }
  }
  update(dt) {
    this.t += dt;
    this.wait -= dt;
    this.flash = Math.max(0, this.flash - dt);
    if (this.phase === "watch" && this.wait <= 0) {
      this.phase = "choose";
      this.c.hint("The glyph cursor advances automatically. Press to select.");
    }
    if (this.phase === "between" && this.wait <= 0) this.next();
    if (this.phase === "choose") {
      this.scan += dt;
      while (this.scan >= this.scanMs / 1000) {
        this.scan -= this.scanMs / 1000;
        this.focus = (this.focus + 1) % 6;
      }
    }
    this.c.hud([
      ["SCAN", this.scanMs + " ms"],
      ["INSCRIPTIONS", this.round],
      ["SCORE", this.points],
      ["ATTEMPTS", "◇".repeat(this.lives)],
    ]);
  }
  draw(g) {
    space(g, this.t, 0.2);
    const size = 76;
    for (let i = 0; i < this.sequence.length; i++) {
      const x = 480 + (i - (this.sequence.length - 1) / 2) * size;
      g.strokeStyle = C.line;
      g.strokeRect(x - 29, 102, 58, 74);
      if (
        this.phase === "watch" ||
        this.phase === "between" ||
        i < this.entered.length
      )
        glyph(
          g,
          this.sequence[i],
          x,
          139,
          17,
          i < this.entered.length ? C.ink : C.amber,
        );
      else text(g, "·", x, 139, 30, C.line, "center");
    }
    if (this.phase === "watch")
      text(
        g,
        "COMMIT THE INSCRIPTION TO MEMORY",
        480,
        239,
        18,
        C.amber,
        "center",
      );
    for (let i = 0; i < 6; i++) {
      const x = 230 + i * 100,
        selected = this.phase === "choose" && i === this.focus;
      if (selected) {
        g.fillStyle = this.flash ? C.red : C.ink;
        g.fillRect(x - 39, 295, 78, 90);
      }
      glyph(g, i, x, 340, 23, selected ? C.bg : C.muted);
      text(g, String(i + 1), x, 406, 12, C.muted, "center");
    }
    text(
      g,
      this.phase === "between"
        ? "THE ARCHIVE RECOGNIZES YOU."
        : "SIX SYMBOLS. A LANGUAGE OLDER THAN ITS SPEAKERS.",
      480,
      476,
      14,
      C.muted,
      "center",
    );
    if (this.phase === "title")
      banner(
        g,
        "GLYPH ARCHIVE",
        "Remember an inscription. Rebuild it one symbol at a time.",
      );
    if (this.phase === "over")
      banner(
        g,
        "ARCHIVE SEALED",
        `${this.round} inscriptions decoded / press to return`,
        C.amber,
      );
  }
}
