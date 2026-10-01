import { clamp } from "../engine/math.js";
import { C, text, circle, diamond, space } from "../engine/draw.js";
import { AppGuard } from "../engine/input.js";
import { LAMP, fill, meter, spot, dim, pulse, lightsOff } from "../engine/lightshow.js";
import { LampBus, LOCKOUT, announce, drawNote } from "./game-kit.js";
import { record, validRecord, credit, fault, need, strength, weightedPick, localDay, practiseDay, MASTERED } from "./learning.js";

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
    alike: (a, b) => [8, 6, 3, 1, 1, 1, 1][bits(a.cell ^ b.cell)] || 1 },
  { id: "greek", name: "GREEK", about: "THE TWENTY-FOUR LETTERS AND THEIR NAMES", entries: GREEK, lamp: LAMP.cyan,
    alike: (a, b, i, j) => (a.back[0] === b.back[0] ? 4 : 1) + (Math.abs(i - j) <= 2 ? 2 : 0) },
  { id: "elements", name: "ELEMENTS", about: "CHEMICAL SYMBOLS AND THEIR NAMES", entries: ELEMENTS, lamp: LAMP.green,
    alike: (a, b) => (a.front[0] === b.front[0] ? 5 : 1) + (a.back[0] === b.back[0] ? 2 : 0) + (a.back[0] === b.front[0] || b.back[0] === a.front[0] ? 2 : 0) },
  { id: "phonetic", name: "PHONETIC", about: "THE RADIO ALPHABET, ALFA TO ZULU", entries: PHONETIC, lamp: LAMP.violet,
    alike: (a, b, i, j) => (Math.abs(i - j) <= 2 ? 3 : 1) },
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
    days: v.schema === 2 && v.days ? { last: String(v.days.last || ""), streak: v.days.streak | 0, total: v.days.total | 0 } : { last: "", streak: 0, total: 0 },
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
    this.answered = false;
    this.overAt = -LOCKOUT;
    this.note = ""; this.noteT = 0;
    this.result = null;
    this.title();
  }
  wing() { return WINGS[this.sv.wing] || WINGS[0]; }
  deck() { return this.sv.decks[this.wing().id]; }
  mastered(wing = this.wing()) { const d = this.sv.decks[wing.id]; return wing.entries.filter((e) => strength(d.items, e.k) >= MASTERED).length; }
  title() {
    this.phase = "title";
    this.c.hint("Tap to enter this wing. Hold for the next wing. Menu: tap, tap, hold.");
  }
  today() { return localDay(); }

  // ------------------------------------------------------------------------------------- a session
  start() {
    const wing = this.wing(), deck = this.deck();
    deck.session += 1;
    this.sv.days = practiseDay(this.sv.days, this.today());
    // Open new entries: four to begin with, then two more each session while every open entry has been
    // met (strength 1) and at most four are still weak (under 2).
    const opened = wing.entries.slice(0, deck.open);
    const unmet = opened.filter((e) => strength(deck.items, e.k) < 1).length, weak = opened.filter((e) => strength(deck.items, e.k) < 2).length;
    const add = deck.open === 0 ? 4 : unmet === 0 && weak <= 4 ? 2 : 0;
    this.fresh = wing.entries.slice(deck.open, deck.open + add).map((e) => e.k);
    deck.open = Math.min(wing.entries.length, deck.open + add);
    this.run = { cards: 0, right: 0, wrong: 0, combo: 0, bestCombo: 0, points: 0, raised: {}, dropped: {}, gained: 0, lost: 0, streak: 0 };
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
    const truth = fresh || this.c.rng.next() < (strength(deck.items, target.k) < 2 ? 0.6 : 0.5);
    let other = target;
    if (!truth) {
      const all = wing.entries, ti = all.indexOf(target);
      const choices = (open.length > 2 ? open : all).filter((e) => e !== target);
      other = weightedPick(this.c.rng, choices, (e) => wing.alike(target, e, ti, all.indexOf(e)));
    }
    // From the ninth card, entries with some strength may be asked meaning first.
    const reverse = n >= 8 && strength(deck.items, target.k) >= 2 && this.c.rng.next() < 0.4;
    const relic = n > 0 && n % 10 === 9;
    this.card = { k: target.k, other: other.k, truth, reverse, relic, fresh };
    this.prev = target.k;
    if (n === 8) announce(this, "REVERSE CARDS / MEANING FIRST");
    else if (relic) announce(this, "RELIC CARD / TRIPLE POINTS", 2);
    this.total = this.left = this.window + (fresh ? 1.2 : 0) + (reverse ? 0.4 : 0);
    // A press still held from the last card belongs to it, not to this one.
    this.stage = "ask"; this.answered = this.downAt !== null;
    this.c.hint("Tap: they match. Hold: they do not.");
  }
  // The player's verdict: true for MATCH, false for NO MATCH, null when the card ran out.
  answer(match) {
    if (this.stage !== "ask") return;
    const card = this.card, run = this.run, deck = this.deck();
    const ok = match === card.truth;
    run.cards++;
    if (ok) {
      run.right++; run.combo++; run.streak++; run.bestCombo = Math.max(run.bestCombo, run.combo);
      // A true pair recognised is the evidence that strengthens an entry; a false pair rejected only counts.
      if (card.truth && credit(deck.items, card.k, deck.session, run.raised)) run.gained++;
      else if (!card.truth) record(deck.items, card.k)[2] += 1;
      const mult = Math.min(4, 1 + Math.floor(run.combo / 5)) * (card.relic ? 3 : 1);
      run.points += 10 * mult + Math.round(10 * clamp(this.left / this.total, 0, 1));
      this.window = Math.max(1.5, this.window * 0.96);
      this.c.tone(card.truth ? 820 : 620, 0.08);
      this.lamps.flash(0.35, (e, T) => spot(e / T, dim(LAMP.green, 0.5)));
      this.feedback = card.truth ? "MATCH" : "NO MATCH, RIGHTLY";
      if (run.streak % 10 === 0 && this.seals < SEALS) { this.seals++; announce(this, "SEAL RESTORED"); }
    } else {
      run.wrong++; run.combo = 0; run.streak = 0;
      if (fault(deck.items, card.k, deck.session, run.raised, run.dropped)) run.lost++;
      this.seals--;
      this.window = Math.min(3.4, this.window + 0.6);
      this.c.tone(130, 0.25);
      this.lamps.flash(0.5, (e) => (Math.floor(e / 0.125) % 2 === 0 ? fill(LAMP.red, 0.5) : lightsOff()));
      this.feedback = match === null ? "TOO SLOW" : match ? "NOT A MATCH" : "THAT WAS A MATCH";
    }
    this.stage = "show"; this.wait = ok ? 0.55 : 1.7; this.wasRight = ok;
    if (this.seals <= 0) this.finish("sealed");
    else if (run.cards >= CARDS) this.finish("complete");
  }
  finish(reason) {
    const run = this.run, sv = this.sv, wing = this.wing();
    if (reason === "complete") run.points += 50 * this.seals;
    this.phase = "over"; this.overAt = this.t;
    const accuracy = run.cards ? Math.round((100 * run.right) / run.cards) : 0;
    const best = run.points > sv.best.score;
    sv.best = { score: Math.max(sv.best.score, run.points), combo: Math.max(sv.best.combo, run.bestCombo) };
    sv.runs += 1;
    sv.milestone = Math.max(sv.milestone, run.right);
    sv.last = { wing: wing.name, cards: run.cards, correct: run.right, accuracy, score: run.points, milestone: run.right, reason };
    this.result = { reason, accuracy, best, fresh: this.fresh.length };
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
    if (this.phase === "title") return this.drawTitle(g);
    if (this.phase === "intro") return this.drawIntro(g);
    if (this.phase === "over") return this.drawResult(g);
    this.drawPlay(g);
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
  drawTitle(g) {
    const wing = this.wing(), deck = this.deck();
    text(g, "GLYPH ARCHIVE", 480, 52, 36, C.ink, "center");
    for (let i = 0; i < WINGS.length; i++) diamond(g, 420 + i * 40, 92, 8, i === this.sv.wing ? C.amber : C.line, i === this.sv.wing);
    text(g, `${wing.name} WING`, 480, 130, 30, C.amber, "center");
    text(g, wing.about, 480, 164, 18, C.muted, "center");
    this.drawBoard(g, 200, 160);
    text(g, `OPEN ${deck.open} / ${wing.entries.length}   MASTERED ${this.mastered()}   BEST ${this.sv.best.score}` +
      (this.sv.days.streak > 1 ? `   ${this.sv.days.streak} DAYS IN A ROW` : ""), 480, 400, 20, C.ink, "center");
    text(g, deck.open ? "TAP TO ENTER THIS WING" : "TAP TO OPEN THIS WING", 480, 456, 24, C.amber, "center");
    text(g, "HOLD FOR THE NEXT WING", 480, 492, 18, C.muted, "center");
    this.drawHoldRing(g);
  }
  // Every entry of the wing, small, with a five-step strength bar; entries not yet open are dim.
  drawBoard(g, y0, height) {
    const wing = this.wing(), deck = this.deck(), n = wing.entries.length;
    const cols = n > 26 ? 10 : 13, rows = Math.ceil(n / cols), w = 660 / cols, h = Math.min(80, height / rows);
    for (let i = 0; i < n; i++) {
      const e = wing.entries[i], x = 150 + (i % cols) * w + w / 2, y = y0 + Math.floor(i / cols) * h + h * 0.35;
      const s = strength(deck.items, e.k), isOpen = i < deck.open, colour = !isOpen ? C.line : s >= MASTERED ? C.amber : C.ink;
      if (wing.id === "braille") drawCell(g, e.cell, x, y, 0.32, colour);
      else text(g, wing.id === "greek" ? e.front[1] : e.front, x, y, 22, colour, "center");
      for (let j = 0; j < MASTERED; j++) {
        g.fillStyle = j < s ? (s >= MASTERED ? C.amber : C.cyan) : isOpen ? C.dark : "#111c15";
        g.fillRect(x - 17 + j * 7, y + h * 0.42, 5, 6);
      }
    }
  }
  drawIntro(g) {
    const e = this.entry(this.fresh[this.introAt]);
    if (!e) return;
    text(g, "NEW ENTRY", 480, 80, 26, C.amber, "center");
    this.drawFront(g, e, 300, 250, this.wing().id === "braille" ? 1.3 : 96, C.ink);
    text(g, "=", 480, 250, 48, C.muted, "center");
    this.drawBack(g, e, 680, 250, 64, C.cyan);
    text(g, `${this.introAt + 1} / ${this.fresh.length}  /  TAP WHEN YOU HAVE IT`, 480, 470, 20, C.muted, "center");
  }
  drawPlay(g) {
    drawNote(g, this);
    const card = this.card, run = this.run;
    if (!card) return;
    text(g, `${this.wing().name}  /  CARD ${Math.min(CARDS, run.cards + (this.stage === "ask" ? 1 : 0))} OF ${CARDS}${card.relic ? "  /  RELIC" : ""}${card.reverse ? "  /  MEANING FIRST" : ""}`,
      480, 92, 20, card.relic ? C.amber : C.muted, "center");
    const target = this.entry(card.k), other = this.entry(card.other), braille = this.wing().id === "braille";
    const showing = this.stage === "show", colour = showing ? (this.wasRight ? C.ink : C.red) : C.ink;
    // The asked pair: symbol and proposed meaning, or (reverse) meaning and proposed symbol.
    g.strokeStyle = C.line; g.lineWidth = 2;
    g.strokeRect(150, 140, 280, 210); g.strokeRect(530, 140, 280, 210);
    if (!card.reverse) { this.drawFront(g, target, 290, 245, braille ? 1.15 : 88, C.ink); this.drawBack(g, other, 670, 245, 60, colour); }
    else { this.drawBack(g, target, 290, 245, 60, C.ink); this.drawFront(g, other, 670, 245, braille ? 1.15 : 88, colour); }
    text(g, showing ? (this.wasRight ? "✓" : "✗") : "?", 480, 245, 44, showing ? (this.wasRight ? C.ink : C.red) : C.amber, "center");
    if (this.stage === "ask") {
      const f = clamp(this.left / (this.total || 1), 0, 1);
      g.fillStyle = C.dark; g.fillRect(180, 378, 600, 14);
      g.fillStyle = f > 0.25 ? (card.relic ? C.amber : C.ink) : C.red; g.fillRect(180, 378, 600 * f, 14);
      const hold = this.downAt !== null ? clamp((this.t - this.downAt) / HOLD_NO, 0, 1) : 0;
      text(g, "TAP: MATCH", 330, 430, 24, hold > 0 && hold < 1 ? C.muted : C.ink, "center");
      text(g, "HOLD: NO MATCH", 630, 430, 24, hold > 0 ? C.red : C.ink, "center");
      if (hold > 0) { g.fillStyle = C.red; g.fillRect(530, 450, 200 * hold, 6); }
    } else {
      text(g, this.feedback, 480, 400, 24, this.wasRight ? C.ink : C.red, "center");
      if (!this.wasRight) {
        // The correction: the asked entry with its true meaning.
        const fx = 360, bx = 600;
        if (braille) drawCell(g, target.cell, fx, 460, 0.55, C.cyan); else text(g, target.front, fx, 460, 34, C.cyan, "center");
        text(g, "IS", 480, 460, 22, C.muted, "center");
        text(g, target.back, bx, 460, 30, C.cyan, "center");
      }
    }
    for (let i = 0; i < SEALS; i++) diamond(g, 440 + i * 40, 512, 9, i < this.seals ? C.amber : C.line, i < this.seals);
  }
  drawResult(g) {
    const r = this.result || {}, last = this.sv.last, run = this.run || {};
    text(g, r.reason === "complete" ? "WING CATALOGUED" : r.reason === "left" ? "ARCHIVE CLOSED" : "ARCHIVE SEALED", 480, 60, 38, r.reason === "complete" ? C.ink : C.amber, "center");
    text(g, `${last.score} POINTS${r.best ? "  /  NEW BEST" : ""}`, 480, 114, 28, C.ink, "center");
    text(g, `${last.correct} OF ${last.cards} RIGHT   ${last.accuracy}%   BEST COMBO ${run.bestCombo || 0}`, 480, 154, 20, C.ink, "center");
    text(g, `${r.fresh ? r.fresh + " NEW ENTRIES   " : ""}${run.gained || 0} STRONGER   ${run.lost || 0} TO REVISIT`, 480, 186, 18, C.muted, "center");
    this.drawBoard(g, 222, 150);
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
