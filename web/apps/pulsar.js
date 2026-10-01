// PULSAR — a one-button rhythm game. Beats fall down three lanes toward a strike
// line; tap short beats, hold long signals from head to tail. The lane changes
// what you see, hear and which physical lamp answers (left, middle, right), not
// what you press. The music is generated: a quiet pulse plus a pentatonic
// melody that sounds when you hit a beat (a missed beat stays silent).
//
// Everything runs on the simulation clock `song` (accumulated dt). Charts are
// generated phrase by phrase from ctx.rng, in an order that does not depend on
// the player, so a seed reproduces a whole run.
import { clamp } from "../engine/math.js";
import { C, text, line, circle, diamond, space, banner } from "../engine/draw.js";
import { LAMP, lamps, dim, blend, lightsOff } from "../engine/lightshow.js";
import { recordRun } from "../engine/kit.js";

// Seconds the game assumes a press happened before the button event reached it
// (USB serial, host scheduling, one frame of simulation granularity). A press is
// judged at `song - INPUT_OFFSET`. Raise it if players feel they hit "late".
const INPUT_OFFSET = 0.04;
const APPROACH = 1.6; // seconds a beat is visible before it reaches the line
const SWELL = 0.4; // seconds the lamp swells before a beat
const HOLD_TOLERANCE = 0.22; // a hold may be released this early and still count
const LOOKAHEAD = 6; // chart is generated this far ahead of the song clock
const STRIKE_Y = 430, TOP_Y = 70;
const SPEED = (STRIKE_Y - TOP_Y) / APPROACH;
const LANE_X = [300, 480, 660];
const LANE_NAME = ["LOW", "MID", "HIGH"];
// A minor pentatonic over two octaves' worth of range: A3 C4 D4 E4 G4 A4 C5.
const SCALE = [220, 261.63, 293.66, 329.63, 392, 440, 523.25];
const LANE_OF = [0, 0, 1, 1, 2, 2, 2];
const SLOTS = 16; // half-beats per phrase (eight beats)

// Difficulty by phrase index: tempo, off-beat odds, hold odds and lengths, rests.
function spec(p) {
  const bpm = p < 2 ? 80 : p < 4 ? 84 : p < 6 ? 90 : Math.min(132, 96 + 4 * (p - 6));
  return {
    bpm,
    rest: p < 2 ? 0.25 : 0.12,
    off: p < 2 ? 0 : p < 6 ? 0.3 : Math.min(0.55, 0.35 + 0.02 * (p - 6)),
    hold: p < 4 ? 0 : 0.28,
    maxHold: p < 6 ? 3 : p < 10 ? 4 : 6,
    perfect: Math.max(0.065, 0.1 - 0.004 * p),
    good: Math.max(0.14, 0.2 - 0.006 * p),
    miss: p < 2 ? 0.06 : 0.09,
    news: p === 0 ? "QUARTER NOTES" : p === 2 ? "NEW: OFF-BEATS" : p === 4 ? "NEW: HOLD THE LONG SIGNALS"
      : p === 6 ? "TEMPO RISING" : p === 10 ? "NEW: LONGER HOLDS" : p > 6 && p % 3 === 0 ? "TEMPO UP" : "",
  };
}

export class Pulsar {
  constructor(ctx) {
    this.ctx = ctx;
    this.t = 0; // animation clock, always runs
    this.phase = "title";
    this.endedAt = -9;
    this.lastKey = "";
    this.lastHint = "";
    this.reset();
    this.setHint("Tap on the beat. Hold the long signals. Lamps swell before each beat.");
  }

  reset() {
    const bd = 60 / 80;
    this.song = -3 * bd; // three count-in ticks before the first beat at 0
    this.notes = [];
    this.beats = [];
    this.phrases = [];
    this.genEnd = 0;
    this.genIndex = 0;
    this.melody = 2;
    this.lastBeat = this.song;
    this.beatLen = bd;
    for (let i = -3; i < 0; i++) this.beats.push({ t: i * bd, accent: false });
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.stab = 1;
    this.counts = { perfect: 0, good: 0, miss: 0 };
    this.stray = 0;
    this.pressing = false;
    this.holdNote = null;
    this.flash = [null, null, null]; // per lane: { rgb, t0, dur, level }
    this.judge = null; // last judgement for the on-screen readout
    this.phraseNo = 0;
    this.cur = spec(0);
    this.frame = 0;
    this.finale = 0;
  }

  get accuracy() {
    const n = this.counts.perfect + this.counts.good + this.counts.miss;
    return n ? (this.counts.perfect + 0.6 * this.counts.good) / n : 1;
  }
  get multiplier() {
    return Math.min(4, 1 + Math.floor(this.combo / 10));
  }

