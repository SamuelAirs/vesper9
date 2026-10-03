// POCKET LINKS — real little courses, one large button. All geometry is in course pixels.
// Lamps 1-3 follow the aiming arrow, then fill with power; lamp 4, when the node has one, says where
// the shot will stop: green in the cup, amber warmer the closer it ends to the cup, red in the water.
import { C, text, line, circle } from "../engine/draw.js";
import { clamp } from "../engine/math.js";
import { LAMP, lamps, fill, dim, meter, spot } from "../engine/lightshow.js";
import { AppGuard } from "../engine/input.js";
import { LampBus, LOCKOUT } from "./game-kit.js";
import { HOLD, lampCount, withFourth, drawGuide } from "./after-hours-kit.js";

export const COURSE_W = 680;
export const COURSE_H = 328;
export const BALL_R = 5.5;
export const AIM_SPEED = 0.58;
export const HOLD_THRESHOLD = 0.30;
export const CHARGE_SECONDS = 2.7;
export const MAX_STROKES = 12;

const X = 30;
const Y = 104;
const TAU = Math.PI * 2;
const CLUBS = ["PUTTER", "WEDGE"];
const SURFACE_COLORS = { sand: "#746944", rough: "#243c28", water: "#184448", ice: "#496764", slope: "#293f32" };
const num = (v, lo, hi, fallback = 0) => typeof v === "number" && Number.isFinite(v) ? clamp(Math.floor(v), lo, hi) : fallback;
const rect = (x, y, w, h) => ({ x, y, w, h });
const patch = (type, x, y, w, h, ax = 0, ay = 0) => ({ type, x, y, w, h, ax, ay });
const inside = (x, y, r) => x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h;

export function migrateSave(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const l = r.last && typeof r.last === "object" ? r.last : {};
  return {
    schema: 1,
    guided: r.guided === true,
    runs: num(r.runs, 0, 1000000),
    milestone: num(r.milestone, 0, 9),
    bestStrokes: num(r.bestStrokes, 0, 108),
    last: {
      score: num(l.score, 0, 20000), strokes: num(l.strokes, 0, 108), par: num(l.par, 0, 60),
      holes: num(l.holes, 0, 9), birdies: num(l.birdies, 0, 9), aces: num(l.aces, 0, 9),
      mulligans: num(l.mulligans, 0, 3),
    },
  };
}

// Authored, connected layouts. Seeded mirrors and safe tee/cup offsets make each round feel different
// without procedurally producing an impossible hole. There is always an unobstructed route around water.
export function makeCourse(index, variant = 0) {
  const courses = [
    { name: "OFF THE CLOCK", par: 3, tee: [68, 164], cup: [581, 164], walls: [],
      patches: [patch("rough", 245, 32, 175, 57)], tip: ["A quiet opening putt.", "The dotted line predicts", "where this shot will roll."] },
    { name: "PATIO DOOR", par: 3, tee: [72, 249], cup: [606, 86], walls: [rect(306, 91, 24, 156)],
      patches: [patch("sand", 392, 183, 97, 82)], tip: ["A wall blocks the cup.", "Bank around it, or tap", "for a wedge over it."] },
    { name: "THE LONG WAY HOME", par: 4, tee: [67, 246], cup: [607, 77], walls: [rect(203, 0, 24, 232), rect(431, 103, 24, 225)],
      patches: [patch("sand", 264, 40, 116, 51)], tip: ["Two turns. Two choices.", "Lay up at the openings", "or hop a dividing wall."] },
    { name: "PUDDLE JUMP", par: 3, tee: [76, 168], cup: [605, 168], walls: [],
      patches: [patch("water", 273, 61, 106, 206), patch("sand", 410, 45, 123, 62)], tip: ["Water costs a stroke.", "Go around on the green", "or carry it with a wedge."] },
    { name: "SUNDAY MOWING", par: 4, tee: [67, 260], cup: [603, 68], walls: [rect(338, 107, 25, 131)],
      patches: [patch("rough", 178, 0, 77, 246), patch("rough", 477, 86, 77, 242), patch("sand", 379, 167, 68, 122)],
      tip: ["Long grass brakes hard.", "The wedge hops rough;", "the putter hugs a lane."] },
    { name: "THE SHORTCUT", par: 4, tee: [62, 239], cup: [605, 232], walls: [rect(226, 112, 24, 216), rect(420, 112, 24, 216), rect(250, 112, 170, 22)],
      patches: [patch("water", 264, 170, 142, 144), patch("sand", 463, 29, 118, 63)],
      tip: ["The safe road goes north.", "A hop can cut a corner.", "Check the landing ring."] },
    { name: "BLACK ICE", par: 3, tee: [61, 164], cup: [607, 164], walls: [rect(452, 99, 24, 130)],
      patches: [patch("ice", 170, 51, 254, 226), patch("sand", 503, 227, 111, 67)],
      tip: ["Ice keeps the ball rolling.", "Use less power or bank", "off the back cushion."] },
    { name: "HILLSIDE", par: 4, tee: [65, 264], cup: [607, 62], walls: [rect(334, 112, 22, 129)],
      patches: [patch("slope", 142, 46, 181, 236, 0, 30), patch("slope", 384, 48, 161, 233, 0, -30), patch("sand", 476, 260, 105, 51)],
      tip: ["Arrows show the slopes.", "Putts bend downhill.", "A wedge ignores the hill", "until it lands."] },
    { name: "ONE LAST ERRAND", par: 5, tee: [63, 268], cup: [615, 60], walls: [rect(207, 0, 22, 163), rect(427, 169, 22, 159)],
      patches: [patch("water", 279, 111, 112, 113), patch("sand", 89, 71, 105, 61), patch("ice", 486, 119, 139, 121), patch("rough", 267, 262, 126, 55)],
      tip: ["Everything comes together.", "Save a safe landing.", "Finish the nine in style."] },
  ];
  const c = courses[clamp(Math.floor(index), 0, 8)];
  const v = Number.isFinite(variant) ? Math.abs(Math.floor(variant)) : 0;
  const mirrorY = (v & 1) !== 0;
  const mirrorX = (v & 2) !== 0;
  const convert = (r) => ({ ...r, x: mirrorX ? COURSE_W - r.x - r.w : r.x, y: mirrorY ? COURSE_H - r.y - r.h : r.y,
    ...(r.ax !== undefined ? { ax: mirrorX ? -r.ax : r.ax, ay: mirrorY ? -r.ay : r.ay } : {}) });
  const point = ([x, y]) => ({ x: mirrorX ? COURSE_W - x : x, y: mirrorY ? COURSE_H - y : y });
  const tee = point(c.tee), cup = point(c.cup);
  // Only the first hole stays absolutely straight; later tee/cup positions vary inside safe end strips.
  if (index > 0) { tee.y = clamp(tee.y + (((v >>> 2) % 3) - 1) * 13, 30, COURSE_H - 30); cup.y = clamp(cup.y + (((v >>> 4) % 3) - 1) * 17, 29, COURSE_H - 29); }
  const lessons = [
    "The ring marks where this predicted shot comes to rest.",
    "Bank around the wall, or TAP for a wedge over it.",
    "Lay up at the openings, or hop a dividing wall.",
    "Water costs +1. Wedge over it or follow the green.",
    "Long grass brakes hard. A wedge carries over it.",
    "The safe road goes north. Check the wedge landing ring.",
    "Ice keeps the ball rolling. Use less power.",
    "Arrows point downhill. Putts bend; wedges fly straight.",
    "Mix both clubs. Leave yourself a safe landing.",
  ];
  return { name: c.name, par: c.par, tee, cup, walls: c.walls.map(convert), patches: c.patches.map(convert), tip: c.tip.slice(), lesson: lessons[clamp(Math.floor(index), 0, 8)] };
}

