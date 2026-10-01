// BALLISTA — a one-button launcher, played for distance. The barrel sweeps up and down by itself;
// pressing fixes the angle, holding charges a meter that rises and falls, releasing fires a survey
// pod across open ground. What it lands on decides the run: spring pads and mines throw it on,
// boosters speed it up, drifts and nets slow it, sinkholes swallow it. In flight one button does
// two jobs: a press while the pod is about to touch down is a skip (the later, the better: a
// perfect skip keeps its speed), a press any other time fires a thruster, of which there are few.
//
// Around that: salvage from every run buys upgrades in the workshop (barrel, thrusters, hull,
// fins, magnet), six zones farther out bring new things, pods are earned with feats, and a daily
// run gives everyone the same field and loadout for the date. Versioned save (schema 2) that takes
// over the first Ballista's record. The lamps are the pod's instruments.
import { C, space, text, line, circle, diamond, banner } from "../engine/draw.js";
import { TAU, clamp, mixSeed, Random } from "../engine/math.js";
import { LAMP, lamps, dim, blend, ramp, spot, pulse, blink, fill, meter, lightsOff } from "../engine/lightshow.js";
import { AppGuard } from "../engine/input.js";

const STEP = 1 / 60;
export const M = 10; // logical pixels per metre
export const G = 420; // px/s^2
const GY = 470; // screen y of the ground while the pod is low
const SX0 = 120; // screen x of the barrel's pivot before the camera moves
const LEAD = 260; // the camera follows once the pod is this far right of the pivot
const LIFT = 270; // ... and climbs once the pod is this high
const PIVOT_Y = 22, BARREL = 48;
const R = 9; // pod radius
export const A_LO = 14, A_HI = 74; // the aim sweeps between these angles (degrees)
export const SWEEP = 2.6; // seconds for one full cycle of the aim
export const RISE = 1.1; // seconds of hold from no power to the peak; then it falls as long
export const MIN_HOLD = 0.15; // a shorter press is a cancelled charge
const HOLD_LIMIT = 8;
const HOLD_PICK = 0.5; // a press this long on a menu screen chooses instead of stepping
export const SKIP_WIN = 0.3; // seconds before touchdown when a press is a skip, not a thrust
export const SKIP_PERFECT = 0.11; // ... and within this, a perfect skip
const SKIP_E_CAP = 0.76; // no skip returns more of the fall than this
const BOUNCE_VY = 90; // touching down slower than this, the pod rolls
const STOP_VX = 10;
const VX_CAP = 1500, VY_CAP = 1100;
const RUN_CAP = 180; // seconds: a run that has not ended by then ends
const MAX_FEATURES = 60, MAX_PARTS = 24, TRAIL = 36;
const KICK_X = 120, KICK_Y = 300;
const PAD_V = 540, MINE_V = 700, BOOST_X = 280;
const FRICTION = { ground: 260, drift: 1150, ice: 22 };

// ---- the field: six zones farther and farther out, each adding something ----------------
// `from` is in metres. `kinds` are relative weights of what is placed; `gap` the spacing in px.
export const ZONES = [
  { name: "THE FLATS", roman: "I", from: 0, col: LAMP.green, ink: "#9fdc7a", gap: [180, 380], kinds: { pad: 3, drift: 2, scrap: 3 } },
  { name: "THE DUNES", roman: "II", from: 150, col: LAMP.amber, ink: "#e7b879", gap: [170, 360], kinds: { pad: 3, drift: 2, scrap: 3, boost: 2, beacon: 2 } },
  { name: "THE CRATERS", roman: "III", from: 350, col: LAMP.red, ink: "#eb947a", gap: [170, 350], kinds: { pad: 3, drift: 2, scrap: 2, boost: 2, beacon: 2, pit: 2, mine: 2 } },
  { name: "THE SPIRES", roman: "IV", from: 650, col: LAMP.violet, ink: "#b48cf0", gap: [160, 340], kinds: { pad: 2, drift: 2, scrap: 2, boost: 2, beacon: 2, pit: 2, mine: 2, updraft: 2, net: 2 } },
  { name: "THE GLASS", roman: "V", from: 1000, col: LAMP.cyan, ink: "#8fcbc5", gap: [160, 340], kinds: { pad: 2, drift: 1, scrap: 2, boost: 2, beacon: 2, pit: 3, mine: 2, updraft: 1, net: 2, ice: 3 } },
  { name: "THE STORM", roman: "VI", from: 1500, col: LAMP.white, ink: "#ece4d0", gap: [160, 330], kinds: { pad: 2, drift: 1, scrap: 2, boost: 2, beacon: 2, pit: 3, mine: 2, updraft: 1, net: 2, ice: 2, gust: 3 } },
];
export const zoneAt = (metres) => { for (let i = ZONES.length - 1; i > 0; i--) if (metres >= ZONES[i].from) return i; return 0; };
// What a newcomer is told the first time each thing comes into view (once per save).
const INTRO = {
  pad: "SPRING PAD: LAND ON IT TO BE THROWN ON.",
  drift: "DRIFT: SOFT GROUND THAT SLOWS YOU.",
  boost: "BOOSTER: RUN OVER IT FOR SPEED.",
  beacon: "BEACON: TOUCH IT TO REFILL A THRUSTER.",
  pit: "SINKHOLE: ENDS THE RUN. THRUST OR SKIP OVER.",
  mine: "MINE: A BLAST THAT THROWS YOU HIGH.",
  updraft: "UPDRAFT: RISING AIR LIFTS THE POD.",
  net: "NET: CATCHES A LOW POD. FLY OVER.",
  ice: "GLASS: HARDLY SLOWS YOU. ROLL ON.",
  gust: "GUST: WIND ALONG THE GROUND. ARROWS SHOW WHICH WAY.",
};
const GROUND_KINDS = ["pad", "boost", "mine", "drift", "ice", "pit"];
const MOTIFS = [[392, 494, 587], [440, 554, 659], [330, 392, 494], [294, 370, 440], [523, 659, 784], [262, 330, 392]];

// ---- the workshop -------------------------------------------------------------------------
// Five systems, five levels each, paid for with salvage.
export const UPGRADES = [
  { id: "barrel", name: "BARREL", text: "Faster launch.", cost: [20, 70, 180, 400, 800] },
  { id: "thrust", name: "THRUSTERS", text: "One more thruster per run.", cost: [20, 60, 170, 380, 720] },
  { id: "hull", name: "HULL", text: "Livelier bounces, longer rolls.", cost: [15, 55, 160, 360, 680] },
  { id: "fins", name: "FINS", text: "Less air drag.", cost: [20, 70, 190, 400, 760] },
  { id: "magnet", name: "MAGNET", text: "Draws scrap from farther away.", cost: [10, 40, 100, 200, 380] },
];
const UP_MAX = 5;
export const PODS = [
  { name: "STANDARD", need: 0, e: 0, drag: 1, kick: 1, perfect: 1, text: "The survey pod as issued." },
  { name: "SKIPPER", need: 4, e: 0.07, drag: 1.15, kick: 0.9, perfect: 1.35, text: "Bouncy; easier perfect skips; more drag." },
  { name: "DART", need: 8, e: -0.08, drag: 0.72, kick: 1.15, perfect: 0.85, text: "Slips through the air; lands hard." },
];
const DAILY_UP = [2, 2, 2, 2, 2];
// A pod's numbers from the upgrade levels and the pod chosen.
export function loadout(up, podIx) {
  const pod = PODS[podIx] || PODS[0], L = (i) => clamp(Math.floor(up[i] || 0), 0, UP_MAX);
  return {
    vmax: (560 + 90 * L(0)) * (podIx === 2 ? 1.04 : 1),
    kicks: 1 + L(1),
    e: 0.4 + 0.05 * L(2) + pod.e,
    keep: 0.82 + 0.025 * L(2),
    roll: 1 - 0.08 * L(2),
    drag: 0.0003 * (1 - 0.13 * L(3)) * pod.drag,
    magnet: 24 + 16 * L(4),
    kick: pod.kick,
    perfect: SKIP_PERFECT * pod.perfect,
  };
}
// Salvage a run earns: five for going out, one per 8 m, two per scrap; bounties come on top.
export const salvageFor = (metres, scrap) => 5 + Math.floor(metres / 8) + scrap * 2;

