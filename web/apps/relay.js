// RELAY — a one-button rhythm game played on the three lamps. The lamps play a bar of a real rhythm
// (the CALL) and go dark; the player taps it back in time (the ANSWER), and the next call follows on
// the beat with no pause, so a run is one continuous groove. A rhythm's low note (the bar's first
// step) lights the left lamp, notes on the beat the middle lamp and notes between beats the right
// lamp, so a call can be read on the lamps as well as heard. The run climbs through seven stages of
// real rhythms, from the plain pulse through syncopation, the clave, the waltz, swing and odd time,
// then cycles through all of them, faster, the windows narrowing to six tenths. From the waltz on, some answers are followed by a second
// one with no call ("AGAIN"): carry the rhythm on from memory. A new rhythm's notation stays on screen
// during the answer; once it has been answered cleanly it must be played by heart. Every rhythm met
// goes into the SONGBOOK, learned at one clean answer and mastered at five. Three shields: an answer
// with more slips than a quarter of its notes costs one, and the same rhythm is called again. Holding
// on the title or result screen opens the songbook: daily run, studio (practice with no shields),
// accelerando (unlocked by feats), sound kits, the rhythm book, feats and a log. Save schema 1.
import { C, space, text, line, circle, diamond, banner } from "../engine/draw.js";
import { clamp, lerp, mixSeed, Random } from "../engine/math.js";
import { LAMP, lamps, dim } from "../engine/lightshow.js";
import { AppGuard } from "../engine/input.js";
import { LampBus } from "./game-kit.js";

const HOLD_PICK = 0.5; // a press this long on a menu screen chooses instead of tapping
// The console-wide latency calibration (settings.latencyMs, positive when taps register late) is
// taken off every tap, so the judging matches what the player heard; clamped, 0 when absent.
export const latency = (ctx) => { const v = Number(ctx.settings?.()?.latencyMs); return Number.isFinite(v) ? clamp(v, -150, 300) / 1000 : 0; };
// Timing windows in seconds either side of a note: PERFECT, GOOD, CLOSE. The tones carry the exact
// time; the lamps update about 17 times a second, so they show the rhythm rather than the instant.
export const WIN = [0.05, 0.095, 0.14];
const GRADES = ["PERFECT", "GOOD", "CLOSE"];
const BASE = [100, 60, 25];
const SHIELDS = 3;
const REGEN = 4; // clean answers in a row restore a shield
const STUDIO_ROUNDS = 10;
const MULT_MAX = 4, MULT_STEP = 12; // the multiplier: one step per twelve notes in a row, up to x4

// ---- the rhythms --------------------------------------------------------------------------------
// `spb`: grid steps per beat (4: sixteenths, 3: triplets, 2: eighths), `steps`: the length of the
// pattern, `bar`: steps in one bar, `on`: the steps that sound, `beats`: where the pulse falls when it
// is not every `spb` steps (odd time). A two-bar pattern (the claves, the hemiola) is called whole.
const R = (id, stage, name, note, meter, spb, steps, bar, on, beats) => ({ id, stage, name, note, meter, spb, steps, bar, on, beats });
export const RHYTHMS = [
  R("four", 0, "FOUR ON THE FLOOR", "Every beat, even. The pulse of disco and house.", "4/4", 4, 16, 16, [0, 4, 8, 12]),
  R("half", 0, "HALF TIME", "Beats one and three. Broad and slow.", "4/4", 4, 16, 16, [0, 8]),
  R("back", 0, "BACKBEAT", "Beats two and four: the snare of rock and soul.", "4/4", 4, 16, 16, [4, 12]),
  R("heart", 0, "HEARTBEAT", "Two quick pairs. Lub-dub, lub-dub.", "4/4", 4, 16, 16, [0, 2, 8, 10]),
  R("eights", 1, "STRAIGHT EIGHTS", "Two to a beat, even. Count 1 and 2 and.", "4/4", 4, 16, 16, [0, 2, 4, 6, 8, 10, 12, 14]),
  R("offbeat", 1, "OFFBEATS", "Only the ands. The skank of ska and reggae.", "4/4", 4, 16, 16, [2, 6, 10, 14]),
  R("rock", 1, "ROCK BEAT", "Kick and snare of the plainest rock groove.", "4/4", 4, 16, 16, [0, 4, 8, 10, 12]),
  R("chacha", 1, "CHA-CHA-CHA", "Two, three, cha-cha. Havana, the 1950s.", "4/4", 4, 16, 16, [4, 8, 12, 14]),
  R("tresillo", 2, "TRESILLO", "3 + 3 + 2. The root of Latin, funk and pop.", "4/4", 4, 16, 16, [0, 6, 12]),
  R("habanera", 2, "HABANERA", "Tresillo with beat three filled in. Cuba, 1800s.", "4/4", 4, 16, 16, [0, 6, 8, 12]),
  R("charleston", 2, "CHARLESTON", "One, then the and of two. The 1920s dance.", "4/4", 4, 16, 16, [0, 6]),
  R("cinquillo", 2, "CINQUILLO", "Five notes, long-short-long. Cuban danzon.", "4/4", 4, 16, 16, [0, 4, 6, 10, 12]),
  R("son32", 3, "SON CLAVE 3-2", "The key of salsa: three notes, then two.", "4/4", 4, 32, 16, [0, 6, 12, 20, 24]),
  R("son23", 3, "SON CLAVE 2-3", "The same clave, starting on its two side.", "4/4", 4, 32, 16, [4, 8, 16, 22, 28]),
  R("rumba", 3, "RUMBA CLAVE", "Son clave with its third note pushed late.", "4/4", 4, 32, 16, [0, 6, 14, 20, 24]),
  R("bossa", 3, "BOSSA NOVA", "Rio, 1958: the clave with its last note pushed.", "4/4", 4, 32, 16, [0, 6, 12, 20, 26]),
  R("waltz", 4, "WALTZ", "One, two, three. Vienna, 1800s.", "3/4", 4, 12, 12, [0, 4, 8]),
  R("mazurka", 4, "MAZURKA", "Poland: a dotted lilt on the first beat.", "3/4", 4, 12, 12, [0, 3, 4, 8]),
  R("hemiola", 4, "HEMIOLA", "Three long notes across two bars of three.", "3/4", 4, 24, 12, [0, 8, 16]),
  R("shuffle", 5, "SHUFFLE", "Long-short pairs. Blues and boogie-woogie.", "4/4 SWING", 3, 12, 12, [0, 2, 3, 5, 6, 8, 9, 11]),
  R("ride", 5, "SWING RIDE", "Ding, ding-a ding: the jazz ride cymbal.", "4/4 SWING", 3, 12, 12, [0, 3, 5, 6, 9, 11]),
  R("triplets", 5, "TRIPLETS", "Three to a beat, on beats one and three.", "4/4 SWING", 3, 12, 12, [0, 1, 2, 6, 7, 8]),
  R("five", 6, "FIVE (3+2)", "Five eighths a bar, grouped 3 + 2.", "5/8", 2, 10, 5, [0, 3, 5, 8], [0, 3, 5, 8]),
  R("seven", 6, "SEVEN (2+2+3)", "Seven eighths, 2 + 2 + 3. Balkan dance time.", "7/8", 2, 14, 7, [0, 2, 4, 7, 9, 11], [0, 2, 4, 7, 9, 11]),
  R("sevenb", 6, "SEVEN (3+2+2)", "Seven eighths, 3 + 2 + 2: a lopsided waltz.", "7/8", 2, 14, 7, [0, 3, 5, 7, 10, 12], [0, 3, 5, 7, 10, 12]),
];
const RHYTHM_IDS = RHYTHMS.map((r) => r.id);
export const byId = (id) => RHYTHMS.find((r) => r.id === id);
// Where the pulse falls in a rhythm.
const beatsOf = (r) => r.beats || Array.from({ length: r.steps / r.spb }, (_, i) => i * r.spb);
// Which lamp a note lights: the first step of a bar the left (low), a note on the beat the middle,
// a note between beats the right (high).
export function voice(r, step) {
  if (step % r.bar === 0) return 0;
  return beatsOf(r).includes(step) ? 1 : 2;
}
export const LEARNED = 1, MASTERED = 5; // clean answers

