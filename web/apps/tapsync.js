// Tap-along timing calibration, run from Calibration (Settings): the console plays a steady beat
// (a click, a pulse on screen and on the three lamps) and the player taps the button on it. The
// median distance from each tap to its beat is the console's input delay, saved as `latencyMs`
// (web/engine/latency.js). Taps are timed exactly as games time them: in the app's own clock,
// advanced by update(dt), at the moment down() arrives.
import { C, text, circle, line } from "../engine/draw.js";
import { LATENCY_MIN_MS, LATENCY_MAX_MS } from "../engine/latency.js";

export const BEAT_S = 0.6;          // 100 beats a minute
export const LEAD_BEATS = 4;        // listen first
export const TAP_BEATS = 16;        // then tap along
export const MIN_TAPS = 8;          // fewer than this and the result is not offered
export const UNEVEN_MS = 45;        // a spread wider than this reads as guessing, not a delay
const WINDOW_S = BEAT_S * 0.45;     // a tap further than this from any beat is not on the beat
const LAMP_ON = [80, 200, 190];

const median = (values) => {
  const v = values.slice().sort((a, b) => a - b), mid = v.length >> 1;
  return v.length ? (v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2) : 0;
};
// The offset to save and how much the taps agreed: { ms, spread, n, ok }.
// ms is the median, rounded to 5 ms and clamped to the setting's range; spread is the median
// absolute deviation. ok when there were enough taps and they agreed.
export function measure(offsetsMs) {
  const n = offsetsMs.length;
  if (!n) return { ms: 0, spread: 0, n: 0, ok: false };
  const mid = median(offsetsMs), spread = median(offsetsMs.map((x) => Math.abs(x - mid)));
  const ms = Math.max(LATENCY_MIN_MS, Math.min(LATENCY_MAX_MS, Math.round(mid / 5) * 5));
  return { ms, spread: Math.round(spread), n, ok: n >= MIN_TAPS && spread <= UNEVEN_MS };
}
export const describe = (ms) => (ms === 0 ? "ON TIME" : Math.abs(ms) + " ms " + (ms > 0 ? "LATE" : "EARLY"));

export class TapSync {
  // `done(result)` is called once, when the last beat has passed: result from measure().
  constructor(ctx, done) {
    this.c = ctx; this.done = done;
    this.t = -0.8;            // a short silence before the first beat
    this.beat = -1;           // the last beat sounded
    this.offsets = [];        // ms, one per tap that landed near a beat during the tap beats
    this.marks = [];          // every tap for the picture: { ms, used }
    this.finished = false;
    this.lit = false;
  }
  get total() { return LEAD_BEATS + TAP_BEATS; }
  update(dt) {
    if (this.finished) return;
    this.t += dt;
    const k = Math.floor(this.t / BEAT_S);
    if (k > this.beat && k < this.total) {
      this.beat = k;
      this.c.tone?.(k % 4 === 0 ? 1320 : 880, 0.05, "square");
    }
    const lit = this.t >= 0 && this.t - Math.max(0, this.beat) * BEAT_S < 0.09 && this.beat < this.total;
    if (lit !== this.lit) { this.lit = lit; this.c.leds?.(lit ? [...LAMP_ON, ...LAMP_ON, ...LAMP_ON] : [0, 0, 0, 0, 0, 0, 0, 0, 0]); }
    if (this.t > (this.total - 1) * BEAT_S + WINDOW_S + 0.1) {
      this.finished = true;
      this.c.leds?.([0, 0, 0, 0, 0, 0, 0, 0, 0]);
      this.done?.(measure(this.offsets));
    }
  }
  down() {
    if (this.finished || this.t < -0.2) return;
    const k = Math.round(this.t / BEAT_S), off = this.t - k * BEAT_S;
    if (k < 0 || k >= this.total || Math.abs(off) > WINDOW_S) return;
    const ms = off * 1000, used = k >= LEAD_BEATS;
    if (used) this.offsets.push(ms);
    this.marks.push({ ms, used });
  }
  up() {}
  draw(g) {
    g.fillStyle = C.bg; g.fillRect(0, 0, 960, 540);
    const lead = this.beat < LEAD_BEATS;
    text(g, "TIMING CALIBRATION", 480, 52, 22, C.muted, "center");
    text(g, this.beat < 0 ? "GET READY" : lead ? "LISTEN · " + (LEAD_BEATS - this.beat) : "TAP ON EVERY BEAT",
      480, 92, 30, lead ? C.amber : C.ink, "center");
    // The pulse: a ring that flashes on the beat and shrinks towards the next one.
    const phase = this.t < 0 ? 1 : (this.t % BEAT_S) / BEAT_S;
    const r = 70 + 40 * (1 - phase);
    circle(g, 480, 245, 70, C.line, false, 2);
    circle(g, 480, 245, r, phase < 0.15 ? C.ink : C.muted, false, phase < 0.15 ? 6 : 2);
    if (phase < 0.15 && this.t >= 0 && this.beat < this.total) circle(g, 480, 245, 54, C.ink, true);
    const left = Math.max(0, this.total - 1 - Math.max(this.beat, 0));
    text(g, lead ? "" : left + " BEATS LEFT", 480, 365, 18, C.muted, "center");
    // Every tap on a scale from 200 ms early to 200 ms late; the line in the middle is the beat.
    const x0 = 230, x1 = 730, y = 430, at = (ms) => x0 + (x1 - x0) * (Math.max(-200, Math.min(200, ms)) + 200) / 400;
    line(g, x0, y, x1, y, C.line, 2);
    line(g, 480, y - 18, 480, y + 18, C.muted, 2);
    text(g, "EARLY", x0, y + 32, 16, C.muted, "left");
    text(g, "LATE", x1, y + 32, 16, C.muted, "right");
    for (const m of this.marks) line(g, at(m.ms), y - 12, at(m.ms), y + 12, m.used ? C.amber : C.line, 3);
    if (this.offsets.length >= 3) {
      const est = measure(this.offsets).ms;
      circle(g, at(est), y, 7, C.cyan, true);
      text(g, describe(est), 480, y + 60, 18, C.cyan, "center");
    }
  }
}
