// UNDERTOW — a one-button dive. Hold to thrust up, release to sink, and thread the openings
// between ancient columns while the current carries the craft deeper.
//
// The run is a descent through six zones, each adding one thing to read: pearls and drifting
// openings (Kelp Run), vertical currents between the columns (Trench), dark water where only a
// sonar ping and the lamps show the openings (Abyss), openings that breathe (Vent Field), and all
// of it at once (The Deep). Passing near the middle of an opening is a clean passage; a streak of
// them pays pearls. Pearls are banked between dives and buy two more craft at the dock.
//
// Each zone has its own sea life. Flying close to a creature for a moment logs it in the field
// guide (twelve species, two to a zone, pearls for each new one); schools scatter as the craft passes.
//
// The dock (hold on the title or result screen) has the craft, refits bought with pearls (magnet,
// assay, lure, scanner: pearls and sea life, never survival), a start zone, a daily dive seeded by the date, the field guide, feats and
// a log. The save is versioned (schema 3) and still carries the fields the dashboard's field record
// reads (runs, last, milestone); first-release and schema-2 saves are migrated.
//
// The lamps are the depth gauge: a cyan spot where the craft is (left = surface, right = floor),
// an amber spot at the next opening that brightens as it arrives, so the two meet when the craft
// is lined up; red at the end lamp near the surface or the floor.
import { TAU, clamp, mixSeed, Random } from "../engine/math.js";
import { C, text, line, circle, diamond } from "../engine/draw.js";
import { LAMP, fill, only, spot, blink, dim, chase } from "../engine/lightshow.js";
import { AppGuard } from "../engine/input.js";
import { LampBus, lampMax, LOCKOUT } from "./game-kit.js";

const TOP = 22, FLOOR = 518; // leaving this band costs hull
const CX = 220; // the craft's screen x
const COL = 65; // column width
const HIT_L = 202, HIT_R = 246; // the craft's collision span in x (the column test)
const HOLD_PICK = 0.5; // a press this long on a menu screen chooses instead of tapping
const FIRST_GATE = 0.8; // seconds from the start of a dive to the first column
const MAX_PARTS = 64, MAX_PEARLS = 24, MAX_GATES = 8;
const PEARL_R = 22; // collect radius
const SKIM = 9; // px of clearance or less at a column edge counts as a skim
const MAX_LIFE = 6; // creatures on screen at once
const SPECIES_PEARLS = 10; // banked for each new species logged
const METRES = 6; // px travelled per metre of depth on the gauge

export const ZONES = [
  { at: 0, name: "SHALLOWS", note: "", col: "#8fcbc5", water: "#0c1716", rock: "#264a3e", far: "#132723", shade: "#1b362d", lamp: LAMP.cyan },
  { at: 8, name: "KELP RUN", note: "PEARLS AND DRIFTING OPENINGS", col: "#a5c58c", water: "#0d1812", rock: "#2d4a2a", far: "#14251a", shade: "#20361e", lamp: LAMP.green },
  { at: 20, name: "THE TRENCH", note: "CURRENTS PUSH BETWEEN THE COLUMNS", col: "#7fb0d8", water: "#0b1219", rock: "#26405a", far: "#121e2b", shade: "#1b2f43", lamp: LAMP.blue },
  { at: 34, name: "THE ABYSS", note: "DARK WATER / THE SONAR AND THE LAMPS", col: "#c9a0ff", water: "#07090d", rock: "#2a2440", far: "#0e0f18", shade: "#1d1930", lamp: LAMP.violet },
  { at: 50, name: "VENT FIELD", note: "THE OPENINGS BREATHE", col: "#e7b879", water: "#130e0a", rock: "#4a3424", far: "#1f1610", shade: "#36261a", lamp: LAMP.amber },
  { at: 70, name: "THE DEEP", note: "EVERYTHING AT ONCE", col: "#eb947a", water: "#0e0808", rock: "#4a2626", far: "#1c0f0f", shade: "#361b1b", lamp: LAMP.red },
];
const zoneAt = (points) => { for (let i = ZONES.length - 1; i > 0; i--) if (points >= ZONES[i].at) return i; return 0; };

// Craft bought with pearls at the dock. up/down are px/s^2, vmax px/s, r the hull radius in px.
export const CRAFTS = [
  { name: "SKIFF", hull: 2, up: 720, down: 470, vmax: 285, r: 14, pearl: 1, cost: 0, text: "Balanced. Two hull." },
  { name: "DART", hull: 1, up: 880, down: 560, vmax: 330, r: 11, pearl: 2, cost: 150, text: "Small and quick. One hull. Pearls count double." },
  { name: "BULWARK", hull: 3, up: 600, down: 410, vmax: 245, r: 16, pearl: 1, cost: 400, text: "Slow to answer. Three hull." },
];

// Refits bought with pearls at the dock; each level costs the next price in `costs`. They help with
// pearls and sea life only, never with surviving, so the best passage count is skill, not grinding.
// The daily dive ignores them, so it is the same dive for everyone. (Slots 1 and 2 were plating and
// sonar in an unreleased build; a save that bought them gets the assay and the lure.)
export const UPGRADES = [
  { id: "magnet", name: "PEARL MAGNET", costs: [120, 260], text: "Pearls are collected from further away." },
  { id: "assay", name: "CLEAN ASSAY", costs: [300], text: "Every fifth clean passage pays 5 pearls, not 3." },
  { id: "lure", name: "SEA LURE", costs: [180], text: "Sea life comes twice as often, new species first." },
  { id: "scanner", name: "WIDE SCANNER", costs: [90], text: "Sea life is logged from further away, and sooner." },
];

// Sea life: two species to a zone, logged in the field guide by flying close for a moment.
export const SPECIES = [
  { id: "shoal", name: "SILVER SHOAL", zone: 0, kind: "school", col: "#cfe6e0" },
  { id: "moon", name: "MOON JELLY", zone: 0, kind: "jelly", col: "#bfe3dd" },
  { id: "darter", name: "KELP DARTER", zone: 1, kind: "fish", col: "#c4dc8c" },
  { id: "ray", name: "SPOTTED RAY", zone: 1, kind: "ray", col: "#d6c89a" },
  { id: "ribbon", name: "RIBBON EEL", zone: 2, kind: "eel", col: "#8fc4ec" },
  { id: "blue", name: "BLUE SHOAL", zone: 2, kind: "school", col: "#9fc0f0" },
  { id: "lantern", name: "LANTERN FISH", zone: 3, kind: "angler", col: "#c9a0ff" },
  { id: "ghost", name: "GHOST JELLY", zone: 3, kind: "jelly", col: "#e0d0ff" },
  { id: "venteel", name: "VENT EEL", zone: 4, kind: "eel", col: "#e7b879" },
  { id: "ember", name: "EMBER SHOAL", zone: 4, kind: "school", col: "#f0a868" },
  { id: "angler", name: "BLACK ANGLER", zone: 5, kind: "angler", col: "#eb947a" },
  { id: "devil", name: "DEVIL RAY", zone: 5, kind: "ray", col: "#d07a68" },
];
const SPECIES_IDS = SPECIES.map((s) => s.id);
const SPECIES_BY = Object.fromEntries(SPECIES.map((s) => [s.id, s]));
const lifeRng = new Random(1);

// The next column, given the last opening's centre and the passages so far. The centre moves by at
// most 85 px between columns; the gap narrows from 250 px to 105 px; openings drift from the Kelp
// Run on. `rng` is the run's generator (the daily dive has its own).
export function nextGate(center, points, rng) {
  const reach = Math.min(85, 50 + points * 2);
  const base = clamp(center + rng.range(-reach, reach), 165, 375);
  const amp = points >= 8 ? Math.min(70, 14 + (points - 8) * 2.5) : 0;
  const z = zoneAt(points);
  // Currents from the Trench. They ease in: none on its first two columns, then rarer and gentler
  // (a third of the columns at 120 px/s^2) growing to most columns at 260 by its end; half of the
  // columns in the Deep at full strength (320).
  const into = points - ZONES[2].at;
  const curChance = z === 2 ? (into < 2 ? 0 : Math.min(0.7, 0.3 + (into - 2) * 0.05)) : z === 5 ? 0.5 : 0;
  const cur = curChance && rng.next() < curChance ? (rng.next() < 0.5 ? -1 : 1) * (120 + Math.min(200, into * 10)) : 0;
  // Breathing openings in the Vent Field and the Deep.
  const breathe = z >= 4 && rng.next() < 0.75 ? 26 + Math.min(16, (points - 50)) : 0;
  return { x: 1010, center: base, base, amp: z === 3 ? amp * 0.5 : amp, phase: rng.range(0, TAU), age: 0,
    gap: Math.max(105, 250 - points * 2.6), size: 0, passed: false, cur, breathe, margin: 999, lit: 0, ring: 0 };
}
export const undertowSpeed = (points) => 235 + Math.min(points * 3.2, 165);
export const gateInterval = (points) => Math.max(1.15, 1.6 - points * 0.012);
// The distance a dive covers to reach a passage count, so a dive started in a later zone reads the
// right depth on the gauge.
const reachDist = (points) => { let d = 0; for (let p = 0; p < points; p++) d += undertowSpeed(p) * gateInterval(p); return d; };

