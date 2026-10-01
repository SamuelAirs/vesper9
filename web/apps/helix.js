// HELIX — a one-button snake. A signal thread crosses a 24 x 13 field one cell per step.
//
// It turns both ways: a tap turns it right, a press held a little longer than a tap turns it left
// (the left turn is queued the moment the hold is recognised, without waiting for the release).
// The original clockwise-only rule is still there as SPIRAL, chosen at the hangar, worth half as
// much again per fragment.
//
// Rules chosen on purpose:
// - The boundary kills (after a soft first twenty seconds). The TORUS field, earned with feats,
//   wraps instead.
// - Turns are applied at the next step; up to three are queued, so two quick taps are a U-turn.
//   The head's pointer shows a queued turn at once, so a press is answered on the very next frame.
// - Fragments only appear on cells the thread can reach from where it is now (a search over cell
//   and heading with the turns the mode allows, treating the trail as it will be when the thread
//   gets there), and preferably where it can leave again.
// - The trail stays bounded: it grows two cells per fragment, shrinks while nothing is collected,
//   is cut to a short thread at each milestone, and is capped.
// - Every five fragments a milestone adds something new: timed fragments worth triple, obstacles,
//   a phase charge that lets the head cross its own trail once, a pair of portals, then more.
// - A fragment taken quickly (within a few steps of the shortest way to it) raises a combo
//   multiplier up to x5; a slow one resets it.
//
// The hangar (hold on the title or result screen) has the turn mode, the field (OPEN, TORUS,
// LATTICE), a daily run seeded by the date, feats and a log. The save is versioned (schema 2) and
// still carries the fields the dashboard's field record reads; a first-release save is migrated.
//
// The lamps are a direction finder (right lamp: the fragment is to the head's right, the way a tap
// turns; left: to its left, the way a hold turns; middle: ahead), brighter when closer; red pulses
// when the next two cells are fatal. The world advances only in update(dt).
import { clamp, mixSeed, Random } from "../engine/math.js";
import { C, text, line, circle, diamond, space } from "../engine/draw.js";
import { LAMP, lamps, dim, lightsOff, pulse, chase } from "../engine/lightshow.js";
import { AppGuard, paceOf } from "../engine/input.js";

const W = 24, H = 13, CELL = 36, X0 = 48, Y0 = 44;
const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1]; // heading 0 east; +1 is clockwise on screen
const START_LEN = 3, MIN_LEN = 4, MAX_LEN = 40, GROW = 2;
const SLOW = 0.24, FAST = 0.1, SPEED_PER_CELL = 0.006, SPEED_PER_LEVEL = 0.006; // seconds per step
const MILESTONE_LEN = 8; // the thread is cut to this length at each milestone
const READY = 1.2; // seconds before the first step of a run
// For the first GRACE seconds of every run the boundary is soft: a thread that reaches it is
// turned instead of dying, so a newcomer who hesitates still has the time to learn the turns.
const GRACE = 20;
// In TWIN, a press held longer than the console's tap (Calibration's gesture pace: 150 ms by
// default) is a left turn, recognised LEFT_SLOP later; a shorter one is a right turn, on release.
// While a press is undecided the next step waits for it (at most that long), so a turn is never late.
const LEFT_SLOP = 0.03;
const leftHold = (settings) => paceOf(settings?.gesturePace).tapMs / 1000 + LEFT_SLOP;
// A press held this long is not a turn: the world waits until release, so the long press of
// the menu gesture cannot cost the run.
const FREEZE_AFTER = 0.6;
const HOLD_PICK = 0.5; // a press this long on a menu screen chooses instead of tapping
const DECAY_AFTER = 10, DECAY_EVERY = 4; // steps without a fragment before the tail shortens
const MILESTONE = 5; // fragments per milestone
const MAX_QUEUE = 3;
const ESCAPE = 14; // steps of room a fragment must leave after it is collected
const MAX_OBSTACLES = 14;
const RESTART_DELAY = 0.8;
const COMBO_SLACK = 4, MAX_COMBO = 5;
const STATES = W * H * 4;

export const MODES = [
  { name: "TWIN", text: "Tap turns right. Hold turns left.", mult: 1, turns: [0, 1, -1] },
  { name: "SPIRAL", text: "Taps only turn right. Points x1.5.", mult: 1.5, turns: [0, 1] },
];
export const FIELDS = [
  { name: "OPEN", need: 0, text: "Walls on four sides." },
  { name: "TORUS", need: 3, text: "The edges wrap around. Nothing at the walls." },
  { name: "LATTICE", need: 6, text: "A grid of pillars to weave through. Points x1.25." },
];

const cellX = (c) => X0 + (c % W) * CELL + CELL / 2;
const cellY = (c) => Y0 + Math.floor(c / W) * CELL + CELL / 2;
const border = (c) => { const x = c % W, y = (c / W) | 0; return x === 0 || y === 0 || x === W - 1 || y === H - 1; };
const pillar = (c) => { const x = c % W, y = (c / W) | 0; return x > 0 && y > 0 && x < W - 1 && y < H - 1 && x % 4 === 0 && y % 4 === 0; };

// Which lamp (0 left, 1 middle, 2 right) a target at (tx, ty) maps to for a head at (hx, hy)
// facing `dir`, and the distance in cells. Right means a tap turns toward it. In TWIN a target
// directly behind lights both side lamps (lamp -1); in SPIRAL left or behind is the left lamp.
export function bearing(hx, hy, dir, tx, ty, twin = true) {
  const dx = tx - hx, dy = ty - hy;
  const fwd = dx * DX[dir] + dy * DY[dir];
  const right = dx * -DY[dir] + dy * DX[dir];
  let lamp;
  if (fwd > 0 && Math.abs(right) * 2 <= fwd) lamp = 1;
  else if (right > 0) lamp = 2;
  else if (right < 0 || !twin) lamp = 0;
  else lamp = -1;
  return { lamp, dist: Math.abs(dx) + Math.abs(dy) };
}

