// PERIHELION — a one-button momentum game. A probe coasts left to right through a
// field of small suns. Hold: it is tethered to the sun marked by the reticle and
// swings like a pendulum on a rigid line. Release: it leaves on the exact tangent.
// The lamps are the probe's instruments (height + speed in flight, swing angle on a tether).
//
// Around that core (the constants, the tether rule, the release and the first minute of a run are
// untouched): a journey of six regions that change how the swing is used, relics and rare suns to
// find, an arrival at the end, a hangar (probe, start region, trail, daily run, feats, log) reached
// by holding on the title or result screen, and a versioned save (schema 2) that still carries the
// original fields.
import { C, space, text, line, circle, diamond, banner } from "../engine/draw.js";
import { TAU, clamp, lerp, wrapAngle, mixSeed, Random } from "../engine/math.js";
import { LAMP, lamps, dim, blend, ramp, spot, pulse, blink, fill, meter, lightsOff } from "../engine/lightshow.js";
import { AppGuard } from "../engine/input.js";

const G = 240; // px/s^2, light gravity for flight and swing alike
const REACH = 275; // how far a tether can be thrown
const MIN_CATCH = 50; // a sun closer than this cannot be caught (the line would be a knot)
const BAND_TOP = 12, BAND_BOT = 528; // leaving this band ends the run
const PROBE_R = 6;
const PX_PER_MKM = 10; // distance unit: megakilometres, 10 logical px each
const CLEAN = 0.35; // a tether shorter than this is a stray tap, not a swing
const TAP_FREE = 0.08, TAP_FULL = 0.33; // release direction blends from "unchanged" to "tangent"
const FUSE = 2.4; // seconds an amber sun holds a tether
const CHAIN_GAP = 1.2; // seconds of free flight a chain survives
const CAM_LEAD = 300; // probe's screen x
const CATCH_LAG = 5 / 60; // the tether takes this long to engage; a shorter press never touches the course
const DASH = [7, 7];
const NO_DASH = [];
const TRAIL = 22;
const MAX_PARTS = 24;
const HOLD_PICK = 0.5; // a press this long on a menu screen chooses instead of tapping
const MAX_VOIDS = 30, MAX_RELICS = 12;
const SLING_GAIN = 1.08, SLING_CAP = 460; // a sling sun adds this much speed on a clean release
const RELIC_PICK = 26; // collect radius (relic radius plus probe)
const NEAR_GAP = 28; // a dark body passed within this many px of its edge is a near pass
const ARRIVAL = 28000; // the perihelion itself
const BACK = 400; // how far behind the furthest point reached the probe may go back for a sun
const STALL_PHI = 1.75; // a swing that stops this far round from the bottom (above level) is a stall
const MAX_LOOPS = 3; // loops that score on one tether (a loop can go on for ever otherwise)
// Tricks: flat points (not multiplied by the chain, so style adds to a run without swamping distance).
const TRICKS = { stall: ["STALL", 15], loop: ["LOOP", 25] };
// Paced runs: the screen moves at a set speed, px/s, and its left edge ends the run.
const PACES = [{ name: "OFF", v: 0 }, { name: "STEADY", v: 100 }, { name: "BRISK", v: 135 }];
// Upgrades bought with shards (earned every run) in the hangar. `cost` lists the price of each
// level; `fx(level)` is what the level gives. A daily run uses none, so it stays the same for all.
const UPGRADES = [
  { id: "lives", name: "SPARE PROBE", cost: [3, 8, 16], text: "One more probe a run. A lost probe's spare waits at the next sun." },
  { id: "reach", name: "LONG LINE", cost: [5, 12], text: "The tether reaches 20 px further a level." },
  { id: "magnet", name: "RELIC MAGNET", cost: [4, 10], text: "Relics are collected from further away." },
  { id: "dark", name: "DARK BRAKE", cost: [4, 10], text: "The dark behind you sweeps 10 % slower a level." },
  { id: "fuse", name: "COOLANT", cost: [5, 12], text: "Amber suns hold the tether 0.6 s longer a level." },
];
// A goal for each run (not daily runs), drawn from the run count; meeting it pays bonus shards.
// `n` holds three tiers; the tier rises with the furthest region reached.
const GOALS = [
  { text: (n) => "Swing " + n + " loops.", short: "LOOPS", n: [2, 3, 4], prog: (a) => a.R.loops },
  { text: (n) => "Stall " + n + " times.", short: "STALLS", n: [2, 3, 4], prog: (a) => a.R.stalls },
  { text: (n) => "Collect " + n + " relics.", short: "RELICS", n: [3, 4, 6], prog: (a) => a.R.relics },
  { text: (n) => "Make " + n + " close passes.", short: "CLOSE PASSES", n: [3, 5, 7], prog: (a) => a.R.near },
  { text: (n) => "Reach a chain of " + n + ".", short: "CHAIN", n: [10, 15, 20], prog: (a) => a.bestChain },
  { text: (n) => "Reach " + REGIONS[n].name + ".", short: "REGIONS", n: [2, 3, 4], prog: (a) => a.R.far },
];
const goalRng = new Random(1);
const SHARD_PX = 2000; // one shard per 200 Mkm flown, plus one a relic and five for an arrival
const REASONS = {
  fall: "FELL INTO THE DARK",
  top: "LOST ABOVE THE FIELD",
  void: "STRUCK A DARK BODY",
  dark: "OVERTAKEN BY THE TERMINATOR",
  edge: "LEFT BEHIND BY THE PACE",
  arrived: "THE PERIHELION IS REACHED",
};

// ---- the journey ---------------------------------------------------------------
// Each region starts at `from` (px). `col` is its lamp colour in flight, `ink` its colour on screen.
const REGIONS = [
  { name: "THE APPROACH", roman: "I", from: 0, col: LAMP.green, ink: "#9fdc7a", text: "Small suns, a clear sky." },
  { name: "THE CLUSTER", roman: "II", from: 5000, col: [70, 160, 255], ink: "#ece4d0", text: "Suns crowd close. Swing short, chain fast." },
  { name: "THE BINARIES", roman: "III", from: 9000, col: LAMP.violet, ink: "#b48cf0", text: "Paired suns circle each other. Catch them moving." },
  { name: "THE NEBULA", roman: "IV", from: 13500, col: LAMP.blue, ink: "#6fa8dc", text: "A current pushes the probe in flight." },
  { name: "THE DARK FIELD", roman: "V", from: 18000, col: [255, 0, 110], ink: "#e0507a", text: "Dark bodies crowd the lanes." },
  { name: "THE BEAT", roman: "VI", from: 22500, col: [255, 215, 0], ink: "#e8dd6a", text: "Some suns pulse. Catch them while they are lit." },
];
const NEB0 = REGIONS[3].from, NEB1 = REGIONS[4].from;
// What the player learns the first time each mechanic appears (once per save).
const INTRO = {
  relic: "A relic. Fly through it for points.",
  near: "Close pass. Style points.",
  sling: "A sling sun. Let go for extra speed.",
  pair: "Paired suns move. The tether follows.",
  current: "The streaks show which way the current pushes.",
  pulse: "Only a lit sun can be caught.",
  plain: "",
};
// The hangar's GUIDE: one page per screen, tap for the next.
const GUIDE = [
  ["CONTROLS",
    "HOLD: throw the tether to the sun marked by the diamond.",
    "The tether is a solid rod. Grab from below, beside or above.",
    "RELEASE: fly off the way the swing is carrying you.",
    "A quick tap barely bends your course.",
    "Heading back? The diamond marks a sun behind you, not too far.",
    "Stay between the dashed lines. Outrun the dark behind you."],
  ["TRICKS",
    "Points for style, added on top of the distance score.",
    "STALL: swing up past level and hang there as it stops.",
    "LOOP: swing right round the sun. Up to 3 loops pay on one tether.",
    "Relics pay 25, a close pass by a dark body 8."],
  ["SCORE AND CHAIN",
    "Score is distance flown, in Mkm, plus tricks, relics,",
    "close passes and 400 for reaching the perihelion.",
    "CHAIN: swings in a row, each next sun caught within",
    "1.2 s of letting go. It earns no points, only feats.",
    "Going back for a sun you used keeps the chain going."],
  ["DAILY RUN",
    "One world and one goal for each date.",
    "When Perihelion is one of the console's TODAY'S THREE,",
    "meeting the goal meets its order and keeps the streak.",
    "A daily run never changes the console's best."],
  ["SHARDS AND UPGRADES",
    "Every run earns shards: 1 per 200 Mkm, 1 a relic, 5 for arriving.",
    "Each run has a GOAL, top right with its bar. Meet it for shards.",
    "Spend them in the hangar under UPGRADES.",
    "SPARE PROBE: lose a probe and the run goes on from the next sun.",
    "LONG LINE, RELIC MAGNET, DARK BRAKE, COOLANT: small help.",
    "A daily run uses no upgrades."],
  ["LAMPS",
    "Flight: the region's colour, filling with speed.",
    "Tether: a cyan spot that swings with you.",
    "Ahead: red for a dark body, white for a relic,",
    "on the left lamp if above you, right if below.",
    "4th lamp: cyan = a press catches. Green = let go now.",
    "4th lamp red: the dark is close behind."],
  ["HANGAR",
    "It opens on LAUNCH: hold to fly. New rows appear as you earn them.",
    "PACE: the screen moves by itself; keep up or the run ends.",
    "Reaching further regions opens START points, probes and trails.",
    "Only a Standard run from the Approach sets the console best.",
    "LOG: regions and best crossings. Feats: the console's LOGBOOK."],
];
// Pentatonic degrees (semitones) for the swing's song and the region motifs.
const PENT = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
const MOTIFS = [[392, 494, 587], [440, 523, 659], [330, 415, 494], [294, 370, 440], [262, 311, 392], [523, 659, 784]];

// Probes and trails unlock by the furthest region reached (6: an arrival). `feats` is the feat
// count that unlocked them before feats moved to the console logbook; a save that had it keeps it.
const PROBES = [
  { name: "STANDARD", g: 1, reg: 0, feats: 0, text: "The probe as it always was." },
  { name: "BALLAST", g: 0.8, reg: 2, feats: 4, text: "Heavy. Flat flights, slow swings." },
  { name: "WISP", g: 1.25, reg: 4, feats: 8, text: "Light. Quick swings, steep arcs." },
];
const TRAILS = [
  { name: "AMBER", col: C.amber, dash: false, reg: 0, feats: 0 },
  { name: "CYAN", col: C.cyan, dash: false, reg: 1, feats: 1 },
  { name: "MOSS", col: C.ink, dash: false, reg: 2, feats: 3 },
  { name: "DASHED", col: C.amber, dash: true, reg: 3, feats: 6 },
  { name: "EMBER", col: C.red, dash: true, reg: 6, feats: 10 },
];
const unlockAt = (x) => (x.reg >= 6 ? "AN ARRIVAL" : REGIONS[x.reg].name);

// ---- feats: named goals in the console's dry voice -------------------------------
// prog(app) is the current progress toward n. Hidden feats show only a hint until done.
const life = (a, key) => (a.sv.st[key] || 0) + (a.folded ? 0 : a.R[key] || 0); // the run counts once
const FEATS = [
  { id: "chain5", name: "SURE HANDS", text: "Chain of 5 clean releases.", n: 5, prog: (a) => a.bestChain },
  { id: "chain12", name: "ONE BREATH", text: "Chain of 12 clean releases.", n: 12, prog: (a) => a.bestChain },
  { id: "ceil", name: "LOW CEILING", text: "Catch 30 anchors without rising into the upper margin.", n: 30, prog: (a) => a.R.ceilMax },
  { id: "fast1", name: "SHORT CUT", text: "Cross the cluster on 16 catches or fewer.", n: 1, prog: (a) => a.R.fast1 },
  { id: "fast2", name: "FOUR-BODY PROBLEM", text: "Cross the binaries on 12 catches or fewer.", n: 1, prog: (a) => a.R.fast2 },
  { id: "relic1", name: "FIRST FIND", text: "Collect a relic.", n: 1, prog: (a) => life(a, "relics") },
  { id: "relic3", name: "MAGPIE", text: "Collect 3 relics in one run.", n: 3, prog: (a) => a.R.relics },
  { id: "relic25", name: "ARCHIVIST", text: "Collect 25 relics in all.", n: 25, prog: (a) => life(a, "relics") },
  { id: "near3", name: "WITNESS", text: "Make 3 near passes of dark bodies in one run.", n: 3, prog: (a) => a.R.near },
  { id: "long", name: "ADRIFT", text: "Catch a sun after 2.4 s of free flight.", n: 2.4, prog: (a) => a.R.longFlight },
  { id: "sling", name: "SLUNG", text: "Let go of a sling sun.", n: 1, prog: (a) => a.R.slings },
  { id: "phase3", name: "IN STEP", text: "Catch 3 pulsing suns in one run.", n: 3, prog: (a) => a.R.pulses },
  { id: "stall", name: "HANG TIME", text: "Stall a swing above its sun.", n: 1, prog: (a) => a.R.stalls },
  { id: "loop", name: "LOOP THE LOOP", text: "Swing a full loop round a sun.", n: 1, prog: (a) => a.R.loops },
  { id: "arrive", name: "PERIHELION", text: "Reach the perihelion.", n: 1, prog: (a) => a.R.arrived },
  { id: "daily", name: "ON THE DAY", text: "Meet a daily goal.", n: 1, prog: (a) => life(a, "daily") },
  { id: "plumb", name: "PLUMB LINE", text: "", hint: "The swing sings at one point. Let go there.", n: 5, hidden: true, prog: (a) => a.R.bottom },
  { id: "thread", name: "THE EYE", text: "", hint: "Some dark bodies stand close together.", n: 1, hidden: true, prog: (a) => a.R.thread },
];
const FEAT_IDS = FEATS.map((f) => f.id);