// ---- stages ---------------------------------------------------------------------------------------
// Answers to pass to clear the stage, the tempo across it, the chance of a second answer with no call
// (`carry`), and the metronome during the answer: every beat, the start of each bar, or only the first.
const STAGES = [
  { name: "PULSE", bars: 5, b0: 84, b1: 92, carry: 0, click: "beat", note: "Listen to the lamps, then tap the rhythm back." },
  { name: "EIGHTHS", bars: 5, b0: 88, b1: 96, carry: 0, click: "beat", note: "Two notes to a beat. Count 1 and 2 and." },
  { name: "SYNCOPATION", bars: 6, b0: 90, b1: 98, carry: 0, click: "beat", note: "Notes between the beats. Feel the push." },
  { name: "CLAVE", bars: 5, b0: 92, b1: 100, carry: 0, click: "bar", note: "Two bars at once. The click marks each bar only." },
  { name: "WALTZ", bars: 6, b0: 100, b1: 112, carry: 0.3, click: "bar", note: "Three beats a bar. AGAIN: carry it on from memory." },
  { name: "SWING", bars: 6, b0: 96, b1: 108, carry: 0.3, click: "bar", note: "Each beat split in three. Lean on the long note." },
  { name: "ODD TIME", bars: 5, b0: 100, b1: 112, carry: 0.3, click: "bar", note: "Fives and sevens. The click marks the bar." },
];
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];
export function stageSpec(i) {
  if (i < STAGES.length) return { ...STAGES[i], label: ROMAN[i] + "  " + STAGES[i].name, cycle: 0, win: 1 };
  const n = i - STAGES.length + 1;
  return { name: "CYCLE " + n, label: "CYCLE " + n, bars: 8, b0: Math.min(150, 100 + 6 * n), b1: Math.min(160, 110 + 6 * n), carry: 0.45, click: "first", note: "Every rhythm you know, faster and tighter.", cycle: n, win: Math.max(0.6, 1 - 0.05 * n) };
}
export const MODES = {
  relay: { name: "RELAY", text: "The run. Scores to the console." },
  daily: { name: "DAILY", text: "The same rhythms for everyone today, with a goal." },
  studio: { name: "STUDIO", text: "Practise the rhythms you have not mastered. No shields." },
  accel: { name: "ACCELERANDO", text: "Every rhythm you have met, three BPM faster each time.", need: 4 },
};
// Sound kits: the voice of each lamp's note (low, mid, high) and the wave.
const KITS = [
  { name: "WOOD", hz: [262, 392, 523], wave: "triangle", need: 0 },
  { name: "BELL", hz: [523, 784, 1047], wave: "sine", need: 3 },
  { name: "CHIP", hz: [196, 294, 392], wave: "square", need: 7 },
];
const ROWS = ["RELAY", "DAILY", "STUDIO", "ACCEL", "KIT", "BOOK", "FEATS", "LOG"];

// ---- feats ----------------------------------------------------------------------------------------
const life = (a, key) => (a.sv.st[key] || 0) + (a.R[key] || 0);
const learnedCount = (sv, n = LEARNED) => RHYTHM_IDS.filter((id) => (sv.book[id] || 0) >= n).length;
const FEATS = [
  { id: "first", name: "FIRST ANSWER", text: "Answer a rhythm cleanly.", n: 1, prog: (a) => life(a, "clean") },
  { id: "pocket", name: "IN THE POCKET", text: "10 clean answers in one run.", n: 10, prog: (a) => a.R.clean },
  { id: "combo40", name: "LOCKED IN", text: "Reach a combo of 40.", n: 40, prog: (a) => a.bestCombo },
  { id: "mult8", name: "FULL BAND", text: "Reach the x4 multiplier.", n: MULT_MAX, prog: (a) => a.R.maxMult },
  { id: "sync", name: "OFF THE BEAT", text: "Reach SYNCOPATION.", n: 2, prog: (a) => Math.max(a.sv.far, a.R.far) },
  { id: "clave", name: "THE KEY", text: "Reach CLAVE.", n: 3, prog: (a) => Math.max(a.sv.far, a.R.far) },
  { id: "swing", name: "IT DON'T MEAN A THING", text: "Reach SWING.", n: 5, prog: (a) => Math.max(a.sv.far, a.R.far) },
  { id: "cycle", name: "ENCORE", text: "Reach the first CYCLE.", n: 7, prog: (a) => Math.max(a.sv.far, a.R.far) },
  { id: "carry", name: "CARRY ON", text: "Answer 5 AGAINs cleanly in one run.", n: 5, prog: (a) => a.R.carry },
  { id: "learn10", name: "REPERTOIRE", text: "Learn 10 rhythms.", n: 10, prog: (a) => learnedCount(a.sv) },
  { id: "master5", name: "VIRTUOSO", text: "Master 5 rhythms.", n: 5, prog: (a) => learnedCount(a.sv, MASTERED) },
  { id: "accel", name: "PRESTO", text: "Reach 140 BPM in accelerando.", n: 140, prog: (a) => (a.mode === "accel" ? a.bpm : 0) },
  { id: "daily", name: "ON THE DAY", text: "Meet a daily goal.", n: 1, prog: (a) => life(a, "daily") },
  { id: "metro", name: "METRONOME", text: "", hint: "Twenty in a row, every one exact.", n: 20, hidden: true, prog: (a) => a.R.pRunMax },
  { id: "last", name: "LAST BREATH", text: "", hint: "Some keep time best with nothing to spare.", n: 6, hidden: true, prog: (a) => a.R.lastClean },
];
const FEAT_IDS = FEATS.map((f) => f.id);