// ---- feats ------------------------------------------------------------------------------------
const life = (a, key) => (a.sv.st[key] || 0) + (a.R[key] || 0);
export const FEATS = [
  { id: "m3", name: "THIRD TURNING", text: "Reach milestone 3.", n: 3, prog: (a) => a.level },
  { id: "m6", name: "SIXTH TURNING", text: "Reach milestone 6.", n: 6, prog: (a) => a.level },
  { id: "len", name: "LONG THREAD", text: "Grow the thread to 24 cells.", n: 24, prog: (a) => a.maxLen },
  { id: "combo", name: "QUICK HANDS", text: "Reach a x5 combo.", n: 5, prog: (a) => a.R.comboBest },
  { id: "timed", name: "TIMEKEEPER", text: "Take 5 timed fragments in one run.", n: 5, prog: (a) => a.R.bonus },
  { id: "phase", name: "GHOST", text: "Phase through your own trail.", n: 1, prog: (a) => a.R.phased },
  { id: "portal", name: "ELSEWHERE", text: "Pass through a portal.", n: 1, prog: (a) => a.R.portals },
  { id: "spiral", name: "PURIST", text: "Gather 20 fragments in one SPIRAL run.", n: 20, prog: (a) => (a.mode === 1 ? a.frags : 0) },
  { id: "torus", name: "ROUND WORLD", text: "Gather 15 fragments on the TORUS.", n: 15, prog: (a) => (a.field === 1 ? a.frags : 0) },
  { id: "lattice", name: "LATTICEWORK", text: "Gather 15 fragments on the LATTICE.", n: 15, prog: (a) => (a.field === 2 ? a.frags : 0) },
  { id: "many", name: "GATHERER", text: "Gather 500 fragments in all.", n: 500, prog: (a) => life(a, "frags") },
  { id: "daily", name: "ON THE DAY", text: "Meet a daily goal.", n: 1, prog: (a) => life(a, "daily") },
  { id: "edge", name: "SKIRTING", text: "", hint: "The walls are friends, briefly.", n: 12, hidden: true, prog: (a) => a.R.edgeBest },
  { id: "hairpin", name: "HAIRPIN", text: "", hint: "Turn twice, quickly, many times.", n: 10, hidden: true, prog: (a) => a.R.hairpins },
];
const FEAT_IDS = FEATS.map((f) => f.id);

// ---- the date and the daily run ----------------------------------------------------------------
const dailyRng = new Random(1);
const hashText = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const ymd = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const dayBefore = (key) => { const [y, m, d] = key.split("-").map(Number); return ymd(new Date(y, m - 1, d - 1)); };
// Today's goal, the same for everyone on the same date. The daily run is TWIN on the open field.
export function dailyGoal(key) {
  const h = hashText("helix" + key), kind = h % 3, v = (h >>> 8) % 5;
  if (kind === 0) return { kind: "frags", n: 12 + 3 * v, text: "Gather " + (12 + 3 * v) + " fragments." };
  if (kind === 1) return { kind: "combo", n: 3 + (v % 3), text: "Reach a x" + (3 + (v % 3)) + " combo." };
  return { kind: "level", n: 2 + (v % 3), text: "Reach milestone " + (2 + (v % 3)) + "." };
}

// ---- the save ------------------------------------------------------------------------------------
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const day = (v) => (typeof v === "string" ? v.slice(0, 10) : "");
// Bring any stored shape (nothing; schema 1, written by recordRun in the first release; schema 2)
// to schema 2. A first-release save keeps its runs, last result and milestone.
export function migrateSave(raw) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const st = r.st && typeof r.st === "object" ? r.st : {};
  const sel = r.sel && typeof r.sel === "object" ? r.sel : {};
  const dl = r.dl && typeof r.dl === "object" ? r.dl : {};
  const ft = Array.isArray(r.ft) ? r.ft.filter((id, i) => FEAT_IDS.includes(id) && r.ft.indexOf(id) === i) : [];
  const field = clamp(Math.floor(num(sel.field)), 0, FIELDS.length - 1);
  return {
    schema: 2,
    runs: Math.max(0, Math.floor(num(r.runs))),
    last: r.last && typeof r.last === "object" ? r.last : {},
    milestone: Math.max(0, Math.floor(num(r.milestone))),
    ft,
    // best score per turn mode and field
    bm: MODES.map((_, m) => FIELDS.map((_, f) => Math.max(0, Math.floor(num(Array.isArray(r.bm) && Array.isArray(r.bm[m]) ? r.bm[m][f] : undefined))))),
    st: { frags: Math.max(0, num(st.frags, r.schema === 2 ? 0 : num(r.last?.fragments))), daily: Math.max(0, num(st.daily)) },
    sel: { mode: clamp(Math.floor(num(sel.mode)), 0, MODES.length - 1), field: ft.length >= FIELDS[field].need ? field : 0 },
    dl: { d: day(dl.d), best: Math.max(0, num(dl.best)), done: dl.done ? 1 : 0, streak: Math.max(0, Math.floor(num(dl.streak))), last: day(dl.last) },
  };
}

const HANGAR = ["PLAY", "TURNS", "FIELD", "DAILY", "FEATS", "LOG"];

export class Helix {
  constructor(ctx) {
    this.ctx = ctx;
    // Takes back a menu gesture that reached the game (docs/ENGINE.md). The search tables are scratch.
    this.guard = new AppGuard(this, ctx, { skip: ["seen", "dead", "bfsQ", "bfsD"] });
    this.sv = migrateSave(ctx.progress?.());
    this.t = 0;
    this.phase = "title";
    this.endedAt = -9;
    this.cause = "";
    this.lastHud = "";
    this.lastHint = "";
    this.armed = false;
    this.pt = 0;
    this.view = "menu";
    this.cur = 0;
    this.page = 0;
    this.daily = false;
    this.dstate = 0;
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
    this.setHint("Tap to play. Hold for the hangar.");
  }

  get mode() { return this.daily ? 0 : this.sv.sel.mode; }
  get field() { return this.daily ? 0 : this.sv.sel.field; }
  get twin() { return this.mode === 0; }
  get torus() { return this.field === 1; }

