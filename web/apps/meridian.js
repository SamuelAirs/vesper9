// MERIDIAN — a one-button timing game played on the three lamps. A light swings like a pendulum
// across the lamps; tap as it crosses the middle lamp (the meridian). Each swing is one gate.
// The run speeds up and moves through stages that change how the swing must be read: red swings
// that must pass untouched, swings that wander off centre, swings that go dark near the meridian,
// and feints that turn back before they cross. Three shields; a miss, a lapse or a burned red swing
// costs one. Holding on the title or result screen opens the observatory: daily run, sprint and
// eclipse modes (unlocked by feats), light colours, feats and a log. Save schema 1.
//
// The game is fully playable on the lamps alone: the swinging light is the play field and the middle
// lamp keeps a faint meridian marker. The screen draws the same pendulum, larger.
import { C, space, text, line, circle, diamond, banner } from "../engine/draw.js";
import { clamp, lerp, mixSeed, Random } from "../engine/math.js";
import { LAMP, lamps, dim, spot, pulse, only } from "../engine/lightshow.js";
import { AppGuard } from "../engine/input.js";
import { LampBus, lampMax } from "./game-kit.js";

const HOLD_PICK = 0.5; // a press this long on a menu screen chooses instead of tapping
// Timing windows in seconds either side of the crossing: PERFECT, GOOD, CLOSE. Judged in time, not
// position, so a fast swing and a slow one are equally fair.
export const WIN = [0.045, 0.09, 0.14];
const GRADES = ["PERFECT", "GOOD", "CLOSE"];
const BASE = [100, 60, 25];
const SHIELDS = 3;
export const PRACTICE = 4; // the first gates of a run cost nothing
const REGEN = 15; // gates in a row without a penalty restore a shield
const EDGE_L = -0.15, EDGE_R = 2.15; // a full swing passes a little beyond the end lamps
const SPRINT_S = 60;
// Stages: hits needed to clear (half as many in a sprint), half-swing duration at the start and end of the stage, and the
// rules that switch on. From the sixth stage on the game cycles with everything on, faster each time,
// and the timing windows narrow by a twentieth per cycle down to six tenths (`win`).
const STAGES = [
  { name: "SWING", hits: 12, d0: 1.25, d1: 0.92, note: "Tap as the light crosses the middle lamp." },
  { name: "RED PASS", hits: 16, d0: 1.05, d1: 0.82, note: "Red swings must pass untouched." },
  { name: "DRIFT", hits: 16, d0: 0.98, d1: 0.78, note: "The swing wanders. Watch it, do not count it." },
  { name: "ECLIPSE", hits: 16, d0: 0.92, d1: 0.72, note: "Some swings go dark at the meridian." },
  { name: "FEINT", hits: 16, d0: 0.86, d1: 0.68, note: "Some swings turn back before they cross." },
];
const ROMAN = ["I", "II", "III", "IV", "V"];
export function stageSpec(i) {
  if (i < STAGES.length) {
    return { ...STAGES[i], label: ROMAN[i] + "  " + STAGES[i].name, win: 1, red: i >= 1 ? 0.22 : 0, drift: i >= 2, blind: i >= 3 ? 0.28 : 0, feint: i >= 4 ? 0.22 : 0 };
  }
  const n = i - STAGES.length + 1;
  return { name: "CYCLE " + n, label: "CYCLE " + n, hits: 20, win: Math.max(0.6, 1 - 0.05 * n), d0: Math.max(0.5, 0.8 - 0.05 * n), d1: Math.max(0.44, 0.64 - 0.04 * n),
    note: "Everything at once, a little faster.", red: Math.min(0.3, 0.22 + 0.02 * n), drift: true, blind: Math.min(0.4, 0.28 + 0.03 * n), feint: Math.min(0.3, 0.22 + 0.02 * n) };
}
const MODES = {
  swing: { name: "SWING", text: "The plain run. Scores to the console." },
  daily: { name: "DAILY", text: "The same swings for everyone today, with a goal." },
  sprint: { name: "SPRINT", text: "Sixty seconds. A miss costs three of them.", need: 3 },
  eclipse: { name: "ECLIPSE", text: "Every swing goes dark at the meridian.", need: 6 },
};
const LIGHTS = [
  { name: "AMBER", rgb: LAMP.amber, css: C.amber, need: 0 },
  { name: "GREEN", rgb: LAMP.green, css: C.ink, need: 2 },
  { name: "VIOLET", rgb: LAMP.violet, css: "#c2a8f0", need: 5 },
  { name: "WHITE", rgb: LAMP.white, css: "#f2ead8", need: 9 },
];
const SCALE = [523, 587, 659, 784, 880, 1047, 1175, 1319]; // a pentatonic climb, one note per combo step
const ROWS = ["SWING", "DAILY", "SPRINT", "ECLIPSE", "LIGHT", "FEATS", "LOG"];

