import { clamp } from "../engine/math.js";
import { C, text, line, circle, diamond, space } from "../engine/draw.js";
import { AppGuard } from "../engine/input.js";
import { LAMP, fill, only, meter, spot, dim, pulse, lightsOff } from "../engine/lightshow.js";
import { LampBus, LOCKOUT, announce, drawNote } from "./game-kit.js";
import { MORSE } from "./morse.js";
import { validRecord, credit, assisted, fault, need, strength, weightedPick, localDay, practiseDay, MASTERED,
  rankOf, dayIndex, dailyFor, award } from "./learning.js";

// ---------------------------------------------------------------------------------------------
// Echo Vault: a Morse sending game. Words approach the vault as transmissions; key each letter
// (tap a dot, hold a dash) before the transmission's timer runs out. It teaches the letters in the
// order Signal School uses, four to begin with, and adds one whenever every letter in play has some
// strength. A letter's code is shown at once while it is new and appears later and later as it
// gets stronger, until it is only shown after a mistake. Echo transmissions hide the word: the
// vault plays it and you key back what you heard. Letters Signal School has taught are open here
// too (read from its saved progress; this game never writes it).
export const ORDER = "ETANIMSORKDUGWHBFLPJCXYQVZ";
export const FIRST_LETTERS = 4;
export const SHIELDS = 3;
// A run is one shift of this many transmissions; clearing them all opens the vault.
export const SHIFT = 30;
// After a release, a letter that is still unfinished counts as sent once the key has been quiet this
// long (the gap between letters, generous for a learner).
const GAP_S = 1.0;
// A press held this long is no element: it asks the vault to play an echo transmission again.
const REPLAY_MS = 1000;
// On the title, card and result screens a press is decided when it ends: a tap begins, a press this
// long opens (or closes) the code card.
const HOLD_PICK = 0.5;
// Seconds before a letter's code is shown, by strength. Strength 4 and 5 show it only after a miss.
const HINT_AFTER = [0, 1.5, 3, 5, Infinity, Infinity];
const CX = 540;          // the centre of the play area, right of the vault door
const TRACE = 180;       // scope samples (three seconds)
const MAX_SPARKS = 40;

// Common words and radio shorthand, filtered at play time to the letters you have.
export const WORDS = (
  "AT AN IN IT ME AM TEA TEN NET MAN MEN TIN ANT TAN EAT ATE MAT MET AIM TIE NEAT TENT TEEN MEAT MATE TAME " +
  "TEAM NAME MEAN MINE MINT TIME ITEM EMIT MAIN AMEN ANTE TINT NINE ANTI MITE INMATE ANIMATE TITAN TENANT " +
  "INTENT AS IS SO NO ON TO MOST SEA SET SAT SIT SON NOT TON ONE NOSE NEST STAR SORT REST RATE ROSE ROOM " +
  "MORE STORE TREE IRON NOTE RAIN STONE SMART START ASTER TRAIN RISE MOON SOON TOOTH ROTOR SENSOR ORBIT " +
  "STREAM STORM KIT INK OAK SKI MARK DARK DESK DOME DONE DIRT DEAR READ ROAD SEND MIND KIND DUSK DUST RUST " +
  "TURN UNIT MUSIC SOUND DUNE GUST GOOD GUARD SIGNAL ROUND GROUND WAR WAS WE WET WIND WORD WORK TWO WORM " +
  "SNOW TOWN DOWN WIDE HE HER HIS HAT THE THAT THIS THEN THEM WHAT WHEN WITH SHOW HOME HOUR HUNT EARTH " +
  "NORTH SOUTH WATER HORSE BE BY BIT BOAT BRING BRAND BEAM BEST ROBOT ORBITS FAR FIRE FROM FOUND FROST " +
  "FIELD SHIFT LIGHT LAMP LINE LOOK LOW SLOW LAND LIFE FALL TOOL PLAN PATH PORT PULSE PLANET SPACE JET JUST " +
  "JUMP JOIN JOURNEY CODE CALL CLEAR CLOCK CLOUD COLD CAMP COMET COPY OCTAVE EXIT BOX FOX AXIS YES YET YOU " +
  "SKY KEY DAY YEAR QUIET QUEST QUICK VOICE VAULT WAVE VAPOR ZONE ZERO ZEST ZINC FIZZ HAZE " +
  "CQ SOS DE QTH QSL QRZ TNX RST WX RIG HI OM ES"
).split(" ");

// A rank from experience: two points a letter, five a word, fifty for opening the vault, 150 a contract.
export const RANKS = [[0, "CADET"], [300, "LISTENER"], [1000, "OPERATOR"], [2500, "SPARKS"], [5000, "CHIEF OPERATOR"],
  [9000, "RADIO OFFICER"], [15000, "SIGNALMASTER"], [25000, "LEGEND OF THE BAND"]];
// The far stations. Every shift ends with a station's call sign; key it and the station is in the log.
export const STATIONS = ["KESTREL RIDGE", "TIDEWATCH", "CINDER FLATS", "ORRERY NINE", "GLASS HARBOR", "DUSKWELL",
  "FAR LANTERN", "HOLLOW MOON", "SALT MERIDIAN", "QUIET RELAY", "AMBER DEEP", "NORTH CAIRN", "VESPER TWO",
  "ASH COLONY", "DRIFT STATION", "LONG ECHO", "MIRROR BASIN", "OLD BEACON", "SKYE ARRAY", "THE LAST OUTPOST"];