// ---- helpers ----------------------------------------------------------------------
const smooth = (x) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
const regIndex = (x) => { for (let i = REGIONS.length - 1; i > 0; i--) if (x >= REGIONS[i].from) return i; return 0; };
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
// "#rrggbb" at alpha a, for glows.
const rgba = (hex, a) => "rgba(" + parseInt(hex.slice(1, 3), 16) + "," + parseInt(hex.slice(3, 5), 16) + "," + parseInt(hex.slice(5, 7), 16) + "," + a + ")";
// A soft round glow: one gradient-filled disc.
function glow(g, x, y, r, hex, a) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, rgba(hex, a));
  gr.addColorStop(1, rgba(hex, 0));
  g.fillStyle = gr;
  g.fillRect(x - r, y - r, 2 * r, 2 * r);
}
const mmss = (s) => Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
// A sun's place and velocity at clock `clk` (seconds into the run). Most suns do not move.
function place(a, clk, o) {
  const m = a.orb;
  if (!m) { o.x = a.x; o.y = a.y; o.vx = 0; o.vy = 0; return o; }
  const ang = m.ph + m.w * clk;
  o.x = a.x + m.R * Math.cos(ang); o.y = a.y + m.R * Math.sin(ang);
  o.vx = -m.R * m.w * Math.sin(ang); o.vy = m.R * m.w * Math.cos(ang);
  return o;
}
const PA = { x: 0, y: 0, vx: 0, vy: 0 }, PE = { x: 0, y: 0, vx: 0, vy: 0 }, PP = { x: 0, y: 0, vx: 0, vy: 0 }, PL = { x: 0, y: 0, vx: 0, vy: 0 };
const PD = { x: 0, y: 0, vx: 0, vy: 0 }; // drawing and lamps
// Is a pulsing sun lit at clk? Lit for the first `duty` of each period.
const lit = (a, clk) => {
  const u = (clk / a.pu.per + a.pu.ph) % 1;
  return u < a.pu.duty;
};
const dailyRng = new Random(1);
const hashText = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const dateKey = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
// Today's goal, the same for everyone on the same date.
export function dailyGoal(key) {
  const h = hashText("goal" + key), kind = h % 4, v = (h >>> 8) % 5;
  if (kind === 0) return { kind: "relics", n: 2 + (v % 3), text: "Collect " + (2 + (v % 3)) + " relics." };
  if (kind === 1) return { kind: "region", n: 2 + (v % 4), text: "Reach " + REGIONS[2 + (v % 4)].name + "." };
  if (kind === 2) return { kind: "chain", n: 6 + v, text: "Reach a chain of " + (6 + v) + "." };
  return { kind: "catches", n: 30 + 5 * v, text: "Catch " + (30 + 5 * v) + " anchors." };
}
// Bring any stored shape (nothing, schema 1 from the first release, schema 2) to schema 2.
export function migrateSave(raw) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const arr = (v, n, d = 0) => Array.from({ length: n }, (_, i) => num(Array.isArray(v) ? v[i] : undefined, d));
  const st = r.st && typeof r.st === "object" ? r.st : {};
  const sel = r.sel && typeof r.sel === "object" ? r.sel : {};
  const dl = r.dl && typeof r.dl === "object" ? r.dl : {};
  return {
    schema: 2,
    runs: Math.max(0, Math.floor(num(r.runs))),
    last: r.last && typeof r.last === "object" ? r.last : {},
    milestone: Math.max(0, Math.floor(num(r.milestone))),
    far: clamp(Math.floor(num(r.far)), 0, REGIONS.length - 1),
    rb: arr(r.rb, REGIONS.length),
    pb: arr(r.pb, PROBES.length),
    pp: arr(r.pp, PACES.length),
    ft: Array.isArray(r.ft) ? r.ft.filter((id, i) => FEAT_IDS.includes(id) && r.ft.indexOf(id) === i) : [],
    // Feats held when unlocks moved to regions (a save from before keeps what its feats had opened).
    fl: Number.isFinite(r.fl) ? Math.max(0, Math.floor(r.fl)) : Array.isArray(r.ft) ? r.ft.filter((id, i) => FEAT_IDS.includes(id) && r.ft.indexOf(id) === i).length : 0,
    st: { relics: Math.max(0, num(st.relics)), near: Math.max(0, num(st.near)), daily: Math.max(0, num(st.daily)), arrivals: Math.max(0, num(st.arrivals)) },
    sel: { probe: clamp(Math.floor(num(sel.probe)), 0, PROBES.length - 1), start: clamp(Math.floor(num(sel.start)), 0, REGIONS.length - 1), trail: clamp(Math.floor(num(sel.trail)), 0, TRAILS.length - 1), pace: clamp(Math.floor(num(sel.pace)), 0, PACES.length - 1) },
    dl: { d: typeof dl.d === "string" ? dl.d.slice(0, 10) : "", best: Math.max(0, num(dl.best)), done: dl.done ? 1 : 0 }, // the streak is the console logbook's
    shards: Math.max(0, Math.floor(num(r.shards))),
    up: Object.fromEntries(UPGRADES.map((u) => [u.id, clamp(Math.floor(num(r.up && typeof r.up === "object" ? r.up[u.id] : 0)), 0, u.cost.length)])),
    seen: r.seen && typeof r.seen === "object" ? Object.fromEntries(Object.keys(INTRO).filter((k) => r.seen[k]).map((k) => [k, 1])) : {},
  };
}

export class Perihelion {
  constructor(ctx) {
    this.c = ctx;
    this.guard = new AppGuard(this, ctx); // takes back a menu gesture that reached the game (docs/ENGINE.md)
    this.t = 0;
    this.held = false;
    this.launches = 0; // runs started in this session; the first waits for a deliberate press
    this.ready = false;
    this.parts = new Float32Array(MAX_PARTS * 5); // x, y, vx, vy, life
    this.trail = new Float32Array(TRAIL * 2);
    this.sv = migrateSave(ctx.progress?.());
    this.armed = false; // a press on a menu screen that is waiting for its release
    this.pt = 0;
    this.view = "menu";
    this.cur = 1;
    this.page = 0;
    this.daily = false;
    this.dstate = 0;
    this.probeIx = 0;
    this.startReg = 0;
    this.sq = []; // a short queue of notes: [time, hz, seconds, wave]
    this.reset();
    this.phase = "title";
    this.setHint("Hold to tether to the marked sun. Release to fly on.");
    this.c.hud([["BEST", this.c.best()]]);
    this.order();
  }
  // Today's order for the console logbook, when Perihelion is one of today's three: the daily run's goal.
  order() { this.c.daily?.("Daily run: " + dailyGoal(this.dayKey()).text); }

  // ---- run state ---------------------------------------------------------
  reset() {
    this.phase = "play";
    this.runT = 0;
    this.anchors = [];
    this.voids = [];
    this.relics = [];
    this.nextId = 0;
    this.decayRun = 0;
    this.probeIx = this.sv.sel.probe;
    if (!this.unlockedProbe(this.probeIx)) this.probeIx = 0;
    this.startReg = this.daily ? 0 : Math.min(this.sv.sel.start, this.sv.far);
    this.pace = this.daily ? 0 : this.sv.sel.pace;
    const up = (id) => (this.daily ? 0 : this.sv.up[id] || 0);
    this.lives = 1 + up("lives");
    this.lost = 0; // probes lost this run (each one after the first used a spare)
    this.lostT = 0;
    this.reach = REACH + 20 * up("reach");
    this.pick = RELIC_PICK + 14 * up("magnet");
    this.darkK = 1 - 0.1 * up("dark");
    this.fuseT = FUSE + 0.6 * up("fuse");
    this.goal = null;
    if (!this.daily) { // its own generator, so the world is untouched
      goalRng.state = mixSeed(this.sv.runs * 7919 + 17) || 1;
      const i = Math.floor(goalRng.next() * GOALS.length), tier = Math.min(2, Math.floor(this.sv.far / 2));
      let n = GOALS[i].n[tier];
      if (i === 5) n = Math.min(5, Math.max(n, this.startReg + 1));
      this.goal = { i, n, reward: 3 + 2 * tier, done: false };
    }
    const x0 = REGIONS[this.startReg].from;
    this.p = { x: x0 + 140, y: 220, vx: 280, vy: -70, a: null, r: 0, phi: 0, om: 0, t: 0, v0x: 0, v0y: 0, fuse: 0, lastId: -1, back: x0, clk: 0, g: G * PROBES[this.probeIx].g, reach: this.reach };
    this.dstate = this.daily ? (mixSeed(hashText("day" + this.dayKey())) || 1) : 0;
    this.addAnchor(x0 + 330, 180, "steady");
    this.extend(x0 + 1600);
    this.cam = this.p.x - CAM_LEAD;
    this.paceX = this.cam;
    this.front = this.p.x - 400;
    this.maxX = this.p.x;
    this.scoreRaw = 0;
    this.chain = 0;
    this.bestChain = 0;
    this.catches = 0;
    this.flightT = 0;
    this.buffer = 0;
    this.catchFlash = 0;
    this.recFlash = 0;
    this.recText = 0;
    this.relicFlash = 0;
    this.regFlash = 0;
    this.bannerT = 0;
    this.recorded = false;
    this.newRecord = false;
    this.best0 = this.bestRef();
    this.deadT = 0;
    this.reason = "";
    this.notice = "";
    this.noticeT = 0;
    this.noticeQ = [];
    this.folded = false;
    this.stage = 0;
    while (this.stage < NOTES.length && NOTES[this.stage][0] < this.p.x) this.stage++;
    this.quickened = false;
    this.lastHint = "";
    this.head = Math.atan2(this.p.vy, this.p.vx); // the drawn heading eases toward the velocity
    this.trail.fill(0);
    this.trailN = 0;
    this.trailTick = 0;
    this.parts.fill(0);
    this.partNext = 0;
    this.tether = null; // per-tether bookkeeping, mirrored from p.a
    this.pending = null; // a thrown tether that has not landed yet
    this.pendT = 0;
    this.sq = [];
    this.bottomT = 0;
    this.nearT = -9; // run time of the last near pass
    this.newFeats = [];
    this.result = null;
    this.reg = regIndex(this.p.x);
    this.regT = 0;
    this.regC = 0;
    this.R = { relics: 0, near: 0, slings: 0, pulses: 0, bottom: 0, thread: 0, longFlight: 0, ceil: 0, ceilMax: 0, fast1: 0, fast2: 0, arrived: 0, daily: 0, far: 0, tricks: 0, trickPts: 0, stalls: 0, loops: 0 };
    this.topId = -1; // the furthest sun released cleanly: only suns beyond it add to the chain
    this.trickText = "";
    this.trickT = 0;
    this.cross = [];
    this.goalDone = false;
  }
  dayKey() { return dateKey(); }
  // The record this run is chasing: the console's best distance for a plain run, the saved
  // personal best of the chosen probe or of the day otherwise.
  bestRef() {
    if (this.daily) return this.sv.dl.d === this.dayKey() ? this.sv.dl.best : 0;
    if (this.pace > 0) return this.sv.pp[this.pace] || 0;
    if (this.probeIx === 0 && this.startReg === 0) return this.c.best();
    return this.sv.pb[this.probeIx] || 0;
  }
  plainRun() { return !this.daily && !this.pace && this.probeIx === 0 && this.startReg === 0; }
  setHint(message) {
    if (message === this.lastHint) return;
    this.lastHint = message;
    this.c.hint(message);
  }

