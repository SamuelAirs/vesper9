// RESONANCE — a sound scope. It shows what the room sounds like, live: level, spectrum and
// pitch from the service's `analyze` microphone mode. Nothing is recognised, stored or kept;
// the readings are drawn and forgotten (the level history is a rolling two minutes in memory).
//
// Microphone rules. The microphone starts muted and opening the instrument never starts
// capture: the first action is START LISTENING. `owned` is true only while this instrument
// has switched the microphone to `analyze` itself; dispose() switches it off in that case and
// never otherwise, so a mode the owner started elsewhere (dictation, voice commands) is left
// alone. If another mode is active the screen says so and the action offers to switch.
// `owned` is dropped as soon as the service reports a different mode (a mute from the system
// menu, an error, a lost link).
//
// Drawing. Each page's markup is built once (ctx.content) and afterwards only attributes and
// text of existing elements change, found by id inside the panel, so the ten events a second
// neither rebuild the panel nor disturb the action list and its focus. All numbers shown go
// in with textContent; the markup itself holds literals only.
//
// Lamps. Level page: a bar across the three lamps. Spectrum page: low, middle and high thirds.
// Tuner page: left amber when flat, middle green in tune, right amber when sharp. Sustained
// light stays near a third of full; only a peak accent goes higher, briefly.
import { LAMP, dim, blend, lamps, lightsOff } from "../engine/lightshow.js";
import { clamp } from "../engine/math.js";
import { microphoneStatus } from "../engine/status.js";

export const PAGES = [
  { id: "level", name: "LEVEL" },
  { id: "spectrum", name: "SPECTRUM" },
  { id: "tuner", name: "TUNER" },
];
export const BAND_COUNT = 28;
export const HISTORY_BINS = 240; // 120 s at one bin per half second
export const BIN_MS = 500;
export const FLOOR_DB = -120;
export const METER_MIN_DB = -60; // bar meter and level lamps run from here to 0 dBFS
export const SPECTRUM_MIN_DB = -100; // the 28 bands read about -93 in a quiet room, -20 at a loud tone
export const SPECTRUM_MAX_DB = -20;
export const PEAK_HOLD_MS = 3000;
export const BAND_FALL_DB_S = 25; // slow-falling band peaks
export const CONFIDENT = 0.8;
export const MEDIAN_WINDOW = 5;
export const MEDIAN_MIN = 3; // estimates needed before a note is shown
export const MISS_LIMIT = 4; // consecutive unclear frames (0.4 s) that blank the tuner
export const IN_TUNE_CENTS = 5;
export const SUSTAIN = 0.3; // sustained lamp brightness (fraction of full)
export const ACCENT = 0.85; // brightness of a peak accent
const STALE_MS = 2000;
const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const MODE_NAMES = { commands: "VOICE COMMANDS", transcribe: "DICTATION" };
const INK = "#d9e5c9", PHOS = "#d6efa4", AMBER = "#e7b879", MUTED = "#94a58d", EDGE = "#39493b", RED = "#eb947a", CYAN = "#8fcbc5";

const finite = (v) => typeof v === "number" && Number.isFinite(v);
const db = (v) => (finite(v) ? clamp(v, FLOOR_DB, 0) : FLOOR_DB);
const fmtDb = (v) => (v <= -100 ? "< -100" : v.toFixed(1));
const frac = (v, lo, hi) => clamp((v - lo) / (hi - lo), 0, 1);

// Nearest equal-tempered note (A4 = 440 Hz) with the deviation in cents (-50..+50), or null.
export function noteFromHz(hz) {
  if (!finite(hz) || hz <= 0) return null;
  const midiExact = 69 + 12 * Math.log2(hz / 440);
  let midi = Math.round(midiExact);
  let cents = (midiExact - midi) * 100;
  if (Math.abs(cents) < 1e-9) cents = 0;
  if (midi < 0 || midi > 135) return null;
  return { midi, name: NOTES[midi % 12], octave: Math.floor(midi / 12) - 1, cents, hz };
}

