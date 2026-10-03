import { C, text, line, diamond } from "../engine/draw.js";
import { clamp } from "../engine/math.js";
import { AppGuard } from "../engine/input.js";
import { latencySec } from "../engine/latency.js";
import { drawRowList, drawNoticePanel } from "./reader-kit.js";

// Original two-lane synth charts. No chords, no random chart changes, and no
// spacing below 400 ms: the acoustic detector has a 150 ms onset refractory.
// These are generous musical judgments in browser time, not node-clock trials.
export const HIT_WINDOW = 0.18, CENTER_WINDOW = 0.08, MIN_NOTE_GAP = 0.4;
export const CASE_DELAYS = [0, 50, 100, 150, 200];
export const LEVELS = [
  { name: "FIRST CONTACT", bpm: 72, bars: 4, division: 1, motifs: ["LRLR"], lesson: "Alternate left and right on the pulse." },
  { name: "DOUBLE SIGNAL", bpm: 80, bars: 5, division: 1, motifs: ["LLRR"], lesson: "Two on the left, two on the right. Keep the pulse." },
  { name: "QUIET ORBIT", bpm: 88, bars: 6, division: 1, motifs: ["LR.LR.RL"], lesson: "Let the empty beats pass. Silence is part of the groove." },
  { name: "SPLIT PULSE", bpm: 72, bars: 6, division: 2, motifs: ["L.R.LRLR"], lesson: "Count one-and-two-and. The small ticks split the beat." },
  { name: "MIRROR ARRAY", bpm: 70, bars: 6, division: 2, motifs: ["LR.LRR.L", "RL.RLL.R"], lesson: "Mirrored phrases. Watch the lane, not just the alternation." },
  { name: "OFFWORLD", bpm: 72, bars: 7, division: 2, motifs: ["L.RL.RLR", "R.LR.LRL"], lesson: "Between-beat entries. Stay with the quiet conductor." },
  { name: "LONG TRANSMISSION", bpm: 74, bars: 8, division: 2, motifs: ["LRLR.RL.", "RLRL.LR."], lesson: "Longer phrases, with room to breathe at the end." },
  { name: "TWIN SUNS", bpm: 75, bars: 8, division: 2, motifs: ["LRLLR.RL", "RLRRL.LR", "L.RLRR.L", "R.LRLL.R"], lesson: "Every skill together. Read ahead and finish the transmission." },
];
export const modeName = (mode) => mode === "sides" ? "TWO-SIDE" : "RHYTHM ASSIST";
const MEDALS = ["UNPLAYED", "BRONZE", "SILVER", "GOLD"];
const int = (v, max, fallback = 0) => Number.isInteger(v) && v >= 0 && v <= max ? v : fallback;

export function makeChart(level = 0) {
  const i = int(level, LEVELS.length - 1), spec = LEVELS[i], period = 60 / spec.bpm, notes = [];
  const steps = spec.bars * 4 * spec.division;
  for (let step = 0; step < steps; step++) {
    const phrase = Math.floor(step / (4 * spec.division));
    const motif = spec.motifs[phrase % spec.motifs.length], symbol = motif[step % motif.length];
    if (symbol === ".") continue;
    notes.push({ at: step * period / spec.division, side: symbol === "L" ? "left" : "right", accent: step % (4 * spec.division) === 0, beat: step / spec.division });
  }
  return { level: i, bpm: spec.bpm, period, beats: spec.bars * 4, notes, length: spec.bars * 4 * period };
}