// One contract a day (the same all day), checked when a shift ends.
export const CONTRACTS = [
  { text: "OPEN THE VAULT WITHOUT LOSING A SHIELD", met: (r) => r.reason === "opened" && r.shieldsLost === 0 },
  { text: "REACH A COMBO OF 20 LETTERS", met: (r) => r.bestCombo >= 20 },
  { text: "CLEAR 5 ECHO WORDS IN ONE SHIFT", met: (r) => r.echoes >= 5 },
  { text: "KEY 70 LETTERS IN ONE SHIFT", met: (r) => r.letters >= 70 },
  { text: "OPEN THE VAULT 90% CLEAN", met: (r) => r.reason === "opened" && r.accuracy >= 90 },
  { text: "CLEAR 3 PRIORITY WORDS IN ONE SHIFT", met: (r) => r.priority >= 3 },
  { text: "MAKE CONTACT WITH A NEW STATION", met: (r) => r.contact },
];
export const FEATS = [
  { id: "first", name: "FIRST CONTACT", about: "open the vault" },
  { id: "untouched", name: "UNTOUCHED", about: "open it, no shield lost" },
  { id: "carrier", name: "LONG CARRIER", about: "a combo of 30 letters" },
  { id: "ears", name: "GOOD EARS", about: "8 echo words in a shift" },
  { id: "ten", name: "TEN LETTERS", about: "10 letters open" },
  { id: "most", name: "MOST OF THE CODE", about: "18 letters open" },
  { id: "all", name: "THE WHOLE ALPHABET", about: "all 26 letters open" },
  { id: "master", name: "FIRST MASTERY", about: "a letter fully strong" },
  { id: "master10", name: "TEN MASTERED", about: "10 letters fully strong" },
  { id: "fast", name: "FAST HANDS", about: "45 letters a minute" },
  { id: "week", name: "A WEEK ON THE AIR", about: "7 days in a row" },
  { id: "stations", name: "TWELVE STATIONS", about: "12 stations in the log" },
  { id: "contracts", name: "CONTRACTOR", about: "5 daily contracts" },
];
// A station's call sign: four open letters, the same for that station while the open letters stay the same.
export function callSign(station, pool) {
  let out = "";
  for (let i = 0; i < 4; i++) out += pool[dayIndex(`station-${station}-${i}`, pool.length)];
  return out;
}

const unitsOf = (code) => [...code].reduce((s, e) => s + (e === "." ? 1 : 3), 0) + Math.max(0, code.length - 1);

// Bring any stored shape to schema 2: nothing, the first release's run record ({ schema: 1, runs, last,
// milestone } from recordRun), or schema 2 itself. The run count and milestone carry over.
export function migrateEcho(raw) {
  const v = raw && typeof raw === "object" ? raw : {};
  const letters = {};
  if (v.schema === 2 && v.letters && typeof v.letters === "object")
    for (const key of ORDER) if (validRecord(v.letters[key])) letters[key] = v.letters[key].map((n) => Math.max(0, Math.round(n)));
  const best = v.schema === 2 && v.best ? v.best : {};
  return {
    schema: 2,
    runs: Math.max(0, v.runs | 0),
    milestone: Math.max(0, v.milestone | 0),
    last: v.last && typeof v.last === "object" ? { ...v.last } : {},
    pool: clamp(v.schema === 2 ? v.pool | 0 : 0, FIRST_LETTERS, ORDER.length),
    session: v.schema === 2 ? Math.max(0, v.session | 0) : 0,
    letters,
    best: { score: Math.max(0, best.score | 0), words: Math.max(0, best.words | 0), cpm: Math.max(0, best.cpm | 0) },
    days: v.schema === 2 && v.days ? { last: String(v.days.last || ""), streak: v.days.streak | 0, total: v.days.total | 0 } : { last: "", streak: 0, total: 0 },
    xp: v.schema === 2 ? Math.max(0, v.xp | 0) : 0,
    stations: v.schema === 2 ? clamp(v.stations | 0, 0, STATIONS.length) : 0,
    contracts: v.schema === 2 ? Math.max(0, v.contracts | 0) : 0,
    feats: v.schema === 2 && Array.isArray(v.feats) ? v.feats.filter((id) => FEATS.some((f) => f.id === id)) : [],
    daily: v.schema === 2 && v.daily && typeof v.daily === "object" ? { day: String(v.daily.day || ""), id: v.daily.id | 0, done: !!v.daily.done } : null,
  };
}
// Letters Signal School has taught: its guided lesson position counts letters in the same order.
export function schoolLetters(ctx) {
  const index = ctx.state?.()?.progress?.morse?.index;
  return Number.isFinite(index) ? clamp(Math.floor(index), 0, ORDER.length) : 0;
}

export class EchoVault {
  constructor(ctx) {
    this.c = ctx;
    this.lamps = new LampBus(ctx);
    this.sv = migrateEcho(ctx.progress?.());
    this.guard = new AppGuard(this, ctx);
    this.t = 0;
    this.phase = "title";
    this.downAt = null; this.downOn = "";
    this.overAt = -LOCKOUT;
    this.note = ""; this.noteT = 0;
    this.result = null;
    this.introRest = 0;
    this.title();
  }
  get unit() { return 1200 / (this.c.settings().morseWpm || 10); }
  get dashMs() { return this.unit * 2; }
  get toneCapMs() { return this.unit * 5; }
  // The letters open to play: this game's own, plus whatever Signal School has taught.
  poolSize() { return clamp(Math.max(this.sv.pool, schoolLetters(this.c)), FIRST_LETTERS, ORDER.length); }
  pool() { return ORDER.slice(0, this.poolSize()).split(""); }
  mastered() { return ORDER.split("").filter((k) => strength(this.sv.letters, k) >= MASTERED).length; }
  contract() {
    const today = this.today();
    if (this.sv.daily?.day !== today) this.sv.daily = dailyFor(this.sv.daily, today, CONTRACTS.length);
    return this.sv.daily;
  }
  rank() { return rankOf(this.sv.xp, RANKS); }
  title() {
    this.phase = "title";
    this.page = "";
    this.c.hint("Tap to open the vault. Hold for the code card. Menu: tap, tap, hold.");
  }

