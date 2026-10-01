// OUTPOST — a one-button incremental game. A lone survey station gathers signal.
// Tap to gather by hand; hold to open the build ring (taps step through what can be
// bought, a hold-and-release buys). Signal buys machines, machines unlock better machines,
// upgrades and synergies multiply them, "relocating" trades the whole station for permanent
// bearings and a small tree of lasting bonuses, and after that come expeditions on wall-clock
// timers and rare signal flares. The station keeps working while the game is closed: the
// next launch credits the production earned meanwhile (capped, and the cap can be raised).
//
// Every gathering tap plays the next note of a melody (a songbook of public-domain tunes plus
// seeded generated ones), so the player's own rhythm is the tempo. Finishing phrases and tunes
// pays a bonus, and the instrument can be given more voices. There is a statistics view, a goal
// list with small permanent rewards, and a research track (timers that run while closed) that
// unlocks new kinds of things: generated tunes, voices, an expedition, two late machines.
//
// Taps that keep a steady beat build GROOVE (up to x1.5 per tap and per phrase); a stumble
// halves it and a pause lets it fade. Late on, bearings left over after the tree can chart
// CONSTELLATIONS: each multiplies all output and draws itself into the sky, without end.
//
// Numbers are plain doubles clamped to BIG (1e150) everywhere they can grow, so nothing
// reaches Infinity or NaN. The save is one small JSON object (schema 4; schemas 1-3 migrate).
// The three lamps are the status board: left breathes with production, middle fills toward
// the next purchase and goes steady green when one is affordable, right shows the timed
// thing (flare, boost, expedition) or that relocation is worth doing. On top of that, each tap
// lights the lamp for where its note sits in the melody's range (a short glow), and phrase and
// tune endings add a sweep; between taps the status board is all that remains.
import { C, space, text, line, circle, diamond, banner, wrapText } from "../engine/draw.js";
import { TAU, clamp } from "../engine/math.js";
import { LAMP, lamps, dim, pulse, blink, spot, only, chase, lightsOff } from "../engine/lightshow.js";

// ---- constants ---------------------------------------------------------------
const SCHEMA = 4;
const BIG = 1e150; // every growing number is clamped here
const GROWTH = 1.15; // cost growth per machine owned
const MAX_OWN = 1500;
const MILESTONES = [10, 25, 50, 100, 150, 200, 250, 300]; // owned counts that double a machine
const PRESTIGE_K = 1.2e5; // run signal at which one bearing is earned (gain = floor((run / K) ^ 0.25))
const READY_MIN = 8; // bearings worth relocating for ...
const READY_RATIO = 2; // ... and at least this many times the bearings already held, so later runs do not shrink to sprints
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
const LUMP_SEC = 0.08; // a finished tune pays this many seconds of production per note (more with voices)
// Groove: a tap within GROOVE_TOL of the recent beat adds a step; GROOVE_MAX steps add GROOVE_BONUS
// (half again) to every tap and phrase.
const GROOVE_BONUS = 0.5, GROOVE_MAX = 24, GROOVE_TOL = 0.2, GROOVE_MIN_GAP = 0.12, GROOVE_MAX_GAP = 1.5, GROOVE_FADE = 8;
// Voice levels under the lead (ctx.tone's gain): the station's extra voices sit quietly beneath it.
const VOICE_GAIN = [0.4, 0.25, 0.45, 0.2];
// Constellations: charted with bearings once the outpost has held CHART_REQ of them; each one
// multiplies all output by CHART_MULT and costs CHART_GROWTH times the one before.
const CHART_REQ = 1000, CHART_BASE = 250, CHART_GROWTH = 1.45, CHART_MULT = 1.3, CHART_MAX = 200;

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
  // schema 3: two late machines, each unlocked by a research project
  { n: "ZERO-POINT LISTENER", c: 1.4e12, r: 1.1e7, fx: "hears between the quanta" },
  { n: "SILENT ARRAY", c: 2.6e13, r: 8e7, fx: "answers what nobody sent" },
];
const NP = PROD.length;
const NP0 = 10; // machines that existed before schema 3 (their upgrade indices must never move)
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
  ["VACUUM CAVITY", "ZERO-POINT TRIM", "NULL FIELD"],
  ["SILENCE FILTER", "ANTI-ECHO", "THE LAST CHANNEL"],
];

// Every one-time upgrade, in a fixed order (the save stores indices into this list).
// kind: prod (x2 one machine), tap (tap x2 or +fraction of rate), cap (offline hours),
// grid (x1.3 everything), syn (dst machines gain per source owned).
const UPG = [];
const addUpg = (u) => UPG.push({ idx: UPG.length, ...u });
const tierReq = [1, 10, 30], tierCost = [10, 150, 3000];
const PROD_UPG = PROD.map(() => []);
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
const SYN = [];
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
const VOICE = [];
[["THIRD HARMONY", 4e4, 1e4, "EACH NOTE GAINS A SOFT THIRD ABOVE"], ["OCTAVE SHIMMER", 6e6, 2e6, "A QUIET OCTAVE ABOVE EACH NOTE"],
  ["MACHINE BASS", 8e8, 2e8, "THE MACHINES PLAY A LOW NOTE AT EACH PHRASE"], ["BELL PARTIALS", 6e10, 1.5e10, "NOTES RING LIKE BELLS"]].forEach((v, lvl) => {
  VOICE.push(UPG.length);
  addUpg({ kind: "voice", lvl, name: v[0], cost: v[1], rt: v[2], eff: v[3] + ". TUNE BONUSES +25%" });
});
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
  // schema 3
  { n: "PERFECT PITCH", max: 4, req: 3, cost: (l) => 2 * 2 ** l, eff: () => "PHRASE AND TUNE BONUSES +50%" },
  { n: "SECOND BENCH", max: 2, req: 12, cost: (l) => 6 * 4 ** l, eff: () => "ONE MORE RESEARCH PROJECT AT A TIME" },
  { n: "DEEP LISTENING", max: 4, req: 20, cost: (l) => 5 * 3 ** l, eff: () => "+25% DATA FROM EVERY SOURCE" },
];
const NT = TREE.length;
const KIT = [[], [10, 4], [25, 15, 5, 2], [40, 30, 18, 10, 4], [60, 45, 30, 20, 10, 3], [80, 60, 45, 32, 20, 8, 2]];
const KIT_SIGNAL = [0, 1000, 30000, 600000, 1.2e7, 3e8];
const AUTO_EVERY = [0, 12, 6, 3];
const EXPED = [
  { n: "SHORT SURVEY", sec: 180, mins: 1.3, relic: 0, data: 0.5 },
  { n: "FIELD TRAVERSE", sec: 1200, mins: 10, relic: 0.1, data: 1.5 },
  { n: "DEEP SURVEY", sec: 5400, mins: 54, relic: 0.35, data: 4 },
  { n: "FAR TRAVERSE", sec: 14400, mins: 300, relic: 0.7, data: 12, res: 3 }, // needs the FAR TRAVERSE CHARTS research
];
const MAX_RELICS = 20;
const SUFFIX = ["", "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc"];