export function sanitizeTwinbeat(raw) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const careers = {};
  for (const mode of ["assist", "sides"]) {
    const entries = Array.isArray(r.careers?.[mode]) ? r.careers[mode] : [];
    careers[mode] = LEVELS.map((_, i) => {
      const e = entries[i] || {}, accuracy = int(e.accuracy, 100);
      const cleared = e.cleared === true && accuracy >= 75;
      return { cleared, best: int(e.best, 10000), accuracy, medal: cleared ? Math.max(1, int(e.medal, 3)) : 0, runs: int(e.runs, 999999) };
    });
    // A corrupted detached late-level clear cannot jump the campaign ladder.
    let locked = false;
    for (const entry of careers[mode]) { if (locked) { entry.cleared = false; entry.medal = 0; } if (!entry.cleared) locked = true; }
  }
  const out = { v: 1, mode: r.mode === "sides" ? "sides" : "assist", caseOffsetMs: CASE_DELAYS.includes(r.caseOffsetMs) ? r.caseOffsetMs : 100,
    careers, runs: int(r.runs, 999999), milestone: 0, last: null };
  out.milestone = Math.max(unlockedLevel(out, "sides"), unlockedLevel(out, "assist"));
  if (r.last && typeof r.last === "object") out.last = { level: int(r.last.level, 7), mode: r.last.mode === "sides" ? "sides" : "assist", score: int(r.last.score, 10000), accuracy: int(r.last.accuracy, 100), medal: int(r.last.medal, 3), reason: r.last.reason === "cleared" ? "cleared" : "retry" };
  return out;
}
export function unlockedLevel(save, mode) {
  let level = 0;
  while (level < LEVELS.length - 1 && save.careers[mode][level].cleared) level++;
  return level;
}

// Select exactly one unresolved note by time before checking its side. A wrong
// side cannot skip the intended note to claim another lane. Windows never overlap.
export function judgeNote(notes, judgements, at, side, mode) {
  if (!Number.isFinite(at)) return { kind: "ignore", index: -1 };
  let index = -1, distance = Infinity;
  for (let i = 0; i < notes.length; i++) {
    const gap = Math.abs(at - notes[i].at);
    if (judgements[i] === null && gap <= HIT_WINDOW + 1e-9 && gap < distance) { index = i; distance = gap; }
  }
  if (index < 0) return { kind: "empty", index };
  if (mode === "sides" && side !== "left" && side !== "right") return { kind: "unsure", index };
  if (mode === "sides" && notes[index].side !== side) return { kind: "wrong", index };
  return { kind: distance <= CENTER_WINDOW + 1e-9 ? "center" : "close", index, error: at - notes[index].at };
}
export function gradeRun(stats, count) {
  const accuracy = Math.floor(100 * stats.hits / Math.max(1, count + stats.faults));
  const score = Math.round(clamp((stats.points - stats.faults * 35) / Math.max(1, count * 100), 0, 1) * 10000);
  const medal = accuracy < 75 ? 0 : accuracy === 100 && stats.center >= Math.ceil(count * 0.8) ? 3 : accuracy >= 90 && stats.center >= Math.ceil(count * 0.5) ? 2 : 1;
  return { accuracy, score, medal, cleared: medal > 0 };
}

// Output and lifecycle bookkeeping stay outside AppGuard's plain-data snapshot.
// A menu clears every owned light; resume supplies a fresh two-beat lead without
// advancing or rewriting the frozen chart. No timers or async audio callbacks.
class TwinbeatOutput {
  constructor(ctx) { this.c = ctx; this.live = true; this.dead = false; this.resumeLeft = 0; this.resumeBeat = -1; this.left = 0; this.right = 0; this.accent = 0; this.key = ""; this.boardKey = ""; }
  clear() { this.left = this.right = this.accent = 0; this.key = this.boardKey = ""; this.c.leds?.(Array((this.c.lampCount?.() === 4 ? 4 : 3) * 3).fill(0)); this.c.board?.([0, 0, 0]); }
  sleep() { this.clear(); this.live = false; this.resumeLeft = 0; }
  wake(period, playing) { if (this.dead) return; this.live = true; this.resumeLeft = playing ? 2 * period : 0; this.resumeBeat = -1; }
  cue(side, accent = false) { if (side === "left") this.left = 1; else if (side === "right") this.right = 1; if (accent) this.accent = 1; }
  frame(dt) {
    if (!this.live || this.dead) return;
    this.left = Math.max(0, this.left - dt * 4); this.right = Math.max(0, this.right - dt * 4); this.accent = Math.max(0, this.accent - dt * 5);
    const left = [24, 190, 200], right = [230, 130, 36], count = this.c.lampCount?.() === 4 ? 4 : 3;
    const values = [];
    for (let i = 0; i < count; i++) {
      const side = count === 4 ? i < 2 ? "left" : "right" : i === 0 ? "left" : i === 2 ? "right" : "middle";
      const level = side === "left" ? this.left : side === "right" ? this.right : Math.max(this.left, this.right) * 0.3;
      const colour = side === "right" ? right : left;
      values.push(...colour.map((v) => Math.round(v * level / 8) * 8));
    }
    const key = values.join(); if (key !== this.key) { this.key = key; this.c.leds?.(values); }
    const board = [Math.round(this.accent * 40), Math.round(this.accent * 30), 0], bk = board.join();
    if (bk !== this.boardKey) { this.boardKey = bk; this.c.board?.(board); }
  }
}

