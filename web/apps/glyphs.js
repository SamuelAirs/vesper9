import { clamp } from "../engine/math.js";
import { C, text, line, circle, diamond, space } from "../engine/draw.js";
import { AppGuard } from "../engine/input.js";
import { LAMP, fill, meter, spot, dim, pulse, lightsOff } from "../engine/lightshow.js";
import { LampBus, LOCKOUT, announce, drawNote } from "./game-kit.js";
import { validRecord, tally, settle, need, strength, weightedPick, MASTERED } from "./learning.js";

// ---------------------------------------------------------------------------------------------
// Glyph Archive: learn real symbol systems one card at a time. Each wing of the archive is a deck
// (Braille letters, the Greek alphabet, chemical element symbols, the phonetic alphabet). A card
// shows a symbol and a proposed meaning: tap if they match, hold if they do not, before the card's
// time runs out. Wrong pairs are chosen to be confusable (Braille cells one dot apart, symbols that
// share a letter), so telling them apart is the skill. New entries are shown before they are asked,
// a few per session, and only once the ones already open are holding up; each entry grows stronger
// with spaced practice (web/apps/learning.js). Later cards ask the other way round (meaning first).
export const CARDS = 30;
export const SEALS = 3;
const HOLD_NO = 0.4;   // a press held this long answers NO MATCH
const HOLD_PICK = 0.5; // on the title and result screens a press this long changes the wing
const MIN_WINDOW = 2.2; // the shortest a card's time gets as a session speeds up

// Braille: dots 1-2-3 down the left column, 4-5-6 down the right; bit n-1 is dot n.
const dots = (s) => [...s].reduce((m, d) => m | (1 << (Number(d) - 1)), 0);
const BRAILLE = [["A", "1"], ["B", "12"], ["C", "14"], ["D", "145"], ["E", "15"], ["F", "124"], ["G", "1245"], ["H", "125"], ["I", "24"], ["J", "245"],
  ["K", "13"], ["L", "123"], ["M", "134"], ["N", "1345"], ["O", "135"], ["P", "1234"], ["Q", "12345"], ["R", "1235"], ["S", "234"], ["T", "2345"],
  ["U", "136"], ["V", "1236"], ["X", "1346"], ["Y", "13456"], ["Z", "1356"], ["W", "2456"]]
  .map(([k, d]) => ({ k, cell: dots(d), front: "", back: k }));
const GREEK = "ΑαALPHA ΒβBETA ΓγGAMMA ΔδDELTA ΕεEPSILON ΖζZETA ΗηETA ΘθTHETA ΙιIOTA ΚκKAPPA ΛλLAMBDA ΜμMU ΝνNU ΞξXI ΟοOMICRON ΠπPI ΡρRHO ΣσSIGMA ΤτTAU ΥυUPSILON ΦφPHI ΧχCHI ΨψPSI ΩωOMEGA"
  .split(" ").map((s) => ({ k: s.slice(2), front: s.slice(0, 2), back: s.slice(2) }));
const ELEMENTS = ("H HYDROGEN 1,He HELIUM 2,Li LITHIUM 3,Be BERYLLIUM 4,B BORON 5,C CARBON 6,N NITROGEN 7,O OXYGEN 8,F FLUORINE 9,Ne NEON 10," +
  "Na SODIUM 11,Mg MAGNESIUM 12,Al ALUMINUM 13,Si SILICON 14,P PHOSPHORUS 15,S SULFUR 16,Cl CHLORINE 17,Ar ARGON 18,K POTASSIUM 19,Ca CALCIUM 20," +
  "Fe IRON 26,Cu COPPER 29,Zn ZINC 30,Ag SILVER 47,Au GOLD 79,Sn TIN 50,Pb LEAD 82,Hg MERCURY 80,Ni NICKEL 28,Ti TITANIUM 22," +
  "Cr CHROMIUM 24,Mn MANGANESE 25,Co COBALT 27,Pt PLATINUM 78,W TUNGSTEN 74,I IODINE 53,Br BROMINE 35,Kr KRYPTON 36,Xe XENON 54,U URANIUM 92")
  .split(",").map((s) => { const [k, back, z] = s.split(" "); return { k, front: k, back, z: Number(z) }; });
const PHONETIC = "ALFA BRAVO CHARLIE DELTA ECHO FOXTROT GOLF HOTEL INDIA JULIETT KILO LIMA MIKE NOVEMBER OSCAR PAPA QUEBEC ROMEO SIERRA TANGO UNIFORM VICTOR WHISKEY XRAY YANKEE ZULU"
  .split(" ").map((w) => ({ k: w[0], front: w[0], back: w === "XRAY" ? "X-RAY" : w }));