  // ---- world -------------------------------------------------------------
  addAnchor(x, y, kind) {
    const a = { id: this.nextId++, x, y, kind, dead: false };
    this.anchors.push(a);
    this.last = a;
    return a;
  }
  // Generate suns ahead of x = limit. In the first region the gaps widen with distance and each gap
  // is capped so the next sun is always within tether reach of a probe that arrives sensibly. Later
  // regions have their own rules (extendRegion). A daily run draws from a generator seeded by the date.
  extend(limit) {
    const rng = this.daily ? ((dailyRng.state = this.dstate), dailyRng) : this.c.rng;
    let guard = 0;
    while (this.last.x < limit && this.last.x < ARRIVAL + 600 && guard++ < 64) {
      const pr = this.last, ri = regIndex(pr.x);
      if (ri > 0) { this.extendRegion(rng, ri, pr); continue; }
      const d = clamp(pr.x / 10000, 0, 1), easy = this.nextId < 4;
      let gap = easy ? rng.range(140, 165) : rng.range(130 + 40 * d, 185 + 55 * d);
      const span = easy ? 35 : 70 + 40 * d;
      let y = clamp(pr.y + rng.range(-span, span), 110, 280);
      const dy = y - pr.y;
      if (Math.hypot(gap, dy) > 222) gap = Math.sqrt(Math.max(0, 222 * 222 - dy * dy));
      const decay = pr.x > 4800 && this.decayRun < 2 && rng.next() < 0.3;
      this.decayRun = decay ? this.decayRun + 1 : 0;
      const a = this.addAnchor(pr.x + gap, y, decay ? "decay" : "steady");
      if (pr.x > 2600 && rng.next() < 0.3 + 0.3 * d) {
        const count = pr.x > 7500 && rng.next() < 0.4 ? 2 : 1;
        for (let k = 0; k < count; k++) {
          const f = count === 1 ? 0.5 : 0.32 + 0.36 * k;
          const side = count === 2 ? (k ? 1 : -1) : rng.next() < 0.5 ? -1 : 1;
          this.addVoid(rng, pr, a, f, side, 70, 115, 16, 24, 70);
        }
      }
    }
    if (this.daily) this.dstate = dailyRng.state;
  }
  // A dark body beside the line from sun `pr` to sun `a`, `lo`..`hi` px off it.
  addVoid(rng, pr, a, f, side, lo, hi, rlo, rhi, clear) {
    const r = rng.range(rlo, rhi);
    const vx = lerp(pr.x, a.x, f) + rng.range(-15, 15);
    const vy = clamp(lerp(pr.y, a.y, f) + side * rng.range(lo, hi), 50, 470);
    const orb = (s) => (s.orb ? s.orb.R : 0); // a binary's suns circle its centre: clear the whole orbit
    const ok = Math.hypot(vx - pr.x, vy - pr.y) > r + clear + orb(pr) && Math.hypot(vx - a.x, vy - a.y) > r + clear + orb(a);
    if (ok && this.voids.length < MAX_VOIDS) this.voids.push({ x: vx, y: vy, r, m: 999, s: 0 });
  }
  // Regions II to VI. Each adds a rule to the same skeleton: a chain of suns, each within reach of the last.
  extendRegion(rng, ri, pr) {
    const prog = clamp((pr.x - REGIONS[ri].from) / 4500, 0, 1);
    let gap, span = 70 + 30 * prog, maxD = 222;
    if (ri === 1) { gap = rng.range(108, 150); span = 85; } // close, but no more than two suns in reach as a rule
    else if (ri === 2) { gap = rng.range(150, 205); maxD = 200; }
    else if (ri === 3) gap = rng.range(150, 200);
    else if (ri === 4) gap = rng.range(150, 210);
    else gap = rng.range(150, 200);
    let y = clamp(pr.y + rng.range(-span, span), 110, 280);
    const dy = y - pr.y;
    if (Math.hypot(gap, dy) > maxD) gap = Math.sqrt(Math.max(0, maxD * maxD - dy * dy));
    const roll = rng.next();
    let kind = "steady";
    if (pr.kind !== "sling" && roll < (ri === 3 ? 0.1 : ri === 4 ? 0.08 : 0.07)) kind = "sling";
    else if (this.decayRun < 1 && roll > (ri === 1 ? 0.88 : ri === 3 ? 0.84 : ri === 4 ? 0.93 : 2)) kind = "decay";
    else if (ri === 5 && pr.kind !== "pulse" && roll > 0.4 && roll < 0.9) kind = "pulse";
    this.decayRun = kind === "decay" ? this.decayRun + 1 : 0;
    const x = pr.x + gap;
    let a;
    if (ri === 2 && roll > 0.3 && kind === "steady") {
      // A binary: two suns on a circle about (x, y), half a turn apart.
      const R = rng.range(40, 55), w = (rng.next() < 0.5 ? -1 : 1) * TAU / rng.range(5, 7.5), ph = rng.range(0, TAU);
      a = this.addAnchor(x, y, "pair");
      a.orb = { R, w, ph };
      const b = this.addAnchor(x, y, "pair");
      b.orb = { R, w, ph: ph + Math.PI };
      this.last = a;
    } else {
      a = this.addAnchor(x, y, kind);
      if (kind === "pulse") a.pu = { per: rng.range(2.2, 3.2), ph: rng.next(), duty: 0.58 };
    }
    if (ri === 1 && rng.next() < 0.18) {
      const side = rng.next() < 0.5 ? -1 : 1, ty = clamp(a.y + side * rng.range(55, 85), 100, 320);
      const tx = a.x + rng.range(35, 60);
      if (Math.hypot(tx - a.x, ty - a.y) > 56) { this.addAnchor(tx, ty, "steady"); this.last = a; }
    }
    // Dark bodies: rare in the clusters and binaries, the point of the dark field.
    const vc = [0, 0.2, 0.25, 0.3, 1, 0.25][ri];
    if (rng.next() < vc) {
      const count = ri === 4 && rng.next() < 0.45 ? 2 : 1;
      for (let k = 0; k < count; k++) {
        const side = count === 2 ? (k ? 1 : -1) : rng.next() < 0.5 ? -1 : 1;
        const f = count === 1 ? 0.5 : 0.32 + 0.36 * k;
        if (ri === 4) this.addVoid(rng, pr, a, f, side, 60, 105, 16, 26, 62);
        else this.addVoid(rng, pr, a, f, side, 70, 115, 16, 24, 70);
      }
    }
    // A relic off the safe line.
    if (rng.next() < [0, 0.14, 0.16, 0.16, 0.22, 0.16][ri] && this.relics.length < MAX_RELICS) {
      const side = rng.next() < 0.6 ? -1 : 1;
      const rx = lerp(pr.x, a.x, 0.5) + rng.range(-20, 20);
      const ry = clamp(lerp(pr.y, a.y, 0.5) + side * rng.range(80, 130), 45, 495);
      this.relics.push({ x: rx, y: ry, got: 0 });
    }
  }
  prune() {
    const left = this.cam - 160;
    while (this.anchors.length > 3 && this.anchors[0].x < left - 60) this.anchors.shift();
    while (this.voids.length && this.voids[0].x < left - 60) this.voids.shift();
    while (this.relics.length && this.relics[0].x < left - 60) this.relics.shift();
  }
  // The current of the nebula: extra acceleration (fx, fy) on a probe in free flight at x.
  current(x, o) {
    const env = smooth((x - NEB0) / 300) * smooth((NEB1 - x) / 300);
    o.x = 45 * Math.sin(x / 700 + 1) * env;
    o.y = 85 * Math.sin(x / 430) * env;
    return o;
  }

  // ---- physics (pure with respect to the game, so a bot can clone a probe) ---
  stepProbe(p, dt) {
    const clk = p.clk || 0, g = p.g || G;
    if (p.a) {
      const sub = 4, h = dt / sub, k = g / p.r;
      for (let i = 0; i < sub; i++) {
        p.om -= 0.5 * k * Math.sin(p.phi) * h;
        p.phi += p.om * h;
        p.om -= 0.5 * k * Math.sin(p.phi) * h;
      }
      p.phi = wrapAngle(p.phi);
      const A = place(p.a, clk + dt, PA);
      p.x = A.x + p.r * Math.sin(p.phi);
      p.y = A.y + p.r * Math.cos(p.phi);
      p.vx = p.r * p.om * Math.cos(p.phi) + A.vx;
      p.vy = -p.r * p.om * Math.sin(p.phi) + A.vy;
      p.t += dt;
    } else if (p.x > NEB0 && p.x < NEB1) {
      const f = this.current(p.x, PD);
      p.x += p.vx * dt + 0.5 * f.x * dt * dt;
      p.y += p.vy * dt + 0.5 * (g + f.y) * dt * dt;
      p.vx += f.x * dt;
      p.vy += (g + f.y) * dt;
    } else {
      p.x += p.vx * dt;
      p.y += p.vy * dt + 0.5 * g * dt * dt;
      p.vy += g * dt;
    }
    p.clk = clk + dt;
  }
  // The sun a press would catch right now (or null). Moving forward: the nearest sun ahead
  // (not behind the last one used) within reach. Moving backward: the nearest sun behind, but
  // never one further back than p.back. Either way a sun above or level wins; the tether is a
  // solid rod, so the nearest sun below is offered only when none is. A pulsing sun must be lit
  // now and until the tether lands. When nothing lies the way the probe is heading, the other way.
  pickTarget(p) {
    const clk = p.clk || 0, fwd = p.vx >= 0;
    return this.pickWay(p, clk, fwd) || this.pickWay(p, clk, !fwd);
  }
  pickWay(p, clk, ahead) {
    let best = null, bestD = Infinity, under = null, underD = Infinity;
    for (const a of this.anchors) {
      if (a.dead) continue;
      const A = place(a, clk, PP);
      const dx = A.x - p.x, dy = A.y - p.y;
      if (ahead ? dx < -40 || a.id <= p.lastId : dx >= -40 || A.x < (p.back ?? -Infinity)) continue;
      const d = Math.hypot(dx, dy);
      if (d < MIN_CATCH || d > (p.reach || REACH)) continue;
      if (a.pu && !(lit(a, clk) && lit(a, clk + CATCH_LAG + 0.05))) continue;
      if (dy > 30) { if (d < underD) { under = a; underD = d; } }
      else if (d < bestD) { best = a; bestD = d; }
    }
    return best || under;
  }
  // Tether at the current distance. Speed (relative to the sun) is kept; its direction becomes tangent.
  engage(p, a) {
    const A = place(a, p.clk || 0, PE);
    const dx = p.x - A.x, dy = p.y - A.y;
    const r = Math.max(1, Math.hypot(dx, dy));
    const phi = Math.atan2(dx, dy);
    const rvx = p.vx - A.vx, rvy = p.vy - A.vy;
    const speed = Math.hypot(rvx, rvy);
    const along = rvx * Math.cos(phi) - rvy * Math.sin(phi);
    p.a = a; p.r = r; p.phi = phi; p.t = 0;
    p.om = (along >= 0 ? 1 : -1) * speed / r;
    p.v0x = p.vx; p.v0y = p.vy;
    p.fuse = a.kind === "decay" ? this.fuseT || FUSE : Infinity;
    p.vx = p.r * p.om * Math.cos(phi) + A.vx;
    p.vy = -p.r * p.om * Math.sin(phi) + A.vy;
  }
  // Leave the tether. A swing of CLEAN seconds or more leaves exactly on the tangent.
  // A shorter tether blends back towards the velocity the probe had when it was
  // thrown, so stray taps barely bend the course. A sling sun adds speed to a clean
  // release. Returns { a, clean }.
  detach(p) {
    const a = p.a, d = p.t, clean = d >= CLEAN, g = p.g || G;
    const tvx = p.vx, tvy = p.vy, speed = Math.hypot(tvx, tvy);
    if (d < TAP_FULL) {
      const w = smooth((d - TAP_FREE) / (TAP_FULL - TAP_FREE));
      let bx = lerp(p.v0x, tvx, w), by = lerp(p.v0y + g * d, tvy, w);
      const m = Math.hypot(bx, by);
      if (m > 1e-6) { bx *= speed / m; by *= speed / m; p.vx = bx; p.vy = by; }
    }
    if (clean && a.kind === "sling" && speed > 1e-6) {
      const s1 = Math.min(speed * SLING_GAIN, Math.max(speed, SLING_CAP));
      p.vx *= s1 / speed; p.vy *= s1 / speed;
    }
    p.a = null;
    if (clean) p.lastId = a.id;
    return { a, clean };
  }
  // Why the run would end at p, or "".
  fate(p) {
    if (p.y > BAND_BOT) return "fall";
    if (p.y < BAND_TOP) return "top";
    for (const v of this.voids) {
      const dx = p.x - v.x;
      if (dx > 80 || dx < -80) continue;
      if (Math.hypot(dx, p.y - v.y) < v.r + PROBE_R) return "void";
    }
    return "";
  }

