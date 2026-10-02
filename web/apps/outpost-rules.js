// OUTPOST's rules: the content tables (machines, upgrades, the bearing tree, expeditions, research,
// goals, constellations), the pure economy (costs, multipliers, production, prestige), number and
// time formatting, and the save format (serialize and migrate). No game state lives here: every
// function takes the saved state `s` (see freshState) and returns a value.
//
// Indices into PROD, UPG, TREE, RES, GOALS, SITES, FIT and FEATS are stored in saves: append, never
// reorder or remove.
// The scene, lamps and music modules read from here; nothing here reads them or the cartridge.
import { clamp } from "../engine/math.js";
import { SONGS, NS, makeMelody } from "./outpost-songs.js";

// ---- constants ---------------------------------------------------------------
export const SCHEMA = 6;
export const BIG = 1e150; // every growing number is clamped here
export const GROWTH = 1.15; // cost growth per machine owned
export const MAX_OWN = 1500;
export const MILESTONES = [10, 25, 50, 100, 150, 200, 250, 300]; // owned counts that double a machine
export const PRESTIGE_K = 1.2e5; // run signal at which one bearing is earned (gain = floor((run / K) ^ 0.25))
export const READY_MIN = 8; // bearings worth relocating for ...
export const READY_RATIO = 2; // ... and at least this many times the bearings already held, so later runs do not shrink to sprints
export const READY_LATE = 20000; // past this many bearings held, the ratio keeps falling (as (READY_LATE / held) ^ READY_FALL) ...
export const READY_FALL = 0.3;
export const READY_FLOOR = 0.2; // ... to this, so late runs stay an hour or two instead of growing to a day
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
// `sky` machines listen up, the others listen down into the ground (some sites favour one kind).
export const PROD = [
  { n: "RECEIVER DISH", short: "DISH", pc: 0, sky: true, c: 10, r: 0.2, fx: "listens to the sky" },
  { n: "RELAY MAST", short: "MAST", pc: 4, sky: true, c: 100, r: 1.2, fx: "boosts weak carriers" },
  { n: "CORE DRILL", short: "DRILL", pc: 7, sky: false, c: 1100, r: 8, fx: "taps the buried hum" },
  { n: "ARRAY FIELD", short: "ARRAY", pc: 2, sky: true, c: 12000, r: 47, fx: "phased dishes in rows" },
  { n: "BOREHOLE", short: "BOREHOLE", pc: 5, sky: false, c: 130000, r: 260, fx: "listens through rock" },
  { n: "OBSERVATORY", short: "DOME", pc: 11, sky: true, c: 1.4e6, r: 1400, fx: "long watches of the sky" },
  { n: "ARCHIVE VAULT", short: "VAULT", pc: 6, sky: false, c: 2e7, r: 7800, fx: "mines old recordings" },
  { n: "ECHO CHAMBER", short: "ECHO", pc: 9, sky: false, c: 3.3e8, r: 44000, fx: "makes silence speak" },
  { n: "PHASE LATTICE", short: "LATTICE", pc: 3, sky: false, c: 5.1e9, r: 260000, fx: "steers the whole survey" },
  { n: "DEEP-SKY ARRAY", short: "DEEP-SKY", pc: 10, sky: true, c: 7.5e10, r: 1.6e6, fx: "hears the far dark" },
  // schema 3: two late machines, each unlocked by a research project
  { n: "ZERO-POINT LISTENER", short: "ZERO-POINT", pc: 1, sky: false, c: 1.4e12, r: 1.1e7, fx: "hears between the quanta" },
  { n: "SILENT ARRAY", short: "SILENT", pc: 8, sky: true, c: 2.6e13, r: 8e7, fx: "answers what nobody sent" },
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
export const dataRate = (s) => 0.004 * tiersOwned(s) * (1 + 0.25 * s.tree[12]) * siteFx(s).data;
export const dataBonus = (s) => (1 + 0.25 * s.tree[12]) * siteFx(s).data;
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
export const STAGES = ["A LANDER", "FIELD STATION", "SURVEY CAMP", "DEEP BASE", "LISTENING CAMPUS", "DEEP-SKY COMPLEX", "GREAT ARRAY"];
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
export const humMultOf = (s) => HUM_MULT + 0.25 * s.tree[HARMONICS] + siteFx(s).hum + (s.ans > 0 ? 0.5 : 0);
export const humSecOf = (s, full) => HUM_SEC * (full ? 2 : 1) * siteFx(s).humT;
export const humMaxOf = (s) => HUM_MAX * siteFx(s).humT;

// ---- sites, surveys and the call --------------------------------------------------------
// Relocating offers three SITES. Each changes the next run's rules (`fx`, a trade-off that suits a
// way of playing) and holds two SOUNDINGS to take, objectives for the visit (called surveys in the
// code: `sv.k` is what counts and `sv.t` the targets of sounding I and II). Soundings are kept for
// ever: each is +SURVEY_BONUS output and decodes a fragment of THE CALL (a relic once the call is
// whole). A site is known once the outpost has held `req` bearings in all (and `need`, when
// given, holds; `hint` says what it takes). `terrain` is a key for drawing.
// fx: mach (all machines), sky / ground (machines of that kind), tap (a tap's whole worth), tune
// (phrase and tune bonuses), hum (added to the hum multiplier), humT (hum time), flare (how
// often), exp (expedition speed), relic (relic chance), data, res (research speed), cap (away
// hours added), groove (groove fill speed and bonus), growth (machine price growth), upg
// (upgrade prices), silent (the silent array).
const FX0 = { mach: 1, sky: 1, ground: 1, tap: 1, tune: 1, hum: 0, humT: 1, flare: 1, exp: 1, relic: 1, data: 1, res: 1, cap: 0, groove: 1, growth: GROWTH, upg: 1, silent: 1 };
export const SITES = [
  { n: "LANDING SITE", terrain: "plain", req: 0, fx: {}, rule: ["NO SPECIAL RULES"], lore: "WHERE THE OUTPOST CAME DOWN.", sv: { k: "tunes", t: [5, 20] } },
  { n: "HIGH RIDGE", terrain: "ridge", req: 0, fx: { sky: 1.5, ground: 0.75 }, rule: ["SKY MACHINES x1.5", "GROUND MACHINES x0.75"], lore: "THIN AIR AND A CLEAR SKY.", sv: { k: "sky", t: [60, 150] } },
  { n: "SINK BASIN", terrain: "basin", req: 0, fx: { sky: 0.75, ground: 1.5 }, rule: ["GROUND MACHINES x1.5", "SKY MACHINES x0.75"], lore: "THE GROUND HERE LISTENS BACK.", sv: { k: "ground", t: [60, 150] } },
  { n: "SALT FLATS", terrain: "flats", req: 0, fx: { tap: 3, tune: 3, mach: 0.8 }, rule: ["TAPS x3, TUNE BONUSES x3", "MACHINES x0.8"], lore: "SOUND CARRIES FOR MILES.", sv: { k: "taps", t: [1200, 3600] } },
  { n: "GLACIER", terrain: "glacier", req: 8, hint: "AT 8 BEARINGS IN ALL", fx: { mach: 1.4, cap: 8, tap: 0.5 }, rule: ["MACHINES x1.4, AWAY +8 H", "TAPS x0.5"], lore: "COLD ELECTRONICS RUN QUIET.", sv: { k: "watch", t: [3600, 14400] } },
  { n: "ECHO CANYON", terrain: "canyon", req: 20, hint: "AT 20 BEARINGS IN ALL", fx: { hum: 0.5, humT: 2, tune: 2, mach: 0.9 }, rule: ["HUM +0.5, TWICE AS LONG", "TUNE BONUSES x2", "MACHINES x0.9"], lore: "EVERY NOTE COMES BACK.", sv: { k: "tunes", t: [15, 45] } },
  { n: "CRATER RIM", terrain: "crater", req: 40, hint: "AT 40 BEARINGS IN ALL", fx: { flare: 2, mach: 0.7 }, rule: ["FLARES TWICE AS OFTEN", "MACHINES x0.7"], lore: "THE SKY FEELS CLOSE ENOUGH TO TOUCH.", sv: { k: "flares", t: [6, 18] } },
  { n: "RUST COAST", terrain: "coast", req: 6, hint: "AT 6 BEARINGS, WITH A SURVEY TEAM", need: (s) => s.tree[5] > 0, fx: { exp: 2, relic: 1.5 }, rule: ["EXPEDITIONS TWICE AS FAST", "RELICS 50% MORE LIKELY"], lore: "OLD WRECKS ALONG THE TIDE LINE.", sv: { k: "exp", t: [3, 9] } },
  { n: "FUMAROLE FIELD", terrain: "fumaroles", req: 60, hint: "AT 60 BEARINGS, AFTER ONE RESEARCH", need: (s) => s.rd.length > 0, fx: { data: 3, res: 2, mach: 0.9 }, rule: ["DATA x3", "RESEARCH TWICE AS FAST", "MACHINES x0.9"], lore: "WARM GROUND, BUSY INSTRUMENTS.", sv: { k: "data", t: [25, 75] } },
  { n: "AURORA SHELF", terrain: "shelf", req: 150, hint: "AT 150 BEARINGS IN ALL", fx: { groove: 2, tune: 2 }, rule: ["GROOVE FILLS TWICE AS FAST", "FULL GROOVE x2 (NOT x1.5)", "TUNE BONUSES x2"], lore: "THE SKY HERE KEEPS TIME.", sv: { k: "groove", t: [400, 1200] } },
  { n: "DRIFT DUNES", terrain: "dunes", req: 400, hint: "AT 400 BEARINGS IN ALL", fx: { growth: 1.14, upg: 2 }, rule: ["MACHINE PRICES RISE SLOWER", "UPGRADES COST x2"], lore: "THE SAND NEVER STOPS MOVING.", sv: { k: "buys", t: [300, 900] } },
  { n: "THE SILENT COAST", terrain: "silent", req: 0, hint: "WHERE THE CALL LEADS, ONCE IT IS WHOLE", need: (s) => s.cf >= CALL_FRAGS, fx: { silent: 3 }, rule: ["WHERE THE CALL COMES FROM", "SILENT ARRAYS x3"], lore: "NOTHING HERE MAKES A SOUND.", sv: { k: "answer", t: [1, 3] } },
].map((x, k) => ({ ...x, k, fx: { ...FX0, ...x.fx } }));
export const NSITE = SITES.length;
export const SILENT = 11; // the silent coast: where the call is answered
export const SURVEY_BONUS = 0.1; // all output, per survey done
export const SURVEY_LEVELS = 2;
// What a survey asks, from its kind and target.
export const SURVEY = {
  tunes: (t) => "PLAY " + t + " TUNES THROUGH HERE",
  sky: (t) => "BUILD " + t + " OF ONE SKY MACHINE",
  ground: (t) => "BUILD " + t + " OF ONE GROUND MACHINE",
  taps: (t) => "TAP " + fmtInt(t) + " TIMES HERE",
  watch: (t) => "LEAVE IT RUNNING " + t / 3600 + " H HERE",
  flares: (t) => "CATCH " + t + " FLARES HERE",
  exp: (t) => "BRING BACK " + t + " EXPEDITIONS",
  data: (t) => "GATHER " + t + " DATA HERE",
  groove: (t) => "TAP " + fmtInt(t) + " TIMES IN FULL GROOVE",
  buys: (t) => "MAKE " + fmtInt(t) + " PURCHASES HERE",
  answer: (t) => (t > 1 ? "ANSWER THE CALL " + t + " TIMES" : "ANSWER THE CALL HERE"),
};
export function siteOf(s) { return SITES[s.site] || SITES[0]; }
// The run's rules: the site's, with this run's fittings (see FIT) folded in. The last result is
// kept, keyed by everything it depends on, as this is asked for on every tap and price.
let fxKey = "", fxRun = null;
export function siteFx(s) {
  const base = siteOf(s).fx;
  if (!s.ft || !s.ft.length) return base;
  let key = String(s.site);
  for (const k of s.ft) key += "," + k + ":" + s.sv[k];
  if (key !== fxKey) { fxKey = key; fxRun = withFittings(base, s); }
  return fxRun;
}
export function siteMach(s, i) { const f = siteFx(s); return f.mach * (PROD[i].sky ? f.sky : f.ground) * (i === NP - 1 ? f.silent : 1); }
export const siteKnown = (s, k) => { const x = SITES[k]; return !!x && s.L >= x.req && (!x.need || x.need(s)); };
export const surveysDone = (s) => { let n = 0; for (const v of s.sv) n += v; return n; };
// The sounding to take where the outpost stands: kind, level, target (null once both are taken), progress.
// Sky and ground soundings count machines built here: the HEAD START kit's are not counted.
export function surveyOf(s) {
  const x = siteOf(s), lvl = s.sv[x.k] || 0, t = lvl < SURVEY_LEVELS ? x.sv.t[lvl] : null;
  let v = s.sx;
  if (x.sv.k === "sky" || x.sv.k === "ground") {
    const kit = KIT[s.tree[0]] || [];
    v = 0;
    for (let i = 0; i < NP; i++) if (PROD[i].sky === (x.sv.k === "sky")) v = Math.max(v, s.own[i] - (kit[i] || 0));
  }
  return { k: x.sv.k, lvl, t, v, frac: t ? clamp(v / t, 0, 1) : 1, text: t ? SURVEY[x.sv.k](t) : "BOTH SOUNDINGS TAKEN" };
}
// The three sites offered at the next relocation (never the current one): the silent coast while
// the call waits for an answer, then a site with its first sounding still to take, the rest at random.
// `rnd` returns numbers in [0, 1).
export function offerSites(s, rnd) {
  const pool = [];
  for (let k = 0; k < NSITE; k++) if (k !== s.site && siteKnown(s, k)) pool.push(k);
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const out = [];
  if (pool.includes(SILENT) && !s.ans) out.push(SILENT);
  const fresh = pool.find((k) => !s.sv[k] && !out.includes(k));
  if (fresh !== undefined) out.push(fresh);
  for (const k of pool) if (out.length < 3 && !out.includes(k)) out.push(k);
  return out;
}

// THE CALL: a melody hidden in the signal, decoded four notes at a time, a fragment per sounding
// (CALL_ORDER says which group each fragment opens), with a log line per fragment. Undecoded notes play as a low drone
// on its tonic. Once answered, it gains its answer: a closing phrase that comes home.
export const CALL_ID = 101; // the save's s.sg value for THE CALL (a saved value: never change it)
export const CALL_FRAGS = 11;
export const CALL = "G#4 G#4 C#5 B4 G#4 E4 F#4 G#4 B4 A4 G#4 | G#4 G#4 C#5 B4 G#4 E5 D#5 C#5 B4 A4 B4 | E5 D#5 C#5 B4 C#5 D#5 E5 F#5 E5 D#5 C#5 | G#4 G#4 C#5 B4 A4 G#4 F#4 E4 D#4 E4 G#4";
export const CALL_ANSWER = "C#5 B4 G#4 A4 F#4 G#4 E4 D#4 C#4";
export const CALL_ORDER = [0, 5, 2, 8, 10, 3, 6, 1, 9, 4, 7];
export const CALL_DRONE = 61; // C#4
export const CALL_LOG = [
  "A PATTERN UNDER THE NOISE. IT REPEATS.",
  "IT IS NOT NATURAL. IT IS IN C SHARP MINOR.",
  "IT REPEATS EVERY ELEVEN MINUTES, TO THE SECOND.",
  "IT IS A MELODY. SOMEONE IS PLAYING IT.",
  "THE SOURCE IS ON THIS WORLD, NOT IN THE SKY.",
  "IT CHANGES WHEN WE PLAY. IT IS LISTENING.",
  "THE MACHINES HUM ALONG WITHOUT BEING TOLD.",
  "A BEARING AT LAST: A COAST WHERE NOTHING SOUNDS.",
  "IT IS NOT A WARNING. IT IS AN INVITATION.",
  "IT ENDS ON AN OPEN NOTE. A PLACE FOR A REPLY.",
  "THE CALL IS WHOLE. THE SILENT COAST IS ON THE MAP.",
];
export const CALL_ANSWERED = "WE ANSWERED. THE COAST IS SILENT NO MORE.";
export const CHORUS_MULT = 2; // all output, once the call is answered
export const FINALE_SEC = 12; // how long app.finale lasts after the call is answered (the scene and lamps draw it)
// The call as far as `cf` fragments have decoded it (answered: with its closing phrase).
// `hidden[i]` marks a note still undecoded (it plays the drone).
export function callMelody(cf, answered = false) {
  const open = new Set(CALL_ORDER.slice(0, clamp(Math.floor(cf), 0, CALL_FRAGS)));
  let at = 0;
  const hidden = [];
  const phrases = CALL.split("|").map((p) => p.trim().split(/\s+/).map((name) => {
    const i = at++, shut = !open.has(Math.floor(i / 4));
    hidden.push(shut);
    return shut ? CALL_DRONE : noteOf(name);
  }));
  if (answered) phrases.push(CALL_ANSWER.split(" ").map((name) => { hidden.push(false); return noteOf(name); }));
  const m = makeMelody(answered ? "THE CALL AND ANSWER" : cf >= CALL_FRAGS ? "THE CALL" : "THE CALL " + Math.floor(cf) + "/" + CALL_FRAGS, phrases, "C#", "min");
  m.hidden = hidden;
  return m;
}
const NOTE_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function noteOf(name) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  return 12 * (Number(m[3]) + 1) + NOTE_PC[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
}

// ---- the workshop ----------------------------------------------------------------------------
// Each site's first sounding brings back the blueprint of a fitting, and its second sounding the
// MK II. Once FIT_OPEN blueprints are known the workshop opens: FIT_AT minutes into each run it
// builds a fitting, and the player chooses which of (up to) three offered blueprints. A fitting
// is a share of its site's rule with no drawback, and lasts until the outpost relocates.
// FIT[k] belongs to SITES[k]; fx[0] is MK I and fx[1] MK II, folded into siteFx: hum, cap and
// growth add, everything else multiplies. d holds each mark's lines for the ring (at most 26
// characters each), s each mark's one-line summary for notes (at most 31).
export const FIT = [
  { n: "SPARE PARTS", fx: [{ upg: 0.75 }, { upg: 0.5 }], d: [["UPGRADES COST x0.75"], ["UPGRADES COST x0.5"]] },
  { n: "SKY RACK", fx: [{ sky: 1.5 }, { sky: 2 }], d: [["SKY MACHINES x1.5"], ["SKY MACHINES x2"]] },
  { n: "GROUND RACK", fx: [{ ground: 1.5 }, { ground: 2 }], d: [["GROUND MACHINES x1.5"], ["GROUND MACHINES x2"]] },
  { n: "SPRING KEY", fx: [{ tap: 2 }, { tap: 3 }], d: [["TAPS x2"], ["TAPS x3"]] },
  { n: "NIGHT BATTERY", fx: [{ cap: 6 }, { cap: 12, mach: 1.1 }], d: [["AWAY CREDIT +6 H"], ["AWAY CREDIT +12 H", "MACHINES x1.1"]], s: [null, "AWAY +12 H, MACHINES x1.1"] },
  { n: "HUM COIL", fx: [{ hum: 0.25, humT: 1.5 }, { hum: 0.5, humT: 2 }], d: [["HUM +0.25, 1.5x AS LONG"], ["HUM +0.5, TWICE AS LONG"]] },
  { n: "FLARE MAST", fx: [{ flare: 1.5 }, { flare: 2 }], d: [["FLARES 1.5x AS OFTEN"], ["FLARES TWICE AS OFTEN"]] },
  { n: "FIELD KIT", fx: [{ exp: 1.5 }, { exp: 2, relic: 1.25 }], d: [["EXPEDITIONS 1.5x AS FAST"], ["EXPEDITIONS TWICE AS FAST", "RELICS x1.25 AS LIKELY"]], s: [null, "EXPEDITIONS x2, RELICS x1.25"] },
  { n: "SPECTROMETER", fx: [{ data: 2 }, { data: 3, res: 1.25 }], d: [["DATA x2"], ["DATA x3", "RESEARCH 1.25x AS FAST"]], s: [null, "DATA x3, RESEARCH x1.25"] },
  { n: "METRONOME", fx: [{ groove: 2 }, { groove: 2, tune: 1.5 }], d: [["GROOVE FILLS TWICE AS FAST", "FULL GROOVE x2 (NOT x1.5)"], ["GROOVE FILLS TWICE AS FAST", "FULL GROOVE x2, TUNES x1.5"]],
    s: ["GROOVE TWICE AS FAST AND STRONG", "GROOVE x2, TUNE BONUSES x1.5"] },
  { n: "SAND SLED", fx: [{ growth: -0.005 }, { growth: -0.01 }], d: [["MACHINE PRICES RISE SLOWER"], ["MACHINE PRICES RISE", "MUCH SLOWER"]], s: [null, "PRICES RISE MUCH SLOWER"] },
  { n: "QUIET ROOM", fx: [{ silent: 2 }, { silent: 3 }], d: [["SILENT ARRAYS x2"], ["SILENT ARRAYS x3"]] },
];
export const NFIT = FIT.length;
export const FIT_AT = [3, 10, 25]; // minutes into a run when the workshop builds a fitting
export const FIT_OPEN = 3; // blueprints known before the workshop opens
const FX_ADD = new Set(["hum", "cap", "growth"]);
// 0: no blueprint yet, 1: MK I, 2: MK II.
export const fitMark = (s, k) => Math.min(s.sv[k] || 0, FIT[k].fx.length);
export const blueprints = (s) => { let n = 0; for (let k = 0; k < NFIT; k++) if (s.sv[k] > 0) n++; return n; };
export const workshopOpen = (s) => blueprints(s) >= FIT_OPEN;
// How many fittings the workshop has built this run so far (fitted or waiting to be chosen).
export const fitsBuilt = (s) => (workshopOpen(s) ? FIT_AT.filter((m) => s.play >= m * 60).length : 0);
export const fitName = (s, k) => FIT[k].n + (fitMark(s, k) > 1 ? " II" : "");
export const fitLines = (s, k) => FIT[k].d[Math.max(0, fitMark(s, k) - 1)];
// One line for a note: what blueprint k does at mark m (1 or 2).
export const fitSummary = (k, m) => FIT[k].s?.[m - 1] || FIT[k].d[m - 1].join(", ");
// The blueprints offered for the next fitting: up to three known ones not fitted this run.
export function offerFits(s, rnd) {
  const pool = [];
  for (let k = 0; k < NFIT; k++) if (s.sv[k] > 0 && !s.ft.includes(k)) pool.push(k);
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, 3);
}
function withFittings(base, s) {
  const fx = { ...base };
  for (const k of s.ft) {
    const m = FIT[k] ? fitMark(s, k) : 0;
    if (!m) continue;
    for (const [key, v] of Object.entries(FIT[k].fx[m - 1])) fx[key] = FX_ADD.has(key) ? fx[key] + v : fx[key] * v;
  }
  return fx;
}