export class Twinbeat {
  static saveSlots = true;
  slotSummary(raw) { const s = sanitizeTwinbeat(raw); return "SIDE " + (unlockedLevel(s, "sides") + 1) + " / ASSIST " + (unlockedLevel(s, "assist") + 1); }
  constructor(ctx) {
    this.c = ctx; const raw = ctx.progress?.(); this.save = sanitizeTwinbeat(raw);
    this.mode = raw?.mode === "assist" || raw?.mode === "sides" ? this.save.mode : this.sidesAvailable() ? "sides" : "assist";
    if (this.mode === "sides" && !this.sidesAvailable()) this.mode = "assist";
    this.phase = "home"; this.cursor = 0; this.guidePage = 0; this.level = unlockedLevel(this.save, this.mode); this.practice = false;
    this.t = 0; this.songTime = 0; this.held = false; this.hold = 0; this.chart = null; this.judgements = [];
    this.stats = this.emptyStats(); this.result = null; this.nextBeat = -4; this.nextTone = 0;
    this.lastInputTime = -1e9; this.recentInputs = []; this.feedback = ""; this.feedbackUntil = 0;
    this.message = this.mode === "sides" ? "Two lanes. Two hands. Read ahead and meet the strike line." : "Assist plays every chart with any case tap or the button.";
    this.output = new TwinbeatOutput(ctx); this.guard = new AppGuard(this, ctx);
    ctx.daily?.("Clear a TWINBEAT campaign chart in either input mode. Practice does not count.");
    this.controls();
  }
  emptyStats() { return { hits: 0, center: 0, misses: 0, faults: 0, combo: 0, maxCombo: 0, points: 0 }; }
  settings() { return this.c.settings?.() || this.c.state?.()?.settings || {}; }
  sidesAvailable() {
    if (this.settings().tapMode !== "sides") return false;
    if (this.c.simulated?.() === true) return true;
    const state = this.c.state?.()?.tapDirection;
    return state?.ready === true && state?.available !== false && state?.enabled !== false;
  }
  controls() { this.c.controls?.(this.phase === "play" ? this.mode === "sides" ? "LEFT / RIGHT CASE TAP · J / L ON KEYBOARD" : "ANY CASE TAP / SPACE · RHYTHM ASSIST" : "TAP: NEXT · HOLD RELEASE: SELECT · CASE: PREVIOUS"); this.c.hint?.(this.message); }
  go(phase) { this.phase = phase; this.cursor = 0; this.held = false; this.hold = 0; this.controls(); }
  rows() {
    const far = unlockedLevel(this.save, this.mode);
    if (this.phase === "home") return [
      { label: "START CAMPAIGN · LEVEL " + (far + 1), sub: modeName(this.mode) + " · " + LEVELS[far].name, run: () => this.start(far) },
      { label: "CHART SELECT / MEDALS", sub: "REPLAY CLEARED CHARTS. GOLD: 100% ACCURACY, 80% CENTER.", run: () => { this.practice = false; this.go("songs"); } },
      { label: "PRACTICE STUDIO", sub: "EVERY CHART · NO SCORES, UNLOCKS OR CAREER SAVES", run: () => { this.practice = true; this.go("songs"); } },
      { label: "INPUT MODE · " + modeName(this.mode), sub: this.sidesAvailable() ? "TWO-SIDE AND ASSIST KEEP SEPARATE CAREERS" : "TWO-SIDE: CALIBRATION > TAP DIRECTION > TAP MODE", run: () => this.cycleMode() },
      { label: "CASE DELAY ESTIMATE · " + this.save.caseOffsetMs + " MS", sub: "NODE CASE TAPS ONLY · PROVISIONAL, NOT A MEASUREMENT", run: () => { this.save.caseOffsetMs = CASE_DELAYS[(CASE_DELAYS.indexOf(this.save.caseOffsetMs) + 1) % CASE_DELAYS.length]; this.persist(); } },
      { label: "FIELD MANUAL", sub: "LANES, ACCURACY, INPUT AND CALIBRATION", run: () => { this.guidePage = 0; this.go("guide"); } },
      { label: "RETURN TO DASHBOARD", run: () => this.c.home?.() },
    ];
    if (this.phase === "songs") return [...LEVELS.map((spec, i) => {
      const record = this.save.careers[this.mode][i], locked = !this.practice && i > far;
      return { label: (i + 1) + " · " + spec.name + (locked ? " · LOCKED" : ""), muted: locked,
        sub: locked ? "CLEAR THE PREVIOUS CHART TO OPEN THIS SIGNAL" : this.practice ? spec.lesson : MEDALS[record.medal] + " · BEST " + record.best + "/10000 · " + record.accuracy + "% ACCURACY",
        run: () => { if (!locked) this.start(i, this.practice); } };
    }), { label: "BACK TO CONSOLE", run: () => this.go("home") }];
    if (this.phase === "guide") return [{ label: this.guidePage ? "CONTROLS PAGE" : "SCORING / TIMING PAGE", run: () => { this.guidePage = 1 - this.guidePage; } }, { label: "BACK TO CONSOLE", run: () => this.go("home") }];
    if (this.phase === "result") return [
      ...(this.result?.cleared && !this.practice && this.level < 7 ? [{ label: "NEXT SIGNAL · " + LEVELS[this.level + 1].name, run: () => this.start(this.level + 1) }] : []),
      { label: "REPLAY THIS CHART", sub: this.practice ? "PRACTICE · NO CAREER REWARDS" : "CHASE A HIGHER MEDAL", run: () => this.start(this.level, this.practice) },
      { label: "CHART SELECT", run: () => this.go("songs") },
      { label: "BACK TO CONSOLE", run: () => this.go("home") },
    ];
    return [];
  }
  cycleMode() {
    if (this.mode === "sides") this.mode = "assist";
    else if (this.sidesAvailable()) this.mode = "sides";
    else { this.message = "Enable calibrated left/right in Calibration > Tap direction > Tap mode. Assist works now."; this.controls(); return; }
    this.save.mode = this.mode; this.level = unlockedLevel(this.save, this.mode); this.message = modeName(this.mode) + ": an independent campaign and score record."; this.persist(); this.controls();
  }
  persist() { this.save = sanitizeTwinbeat(this.save); this.c.saveProgress?.(structuredClone(this.save), { label: this.slotSummary(this.save) })?.catch?.(this.c.error); }
  start(level = 0, practice = false) {
    const i = int(level, 7);
    if (this.output.dead || !practice && i > unlockedLevel(this.save, this.mode)) return false;
    if (this.mode === "sides" && !this.sidesAvailable()) { this.message = "Two-side input is unavailable. Choose Rhythm Assist or calibrate case sides."; this.go("home"); return false; }
    this.level = i; this.practice = practice === true; this.chart = makeChart(i); this.songTime = -4 * this.chart.period;
    this.judgements = this.chart.notes.map(() => null); this.stats = this.emptyStats(); this.result = null;
    this.nextBeat = -4; this.nextTone = 0; this.lastInputTime = -1e9; this.recentInputs = []; this.feedback = ""; this.feedbackUntil = 0;
    this.output.resumeLeft = 0; this.output.clear();
    this.message = LEVELS[i].lesson; this.go("play"); return true;
  }
  down(event = {}) {
    if (!this.output.live || this.output.dead || this.held || event.repeat) return;
    this.guard.mark(); this.held = true; this.hold = 0;
    if (this.phase === "play" && this.mode === "assist") this.strike(null, event, "button");
    else if (this.phase === "play" && this.songTime >= -HIT_WINDOW && this.output.resumeLeft <= 0) this.say("BUTTON: ASSIST IS IN THE CONSOLE MENU");
  }
  up(event = {}) {
    this.guard.release(); if (!this.held) return; this.held = false;
    const duration = Number.isFinite(event.durationMs) ? event.durationMs : this.hold * 1000; this.hold = 0;
    if (this.phase === "play") return;
    const rows = this.rows();
    if (duration >= (this.settings().holdMs || 650)) rows[this.cursor]?.run();
    else this.cursor = (this.cursor + 1) % Math.max(1, rows.length);
  }
  knock(event = {}) {
    if (!this.output.live || this.output.dead || this.held) return;
    if (this.phase === "play") this.strike(event.side, event, "case");
    else { const n = this.rows().length; this.cursor = n ? (this.cursor + (this.settings().tapMode === "sides" && event.side === "right" ? 1 : n - 1)) % n : 0; }
  }
  say(value) { this.feedback = value; this.feedbackUntil = this.t + 0.8; }
  strike(side, event = {}, kind = "case") {
    if (this.phase !== "play" || this.songTime < -HIT_WINDOW || this.output.resumeLeft > 0) return { kind: "ignore" };
    // Only equal event identities are compared. at_us is never mapped onto song
    // time. The bounded ring rejects transport duplicates without owning a clock.
    const identity = Number.isFinite(event.at_us) ? [kind, event.source || "local", event.generation ?? "", event.at_us].join(":") : null;
    if (identity && this.recentInputs.includes(identity) || this.t - this.lastInputTime < 0.15 - 1e-9) return { kind: "ignore" };
    if (identity) { this.recentInputs.push(identity); this.recentInputs = this.recentInputs.slice(-8); }
    this.lastInputTime = this.t;
    const offset = kind === "button" ? latencySec(this.settings()) : event.source === "node" ? this.save.caseOffsetMs / 1000 : 0;
    const judged = judgeNote(this.chart.notes, this.judgements, this.songTime - offset, side, this.mode);
    if (judged.kind === "center" || judged.kind === "close") {
      this.judgements[judged.index] = judged.kind; this.stats.hits++; this.stats.center += judged.kind === "center" ? 1 : 0;
      this.stats.combo++; this.stats.maxCombo = Math.max(this.stats.maxCombo, this.stats.combo); this.stats.points += judged.kind === "center" ? 100 : 70;
      const note = this.chart.notes[judged.index]; this.output.cue(note.side, note.accent);
      this.say(judged.kind === "center" ? "CENTER" : judged.error < 0 ? "CAUGHT · EARLY" : "CAUGHT · LATE");
      // Higher than the host's low-tone filter, short, with no delayed tail.
      this.c.tone?.(note.side === "left" ? 440 : 660, 0.045, "triangle", 0.42);
    } else if (judged.kind !== "ignore") {
      this.stats.faults++; this.stats.combo = 0;
      this.say(judged.kind === "wrong" ? "OTHER LANE" : judged.kind === "unsure" ? "SIDE UNSURE · TRY AGAIN" : "BETWEEN NOTES");
    }
    return judged;
  }
  finish() {
    if (this.phase !== "play") return;
    this.result = gradeRun(this.stats, this.chart.notes.length); this.go("result"); this.output.clear();
    if (this.practice) return;
    const entry = this.save.careers[this.mode][this.level];
    entry.runs = Math.min(999999, entry.runs + 1); entry.best = Math.max(entry.best, this.result.score); entry.accuracy = Math.max(entry.accuracy, this.result.accuracy);
    entry.medal = Math.max(entry.medal, this.result.medal); entry.cleared ||= this.result.cleared;
    this.save.runs = Math.min(999999, this.save.runs + 1); this.save.mode = this.mode;
    this.save.last = { level: this.level, mode: this.mode, score: this.result.score, accuracy: this.result.accuracy, medal: this.result.medal, reason: this.result.cleared ? "cleared" : "retry" };
    this.persist(); this.c.score?.(this.result.score, this.mode);
    if (this.result.cleared) { this.c.dailyMet?.(); this.c.feat?.("first-" + this.mode, "TWINBEAT / FIRST " + modeName(this.mode) + " CLEAR"); }
    if (this.level === 7 && this.result.cleared) this.c.feat?.("campaign-" + this.mode, "TWINBEAT / " + modeName(this.mode) + " CAMPAIGN");
  }
  cancel() { this.guard.rewind(); this.held = false; this.hold = 0; this.output.clear(); }
  pause() { this.guard.settle(); this.output.sleep(); }
  resume() { this.output.wake(this.chart?.period || 0.8, this.phase === "play"); }
  dispose() { this.guard.settle(); this.output.sleep(); this.output.dead = true; }
  menuActions() { return [{ label: "TWINBEAT CONSOLE", run: () => { this.go("home"); this.c.resume?.(); } }, { label: "RESTART THIS CHART", run: () => { this.c.resume?.(); this.start(this.level, this.practice); } }]; }
  update(dt) {
    if (!this.output.live || this.output.dead) return;
    this.t += dt; this.guard.tick(dt); if (this.held) this.hold += dt;
    if (this.phase !== "play") { this.output.frame(dt); return; }
    if (this.mode === "sides" && !this.sidesAvailable()) { this.message = "Two-side input changed. Choose Rhythm Assist or restore calibrated sides, then restart."; this.output.clear(); this.go("home"); return; }
    if (this.output.resumeLeft > 0) {
      const beat = Math.ceil(this.output.resumeLeft / this.chart.period);
      if (beat !== this.output.resumeBeat) { this.output.resumeBeat = beat; this.c.tone?.(beat === 2 ? 392 : 523, 0.055, "sine", 0.4); this.output.accent = 0.6; }
      this.output.resumeLeft = Math.max(0, this.output.resumeLeft - dt); this.output.frame(dt); return;
    }
    this.songTime += dt;
    // At most one pulse and one lane voice per step; expired audio is skipped
    // rather than emitted in a burst after an unusual caller/frame delay.
    while (this.nextBeat * this.chart.period <= this.songTime + 1e-9 && this.nextBeat < this.chart.beats) {
      const beat = this.nextBeat++, due = beat * this.chart.period;
      if (this.songTime - due <= 0.06) {
        const accent = (beat + 4) % 4 === 0;
        this.c.tone?.(beat < 0 ? accent ? 523 : 392 : [196, 262, 294, 262][Math.floor(beat / 4) % 4], 0.045, "sine", beat < 0 ? 0.45 : 0.18);
        if (accent) this.output.accent = 1;
      }
    }
    while (this.nextTone < this.chart.notes.length && this.chart.notes[this.nextTone].at <= this.songTime + 1e-9) {
      const note = this.chart.notes[this.nextTone++];
      if (this.songTime - note.at <= 0.06) { this.c.tone?.(note.side === "left" ? 220 : 330, 0.055, "triangle", 0.4); this.output.cue(note.side, note.accent); }
    }
    const retirementOffset = Math.max(this.save.caseOffsetMs / 1000, this.mode === "assist" ? latencySec(this.settings()) : 0);
    for (let i = 0; i < this.judgements.length; i++) if (this.judgements[i] === null && this.songTime > this.chart.notes[i].at + HIT_WINDOW + retirementOffset + 1e-9) {
      this.judgements[i] = "miss"; this.stats.misses++; this.stats.combo = 0; this.say("SIGNAL MISSED");
    }
    this.output.frame(dt);
    this.c.hud?.([["MODE", this.practice ? "PRACTICE" : modeName(this.mode)], ["LEVEL", this.level + 1], ["HITS", this.stats.hits + "/" + this.chart.notes.length], ["COMBO", this.stats.combo]]);
    if (this.songTime > this.chart.length + HIT_WINDOW + retirementOffset + 0.3) this.finish();
  }
  draw(g) {
    g.save(); g.fillStyle = "#080f13"; g.fillRect(0, 0, 960, 540);
    if (this.phase === "play") this.drawPlay(g);
    else if (this.phase === "guide") {
      drawNoticePanel(g, { title: "FIELD MANUAL / " + (this.guidePage + 1) + " OF 2", lines: this.guidePage ? [
        "Clear: 75% accuracy. Extra taps lower it. Silver: 90% and half CENTER. Gold: 100% and 80% CENTER.",
        "Case delay is an estimate for node taps. Space uses the console offset; keyboard case taps use no delay.",
        "Pause freezes the chart; resume counts two beats. Practice opens all charts, with no career rewards.",
      ] : [
        "Cyan LEFT: tap left. Amber RIGHT: tap right. Meet notes at the strike line. No notes arrive together.",
        "Calibration > Tap direction: calibrate left/right, enable Tap mode. Unsure earns no lane. Keys: J / L.",
        "Assist: any case tap, K or Space plays the shown lane. It has a separate career from Two-side.",
      ] }, this.t, false);
      text(g, this.rows()[this.cursor]?.label, 480, 506, 17, C.amber, "center");
    } else if (this.phase === "result") this.drawResult(g);
    else drawRowList(g, this.rows(), this.cursor, "TWINBEAT / " + (this.phase === "songs" ? this.practice ? "PRACTICE STUDIO" : "CHART SELECT" : "TRANSMISSION CONSOLE"), modeName(this.mode), "TAP: NEXT · HOLD RELEASE: SELECT · CASE: PREVIOUS");
    g.restore();
  }
  drawPlay(g) {
    const cyan = "#63d9de", amber = "#efb257", hitY = 412, top = 90, lead = this.settings().reducedMotion ? 2.4 : 2.8;
    text(g, (this.level + 1) + " / " + LEVELS[this.level].name, 42, 30, 22, C.ink);
    text(g, (this.practice ? "PRACTICE · " : "") + modeName(this.mode), 918, 30, 18, this.mode === "sides" ? cyan : amber, "right");
    line(g, 42, 55, 918, 55);
    const progress = clamp(this.songTime / this.chart.length, 0, 1);
    g.fillStyle = C.line; g.fillRect(42, 64, 876, 4); g.fillStyle = cyan; g.fillRect(42, 64, 876 * progress, 4);
    for (let lane = 0; lane < 2; lane++) {
      const x = lane ? 512 : 220, colour = lane ? amber : cyan;
      g.fillStyle = lane ? "#241b13" : "#10272b"; g.fillRect(x, top, 228, hitY - top + 44);
      line(g, x, top, x, hitY + 44, colour); line(g, x + 228, top, x + 228, hitY + 44, colour);
      g.globalAlpha = 0.22; g.fillStyle = colour; g.fillRect(x, hitY - 18, 228, 36); g.globalAlpha = 1;
      line(g, x, hitY, x + 228, hitY, colour, 3);
      text(g, lane ? "RIGHT" : "LEFT", x + 114, 475, 28, colour, "center");
      text(g, lane ? "LAMPS 3 + 4" : "LAMPS 1 + 2", x + 114, 507, 15, C.muted, "center");
      const flash = lane ? this.output.right : this.output.left;
      if (flash > 0) { g.globalAlpha = flash * 0.12; g.fillStyle = colour; g.fillRect(x, hitY - 30, 228, 76); g.globalAlpha = 1; }
    }
    for (let beat = Math.max(0, Math.floor(this.songTime / this.chart.period)); beat < this.chart.beats; beat++) {
      const due = beat * this.chart.period, y = hitY - (due - this.songTime) / lead * (hitY - top);
      if (y < top) break; if (y > hitY + 30) continue;
      line(g, 220, y, 740, y, beat % 4 ? "#2c3436" : "#55666b", beat % 4 ? 1 : 2);
    }
    for (let i = 0; i < this.chart.notes.length; i++) {
      const n = this.chart.notes[i], delta = n.at - this.songTime;
      if (delta > lead || delta < -0.3 || this.judgements[i] === "center" || this.judgements[i] === "close") continue;
      const x = n.side === "left" ? 334 : 626, y = hitY - delta / lead * (hitY - top), colour = this.judgements[i] === "miss" ? C.red : n.side === "left" ? cyan : amber;
      g.fillStyle = colour; g.fillRect(x - 68, y - 10, 136, 20);
      g.fillStyle = "#080f13"; g.fillRect(x - 64, y - 6, 128, 12);
      diamond(g, x, y, n.accent ? 14 : 10, colour, true);
      if (n.accent) { line(g, x - 53, y, x - 25, y, colour, 3); line(g, x + 25, y, x + 53, y, colour, 3); }
    }
    text(g, "COMBO", 104, 173, 16, C.muted, "center"); text(g, this.stats.combo, 104, 213, 42, C.ink, "center");
    text(g, "HITS", 850, 173, 16, C.muted, "center"); text(g, this.stats.hits, 850, 213, 42, C.ink, "center");
    text(g, "MISSED " + this.stats.misses, 850, 257, 14, C.red, "center"); text(g, "EXTRA " + this.stats.faults, 850, 282, 14, C.muted, "center");
    text(g, this.chart.bpm + " BPM", 104, 292, 17, C.muted, "center");
    text(g, this.mode === "sides" ? "J / L" : "K / SPACE", 104, 321, 15, C.muted, "center");
    if (this.songTime < 0 || this.output.resumeLeft > 0) {
      g.fillStyle = "#080f13ed"; g.fillRect(254, 203, 452, 144);
      text(g, this.output.resumeLeft > 0 ? "REJOIN THE PULSE" : "COUNT IN", 480, 234, 21, C.ink, "center");
      const count = this.output.resumeLeft > 0 ? Math.ceil(this.output.resumeLeft / this.chart.period) : Math.ceil(-this.songTime / this.chart.period);
      text(g, Math.max(1, count), 480, 293, 62, amber, "center");
    } else if (this.feedbackUntil > this.t) text(g, this.feedback, 480, 82, 16, this.feedback === "CENTER" ? cyan : amber, "center");
    if (this.mode === "assist") text(g, "ASSIST: ANY TAP PLAYS THE SHOWN LANE", 480, 534, 14, amber, "center");
  }
  drawResult(g) {
    const r = this.result;
    text(g, this.practice ? "STUDIO / TRANSMISSION COMPLETE" : r?.cleared ? this.level === 7 ? "CAMPAIGN COMPLETE / TWIN SUNS" : "SIGNAL CLEARED" : "TRANSMISSION / TRY AGAIN", 480, 35, 25, r?.cleared ? C.cyan : C.amber, "center");
    text(g, LEVELS[this.level].name + " · " + modeName(this.mode), 480, 80, 19, C.muted, "center");
    text(g, (r?.accuracy || 0) + "%", 250, 145, 44, C.ink, "center"); text(g, "ACCURACY", 250, 182, 16, C.muted, "center");
    text(g, r?.score || 0, 480, 145, 44, C.ink, "center"); text(g, "/ 10000", 480, 182, 16, C.muted, "center");
    text(g, this.practice ? "PRACTICE" : MEDALS[r?.medal || 0], 735, 145, 30, C.amber, "center"); text(g, "MAX COMBO " + this.stats.maxCombo, 735, 182, 16, C.muted, "center");
    text(g, "CENTER " + this.stats.center + " · MISSED " + this.stats.misses + " · EXTRA " + this.stats.faults, 480, 226, 18, C.muted, "center");
    if (this.practice) text(g, "STUDIO DOES NOT CHANGE YOUR CAREER", 480, 258, 17, C.amber, "center");
    const rows = this.rows();
    rows.forEach((row, i) => { const y = 312 + i * 49; if (i === this.cursor) { g.fillStyle = C.dark; g.fillRect(100, y - 20, 760, 40); } text(g, row.label, 480, y, 21, i === this.cursor ? C.ink : C.muted, "center"); });
    text(g, "TAP: NEXT · HOLD RELEASE: SELECT · CASE: PREVIOUS", 480, 515, 16, C.muted, "center");
  }
}