const bits = (n) => { let c = 0; while (n) { c += n & 1; n >>= 1; } return c; };
// Each wing: its entries in teaching order, a lamp colour, and how alike two entries look (higher
// = more confusable), which picks the wrong pairing a false card offers.
export const WINGS = [
  { id: "braille", name: "BRAILLE", about: "SIX-DOT LETTERS, READ BY TOUCH", entries: BRAILLE, lamp: LAMP.amber,
    plates: [[10, "FIRST DECADE"], [10, "SECOND DECADE"], [6, "THIRD DECADE"]],
    alike: (a, b) => [8, 6, 3, 1, 1, 1, 1][bits(a.cell ^ b.cell)] || 1 },
  { id: "greek", name: "GREEK", about: "THE TWENTY-FOUR LETTERS AND THEIR NAMES", entries: GREEK, lamp: LAMP.cyan,
    plates: [[6, "ALPHA TO ZETA"], [6, "ETA TO MU"], [6, "NU TO SIGMA"], [6, "TAU TO OMEGA"]],
    alike: (a, b, i, j) => (a.back[0] === b.back[0] ? 4 : 1) + (Math.abs(i - j) <= 2 ? 2 : 0) },
  { id: "elements", name: "ELEMENTS", about: "CHEMICAL SYMBOLS AND THEIR NAMES", entries: ELEMENTS, lamp: LAMP.green,
    plates: [[10, "THE LIGHTEST"], [10, "SALTS AND STONES"], [10, "WORKED METALS"], [10, "THE DEEP SHELF"]],
    alike: (a, b) => (a.front[0] === b.front[0] ? 5 : 1) + (a.back[0] === b.back[0] ? 2 : 0) + (a.back[0] === b.front[0] || b.back[0] === a.front[0] ? 2 : 0) },
  { id: "phonetic", name: "PHONETIC", about: "THE RADIO ALPHABET, ALFA TO ZULU", entries: PHONETIC, lamp: LAMP.violet,
    plates: [[7, "ALFA TO GOLF"], [7, "HOTEL TO NOVEMBER"], [6, "OSCAR TO TANGO"], [6, "UNIFORM TO ZULU"]],
    alike: (a, b, i, j) => (Math.abs(i - j) <= 2 ? 3 : 1) },
];

// A plate is a run of entries in teaching order; it is restored when every entry on it has strength 3.
export const PLATE_STRENGTH = 3;
export function plateRanges(wing) {
  let at = 0;
  return wing.plates.map(([n, name]) => { const r = { from: at, to: at + n, name }; at += n; return r; });
}
// Feats go to the console's logbook (ctx.feat), which keeps one list for every game and shows each once.
export const FEATS = [
  { id: "first", name: "FIRST DIG" }, { id: "unbroken", name: "UNBROKEN SEALS" }, { id: "steady", name: "STEADY HAND" },
  { id: "relics", name: "RELIC HUNTER" }, { id: "plate", name: "FIRST PLATE" }, { id: "plates5", name: "FIVE PLATES" },
  { id: "wings", name: "ALL FOUR WINGS" }, { id: "braille", name: "FINGERTIPS" }, { id: "master10", name: "TEN MASTERED" },
  { id: "master50", name: "FIFTY MASTERED" },
];

// Bring any stored shape to schema 2: nothing, the first release's run record ({ schema: 1, runs, last,
// milestone } from recordRun, when this was a memory game), or schema 2 itself.
export function migrateGlyphs(raw) {
  const v = raw && typeof raw === "object" ? raw : {};
  const decks = {};
  for (const wing of WINGS) {
    const d = v.schema === 2 && v.decks?.[wing.id] && typeof v.decks[wing.id] === "object" ? v.decks[wing.id] : {};
    const items = {};
    for (const e of wing.entries) if (validRecord(d.items?.[e.k])) items[e.k] = d.items[e.k].map((n) => Math.max(0, Math.round(n)));
    decks[wing.id] = { session: Math.max(0, d.session | 0), open: clamp(d.open | 0, 0, wing.entries.length), items };
  }
  const best = v.schema === 2 && v.best ? v.best : {};
  return {
    schema: 2,
    runs: Math.max(0, v.runs | 0),
    milestone: Math.max(0, v.milestone | 0),
    last: v.last && typeof v.last === "object" ? { ...v.last } : {},
    wing: v.schema === 2 ? clamp(v.wing | 0, 0, WINGS.length - 1) : 0,
    decks,
    best: { score: Math.max(0, best.score | 0), combo: Math.max(0, best.combo | 0) },
    plates: v.schema === 2 && Array.isArray(v.plates) ? v.plates.filter((id) => typeof id === "string").slice(0, 32) : [],
  };
}

