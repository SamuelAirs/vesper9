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
import { GESTURE_PACES } from "../engine/input.js";
import { LAMP, lamps, fill, only, meter, spot, ramp, blink, dim, lightsOff } from "../engine/lightshow.js";

export function recordRun(ctx, result) {
  const previous = ctx.progress?.() || {};
  ctx.saveProgress?.({ schema: 1, runs: (previous.runs || 0) + 1, last: result,
    milestone: Math.max(previous.milestone || 0, result.milestone || 0) })?.catch?.(ctx.error);
}
// A result screen ignores presses for this long, so a player who is tapping in rhythm sees it.
export const LOCKOUT = 0.6;
// A run that ends is recorded this long afterwards (or at once when the player leaves), which
// is longer than any menu gesture, so a death caused by the gesture's own taps can be undone.
export const SETTLE = 2;

const clone = (value) => structuredClone(value);

// The system menu opens on the fourth quick click, and the first three have already reached the
// game as ordinary presses (docs/ENGINE.md, input contract). Edges stay immediate, so the game
// cannot know a tap belongs to a gesture. Instead each press first saves the run's state; when the
// host calls cancel() and the last presses look like the click gesture (`menuClicks` short taps,
// at the configured pace, the last one still down), the game goes back to the state saved at the
// gesture's first tap. Nothing is delayed in normal play, and cancel() only follows a menu gesture
// or an interruption, so the rewind reaches back no further than the gesture window (about a second).
// A run that ends is not recorded straight away either (see end/settle), so a death that the
// gesture caused and the rewind undid never reaches the scores or the field record.
export class GestureGuard {
  constructor(game, ctx, fields) {
    this.game = game; this.c = ctx; this.fields = [...fields, "phase", "ended", "overAt"];
    this.t = 0; this.marks = [];
    // Finished runs whose game has already started another one, still waiting out the window.
    this.backlog = [];
  }
  snapshot() { const saved = {}; for (const key of this.fields) saved[key] = clone(this.game[key]); return saved; }
  tick(dt) {
    this.t += dt;
    if (this.game.ended && this.t - this.game.overAt >= SETTLE) { const ended = this.game.ended; this.game.ended = null; this.record(ended); }
    if (this.backlog.length && this.backlog[0].due <= this.t) this.record(this.backlog.shift());
  }
  // Call at the very top of down(), before the press changes anything.
  mark() {
    this.marks.push({ at: this.t, up: null, state: this.snapshot() });
    if (this.marks.length > 6) this.marks.shift();
  }
  release() { const last = this.marks.at(-1); if (last && last.up === null) last.up = this.t; }
  // Rewind after a menu gesture; returns whether it did.
  rewind() {
    const marks = this.marks; this.marks = [];
    const settings = this.c.settings?.() || {};
    const clicks = settings.menuClicks ?? 4;
    if (!clicks || marks.length < clicks) return false;
    const pace = GESTURE_PACES[settings.gesturePace] || GESTURE_PACES.standard, slop = 0.15;
    const tap = pace.tapMs / 1000 + slop, gap = pace.gapMs / 1000 + slop;
    const taps = marks.slice(-clicks), last = taps.at(-1);
    // The terminal release is consumed by the host, so the final tap has no release yet.
    if (last.up !== null || this.t - last.at > tap) return false;
    if (this.t - taps[0].at > (pace.totalMs / 1000) * (clicks / 4) + slop) return false;
    for (let i = 0; i < clicks - 1; i++) {
      if (taps[i].up === null || taps[i].up - taps[i].at > tap) return false;
      if (taps[i + 1].at - taps[i].up > gap) return false;
    }
    for (const [key, value] of Object.entries(taps[0].state)) this.game[key] = clone(value);
    // A run that ended and was replaced during the gesture is part of what was just undone.
    this.backlog = this.backlog.filter((entry) => entry.stashed < taps[0].at);
    return true;
  }
  // End the run now, record it later.
  end(score, run) {
    this.game.phase = "over"; this.game.overAt = this.t; this.game.ended = { score, run };
  }
  // The game starts another run: the finished one waits in the backlog.
  stash() {
    const ended = this.game.ended; this.game.ended = null;
    if (ended) this.backlog.push({ ...ended, stashed: this.t, due: this.game.overAt + SETTLE });
  }
  record(ended) {
    this.c.score(...ended.score);
    recordRun(this.c, ended.run);
  }
  // Record every finished run now: the player is leaving.
  settle() {
    const all = [...this.backlog, this.game.ended].filter(Boolean);
    this.backlog = []; this.game.ended = null;
    for (const ended of all) this.record(ended);
  }
  locked() { return this.game.phase === "over" && this.t - this.game.overAt < LOCKOUT; }
}