  // ---- input -------------------------------------------------------------
  // On the title, result and hangar screens a press is decided when it ends: a tap chooses the
  // main action, a press of HOLD_PICK seconds or more opens or operates the hangar. Play is
  // unchanged: the press edge is the throw.
  down() {
    this.guard.mark();
    if (this.phase === "title" || this.phase === "hangar" || (this.phase === "over" && this.deadT > 0.7)) {
      this.armed = true;
      this.pt = this.t;
      return;
    }
    if (this.phase !== "play") return;
    if (this.ready) {
      // The first run of a session starts parked: the first press of the run launches
      // it and throws the tether, so a newcomer has time to read the screen.
      this.ready = false;
      this.setHint("Hold to catch the marked sun. Release to fly on.");
    }
    this.held = true;
    this.buffer = 0.18;
    this.tryCatch();
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
    this.pending = null;
    if (this.phase === "play" && this.p.a) this.releaseTether();
  }
  cancel() {
    this.guard.rewind();
    this.armed = false;
    this.up();
    this.c.leds(lightsOff(this.c.lampCount?.() >= 4 ? 4 : 3));
  }
  pause() {
    this.guard.settle();
    this.c.leds(lightsOff(this.c.lampCount?.() >= 4 ? 4 : 3));
  }
  resume() {
    this.held = false;
  }
  dispose() {
    this.guard.settle();
    this.held = false;
    this.c.leds(lightsOff(this.c.lampCount?.() >= 4 ? 4 : 3));
  }
  start() {
    this.held = false;
    this.reset();
    this.ready = this.launches++ === 0;
    this.setHint(this.ready ? "Hold to throw a tether to the marked sun. Release to fly on." : "Hold to catch the marked sun. Release to fly on.");
    this.noticeT = 0;
    this.announceRegion(this.reg, true);
    if (this.goal) this.say("GOAL: " + this.goalText() + " +" + this.goal.reward + " SHARDS", 5);
    this.c.hud(this.hudItems(0));
  }
  goalText() { return GOALS[this.goal.i].text(this.goal.n); }
  goalProg() { return Math.min(this.goal.n, Math.floor(GOALS[this.goal.i].prog(this) || 0)); }
  checkGoal() {
    const gl = this.goal;
    if (!gl || gl.done || this.phase !== "play" || GOALS[gl.i].prog(this) < gl.n) return;
    gl.done = true;
    this.say("GOAL MET: +" + gl.reward + " SHARDS", 4);
    this.flare(LAMP.cyan);
    [784, 988, 1175].forEach((hz, k) => this.queueNote(0.05 + 0.09 * k, hz, 0.14, "sine"));
  }
  startDaily() {
    this.daily = true;
    this.order();
    this.start();
  }
  // A finished press on the title, result or hangar screen.
  menuPress(dur) {
    const long = dur >= HOLD_PICK;
    if (this.phase === "title" || this.phase === "over") {
      if (long) this.openHangar();
      else { this.daily = false; this.start(); }
      return;
    }
    if (this.view === "shop") { // tap: next line; hold: buy, or BACK on the last line
      if (!long) this.page = (this.page + 1) % (UPGRADES.length + 1);
      else if (this.page === UPGRADES.length) { this.view = "menu"; this.page = 0; }
      else this.buy(UPGRADES[this.page]);
      return;
    }
    if (this.view !== "menu") {
      if (long) { this.view = "menu"; this.page = 0; }
      else if (this.view === "guide") this.page = (this.page + 1) % GUIDE.length;
      else { this.view = "menu"; this.page = 0; }
      return;
    }
    if (!long) { this.cur = (this.cur + 1) % this.rows().length; return; }
    this.hangarChoose();
  }
  openHangar() {
    this.phase = "hangar";
    this.view = "menu";
    this.cur = 0; // on LAUNCH: a hold goes straight back out
    this.page = 0;
    this.setHint("Tap: next line. Hold: choose.");
  }
  rows() {
    const sv = this.sv;
    return HANGAR.filter((id) =>
      id === "UPGRADES" ? sv.shards > 0 || UPGRADES.some((u) => sv.up[u.id]) :
      id === "START" ? sv.far > 0 :
      id === "PROBE" ? this.unlockedProbe(1) :
      id === "TRAIL" ? this.unlockedTrail(1) : true);
  }
  buy(u) {
    const lv = this.sv.up[u.id] || 0, cost = u.cost[lv];
    if (cost === undefined || this.sv.shards < cost) { this.c.tone(150, 0.08, "square"); return false; }
    this.sv.shards -= cost;
    this.sv.up[u.id] = lv + 1;
    this.queueNote(0, 659, 0.08, "sine");
    this.queueNote(0.08, 988, 0.16, "sine");
    this.persist();
    return true;
  }
  unlocked(x) {
    const sv = this.sv;
    return (x.reg >= 6 ? sv.st.arrivals > 0 : sv.far >= x.reg) || (sv.fl || 0) >= x.feats;
  }
  unlockedProbe(i) { return i === 0 || this.unlocked(PROBES[i]); }
  unlockedTrail(i) { return i === 0 || this.unlocked(TRAILS[i]); }
  hangarChoose() {
    const row = this.rows()[this.cur], s = this.sv.sel;
    if (row === "LAUNCH") { this.daily = false; this.start(); return; }
    if (row === "DAILY") { this.startDaily(); return; }
    if (row === "LOG") { this.view = "log"; return; }
    if (row === "GUIDE") { this.view = "guide"; this.page = 0; return; }
    if (row === "UPGRADES") { this.view = "shop"; this.page = 0; return; }
    if (row === "PROBE") { let i = s.probe; do i = (i + 1) % PROBES.length; while (!this.unlockedProbe(i)); s.probe = i; }
    else if (row === "PACE") s.pace = (s.pace + 1) % PACES.length;
    else if (row === "START") s.start = (Math.min(s.start, this.sv.far) + 1) % (this.sv.far + 1);
    else if (row === "TRAIL") { let i = s.trail; do i = (i + 1) % TRAILS.length; while (!this.unlockedTrail(i)); s.trail = i; }
    this.c.tone(520, 0.05, "sine");
    this.persist();
  }
  // A trick pays its points (times `mult`, e.g. how high a stall hangs) and says so above the probe.
  trick(id, mult = 1) {
    const [name, pts] = TRICKS[id], got = Math.round(pts * mult);
    this.scoreRaw += got;
    this.R.tricks++;
    this.R.trickPts += got;
    this.trickText = name + "  +" + got;
    this.trickT = 1.3;
    this.trickFlash = 0.3;
    const f = 523 * (1 + 0.25 * Math.min(this.R.tricks % 5, 4));
    this.queueNote(0, f, 0.08, "triangle");
    this.queueNote(0.07, f * 1.5, 0.12, "triangle");
    this.checkFeats();
  }
  tryCatch() {
    const p = this.p;
    if (p.a || !this.held) return false;
    const a = this.pickTarget(p);
    if (!a) return false;
    this.pending = a;
    this.pendT = 0;
    this.buffer = 0;
    return true;
  }
  // The throw lands: tether at the probe's current distance.
  land() {
    const p = this.p, a = this.pending;
    this.pending = null;
    if (!a || p.a || a.dead) return;
    const A = place(a, p.clk || 0, PL);
    if (Math.hypot(A.x - p.x, A.y - p.y) < 8) return;
    if (a.pu && !lit(a, p.clk || 0)) { // went dark on the way: the throw is wasted, a held press tries again
      this.c.tone(150, 0.05, "square");
      if (this.held) this.buffer = 0.18;
      return;
    }
    this.engage(p, a);
    this.tether = { counted: false, flightAtCatch: this.flightT, pulse: a.kind === "pulse", spin: 0, loops: 0, stalls: 0 };
    this.catchFlash = 0.14;
    this.burst(A.x, A.y, 5, 90);
    this.ripple = 0.45;
    this.rippleAt = { x: A.x, y: A.y };
    this.bottomT = 0;
    this.c.tone(300 + 35 * Math.min(this.chain, 8), 0.06, "triangle");
  }
  // Throw a tether from a cloned probe the way the game does (a bot's planning step).
  settle(p, a) {
    for (let i = 0; i < Math.round(CATCH_LAG * 60) - 1; i++) this.stepProbe(p, 1 / 60);
    this.engage(p, a);
  }
  releaseTether() {
    const p = this.p, tt = this.tether;
    const speed = Math.hypot(p.vx, p.vy), phi = p.phi;
    const { a, clean } = this.detach(p);
    this.tether = null;
    if (!clean) return;
    if (tt && !tt.counted) this.countCatch(tt);
    if (a.id > this.topId) { // a sun already used keeps the chain but does not add to it
      this.chain++;
      this.topId = a.id;
    }
    this.bestChain = Math.max(this.bestChain, this.chain);
    this.flightT = 0;
    if (a.kind === "decay") a.dead = true;
    const f = this.noteHz(speed);
    this.c.tone(520 + 30 * Math.min(this.chain, 8), 0.05, "sine");
    // A clean release rings a soft fifth above the swing's own note.
    this.queueNote(0.05, f, 0.16, "sine");
    this.queueNote(0.05, f * 1.5, 0.22, "sine");
    if (a.kind === "sling") {
      this.R.slings++;
      this.flare(LAMP.cyan);
      this.queueNote(0.12, f * 2, 0.1, "triangle");
      this.queueNote(0.2, f * 3, 0.14, "triangle");
    }
    if (Math.abs(phi) < 0.14) this.R.bottom++;
    this.checkFeats();
  }
  // A stall: the swing stops and turns back above level. A loop: a full turn round the sun.
  swingTricks(tt, phiBefore, omBefore) {
    const p = this.p;
    tt.spin += wrapAngle(p.phi - phiBefore);
    if (Math.abs(tt.spin) >= TAU * (tt.loops + 1) && tt.loops < MAX_LOOPS) {
      tt.loops++;
      this.R.loops++;
      this.trick("loop");
    }
    if (omBefore * p.om < 0 && Math.abs(p.phi) > STALL_PHI && tt.stalls < 2) {
      tt.stalls++;
      this.R.stalls++;
      this.trick("stall", 1 + (Math.abs(p.phi) - STALL_PHI) / (Math.PI - STALL_PHI));
    }
  }
  countCatch(tt) {
    tt.counted = true;
    this.catches++;
    if (tt.flightAtCatch > CHAIN_GAP) this.chain = 0;
    this.R.longFlight = Math.max(this.R.longFlight, tt.flightAtCatch);
    if (tt.pulse) this.R.pulses++;
    if (this.p.y >= 60) this.R.ceil++;
    this.R.ceilMax = Math.max(this.R.ceilMax, this.R.ceil);
    this.checkFeats();
  }
  flare(col) { this.regFlash = 0.5; this.flareCol = col; }
  // The swing's note: the pentatonic scale from C4, climbing with speed.
  noteHz(speed) {
    const k = clamp(Math.floor((speed - 150) / 40), 0, PENT.length - 1);
    return 262 * Math.pow(2, PENT[k] / 12);
  }
  queueNote(delay, hz, dur, wave) {
    if (this.sq.length < 12) this.sq.push([this.t + delay, hz, dur, wave]);
  }

