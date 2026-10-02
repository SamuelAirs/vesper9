// OUTPOST's rules: the content tables (machines, upgrades, the bearing tree, expeditions, research,
// goals, constellations), the pure economy (costs, multipliers, production, prestige), number and
// time formatting, and the save format (serialize and migrate). No game state lives here: every
// function takes the saved state `s` (see freshState) and returns a value.
//
// Indices into PROD, UPG, TREE, RES and GOALS are stored in saves: append, never reorder or remove.
// The scene, lamps and music modules read from here; nothing here reads them or the cartridge.
import { clamp } from "../engine/math.js";
import { SONGS, NS } from "./outpost-songs.js";

// ---- constants ---------------------------------------------------------------
export const SCHEMA = 4;
export const BIG = 1e150; // every growing number is clamped here
export const GROWTH = 1.15; // cost growth per machine owned
export const MAX_OWN = 1500;
export const MILESTONES = [10, 25, 50, 100, 150, 200, 250, 300]; // owned counts that double a machine
export const PRESTIGE_K = 1.2e5; // run signal at which one bearing is earned (gain = floor((run / K) ^ 0.25))
export const READY_MIN = 8; // bearings worth relocating for ...
export const READY_RATIO = 2; // ... and at least this many times the bearings already held, so later runs do not shrink to sprints
export const BASE_CAP_H = 8; // offline credit cap in hours, before upgrades
export const AWAY_MIN = 45; // seconds away before a summary is shown
export const HOLD_OPEN = 0.42; // seconds held (outside the ring) to open the ring
export const HOLD_BUY = 0.45; // seconds held (inside the ring) to choose
export const HOLD_BIG = 1.2; // seconds held to relocate
export const DWELL = 0.7; // an entry must have been highlighted this long before a hold can choose it
export const DWELL_BIG = 1.2;
export const RING_IDLE = 7; // seconds without input before the ring closes itself
export const DIM_AFTER = 180; // seconds without input before the lamps drop to their dim version
export const SAVE_EVERY = 15; // seconds between autosaves
export const SAVE_GAP = 1.5; // minimum seconds between event saves
export const FLARE_LIFE = 14;
export const FLOATERS = 12;
export const LUMP_SEC = 0.08; // a finished tune pays this many seconds of production per note (more with voices)
// Easy pace: the hand has a small reserve of PACE_BURST taps that refills at TAP_EASY a second
// (TAP_EASY_FRENZY during a tap frenzy). A tap spends one, or whatever is left, and is worth that
// much, so a steady, comfortable beat pays as much as frantic tapping (and a short burst is free).
export const TAP_EASY = 2.5;
export const TAP_EASY_FRENZY = 8;
export const PACE_BURST = 3;
// Hum: finishing a tune makes the machines tuned to its HUM_NOTES commonest pitch classes hum:
// their output x HUM_MULT for HUM_SEC (twice as long when the tune ends in full groove), stacking
// up to HUM_MAX seconds. It lasts while the station is open (not saved, not credited away).
export const HUM_MULT = 1.5;
export const HUM_SEC = 120;
export const HUM_MAX = 480;
export const HUM_NOTES = 3;
// Groove: a tap within GROOVE_TOL of the recent beat adds a step; GROOVE_MAX steps add GROOVE_BONUS
// (half again) to every tap and phrase.
export const GROOVE_BONUS = 0.5;
export const GROOVE_MAX = 24;
export const GROOVE_TOL = 0.2;
export const GROOVE_MIN_GAP = 0.12;
export const GROOVE_MAX_GAP = 1.5;
export const GROOVE_FADE = 8;
// Constellations: charted with bearings once the outpost has held CHART_REQ of them; each one
// multiplies all output by CHART_MULT and costs CHART_GROWTH times the one before.
export const CHART_REQ = 1000;
export const CHART_BASE = 250;
export const CHART_GROWTH = 1.45;
export const CHART_MULT = 1.3;
export const CHART_MAX = 200;