// ---- feats: named goals in the console's dry voice ----------------------------------------
// prog(app) is the current progress toward n. Hidden feats show only a hint until done.
const life = (a, key) => (a.sv.st[key] || 0) + (a.R[key] || 0);
export const FEATS = [
  { id: "m100", name: "SURVEYOR", text: "Fly 100 m in one run.", n: 100, prog: (a) => a.R.m },
  { id: "m400", name: "LONG RANGE", text: "Fly 400 m in one run.", n: 400, prog: (a) => a.R.m },
  { id: "m1000", name: "OVER THE HORIZON", text: "Fly 1000 m in one run.", n: 1000, prog: (a) => a.R.m },
  { id: "m2000", name: "THE FAR EDGE", text: "Fly 2000 m in one run.", n: 2000, prog: (a) => a.R.m },
  { id: "pad", name: "SPRUNG", text: "Land on a spring pad.", n: 1, prog: (a) => life(a, "pads") },
  { id: "lift5", name: "TRAMPOLINE", text: "Hit 5 pads, boosters or mines in one run.", n: 5, prog: (a) => a.R.lifts },
  { id: "skip1", name: "SKIPPING STONE", text: "Make a perfect skip.", n: 1, prog: (a) => life(a, "perfect") },
  { id: "skip4", name: "DUCKS AND DRAKES", text: "Make 4 perfect skips in one run.", n: 4, prog: (a) => a.R.perfect },
  { id: "mine", name: "SAPPER", text: "Ride a mine blast.", n: 1, prog: (a) => life(a, "mines") },
  { id: "pitskip", name: "NOT TODAY", text: "Skip off a sinkhole.", n: 1, prog: (a) => a.R.pitskip },
  { id: "scrap25", name: "MAGPIE", text: "Collect 25 scrap in one run.", n: 25, prog: (a) => a.R.scrap },
  { id: "unaided", name: "UNAIDED", text: "Fly 250 m without a thruster.", n: 250, prog: (a) => (a.R.thrusts ? 0 : a.R.m) },
  { id: "high", name: "CEILING", text: "Climb 50 m high.", n: 50, prog: (a) => a.R.alt },
  { id: "fitted", name: "FULLY FITTED", text: "Raise one system to its last level.", n: UP_MAX, prog: (a) => Math.max(...a.sv.up) },
  { id: "daily", name: "ON THE DAY", text: "Meet a daily goal.", n: 1, prog: (a) => life(a, "daily") },
  { id: "glass", name: "GLASSWALKER", text: "Roll 100 m on glass in one run.", hint: "Some ground hardly slows you.", n: 100, hidden: true, prog: (a) => a.R.iceRoll },
  { id: "kite", name: "KITE", text: "Touch 3 beacons without landing.", hint: "Beacons hang in the air.", n: 3, hidden: true, prog: (a) => a.R.kite },
];
const FEAT_IDS = FEATS.map((f) => f.id);
const FEAT_BOUNTY = 30;

// ---- helpers -------------------------------------------------------------------------------
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const FRNG = new Random(1); // the field's generator; its state lives on the app as plain data
const hashText = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const dateKey = (d = new Date()) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const roman = (n) => ["", "I", "II", "III", "IV", "V"][n] || String(n);
export const sweepAngle = (t) => A_LO + (A_HI - A_LO) * (0.5 - 0.5 * Math.cos((TAU * t) / SWEEP));
// Power after holding for `hold` seconds: up to the peak at RISE, then back down, repeating.
export function powerAt(hold) {
  const u = (hold / (2 * RISE)) % 1;
  return u < 0.5 ? 2 * u : 2 - 2 * u;
}
// Time until a falling pod at height y (px) with vertical speed vy reaches the ground, without drag.
export const timeToGround = (y, vy) => (vy + Math.sqrt(Math.max(0, vy * vy + 2 * G * Math.max(0, y)))) / G;
// Today's goal, the same for everyone on the same date. Every goal is within reach of the daily loadout.
export function dailyGoal(key) {
  const h = hashText("goal" + key), kind = h % 4, v = (h >>> 8) % 5;
  if (kind === 0) { const n = 200 + 25 * v; return { kind: "metres", n, text: "Fly " + n + " m." }; }
  if (kind === 1) { const n = 1 + (v % 3); return { kind: "perfect", n, text: "Make " + n + " perfect skip" + (n > 1 ? "s." : ".") }; }
  if (kind === 2) { const n = 1 + (v % 3); return { kind: "lifts", n, text: "Hit " + n + " pad" + (n > 1 ? "s, boosters or mines." : ", booster or mine.") }; }
  const n = 5 + 2 * v; return { kind: "scrap", n, text: "Collect " + n + " scrap." };
}

// Bring any stored shape to schema 2: nothing (a first launch), schema 1 (the first Ballista, an
// artillery game, whose record was written by recordRun: runs, last, milestone), or schema 2.
// The first Ballista's runs carry over, its last record is kept as `legacy`, and each of its runs
// is worth a little salvage (at most 300) so a returning player starts with something to spend.
export function migrateSave(raw) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const v1 = r.schema !== 2 && (num(r.runs) > 0 || (r.last && typeof r.last === "object"));
  const st = r.st && typeof r.st === "object" ? r.st : {};
  const dl = r.dl && typeof r.dl === "object" ? r.dl : {};
  const int = (v) => Math.max(0, Math.floor(num(v)));
  const out = {
    schema: 2,
    runs: int(r.runs),
    last: !v1 && r.last && typeof r.last === "object" ? r.last : {},
    milestone: v1 ? 0 : int(r.milestone),
    best: v1 ? 0 : int(r.best),
    salvage: v1 ? Math.min(300, 20 * int(r.runs)) : int(r.salvage),
    up: Array.from({ length: UPGRADES.length }, (_, i) => clamp(Math.floor(num(Array.isArray(r.up) ? r.up[i] : 0)), 0, UP_MAX)),
    pod: clamp(Math.floor(num(r.pod)), 0, PODS.length - 1),
    pb: Array.from({ length: PODS.length }, (_, i) => int(Array.isArray(r.pb) ? r.pb[i] : 0)),
    far: clamp(Math.floor(num(r.far)), 0, ZONES.length - 1),
    ft: Array.isArray(r.ft) ? r.ft.filter((id, i) => FEAT_IDS.includes(id) && r.ft.indexOf(id) === i) : [],
    st: { metres: int(st.metres), pads: int(st.pads), perfect: int(st.perfect), mines: int(st.mines), scrap: int(st.scrap), daily: int(st.daily) },
    dl: { d: typeof dl.d === "string" ? dl.d.slice(0, 10) : "", best: int(dl.best), done: dl.done ? 1 : 0, streak: int(dl.streak), last: typeof dl.last === "string" ? dl.last.slice(0, 10) : "" },
    seen: r.seen && typeof r.seen === "object" ? Object.fromEntries(Object.keys(INTRO).concat("skip").filter((k) => r.seen[k]).map((k) => [k, 1])) : {},
  };
  if (v1) {
    const l = r.last && typeof r.last === "object" ? r.last : {};
    out.legacy = { runs: int(r.runs), score: int(l.score), stations: int(l.stations ?? r.milestone) };
  } else if (r.legacy && typeof r.legacy === "object") {
    out.legacy = { runs: int(r.legacy.runs), score: int(r.legacy.score), stations: int(r.legacy.stations) };
  }
  return out;
}

const WORKSHOP = ["LAUNCH", "BARREL", "THRUSTERS", "HULL", "FINS", "MAGNET", "POD", "DAILY", "FEATS", "LOG"];

export class Ballista {
  constructor(ctx) {
    this.c = ctx;
    this.guard = new AppGuard(this, ctx); // takes back a menu gesture that reached the game (docs/ENGINE.md)
    this.t = 0;
    this.sv = migrateSave(ctx.progress?.());
    this.phase = "title";
    this.armed = false; // a press on a menu screen, waiting for its release
    this.pt = 0;
    this.view = "menu";
    this.cur = 0;
    this.page = 0;
    this.daily = false;
    this.btn = false;
    this.charging = false;
    this.hold = 0;
    this.power = 0;
    this.peaked = false;
    this.toneK = -1;
    this.sq = []; // a short queue of notes: [time, hz, seconds, wave]
    this.parts = new Float32Array(MAX_PARTS * 5); // x, y, vx, vy, life (world px)
    this.partNext = 0;
    this.trail = new Float32Array(TRAIL * 2);
    this.trailN = 0;
    this.hudKey = "";
    this.hintKey = "";
    this.notice = "";
    this.noticeT = 0;
    this.need = ""; // why a workshop purchase failed
    this.resetRun();
    this.phase = "title";
    this.setHint("TITLE", "TAP TO LAUNCH. HOLD FOR THE WORKSHOP.");
    this.hudNow();
  }