  // ---- simulation --------------------------------------------------------
  update(dt) {
    this.guard.tick(dt);
    this.t += dt;
    this.lostT = Math.max(0, (this.lostT || 0) - dt);
    if (this.phase === "play") { if (!this.ready) this.stepPlay(dt); }
    else if (this.phase === "over") {
      this.deadT += dt;
      this.stepParts(dt);
    }
    if (this.sq.length) this.playNotes();
    this.c.leds(this.lampValues());
    if (this.phase !== "play") this.c.hud([["BEST", this.bestRef()]]);
  }
  playNotes() {
    let n = 0;
    for (const note of this.sq) {
      if (note[0] <= this.t) this.c.tone(note[1], note[2], note[3]);
      else this.sq[n++] = note;
    }
    this.sq.length = n;
  }
  stepPlay(dt) {
    const p = this.p;
    this.runT += dt;
    this.catchFlash = Math.max(0, this.catchFlash - dt);
    this.recFlash = Math.max(0, this.recFlash - dt);
    this.recText = Math.max(0, this.recText - dt);
    this.noticeT = Math.max(0, this.noticeT - dt);
    if (this.noticeT === 0 && this.noticeQ.length) [this.notice, this.noticeT] = this.noticeQ.shift();
    this.relicFlash = Math.max(0, this.relicFlash - dt);
    this.regFlash = Math.max(0, this.regFlash - dt);
    this.bannerT = Math.max(0, this.bannerT - dt);
    this.trickT = Math.max(0, this.trickT - dt);
    this.ripple = Math.max(0, (this.ripple || 0) - dt);
    this.trickFlash = Math.max(0, (this.trickFlash || 0) - dt);
    if (this.pending) {
      this.pendT += dt;
      if (this.pendT >= CATCH_LAG - 1e-9) this.land();
    } else if (this.held && !p.a && this.buffer > 0) {
      this.buffer -= dt;
      this.tryCatch();
    }
    if (!p.a) this.flightT += dt;
    const phiBefore = p.phi, omBefore = p.om, wasTethered = !!p.a;
    p.back = Math.max(this.maxX - BACK, this.pace ? this.cam + 40 : -Infinity);
    this.stepProbe(p, dt);
    this.head += wrapAngle(Math.atan2(p.vy, p.vx) - this.head) * Math.min(1, dt * 12);
    if (p.a) {
      const tt = this.tether;
      if (tt && !tt.counted && p.t >= CLEAN) this.countCatch(tt);
      if (tt && wasTethered) this.swingTricks(tt, phiBefore, omBefore);
      // The swing sings: a note each time it passes the bottom, climbing with speed.
      if (wasTethered && phiBefore * p.phi < 0 && Math.abs(phiBefore) < 1.5 && this.runT - this.bottomT > 0.2) {
        this.bottomT = this.runT;
        this.c.tone(this.noteHz(Math.hypot(p.vx, p.vy)), 0.12, "sine");
      }
      if (p.a.kind === "decay" && p.t >= this.fuseT) {
        const a = p.a;
        this.releaseTether();
        a.dead = true;
        this.burst(a.x, a.y, 10, 140);
        this.c.tone(180, 0.1, "square");
        this.held = false;
      }
    } else if (this.chain > 0 && this.flightT > CHAIN_GAP) {
      this.chain = 0;
    }
    if (p.y < 60) this.R.ceil = 0;
    // The terminator: a wall of dark sweeping up from behind, so stalling costs.
    if (this.pace) this.front = this.cam - 8; // the screen's left edge is the dark
    else this.front += this.frontSpeed() * dt;
    let why = this.fate(p);
    if (!why && p.x < this.front + 8) why = this.pace ? "edge" : "dark";
    if (why) { if (this.lives > 1) this.loseLife(why); else this.crash(why); return; }
    if (p.x > this.maxX) {
      this.scoreRaw += (p.x - this.maxX) / PX_PER_MKM;
      this.maxX = p.x;
    }
    this.collect(p);
    this.regionEvents();
    if (this.maxX >= ARRIVAL) { this.arrive(); return; }
    const score = Math.floor(this.scoreRaw);
    if (!this.recorded && this.best0 > 0 && score > this.best0) {
      this.recorded = true;
      this.recFlash = 1.0;
      this.recText = 2.2;
      this.c.synth.chime();
    }
    this.stageEvents();
    this.cam += (p.x - CAM_LEAD - this.cam) * Math.min(1, dt * 4);
    if (this.pace) { // the screen never slows below the pace or goes back
      this.paceX = Math.max(this.paceX + PACES[this.pace].v * dt, this.cam);
      this.cam = this.paceX;
    }
    this.extend(p.x + 1500);
    this.prune();
    if (++this.trailTick % 3 === 0) this.pushTrail(p.x, p.y);
    this.stepParts(dt);
    this.c.hud(this.hudItems(score));
    if (this.noticeT > 0) this.setHint(this.notice);
    else if (p.a) this.setHint(p.a.kind === "decay" ? "This sun is burning out. Release." : "Release to fly on the tangent.");
    else this.setHint(this.pickTarget(p) ? "Hold to catch the marked sun." : "Coasting. No sun in reach.");
  }
  hudItems(score) {
    const chain = this.chain > 0 ? this.chain : "-";
    const reg = this.sv.far > 0 || this.reg > 0;
    if (!reg) return [["DISTANCE", score + " Mkm"], ["CHAIN", chain], ["CAUGHT", this.catches], ["BEST", Math.max(this.best0, score)]];
    return [["DISTANCE", score + " Mkm"], ["CHAIN", chain], ["RELICS", this.R.relics], ["REGION", REGIONS[this.reg].roman + " " + REGIONS[this.reg].name.slice(4)]];
  }
  // Relics and near passes.
  collect(p) {
    for (const r of this.relics) {
      if (r.got || Math.abs(r.x - p.x) > this.pick) continue;
      if (Math.hypot(r.x - p.x, r.y - p.y) < this.pick) {
        r.got = 1;
        this.R.relics++;
        this.relicFlash = 0.35;
        this.scoreRaw += 25;
        this.burst(r.x, r.y, 6, 110);
        this.queueNote(0, 880, 0.1, "sine");
        this.queueNote(0.09, 1175, 0.16, "sine");
        this.intro("relic");
        this.checkFeats();
      }
    }
    for (const v of this.voids) {
      const dx = p.x - v.x;
      if (dx < -90 || v.s) continue;
      if (dx < 90) v.m = Math.min(v.m, Math.hypot(dx, p.y - v.y) - v.r - PROBE_R);
      if (dx > 40) {
        v.s = 1;
        if (this.reg >= 1 && v.m >= 0 && v.m < NEAR_GAP) {
          this.R.near++;
          if (this.runT - this.nearT < 0.9) this.R.thread++;
          this.nearT = this.runT;
          this.scoreRaw += 8;
          this.queueNote(0, 988, 0.07, "triangle");
          this.intro("near");
          this.checkFeats();
        }
      }
    }
  }
  // A notice for the strip at the foot of the screen (and the hint line). One shows at a time:
  // a new one waits its turn, and cuts the one showing short. `now` replaces it at once.
  say(msg, t, now = false) {
    if (now || this.noticeT <= 0) { this.notice = msg; this.noticeT = t; return; }
    if (msg === this.notice || this.noticeQ.some((q) => q[0] === msg)) return;
    if (this.noticeQ.length < 4) this.noticeQ.push([msg, t]);
    this.noticeT = Math.min(this.noticeT, 1.6);
  }
  intro(id) {
    if (this.sv.seen[id]) return;
    this.sv.seen[id] = 1;
    this.say(INTRO[id], 4);
  }
  regionEvents() {
    const ri = regIndex(this.maxX);
    if (ri === this.reg) return;
    const old = this.reg;
    if (this.startReg === 0 || old > this.startReg) {
      const t = this.runT - this.regT, c = this.catches - this.regC;
      this.cross.push([old, Math.round(t * 10) / 10, c]);
      if (old === 1 && c <= 16) this.R.fast1 = 1;
      if (old === 2 && c <= 12) this.R.fast2 = 1;
      const best = this.sv.rb[old];
      if (!best || t < best) this.sv.rb[old] = Math.round(t * 10) / 10;
    }
    this.reg = ri;
    this.announceRegion(ri, false);
    this.checkFeats();
    this.persist();
  }
  announceRegion(ri, atStart) {
    const reg = REGIONS[ri];
    this.regT = this.runT;
    this.regC = this.catches;
    this.sv.far = Math.max(this.sv.far, ri);
    this.R.far = Math.max(this.R.far, ri);
    if (ri === 0 && atStart) return;
    this.bannerT = 2.8;
    this.regFlash = 1.2;
    this.flareCol = reg.col;
    this.say(reg.name + ". " + reg.text, 2.8, true); // the banner shows it on screen
    const m = MOTIFS[ri];
    m.forEach((hz, i) => this.queueNote(i * 0.14, hz, 0.22, "sine"));
    if (ri === 2) this.intro("pair");
    if (ri === 3) this.intro("current");
    if (ri === 5) this.intro("pulse");
  }
  // How fast the dark sweeps up, px/s. It rises to 110 over the first six minutes;
  // after five minutes it keeps quickening until nobody can outrun it, so a run ends.
  frontSpeed() {
    return (this.darkK ?? 1) * (Math.min(110, 36 + 0.2 * this.runT) + 0.5 * Math.max(0, this.runT - 300));
  }
  stageEvents() {
    if (this.runT > 300 && !this.quickened && !this.pace) {
      this.quickened = true;
      this.say("The dark is quickening.", 4);
      this.c.tone(660, 0.1, "sine");
    }
    const x = this.maxX;
    while (this.stage < NOTES.length && x > NOTES[this.stage][0]) {
      this.say(NOTES[this.stage][1], 4);
      this.stage++;
      this.c.tone(660, 0.1, "sine");
    }
  }
  // Mark feats whose progress has reached its goal.
  checkFeats() {
    this.checkGoal();
    for (const f of FEATS) {
      if (this.sv.ft.includes(f.id) || this.newFeats.includes(f.id)) continue;
      if (f.prog(this) >= f.n) {
        this.newFeats.push(f.id);
        this.sv.ft.push(f.id);
        if (!this.c.feat?.(f.id, f.name)) this.say("FEAT: " + f.name, 4); // the console shows its own
        this.queueNote(0, 659, 0.1, "sine");
        this.queueNote(0.1, 880, 0.2, "sine");
      }
    }
  }
  goalMet() {
    const g = dailyGoal(this.dayKey());
    if (g.kind === "relics") return this.R.relics >= g.n;
    if (g.kind === "region") return (this.R.far || 0) >= g.n;
    if (g.kind === "chain") return this.bestChain >= g.n;
    return this.catches >= g.n;
  }
  arrive() {
    this.R.arrived = 1;
    this.scoreRaw += 400;
    this.checkFeats();
    this.finish("arrived");
  }
  // A spare probe: the run goes on from the next sun ahead, parked until the next press.
  loseLife(why) {
    const p = this.p;
    this.lives--;
    this.lost++;
    this.lostT = 1.4;
    this.burst(p.x, p.y, 16, 160);
    this.c.tone(70, 0.4, "sawtooth");
    this.chain = 0;
    this.held = false;
    this.tether = null;
    this.pending = null;
    let a = null;
    for (const s of this.anchors) if (!s.dead && s.x >= this.maxX - 100 && (!a || s.x < a.x)) a = s;
    if (!a) { this.crash(why); return; }
    const y = clamp(a.y + 40, 120, 400);
    Object.assign(p, { x: a.x - 190, y, vx: 280, vy: -70, a: null, r: 0, phi: 0, om: 0, t: 0, lastId: a.id - 1 });
    this.voids = this.voids.filter((v) => v.x < p.x - 60 || v.x > a.x + 80); // a clear start
    this.front = Math.min(this.front, p.x - 400);
    this.cam = p.x - CAM_LEAD;
    this.paceX = this.cam;
    this.trail.fill(0);
    this.trailN = 0;
    this.flightT = 0;
    this.ready = true;
    this.say("PROBE LOST: " + (REASONS[why] || why) + ". " + this.lives + (this.lives === 1 ? " PROBE LEFT" : " PROBES LEFT"), 5, true);
    this.setHint(this.notice);
  }
  crash(why) {
    this.finish(why);
  }
  finish(why) {
    const p = this.p;
    const first = this.phase !== "over"; // a second call (tests) only restarts the result timer
    this.phase = "over";
    this.reason = why;
    this.deadT = 0;
    this.held = false;
    this.tether = null;
    this.pending = null;
    this.burst(p.x, p.y, why === "arrived" ? 20 : 16, 160);
    const score = Math.floor(this.scoreRaw);
    this.newRecord = score > 0 && score > this.best0;
    if (this.plainRun()) this.c.score(score);
    this.c.tone(why === "arrived" ? 523 : 70, why === "arrived" ? 0.5 : 0.4, why === "arrived" ? "sine" : "sawtooth");
    if (why === "arrived") [659, 784, 1047].forEach((hz, i) => this.queueNote(0.15 * (i + 1), hz, 0.4, "sine"));
    if (first) {
      this.goalDone = this.daily && this.goalMet();
      const sv = this.sv;
      sv.runs++;
      this.folded = true; // from here life() reads the lifetime totals, which now hold this run
      sv.st.relics += this.R.relics;
      sv.st.near += this.R.near;
      if (why === "arrived") sv.st.arrivals++;
      if (this.daily) {
        const key = this.dayKey();
        if (sv.dl.d !== key) { sv.dl.d = key; sv.dl.best = 0; sv.dl.done = 0; }
        sv.dl.best = Math.max(sv.dl.best, score);
        if (this.goalDone && !sv.dl.done) {
          sv.dl.done = 1;
          sv.st.daily++;
          this.R.daily = 1;
          this.c.dailyMet?.(); // today's order in the console logbook, if Perihelion is one of the three
        }
      } else if (this.pace) sv.pp[this.pace] = Math.max(sv.pp[this.pace] || 0, score);
      else sv.pb[this.probeIx] = Math.max(sv.pb[this.probeIx] || 0, score);
      this.checkFeats();
      this.result = { mkm: score, chain: this.bestChain, catches: this.catches, reason: REASONS[why] || why, milestone: Math.floor(score / 100), relics: this.R.relics, region: REGIONS[this.reg].name };
      const gain = Math.floor(Math.max(0, this.maxX - REGIONS[this.startReg].from - 140) / SHARD_PX) + this.R.relics + (why === "arrived" ? 5 : 0) + (this.goal?.done ? this.goal.reward : 0);
      sv.shards += gain;
      this.result.shards = gain;
      sv.milestone = Math.max(sv.milestone, this.result.milestone);
      sv.last = this.result;
      this.persist();
      this.result.next = this.nextGoal();
    }
    this.setHint("Tap to launch again. Hold for the hangar.");
    this.c.hud([["DISTANCE", score + " Mkm"], ["BEST CHAIN", this.bestChain], ["CAUGHT", this.catches], ["BEST", this.bestRef()]]);
  }
  dayBefore(key) {
    const [y, m, d] = key.split("-").map(Number);
    const t = new Date(y, m - 1, d - 1);
    return t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0");
  }
  persist() {
    this.c.saveProgress?.(JSON.parse(JSON.stringify(this.sv)))?.catch?.(this.c.error);
  }
  // The next unlock: a probe or a trail, by the region that opens it.
  nextGoal() {
    const locked = [...PROBES.map((x) => [x, " PROBE"]), ...TRAILS.map((x) => [x, " TRAIL"])].filter(([x]) => !this.unlocked(x)).sort((a, b) => a[0].reg - b[0].reg);
    return locked.length ? ["NEXT: " + locked[0][0].name + locked[0][1] + " AT " + unlockAt(locked[0][0])] : [];
  }
  burst(x, y, n, speed) {
    for (let i = 0; i < n; i++) {
      const k = this.partNext++ % MAX_PARTS, o = k * 5, a = (i / n) * TAU + this.t;
      this.parts[o] = x; this.parts[o + 1] = y;
      this.parts[o + 2] = Math.cos(a) * speed * (0.5 + (i % 3) * 0.25);
      this.parts[o + 3] = Math.sin(a) * speed * (0.5 + (i % 3) * 0.25);
      this.parts[o + 4] = 0.5;
    }
  }
  stepParts(dt) {
    for (let k = 0; k < MAX_PARTS; k++) {
      const o = k * 5;
      if (this.parts[o + 4] <= 0) continue;
      this.parts[o] += this.parts[o + 2] * dt;
      this.parts[o + 1] += this.parts[o + 3] * dt;
      this.parts[o + 4] -= dt;
    }
  }
  pushTrail(x, y) {
    const n = TRAIL;
    this.trail.copyWithin(0, 2);
    this.trail[(n - 1) * 2] = x;
    this.trail[(n - 1) * 2 + 1] = y;
    this.trailN = Math.min(n, this.trailN + 1);
  }