  setHint(message) {
    if (message !== this.lastHint) {
      this.lastHint = message;
      this.ctx.hint(message);
    }
  }

  // ---- chart generation --------------------------------------------------

  generate() {
    const rng = this.ctx.rng;
    const index = this.genIndex++;
    const s = spec(index);
    const start = this.genEnd;
    const slot = 30 / s.bpm, beat = 60 / s.bpm;
    for (let b = 0; b < 8; b++) this.beats.push({ t: start + b * beat, accent: b % 4 === 0 });
    let busy = 0, prev = false;
    for (let k = 0; k < SLOTS - 2; k++) {
      if (k < busy) { prev = false; continue; }
      const even = k % 2 === 0;
      let place;
      if (k === 0) place = true;
      else if (even) place = rng.next() >= s.rest;
      else place = prev && rng.next() < s.off;
      prev = place;
      if (!place) continue;
      // Melody: a small random walk over the pentatonic scale.
      const step = rng.pick([-2, -1, -1, 0, 1, 1, 2]);
      let next = this.melody + step;
      if (next < 0 || next >= SCALE.length) next = this.melody - step; // bounce off the ends
      this.melody = clamp(next, 0, SCALE.length - 1);
      let len = 0;
      if (even && s.hold > 0 && k > 0 && rng.next() < s.hold) {
        const slots = rng.int(2, s.maxHold);
        if (k + slots <= SLOTS - 3) { len = slots * slot; busy = k + slots + 2; }
      }
      this.notes.push({ t: start + k * slot, len, lane: LANE_OF[this.melody], freq: SCALE[this.melody], state: "pending", q: 0 });
    }
    this.genEnd = start + SLOTS * slot;
    this.phrases.push({ start, end: this.genEnd, bpm: s.bpm, index, news: s.news });
  }

  // ---- input -------------------------------------------------------------

  down() {
    if (this.phase === "title") return this.begin();
    if (this.phase === "over") {
      if (this.t - this.endedAt > 0.8) this.begin();
      return;
    }
    if (this.phase !== "play" || this.pressing) return;
    this.pressing = true;
    const now = this.song - INPUT_OFFSET;
    const { good, perfect } = this.cur;
    let target = null;
    for (const n of this.notes) {
      if (n.state === "pending" && n.t >= now - good) { target = n; break; }
    }
    if (!target || Math.abs(now - target.t) > good) {
      // A press with no beat in reach. It costs a little once the song is
      // running, so mashing is a poor strategy but stray taps are survivable.
      if (this.song > 0) {
        this.stab = clamp(this.stab - 0.015, 0, 1);
        this.stray++;
        this.ctx.tone(70, 0.05, "square");
      }
      return;
    }
    const delta = now - target.t;
    target.q = Math.abs(delta) <= perfect ? 0 : 1;
    this.judge = { text: target.q ? "GOOD" : "PERFECT", color: target.q ? C.amber : C.ink,
      at: this.t, tag: Math.abs(delta) < 0.025 ? "" : delta < 0 ? "EARLY" : "LATE" };
    this.counts[target.q ? "good" : "perfect"]++;
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.score += (target.q ? 60 : 100) * this.multiplier;
    this.stab = clamp(this.stab + (target.q ? 0.018 : 0.03), 0, 1);
    this.flashLane(target.lane, target.q ? LAMP.amber : LAMP.green, 0.22, 1);
    if (target.len > 0) {
      target.state = "held";
      this.holdNote = target;
      this.ctx.synth.startTone(target.freq);
    } else {
      target.state = "done";
      this.ctx.tone(target.freq, 0.2, target.q ? "triangle" : "sine");
    }
  }

  up() {
    this.pressing = false;
    const n = this.holdNote;
    if (!n || this.phase !== "play") return;
    if (this.song - INPUT_OFFSET >= n.t + n.len - HOLD_TOLERANCE) this.finishHold(n);
    else this.dropHold(n, true);
  }

  cancel() {
    // Focus change or menu: drop held input without penalty and go dark.
    this.pressing = false;
    if (this.holdNote) this.dropHold(this.holdNote, false);
    this.ctx.synth?.stopTone?.();
    this.ctx.leds(lightsOff());
  }
  pause() { this.cancel(); }
  dispose() {
    this.pressing = false;
    this.holdNote = null;
    this.ctx.synth?.stopTone?.();
    this.ctx.leds(lightsOff());
  }

  begin() {
    this.reset();
    this.phase = "play";
    this.ctx.synth?.stopTone?.();
    this.setHint("Count-in. Tap when a beat reaches the line; hold long signals to their tail.");
  }