  // ------------------------------------------------------------------------------------- a run
  start() {
    this.sv.session += 1;
    this.sv.days = practiseDay(this.sv.days, this.today());
    const pool = this.pool();
    // Letters never answered yet are introduced before the first transmission.
    this.fresh = pool.filter((k) => { const r = this.sv.letters[k]; return !r || r[2] + r[3] === 0; }).slice(0, 4);
    this.run = { words: 0, letters: 0, misses: 0, helped: 0, combo: 0, bestCombo: 0, points: 0, playT: 0, raised: {}, dropped: {}, lost: 0, gained: 0, cleared: 0,
      echoes: 0, priority: 0, shieldsLost: 0, contact: false, door: [] };
    this.sparks = []; this.trace = new Array(TRACE).fill(0); this.traceAt = 0;
    this.shields = SHIELDS;
    this.recent = [];
    this.queue = this.fresh.flatMap((k) => [k, k]);
    this.word = ""; this.pos = 0; this.input = ""; this.gap = 0; this.missT = 0; this.shown = false; this.letterT = 0;
    this.kind = "plain";
    this.feedback = "";
    this.result = null;
    if (this.fresh.length) this.introduce(0); else this.nextWord();
  }
  today() { return localDay(); }
  // The new letter card: the letter, its code drawn and played twice on the sidetone and the lamps.
  introduce(i) {
    this.phase = "intro";
    this.introAt = i; this.introRest = 0;
    const k = this.fresh[i];
    this.playback(k + " " + k, 0.5);
    this.c.hint("New letter " + k + ". Tap when you have it.");
  }
  // The pulses of a text in Morse: one unit a dot, three a dash, one between elements, a learner's
  // three-unit (at least 0.45 s) gap between letters and twice that at a space.
  playback(textToPlay, lead = 0.4) {
    const u = this.unit / 1000, steps = [{ on: false, s: lead }];
    for (const ch of textToPlay) {
      if (ch === " ") { steps.push({ on: false, s: Math.max(0.9, 6 * u) }); continue; }
      const code = MORSE[ch] || "";
      [...code].forEach((e, j) => {
        steps.push({ on: true, dash: e === "-", s: u * (e === "." ? 1 : 3) });
        if (j < code.length - 1) steps.push({ on: false, s: u });
      });
      steps.push({ on: false, s: Math.max(0.45, 3 * u) });
    }
    this.pulses = steps.slice(0, 200);
    this.pulseAt = -1; this.pulseLeft = 0; this.lit = false; this.litDash = false;
  }
  playing() { return this.pulses && this.pulseAt < this.pulses.length; }
  playbackSeconds() { return (this.pulses || []).reduce((s, p) => s + p.s, 0); }
  // Advance the pulses; returns true while playback continues.
  advancePlayback(dt) {
    if (!this.playing()) return false;
    this.pulseLeft -= dt;
    while (this.pulseLeft <= 0 && this.pulseAt < this.pulses.length) {
      const step = this.pulses[++this.pulseAt];
      if (!step) { this.lit = false; this.c.synth.stopTone(); return false; }
      this.pulseLeft += step.s;
      if (step.on !== this.lit) { if (step.on) this.c.synth.startTone(600); else this.c.synth.stopTone(); }
      this.lit = step.on; this.litDash = !!step.dash;
    }
    return true;
  }