// Feats for the console logbook (ctx.feat), each reported once (bit k of s.fe).
export const FEATS = [
  ["first-relocation", "FIRST RELOCATION", (s) => s.runs >= 1],
  ["full-groove", "FULL GROOVE", (s) => !!(s.ev & EV.groove)],
  ["perfect", "A PERFECT PERFORMANCE", (s) => !!(s.ev & EV.perfect)],
  ["first-sounding", "FIRST SOUNDING", (s) => surveysDone(s) >= 1],
  ["deep-sky", "DEEP-SKY ARRAY BUILT", (s) => s.maxTier >= 9],
  ["silent-array", "THE SILENT ARRAY BUILT", (s) => s.maxTier >= 11],
  ["first-constellation", "FIRST CONSTELLATION", (s) => s.cn >= 1],
  ["call-decoded", "THE CALL DECODED", (s) => s.cf >= CALL_FRAGS],
  ["call-answered", "THE CALL ANSWERED", (s) => s.ans >= 1],
  ["every-site", "EVERY SITE SOUNDED", (s) => s.sv.every((v) => v >= 1)],
  ["whole-sky", "THE WHOLE SKY CHARTED", (s) => s.cn >= 12],
  ["fully-fitted", "THREE FITTINGS IN ONE RUN", (s) => s.ft.length >= FIT_AT.length],
];

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

