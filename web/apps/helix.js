// HELIX — a one-button snake. A signal thread crosses a 24 x 13 field one cell per
// step and can only turn one way: every tap turns it 90 degrees clockwise, so
// "left" costs three taps and the player plans in loops and spirals.
//
// Rules chosen on purpose:
// - The boundary kills. Wrapping would make a clockwise-only thread forgiving and
//   take away the geometry (walls are what make spirals worth planning).
// - A tap turns the thread at the next step; a second tap inside the same step is
//   queued for the step after (up to three), so a quick double tap is a U-turn.
// - Fragments only appear on cells a clockwise-only thread can reach from where it
//   is now (a search over cell and heading, treating the trail as it will be when
//   the thread gets there), so no fragment is ever impossible.
// - The trail stays bounded: it grows two cells per fragment, shrinks while nothing
//   is collected, is cut to a short thread at each milestone, and is capped.
// - Every five fragments a milestone adds something new: timed fragments worth
//   triple, static obstacles, a phase charge that lets the head cross its own trail
//   once.
//
// The lamps are a direction finder (right lamp: the fragment is to the head's right,
// the way a tap turns; middle: ahead; left: left or behind), brighter when closer;
// red pulses when the next two cells are fatal. The world advances only in update(dt).
import { clamp } from "../engine/math.js";
import { C, text, line, circle, diamond, space, banner } from "../engine/draw.js";
import { LAMP, lamps, dim, lightsOff, pulse, chase } from "../engine/lightshow.js";
import { recordRun } from "../engine/kit.js";

const W = 24, H = 13, CELL = 36, X0 = 48, Y0 = 44;
const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1]; // heading 0 east; +1 is clockwise on screen
const START_LEN = 3, MIN_LEN = 4, MAX_LEN = 40, GROW = 2;
const SLOW = 0.3, FAST = 0.11, SPEED_PER_CELL = 0.007, SPEED_PER_LEVEL = 0.006; // seconds per step
const MILESTONE_LEN = 8; // the thread is cut to this length at each milestone
const READY = 1.4; // seconds before the first step of a run
const DECAY_AFTER = 10, DECAY_EVERY = 4; // steps without a fragment before the tail shortens
const MILESTONE = 5; // fragments per milestone
const MAX_QUEUE = 3;
const ESCAPE = 14; // steps of room a fragment must leave after it is collected
const MAX_OBSTACLES = 14;
const RESTART_DELAY = 0.8;
const STATES = W * H * 4;

const cellX = (c) => X0 + (c % W) * CELL + CELL / 2;
const cellY = (c) => Y0 + Math.floor(c / W) * CELL + CELL / 2;

// Which lamp (0 left, 1 middle, 2 right) a target at (tx, ty) maps to for a head at
// (hx, hy) facing `dir`, and the distance in cells. Right means a tap turns toward it.
function bearing(hx, hy, dir, tx, ty) {
  const dx = tx - hx, dy = ty - hy;
  const fwd = dx * DX[dir] + dy * DY[dir];
  const right = dx * -DY[dir] + dy * DX[dir];
  let lamp;
  if (fwd > 0 && Math.abs(right) * 2 <= fwd) lamp = 1;
  else if (right > 0) lamp = 2;
  else lamp = 0;
  return { lamp, dist: Math.abs(dx) + Math.abs(dy) };
}

export class Helix {
  constructor(ctx) {
    this.ctx = ctx;
    this.t = 0;
    this.phase = "title";
    this.endedAt = -9;
    this.cause = "";
    this.lastHud = "";
    this.lastHint = "";
    this.cnt = new Uint8Array(W * H); // trail occupancy (a phased head can double a cell)
    this.obs = new Uint8Array(W * H);
    this.ser = new Int32Array(W * H); // serial of the newest trail segment on a cell
    this.depth = new Int16Array(W * H);
    this.arrDir = new Uint8Array(W * H); // heading on first arrival, from reach()
    this.seen = new Uint8Array(STATES);
    this.dead = new Uint8Array(STATES * (ESCAPE + 1));
    this.bfsQ = new Int32Array(STATES);
    this.bfsD = new Int16Array(STATES);
    this.reset();
    this.setHint("Tap to turn clockwise. Gather fragments. Three taps turn left.");
  }