// ---- feats ------------------------------------------------------------------------------------
const life = (a, key) => (a.sv.st[key] || 0) + (a.R[key] || 0);
const FEATS = [
  { id: "first", name: "FIRST LIGHT", text: "Strike a PERFECT.", n: 1, prog: (a) => life(a, "perfects") },
  { id: "combo10", name: "STEADY HAND", text: "Reach a combo of 10.", n: 10, prog: (a) => a.bestCombo },
  { id: "combo30", name: "CLOCKWORK", text: "Reach a combo of 30.", n: 30, prog: (a) => a.bestCombo },
  { id: "mult8", name: "FULL SWING", text: "Reach the x8 multiplier.", n: 8, prog: (a) => a.R.maxMult },
  { id: "held", name: "HOLD FIRE", text: "Let 8 red swings pass in one run.", n: 8, prog: (a) => a.R.held },
  { id: "drift", name: "WANDERER", text: "Reach DRIFT.", n: 2, prog: (a) => Math.max(a.sv.far, a.R.far) },
  { id: "feint", name: "NOT FOOLED", text: "Reach FEINT.", n: 4, prog: (a) => Math.max(a.sv.far, a.R.far) },
  { id: "cycle", name: "FULL CIRCLE", text: "Reach the first CYCLE.", n: 5, prog: (a) => Math.max(a.sv.far, a.R.far) },
  { id: "blind", name: "NIGHT SIGHT", text: "Strike 5 dark swings in one run.", n: 5, prog: (a) => a.R.blind },
  { id: "clean", name: "UNSHAKEN", text: "Clear a stage after the first without losing a shield.", n: 1, prog: (a) => a.R.clean },
  { id: "sprint", name: "SIXTY SECONDS", text: "Score 4000 in a sprint.", n: 4000, prog: (a) => Math.max(a.sv.best.sprint, a.mode === "sprint" ? a.score : 0) },
  { id: "daily", name: "ON THE DAY", text: "Meet a daily goal.", n: 1, prog: (a) => life(a, "daily") },
  { id: "hits", name: "OBSERVER", text: "Strike 500 swings in all.", n: 500, prog: (a) => life(a, "hits") },
  { id: "centre", name: "DEAD CENTRE", text: "", hint: "Ten in a row, every one exact.", n: 10, hidden: true, prog: (a) => a.R.pRunMax },
  { id: "last", name: "LAST LIGHT", text: "", hint: "Some do their best work with nothing to spare.", n: 20, hidden: true, prog: (a) => a.R.lastHits },
];
const FEAT_IDS = FEATS.map((f) => f.id);

// ---- helpers ----------------------------------------------------------------------------------
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const hashText = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const fmtDay = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const dayBefore = (key) => { const [y, m, d] = key.split("-").map(Number); return fmtDay(new Date(y, m - 1, d - 1)); };
const dailyRng = new Random(1);
// Today's goal, the same for everyone on the same date.
export function dailyGoal(key) {
  const h = hashText("meridian" + key), kind = h % 4, v = (h >>> 8) % 5;
  if (kind === 0) return { kind: "score", n: 1500 + 500 * v, text: "Score " + (1500 + 500 * v) + "." };
  if (kind === 1) return { kind: "combo", n: 12 + 4 * v, text: "Reach a combo of " + (12 + 4 * v) + "." };
  if (kind === 2) return { kind: "held", n: 4 + v, text: "Let " + (4 + v) + " red swings pass." };
  return { kind: "stage", n: 2 + (v % 3), text: "Reach " + STAGES[2 + (v % 3)].name + "." };
}
// Bring any stored shape (nothing, a stray object, schema 1) to schema 1.
export function migrateSave(raw) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const o = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const st = o(r.st), best = o(r.best), sel = o(r.sel), dl = o(r.dl);
  const pos = (v) => Math.max(0, Math.floor(num(v)));
  return {
    schema: 1,
    runs: pos(r.runs),
    last: o(r.last),
    milestone: pos(r.milestone),
    far: Math.min(99, pos(r.far)),
    ft: Array.isArray(r.ft) ? r.ft.filter((id, i) => FEAT_IDS.includes(id) && r.ft.indexOf(id) === i) : [],
    st: { hits: pos(st.hits), perfects: pos(st.perfects), held: pos(st.held), daily: pos(st.daily) },
    best: { swing: pos(best.swing), sprint: pos(best.sprint), eclipse: pos(best.eclipse), combo: pos(best.combo) },
    sel: { light: clamp(pos(sel.light), 0, LIGHTS.length - 1) },
    dl: { d: typeof dl.d === "string" ? dl.d.slice(0, 10) : "", best: pos(dl.best), done: dl.done ? 1 : 0, streak: pos(dl.streak), last: typeof dl.last === "string" ? dl.last.slice(0, 10) : "" },
  };
}
// Where the swing is at time t: a half-swing runs from x0 to x1 (lamp units, 0 = left lamp,
// 1 = the meridian, 2 = right lamp) as half a cosine, so it slows at the ends like a pendulum.
export function swingX(sw, t) {
  const u = clamp((t - sw.t0) / sw.D, 0, 1), mid = (sw.x0 + sw.x1) / 2;
  return mid + (sw.x0 - mid) * Math.cos(Math.PI * u);
}
// When a half-swing crosses the meridian, or null if it does not.
export function crossing(sw) {
  if ((sw.x0 - 1) * (sw.x1 - 1) >= 0) return null;
  const mid = (sw.x0 + sw.x1) / 2, k = (1 - mid) / (sw.x0 - mid);
  return sw.t0 + (sw.D * Math.acos(clamp(k, -1, 1))) / Math.PI;
}
// The pendulum on screen: the pivot, the rod length, and a bob position for a lamp-unit x.
const PX = 480, PY = 58, ROD = 420, SPAN = 220;
const bobX = (x) => PX + clamp(x - 1, -1.25, 1.25) * SPAN;
const bobY = (x) => { const dx = bobX(x) - PX; return PY + Math.sqrt(ROD * ROD - dx * dx); };
const ARC = Array.from({ length: 27 }, (_, i) => -0.3 + i * 0.1).map((x) => [bobX(x), bobY(x)]);
// A lamp's colour at full strength, for the sockets that mirror the lamps (their level becomes alpha).
const hue = (v, i) => { const m = Math.max(v[i], v[i + 1], v[i + 2], 1), k = 255 / m; return "rgb(" + Math.round(v[i] * k) + "," + Math.round(v[i + 1] * k) + "," + Math.round(v[i + 2] * k) + ")"; };