  // The next word: words made only of open letters, weighted toward weak and due letters and toward
  // letters just introduced; a code group of open letters when the open letters make too few words.
  pickWord() {
    if (this.queue.length) return this.queue.shift();
    if (this.run.words === SHIFT - 1) return callSign(this.sv.stations, this.pool());
    const n = this.run.words, open = new Set(this.pool());
    const [lo, hi] = n < 4 ? [2, 3] : n < 10 ? [2, 4] : n < 18 ? [3, 5] : [3, 7];
    const weigh = (ch) => need(this.sv.letters, ch, this.sv.session) + (this.fresh.includes(ch) ? 3 : 0);
    const words = WORDS.filter((w) => w.length >= lo && w.length <= hi && !this.recent.includes(w) && [...w].every((ch) => open.has(ch)));
    if (words.length >= 5) return weightedPick(this.c.rng, words, (w) => [...w].reduce((s, ch) => s + weigh(ch), 0) / w.length);
    const letters = [...open], len = this.c.rng.int(lo, Math.min(hi, 4));
    let group = "";
    for (let i = 0; i < len; i++) group += weightedPick(this.c.rng, letters, weigh);
    return group;
  }
  // What kind of transmission comes next. Echoes (heard, not shown) from the 7th word, every fourth,
  // and every third from the 15th; priority traffic (double points, less time) every fifth from the 11th.
  kindFor(n) {
    if (n === SHIFT - 1) return "contact";
    if (n >= 10 && n % 5 === 0) return "priority";
    if (n >= 6 && (n >= 14 ? n % 3 === 2 : n % 4 === 2)) return "echo";
    return "plain";
  }
  nextWord() {
    this.phase = "play";
    const n = this.run.words;
    this.word = this.pickWord();
    this.recent = [...this.recent.slice(-7), this.word];
    this.kind = this.word.length === 1 ? "plain" : this.kindFor(n);
    this.pos = 0; this.input = ""; this.gap = 0; this.missT = 0; this.shown = false; this.letterT = 0;
    this.stage = "send"; this.feedback = "";
    if (n === 6) announce(this, "ECHO TRANSMISSIONS / LISTEN, THEN KEY");
    else if (n === 10) announce(this, "PRIORITY TRAFFIC / DOUBLE POINTS");
    else if (n === 14) announce(this, "ECHOES EVERY THIRD WORD");
    else if (n === 18) announce(this, "LONGER WORDS");
    else if (n === SHIFT - 1) announce(this, `CONTACT / ${STATIONS[this.sv.stations % STATIONS.length]} CALLING`);
    // Think time per letter shrinks from 2.6 s to 0.6 s over the shift, and the time allowed for keying
    // from 1.6 to 1.25 times the code's length at the set speed.
    const think = Math.max(0.6, 2.6 - 0.07 * n), slack = Math.max(1.25, 1.6 - 0.012 * n), u = this.unit / 1000;
    let total = 1.2 + [...this.word].reduce((s, ch) => s + think + slack * unitsOf(MORSE[ch] || "") * u, 0);
    if (this.kind === "priority") total *= 0.75;
    if (this.kind === "contact") total *= 1.2;
    if (this.kind === "echo") {
      this.playback(this.word);
      this.stage = "listen";
      total += 1;
    }
    this.total = this.left = total;
    this.c.hint(this.kind === "echo" ? "Listen. Then key what you heard. A long hold plays it again." : "Tap a dot, hold a dash. Key each letter in turn.");
  }
  current() { return this.word[this.pos] || ""; }
  hintVisible() {
    if (this.stage !== "send") return false;
    if (this.shown) return true;
    const after = HINT_AFTER[strength(this.sv.letters, this.current())] ?? Infinity;
    return this.letterT >= (this.kind === "echo" ? Math.max(2.5, after) : after);
  }
  // A letter keyed: right when the elements so far equal its code, wrong as soon as they cannot.
  element(mark) {
    if (this.stage !== "send" || this.missT > 0) return;
    this.input = (this.input + mark).slice(0, 7);
    const want = MORSE[this.current()] || "";
    if (this.input === want) this.letterDone(true);
    else if (!want.startsWith(this.input)) this.letterDone(false);
    else this.gap = GAP_S;
  }
  letterDone(ok) {
    const k = this.current(), run = this.run;
    this.gap = 0;
    if (ok) {
      // A letter still at strength 0 is being met for the first time: keying it with the code in view
      // counts. From strength 1 on, only an answer from memory makes it stronger.
      const helped = this.hintVisible() && strength(this.sv.letters, k) > 0;
      if (helped) { assisted(this.sv.letters, k); run.helped++; }
      else if (credit(this.sv.letters, k, this.sv.session, run.raised)) run.gained++;
      run.letters++; run.combo++; run.bestCombo = Math.max(run.bestCombo, run.combo);
      const mult = Math.min(4, 1 + Math.floor(run.combo / 6)) * (this.kind === "priority" || this.kind === "contact" ? 2 : 1);
      run.points += 10 * mult;
      this.burst(this.pos, 10);
      this.feedback = "";
      this.pos++; this.input = ""; this.shown = false; this.letterT = 0;
      this.lamps.flash(0.3, (e, T) => spot(e / T, dim(LAMP.green, 0.5)));
      if (this.pos >= this.word.length) this.wordDone();
      else this.c.tone(880, 0.06);
    } else {
      const heard = Object.keys(MORSE).find((key) => MORSE[key] === this.input) || "?";
      if (fault(this.sv.letters, k, this.sv.session, run.raised, run.dropped)) run.lost++;
      run.misses++; run.combo = 0;
      this.feedback = heard === "?" ? `NOT ${this.kind === "echo" ? "THE LETTER" : k} / ITS CODE IS SHOWN` : `HEARD ${heard}, NOT ${k}`;
      this.shown = true; this.missT = 0.5;
      this.left = Math.max(0.05, this.left - 1);
      this.c.tone(160, 0.2);
      const pattern = this.patternOf(MORSE[k]);
      this.lamps.flash(0.4 + pattern.reduce((s, p) => s + p.s, 0), (e) => {
        if (e < 0.4) return spot(1 - e / 0.4, dim(LAMP.red, 0.55));
        let left = e - 0.4;
        for (const p of pattern) { if (left < p.s) return p.on ? (p.dash ? fill(LAMP.cyan, 0.4) : only(1, LAMP.amber, 0.6)) : lightsOff(); left -= p.s; }
        return lightsOff();
      });
    }
  }
  patternOf(code) {
    const u = this.unit / 1000;
    return [...code].flatMap((e) => [{ on: true, dash: e === "-", s: u * (e === "." ? 1 : 3) }, { on: false, s: u }]);
  }
  wordDone() {
    const run = this.run;
    run.words++; run.cleared++;
    run.door.push(1);
    if (this.kind === "echo") run.echoes++;
    if (this.kind === "priority") run.priority++;
    if (this.kind === "contact") run.contact = true;
    const bonus = Math.round(this.left * 5 * (this.kind === "priority" ? 2 : 1) * (this.kind === "echo" ? 1.5 : 1));
    run.points += bonus;
    this.feedback = this.kind === "contact" ? `CONTACT: ${STATIONS[this.sv.stations % STATIONS.length]} / +${bonus}` : `${this.word} RECEIVED${bonus ? " / +" + bonus : ""}`;
    this.burst(this.word.length / 2, 24);
    this.c.tone(990, 0.15);
    this.lamps.flash(0.6, (e, T) => fill(LAMP.green, 0.45 * (1 - e / T)));
    if (run.cleared % 8 === 0 && this.shields < SHIELDS) { this.shields++; announce(this, "SHIELD RESTORED"); }
    this.stage = "clear"; this.wait = 0.7;
    if (run.words >= SHIFT) this.finish("opened");
  }
  timeUp() {
    const run = this.run, k = this.current();
    if (k && fault(this.sv.letters, k, this.sv.session, run.raised, run.dropped)) run.lost++;
    run.misses++; run.combo = 0; run.words++;
    run.door.push(2);
    this.shields--; run.shieldsLost++;
    this.feedback = `LOST: ${this.word}`;
    this.c.tone(110, 0.35);
    this.lamps.flash(0.8, (e) => (Math.floor(e / 0.2) % 2 === 0 ? fill(LAMP.red, 0.5) : lightsOff()));
    this.c.synth.stopTone(); this.downAt = null;
    if (this.shields <= 0 || run.words >= SHIFT) { this.finish(this.shields > 0 ? "opened" : "sealed"); return; }
    this.stage = "lost"; this.wait = 1.8;
  }
  // The end of a run: the vault seals (no shields left) or the player leaves. Strength changes are
  // already in the save; this adds the run to the record, may open the next letter, and saves.
  finish(reason) {
    const run = this.run, sv = this.sv;
    this.phase = "over"; this.overAt = this.t; this.stage = "";
    this.lit = false; this.c.synth.stopTone();
    const cpm = run.playT > 20 ? Math.round(run.letters / (run.playT / 60)) : 0;
    const accuracy = run.letters + run.misses ? Math.round((100 * run.letters) / (run.letters + run.misses)) : 0;
    // One new letter per run, once every letter in play has reached strength 2 (the newest one 1).
    let unlocked = "";
    const size = this.poolSize(), pool = this.pool();
    if (size < ORDER.length && pool.every((k, i) => strength(sv.letters, k) >= (i === pool.length - 1 ? 1 : 2))) { sv.pool = size + 1; unlocked = ORDER[size]; }
    if (reason === "opened") run.points += 100 * this.shields;
    const record = run.points > sv.best.score;
    sv.best = { score: Math.max(sv.best.score, run.points), words: Math.max(sv.best.words, run.cleared), cpm: Math.max(sv.best.cpm, cpm) };
    sv.runs += 1;
    sv.milestone = Math.max(sv.milestone, run.cleared);
    sv.last = { words: run.cleared, letters: run.letters, accuracy, cpm, score: run.points, milestone: run.cleared, reason };
    // The longer game: experience and rank, the station log, today's contract and feats.
    const before = this.rank().index;
    let xp = run.letters * 2 + run.cleared * 5 + (reason === "opened" ? 50 : 0);
    let station = "";
    if (run.contact && sv.stations < STATIONS.length) { station = STATIONS[sv.stations]; sv.stations += 1; }
    const daily = this.contract(), facts = { ...run, reason, accuracy };
    let contract = false;
    if (!daily.done && reason !== "left" && CONTRACTS[daily.id].met(facts)) { daily.done = true; contract = true; sv.contracts += 1; xp += 150; }
    sv.xp = Math.min(1e9, sv.xp + xp);
    const mastered = this.mastered(), open = this.poolSize();
    const feats = award(sv.feats, FEATS, (id) => ({
      first: reason === "opened", untouched: reason === "opened" && run.shieldsLost === 0, carrier: run.bestCombo >= 30,
      ears: run.echoes >= 8, ten: open >= 10, most: open >= 18, all: open >= 26, master: mastered >= 1, master10: mastered >= 10,
      fast: reason === "opened" && cpm >= 45, week: sv.days.streak >= 7, stations: sv.stations >= 12, contracts: sv.contracts >= 5 })[id]);
    const promoted = this.rank().index > before ? this.rank().name : "";
    this.result = { reason, cpm, accuracy, unlocked, record, xp, station, contract, feats, promoted };
    if (run.points > 0) this.c.score(run.points);
    this.c.saveProgress?.(JSON.parse(JSON.stringify(sv)))?.catch?.(this.c.error);
    this.c.hint("Tap to open the vault again. Hold for the code card.");
  }