// ---------------------------------------------------------------------------------------------
// Lamps. Every game drives the three lamps through one LampBus: a resting picture computed each
// frame (null = dark), plus short events (flash) that overlay it. Values are whole numbers in
// steps of 8 so the light director's dedupe works, and a frame that changes nothing writes nothing.
// cancel() clears at once; pause() and dispose() also stop all further writes until resume().
const ZERO = Array(9).fill(0);
const q8 = (v) => Math.min(255, Math.max(0, Math.round(v / 8) * 8));
// Brightest of two nine-value pictures, so an accent can sit on top of the resting light.
export const lampMax = (a, b) => a.map((v, i) => Math.max(v, b[i]));
export class LampBus {
  constructor(ctx) { this.c = ctx; this.sent = null; this.live = true; this.fx = null; this.amb = ZERO; }
  put(values) {
    if (!this.live) return;
    const out = (values || ZERO).map(q8), key = out.join();
    if (key === this.sent) return;
    this.sent = key;
    this.c.leds?.(out);
  }
  // One frame: `ambient` is the resting picture; an active flash overlays it.
  frame(dt, ambient) {
    this.amb = ambient || ZERO;
    let out = ambient;
    if (this.fx) {
      this.fx.e += dt;
      if (this.fx.e >= this.fx.total) this.fx = null;
      else out = this.fx.fn(this.fx.e, this.fx.total, this.amb);
    }
    this.put(out);
  }
  // A timed event; fn(elapsed, total, ambient) returns nine values. It shows at once.
  flash(total, fn) { this.fx = { e: 0, total, fn }; this.put(fn(0, total, this.amb)); }
  clear() { this.fx = null; this.sent = null; const live = this.live; this.live = true; this.put(null); this.live = live; }
  sleep() { this.clear(); this.live = false; }
  wake() { this.live = true; this.sent = null; }
}
// Shows a short announcement near the top of the canvas while its timer runs.
function announce(game, message, seconds = 3.2) { game.note = message; game.noteT = seconds; }
function drawNote(g, game) {
  if (game.noteT > 0 && game.phase !== "over" && game.phase !== "title") text(g, game.note, 480, 44, 24, C.amber, "center");
}
const lerpValues = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

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
export function nextGate(center, points, rng) {
  // Columns are at least 1.75 s apart; the centre moves by at most 85 px, less at the start.
  const reach = Math.min(85, 45 + points * 2);
  const base = clamp(center + rng.range(-reach, reach), 165, 375);
  // From the tenth passage the opening drifts up and down around its base.
  const amp = Math.min(70, Math.max(0, (points - 9) * 3));
  return { x: 1010, center: base, base, amp, phase: rng.range(0, TAU), age: 0,
    gap: Math.max(100, 270 - points * 3.4), passed: false };
}
export function reactionSummary(values) {
  if (!values.length) return { count: 0, median: null, best: null, mean: null };
  const sorted = values.slice().sort((a,b) => a-b), n = sorted.length;
  return { count: n, median: Math.round((sorted[Math.floor((n-1)/2)] + sorted[Math.floor(n/2)]) / 2),
    best: sorted[0], mean: Math.round(sorted.reduce((a,b) => a+b, 0) / n) };
}

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
      if (p % 5 === 0 && p >= 10) { this.dir = -this.dir; announce(this, "SECTOR " + sector + " / THE ORBIT REVERSES"); }
      if (p === 20) announce(this, "THE GATE NOW DRIFTS");
      if (p % 10 === 0 && this.lives < 3) { this.lives++; announce(this, "HULL REPAIRED"); }
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