// ---- helpers --------------------------------------------------------------------------------------
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const hashText = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const fmtDay = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const dayBefore = (key) => { const [y, m, d] = key.split("-").map(Number); return fmtDay(new Date(y, m - 1, d - 1)); };
const dailyRng = new Random(1);
// Today's goal, the same for everyone on the same date.
export function dailyGoal(key) {
  const h = hashText("relay" + key), kind = h % 4, v = (h >>> 8) % 5;
  if (kind === 0) return { kind: "score", n: 8000 + 3000 * v, text: "Score " + (8000 + 3000 * v) + "." };
  if (kind === 1) return { kind: "combo", n: 20 + 5 * v, text: "Reach a combo of " + (20 + 5 * v) + "." };
  if (kind === 2) return { kind: "clean", n: 5 + v, text: "Answer " + (5 + v) + " rhythms cleanly." };
  return { kind: "stage", n: 2 + (v % 3), text: "Reach " + STAGES[2 + (v % 3)].name + "." };
}
// Bring any stored shape (nothing, a stray object, schema 1) to schema 1.
export function migrateSave(raw) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const o = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const st = o(r.st), best = o(r.best), sel = o(r.sel), dl = o(r.dl), book = o(r.book);
  const pos = (v) => Math.max(0, Math.floor(num(v)));
  const bk = {};
  for (const id of RHYTHM_IDS) if (id in book) bk[id] = Math.min(999, pos(book[id]));
  return {
    schema: 1,
    runs: pos(r.runs),
    last: o(r.last),
    milestone: pos(r.milestone),
    far: Math.min(99, pos(r.far)),
    ft: Array.isArray(r.ft) ? r.ft.filter((id, i) => FEAT_IDS.includes(id) && r.ft.indexOf(id) === i) : [],
    st: { notes: pos(st.notes), perfects: pos(st.perfects), clean: pos(st.clean), answers: pos(st.answers), daily: pos(st.daily) },
    best: { relay: pos(best.relay), accel: pos(best.accel), combo: pos(best.combo), bpm: pos(best.bpm) },
    sel: { kit: clamp(pos(sel.kit), 0, KITS.length - 1) },
    book: bk,
    dl: { d: typeof dl.d === "string" ? dl.d.slice(0, 10) : "", best: pos(dl.best), done: dl.done ? 1 : 0, streak: pos(dl.streak), last: typeof dl.last === "string" ? dl.last.slice(0, 10) : "" },
  };
}
// The notation strip on screen.
const SX0 = 150, SX1 = 810, SY = 330;

export class Relay {
  constructor(ctx) {
    this.c = ctx;
    this.lamps = new LampBus(ctx);
    this.guard = new AppGuard(this, ctx); // takes back a menu gesture that reached the game (docs/ENGINE.md)
    this.sv = migrateSave(ctx.progress?.());
    this.t = 0;
    this.mode = "relay";
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
    this.setHint("The lamps play a rhythm, then go dark: tap it back. Hold for the songbook.");
    this.c.hud([["BEST", this.c.best?.() ?? 0]]);
  }