// Machines: name, short name, the pitch class the machine is tuned to (0 = C .. 11 = B: each one
// once, so every note of the octave belongs to one machine; see HUM), base cost, base output.
// The tunings follow the songbook: the early tunes are in C major, so the first machines sit on
// C, E, G, D and F; later machines take the notes of the later tunes; the last one waits on G#.
export const PROD = [
  { n: "RECEIVER DISH", short: "DISH", pc: 0, c: 10, r: 0.2, fx: "listens to the sky" },
  { n: "RELAY MAST", short: "MAST", pc: 4, c: 100, r: 1.2, fx: "boosts weak carriers" },
  { n: "CORE DRILL", short: "DRILL", pc: 7, c: 1100, r: 8, fx: "taps the buried hum" },
  { n: "ARRAY FIELD", short: "ARRAY", pc: 2, c: 12000, r: 47, fx: "phased dishes in rows" },
  { n: "BOREHOLE", short: "BOREHOLE", pc: 5, c: 130000, r: 260, fx: "listens through rock" },
  { n: "OBSERVATORY", short: "DOME", pc: 11, c: 1.4e6, r: 1400, fx: "long watches of the sky" },
  { n: "ARCHIVE VAULT", short: "VAULT", pc: 6, c: 2e7, r: 7800, fx: "mines old recordings" },
  { n: "ECHO CHAMBER", short: "ECHO", pc: 9, c: 3.3e8, r: 44000, fx: "makes silence speak" },
  { n: "PHASE LATTICE", short: "LATTICE", pc: 3, c: 5.1e9, r: 260000, fx: "steers the whole survey" },
  { n: "DEEP-SKY ARRAY", short: "DEEP-SKY", pc: 10, c: 7.5e10, r: 1.6e6, fx: "hears the far dark" },
  // schema 3: two late machines, each unlocked by a research project
  { n: "ZERO-POINT LISTENER", short: "ZERO-POINT", pc: 1, c: 1.4e12, r: 1.1e7, fx: "hears between the quanta" },
  { n: "SILENT ARRAY", short: "SILENT", pc: 8, c: 2.6e13, r: 8e7, fx: "answers what nobody sent" },
];
export const NP = PROD.length;
export const PC_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const PC_PROD = Array.from({ length: 12 }, (_, pc) => PROD.findIndex((p) => p.pc === pc)); // the machine on each note
export const NP0 = 10; // machines that existed before schema 3 (their upgrade indices must never move)
export const PROD_UPG_NAMES = [
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
  ["VACUUM CAVITY", "ZERO-POINT TRIM", "NULL FIELD"],
  ["SILENCE FILTER", "ANTI-ECHO", "THE LAST CHANNEL"],
];

