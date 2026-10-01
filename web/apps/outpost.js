// OUTPOST — a one-button incremental game. A lone survey station gathers signal.
// Tap to gather by hand; hold to open the build ring (taps step through what can be
// bought, a hold-and-release buys). Signal buys machines, machines unlock better machines,
// upgrades and synergies multiply them, "relocating" trades the whole station for permanent
// bearings and a small tree of lasting bonuses, and after that come expeditions on wall-clock
// timers and rare signal flares. The station keeps working while the game is closed: the
// next launch credits the production earned meanwhile (capped, and the cap can be raised).
//
// Numbers are plain doubles clamped to BIG (1e150) everywhere they can grow, so nothing
// reaches Infinity or NaN. The save is one small JSON object (schema 2).
// The three lamps are the status board: left breathes with production, middle fills toward
// the next purchase and goes steady green when one is affordable, right shows the timed
// thing (flare, boost, expedition) or that relocation is worth doing.
import { C, space, text, line, circle, diamond, banner, wrapText } from "../engine/draw.js";
import { TAU, clamp } from "../engine/math.js";
import { LAMP, lamps, dim, pulse, blink, spot, lightsOff } from "../engine/lightshow.js";

// ---- constants ---------------------------------------------------------------
const SCHEMA = 2;
const BIG = 1e150; // every growing number is clamped here
const GROWTH = 1.15; // cost growth per machine owned
const MAX_OWN = 1500;
const MILESTONES = [10, 25, 50, 100, 150, 200, 250, 300]; // owned counts that double a machine
const PRESTIGE_K = 1.2e5; // run signal at which one bearing is earned (gain = floor((run / K) ^ 0.25))
const READY_MIN = 8; // bearings worth relocating for (and at least a quarter of those already held)
const BASE_CAP_H = 8; // offline credit cap in hours, before upgrades
const AWAY_MIN = 45; // seconds away before a summary is shown
const HOLD_OPEN = 0.42; // seconds held (outside the ring) to open the ring
const HOLD_BUY = 0.45; // seconds held (inside the ring) to choose
const HOLD_BIG = 1.2; // seconds held to relocate
const DWELL = 0.7; // an entry must have been highlighted this long before a hold can choose it
const DWELL_BIG = 1.2;
const RING_IDLE = 7; // seconds without input before the ring closes itself
const DIM_AFTER = 180; // seconds without input before the lamps drop to their dim version
const SAVE_EVERY = 15; // seconds between autosaves
const SAVE_GAP = 1.5; // minimum seconds between event saves
const FLARE_LIFE = 14;
const FLOATERS = 12;
const QUEUE_MAX = 16;

const PROD = [
  { n: "RECEIVER DISH", c: 10, r: 0.2, fx: "listens to the sky" },
  { n: "RELAY MAST", c: 100, r: 1.2, fx: "boosts weak carriers" },
  { n: "CORE DRILL", c: 1100, r: 8, fx: "taps the buried hum" },
  { n: "ARRAY FIELD", c: 12000, r: 47, fx: "phased dishes in rows" },
  { n: "BOREHOLE", c: 130000, r: 260, fx: "listens through rock" },
  { n: "OBSERVATORY", c: 1.4e6, r: 1400, fx: "long watches of the sky" },
  { n: "ARCHIVE VAULT", c: 2e7, r: 7800, fx: "mines old recordings" },
  { n: "ECHO CHAMBER", c: 3.3e8, r: 44000, fx: "makes silence speak" },
  { n: "PHASE LATTICE", c: 5.1e9, r: 260000, fx: "steers the whole survey" },
  { n: "DEEP-SKY ARRAY", c: 7.5e10, r: 1.6e6, fx: "hears the far dark" },
];
const NP = PROD.length;
const PROD_UPG_NAMES = [
  ["LOW-NOISE FEED", "PARABOLIC TRIM", "CRYO RECEIVER"],
  ["GUY WIRES", "PHASED DIPOLE", "SPREAD SPECTRUM"],
  ["DIAMOND BIT", "MUD CIRCULATION", "SONIC HAMMER"],
  ["FINE ALIGNMENT", "CORRELATOR", "SKY SURVEY"],
  ["DEEP CASING", "GEOPHONES", "MAGMA TAP"],
  ["CLEAR SKIES", "LONG EXPOSURE", "INTERFEROMETER"],
  ["INDEXING", "TAPE ROBOTS", "CROSS-REFERENCE"],
  ["ACOUSTIC TILE", "STANDING WAVES", "RESONANT CAVITY"],
  ["PHASE LOCK", "COHERENT BEAMS", "NULL STEERING"],
  ["CRYO ARRAYS", "LONG BASELINE", "STAR CHART"],
];

// Every one-time upgrade, in a fixed order (the save stores indices into this list).
// kind: prod (x2 one machine), tap (tap x2 or +fraction of rate), cap (offline hours),
// grid (x1.3 everything), syn (dst machines gain per source owned).
const UPG = [];
const addUpg = (u) => UPG.push({ idx: UPG.length, ...u });
const tierReq = [1, 10, 30], tierCost = [10, 150, 3000];
const PROD_UPG = PROD.map(() => []);
PROD.forEach((p, i) => {
  for (let k = 0; k < 3; k++) {
    PROD_UPG[i].push(UPG.length);
    addUpg({ kind: "prod", i, name: PROD_UPG_NAMES[i][k], cost: p.c * tierCost[k], need: tierReq[k], eff: "x2 " + p.n + " OUTPUT" });
  }
});
addUpg({ kind: "tap", name: "STEADY KEY", cost: 80, rt: 30, mult: 2, eff: "x2 PER TAP" });
addUpg({ kind: "tap", name: "FAST CONTACT", cost: 2500, rt: 1000, mult: 2, eff: "x2 PER TAP" });
addUpg({ kind: "tap", name: "TAP LINK", cost: 80000, rt: 3e4, frac: 0.01, eff: "EACH TAP ADDS 1% OF RATE" });
addUpg({ kind: "tap", name: "MAGNETIC KEY", cost: 4e7, rt: 1e7, mult: 2, eff: "x2 PER TAP" });
addUpg({ kind: "tap", name: "TAP RESONANCE", cost: 3e9, rt: 1e9, frac: 0.04, eff: "EACH TAP ADDS 4% OF RATE" });
addUpg({ kind: "cap", name: "BATTERY BANK I", cost: 2e5, rt: 5e4, hours: 4, eff: "AWAY CREDIT CAP +4 H" });
addUpg({ kind: "cap", name: "BATTERY BANK II", cost: 4e7, rt: 1e7, hours: 12, eff: "AWAY CREDIT CAP +12 H" });
addUpg({ kind: "cap", name: "BATTERY BANK III", cost: 8e9, rt: 2e9, hours: 24, eff: "AWAY CREDIT CAP +24 H" });
addUpg({ kind: "grid", name: "GRID SYNC I", cost: 3e6, rt: 1e6, eff: "x1.3 ALL OUTPUT" });
addUpg({ kind: "grid", name: "GRID SYNC II", cost: 4e9, rt: 1e9, eff: "x1.3 ALL OUTPUT" });
addUpg({ kind: "grid", name: "GRID SYNC III", cost: 5e12, rt: 1e12, eff: "x1.3 ALL OUTPUT" });
const SYN = [];
for (let i = 0; i < NP - 1; i++) {
  const src = i + 1;
  SYN.push({ idx: UPG.length, src, dst: i });
  addUpg({ kind: "syn", src, dst: i, name: PROD[src].n.split(" ")[0] + " LINK", cost: PROD[src].c * 40, need: 5, per: 0.02,
    eff: PROD[i].n + " +2% PER " + PROD[src].n });
}
const NUP = UPG.length;
const GRID_IDX = UPG.filter((u) => u.kind === "grid").map((u) => u.idx);
const SYN_BY_DST = PROD.map((_, i) => SYN.filter((s) => s.dst === i));