export class GlyphVault {
  constructor(ctx) {
    this.c = ctx;
    this.lamps = new LampBus(ctx);
    this.sv = migrateGlyphs(ctx.progress?.());
    this.guard = new AppGuard(this, ctx);
    this.t = 0;
    this.phase = "title";
    this.downAt = null; this.downOn = "";
    this.answered = false; this.cardT = 0;
    this.overAt = -LOCKOUT;
    this.note = ""; this.noteT = 0;
    this.result = null;
    this.title();
  }
  wing() { return WINGS[this.sv.wing] || WINGS[0]; }
  deck() { return this.sv.decks[this.wing().id]; }
  mastered(wing = this.wing()) { const d = this.sv.decks[wing.id]; return wing.entries.filter((e) => strength(d.items, e.k) >= MASTERED).length; }
  // Plates of a wing: how many entries on each have strength 3, and whether it is restored.
  plateState(wing = this.wing()) {
    const d = this.sv.decks[wing.id];
    return plateRanges(wing).map((p, i) => {
      const strong = wing.entries.slice(p.from, p.to).filter((e) => strength(d.items, e.k) >= PLATE_STRENGTH).length;
      return { ...p, strong, size: p.to - p.from, restored: this.sv.plates.includes(`${wing.id}:${i}`) };
    });
  }
  title() {
    this.phase = "title";
    this.c.hint("Tap to enter this wing. Hold for the next wing. Menu: tap, tap, hold.");
  }