export function surfaceAt(course, x, y) {
  for (const p of course.patches) if (inside(x, y, p)) return p;
  return null;
}

export function shotBall(x, y, angle, power, club) {
  const p = clamp(Number.isFinite(power) ? power : 0, 0, 1);
  const speed = club === 1 ? 185 + p * 180 : 36 + p * 342;
  const flight = club === 1 ? 0.44 + p * 0.55 : 0;
  return { x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
    flight, flightTotal: flight, elapsed: 0, banks: 0, stopped: false, status: "rolling" };
}

function bounceWall(b, r) {
  const nx = clamp(b.x, r.x, r.x + r.w), ny = clamp(b.y, r.y, r.y + r.h);
  let dx = b.x - nx, dy = b.y - ny, d = Math.hypot(dx, dy);
  if (d >= BALL_R) return false;
  if (d < 0.00001) {
    // A wall joined to the outer cushion must never push an airborne landing outside the course.
    const edges = [r.x < BALL_R ? Infinity : b.x - r.x,
      r.x + r.w > COURSE_W - BALL_R ? Infinity : r.x + r.w - b.x,
      r.y < BALL_R ? Infinity : b.y - r.y,
      r.y + r.h > COURSE_H - BALL_R ? Infinity : r.y + r.h - b.y];
    const side = edges.indexOf(Math.min(...edges));
    if (side === 0) { b.x = r.x - BALL_R - 0.01; dx = -1; dy = 0; }
    else if (side === 1) { b.x = r.x + r.w + BALL_R + 0.01; dx = 1; dy = 0; }
    else if (side === 2) { b.y = r.y - BALL_R - 0.01; dx = 0; dy = -1; }
    else { b.y = r.y + r.h + BALL_R + 0.01; dx = 0; dy = 1; }
  } else { dx /= d; dy /= d; b.x += dx * (BALL_R - d + 0.01); b.y += dy * (BALL_R - d + 0.01); }
  const approach = b.vx * dx + b.vy * dy;
  if (approach < 0) { b.vx -= 1.82 * approach * dx; b.vy -= 1.82 * approach * dy; b.banks++; return true; }
  return false;
}