  flashLane(lane, rgb, dur, level) {
    this.flash[lane] = { rgb, t0: this.t, dur, level };
  }

  finishHold(n) {
    this.holdNote = null;
    n.state = "done";
    this.ctx.synth.stopTone();
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.score += Math.round(40 + n.len * 60) * this.multiplier;
    this.stab = clamp(this.stab + 0.03, 0, 1);
    this.flashLane(n.lane, LAMP.green, 0.2, 0.8);
    this.ctx.tone(n.freq * 2, 0.12, "sine");
  }

  dropHold(n, penalty) {
    this.holdNote = null;
    n.state = "missed";
    this.ctx.synth?.stopTone?.();
    if (!penalty) return;
    this.combo = 0;
    this.counts.miss++;
    this.stab = clamp(this.stab - 0.06, 0, 1);
    this.judge = { text: "DROPPED", color: C.red, at: this.t, tag: "" };
    this.flashLane(n.lane, LAMP.red, 0.3, 0.7);
    this.ctx.tone(110, 0.12, "square");
  }

  // ---- simulation --------------------------------------------------------

  update(dt) {
    if (!(dt > 0)) return;
    this.t += dt;
    this.frame++;
    if (this.phase === "play") this.step(dt);
    this.lampOutput();
    if (this.frame % 6 === 0) this.updateHud();
  }

  step(dt) {
    this.song += dt;
    while (this.genEnd < this.song + LOOKAHEAD) this.generate();
    // Current phrase and its windows.
    let cur = null;
    for (const p of this.phrases) if (p.start <= this.song) cur = p;
    if (cur) {
      if (cur.index !== this.phraseNo || !this.phraseSeen) {
        this.phraseSeen = true;
        this.phraseNo = cur.index;
        this.cur = spec(cur.index);
        this.curPhrase = cur;
        this.setHint("Phrase " + (cur.index + 1) + " at " + cur.bpm + " BPM. " + (cur.index < 4
          ? "Tap on the beat." : "Tap short beats, hold the long signals."));
      }
    }
    // The pulse.
    while (this.beats.length && this.beats[0].t <= this.song) {
      const b = this.beats.shift();
      this.lastBeat = b.t;
      const next = this.beats[0];
      if (next) this.beatLen = clamp(next.t - b.t, 0.2, 1.5);
      this.ctx.tone(b.accent ? 110 : 147, b.accent ? 0.12 : 0.05, "triangle");
    }
    // Beats that slipped past their window.
    const now = this.song - INPUT_OFFSET;
    for (const n of this.notes) {
      if (n.t > now) break;
      if (n.state === "pending" && n.t + this.cur.good < now) {
        n.state = "missed";
        this.combo = 0;
        this.counts.miss++;
        this.stab = clamp(this.stab - this.cur.miss, 0, 1);
        this.judge = { text: "MISS", color: C.red, at: this.t, tag: "" };
        this.flashLane(n.lane, LAMP.red, 0.3, 0.7);
        this.ctx.tone(98, 0.1, "square");
      }
    }
    // A hold completes on its own once its tail passes, even if still pressed.
    const h = this.holdNote;
    if (h && now >= h.t + h.len) this.finishHold(h);
    // Forget notes and phrases that are long gone.
    while (this.notes.length && this.notes[0].state !== "pending" && this.notes[0].state !== "held"
      && this.song - (this.notes[0].t + this.notes[0].len) > 1) this.notes.shift();
    while (this.phrases.length > 3 && this.phrases[0].end < this.song - 1) this.phrases.shift();
    if (this.stab <= 0) this.end();
  }

  end() {
    this.phase = "over";
    this.endedAt = this.t;
    this.pressing = false;
    if (this.holdNote) this.dropHold(this.holdNote, false);
    this.ctx.synth?.stopTone?.();
    const accuracy = Math.round(this.accuracy * 100);
    this.ctx.score(this.score);
    recordRun(this.ctx, { score: this.score, combo: this.maxCombo, accuracy, phrases: this.phraseNo + 1,
      milestone: this.phraseNo + 1 });
    this.ctx.tone(330, 0.2, "triangle");
    this.ctx.tone(247, 0.3, "triangle");
    this.ctx.tone(165, 0.5, "triangle");
    this.setHint("Signal lost. Press to play again.");
  }

  updateHud() {
    const key = this.phase + this.score + "/" + this.combo + "/" + Math.round(this.stab * 100) + "/" + this.ctx.best();
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.ctx.hud([
      ["SCORE", this.score],
      ["COMBO", this.combo + " x" + this.multiplier],
      ["STABILITY", Math.round(this.stab * 100) + "%"],
      ["BEST", this.ctx.best()],
    ]);
  }

