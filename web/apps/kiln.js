// KILN — a one-button firing game. Hold to heat the kiln; release and the heat keeps climbing for a
// moment (the kiln's inertia) before it settles. Land the settled heat inside the pot's band. The skill
// is letting go early: the faster the heat is rising when you release, the further it coasts.
// One confident hold scores double; feathering with extra presses (each within a moment of the heat
// settling) is safer and worth less.
// Stages change the clay: the pyrometer that shows where the heat will land fails, bands narrow and
// rise, the band wanders, and draughts change how far the heat coasts. Three shelves; a pot fired
// outside its band costs one. Holding on the title or result screen opens the yard: daily firing,
// a twelve-pot trial and a lamps-only firing (unlocked by feats), the glaze shelf, feats and a log.
//
// The lamps are the kiln's heat: a meter across the three lamps that warms from red to white. Before
// each pot a cyan spot shows where its band sits on that meter, so the game can be played on the lamps.
import { C, space, text, line, circle, diamond, banner } from "../engine/draw.js";
import { clamp, lerp, mixSeed, Random } from "../engine/math.js";
import { LAMP, lamps, dim, blend, ramp, spot, meter, pulse, fill } from "../engine/lightshow.js";
import { AppGuard } from "../engine/input.js";
import { LampBus, lampMax } from "./game-kit.js";

const HOLD_PICK = 0.5; // a press this long on a menu screen chooses instead of tapping
const SHELVES = 3;
export const PRACTICE = 2; // the first pots of a run cost nothing
const REGEN = 10; // pots in a row inside their band restore a shelf
const SHOW = 0.55; // seconds a new pot's band is shown on the lamps before it may be judged cold
const COLD = 5; // a pot left unfired this long is spoiled
const SETTLE = 0.05; // below this rate (heat per second) a released kiln is judged where it will settle
const REST = 0.35; // a settled kiln waits this long for another touch before the pot is judged
const TRIAL_POTS = 12;
// Grades inside the band, by distance from its centre as a share of the half-width.
export const GRADE = [0.22, 0.6];
const NAMES = ["PERFECT", "GOOD", "FIRED"];
const BASE = [100, 60, 30];
// Clays. accel: heat per second squared while held; coast: seconds of inertia after release;
// band: half-width; lo/hi: where the band's centre may sit (heat runs 0 to 1); pyro: the landing
// marker is shown; wander: the band drifts during the pot; draught: coast varies pot to pot.
const STAGES = [
  { name: "EARTHENWARE", pots: 8, accel: 0.34, coast: 0.24, band: 0.085, lo: 0.4, hi: 0.6, pyro: true, note: "Hold to heat. Let go early: the heat coasts on." },
  { name: "STONEWARE", pots: 8, accel: 0.42, coast: 0.3, band: 0.075, lo: 0.45, hi: 0.72, pyro: true, note: "Hotter clay, longer coast." },
  { name: "PORCELAIN", pots: 8, accel: 0.46, coast: 0.32, band: 0.06, lo: 0.55, hi: 0.8, pyro: false, note: "The pyrometer has failed. Judge it yourself." },
  { name: "RAKU", pots: 8, accel: 0.5, coast: 0.34, band: 0.065, lo: 0.45, hi: 0.75, pyro: false, wander: 0.05, note: "The band wanders. Land where it will be." },
  { name: "ASH GLAZE", pots: 8, accel: 0.52, coast: 0.36, band: 0.065, lo: 0.45, hi: 0.8, pyro: false, draught: true, note: "Draughts. A flickering kiln coasts further." },
];
const ROMAN = ["I", "II", "III", "IV", "V"];
export function stageSpec(i) {
  if (i < STAGES.length) return { ...STAGES[i], label: ROMAN[i] + "  " + STAGES[i].name };
  const n = i - STAGES.length + 1;
  return { name: "KILN " + n, label: "KILN " + n, pots: 10, accel: Math.min(0.85, 0.55 + 0.04 * n), coast: Math.min(0.5, 0.36 + 0.02 * n),
    band: Math.max(0.035, 0.06 - 0.004 * n), lo: 0.4, hi: 0.85, pyro: false, wander: 0.05, draught: true, note: "Every clay at once, a little hotter." };
}
const MODES = {
  firing: { name: "FIRING", text: "The plain run. Scores to the console." },
  daily: { name: "DAILY", text: "The same pots for everyone today, with a goal." },
  trial: { name: "TRIAL", text: "Twelve pots, no shelves to lose. Best total.", need: 3 },
  dark: { name: "BY LAMP", text: "No gauge on screen. Fire by the lamps alone.", need: 6 },
};
// The glaze shelf: earned by firings, shown as the colour of later pots.
const GLAZES = [
  { id: "celadon", name: "CELADON", css: "#9cc7a4", text: "A PERFECT pot." },
  { id: "tenmoku", name: "TENMOKU", css: "#8a5a3c", text: "A PERFECT pot of stoneware." },
  { id: "shino", name: "SHINO", css: "#e8d2b0", text: "A PERFECT pot of porcelain." },
  { id: "raku", name: "RAKU", css: "#c9a24f", text: "A PERFECT raku pot." },
  { id: "ash", name: "NATURAL ASH", css: "#a8a36a", text: "A PERFECT pot in a draught." },
  { id: "oxblood", name: "OXBLOOD", css: "#b5413a", text: "A clean PERFECT past the fifth clay." },
  { id: "crawl", name: "CRAWL", css: "#d9d9cf", text: "Land within a hair of the band's edge." },
  { id: "chun", name: "JUN", css: "#7f8fd6", text: "Five PERFECT pots in a row." },
];
const ROWS = ["FIRING", "DAILY", "TRIAL", "BY LAMP", "SHELF", "FEATS", "LOG"];
const ROW_MODE = { FIRING: "firing", DAILY: "daily", TRIAL: "trial", "BY LAMP": "dark" };