// The preview, gameplay and tests all use this exact physics. Max 1/120 s steps prevent tunnelling.
// Slope acceleration is weaker than static friction, so an uphill/downhill ball always comes to rest.
export function stepBall(b, course, dt) {
  if (b.stopped || b.status !== "rolling") return b.status;
  if (![b.x, b.y, b.vx, b.vy, b.flight].every(Number.isFinite)) {
    b.x = course.tee.x; b.y = course.tee.y; b.vx = 0; b.vy = 0; b.flight = 0; b.stopped = true; b.status = "stopped"; return b.status;
  }
  const steps = Math.max(1, Math.ceil(clamp(dt, 0, 0.1) * 120)), h = clamp(dt, 0, 0.1) / steps;
  for (let s = 0; s < steps; s++) {
    b.elapsed += h;
    const wasAir = b.flight > 0;
    b.flight = Math.max(0, b.flight - h);
    if (wasAir && b.flight === 0) { b.vx *= 0.63; b.vy *= 0.63; }
    b.x += b.vx * h; b.y += b.vy * h;
    if (b.x < BALL_R) { b.x = BALL_R; if (b.vx < 0) { b.vx *= -0.8; b.banks++; } }
    if (b.x > COURSE_W - BALL_R) { b.x = COURSE_W - BALL_R; if (b.vx > 0) { b.vx *= -0.8; b.banks++; } }
    if (b.y < BALL_R) { b.y = BALL_R; if (b.vy < 0) { b.vy *= -0.8; b.banks++; } }
    if (b.y > COURSE_H - BALL_R) { b.y = COURSE_H - BALL_R; if (b.vy > 0) { b.vy *= -0.8; b.banks++; } }
    if (b.flight <= 0) {
      for (let pass = 0; pass < 2; pass++) for (const wall of course.walls) bounceWall(b, wall);
      const p = surfaceAt(course, b.x, b.y);
      if (p?.type === "water") { b.status = "water"; b.stopped = true; b.vx = 0; b.vy = 0; return b.status; }
      const speed = Math.hypot(b.vx, b.vy), cupDistance = Math.hypot(b.x - course.cup.x, b.y - course.cup.y);
      if (cupDistance < 12 && speed < 155) {
        b.x = course.cup.x; b.y = course.cup.y; b.vx = 0; b.vy = 0; b.status = "holed"; b.stopped = true; return b.status;
      }
      if (cupDistance < 24 && speed < 70 && speed > 1) { b.vx += (course.cup.x - b.x) * h * 4; b.vy += (course.cup.y - b.y) * h * 4; }
      if (p?.type === "slope" && speed > 9) { b.vx += p.ax * h; b.vy += p.ay * h; }
      const drag = p?.type === "sand" ? 242 : p?.type === "rough" ? 181 : p?.type === "ice" ? 42 : 108;
      const afterSlope = Math.hypot(b.vx, b.vy), next = Math.max(0, afterSlope - drag * h);
      const k = afterSlope > 0 ? next / afterSlope : 0;
      b.vx *= k; b.vy *= k;
      if (next < 7 || b.elapsed > 12) { b.vx = 0; b.vy = 0; b.stopped = true; b.status = "stopped"; return b.status; }
    } else {
      const speed = Math.hypot(b.vx, b.vy), k = speed > 0 ? Math.max(0, speed - 12 * h) / speed : 0;
      b.vx *= k; b.vy *= k;
    }
  }
  return b.status;
}

export function powerAt(seconds) {
  const q = Math.max(0, seconds - HOLD_THRESHOLD) / CHARGE_SECONDS;
  const wave = q % 2;
  return wave <= 1 ? wave : 2 - wave;
}

export const GUIDE = [
  { head: "TEE OFF", lines: ["TAP switches club: the PUTTER rolls and banks, the WEDGE hops over walls and water.",
    "HOLD to stop the turning arrow. Keep holding: the power rises, then falls.",
    "RELEASE to shoot. The dotted line and ring show exactly where the ball will stop.", "Nine holes. Water costs a stroke. Fewest strokes wins."],
    lamps: [{ rgb: LAMP.green, label: "ARROW, THEN", sub: "a spot follows the aim" }, { rgb: LAMP.green, label: "POWER", sub: "fills as you hold" },
      { rgb: LAMP.red, label: "POWER", sub: "red: the shot finds water" }, { rgb: LAMP.amber, label: "WHERE IT STOPS", sub: "green: in the cup" }] },
];

const signed = (n) => n > 0 ? "+" + n : n === 0 ? "E" : String(n);
const golfWord = (strokes, par, picked) => picked ? "PICKED UP" : strokes === 1 ? "HOLE IN ONE!" : strokes <= par - 2 ? "EAGLE!" : strokes === par - 1 ? "BIRDIE" : strokes === par ? "PAR" : strokes === par + 1 ? "BOGEY" : "+" + (strokes - par) + " ON THE HOLE";