  // ---- lamps -------------------------------------------------------------

  // Per lane, in priority order: result flash, held signal, swell before the
  // next beat, then a dim breath with the tempo. Swell is cyan for a tap and
  // violet for a hold, so even the kind of beat can be read from the lamp.
  laneColours() {
    const out = [LAMP.off, LAMP.off, LAMP.off];
    let base, level;
    if (this.phase === "play") {
      const phase = clamp((this.song - this.lastBeat) / this.beatLen, 0, 1);
      // Between phrases (nothing due within a second) the breath is stronger.
      let busy = false;
      for (const n of this.notes) {
        if (n.state === "held" || (n.state === "pending" && n.t - this.song < 1)) { busy = true; break; }
      }
      level = (0.03 + 0.07 * Math.exp(-phase * 4)) * (busy ? 1 : 2);
      const calm = this.stab > 0.35 ? LAMP.cyan : blend(LAMP.red, LAMP.cyan, clamp((this.stab - 0.1) / 0.25, 0, 1));
      base = dim(calm, level);
    } else {
      const wave = 0.5 - 0.5 * Math.cos(this.t * (this.phase === "title" ? 1.6 : 0.9));
      base = this.phase === "title" ? dim(LAMP.cyan, 0.03 + 0.09 * wave) : dim(LAMP.red, 0.02 + 0.06 * wave);
    }
    for (let i = 0; i < 3; i++) out[i] = base;
    if (this.phase !== "play") return out;
    const now = this.song - INPUT_OFFSET;
    const seen = [false, false, false];
    for (const n of this.notes) {
      if (seen[n.lane]) continue;
      if (n.state === "held") {
        seen[n.lane] = true;
        const left = n.t + n.len - now;
        const wobble = left < 0.3 ? (Math.floor(this.t * 14) % 2 ? 0.12 : 0.34) : 0.3 + 0.05 * Math.sin(this.t * 12);
        out[n.lane] = dim(n.q ? LAMP.amber : LAMP.green, wobble);
      } else if (n.state === "pending") {
        const ahead = n.t - now;
        if (ahead > SWELL) { if (ahead > SWELL + 1) break; continue; }
        seen[n.lane] = true;
        const k = 1 - clamp(ahead, 0, SWELL) / SWELL;
        const swell = 0.06 + 0.44 * Math.pow(k, 1.5);
        const colour = dim(n.len > 0 ? LAMP.violet : LAMP.cyan, swell);
        out[n.lane] = base.map((v, j) => Math.max(v, colour[j]));
      }
    }
    for (let i = 0; i < 3; i++) {
      const f = this.flash[i];
      if (!f) continue;
      const age = (this.t - f.t0) / f.dur;
      if (age >= 1) { this.flash[i] = null; continue; }
      out[i] = dim(f.rgb, f.level * (1 - 0.7 * age));
    }
    return out;
  }

  lampOutput() {
    this.laneNow = this.laneColours();
    this.ctx.leds(lamps(this.laneNow[0], this.laneNow[1], this.laneNow[2]));
  }

  // ---- drawing -----------------------------------------------------------

  yOf(time) {
    return STRIKE_Y - (time - this.song) * SPEED;
  }

  draw(g) {
    space(g, this.t, 0.5);
    this.drawField(g);
    if (this.phase === "title") {
      banner(g, "PULSAR", "TAP THE BEAT / HOLD THE LONG SIGNALS");
      text(g, "THE THREE LAMPS SWELL BEFORE EACH BEAT", 480, 380, 16, C.muted, "center");
      text(g, "HOLD 3 SECONDS FOR THE MENU", 480, 404, 16, C.muted, "center");
    } else if (this.phase === "play") {
      this.drawPlay(g);
    } else {
      this.drawResult(g);
    }
  }

