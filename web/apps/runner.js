// MOONRUNNER — a one-button hill-flyer in the manner of Tiny Wings. A survey sled rides rolling
// lunar hills. Hold: the sled is heavy and dives, so on a downslope it gains speed (on an upslope
// it loses it). Let go: it is light and flies off the crests. Come down so the sled meets a
// downslope along its own line and the landing is a PERFECT SLIDE: a burst of speed. Three in a
// row is FEVER. The sled runs on daylight: the terminator is coming, every zone reached buys more,
// and when the light is gone the sled coasts to a stop.
//
// Around that: six zones that each add one thing (bigger hills, dust pits, rilles to fly over,
// boost crystals, crater rims with vents, the dark far side), survey orders (three goals per level,
// which unlock sleds, zen riding and trails), shards for the workshop, a daily run seeded by the
// date, and a depot reached by holding on the title or result screen. The save is versioned
// (schema 3) and migrates both earlier releases.
//
// Drawing is smooth on an uneven frame clock: the hills are cosine curves between fixed key points,
// every background layer is a function of world position, and draw() extrapolates the camera by the
// time since the last fixed update. The camera pulls back with speed and height.
import { C, space, text, line, circle, diamond } from "../engine/draw.js";
import { clamp, lerp, wrapAngle, mixSeed, Random } from "../engine/math.js";
import { LAMP, lamps, dim, spot, pulse, blink, fill, lightsOff } from "../engine/lightshow.js";
import { AppGuard } from "../engine/input.js";
import { LampBus } from "./game-kit.js";

export const G = 900; // px/s^2
export const PX_M = 20; // px per metre
export const MIN_V = 110; // the sled never quite stops while there is light
export const PERFECT = 0.42; // a touchdown this close (radians, about 24 degrees) to a downslope is a perfect slide
export const THUD = 0.8; // beyond this the landing thuds and loses speed
const DRAG = 0.00035, FRICT = 12;
const RIDER_X = 300, RIDER_Y = 290; // where the camera's focus sits on screen
const AHEAD = 3600, BEHIND = 900;
const SAFE = 150 * PX_M; // the first 150 m of a run have no rilles or pits
const START_T = 40, ZONE_T = 25, PERFECT_T = 0.5;
const FEVER_T = 5, FEVER_CHAIN = 3;
const NIGHT_STOP = 150; // after dark the run ends when the sled is this slow on the ground
const FALL_T = 8; // seconds of daylight lost by falling into a rille
const VENT_V = 950, BOOST_A = 1300;
const HOP = 0.12; // flights shorter than this (s) neither score nor break a chain
const LIP = 0.24; // the rim of a rille throws the sled up at about this slope
export const RILLE_V = 420; // slower than this at the rim and the sled will not clear a rille
const HOLD_PICK = 0.5; // a press this long on a menu screen chooses instead of tapping
const LOCK = 0.7; // the result screen ignores presses this long
const MAX_KP = 48, MAX_SHARDS = 64, MAX_CHASMS = 8, MAX_PITS = 8, MAX_PADS = 8, MAX_VENTS = 8, MAX_PARTS = 32, TRAIL = 10;
const REASONS = { night: "NIGHT FELL", quit: "RUN ENDED" };

// ---- the hills -----------------------------------------------------------------------
// Each zone starts at `from` metres. `L` is the range of half-wavelengths (crest to valley, px),
// `H` the range of drops, `mix` the weights of what the planner puts on a crest or a valley.
export const ZONES = [
  { name: "THE MARE", roman: "I", from: 0, L: [330, 480], H: [70, 130], col: LAMP.green, ink: "#9fdc7a", text: "Hold to dive down the slopes. Let go to fly.", mix: { shards: 3, none: 2 } },
  { name: "THE DUNES", roman: "II", from: 400, L: [380, 560], H: [110, 190], col: LAMP.amber, ink: C.amber, text: "Dust pits in the valleys. Fly over them.", mix: { pit: 4, shards: 2, none: 1 } },
  { name: "THE RILLES", roman: "III", from: 1000, L: [400, 600], H: [130, 220], col: LAMP.cyan, ink: C.cyan, text: "Rilles past the crests. Be fast to fly them.", mix: { chasm: 4, pit: 2, shards: 2 } },
  { name: "THE CRYSTALS", roman: "IV", from: 1800, L: [420, 640], H: [150, 240], col: LAMP.violet, ink: "#b48cf0", text: "Hold over a crystal to be thrown forward.", mix: { pad: 4, chasm: 2, pit: 2, shards: 1 } },
  { name: "THE RIMS", roman: "V", from: 2800, L: [480, 760], H: [190, 300], col: LAMP.white, ink: "#ece4d0", text: "Crater rims and gas vents. Go high.", mix: { vent: 3, chasm: 3, pad: 2, pit: 1, shards: 1 } },
  { name: "THE FAR SIDE", roman: "VI", from: 4000, L: [460, 760], H: [180, 300], col: LAMP.blue, ink: "#6fa8dc", text: "No Earth in this sky. Trust the lamps.", mix: { chasm: 3, pit: 2, pad: 2, vent: 2, shards: 1 }, dark: true },
];
export const zoneAt = (m) => { for (let i = ZONES.length - 1; i > 0; i--) if (m >= ZONES[i].from) return i; return 0; };
const MOTIFS = [[392, 494, 587], [440, 554, 659], [330, 415, 494], [294, 370, 440], [523, 659, 784], [262, 311, 392]];
const PENT = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
const note = (k) => 330 * Math.pow(2, PENT[clamp(k, 0, PENT.length - 1)] / 12);

// ---- sleds, trails, workshop -----------------------------------------------------------
// `dive` multiplies gravity while held, `air` is gravity in flight, `lv` the level that unlocks it.
export const RIDES = [
  { name: "SURVEYOR", dive: 3, air: 0.7, maxV: 1500, lv: 1, text: "The survey sled. Even-tempered." },
  { name: "SKIMMER", dive: 3.1, air: 0.55, maxV: 1400, lv: 3, text: "Light. Long, floating flights; a softer dive." },
  { name: "HAULER", dive: 3.4, air: 0.85, maxV: 1650, lv: 6, text: "Heavy. Dives hard, flies short, goes fastest." },
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
  { id: "bat", name: "BATTERY", tiers: [150, 400], text: "Eight more seconds of daylight a tier." },
  { id: "coil", name: "FEVER COIL", tiers: [250], text: "Fever lasts two seconds longer." },
];
const MAG_R = [0, 45, 85, 130];
const ZEN_LV = 2;
const RANKS = ["CADET", "SURVEYOR", "PATHFINDER", "DUNE WALKER", "RILLE JUMPER", "CRYSTAL HAND", "RIM RIDER", "FAR SIDER", "MOON GHOST"];
export const rankOf = (lv) => RANKS[Math.min(RANKS.length - 1, Math.floor((lv - 1) / 3))];

