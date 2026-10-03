// BALLISTA — a one-button launcher, played for distance. The barrel sweeps up and down by itself;
// pressing fixes the angle, holding charges a meter that rises and falls, releasing fires a survey
// pod across open ground. A strip under the aim shows the field ahead and where the shot will
// first land. What it lands on decides the run: spring pads and mines throw it on, boosters speed
// it up, drifts and nets slow it, sinkholes swallow it. In flight one button does two jobs: a press
// while the pod is about to touch down is a skip (the later, the better: a perfect skip gains
// speed, more along a chain), a press any other time fires a thruster, of which there are few. A
// press a little early or just late is forgiven, never a wasted thruster.
//
// Around that: salvage from every run buys upgrades in the workshop (barrel, thrusters, hull,
// fins, magnet), then modules and overhaul marks; seven zones farther out bring new things,
// contracts set standing jobs, pods are earned with feats, and a daily run gives everyone the
// same field and loadout for the date. Versioned save (schema 3) that takes over the first
// Ballista's record. The lamps are the pod's instruments.
import { C, text, line, circle, diamond, banner } from "../engine/draw.js";
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
// Forgiveness around the skip window, so a press near the ground never wastes a thruster: a press up
// to EARLY_WIN before the window does nothing (press again), and one up to LATE_WIN after a plain
// touchdown still turns it into a good skip. Human hands and the console's input lag both need it.
export const EARLY_WIN = 0.25, LATE_WIN = 0.14;
const PERFECT_E = 0.24, GOOD_E = 0.05; // what a skip adds to the hull's bounce
const PERFECT_KEEP = 1.05, GOOD_KEEP = 0.88; // ... and how much speed it keeps: a perfect skip gains a little,
const CHAIN_KEEP = 0.02, CHAIN_KEEP_MAX = 5; // ... and a little more for each link of a chain behind it
export const BOUNCE_VY = 90; // touching down slower than this, the pod rolls
const STOP_VX = 10;
const VX_CAP = 1500, VY_CAP = 1100;
const RUN_CAP = 180; // seconds: a run that has not ended by then ends
const MAX_FEATURES = 60, MAX_PARTS = 40, TRAIL = 36;
const KICK_X = 120, KICK_Y = 300;
const PAD_V = 540, MINE_V = 700, BOOST_X = 280;
const FRICTION = { ground: 260, drift: 1150, ice: 22 };