  // ------------------------------------------------------------------------------------- a session
  start() {
    const wing = this.wing(), deck = this.deck();
    deck.session += 1;
    // Open new entries: four to begin with, then two more each session while every open entry has been
    // met (strength 1) and at most four are still weak (under 2).
    const opened = wing.entries.slice(0, deck.open);
    const unmet = opened.filter((e) => strength(deck.items, e.k) < 1).length, weak = opened.filter((e) => strength(deck.items, e.k) < 2).length;
    const add = deck.open === 0 ? 4 : unmet === 0 && weak <= 4 ? 2 : 0;
    this.fresh = wing.entries.slice(deck.open, deck.open + add).map((e) => e.k);
    deck.open = Math.min(wing.entries.length, deck.open + add);
    this.run = { cards: 0, right: 0, wrong: 0, combo: 0, bestCombo: 0, points: 0, tally: {}, gained: 0, lost: 0, streak: 0, timeouts: 0, picks: 0,
      sealsLost: 0, reverseRight: 0, relics: 0, relicCards: 0 };
    this.cardT = 0;
    this.seals = SEALS;
    this.window = 3.4;
    this.card = null; this.prev = "";
    this.feedback = ""; this.result = null;
    this.answered = false;
    // Each new entry is asked (as a true pair) within the first few cards.
    this.queue = this.fresh.slice();
    if (this.fresh.length) this.introduce(0); else this.nextCard();
  }
  introduce(i) {
    this.phase = "intro"; this.introAt = i; this.introT = 0;
    this.c.hint("A new entry for the archive. Tap when you have it.");
  }
  entry(k) { return this.wing().entries.find((e) => e.k === k); }
  open() { return this.wing().entries.slice(0, this.deck().open); }
  nextCard() {
    this.phase = "play";
    const wing = this.wing(), deck = this.deck(), run = this.run, open = this.open();
    const n = run.cards;
    let target = this.queue.length ? this.entry(this.queue.shift()) : null;
    if (!target) {
      const pool = open.length > 1 ? open.filter((e) => e.k !== this.prev) : open;
      target = weightedPick(this.c.rng, pool, (e) => need(deck.items, e.k, deck.session));
    }
    const fresh = strength(deck.items, target.k) === 0 && (deck.items[target.k]?.[2] || 0) === 0;
    // About half the cards are true pairs (more for weak entries, since a true pair recognised is what
    // strengthens one); an entry never answered before always comes true first.
    // From the fifth card, an entry already met may come as a "which of two" card: the symbol and two
    // meanings, tap for the upper one, hold for the lower. `truth` then says the upper one is right.
    const pick = !fresh && n >= 4 && open.length >= 3 && strength(deck.items, target.k) >= 1 && this.c.rng.next() < 0.3;
    const truth = pick ? this.c.rng.next() < 0.5 : fresh || this.c.rng.next() < (strength(deck.items, target.k) < 2 ? 0.6 : 0.5);
    let other = target;
    if (!truth || pick) {
      const all = wing.entries, ti = all.indexOf(target);
      const choices = (open.length > 2 ? open : all).filter((e) => e !== target);
      other = weightedPick(this.c.rng, choices, (e) => wing.alike(target, e, ti, all.indexOf(e)));
    }
    // From the ninth card, entries with some strength may be asked meaning first.
    const reverse = !pick && n >= 8 && strength(deck.items, target.k) >= 2 && this.c.rng.next() < 0.4;
    const relic = n > 0 && n % 10 === 9;
    this.card = { k: target.k, other: other.k, truth, reverse, relic, fresh, pick };
    this.cardT = 0;
    if (relic) run.relicCards++;
    this.prev = target.k;
    if (n === 8) announce(this, "REVERSE CARDS / MEANING FIRST");
    else if (relic) announce(this, "RELIC CARD / TRIPLE POINTS", 2);
    else if (pick && !run.pickShown) { run.pickShown = true; announce(this, "WHICH OF TWO / TAP UPPER, HOLD LOWER", 2); }
    // Weak entries get longer: recalling something half-learned takes a moment.
    const weak = strength(deck.items, target.k) < 2 ? 0.8 : 0;
    this.total = this.left = this.window + (fresh ? 1.2 : 0) + (reverse ? 0.4 : 0) + (pick ? 0.6 : 0) + weak;
    // A press still held from the last card belongs to it, not to this one.
    this.stage = "ask"; this.answered = this.downAt !== null;
    this.c.hint(pick ? "Tap: the upper meaning. Hold: the lower one." : "Tap: they match. Hold: they do not.");
  }
  // The player's verdict: true for MATCH, false for NO MATCH, null when the card ran out.
  answer(match) {
    if (this.stage !== "ask") return;
    const card = this.card, run = this.run, deck = this.deck();
    const ok = match === card.truth;
    run.cards++;
    if (ok) {
      run.right++; run.combo++; run.streak++; run.bestCombo = Math.max(run.bestCombo, run.combo);
      if (card.reverse) run.reverseRight++;
      if (card.relic) run.relics++;
      // Recognising a true pair, or picking the right meaning, is recall from memory; rejecting a false
      // pair counts as right but is weaker evidence.
      tally(deck.items, run.tally, card.k, card.truth || card.pick ? "clean" : "helped");
      run.timeouts = 0;
      if (card.pick) run.picks++;
      const mult = Math.min(4, 1 + Math.floor(run.combo / 5)) * (card.relic ? 3 : 1);
      run.points += 10 * mult + Math.round(10 * clamp(this.left / this.total, 0, 1));
      this.window = Math.max(MIN_WINDOW, this.window * 0.96);
      this.c.tone(card.truth ? 820 : 620, 0.08);
      this.lamps.flash(0.35, (e, T) => spot(e / T, dim(LAMP.green, 0.5)));
      this.feedback = card.pick ? "RIGHT" : card.truth ? "MATCH" : "NO MATCH, RIGHTLY";
      if (run.streak % 10 === 0 && this.seals < SEALS) { this.seals++; announce(this, "SEAL RESTORED"); }
    } else if (match === null && run.timeouts === 0) {
      // Running out of time is slow recall, not wrong recall: the first time-out in a row only breaks the
      // combo and shows the answer; the next one in a row costs a seal.
      run.wrong++; run.combo = 0; run.streak = 0; run.timeouts = 1;
      this.window = Math.min(3.4, this.window + 0.6);
      this.c.tone(300, 0.15);
      this.lamps.flash(0.4, (e, T) => fill(LAMP.amber, 0.3 * (1 - e / T)));
      this.feedback = "TOO SLOW / THE NEXT ONE COSTS A SEAL";
    } else {
      run.wrong++; run.combo = 0; run.streak = 0;
      if (match === null) run.timeouts++; else { run.timeouts = 0; tally(deck.items, run.tally, card.k, "miss"); }
      this.seals--; run.sealsLost++;
      this.window = Math.min(3.4, this.window + 0.6);
      this.c.tone(130, 0.25);
      this.lamps.flash(0.5, (e) => (Math.floor(e / 0.125) % 2 === 0 ? fill(LAMP.red, 0.5) : lightsOff()));
      this.feedback = match === null ? "TOO SLOW AGAIN" : card.pick ? "THE OTHER ONE" : match ? "NOT A MATCH" : "THAT WAS A MATCH";
    }
    this.stage = "show"; this.wait = ok ? 0.55 : 1.7; this.wasRight = ok; this.cardT = 0;
    if (this.seals <= 0) this.finish("sealed");
    else if (run.cards >= CARDS) this.finish("complete");
  }
  finish(reason) {
    const run = this.run, sv = this.sv, wing = this.wing();
    if (reason === "complete") run.points += 50 * this.seals;
    // Strengths change once, now, from how the whole session went for each entry.
    const settled = settle(this.deck().items, run.tally, this.deck().session);
    run.gained = settled.gained.length; run.lost = settled.revisit.length;
    this.phase = "over"; this.overAt = this.t;
    const accuracy = run.cards ? Math.round((100 * run.right) / run.cards) : 0;
    const best = run.points > sv.best.score;
    sv.best = { score: Math.max(sv.best.score, run.points), combo: Math.max(sv.best.combo, run.bestCombo) };
    sv.runs += 1;
    sv.milestone = Math.max(sv.milestone, run.right);
    sv.last = { wing: wing.name, cards: run.cards, correct: run.right, accuracy, score: run.points, milestone: run.right, reason };
    // Plates restored, and feats for the console's logbook (it keeps each once and announces new ones).
    const plates = [];
    this.plateState(wing).forEach((p, i) => {
      if (!p.restored && p.strong === p.size && sv.plates.length < 32) { sv.plates.push(`${wing.id}:${i}`); plates.push(p.name); }
    });
    const mastered = WINGS.reduce((n, w) => n + this.mastered(w), 0);
    const earned = {
      first: reason === "complete", unbroken: reason === "complete" && run.sealsLost === 0, steady: run.bestCombo >= 25,
      relics: run.relicCards >= 2 && run.relics === run.relicCards && reason === "complete", plate: sv.plates.length >= 1,
      plates5: sv.plates.length >= 5, wings: WINGS.every((w) => sv.decks[w.id].session > 0),
      braille: sv.decks.braille.open >= WINGS[0].entries.length, master10: mastered >= 10, master50: mastered >= 50 };
    for (const f of FEATS) if (earned[f.id]) this.c.feat?.(f.id, f.name);
    this.result = { reason, accuracy, best, fresh: this.fresh.length, plates };
    if (run.points > 0) this.c.score(run.points);
    this.c.saveProgress?.(JSON.parse(JSON.stringify(sv)))?.catch?.(this.c.error);
    this.c.hint("Tap to enter again. Hold for the next wing.");
  }