// ---- feats ------------------------------------------------------------------------------------
const life = (a, key) => (a.sv.st[key] || 0) + (a.R[key] || 0);
const FEATS = [
  { id: "first", name: "FIRST FIRING", text: "Fire a pot inside its band.", n: 1, prog: (a) => life(a, "pots") },
  { id: "perfect", name: "TRUE HEAT", text: "Fire a PERFECT pot.", n: 1, prog: (a) => life(a, "perfects") },
  { id: "clean5", name: "ONE BREATH", text: "Fire 5 clean pots (one press each) in a run.", n: 5, prog: (a) => a.R.clean },
  { id: "combo12", name: "WARM HANDS", text: "Fire 12 pots in a row.", n: 12, prog: (a) => a.bestCombo },
  { id: "combo30", name: "MASTER OF THE YARD", text: "Fire 30 pots in a row.", n: 30, prog: (a) => a.bestCombo },
  { id: "porcelain", name: "BLIND HEAT", text: "Reach PORCELAIN.", n: 2, prog: (a) => Math.max(a.sv.far, a.R.far) },
  { id: "ash", name: "INTO THE WIND", text: "Reach ASH GLAZE.", n: 4, prog: (a) => Math.max(a.sv.far, a.R.far) },
  { id: "kiln", name: "THE GREAT KILN", text: "Reach the first open KILN.", n: 5, prog: (a) => Math.max(a.sv.far, a.R.far) },
  { id: "trial", name: "TWELVE", text: "Score 3000 in a trial.", n: 3000, prog: (a) => Math.max(a.sv.best.trial, a.mode === "trial" ? a.score : 0) },
  { id: "dark", name: "BY LAMPLIGHT", text: "Fire 10 pots in a lamps-only firing.", n: 10, prog: (a) => (a.mode === "dark" ? a.R.pots : 0) },
  { id: "glazes", name: "COLLECTOR", text: "Earn 5 glazes.", n: 5, prog: (a) => a.sv.gl.length },
  { id: "daily", name: "ON THE DAY", text: "Meet a daily goal.", n: 1, prog: (a) => life(a, "daily") },
  { id: "pots", name: "POTTER", text: "Fire 300 pots in all.", n: 300, prog: (a) => life(a, "pots") },
  { id: "feather", name: "SOFT TOUCH", text: "", hint: "Some pots want several small touches.", n: 1, hidden: true, prog: (a) => a.R.feather },
  { id: "brink", name: "THE BRINK", text: "", hint: "The kiln forgives you three times, then once more.", n: 1, hidden: true, prog: (a) => a.R.brink },
];
const FEAT_IDS = FEATS.map((f) => f.id);
const GLAZE_IDS = GLAZES.map((x) => x.id);