  reset() {
    this.cnt.fill(0);
    this.obs.fill(0);
    if (this.field === 2) for (let c = 0; c < W * H; c++) if (pillar(c)) this.obs[c] = 1;
    this.trail = [];
    this.serial = 0;
    const cy = Math.floor(H / 2), cx = 6;
    for (let i = 0; i < START_LEN; i++) this.pushHead(cy * W + cx + i);
    this.prevHead = this.head;
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
    this.combo = 1;
    this.bonus = null; // { c, life, max }
    this.pickup = null; // phase pickup cell
    this.portals = null; // [a, b]
    this.frag = -1;
    this.fragBorn = 0;
    this.fragPar = 0;
    this.nObs = 0;
    this.ready = READY;
    this.pressing = false;
    this.leftArmed = false;
    this.leftHold = leftHold(this.ctx.settings?.());
    this.heldTime = 0;
    this.runT = 0; // seconds of live play, for the grace period
    this.news = "";
    this.newsT = 0;
    this.accent = 0; // seconds of green accent left
    this.chaseT = 0; // seconds of milestone chase left
    this.deadT = 0;
    this.stepFlash = 0;
    this.lastTurn = 0; // the turn made on the previous step, for hairpins
    this.edgeRun = 0;
    this.R = { comboBest: 1, bonus: 0, phased: 0, portals: 0, edgeBest: 0, hairpins: 0, frags: 0, daily: 0 };
    this.newFeats = [];
    this.goalDone = false;
    this.newRecord = false;
    this.frag = this.spawnCell(3, 12);
    this.fragPar = this.frag >= 0 ? this.depth[this.frag] : 0;
  }

  get head() { return this.trail[this.trail.length - 1]; }
  get interval() {
    return clamp(SLOW - SPEED_PER_CELL * (this.trail.length - START_LEN) - SPEED_PER_LEVEL * this.level, FAST, SLOW);
  }
  get turns() { return MODES[this.mode].turns; }

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

  rng() {
    if (!this.daily) return this.ctx.rng;
    dailyRng.state = this.dstate || 1;
    return dailyRng;
  }
  // Draws from the daily generator are written back after each use.
  keep() { if (this.daily) this.dstate = dailyRng.state; }

  // ---- input -------------------------------------------------------------
  // On the title, result and hangar screens a press is decided when it ends: a tap plays (or moves
  // to the next line), a press of HOLD_PICK seconds or more opens or operates the hangar.
  down() {
    this.guard.mark();
    if (this.phase === "title" || this.phase === "hangar" || (this.phase === "over" && this.t - this.endedAt > RESTART_DELAY)) {
      this.armed = true;
      this.pt = this.t;
      return;
    }
    if (this.phase !== "play") return;
    this.pressing = true;
    this.heldTime = 0;
    if (this.ready > 0) return; // presses before the first step do nothing
    if (this.twin) { this.leftArmed = true; this.leftHold = leftHold(this.ctx.settings?.()); } // decided by how long it is held
    else this.queueTurn(1);
  }
  up() {
    this.guard.release();
    if (this.armed) {
      this.armed = false;
      this.menuPress(this.t - this.pt);
      return;
    }
    if (this.leftArmed && this.phase === "play") this.queueTurn(1); // released before the left-turn hold: a right turn
    this.leftArmed = false;
    this.pressing = false;
    this.heldTime = 0;
  }
  queueTurn(turn) {
    if (this.queue.length >= MAX_QUEUE) return;
    this.queue.push(turn);
    this.ctx.tone(turn > 0 ? 520 : 390, 0.03, "triangle");
  }
  get frozen() { return this.phase === "play" && this.pressing && this.heldTime >= FREEZE_AFTER; }
  cancel() { this.guard.rewind(); this.armed = false; this.pressing = false; this.leftArmed = false; this.heldTime = 0; this.queue.length = 0; this.ctx.leds(lightsOff()); }
  pause() { this.guard.settle(); this.cancel(); }
  dispose() { this.guard.settle(); this.armed = false; this.pressing = false; this.leftArmed = false; this.queue.length = 0; this.ctx.leds(lightsOff()); }

  menuPress(dur) {
    const long = dur >= HOLD_PICK;
    if (this.phase === "title" || this.phase === "over") {
      if (long) this.openHangar();
      else { this.daily = false; this.begin(); }
      return;
    }
    if (this.view !== "menu") {
      if (long || this.view === "log") { this.view = "menu"; this.page = 0; }
      else this.page = (this.page + 1) % Math.ceil(FEATS.length / 5);
      return;
    }
    if (!long) { this.cur = (this.cur + 1) % HANGAR.length; this.ctx.tone(440, 0.03, "sine"); return; }
    this.hangarChoose();
  }
  openHangar() {
    this.phase = "hangar";
    this.view = "menu";
    this.cur = 0;
    this.page = 0;
    this.setHint("Tap: next line. Hold: choose.");
  }
  unlockedField(i) { return this.sv.ft.length >= FIELDS[i].need; }
  hangarChoose() {
    const row = HANGAR[this.cur], s = this.sv.sel;
    if (row === "PLAY") { this.daily = false; this.begin(); return; }
    if (row === "DAILY") { this.daily = true; this.begin(); return; }
    if (row === "FEATS") { this.view = "feats"; this.page = 0; return; }
    if (row === "LOG") { this.view = "log"; return; }
    if (row === "TURNS") s.mode = (s.mode + 1) % MODES.length;
    else if (row === "FIELD") { let i = s.field; do i = (i + 1) % FIELDS.length; while (!this.unlockedField(i)); s.field = i; }
    this.ctx.tone(520, 0.05, "sine");
    this.persist();
  }

  begin() {
    this.dstate = this.daily ? (mixSeed(hashText("thread" + ymd(new Date()))) || 1) : 0;
    this.reset();
    this.phase = "play";
    this.ctx.tone(330, 0.08, "triangle");
    if (this.daily) { this.news = "DAILY: " + dailyGoal(ymd(new Date())).text.toUpperCase(); this.newsT = 3; }
    this.setHint(this.twin ? "Tap: turn right. Hold: turn left. Gather the fragments." : "Tap to turn clockwise. Three taps turn left.");
  }

  // ---- geometry ----------------------------------------------------------
  // The cell one step from c heading dir: -1 off the field (TORUS wraps), and a portal leads to its twin.
  nb(c, dir) {
    let x = (c % W) + DX[dir], y = ((c / W) | 0) + DY[dir];
    if (x < 0 || y < 0 || x >= W || y >= H) {
      if (!this.torus) return -1;
      x = (x + W) % W; y = (y + H) % H;
    }
    const n = y * W + x, p = this.portals;
    if (p) { if (n === p[0]) return p[1]; if (n === p[1]) return p[0]; }
    return n;
  }

