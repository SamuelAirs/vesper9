// Raw edges remain immediate. The menu gesture can already have affected a game when it completes.
//
// The one menu gesture, in every app and on the dashboard: TAP, TAP, HOLD. Two quick taps, then a
// third press that stays down for `holdMs`. `tapMs` is the longest press that still counts as a tap,
// `gapMs` the longest release-to-press pause between the three presses. The three presets are the
// "gesture pace" setting.
export const GESTURE_PACES = {
  quick: { tapMs: 120, gapMs: 180, holdMs: 900 },
  standard: { tapMs: 150, gapMs: 220, holdMs: 1000 },
  relaxed: { tapMs: 220, gapMs: 320, holdMs: 1100 },
};
export const GESTURE_TAPS = 2;
// In navigation contexts a hold of `holdMs` setting (650 ms by default) already chooses on release.
// The gesture's hold must run this much past that, so "tap, tap, choose" is never taken for it.
export const SELECT_MARGIN_MS = 350;
// Navigation contexts keep a plain long hold as a silent fallback (no sound, no cost). Games do not.
export const FALLBACK_HOLD_MS = 3000;
// A raw-mode press that nothing has confirmed for this long lost its release. Games such as
// Undertow are played with long holds, so this is far beyond any real one.
export const RAW_STUCK_MS = 30000;
// A node STATUS that says "up" this soon after a press may have been composed before it.
const STATUS_GRACE_MS = 250;
const MIN_TAP_MS = 8;

export const paceOf = (name) => GESTURE_PACES[name] || GESTURE_PACES.standard;
// How long the third press must stay down. `selectMs` is the navigation selection threshold, or 0
// in a game where a hold means nothing to the host.
export const gestureHoldMs = (pace, selectMs = 0) => Math.max(pace.holdMs, selectMs ? selectMs + SELECT_MARGIN_MS : 0);

// What an app needs to take back a gesture that has already reached it: the presses it has seen
// (when each began and ended, in the app's own clock, seconds) and a snapshot taken at each one.
// An app calls mark() at the top of its down handler and release() in its up handler; when the host
// calls cancel(), match() says whether the recent presses were tap, tap, and a third press that is
// still down for about the gesture's hold. It never delays or changes any press.
export class GestureTimeline {
  constructor(settings = () => ({})) { this.settings = settings; this.marks = []; }
  mark(at, state) {
    this.marks.push({ at, up: null, state });
    if (this.marks.length > 6) this.marks.shift();
  }
  release(at) { const last = this.marks.at(-1); if (last && last.up === null) last.up = at; }
  // The first mark of the gesture when the presses fit it, else null. Consumes the history.
  match(now) {
    const marks = this.marks; this.marks = [];
    if (marks.length < GESTURE_TAPS + 1) return null;
    const pace = paceOf(this.settings().gesturePace), slop = 0.15;
    const tap = pace.tapMs / 1000 + slop, gap = pace.gapMs / 1000 + slop;
    const taps = marks.slice(-(GESTURE_TAPS + 1)), last = taps.at(-1);
    // The terminal release is consumed by the host, so the last press has no release yet. In a
    // navigation context the hold may be longer than the pace's (see gestureHoldMs), so only the
    // lower bound is checked: the host decides when to open the menu.
    if (last.up !== null || now - last.at < pace.holdMs / 1000 * 0.7) return null;
    for (let i = 0; i < GESTURE_TAPS; i++) {
      if (taps[i].up === null || taps[i].up - taps[i].at > tap) return null;
      if (taps[i + 1].at - taps[i].up > gap) return null;
    }
    return taps[0];
  }
  // Could a gesture that began at a press already seen still complete? True while the latest press might
  // yet be a tap, or lies between the taps, or is a third press held after two quick taps and still
  // short of the gesture's hold. False once the chain is broken: nothing seen so far can be undone.
  possible(now) {
    const marks = this.marks, last = marks.at(-1);
    if (!last) return false;
    const settings = this.settings(), pace = paceOf(settings.gesturePace), slop = 0.15;
    const tap = pace.tapMs / 1000 + slop, gap = pace.gapMs / 1000 + slop;
    const quick = (k) => k.up !== null && k.up - k.at <= tap;
    const linked = (a, b) => quick(a) && b.at - a.up <= gap;
    if (last.up === null) {
      if (now - last.at <= pace.tapMs / 1000 + 0.05) return true; // it may still turn out to be a tap
      if (now - last.at > gestureHoldMs(pace, settings.holdMs || 0) / 1000 + 0.3) return false;
      const first = marks.at(-3), second = marks.at(-2);
      return !!first && !!second && linked(first, second) && linked(second, last);
    }
    return quick(last) && now - last.up <= gap;
  }
}

