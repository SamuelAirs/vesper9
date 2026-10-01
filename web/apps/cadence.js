// CADENCE — tempo and time under the hands. An instrument with three tools: a metronome
// with tap tempo, a stopwatch with laps, and work/rest intervals. The lamps carry each one:
// the conductor's beat, a slow second-sweep, a draining bar.
//
// Timing. An instrument gets tick() once a second, far too coarse for a beat, and the host
// has no per-frame hook for instruments. So this file runs one requestAnimationFrame loop of
// its own (like lantern.js and oracle.js: started in the constructor, ended by dispose() or
// when ctx.alive() turns false); tick() calls the same frame() so everything still follows
// time when frames stop (hidden page) or do not exist (tests). Every time is computed from a
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

const byte = (v) => Math.round(clamp(Number.isFinite(v) ? v : 0, 0, 255));
const finite = (v, d = 0) => (Number.isFinite(v) ? v : d);

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
    tool: ["metro", "stop", "int"].includes(o.tool) ? o.tool : "metro",
    custom: { work: pick(c.work, WORK_CHOICES, 45), rest: pick(c.rest, REST_CHOICES, 15), rounds: pick(c.rounds, ROUND_CHOICES, 6) },
  };
}

const TOOLS = [
  { id: "metro", label: "METRONOME" },
  { id: "stop", label: "STOPWATCH" },
  { id: "int", label: "INTERVALS" },
];

export class Cadence {
  constructor(ctx) {
    this.ctx = ctx;
    this.navigation = true;
    this.clock = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
    const s = sanitize(ctx.progress?.());
    this.bpm = s.bpm; this.sig = s.sig; this.preset = s.preset; this.custom = s.custom; this.lastTool = s.tool;
    this.tool = "menu";
    this.paused = false; this.dead = false;
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
    this.leds = lightsOff();
    this.menu();
    this.startLoop();
  }

  startLoop() {
    if (typeof requestAnimationFrame !== "function") return;
    const loop = () => {
      if (this.dead || !this.ctx.alive()) return;
      try { this.frame(this.clock()); } catch {}
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  // ---- host hooks ----

  // The host forwards raw button edges here in every mode. Timing taken from them: a press
  // shorter than the hold threshold is a tap (the host treated it as "next"); a longer one
  // was a choice and is not counted.
  event(e) {
    if (!e || e.type !== "button" || this.paused || this.dead) return;
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
  }
  cancel() { this.down = null; }
  // The system menu opened. A running metronome keeps clicking and a running interval keeps
  // its time and its tones (the owner may be adjusting volume or looking something up); a
  // stopwatch must keep counting, and does, because it is computed from the clock. Only the
  // lamps are given up: the menu owns them while it is open.
  pause() { this.paused = true; this.down = null; }
  resume() { this.paused = false; this.down = null; this.ctx.leds(this.leds); }
  tick() { this.frame(this.clock()); }
  dispose() {
    this.dead = true;
    try { if (typeof cancelAnimationFrame === "function" && this.raf) cancelAnimationFrame(this.raf); } catch {}
    this.m.running = false; this.sw.running = false; this.iv.running = false; this.cues = [];
    this.persist();
    this.ctx.leds(lightsOff());
  }

  persist() {
    const saved = { schema: 1, bpm: this.bpm, sig: this.sig, preset: this.preset, tool: this.lastTool, custom: { ...this.custom } };
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
    if (this.tool === "stop") return stopwatchLamps(this.swElapsed(now), now - this.sw.lapAt, this.sw.running);
    if (this.tool === "int" && (this.iv.running || this.iv.doneAt >= 0)) {
      if (this.iv.running) return intervalLamps(intervalState(this.iv.cfg, this.ivSeconds(now)), now - this.iv.changeAt, 0);
      return intervalLamps({ phase: "done" }, 0, (now - this.iv.doneAt) / 1000);
    }
    return lightsOff();
  }

  show(values) {
    if (!Array.isArray(values) || values.length !== 9) values = lightsOff();
    this.leds = values.map(byte);
    // While the system menu is open it owns the lamps; sending would take them back.
    if (this.paused) return;
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
    t.src = src; t.times.push(stamp);
    if (t.times.length > TAP_WINDOW) t.times.shift();
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
    sw.laps.push({ split: Math.max(0, total - prev), total });
    sw.lapAt = this.clock();
    this.render(this.clock(), true);
  }
  resetStopwatch() {
    Object.assign(this.sw, { running: false, before: 0, laps: [], lapAt: -1e9 });
    this.build();
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
    this.build();
    this.render(this.clock(), true);
  }

  // ---- screens ----

  go(tool) {
    this.tool = tool;
    if (tool === "metro" || tool === "stop" || tool === "int") this.lastTool = tool;
    this.build(); this.render(this.clock(), true);
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
      default:
        return `<div class="utility-panel"><h2>CADENCE</h2><p>METRONOME, STOPWATCH AND INTERVALS. THE LAMPS KEEP THE TIME.</p></div>`;
    }
  }

  // Rebuild the action list for the current screen. Ids stay stable so the host keeps focus.
  build() {
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
        hint = "Tap to advance. Hold and release to choose. TAP TEMPO lets you tap the button along with the music.";
        break;
      }
      case "tap":
        items = [a("done", "DONE", () => { this.lastTool = "metro"; this.persist(); this.go("metro"); })];
        hint = "Tap the button in time with the music. Hold and release to finish.";
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
          hint = "The lamps drain across the period: green work, cyan rest, amber at the end.";
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
          a("ok", "DONE", () => this.go("int")),
        ];
        hint = "Each choice steps to its next value. DONE returns to the start screen.";
        break;
      }
      default: {
        const order = [...TOOLS.slice(TOOLS.findIndex((t) => t.id === this.lastTool)), ...TOOLS.slice(0, TOOLS.findIndex((t) => t.id === this.lastTool))];
        items = [...order.map((t) => a("tool-" + t.id, t.label, () => this.go(t.id))), a("home", "RETURN TO DASHBOARD", this.ctx.home)];
        hint = "Choose a tool. The lamps follow it.";
      }
    }
    this.ctx.actions(items);
    this.ctx.hint(hint);
  }
  menu() { this.build(); this.render(this.clock(), true); }

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