  reset() {
    this.cnt.fill(0);
    this.obs.fill(0);
    this.trail = [];
    this.serial = 0;
    const cy = Math.floor(H / 2), cx = 6;
    for (let i = 0; i < START_LEN; i++) this.pushHead(cy * W + cx + i);
    this.dir = 0;
    this.queue = [];
    this.pending = 0;
    this.acc = 0;
    this.steps = 0;
    this.sinceCollect = 0;
    this.frags = 0;
    this.level = 0;
    this.score = 0;
    this.maxLen = START_LEN;
    this.charge = 0;
    this.bonus = null; // { c, life, max }
    this.pickup = null; // phase pickup cell
    this.frag = -1;
    this.nObs = 0;
    this.ready = READY;
    this.news = "";
    this.newsT = 0;
    this.accent = 0; // seconds of green accent left
    this.chaseT = 0; // seconds of milestone chase left
    this.deadT = 0;
    this.nextBlink = 0;
    this.stepFlash = 0;
    this.frag = this.spawnCell(3, 12);
  }

  get head() { return this.trail[this.trail.length - 1]; }
  get interval() {
    return clamp(SLOW - SPEED_PER_CELL * (this.trail.length - START_LEN) - SPEED_PER_LEVEL * this.level, FAST, SLOW);
  }

  pushHead(c) {
    this.trail.push(c);
    this.cnt[c]++;
    this.ser[c] = ++this.serial;
  }

  setHint(message) {
    if (message === this.lastHint) return;
    this.lastHint = message;
    this.ctx.hint(message);
  }

  // ---- input -------------------------------------------------------------
  down() {
    if (this.phase === "title") { this.begin(); return; }
    if (this.phase === "over") {
      if (this.t - this.endedAt > RESTART_DELAY) this.begin();
      return;
    }
    if (this.ready > 0) return; // taps before the first step do nothing
    if (this.queue.length < MAX_QUEUE) {
      this.queue.push(1);
      this.ctx.tone(520, 0.03, "triangle");
    }
  }
  up() {} // holding does nothing; the menu gesture belongs to the host
  cancel() { this.queue.length = 0; this.ctx.leds(lightsOff()); }
  pause() { this.cancel(); }
  dispose() { this.queue.length = 0; this.ctx.leds(lightsOff()); }

  begin() {
    this.reset();
    this.phase = "play";
    this.ctx.tone(330, 0.08, "triangle");
  }

  // ---- search ------------------------------------------------------------
  // Can a thread that turns only clockwise enter cell c at step d? The trail is
  // treated as it will be then: a segment is gone once the tail has passed it.
  free(c, d, extra = 0) {
    if (this.obs[c]) return false;
    if (this.cnt[c] === 0) return true;
    const tailSer = this.ser[this.trail[0]];
    return d >= this.ser[c] - tailSer + 1 + this.pending + extra;
  }

  // Fill this.depth with the fewest steps to every cell reachable from the head,
  // moving straight or turning clockwise each step. Returns the number reached.
  reach() {
    const depth = this.depth, seen = this.seen, q = this.bfsQ, qd = this.bfsD;
    depth.fill(-1);
    seen.fill(0);
    const hc = this.head;
    let lo = 0, hi = 0, count = 0;
    q[hi] = hc * 4 + this.dir; qd[hi++] = 0;
    seen[q[0]] = 1;
    depth[hc] = 0;
    while (lo < hi) {
      const s = q[lo], d = qd[lo++];
      const c = s >> 2, dir = s & 3;
      const x = c % W, y = (c / W) | 0;
      // The turns already queued are committed for the first steps.
      const forced = d < this.queue.length;
      for (let turn = forced ? 1 : 0; turn <= 1; turn++) {
        const nd = (dir + turn) & 3;
        const nx = x + DX[nd], ny = y + DY[nd];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const nc = ny * W + nx;
        if (!this.free(nc, d + 1)) continue;
        const ns = nc * 4 + nd;
        if (seen[ns]) continue;
        seen[ns] = 1;
        if (depth[nc] < 0) { depth[nc] = d + 1; this.arrDir[nc] = nd; count++; }
        q[hi] = ns; qd[hi++] = d + 1;
      }
    }
    return count;
  }