// Every one-time upgrade, in a fixed order (the save stores indices into this list).
// kind: prod (x2 one machine), tap (tap x2 or +fraction of rate), cap (offline hours),
// grid (x1.3 everything), syn (dst machines gain per source owned).
export const UPG = [];
const addUpg = (u) => UPG.push({ idx: UPG.length, ...u });
const tierReq = [1, 10, 30], tierCost = [10, 150, 3000];
export const PROD_UPG = PROD.map(() => []);
PROD.slice(0, NP0).forEach((p, i) => {
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
export const SYN = [];
const addSyn = (dst) => {
  const src = dst + 1;
  SYN.push({ idx: UPG.length, src, dst });
  addUpg({ kind: "syn", src, dst, name: PROD[src].n.split(" ")[0] + " LINK", cost: PROD[src].c * 40, need: 5, per: 0.02,
    eff: PROD[dst].n + " +2% PER " + PROD[src].n });
};
for (let i = 0; i < NP0 - 1; i++) addSyn(i);
// ---- appended in schema 3: everything above keeps its index so older saves still load ----
for (let i = NP0; i < NP; i++) {
  for (let k = 0; k < 3; k++) {
    PROD_UPG[i].push(UPG.length);
    addUpg({ kind: "prod", i, name: PROD_UPG_NAMES[i][k], cost: PROD[i].c * tierCost[k], need: tierReq[k], eff: "x2 " + PROD[i].n + " OUTPUT" });
  }
}
addSyn(NP0 - 1); addSyn(NP0);
addUpg({ kind: "grid", name: "GRID SYNC IV", cost: 6e15, rt: 1e15, eff: "x1.3 ALL OUTPUT" });
addUpg({ kind: "grid", name: "GRID SYNC V", cost: 9e17, rt: 2e17, eff: "x1.3 ALL OUTPUT" });
addUpg({ kind: "tap", name: "SOLAR KEY", cost: 2e13, rt: 5e12, mult: 2, eff: "x2 PER TAP" });
// the instrument track: each is bought in order once the SECOND VOICE research is done
export const VOICE = [];
[["THIRD HARMONY", 4e4, 1e4, "EACH NOTE GAINS A SOFT THIRD ABOVE"], ["OCTAVE SHIMMER", 6e6, 2e6, "A QUIET OCTAVE ABOVE EACH NOTE"],
  ["MACHINE BASS", 8e8, 2e8, "THE MACHINES PLAY A LOW NOTE AT EACH PHRASE"], ["BELL PARTIALS", 6e10, 1.5e10, "NOTES RING LIKE BELLS"]].forEach((v, lvl) => {
  VOICE.push(UPG.length);
  addUpg({ kind: "voice", lvl, name: v[0], cost: v[1], rt: v[2], eff: v[3] + ". TUNE BONUSES +25%" });
});
export const NUP = UPG.length;
export const GRID_IDX = UPG.filter((u) => u.kind === "grid").map((u) => u.idx);
export const SYN_BY_DST = PROD.map((_, i) => SYN.filter((s) => s.dst === i));

// The bearing tree. cost(level) is what the next level costs; req is the lifetime bearings
// needed before the node is shown.
export const TREE = [
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
  // schema 3
  { n: "PERFECT PITCH", max: 4, req: 3, cost: (l) => 2 * 2 ** l, eff: () => "PHRASE AND TUNE BONUSES +50%" },
  { n: "SECOND BENCH", max: 2, req: 12, cost: (l) => 6 * 4 ** l, eff: () => "ONE MORE RESEARCH PROJECT AT A TIME" },
  { n: "DEEP LISTENING", max: 4, req: 20, cost: (l) => 5 * 3 ** l, eff: () => "+25% DATA FROM EVERY SOURCE" },
  // 0.3
  { n: "HARMONICS", max: 3, req: 5, cost: (l) => 3 * 3 ** l, eff: (l) => "HUMMING MACHINES x" + (HUM_MULT + 0.25 * (l + 1)).toFixed(2) + " (WAS x" + (HUM_MULT + 0.25 * l).toFixed(2) + ")" },
];
export const HARMONICS = 13; // the tree node that strengthens hum
export const NT = TREE.length;
export const KIT = [[], [10, 4], [25, 15, 5, 2], [40, 30, 18, 10, 4], [60, 45, 30, 20, 10, 3], [80, 60, 45, 32, 20, 8, 2]];
export const KIT_SIGNAL = [0, 1000, 30000, 600000, 1.2e7, 3e8];
export const AUTO_EVERY = [0, 12, 6, 3];
export const EXPED = [
  { n: "SHORT SURVEY", sec: 180, mins: 1.3, relic: 0, data: 0.5 },
  { n: "FIELD TRAVERSE", sec: 1200, mins: 10, relic: 0.1, data: 1.5 },
  { n: "DEEP SURVEY", sec: 5400, mins: 54, relic: 0.35, data: 4 },
  { n: "FAR TRAVERSE", sec: 14400, mins: 300, relic: 0.7, data: 12, res: 3 }, // needs the FAR TRAVERSE CHARTS research
];
export const MAX_RELICS = 20;
export const SUFFIX = ["", "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc"];
// The save's s.sg value meaning "the generated tune whose seed is s.gs" (a saved value: never change it).
export const GEN_ID = 100;

// ---- research ------------------------------------------------------------------------------
// Projects cost DATA (a slow second resource: goals, new tunes, expeditions and a trickle from
// the number of machine types running) and a wall-clock timer, so they finish while the game is
// closed. They are knowledge: they survive relocation. Each unlocks a new kind of thing.
export const RES = [
  { n: "COMPOSER'S DESK", data: 4, sec: 360, need: (s) => s.lt >= 5e3, hint: "AT 5 K LIFETIME SIGNAL", fx: "UNLOCKS GENERATED TUNES AND SHUFFLE IN THE SONGBOOK" },
  { n: "SECOND VOICE", data: 10, sec: 720, need: (s) => hasRes(s, 0), hint: "NEEDS THE COMPOSER'S DESK", fx: "UNLOCKS VOICE UPGRADES: THE STATION SINGS IN PARTS" },
  { n: "FLARE NET", data: 25, sec: 1800, need: (s) => s.lt >= 1e6, hint: "AT 1 M LIFETIME SIGNAL", fx: "FLARES LAST 40% LONGER AND EACH ONE CAUGHT BRINGS 2 DATA" },
  { n: "FAR CHARTS", data: 40, sec: 5400, need: (s) => s.tree[5] > 0, hint: "NEEDS A SURVEY TEAM", fx: "UNLOCKS THE FAR TRAVERSE EXPEDITION (4 H, BIG FINDS)" },
  { n: "COLD STAR CHARTS", data: 80, sec: 10800, need: (s) => s.lt >= 1e11, hint: "AT 100 B LIFETIME SIGNAL", fx: "UNLOCKS THE ZERO-POINT LISTENER, A NEW MACHINE" },
  { n: "THE SILENT BAND", data: 250, sec: 28800, need: (s) => hasRes(s, 4) && s.lt >= 1e13, hint: "NEEDS COLD STAR CHARTS AND 10 T", fx: "UNLOCKS THE SILENT ARRAY, THE LAST MACHINE" },
];
export const NR = RES.length;
export const hasRes = (s, k) => s.rd.includes(k);
export const resSlots = (s) => 1 + s.tree[11];
export const tiersOwned = (s) => { let n = 0; for (let i = 0; i < NP; i++) if (s.own[i] > 0) n++; return n; };
export const dataRate = (s) => 0.004 * tiersOwned(s) * (1 + 0.25 * s.tree[12]);
export const dataBonus = (s) => 1 + 0.25 * s.tree[12];
export const unlockedN = (s) => { let n = 0; for (const sg of SONGS) if (s.lt >= sg.at) n++; return n; };
export const masteredN = (s) => { let n = 0; for (const c of s.sc) if (c >= 5) n++; return n; };

// ---- goals ---------------------------------------------------------------------------------
// Each goal is worth +1% output for ever and 2 data. `hid` goals show only a hint until done; the
// hints point at mechanics (event flags are bits of s.ev, set where the thing happens).
export const EV = { presto: 1, perfect: 2, quick: 4, groove: 8 };
export const GOALS = [
  { n: "WARMING UP", d: "TAP 100 TIMES", v: (s) => s.taps, t: 100 },
  { n: "STEADY HAND", d: "TAP 1,000 TIMES", v: (s) => s.taps, t: 1e3 },
  { n: "RELAY OPERATOR", d: "TAP 10,000 TIMES", v: (s) => s.taps, t: 1e4 },
  { n: "THE KEY NEVER SLEEPS", d: "TAP 100,000 TIMES", v: (s) => s.taps, t: 1e5 },
  { n: "A LITTLE SIGNAL", d: "GATHER 1 K IN ALL", v: (s) => s.lt, t: 1e3 },
  { n: "LOUD ENOUGH", d: "GATHER 1 M IN ALL", v: (s) => s.lt, t: 1e6 },
  { n: "A HUSH BROKEN", d: "GATHER 1 B IN ALL", v: (s) => s.lt, t: 1e9 },
  { n: "THE SKY ANSWERS", d: "GATHER 1 T IN ALL", v: (s) => s.lt, t: 1e12 },
  { n: "BEYOND COUNTING", d: "GATHER 1 QA IN ALL", v: (s) => s.lt, t: 1e15 },
  { n: "ALL OF IT", d: "GATHER 1 SX IN ALL", v: (s) => s.lt, t: 1e21 },
  { n: "A CHORUS", d: "OWN 10 OF ONE MACHINE", v: (s) => Math.max(...s.own), t: 10 },
  { n: "THE HUNDRED CLUB", d: "OWN 100 OF ONE MACHINE", v: (s) => Math.max(...s.own), t: 100 },
  { n: "A FULL BAND", d: "RUN 6 MACHINE TYPES AT ONCE", v: (s) => tiersOwned(s), t: 6 },
  { n: "EVERYTHING AT ONCE", d: "RUN 10 MACHINE TYPES AT ONCE", v: (s) => tiersOwned(s), t: 10 },
  { n: "COMMISSIONER", d: "MAKE 100 PURCHASES", v: (s) => s.st.buys, t: 100 },
  { n: "FIRST MELODY", d: "PLAY ONE TUNE THROUGH", v: (s) => s.st.md, t: 1 },
  { n: "REPERTOIRE", d: "PLAY 25 TUNES THROUGH", v: (s) => s.st.md, t: 25 },
  { n: "BAND LEADER", d: "PLAY 200 TUNES THROUGH", v: (s) => s.st.md, t: 200 },
  { n: "MASTERY", d: "MASTER 3 TUNES (5 PLAYS EACH)", v: (s) => masteredN(s), t: 3 },
  { n: "THE FULL SONGBOOK", d: "UNLOCK EVERY TUNE", v: (s) => unlockedN(s), t: NS },
  { n: "PERFECT PERFORMANCE", d: "", hid: true, hint: "PLAY A WHOLE TUNE WITHOUT STOPPING", v: (s) => (s.ev & EV.perfect ? 1 : 0), t: 1 },
  { n: "PRESTO", d: "", hid: true, hint: "TAP VERY FAST, JUST FOR A MOMENT", v: (s) => (s.ev & EV.presto ? 1 : 0), t: 1 },
  { n: "SPARK", d: "CATCH A FLARE", v: (s) => s.st.fl, t: 1 },
  { n: "FLARE HUNTER", d: "CATCH 10 FLARES", v: (s) => s.st.fl, t: 10 },
  { n: "SHARP EYES", d: "", hid: true, hint: "CATCH A FLARE THE MOMENT IT APPEARS", v: (s) => (s.ev & EV.quick ? 1 : 0), t: 1 },
  { n: "FIRST SURVEY", d: "SEND AN EXPEDITION", v: (s) => s.st.ex, t: 1 },
  { n: "FIELD OFFICE", d: "SEND 10 EXPEDITIONS", v: (s) => s.st.ex, t: 10 },
  { n: "NEW GROUND", d: "RELOCATE THE OUTPOST", v: (s) => s.runs, t: 1 },
  { n: "NOMAD", d: "RELOCATE 5 TIMES", v: (s) => s.runs, t: 5 },
  { n: "SWIFT MOVE", d: "", hid: true, hint: "RELOCATE IN UNDER 20 MINUTES", v: (s) => (s.st.fr > 0 && s.st.fr < 1200 ? 1 : 0), t: 1 },
  { n: "LABORATORY", d: "FINISH A RESEARCH PROJECT", v: (s) => s.rd.length, t: 1 },
  { n: "COMPLETE SURVEY", d: "FINISH EVERY PROJECT", v: (s) => s.rd.length, t: NR },
  { n: "AN HOUR ON THE KEY", d: "PLAY FOR AN HOUR IN ALL", v: (s) => s.st.tp, t: 3600 },
  { n: "NIGHT WATCH", d: "", hid: true, hint: "LET THE STATION RUN A FULL DAY WHILE YOU ARE AWAY", v: (s) => s.st.ta, t: 86400 },
  // schema 4 (appended: earlier goals keep their indices)
  { n: "IN THE POCKET", d: "", hid: true, hint: "KEEP A STEADY BEAT UNTIL THE GROOVE IS FULL", v: (s) => (s.ev & EV.groove ? 1 : 0), t: 1 },
  { n: "HOUSE BAND", d: "TAP 1,000 TIMES IN FULL GROOVE", v: (s) => s.st.gt, t: 1e3 },
  { n: "FIRST LIGHT", d: "CHART A CONSTELLATION", v: (s) => s.cn, t: 1 },
  { n: "THE WHOLE SKY", d: "CHART ALL TWELVE CONSTELLATIONS", v: (s) => s.cn, t: 12 },
];
export const NG = GOALS.length;
export const goalFrac = (s, g) => clamp(g.v(s) / g.t, 0, 1);

// ---- sense of place ------------------------------------------------------------------------
export const STAGES = ["LANDING SITE", "FIELD STATION", "SURVEY CAMP", "DEEP BASE", "LISTENING CAMPUS", "DEEP-SKY COMPLEX", "SILENT COAST"];
// Twelve named constellations (star positions in a 0..1 box, then the lines between them); later
// charts reuse the shapes, brighter, as "deep" charts.
export const CONST = [
  ["THE KEY", [[0, 0.5], [0.3, 0.5], [0.5, 0.2], [0.7, 0.5], [1, 0.5]], [[0, 1], [1, 2], [2, 3], [3, 4]]],
  ["THE DISH", [[0, 0], [0.25, 0.7], [0.5, 1], [0.75, 0.7], [1, 0], [0.5, 0.4]], [[0, 1], [1, 2], [2, 3], [3, 4], [2, 5]]],
  ["THE LANTERN", [[0.5, 0], [0.2, 0.4], [0.8, 0.4], [0.2, 0.9], [0.8, 0.9]], [[0, 1], [0, 2], [1, 3], [2, 4], [3, 4]]],
  ["THE MAST", [[0.5, 0], [0.5, 1], [0.1, 0.3], [0.9, 0.3], [0.2, 0.7], [0.8, 0.7]], [[0, 1], [2, 3], [4, 5]]],
  ["THE DRILL", [[0, 0], [0.4, 0.3], [0.6, 0.6], [1, 1], [0.8, 0.2]], [[0, 1], [1, 2], [2, 3], [1, 4]]],
  ["THE CHOIR", [[0, 0.8], [0.25, 0.4], [0.5, 0.7], [0.75, 0.3], [1, 0.6]], [[0, 1], [1, 2], [2, 3], [3, 4]]],
  ["THE WATCHER", [[0.5, 0.5], [0.1, 0.2], [0.9, 0.2], [0.1, 0.8], [0.9, 0.8]], [[0, 1], [0, 2], [0, 3], [0, 4]]],
  ["THE ARCHIVE", [[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5]], [[0, 1], [1, 2], [2, 3], [3, 0]]],
  ["THE ECHO", [[0, 0.5], [0.35, 0.2], [0.35, 0.8], [0.7, 0.1], [0.7, 0.9], [1, 0.5]], [[0, 1], [0, 2], [1, 3], [2, 4], [3, 5], [4, 5]]],
  ["THE LATTICE", [[0, 0], [0.5, 0], [1, 0], [0, 1], [0.5, 1], [1, 1]], [[0, 4], [1, 3], [1, 5], [2, 4]]],
  ["THE FAR EAR", [[0, 1], [0.3, 0.2], [0.7, 0], [1, 0.4], [0.6, 0.6]], [[0, 1], [1, 2], [2, 3], [3, 4], [4, 1]]],
  ["THE SILENCE", [[0.5, 0.1], [0.5, 0.9]], [[0, 1]]],
];
export const chartCost = (k) => Math.ceil(CHART_BASE * Math.pow(CHART_GROWTH, k));
export const chartName = (k) => (k < CONST.length ? CONST[k % CONST.length][0] : "DEEP " + CONST[k % CONST.length][0].replace("THE ", "") + " " + (Math.floor(k / CONST.length) + 1));
export const chartsOpen = (s) => s.L >= CHART_REQ || s.cn > 0;
export const stageOf = (s) => { const n = tiersOwned(s); return n < 1 ? 0 : n < 3 ? 1 : n < 5 ? 2 : n < 7 ? 3 : n < 9 ? 4 : n < 11 ? 5 : 6; };

// ---- hum ----------------------------------------------------------------------------------
// The pitch classes a melody hums: its commonest ones (ties go to the one heard first).
export function humNotes(mel, k = HUM_NOTES) {
  const count = Array(12).fill(0), first = Array(12).fill(Infinity);
  mel.n.forEach((m, i) => { const pc = ((m % 12) + 12) % 12; count[pc]++; if (i < first[pc]) first[pc] = i; });
  return [...count.keys()].filter((pc) => count[pc] > 0).sort((a, b) => count[b] - count[a] || first[a] - first[b]).slice(0, k);
}
// The machines a melody hums, in the order of its notes.
export const humMachines = (mel, k = HUM_NOTES) => humNotes(mel, k).map((pc) => PC_PROD[pc]);
export const humMultOf = (s) => HUM_MULT + 0.25 * s.tree[HARMONICS];
export const humSecOf = (s, full) => HUM_SEC * (full ? 2 : 1);

// ---- pure economy ------------------------------------------------------------
export const num = (x, hi = BIG) => (Number.isFinite(x) ? clamp(x, 0, hi) : x > 0 ? hi : 0);
export const int = (x, hi) => Math.floor(num(Number(x), hi));

export function fmt(n) {
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
export const fmtRate = (n) => (n > 0 && n < 1 ? n.toFixed(2) : fmt(n));
export function dur(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h) return h + " H " + String(m).padStart(2, "0") + " M";
  if (m) return m + " M " + String(s).padStart(2, "0") + " S";
  return s + " S";
}
export const fmtInt = (n) => (n < 1e15 ? Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") : fmt(n));
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
export const fmtDate = (ms) => { const d = new Date(ms); return Number.isFinite(d.getTime()) ? d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear() : "?"; };
export const clock = (sec) => { sec = Math.max(0, Math.ceil(sec)); return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0"); };

export const costOf = (s, i, n = s.own[i]) => Math.ceil(PROD[i].c * Math.pow(GROWTH, Math.min(n, MAX_OWN)) * Math.pow(0.94, s.tree[2]));
export const milestonesAt = (n) => MILESTONES.filter((m) => n >= m).length;
export const nextMilestone = (n) => MILESTONES.find((m) => n < m) || 0;
export const globalMult = (s) => {
  let g = (1 + s.L * (0.2 + 0.04 * s.tree[6])) * (1 + 0.25 * s.tree[9]) * (1 + 0.03 * s.relics) * (1 + 0.01 * s.gl.length) * (1 + 0.02 * masteredN(s)) * Math.pow(CHART_MULT, s.cn);
  for (const k of GRID_IDX) if (s.up[k]) g *= 1.3;
  return num(g);
};
export function prodMult(s, i) {
  let m = 2 ** milestonesAt(s.own[i]);
  for (const k of PROD_UPG[i]) if (s.up[k]) m *= 2;
  let add = 0;
  for (const y of SYN_BY_DST[i]) if (s.up[y.idx]) add += 0.02 * s.own[y.src] * (1 + 0.5 * s.tree[8]);
  return num(m * (1 + add));
}
// Fills out[i] with each machine's output per second and returns the total. `hum`, when given,
// holds a multiplier per machine (1 for a quiet one).
export function evaluate(s, out, hum) {
  const g = globalMult(s);
  let total = 0;
  for (let i = 0; i < NP; i++) {
    const v = num(s.own[i] * PROD[i].r * prodMult(s, i) * g * (hum ? hum[i] : 1));
    if (out) out[i] = v;
    total += v;
  }
  return num(total);
}
export function tapParts(s) {
  let mult = 2 ** s.tree[1], frac = 0;
  for (const u of UPG) if (u.kind === "tap" && s.up[u.idx]) { mult *= u.mult || 1; frac += u.frac || 0; }
  return { mult, frac };
}
export const capHours = (s) => {
  let h = BASE_CAP_H + 4 * s.tree[3];
  for (const u of UPG) if (u.kind === "cap" && s.up[u.idx]) h += u.hours;
  return h;
};
export const pendingOf = (s) => int(Math.pow(s.rt / PRESTIGE_K, 0.25), 1e9);
export const revealOf = (s) => { const p = pendingOf(s); return p >= 3 || (s.runs > 0 && p >= 1); };
// How many times the bearings already held a relocation should bring before it is called ready:
// twice early on, less once the holdings are large (otherwise late runs grow without end).
export const readyRatio = (L) => (L < 500 ? READY_RATIO : L < 5000 ? 1.6 : L < 20000 ? 1.35 : 1.25);
export const readyOf = (s) => { const p = pendingOf(s); return p >= READY_MIN && p >= readyRatio(s.L) * s.L; };
export const slotsOf = (s) => (s.tree[5] ? s.tree[5] : 0);

export function upgradeVisible(s, u) {
  if (s.up[u.idx]) return false;
  const rtNeed = u.rt ?? 0;
  if (s.rt < Math.max(rtNeed, 0.2 * u.cost)) return false;
  if (u.kind === "voice") return hasRes(s, 1) && (u.lvl === 0 || !!s.up[VOICE[u.lvl - 1]]);
  if (u.kind === "prod") return s.own[u.i] >= u.need;
  if (u.kind === "syn") return s.own[u.src] >= u.need && s.own[u.dst] >= u.need;
  return true;
}
export const tierOpen = (s, i) => i < NP0 || hasRes(s, i === NP0 ? 4 : 5); // the two late machines need their research
export function prodVisible(s, i) {
  if (s.own[i] > 0) return true;
  return tierOpen(s, i) && i <= s.maxTier + 1 && s.rt >= 0.3 * costOf(s, i);
}

// Statistics: counts that began at the migration (or at founding) are marked with * on screen.
// tp/ta seconds played and away, hand/mach/off/bon signal by source (off = credited while away,
// bon = flares, expeditions), rtaps/rhand/rmach the same for this run, fr the fastest relocation.
export const ST_KEYS = ["rp", "hand", "mach", "off", "bon", "peak", "tp", "ta", "buys", "md", "nt", "ph", "fl", "ex", "fr", "rtaps", "rhand", "rmach", "gen", "gb", "gt"]; // schema 4: gb best groove, gt taps in full groove
export const freshStats = () => Object.fromEntries(ST_KEYS.map((k) => [k, 0]));
export function freshState() {
  return { sig: 0, rt: 0, lt: 0, own: Array(NP).fill(0), up: new Uint8Array(NUP), taps: 0, b: 0, L: 0, tree: Array(NT).fill(0),
    relics: 0, runs: 0, maxTier: 0, ex: [], play: 0, last: {}, milestone: 0, extra: null,
    st: freshStats(), f: Date.now(), fk: 1, sg: 0, sp: 0, gs: 1, sm: 0, sc: Array(NS).fill(0), gl: [], ev: 0, rd: [], rs: [], dat: 0, cn: 0 };
}
export function applyKit(s) {
  const l = s.tree[0], kit = KIT[l] || [];
  let added = 0;
  kit.forEach((n, i) => { if (s.own[i] < n) { added += n - s.own[i]; s.own[i] = n; s.maxTier = Math.max(s.maxTier, i); } });
  return added;
}

// ---- saving -------------------------------------------------------------------
const KNOWN = new Set(["v", "t", "sig", "rt", "lt", "own", "up", "taps", "b", "L", "tree", "relics", "runs", "maxTier", "ex", "play", "last", "milestone",
  "st", "f", "fk", "sg", "sp", "gs", "sm", "sc", "gl", "ev", "rd", "rs", "dat", "cn"]);
export function serialize(s, t) {
  const out = { v: SCHEMA, t, sig: num(s.sig), rt: num(s.rt), lt: num(s.lt), own: s.own.slice(), up: [], taps: s.taps, b: s.b, L: s.L,
    tree: s.tree.slice(), relics: s.relics, runs: s.runs, maxTier: s.maxTier, ex: s.ex.map((e) => [e.k, e.end]), play: Math.floor(s.play),
    last: s.last, milestone: s.milestone, st: Object.fromEntries(Object.entries(s.st).map(([k, v]) => [k, Math.round(v * 100) / 100])), f: s.f, fk: s.fk, sg: s.sg, sp: s.sp, gs: s.gs, sm: s.sm, sc: s.sc.slice(), gl: s.gl.slice(),
    ev: s.ev, rd: s.rd.slice(), rs: s.rs.map((e) => [e.k, e.end]), dat: Math.round(s.dat * 100) / 100, cn: s.cn };
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
export function migrate(raw) {
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
  // schema 3: an older save gets fresh statistics (counting starts now), the first song and no
  // research; its goals are credited silently by the cartridge after loading.
  const upgraded = v < 3;
  if (upgraded) { s.fk = s.lt === 0 && s.taps === 0 ? 1 : 0; s.f = Date.now(); }
  else {
    const rs = r.st && typeof r.st === "object" && !Array.isArray(r.st) ? r.st : {};
    for (const k of ST_KEYS) s.st[k] = num(Number(rs[k]), 1e15);
    s.f = num(Number(r.f), 1e15) || Date.now(); s.fk = r.fk ? 1 : 0;
    s.sg = Number(r.sg) === GEN_ID ? GEN_ID : int(r.sg, NS - 1);
    s.sp = int(r.sp, 5000); s.gs = (Number(r.gs) >>> 0) || 1; s.sm = int(r.sm, 2);
    if (Array.isArray(r.sc)) for (let i = 0; i < NS; i++) s.sc[i] = int(r.sc[i], 1e9);
    if (Array.isArray(r.gl)) for (const k of r.gl) { const i = Math.floor(Number(k)); if (i >= 0 && i < NG && !s.gl.includes(i)) s.gl.push(i); }
    s.ev = int(r.ev, 255);
    if (Array.isArray(r.rd)) for (const k of r.rd) { const i = Math.floor(Number(k)); if (i >= 0 && i < NR && !s.rd.includes(i)) s.rd.push(i); }
    if (Array.isArray(r.rs)) for (const e of r.rs.slice(0, 3)) if (Array.isArray(e) && e[0] >= 0 && e[0] < NR) s.rs.push({ k: Math.floor(e[0]), end: num(Number(e[1]), 1e15) });
    s.dat = num(Number(r.dat), 1e12);
    s.cn = int(r.cn, CHART_MAX); // schema 4 (a schema 3 save has none: 0)
  }
  if (v > SCHEMA) {
    const extra = {};
    for (const key of Object.keys(raw)) if (!KNOWN.has(key)) extra[key] = raw[key];
    s.extra = extra;
  }
  return { s, t: num(Number(r.t), 1e15), future: v > SCHEMA, upgraded, from: v };
}
