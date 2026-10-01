// UNDERTOW — a one-button dive. Hold to thrust up, release to sink, and thread the openings
// between ancient columns while the current carries the craft deeper.
//
// The run is a descent through six zones, each adding one thing to read: pearls and drifting
// openings (Kelp Run), vertical currents between the columns (Trench), dark water where only a
// sonar ping and the lamps show the openings (Abyss), openings that breathe (Vent Field), and all
// of it at once (The Deep). Passing near the middle of an opening is a clean passage; a streak of
// them pays pearls. Pearls are banked between dives and buy two more craft at the dock.
//
// The dock (hold on the title or result screen) has the craft, a start zone, a daily dive seeded
// by the date, feats and a log. The save is versioned (schema 2) and still carries the fields the
// dashboard's field record reads (runs, last, milestone); a first-release save is migrated.
//
// The lamps are the depth gauge: a cyan spot where the craft is (left = surface, right = floor),
// an amber spot at the next opening that brightens as it arrives, so the two meet when the craft
// is lined up; red at the end lamp near the surface or the floor.
import { TAU, clamp, mixSeed, Random } from "../engine/math.js";
import { C, text, line, circle, diamond, glyph } from "../engine/draw.js";
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

export const ZONES = [
  { at: 0, name: "SHALLOWS", note: "", col: "#8fcbc5", water: "#0c1716", rock: "#264a3e", lamp: LAMP.cyan },
  { at: 8, name: "KELP RUN", note: "PEARLS AND DRIFTING OPENINGS", col: "#a5c58c", water: "#0d1812", rock: "#2d4a2a", lamp: LAMP.green },
  { at: 20, name: "THE TRENCH", note: "CURRENTS PUSH BETWEEN THE COLUMNS", col: "#7fb0d8", water: "#0b1219", rock: "#26405a", lamp: LAMP.blue },
  { at: 34, name: "THE ABYSS", note: "DARK WATER / THE SONAR AND THE LAMPS", col: "#c9a0ff", water: "#07090d", rock: "#2a2440", lamp: LAMP.violet },
  { at: 50, name: "VENT FIELD", note: "THE OPENINGS BREATHE", col: "#e7b879", water: "#130e0a", rock: "#4a3424", lamp: LAMP.amber },
  { at: 70, name: "THE DEEP", note: "EVERYTHING AT ONCE", col: "#eb947a", water: "#0e0808", rock: "#4a2626", lamp: LAMP.red },
];
const zoneAt = (points) => { for (let i = ZONES.length - 1; i > 0; i--) if (points >= ZONES[i].at) return i; return 0; };

// Craft bought with pearls at the dock. up/down are px/s^2, vmax px/s, r the hull radius in px.
export const CRAFTS = [
  { name: "SKIFF", hull: 2, up: 720, down: 470, vmax: 285, r: 14, pearl: 1, cost: 0, text: "Balanced. Two hull." },
  { name: "DART", hull: 1, up: 880, down: 560, vmax: 330, r: 11, pearl: 2, cost: 150, text: "Small and quick. One hull. Pearls count double." },
  { name: "BULWARK", hull: 3, up: 600, down: 410, vmax: 245, r: 16, pearl: 1, cost: 400, text: "Slow to answer. Three hull." },
];