// ---- the field: six zones farther and farther out, each adding something ----------------
// `from` is in metres. `kinds` are relative weights of what is placed; `gap` the spacing in px.
export const ZONES = [
  { name: "THE FLATS", roman: "I", from: 0, col: LAMP.green, ink: "#9fdc7a", gap: [180, 380], kinds: { pad: 3, drift: 2, scrap: 3 } },
  { name: "THE DUNES", roman: "II", from: 150, col: LAMP.amber, ink: "#e7b879", gap: [170, 360], kinds: { pad: 3, drift: 2, scrap: 3, boost: 2, beacon: 2 } },
  { name: "THE CRATERS", roman: "III", from: 350, col: LAMP.red, ink: "#eb947a", gap: [170, 350], kinds: { pad: 3, drift: 2, scrap: 2, boost: 2, beacon: 2, pit: 2, mine: 2 } },
  { name: "THE SPIRES", roman: "IV", from: 600, col: LAMP.violet, ink: "#b48cf0", gap: [160, 340], kinds: { pad: 2, drift: 2, scrap: 2, boost: 2, beacon: 2, pit: 2, mine: 2, updraft: 2, net: 2 } },
  { name: "THE GLASS", roman: "V", from: 900, col: LAMP.cyan, ink: "#8fcbc5", gap: [160, 340], kinds: { pad: 2, drift: 1, scrap: 2, boost: 2, beacon: 2, pit: 3, mine: 2, updraft: 1, net: 2, ice: 3 } },
  { name: "THE STORM", roman: "VI", from: 1250, col: LAMP.white, ink: "#ece4d0", gap: [160, 330], kinds: { pad: 2, drift: 1, scrap: 2, boost: 2, beacon: 2, pit: 3, mine: 2, updraft: 1, net: 2, ice: 2, gust: 3 } },
  { name: "THE BEYOND", roman: "VII", from: 1900, col: [255, 0, 110], ink: "#e0507a", gap: [150, 300], kinds: { pad: 2, drift: 1, scrap: 2, boost: 2, beacon: 2, pit: 4, mine: 2, updraft: 1, net: 2, ice: 2, gust: 2 } },
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
const MOTIFS = [[392, 494, 587], [440, 554, 659], [330, 392, 494], [294, 370, 440], [523, 659, 784], [262, 330, 392], [311, 370, 466]];

// ---- the workshop -------------------------------------------------------------------------
// Five systems, five levels each, paid for with salvage.
export const UPGRADES = [
  { id: "barrel", name: "BARREL", text: "Faster launch.", cost: [20, 70, 180, 400, 800] },
  { id: "thrust", name: "THRUSTERS", text: "More thrusters (I, III, V), harder pushes (II, IV).", cost: [20, 60, 170, 380, 720] },
  { id: "hull", name: "HULL", text: "Livelier bounces, longer rolls.", cost: [15, 55, 160, 360, 680] },
  { id: "fins", name: "FINS", text: "Less air drag.", cost: [20, 70, 190, 400, 760] },
  { id: "magnet", name: "MAGNET", text: "Draws scrap from farther away.", cost: [10, 40, 100, 200, 380] },
];
const UP_MAX = 5;
// An overhaul (every system at V) strips the five systems back to nothing and raises the pod's
// mark: each mark launches faster and earns more salvage for good, and the systems cost more.
export const MARK_MAX = 9, MARK_SPEED = 0.03, MARK_SALVAGE = 0.15, MARK_COST = 0.4;
export const upCost = (i, level, mark) => Math.round(UPGRADES[i].cost[level] * (1 + MARK_COST * mark) / 5) * 5;
export const PODS = [
  { name: "STANDARD", need: "", e: 0, drag: 1, kick: 1, perfect: 1, text: "The survey pod as issued." },
  { name: "SKIPPER", need: "skip4", e: 0.07, drag: 1.15, kick: 0.9, perfect: 1.35, text: "Bouncy; easier perfect skips; more drag." },
  { name: "DART", need: "lift5", e: -0.08, drag: 0.72, kick: 1.15, perfect: 0.85, text: "Slips through the air; lands hard." },
  { name: "GLIDER", need: "m1000", e: -0.02, drag: 1.1, kick: 0.9, perfect: 1.1, g: 0.86, text: "Light; long hang time; weaker thrusters." },
];
// Modules: one-time purchases for the late game, of which only a few fit in a run (SLOTS, one more
// with SLOT3_MODS built). Choosing which to fit is part of the plan for a run.
export const MODULES = [
  { id: "spring", name: "SPRING TUNING", cost: 400, text: "Pads throw a fifth higher." },
  { id: "scanner", name: "SCRAP SCANNER", cost: 350, text: "Each scrap is worth 4 salvage, not 2." },
  { id: "relay", name: "BEACON RELAY", cost: 500, text: "Beacons refill two thrusters." },
  { id: "cutter", name: "NET CUTTER", cost: 600, text: "Nets part without slowing you." },
  { id: "skids", name: "DRIFT SKIDS", cost: 700, text: "Drifts barely slow you." },
  { id: "sail", name: "STORM SAIL", cost: 800, text: "Every gust pushes you on." },
  { id: "shell", name: "ABLATIVE SHELL", cost: 900, text: "Bounce out of the first sinkhole." },
  { id: "gyro", name: "GYRO", cost: 1000, text: "Perfect skips are easier to time." },
  { id: "burner", name: "AFTERBURNER", cost: 1200, text: "Thrusters push a quarter harder." },
  { id: "rig", name: "SALVAGE RIG", cost: 1500, text: "A quarter more salvage from every run." },
];
const MOD_IDS = MODULES.map((m) => m.id);
export const SLOTS = 2, SLOT3_MODS = 5;
const DAILY_UP = [3, 3, 3, 3, 3];
// A pod's numbers from the upgrade levels and the pod chosen.
export function loadout(up, podIx, mods = [], mark = 0) {
  const pod = PODS[podIx] || PODS[0], L = (i) => clamp(Math.floor(up[i] || 0), 0, UP_MAX);
  const has = (id) => mods.includes(id);
  return {
    g: G * (pod.g || 1),
    vmax: (600 + 25 * L(0)) * (podIx === 2 ? 1.04 : 1) * (1 + MARK_SPEED * mark),
    kicks: 2 + Math.floor(L(1) / 2), // a thruster more at II and IV; a harder push at I, III and V
    e: 0.44 + 0.015 * L(2) + pod.e,
    keep: 0.84 + 0.01 * L(2),
    roll: 1 - 0.04 * L(2),
    drag: 0.0003 * (1 - 0.06 * L(3)) * pod.drag,
    magnet: 24 + 16 * L(4),
    kick: pod.kick * (has("burner") ? 1.25 : 1) * (1 + 0.06 * Math.ceil(L(1) / 2)),
    perfect: SKIP_PERFECT * pod.perfect * (has("gyro") ? 1.4 : 1),
    pad: has("spring") ? 1.2 : 1,
    scrap: has("scanner") ? 4 : 2,
    relay: has("relay") ? 2 : 1,
    cutter: has("cutter"),
    skids: has("skids"),
    sail: has("sail"),
    shell: has("shell") ? 1 : 0,
    rig: (has("rig") ? 1.25 : 1) * (1 + MARK_SALVAGE * mark),
  };
}
// Salvage a run earns: five for going out, one per 8 m, two per scrap (four with the scanner), times
// the chain multiplier and the salvage rig; bounties and contracts come on top.
export const salvageFor = (metres, scrap, perScrap = 2, mult = 1) => Math.floor((5 + Math.floor(metres / 8) + scrap * perScrap) * mult);
// The best chain of a run (pads, boosters, mines, beacons and perfect skips with no plain landing
// between them) multiplies its salvage: x1.1 per link, up to x2.
export const chainMult = (chain) => 1 + 0.1 * clamp(Math.floor(chain), 0, 10);

// ---- contracts: three standing jobs, replaced as they are done ------------------------------
// Each kind makes a job from the save (what the player has reached) and a random draw; `tier`
// (contracts done so far) makes them slowly harder and better paid.
const round50 = (v) => Math.max(50, Math.round(v / 50) * 50);
const CONTRACTS = {
  metres: { text: (n) => "Fly " + n + " m in one run.", make: (sv, u) => { const n = round50(Math.max(100, sv.best * (0.75 + 0.3 * u))); return [n, 20 + Math.floor(n / 20)]; } },
  zone: { text: (n) => "Reach " + ZONES[n].name + ".", ok: (sv) => sv.far < ZONES.length - 1, make: (sv) => [sv.far + 1, 40 + 40 * (sv.far + 1)] },
  perfect: { text: (n) => "Make " + n + " perfect skips in one run.", make: (sv, u, t) => { const n = Math.min(8, 2 + Math.floor(t / 3) + (u > 0.6 ? 1 : 0)); return [n, 15 + 12 * n]; } },
  lifts: { text: (n) => "Hit " + n + " pads, boosters or mines in one run.", make: (sv, u, t) => { const n = Math.min(8, 2 + Math.floor(t / 3)); return [n, 20 + 12 * n]; } },
  scrap: { text: (n) => "Collect " + n + " scrap in one run.", make: (sv, u, t) => { const n = Math.min(40, 8 + 4 * Math.floor(t / 2)); return [n, 10 + 2 * n]; } },
  chain: { text: (n) => "Make a chain of " + n + ".", make: (sv, u, t) => { const n = Math.min(10, 3 + Math.floor(t / 3)); return [n, 20 + 15 * n]; } },
  pitskip: { text: () => "Skip off a sinkhole.", ok: (sv) => sv.far >= 2, make: () => [1, 80] },
  beacons: { text: (n) => "Touch " + n + " beacons in one run.", ok: (sv) => sv.far >= 1, make: (sv, u, t) => { const n = Math.min(6, 2 + Math.floor(t / 4)); return [n, 20 + 15 * n]; } },
  unaided: { text: (n) => "Fly " + n + " m without a thruster.", make: (sv, u) => { const n = round50(Math.max(100, sv.best * (0.4 + 0.2 * u))); return [n, 40 + Math.floor(n / 12)]; } },
};
const CONTRACT_KINDS = Object.keys(CONTRACTS);
export const contractText = (c) => (CONTRACTS[c.k] ? CONTRACTS[c.k].text(c.n) : "");
// How far a run went toward a contract.
export function contractProgress(c, R) {
  if (c.k === "metres") return R.m;
  if (c.k === "zone") return zoneAt(R.m) >= c.n ? c.n : zoneAt(R.m);
  if (c.k === "unaided") return R.thrusts ? 0 : R.m;
  if (c.k === "beacons") return R.beacons;
  return R[c.k] || 0;
}
const CONTRACT_RUNS = 10; // a job not met in this many runs is withdrawn and another posted
const CRNG = new Random(1); // the contracts' generator; its state is saved as sv.cseed
// A new contract of a kind not already standing.
export function drawContract(sv) {
  CRNG.state = sv.cseed >>> 0 || 0x2545f491;
  const taken = sv.ct.map((c) => c.k);
  const kinds = CONTRACT_KINDS.filter((k) => !taken.includes(k) && (!CONTRACTS[k].ok || CONTRACTS[k].ok(sv)));
  const k = kinds[Math.floor(CRNG.next() * kinds.length)] || "metres";
  const [n, pay] = CONTRACTS[k].make(sv, CRNG.next(), sv.cdone);
  sv.cseed = CRNG.state;
  return { k, n, pay, left: CONTRACT_RUNS };
}

// ---- feats: named goals in the console's dry voice ----------------------------------------
// prog(app) is the current progress toward n. Hidden feats show only a hint until done.
const life = (a, key) => (a.sv.st[key] || 0) + (a.R[key] || 0);
export const FEATS = [
  { id: "chain6", name: "KEEP IT UP", text: "Make a chain of 6.", n: 6, prog: (a) => a.R.chain },
  { id: "contract5", name: "CONTRACTOR", text: "Complete 5 contracts.", n: 5, prog: (a) => a.sv.cdone },
  { id: "mods3", name: "TINKERER", text: "Own 3 modules.", n: 3, prog: (a) => a.sv.mods.length },
  { id: "storm", name: "EYE OF THE STORM", text: "Reach the Storm.", n: 5, prog: (a) => a.sv.far },
  { id: "mark2", name: "MARK II", text: "Overhaul the pod.", n: 1, prog: (a) => a.sv.mark },
  { id: "beyond", name: "PAST THE MAPS", text: "Reach the Beyond.", hint: "The storm is not the end.", n: 6, hidden: true, prog: (a) => a.sv.far },
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
// What earns a pod, in words: the text of its feat.
export const podNeed = (pod) => (FEATS.find((f) => f.id === pod.need)?.text || "").replace(/\.$/, "");
const FEAT_BOUNTY = 30;

// ---- helpers -------------------------------------------------------------------------------
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const FRNG = new Random(1); // the field's generator; its state lives on the app as plain data
const hashText = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const dateKey = (d = new Date()) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const roman = (n) => ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"][n] || String(n);
export const sweepAngle = (t) => A_LO + (A_HI - A_LO) * (0.5 - 0.5 * Math.cos((TAU * t) / SWEEP));
// Power after holding for `hold` seconds: up to the peak at RISE, then back down, repeating.
export function powerAt(hold) {
  const u = (hold / (2 * RISE)) % 1;
  return u < 0.5 ? 2 * u : 2 - 2 * u;
}
// Time until a falling pod at height y (px) with vertical speed vy reaches the ground, without drag.
export const timeToGround = (y, vy, g = G) => (vy + Math.sqrt(Math.max(0, vy * vy + 2 * g * Math.max(0, y)))) / g;
// Today's goal, the same for everyone on the same date. Every goal is within reach of the daily loadout.
export function dailyGoal(key) {
  const h = hashText("goal" + key), kind = h % 4, v = (h >>> 8) % 5;
  if (kind === 0) { const n = 200 + 25 * v; return { kind: "metres", n, text: "Fly " + n + " m." }; }
  if (kind === 1) { const n = 1 + (v % 3); return { kind: "perfect", n, text: "Make " + n + " perfect skip" + (n > 1 ? "s." : ".") }; }
  if (kind === 2) { const n = 1 + (v % 3); return { kind: "lifts", n, text: "Hit " + n + " pad" + (n > 1 ? "s, boosters or mines." : ", booster or mine.") }; }
  const n = 3 + 2 * v; return { kind: "scrap", n, text: "Collect " + n + " scrap." };
}

// Bring any stored shape to schema 3: nothing (a first launch), schema 1 (the first Ballista, an
// artillery game, whose record was written by recordRun: runs, last, milestone), schema 2 (the
// launcher before modules and contracts) or schema 3. Schema 2 gains empty module and contract
// fields, and three contracts are drawn.
// The first Ballista's runs carry over, its last record is kept as `legacy`, and each of its runs
// is worth a little salvage (at most 300) so a returning player starts with something to spend.
export function migrateSave(raw) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const v1 = r.schema !== 2 && r.schema !== 3 && (num(r.runs) > 0 || (r.last && typeof r.last === "object"));
  const st = r.st && typeof r.st === "object" ? r.st : {};
  const dl = r.dl && typeof r.dl === "object" ? r.dl : {};
  const int = (v) => Math.max(0, Math.floor(num(v)));
  const out = {
    schema: 3,
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
    seen: r.seen && typeof r.seen === "object" ? Object.fromEntries(Object.keys(INTRO).concat("skip", "chain").filter((k) => r.seen[k]).map((k) => [k, 1])) : {},
    mods: Array.isArray(r.mods) ? r.mods.filter((id, i) => MOD_IDS.includes(id) && r.mods.indexOf(id) === i) : [],
    eq: [],
    ct: [],
    cseed: Math.floor(num(r.cseed)) >>> 0 || 0x2545f491,
    cdone: int(r.cdone),
    chain: int(r.chain),
    mark: clamp(int(r.mark), 0, MARK_MAX),
  };
  out.eq = Array.isArray(r.eq) ? r.eq.filter((id, i) => out.mods.includes(id) && r.eq.indexOf(id) === i).slice(0, SLOTS + 1) : [];
  if (Array.isArray(r.ct)) for (const c of r.ct.slice(0, 3)) {
    if (c && CONTRACTS[c.k] && !out.ct.some((x) => x.k === c.k)) out.ct.push({ k: c.k, n: Math.max(1, int(c.n)), pay: int(c.pay), left: clamp(int(c.left ?? CONTRACT_RUNS), 1, CONTRACT_RUNS) });
  }
  while (out.ct.length < 3) out.ct.push(drawContract(out));
  if (v1) {
    const l = r.last && typeof r.last === "object" ? r.last : {};
    out.legacy = { runs: int(r.runs), score: int(l.score), stations: int(l.stations ?? r.milestone) };
  } else if (r.legacy && typeof r.legacy === "object") {
    out.legacy = { runs: int(r.legacy.runs), score: int(r.legacy.score), stations: int(r.legacy.stations) };
  }
  return out;
}

// Drawing tables: each zone's sky (top, horizon), its moon (x, y, radius, ring), the silhouette
// layers (parallax, cell width, line alpha, fill alpha, height), the stars and particle colours.
const SKIES = [["#060c09", "#13281b"], ["#0b0a06", "#2c2313"], ["#0c0706", "#2e1714"], ["#09060f", "#221735"], ["#050c0d", "#103032"], ["#08090b", "#262a31"], ["#0a0408", "#2a0f1e"]];
const MOONS = [[760, 110, 26, 0], [680, 90, 40, 1], [820, 130, 20, 0], [720, 80, 34, 1], [600, 120, 46, 0], [820, 70, 18, 0], [640, 110, 60, 1]];
const LAYERS = [[0.15, 150, 0.16, 0.6, 70], [0.45, 110, 0.28, 0.85, 34]];
const STARS = (() => { const r = new Random(1979), out = []; for (let i = 0; i < 70; i++) out.push(r.range(0, 960), r.range(0, 360), r.range(0.2, 1)); return out; })();
const PART_COLOURS = [C.red, C.amber, C.cyan, C.muted];
const CONTRACT_SHORT = { metres: "FLY", zone: "REACH", perfect: "PERFECT", lifts: "LIFTS", scrap: "SCRAP", chain: "CHAIN", pitskip: "SINKHOLE SKIP", beacons: "BEACONS", unaided: "NO THRUST" };
const SKY_CACHE = new WeakMap(); // one gradient per canvas and zone, made once
function sky(g, z) {
  let list = SKY_CACHE.get(g);
  if (!list) { list = []; SKY_CACHE.set(g, list); }
  if (!list[z]) {
    const gr = g.createLinearGradient(0, 0, 0, 540);
    gr.addColorStop(0, SKIES[z][0]);
    gr.addColorStop(1, SKIES[z][1]);
    list[z] = gr;
  }
  return list[z];
}

// Every line the workshop can show. Lines that do nothing yet stay hidden (see rows()), so a new
// save starts with nine; the five systems are always lines 1-5.
const WORKSHOP = ["LAUNCH", "BARREL", "THRUSTERS", "HULL", "FINS", "MAGNET", "OVERHAUL", "MODULES", "POD", "CONTRACTS", "DAILY", "LOG"];
const MODULES_AT = 10; // system levels bought before the modules line appears

// One line for this save's row in the console's SAVE SLOT menu (at most 24 characters): its mark,
// best distance and farthest zone, the zone dropped when the line is too long.
export function slotLabel(sv) {
  if (!sv.best) return sv.legacy ? "FIRST RANGE · REBUILT" : "NO RUNS YET";
  const mark = sv.mark ? "MK " + roman(sv.mark + 1) + " · " : "", head = mark + "BEST " + sv.best + " m";
  const full = head + " · " + ZONES[sv.far].roman;
  return (full.length <= 24 ? full : head).slice(0, 24);
}

export class Ballista {
  // Up to four saves, chosen in the system menu (engine/slots.js): each has its own workshop,
  // modules, marks and contracts. The console's best and logbook are shared.
  static saveSlots = true;
  constructor(ctx) {
    this.c = ctx;
    this.guard = new AppGuard(this, ctx); // takes back a menu gesture that reached the game (docs/ENGINE.md)
    this.t = 0;
    this.sv = migrateSave(ctx.progress?.());
    // On a day the console picks Ballista as one of its three, the order is the daily run's goal.
    if (ctx.today?.()) {
      ctx.daily?.("Daily run: " + dailyGoal(this.dayKey()).text);
      if (this.dailyDone()) ctx.dailyMet?.();
    }
    this.phase = "title";
    this.armed = false; // a press on a menu screen, waiting for its release
    this.pt = 0;
    this.view = "menu";
    this.cur = 0;
    this.daily = false;
    this.btn = false;
    this.charging = false;
    this.hold = 0;
    this.power = 0;
    this.peaked = false;
    this.toneK = -1;
    this.sq = []; // a short queue of notes: [time, hz, seconds, wave]
    this.parts = new Float32Array(MAX_PARTS * 6); // x, y, vx, vy, life, colour (world px)
    this.mcur = 0;
    this.partNext = 0;
    this.trail = new Float32Array(TRAIL * 2);
    this.trailN = 0;
    this.hudKey = "";
    this.boardKey = "";
    this.hintKey = "";
    this.notice = "";
    this.noticeT = 0;
    this.need = ""; // why a workshop purchase failed
    this.confirm = false; // an overhaul waiting for its second hold
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
    this.mods = this.daily ? [] : this.sv.eq.slice(0, this.slots());
    this.L = loadout(up, podIx, this.mods, this.daily ? 0 : this.sv.mark);
    this.fstate = this.daily ? (mixSeed(hashText("field" + this.dayKey())) || 1) : (Math.floor(this.c.rng.next() * 4294967296) || 1);
    this.p = { x: 0, y: PIVOT_Y, vx: 0, vy: 0, mode: "cannon", spin: 0 };
    this.sweepT = 0;
    this.angle = sweepAngle(0);
    this.runT = 0;
    this.kicks = this.L.kicks;
    this.skip = null; // { grade, t } an armed skip
    this.late = null; // { t, impact, vx } a plain touchdown a late press can still make a skip
    this.early = 0; // seconds left of the "too early" cue
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
    this.R = { m: 0, pads: 0, lifts: 0, perfect: 0, good: 0, mines: 0, pitskip: 0, scrap: 0, thrusts: 0, alt: 0, iceRoll: 0, kite: 0, beacons: 0, bounces: 0, daily: 0, chain: 0 };
    this.kiteRun = 0;
    this.iceAcc = 0;
    this.zoneBonus = 0;
    this.chain = 0; // links since the last plain landing
    this.chainT = 0;
    this.shell = this.L.shell;
    this.shake = 0;
    this.kickT = 0;
    this.rings = []; // shock rings: { x, y, t, c } in world px
    this.best0 = this.bestRef();
  }
  slots() { return SLOTS + (this.sv.mods.length >= SLOT3_MODS ? 1 : 0); }
  // Pads, boosters, mines, beacons and perfect skips add a link; a plain landing ends the chain.
  link() {
    this.chain++;
    this.chainT = 1.6;
    this.R.chain = Math.max(this.R.chain, this.chain);
    if (this.chain >= 2) this.note(0.08, 523 * Math.pow(2, Math.min(this.chain, 12) / 12), 0.06, "sine");
    if (this.chain === 2 && !this.sv.seen.chain) { this.sv.seen.chain = 1; this.notice = "A CHAIN: KEEP OFF THE PLAIN GROUND FOR MORE SALVAGE."; this.noticeT = 3; }
  }
  unlink() {
    if (this.chain >= 3) this.c.tone(220, 0.08, "triangle");
    this.chain = 0;
  }
  ring(x, y, c) {
    if (this.rings.length >= 6) this.rings.shift();
    this.rings.push({ x, y, t: 0, c });
  }
  dayKey() { return dateKey(); }
  // A pod is earned by one feat, named on the POD line (the feat list itself is the console's).
  nextPod() { return PODS.find((x, i) => i > 0 && !this.unlockedPod(i)) || null; }
  unlockedPod(i) { return i === 0 || (!!PODS[i] && this.sv.ft.includes(PODS[i].need)); }
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
  spawnAhead(ahead = 1400) {
    const p = this.p;
    let guard = 0;
    while (this.nextX < p.x + ahead && guard++ < 40 && this.features.length < MAX_FEATURES) {
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
    this.lightsDown();
  }
  pause() {
    this.guard.settle();
    this.cancelCharge();
    this.lightsDown();
  }
  resume() {
    this.btn = false;
    this.armed = false;
  }
  dispose() {
    this.guard.settle();
    this.cancelCharge();
    this.lightsDown();
  }
  // Every lamp dark, and the board LED too.
  lightsDown() {
    this.c.leds(lightsOff(this.c.lampCount?.() === 4 ? 4 : 3));
    if (this.boardKey && this.boardKey !== "0,0,0") { this.boardKey = ""; this.c.board?.([0, 0, 0]); }
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
    if (this.late && this.late.t <= LATE_WIN) { this.lateSkip(); return; }
    const tti = this.skipWindow();
    if (tti < 0 && this.landIn() >= 0) { // a little early: nothing yet, press again
      this.early = 0.5;
      this.c.tone(560, 0.03, "sine");
      return;
    }
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
    this.kickT = 0.3;
    this.burst(p.x - 6, p.y + R, 6, 120, 1);
    this.flash = 0.12;
    this.flashCol = "amber";
    this.c.tone(196, 0.12, "sawtooth");
    this.note(0.05, 294, 0.1, "triangle");
  }
  // Seconds until touchdown when a press now would be a skip, or -1.
  skipWindow() {
    const tti = this.landIn();
    return tti >= 0 && tti <= SKIP_WIN ? tti : -1;
  }
  // Seconds until a skippable touchdown within the window or a little before it, or -1.
  landIn() {
    const p = this.p;
    if (p.mode !== "air" || p.vy > -BOUNCE_VY * 1.3) return -1;
    const tti = timeToGround(p.y, p.vy, this.L.g);
    return tti <= SKIP_WIN + EARLY_WIN ? tti : -1;
  }
  // A press just after a plain touchdown: redo that bounce as a good skip.
  lateSkip() {
    const p = this.p, L = this.L, late = this.late;
    this.late = null;
    p.vx = Math.max(p.vx, late.vx * Math.max(L.keep, GOOD_KEEP));
    p.vy = Math.max(p.vy, late.impact * Math.min(SKIP_E_CAP, L.e + GOOD_E));
    p.y = Math.max(p.y, 0.5);
    p.mode = "air";
    this.R.good++;
    this.flash = 0.15; this.flashCol = "cyan";
    this.c.tone(620, 0.07, "triangle");
    this.notice = "LATE SKIP";
    this.noticeT = 0.8;
  }
  startRun(daily) {
    this.daily = daily;
    this.resetRun();
    this.phase = "aim";
    this.reach = this.carry(42, 1); // the farthest first landing, about: the aim screen shows the field to there
    this.spawnAhead(Math.max(1400, this.reach + 400));
    this.setHint("AIM", "PRESS TO FIX THE ANGLE. HOLD TO CHARGE, RELEASE TO FIRE.");
    this.hudNow();
  }
  // Where a shot at this angle and power first lands (px), in still air.
  carry(angle, power) {
    const a = (angle * Math.PI) / 180, v = this.L.vmax * (0.3 + 0.7 * power), L = this.L;
    let x = Math.cos(a) * BARREL, y = PIVOT_Y + Math.sin(a) * BARREL, vx = Math.cos(a) * v, vy = Math.sin(a) * v;
    for (let i = 0; i < 1200 && (y > 0 || vy > 0); i++) {
      const k = L.drag * Math.hypot(vx, vy);
      vx = Math.max(0, vx - k * vx * STEP);
      vy -= (L.g + k * vy) * STEP;
      x += vx * STEP;
      y += vy * STEP;
    }
    return x;
  }
  // A finished press on the title, result or workshop screen.
  menuPress(dur) {
    const long = dur >= HOLD_PICK;
    if (this.phase === "title" || this.phase === "over") {
      if (long) this.openShop();
      else this.startRun(false);
      return;
    }
    if (this.view === "mods") {
      if (!long) { this.mcur = (this.mcur + 1) % (MODULES.length + 1); this.need = ""; this.c.tone(420, 0.02, "sine"); }
      else this.modChoose();
      return;
    }
    if (this.view !== "menu") {
      this.view = "menu";

      return;
    }
    if (!long) { this.cur = (this.cur + 1) % this.rows().length; this.need = ""; this.confirm = false; this.c.tone(420, 0.02, "sine"); return; }
    this.shopChoose();
  }
  openShop() {
    this.phase = "shop";
    this.view = "menu";
    this.cur = this.affordable() >= 0 ? 1 + this.affordable() : 0;
    this.need = "";
    this.setHint("SHOP", "TAP: NEXT LINE. HOLD: CHOOSE.");
    this.hudNow();
  }
  // The workshop's lines for this save: the overhaul once it can be done, modules once the systems
  // are well along (or one is built), the pod once there is a second to choose.
  rows() {
    const sv = this.sv, levels = sv.up.reduce((a, b) => a + b, 0);
    return WORKSHOP.filter((id) =>
      id === "OVERHAUL" ? levels >= UP_MAX * UPGRADES.length && sv.mark < MARK_MAX
        : id === "MODULES" ? levels >= MODULES_AT || sv.mods.length > 0 || sv.mark > 0
          : id === "POD" ? this.unlockedPod(1) : true);
  }
  // The first system whose next level can be bought now, or -1.
  affordable() {
    for (let i = 0; i < UPGRADES.length; i++) {
      const L = this.sv.up[i];
      if (L < UP_MAX && upCost(i, L, this.sv.mark) <= this.sv.salvage) return i;
    }
    return -1;
  }
  shopChoose() {
    const row = this.rows()[this.cur], sv = this.sv;
    if (row === "LAUNCH") { this.startRun(false); return; }
    if (row === "DAILY") { this.startRun(true); return; }
    if (row === "LOG") { this.view = "log"; return; }
    if (row === "CONTRACTS") { this.view = "contracts"; return; }
    if (row === "MODULES") { this.view = "mods"; this.mcur = 0; this.need = ""; return; }
    if (row === "OVERHAUL") { this.overhaul(); return; }
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
    const cost = upCost(ui, L, sv.mark);
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

  // Every system at V: the first hold asks, a second one strips them and raises the mark.
  overhaul() {
    const sv = this.sv;
    if (sv.mark >= MARK_MAX) { this.need = "THE POD IS AT ITS LAST MARK."; return; }
    if (sv.up.some((L) => L < UP_MAX)) { this.need = "EVERY SYSTEM MUST BE AT V FIRST."; this.c.tone(150, 0.08, "square"); return; }
    if (!this.confirm) { this.confirm = true; this.need = "HOLD AGAIN: SYSTEMS BACK TO NOTHING, MARK " + roman(sv.mark + 2) + " FOR GOOD."; this.c.tone(440, 0.06, "triangle"); return; }
    this.confirm = false;
    sv.mark++;
    sv.up = sv.up.map(() => 0);
    this.cur = 0; // the overhaul line is gone until the systems are full again
    this.need = "MARK " + roman(sv.mark + 1) + ". LAUNCH +" + Math.round(100 * MARK_SPEED * sv.mark) + "%, SALVAGE +" + Math.round(100 * MARK_SALVAGE * sv.mark) + "%.";
    [392, 523, 659, 784].forEach((hz, i) => this.note(0.1 * i, hz, 0.18, "triangle"));
    this.checkFeats();
    this.persist();
    this.hudNow();
  }
  // A module: buy it if it is not owned, otherwise fit or remove it. The last line goes back.
  modChoose() {
    const sv = this.sv, m = MODULES[this.mcur];
    if (!m) { this.view = "menu"; this.need = ""; return; }
    if (!sv.mods.includes(m.id)) {
      if (sv.salvage < m.cost) { this.need = "NEED " + (m.cost - sv.salvage) + " MORE SALVAGE."; this.c.tone(150, 0.08, "square"); return; }
      sv.salvage -= m.cost;
      sv.mods.push(m.id);
      if (sv.eq.length < this.slots()) sv.eq.push(m.id);
      this.need = m.name + " BUILT" + (sv.eq.includes(m.id) ? " AND FITTED." : ". SLOTS FULL.");
      this.note(0, 523, 0.08, "triangle"); this.note(0.08, 659, 0.08, "triangle"); this.note(0.16, 784, 0.14, "triangle");
      this.checkFeats();
    } else if (sv.eq.includes(m.id)) {
      sv.eq = sv.eq.filter((id) => id !== m.id);
      this.need = m.name + " REMOVED.";
      this.c.tone(330, 0.05, "triangle");
    } else if (sv.eq.length >= this.slots()) {
      this.need = "ALL " + this.slots() + " SLOTS ARE FULL. REMOVE ONE FIRST.";
      this.c.tone(150, 0.08, "square");
      return;
    } else {
      sv.eq.push(m.id);
      this.need = m.name + " FITTED.";
      this.c.tone(660, 0.05, "triangle");
    }
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
    if (this.c.hasBoardLed?.()) {
      const b = this.boardValue(), key = b.join(",");
      if (key !== this.boardKey) { this.boardKey = key; this.c.board?.(b); }
    }
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
    if (this.kickT > 0) this.kickT -= step;
    if (this.chainT > 0) this.chainT -= step;
    if (this.skip) { this.skip.t += step; if (this.skip.t > 0.5) this.skip = null; }
    if (this.late && (this.late.t += step) > LATE_WIN) this.late = null;
    if (this.early > 0) this.early -= step;
    if (p.mode === "air") {
      const v = Math.hypot(p.vx, p.vy), k = L.drag * v;
      let ax = -k * p.vx, ay = -L.g - k * p.vy;
      for (const f of this.features) {
        if (f.x > p.x) break;
        if (f.k === "updraft" && p.x <= f.x + f.w && p.y < 900) ay += 1000;
        else if (f.k === "gust" && p.x <= f.x + f.w) ax += L.sail ? Math.abs(f.a) : f.a;
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
          if (this.L.cutter) { this.c.tone(1600, 0.04, "square"); this.burst(f.x, p.y, 6, 120, 0); continue; }
          p.vx *= 0.35;
          p.vy *= 0.4;
          this.unlink();
          this.flash = 0.25; this.flashCol = "red";
          this.shake = 0.15;
          this.c.tone(200, 0.12, "square");
        }
      } else if (f.k === "beacon") {
        if (Math.hypot(p.x - f.x, cy - f.y) < f.h + R + 4) {
          f.used = 1;
          p.vy = Math.max(p.vy, 380);
          this.kicks = Math.min(this.L.kicks, this.kicks + this.L.relay);
          this.R.beacons++;
          this.link();
          this.ring(f.x, f.y, 2);
          this.kiteRun++;
          this.R.kite = Math.max(this.R.kite, this.kiteRun);
          this.flash = 0.2; this.flashCol = "amber";
          this.c.tone(988, 0.1, "sine");
          this.burst(f.x, f.y, 6, 90, 1);
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
    this.late = null;
    this.early = 0;
    p.y = 0;
    this.kiteRun = 0;
    const impact = -p.vy, vx0 = p.vx;
    if (f && f.k === "pit") {
      if (skip) { this.R.pitskip++; this.bounce(impact, Math.min(SKIP_E_CAP, L.e + 0.2), 0.95, skip.grade); return; }
      if (this.shell > 0) {
        this.shell--;
        this.notice = "THE SHELL TAKES IT. NEXT TIME IT WON'T.";
        this.noticeT = 2;
        this.shake = 0.25;
        this.burst(p.x, 0, 10, 160, 2);
        this.bounce(Math.max(impact, 300), 0.6, 0.85, "good");
        return;
      }
      this.finish("pit");
      return;
    }
    if (f && this.lift(f, impact)) return;
    if (!skip && impact >= BOUNCE_VY * 1.3) this.late = { t: 0, impact, vx: vx0 };
    if (impact < BOUNCE_VY && !skip) { p.vy = 0; p.mode = "roll"; this.unlink(); return; }
    let e = L.e, keep = L.keep;
    const drift = f && f.k === "drift" && !L.skids;
    if (drift) { e *= 0.35; keep *= 0.6; }
    if (f && f.k === "ice") { e *= 1.08; keep = 1; }
    if (skip) { // a skip keeps more of both: a perfect one gains speed, more along a chain
      const perfect = skip.grade === "perfect";
      e = Math.min(SKIP_E_CAP, L.e + (perfect ? PERFECT_E : GOOD_E));
      keep = perfect ? PERFECT_KEEP + CHAIN_KEEP * Math.min(this.chain, CHAIN_KEEP_MAX) : Math.max(keep, GOOD_KEEP);
    }
    this.bounce(impact, e, keep, skip ? skip.grade : "");
    if (!skip) this.unlink();
    this.burst(p.x, 0, impact > 300 ? 6 : 3, 60 + impact * 0.15, drift ? 1 : 3);
    if (drift && !skip) { this.flash = 0.2; this.flashCol = "red"; this.c.tone(150, 0.1, "triangle"); }
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
      this.burst(p.x, 0, 6, 110, 2);
      this.ring(p.x, 0, 2);
      this.link();
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
      p.vy = clamp(Math.max(impact * 0.95, PAD_V) * this.L.pad, 0, 1000);
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
      this.burst(p.x, 0, 14, 220, 0);
      this.ring(p.x, 0, 0);
      this.shake = 0.35;
    } else return false;
    f.hit = this.t;
    this.late = null;
    this.R.lifts++;
    this.link();
    if (f.k !== "mine") this.shake = Math.max(this.shake, 0.1);
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
    const kind = f && ((f.k === "drift" && !this.L.skids) || f.k === "ice") ? f.k : "ground";
    let ax = -FRICTION[kind] * (kind === "ice" ? 1 : this.L.roll);
    for (const g of this.features) {
      if (g.x > p.x) break;
      if (g.k === "updraft" && p.x <= g.x + g.w) { p.mode = "air"; p.vy = 160; return; }
      if (g.k === "gust" && p.x <= g.x + g.w) ax += (this.L.sail ? Math.abs(g.a) : g.a) * 0.5;
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
    if (this.noticeT > 0.4 || this.sy(0) > 500) return; // only while the ground is in view
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
        this.R.daily = 1;
        this.guard.hold("dailyMet", () => this.c.dailyMet?.()); // today's order on the console, if Ballista is one
      }
    } else {
      sv.best = Math.max(sv.best, metres);
      sv.pb[this.podIx] = Math.max(sv.pb[this.podIx] || 0, metres);
    }
    sv.chain = Math.max(sv.chain, this.R.chain);
    // contracts: every one this run met is paid and replaced (daily runs take none)
    const done = [];
    let pay = 0;
    if (!this.daily) for (let i = 0; i < sv.ct.length; i++) {
      const c = sv.ct[i];
      if (contractProgress(c, this.R) < c.n) {
        if (--c.left <= 0) { sv.ct.splice(i, 1); sv.ct.splice(i, 0, drawContract(sv)); } // withdrawn
        continue;
      }
      done.push(contractText(c));
      pay += c.pay;
      sv.cdone++;
      sv.ct.splice(i, 1);
      sv.ct.splice(i, 0, drawContract(sv));
    }
    const before = sv.ft.length;
    this.checkFeats();
    const bounty = (sv.ft.length - before) * FEAT_BOUNTY + this.zoneBonus + (this.R.daily ? 60 : 0) + pay;
    this.zoneBonus = 0;
    const mult = chainMult(this.R.chain) * this.L.rig;
    const earned = salvageFor(metres, this.R.scrap, this.L.scrap, mult) + bounty;
    sv.salvage += earned;
    sv.milestone = Math.max(sv.milestone, Math.floor(sv.best / 100));
    this.result = { metres, salvage: earned, bounty, contracts: done, chain: this.R.chain, mult, pads: this.R.lifts, skips: this.R.perfect, scrap: this.R.scrap, reason: why === "pit" ? "SWALLOWED BY A SINKHOLE" : why === "cap" ? "SIGNAL LOST" : "CAME TO REST", zone: ZONES[zoneAt(metres)].name };
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
        this.guard.hold("feat", () => this.c.feat?.(f.id, f.name)); // the console's logbook keeps the list
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
    this.c.saveProgress?.(JSON.parse(JSON.stringify(this.sv)), { label: slotLabel(this.sv) })?.catch?.(this.c.error);
  }
  // The slot row's line for any stored save, when the console has no saved label for it.
  slotSummary(value) { return slotLabel(migrateSave(value)); }
  // What to aim for next: the cheapest upgrade, the next pod, and the feat nearest its goal.
  nextGoal() {
    const sv = this.sv, lines = [];
    let cheap = -1;
    for (let i = 0; i < UPGRADES.length; i++) if (sv.up[i] < UP_MAX && (cheap < 0 || upCost(i, sv.up[i], sv.mark) < upCost(cheap, sv.up[cheap], sv.mark))) cheap = i;
    if (cheap < 0 && sv.mark < MARK_MAX) lines.push("WORKSHOP: EVERY SYSTEM AT V. AN OVERHAUL IS READY.");
    if (cheap >= 0) {
      const cost = upCost(cheap, sv.up[cheap], sv.mark);
      lines.push(cost <= sv.salvage ? "WORKSHOP: " + UPGRADES[cheap].name + " " + roman(sv.up[cheap] + 1) + " IS READY (" + cost + ")" : "NEXT: " + UPGRADES[cheap].name + " " + roman(sv.up[cheap] + 1) + " AT " + cost + " SALVAGE");
    }
    const pod = this.nextPod();
    if (pod) lines.push("NEXT POD: " + pod.name + ". " + podNeed(pod).toUpperCase());
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
  // colour: 0 red, 1 amber, 2 cyan, 3 dust
  burst(x, y, n, speed, colour = 1) {
    for (let i = 0; i < n; i++) {
      const k = this.partNext++ % MAX_PARTS, o = k * 6, a = (i / n) * Math.PI + 0.1;
      this.parts[o] = x; this.parts[o + 1] = y;
      this.parts[o + 2] = Math.cos(a) * speed * (0.5 + (i % 3) * 0.25);
      this.parts[o + 3] = Math.sin(a) * speed * (0.5 + (i % 3) * 0.25);
      this.parts[o + 4] = 0.6;
      this.parts[o + 5] = colour;
    }
    this.partNext %= MAX_PARTS;
  }
  stepParts(dt) {
    for (let k = 0; k < MAX_PARTS; k++) {
      const o = k * 6;
      if (this.parts[o + 4] <= 0) continue;
      this.parts[o] += this.parts[o + 2] * dt;
      this.parts[o + 1] = Math.max(0, this.parts[o + 1] + this.parts[o + 3] * dt);
      this.parts[o + 3] -= G * 0.6 * dt;
      this.parts[o + 4] -= dt;
    }
    for (const r of this.rings) r.t += dt;
    while (this.rings.length && this.rings[0].t > 0.6) this.rings.shift();
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt);
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
      : [["BEST", this.sv.best + " m"], ["SALVAGE", this.sv.salvage], ["MARK", roman(this.sv.mark + 1)]];
    const key = items.map((x) => x[1]).join("|");
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.c.hud(items);
  }

  // ---- lamps -------------------------------------------------------------------------------------
  // Aiming: a spot that follows the barrel (left low, right high). Charging: a meter that fills
  // green, amber, red. Flight: left = height, next = speed in the zone's colour (whiter as a chain
  // grows), next = thrusters left. On three lamps a coming touchdown turns all of them cyan,
  // brightest at the perfect moment, and a sinkhole close ahead of a low pod blinks the middle red.
  // A fourth lamp, when the node has one, is the landing lamp: what the pod will come down on and
  // when to press. While aiming it shows where this shot lands (cyan on a pad, booster or mine, red
  // on a sinkhole); in flight it carries the skip cue, rising to white at the perfect moment (then
  // all four flash), and blinks red for a sinkhole ahead, so the other three stay instruments.
  lampValues() {
    const n = this.c.lampCount?.() === 4 ? 4 : 3, four = n === 4;
    const ph = this.phase;
    if (ph === "title" || ph === "shop") return spot(0.5 + 0.5 * Math.sin(this.t * 0.8), dim(ZONES[this.sv.far].col, 0.12), 0.75, n);
    if (ph === "over") {
      if (this.deadT < 1) return this.reason === "pit" ? fill(LAMP.red, 0.35 * (1 - this.deadT), n) : fill(LAMP.amber, 0.2 * (1 - this.deadT), n);
      if (this.newRecord) return fill(LAMP.cyan, 0.06 + 0.1 * pulse(this.t, 0.5), n);
      return spot(0.5 + 0.5 * Math.sin(this.t * 0.5), dim(ZONES[this.zone].col, 0.07), 0.75, n);
    }
    if (ph === "aim") {
      const land = four ? this.landLamp(this.groundAt(this.carry(this.angle, this.charging ? this.power : 1))) : null;
      if (this.charging) {
        const col = ramp(this.power, [LAMP.green, LAMP.amber, LAMP.red]);
        if (this.flash > 0) return fill(LAMP.white, 0.6, n);
        const bar = meter(Math.max(0.04, this.power), dim(col, 0.45));
        return four ? [...bar, ...land] : bar;
      }
      const aim = spot((this.angle - A_LO) / (A_HI - A_LO), dim(LAMP.amber, 0.3), 0.75, 3);
      return four ? [...aim, ...land] : aim;
    }
    if (this.flash > 0) {
      const col = { white: LAMP.white, red: LAMP.red, amber: LAMP.amber, cyan: LAMP.cyan }[this.flashCol] || LAMP.white;
      return fill(col, 0.25 + 1.2 * this.flash, n);
    }
    const p = this.p, tti = this.skipWindow(), cue = tti >= 0 && !this.skip;
    const perfect = cue && tti <= this.L.perfect, near = cue ? 1 - tti / SKIP_WIN : 0;
    if (perfect) return fill(blend(LAMP.cyan, LAMP.white, 0.5), 0.6, n);
    if (cue && !four) return fill(LAMP.cyan, 0.08 + 0.25 * near, 3);
    const height = clamp(p.y / 400, 0, 1), speed = clamp(Math.hypot(p.vx, p.vy) / 900, 0, 1);
    const left = dim(LAMP.blue, 0.04 + 0.36 * height);
    let mid = dim(blend(ZONES[this.zone].col, LAMP.white, Math.min(this.chain, 10) / 12), 0.06 + 0.32 * speed); // whiter as a chain grows
    const pit = this.pitAhead();
    if (pit && !four) mid = blink(this.runT, 6) ? dim(LAMP.red, 0.45) : [0, 0, 0];
    const right = this.kicks > 0 ? dim(LAMP.amber, 0.06 + 0.3 * (this.kicks / this.L.kicks)) : null;
    if (!four) return lamps(left, mid, right);
    let landing = null;
    if (cue) landing = dim(LAMP.cyan, 0.15 + 0.35 * near);
    else if (pit) landing = blink(this.runT, 6) ? dim(LAMP.red, 0.45) : null;
    else if (p.mode === "air") landing = this.landLamp(this.groundAt(p.x + p.vx * timeToGround(p.y, p.vy, this.L.g)), 0.5);
    return lamps(left, mid, right, landing);
  }
  // The landing lamp's colour for the ground feature a shot comes down on.
  landLamp(f, level = 1) {
    if (f && f.k === "pit") return dim(LAMP.red, 0.4 * level);
    if (f && (f.k === "pad" || f.k === "boost" || f.k === "mine")) return dim(LAMP.cyan, 0.3 * level);
    if (f && f.k === "drift") return dim(LAMP.amber, 0.12 * level);
    return dim(LAMP.white, 0.03 * level);
  }
  // The board LED, when the node has one, is an accent for chains: dark until a chain of two,
  // then the zone's colour whitening as it grows, and a red flash when a sinkhole takes the pod.
  boardValue() {
    if (this.phase === "over" && this.reason === "pit" && this.deadT < 0.6) return dim(LAMP.red, 0.5);
    if (this.phase !== "fly" || this.chain < 2) return [0, 0, 0];
    return dim(blend(ZONES[this.zone].col, LAMP.white, Math.min(this.chain, 10) / 10), 0.12 + 0.03 * Math.min(this.chain, 8));
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
  // Layers from the back: the zone's sky (a cached gradient), stars and a moon, far silhouettes, near
  // props, the ground, the field, the pod and its effects, the weather, then the screens on top.
  sx(x) { return SX0 + x - this.camX; }
  sy(y) { return GY - (y - this.camY); }
  // The zone the camera looks at, and how far it has faded into the next one (the last 60 m).
  viewZone() {
    if (this.phase === "title" || this.phase === "shop") return [this.sv.far, 0];
    const m = (this.camX + 360) / M, z = zoneAt(m), next = ZONES[z + 1];
    return [z, next ? clamp((m - next.from + 60) / 60, 0, 1) : 0];
  }
  draw(g) {
    const [z, fade] = this.viewZone();
    g.save();
    if (this.shake > 0) g.translate(Math.sin(this.t * 91) * this.shake * 22, Math.cos(this.t * 77) * this.shake * 14);
    g.fillStyle = sky(g, z);
    g.fillRect(-30, -30, 1020, 600);
    if (fade > 0) { g.globalAlpha = fade; g.fillStyle = sky(g, z + 1); g.fillRect(-30, -30, 1020, 600); g.globalAlpha = 1; }
    this.drawSky(g, z);
    this.drawFar(g, fade > 0.5 ? z + 1 : z);
    this.drawGround(g);
    this.drawFeatures(g);
    this.drawMarks(g);
    this.drawCannon(g);
    this.drawPod(g);
    this.drawParts(g);
    this.drawWeather(g, fade > 0.5 ? z + 1 : z);
    g.restore();
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
  // Stars that drift slowly, and each zone's moon.
  drawSky(g, z) {
    const shift = this.camX * 0.03, lift = this.camY * 0.05;
    g.fillStyle = C.muted;
    for (let i = 0; i < STARS.length; i += 3) {
      g.globalAlpha = STARS[i + 2] * (z === 5 ? 0.3 : 0.7);
      g.fillRect((STARS[i] - shift + 9600) % 960, STARS[i + 1] + lift, 2, 2);
    }
    g.globalAlpha = 1;
    const moon = MOONS[z], mx = moon[0] - this.camX * 0.01, my = moon[1] + lift;
    g.globalAlpha = 0.5;
    circle(g, mx, my, moon[2], ZONES[z].ink, false, 2);
    g.beginPath(); g.arc(mx + moon[2] * 0.3, my - moon[2] * 0.2, moon[2] * 0.85, 0, TAU); g.fillStyle = sky(g, z); g.fill();
    if (moon[3]) { g.beginPath(); g.ellipse(mx, my, moon[2] * 1.8, moon[2] * 0.35, -0.3, 0, TAU); g.strokeStyle = ZONES[z].ink; g.lineWidth = 1.5; g.stroke(); }
    g.globalAlpha = 1;
  }
  // Two silhouette layers in the zone's own shapes: far (slow) and near (faster).
  drawFar(g, z) {
    const base = this.sy(0) + this.camY * 0.7;
    if (base < -60) return;
    const ink = ZONES[z].ink;
    for (const [par, cell, alpha, fillA, h0] of LAYERS) {
      const i0 = Math.floor((this.camX * par) / cell) - 1, off = this.camX * par;
      g.beginPath();
      g.moveTo(-40, base);
      for (let i = i0; i < i0 + Math.ceil(1040 / cell) + 2; i++) {
        const h = mixSeed(i * 7919 + z * 131 + cell), x = i * cell - off, top = base - h0 - ((h >>> 5) % h0);
        if (z === 0) { g.lineTo(x + cell * 0.5, top * 0.4 + base * 0.6); g.lineTo(x + cell, base - 10); } // low hills
        else if (z === 1) g.quadraticCurveTo(x + cell * 0.5, top, x + cell, base - 6); // dunes
        else if (z === 2) { g.lineTo(x + cell * 0.25, top); g.quadraticCurveTo(x + cell * 0.5, top + 30, x + cell * 0.75, top); g.lineTo(x + cell, base - 6); } // crater rims
        else if (z === 3) { g.lineTo(x + cell * 0.42, base - 10); g.lineTo(x + cell * 0.5, top - h0 * 1.2); g.lineTo(x + cell * 0.58, base - 10); g.lineTo(x + cell, base - 8); } // spires
        else if (z === 4) { g.lineTo(x + cell * 0.3, top); g.lineTo(x + cell * 0.45, base - 20); g.lineTo(x + cell * 0.6, top - 30); g.lineTo(x + cell, base - 8); } // shards
        else if (z === 5) { g.lineTo(x + cell * 0.5, top + 20); g.lineTo(x + cell, base - 12); } // storm-worn
        else { g.lineTo(x + cell * 0.2, top); g.lineTo(x + cell * 0.35, top + 25); g.lineTo(x + cell * 0.5, top - 40); g.lineTo(x + cell * 0.7, top + 10); g.lineTo(x + cell, base - 14); } // broken teeth
      }
      g.lineTo(1000, base + 40);
      g.lineTo(-40, base + 40);
      g.closePath();
      g.globalAlpha = fillA;
      g.fillStyle = "#050a07";
      g.fill();
      g.globalAlpha = alpha;
      g.strokeStyle = ink;
      g.lineWidth = 2;
      g.stroke();
    }
    g.globalAlpha = 1;
    if (z === 4) { // glints on the glass
      g.fillStyle = C.cyan;
      for (let i = 0; i < 6; i++) {
        const k = (i * 157 + Math.floor(this.t * 2)) % 960;
        g.globalAlpha = 0.5 * pulse(this.t + i, 0.7);
        g.fillRect((k - this.camX * 0.45 % 960 + 960) % 960, base - 30 - (i * 23) % 70, 3, 3);
      }
      g.globalAlpha = 1;
    }
  }
  // Rain in the storm, and streaks when the pod is fast.
  drawWeather(g, z) {
    if (z === 5 && this.phase !== "shop") {
      g.strokeStyle = C.muted;
      g.globalAlpha = 0.35;
      g.lineWidth = 1.5;
      g.beginPath();
      for (let i = 0; i < 40; i++) {
        const x = (i * 97 + this.t * 700 - this.camX * 0.8) % 1100, y = (i * 53 + this.t * 900) % 600;
        const xx = ((x % 1100) + 1100) % 1100 - 70;
        g.moveTo(xx, y - 20); g.lineTo(xx - 10, y + 6);
      }
      g.stroke();
      if (blink(this.t, 0.13) && pulse(this.t, 3.1) > 0.97) { g.globalAlpha = 0.12; g.fillStyle = C.ink; g.fillRect(-30, -30, 1020, 600); } // lightning
      g.globalAlpha = 1;
    }
    if (this.phase !== "fly") return;
    const v = Math.hypot(this.p.vx, this.p.vy);
    if (v < 650) return;
    g.strokeStyle = C.ink;
    g.globalAlpha = clamp((v - 650) / 600, 0, 0.4);
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i < 7; i++) {
      const y = 60 + ((i * 71 + Math.floor(this.runT * 3)) % 400), x = 960 - ((this.runT * 1400 + i * 173) % 1100);
      g.moveTo(x, y); g.lineTo(x + 50, y);
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
    g.fillStyle = "#0a120d";
    g.fillRect(-30, y, 1020, 600 - y);
    // pebbles that move with the ground
    g.fillStyle = C.line;
    const step = 37, o = this.camX % step;
    for (let i = -1; i < 28; i++) {
      const h = (Math.floor((this.camX + i * step) / step) * 2654435761) >>> 0;
      g.fillRect(i * step - o + (h % 20), y + 8 + (h >>> 8) % 40, 3, 2);
    }
    line(g, -30, y, 990, y, ZONES[this.viewZone()[0]].ink + "99", 2);
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
        const sq = f.hit !== undefined && this.t - f.hit < 0.35 ? Math.sin(((this.t - f.hit) / 0.35) * Math.PI) : 0;
        const top = gy - 12 + 8 * sq;
        g.fillStyle = "#123a35"; g.fillRect(x, top - 3, w, 4);
        line(g, x, top - 3, x + w, top - 3, C.cyan, 3);
        g.strokeStyle = C.cyan; g.lineWidth = 2; g.beginPath();
        for (let i = 0; i <= 8; i++) { const zx = x + 4 + i * ((w - 8) / 8); if (i) g.lineTo(zx, i % 2 ? gy : top); else g.moveTo(zx, top); }
        g.stroke();
      } else if (f.k === "boost") {
        g.fillStyle = "#1f2a14"; g.fillRect(x, gy - 4, w, 4);
        line(g, x, gy - 4, x + w, gy - 4, C.ink, 2);
        const phase = (this.t * 3) % 1;
        for (let i = 0; i < 3; i++) {
          const cx = x + 12 + i * 26, on = Math.floor(phase * 3) === i;
          line(g, cx, gy - 18, cx + 10, gy - 10, on ? C.ink : C.muted, on ? 3 : 2); line(g, cx + 10, gy - 10, cx, gy - 2, on ? C.ink : C.muted, on ? 3 : 2);
        }
      } else if (f.k === "mine") {
        if (f.used) { g.fillStyle = "#050806"; g.beginPath(); g.ellipse(x + w / 2, gy + 2, 22, 6, 0, 0, TAU); g.fill(); continue; }
        g.beginPath(); g.arc(x + w / 2, gy, 12, Math.PI, 0); g.fillStyle = "#2a1210"; g.fill(); g.strokeStyle = C.red; g.lineWidth = 2; g.stroke();
        line(g, x + w / 2, gy - 12, x + w / 2, gy - 18, C.red, 2);
        circle(g, x + w / 2, gy - 20, 3, blink(this.t, 2) ? C.red : C.dark, true);
      } else if (f.k === "drift") {
        g.fillStyle = "#3a2f1f";
        g.beginPath(); g.moveTo(x, gy); g.quadraticCurveTo(x + w / 2, gy - 14, x + w, gy); g.closePath(); g.fill();
        for (let i = 10; i < w - 10; i += 20) line(g, x + i, gy - 4 - 6 * Math.sin((i / w) * Math.PI), x + i + 8, gy - 7 - 6 * Math.sin((i / w) * Math.PI), C.amber, 1.5);
      } else if (f.k === "ice") {
        g.fillStyle = "#14302f"; g.fillRect(x, gy - 3, w, 5);
        line(g, x, gy - 3, x + w, gy - 3, C.cyan, 3);
        const glint = ((this.t * 160) % (w + 80)) - 40;
        if (glint > 0 && glint < w) line(g, x + glint, gy - 3, x + glint + 18, gy - 3, C.ink, 4);
      } else if (f.k === "pit") {
        g.fillStyle = "#000"; g.beginPath(); g.moveTo(x, gy); g.lineTo(x + 10, gy + 40); g.lineTo(x + w - 10, gy + 40); g.lineTo(x + w, gy); g.closePath(); g.fill();
        line(g, x, gy, x + 10, gy + 30, C.red, 2); line(g, x + w, gy, x + w - 10, gy + 30, C.red, 2);
        for (let i = 6; i < w; i += 14) line(g, x + i, gy, x + i + 4, gy - 6, C.red, 1.5); // a warning fringe
      } else if (f.k === "net") {
        const top = this.sy(f.h);
        if (f.used) { line(g, x, gy, x, gy - 10, C.line, 3); continue; }
        line(g, x - 4, gy, x - 4, top, C.amber, 3);
        line(g, x + 4, gy, x + 4, top, C.amber, 3);
        circle(g, x, top - 4, 3, blink(this.t, 1.5) ? C.amber : C.dark, true);
        for (let yy = top + 10; yy < gy; yy += 14) { line(g, x - 4, yy, x + 4, yy + 7, C.muted, 1.5); line(g, x + 4, yy, x - 4, yy + 7, C.muted, 1.5); }
      } else if (f.k === "beacon") {
        if (f.used) continue;
        const by = this.sy(f.y), a = this.t * 1.5;
        g.globalAlpha = 0.3 + 0.3 * pulse(this.t, 1);
        circle(g, x, by, f.h + 8 + 4 * pulse(this.t, 1), C.amber, false, 2);
        g.globalAlpha = 1;
        g.save(); g.translate(x, by); g.rotate(a);
        diamond(g, 0, 0, f.h, C.amber, false);
        g.restore();
        circle(g, x, by, 4, C.amber, true);
      } else if (f.k === "updraft") {
        g.globalAlpha = 0.35;
        for (let i = 10; i < w; i += 30) {
          const off = (this.t * 120 + i * 7) % 120;
          line(g, x + i, gy - off, x + i, gy - off - 30, C.cyan, 2);
          line(g, x + i, gy - off - 120, x + i, gy - off - 150, C.cyan, 2);
        }
        g.globalAlpha = 1;
        line(g, x, gy, x + w, gy, C.cyan, 2);
      } else if (f.k === "gust") {
        g.globalAlpha = 0.4;
        const dir = f.a > 0 || this.L.sail ? 1 : -1, slide = ((this.t * 90 * dir) % 90 + 90) % 90;
        for (let i = 40; i < w; i += 90) {
          const yy = gy - 40 - (i % 3) * 40, cx = x + i + slide - 45;
          line(g, cx - 18, yy, cx + 18, yy, C.ink, 2);
          line(g, cx + 18 * dir, yy, cx + 8 * dir, yy - 7, C.ink, 2);
          line(g, cx + 18 * dir, yy, cx + 8 * dir, yy + 7, C.ink, 2);
        }
        g.globalAlpha = 1;
      } else if (f.k === "scrap") {
        if (f.used) continue;
        const by = this.sy(f.y) + 3 * Math.sin(this.t * 3 + f.x);
        g.save(); g.translate(x, by); g.rotate(this.t * 2 + f.x);
        g.strokeStyle = C.ink; g.lineWidth = 2; g.strokeRect(-5, -5, 10, 10);
        g.restore();
      }
    }
    // shock rings
    for (const r of this.rings) {
      g.globalAlpha = clamp(1 - r.t / 0.6, 0, 1);
      circle(g, this.sx(r.x), this.sy(r.y), 10 + r.t * 140, [C.red, C.amber, C.cyan][r.c] || C.ink, false, 3);
    }
    g.globalAlpha = 1;
  }
  // The best distance (or today's) and the last run as flags on the ground.
  drawMarks(g) {
    const gy = this.sy(0);
    if (gy > 560) return;
    const flag = (m, label, col) => {
      const x = this.sx(m * M);
      if (x < -20 || x > 980) return;
      line(g, x, gy, x, gy - 60, col, 2);
      g.fillStyle = col; g.beginPath(); g.moveTo(x, gy - 60); g.lineTo(x + 22 + 3 * Math.sin(this.t * 4), gy - 52); g.lineTo(x, gy - 44); g.fill();
      text(g, label, x + 4, gy - 74, 16, col, "center");
    };
    const best = this.bestRef(), last = this.daily ? 0 : num(this.sv.last.metres);
    if (last > 0 && Math.abs(last - best) > 8 && this.phase !== "over") flag(last, "LAST", C.muted);
    if (best > 0) flag(best, this.daily ? "TODAY" : "BEST", C.amber);
  }
  drawCannon(g) {
    const px = this.sx(0), py = this.sy(PIVOT_Y), gy = this.sy(0);
    if (px < -80) return;
    const a = (this.angle * Math.PI) / 180;
    g.fillStyle = "#16241a";
    g.beginPath(); g.moveTo(px - 30, gy); g.lineTo(px - 16, py); g.lineTo(px + 16, py); g.lineTo(px + 30, gy); g.closePath(); g.fill();
    g.strokeStyle = C.ink; g.lineWidth = 2; g.stroke();
    // the barrel, a little recoil after firing
    const back = this.phase === "fly" && this.runT < 0.25 ? 10 * (1 - this.runT / 0.25) : 0;
    const bx = px - Math.cos(a) * back, by = py + Math.sin(a) * back;
    line(g, bx, by, bx + Math.cos(a) * BARREL, by - Math.sin(a) * BARREL, "#2b3c2e", 12);
    line(g, bx, by, bx + Math.cos(a) * BARREL, by - Math.sin(a) * BARREL, this.phase === "aim" ? C.amber : C.ink, 3);
    circle(g, px, py, 8, C.ink, false, 2);
    if (this.phase === "aim") {
      for (let i = 1; i <= 3; i++) {
        const d = BARREL + 14 + i * 16;
        circle(g, px + Math.cos(a) * d, py - Math.sin(a) * d, 2, C.muted, true);
      }
      if (this.charging) { // the barrel glows as it charges
        g.globalAlpha = 0.3 + 0.5 * this.power;
        circle(g, bx + Math.cos(a) * BARREL, by - Math.sin(a) * BARREL, 6 + 8 * this.power, this.power > 0.85 ? C.red : C.amber, true);
        g.globalAlpha = 1;
      }
      const h = 120, x0 = px + 70, y0 = gy - 10;
      g.strokeStyle = C.line; g.lineWidth = 2; g.strokeRect(x0, y0 - h, 16, h);
      line(g, x0 - 4, y0 - h + 3, x0 + 20, y0 - h + 3, C.muted, 2);
      if (this.charging) {
        const col = this.power > 0.85 ? C.red : this.power > 0.55 ? C.amber : C.ink;
        g.fillStyle = col; g.fillRect(x0 + 3, y0 - 3 - (h - 6) * this.power, 10, (h - 6) * this.power);
      }
    }
  }
  drawPod(g) {
    if (this.phase === "aim" || this.phase === "title" || this.phase === "shop") return;
    const p = this.p, x = this.sx(p.x), y = this.sy(p.y + R);
    if (this.trailN > 1) { // the trail, fading toward its tail
      g.strokeStyle = this.chain >= 2 ? C.cyan : C.amber; g.lineWidth = 2;
      for (let part = 0; part < 3; part++) {
        const from = TRAIL - this.trailN + Math.floor((this.trailN * part) / 3), to = TRAIL - this.trailN + Math.floor((this.trailN * (part + 1)) / 3);
        g.globalAlpha = 0.15 + 0.2 * part;
        g.beginPath();
        for (let i = from; i < to; i++) {
          const tx = this.sx(this.trail[i * 2]), ty = this.sy(this.trail[i * 2 + 1] + R);
          if (i === from) g.moveTo(tx, ty); else g.lineTo(tx, ty);
        }
        if (part === 2) g.lineTo(x, y);
        g.stroke();
      }
      g.globalAlpha = 1;
    }
    const tti = this.phase === "fly" ? this.skipWindow() : -1;
    if (tti >= 0 && !this.skip) { // the skip cue: a ring that closes on the landing point
      const lx = this.sx(p.x + p.vx * tti), perfect = tti <= this.L.perfect;
      g.beginPath(); g.ellipse(lx, this.sy(0), 10 + 90 * tti, 4 + 20 * tti, 0, 0, TAU);
      g.strokeStyle = perfect ? C.ink : C.cyan; g.lineWidth = perfect ? 4 : 2; g.stroke();
    }
    if (this.early > 0 && this.phase === "fly") text(g, "EARLY", x, y - 26, 16, C.muted, "center");
    if (this.phase === "over" && this.reason === "pit") return;
    if (p.mode === "air" && y > -20 && y < 560) { // its shadow on the ground
      const gy = this.sy(0), k = clamp(1 - p.y / 500, 0.15, 1);
      if (gy < 560) { g.globalAlpha = 0.35 * k; g.fillStyle = "#000"; g.beginPath(); g.ellipse(x, gy + 2, 12 * k, 3, 0, 0, TAU); g.fill(); g.globalAlpha = 1; }
    }
    const ang = p.mode === "air" ? Math.atan2(p.vy, Math.max(1, p.vx)) : 0;
    g.save();
    g.translate(x, y);
    if (this.skip || this.chainT > 0) { g.globalAlpha = 0.25; circle(g, 0, 0, R + 7, this.skip ? C.cyan : C.ink, true); g.globalAlpha = 1; }
    g.rotate(-ang);
    if (this.kickT > 0) { // thruster flame
      const L = 10 + 26 * (this.kickT / 0.3) * (0.7 + 0.3 * Math.sin(this.t * 60));
      g.fillStyle = C.amber; g.beginPath(); g.moveTo(-R, -4); g.lineTo(-R - L, 0); g.lineTo(-R, 4); g.fill();
    }
    g.fillStyle = "#1d3022";
    g.beginPath(); g.moveTo(-R - 2, -6); g.lineTo(R - 2, -6); g.arc(R - 2, 0, 6, -Math.PI / 2, Math.PI / 2); g.lineTo(-R - 2, 6); g.closePath(); g.fill();
    g.strokeStyle = this.skip ? C.cyan : C.ink; g.lineWidth = 2.5; g.stroke();
    line(g, -R + 1, -6, -R - 5, -11, C.ink, 2); // fins
    line(g, -R + 1, 6, -R - 5, 11, C.ink, 2);
    circle(g, R - 3, 0, 2.5, this.shell > 0 ? C.amber : C.cyan, true); // its window: amber while the shell is whole
    if (p.mode !== "air") line(g, -4 + 3 * Math.sin(p.spin), 7, 4 + 3 * Math.sin(p.spin), 7, C.muted, 2);
    g.restore();
    if (y < 10) { // above the screen: a pointer with the height
      diamond(g, x, 22, 8, C.amber, true);
      text(g, Math.floor(p.y / M) + " m UP", x + 16, 22, 16, C.amber);
    }
  }
  drawParts(g) {
    for (let k = 0; k < MAX_PARTS; k++) {
      const o = k * 6;
      if (this.parts[o + 4] <= 0) continue;
      g.fillStyle = PART_COLOURS[this.parts[o + 5]] || C.amber;
      g.globalAlpha = clamp(this.parts[o + 4] / 0.6, 0, 1);
      g.fillRect(this.sx(this.parts[o]) - 2, this.sy(this.parts[o + 1]) - 2, 4, 4);
    }
    g.globalAlpha = 1;
  }
  drawOverlay(g) {
    text(g, this.metres + " m", 480, 50, 34, C.ink, "center");
    for (let i = 0; i < this.L.kicks; i++) { // thrusters left, as pips under the distance
      const x = 480 - (this.L.kicks - 1) * 12 + i * 24;
      diamond(g, x, 86, 7, i < this.kicks ? C.amber : C.line, i < this.kicks);
    }
    if (this.chain >= 2) {
      const pop = this.chainT > 1.3 ? 1 + (this.chainT - 1.3) : 1;
      text(g, "CHAIN " + this.chain, 880, 48, Math.round(24 * pop), C.cyan, "right");
      text(g, "SALVAGE x" + chainMult(this.chain).toFixed(1), 880, 76, 16, C.cyan, "right");
    } else if (this.R.chain >= 2) text(g, "BEST CHAIN " + this.R.chain, 880, 48, 16, C.muted, "right");
    if (this.daily) text(g, "DAILY: " + dailyGoal(this.dayKey()).text.toUpperCase(), 480, 118, 18, C.cyan, "center");
    else if (this.phase === "fly") { // the contracts, top left, as they progress
      let y = 40;
      for (const c of this.sv.ct) {
        const have = Math.min(c.n, Math.floor(num(contractProgress(c, this.R)))), done = have >= c.n;
        text(g, (done ? "[X] " : "") + CONTRACT_SHORT[c.k] + " " + (c.k === "zone" ? ZONES[c.n].roman : have + "/" + c.n), 60, y, 16, done ? C.cyan : C.muted);
        y += 22;
      }
    }
    if (this.noticeT > 0 && this.notice) {
      g.globalAlpha = clamp(this.noticeT / 0.4, 0, 1);
      text(g, this.notice, 480, 150, 22, this.notice.startsWith("PERFECT") ? C.cyan : C.amber, "center");
      g.globalAlpha = 1;
    }
    if (this.phase === "aim") {
      this.drawAhead(g);
      if (this.mods.length) text(g, "FITTED: " + this.mods.map((id) => MODULES.find((m) => m.id === id).name).join(" / "), 480, 118, 16, C.muted, "center");
      if (this.sv.runs < 2 && !this.charging) {
        g.fillStyle = "#0c1511e8";
        g.fillRect(250, 190, 460, 100);
        text(g, "HOLD TO CHARGE", 480, 222, 28, C.amber, "center");
        text(g, "RELEASE TO FIRE", 480, 260, 22, C.muted, "center");
      }
    }
  }
  // The field ahead, as a strip under the ground, with where this shot will first land: aim for a pad.
  drawAhead(g) {
    const x0 = 60, x1 = 900, y = 522, span = Math.max(600, this.reach * 1.15);
    const X = (px) => x0 + ((x1 - x0) * px) / span;
    g.fillStyle = "#050a07cc";
    g.fillRect(x0 - 8, y - 14, x1 - x0 + 16, 28);
    line(g, x0, y, x1, y, C.line, 2);
    for (const f of this.features) {
      if (f.x > span) break;
      const a = X(f.x), w = Math.max(3, X(f.x + f.w) - a);
      if (f.k === "pad") { g.fillStyle = C.cyan; g.fillRect(a, y - 7, w, 7); }
      else if (f.k === "boost") { g.fillStyle = C.amber; g.fillRect(a, y - 5, w, 5); }
      else if (f.k === "mine") circle(g, a + 2, y - 4, 4, C.red, true);
      else if (f.k === "pit") { g.fillStyle = C.red; g.fillRect(a, y - 1, w, 9); }
      else if (f.k === "drift") { g.fillStyle = "#6b5a3a"; g.fillRect(a, y - 2, w, 5); }
      else if (f.k === "ice") { g.fillStyle = "#8fcbc566"; g.fillRect(a, y - 2, w, 5); }
      else if (f.k === "net") line(g, a, y - 11, a, y, C.muted, 2);
    }
    // where it lands: at full power while aiming, at the meter's power while charging
    const lx = X(this.carry(this.angle, this.charging ? this.power : 1));
    if (lx <= x1 + 4) {
      g.beginPath(); g.moveTo(lx, y - 3); g.lineTo(lx - 7, y - 15); g.lineTo(lx + 7, y - 15); g.closePath();
      if (this.charging) { g.fillStyle = C.ink; g.fill(); } else { g.strokeStyle = C.muted; g.lineWidth = 2; g.stroke(); }
    }
    text(g, "AHEAD", x0 - 10, y - 24, 14, C.muted);
    text(g, Math.round(span / M) + " m", x1 + 10, y - 24, 14, C.muted, "right");
  }
  drawTitle(g) {
    banner(g, "BALLISTA", "FIRE THE POD AS FAR AS IT WILL GO");
    let y = 392;
    text(g, "HOLD = CHARGE     RELEASE = FIRE     PRESS IN FLIGHT = THRUST OR SKIP", 480, y, 16, C.muted, "center");
    y += 30;
    if (this.sv.best > 0) { text(g, "BEST " + this.sv.best + " m     SALVAGE " + this.sv.salvage + (this.sv.mark ? "     MARK " + roman(this.sv.mark + 1) : ""), 480, y, 18, C.amber, "center"); y += 30; }
    else if (this.sv.legacy) { text(g, "THE RANGE HAS BEEN REBUILT. " + this.sv.salvage + " SALVAGE TO START.", 480, y, 18, C.amber, "center"); y += 30; }
    text(g, "HOLD = WORKSHOP", 480, y, 18, C.cyan, "center");
  }
  drawResult(g) {
    if (this.deadT < 0.5 || !this.result) return;
    const r = this.result;
    g.fillStyle = "#0c1511ee";
    g.fillRect(170, 40, 620, 470);
    line(g, 220, 50, 740, 50, C.line);
    text(g, r.reason, 480, 78, 22, this.reason === "pit" ? C.red : C.muted, "center");
    // the distance counts up
    const shown = Math.floor(r.metres * clamp((this.deadT - 0.5) / 0.6, 0, 1));
    text(g, shown + " m", 480, 128, 52, C.ink, "center");
    text(g, this.newRecord ? (this.daily ? "BEST TODAY" : "NEW RECORD") : "BEST " + this.bestRef() + " m", 480, 172, 20, this.newRecord ? C.cyan : C.amber, "center");
    let y = 210;
    const row = (label, value, col = C.ink) => { text(g, label, 240, y, 18, C.muted); text(g, value, 720, y, 22, col, "right"); y += 30; };
    row("SALVAGE", "+" + r.salvage, C.amber);
    if (r.chain >= 2 || r.mult > 1) row("BEST CHAIN", r.chain + "   x" + r.mult.toFixed(2).replace(/0$/, ""), C.cyan);
    row("LIFTS  /  PERFECT SKIPS", r.pads + "  /  " + r.skips);
    if (r.scrap || this.sv.st.scrap) row("SCRAP", r.scrap);
    if (this.daily) { text(g, this.goalDone ? "DAILY GOAL MET" : "DAILY: " + dailyGoal(this.dayKey()).text.toUpperCase(), 480, y, 18, this.goalDone ? C.cyan : C.muted, "center"); y += 26; }
    for (const t of (r.contracts || []).slice(0, 2)) { text(g, "CONTRACT DONE  " + t.toUpperCase(), 480, y, 18, C.cyan, "center"); y += 26; }
    for (const id of this.newFeats.slice(0, 2)) {
      const f = FEATS.find((x) => x.id === id);
      if (f) { text(g, "FEAT  " + f.name, 480, y, 20, C.cyan, "center"); y += 26; }
    }
    for (const l of (r.next || []).slice(0, 2)) { if (y > 450) break; text(g, l, 480, y, 16, C.muted, "center"); y += 22; }
    if (this.deadT > 0.7) text(g, "TAP = AGAIN     HOLD = WORKSHOP", 480, 486, 18, C.amber, "center");
  }
  drawShop(g) {
    g.fillStyle = "#0c1511f2";
    g.fillRect(110, 22, 740, 500);
    line(g, 160, 32, 800, 32, C.line);
    text(g, this.view === "mods" ? "MODULES" : this.view === "contracts" ? "CONTRACTS" : "WORKSHOP", 300, 62, 30, C.amber, "center");
    text(g, "SALVAGE " + this.sv.salvage, 790, 62, 22, C.ink, "right");
    const sv = this.sv, n = sv.ft.length;
    if (this.view === "menu") {
      const rows = this.rows();
      rows.forEach((id, i) => {
        const y = 100 + i * 26, on = i === this.cur;
        let label = id, value = "";
        if (i >= 1 && i <= UPGRADES.length) {
          const L = sv.up[i - 1], u = UPGRADES[i - 1];
          label = u.name;
          for (let k = 0; k < UP_MAX; k++) diamond(g, 410 + k * 22, y, 6, k < L ? (on ? C.amber : C.ink) : C.line, k < L);
          const cost = upCost(i - 1, L, sv.mark);
          value = L >= UP_MAX ? "FULL" : cost + (cost <= sv.salvage ? "  BUY" : "");
        } else if (id === "LAUNCH") value = "BEST " + sv.best + " m";
        else if (id === "MODULES") value = sv.mods.length + " / " + MODULES.length + "   FITTED " + sv.eq.length + "/" + this.slots();
        else if (id === "CONTRACTS") value = sv.ct.filter((c) => c.pay).length + " STANDING   DONE " + sv.cdone;
        else if (id === "OVERHAUL") value = "MARK " + roman(sv.mark + 1) + (sv.up.every((L) => L >= UP_MAX) && sv.mark < MARK_MAX ? "  READY" : "");
        else if (id === "POD") value = PODS[sv.pod].name;
        else if (id === "DAILY") value = this.dailyDone() ? "DONE TODAY" : "BEST " + (sv.dl.d === this.dayKey() ? sv.dl.best : 0) + " m";
        else if (id === "LOG") value = "ZONE " + ZONES[sv.far].roman + " / " + ZONES[ZONES.length - 1].roman;
        if (on) diamond(g, 150, y, 8, C.amber, true);
        text(g, label, 176, y, 20, on ? C.amber : C.ink);
        text(g, value, 810, y, 18, on ? C.amber : id === "OVERHAUL" && value.endsWith("READY") ? C.cyan : C.muted, "right");
      });
      const id = rows[this.cur];
      let info = "";
      if (this.need) info = this.need;
      else if (id === "LAUNCH") info = "Fire a pod with this loadout.";
      else if (this.cur <= UPGRADES.length) info = UPGRADES[this.cur - 1].text + (sv.up[this.cur - 1] < UP_MAX ? "  HOLD TO BUY." : "");
      else if (id === "MODULES") info = "One-time builds. " + this.slots() + " fit in a run" + (this.slots() < SLOTS + 1 ? "; a third slot with " + SLOT3_MODS + " built." : ".");
      else if (id === "CONTRACTS") info = "Standing jobs. Each pays when a run meets it.";
      else if (id === "OVERHAUL") info = "With every system at V: strip them for a new mark. Launch +" + Math.round(MARK_SPEED * 100) + "%, salvage +" + Math.round(MARK_SALVAGE * 100) + "% a mark.";
      else if (id === "POD") { const next = this.nextPod(); info = PODS[sv.pod].text + (next ? "  NEXT: " + next.name + ", " + podNeed(next) : ""); }
      else if (id === "DAILY") info = "Same field and kit for everyone today. " + dailyGoal(this.dayKey()).text;
      else info = "Zones reached and lifetime totals.";
      text(g, info, 480, 456, 16, this.need ? C.cyan : C.muted, "center");
      text(g, "TAP = NEXT LINE     HOLD = CHOOSE", 480, 492, 18, C.cyan, "center");
    } else if (this.view === "mods") {
      MODULES.forEach((m, i) => {
        const y = 102 + i * 30, on = i === this.mcur, own = sv.mods.includes(m.id), fit = sv.eq.includes(m.id);
        if (on) diamond(g, 150, y, 8, C.amber, true);
        text(g, m.name, 176, y, 20, on ? C.amber : own ? C.ink : C.muted);
        text(g, fit ? "FITTED" : own ? "OWNED" : m.cost + (m.cost <= sv.salvage ? "  BUILD" : ""), 810, y, 18, fit ? C.cyan : on ? C.amber : C.muted, "right");
      });
      const back = this.mcur === MODULES.length, y = 102 + MODULES.length * 30;
      if (back) diamond(g, 150, y, 8, C.amber, true);
      text(g, "BACK", 176, y, 20, back ? C.amber : C.ink);
      const m = MODULES[this.mcur];
      const info = this.need || (m ? m.text + (sv.mods.includes(m.id) ? (sv.eq.includes(m.id) ? "  HOLD TO REMOVE." : "  HOLD TO FIT.") : "  HOLD TO BUILD.") : "Back to the workshop.");
      text(g, info, 480, 450, 16, this.need ? C.cyan : C.muted, "center");
      text(g, "TAP = NEXT     HOLD = CHOOSE     SLOTS " + sv.eq.length + "/" + this.slots(), 480, 490, 18, C.cyan, "center");
    } else if (this.view === "contracts") {
      sv.ct.forEach((c, i) => {
        const y = 130 + i * 76;
        text(g, contractText(c).toUpperCase(), 160, y, 22, C.ink);
        text(g, "PAYS " + c.pay + " SALVAGE", 160, y + 30, 18, C.amber);
        text(g, c.left + (c.left === 1 ? " RUN LEFT" : " RUNS LEFT"), 800, y + 30, 18, c.left <= 2 ? C.red : C.muted, "right");
      });
      text(g, "COMPLETED " + sv.cdone + "     A NEW JOB REPLACES EACH ONE DONE OR WITHDRAWN", 480, 400, 16, C.muted, "center");
      text(g, "PRESS = BACK", 480, 490, 18, C.cyan, "center");
    } else {
      text(g, "LOG   RUNS " + sv.runs + "   " + sv.st.metres + " m IN ALL", 480, 104, 20, C.cyan, "center");
      ZONES.forEach((z, i) => {
        const y = 136 + i * 28, got = i <= sv.far;
        text(g, z.roman + "  " + z.name, 160, y, 20, got ? z.ink : C.line);
        text(g, got ? "FROM " + z.from + " m" : "NOT REACHED", 800, y, 18, got ? C.amber : C.line, "right");
      });
      const y = 136 + ZONES.length * 28 + 6;
      text(g, "PADS " + sv.st.pads + "   PERFECT SKIPS " + sv.st.perfect + "   MINES " + sv.st.mines + "   SCRAP " + sv.st.scrap, 480, y, 16, C.muted, "center");
      text(g, "BEST CHAIN " + sv.chain + "   CONTRACTS " + sv.cdone + "   MODULES " + sv.mods.length + " / " + MODULES.length + "   MARK " + roman(sv.mark + 1), 480, y + 26, 16, C.muted, "center");
      text(g, PODS.map((p, i) => p.name + " " + sv.pb[i] + " m").join("   "), 480, y + 52, 16, C.muted, "center");
      if (sv.legacy) text(g, "FIRST RANGE: " + sv.legacy.runs + " SURVEYS, LAST SCORE " + sv.legacy.score, 480, y + 78, 16, C.line, "center");
      text(g, "PRESS = BACK", 480, 490, 18, C.cyan, "center");
    }
  }
  dailyDone() { return this.sv.dl.d === this.dayKey() && this.sv.dl.done === 1; }
}
