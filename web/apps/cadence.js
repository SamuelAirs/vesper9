// CADENCE — tempo and time under the hands. An instrument with four tools: a metronome
// with tap tempo, a stopwatch with laps, work/rest intervals, and a timer. The lamps carry
// each one: the conductor's beat, a slow second-sweep, a draining bar. The timer is only a
// front end for the service's own persistent timers (the `timer` command and `timers` in the
// state): they keep running when this app closes, survive a restart and announce themselves.
//
// Timing. An instrument gets tick() once a second, far too coarse for a beat, and the host
// has no per-frame hook for instruments. So this file runs a requestAnimationFrame loop of
// its own, but only while something is going on (a click sounding, a stopwatch counting, an
// interval running, a flash fading): every action and button edge wakes it, and it ends by
// itself when idle, on dispose() or when ctx.alive() turns false. tick() calls the same
// frame() so everything still follows time when frames stop (hidden page) or do not exist
// (tests). Every time is computed from a
// start time and a count, never by adding intervals: beat n of a metronome is due at
// beatTime(anchor, bpm, n). ctx.tone has no start-time argument, so a click sounds when the
// first frame at or after (within half a frame of) its due time arrives: the scheduled time
// does not drift, but each click is late or early by up to a frame, and the browser, audio
// and USB path add a constant latency that nothing here can measure.
//
// Input. A navigation instrument only hears short-release = next and hold-release = choose.
// But the host forwards every event, including raw button edges ({type:"button", pressed,
// at_us, source}), to app.event() in every mode, after the navigation has handled it. So
// tap tempo and LAP take their timing from those edges (stamped at the press, counted on a
// short release), while the action list keeps one focused item (DONE / STOP) that a hold
// chooses. A short press also "advances" focus, which with a single action is a no-op.
import { LAMP, dim, blend, lamps, only, spot, meter, fill, lightsOff } from "../engine/lightshow.js";
import { clamp, escapeHTML as esc } from "../engine/math.js";
import { timerLamps } from "./utilities.js";

export const BPM_MIN = 40, BPM_MAX = 220;
export const SIGNATURES = [2, 3, 4, 6];
export const PRESETS = [
  { id: "focus", name: "FOCUS", work: 25 * 60, rest: 5 * 60, rounds: 4 },
  { id: "tabata", name: "TABATA", work: 20, rest: 10, rounds: 8 },
  { id: "minute", name: "MINUTE", work: 60, rest: 30, rounds: 6 },
];
export const WORK_CHOICES = [10, 15, 20, 30, 45, 60, 90, 120, 180, 300, 600, 900, 1200, 1500, 1800];
export const REST_CHOICES = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 300, 600];
export const ROUND_CHOICES = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20];
export const MAX_LAPS = 200;
const SHOWN_LAPS = 5;
const TAP_GAP_MS = 2000; // a longer pause starts a fresh run of taps
const TAP_WINDOW = 5; // the tempo comes from the last five taps (four intervals)
const LATE_MS = 150; // a beat later than this (hidden page) is skipped rather than clicked
// Two quick taps and then a hold are the host's menu gesture (four quick taps in a game, by
// default): the taps arrive here as ordinary input and cancel() follows. Taps no further
// apart than this, ending at the press that was cancelled, are taken back by cancel().
const GESTURE_GAP_MS = 1000;
const MAX_UNDO = 3;

// ---- the timer tool ----
// One hold starts any of these. The first row of the start list repeats the last length.
export const TIMER_PRESETS = [300, 600, 900, 1500];
export const TIMER_MORE = [1800, 2700, 1200, 3600, 180, 60, 30];
export const TIMER_DEFAULT = 300;
export const TIMER_MIN = 5, TIMER_MAX = 86400;
const ADD_SECONDS = 60;
const SHOWN_TIMERS = 2; // timers listed under the large one

const byte = (v) => Math.round(clamp(Number.isFinite(v) ? v : 0, 0, 255));
const finite = (v, d = 0) => (Number.isFinite(v) ? v : d);
const timerKey = (t) => t.remaining + "|" + !!t.running + "|" + !!t.finished;

// ---- pure functions (tested directly) ----

// When beat n is due: the anchor beat n0 sat at time t0 (ms); every later beat is a multiple
// of the period from it. Computed by multiplication, so no rounding error accumulates.
export const beatTime = (t0, bpm, n, n0 = 0) => finite(t0) + finite(n - n0) * (60000 / clamp(finite(bpm, 120), BPM_MIN, BPM_MAX));
export const clampBpm = (v) => clamp(Math.round(finite(v, 120)), BPM_MIN, BPM_MAX);

// Tempo from tap times (ms, ascending): the mean of the last few intervals, or null when
// fewer than two taps are known.
export function tapTempo(times) {
  const t = Array.isArray(times) ? times.filter(Number.isFinite).slice(-TAP_WINDOW) : [];
  if (t.length < 2) return null;
  const span = t[t.length - 1] - t[0];
  if (!(span > 0)) return null;
  return clampBpm(60000 / (span / (t.length - 1)));
}

export function tempoName(bpm) {
  const b = finite(bpm, 120);
  const names = [[60, "LARGO"], [66, "LARGHETTO"], [76, "ADAGIO"], [108, "ANDANTE"], [120, "MODERATO"], [156, "ALLEGRO"], [176, "VIVACE"], [200, "PRESTO"]];
  for (const [limit, name] of names) if (b < limit) return name;
  return "PRESTISSIMO";
}

// Which lamp each beat of the bar lights. 4/4 bounces so the bar is a shape (left, middle,
// right, back), 6/8 reads as two sweeps of three with the second sweep's start softer.
export const LAMP_PATTERN = { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 1], 6: [0, 1, 2, 0, 1, 2] };

export function beatLamps(signature, beat, sinceMs) {
  const sig = SIGNATURES.includes(signature) ? signature : 4;
  if (!Number.isFinite(sinceMs) || sinceMs < 0) return lightsOff();
  const b = ((Math.round(finite(beat)) % sig) + sig) % sig;
  const lamp = LAMP_PATTERN[sig][b];
  const accent = b === 0, half = sig === 6 && b === 3;
  const rgb = accent ? LAMP.amber : half ? blend(LAMP.green, LAMP.amber, 0.5) : LAMP.green;
  const base = accent ? 0.3 : half ? 0.24 : 0.2, peak = accent ? 0.75 : half ? 0.55 : 0.45;
  return only(lamp, rgb, base + (peak - base) * Math.exp(-sinceMs / 90));
}