// ---- the songbook ------------------------------------------------------------------------
// Melodies are lists of note names (letter, optional # or b, octave; middle C is C4), with "|"
// between phrases. Note lengths are not stored: the player's taps are the rhythm. `at` is the
// lifetime signal at which the tune joins the songbook. Every tune is traditional or by a
// composer who died more than a century ago; `by` names the source.
const SONGS = [
  { id: "twinkle", name: "TWINKLE TWINKLE", by: "FRENCH TUNE, MOZART VARIATIONS 1781", key: "C", mode: "maj", at: 0,
    notes: "C4 C4 G4 G4 A4 A4 G4 | F4 F4 E4 E4 D4 D4 C4 | G4 G4 F4 F4 E4 E4 D4 | G4 G4 F4 F4 E4 E4 D4 | C4 C4 G4 G4 A4 A4 G4 | F4 F4 E4 E4 D4 D4 C4" },
  { id: "row", name: "ROW ROW ROW YOUR BOAT", by: "TRADITIONAL, 1852", key: "C", mode: "maj", at: 100,
    notes: "C4 C4 C4 D4 E4 | E4 D4 E4 F4 G4 | C5 C5 C5 G4 G4 G4 E4 E4 E4 C4 C4 C4 | G4 F4 E4 D4 C4" },
  { id: "ode", name: "ODE TO JOY", by: "BEETHOVEN, 1824", key: "C", mode: "maj", at: 600,
    notes: "E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 E4 D4 D4 | E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 D4 C4 C4 | D4 D4 E4 C4 D4 E4 F4 E4 C4 D4 E4 F4 E4 D4 C4 D4 G3 | E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 D4 C4 C4" },
  { id: "jacques", name: "FRERE JACQUES", by: "FRENCH TRADITIONAL", key: "C", mode: "maj", at: 3e3,
    notes: "C4 D4 E4 C4 | C4 D4 E4 C4 | E4 F4 G4 | E4 F4 G4 | G4 A4 G4 F4 E4 C4 | G4 A4 G4 F4 E4 C4 | C4 G3 C4 | C4 G3 C4" },
  { id: "jingle", name: "JINGLE BELLS", by: "PIERPONT, 1857", key: "C", mode: "maj", at: 1.5e4,
    notes: "E4 E4 E4 | E4 E4 E4 | E4 G4 C4 D4 E4 | F4 F4 F4 F4 | F4 E4 E4 E4 E4 | E4 D4 D4 E4 D4 G4" },
  { id: "susanna", name: "OH SUSANNA", by: "FOSTER, 1848", key: "C", mode: "maj", at: 8e4,
    notes: "C4 D4 E4 G4 G4 A4 G4 E4 | C4 D4 E4 E4 D4 C4 D4 | C4 D4 E4 G4 G4 A4 G4 E4 | C4 D4 E4 E4 D4 D4 C4" },
  { id: "yankee", name: "YANKEE DOODLE", by: "TRADITIONAL, 1700S", key: "C", mode: "maj", at: 4e5,
    notes: "C4 C4 D4 E4 C4 E4 D4 G3 | C4 C4 D4 E4 C4 B3 | C4 C4 D4 E4 F4 E4 D4 C4 B3 G3 A3 B3 C4 C4" },
  { id: "auld", name: "AULD LANG SYNE", by: "SCOTTISH TRADITIONAL", key: "C", mode: "maj", at: 2e6,
    notes: "G3 C4 C4 C4 E4 D4 C4 D4 E4 C4 C4 E4 G4 A4 A4 | G4 E4 E4 C4 D4 C4 D4 E4 C4 A3 A3 G3 C4 | A4 G4 E4 E4 C4 D4 C4 D4 A4 G4 E4 E4 G4 A4 A4 | G4 E4 E4 C4 D4 C4 D4 E4 C4 A3 A3 G3 C4" },
  { id: "greensleeves", name: "GREENSLEEVES", by: "ENGLISH TRADITIONAL, 16TH C.", key: "E", mode: "min", at: 1e7,
    notes: "E4 G4 A4 B4 C5 B4 A4 F#4 D4 E4 F#4 G4 E4 E4 D#4 E4 F#4 D#4 B3 | E4 G4 A4 B4 C5 B4 A4 F#4 D4 E4 F#4 G4 F#4 E4 D#4 C#4 D#4 E4 | D5 D5 C#5 B4 A4 F#4 D4 E4 F#4 G4 E4 E4 D#4 E4 F#4 D#4 B3 | D5 D5 C#5 B4 A4 F#4 D4 E4 F#4 G4 F#4 E4 D#4 C#4 D#4 E4" },
  { id: "scarborough", name: "SCARBOROUGH FAIR", by: "ENGLISH BALLAD, 17TH C.", key: "E", mode: "dor", at: 5e7,
    notes: "E4 E4 B4 B4 F#4 G4 F#4 E4 | B4 D5 E5 D5 B4 C#5 A4 B4 | E5 E5 E5 D5 B4 B4 A4 G4 F#4 D4 | E4 B4 A4 G4 F#4 E4 D4 E4" },
  { id: "grace", name: "AMAZING GRACE", by: "NEW BRITAIN, 1829-35", key: "G", mode: "pent", at: 3e8,
    notes: "D4 G4 B4 G4 B4 A4 G4 E4 D4 | D4 G4 B4 G4 B4 A4 D5 | B4 D5 B4 D5 B4 G4 D4 E4 G4 G4 E4 D4 | D4 G4 B4 G4 B4 A4 G4" },
  { id: "brahms", name: "BRAHMS'S LULLABY", by: "BRAHMS, 1868", key: "Eb", mode: "maj", at: 2e9,
    notes: "G4 G4 Bb4 G4 G4 Bb4 G4 Bb4 Eb5 D5 C5 C5 Bb4 F4 G4 | Ab4 F4 F4 G4 Ab4 F4 Ab4 D5 C5 Bb4 D5 Eb5 Eb4 Eb4 | Eb5 C5 Ab4 Bb4 G4 Eb4 Ab4 Bb4 C5 Bb4 Eb4 Eb4 | Eb5 C5 Ab4 Bb4 G4 Eb4 Ab4 G4 F4 Eb4" },
  { id: "elise", name: "FUR ELISE", by: "BEETHOVEN, 1810", key: "A", mode: "min", at: 1.5e10,
    notes: "E5 D#5 E5 D#5 E5 B4 D5 C5 A4 C4 E4 A4 B4 E4 G#4 B4 C5 | E5 D#5 E5 D#5 E5 B4 D5 C5 A4 C4 E4 A4 B4 E4 C5 B4 A4" },
  { id: "minuet", name: "MINUET IN G", by: "PETZOLD, C. 1725", key: "G", mode: "maj", at: 1e11,
    notes: "D5 G4 A4 B4 C5 D5 G4 G4 E5 C5 D5 E5 F#5 G5 G4 G4 | C5 D5 C5 B4 A4 B4 C5 B4 A4 G4 F#4 G4 A4 B4 G4 A4 | B5 G5 A5 B5 G5 A5 D5 E5 F#5 D5 G5 E5 F#5 G5 D5 C#5 B4 C#5 A4 A4 B4 C#5 D5 E5 F#5 G5 F#5 E5 F#5 A5 D5 C#5 D5 | D5 G4 F#4 G4 E5 G4 F#4 G4 D5 C5 B4 A4 G4 F#4 G4 A4 D4 E4 F#4 G4 A4 B4 C5 B4 A4 B4 D5 G4 F#4 G4" },
  { id: "canon", name: "CANON IN D", by: "PACHELBEL, C. 1680", key: "D", mode: "maj", at: 8e11,
    notes: "F#5 E5 D5 C#5 B4 A4 B4 C#5 | D5 C#5 B4 A4 G4 F#4 G4 E4" },
  { id: "korobeiniki", name: "KOROBEINIKI", by: "RUSSIAN FOLK SONG, 1861", key: "E", mode: "min", at: 6e12,
    notes: "B4 F#4 G4 A4 G4 F#4 E4 E4 G4 B4 A4 G4 F#4 G4 A4 B4 G4 E4 E4 | A4 C5 E5 D5 C5 B4 G4 B4 A4 G4 F#4 F#4 G4 A4 B4 G4 E4 E4 | B4 G4 A4 F#4 G4 E4 D#4 | B4 G4 A4 F#4 G4 B4 E5 E5 D#5" },
  { id: "king", name: "MOUNTAIN KING", by: "GRIEG, 1875 (IN THE HALL OF THE MOUNTAIN KING)", key: "F#", mode: "mk", at: 5e13,
    notes: "F#4 G#4 A#4 B4 C#5 A#4 C#5 D5 A#4 D5 C#5 A#4 C#5 | F#4 G#4 A#4 B4 C#5 A#4 C#5 D5 A#4 D5 C#5 A#4 C#5" },
];
const NS = SONGS.length;
const GEN_ID = 100; // s.sg value meaning "the generated tune whose seed is s.gs"
const SCALES = { maj: [0, 2, 4, 5, 7, 9, 11], min: [0, 2, 3, 5, 7, 8, 10, 11], dor: [0, 2, 3, 5, 7, 9, 10], pent: [0, 2, 4, 7, 9], mk: [0, 2, 4, 5, 7, 8, 11] };
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const noteMidi = (name) => {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  return m ? 12 * (Number(m[3]) + 1) + PC[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) : 60;
};
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteName = (m) => NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const keyPc = (k) => noteMidi(k + "4") % 12;
// A playable melody: n = midi notes, ends = index of the last note of each phrase (the final one
// is the end of the tune), pcs = the scale's pitch classes (for harmonies), root = a low tonic.
function makeMelody(name, source, key, mode) {
  const phrases = typeof source === "string" ? source.split("|").map((p) => p.trim().split(/\s+/).map(noteMidi)) : source;
  const n = [], ends = [];
  for (const ph of phrases) { for (const m of ph) n.push(m); ends.push(n.length - 1); }
  const tonic = typeof key === "number" ? key : keyPc(key);
  const pcs = new Set(SCALES[mode].map((i) => (tonic + i) % 12));
  let lo = 127, hi = 0;
  for (const m of n) { lo = Math.min(lo, m); hi = Math.max(hi, m); }
  return { name, n, ends, pcs, tonic, lo, hi, root: 36 + tonic, mode };
}
const MEL = SONGS.map((sg) => makeMelody(sg.name, sg.notes, sg.key, sg.mode));
// A note `steps` scale degrees above m, staying in the tune's key.
function scaleUp(m, pcs, steps) {
  let out = m, left = steps;
  for (let guard = 0; left > 0 && guard < 24; guard++) { out++; if (pcs.has(out % 12)) left--; }
  return out;
}

// ---- generated tunes -----------------------------------------------------------------------
// A tune is a pure function of its seed: a scale, four phrases of eight notes in an A A' B A''
// shape, mostly stepwise, an occasional leap answered by a step back, phrases that end on the
// tonic, third or fifth (the last one on the tonic), and the third phrase set higher.
const GEN_MODES = ["maj", "maj", "min", "dor", "pent"];
const GEN_ADJ = ["PALE", "AMBER", "SLOW", "LONG", "COLD", "BRIGHT", "QUIET", "FAR"];
const GEN_NOUN = ["LANTERN", "TIDE", "ORBIT", "SIGNAL", "DUNE", "BEACON", "MERIDIAN", "FROST"];
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const genName = (seed) => GEN_ADJ[seed % 8] + " " + GEN_NOUN[(seed >>> 3) % 8] + " " + (10 + ((seed >>> 6) % 90));
function genTune(seed) {
  seed = (Number(seed) >>> 0) || 1;
  const r = seeded(seed);
  const mode = GEN_MODES[Math.floor(r() * GEN_MODES.length)];
  const sc = mode === "min" ? SCALES.min.slice(0, 7) : SCALES[mode], L = sc.length;
  const tonic = 57 + Math.floor(r() * 6); // A3..D#4, so the tune sits around 220-700 Hz
  const mod = (d) => ((d % L) + L) % L;
  const pitch = (d) => tonic + Math.floor(d / L) * 12 + sc[mod(d)];
  const stable = L === 5 ? [0, 2, 3] : [0, 2, 4];
  const lo = -1, hi = L + 2;
  const clampD = (d) => Math.min(hi, Math.max(lo, d));
  // the degree of stable class `idx` (0 tonic, 1 third, 2 fifth) nearest to `from`
  const endNear = (from, idx) => {
    let best = null;
    for (let x = lo; x <= hi; x++) if (mod(x) === stable[idx] && (best === null || Math.abs(x - from) < Math.abs(best - from))) best = x;
    return best;
  };
  // the last two notes: step onto the ending from the side we are coming from
  const finish = (out, idx) => {
    const from = out[out.length - 1], end = endNear(from, idx);
    out.push(clampD(end + (from > end ? 1 : from < end ? -1 : r() < 0.5 ? 1 : -1)), end);
    return out;
  };
  const phrase = (start, idx, len) => {
    const out = [start];
    let d = start, dir = r() < 0.5 ? 1 : -1, back = 0;
    for (let i = 1; i < len - 2; i++) {
      let step;
      if (back) { step = back; back = 0; } else {
        if (r() < 0.3) dir = -dir;
        const x = r();
        if (x < 0.1) step = 0; else if (x < 0.8) step = dir; else { step = dir * (r() < 0.6 ? 2 : 3); back = -dir; }
      }
      if (d + step < lo || d + step > hi) { dir = -dir; step = -Math.sign(step || dir) * Math.max(1, Math.abs(step)); back = 0; }
      d = clampD(d + step);
      out.push(d);
    }
    return finish(out, idx);
  };
  const vary = (src, idx) => { // same shape, two notes nudged, a new ending
    const out = src.slice(0, src.length - 2);
    for (let k = 0; k < 2; k++) { const i = 2 + Math.floor(r() * (out.length - 3)); out[i] = clampD(out[i] + (r() < 0.5 ? 1 : -1)); }
    return finish(out, idx);
  };
  const A = phrase(stable[Math.floor(r() * 3)], 1 + Math.floor(r() * 2), 8);
  const endClassA = mod(A[7]) === stable[1] ? 1 : 2;
  const B = vary(A, 3 - endClassA);
  const C = phrase(endNear(L + 1, 2), 1 + Math.floor(r() * 2), 8);
  const D = vary(A, 0);
  const phrases = [A, B, C, D].map((p) => p.map((d) => {
    let m = pitch(d);
    while (m > 84) m -= 12;
    while (m < 53) m += 12;
    return m;
  }));
  return makeMelody(genName(seed), phrases, tonic % 12, mode);
}