// ---- feats ------------------------------------------------------------------------------------
const life = (a, key) => (a.sv.st[key] || 0) + (a.R[key] || 0);
export const FEATS = [
  { id: "kelp", name: "INTO THE KELP", text: "Reach the Kelp Run.", n: 1, prog: (a) => a.R.zone >= 1 ? 1 : 0 },
  { id: "trench", name: "TRENCH DIVER", text: "Reach the Trench.", n: 1, prog: (a) => a.R.zone >= 2 ? 1 : 0 },
  { id: "abyss", name: "LIGHTLESS", text: "Reach the Abyss.", n: 1, prog: (a) => a.R.zone >= 3 ? 1 : 0 },
  { id: "vents", name: "HOT WATER", text: "Reach the Vent Field.", n: 1, prog: (a) => a.R.zone >= 4 ? 1 : 0 },
  { id: "deep", name: "THE DEEP", text: "Reach the Deep.", n: 1, prog: (a) => a.R.zone >= 5 ? 1 : 0 },
  { id: "clean10", name: "THREADED", text: "10 clean passages in a row.", n: 10, prog: (a) => a.R.cleanBest },
  { id: "nohit", name: "UNTOUCHED", text: "25 passages in a row without a hit.", n: 25, prog: (a) => a.R.noHitBest },
  { id: "pearls20", name: "PEARL DIVER", text: "Collect 20 pearls in one dive.", n: 20, prog: (a) => a.R.pearls },
  { id: "hoard", name: "HOARD", text: "Collect 500 pearls in all.", n: 500, prog: (a) => life(a, "pearls") },
  { id: "bubble", name: "SOAP BUBBLE", text: "Let a shield take a hit.", n: 1, prog: (a) => a.R.shielded },
  { id: "regular", name: "REGULAR", text: "Make 25 dives.", n: 25, prog: (a) => a.sv.runs + (a.phase === "play" ? 1 : 0) },
  { id: "daily", name: "ON THE DAY", text: "Meet a daily goal.", n: 1, prog: (a) => life(a, "daily") },
  { id: "spotter", name: "NATURALIST", text: "Log 6 species in the field guide.", n: 6, prog: (a) => a.sv.sp.length + a.R.found.length },
  { id: "guide", name: "FIELD GUIDE", text: "Log all 12 species.", n: 12, prog: (a) => a.sv.sp.length + a.R.found.length },
  { id: "skim", name: "SKIMMER", text: "", hint: "The edge is closer than it looks.", n: 5, hidden: true, prog: (a) => a.R.skims },
  { id: "last", name: "LAST BREATH", text: "", hint: "Some swim best when hurt.", n: 15, hidden: true, prog: (a) => a.R.lastBest },
];
const FEAT_IDS = FEATS.map((f) => f.id);
const FEAT_PEARLS = 15; // banked for each feat

// ---- the date and the daily dive ---------------------------------------------------------------
const dailyRng = new Random(1);
const hashText = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const ymd = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const dayBefore = (key) => { const [y, m, d] = key.split("-").map(Number); return ymd(new Date(y, m - 1, d - 1)); };
// Today's goal, the same for everyone on the same date.
export function dailyGoal(key) {
  const h = hashText("undertow" + key), kind = h % 3, v = (h >>> 8) % 5;
  if (kind === 0) return { kind: "passages", n: 15 + 5 * v, text: "Make " + (15 + 5 * v) + " passages." };
  if (kind === 1) return { kind: "pearls", n: 8 + 2 * v, text: "Collect " + (8 + 2 * v) + " pearls." };
  return { kind: "clean", n: 5 + v, text: "Make " + (5 + v) + " clean passages in a row." };
}

// ---- the save ------------------------------------------------------------------------------------
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const day = (v) => (typeof v === "string" ? v.slice(0, 10) : "");
// Bring any stored shape (nothing; schema 1, written by recordRun in the first release; schema 2;
// schema 3) to schema 3. A first-release save keeps its runs, last result and milestone, and the zones
// its best milestone shows were reached open as start zones. Schema 3 added refits (up), the field
// guide (sp) and the deepest dive in metres (dm); a schema-2 save starts them empty.
export function migrateSave(raw) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const st = r.st && typeof r.st === "object" ? r.st : {};
  const sel = r.sel && typeof r.sel === "object" ? r.sel : {};
  const dl = r.dl && typeof r.dl === "object" ? r.dl : {};
  const milestone = Math.max(0, Math.floor(num(r.milestone)));
  const lastPassages = Math.max(0, num(r.last?.passages));
  const own = CRAFTS.map((_, i) => (i === 0 || (Array.isArray(r.own) && r.own[i]) ? 1 : 0));
  const craft = clamp(Math.floor(num(sel.craft)), 0, CRAFTS.length - 1);
  const far = clamp(Math.floor(num(r.far, zoneAt(Math.max(milestone * 5, lastPassages)))), 0, ZONES.length - 1);
  return {
    schema: 3,
    runs: Math.max(0, Math.floor(num(r.runs))),
    last: r.last && typeof r.last === "object" ? r.last : {},
    milestone,
    far,
    bank: Math.max(0, Math.floor(num(r.bank))),
    own,
    cb: CRAFTS.map((_, i) => Math.max(0, Math.floor(num(Array.isArray(r.cb) ? r.cb[i] : undefined)))),
    ft: Array.isArray(r.ft) ? r.ft.filter((id, i) => FEAT_IDS.includes(id) && r.ft.indexOf(id) === i) : [],
    st: { pearls: Math.max(0, num(st.pearls)), daily: Math.max(0, num(st.daily)), passages: Math.max(0, num(st.passages, r.schema >= 2 ? 0 : lastPassages)) },
    sel: { craft: own[craft] ? craft : 0, start: clamp(Math.floor(num(sel.start)), 0, far) },
    dl: { d: day(dl.d), best: Math.max(0, num(dl.best)), done: dl.done ? 1 : 0, streak: Math.max(0, Math.floor(num(dl.streak))), last: day(dl.last) },
    up: UPGRADES.map((u, i) => clamp(Math.floor(num(Array.isArray(r.up) ? r.up[i] : 0)), 0, u.costs.length)),
    sp: Array.isArray(r.sp) ? r.sp.filter((id, i) => SPECIES_IDS.includes(id) && r.sp.indexOf(id) === i) : [],
    dm: Math.max(0, Math.floor(num(r.dm))),
  };
}

const DOCK = ["DIVE", "CRAFT", "REFIT", "START", "DAILY", "GUIDE", "FEATS", "LOG"];

// Fixed scenery: plankton in two layers and a rock line, scrolled by the distance travelled.
const sceneRng = new Random(77);
const MOTES = Array.from({ length: 70 }, (_, i) => [sceneRng.range(0, 960), sceneRng.range(30, 510), i < 40 ? 0.35 : 0.8, sceneRng.range(1, 2.6)]);
// Kelp fronds (x over a 1200 px loop, height, sway phase) and vent chimneys (x over the same loop).
const KELP = Array.from({ length: 13 }, () => [sceneRng.range(0, 1200), sceneRng.range(110, 240), sceneRng.range(0, TAU)]);
const VENTS = [140, 470, 790, 1060];
const wrap = (x, n) => ((x % n) + n) % n;
const rockY = (x) => 30 * Math.sin(x / 97) + 16 * Math.sin(x / 41 + 1.3) + 9 * Math.sin(x / 17 + 0.4);

export class Undertow {
  constructor(ctx) {
    this.c = ctx;
    this.lamps = new LampBus(ctx);
    // Takes back a menu gesture that reached the game (docs/ENGINE.md), and holds back the score and
    // the save until the gesture can no longer be under way.
    this.guard = new AppGuard(this, ctx);
    this.sv = migrateSave(ctx.progress?.());
    this.t = 0;
    this.parts = new Float32Array(MAX_PARTS * 5); // x, y, vx, vy, life
    this.partNext = 0;
    this.armed = false;
    this.pt = 0;
    this.view = "menu";
    this.cur = 0;
    this.page = 0;
    this.rc = 0; // the refit list's cursor
    this.daily = false;
    this.lstate = 1; // the sea life's generator state
    this.dstate = 0;
    this.lastHint = "";
    this.newFeats = [];
    this.result = null;
    this.launches = 0; // dives started in this session; the first waits for a press
    this.reset();
    this.phase = "title";
    this.setHint("Tap to dive. Hold for the dock.");
  }
  get craft() { return CRAFTS[this.daily ? 0 : this.sv.sel.craft] || CRAFTS[0]; }
  // A refit's level for this dive (none on the daily dive).
  lv(id) { return this.daily ? 0 : this.sv.up[UPGRADES.findIndex((u) => u.id === id)] || 0; }
  reset() {
    this.ended = false;
    this.deadT = 0;
    this.y = 270;
    this.vy = 0;
    this.held = false;
    this.gates = [];
    this.pearls = [];
    this.next = FIRST_GATE;
    this.lastCenter = 270;
    this.reason = "";
    const start = this.daily ? 0 : Math.min(this.sv.sel.start, this.sv.far);
    this.startZone = start;
    this.points = ZONES[start].at;
    this.zone = start;
    this.startHull = this.craft.hull;
    this.hull = this.startHull;
    this.shield = 0;
    this.grace = 0;
    this.dist = reachDist(this.points);
    this.best0 = this.c.best?.() ?? 0;
    this.note = ""; this.noteT = 0;
    this.trail = [];
    this.ping = 0; // sonar ring radius, in the Abyss
    this.pingT = 0;
    this.flashT = 0;
    this.clean = 0;
    this.noHit = 0;
    this.lastRun = 0;
    this.sinceShield = 0;
    this.R = { zone: start, pearls: 0, cleanBest: 0, noHitBest: 0, shielded: 0, skims: 0, lastBest: 0, daily: 0, found: [], lifeP: 0 };
    this.life = [];
    this.lifeNext = 1.2;
    this.bannerT = 0;
    this.newFeats = [];
    this.goalDone = false;
    this.parked = 0; // seconds the craft holds its depth before the dive starts
  }
  setHint(message) {
    if (message === this.lastHint) return;
    this.lastHint = message;
    this.c.hint(message);
  }
  // A plain dive counts for the console's best score: from the shallows, not the daily dive.
  plainRun() { return !this.daily && this.startZone === 0; }