// ---------------------------------------------------------------------------------------------
// Echo Vault. A hold of 350 ms or more is long. A hold on the wrong side of that line but within
// WOBBLE_MS of it is forgiven while the player has a wobble in hand (three at the start, one more
// every three sequences, at most four), so the run ends on a mistaken memory, not on a close call.
export const ECHO_LINE = 350;
export const WOBBLE_MS = 100;
export function echoHeard(ms, expected, wobbles) {
  const side = ms >= ECHO_LINE ? 1 : 0;
  if (side === expected) return { side, ok: true, wobble: false };
  if (Math.abs(ms - ECHO_LINE) <= WOBBLE_MS && wobbles > 0) return { side, ok: true, wobble: true };
  return { side, ok: false, wobble: false };
}
export class EchoVault {
  constructor(ctx) {
    this.c = ctx;
    this.lamps = new LampBus(ctx);
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
    this.stepped = false;
    this.wobbles = 3;
    this.heard = null; this.heardT = 0;
    this.note = ""; this.noteT = 0;
    this.overAt = -LOCKOUT;
    this.t = 0;
    this.c.hint("Watch the pulse pattern. Repeat short taps and longer holds.");
  }
  // Playback quickens from the third sequence: gaps shrink and long pulses shorten (never below
  // 0.5 s, well clear of the 0.35 s line).
  tempo() { return Math.max(0.55, 1 - 0.045 * Math.max(0, this.round - 2)); }
  // From the eighth sequence the screen no longer lists the pulses during playback: only the lamps,
  // the three circles and the tone carry them.
  dark() { return this.round >= 8; }
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
      if (this.phase === "over" && this.t - this.overAt < LOCKOUT) return;
      this.reset();
      this.demonstrate();
      return;
    }
    if (this.phase === "listen") {
      this.held = true;
      this.holdAt = this.t;
      this.stepped = false;
      this.heard = null;
      this.c.synth.startTone(440);
    }
  }
  up(event) {
    if (this.phase === "listen" && this.held) {
      this.held = false;
      this.c.synth.stopTone();
      const ms = event.durationMs, slot = this.entered.length, want = this.sequence[slot];
      const verdict = echoHeard(ms, want, this.wobbles);
      this.heard = { ms: Math.round(ms), side: verdict.side, ok: verdict.ok, wobble: verdict.wobble };
      this.heardT = 1.4;
      this.entered.push(verdict.ok ? want : verdict.side);
      if (!verdict.ok) {
        this.phase = "over";
        this.overAt = this.t;
        this.c.score(this.round);
        this.feedback = `PULSE ${this.entered.length}: EXPECTED ${want ? "LONG" : "SHORT"} / HEARD ${verdict.side ? "LONG" : "SHORT"} ${this.heard.ms} ms`;
        recordRun(this.c, { sequences: this.round, milestone: this.round, error: this.feedback });
        this.c.tone(100, 0.3);
        // Three blinks in the colour of the pulse that was wanted: amber short, cyan long.
        const colour = want ? LAMP.cyan : LAMP.amber;
        this.lamps.flash(1.0, (e) => (Math.floor(e / 0.167) % 2 === 0 ? fill(colour, 0.6) : lightsOff()));
      } else {
        if (verdict.wobble) {
          this.wobbles--;
          this.lamps.flash(0.25, () => fill(LAMP.amber, 0.5));
          announce(this, "CLOSE CALL FORGIVEN", 1.6);
        }
        if (this.entered.length === this.sequence.length) {
          this.round++;
          if (this.round % 3 === 0 && this.wobbles < 4) this.wobbles++;
          if (this.round === 3) announce(this, "PLAYBACK QUICKENS");
          if (this.round === 8) announce(this, "DARK VAULT / WATCH THE LAMPS");
          this.c.tone(740, 0.2);
          this.phase = "between";
          this.wait = 1;
          this.lamps.flash(0.6, (e, T) => spot(e / T, dim(LAMP.green, 0.55)));
        }
      }
    }
  }
  cancel() {
    this.held = false;
    this.c.synth.stopTone();
    this.lamps.clear();
  }
  // Replay only exists while a signal is being received or entered: between rounds it would let
  // the same signal be credited twice, and after the run ended it would reopen a recorded run.
  menuActions() {
    if (this.phase !== 'show' && this.phase !== 'listen') return [];
    return [{ label: 'REPLAY CURRENT SIGNAL', run: () => {
      if (this.phase === 'show' || this.phase === 'listen') this.demonstrate();
      this.c.resume?.();
    } }];
  }
  // Leaving mid-run keeps the sequences completed so far.
  pause() {
    if (this.phase !== 'over' && this.round > 0) this.c.score(this.round);
    this.lamps.sleep();
  }
  dispose() { this.cancel(); this.pause(); }
  resume() {
    this.lamps.wake();
    if (this.phase === 'show') this.demonstrate();
  }
  // Resting light: during playback a short is one amber lamp and a long is a cyan bar; while you
  // hold, the lamps fill left to right (amber) and turn cyan at the 350 ms line; between pulses
  // they show how much of the signal has been returned.
  lampValues() {
    if (this.phase === "show")
      return this.lit ? (this.sequence[this.active] ? fill(LAMP.cyan, 0.4) : only(1, LAMP.amber, 0.6)) : null;
    if (this.phase === "listen") {
      if (this.held) {
        const ms = (this.t - this.holdAt) * 1000;
        return ms >= ECHO_LINE ? fill(LAMP.cyan, 0.45) : meter(ms / ECHO_LINE, dim(LAMP.amber, 0.33));
      }
      return meter(this.entered.length / this.sequence.length, dim(LAMP.violet, 0.2));
    }
    return null;
  }
  update(dt) {
    this.t += dt;
    this.wait -= dt;
    if (this.heardT > 0) this.heardT -= dt;
    if (this.noteT > 0) this.noteT -= dt;
    if (this.held && !this.stepped && this.t - this.holdAt >= ECHO_LINE / 1000) {
      this.stepped = true;
      this.c.synth.startTone(660);   // the sidetone steps up when the hold becomes long
    }
    const s = this.tempo();
    if (this.phase === "show" && this.wait <= 0) {
      if (this.lit) {
        this.lit = false;
        this.active = -1;
        this.index++;
        this.wait = Math.max(0.14, 0.28 * s);
      } else if (this.index >= this.sequence.length) {
        this.phase = "listen";
        this.c.hint("Your turn: hold under 0.35 s is short, 0.35 s or more is long.");
      } else {
        this.lit = true;
        this.active = this.index;
        this.wait = this.sequence[this.index] ? Math.max(0.5, 0.62 * s) : 0.18;
        this.c.tone(330 + (this.index % 3) * 110, this.wait);
      }
    } else if (this.phase === "between" && this.wait <= 0) {
      if (this.sequence.length < 10) this.sequence.push(this.c.rng.int(0, 1));
      else
        this.sequence = Array.from({ length: 10 }, () => this.c.rng.int(0, 1));
      this.demonstrate();
    }
    this.lamps.frame(dt, this.lampValues());
    this.c.hud([
      ["SEQUENCES", this.round],
      ["RETURNED", `${this.entered.length} / ${this.sequence.length}`],
      ["WOBBLES", this.wobbles ? "◇".repeat(this.wobbles) : "0"],
      ["BEST", this.c.best()],
    ]);
  }
  draw(g) {
    space(g, this.t, 0.3);
    // The three circles mirror the lamps: a short lights the middle one, a long lights all three.
    const pulseNow = this.phase === "show" && this.lit ? (this.sequence[this.active] ? 2 : 1) : 0;
    for (let i = 0; i < 3; i++) {
      const x = 310 + i * 170, on = pulseNow === 2 || (pulseNow === 1 && i === 1);
      circle(g, x, 150, 39, on ? C.ink : C.line, on);
      text(g, ["I", "II", "III"][i], x, 150, 22, on ? C.bg : C.muted, "center");
    }
    const size = Math.min(67, 660 / this.sequence.length), hide = this.phase === "show" && this.dark();
    for (let i = 0; i < this.sequence.length; i++) {
      const x = 480 + (i - (this.sequence.length - 1) / 2) * size,
        y = 270;
      const show = (this.phase === "show" && !hide) || i < this.entered.length;
      const color = i < this.entered.length ? C.ink : C.amber;
      if (show) {
        const long = i < this.entered.length ? this.entered[i] : this.sequence[i];
        if (long) line(g, x - 18, y, x + 18, y, color, 7);
        else circle(g, x, y, 6, color, true);
      } else diamond(g, x, y, 5, C.line);
      if (i === this.active) line(g, x - 20, y + 23, x + 20, y + 23, C.ink, 2);
    }
    text(
      g,
      this.phase === "listen"
        ? "YOUR TURN"
        : this.phase === "between"
          ? "SIGNAL ACCEPTED"
          : this.phase === "show"
            ? (hide ? "DARK VAULT / LAMPS ONLY" : "RECEIVE / REMEMBER")
            : "",
      480,
      345,
      24,
      C.muted,
      "center",
    );
    // What the vault heard on your last pulse, and a live bar for the hold in progress.
    if (this.heard && this.heardT > 0 && this.phase !== "over") {
      const h = this.heard, side = h.side ? "LONG" : "SHORT";
      text(g, `HEARD ${side} / ${h.ms} ms${h.wobble ? " / FORGIVEN" : h.ok ? "" : " / WRONG"}`, 480, 395, 24,
        h.ok ? (h.wobble ? C.amber : C.ink) : C.red, "center");
    }
    const x0 = 180, w = 600, per = w / 700, y = 470;
    g.fillStyle = "#1a2a1e";
    g.fillRect(x0, y, w, 16);
    g.fillStyle = "#4b6b44";
    g.fillRect(x0 + (ECHO_LINE - WOBBLE_MS) * per, y, WOBBLE_MS * 2 * per, 16);
    line(g, x0 + ECHO_LINE * per, y - 6, x0 + ECHO_LINE * per, y + 22, C.amber, 3);
    const ms = this.held ? (this.t - this.holdAt) * 1000 : this.heard && this.heardT > 0 ? this.heard.ms : 0;
    g.fillStyle = ms >= ECHO_LINE ? C.cyan : C.amber;
    g.fillRect(x0, y, Math.min(700, ms) * per, 16);
    text(g, "SHORT", x0, y + 40, 18, C.muted);
    text(g, "LONG", x0 + w, y + 40, 18, C.muted, "right");
    drawNote(g, this);
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
        `${this.feedback} / ${this.round} sequences`,
        C.amber,
      );
  }
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
export class LightTrial {
  constructor(ctx) {
    this.c = ctx;
    this.lamps = new LampBus(ctx);
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
  down(event) {
    if (
      this.phase === "title" ||
      this.phase === "result" ||
      this.phase === "early" ||
      this.phase === "error"
    ) {
      this.lamps.clear();
      this.fresh = false;
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
      this.c.command("cancel").catch(() => {});
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
      recordRun(this.c, { metric: this.metric, milliseconds: this.last, summary: reactionSummary(this.results), milestone: this.results.length });
      // The grade colour on all three lamps, then dark; a new best sweeps white across first.
      const grade = reactionGrade(this.last).color, sweep = this.fresh ? 0.36 : 0;
      this.lamps.flash(1.2 + sweep, (e) => {
        if (e < sweep) return only(Math.min(2, Math.floor(e / 0.12)), LAMP.white, 0.9);
        return fill(grade, e - sweep < 0.15 ? 0.8 : 0.33);
      });
    }
  }
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
  cancel() { if (this.phase !== "wait" && this.phase !== "go") this.lamps.clear(); }
  pause() { this.abort(); this.lamps.sleep(); }
  resume() { this.lamps.wake(); }
  dispose() {
    this.c.command("cancel").catch(() => {});
    this.lamps.sleep();
  }
  update(dt) {
    this.t += dt;
    // No host light while armed or waiting for the cue.
    if (this.phase !== "wait" && this.phase !== "go") this.lamps.frame(dt, null);
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
      text(g, 'LEGACY RECORD RETAINED / TIMING SOURCE UNKNOWN', 30, 32, 16, C.muted);
    const go = this.phase === "go";
    for (let i = 0; i < 3; i++) {
      circle(
        g,
        290 + i * 190,
        190,
        58,
        i === 1 && go ? C.ink : C.line,
        i === 1 && go,
      );
      circle(g, 290 + i * 190, 190, 66, C.line);
      text(
        g,
        ["I", "II", "III"][i],
        290 + i * 190,
        190,
        27,
        i === 1 && go ? C.bg : C.muted,
        "center",
      );
    }
    const grade = this.phase === "result" ? reactionGrade(this.last) : null;
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
        312,
        36,
        this.phase === "early" ? C.amber : C.ink,
        "center",
      );
      if (grade) text(g, grade.word + (this.fresh ? " / NEW BEST" : ""), 480, 358, 24, this.fresh ? C.amber : C.muted, "center");
      if (this.phase === "result" && this.metric === "keyboard")
        text(g, "KEYBOARD TIMING IS APPROXIMATE", 480, 392, 18, C.muted, "center");
      if (["result", "early", "error"].includes(this.phase))
        text(g, "PRESS FOR ANOTHER TRIAL", 480, 420, 22, C.amber, "center");
    }
    // The last ten results as bars: taller is slower, the scale runs to 600 ms.
    const bars = this.results;
    if (bars.length && this.phase !== "title") {
      const w = 36, gap = 12, x0 = 480 - (bars.length * (w + gap) - gap) / 2, base = 504;
      bars.forEach((ms, i) => {
        const h = Math.max(4, Math.min(1, ms / 600) * 60);
        g.fillStyle = i === bars.length - 1 && this.phase === "result" ? C.amber : C.muted;
        g.fillRect(x0 + i * (w + gap), base - h, w, h);
      });
      text(g, "RECENT TRIALS / TALLER IS SLOWER", 480, 526, 16, C.muted, "center");
    }
    if (this.phase === "title")
      banner(
        g,
        "LIGHT TRIAL",
        "An honest measure of the moment between seeing and acting.",
      );
  }
}