// The next column, given the last opening's centre and the passages so far. The centre moves by at
// most 85 px between columns; the gap narrows from 250 px to 105 px; openings drift from the Kelp
// Run on. `rng` is the run's generator (the daily dive has its own).
export function nextGate(center, points, rng) {
  const reach = Math.min(85, 50 + points * 2);
  const base = clamp(center + rng.range(-reach, reach), 165, 375);
  const amp = points >= 8 ? Math.min(70, 14 + (points - 8) * 2.5) : 0;
  const z = zoneAt(points);
  // Currents from the Trench, on most columns there and on half of them in the Deep.
  const cur = (z === 2 || z === 5) && rng.next() < (z === 2 ? 0.7 : 0.5) ? (rng.next() < 0.5 ? -1 : 1) * (200 + Math.min(120, (points - 20) * 4)) : 0;
  // Breathing openings in the Vent Field and the Deep.
  const breathe = z >= 4 && rng.next() < 0.75 ? 26 + Math.min(16, (points - 50)) : 0;
  return { x: 1010, center: base, base, amp: z === 3 ? amp * 0.5 : amp, phase: rng.range(0, TAU), age: 0,
    gap: Math.max(105, 250 - points * 2.6), size: 0, passed: false, cur, breathe, margin: 999, lit: 0, ring: 0 };
}
export const undertowSpeed = (points) => 235 + Math.min(points * 3.2, 165);
export const gateInterval = (points) => Math.max(1.15, 1.6 - points * 0.012);

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
// Bring any stored shape (nothing; schema 1, written by recordRun in the first release; schema 2) to
// schema 2. A first-release save keeps its runs, last result and milestone, and the zones its best
// milestone shows were reached open as start zones.
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
    schema: 2,
    runs: Math.max(0, Math.floor(num(r.runs))),
    last: r.last && typeof r.last === "object" ? r.last : {},
    milestone,
    far,
    bank: Math.max(0, Math.floor(num(r.bank))),
    own,
    cb: CRAFTS.map((_, i) => Math.max(0, Math.floor(num(Array.isArray(r.cb) ? r.cb[i] : undefined)))),
    ft: Array.isArray(r.ft) ? r.ft.filter((id, i) => FEAT_IDS.includes(id) && r.ft.indexOf(id) === i) : [],
    st: { pearls: Math.max(0, num(st.pearls)), daily: Math.max(0, num(st.daily)), passages: Math.max(0, num(st.passages, r.schema === 2 ? 0 : lastPassages)) },
    sel: { craft: own[craft] ? craft : 0, start: clamp(Math.floor(num(sel.start)), 0, far) },
    dl: { d: day(dl.d), best: Math.max(0, num(dl.best)), done: dl.done ? 1 : 0, streak: Math.max(0, Math.floor(num(dl.streak))), last: day(dl.last) },
  };
}

const DOCK = ["DIVE", "CRAFT", "START", "DAILY", "FEATS", "LOG"];