export class PocketLinks {
  constructor(ctx) {
    this.c = ctx;
    this.lamps = new LampBus(ctx);
    this.sv = migrateSave(ctx.progress?.());
    this.t = 0; this.phase = "title"; this.stage = "aim"; this.hole = 0;
    this.course = makeCourse(0); this.ball = shotBall(this.course.tee.x, this.course.tee.y, 0, 0, 0);
    this.ball.stopped = true; this.ball.status = "stopped"; this.ball.vx = 0;
    this.card = []; this.club = 0; this.strokes = 0; this.total = 0; this.parTotal = 0;
    this.mulligans = 3; this.held = false; this.downAt = 0; this.consume = false;
    this.aimBase = 0; this.aimStart = 0; this.lockedAim = 0; this.power = 0;
    this.preview = []; this.previewEnd = null; this.previewAt = -1; this.landing = null;
    this.overAt = 0; this.holeAt = 0; this.waterAt = 0; this.runSeed = 0;
    this.message = ""; this.messageT = 0; this.lastShot = { x: this.ball.x, y: this.ball.y };
    this.shotTrace = []; this.traceAt = 0; this.bounceAt = -1; this.finished = false; this.titleT = 0;
    this.guide = -1; this.shotEnd = null;
    this.c.hint("TAP changes club. HOLD to lock aim; RELEASE to choose power. No rush.");
    this.guard = new AppGuard(this, ctx);
  }
  latency() {
    const n = Number(this.c.settings?.()?.latencyMs);
    return Number.isFinite(n) ? clamp(n, -150, 300) / 1000 : 0;
  }
  aimAt(secondsAgo = 0) { return this.aimBase + (this.t - this.aimStart - secondsAgo) * AIM_SPEED; }
  start() {
    this.phase = "play"; this.hole = 0; this.card = []; this.total = 0; this.parTotal = 0;
    this.mulligans = 3; this.runSeed = this.c.rng.int(1, 0x7fffffff); this.finished = false;
    this.loadHole();
  }
  loadHole() {
    this.course = makeCourse(this.hole, (this.runSeed >>> (this.hole * 3)) & 255);
    this.strokes = 0; this.club = 0; this.shotTrace = []; this.message = ""; this.messageT = 0;
    this.ball = shotBall(this.course.tee.x, this.course.tee.y, 0, 0, 0);
    this.ball.stopped = true; this.ball.status = "stopped"; this.ball.vx = 0; this.ball.vy = 0;
    this.lastShot = { x: this.ball.x, y: this.ball.y };
    this.ready();
  }
  ready() {
    this.stage = "aim"; this.held = false; this.power = 0;
    // Start just before the cup bearing. A useful first shot is available in less than a second.
    this.aimBase = Math.atan2(this.course.cup.y - this.ball.y, this.course.cup.x - this.ball.x) - 0.34;
    this.aimStart = this.t; this.lockedAim = this.aimBase; this.previewAt = -1;
    this.c.hint("Watch the arrow. HOLD to lock aim, then RELEASE at the power you want. TAP changes club.");
    this.makePreview();
  }
  down() {
    this.guard.mark();
    if (this.guide >= 0) { this.held = true; this.downAt = this.t; return; }
    if (this.phase === "title" && !this.sv.guided) { this.guide = 0; this.consume = true; return; }
    if (this.phase === "title") { this.start(); this.consume = true; return; }
    if (this.phase === "over") { if (this.t - this.overAt >= LOCKOUT) { this.start(); this.consume = true; } return; }
    if (this.stage === "card") {
      if (this.t - this.holeAt < LOCKOUT) return;
      this.hole++; this.loadHole(); this.consume = true; return;
    }
    if (this.stage === "water") {
      if (this.t - this.waterAt < LOCKOUT) return;
      this.held = true; this.downAt = this.t; return;
    }
    if (this.stage !== "aim" || this.held) return;
    this.held = true; this.downAt = this.t; this.lockedAim = this.aimAt(this.latency());
    this.stage = "charge"; this.power = 0; this.previewAt = -1;
    this.c.hint("Aim locked. RELEASE when the predicted shot and power look right. Power rises and falls slowly.");
  }
  up(e = {}) {
    this.guard.release();
    if (this.consume) { this.consume = false; this.held = false; return; }
    if (this.guide >= 0) {
      if (!this.held) return;
      this.held = false;
      const seconds = Number.isFinite(e.durationMs) ? e.durationMs / 1000 : this.t - this.downAt;
      if (seconds < HOLD && this.guide < GUIDE.length - 1) this.guide++; else this.closeGuide();
      return;
    }
    if (!this.held || this.phase !== "play") return;
    const duration = this.t - this.downAt;
    this.held = false;
    if (this.stage === "water") { this.relief(duration >= 0.6); return; }
    if (this.stage !== "charge") return;
    const externalMs = Number(e.durationMs);
    const heldForTap = Number.isFinite(externalMs) ? Math.max(duration, externalMs / 1000) : duration;
    if (heldForTap < HOLD_THRESHOLD) {
      this.club = 1 - this.club; this.stage = "aim"; this.previewAt = -1;
      this.message = this.club === 1 ? "WEDGE: hop obstacles; mind the landing" : "PUTTER: bank shots and precise distance";
      this.messageT = 2.6;
      this.c.tone(this.club ? 620 : 420, 0.05, "triangle");
      this.c.hint("TAP changes club. HOLD locks the arrow; RELEASE sets power.");
      this.makePreview(); return;
    }
    const judged = Math.max(0, duration - this.latency());
    this.shoot(powerAt(judged), this.lockedAim);
  }
  openGuide() { this.guide = 0; this.held = false; this.consume = false; if (this.stage === "charge") this.ready(); }
  closeGuide() {
    this.guide = -1;
    if (!this.sv.guided) { this.sv.guided = true; this.c.saveProgress(JSON.parse(JSON.stringify(this.sv)))?.catch?.(this.c.error); }
    if (this.phase === "title") this.start();
  }
  menuActions() {
    return [{ label: "HOW TO PLAY", run: () => this.openGuide() }, { label: "NEW ROUND", run: () => { this.guide = -1; this.start(); } }];
  }
  shoot(power, angle) {
    if (this.stage !== "charge" && this.stage !== "aim") return;
    this.power = power; this.lockedAim = angle; this.stage = "charge"; this.makePreview();
    this.lastShot = { x: this.ball.x, y: this.ball.y };
    this.ball = shotBall(this.ball.x, this.ball.y, angle, power, this.club);
    this.shotEnd = this.previewEnd;
    this.strokes++; this.stage = "rolling"; this.held = false; this.preview = []; this.previewEnd = null;
    this.shotTrace = [{ x: this.ball.x, y: this.ball.y }]; this.traceAt = this.t;
    this.c.tone(this.club ? 470 : 330, 0.07, "triangle");
    this.c.hint(this.club ? "Wedge in flight: the white ring is its landing spot." : "Ball in play. Walls bank; sand and rough slow the roll.");
  }
  relief(useMulligan) {
    if (this.stage !== "water") return;
    if (useMulligan && this.mulligans > 0) { this.mulligans--; this.strokes = Math.max(0, this.strokes - 1); this.message = "MULLIGAN — that shot never happened"; }
    else { this.strokes++; this.message = "RELIEF — one penalty stroke"; }
    this.messageT = 2.8;
    this.ball = shotBall(this.lastShot.x, this.lastShot.y, 0, 0, 0);
    this.ball.vx = 0; this.ball.vy = 0; this.ball.stopped = true; this.ball.status = "stopped";
    if (this.strokes >= MAX_STROKES) this.finishHole(true); else this.ready();
  }
  finishHole(picked = false) {
    if (this.stage === "card" || this.phase === "over") return;
    this.strokes = clamp(this.strokes, 1, MAX_STROKES);
    this.card.push({ strokes: this.strokes, par: this.course.par, picked });
    this.total += this.strokes; this.parTotal += this.course.par; this.held = false;
    this.message = golfWord(this.strokes, this.course.par, picked); this.messageT = 0;
    this.lamps.flash(0.8, () => fill(picked ? LAMP.amber : LAMP.green, 1, lampCount(this.c)));
    this.c.tone(picked ? 200 : this.strokes < this.course.par ? 740 : 560, 0.2, "triangle");
    if (this.hole === 8) { this.end(); return; }
    this.stage = "card"; this.holeAt = this.t;
    this.c.hint("Hole complete. Take a breath; PRESS for the next hole.");
  }
  end() {
    if (this.finished) return;
    this.finished = true; this.phase = "over"; this.overAt = this.t;
    const birdies = this.card.filter((r) => !r.picked && r.strokes < r.par).length;
    const aces = this.card.filter((r) => !r.picked && r.strokes === 1).length;
    const score = Math.max(100, 12000 - this.total * 100) + birdies * 50;
    this.sv.runs = Math.min(1000000, this.sv.runs + 1); this.sv.milestone = 9;
    this.sv.bestStrokes = this.sv.bestStrokes ? Math.min(this.sv.bestStrokes, this.total) : this.total;
    this.sv.last = { score, strokes: this.total, par: this.parTotal, holes: this.card.length, birdies, aces, mulligans: 3 - this.mulligans };
    this.c.score(score);
    this.c.saveProgress(JSON.parse(JSON.stringify(this.sv)))?.catch?.(this.c.error);
    this.c.hint("Round complete. PRESS for a freshly arranged nine.");
  }
  makePreview() {
    if (this.stage !== "aim" && this.stage !== "charge") return;
    const power = this.stage === "charge" ? this.power : 0.56;
    const angle = this.stage === "charge" ? this.lockedAim : this.aimAt();
    const b = shotBall(this.ball.x, this.ball.y, angle, power, this.club);
    const points = [{ x: b.x, y: b.y, air: b.flight > 0 }];
    let landing = null;
    for (let i = 0; i < 400; i++) {
      const airborne = b.flight > 0;
      stepBall(b, this.course, 1 / 30);
      if (airborne && b.flight <= 0) landing = { x: b.x, y: b.y };
      if (i % 5 === 0 || b.stopped) points.push({ x: b.x, y: b.y, air: b.flight > 0 });
      if (b.stopped) break;
    }
    this.preview = points; this.previewEnd = { x: b.x, y: b.y, status: b.status };
    this.landing = landing; this.previewAt = this.t;
  }
  update(dt) {
    this.guard.tick(dt);
    this.t += dt; this.messageT = Math.max(0, this.messageT - dt);
    if (this.phase === "play" && this.guide < 0) {
      if (this.stage === "charge") this.power = powerAt(this.t - this.downAt);
      if ((this.stage === "aim" || this.stage === "charge") && this.t - this.previewAt >= 0.10) this.makePreview();
      if (this.stage === "rolling") {
        const banks = this.ball.banks, status = stepBall(this.ball, this.course, dt);
        if (this.ball.banks !== banks && this.t - this.bounceAt > 0.11) { this.c.tone(180 + Math.min(180, Math.hypot(this.ball.vx, this.ball.vy)), 0.035, "triangle"); this.bounceAt = this.t; }
        if (this.t - this.traceAt > 0.09) { this.shotTrace.push({ x: this.ball.x, y: this.ball.y }); if (this.shotTrace.length > 42) this.shotTrace.shift(); this.traceAt = this.t; }
        if (status === "holed") this.finishHole(false);
        else if (status === "water") {
          this.stage = "water"; this.waterAt = this.t; this.held = false;
          this.lamps.flash(0.4, () => fill(LAMP.blue, 1, lampCount(this.c))); this.c.tone(120, 0.18, "sine");
          this.c.hint(this.mulligans ? "Water! TAP takes relief (+1 stroke). HOLD 0.6s and release to use a mulligan." : "Water! PRESS to take relief at the last safe spot (+1 stroke).");
        } else if (status === "stopped") {
          if (this.strokes >= MAX_STROKES) this.finishHole(true); else this.ready();
        }
      }
    }
    this.c.hud([["HOLE", Math.min(9, this.hole + 1) + "/9"], ["STROKES", this.strokes], ["ROUND", signed(this.total - this.parTotal)], ["MULLIGANS", this.mulligans]]);
    let lights;
    if (this.guide >= 0) lights = lamps(dim(LAMP.green, 0.5), dim(LAMP.green, 0.5), dim(LAMP.red, 0.5));
    else if (this.phase === "title") lights = lamps(dim(LAMP.green, 0.35), dim(LAMP.cyan, 0.3 + 0.2 * Math.sin(this.t * 1.7)), dim(LAMP.amber, 0.35));
    else if (this.phase === "over" || this.stage === "card") lights = fill(LAMP.green, 0.35 + 0.2 * Math.sin(this.t * 2));
    else if (this.stage === "water") lights = lamps(dim(LAMP.blue, 0.65), this.mulligans ? dim(LAMP.amber, 0.45) : null, this.held && this.t - this.downAt >= 0.6 ? LAMP.green : null);
    else if (this.stage === "charge") lights = meter(this.power, this.previewEnd?.status === "water" ? LAMP.red : this.club ? LAMP.cyan : LAMP.green, [3, 12, 5]);
    else if (this.stage === "rolling") lights = lamps(dim(this.club ? LAMP.cyan : LAMP.green, 0.45), dim(LAMP.white, clamp(Math.hypot(this.ball.vx, this.ball.vy) / 380, 0.06, 0.8)), dim(this.ball.flight > 0 ? LAMP.cyan : LAMP.green, 0.35));
    else {
      const direction = (Math.sin(this.aimAt()) + 1) / 2;
      lights = spot(direction, this.club ? LAMP.cyan : LAMP.green, 1.2);
    }
    this.lamps.frame(dt, withFourth(lights, this.verdictLamp(), lampCount(this.c)));
  }
  // Lamp 4: where the shot on show (or in the air) will stop.
  verdictLamp() {
    if (this.guide >= 0) return dim(LAMP.amber, 0.5);
    if (this.phase === "title") return dim(LAMP.amber, 0.25);
    if (this.phase === "over" || this.stage === "card") return dim(LAMP.green, 0.35 + 0.2 * Math.sin(this.t * 2));
    if (this.stage === "water") return dim(LAMP.red, 0.7);
    const end = this.stage === "rolling" ? this.shotEnd : this.previewEnd;
    if (!end) return null;
    if (end.status === "holed") return dim(LAMP.green, 0.95);
    if (end.status === "water") return dim(LAMP.red, 0.8);
    const near = 1 - clamp(Math.hypot(end.x - this.course.cup.x, end.y - this.course.cup.y) / 320, 0, 1);
    return dim(LAMP.amber, 0.06 + 0.6 * near * near);
  }
  cancel() {
    const rewound = this.guard.rewind();
    this.lamps.clear(); this.held = false; this.consume = false;
    if (!rewound && this.stage === "charge") this.ready();
    this.c.synth?.stopTone?.();
  }
  pause() { this.guard.settle(); this.lamps.sleep(); this.c.synth?.stopTone?.(); }
  resume() { this.lamps.wake(); }
  dispose() { this.guard.settle(); this.lamps.sleep(); this.c.synth?.stopTone?.(); }

