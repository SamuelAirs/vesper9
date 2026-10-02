// RICOCHET — a one-button breakout. A signal (the ball) bounces through a lattice
// of cells. The paddle never stops: it glides left and right and bounces off the
// walls by itself. A tap REVERSES it; that is the whole control scheme (a hold
// longer than a tap freezes the world, so the long press of the menu gesture is harmless).
// Where the ball meets the paddle sets its rebound angle. A bracket under the chamber marks where the
// ball will next reach paddle height (found by running the same collision code on
// a scratch copy of the ball, so it is exact until something changes the path).
//
// The three lamps show the ball: a spot of light that moves left to right with it,
// green when high, amber, then red as it drops toward the paddle line. Each broken
// cell sparkles the lamp over that third of the lattice.
//
// The world advances only in update(dt). Collision runs in sub-steps of at most
// STEP pixels, smaller than the ball radius, so nothing tunnels at MAX_SPEED.
//
// Within a run: after each chamber from the second, a choice of two upgrades (tap switches, hold
// takes; lamp I or III shows which is highlighted, so it can be chosen by the lamps alone).
// Between runs: charge cells from chamber 4 (breaking one breaks its eight neighbours, and a
// charge can set off another), seventeen feats (two hidden), a daily order with a streak, and a
// rank from feats, in a versioned save (schema 2) that keeps the first release's fields.
import { clamp } from "../engine/math.js";
import { C, text, line, circle, diamond, space, banner } from "../engine/draw.js";
import { LAMP, lamps, spot, ramp, dim, pulse, chase, lightsOff } from "../engine/lightshow.js";
import { AppGuard } from "../engine/input.js";
import { num, hashText, dateKey, cleanDaily, meetDaily, dailyDone, liveStreak, cleanFeats, newlyMet, closestFeat, rankOf, nextRank, drawFeatTicker, panel } from "./goals.js";

// Chamber geometry in the 960 x 540 logical space.
const L = 120, R = 840, TOP = 40; // side walls and ceiling
const COLS = 12, CW = (R - L) / COLS, RH = 28, GY = 140, ROWS_MAX = 8; // lattice
const BALL_R = 8;
const PAD_Y = 484, PAD_H = 10; // top edge of the paddle
const LOST_Y = 560; // a ball below this is gone
const STEP = 3.5; // largest distance moved between collision checks
const MIN_VY = 0.3, MIN_VX = 0.05; // smallest share of speed on each axis
const MAX_ANGLE = 1.05; // widest rebound off the paddle, from vertical (60 degrees)
const MAX_SPEED = 560;
const WIDE_TIME = 14, SLOW_TIME = 12;
const FREEZE_AFTER = 0.6; // seconds held before the world freezes (a tap is far shorter)
const LIVES = 3;
const FREE_BALLS = 2; // chamber 1 is practice: a newcomer learns the paddle before lives count
const DROP_SPEED = 130;
const SCALE = [262, 294, 330, 392, 440, 494, 523];

const baseSpeed = (ch) => Math.min(500, 340 + 20 * (ch - 1));
const padSpeed = (ch) => Math.min(420, 320 + 10 * (ch - 1));
const PAD_WIDTHS = [168, 156, 144, 132, 120, 110, 100, 92, 84];
const padWidth = (ch) => PAD_WIDTHS[Math.min(PAD_WIDTHS.length - 1, ch - 1)];
// Rows of cells per chamber. Kept low so a chamber takes a minute or two, not five: later chambers get
// harder through speed, paddle width, hard and charge cells rather than sheer size.
const rowsFor = (ch) => (ch < 4 ? 3 : ch < 8 ? 4 : 5);
const NEWS = {
  1: "PRACTICE: TWO FREE BALLS", 2: "NEW: BONUS CELLS", 3: "NEW: HARDENED CELLS",
  4: "NEW: CHARGE CELLS BREAK THEIR NEIGHBOURS",
};
export const CHARGE_FROM = 4;
// Upgrades offered between chambers. `max` is how often one can be taken in a run.
export const UPGRADES = [
  { id: "wide", name: "WIDER PADDLE", text: "The paddle is 10 % wider.", max: 3 },
  { id: "spare", name: "SPARE BALL", text: "One more ball.", max: 2 },
  { id: "chain", name: "STEADY CHAIN", text: "The chain survives one paddle touch.", max: 1 },
  { id: "serve", name: "CHARGED SERVE", text: "Each served ball's first cell goes off like a charge.", max: 1 },
  { id: "quick", name: "QUICK PADDLE", text: "The paddle glides 10 % faster.", max: 2 },
  { id: "slow", name: "HEAVY SIGNAL", text: "The ball travels 6 % slower.", max: 2 },
  { id: "luck", name: "SALVAGE", text: "One more pair of bonus cells in each chamber.", max: 1 },
];
export const PICK_FROM = 2;  // the first choice follows chamber 2
export const PICK_HOLD = 0.5; // a press held this long takes the highlighted upgrade
export const PICK_TIME = 8;   // left alone, the highlighted upgrade is taken after this long
// Each chamber has its own cell colours: [fill, alternate row, edge].
const THEMES = [["#223b29", "#1d3323", "#d6efa4"], ["#1d3638", "#18302f", "#8fcbc5"], ["#2b2640", "#241f37", "#b7a6e8"],
  ["#3a2a1e", "#32241a", "#e7b879"], ["#203327", "#1a2b21", "#a8e0b0"], ["#35202a", "#2d1b23", "#eb947a"]];