export const costOf = (s, i, n = s.own[i]) => Math.ceil(PROD[i].c * Math.pow(siteFx(s).growth, Math.min(n, MAX_OWN)) * Math.pow(0.94, s.tree[2]));
export const upgCost = (s, u) => u.cost * siteFx(s).upg;
export const milestonesAt = (n) => MILESTONES.filter((m) => n >= m).length;
export const nextMilestone = (n) => MILESTONES.find((m) => n < m) || 0;
export const globalMult = (s) => {
  let g = (1 + s.L * (0.2 + 0.04 * s.tree[6])) * (1 + 0.25 * s.tree[9]) * (1 + 0.03 * s.relics) * (1 + 0.01 * s.gl.length) * (1 + 0.02 * masteredN(s)) * Math.pow(CHART_MULT, s.cn)
    * (1 + SURVEY_BONUS * surveysDone(s)) * (s.ans > 0 ? CHORUS_MULT : 1);
  for (const k of GRID_IDX) if (s.up[k]) g *= 1.3;
  return num(g);
};
export function prodMult(s, i) {
  let m = 2 ** milestonesAt(s.own[i]);
  for (const k of PROD_UPG[i]) if (s.up[k]) m *= 2;
  let add = 0;
  for (const y of SYN_BY_DST[i]) if (s.up[y.idx]) add += 0.02 * s.own[y.src] * (1 + 0.5 * s.tree[8]);
  return num(m * (1 + add) * siteMach(s, i));
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
  let h = BASE_CAP_H + 4 * s.tree[3] + siteFx(s).cap;
  for (const u of UPG) if (u.kind === "cap" && s.up[u.idx]) h += u.hours;
  return h;
};
export const pendingOf = (s) => int(Math.pow(s.rt / PRESTIGE_K, 0.25), 1e9);
export const revealOf = (s) => { const p = pendingOf(s); return p >= 3 || (s.runs > 0 && p >= 1); };
// How many times the bearings already held a relocation should bring before it is called ready:
// twice early on, less once the holdings are large, and less and less past READY_LATE (a run
// needs the fourth power of its bearings in signal, so a fixed ratio makes late runs grow without end).
export const readyRatio = (L) => (L < 500 ? READY_RATIO : L < 5000 ? 1.6 : L < READY_LATE ? 1.35 : Math.max(READY_FLOOR, 1.25 * Math.pow(READY_LATE / L, READY_FALL)));
export const readyOf = (s) => { const p = pendingOf(s); return p >= READY_MIN && p >= readyRatio(s.L) * s.L; };
export const slotsOf = (s) => (s.tree[5] ? s.tree[5] : 0);