  // ---- lamps -------------------------------------------------------------
  // Left lamp: above you. Right lamp: below you. Middle: level with you. Used for relics and dark bodies.
  danger(y) {
    return clamp((Math.abs(y - 270) - 120) / 130, 0, 1);
  }
  idleColour() {
    return REGIONS[this.phase === "over" ? this.reg : this.sv.far].col;
  }
  // Three lamps (the first node) or four. The first three play as they always have; the fourth, on
  // the right, is the button's lamp: what a press or a release does now, and the dark behind you.
  lampValues() {
    const p = this.p, n = this.c.lampCount?.() >= 4 ? 4 : 3;
    if (this.phase === "play" && this.lostT > 0) return fill(LAMP.red, 0.32 * this.lostT / 1.4, n);
    if (this.phase === "title" || this.ready) {
      const v = spot(0.5 + 0.5 * Math.sin(this.t * 0.7), dim(REGIONS[this.sv.far].col, 0.1));
      return n < 4 ? v : [...v, ...(this.ready ? dim(LAMP.cyan, 0.08 + 0.3 * pulse(this.t, 0.8)) : [0, 0, 0])]; // parked: press to throw
    }
    if (this.phase === "hangar") return spot(0.5 + 0.5 * Math.sin(this.t * 1.1), dim(REGIONS[this.sv.far].col, 0.14), 0.75, n);
    if (this.phase === "over") {
      if (this.reason === "arrived") return fill(blend(LAMP.white, LAMP.cyan, 0.5 + 0.5 * Math.sin(this.t)), 0.12 + 0.2 * pulse(this.t, 0.4), n);
      if (this.deadT < 1.4) return fill(LAMP.red, 0.32 * (1 - this.deadT / 1.4), n);
      if (this.newRecord) return fill(LAMP.amber, 0.08 + 0.1 * pulse(this.t, 0.5), n);
      return spot(0.5 + 0.5 * Math.sin(this.t * 0.5), dim(this.idleColour(), 0.07), 0.75, n);
    }
    if (this.recFlash > 0) {
      const on = blink(1 - this.recFlash, 5);
      return fill(on ? LAMP.white : LAMP.amber, on ? 0.8 : 0.1, n);
    }
    if (this.relicFlash > 0) { // a quick sweep left to right: a relic is yours
      const k = Math.min(n - 1, Math.floor((1 - this.relicFlash / 0.35) * n));
      return lamps(...Array.from({ length: n }, (_, i) => (i <= k ? dim(LAMP.white, i === k ? 0.8 : 0.3) : null)));
    }
    if (this.trickFlash > 0) { // a trick: a quick cyan sweep right to left
      const k = n - 1 - Math.min(n - 1, Math.floor((1 - this.trickFlash / 0.3) * n));
      return lamps(...Array.from({ length: n }, (_, i) => (i >= k ? dim(LAMP.cyan, i === k ? 0.8 : 0.3) : null)));
    }
    if (this.catchFlash > 0) return fill(LAMP.white, 0.7, n);
    if (this.regFlash > 0.02) return fill(this.flareCol || REGIONS[this.reg].col, 0.5 * Math.min(1, this.regFlash) * (0.6 + 0.4 * pulse(this.runT, 4)), n);
    const danger = this.danger(p.y);
    let out;
    if (p.a) {
      let level = 0.4;
      if (p.a.kind === "decay" && this.fuseT - p.t < 0.8) level = blink(this.runT, 8) ? 0.5 : 0.08;
      const pos = 0.5 + 0.5 * Math.sin(p.phi);
      out = spot(pos, dim(ramp(danger, [LAMP.cyan, LAMP.amber, LAMP.red]), level), 0.8);
    } else {
      out = this.flightLamps(p, danger);
    }
    out = this.cues(out, p);
    return n < 4 ? out : [...out, ...this.pressLamp(p)];
  }
  // The fourth lamp. The dark (or a paced run's edge) close behind: red, blinking faster as it
  // closes. On a tether: brighter and greener the better a release now would be (forward, level to
  // rising); amber blinking when the sun is about to burn out. In flight: cyan while a sun is marked
  // in reach (a press catches it; amber for a sun that burns out), off when none is.
  pressLamp(p) {
    const gap = p.x - this.front;
    if (gap < 170) return blink(this.runT, 3 + 6 * (1 - gap / 170)) ? dim(LAMP.red, 0.3 + 0.4 * (1 - gap / 170)) : [0, 0, 0];
    if (p.a) {
      if (p.a.kind === "decay" && this.fuseT - p.t < 0.8) return blink(this.runT, 8) ? dim(LAMP.amber, 0.5) : [0, 0, 0];
      const sp = Math.hypot(p.vx, p.vy) || 1, ang = Math.atan2(-p.vy, p.vx);
      const q = p.vx > 0 ? clamp(1 - Math.abs(ang - 0.35) / 0.8, 0, 1) * clamp(sp / 260, 0, 1) : 0;
      return dim(blend(LAMP.cyan, LAMP.green, q), 0.06 + 0.5 * q);
    }
    const a = this.pickTarget(p);
    if (!a) return [0, 0, 0];
    return dim(a.kind === "decay" ? LAMP.amber : LAMP.cyan, this.held ? 0.6 : 0.3);
  }
  flightLamps(p, danger) {
    const reg = REGIONS[this.reg];
    let base = reg.col;
    if (this.reg === 3 && p.x > NEB0 && p.x < NEB1) { // paler where the current lifts, deeper blue where it presses down
      const f = this.current(p.x, PD);
      base = blend(reg.col, LAMP.white, 0.8 * clamp(0.5 - 0.5 * f.y / 85, 0, 1));
    }
    const beat = this.reg === 5 ? this.beatLamps(p) : null;
    if (beat) return beat;
    const f = clamp((Math.hypot(p.vx, p.vy) - 180) / 240, 0, 1);
    const col = ramp(danger, [base, LAMP.amber, LAMP.red]);
    const scale = 0.38 * (danger > 0.7 ? 0.65 + 0.35 * blink(this.runT, 4) : 1);
    return lamps(...[0, 1, 2].map((i) => dim(col, scale * (0.1 + 0.9 * clamp(f * 3 - i, 0, 1)))));
  }
  // The countdown for the next pulsing sun: while it is lit the lamps drain left to right as its
  // light runs out; while it is dark the middle lamp blinks faster as it is about to relight.
  beatLamps(p) {
    const clk = p.clk || 0;
    let a = null;
    for (const s of this.anchors) {
      if (s.kind !== "pulse" || s.dead || s.id <= p.lastId) continue;
      const dx = s.x - p.x;
      if (dx > -20 && dx < REACH + 80) { a = s; break; }
    }
    if (!a) return null;
    const u = (clk / a.pu.per + a.pu.ph) % 1;
    const yellow = REGIONS[5].col;
    if (u < a.pu.duty) return meter(clamp((a.pu.duty - u) / a.pu.duty, 0, 1) * 0.98 + 0.02, dim(yellow, 0.4));
    const wait = (1 - u) / (1 - a.pu.duty);
    return lamps(null, blink(this.runT, 2 + 8 * (1 - wait)) ? dim(yellow, 0.3) : null, null);
  }
  // Pointers laid over the base lamps: a dark body ahead blinks red on the side it is on, a relic
  // pulses white on its side. Left is above you, right is below, the middle is level.
  cues(v, p) {
    let hz = null;
    for (const s of this.voids) {
      const dx = s.x - p.x;
      if (dx < -10 || dx > 230) continue;
      const dy = s.y - p.y;
      if (Math.abs(dy) > 130) continue;
      hz = { dy, near: 1 - dx / 230 };
      break;
    }
    if (hz && this.reg >= 1) return this.lampAt(v, hz.dy, LAMP.red, 0.25 + 0.45 * hz.near, blink(this.runT, 3 + 6 * hz.near));
    for (const r of this.relics) {
      if (r.got) continue;
      const dx = r.x - p.x;
      if (dx < -20 || dx > 300) continue;
      const dy = r.y - p.y;
      if (Math.abs(dy) > 170) continue;
      return this.lampAt(v, dy, LAMP.white, 0.2 + 0.4 * (1 - dx / 300), 0.5 + 0.5 * pulse(this.runT, 3));
    }
    return v;
  }
  lampAt(v, dy, rgb, level, on) {
    const i = dy < -25 ? 0 : dy > 25 ? 2 : 1;
    const out = v.slice();
    const c = on ? dim(rgb, level) : [0, 0, 0];
    out[i * 3] = c[0]; out[i * 3 + 1] = c[1]; out[i * 3 + 2] = c[2];
    return out;
  }