// ---- feats, ranks and the daily order --------------------------------------------------------
const life = (a, key) => (a.sv.st[key] || 0) + (a.R[key] || 0);
export const RICOCHET_FEATS = [
  { id: "practice", name: "QUICK STUDY", text: "Clear chamber 1 without losing a ball.", n: 1, prog: (a) => a.R.practice },
  { id: "ch5", name: "FIFTH CHAMBER", text: "Reach chamber 5.", n: 5, prog: (a) => a.chamber },
  { id: "ch8", name: "DEEP LATTICE", text: "Reach chamber 8.", n: 8, prog: (a) => a.chamber },
  { id: "ch10", name: "THE CORE", text: "Reach chamber 10.", n: 10, prog: (a) => a.chamber },
  { id: "chain8", name: "FULL CHAIN", text: "Reach a chain of x8.", n: 8, prog: (a) => a.bestChain },
  { id: "bonus3", name: "COLLECTOR", text: "Catch 3 bonuses in one run.", n: 3, prog: (a) => a.R.bonuses },
  { id: "twin", name: "TWIN SIGNALS", text: "Clear a chamber with two balls in play.", n: 1, prog: (a) => a.R.twin },
  { id: "sweep", name: "CLEAN SWEEP", text: "Clear a chamber after the first without losing a ball.", n: 1, prog: (a) => a.R.sweep },
  { id: "blast", name: "DEMOLITION", text: "Break 6 cells with one charge.", n: 6, prog: (a) => a.R.blast },
  { id: "relay", name: "CHAIN REACTION", text: "Set off a charge with another charge.", n: 1, prog: (a) => a.R.relay },
  { id: "s5k", name: "FIVE THOUSAND", text: "Score 5000 in one run.", n: 5000, prog: (a) => a.score },
  { id: "s10k", name: "TEN THOUSAND", text: "Score 10000 in one run.", n: 10000, prog: (a) => a.score },
  { id: "cells", name: "WRECKER", text: "Break 1000 cells in all.", n: 1000, prog: (a) => life(a, "cells") },
  { id: "daily", name: "ON ORDERS", text: "Meet a daily order.", n: 1, prog: (a) => life(a, "daily") },
  { id: "streak", name: "ROUTINE", text: "Meet the daily order 3 days running.", n: 3, prog: (a) => a.sv.dl.streak },
  { id: "fitted", name: "OUTFITTED", text: "Take 5 upgrades in one run.", n: 5, prog: (a) => a.R.picks },
  { id: "few", name: "FEW RETURNS", text: "Clear a chamber in 6 paddle touches or fewer.", hint: "Some chambers fall to a handful of returns.", n: 1, hidden: true, prog: (a) => a.R.few },
  { id: "lastball", name: "LAST LIGHT", text: "Clear a chamber on the last ball.", hint: "The last ball can still finish the job.", n: 1, hidden: true, prog: (a) => a.R.lastBall },
];
const FEAT_IDS = RICOCHET_FEATS.map((f) => f.id);
export const RICOCHET_RANKS = [[0, "APPRENTICE"], [2, "BREAKER"], [5, "MASON"], [8, "SAPPER"], [11, "DEMOLISHER"], [14, "ARCHITECT"], [18, "LATTICE LORD"]];
// Today's order, the same for everyone on the same date.
export function ricochetOrder(key) {
  const h = hashText("ricochet" + key), kind = h % 5, v = (h >>> 8) % 3;
  if (kind === 0) return { kind: "chamber", n: 3 + v, text: "Reach chamber " + (3 + v) + "." };
  if (kind === 1) return { kind: "chain", n: 4 + v, text: "Reach a chain of x" + (4 + v) + "." };
  if (kind === 2) return { kind: "bonuses", n: 2 + v, text: "Catch " + (2 + v) + " bonuses in one run." };
  if (kind === 3) return { kind: "cells", n: 60 + 30 * v, text: "Break " + (60 + 30 * v) + " cells in one run." };
  return { kind: "sweep", n: 1, text: "Clear a chamber after the first without losing a ball." };
}
// Bring any stored shape (nothing, schema 1 from recordRun, schema 2) to schema 2.
export function migrateRicochet(raw) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const st = r.st && typeof r.st === "object" ? r.st : {};
  const n = (v) => Math.max(0, Math.floor(num(v)));
  return {
    schema: 2,
    runs: n(r.runs),
    last: r.last && typeof r.last === "object" ? r.last : {},
    milestone: n(r.milestone),
    ft: cleanFeats(r.ft, FEAT_IDS),
    st: { cells: n(st.cells), chambers: n(st.chambers), daily: n(st.daily), far: Math.max(n(st.far), n(r.milestone)) },
    dl: cleanDaily(r.dl),
  };
}

// Symmetric lattice patterns over a mirrored column index m (0 = outer edge .. 5).
const PATTERNS = [
  (m, r) => true,
  (m, r) => (m + r) % 2 === 0,
  (m, r) => m >= 5 - r,
  (m, r) => m <= r,
  (m, r, rows) => r % 2 === 0 || m % 2 === 0,
  (m, r, rows) => r === 0 || r === rows - 1 || m === 0 || m === 5,
  (m, r, rows) => Math.abs(m - 2.5) + Math.abs(r - (rows - 1) / 2) <= 3,
];
const EASY_PATTERNS = [1, 2, 4];
const MID_PATTERNS = [1, 2, 3, 4, 5, 6];

const emptyBall = () => ({ x: 0, y: 0, vx: 0, vy: 0, pred: null, predN: 0, predClock: 0, dirty: true, idle: 0,
  tx: [0, 0, 0], ty: [0, 0, 0] });