  // ---- run state --------------------------------------------------------------------------------
  reset() {
    this.rt = 0;
    this.score = 0;
    this.shields = SHIELDS;
    this.combo = 0;
    this.bestCombo = 0;
    this.cleanRow = 0; // clean answers in a row
    this.stage = 0;
    this.stagePass = 0;
    this.stageClean = true;
    this.rounds = 0;
    this.bpm = 84;
    this.segs = []; // the timeline: count-in, calls and answers, each { kind, r, t0, dur, sd, notes, ... }
    this.nextT = 0.6; // when the next round starts
    this.repeat = null; // a rhythm to call again after a lost answer
    this.countIn = false; // the next round starts with a count-in (after a pause)
    this.lastId = "";
    this.introduced = []; // rhythms of this run's stage already called once
    this.glow = [0, 0, 0]; // lamp flashes, decaying
    this.glowCol = [LAMP.amber, LAMP.amber, LAMP.amber];
    this.beatGlow = 0;
    this.lastBeat = "";
    this.offs = []; // the last taps' timing errors in ms (negative is early)
    this.fb = null; // the last judgement: { word, pts, col, t, ms }
    this.note = "";
    this.noteT = 0;
    this.deadT = 0;
    this.newRecord = false;
    this.best0 = 0;
    this.result = null;
    this.newFeats = [];
    this.newLearned = [];
    this.goalDone = false;
    this.timing = null;
    this.dseed = 0;
    this.R = { notes: 0, perfects: 0, clean: 0, answers: 0, maxMult: 0, far: 0, pRun: 0, pRunMax: 0, carry: 0, lastClean: 0, daily: 0, offSum: 0, offN: 0 };
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
  spec() {
    if (this.mode === "accel") return { name: "ACCELERANDO", label: this.bpm + " BPM", bars: 999, b0: 88, b1: 88, carry: 0.25, click: "bar", note: "", cycle: 0, win: 1 };
    if (this.mode === "studio") return { name: "STUDIO", label: "STUDIO " + Math.min(this.rounds, STUDIO_ROUNDS) + " / " + STUDIO_ROUNDS, bars: 999, b0: 80, b1: 80, carry: 0, click: "beat", note: "", cycle: 0, win: 1 };
    return stageSpec(this.stage);
  }
  mult() { return Math.min(MULT_MAX, 1 + Math.floor(this.combo / MULT_STEP)); }
  kit() { const k = KITS[this.sv.sel.kit] || KITS[0]; return this.sv.ft.length >= k.need ? k : KITS[0]; }
  bestRef() {
    if (this.mode === "daily") return this.sv.dl.d === this.dayKey() ? this.sv.dl.best : 0;
    if (this.mode === "relay") return Math.max(this.c.best?.() ?? 0, this.sv.best.relay);
    return this.sv.best[this.mode] || 0;
  }
  bestRefFor(mode) { return mode === "relay" ? Math.max(this.c.best?.() ?? 0, this.sv.best.relay) : this.sv.best[mode] || 0; }
  unlocked(mode) { return this.sv.ft.length >= (MODES[mode].need || 0); }
  known(id) { return (this.sv.book[id] || 0) >= LEARNED; }
  heard(id) { return id in this.sv.book; }

  // ---- the timeline -------------------------------------------------------------------------------
  // Choose the next rhythm. A lost answer is called again once. A stage calls its own rhythms in order
  // the first time, then mixes in earlier ones; cycles and accelerando draw on everything met so far.
  pick() {
    // An answer still being judged (its last notes wait out the console's latency) that has already
    // lost is called again now; one that might still pass is let go.
    const open = this.segs.find((s) => s.kind === "answer" && !s.judged && !s.carry);
    if (!this.repeat && open && this.slips(open) > this.allow(open)) { this.repeat = open.r; open.repeated = true; }
    if (this.repeat) { const r = this.repeat; this.repeat = null; return r; }
    const pickFrom = (list) => {
      const pool = list.length > 1 ? list.filter((r) => r.id !== this.lastId) : list;
      return pool[Math.floor(this.rand() * pool.length)];
    };
    if (this.mode === "studio") {
      const open = RHYTHMS.filter((r) => r.stage <= Math.max(1, this.sv.far) && (this.sv.book[r.id] || 0) < MASTERED);
      return pickFrom(open.length ? open : RHYTHMS.filter((r) => r.stage <= Math.max(1, this.sv.far)));
    }
    if (this.mode === "accel") return pickFrom(RHYTHMS.filter((r) => r.stage <= Math.max(1, this.sv.far) || this.heard(r.id)));
    if (this.stage >= STAGES.length) return pickFrom(RHYTHMS);
    const own = RHYTHMS.filter((r) => r.stage === this.stage);
    const fresh = own.find((r) => !this.introduced.includes(r.id));
    if (fresh) { this.introduced.push(fresh.id); return fresh; }
    if (this.stage > 0 && this.rand() < 0.3) return pickFrom(RHYTHMS.filter((r) => r.stage < this.stage));
    return pickFrom(own);
  }
  tempo() {
    const sp = this.spec();
    if (this.mode === "accel") return Math.min(180, 88 + 3 * this.rounds);
    return Math.round(lerp(sp.b0, sp.b1, clamp(this.stagePass / sp.bars, 0, 1)));
  }
  // Lay out the next round from nextT: a count-in before the first, the call, the answer, and
  // sometimes a second answer with no call.
  startRound() {
    const sp = this.spec(), r = this.pick();
    this.bpm = this.tempo();
    const sd = 60 / this.bpm / r.spb, dur = r.steps * sd;
    let t = this.nextT;
    if (!this.rounds || this.countIn) {
      this.countIn = false;
      const beat = 60 / this.bpm;
      this.segs.push({ kind: "count", r, t0: t, dur: beat * 4, sd: beat, notes: [] });
      t += beat * 4;
    }
    const practice = !this.rounds && this.mode !== "studio";
    const fresh = !this.heard(r.id);
    if (fresh) this.sv.book[r.id] = 0;
    const mk = (kind, extra = {}) => {
      const seg = { kind, r, t0: t, dur, sd, notes: r.on.map((s) => ({ t: t + s * sd, s, v: voice(r, s), g: -1, miss: false, done: false })), ...extra };
      t += dur;
      this.segs.push(seg);
      return seg;
    };
    mk("call", { fresh });
    // A new rhythm's notation stays up during its answer, and through the first two stages.
    const show = this.mode === "studio" || (!sp.cycle && this.stage < 2 && this.mode !== "accel") || !this.known(r.id);
    mk("answer", { show, practice, taps: [], extras: 0, carry: false, judged: false });
    if (sp.carry && this.rounds > 0 && this.rand() < sp.carry) mk("answer", { show: false, practice: false, taps: [], extras: 0, carry: true, judged: false });
    this.nextT = t;
    this.lastId = r.id;
    this.rounds++;
  }
  seg(at = this.rt) { return this.segs.find((s) => at >= s.t0 && at < s.t0 + s.dur) || null; }

  // ---- input ------------------------------------------------------------------------------------
  // On the title, result and songbook screens a press is decided when it ends: a tap is the main
  // action, a press of HOLD_PICK or more opens or operates the songbook. In play the press edge is
  // the tap, judged at once.
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
  // Back from the menu mid-run: the groove was broken, so the round in progress is dropped unjudged and
  // called again after a four-beat count-in.
  resume() {
    this.lamps.wake();
    if (this.phase !== "play") return;
    const cur = this.segs.find((s) => s.kind !== "count" && s.t0 + s.dur > this.rt);
    if (!cur) return;
    this.segs = this.segs.filter((s) => s.t0 + s.dur <= this.rt && (s.kind !== "answer" || s.judged));
    this.repeat = cur.r;
    this.nextT = this.rt + 0.3;
    this.countIn = true;
    this.fb = null;
    this.announce("COUNT IN", 1.6);
  }
  dispose() { this.guard.settle(); this.lamps.sleep(); }

  menuPress(dur) {
    const long = dur >= HOLD_PICK;
    if (this.phase === "title" || this.phase === "over") {
      if (long) this.openMenu();
      else this.start(this.phase === "over" ? this.mode : "relay");
      return;
    }
    if (this.view !== "menu") {
      const pages = this.view === "book" ? Math.ceil(RHYTHMS.length / 6) : Math.ceil(FEATS.length / 6);
      if (long || this.view === "log") { this.view = "menu"; this.page = 0; }
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
    if (row === "BOOK") { this.view = "book"; this.page = 0; return; }
    if (row === "LOG") { this.view = "log"; return; }
    if (row === "KIT") {
      let i = this.sv.sel.kit;
      do i = (i + 1) % KITS.length; while (this.sv.ft.length < KITS[i].need);
      this.sv.sel.kit = i;
      const k = this.kit();
      k.hz.forEach((hz, j) => this.queue(0.12 * j, hz, 0.1, k.wave));
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
    if (mode === "daily") this.dseed = mixSeed(hashText("relay-day" + this.dayKey())) || 1;
    this.best0 = this.bestRef();
    this.announce(mode === "relay" ? this.spec().note : MODES[mode].name + ": " + MODES[mode].text, 3.4);
    this.setHint("Listen and watch the lamps. When they go dark, tap the rhythm back.");
    this.lamps.clear();
    this.startRound();
  }

  // A tap in play: judged against the nearest note of an answer still open. A tap during a call is
  // free (tapping along is how a rhythm is learned); a tap in an answer that matches no note is a slip.
  strike() {
    const k = this.spec().win, at = this.rt - latency(this.c);
    let best = null, bs = null;
    for (const s of this.segs) {
      if (s.kind !== "answer" || s.judged) continue;
      for (const n of s.notes) {
        if (n.done) continue;
        if (!best || Math.abs(at - n.t) < Math.abs(at - best.t)) { best = n; bs = s; }
      }
    }
    const err = best ? Math.abs(at - best.t) : Infinity;
    if (best && err <= WIN[2] * k) { this.hit(bs, best, err <= WIN[0] * k ? 0 : err <= WIN[1] * k ? 1 : 2, at); return; }
    const s = this.seg(at);
    if (s && s.kind === "answer" && !s.judged) {
      s.extras++;
      s.taps.push({ t: at, g: 3 });
      this.slip("EXTRA", s.practice);
      return;
    }
    // Along with a call: a soft echo on the middle lamp, nothing judged.
    this.glow[1] = Math.max(this.glow[1], 0.25);
    this.glowCol[1] = LAMP.cyan;
  }
  hit(s, n, grade, at = this.rt) {
    n.done = true;
    n.g = grade;
    const ms = Math.round((at - n.t) * 1000);
    s.taps.push({ t: at, g: grade });
    this.offs.push(ms);
    if (this.offs.length > 12) this.offs.shift();
    this.R.offSum += ms; this.R.offN++;
    if (grade < 2) this.combo++;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    const m = this.mult();
    this.R.maxMult = Math.max(this.R.maxMult, m);
    const pts = this.mode === "studio" ? 0 : Math.round(BASE[grade] * m * (1 + 0.1 * Math.min(this.stage, 10)) * (s.carry ? 1.5 : 1));
    this.score += pts;
    this.R.notes++;
    if (grade === 0) { this.R.perfects++; this.R.pRun++; this.R.pRunMax = Math.max(this.R.pRunMax, this.R.pRun); } else this.R.pRun = 0;
    this.fb = { word: GRADES[grade], pts, col: grade === 0 ? C.cyan : grade === 1 ? C.ink : C.amber, t: 0.7, ms };
    const k = this.kit();
    this.c.tone(k.hz[n.v] * (grade === 2 ? 0.5 : 1), 0.08, k.wave);
    this.glow[n.v] = 0.9;
    this.glowCol[n.v] = grade === 0 ? LAMP.white : grade === 1 ? LAMP.green : LAMP.amber;
    this.checkFeats();
  }
  slip(word, free) {
    this.combo = 0;
    this.R.pRun = 0;
    this.fb = { word: free ? word + " / WARM-UP" : word, pts: 0, col: C.red, t: 0.7 };
    this.c.tone(110, 0.12, "sawtooth");
    this.glow = [0.5, 0.5, 0.5];
    this.glowCol = [LAMP.red, LAMP.red, LAMP.red];
  }

  // ---- frame ------------------------------------------------------------------------------------
  update(dt) {
    this.guard.tick(dt);
    this.t += dt;
    while (this.sq.length && this.sq[0][0] <= this.t) { const [, hz, s, w] = this.sq.shift(); this.c.tone(hz, s, w); }
    if (this.noteT > 0) this.noteT -= dt;
    if (this.fb) { this.fb.t -= dt; if (this.fb.t <= 0) this.fb = null; }
    for (let i = 0; i < 3; i++) this.glow[i] = Math.max(0, this.glow[i] - dt * 4);
    this.beatGlow = Math.max(0, this.beatGlow - dt * 5);
    if (this.phase === "play") this.step(dt);
    else if (this.phase === "over") this.deadT += dt;
    this.lampOut = this.lampValues();
    this.lamps.frame(dt, this.lampOut);
    this.pushHud();
  }
  step(dt) {
    this.rt += dt;
    const k = this.kit(), lag = latency(this.c), late = WIN[2] * this.spec().win + lag;
    for (const s of this.segs) {
      if (s.t0 > this.rt) break;
      // The call sounds and lights its notes.
      if (s.kind === "call") for (const n of s.notes) if (!n.done && this.rt >= n.t) {
        n.done = true;
        this.c.tone(k.hz[n.v], 0.1, k.wave);
        this.glow[n.v] = 0.85;
        this.glowCol[n.v] = LAMP.amber;
      }
      // A note of an answer let by is missed.
      if (s.kind === "answer" && !s.judged) for (const n of s.notes) if (!n.done && this.rt > n.t + late) {
        n.done = true;
        n.miss = true;
        this.slip("MISS", s.practice);
      }
      if (s.kind === "answer" && !s.judged && this.rt >= s.t0 + s.dur + Math.max(0, lag)) this.judge(s);
      if (this.phase !== "play") return;
    }
    this.metronome();
    this.segs = this.segs.filter((s) => s.t0 + s.dur > this.rt - 0.5 || (s.kind === "answer" && !s.judged));
    if (this.rt >= this.nextT - 1e-9) {
      if (this.mode === "studio" && this.rounds >= STUDIO_ROUNDS) { this.finish(); return; }
      this.startRound();
    }
  }
  // The pulse: a click on the beat in the count-in, and in an answer as the stage allows.
  metronome() {
    const s = this.seg();
    if (!s) return;
    const el = (this.rt - s.t0) / s.sd; // steps (beats in the count-in) since the segment began
    let b = -1;
    if (s.kind === "count") b = Math.floor(el);
    else for (const st of beatsOf(s.r)) if (st <= el) b = st;
    const key = s.t0 + ":" + b;
    if (b < 0 || key === this.lastBeat) return;
    this.lastBeat = key;
    if (s.kind === "count") { this.c.tone(b === 0 ? 1568 : 1175, 0.03, "sine"); this.beatGlow = 0.6; return; }
    if (s.kind !== "answer") return;
    const click = this.spec().click, step = b;
    const bar = step % s.r.bar === 0;
    if (click === "beat" || (click === "bar" && bar) || (click === "first" && step === 0)) {
      this.c.tone(bar ? 1568 : 1175, 0.025, "sine");
      this.beatGlow = bar ? 0.5 : 0.3;
    }
  }
  // An answer is over: count its slips. More than a quarter of its notes (but at least one in a pattern
  // of three or more) loses the answer: a shield goes and the rhythm is called again.
  judge(s) {
    s.judged = true;
    const n = s.notes.length, slips = this.slips(s), allow = this.allow(s);
    const clean = slips === 0 && s.notes.every((x) => x.g >= 0 && x.g <= 1);
    this.R.answers++;
    if (clean) {
      const m = this.mult(), bonus = this.mode === "studio" ? 0 : 20 * n * m * (s.carry ? 2 : 1);
      this.score += bonus;
      this.R.clean++;
      if (s.carry) this.R.carry++;
      if (this.shields === 1 && this.mode !== "studio") this.R.lastClean++;
      const was = this.sv.book[s.r.id] || 0;
      this.sv.book[s.r.id] = Math.min(999, was + 1);
      if (was + 1 === LEARNED) { this.newLearned.push(s.r.id); this.announce("LEARNED: " + s.r.name, 2.4); }
      else if (was + 1 === MASTERED) this.announce("MASTERED: " + s.r.name, 2.4);
      this.fb = { word: s.carry ? "CARRIED" : "CLEAN", pts: bonus, col: C.cyan, t: 1.1 };
      [784, 1047].forEach((hz, i) => this.queue(0.05 + 0.07 * i, hz, 0.08, "sine"));
      this.cleanRow++;
      if (this.cleanRow % REGEN === 0 && this.shields < SHIELDS && this.mode !== "studio") {
        this.shields++;
        this.announce("SHIELD RESTORED", 1.6);
        this.queue(0.2, 988, 0.1, "sine");
      }
    } else this.cleanRow = 0;
    const lost = slips > allow;
    if (!lost) this.pass();
    else {
      this.fb = { word: s.practice ? "AGAIN / WARM-UP" : "ANSWER LOST", pts: 0, col: C.red, t: 1.1 };
      // Called again, unless a later round is already laid out (then it was decided as the round began).
      const queued = this.segs.some((x) => x.kind === "call" && x.t0 >= s.t0 + s.dur - 1e-6);
      if (!this.repeat && !s.carry && !s.repeated && !queued) this.repeat = s.r;
      if (!s.practice && this.mode !== "studio") {
        this.stageClean = false;
        this.shields--;
        this.c.tone(82, 0.3, "sawtooth");
        if (this.shields <= 0) { this.finish(); return; }
      }
    }
    this.checkFeats();
  }
  slips(s) { return s.notes.filter((x) => x.miss).length + s.extras; }
  allow(s) { const n = s.notes.length; return n >= 3 ? Math.max(1, Math.floor(n / 4)) : 0; }
  pass() {
    if (this.mode === "studio" || this.mode === "accel") return;
    this.stagePass++;
    if (this.stagePass >= this.spec().bars) this.advance();
  }
  advance() {
    this.stage++;
    this.stagePass = 0;
    this.stageClean = true;
    this.introduced = [];
    this.R.far = Math.max(this.R.far, this.stage);
    const sp = this.spec();
    this.announce(sp.label + ": " + sp.note, 3.4);
    [659, 784, 1047].forEach((hz, i) => this.queue(0.08 * i, hz, 0.12, "sine"));
  }
  pushHud() {
    if (this.phase !== "play") return;
    const items = [["SCORE", this.score], ["COMBO", this.combo + "  x" + this.mult()],
      ["SHIELDS", this.mode === "studio" ? "-" : this.shields + " / " + SHIELDS], ["STAGE", this.spec().label]];
    const key = items.join("|");
    if (key !== this.hudKey) { this.hudKey = key; this.c.hud(items); }
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
    this.fb = null;
    const sv = this.sv, score = this.score;
    this.newRecord = score > 0 && score > this.best0 && this.mode !== "studio";
    if (this.mode === "relay") this.c.score(score);
    this.c.tone(this.mode === "studio" ? 523 : 82, 0.4, this.mode === "studio" ? "sine" : "sawtooth");
    sv.runs++;
    sv.st.notes += this.R.notes;
    sv.st.perfects += this.R.perfects;
    sv.st.clean += this.R.clean;
    sv.st.answers += this.R.answers;
    if (this.mode === "relay" || this.mode === "daily") sv.far = Math.max(sv.far, this.R.far);
    sv.best.combo = Math.max(sv.best.combo, this.bestCombo);
    if (this.mode === "accel") sv.best.bpm = Math.max(sv.best.bpm, this.bpm);
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
    } else if (this.mode !== "studio") sv.best[this.mode] = Math.max(sv.best[this.mode] || 0, score);
    // Run totals are now in the lifetime counters; leave the run's own values for the feats that read them.
    this.R.notes = 0; this.R.perfects = 0;
    const clean = this.R.clean;
    this.R.clean = 0;
    this.checkFeats();
    this.R.clean = clean;
    this.timing = this.R.offN >= 5 ? Math.round(this.R.offSum / this.R.offN) : null;
    this.result = { score, combo: this.bestCombo, stage: this.spec().label, mode: MODES[this.mode].name, clean, milestone: Math.floor(score / 1000) };
    sv.milestone = Math.max(sv.milestone, this.result.milestone);
    sv.last = { ...this.result };
    this.persist();
    this.result.next = this.nextGoal();
    this.setHint("Tap to play again. Hold for the songbook.");
    this.c.hud([["SCORE", score], ["BEST COMBO", this.bestCombo], ["REACHED", this.spec().label], ["BEST", this.bestRef()]]);
    this.hudKey = "";
  }
  persist() { this.c.saveProgress?.(JSON.parse(JSON.stringify(this.sv)))?.catch?.(this.c.error); }
  // The nearest unlock and the open feat nearest its goal.
  nextGoal() {
    const n = this.sv.ft.length, lines = [];
    const locked = [...Object.values(MODES).filter((m) => m.need && n < m.need).map((m) => [m.need, m.name]), ...KITS.filter((k) => n < k.need).map((k) => [k.need, k.name + " KIT"])].sort((a, b) => a[0] - b[0]);
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

  // ---- lamps --------------------------------------------------------------------------------------
  // The call lights each note on its lamp; the answer is dark but for the downbeat's faint glow on the
  // left lamp and the player's own taps, lit by grade. Title and menus breathe a slow waltz.
  lampValues() {
    if (this.phase === "title" || this.phase === "menu") {
      const b = Math.floor(this.t * 1.5) % 3, f = 1 - ((this.t * 1.5) % 1);
      return lamps(b === 0 ? dim(LAMP.amber, 0.14 * f) : null, b === 1 ? dim(LAMP.amber, 0.08 * f) : null, b === 2 ? dim(LAMP.amber, 0.08 * f) : null);
    }
    if (this.phase === "over") return this.deadT < 1 ? lamps(dim(LAMP.red, 0.3 * (1 - this.deadT)), null, dim(LAMP.red, 0.3 * (1 - this.deadT))) : lamps(null, null, null);
    const out = [0, 1, 2].map((i) => (this.glow[i] > 0 ? dim(this.glowCol[i], Math.min(1, this.glow[i])) : null));
    if (this.beatGlow > 0 && !out[0]) out[0] = dim(LAMP.cyan, 0.25 * this.beatGlow);
    return lamps(out[0], out[1], out[2]);
  }

  // ---- drawing ------------------------------------------------------------------------------------
  draw(g) {
    space(g, this.t * 6, 0.25);
    if (this.phase === "play") { this.drawPlay(g); return; }
    if (this.phase === "title") {
      banner(g, "RELAY", "The lamps play a rhythm, then go dark. Tap it back, and keep the groove going.");
      const n = learnedCount(this.sv);
      if (n) text(g, "SONGBOOK  " + n + " / " + RHYTHMS.length + " LEARNED", 480, 470, 18, C.muted, "center");
    } else if (this.phase === "over") this.drawOver(g);
    else this.drawMenu(g);
  }
  drawPlay(g) {
    const s = this.seg() || this.segs[0], sp = this.spec();
    // The multiplier in a ring that fills toward the next step, top left; shields, top right.
    const m = this.mult(), frac = m >= MULT_MAX ? 1 : (this.combo % MULT_STEP) / MULT_STEP;
    circle(g, 70, 50, 32, C.line, false, 4);
    if (frac > 0) { g.strokeStyle = m >= MULT_MAX ? C.cyan : C.amber; g.lineWidth = 4; g.beginPath(); g.arc(70, 50, 32, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); g.stroke(); }
    text(g, "x" + m, 70, 51, 26, m > 1 ? C.amber : C.muted, "center");
    if (this.combo > 1) text(g, this.combo + " IN A ROW", 116, 50, 18, C.muted);
    if (this.mode !== "studio") for (let i = 0; i < SHIELDS; i++) diamond(g, 856 + i * 34, 44, 12, i < this.shields ? C.cyan : C.line, i < this.shields);
    // The stage and how far through it.
    text(g, sp.label + "   " + this.bpm + " BPM", 480, 30, 18, C.muted, "center");
    const need = sp.bars < 999 ? sp.bars : 0;
    g.fillStyle = C.line; g.fillRect(360, 46, 240, 6);
    g.fillStyle = C.cyan; g.fillRect(360, 46, 240 * (need ? clamp(this.stagePass / need, 0, 1) : this.mode === "studio" ? clamp(this.rounds / STUDIO_ROUNDS, 0, 1) : 1), 6);
    if (this.noteT > 0) { g.globalAlpha = clamp(this.noteT / 0.4, 0, 1); text(g, this.note, 480, 104, 22, C.amber, "center"); g.globalAlpha = 1; }
    if (!s) return;
    const r = s.r;
    // The rhythm: name, a line on where it comes from, the metre.
    text(g, r.name, 480, 160, 40, C.amber, "center");
    text(g, r.note + "   " + r.meter, 480, 198, 18, C.muted, "center");
    // What to do now.
    let word = "", col = C.amber;
    if (s.kind === "count") word = "COUNT IN  " + "1 2 3 4".slice(0, 2 * clamp(Math.floor((this.rt - s.t0) / s.sd) + 1, 1, 4) - 1);
    else if (s.kind === "call") { word = s.fresh ? "NEW RHYTHM / LISTEN" : "LISTEN"; col = C.amber; }
    else { word = s.carry ? "AGAIN, FROM MEMORY" : s.practice ? "YOUR TURN / WARM-UP" : "YOUR TURN"; col = C.cyan; }
    text(g, word, 480, 256, 28, col, "center");
    this.drawStrip(g, s);
    // Three lamps as the console shows them.
    for (let i = 0; i < 3; i++) {
      const v = this.lampOut, rgb = "rgb(" + v[i * 3] + "," + v[i * 3 + 1] + "," + v[i * 3 + 2] + ")";
      if (v[i * 3] + v[i * 3 + 1] + v[i * 3 + 2] > 12) circle(g, 420 + i * 60, 424, 16, rgb, true);
      circle(g, 420 + i * 60, 424, 16, C.line, false, 2);
    }
    if (this.fb) {
      g.globalAlpha = clamp(this.fb.t / 0.3, 0, 1);
      const when = this.fb.ms === undefined ? "" : Math.abs(this.fb.ms) <= 10 ? "   ON TIME" : "   " + Math.abs(this.fb.ms) + " ms " + (this.fb.ms < 0 ? "EARLY" : "LATE");
      text(g, this.fb.word + (this.fb.pts ? "  +" + this.fb.pts : "") + when, 480, 474, 26, this.fb.col, "center");
      g.globalAlpha = 1;
    }
    this.drawTiming(g, 514);
  }
  // The notation: one cell per step, beats and bars marked, the notes as dots. During a call the dots
  // light as they sound; during an answer they show only while the rhythm is new, and the taps appear
  // where they fell, coloured by grade, with missed notes ringed red.
  drawStrip(g, s) {
    const r = s.r, w = (SX1 - SX0) / r.steps, beats = beatsOf(r);
    for (let i = 0; i <= r.steps; i++) {
      const x = SX0 + i * w, bar = i % r.bar === 0, beat = beats.includes(i % r.steps) || i === r.steps;
      line(g, x, SY - (bar ? 26 : beat ? 16 : 6), x, SY + (bar ? 26 : beat ? 16 : 6), bar ? C.muted : C.line, bar ? 2 : 1);
    }
    line(g, SX0, SY, SX1, SY, C.line, 1);
    const live = s.kind !== "count", el = (this.rt - s.t0) / s.sd;
    const rad = Math.min(11, w * 0.42);
    const showDots = s.kind === "call" || (s.kind === "answer" && s.show) || s.kind === "count";
    if (showDots) for (const n of s.notes.length ? s.notes : r.on.map((st) => ({ s: st, v: voice(r, st), done: false }))) {
      const x = SX0 + (n.s + 0.5) * w, y = SY - 0 + (n.v - 1) * -10;
      const lit = s.kind === "call" && n.done, pop = lit ? Math.max(0, 1 - (el - n.s) / 2) : 0;
      if (s.kind === "answer") circle(g, x, y, rad, C.line, false, 2);
      else circle(g, x, y, rad * (1 + 0.4 * pop), lit ? C.amber : s.kind === "count" ? C.line : C.muted, lit);
    }
    if (s.kind === "answer") {
      for (const n of s.notes) if (n.miss) circle(g, SX0 + (n.s + 0.5) * w, SY + (n.v - 1) * -10, rad + 3, C.red, false, 2);
      for (const tp of s.taps) {
        const x = SX0 + ((tp.t - s.t0) / s.sd + 0.5) * w;
        circle(g, clamp(x, SX0, SX1), SY, rad * 0.8, [C.cyan, C.ink, C.amber, C.red][tp.g], true);
      }
    }
    // The playhead.
    if (live) { const x = SX0 + clamp(el, 0, r.steps) * w; line(g, x, SY - 34, x, SY + 34, s.kind === "answer" ? C.cyan : C.amber, 2); }
  }
  // The last taps' timing on a strip: left of the centre line is early, right is late; newest brightest.
  drawTiming(g, y) {
    const half = 150, scale = half / (WIN[2] * 1000);
    line(g, 480 - half, y, 480 + half, y, C.line, 2);
    line(g, 480, y - 12, 480, y + 12, C.muted, 2);
    text(g, "EARLY", 480 - half - 12, y, 16, C.muted, "right");
    text(g, "LATE", 480 + half + 12, y, 16, C.muted);
    const n = this.offs.length;
    this.offs.forEach((ms, i) => {
      const x = 480 + clamp(ms, -140, 140) * scale, newest = i === n - 1;
      g.globalAlpha = 0.25 + 0.75 * ((i + 1) / n);
      line(g, x, y - (newest ? 12 : 8), x, y + (newest ? 12 : 8), Math.abs(ms) <= 50 ? C.cyan : C.amber, newest ? 4 : 3);
    });
    g.globalAlpha = 1;
  }
  timingText() {
    const t = this.timing;
    if (t === null) return "";
    return Math.abs(t) <= 10 ? "ON TIME" : Math.abs(t) + " ms " + (t < 0 ? "EARLY" : "LATE");
  }
  drawOver(g) {
    const r = this.result || {};
    g.fillStyle = "#0c1511f0";
    g.fillRect(150, 52, 660, 450);
    line(g, 200, 62, 760, 62, C.line);
    text(g, r.mode === "RELAY" ? "RELAY" : "RELAY / " + r.mode, 480, 96, 32, C.amber, "center");
    let y = 146;
    const row = (label, value, col = C.ink) => { text(g, label, 230, y, 18, C.muted); text(g, value, 730, y, 26, col, "right"); y += 36; };
    row("SCORE", String(r.score ?? 0));
    row("CLEAN ANSWERS", String(r.clean ?? 0));
    row("REACHED", r.stage || "");
    if (this.timing !== null) row("TIMING", this.timingText(), Math.abs(this.timing) <= 20 ? C.cyan : C.amber);
    if (this.mode !== "studio") text(g, this.newRecord ? "NEW BEST" : "BEST " + this.bestRef(), 480, y + 2, 20, this.newRecord ? C.cyan : C.amber, "center");
    y += 38;
    const lines = [];
    if (this.mode === "daily") lines.push([this.goalDone ? "DAILY GOAL MET" : "DAILY: " + dailyGoal(this.dayKey()).text, this.goalDone ? C.cyan : C.muted, 18]);
    if (this.newLearned.length) lines.push(["LEARNED  " + this.newLearned.slice(0, 3).map((id) => byId(id).name).join(", "), C.amber, 18]);
    for (const id of this.newFeats.slice(0, 2)) { const f = FEATS.find((x) => x.id === id); if (f) lines.push(["FEAT  " + f.name, C.cyan, 20]); }
    for (const l of r.next || []) lines.push([l, C.muted, 18]);
    for (const [s, col, size] of lines.slice(0, 4)) { text(g, s, 480, y, size, col, "center"); y += 28; }
    if (this.deadT > 0.7) text(g, "TAP = AGAIN     HOLD = SONGBOOK", 480, 476, 20, C.amber, "center");
  }
  drawMenu(g) {
    g.fillStyle = "#0c1511f2";
    g.fillRect(110, 36, 740, 470);
    line(g, 160, 46, 800, 46, C.line);
    text(g, "SONGBOOK", 480, 82, 34, C.amber, "center");
    const sv = this.sv, n = sv.ft.length;
    if (this.view === "menu") {
      const lock = (m) => (this.unlocked(m) ? null : "AT " + MODES[m].need + " FEATS");
      const rows = {
        RELAY: ["RELAY", "BEST " + this.bestRefFor("relay")],
        DAILY: ["DAILY", sv.dl.d === this.dayKey() && sv.dl.done ? "DONE TODAY" : "SEEDED BY DATE"],
        STUDIO: ["STUDIO", "PRACTICE"],
        ACCEL: ["ACCELERANDO", lock("accel") || "BEST " + sv.best.accel + (sv.best.bpm ? "  " + sv.best.bpm + " BPM" : "")],
        KIT: ["SOUND KIT", this.kit().name],
        BOOK: ["RHYTHMS", learnedCount(sv) + " / " + RHYTHMS.length + " LEARNED"],
        FEATS: ["FEATS", n + " / " + FEATS.length],
        LOG: ["LOG", "RUNS " + sv.runs],
      };
      ROWS.forEach((id, i) => {
        const y = 132 + i * 37, on = i === this.cur;
        const locked = id === "ACCEL" && !this.unlocked("accel");
        if (on) diamond(g, 150, y, 9, C.amber, true);
        text(g, rows[id][0], 180, y, 24, on ? C.amber : locked ? C.line : C.ink);
        text(g, rows[id][1], 810, y, 22, on ? C.amber : C.muted, "right");
      });
      const id = ROWS[this.cur];
      let info;
      if (id === "KIT") { const next = KITS.find((k) => n < k.need); info = "The sound of the lamps' notes." + (next ? "  NEXT: " + next.name + " AT " + next.need : ""); }
      else if (id === "BOOK") info = "Every rhythm you have met. Learned at 1 clean answer, mastered at 5.";
      else if (id === "FEATS") info = "Named goals. Some are not listed.";
      else if (id === "LOG") info = "What you have done so far.";
      else if (id === "DAILY") info = "Goal: " + dailyGoal(this.dayKey()).text + (sv.dl.streak > 1 ? "  STREAK " + sv.dl.streak : "");
      else info = MODES[id.toLowerCase()].text;
      text(g, info, 480, 446, 18, C.muted, "center");
      text(g, "TAP = NEXT LINE     HOLD = CHOOSE", 480, 480, 18, C.cyan, "center");
    } else if (this.view === "book") this.drawBook(g);
    else if (this.view === "feats") {
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
        ["RUNS", sv.runs], ["NOTES STRUCK", sv.st.notes], ["PERFECT", sv.st.perfects], ["CLEAN ANSWERS", sv.st.clean + " / " + sv.st.answers],
        ["BEST COMBO", sv.best.combo], ["FURTHEST", stageSpec(sv.far).label], ["RHYTHMS", learnedCount(sv) + " LEARNED, " + learnedCount(sv, MASTERED) + " MASTERED"],
        ["DAILY GOALS", sv.st.daily + (sv.dl.streak > 1 ? "  STREAK " + sv.dl.streak : "")],
      ];
      lines.forEach(([k, v], i) => { const y = 130 + i * 42; text(g, k, 150, y, 22, C.ink); text(g, String(v), 810, y, 22, C.amber, "right"); });
      text(g, "TAP = BACK", 480, 480, 18, C.cyan, "center");
    }
  }
  // The rhythm book: six to a page, each with its notation once heard; unheard ones stay hidden.
  drawBook(g) {
    const per = 6, pages = Math.ceil(RHYTHMS.length / per), sv = this.sv;
    text(g, "RHYTHMS  " + learnedCount(sv) + " LEARNED  " + learnedCount(sv, MASTERED) + " MASTERED     PAGE " + (this.page + 1) + " / " + pages, 480, 118, 18, C.cyan, "center");
    RHYTHMS.slice(this.page * per, this.page * per + per).forEach((r, i) => {
      const y = 162 + i * 50, heard = r.id in sv.book, c = sv.book[r.id] || 0;
      const mastered = c >= MASTERED, learned = c >= LEARNED;
      text(g, heard ? r.name : "? ? ?", 150, y - 9, 20, mastered ? C.cyan : learned ? C.ink : heard ? C.muted : C.line);
      text(g, heard ? r.meter + "  " + ROMAN[r.stage] : "STAGE " + ROMAN[r.stage], 150, y + 13, 16, C.line);
      if (heard) {
        const x0 = 470, x1 = 700, w = (x1 - x0) / r.steps;
        line(g, x0, y, x1, y, C.line, 1);
        for (let b = 0; b <= r.steps; b += r.bar) line(g, x0 + b * w, y - 9, x0 + b * w, y + 9, C.line, 1);
        for (const st of r.on) circle(g, x0 + (st + 0.5) * w, y, 4, learned ? C.amber : C.muted, true);
      }
      text(g, mastered ? "MASTERED" : learned ? c + " / " + MASTERED : heard ? "HEARD" : "", 810, y, 18, mastered ? C.cyan : learned ? C.amber : C.muted, "right");
    });
    text(g, "TAP = NEXT PAGE     HOLD = BACK", 480, 480, 18, C.cyan, "center");
  }
}