  // ------------------------------------------------------------------------------------- input
  down() {
    this.guard.mark();
    if (this.phase === "over" && this.t - this.overAt < LOCKOUT) return;
    this.downAt = this.t; this.downOn = this.phase; this.toneCut = false;
    if (this.phase === "play" && this.stage === "send" && this.missT <= 0) { this.c.synth.startTone(600); this.gap = 0; }
  }
  up(event = {}) {
    this.guard.release();
    if (this.downAt === null) return;
    const held = (this.t - this.downAt), ms = Number.isFinite(event.durationMs) ? event.durationMs : held * 1000;
    this.downAt = null;
    // A press that began in play does nothing on the result screen it ended on.
    if (this.downOn !== this.phase && this.phase === "over") return;
    if (this.phase === "title" || this.phase === "over" || this.phase === "card") {
      // Hold: the code card, then the logbook, then back. Tap on a page goes back to the title.
      if (ms >= HOLD_PICK * 1000) {
        if (this.phase !== "card") { this.phase = "card"; this.page = "code"; }
        else if (this.page === "code") this.page = "log";
        else this.title();
      } else if (this.phase === "card") this.title();
      else this.start();
      return;
    }
    if (this.phase === "intro") { this.c.synth.stopTone(); this.nextIntro(); return; }
    if (this.phase !== "play") return;
    this.c.synth.stopTone();
    if (ms >= REPLAY_MS) {
      if (this.kind === "echo" && (this.stage === "send" || this.stage === "listen")) this.replay();
      return;
    }
    if (this.stage === "send") this.element(ms < this.dashMs ? "." : "-");
  }
  // Hear an echo transmission again; it costs a second of its timer.
  replay() {
    this.playback(this.word);
    this.stage = "listen";
    this.left = Math.max(0.05, this.left - 1);
  }
  nextIntro() {
    if (this.introAt + 1 < this.fresh.length) this.introduce(this.introAt + 1);
    else { this.lit = false; this.c.synth.stopTone(); this.nextWord(); }
  }
  cancel() {
    this.guard.rewind();
    this.releaseKey();
  }
  releaseKey() {
    this.downAt = null;
    this.c.synth.stopTone();
    this.lamps.clear();
  }
  menuActions() {
    if (this.phase !== "play" || this.kind !== "echo" || (this.stage !== "send" && this.stage !== "listen")) return [];
    return [{ label: "ECHO VAULT / PLAY THE SIGNAL AGAIN", run: () => {
      if (this.phase === "play" && this.kind === "echo") this.replay();
      this.c.resume?.();
    } }];
  }
  // Leaving through the menu keeps the score reached so far; leaving the game ends the run and saves it.
  pause() {
    this.guard.settle();
    this.downAt = null; this.c.synth.stopTone(); this.lit = false;
    if ((this.phase === "play" || this.phase === "intro") && this.run?.points > 0) this.c.score(this.run.points);
    this.lamps.sleep();
  }
  resume() {
    this.lamps.wake();
    if (this.phase === "intro") this.introduce(this.introAt);
    else if (this.phase === "play" && this.stage === "listen") this.playback(this.word);
  }
  dispose() {
    this.releaseKey();
    if (this.phase === "play" || this.phase === "intro") this.finish("left");
    this.guard.settle();
    this.c.synth.stopTone();
    this.lamps.sleep();
  }

  // ------------------------------------------------------------------------------------- time
  update(dt) {
    this.guard.tick(dt);
    this.t += dt;
    if (this.noteT > 0) this.noteT -= dt;
    if (this.downAt !== null && !this.toneCut && (this.t - this.downAt) * 1000 > this.toneCapMs) {
      this.toneCut = true; this.c.synth.stopTone();
    }
    if (this.downAt !== null && this.toneCut && this.c.menuGesture?.().armed) announce(this, "MENU GESTURE / KEEP HOLDING", 0.4);
    if (this.phase === "intro" && !this.advancePlayback(dt)) {
      this.introRest = (this.introRest || 0) + dt;
      if (this.introRest > 1.2) { this.introRest = 0; this.nextIntro(); }
    } else if (this.phase === "play") this.step(dt);
    if (this.phase === "play" || this.phase === "intro") this.sample(dt);
    this.lamps.frame(dt, this.lampValues());
    const run = this.run;
    this.c.hud(this.phase === "play" || this.phase === "intro"
      ? [["SCORE", run.points], ["COMBO", run.combo], ["SHIELDS", this.shields ? "◇".repeat(this.shields) : "0"], ["LETTERS", `${this.poolSize()} / 26`]]
      : [["LETTERS", `${this.poolSize()} / 26`], ["MASTERED", this.mastered()], ["BEST", this.sv.best.score], ["DAYS", this.sv.days.streak]]);
  }
  step(dt) {
    const run = this.run;
    run.playT += dt;
    if (this.stage === "clear" || this.stage === "lost") {
      this.wait -= dt;
      if (this.wait <= 0) this.nextWord();
      return;
    }
    if (this.stage === "listen") {
      if (!this.advancePlayback(dt)) { this.stage = "send"; this.letterT = 0; }
      return;   // the timer waits while the vault is speaking
    }
    this.left -= dt;
    this.letterT += dt;
    if (this.missT > 0) { this.missT -= dt; if (this.missT <= 0) this.input = ""; }
    if (this.downAt === null && this.gap > 0) {
      this.gap -= dt;
      if (this.gap <= 0 && this.input) this.letterDone(false);
    }
    if (this.left <= 0) this.timeUp();
  }

