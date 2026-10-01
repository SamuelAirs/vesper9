import { C, text, line, circle, space } from "../engine/draw.js";
import { LAMP, fill, only, spot, dim } from "../engine/lightshow.js";
import { LampBus } from "./games.js";
import { AppGuard } from "../engine/input.js";
export const MORSE = {
  A: ".-",
  B: "-...",
  C: "-.-.",
  D: "-..",
  E: ".",
  F: "..-.",
  G: "--.",
  H: "....",
  I: "..",
  J: ".---",
  K: "-.-",
  L: ".-..",
  M: "--",
  N: "-.",
  O: "---",
  P: ".--.",
  Q: "--.-",
  R: ".-.",
  S: "...",
  T: "-",
  U: "..-",
  V: "...-",
  W: ".--",
  X: "-..-",
  Y: "-.--",
  Z: "--..",
  1: ".----",
  2: "..---",
  3: "...--",
  4: "....-",
  5: ".....",
  6: "-....",
  7: "--...",
  8: "---..",
  9: "----.",
  0: "-----",
};
const LESSONS = [
  "E",
  "T",
  "A",
  "N",
  "I",
  "M",
  "S",
  "O",
  "R",
  "K",
  "D",
  "U",
  "G",
  "W",
  "H",
  "B",
  "F",
  "L",
  "P",
  "J",
  "C",
  "X",
  "Y",
  "Q",
  "V",
  "Z",
];
export function decodeMorse(code) {
  return Object.keys(MORSE).find((key) => MORSE[key] === code) || "?";
}
export function migrateLearning(saved = {}) {
  return { schema: 2, index: Math.max(0, saved.index || 0), correct: Math.max(0, saved.correct || 0),
    attempts: Math.max(0, saved.attempts || 0), characters: { ...(saved.characters || {}) } };
}
export function reviewLetter(progress) {
  const learned = LESSONS.filter(letter => progress.characters[letter]?.seen);
  const pool = learned.length ? learned : LESSONS.slice(0, 8);
  return pool.slice().sort((a, b) => {
    const x = progress.characters[a] || {}, y = progress.characters[b] || {};
    return (x.due || 0) - (y.due || 0) || (x.streak || 0) - (y.streak || 0) || LESSONS.indexOf(a) - LESSONS.indexOf(b);
  })[0];
}
export class MorseSchool {
  constructor(ctx) {
    this.c = ctx;
    this.learning = migrateLearning(ctx.progress());
    this.index = this.learning.index;
    this.correct = this.learning.correct;
    this.attempts = this.learning.attempts;
    this.t = 0;
    this.lamps = new LampBus(ctx);
    this.guard = new AppGuard(this, ctx);
    this.start('guided');
  }
  get unit() { return 1200 / this.c.settings().morseWpm; }
  // The longest element Morse keying means is a dash, three units. A press held past five units is no
  // element at all, so the sidetone stops there: keying "dot dot dash" at 10 wpm is never more than 360 ms
  // of tone, and a menu gesture's long press at most five units (or until the menu opens).
  get toneCapMs() { return this.unit * 5; }
  menuActions() {
    return ['guided', 'listen', 'review'].map(mode => ({
      label: 'SIGNAL SCHOOL / ' + { guided: 'GUIDED KEYING', listen: 'LISTEN & IDENTIFY', review: 'ADAPTIVE REVIEW' }[mode],
      run: () => { this.start(mode); this.c.resume?.(); },
    }));
  }
  start(mode) {
    this.clearKey();
    this.mode = mode; this.sessionCorrect = 0; this.sessionAttempts = 0;
    this.c.controls?.(mode === 'listen' ? 'WATCH OR LISTEN · PRESS THE HIGHLIGHTED ANSWER' : 'TAP A DOT · HOLD A DASH');
    this.nextDelay = 0; this.summary = false; this.run = 0;
    this.nextCharacter();
  }
  nextCharacter() {
    this.target = this.mode === 'review' ? reviewLetter(this.learning) : LESSONS[this.index % LESSONS.length];
    this.input = ''; this.downAt = null; this.gap = 0; this.phase = 'key';
    this.result = this.mode === 'review' ? 'Recall the signal. Weak characters return sooner.' : 'Transmit the letter above.';
    this.c.hint('Dot: tap. Dash: hold briefly. Menu and learning modes: tap, tap, hold.');
    if (this.mode === 'listen') this.demonstrate();
  }
  // The key-down and gap steps of a letter, one unit per dot, three per dash, one unit between.
  elements(letter) {
    return [...MORSE[letter]].flatMap((symbol) => [
      { on: true, dash: symbol === '-', seconds: this.unit / 1000 * (symbol === '.' ? 1 : 3) },
      { on: false, seconds: this.unit / 1000 }]);
  }
  demonstrate() {
    this.clearKey();
    const choices = [this.target];
    while (choices.length < 4) {
      const candidate = LESSONS[this.c.rng.int(0, 25)];
      if (!choices.includes(candidate)) choices.push(candidate);
    }
    for (let i = 3; i > 0; i--) {
      const j = this.c.rng.int(0, i); [choices[i], choices[j]] = [choices[j], choices[i]];
    }
    this.choices = [...choices, 'REPLAY']; this.focus = 0; this.scan = 0;
    this.pulses = [{ on: false, seconds: .6 }, ...this.elements(this.target)];
    this.pulse = -1; this.pulseWait = 0; this.phase = 'signal'; this.lit = false;
    this.result = 'Watch the pulse lamp or listen. The answer stays hidden.';
    this.c.hint('After the signal, press the highlighted answer. REPLAY repeats it. Modes: tap, tap, hold.');
  }
  down() {
    this.guard.mark();
    if (this.summary) { this.start(this.mode); return; }
    if (this.nextDelay > 0 || this.phase === 'signal') return;
    if (this.phase === 'choose') { this.pendingChoice = this.focus; return; }
    this.downAt = this.t; this.gap = 0; this.toneCut = false;
    this.c.synth.startTone(550);
  }
  up(event) {
    this.guard.release();
    if (this.phase === 'choose' && this.pendingChoice !== null && this.pendingChoice !== undefined) {
      const choice = this.choices[this.pendingChoice]; this.pendingChoice = null;
      if (choice === 'REPLAY') this.demonstrate(); else this.answer(choice);
      return;
    }
    if (this.downAt === null) return;
    this.downAt = null; this.c.synth.stopTone();
    this.input += event.durationMs < this.unit * 2 ? '.' : '-';
    this.input = this.input.slice(0, 8);
    this.gapTotal = this.gap = Math.max(this.unit * 3 / 1000, .6);
    this.result = 'Pause to finish this letter…';
  }
  answer(decoded) {
    this.attempts++; this.sessionAttempts++;
    const accepted = decoded === this.target;
    const old = this.learning.characters[this.target] || { seen: 0, correct: 0, streak: 0 };
    const streak = accepted ? Math.min(5, old.streak + 1) : 0;
    this.learning.characters[this.target] = { seen: old.seen + 1, correct: old.correct + Number(accepted), streak,
      due: this.attempts + (accepted ? 2 ** streak : 1) };
    // Only the modes that teach the guided sequence move its position; review answers earlier letters.
    // Guided and listen lessons move on only after the same letter is answered correctly twice in a row.
    if (accepted) {
      this.correct++; this.sessionCorrect++; this.c.score(this.correct);
      if (this.mode !== 'review' && ++this.run >= 2) { this.index++; this.run = 0; }
    } else this.run = 0;
    this.learning.index = this.index; this.learning.correct = this.correct; this.learning.attempts = this.attempts;
    this.result = accepted ? `${this.target} accepted. Signal ${MORSE[this.target]}` : `Received ${decoded}. ${this.target} is ${MORSE[this.target]} / try again.`;
    this.c.tone(accepted ? 750 : 180, .17);
    const pattern = this.elements(this.target);
    const seconds = pattern.reduce((sum, step) => sum + step.seconds, 0);
    this.nextDelay = accepted ? 1.2 : Math.max(1.8, 0.7 + seconds + 0.3);
    if (accepted && this.mode !== 'review' && this.run > 0) this.result += ' Once more to lock it in.';
    this.lampResult(accepted, pattern);
    this.lastAccepted = accepted;
    this.c.saveProgress(this.learning)?.catch?.(this.c.error);
  }
  // Right: a green sweep left to right. Wrong: a red sweep right to left, then the correct signal on
  // the middle lamp (a dot is one amber blink, a dash a long cyan one) so the lamps teach the rhythm.
  lampResult(accepted, pattern) {
    if (accepted) { this.lamps.flash(0.5, (e, T) => spot(e / T, dim(LAMP.green, 0.5))); return; }
    const sweep = 0.5, total = sweep + pattern.reduce((sum, step) => sum + step.seconds, 0);
    this.lamps.flash(total, (e) => {
      if (e < sweep) return spot(1 - e / sweep, dim(LAMP.red, 0.55));
      let left = e - sweep;
      for (const step of pattern) {
        if (left < step.seconds) return step.on ? only(1, step.dash ? LAMP.cyan : LAMP.amber, 0.6) : Array(9).fill(0);
        left -= step.seconds;
      }
      return Array(9).fill(0);
    });
  }
  // Resting light. Playback: a dot is the middle lamp in amber, a dash all three in cyan. Choosing:
  // a spot that follows the highlighted answer. Keying: lamp I (amber) as soon as the key is down; at
  // the dot/dash threshold all three turn cyan, so you see the moment a hold becomes a dash. After
  // release the lamps dim over the letter gap.
  lampValues() {
    if (this.summary) return null;
    if (this.phase === 'signal') return this.lit ? (this.litDash ? fill(LAMP.cyan, 0.4) : only(1, LAMP.amber, 0.6)) : null;
    if (this.phase === 'choose') return spot((this.pendingChoice ?? this.focus) / (this.choices.length - 1), dim(LAMP.white, 0.33));
    if (this.downAt !== null) return (this.t - this.downAt) * 1000 >= this.unit * 2 ? fill(LAMP.cyan, 0.4) : only(0, LAMP.amber, 0.4);
    if (this.gap > 0) return fill(LAMP.amber, 0.25 * Math.min(1, this.gap / (this.gapTotal || 0.6)));
    return null;
  }
  // The host's cancel: take back a menu gesture that has reached the keyer (the dots it keyed, an answer it
  // chose), then let go of the key. A letter that was half keyed stays as it was, and its pause keeps its
  // place, so opening the menu never costs the letter; the app's own restarts use clearKey().
  cancel() { this.guard.rewind(); this.releaseKey(); }
  releaseKey() {
    this.downAt = null; this.pendingChoice = null;
    this.c.synth.stopTone(); this.lamps.clear(); this.lit = false;
  }
  clearKey() { this.releaseKey(); this.input = ''; this.gap = 0; }
  pause() { this.guard.settle(); this.releaseKey(); this.lamps.sleep(); }
  resume() { this.lamps.wake(); if (this.mode === 'listen' && !this.summary && !(this.nextDelay > 0)) this.demonstrate(); }
  dispose() { this.guard.settle(); this.clearKey(); this.lamps.sleep(); }
  update(dt) {
    this.guard.tick(dt);
    this.t += dt;
    if (this.downAt !== null && !this.toneCut && (this.t - this.downAt) * 1000 > this.toneCapMs) { this.toneCut = true; this.c.synth.stopTone(); }
    if (this.downAt !== null && this.toneCut && this.c.menuGesture?.().armed) this.result = 'MENU GESTURE / KEEP HOLDING';
    if (!this.summary) {
      if (this.nextDelay > 0) {
        this.nextDelay -= dt;
        if (this.nextDelay <= 0) {
          if (this.sessionAttempts >= 10) { this.summary = true; this.clearKey(); }
          else if (this.lastAccepted || this.mode === 'review') this.nextCharacter();
          else if (this.mode === 'listen') this.demonstrate();
          else { this.input = ''; this.result = 'Try the same character again.'; }
        }
      } else if (this.phase === 'signal') {
        this.pulseWait -= dt;
        if (this.pulseWait <= 0) {
          const step = this.pulses[++this.pulse];
          this.c.synth.stopTone(); this.lit = false;
          if (!step) { this.phase = 'choose'; this.result = 'Press and release the highlighted answer.'; }
          else {
            this.pulseWait = step.seconds; this.lit = step.on; this.litDash = !!step.dash;
            if (step.on) this.c.synth.startTone(550);
          }
        }
      } else if (this.phase === 'choose' && this.pendingChoice == null) {
        const interval = (this.c.settings().scanMs || 850) / 1000;
        this.scan += dt;
        while (this.scan >= interval) { this.scan -= interval; this.focus = (this.focus + 1) % this.choices.length; }
      } else if (this.downAt === null && this.gap > 0) {
        this.gap -= dt;
        if (this.gap <= 0) this.answer(decodeMorse(this.input));
      }
    }
    this.lamps.frame(dt, this.lampValues());
    this.c.hud([['MODE', this.mode.toUpperCase()], ['SESSION', `${this.sessionCorrect} / ${this.sessionAttempts}`],
      ['TOTAL', `${this.correct} / ${this.attempts}`], ['SPEED', this.c.settings().morseWpm + ' WPM']]);
  }
  draw(g) {
    space(g, this.t, .25);
    if (this.summary) {
      text(g, 'FIELD LESSON COMPLETE', 480, 140, 36, C.ink, 'center');
      text(g, `${this.sessionCorrect} / 10 signals accepted`, 480, 225, 32, C.amber, 'center');
      text(g, `${this.index} of ${LESSONS.length} letters learned`, 480, 290, 24, C.ink, 'center');
      text(g, 'Next review: ' + reviewLetter(this.learning), 480, 340, 24, C.ink, 'center');
      text(g, 'PRESS FOR ANOTHER SESSION', 480, 430, 22, C.muted, 'center');
      text(g, 'MODES: TAP, TAP, HOLD', 480, 470, 20, C.muted, 'center');
      return;
    }
    if (this.mode === 'listen') {
      circle(g, 480, 150, 48, this.lit ? C.ink : C.line, this.lit);
      if (this.lit) line(g, 480 - 70, 235, 480 + 70, 235, this.litDash ? C.cyan : C.amber, this.litDash ? 8 : 3);
      text(g, this.phase === 'signal' ? 'RECEIVE' : 'IDENTIFY', 480, 270, 26, C.muted, 'center');
      if (this.phase === 'choose') for (let i = 0; i < this.choices.length; i++) {
        const x = 240 + i * 120, selected = i === (this.pendingChoice ?? this.focus);
        if (selected) { g.fillStyle = C.ink; g.fillRect(x - 51, 309, 102, 62); }
        text(g, this.choices[i], x, 341, this.choices[i] === 'REPLAY' ? 20 : 34, selected ? C.bg : C.muted, 'center');
      }
    } else {
      text(g, this.target, 480, 130, 100, C.ink, 'center');
      // Two pips: the letter moves on after two correct answers in a row (guided mode).
      if (this.mode === 'guided') for (let i = 0; i < 2; i++) circle(g, 600 + i * 28, 130, 9, C.amber, i < this.run);
      const target = MORSE[this.target], start = 480 - (target.length - 1) * 42;
      if (this.mode === 'guided' || this.nextDelay > 0) for (let i = 0; i < target.length; i++) {
        if (target[i] === '.') circle(g, start + i * 84, 225, 7, C.amber, true);
        else line(g, start + i * 84 - 23, 225, start + i * 84 + 23, 225, C.amber, 8);
      }
      else text(g, 'RECALL FROM MEMORY', 480, 225, 22, C.muted, 'center');
      text(g, this.input.replaceAll('.', '· ').replaceAll('-', '— ') || '…', 480, 305, 44, C.ink, 'center');
      // The hold gauge: amber is a dot, and it turns cyan at the dash line (twice the dot length).
      const x0 = 180, w = 600, span = this.unit * 4, y = 372;
      const ms = this.downAt !== null ? (this.t - this.downAt) * 1000 : 0;
      g.fillStyle = '#1a2a1e'; g.fillRect(x0, y, w, 16);
      g.fillStyle = ms >= this.unit * 2 ? C.cyan : C.amber; g.fillRect(x0, y, Math.min(1, ms / span) * w, 16);
      line(g, x0 + w / 2, y - 6, x0 + w / 2, y + 22, C.amber, 3);
      text(g, 'DOT', x0, y + 38, 18, C.muted); text(g, 'DASH', x0 + w, y + 38, 18, C.muted, 'right');
    }
    text(g, this.result, 480, 458, 22, C.ink, 'center');
    text(g, `DOT ${Math.round(this.unit)} ms / DASH ${Math.round(this.unit * 3)} ms`, 480, 508, 18, C.muted, 'center');
  }
}