  drawCourse(g) {
    g.fillStyle = "#101e15"; g.fillRect(X - 7, Y - 7, COURSE_W + 14, COURSE_H + 14);
    g.fillStyle = "#263e29"; g.fillRect(X, Y, COURSE_W, COURSE_H);
    // Six wide mowing stripes are inexpensive, quiet depth cues.
    g.fillStyle = "#2a432d";
    for (let i = 0; i < 6; i++) g.fillRect(X + 2 + i * 113, Y + 2, 56, COURSE_H - 4);
    for (const p of this.course.patches) {
      g.fillStyle = SURFACE_COLORS[p.type]; g.fillRect(X + p.x, Y + p.y, p.w, p.h);
      if (p.type === "water") {
        for (let yy = 15; yy < p.h; yy += 28) for (let xx = 13; xx < p.w - 7; xx += 39) line(g, X + p.x + xx, Y + p.y + yy, X + p.x + xx + 14, Y + p.y + yy, "#417b7c", 1);
      } else if (p.type === "sand") {
        for (let yy = 10; yy < p.h; yy += 20) for (let xx = 10; xx < p.w; xx += 25) { g.fillStyle = "#a3915e"; g.fillRect(X + p.x + xx, Y + p.y + yy, 2, 2); }
      } else if (p.type === "slope") {
        const dy = p.ay < 0 ? -7 : 7;
        for (let yy = 24; yy < p.h - 10; yy += 48) for (let xx = 28; xx < p.w - 10; xx += 50) {
          const px = X + p.x + xx, py = Y + p.y + yy;
          line(g, px, py - dy, px, py + dy, "#718c67", 1); line(g, px - 4, py, px, py + dy, "#718c67", 1); line(g, px + 4, py, px, py + dy, "#718c67", 1);
        }
      } else if (p.type === "ice") {
        for (let xx = 20; xx < p.w; xx += 54) line(g, X + p.x + xx, Y + p.y + 12, X + p.x + Math.min(p.w - 8, xx + 30), Y + p.y + p.h - 12, "#668c88", 1);
      } else if (p.type === "rough") {
        for (let yy = 10; yy < p.h; yy += 23) for (let xx = 12; xx < p.w; xx += 30) line(g, X + p.x + xx, Y + p.y + yy, X + p.x + xx - 3, Y + p.y + yy + 6, "#3b5d37", 1);
      }
    }
    for (const w of this.course.walls) {
      g.fillStyle = "#0f1913"; g.fillRect(X + w.x + 4, Y + w.y + 5, w.w, w.h);
      g.fillStyle = "#6f8059"; g.fillRect(X + w.x, Y + w.y, w.w, w.h);
      g.strokeStyle = "#a7b57c"; g.lineWidth = 1; g.strokeRect(X + w.x + 1, Y + w.y + 1, w.w - 2, w.h - 2);
    }
    g.strokeStyle = "#7f9c69"; g.lineWidth = 3; g.strokeRect(X, Y, COURSE_W, COURSE_H);
    const c = this.course.cup;
    circle(g, X + c.x, Y + c.y, 18, "#456a43"); circle(g, X + c.x, Y + c.y, 10.5, "#09130e", true);
    line(g, X + c.x, Y + c.y - 3, X + c.x, Y + c.y - 39, C.ink, 2);
    g.fillStyle = C.amber; g.beginPath(); g.moveTo(X + c.x + 1, Y + c.y - 39); g.lineTo(X + c.x + 22, Y + c.y - 32); g.lineTo(X + c.x + 1, Y + c.y - 25); g.closePath(); g.fill();
    text(g, this.hole + 1, X + c.x + 8, Y + c.y - 32, 10, C.bg, "center");
    // A faint previous-shot trace helps a player learn a bank or correct an overshoot.
    for (let i = 2; i < this.shotTrace.length; i += 2) { const p = this.shotTrace[i]; circle(g, X + p.x, Y + p.y, 1.2, "#688560", true); }
    if (this.stage === "aim" || this.stage === "charge") {
      const previewColor = this.previewEnd?.status === "water" ? C.red : this.club ? C.cyan : "#b8ca8d";
      for (let i = 1; i < this.preview.length; i++) { const p = this.preview[i]; circle(g, X + p.x, Y + p.y, p.air ? 2.2 : 1.6, previewColor, true); }
      if (this.previewEnd) {
        const p = this.previewEnd;
        circle(g, X + p.x, Y + p.y, p.status === "holed" ? 15 : 7, p.status === "holed" ? C.amber : previewColor, false, p.status === "holed" ? 2.5 : 1.4);
        if (p.status !== "stopped") text(g, p.status === "holed" ? "IN!" : "WATER", X + p.x, Y + p.y - 24, 14, p.status === "holed" ? C.amber : C.red, "center");
      }
      if (this.landing && this.club) circle(g, X + this.landing.x, Y + this.landing.y, 11, C.cyan, false, 1.5);
      const a = this.stage === "charge" ? this.lockedAim : this.aimAt(), bx = X + this.ball.x, by = Y + this.ball.y;
      const ax = bx + Math.cos(a) * 40, ay = by + Math.sin(a) * 40;
      line(g, bx, by, ax, ay, this.club ? C.cyan : C.ink, 2.5);
      line(g, ax, ay, ax - Math.cos(a - 0.55) * 10, ay - Math.sin(a - 0.55) * 10, C.ink, 2);
      line(g, ax, ay, ax - Math.cos(a + 0.55) * 10, ay - Math.sin(a + 0.55) * 10, C.ink, 2);
    }
    const b = this.ball;
    if (this.stage === "rolling" && b.flight > 0 && this.landing) circle(g, X + this.landing.x, Y + this.landing.y, 11, C.cyan, false, 1.5);
    if (this.stage !== "water" && !(b.status === "holed" && this.stage === "card")) {
      const rise = b.flight > 0 && b.flightTotal > 0 ? Math.sin(Math.PI * (1 - b.flight / b.flightTotal)) * 17 : 0;
      // A visible locator halo, separate from the small collision radius, survives the host's scaling.
      circle(g, X + b.x, Y + b.y - rise, 10.5, "#08160e", false, 3);
      circle(g, X + b.x, Y + b.y - rise, 9.5, this.stage === "rolling" ? "#d9efaa" : "#aecb88", false, 1.3);
      circle(g, X + b.x + 2, Y + b.y + 4, 6, "#102416", true);
      circle(g, X + b.x, Y + b.y - rise, BALL_R + (rise > 0 ? 1 : 0), "#f4f4ca", true);
      circle(g, X + b.x, Y + b.y - rise, BALL_R + 1, "#071309", false, 1.5);
    }
  }
  drawSidebar(g) {
    const sx = 734;
    g.fillStyle = "#15251a"; g.fillRect(sx - 5, 97, 207, 342);
    text(g, "HOLE " + (this.hole + 1) + " / 9", sx + 10, 122, 18, C.ink);
    text(g, "PAR " + this.course.par, sx + 10, 152, 28, C.amber);
    text(g, this.strokes + " STROKE" + (this.strokes === 1 ? "" : "S"), sx + 10, 183, 18, C.muted);
    line(g, sx + 10, 204, sx + 181, 204, C.line, 1);
    const y = 229;
    if (this.stage === "water") {
      text(g, "WATER RELIEF", sx + 10, y, 18, C.cyan);
      text(g, "TAP: +1 penalty", sx + 10, y + 34, 14, C.ink);
      text(g, "HOLD: mulligan", sx + 10, y + 61, 14, this.mulligans ? C.amber : C.muted);
      text(g, this.mulligans + " remaining", sx + 10, y + 86, 14, C.muted);
      if (this.held) { g.fillStyle = C.amber; g.fillRect(sx + 10, y + 110, 160 * clamp((this.t - this.downAt) / 0.6, 0, 1), 8); }
    } else {
      text(g, this.stage === "rolling" ? "BALL IN PLAY" : this.stage === "charge" ? "2  SET POWER" : this.stage === "card" ? "HOLE COMPLETE" : "1  CHOOSE AIM", sx + 10, y, 16, C.ink);
      text(g, CLUBS[this.club], sx + 10, y + 32, 24, this.club ? C.cyan : C.ink);
      text(g, this.club ? "Hops then rolls" : "Rolls and banks", sx + 10, y + 57, 14, C.muted);
      if (this.stage === "charge") {
        text(g, Math.round(this.power * 100) + "%", sx + 10, y + 94, 30, this.previewEnd?.status === "water" ? C.red : C.amber);
        text(g, "RELEASE TO SHOOT", sx + 10, y + 125, 14, C.ink);
      } else {
        const p = surfaceAt(this.course, this.ball.x, this.ball.y);
        text(g, "LIE: " + (p ? p.type.toUpperCase() : "GREEN"), sx + 10, y + 93, 14, C.muted);
        text(g, this.mulligans + " MULLIGANS", sx + 10, y + 124, 14, C.amber);
      }
    }
    text(g, "ROUND " + signed(this.total - this.parTotal), sx + 10, 420, 16, C.muted);
  }
  draw(g) {
    if (this.guide >= 0) { drawGuide(g, "POCKET LINKS", GUIDE, this.guide, lampCount(this.c)); return; }
    g.save(); g.globalAlpha = 1; g.fillStyle = C.bg; g.fillRect(0, 0, 960, 540);
    if (this.phase === "title") { this.drawTitle(g); g.restore(); return; }
    if (this.phase === "over") { this.drawResult(g); g.restore(); return; }
    text(g, "POCKET LINKS", 30, 30, 18, C.muted);
    text(g, this.course.name, 30, 67, 29, C.ink);
    text(g, "A NINE-HOLE ESCAPE", 930, 31, 14, C.muted, "right");
    this.drawCourse(g); this.drawSidebar(g);
    if (this.stage === "card") {
      g.fillStyle = "#102017"; g.fillRect(151, 213, 440, 117); g.strokeStyle = C.amber; g.lineWidth = 1; g.strokeRect(151, 213, 440, 117);
      text(g, this.message, 371, 247, 31, C.amber, "center");
      text(g, this.strokes + " strokes · " + signed(this.strokes - this.course.par) + " to par", 371, 280, 18, C.ink, "center");
      text(g, "PRESS FOR THE NEXT HOLE", 371, 310, 14, C.muted, "center");
    }
    if (this.stage === "charge") {
      text(g, "POWER", 31, 470, 15, C.muted);
      g.fillStyle = C.dark; g.fillRect(103, 458, 605, 22);
      g.fillStyle = this.previewEnd?.status === "water" ? C.red : this.club ? C.cyan : C.ink;
      g.fillRect(103, 458, 605 * this.power, 22);
      for (let i = 1; i < 4; i++) line(g, 103 + 605 * i / 4, 457, 103 + 605 * i / 4, 482, C.bg, 2);
      text(g, this.previewEnd?.status === "water" ? "RED PREVIEW = WATER. Keep holding for another power." : "The dotted path and rings preview this exact power.", 30, 507, 16, this.previewEnd?.status === "water" ? C.red : C.muted);
    } else {
      const tip = this.stage === "water" ? "TAP: take relief (+1). HOLD & RELEASE: spend a mulligan." : this.stage === "rolling" ? "Watch the bounce. Plan the next shot." : this.stage === "card" ? "Every hole has a way through. Next one?" : "HOLD locks aim → keep holding for power → RELEASE shoots";
      text(g, tip, 30, 468, 17, C.ink);
      text(g, this.messageT > 0 ? this.message : this.course.lesson, 30, 505, 17, this.messageT > 0 ? C.amber : C.muted);
    }
    g.restore();
  }
  drawTitle(g) {
    text(g, "A VESPER FIELD CLUB CARTRIDGE", 45, 37, 15, C.muted);
    text(g, "POCKET", 45, 113, 63, C.ink); text(g, "LINKS", 45, 177, 63, C.ink);
    text(g, "NINE SMALL COURSES.", 49, 234, 21, C.amber); text(g, "BIG LITTLE DECISIONS.", 49, 264, 21, C.amber);
    const ox = 483, oy = 65, w = 419, h = 263;
    g.fillStyle = "#263e29"; g.fillRect(ox, oy, w, h); g.strokeStyle = "#809e69"; g.lineWidth = 3; g.strokeRect(ox, oy, w, h);
    g.fillStyle = "#184448"; g.fillRect(ox + 145, oy + 61, 91, 135);
    for (let i = 0; i < 5; i++) line(g, ox + 157, oy + 78 + i * 25, ox + 213, oy + 78 + i * 25, "#417b7c", 1);
    g.fillStyle = "#7f8059"; g.fillRect(ox + 276, oy + 114, 16, 149);
    circle(g, ox + 355, oy + 62, 10, C.bg, true);
    line(g, ox + 355, oy + 59, ox + 355, oy + 24, C.ink, 2);
    g.fillStyle = C.amber; g.fillRect(ox + 356, oy + 24, 19, 10);
    // The little diagram explains an airborne shortcut, with no animation needed to read it.
    g.strokeStyle = C.cyan; g.lineWidth = 2; g.setLineDash([4, 7]); g.beginPath(); g.moveTo(ox + 43, oy + 214); g.quadraticCurveTo(ox + 159, oy + 84, ox + 252, oy + 80); g.stroke(); g.setLineDash([]);
    circle(g, ox + 43, oy + 214, 6.5, C.ink, true); circle(g, ox + 252, oy + 80, 10, C.cyan);
    text(g, "BANK IT. HOP IT. NURSE IT HOME.", 691, 359, 16, C.muted, "center");
    text(g, "TAP", 48, 354, 18, C.cyan); text(g, "change putter / wedge", 134, 354, 18, C.ink);
    text(g, "HOLD", 48, 389, 18, C.cyan); text(g, "freeze the aiming arrow", 134, 389, 18, C.ink);
    text(g, "RELEASE", 48, 424, 18, C.cyan); text(g, "choose shot power", 134, 424, 18, C.ink);
    text(g, this.sv.guided ? "PRESS TO TEE OFF" : "PRESS TO LEARN HOW TO PLAY", 480, 490, 25, C.amber, "center");
    if (this.sv.bestStrokes) text(g, "BEST NINE: " + this.sv.bestStrokes + " STROKES", 902, 410, 16, C.muted, "right");
  }
  drawResult(g) {
    text(g, "POCKET LINKS / CLUBHOUSE", 45, 39, 18, C.muted);
    text(g, "NINE WELL SPENT.", 45, 105, 47, C.ink);
    text(g, this.total + " STROKES", 47, 170, 35, C.amber);
    text(g, signed(this.total - this.parTotal) + " TO PAR " + this.parTotal, 435, 169, 23, C.ink);
    text(g, "HOLE", 52, 242, 15, C.muted); text(g, "PAR", 52, 287, 15, C.muted); text(g, "YOU", 52, 334, 15, C.muted);
    for (let i = 0; i < 9; i++) {
      const x = 163 + i * 81, r = this.card[i]; if (!r) continue;
      g.fillStyle = r.strokes <= r.par ? "#243c27" : "#222d20"; g.fillRect(x - 25, 219, 59, 143);
      text(g, i + 1, x + 4, 242, 18, C.muted, "center");
      text(g, r.par, x + 4, 287, 21, C.muted, "center");
      text(g, r.picked ? "12*" : r.strokes, x + 4, 334, 24, r.strokes < r.par ? C.cyan : C.ink, "center");
    }
    text(g, "BIRDIES OR BETTER " + this.sv.last.birdies + "     ACES " + this.sv.last.aces + "     MULLIGANS " + (3 - this.mulligans) + "/3", 48, 402, 17, C.muted);
    text(g, "BEST NINE: " + this.sv.bestStrokes + " STROKES", 48, 441, 19, C.ink);
    text(g, "PRESS FOR A NEW ROUND", 480, 500, 24, C.amber, "center");
  }
}