export function median(list) {
  const v = list.filter(finite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// ---- lamp maths (pure; each returns nine whole numbers 0..255) -------------------------------

// A bar across the three lamps. f 0..1 is the (smoothed) level fraction, accent 0..1 a brief
// boost for a peak. Green on the left through amber, red above 85 % of the scale. While
// listening the left lamp keeps a faint glimmer so the room looks alive even when quiet.
export function levelLamps(f, accent = 0, listening = true) {
  const level = clamp(finite(f) ? f : 0, 0, 1);
  const boost = clamp(finite(accent) ? accent : 0, 0, 1);
  const hue = [LAMP.green, blend(LAMP.green, LAMP.amber, 0.75), LAMP.amber];
  const red = clamp((level - 0.85) / 0.15, 0, 1);
  const bright = SUSTAIN + (ACCENT - SUSTAIN) * boost;
  return lamps(...[0, 1, 2].map((i) => {
    let amount = clamp(level * 3 - i, 0, 1);
    if (i === 0 && listening) amount = Math.max(amount, 0.04);
    return dim(blend(hue[i], LAMP.red, red), bright * amount);
  }));
}

// Colour organ: three fractions (0..1) for the low, middle and high thirds.
export function spectrumLamps(low, mid, high) {
  const lit = (rgb, v) => dim(rgb, SUSTAIN * Math.pow(clamp(finite(v) ? v : 0, 0, 1), 1.2));
  return lamps(lit(LAMP.amber, low), lit(LAMP.green, mid), lit(LAMP.cyan, high));
}

// Tuner: null (no pitch) is dark. Within IN_TUNE_CENTS the middle lamp is green; flat lights
// the left lamp amber, sharp the right, brighter the further off.
export function tunerLamps(cents) {
  if (!finite(cents)) return lightsOff();
  const off = Math.abs(cents);
  if (off <= IN_TUNE_CENTS) return lamps(null, dim(LAMP.green, SUSTAIN), null);
  const level = dim(LAMP.amber, 0.08 + (SUSTAIN - 0.08) * clamp((off - IN_TUNE_CENTS) / (50 - IN_TUNE_CENTS), 0, 1));
  return cents < 0 ? lamps(level, null, null) : lamps(null, null, level);
}

// What the screen says about the microphone. `info`: { owned, pending, error, stale }.
export function scopeStatus(state, info = {}) {
  const mic = state?.mic || {}, device = state?.device || {};
  const mode = mic.mode || "off", capture = !!device.capture;
  const connected = device.connected !== false;
  const listening = connected && mode === "analyze" && capture;
  const base = { listening, code: "muted", label: "MICROPHONE MUTED", detail: "Nothing is captured. Choose START LISTENING to begin." };
  if (!connected) return { ...base, listening: false, code: "link", label: "LINK LOST", detail: "The console link is down. The service switches the microphone off." };
  if (listening && info.stale) return { ...base, code: "nodata", label: "LISTENING / NO DATA", detail: "Capture is on but no readings are arriving." };
  if (listening) return { ...base, code: "listening", label: "LISTENING", detail: (info.owned ? "" : "Started elsewhere; it stays on when you leave. ") + "Capture confirmed by the node. Nothing is recognised or stored." };
  if (mode === "analyze") return { ...base, code: "waiting", label: "WAITING FOR CAPTURE", detail: "Requested, not yet confirmed by the node. " + microphoneStatus(state).label + "." };
  if (info.pending) return { ...base, code: "starting", label: "STARTING", detail: "Asking the node to start the microphone." };
  if (info.error) return { ...base, code: "error", label: "ANALYSIS ERROR", detail: String(info.error).slice(0, 160) };
  if (state?.controller === false) return { ...base, code: "monitor", label: "MONITOR TAB", detail: "This tab cannot control the microphone. Close the other tab and reload." };
  if (mode !== "off") {
    const name = MODE_NAMES[mode] || String(mode).toUpperCase();
    return { ...base, code: "other", label: "MICROPHONE BUSY / " + name, detail: name + " is on, started elsewhere. Switching ends it; leaving here then turns the microphone off." };
  }
  if (mic.error) return { ...base, code: "error", label: "MICROPHONE ERROR", detail: String(mic.error).slice(0, 160) };
  return base;
}

// ---- page markup (literals only) -------------------------------------------------------------

const header = (n) =>
  `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:6px">` +
  `<span id="rs-state" style="font-size:16px;letter-spacing:1px;color:${MUTED}">MICROPHONE MUTED</span>` +
  `<span id="rs-sim" style="font-size:14px;color:${AMBER}"></span>` +
  `<span class="data-label" style="margin:0">PAGE ${n} / ${PAGES.length} · ${PAGES[n - 1].name}</span></div>` +
  `<div id="rs-detail" style="font-size:14px;color:${MUTED};margin-bottom:6px;min-height:16px"></div>`;
const txt = (x, y, s, anchor = "middle", size = 14, fill = MUTED, id = "") =>
  `<text${id ? ` id="${id}"` : ""} x="${x}" y="${y}" text-anchor="${anchor}" font-size="${size}" fill="${fill}" stroke="none" font-family="inherit">${s}</text>`;
const foot = (s) => `<p style="font-size:14px;margin:6px 0 0;color:${MUTED}">${s}</p>`;

function levelPage() {
  const barX = (v) => 10 + frac(v, METER_MIN_DB, 0) * 360;
  const ticks = [-60, -40, -20, 0].map((v) => `<line x1="${barX(v)}" y1="26" x2="${barX(v)}" y2="32" stroke="${MUTED}" stroke-width="1.5"/>` + txt(barX(v), 46, v, "middle", 14)).join("");
  const y = (v) => 8 + (-v / 90) * 132;
  const grid = [-20, -40, -60, -80].map((v) => `<line x1="40" y1="${y(v)}" x2="470" y2="${y(v)}" stroke="${EDGE}" stroke-width="1" stroke-dasharray="3 5"/>` + txt(34, y(v) + 4, v, "end", 13)).join("");
  return header(1) +
    `<div style="display:grid;grid-template-columns:5fr 6fr;gap:18px;align-items:start">` +
    `<div><div class="data-label">LEVEL, DBFS (RE MICROPHONE FULL SCALE)</div>` +
    `<div class="big-readout" id="rs-db" style="font-size:44px;line-height:1.1">—</div>` +
    `<div id="rs-peak" style="font-size:14px;color:${AMBER};margin:2px 0 8px">PEAK HOLD —</div>` +
    `<svg viewBox="0 0 380 52" width="100%" height="52" style="display:block" role="img" aria-label="Level meter">` +
    `<rect x="10" y="4" width="360" height="22" fill="none" stroke="${EDGE}" stroke-width="2"/>` +
    `<rect id="rs-bar" x="12" y="6" width="0" height="18" fill="${PHOS}" fill-opacity="0.55"/>` +
    `<line id="rs-hold" x1="10" y1="0" x2="10" y2="30" stroke="${AMBER}" stroke-width="3" opacity="0"/>${ticks}</svg></div>` +
    `<div><div class="data-label">LAST TWO MINUTES · PEAK AMBER · LEVEL GREEN</div>` +
    `<svg viewBox="0 0 480 168" width="100%" height="150" style="display:block" role="img" aria-label="Level history">` +
    `<rect x="40" y="8" width="430" height="132" fill="none" stroke="${EDGE}" stroke-width="1.5"/>${grid}` +
    `<polyline id="rs-hist-peak" points="" fill="none" stroke="${AMBER}" stroke-width="1.5" stroke-linejoin="round"/>` +
    `<polyline id="rs-hist-rms" points="" fill="none" stroke="${PHOS}" stroke-width="2.5" stroke-linejoin="round"/>` +
    txt(40, 160, "-2:00", "start", 14) + txt(470, 160, "NOW", "end", 14) + `</svg></div></div>` +
    foot("Level relative to the microphone's full scale, not calibrated sound pressure. Lamps: bar across all three.");
}

function spectrumPage(edges) {
  const W = 880, H = 150, step = W / BAND_COUNT;
  const bars = Array.from({ length: BAND_COUNT }, (_, i) =>
    `<rect id="rs-b${i}" x="${(i * step + 2).toFixed(1)}" y="${H}" width="${(step - 4).toFixed(1)}" height="0" fill="${PHOS}" fill-opacity="0.6" stroke="${PHOS}" stroke-width="1"/>` +
    `<line id="rs-k${i}" x1="${(i * step + 2).toFixed(1)}" y1="${H}" x2="${((i + 1) * step - 2).toFixed(1)}" y2="${H}" stroke="${AMBER}" stroke-width="3" opacity="0"/>`).join("");
  const pos = (hz) => (Math.log(hz / edges[0]) / Math.log(edges[BAND_COUNT] / edges[0])) * W;
  const axis = [100, 200, 500, 1000, 2000, 5000].map((hz) =>
    `<line x1="${pos(hz).toFixed(1)}" y1="${H}" x2="${pos(hz).toFixed(1)}" y2="${H + 6}" stroke="${MUTED}" stroke-width="1.5"/>` +
    txt(pos(hz).toFixed(1), H + 22, hz >= 1000 ? hz / 1000 + " kHz" : hz + " Hz", "middle", 15)).join("");
  const thirds = [9, 19].map((i) => `<line x1="${(i * step).toFixed(1)}" y1="0" x2="${(i * step).toFixed(1)}" y2="${H}" stroke="${EDGE}" stroke-width="1" stroke-dasharray="3 6"/>`).join("") +
    txt(4, 12, "LOW LAMP", "start", 14) + txt(9 * step + 4, 12, "MIDDLE LAMP", "start", 14) + txt(19 * step + 4, 12, "HIGH LAMP", "start", 14);
  return header(2) +
    `<svg viewBox="0 0 ${W} ${H + 30}" width="100%" height="190" style="display:block" role="img" aria-label="Spectrum, 28 bands">` +
    `<line x1="0" y1="${H}" x2="${W}" y2="${H}" stroke="${EDGE}" stroke-width="2"/>${thirds}${bars}${axis}</svg>` +
    foot("28 bands, 60 Hz to 7 kHz, dB relative to full scale. Lamps: low, middle and high thirds.");
}

function tunerPage() {
  const X = (c) => 240 + (c / 50) * 220;
  const ticks = [-50, -25, 0, 25, 50].map((c) =>
    `<line x1="${X(c)}" y1="44" x2="${X(c)}" y2="${c === 0 ? 88 : 80}" stroke="${MUTED}" stroke-width="${c === 0 ? 3 : 2}"/>` + txt(X(c), 108, c > 0 ? "+" + c : c, "middle", 14)).join("");
  return header(3) +
    `<div style="display:grid;grid-template-columns:4fr 7fr;gap:18px;align-items:center">` +
    `<div style="text-align:center"><div class="big-readout" id="rs-note" style="font-size:84px;line-height:1">—</div>` +
    `<div id="rs-hz" style="font-size:20px;color:${INK}">— HZ</div>` +
    `<div id="rs-cents" style="font-size:20px;color:${AMBER}">SING OR WHISTLE A STEADY NOTE</div></div>` +
    `<svg viewBox="0 0 480 130" width="100%" height="140" style="display:block" role="img" aria-label="Tuning needle">` +
    `<rect x="${X(-IN_TUNE_CENTS)}" y="40" width="${X(IN_TUNE_CENTS) - X(-IN_TUNE_CENTS)}" height="52" fill="${PHOS}" fill-opacity="0.18"/>` +
    `<line x1="${X(-50)}" y1="66" x2="${X(50)}" y2="66" stroke="${EDGE}" stroke-width="2"/>${ticks}` +
    `<line id="rs-needle" x1="240" y1="30" x2="240" y2="100" stroke="${PHOS}" stroke-width="5" opacity="0"/>` +
    txt(20, 22, "FLAT", "start", 14, AMBER) + txt(460, 22, "SHARP", "end", 14, AMBER) + txt(240, 22, "IN TUNE", "middle", 14, PHOS) + `</svg></div>` +
    foot("A4 = 440 Hz, equal temperament. Lamps: left amber flat, middle green in tune, right amber sharp.");
}

// ---- the instrument --------------------------------------------------------------------------

export class Resonance {
  constructor(ctx) {
    this.ctx = ctx;
    this.navigation = true;
    const saved = ctx.progress?.();
    this.page = Number.isInteger(saved?.page) && saved.page >= 0 && saved.page < PAGES.length ? saved.page : 0;
    this.clock = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
    this.owned = false; // this instrument switched the microphone to analyze
    this.pending = false; // a start request is in flight
    this.err = null;
    this.dead = false;
    this.paused = false;
    this.lampsTouched = false;
    this.lastLamps = "";
    this.lastKey = "";
    this.cache = new Map();
    this.text = new Map();
    this.resetData();
    this.status = scopeStatus(ctx.state(), this.info());
    this.render();
    this.buildActions(true);
    this.hint();
  }

  resetData() {
    this.rms = this.peak = FLOOR_DB;
    this.bands = new Array(BAND_COUNT).fill(FLOOR_DB);
    this.bandPeaks = new Array(BAND_COUNT).fill(FLOOR_DB);
    this.hold = FLOOR_DB;
    this.holdAt = 0;
    this.hist = []; // { rms, peak } per bin, oldest first, at most HISTORY_BINS
    this.bin = null; // { at, rms, peak } filling
    this.pitchHist = [];
    this.pitchMiss = 0;
    this.note = null;
    this.simulated = null;
    this.lastAt = 0;
    this.lastEventAt = 0;
    this.lampLevel = 0;
    this.thirds = [0, 0, 0];
    this.accentAt = -1e9;
    this.seen = false; // an analysis frame has arrived in this listening session
  }

  info() {
    const now = this.clock();
    return { owned: this.owned, pending: this.pending, error: this.err, stale: this.seen && now - this.lastAt > STALE_MS };
  }
  get listening() { return this.status.listening; }

  // ---- DOM helpers: find by id, cache, touch only on change ----
  el(id) {
    if (typeof document === "undefined") return null;
    const c = this.cache.get(id);
    if (c && c.isConnected !== false) return c;
    const e = document.getElementById(id);
    if (e) this.cache.set(id, e);
    return e;
  }
  setText(id, value) {
    if (this.text.get("t" + id) === value) return;
    const e = this.el(id);
    if (!e) return;
    this.text.set("t" + id, value);
    e.textContent = value;
  }
  setAttr(id, name, value) {
    const key = "a" + id + name;
    if (this.text.get(key) === value) return;
    const e = this.el(id);
    if (!e) return;
    this.text.set(key, value);
    e.setAttribute(name, value);
  }

  // ---- microphone ----
  sync() {
    const mic = this.ctx.state().mic || {};
    if (!this.pending && this.owned && mic.mode !== "analyze") this.owned = false;
    if (mic.mode === "off" && !this.pending && mic.error && !this.err) this.err = mic.error;
    const was = this.status;
    this.status = scopeStatus(this.ctx.state(), this.info());
    if (!this.status.listening) this.seen = false;
    this.paintStatus();
    this.hint();
    if (!this.status.listening && was.listening) this.paintIdle();
    if (!this.status.listening) this.setLamps(lightsOff(), true);
    this.buildActions();
  }

  hint() {
    const text = this.listening
      ? "Listening. Tap to advance, hold and release to choose. STOP LISTENING or leaving the instrument mutes the microphone."
      : "Tap to advance. Hold and release to choose. The microphone stays off until you choose START LISTENING.";
    if (text !== this.lastHint) { this.lastHint = text; this.ctx.hint(text); }
  }

  start() {
    if (this.dead || this.pending) return;
    if (this.ctx.state().controller === false) {
      this.ctx.toast("This is a monitor tab. It cannot start the microphone.");
      return;
    }
    this.err = null;
    this.pending = true;
    this.owned = true;
    this.resetLive();
    this.sync();
    let result;
    try { result = this.ctx.setMic("analyze"); } catch (error) { result = Promise.reject(error); }
    return Promise.resolve(result).then(
      () => { this.pending = false; },
      (error) => { this.pending = false; this.err = (error && error.message) || "The microphone could not be started."; },
    ).then(() => {
      if (this.dead) return;
      // The service reports the mode before it answers; if it is not analyze now, nothing is ours.
      if ((this.ctx.state().mic || {}).mode !== "analyze") this.owned = false;
      this.sync();
    });
  }

  stop() {
    if (this.dead) return;
    this.owned = false;
    this.pending = false;
    let result;
    try { result = this.ctx.setMic("off"); } catch (error) { result = Promise.reject(error); }
    return Promise.resolve(result).catch((error) => { this.err = (error && error.message) || "The microphone could not be switched off."; }).then(() => { if (!this.dead) this.sync(); });
  }

  // Clear the live readings of a session (history and the chosen page stay).
  resetLive() {
    this.rms = this.peak = FLOOR_DB;
    this.bands.fill(FLOOR_DB);
    this.bandPeaks.fill(FLOOR_DB);
    this.pitchHist = [];
    this.pitchMiss = 0;
    this.note = null;
    this.bin = null;
    this.lampLevel = 0;
    this.thirds = [0, 0, 0];
    this.seen = false;
    this.lastAt = 0;
  }

  // ---- events ----
  event(e) {
    if (this.dead || !e || typeof e !== "object") return;
    try {
      switch (e.type) {
        case "analysis": this.onAnalysis(e); break;
        case "analysis_error":
          this.err = typeof e.error === "string" && e.error ? e.error : "The analysis failed.";
          this.owned = false;
          this.pending = false;
          this.resetLive();
          this.sync();
          this.paintIdle();
          break;
        case "mic":
        case "state":
        case "device":
        case "offline":
        case "node_reset":
          if (e.type === "offline" || e.type === "node_reset" || (e.type === "device" && e.connected === false)) {
            this.owned = false;
            this.pending = false;
            this.resetLive();
          }
          if (e.type === "mic" && e.mode === "analyze" && !e.error) this.err = null;
          this.sync();
          if (!this.listening) this.paintIdle();
          break;
        default:
      }
    } catch (error) {
      // Never throw out of event(); a bad frame is dropped.
      this.lastError = error;
    }
  }

  onAnalysis(e) {
    const mic = this.ctx.state().mic || {};
    // Late frames after a stop are dropped; frames just ahead of the mic event are accepted.
    if (mic.mode !== "analyze" && !this.pending) return;
    const now = this.clock();
    const dt = this.lastAt ? clamp((now - this.lastAt) / 1000, 0, 0.5) : 0.1;
    this.lastAt = now;
    this.seen = true;
    this.simulated = e.simulated === true;
    this.rms = db(e.rmsDb);
    this.peak = Math.max(db(e.peakDb), this.rms);
    if (Array.isArray(e.bands)) {
      for (let i = 0; i < BAND_COUNT; i++) {
        this.bands[i] = db(e.bands[i]);
        this.bandPeaks[i] = Math.max(this.bands[i], this.bandPeaks[i] - BAND_FALL_DB_S * dt);
      }
    }
    // Peak hold: the highest peak of the last few seconds.
    if (this.peak >= this.hold || now - this.holdAt > PEAK_HOLD_MS) { this.hold = this.peak; this.holdAt = now; }
    // Rolling history, one bin per half second holding the loudest frame in it.
    if (!this.bin || now - this.bin.at >= BIN_MS) {
      if (this.bin) { this.hist.push({ rms: this.bin.rms, peak: this.bin.peak }); if (this.hist.length > HISTORY_BINS) this.hist.shift(); }
      this.bin = { at: now, rms: this.rms, peak: this.peak };
    } else {
      this.bin.rms = Math.max(this.bin.rms, this.rms);
      this.bin.peak = Math.max(this.bin.peak, this.peak);
    }
    this.pitch(e.pitch);
    if (this.peak >= -6) this.accentAt = now;
    // Lamp state: fast attack, slow release.
    const f = frac(this.rms, METER_MIN_DB, 0);
    this.lampLevel = Math.max(f, this.lampLevel - 1.5 * dt);
    const third = Math.floor(BAND_COUNT / 3);
    this.thirds = [0, 1, 2].map((k) => {
      const a = k * third, z = k === 2 ? BAND_COUNT : a + third;
      let max = 0, sum = 0;
      for (let i = a; i < z; i++) { const v = frac(this.bands[i], -95, -35); max = Math.max(max, v); sum += v; }
      return Math.max(0.5 * (max + sum / (z - a)), this.thirds[k] - 1.2 * dt);
    });
    if (this.status.code !== "listening") this.sync();
    this.drive(now);
    this.paintLive();
  }

  pitch(p) {
    const ok = p && typeof p === "object" && finite(p.hz) && finite(p.confidence) && p.confidence >= CONFIDENT && p.hz >= 40 && p.hz <= 2000;
    if (ok) {
      this.pitchHist.push(p.hz);
      if (this.pitchHist.length > MEDIAN_WINDOW) this.pitchHist.shift();
      this.pitchMiss = 0;
    } else if (++this.pitchMiss >= MISS_LIMIT) {
      this.pitchHist = [];
      this.note = null;
    }
    if (this.pitchHist.length >= MEDIAN_MIN) this.note = noteFromHz(median(this.pitchHist));
    else if (!this.pitchHist.length) this.note = null;
  }

  // The lamps for the current page and data.
  lampValues(now) {
    if (!this.listening || this.status.code === "nodata") return lightsOff();
    switch (PAGES[this.page].id) {
      case "spectrum": return spectrumLamps(...this.thirds);
      case "tuner": return tunerLamps(this.note ? this.note.cents : null);
      default: return levelLamps(this.lampLevel, clamp(1 - (now - this.accentAt) / 400, 0, 1), true);
    }
  }
  drive(now = this.clock()) { this.setLamps(this.lampValues(now)); }
  setLamps(values, offOnly = false) {
    const key = values.join(",");
    if (key === this.lastLamps || this.paused) return;
    // Leave the lamps to the host until there is something to show.
    if (offOnly && !this.lampsTouched) return;
    this.lastLamps = key;
    this.lampsTouched = true;
    this.ctx.leds(values);
  }

  // ---- painting ----
  paintStatus() {
    const s = this.status;
    this.setText("rs-state", (s.listening ? "● " : "○ ") + s.label);
    this.setAttr("rs-state", "style", `font-size:16px;letter-spacing:1px;color:${s.listening ? RED : s.code === "muted" ? MUTED : AMBER};${s.listening ? "font-weight:bold" : ""}`);
    this.setText("rs-detail", s.detail);
    const sim = this.simulated ?? (this.listening ? !!this.ctx.simulated?.() : null);
    this.setText("rs-sim", this.listening && sim ? "SIMULATED SIGNAL, NOT A REAL MICROPHONE" : "");
  }

  paintIdle() {
    this.paintLive();
  }

  paintLive() {
    if (typeof document === "undefined") return;
    this.paintStatus();
    const live = this.listening && this.seen && this.status.code !== "nodata";
    switch (PAGES[this.page].id) {
      case "level": {
        this.setText("rs-db", live ? fmtDb(this.rms) + " dBFS" : "— dBFS");
        this.setText("rs-peak", live ? "PEAK HOLD " + fmtDb(this.hold) + " dBFS" : "PEAK HOLD —");
        const f = frac(this.rms, METER_MIN_DB, 0);
        this.setAttr("rs-bar", "width", live ? (f * 356).toFixed(1) : "0");
        this.setAttr("rs-bar", "fill", f > 0.95 ? RED : f > 0.8 ? AMBER : PHOS);
        const hx = 10 + frac(this.hold, METER_MIN_DB, 0) * 360;
        this.setAttr("rs-hold", "x1", hx.toFixed(1));
        this.setAttr("rs-hold", "x2", hx.toFixed(1));
        this.setAttr("rs-hold", "opacity", live ? "1" : "0");
        this.paintHistory();
        break;
      }
      case "spectrum":
        for (let i = 0; i < BAND_COUNT; i++) {
          const h = live ? frac(this.bands[i], SPECTRUM_MIN_DB, SPECTRUM_MAX_DB) * 126 : 0;
          this.setAttr("rs-b" + i, "y", (150 - h).toFixed(1));
          this.setAttr("rs-b" + i, "height", h.toFixed(1));
          const p = frac(this.bandPeaks[i], SPECTRUM_MIN_DB, SPECTRUM_MAX_DB) * 126;
          this.setAttr("rs-k" + i, "y1", (150 - p).toFixed(1));
          this.setAttr("rs-k" + i, "y2", (150 - p).toFixed(1));
          this.setAttr("rs-k" + i, "opacity", live && p > 1 ? "1" : "0");
        }
        break;
      default: {
        const n = live ? this.note : null;
        this.setText("rs-note", n ? n.name + n.octave : "—");
        this.setText("rs-hz", n ? n.hz.toFixed(1) + " HZ" : "— HZ");
        const near = n && Math.abs(n.cents) <= IN_TUNE_CENTS;
        this.setText("rs-cents", n ? (near ? "IN TUNE " : n.cents < 0 ? "FLAT " : "SHARP ") + (n.cents >= 0 ? "+" : "") + n.cents.toFixed(1) + " CENTS" : live ? "NO CLEAR PITCH" : "SING OR WHISTLE A STEADY NOTE");
        this.setAttr("rs-cents", "style", `font-size:20px;color:${near ? PHOS : n ? AMBER : MUTED}`);
        const x = 240 + (n ? clamp(n.cents, -50, 50) / 50 : 0) * 220;
        this.setAttr("rs-needle", "x1", x.toFixed(1));
        this.setAttr("rs-needle", "x2", x.toFixed(1));
        this.setAttr("rs-needle", "stroke", near ? PHOS : AMBER);
        this.setAttr("rs-needle", "opacity", n ? "1" : "0");
      }
    }
  }

  paintHistory() {
    const bins = this.bin ? [...this.hist, this.bin] : this.hist;
    const n = bins.length;
    const pts = (key) => {
      let s = "";
      for (let i = 0; i < n; i++) {
        const x = 470 - (n - 1 - i) * (430 / (HISTORY_BINS - 1));
        const y = 8 + clamp(-bins[i][key] / 90, 0, 1) * 132;
        s += (i ? " " : "") + x.toFixed(1) + "," + y.toFixed(1);
      }
      return s;
    };
    this.setAttr("rs-hist-rms", "points", pts("rms"));
    this.setAttr("rs-hist-peak", "points", pts("peak"));
  }

  // ---- layout ----
  render() {
    const id = PAGES[this.page].id;
    const edges = this.ctx.state().mic?.analysis?.edgesHz;
    const usable = Array.isArray(edges) && edges.length === BAND_COUNT + 1 && edges.every(finite) ? edges : Array.from({ length: BAND_COUNT + 1 }, (_, i) => 60 * Math.pow(7000 / 60, i / BAND_COUNT));
    const body = id === "spectrum" ? spectrumPage(usable) : id === "tuner" ? tunerPage() : levelPage();
    this.cache.clear();
    this.text.clear();
    this.ctx.content(`<div class="utility-panel" style="padding:10px 18px">${body}</div>`);
    this.paintLive();
  }

  nextPage() {
    this.page = (this.page + 1) % PAGES.length;
    this.ctx.saveProgress?.({ schema: 1, page: this.page })?.catch?.(this.ctx.error);
    this.render();
    this.drive();
  }

  clearReadings() {
    this.hist = [];
    this.bin = null;
    this.hold = FLOOR_DB;
    this.holdAt = 0;
    this.bandPeaks.fill(FLOOR_DB);
    this.pitchHist = [];
    this.pitchMiss = 0;
    this.note = null;
    this.paintLive();
  }

  buildActions(park = false) {
    if (this.dead) return;
    const s = this.status;
    const on = this.owned || this.pending || this.listening || (this.ctx.state().mic || {}).mode === "analyze";
    const mode = (this.ctx.state().mic || {}).mode;
    const label = on ? "STOP LISTENING"
      : s.code === "other" ? "SWITCH MIC TO SCOPE (ENDS " + (MODE_NAMES[mode] || String(mode).toUpperCase()) + ")"
      : "START LISTENING";
    const key = label;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const items = [
      { id: "listen", label, run: () => (on ? this.stop() : this.start()) },
      { id: "page", label: "NEXT PAGE", run: () => this.nextPage() },
      { id: "clear", label: "CLEAR PEAK AND HISTORY", run: () => this.clearReadings() },
      { id: "home", label: "RETURN TO DASHBOARD", run: this.ctx.home },
    ];
    // On opening the host would start the highlight on the row numbered like the dashboard card
    // that was chosen (RETURN TO DASHBOARD for this one), so a one-item list pins it first.
    if (park) this.ctx.actions([items[0]]);
    this.ctx.actions(items);
  }

  tick() {
    if (this.dead) return;
    const was = this.status.code;
    this.sync();
    if (this.status.code !== was) { this.drive(); this.paintLive(); }
  }
  cancel() {}
  // While the system menu is open it owns the lamps; they return with the next reading.
  pause() { this.paused = true; }
  resume() {
    this.paused = false;
    this.lastLamps = "";
    if (this.lampsTouched) this.drive();
  }
  dispose() {
    this.dead = true;
    // Switch the microphone off only if this instrument switched it on.
    if (this.owned) {
      this.owned = false;
      try { Promise.resolve(this.ctx.setMic("off")).catch(() => {}); } catch {}
    }
    this.pending = false;
    this.ctx.leds(lightsOff());
  }
}
