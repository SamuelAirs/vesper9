// MOONRUNNER — a one-button downhill run. A survey sled rides the long regolith slopes of the
// moon. Tap: jump. Hold in the air: the sled turns backwards; let go so it lands flat on the slope.
// A landed flip, a cable ground, a rille cleared or a boulder jumped builds the combo; the combo
// multiplies trick points and, from three, gives the sled a surge of speed. A bad landing costs
// the combo or, upside down, the run.
//
// Around that: six zones that each add one thing to the slope (boulders, rilles, cables, crater
// rims and gas vents, the dark far side), survey orders (three goals per level, which unlock rides,
// zen riding and trails), shards to spend in the workshop, a daily run seeded by the date, and a
// depot reached by holding on the title or result screen. The save is versioned (schema 2) and
// carries the first release's fields.
//
// Drawing is smooth on an uneven frame clock: the terrain is a Catmull-Rom curve through fixed
// control points, every background layer is a function of world position (nothing pops when it
// wraps), and draw() extrapolates the camera by the time since the last fixed update.
import { C, space, text, line, circle, diamond } from "../engine/draw.js";
import { TAU, clamp, lerp, wrapAngle, mixSeed, Random } from "../engine/math.js";
import { LAMP, lamps, dim, spot, pulse, blink, fill, lightsOff } from "../engine/lightshow.js";
import { AppGuard } from "../engine/input.js";
import { LampBus } from "./game-kit.js";

export const G = 1100; // px/s^2
export const PX_M = 20; // px per metre
export const SEG = 120; // spacing of the terrain's control points (px)
const DRAG = 0.00105, FRICT = 30;
export const MIN_V = 240;
export const CLEAN = 0.5; // a landing this close to the slope (radians) is clean
export const STUMBLE = 1.0; // up to this it is a stumble; beyond it, a crash
const TAP_GRACE = 0.12; // a press shorter than this is a jump only; holding longer turns the sled
const COMBO_T = 2.6; // seconds of plain riding a combo survives
const COYOTE = 0.09, BUFFER = 0.12;
const RIDER_X = 300; // the rider's screen x
const AHEAD = 2600, BEHIND = 700; // terrain is kept this far ahead of and behind the rider (px)
const SAFE = 120 * PX_M; // the first 120 m of a run have no hazards
const FORGIVE = 250 * PX_M; // a crash in the first 250 m of a run is only a tumble
const VENT_V = 820;
const HOLD_PICK = 0.5; // a press this long on a menu screen chooses instead of tapping
const LOCK = 0.7; // the result screen ignores presses this long
const MAX_ROCKS = 24, MAX_SHARDS = 64, MAX_CHASMS = 8, MAX_RAILS = 8, MAX_VENTS = 8, MAX_PARTS = 32, TRAIL = 8;
const REASONS = {
  rock: "STRUCK A BOULDER",
  land: "LANDED UPSIDE DOWN",
  rille: "FELL INTO A RILLE",
  wall: "HIT THE FAR WALL",
};

// ---- the slope -----------------------------------------------------------------
// Each zone starts at `from` metres. `slope` is the average fall per px, `roll` the size of the dunes,
// `mix` the weights of what the planner puts on the slope. Past the far side the run goes on, denser.
export const ZONES = [
  { name: "THE MARE", roman: "I", from: 0, slope: 0.2, roll: 12, col: LAMP.green, ink: "#9fdc7a", text: "Long dunes. Tap to jump. Hold in the air to flip.", mix: { kicker: 3, shards: 3 } },
  { name: "THE BOULDERS", roman: "II", from: 500, slope: 0.22, roll: 16, col: LAMP.amber, ink: C.amber, text: "Boulders on the slope. Jump them.", mix: { rock: 5, kicker: 2, shards: 2 } },
  { name: "THE RILLES", roman: "III", from: 1200, slope: 0.24, roll: 16, col: LAMP.cyan, ink: C.cyan, text: "Rilles split the ground. Jump before the edge.", mix: { chasm: 5, rock: 3, kicker: 1, shards: 1 } },
  { name: "THE CONDUITS", roman: "IV", from: 2100, slope: 0.26, roll: 18, col: LAMP.violet, ink: "#b48cf0", text: "Old survey cables. Land on one to grind.", mix: { rail: 4, railgap: 3, rock: 2, chasm: 2, shards: 1 } },
  { name: "THE RIMS", roman: "V", from: 3200, slope: 0.28, roll: 22, col: LAMP.white, ink: "#ece4d0", text: "Crater rims and gas vents throw you high.", mix: { vent: 3, kicker: 3, rock: 2, chasm: 2, rail: 1 } },
  { name: "THE FAR SIDE", roman: "VI", from: 4500, slope: 0.3, roll: 20, col: LAMP.blue, ink: "#6fa8dc", text: "No Earth in this sky. Trust the lamps.", mix: { rock: 3, chasm: 3, rail: 2, railgap: 2, vent: 2, kicker: 2, shards: 1 }, dark: true },
];
export const zoneAt = (m) => { for (let i = ZONES.length - 1; i > 0; i--) if (m >= ZONES[i].from) return i; return 0; };
const MOTIFS = [[392, 494, 587], [440, 554, 659], [330, 415, 494], [294, 370, 440], [523, 659, 784], [262, 311, 392]];
const PENT = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
const note = (k) => 330 * Math.pow(2, PENT[clamp(k, 0, PENT.length - 1)] / 12);

// ---- rides, trails, workshop --------------------------------------------------------
// `lv` is the survey level that unlocks a ride or a trail.
export const RIDES = [
  { name: "SURVEYOR", flip: 7.6, maxV: 640, jump: 430, lv: 1, text: "The survey sled. Even-tempered." },
  { name: "SKIMMER", flip: 9.4, maxV: 600, jump: 470, lv: 3, text: "Light. Quick flips, high jumps, less speed." },
  { name: "HAULER", flip: 6.3, maxV: 720, jump: 405, lv: 6, smash: 20, text: "Heavy. Slow flips. Breaks small boulders." },
];
const TRAILS = [
  { name: "AMBER", col: C.amber, lv: 1 },
  { name: "CYAN", col: C.cyan, lv: 4 },
  { name: "MOSS", col: C.ink, lv: 7 },
  { name: "EMBER", col: C.red, lv: 9 },
  { name: "VIOLET", col: "#b48cf0", lv: 12 },
];
// Bought with shards. tiers[i] is the cost of tier i + 1.
export const WORKSHOP = [
  { id: "mag", name: "MAGNET", tiers: [80, 200, 400], text: "Pulls shards in from further away." },
  { id: "hov", name: "HOVER PADS", tiers: [150, 450], text: "Catch a crash once (twice at tier 2) per run." },
  { id: "lamp", name: "HEADLAMP", tiers: [120], text: "Lights more of the far side ahead." },
];
const MAG_R = [0, 45, 85, 130];
const LAMP_R = [480, 720];
const ZEN_LV = 2;
const RANKS = ["CADET", "SURVEYOR", "PATHFINDER", "RIDGE WALKER", "RILLE JUMPER", "CABLE HAND", "RIM RIDER", "FAR SIDER", "MOON GHOST"];
export const rankOf = (lv) => RANKS[Math.min(RANKS.length - 1, Math.floor((lv - 1) / 3))];

// ---- survey orders: three goals a level ------------------------------------------------
// `min` is the first level an order can appear at, so every order on the board can be met by then.
const zoneProg = (a) => (a.startZone === 0 ? a.R.zone : 0);
export const ORDER_KINDS = {
  dist: { min: 1, n: (L) => Math.min(6000, 250 + 150 * L), text: (n) => `Ride ${n} m in one run.`, prog: (a) => a.R.m },
  score: { min: 1, n: (L) => Math.min(30000, 500 + 400 * L), text: (n) => `Score ${n} in one run.`, prog: (a) => a.scoreNow() },
  flips: { min: 1, n: (L) => Math.min(25, 1 + Math.floor(L * 0.7)), text: (n) => `Land ${n} flip${n > 1 ? "s" : ""} in one run.`, prog: (a) => a.R.flips },
  shards: { min: 1, n: (L) => Math.min(150, 8 + 5 * L), text: (n) => `Collect ${n} shards in one run.`, prog: (a) => a.R.shards },
  rocks: { min: 2, n: (L) => Math.min(25, 2 + L), text: (n) => `Jump ${n} boulders in one run.`, prog: (a) => a.R.rocks },
  combo: { min: 2, n: (L) => Math.min(20, 2 + Math.floor(L / 2)), text: (n) => `Reach a combo of ${n}.`, prog: (a) => a.R.combo },
  zone: { min: 2, n: (L) => Math.min(5, 1 + Math.floor(L / 3)), text: (n) => `Reach ${ZONES[n].name} from the start.`, prog: zoneProg },
  double: { min: 3, n: () => 2, text: () => "Land a double flip.", prog: (a) => a.R.maxFlip },
  clean: { min: 3, n: (L) => Math.min(5000, 200 + 120 * L), text: (n) => `Ride ${n} m without a stumble.`, prog: (a) => a.R.cleanMax },
  zen: { min: 3, n: () => 1000, text: (n) => `Ride ${n} m in zen.`, prog: (a) => a.R.zenM },
  chasm: { min: 4, n: (L) => Math.min(15, Math.floor(L / 2)), text: (n) => `Clear ${n} rilles in one run.`, prog: (a) => a.R.chasms },
  hoard: { min: 5, n: (L) => 150 * L, text: (n) => `Collect ${n} shards in all.`, prog: (a) => a.sv.st.shards + a.R.shards },
  grind: { min: 6, n: (L) => Math.min(400, 10 + 5 * L), text: (n) => `Grind ${n} m of cable in one run.`, prog: (a) => a.R.grind },
  vent: { min: 8, n: (L) => Math.min(5, 1 + Math.floor((L - 8) / 4)), text: (n) => `Flip off ${n} vent${n > 1 ? "s" : ""} in one run.`, prog: (a) => a.R.vents },
  triple: { min: 10, n: () => 3, text: () => "Land a triple flip.", prog: (a) => a.R.maxFlip },
};
const hashText = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
// The three orders of level L, the same on every console. Level 1 is a fixed introduction.
export function ordersFor(L) {
  if (L <= 1) return [{ k: "flips", n: 1 }, { k: "dist", n: 400 }, { k: "shards", n: 10 }];
  const kinds = Object.keys(ORDER_KINDS).filter((k) => ORDER_KINDS[k].min <= L), out = [];
  for (let s = 0; out.length < 3 && s < 40; s++) {
    const k = kinds[hashText("order" + L + ":" + s) % kinds.length];
    if (out.some((o) => o.k === k) || (k === "triple" && out.some((o) => o.k === "double"))) continue;
    out.push({ k, n: ORDER_KINDS[k].n(L) });
  }
  return out;
}
export const orderText = (o) => ORDER_KINDS[o.k].text(o.n);

