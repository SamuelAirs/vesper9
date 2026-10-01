import { C, text } from "../engine/draw.js";
import { GestureTimeline } from "../engine/input.js";

export function recordRun(ctx, result) {
  const previous = ctx.progress?.() || {};
  ctx.saveProgress?.({ schema: 1, runs: (previous.runs || 0) + 1, last: result,
    milestone: Math.max(previous.milestone || 0, result.milestone || 0) })?.catch?.(ctx.error);
}
// A result screen ignores presses for this long, so a player who is tapping in rhythm sees it.
export const LOCKOUT = 0.6;
// A run that ends is recorded this long afterwards (or at once when the player leaves), which
// is longer than any menu gesture, so a death caused by the gesture's own taps can be undone.
export const SETTLE = 2;

const clone = (value) => structuredClone(value);

// The system menu opens on tap, tap, hold, and the two taps and the start of the hold have already
// reached the game as ordinary presses (docs/ENGINE.md, input contract). Edges stay immediate, so the
// game cannot know a press belongs to a gesture. Instead each press first saves the run's state; when
// the host calls cancel() and the last presses look like the gesture (two short taps at the configured
// pace, then a third press still down for about the hold), the game goes back to the state saved at the
// gesture's first tap. Nothing is delayed in normal play, and cancel() only follows a menu gesture or
// an interruption, so the rewind reaches back no further than the gesture window (about two seconds).
// A run that ends is not recorded straight away either (see end/settle), so a death that the
// gesture caused and the rewind undid never reaches the scores or the field record.
// (GestureGuard saves the named fields; AppGuard, in engine/input.js, saves everything and also holds back the
// score and the progress writes. Both recognise the gesture with GestureTimeline from engine/input.js.)
export class GestureGuard {
  constructor(game, ctx, fields) {
    this.game = game; this.c = ctx; this.fields = [...fields, "phase", "ended", "overAt"];
    this.t = 0; this.line = new GestureTimeline(() => ctx.settings?.() || {});
    // Finished runs whose game has already started another one, still waiting out the window.
    this.backlog = [];
    // A finished run gets a number when it ends; the ones already recorded are remembered, so a run that
    // was recorded while the gesture was under way and then restored by the rewind is not recorded twice.
    this.seq = 0; this.done = new Set();
  }
  snapshot() { const saved = {}; for (const key of this.fields) saved[key] = clone(this.game[key]); return saved; }
  tick(dt) {
    this.t += dt;
    if (this.game.ended && this.t - this.game.overAt >= SETTLE) { const ended = this.game.ended; this.game.ended = null; this.record(ended); }
    if (this.backlog.length && this.backlog[0].due <= this.t) this.record(this.backlog.shift());
  }
  // Call at the very top of down(), before the press changes anything.
  mark() { this.line.mark(this.t, this.snapshot()); }
  release() { this.line.release(this.t); }
  // Rewind after a menu gesture; returns whether it did.
  rewind() {
    const first = this.line.match(this.t);
    if (!first) return false;
    for (const [key, value] of Object.entries(first.state)) this.game[key] = clone(value);
    // A run that ended and was replaced during the gesture is part of what was just undone.
    this.backlog = this.backlog.filter((entry) => entry.stashed < first.at);
    if (this.game.ended && this.done.has(this.game.ended.id)) this.game.ended = null;
    return true;
  }
  // End the run now, record it later.
  end(score, run) {
    this.game.phase = "over"; this.game.overAt = this.t; this.game.ended = { score, run, id: ++this.seq };
  }
  // The game starts another run: the finished one waits in the backlog.
  stash() {
    const ended = this.game.ended; this.game.ended = null;
    if (ended) this.backlog.push({ ...ended, stashed: this.t, due: this.game.overAt + SETTLE });
  }
  record(ended) {
    this.done.add(ended.id);
    this.c.score(...ended.score);
    recordRun(this.c, ended.run);
  }
  // Record every finished run now: the player is leaving.
  settle() {
    const all = [...this.backlog, this.game.ended].filter(Boolean);
    this.backlog = []; this.game.ended = null;
    for (const ended of all) this.record(ended);
  }
  locked() { return this.game.phase === "over" && this.t - this.game.overAt < LOCKOUT; }
}

// ---------------------------------------------------------------------------------------------
// Lamps. Every game drives the three lamps through one LampBus: a resting picture computed each
// frame (null = dark), plus short events (flash) that overlay it. Values are whole numbers in
// steps of 8 so the light director's dedupe works, and a frame that changes nothing writes nothing.
// cancel() clears at once; pause() and dispose() also stop all further writes until resume().
const ZERO = Array(9).fill(0);
const q8 = (v) => Math.min(255, Math.max(0, Math.round(v / 8) * 8));
// Brightest of two nine-value pictures, so an accent can sit on top of the resting light.
export const lampMax = (a, b) => a.map((v, i) => Math.max(v, b[i]));
export class LampBus {
  constructor(ctx) { this.c = ctx; this.sent = null; this.live = true; this.fx = null; this.amb = ZERO; }
  put(values) {
    if (!this.live) return;
    const out = (values || ZERO).map(q8), key = out.join();
    if (key === this.sent) return;
    this.sent = key;
    this.c.leds?.(out);
  }
  // One frame: `ambient` is the resting picture; an active flash overlays it.
  frame(dt, ambient) {
    this.amb = ambient || ZERO;
    let out = ambient;
    if (this.fx) {
      this.fx.e += dt;
      if (this.fx.e >= this.fx.total) this.fx = null;
      else out = this.fx.fn(this.fx.e, this.fx.total, this.amb);
    }
    this.put(out);
  }
  // A timed event; fn(elapsed, total, ambient) returns nine values. It shows at once.
  flash(total, fn) { this.fx = { e: 0, total, fn }; this.put(fn(0, total, this.amb)); }
  clear() { this.fx = null; this.sent = null; const live = this.live; this.live = true; this.put(null); this.live = live; }
  sleep() { this.clear(); this.live = false; }
  wake() { this.live = true; this.sent = null; }
}
// Shows a short announcement near the top of the canvas while its timer runs.
export function announce(game, message, seconds = 3.2) { game.note = message; game.noteT = seconds; }
export function drawNote(g, game) {
  if (game.noteT > 0 && game.phase !== "over" && game.phase !== "title") text(g, game.note, 480, 44, 24, C.amber, "center");
}
const lerpValues = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