export function upgradeVisible(s, u) {
  if (s.up[u.idx]) return false;
  const rtNeed = u.rt ?? 0;
  if (s.rt < Math.max(rtNeed, 0.2 * upgCost(s, u))) return false;
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
    st: freshStats(), f: Date.now(), fk: 1, sg: 0, sp: 0, gs: 1, sm: 0, sc: Array(NS).fill(0), gl: [], ev: 0, rd: [], rs: [], dat: 0, cn: 0,
    site: 0, sx: 0, sv: Array(NSITE).fill(0), of: [], cf: 0, ans: 0, fe: 0, ft: [] };
}
export function applyKit(s) {
  const l = s.tree[0], kit = KIT[l] || [];
  let added = 0;
  kit.forEach((n, i) => { if (s.own[i] < n) { added += n - s.own[i]; s.own[i] = n; s.maxTier = Math.max(s.maxTier, i); } });
  return added;
}

// ---- saving -------------------------------------------------------------------
const KNOWN = new Set(["v", "t", "sig", "rt", "lt", "own", "up", "taps", "b", "L", "tree", "relics", "runs", "maxTier", "ex", "play", "last", "milestone",
  "st", "f", "fk", "sg", "sp", "gs", "sm", "sc", "gl", "ev", "rd", "rs", "dat", "cn", "site", "sx", "sv", "of", "cf", "ans", "fe", "ft"]);