export class Meridian {
  constructor(ctx) {
    this.c = ctx;
    this.lamps = new LampBus(ctx);
    this.guard = new AppGuard(this, ctx); // takes back a menu gesture that reached the game (docs/ENGINE.md)
    this.sv = migrateSave(ctx.progress?.());
    this.t = 0;
    this.phase = "title";
    this.mode = "swing";
    this.armed = false; // a press on a menu screen that waits for its release
    this.pt = 0;
    this.view = "menu";
    this.cur = 0;
    this.page = 0;
    this.sq = []; // queued notes: [due, hz, seconds, wave]
    this.hudKey = "";
    this.hintText = "";
    this.lampOut = Array(9).fill(0);
    this.reset();
    this.phase = "title";
    this.setHint("Tap as the light crosses the middle lamp. Hold for the observatory.");
    this.c.hud([["BEST", this.c.best?.() ?? 0]]);
  }

  // ---- run state ------------------------------------------------------------------------------
  reset() {
    this.rt = 0;
    this.score = 0;
    this.shields = SHIELDS;
    this.combo = 0;
    this.bestCombo = 0;
    this.streak = 0; // gates in a row without a penalty
    this.stage = 0;
    this.stageHits = 0;
    this.stageClean = true;
    this.gates = 0; // gates met so far (practice counts the first few)
    this.clock = SPRINT_S;
    this.lastRed = 0;
    this.lapseAt = -9;
    this.prev = null;
    // The light waits at the right end for a moment before the first swing.
    this.sw = { t0: 0.8, D: 1.25, x0: EDGE_R, x1: EDGE_L, feint: false, gate: null };
    this.sw.gate = this.makeGate(this.sw, false);
    this.trail = [];
    this.fb = null; // the last judgement on screen: { word, pts, col, t }
    this.note = "";
    this.noteT = 0;
    this.deadT = 0;
    this.newRecord = false;
    this.best0 = 0;
    this.result = null;
    this.newFeats = [];
    this.goalDone = false;
    this.dseed = 0;
    this.R = { hits: 0, perfects: 0, held: 0, blind: 0, maxMult: 0, far: 0, clean: 0, pRun: 0, pRunMax: 0, lastHits: 0, daily: 0 };
  }
  dayKey() { return fmtDay(new Date()); }
  // A random draw: the console's generator, or a generator seeded by the date on a daily run.
  rand() {
    if (this.mode !== "daily") return this.c.rng.next();
    dailyRng.state = this.dseed || 1;
    const v = dailyRng.next();
    this.dseed = dailyRng.state;
    return v;
  }
  range(a, b) { return a + (b - a) * this.rand(); }
  spec() { return stageSpec(this.stage); }
  mult() { return Math.min(8, 1 + Math.floor(this.combo / 5)); }
  bestRef() {
    if (this.mode === "daily") return this.sv.dl.d === this.dayKey() ? this.sv.dl.best : 0;
    if (this.mode === "swing") return Math.max(this.c.best?.() ?? 0, this.sv.best.swing);
    return this.sv.best[this.mode] || 0;
  }
  unlocked(mode) { return this.sv.ft.length >= (MODES[mode].need || 0); }
  light() { const l = LIGHTS[this.sv.sel.light] || LIGHTS[0]; return this.sv.ft.length >= l.need ? l : LIGHTS[0]; }

  makeGate(sw, live = true) {
    const at = crossing(sw);
    if (at === null) return null;
    const sp = this.spec(), practice = this.gates < PRACTICE;
    let kind = "normal";
    if (live && !practice && this.lastRed < 2 && this.rand() < sp.red) kind = "red";
    this.lastRed = kind === "red" ? this.lastRed + 1 : 0;
    const blindP = this.mode === "eclipse" ? 1 : sp.blind;
    const blind = kind === "normal" && !practice && (blindP >= 1 || (live && this.rand() < blindP));
    this.gates++;
    return { t: at, kind, blind, done: false, practice };
  }
  // The next half-swing starts where the last one turned.
  nextSwing() {
    const old = this.sw, sp = this.spec();
    this.prev = old.gate;
    const t0 = old.t0 + old.D, x0 = old.x1, right = x0 > 1;
    const progress = clamp(this.stageHits / sp.hits, 0, 1);
    let D = lerp(sp.d0, sp.d1, progress);
    if (this.mode === "sprint") D *= 0.9;
    if (sp.drift) D *= this.range(0.86, 1.16);
    let x1, feint = false;
    // A feint turns back on its own side before it reaches the meridian; never two in a row.
    if (sp.feint && !old.feint && this.gates >= PRACTICE && Math.abs(x0 - 1) > 0.95 && this.rand() < sp.feint) {
      feint = true;
      x1 = 1 + (right ? 1 : -1) * this.range(0.38, 0.6);
    } else if (sp.drift) x1 = right ? this.range(EDGE_L, 0.6) : this.range(1.4, EDGE_R);
    else x1 = right ? EDGE_L : EDGE_R;
    this.sw = { t0, D: clamp(D, 0.4, 1.6), x0, x1, feint, gate: null };
    this.sw.gate = this.makeGate(this.sw);
    if ((sp.blind > 0 || this.mode === "eclipse") && this.phase === "play") this.c.tone(330, 0.03, "sine"); // a quiet metronome when swings can go dark
  }
  x() { return swingX(this.sw, this.rt); }