  // ------------------------------------------------------------------------------------- input
  down() {
    this.guard.mark();
    if (this.phase === "over" && this.t - this.overAt < LOCKOUT) return;
    this.downAt = this.t; this.downOn = this.phase;
    if (this.phase === "play" && this.stage === "ask") this.answered = false;
  }
  up(event = {}) {
    this.guard.release();
    if (this.downAt === null) return;
    const s = Number.isFinite(event.durationMs) ? event.durationMs / 1000 : this.t - this.downAt;
    this.downAt = null;
    // A press that began in play (the hold that answered the last card) does nothing on the result screen.
    if (this.downOn !== this.phase) return;
    if (this.phase === "title" || this.phase === "over") {
      // Hold: the next wing.
      if (s >= HOLD_PICK) { this.sv.wing = (this.sv.wing + 1) % WINGS.length; this.title(); }
      else this.start();
      return;
    }
    if (this.phase === "intro") { this.nextIntro(); return; }
    // A hold already answered NO MATCH when it reached HOLD_NO; a shorter press is a MATCH.
    if (this.phase === "play" && this.stage === "ask" && !this.answered && s < HOLD_NO) this.answer(true);
  }
  nextIntro() {
    if (this.introAt + 1 < this.fresh.length) this.introduce(this.introAt + 1);
    else this.nextCard();
  }
  cancel() { this.guard.rewind(); this.releaseKey(); }
  releaseKey() { this.downAt = null; this.lamps.clear(); }
  pause() {
    this.guard.settle();
    this.downAt = null;
    if ((this.phase === "play" || this.phase === "intro") && this.run?.points > 0) this.c.score(this.run.points);
    this.lamps.sleep();
  }
  resume() { this.lamps.wake(); }
  dispose() {
    this.releaseKey();
    if (this.phase === "play" || this.phase === "intro") this.finish("left");
    this.guard.settle();
    this.lamps.sleep();
  }

  // ------------------------------------------------------------------------------------- time
  update(dt) {
    this.guard.tick(dt);
    this.t += dt;
    if (this.noteT > 0) this.noteT -= dt;
    if (this.phase === "intro") {
      this.introT += dt;
      if (this.introT >= 3.2) this.nextIntro();
    } else if (this.phase === "play") {
      if (this.stage === "ask") {
        if (this.downAt !== null && !this.answered && this.t - this.downAt >= HOLD_NO) { this.answered = true; this.answer(false); }
        else {
          this.left -= dt;
          if (this.left <= 0) this.answer(null);
        }
      } else if (this.stage === "show") {
        this.wait -= dt;
        if (this.wait <= 0) this.nextCard();
      }
    }
    this.cardT += dt;
    this.lamps.frame(dt, this.lampValues());
    const run = this.run, deck = this.deck(), wing = this.wing();
    this.c.hud(this.phase === "play" || this.phase === "intro"
      ? [["CARD", `${Math.min(CARDS, run.cards + (this.stage === "ask" ? 1 : 0))} / ${CARDS}`], ["SCORE", run.points], ["COMBO", run.combo], ["SEALS", this.seals ? "◇".repeat(this.seals) : "0"]]
      : [["WING", wing.name], ["OPEN", `${deck.open} / ${wing.entries.length}`], ["MASTERED", this.mastered()], ["BEST", this.sv.best.score]]);
  }

  // ------------------------------------------------------------------------------------- lamps
  // Asking: the card's time as a bar in the wing's colour that empties left to right, pulsing red
  // in its last quarter; amber on a relic card. Holding: red fills the lamps toward NO MATCH.
  // A new entry: the wing's colour breathing. Right: a green sweep. Wrong: red blinks.
  // Dark on the title and result screens.
  lampValues() {
    if (this.phase === "intro") return fill(this.wing().lamp, 0.12 + 0.12 * pulse(this.t, 0.6));
    if (this.phase !== "play" || this.stage !== "ask") return null;
    if (this.downAt !== null) return meter((this.t - this.downAt) / HOLD_NO, dim(LAMP.red, 0.45));
    const f = clamp(this.left / (this.total || 1), 0, 1);
    if (f < 0.25) return meter(f, dim(LAMP.red, 0.2 + 0.25 * pulse(this.t, 2.5)));
    return meter(f, dim(this.card?.relic ? LAMP.amber : this.wing().lamp, 0.28));
  }

