// MOONRUNNER — a one-button hill-flyer in the manner of Tiny Wings. A survey sled rides rolling
// lunar hills. Hold: the sled is heavy and dives, so on a downslope it gains speed (on an upslope
// it loses it). Let go: it is light and flies off the crests. Come down so the sled meets a
// downslope along its own line and the landing is a PERFECT SLIDE: a burst of speed. Three in a
// row is FEVER. The sled runs on daylight: the terminator is coming, every zone reached buys more
// (less and less from the crystals on), and when the light is gone the sled coasts to a stop. From
// the crystals on the dive assist weakens and the perfect window narrows, so the far zones are
// reached on skill. Workshop gear forgives mistakes but never adds daylight or points.
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
import { C, text, line, circle, diamond } from "../engine/draw.js";
import { clamp, lerp, wrapAngle, mixSeed, Random } from "../engine/math.js";
import { LAMP, lamps, dim, spot, pulse, blink, fill, lightsOff } from "../engine/lightshow.js";
import { AppGuard } from "../engine/input.js";
import { LampBus } from "./game-kit.js";

export const G = 900; // px/s^2
export const PX_M = 20; // px per metre
export const MIN_V = 110; // the sled never quite stops while there is light
export const PERFECT = 0.5; // a touchdown this close (radians, about 29 degrees) to a downslope is a perfect slide
export const THUD = 0.8; // beyond this the landing thuds and loses speed
const DRAG = 0.00035, FRICT = 12;
const RIDER_X = 300, RIDER_Y = 290; // where the camera's focus sits on screen
const AHEAD = 2400, BEHIND = 900;
// Hill length (crest to valley, px) for a set: TEMPO.k * speed^TEMPO.p, kept within the zone's
// range scaled by lo..hi. SET is the number of matching hills in a set.
export const TEMPO = { k: 0.65, p: 1, lo: 0.8, hi: 2.2, stick: 1, airDive: 0.9, assistH: 600 };
const SET = [3, 5];
const SAFE = 150 * PX_M; // the first 150 m of a run have no rilles or pits
const START_T = 35, PERFECT_T = 0.5;
// Daylight for reaching each zone: less and less from the crystals on, so the far zones are reached
// on perfect slides, not on the clock alone.
export const ZONE_T = [0, 22, 20, 10, 6, 4];
const FEVER_T = 5, FEVER_CHAIN = 3, FEVER_MAX = 4; // fever rises a level (x2 .. x5) for every three more perfect slides
const BEACON_H = 170; // how high (px) above the ground a beacon hangs
const SUN_T = 4; // seconds of daylight a sunstone gives
const BEACON_SH = 60; // shards for finding the last of a zone's three beacons
const BEACON_AT = [0.2, 0.5, 0.8]; // where in a zone (as a share of its length) its beacons hang
const NIGHT_STOP = 150; // after dark the run ends when the sled is this slow on the ground
const FALL_T = 8; // seconds of daylight lost by falling into a rille
const VENT_V = 950, BOOST_A = 1300;
export const ASSIST = { w: 3 }; // how fast (rad/s) a dive above a downslope bends toward it
const CLOSE_IN = 0.2; // how much steeper than the slope a drawn dive closes in
const LAND_KEEP = 0.7; // a landing keeps at least this much of the speed in flight
const GLUE = 0.12; // on a slope steeper than this (rad) downhill the sled does not leave the ground
const STEEP_OK = 0.12; // a landing may come in this much steeper than the window and still be perfect
const THUD_KEEP = 0.55; // a thud keeps only this much of the speed (other landings LAND_KEEP)
const HOP = 0.12; // flights shorter than this (s) neither score nor break a chain
const LIP = 0.24; // the rim of a rille throws the sled up at about this slope
export const RILLE_V = 420; // slower than this at the rim and the sled will not clear a rille
const HOLD_PICK = 0.5; // a press this long on a menu screen chooses instead of tapping
const LOCK = 0.7; // the result screen ignores presses this long
const MAX_KP = 48, MAX_SUNS = 6, MAX_SHARDS = 64, MAX_CHASMS = 8, MAX_PITS = 8, MAX_PADS = 8, MAX_VENTS = 8, MAX_PARTS = 32, TRAIL = 10;
const REASONS = { night: "NIGHT FELL", quit: "RUN ENDED" };