// A deep copy that keeps shared references (a property that points into another property's array
// still does after the copy) and shares anything that is not plain data: class instances, functions,
// the app context. Typed arrays, Maps and Sets are copied.
function copyData(value, memo) {
  if (value === null || typeof value !== "object") return value;
  if (memo.has(value)) return memo.get(value);
  let out;
  if (Array.isArray(value)) {
    out = new Array(value.length); memo.set(value, out);
    for (let i = 0; i < value.length; i++) out[i] = copyData(value[i], memo);
    return out;
  }
  if (ArrayBuffer.isView(value)) { out = value.slice(); memo.set(value, out); return out; }
  if (value instanceof Map) {
    out = new Map(); memo.set(value, out);
    for (const [k, v] of value) out.set(k, copyData(v, memo));
    return out;
  }
  if (value instanceof Set) { out = new Set(value); memo.set(value, out); return out; }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  out = Object.create(proto); memo.set(value, out);
  for (const key of Object.keys(value)) out[key] = copyData(value[key], memo);
  return out;
}

// Tolerance for the menu gesture in an app whose state is plain data (every game after the first six,
// the two original games with their own run handling, Signal School and the instruments that read
// raw button edges). It works like GestureGuard, without a list of fields:
//  - down() calls mark(), up() calls release(), update(dt) calls tick(dt); cancel() calls rewind() first;
//    pause() and dispose() call settle(). Nothing about a press is delayed.
//  - mark() copies every plain-data property of the app (and the context's random generator), minus
//    `skip` (large tables that never change). When the host calls cancel() and the recent presses are
//    tap, tap and a third press still held, rewind() puts all of it back as it was at the first tap.
//  - ctx.score() and ctx.saveProgress() are held back only while a gesture that began at an earlier press
//    could still complete (GestureTimeline.possible: a quick tap just released, a press that may still be a
//    tap, a third press being held after two quick taps), then released as soon as the chain is broken, and
//    when the player leaves (settle). Otherwise they run at once. A gesture drops what was held since its
//    first tap, so a death, a lesson, a catch or a purchase that the gesture made is never saved.
// What it does not undo: the best score already raised (it is a high-water mark) and anything the
// app sent to the service directly with ctx.command (Light Trial cancels its own trial on pause).
export class AppGuard {
  constructor(app, ctx, { skip = [], settings } = {}) {
    this.app = app; this.c = ctx; this.skip = new Set(skip); this.t = 0;
    this.line = new GestureTimeline(settings || (() => ctx.settings?.() || {}));
    this.queue = []; this.open = true;
    for (const name of ["score", "saveProgress"]) {
      const original = ctx[name];
      if (typeof original !== "function") continue;
      ctx[name] = (...args) => this.hold(name, () => original.apply(ctx, args));
    }
  }
  // Is this property plain data that a snapshot saves and a rewind restores?
  saves(key, value) {
    if (this.skip.has(key) || typeof value === "function" || value === this.c || value === this) return false;
    if (value !== null && typeof value === "object") {
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null && !Array.isArray(value) && !ArrayBuffer.isView(value) && !(value instanceof Map) && !(value instanceof Set)) return false;
    }
    return true;
  }
  snapshot() {
    const memo = new Map(), saved = {};
    for (const key of Object.keys(this.app)) if (this.saves(key, this.app[key])) saved[key] = copyData(this.app[key], memo);
    return { saved, rng: this.c.rng?.state };
  }
  mark() { this.open = true; this.line.mark(this.t, this.snapshot()); }
  release() { this.line.release(this.t); }
  tick(dt) {
    this.t += dt;
    if (this.queue.length && !this.line.possible(this.t)) this.flush();
  }
  flush() {
    const all = this.queue; this.queue = [];
    for (const entry of all) entry.run();
  }
  // Call at the top of cancel(). Returns whether a gesture was taken back.
  rewind() {
    const first = this.line.match(this.t);
    if (!first) return false;
    // Properties the app created since are plain data too: they go, as if the gesture had not happened.
    for (const key of Object.keys(this.app)) if (!(key in first.state.saved) && this.saves(key, this.app[key])) delete this.app[key];
    Object.assign(this.app, first.state.saved);
    if (first.state.rng !== undefined && this.c.rng) this.c.rng.state = first.state.rng;
    this.queue = this.queue.filter((entry) => entry.at < first.at);
    return true;
  }
  hold(name, run) {
    if (!this.open || !this.line.possible(this.t)) return run();
    this.queue.push({ at: this.t, run });
    return name === "saveProgress" ? Promise.resolve({ deferred: true }) : undefined;
  }
  // Save everything held back: the player is leaving or the menu is open.
  settle() {
    this.open = false;
    this.flush();
  }
}