// ---- helpers ----------------------------------------------------------------------------------
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const hashText = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const fmtDay = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const dayBefore = (key) => { const [y, m, d] = key.split("-").map(Number); return fmtDay(new Date(y, m - 1, d - 1)); };
const dailyRng = new Random(1);
const HEAT_STOPS = [LAMP.red, LAMP.amber, LAMP.white];
const heatRgb = (h) => ramp(h, HEAT_STOPS);
const degrees = (h) => Math.round(200 + h * 1100); // the gauge reads 200 to 1300 C
export function dailyGoal(key) {
  const h = hashText("kiln" + key), kind = h % 4, v = (h >>> 8) % 5;
  if (kind === 0) return { kind: "score", n: 1500 + 500 * v, text: "Score " + (1500 + 500 * v) + "." };
  if (kind === 1) return { kind: "combo", n: 8 + 3 * v, text: "Fire " + (8 + 3 * v) + " pots in a row." };
  if (kind === 2) return { kind: "clean", n: 4 + v, text: "Fire " + (4 + v) + " clean pots." };
  return { kind: "stage", n: 2 + (v % 3), text: "Reach " + STAGES[2 + (v % 3)].name + "." };
}
// Bring any stored shape (nothing, a stray object, schema 1) to schema 1.
export function migrateSave(raw) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const o = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const st = o(r.st), best = o(r.best), dl = o(r.dl);
  const pos = (v) => Math.max(0, Math.floor(num(v)));
  const ids = (v, known) => (Array.isArray(v) ? v.filter((id, i) => known.includes(id) && v.indexOf(id) === i) : []);
  return {
    schema: 1,
    runs: pos(r.runs),
    last: o(r.last),
    milestone: pos(r.milestone),
    far: Math.min(99, pos(r.far)),
    ft: ids(r.ft, FEAT_IDS),
    gl: ids(r.gl, GLAZE_IDS),
    st: { pots: pos(st.pots), perfects: pos(st.perfects), cracked: pos(st.cracked), daily: pos(st.daily) },
    best: { firing: pos(best.firing), trial: pos(best.trial), dark: pos(best.dark), combo: pos(best.combo) },
    dl: { d: typeof dl.d === "string" ? dl.d.slice(0, 10) : "", best: pos(dl.best), done: dl.done ? 1 : 0, streak: pos(dl.streak), last: typeof dl.last === "string" ? dl.last.slice(0, 10) : "" },
  };
}
// Where the heat settles if the press ends now: it keeps rising at the current rate, slowing as the
// rate decays with time constant `coast`. (Cooling while it settles is too small to matter here.)
export const landing = (heat, rate, coast) => heat + rate * coast;

// Screen geometry: the gauge on the right, the kiln on the left.
const GX = 640, GTOP = 118, GBOT = 470;
const gy = (h) => GBOT - clamp(h, 0, 1.05) * (GBOT - GTOP);

export class Kiln {
  constructor(ctx) {
    this.c = ctx;
    this.lamps = new LampBus(ctx);
    this.guard = new AppGuard(this, ctx); // takes back a menu gesture that reached the game (docs/ENGINE.md)
    this.sv = migrateSave(ctx.progress?.());
    this.t = 0;
    this.phase = "title";
    this.mode = "firing";
    this.armed = false;
    this.pt = 0;
    this.view = "menu";
    this.cur = 0;
    this.page = 0;
    this.sq = [];
    this.hudKey = "";
    this.hintText = "";
    this.held = false;
    this.reset();
    this.phase = "title";
    this.setHint("Hold to heat the kiln. Let go early: the heat coasts on. Hold for the yard.");
    this.c.hud([["BEST", this.c.best?.() ?? 0]]);
  }

  // ---- run state ------------------------------------------------------------------------------
  reset() {
    this.score = 0;
    this.shelves = SHELVES;
    this.combo = 0;
    this.bestCombo = 0;
    this.perfRun = 0;
    this.stage = 0;
    this.stagePots = 0;
    this.potN = 0; // pots begun this run
    this.fired = 0; // pots judged this run
    this.heat = 0;
    this.rate = 0;
    this.held = false;
    this.pot = null;
    this.fb = null;
    this.note = "";
    this.noteT = 0;
    this.deadT = 0;
    this.newRecord = false;
    this.best0 = 0;
    this.result = null;
    this.newFeats = [];
    this.newGlazes = [];
    this.goalDone = false;
    this.dseed = 0;
    this.glazeIx = 0;
    this.R = { pots: 0, perfects: 0, clean: 0, far: 0, feather: 0, brink: 0, daily: 0, cracks: 0 };
  }
  dayKey() { return fmtDay(new Date()); }
  rand() {
    if (this.mode !== "daily") return this.c.rng.next();
    dailyRng.state = this.dseed || 1;
    const v = dailyRng.next();
    this.dseed = dailyRng.state;
    return v;
  }
  range(a, b) { return a + (b - a) * this.rand(); }
  spec() { return stageSpec(this.stage); }
  mult() { return Math.min(6, 1 + Math.floor(this.combo / 4)); }
  bestRef() {
    if (this.mode === "daily") return this.sv.dl.d === this.dayKey() ? this.sv.dl.best : 0;
    if (this.mode === "firing") return Math.max(this.c.best?.() ?? 0, this.sv.best.firing);
    return this.sv.best[this.mode] || 0;
  }
  unlocked(mode) { return this.sv.ft.length >= (MODES[mode].need || 0); }
  potsLeft() { return this.mode === "trial" ? TRIAL_POTS - this.fired : Infinity; }