// ---------------------------------------------------------------------------------------------
const GLYPH_LIVES = [LAMP.red, LAMP.red, LAMP.amber, LAMP.green];
export class GlyphVault {
  constructor(ctx) {
    this.c = ctx;
    this.lamps = new LampBus(ctx);
    this.guard = new GestureGuard(this, ctx, ["sequence", "entered", "round", "points", "lives", "focus", "wait", "scan", "flash", "order", "step", "watchTotal"]);
    this.reset();
  }
  reset() {
    this.phase = "title";
    this.ended = null;
    this.overAt = 0;
    this.sequence = [];
    this.entered = [];
    this.round = 0;
    this.points = 0;
    this.lives = 3;
    this.focus = 0;
    this.order = [0, 1, 2, 3, 4, 5];   // the order the cursor visits the glyphs
    this.step = 0;
    this.wait = 0;
    this.watchTotal = 1;
    this.scan = 0;
    this.blip = 0;
    this.scanMs = this.c.settings().scanMs || 850;
    this.flash = 0;
    this.note = ""; this.noteT = 0;
    this.t = 0;
    this.c.hint(
      "Memorize the inscription. Press as each matching glyph is highlighted.",
    );
  }
  // The cursor quickens 3% with every inscription, down to 60% of the chosen interval.
  scanSeconds() { return (this.scanMs / 1000) * Math.max(0.6, 0.97 ** this.round); }
  next() {
    this.sequence = Array.from(
      { length: Math.min(3 + Math.floor(this.round / 2), 9) },
      () => this.c.rng.int(0, 5),
    );
    this.entered = [];
    this.phase = "watch";
    // Less time to memorise as the run goes on, never less than 1.8 s plus 0.25 s a glyph.
    this.wait = this.watchTotal = Math.max(1.8 + this.sequence.length * 0.25, 2.5 + this.sequence.length * 0.4 - this.round * 0.1);
    // From the sixth inscription the cursor visits the glyphs in a shuffled order.
    this.order = [0, 1, 2, 3, 4, 5];
    if (this.round >= 5) for (let i = 5; i > 0; i--) {
      const j = this.c.rng.int(0, i); [this.order[i], this.order[j]] = [this.order[j], this.order[i]];
    }
    this.step = 0;
    this.focus = this.order[0];
    this.scan = 0;
  }
  down() {
    this.guard.mark();
    if (this.phase === "title" || this.phase === "over") {
      if (this.guard.locked()) return;
      this.guard.stash();
      this.reset();
      this.next();
      return;
    }
    if (this.phase !== "choose") return;
    if (this.focus === this.sequence[this.entered.length]) {
      this.entered.push(this.focus);
      this.c.tone(500 + this.entered.length * 65, 0.1);
      if (this.entered.length === this.sequence.length) {
        // Faster cursors pay more: 850 ms is the reference.
        this.points += Math.round((100 + this.round * 20) * 850 / (this.scanSeconds() * 1000));
        this.round++;
        this.phase = "between";
        this.wait = 1.3;
        this.lamps.flash(0.6, (e, T) => spot(e / T, dim(LAMP.green, 0.55)));
        if (this.round === 5) announce(this, "THE CURSOR NOW SCRAMBLES");
        if (this.round % 2 === 0 && this.round <= 12) announce(this, "THE INSCRIPTION GROWS TO " + Math.min(3 + this.round / 2, 9) + " GLYPHS");
        if (this.round % 4 === 0 && this.lives < 3) { this.lives++; announce(this, "ATTEMPT RESTORED"); }
      }
    } else {
      this.lives--;
      this.flash = 0.45;
      this.c.tone(110, 0.18);
      this.lamps.flash(0.3, () => fill(LAMP.red, 0.6));
      if (this.lives <= 0) {
        this.guard.end([this.points, "scan" + this.scanMs], { inscriptions: this.round, score: this.points, scanMs: this.scanMs, milestone: this.round });
        this.lamps.flash(0.6, (e, T) => fill(LAMP.red, 0.6 * (1 - e / T)));
      }
    }
  }
  up() { this.guard.release(); }
  cancel() { this.guard.rewind(); this.lamps.clear(); }
  pause() {
    this.guard.settle();
    if (this.phase !== "over" && this.phase !== "title" && this.points > 0) this.c.score(this.points, "scan" + this.scanMs);
    this.lamps.sleep();
  }
  resume() { this.lamps.wake(); }
  dispose() { this.pause(); }
  // Watching: violet fades out over the memorising time. Choosing: a progress bar across the lamps
  // (green, amber or red by attempts left) with a white tick on the third of the row the cursor
  // is in each time it moves.
  lampValues() {
    if (this.phase === "watch") return fill(LAMP.violet, 0.33 * clamp(this.wait / this.watchTotal, 0, 1));
    if (this.phase === "choose") {
      const bar = meter(this.entered.length / this.sequence.length, dim(GLYPH_LIVES[this.lives], 0.3));
      return this.blip > 0 ? lampMax(bar, only(Math.floor(this.focus / 2), LAMP.white, 0.7)) : bar;
    }
    return null;
  }
  update(dt) {
    this.t += dt;
    this.guard.tick(dt);
    this.wait -= dt;
    this.flash = Math.max(0, this.flash - dt);
    this.blip = Math.max(0, this.blip - dt);
    if (this.noteT > 0) this.noteT -= dt;
    if (this.phase === "watch" && this.wait <= 0) {
      this.phase = "choose";
      this.c.hint("The glyph cursor advances automatically. Press to select.");
    }
    if (this.phase === "between" && this.wait <= 0) this.next();
    if (this.phase === "choose") {
      this.scan += dt;
      const interval = this.scanSeconds();
      while (this.scan >= interval) {
        this.scan -= interval;
        this.step = (this.step + 1) % 6;
        this.focus = this.order[this.step];
        this.blip = 0.07;
      }
    }
    this.lamps.frame(dt, this.lampValues());
    this.c.hud([
      ["SCAN", Math.round(this.scanSeconds() * 1000) + " ms"],
      ["INSCRIPTIONS", this.round],
      ["SCORE", this.points],
      ["ATTEMPTS", this.lives > 0 ? "◇".repeat(this.lives) : "0"],
    ]);
  }
  draw(g) {
    space(g, this.t, 0.2);
    const size = Math.min(76, 700 / Math.max(1, this.sequence.length));
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
        22,
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
      text(g, String(i + 1), x, 406, 18, C.muted, "center");
    }
    drawNote(g, this);
    text(
      g,
      this.phase === "between"
        ? "THE ARCHIVE RECOGNIZES YOU."
        : this.phase === "choose" ? "PRESS WHEN THE NEXT GLYPH LIGHTS" : "",
      480,
      476,
      22,
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
        `${this.round} inscriptions decoded / ${this.points} points`,
        C.amber,
      );
  }
}