  // ---- input -----------------------------------------------------------------------------------
  // In play the button is the thruster. On the title, result and dock screens a press is decided
  // when it ends: a tap dives (or moves to the next line), a press of HOLD_PICK seconds or more
  // opens or operates the dock.
  down() {
    this.guard.mark();
    if (this.phase === "title" || this.phase === "dock" || (this.phase === "over" && this.deadT > LOCKOUT)) {
      this.armed = true;
      this.pt = this.t;
      return;
    }
    if (this.phase === "play") { this.held = true; this.parked = 0; }
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
  pause() {
    this.guard.settle();
    // Leaving mid-dive keeps the passages made so far.
    if (this.phase === "play" && this.points > 0 && this.plainRun()) this.c.score(this.points);
    this.armed = false;
    this.held = false;
    this.lamps.sleep();
  }
  resume() { this.lamps.wake(); }
  dispose() { this.pause(); }

  menuPress(dur) {
    const long = dur >= HOLD_PICK;
    if (this.phase === "title" || this.phase === "over") {
      if (long) this.openDock();
      else { this.daily = false; this.start(); }
      return;
    }
    if (this.view === "refit") {
      if (!long) { this.rc = (this.rc + 1) % (UPGRADES.length + 1); this.c.tone(440, 0.03, "sine"); return; }
      if (this.rc === UPGRADES.length) this.view = "menu";
      else this.buy(this.rc);
      return;
    }
    if (this.view !== "menu") {
      if (long || this.view !== "feats") { this.view = "menu"; this.page = 0; }
      else this.page = (this.page + 1) % Math.ceil(FEATS.length / 5);
      return;
    }
    if (!long) { this.cur = (this.cur + 1) % DOCK.length; this.c.tone(440, 0.03, "sine"); return; }
    this.dockChoose();
  }
  openDock() {
    this.phase = "dock";
    this.view = "menu";
    this.cur = 0;
    this.page = 0;
    this.setHint("Tap: next line. Hold: choose.");
  }
  dockChoose() {
    const row = DOCK[this.cur], s = this.sv.sel;
    if (row === "DIVE") { this.daily = false; this.start(); return; }
    if (row === "DAILY") { this.daily = true; this.start(); return; }
    if (row === "FEATS") { this.view = "feats"; this.page = 0; return; }
    if (row === "LOG") { this.view = "log"; return; }
    if (row === "GUIDE") { this.view = "guide"; return; }
    if (row === "REFIT") { this.view = "refit"; this.rc = 0; return; }
    if (row === "CRAFT") {
      // The next craft that is owned, or affordable (and then bought).
      for (let k = 1; k <= CRAFTS.length; k++) {
        const i = (s.craft + k) % CRAFTS.length;
        if (this.sv.own[i]) { s.craft = i; break; }
        if (this.sv.bank >= CRAFTS[i].cost) {
          this.sv.bank -= CRAFTS[i].cost;
          this.sv.own[i] = 1;
          s.craft = i;
          this.c.tone(523, 0.1, "sine"); this.c.tone(784, 0.2, "sine");
          break;
        }
      }
    } else if (row === "START") s.start = (Math.min(s.start, this.sv.far) + 1) % (this.sv.far + 1);
    this.c.tone(520, 0.05, "sine");
    this.persist();
  }
  // Buy the next level of a refit, if there is one and the bank holds its price.
  buy(i) {
    const u = UPGRADES[i], level = this.sv.up[i], cost = u.costs[level];
    if (cost === undefined || this.sv.bank < cost) { this.c.tone(150, 0.12, "triangle"); return; }
    this.sv.bank -= cost;
    this.sv.up[i]++;
    this.c.tone(523, 0.1, "sine"); this.c.tone(784, 0.2, "sine");
    this.persist();
  }
  start() {
    this.dstate = this.daily ? (mixSeed(hashText("dive" + ymd(new Date()))) || 1) : 0;
    this.reset();
    this.phase = "play";
    this.lstate = mixSeed(Math.floor(this.t * 1000) + 7 * this.launches) || 1;
    // The first dive of a session holds still until the first press (or for three seconds), so a
    // newcomer can read the screen before the craft starts to sink.
    this.parked = this.launches++ === 0 ? 3 : 0;
    this.c.tone(330, 0.08, "triangle");
    if (this.startZone > 0) this.announce(ZONES[this.startZone].name, 2.4);
    else if (this.daily) this.announce("DAILY: " + dailyGoal(ymd(new Date())).text.toUpperCase(), 3);
    this.setHint("Hold to rise. Release to sink. Pass through the openings.");
  }
  announce(message, seconds = 2.6) { this.note = message; this.noteT = seconds; }

  // ---- the dive --------------------------------------------------------------------------------
  rng() {
    if (!this.daily) return this.c.rng;
    dailyRng.state = this.dstate;
    return dailyRng;
  }
  spawnGate() {
    const rng = this.rng();
    const gate = nextGate(this.lastCenter, this.points, rng);
    this.lastCenter = gate.base;
    if (this.gates.length < MAX_GATES) this.gates.push(gate);
    // Pearls: one in most openings from the third column on (never the first few seconds), placed off
    // the middle so collecting one is a choice; a short arc between columns now and then.
    const z = zoneAt(this.points);
    if (this.points >= 2 && this.pearls.length < MAX_PEARLS - 3) {
      const roll = rng.next();
      if (roll < (z >= 1 ? 0.55 : 0.3)) {
        const off = rng.range(-1, 1) * (gate.gap / 2 - 24);
        this.pearls.push({ x: gate.x + COL / 2, dy: off, gate: true, kind: 0, got: 0, ref: gate.base });
        // Keep it with the opening: a drifting opening carries its pearl.
        this.pearls[this.pearls.length - 1].g = this.gates.length - 1;
      } else if (z >= 1 && roll < 0.75) {
        const spacing = undertowSpeed(this.points) * gateInterval(this.points);
        const y0 = clamp(gate.base + rng.range(-90, 90), 90, 450);
        for (let i = 0; i < 3; i++) this.pearls.push({ x: gate.x - spacing * 0.5 + (i - 1) * 46, dy: 0, y: y0 + (i === 1 ? -22 : 0), gate: false, kind: 0, got: 0 });
      }
      // A shield bubble from the Trench on, about one column in sixteen, never while one is held.
      this.sinceShield++;
      if (z >= 2 && !this.shield && this.sinceShield > 12 && rng.next() < 0.12) {
        this.sinceShield = 0;
        this.pearls.push({ x: gate.x + COL / 2, dy: rng.range(-0.5, 0.5) * (gate.gap / 2 - 30), gate: true, kind: 1, got: 0, g: this.gates.length - 1 });
      }
    }
    if (this.daily) this.dstate = dailyRng.state;
    this.next = gateInterval(this.points);
  }
  // The opening's top and bottom for a column right now.
  span(gate) {
    const gap = gate.gap + (gate.breathe ? gate.breathe * Math.sin(gate.age * 2.2 + gate.phase) : 0);
    return [gate.center - gap / 2, gate.center + gap / 2];
  }
  hit(reason) {
    if (this.phase !== "play" || this.grace > 0) return;
    this.reason = reason;
    this.noHit = 0;
    this.clean = 0;
    this.burst(CX, this.y, 12, 150, 1);
    if (this.shield) {
      this.shield = 0; this.grace = 1.0; this.R.shielded = 1;
      this.c.tone(880, 0.12, "sine"); this.c.tone(440, 0.2, "sine");
      this.announce("SHIELD SPENT", 1.4);
      this.lamps.flash(0.3, () => fill(LAMP.white, 0.5));
      return;
    }
    if (this.hull > 1) {
      this.hull--; this.grace = 1.4;
      this.c.tone(120, 0.25, "triangle");
      this.announce("HULL BREACH", 1.6);
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
    this.phase = "over";
    this.deadT = 0;
    this.c.tone(80, 0.35, "triangle");
    this.lamps.flash(0.6, (e, T) => fill(LAMP.red, 0.6 * (1 - e / T)));
    this.finish();
  }
  // Bank the dive: pearls, feats, the daily goal, bests and the result card. The console score and
  // the save go through the guard, so a death the menu gesture caused never reaches either.
  finish() {
    const sv = this.sv, R = this.R;
    const passages = this.points;
    const key = ymd(new Date());
    this.goalDone = this.daily && this.goalMet();
    if (this.goalDone && !(sv.dl.d === key && sv.dl.done)) R.daily = 1;
    sv.runs++;
    // Feats read the run's counters on top of the totals, so they are checked before the totals grow.
    this.checkFeats(true);
    sv.bank += R.pearls + R.lifeP;
    sv.st.pearls += R.pearls;
    for (const id of R.found) if (!sv.sp.includes(id)) sv.sp.push(id);
    const metres = this.metres();
    sv.dm = Math.max(sv.dm, metres);
    sv.st.passages += passages - ZONES[this.startZone].at;
    sv.far = Math.max(sv.far, R.zone);
    if (this.daily) {
      if (sv.dl.d !== key) { sv.dl.d = key; sv.dl.best = 0; sv.dl.done = 0; }
      sv.dl.best = Math.max(sv.dl.best, passages);
      if (R.daily) {
        sv.dl.done = 1;
        sv.st.daily++;
        sv.dl.streak = sv.dl.last && dayBefore(key) === sv.dl.last ? sv.dl.streak + 1 : 1;
        sv.dl.last = key;
      }
    } else if (this.startZone === 0) sv.cb[sv.sel.craft] = Math.max(sv.cb[sv.sel.craft] || 0, passages);
    this.result = { passages, reason: this.reason, milestone: Math.floor(passages / 5), pearls: R.pearls, zone: ZONES[R.zone].name, metres, found: R.found.length };
    sv.milestone = Math.max(sv.milestone, this.result.milestone);
    sv.last = this.result;
    this.newRecord = this.plainRun() && passages > 0 && passages > this.best0;
    if (this.plainRun()) this.c.score(passages);
    this.persist();
    this.setHint("Tap to dive again. Hold for the dock.");
  }
  metres() { return Math.floor(this.dist / METRES); }
  goalMet() {
    const g = dailyGoal(ymd(new Date()));
    if (g.kind === "passages") return this.points >= g.n;
    if (g.kind === "pearls") return this.R.pearls >= g.n;
    return this.R.cleanBest >= g.n;
  }
  // Mark feats whose progress has reached its goal. `quiet` skips the announcement (result screen).
  checkFeats(quiet = false) {
    for (const f of FEATS) {
      if (this.sv.ft.includes(f.id)) continue;
      if (f.prog(this) >= f.n) {
        this.sv.ft.push(f.id);
        this.newFeats.push(f.id);
        this.sv.bank += FEAT_PEARLS;
        if (!quiet) {
          this.announce("FEAT: " + f.name, 2.4);
          this.c.tone(659, 0.1, "sine"); this.c.tone(880, 0.2, "sine");
        }
      }
    }
  }
  persist() {
    this.c.saveProgress?.(JSON.parse(JSON.stringify(this.sv)))?.catch?.(this.c.error);
  }

  update(dt) {
    if (!(dt > 0) || dt > 0.25) dt = 1 / 60;
    this.t += dt;
    this.guard.tick(dt);
    if (this.noteT > 0) this.noteT -= dt;
    if (this.flashT > 0) this.flashT -= dt;
    if (this.bannerT > 0) this.bannerT -= dt;
    this.stepParts(dt);
    if (this.phase === "play") this.fly(dt);
    else if (this.phase === "over") this.deadT += dt;
    this.lamps.frame(dt, this.phase === "play" ? this.lampValues() : null);
    this.hud();
  }
  fly(dt) {
    const k = this.craft, speed = undertowSpeed(this.points);
    this.grace = Math.max(0, this.grace - dt);
    this.dist += speed * dt;
    // Thrust and sinking, plus the current of the column ahead (if any) while the craft is in its band.
    let push = 0;
    for (const gate of this.gates) {
      if (gate.cur && gate.x > CX && gate.x - CX < speed * gateInterval(this.points) * 0.75) { push = gate.cur; break; }
    }
    this.push = push;
    if (this.parked > 0) { this.parked = Math.max(0, this.parked - dt); this.vy = 0; }
    // Thrust against a fall, or sinking against a climb, bites harder: the craft answers the button at once.
    const accel = this.held ? -k.up * (this.vy > 0 ? 1.7 : 1) : k.down * (this.vy < 0 ? 1.25 : 1);
    if (!this.parked) {
      this.vy = clamp(this.vy + (accel + push) * dt, -k.vmax, k.vmax);
      this.y += this.vy * dt;
      this.next -= dt;
      if (this.next <= 0) this.spawnGate();
    }
    if (this.held && this.t % 0.05 < dt) this.exhaust();
    const z = zoneAt(this.points);
    this.swim(dt, speed);
    for (const gate of this.gates) {
      gate.x -= speed * dt;
      gate.age += dt;
      if (gate.amp) gate.center = gate.base + gate.amp * Math.sin(gate.phase + gate.age * 0.9);
      if (gate.lit > 0) gate.lit -= dt;
      const [top, bottom] = this.span(gate);
      const inside = gate.x < HIT_R && gate.x + COL > HIT_L;
      if (inside) gate.margin = Math.min(gate.margin ?? 999, this.y - k.r - top, bottom - (this.y + k.r));
      // Credit once the craft's column is clear of the gate.
      if (gate.x + COL < HIT_L && !gate.passed) {
        gate.passed = true;
        this.pass(gate, bottom - top);
      }
      if (inside && (this.y - k.r < top || this.y + k.r > bottom)) this.hit("COLUMN CONTACT");
    }
    this.gates = this.gates.filter((o) => o.x > -90);
    // Pearls ride with their column (and its drift) or sit where they were placed.
    const reach = PEARL_R + 12 * this.lv("magnet");
    for (const p of this.pearls) {
      p.x -= speed * dt;
      if (p.gate) {
        const gate = this.gates.find((q) => Math.abs(q.x + COL / 2 - p.x) < 2);
        p.y = gate ? gate.center + p.dy * (this.span(gate)[1] - this.span(gate)[0]) / gate.gap : p.y ?? 270;
      }
      if (!p.got && p.y !== undefined && Math.abs(p.x - CX) < reach && Math.abs(p.y - this.y) < reach) this.collect(p);
    }
    this.pearls = this.pearls.filter((p) => p.x > -30 && !p.got);
    if (this.y < TOP || this.y > FLOOR) {
      const top = this.y < TOP;
      this.hit(top ? "SURFACE LIMIT / RELEASE TO DESCEND" : "DEPTH LIMIT / HOLD TO ASCEND");
      if (this.phase === "play") { this.y = clamp(this.y, TOP + 4, FLOOR - 4); this.vy = 0; }
    }
    // The Abyss: a sonar ping every 1.6 s lights the columns it reaches.
    if (z === 3) {
      this.pingT += dt;
      if (this.pingT >= 1.6) { this.pingT = 0; this.ping = 1; this.c.tone(1320, 0.04, "sine"); }
      if (this.ping > 0) {
        const r0 = this.ping;
        this.ping += 760 * dt;
        for (const gate of this.gates) {
          const d = gate.x + COL / 2 - CX;
          if (d >= r0 && d < this.ping) gate.lit = 1.1;
        }
        if (this.ping > 1000) this.ping = 0;
      }
    } else this.ping = 0;
    this.trail.unshift({ x: CX - 14, y: this.y });
    if (this.trail.length > 30) this.trail.pop();
    for (const p of this.trail) p.x -= speed * dt;
  }
  // Sea life: a creature from the zone's two species now and then, the ones not yet logged more
  // often. Flying close for a moment logs one; fish and schools shy away from the craft.
  swim(dt, speed) {
    if (!this.parked) this.lifeNext -= dt;
    if (this.lifeNext <= 0 && this.life.length < MAX_LIFE) {
      lifeRng.state = this.lstate;
      const pool = SPECIES.filter((s) => s.zone === this.zone);
      const fresh = pool.filter((s) => !this.known(s.id));
      const lure = this.lv("lure");
      const s = fresh.length && lifeRng.next() < (lure ? 0.9 : 0.7) ? lifeRng.pick(fresh) : lifeRng.pick(pool);
      const slow = s.kind === "jelly" || s.kind === "ray";
      this.life.push({ id: s.id, x: 1020, y: lifeRng.range(90, 440), vx: slow ? lifeRng.range(-20, 20) : lifeRng.range(-70, 10), ph: lifeRng.range(0, TAU), scan: 0, done: this.known(s.id) ? 1 : 0, fl: 0 });
      this.lifeNext = lifeRng.range(2.2, 4.4) / (lure ? 2 : 1);
      this.lstate = lifeRng.state;
    }
    const scanner = this.lv("scanner"), range = 70 + 40 * scanner, need = scanner ? 0.3 : 0.45;
    for (const f of this.life) {
      const s = SPECIES_BY[f.id];
      f.x += (f.vx - speed) * dt;
      f.ph += dt;
      const dx = f.x - CX, dy = f.y - this.y, d = Math.hypot(dx, dy);
      f.fl = d < 120 ? Math.min(1, f.fl + dt * 4) : Math.max(0, f.fl - dt * 0.8);
      if (s.kind !== "jelly" && f.fl > 0) f.y = clamp(f.y + (dy < 0 ? -1 : 1) * 150 * f.fl * dt, 60, 480);
      if (!f.done && this.phase === "play") {
        if (d < range) { f.scan += dt; if (f.scan >= need) this.logLife(f, s); }
        else f.scan = Math.max(0, f.scan - dt * 0.5);
      }
    }
    if (this.life.length && this.life[0].x < -140) this.life = this.life.filter((f) => f.x > -140);
  }
  known(id) { return this.sv.sp.includes(id) || this.R.found.includes(id); }
  logLife(f, s) {
    f.done = 1;
    this.R.found.push(s.id);
    this.R.lifeP += SPECIES_PEARLS;
    this.announce("NEW SPECIES: " + s.name + "  +" + SPECIES_PEARLS, 2.2);
    this.c.tone(784, 0.08, "sine"); this.c.tone(1175, 0.14, "sine");
    this.burst(f.x, f.y, 6, 80, 2);
    const at = clamp((f.y - TOP) / (FLOOR - TOP), 0, 1);
    this.lamps.flash(0.25, (e, T, a) => lampMax(a, spot(at, dim(LAMP.white, 0.5))));
    this.checkFeats();
  }
  pass(gate, gap) {
    const k = this.craft;
    this.points++;
    this.noHit++;
    this.R.noHitBest = Math.max(this.R.noHitBest, this.noHit);
    if (this.hull === 1 && this.startHull > 1) { this.lastRun++; this.R.lastBest = Math.max(this.R.lastBest, this.lastRun); } else this.lastRun = 0;
    // Clean: the craft kept a third of the opening clear on both sides all the way through.
    const clean = gate.margin >= (gap - 2 * k.r) * 0.3;
    if (gate.margin >= 0 && gate.margin <= SKIM) { this.R.skims++; this.burst(CX, this.y, 4, 90, 0); }
    if (clean) {
      this.clean++;
      this.R.cleanBest = Math.max(this.R.cleanBest, this.clean);
      if (this.clean % 5 === 0) {
        const pay = (this.lv("assay") ? 5 : 3) * k.pearl;
        this.R.pearls += pay;
        this.announce("CLEAN x" + this.clean + "  +" + pay + " PEARLS", 1.6);
        this.c.tone(988, 0.08, "sine");
      }
    } else this.clean = 0;
    this.c.tone(clean ? 660 : 550, 0.12);
    this.lamps.flash(0.12, (e, T, a) => lampMax(a, only(1, LAMP.green, clean ? 0.9 : 0.6)));
    if (this.points % 12 === 0 && this.hull < this.startHull + 1) { this.hull++; this.announce("HULL REPAIRED"); }
    const z = zoneAt(this.points);
    if (z > this.zone) {
      this.zone = z;
      this.R.zone = Math.max(this.R.zone, z);
      this.flashT = 1.2;
      this.bannerT = 2.4; // the zone's name along the top edge
      [392, 523, 659].forEach((hz, i) => this.c.tone(hz, 0.12 + 0.05 * i, "triangle"));
      const col = ZONES[z].lamp;
      this.lamps.flash(1.0, (e) => only(chase(e, 6, false), col, 0.6));
    }
    this.checkFeats();
  }
  collect(p) {
    p.got = 1;
    if (p.kind === 1) {
      this.shield = 1;
      this.announce("SHIELD / ONE HIT IS FREE", 1.8);
      this.c.tone(523, 0.08, "sine"); this.c.tone(1047, 0.16, "sine");
      return;
    }
    const k = this.craft;
    this.R.pearls += k.pearl;
    this.burst(p.x, p.y, 5, 70, 2);
    this.c.tone(1175 + 60 * (this.R.pearls % 5), 0.06, "sine");
    this.lamps.flash(0.12, (e, T, a) => lampMax(a, spot(clamp((this.y - TOP) / (FLOOR - TOP), 0, 1), LAMP.white, 0.7).map((v) => Math.round(v * 0.5))));
    this.checkFeats();
  }

  // ---- particles: exhaust bubbles, sparks and pearl glints -------------------------------------
  exhaust() {
    const k = this.partNext++ % MAX_PARTS, o = k * 5;
    this.parts[o] = CX - 18; this.parts[o + 1] = this.y + 10;
    this.parts[o + 2] = -undertowSpeed(this.points) * 0.55 - 40 * ((this.partNext % 3) / 3);
    this.parts[o + 3] = 130 + 50 * ((this.partNext % 4) / 4);
    this.parts[o + 4] = 0.55;
  }
  burst(x, y, n, speed, kind) {
    for (let i = 0; i < n; i++) {
      const k = this.partNext++ % MAX_PARTS, o = k * 5, a = (i / n) * TAU + this.t * 3;
      this.parts[o] = x; this.parts[o + 1] = y;
      this.parts[o + 2] = Math.cos(a) * speed; this.parts[o + 3] = Math.sin(a) * speed;
      this.parts[o + 4] = kind === 1 ? -0.5 : kind === 2 ? -0.35 : -0.3; // negative life: a spark, not a bubble
    }
  }
  stepParts(dt) {
    for (let k = 0; k < MAX_PARTS; k++) {
      const o = k * 5, l = this.parts[o + 4];
      if (l === 0) continue;
      this.parts[o] += this.parts[o + 2] * dt;
      this.parts[o + 1] += this.parts[o + 3] * dt;
      if (l > 0) { this.parts[o + 3] -= 380 * dt; this.parts[o + 4] = Math.max(0, l - dt); } // bubbles turn and rise
      else this.parts[o + 4] = Math.min(0, l + dt);
    }
  }

  // ---- HUD and lamps ---------------------------------------------------------------------------
  hud() {
    const items = this.phase === "play"
      ? [["PASSAGES", this.points], ["HULL", (this.hull ? "◇".repeat(this.hull) : "0") + (this.shield ? " +" : "")], ["PEARLS", this.R.pearls], ["BEST", this.daily ? this.sv.dl.best : this.c.best()]]
      : [["PEARLS", this.sv.bank], ["CRAFT", this.craft.name], ["DEEPEST", ZONES[this.sv.far].name], ["BEST", this.c.best()]];
    const key = items.map((x) => x[1]).join("|");
    if (key === this.lastHud) return;
    this.lastHud = key;
    this.c.hud(items);
  }
  // The craft is a cyan spot at its depth; the next opening is an amber spot that brightens as it
  // arrives (brighter still in the Abyss, where the lamps are the clearest view). Near the surface
  // or the floor the end lamp pulses red. A current adds a faint blue on the side it pushes toward.
  lampValues() {
    const at = (y) => clamp((y - TOP) / (FLOOR - TOP), 0, 1);
    let out = spot(at(this.y), dim(this.shield ? LAMP.white : LAMP.cyan, this.shield ? 0.22 : 0.33));
    const gate = this.gates.find((q) => q.x + COL > HIT_L);
    if (gate) {
      const eta = Math.max(0, gate.x - HIT_L) / undertowSpeed(this.points);
      const dark = this.zone === 3 ? 0.12 : 0;
      out = lampMax(out, spot(at(gate.center), dim(LAMP.amber, 0.12 + dark + 0.2 * clamp(1 - eta / 2.2, 0, 1))));
    }
    if (this.push) out = lampMax(out, only(this.push < 0 ? 0 : 2, LAMP.blue, 0.18));
    if (this.grace > 0) return lampMax(out, fill(LAMP.red, 0.3 * blink(this.grace, 6)));
    if (this.y < 70 || this.y > 470) out = lampMax(out, only(this.y < 70 ? 0 : 2, LAMP.red, 0.15 + 0.6 * blink(this.t, 4)));
    return out;
  }

  // ---- drawing ---------------------------------------------------------------------------------
  draw(g) {
    const diving = this.phase === "play" || this.phase === "over";
    const zi = diving ? this.zone : this.sv.far;
    const Z = ZONES[zi];
    g.fillStyle = Z.water;
    g.fillRect(0, 0, 960, 540);
    this.drawScene(g, Z, zi, diving);
    if (diving) this.drawDive(g, Z, zi);
    if (this.phase === "title") this.drawTitle(g, zi);
    else if (this.phase === "over") this.drawResult(g);
    else if (this.phase === "dock") this.drawDock(g);
    this.drawHoldRing(g);
  }
  // The water behind the columns: light from the surface, a far ridge, plankton, and each zone's own
  // floor (kelp, vents) and drift (glowing specks in the Abyss, falling snow in the Deep).
  drawScene(g, Z, zi, diving) {
    const d = diving ? this.dist : this.t * 40, t = this.t;
    if (zi === 0) {
      g.fillStyle = "#cfeee6";
      for (let i = 0; i < 5; i++) {
        const x = wrap(i * 230 - d * 0.1, 1150) - 120, sway = 30 * Math.sin(t * 0.4 + i);
        g.globalAlpha = 0.04 + 0.02 * Math.sin(t * 0.7 + i * 2);
        g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 60, 0); g.lineTo(x + 170 + sway, 540); g.lineTo(x + 80 + sway, 540); g.closePath(); g.fill();
      }
      g.globalAlpha = 1;
    }
    // The far ridge at a fifth of the speed, and a far ceiling from the Trench down.
    const far = d * 0.2;
    g.fillStyle = Z.far;
    g.beginPath(); g.moveTo(0, 540);
    for (let x = 0; x <= 960; x += 32) g.lineTo(x, 432 + rockY(x * 1.6 + far + 500) * 1.4);
    g.lineTo(960, 540); g.closePath(); g.fill();
    if (zi >= 2) {
      g.beginPath(); g.moveTo(0, 0);
      for (let x = 0; x <= 960; x += 32) g.lineTo(x, 46 + rockY(x * 1.3 + far + 2000) * 1.1);
      g.lineTo(960, 0); g.closePath(); g.fill();
    }
    if (zi === 2) { // distant trench walls
      g.globalAlpha = 0.55;
      for (let i = 0; i < 5; i++) g.fillRect(wrap(i * 260 - d * 0.3, 1300) - 120, 0, 34 + (i % 3) * 16, 540);
      g.globalAlpha = 1;
    }
    // Plankton in two layers; in the Abyss they glow and blink, in the Deep they fall like snow.
    g.fillStyle = zi === 5 ? "#b88478" : C.muted;
    for (const [x0, y0, par, s] of MOTES) {
      const x = wrap(x0 - d * par, 960), y = zi === 5 ? wrap(y0 + t * 22 * (par + 0.3), 540) : y0;
      if (zi === 3) { g.globalAlpha = 0.1 + 0.55 * Math.max(0, Math.sin(t * 1.3 + x0)); g.fillStyle = par > 0.5 ? "#c9a0ff" : "#7f9cff"; }
      else g.globalAlpha = par > 0.5 ? 0.5 : 0.25;
      g.fillRect(x, y, s * (par > 0.5 && zi !== 5 ? 2.2 : 1), s);
    }
    g.globalAlpha = 1;
    if (zi === 1) { // kelp swaying up from the floor
      g.strokeStyle = "#3e6b34"; g.lineWidth = 6; g.globalAlpha = 0.8;
      for (const [x0, h, ph] of KELP) {
        const x = wrap(x0 - d * 0.6, 1200) - 120;
        g.beginPath(); g.moveTo(x, 545);
        for (let k = 1; k <= 6; k++) g.lineTo(x + Math.sin(t * 1.4 + ph + k * 0.6) * k * 4, 545 - (h * k) / 6);
        g.stroke();
      }
      g.globalAlpha = 1;
    }
    if (zi === 4) { // vent chimneys and their smoke
      for (const v0 of VENTS) {
        const x = wrap(v0 - d * 0.5, 1200) - 120;
        g.fillStyle = Z.rock;
        g.beginPath(); g.moveTo(x - 20, 540); g.lineTo(x - 8, 466); g.lineTo(x + 8, 466); g.lineTo(x + 20, 540); g.closePath(); g.fill();
        g.globalAlpha = 0.5 + 0.3 * Math.sin(t * 3 + v0);
        circle(g, x, 466, 6, C.amber, true);
        g.fillStyle = "#8a7a6a";
        for (let j = 0; j < 6; j++) {
          const ph = (t * 0.45 + j / 6 + v0 / 97) % 1;
          g.globalAlpha = (1 - ph) * 0.16;
          g.beginPath(); g.arc(x + 14 * Math.sin(ph * 5 + j), 460 - ph * 300, 8 + ph * 26, 0, TAU); g.fill();
        }
        g.globalAlpha = 1;
      }
    }
    // The floor: a rock line moving at half speed.
    g.fillStyle = Z.rock;
    g.beginPath();
    g.moveTo(0, 540);
    const off = d * 0.5;
    for (let x = 0; x <= 960; x += 24) g.lineTo(x, 522 + rockY(x + off) * 0.5);
    g.lineTo(960, 540);
    g.closePath();
    g.fill();
    // The surface, shimmering, only in the upper zones.
    if (zi <= 1) {
      g.strokeStyle = "#2c4f49";
      g.lineWidth = 2;
      g.beginPath();
      for (let x = 0; x <= 960; x += 16) {
        const y = 14 + 4 * Math.sin((x + d * 0.8) / 60 + t * 2);
        x ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    }
    // Speed streaks deeper down, where the current is fast.
    if (this.phase === "play" && this.points >= 20) {
      g.strokeStyle = "#ffffff18";
      g.lineWidth = 1;
      for (let i = 0; i < 6; i++) {
        const y = 80 + i * 72, x = ((900 - (d * 1.4 + i * 211)) % 1100 + 1100) % 1100 - 80;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + 70, y); g.stroke();
      }
    }
  }
  // One creature at (x, y). `fl` is how startled it is (a school spreads out).
  drawCreature(g, s, x, y, ph, fl = 0) {
    const t = this.t;
    g.fillStyle = s.col;
    g.strokeStyle = s.col;
    const fish = (fx, fy, size) => {
      g.beginPath(); g.ellipse(fx, fy, 7 * size, 3 * size, 0, 0, TAU); g.fill();
      g.beginPath(); g.moveTo(fx + 5 * size, fy); g.lineTo(fx + 11 * size, fy - 4 * size); g.lineTo(fx + 11 * size, fy + 4 * size); g.closePath(); g.fill();
    };
    if (s.kind === "school") {
      for (let i = 0; i < 7; i++) {
        const spread = 1 + 2.5 * fl;
        fish(x + Math.cos(i * 2.4) * 20 * spread + (i - 3) * 7, y + Math.sin(i * 1.7 + t * 2 + ph) * 10 * spread + (i % 3 - 1) * 8, 1);
      }
    } else if (s.kind === "fish") {
      g.beginPath(); g.ellipse(x, y, 15, 6, 0, 0, TAU); g.fill();
      const w = Math.sin(t * 9 + ph) * 3;
      g.beginPath(); g.moveTo(x + 12, y); g.lineTo(x + 24, y - 7 + w); g.lineTo(x + 24, y + 7 + w); g.closePath(); g.fill();
      circle(g, x - 8, y - 1, 2, C.bg, true);
    } else if (s.kind === "jelly") {
      const p = 1 + 0.12 * Math.sin(t * 3 + ph);
      g.globalAlpha *= 0.85;
      g.beginPath(); g.arc(x, y, 16 * p, Math.PI, TAU); g.closePath(); g.fill();
      g.lineWidth = 2;
      for (let i = 0; i < 4; i++) {
        const tx = x - 10 + i * 7;
        g.beginPath(); g.moveTo(tx, y);
        for (let k = 1; k <= 4; k++) g.lineTo(tx + Math.sin(t * 3 + ph + k + i) * 3, y + k * 8 / p);
        g.stroke();
      }
    } else if (s.kind === "ray") {
      const f = Math.sin(t * 2.6 + ph);
      g.beginPath(); g.moveTo(x - 22, y); g.lineTo(x + 2, y - 20 - 6 * f); g.lineTo(x + 18, y); g.lineTo(x + 2, y + 20 + 6 * f); g.closePath(); g.fill();
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(x + 18, y); g.lineTo(x + 44, y + 4 * f); g.stroke();
      if (s.id === "ray") { circle(g, x - 2, y - 7, 2, C.bg, true); circle(g, x + 5, y + 6, 2, C.bg, true); }
    } else if (s.kind === "eel") {
      g.lineWidth = 5;
      g.beginPath();
      for (let k = 0; k <= 10; k++) {
        const ex = x + k * 9, ey = y + Math.sin(t * 5 + ph - k * 0.7) * (4 + k * 0.6);
        k ? g.lineTo(ex, ey) : g.moveTo(ex, ey);
      }
      g.stroke();
      circle(g, x + 1, y - 1, 1.5, C.bg, true);
    } else { // angler: a dark body and a lure that glows
      g.beginPath(); g.arc(x, y, 13, 0, TAU); g.fill();
      g.fillStyle = C.bg;
      g.beginPath(); g.moveTo(x - 14, y + 2); g.lineTo(x - 2, y + 4); g.lineTo(x - 13, y + 8); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(x + 10, y); g.lineTo(x + 22, y - 7); g.lineTo(x + 22, y + 7); g.closePath(); g.fillStyle = s.col; g.fill();
      g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(x - 3, y - 12); g.lineTo(x - 14, y - 26); g.lineTo(x - 24, y - 20); g.stroke();
      const glow = 0.6 + 0.4 * Math.sin(t * 4 + ph);
      circle(g, x - 24, y - 20, 7 * glow, "#fff3d055", true);
      circle(g, x - 24, y - 20, 3, "#fff3d0", true);
    }
  }
  drawDive(g, Z, zi) {
    const dark = zi === 3, t = this.t;
    // Sea life, behind the columns. A creature being logged wears a ring that fills.
    for (const f of this.life) {
      const s = SPECIES_BY[f.id], y = f.y + Math.sin(f.ph * 1.3) * 6;
      g.globalAlpha = f.done ? 0.75 : 1;
      this.drawCreature(g, s, f.x, y, f.ph, f.fl);
      g.globalAlpha = 1;
      if (!f.done && f.scan > 0) {
        const need = this.lv("scanner") ? 0.3 : 0.45;
        g.beginPath(); g.arc(f.x, y, 34, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(f.scan / need, 0, 1));
        g.strokeStyle = C.amber; g.lineWidth = 3; g.stroke();
      } else if (!f.done && f.x < 960) diamond(g, f.x, y - 30, 4, C.amber, false);
    }
    for (const gate of this.gates) {
      const [top, bottom] = this.span(gate);
      // In the Abyss a column shows only near the craft or where the sonar has just touched it.
      const near = clamp(1 - (gate.x - CX - 120) / 240, 0, 1);
      const alpha = dark ? Math.max(0.12, Math.min(1, gate.lit), near * 0.8) : 1;
      g.globalAlpha = alpha;
      this.drawColumn(g, gate, top, bottom, Z, zi, alpha);
      // A current: arrows in the water before the column, pointing the way it pushes.
      if (gate.cur) {
        const len = undertowSpeed(this.points) * gateInterval(this.points) * 0.75;
        g.strokeStyle = "#7fb0d8";
        g.lineWidth = 2;
        g.globalAlpha = alpha * 0.4;
        // Chevrons drifting the way the water pushes.
        const dir = Math.sign(gate.cur), ph = (t * 90) % 70;
        for (let x = gate.x - len + 30; x < gate.x - 20; x += 64) {
          for (let y = 50; y < 510; y += 70) {
            const yy = y + dir * ph;
            g.beginPath(); g.moveTo(x - 9, yy - 5 * dir); g.lineTo(x, yy + 5 * dir); g.lineTo(x + 9, yy - 5 * dir); g.stroke();
          }
        }
      }
      g.globalAlpha = 1;
    }
    if (this.ping > 0) {
      g.globalAlpha = clamp(1 - this.ping / 1000, 0, 1) * 0.6;
      g.beginPath(); g.arc(CX, this.y, this.ping, -0.9, 0.9); g.strokeStyle = "#c9a0ff"; g.lineWidth = 2; g.stroke();
      g.globalAlpha = 1;
    }
    for (const p of this.pearls) {
      if (p.y === undefined) continue;
      if (p.kind === 1) {
        circle(g, p.x, p.y, 13 + 2 * Math.sin(t * 6), C.cyan, false, 3);
        circle(g, p.x - 4, p.y - 4, 3, C.ink, true);
      } else {
        circle(g, p.x, p.y, 9 + Math.sin(t * 4 + p.x * 0.05), "#e8f2dc55", false, 2);
        circle(g, p.x, p.y, 5, "#e8f2dc", true);
        circle(g, p.x - 2, p.y - 2, 1.5, "#ffffff", true);
      }
    }
    // The wake.
    for (let i = 0; i < this.trail.length; i++) {
      const p = this.trail[i];
      g.globalAlpha = (1 - i / 30) * 0.45;
      circle(g, p.x, p.y, 2, C.cyan, true);
    }
    g.globalAlpha = 1;
    // Exhaust bubbles and sparks.
    for (let k = 0; k < MAX_PARTS; k++) {
      const o = k * 5, l = this.parts[o + 4];
      if (l === 0) continue;
      if (l > 0) { g.globalAlpha = Math.min(1, l * 2); circle(g, this.parts[o], this.parts[o + 1], 2 + (0.55 - l) * 7, "#bfe3dd", false, 2); }
      else { g.globalAlpha = Math.min(1, -l * 3); g.fillStyle = l < -0.4 ? C.red : C.ink; g.fillRect(this.parts[o] - 2, this.parts[o + 1] - 2, 4, 4); }
    }
    g.globalAlpha = 1;
    this.drawCraft(g, Z, zi);
    // The depth gauge, top right.
    text(g, this.metres() + " M", 944, 40, 18, Z.col, "right");
    // A new zone's name sits along the top edge, above the lane the craft flies in, and the usual
    // notice moves just below it while it shows.
    const banner = this.bannerT > 0 && this.phase === "play";
    if (banner) {
      g.globalAlpha = clamp(Math.min(this.bannerT / 0.6, (2.4 - this.bannerT) / 0.3), 0, 1) * 0.9;
      text(g, ZONES[this.zone].name, 480, 46, 32, Z.col, "center");
      text(g, ZONES[this.zone].note, 480, 74, 18, C.ink, "center");
      g.globalAlpha = 1;
    }
    if (this.noteT > 0 && this.phase === "play") text(g, this.note, 480, banner ? 102 : 44, 24, C.amber, "center");
    if (this.parked > 0 && this.phase === "play") {
      g.fillStyle = "#0c1511d8";
      g.fillRect(250, 330, 460, 96);
      text(g, "HOLD TO RISE / RELEASE TO SINK", 480, 360, 22, C.ink, "center");
      text(g, "PRESS TO GO", 480, 396, 22, C.amber, "center");
    }
    if (this.flashT > 0) {
      g.globalAlpha = clamp(this.flashT / 1.2, 0, 1) * 0.12;
      g.fillStyle = Z.col;
      g.fillRect(0, 0, 960, 540);
      g.globalAlpha = 1;
    }
  }
  // A column: rock with a lit near edge and a shaded far side, a cap at each lip, and the zone's own
  // growth (barnacles, kelp, strata, crystals, vent cracks, embers).
  drawColumn(g, gate, top, bottom, Z, zi, alpha) {
    const x = gate.x, t = this.t, v = gate.phase; // `phase` doubles as the column's look
    g.fillStyle = Z.rock;
    g.fillRect(x, 0, COL, top);
    g.fillRect(x, bottom, COL, 540 - bottom);
    g.fillStyle = Z.shade;
    g.fillRect(x + COL - 16, 0, 16, top);
    g.fillRect(x + COL - 16, bottom, 16, 540 - bottom);
    g.fillRect(x - 3, top - 12, COL + 6, 12);
    g.fillRect(x - 3, bottom, COL + 6, 12);
    g.globalAlpha = alpha * 0.3;
    g.fillStyle = Z.col;
    g.fillRect(x, 0, 4, top - 12);
    g.fillRect(x, bottom + 12, 4, 540 - bottom);
    g.globalAlpha = alpha;
    if (zi === 0) {
      for (let i = 0; i < 3; i++) {
        circle(g, x + 12 + i * 19 + (v * 3) % 6, top - 19, 3, "#7fa89c", false, 2);
        circle(g, x + 16 + i * 17, bottom + 19 + (i % 2) * 6, 3, "#7fa89c", false, 2);
      }
    } else if (zi === 1) {
      g.strokeStyle = "#4f8a44"; g.lineWidth = 3;
      for (let i = 0; i < 2; i++) {
        const sx = x + 16 + i * 26;
        g.beginPath(); g.moveTo(sx, top - 12);
        for (let k = 1; k <= 5; k++) g.lineTo(sx + Math.sin(t * 2 + v + k + i) * 4, top - 12 - k * 16);
        g.stroke();
        g.beginPath(); g.moveTo(sx, bottom + 12);
        for (let k = 1; k <= 5; k++) g.lineTo(sx + Math.sin(t * 2 + v + k - i) * 4, bottom + 12 + k * 16);
        g.stroke();
      }
    } else if (zi === 2) {
      g.fillStyle = Z.far;
      for (let y = 20 + (v * 7) % 30; y < 540; y += 34) if (y < top - 16 || y > bottom + 16) g.fillRect(x + 4, y, COL - 20, 2);
    } else if (zi === 3) {
      for (let i = 0; i < 3; i++) {
        const glow = 0.5 + 0.5 * Math.sin(t * 2 + v + i);
        g.globalAlpha = alpha * (0.4 + 0.6 * glow);
        diamond(g, x + 12 + i * 20, top - 18, 4 + i % 2 * 2, Z.col, true);
        diamond(g, x + 14 + i * 18, bottom + 18, 4 + (i + 1) % 2 * 2, Z.col, true);
      }
      g.globalAlpha = alpha;
    } else {
      // Vents and the Deep: a glowing crack down the face.
      g.strokeStyle = zi === 4 ? C.amber : C.red;
      g.lineWidth = 2;
      g.globalAlpha = alpha * (0.35 + 0.25 * Math.sin(t * 3 + v));
      for (const [y0, y1] of [[0, top - 14], [bottom + 14, 540]]) {
        if (y1 - y0 < 20) continue;
        g.beginPath(); g.moveTo(x + 24, y0);
        for (let y = y0 + 18, k = 0; y < y1; y += 18, k++) g.lineTo(x + 24 + ((k + Math.floor(v * 3)) % 3 - 1) * 9, y);
        g.stroke();
      }
      g.globalAlpha = alpha;
    }
    line(g, x - 3, top, x + COL + 3, top, Z.col, 3);
    line(g, x - 3, bottom, x + COL + 3, bottom, Z.col, 3);
  }
  drawCraft(g, Z, zi) {
    const k = this.craft, s = k.r / 14, play = this.phase === "play";
    g.globalAlpha = this.grace > 0 && Math.floor(this.grace * 10) % 2 ? 0.35 : 1;
    g.save();
    g.translate(CX, this.y);
    g.rotate(clamp(this.vy * 0.0018, -0.5, 0.5));
    // A headlight in the dark zones.
    if (play && (zi === 3 || zi === 5)) {
      const a = g.globalAlpha;
      g.globalAlpha = a * 0.045;
      g.fillStyle = "#e8f2dc";
      g.beginPath(); g.moveTo(24 * s, 0); g.lineTo(280, -80); g.lineTo(280, 80); g.closePath(); g.fill();
      g.globalAlpha = a;
    }
    // The thruster: a flame under the stern while held, longer the harder it is pushing.
    if (this.held && play) {
      const f = 0.75 + 0.25 * Math.sin(this.t * 47);
      g.fillStyle = C.amber;
      g.beginPath(); g.moveTo(-14 * s, 4 * s); g.lineTo(-44 * s - 22 * f, 30 * s + 14 * f); g.lineTo(-2 * s, 11 * s); g.closePath(); g.fill();
      g.fillStyle = "#fff3d0";
      g.beginPath(); g.moveTo(-11 * s, 6 * s); g.lineTo(-30 * s - 10 * f, 20 * s + 7 * f); g.lineTo(-4 * s, 10 * s); g.closePath(); g.fill();
    }
    const hullCol = this.phase === "over" ? C.red : C.cyan;
    // Fins, then the hull, a cockpit window with a glint, and a running light at the stern.
    g.fillStyle = this.phase === "over" ? "#8a3a3a" : "#4f9a92";
    g.beginPath(); g.moveTo(-2 * s, -6 * s); g.lineTo(-16 * s, -19 * s); g.lineTo(-11 * s, -5 * s); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(-2 * s, 6 * s); g.lineTo(-16 * s, 19 * s); g.lineTo(-11 * s, 5 * s); g.closePath(); g.fill();
    g.fillStyle = hullCol;
    g.beginPath();
    g.moveTo(26 * s, 0); g.lineTo(12 * s, -9 * s); g.lineTo(-15 * s, -10 * s); g.lineTo(-9 * s, 0); g.lineTo(-15 * s, 10 * s); g.lineTo(12 * s, 9 * s);
    g.closePath(); g.fill();
    g.fillStyle = C.bg;
    g.beginPath(); g.ellipse(7 * s, -2 * s, 7 * s, 4 * s, 0, 0, TAU); g.fill();
    g.fillStyle = "#e8f2dc";
    g.fillRect(8 * s, -4.5 * s, 3 * s, 1.5 * s);
    circle(g, -12 * s, 0, 2.5 * s, Math.floor(this.t * 2) % 2 ? Z.col : C.bg, true);
    if (this.shield) circle(g, 2, 0, k.r + 9, "#e8f2dc", false, 2);
    g.restore();
    g.globalAlpha = 1;
  }
  drawHoldRing(g) {
    if (!this.armed) return;
    const f = clamp((this.t - this.pt) / HOLD_PICK, 0, 1);
    if (f < 0.25) return;
    g.beginPath();
    g.arc(880, 70, 24, -Math.PI / 2, -Math.PI / 2 + TAU * f);
    g.strokeStyle = f >= 1 ? C.cyan : C.amber;
    g.lineWidth = 4;
    g.stroke();
  }
  drawTitle(g, zi) {
    const sv = this.sv, t = this.t;
    // The deepest zone's sea life drifts past behind the card.
    const pool = SPECIES.filter((s) => s.zone === zi);
    this.drawCreature(g, pool[0], wrap(1000 - t * 55, 1200) - 120, 96, 0, 0);
    this.drawCreature(g, pool[1], wrap(300 - t * 35, 1200) - 120, 470, 1, 0);
    g.fillStyle = "#0c1511e8";
    g.fillRect(140, 150, 680, 280);
    line(g, 195, 158, 765, 158, C.line);
    text(g, "UNDERTOW", 480, 204, 42, C.cyan, "center");
    text(g, "Hold to rise. Release to sink.", 480, 254, 22, C.muted, "center");
    text(g, "Follow the silent current down through six zones.", 480, 284, 22, C.muted, "center");
    if (sv.runs > 0) {
      text(g, "PEARLS " + sv.bank + "   DEEPEST " + ZONES[sv.far].name + (sv.dm ? " / " + sv.dm + " M" : ""), 480, 326, 18, C.muted, "center");
      text(g, "FIELD GUIDE " + sv.sp.length + " / " + SPECIES.length + "   FEATS " + sv.ft.length + " / " + FEATS.length, 480, 352, 18, C.muted, "center");
    }
    text(g, "TAP = DIVE     HOLD = DOCK", 480, 400, 22, C.amber, "center");
  }
  drawResult(g) {
    const r = this.result || { passages: this.points, pearls: 0, zone: ZONES[0].name, reason: this.reason, metres: this.metres(), found: 0 };
    g.fillStyle = "#0c1511ee";
    g.fillRect(170, 50, 620, 440);
    line(g, 210, 60, 750, 60, C.line, 2);
    text(g, "PRESSURE LIMIT", 480, 96, 36, C.cyan, "center");
    text(g, r.reason, 480, 128, 18, C.muted, "center");
    let y = 168;
    const row = (label, value, col = C.ink) => { text(g, label, 240, y, 18, C.muted); text(g, value, 720, y, 24, col, "right"); y += 32; };
    row("PASSAGES", r.passages);
    row("DEPTH", (r.metres || 0) + " M" + (r.metres && r.metres >= this.sv.dm ? "  DEEPEST" : ""));
    row("PEARLS", r.pearls + (this.R.lifeP ? " + " + this.R.lifeP : "") + " (BANK " + this.sv.bank + ")");
    row("DEEPEST ZONE", r.zone, ZONES[this.R.zone].col);
    row("BEST CLEAN RUN", this.R.cleanBest);
    if (r.found) row("NEW SPECIES", r.found + "  (GUIDE " + this.sv.sp.length + " / " + SPECIES.length + ")", C.cyan);
    y += 2;
    if (this.daily) { text(g, this.goalDone ? "DAILY GOAL MET" : "DAILY: " + dailyGoal(ymd(new Date())).text, 480, y, 18, this.goalDone ? C.cyan : C.muted, "center"); y += 28; }
    else {
      text(g, this.newRecord ? "NEW BEST" : this.plainRun() ? "BEST " + this.c.best() : "STARTED IN " + ZONES[this.startZone].name + " / NOT SCORED", 480, y, 18, this.newRecord ? C.cyan : C.amber, "center");
      y += 28;
    }
    for (const id of this.newFeats.slice(0, 2)) {
      const f = FEATS.find((x) => x.id === id);
      if (f) { text(g, "FEAT  " + f.name + "  +" + FEAT_PEARLS + " PEARLS", 480, y, 18, C.cyan, "center"); y += 26; }
    }
    if (y < 440) text(g, this.nextBuy(), 480, y, 18, C.muted, "center");
    if (this.deadT > LOCKOUT) text(g, "TAP = DIVE AGAIN     HOLD = DOCK", 480, 466, 20, C.amber, "center");
  }
  // What the bank buys next, for the result card.
  nextBuy() {
    const sv = this.sv;
    const offers = [];
    CRAFTS.forEach((k, i) => { if (!sv.own[i]) offers.push([k.cost, k.name]); });
    UPGRADES.forEach((u, i) => { if (u.costs[sv.up[i]] !== undefined) offers.push([u.costs[sv.up[i]], u.name]); });
    if (!offers.length) return "EVERY CRAFT AND REFIT OWNED";
    offers.sort((a, b) => a[0] - b[0]);
    const can = offers.filter((o) => o[0] <= sv.bank);
    return can.length ? can.at(-1)[1] + " CAN BE BOUGHT AT THE DOCK" : "NEXT: " + offers[0][1] + " AT " + offers[0][0] + " PEARLS";
  }
  drawDock(g) {
    g.fillStyle = "#0c1511f2";
    g.fillRect(110, 30, 740, 480);
    line(g, 160, 40, 800, 40, C.line);
    text(g, "DOCK", 480, 76, 34, C.cyan, "center");
    text(g, "PEARLS " + this.sv.bank, 800, 76, 20, C.amber, "right");
    const sv = this.sv, n = sv.ft.length;
    const key = ymd(new Date());
    if (this.view === "menu") {
      const k = CRAFTS[sv.sel.craft];
      const levels = sv.up.reduce((a, b) => a + b, 0), maxLevels = UPGRADES.reduce((a, u) => a + u.costs.length, 0);
      const rows = {
        DIVE: ["DIVE", ZONES[Math.min(sv.sel.start, sv.far)].name],
        CRAFT: ["CRAFT", k.name],
        REFIT: ["REFIT", levels + " / " + maxLevels],
        START: ["START ZONE", ZONES[Math.min(sv.sel.start, sv.far)].name],
        DAILY: ["DAILY DIVE", sv.dl.d === key && sv.dl.done ? "DONE TODAY" : "SEEDED BY DATE"],
        GUIDE: ["FIELD GUIDE", sv.sp.length + " / " + SPECIES.length],
        FEATS: ["FEATS", n + " / " + FEATS.length],
        LOG: ["LOG", "DEEPEST " + ZONES[sv.far].name],
      };
      DOCK.forEach((id, i) => {
        const y = 124 + i * 36, on = i === this.cur;
        if (on) diamond(g, 150, y, 9, C.amber, true);
        text(g, rows[id][0], 180, y, 22, on ? C.amber : C.ink);
        text(g, rows[id][1], 810, y, 20, on ? C.amber : C.muted, "right");
      });
      const id = DOCK[this.cur];
      let info;
      if (id === "DIVE") info = sv.sel.start ? "Starts in " + ZONES[sv.sel.start].name + ". Only dives from the shallows set a best." : "A dive from the shallows.";
      else if (id === "CRAFT") {
        const nextCraft = CRAFTS.find((x, i) => !sv.own[i]);
        info = k.text + (nextCraft ? "  NEXT: " + nextCraft.name + " " + nextCraft.cost + " PEARLS" : "");
      } else if (id === "REFIT") info = "Pearl and sea-life gear. It never helps you survive.";
      else if (id === "START") info = "Start in any zone you have reached.";
      else if (id === "DAILY") info = "Goal: " + dailyGoal(key).text + (sv.dl.streak > 1 ? "  STREAK " + sv.dl.streak : "");
      else if (id === "GUIDE") info = "Fly close to sea life to log it. " + SPECIES_PEARLS + " pearls for each new species.";
      else if (id === "FEATS") info = "Named goals, " + FEAT_PEARLS + " pearls each. Some are not listed.";
      else info = "Zones reached, the deepest dive and best dives by craft.";
      text(g, info, 480, 428, 18, C.muted, "center");
      text(g, "TAP = NEXT LINE     HOLD = CHOOSE", 480, 476, 18, C.cyan, "center");
    } else if (this.view === "refit") {
      text(g, "REFIT", 480, 116, 20, C.cyan, "center");
      UPGRADES.forEach((u, i) => {
        const y = 152 + i * 62, on = i === this.rc, level = sv.up[i], cost = u.costs[level];
        if (on) diamond(g, 150, y, 9, C.amber, true);
        text(g, u.name, 180, y, 22, on ? C.amber : C.ink);
        for (let j = 0; j < u.costs.length; j++) diamond(g, 560 + j * 22, y, 7, j < level ? C.cyan : C.line, j < level);
        text(g, cost === undefined ? "FITTED" : cost + " PEARLS", 810, y, 20, cost === undefined ? C.cyan : sv.bank >= cost ? C.amber : C.muted, "right");
        text(g, u.text, 180, y + 24, 16, C.muted);
      });
      const by = 152 + UPGRADES.length * 62, on = this.rc === UPGRADES.length;
      if (on) diamond(g, 150, by, 9, C.amber, true);
      text(g, "BACK", 180, by, 22, on ? C.amber : C.ink);
      text(g, "TAP = NEXT LINE     HOLD = BUY", 480, 476, 18, C.cyan, "center");
    } else if (this.view === "guide") {
      text(g, "FIELD GUIDE  " + sv.sp.length + " / " + SPECIES.length + "     " + SPECIES_PEARLS + " PEARLS FOR EACH NEW ONE", 480, 116, 18, C.cyan, "center");
      ZONES.forEach((zn, i) => {
        const y = 160 + i * 50;
        text(g, zn.name, 150, y + 6, 18, i <= sv.far ? zn.col : C.line);
        SPECIES.filter((s) => s.zone === i).forEach((s, j) => {
          const x = 366 + j * 236, got = sv.sp.includes(s.id);
          if (got) {
            g.save(); g.translate(x, y); g.scale(0.7, 0.7); this.drawCreature(g, s, 0, 0, i + j, 0); g.restore();
            text(g, s.name, x + 42, y + 6, 18, s.col);
          } else text(g, "? ? ?", x + 42, y + 6, 18, C.line);
        });
      });
      text(g, "TAP = BACK", 480, 476, 18, C.cyan, "center");
    } else if (this.view === "feats") {
      const per = 5, pages = Math.ceil(FEATS.length / per);
      text(g, "FEATS  " + n + " / " + FEATS.length + "     PAGE " + (this.page + 1) + " / " + pages, 480, 116, 20, C.cyan, "center");
      FEATS.slice(this.page * per, this.page * per + per).forEach((f, i) => {
        const y = 158 + i * 58, done = sv.ft.includes(f.id);
        text(g, (done ? "[X] " : "[ ] ") + (f.hidden && !done ? "????" : f.name), 150, y, 22, done ? C.cyan : C.ink);
        const prog = f.id === "hoard" ? sv.st.pearls : f.id === "regular" ? sv.runs : f.id === "daily" ? sv.st.daily : f.id === "spotter" || f.id === "guide" ? sv.sp.length : null;
        text(g, done ? "DONE" : prog !== null ? Math.min(prog, f.n) + " / " + f.n : "", 810, y, 20, done ? C.cyan : C.amber, "right");
        text(g, f.hidden && !done ? f.hint : f.text, 150, y + 26, 16, C.muted);
      });
      text(g, "TAP = NEXT PAGE     HOLD = BACK", 480, 476, 18, C.cyan, "center");
    } else {
      text(g, "LOG   DIVES " + sv.runs + "   PASSAGES " + sv.st.passages + "   PEARLS " + sv.st.pearls, 480, 116, 20, C.cyan, "center");
      ZONES.forEach((zn, i) => {
        const y = 154 + i * 30;
        text(g, zn.name, 180, y, 20, i <= sv.far ? zn.col : C.line);
        text(g, i <= sv.far ? "FROM PASSAGE " + zn.at : "NOT REACHED", 780, y, 18, i <= sv.far ? C.muted : C.line, "right");
      });
      CRAFTS.forEach((cr, i) => {
        const y = 346 + i * 28;
        text(g, cr.name, 180, y, 20, sv.own[i] ? C.ink : C.line);
        text(g, sv.own[i] ? "BEST " + sv.cb[i] : cr.cost + " PEARLS", 780, y, 18, sv.own[i] ? C.amber : C.line, "right");
      });
      text(g, "DEEPEST DIVE " + sv.dm + " M", 480, 440, 18, C.muted, "center");
      text(g, "TAP = BACK", 480, 476, 18, C.cyan, "center");
    }
  }
}