  // A new pot: its band, its draught, and a moment to show the band on the lamps.
  newPot() {
    const sp = this.spec();
    const centre = this.range(sp.lo, sp.hi);
    const draught = sp.draught ? this.range(0.7, 1.5) : 1;
    const wander = sp.wander ? { amp: sp.wander * this.range(0.6, 1), per: this.range(3, 4.5), ph: this.range(0, 6.28) } : null;
    this.pot = { centre, half: sp.band, draught, wander, age: 0, presses: 0, released: 0, rest: 0, judged: false, practice: this.potN < PRACTICE, glaze: this.sv.gl.length ? this.sv.gl[Math.floor(this.c.rng.next() * this.sv.gl.length)] : "" };
    this.potN++;
    this.heat = 0;
    this.rate = 0;
  }
  // The band's centre now (it drifts on raku and later clays).
  centre(age = this.pot?.age ?? 0) {
    const p = this.pot;
    if (!p) return 0.5;
    return p.wander ? clamp(p.centre + p.wander.amp * Math.sin(p.wander.ph + (6.283 * age) / p.wander.per), 0.15, 0.95) : p.centre;
  }
  coast() { return this.spec().coast * (this.pot?.draught ?? 1); }

  // ---- input ----------------------------------------------------------------------------------
  down() {
    this.guard.mark();
    if (this.phase === "title" || this.phase === "menu" || (this.phase === "over" && this.deadT > 0.7)) {
      this.armed = true;
      this.pt = this.t;
      return;
    }
    if (this.phase !== "play" || !this.pot || this.pot.judged) return;
    this.held = true;
    this.pot.presses++;
    this.pot.rest = 0;
  }
  up() {
    this.guard.release();
    if (this.armed) {
      this.armed = false;
      this.menuPress(this.t - this.pt);
      return;
    }
    if (this.held && this.pot) this.pot.released = this.pot.age;
    this.held = false;
  }
  cancel() {
    this.guard.rewind();
    this.armed = false;
    this.held = false;
    this.lamps.clear();
  }
  pause() { this.guard.settle(); this.armed = false; this.held = false; this.lamps.sleep(); }
  resume() { this.held = false; this.lamps.wake(); }
  dispose() { this.guard.settle(); this.held = false; this.lamps.sleep(); }