// ---- daily run ----------------------------------------------------------------------
const dailyRng = new Random(1);
const dateKey = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
export function dailyGoal(key) {
  const h = hashText("ride" + key), kind = h % 4, v = (h >>> 8) % 5;
  if (kind === 0) return { kind: "flips", n: 4 + 2 * v, text: "Land " + (4 + 2 * v) + " flips." };
  if (kind === 1) return { kind: "zone", n: 1 + (v % 4), text: "Reach " + ZONES[1 + (v % 4)].name + "." };
  if (kind === 2) return { kind: "shards", n: 20 + 8 * v, text: "Collect " + (20 + 8 * v) + " shards." };
  return { kind: "score", n: 2000 + 1000 * v, text: "Score " + (2000 + 1000 * v) + "." };
}

// ---- save ---------------------------------------------------------------------------
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const nat = (v) => Math.max(0, Math.floor(num(v)));
// Bring any stored shape (nothing, the first release's run record, schema 2) to schema 2. The
// first release saved { schema: 1, runs, last, milestone }; those carry over, and each 100 m
// milestone reached in the old game is worth 5 shards.
export function migrateSave(raw) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const ob = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const st = ob(r.st), sel = ob(r.sel), dl = ob(r.dl), up = ob(r.up);
  const old = r.schema !== 2;
  const lv = clamp(Math.floor(num(r.lv, 1)), 1, 999);
  const gd = Array.from({ length: 3 }, (_, i) => (Array.isArray(r.gd) && r.gd[i] ? 1 : 0));
  return {
    schema: 2,
    runs: nat(r.runs),
    last: r.last && typeof r.last === "object" && !Array.isArray(r.last) ? r.last : {},
    milestone: nat(r.milestone),
    lv,
    gd,
    sh: old ? nat(r.milestone) * 5 : nat(r.sh),
    up: { mag: clamp(nat(up.mag), 0, 3), hov: clamp(nat(up.hov), 0, 2), lamp: clamp(nat(up.lamp), 0, 1) },
    sel: { ride: clamp(nat(sel.ride), 0, RIDES.length - 1), start: clamp(nat(sel.start), 0, ZONES.length - 1), trail: clamp(nat(sel.trail), 0, TRAILS.length - 1) },
    far: clamp(nat(r.far), 0, ZONES.length - 1),
    pb: Array.from({ length: RIDES.length }, (_, i) => nat(Array.isArray(r.pb) ? r.pb[i] : 0)),
    st: { m: nat(st.m), flips: nat(st.flips), shards: nat(st.shards), grind: nat(st.grind), chasms: nat(st.chasms), combo: nat(st.combo), zen: nat(st.zen), best: nat(st.best) },
    dl: { d: typeof dl.d === "string" ? dl.d.slice(0, 10) : "", best: nat(dl.best), done: dl.done ? 1 : 0, streak: nat(dl.streak), last: typeof dl.last === "string" ? dl.last.slice(0, 10) : "" },
  };
}

const fract = (v) => v - Math.floor(v);
const hash1 = (n) => fract(Math.sin(n * 12.9898) * 43758.5453);
function pickWeighted(rng, mix) {
  let total = 0;
  for (const k in mix) total += mix[k];
  let roll = rng.next() * total;
  for (const k in mix) { roll -= mix[k]; if (roll < 0) return k; }
  return Object.keys(mix)[0];
}
const DEPOT = ["RIDE OUT", "RIDE", "START", "ZEN", "DAILY", "WORKSHOP", "ORDERS", "LOG"];

export class Moonrunner {
  constructor(ctx) {
    this.c = ctx;
    this.guard = new AppGuard(this, ctx); // takes back a menu gesture that reached the game (docs/ENGINE.md)
    this.lamps = new LampBus(ctx); // dedupes writes; asleep while paused
    this.t = 0;
    this.held = false;
    this.heldT = 0;
    this.armed = false; // a press on a menu screen that is waiting for its release
    this.pt = 0;
    this.sv = migrateSave(ctx.progress?.());
    this.view = "menu";
    this.cur = 0;
    this.daily = false;
    this.zen = false;
    this.upAt = 0;
    this.parts = new Float32Array(MAX_PARTS * 5); // x, y, vx, vy, life
    this.trail = new Float32Array(TRAIL * 2);
    this.lastHint = "";
    this.reset();
    this.phase = "title";
    this.setHint("Tap to ride. Hold for the depot.");
    this.c.hud([["BEST", this.c.best()], ["LEVEL", this.sv.lv]]);
  }

  // ---- run state --------------------------------------------------------------------
  reset() {
    this.phase = "play";
    this.r = null;
    const sv = this.sv;
    this.rideIx = sv.sel.ride < RIDES.length && RIDES[sv.sel.ride].lv <= sv.lv ? sv.sel.ride : 0;
    this.startZone = this.daily || this.zen ? 0 : Math.min(sv.sel.start, sv.far);
    this.x0 = ZONES[this.startZone].from * PX_M;
    this.forgiveTo = this.x0 + FORGIVE; // a crash before here is only a tumble
    this.dstate = this.daily ? (mixSeed(hashText("day" + this.dayKey())) || 1) : 0;
    // Terrain: control point i sits at x = i * SEG; ty[k] is the height of point t0 + k.
    this.t0 = Math.floor(this.x0 / SEG) - 6;
    this.ty = [];
    let y = 0;
    for (let k = 0; k < 8; k++) { this.ty.push(y); y += ZONES[this.startZone].slope * SEG * 0.7; }
    this.lastY = y - ZONES[this.startZone].slope * SEG * 0.7;
    this.rollPh = 0;
    this.force = [];
    this.featX = this.x0 + 700;
    this.lastKind = "";
    this.rocks = []; this.chasms = []; this.rails = []; this.vents = []; this.shards = [];
    this.extend();
    const x = this.x0 + 120;
    this.r = { x, y: this.gy(x), vx: 300, vy: 0, v: 300, a: this.slopeAt(x), w: 0, spin: 0, air: false, airT: 0, coy: 0, rail: null, tx: x, vent: false, flipT: 0 };
    this.camX = x - RIDER_X;
    this.camY = this.r.y - 300;
    this.runT = 0;
    this.buffer = 0;
    this.combo = 0; this.comboT = 0;
    this.pts = 0;
    this.maxX = x;
    this.cleanFrom = x;
    this.inv = 0;
    this.hovers = this.zen ? 0 : sv.up.hov;
    this.zone = zoneAt(x / PX_M);
    this.zoneT = 0;
    this.grindLen = 0; this.grindTick = 0;
    this.noticeT = 0; this.notice = "";
    this.trickT = 0; this.trick = "";
    this.fx = { land: 0, shard: 0, order: 0, zone: 0, crash: 0, tumble: 0, record: 0 };
    this.overT = 0;
    this.reason = "";
    this.result = null;
    this.newRecord = false;
    this.recorded = false;
    this.banked = false;
    this.levelled = null;
    this.goalDone = false;
    this.best0 = this.bestRef();
    this.R = { m: 0, flips: 0, maxFlip: 0, shards: 0, rocks: 0, combo: 0, zone: this.zone, chasms: 0, cleanMax: 0, grind: 0, vents: 0, zenM: 0, stumbles: 0 };
    this.orders = ordersFor(sv.lv);
    this.trail.fill(0); this.trailN = 0; this.trailTick = 0;
    this.parts.fill(0); this.partNext = 0;
  }
  dayKey() { return dateKey(); }
  ride() { return RIDES[this.rideIx]; }
  plainRun() { return !this.daily && !this.zen && this.startZone === 0; }
  // The record this run chases: the console's best for a plain run, the day's or the ride's otherwise.
  bestRef() {
    if (this.daily) return this.sv.dl.d === this.dayKey() ? this.sv.dl.best : 0;
    if (this.plainRun()) return this.c.best();
    return this.sv.pb[this.rideIx] || 0;
  }
  setHint(message) {
    if (message === this.lastHint) return;
    this.lastHint = message;
    this.c.hint(message);
  }
  scoreNow() { return Math.floor(this.R.m) + Math.floor(this.pts); }
  mult() { return 1 + Math.min(4, Math.floor(this.combo / 3)); }