  // ---- a run ---------------------------------------------------------------------------------
  resetRun() {
    const up = this.daily ? DAILY_UP : this.sv.up;
    let podIx = this.daily ? 0 : this.sv.pod;
    if (!this.unlockedPod(podIx)) podIx = 0;
    this.podIx = podIx;
    this.L = loadout(up, podIx);
    this.fstate = this.daily ? (mixSeed(hashText("field" + this.dayKey())) || 1) : (Math.floor(this.c.rng.next() * 4294967296) || 1);
    this.p = { x: 0, y: PIVOT_Y, vx: 0, vy: 0, mode: "cannon", spin: 0 };
    this.sweepT = 0;
    this.angle = sweepAngle(0);
    this.runT = 0;
    this.kicks = this.L.kicks;
    this.skip = null; // { grade, t } an armed skip
    this.features = [];
    this.nextX = 25 * M; // the first 25 m are clear
    this.lastPit = -1e9;
    this.camX = 0;
    this.camY = 0;
    this.zone = 0;
    this.metres = 0;
    this.lastMilestone = 0;
    this.flash = 0;
    this.flashCol = "white";
    this.restT = 0;
    this.deadT = 0;
    this.reason = "";
    this.result = null;
    this.newFeats = [];
    this.goalDone = false;
    this.newRecord = false;
    this.trailN = 0;
    this.trailTick = 0;
    this.R = { m: 0, pads: 0, lifts: 0, perfect: 0, good: 0, mines: 0, pitskip: 0, scrap: 0, thrusts: 0, alt: 0, iceRoll: 0, kite: 0, beacons: 0, bounces: 0, daily: 0 };
    this.kiteRun = 0;
    this.iceAcc = 0;
    this.zoneBonus = 0;
    this.best0 = this.bestRef();
  }
  dayKey() { return dateKey(); }
  unlockedPod(i) { return i === 0 || this.sv.ft.length >= (PODS[i]?.need ?? 99); }
  bestRef() {
    if (this.daily) return this.sv.dl.d === this.dayKey() ? this.sv.dl.best : 0;
    return this.sv.best;
  }
  rnd() { // the field generator, kept as a plain number on the app so a rewind restores it
    FRNG.state = this.fstate;
    const v = FRNG.next();
    this.fstate = FRNG.state;
    return v;
  }
  range(a, b) { return a + (b - a) * this.rnd(); }

  // Places what lies ahead, a little beyond the right edge of the screen, and forgets what is behind.
  spawnAhead() {
    const p = this.p;
    let guard = 0;
    while (this.nextX < p.x + 1400 && guard++ < 12 && this.features.length < MAX_FEATURES) {
      const x = this.nextX, z = ZONES[zoneAt(x / M)];
      let kind = this.pick(z.kinds);
      if (kind === "pit" && x - this.lastPit < 700) kind = "drift";
      this.place(kind, x);
      this.nextX = x + this.range(z.gap[0], z.gap[1]) + (this.features.length ? this.features[this.features.length - 1].w || 0 : 0);
    }
    let cut = 0;
    while (cut < this.features.length && (this.features[cut].x + (this.features[cut].w || 0)) < this.camX - 200) cut++;
    if (cut) this.features.splice(0, cut);
  }
  pick(kinds) {
    let total = 0;
    for (const k in kinds) total += kinds[k];
    let u = this.rnd() * total;
    for (const k in kinds) { u -= kinds[k]; if (u < 0) return k; }
    return "pad";
  }
  place(k, x) {
    const f = { k, x, w: 0, y: 0, h: 0, a: 0, used: 0 };
    if (k === "pad") f.w = 60;
    else if (k === "boost") f.w = 90;
    else if (k === "mine") f.w = 26;
    else if (k === "drift") f.w = this.range(140, 260);
    else if (k === "ice") f.w = this.range(320, 620);
    else if (k === "pit") { f.w = this.range(60, 100); this.lastPit = x; }
    else if (k === "beacon") { f.y = this.range(110, 380); f.h = 20; }
    else if (k === "net") f.h = this.range(80, 190);
    else if (k === "updraft") f.w = this.range(120, 200);
    else if (k === "gust") { f.w = this.range(400, 700); f.a = (this.rnd() < 0.65 ? 1 : -1) * this.range(140, 240); }
    else if (k === "scrap") { // an arc of four, each its own feature
      const y0 = this.range(40, 260), n = 4;
      for (let i = 0; i < n; i++) this.features.push({ k, x: x + i * 38, w: 0, y: y0 + 40 * Math.sin((i / (n - 1)) * Math.PI), h: 0, a: 0, used: 0 });
      return;
    }
    this.features.push(f);
  }
  // The ground feature under x (pads and mines win over the segment they sit in), or null.
  groundAt(x) {
    let seg = null;
    for (const f of this.features) {
      if (f.x > x) break;
      if (!GROUND_KINDS.includes(f.k) || x > f.x + f.w) continue;
      if (f.k === "pad" || f.k === "boost" || f.k === "mine") { if (!f.used || f.k !== "mine") return f; }
      else seg = f;
    }
    return seg;
  }

  // ---- input ---------------------------------------------------------------------------------
  // On the title, result and workshop screens a press is decided when it ends: a tap chooses the main
  // action, a press of HOLD_PICK or more opens or operates the workshop. In a run the press edge acts.
  down() {
    this.guard.mark();
    this.btn = true;
    if (this.phase === "title" || this.phase === "shop" || (this.phase === "over" && this.deadT > 0.7)) {
      this.armed = true;
      this.pt = this.t;
      return;
    }
    if (this.phase === "aim") { this.beginCharge(); return; }
    if (this.phase === "fly") this.press();
  }
  up() {
    this.guard.release();
    this.btn = false;
    if (this.armed) {
      this.armed = false;
      this.menuPress(this.t - this.pt);
      return;
    }
    if (!this.charging) return;
    if (this.hold >= MIN_HOLD) this.fire();
    else {
      this.cancelCharge();
      this.c.tone(260, 0.04, "triangle");
      this.setHint("SHORT", "TOO SHORT: NOTHING FIRED. HOLD TO CHARGE, RELEASE TO FIRE.");
    }
  }
  cancel() {
    this.guard.rewind();
    this.btn = false;
    this.armed = false;
    this.cancelCharge();
    this.c.leds(lightsOff());
  }
  pause() {
    this.guard.settle();
    this.cancelCharge();
    this.c.leds(lightsOff());
  }
  resume() {
    this.btn = false;
    this.armed = false;
  }
  dispose() {
    this.guard.settle();
    this.cancelCharge();
    this.c.leds(lightsOff());
  }
  cancelCharge() {
    this.charging = false;
    this.hold = 0;
    this.power = 0;
    this.toneK = -1;
    this.c.synth?.stopTone?.();
  }
  beginCharge() {
    this.charging = true;
    this.hold = 0;
    this.power = 0;
    this.peaked = false;
    this.toneK = -1;
    this.angle = sweepAngle(this.sweepT);
  }
  fire() {
    const power = this.power, a = (this.angle * Math.PI) / 180, v = this.L.vmax * (0.3 + 0.7 * power);
    this.cancelCharge();
    const p = this.p;
    p.x = Math.cos(a) * BARREL;
    p.y = PIVOT_Y + Math.sin(a) * BARREL;
    p.vx = Math.cos(a) * v;
    p.vy = Math.sin(a) * v;
    p.mode = "air";
    this.phase = "fly";
    this.shotPower = power;
    this.burst(p.x, p.y + R, 8, 140);
    this.c.tone(90, 0.18, "sawtooth");
    this.note(0.04, 180 + 200 * power, 0.12, "triangle");
    this.setHint("FLY", this.kicks ? "PRESS TO FIRE A THRUSTER. PRESS JUST BEFORE TOUCHDOWN TO SKIP." : "PRESS JUST BEFORE TOUCHDOWN TO SKIP.");
  }
  // A press in flight: a skip if touchdown is close, a thruster otherwise.
  press() {
    const p = this.p;
    if (this.skip) return;
    const tti = this.skipWindow();
    if (tti >= 0) {
      const grade = tti <= this.L.perfect ? "perfect" : "good";
      this.skip = { grade, t: 0 };
      this.c.tone(grade === "perfect" ? 990 : 740, 0.04, "sine");
      return;
    }
    if (this.kicks <= 0) {
      this.c.tone(140, 0.05, "square");
      this.setHint("EMPTY", "NO THRUSTERS LEFT. SKIPS STILL WORK: PRESS JUST BEFORE TOUCHDOWN.");
      return;
    }
    this.kicks--;
    this.R.thrusts++;
    p.vx = Math.min(VX_CAP, p.vx + KICK_X * this.L.kick);
    p.vy = Math.max(p.vy, 0) + KICK_Y * this.L.kick;
    p.mode = "air";
    this.burst(p.x - 6, p.y + R, 6, 120);
    this.flash = 0.12;
    this.flashCol = "amber";
    this.c.tone(196, 0.12, "sawtooth");
    this.note(0.05, 294, 0.1, "triangle");
  }
  // Seconds until touchdown when a press now would be a skip, or -1.
  skipWindow() {
    const p = this.p;
    if (p.mode !== "air" || p.vy > -BOUNCE_VY * 1.3) return -1;
    const tti = timeToGround(p.y, p.vy);
    return tti <= SKIP_WIN ? tti : -1;
  }
  startRun(daily) {
    this.daily = daily;
    this.resetRun();
    this.phase = "aim";
    this.spawnAhead();
    this.setHint("AIM", "PRESS TO FIX THE ANGLE. HOLD TO CHARGE, RELEASE TO FIRE.");
    this.hudNow();
  }
  // A finished press on the title, result or workshop screen.
  menuPress(dur) {
    const long = dur >= HOLD_PICK;
    if (this.phase === "title" || this.phase === "over") {
      if (long) this.openShop();
      else this.startRun(false);
      return;
    }
    if (this.view !== "menu") {
      if (long || this.view === "log") { this.view = "menu"; this.page = 0; }
      else this.page = (this.page + 1) % Math.ceil(FEATS.length / 6);
      return;
    }
    if (!long) { this.cur = (this.cur + 1) % WORKSHOP.length; this.need = ""; this.c.tone(420, 0.02, "sine"); return; }
    this.shopChoose();
  }
  openShop() {
    this.phase = "shop";
    this.view = "menu";
    this.cur = this.affordable() >= 0 ? 1 + this.affordable() : 0;
    this.page = 0;
    this.need = "";
    this.setHint("SHOP", "TAP: NEXT LINE. HOLD: CHOOSE.");
    this.hudNow();
  }
  // The first system whose next level can be bought now, or -1.
  affordable() {
    for (let i = 0; i < UPGRADES.length; i++) {
      const L = this.sv.up[i];
      if (L < UP_MAX && UPGRADES[i].cost[L] <= this.sv.salvage) return i;
    }
    return -1;
  }
  shopChoose() {
    const row = WORKSHOP[this.cur], sv = this.sv;
    if (row === "LAUNCH") { this.startRun(false); return; }
    if (row === "DAILY") { this.startRun(true); return; }
    if (row === "FEATS") { this.view = "feats"; this.page = 0; return; }
    if (row === "LOG") { this.view = "log"; return; }
    if (row === "POD") {
      let i = sv.pod;
      do i = (i + 1) % PODS.length; while (!this.unlockedPod(i));
      sv.pod = i;
      this.c.tone(520, 0.05, "sine");
      this.persist();
      return;
    }
    const ui = this.cur - 1, L = sv.up[ui];
    if (L >= UP_MAX) { this.need = "FULLY FITTED."; this.c.tone(300, 0.05, "triangle"); return; }
    const cost = UPGRADES[ui].cost[L];
    if (sv.salvage < cost) { this.need = "NEED " + (cost - sv.salvage) + " MORE SALVAGE."; this.c.tone(150, 0.08, "square"); return; }
    sv.salvage -= cost;
    sv.up[ui] = L + 1;
    this.need = UPGRADES[ui].name + " " + roman(L + 1) + " FITTED.";
    this.note(0, 523, 0.08, "triangle");
    this.note(0.08, 784, 0.14, "triangle");
    this.checkFeats();
    this.persist();
    this.hudNow();
  }