  // ---- input ----------------------------------------------------------------------------------
  // On the title, result and observatory screens a press is decided when it ends: a tap is the main
  // action, a press of HOLD_PICK or more opens or operates the observatory. In play the press edge
  // is the strike, judged at once.
  down() {
    this.guard.mark();
    if (this.phase === "title" || this.phase === "menu" || (this.phase === "over" && this.deadT > 0.7)) {
      this.armed = true;
      this.pt = this.t;
      return;
    }
    if (this.phase === "play") this.strike();
  }
  up() {
    this.guard.release();
    if (!this.armed) return;
    this.armed = false;
    this.menuPress(this.t - this.pt);
  }
  cancel() {
    this.guard.rewind();
    this.armed = false;
    this.lamps.clear();
  }
  pause() { this.guard.settle(); this.armed = false; this.lamps.sleep(); }
  resume() { this.lamps.wake(); }
  dispose() { this.guard.settle(); this.lamps.sleep(); }

  menuPress(dur) {
    const long = dur >= HOLD_PICK;
    if (this.phase === "title" || this.phase === "over") {
      if (long) this.openMenu();
      else this.start(this.phase === "over" ? this.mode : "swing");
      return;
    }
    if (this.view !== "menu") {
      if (long || this.view === "log") { this.view = "menu"; this.page = 0; }
      else this.page = (this.page + 1) % Math.ceil(FEATS.length / 6);
      return;
    }
    if (!long) { this.cur = (this.cur + 1) % ROWS.length; this.c.tone(440, 0.03, "sine"); return; }
    this.choose();
  }
  openMenu() {
    this.phase = "menu";
    this.view = "menu";
    this.cur = 0;
    this.page = 0;
    this.setHint("Tap: next line. Hold: choose.");
  }
  choose() {
    const row = ROWS[this.cur];
    if (row === "FEATS") { this.view = "feats"; this.page = 0; return; }
    if (row === "LOG") { this.view = "log"; return; }
    if (row === "LIGHT") {
      let i = this.sv.sel.light;
      do i = (i + 1) % LIGHTS.length; while (this.sv.ft.length < LIGHTS[i].need);
      this.sv.sel.light = i;
      this.c.tone(520, 0.05, "sine");
      this.persist();
      return;
    }
    const mode = row.toLowerCase();
    if (!this.unlocked(mode)) { this.c.tone(150, 0.08, "square"); return; }
    this.start(mode);
  }
  start(mode) {
    this.mode = mode;
    this.reset();
    this.phase = "play";
    if (mode === "daily") this.dseed = mixSeed(hashText("meridian-day" + this.dayKey())) || 1;
    this.best0 = this.bestRef();
    this.announce(mode === "swing" ? this.spec().note : MODES[mode].name + ": " + MODES[mode].text, 3.4);
    this.setHint(mode === "eclipse" ? "Listen for the turns. Tap where the meridian would be." : "Tap as the light crosses the middle lamp. Let red swings pass.");
    this.lamps.clear();
  }