  // After arriving at c (having grown by a fragment), can the thread keep moving for
  // ESCAPE more steps? Keeps fragments out of pockets the thread cannot leave.
  escape(c) {
    this.dead.fill(0);
    return this.survive(c, this.arrDir[c], this.depth[c], this.depth[c] + ESCAPE);
  }

  // Depth-first over (cell, heading, step) so a cell that is blocked now but free
  // later (the tail moves on) counts correctly; failed states are remembered.
  survive(c, dir, d, limit) {
    if (d >= limit) return true;
    const key = ((c * 4 + dir) * (ESCAPE + 1)) + (d - (limit - ESCAPE));
    if (this.dead[key]) return false;
    const x = c % W, y = (c / W) | 0;
    for (let turn = 0; turn <= 1; turn++) {
      const nd = (dir + turn) & 3, nx = x + DX[nd], ny = y + DY[nd];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const nc = ny * W + nx;
      if (this.free(nc, d + 1, GROW) && this.survive(nc, nd, d + 1, limit)) return true;
    }
    this.dead[key] = 1;
    return false;
  }

  empty(c) {
    return !this.cnt[c] && !this.obs[c] && c !== this.frag && c !== this.pickup && !(this.bonus && this.bonus.c === c);
  }

  // A random reachable cell at least minDepth steps away (preferring a manhattan
  // gap too), or any free cell if nothing is reachable. -1 if the field is full.
  spawnCell(minDepth, maxDepth = 99) {
    this.reach();
    const hc = this.head, hx = hc % W, hy = (hc / W) | 0;
    const near = [], far = [];
    for (let c = 0; c < W * H; c++) {
      const d = this.depth[c];
      if (d < minDepth || d > maxDepth || !this.empty(c)) continue;
      (Math.abs((c % W) - hx) + Math.abs(((c / W) | 0) - hy) >= 4 ? far : near).push(c);
    }
    const pool = far.length ? far : near;
    // Prefer cells the thread can leave again; fall back to merely reachable ones.
    for (let tries = 0; tries < 16 && pool.length; tries++) {
      const c = this.ctx.rng.pick(pool);
      if (this.escape(c)) return c;
    }
    if (pool.length) return this.ctx.rng.pick(pool);
    const any = [];
    for (let c = 0; c < W * H; c++) if (this.empty(c) && c !== hc) any.push(c);
    return any.length ? this.ctx.rng.pick(any) : -1;
  }

  // ---- simulation --------------------------------------------------------
  update(dt) {
    if (!(dt > 0) || dt > 0.25) dt = 1 / 60;
    this.t += dt;
    if (this.accent > 0) this.accent -= dt;
    if (this.chaseT > 0) this.chaseT -= dt;
    if (this.newsT > 0) this.newsT -= dt;
    if (this.stepFlash > 0) this.stepFlash -= dt;
    if (this.phase === "play") {
      if (this.ready > 0) {
        this.ready -= dt;
      } else {
        if (this.bonus) {
          this.bonus.life -= dt;
          if (this.bonus.life <= 0) this.bonus = null;
        }
        this.acc += dt;
        let guard = 0;
        while (this.phase === "play" && this.acc >= this.interval && guard++ < 3) {
          this.acc -= this.interval;
          this.step();
        }
      }
    } else if (this.phase === "over") {
      this.deadT += dt;
    }
    this.hud();
    this.setLamps();
  }

  turnNow() {
    if (this.queue.length) { this.queue.shift(); this.dir = (this.dir + 1) & 3; }
  }