// ---- the hills -----------------------------------------------------------------------
// Each zone starts at `from` metres. `L` is the range of half-wavelengths (crest to valley, px),
// `H` the range of drops, `mix` the weights of what the planner puts on a crest or a valley.
export const ZONES = [
  { name: "THE MARE", roman: "I", from: 0, L: [450, 630], H: [210, 320], col: LAMP.green, ink: "#9fdc7a", text: "Hold to dive down the slopes. Let go to fly.", mix: { shards: 3, none: 2 } },
  { name: "THE DUNES", roman: "II", from: 400, L: [510, 720], H: [250, 360], col: LAMP.amber, ink: C.amber, text: "Dust pits in the valleys. Fly over them.", mix: { pit: 4, shards: 2, none: 1 } },
  { name: "THE RILLES", roman: "III", from: 1000, L: [540, 780], H: [280, 420], col: LAMP.cyan, ink: C.cyan, text: "Rilles past the crests. Be fast to fly them.", mix: { chasm: 4, pit: 2, shards: 2 } },
  { name: "THE CRYSTALS", roman: "IV", from: 1800, L: [570, 840], H: [310, 450], col: LAMP.violet, ink: "#b48cf0", text: "Hold over a crystal to be thrown forward.", mix: { pad: 4, chasm: 2, pit: 2, shards: 1 } },
  { name: "THE RIMS", roman: "V", from: 3400, L: [630, 960], H: [360, 530], col: LAMP.white, ink: "#ece4d0", text: "Crater rims and gas vents. Go high.", mix: { vent: 3, chasm: 3, pad: 2, pit: 1, shards: 1 } },
  { name: "THE FAR SIDE", roman: "VI", from: 5400, L: [630, 960], H: [340, 500], col: LAMP.blue, ink: "#6fa8dc", text: "No Earth in this sky. Trust the lamps.", mix: { chasm: 3, pit: 2, pad: 2, vent: 2, shards: 1 }, dark: true },
];
// From the crystals on the sled is on its own more and more: the dive assist weakens (`assist`, a
// share of ASSIST.w) and the perfect window narrows (`win`, radians). Zones I-III keep the full help.
export const GRIP = [
  { assist: 1, win: PERFECT }, { assist: 1, win: PERFECT }, { assist: 1, win: PERFECT },
  { assist: 0.6, win: 0.42 }, { assist: 0.4, win: 0.38 }, { assist: 0.3, win: 0.35 },
];
export const zoneAt = (m) => { for (let i = ZONES.length - 1; i > 0; i--) if (m >= ZONES[i].from) return i; return 0; };
// Each zone's colours: sky top and horizon, far and near ridges, ground top and depth, the band of
// lighter regolith under the surface, and the surface line.
const SKIES = [
  { sky: ["#040a10", "#13271f"], far: "#172b24", mid: "#1e382b", soil: ["#2c5035", "#10211a"], band: "#3b6a45", edge: "#d6efa4" },
  { sky: ["#0a0907", "#2a2015"], far: "#2c2417", mid: "#3a2f1e", soil: ["#5a4628", "#211910"], band: "#715a33", edge: "#f0cf96" },
  { sky: ["#030e17", "#0f2e37"], far: "#12333c", mid: "#18434c", soil: ["#235e67", "#0b2126"], band: "#2f7a83", edge: "#a8e2dc" },
  { sky: ["#090513", "#231939"], far: "#281f42", mid: "#332955", soil: ["#483876", "#150f29"], band: "#5e4a96", edge: "#d2b8ff" },
  { sky: ["#090909", "#292925"], far: "#2d2d29", mid: "#3a3a34", soil: ["#58564e", "#1b1b17"], band: "#6e6c62", edge: "#f4eedc" },
  { sky: ["#010205", "#070d1b"], far: "#0c1323", mid: "#111b2e", soil: ["#17253c", "#070b15"], band: "#213454", edge: "#8fb4e8" },
];
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const mix = (a, b, k) => { const A = hex(a), B = hex(b); return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * k).toString(16).padStart(2, "0")).join(""); };
// A zone's colours at x metres: they blend into the next zone's over its first 80 m.
function paletteAt(m) {
  const zi = zoneAt(m), from = ZONES[zi].from, k = zi > 0 ? clamp((m - from) / 80, 0, 1) : 1;
  if (k >= 1) return SKIES[zi];
  const a = SKIES[zi - 1], b = SKIES[zi];
  return { sky: [mix(a.sky[0], b.sky[0], k), mix(a.sky[1], b.sky[1], k)], far: mix(a.far, b.far, k), mid: mix(a.mid, b.mid, k), soil: [mix(a.soil[0], b.soil[0], k), mix(a.soil[1], b.soil[1], k)], band: mix(a.band, b.band, k), edge: mix(a.edge, b.edge, k) };
}
// A horizontal gradient, or its right-hand colour where the canvas cannot make one.
function hgrad(g, x0, x1, left, right) {
  const gr = g.createLinearGradient?.(x0, 0, x1, 0);
  if (!gr?.addColorStop) return right;
  gr.addColorStop(0, left); gr.addColorStop(1, right);
  return gr;
}
// A vertical gradient, or its top colour where the canvas cannot make one.
function vgrad(g, y0, y1, top, bottom) {
  const gr = g.createLinearGradient?.(0, y0, 0, y1);
  if (!gr?.addColorStop) return top;
  gr.addColorStop(0, top); gr.addColorStop(1, bottom);
  return gr;
}
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
// Bought with shards. tiers[i] is the cost of tier i + 1. Gear forgives mistakes and gathers
// shards, but never adds daylight or points, so a clean run scores the same with or without it.
// (The ids are the save's: `bat` was a battery that added daylight before 2026-10-02.)
export const WORKSHOP = [
  { id: "mag", name: "MAGNET", tiers: [80, 200, 400], text: "Pulls shards in from further away." },
  { id: "bat", name: "GRAPPLE", tiers: [150, 400], text: "A fall into a rille costs three seconds less a tier." },
  { id: "coil", name: "FEVER COIL", tiers: [250], text: "Once each fever, a missed slide keeps the chain." },
];
const MAG_R = [0, 45, 85, 130];
const ZEN_LV = 2;

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
  sun: { min: 2, n: (L) => Math.min(8, 1 + Math.floor(L / 3)), text: (n) => `Catch ${n} sunstone${n > 1 ? "s" : ""} in one run.`, prog: (a) => a.R.suns },
  feverlv: { min: 5, n: (L) => Math.min(FEVER_MAX + 1, 2 + Math.floor((L - 5) / 4)), text: (n) => `Raise fever to x${n}.`, prog: (a) => a.R.feverLv },
  beacon: { min: 4, n: (L) => Math.min(18, 1 + Math.floor((L - 2) / 2)), text: (n) => `Find ${n} survey beacon${n > 1 ? "s" : ""} in all.`, prog: (a) => beaconCount(a.sv.bc) },
  vent: { min: 8, n: (L) => Math.min(8, 1 + Math.floor((L - 8) / 3)), text: (n) => `Ride ${n} vent${n > 1 ? "s" : ""} in one run.`, prog: (a) => a.R.vents },
};
const beaconCount = (bc) => bc.reduce((n, m) => n + ((m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1)), 0);
// Where the survey beacons hang: three per zone, at fixed distances (m). The far side's run 1500 m past its start.
export const beaconsOf = (zi) => { const a = ZONES[zi].from, b = zi + 1 < ZONES.length ? ZONES[zi + 1].from : a + 1500; return BEACON_AT.map((k) => Math.round(a + k * (b - a))); };
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
const DAILY_SH = 60; // shards for the day's goal, once a day
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
//   stats carry over, the orders of the level start again, and hover pads and headlamp are refunded;
// - schema 3 saves from before the beacons have no `bc`, `st.bm` or `st.suns`: they start at 0.
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
    st: { m: nat(st.m), bm: nat(st.bm), suns: nat(st.suns), perfects: nat(st.perfects), shards: nat(st.shards), fevers: nat(st.fevers), chasms: nat(st.chasms), chain: nat(st.chain), zen: nat(st.zen), best: nat(st.best), top: nat(st.top) },
    bc: Array.from({ length: ZONES.length }, (_, i) => clamp(nat(Array.isArray(r.bc) ? r.bc[i] : 0), 0, 7)),
    // The day's best and whether its goal was paid. (A streak and its last day were kept here until
    // 2026-10-02; the console logbook keeps the streak now, and old ones are dropped.)
    dl: { d: typeof dl.d === "string" ? dl.d.slice(0, 10) : "", best: nat(dl.best), done: dl.done ? 1 : 0 },
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
    // The daily run's goal is this game's order in the console logbook (when it is one of today's three).
    ctx.daily?.("Daily run: " + dailyGoal(this.dayKey()).text.replace(/\.$/, "").toLowerCase());
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
    this.set = null;
    this.vRef = 520; // the speed new hills are sized for: the sled's, smoothed over a few seconds
    this.chasms = []; this.pits = []; this.pads = []; this.vents = []; this.shards = []; this.suns = [];
    this.beacons = this.zen ? [] : this.placeBeacons();
    this.extend();
    const x = this.x0 + 40;
    this.r = { x, y: this.gy(x), vx: 260, vy: 0, v: 260, a: this.slopeAt(x), air: false, airT: 0, tx: x, hi: 0, vent: false };
    this.camX = x; this.camY = this.r.y; this.zoom = 1;
    this.runT = 0;
    this.T = this.zen ? Infinity : START_T;
    this.night = false;
    this.chain = 0; this.fever = 0; this.feverLv = 0; this.coilUsed = false;
    this.pts = 0;
    this.zone = zoneAt(x / PX_M);
    this.zoneT = 0;
    this.noticeT = 0; this.notice = "";
    this.trickT = 0; this.trick = "";
    this.fx = { perfect: 0, shard: 0, order: 0, zone: 0, end: 0, record: 0, thud: 0, sun: 0, beacon: 0 };
    this.rings = []; // expanding rings where perfect slides landed: { x, y, t }
    this.overT = 0;
    this.reason = "";
    this.result = null;
    this.newRecord = false;
    this.recorded = false;
    this.banked = false;
    this.levelled = null;
    this.goalDone = false;
    this.best0 = this.bestRef();
    this.R = { m: 0, perfects: 0, chain: 0, fevers: 0, shards: 0, zone: this.zone, chasms: 0, high: 0, longest: 0, top: 0, pads: 0, vents: 0, zenM: 0, falls: 0, suns: 0, feverLv: 0, beacons: 0 };
    this.orders = ordersFor(sv.lv);
    this.trail.fill(0); this.trailN = 0;
    this.parts.fill(0); this.partNext = 0;
  }
  dayKey() { return dateKey(); }
  ride() { return RIDES[this.rideIx]; }
  // Fever raises the top speed, more at each level.
  topSpeed() { return this.ride().maxV + (this.fever > 0 ? 150 + 100 * this.feverLv : 0); }
  fallT() { return FALL_T - 3 * this.sv.up.bat; }
  feverLen() { return FEVER_T; }
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
      // Hills come in sets of matching hills, so the dive and the release fall on a steady beat.
      // A new set is sized to the sled's recent speed, so each flight off a crest comes down on
      // the next downslope at any speed; its shape (height over length) is the zone's.
      if (!this.set || this.set.left <= 0) {
        const deep = clamp((last.x / PX_M - z.from) / 900, 0, 1);
        const L = clamp(TEMPO.k * Math.pow(this.vRef, TEMPO.p), z.L[0] * TEMPO.lo, z.L[1] * TEMPO.hi) * rng.range(0.94, 1.06);
        const shape = ((z.H[0] + z.H[1]) / (z.L[0] + z.L[1])) * (0.9 + 0.2 * deep);
        this.set = { L, H: Math.min(L * shape, L * 0.9), left: 2 * rng.int(SET[0], SET[1]) };
      }
      const set = this.set;
      set.left--;
      const L = set.L * rng.range(0.97, 1.03), H = set.H * rng.range(0.95, 1.05); // the steepest slope stays under ~55 degrees
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
        // Now and then a sunstone hangs high over a crest: only a big flight reaches it.
        if (!safe && this.suns.length < MAX_SUNS && rng.next() < 0.22) this.suns.push({ x: a.x + rng.range(-60, 160), y: a.y - rng.range(80, 170), got: 0 });
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
  // This run's survey beacons, from the start zone on. Each hangs high above the hills.
  placeBeacons() {
    const out = [];
    for (let zi = this.startZone; zi < ZONES.length; zi++) beaconsOf(zi).forEach((m, k) => { if (m * PX_M > this.x0 + SAFE) out.push({ zi, k, x: m * PX_M, found: (this.sv.bc[zi] >> k) & 1, got: 0 }); });
    return out;
  }
  beaconY(b) { return this.gy(b.x) - BEACON_H; }
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
    this.suns = this.suns.filter((q) => q.x > left - 100);
  }

  // ---- physics (touches only the rider it is given, so a bot can plan on a copy) --------
  // Advances rider `r` by dt; `dive` is whether the button is held. Returns what happened:
  // null, or { type: "launch" | "gap" | "vent" | "land" | "fell" | "wall", ... }. A `probe` (a bot
  // trying a line on a copy of the sled) leaves the vents and crystals as they are.
  advance(r, dt, dive, probe = false) {
    const ride = this.ride(), dark = this.night;
    const heavy = dive && !dark ? ride.dive : ride.air; // light, the sled is as light on the ground as in the air
    if (!r.air) {
      const th = this.slopeAt(r.x);
      let acc = G * heavy * Math.sin(th) - DRAG * r.v * r.v - FRICT;
      if (this.inSpan(this.pits, r.x)) acc -= 0.9 * r.v + 60; // loose dust
      if (dark) acc -= 0.6 * r.v;
      const pad = this.inSpan(this.pads, r.x);
      if (pad && dive && !dark) { acc += BOOST_A; if (!probe) pad.used = true; }
      r.v = clamp(r.v + acc * dt, dark ? 0 : MIN_V, this.topSpeed());
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
      // The sled hugs the ground (at least STICK gravity) until the hill falls away from it, so it
      // leaves near the crest rather than half way up the climb.
      const hug = G * Math.max(heavy, TEMPO.stick), ny = r.y + vy * dt + 0.5 * hug * dt * dt, g1 = this.gy(nx);
      // Held, or well down a slope, it stays on the ground: a fast sled on the curve of a crest or a
      // downslope would otherwise skip off it in tiny hops (Sam, 2026-10-03: "I kind of bounce down
      // the slope"). Released near a crest or on a climb, it flies.
      if (ny < g1 - 0.05 && th < GLUE && !(dive && !dark)) {
        r.air = true; r.vx = vx; r.vy = vy + hug * dt; r.x = nx; r.y = ny; r.airT = 0; r.tx = r.x; r.hi = 0; r.vent = false;
        return { type: "launch" };
      }
      r.x = nx; r.y = g1; r.a = this.slopeAt(nx); r.vx = vx; r.vy = vy;
      return null;
    }
    // In the air: held, the sled drops fast (to meet a downslope); light, it floats.
    r.airT += dt;
    const g = G * (dive && !dark ? ride.dive * TEMPO.airDive : ride.air);
    r.vx -= r.vx * 0.02 * dt;
    r.vy += g * dt;
    // Diving above a downslope, the sled is drawn onto it: its line bends to close in on the slope
    // (a little steeper than it), and just before touchdown to run along it, so a dive that is
    // roughly right lands as a perfect slide.
    if (dive && !dark) {
      const th = this.slopeAt(r.x + r.vx * 0.1), below = this.gy(r.x) - r.y;
      if (th > 0.1 && below < TEMPO.assistH) {
        const sp = Math.hypot(r.vx, r.vy), path = Math.atan2(r.vy, r.vx);
        const near = below < 40, aim = th + (near ? 0.05 : CLOSE_IN);
        // Far above the slope the line only ever steepens, so a dive never floats the sled past it.
        const w = ASSIST.w * GRIP[zoneAt(r.x / PX_M)].assist;
        const turn = clamp(wrapAngle(aim - path), near ? -w * dt : 0, w * dt), na = path + turn;
        r.vx = sp * Math.cos(na); r.vy = sp * Math.sin(na);
      }
    }
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
      const th = this.slopeAt(r.x), sd = wrapAngle(Math.atan2(r.vy, r.vx) - th), diff = Math.abs(sd);
      // sd > 0: the sled came in steeper than the slope (a dive into it).
      const ev = { type: "land", diff, sd, th, airT: r.airT, hi: r.hi, dist: r.x - r.tx, vent: r.vent };
      r.air = false; r.y = gr; r.a = th; r.vent = false;
      // Speed along the slope, but never less than LAND_KEEP of the speed in flight; a thud keeps
      // only THUD_KEEP of it.
      const sp = Math.hypot(r.vx, r.vy);
      const along = r.vx * Math.cos(th) + r.vy * Math.sin(th);
      r.v = Math.max(dark ? 0 : MIN_V, diff > THUD ? THUD_KEEP * sp : Math.max(along, dark ? 0 : LAND_KEEP * sp));
      return ev;
    }
    return null;
  }
  // Would landing now be perfect? (Used by the lamps and a planning bot.)
  perfectNow(r) {
    const th = this.slopeAt(r.x + r.vx * 0.1);
    const sd = wrapAngle(Math.atan2(r.vy, r.vx) - th), win = this.windowAt(r.x);
    return th > 0.08 && sd >= -win && sd <= win + STEEP_OK;
  }
  // Is landing event `ev` at x a perfect slide? A dive that comes in a little too steep still is:
  // that is the move a player makes, and missing it by a hair felt unfair on the console.
  isPerfect(ev, x) { const win = this.windowAt(x); return ev.th > 0.08 && ev.sd >= -win && ev.sd <= win + STEEP_OK; }
  // The perfect window (radians) at x px.
  windowAt(x) { return GRIP[zoneAt(x / PX_M)].win; }

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
    if (this.fever > 0) { this.fever = Math.max(0, this.fever - dt); if (!this.fever) { this.feverLv = 0; this.c.tone(300, 0.1, "sine"); } }
    if (!this.zen) {
      const before = this.T;
      this.T = Math.max(0, this.T - dt);
      if (before > 10 && this.T <= 10) this.notify("THE NIGHT IS CLOSE", 2);
      if (this.T <= 0 && !this.night) { this.night = true; this.notify("NIGHT. THE SLED COASTS.", 3); this.c.tone(196, 0.5, "sine"); }
    }
    this.vRef += (Math.hypot(r.vx, r.vy) - this.vRef) * (1 - Math.exp(-dt / 2.5));
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
    this.collectSky(r);
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
    const r = this.r, ground = this.gy(r.x);
    // Height above the ground, or above the lowest ground just ahead, so a deep valley stays in view.
    let h = Math.max(0, ground - r.y);
    for (let k = 1; k <= 4; k++) h = Math.max(h, 0.6 * (this.gy(r.x + k * 150) - r.y));
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
    const k = this.fever > 0 ? 1 + this.feverLv : 1;
    this.pts += n * k;
    if (label) this.showTrick(label + "  +" + Math.round(n * k));
  }
  onLand(ev) {
    const r = this.r;
    if (ev.airT < HOP) return; // a skip over a bump is not a landing
    const flight = ev.dist / PX_M;
    this.R.longest = Math.max(this.R.longest, Math.floor(flight));
    if (ev.hi > 240) this.addPoints(Math.floor(ev.hi / 8), "BIG AIR");
    if (this.isPerfect(ev, r.x)) {
      this.chain++;
      this.R.perfects++;
      this.R.chain = Math.max(this.R.chain, this.chain);
      r.v = Math.min(this.topSpeed(), r.v * 1.08 + 60);
      if (!this.zen && !this.night) this.T += PERFECT_T;
      this.addPoints(30 + 20 * Math.min(this.chain, 10), this.fever > 0 ? "FEVER SLIDE" : "PERFECT");
      this.fx.perfect = 0.45;
      this.rings.push({ x: r.x, y: r.y, t: 0, fever: this.fever > 0 });
      if (this.rings.length > 6) this.rings.shift();
      this.c.tone(note(Math.min(9, this.chain)), 0.08, "sine");
      this.c.tone(note(Math.min(9, this.chain)) * 1.5, 0.14, "sine");
      if (this.chain % FEVER_CHAIN === 0 && this.fever > 0 && this.feverLv < FEVER_MAX) {
        // Three more in fever: it rises a level and lasts longer.
        this.feverLv++;
        this.fever = Math.min(this.feverLen() + 2, this.fever + 2);
        this.R.feverLv = Math.max(this.R.feverLv, this.feverLv + 1);
        this.notify("FEVER x" + (this.feverLv + 1), 1.4);
        [659, 784, 988, 1319].slice(0, 1 + this.feverLv).forEach((hz, i) => this.c.tone(hz, 0.06 + 0.03 * i, "triangle"));
      } else if (this.chain % FEVER_CHAIN === 0 && this.fever <= 0) {
        this.fever = this.feverLen();
        this.feverLv = 1;
        this.coilUsed = false;
        this.R.fevers++;
        this.R.feverLv = Math.max(this.R.feverLv, 2);
        this.notify("FEVER x2", 1.6);
        [523, 659, 784, 1047].forEach((hz, i) => this.c.tone(hz, 0.08 + 0.03 * i, "triangle"));
      }
      this.dust(r.x, r.y, 4);
    } else {
      if (this.fever > 0 && this.sv.up.coil && !this.coilUsed && this.chain > 0) {
        // The fever coil catches one miss a fever: the chain holds.
        this.coilUsed = true;
        this.showTrick("COIL HOLDS");
        this.c.tone(523, 0.08, "triangle");
        return;
      }
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
    if (!this.zen) this.T = Math.max(0, this.T - this.fallT());
    this.fx.thud = 0.6;
    this.c.tone(110, 0.25, "sawtooth");
    this.notify(this.zen ? "INTO THE RILLE. RIDE ON." : "INTO THE RILLE: -" + this.fallT() + " S OF DAYLIGHT", 2.2);
    this.dust(r.x, r.y, 10);
  }
  enterZone(zi) {
    this.zone = zi;
    this.R.zone = Math.max(this.R.zone, zi);
    this.zoneT = 2.6;
    this.fx.zone = 0.8;
    if (!this.zen && !this.night && zi > this.startZone) { this.T += ZONE_T[zi]; this.notify("+" + ZONE_T[zi] + " S OF DAYLIGHT", 2.6); }
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
        this.fx.shard = 0.12;
        this.c.tone(note(4 + (this.R.shards % 6)) * 2, 0.04, "sine");
      }
    }
  }
  // Sunstones buy daylight; beacons are found once for good, and a zone's last one pays a bonus.
  collectSky(r) {
    const cy = r.y - 18;
    for (const q of this.suns) {
      if (q.got || Math.abs(q.x - r.x) > 44 || Math.abs(q.y - cy) > 44) continue;
      q.got = 1;
      this.R.suns++;
      this.fx.sun = 0.5;
      if (!this.zen && !this.night) { this.T += SUN_T; this.showTrick("SUNSTONE  +" + SUN_T + " S"); }
      [784, 1175].forEach((hz, i) => this.c.tone(hz, 0.1 + 0.08 * i, "sine"));
    }
    for (const b of this.beacons) {
      if (b.got || Math.abs(b.x - r.x) > 56 || Math.abs(this.beaconY(b) - cy) > 70) continue;
      b.got = 1;
      this.fx.beacon = 0.9;
      if (b.found) { this.addPoints(100, "BEACON"); this.c.tone(988, 0.12, "sine"); continue; }
      b.found = 1;
      this.sv.bc[b.zi] |= 1 << b.k;
      this.R.beacons++;
      this.sv.sh += 30;
      this.addPoints(250, "NEW BEACON");
      const all = this.sv.bc[b.zi] === 7;
      if (all) this.sv.sh += BEACON_SH;
      this.notify(all ? ZONES[b.zi].name + " SURVEYED: +" + (30 + BEACON_SH) + " SHARDS" : "SURVEY BEACON " + beaconCount(this.sv.bc) + " / " + 3 * ZONES.length + "  +30 SHARDS", 3);
      [523, 784, 1047, 1568].forEach((hz, i) => this.c.tone(hz, 0.1 + 0.05 * i, "sine"));
    }
  }
  checkOrders() {
    if (this.daily && !this.goalDone && this.goalMet()) { this.goalDone = true; this.c.dailyMet?.(); this.notify("DAILY GOAL MET", 2.4); this.c.tone(784, 0.2, "sine"); }
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
    if (this.plainRun()) sv.st.bm = Math.max(sv.st.bm, metres);
    sv.st.suns += R.suns;
    if (this.zen) sv.st.zen += metres;
    else sv.st.best = Math.max(sv.st.best, score);
    sv.sh += R.shards;
    sv.far = Math.max(sv.far, R.zone);
    if (this.daily) {
      const key = this.dayKey();
      if (sv.dl.d !== key) { sv.dl.d = key; sv.dl.best = 0; sv.dl.done = 0; }
      sv.dl.best = Math.max(sv.dl.best, score);
      // The streak is the console logbook's now; the game pays the day's goal once in shards.
      if (this.goalDone && !sv.dl.done) { sv.dl.done = 1; sv.sh += DAILY_SH; }
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
    for (const q of this.rings) q.t += dt;
    if (this.rings.length && this.rings[0].t > 0.6) this.rings = this.rings.filter((q) => q.t <= 0.6);
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
  // Three lamps (the first node), left to right:
  //   speed, in the zone's colour, filling up as the sled goes faster (cyan while diving);
  //   in the air green when a landing now would be a perfect slide (amber otherwise), brighter as
  //   the ground comes up, and on the ground the perfect chain toward fever;
  //   daylight: cyan while there is plenty, amber under 15 s, blinking red under 8 s, and a red
  //   blink when a rille is ahead and the sled is too slow to fly it.
  //   Fever is a fast white chase across all three.
  // Four lamps (ctx.lampCount() of 4): the same, but the chain and fever get the third lamp to
  // themselves, so the landing lamp is only ever the landing and stays readable in fever:
  //   speed | landing | chain (green, a step brighter per perfect slide) and fever (white,
  //   pulsing faster at each level, dimming as it runs out) | daylight.
  lampCount() { return this.c.lampCount?.() >= 4 ? 4 : 3; }
  lampValues() {
    const n = this.lampCount(), four = n === 4, zc = ZONES[this.zone].col;
    if (this.phase === "title") return lightsOff(n);
    if (this.phase === "depot") return spot(0.5 + 0.5 * Math.sin(this.t * 0.8), dim(ZONES[this.sv.far].col, 0.14), 0.75, n);
    if (this.phase === "over") return this.fx.end > 0 ? fill(LAMP.blue, 0.3 * (this.fx.end / 0.6), n) : lightsOff(n);
    const r = this.r;
    if (this.fx.record > 0) { const on = blink(1 - this.fx.record, 5); return fill(on ? LAMP.white : LAMP.amber, on ? 0.7 : 0.1, n); }
    if (this.fx.order > 0) return fill(LAMP.amber, 0.5 * pulse(this.fx.order, 3.3), n);
    if (this.fx.thud > 0) return fill(LAMP.amber, 0.35 * blink(this.fx.thud, 8), n);
    if (this.fx.perfect > 0) { // a sweep left to right: perfect
      const k = Math.min(n - 1, Math.floor(((0.45 - this.fx.perfect) / 0.45) * n));
      return lamps(...Array.from({ length: n }, (_, i) => (i <= k ? dim(LAMP.green, i === k ? 0.8 : 0.3) : null)));
    }
    if (this.fx.zone > 0) return fill(zc, 0.45 * (this.fx.zone / 0.8), n);
    if (this.fx.beacon > 0) return fill(LAMP.blue, 0.6 * pulse(this.fx.beacon, 3), n);
    if (this.fx.sun > 0) return lamps(...(four ? [null, null] : [null]), dim(LAMP.amber, 0.4), dim(LAMP.white, 0.8 * (this.fx.sun / 0.5)));
    if (this.fever > 0 && !four) {
      const at = Math.floor(this.runT * (8 + 4 * this.feverLv)) % 3; // the chase quickens with each fever level
      return lamps(...[0, 1, 2].map((i) => dim(i === at ? LAMP.white : LAMP.cyan, i === at ? 0.6 : 0.15)));
    }
    const speed = clamp((Math.hypot(r.vx, r.vy) - 200) / 900, 0, 1);
    const left = dim(this.held && !r.air ? LAMP.cyan : zc, 0.05 + 0.4 * speed);
    const step = this.chain % FEVER_CHAIN, chain = this.chain > 0 ? dim(LAMP.green, 0.1 + 0.15 * step) : null;
    let mid;
    if (r.air) {
      const height = Math.max(0, this.gy(r.x) - r.y);
      const near = this.chasmAt(r.x) ? 0.2 : clamp(1 - height / 260, 0, 1);
      mid = dim(this.perfectNow(r) ? LAMP.green : LAMP.amber, 0.06 + 0.5 * near);
    } else mid = four ? null : chain;
    let right;
    const c = this.chasms.find((q) => !q.done && q.x0 > r.x && q.x0 - r.x < 900);
    if (this.zen) right = null;
    else if (c && !r.air && r.v < RILLE_V) right = dim(LAMP.red, blink(this.t, 6) ? 0.6 : 0.05);
    else if (this.T < 8) right = dim(LAMP.red, blink(this.t, 3) ? 0.6 : 0.08);
    else if (this.T < 15) right = dim(LAMP.amber, 0.25);
    else right = dim(LAMP.cyan, 0.06 + 0.12 * clamp(this.T / 60, 0, 1));
    let out;
    if (four) {
      const left3 = clamp(this.fever / this.feverLen(), 0, 1);
      const third = this.fever > 0 ? dim(LAMP.white, (0.2 + 0.12 * this.feverLv) * (0.4 + 0.6 * left3) * (0.55 + 0.45 * pulse(this.runT, 1.5 + this.feverLv))) : chain;
      out = lamps(left, mid, third, right);
    } else out = lamps(left, mid, right);
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
    const pal = paletteAt(cx / PX_M), dark = !!ZONES[this.zone].dark;
    this.drawSky(g, cx, pal, dark);
    this.drawStreaks(g);
    g.save();
    g.translate(RIDER_X, RIDER_Y);
    g.scale(z, z);
    g.translate(-cx, -cy);
    this.drawGround(g, cx, cy, z);
    this.drawFeatures(g, cx, z, dark);
    this.drawSkyThings(g, cx, z);
    this.drawRings(g, z);
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
  // The sky: the zone's gradient, the stars, the Earth (not on the far side), and three ridges of
  // far hills and crater rims, each a function of world position so nothing pops as it scrolls.
  drawSky(g, cx, pal, dark) {
    g.fillStyle = vgrad(g, 0, 400, pal.sky[0], pal.sky[1]);
    g.fillRect(0, 0, 960, 540);
    g.fillStyle = C.muted;
    for (let i = 0; i < 70; i++) {
      const x = fract(hash1(i * 3.7) - cx * 0.00002 * (1 + (i % 3))) * 960, y = 360 * hash1(i * 1.3);
      g.globalAlpha = (dark ? 0.75 : 0.45) * (0.5 + 0.5 * Math.sin(this.t * (0.6 + hash1(i)) + i));
      const sz = 1 + (i % 3 === 0 ? 1 : 0);
      g.fillRect(x, y, sz, sz);
    }
    g.globalAlpha = 1;
    if (!dark) {
      // The Earth: a lit crescent with a little weather, always in the same place.
      g.fillStyle = "#16303a";
      g.beginPath(); g.arc(770, 104, 40, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#4f8fa8";
      g.beginPath(); g.arc(770, 104, 40, Math.PI * 0.5, Math.PI * 1.5, false); g.arc(756, 104, 38, Math.PI * 1.5, Math.PI * 0.5, true); g.fill();
      g.strokeStyle = "#cfe6ea";
      g.globalAlpha = 0.5; g.lineWidth = 2;
      g.beginPath(); g.arc(770, 104, 30, Math.PI * 0.75, Math.PI * 1.1); g.stroke();
      g.beginPath(); g.arc(770, 104, 20, Math.PI * 0.9, Math.PI * 1.3); g.stroke();
      g.globalAlpha = 1;
      circle(g, 770, 104, 40, "#8fcbc5", false, 1.5);
    } else {
      // The far side: no Earth, a band of the galaxy instead.
      g.globalAlpha = 0.12;
      g.fillStyle = "#8fb4e8";
      g.beginPath(); g.moveTo(0, 220); g.lineTo(960, 40); g.lineTo(960, 110); g.lineTo(0, 300); g.fill();
      g.globalAlpha = 1;
    }
    const layers = [[0.06, 300, 46, pal.far, 0], [0.14, 345, 38, mix(pal.far, pal.mid, 0.5), 1], [0.28, 385, 34, pal.mid, 2]];
    for (const [f, base, amp, col, n] of layers) {
      g.fillStyle = col;
      g.beginPath();
      g.moveTo(0, 560);
      for (let sx = 0; sx <= 960; sx += 16) {
        const wx = (sx + cx * f) / (150 + 40 * n);
        // Rolling ridges, with the odd crater rim (a sharp double bump) on the nearest two.
        const rim = n ? Math.max(0, Math.sin(wx * 0.31 + n)) ** 12 * 30 : 0;
        g.lineTo(sx, base - amp * (Math.sin(wx + n * 2) * 0.6 + Math.sin(wx * 0.37 + 1.3) * 0.4 + 0.2 * Math.sin(wx * 2.3)) - rim);
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
  // The ground, in strips of the zone's colours: deep soil, the topsoil, a lighter band of
  // regolith just under the surface (the stripes that show the hills' shape), and the surface line.
  drawGround(g, cx, cy, z) {
    const x0 = cx - (RIDER_X + 30) / z, x1 = cx + (960 - RIDER_X + 30) / z, step = 10 / z, bottom = cy + (560 - RIDER_Y) / z;
    const band = (a, b, o0, o1, col) => {
      g.fillStyle = col;
      g.beginPath();
      g.moveTo(a, o1 === null ? bottom : this.gy(a) + o1);
      for (let x = a; x < b; x += step) g.lineTo(x, this.gy(x) + o0);
      g.lineTo(b, this.gy(b) + o0);
      if (o1 === null) g.lineTo(b, bottom);
      else for (let x = b; x > a; x -= step) g.lineTo(x, this.gy(x) + o1);
      g.closePath();
      g.fill();
    };
    const piece = (a, b) => {
      if (b <= a) return;
      // One piece per zone. Over a zone's first 80 m its colours blend in from the last zone's, with
      // a gradient fixed to the world, so the ground has no seams.
      for (let c0 = a, c1; c0 < b; c0 = c1) {
        const zi = zoneAt(c0 / PX_M), from = ZONES[zi].from * PX_M, to = from + 80 * PX_M;
        c1 = Math.min(b, zi + 1 < ZONES.length ? ZONES[zi + 1].from * PX_M : Infinity);
        if (c1 <= c0) c1 = Math.min(b, c0 + 200);
        const e1 = c1 + (c1 < b ? 1 / z : 0), cur = SKIES[zi], prev = zi > 0 && c0 < to ? SKIES[zi - 1] : null;
        const col = (k, i) => {
          const end = i === undefined ? cur[k] : cur[k][i];
          return prev ? hgrad(g, from, to, i === undefined ? prev[k] : prev[k][i], end) : end;
        };
        band(c0, e1, 0, null, col("soil", 1));
        band(c0, e1, 0, 90, col("soil", 0));
        band(c0, e1, 20, 36, col("band"));
        band(c0, e1, 58, 64, col("band"));
        g.strokeStyle = col("edge");
        g.lineWidth = 2.5 / z;
        g.beginPath();
        g.moveTo(c0, this.gy(c0));
        for (let x = c0; x < e1; x += step) g.lineTo(x, this.gy(x));
        g.lineTo(e1, this.gy(e1));
        g.stroke();
      }
    };
    let from = x0;
    for (const c of this.chasms) {
      if (c.x1 < x0 || c.x0 > x1) continue;
      piece(from, c.x0);
      g.fillStyle = "#030605";
      g.fillRect(c.x0, Math.min(this.gy(c.x0), this.gy(c.x1)), c.x1 - c.x0, bottom);
      line(g, c.x0, this.gy(c.x0), c.x0 + 6, bottom, C.red, 2 / z);
      line(g, c.x1, this.gy(c.x1), c.x1 - 6, bottom, C.red, 2 / z);
      from = c.x1;
    }
    piece(from, x1);
    // Small craters and stones, fixed to the ground: they show the speed.
    g.fillStyle = "#00000033";
    for (let n = Math.floor(x0 / 90); n * 90 < x1; n++) {
      const wx = n * 90 + 50 * hash1(n);
      if (this.chasmAt(wx) || this.chasmAt(wx + 20)) continue;
      const y = this.gy(wx) + 44 + 60 * hash1(n + 0.5), rr = 3 + 7 * hash1(n + 0.25);
      g.beginPath(); g.ellipse?.(wx, y, rr * 1.6, rr * 0.6, 0, 0, Math.PI * 2); g.fill();
    }
    // The best distance of a run from the start: a flag on the hill.
    const bm = this.sv.st.bm;
    if (this.phase === "play" && this.plainRun() && bm > 50) {
      const fx = this.x0 + bm * PX_M;
      if (fx > x0 && fx < x1) {
        const fy = this.gy(fx);
        line(g, fx, fy, fx, fy - 70, C.ink, 3 / z);
        g.fillStyle = C.amber;
        g.beginPath(); g.moveTo(fx, fy - 70); g.lineTo(fx + 34, fy - 60); g.lineTo(fx, fy - 50); g.fill();
        g.save(); g.translate(fx + 6, fy - 82); g.scale(1 / z, 1 / z); text(g, "BEST " + bm + " m", 0, 0, 16, C.amber); g.restore();
      }
    }
  }
  drawFeatures(g, cx, z, dark) {
    const r = this.r, edge = r.x + (dark ? 900 : 1e9);
    const seen = (x) => (dark ? clamp((edge - x) / 240, 0, 1) : 1);
    const vis = (x) => x > cx - 400 / z && x < cx + 800 / z;
    for (const p of this.pits) {
      if (!vis(p.x0) && !vis(p.x1)) continue;
      g.globalAlpha = Math.max(0.25, seen(p.x0));
      g.fillStyle = "#6a5631";
      for (let x = p.x0; x < p.x1; x += 12) { const y = this.gy(x); g.fillRect(x, y - 4, 7, 6 + 5 * hash1(x)); }
      line(g, p.x0, this.gy(p.x0) - 7, p.x1, this.gy(p.x1) - 7, C.amber, 1.5 / z);
      g.globalAlpha = 1;
    }
    for (const p of this.pads) {
      if (!vis(p.x0) && !vis(p.x1)) continue;
      g.globalAlpha = Math.max(0.25, seen(p.x0));
      for (let x = p.x0, i = 0; x < p.x1; x += 34, i++) {
        const y = this.gy(x) - 12, h = 10 + 4 * Math.sin(this.t * 5 + i);
        diamond(g, x, y, h, p.used ? C.line : "#b48cf0", true);
        if (!p.used) diamond(g, x, y, h + 5, "#e2d4ff", false);
      }
      g.globalAlpha = 1;
    }
    for (const vn of this.vents) {
      if (!vis(vn.x)) continue;
      g.globalAlpha = Math.max(0.25, seen(vn.x));
      const y = this.gy(vn.x);
      g.fillStyle = "#123a36";
      g.fillRect(vn.x - vn.w / 2, y - 6, vn.w, 8);
      if (!vn.used) for (let k = 0; k < 5; k++) {
        const u = fract(this.t * 1.2 + k / 5), px = vn.x + Math.sin(k * 2.1 + this.t * 3) * 12;
        g.globalAlpha = Math.max(0.25, seen(vn.x)) * (1 - u);
        circle(g, px, y - 10 - u * 150, 4 + u * 9, C.cyan, false, 2 / z);
      }
      g.globalAlpha = 1;
    }
    for (const s of this.shards) {
      if (s.got || !vis(s.x)) continue;
      const a = seen(s.x);
      if (a <= 0) continue;
      g.globalAlpha = a;
      const k = Math.sin(this.t * 4 + s.x * 0.01), size = (6 + 1.5 * k) / Math.sqrt(z);
      diamond(g, s.x, s.y, size, C.cyan, true);
      g.globalAlpha = a * 0.35;
      diamond(g, s.x, s.y, size * 1.9, C.cyan, false);
      g.globalAlpha = 1;
    }
  }
  // Sunstones (daylight) and survey beacons (found once for good) hang in the sky.
  drawSkyThings(g, cx, z) {
    const vis = (x) => x > cx - 400 / z && x < cx + 900 / z;
    for (const q of this.suns) {
      if (q.got || !vis(q.x)) continue;
      const rot = this.t * 1.5;
      g.strokeStyle = "#ffd98a";
      g.lineWidth = 2.5 / z;
      g.beginPath();
      for (let k = 0; k < 8; k++) {
        const a = rot + (k * Math.PI) / 4, r0 = 17, r1 = 25 + 4 * Math.sin(this.t * 6 + k);
        g.moveTo(q.x + Math.cos(a) * r0, q.y + Math.sin(a) * r0);
        g.lineTo(q.x + Math.cos(a) * r1, q.y + Math.sin(a) * r1);
      }
      g.stroke();
      circle(g, q.x, q.y, 12, "#ffcf6a", true);
      circle(g, q.x, q.y, 6, "#fff4d6", true);
    }
    for (const b of this.beacons) {
      if (b.got || !vis(b.x)) continue;
      const y = this.beaconY(b), on = blink(this.t + b.k, 1.5);
      // A faint guide line down to the ground, so the beacon can be judged from below.
      g.globalAlpha = 0.25;
      line(g, b.x, y + 22, b.x, this.gy(b.x), b.found ? C.line : "#8fb4e8", 2 / z);
      g.globalAlpha = 1;
      circle(g, b.x, y, 20, b.found ? C.line : "#6fa8dc", false, 3 / z);
      circle(g, b.x, y, 9, b.found ? C.muted : on ? "#e8f4ff" : "#6fa8dc", true);
      if (!b.found) { g.globalAlpha = 0.25 + 0.25 * (on ? 1 : 0); circle(g, b.x, y, 30, "#6fa8dc", false, 2 / z); g.globalAlpha = 1; }
    }
  }
  // An expanding ring where each perfect slide landed.
  drawRings(g, z) {
    for (const q of this.rings) {
      const u = q.t / 0.6;
      g.globalAlpha = Math.max(0, 1 - u);
      circle(g, q.x, q.y, 14 + 90 * u, q.fever ? C.cyan : "#9fdc7a", false, (4 - 3 * u) / z);
    }
    g.globalAlpha = 1;
  }
  drawTrail(g, z) {
    const n = this.trailN;
    if (n < 2 || this.phase === "title" || this.phase === "depot") return;
    g.strokeStyle = this.fever > 0 ? C.cyan : TRAILS[this.sv.sel.trail]?.col || C.amber;
    for (let i = TRAIL - n + 1; i < TRAIL; i++) {
      const k = (i - (TRAIL - n)) / n;
      g.globalAlpha = k * (this.fever > 0 ? 1 : 0.8);
      g.lineWidth = ((this.fever > 0 ? 3 : 1) + 5 * k) / z;
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
  // The survey sled: curved runners, a cab with a lit window, an antenna with its light. It squats
  // while diving and glows in fever.
  drawRider(g, x, y, a) {
    const diving = this.held && this.phase === "play", fever = this.fever > 0 && this.phase === "play";
    if (fever) {
      const glow = g.createRadialGradient?.(x, y - 20, 4, x, y - 20, 70);
      if (glow?.addColorStop) {
        glow.addColorStop(0, "rgba(143,203,197,0.45)");
        glow.addColorStop(1, "rgba(143,203,197,0)");
        g.fillStyle = glow;
        g.fillRect(x - 70, y - 90, 140, 140);
      }
    }
    const runner = diving || fever ? C.cyan : C.amber;
    g.save();
    g.translate(x, y);
    g.rotate(a);
    g.scale(1.3, diving ? 1.05 : 1.3); // squats when diving
    g.strokeStyle = runner;
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(-24, -2); g.lineTo(20, -2); g.quadraticCurveTo?.(29, -2, 30, -10); g.stroke();
    line(g, -12, -2, -10, -7, runner, 2);
    line(g, 10, -2, 8, -7, runner, 2);
    g.fillStyle = C.ink;
    g.fillRect(-16, -26, 30, 19);
    g.fillStyle = "#b9d98a";
    g.fillRect(-16, -9, 30, 3);
    g.fillStyle = fever ? "#dff8f4" : "#8fcbc5";
    g.fillRect(2, -22, 9, 8);
    g.fillStyle = C.bg;
    g.fillRect(-11, -21, 8, 4);
    line(g, -9, -26, -13, -40, C.ink, 2);
    circle(g, -13, -42, 3.5, fever ? C.cyan : blink(this.t, 2) ? C.amber : "#8a6a3e", true);
    g.restore();
  }
  drawPlay(g) {
    if (this.zoneT > 0) {
      const z = ZONES[this.zone];
      g.globalAlpha = Math.min(1, this.zoneT * 2);
      text(g, z.roman + "   " + z.name, 480, 70, 30, z.ink, "center");
      text(g, z.text, 480, 104, 20, C.muted, "center");
      g.globalAlpha = 1;
    } else if (this.noticeT > 0) text(g, this.notice, 480, 52, 22, this.notice.startsWith("FEVER") ? C.cyan : C.amber, "center");
    if (this.trickT > 0) text(g, this.trick, 480, 150, 26, this.trick === "THUD" ? C.red : C.cyan, "center");
    // The perfect chain toward fever, and the fever meter.
    if (this.fever > 0) {
      text(g, "FEVER x" + (this.feverLv + 1), 40, 500, 20, C.cyan);
      line(g, 160, 500, 160 + 160 * clamp(this.fever / this.feverLen(), 0, 1), 500, C.cyan, 6);
      for (let i = 0; i < FEVER_CHAIN; i++) diamond(g, 346 + i * 22, 500, 7, this.feverLv < FEVER_MAX && i < this.chain % FEVER_CHAIN ? C.cyan : C.line, true);
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
    text(g, "LEVEL " + this.sv.lv + "     SURVEY ORDERS", 480, 226, 20, C.amber, "center");
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
      text(g, "LEVEL " + this.levelled.lv + "   +" + this.levelled.bonus + " SHARDS", 480, y, 24, C.cyan, "center"); y += 32;
      if (this.levelled.unlocks.length) { text(g, "UNLOCKED  " + this.levelled.unlocks.join(", "), 480, y, 18, C.cyan, "center"); y += 30; }
      text(g, "NEW ORDERS", 480, y + 4, 18, C.amber, "center"); y += 36;
    } else if (this.daily) {
      text(g, this.goalDone ? "DAILY GOAL MET  +" + DAILY_SH + " SHARDS" : "DAILY: " + dailyGoal(this.dayKey()).text, 480, y, 18, this.goalDone ? C.cyan : C.muted, "center"); y += 32;
    }
    this.drawOrders(g, y, 18);
    if (this.overT > LOCK) text(g, this.sv.runs >= 2 ? "TAP = RIDE AGAIN     HOLD = DEPOT" : "PRESS TO RIDE AGAIN", 480, 476, 18, C.amber, "center");
  }
  drawDepot(g) {
    this.card(g, 36, 506);
    text(g, "DEPOT", 480, 78, 34, C.amber, "center");
    text(g, "LEVEL " + this.sv.lv + "     " + this.sv.sh + " SHARDS", 480, 112, 18, C.muted, "center");
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
        LOG: "BEACONS " + beaconCount(sv.bc) + " / " + 3 * ZONES.length,
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
      else if (id === "DAILY") { const gl = dailyGoal(this.dayKey()); info = "Today: " + gl.text; }
      else if (id === "WORKSHOP") info = "Magnet, grapple and fever coil.";
      else if (id === "ORDERS") info = "Meet all three to reach the next level.";
      else info = "Zones, beacons found, and the expedition's totals.";
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
      text(g, "FEVERS " + st.fevers + "   RILLES " + st.chasms + "   SUNSTONES " + st.suns + "   BEST " + st.bm + " m", 480, 178, 18, C.cyan, "center");
      ZONES.forEach((zz, i) => {
        const y = 222 + i * 34, got = i <= sv.far;
        text(g, zz.roman + "  " + zz.name.slice(4), 160, y, 20, got ? zz.ink : C.line);
        const m = sv.bc[i];
        text(g, [0, 1, 2].map((k) => ((m >> k) & 1 ? "◆" : "◇")).join(" "), 520, y, 18, m === 7 ? C.cyan : got ? C.muted : C.line);
        text(g, got ? (m === 7 ? "SURVEYED" : "REACHED") : "FROM " + zz.from + " m", 800, y, 18, got ? C.amber : C.line, "right");
      });
      text(g, RIDES.map((rd, i) => rd.name + " " + (rd.lv <= sv.lv ? sv.pb[i] : "-")).join("   "), 480, 440, 18, C.muted, "center");
      text(g, "TAP = BACK", 480, 480, 18, C.cyan, "center");
    }
  }
}