  menuPress(dur) {
    const long = dur >= HOLD_PICK;
    if (this.phase === "title" || this.phase === "over") {
      if (long) this.openMenu();
      else this.start(this.phase === "over" ? this.mode : "firing");
      return;
    }
    if (this.view !== "menu") {
      const pages = this.view === "feats" ? Math.ceil(FEATS.length / 6) : 1;
      if (long || pages === 1) { this.view = "menu"; this.page = 0; }
      else this.page = (this.page + 1) % pages;
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
    if (row === "SHELF") { this.view = "shelf"; return; }
    const mode = ROW_MODE[row];
    if (!this.unlocked(mode)) { this.c.tone(150, 0.08, "square"); return; }
    this.start(mode);
  }
  start(mode) {
    this.mode = mode;
    this.reset();
    this.phase = "play";
    if (mode === "daily") this.dseed = mixSeed(hashText("kiln-day" + this.dayKey())) || 1;
    this.best0 = this.bestRef();
    this.newPot();
    this.announce(mode === "firing" ? this.spec().note : MODES[mode].name + ": " + MODES[mode].text, 3.6);
    this.setHint(mode === "dark" ? "Fire by the lamps: the cyan spot is the band, the warm meter is the heat." : "Hold to heat. Let go before the band: the heat coasts on.");
    this.lamps.clear();
  }

  // ---- the firing -----------------------------------------------------------------------------
  step(dt) {
    const p = this.pot, sp = this.spec();
    if (!p) return;
    p.age += dt;
    if (p.judged) {
      p.wait -= dt;
      if (p.wait <= 0) {
        if (this.mode === "trial" && this.potsLeft() <= 0) { this.finish(); return; }
        this.newPot();
      }
      return;
    }
    if (this.held) {
      this.rate += sp.accel * dt;
      this.heat += this.rate * dt;
    } else if (this.rate > 0) {
      // Released: the rise slows with the kiln's inertia, and the kiln loses a little heat.
      const k = Math.exp(-dt / Math.max(0.05, this.coast()));
      this.heat += this.rate * this.coast() * (1 - k);
      this.rate *= k;
      if (this.rate < SETTLE) { this.heat = landing(this.heat, this.rate, this.coast()); this.rate = 0; }
    } else if (p.presses > 0) p.rest += dt;
    if (this.heat >= 1) { this.heat = 1; this.judge(true); return; }
    if (!this.held && this.rate === 0 && p.presses > 0 && p.rest >= REST) { this.judge(false); return; }
    if (p.presses === 0 && p.age > COLD + SHOW) this.judge(false);
  }
  // The pot is done: inside its band, or not.
  judge(burst) {
    const p = this.pot;
    p.judged = true;
    p.wait = 0.75;
    this.held = false; // the press that slumped a pot does not heat the next one
    this.fired++;
    const c = this.centre(), d = Math.abs(this.heat - c) / p.half;
    p.final = this.heat;
    p.finalCentre = c;
    if (burst || d > 1) {
      const word = burst ? "SLUMPED" : p.presses === 0 ? "COLD" : this.heat < c ? "SOFT" : "SLUMPED";
      this.crack(word, p.practice);
      return;
    }
    const grade = d <= GRADE[0] ? 0 : d <= GRADE[1] ? 1 : 2;
    const clean = p.presses === 1;
    this.combo++;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    const pts = Math.round(BASE[grade] * (clean ? 2 : 1) * this.mult() * (1 + 0.1 * Math.min(this.stage, 10)));
    this.score += pts;
    this.R.pots++;
    if (clean) this.R.clean++;
    if (p.presses >= 4) this.R.feather = 1;
    if (this.shelves === 1 && this.R.cracks >= 2) this.R.brink = 1;
    if (grade === 0) { this.R.perfects++; this.perfRun++; } else this.perfRun = 0;
    this.earnGlazes(grade, clean, d);
    this.fb = { word: NAMES[grade] + (clean ? " / CLEAN" : ""), pts, col: grade === 0 ? C.cyan : grade === 1 ? C.ink : C.amber, t: 1.1 };
    const notes = [523, 659, 784, 1047];
    this.c.tone(notes[Math.min(3, Math.floor(this.combo / 3) % 4)] * (grade === 2 ? 0.75 : 1), grade === 0 ? 0.16 : 0.1, grade === 0 ? "triangle" : "sine");
    if (clean && grade === 0) this.queue(0.1, 1319, 0.1, "sine");
    const col = grade === 0 ? LAMP.white : grade === 1 ? LAMP.green : LAMP.amber;
    this.lamps.flash(0.45, (e) => fill(col, 0.55 * (1 - e / 0.45) + 0.05));
    if (this.combo % REGEN === 0 && this.shelves < SHELVES && this.mode !== "trial") {
      this.shelves++;
      this.announce("A SHELF IS MENDED", 1.8);
    }
    this.stagePots++;
    if (this.stagePots >= this.spec().pots) this.advance();
    this.checkFeats();
  }
  crack(word, free) {
    this.combo = 0;
    this.perfRun = 0;
    this.fb = { word: free ? word + " / PRACTICE" : word, pts: 0, col: C.red, t: 1.1 };
    this.c.tone(word === "SLUMPED" ? 98 : 131, 0.25, "sawtooth");
    this.lamps.flash(0.5, (e) => lamps(dim(LAMP.red, 0.6 * (1 - e / 0.5)), null, dim(LAMP.red, 0.6 * (1 - e / 0.5))));
    if (free || this.mode === "trial") return;
    this.R.cracks++;
    this.shelves--;
    if (this.shelves <= 0) this.finish();
  }
  earnGlazes(grade, clean, d) {
    const st = this.stage, got = [];
    if (grade === 0) got.push("celadon");
    if (grade === 0 && st === 1) got.push("tenmoku");
    if (grade === 0 && st === 2) got.push("shino");
    if (grade === 0 && st === 3) got.push("raku");
    if (grade === 0 && this.spec().draught && this.pot.draught > 1.2) got.push("ash");
    if (grade === 0 && clean && st >= 5) got.push("oxblood");
    if (d > 0.95) got.push("crawl");
    if (this.perfRun >= 5) got.push("chun");
    for (const id of got) {
      if (this.sv.gl.includes(id)) continue;
      this.sv.gl.push(id);
      this.newGlazes.push(id);
      this.announce("GLAZE: " + GLAZES.find((x) => x.id === id).name, 2.6);
    }
  }
  advance() {
    this.stage++;
    this.stagePots = 0;
    this.R.far = Math.max(this.R.far, this.stage);
    const sp = this.spec();
    this.announce(sp.label + ": " + sp.note, 3.6);
    [523, 659, 784].forEach((hz, i) => this.queue(0.1 * i, hz, 0.12, "sine"));
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
    if (g.kind === "clean") return this.R.clean >= g.n;
    return this.R.far >= g.n;
  }
  finish() {
    if (this.phase !== "play") return;
    this.phase = "over";
    this.deadT = 0;
    this.held = false;
    const sv = this.sv, score = this.score;
    this.newRecord = score > 0 && score > this.best0;
    if (this.mode === "firing") this.c.score(score);
    this.c.tone(this.mode === "trial" ? 523 : 82, 0.4, this.mode === "trial" ? "sine" : "sawtooth");
    sv.runs++;
    sv.st.pots += this.R.pots;
    sv.st.perfects += this.R.perfects;
    sv.st.cracked += this.R.cracks;
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
    const potsRun = this.R.pots;
    this.checkFeats(); // before the run's counts move into the lifetime totals below
    this.R.pots = 0; this.R.perfects = 0;
    this.result = { score, combo: this.bestCombo, pots: potsRun, stage: this.spec().label, mode: MODES[this.mode].name, milestone: Math.floor(score / 500) };
    sv.milestone = Math.max(sv.milestone, this.result.milestone);
    sv.last = { ...this.result };
    this.persist();
    this.result.next = this.nextGoal();
    this.setHint("Tap to fire again. Hold for the yard.");
    this.c.hud([["SCORE", score], ["POTS", potsRun], ["REACHED", this.spec().label], ["BEST", this.bestRef()]]);
    this.hudKey = "";
  }
  persist() { this.c.saveProgress?.(JSON.parse(JSON.stringify(this.sv)))?.catch?.(this.c.error); }
  nextGoal() {
    const n = this.sv.ft.length, lines = [];
    const locked = Object.values(MODES).filter((m) => m.need && n < m.need).sort((a, b) => a.need - b.need);
    if (locked.length) lines.push("NEXT: " + locked[0].name + " AT " + locked[0].need + " FEATS (" + n + ")");
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
    else if (this.phase === "over") this.deadT += dt;
    this.lamps.frame(dt, this.lampValues());
    this.pushHud();
  }
  pushHud() {
    if (this.phase !== "play") return;
    const items = [["SCORE", this.score], ["RUN", this.combo + "  x" + this.mult()],
      this.mode === "trial" ? ["POTS LEFT", Math.max(0, this.potsLeft())] : ["SHELVES", this.shelves + " / " + SHELVES], ["CLAY", this.spec().label]];
    const key = items.join("|");
    if (key !== this.hudKey) { this.hudKey = key; this.c.hud(items); }
  }

  // ---- lamps ----------------------------------------------------------------------------------
  // The heat is a meter across the lamps, warming from red to white. A new pot first shows its band
  // as a cyan spot at the same place on that meter. A draught makes the meter flicker.
  lampValues() {
    if (this.phase === "title" || this.phase === "menu") return meter(0.34 + 0.1 * pulse(this.t, 0.25), dim(LAMP.red, 0.12));
    if (this.phase === "over") {
      if (this.deadT < 1.2) return fill(LAMP.red, 0.25 * (1 - this.deadT / 1.2));
      if (this.newRecord) return lamps(null, dim(LAMP.amber, 0.08 + 0.12 * pulse(this.t, 0.5)), null);
      return meter(0.2, dim(LAMP.red, 0.06));
    }
    const p = this.pot;
    if (!p) return null;
    const flicker = p.draught > 1 ? 1 - (p.draught - 1) * 0.5 * pulse(this.t, 7) : 1;
    const heat = meter(this.heat, dim(heatRgb(this.heat), 0.42 * flicker));
    if (p.judged) return heat;
    // The band, shown before the pot heats and again whenever the kiln is resting.
    const showBand = p.age < SHOW + 0.3 || (!this.held && this.rate === 0);
    if (!showBand) return heat;
    return lampMax(heat, spot(this.centre(), dim(LAMP.cyan, p.age < SHOW ? 0.4 : 0.14)));
  }

  // ---- drawing --------------------------------------------------------------------------------
  draw(g) {
    space(g, this.t * 3, 0.2);
    if (this.phase === "title") { this.drawKiln(g, 0.35 + 0.1 * pulse(this.t, 0.25)); banner(g, "KILN", "Hold to heat. Let go early: the heat coasts on. Land it in the band."); }
    else if (this.phase === "play") this.drawPlay(g);
    else if (this.phase === "over") this.drawOver(g);
    else this.drawMenu(g);
  }
  // The kiln: an arch with a pot inside that glows with the heat.
  drawKiln(g, heat) {
    const x = 330, y = 300;
    g.strokeStyle = C.line; g.lineWidth = 3;
    g.beginPath(); g.moveTo(x - 170, 470); g.lineTo(x - 170, y - 40); g.arc(x, y - 40, 170, Math.PI, 0); g.lineTo(x + 170, 470); g.stroke();
    line(g, x - 200, 470, x + 200, 470, C.line, 3);
    const rgb = heatRgb(heat), glow = "rgb(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ")";
    // The chamber glows with the heat; a draught makes it flicker.
    const flick = this.pot && this.pot.draught > 1 && this.phase === "play" ? 1 - (this.pot.draught - 1) * 0.6 * pulse(this.t, 7) : 1;
    g.globalAlpha = clamp(heat * 0.4, 0.04, 0.4) * flick;
    g.fillStyle = glow; g.beginPath(); g.moveTo(x - 166, 468); g.lineTo(x - 166, y - 40); g.arc(x, y - 40, 166, Math.PI, 0); g.lineTo(x + 166, 468); g.closePath(); g.fill();
    g.globalAlpha = 1;
    // The pot: a simple vase outline, filled with the glaze it will wear.
    const glaze = this.pot?.glaze ? GLAZES.find((z) => z.id === this.pot.glaze)?.css : null;
    g.beginPath();
    g.moveTo(x - 30, 270); g.lineTo(x + 30, 270);
    g.quadraticCurveTo(x + 22, 300, x + 60, 360); g.quadraticCurveTo(x + 70, 420, x + 40, 450);
    g.lineTo(x - 40, 450); g.quadraticCurveTo(x - 70, 420, x - 60, 360); g.quadraticCurveTo(x - 22, 300, x - 30, 270);
    g.closePath();
    g.fillStyle = glaze || "#2a3b2e"; g.globalAlpha = glaze ? 0.55 : 1; g.fill(); g.globalAlpha = 1;
    g.lineWidth = 3; g.strokeStyle = heat > 0.08 ? glow : C.muted; g.stroke();
  }
  drawGauge(g) {
    const p = this.pot, sp = this.spec();
    line(g, GX, GTOP, GX, GBOT, C.line, 2);
    for (let i = 0; i <= 10; i++) { const y = gy(i / 10); line(g, GX - (i % 5 ? 8 : 16), y, GX, y, C.line, 2); }
    text(g, "1300", GX - 22, GTOP, 16, C.muted, "right");
    text(g, "200", GX - 22, GBOT, 16, C.muted, "right");
    if (p) {
      const c = p.judged ? p.finalCentre : this.centre();
      g.globalAlpha = 0.28; g.fillStyle = C.cyan; g.fillRect(GX + 6, gy(c + p.half), 130, gy(c - p.half) - gy(c + p.half)); g.globalAlpha = 1;
      line(g, GX + 6, gy(c + p.half), GX + 136, gy(c + p.half), C.cyan, 2);
      line(g, GX + 6, gy(c - p.half), GX + 136, gy(c - p.half), C.cyan, 2);
      line(g, GX + 6, gy(c), GX + 136, gy(c), C.cyan, 1);
      // The column of heat.
      const rgb = heatRgb(this.heat);
      g.fillStyle = "rgb(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ")";
      g.globalAlpha = 0.85; g.fillRect(GX + 46, gy(this.heat), 38, GBOT - gy(this.heat)); g.globalAlpha = 1;
      line(g, GX + 30, gy(this.heat), GX + 100, gy(this.heat), C.amber, 3);
      // The pyrometer: where the heat would settle if the press ended now.
      if (sp.pyro && !p.judged && (this.held || this.rate > 0)) {
        const land = landing(this.heat, this.rate, this.coast());
        g.setLineDash?.([6, 6]); line(g, GX - 4, gy(land), GX + 150, gy(land), C.ink, 2); g.setLineDash?.([]);
        text(g, "LANDS", GX + 158, gy(land), 18, C.ink);
      }
      text(g, degrees(this.heat) + " C", GX + 158, GBOT - 6, 28, C.amber);
    }
  }
  drawPlay(g) {
    const p = this.pot;
    const dark = this.mode === "dark";
    this.drawKiln(g, dark ? 0.1 : this.heat);
    if (!dark) this.drawGauge(g);
    else {
      text(g, "BY LAMP", 330, 140, 30, C.muted, "center");
      text(g, "CYAN = THE BAND   WARM = THE HEAT", 330, 176, 18, C.muted, "center");
    }
    if (this.mode === "trial") text(g, Math.max(0, this.potsLeft()) + " POTS LEFT", 920, 44, 24, C.amber, "right");
    else for (let i = 0; i < SHELVES; i++) diamond(g, 856 + i * 34, 44, 12, i < this.shelves ? C.cyan : C.line, i < this.shelves);
    text(g, "x" + this.mult(), 40, 48, 34, this.mult() > 1 ? C.amber : C.muted);
    if (p?.practice) text(g, "PRACTICE POTS", 40, 88, 18, C.cyan);
    if (p && p.draught > 1.05 && !p.judged) text(g, "DRAUGHT " + "+".repeat(Math.min(5, Math.round((p.draught - 1) * 10))), 40, 120, 20, C.amber);
    if (this.noteT > 0) text(g, this.note, 480, 70, 22, C.amber, "center");
    if (this.fb) {
      g.globalAlpha = clamp(this.fb.t / 0.3, 0, 1);
      text(g, this.fb.word, 330, 200, 30, this.fb.col, "center");
      if (this.fb.pts) text(g, "+" + this.fb.pts, 330, 238, 22, C.muted, "center");
      g.globalAlpha = 1;
    } else if (p && !p.judged && p.presses === 0 && p.age > 1.5) text(g, "HOLD TO HEAT", 330, 200, 24, C.muted, "center");
  }
  drawOver(g) {
    const r = this.result || {};
    g.fillStyle = "#0c1511f0";
    g.fillRect(150, 52, 660, 450);
    line(g, 200, 62, 760, 62, C.line);
    text(g, r.mode === "FIRING" ? "KILN" : "KILN / " + r.mode, 480, 96, 32, C.amber, "center");
    let y = 150;
    const row = (label, value) => { text(g, label, 230, y, 18, C.muted); text(g, value, 730, y, 26, C.ink, "right"); y += 38; };
    row("SCORE", String(r.score ?? 0));
    row("POTS FIRED", String(r.pots ?? 0));
    row("LONGEST RUN", String(r.combo ?? 0));
    row("REACHED", r.stage || "");
    text(g, this.newRecord ? "NEW BEST" : "BEST " + this.bestRef(), 480, y + 2, 20, this.newRecord ? C.cyan : C.amber, "center");
    y += 34;
    if (this.mode === "daily") { text(g, this.goalDone ? "DAILY GOAL MET" : "DAILY: " + dailyGoal(this.dayKey()).text, 480, y, 18, this.goalDone ? C.cyan : C.muted, "center"); y += 26; }
    for (const id of this.newGlazes.slice(0, 1)) { text(g, "GLAZE  " + GLAZES.find((z) => z.id === id).name, 480, y, 20, C.cyan, "center"); y += 26; }
    for (const id of this.newFeats.slice(0, 2)) { const f = FEATS.find((x) => x.id === id); if (f) { text(g, "FEAT  " + f.name, 480, y, 20, C.cyan, "center"); y += 26; } }
    for (const l of (r.next || []).slice(0, 2)) { if (y > 440) break; text(g, l, 480, y, 18, C.muted, "center"); y += 24; }
    if (this.deadT > 0.7) text(g, "TAP = AGAIN     HOLD = THE YARD", 480, 476, 20, C.amber, "center");
  }
  drawMenu(g) {
    g.fillStyle = "#0c1511f2";
    g.fillRect(110, 36, 740, 470);
    line(g, 160, 46, 800, 46, C.line);
    text(g, "THE YARD", 480, 82, 34, C.amber, "center");
    const sv = this.sv, n = sv.ft.length;
    if (this.view === "menu") {
      const lock = (m) => (this.unlocked(m) ? null : "AT " + MODES[m].need + " FEATS");
      const rows = {
        FIRING: ["FIRING", "BEST " + Math.max(this.c.best?.() ?? 0, sv.best.firing)],
        DAILY: ["DAILY", sv.dl.d === this.dayKey() && sv.dl.done ? "DONE TODAY" : "SEEDED BY DATE"],
        TRIAL: ["TRIAL", lock("trial") || "BEST " + sv.best.trial],
        "BY LAMP": ["BY LAMP", lock("dark") || "BEST " + sv.best.dark],
        SHELF: ["GLAZE SHELF", sv.gl.length + " / " + GLAZES.length],
        FEATS: ["FEATS", n + " / " + FEATS.length],
        LOG: ["LOG", "RUNS " + sv.runs],
      };
      ROWS.forEach((id, i) => {
        const y = 140 + i * 42, on = i === this.cur, m = ROW_MODE[id];
        const locked = m && !this.unlocked(m);
        if (on) diamond(g, 150, y, 9, C.amber, true);
        text(g, rows[id][0], 180, y, 24, on ? C.amber : locked ? C.line : C.ink);
        text(g, rows[id][1], 810, y, 22, on ? C.amber : C.muted, "right");
      });
      const id = ROWS[this.cur], m = ROW_MODE[id];
      let info;
      if (m === "daily") info = "Goal: " + dailyGoal(this.dayKey()).text + (sv.dl.streak > 1 ? "  STREAK " + sv.dl.streak : "");
      else if (m) info = MODES[m].text;
      else if (id === "SHELF") info = "Glazes earned by firing. Later pots wear them.";
      else if (id === "FEATS") info = "Named goals. Some are not listed.";
      else info = "What you have fired so far.";
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
    } else if (this.view === "shelf") {
      text(g, "GLAZE SHELF  " + sv.gl.length + " / " + GLAZES.length, 480, 118, 20, C.cyan, "center");
      GLAZES.forEach((z, i) => {
        const y = 156 + i * 38, got = sv.gl.includes(z.id);
        if (got) circle(g, 162, y, 11, z.css, true); else circle(g, 162, y, 11, C.line);
        text(g, got ? z.name : "????", 190, y, 22, got ? C.ink : C.line);
        text(g, z.text, 810, y, 16, C.muted, "right");
      });
      text(g, "TAP = BACK", 480, 480, 18, C.cyan, "center");
    } else {
      const lines = [["RUNS", sv.runs], ["POTS FIRED", sv.st.pots], ["PERFECT", sv.st.perfects], ["CRACKED", sv.st.cracked],
        ["LONGEST RUN", sv.best.combo], ["FURTHEST", stageSpec(sv.far).label], ["DAILY GOALS", sv.st.daily + (sv.dl.streak > 1 ? "  STREAK " + sv.dl.streak : "")]];
      lines.forEach(([k, v], i) => { const y = 130 + i * 44; text(g, k, 150, y, 22, C.ink); text(g, String(v), 810, y, 22, C.amber, "right"); });
      text(g, "TAP = BACK", 480, 480, 18, C.cyan, "center");
    }
  }
}