  // What the head meets on its next cell: "" for nothing, otherwise the cause.
  hazard(c, nx, ny, d, charge) {
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) return "WALL";
    if (this.obs[c]) return "OBSTACLE";
    if (this.cnt[c] && !this.free(c, d) && charge <= 0) return "TRAIL";
    return "";
  }

  step() {
    this.turnNow();
    this.steps++;
    this.stepFlash = 0.08;
    const hc = this.head, nx = (hc % W) + DX[this.dir], ny = ((hc / W) | 0) + DY[this.dir];
    const nc = ny * W + nx;
    const bad = this.hazard(nc, nx, ny, 1, this.charge);
    if (bad) { this.die(bad); return; }
    if (this.cnt[nc] && !this.free(nc, 1)) { // phased through the trail
      this.charge = 0;
      this.ctx.tone(660, 0.12, "sine");
      this.ctx.tone(330, 0.12, "sine");
      this.news = "PHASED THROUGH";
      this.newsT = 1.4;
    }
    this.pushHead(nc);
    if (this.pending > 0) this.pending--;
    else this.popTail();
    this.sinceCollect++;
    if (this.sinceCollect > DECAY_AFTER && (this.sinceCollect - DECAY_AFTER) % DECAY_EVERY === 0 &&
        this.trail.length > MIN_LEN && this.pending === 0) this.popTail();
    if (nc === this.frag) this.collect();
    else if (this.bonus && nc === this.bonus.c) this.collectBonus();
    else if (nc === this.pickup) {
      this.pickup = null;
      this.charge = 1;
      this.accent = 0.3;
      this.ctx.tone(440, 0.08, "sine");
      this.ctx.tone(880, 0.15, "sine");
      this.news = "PHASE CHARGED / CROSS YOUR TRAIL ONCE";
      this.newsT = 2.2;
    }
    if (this.trail.length > this.maxLen) this.maxLen = this.trail.length;
  }

  popTail() {
    if (this.trail.length <= 1) return;
    const c = this.trail.shift();
    if (this.cnt[c] > 0) this.cnt[c]--;
  }

  grow() {
    this.pending = clamp(Math.min(this.pending + GROW, MAX_LEN - this.trail.length), 0, GROW * 2);
  }

  points(base) { return Math.round(base * (1 + 0.5 * this.level)); }

  collect() {
    this.frags++;
    this.score += this.points(10);
    this.sinceCollect = 0;
    this.accent = 0.3;
    this.grow();
    this.ctx.tone(660, 0.07, "sine");
    this.ctx.tone(880, 0.12, "sine");
    const level = Math.floor(this.frags / MILESTONE);
    this.frag = -1;
    if (level > this.level) this.milestone(level);
    if (this.frag < 0) this.frag = this.spawnCell(3, 14 + Math.floor(this.trail.length / 3));
    if (this.level >= 1 && !this.bonus && this.ctx.rng.next() < Math.min(0.6, 0.25 + 0.08 * this.level)) this.spawnBonus();
  }

  collectBonus() {
    this.score += this.points(30);
    this.bonus = null;
    this.sinceCollect = 0;
    this.accent = 0.3;
    this.grow();
    this.ctx.tone(784, 0.07, "triangle");
    this.ctx.tone(1047, 0.07, "triangle");
    this.ctx.tone(1319, 0.14, "triangle");
  }

  spawnBonus() {
    const c = this.spawnCell(4, 20);
    if (c < 0) return;
    const d = this.depth[c] > 0 ? this.depth[c] : 8;
    const life = d * this.interval * 1.5 + 2;
    this.bonus = { c, life, max: life };
  }

  milestone(level) {
    this.level = level;
    this.chaseT = 1.2;
    while (this.trail.length > MILESTONE_LEN) this.popTail();
    this.pending = 0;
    this.ctx.tone(392, 0.1, "triangle");
    this.ctx.tone(523, 0.1, "triangle");
    this.ctx.tone(784, 0.2, "triangle");
    if (level === 1) this.news = "NEW: TIMED FRAGMENTS WORTH TRIPLE";
    else if (level === 2) this.news = "NEW: OBSTACLES";
    else if (level === 3) this.news = "NEW: PHASE PICKUP / CROSS YOUR TRAIL ONCE";
    else this.news = "MILESTONE " + level + " / MORE OBSTACLES";
    this.newsT = 2.6;
    if (level >= 2) this.addObstacles(2);
    if (level >= 3 && !this.pickup && this.charge === 0) {
      const c = this.spawnCell(4, 22);
      if (c >= 0) this.pickup = c;
    }
    this.frag = this.spawnCell(3, 14 + Math.floor(this.trail.length / 3));
  }

  // Add static cells away from the head, keeping the main fragment reachable and
  // most of the field open.
  addObstacles(n) {
    const hc = this.head, hx = hc % W, hy = (hc / W) | 0;
    for (let k = 0; k < n && this.nObs < MAX_OBSTACLES; k++) {
      const before = this.reach();
      for (let tries = 0; tries < 14; tries++) {
        const c = this.ctx.rng.int(0, W * H - 1);
        const x = c % W, y = (c / W) | 0;
        if (!this.empty(c) || Math.abs(x - hx) + Math.abs(y - hy) < 5) continue;
        if (this.frag >= 0 && Math.abs(c - this.frag) <= 1) continue;
        this.obs[c] = 1;
        const after = this.reach();
        const ok = after >= before * 0.8 && (this.frag < 0 || this.depth[this.frag] >= 0);
        if (ok) { this.nObs++; break; }
        this.obs[c] = 0;
      }
    }
  }

  die(cause) {
    this.phase = "over";
    this.cause = cause;
    this.endedAt = this.t;
    this.deadT = 0;
    this.queue.length = 0;
    this.ctx.score(this.score);
    recordRun(this.ctx, {
      score: this.score, fragments: this.frags, longest: this.maxLen, milestone: this.level,
    });
    this.ctx.tone(220, 0.15, "square");
    this.ctx.tone(165, 0.2, "square");
    this.ctx.tone(110, 0.4, "sawtooth");
    this.setHint("Tap to try again. Hold three seconds for the menu.");
  }

  // The state the head will be in `n` steps from now if nothing more is tapped.
  // Returns the first fatal cause within that horizon, or "".
  danger(n) {
    let c = this.head, dir = this.dir, charge = this.charge;
    for (let i = 0; i < n; i++) {
      if (i < this.queue.length) dir = (dir + 1) & 3;
      const nx = (c % W) + DX[dir], ny = ((c / W) | 0) + DY[dir];
      const nc = ny * W + nx;
      const bad = this.hazard(nc, nx, ny, i + 1, charge);
      if (bad) return bad;
      if (this.cnt[nc] && !this.free(nc, i + 1)) charge = 0;
      c = nc;
    }
    return "";
  }

  // The cell the head enters next, given taps already queued.
  nextCell() {
    const dir = this.queue.length ? (this.dir + 1) & 3 : this.dir;
    const hc = this.head;
    const nx = (hc % W) + DX[dir], ny = ((hc / W) | 0) + DY[dir];
    return { x: nx, y: ny, ok: nx >= 0 && ny >= 0 && nx < W && ny < H };
  }

  // ---- HUD and lamps -----------------------------------------------------
  hud() {
    const key = this.score + "/" + this.trail.length + "/" + this.level + "/" + this.ctx.best() + this.charge;
    if (key === this.lastHud) return;
    this.lastHud = key;
    this.ctx.hud([["SCORE", this.score], ["LENGTH", this.trail.length], ["MILESTONE", this.level], ["BEST", this.ctx.best()]]);
    if (this.phase === "play") {
      this.setHint(this.charge ? "Phase charged: you may cross your own trail once."
        : "Right lamp: fragment on your right. Middle: ahead. Left: left or behind.");
    }
  }

  // Lamp values for the current state, as nine numbers.
  lampValues() {
    if (this.phase === "title") {
      return lamps(...[0, 1, 2].map((i) => dim(LAMP.green, 0.04 + 0.1 * pulse(this.t - i * 0.25, 0.25))));
    }
    if (this.phase === "over") {
      const f = Math.max(0, 1 - this.deadT / 1.2);
      return f > 0 ? lamps(...[0, 1, 2].map(() => dim(LAMP.red, 0.45 * f))) : lightsOff();
    }
    if (this.ready > 0) {
      const on = Math.floor((READY - this.ready) / (READY / 3));
      return lamps(...[0, 1, 2].map((i) => (i <= on ? dim(LAMP.amber, 0.25) : null)));
    }
    const dg = this.danger(2);
    if (dg) {
      const level = this.danger(1) ? 0.45 : 0.32;
      return lamps(...[0, 1, 2].map(() => dim(LAMP.red, 0.08 + level * pulse(this.t, 3.5))));
    }
    if (this.chaseT > 0) {
      const at = chase(1.2 - this.chaseT, 10, false);
      return lamps(...[0, 1, 2].map((i) => (i === at ? dim(LAMP.green, 0.6) : dim(LAMP.green, 0.06))));
    }
    if (this.accent > 0) return lamps(...[0, 1, 2].map(() => dim(LAMP.green, 0.55 * (this.accent / 0.3))));
    let target = this.frag, rgb = LAMP.amber;
    if (this.bonus) { target = this.bonus.c; rgb = LAMP.violet; }
    if (target < 0) return lightsOff();
    const hc = this.head;
    const b = bearing(hc % W, (hc / W) | 0, this.dir, target % W, (target / W) | 0);
    const level = 0.1 + 0.3 * (1 - clamp(b.dist / 30, 0, 1));
    const out = [null, null, null];
    out[b.lamp] = dim(rgb, level);
    // A phase charge keeps a faint cyan glow on the middle lamp when it is free.
    if (this.charge && !out[1]) out[1] = dim(LAMP.cyan, 0.06);
    return lamps(...out);
  }

  setLamps() { this.ctx.leds(this.lampValues()); }

  // ---- drawing -----------------------------------------------------------
  draw(g) {
    space(g, this.t, 0.35);
    this.drawField(g);
    if (this.phase === "title") {
      banner(g, "HELIX", "THE THREAD ONLY TURNS RIGHT");
      text(g, "EACH TAP TURNS CLOCKWISE / THREE TAPS TURN LEFT", 480, 380, 18, C.muted, "center");
      text(g, "HOLD 3 SECONDS FOR THE MENU", 480, 406, 18, C.muted, "center");
    } else if (this.phase === "play") {
      this.drawPlay(g);
    } else {
      this.drawPlay(g);
      this.drawResult(g);
    }
  }

  drawField(g) {
    g.fillStyle = "#0c1511d0";
    g.fillRect(X0, Y0, W * CELL, H * CELL);
    g.fillStyle = "#233929";
    for (let y = 0; y <= H; y++) {
      for (let x = 0; x <= W; x++) g.fillRect(X0 + x * CELL - 1, Y0 + y * CELL - 1, 2, 2);
    }
    g.strokeStyle = C.amber;
    g.lineWidth = 3;
    g.strokeRect(X0 - 2, Y0 - 2, W * CELL + 4, H * CELL + 4);
    for (let c = 0; c < W * H; c++) {
      if (!this.obs[c]) continue;
      const x = cellX(c), y = cellY(c);
      g.fillStyle = C.line;
      g.fillRect(x - 14, y - 14, 28, 28);
      line(g, x - 14, y - 14, x + 14, y + 14, C.muted, 2);
      line(g, x + 14, y - 14, x - 14, y + 14, C.muted, 2);
    }
  }

  drawPlay(g) {
    const over = this.phase === "over";
    // Cell the head enters next: fades up as the step approaches.
    if (!over) {
      const n = this.nextCell();
      if (n.ok) {
        const c = n.y * W + n.x;
        const bad = this.hazard(c, n.x, n.y, 1, this.charge);
        g.globalAlpha = this.ready > 0 ? 0.3 : 0.3 + 0.5 * clamp(this.acc / this.interval, 0, 1);
        g.strokeStyle = bad ? C.red : C.cyan;
        g.lineWidth = 3;
        g.strokeRect(X0 + n.x * CELL + 4, Y0 + n.y * CELL + 4, CELL - 8, CELL - 8);
        g.globalAlpha = 1;
      }
    }
    // Fragments and pickups.
    const bob = 1 + 0.12 * Math.sin(this.t * 5);
    if (this.frag >= 0) {
      diamond(g, cellX(this.frag), cellY(this.frag), 14 * bob, C.amber, true);
      diamond(g, cellX(this.frag), cellY(this.frag), 18 * bob, C.amber, false);
    }
    if (this.bonus) {
      const x = cellX(this.bonus.c), y = cellY(this.bonus.c);
      const frac = clamp(this.bonus.life / this.bonus.max, 0, 1);
      const urgent = frac < 0.3 && Math.floor(this.t * 6) % 2 === 0;
      g.strokeStyle = urgent ? C.red : "#c9a0ff";
      g.lineWidth = 3;
      g.beginPath();
      g.arc(x, y, 17, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
      g.stroke();
      diamond(g, x, y, 11 * bob, "#c9a0ff", true);
    }
    if (this.pickup !== null) {
      const x = cellX(this.pickup), y = cellY(this.pickup);
      circle(g, x, y, 14, C.cyan, false, 3);
      circle(g, x, y, 5 + 2 * Math.sin(this.t * 6), C.cyan, true);
    }
    // The thread: dimmer toward the tail, thick enough to follow at small size.
    const n = this.trail.length;
    g.lineCap = "round";
    for (let i = 1; i < n; i++) {
      const a = this.trail[i - 1], b = this.trail[i];
      if (Math.abs((a % W) - (b % W)) + Math.abs(((a / W) | 0) - ((b / W) | 0)) !== 1) continue;
      const shade = i > n * 0.66 ? C.ink : i > n * 0.33 ? "#a5c58c" : C.muted;
      line(g, cellX(a), cellY(a), cellX(b), cellY(b), over ? C.red : shade, 12);
    }
    g.lineCap = "butt";
    const hc = this.head;
    if (hc !== undefined) {
      const x = cellX(hc), y = cellY(hc);
      circle(g, x, y, 13, over ? C.red : C.ink, true);
      line(g, x, y, x + DX[this.dir] * 20, y + DY[this.dir] * 20, over ? C.red : C.bg, 4);
      if (this.charge) circle(g, x, y, 18, C.cyan, false, 3);
    }
    // Status strip above the field.
    if (this.newsT > 0 && this.phase === "play") text(g, this.news, 480, 22, 20, C.amber, "center");
    else if (this.phase === "play") {
      const tail = this.charge ? "PHASE READY" : "";
      text(g, tail, 480, 22, 20, C.cyan, "center");
    }
    if (this.phase === "play" && this.ready > 0) {
      text(g, this.ready > 0.5 ? "READY" : "GO", 480, 280, 42, C.ink, "center");
    }
  }

  drawResult(g) {
    g.fillStyle = "#0c1511ea";
    g.fillRect(200, 150, 560, 230);
    line(g, 235, 160, 725, 160, C.line, 2);
    text(g, "THREAD LOST", 480, 196, 36, C.red, "center");
    text(g, this.cause === "WALL" ? "HIT THE BOUNDARY" : this.cause === "OBSTACLE" ? "HIT AN OBSTACLE" : "CROSSED OWN TRAIL", 480, 232, 20, C.muted, "center");
    text(g, "SCORE " + this.score + "   FRAGMENTS " + this.frags, 480, 276, 26, C.ink, "center");
    text(g, "LONGEST " + this.maxLen + "   MILESTONE " + this.level, 480, 310, 22, C.muted, "center");
    if (this.t - this.endedAt > RESTART_DELAY) text(g, "TAP TO TRY AGAIN", 480, 352, 22, C.amber, "center");
  }
}

Helix.bearing = bearing;
Helix.W = W;
Helix.H = H;