  // ---- simulation ------------------------------------------------------------------------------
  update(dt) {
    const step = dt > 0 && dt < 0.1 ? dt : STEP;
    this.guard.tick(step);
    this.t += step;
    this.runSfx();
    if (this.noticeT > 0) this.noticeT -= step;
    if (this.flash > 0) this.flash -= step;
    this.stepParts(step);
    if (this.phase === "aim") this.aim(step);
    else if (this.phase === "fly") this.fly(step);
    else if (this.phase === "over") this.deadT += step;
    this.c.leds(this.lampValues());
  }
  aim(step) {
    if (!this.charging) {
      this.sweepT += step;
      this.angle = sweepAngle(this.sweepT);
      return;
    }
    this.hold += step;
    if (this.hold > HOLD_LIMIT) { this.cancelCharge(); return; }
    const rising = (this.hold / (2 * RISE)) % 1 < 0.5;
    if (!rising && !this.peaked) { this.peaked = true; this.flash = 0.12; this.flashCol = "white"; this.c.tone(1175, 0.06, "triangle"); }
    else if (rising && this.peaked) this.peaked = false;
    this.power = powerAt(this.hold);
    this.setHint(this.peaked ? "C2" : "C1", this.peaked ? "PAST THE PEAK: POWER IS FALLING. RELEASE TO FIRE." : "RELEASE TO FIRE. THE METER PEAKS, THEN FALLS.");
    const k = Math.floor(this.power * 20);
    if (k !== this.toneK) { this.toneK = k; this.c.synth?.startTone?.(170 * Math.pow(2, k / 10)); }
  }
  fly(step) {
    const p = this.p, L = this.L;
    this.runT += step;
    if (this.skip) { this.skip.t += step; if (this.skip.t > 0.5) this.skip = null; }
    if (p.mode === "air") {
      const v = Math.hypot(p.vx, p.vy), k = L.drag * v;
      let ax = -k * p.vx, ay = -G - k * p.vy;
      for (const f of this.features) {
        if (f.x > p.x) break;
        if (f.k === "updraft" && p.x <= f.x + f.w && p.y < 900) ay += 1000;
        else if (f.k === "gust" && p.x <= f.x + f.w) ax += f.a;
      }
      p.vx = clamp(p.vx + ax * step, 0, VX_CAP);
      p.vy = clamp(p.vy + ay * step, -VY_CAP, VY_CAP);
      const px = p.x;
      p.x += p.vx * step;
      p.y += p.vy * step;
      p.spin += p.vx * step * 0.05;
      this.airContacts(px);
      if (p.y <= 0 && p.vy < 0) this.touchdown();
    } else this.roll(step);
    if (this.phase !== "fly") return;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.vx) || !Number.isFinite(p.vy)) Object.assign(p, { y: 0, vx: 0, vy: 0, mode: "roll" });
    this.metres = Math.max(this.metres, Math.floor(p.x / M));
    this.R.m = this.metres;
    this.R.alt = Math.max(this.R.alt, Math.floor(p.y / M));
    this.camX = Math.max(0, p.x - LEAD);
    this.camY = Math.max(0, p.y - LIFT);
    this.spawnAhead();
    this.introduce();
    this.milestones();
    if (++this.trailTick % 3 === 0) this.pushTrail(p.x, p.y);
    if (this.runT > RUN_CAP) this.finish("cap");
    this.coach();
    this.hudNow();
  }
  // Beacons, nets and scrap meet the pod in the air (and nets on the ground too).
  airContacts(px) {
    const p = this.p, cy = p.y + R;
    for (const f of this.features) {
      if (f.x > p.x + 140) break;
      if (f.used) continue;
      if (f.k === "net") {
        if (px <= f.x && p.x > f.x && p.y < f.h) {
          f.used = 1;
          p.vx *= 0.35;
          p.vy *= 0.4;
          this.flash = 0.25; this.flashCol = "red";
          this.c.tone(200, 0.12, "square");
        }
      } else if (f.k === "beacon") {
        if (Math.hypot(p.x - f.x, cy - f.y) < f.h + R + 4) {
          f.used = 1;
          p.vy = Math.max(p.vy, 380);
          this.kicks = Math.min(this.L.kicks, this.kicks + 1);
          this.R.beacons++;
          this.kiteRun++;
          this.R.kite = Math.max(this.R.kite, this.kiteRun);
          this.flash = 0.2; this.flashCol = "amber";
          this.c.tone(988, 0.1, "sine");
          this.burst(f.x, f.y, 6, 90);
        }
      } else if (f.k === "scrap") {
        if (Math.hypot(p.x - f.x, cy - f.y) < this.L.magnet + 6) {
          f.used = 1;
          this.R.scrap++;
          this.c.tone(1319 + 60 * (this.R.scrap % 5), 0.03, "sine");
        }
      }
    }
  }
  // The pod reaches the ground from the air.
  touchdown() {
    const p = this.p, L = this.L, f = this.groundAt(p.x), skip = this.skip;
    this.skip = null;
    p.y = 0;
    this.kiteRun = 0;
    const impact = -p.vy;
    if (f && f.k === "pit") {
      if (skip) { this.R.pitskip++; this.bounce(impact, Math.min(SKIP_E_CAP, L.e + 0.2), 0.95, skip.grade); return; }
      this.finish("pit");
      return;
    }
    if (f && this.lift(f, impact)) return;
    if (impact < BOUNCE_VY && !skip) { p.vy = 0; p.mode = "roll"; return; }
    let e = L.e, keep = L.keep;
    if (f && f.k === "drift") { e *= 0.35; keep *= 0.6; }
    if (f && f.k === "ice") { e *= 1.08; keep = 1; }
    if (skip) { // a skip keeps more of both: a perfect one nearly all the speed
      e = Math.min(SKIP_E_CAP, L.e + (skip.grade === "perfect" ? 0.22 : 0.1));
      keep = Math.max(keep, skip.grade === "perfect" ? 0.98 : 0.92);
    }
    this.bounce(impact, e, keep, skip ? skip.grade : "");
    if (f && f.k === "drift" && !skip) { this.flash = 0.2; this.flashCol = "red"; this.c.tone(150, 0.1, "triangle"); }
  }
  bounce(impact, e, keep, grade) {
    const p = this.p;
    p.vy = impact * e;
    p.vx *= keep;
    this.R.bounces++;
    if (grade === "perfect") {
      this.R.perfect++;
      this.flash = 0.22; this.flashCol = "cyan";
      this.note(0, 880, 0.07, "triangle"); this.note(0.06, 1175, 0.1, "triangle");
      this.burst(p.x, 0, 6, 110);
      this.notice = "PERFECT SKIP";
      this.noticeT = 1.2;
    } else if (grade === "good") {
      this.R.good++;
      this.flash = 0.15; this.flashCol = "cyan";
      this.c.tone(660, 0.07, "triangle");
    } else this.c.tone(120 + Math.min(300, impact * 0.4), 0.05, "triangle");
    if (p.vy < BOUNCE_VY * 0.7 && !grade) { p.vy = 0; p.mode = "roll"; }
    else p.mode = "air";
  }
  // Pads, boosters and mines; true when one acted.
  lift(f, impact) {
    const p = this.p;
    if (f.k === "pad") {
      p.vy = clamp(Math.max(impact * 0.95, PAD_V), 0, 900);
      p.vx = Math.min(VX_CAP, p.vx * 1.05 + 20);
      this.R.pads++;
      this.note(0, 523, 0.06, "triangle"); this.note(0.06, 784, 0.1, "triangle");
    } else if (f.k === "boost") {
      p.vx = Math.min(VX_CAP, p.vx + BOOST_X);
      p.vy = Math.max(impact * 0.5, 240);
      this.note(0, 330, 0.06, "sawtooth"); this.note(0.05, 494, 0.06, "sawtooth"); this.note(0.1, 659, 0.1, "sawtooth");
    } else if (f.k === "mine" && !f.used) {
      f.used = 1;
      p.vx = Math.min(VX_CAP, p.vx + 200);
      p.vy = MINE_V;
      this.R.mines++;
      this.c.tone(70, 0.3, "sawtooth");
      this.note(0.05, 140, 0.2, "square");
      this.burst(p.x, 0, 14, 220);
    } else return false;
    this.R.lifts++;
    this.flash = 0.2;
    this.flashCol = f.k === "mine" ? "red" : "white";
    p.y = 0.5;
    p.mode = "air";
    return true;
  }
  roll(step) {
    const p = this.p, f = this.groundAt(p.x);
    p.y = 0;
    p.vy = 0;
    if (f && f.k === "pit") { this.finish("pit"); return; }
    if (f && this.lift(f, 0)) return;
    const kind = f && (f.k === "drift" || f.k === "ice") ? f.k : "ground";
    let ax = -FRICTION[kind] * (kind === "ice" ? 1 : this.L.roll);
    for (const g of this.features) {
      if (g.x > p.x) break;
      if (g.k === "updraft" && p.x <= g.x + g.w) { p.mode = "air"; p.vy = 160; return; }
      if (g.k === "gust" && p.x <= g.x + g.w) ax += g.a * 0.5;
    }
    const px = p.x;
    p.vx = clamp(p.vx + ax * step, 0, VX_CAP);
    p.x += p.vx * step;
    p.spin += p.vx * step * 0.1;
    if (kind === "ice") { this.iceAcc += (p.x - px) / M; this.R.iceRoll = Math.floor(this.iceAcc); }
    this.airContacts(px);
    if (p.vx < STOP_VX) {
      this.restT += step;
      if (this.restT > 0.4) this.finish("rest");
    } else this.restT = 0;
  }
  milestones() {
    const z = zoneAt(this.metres);
    if (z > this.zone) {
      this.zone = z;
      const first = z > this.sv.far;
      this.notice = "ZONE " + ZONES[z].roman + "  " + ZONES[z].name + (first ? "  +" + 25 * z + " SALVAGE" : "");
      this.noticeT = 2.4;
      if (first) { this.sv.far = z; this.zoneBonus += 25 * z; }
      MOTIFS[z].forEach((hz, i) => this.note(0.12 * i, hz, 0.16, "sine"));
    }
    const hundred = Math.floor(this.metres / 100);
    if (hundred > this.lastMilestone) { this.lastMilestone = hundred; this.c.tone(523, 0.05, "sine"); }
  }
  introduce() {
    if (this.noticeT > 0.4) return;
    for (const f of this.features) {
      if (this.sx(f.x) > 900) break; // on screen, ahead of the pod
      if (f.x < this.p.x || this.sv.seen[f.k] || !INTRO[f.k]) continue;
      this.sv.seen[f.k] = 1;
      this.notice = INTRO[f.k];
      this.noticeT = 3.2;
      return;
    }
    if (!this.sv.seen.skip && this.skipWindow() >= 0 && this.p.vy < -250) {
      this.sv.seen.skip = 1;
      this.notice = "PRESS JUST BEFORE IT LANDS: A SKIP.";
      this.noticeT = 3;
    }
  }
  coach() {
    if (this.skipWindow() >= 0 && !this.skip) this.setHint("SKIPNOW", "PRESS NOW TO SKIP.");
    else if (this.p.mode === "roll") this.setHint(this.kicks ? "ROLLK" : "ROLL", this.kicks ? "ROLLING. PRESS TO FIRE A THRUSTER." : "ROLLING TO A STOP.");
    else if (this.hintKey === "SKIPNOW" || this.hintKey === "ROLLK" || this.hintKey === "ROLL") this.setHint("FLY", this.kicks ? "PRESS TO FIRE A THRUSTER. PRESS JUST BEFORE TOUCHDOWN TO SKIP." : "PRESS JUST BEFORE TOUCHDOWN TO SKIP.");
  }

  // ---- the end of a run ------------------------------------------------------------------------
  finish(why) {
    if (this.phase === "over") return;
    const p = this.p, sv = this.sv;
    this.phase = "over";
    this.reason = why;
    this.deadT = 0;
    this.skip = null;
    p.mode = "rest";
    if (why === "pit") { this.burst(p.x, 0, 12, 150); this.c.tone(110, 0.2, "sawtooth"); this.note(0.18, 55, 0.4, "sawtooth"); }
    else { this.note(0, 392, 0.12, "triangle"); this.note(0.12, 330, 0.2, "triangle"); }
    const metres = this.metres;
    this.newRecord = metres > 0 && metres > this.best0;
    if (!this.daily) this.c.score(metres);
    this.goalDone = this.daily && this.goalMet();
    sv.runs++;
    sv.st.metres += metres;
    sv.st.pads += this.R.pads;
    sv.st.perfect += this.R.perfect;
    sv.st.mines += this.R.mines;
    sv.st.scrap += this.R.scrap;
    if (this.daily) {
      const key = this.dayKey();
      if (sv.dl.d !== key) { sv.dl.d = key; sv.dl.best = 0; sv.dl.done = 0; }
      sv.dl.best = Math.max(sv.dl.best, metres);
      if (this.goalDone && !sv.dl.done) {
        sv.dl.done = 1;
        sv.st.daily++;
        sv.dl.streak = sv.dl.last && this.dayBefore(key) === sv.dl.last ? sv.dl.streak + 1 : 1;
        sv.dl.last = key;
        this.R.daily = 1;
      }
    } else {
      sv.best = Math.max(sv.best, metres);
      sv.pb[this.podIx] = Math.max(sv.pb[this.podIx] || 0, metres);
    }
    const before = sv.ft.length;
    this.checkFeats();
    const bounty = (sv.ft.length - before) * FEAT_BOUNTY + this.zoneBonus + (this.R.daily ? 60 : 0);
    this.zoneBonus = 0;
    const earned = salvageFor(metres, this.R.scrap) + bounty;
    sv.salvage += earned;
    sv.milestone = Math.max(sv.milestone, Math.floor(sv.best / 100));
    this.result = { metres, salvage: earned, bounty, pads: this.R.lifts, skips: this.R.perfect, scrap: this.R.scrap, reason: why === "pit" ? "SWALLOWED BY A SINKHOLE" : why === "cap" ? "SIGNAL LOST" : "CAME TO REST", zone: ZONES[zoneAt(metres)].name };
    sv.last = { metres, salvage: earned, lifts: this.R.lifts, skips: this.R.perfect, reason: this.result.reason };
    this.persist();
    this.result.next = this.nextGoal();
    this.setHint("OVER", "TAP TO LAUNCH AGAIN. HOLD FOR THE WORKSHOP.");
    this.hudNow();
  }
  checkFeats() {
    for (const f of FEATS) {
      if (this.sv.ft.includes(f.id)) continue;
      if (num(f.prog(this)) >= f.n) {
        this.sv.ft.push(f.id);
        this.newFeats.push(f.id);
        this.note(0.3, 659, 0.1, "sine");
        this.note(0.4, 880, 0.2, "sine");
      }
    }
  }
  goalMet() {
    const g = dailyGoal(this.dayKey());
    if (g.kind === "metres") return this.metres >= g.n;
    if (g.kind === "perfect") return this.R.perfect >= g.n;
    if (g.kind === "lifts") return this.R.lifts >= g.n;
    return this.R.scrap >= g.n;
  }
  dayBefore(key) {
    const [y, m, d] = key.split("-").map(Number);
    return dateKey(new Date(y, m - 1, d - 1));
  }
  persist() {
    this.c.saveProgress?.(JSON.parse(JSON.stringify(this.sv)))?.catch?.(this.c.error);
  }
  // What to aim for next: the cheapest upgrade, the next pod, and the feat nearest its goal.
  nextGoal() {
    const sv = this.sv, lines = [];
    let cheap = -1;
    for (let i = 0; i < UPGRADES.length; i++) if (sv.up[i] < UP_MAX && (cheap < 0 || UPGRADES[i].cost[sv.up[i]] < UPGRADES[cheap].cost[sv.up[cheap]])) cheap = i;
    if (cheap >= 0) {
      const cost = UPGRADES[cheap].cost[sv.up[cheap]];
      lines.push(cost <= sv.salvage ? "WORKSHOP: " + UPGRADES[cheap].name + " " + roman(sv.up[cheap] + 1) + " IS READY (" + cost + ")" : "NEXT: " + UPGRADES[cheap].name + " " + roman(sv.up[cheap] + 1) + " AT " + cost + " SALVAGE");
    }
    let best = null, bestF = 0;
    for (const f of FEATS) {
      if (sv.ft.includes(f.id) || f.hidden) continue;
      const frac = num(f.prog(this)) / f.n;
      if (frac > bestF && frac < 1) { bestF = frac; best = f; }
    }
    if (best) lines.push("CLOSEST FEAT: " + best.name + " " + Math.floor(num(best.prog(this))) + " / " + best.n);
    return lines;
  }

  // ---- sound, particles, hud -------------------------------------------------------------------
  note(at, hz, d, w) { if (this.sq.length < 12) this.sq.push([this.t + at, hz, d, w]); }
  runSfx() {
    if (!this.sq.length) return;
    let keep = 0;
    for (let i = 0; i < this.sq.length; i++) {
      const e = this.sq[i];
      if (e[0] <= this.t) this.c.tone(e[1], e[2], e[3]);
      else this.sq[keep++] = e;
    }
    this.sq.length = keep;
  }
  burst(x, y, n, speed) {
    for (let i = 0; i < n; i++) {
      const k = this.partNext++ % MAX_PARTS, o = k * 5, a = (i / n) * Math.PI + 0.1;
      this.parts[o] = x; this.parts[o + 1] = y;
      this.parts[o + 2] = Math.cos(a) * speed * (0.5 + (i % 3) * 0.25);
      this.parts[o + 3] = Math.sin(a) * speed * (0.5 + (i % 3) * 0.25);
      this.parts[o + 4] = 0.6;
    }
    this.partNext %= MAX_PARTS;
  }
  stepParts(dt) {
    for (let k = 0; k < MAX_PARTS; k++) {
      const o = k * 5;
      if (this.parts[o + 4] <= 0) continue;
      this.parts[o] += this.parts[o + 2] * dt;
      this.parts[o + 1] = Math.max(0, this.parts[o + 1] + this.parts[o + 3] * dt);
      this.parts[o + 3] -= G * 0.6 * dt;
      this.parts[o + 4] -= dt;
    }
  }
  pushTrail(x, y) {
    this.trail.copyWithin(0, 2);
    this.trail[(TRAIL - 1) * 2] = x;
    this.trail[(TRAIL - 1) * 2 + 1] = y;
    this.trailN = Math.min(TRAIL, this.trailN + 1);
  }
  setHint(key, message) {
    if (key === this.hintKey) return;
    this.hintKey = key;
    this.c.hint(message);
  }
  hudNow() {
    const run = this.phase === "fly" || this.phase === "aim";
    const items = run
      ? [["DISTANCE", this.metres + " m"], ["THRUST", this.kicks + "/" + this.L.kicks], ["BEST", this.bestRef() + " m"]]
      : [["BEST", this.sv.best + " m"], ["SALVAGE", this.sv.salvage], ["FEATS", this.sv.ft.length + "/" + FEATS.length]];
    const key = items.map((x) => x[1]).join("|");
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.c.hud(items);
  }

  // ---- lamps -------------------------------------------------------------------------------------
  // Aiming: a spot that follows the barrel (left low, right high). Charging: a meter that fills
  // green, amber, red. Flight: left = height, middle = speed in the zone's colour, right = thrusters
  // left. A coming touchdown turns all three cyan, brightest at the perfect moment. A sinkhole close
  // ahead of a low pod blinks the middle lamp red. Pads, skips and blasts flash.
  lampValues() {
    const ph = this.phase;
    if (ph === "title" || ph === "shop") return spot(0.5 + 0.5 * Math.sin(this.t * 0.8), dim(ZONES[this.sv.far].col, 0.12));
    if (ph === "over") {
      if (this.deadT < 1) return this.reason === "pit" ? fill(LAMP.red, 0.35 * (1 - this.deadT)) : fill(LAMP.amber, 0.2 * (1 - this.deadT));
      if (this.newRecord) return fill(LAMP.cyan, 0.06 + 0.1 * pulse(this.t, 0.5));
      return spot(0.5 + 0.5 * Math.sin(this.t * 0.5), dim(ZONES[this.zone].col, 0.07));
    }
    if (ph === "aim") {
      if (this.charging) {
        const col = ramp(this.power, [LAMP.green, LAMP.amber, LAMP.red]);
        return this.flash > 0 ? fill(LAMP.white, 0.6) : meter(Math.max(0.04, this.power), dim(col, 0.45));
      }
      return spot((this.angle - A_LO) / (A_HI - A_LO), dim(LAMP.amber, 0.3));
    }
    if (this.flash > 0) {
      const col = { white: LAMP.white, red: LAMP.red, amber: LAMP.amber, cyan: LAMP.cyan }[this.flashCol] || LAMP.white;
      return fill(col, 0.25 + 1.2 * this.flash);
    }
    const p = this.p, tti = this.skipWindow();
    if (tti >= 0 && !this.skip) {
      const near = 1 - tti / SKIP_WIN, perfect = tti <= this.L.perfect;
      return fill(perfect ? blend(LAMP.cyan, LAMP.white, 0.5) : LAMP.cyan, perfect ? 0.6 : 0.08 + 0.25 * near);
    }
    const height = clamp(p.y / 400, 0, 1), speed = clamp(Math.hypot(p.vx, p.vy) / 900, 0, 1);
    const left = dim(LAMP.blue, 0.04 + 0.36 * height);
    let mid = dim(ZONES[this.zone].col, 0.06 + 0.32 * speed);
    if (this.pitAhead()) mid = blink(this.runT, 6) ? dim(LAMP.red, 0.45) : [0, 0, 0];
    const right = this.kicks > 0 ? dim(LAMP.amber, 0.06 + 0.3 * (this.kicks / this.L.kicks)) : null;
    return lamps(left, mid, right);
  }
  pitAhead() {
    const p = this.p;
    if (p.y > 120) return false;
    for (const f of this.features) {
      if (f.x > p.x + Math.max(160, p.vx * 0.9)) break;
      if (f.k === "pit" && f.x + f.w > p.x) return true;
    }
    return false;
  }

  // ---- drawing ------------------------------------------------------------------------------------
  sx(x) { return SX0 + x - this.camX; }
  sy(y) { return GY - (y - this.camY); }
  draw(g) {
    space(g, this.camX * 0.2, 0.5);
    this.drawBackdrop(g);
    this.drawGround(g);
    this.drawFeatures(g);
    this.drawMarks(g);
    this.drawCannon(g);
    this.drawPod(g);
    this.drawParts(g);
    if (this.phase === "title") this.drawTitle(g);
    else if (this.phase === "over") this.drawResult(g);
    else if (this.phase === "shop") this.drawShop(g);
    else this.drawOverlay(g);
    this.drawHoldRing(g);
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
  // Faint ridgelines far behind, in the colour of the zone the camera is in.
  drawBackdrop(g) {
    const z = this.phase === "title" || this.phase === "shop" ? this.sv.far : zoneAt((this.camX + 480) / M);
    const ink = ZONES[z].ink, par = 0.35, cell = 120;
    const i0 = Math.floor((this.camX * par) / cell), base = this.sy(0) - 30 + this.camY * 0.6;
    if (base < 0) return;
    g.strokeStyle = ink;
    g.globalAlpha = 0.18;
    g.lineWidth = 2;
    g.beginPath();
    for (let i = i0; i < i0 + 10; i++) {
      const h = mixSeed(i * 7919 + z), x = i * cell - this.camX * par, top = base - 30 - ((h >>> 4) % 90);
      if (i === i0) g.moveTo(x, base - 20);
      if (z === 3) { g.lineTo(x + 50, base - 10); g.lineTo(x + 58, top - 60); g.lineTo(x + 66, base - 10); }
      else if (z === 5) { g.lineTo(x + 40, top); g.lineTo(x + 52, top + 30); g.lineTo(x + 70, top - 10); }
      else g.lineTo(x + 60, top);
      g.lineTo(x + cell, base - 20);
    }
    g.stroke();
    g.globalAlpha = 1;
  }
  drawGround(g) {
    const y = this.sy(0);
    if (y > 540) { // the ground is below the screen: say how far
      const alt = Math.floor(this.p.y / M);
      line(g, 40, 520, 920, 520, C.line, 1);
      text(g, "GROUND " + alt + " m BELOW", 60, 500, 18, C.muted);
      return;
    }
    line(g, 0, y, 960, y, C.line, 2);
    // a tick every 10 m, a label every 50 m
    const m0 = Math.floor((this.camX - SX0) / M / 10) * 10;
    for (let m = Math.max(0, m0); m < m0 + 120; m += 10) {
      const x = this.sx(m * M);
      if (x < -10 || x > 970) continue;
      const big = m % 50 === 0;
      line(g, x, y, x, y + (big ? 14 : 6), C.line, 2);
      if (big && m > 0 && y < 520) text(g, m + " m", x, y + 30, 16, C.muted, "center");
    }
  }
  drawFeatures(g) {
    const gy = this.sy(0);
    for (const f of this.features) {
      const x = this.sx(f.x);
      if (x > 1000) break;
      if (x + (f.w || 0) < -40) continue;
      const w = f.w;
      if (f.k === "pad") {
        line(g, x, gy - 10, x + w, gy - 10, C.cyan, 3);
        for (let i = 0; i < 3; i++) { const zx = x + 6 + i * 14; line(g, zx, gy, zx + 7, gy - 10, C.cyan, 2); line(g, zx + 7, gy - 10, zx + 14, gy, C.cyan, 2); }
      } else if (f.k === "boost") {
        line(g, x, gy - 3, x + w, gy - 3, C.ink, 3);
        for (let i = 0; i < 3; i++) { const cx = x + 14 + i * 24; line(g, cx, gy - 16, cx + 10, gy - 8, C.ink, 2); line(g, cx + 10, gy - 8, cx, gy - 0, C.ink, 2); }
      } else if (f.k === "mine") {
        if (f.used) { line(g, x, gy - 2, x + w, gy - 2, C.muted, 2); continue; }
        g.beginPath(); g.arc(x + w / 2, gy, 12, Math.PI, 0); g.strokeStyle = C.red; g.lineWidth = 2; g.stroke();
        circle(g, x + w / 2, gy - 6, 3, blink(this.t, 2) ? C.red : C.dark, true);
      } else if (f.k === "drift") {
        g.fillStyle = "#3a2f1f"; g.fillRect(x, gy - 6, w, 8);
        for (let i = 8; i < w; i += 22) line(g, x + i, gy - 6, x + i + 10, gy - 10, C.amber, 1.5);
      } else if (f.k === "ice") {
        line(g, x, gy - 1, x + w, gy - 1, C.cyan, 4);
        for (let i = 20; i < w; i += 60) line(g, x + i, gy - 1, x + i + 14, gy - 12, "#8fcbc580", 2);
      } else if (f.k === "pit") {
        g.fillStyle = C.bg; g.fillRect(x, gy - 2, w, 24);
        line(g, x, gy, x + 6, gy + 18, C.red, 2); line(g, x + w, gy, x + w - 6, gy + 18, C.red, 2);
        line(g, x + 6, gy + 18, x + w - 6, gy + 18, C.red, 2);
      } else if (f.k === "net") {
        const top = this.sy(f.h);
        line(g, x, gy, x, top, f.used ? C.line : C.amber, 3);
        if (!f.used) for (let yy = top + 12; yy < gy; yy += 16) line(g, x - 8, yy, x + 8, yy - 8, C.muted, 1.5);
      } else if (f.k === "beacon") {
        if (f.used) continue;
        const by = this.sy(f.y);
        diamond(g, x, by, f.h, C.amber, false);
        circle(g, x, by, 4, C.amber, true);
      } else if (f.k === "updraft") {
        g.globalAlpha = 0.35;
        for (let i = 10; i < w; i += 30) {
          const off = ((this.t * 120 + i * 7) % 120);
          line(g, x + i, gy - off, x + i, gy - off - 30, C.cyan, 2);
          line(g, x + i, gy - off - 120, x + i, gy - off - 150, C.cyan, 2);
        }
        g.globalAlpha = 1;
      } else if (f.k === "gust") {
        g.globalAlpha = 0.4;
        const dir = f.a > 0 ? 1 : -1;
        for (let i = 40; i < w; i += 90) {
          const yy = gy - 40 - (i % 3) * 40, cx = x + i;
          line(g, cx - 18, yy, cx + 18, yy, C.ink, 2);
          line(g, cx + 18 * dir, yy, cx + 8 * dir, yy - 7, C.ink, 2);
          line(g, cx + 18 * dir, yy, cx + 8 * dir, yy + 7, C.ink, 2);
        }
        g.globalAlpha = 1;
      } else if (f.k === "scrap") {
        if (f.used) continue;
        const by = this.sy(f.y);
        g.strokeStyle = C.ink; g.lineWidth = 2;
        g.strokeRect(x - 5, by - 5, 10, 10);
      }
    }
  }
  // The best distance and the daily best as flags on the ground.
  drawMarks(g) {
    const gy = this.sy(0), best = this.bestRef();
    if (best > 0 && gy < 560) {
      const x = this.sx(best * M);
      if (x > -20 && x < 980) {
        line(g, x, gy, x, gy - 60, C.amber, 2);
        line(g, x, gy - 60, x + 22, gy - 52, C.amber, 2);
        line(g, x + 22, gy - 52, x, gy - 44, C.amber, 2);
        text(g, this.daily ? "TODAY" : "BEST", x + 4, gy - 74, 16, C.amber, "center");
      }
    }
  }
  drawCannon(g) {
    const px = this.sx(0), py = this.sy(PIVOT_Y);
    if (px < -80) return;
    const a = (this.angle * Math.PI) / 180;
    g.strokeStyle = C.ink; g.lineWidth = 2;
    g.beginPath(); g.moveTo(px - 26, this.sy(0)); g.lineTo(px - 14, py); g.lineTo(px + 14, py); g.lineTo(px + 26, this.sy(0)); g.stroke();
    line(g, px, py, px + Math.cos(a) * BARREL, py - Math.sin(a) * BARREL, this.phase === "aim" ? C.amber : C.ink, 7);
    circle(g, px, py, 7, C.ink, false, 2);
    if (this.phase === "aim") {
      // the power meter: an arc beside the barrel, and a short guide along the aim
      for (let i = 1; i <= 3; i++) {
        const d = BARREL + 14 + i * 16;
        circle(g, px + Math.cos(a) * d, py - Math.sin(a) * d, 2, C.muted, true);
      }
      const h = 120, x0 = px + 70, y0 = this.sy(0) - 10;
      g.strokeStyle = C.line; g.lineWidth = 2; g.strokeRect(x0, y0 - h, 16, h);
      if (this.charging) {
        const col = this.power > 0.85 ? C.red : this.power > 0.55 ? C.amber : C.ink;
        g.fillStyle = col; g.fillRect(x0 + 3, y0 - 3 - (h - 6) * this.power, 10, (h - 6) * this.power);
      }
    }
  }
  drawPod(g) {
    if (this.phase === "aim" || this.phase === "title" || this.phase === "shop") return;
    const p = this.p, x = this.sx(p.x), y = this.sy(p.y + R);
    // trail
    if (this.trailN > 1) {
      g.strokeStyle = C.amber; g.lineWidth = 2; g.globalAlpha = 0.5;
      g.beginPath();
      for (let i = TRAIL - this.trailN; i < TRAIL; i++) {
        const tx = this.sx(this.trail[i * 2]), ty = this.sy(this.trail[i * 2 + 1] + R);
        if (i === TRAIL - this.trailN) g.moveTo(tx, ty); else g.lineTo(tx, ty);
      }
      g.lineTo(x, y);
      g.stroke();
      g.globalAlpha = 1;
    }
    // the skip cue: a ring that closes on the landing point as touchdown nears
    const tti = this.phase === "fly" ? this.skipWindow() : -1;
    if (tti >= 0 && !this.skip) {
      const lx = this.sx(p.x + p.vx * tti), perfect = tti <= this.L.perfect;
      g.beginPath(); g.ellipse(lx, this.sy(0), 10 + 90 * tti, 4 + 20 * tti, 0, 0, TAU);
      g.strokeStyle = perfect ? C.ink : C.cyan; g.lineWidth = perfect ? 4 : 2; g.stroke();
    }
    if (this.phase === "over" && this.reason === "pit") return;
    circle(g, x, y, R, this.skip ? C.cyan : C.ink, false, 3);
    line(g, x, y, x + Math.cos(p.spin) * R, y + Math.sin(p.spin) * R, C.ink, 2);
    if (y < 10) { // above the screen: a pointer with the height
      diamond(g, x, 22, 8, C.amber, true);
      text(g, Math.floor(p.y / M) + " m UP", x + 16, 22, 16, C.amber);
    }
  }
  drawParts(g) {
    g.fillStyle = C.amber;
    for (let k = 0; k < MAX_PARTS; k++) {
      const o = k * 5;
      if (this.parts[o + 4] <= 0) continue;
      g.globalAlpha = clamp(this.parts[o + 4] / 0.6, 0, 1);
      g.fillRect(this.sx(this.parts[o]) - 2, this.sy(this.parts[o + 1]) - 2, 4, 4);
    }
    g.globalAlpha = 1;
  }
  drawOverlay(g) {
    text(g, this.metres + " m", 480, 50, 34, C.ink, "center");
    // thrusters left, as pips under the distance
    for (let i = 0; i < this.L.kicks; i++) {
      const x = 480 - (this.L.kicks - 1) * 12 + i * 24;
      diamond(g, x, 86, 7, i < this.kicks ? C.amber : C.line, i < this.kicks);
    }
    if (this.daily) text(g, "DAILY: " + dailyGoal(this.dayKey()).text.toUpperCase(), 480, 118, 18, C.cyan, "center");
    if (this.noticeT > 0 && this.notice) {
      g.globalAlpha = clamp(this.noticeT / 0.4, 0, 1);
      text(g, this.notice, 480, 150, 22, this.notice.startsWith("PERFECT") ? C.cyan : C.amber, "center");
      g.globalAlpha = 1;
    }
    if (this.phase === "aim" && this.sv.runs < 2 && !this.charging) {
      g.fillStyle = "#0c1511e8";
      g.fillRect(250, 190, 460, 100);
      text(g, "HOLD TO CHARGE", 480, 222, 28, C.amber, "center");
      text(g, "RELEASE TO FIRE", 480, 260, 22, C.muted, "center");
    }
  }
  drawTitle(g) {
    banner(g, "BALLISTA", "FIRE THE POD AS FAR AS IT WILL GO");
    let y = 392;
    text(g, "HOLD = CHARGE     RELEASE = FIRE     PRESS IN FLIGHT = THRUST OR SKIP", 480, y, 16, C.muted, "center");
    y += 30;
    if (this.sv.best > 0) { text(g, "BEST " + this.sv.best + " m     SALVAGE " + this.sv.salvage, 480, y, 18, C.amber, "center"); y += 30; }
    else if (this.sv.legacy) { text(g, "THE RANGE HAS BEEN REBUILT. " + this.sv.salvage + " SALVAGE TO START.", 480, y, 18, C.amber, "center"); y += 30; }
    text(g, "HOLD = WORKSHOP", 480, y, 18, C.cyan, "center");
  }
  drawResult(g) {
    if (this.deadT < 0.5 || !this.result) return;
    const r = this.result;
    g.fillStyle = "#0c1511e8";
    g.fillRect(170, 60, 620, 440);
    line(g, 220, 70, 740, 70, C.line);
    text(g, r.reason, 480, 100, 22, this.reason === "pit" ? C.red : C.muted, "center");
    text(g, r.metres + " m", 480, 152, 52, C.ink, "center");
    text(g, this.newRecord ? (this.daily ? "BEST TODAY" : "NEW RECORD") : "BEST " + this.bestRef() + " m", 480, 196, 20, this.newRecord ? C.cyan : C.amber, "center");
    let y = 238;
    const row = (label, value, col = C.ink) => { text(g, label, 240, y, 18, C.muted); text(g, value, 720, y, 22, col, "right"); y += 32; };
    row("SALVAGE", "+" + r.salvage + (r.bounty ? "  (BOUNTY " + r.bounty + ")" : ""), C.amber);
    row("LIFTS  /  PERFECT SKIPS", r.pads + "  /  " + r.skips);
    if (r.scrap || this.sv.st.scrap) row("SCRAP", r.scrap);
    if (this.daily) { text(g, this.goalDone ? "DAILY GOAL MET" : "DAILY: " + dailyGoal(this.dayKey()).text.toUpperCase(), 480, y, 18, this.goalDone ? C.cyan : C.muted, "center"); y += 28; }
    for (const id of this.newFeats.slice(0, 2)) {
      const f = FEATS.find((x) => x.id === id);
      if (f) { text(g, "FEAT  " + f.name, 480, y, 20, C.cyan, "center"); y += 28; }
    }
    for (const l of (r.next || []).slice(0, 2)) { if (y > 440) break; text(g, l, 480, y, 16, C.muted, "center"); y += 24; }
    if (this.deadT > 0.7) text(g, "TAP = AGAIN     HOLD = WORKSHOP", 480, 474, 18, C.amber, "center");
  }
  drawShop(g) {
    g.fillStyle = "#0c1511f2";
    g.fillRect(110, 30, 740, 486);
    line(g, 160, 40, 800, 40, C.line);
    text(g, "WORKSHOP", 300, 72, 32, C.amber, "center");
    text(g, "SALVAGE " + this.sv.salvage, 790, 72, 22, C.ink, "right");
    const sv = this.sv, n = sv.ft.length;
    if (this.view === "menu") {
      WORKSHOP.forEach((id, i) => {
        const y = 118 + i * 31, on = i === this.cur;
        let label = id, value = "";
        if (i >= 1 && i <= UPGRADES.length) {
          const L = sv.up[i - 1], u = UPGRADES[i - 1];
          label = u.name;
          for (let k = 0; k < UP_MAX; k++) diamond(g, 410 + k * 22, y, 6, k < L ? (on ? C.amber : C.ink) : C.line, k < L);
          value = L >= UP_MAX ? "FULL" : u.cost[L] + (u.cost[L] <= sv.salvage ? "  BUY" : "");
        } else if (id === "LAUNCH") value = "BEST " + sv.best + " m";
        else if (id === "POD") value = PODS[sv.pod].name;
        else if (id === "DAILY") value = this.dailyDone() ? "DONE TODAY" : "BEST " + (sv.dl.d === this.dayKey() ? sv.dl.best : 0) + " m";
        else if (id === "FEATS") value = n + " / " + FEATS.length;
        else if (id === "LOG") value = "ZONE " + ZONES[sv.far].roman + " / VI";
        if (on) diamond(g, 150, y, 8, C.amber, true);
        text(g, label, 176, y, 22, on ? C.amber : C.ink);
        text(g, value, 810, y, 20, on ? C.amber : C.muted, "right");
      });
      const id = WORKSHOP[this.cur];
      let info = "";
      if (this.need) info = this.need;
      else if (id === "LAUNCH") info = "Fire a pod with this loadout.";
      else if (this.cur <= UPGRADES.length) info = UPGRADES[this.cur - 1].text + (sv.up[this.cur - 1] < UP_MAX ? "  HOLD TO BUY." : "");
      else if (id === "POD") { const next = PODS.find((x, i) => i > 0 && !this.unlockedPod(i)); info = PODS[sv.pod].text + (next ? "  NEXT: " + next.name + " AT " + next.need + " FEATS" : ""); }
      else if (id === "DAILY") info = "Same field and kit for everyone today. " + dailyGoal(this.dayKey()).text + (sv.dl.streak > 1 ? "  STREAK " + sv.dl.streak : "");
      else if (id === "FEATS") info = "Named goals, " + FEAT_BOUNTY + " salvage each. Some are not listed.";
      else info = "Zones reached and lifetime totals.";
      text(g, info, 480, 444, 16, this.need ? C.cyan : C.muted, "center");
      text(g, "TAP = NEXT LINE     HOLD = CHOOSE", 480, 484, 18, C.cyan, "center");
    } else if (this.view === "feats") {
      const per = 6, pages = Math.ceil(FEATS.length / per);
      text(g, "FEATS  " + n + " / " + FEATS.length + "     PAGE " + (this.page + 1) + " / " + pages, 480, 112, 20, C.cyan, "center");
      FEATS.slice(this.page * per, this.page * per + per).forEach((f, i) => {
        const y = 150 + i * 52, done = sv.ft.includes(f.id);
        text(g, (done ? "[X] " : "[ ] ") + (f.hidden && !done ? "????" : f.name), 150, y, 22, done ? C.cyan : C.ink);
        const prog = num(f.prog(this));
        text(g, done ? "DONE" : f.hidden ? "" : Math.floor(Math.min(prog, f.n)) + " / " + f.n, 810, y, 20, done ? C.cyan : C.amber, "right");
        text(g, f.hidden && !done ? f.hint : f.text, 150, y + 24, 16, C.muted);
      });
      text(g, "TAP = NEXT PAGE     HOLD = BACK", 480, 484, 18, C.cyan, "center");
    } else {
      text(g, "LOG   RUNS " + sv.runs + "   " + sv.st.metres + " m IN ALL", 480, 112, 20, C.cyan, "center");
      ZONES.forEach((z, i) => {
        const y = 150 + i * 34, got = i <= sv.far;
        text(g, z.roman + "  " + z.name, 160, y, 20, got ? z.ink : C.line);
        text(g, got ? "FROM " + z.from + " m" : "NOT REACHED", 800, y, 18, got ? C.amber : C.line, "right");
      });
      const y = 150 + ZONES.length * 34 + 10;
      text(g, "PADS " + sv.st.pads + "   PERFECT SKIPS " + sv.st.perfect + "   MINES " + sv.st.mines + "   SCRAP " + sv.st.scrap, 480, y, 16, C.muted, "center");
      text(g, PODS.map((p, i) => p.name + " " + sv.pb[i] + " m").join("   "), 480, y + 28, 16, C.muted, "center");
      if (sv.legacy) text(g, "FIRST RANGE: " + sv.legacy.runs + " SURVEYS, LAST SCORE " + sv.legacy.score, 480, y + 56, 16, C.line, "center");
      text(g, "TAP = BACK", 480, 484, 18, C.cyan, "center");
    }
  }
  dailyDone() { return this.sv.dl.d === this.dayKey() && this.sv.dl.done === 1; }
}