  // ---- search ------------------------------------------------------------
  // Can the thread enter cell c at step d? The trail is treated as it will be then: a segment is
  // gone once the tail has passed it.
  free(c, d, extra = 0) {
    if (this.obs[c]) return false;
    if (this.cnt[c] === 0) return true;
    const tailSer = this.ser[this.trail[0]];
    return d >= this.ser[c] - tailSer + 1 + this.pending + extra;
  }

  // Fill this.depth with the fewest steps to every cell reachable from the head, with the turns the
  // mode allows each step. Returns the number reached.
  reach() {
    const depth = this.depth, seen = this.seen, q = this.bfsQ, qd = this.bfsD, turns = this.turns;
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
      // The turns already queued are committed for the first steps.
      const forced = d < this.queue.length;
      for (let k = 0; k < (forced ? 1 : turns.length); k++) {
        const nd = (dir + (forced ? this.queue[d] : turns[k]) + 4) & 3;
        const nc = this.nb(c, nd);
        if (nc < 0 || !this.free(nc, d + 1)) continue;
        const ns = nc * 4 + nd;
        if (seen[ns]) continue;
        seen[ns] = 1;
        if (depth[nc] < 0) { depth[nc] = d + 1; this.arrDir[nc] = nd; count++; }
        q[hi] = ns; qd[hi++] = d + 1;
      }
    }
    return count;
  }

  // After arriving at c (having grown by a fragment), can the thread keep moving for ESCAPE more
  // steps? Keeps fragments out of pockets the thread cannot leave.
  escape(c) {
    this.dead.fill(0);
    return this.survive(c, this.arrDir[c], this.depth[c], this.depth[c] + ESCAPE);
  }

  // Depth-first over (cell, heading, step) so a cell that is blocked now but free later (the tail
  // moves on) counts correctly; failed states are remembered.
  survive(c, dir, d, limit) {
    if (d >= limit) return true;
    const key = ((c * 4 + dir) * (ESCAPE + 1)) + (d - (limit - ESCAPE));
    if (this.dead[key]) return false;
    for (const turn of this.turns) {
      const nd = (dir + turn + 4) & 3, nc = this.nb(c, nd);
      if (nc >= 0 && this.free(nc, d + 1, GROW) && this.survive(nc, nd, d + 1, limit)) return true;
    }
    this.dead[key] = 1;
    return false;
  }

  empty(c) {
    return !this.cnt[c] && !this.obs[c] && c !== this.frag && c !== this.pickup && !(this.bonus && this.bonus.c === c) &&
      !(this.portals && (this.portals[0] === c || this.portals[1] === c));
  }

  // A random reachable cell at least minDepth steps away (preferring a manhattan gap too), or any
  // free cell if nothing is reachable. -1 if the field is full.
  spawnCell(minDepth, maxDepth = 99) {
    this.reach();
    const rng = this.rng();
    const hc = this.head, hx = hc % W, hy = (hc / W) | 0;
    const near = [], far = [];
    for (let c = 0; c < W * H; c++) {
      const d = this.depth[c];
      if (d < minDepth || d > maxDepth || !this.empty(c)) continue;
      (Math.abs((c % W) - hx) + Math.abs(((c / W) | 0) - hy) >= 4 ? far : near).push(c);
    }
    const pool = far.length ? far : near;
    let out = -1;
    // Prefer cells the thread can leave again; fall back to merely reachable ones.
    for (let tries = 0; tries < 16 && pool.length && out < 0; tries++) {
      const c = rng.pick(pool);
      if (this.escape(c)) out = c;
    }
    if (out < 0 && pool.length) out = rng.pick(pool);
    if (out < 0) {
      const any = [];
      for (let c = 0; c < W * H; c++) if (this.empty(c) && c !== hc) any.push(c);
      if (any.length) out = rng.pick(any);
    }
    this.keep();
    return out;
  }

  // ---- simulation --------------------------------------------------------
  update(dt) {
    this.guard.tick(dt);
    if (!(dt > 0) || dt > 0.25) dt = 1 / 60;
    this.t += dt;
    if (this.accent > 0) this.accent -= dt;
    if (this.chaseT > 0) this.chaseT -= dt;
    if (this.newsT > 0) this.newsT -= dt;
    if (this.stepFlash > 0) this.stepFlash -= dt;
    if (this.phase === "play" && this.pressing) {
      this.heldTime += dt;
      if (this.leftArmed && this.heldTime >= this.leftHold) { this.leftArmed = false; this.queueTurn(-1); }
    }
    if (this.frozen) {
      // held: nothing moves, and the lamps just breathe
    } else if (this.phase === "play") {
      if (this.ready > 0) {
        this.ready -= dt;
      } else {
        if (this.bonus) {
          this.bonus.life -= dt;
          if (this.bonus.life <= 0) this.bonus = null;
        }
        this.runT += dt;
        if (this.runT >= GRACE && this.runT - dt < GRACE && !this.torus) {
          this.news = "THE WALLS ARE LIVE";
          this.newsT = 2;
          this.ctx.tone(220, 0.12, "square");
        }
        this.acc += dt;
        // An undecided press holds the step that is due until it is a right or a left turn.
        if (this.leftArmed && this.pressing) this.acc = Math.min(this.acc, this.interval * 0.999);
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

  // What the head meets on cell nc (-1: off the field): "" for nothing, otherwise the cause.
  hazard(nc, d, charge) {
    if (nc < 0) return "WALL";
    if (this.obs[nc]) return "OBSTACLE";
    if (this.cnt[nc] && !this.free(nc, d) && charge <= 0) return "TRAIL";
    return "";
  }

  step() {
    let turned = 0;
    if (this.queue.length) { turned = this.queue.shift(); this.dir = (this.dir + turned + 4) & 3; }
    if (turned && turned === this.lastTurn) this.R.hairpins++;
    this.lastTurn = turned;
    this.steps++;
    this.stepFlash = 0.08;
    const hc = this.head;
    this.prevHead = hc;
    let nc = this.nb(hc, this.dir);
    let bad = this.hazard(nc, 1, this.charge);
    if (bad === "WALL" && this.runT < GRACE) {
      // Soft boundary: turn (right first, then left, then about) until the way is clear.
      const base = this.dir;
      for (const turn of [1, -1, 2]) {
        const d = (base + turn + 4) & 3, n = this.nb(hc, d);
        if (n >= 0 && !this.hazard(n, 1, this.charge)) { this.dir = d; nc = n; bad = ""; break; }
      }
      if (bad === "WALL") { this.dir = (base + 1) & 3; nc = this.nb(hc, this.dir); bad = this.hazard(nc, 1, this.charge); }
      this.ctx.tone(300, 0.05, "triangle");
      if (this.newsT <= 0) { this.news = "THE WALL TURNS YOU. IT IS SOFT FOR A FEW SECONDS."; this.newsT = 2; }
    }
    if (bad) { this.die(bad); return; }
    if (this.cnt[nc] && !this.free(nc, 1)) { // phased through the trail
      this.charge = 0;
      this.R.phased = 1;
      this.ctx.tone(660, 0.12, "sine");
      this.ctx.tone(330, 0.12, "sine");
      this.news = "PHASED THROUGH";
      this.newsT = 1.4;
    }
    const x = (hc % W) + DX[this.dir], y = ((hc / W) | 0) + DY[this.dir];
    if (this.portals && x >= 0 && y >= 0 && x < W && y < H && this.portals.includes(y * W + x)) {
      this.R.portals++;
      this.ctx.tone(740, 0.06, "sine"); this.ctx.tone(494, 0.08, "sine");
    }
    this.pushHead(nc);
    if (this.pending > 0) this.pending--;
    else this.popTail();
    this.sinceCollect++;
    if (this.sinceCollect > DECAY_AFTER && (this.sinceCollect - DECAY_AFTER) % DECAY_EVERY === 0 &&
        this.trail.length > MIN_LEN && this.pending === 0) this.popTail();
    if (!this.torus && this.runT >= GRACE && border(nc)) { this.edgeRun++; this.R.edgeBest = Math.max(this.R.edgeBest, this.edgeRun); } else this.edgeRun = 0;
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
    this.checkFeats();
  }

  popTail() {
    if (this.trail.length <= 1) return;
    const c = this.trail.shift();
    if (this.cnt[c] > 0) this.cnt[c]--;
  }

  grow() {
    this.pending = clamp(Math.min(this.pending + GROW, MAX_LEN - this.trail.length), 0, GROW * 2);
  }

  points(base) { return Math.round(base * (1 + 0.5 * this.level) * MODES[this.mode].mult * (this.field === 2 ? 1.25 : 1)); }

  collect() {
    this.frags++;
    this.R.frags++;
    // Quick: within COMBO_SLACK steps of the shortest way there when it appeared.
    const quick = this.steps - this.fragBorn <= this.fragPar + COMBO_SLACK;
    this.combo = quick ? Math.min(MAX_COMBO, this.combo + 1) : 1;
    this.R.comboBest = Math.max(this.R.comboBest, this.combo);
    this.score += this.points(10) * this.combo;
    this.sinceCollect = 0;
    this.accent = 0.3;
    this.grow();
    this.ctx.tone(660 + (this.combo - 1) * 60, 0.07, "sine");
    this.ctx.tone(880 + (this.combo - 1) * 80, 0.12, "sine");
    const level = Math.floor(this.frags / MILESTONE);
    this.frag = -1;
    if (level > this.level) this.milestone(level);
    if (this.frag < 0) this.placeFrag();
    if (this.level >= 1 && !this.bonus && this.rng().next() < Math.min(0.6, 0.25 + 0.08 * this.level)) { this.keep(); this.spawnBonus(); } else this.keep();
  }
  placeFrag() {
    this.frag = this.spawnCell(3, 14 + Math.floor(this.trail.length / 3));
    this.fragBorn = this.steps;
    this.fragPar = this.frag >= 0 && this.depth[this.frag] > 0 ? this.depth[this.frag] : 12;
  }

  collectBonus() {
    this.score += this.points(30) * this.combo;
    this.R.bonus++;
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
    else if (level === 4) this.news = "NEW: PORTALS / IN AT ONE, OUT AT THE OTHER";
    else this.news = "MILESTONE " + level + " / MORE OBSTACLES";
    this.newsT = 2.6;
    if (level >= 2) this.addObstacles(2);
    if (level >= 3 && !this.pickup && this.charge === 0) {
      const c = this.spawnCell(4, 22);
      if (c >= 0) this.pickup = c;
    }
    // Portals from milestone 4, moved to new places at every milestone after.
    if (level >= 4) {
      this.portals = null;
      const a = this.spawnCell(5, 30);
      if (a >= 0) {
        this.portals = [a, a];
        const b = this.spawnCell(5, 40);
        const ax = a % W, ay = (a / W) | 0;
        this.portals = b >= 0 && Math.abs((b % W) - ax) + Math.abs(((b / W) | 0) - ay) >= 6 ? [a, b] : null;
      }
    }
    this.placeFrag();
  }

  // Add static cells away from the head, keeping the main fragment reachable and most of the field open.
  addObstacles(n) {
    const hc = this.head, hx = hc % W, hy = (hc / W) | 0;
    const rng = this.rng();
    for (let k = 0; k < n && this.nObs < MAX_OBSTACLES; k++) {
      const before = this.reach();
      for (let tries = 0; tries < 14; tries++) {
        const c = rng.int(0, W * H - 1);
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
    this.keep();
  }

  die(cause) {
    this.phase = "over";
    this.cause = cause;
    this.endedAt = this.t;
    this.deadT = 0;
    this.queue.length = 0;
    this.leftArmed = false;
    this.finish();
    this.ctx.tone(220, 0.15, "square");
    this.ctx.tone(165, 0.2, "square");
    this.ctx.tone(110, 0.4, "sawtooth");
    this.setHint("Tap to try again. Hold for the hangar.");
  }
  plainRun() { return !this.daily && this.field === 0; }
  // Bank the run. The console score and the save go through the guard, so a death the menu gesture
  // caused never reaches either.
  finish() {
    const sv = this.sv, R = this.R, key = ymd(new Date());
    this.goalDone = this.daily && this.goalMet();
    if (this.goalDone && !(sv.dl.d === key && sv.dl.done)) R.daily = 1;
    // Feats read the run's counters on top of the totals, so they are checked before the totals grow.
    this.checkFeats(true);
    sv.runs++;
    sv.st.frags += R.frags;
    if (this.daily) {
      if (sv.dl.d !== key) { sv.dl.d = key; sv.dl.best = 0; sv.dl.done = 0; }
      sv.dl.best = Math.max(sv.dl.best, this.score);
      if (R.daily) {
        sv.dl.done = 1;
        sv.st.daily++;
        sv.dl.streak = sv.dl.last && dayBefore(key) === sv.dl.last ? sv.dl.streak + 1 : 1;
        sv.dl.last = key;
      }
    } else {
      this.newRecord = this.score > 0 && this.score > sv.bm[this.mode][this.field];
      sv.bm[this.mode][this.field] = Math.max(sv.bm[this.mode][this.field], this.score);
    }
    sv.last = { score: this.score, fragments: this.frags, longest: this.maxLen, milestone: this.level };
    sv.milestone = Math.max(sv.milestone, this.level);
    if (this.plainRun()) this.ctx.score(this.score);
    this.persist();
  }
  goalMet() {
    const g = dailyGoal(ymd(new Date()));
    if (g.kind === "frags") return this.frags >= g.n;
    if (g.kind === "combo") return this.R.comboBest >= g.n;
    return this.level >= g.n;
  }
  // Mark feats whose progress has reached its goal. `quiet` skips the announcement.
  checkFeats(quiet = false) {
    for (const f of FEATS) {
      if (this.sv.ft.includes(f.id) || f.prog(this) < f.n) continue;
      this.sv.ft.push(f.id);
      this.newFeats.push(f.id);
      if (!quiet) {
        this.news = "FEAT: " + f.name;
        this.newsT = 2.2;
        this.ctx.tone(988, 0.08, "sine");
      }
    }
  }
  persist() {
    this.ctx.saveProgress?.(JSON.parse(JSON.stringify(this.sv)))?.catch?.(this.ctx.error);
  }

  // The first fatal cause within n steps if nothing more is tapped, or "".
  danger(n) {
    let c = this.head, dir = this.dir, charge = this.charge;
    for (let i = 0; i < n; i++) {
      if (i < this.queue.length) dir = (dir + this.queue[i] + 4) & 3;
      const nc = this.nb(c, dir);
      const bad = this.hazard(nc, i + 1, charge);
      if (bad === "WALL" && this.runT < GRACE) return "";
      if (bad) return bad;
      if (this.cnt[nc] && !this.free(nc, i + 1)) charge = 0;
      c = nc;
    }
    return "";
  }

  // The heading the head will take on the next step, given turns already queued.
  get nextDir() { return this.queue.length ? (this.dir + this.queue[0] + 4) & 3 : this.dir; }

  // ---- HUD and lamps -----------------------------------------------------
  hud() {
    const best = this.daily ? this.sv.dl.best : this.ctx.best();
    const key = this.phase + this.score + "/" + this.trail.length + "/" + this.combo + "/" + best + this.charge + this.level;
    if (key === this.lastHud) return;
    this.lastHud = key;
    if (this.phase === "play" || this.phase === "over") {
      this.ctx.hud([["SCORE", this.score], ["LENGTH", this.trail.length], ["COMBO", "x" + this.combo + "  M" + this.level], ["BEST", best]]);
    } else {
      this.ctx.hud([["TURNS", MODES[this.sv.sel.mode].name], ["FIELD", FIELDS[this.sv.sel.field].name], ["FEATS", this.sv.ft.length + "/" + FEATS.length], ["BEST", this.ctx.best()]]);
    }
    if (this.phase === "play") {
      this.setHint(this.charge ? "Phase charged: you may cross your own trail once."
        : this.twin ? "Right lamp: tap. Left lamp: hold. Middle: straight ahead."
        : "Right lamp: fragment on your right. Middle: ahead. Left: left or behind.");
    }
  }

  // Lamp values for the current state, as nine numbers.
  lampValues() {
    if (this.phase === "title" || this.phase === "hangar") {
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
    const b = bearing(hc % W, (hc / W) | 0, this.dir, target % W, (target / W) | 0, this.twin);
    const level = 0.1 + 0.3 * (1 - clamp(b.dist / 30, 0, 1));
    const out = [null, null, null];
    if (b.lamp < 0) { out[0] = dim(rgb, level * 0.7); out[2] = dim(rgb, level * 0.7); } else out[b.lamp] = dim(rgb, level);
    // A phase charge keeps a faint cyan glow on the middle lamp when it is free.
    if (this.charge && !out[1]) out[1] = dim(LAMP.cyan, 0.06);
    return lamps(...out);
  }

  setLamps() { this.ctx.leds(this.lampValues()); }

  // ---- drawing -----------------------------------------------------------
  draw(g) {
    space(g, this.t, 0.35);
    if (this.phase !== "hangar") this.drawField(g);
    if (this.phase === "title") {
      this.drawPlay(g);
      g.fillStyle = "#0c1511e8";
      g.fillRect(140, 150, 680, 270);
      line(g, 195, 158, 765, 158, C.line);
      text(g, "HELIX", 480, 204, 42, C.ink, "center");
      text(g, this.sv.sel.mode ? "SPIRAL: EVERY TAP TURNS RIGHT" : "TAP TURNS RIGHT / HOLD TURNS LEFT", 480, 258, 22, C.muted, "center");
      text(g, "GATHER THE AMBER DIAMONDS. AVOID WALLS AND YOUR TAIL.", 480, 290, 18, C.muted, "center");
      if (this.sv.runs) text(g, "TURNS " + MODES[this.sv.sel.mode].name + "   FIELD " + FIELDS[this.sv.sel.field].name + "   FEATS " + this.sv.ft.length + " / " + FEATS.length, 480, 334, 18, C.muted, "center");
      text(g, "TAP = PLAY     HOLD = HANGAR", 480, 380, 22, C.amber, "center");
    } else if (this.phase === "play") {
      this.drawPlay(g);
    } else if (this.phase === "over") {
      this.drawPlay(g);
      this.drawResult(g);
    } else {
      this.drawHangar(g);
    }
    this.drawHoldRing(g);
  }

  drawField(g) {
    g.fillStyle = "#0c1511d0";
    g.fillRect(X0, Y0, W * CELL, H * CELL);
    g.fillStyle = "#233929";
    for (let y = 0; y <= H; y++) {
      for (let x = 0; x <= W; x++) g.fillRect(X0 + x * CELL - 1, Y0 + y * CELL - 1, 2, 2);
    }
    // A wrapping field has a dashed edge: there is no wall.
    g.strokeStyle = this.torus ? C.cyan : C.amber;
    g.lineWidth = 3;
    if (this.torus) g.setLineDash?.([10, 8]);
    g.strokeRect(X0 - 2, Y0 - 2, W * CELL + 4, H * CELL + 4);
    g.setLineDash?.([]);
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
    const frac = this.ready > 0 || over || this.frozen ? 0 : clamp(this.acc / this.interval, 0, 1);
    const hc = this.head, nd = this.nextDir;
    const next = hc === undefined ? -1 : this.nb(hc, nd);
    // Cell the head enters next: fades up as the step approaches.
    if (this.phase === "play") {
      const x = (hc % W) + DX[nd], y = ((hc / W) | 0) + DY[nd];
      const bad = this.hazard(next, 1, this.charge);
      if (next >= 0 || (x >= 0 && y >= 0 && x < W && y < H)) {
        const c = next >= 0 ? next : y * W + x;
        g.globalAlpha = this.ready > 0 ? 0.3 : 0.3 + 0.5 * frac;
        g.strokeStyle = bad ? C.red : C.cyan;
        g.lineWidth = 3;
        g.strokeRect(X0 + (c % W) * CELL + 4, Y0 + ((c / W) | 0) * CELL + 4, CELL - 8, CELL - 8);
        g.globalAlpha = 1;
      } else {
        // Heading off the field: the wall segment it will meet glows red.
        g.strokeStyle = C.red; g.lineWidth = 4;
        const cx = cellX(hc), cy = cellY(hc);
        line(g, cx + DX[nd] * 18 - DY[nd] * 16, cy + DY[nd] * 18 - DX[nd] * 16, cx + DX[nd] * 18 + DY[nd] * 16, cy + DY[nd] * 18 + DX[nd] * 16, C.red, 4);
      }
    }
    // Portals: two blue rings with the same spinning mark.
    if (this.portals) {
      for (const p of this.portals) {
        const x = cellX(p), y = cellY(p), a = this.t * 3;
        circle(g, x, y, 15, "#7fb0d8", false, 3);
        circle(g, x, y, 9, "#7fb0d8", false, 2);
        line(g, x - 9 * Math.cos(a), y - 9 * Math.sin(a), x + 9 * Math.cos(a), y + 9 * Math.sin(a), "#7fb0d8", 3);
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
      const f = clamp(this.bonus.life / this.bonus.max, 0, 1);
      const urgent = f < 0.3 && Math.floor(this.t * 6) % 2 === 0;
      g.strokeStyle = urgent ? C.red : "#c9a0ff";
      g.lineWidth = 3;
      g.beginPath();
      g.arc(x, y, 17, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2);
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
    if (hc === undefined) return;
    // The head glides toward the next cell between steps, so the thread moves smoothly.
    let x = cellX(hc), y = cellY(hc);
    if (this.phase === "play" && next >= 0 && !this.hazard(next, 1, this.charge) && Math.abs((next % W) - (hc % W)) + Math.abs(((next / W) | 0) - ((hc / W) | 0)) === 1) {
      const e = frac * frac * (3 - 2 * frac) * 0.85;
      const nx = x + (cellX(next) - x) * e, ny = y + (cellY(next) - y) * e;
      line(g, x, y, nx, ny, C.ink, 12);
      x = nx; y = ny;
    }
    g.lineCap = "butt";
    circle(g, x, y, 13, over ? C.red : C.ink, true);
    // The pointer shows where the head goes next, so a turn is seen the moment it is pressed.
    line(g, x, y, x + DX[nd] * 20, y + DY[nd] * 20, over ? C.red : C.bg, 4);
    if (this.charge) circle(g, x, y, 18, C.cyan, false, 3);
    // A press being held in TWIN: a ring fills toward the left turn.
    if (this.leftArmed && this.pressing) {
      const f = clamp(this.heldTime / this.leftHold, 0, 1);
      g.beginPath();
      g.arc(x, y, 20, -Math.PI / 2, -Math.PI / 2 - f * Math.PI * 2, true);
      g.strokeStyle = C.amber; g.lineWidth = 3; g.stroke();
    }
    // Status strip above the field.
    if (this.frozen) text(g, "HELD: PAUSED UNTIL YOU LET GO", 480, 22, 20, C.amber, "center");
    else if (this.newsT > 0 && this.phase === "play") text(g, this.news, 480, 22, 20, C.amber, "center");
    else if (this.phase === "play") {
      if (this.runT < GRACE && this.ready <= 0 && !this.torus) text(g, "WALLS ARE SOFT FOR " + Math.ceil(GRACE - this.runT) + " S", 480, 22, 20, C.muted, "center");
      else if (this.combo > 1) text(g, "COMBO x" + this.combo, 480, 22, 20, C.amber, "center");
      else text(g, this.charge ? "PHASE READY" : "", 480, 22, 20, C.cyan, "center");
    }
    if (this.phase === "play" && this.ready > 0) {
      text(g, this.ready > 0.5 ? "READY" : "GO", 480, 280, 42, C.ink, "center");
      if (this.twin && this.sv.runs < 5) text(g, "TAP: RIGHT     HOLD: LEFT", 480, 330, 22, C.amber, "center");
    }
  }

  drawHoldRing(g) {
    if (!this.armed) return;
    const f = clamp((this.t - this.pt) / HOLD_PICK, 0, 1);
    if (f < 0.25) return;
    g.beginPath();
    g.arc(900, 22, 16, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f);
    g.strokeStyle = f >= 1 ? C.cyan : C.amber;
    g.lineWidth = 4;
    g.stroke();
  }

  drawResult(g) {
    g.fillStyle = "#0c1511ee";
    g.fillRect(190, 96, 580, 360);
    line(g, 225, 106, 735, 106, C.line, 2);
    text(g, "THREAD LOST", 480, 140, 36, C.red, "center");
    text(g, this.cause === "WALL" ? "HIT THE BOUNDARY" : this.cause === "OBSTACLE" ? "HIT AN OBSTACLE" : "CROSSED OWN TRAIL", 480, 174, 20, C.muted, "center");
    text(g, "SCORE " + this.score + "   FRAGMENTS " + this.frags, 480, 214, 26, C.ink, "center");
    text(g, "LONGEST " + this.maxLen + "   MILESTONE " + this.level + "   BEST COMBO x" + this.R.comboBest, 480, 248, 20, C.muted, "center");
    let y = 284;
    if (this.daily) { text(g, this.goalDone ? "DAILY GOAL MET" : "DAILY: " + dailyGoal(ymd(new Date())).text, 480, y, 18, this.goalDone ? C.cyan : C.muted, "center"); y += 28; }
    else if (this.newRecord) { text(g, "NEW BEST FOR " + MODES[this.mode].name + " / " + FIELDS[this.field].name, 480, y, 18, C.cyan, "center"); y += 28; }
    for (const id of this.newFeats.slice(0, 2)) {
      const f = FEATS.find((x) => x.id === id);
      if (f) { text(g, "FEAT  " + f.name, 480, y, 20, C.cyan, "center"); y += 28; }
    }
    const next = FIELDS.find((f, i) => !this.unlockedField(i));
    if (next && y < 400) text(g, "NEXT FIELD: " + next.name + " AT " + next.need + " FEATS (" + this.sv.ft.length + ")", 480, y, 18, C.muted, "center");
    if (this.t - this.endedAt > RESTART_DELAY) text(g, "TAP = AGAIN     HOLD = HANGAR", 480, 430, 22, C.amber, "center");
  }

  drawHangar(g) {
    g.fillStyle = "#0c1511f2";
    g.fillRect(110, 36, 740, 470);
    line(g, 160, 46, 800, 46, C.line);
    text(g, "HANGAR", 480, 80, 34, C.amber, "center");
    const sv = this.sv, n = sv.ft.length, key = ymd(new Date());
    if (this.view === "menu") {
      const rows = {
        PLAY: ["PLAY", MODES[sv.sel.mode].name + " / " + FIELDS[sv.sel.field].name],
        TURNS: ["TURNS", MODES[sv.sel.mode].name],
        FIELD: ["FIELD", FIELDS[sv.sel.field].name],
        DAILY: ["DAILY RUN", sv.dl.d === key && sv.dl.done ? "DONE TODAY" : "SEEDED BY DATE"],
        FEATS: ["FEATS", n + " / " + FEATS.length],
        LOG: ["LOG", "RUNS " + sv.runs],
      };
      HANGAR.forEach((id, i) => {
        const y = 140 + i * 44, on = i === this.cur;
        if (on) diamond(g, 150, y, 9, C.amber, true);
        text(g, rows[id][0], 180, y, 24, on ? C.amber : C.ink);
        text(g, rows[id][1], 810, y, 22, on ? C.amber : C.muted, "right");
      });
      const id = HANGAR[this.cur];
      let info;
      if (id === "PLAY") info = sv.sel.field ? "Only the open field sets the console best." : "A run on the open field.";
      else if (id === "TURNS") info = MODES[sv.sel.mode].text;
      else if (id === "FIELD") { const next = FIELDS.find((f, i) => !this.unlockedField(i)); info = FIELDS[sv.sel.field].text + (next ? "  NEXT: " + next.name + " AT " + next.need + " FEATS" : ""); }
      else if (id === "DAILY") info = "Goal: " + dailyGoal(key).text + (sv.dl.streak > 1 ? "  STREAK " + sv.dl.streak : "");
      else if (id === "FEATS") info = "Named goals that open new fields. Some are not listed.";
      else info = "Best scores by turns and field.";
      text(g, info, 480, 420, 18, C.muted, "center");
      text(g, "TAP = NEXT LINE     HOLD = CHOOSE", 480, 470, 18, C.cyan, "center");
    } else if (this.view === "feats") {
      const per = 5, pages = Math.ceil(FEATS.length / per);
      text(g, "FEATS  " + n + " / " + FEATS.length + "     PAGE " + (this.page + 1) + " / " + pages, 480, 118, 20, C.cyan, "center");
      FEATS.slice(this.page * per, this.page * per + per).forEach((f, i) => {
        const y = 160 + i * 58, done = sv.ft.includes(f.id);
        text(g, (done ? "[X] " : "[ ] ") + (f.hidden && !done ? "????" : f.name), 150, y, 22, done ? C.cyan : C.ink);
        const prog = f.id === "many" ? sv.st.frags : f.id === "daily" ? sv.st.daily : null;
        text(g, done ? "DONE" : prog !== null ? Math.min(prog, f.n) + " / " + f.n : "", 810, y, 20, done ? C.cyan : C.amber, "right");
        text(g, f.hidden && !done ? f.hint : f.text, 150, y + 26, 16, C.muted);
      });
      text(g, "TAP = NEXT PAGE     HOLD = BACK", 480, 470, 18, C.cyan, "center");
    } else {
      text(g, "LOG   RUNS " + sv.runs + "   FRAGMENTS " + sv.st.frags + "   DAILY GOALS " + sv.st.daily, 480, 118, 20, C.cyan, "center");
      text(g, "BEST", 180, 160, 20, C.muted);
      FIELDS.forEach((f, j) => text(g, f.name, 440 + j * 160, 160, 20, this.unlockedField(j) ? C.ink : C.line, "center"));
      MODES.forEach((m, i) => {
        const y = 204 + i * 44;
        text(g, m.name, 180, y, 22, C.ink);
        FIELDS.forEach((f, j) => text(g, this.unlockedField(j) ? String(sv.bm[i][j]) : "-", 440 + j * 160, y, 22, C.amber, "center"));
      });
      text(g, "CONSOLE BEST " + this.ctx.best() + "   HIGHEST MILESTONE " + sv.milestone, 480, 330, 20, C.muted, "center");
      text(g, "TAP = BACK", 480, 470, 18, C.cyan, "center");
    }
  }
}

Helix.bearing = bearing;
Helix.GRACE = GRACE;
Helix.FREEZE_AFTER = FREEZE_AFTER;
Helix.leftHold = leftHold;
Helix.W = W;
Helix.H = H;