  // A press in play: judged against the nearest gate still open.
  strike() {
    const g = this.nearestGate(), k = this.spec().win;
    const err = g ? Math.abs(this.rt - g.t) : Infinity;
    if (!g || err > WIN[2] * k) {
      // Just after a swing that lapsed: the same miss, already paid for.
      if (this.rt - this.lapseAt < 0.35) { this.fb = { word: "LATE", pts: 0, col: C.red, t: 0.7 }; return; }
      // Too far from any crossing. The coming gate is spent too, so one mistake costs one shield.
      const next = this.sw.gate;
      if (next && !next.done && next.t - this.rt < 0.45) next.done = true;
      this.penalty("WIDE", next?.practice ?? this.gates <= PRACTICE);
      return;
    }
    g.done = true;
    if (g.kind === "red") { this.penalty("BURNED", g.practice); return; }
    this.hit(g, err <= WIN[0] * k ? 0 : err <= WIN[1] * k ? 1 : 2);
  }
  nearestGate() {
    let best = null;
    for (const g of [this.prev, this.sw.gate]) {
      if (!g || g.done) continue;
      if (!best || Math.abs(this.rt - g.t) < Math.abs(this.rt - best.t)) best = g;
    }
    return best;
  }
  hit(g, grade) {
    const sp = this.spec();
    if (grade < 2) this.combo++;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    const m = this.mult();
    this.R.maxMult = Math.max(this.R.maxMult, m);
    const pts = Math.round(BASE[grade] * m * (1 + 0.1 * Math.min(this.stage, 10)) * (g.blind ? 1.5 : 1));
    this.score += pts;
    this.R.hits++;
    if (grade === 0) { this.R.perfects++; this.R.pRun++; this.R.pRunMax = Math.max(this.R.pRunMax, this.R.pRun); } else this.R.pRun = 0;
    if (g.blind) this.R.blind++;
    if (this.shields === 1 && this.mode !== "sprint") this.R.lastHits++;
    this.fb = { word: GRADES[grade], pts, col: grade === 0 ? C.cyan : grade === 1 ? C.ink : C.amber, t: 0.9 };
    this.c.tone(SCALE[this.combo % SCALE.length] * (grade === 2 ? 0.5 : 1), grade === 0 ? 0.12 : 0.08, grade === 0 ? "triangle" : "sine");
    const mid = grade === 0 ? LAMP.white : grade === 1 ? LAMP.green : LAMP.amber;
    this.lamps.flash(0.28, (e) => lamps(grade === 0 ? dim(LAMP.green, 0.35 * (1 - e / 0.28)) : null, dim(mid, 0.85 * (1 - e / 0.28) + 0.1), grade === 0 ? dim(LAMP.green, 0.35 * (1 - e / 0.28)) : null));
    this.cleared();
    this.stageHits++;
    if (this.stageHits >= (this.mode === "sprint" ? Math.ceil(sp.hits / 2) : sp.hits)) this.advance();
    this.checkFeats();
  }
  // A red swing that passed untouched.
  held() {
    const pts = 40 * this.mult();
    this.score += pts;
    this.R.held++;
    this.fb = { word: "HELD", pts, col: C.red, t: 0.7 };
    this.c.tone(392, 0.06, "triangle");
    this.cleared();
    this.checkFeats();
  }
  cleared() {
    this.streak++;
    if (this.streak % REGEN === 0 && this.shields < SHIELDS && this.mode !== "sprint") {
      this.shields++;
      this.announce("SHIELD RESTORED", 1.6);
      this.queue(0.1, 988, 0.1, "sine");
      this.lamps.flash(0.5, (e) => spot(e / 0.5, dim(LAMP.cyan, 0.6)));
    }
  }
  penalty(word, free) {
    this.combo = 0;
    this.streak = 0;
    this.R.pRun = 0;
    this.fb = { word: free ? word + " / PRACTICE" : word, pts: 0, col: C.red, t: 0.9 };
    this.c.tone(110, 0.2, "sawtooth");
    this.lamps.flash(0.4, (e) => lamps(dim(LAMP.red, 0.7 * (1 - e / 0.4)), null, dim(LAMP.red, 0.7 * (1 - e / 0.4))));
    if (free) return;
    this.stageClean = false;
    if (this.mode === "sprint") { this.clock -= 3; return; }
    this.shields--;
    if (this.shields <= 0) this.finish();
  }
  advance() {
    if (this.stage >= 1 && this.stageClean) this.R.clean = 1;
    this.stage++;
    this.stageHits = 0;
    this.stageClean = true;
    this.R.far = Math.max(this.R.far, this.stage);
    const sp = this.spec();
    this.announce(sp.label + ": " + sp.note, 3.4);
    [659, 784, 1047].forEach((hz, i) => this.queue(0.08 * i, hz, 0.12, "sine"));
    this.lamps.flash(0.6, (e) => only(Math.min(2, Math.floor(e / 0.2)), LAMP.cyan, 0.6));
  }
  announce(message, seconds) { this.note = message; this.noteT = seconds; }
  queue(after, hz, sec, wave) { if (this.sq.length < 8) this.sq.push([this.t + after, hz, sec, wave]); }
  setHint(message) { if (message !== this.hintText) { this.hintText = message; this.c.hint(message); } }