export class Ricochet {
  constructor(ctx) {
    this.ctx = ctx;
    this.guard = new AppGuard(this, ctx); // takes back a menu gesture that reached the game (docs/ENGINE.md)
    this.t = 0; // animation clock, always runs
    this.phase = "title";
    this.endedAt = -9;
    this.lastKey = "";
    this.lastHint = "";
    this.frame = 0;
    this.scratch = emptyBall();
    this.hitIdx = [];
    this.parts = Array.from({ length: 40 }, () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0 }));
    this.sv = migrateRicochet(ctx.progress?.());
    this.reset();
    this.setupChamber(1);
    this.setHint("Tap reverses the paddle. Meet the amber bracket.");
  }

  reset() {
    this.score = 0;
    this.lives = LIVES;
    this.free = FREE_BALLS; // balls that can be lost in chamber 1 without costing a life
    this.lostFree = false;
    this.chamber = 1;
    this.cellsBroken = 0;
    this.bestChain = 0;
    this.streak = 0;
    this.gain = 0;
    this.touches = 0;
    this.quiet = 0; // seconds of live play since a cell last broke
    this.clock = 0;
    this.sub = "serve";
    this.timer = 1.2;
    this.px = (L + R) / 2;
    this.dir = 1;
    this.padW = padWidth(1);
    this.pressing = false;
    this.heldTime = 0;
    this.dirBefore = 0;
    this.downs = [-9, -9, -9, -9];
    this.lostAt = -9;
    this.sparkle = [-9, -9, -9];
    this.catchAt = -9;
    this.clearedAt = -9;
    this.padFlash = -9;
    this.balls = [];
    this.drops = [];
    this.pw = { wide: 0, slow: 0 };
    this.cells = new Array(COLS * ROWS_MAX).fill(0);
    this.rows = 4;
    this.remaining = 0;
    this.announce = null;
    this.lastBonus = 0;
    this.blastAt = -9;
    this.blastCol = 1;
    this.blasts = [];
    for (const p of this.parts) p.life = 0;
    // This run's tallies, for feats and the daily order.
    this.mods = Object.fromEntries(UPGRADES.map((u) => [u.id, 0]));
    this.offer = null;      // the two upgrades on offer: { ids, cur, t }
    this.chainKept = false; // STEADY CHAIN: the chain has already survived a touch since the last break
    this.servedCharge = false;
    this.shake = 0;
    this.R = { picks: 0, practice: 0, bonuses: 0, twin: 0, sweep: 0, blast: 0, relay: 0, few: 0, lastBall: 0, cells: 0, daily: 0, lostHere: 0, touchesHere: 0 };
    this.fresh = [];
    this.orderMet = false;
    this.news = null;
  }
  dayKey() { return dateKey(); }

  get multiplier() {
    return Math.min(8, 1 + this.streak);
  }
  get frozen() {
    return this.pressing && this.heldTime >= FREEZE_AFTER;
  }
  speedNow() {
    return Math.min(MAX_SPEED, (baseSpeed(this.chamber) + this.gain) * (this.pw.slow > 0 ? 0.72 : 1) * (1 - 0.06 * (this.mods?.slow || 0)));
  }
  padTarget() {
    return padWidth(this.chamber) * (this.pw.wide > 0 ? 1.45 : 1) * (1 + 0.1 * (this.mods?.wide || 0));
  }
  padSpeedNow() {
    return padSpeed(this.chamber) * (1 + 0.1 * (this.mods?.quick || 0));
  }

  setHint(message) {
    if (message !== this.lastHint) {
      this.lastHint = message;
      this.ctx.hint(message);
    }
  }

  // ---- chambers ----------------------------------------------------------

  // Fill the lattice for chamber `ch` from ctx.rng: a symmetric pattern, hardened
  // cells in a designed arrangement, and bonus cells in mirrored pairs.
  setupChamber(ch) {
    const rng = this.ctx.rng;
    const rows = rowsFor(ch);
    this.chamber = ch;
    this.rows = rows;
    this.cells.fill(0);
    let pat = rng.pick(ch === 1 ? EASY_PATTERNS : ch < 4 ? MID_PATTERNS : PATTERNS.map((_, i) => i));
    let count = 0;
    for (let r = 0; r < rows; r++) for (let m = 0; m < 6; m++) if (PATTERNS[pat](m, r, rows)) count++;
    if (count < 8) pat = 0;
    const hardStyle = ch >= 3 ? rng.int(0, 2) : -1;
    const hardRows = Math.min(rows - 1, 1 + Math.floor((ch - 3) / 2));
    const live = [];
    for (let r = 0; r < rows; r++) {
      for (let m = 0; m < 6; m++) {
        if (!PATTERNS[pat](m, r, rows)) continue;
        const hard = hardStyle === 0 ? r < hardRows : hardStyle === 1 ? m === 0 || m === 5 : hardStyle === 2 ? (r + m) % 3 === 0 : false;
        for (const c of [m, 11 - m]) {
          this.cells[r * COLS + c] = { hp: hard ? 2 : 1, hard, bonus: "" };
        }
        live.push([r, m]);
      }
    }
    if (ch >= 2 && live.length) {
      const pairs = (ch < 4 ? 1 : 2) + (this.mods?.luck || 0);
      for (let i = 0; i < pairs; i++) {
        const [r, m] = live[rng.int(0, live.length - 1)];
        const type = rng.pick(["wide", "slow", "multi"]);
        for (const c of [m, 11 - m]) this.cells[r * COLS + c].bonus = type;
      }
    }
    // Charge cells, in mirrored pairs, on plain cells with something next to them to break.
    if (ch >= CHARGE_FROM) {
      const plain = live.filter(([r, m]) => { const cell = this.cells[r * COLS + m]; return !cell.hard && !cell.bonus && !cell.charge && this.neighbours(r * COLS + m).length >= 2; });
      for (let i = 0; i < (ch < 7 ? 1 : 2) && plain.length; i++) {
        const [r, m] = plain.splice(rng.int(0, plain.length - 1), 1)[0];
        for (const c of [m, 11 - m]) this.cells[r * COLS + c].charge = true;
      }
    }
    this.R.touchesHere = 0;
    this.R.lostHere = 0;
    this.checkGoals(); // reaching a chamber can meet the order or a feat
    this.remaining = 0;
    for (const c of this.cells) if (c) this.remaining++;
    this.balls = [];
    this.drops = [];
    this.pw.wide = 0;
    this.pw.slow = 0;
    this.sub = "serve";
    this.timer = 1.2;
    this.announce = { text: "CHAMBER " + String(ch).padStart(2, "0"), news: NEWS[ch] || (ch > 4 ? "FASTER" : ""), at: this.clock };
    this.serveBall();
  }

  serveBall() {
    const b = emptyBall();
    b.x = this.px;
    b.y = PAD_Y - BALL_R;
    this.balls = [b];
    this.streak = 0;
    this.sub = "serve";
    this.timer = 1.1;
  }

  launch() {
    const b = this.balls[0];
    if (!b) return;
    const s = this.speedNow();
    const a = this.ctx.rng.range(-0.4, 0.4);
    b.vx = s * Math.sin(a);
    b.vy = -s * Math.cos(a);
    b.dirty = true;
    this.fixMin(b);
    this.sub = "live";
    this.quiet = 0;
    this.servedCharge = this.mods.serve > 0;
    this.setHint("Tap reverses the paddle. Meet the amber bracket. A long hold freezes the game.");
  }

  // ---- input -------------------------------------------------------------

  down() {
    this.guard.mark();
    if (this.phase === "title") return this.begin();
    if (this.phase === "over") {
      if (this.t - this.endedAt > 0.8) this.begin();
      return;
    }
    if (this.phase !== "play") return;
    this.downs.shift();
    this.downs.push(this.clock);
    this.pressing = true;
    this.heldTime = 0;
    if (this.sub === "pick") return; // decided on release
    this.dirBefore = this.dir;
    this.dir = -this.dir;
    this.ctx.tone(520, 0.025, "square");
  }

  up() {
    this.guard.release();
    if (this.phase === "play" && this.sub === "pick" && this.pressing) {
      if (this.heldTime >= PICK_HOLD) this.take();
      else { this.offer.cur = 1 - this.offer.cur; this.offer.t = 0; this.ctx.tone(this.offer.cur ? 660 : 523, 0.05, "sine"); }
    }
    this.pressing = false;
    this.heldTime = 0;
  }

  cancel() {
    this.guard.rewind();
    // Menu or focus change: drop held input and go dark. If a ball was lost in the
    // moment the gesture began (during or just before its last press), give it back.
    this.pressing = false;
    this.heldTime = 0;
    if (this.phase === "play" && this.sub === "dying" && this.lostAt >= this.downs[3] - 1.5) {
      if (this.lostFree) this.free++;
      else this.lives = Math.min(LIVES, this.lives + 1);
      this.lostFree = false;
      this.lostAt = -9;
      this.serveBall();
      this.setHint("Ball returned. Tap reverses the paddle.");
    }
    this.ctx.synth?.stopTone?.();
    this.ctx.leds(lightsOff());
  }
  pause() { this.guard.settle(); this.cancel(); }
  dispose() {
    this.guard.settle();
    // Leaving for good mid-run: a daily order met or a feat earned on the way is kept.
    if (this.phase === "play" && (this.orderMet || this.fresh.length)) this.persist();
    this.pressing = false;
    this.ctx.synth?.stopTone?.();
    this.ctx.leds(lightsOff());
  }

  begin() {
    this.reset();
    this.phase = "play";
    this.setupChamber(1);
    this.setHint("Tap reverses the paddle. Meet the amber bracket.");
  }

  // ---- ball physics ------------------------------------------------------

  walls(b) {
    if (b.x < L + BALL_R) { b.x = L + BALL_R; if (b.vx < 0) b.vx = -b.vx; }
    else if (b.x > R - BALL_R) { b.x = R - BALL_R; if (b.vx > 0) b.vx = -b.vx; }
    if (b.y < TOP + BALL_R) { b.y = TOP + BALL_R; if (b.vy < 0) b.vy = -b.vy; }
  }

  // Keep a minimum share of the speed on both axes so a ball can neither crawl
  // along a row nor loop between two walls.
  fixMin(b) {
    const sp = Math.hypot(b.vx, b.vy);
    if (!(sp > 1e-6)) { const v = this.speedNow(); b.vx = v * 0.2; b.vy = -v * 0.98; return; }
    let ay = Math.abs(b.vy) / sp;
    let ax = Math.abs(b.vx) / sp;
    if (ay >= MIN_VY && ax >= MIN_VX) return;
    if (ay < MIN_VY) { ay = MIN_VY; ax = Math.sqrt(1 - ay * ay); }
    else { ax = MIN_VX; ay = Math.sqrt(1 - ax * ax); }
    b.vx = (b.vx < 0 ? -1 : 1) * ax * sp;
    b.vy = (b.vy > 0 ? 1 : -1) * ay * sp;
  }

  // Advance one ball by dt in sub-steps. With `sim` true this is the dry run used
  // for the landing marker: cells are solid and unharmed, and it returns true the
  // moment the ball reaches paddle height. In real play the paddle is tested.
  advance(b, dt, sim) {
    const sp = Math.hypot(b.vx, b.vy);
    if (!(sp > 0)) return false;
    const n = Math.max(1, Math.ceil((sp * dt) / STEP));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const py = b.y, px = b.x;
      b.x += b.vx * h;
      b.y += b.vy * h;
      this.walls(b);
      this.cellHits(b, px, py, sim);
      this.walls(b);
      if (b.vy > 0 && b.y + BALL_R >= PAD_Y && py + BALL_R <= PAD_Y + 2) {
        if (sim) return true;
        if (Math.abs(b.x - this.px) <= this.padW / 2 + BALL_R * 0.7) this.paddleHit(b);
      }
      this.fixMin(b);
    }
    return false;
  }

  cellHits(b, px, py, sim) {
    const c0 = Math.max(0, Math.floor((b.x - BALL_R - L) / CW)), c1 = Math.min(COLS - 1, Math.floor((b.x + BALL_R - L) / CW));
    const r0 = Math.max(0, Math.floor((b.y - BALL_R - GY) / RH)), r1 = Math.min(this.rows - 1, Math.floor((b.y + BALL_R - GY) / RH));
    if (r1 < r0 || c1 < c0) return;
    let nx = 0, ny = 0, pen = 0, inside = false;
    this.hitIdx.length = 0;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (!this.cells[r * COLS + c]) continue;
        const x0 = L + c * CW, y0 = GY + r * RH;
        const dx = b.x - clamp(b.x, x0, x0 + CW), dy = b.y - clamp(b.y, y0, y0 + RH);
        const d2 = dx * dx + dy * dy;
        if (d2 >= BALL_R * BALL_R) continue;
        const d = Math.sqrt(d2);
        if (d > 1e-6) {
          nx += dx / d; ny += dy / d; pen = Math.max(pen, BALL_R - d);
        } else { // centre inside the cell: use the side it came from
          inside = true;
          if (py < y0 || py > y0 + RH) ny += py < y0 ? -1 : 1; else nx += px < x0 ? -1 : 1;
        }
        this.hitIdx.push(r * COLS + c);
      }
    }
    if (!this.hitIdx.length) return;
    let m = Math.hypot(nx, ny);
    if (m < 1e-6) { nx = 0; ny = b.vy > 0 ? -1 : 1; m = 1; }
    nx /= m; ny /= m;
    const dot = b.vx * nx + b.vy * ny;
    if (dot < 0) { b.vx -= 2 * dot * nx; b.vy -= 2 * dot * ny; }
    if (inside) { b.x = px; b.y = py; } else { b.x += nx * (pen + 0.01); b.y += ny * (pen + 0.01); }
    if (!sim) for (const i of this.hitIdx) this.damage(i);
  }

  // Live cells around cell i (eight neighbours, inside the lattice).
  neighbours(i) {
    const out = [], c0 = i % COLS, r0 = Math.floor(i / COLS);
    for (let r = r0 - 1; r <= r0 + 1; r++) for (let c = c0 - 1; c <= c0 + 1; c++) {
      if (r < 0 || r >= this.rows || c < 0 || c >= COLS || (r === r0 && c === c0)) continue;
      if (this.cells[r * COLS + c]) out.push(r * COLS + c);
    }
    return out;
  }
  // Damage one cell. A charge that breaks hits each of its neighbours once; a neighbour that is a
  // charge itself goes off in turn (a queue, never recursion). The cells one blast breaks count for
  // DEMOLITION, a charge set off by another for CHAIN REACTION.
  damage(i) {
    const cell = this.cells[i];
    if (!cell) return;
    // CHARGED SERVE: the served ball's first cell goes off like a charge.
    if (this.servedCharge) { this.servedCharge = false; cell.charge = true; cell.hp = 1; }
    if (!this.hit(i) || !cell.charge) return;
    const queue = this.neighbours(i);
    let broken = 0;
    while (queue.length) {
      const j = queue.shift(), next = this.cells[j];
      if (!next || !this.hit(j)) continue;
      broken++;
      if (next.charge) { this.R.relay = 1; queue.push(...this.neighbours(j)); }
    }
    this.R.blast = Math.max(this.R.blast, broken);
    this.shake = Math.max(this.shake, 0.22);
    this.blastAt = this.t;
    this.blastCol = Math.min(2, Math.floor((i % COLS) / 4));
    this.ctx.tone(110, 0.18, "sawtooth");
    this.ctx.tone(880, 0.12, "triangle");
    this.checkGoals();
  }
  // One hit on cell i; returns whether it broke.
  hit(i) {
    const cell = this.cells[i];
    if (!cell) return false;
    cell.hp--;
    if (cell.hp > 0) {
      this.ctx.tone(190, 0.05, "square");
      return false;
    }
    this.cells[i] = 0;
    this.remaining--;
    this.cellsBroken++;
    this.chainKept = false;
    this.R.cells++;
    this.quiet = 0;
    const col = i % COLS, row = Math.floor(i / COLS);
    const mult = this.multiplier;
    this.score += (cell.hard ? 25 : 10) * mult;
    this.streak++;
    this.bestChain = Math.max(this.bestChain, this.multiplier);
    this.sparkle[Math.min(2, Math.floor(col / 4))] = this.t;
    this.burst(L + (col + 0.5) * CW, GY + (row + 0.5) * RH, 5);
    this.ctx.tone(SCALE[(this.rows - 1 - row + col) % SCALE.length] * (mult > 3 ? 2 : 1), 0.07, "triangle");
    if (cell.bonus && this.drops.length < 8) {
      this.drops.push({ x: L + (col + 0.5) * CW, y: GY + (row + 0.5) * RH, type: cell.bonus });
    }
    if (cell.charge) this.burst(L + (col + 0.5) * CW, GY + (row + 0.5) * RH, 10);
    for (const b of this.balls) b.dirty = true;
    this.checkGoals();
    return true;
  }

  paddleHit(b) {
    // STEADY CHAIN keeps the chain through one touch between breaks.
    if (this.mods.chain && this.streak > 0 && !this.chainKept) this.chainKept = true;
    else this.streak = 0;
    this.touches++;
    this.R.touchesHere++;
    this.gain = Math.min(60, this.gain + 2);
    const half = this.padW / 2 + BALL_R * 0.7;
    const u = clamp((b.x - this.px) / half, -1, 1);
    // The paddle is always moving, so it drags the ball a little the way it is going.
    // After a spell without a broken cell the rebound is steered toward the lowest
    // remaining cell, more firmly the longer it has been, so stragglers cannot stall
    // a chamber and a ball can never settle into a loop.
    const s = this.speedNow();
    const a0 = u * MAX_ANGLE;
    const drag = this.dir * this.padSpeedNow() * 0.3;
    let a = Math.atan2(s * Math.sin(a0) + drag, s * Math.cos(a0));
    if (this.quiet > 4 && this.remaining > 0) {
      const target = this.lowestCell(b.x);
      if (target) {
        const want = clamp(Math.atan2(target[0] - b.x, PAD_Y - target[1]), -1.2, 1.2);
        a += (want - a) * clamp((this.quiet - 4) / 4, 0, 1);
      }
    }
    b.y = PAD_Y - BALL_R;
    b.vx = s * Math.sin(a);
    b.vy = -s * Math.cos(a);
    this.fixMin(b);
    b.idle = 0;
    b.dirty = true;
    this.padFlash = this.t;
    this.ctx.tone(150, 0.05, "sine");
  }

  // Centre of the lowest remaining row's cell nearest to x (null when none remain).
  lowestCell(x) {
    for (let r = this.rows - 1; r >= 0; r--) {
      let best = null;
      for (let c = 0; c < COLS; c++) {
        if (!this.cells[r * COLS + c]) continue;
        const cx = L + (c + 0.5) * CW;
        if (!best || Math.abs(cx - x) < Math.abs(best[0] - x)) best = [cx, GY + (r + 0.5) * RH + RH / 2];
      }
      if (best) return best;
    }
    return null;
  }

  // Where the ball will next reach paddle height, by running a scratch copy.
  predict(b) {
    const s = this.scratch;
    s.x = b.x; s.y = b.y; s.vx = b.vx; s.vy = b.vy;
    b.pred = null;
    b.dirty = false;
    for (let n = 1; n <= 1500; n++) {
      if (this.advance(s, 1 / 60, true)) {
        b.pred = s.x;
        b.predN = n;
        b.predClock = this.clock;
        return;
      }
      if (s.y > LOST_Y) return;
    }
  }

  eta(b) {
    return b.pred === null ? 99 : Math.max(0, b.predN / 60 - (this.clock - b.predClock));
  }

  burst(x, y, n) {
    const rng = this.ctx.rng;
    for (let k = 0; k < n; k++) {
      const p = this.parts.find((q) => q.life <= 0);
      if (!p) return;
      const a = rng.range(0, Math.PI * 2), v = rng.range(40, 120);
      p.x = x; p.y = y; p.vx = Math.cos(a) * v; p.vy = Math.sin(a) * v; p.life = 0.45;
    }
  }

  // ---- simulation --------------------------------------------------------

  update(dt) {
    if (!(dt > 0)) return;
    this.guard.tick(dt);
    this.t += dt;
    this.frame++;
    if (this.phase === "play") this.step(dt);
    this.lampOutput();
    if (this.frame % 6 === 0) this.updateHud();
  }

  movePaddle(dt) {
    const target = this.padTarget();
    this.padW += clamp(target - this.padW, -140 * dt, 140 * dt);
    this.px += this.dir * this.padSpeedNow() * dt;
    const lo = L + this.padW / 2, hi = R - this.padW / 2;
    if (this.px <= lo) { this.px = lo; this.dir = 1; }
    else if (this.px >= hi) { this.px = hi; this.dir = -1; }
  }

  step(dt) {
    // A long hold is never a tap: the world freezes until release, so the hold that
    // opens the system menu cannot cost a ball.
    const held = this.heldTime;
    if (this.pressing) this.heldTime += dt;
    if (this.sub === "pick") return this.stepPick(dt);
    // A press that turns into a hold is a pause, not a turn: the paddle goes back to the way it was
    // gliding before the press, and keeps going that way on release.
    if (this.pressing && held < FREEZE_AFTER && this.heldTime >= FREEZE_AFTER && this.dirBefore) this.dir = this.dirBefore;
    if (this.frozen) return;
    this.shake = Math.max(0, this.shake - dt);
    this.clock += dt;
    this.movePaddle(dt);
    for (const p of this.parts) {
      if (p.life <= 0) continue;
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
    }
    if (this.sub === "serve") {
      const b = this.balls[0];
      if (b) { b.x = this.px; b.y = PAD_Y - BALL_R; }
      this.timer -= dt;
      if (this.timer <= 0) this.launch();
    } else if (this.sub === "live") {
      this.stepLive(dt);
    } else if (this.sub === "dying") {
      this.timer -= dt;
      if (this.timer <= 0) {
        if (this.lives > 0) { this.serveBall(); this.setHint("Tap reverses the paddle. Meet the amber bracket."); }
        else this.end();
      }
    } else if (this.sub === "clear") {
      this.timer -= dt;
      if (this.timer <= 0) {
        if (this.chamber >= PICK_FROM && this.offerUpgrades()) return;
        this.setupChamber(this.chamber + 1);
      }
    }
  }

  // ---- upgrades between chambers ----------------------------------------

  // Offer two different upgrades that can still be taken; false when none are left.
  offerUpgrades() {
    const open = UPGRADES.filter((u) => this.mods[u.id] < u.max).map((u) => u.id);
    if (!open.length) return false;
    const rng = this.ctx.rng, first = open.splice(rng.int(0, open.length - 1), 1)[0];
    const ids = open.length ? [first, open[rng.int(0, open.length - 1)]] : [first];
    this.offer = { ids, cur: 0, t: 0 };
    this.sub = "pick";
    this.setHint("Tap: switch upgrade. Hold: take it.");
    this.ctx.tone(440, 0.08, "sine");
    return true;
  }
  // While choosing, the world waits; the highlighted upgrade is taken after PICK_TIME.
  stepPick(dt) {
    this.offer.t += dt;
    if (!this.pressing && this.offer.t >= PICK_TIME) this.take();
  }
  take() {
    const id = this.offer.ids[this.offer.cur];
    this.mods[id]++;
    this.R.picks++;
    if (id === "spare") this.lives++;
    this.offer = null;
    this.ctx.tone(660, 0.08, "triangle"); this.ctx.tone(990, 0.15, "triangle");
    this.tell("UPGRADE: " + UPGRADES.find((u) => u.id === id).name);
    this.setupChamber(this.chamber + 1);
    this.checkGoals();
  }

  stepLive(dt) {
    // Power-ups run down.
    if (this.pw.wide > 0) this.pw.wide = Math.max(0, this.pw.wide - dt);
    if (this.pw.slow > 0) {
      this.pw.slow = Math.max(0, this.pw.slow - dt);
      if (this.pw.slow === 0) this.rescale();
    }
    for (let i = 0; i < this.balls.length; i++) {
      const b = this.balls[i];
      b.tx[2] = b.tx[1]; b.ty[2] = b.ty[1]; b.tx[1] = b.tx[0]; b.ty[1] = b.ty[0]; b.tx[0] = b.x; b.ty[0] = b.y;
      this.advance(b, dt, false);
      b.idle += dt;
      this.quiet += dt / this.balls.length;
      if (b.idle > 15) { // failsafe: a ball that never meets the paddle gets nudged
        const a = (this.ctx.rng.next() < 0.5 ? -1 : 1) * 0.35, c = Math.cos(a), s = Math.sin(a);
        const vx = b.vx * c - b.vy * s;
        b.vy = b.vx * s + b.vy * c; b.vx = vx;
        this.fixMin(b);
        b.idle = 8; b.dirty = true;
      }
      if (!(b.x === b.x) || !(b.y === b.y)) { b.x = this.px; b.y = PAD_Y - 40; b.vy = -this.speedNow(); b.vx = 0; this.fixMin(b); }
      if (b.y - BALL_R > LOST_Y) { this.balls.splice(i, 1); i--; }
    }
    // Falling bonuses.
    for (let i = 0; i < this.drops.length; i++) {
      const d = this.drops[i];
      d.y += DROP_SPEED * dt;
      if (d.y > PAD_Y - 6 && d.y < PAD_Y + PAD_H + 12 && Math.abs(d.x - this.px) <= this.padW / 2 + 14) {
        this.applyBonus(d.type);
        this.drops.splice(i, 1); i--;
      } else if (d.y > 540) { this.drops.splice(i, 1); i--; }
    }
    for (const b of this.balls) if (b.dirty) this.predict(b);
    if (this.remaining <= 0) return this.clearChamber();
    if (!this.balls.length) this.loseBall();
  }

  rescale() {
    const s = this.speedNow();
    for (const b of this.balls) {
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > 1e-6) { b.vx *= s / sp; b.vy *= s / sp; }
      b.dirty = true;
    }
  }

  applyBonus(type) {
    this.catchAt = this.t;
    this.score += 50;
    this.R.bonuses++;
    if (type === "wide") this.pw.wide = WIDE_TIME;
    else if (type === "slow") { this.pw.slow = SLOW_TIME; this.rescale(); }
    else if (type === "multi" && this.balls.length < 3 && this.balls.length) {
      const src = this.balls.reduce((a, b) => (b.y > a.y ? b : a), this.balls[0]);
      const b = emptyBall();
      b.x = src.x; b.y = src.y;
      const a = Math.atan2(src.vx, -src.vy) + (this.balls.length % 2 ? 0.5 : -0.5);
      const s = this.speedNow();
      b.vx = s * Math.sin(a); b.vy = -s * Math.cos(a) * (src.vy < 0 ? 1 : -1);
      this.fixMin(b);
      this.balls.push(b);
    }
    this.ctx.tone(type === "multi" ? 660 : type === "slow" ? 330 : 495, 0.12, "sine");
    this.ctx.tone(type === "multi" ? 880 : type === "slow" ? 440 : 660, 0.12, "sine");
    this.checkGoals();
  }

  loseBall() {
    this.lostFree = this.chamber === 1 && this.free > 0;
    if (this.lostFree) this.free--;
    else this.lives--;
    this.lostAt = this.clock;
    this.R.lostHere++;
    this.shake = 0.3;
    this.sub = "dying";
    this.timer = 1.2;
    this.streak = 0;
    this.gain = 0;
    this.pw.wide = 0;
    this.pw.slow = 0;
    this.drops.length = 0;
    this.ctx.tone(220, 0.15, "triangle");
    this.ctx.tone(165, 0.25, "triangle");
    this.setHint(this.lostFree ? "Ball lost. In chamber 1 that one was free." : this.lives > 0 ? "Ball lost. " + this.lives + " left." : "Last ball lost.");
  }

  clearChamber() {
    const R = this.R;
    if (!R.lostHere) { if (this.chamber === 1) R.practice = 1; else R.sweep = 1; }
    if (this.balls.length >= 2) R.twin = 1;
    if (R.touchesHere <= 6) R.few = 1;
    if (this.lives === 1 && this.chamber > 1) R.lastBall = 1;
    this.sub = "clear";
    this.timer = 2.6;
    this.clearedAt = this.t;
    this.balls = [];
    this.drops.length = 0;
    this.lastBonus = 100 * this.chamber + 50 * this.lives;
    this.score += this.lastBonus;
    this.ctx.tone(392, 0.12, "triangle");
    this.ctx.tone(494, 0.12, "triangle");
    this.ctx.tone(659, 0.3, "triangle");
    this.setHint("Chamber cleared.");
    this.checkGoals();
  }
  // The daily order and feats, checked whenever a tally moves. News shows under the clear banner or
  // in the announcement slot.
  orderDone() {
    const o = ricochetOrder(this.dayKey());
    if (o.kind === "chamber") return this.chamber >= o.n;
    if (o.kind === "chain") return this.bestChain >= o.n;
    if (o.kind === "bonuses") return this.R.bonuses >= o.n;
    if (o.kind === "cells") return this.R.cells >= o.n;
    return this.R.sweep >= 1;
  }
  checkGoals() {
    if (this.phase !== "play") return;
    if (!this.orderMet && this.orderDone()) {
      this.orderMet = true;
      if (meetDaily(this.sv.dl, this.dayKey())) {
        this.R.daily = 1;
        this.tell("DAILY ORDER MET" + (this.sv.dl.streak > 1 ? " / STREAK " + this.sv.dl.streak : ""));
        this.ctx.tone(784, 0.1, "sine"); this.ctx.tone(1047, 0.18, "sine");
      }
    }
    for (const id of newlyMet(RICOCHET_FEATS, this.sv.ft, this)) {
      this.sv.ft.push(id); this.fresh.push(id);
      this.tell("FEAT: " + RICOCHET_FEATS.find((f) => f.id === id).name);
    }
  }
  tell(message) {
    this.news = { text: message, at: this.clock };
  }

  end() {
    this.checkGoals();
    this.phase = "over";
    this.endedAt = this.t;
    this.pressing = false;
    this.ctx.score(this.score);
    const sv = this.sv, R = this.R;
    sv.runs++;
    sv.st.cells += R.cells; sv.st.chambers += this.chamber - 1; sv.st.daily += R.daily;
    sv.st.far = Math.max(sv.st.far, this.chamber);
    R.cells = 0; R.daily = 0; // now in the lifetime tallies
    sv.last = { score: this.score, chamber: this.chamber, cells: this.cellsBroken, chain: this.bestChain, milestone: this.chamber };
    sv.milestone = Math.max(sv.milestone, this.chamber);
    this.persist();
    this.ctx.tone(330, 0.2, "triangle");
    this.ctx.tone(247, 0.3, "triangle");
    this.ctx.tone(165, 0.5, "triangle");
    this.setHint("Signal lost. Press to play again.");
  }
  persist() {
    this.ctx.saveProgress?.(JSON.parse(JSON.stringify(this.sv)))?.catch?.(this.ctx.error);
  }

  updateHud() {
    const key = this.phase + this.score + "/" + this.chamber + "/" + this.lives + "/" + this.ctx.best();
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.ctx.hud([
      ["SCORE", this.score],
      ["CHAMBER", this.chamber],
      ["BALLS", this.phase === "title" ? LIVES : this.lives],
      ["BEST", this.ctx.best()],
    ]);
  }

  // ---- lamps -------------------------------------------------------------

  // Live: a spot that follows the lowest ball across the chamber, coloured by how
  // far it has dropped. Overlays, lowest priority first: cell sparkle over the
  // third of the lattice, bonus catch, then the red wash and the clear chase.
  lampValues() {
    const t = this.t;
    if (this.phase === "title") return spot(0.5 + 0.5 * Math.sin(t * 0.7), dim(LAMP.green, 0.14));
    if (this.phase === "over") {
      const k = 0.02 + 0.07 * pulse(t, 0.4);
      return lamps(dim(LAMP.red, k), dim(LAMP.red, k), dim(LAMP.red, k));
    }
    if (this.sub === "dying") {
      const age = (this.clock - this.lostAt) / 1.2;
      const k = clamp(1 - age, 0, 1) * (0.25 + 0.3 * pulse(t, 3));
      const c = dim(LAMP.red, k);
      return lamps(c, c, c);
    }
    if (this.sub === "pick") {
      // Lamp I for the left card, lamp III for the right: the choice can be read on the lamps alone.
      const k = 0.35 + 0.2 * pulse(t, 1.2);
      return this.offer.cur ? lamps(dim(LAMP.cyan, 0.06), null, dim(LAMP.cyan, k)) : lamps(dim(LAMP.cyan, k), null, dim(LAMP.cyan, 0.06));
    }
    if (this.sub === "clear") {
      const age = t - this.clearedAt;
      const on = chase(age, 7, false);
      const hue = [LAMP.green, LAMP.cyan, LAMP.white][Math.floor(age * 3.5) % 3];
      const out = [0, 1, 2].map((i) => dim(hue, i === on ? 0.45 : 0.06));
      return lamps(out[0], out[1], out[2]);
    }
    let pos, rgb;
    if (this.sub === "serve" || !this.balls.length) {
      pos = (this.px - L) / (R - L);
      rgb = dim(LAMP.green, 0.16 + 0.1 * pulse(t, 2));
    } else {
      let low = this.balls[0];
      for (const b of this.balls) if (b.y > low.y) low = b;
      pos = clamp((low.x - L) / (R - L), 0, 1);
      const depth = clamp((low.y - TOP) / (PAD_Y - TOP), 0, 1);
      rgb = dim(ramp(depth, [LAMP.green, LAMP.amber, LAMP.red]), (0.2 + 0.3 * depth * depth) * (low.vy > 0 ? 1 : 0.75));
    }
    const out = spot(pos, rgb).slice();
    const over = (i, c) => { for (let j = 0; j < 3; j++) out[i * 3 + j] = Math.max(out[i * 3 + j], c[j]); };
    for (let i = 0; i < 3; i++) {
      const age = t - this.sparkle[i];
      if (age < 0.28) over(i, dim(LAMP.white, (Math.floor(age * 40) % 2 ? 0.2 : 0.55) * (1 - age / 0.28)));
    }
    if (t - this.catchAt < 0.2) for (let i = 0; i < 3; i++) over(i, dim(LAMP.cyan, 0.35));
    // A charge going off: a red burst strongest over its third of the lattice, fading in 0.4 s.
    const blast = t - this.blastAt;
    if (blast < 0.4) for (let i = 0; i < 3; i++) over(i, dim(blast < 0.08 ? LAMP.white : LAMP.red, (i === this.blastCol ? 0.7 : 0.35) * (1 - blast / 0.4)));
    return out;
  }

  lampOutput() {
    this.lampNow = this.lampValues();
    this.ctx.leds(this.lampNow);
  }

  // ---- drawing -----------------------------------------------------------

  draw(g) {
    space(g, this.t, 0.5);
    const shake = this.phase === "play" && this.shake > 0 ? Math.sin(this.t * 80) * 5 * this.shake / 0.3 : 0;
    g.save?.();
    g.translate?.(shake, 0);
    this.drawChamber(g);
    g.restore?.();
    if (this.phase === "title") {
      banner(g, "RICOCHET", "TAP TO REVERSE THE PADDLE / BREAK THE LATTICE");
      text(g, "THE LAMPS FOLLOW THE BALL: GREEN HIGH, RED LOW", 480, 392, 18, C.muted, "center");
      this.drawGoals(g, 430);
    } else if (this.phase === "play") {
      this.drawPlay(g);
    } else {
      this.drawResult(g);
    }
  }

  drawChamber(g) {
    const theme = THEMES[(this.chamber - 1) % THEMES.length];
    // A faint floor glow and depth bands behind the lattice.
    g.fillStyle = "#0f1c15"; g.fillRect(L, TOP, R - L, PAD_Y + 50 - TOP);
    g.globalAlpha = 0.5;
    for (let i = 0; i < 6; i++) { g.fillStyle = i % 2 ? "#0c1511" : "#101e17"; g.fillRect(L, TOP + i * 90, R - L, 45); }
    g.globalAlpha = 1;
    line(g, L - 2, TOP, L - 2, PAD_Y + 50, C.muted, 3);
    line(g, R + 2, TOP, R + 2, PAD_Y + 50, C.muted, 3);
    line(g, L - 2, TOP - 1, R + 2, TOP - 1, C.muted, 3);
    line(g, L, PAD_Y + 50, R, PAD_Y + 50, C.line, 2);
    // Corner brackets in the chamber's colour.
    for (const [cx, sx] of [[L - 2, 1], [R + 2, -1]]) { line(g, cx, TOP - 1, cx + sx * 26, TOP - 1, theme[2], 4); line(g, cx, TOP - 1, cx, TOP + 26, theme[2], 4); }
    const title = this.phase !== "play";
    if (title) g.globalAlpha = 0.45;
    const rows = this.phase === "over" ? 0 : this.rows; // the result panel stands alone
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = this.cells[r * COLS + c];
        if (!cell) continue;
        const x = L + c * CW + 2, y = GY + r * RH + 2, w = CW - 4, h = RH - 4;
        if (cell.hp > 1) {
          g.strokeStyle = C.amber; g.lineWidth = 2; g.strokeRect(x, y, w, h);
          g.strokeRect(x + 5, y + 5, w - 10, h - 10);
        } else {
          g.fillStyle = r % 2 ? theme[1] : theme[0];
          g.fillRect(x, y, w, h);
          // A lit top edge and a shadowed foot give each cell some body.
          g.fillStyle = theme[2]; g.globalAlpha = (title ? 0.45 : 1) * 0.35; g.fillRect(x + 3, y + 3, w - 6, 3);
          g.globalAlpha = title ? 0.45 : 1;
          g.strokeStyle = cell.hard ? C.amber : theme[2]; g.lineWidth = 2; g.strokeRect(x, y, w, h);
          if (cell.hard) line(g, x + 4, y + h - 4, x + w - 4, y + 4, C.amber, 2);
        }
        if (cell.bonus) diamond(g, x + w / 2, y + h / 2, 6, C.cyan, false);
        if (cell.charge) {
          g.fillStyle = "#3a1f18"; g.fillRect(x + 2, y + 2, w - 4, h - 4);
          g.strokeStyle = C.red; g.lineWidth = 2; g.strokeRect(x, y, w, h);
          line(g, x + w / 2 - 8, y + h / 2, x + w / 2 + 8, y + h / 2, C.red, 2);
          line(g, x + w / 2, y + 4, x + w / 2, y + h - 4, C.red, 2);
          diamond(g, x + w / 2, y + h / 2, 5, C.red, true);
        }
      }
    }
    g.globalAlpha = 1;
  }

  drawPlay(g) {
    // Landing brackets: where each ball next reaches paddle height.
    if (this.sub === "live") {
      let soonest = 99;
      for (const b of this.balls) soonest = Math.min(soonest, this.eta(b));
      for (const b of this.balls) {
        if (b.pred === null) continue;
        const x = clamp(b.pred, L + this.padW / 2, R - this.padW / 2), y = PAD_Y + 26, hw = this.padW / 2;
        g.globalAlpha = this.eta(b) <= soonest + 0.01 ? 1 : 0.45;
        line(g, x - hw, y, x + hw, y, C.amber, 3);
        line(g, x - hw, y - 9, x - hw, y, C.amber, 3);
        line(g, x + hw, y - 9, x + hw, y, C.amber, 3);
        diamond(g, clamp(b.pred, L, R), y, 6, C.amber, true);
        g.globalAlpha = 1;
      }
    }
    // Paddle, with a soft glow under it and a chevron on its leading end showing which way it is gliding.
    const x0 = this.px - this.padW / 2, x1 = this.px + this.padW / 2;
    g.globalAlpha = 0.18; g.fillStyle = C.ink; g.fillRect(x0 - 6, PAD_Y - 4, this.padW + 12, PAD_H + 12); g.globalAlpha = 1;
    g.fillStyle = C.ink;
    g.fillRect(x0, PAD_Y, this.padW, PAD_H);
    g.fillStyle = C.muted; g.fillRect(x0, PAD_Y + PAD_H - 3, this.padW, 3);
    if (this.t - this.padFlash < 0.12) line(g, x0, PAD_Y - 3, x1, PAD_Y - 3, C.cyan, 3);
    const lead = this.dir > 0 ? x1 + 6 : x0 - 6, back = lead + this.dir * 9, my = PAD_Y + PAD_H / 2;
    line(g, lead, my - 8, back, my, C.muted, 3);
    line(g, back, my, lead, my + 8, C.muted, 3);
    // Balls with a short trail.
    for (const b of this.balls) {
      if (this.sub === "live") {
        g.globalAlpha = 0.3; circle(g, b.tx[1], b.ty[1], BALL_R - 2, C.muted, true);
        g.globalAlpha = 0.15; circle(g, b.tx[2], b.ty[2], BALL_R - 3, C.muted, true);
        g.globalAlpha = 1;
      }
      g.globalAlpha = 0.2; circle(g, b.x, b.y, BALL_R + 7, this.servedCharge ? C.red : C.ink, true); g.globalAlpha = 1;
      circle(g, b.x, b.y, BALL_R, this.servedCharge ? C.red : C.ink, true);
    }
    // Falling bonuses.
    for (const d of this.drops) {
      g.fillStyle = C.bg; g.fillRect(d.x - 16, d.y - 12, 32, 24);
      g.strokeStyle = C.cyan; g.lineWidth = 2; g.strokeRect(d.x - 16, d.y - 12, 32, 24);
      text(g, d.type === "wide" ? "W" : d.type === "slow" ? "S" : "2", d.x, d.y + 1, 20, C.cyan, "center");
    }
    g.fillStyle = C.amber;
    for (const p of this.parts) if (p.life > 0) { g.globalAlpha = clamp(p.life * 2.2, 0, 1); g.fillRect(p.x - 2, p.y - 2, 4, 4); }
    g.globalAlpha = 1;
    // Right-hand panel: chain multiplier and running power-ups.
    if (this.sub === "live" && this.streak > 0) {
      text(g, "x" + this.multiplier, 892, 150, 36, C.amber, "center");
      text(g, "CHAIN", 892, 182, 16, C.muted, "center");
    }
    let y = 250;
    for (const [k, label, total] of [["wide", "W", WIDE_TIME], ["slow", "S", SLOW_TIME]]) {
      if (this.pw[k] <= 0) continue;
      text(g, label, 872, y, 24, C.cyan, "center");
      g.fillStyle = C.cyan;
      g.fillRect(900, y - 10, 12, 20 * 1);
      g.fillStyle = C.bg;
      g.fillRect(900, y - 10, 12, 20 * (1 - this.pw[k] / total));
      g.strokeStyle = C.cyan; g.lineWidth = 2; g.strokeRect(900, y - 10, 12, 20);
      y += 44;
    }
    // Announcements.
    const a = this.announce;
    if (a && this.clock - a.at < 3.2 && this.sub !== "clear" && this.sub !== "dying") {
      g.globalAlpha = clamp(3.2 - (this.clock - a.at), 0, 1);
      text(g, a.text, 480, 380, 34, C.ink, "center");
      if (a.news) text(g, a.news, 480, 418, 22, C.amber, "center");
      g.globalAlpha = 1;
    }
    if (this.frozen) text(g, "HELD: FROZEN UNTIL RELEASE", 480, 104, 22, C.amber, "center");
    const n = this.news;
    if (n && this.clock - n.at < 3) {
      g.globalAlpha = clamp(3 - (this.clock - n.at), 0, 1);
      text(g, n.text, 480, 72, 22, n.text.startsWith("FEAT") ? C.amber : C.cyan, "center");
      g.globalAlpha = 1;
    }
    if (this.sub === "serve" && this.clock > 3.2) text(g, "READY", 480, 400, 22, C.muted, "center");
    if (this.sub === "dying") text(g, this.lives > 0 ? "BALL LOST" : "LAST BALL LOST", 480, 380, 30, C.red, "center");
    if (this.sub === "clear") {
      text(g, "CHAMBER CLEARED", 480, 370, 34, C.amber, "center");
      text(g, "BONUS +" + this.lastBonus, 480, 410, 22, C.ink, "center");
    }
    if (this.sub === "pick") this.drawPick(g);
    this.drawMods(g);
  }
  // Two upgrade cards; the highlighted one has a bright frame and a bar that runs down to the auto-pick.
  drawPick(g) {
    const o = this.offer;
    g.fillStyle = "#0c1511ee"; g.fillRect(L + 10, 150, R - L - 20, 300);
    text(g, "CHAMBER " + String(this.chamber).padStart(2, "0") + " CLEARED / CHOOSE AN UPGRADE", 480, 182, 22, C.amber, "center");
    o.ids.forEach((id, i) => {
      const u = UPGRADES.find((x) => x.id === id), on = i === o.cur, x = o.ids.length > 1 ? 160 + i * 330 : 325, y = 214, w = 310, h = 160;
      g.fillStyle = on ? "#1a2e22" : "#111d17"; g.fillRect(x, y, w, h);
      g.strokeStyle = on ? C.amber : C.line; g.lineWidth = on ? 4 : 2; g.strokeRect(x, y, w, h);
      text(g, ["I", "III"][i] || "I", x + 22, y + 26, 18, on ? C.cyan : C.muted, "center");
      text(g, u.name, x + w / 2, y + 48, 24, on ? C.ink : C.muted, "center");
      const words = u.text.split(" "), lines = [""];
      for (const word of words) { if ((lines.at(-1) + " " + word).length > 24) lines.push(word); else lines[lines.length - 1] = (lines.at(-1) + " " + word).trim(); }
      lines.forEach((ln, k) => text(g, ln, x + w / 2, y + 88 + k * 24, 18, on ? C.ink : C.muted, "center"));
      if (this.mods[id]) text(g, "TAKEN " + this.mods[id] + " / " + u.max, x + w / 2, y + h - 14, 16, C.muted, "center");
      if (on) { g.fillStyle = C.amber; g.fillRect(x, y + h + 6, w * Math.max(0, 1 - o.t / PICK_TIME), 4); }
    });
    text(g, "TAP: SWITCH   HOLD: TAKE   LAMP I OR III SHOWS THE CHOICE", 480, 420, 18, C.cyan, "center");
  }
  // Upgrades taken this run, under the right-hand panel.
  drawMods(g) {
    let y = 380;
    for (const u of UPGRADES) {
      if (!this.mods[u.id]) continue;
      text(g, u.name.split(" ")[0] + (this.mods[u.id] > 1 ? " x" + this.mods[u.id] : ""), 900, y, 16, C.cyan, "center");
      y += 22;
    }
  }

  drawResult(g) {
    g.fillStyle = "#0c1511f0";
    g.fillRect(190, 95, 580, 330);
    line(g, 235, 105, 725, 105, C.line, 2);
    text(g, "SIGNAL LOST", 480, 145, 40, C.red, "center");
    const rows = [["SCORE", this.score], ["CHAMBER", this.chamber], ["CELLS BROKEN", this.cellsBroken],
      ["BEST CHAIN", "x" + this.bestChain]];
    rows.forEach(([label, value], i) => {
      text(g, label, 270, 210 + i * 40, 20, C.muted);
      text(g, value, 690, 210 + i * 40, 28, C.ink, "right");
    });
    text(g, "RECORD " + this.ctx.best(), 480, 378, 18, C.amber, "center");
    if (this.t - this.endedAt > 0.8) text(g, "PRESS TO PLAY AGAIN", 480, 406, 18, C.amber, "center");
    const lines = [];
    if (this.orderMet) lines.push(["DAILY ORDER MET" + (this.sv.dl.streak > 1 ? " / STREAK " + this.sv.dl.streak : ""), C.cyan]);
    else lines.push(["TODAY: " + ricochetOrder(this.dayKey()).text, C.muted]);
    for (const id of this.fresh.slice(0, 2)) lines.push(["NEW FEAT: " + RICOCHET_FEATS.find((f) => f.id === id).name, C.amber]);
    if (this.fresh.length > 2) lines.push(["AND " + (this.fresh.length - 2) + " MORE FEATS", C.amber]);
    const close = closestFeat(RICOCHET_FEATS, this.sv.ft, this);
    if (close && lines.length < 3) lines.push([close, C.muted]);
    panel(g, 430, 442 + lines.length * 28);
    lines.forEach(([s, col], i) => text(g, s, 480, 450 + i * 28, 18, col, "center"));
  }
  // Rank, today's order and one feat at a time (title screen).
  drawGoals(g, y) {
    const sv = this.sv, n = sv.ft.length, key = this.dayKey(), next = nextRank(RICOCHET_RANKS, n), streak = liveStreak(sv.dl, key);
    panel(g, y - 20, y + 112);
    text(g, "RANK " + rankOf(RICOCHET_RANKS, n) + "   FEATS " + n + " / " + RICOCHET_FEATS.length + (next ? "   NEXT RANK AT " + next[0] : ""), 480, y, 18, C.ink, "center");
    text(g, (dailyDone(sv.dl, key) ? "TODAY'S ORDER MET" : "TODAY: " + ricochetOrder(key).text) + (streak > 1 ? "   STREAK " + streak : ""), 480, y + 28, 18, dailyDone(sv.dl, key) ? C.cyan : C.amber, "center");
    drawFeatTicker(g, RICOCHET_FEATS, sv.ft, this.t, y + 60);
  }
}

Ricochet.GEOM = { L, R, TOP, PAD_Y, PAD_H, BALL_R, LOST_Y, COLS, CW, RH, GY, STEP, MAX_SPEED, LIVES, FREEZE_AFTER };
Ricochet.padSpeed = padSpeed;
Ricochet.baseSpeed = baseSpeed;