export function serialize(s, t) {
  const out = { v: SCHEMA, t, sig: num(s.sig), rt: num(s.rt), lt: num(s.lt), own: s.own.slice(), up: [], taps: s.taps, b: s.b, L: s.L,
    tree: s.tree.slice(), relics: s.relics, runs: s.runs, maxTier: s.maxTier, ex: s.ex.map((e) => [e.k, e.end]), play: Math.floor(s.play),
    last: s.last, milestone: s.milestone, st: Object.fromEntries(Object.entries(s.st).map(([k, v]) => [k, Math.round(v * 100) / 100])), f: s.f, fk: s.fk, sg: s.sg, sp: s.sp, gs: s.gs, sm: s.sm, sc: s.sc.slice(), gl: s.gl.slice(),
    ev: s.ev, rd: s.rd.slice(), rs: s.rs.map((e) => [e.k, e.end]), dat: Math.round(s.dat * 100) / 100, cn: s.cn,
    site: s.site, sx: Math.round(s.sx * 100) / 100, sv: s.sv.slice(), of: s.of.slice(), cf: s.cf, ans: s.ans, fe: s.fe, ft: s.ft.slice() };
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
    s.sg = Number(r.sg) === GEN_ID || Number(r.sg) === CALL_ID ? Number(r.sg) : int(r.sg, NS - 1);
    s.sp = int(r.sp, 5000); s.gs = (Number(r.gs) >>> 0) || 1; s.sm = int(r.sm, 2);
    if (Array.isArray(r.sc)) for (let i = 0; i < NS; i++) s.sc[i] = int(r.sc[i], 1e9);
    if (Array.isArray(r.gl)) for (const k of r.gl) { const i = Math.floor(Number(k)); if (i >= 0 && i < NG && !s.gl.includes(i)) s.gl.push(i); }
    s.ev = int(r.ev, 255);
    if (Array.isArray(r.rd)) for (const k of r.rd) { const i = Math.floor(Number(k)); if (i >= 0 && i < NR && !s.rd.includes(i)) s.rd.push(i); }
    if (Array.isArray(r.rs)) for (const e of r.rs.slice(0, 3)) if (Array.isArray(e) && e[0] >= 0 && e[0] < NR) s.rs.push({ k: Math.floor(e[0]), end: num(Number(e[1]), 1e15) });
    s.dat = num(Number(r.dat), 1e12);
    s.cn = int(r.cn, CHART_MAX); // schema 4 (a schema 3 save has none: 0)
  }
  // schema 5: sites, surveys and the call (an older save stands at the landing site, nothing surveyed)
  if (v >= 5) {
    const site = Math.floor(Number(r.site));
    s.site = site >= 0 && site < NSITE ? site : 0; s.sx = num(Number(r.sx), 1e15);
    if (Array.isArray(r.sv)) for (let k = 0; k < NSITE; k++) s.sv[k] = int(r.sv[k], SURVEY_LEVELS);
    s.cf = int(r.cf, CALL_FRAGS); s.ans = int(r.ans, 1e6); s.fe = int(r.fe, 2 ** 30);
    if (Array.isArray(r.of)) for (const x of r.of.slice(0, 3)) { const k = Math.floor(Number(x)); if (k >= 0 && k < NSITE && k !== s.site && !s.of.includes(k)) s.of.push(k); }
    // keep the story whole in an odd or hand-edited save: every sounding at an ordinary site
    // decoded a fragment until the call was whole, and the silent coast's first sounding is the answer
    let ordinary = 0;
    for (let k = 0; k < NSITE; k++) if (k !== SILENT) ordinary += s.sv[k];
    s.cf = Math.max(s.cf, Math.min(CALL_FRAGS, ordinary));
    if (s.ans) { s.cf = CALL_FRAGS; s.sv[SILENT] = Math.max(1, s.sv[SILENT]); } else s.sv[SILENT] = 0;
    if (s.site === SILENT && s.cf < CALL_FRAGS) { s.site = 0; s.sx = 0; }
  }
  // schema 6: this run's fittings (an older save has none). Only known blueprints, each once.
  if (v >= 6 && Array.isArray(r.ft)) {
    for (const x of r.ft.slice(0, FIT_AT.length)) { const k = Math.floor(Number(x)); if (k >= 0 && k < NFIT && s.sv[k] > 0 && !s.ft.includes(k)) s.ft.push(k); }
  }
  if (v > SCHEMA) {
    const extra = {};
    for (const key of Object.keys(raw)) if (!KNOWN.has(key)) extra[key] = raw[key];
    s.extra = extra;
  }
  return { s, t: num(Number(r.t), 1e15), future: v > SCHEMA, upgraded, from: v };
}