  // ------------------------------------------------------------------------------------- drawing
  draw(g) {
    space(g, this.t, 0.2);
    this.drawHall(g);
    if (this.phase === "title") return this.drawTitle(g);
    if (this.phase === "intro") return this.drawIntro(g);
    if (this.phase === "over") return this.drawResult(g);
    this.drawPlay(g);
  }
  // The archive hall behind everything: two arched pillars, shelf lines and slow dust in the light.
  drawHall(g) {
    const ink = "#1d2c21";
    for (const x of [46, 914]) {
      line(g, x - 18, 520, x - 18, 120, ink, 2); line(g, x + 18, 520, x + 18, 120, ink, 2);
      g.strokeStyle = ink; g.lineWidth = 2; g.beginPath(); g.arc(x, 120, 18, Math.PI, 0); g.stroke();
      for (let y = 170; y < 520; y += 70) line(g, x - 18, y, x + 18, y, ink, 1);
    }
    g.fillStyle = "#2c4030";
    for (let i = 0; i < 14; i++) {
      const x = 120 + ((i * 97 + this.t * (6 + (i % 4))) % 720), y = 120 + ((i * 53) % 360) + 14 * Math.sin(this.t * 0.4 + i);
      g.fillRect(x, y, 2, 2);
    }
  }
  // A symbol as the archive shows it: a Braille cell, or the text of the entry's front.
  drawFront(g, e, x, y, size, colour) {
    if (this.wing().id === "braille") return drawCell(g, e.cell, x, y, size, colour);
    text(g, e.front, x, y, size, colour, "center");
    if (e.z) text(g, String(e.z), x - size * 0.75, y - size * 0.55, Math.max(16, size * 0.25), C.muted, "center");
  }
  drawBack(g, e, x, y, size, colour) {
    text(g, e.back, x, y, e.back.length > 7 ? size * 0.6 : e.back.length > 4 ? size * 0.8 : size, colour, "center");
  }
  drawWings(g, y) {
    for (let i = 0; i < WINGS.length; i++) {
      const on = i === this.sv.wing;
      diamond(g, 420 + i * 40, y, 8, on ? C.amber : C.line, on);
    }
  }
  drawTitle(g) {
    const wing = this.wing(), deck = this.deck();
    text(g, "GLYPH ARCHIVE", 480, 44, 34, C.ink, "center");
    this.drawWings(g, 78);
    text(g, `${wing.name} WING`, 480, 110, 28, C.amber, "center");
    text(g, wing.about, 480, 140, 18, C.muted, "center");
    this.drawBoard(g, 168, 190);
    text(g, `OPEN ${deck.open} / ${wing.entries.length}   MASTERED ${this.mastered()}   PLATES ${this.plateState().filter((p) => p.restored).length} / ${wing.plates.length}   BEST ${this.sv.best.score}`,
      480, 384, 18, C.ink, "center");
    const next = this.plateState().find((p) => !p.restored);
    text(g, next ? `NEXT PLATE: ${next.name}, ${next.strong} OF ${next.size} ENTRIES AT STRENGTH ${PLATE_STRENGTH}` : "EVERY PLATE OF THIS WING IS RESTORED", 480, 414, 18, C.cyan, "center");
    text(g, deck.open ? "TAP TO ENTER THIS WING" : "TAP TO OPEN THIS WING", 480, 460, 24, C.amber, "center");
    text(g, "HOLD FOR THE NEXT WING", 480, 494, 18, C.muted, "center");
    this.drawHoldRing(g);
  }
  // Every entry of the wing, small, grouped by plate, with a five-step strength bar; entries not yet
  // open are dim, a restored plate is framed in amber.
  drawBoard(g, y0, height) {
    const wing = this.wing(), deck = this.deck(), plates = this.plateState(wing);
    const rows = plates.length, h = Math.min(64, height / rows), cols = Math.max(...plates.map((p) => p.size)), w = Math.min(60, 600 / cols);
    plates.forEach((p, r) => {
      const y = y0 + r * h + h * 0.38, x0 = 480 - (p.size * w) / 2 + w / 2 + 50;
      text(g, p.name, x0 - w / 2 - 14, y, 16, p.restored ? C.amber : C.muted, "right");
      if (p.restored) { g.strokeStyle = C.amber; g.lineWidth = 1; g.strokeRect(x0 - w / 2 - 4, y - h * 0.42, p.size * w + 8, h * 0.9); }
      for (let i = p.from; i < p.to; i++) {
        const e = wing.entries[i], x = x0 + (i - p.from) * w;
        const s = strength(deck.items, e.k), isOpen = i < deck.open, colour = !isOpen ? C.line : s >= MASTERED ? C.amber : C.ink;
        if (wing.id === "braille") drawCell(g, e.cell, x, y - 2, 0.3, colour);
        else text(g, wing.id === "greek" ? e.front[1] : e.front, x, y - 2, 20, colour, "center");
        for (let j = 0; j < MASTERED; j++) {
          g.fillStyle = j < s ? (s >= MASTERED ? C.amber : C.cyan) : isOpen ? C.dark : "#111c15";
          g.fillRect(x - 15 + j * 6, y + h * 0.3, 4, 5);
        }
      }
    });
  }
  drawIntro(g) {
    const e = this.entry(this.fresh[this.introAt]);
    if (!e) return;
    text(g, "NEW ENTRY", 480, 80, 26, C.amber, "center");
    const lift = 8 * Math.max(0, 1 - this.introT * 4);
    this.drawSlab(g, 300, 250 + lift, false);
    this.drawSlab(g, 680, 250 + lift, false);
    this.drawFront(g, e, 300, 250 + lift, this.wing().id === "braille" ? 1.3 : 96, C.ink);
    text(g, "=", 490, 250, 48, C.muted, "center");
    this.drawBack(g, e, 680, 250 + lift, 64, C.cyan);
    text(g, `${this.introAt + 1} / ${this.fresh.length}  /  TAP WHEN YOU HAVE IT`, 480, 470, 20, C.muted, "center");
  }
  // A stone slab for a card face: an outer frame, an inner line and corner studs.
  drawSlab(g, x, y, relic) {
    g.fillStyle = relic ? "#21200f" : "#121d16"; g.fillRect(x - 140, y - 105, 280, 210);
    g.strokeStyle = relic ? C.amber : C.line; g.lineWidth = 2; g.strokeRect(x - 140, y - 105, 280, 210);
    g.strokeStyle = relic ? "#6b5a34" : "#24372a"; g.lineWidth = 1; g.strokeRect(x - 130, y - 95, 260, 190);
    for (const [dx, dy] of [[-130, -95], [130, -95], [-130, 95], [130, 95]]) diamond(g, x + dx, y + dy, 4, relic ? C.amber : C.line, true);
  }
  drawPlay(g) {
    drawNote(g, this);
    const card = this.card, run = this.run;
    if (!card) return;
    text(g, `${this.wing().name}  /  CARD ${Math.min(CARDS, run.cards + (this.stage === "ask" ? 1 : 0))} OF ${CARDS}${card.relic ? "  /  RELIC" : ""}${card.reverse ? "  /  MEANING FIRST" : ""}`,
      480, 92, 20, card.relic ? C.amber : C.muted, "center");
    const target = this.entry(card.k), other = this.entry(card.other), braille = this.wing().id === "braille";
    const showing = this.stage === "show", colour = showing ? (this.wasRight ? C.ink : C.red) : C.ink;
    // A new card slides in from the right; the asked pair is symbol and proposed meaning, or (reverse)
    // meaning and proposed symbol.
    const ease = showing ? 1 : Math.min(1, this.cardT / 0.22), slide = (1 - ease) * (1 - ease) * 140;
    const lx = 290 + slide * 0.4, rx = 670 + slide;
    this.drawSlab(g, lx, 245, card.relic); this.drawSlab(g, rx, 245, card.relic);
    if (card.pick) {
      // Which of two: the symbol, and two meanings tagged with the press that picks each.
      this.drawFront(g, target, lx, 245, braille ? 1.15 : 88, C.ink);
      const upper = card.truth ? target : other, lower = card.truth ? other : target;
      [[upper, 195, "TAP"], [lower, 295, "HOLD"]].forEach(([e, y, tag]) => {
        const right = e === target, tint = showing ? (right ? C.cyan : C.line) : C.ink;
        text(g, tag, rx - 112, y, 16, showing ? C.muted : C.amber);
        this.drawBack(g, e, rx + 22, y, 40, tint);
      });
      line(g, rx - 120, 245, rx + 120, 245, "#24372a", 1);
    } else if (!card.reverse) { this.drawFront(g, target, lx, 245, braille ? 1.15 : 88, C.ink); this.drawBack(g, other, rx, 245, 60, colour); }
    else { this.drawBack(g, target, lx, 245, 60, C.ink); this.drawFront(g, other, rx, 245, braille ? 1.15 : 88, colour); }
    if (showing) {
      // The verdict stamp pops in over the gap between the slabs.
      const pop = 1 + 0.5 * Math.max(0, 1 - this.cardT * 6), mark = this.wasRight ? C.ink : C.red;
      circle(g, 480, 245, 30 * pop, mark, false, 3);
      text(g, this.wasRight ? "✓" : "✗", 480, 245, 36 * pop, mark, "center");
    } else text(g, "?", 480, 245, 44, C.amber, "center");
    if (this.stage === "ask") {
      const f = clamp(this.left / (this.total || 1), 0, 1);
      g.fillStyle = C.dark; g.fillRect(180, 378, 600, 12);
      g.fillStyle = f > 0.25 ? (card.relic ? C.amber : C.ink) : C.red; g.fillRect(180 + 300 * (1 - f), 378, 600 * f, 12);
      const hold = this.downAt !== null ? clamp((this.t - this.downAt) / HOLD_NO, 0, 1) : 0;
      text(g, card.pick ? "TAP: UPPER" : "TAP: MATCH", 330, 426, 24, hold > 0 && hold < 1 ? C.muted : C.ink, "center");
      text(g, card.pick ? "HOLD: LOWER" : "HOLD: NO MATCH", 630, 426, 24, hold > 0 ? (card.pick ? C.amber : C.red) : C.ink, "center");
      if (hold > 0) { g.fillStyle = C.red; g.fillRect(530, 446, 200 * hold, 6); }
    } else {
      text(g, this.feedback, 480, 398, 24, this.wasRight ? C.ink : C.red, "center");
      if (!this.wasRight) {
        // The correction: the asked entry with its true meaning.
        if (braille) drawCell(g, target.cell, 360, 452, 0.55, C.cyan); else text(g, target.front, 360, 452, 34, C.cyan, "center");
        text(g, "IS", 480, 452, 22, C.muted, "center");
        text(g, target.back, 600, 452, 30, C.cyan, "center");
      }
    }
    // Combo pips on the left, seals as wax discs at the bottom.
    for (let i = 0; i < 5; i++) diamond(g, 120, 330 - i * 26, 7, i < run.combo % 5 || (run.combo && run.combo % 5 === 0) ? C.amber : C.line, i < run.combo % 5);
    text(g, `×${Math.min(4, 1 + Math.floor(run.combo / 5))}`, 120, 360, 18, run.combo >= 5 ? C.amber : C.muted, "center");
    for (let i = 0; i < SEALS; i++) {
      const x = 440 + i * 40, y = 506;
      if (i < this.seals) { circle(g, x, y, 12, "#b8644c", true); circle(g, x, y, 7, "#7a3a2c", false, 2); }
      else circle(g, x, y, 12, C.line, false, 1);
    }
  }
  drawResult(g) {
    const r = this.result || {}, last = this.sv.last, run = this.run || {};
    text(g, r.reason === "complete" ? "WING CATALOGUED" : r.reason === "left" ? "ARCHIVE CLOSED" : "ARCHIVE SEALED", 480, 50, 36, r.reason === "complete" ? C.ink : C.amber, "center");
    text(g, `${last.score} POINTS${r.best ? "  /  NEW BEST" : ""}`, 480, 94, 26, C.ink, "center");
    text(g, `${last.correct} OF ${last.cards} RIGHT   ${last.accuracy}%   BEST COMBO ${run.bestCombo || 0}`, 480, 130, 20, C.ink, "center");
    text(g, `${r.fresh ? r.fresh + " NEW ENTRIES   " : ""}${run.gained || 0} STRONGER   ${run.lost || 0} TO REVISIT`, 480, 158, 18, C.muted, "center");
    this.drawBoard(g, 180, 170);
    const news = [];
    for (const name of r.plates || []) news.push([`PLATE RESTORED: ${name}`, C.amber]);
    const next = this.plateState().find((p) => !p.restored);
    if (next) news.push([`NEXT PLATE: ${next.name}, ${next.strong} OF ${next.size} ENTRIES AT STRENGTH ${PLATE_STRENGTH}`, C.cyan]);
    news.slice(0, 3).forEach(([msg, colour], i) => text(g, msg, 480, 368 + i * 24, 18, colour, "center"));
    text(g, "TAP TO ENTER AGAIN", 480, 456, 24, C.amber, "center");
    text(g, "HOLD FOR THE NEXT WING", 480, 492, 18, C.muted, "center");
    this.drawHoldRing(g);
  }
  drawHoldRing(g) {
    if (this.downAt === null) return;
    const f = clamp((this.t - this.downAt) / HOLD_PICK, 0, 1);
    if (f < 0.25) return;
    g.beginPath(); g.arc(880, 70, 22, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f);
    g.lineWidth = 4; g.strokeStyle = f >= 1 ? C.amber : C.muted; g.stroke();
  }
}

// A Braille cell centred on (x, y): raised dots filled, flat positions as small rings. `scale` 1 is a
// cell about 90 px tall.
export function drawCell(g, cell, x, y, scale = 1, colour = C.ink) {
  const dx = 18 * scale, dy = 30 * scale, r = Math.max(3, 11 * scale);
  for (let d = 0; d < 6; d++) {
    const cx = x + (d < 3 ? -dx : dx), cy = y + ((d % 3) - 1) * dy;
    if (cell & (1 << d)) circle(g, cx, cy, r, colour, true);
    else circle(g, cx, cy, Math.max(2, r * 0.35), C.line, true);
  }
}