// Fixed scenery: plankton in two layers and a rock line, scrolled by the distance travelled.
const sceneRng = new Random(77);
const MOTES = Array.from({ length: 70 }, (_, i) => [sceneRng.range(0, 960), sceneRng.range(30, 510), i < 40 ? 0.35 : 0.8, sceneRng.range(1, 2.6)]);
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
    this.daily = false;
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
    this.hull = this.craft.hull;
    this.shield = 0;
    this.grace = 0;
    this.dist = 0;
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
    this.R = { zone: start, pearls: 0, cleanBest: 0, noHitBest: 0, shielded: 0, skims: 0, lastBest: 0, daily: 0 };
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
    if (this.view !== "menu") {
      if (long || this.view === "log") { this.view = "menu"; this.page = 0; }
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
  start() {
    this.dstate = this.daily ? (mixSeed(hashText("dive" + ymd(new Date()))) || 1) : 0;
    this.reset();
    this.phase = "play";
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
    sv.bank += R.pearls;
    sv.st.pearls += R.pearls;
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
    this.result = { passages, reason: this.reason, milestone: Math.floor(passages / 5), pearls: R.pearls, zone: ZONES[R.zone].name };
    sv.milestone = Math.max(sv.milestone, this.result.milestone);
    sv.last = this.result;
    this.newRecord = this.plainRun() && passages > 0 && passages > this.best0;
    if (this.plainRun()) this.c.score(passages);
    this.persist();
    this.setHint("Tap to dive again. Hold for the dock.");
  }
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
    for (const p of this.pearls) {
      p.x -= speed * dt;
      if (p.gate) {
        const gate = this.gates.find((q) => Math.abs(q.x + COL / 2 - p.x) < 2);
        p.y = gate ? gate.center + p.dy * (this.span(gate)[1] - this.span(gate)[0]) / gate.gap : p.y ?? 270;
      }
      if (!p.got && p.y !== undefined && Math.abs(p.x - CX) < PEARL_R && Math.abs(p.y - this.y) < PEARL_R) this.collect(p);
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
  pass(gate, gap) {
    const k = this.craft;
    this.points++;
    this.noHit++;
    this.R.noHitBest = Math.max(this.R.noHitBest, this.noHit);
    if (this.hull === 1 && k.hull > 1) { this.lastRun++; this.R.lastBest = Math.max(this.R.lastBest, this.lastRun); } else this.lastRun = 0;
    // Clean: the craft kept a third of the opening clear on both sides all the way through.
    const clean = gate.margin >= (gap - 2 * k.r) * 0.3;
    if (gate.margin >= 0 && gate.margin <= SKIM) { this.R.skims++; this.burst(CX, this.y, 4, 90, 0); }
    if (clean) {
      this.clean++;
      this.R.cleanBest = Math.max(this.R.cleanBest, this.clean);
      if (this.clean % 5 === 0) {
        this.R.pearls += 3 * k.pearl;
        this.announce("CLEAN x" + this.clean + "  +" + 3 * k.pearl + " PEARLS", 1.6);
        this.c.tone(988, 0.08, "sine");
      }
    } else this.clean = 0;
    this.c.tone(clean ? 660 : 550, 0.12);
    this.lamps.flash(0.12, (e, T, a) => lampMax(a, only(1, LAMP.green, clean ? 0.9 : 0.6)));
    if (this.points % 12 === 0 && this.hull < k.hull + 1) { this.hull++; this.announce("HULL REPAIRED"); }
    const z = zoneAt(this.points);
    if (z > this.zone) {
      this.zone = z;
      this.R.zone = Math.max(this.R.zone, z);
      this.flashT = 1.2;
      this.announce(ZONES[z].name + " / " + ZONES[z].note, 3.2);
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
    const zi = this.phase === "play" || this.phase === "over" ? this.zone : this.sv.far;
    const Z = ZONES[zi];
    g.fillStyle = Z.water;
    g.fillRect(0, 0, 960, 540);
    this.drawScene(g, Z);
    if (this.phase === "play" || this.phase === "over") this.drawDive(g, Z);
    if (this.phase === "title") this.drawTitle(g);
    else if (this.phase === "over") this.drawResult(g);
    else if (this.phase === "dock") this.drawDock(g);
    this.drawHoldRing(g);
  }
  drawScene(g, Z) {
    const d = this.phase === "play" || this.phase === "over" ? this.dist : this.t * 40;
    // Plankton in two layers: the near layer streams past at most of the craft's speed.
    g.fillStyle = C.muted;
    for (const [x0, y, par, s] of MOTES) {
      g.globalAlpha = par > 0.5 ? 0.5 : 0.25;
      const x = ((x0 - d * par) % 960 + 960) % 960;
      g.fillRect(x, y, s * (par > 0.5 ? 2.2 : 1), s);
    }
    g.globalAlpha = 1;
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
    if (this.zone <= 1 || this.phase !== "play") {
      g.strokeStyle = "#2c4f49";
      g.lineWidth = 2;
      g.beginPath();
      for (let x = 0; x <= 960; x += 16) {
        const y = 14 + 4 * Math.sin((x + d * 0.8) / 60 + this.t * 2);
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
  drawDive(g, Z) {
    const dark = this.zone === 3;
    for (const gate of this.gates) {
      const [top, bottom] = this.span(gate);
      // In the Abyss a column shows only near the craft or where the sonar has just touched it.
      const near = clamp(1 - (gate.x - CX - 120) / 240, 0, 1);
      const alpha = dark ? Math.max(0.12, Math.min(1, gate.lit), near * 0.8) : 1;
      g.globalAlpha = alpha;
      g.fillStyle = Z.rock;
      g.fillRect(gate.x, 0, COL, top);
      g.fillRect(gate.x, bottom, COL, 540 - bottom);
      line(g, gate.x, top, gate.x + COL, top, Z.col, 3);
      line(g, gate.x, bottom, gate.x + COL, bottom, Z.col, 3);
      for (let y = 25; y < 540; y += 40) if (y < top - 10 || y > bottom + 10) glyph(g, 2, gate.x + 32, y, 10, "#548774");
      // A current: arrows in the water before the column, pointing the way it pushes.
      if (gate.cur) {
        const len = undertowSpeed(this.points) * gateInterval(this.points) * 0.75;
        g.strokeStyle = "#7fb0d8";
        g.lineWidth = 2;
        g.globalAlpha = alpha * 0.4;
        // Chevrons drifting the way the water pushes.
        const dir = Math.sign(gate.cur), ph = (this.t * 90) % 70;
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
        circle(g, p.x, p.y, 13 + 2 * Math.sin(this.t * 6), C.cyan, false, 3);
        circle(g, p.x - 4, p.y - 4, 3, C.ink, true);
      } else {
        circle(g, p.x, p.y, 9, "#e8f2dc55", false, 2);
        circle(g, p.x, p.y, 5, "#e8f2dc", true);
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
    this.drawCraft(g);
    if (this.noteT > 0 && this.phase === "play") text(g, this.note, 480, 44, 24, C.amber, "center");
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
  drawCraft(g) {
    const k = this.craft, s = k.r / 14;
    g.globalAlpha = this.grace > 0 && Math.floor(this.grace * 10) % 2 ? 0.35 : 1;
    g.save();
    g.translate(CX, this.y);
    g.rotate(clamp(this.vy * 0.0018, -0.5, 0.5));
    // The thruster: a flame under the stern while held, longer the harder it is pushing.
    if (this.held && this.phase === "play") {
      const f = 0.75 + 0.25 * Math.sin(this.t * 47);
      g.fillStyle = C.amber;
      g.beginPath(); g.moveTo(-14 * s, 4 * s); g.lineTo(-44 * s - 22 * f, 30 * s + 14 * f); g.lineTo(-2 * s, 11 * s); g.closePath(); g.fill();
      g.fillStyle = "#fff3d0";
      g.beginPath(); g.moveTo(-11 * s, 6 * s); g.lineTo(-30 * s - 10 * f, 20 * s + 7 * f); g.lineTo(-4 * s, 10 * s); g.closePath(); g.fill();
    }
    g.fillStyle = this.phase === "over" ? C.red : C.cyan;
    g.beginPath();
    g.moveTo(26 * s, 0); g.lineTo(-15 * s, -13 * s); g.lineTo(-9 * s, 0); g.lineTo(-15 * s, 13 * s);
    g.closePath(); g.fill();
    circle(g, 2 * s, 0, 4 * s, C.bg, true);
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
  drawTitle(g) {
    const sv = this.sv;
    g.fillStyle = "#0c1511e8";
    g.fillRect(140, 150, 680, 270);
    line(g, 195, 158, 765, 158, C.line);
    text(g, "UNDERTOW", 480, 204, 42, C.cyan, "center");
    text(g, "Hold to rise. Release to sink.", 480, 258, 22, C.muted, "center");
    text(g, "Follow the silent current down through six zones.", 480, 288, 22, C.muted, "center");
    if (sv.runs > 0) text(g, "PEARLS " + sv.bank + "   DEEPEST " + ZONES[sv.far].name + "   FEATS " + sv.ft.length + " / " + FEATS.length, 480, 334, 18, C.muted, "center");
    text(g, "TAP = DIVE     HOLD = DOCK", 480, 380, 22, C.amber, "center");
  }
  drawResult(g) {
    const r = this.result || { passages: this.points, pearls: 0, zone: ZONES[0].name, reason: this.reason };
    g.fillStyle = "#0c1511ee";
    g.fillRect(170, 50, 620, 440);
    line(g, 210, 60, 750, 60, C.line, 2);
    text(g, "PRESSURE LIMIT", 480, 96, 36, C.cyan, "center");
    text(g, r.reason, 480, 132, 18, C.muted, "center");
    let y = 176;
    const row = (label, value, col = C.ink) => { text(g, label, 240, y, 18, C.muted); text(g, value, 720, y, 26, col, "right"); y += 36; };
    row("PASSAGES", r.passages);
    row("PEARLS", r.pearls + " (BANK " + this.sv.bank + ")");
    row("DEEPEST ZONE", r.zone, ZONES[this.R.zone].col);
    row("BEST CLEAN RUN", this.R.cleanBest);
    if (this.daily) { text(g, this.goalDone ? "DAILY GOAL MET" : "DAILY: " + dailyGoal(ymd(new Date())).text, 480, y, 18, this.goalDone ? C.cyan : C.muted, "center"); y += 30; }
    else {
      text(g, this.newRecord ? "NEW BEST" : this.plainRun() ? "BEST " + this.c.best() : "STARTED IN " + ZONES[this.startZone].name + " / NOT SCORED", 480, y, 18, this.newRecord ? C.cyan : C.amber, "center");
      y += 30;
    }
    for (const id of this.newFeats.slice(0, 2)) {
      const f = FEATS.find((x) => x.id === id);
      if (f) { text(g, "FEAT  " + f.name + "  +" + FEAT_PEARLS + " PEARLS", 480, y, 20, C.cyan, "center"); y += 28; }
    }
    const nextCraft = CRAFTS.find((x, i) => !this.sv.own[i]);
    if (nextCraft && y < 440) text(g, this.sv.bank >= nextCraft.cost ? nextCraft.name + " CAN BE BOUGHT AT THE DOCK" : "NEXT CRAFT: " + nextCraft.name + " AT " + nextCraft.cost + " PEARLS", 480, y, 18, C.muted, "center");
    if (this.deadT > LOCKOUT) text(g, "TAP = DIVE AGAIN     HOLD = DOCK", 480, 466, 20, C.amber, "center");
  }
  drawDock(g) {
    g.fillStyle = "#0c1511f2";
    g.fillRect(110, 36, 740, 470);
    line(g, 160, 46, 800, 46, C.line);
    text(g, "DOCK", 480, 80, 34, C.cyan, "center");
    text(g, "PEARLS " + this.sv.bank, 800, 80, 20, C.amber, "right");
    const sv = this.sv, n = sv.ft.length;
    const key = ymd(new Date());
    if (this.view === "menu") {
      const k = CRAFTS[sv.sel.craft];
      const rows = {
        DIVE: ["DIVE", ZONES[Math.min(sv.sel.start, sv.far)].name],
        CRAFT: ["CRAFT", k.name],
        START: ["START ZONE", ZONES[Math.min(sv.sel.start, sv.far)].name],
        DAILY: ["DAILY DIVE", sv.dl.d === key && sv.dl.done ? "DONE TODAY" : "SEEDED BY DATE"],
        FEATS: ["FEATS", n + " / " + FEATS.length],
        LOG: ["LOG", "DEEPEST " + ZONES[sv.far].name],
      };
      DOCK.forEach((id, i) => {
        const y = 140 + i * 44, on = i === this.cur;
        if (on) diamond(g, 150, y, 9, C.amber, true);
        text(g, rows[id][0], 180, y, 24, on ? C.amber : C.ink);
        text(g, rows[id][1], 810, y, 22, on ? C.amber : C.muted, "right");
      });
      const id = DOCK[this.cur];
      let info;
      if (id === "DIVE") info = sv.sel.start ? "Starts in " + ZONES[sv.sel.start].name + ". Only dives from the shallows set a best." : "A dive from the shallows.";
      else if (id === "CRAFT") {
        const nextCraft = CRAFTS.find((x, i) => !sv.own[i]);
        info = k.text + (nextCraft ? "  NEXT: " + nextCraft.name + " " + nextCraft.cost + " PEARLS" : "");
      } else if (id === "START") info = "Start in any zone you have reached.";
      else if (id === "DAILY") info = "Goal: " + dailyGoal(key).text + (sv.dl.streak > 1 ? "  STREAK " + sv.dl.streak : "");
      else if (id === "FEATS") info = "Named goals, " + FEAT_PEARLS + " pearls each. Some are not listed.";
      else info = "Zones reached and best dives by craft.";
      text(g, info, 480, 420, 18, C.muted, "center");
      text(g, "TAP = NEXT LINE     HOLD = CHOOSE", 480, 470, 18, C.cyan, "center");
    } else if (this.view === "feats") {
      const per = 5, pages = Math.ceil(FEATS.length / per);
      text(g, "FEATS  " + n + " / " + FEATS.length + "     PAGE " + (this.page + 1) + " / " + pages, 480, 118, 20, C.cyan, "center");
      FEATS.slice(this.page * per, this.page * per + per).forEach((f, i) => {
        const y = 160 + i * 58, done = sv.ft.includes(f.id);
        text(g, (done ? "[X] " : "[ ] ") + (f.hidden && !done ? "????" : f.name), 150, y, 22, done ? C.cyan : C.ink);
        const prog = f.id === "hoard" ? sv.st.pearls : f.id === "regular" ? sv.runs : f.id === "daily" ? sv.st.daily : null;
        text(g, done ? "DONE" : prog !== null ? Math.min(prog, f.n) + " / " + f.n : "", 810, y, 20, done ? C.cyan : C.amber, "right");
        text(g, f.hidden && !done ? f.hint : f.text, 150, y + 26, 16, C.muted);
      });
      text(g, "TAP = NEXT PAGE     HOLD = BACK", 480, 470, 18, C.cyan, "center");
    } else {
      text(g, "LOG   DIVES " + sv.runs + "   PASSAGES " + sv.st.passages + "   PEARLS " + sv.st.pearls, 480, 118, 20, C.cyan, "center");
      ZONES.forEach((zn, i) => {
        const y = 156 + i * 30;
        text(g, zn.name, 180, y, 20, i <= sv.far ? zn.col : C.line);
        text(g, i <= sv.far ? "FROM PASSAGE " + zn.at : "NOT REACHED", 780, y, 18, i <= sv.far ? C.muted : C.line, "right");
      });
      CRAFTS.forEach((cr, i) => {
        const y = 352 + i * 28;
        text(g, cr.name, 180, y, 20, sv.own[i] ? C.ink : C.line);
        text(g, sv.own[i] ? "BEST " + sv.cb[i] : cr.cost + " PEARLS", 780, y, 18, sv.own[i] ? C.amber : C.line, "right");
      });
      text(g, "TAP = BACK", 480, 470, 18, C.cyan, "center");
    }
  }
}