  checkFeats() {
    for (const f of FEATS) {
      if (this.sv.ft.includes(f.id)) continue;
      if (f.prog(this) >= f.n) {
        this.sv.ft.push(f.id);
        this.newFeats.push(f.id);
        this.announce("FEAT: " + f.name, 3);
        this.queue(0, 659, 0.1, "sine");
        this.queue(0.12, 880, 0.18, "sine");
      }
    }
  }
  goalMet() {
    const g = dailyGoal(this.dayKey());
    if (g.kind === "score") return this.score >= g.n;
    if (g.kind === "combo") return this.bestCombo >= g.n;
    if (g.kind === "held") return this.R.held >= g.n;
    return this.R.far >= g.n;
  }
  finish() {
    if (this.phase !== "play") return;
    this.phase = "over";
    this.deadT = 0;
    this.fb = null;
    const sv = this.sv, score = this.score;
    this.newRecord = score > 0 && score > this.best0;
    if (this.mode === "swing") this.c.score(score);
    this.c.tone(this.mode === "sprint" ? 523 : 82, 0.4, this.mode === "sprint" ? "sine" : "sawtooth");
    sv.runs++;
    sv.st.hits += this.R.hits;
    sv.st.perfects += this.R.perfects;
    sv.st.held += this.R.held;
    sv.far = Math.max(sv.far, this.R.far);
    sv.best.combo = Math.max(sv.best.combo, this.bestCombo);
    if (this.mode === "daily") {
      const key = this.dayKey();
      this.goalDone = this.goalMet();
      if (sv.dl.d !== key) { sv.dl.d = key; sv.dl.best = 0; sv.dl.done = 0; }
      sv.dl.best = Math.max(sv.dl.best, score);
      if (this.goalDone && !sv.dl.done) {
        sv.dl.done = 1;
        sv.st.daily++;
        sv.dl.streak = sv.dl.last && dayBefore(key) === sv.dl.last ? sv.dl.streak + 1 : 1;
        sv.dl.last = key;
      }
    } else sv.best[this.mode] = Math.max(sv.best[this.mode] || 0, score);
    // Run totals are now in the lifetime counters; leave the run's own values for the feats that read them.
    this.R.hits = 0; this.R.perfects = 0;
    this.checkFeats();
    this.result = { score, combo: this.bestCombo, stage: this.spec().label, mode: MODES[this.mode].name, milestone: Math.floor(score / 500) };
    sv.milestone = Math.max(sv.milestone, this.result.milestone);
    sv.last = { ...this.result };
    this.persist();
    this.result.next = this.nextGoal();
    this.setHint("Tap to swing again. Hold for the observatory.");
    this.c.hud([["SCORE", score], ["BEST COMBO", this.bestCombo], ["REACHED", this.spec().label], ["BEST", this.bestRef()]]);
    this.hudKey = "";
  }
  persist() { this.c.saveProgress?.(JSON.parse(JSON.stringify(this.sv)))?.catch?.(this.c.error); }
  // The nearest unlock and the open feat nearest its goal.
  nextGoal() {
    const n = this.sv.ft.length, lines = [];
    const locked = [...Object.values(MODES).filter((m) => m.need && n < m.need).map((m) => [m.need, m.name + " MODE"]), ...LIGHTS.filter((l) => n < l.need).map((l) => [l.need, l.name + " LIGHT"])].sort((a, b) => a[0] - b[0]);
    if (locked.length) lines.push("NEXT: " + locked[0][1] + " AT " + locked[0][0] + " FEATS (" + n + ")");
    let best = null, frac = 0;
    for (const f of FEATS) {
      if (this.sv.ft.includes(f.id) || f.hidden) continue;
      const p = f.prog(this) / f.n;
      if (p > frac && p < 1) { frac = p; best = f; }
    }
    if (best) lines.push("CLOSEST: " + best.name + " " + Math.floor(best.prog(this)) + " / " + best.n);
    return lines;
  }

  // ---- frame ----------------------------------------------------------------------------------
  update(dt) {
    this.guard.tick(dt);
    this.t += dt;
    while (this.sq.length && this.sq[0][0] <= this.t) { const [, hz, s, w] = this.sq.shift(); this.c.tone(hz, s, w); }
    if (this.noteT > 0) this.noteT -= dt;
    if (this.fb) { this.fb.t -= dt; if (this.fb.t <= 0) this.fb = null; }
    if (this.phase === "play") this.step(dt);
    else {
      // The title and menus keep a slow swing going behind them.
      this.rt += dt * 0.6;
      for (let i = 0; i < 4 && this.rt >= this.sw.t0 + this.sw.D; i++) this.sw = { t0: this.sw.t0 + this.sw.D, D: 1.4, x0: this.sw.x1, x1: this.sw.x1 > 1 ? EDGE_L : EDGE_R, feint: false, gate: null };
      if (this.phase === "over") this.deadT += dt;
    }
    this.lampOut = this.lampValues();
    this.lamps.frame(dt, this.lampOut);
    this.pushHud();
  }
  step(dt) {
    this.rt += dt;
    if (this.mode === "sprint") { this.clock -= dt; if (this.clock <= 0) { this.clock = 0; this.finish(); return; } }
    for (let i = 0; i < 4 && this.rt >= this.sw.t0 + this.sw.D; i++) this.nextSwing();
    const late = WIN[2] * this.spec().win;
    for (const g of [this.prev, this.sw.gate]) {
      if (!g || g.done || this.rt <= g.t + late) continue;
      g.done = true;
      if (g.kind === "red") this.held();
      else { this.penalty("LAPSE", g.practice); this.lapseAt = this.rt; }
      if (this.phase !== "play") return;
    }
    const x = this.x();
    this.trail.push(x);
    if (this.trail.length > 10) this.trail.shift();
  }
  pushHud() {
    if (this.phase !== "play") return;
    const items = [["SCORE", this.score], ["COMBO", this.combo + "  x" + this.mult()],
      this.mode === "sprint" ? ["TIME", Math.ceil(this.clock) + " s"] : ["SHIELDS", this.shields + " / " + SHIELDS], ["STAGE", this.spec().label]];
    const key = items.join("|");
    if (key !== this.hudKey) { this.hudKey = key; this.c.hud(items); }
  }
  // Is the light hidden at x? Dark swings hide it near the meridian.
  hidden(x) {
    const g = this.sw.gate;
    return this.phase === "play" && !!g && g.blind && Math.abs(x - 1) < 0.62;
  }