export class InputRouter {
  constructor(host, clock = () => performance.now()) {
    this.host = host; this.clock = clock; this.press = null;
    this.blocked = false; this.sequence = null;
  }
  policy() { return this.host.escapePolicy?.() || { pace: 'standard' }; }
  pace() { return paceOf(this.policy().pace); }
  stamp(e) { return Number.isFinite(e.at_us) ? e.at_us / 1000 : this.clock(); }
  // The hold this press needs to complete the gesture: longer in a menu, so choosing never gets there first.
  thresholdMs(press) {
    return gestureHoldMs(this.pace(), press.mode === 'menu' ? this.host.holdMs() : 0);
  }
  // Seen by apps through ctx.menuGesture(): is a third press being counted right now?
  gestureState() {
    const press = this.press;
    if (!press?.armed || press.consumed) return { armed: false, elapsedMs: 0, thresholdMs: 0, progress: 0 };
    const elapsedMs = this.clock() - press.at, thresholdMs = this.thresholdMs(press);
    return { armed: true, elapsedMs, thresholdMs, progress: Math.min(1, elapsedMs / thresholdMs) };
  }
  resetSequence() {
    this.sequence = null;
    this.host.clickVisual?.(0);
  }
  down(event = {}) {
    if (event.repeat || this.blocked || this.press) return;
    const mode = this.host.inputMode(), at = this.clock();
    const source = event.source || 'local', generation = event.generation ?? 0;
    const seq = this.sequence, pace = this.pace(), stamp = this.stamp(event);
    if (seq && (seq.source !== source || seq.generation !== generation || seq.epoch !== this.host.epoch || seq.mode !== mode ||
        stamp - seq.end > pace.gapMs || stamp < seq.end || at - seq.received > pace.gapMs + 100)) this.resetSequence();
    const live = this.sequence;
    // The third press of tap, tap, hold. A sequence of three or more taps is not the gesture.
    const armed = !!live && live.count === GESTURE_TAPS;
    // Where the highlight stood before the first tap, so the gesture can put it back.
    const mark = live ? live.mark : this.host.focusMark?.() ?? null;
    this.press = { at, stamp, epoch: this.host.epoch, mode, event, source, generation, consumed: false, armed, mark };
    this.host.pressVisual(true);
    if (mode === 'raw') this.host.rawDown(event);
  }
  up(event = {}) {
    if (this.blocked) {
      if (!this.blockSource || !event.source || event.source === this.blockSource) {
        this.blocked = false; this.blockSource = null;
      }
      return;
    }
    const press = this.press;
    if (!press || (event.source && press.event.source && event.source !== press.event.source)) return;
    if ((event.generation ?? 0) !== press.generation) { this.cancel(); return; }
    const durationMs = this.stamp(event) - press.stamp;
    this.press = null; this.host.pressVisual(false);
    if (press.consumed || press.epoch !== this.host.epoch || durationMs < 0) { this.resetSequence(); return; }
    // The node's timestamps say the hold was long enough (a burst of events can arrive together,
    // and a stalled frame can hide the threshold): the gesture still completes, on release.
    if (press.armed && durationMs >= this.thresholdMs(press)) { this.open(press, 'gesture'); return; }
    const pace = this.pace(), menu = press.mode === 'menu';
    const select = menu && durationMs >= this.host.holdMs();
    // A tap is a quick short press. In a menu it also moves the highlight, whatever its length.
    if (!select && durationMs >= MIN_TAP_MS && durationMs <= pace.tapMs) {
      const end = this.stamp(event), received = this.clock();
      const seq = this.sequence || { count: 0, start: press.stamp, source: press.source, generation: press.generation,
        epoch: press.epoch, mode: press.mode, mark: press.mark };
      Object.assign(seq, { count: seq.count + 1, end, received });
      this.sequence = seq;
      this.host.clickVisual?.(seq.count <= GESTURE_TAPS ? seq.count : 0);
    } else this.resetSequence();
    if (menu) { select ? this.host.select() : this.host.advance(); return; }
    this.host.rawUp({ ...event, durationMs });
  }
  // The gesture is complete (or the silent fallback hold): consume this press and open the menu
  // from the current context. The host puts the highlight back, cancels held input and swallows the release.
  open(press, via) {
    press.consumed = true;
    const focus = via === 'gesture' ? press.mark : null;
    this.resetSequence();
    this.host.requestMenu(via, { focus });
  }
  update() {
    const pace = this.pace();
    // The pause after the last tap runs out. (While the third press is down it is judged by its hold.)
    if (this.sequence && !this.press && this.clock() - this.sequence.received > pace.gapMs + 100) this.resetSequence();
    if (!this.press) return;
    const quiet = this.clock() - Math.max(this.press.at, this.press.confirmed ?? 0);
    if (this.press.mode === 'raw' && quiet > RAW_STUCK_MS) { this.cancel(); return; }
    const press = this.press, elapsed = this.clock() - press.at, menu = press.mode === 'menu';
    if (press.armed && !press.consumed) {
      const threshold = this.thresholdMs(press);
      // The bar fills towards the menu. In a menu, past the selection threshold a release still chooses.
      this.host.holdVisual(Math.min(1, elapsed / threshold), menu && elapsed >= this.host.holdMs(), true);
      if (elapsed >= threshold) this.open(press, 'gesture');
      return;
    }
    if (menu) this.host.holdVisual(Math.min(1, elapsed / this.host.holdMs()), elapsed >= this.host.holdMs(), false);
    if (menu && elapsed >= FALLBACK_HOLD_MS && !press.consumed) this.open(press, 'hold');
  }
  reconcile(pressed, source = 'node') {
    const press = this.press;
    if (press && press.source === source) {
      // The node's own report outranks our bookkeeping: up means a release frame was lost.
      if (pressed === false && this.clock() - press.at > STATUS_GRACE_MS) this.cancel();
      else if (pressed) press.confirmed = this.clock();
    }
    if (!this.blocked || (this.blockSource && this.blockSource !== source)) return;
    if (pressed === false) { this.blocked = false; this.blockSource = null; this.resetSequence(); }
  }
  // A knock on the case (docs/PROTOCOL.md): a second input that is a single instant, with no press
  // or release. It reaches the app (its knock() method) only where button presses do: never in a
  // menu or navigation context, and not while a menu's press is still waiting for its release.
  // It does not touch the tap, tap, hold sequence. Returns whether the app was given it.
  knock(event = {}) {
    if (this.blocked || this.host.inputMode() !== 'raw') return false;
    this.host.rawKnock(event);
    return true;
  }
  cancel(waitForRelease = this.blocked, source = this.blockSource) {
    if (this.press?.mode === 'raw') this.host.rawCancel();
    this.press = null; this.blocked = waitForRelease; this.blockSource = source;
    this.resetSequence(); this.host.pressVisual(false);
  }
}