// ---- research ------------------------------------------------------------------------------
// Projects cost DATA (a slow second resource: goals, new tunes, expeditions and a trickle from
// the number of machine types running) and a wall-clock timer, so they finish while the game is
// closed. They are knowledge: they survive relocation. Each unlocks a new kind of thing.
const RES = [
  { n: "COMPOSER'S DESK", data: 4, sec: 360, need: (s) => s.lt >= 5e3, hint: "AT 5 K LIFETIME SIGNAL", fx: "UNLOCKS GENERATED TUNES AND SHUFFLE IN THE SONGBOOK" },
  { n: "SECOND VOICE", data: 10, sec: 720, need: (s) => hasRes(s, 0), hint: "NEEDS THE COMPOSER'S DESK", fx: "UNLOCKS VOICE UPGRADES: THE STATION SINGS IN PARTS" },
  { n: "FLARE NET", data: 25, sec: 1800, need: (s) => s.lt >= 1e6, hint: "AT 1 M LIFETIME SIGNAL", fx: "FLARES LAST 40% LONGER AND EACH ONE CAUGHT BRINGS 2 DATA" },
  { n: "FAR CHARTS", data: 40, sec: 5400, need: (s) => s.tree[5] > 0, hint: "NEEDS A SURVEY TEAM", fx: "UNLOCKS THE FAR TRAVERSE EXPEDITION (4 H, BIG FINDS)" },
  { n: "COLD STAR CHARTS", data: 80, sec: 10800, need: (s) => s.lt >= 1e11, hint: "AT 100 B LIFETIME SIGNAL", fx: "UNLOCKS THE ZERO-POINT LISTENER, A NEW MACHINE" },
  { n: "THE SILENT BAND", data: 250, sec: 28800, need: (s) => hasRes(s, 4) && s.lt >= 1e13, hint: "NEEDS COLD STAR CHARTS AND 10 T", fx: "UNLOCKS THE SILENT ARRAY, THE LAST MACHINE" },
];
const NR = RES.length;
const hasRes = (s, k) => s.rd.includes(k);
const resSlots = (s) => 1 + s.tree[11];
const tiersOwned = (s) => { let n = 0; for (let i = 0; i < NP; i++) if (s.own[i] > 0) n++; return n; };
const dataRate = (s) => 0.004 * tiersOwned(s) * (1 + 0.25 * s.tree[12]);
const dataBonus = (s) => 1 + 0.25 * s.tree[12];
const unlockedN = (s) => { let n = 0; for (const sg of SONGS) if (s.lt >= sg.at) n++; return n; };
const masteredN = (s) => { let n = 0; for (const c of s.sc) if (c >= 5) n++; return n; };