  // ---- lamps ----------------------------------------------------------------------------------
  // The swinging light is a spot that moves across the lamps; the middle lamp keeps a faint marker.
  lampValues() {
    const x = this.x(), col = this.light().rgb;
    if (this.phase === "title" || this.phase === "menu") return spot(x / 2, dim(col, 0.12));
    if (this.phase === "over") {
      if (this.deadT < 1.2) return lamps(dim(LAMP.red, 0.3 * (1 - this.deadT / 1.2)), null, dim(LAMP.red, 0.3 * (1 - this.deadT / 1.2)));
      if (this.newRecord) return lamps(null, dim(LAMP.amber, 0.08 + 0.12 * pulse(this.t, 0.5)), null);
      return spot(x / 2, dim(col, 0.06));
    }
    const g = this.sw.gate, red = g && g.kind === "red";
    const marker = only(1, red ? LAMP.red : LAMP.cyan, red ? 0.16 : 0.1);
    let out = marker;
    if (!this.hidden(x)) out = lampMax(out, spot(x / 2, dim(red ? LAMP.red : col, 0.55)));
    // On the last shield the side lamps breathe a faint red.
    if (this.shields === 1 && this.mode !== "sprint") out = lampMax(out, lamps(dim(LAMP.red, 0.06 * pulse(this.t, 0.8)), null, dim(LAMP.red, 0.06 * pulse(this.t, 0.8))));
    return out;
  }