// The bearing tree. cost(level) is what the next level costs; req is the lifetime bearings
// needed before the node is shown.
const TREE = [
  { n: "HEAD START", max: 5, req: 0, cost: (l) => 2 * 2 ** l, eff: (l) => "START EACH RUN WITH A BUILT STATION (LEVEL " + (l + 1) + ")" },
  { n: "SURE HANDS", max: 4, req: 0, cost: (l) => 2 ** l, eff: () => "x2 PER TAP" },
  { n: "BULK RATE", max: 5, req: 0, cost: (l) => 3 * 2 ** l, eff: () => "MACHINES COST 6% LESS" },
  { n: "DEEP STORAGE", max: 4, req: 0, cost: (l) => 2 * 3 ** l, eff: () => "AWAY CREDIT CAP +4 H" },
  { n: "AUTOBUILD", max: 3, req: 6, cost: (l) => 6 * 3 ** l, eff: (l) => "BUYS THE CHEAPEST MACHINE EVERY " + [12, 6, 3][l] + " S" + (l ? " AND UPGRADES" : "") },
  { n: "SURVEY TEAM", max: 3, req: 6, cost: (l) => 3 * 5 ** l, eff: (l) => (l ? "ONE MORE EXPEDITION AT A TIME" : "UNLOCKS EXPEDITIONS") },
  { n: "CLEAR LENS", max: 5, req: 10, cost: (l) => 5 * 3 ** l, eff: () => "EACH BEARING GIVES +4% MORE" },
  { n: "FLARE SENSORS", max: 3, req: 15, cost: (l) => 4 * 3 ** l, eff: () => "FLARES COME SOONER AND STAY LONGER" },
  { n: "RESONANCE", max: 3, req: 25, cost: (l) => 8 * 3 ** l, eff: () => "LINK UPGRADES +50% STRONGER" },
  { n: "LONG BASELINE", max: 4, req: 40, cost: (l) => 10 * 4 ** l, eff: () => "x1.25 ALL OUTPUT" },
];
const NT = TREE.length;
const KIT = [[], [10, 4], [25, 15, 5, 2], [40, 30, 18, 10, 4], [60, 45, 30, 20, 10, 3], [80, 60, 45, 32, 20, 8, 2]];
const KIT_SIGNAL = [0, 1000, 30000, 600000, 1.2e7, 3e8];
const AUTO_EVERY = [0, 12, 6, 3];
const EXPED = [
  { n: "SHORT SURVEY", sec: 180, mins: 1.3, relic: 0 },
  { n: "FIELD TRAVERSE", sec: 1200, mins: 10, relic: 0.1 },
  { n: "DEEP SURVEY", sec: 5400, mins: 54, relic: 0.35 },
];
const MAX_RELICS = 20;
const SUFFIX = ["", "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc"];
const SCALE = [262, 294, 330, 392, 440, 523, 587, 659];

// ---- pure economy ------------------------------------------------------------
const num = (x, hi = BIG) => (Number.isFinite(x) ? clamp(x, 0, hi) : x > 0 ? hi : 0);
const int = (x, hi) => Math.floor(num(Number(x), hi));

