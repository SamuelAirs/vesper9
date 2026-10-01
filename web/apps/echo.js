import { clamp } from "../engine/math.js";
import { C, text, line, circle, diamond, space } from "../engine/draw.js";
import { AppGuard } from "../engine/input.js";
import { LAMP, fill, only, meter, spot, dim, pulse, lightsOff } from "../engine/lightshow.js";
import { LampBus, LOCKOUT, announce, drawNote } from "./game-kit.js";
import { MORSE } from "./morse.js";
import { validRecord, credit, assisted, fault, need, strength, weightedPick, localDay, practiseDay, MASTERED } from "./learning.js";

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
  title() {
    this.phase = "title";
    this.c.hint("Tap to open the vault. Hold for the code card. Menu: tap, tap, hold.");
  }

  // ------------------------------------------------------------------------------------- a run
  start() {
    this.sv.session += 1;
    this.sv.days = practiseDay(this.sv.days, this.today());
    const pool = this.pool();
    // Letters never answered yet are introduced before the first transmission.
    this.fresh = pool.filter((k) => { const r = this.sv.letters[k]; return !r || r[2] + r[3] === 0; }).slice(0, 4);
    this.run = { words: 0, letters: 0, misses: 0, helped: 0, combo: 0, bestCombo: 0, points: 0, playT: 0, raised: {}, dropped: {}, lost: 0, gained: 0, cleared: 0 };
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
    // Think time per letter shrinks from 2.6 s to 0.6 s over the shift, and the time allowed for keying
    // from 1.6 to 1.25 times the code's length at the set speed.
    const think = Math.max(0.6, 2.6 - 0.07 * n), slack = Math.max(1.25, 1.6 - 0.012 * n), u = this.unit / 1000;
    let total = 1.2 + [...this.word].reduce((s, ch) => s + think + slack * unitsOf(MORSE[ch] || "") * u, 0);
    if (this.kind === "priority") total *= 0.75;
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
      const mult = Math.min(4, 1 + Math.floor(run.combo / 6)) * (this.kind === "priority" ? 2 : 1);
      run.points += 10 * mult;
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
    const bonus = Math.round(this.left * 5 * (this.kind === "priority" ? 2 : 1) * (this.kind === "echo" ? 1.5 : 1));
    run.points += bonus;
    this.feedback = `${this.word} RECEIVED${bonus ? " / +" + bonus : ""}`;
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
    this.shields--;
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
    this.result = { reason, cpm, accuracy, unlocked, record };
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
      if (ms >= HOLD_PICK * 1000) { if (this.phase === "card") this.title(); else this.phase = "card"; }
      else if (this.phase === "card") this.title();
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

  // ------------------------------------------------------------------------------------- drawing
  draw(g) {
    space(g, this.t, 0.25);
    if (this.phase === "title") return this.drawTitle(g);
    if (this.phase === "card") return this.drawCard(g);
    if (this.phase === "intro") return this.drawIntro(g);
    if (this.phase === "over") return this.drawResult(g);
    this.drawPlay(g);
  }
  drawTitle(g) {
    text(g, "ECHO VAULT", 480, 70, 44, C.ink, "center");
    text(g, "Morse transmissions approach. Key each word before it lands.", 480, 118, 20, C.muted, "center");
    this.drawWall(g, 190);
    const s = this.sv, school = schoolLetters(this.c);
    text(g, `LETTERS ${this.poolSize()} / 26   MASTERED ${this.mastered()}   BEST ${s.best.score}${s.best.cpm ? `   ${s.best.cpm} LETTERS A MINUTE` : ""}`, 480, 352, 20, C.ink, "center");
    text(g, s.days.streak > 1 ? `${s.days.streak} DAYS IN A ROW / ${s.days.total} DAYS OF PRACTICE` : s.days.total ? `${s.days.total} DAY${s.days.total > 1 ? "S" : ""} OF PRACTICE` : "FIRST CONTACT: FOUR LETTERS TO START",
      480, 388, 20, C.muted, "center");
    if (school > s.pool) text(g, `SIGNAL SCHOOL HAS OPENED ${school} LETTERS`, 480, 420, 18, C.cyan, "center");
    text(g, "TAP TO OPEN THE VAULT", 480, 466, 24, C.amber, "center");
    text(g, "HOLD FOR THE CODE CARD", 480, 500, 18, C.muted, "center");
    this.drawHoldRing(g);
  }
  // The 26 letters in learning order; the bar under each is its strength (five steps).
  drawWall(g, y0) {
    const open = this.poolSize();
    for (let i = 0; i < ORDER.length; i++) {
      const k = ORDER[i], col = i % 13, row = Math.floor(i / 13), x = 156 + col * 54, y = y0 + row * 70;
      const s = strength(this.sv.letters, k), isOpen = i < open;
      text(g, k, x, y, 26, !isOpen ? C.line : s >= MASTERED ? C.amber : C.ink, "center");
      for (let j = 0; j < MASTERED; j++) {
        const on = j < s;
        g.fillStyle = on ? (s >= MASTERED ? C.amber : C.cyan) : isOpen ? C.dark : "#111c15";
        g.fillRect(x - 17 + j * 7, y + 22, 5, 8);
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
    text(g, "TAP TO GO BACK", 480, 506, 20, C.amber, "center");
  }
  drawIntro(g) {
    const k = this.fresh[this.introAt] || "";
    text(g, "NEW LETTER", 480, 80, 26, C.amber, "center");
    text(g, k, 480, 190, 120, C.ink, "center");
    drawCode(g, MORSE[k] || "", 480 - codeWidth(MORSE[k] || "", 1.6) / 2, 310, 1.6, C.cyan);
    text(g, (MORSE[k] || "").replaceAll(".", "DOT ").replaceAll("-", "DASH ").trim(), 480, 370, 22, C.muted, "center");
    circle(g, 480, 440, 22, this.lit ? C.ink : C.line, this.lit);
    text(g, `${this.introAt + 1} / ${this.fresh.length}  /  TAP WHEN YOU HAVE IT`, 480, 500, 20, C.muted, "center");
  }
  drawPlay(g) {
    drawNote(g, this);
    const tag = this.kind === "echo" ? "ECHO / LISTEN AND KEY BACK" : this.kind === "priority" ? "PRIORITY TRAFFIC / DOUBLE POINTS" : "TRANSMISSION";
    text(g, `${tag}  ${Math.min(SHIFT, this.run.words + 1)} / ${SHIFT}`, 480, 88, 22, this.kind === "priority" ? C.amber : this.kind === "echo" ? C.cyan : C.muted, "center");
    // The word: sent letters bright, the current one amber and underlined, the rest dim. An echo hides
    // the letters not yet sent.
    const n = this.word.length, size = n > 5 ? 60 : 76, step = size * 0.9, x0 = 480 - ((n - 1) * step) / 2;
    for (let i = 0; i < n; i++) {
      const x = x0 + i * step, hidden = this.kind === "echo" && i >= this.pos && !(i === this.pos && this.hintVisible());
      const colour = i < this.pos ? C.ink : i === this.pos ? (this.missT > 0 ? C.red : C.amber) : C.muted;
      text(g, hidden ? "?" : this.word[i], x, 168, size, hidden ? C.line : colour, "center");
      if (i === this.pos && this.stage === "send") line(g, x - size * 0.32, 214, x + size * 0.32, 214, C.amber, 3);
    }
    const k = this.current();
    if (this.stage === "listen") {
      circle(g, 480, 262, 18, this.lit ? C.ink : C.line, this.lit);
      text(g, "RECEIVING", 480, 300, 22, C.muted, "center");
    } else if (this.stage === "send" && k) {
      if (this.hintVisible()) drawCode(g, MORSE[k], 480 - codeWidth(MORSE[k], 1.2) / 2, 262, 1.2, C.cyan);
      else text(g, this.kind === "echo" ? "KEY WHAT YOU HEARD" : "FROM MEMORY", 480, 262, 20, C.line, "center");
      // What has been keyed for this letter.
      if (this.input) drawCode(g, this.input, 480 - codeWidth(this.input, 1.2) / 2, 318, 1.2, this.missT > 0 ? C.red : C.ink);
    }
    // The transmission's timer, and below it the key gauge with its dash line.
    const f = clamp(this.left / (this.total || 1), 0, 1);
    g.fillStyle = C.dark; g.fillRect(180, 368, 600, 14);
    g.fillStyle = f > 0.5 ? C.ink : f > 0.25 ? C.amber : C.red; g.fillRect(180, 368, 600 * f, 14);
    const ms = this.downAt !== null ? (this.t - this.downAt) * 1000 : 0, span = this.unit * 4;
    g.fillStyle = "#1a2a1e"; g.fillRect(330, 404, 300, 10);
    g.fillStyle = ms >= this.dashMs ? C.cyan : C.amber; g.fillRect(330, 404, Math.min(1, ms / span) * 300, 10);
    line(g, 480, 398, 480, 420, C.amber, 2);
    text(g, "DOT", 312, 409, 16, C.muted, "right"); text(g, "DASH", 648, 409, 16, C.muted);
    if (this.feedback) text(g, this.feedback, 480, 462, 22, this.stage === "clear" ? C.ink : C.red, "center");
    for (let i = 0; i < SHIELDS; i++) diamond(g, 440 + i * 40, 506, 9, i < this.shields ? C.amber : C.line, i < this.shields);
  }
  drawResult(g) {
    const r = this.result || {}, last = this.sv.last;
    text(g, r.reason === "left" ? "TRANSMISSION ENDED" : r.reason === "opened" ? "VAULT OPENED" : "VAULT SEALED", 480, 70, 40, r.reason === "opened" ? C.ink : C.amber, "center");
    text(g, `${last.score} POINTS${r.record ? "  /  NEW BEST" : ""}`, 480, 130, 30, C.ink, "center");
    text(g, `${last.words} WORDS   ${last.letters} LETTERS   ${last.accuracy}% CLEAN${r.cpm ? `   ${r.cpm} LETTERS A MINUTE` : ""}`, 480, 176, 20, C.ink, "center");
    const run = this.run || {};
    text(g, `${run.gained || 0} STRONGER   ${run.lost || 0} TO REVISIT   ${run.helped || 0} WITH THE CODE SHOWN`, 480, 210, 18, C.muted, "center");
    this.drawWall(g, 262);
    if (r.unlocked) {
      text(g, `NEXT RUN: A NEW LETTER, ${r.unlocked}`, 460, 410, 22, C.cyan, "center");
      drawCode(g, MORSE[r.unlocked], 640, 410, 0.7, C.cyan);
    }
    else if (this.poolSize() < ORDER.length) {
      const weak = this.pool().filter((k) => strength(this.sv.letters, k) < 2);
      text(g, `A NEW LETTER OPENS WHEN ${weak.slice(0, 6).join(" ")}${weak.length > 6 ? " …" : ""} GROW STRONGER`, 480, 410, 18, C.muted, "center");
    }
    text(g, "TAP TO OPEN THE VAULT AGAIN", 480, 466, 24, C.amber, "center");
    text(g, "HOLD FOR THE CODE CARD", 480, 500, 18, C.muted, "center");
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