  // ---- drawing --------------------------------------------------------------------------------
  draw(g) {
    space(g, this.t * 6, 0.25);
    if (this.phase === "title" || this.phase === "play") this.drawPendulum(g);
    if (this.phase === "play") this.drawPlay(g);
    else if (this.phase === "title") banner(g, "MERIDIAN", "A light swings across the three lamps. Tap as it crosses the middle one.");
    else if (this.phase === "over") this.drawOver(g);
    else this.drawMenu(g);
  }
  drawPendulum(g) {
    const x = this.x(), play = this.phase === "play", gate = play ? this.sw.gate : null;
    const red = gate && gate.kind === "red", lc = this.light();
    // The meridian and the bob's path.
    g.setLineDash?.([6, 8]);
    line(g, PX, PY, PX, 520, C.line, 2);
    g.setLineDash?.([]);
    g.strokeStyle = C.line; g.lineWidth = 2; g.beginPath();
    for (let i = 0; i < ARC.length; i++) (i ? g.lineTo : g.moveTo).call(g, ARC[i][0], ARC[i][1]);
    g.stroke();
    // Lamp sockets mirror the real lamps.
    const out = this.lampOut;
    for (let i = 0; i < 3; i++) {
      const lx = i, sx = bobX(lx), sy = bobY(lx);
      const level = Math.max(out[i * 3], out[i * 3 + 1], out[i * 3 + 2]);
      if (level > 0) { g.globalAlpha = clamp(level / 150, 0.18, 0.9); circle(g, sx, sy, 22, hue(out, i * 3), true); g.globalAlpha = 1; }
      circle(g, sx, sy, 28, i === 1 ? (red ? C.red : C.cyan) : C.line, false, i === 1 ? 3 : 2);
    }
    circle(g, PX, PY, 7, C.muted, true);
    if (this.hidden(x)) return;
    const colour = red ? C.red : lc.css;
    const bx = bobX(x), by = bobY(x);
    line(g, PX, PY, bx, by, play ? C.muted : C.line, 2);
    if (play) {
      for (let i = 0; i < this.trail.length - 1; i++) {
        const tx = this.trail[i];
        if (this.hidden(tx)) continue;
        g.globalAlpha = (i + 1) / this.trail.length * 0.35;
        circle(g, bobX(tx), bobY(tx), 10, colour, true);
      }
      g.globalAlpha = 1;
    }
    circle(g, bx, by, play ? 15 : 11, colour, true);
  }
  drawPlay(g) {
    // Shields as diamonds, top right; the multiplier, top left.
    if (this.mode === "sprint") text(g, Math.ceil(this.clock) + " s", 920, 44, 30, this.clock < 10 ? C.red : C.amber, "right");
    else for (let i = 0; i < SHIELDS; i++) diamond(g, 856 + i * 34, 44, 12, i < this.shields ? C.cyan : C.line, i < this.shields);
    text(g, "x" + this.mult(), 40, 48, 34, this.mult() > 1 ? C.amber : C.muted);
    if (this.gates <= PRACTICE) text(g, "PRACTICE SWINGS", 40, 88, 18, C.cyan);
    if (this.noteT > 0) text(g, this.note, 480, 128, 22, C.amber, "center");
    if (this.fb) {
      g.globalAlpha = clamp(this.fb.t / 0.3, 0, 1);
      text(g, this.fb.word, 480, 214, 34, this.fb.col, "center");
      if (this.fb.pts) text(g, "+" + this.fb.pts, 480, 254, 22, C.muted, "center");
      g.globalAlpha = 1;
    }
    const gate = this.sw.gate;
    if (gate && gate.kind === "red" && !gate.done) text(g, "LET IT PASS", 480, 314, 24, C.red, "center");
    else if (gate && gate.blind && !gate.done) text(g, "DARK SWING", 480, 314, 24, C.muted, "center");
  }
  drawOver(g) {
    const r = this.result || {};
    g.fillStyle = "#0c1511f0";
    g.fillRect(150, 52, 660, 450);
    line(g, 200, 62, 760, 62, C.line);
    text(g, r.mode === "SWING" ? "MERIDIAN" : "MERIDIAN / " + r.mode, 480, 96, 32, C.amber, "center");
    let y = 150;
    const row = (label, value, col = C.ink) => { text(g, label, 230, y, 18, C.muted); text(g, value, 730, y, 26, col, "right"); y += 38; };
    row("SCORE", String(r.score ?? 0));
    row("BEST COMBO", String(r.combo ?? 0));
    row("REACHED", r.stage || "");
    text(g, this.newRecord ? "NEW BEST" : "BEST " + this.bestRef(), 480, y + 2, 20, this.newRecord ? C.cyan : C.amber, "center");
    y += 36;
    if (this.mode === "daily") { text(g, this.goalDone ? "DAILY GOAL MET" : "DAILY: " + dailyGoal(this.dayKey()).text, 480, y, 18, this.goalDone ? C.cyan : C.muted, "center"); y += 28; }
    for (const id of this.newFeats.slice(0, 2)) {
      const f = FEATS.find((x) => x.id === id);
      if (f) { text(g, "FEAT  " + f.name, 480, y, 20, C.cyan, "center"); y += 28; }
    }
    for (const l of (r.next || []).slice(0, 2)) { text(g, l, 480, y, 18, C.muted, "center"); y += 26; }
    if (this.deadT > 0.7) text(g, "TAP = AGAIN     HOLD = OBSERVATORY", 480, 476, 20, C.amber, "center");
  }
  drawMenu(g) {
    g.fillStyle = "#0c1511f2";
    g.fillRect(110, 36, 740, 470);
    line(g, 160, 46, 800, 46, C.line);
    text(g, "OBSERVATORY", 480, 82, 34, C.amber, "center");
    const sv = this.sv, n = sv.ft.length;
    if (this.view === "menu") {
      const lock = (m) => (this.unlocked(m) ? null : "AT " + MODES[m].need + " FEATS");
      const rows = {
        SWING: ["SWING", "BEST " + this.bestRefFor("swing")],
        DAILY: ["DAILY", this.sv.dl.d === this.dayKey() && this.sv.dl.done ? "DONE TODAY" : "SEEDED BY DATE"],
        SPRINT: ["SPRINT", lock("sprint") || "BEST " + sv.best.sprint],
        ECLIPSE: ["ECLIPSE", lock("eclipse") || "BEST " + sv.best.eclipse],
        LIGHT: ["LIGHT", this.light().name],
        FEATS: ["FEATS", n + " / " + FEATS.length],
        LOG: ["LOG", "RUNS " + sv.runs],
      };
      ROWS.forEach((id, i) => {
        const y = 140 + i * 42, on = i === this.cur;
        const locked = (id === "SPRINT" && !this.unlocked("sprint")) || (id === "ECLIPSE" && !this.unlocked("eclipse"));
        if (on) diamond(g, 150, y, 9, C.amber, true);
        text(g, rows[id][0], 180, y, 24, on ? C.amber : locked ? C.line : C.ink);
        text(g, rows[id][1], 810, y, 22, on ? C.amber : C.muted, "right");
      });
      const id = ROWS[this.cur];
      let info;
      if (id === "LIGHT") { const next = LIGHTS.find((l) => n < l.need); info = "The colour of the swinging light." + (next ? "  NEXT: " + next.name + " AT " + next.need : ""); }
      else if (id === "FEATS") info = "Named goals. Some are not listed.";
      else if (id === "LOG") info = "What you have done so far.";
      else if (id === "DAILY") info = "Goal: " + dailyGoal(this.dayKey()).text + (sv.dl.streak > 1 ? "  STREAK " + sv.dl.streak : "");
      else info = MODES[id.toLowerCase()].text;
      text(g, info, 480, 446, 18, C.muted, "center");
      text(g, "TAP = NEXT LINE     HOLD = CHOOSE", 480, 480, 18, C.cyan, "center");
    } else if (this.view === "feats") {
      const per = 6, pages = Math.ceil(FEATS.length / per);
      text(g, "FEATS  " + n + " / " + FEATS.length + "     PAGE " + (this.page + 1) + " / " + pages, 480, 118, 20, C.cyan, "center");
      FEATS.slice(this.page * per, this.page * per + per).forEach((f, i) => {
        const y = 156 + i * 52, done = sv.ft.includes(f.id);
        text(g, (done ? "[X] " : "[ ] ") + (f.hidden && !done ? "????" : f.name), 150, y, 22, done ? C.cyan : C.ink);
        if (!f.hidden || done) text(g, done ? "DONE" : Math.floor(Math.min(f.prog(this), f.n)) + " / " + f.n, 810, y, 20, done ? C.cyan : C.amber, "right");
        text(g, f.hidden && !done ? f.hint : f.text, 150, y + 24, 16, C.muted);
      });
      text(g, "TAP = NEXT PAGE     HOLD = BACK", 480, 480, 18, C.cyan, "center");
    } else {
      const lines = [
        ["RUNS", sv.runs], ["SWINGS STRUCK", sv.st.hits], ["PERFECT", sv.st.perfects], ["RED SWINGS HELD", sv.st.held],
        ["BEST COMBO", sv.best.combo], ["FURTHEST", stageSpec(sv.far).label], ["DAILY GOALS", sv.st.daily + (sv.dl.streak > 1 ? "  STREAK " + sv.dl.streak : "")],
      ];
      lines.forEach(([k, v], i) => { const y = 130 + i * 44; text(g, k, 150, y, 22, C.ink); text(g, String(v), 810, y, 22, C.amber, "right"); });
      text(g, "TAP = BACK", 480, 480, 18, C.cyan, "center");
    }
  }
  bestRefFor(mode) { return mode === "swing" ? Math.max(this.c.best?.() ?? 0, this.sv.best.swing) : this.sv.best[mode] || 0; }
}