  // ---- terrain -----------------------------------------------------------------------
  cp(i) {
    const ty = this.ty, n = ty.length, k = i - this.t0;
    if (k < 0) return ty[0] + k * (ty[1] - ty[0]);
    if (k >= n) return ty[n - 1] + (k - n + 1) * (ty[n - 1] - ty[n - 2]);
    return ty[k];
  }
  // Height of the ground at x (y grows downwards): Catmull-Rom through the control points.
  gy(x) {
    const f = x / SEG, i = Math.floor(f), u = f - i;
    const p0 = this.cp(i - 1), p1 = this.cp(i), p2 = this.cp(i + 1), p3 = this.cp(i + 2);
    return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);
  }
  // Angle of the ground at x: positive runs downhill.
  slopeAt(x) {
    const f = x / SEG, i = Math.floor(f), u = f - i;
    const p0 = this.cp(i - 1), p1 = this.cp(i), p2 = this.cp(i + 1), p3 = this.cp(i + 2);
    const d = 0.5 * ((-p0 + p2) + 2 * (2 * p0 - 5 * p1 + 4 * p2 - p3) * u + 3 * (-p0 + 3 * p1 - 3 * p2 + p3) * u * u);
    return Math.atan(d / SEG);
  }
  frontier() { return (this.t0 + this.ty.length - 1) * SEG; }
  rng() {
    if (!this.daily) return this.c.rng;
    dailyRng.state = this.dstate;
    return dailyRng;
  }
  // Generate the slope to AHEAD px past the rider, then fix the heights of what now has ground under it.
  extend() {
    const rng = this.rng(), want = (this.r ? this.r.x : this.x0) + AHEAD;
    let guard = 0;
    while (this.frontier() < want && guard++ < 80) {
      const i = this.t0 + this.ty.length, x = i * SEG, zi = zoneAt(x / PX_M), z = ZONES[zi];
      let dy;
      if (this.force.length) dy = this.force.shift();
      else { this.rollPh += rng.range(0.45, 0.8); dy = z.slope * SEG + z.roll * Math.sin(this.rollPh); }
      this.lastY += dy;
      this.ty.push(this.lastY);
      if (x >= this.featX && !this.force.length) this.plan(rng, x, zi);
    }
    if (this.daily) this.dstate = dailyRng.state;
    const ready = this.frontier() - 3 * SEG;
    for (const rl of this.rails) if (rl.ya === null && rl.x1 < ready) { rl.ya = this.gy(rl.x0) - rl.h; rl.yb = this.gy(rl.x1) - rl.h; }
    for (const s of this.shards) {
      if (s.y !== null || s.x >= ready) continue;
      const rl = s.rail !== undefined ? this.rails.find((q) => q.id === s.rail) : null;
      if (rl && rl.ya !== null) s.y = this.railY(rl, s.x) - 24;
      else if (!rl) s.y = this.gy(s.x) - s.off;
    }
  }
  // Put the next feature on the slope at control point x. Shapes change the next points through `force`.
  plan(rng, x, zi) {
    const z = ZONES[zi], m = x / PX_M, deep = clamp((m - z.from) / 800, 0, 1);
    const safe = x < this.x0 + SAFE;
    let kind = pickWeighted(rng, safe ? { kicker: 2, shards: 3 } : z.mix);
    if ((kind === "chasm" || kind === "railgap") && (this.lastKind === "chasm" || this.lastKind === "railgap")) kind = "shards";
    if ((kind === "rail" || kind === "railgap") && this.rails.length >= MAX_RAILS) kind = "rock";
    this.lastKind = kind;
    let len = 0;
    if (kind === "kicker") {
      // The landing after a kicker is kept clear: a big one throws the sled about 1000 px.
      let big = false;
      if (zi >= 4 && rng.next() < 0.5) { this.force.push(-0.35 * SEG, -0.25 * SEG, z.slope * SEG + 130); len = 3 * SEG; big = true; }
      else { this.force.push(-0.3 * SEG, z.slope * SEG + 70); len = 2 * SEG; }
      this.arc(x + len - 0.5 * SEG, rng.int(4, 6), 50, 80, 50);
      len += big ? 950 : 520;
    } else if (kind === "rock") {
      const big = zi >= 2 ? 6 : 0;
      this.addRock(x + SEG * 0.5, rng.range(16, 22) + big * deep + rng.range(0, big));
      len = SEG;
      // A cluster: two boulders close enough that one early jump clears both.
      if (zi >= 1 && m > 900 && rng.next() < 0.3) { const gap = rng.range(80, 105); this.addRock(x + SEG * 0.5 + gap, rng.range(15, 20)); len += gap; }
      if (rng.next() < 0.5) this.arc(x + SEG * 0.5 - 60, 3, 60, 60, 25);
    } else if (kind === "chasm") {
      const w = rng.range(70, 110) + Math.min(50, Math.max(0, m - 1200) * 0.02);
      const x0 = x + SEG + 10;
      this.addChasm(x0, x0 + w);
      this.force.push(6, z.slope * SEG + 45);
      this.arc(x0 - 20, 4, 60, 70, (w + 40) / 3);
      len = SEG + w + 40;
    } else if (kind === "rail") {
      const x0 = x + 40, L = rng.range(260, 480);
      this.addRail(x0, x0 + L, rng.range(46, 56), true);
      len = L + 60;
    } else if (kind === "railgap") {
      const x0 = x + SEG + 10, w = rng.range(230, 300);
      this.addChasm(x0, x0 + w);
      this.force.push(6, z.slope * SEG + 30, z.slope * SEG + 30);
      this.addRail(x0 - 150, x0 + w + 90, 50, true);
      len = SEG + w + 120;
    } else if (kind === "vent") {
      if (this.vents.length < MAX_VENTS) {
        const vx = x + SEG * 0.5;
        this.vents.push({ x: vx, w: 56, used: false });
        for (let k = 0; k < 5; k++) this.addShard(vx + 40 + k * 70, 150 + 60 * Math.sin((k / 4) * Math.PI) + 60);
      }
      len = SEG + 1150; // a vent throws the sled high and far: nothing in the landing
    } else {
      const n = rng.int(5, 8);
      this.arc(x + 40, n, 26, 50, 46);
      len = n * 46 + 40;
    }
    const lo = Math.max(300, 560 - Math.max(0, m - 500) * 0.045);
    this.featX = x + len + rng.range(lo, lo + 320);
  }
  arc(x, n, base, lift, step) {
    for (let k = 0; k < n; k++) this.addShard(x + k * step, base + lift * Math.sin(n > 1 ? (k / (n - 1)) * Math.PI : 0));
  }
  addShard(x, off, rail) {
    if (this.shards.length >= MAX_SHARDS) return;
    const s = { x, off, y: null, got: 0, pull: 0 };
    if (rail !== undefined) s.rail = rail;
    this.shards.push(s);
  }
  addRock(x, r) { if (this.rocks.length < MAX_ROCKS) this.rocks.push({ x, r, done: false, hit: false }); }
  addChasm(x0, x1) { if (this.chasms.length < MAX_CHASMS) this.chasms.push({ x0, x1, done: false }); }
  addRail(x0, x1, h, shards) {
    const id = (this.railId = (this.railId || 0) + 1);
    this.rails.push({ id, x0, x1, h, ya: null, yb: null, done: false });
    if (shards) for (let sx = x0 + 50; sx < x1 - 20; sx += 62) this.addShard(sx, 0, id);
  }
  railY(rl, x) { return lerp(rl.ya, rl.yb, (x - rl.x0) / (rl.x1 - rl.x0)); }
  railAngle(rl) { return Math.atan2(rl.yb - rl.ya, rl.x1 - rl.x0); }
  chasmAt(x) {
    for (const c of this.chasms) if (x > c.x0 && x < c.x1) return c;
    return null;
  }
  prune() {
    const left = this.r.x - BEHIND;
    while (this.ty.length > 8 && (this.t0 + 2) * SEG < left - 2 * SEG) { this.ty.shift(); this.t0++; }
    const gone = (q) => q.x > left - 100;
    this.rocks = this.rocks.filter(gone);
    this.vents = this.vents.filter(gone);
    this.shards = this.shards.filter(gone);
    this.chasms = this.chasms.filter((c) => c.x1 > left - 100);
    this.rails = this.rails.filter((rl) => rl.x1 > left - 100);
  }

  // ---- physics (touches only the rider it is given, so a bot can plan on a copy) --------
  // Advances rider `r` by dt. `turn` is whether the sled is being turned. Returns what happened:
  // null, or { type: "launch" | "gap" | "vent" | "land" | "rail" | "railEnd" | "fell" | "wall", ... }.
  advance(r, dt, turn) {
    const ride = this.ride();
    if (r.rail !== null) {
      const rl = this.rails.find((q) => q.id === r.rail);
      if (!rl || rl.ya === null) { r.rail = null; r.air = true; return { type: "railEnd", len: 0 }; }
      const phi = this.railAngle(rl);
      r.v = clamp(r.v + (G * Math.sin(phi) - DRAG * r.v * r.v - FRICT * 0.3) * dt, MIN_V, ride.maxV);
      r.x += r.v * Math.cos(phi) * dt;
      r.a = phi;
      if (r.x >= rl.x1) {
        r.rail = null; r.air = true; r.airT = 0; r.spin = 0; r.coy = COYOTE; r.tx = r.x; r.vent = false;
        r.vx = r.v * Math.cos(phi); r.vy = r.v * Math.sin(phi);
        r.y = this.railY(rl, rl.x1);
        return { type: "railEnd" };
      }
      r.y = this.railY(rl, r.x);
      r.vx = r.v * Math.cos(phi); r.vy = r.v * Math.sin(phi);
      return null;
    }
    if (!r.air) {
      const th = this.slopeAt(r.x);
      r.v = clamp(r.v + (G * Math.sin(th) - DRAG * r.v * r.v - FRICT) * dt, MIN_V, ride.maxV + (this.combo >= 3 ? 80 : 0));
      const vx = r.v * Math.cos(th), vy = r.v * Math.sin(th);
      const nx = r.x + vx * dt, ny = r.y + vy * dt + 0.5 * G * dt * dt;
      for (const v of this.vents) {
        if (!v.used && Math.abs(nx - v.x) < v.w / 2) {
          r.air = true; r.vx = vx; r.vy = -VENT_V; r.x = nx; r.y = this.gy(nx) - 1;
          r.airT = 0; r.spin = 0; r.coy = 0; r.tx = r.x; r.vent = true;
          return { type: "vent", vent: v };
        }
      }
      if (this.chasmAt(nx)) {
        r.air = true; r.vx = vx; r.vy = vy; r.x = nx; r.y = ny; r.airT = 0; r.spin = 0; r.coy = COYOTE; r.tx = r.x; r.vent = false;
        return { type: "gap" };
      }
      const g1 = this.gy(nx);
      if (ny < g1 - 0.8) {
        r.air = true; r.vx = vx; r.vy = vy + G * dt; r.x = nx; r.y = ny; r.airT = 0; r.spin = 0; r.coy = COYOTE; r.tx = r.x; r.vent = false;
        return { type: "launch" };
      }
      r.x = nx; r.y = g1; r.a = this.slopeAt(nx); r.vx = vx; r.vy = vy;
      return null;
    }
    // In the air.
    r.airT += dt;
    r.coy = Math.max(0, r.coy - dt);
    r.vx -= r.vx * 0.04 * dt;
    r.vy += G * dt;
    const px = r.x, py = r.y;
    r.x += r.vx * dt;
    r.y += r.vy * dt;
    if (turn) { r.w = -ride.flip; r.flipT += dt; }
    else {
      r.w *= Math.exp(-16 * dt);
      if (Math.abs(r.w) < 1.5) r.a += wrapAngle(this.slopeAt(r.x + r.vx * 0.2) - r.a) * Math.min(1, 2.2 * dt);
    }
    r.a += r.w * dt;
    r.spin += r.w * dt;
    if (r.vy > 0) {
      for (const rl of this.rails) {
        if (rl.ya === null || r.x < rl.x0 || r.x > rl.x1 || px < rl.x0 - 40) continue;
        const ry0 = this.railY(rl, clamp(px, rl.x0, rl.x1)), ry1 = this.railY(rl, r.x);
        if (py <= ry0 + 3 && r.y >= ry1) {
          const phi = this.railAngle(rl), diff = Math.abs(wrapAngle(r.a - phi)), spin = r.spin, airT = r.airT;
          r.rail = rl.id; r.air = false; r.y = ry1; r.a = phi; r.w = 0; r.spin = 0; r.flipT = 0;
          r.v = Math.max(MIN_V, r.vx * Math.cos(phi) + r.vy * Math.sin(phi));
          return { type: "rail", diff, spin, airT, rail: rl };
        }
      }
    }
    for (const c of this.chasms) {
      if (px < c.x1 && r.x >= c.x1 && r.y > this.gy(c.x1) + 14) return { type: "wall", chasm: c };
    }
    const gap = this.chasmAt(r.x);
    if (gap) {
      if (r.y > this.gy(r.x) + 140) return { type: "fell", chasm: gap };
      return null;
    }
    const gr = this.gy(r.x);
    if (r.y >= gr) {
      const th = this.slopeAt(r.x), diff = Math.abs(wrapAngle(r.a - th)), spin = r.spin, airT = r.airT, vent = r.vent, tx = r.tx;
      r.air = false; r.y = gr; r.a = th; r.w = 0; r.spin = 0; r.flipT = 0; r.vent = false;
      r.v = Math.max(MIN_V, r.vx * Math.cos(th) + r.vy * Math.sin(th));
      return { type: "land", diff, spin, airT, vent, tx };
    }
    return null;
  }
  // The boulder the rider is touching, or null.
  hitRock(r) {
    for (const k of this.rocks) {
      if (k.hit || Math.abs(r.x - k.x) > k.r + 10) continue;
      if (r.y > this.gy(k.x) - k.r * 1.35 + 4) return k;
    }
    return null;
  }
  jump(r) {
    const ride = this.ride();
    let th;
    if (r.rail !== null) { const rl = this.rails.find((q) => q.id === r.rail); th = rl ? this.railAngle(rl) : 0; r.rail = null; }
    else th = r.air ? Math.atan2(r.vy, r.vx) : this.slopeAt(r.x);
    const v = r.air ? Math.hypot(r.vx, r.vy) : r.v;
    r.vx = v * Math.cos(th); r.vy = Math.min(v * Math.sin(th), r.air ? r.vy : 1e9) - ride.jump;
    r.air = true; r.airT = 0; r.spin = 0; r.coy = 0; r.tx = r.x; r.vent = false; r.w = 0; r.flipT = 0;
  }
  canJump(r) { return !r.air || r.rail !== null || r.coy > 0; }

  // ---- input ---------------------------------------------------------------------------
  // On the title, result and depot screens a press is decided when it ends: a tap chooses the
  // main action, a press of HOLD_PICK seconds or more opens or operates the depot. In a run the
  // press edge is the jump, and holding on turns the sled.
  down() {
    this.guard.mark();
    if (this.phase === "title" || this.phase === "depot" || (this.phase === "over" && this.overT > LOCK)) {
      this.armed = true;
      this.pt = this.t;
      return;
    }
    if (this.phase !== "play") return;
    this.held = true;
    this.heldT = 0;
    this.buffer = BUFFER;
    this.tryJump();
  }
  up() {
    this.guard.release();
    if (this.armed) {
      this.armed = false;
      this.menuPress(this.t - this.pt);
      return;
    }
    this.held = false;
    this.buffer = 0;
  }
  cancel() {
    this.guard.rewind();
    this.armed = false;
    this.held = false;
    this.buffer = 0;
    this.lamps.clear();
  }
  // The menu is open: what was earned so far reaches the scores (the run carries on afterwards).
  pause() {
    this.guard.settle();
    this.held = false;
    if (this.phase === "play" && this.plainRun() && this.scoreNow() > 0) this.c.score(this.scoreNow());
    this.lamps.sleep();
  }
  resume() { this.held = false; this.lamps.wake(); }
  // Leaving: a run in progress is banked (stats, shards, orders) as if it had ended here.
  dispose() {
    this.guard.settle();
    this.held = false;
    if (this.phase === "play" && this.runT > 0) {
      if (this.plainRun() && this.scoreNow() > 0) this.c.score(this.scoreNow());
      this.bank();
    }
    this.lamps.sleep();
  }
  tryJump() {
    const r = this.r;
    if (this.buffer <= 0 || !this.canJump(r)) return;
    this.buffer = 0;
    if (r.rail !== null) this.endGrind();
    this.jump(r);
    this.c.tone(200, 0.08, "triangle");
    this.dust(r.x, r.y, 4);
  }
  start(mode = "") {
    this.daily = mode === "daily";
    this.zen = mode === "zen";
    this.held = false;
    this.reset();
    this.zoneT = 2.6;
    this.c.tone(MOTIFS[this.zone][0], 0.12, "sine");
    this.setHint(this.zen ? "Zen: no score, no end. Tap, tap, hold for the menu." : "Tap to jump. Hold in the air to flip; let go to land flat.");
    this.c.hud(this.hudItems());
  }
  // A finished press on the title, result or depot screen.
  menuPress(dur) {
    const long = dur >= HOLD_PICK;
    if (this.phase === "title" || this.phase === "over") {
      if (long) this.openDepot();
      else this.start(this.phase === "over" && (this.daily || this.zen) ? (this.daily ? "daily" : "zen") : "");
      return;
    }
    if (this.view === "workshop") {
      if (!long) { this.wcur = (this.wcur + 1) % (WORKSHOP.length + 1); return; }
      if (this.wcur === WORKSHOP.length) { this.view = "menu"; return; }
      this.buy(WORKSHOP[this.wcur]);
      return;
    }
    if (this.view !== "menu") { this.view = "menu"; return; }
    if (!long) { this.cur = (this.cur + 1) % DEPOT.length; return; }
    this.depotChoose();
  }
  openDepot() {
    this.phase = "depot";
    this.view = "menu";
    this.cur = 0;
    this.wcur = 0;
    this.setHint("Tap: next line. Hold: choose.");
  }
  depotChoose() {
    const row = DEPOT[this.cur], s = this.sv.sel;
    if (row === "RIDE OUT") { this.start(); return; }
    if (row === "ZEN") {
      if (this.sv.lv >= ZEN_LV) this.start("zen");
      else this.c.tone(150, 0.08, "square");
      return;
    }
    if (row === "DAILY") { this.start("daily"); return; }
    if (row === "WORKSHOP") { this.view = "workshop"; this.wcur = 0; return; }
    if (row === "ORDERS") { this.view = "orders"; return; }
    if (row === "LOG") { this.view = "log"; return; }
    if (row === "RIDE") { let i = s.ride; do i = (i + 1) % RIDES.length; while (RIDES[i].lv > this.sv.lv); s.ride = i; }
    else if (row === "START") s.start = (Math.min(s.start, this.sv.far) + 1) % (this.sv.far + 1);
    this.c.tone(520, 0.05, "sine");
    this.persist();
  }
  buy(item) {
    const tier = this.sv.up[item.id], cost = item.tiers[tier];
    if (cost === undefined || this.sv.sh < cost) { this.c.tone(150, 0.08, "square"); return; }
    this.sv.sh -= cost;
    this.sv.up[item.id] = tier + 1;
    this.c.tone(660, 0.08, "sine");
    this.c.tone(990, 0.12, "sine");
    this.persist();
  }
  persist() {
    this.c.saveProgress?.(JSON.parse(JSON.stringify(this.sv)))?.catch?.(this.c.error);
  }

  // ---- simulation ----------------------------------------------------------------------
  update(dt) {
    this.guard.tick(dt);
    this.t += dt;
    this.upAt = typeof performance !== "undefined" ? performance.now() : 0;
    if (this.phase === "play") this.stepPlay(dt);
    else {
      if (this.phase === "over") this.overT += dt;
      this.stepParts(dt);
      this.c.hud(this.phase === "over" ? this.resultHud() : [["BEST", this.c.best()], ["LEVEL", this.sv.lv], ["SHARDS", this.sv.sh]]);
    }
    for (const k in this.fx) if (this.fx[k] > 0) this.fx[k] = Math.max(0, this.fx[k] - dt);
    this.lamps.put(this.lampValues());
  }
  stepPlay(dt) {
    const r = this.r;
    this.runT += dt;
    this.inv = Math.max(0, this.inv - dt);
    this.noticeT = Math.max(0, this.noticeT - dt);
    this.trickT = Math.max(0, this.trickT - dt);
    this.zoneT = Math.max(0, this.zoneT - dt);
    if (this.held) this.heldT += dt;
    if (this.buffer > 0) { this.tryJump(); this.buffer = Math.max(0, this.buffer - dt); }
    const turning = this.held && this.heldT >= TAP_GRACE && r.air && r.rail === null;
    const fullBefore = Math.floor(Math.abs(r.spin) / TAU);
    const ev = this.advance(r, dt, turning);
    if (r.air && Math.floor(Math.abs(r.spin) / TAU) > fullBefore) this.c.tone(note(2 + Math.floor(Math.abs(r.spin) / TAU)), 0.06, "sine");
    if (ev) {
      if (ev.type === "land") this.onLand(ev);
      else if (ev.type === "rail") this.onRail(ev);
      else if (ev.type === "railEnd") this.endGrind();
      else if (ev.type === "vent") { ev.vent.used = true; this.c.tone(250, 0.18, "sawtooth"); this.c.tone(500, 0.2, "sine"); this.fx.zone = 0.4; this.dust(r.x, r.y, 8); }
      else if (ev.type === "fell") { this.crash("rille", ev.chasm); if (this.phase !== "play") return; }
      else if (ev.type === "wall") { this.crash("wall", ev.chasm); if (this.phase !== "play") return; }
    }
    if (this.phase !== "play") return;
    const rock = this.hitRock(r);
    if (rock && this.inv <= 0) {
      if (this.ride().smash && rock.r < this.ride().smash) {
        rock.hit = true; rock.done = true;
        r.v = Math.max(MIN_V, r.v * 0.85);
        this.addPoints(20, "BOULDER BROKEN");
        this.c.tone(120, 0.12, "square");
        this.dust(rock.x, r.y, 8);
      } else { this.crash("rock", rock); if (this.phase !== "play") return; }
    }
    // Boulders passed in the air and rilles crossed.
    for (const k of this.rocks) {
      if (k.done || r.x < k.x + k.r) continue;
      k.done = true;
      if (!k.hit && (r.air || r.rail !== null)) { this.R.rocks++; this.trickDone(1, 20, "BOULDER"); }
    }
    for (const c of this.chasms) {
      if (c.done || r.x < c.x1 + 4 || (r.air && r.y > this.gy(c.x1) + 6)) continue;
      c.done = true;
      this.R.chasms++;
      this.trickDone(1, 50, "RILLE CLEARED");
    }
    this.collect(r, dt);
    if (r.rail !== null) {
      this.grindLen += r.v * dt;
      this.R.grind += (r.v * dt) / PX_M;
      this.pts += ((r.v * dt) / PX_M) * 10 * this.mult();
      if ((this.grindTick += dt) > 0.12) { this.grindTick = 0; this.c.tone(330 + 20 * Math.min(this.combo, 10), 0.03, "triangle"); }
      if (++this.trailTick % 2 === 0) this.spark(r.x, r.y);
    }
    // The combo runs out on plain ground.
    if (!r.air && r.rail === null && this.combo > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) { this.combo = 0; this.c.tone(260, 0.06, "sine"); }
    }
    const m = (r.x - this.x0) / PX_M;
    if (r.x > this.maxX) this.maxX = r.x;
    this.R.m = Math.max(this.R.m, m);
    if (this.zen) this.R.zenM = this.R.m;
    this.R.cleanMax = Math.max(this.R.cleanMax, (r.x - this.cleanFrom) / PX_M);
    const zi = zoneAt(r.x / PX_M);
    if (zi !== this.zone) this.enterZone(zi);
    this.checkOrders();
    const score = this.scoreNow();
    if (!this.zen && !this.recorded && this.best0 > 0 && score > this.best0) {
      this.recorded = true;
      this.fx.record = 1;
      this.notify("NEW RECORD", 2);
      this.c.synth?.chime?.();
    }
    // Camera: locked to the rider across, eased up and down (a little ahead, since the slope falls away).
    this.camX = r.x - RIDER_X;
    const target = lerp(r.y, this.gy(r.x + 260), 0.35) - 290;
    this.camY += (target - this.camY) * (1 - Math.exp(-4 * dt));
    this.camY = clamp(this.camY, r.y - 450, r.y - 80);
    this.extend();
    this.prune();
    this.trailTick++;
    this.pushTrail(r);
    if (!r.air && r.rail === null && r.v > 380 && this.trailTick % 9 === 0) this.dust(r.x - 10, r.y, 1);
    this.stepParts(dt);
    this.c.hud(this.hudItems());
    this.hintNow();
  }
  hintNow() {
    const r = this.r;
    if (this.noticeT > 0) return this.setHint(this.notice);
    if (r.rail !== null) return this.setHint("Grinding. Tap to jump off.");
    if (r.air) return this.setHint(this.held ? "Turning. Let go to land flat." : "Hold to flip. Land flat on the slope.");
    this.setHint(this.combo ? "Combo x" + this.mult() + ". Keep the tricks coming." : "Tap to jump. Hold in the air to flip.");
  }
  hudItems() {
    const z = ZONES[this.zone];
    if (this.zen) return [["DISTANCE", Math.floor(this.R.m) + " m"], ["ZONE", z.roman], ["SHARDS", this.R.shards]];
    const combo = this.combo ? this.combo + "  x" + this.mult() : "-";
    return [["SCORE", this.scoreNow()], ["COMBO", combo], ["SHARDS", this.R.shards], ["ZONE", z.roman + " " + z.name.slice(4)]];
  }
  resultHud() {
    return [["SCORE", this.result?.score ?? 0], ["DISTANCE", (this.result?.metres ?? 0) + " m"], ["FLIPS", this.R.flips], ["BEST", this.bestRef()]];
  }
  notify(message, seconds = 2.4) { this.notice = message; this.noticeT = seconds; }
  showTrick(label) { this.trick = label; this.trickT = 1.4; }
  addPoints(n, label) { this.pts += n * this.mult(); if (label) this.showTrick(label + "  +" + Math.round(n * this.mult())); }
  // A trick: points at the current multiplier, then the combo grows and its clock restarts.
  trickDone(count, points, label) {
    this.addPoints(points, label);
    this.combo += count;
    this.comboT = COMBO_T;
    this.R.combo = Math.max(this.R.combo, this.combo);
  }
  onLand(ev) {
    const r = this.r, flips = Math.round(Math.abs(ev.spin) / TAU);
    if (ev.diff > STUMBLE) {
      if (this.inv > 0) { this.stumble(); return; }
      this.crash("land");
      return;
    }
    if (ev.diff > CLEAN) { this.stumble(); return; }
    this.c.tone(note(Math.min(9, this.combo)), 0.07, "sine");
    this.dust(r.x, r.y, 3 + flips * 2);
    if (flips > 0) {
      this.R.flips += flips;
      this.R.maxFlip = Math.max(this.R.maxFlip, flips);
      if (ev.vent) this.R.vents++;
      r.v = Math.min(this.ride().maxV + 120, r.v + 45 * flips);
      this.trickDone(flips, (100 * flips * (flips + 1)) / 2 + (ev.vent ? 100 : 0), flips === 1 ? "FLIP" : flips === 2 ? "DOUBLE FLIP" : flips === 3 ? "TRIPLE FLIP" : flips + "x FLIP");
      this.fx.land = 0.45;
      this.c.tone(note(Math.min(9, 2 + this.combo)) * 1.5, 0.14, "sine");
    } else if (ev.airT > 1.1) this.trickDone(1, 50, "BIG AIR");
  }
  onRail(ev) {
    if (ev.diff > STUMBLE) { this.stumble(); }
    else if (Math.round(Math.abs(ev.spin) / TAU) > 0 && ev.diff <= CLEAN) {
      const flips = Math.round(Math.abs(ev.spin) / TAU);
      this.R.flips += flips;
      this.R.maxFlip = Math.max(this.R.maxFlip, flips);
      this.trickDone(flips, (100 * flips * (flips + 1)) / 2, flips === 1 ? "FLIP" : "DOUBLE FLIP");
      this.fx.land = 0.45;
    }
    this.grindLen = 0;
    this.c.tone(440, 0.06, "triangle");
  }
  endGrind() {
    if (this.grindLen > SEG) this.trickDone(1, 25, "GRIND " + Math.round(this.grindLen / PX_M) + " M");
    this.grindLen = 0;
  }
  stumble() {
    const r = this.r;
    r.v = Math.max(MIN_V, r.v * 0.6);
    this.combo = 0;
    this.comboT = 0;
    this.cleanFrom = r.x;
    this.R.stumbles++;
    this.c.tone(140, 0.12, "square");
    this.showTrick("STUMBLE");
    this.dust(r.x, r.y, 6);
  }
  // A crash: in zen, early in a run or with hover pads to spare it is only a tumble; else the run ends.
  crash(why, what) {
    const r = this.r;
    if (this.zen || r.x < this.forgiveTo) { this.tumble(why, what, ""); return; }
    if (this.hovers > 0) { this.hovers--; this.tumble(why, what, "HOVER PADS CAUGHT YOU"); return; }
    this.finish(why);
  }
  tumble(why, what, message) {
    const r = this.r;
    if ((why === "rille" || why === "wall") && what) { r.x = what.x1 + 40; what.done = true; }
    if (why === "rock" && what) what.hit = true;
    r.y = this.gy(r.x); r.a = this.slopeAt(r.x); r.air = false; r.rail = null; r.w = 0; r.spin = 0; r.v = MIN_V; r.coy = 0;
    this.combo = 0; this.comboT = 0;
    this.cleanFrom = r.x;
    this.R.stumbles++;
    this.inv = 1.4;
    this.fx.tumble = 0.6;
    this.c.tone(110, 0.2, "sawtooth");
    this.notify(message || (this.zen ? "TUMBLE. RIDE ON." : "TUMBLE. THE FIRST SLOPE IS FORGIVING."), 2);
    this.dust(r.x, r.y, 10);
  }
  enterZone(zi) {
    this.zone = zi;
    this.R.zone = Math.max(this.R.zone, zi);
    this.zoneT = 2.6;
    this.fx.zone = 0.8;
    MOTIFS[zi].forEach((hz, i) => this.c.tone(hz, 0.16 + 0.04 * i, "sine"));
  }
  collect(r, dt) {
    const reach = 24 + MAG_R[this.sv.up.mag], cy = r.y - 18;
    for (const s of this.shards) {
      if (s.got || s.y === null) continue;
      const dx = s.x - r.x, dy = s.y - cy;
      if (Math.abs(dx) > reach + 40) continue;
      const d = Math.hypot(dx, dy);
      if (d < reach && MAG_R[this.sv.up.mag] > 0) s.pull = 1;
      if (s.pull) { // drawn in by the magnet
        const k = Math.min(1, (900 * dt) / Math.max(1, d));
        s.x -= dx * k; s.y -= dy * k;
      }
      if (d < 24 || (s.pull && d < 30)) {
        s.got = 1;
        this.R.shards++;
        this.pts += 10;
        this.fx.shard = 0.12;
        this.c.tone(note(4 + (this.R.shards % 6)) * 2, 0.04, "sine");
      }
    }
  }
  checkOrders() {
    if (this.daily && !this.goalDone && this.goalMet()) { this.goalDone = true; this.notify("DAILY GOAL MET", 2.4); this.c.tone(784, 0.2, "sine"); }
    this.orders.forEach((o, i) => {
      if (this.sv.gd[i]) return;
      if (this.zen && o.k !== "zen" && o.k !== "hoard") return;
      if (ORDER_KINDS[o.k].prog(this) < o.n) return;
      this.sv.gd[i] = 1;
      this.fx.order = 0.9;
      this.notify("ORDER DONE: " + orderText(o).replace(/\.$/, "").toUpperCase(), 2.8);
      [523, 659, 784].forEach((hz, k) => this.c.tone(hz * (1 + k * 0.001), 0.1 + 0.05 * k, "sine"));
    });
  }
  goalMet() {
    const g = dailyGoal(this.dayKey());
    if (g.kind === "flips") return this.R.flips >= g.n;
    if (g.kind === "zone") return this.R.zone >= g.n;
    if (g.kind === "shards") return this.R.shards >= g.n;
    return this.scoreNow() >= g.n;
  }
  finish(why) {
    const r = this.r;
    this.phase = "over";
    this.reason = why;
    this.overT = 0;
    this.held = false;
    this.fx.crash = 0.6;
    this.c.tone(70, 0.4, "sawtooth");
    this.dust(r.x, r.y, 14);
    const score = this.scoreNow();
    this.newRecord = score > 0 && score > this.best0;
    if (this.plainRun()) this.c.score(score);
    this.bank();
    this.setHint(this.sv.runs >= 2 ? "Tap to ride again. Hold for the depot." : "Tap to ride again.");
  }
  // Fold the run into the save: stats, shards, the day's record, the ride's best, and a level if all
  // three orders are done. Runs once per run.
  bank() {
    if (this.banked) return;
    this.banked = true;
    const sv = this.sv, R = this.R, score = this.scoreNow(), metres = Math.floor(R.m);
    sv.runs++;
    sv.st.m += metres; sv.st.flips += R.flips; sv.st.shards += R.shards; sv.st.grind += Math.floor(R.grind);
    sv.st.chasms += R.chasms; sv.st.combo = Math.max(sv.st.combo, R.combo);
    if (this.zen) sv.st.zen += metres;
    else sv.st.best = Math.max(sv.st.best, score);
    sv.sh += R.shards;
    sv.far = Math.max(sv.far, R.zone);
    if (this.daily) {
      const key = this.dayKey();
      if (sv.dl.d !== key) { sv.dl.d = key; sv.dl.best = 0; sv.dl.done = 0; }
      sv.dl.best = Math.max(sv.dl.best, score);
      if (this.goalDone && !sv.dl.done) {
        sv.dl.done = 1;
        sv.dl.streak = sv.dl.last && this.dayBefore(key) === sv.dl.last ? sv.dl.streak + 1 : 1;
        sv.dl.last = key;
        sv.sh += 40 + 10 * Math.min(sv.dl.streak, 7);
      }
    } else if (!this.zen) sv.pb[this.rideIx] = Math.max(sv.pb[this.rideIx] || 0, score);
    this.levelled = null;
    if (sv.gd.every(Boolean)) {
      const from = sv.lv;
      sv.lv++;
      sv.gd = [0, 0, 0];
      const bonus = 30 * from;
      sv.sh += bonus;
      this.levelled = { lv: sv.lv, bonus, unlocks: this.unlocksAt(sv.lv) };
      this.orders = ordersFor(sv.lv);
    }
    this.result = { score: this.zen ? 0 : score, metres, flips: R.flips, shards: R.shards, combo: R.combo, zone: ZONES[R.zone].name, reason: REASONS[this.reason] || "", milestone: Math.floor(metres / 100) };
    sv.milestone = Math.max(sv.milestone, this.result.milestone);
    sv.last = { score: this.result.score, metres, flips: R.flips, shards: R.shards, combo: R.combo, zone: this.result.zone, milestone: this.result.milestone };
    this.persist();
  }
  unlocksAt(lv) {
    const out = [];
    if (lv === ZEN_LV) out.push("ZEN RIDING");
    for (const rd of RIDES) if (rd.lv === lv) out.push(rd.name + " SLED");
    for (const tr of TRAILS) if (tr.lv === lv) out.push(tr.name + " TRAIL");
    return out;
  }
  dayBefore(key) {
    const [y, m, d] = key.split("-").map(Number);
    const t = new Date(y, m - 1, d - 1);
    return t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0");
  }
  dailyDone() { return this.sv.dl.d === this.dayKey() && this.sv.dl.done === 1; }
  // What unlocks next, for the depot and the result screen.
  nextUnlock() {
    for (let lv = this.sv.lv + 1; lv < this.sv.lv + 20; lv++) { const u = this.unlocksAt(lv); if (u.length) return "LEVEL " + lv + ": " + u[0]; }
    return "";
  }

  // ---- particles and trail -------------------------------------------------------------------
  dust(x, y, n) {
    for (let i = 0; i < n; i++) {
      const k = this.partNext++ % MAX_PARTS, o = k * 5, a = -Math.PI * (0.15 + 0.7 * hash1(this.partNext * 7.3));
      const s = 60 + 120 * hash1(this.partNext * 3.1);
      this.parts[o] = x; this.parts[o + 1] = y - 2;
      this.parts[o + 2] = Math.cos(a) * s - 80; this.parts[o + 3] = Math.sin(a) * s;
      this.parts[o + 4] = 0.6;
    }
  }
  spark(x, y) {
    const k = this.partNext++ % MAX_PARTS, o = k * 5;
    this.parts[o] = x; this.parts[o + 1] = y; this.parts[o + 2] = -140; this.parts[o + 3] = -60 - 80 * hash1(this.partNext); this.parts[o + 4] = 0.35;
  }
  stepParts(dt) {
    for (let k = 0; k < MAX_PARTS; k++) {
      const o = k * 5;
      if (this.parts[o + 4] <= 0) continue;
      this.parts[o] += this.parts[o + 2] * dt;
      this.parts[o + 1] += this.parts[o + 3] * dt;
      this.parts[o + 3] += 400 * dt;
      this.parts[o + 4] -= dt;
    }
  }
  pushTrail(r) {
    // The antenna's light, as a world position.
    const ax = r.x + Math.sin(r.a) * 52 - Math.cos(r.a) * 15, ay = r.y - Math.cos(r.a) * 52 - Math.sin(r.a) * 15;
    this.trail.copyWithin(0, 2);
    this.trail[(TRAIL - 1) * 2] = ax;
    this.trail[(TRAIL - 1) * 2 + 1] = ay;
    this.trailN = Math.min(TRAIL, this.trailN + 1);
  }

  // ---- lamps -----------------------------------------------------------------------------
  // In the air the lamps say whether a landing now would be clean (green), a stumble (amber) or a
  // crash (red), brighter as the ground comes up; while the sled turns a white spot runs across them
  // once per turn. On the ground: left = speed in the zone's colour, middle = the combo's clock
  // (cyan), right = the next hazard closing (amber boulder, red rille, cyan vent, violet cable),
  // blinking when it is time to jump. Grinding: a violet chase.
  hazardAhead() {
    const r = this.r, v = Math.max(1, r.v);
    let best = null, bt = 1.3;
    const consider = (x, col) => { const t = (x - r.x) / v; if (t > 0 && t < bt) { bt = t; best = col; } };
    for (const k of this.rocks) if (!k.hit && !k.done) consider(k.x - k.r, LAMP.amber);
    for (const c of this.chasms) if (!c.done) consider(c.x0, LAMP.red);
    for (const vn of this.vents) if (!vn.used) consider(vn.x - vn.w / 2, LAMP.cyan);
    for (const rl of this.rails) if (!rl.done && rl.x0 > r.x) consider(rl.x0, LAMP.violet);
    return best ? { col: best, t: bt } : null;
  }
  landingColour() {
    const r = this.r, diff = Math.abs(wrapAngle(r.a - this.slopeAt(r.x + r.vx * 0.15)));
    return diff <= CLEAN ? LAMP.green : diff <= STUMBLE ? LAMP.amber : LAMP.red;
  }
  lampValues() {
    const zc = ZONES[this.zone].col;
    // Dark on the title and result screens (after the end's red fade); a dim drifting spot in the depot.
    if (this.phase === "title") return lightsOff();
    if (this.phase === "depot") return spot(0.5 + 0.5 * Math.sin(this.t * 0.8), dim(ZONES[this.sv.far].col, 0.14));
    if (this.phase === "over") return this.fx.crash > 0 ? fill(LAMP.red, 0.34 * (this.fx.crash / 0.6)) : lightsOff();
    const r = this.r;
    if (this.fx.record > 0) { const on = blink(1 - this.fx.record, 5); return fill(on ? LAMP.white : LAMP.amber, on ? 0.7 : 0.1); }
    if (this.fx.order > 0) return fill(LAMP.amber, 0.5 * pulse(this.fx.order, 3.3));
    if (this.fx.tumble > 0) return fill(LAMP.amber, 0.3 * blink(this.fx.tumble, 6));
    if (this.fx.land > 0) { // a sweep left to right: the trick landed
      const k = Math.min(2, Math.floor((0.45 - this.fx.land) / 0.15));
      return lamps(...[0, 1, 2].map((i) => (i <= k ? dim(LAMP.white, i === k ? 0.75 : 0.25) : null)));
    }
    if (this.fx.zone > 0) return fill(zc, 0.45 * (this.fx.zone / 0.8));
    let out;
    if (r.rail !== null) {
      const at = Math.floor(this.runT * 8) % 3;
      out = lamps(...[0, 1, 2].map((i) => dim(LAMP.violet, i === at ? 0.5 : 0.08)));
    } else if (r.air) {
      const height = Math.max(0, this.gy(r.x) - r.y);
      const near = this.chasmAt(r.x) ? 0.3 : clamp(1 - height / 220, 0, 1);
      out = fill(this.landingColour(), 0.08 + 0.42 * near);
      if (this.held && this.heldT >= TAP_GRACE) {
        const pos = (Math.abs(r.spin) / TAU) % 1;
        const s = spot(pos, LAMP.white, 0.7);
        out = out.map((v, i) => Math.max(v, Math.round(s[i] * 0.55)));
      }
    } else {
      const speed = clamp((r.v - MIN_V) / (this.ride().maxV - MIN_V), 0, 1);
      const left = dim(this.combo >= 3 ? LAMP.cyan : zc, 0.06 + 0.28 * speed);
      const mid = this.combo > 0 ? dim(LAMP.cyan, 0.05 + 0.35 * clamp(this.comboT / COMBO_T, 0, 1)) : null;
      const hz = this.hazardAhead();
      let right = null;
      if (hz) right = hz.t < 0.32 ? dim(hz.col, blink(this.t, 8) ? 0.85 : 0.1) : dim(hz.col, 0.08 + 0.45 * (1 - hz.t / 1.3));
      out = lamps(left, mid, right);
    }
    if (this.fx.shard > 0) out = out.map((v, i) => (i >= 3 && i < 6 ? Math.max(v, Math.round(LAMP.cyan[i - 3] * 0.6)) : v));
    return out;
  }

  // ---- drawing ------------------------------------------------------------------------------
  draw(g) {
    const r = this.r;
    // Extrapolate by the time since the last fixed update, so the scroll is even when the host runs
    // zero or two updates in a frame. Only the picture moves; the world is untouched.
    let lead = 0;
    if (this.phase === "play" && typeof performance !== "undefined") lead = clamp((performance.now() - this.upAt) / 1000, 0, 1 / 60);
    const cx = this.camX + r.vx * lead, cy = this.camY;
    const z = ZONES[this.zone], dark = !!z.dark;
    space(g, cx * 0.02, dark ? 0.6 : 1);
    this.drawSky(g, cx, dark);
    this.drawGround(g, cx, cy, dark);
    this.drawFeatures(g, cx, cy, dark, r.x + (dark ? LAMP_R[this.sv.up.lamp] : 1e9));
    this.drawTrail(g, cx, cy);
    this.drawParts(g, cx, cy);
    if (this.phase !== "depot") this.drawRider(g, r.x + r.vx * lead - cx, r.y + r.vy * lead - cy, r.a);
    if (this.phase === "play") this.drawPlay(g);
    else if (this.phase === "title") this.drawTitle(g);
    else if (this.phase === "over") this.drawResult(g);
    else this.drawDepot(g);
  }
  drawSky(g, cx, dark) {
    if (!dark) {
      // Earth, low in the sky; it never moves on the near side.
      circle(g, 770, 104, 40, "#1c3330", true);
      circle(g, 770, 104, 40, C.cyan, false, 2);
      g.fillStyle = C.bg;
      g.beginPath(); g.arc(784, 104, 38, Math.PI * 0.5, Math.PI * 1.5, true); g.fill();
    }
    // Two ranges of far hills, functions of world x so nothing jumps.
    for (let layer = 0; layer < 2; layer++) {
      const f = layer ? 0.35 : 0.15, base = layer ? 330 : 290, amp = layer ? 38 : 50;
      g.fillStyle = dark ? (layer ? "#111c16" : "#0e1712") : layer ? "#1a2e21" : "#14241a";
      g.beginPath();
      g.moveTo(0, 560);
      for (let sx = 0; sx <= 960; sx += 24) {
        const wx = (sx + cx * f) / 140;
        g.lineTo(sx, base - amp * (Math.sin(wx + layer * 2) * 0.6 + Math.sin(wx * 0.37 + 1.3) * 0.4 + 0.25 * Math.sin(wx * 2.3)));
      }
      g.lineTo(960, 560);
      g.fill();
    }
  }
  drawGround(g, cx, cy, dark) {
    const step = 10, x0 = cx - 20, x1 = cx + 980;
    const visible = this.chasms.filter((c) => c.x1 > x0 && c.x0 < x1);
    let from = x0;
    const fillCol = dark ? "#16261c" : "#1f3a28", edge = dark ? C.muted : C.ink;
    const piece = (a, b) => {
      if (b <= a) return;
      g.fillStyle = fillCol;
      g.beginPath();
      g.moveTo(a - cx, 560);
      for (let x = a; x < b; x += step) g.lineTo(x - cx, this.gy(x) - cy);
      g.lineTo(b - cx, this.gy(b) - cy);
      g.lineTo(b - cx, 560);
      g.closePath();
      g.fill();
      g.strokeStyle = edge;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(a - cx, this.gy(a) - cy);
      for (let x = a; x < b; x += step) g.lineTo(x - cx, this.gy(x) - cy);
      g.lineTo(b - cx, this.gy(b) - cy);
      g.stroke();
    };
    for (const c of visible) {
      piece(from, c.x0);
      g.fillStyle = "#050a07";
      g.fillRect(c.x0 - cx, Math.min(this.gy(c.x0), this.gy(c.x1)) - cy, c.x1 - c.x0, 600);
      // The rille: two walls going down into the dark.
      line(g, c.x0 - cx, this.gy(c.x0) - cy, c.x0 - cx + 6, 560, C.line, 2);
      line(g, c.x1 - cx, this.gy(c.x1) - cy, c.x1 - cx - 6, 560, C.line, 2);
      from = c.x1;
    }
    piece(from, x1);
    // Regolith marks, fixed to the ground.
    g.strokeStyle = C.line;
    g.lineWidth = 2;
    g.beginPath();
    for (let n = Math.floor(x0 / 70); n * 70 < x1; n++) {
      const wx = n * 70 + 40 * hash1(n);
      if (this.chasmAt(wx) || this.chasmAt(wx + 16)) continue;
      const y = this.gy(wx) - cy + 14 + 26 * hash1(n + 0.5);
      g.moveTo(wx - cx, y);
      g.lineTo(wx - cx + 8 + 10 * hash1(n + 0.25), y);
    }
    g.stroke();
  }
  drawFeatures(g, cx, cy, dark, lampEdge) {
    const seen = (x) => { if (!dark) return 1; return clamp((lampEdge - x) / 160, 0, 1); };
    for (const rl of this.rails) {
      if (rl.ya === null || rl.x1 < cx - 20 || rl.x0 > cx + 980) continue;
      const a = seen(rl.x0);
      if (a <= 0) continue;
      g.globalAlpha = Math.max(a, 0.15);
      const ax = rl.x0 - cx, ay = rl.ya - cy, bx = rl.x1 - cx, by = rl.yb - cy;
      line(g, ax, ay, ax, this.gy(rl.x0) - cy, C.line, 2);
      line(g, bx, by, bx, this.gy(rl.x1) - cy, C.line, 2);
      line(g, ax, ay, bx, by, "#b48cf0", 3);
      g.globalAlpha = 1;
    }
    for (const vn of this.vents) {
      if (vn.x < cx - 60 || vn.x > cx + 1000) continue;
      const a = seen(vn.x);
      g.globalAlpha = Math.max(a, 0.2);
      const x = vn.x - cx, y = this.gy(vn.x) - cy;
      g.fillStyle = "#123a36";
      g.fillRect(x - vn.w / 2, y - 6, vn.w, 8);
      line(g, x - vn.w / 2, y - 6, x + vn.w / 2, y - 6, C.cyan, 2);
      if (!vn.used) for (let k = 0; k < 4; k++) {
        const u = fract(this.t * 1.2 + k / 4), px = x + Math.sin(k * 2.1 + this.t * 3) * 10;
        circle(g, px, y - 10 - u * 90, 3 + u * 5, C.cyan, false, 2);
      }
      g.globalAlpha = 1;
    }
    for (const k of this.rocks) {
      if (k.hit || k.x < cx - 60 || k.x > cx + 1000) continue;
      const a = seen(k.x);
      if (a <= 0) continue;
      g.globalAlpha = a;
      const x = k.x - cx, y = this.gy(k.x) - cy + 3, h = k.r * 1.35;
      g.fillStyle = "#3b4a33";
      g.strokeStyle = C.amber;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x - k.r, y);
      g.lineTo(x - k.r * 0.75, y - h * 0.7);
      g.lineTo(x - k.r * 0.1, y - h);
      g.lineTo(x + k.r * 0.6, y - h * 0.8);
      g.lineTo(x + k.r, y);
      g.closePath();
      g.fill();
      g.stroke();
      g.globalAlpha = 1;
    }
    for (const s of this.shards) {
      if (s.got || s.y === null || s.x < cx - 20 || s.x > cx + 980) continue;
      const a = seen(s.x);
      if (a <= 0) continue;
      g.globalAlpha = a;
      diamond(g, s.x - cx, s.y - cy, 6 + 1.5 * Math.sin(this.t * 4 + s.x * 0.01), C.cyan, true);
      g.globalAlpha = 1;
    }
  }
  drawTrail(g, cx, cy) {
    const n = this.trailN;
    if (n < 2 || this.phase === "title" || this.phase === "depot") return;
    // A short ribbon from the antenna, fading towards its tail.
    g.strokeStyle = this.combo >= 3 ? C.cyan : TRAILS[this.sv.sel.trail]?.col || C.amber;
    for (let i = TRAIL - n + 1; i < TRAIL; i++) {
      const k = (i - (TRAIL - n)) / n;
      g.globalAlpha = k;
      g.lineWidth = 1 + 3 * k;
      g.beginPath();
      g.moveTo(this.trail[i * 2 - 2] - cx, this.trail[i * 2 - 1] - cy);
      g.lineTo(this.trail[i * 2] - cx, this.trail[i * 2 + 1] - cy);
      g.stroke();
    }
    g.globalAlpha = 1;
  }
  drawParts(g, cx, cy) {
    g.fillStyle = C.muted;
    for (let k = 0; k < MAX_PARTS; k++) {
      const o = k * 5, life = this.parts[o + 4];
      if (life <= 0) continue;
      g.globalAlpha = Math.min(1, life * 2);
      g.fillRect(this.parts[o] - cx - 2, this.parts[o + 1] - cy - 2, 4, 4);
    }
    g.globalAlpha = 1;
  }
  drawRider(g, x, y, a) {
    g.save();
    g.translate(x, y);
    g.rotate(a);
    g.scale(1.25, 1.25);
    g.globalAlpha = this.inv > 0 && Math.floor(this.inv * 10) % 2 ? 0.4 : 1;
    // The sled, then the survey robot on it.
    line(g, -24, -2, 24, -2, C.amber, 3);
    line(g, 24, -2, 29, -8, C.amber, 3);
    g.fillStyle = C.ink;
    g.fillRect(-14, -28, 28, 22);
    g.fillStyle = C.bg;
    g.fillRect(2, -23, 9, 7);
    line(g, -9, -28, -12, -40, C.ink, 2);
    circle(g, -12, -42, 3, this.combo >= 3 ? C.cyan : C.amber, true);
    g.globalAlpha = 1;
    g.restore();
  }
  drawPlay(g) {
    const r = this.r;
    if (this.zoneT > 0) {
      const z = ZONES[this.zone];
      g.globalAlpha = Math.min(1, this.zoneT * 2);
      text(g, z.roman + "   " + z.name, 480, 70, 30, z.ink, "center");
      text(g, z.text, 480, 104, 20, C.muted, "center");
      g.globalAlpha = 1;
    } else if (this.noticeT > 0) text(g, this.notice, 480, 52, 22, C.amber, "center");
    if (this.trickT > 0) text(g, this.trick, 480, 150, 26, this.trick === "STUMBLE" ? C.red : C.cyan, "center");
    if (r.air && Math.abs(r.spin) > 1) {
      const turns = Math.abs(r.spin) / TAU;
      text(g, turns >= 0.9 ? Math.round(turns) + (Math.round(turns) === 1 ? " FLIP" : " FLIPS") : "TURNING", RIDER_X, Math.max(40, r.y - this.camY - 78), 20, C.amber, "center");
    }
    if (this.hovers > 0 && !this.zen) text(g, "HOVER " + "◆".repeat(this.hovers), 40, 510, 18, C.muted);
  }
  card(g, top, bottom) {
    g.fillStyle = "#0c1511ee";
    g.fillRect(110, top, 740, bottom - top);
    line(g, 160, top + 10, 800, top + 10, C.line);
  }
  drawOrders(g, y, size = 20) {
    this.orders.forEach((o, i) => {
      const done = this.sv.gd[i], prog = Math.min(o.n, Math.floor(ORDER_KINDS[o.k].prog(this) * 10) / 10);
      text(g, (done ? "[X] " : "[ ] ") + orderText(o), 150, y + i * 32, size, done ? C.cyan : C.ink);
      if (!done && this.phase !== "title" && !this.levelled && o.k !== "double" && o.k !== "triple") text(g, Math.floor(prog) + " / " + o.n, 810, y + i * 32, 18, C.amber, "right");
    });
  }
  drawTitle(g) {
    this.card(g, 84, 470);
    text(g, "MOONRUNNER", 480, 132, 42, C.ink, "center");
    text(g, "Ride the lunar slopes. Tap to jump; hold in the air to flip.", 480, 178, 20, C.muted, "center");
    text(g, "LEVEL " + this.sv.lv + "  " + rankOf(this.sv.lv) + "     SURVEY ORDERS", 480, 226, 20, C.amber, "center");
    this.drawOrders(g, 266, 20);
    const next = this.nextUnlock();
    if (next) text(g, "NEXT  " + next, 480, 380, 18, C.muted, "center");
    text(g, this.sv.runs ? "TAP = RIDE     HOLD = DEPOT" : "PRESS TO BEGIN", 480, 430, 20, C.amber, "center");
  }
  drawResult(g) {
    const res = this.result || {};
    this.card(g, 64, 500);
    text(g, res.reason || "RUN ENDED", 480, 104, 32, C.amber, "center");
    if (this.zen) text(g, res.metres + " m IN ZEN", 480, 150, 26, C.ink, "center");
    else {
      text(g, "SCORE " + res.score, 480, 150, 30, C.ink, "center");
      text(g, this.newRecord ? (this.plainRun() ? "NEW RECORD" : "NEW BEST FOR THIS RUN") : "BEST " + this.bestRef(), 480, 186, 18, this.newRecord ? C.cyan : C.muted, "center");
    }
    text(g, res.metres + " m   " + res.flips + " FLIPS   " + res.shards + " SHARDS   COMBO " + res.combo, 480, 222, 20, C.ink, "center");
    let y = 268;
    if (this.levelled) {
      text(g, "LEVEL " + this.levelled.lv + "  " + rankOf(this.levelled.lv) + "   +" + this.levelled.bonus + " SHARDS", 480, y, 24, C.cyan, "center"); y += 32;
      if (this.levelled.unlocks.length) { text(g, "UNLOCKED  " + this.levelled.unlocks.join(", "), 480, y, 18, C.cyan, "center"); y += 30; }
      text(g, "NEW ORDERS", 480, y + 4, 18, C.amber, "center"); y += 36;
    } else if (this.daily) {
      text(g, this.goalDone ? "DAILY GOAL MET" + (this.sv.dl.streak > 1 ? "  STREAK " + this.sv.dl.streak : "") : "DAILY: " + dailyGoal(this.dayKey()).text, 480, y, 18, this.goalDone ? C.cyan : C.muted, "center"); y += 32;
    }
    this.drawOrders(g, y, 18);
    if (this.overT > LOCK) text(g, this.sv.runs >= 2 ? "TAP = RIDE AGAIN     HOLD = DEPOT" : "PRESS TO RIDE AGAIN", 480, 476, 18, C.amber, "center");
  }
  drawDepot(g) {
    this.card(g, 36, 506);
    text(g, "DEPOT", 480, 78, 34, C.amber, "center");
    text(g, "LEVEL " + this.sv.lv + "  " + rankOf(this.sv.lv) + "     " + this.sv.sh + " SHARDS", 480, 112, 18, C.muted, "center");
    const sv = this.sv;
    if (this.view === "menu") {
      const ride = RIDES[sv.sel.ride];
      const rows = {
        "RIDE OUT": ZONES[Math.min(sv.sel.start, sv.far)].name,
        RIDE: ride.name,
        START: ZONES[Math.min(sv.sel.start, sv.far)].name,
        ZEN: sv.lv >= ZEN_LV ? "NO SCORE, NO END" : "LEVEL " + ZEN_LV,
        DAILY: this.dailyDone() ? "DONE TODAY" : "SEEDED BY DATE",
        WORKSHOP: "SPEND SHARDS",
        ORDERS: sv.gd.filter(Boolean).length + " / 3",
        LOG: "REACHED " + ZONES[sv.far].roman + " / VI",
      };
      DEPOT.forEach((id, i) => {
        const y = 150 + i * 36, on = i === this.cur;
        if (on) diamond(g, 150, y, 8, C.amber, true);
        text(g, id, 180, y, 22, on ? C.amber : C.ink);
        text(g, rows[id], 810, y, 20, on ? C.amber : C.muted, "right");
      });
      const id = DEPOT[this.cur];
      let info = "";
      if (id === "RIDE OUT") info = "Ride from the chosen start.";
      else if (id === "RIDE") { const nx = RIDES.find((q) => q.lv > sv.lv); info = ride.text + (nx ? "  NEXT: " + nx.name + " AT LEVEL " + nx.lv : ""); }
      else if (id === "START") info = "Begin in any zone you have reached. Only a run from the start sets the record.";
      else if (id === "ZEN") info = "Ride without score or end. Leave with tap, tap, hold.";
      else if (id === "DAILY") { const gl = dailyGoal(this.dayKey()); info = "Today: " + gl.text + (sv.dl.streak > 1 ? "  STREAK " + sv.dl.streak : ""); }
      else if (id === "WORKSHOP") info = "Magnet, hover pads and a headlamp.";
      else if (id === "ORDERS") info = "Meet all three to reach the next level.";
      else info = "Zones reached and the expedition's totals.";
      text(g, info, 480, 446, 18, C.muted, "center");
      text(g, "TAP = NEXT LINE     HOLD = CHOOSE", 480, 480, 18, C.cyan, "center");
    } else if (this.view === "workshop") {
      WORKSHOP.forEach((it, i) => {
        const y = 160 + i * 70, on = i === this.wcur, tier = sv.up[it.id], cost = it.tiers[tier];
        if (on) diamond(g, 150, y, 8, C.amber, true);
        text(g, it.name + "  " + "◆".repeat(tier) + "◇".repeat(it.tiers.length - tier), 180, y, 22, on ? C.amber : C.ink);
        text(g, cost === undefined ? "COMPLETE" : cost + " SHARDS", 810, y, 20, cost !== undefined && sv.sh >= cost ? C.cyan : C.muted, "right");
        text(g, it.text, 180, y + 26, 16, C.muted);
      });
      const y = 160 + WORKSHOP.length * 70, on = this.wcur === WORKSHOP.length;
      if (on) diamond(g, 150, y, 8, C.amber, true);
      text(g, "BACK", 180, y, 22, on ? C.amber : C.ink);
      text(g, "TAP = NEXT LINE     HOLD = BUY", 480, 480, 18, C.cyan, "center");
    } else if (this.view === "orders") {
      text(g, "SURVEY ORDERS", 480, 156, 22, C.cyan, "center");
      this.drawOrders(g, 200, 20);
      const next = this.nextUnlock();
      if (next) text(g, "NEXT  " + next, 480, 320, 18, C.muted, "center");
      text(g, "TAP = BACK", 480, 480, 18, C.cyan, "center");
    } else {
      const st = sv.st;
      text(g, "RUNS " + sv.runs + "   " + st.m + " m   FLIPS " + st.flips + "   SHARDS " + st.shards, 480, 150, 18, C.cyan, "center");
      text(g, "CABLE " + st.grind + " m   RILLES " + st.chasms + "   BEST COMBO " + st.combo + "   ZEN " + st.zen + " m", 480, 178, 18, C.cyan, "center");
      ZONES.forEach((zz, i) => {
        const y = 222 + i * 34, got = i <= sv.far;
        text(g, zz.roman + "  " + zz.name.slice(4), 160, y, 20, got ? zz.ink : C.line);
        text(g, got ? "REACHED" : "FROM " + zz.from + " m", 800, y, 18, got ? C.amber : C.line, "right");
      });
      text(g, RIDES.map((rd, i) => rd.name + " " + (rd.lv <= sv.lv ? sv.pb[i] : "-")).join("   "), 480, 440, 18, C.muted, "center");
      text(g, "TAP = BACK", 480, 480, 18, C.cyan, "center");
    }
  }
}