  // ------------------------------------------------------------------------------------- lamps
  // Playback: a dot lights the middle lamp amber, a dash all three cyan (as in Signal School).
  // Keying: lamp I amber as soon as the key is down, all three cyan once the hold is a dash.
  // Otherwise the lamps are the transmission's timer: a bar that empties, green, then amber, then a
  // pulsing red in the last quarter; violet for priority traffic. Dark on the title and result screens.
  lampValues() {
    if (this.phase === "intro" || (this.phase === "play" && this.stage === "listen"))
      return this.lit ? (this.litDash ? fill(LAMP.cyan, 0.4) : only(1, LAMP.amber, 0.6)) : null;
    if (this.phase !== "play") return null;
    if (this.downAt !== null && this.stage === "send")
      return (this.t - this.downAt) * 1000 >= this.dashMs ? fill(LAMP.cyan, 0.4) : only(0, LAMP.amber, 0.4);
    if (this.stage !== "send") return null;
    const f = clamp(this.left / (this.total || 1), 0, 1);
    const colour = this.kind === "priority" ? LAMP.violet : f > 0.5 ? LAMP.green : f > 0.25 ? LAMP.amber : LAMP.red;
    return meter(f, dim(colour, f > 0.25 ? 0.28 : 0.2 + 0.25 * pulse(this.t, 2.5)));
  }

  // ------------------------------------------------------------------------------------- effects
  // The scope: what the key (and the vault's own playback) did over the last few seconds, one sample a
  // frame: 0 silent, 1 key down (still a dot), 2 key down past the dash line, 3 the vault speaking.
  sample() {
    if (!this.trace) return;
    const keyMs = this.downAt !== null ? (this.t - this.downAt) * 1000 : -1;
    this.trace[this.traceAt] = keyMs >= 0 && this.phase === "play" && this.stage === "send" ? (keyMs >= this.dashMs ? 2 : 1) : this.lit ? 3 : 0;
    this.traceAt = (this.traceAt + 1) % TRACE;
    for (const p of this.sparks) { p.x += p.vx / 60; p.y += p.vy / 60; p.vy += 260 / 60; p.life -= 1 / 60; }
    if (this.sparks.length && this.sparks[0].life <= 0) this.sparks = this.sparks.filter((p) => p.life > 0);
  }
  // Sparks from the letter at index `at` of the word on screen.
  burst(at, n) {
    if (!this.sparks) return;
    const x = this.letterX(Math.min(this.word.length - 1, Math.max(0, at)));
    for (let i = 0; i < n && this.sparks.length < MAX_SPARKS; i++) {
      const a = this.c.rng.range(-Math.PI, 0), v = this.c.rng.range(80, 260);
      this.sparks.push({ x, y: 168, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: this.c.rng.range(0.3, 0.7) });
    }
  }
  letterX(i) {
    const n = this.word.length, step = (n > 5 ? 60 : 76) * 0.9;
    return CX - ((n - 1) * step) / 2 + i * step;
  }