// ---- goals ---------------------------------------------------------------------------------
// Each goal is worth +1% output for ever and 2 data. `hid` goals show only a hint until done; the
// hints point at mechanics (event flags are bits of s.ev, set where the thing happens).
const EV = { presto: 1, perfect: 2, quick: 4, groove: 8 };
const GOALS = [
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
const NG = GOALS.length;
const goalFrac = (s, g) => clamp(g.v(s) / g.t, 0, 1);

// ---- sense of place ------------------------------------------------------------------------
const STAGES = ["LANDING SITE", "FIELD STATION", "SURVEY CAMP", "DEEP BASE", "LISTENING CAMPUS", "DEEP-SKY COMPLEX", "SILENT COAST"];
// Twelve named constellations (star positions in a 0..1 box, then the lines between them); later
// charts reuse the shapes, brighter, as "deep" charts.
const CONST = [
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
const chartCost = (k) => Math.ceil(CHART_BASE * Math.pow(CHART_GROWTH, k));
const chartName = (k) => (k < CONST.length ? CONST[k % CONST.length][0] : "DEEP " + CONST[k % CONST.length][0].replace("THE ", "") + " " + (Math.floor(k / CONST.length) + 1));
const chartsOpen = (s) => s.L >= CHART_REQ || s.cn > 0;
const stageOf = (s) => { const n = tiersOwned(s); return n < 1 ? 0 : n < 3 ? 1 : n < 5 ? 2 : n < 7 ? 3 : n < 9 ? 4 : n < 11 ? 5 : 6; };

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
const fmtInt = (n) => (n < 1e15 ? Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") : fmt(n));
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const fmtDate = (ms) => { const d = new Date(ms); return Number.isFinite(d.getTime()) ? d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear() : "?"; };
const FREE_KINDS = ["close", "back", "sub", "panel", "mode", "song", "songnew"]; // entries that cost nothing to choose
const HILLS = [[0, 424], [90, 408], [170, 418], [260, 394], [350, 412], [450, 400], [560, 416], [660, 398], [760, 414], [850, 402], [960, 420]];
const clock = (sec) => { sec = Math.max(0, Math.ceil(sec)); return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0"); };

const costOf = (s, i, n = s.own[i]) => Math.ceil(PROD[i].c * Math.pow(GROWTH, Math.min(n, MAX_OWN)) * Math.pow(0.94, s.tree[2]));
const milestonesAt = (n) => MILESTONES.filter((m) => n >= m).length;
const nextMilestone = (n) => MILESTONES.find((m) => n < m) || 0;
const globalMult = (s) => {
  let g = (1 + s.L * (0.2 + 0.04 * s.tree[6])) * (1 + 0.25 * s.tree[9]) * (1 + 0.03 * s.relics) * (1 + 0.01 * s.gl.length) * (1 + 0.02 * masteredN(s)) * Math.pow(CHART_MULT, s.cn);
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
// How many times the bearings already held a relocation should bring before it is called ready:
// twice early on, less once the holdings are large (otherwise late runs grow without end).
const readyRatio = (L) => (L < 500 ? READY_RATIO : L < 5000 ? 1.6 : L < 20000 ? 1.35 : 1.25);
const readyOf = (s) => { const p = pendingOf(s); return p >= READY_MIN && p >= readyRatio(s.L) * s.L; };
const slotsOf = (s) => (s.tree[5] ? s.tree[5] : 0);

function upgradeVisible(s, u) {
  if (s.up[u.idx]) return false;
  const rtNeed = u.rt ?? 0;
  if (s.rt < Math.max(rtNeed, 0.2 * u.cost)) return false;
  if (u.kind === "voice") return hasRes(s, 1) && (u.lvl === 0 || !!s.up[VOICE[u.lvl - 1]]);
  if (u.kind === "prod") return s.own[u.i] >= u.need;
  if (u.kind === "syn") return s.own[u.src] >= u.need && s.own[u.dst] >= u.need;
  return true;
}
const tierOpen = (s, i) => i < NP0 || hasRes(s, i === NP0 ? 4 : 5); // the two late machines need their research
function prodVisible(s, i) {
  if (s.own[i] > 0) return true;
  return tierOpen(s, i) && i <= s.maxTier + 1 && s.rt >= 0.3 * costOf(s, i);
}

// Statistics: counts that began at the migration (or at founding) are marked with * on screen.
// tp/ta seconds played and away, hand/mach/off/bon signal by source (off = credited while away,
// bon = flares, expeditions), rtaps/rhand/rmach the same for this run, fr the fastest relocation.
const ST_KEYS = ["rp", "hand", "mach", "off", "bon", "peak", "tp", "ta", "buys", "md", "nt", "ph", "fl", "ex", "fr", "rtaps", "rhand", "rmach", "gen", "gb", "gt"]; // schema 4: gb best groove, gt taps in full groove
const freshStats = () => Object.fromEntries(ST_KEYS.map((k) => [k, 0]));
function freshState() {
  return { sig: 0, rt: 0, lt: 0, own: Array(NP).fill(0), up: new Uint8Array(NUP), taps: 0, b: 0, L: 0, tree: Array(NT).fill(0),
    relics: 0, runs: 0, maxTier: 0, ex: [], play: 0, last: {}, milestone: 0, extra: null,
    st: freshStats(), f: Date.now(), fk: 1, sg: 0, sp: 0, gs: 1, sm: 0, sc: Array(NS).fill(0), gl: [], ev: 0, rd: [], rs: [], dat: 0, cn: 0 };
}
function applyKit(s) {
  const l = s.tree[0], kit = KIT[l] || [];
  let added = 0;
  kit.forEach((n, i) => { if (s.own[i] < n) { added += n - s.own[i]; s.own[i] = n; s.maxTier = Math.max(s.maxTier, i); } });
  return added;
}

// ---- saving -------------------------------------------------------------------
const KNOWN = new Set(["v", "t", "sig", "rt", "lt", "own", "up", "taps", "b", "L", "tree", "relics", "runs", "maxTier", "ex", "play", "last", "milestone",
  "st", "f", "fk", "sg", "sp", "gs", "sm", "sc", "gl", "ev", "rd", "rs", "dat", "cn"]);
function serialize(s, t) {
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

// ---- the cartridge -----------------------------------------------------------
export class Outpost {
  constructor(ctx) {
    this.c = ctx;
    const loaded = migrate(ctx.progress?.());
    this.s = loaded.s;
    this.loadMelody();
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
    this.recent = []; // the last few gathering taps (time and melody position before), for the menu-gesture rewind
    this.lastNoteAt = -9;
    this.lastTapTone = -1;
    this.tapTimes = [];
    this.tuneClean = true;
    this.noteFx = null; // { pos 0..1, t } the lamp glow for the latest note
    this.panel = null; // the statistics view: { page }
    this.news = false;
    this.newsFrom = 0; // the schema the save came from, when it shows the "updated" card
    this.groove = 0; // 0..GROOVE_MAX, this visit only
    this.gaps = []; // the last few gaps between gathering taps, for the beat
    this.lastGather = -9;
    this.stageNow = -1;
    this.nextGoal = null;
    this.goalIn = 0;
    this.pvAt = 0;

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
    this.collectResearch(now, summary);
    if (loaded.from > 0 && loaded.from < SCHEMA && !loaded.fresh && (this.s.lt > 0 || this.s.taps > 0)) { // goals already met are credited quietly, once
      this.checkGoals(true);
      this.news = true;
      this.newsFrom = loaded.from;
    }
    this.unlocked = unlockedN(this.s);
    this.stageNow = stageOf(this.s);
    if (summary.sec >= AWAY_MIN || summary.found.length || summary.done.length || note) {
      summary.note = note;
      this.away = summary;
      this.phase_ = "away";
    } else this.phase_ = loaded.fresh || (this.s.lt === 0 && this.s.taps === 0) ? "intro" : this.news ? "news" : "play";
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
    this.dataPS = dataRate(this.s);
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
  grooveMult() { return 1 + GROOVE_BONUS * Math.floor(this.groove) / GROOVE_MAX; }
  tapValue() {
    const v = (this.tapMult * globalMult(this.s) + this.tapFrac * this.rate) * this.frenzy() * this.grooveMult();
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
  // kind: h = by hand (taps and tune bonuses), m = machines, o = credited while away, b = bonuses
  gain(x, kind = "m") {
    x = num(x);
    const s = this.s, st = s.st;
    s.sig = Math.min(BIG, s.sig + x);
    s.rt = Math.min(BIG, s.rt + x);
    s.lt = Math.min(BIG, s.lt + x);
    if (kind === "h") { st.hand = Math.min(BIG, st.hand + x); st.rhand = Math.min(BIG, st.rhand + x); }
    else if (kind === "m") { st.mach = Math.min(BIG, st.mach + x); st.rmach = Math.min(BIG, st.rmach + x); }
    else if (kind === "o") st.off = Math.min(BIG, st.off + x);
    else st.bon = Math.min(BIG, st.bon + x);
  }
  buyProd(i) {
    const s = this.s;
    if (!(i >= 0 && i < NP) || s.own[i] >= MAX_OWN || !tierOpen(s, i)) return false;
    const cost = costOf(s, i);
    if (s.sig < cost) return false;
    s.st.buys++;
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
    s.st.buys++;
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
    s.st.buys++;
    if (k === 0) this.applyKitNow();
    this.dirty = true;
    this.recalc();
    return true;
  }
  chartNext() {
    const s = this.s;
    if (!chartsOpen(s) || s.cn >= CHART_MAX) return false;
    const cost = chartCost(s.cn);
    if (s.b < cost) return false;
    s.b -= cost;
    s.cn++;
    s.st.buys++;
    this.setNote("CHARTED " + chartName(s.cn - 1) + "  ALL OUTPUT x" + CHART_MULT, 4.5);
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
    this.card = { gain: p, run: s.rt, secs: s.play, total: s.L + p, taps: s.st.rtaps, hand: s.st.rhand, mach: s.st.rmach, stage: STAGES[stageOf(s)] };
    if (s.st.fr === 0 || s.play < s.st.fr) s.st.fr = Math.max(1, Math.floor(s.play));
    s.st.rtaps = 0; s.st.rhand = 0; s.st.rmach = 0;
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
    const sum = { sec: 0, gain: 0, capped: false, found: [], relics: 0, note: "", data: 0, done: [] };
    if (!(sec > 0)) return sum;
    const used = Math.min(sec, cap);
    sum.capped = sec > cap;
    sum.sec = used;
    sum.gain = num(this.rate * used);
    this.gain(sum.gain, "o");
    sum.data = dataRate(this.s) * used;
    this.s.dat = Math.min(1e12, this.s.dat + sum.data);
    this.s.st.ta = Math.min(1e15, this.s.st.ta + used);
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
        this.gain(reward, "b");
        s.dat = Math.min(1e12, s.dat + x.data * dataBonus(s));
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
    if (!x || !s.tree[5] || s.ex.length >= slotsOf(s) || (x.res !== undefined && !hasRes(s, x.res))) return false;
    s.ex.push({ k, end: Date.now() + x.sec * 1000 });
    s.st.ex++;
    this.arp([330, 392, 494], 0.08, 0.2, "triangle");
    this.save(true);
    return true;
  }

  // ---- research and goals ---------------------------------------------------------------
  startResearch(k) {
    const s = this.s, r = RES[k];
    if (!r || hasRes(s, k) || s.rs.some((e) => e.k === k) || s.rs.length >= resSlots(s) || !r.need(s) || s.dat < r.data) return false;
    s.dat -= r.data;
    s.rs.push({ k, end: Date.now() + r.sec * 1000 });
    this.arp([294, 392, 494], 0.08, 0.2, "triangle");
    this.save(true);
    return true;
  }
  // Finishes projects whose time has come (on the wall clock, so also while closed).
  collectResearch(now, sum) {
    const s = this.s, keep = [];
    for (const e of s.rs) {
      const r = RES[e.k];
      if (e.end > now + r.sec * 1000 + 60000) e.end = now + r.sec * 1000; // clock went backwards
      if (now >= e.end) {
        if (!hasRes(s, e.k)) s.rd.push(e.k);
        if (sum) sum.done.push(r.n);
        else { this.setNote("RESEARCH COMPLETE: " + r.n, 5); this.accent = { k: "event", t: 0, dur: 0.7 }; this.arp([523, 659, 784, 1047], 0.08, 0.25, "sine"); this.save(true); }
        this.dirty = true;
      } else keep.push(e);
    }
    s.rs = keep;
  }
  // Credits every goal that is met. Quietly (no messages) when loading an older save.
  checkGoals(quiet) {
    const s = this.s;
    let n = 0, last = null;
    for (let i = 0; i < NG; i++) {
      if (s.gl.includes(i)) continue;
      if (GOALS[i].v(s) >= GOALS[i].t) { s.gl.push(i); s.dat = Math.min(1e12, s.dat + 2 * dataBonus(s)); n++; last = GOALS[i]; }
    }
    if (n) {
      this.dirty = true;
      if (!quiet) {
        this.setNote("GOAL: " + last.n + (n > 1 ? " AND " + (n - 1) + " MORE" : "") + "  +" + n + "% OUTPUT", 4.5);
        this.accent = { k: "event", t: 0, dur: 0.7 };
        this.arp([659, 784, 988], 0.07, 0.2, "sine");
        this.saveSoon();
      }
    }
    let best = null, bf = -1;
    for (let i = 0; i < NG; i++) {
      const g = GOALS[i];
      if (g.hid || s.gl.includes(i)) continue;
      const f = goalFrac(s, g);
      if (f > bf) { bf = f; best = i; }
    }
    this.nextGoal = best;
  }

  // ---- the song of the outpost --------------------------------------------------------------
  loadMelody() {
    const s = this.s;
    if (s.sg === GEN_ID) this.mel = genTune(s.gs);
    else {
      if (!(s.sg >= 0 && s.sg < NS) || s.lt < SONGS[s.sg].at) s.sg = 0;
      this.mel = MEL[s.sg];
    }
    if (!(s.sp >= 0 && s.sp < this.mel.n.length)) s.sp = 0;
  }
  voices() { let n = 0; for (const k of VOICE) if (this.s.up[k]) n++; return n; }
  // The tap that gathers also plays the next note: a lead voice sized to the player's tempo, and
  // whatever extra voices the station has learnt (a third above, an octave above, a low note at
  // each phrase start, a bell partial). The extra voices are short, sine-pure and quiet (their
  // gain is VOICE_GAIN), and the lead steps down a little as they join, so the full band is
  // about twice as loud as one note rather than five times.
  sound(midi, gap, idx) {
    if (this.clk - this.lastTapTone <= 0.03) return; // faster than any hand: skip the sound, not the note
    this.lastTapTone = this.clk;
    const c = this.c, m = this.mel, s = this.s, len = clamp(gap * 1.25, 0.16, 0.55), hz = midiHz(midi);
    c.tone(hz, len, "triangle", this.voices() >= 2 ? 0.8 : 1);
    if (s.up[VOICE[0]]) c.tone(midiHz(scaleUp(midi, m.pcs, 2)), len * 0.7, "sine", VOICE_GAIN[0]);
    if (s.up[VOICE[1]]) c.tone(hz * 2, Math.min(len, 0.25), "sine", VOICE_GAIN[1]);
    if (s.up[VOICE[2]] && (idx === 0 || m.ends.includes(idx - 1))) c.tone(midiHz(m.root + 12), 0.8, "sine", VOICE_GAIN[2]);
    if (s.up[VOICE[3]]) c.tone(hz * 2.76, 0.12, "sine", VOICE_GAIN[3]);
  }
  playNote() {
    const s = this.s, m = this.mel, st = s.st;
    if (s.sp >= m.n.length) s.sp = 0;
    const idx = s.sp, midi = m.n[idx], gap = this.clk - this.lastNoteAt;
    this.recent.push({ at: this.clk, sp: idx, sg: s.sg, gs: s.gs });
    if (this.recent.length > 6) this.recent.shift();
    if (idx === 0) this.tuneClean = true; else if (gap > 1.6) this.tuneClean = false;
    this.lastNoteAt = this.clk;
    this.sound(midi, gap, idx);
    this.noteFx = { pos: m.hi > m.lo ? clamp((midi - m.lo) / (m.hi - m.lo), 0, 1) : 0.5, t: 0 };
    st.nt = Math.min(1e12, st.nt + 1);
    s.sp = idx + 1;
    if (idx >= m.n.length - 1) this.finishTune();
    else if (m.ends.includes(idx)) this.finishPhrase();
  }
  finishPhrase() {
    const s = this.s;
    s.st.ph++;
    this.gain(this.tapValue() * 2 * (1 + 0.5 * s.tree[10]), "h");
    this.accent = { k: "phrase", t: 0, dur: 0.4 };
    this.dirty = true;
  }
  finishTune() {
    const s = this.s, m = this.mel, st = s.st, len = m.n.length, pp = 1 + 0.5 * s.tree[10];
    const lump = (this.effRate() * LUMP_SEC * len * (1 + 0.25 * this.voices()) + this.tapValue() * len * 0.15) * pp;
    this.gain(lump, "h");
    st.md++;
    let first = false, mastered = false;
    if (s.sg === GEN_ID) st.gen++;
    else { first = s.sc[s.sg] === 0; s.sc[s.sg]++; mastered = s.sc[s.sg] === 5; }
    s.dat = Math.min(1e12, s.dat + (first ? 1 : 0.2) * dataBonus(s));
    if (this.tuneClean && len >= 16) s.ev |= EV.perfect;
    this.accent = { k: "tune", t: 0, dur: 1 };
    this.setNote(mastered ? m.name + " MASTERED  +2% OUTPUT" : (first ? "FIRST PLAYING: " : "TUNE COMPLETE: ") + m.name + "  +" + fmt(lump), 4);
    const third = m.pcs.has((m.tonic + 3) % 12) ? 3 : 4; // a closing flourish on the tune's own triad
    const base = m.root + 24;
    this.arp([base, base + third, base + 7, base + 12].map(midiHz), 0.07, 0.35, "sine");
    this.nextTune();
    this.dirty = true;
    this.saveSoon();
  }
  nextTune() {
    const s = this.s, rng = this.c.rng;
    s.sp = 0;
    const can = [];
    for (let i = 0; i < NS; i++) if (s.lt >= SONGS[i].at) can.push(i);
    const gen = hasRes(s, 0);
    if (s.sm === 1) {
      const pool = can.slice();
      if (gen) pool.push(GEN_ID);
      const others = pool.filter((x) => x !== s.sg), from = others.length ? others : pool;
      const pick = from[rng.int(0, from.length - 1)];
      if (pick === GEN_ID) { s.gs = rng.int(1, 4e9); s.sg = GEN_ID; } else s.sg = pick;
    } else if (s.sm === 2 && gen) { s.gs = rng.int(1, 4e9); s.sg = GEN_ID; }
    this.loadMelody();
  }
  // Takes back the last k gathering taps' place in the melody (their signal stays). Used when
  // a press turned out to be part of a menu gesture rather than playing.
  unplay(k) {
    const s = this.s;
    if (k <= 0 || !this.recent.length) return;
    k = Math.min(k, this.recent.length);
    const first = this.recent[this.recent.length - k];
    this.recent.length -= k;
    if (first.sg !== s.sg || (s.sg === GEN_ID && first.gs !== s.gs)) { s.sg = first.sg; s.gs = first.gs; this.loadMelody(); }
    s.sp = first.sp;
    this.noteFx = null;
  }
  // A short taste of a melody for the songbook: its first phrase, quickly, replacing any earlier taste.
  preview(mel) {
    this.queue = this.queue.filter((q) => !q.pv);
    const n = Math.min(8, mel.ends[0] + 1);
    for (let i = 0; i < n; i++) if (this.queue.length < QUEUE_MAX) this.queue.push({ at: this.clk + i * 0.15, hz: midiHz(mel.n[i]), len: 0.22, wave: "triangle", pv: true });
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
    if (this.phase_ === "away") { this.phase_ = this.news ? "news" : "play"; this.away = null; this.consume = true; this.setHint(); return; }
    if (this.phase_ === "news") { this.phase_ = "play"; this.news = false; this.consume = true; this.setHint(); return; }
    if (this.phase_ === "card") {
      if (this.cardT > 1.2) {
        this.phase_ = "play"; this.consume = true;
        if (this.s.b > 0) this.openRing("tree");
        this.setHint();
      } else this.consume = true;
      return;
    }
    if (this.ring) { this.ring.last = this.clk; return; }
    if (this.panel) return; // the statistics view: a tap turns the page, a hold closes it (see up)
    this.gather();
  }
  up(event) {
    if (!this.down_) return;
    this.down_ = false;
    this.idle = 0;
    const heldMs = Number.isFinite(event?.durationMs) ? event.durationMs : (this.clk - this.downAt) * 1000;
    const held = heldMs / 1000;
    if (this.consume) { this.consume = false; return; }
    if (this.panel) {
      if (held >= HOLD_BUY) { this.panel = null; this.setHint(); } else this.panel.page = (this.panel.page + 1) % 3;
      this.c.tone(held >= HOLD_BUY ? 330 : 520, 0.04, "sine");
      return;
    }
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
  // How many of the latest gathering taps belonged to a menu gesture (a few quick taps and the
  // press that is being held): their notes are taken back so the tune does not skip ahead.
  gestureTaps() {
    const r = this.recent;
    let k = 0, t = this.downAt;
    for (let i = r.length - 1; i >= 0 && k < 3; i--) {
      if (r[i].at >= this.downAt - 1e-6) { k++; continue; } // the held press itself (unless the ring took it back already)
      if (t - r[i].at > 1.0) break;
      k++; t = r[i].at;
    }
    return k;
  }
  cancel() {
    if (this.down_ && this.phase_ === "play" && !this.panel) this.unplay(this.gestureTaps());
    this.down_ = false;
    this.consume = false;
    this.panel = null;
    this.ring = null;
    this.save(true);
    this.c.leds(lightsOff());
  }
  pause() {
    this.down_ = false;
    this.panel = null;
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
    this.panel = null;
    this.ring = null;
    this.save(true);
    this.c.leds(lightsOff());
  }

  // Groove: a tap close to the recent beat adds a step, a stumble halves it, a long gap ends it.
  beatTap() {
    const s = this.s, gap = this.clk - this.lastGather;
    this.lastGather = this.clk;
    if (gap > GROOVE_MAX_GAP) { this.gaps.length = 0; this.groove = 0; return; }
    if (gap < GROOVE_MIN_GAP) { this.groove = Math.floor(this.groove / 2); return; }
    if (this.gaps.length >= 2) {
      const beat = this.gaps.reduce((a, b) => a + b, 0) / this.gaps.length;
      if (Math.abs(gap / beat - 1) <= GROOVE_TOL) this.groove = Math.min(GROOVE_MAX, Math.floor(this.groove) + 1);
      else this.groove = Math.floor(this.groove / 2);
    }
    this.gaps.push(gap);
    if (this.gaps.length > 4) this.gaps.shift();
    s.st.gb = Math.max(s.st.gb, Math.floor(this.groove));
    if (this.groove >= GROOVE_MAX) { s.ev |= EV.groove; s.st.gt = Math.min(1e15, s.st.gt + 1); }
  }
  gather() {
    const s = this.s;
    this.beatTap();
    const v = this.tapValue();
    this.gain(v, "h");
    s.taps = Math.min(1e12, s.taps + 1);
    s.st.rtaps++;
    this.dirty = true;
    this.tapTimes.push(this.clk);
    if (this.tapTimes.length > 12) this.tapTimes.shift();
    if (this.tapTimes.length === 12 && this.clk - this.tapTimes[0] < 1.8) s.ev |= EV.presto;
    this.playNote();
    this.spawnFloat("+" + fmt(v), 480 + this.c.rng.range(-70, 70), 215 + this.c.rng.range(-8, 8));
    if (this.flare) this.catchFlare();
  }
  catchFlare() {
    const r = this.c.rng.next(), s = this.s;
    if (this.flare.life - this.flare.t < 1.5) s.ev |= EV.quick;
    s.st.fl++;
    if (hasRes(s, 2)) s.dat = Math.min(1e12, s.dat + 2 * dataBonus(s));
    this.flare = null;
    this.accent = { k: "event", t: 0, dur: 0.7 };
    this.arp([784, 988, 1175, 1568], 0.06, 0.25, "sine");
    if (r < 0.55) {
      this.boosts.push({ k: "surge", t: 30, max: 30, mult: 7 });
      this.setNote("FLARE CAUGHT - SURGE x7 FOR 30 S", 4);
    } else if (r < 0.8) {
      const g = this.effRate() * 600 + this.tapValue() * 40;
      this.gain(g, "b");
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
    this.queue = this.queue.filter((q) => !q.pv); // a tune tasted in the songbook stops when the ring closes
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
    // the views come right after CLOSE, so they are one tap away when nothing is affordable
    list.push({ key: "stats", kind: "panel", label: "STATISTICS", aff: true, big: fmt(s.taps) + " TAPS", lines: ["TOTALS, THIS RUN, MUSIC", "AND FIELD RECORDS."] });
    list.push({ key: "songs", kind: "sub", sub: "songs", label: "SONGBOOK", aff: true, big: unlockedN(s) + " / " + NS + " TUNES", lines: ["NOW: " + this.mel.name, "CHOOSE WHAT YOUR TAPS PLAY."] });
    if (aff.length >= 2) {
      list.push({ key: "all", kind: "all", label: "BUY ALL AFFORDABLE", aff: true, big: aff.length + " ITEMS", lines: ["SPEND SIGNAL ON EVERYTHING", "WORTH BUYING, BEST FIRST"], cost: 0 });
    }
    for (const it of aff.slice(0, 7)) list.push(this.itemEntry(it, true));
    if (s.tree[5] > 0) list.push({ key: "exp", kind: "sub", sub: "exp", label: "EXPEDITIONS", aff: s.ex.length < slotsOf(s), big: s.ex.length + " / " + slotsOf(s) + " OUT", lines: ["SEND A TEAM OUT ON A TIMER.", "THEY RETURN WITH FINDINGS."] });
    if (s.lt >= 2000 || s.rd.length || s.rs.length) {
      const can = s.rs.length < resSlots(s) && RES.some((r, k) => !hasRes(s, k) && !s.rs.some((e) => e.k === k) && r.need(s) && s.dat >= r.data);
      list.push({ key: "res", kind: "sub", sub: "res", label: "RESEARCH", aff: can, big: Math.floor(s.dat) + " DATA", lines: ["SLOW PROJECTS THAT UNLOCK", "NEW THINGS. THEY RUN AWAY."] });
    }
    list.push({ key: "goals", kind: "sub", sub: "goals", label: "GOALS", aff: false, big: s.gl.length + " / " + NG + " DONE", lines: ["EACH ONE IS +1% OUTPUT FOR EVER.", "SOME ARE HIDDEN."] });
    if (s.L > 0 || s.b > 0 || s.runs > 0) {
      const can = TREE.some((nd, k) => s.L >= nd.req && s.tree[k] < nd.max && s.b >= nd.cost(s.tree[k])) || (chartsOpen(s) && s.cn < CHART_MAX && s.b >= chartCost(s.cn));
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
    if (chartsOpen(s) && s.cn < CHART_MAX) {
      const cost = chartCost(s.cn);
      nodes.push({ key: "chart", kind: "chart", label: "CHART " + chartName(s.cn), sub: "SKY " + s.cn, aff: s.b >= cost, cost, big: "COST " + cost + " BEARINGS",
        lines: ["ALL OUTPUT x" + CHART_MULT + ", FOR EVER.", s.cn + " CHARTED SO FAR: x" + fmt(Math.pow(CHART_MULT, s.cn)), "YOU HAVE " + s.b + " BEARINGS"] });
    } else if (s.L >= CHART_REQ / 2) nodes.push({ key: "chartl", kind: "info", label: "CONSTELLATIONS", sub: "LOCKED", aff: false, big: "AT " + CHART_REQ + " BEARINGS", lines: ["HOLD " + CHART_REQ + " BEARINGS IN ALL", "TO START CHARTING THE SKY."] });
    return list.concat(nodes);
  }
  buildSongs() {
    const s = this.s, gen = hasRes(s, 0);
    const list = [{ key: "back", kind: "back", label: "BACK", lines: ["TO THE BUILD RING"], hold: HOLD_BUY }];
    const modes = ["LOOP THIS TUNE", "SHUFFLE TUNES", "ENDLESS NEW TUNES"];
    list.push({ key: "mode", kind: "mode", label: "ORDER", sub: ["LOOP", "SHUFFLE", "NEW"][s.sm], aff: true, big: modes[s.sm], lines: ["HOLD TO CHANGE WHAT PLAYS", "AFTER A TUNE IS FINISHED."] });
    for (let i = 0; i < NS; i++) {
      if (s.lt < SONGS[i].at) continue;
      list.push({ key: "s" + i, kind: "song", i, cur: s.sg === i, label: SONGS[i].name, sub: s.sc[i] >= 5 ? "MASTER" : s.sc[i] + "X", aff: true,
        big: s.sg === i ? "PLAYING" : "PLAY THIS", lines: [SONGS[i].by, "PLAYED " + s.sc[i] + " TIMES", s.sc[i] >= 5 ? "MASTERED: +2% OUTPUT" : "MASTER AT 5 PLAYS: +2% OUTPUT"] });
    }
    if (gen) {
      list.push({ key: "gen", kind: "song", i: GEN_ID, cur: s.sg === GEN_ID, label: genName(s.gs), sub: "SEED", aff: true, big: s.sg === GEN_ID ? "PLAYING" : "PLAY THIS",
        lines: ["COMPOSED FROM A SEED.", "THE SAME NAME IS ALWAYS", "THE SAME TUNE."] });
      list.push({ key: "newgen", kind: "songnew", label: "COMPOSE A NEW TUNE", aff: true, big: "NEW SEED", lines: ["MAKES A TUNE NOBODY HAS", "HEARD, AND PLAYS IT."] });
    }
    let shown = 0;
    for (let i = 0; i < NS && shown < 2; i++) {
      if (s.lt >= SONGS[i].at) continue;
      shown++;
      list.push({ key: "l" + i, kind: "info", label: "LOCKED TUNE", sub: "???", aff: false, big: "AT " + fmt(SONGS[i].at) + " SIGNAL", lines: ["KEEP GATHERING TO HEAR IT."] });
    }
    return list;
  }
  buildRes() {
    const s = this.s, now = Date.now();
    const list = [{ key: "back", kind: "back", label: "BACK", lines: ["TO THE BUILD RING"], hold: HOLD_BUY }];
    list.push({ key: "data", kind: "info", label: "DATA", sub: String(Math.floor(s.dat)), aff: false, big: Math.floor(s.dat) + " DATA",
      lines: ["+" + (this.dataPS * 60).toFixed(2) + " A MINUTE FROM THE MACHINES.", "GOALS, NEW TUNES AND EXPEDITIONS ADD MORE."] });
    for (const e of s.rs) {
      const left = (e.end - now) / 1000;
      list.push({ key: "rs" + e.k, kind: "info", label: RES[e.k].n, sub: clock(left), aff: false, big: "DONE IN " + clock(left), lines: [RES[e.k].fx, "IT RUNS WHILE YOU ARE AWAY."] });
    }
    const free = s.rs.length < resSlots(s);
    RES.forEach((r, k) => {
      if (hasRes(s, k) || s.rs.some((e) => e.k === k)) return;
      const ok = r.need(s), aff = ok && free && s.dat >= r.data;
      list.push({ key: "r" + k, kind: ok ? "research" : "info", k, label: r.n, sub: ok ? r.data + " DATA" : "LOCKED", aff, big: ok ? "COST " + r.data + " DATA" : "LOCKED",
        lines: ok ? [r.fx, "TAKES " + dur(r.sec), free ? "YOU HAVE " + Math.floor(s.dat) + " DATA" : "NO FREE BENCH"] : [r.hint] });
    });
    if (s.rd.length) list.push({ key: "done", kind: "info", label: "COMPLETED", sub: s.rd.length + "/" + NR, aff: false, big: s.rd.length + " / " + NR, lines: s.rd.map((k) => RES[k].n).slice(0, 3) });
    return list;
  }
  buildGoals() {
    const s = this.s, list = [{ key: "back", kind: "back", label: "BACK", lines: ["TO THE BUILD RING"], hold: HOLD_BUY }];
    const open = [];
    for (let i = 0; i < NG; i++) if (!s.gl.includes(i) && !GOALS[i].hid) open.push(i);
    open.sort((a, b) => goalFrac(s, GOALS[b]) - goalFrac(s, GOALS[a]));
    for (const i of open.slice(0, 5)) {
      const g = GOALS[i], pct = Math.floor(goalFrac(s, g) * 100);
      list.push({ key: "g" + i, kind: "info", label: g.n, sub: pct + "%", aff: false, big: pct + "% DONE", lines: [g.d, fmt(Math.min(g.v(s), g.t)) + " OF " + fmt(g.t), "REWARD +1% OUTPUT, 2 DATA"] });
    }
    for (let i = 0; i < NG; i++) if (GOALS[i].hid && !s.gl.includes(i)) list.push({ key: "h" + i, kind: "info", label: "HIDDEN GOAL", sub: "???", aff: false, big: "???", lines: ["HINT: " + GOALS[i].hint] });
    list.push({ key: "gdone", kind: "info", label: "COMPLETED", sub: s.gl.length + "/" + NG, aff: false, big: s.gl.length + " / " + NG, lines: ["+" + s.gl.length + "% OUTPUT SO FAR."] });
    return list;
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
    const m = r.menu;
    this.entries = m === "exp" ? this.buildExp() : m === "tree" ? this.buildTree() : m === "reloc" ? this.buildReloc() : m === "songs" ? this.buildSongs()
      : m === "res" ? this.buildRes() : m === "goals" ? this.buildGoals() : this.buildMain();
    let idx = this.entries.findIndex((e) => e.key === old);
    if (idx < 0) {
      idx = m === "main" ? this.entries.findIndex((e) => e.kind === "prod" || e.kind === "upg") : m === "songs" ? this.entries.findIndex((e) => e.cur) : this.entries.findIndex((e) => e.aff);
      if (idx < 0 || (initial && m === "main" && !this.entries[idx].aff)) idx = 0;
    }
    r.idx = clamp(idx, 0, this.entries.length - 1);
    r.hiAt = this.clk;
  }
  step() {
    const r = this.ring;
    if (!r || !this.entries.length) return;
    r.idx = (r.idx + 1) % this.entries.length;
    r.hiAt = this.clk;
    const e = this.entries[r.idx];
    if (r.menu === "songs" && e?.kind === "song") this.preview(e.i === GEN_ID ? genTune(this.s.gs) : MEL[e.i]);
    else this.c.tone(440 + 40 * (r.idx % 5), 0.04, "sine");
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
      case "chart": ok = this.chartNext(); break;
      case "launch": ok = this.launch(e.k); break;
      case "sub": r.menu = e.sub; r.idx = 0; this.entries = []; this.rebuild(true); this.arp([330, 392], 0.05, 0.08, "sine"); return;
      case "panel": this.ring = null; this.panel = { page: 0 }; this.arp([392, 523], 0.05, 0.08, "sine"); this.setHint(); return;
      case "mode": this.s.sm = (this.s.sm + 1) % (hasRes(this.s, 0) ? 3 : 2); this.rebuild(); this.arp([440, 554], 0.05, 0.08, "sine"); return;
      case "song": {
        const s = this.s;
        if (e.i === GEN_ID) s.sg = GEN_ID; else if (s.lt >= SONGS[e.i].at) s.sg = e.i; else break;
        s.sp = 0; this.recent.length = 0; this.loadMelody();
        this.setNote("NOW PLAYING: " + this.mel.name, 3.5);
        this.closeRing();
        return;
      }
      case "songnew": {
        const s = this.s;
        s.gs = this.c.rng.int(1, 4e9); s.sg = GEN_ID; s.sp = 0; this.recent.length = 0; this.loadMelody();
        this.rebuild();
        this.preview(this.mel);
        return;
      }
      case "research": ok = this.startResearch(e.k); break;
      case "reloc": this.relocate(); return;
      default: break;
    }
    if (ok) {
      this.accent = this.accent?.k === "milestone" ? this.accent : { k: "buy", t: 0, dur: 0.35 };
      if (e.kind !== "node" && e.kind !== "launch" && e.kind !== "research" && e.kind !== "chart") this.arp([392, 494, 587, 784], 0.055, 0.14, "triangle");
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
    s.st.tp += dt;
    // production, and the slow trickle of data
    const eff = this.effRate();
    this.gain(eff * dt, "m");
    if (eff > s.st.peak) s.st.peak = eff;
    s.dat = Math.min(1e12, s.dat + this.dataPS * dt);
    // boosts and flare
    for (let i = this.boosts.length - 1; i >= 0; i--) { this.boosts[i].t -= dt; if (this.boosts[i].t <= 0) this.boosts.splice(i, 1); }
    if (this.flare) { this.flare.t -= dt; if (this.flare.t <= 0) this.flare = null; }
    else if (s.rt >= 150 && this.phase_ === "play" && !this.ring && !this.panel) {
      this.flareIn -= dt;
      if (this.flareIn <= 0) {
        const lvl = s.tree[7];
        const life = FLARE_LIFE * (1 + 0.25 * lvl) * (hasRes(s, 2) ? 1.4 : 1);
        this.flare = { x: this.c.rng.range(160, 800), y: this.c.rng.range(150, 300), t: life, life };
        this.flareIn = this.c.rng.range(50, 130) * 0.75 ** lvl;
        this.arp([880, 1175], 0.1, 0.12, "sine");
      }
    }
    // groove fades once the beat has stopped
    if (this.groove > 0) {
      const beat = this.gaps.length ? this.gaps.reduce((a, b) => a + b, 0) / this.gaps.length : 0.5;
      if (this.clk - this.lastGather > Math.max(1.2, 2.5 * beat)) this.groove = Math.max(0, this.groove - GROOVE_FADE * dt);
    }
    // held press opens the ring
    if (this.down_ && !this.ring && !this.panel && !this.consume && this.phase_ === "play" && this.clk - this.downAt >= HOLD_OPEN) {
      this.consume = true;
      const last = this.recent[this.recent.length - 1];
      if (last && last.at === this.downAt) this.unplay(1); // the press that opens the ring does not play a note
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
      if (s.rs.length) this.collectResearch(now, null);
      this.checkGoals(false);
      const un = unlockedN(s);
      if (un > this.unlocked) { this.unlocked = un; this.setNote("NEW MELODY: " + SONGS[un - 1].name, 4.5); this.arp([523, 659, 784], 0.08, 0.2, "sine"); }
      const sgNow = stageOf(s);
      if (sgNow > this.stageNow && this.phase_ === "play") this.setNote("THE STATION GROWS: " + STAGES[sgNow], 4.5);
      this.stageNow = sgNow;
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
    if (this.noteFx) { this.noteFx.t += dt; if (this.noteFx.t > 0.3) this.noteFx = null; }
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
    // left: breathing, quicker with production (taps are shown by the note glow below)
    const left = dim(LAMP.green, (0.06 + 0.2 * pulse(this.breath)) * k);
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
    // the latest note glows on the lamp for its place in the tune's range: low notes left, high right
    if (this.noteFx) {
      // brighter with groove; in full groove the glow turns cyan
      const gf = Math.floor(this.groove) / GROOVE_MAX, f = 1 - this.noteFx.t / 0.3;
      const glow = spot(this.noteFx.pos, gf >= 1 ? LAMP.cyan : LAMP.white, 0.7);
      v = v.map((x, i) => Math.max(x, Math.round(glow[i] * (0.5 + 0.3 * gf) * f)));
    }
    const a = this.accent;
    if (a) {
      const f = 1 - a.t / a.dur;
      let acc = null;
      if (a.k === "buy") acc = lamps(dim(LAMP.green, 0.7 * f), dim(LAMP.green, 0.7 * f), dim(LAMP.green, 0.7 * f));
      else if (a.k === "milestone") acc = spot(a.t / a.dur, LAMP.blue, 0.8);
      else if (a.k === "phrase") acc = spot(a.t / a.dur, LAMP.cyan, 0.8).map((x) => Math.round(x * 0.6));
      else if (a.k === "tune") acc = only(chase(a.t, 9, false), LAMP.amber, 0.7 * f);
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
    if (this.phase_ === "intro" || this.phase_ === "away" || this.phase_ === "news") h = "Press to continue.";
    else if (this.panel) h = "Tap: next page. Hold, then release: close.";
    else if (this.phase_ === "card") h = "Press to continue.";
    else if (this.ring) h = "Tap: next entry. Hold, then release: choose.";
    else if (this.flare) h = "Signal flare. Tap now to catch it.";
    else if (this.affordN > 0) h = "Something is affordable. Hold to build.";
    else h = "Tap to gather signal and play the song. Hold to open the build ring.";
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
    else if (this.panel) this.drawPanel(g);
    else if (this.note && this.phase_ === "play") text(g, this.note.text, 480, 232, 22, C.cyan, "center");
    if (this.phase_ === "intro") banner(g, "OUTPOST", "A lone station on a dark world. Tap to gather signal and play its song. Hold to build.");
    else if (this.phase_ === "news") this.drawNews(g);
    else if (this.phase_ === "away") this.drawAway(g);
    else if (this.phase_ === "card") this.drawCard(g);
  }
  drawHeader(g) {
    const s = this.s;
    text(g, "SIGNAL", 480, 24, 16, C.muted, "center");
    text(g, fmt(s.sig), 480, 64, 46, C.ink, "center");
    const surge = this.surge() > 1 ? " x" + this.surge() : "";
    text(g, "+" + fmtRate(this.effRate()) + " /S" + surge, 480, 104, 26, this.surge() > 1 ? C.cyan : C.amber, "center");
    // the headline figures; everything else is in STATISTICS
    const star = s.fk ? "" : " *";
    text(g, "TAPS", 24, 24, 16, C.muted, "left");
    text(g, fmtInt(s.taps), 24, 50, 24, C.ink, "left");
    text(g, "BY HAND" + star, 24, 84, 16, C.muted, "left");
    text(g, fmt(s.st.hand), 24, 110, 24, C.amber, "left");
    text(g, "PER TAP", 936, 24, 16, C.muted, "right");
    text(g, "+" + fmt(this.tapValue()), 936, 50, 24, C.ink, "right");
    text(g, s.L > 0 ? "BEARINGS" : "BEST RATE" + star, 936, 84, 16, C.muted, "right");
    text(g, s.L > 0 ? s.b + " / " + s.L : fmtRate(s.st.peak) + " /S", 936, 110, 24, C.amber, "right");
    if (this.groove >= 1) {
      const gf = Math.floor(this.groove) / GROOVE_MAX;
      text(g, "GROOVE x" + this.grooveMult().toFixed(2), 936, 140, 16, gf >= 1 ? C.cyan : C.muted, "right");
      g.fillStyle = C.dark; g.fillRect(836, 148, 100, 5);
      g.fillStyle = gf >= 1 ? C.cyan : C.amber; g.fillRect(836, 148, 100 * gf, 5);
    }
    let y = 150;
    for (const b of this.boosts) { text(g, (b.k === "surge" ? "SURGE x" : "TAP x") + b.mult + " " + clock(b.t), 24, y, 16, C.cyan, "left"); y += 22; }
    for (const e of s.ex) { text(g, EXPED[e.k].n + " " + clock((e.end - Date.now()) / 1000), 24, y, 16, C.cyan, "left"); y += 22; }
    for (const e of s.rs) { if (y < 240) text(g, "LAB " + RES[e.k].n + " " + clock((e.end - Date.now()) / 1000), 24, y, 16, C.cyan, "left"); y += 22; }
  }
  drawFooter(g) {
    const s = this.s;
    if (this.ring || this.panel || this.phase_ !== "play") return;
    if (this.nextGoal !== null) {
      const gl = GOALS[this.nextGoal];
      text(g, "GOAL  " + gl.n + "  " + Math.floor(goalFrac(s, gl) * 100) + "%", 480, 160, 16, C.cyan, "center");
    }
    if (this.goalName) {
      text(g, "NEXT  " + this.goalName + "  " + fmt(this.goalCost), 480, 492, 22, this.affordN > 0 ? C.ink : C.muted, "center");
      g.fillStyle = C.dark; g.fillRect(260, 510, 440, 8);
      g.fillStyle = this.affordN > 0 ? C.ink : C.amber; g.fillRect(260, 510, 440 * this.goalFrac, 8);
    } else if (this.items.length && this.affordN > 0) text(g, "HOLD TO BUILD", 480, 492, 22, C.ink, "center");
    const p = this.pending();
    if (revealOf(s)) text(g, readyOf(s) ? "RELOCATION READY  +" + p : "RELOCATION POSSIBLE  +" + p, 480, 134, 18, readyOf(s) ? C.cyan : C.muted, "center");
    else if (this.affordN > 0 && this.phase_ === "play") text(g, "HOLD TO BUILD", 480, 134, 18, C.ink, "center");
  }
  // The place grows with the station: a ridge from the start, then a fence, power poles, huts with
  // lit windows, a radar, orbiting satellites and finally an aurora. Faint line art behind the machines.
  // Charted constellations, faint in the sky: twelve places, later charts drawn over them brighter.
  drawSky(g) {
    const n = this.s.cn;
    if (!n) return;
    const shown = Math.min(n, CONST.length);
    for (let k = 0; k < shown; k++) {
      const [, stars, links] = CONST[k];
      const col = k % 6, row = Math.floor(k / 6);
      const x0 = 30 + col * 160 + (row ? 70 : 0), y0 = 176 + row * 70 + (col % 2) * 18, w = 70, h = 40;
      const deep = Math.floor((n - 1 - k) / CONST.length) + 1; // how many times this place has been charted
      g.globalAlpha = Math.min(0.75, 0.22 + 0.12 * deep);
      g.strokeStyle = deep > 1 ? C.cyan : C.line; g.lineWidth = 1;
      g.beginPath();
      for (const [a, b] of links) { g.moveTo(x0 + stars[a][0] * w, y0 + stars[a][1] * h); g.lineTo(x0 + stars[b][0] * w, y0 + stars[b][1] * h); }
      g.stroke();
      g.fillStyle = deep > 1 ? C.cyan : C.ink;
      for (const [sx, sy] of stars) g.fillRect(x0 + sx * w - 1.5, y0 + sy * h - 1.5, 3, 3);
    }
    g.globalAlpha = 1;
  }
  drawBackdrop(g, stage) {
    const gy = 440, t = this.t;
    this.drawSky(g);
    g.lineWidth = 2;
    g.strokeStyle = C.dark;
    g.beginPath();
    HILLS.forEach((p, k) => (k ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
    g.stroke();
    if (stage >= 1) { // a fence of posts and one wire
      g.strokeStyle = C.line;
      g.beginPath();
      for (let x = 12; x < 960; x += 48) { g.moveTo(x, gy); g.lineTo(x, gy - 16); }
      g.moveTo(0, gy - 12); g.lineTo(960, gy - 12);
      g.stroke();
    }
    if (stage >= 2) { // power poles with a sagging line
      g.strokeStyle = C.line;
      g.beginPath();
      for (let x = 40; x < 960; x += 200) {
        g.moveTo(x, gy); g.lineTo(x, gy - 78); g.moveTo(x - 12, gy - 72); g.lineTo(x + 12, gy - 72);
        if (x + 200 < 960) { g.moveTo(x + 12, gy - 72); g.quadraticCurveTo(x + 100, gy - 54, x + 188, gy - 72); }
      }
      g.stroke();
      for (let x = 40; x < 960; x += 200) circle(g, x, gy - 80, 3, blink(t * 0.4 + x, 1) ? C.amber : C.line, true);
    }
    if (stage >= 3) { // two huts with a lit window each
      for (const x of [14, 920]) {
        g.strokeStyle = C.line;
        g.strokeRect(x, gy - 34, 30, 34);
        line(g, x - 4, gy - 34, x + 15, gy - 48, C.line, 2); line(g, x + 15, gy - 48, x + 34, gy - 34, C.line, 2);
        g.fillStyle = C.amber; g.globalAlpha = 0.5 + 0.3 * pulse(t * 0.2 + x);
        g.fillRect(x + 8, gy - 24, 8, 8);
        g.globalAlpha = 1;
      }
    }
    if (stage >= 4) { // a radar turning on the ridge
      const a = t * 0.9;
      line(g, 880, 396, 880 + Math.cos(a) * 34, 396 + Math.sin(a) * 18, C.line, 2);
      g.save(); g.scale(1, 0.55); circle(g, 880, 396 / 0.55, 34, C.line, false, 2); g.restore();
    }
    if (stage >= 5) { // an orbit with two satellites
      g.save(); g.setLineDash([3, 9]); g.scale(1, 0.18); circle(g, 480, 1180, 420, C.line, false, 2); g.restore();
      for (let k = 0; k < 2; k++) {
        const a = t * 0.12 + k * Math.PI;
        diamond(g, 480 + Math.cos(a) * 420, 212 + Math.sin(a) * 76, 5, C.cyan, true);
      }
    }
    if (stage >= 6) { // the aurora
      g.globalAlpha = 0.35;
      for (let k = 0; k < 3; k++) {
        g.beginPath();
        for (let x = 0; x <= 960; x += 24) {
          const y = 168 + k * 16 + 14 * Math.sin(x * 0.012 + t * 0.4 + k) + 8 * Math.sin(x * 0.03 - t * 0.3);
          if (x) g.lineTo(x, y); else g.moveTo(x, y);
        }
        g.strokeStyle = k === 1 ? C.amber : C.cyan; g.lineWidth = 2; g.stroke();
      }
      g.globalAlpha = 1;
    }
  }
  drawPanel(g) {
    const s = this.s, st = s.st, pg = this.panel.page;
    g.fillStyle = "#0c1511f6"; g.fillRect(30, 140, 900, 372);
    g.strokeStyle = C.line; g.lineWidth = 2; g.strokeRect(30, 140, 900, 372);
    text(g, "STATISTICS  " + ["ALL TIME", "THIS RUN", "MUSIC AND FIELD"][pg] + "  " + (pg + 1) + "/3", 54, 164, 18, C.amber, "left");
    const star = s.fk ? "" : "*", p = pendingOf(s);
    const tp = this.tapValue();
    const cells = pg === 0 ? [
      ["TAPS", fmtInt(s.taps)], ["BY HAND", fmt(st.hand) + star], ["BY MACHINES", fmt(st.mach) + star], ["CREDITED AWAY", fmt(st.off) + star],
      ["BONUSES", fmt(st.bon) + star], ["SIGNAL PER TAP", "+" + fmt(tp)], ["PEAK RATE", fmtRate(st.peak) + " /S" + star], ["TIME PLAYED", dur(st.tp) + star],
      ["TIME AWAY", dur(st.ta) + star], ["PURCHASES", fmtInt(st.buys) + star]]
      : pg === 1 ? [
      ["TAPS THIS RUN", fmtInt(st.rtaps) + star], ["BY HAND", fmt(st.rhand) + star], ["BY MACHINES", fmt(st.rmach) + star], ["RUN SIGNAL", fmt(s.rt)],
      ["RUN TIME", dur(s.play)], ["BEARINGS ON OFFER", "+" + p], ["RELOCATIONS", String(s.runs)], ["FASTEST MOVE", st.fr ? dur(st.fr) + star : "NONE YET"],
      ["STAGE", STAGES[stageOf(s)]], ["LIFETIME SIGNAL", fmt(s.lt)]]
      : [
      ["NOTES PLAYED", fmtInt(st.nt) + star], ["TUNES COMPLETED", fmtInt(st.md) + star], ["PHRASES", fmtInt(st.ph) + star], ["TUNES UNLOCKED", unlockedN(s) + " / " + NS],
      ["TUNES MASTERED", masteredN(s) + " / " + NS], ["FLARES CAUGHT", fmtInt(st.fl) + star], ["EXPEDITIONS SENT", fmtInt(st.ex) + star], ["GOALS MET", s.gl.length + " / " + NG],
      ["RESEARCH DONE", s.rd.length + " / " + NR], ["BEST GROOVE", (st.gb >= GROOVE_MAX ? "FULL" : Math.floor(st.gb) + " / " + GROOVE_MAX) + "  " + fmtInt(st.gt) + " IN THE POCKET"]];
    cells.forEach((c, k) => {
      const col = k % 2, row = Math.floor(k / 2), x = 54 + col * 440, y = 196 + row * 56;
      text(g, c[0], x, y, 16, C.muted, "left");
      text(g, c[1], x, y + 26, 24, c[1].startsWith("NONE") ? C.muted : C.ink, "left");
    });
    text(g, s.fk ? "FOUNDED " + fmtDate(s.f) : "* COUNTED SINCE " + fmtDate(s.f), 54, 496, 16, C.muted, "left");
    text(g, "TAP: NEXT PAGE   HOLD: CLOSE", 906, 496, 16, C.muted, "right");
  }
  drawNews(g) {
    const s = this.s;
    g.fillStyle = "#0c1511f0"; g.fillRect(100, 130, 760, 330);
    g.strokeStyle = C.line; g.lineWidth = 2; g.strokeRect(100, 130, 760, 330);
    text(g, "OUTPOST UPDATED", 480, 168, 30, C.cyan, "center");
    if (this.newsFrom >= 3) { // from schema 3: groove and constellations
      text(g, "KEEP A STEADY BEAT TO BUILD GROOVE", 480, 218, 22, C.ink, "center");
      text(g, "FULL GROOVE: EVERY TAP AND PHRASE x1.5", 480, 250, 22, C.muted, "center");
      text(g, "AT " + CHART_REQ + " BEARINGS THE TREE CAN CHART CONSTELLATIONS", 480, 290, 20, C.ink, "center");
      text(g, "THE EXTRA VOICES ARE QUIETER UNDER THE TUNE", 480, 322, 20, C.muted, "center");
      text(g, "NOTHING WAS LOST.", 480, 366, 18, C.muted, "center");
      text(g, "PRESS TO CONTINUE", 480, 424, 22, C.amber, "center");
      return;
    }
    text(g, "TAPS NOW PLAY MELODIES", 480, 218, 22, C.ink, "center");
    text(g, "HOLD, THEN SONGBOOK, TO CHOOSE THE TUNE", 480, 250, 22, C.muted, "center");
    text(g, "STATISTICS, GOALS AND RESEARCH ARE NEW", 480, 290, 22, C.ink, "center");
    if (s.gl.length) text(g, s.gl.length + " GOALS ALREADY MET: +" + s.gl.length + "% OUTPUT", 480, 322, 22, C.amber, "center");
    text(g, "NOTHING WAS LOST. COUNTING STARTS " + fmtDate(s.f), 480, 366, 18, C.muted, "center");
    text(g, "PRESS TO CONTINUE", 480, 424, 22, C.amber, "center");
  }
  drawFlare(g) {
    const f = this.flare, k = f.t / f.life, r = 12 + 10 * Math.sin(this.t * 6);
    diamond(g, f.x, f.y, r, C.amber, true);
    circle(g, f.x, f.y, 26 + 14 * (1 - k), C.amber, false, 2);
    text(g, "FLARE - TAP", f.x, f.y + 44, 22, C.amber, "center");
  }
  drawScene(g) {
    const s = this.s, gy = 440;
    this.drawBackdrop(g, stageOf(s));
    line(g, 0, gy, 960, gy, C.line, 2);
    for (let x = 30; x < 960; x += 90) line(g, x, gy + 8, x + 40, gy + 8, C.dark, 2);
    let ghost = -1;
    for (let i = 0; i < NP; i++) {
      const x = 56 + i * (848 / (NP - 1)), n = s.own[i]; // twelve machines across the width
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
    const title = { exp: "EXPEDITIONS", tree: "BEARING TREE", reloc: "RELOCATE", songs: "SONGBOOK", res: "RESEARCH", goals: "GOALS" }[r.menu] || "BUILD";
    text(g, title, 54, 164, 18, C.amber, "left");
    text(g, r.menu === "res" ? "DATA " + Math.floor(this.s.dat) : "SIGNAL " + fmt(this.s.sig), 906, 164, 18, C.muted, "right");
    // list window of up to 6 rows
    const rows = 6, first = clamp(r.idx - 2, 0, Math.max(0, es.length - rows));
    for (let k = 0; k < rows && first + k < es.length; k++) {
      const it = es[first + k], y = 204 + k * 46, sel = first + k === r.idx;
      if (sel) { g.fillStyle = "#1c3322"; g.fillRect(44, y - 20, 420, 40); g.strokeStyle = it.aff ? C.ink : C.muted; g.lineWidth = 2; g.strokeRect(44, y - 20, 420, 40); }
      const col = it.kind === "close" || it.kind === "back" || it.kind === "info" ? C.muted : it.aff ? C.ink : C.line;
      text(g, (it.aff ? "> " : "  ") + it.label.slice(0, 21), 54, y, 22, sel && !it.aff ? C.muted : col, "left");
      if (it.sub) text(g, it.sub, 456, y, 16, it.aff ? C.amber : C.line, "right");
    }
    if (first + rows < es.length) text(g, "...", 254, 484, 22, C.muted, "center");
    if (!e) return;
    // detail card
    const dwellNeed = e.dwell || DWELL, locked = e.kind !== "close" && e.kind !== "back" && this.clk - r.hiAt < dwellNeed;
    text(g, e.label, 500, 204, 26, C.ink, "left");
    if (e.big) text(g, e.big, 500, 250, 32, e.aff ? C.ink : C.amber, "left");
    if (e.cost > 0 && !e.aff && e.kind !== "node" && e.kind !== "chart") text(g, "NEED " + fmt(e.cost - this.s.sig) + " MORE", 500, 288, 22, C.muted, "left");
    let y = e.cost > 0 && !e.aff && e.kind !== "node" ? 326 : 296;
    for (const ln of e.lines) for (const part of wrapText(ln, 29).slice(0, 2)) { text(g, part, 500, y, 22, C.muted, "left"); y += 28; }
    // hold bar
    const need = e.hold || HOLD_BUY;
    const held = this.down_ && !this.consume ? clamp((this.clk - this.downAt) / need, 0, 1) : 0;
    g.fillStyle = C.dark; g.fillRect(500, 458, 400, 14);
    g.fillStyle = locked ? C.amber : e.aff || FREE_KINDS.includes(e.kind) ? C.ink : C.muted;
    g.fillRect(500, 458, 400 * held, 14);
    const free = FREE_KINDS.includes(e.kind);
    const verb = { sub: "OPEN", panel: "OPEN", mode: "CHANGE", song: "PLAY", songnew: "COMPOSE", research: "START", reloc: "RELOCATE", launch: "CHOOSE", node: "CHOOSE" }[e.kind] || "BUY";
    const label = this.refused ? "NOT NOW" : e.kind === "close" ? "HOLD TO CLOSE" : e.kind === "back" ? "HOLD TO GO BACK" : e.kind === "info" ? "NOTHING TO DO" : locked ? "STEADY..." : e.aff || free ? "HOLD TO " + verb : "CANNOT AFFORD YET";
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
    let y = 206;
    if (a.sec > 0) {
      text(g, dur(a.sec), 480, y, 32, C.ink, "center"); y += 44;
      text(g, "+" + fmt(a.gain) + " SIGNAL", 480, y, 32, C.ink, "center"); y += 34;
      if (a.capped) { text(g, "CAPPED AT " + capHours(this.s) + " H OF STORAGE", 480, y, 18, C.muted, "center"); y += 26; }
      if (a.data >= 0.5) { text(g, "+" + Math.floor(a.data) + " DATA", 480, y, 18, C.muted, "center"); y += 26; }
    }
    for (const f of a.found.slice(0, 2)) { text(g, f.name + " RETURNED +" + fmt(f.reward) + (f.relic ? " + RELIC" : ""), 480, y, 22, C.cyan, "center"); y += 30; }
    for (const n of a.done.slice(0, 1)) { text(g, "RESEARCH COMPLETE: " + n, 480, y, 22, C.cyan, "center"); y += 30; }
    if (a.note) { text(g, a.note, 480, y, 22, C.red, "center"); y += 30; }
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
    text(g, "TOTAL BEARINGS " + c.total, 480, 312, 22, C.amber, "center");
    if (c.taps + c.hand + c.mach > 0) text(g, fmtInt(c.taps) + " TAPS   " + Math.round((100 * c.hand) / Math.max(1e-9, c.hand + c.mach)) + "% BY HAND   " + c.stage, 480, 344, 18, C.muted, "center");
    text(g, "EVERYTHING ELSE STARTS AGAIN, FASTER.", 480, 382, 22, C.muted, "center");
    if (this.cardT > 1.2) text(g, this.s.b > 0 ? "PRESS TO SPEND BEARINGS" : "PRESS TO CONTINUE", 480, 424, 22, C.amber, "center");
  }
}
Outpost.music = { SONGS, MEL, GEN_ID, makeMelody, genTune, genName, scaleUp, midiHz, noteName, noteMidi, seeded, SCALES };
Outpost.econ = { RES, GOALS, STAGES, VOICE, EV, NR, NG, NS, NT, hasRes, tierOpen, tiersOwned, dataRate, masteredN, unlockedN, stageOf, fmtInt, fmtDate, revealOf, fmt, fmtRate, dur, costOf, prodMult, globalMult, evaluate, tapParts, capHours, pendingOf, readyOf, migrate, serialize, freshState, applyKit,
  PROD, UPG, TREE, EXPED, READY_RATIO, MILESTONES, SCHEMA, BIG, PRESTIGE_K, READY_MIN, KIT, NUP, NP, milestonesAt,
  readyRatio, chartCost, chartName, chartsOpen, CONST, CHART_REQ, CHART_MULT, CHART_MAX, GROOVE_MAX, VOICE_GAIN };