// Where a work/rest schedule stands `seconds` after it started.
export function intervalState(cfg, seconds) {
  const work = Math.max(1, finite(cfg?.work, 20)), rest = Math.max(0, finite(cfg?.rest, 10));
  const rounds = Math.max(1, Math.round(finite(cfg?.rounds, 1)));
  const s = Math.max(0, finite(seconds));
  const total = rounds * work + (rounds - 1) * rest;
  if (s >= total) return { phase: "done", round: rounds, rounds, remaining: 0, length: 0, total, key: "done" };
  const cycle = work + rest, r = Math.min(rounds - 1, Math.floor(s / cycle)), within = s - r * cycle;
  const inWork = within < work || rest === 0;
  return {
    phase: inWork ? "work" : "rest", round: r + 1, rounds,
    remaining: inWork ? work - within : cycle - within, length: inWork ? work : rest, total,
    key: (inWork ? "w" : "r") + (r + 1),
  };
}

export const amberSeconds = (length) => Math.min(5, Math.max(2, finite(length) * 0.25));

// The bar drains left-to-right-first: the right lamp goes out first, the left last.
export function intervalLamps(st, sinceChangeMs, seconds) {
  if (!st || st.phase === "done") {
    const t = finite(seconds);
    return t < 8 ? fill(LAMP.green, 0.12 + 0.2 * (0.5 - 0.5 * Math.cos(t * Math.PI * 2))) : lightsOff();
  }
  const amber = st.remaining <= amberSeconds(st.length);
  const colour = amber ? LAMP.amber : st.phase === "work" ? LAMP.green : LAMP.cyan;
  const level = amber ? (Math.floor(st.remaining * 2) % 2 ? 0.2 : 0.38) : 0.3;
  const bar = meter(clamp(st.remaining / Math.max(st.length, 1e-9), 0, 1), dim(colour, level));
  if (sinceChangeMs >= 0 && sinceChangeMs < 450) {
    const flash = fill(colour, 0.7 * (1 - sinceChangeMs / 450));
    return bar.map((v, i) => Math.max(v, flash[i]));
  }
  return bar;
}

// The stopwatch's lamps: a dim spot sweeping across once every two seconds, a sweep per
// passing second pair, and an amber flash over all three on a lap.
export function stopwatchLamps(elapsedMs, sinceLapMs, running) {
  const e = Math.max(0, finite(elapsedMs));
  if (!running) return e > 0 ? only(1, LAMP.amber, 0.1) : lightsOff();
  const p = (e / 2000) % 2, pos = p < 1 ? p : 2 - p;
  const base = spot(pos, dim(LAMP.green, 0.2), 0.8);
  if (Number.isFinite(sinceLapMs) && sinceLapMs >= 0 && sinceLapMs < 450) {
    const flash = fill(LAMP.amber, 0.6 * (1 - sinceLapMs / 450));
    return base.map((v, i) => Math.max(v, flash[i]));
  }
  return base;
}