  // ------------------------------------------------------------------------------------- drawing
  draw(g) {
    space(g, this.t, 0.25);
    if (this.phase === "title") return this.drawTitle(g);
    if (this.phase === "card") return this.page === "log" ? this.drawLog(g) : this.drawCard(g);
    if (this.phase === "intro") return this.drawIntro(g);
    if (this.phase === "over") return this.drawResult(g);
    this.drawPlay(g);
  }
  // Rank, experience and the bar to the next rank.
  drawRank(g, y) {
    const r = this.rank();
    text(g, `${r.name}   ${this.sv.xp} XP`, 480, y, 20, C.amber, "center");
    g.fillStyle = C.dark; g.fillRect(330, y + 16, 300, 6);
    g.fillStyle = C.amber; g.fillRect(330, y + 16, 300 * r.fraction, 6);
    if (r.next) text(g, `NEXT RANK AT ${r.next}`, 646, y + 19, 16, C.muted);
  }
  drawTitle(g) {
    this.drawDoor(g, 480, 300, 250, 0.06, this.t * 0.05, null);
    text(g, "ECHO VAULT", 480, 54, 42, C.ink, "center");
    text(g, "Morse transmissions approach. Key each word before it lands.", 480, 92, 18, C.muted, "center");
    this.drawRank(g, 124);
    this.drawWall(g, 186);
    const s = this.sv, school = schoolLetters(this.c), daily = this.contract();
    text(g, `LETTERS ${this.poolSize()} / 26   MASTERED ${this.mastered()}   STATIONS ${s.stations}   BEST ${s.best.score}`, 480, 340, 20, C.ink, "center");
    text(g, (daily.done ? "TODAY'S CONTRACT DONE: " : "TODAY: ") + CONTRACTS[daily.id].text, 480, 374, 18, daily.done ? C.muted : C.cyan, "center");
    text(g, school > s.pool ? `SIGNAL SCHOOL HAS OPENED ${school} LETTERS` : s.days.streak > 1 ? `${s.days.streak} DAYS IN A ROW` : s.days.total ? `${s.days.total} DAY${s.days.total > 1 ? "S" : ""} OF PRACTICE` : "FIRST CONTACT: FOUR LETTERS TO START",
      480, 404, 18, C.muted, "center");
    text(g, "TAP TO OPEN THE VAULT", 480, 458, 24, C.amber, "center");
    text(g, "HOLD FOR THE CODE CARD AND LOGBOOK", 480, 494, 18, C.muted, "center");
    this.drawHoldRing(g);
  }
  // The 26 letters in learning order; the bar under each is its strength (five steps).
  drawWall(g, y0) {
    const open = this.poolSize();
    for (let i = 0; i < ORDER.length; i++) {
      const k = ORDER[i], col = i % 13, row = Math.floor(i / 13), x = 156 + col * 54, y = y0 + row * 66;
      const s = strength(this.sv.letters, k), isOpen = i < open;
      if (s >= MASTERED) diamond(g, x, y, 21, C.amber);
      text(g, k, x, y, 26, !isOpen ? C.line : s >= MASTERED ? C.amber : C.ink, "center");
      for (let j = 0; j < MASTERED; j++) {
        g.fillStyle = j < s ? (s >= MASTERED ? C.amber : C.cyan) : isOpen ? C.dark : "#111c15";
        g.fillRect(x - 17 + j * 7, y + 24, 5, 8);
      }
    }
  }
  drawCard(g) {
    text(g, "CODE CARD", 480, 52, 30, C.ink, "center");
    const pool = this.pool();
    for (let i = 0; i < pool.length; i++) {
      const k = pool[i], col = i % 4, row = Math.floor(i / 4), x = 150 + col * 190, y = 104 + row * 50;
      text(g, k, x, y, 26, strength(this.sv.letters, k) >= MASTERED ? C.amber : C.ink, "center");
      drawCode(g, MORSE[k], x + 28, y, 0.8, C.cyan);
    }
    text(g, "TAP TO GO BACK / HOLD FOR THE LOGBOOK", 480, 506, 20, C.amber, "center");
  }
  // The logbook: stations worked (left) and feats (right).
  drawLog(g) {
    text(g, "LOGBOOK", 480, 44, 30, C.ink, "center");
    this.drawRank(g, 80);
    text(g, `STATIONS WORKED ${this.sv.stations} / ${STATIONS.length}`, 50, 130, 20, C.ink);
    for (let i = 0; i < STATIONS.length; i++) {
      const x = 50 + Math.floor(i / 10) * 190, y = 162 + (i % 10) * 30, got = i < this.sv.stations;
      text(g, got ? STATIONS[i] : "· · ·", x, y, 16, got ? C.cyan : C.line);
    }
    text(g, `FEATS ${this.sv.feats.length} / ${FEATS.length}`, 440, 130, 20, C.ink);
    FEATS.forEach((f, i) => {
      const got = this.sv.feats.includes(f.id), y = 160 + i * 24;
      diamond(g, 448, y, 6, got ? C.amber : C.line, got);
      text(g, f.name, 464, y, 16, got ? C.amber : C.muted);
      text(g, f.about, 650, y, 16, got ? C.muted : C.line);
    });
    text(g, `${this.sv.contracts} CONTRACTS DONE / ${this.sv.runs} SHIFTS`, 480, 486, 18, C.muted, "center");
    text(g, "TAP OR HOLD TO GO BACK", 480, 514, 18, C.amber, "center");
  }
  drawIntro(g) {
    const k = this.fresh[this.introAt] || "";
    text(g, "NEW LETTER", 480, 80, 26, C.amber, "center");
    circle(g, 480, 190, 92, C.line, false, 2);
    circle(g, 480, 190, 92 + 10 * pulse(this.t, 0.8), this.lit ? C.cyan : C.dark, false, 2);
    text(g, k, 480, 190, 120, C.ink, "center");
    drawCode(g, MORSE[k] || "", 480 - codeWidth(MORSE[k] || "", 1.6) / 2, 322, 1.6, C.cyan);
    text(g, (MORSE[k] || "").replaceAll(".", "DOT ").replaceAll("-", "DASH ").trim(), 480, 372, 22, C.muted, "center");
    this.drawScope(g, 300, 420, 360, 36);
    text(g, `${this.introAt + 1} / ${this.fresh.length}  /  TAP WHEN YOU HAVE IT`, 480, 500, 20, C.muted, "center");
  }
  // The vault door: a ring of tumblers, one per transmission of the shift (lit when cleared, red when
  // lost), the current one pulsing; it turns slowly and the shields sit at its hub.
  drawDoor(g, x, y, r, alpha, spin, run) {
    g.save(); g.globalAlpha = run ? 1 : alpha;
    circle(g, x, y, r, C.line, false, 2);
    circle(g, x, y, r * 0.62, C.line, false, 2);
    for (let i = 0; i < SHIFT; i++) {
      const a = spin + (i / SHIFT) * Math.PI * 2, state = run ? run.door[i] : 0, now = run && i === run.door.length;
      const c = state === 1 ? C.ink : state === 2 ? C.red : now ? (pulse(this.t, 2) > 0.5 ? C.amber : C.muted) : C.dark;
      line(g, x + Math.cos(a) * r * 0.72, y + Math.sin(a) * r * 0.72, x + Math.cos(a) * r * 0.92, y + Math.sin(a) * r * 0.92, c, state || now ? 4 : 3);
    }
    g.restore();
  }
  // The scope: a square wave of the key over the last seconds, amber while a press is still a dot,
  // cyan once it is a dash, dim green for the vault's own signal. A tick marks the dash line.
  drawScope(g, x0, y0, w, h) {
    g.fillStyle = "#0a120d"; g.fillRect(x0, y0 - h, w, h + 8);
    line(g, x0, y0, x0 + w, y0, C.dark, 1);
    if (!this.trace) return;
    const dx = w / TRACE, colours = [C.line, C.amber, C.cyan, "#5f8f5a"];
    let start = 0;
    for (let i = 1; i <= TRACE; i++) {
      const a = this.trace[(this.traceAt + start) % TRACE], b = i < TRACE ? this.trace[(this.traceAt + i) % TRACE] : -1;
      if (b === a) continue;
      const yy = a ? y0 - h + 6 : y0;
      line(g, x0 + start * dx, yy, x0 + i * dx, yy, colours[a], a ? 4 : 2);
      if (b >= 0) line(g, x0 + i * dx, y0, x0 + i * dx, y0 - h + 6, C.dark, 1);
      start = i;
    }
  }
  drawPlay(g) {
    const run = this.run;
    this.drawDoor(g, 112, 236, 82, 1, this.t * 0.15, run);
    for (let i = 0; i < SHIELDS; i++) diamond(g, 92 + i * 20, 236, 7, i < this.shields ? C.amber : C.line, i < this.shields);
    text(g, `${Math.min(SHIFT, run.words + 1)}/${SHIFT}`, 112, 340, 18, C.muted, "center");
    drawNote(g, this);
    const tag = { echo: "ECHO / LISTEN AND KEY BACK", priority: "PRIORITY TRAFFIC / DOUBLE POINTS", contact: `CALL SIGN / ${STATIONS[this.sv.stations % STATIONS.length]}`, plain: "TRANSMISSION" }[this.kind];
    text(g, tag, CX, 88, 22, this.kind === "priority" || this.kind === "contact" ? C.amber : this.kind === "echo" ? C.cyan : C.muted, "center");
    // The word: sent letters bright, the current one amber and underlined, the rest dim. An echo hides
    // the letters not yet sent.
    const n = this.word.length, size = n > 5 ? 60 : 76;
    for (let i = 0; i < n; i++) {
      const x = this.letterX(i), hidden = this.kind === "echo" && i >= this.pos && !(i === this.pos && this.hintVisible());
      const colour = i < this.pos ? C.ink : i === this.pos ? (this.missT > 0 ? C.red : C.amber) : C.muted;
      const lift = i === this.pos && this.stage === "send" ? -4 * pulse(this.t, 1.5) : 0;
      text(g, hidden ? "?" : this.word[i], x, 168 + lift, size, hidden ? C.line : colour, "center");
      if (i === this.pos && this.stage === "send") line(g, x - size * 0.32, 214, x + size * 0.32, 214, C.amber, 3);
    }
    for (const p of this.sparks) { g.fillStyle = p.life > 0.3 ? C.ink : C.amber; g.fillRect(p.x - 2, p.y - 2, 4, 4); }
    const k = this.current();
    if (this.stage === "listen") {
      circle(g, CX, 262, 18, this.lit ? C.ink : C.line, this.lit);
      text(g, "RECEIVING", CX, 300, 22, C.muted, "center");
    } else if (this.stage === "send" && k) {
      if (this.hintVisible()) drawCode(g, MORSE[k], CX - codeWidth(MORSE[k], 1.2) / 2, 262, 1.2, C.cyan);
      else text(g, this.kind === "echo" ? "KEY WHAT YOU HEARD" : "FROM MEMORY", CX, 262, 20, C.line, "center");
      if (this.input) drawCode(g, this.input, CX - codeWidth(this.input, 1.2) / 2, 316, 1.2, this.missT > 0 ? C.red : C.ink);
    }
    // The transmission closing on the vault: a packet runs down the carrier toward the door; when it
    // arrives the word is lost.
    const f = clamp(this.left / (this.total || 1), 0, 1), x0 = 214, x1 = 880, px = x0 + (x1 - x0) * f;
    const urgent = f > 0.5 ? C.ink : f > 0.25 ? C.amber : C.red;
    line(g, x0, 362, x1, 362, C.dark, 3);
    line(g, x0, 362, px, 362, urgent, 3);
    if (this.stage === "send" || this.stage === "listen") { diamond(g, px, 362, 10, urgent, true); circle(g, px, 362, 16 + 4 * pulse(this.t, 3), urgent, false, 1); }
    // The scope with the dash line marked at its right end, where the newest sample is.
    this.drawScope(g, 260, 432, 560, 40);
    const dashX = 820 - (this.dashMs / 1000) * 60 * (560 / TRACE);
    if (this.downAt !== null) line(g, dashX, 386, dashX, 438, C.amber, 1);
    text(g, "KEY", 240, 412, 16, C.muted, "right");
    if (this.feedback) text(g, this.feedback, CX, 480, 22, this.stage === "clear" ? C.ink : C.red, "center");
  }
  drawResult(g) {
    const r = this.result || {}, last = this.sv.last, run = this.run || {};
    this.drawDoor(g, 480, 290, 250, 0.08, this.t * 0.05, null);
    text(g, r.reason === "left" ? "TRANSMISSION ENDED" : r.reason === "opened" ? "VAULT OPENED" : "VAULT SEALED", 480, 52, 38, r.reason === "opened" ? C.ink : C.amber, "center");
    text(g, `${last.score} POINTS${r.record ? "  /  NEW BEST" : ""}   +${r.xp || 0} XP`, 480, 100, 26, C.ink, "center");
    text(g, `${last.words} WORDS   ${last.letters} LETTERS   ${last.accuracy}% CLEAN${r.cpm ? `   ${r.cpm} LETTERS A MINUTE` : ""}`, 480, 138, 20, C.ink, "center");
    text(g, `${run.gained || 0} STRONGER   ${run.lost || 0} TO REVISIT   ${run.helped || 0} WITH THE CODE SHOWN`, 480, 168, 18, C.muted, "center");
    // What this shift added to the longer game, one line each.
    const news = [];
    if (r.promoted) news.push([`PROMOTED: ${r.promoted}`, C.amber]);
    if (r.station) news.push([`CONTACT LOGGED: ${r.station}`, C.cyan]);
    if (r.contract) news.push([`CONTRACT DONE: ${CONTRACTS[this.sv.daily.id].text}  +150 XP`, C.cyan]);
    for (const name of r.feats || []) news.push([`FEAT: ${name}`, C.amber]);
    if (r.unlocked) news.push([`NEXT SHIFT: A NEW LETTER, ${r.unlocked}`, C.cyan]);
    else if (this.poolSize() < ORDER.length) {
      const weak = this.pool().filter((k) => strength(this.sv.letters, k) < 2);
      news.push([`A NEW LETTER OPENS WHEN ${weak.slice(0, 6).join(" ")}${weak.length > 6 ? " …" : ""} GROW STRONGER`, C.muted]);
    }
    this.drawWall(g, 212);
    news.slice(0, 4).forEach(([line_, colour], i) => text(g, line_, 480, 350 + i * 26, 18, colour, "center"));
    text(g, "TAP TO OPEN THE VAULT AGAIN", 480, 470, 24, C.amber, "center");
    text(g, "HOLD FOR THE CODE CARD AND LOGBOOK", 480, 504, 18, C.muted, "center");
    this.drawHoldRing(g);
  }
  // On the menu screens, a ring fills while a press becomes a hold.
  drawHoldRing(g) {
    if (this.downAt === null) return;
    const f = clamp((this.t - this.downAt) / HOLD_PICK, 0, 1);
    if (f < 0.25) return;
    g.beginPath(); g.arc(880, 70, 22, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f);
    g.lineWidth = 4; g.strokeStyle = f >= 1 ? C.amber : C.muted; g.stroke();
  }
}

// Dots and dashes drawn as shapes (no font dependence): a dot is a disc, a dash a bar three times as long.
export function codeWidth(code, scale = 1) { return [...code].reduce((w, e) => w + (e === "." ? 16 : 44) * scale, 0) + Math.max(0, code.length - 1) * 12 * scale; }
export function drawCode(g, code, x, y, scale = 1, colour = C.ink) {
  let at = x;
  for (const e of code) {
    if (e === ".") { circle(g, at + 8 * scale, y, 7 * scale, colour, true); at += 16 * scale; }
    else { line(g, at, y, at + 44 * scale, y, colour, 10 * scale); at += 44 * scale; }
    at += 12 * scale;
  }
}