  // ---- drawing -----------------------------------------------------------
  draw(g) {
    space(g, this.cam * 0.25, 0.5);
    if (this.phase !== "hangar") { // each region tints the sky ahead
      const ri = this.phase === "title" ? this.sv.far : regIndex(this.cam + 480);
      const gr = g.createRadialGradient(760, 270, 40, 760, 270, 620);
      gr.addColorStop(0, rgba(REGIONS[ri].ink, 0.09));
      gr.addColorStop(1, rgba(REGIONS[ri].ink, 0));
      g.fillStyle = gr;
      g.fillRect(0, 0, 960, 540);
    }
    if (this.phase !== "hangar") this.drawBackdrop(g);
    this.drawField(g);
    if (this.phase === "title") {
      banner(g, "PERIHELION", "SWING BETWEEN SMALL SUNS");
      text(g, "HOLD = TETHER     RELEASE = FLY ON", 480, 392, 18, C.muted, "center");
      if (this.c.best() > 0) text(g, "BEST " + this.c.best() + " Mkm", 480, 422, 18, C.amber, "center");
      const today = this.c.today?.();
      if (today && !today.done) text(g, "ONE OF TODAY'S THREE: " + today.goal.toUpperCase(), 480, 362, 18, C.cyan, "center");
      if (this.sv.runs >= 2) {
        const far = REGIONS[this.sv.far];
        text(g, "FURTHEST: " + far.name, 480, 452, 18, far.ink, "center");
      }
      text(g, "HOLD = HANGAR AND GUIDE", 480, 482, 18, C.muted, "center");
      this.drawHoldRing(g);
    } else if (this.phase === "over") { this.drawResult(g); this.drawHoldRing(g); }
    else if (this.phase === "hangar") { this.drawHangar(g); this.drawHoldRing(g); }
    else this.drawOverlay(g);
    if (this.ready) {
      g.fillStyle = "#0c1511e8";
      g.fillRect(190, 300, 580, 110);
      text(g, "HOLD TO THROW THE TETHER", 480, 336, 28, C.amber, "center");
      text(g, this.lost ? "SPARE PROBE READY   " + this.lives + " LEFT" : "RELEASE TO FLY ON", 480, 376, 22, this.lost ? C.cyan : C.muted, "center");
    }
  }
  // A press on a menu screen shows how close it is to a choose-press.
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
  // Faint line art far behind the field, different in each region.
  drawBackdrop(g) {
    const ri = this.phase === "title" ? this.sv.far : regIndex(this.cam + 480);
    if (ri === 0) return;
    const reg = REGIONS[ri], par = 0.5, cell = 90;
    const i0 = Math.floor((this.cam * par) / cell);
    g.strokeStyle = reg.ink;
    g.fillStyle = reg.ink;
    g.globalAlpha = 0.22;
    g.lineWidth = 2;
    g.beginPath(); // one path for the whole backdrop
    for (let i = i0; i < i0 + 12; i++) {
      const h = mixSeed(i * 7919 + ri);
      const x = i * cell - this.cam * par + (h % 60), y = 40 + ((h >>> 8) % 460);
      if (ri === 1) { g.moveTo(x - 4, y); g.lineTo(x + 4, y); g.moveTo(x, y - 4); g.lineTo(x, y + 4); g.moveTo(x + 22, y + 14); g.lineTo(x + 25, y + 14); }
      else if (ri === 2) { const r = 18 + (h % 9); g.moveTo(x + r, y); g.arc(x, y, r, 0, TAU); g.moveTo(x + 41, y); g.arc(x + 36, y, 5, 0, TAU); }
      else if (ri === 3) { g.moveTo(x, y); g.lineTo(x + 60, y + ((h >>> 12) % 21) - 10); }
      else if (ri === 4) { g.moveTo(x - 8, y - 8); g.lineTo(x + 8, y + 8); g.moveTo(x - 8, y + 8); g.lineTo(x + 8, y - 8); }
      else { const r = 10 + 12 * pulse(this.t + i, 0.5); g.moveTo(x + r, y); g.arc(x, y, r, 0, TAU); }
    }
    g.stroke();
    g.globalAlpha = 1;
  }
  drawField(g) {
    const cam = this.cam, p = this.p, clk = p.clk || 0;
    // Safe band edges.
    g.setLineDash(DASH);
    line(g, 0, BAND_TOP, 960, BAND_TOP, "#6b3a2e", 1.5);
    line(g, 0, BAND_BOT, 960, BAND_BOT, "#6b3a2e", 1.5);
    g.setLineDash(NO_DASH);
    if (this.phase === "play" && this.reg === 3) this.drawCurrent(g);
    const playing = this.phase === "play";
    const target = playing && !p.a ? this.pickTarget(p) : this.phase === "title" ? this.pickTarget(p) : null;
    for (const v of this.voids) {
      const x = v.x - cam;
      if (x < -60 || x > 1020) continue;
      circle(g, x, v.y, v.r, "#050806", true);
      g.strokeStyle = C.red;
      g.lineWidth = 2.5;
      g.beginPath();
      g.arc(x, v.y, v.r, 0, TAU);
      const k = v.r * 0.6;
      g.moveTo(x - k, v.y - k); g.lineTo(x + k, v.y + k); g.moveTo(x - k, v.y + k); g.lineTo(x + k, v.y - k);
      g.stroke();
      if (this.reg >= 1 && !v.s && x > CAM_LEAD - 40 && x < CAM_LEAD + 300) { // the near-pass zone
        g.globalAlpha = 0.4;
        g.setLineDash(DASH);
        circle(g, x, v.y, v.r + PROBE_R + NEAR_GAP, C.red, false, 1.5);
        g.setLineDash(NO_DASH);
        g.globalAlpha = 1;
      }
    }
    for (const r of this.relics) {
      const x = r.x - cam;
      if (r.got || x < -30 || x > 1000) continue;
      const k = 13 + 2 * pulse(this.t, 1.2);
      line(g, x - k, r.y, x + k, r.y, C.cyan, 2);
      line(g, x, r.y - k, x, r.y + k, C.cyan, 2);
      diamond(g, x, r.y, 8, "#ffffff", true);
    }
    for (const a of this.anchors) {
      const A = place(a, clk, PD);
      const x = A.x - cam;
      if (x < -60 || x > 1020) continue;
      this.drawSun(g, a, x, A.y, p.a === a, clk);
    }
    if (target) { // only the mark: the path is for the player to judge
      const A = place(target, clk, PD);
      diamond(g, A.x - cam, A.y, 25 + 3 * pulse(this.t, 1.5), C.cyan);
    }
    if (this.pending && !p.a) {
      const A = place(this.pending, clk, PD);
      g.setLineDash(DASH);
      line(g, p.x - cam, p.y, A.x - cam, A.y, C.amber, 2);
      g.setLineDash(NO_DASH);
    }
    if (p.a) { // the tether: a solid rod from the sun to the probe
      const A = place(p.a, clk, PD);
      g.globalAlpha = 0.25;
      line(g, A.x - cam, A.y, p.x - cam, p.y, C.amber, 10);
      g.globalAlpha = 1;
      line(g, A.x - cam, A.y, p.x - cam, p.y, C.amber, 4);
    }
    if (this.ripple > 0 && this.rippleAt) { // a catch rings out from the sun
      const f = 1 - this.ripple / 0.45;
      g.globalAlpha = 0.7 * (1 - f);
      circle(g, this.rippleAt.x - cam, this.rippleAt.y, 16 + 60 * f, C.ink, false, 2.5);
      g.globalAlpha = 1;
    }
    // Trail, then probe.
    const n = this.trailN, tr = TRAILS[this.sv.sel.trail] || TRAILS[0];
    if (tr.dash) g.setLineDash([5, 6]);
    for (let i = TRAIL - n; i < TRAIL - 1; i++) {
      g.globalAlpha = ((i - (TRAIL - n)) / n) * 0.55;
      line(g, this.trail[i * 2] - cam, this.trail[i * 2 + 1], this.trail[i * 2 + 2] - cam, this.trail[i * 2 + 3], tr.col, 1 + 3 * (i - (TRAIL - n)) / n);
    }
    g.setLineDash(NO_DASH);
    g.globalAlpha = 1;
    if (this.phase !== "over") this.drawProbe(g, p.x - cam, p.y, this.head);
    // Particles.
    for (let k = 0; k < MAX_PARTS; k++) {
      const o = k * 5, life = this.parts[o + 4];
      if (life <= 0) continue;
      g.globalAlpha = clamp(life * 2, 0, 1);
      g.fillStyle = C.amber;
      g.fillRect(this.parts[o] - cam - 1.5, this.parts[o + 1] - 1.5, 3, 3);
    }
    g.globalAlpha = 1;
    if (this.pace && this.phase === "play") { // a paced run's left edge
      g.setLineDash(DASH);
      line(g, 3, 0, 3, 540, C.red, 3);
      g.setLineDash(NO_DASH);
    }
    // Terminator.
    const fx = this.front - cam;
    if (fx > 0) {
      g.globalAlpha = 0.8;
      g.fillStyle = "#040705";
      g.fillRect(0, 0, Math.min(960, fx), 540);
      g.globalAlpha = 1;
      g.setLineDash(DASH);
      line(g, fx, 0, fx, 540, C.red, 2);
      g.setLineDash(NO_DASH);
    }
    // The perihelion, far ahead: concentric rings that grow as it nears.
    const sx = ARRIVAL + 300 - cam;
    if (this.phase === "play" && sx < 1500 && sx > -100) {
      for (let k = 0; k < 4; k++) circle(g, sx, 270, 40 + 38 * k + 4 * pulse(this.t + k, 0.4), k % 2 ? C.amber : C.ink, false, 3);
      circle(g, sx, 270, 18, C.amber, true);
    }
  }
  drawSun(g, a, x, y, held, clk) {
    const kind = a.kind;
    if (kind === "pair") {
      const ink = REGIONS[2].ink;
      if (a.orb.ph < Math.PI || a.orb.ph >= 2 * Math.PI) { // once per pair is enough for the orbit guide
        g.globalAlpha = 0.3;
        g.setLineDash(DASH);
        circle(g, a.x - this.cam, a.y, a.orb.R, ink, false, 1.5);
        g.setLineDash(NO_DASH);
        g.globalAlpha = 1;
      }
      glow(g, x, y, held ? 46 : 34, ink, held ? 0.45 : 0.28);
      circle(g, x, y, 14, ink, false, 3);
      circle(g, x, y, 5, ink, true);
      return;
    }
    if (kind === "pulse") {
      const on = lit(a, clk), ink = REGIONS[5].ink;
      if (on || held) {
        glow(g, x, y, held ? 46 : 34, ink, held ? 0.45 : 0.3);
        circle(g, x, y, 14, ink, false, 3);
        circle(g, x, y, 5, ink, true);
        const left = held ? 1 : clamp((a.pu.duty - ((clk / a.pu.per + a.pu.ph) % 1)) / a.pu.duty, 0, 1);
        g.beginPath();
        g.arc(x, y, 24, -Math.PI / 2, -Math.PI / 2 + TAU * left);
        g.strokeStyle = ink;
        g.lineWidth = 3;
        g.stroke();
      } else {
        g.setLineDash(DASH);
        circle(g, x, y, 14, C.muted, false, 2.5);
        g.setLineDash(NO_DASH);
        circle(g, x, y, 3, C.muted, true);
      }
      return;
    }
    const decay = kind === "decay";
    const col = a.dead ? C.line : decay ? C.amber : C.ink;
    if (!a.dead) glow(g, x, y, (held ? 46 : 32) + 2 * pulse(this.t + a.id * 0.37, 0.6), kind === "sling" ? C.cyan : col, held ? 0.42 : 0.22);
    circle(g, x, y, 14, col, false, 3);
    circle(g, x, y, 5, col, true);
    if (kind === "sling") {
      g.setLineDash(DASH);
      circle(g, x, y, 22, C.cyan, false, 2);
      g.setLineDash(NO_DASH);
      line(g, x - 3, y - 8, x + 4, y, C.cyan, 3);
      line(g, x + 4, y, x - 3, y + 8, C.cyan, 3);
    }
    if (decay && !a.dead) {
      g.setLineDash(DASH);
      circle(g, x, y, 22, C.amber, false, 2);
      g.setLineDash(NO_DASH);
    }
    if (decay && held) {
      g.beginPath();
      g.arc(x, y, 28, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(1 - this.p.t / this.fuseT, 0, 1));
      g.strokeStyle = C.red;
      g.lineWidth = 4;
      g.stroke();
    }
  }
  // Streaks that follow the current: their direction is the push, their length the strength.
  drawCurrent(g) {
    const cam = this.cam, o = PD;
    g.strokeStyle = REGIONS[3].ink;
    g.lineWidth = 2;
    g.globalAlpha = 0.35;
    for (let i = 0; i < 17; i++) {
      const wx = Math.floor(cam / 60) * 60 + i * 60;
      this.current(wx, o);
      if (Math.abs(o.x) + Math.abs(o.y) < 4) continue;
      const sx = wx - cam;
      const drift = (this.t * 30) % 60;
      for (let j = 0; j < 4; j++) {
        const y = 90 + j * 100 + (drift * o.y) / 170 + ((i * 37) % 30);
        const dx = o.x * 0.5, dy = o.y * 0.45;
        line(g, sx, y, sx + dx, y + dy, REGIONS[3].ink, 2);
        if (Math.abs(dy) > 12) { // arrow head on the strong parts
          const s = dy > 0 ? 1 : -1;
          line(g, sx + dx, y + dy, sx + dx - 5, y + dy - 7 * s, REGIONS[3].ink, 2);
          line(g, sx + dx, y + dy, sx + dx + 5, y + dy - 7 * s, REGIONS[3].ink, 2);
        }
      }
    }
    g.globalAlpha = 1;
  }
  drawProbe(g, x, y, ang) {
    const k = this.probeIx === 1 ? 1.25 : this.probeIx === 2 ? 0.85 : 1;
    glow(g, x, y, 26 * k, C.amber, 0.3);
    g.save();
    g.translate(x, y);
    g.rotate(ang);
    if (this.phase === "play" && !this.ready) { // a flickering exhaust, longer with speed
      const sp = clamp((Math.hypot(this.p.vx, this.p.vy) - 150) / 300, 0, 1), fl = (8 + 14 * sp) * (0.75 + 0.25 * Math.sin(this.t * 41));
      g.beginPath();
      g.moveTo(-5 * k, -4 * k);
      g.lineTo(-5 * k - fl * k, 0);
      g.lineTo(-5 * k, 4 * k);
      g.closePath();
      g.fillStyle = C.cyan;
      g.globalAlpha = 0.75;
      g.fill();
      g.globalAlpha = 1;
    }
    g.beginPath();
    g.moveTo(16 * k, 0);
    g.lineTo(-10 * k, -10 * k);
    g.lineTo(-4 * k, 0);
    g.lineTo(-10 * k, 10 * k);
    g.closePath();
    g.fillStyle = C.amber;
    g.fill();
    g.restore();
  }
  drawOverlay(g) {
    const p = this.p;
    if (this.goal) {
      const gl = this.goal;
      const k = this.goalProg(), w = 150, x0 = 910 - w; // what the goal is, and a bar that fills toward it
      text(g, gl.done ? "GOAL MET  +" + gl.reward : "GOAL  " + GOALS[gl.i].short + "  " + k + "/" + gl.n, 910, 30, 18, gl.done ? C.cyan : C.ink, "right");
      line(g, x0, 42, 910, 42, C.line, 4);
      line(g, x0, 42, x0 + w * (gl.done ? 1 : k / gl.n), 42, gl.done ? C.cyan : C.amber, 4);
    }
    for (let i = 0; this.lives + this.lost > 1 && i < this.lives; i++) { // probes left, the one flying included
      g.save(); g.translate(40 + i * 30, 30); g.beginPath();
      g.moveTo(11, 0); g.lineTo(-7, -7); g.lineTo(-3, 0); g.lineTo(-7, 7); g.closePath();
      g.fillStyle = i === 0 ? C.amber : C.muted; g.fill(); g.restore();
    }
    const gap = p.x - this.front;
    if (gap < 220) {
      g.globalAlpha = 0.5 + 0.5 * blink(this.t, 4);
      text(g, this.pace ? "EDGE CLOSING" : "DARK CLOSING", 30, 60, 22, C.red);
      g.globalAlpha = 1;
    }
    if (this.recText > 0) text(g, "NEW DISTANCE RECORD", 480, 80, 22, C.cyan, "center");
    if (this.noticeT > 0 && this.bannerT <= 0) { // the notice strip at the foot of the screen
      const m = this.notice, col = /^(GOAL|FEAT)/.test(m) ? C.cyan : /^PROBE LOST/.test(m) ? C.red : C.ink;
      g.globalAlpha = clamp(this.noticeT * 3, 0, 1);
      const sz = m.length > 64 ? 18 : 22, w = Math.min(920, m.length * sz * 0.6 + 48); // monospace
      g.fillStyle = "#0c1511d8";
      g.fillRect(480 - w / 2, 472, w, 40);
      line(g, 480 - w / 2, 472, 480 + w / 2, 472, col, 2);
      text(g, m, 480, 499, sz, col, "center");
      g.globalAlpha = 1;
    }
    if (this.trickT > 0) {
      g.globalAlpha = clamp(this.trickT * 2, 0, 1);
      text(g, this.trickText, clamp(p.x - this.cam, 120, 840), clamp(p.y - 34, 40, 500), 22, C.cyan, "center");
      g.globalAlpha = 1;
    }
    if (this.bannerT > 0) {
      const reg = REGIONS[this.reg];
      g.globalAlpha = clamp(this.bannerT, 0, 1);
      g.fillStyle = "#0c1511d8";
      g.fillRect(160, 96, 640, 96);
      line(g, 200, 104, 760, 104, reg.ink, 2);
      text(g, reg.roman + "   " + reg.name, 480, 134, 32, reg.ink, "center");
      text(g, reg.text, 480, 172, 22, C.muted, "center");
      g.globalAlpha = 1;
    }
    // Height gauge on the right edge: where the probe sits in its safe band.
    const gy = clamp(p.y, BAND_TOP, BAND_BOT);
    line(g, 934, BAND_TOP, 934, BAND_BOT, C.line, 3);
    line(g, 934, 150, 934, 390, C.muted, 5);
    diamond(g, 934, gy, 9, this.danger(p.y) > 0.5 ? C.red : C.ink, true);
  }
  drawResult(g) {
    const r = this.result || { mkm: 0, chain: 0, catches: 0, reason: "", relics: 0, region: REGIONS[0].name, next: [] };
    const arrived = this.reason === "arrived";
    g.fillStyle = "#0c1511f0";
    g.fillRect(150, 44, 660, 458);
    line(g, 200, 54, 760, 54, C.line);
    text(g, arrived ? "PERIHELION" : "PROBE LOST", 480, 92, 38, arrived ? C.cyan : C.red, "center");
    text(g, r.reason, 480, 130, 18, C.muted, "center");
    let y = 176;
    const row = (label, value, col = C.ink) => {
      text(g, label, 230, y, 18, C.muted);
      text(g, value, 730, y, 26, col, "right");
      y += 32;
    };
    row("DISTANCE", r.mkm + " Mkm");
    row("BEST CHAIN", r.chain + "   CAUGHT " + r.catches);
    const far = REGIONS[this.reg];
    if (this.reg > 0 || this.sv.far > 0) row("REGION", far.name.slice(4), far.ink);
    if (this.goal) row("GOAL", this.goal.done ? "MET +" + this.goal.reward : this.goalProg() + " / " + this.goal.n, this.goal.done ? C.cyan : C.muted);
    row("SHARDS", "+" + (r.shards || 0) + "   (" + this.sv.shards + ")", C.cyan);
    if (this.R.tricks > 0) row("TRICKS", this.R.tricks + "   +" + this.R.trickPts);
    if (this.R.relics > 0 || this.sv.st.relics > 0) row("RELICS", this.R.relics + (this.R.near ? "   NEAR " + this.R.near : ""));
    const record = this.newRecord;
    text(g, record ? "NEW DISTANCE RECORD" : "BEST " + this.bestRef() + " Mkm", 480, y + 4, 18, record ? C.cyan : C.amber, "center");
    y += 36;
    if (this.daily) { text(g, this.goalDone ? "DAILY GOAL MET" : "DAILY: " + dailyGoal(this.dayKey()).text, 480, y, 18, this.goalDone ? C.cyan : C.muted, "center"); y += 28; }
    for (const id of this.newFeats.slice(0, 2)) {
      const f = FEATS.find((x) => x.id === id);
      if (f && y < 456) { text(g, "FEAT  " + f.name, 480, y, 20, C.cyan, "center"); y += 28; }
    }
    if (this.sv.runs >= 3) for (const line1 of (r.next || []).slice(0, 2)) { if (y < 456) text(g, line1, 480, y, 18, C.muted, "center"); y += 26; }
    if (this.deadT > 0.7) text(g, this.sv.runs >= 3 ? "TAP = AGAIN     HOLD = HANGAR" : "PRESS TO LAUNCH AGAIN", 480, 478, 18, C.amber, "center");
  }
  drawHangar(g) {
    g.fillStyle = "#0c1511f2";
    g.fillRect(110, 36, 740, 470);
    line(g, 160, 46, 800, 46, C.line);
    text(g, "HANGAR", 480, 82, 36, C.amber, "center");
    const sv = this.sv;
    if (this.view === "menu") {
      const pr = PROBES[Math.min(sv.sel.probe, PROBES.length - 1)], tr = TRAILS[sv.sel.trail];
      const rows = {
        LAUNCH: ["LAUNCH", "THE APPROACH"],
        UPGRADES: ["UPGRADES", sv.shards + " SHARDS"],
        PROBE: ["PROBE", pr.name],
        START: ["START", REGIONS[Math.min(sv.sel.start, sv.far)].name],
        PACE: ["PACE", PACES[sv.sel.pace].name],
        TRAIL: ["TRAIL", tr.name],
        DAILY: ["DAILY RUN", this.dailyDone() ? "DONE TODAY" : "SEEDED BY DATE"],
        LOG: ["LOG", "REACHED " + REGIONS[sv.far].roman + " / VI"],
        GUIDE: ["GUIDE", "HOW TO PLAY"],
      };
      const list = this.rows();
      this.cur = Math.min(this.cur, list.length - 1);
      list.forEach((id, i) => {
        const y = 134 + i * 34, on = i === this.cur;
        if (on) diamond(g, 150, y, 9, C.amber, true);
        text(g, rows[id][0], 180, y, 24, on ? C.amber : C.ink);
        text(g, rows[id][1], 810, y, 22, on ? C.amber : C.muted, "right");
      });
      const id = list[this.cur];
      let info = "";
      if (id === "LAUNCH") info = sv.sel.pace ? "Paced run: " + PACES[sv.sel.pace].name + "." : "Plain run from the start.";
      else if (id === "PROBE") { const next = PROBES.find((x, i) => i > 0 && !this.unlockedProbe(i)); info = pr.text + (next ? "  NEXT: " + next.name + " AT " + unlockAt(next) : ""); }
      else if (id === "START") info = "Begin where you have been. Scored from there.";
      else if (id === "PACE") info = sv.sel.pace ? "The screen moves on by itself. Its left edge ends the run." : "OFF: the dark behind you sets the pace.";
      else if (id === "TRAIL") { const next = TRAILS.find((x, i) => i > 0 && !this.unlockedTrail(i)); info = next ? "NEXT: " + next.name + " AT " + unlockAt(next) : "All trails earned."; }
      else if (id === "DAILY") { const gl = dailyGoal(this.dayKey()); info = "Goal: " + gl.text; }
      else if (id === "LOG") info = "Regions reached and best crossings. Feats are in the console's LOGBOOK.";
      else if (id === "UPGRADES") info = "Spend shards: spare probes and more. Every run earns some.";
      else info = "Controls, tricks, the chain, shards.";
      text(g, info, 480, 450, 18, C.muted, "center");
      text(g, "TAP = NEXT LINE     HOLD = CHOOSE", 480, 480, 18, C.cyan, "center");
    } else if (this.view === "shop") {
      text(g, "UPGRADES     " + sv.shards + " SHARDS", 480, 120, 20, C.cyan, "center");
      UPGRADES.forEach((u, i) => {
        const y = 160 + i * 44, on = i === this.page, lv = sv.up[u.id] || 0, cost = u.cost[lv];
        if (on) diamond(g, 150, y, 9, C.amber, true);
        text(g, u.name + "  " + "I".repeat(lv) + "-".repeat(u.cost.length - lv), 180, y, 22, on ? C.amber : C.ink);
        text(g, cost === undefined ? "FULL" : cost + " SHARDS", 810, y, 20, cost === undefined ? C.cyan : sv.shards >= cost ? C.amber : C.line, "right");
      });
      const back = this.page === UPGRADES.length;
      if (back) diamond(g, 150, 160 + UPGRADES.length * 44, 9, C.amber, true);
      text(g, "BACK", 180, 160 + UPGRADES.length * 44, 22, back ? C.amber : C.ink);
      text(g, back ? "Back to the hangar." : UPGRADES[this.page].text, 480, 440, 18, C.muted, "center");
      text(g, "TAP = NEXT LINE     HOLD = " + (back ? "BACK" : "BUY"), 480, 480, 18, C.cyan, "center");
    } else if (this.view === "guide") {
      const pg = GUIDE[this.page % GUIDE.length];
      text(g, pg[0] + "     PAGE " + (this.page % GUIDE.length + 1) + " / " + GUIDE.length, 480, 124, 20, C.cyan, "center");
      pg.slice(1).forEach((s, i) => text(g, s, 130, 170 + i * 46, 18, i % 2 ? C.muted : C.ink)); // 66 characters fit the panel
      text(g, "TAP = NEXT PAGE     HOLD = BACK", 480, 488, 18, C.cyan, "center");
    } else {
      text(g, "LOG   RUNS " + sv.runs + "   RELICS " + sv.st.relics + "   ARRIVALS " + sv.st.arrivals, 480, 118, 20, C.cyan, "center");
      REGIONS.forEach((r, i) => {
        const y = 164 + i * 44, got = i <= sv.far;
        text(g, r.roman + "  " + r.name.slice(4), 150, y, 22, got ? r.ink : C.line);
        const t = sv.rb[i];
        text(g, !got ? "NOT REACHED" : t ? "BEST CROSSING " + mmss(t) : i === sv.far ? "REACHED" : "REACHED", 810, y, 20, got ? C.amber : C.line, "right");
      });
      text(g, "PERIHELION", 150, 164 + 6 * 44, 22, sv.st.arrivals ? C.cyan : C.line);
      text(g, sv.st.arrivals ? "ARRIVED " + sv.st.arrivals + "x" : "NOT REACHED", 810, 164 + 6 * 44, 20, sv.st.arrivals ? C.cyan : C.line, "right");
      text(g, "TAP = BACK", 480, 488, 18, C.cyan, "center");
    }
  }
  dailyDone() { return this.sv.dl.d === this.dayKey() && this.sv.dl.done === 1; }
}

// The hangar's rows. A row with nothing to choose yet (no shards, one probe, one region) is left out.
const HANGAR = ["LAUNCH", "DAILY", "UPGRADES", "PACE", "START", "PROBE", "TRAIL", "LOG", "GUIDE"];
const NOTES = [
  [1800, "Dark bodies ahead. Steer clear."],
  [4100, "Amber suns burn out. Do not linger."],
];