export function formatHundredths(ms) {
  const cs = Math.floor(Math.max(0, finite(ms)) / 10);
  const m = Math.floor(cs / 6000), s = Math.floor((cs % 6000) / 100), h = cs % 100;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(h).padStart(2, "0")}`;
}
export function formatClock(seconds) {
  const s = Math.max(0, Math.ceil(finite(seconds) - 1e-9));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
const spoken = (s) => (s >= 60 && s % 60 === 0 ? s / 60 + " MIN" : s + " S");

// A length in words for a label: "5 MIN", "1 H", "1 H 5 MIN", "30 S", "12 MIN 30 S".
export function lengthLabel(seconds) {
  const t = Math.max(0, Math.round(finite(seconds)));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), r = t % 60;
  return [h && h + " H", m && m + " MIN", r && r + " S"].filter(Boolean).join(" ") || "0 S";
}
// A countdown clock: MM:SS, or H:MM:SS from an hour up. Rounds up, like a kitchen timer.
export function longClock(seconds) {
  const t = Math.max(0, Math.ceil(finite(seconds) - 1e-9));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), r = t % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : String(m).padStart(2, "0")) + ":" + String(r).padStart(2, "0");
}
// The dial is two digits of minutes: a tens stage (tap = +10) and a units stage (tap = +1).
export const dialSeconds = (d) => ((d?.tens | 0) * 10 + (d?.units | 0)) * 60;

// Lamps of a timer that has just finished: three amber blinks (the service plays the same
// triple blink only while the dashboard, Chronometer or Atmosphere is focused, never here).
export function doneFlashLamps(sinceMs) {
  if (!Number.isFinite(sinceMs) || sinceMs < 0 || sinceMs >= 2400) return lightsOff();
  return fill(LAMP.amber, sinceMs % 800 < 400 ? 0.5 : 0);
}
// Lamps while the dial is being turned: a cyan bar of the minutes so far (full at an hour,
// the host's lamp conventions), brightened by each tap.
export function dialLamps(minutes, sinceTapMs) {
  const m = clamp(finite(minutes), 0, 99);
  const flash = Number.isFinite(sinceTapMs) && sinceTapMs >= 0 && sinceTapMs < 300 ? 0.15 * (1 - sinceTapMs / 300) : 0;
  return m > 0 ? meter(Math.min(1, m / 60), dim(LAMP.cyan, 0.22 + flash)) : fill(LAMP.cyan, flash * 2);
}

// Index of the fastest lap, or -1.
export function bestLap(laps) {
  let best = -1;
  for (let i = 0; i < laps.length; i++) if (best < 0 || laps[i].split < laps[best].split) best = i;
  return best;
}

export function sanitize(raw) {
  const o = raw && typeof raw === "object" ? raw : {};
  const pick = (v, list, d) => (list.includes(v) ? v : d);
  const c = o.custom && typeof o.custom === "object" ? o.custom : {};
  return {
    bpm: Number.isFinite(o.bpm) ? clampBpm(o.bpm) : 100,
    sig: pick(o.sig, SIGNATURES, 4),
    preset: [...PRESETS.map((p) => p.id), "custom"].includes(o.preset) ? o.preset : "focus",
    tool: ["metro", "stop", "int", "timer"].includes(o.tool) ? o.tool : "metro",
    lastTimer: Number.isFinite(o.lastTimer) && o.lastTimer >= TIMER_MIN && o.lastTimer <= TIMER_MAX ? Math.round(o.lastTimer) : TIMER_DEFAULT,
    custom: { work: pick(c.work, WORK_CHOICES, 45), rest: pick(c.rest, REST_CHOICES, 15), rounds: pick(c.rounds, ROUND_CHOICES, 6) },
  };
}

const TOOLS = [
  { id: "metro", label: "METRONOME" },
  { id: "stop", label: "STOPWATCH" },
  { id: "int", label: "INTERVALS" },
  { id: "timer", label: "TIMER" },
];
const TIMER_TOOLS = ["timer", "tnew", "tmore", "tdial"];
const isTimerTool = (tool) => TIMER_TOOLS.includes(tool);

export class Cadence {
  constructor(ctx) {
    this.ctx = ctx;
    this.navigation = true;
    this.clock = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
    const s = sanitize(ctx.progress?.());
    this.bpm = s.bpm; this.sig = s.sig; this.preset = s.preset; this.custom = s.custom; this.lastTool = s.tool;
    this.lastTimer = s.lastTimer;
    this.tool = "menu";
    this.paused = false; this.dead = false;
    this.raf = 0;
    this.touched = false; // the lamps have been written: until then they belong to the host
    this.chosen = null; // id of the action that was run last (see focusOn)
    this.down = null;
    this.frameGap = 16;
    this.lastFrame = null;
    this.lastRender = -1e9;
    this.lastHtml = "";
    this.lastTune = "";
    this.cues = []; // queued tone sequences: { at, hz, sec, wave }
    // metronome: anchor beat n0 was due at t0; nextN is the next beat to sound
    this.m = { running: false, t0: 0, n0: 0, nextN: 0, barBase: 0, lastN: -1, lastDue: 0 };
    this.tap = { times: [], src: null, flashAt: -1e9 };
    this.sw = { running: false, startAt: 0, before: 0, laps: [], lapAt: -1e9, startedAt: 0 };
    this.iv = { running: false, startAt: 0, before: 0, cfg: null, key: "", ceil: -1, changeAt: -1e9, doneAt: -1, paused: false };
    // the timer tool: what was last seen of each service timer, which one is large, a start or
    // a +1 MIN waiting for the service to answer, and the dial being turned
    this.tm = { seen: new Map(), sel: null, announced: new Set(), doneAt: -1e9, flashAt: -1e9, starting: null, adding: null, sig: "", dial: { stage: 0, tens: 0, units: 0 } };
    this.taps = []; // taps that changed something, newest last, each with its undo (see cancel)
    this.leds = lightsOff();
    for (const t of this.rawTimers()) if (t.finished) this.tm.announced.add(t.id);
    this.menu();
  }

  startLoop() {
    if (this.raf || this.dead || typeof requestAnimationFrame !== "function") return;
    const loop = () => {
      this.raf = 0;
      if (this.dead || !this.ctx.alive()) return;
      const now = this.clock();
      try { this.frame(now); } catch {}
      if (this.busy(now)) this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
  // Is anything moving that needs a frame at the display's pace?
  busy(now) {
    return this.m.running || this.sw.running || this.iv.running || this.cues.length > 0 ||
      now - this.tap.flashAt < 400 || now - this.sw.lapAt < 500 || now - this.iv.changeAt < 500 ||
      now - this.tm.flashAt < 500 || now - this.tm.doneAt < 2500 ||
      (this.iv.doneAt >= 0 && now - this.iv.doneAt < 8500);
  }
  // After an action or a button edge: bring the lamps and the screen up to date at once and
  // keep the loop going while there is something to follow.
  wake() {
    if (this.dead) return;
    const now = this.clock();
    try { this.frame(now); } catch {}
    if (this.busy(now)) this.startLoop();
  }

  // ---- host hooks ----

  // The host forwards raw button edges here in every mode. Timing taken from them: a press
  // shorter than the hold threshold is a tap (the host treated it as "next"); a longer one
  // was a choice and is not counted.
  event(e) {
    if (!e || this.dead) return;
    // The service's timers changed (every second while any exists), or one finished.
    if (e.type === "timers" || e.type === "state" || e.type === "timer_done") {
      if (e.type === "timer_done") this.announce(e.timer);
      if (isTimerTool(this.tool) && !this.paused) this.wake();
      return;
    }
    if (e.type !== "button" || this.paused) return;
    if (e.pressed) {
      if (e.repeat) return;
      const node = Number.isFinite(e.at_us);
      this.down = { stamp: node ? e.at_us / 1000 : this.clock(), node, src: e.source || "local", arrival: this.clock() };
      return;
    }
    const d = this.down;
    this.down = null;
    if (!d) return; // a release whose press belonged to the menu or the previous screen
    const dur = d.node && Number.isFinite(e.at_us) ? e.at_us / 1000 - d.stamp : this.clock() - d.arrival;
    if (!(dur >= 0) || dur >= finite(this.ctx.settings?.().holdMs, 650)) return;
    if (this.tool === "tap") this.tapAt(d.stamp, d.src, d.arrival);
    else if (this.tool === "stop" && this.sw.running) this.lap(d.arrival);
    else if (this.tool === "tdial") this.dialTap(d.arrival);
    else return;
    this.wake();
  }
  // Held input is dropped. When the host takes a gesture as the system menu (quick taps and a
  // hold, or four quick taps), the taps came here first as ordinary input: the ones that
  // changed something (a lap, a tempo, a minute on the dial) are taken back, so a gesture
  // for the menu never leaves a trace. Nothing else is touched: a timer is only ever started,
  // paused or removed by choosing its action, which a gesture never does.
  cancel() {
    const d = this.down;
    this.down = null;
    this.undoBurst(d ? d.arrival : this.clock());
  }
  noteTap(press, undo) {
    this.taps.push({ press, release: this.clock(), undo });
    if (this.taps.length > MAX_UNDO + 1) this.taps.shift();
  }
  undoBurst(ref) {
    for (let n = 0; n < MAX_UNDO && this.taps.length; n++) {
      const t = this.taps[this.taps.length - 1];
      if (!(ref - t.release <= GESTURE_GAP_MS)) break;
      this.taps.pop();
      try { t.undo(); } catch {}
      ref = t.press;
    }
    this.taps.length = 0;
    if (!this.dead) this.wake();
  }
  // The system menu opened. A running metronome keeps clicking and a running interval keeps
  // its time and its tones (the owner may be adjusting volume or looking something up); a
  // stopwatch must keep counting, and does, because it is computed from the clock. Only the
  // lamps are given up: the menu owns them while it is open.
  pause() { this.paused = true; this.down = null; }
  resume() {
    this.paused = false; this.down = null;
    if (this.touched) this.ctx.leds(this.leds);
    this.wake();
  }
  tick() {
    const now = this.clock();
    this.frame(now);
    if (this.busy(now)) this.startLoop();
  }
  dispose() {
    this.dead = true;
    try { if (typeof cancelAnimationFrame === "function" && this.raf) cancelAnimationFrame(this.raf); } catch {}
    this.m.running = false; this.sw.running = false; this.iv.running = false; this.cues = [];
    this.persist();
    this.ctx.leds(lightsOff());
  }

  persist() {
    const saved = { schema: 1, bpm: this.bpm, sig: this.sig, preset: this.preset, tool: this.lastTool, custom: { ...this.custom }, lastTimer: this.lastTimer };
    const key = JSON.stringify(saved);
    if (key === this.lastTune) return;
    this.lastTune = key;
    this.ctx.saveProgress(saved)?.catch?.(this.ctx.error);
  }

  // ---- the frame ----

  frame(now) {
    if (!Number.isFinite(now)) return;
    if (this.lastFrame !== null && now > this.lastFrame) this.frameGap = clamp(this.frameGap * 0.9 + (now - this.lastFrame) * 0.1, 4, 50);
    this.lastFrame = now;
    this.playCues(now);
    this.stepMetronome(now);
    this.stepInterval(now);
    this.stepTimers(now);
    this.show(this.lampsAt(now));
    if (now - this.lastRender >= 50 || now < this.lastRender) { this.lastRender = now; this.render(now); }
  }

  // Sound every beat that is due. A beat counts as due up to half a frame early, so the
  // click lands on the nearest frame rather than always the one after.
  stepMetronome(now) {
    const m = this.m;
    if (!m.running) return;
    const lead = Math.min(8, this.frameGap * 0.5);
    let guard = 0;
    while (beatTime(m.t0, this.bpm, m.nextN, m.n0) <= now + lead && guard++ < 64) {
      const due = beatTime(m.t0, this.bpm, m.nextN, m.n0);
      if (now - due > 500) { // far behind (page was hidden): jump to the beat that is current now
        m.nextN = m.n0 + Math.max(0, Math.floor((now - m.t0) / (60000 / this.bpm)));
        continue;
      }
      const inBar = (((m.nextN - m.barBase) % this.sig) + this.sig) % this.sig;
      if (now - due <= LATE_MS) {
        this.ctx.tone(inBar === 0 ? 1760 : 1175, 0.035, "square");
        this.lastBeat = { n: m.nextN, due, at: now };
      }
      m.lastN = m.nextN; m.lastDue = due; m.nextN++;
    }
  }

  // Change the tempo without a jump: the beat that last sounded becomes the new anchor.
  setBpm(value) {
    const next = clampBpm(value), m = this.m;
    if (next === this.bpm) return;
    if (m.running && m.lastN >= 0) { m.t0 = m.lastDue; m.n0 = m.lastN; }
    this.bpm = next;
    this.render(this.clock(), true);
  }

  playCues(now) {
    let guard = 0;
    while (this.cues.length && this.cues[0].at <= now && guard++ < 8) {
      const c = this.cues.shift();
      if (now - c.at < 400) this.ctx.tone(c.hz, c.sec, c.wave);
    }
  }
  cue(now, notes) {
    notes.forEach(([hz, sec], i) => this.cues.push({ at: now + i * 130, hz, sec, wave: "triangle" }));
    this.cues.sort((a, b) => a.at - b.at);
    if (this.cues.length > 24) this.cues.length = 24;
    this.playCues(now);
  }

  stepInterval(now) {
    const iv = this.iv;
    if (!iv.running || !iv.cfg) return;
    const seconds = this.ivSeconds(now), st = intervalState(iv.cfg, seconds);
    if (st.key !== iv.key) {
      iv.key = st.key; iv.changeAt = now; iv.ceil = -1;
      if (st.phase === "done") {
        iv.running = false; iv.doneAt = now; iv.before = st.total;
        this.cue(now, [[660, 0.18], [880, 0.18], [1320, 0.4]]);
        this.build();
      } else this.cue(now, st.phase === "work" ? [[660, 0.12], [990, 0.2]] : [[990, 0.12], [660, 0.2]]);
    } else if (st.phase !== "done" && st.length > 6 && st.remaining <= 3) {
      const c = Math.ceil(st.remaining);
      if (c !== iv.ceil) { if (iv.ceil !== -1) this.ctx.tone(880, 0.06, "square"); iv.ceil = c; }
    }
  }
  ivSeconds(now) {
    const iv = this.iv;
    return iv.before + (iv.running ? Math.max(0, now - iv.startAt) / 1000 : 0);
  }

  swElapsed(now = this.clock()) {
    const sw = this.sw;
    return sw.before + (sw.running ? Math.max(0, now - sw.startAt) : 0);
  }

  lampsAt(now) {
    const sig = this.sig;
    if (this.tool === "metro" || this.tool === "tap") {
      if (this.m.running && this.m.lastN >= 0) {
        return beatLamps(sig, ((this.m.lastN - this.m.barBase) % sig + sig) % sig, now - this.m.lastDue);
      }
      const since = now - this.tap.flashAt;
      return since >= 0 && since < 300 ? only(1, LAMP.cyan, 0.5 * (1 - since / 300)) : lightsOff();
    }
    if (isTimerTool(this.tool)) return this.timerLampsAt(now);
    if (this.tool === "stop") return stopwatchLamps(this.swElapsed(now), now - this.sw.lapAt, this.sw.running);
    if (this.tool === "int" && this.iv.paused) return only(1, LAMP.amber, 0.1); // paused: one dim amber lamp
    if (this.tool === "int" && (this.iv.running || this.iv.doneAt >= 0)) {
      if (this.iv.running) return intervalLamps(intervalState(this.iv.cfg, this.ivSeconds(now)), now - this.iv.changeAt, 0);
      return intervalLamps({ phase: "done" }, 0, (now - this.iv.doneAt) / 1000);
    }
    return lightsOff();
  }

  show(values) {
    if (!Array.isArray(values) || values.length !== 9) values = lightsOff();
    this.leds = values.map(byte);
    // While the system menu is open it owns the lamps; sending would take them back. Until a
    // tool has lit them they stay with the host (its focus and hold feedback shows on them).
    if (this.paused || (!this.touched && this.leds.every((v) => v === 0))) return;
    this.touched = true;
    this.ctx.leds(this.leds);
  }

  // ---- tools ----

  startMetronome() {
    const now = this.clock(), m = this.m;
    Object.assign(m, { running: true, t0: now, n0: 0, nextN: 0, barBase: 0, lastN: -1, lastDue: now });
    this.lastTool = "metro";
    this.persist();
    this.build();
    this.frame(now);
  }
  stopMetronome() { this.m.running = false; this.m.lastN = -1; this.build(); this.render(this.clock(), true); }

  tapAt(stamp, src, arrival) {
    const t = this.tap;
    if (t.src !== src || (t.times.length && stamp - t.times[t.times.length - 1] > TAP_GAP_MS) ||
        (t.times.length && stamp - t.times[t.times.length - 1] < 0)) t.times = [];
    // A press under 200 ms after the last is a bounce, not a beat.
    if (t.times.length && stamp - t.times[t.times.length - 1] < 200) return;
    const before = { times: t.times.slice(), src: t.src, bpm: this.bpm };
    t.src = src; t.times.push(stamp);
    if (t.times.length > TAP_WINDOW) t.times.shift();
    this.noteTap(arrival, () => { t.times = before.times; t.src = before.src; this.setBpm(before.bpm); });
    t.flashAt = Number.isFinite(arrival) ? arrival : this.clock();
    const bpm = tapTempo(t.times);
    if (bpm !== null) this.setBpm(bpm);
    this.render(this.clock(), true);
  }

  startStopwatch() {
    const now = this.clock(), sw = this.sw;
    sw.running = true; sw.startAt = now; sw.startedAt = now;
    this.lastTool = "stop";
    this.build();
    this.frame(now);
  }
  // `at` is the moment of the press, not of its release.
  stopStopwatch() {
    const sw = this.sw, now = this.clock();
    const at = this.down && this.down.arrival >= sw.startedAt ? Math.min(now, this.down.arrival) : now;
    sw.before = sw.before + Math.max(0, at - sw.startAt);
    sw.running = false;
    this.build();
    this.render(now, true);
  }
  lap(at) {
    const sw = this.sw;
    if (!sw.running || sw.laps.length >= MAX_LAPS) return;
    const total = sw.before + Math.max(0, at - sw.startAt);
    const prev = sw.laps.length ? sw.laps[sw.laps.length - 1].total : 0;
    const lap = { split: Math.max(0, total - prev), total };
    sw.laps.push(lap);
    sw.lapAt = this.clock();
    this.noteTap(Number.isFinite(at) ? at : this.clock(), () => { const i = sw.laps.lastIndexOf(lap); if (i >= 0) sw.laps.splice(i, 1); sw.lapAt = -1e9; });
    this.render(this.clock(), true);
  }
  resetStopwatch() {
    Object.assign(this.sw, { running: false, before: 0, laps: [], lapAt: -1e9 });
    this.build("go"); // RESET leaves START highlighted, not BACK
    this.render(this.clock(), true);
  }

  intervalConfig() {
    const p = PRESETS.find((x) => x.id === this.preset);
    return p ? { work: p.work, rest: p.rest, rounds: p.rounds } : { ...this.custom };
  }
  startIntervals() {
    const now = this.clock(), iv = this.iv;
    Object.assign(iv, { running: true, startAt: now, before: 0, cfg: this.intervalConfig(), key: "", ceil: -1, doneAt: -1 });
    this.lastTool = "int";
    this.persist();
    this.build();
    this.frame(now);
  }
  pauseIntervals() {
    const iv = this.iv, now = this.clock();
    if (iv.running) { iv.before = this.ivSeconds(now); iv.running = false; iv.paused = true; }
    else if (iv.paused) { iv.startAt = now; iv.running = true; iv.paused = false; }
    this.build();
    this.render(now, true);
  }
  stopIntervals() {
    Object.assign(this.iv, { running: false, paused: false, before: 0, doneAt: -1, key: "" });
    this.build("go");
    this.render(this.clock(), true);
  }

  // ---- the timer tool ----

  // The service's timers as the state last gave them (at most eight, as the service allows).
  rawTimers() {
    const list = this.ctx.state?.()?.timers;
    return Array.isArray(list) ? list.filter((t) => t && typeof t.id === "string").slice(0, 8) : [];
  }
  // Each timer with the time left worked out from the clock between the service's updates, so
  // the readout runs smoothly and survives a late message. The service reports every second.
  timersView(now) {
    return this.rawTimers().map((t) => {
      const s = this.tm.seen.get(t.id), base = Math.max(0, finite(t.remaining)), dur = finite(t.duration, base);
      const finished = !!t.finished, running = !!t.running && !finished;
      const left = finished ? 0 : running ? Math.max(0, s && s.key === timerKey(t) ? s.remaining - (now - s.at) / 1000 : base) : base;
      return { id: t.id, label: String(t.label || "TIMER"), duration: dur, running, finished, left, fraction: dur > 0 ? clamp(left / dur, 0, 1) : 0 };
    });
  }
  // The large timer: the one chosen with NEXT TIMER (or just started), else the nearest to
  // finishing, else the first paused, else the first finished.
  leadOf(view) {
    const chosen = view.find((t) => t.id === this.tm.sel);
    if (chosen) return chosen;
    let best = null;
    for (const t of view) if (t.running && (!best || t.left < best.left)) best = t;
    return best || view.find((t) => !t.finished) || view[0] || null;
  }
  announce(timer) {
    const id = timer && typeof timer.id === "string" ? timer.id : null;
    if (!id || this.tm.announced.has(id)) return;
    this.tm.announced.add(id);
    this.tm.doneAt = this.clock();
  }
  // Called every frame while a timer screen is showing: remember each timer's last report,
  // notice a start or +1 MIN the service has answered and a timer that has finished, and
  // publish the actions again when what can be done has changed.
  stepTimers(now) {
    if (!isTimerTool(this.tool)) return;
    const tm = this.tm, list = this.rawTimers(), ids = new Set(list.map((t) => t.id));
    for (const t of list) {
      const key = timerKey(t), seen = tm.seen.get(t.id);
      if (!seen || seen.key !== key) tm.seen.set(t.id, { key, remaining: Math.max(0, finite(t.remaining)), at: now });
    }
    for (const id of [...tm.seen.keys()]) if (!ids.has(id)) tm.seen.delete(id);
    for (const id of [...tm.announced]) if (!ids.has(id)) tm.announced.delete(id);
    if (tm.starting) {
      const fresh = list.find((t) => !tm.starting.before.has(t.id));
      if (fresh) { tm.sel = fresh.id; tm.starting = null; }
      else if (now - tm.starting.at > 4000) tm.starting = null;
    }
    if (tm.adding) {
      const add = tm.adding, fresh = list.find((t) => !add.before.has(t.id));
      if (fresh) {
        tm.adding = null; tm.sel = fresh.id;
        if (add.paused) this.timerCommand({ op: "toggle", id: fresh.id });
        this.timerCommand({ op: "remove", id: add.oldId });
      } else if (now - add.at > 5000) tm.adding = null;
    }
    for (const t of list) if (t.finished && !tm.announced.has(t.id)) { tm.announced.add(t.id); tm.doneAt = now; }
    if (tm.sel && !ids.has(tm.sel)) tm.sel = null;
    // When the kind of screen changes under the hand (a timer started by voice, one finishing,
    // the last one removed) the highlight goes to the first row; otherwise it stays put.
    if (this.timerSig() !== tm.sig) this.build(...(this.timerKind() !== tm.kind ? ["first", true] : []));
  }
  timerKind() {
    const lead = this.leadOf(this.timersView(this.clock()));
    return this.tool + "|" + (lead ? (lead.finished ? "done" : "live") : "none");
  }
  // What decides which actions the timer screen offers.
  timerSig() {
    const view = this.timersView(this.clock()), lead = this.leadOf(view);
    return [this.tool, view.map((t) => t.id + (t.finished ? "F" : t.running ? "R" : "P")).join(","), lead ? lead.id : "-", this.tm.starting ? 1 : 0].join("|");
  }
  // Resolves to the service's answer, or to undefined when it was refused (the error is shown).
  timerCommand(data) {
    try { return Promise.resolve(this.ctx.command("timer", data)).catch((error) => { this.ctx.error(error); }); } catch (error) { this.ctx.error(error); return Promise.resolve(); }
  }
  // Start a service timer of `seconds` and show it. Labels are never asked for.
  startTimer(seconds) {
    const sec = clamp(Math.round(finite(seconds, TIMER_DEFAULT)), TIMER_MIN, TIMER_MAX);
    this.lastTimer = sec; this.lastTool = "timer";
    this.persist();
    this.tm.starting = { at: this.clock(), before: new Set(this.rawTimers().map((t) => t.id)) };
    this.go("timer", "first");
    return this.timerCommand({ op: "create", seconds: sec, label: lengthLabel(sec) }).then((r) => { if (r === undefined) { this.tm.starting = null; this.wake(); } return r; });
  }
  timerById(id) { return this.timersView(this.clock()).find((t) => t.id === id) || null; }
  removeTimer(id) {
    if (this.tm.sel === id) this.tm.sel = null;
    return this.timerCommand({ op: "remove", id });
  }
  // The service has no "add time" operation, so a minute is added by starting a timer for what
  // is left plus a minute (paused again at once if the old one was paused) and removing the
  // old one when the new one has been seen. If the create is refused (eight timers) nothing
  // is lost.
  addMinute(id) {
    const t = this.timerById(id);
    if (!t || this.tm.adding) return null;
    const seconds = clamp(Math.ceil(t.left) + ADD_SECONDS, TIMER_MIN, TIMER_MAX);
    this.tm.adding = { oldId: id, paused: !t.running && !t.finished, at: this.clock(), before: new Set(this.rawTimers().map((x) => x.id)) };
    return this.timerCommand({ op: "create", seconds, label: t.label }).then((r) => { if (r === undefined) this.tm.adding = null; return r; });
  }
  nextTimer() {
    const view = this.timersView(this.clock());
    if (view.length < 2) return;
    const at = view.findIndex((t) => t.id === (this.leadOf(view) || {}).id);
    this.tm.sel = view[(at + 1) % view.length].id;
    this.build(); this.render(this.clock(), true);
  }
  openDial() { this.tm.dial = { stage: 0, tens: 0, units: 0 }; this.go("tdial"); }
  // A tap on the dial adds a minute (or ten, on the tens stage). The host's own "next" for a
  // single action does nothing, so the tap is free to count.
  dialTap(press) {
    const d = this.tm.dial, key = d.stage === 0 ? "tens" : "units", before = d[key], stage = d.stage;
    d[key] = (before + 1) % 10;
    this.tm.flashAt = this.clock();
    this.noteTap(press, () => { if (d.stage === stage) d[key] = before; this.build(); });
    this.build(); this.render(this.clock(), true);
  }
  timerLampsAt(now) {
    if (this.tool === "tdial") return dialLamps(dialSeconds(this.tm.dial) / 60, now - this.tm.flashAt);
    const since = now - this.tm.doneAt;
    if (since >= 0 && since < 2400) return doneFlashLamps(since);
    const view = this.timersView(now);
    let near = null;
    for (const t of view) if (t.running && t.left > 0 && (!near || t.left < near.left)) near = t;
    if (near) return timerLamps({ remaining: near.left, duration: near.duration });
    if (view.some((t) => t.finished)) return only(1, LAMP.amber, 0.12); // waiting to be dismissed
    if (view.length) return only(1, LAMP.amber, 0.08); // paused
    return lightsOff();
  }

  // The ready-made choices that start a timer with one hold, and the way into the dial.
  timerStartItems(a, back) {
    return [
      a("t-last", "START " + lengthLabel(this.lastTimer) + " / LAST", () => this.startTimer(this.lastTimer)),
      a("t-dial", "DIAL / TAP ADDS MINUTES", () => this.openDial()),
      ...TIMER_PRESETS.map((s) => a("t-" + s, "START " + lengthLabel(s), () => this.startTimer(s))),
      a("t-more", "MORE LENGTHS", () => this.go("tmore")),
      back,
    ];
  }

  // ---- screens ----

  // `want` says where the highlight lands in the new list (see focusOn).
  go(tool, want = "first") {
    this.tool = tool;
    if (tool === "metro" || tool === "stop" || tool === "int" || tool === "timer") this.lastTool = tool;
    this.taps.length = 0;
    this.build(want); this.render(this.clock(), true);
  }

  render(now, force = false) {
    const html = this.html(now);
    if (force || html !== this.lastHtml) {
      this.lastHtml = html;
      this.ctx.content(html);
    }
  }

  beatDots(now) {
    const sig = this.sig, m = this.m;
    const cur = m.running && m.lastN >= 0 ? (((m.lastN - m.barBase) % sig) + sig) % sig : -1;
    const dots = Array.from({ length: sig }, (_, i) => {
      const on = i === cur, r = i === 0 ? 15 : 11;
      return `<circle cx="${24 + i * 44}" cy="22" r="${r}" fill="${on ? (i === 0 ? "#ffb347" : "#7dff9a") : "none"}" stroke="${i === 0 ? "#ffb347" : "currentColor"}" stroke-width="2.5"/>`;
    }).join("");
    return `<svg viewBox="0 0 ${sig * 44 + 4} 44" width="${sig * 44 + 4}" height="44" role="img" aria-label="Beat ${cur + 1} of ${sig}" style="display:block;margin:6px auto 0;color:#657b5b">${dots}</svg>`;
  }

  html(now) {
    const big = (text, size) => `<div class="big-readout" style="font-size:${size}px;line-height:1.05">${text}</div>`;
    const label = (t) => `<div class="data-label">${t}</div>`;
    switch (this.tool) {
      case "metro":
      case "tap": {
        const tapping = this.tool === "tap";
        return `<div class="readout-grid"><div class="utility-panel">${label(tapping ? "TAP THE BUTTON IN TIME" : "TEMPO")}${big(this.bpm + " BPM", 64)}<p>${esc(tempoName(this.bpm))}${tapping ? " / " + this.tap.times.length + " TAPS" : ""}</p></div>` +
          `<div class="utility-panel">${label("BAR")}${big(this.sig + " / 4", 44)}${this.beatDots(now)}<p class="recording-tag">${this.m.running ? "CLICKING" : "STOPPED"}</p></div></div>`;
      }
      case "stop": {
        const sw = this.sw, e = this.swElapsed(now), best = bestLap(sw.laps);
        const rows = sw.laps.slice(-SHOWN_LAPS).reverse().map((l, k) => {
          const i = sw.laps.length - 1 - k;
          return `<div style="display:grid;grid-template-columns:1.3fr 1fr 1fr;font-size:20px;line-height:1.35;${i === best ? "color:#ffb347" : ""}"><span>LAP ${i + 1}${i === best && sw.laps.length > 1 ? " BEST" : ""}</span><span style="text-align:right">${formatHundredths(l.split)}</span><span style="text-align:right">${formatHundredths(l.total)}</span></div>`;
        }).join("");
        const state = sw.running ? "RUNNING" : e > 0 ? "STOPPED" : "READY";
        return `<div class="utility-panel">${label("STOPWATCH / " + state)}${big(formatHundredths(e), 76)}</div>` +
          `<div class="utility-panel">${label("LAP / SPLIT / TOTAL")}${rows || '<p>TAP WHILE RUNNING TO TAKE A LAP</p>'}</div>`;
      }
      case "int":
      case "intset": {
        const iv = this.iv;
        if (iv.running || iv.paused || iv.doneAt >= 0) {
          const st = intervalState(iv.cfg, this.ivSeconds(now));
          const word = st.phase === "done" ? "DONE" : st.phase === "work" ? "WORK" : "REST";
          const colour = st.phase === "done" ? "#7dff9a" : st.remaining <= amberSeconds(st.length) ? "#ffb347" : st.phase === "work" ? "#7dff9a" : "#4fd8c8";
          return `<div class="utility-panel" style="text-align:center">${label(iv.paused ? "PAUSED" : st.phase === "done" ? "ALL ROUNDS COMPLETE" : "ROUND " + st.round + " OF " + st.rounds)}` +
            `<div class="big-readout" style="font-size:92px;line-height:1;color:${colour}">${word}</div>` +
            `<div class="big-readout" style="font-size:72px;line-height:1.05;color:${colour}">${st.phase === "done" ? "--:--" : formatClock(st.remaining)}</div></div>`;
        }
        const c = this.intervalConfig(), p = PRESETS.find((x) => x.id === this.preset);
        return `<div class="utility-panel">${label("INTERVALS / " + (p ? p.name : "CUSTOM"))}${big(spoken(c.work) + " / " + spoken(c.rest), 56)}<p>${c.rounds} ROUNDS / WORK THEN REST</p></div>`;
      }
      case "timer":
      case "tnew":
      case "tmore":
        return this.timerHtml(now);
      case "tdial":
        return this.dialHtml();
      default:
        return `<div class="utility-panel"><h2>CADENCE</h2><p>METRONOME, STOPWATCH, INTERVALS AND TIMER. THE LAMPS KEEP THE TIME.</p></div>`;
    }
  }

  // Running timers, large: the chosen one on top with its bar, the next two beneath.
  timerHtml(now) {
    const label = (t) => `<div class="data-label">${t}</div>`;
    const voice = '<p class="cad-voice">VOICE: SAY “COMPUTER TIMER TWELVE MINUTES” AT ANY TIME</p>';
    const view = this.timersView(now), lead = this.leadOf(view);
    if (!lead) {
      return `<div class="utility-panel">${label("TIMER / " + (this.tm.starting ? "STARTING" : "NONE RUNNING"))}<div class="big-readout cad-timer-big" style="color:#657b5b">00:00</div>` +
        `<p>LAST LENGTH ${longClock(this.lastTimer)} / TIMERS KEEP RUNNING AFTER YOU LEAVE</p></div>${voice}`;
    }
    const state = lead.finished ? "DONE" : lead.running ? "RUNNING" : "PAUSED";
    const colour = lead.finished || !lead.running || lead.left <= 10 ? "#ffb347" : "";
    const big = lead.finished ? "DONE" : longClock(lead.left);
    const others = view.filter((t) => t !== lead).sort((x, y) => x.left - y.left);
    const row = (t) => `<div class="timer-row"><div><div class="data-label">${esc(t.label)}</div><span class="recording-tag">${t.finished ? "DONE" : t.running ? "RUNNING" : "PAUSED"}</span></div><div class="big-readout">${t.finished ? "DONE" : longClock(t.left)}</div></div>`;
    return `<div class="utility-panel"><div class="data-label cad-timer-head"><span>${esc(lead.label)} / OF ${longClock(lead.duration)}${view.length > 1 ? " / 1 OF " + view.length : ""}</span><span class="recording-tag">${state}</span></div>` +
      `<div class="big-readout cad-timer-big"${colour ? ` style="color:${colour}"` : ""}>${big}</div>` +
      `<div class="timer-bar" role="img" aria-label="${Math.round(lead.fraction * 100)} percent remaining"><i style="width:${(lead.fraction * 100).toFixed(1)}%"></i></div>` +
      others.slice(0, SHOWN_TIMERS).map(row).join("") + (others.length > SHOWN_TIMERS ? `<p>+ ${others.length - SHOWN_TIMERS} MORE</p>` : "") + `</div>${voice}`;
  }
  dialHtml() {
    const d = this.tm.dial, total = dialSeconds(d), on = (i, v) => (d.stage === i ? `<span class="cad-dial-on">${v}</span>` : v);
    return `<div class="utility-panel"><div class="data-label">DIAL / ${d.stage === 0 ? "TENS OF MINUTES: EACH TAP ADDS 10" : "MINUTES: EACH TAP ADDS 1"}</div>` +
      `<div class="big-readout cad-timer-big">${on(0, d.tens)}${on(1, d.units)}<span style="color:#657b5b">:00</span></div>` +
      `<p>${total ? lengthLabel(total) : "TAP TO SET A LENGTH"} / HOLD = ${d.stage === 0 ? "NEXT" : total ? "START" : "BACK"}</p></div>` +
      '<p class="cad-voice">VOICE: SAY “COMPUTER TIMER TWELVE MINUTES” AT ANY TIME</p>';
  }

  // The host keeps the highlight on the action with the same id, else on the same row number,
  // which after a screen change is an arbitrary row (STOPWATCH used to open on BACK). So the
  // action that should be highlighted next takes over the id of the one just chosen. `want` is
  // an id or "first". Every action also wakes the frame loop and refreshes the lamps. On
  // opening (`park`) the highlight would otherwise start on the row numbered like the
  // dashboard card that was chosen (RESONANCE used to open on RETURN TO DASHBOARD), so a
  // one-item list is published first, which pins the highlight to the target.
  focusOn(items, want, park = false) {
    const target = want === "first" ? items[0] : items.find((i) => i.id === want);
    if (target && this.chosen) {
      for (const item of items) if (item !== target && item.id === this.chosen) item.id += "~";
      target.id = this.chosen;
    }
    for (const item of items) {
      const run = item.run;
      item.run = () => { this.chosen = item.id; const result = run(); this.wake(); return result; };
    }
    if (park && target) this.ctx.actions([target]);
  }

  // Rebuild the action list for the current screen. Ids stay stable so the host keeps focus.
  build(want = null, park = false) {
    const a = (id, label, run) => ({ id, label, run });
    const back = a("back", "BACK", () => this.go("menu"));
    let items, hint;
    switch (this.tool) {
      case "metro": {
        const running = this.m.running;
        items = [
          a("go", running ? "STOP" : "START", () => (running ? this.stopMetronome() : this.startMetronome())),
          a("tap", "TAP TEMPO", () => { this.tap.times = []; this.go("tap"); }),
          a("up5", "FASTER +5", () => this.setBpm(this.bpm + 5)),
          a("dn5", "SLOWER -5", () => this.setBpm(this.bpm - 5)),
          a("up1", "FINE +1", () => this.setBpm(this.bpm + 1)),
          a("dn1", "FINE -1", () => this.setBpm(this.bpm - 1)),
          a("sig", "BEATS / " + this.sig, () => this.cycleSignature()),
        ];
        if (!running) items.push(back);
        hint = "Tap to advance. Hold and release to choose. TAP TEMPO lets you tap the button in time. Hold three seconds for the system menu.";
        break;
      }
      case "tap":
        items = [a("done", "DONE", () => { this.lastTool = "metro"; this.persist(); this.go("metro", "go"); })];
        hint = "Tap the button in time with the music. Hold and release to finish. (Hold three seconds for the system menu.)";
        break;
      case "stop": {
        const sw = this.sw;
        if (sw.running) {
          items = [a("go", "STOP", () => this.stopStopwatch())];
          hint = "Tap = LAP. Hold and release = STOP. (Hold three seconds for the system menu.)";
        } else {
          items = [a("go", this.swElapsed() > 0 ? "RESUME" : "START", () => this.startStopwatch())];
          if (this.swElapsed() > 0) items.push(a("reset", "RESET", () => this.resetStopwatch()));
          items.push(back);
          hint = "Tap to advance. Hold and release to choose. While running, a tap takes a lap.";
        }
        break;
      }
      case "int": {
        const iv = this.iv;
        if (iv.running || iv.paused) {
          items = [a("pause", iv.paused ? "RESUME" : "PAUSE", () => this.pauseIntervals()), a("end", "STOP", () => this.stopIntervals())];
          hint = "The lamps drain across the period: green work, cyan rest, amber at the end. (Hold three seconds for the system menu.)";
        } else if (iv.doneAt >= 0) {
          items = [a("end", "FINISHED / CLEAR", () => this.stopIntervals())];
          hint = "All rounds complete.";
        } else {
          const p = PRESETS.find((x) => x.id === this.preset);
          items = [
            a("go", "START", () => this.startIntervals()),
            a("preset", "PRESET / " + (p ? p.name : "CUSTOM"), () => this.cyclePreset()),
            a("custom", "CUSTOM SETUP", () => { this.preset = "custom"; this.persist(); this.go("intset"); }),
            back,
          ];
          hint = "Tap to advance. Hold and release to choose. PRESET steps through the ready-made sets.";
        }
        break;
      }
      case "intset": {
        const c = this.custom;
        const cycle = (key, list) => () => { c[key] = list[(list.indexOf(c[key]) + 1) % list.length]; this.persist(); this.build(); this.render(this.clock(), true); };
        items = [
          a("w", "WORK / " + spoken(c.work), cycle("work", WORK_CHOICES)),
          a("r", "REST / " + spoken(c.rest), cycle("rest", REST_CHOICES)),
          a("n", "ROUNDS / " + c.rounds, cycle("rounds", ROUND_CHOICES)),
          a("ok", "DONE", () => this.go("int", "go")),
        ];
        hint = "Each choice steps to its next value. DONE returns to the start screen.";
        break;
      }
      case "timer":
      case "tnew": {
        const now = this.clock(), view = this.timersView(now), lead = this.leadOf(view);
        const toStart = () => this.go(view.length ? "timer" : "menu");
        if (this.tool === "timer" && lead) {
          const id = lead.id;
          items = lead.finished
            ? [a("t-main", "DISMISS", () => this.removeTimer(id)), a("t-restart", "RESTART " + lengthLabel(lead.duration), () => this.timerCommand({ op: "toggle", id }))]
            : [
              a("t-main", lead.running ? "PAUSE" : "RESUME", () => this.timerCommand({ op: "toggle", id })),
              a("t-add", "ADD 1 MIN", () => this.addMinute(id)),
              a("t-cancel", "CANCEL TIMER", () => this.removeTimer(id)),
            ];
          items.push(a("t-new", "NEW TIMER", () => this.go("tnew")));
          if (view.length > 1) items.push(a("t-next", "NEXT TIMER / " + view.length + " SET", () => this.nextTimer()));
          items.push(back);
          hint = "Tap to advance. Hold and release to choose. The lamps drain with the nearest timer; timers keep running when you leave.";
        } else if (this.tool === "timer" && this.tm.starting) {
          items = [back];
          hint = "Starting the timer.";
        } else {
          items = this.timerStartItems(a, a("back", "BACK", toStart));
          hint = "One hold starts a timer. DIAL: tap for minutes, hold to start. Or say: computer timer twelve minutes.";
        }
        this.tm.sig = this.timerSig(); this.tm.kind = this.timerKind();
        break;
      }
      case "tmore": {
        items = [...TIMER_MORE.map((s) => a("t-" + s, "START " + lengthLabel(s), () => this.startTimer(s))), a("back", "BACK", () => this.go("tnew", "t-more"))];
        hint = "One hold starts a timer.";
        break;
      }
      case "tdial": {
        const d = this.tm.dial, total = dialSeconds(d);
        if (d.stage === 0) items = [a("d-ok", "TENS SET / NEXT", () => { d.stage = 1; this.build(); this.render(this.clock(), true); })];
        else items = [total > 0 ? a("d-ok", "START " + lengthLabel(total), () => this.startTimer(total)) : a("d-ok", "BACK", () => this.go("tnew", "t-dial"))];
        hint = d.stage === 0 ? "Each tap adds ten minutes. Hold and release when the tens are right." : "Each tap adds a minute. Hold and release to start.";
        break;
      }
      default: {
        // The tools keep their places (a list that reorders itself cannot be learned); the
        // highlight starts on the one used last.
        items = [...TOOLS.map((t) => a("tool-" + t.id, t.label, () => this.go(t.id))), a("home", "RETURN TO DASHBOARD", this.ctx.home)];
        if (want === "first") want = "tool-" + this.lastTool;
        hint = "Choose a tool. The lamps follow it.";
      }
    }
    this.focusOn(items, want, park);
    this.ctx.actions(items);
    this.ctx.hint(hint);
  }
  menu() { this.build("first", true); this.render(this.clock(), true); }
  // For the host to open a tool directly (the voice name "timer" should land on the timer).
  openTool(id) { if (["metro", "stop", "int", "timer"].includes(id)) this.go(id); }

  cycleSignature() {
    this.sig = SIGNATURES[(SIGNATURES.indexOf(this.sig) + 1) % SIGNATURES.length];
    this.m.barBase = this.m.nextN; // the next beat is the new bar's accent
    this.persist();
    this.build();
    this.render(this.clock(), true);
  }
  cyclePreset() {
    const ids = [...PRESETS.map((p) => p.id), "custom"];
    this.preset = ids[(ids.indexOf(this.preset) + 1) % ids.length];
    this.persist();
    this.build();
    this.render(this.clock(), true);
  }
}
