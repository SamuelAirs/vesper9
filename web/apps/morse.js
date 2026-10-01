import { C, text, line, circle, space } from "../engine/draw.js";
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
    this.start('guided');
  }
  get unit() { return 1200 / this.c.settings().morseWpm; }
  menuActions() {
    return ['guided', 'listen', 'review'].map(mode => ({
      label: 'SIGNAL SCHOOL / ' + { guided: 'GUIDED KEYING', listen: 'LISTEN & IDENTIFY', review: 'ADAPTIVE REVIEW' }[mode],
      run: () => { this.start(mode); this.c.resume?.(); },
    }));
  }
  start(mode) {
    this.cancel();
    this.mode = mode; this.sessionCorrect = 0; this.sessionAttempts = 0;
    this.c.controls?.(mode === 'listen' ? 'WATCH OR LISTEN · PRESS THE HIGHLIGHTED ANSWER' : 'TAP A DOT · HOLD A DASH');
    this.nextDelay = 0; this.summary = false;
    this.nextCharacter();
  }
  nextCharacter() {
    this.target = this.mode === 'review' ? reviewLetter(this.learning) : LESSONS[this.index % LESSONS.length];
    this.input = ''; this.downAt = null; this.gap = 0; this.phase = 'key';
    this.result = this.mode === 'review' ? 'Recall the signal. Weak characters return sooner.' : 'Transmit the letter above.';
    this.c.hint('Hold 3s for learning modes / menu. Dot: tap. Dash: hold briefly.');
    if (this.mode === 'listen') this.demonstrate();
  }
  demonstrate() {
    this.cancel();
    const choices = [this.target];
    while (choices.length < 4) {
      const candidate = LESSONS[this.c.rng.int(0, 25)];
      if (!choices.includes(candidate)) choices.push(candidate);
    }
    for (let i = 3; i > 0; i--) {
      const j = this.c.rng.int(0, i); [choices[i], choices[j]] = [choices[j], choices[i]];
    }
    this.choices = [...choices, 'REPLAY']; this.focus = 0; this.scan = 0;
    this.pulses = [{ on: false, seconds: .6 }];
    for (const symbol of MORSE[this.target]) {
      this.pulses.push({ on: true, seconds: this.unit / 1000 * (symbol === '.' ? 1 : 3) }, { on: false, seconds: this.unit / 1000 });
    }
    this.pulse = -1; this.pulseWait = 0; this.phase = 'signal'; this.lit = false;
    this.result = 'Watch the pulse lamp or listen. The answer stays hidden.';
    this.c.hint('After the signal, press the highlighted answer. REPLAY repeats it. Hold 3s for modes.');
  }
  down() {
    if (this.summary) { this.start(this.mode); return; }
    if (this.nextDelay > 0 || this.phase === 'signal') return;
    if (this.phase === 'choose') { this.pendingChoice = this.focus; return; }
    this.downAt = this.t; this.gap = 0;
    this.c.synth.startTone(550); this.c.leds([80, 140, 30, 80, 140, 30, 80, 140, 30]);
  }
  up(event) {
    if (this.phase === 'choose' && this.pendingChoice !== null && this.pendingChoice !== undefined) {
      const choice = this.choices[this.pendingChoice]; this.pendingChoice = null;
      if (choice === 'REPLAY') this.demonstrate(); else this.answer(choice);
      return;
    }
    if (this.downAt === null) return;
    this.downAt = null; this.c.synth.stopTone(); this.c.leds(Array(9).fill(0));
    this.input += event.durationMs < this.unit * 2 ? '.' : '-';
    this.input = this.input.slice(0, 8);
    this.gap = Math.max(this.unit * 3 / 1000, .6);
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
    if (accepted) { this.correct++; this.sessionCorrect++; if (this.mode !== 'review') this.index++; this.c.score(this.correct); }
    this.learning.index = this.index; this.learning.correct = this.correct; this.learning.attempts = this.attempts;
    this.result = accepted ? `${this.target} accepted. Signal ${MORSE[this.target]}` : `Received ${decoded}. ${this.target} is ${MORSE[this.target]}. Try again.`;
    this.c.tone(accepted ? 750 : 180, .17);
    this.nextDelay = accepted ? 1.2 : 1.8;
    this.lastAccepted = accepted;
    this.c.saveProgress(this.learning)?.catch?.(this.c.error);
  }
  cancel() {
    this.downAt = null; this.pendingChoice = null; this.input = ''; this.gap = 0;
    this.c.synth.stopTone(); this.c.leds(Array(9).fill(0)); this.lit = false;
  }
  pause() { this.cancel(); }
  resume() { if (this.mode === 'listen' && !this.summary && !(this.nextDelay > 0)) this.demonstrate(); }
  dispose() { this.cancel(); }
  update(dt) {
    this.t += dt;
    if (!this.summary) {
      if (this.nextDelay > 0) {
        this.nextDelay -= dt;
        if (this.nextDelay <= 0) {
          if (this.sessionAttempts >= 10) { this.summary = true; this.cancel(); }
          else if (this.lastAccepted || this.mode === 'review') this.nextCharacter();
          else if (this.mode === 'listen') this.demonstrate();
          else { this.input = ''; this.result = 'Try the same character again.'; }
        }
      } else if (this.phase === 'signal') {
        this.pulseWait -= dt;
        if (this.pulseWait <= 0) {
          const step = this.pulses[++this.pulse];
          this.c.synth.stopTone(); this.c.leds(Array(9).fill(0)); this.lit = false;
          if (!step) { this.phase = 'choose'; this.result = 'Press and release the highlighted answer.'; }
          else {
            this.pulseWait = step.seconds; this.lit = step.on;
            if (step.on) { this.c.synth.startTone(550); this.c.leds([0, 0, 0, 90, 160, 30, 0, 0, 0]); }
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
    this.c.hud([['MODE', this.mode.toUpperCase()], ['SESSION', `${this.sessionCorrect} / ${this.sessionAttempts}`],
      ['TOTAL', `${this.correct} / ${this.attempts}`], ['SPEED', this.c.settings().morseWpm + ' WPM']]);
  }
  draw(g) {
    space(g, this.t, .25);
    text(g, 'SIGNAL SCHOOL / ' + this.mode.toUpperCase(), 32, 32, 13, C.muted);
    if (this.summary) {
      text(g, 'FIELD LESSON COMPLETE', 480, 150, 32, C.ink, 'center');
      text(g, `${this.sessionCorrect} / 10 signals accepted`, 480, 245, 30, C.amber, 'center');
      text(g, 'Next review: ' + reviewLetter(this.learning), 480, 325, 22, C.ink, 'center');
      text(g, 'PRESS FOR ANOTHER SESSION / HOLD 3s FOR MODES', 480, 430, 15, C.muted, 'center');
      return;
    }
    if (this.mode === 'listen') {
      circle(g, 480, 170, 48, this.lit ? C.ink : C.line, this.lit);
      text(g, this.phase === 'signal' ? 'RECEIVE' : 'IDENTIFY', 480, 260, 20, C.muted, 'center');
      if (this.phase === 'choose') for (let i = 0; i < this.choices.length; i++) {
        const x = 240 + i * 120, selected = i === (this.pendingChoice ?? this.focus);
        if (selected) { g.fillStyle = C.ink; g.fillRect(x - 51, 309, 102, 62); }
        text(g, this.choices[i], x, 341, this.choices[i] === 'REPLAY' ? 16 : 31, selected ? C.bg : C.muted, 'center');
      }
    } else {
      text(g, this.target, 480, 147, 100, C.ink, 'center');
      const target = MORSE[this.target], start = 480 - (target.length - 1) * 42;
      if (this.mode === 'guided' || this.nextDelay > 0) for (let i = 0; i < target.length; i++) {
        if (target[i] === '.') circle(g, start + i * 84, 245, 7, C.amber, true);
        else line(g, start + i * 84 - 23, 245, start + i * 84 + 23, 245, C.amber, 8);
      }
      else text(g, 'RECALL FROM MEMORY', 480, 245, 16, C.muted, 'center');
      text(g, 'YOUR SIGNAL', 480, 320, 12, C.muted, 'center');
      text(g, this.input.replaceAll('.', '· ').replaceAll('-', '— ') || '…', 480, 369, 37, C.ink, 'center');
    }
    text(g, this.result, 480, 440, 16, C.muted, 'center');
    text(g, `DOT ${Math.round(this.unit)} ms / DASH ${Math.round(this.unit * 3)} ms / MENU: HOLD 3s`, 480, 503, 12, C.muted, 'center');
  }
}