function fmt(n) {
  if (!(n > 0)) return "0";
  if (!Number.isFinite(n)) return "MAX";
  if (n < 10) return (Math.floor(n * 10) / 10).toFixed(1);
  if (n < 1000) return String(Math.floor(n));
  let e = Math.floor(Math.log10(n) / 3);
  if (e >= SUFFIX.length) {
    const x = Math.floor(Math.log10(n));
    return (Math.floor((n / 10 ** x) * 100) / 100).toFixed(2) + "e" + x;
  }
  let v = n / 1000 ** e;
  const places = v < 10 ? 2 : v < 100 ? 1 : 0;
  v = Math.floor(v * 10 ** places) / 10 ** places;
  if (v >= 1000 && e < SUFFIX.length - 1) { e++; v = 1; }
  return v.toFixed(places) + " " + SUFFIX[e];
}
const fmtRate = (n) => (n > 0 && n < 1 ? n.toFixed(2) : fmt(n));
function dur(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h) return h + " H " + String(m).padStart(2, "0") + " M";
  if (m) return m + " M " + String(s).padStart(2, "0") + " S";
  return s + " S";
}
const clock = (sec) => { sec = Math.max(0, Math.ceil(sec)); return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0"); };

const costOf = (s, i, n = s.own[i]) => Math.ceil(PROD[i].c * Math.pow(GROWTH, Math.min(n, MAX_OWN)) * Math.pow(0.94, s.tree[2]));
const milestonesAt = (n) => MILESTONES.filter((m) => n >= m).length;
const nextMilestone = (n) => MILESTONES.find((m) => n < m) || 0;
const globalMult = (s) => {
  let g = (1 + s.L * (0.2 + 0.04 * s.tree[6])) * (1 + 0.25 * s.tree[9]) * (1 + 0.03 * s.relics);
  for (const k of GRID_IDX) if (s.up[k]) g *= 1.3;
  return num(g);
};
function prodMult(s, i) {
  let m = 2 ** milestonesAt(s.own[i]);
  for (const k of PROD_UPG[i]) if (s.up[k]) m *= 2;
  let add = 0;
  for (const y of SYN_BY_DST[i]) if (s.up[y.idx]) add += 0.02 * s.own[y.src] * (1 + 0.5 * s.tree[8]);
  return num(m * (1 + add));
}
// Fills out[i] with each machine's output per second and returns the total.
function evaluate(s, out) {
  const g = globalMult(s);
  let total = 0;
  for (let i = 0; i < NP; i++) {
    const v = num(s.own[i] * PROD[i].r * prodMult(s, i) * g);
    if (out) out[i] = v;
    total += v;
  }
  return num(total);
}
function tapParts(s) {
  let mult = 2 ** s.tree[1], frac = 0;
  for (const u of UPG) if (u.kind === "tap" && s.up[u.idx]) { mult *= u.mult || 1; frac += u.frac || 0; }
  return { mult, frac };
}
const capHours = (s) => {
  let h = BASE_CAP_H + 4 * s.tree[3];
  for (const u of UPG) if (u.kind === "cap" && s.up[u.idx]) h += u.hours;
  return h;
};
const pendingOf = (s) => int(Math.pow(s.rt / PRESTIGE_K, 0.25), 1e9);
const revealOf = (s) => { const p = pendingOf(s); return p >= 3 || (s.runs > 0 && p >= 1); };
const readyOf = (s) => { const p = pendingOf(s); return p >= READY_MIN && p >= 0.25 * s.L; };
const slotsOf = (s) => (s.tree[5] ? s.tree[5] : 0);

function upgradeVisible(s, u) {
  if (s.up[u.idx]) return false;
  const rtNeed = u.rt ?? 0;
  if (s.rt < Math.max(rtNeed, 0.2 * u.cost)) return false;
  if (u.kind === "prod") return s.own[u.i] >= u.need;
  if (u.kind === "syn") return s.own[u.src] >= u.need && s.own[u.dst] >= u.need;
  return true;
}
function prodVisible(s, i) {
  if (s.own[i] > 0) return true;
  return i <= s.maxTier + 1 && s.rt >= 0.3 * costOf(s, i);
}

function freshState() {
  return { sig: 0, rt: 0, lt: 0, own: Array(NP).fill(0), up: new Uint8Array(NUP), taps: 0, b: 0, L: 0, tree: Array(NT).fill(0),
    relics: 0, runs: 0, maxTier: 0, ex: [], play: 0, last: {}, milestone: 0, extra: null };
}
function applyKit(s) {
  const l = s.tree[0], kit = KIT[l] || [];
  let added = 0;
  kit.forEach((n, i) => { if (s.own[i] < n) { added += n - s.own[i]; s.own[i] = n; s.maxTier = Math.max(s.maxTier, i); } });
  return added;
}

// ---- saving -------------------------------------------------------------------
const KNOWN = new Set(["v", "t", "sig", "rt", "lt", "own", "up", "taps", "b", "L", "tree", "relics", "runs", "maxTier", "ex", "play", "last", "milestone"]);
function serialize(s, t) {
  const out = { v: SCHEMA, t, sig: num(s.sig), rt: num(s.rt), lt: num(s.lt), own: s.own.slice(), up: [], taps: s.taps, b: s.b, L: s.L,
    tree: s.tree.slice(), relics: s.relics, runs: s.runs, maxTier: s.maxTier, ex: s.ex.map((e) => [e.k, e.end]), play: Math.floor(s.play),
    last: s.last, milestone: s.milestone };
  for (let i = 0; i < NUP; i++) if (s.up[i]) out.up.push(i);
  if (s.extra && JSON.stringify(s.extra).length < 1500) Object.assign(out, s.extra);
  return out;
}
// Older shapes: schema 1 (the prototype) stored flat names; it is mapped onto schema 2.
function fromV1(raw) {
  const up = [];
  if (typeof raw.upg === "string") for (let i = 0; i < raw.upg.length; i++) if (raw.upg[i] === "1") up.push(i);
  const total = Number(raw.total ?? raw.signal) || 0;
  return { v: 2, t: raw.ts ?? raw.t, sig: raw.signal, rt: total, lt: total, own: raw.prod ?? raw.owned, up, taps: raw.taps,
    b: raw.bearings, L: raw.bearings, runs: raw.relocs };
}
// Returns { s, t } with a fully sanitised state; never throws, never wipes on bad input.
function migrate(raw) {
  const s = freshState();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { s, t: 0, fresh: true };
  const v = Number(raw.v) || 0;
  let r = raw;
  if (v < 2) r = fromV1(raw);
  s.sig = num(Number(r.sig)); s.rt = num(Number(r.rt)); s.lt = Math.max(num(Number(r.lt)), s.rt);
  if (Array.isArray(r.own)) for (let i = 0; i < NP; i++) s.own[i] = int(r.own[i], MAX_OWN);
  if (Array.isArray(r.up)) for (const k of r.up) { const i = Math.floor(Number(k)); if (i >= 0 && i < NUP) s.up[i] = 1; }
  s.taps = int(r.taps, 1e12); s.b = int(r.b, 1e9); s.L = Math.max(int(r.L, 1e9), s.b);
  if (Array.isArray(r.tree)) for (let i = 0; i < NT; i++) s.tree[i] = int(r.tree[i], TREE[i].max);
  s.relics = int(r.relics, MAX_RELICS); s.runs = int(r.runs, 1e6); s.play = int(r.play, 1e9); s.milestone = int(r.milestone, 1e9);
  s.maxTier = int(r.maxTier, NP - 1);
  for (let i = 0; i < NP; i++) if (s.own[i] > 0) s.maxTier = Math.max(s.maxTier, i);
  if (Array.isArray(r.ex)) for (const e of r.ex.slice(0, 3)) if (Array.isArray(e) && e[0] >= 0 && e[0] < EXPED.length) s.ex.push({ k: Math.floor(e[0]), end: num(Number(e[1]), 1e15) });
  if (r.last && typeof r.last === "object" && !Array.isArray(r.last)) {
    for (const key of Object.keys(r.last).slice(0, 6)) { const val = r.last[key]; if (typeof val === "number" || typeof val === "string") s.last[key] = typeof val === "string" ? val.slice(0, 24) : val; }
  }
  if (v > SCHEMA) {
    const extra = {};
    for (const key of Object.keys(raw)) if (!KNOWN.has(key)) extra[key] = raw[key];
    s.extra = extra;
  }
  return { s, t: num(Number(r.t), 1e15), future: v > SCHEMA };
}

// ---- the cartridge -----------------------------------------------------------
export class Outpost {
  constructor(ctx) {
    this.c = ctx;
    const loaded = migrate(ctx.progress?.());
    this.s = loaded.s;
    this.out = new Float64Array(NP);
    this.act = new Float64Array(NP); // smoothed 0..1 activity per machine (for motion)
    this.phase = new Float64Array(NP);
    this.flash = new Float64Array(NP); // purchase flash per machine
    this.t = 0;
    this.clk = 0; // game-seconds, advances in update()
    this.down_ = false;
    this.downAt = 0;
    this.downAge = 0;
    this.consume = false;
    this.ring = null;
    this.entries = [];
    this.idle = 0;
    this.dimK = 1;
    this.breath = 0;
    this.flick = 0;
    this.accent = null;
    this.flare = null;
    this.flareIn = 50;
    this.boosts = [];
    this.note = null;
    this.floats = Array.from({ length: FLOATERS }, () => ({ x: 0, y: 0, life: 0, v: "" }));
    this.queue = [];
    this.saveIn = SAVE_EVERY;
    this.saveCool = 0;
    this.savePending = false;
    this.autoIn = 0;
    this.secIn = 1;
    this.simSince = 0;
    this.lastLevel = -1;
    this.hudKey = "";
    this.hintKey = "";
    this.readyBlip = 0;
    this.wasAfford = false;
    this.cardT = 0;
    this.card = null;
    this.away = null;
    this.stars = 0;
    this.wallRef = Date.now();
    this.dirty = true;
    this.recalcIn = 0;
    this.rate = 0;
    this.affordN = 0;
    this.goalFrac = 0;
    this.goalName = "";

    // Offline credit: wall-clock time since the save, capped; a clock that went backwards
    // (or a save stamped in the future) earns nothing and loses nothing.
    const now = this.wallRef;
    this.recalc();
    let note = "";
    let sec = 0;
    if (!loaded.fresh && loaded.t > 0) {
      sec = (now - loaded.t) / 1000;
      if (!(sec >= 0) || loaded.t > now + 60000) { note = "CLOCK MOVED BACKWARDS - NO CREDIT"; sec = 0; }
    }
    const summary = this.creditAway(sec);
    this.collectExpeditions(now, summary);
    if (summary.sec >= AWAY_MIN || summary.found.length || note) {
      summary.note = note;
      this.away = summary;
      this.phase_ = "away";
    } else this.phase_ = loaded.fresh || (this.s.lt === 0 && this.s.taps === 0) ? "intro" : "play";
    this.updateHud(true);
    this.setHint();
    this.c.leds(this.lampValues());
  }

  // ---- derived state -----------------------------------------------------------
  recalc() {
    this.dirty = false;
    this.rate = evaluate(this.s, this.out);
    const tp = tapParts(this.s);
    this.tapMult = tp.mult;
    this.tapFrac = tp.frac;
    this.items = this.visibleItems();
    this.affordN = this.items.filter((it) => it.cost <= this.s.sig).length;
    let goal = null;
    for (const it of this.items) if (it.cost > this.s.sig && (!goal || it.cost < goal.cost)) goal = it;
    this.goalFrac = goal ? clamp(this.s.sig / goal.cost, 0, 1) : 1;
    this.goalName = goal ? goal.name : "";
    this.goalCost = goal ? goal.cost : 0;
  }
  surge() { let m = 1; for (const b of this.boosts) if (b.k === "surge") m = Math.max(m, b.mult); return m; }
  frenzy() { let m = 1; for (const b of this.boosts) if (b.k === "frenzy") m = Math.max(m, b.mult); return m; }
  effRate() { return num(this.rate * this.surge()); }
  tapValue() {
    const v = (this.tapMult * globalMult(this.s) + this.tapFrac * this.rate) * this.frenzy();
    return Math.max(1, num(v));
  }
  pending() { return pendingOf(this.s); }
  visibleItems() {
    const s = this.s, list = [];
    for (let i = 0; i < NP; i++) if (prodVisible(s, i)) list.push({ type: "p", i, key: "p" + i, name: PROD[i].n, cost: costOf(s, i) });
    for (const u of UPG) if (upgradeVisible(s, u)) list.push({ type: "u", i: u.idx, key: "u" + u.idx, name: u.name, cost: u.cost });
    return list;
  }
  gainOf(it) {
    const s = this.s, base = this.rate;
    if (it.type === "p") {
      s.own[it.i]++;
      const after = evaluate(s, null);
      s.own[it.i]--;
      return (after - base) / it.cost;
    }
    s.up[it.i] = 1;
    const after = evaluate(s, null);
    s.up[it.i] = 0;
    return (after - base) / it.cost + 1e-12;
  }

  // ---- economy actions ---------------------------------------------------------
  gain(x) {
    x = num(x);
    const s = this.s;
    s.sig = Math.min(BIG, s.sig + x);
    s.rt = Math.min(BIG, s.rt + x);
    s.lt = Math.min(BIG, s.lt + x);
  }
  buyProd(i) {
    const s = this.s;
    if (!(i >= 0 && i < NP) || s.own[i] >= MAX_OWN) return false;
    const cost = costOf(s, i);
    if (s.sig < cost) return false;
    const before = milestonesAt(s.own[i]);
    s.sig -= cost;
    s.own[i]++;
    s.maxTier = Math.max(s.maxTier, i);
    this.flash[i] = 1;
    this.dirty = true;
    this.recalc();
    if (milestonesAt(s.own[i]) > before) this.milestoneFx(PROD[i].n + " x" + s.own[i] + ": OUTPUT DOUBLED");
    return true;
  }
  buyUpg(idx) {
    const s = this.s, u = UPG[idx];
    if (!u || s.up[idx] || s.sig < u.cost) return false;
    s.sig -= u.cost;
    s.up[idx] = 1;
    this.dirty = true;
    this.recalc();
    return true;
  }
  // Greedy: affordable upgrades first (best gain per cost), then machines by gain per cost.
  buyAll() {
    let n = 0;
    for (let guard = 0; guard < 600; guard++) {
      const aff = this.items.filter((it) => it.cost <= this.s.sig);
      if (!aff.length) break;
      let best = null, bestG = -1;
      for (const it of aff) {
        const g = this.gainOf(it) * (it.type === "u" ? 1.5 : 1);
        if (g > bestG) { bestG = g; best = it; }
      }
      if (!best || !(best.type === "p" ? this.buyProd(best.i) : this.buyUpg(best.i))) break;
      n++;
    }
    return n;
  }
  buyNode(k) {
    const s = this.s, nd = TREE[k];
    if (!nd || s.tree[k] >= nd.max) return false;
    const cost = nd.cost(s.tree[k]);
    if (s.b < cost) return false;
    s.b -= cost;
    s.tree[k]++;
    if (k === 0) this.applyKitNow();
    this.dirty = true;
    this.recalc();
    return true;
  }
  applyKitNow() {
    const s = this.s;
    s.sig += KIT_SIGNAL[s.tree[0]] - KIT_SIGNAL[Math.max(0, s.tree[0] - 1)];
    applyKit(s);
  }
  relocate() {
    const s = this.s, p = this.pending();
    if (p < 1) return false;
    const stats = { signal: fmt(s.lt), bearings: s.L + p, relocations: s.runs + 1 };
    this.card = { gain: p, run: s.rt, secs: s.play, total: s.L + p };
    s.b = Math.min(1e9, s.b + p);
    s.L = Math.min(1e9, s.L + p);
    s.runs++;
    s.milestone = s.L;
    s.last = stats;
    s.own.fill(0);
    s.up.fill(0);
    s.sig = KIT_SIGNAL[s.tree[0]];
    s.rt = 0;
    s.ex = [];
    s.play = 0;
    applyKit(s);
    this.boosts.length = 0;
    this.flare = null;
    this.flareIn = 40;
    this.ring = null;
    this.phase_ = "card";
    this.cardT = 0;
    this.accent = { k: "prestige", t: 0, dur: 2.4 };
    this.arp([392, 523, 659, 784, 1047, 1319], 0.1, 0.35, "sine");
    this.dirty = true;
    this.recalc();
    this.save(true);
    return true;
  }
  // Credit production earned while closed (or paused for long). Returns the summary.
  creditAway(sec) {
    const cap = capHours(this.s) * 3600;
    const sum = { sec: 0, gain: 0, capped: false, found: [], relics: 0, note: "" };
    if (!(sec > 0)) return sum;
    const used = Math.min(sec, cap);
    sum.capped = sec > cap;
    sum.sec = used;
    sum.gain = num(this.rate * used);
    this.gain(sum.gain);
    this.dirty = true;
    return sum;
  }
  collectExpeditions(now, sum) {
    const s = this.s;
    const keep = [];
    for (const e of s.ex) {
      const x = EXPED[e.k];
      if (e.end > now + x.sec * 1000 + 60000) e.end = now + x.sec * 1000; // clock went backwards: never wait longer than the trip
      if (now >= e.end) {
        const reward = num(this.rate * x.mins * 60);
        this.gain(reward);
        let relic = false;
        if (s.relics < MAX_RELICS && this.c.rng.next() < x.relic) { s.relics++; relic = true; }
        const rec = { name: x.n, reward, relic };
        if (sum) sum.found.push(rec);
        else this.expeditionBack(rec);
      } else keep.push(e);
    }
    s.ex = keep;
    this.dirty = true;
  }
  expeditionBack(rec) {
    this.setNote(rec.name + " RETURNED: +" + fmt(rec.reward) + (rec.relic ? " AND A RELIC" : ""), 5);
    this.accent = { k: "event", t: 0, dur: 0.7 };
    this.arp(rec.relic ? [659, 784, 988, 1319] : [587, 784, 988], 0.09, 0.25, "sine");
    this.save(true);
  }
  launch(k) {
    const s = this.s, x = EXPED[k];
    if (!x || !s.tree[5] || s.ex.length >= slotsOf(s)) return false;
    s.ex.push({ k, end: Date.now() + x.sec * 1000 });
    this.arp([330, 392, 494], 0.08, 0.2, "triangle");
    this.save(true);
    return true;
  }

  // ---- effects ------------------------------------------------------------------
  setNote(textValue, secs = 3) { this.note = { text: textValue, t: secs }; }
  milestoneFx(label) {
    this.accent = { k: "milestone", t: 0, dur: 0.9 };
    this.setNote("MILESTONE - " + label, 3.5);
    this.arp([523, 659, 784, 1047, 1319], 0.07, 0.3, "triangle");
  }
  arp(notes, gap, len, wave) {
    notes.forEach((hz, i) => { if (this.queue.length < QUEUE_MAX) this.queue.push({ at: this.clk + i * gap, hz, len, wave }); });
  }
  spawnFloat(textValue, x, y) {
    let slot = this.floats[0];
    for (const f of this.floats) { if (f.life <= 0) { slot = f; break; } if (f.life < slot.life) slot = f; }
    slot.x = x; slot.y = y; slot.life = 1.1; slot.v = textValue;
  }

  // ---- input --------------------------------------------------------------------
  down() {
    this.idle = 0;
    this.down_ = true;
    this.downAt = this.clk;
    this.consume = false;
    this.downAge = this.ring ? this.clk - this.ring.hiAt : 0;
    if (this.phase_ === "intro") { this.phase_ = "play"; this.consume = true; this.setHint(); return; }
    if (this.phase_ === "away") { this.phase_ = "play"; this.away = null; this.consume = true; this.setHint(); return; }
    if (this.phase_ === "card") {
      if (this.cardT > 1.2) {
        this.phase_ = "play"; this.consume = true;
        if (this.s.b > 0) this.openRing("tree");
        this.setHint();
      } else this.consume = true;
      return;
    }
    if (this.ring) { this.ring.last = this.clk; return; }
    this.gather();
  }
  up(event) {
    if (!this.down_) return;
    this.down_ = false;
    this.idle = 0;
    const heldMs = Number.isFinite(event?.durationMs) ? event.durationMs : (this.clk - this.downAt) * 1000;
    const held = heldMs / 1000;
    if (this.consume) { this.consume = false; return; }
    if (!this.ring) return;
    this.ring.last = this.clk;
    const e = this.entries[this.ring.idx];
    const need = e?.hold || HOLD_BUY;
    if (held < need) { // a tap steps to the next entry
      this.step();
      return;
    }
    this.choose(e, held);
  }
  cancel() {
    this.down_ = false;
    this.consume = false;
    this.ring = null;
    this.save(true);
    this.c.leds(lightsOff());
  }
  pause() {
    this.down_ = false;
    this.ring = null;
    this.save(true);
    this.c.leds(lightsOff());
  }
  resume() {
    this.down_ = false;
    this.syncWall(Date.now());
  }
  dispose() {
    this.down_ = false;
    this.ring = null;
    this.save(true);
    this.c.leds(lightsOff());
  }

  gather() {
    const s = this.s;
    const v = this.tapValue();
    this.gain(v);
    s.taps = Math.min(1e12, s.taps + 1);
    this.flick = 1;
    this.dirty = true;
    const level = clamp(Math.log10(1 + this.rate) / 10, 0, 1);
    const hz = this.c.rng.pick(SCALE) * (level > 0.5 ? 2 : 1) * (1 + 0.04 * Math.floor(level * 4));
    if (this.clk - (this.lastTapTone ?? -1) > 0.04) { this.c.tone(Math.round(hz), 0.06, "triangle"); this.lastTapTone = this.clk; }
    this.spawnFloat("+" + fmt(v), 480 + this.c.rng.range(-70, 70), 215 + this.c.rng.range(-8, 8));
    if (this.flare) this.catchFlare();
  }
  catchFlare() {
    const r = this.c.rng.next(), s = this.s;
    this.flare = null;
    this.accent = { k: "event", t: 0, dur: 0.7 };
    this.arp([784, 988, 1175, 1568], 0.06, 0.25, "sine");
    if (r < 0.55) {
      this.boosts.push({ k: "surge", t: 30, max: 30, mult: 7 });
      this.setNote("FLARE CAUGHT - SURGE x7 FOR 30 S", 4);
    } else if (r < 0.8) {
      const g = this.effRate() * 600 + this.tapValue() * 40;
      this.gain(g);
      this.setNote("FLARE CAUGHT - LODE +" + fmt(g), 4);
    } else {
      this.boosts.push({ k: "frenzy", t: 15, max: 15, mult: 30 });
      this.setNote("FLARE CAUGHT - TAPS x30 FOR 15 S", 4);
    }
    if (this.boosts.length > 4) this.boosts.shift();
    this.dirty = true;
    void s;
  }

  // ---- the build ring ---------------------------------------------------------------
  openRing(menu = "main") {
    if (this.dirty) this.recalc();
    this.ring = { menu, idx: 0, hiAt: this.clk, last: this.clk };
    this.entries = [];
    this.rebuild(true);
    this.arp([330, 440], 0.05, 0.08, "sine");
    this.setHint();
  }
  closeRing() {
    this.ring = null;
    this.save(true);
    this.setHint();
  }
  // Sorted: close, buy-all, affordable (best gain per cost first), sub-menus, then a few
  // previews of what is nearly affordable. Never more than about a dozen entries.
  buildMain() {
    const s = this.s, list = [{ key: "close", kind: "close", label: "CLOSE", lines: ["BACK TO THE STATION"], hold: HOLD_BUY }];
    const aff = this.items.filter((it) => it.cost <= s.sig);
    for (const it of aff) it.g = this.gainOf(it) * (it.type === "u" ? 1.5 : 1);
    aff.sort((a, b) => b.g - a.g);
    if (aff.length >= 2) {
      list.push({ key: "all", kind: "all", label: "BUY ALL AFFORDABLE", aff: true, big: aff.length + " ITEMS", lines: ["SPEND SIGNAL ON EVERYTHING", "WORTH BUYING, BEST FIRST"], cost: 0 });
    }
    for (const it of aff.slice(0, 7)) list.push(this.itemEntry(it, true));
    if (s.tree[5] > 0) list.push({ key: "exp", kind: "sub", sub: "exp", label: "EXPEDITIONS", aff: s.ex.length < slotsOf(s), big: s.ex.length + " / " + slotsOf(s) + " OUT", lines: ["SEND A TEAM OUT ON A TIMER.", "THEY RETURN WITH FINDINGS."] });
    if (s.L > 0 || s.b > 0 || s.runs > 0) {
      const can = TREE.some((nd, k) => s.L >= nd.req && s.tree[k] < nd.max && s.b >= nd.cost(s.tree[k]));
      list.push({ key: "tree", kind: "sub", sub: "tree", label: "BEARING TREE", aff: can, big: s.b + " BEARINGS", lines: ["SPEND BEARINGS ON LASTING", "BONUSES. KEPT FOR EVER."] });
    }
    const p = this.pending();
    if (revealOf(s)) list.push({ key: "reloc", kind: "sub", sub: "reloc", label: "RELOCATE OUTPOST", aff: readyOf(s), big: "+" + p + " BEARINGS", lines: ["START OVER ELSEWHERE AND", "KEEP PERMANENT BEARINGS."] });
    const prev = this.items.filter((it) => it.cost > s.sig).sort((a, b) => a.cost - b.cost).slice(0, 3);
    for (const it of prev) list.push(this.itemEntry(it, false));
    return list;
  }
  itemEntry(it, aff) {
    const s = this.s;
    if (it.type === "p") {
      const i = it.i, n = s.own[i], each = PROD[i].r * prodMult(s, i) * globalMult(s);
      const nm = nextMilestone(n);
      return { key: it.key, kind: "prod", i, label: PROD[i].n, sub: "x" + n, aff, cost: it.cost, big: "COST " + fmt(it.cost),
        lines: ["OWNED " + n + "  EACH " + fmtRate(each) + " /S", PROD[i].fx.toUpperCase(), nm ? "NEXT x2 AT " + nm + " OWNED" : "ALL MILESTONES MET"] };
    }
    const u = UPG[it.i];
    return { key: it.key, kind: "upg", i: it.i, label: u.name, sub: "UPG", aff, cost: u.cost, big: "COST " + fmt(u.cost), lines: [u.eff] };
  }
  buildExp() {
    const s = this.s, list = [{ key: "back", kind: "back", label: "BACK", lines: ["TO THE BUILD RING"], hold: HOLD_BUY }];
    const now = Date.now();
    for (const e of s.ex) {
      const x = EXPED[e.k];
      list.push({ key: "act" + e.end, kind: "info", label: x.n, sub: clock((e.end - now) / 1000), aff: false, big: "OUT " + clock((e.end - now) / 1000),
        lines: ["EXPECTED " + fmt(this.rate * x.mins * 60)] });
    }
    EXPED.forEach((x, k) => {
      const free = s.ex.length < slotsOf(s);
      list.push({ key: "go" + k, kind: "launch", k, label: x.n, sub: dur(x.sec), aff: free, big: "RETURNS ~" + fmt(this.rate * x.mins * 60),
        lines: [free ? "BACK IN " + dur(x.sec) : "NO FREE TEAM", "WORTH " + x.mins + " MIN OF OUTPUT", x.relic ? Math.round(x.relic * 100) + "% CHANCE OF A RELIC" : "NO RELICS ON SHORT TRIPS"] });
    });
    return list;
  }
  buildTree() {
    const s = this.s, list = [{ key: "back", kind: "back", label: "BACK", lines: ["TO THE BUILD RING"], hold: HOLD_BUY }];
    const nodes = [];
    TREE.forEach((nd, k) => {
      if (s.L < nd.req) return;
      const lvl = s.tree[k];
      if (lvl >= nd.max) { nodes.push({ key: "n" + k, kind: "info", label: nd.n, sub: "MAX", aff: false, sort: 2, big: "COMPLETE", lines: [nd.eff(lvl - 1)] }); return; }
      const cost = nd.cost(lvl), aff = s.b >= cost;
      nodes.push({ key: "n" + k, kind: "node", k, label: nd.n, sub: "L" + lvl + "/" + nd.max, aff, cost, sort: aff ? 0 : 1, big: "COST " + cost + " BEARINGS", lines: [nd.eff(lvl), "YOU HAVE " + s.b + " BEARINGS"] });
    });
    nodes.sort((a, b) => a.sort - b.sort || (a.cost || 0) - (b.cost || 0));
    return list.concat(nodes);
  }
  buildReloc() {
    const p = this.pending(), s = this.s;
    return [
      { key: "back", kind: "back", label: "BACK", lines: ["STAY HERE FOR NOW"], hold: HOLD_BUY },
      { key: "go", kind: "reloc", label: "RELOCATE NOW", aff: true, big: "+" + p + " BEARINGS", hold: HOLD_BIG, dwell: DWELL_BIG,
        lines: ["MACHINES AND SIGNAL ARE LOST.", "BEARINGS, TREE, RELICS KEPT.", "TOTAL AFTER: " + (s.L + p) + " BEARINGS"] },
    ];
  }
  rebuild(initial = false) {
    const r = this.ring;
    if (!r) return;
    const old = this.entries[r.idx]?.key;
    this.entries = r.menu === "exp" ? this.buildExp() : r.menu === "tree" ? this.buildTree() : r.menu === "reloc" ? this.buildReloc() : this.buildMain();
    let idx = this.entries.findIndex((e) => e.key === old);
    if (idx < 0) {
      idx = r.menu === "main" ? this.entries.findIndex((e) => e.kind === "prod" || e.kind === "upg") : this.entries.findIndex((e) => e.aff);
      if (idx < 0 || (initial && r.menu === "main" && !this.entries[idx].aff)) idx = 0;
    }
    r.idx = clamp(idx, 0, this.entries.length - 1);
    r.hiAt = this.clk;
  }
  step() {
    const r = this.ring;
    if (!r || !this.entries.length) return;
    r.idx = (r.idx + 1) % this.entries.length;
    r.hiAt = this.clk;
    this.c.tone(440 + 40 * (r.idx % 5), 0.04, "sine");
  }
  choose(e, held) {
    const r = this.ring;
    if (!r || !e) return;
    if (e.kind !== "close" && e.kind !== "back" && this.downAge < (e.dwell || DWELL)) { // a stray hold on a fresh highlight does nothing
      this.refused = this.clk;
      return;
    }
    void held;
    let ok = false;
    switch (e.kind) {
      case "close": this.closeRing(); return;
      case "back": r.menu = "main"; this.rebuild(); this.arp([392, 330], 0.05, 0.08, "sine"); return;
      case "all": ok = this.buyAll() > 0; break;
      case "prod": ok = this.buyProd(e.i); break;
      case "upg": ok = this.buyUpg(e.i); break;
      case "node": ok = this.buyNode(e.k); break;
      case "launch": ok = this.launch(e.k); break;
      case "sub": r.menu = e.sub; this.rebuild(); r.idx = Math.max(0, this.entries.findIndex((x) => x.aff)); this.arp([330, 392], 0.05, 0.08, "sine"); return;
      case "reloc": this.relocate(); return;
      default: break;
    }
    if (ok) {
      this.accent = this.accent?.k === "milestone" ? this.accent : { k: "buy", t: 0, dur: 0.35 };
      if (e.kind !== "node" && e.kind !== "launch") this.arp([392, 494, 587, 784], 0.055, 0.14, "triangle");
      else this.arp([330, 440, 554, 659], 0.06, 0.16, "triangle");
      this.saveSoon();
    } else this.refused = this.clk;
    this.rebuild();
  }

  // ---- saving ----------------------------------------------------------------------------
  saveSoon() { this.savePending = true; }
  save(force = false) {
    if (!force && this.saveCool > 0) { this.savePending = true; return; }
    this.savePending = false;
    this.saveCool = SAVE_GAP;
    this.saveIn = SAVE_EVERY;
    const s = this.s;
    const level = Math.floor(20 * Math.log10(1 + s.lt));
    if (level > this.lastLevel) { this.lastLevel = level; this.c.score?.(level); }
    try { this.c.saveProgress?.({ ...serialize(s, Date.now()), runs: s.runs })?.catch?.(() => {}); } catch { /* the host reports save failures */ }
  }
  // Production the sim did not see: wall time minus game time since the last sync.
  syncWall(now) {
    const gap = (now - this.wallRef) / 1000 - this.simSince;
    this.wallRef = now;
    this.simSince = 0;
    if (!(gap > 10)) return;
    const sum = this.creditAway(gap);
    if (sum.sec >= 60 && this.phase_ === "play") { this.away = sum; this.phase_ = "away"; this.ring = null; }
  }

  // ---- simulation ---------------------------------------------------------------------------
  update(dt) {
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.5);
    const s = this.s;
    this.clk += dt;
    this.t += dt;
    this.simSince += dt;
    this.idle += dt;
    this.recalcIn -= dt;
    if (this.dirty || this.recalcIn <= 0) { this.recalc(); this.recalcIn = 0.2; }
    s.play += dt;
    // production
    this.gain(this.effRate() * dt);
    // boosts and flare
    for (let i = this.boosts.length - 1; i >= 0; i--) { this.boosts[i].t -= dt; if (this.boosts[i].t <= 0) this.boosts.splice(i, 1); }
    if (this.flare) { this.flare.t -= dt; if (this.flare.t <= 0) this.flare = null; }
    else if (s.rt >= 150 && this.phase_ === "play" && !this.ring) {
      this.flareIn -= dt;
      if (this.flareIn <= 0) {
        const lvl = s.tree[7];
        this.flare = { x: this.c.rng.range(160, 800), y: this.c.rng.range(150, 300), t: FLARE_LIFE * (1 + 0.25 * lvl), life: FLARE_LIFE * (1 + 0.25 * lvl) };
        this.flareIn = this.c.rng.range(50, 130) * 0.75 ** lvl;
        this.arp([880, 1175], 0.1, 0.12, "sine");
      }
    }
    // held press opens the ring
    if (this.down_ && !this.ring && !this.consume && this.phase_ === "play" && this.clk - this.downAt >= HOLD_OPEN) {
      this.consume = true;
      this.openRing("main");
    }
    if (this.ring) {
      if (this.clk - this.ring.last > RING_IDLE && !this.down_) this.closeRing();
      else if (Math.floor(this.clk * 4) !== Math.floor((this.clk - dt) * 4)) { // keep affordability fresh without reshuffling
        const e = this.entries[this.ring.idx];
        if (e && (e.kind === "prod" || e.kind === "upg")) e.aff = e.cost <= s.sig;
      }
    } else if (this.phase_ === "play" && s.tree[4] > 0) {
      this.autoIn -= dt;
      if (this.autoIn <= 0) { this.autoIn = AUTO_EVERY[s.tree[4]]; this.autoBuild(); }
    }
    if (this.card !== null && this.phase_ === "card") this.cardT += dt;
    // timers on the wall clock, about once a second
    this.secIn -= dt;
    if (this.secIn <= 0) {
      this.secIn = 1;
      const now = Date.now();
      this.syncWall(now);
      if (s.ex.length) this.collectExpeditions(now, null);
      this.updateHud(false);
      this.setHint();
    }
    // sound queue
    if (this.queue.length) {
      const rest = [];
      for (const q of this.queue) {
        if (q.at <= this.clk) { if (this.idle < DIM_AFTER) this.c.tone(q.hz, q.len, q.wave); } else rest.push(q);
      }
      this.queue = rest;
    }
    // quiet "something is affordable" blip, at most every half minute and never while idle-dim
    const aff = this.affordN > 0;
    this.readyBlip -= dt;
    if (aff && !this.wasAfford && this.readyBlip <= 0 && this.idle < DIM_AFTER && this.phase_ === "play" && !this.ring && s.rt > 20) {
      this.c.tone(988, 0.08, "sine");
      this.readyBlip = 30;
    }
    this.wasAfford = aff;
    // visuals
    for (let i = 0; i < NP; i++) {
      const target = this.out[i] > 0 ? clamp(Math.log10(1 + this.out[i]) / 8, 0.08, 1) : 0;
      this.act[i] += (target - this.act[i]) * Math.min(1, dt * 2);
      this.phase[i] += dt * (0.3 + 1.6 * this.act[i]);
      if (this.flash[i] > 0) this.flash[i] = Math.max(0, this.flash[i] - dt * 2);
    }
    for (const f of this.floats) if (f.life > 0) { f.life -= dt; f.y -= dt * 40; }
    if (this.note) { this.note.t -= dt; if (this.note.t <= 0) this.note = null; }
    if (this.flick > 0) this.flick = Math.max(0, this.flick - dt * 6);
    if (this.accent) { this.accent.t += dt; if (this.accent.t >= this.accent.dur) this.accent = null; }
    if (this.refused && this.clk - this.refused > 0.4) this.refused = 0;
    // autosave
    if (this.saveCool > 0) this.saveCool -= dt;
    this.saveIn -= dt;
    if (this.saveIn <= 0 || (this.savePending && this.saveCool <= 0)) this.save(true);
    // lamps
    const rateLog = clamp(Math.log10(this.rate + 1) / 12, 0, 1);
    this.breath += dt * (0.12 + 0.6 * rateLog);
    this.dimK += ((this.idle > DIM_AFTER ? 0.12 : 1) - this.dimK) * Math.min(1, dt * 0.8);
    this.c.leds(this.lampValues());
  }
  autoBuild() {
    const s = this.s;
    let best = -1, bestCost = Infinity;
    for (const it of this.items) {
      if (it.type === "p" && it.cost <= s.sig && it.cost < bestCost) { best = it; bestCost = it.cost; }
    }
    if (s.tree[4] >= 2) for (const it of this.items) if (it.type === "u" && it.cost <= s.sig && it.cost < bestCost) { best = it; bestCost = it.cost; }
    if (best === -1) return;
    if (best.type === "p") this.buyProd(best.i); else this.buyUpg(best.i);
    this.saveSoon();
  }

  // ---- lamps -----------------------------------------------------------------------------------
  lampValues() {
    const k = this.dimK, s = this.s;
    // left: breathing, quicker with production; tap flicker rides on top
    const left = dim(LAMP.green, (0.06 + 0.2 * pulse(this.breath) + 0.4 * this.flick) * k);
    // middle: steady green when something is affordable, otherwise fills toward the next goal
    const mid = this.affordN > 0 && this.phase_ !== "intro" ? dim(LAMP.green, 0.3 * Math.max(k, 0.25)) : dim(LAMP.amber, (0.03 + 0.25 * this.goalFrac) * k);
    // right: the timed thing
    let right = LAMP.off;
    if (this.flare) right = dim(LAMP.amber, 0.5 * blink(this.clk, 3));
    else if (this.boosts.length) {
      const b = this.boosts[0], frac = clamp(b.t / b.max, 0, 1);
      right = dim(LAMP.violet, (0.1 + 0.25 * frac) * (b.t < 3 ? 0.5 + 0.5 * blink(this.clk, 4) : 1) * Math.max(k, 0.3));
    } else if (s.ex.length) {
      const e = s.ex[0], x = EXPED[e.k];
      const frac = clamp(1 - (e.end - Date.now()) / (x.sec * 1000), 0, 1);
      right = dim(LAMP.cyan, (0.04 + 0.26 * frac) * k);
    } else if (readyOf(s)) right = dim(LAMP.white, (0.08 + 0.22 * pulse(this.clk * 0.5)) * Math.max(k, 0.3));
    let v = lamps(left, mid, right);
    const a = this.accent;
    if (a) {
      const f = 1 - a.t / a.dur;
      let acc = null;
      if (a.k === "buy") acc = lamps(dim(LAMP.green, 0.7 * f), dim(LAMP.green, 0.7 * f), dim(LAMP.green, 0.7 * f));
      else if (a.k === "milestone") acc = spot(a.t / a.dur, LAMP.blue, 0.8);
      else if (a.k === "event") acc = lamps(dim(LAMP.violet, 0.8 * f), dim(LAMP.violet, 0.8 * f), dim(LAMP.violet, 0.8 * f));
      else if (a.k === "prestige") { const w = Math.sin(clamp(a.t / a.dur, 0, 1) * Math.PI); acc = lamps(dim(LAMP.white, 0.8 * w), dim(LAMP.white, 0.8 * w), dim(LAMP.white, 0.8 * w)); }
      if (acc) v = v.map((x, i) => Math.max(x, acc[i]));
    }
    return v;
  }

  // ---- text readouts ----------------------------------------------------------------------------
  updateHud(force) {
    const s = this.s;
    const items = [["SIGNAL", fmt(s.sig)], ["RATE", fmtRate(this.effRate()) + "/S"]];
    if (s.L > 0) items.push(["BEARINGS", s.b + " / " + s.L]);
    const key = items.map((x) => x.join("")).join("|");
    if (force || key !== this.hudKey) { this.hudKey = key; this.c.hud(items); }
  }
  setHint() {
    let h;
    if (this.phase_ === "intro" || this.phase_ === "away") h = "Press to continue.";
    else if (this.phase_ === "card") h = "Press to continue.";
    else if (this.ring) h = "Tap: next entry. Hold, then release: choose.";
    else if (this.flare) h = "Signal flare. Tap now to catch it.";
    else if (this.affordN > 0) h = "Something is affordable. Hold to build.";
    else h = "Tap to gather signal. Hold to open the build ring.";
    if (h !== this.hintKey) { this.hintKey = h; this.c.hint(h); }
  }

  // ---- drawing -------------------------------------------------------------------------------------
  draw(g) {
    space(g, this.t * 3, 0.5);
    this.drawScene(g);
    this.drawHeader(g);
    for (const f of this.floats) {
      if (f.life <= 0) continue;
      g.globalAlpha = clamp(f.life, 0, 1);
      text(g, f.v, f.x, f.y, 22, C.ink, "center");
    }
    g.globalAlpha = 1;
    if (this.flare) this.drawFlare(g);
    this.drawFooter(g);
    if (this.ring) this.drawRing(g);
    else if (this.note && this.phase_ === "play") text(g, this.note.text, 480, 232, 22, C.cyan, "center");
    if (this.phase_ === "intro") banner(g, "OUTPOST", "A lone station on a dark world. Tap to gather signal. Hold to build.");
    else if (this.phase_ === "away") this.drawAway(g);
    else if (this.phase_ === "card") this.drawCard(g);
  }
  drawHeader(g) {
    const s = this.s;
    text(g, "SIGNAL", 480, 24, 16, C.muted, "center");
    text(g, fmt(s.sig), 480, 64, 46, C.ink, "center");
    const surge = this.surge() > 1 ? " x" + this.surge() : "";
    text(g, "+" + fmtRate(this.effRate()) + " /S" + surge, 480, 104, 26, this.surge() > 1 ? C.cyan : C.amber, "center");
    if (s.L > 0) text(g, "BEARINGS " + s.b, 940, 24, 16, C.amber, "right");
    let y = 24;
    for (const b of this.boosts) { text(g, (b.k === "surge" ? "SURGE x" : "TAP x") + b.mult + " " + clock(b.t), 24, y, 16, C.cyan, "left"); y += 22; }
    for (const e of s.ex) { text(g, EXPED[e.k].n + " " + clock((e.end - Date.now()) / 1000), 24, y, 16, C.cyan, "left"); y += 22; }
  }
  drawFooter(g) {
    const s = this.s;
    if (this.ring || this.phase_ !== "play") return;
    if (this.goalName) {
      text(g, "NEXT  " + this.goalName + "  " + fmt(this.goalCost), 480, 492, 22, this.affordN > 0 ? C.ink : C.muted, "center");
      g.fillStyle = C.dark; g.fillRect(260, 510, 440, 8);
      g.fillStyle = this.affordN > 0 ? C.ink : C.amber; g.fillRect(260, 510, 440 * this.goalFrac, 8);
    } else if (this.items.length && this.affordN > 0) text(g, "HOLD TO BUILD", 480, 492, 22, C.ink, "center");
    const p = this.pending();
    if (revealOf(s)) text(g, readyOf(s) ? "RELOCATION READY  +" + p : "RELOCATION POSSIBLE  +" + p, 480, 134, 18, readyOf(s) ? C.cyan : C.muted, "center");
    else if (this.affordN > 0 && this.phase_ === "play") text(g, "HOLD TO BUILD", 480, 134, 18, C.ink, "center");
  }
  drawFlare(g) {
    const f = this.flare, k = f.t / f.life, r = 12 + 10 * Math.sin(this.t * 6);
    diamond(g, f.x, f.y, r, C.amber, true);
    circle(g, f.x, f.y, 26 + 14 * (1 - k), C.amber, false, 2);
    text(g, "FLARE - TAP", f.x, f.y + 44, 22, C.amber, "center");
  }
  drawScene(g) {
    const s = this.s, gy = 440;
    line(g, 0, gy, 960, gy, C.line, 2);
    for (let x = 30; x < 960; x += 90) line(g, x, gy + 8, x + 40, gy + 8, C.dark, 2);
    let ghost = -1;
    for (let i = 0; i < NP; i++) {
      const x = 72 + i * 90.5, n = s.own[i];
      if (n > 0) {
        this.structure(g, i, x, gy, n);
        text(g, "x" + n, x, gy + 26, 16, this.flash[i] > 0 ? C.cyan : C.muted, "center");
        if (this.flash[i] > 0) circle(g, x, gy - 40, 30 + 40 * (1 - this.flash[i]), C.cyan, false, 2);
      } else if (ghost < 0 && i <= s.maxTier + 1 && prodVisible(s, i)) {
        ghost = i;
        g.save(); g.setLineDash([4, 6]); circle(g, x, gy - 30, 22, C.line, false, 2); g.restore();
        text(g, "?", x, gy - 30, 22, C.line, "center");
      }
    }
  }
  // Each machine is a few lines; motion speed follows its output (act) and phase.
  structure(g, i, x, y, n) {
    const a = this.act[i], ph = this.phase[i], sc = 0.85 + Math.min(0.3, n / 150);
    g.save();
    g.translate(x, y);
    g.scale(sc, sc);
    const ink = C.ink, am = C.amber, cy = C.cyan;
    switch (i) {
      case 0: // dish on a post, nodding
        line(g, 0, 0, 0, -26, ink, 2);
        g.save(); g.translate(0, -30); g.rotate(-0.7 + Math.sin(ph) * 0.3);
        g.beginPath(); g.arc(0, 0, 21, 0.15 * Math.PI, 0.85 * Math.PI); g.strokeStyle = ink; g.lineWidth = 2; g.stroke();
        line(g, 0, 6, 0, -16, am, 2);
        g.restore();
        break;
      case 1: // lattice mast with a beacon
        line(g, -10, 0, 0, -96, ink, 2); line(g, 10, 0, 0, -96, ink, 2);
        for (let k = 1; k < 5; k++) { const w = 10 * (1 - k / 5.5); line(g, -w, -k * 18, w, -k * 18, C.line, 2); }
        circle(g, 0, -100, 4, blink(ph * 0.5, 1) ? am : C.line, true);
        g.globalAlpha = 0.4 + 0.4 * a; circle(g, 0, -100, 9 + 7 * (ph % 1), am, false, 1.5); g.globalAlpha = 1;
        break;
      case 2: { // derrick with a piston
        line(g, -16, 0, 0, -70, ink, 2); line(g, 16, 0, 0, -70, ink, 2); line(g, -8, -35, 8, -35, C.line, 2);
        const pis = -18 - 14 * (0.5 + 0.5 * Math.sin(ph * 3));
        line(g, 0, -70, 0, pis, am, 3);
        break;
      }
      case 3: // a row of tilted panels
        for (let k = -1; k <= 1; k++) {
          const px = k * 24, t = Math.sin(ph * 0.7 + k) * 5;
          line(g, px - 10, -16 + t, px + 10, -34 - t, ink, 2); line(g, px + 10, -34 - t, px + 14, -26 - t, ink, 2);
          line(g, px, 0, px, -22, C.line, 2);
        }
        break;
      case 4: { // borehole: pit with a rising glow
        g.save(); g.scale(1, 0.3); circle(g, 0, 0, 26, ink, false, 3); g.restore();
        for (let k = 0; k < 4; k++) { const u = ((ph * 0.5 + k / 4) % 1); g.globalAlpha = 1 - u; line(g, -4, -u * 80, 4, -u * 80, cy, 3); }
        g.globalAlpha = 1;
        break;
      }
      case 5: { // dome with a slit
        g.beginPath(); g.arc(0, -4, 30, Math.PI, TAU); g.strokeStyle = ink; g.lineWidth = 2; g.stroke();
        line(g, -30, -4, 30, -4, ink, 2);
        const sx = Math.sin(ph * 0.6) * 18;
        line(g, sx, -34, sx, -6, am, 3);
        break;
      }
      case 6: { // archive block with scanning rows
        g.strokeStyle = ink; g.lineWidth = 2; g.strokeRect(-26, -64, 52, 64);
        for (let k = 0; k < 4; k++) line(g, -18, -52 + k * 14, 18, -52 + k * 14, C.line, 2);
        const sy = -62 + ((ph * 0.4) % 1) * 60;
        line(g, -26, sy, 26, sy, am, 3);
        break;
      }
      case 7: { // echo chamber: rings leaving a dome
        g.beginPath(); g.arc(0, 0, 20, Math.PI, TAU); g.strokeStyle = ink; g.lineWidth = 2; g.stroke();
        for (let k = 0; k < 3; k++) { const u = (ph * 0.5 + k / 3) % 1; g.globalAlpha = 1 - u; circle(g, 0, -4, 20 + u * 36, cy, false, 2); }
        g.globalAlpha = 1;
        break;
      }
      case 8: { // three pylons and a crawling arc
        for (let k = -1; k <= 1; k++) line(g, k * 28, 0, k * 28, -66 - (k === 0 ? 18 : 0), ink, 3);
        const j = Math.sin(ph * 2) * 5;
        line(g, -28, -66, -14, -72 + j, am, 2); line(g, -14, -72 + j, 0, -84, am, 2);
        line(g, 0, -84, 14, -72 - j, am, 2); line(g, 14, -72 - j, 28, -66, am, 2);
        break;
      }
      default: { // the great ring, turning
        g.save(); g.translate(0, -50); g.scale(1, 0.55); circle(g, 0, 0, 40, ink, false, 3); g.restore();
        for (let k = 0; k < 8; k++) { const th = ph * 0.5 + (k * TAU) / 8; line(g, Math.cos(th) * 40, -50 + Math.sin(th) * 22, Math.cos(th) * 46, -50 + Math.sin(th) * 25, am, 2); }
        line(g, 0, -50, 0, -110 - 20 * a, cy, 2);
        break;
      }
    }
    g.restore();
    if (n >= 10) { g.save(); g.translate(x - 34, y); g.scale(0.5, 0.5); this.mini(g, i); g.restore(); }
    if (n >= 25) { g.save(); g.translate(x + 34, y); g.scale(0.5, 0.5); this.mini(g, i); g.restore(); }
  }
  mini(g, i) { // a small post and head, standing for "more of these"
    line(g, 0, 0, 0, -40 - (i % 3) * 10, C.muted, 3);
    circle(g, 0, -44 - (i % 3) * 10, 7, C.muted, false, 2);
  }
  drawRing(g) {
    const r = this.ring, es = this.entries, e = es[r.idx];
    g.fillStyle = "#0c1511f2";
    g.fillRect(30, 140, 900, 372);
    g.strokeStyle = C.line; g.lineWidth = 2; g.strokeRect(30, 140, 900, 372);
    const title = r.menu === "exp" ? "EXPEDITIONS" : r.menu === "tree" ? "BEARING TREE" : r.menu === "reloc" ? "RELOCATE" : "BUILD";
    text(g, title, 54, 164, 18, C.amber, "left");
    text(g, "SIGNAL " + fmt(this.s.sig), 906, 164, 18, C.muted, "right");
    // list window of up to 6 rows
    const rows = 6, first = clamp(r.idx - 2, 0, Math.max(0, es.length - rows));
    for (let k = 0; k < rows && first + k < es.length; k++) {
      const it = es[first + k], y = 204 + k * 46, sel = first + k === r.idx;
      if (sel) { g.fillStyle = "#1c3322"; g.fillRect(44, y - 20, 420, 40); g.strokeStyle = it.aff ? C.ink : C.muted; g.lineWidth = 2; g.strokeRect(44, y - 20, 420, 40); }
      const col = it.kind === "close" || it.kind === "back" ? C.muted : it.aff ? C.ink : C.line;
      text(g, (it.aff ? "> " : "  ") + it.label.slice(0, 19), 54, y, 22, sel && !it.aff ? C.muted : col, "left");
      if (it.sub) text(g, it.sub, 456, y, 16, it.aff ? C.amber : C.line, "right");
    }
    if (first + rows < es.length) text(g, "...", 254, 484, 22, C.muted, "center");
    if (!e) return;
    // detail card
    const dwellNeed = e.dwell || DWELL, locked = e.kind !== "close" && e.kind !== "back" && this.clk - r.hiAt < dwellNeed;
    text(g, e.label, 500, 204, 26, C.ink, "left");
    if (e.big) text(g, e.big, 500, 250, 32, e.aff ? C.ink : C.amber, "left");
    if (e.cost > 0 && !e.aff && e.kind !== "node") text(g, "NEED " + fmt(e.cost - this.s.sig) + " MORE", 500, 288, 22, C.muted, "left");
    let y = e.cost > 0 && !e.aff && e.kind !== "node" ? 326 : 296;
    for (const ln of e.lines) for (const part of wrapText(ln, 29).slice(0, 2)) { text(g, part, 500, y, 22, C.muted, "left"); y += 28; }
    // hold bar
    const need = e.hold || HOLD_BUY;
    const held = this.down_ && !this.consume ? clamp((this.clk - this.downAt) / need, 0, 1) : 0;
    g.fillStyle = C.dark; g.fillRect(500, 458, 400, 14);
    g.fillStyle = locked ? C.amber : e.aff || e.kind === "close" || e.kind === "back" ? C.ink : C.muted;
    g.fillRect(500, 458, 400 * held, 14);
    const label = this.refused ? "NOT NOW" : e.kind === "close" ? "HOLD TO CLOSE" : e.kind === "back" ? "HOLD TO GO BACK" : e.kind === "info" ? "NOTHING TO DO" : locked ? "STEADY..." : e.aff ? "HOLD TO " + (e.kind === "reloc" ? "RELOCATE" : e.kind === "launch" || e.kind === "node" ? "CHOOSE" : "BUY") : "CANNOT AFFORD YET";
    text(g, label, 500, 492, 18, this.refused ? C.red : locked ? C.amber : C.ink, "left");
    text(g, "TAP: NEXT", 906, 492, 18, C.muted, "right");
    // an auto-close countdown in the corner
    const left = RING_IDLE - (this.clk - r.last);
    if (left < 3) text(g, "CLOSING " + Math.ceil(left), 906, 188, 16, C.red, "right");
  }
  drawAway(g) {
    const a = this.away;
    if (!a) return;
    g.fillStyle = "#0c1511f0"; g.fillRect(100, 130, 760, 330);
    g.strokeStyle = C.line; g.lineWidth = 2; g.strokeRect(100, 130, 760, 330);
    text(g, "WHILE YOU WERE AWAY", 480, 168, 26, C.amber, "center");
    let y = 214;
    if (a.sec > 0) {
      text(g, dur(a.sec), 480, y, 32, C.ink, "center"); y += 46;
      text(g, "+" + fmt(a.gain) + " SIGNAL", 480, y, 32, C.ink, "center"); y += 42;
      if (a.capped) { text(g, "CAPPED AT " + capHours(this.s) + " H OF STORAGE", 480, y, 18, C.muted, "center"); y += 28; }
    }
    for (const f of a.found.slice(0, 3)) { text(g, f.name + " RETURNED +" + fmt(f.reward) + (f.relic ? " + RELIC" : ""), 480, y, 22, C.cyan, "center"); y += 32; }
    if (a.note) { text(g, a.note, 480, y, 22, C.red, "center"); y += 32; }
    text(g, "PRESS TO CONTINUE", 480, 432, 22, C.amber, "center");
  }
  drawCard(g) {
    const c = this.card;
    if (!c) return;
    g.fillStyle = "#0c1511f0"; g.fillRect(100, 130, 760, 330);
    g.strokeStyle = C.line; g.lineWidth = 2; g.strokeRect(100, 130, 760, 330);
    text(g, "OUTPOST RELOCATED", 480, 168, 30, C.cyan, "center");
    text(g, "+" + c.gain + " BEARINGS", 480, 226, 40, C.ink, "center");
    text(g, "RUN SIGNAL " + fmt(c.run) + "  IN " + dur(c.secs), 480, 282, 22, C.muted, "center");
    text(g, "TOTAL BEARINGS " + c.total, 480, 316, 22, C.amber, "center");
    text(g, "EVERYTHING ELSE STARTS AGAIN, FASTER.", 480, 360, 22, C.muted, "center");
    if (this.cardT > 1.2) text(g, this.s.b > 0 ? "PRESS TO SPEND BEARINGS" : "PRESS TO CONTINUE", 480, 424, 22, C.amber, "center");
  }
}
Outpost.econ = { revealOf, fmt, fmtRate, dur, costOf, prodMult, globalMult, evaluate, tapParts, capHours, pendingOf, readyOf, migrate, serialize, freshState, applyKit,
  PROD, UPG, TREE, EXPED, MILESTONES, SCHEMA, BIG, PRESTIGE_K, READY_MIN, KIT, NUP, NP, milestonesAt };