// ---- survey orders: three goals a level ------------------------------------------------
// `min` is the first level an order can appear at, so every order on the board can be met by then.
const zoneProg = (a) => (a.startZone === 0 ? a.R.zone : 0);
export const ORDER_KINDS = {
  dist: { min: 1, n: (L) => Math.min(6000, 250 + 150 * L), text: (n) => `Ride ${n} m in one run.`, prog: (a) => a.R.m },
  score: { min: 1, n: (L) => Math.min(30000, 600 + 450 * L), text: (n) => `Score ${n} in one run.`, prog: (a) => a.scoreNow() },
  perfects: { min: 1, n: (L) => Math.min(60, 2 + 2 * L), text: (n) => `Land ${n} perfect slides in one run.`, prog: (a) => a.R.perfects },
  shards: { min: 1, n: (L) => Math.min(150, 8 + 5 * L), text: (n) => `Collect ${n} shards in one run.`, prog: (a) => a.R.shards },
  chain: { min: 2, n: (L) => Math.min(15, 2 + Math.floor(L / 2)), text: (n) => `Land ${n} perfect slides in a row.`, prog: (a) => a.R.chain },
  zone: { min: 2, n: (L) => Math.min(5, 1 + Math.floor(L / 3)), text: (n) => `Reach ${ZONES[n].name} from the start.`, prog: zoneProg },
  high: { min: 2, n: (L) => Math.min(40, 8 + 2 * L), text: (n) => `Fly ${n} m above the ground.`, prog: (a) => a.R.high },
  fever: { min: 3, n: (L) => Math.min(10, 1 + Math.floor((L - 3) / 3)), text: (n) => `Reach fever ${n} time${n > 1 ? "s" : ""} in one run.`, prog: (a) => a.R.fevers },
  long: { min: 3, n: (L) => Math.min(120, 25 + 6 * L), text: (n) => `Fly ${n} m in one flight.`, prog: (a) => a.R.longest },
  zen: { min: 3, n: () => 1000, text: (n) => `Ride ${n} m in zen.`, prog: (a) => a.R.zenM },
  chasm: { min: 4, n: (L) => Math.min(15, Math.floor(L / 2)), text: (n) => `Fly ${n} rilles in one run.`, prog: (a) => a.R.chasms },
  hoard: { min: 5, n: (L) => 150 * L, text: (n) => `Collect ${n} shards in all.`, prog: (a) => a.sv.st.shards + a.R.shards },
  speed: { min: 5, n: (L) => Math.min(200, 110 + 6 * L), text: (n) => `Reach ${n} km/h.`, prog: (a) => a.R.top },
  pads: { min: 6, n: (L) => Math.min(20, 2 + Math.floor(L / 2)), text: (n) => `Ride ${n} boost crystals in one run.`, prog: (a) => a.R.pads },
  vent: { min: 8, n: (L) => Math.min(8, 1 + Math.floor((L - 8) / 3)), text: (n) => `Ride ${n} vent${n > 1 ? "s" : ""} in one run.`, prog: (a) => a.R.vents },
};
const hashText = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
// The three orders of level L, the same on every console. Level 1 is a fixed introduction.
export function ordersFor(L) {
  if (L <= 1) return [{ k: "perfects", n: 3 }, { k: "dist", n: 400 }, { k: "shards", n: 10 }];
  const kinds = Object.keys(ORDER_KINDS).filter((k) => ORDER_KINDS[k].min <= L), out = [];
  for (let s = 0; out.length < 3 && s < 40; s++) {
    const k = kinds[hashText("order" + L + ":" + s) % kinds.length];
    if (out.some((o) => o.k === k)) continue;
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
  if (kind === 0) return { kind: "perfects", n: 8 + 3 * v, text: "Land " + (8 + 3 * v) + " perfect slides." };
  if (kind === 1) return { kind: "zone", n: 1 + (v % 4), text: "Reach " + ZONES[1 + (v % 4)].name + "." };
  if (kind === 2) return { kind: "shards", n: 20 + 8 * v, text: "Collect " + (20 + 8 * v) + " shards." };
  return { kind: "score", n: 2000 + 1000 * v, text: "Score " + (2000 + 1000 * v) + "." };
}

// ---- save ---------------------------------------------------------------------------
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const nat = (v) => Math.max(0, Math.floor(num(v)));
const HOVER_COST = [150, 450], LAMP_COST = [120];
const spent = (costs, tier) => costs.slice(0, clamp(nat(tier), 0, costs.length)).reduce((a, b) => a + b, 0);
// Bring any stored shape to schema 3:
// - the first release saved { schema: 1, runs, last, milestone }: these carry over, and each 100 m
//   milestone reached in the old game is worth 5 shards;
// - the downhill test build (schema 2) had other orders and upgrades: its level, shards, sleds and
//   stats carry over, the orders of the level start again, and hover pads and headlamp are refunded.
export function migrateSave(raw) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const ob = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const st = ob(r.st), sel = ob(r.sel), dl = ob(r.dl), up = ob(r.up);
  const schema = r.schema === 3 ? 3 : r.schema === 2 ? 2 : 1;
  const lv = clamp(Math.floor(num(r.lv, 1)), 1, 999);
  const gd = Array.from({ length: 3 }, (_, i) => (schema === 3 && Array.isArray(r.gd) && r.gd[i] ? 1 : 0));
  let sh = schema === 1 ? nat(r.milestone) * 5 : nat(r.sh);
  if (schema === 2) sh += spent(HOVER_COST, up.hov) + spent(LAMP_COST, up.lamp);
  return {
    schema: 3,
    runs: nat(r.runs),
    last: r.last && typeof r.last === "object" && !Array.isArray(r.last) ? r.last : {},
    milestone: nat(r.milestone),
    lv,
    gd,
    sh,
    up: { mag: clamp(nat(up.mag), 0, 3), bat: clamp(nat(up.bat), 0, 2), coil: clamp(nat(up.coil), 0, 1) },
    sel: { ride: clamp(nat(sel.ride), 0, RIDES.length - 1), start: clamp(nat(sel.start), 0, ZONES.length - 1), trail: clamp(nat(sel.trail), 0, TRAILS.length - 1) },
    far: clamp(nat(r.far), 0, ZONES.length - 1),
    pb: Array.from({ length: RIDES.length }, (_, i) => nat(Array.isArray(r.pb) ? r.pb[i] : 0)),
    st: { m: nat(st.m), perfects: nat(st.perfects), shards: nat(st.shards), fevers: nat(st.fevers), chasms: nat(st.chasms), chain: nat(st.chain), zen: nat(st.zen), best: nat(st.best), top: nat(st.top) },
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
const DEPOT = ["RIDE OUT", "SLED", "START", "ZEN", "DAILY", "WORKSHOP", "ORDERS", "LOG"];
const kmh = (v) => Math.round((v / PX_M) * 3.6);

export class Moonrunner {
  constructor(ctx) {
    this.c = ctx;
    this.guard = new AppGuard(this, ctx); // takes back a menu gesture that reached the game (docs/ENGINE.md)
    this.lamps = new LampBus(ctx); // dedupes writes; asleep while paused
    this.t = 0;
    this.held = false;
    this.armed = false; // a press on a menu screen that is waiting for its release
    this.pt = 0;
    this.sv = migrateSave(ctx.progress?.());
    this.view = "menu";
    this.cur = 0;
    this.wcur = 0;
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
    this.dstate = this.daily ? (mixSeed(hashText("day" + this.dayKey())) || 1) : 0;
    // Hills: key points alternate crest and valley; between two the ground is half a cosine.
    this.kp = [{ x: this.x0 - 600, y: -60 }, { x: this.x0 + 260, y: 40, valley: true }];
    this.base = 0;
    this.chasms = []; this.pits = []; this.pads = []; this.vents = []; this.shards = [];
    this.extend();
    const x = this.x0 + 40;
    this.r = { x, y: this.gy(x), vx: 260, vy: 0, v: 260, a: this.slopeAt(x), air: false, airT: 0, tx: x, hi: 0, vent: false };
    this.camX = x; this.camY = this.r.y; this.zoom = 1;
    this.runT = 0;
    this.T = this.zen ? Infinity : START_T + 8 * sv.up.bat;
    this.night = false;
    this.chain = 0; this.fever = 0;
    this.pts = 0;
    this.zone = zoneAt(x / PX_M);
    this.zoneT = 0;
    this.noticeT = 0; this.notice = "";
    this.trickT = 0; this.trick = "";
    this.fx = { perfect: 0, shard: 0, order: 0, zone: 0, end: 0, record: 0, thud: 0 };
    this.overT = 0;
    this.reason = "";
    this.result = null;
    this.newRecord = false;
    this.recorded = false;
    this.banked = false;
    this.levelled = null;
    this.goalDone = false;
    this.best0 = this.bestRef();
    this.R = { m: 0, perfects: 0, chain: 0, fevers: 0, shards: 0, zone: this.zone, chasms: 0, high: 0, longest: 0, top: 0, pads: 0, vents: 0, zenM: 0, falls: 0 };
    this.orders = ordersFor(sv.lv);
    this.trail.fill(0); this.trailN = 0;
    this.parts.fill(0); this.partNext = 0;
  }
  dayKey() { return dateKey(); }
  ride() { return RIDES[this.rideIx]; }
  plainRun() { return !this.daily && !this.zen && this.startZone === 0; }
  // The record this run chases: the console's best for a plain run, the day's or the sled's otherwise.
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

  // ---- terrain -----------------------------------------------------------------------
  seg(x) {
    const kp = this.kp;
    let lo = 0, hi = kp.length - 2;
    if (x <= kp[0].x) return 0;
    if (x >= kp[hi + 1].x) return hi;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (kp[mid].x <= x) lo = mid; else hi = mid - 1; }
    return lo;
  }
  // Height of the ground at x (y grows downwards).
  gy(x) {
    const i = this.seg(x), a = this.kp[i], b = this.kp[i + 1], u = clamp((x - a.x) / (b.x - a.x), 0, 1);
    return a.y + (b.y - a.y) * (1 - Math.cos(Math.PI * u)) / 2;
  }
  // Angle of the ground at x: positive runs downhill.
  slopeAt(x) {
    const i = this.seg(x), a = this.kp[i], b = this.kp[i + 1], L = b.x - a.x, u = clamp((x - a.x) / L, 0, 1);
    return Math.atan(((b.y - a.y) * Math.PI * Math.sin(Math.PI * u)) / (2 * L));
  }
  frontier() { return this.kp[this.kp.length - 1].x; }
  rng() {
    if (!this.daily) return this.c.rng;
    dailyRng.state = this.dstate;
    return dailyRng;
  }
  // Add hills to AHEAD px past the rider. Each new crest or valley may carry a feature.
  extend() {
    const rng = this.rng(), want = (this.r ? this.r.x : this.x0) + AHEAD;
    let guard = 0;
    while (this.frontier() < want && guard++ < 60) {
      const last = this.kp[this.kp.length - 1], zi = zoneAt(last.x / PX_M), z = ZONES[zi];
      const deep = clamp((last.x / PX_M - z.from) / 900, 0, 1);
      const L = rng.range(z.L[0], z.L[1]);
      const H = Math.min(rng.range(z.H[0], z.H[1]) * (0.85 + 0.3 * deep), L * 0.68); // the steepest slope stays under ~47 degrees
      const valley = !last.valley;
      this.base += L * 0.06; // a slight overall descent, so even a careless sled keeps moving
      const p = { x: last.x + L, y: this.base + (valley ? H / 2 : -H / 2) };
      if (valley) p.valley = true;
      this.kp.push(p);
      if (last.x > this.x0 + SAFE || !valley) this.plan(rng, last, p, zi);
    }
    if (this.daily) this.dstate = dailyRng.state;
  }
  // Put something on the slope from key point a (a crest or a valley) to the next one, b.
  plan(rng, a, b, zi) {
    const z = ZONES[zi], safe = a.x < this.x0 + SAFE;
    const kind = pickWeighted(rng, safe ? { shards: 2, none: 1 } : z.mix);
    const L = b.x - a.x;
    if (!a.valley) {
      // a is a crest: rilles, crystals, vents and shard arcs belong on the way down.
      if (kind === "chasm" && this.chasms.length < MAX_CHASMS) {
        const x0 = a.x + 30, w = Math.min(L * 0.55, rng.range(110, 170) + 30 * (zi >= 4 ? 1 : 0));
        this.chasms.push({ x0, x1: x0 + w, done: false });
        this.arc(x0, 4, 40, 40, w / 3, true);
      } else if (kind === "pad" && this.pads.length < MAX_PADS) {
        this.pads.push({ x0: a.x + L * 0.25, x1: a.x + L * 0.65, used: false });
      } else if (kind === "vent" && this.vents.length < MAX_VENTS) {
        this.vents.push({ x: a.x, w: 60, used: false });
        for (let k = 0; k < 5; k++) this.addShard(a.x + 80 + k * 90, 260 + 80 * Math.sin((k / 4) * Math.PI));
      } else if (kind === "shards" || kind === "pit" || kind === "none") {
        if (kind !== "none") this.arc(a.x - 20, rng.int(4, 7), 70, 70, 60);
      }
    } else if (kind === "pit" && this.pits.length < MAX_PITS) {
      // a is a valley: a pit of loose dust either side of the bottom.
      const w = rng.range(160, 260);
      this.pits.push({ x0: a.x - w / 2, x1: a.x + w / 2 });
      this.arc(a.x - w / 2, 4, 120, 40, w / 3);
    }
  }
  arc(x, n, base, lift, step, absolute) {
    for (let k = 0; k < n; k++) this.addShard(x + k * step, base + lift * Math.sin(n > 1 ? (k / (n - 1)) * Math.PI : 0), absolute);
  }
  // A shard `off` px above the ground at x (or, `absolute`, above the crest height before x).
  addShard(x, off, absolute) {
    if (this.shards.length >= MAX_SHARDS) return;
    const ref = absolute ? this.gy(x - 40) : this.gy(x);
    this.shards.push({ x, y: ref - off, got: 0, pull: 0 });
  }
  inSpan(list, x) {
    for (const q of list) if (x > q.x0 && x < q.x1) return q;
    return null;
  }
  chasmAt(x) { return this.inSpan(this.chasms, x); }
  prune() {
    const left = this.r.x - BEHIND;
    while (this.kp.length > 4 && this.kp[1].x < left) this.kp.shift();
    while (this.kp.length > MAX_KP) this.kp.shift();
    const gone = (q) => (q.x1 ?? q.x) > left - 100;
    this.chasms = this.chasms.filter(gone);
    this.pits = this.pits.filter(gone);
    this.pads = this.pads.filter(gone);
    this.vents = this.vents.filter((q) => q.x > left - 100);
    this.shards = this.shards.filter((q) => q.x > left - 100);
  }

  // ---- physics (touches only the rider it is given, so a bot can plan on a copy) --------
  // Advances rider `r` by dt; `dive` is whether the button is held. Returns what happened:
  // null, or { type: "launch" | "gap" | "vent" | "land" | "fell" | "wall", ... }. A `probe` (a bot
  // trying a line on a copy of the sled) leaves the vents and crystals as they are.
  advance(r, dt, dive, probe = false) {
    const ride = this.ride(), dark = this.night;
    const heavy = dive && !dark ? ride.dive : 1;
    if (!r.air) {
      const th = this.slopeAt(r.x);
      let acc = G * heavy * Math.sin(th) - DRAG * r.v * r.v - FRICT;
      if (this.inSpan(this.pits, r.x)) acc -= 0.9 * r.v + 60; // loose dust
      if (dark) acc -= 0.6 * r.v;
      const pad = this.inSpan(this.pads, r.x);
      if (pad && dive && !dark) { acc += BOOST_A; if (!probe) pad.used = true; }
      r.v = clamp(r.v + acc * dt, dark ? 0 : MIN_V, ride.maxV + (this.fever > 0 ? 250 : 0));
      const vx = r.v * Math.cos(th), vy = r.v * Math.sin(th);
      const nx = r.x + vx * dt;
      for (const v of this.vents) {
        if (!v.used && Math.abs(nx - v.x) < v.w / 2) {
          if (!probe) v.used = true;
          r.air = true; r.vx = vx; r.vy = -VENT_V; r.x = nx; r.y = this.gy(nx) - 1;
          r.airT = 0; r.tx = r.x; r.hi = 0; r.vent = true;
          return { type: "vent", vent: v };
        }
      }
      if (this.chasmAt(nx)) {
        // The near rim of a rille is a lip: it throws the sled up a little, so speed carries it over.
        r.air = true; r.vx = vx; r.vy = Math.min(vy, -LIP * vx); r.x = nx; r.y += vy * dt; r.airT = 0; r.tx = r.x; r.hi = 0; r.vent = false;
        return { type: "gap" };
      }
      // Leaving the ground: the slope falls away faster than gravity can follow.
      const ny = r.y + vy * dt + 0.5 * G * heavy * dt * dt, g1 = this.gy(nx);
      if (ny < g1 - 0.05) {
        r.air = true; r.vx = vx; r.vy = vy + G * heavy * dt; r.x = nx; r.y = ny; r.airT = 0; r.tx = r.x; r.hi = 0; r.vent = false;
        return { type: "launch" };
      }
      r.x = nx; r.y = g1; r.a = this.slopeAt(nx); r.vx = vx; r.vy = vy;
      return null;
    }
    // In the air: held, the sled drops fast (to meet a downslope); light, it floats.
    r.airT += dt;
    const g = G * (dive && !dark ? ride.dive * 0.75 : ride.air);
    r.vx -= r.vx * 0.02 * dt;
    r.vy += g * dt;
    const px = r.x;
    r.x += r.vx * dt;
    r.y += r.vy * dt;
    r.a += wrapAngle(Math.atan2(r.vy, r.vx) - r.a) * Math.min(1, 8 * dt);
    r.hi = Math.max(r.hi, this.gy(r.x) - r.y);
    for (const c of this.chasms) if (px < c.x1 && r.x >= c.x1 && r.y > this.gy(c.x1) + 24) return { type: "wall", chasm: c };
    const gap = this.chasmAt(r.x);
    if (gap) return r.y > this.gy(r.x) + 160 ? { type: "fell", chasm: gap } : null;
    const gr = this.gy(r.x);
    if (r.y >= gr) {
      const th = this.slopeAt(r.x), diff = Math.abs(wrapAngle(Math.atan2(r.vy, r.vx) - th));
      const ev = { type: "land", diff, th, airT: r.airT, hi: r.hi, dist: r.x - r.tx, vent: r.vent };
      r.air = false; r.y = gr; r.a = th; r.vent = false;
      r.v = Math.max(dark ? 0 : MIN_V, r.vx * Math.cos(th) + r.vy * Math.sin(th));
      return ev;
    }
    return null;
  }
  // Would landing now be perfect? (Used by the lamps and a planning bot.)
  perfectNow(r) {
    const th = this.slopeAt(r.x + r.vx * 0.1);
    return th > 0.08 && Math.abs(wrapAngle(Math.atan2(r.vy, r.vx) - th)) <= PERFECT;
  }

  // ---- input ---------------------------------------------------------------------------
  // On the title, result and depot screens a press is decided when it ends: a tap chooses the
  // main action, a press of HOLD_PICK seconds or more opens or operates the depot. In a run the
  // button is simply held (dive) or not (fly).
  down() {
    this.guard.mark();
    if (this.phase === "title" || this.phase === "depot" || (this.phase === "over" && this.overT > LOCK)) {
      this.armed = true;
      this.pt = this.t;
      return;
    }
    if (this.phase === "play") this.held = true;
  }
  up() {
    this.guard.release();
    if (this.armed) {
      this.armed = false;
      this.menuPress(this.t - this.pt);
      return;
    }
    this.held = false;
  }
  cancel() {
    this.guard.rewind();
    this.armed = false;
    this.held = false;
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
  start(mode = "") {
    this.daily = mode === "daily";
    this.zen = mode === "zen";
    this.held = false;
    this.reset();
    this.zoneT = 2.6;
    this.c.tone(MOTIFS[this.zone][0], 0.12, "sine");
    this.setHint(this.zen ? "Zen: no clock, no score. Tap, tap, hold for the menu." : "Hold to dive down a slope. Let go to fly off the crest.");
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
    if (row === "SLED") { let i = s.ride; do i = (i + 1) % RIDES.length; while (RIDES[i].lv > this.sv.lv); s.ride = i; }
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
    this.noticeT = Math.max(0, this.noticeT - dt);
    this.trickT = Math.max(0, this.trickT - dt);
    this.zoneT = Math.max(0, this.zoneT - dt);
    if (this.fever > 0) { this.fever = Math.max(0, this.fever - dt); if (!this.fever) this.c.tone(300, 0.1, "sine"); }
    if (!this.zen) {
      const before = this.T;
      this.T = Math.max(0, this.T - dt);
      if (before > 10 && this.T <= 10) this.notify("THE NIGHT IS CLOSE", 2);
      if (this.T <= 0 && !this.night) { this.night = true; this.notify("NIGHT. THE SLED COASTS.", 3); this.c.tone(196, 0.5, "sine"); }
    }
    const ev = this.advance(r, dt, this.held);
    if (ev) {
      if (ev.type === "land") this.onLand(ev);
      else if (ev.type === "launch" && r.v > 500) this.c.tone(150 + r.v * 0.1, 0.06, "triangle");
      else if (ev.type === "vent") { this.R.vents++; this.c.tone(250, 0.18, "sawtooth"); this.c.tone(500, 0.2, "sine"); this.fx.zone = 0.4; this.dust(r.x, r.y, 8); }
      else if (ev.type === "fell" || ev.type === "wall") this.fall(ev.chasm);
    }
    if (this.phase !== "play") return;
    for (const c of this.chasms) {
      if (c.done || r.x < c.x1 + 4 || (r.air && r.y > this.gy(c.x1) + 6)) continue;
      c.done = true;
      this.R.chasms++;
      this.addPoints(40, "RILLE");
    }
    for (const p of this.pads) if (p.used && !p.counted) { p.counted = true; this.R.pads++; this.c.tone(880, 0.1, "triangle"); this.showTrick("BOOST"); }
    this.collect(r, dt);
    const m = (r.x - this.x0) / PX_M;
    this.R.m = Math.max(this.R.m, m);
    if (this.zen) this.R.zenM = this.R.m;
    this.R.top = Math.max(this.R.top, kmh(Math.hypot(r.vx, r.vy)));
    if (r.air) this.R.high = Math.max(this.R.high, Math.floor((this.gy(r.x) - r.y) / PX_M));
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
    if (this.night && !r.air && r.v < NIGHT_STOP) { this.finish("night"); return; }
    this.camera(dt);
    this.extend();
    this.prune();
    this.pushTrail(r);
    if (!r.air && this.held && r.v > 450 && Math.floor(this.runT * 60) % 6 === 0) this.dust(r.x - 10, r.y, 1);
    this.stepParts(dt);
    this.c.hud(this.hudItems());
    this.hintNow();
  }
  // The camera follows the sled across, eases up and down between the sled and the ground under it,
  // and pulls back with speed and with height so the ground stays in view.
  camera(dt) {
    const r = this.r, ground = this.gy(r.x), h = Math.max(0, ground - r.y);
    const speed = Math.hypot(r.vx, r.vy);
    const zt = clamp(Math.min(1.1 - (speed - 300) / 2200, 400 / Math.max(1, h + 120)), 0.42, 1.05);
    this.zoom += (zt - this.zoom) * (1 - Math.exp(-2.5 * dt));
    this.camX = r.x;
    const ty = lerp(r.y, ground, 0.45) + 40 / this.zoom;
    this.camY += (ty - this.camY) * (1 - Math.exp(-5 * dt));
  }
  hintNow() {
    const r = this.r;
    if (this.noticeT > 0) return this.setHint(this.notice);
    if (this.night) return this.setHint("Night: the sled coasts to a stop.");
    if (r.air) return this.setHint(this.held ? "Diving. Meet a downslope along your line." : "Flying. Hold to dive onto the next downslope.");
    const th = this.slopeAt(r.x);
    this.setHint(th > 0.05 ? (this.held ? "Diving downhill. Let go before the climb." : "Downhill: hold to dive.") : this.held ? "Let go on the climb, or it slows you." : "Climbing. Let go and fly off the crest.");
  }
  hudItems() {
    const z = ZONES[this.zone], r = this.r;
    const speed = kmh(Math.hypot(r.vx, r.vy)) + " km/h";
    if (this.zen) return [["DISTANCE", Math.floor(this.R.m) + " m"], ["SPEED", speed], ["ZONE", z.roman]];
    return [["SCORE", this.scoreNow()], ["SPEED", speed], ["DAYLIGHT", Math.ceil(this.T) + " s"], ["ZONE", z.roman + " " + z.name.slice(4)]];
  }
  resultHud() {
    return [["SCORE", this.result?.score ?? 0], ["DISTANCE", (this.result?.metres ?? 0) + " m"], ["PERFECT", this.R.perfects], ["BEST", this.bestRef()]];
  }
  notify(message, seconds = 2.4) { this.notice = message; this.noticeT = seconds; }
  showTrick(label) { this.trick = label; this.trickT = 1.2; }
  addPoints(n, label) {
    const k = this.fever > 0 ? 2 : 1;
    this.pts += n * k;
    if (label) this.showTrick(label + "  +" + Math.round(n * k));
  }
  onLand(ev) {
    const r = this.r;
    if (ev.airT < HOP) return; // a skip over a bump is not a landing
    const flight = ev.dist / PX_M;
    this.R.longest = Math.max(this.R.longest, Math.floor(flight));
    if (ev.hi > 240) this.addPoints(Math.floor(ev.hi / 8), "BIG AIR");
    if (ev.diff <= PERFECT && ev.th > 0.08) {
      this.chain++;
      this.R.perfects++;
      this.R.chain = Math.max(this.R.chain, this.chain);
      r.v = Math.min(this.ride().maxV + (this.fever > 0 ? 250 : 0), r.v * 1.08 + 60);
      if (!this.zen && !this.night) this.T += PERFECT_T;
      this.addPoints(30 + 20 * Math.min(this.chain, 10), this.fever > 0 ? "FEVER SLIDE" : "PERFECT");
      this.fx.perfect = 0.45;
      this.c.tone(note(Math.min(9, this.chain)), 0.08, "sine");
      this.c.tone(note(Math.min(9, this.chain)) * 1.5, 0.14, "sine");
      if (this.chain % FEVER_CHAIN === 0 && this.fever <= 0) {
        this.fever = FEVER_T + 2 * this.sv.up.coil;
        this.R.fevers++;
        this.notify("FEVER", 1.6);
        [523, 659, 784, 1047].forEach((hz, i) => this.c.tone(hz, 0.08 + 0.03 * i, "triangle"));
      }
      this.dust(r.x, r.y, 4);
    } else {
      if (this.chain > 0) this.c.tone(260, 0.06, "sine");
      this.chain = 0;
      if (ev.diff > THUD) {
        this.fx.thud = 0.3;
        this.showTrick("THUD");
        this.c.tone(110, 0.12, "square");
        this.dust(r.x, r.y, 8);
      } else this.dust(r.x, r.y, 2);
    }
  }
  // Into a rille: daylight is lost and the sled is set down on the far side.
  fall(c) {
    const r = this.r;
    r.x = c.x1 + 40; r.y = this.gy(r.x); r.a = this.slopeAt(r.x); r.air = false; r.v = 320; r.vx = r.v; r.vy = 0;
    c.done = true;
    this.chain = 0;
    this.R.falls++;
    if (!this.zen) this.T = Math.max(0, this.T - FALL_T);
    this.fx.thud = 0.6;
    this.c.tone(110, 0.25, "sawtooth");
    this.notify(this.zen ? "INTO THE RILLE. RIDE ON." : "INTO THE RILLE: -" + FALL_T + " S OF DAYLIGHT", 2.2);
    this.dust(r.x, r.y, 10);
  }
  enterZone(zi) {
    this.zone = zi;
    this.R.zone = Math.max(this.R.zone, zi);
    this.zoneT = 2.6;
    this.fx.zone = 0.8;
    if (!this.zen && !this.night && zi > this.startZone) { this.T += ZONE_T; this.notify("+" + ZONE_T + " S OF DAYLIGHT", 2.6); }
    MOTIFS[zi].forEach((hz, i) => this.c.tone(hz, 0.16 + 0.04 * i, "sine"));
  }
  collect(r, dt) {
    const mag = MAG_R[this.sv.up.mag], reach = 26 + mag, cy = r.y - 18;
    for (const s of this.shards) {
      if (s.got) continue;
      const dx = s.x - r.x, dy = s.y - cy;
      if (Math.abs(dx) > reach + 40) continue;
      const d = Math.hypot(dx, dy);
      if (d < reach && mag > 0) s.pull = 1;
      if (s.pull) { const k = Math.min(1, (1200 * dt) / Math.max(1, d)); s.x -= dx * k; s.y -= dy * k; }
      if (d < 26 || (s.pull && d < 32)) {
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
      [523, 659, 784].forEach((hz, k) => this.c.tone(hz, 0.1 + 0.05 * k, "sine"));
    });
  }
  goalMet() {
    const g = dailyGoal(this.dayKey());
    if (g.kind === "perfects") return this.R.perfects >= g.n;
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
    this.fx.end = 0.6;
    this.c.tone(130, 0.5, "sine");
    this.c.tone(98, 0.7, "sine");
    this.dust(r.x, r.y, 6);
    const score = this.scoreNow();
    this.newRecord = score > 0 && score > this.best0;
    if (this.plainRun()) this.c.score(score);
    this.bank();
    this.setHint(this.sv.runs >= 2 ? "Tap to ride again. Hold for the depot." : "Tap to ride again.");
  }
  // Fold the run into the save: stats, shards, the day's record, the sled's best, and a level if all
  // three orders are done. Runs once per run.
  bank() {
    if (this.banked) return;
    this.banked = true;
    const sv = this.sv, R = this.R, score = this.scoreNow(), metres = Math.floor(R.m);
    sv.runs++;
    sv.st.m += metres; sv.st.perfects += R.perfects; sv.st.shards += R.shards; sv.st.fevers += R.fevers;
    sv.st.chasms += R.chasms; sv.st.chain = Math.max(sv.st.chain, R.chain); sv.st.top = Math.max(sv.st.top, R.top);
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
    this.result = { score: this.zen ? 0 : score, metres, perfects: R.perfects, chain: R.chain, shards: R.shards, top: R.top, zone: ZONES[R.zone].name, reason: REASONS[this.reason] || REASONS.quit, milestone: Math.floor(metres / 100) };
    sv.milestone = Math.max(sv.milestone, this.result.milestone);
    sv.last = { score: this.result.score, metres, perfects: R.perfects, chain: R.chain, shards: R.shards, top: R.top, zone: this.result.zone, milestone: this.result.milestone };
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
  // Left: speed, in the zone's colour, filling up as the sled goes faster (cyan while diving).
  // Middle: in the air, green when a landing now would be a perfect slide (amber otherwise),
  // brighter as the ground comes up; on the ground the perfect chain toward fever.
  // Right: daylight, cyan while there is plenty, amber under 15 s, blinking red under 8 s.
  // Fever is a fast white chase across all three; the next rille shows as a red blink on the
  // right lamp when the sled is too slow to fly it.
  lampValues() {
    const zc = ZONES[this.zone].col;
    if (this.phase === "title") return lightsOff();
    if (this.phase === "depot") return spot(0.5 + 0.5 * Math.sin(this.t * 0.8), dim(ZONES[this.sv.far].col, 0.14));
    if (this.phase === "over") return this.fx.end > 0 ? fill(LAMP.blue, 0.3 * (this.fx.end / 0.6)) : lightsOff();
    const r = this.r;
    if (this.fx.record > 0) { const on = blink(1 - this.fx.record, 5); return fill(on ? LAMP.white : LAMP.amber, on ? 0.7 : 0.1); }
    if (this.fx.order > 0) return fill(LAMP.amber, 0.5 * pulse(this.fx.order, 3.3));
    if (this.fx.thud > 0) return fill(LAMP.amber, 0.35 * blink(this.fx.thud, 8));
    if (this.fx.perfect > 0) { // a sweep left to right: perfect
      const k = Math.min(2, Math.floor((0.45 - this.fx.perfect) / 0.15));
      return lamps(...[0, 1, 2].map((i) => (i <= k ? dim(LAMP.green, i === k ? 0.8 : 0.3) : null)));
    }
    if (this.fx.zone > 0) return fill(zc, 0.45 * (this.fx.zone / 0.8));
    if (this.fever > 0) {
      const at = Math.floor(this.runT * 10) % 3;
      return lamps(...[0, 1, 2].map((i) => dim(i === at ? LAMP.white : LAMP.cyan, i === at ? 0.6 : 0.15)));
    }
    const speed = clamp((Math.hypot(r.vx, r.vy) - 200) / 900, 0, 1);
    const left = dim(this.held && !r.air ? LAMP.cyan : zc, 0.05 + 0.4 * speed);
    let mid;
    if (r.air) {
      const height = Math.max(0, this.gy(r.x) - r.y);
      const near = this.chasmAt(r.x) ? 0.2 : clamp(1 - height / 260, 0, 1);
      mid = dim(this.perfectNow(r) ? LAMP.green : LAMP.amber, 0.06 + 0.5 * near);
    } else mid = this.chain > 0 ? dim(LAMP.green, 0.1 + 0.15 * (this.chain % FEVER_CHAIN)) : null;
    let right;
    const c = this.chasms.find((q) => !q.done && q.x0 > r.x && q.x0 - r.x < 900);
    if (this.zen) right = null;
    else if (c && !r.air && r.v < RILLE_V) right = dim(LAMP.red, blink(this.t, 6) ? 0.6 : 0.05);
    else if (this.T < 8) right = dim(LAMP.red, blink(this.t, 3) ? 0.6 : 0.08);
    else if (this.T < 15) right = dim(LAMP.amber, 0.25);
    else right = dim(LAMP.cyan, 0.06 + 0.12 * clamp(this.T / 60, 0, 1));
    let out = lamps(left, mid, right);
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
    const z = this.zoom, cx = this.camX + r.vx * lead, cy = this.camY;
    const zone = ZONES[this.zone], dark = !!zone.dark;
    space(g, cx * 0.02, dark ? 0.6 : 1);
    this.drawSky(g, cx, dark);
    this.drawStreaks(g);
    g.save();
    g.translate(RIDER_X, RIDER_Y);
    g.scale(z, z);
    g.translate(-cx, -cy);
    this.drawGround(g, cx, cy, z, dark);
    this.drawFeatures(g, cx, z, dark);
    this.drawTrail(g, z);
    this.drawParts(g);
    if (this.phase !== "depot") this.drawRider(g, r.x + r.vx * lead, r.y + r.vy * lead, r.a);
    g.restore();
    this.drawDusk(g);
    if (this.phase === "play") this.drawPlay(g);
    else if (this.phase === "title") this.drawTitle(g);
    else if (this.phase === "over") this.drawResult(g);
    else this.drawDepot(g);
  }
  drawSky(g, cx, dark) {
    if (!dark) {
      circle(g, 770, 104, 40, "#1c3330", true);
      circle(g, 770, 104, 40, C.cyan, false, 2);
      g.fillStyle = C.bg;
      g.beginPath(); g.arc(784, 104, 38, Math.PI * 0.5, Math.PI * 1.5, true); g.fill();
    }
    for (let layer = 0; layer < 2; layer++) {
      const f = layer ? 0.3 : 0.12, base = layer ? 360 : 320, amp = layer ? 40 : 54;
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
  // The terminator: the land darkens from the left as the daylight runs out.
  drawDusk(g) {
    if (this.phase === "play" && !this.zen && this.T < 20) {
      const k = clamp(1 - this.T / 20, 0, 1), w = 960 * (0.2 + 0.6 * k);
      const shade = g.createLinearGradient?.(0, 0, w, 0);
      if (shade?.addColorStop) {
        shade.addColorStop(0, "rgba(2,5,4,0.85)");
        shade.addColorStop(1, "rgba(2,5,4,0)");
        g.globalAlpha = k;
        g.fillStyle = shade;
        g.fillRect(0, 0, w, 540);
        g.globalAlpha = 1;
      }
    }
  }
  // Speed streaks in screen space, more and longer the faster the sled goes.
  drawStreaks(g) {
    if (this.phase !== "play") return;
    const r = this.r, speed = Math.hypot(r.vx, r.vy), k = clamp((speed - 450) / 700, 0, 1);
    if (k <= 0) return;
    g.strokeStyle = this.fever > 0 ? C.cyan : C.muted;
    g.lineWidth = 2;
    g.globalAlpha = 0.25 + 0.4 * k;
    g.beginPath();
    const n = Math.round(4 + 10 * k);
    for (let i = 0; i < n; i++) {
      const y = 60 + 420 * hash1(i + 0.37), len = 40 + 120 * k;
      const x = 960 - fract(hash1(i) + this.t * (1.2 + 1.5 * k) * (0.6 + hash1(i + 0.5))) * 1100;
      g.moveTo(x, y); g.lineTo(x + len, y);
    }
    g.stroke();
    g.globalAlpha = 1;
  }
  drawGround(g, cx, cy, z, dark) {
    const x0 = cx - (RIDER_X + 30) / z, x1 = cx + (960 - RIDER_X + 30) / z, step = 10 / z, bottom = cy + (560 - RIDER_Y) / z;
    const fillCol = dark ? "#16261c" : "#1f3a28", edge = dark ? C.muted : C.ink;
    const piece = (a, b) => {
      if (b <= a) return;
      g.fillStyle = fillCol;
      g.beginPath();
      g.moveTo(a, bottom);
      for (let x = a; x < b; x += step) g.lineTo(x, this.gy(x));
      g.lineTo(b, this.gy(b));
      g.lineTo(b, bottom);
      g.closePath();
      g.fill();
      g.strokeStyle = edge;
      g.lineWidth = 2 / z;
      g.beginPath();
      g.moveTo(a, this.gy(a));
      for (let x = a; x < b; x += step) g.lineTo(x, this.gy(x));
      g.lineTo(b, this.gy(b));
      g.stroke();
    };
    let from = x0;
    for (const c of this.chasms) {
      if (c.x1 < x0 || c.x0 > x1) continue;
      piece(from, c.x0);
      g.fillStyle = "#050a07";
      g.fillRect(c.x0, Math.min(this.gy(c.x0), this.gy(c.x1)), c.x1 - c.x0, bottom);
      line(g, c.x0, this.gy(c.x0), c.x0 + 6, bottom, C.red, 2 / z);
      line(g, c.x1, this.gy(c.x1), c.x1 - 6, bottom, C.red, 2 / z);
      from = c.x1;
    }
    piece(from, x1);
    // Regolith marks, fixed to the ground: they show the speed.
    g.strokeStyle = C.line;
    g.lineWidth = 2 / z;
    g.beginPath();
    for (let n = Math.floor(x0 / 70); n * 70 < x1; n++) {
      const wx = n * 70 + 40 * hash1(n);
      if (this.chasmAt(wx) || this.chasmAt(wx + 16)) continue;
      const y = this.gy(wx) + 14 + 30 * hash1(n + 0.5);
      g.moveTo(wx, y);
      g.lineTo(wx + 8 + 10 * hash1(n + 0.25), y);
    }
    g.stroke();
  }
  drawFeatures(g, cx, z, dark) {
    const r = this.r, edge = r.x + (dark ? 900 : 1e9);
    const seen = (x) => (dark ? clamp((edge - x) / 240, 0, 1) : 1);
    const vis = (x) => x > cx - 400 / z && x < cx + 800 / z;
    for (const p of this.pits) {
      if (!vis(p.x0) && !vis(p.x1)) continue;
      g.globalAlpha = Math.max(0.25, seen(p.x0));
      g.fillStyle = "#4a3d22";
      for (let x = p.x0; x < p.x1; x += 14) { const y = this.gy(x); g.fillRect(x, y - 3, 8, 5 + 4 * hash1(x)); }
      line(g, p.x0, this.gy(p.x0) - 6, p.x1, this.gy(p.x1) - 6, C.amber, 1.5 / z);
      g.globalAlpha = 1;
    }
    for (const p of this.pads) {
      if (!vis(p.x0) && !vis(p.x1)) continue;
      g.globalAlpha = Math.max(0.25, seen(p.x0));
      for (let x = p.x0; x < p.x1; x += 36) diamond(g, x, this.gy(x) - 10, 9, p.used ? C.line : "#b48cf0", true);
      g.globalAlpha = 1;
    }
    for (const vn of this.vents) {
      if (!vis(vn.x)) continue;
      g.globalAlpha = Math.max(0.25, seen(vn.x));
      const y = this.gy(vn.x);
      g.fillStyle = "#123a36";
      g.fillRect(vn.x - vn.w / 2, y - 6, vn.w, 8);
      if (!vn.used) for (let k = 0; k < 4; k++) {
        const u = fract(this.t * 1.2 + k / 4), px = vn.x + Math.sin(k * 2.1 + this.t * 3) * 10;
        circle(g, px, y - 10 - u * 110, 3 + u * 6, C.cyan, false, 2 / z);
      }
      g.globalAlpha = 1;
    }
    for (const s of this.shards) {
      if (s.got || !vis(s.x)) continue;
      const a = seen(s.x);
      if (a <= 0) continue;
      g.globalAlpha = a;
      diamond(g, s.x, s.y, (6 + 1.5 * Math.sin(this.t * 4 + s.x * 0.01)) / Math.sqrt(z), C.cyan, true);
      g.globalAlpha = 1;
    }
  }
  drawTrail(g, z) {
    const n = this.trailN;
    if (n < 2 || this.phase === "title" || this.phase === "depot") return;
    g.strokeStyle = this.fever > 0 ? C.cyan : TRAILS[this.sv.sel.trail]?.col || C.amber;
    for (let i = TRAIL - n + 1; i < TRAIL; i++) {
      const k = (i - (TRAIL - n)) / n;
      g.globalAlpha = k;
      g.lineWidth = (1 + 4 * k) / z;
      g.beginPath();
      g.moveTo(this.trail[i * 2 - 2], this.trail[i * 2 - 1]);
      g.lineTo(this.trail[i * 2], this.trail[i * 2 + 1]);
      g.stroke();
    }
    g.globalAlpha = 1;
  }
  drawParts(g) {
    g.fillStyle = C.muted;
    for (let k = 0; k < MAX_PARTS; k++) {
      const o = k * 5, life = this.parts[o + 4];
      if (life <= 0) continue;
      g.globalAlpha = Math.min(1, life * 2);
      g.fillRect(this.parts[o] - 2, this.parts[o + 1] - 2, 4, 4);
    }
    g.globalAlpha = 1;
  }
  drawRider(g, x, y, a) {
    const diving = this.held && this.phase === "play";
    g.save();
    g.translate(x, y);
    g.rotate(a);
    g.scale(1.3, diving ? 1.05 : 1.3); // squats when diving
    line(g, -24, -2, 24, -2, diving ? C.cyan : C.amber, 3);
    line(g, 24, -2, 29, -8, diving ? C.cyan : C.amber, 3);
    g.fillStyle = C.ink;
    g.fillRect(-14, -28, 28, 22);
    g.fillStyle = C.bg;
    g.fillRect(2, -23, 9, 7);
    line(g, -9, -28, -12, -40, C.ink, 2);
    circle(g, -12, -42, 3, this.fever > 0 ? C.cyan : C.amber, true);
    g.restore();
  }
  drawPlay(g) {
    if (this.zoneT > 0) {
      const z = ZONES[this.zone];
      g.globalAlpha = Math.min(1, this.zoneT * 2);
      text(g, z.roman + "   " + z.name, 480, 70, 30, z.ink, "center");
      text(g, z.text, 480, 104, 20, C.muted, "center");
      g.globalAlpha = 1;
    } else if (this.noticeT > 0) text(g, this.notice, 480, 52, 22, this.notice === "FEVER" ? C.cyan : C.amber, "center");
    if (this.trickT > 0) text(g, this.trick, 480, 150, 26, this.trick === "THUD" ? C.red : C.cyan, "center");
    // The perfect chain toward fever, and the fever meter.
    if (this.fever > 0) {
      text(g, "FEVER", 40, 500, 20, C.cyan);
      line(g, 120, 500, 120 + 160 * (this.fever / (FEVER_T + 2 * this.sv.up.coil)), 500, C.cyan, 6);
    } else if (this.chain > 0) {
      text(g, "PERFECT", 40, 500, 18, C.muted);
      for (let i = 0; i < FEVER_CHAIN; i++) diamond(g, 140 + i * 24, 500, 8, i < this.chain % FEVER_CHAIN || this.chain % FEVER_CHAIN === 0 ? C.amber : C.line, true);
    }
  }
  card(g, top, bottom) {
    g.fillStyle = "#0c1511ee";
    g.fillRect(110, top, 740, bottom - top);
    line(g, 160, top + 10, 800, top + 10, C.line);
  }
  drawOrders(g, y, size = 20) {
    this.orders.forEach((o, i) => {
      const done = this.sv.gd[i], prog = Math.min(o.n, Math.floor(ORDER_KINDS[o.k].prog(this)));
      text(g, (done ? "[X] " : "[ ] ") + orderText(o), 150, y + i * 32, size, done ? C.cyan : C.ink);
      if (!done && this.phase !== "title" && !this.levelled) text(g, prog + " / " + o.n, 810, y + i * 32, 18, C.amber, "right");
    });
  }
  drawTitle(g) {
    this.card(g, 84, 470);
    text(g, "MOONRUNNER", 480, 132, 42, C.ink, "center");
    text(g, "Hold to dive down the slopes. Let go to fly off the crests.", 480, 178, 20, C.muted, "center");
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
    text(g, res.metres + " m   " + res.perfects + " PERFECT   BEST CHAIN " + res.chain + "   " + res.top + " km/h", 480, 222, 20, C.ink, "center");
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
        SLED: ride.name,
        START: ZONES[Math.min(sv.sel.start, sv.far)].name,
        ZEN: sv.lv >= ZEN_LV ? "NO CLOCK, NO SCORE" : "LEVEL " + ZEN_LV,
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
      else if (id === "SLED") { const nx = RIDES.find((q) => q.lv > sv.lv); info = ride.text + (nx ? "  NEXT: " + nx.name + " AT LEVEL " + nx.lv : ""); }
      else if (id === "START") info = "Begin in any zone you have reached. Only a run from the start sets the record.";
      else if (id === "ZEN") info = "Ride with no daylight clock and no score. Leave with tap, tap, hold.";
      else if (id === "DAILY") { const gl = dailyGoal(this.dayKey()); info = "Today: " + gl.text + (sv.dl.streak > 1 ? "  STREAK " + sv.dl.streak : ""); }
      else if (id === "WORKSHOP") info = "Magnet, battery and fever coil.";
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
      text(g, "RUNS " + sv.runs + "   " + st.m + " m   PERFECT " + st.perfects + "   SHARDS " + st.shards, 480, 150, 18, C.cyan, "center");
      text(g, "FEVERS " + st.fevers + "   RILLES " + st.chasms + "   BEST CHAIN " + st.chain + "   TOP " + st.top + " km/h", 480, 178, 18, C.cyan, "center");
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