  drawField(g) {
    const play = this.phase === "play";
    for (let i = 0; i < 3; i++) {
      const x = LANE_X[i];
      line(g, x, TOP_Y - 10, x, STRIKE_Y, C.line, 2);
    }
    if (play) {
      for (const b of this.beats) {
        const y = this.yOf(b.t);
        if (y < TOP_Y) break;
        if (y <= STRIKE_Y) line(g, 225, y, 735, y, b.accent ? "#3d5a43" : "#233929", b.accent ? 2 : 1);
      }
    }
    line(g, 215, STRIKE_Y, 745, STRIKE_Y, C.ink, 4);
    const lampsNow = this.laneNow || [LAMP.off, LAMP.off, LAMP.off];
    for (let i = 0; i < 3; i++) {
      const x = LANE_X[i], f = this.flash[i];
      circle(g, x, STRIKE_Y, 34, C.muted, false, 3);
      if (f) circle(g, x, STRIKE_Y, 34 + 14 * ((this.t - f.t0) / f.dur), "rgb(" + f.rgb.join(",") + ")", false, 4);
      text(g, LANE_NAME[i], x, STRIKE_Y + 54, 16, C.muted, "center");
      // A copy of what the physical lamp is doing, so the lamps can be learned by eye.
      const l = lampsNow[i];
      circle(g, x, STRIKE_Y + 86, 15, C.line, false, 2);
      circle(g, x, STRIKE_Y + 86, 12, "rgb(" + Math.min(255, l[0] * 3) + "," + Math.min(255, l[1] * 3) + "," + Math.min(255, l[2] * 3) + ")", true);
    }
  }

  drawPlay(g) {
    for (const n of this.notes) {
      if (n.state === "done") continue;
      const x = LANE_X[n.lane];
      const held = n.state === "held";
      const yHead = held ? STRIKE_Y : this.yOf(n.t);
      const yTail = n.len > 0 ? this.yOf(n.t + n.len) : yHead;
      if (yHead < TOP_Y - 30 && yTail < TOP_Y - 30) break;
      if (yTail > STRIKE_Y + 40) continue;
      const missed = n.state === "missed";
      g.globalAlpha = missed ? 0.35 : 1;
      if (n.len > 0) {
        const top = Math.max(yTail, TOP_Y - 20);
        g.fillStyle = held ? C.cyan : missed ? C.red : "#4b8a85";
        g.fillRect(x - 12, top, 24, Math.min(yHead, STRIKE_Y + 20) - top);
        if (yTail >= TOP_Y - 20) line(g, x - 26, yTail, x + 26, yTail, held ? C.cyan : C.muted, 3);
      }
      if (yHead >= TOP_Y - 30 && yHead < STRIKE_Y + 40) {
        diamond(g, x, yHead, 28, missed ? C.red : n.len > 0 ? C.cyan : C.ink, true);
        if (!missed) diamond(g, x, yHead, 28, C.bg, false);
      }
      g.globalAlpha = 1;
    }
    // Stability bar (left) and combo (right).
    const bx = 80, by = 120, bh = 300;
    g.strokeStyle = C.line;
    g.lineWidth = 2;
    g.strokeRect(bx, by, 30, bh);
    g.fillStyle = this.stab > 0.35 ? C.ink : C.red;
    g.fillRect(bx + 3, by + bh - 3 - (bh - 6) * this.stab, 24, (bh - 6) * this.stab);
    text(g, "STABILITY", bx + 15, by - 20, 16, C.muted, "center");
    // Phrase banner and the announcement of what is new.
    const p = this.curPhrase;
    if (p) {
      const age = this.song - p.start;
      if (p.news && age < 3 && age >= 0) {
        g.globalAlpha = clamp(3 - age, 0, 1);
        text(g, p.news, 480, 44, 24, C.amber, "center");
        g.globalAlpha = 1;
      }
    }
    if (this.song < 0) text(g, "GET READY", 480, 250, 34, C.amber, "center");
    const j = this.judge;
    if (j && this.t - j.at < 0.6) {
      g.globalAlpha = clamp(1.6 - (this.t - j.at) * 2.5, 0, 1);
      text(g, j.text, 480, STRIKE_Y - 80, 30, j.color, "center");
      if (j.tag) text(g, j.tag, 480, STRIKE_Y - 52, 22, C.muted, "center");
      g.globalAlpha = 1;
    }
  }

  drawResult(g) {
    g.fillStyle = "#0c1511f0";
    g.fillRect(190, 95, 580, 330);
    line(g, 235, 105, 725, 105, C.line, 2);
    text(g, "SIGNAL LOST", 480, 145, 40, C.red, "center");
    const rows = [["SCORE", this.score], ["BEST COMBO", this.maxCombo],
      ["ACCURACY", Math.round(this.accuracy * 100) + "%"], ["PHRASES", this.phraseNo + 1]];
    rows.forEach(([label, value], i) => {
      text(g, label, 270, 210 + i * 40, 20, C.muted);
      text(g, value, 690, 210 + i * 40, 28, C.ink, "right");
    });
    text(g, "RECORD " + this.ctx.best(), 480, 378, 22, C.amber, "center");
    if (this.t - this.endedAt > 0.8) text(g, "PRESS TO PLAY AGAIN", 480, 406, 22, C.amber, "center");
  }
}

Pulsar.INPUT_OFFSET = INPUT_OFFSET;
