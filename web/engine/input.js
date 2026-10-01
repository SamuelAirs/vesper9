// Raw edges remain immediate. A menu sequence can already have affected a game.
export const GESTURE_PACES = {
  quick: { tapMs: 120, gapMs: 180, totalMs: 700 },
  standard: { tapMs: 150, gapMs: 220, totalMs: 900 },
  relaxed: { tapMs: 220, gapMs: 320, totalMs: 1350 },
};
// A raw-mode press that nothing has confirmed for this long lost its release. Games such as
// Undertow are played with long holds, so this is far beyond any real one.
export const RAW_STUCK_MS = 30000;
// A node STATUS that says "up" this soon after a press may have been composed before it.
const STATUS_GRACE_MS = 250;
export class InputRouter {
  constructor(host, clock = () => performance.now()) {
    this.host = host; this.clock = clock; this.press = null;
    this.blocked = false; this.sequence = null;
  }
  policy() { return this.host.escapePolicy?.() || { clicks: 0, pace: 'standard' }; }
  stamp(e) { return Number.isFinite(e.at_us) ? e.at_us / 1000 : this.clock(); }
  resetSequence() {
    this.sequence = null;
    this.host.clickVisual?.(0, this.policy().clicks);
  }
  down(event = {}) {
    if (event.repeat || this.blocked || this.press) return;
    const mode = this.host.inputMode(), at = this.clock();
    const source = event.source || 'local', generation = event.generation ?? 0;
    const seq = this.sequence, pace = GESTURE_PACES[this.policy().pace] || GESTURE_PACES.standard;
    if (seq && (seq.source !== source || seq.generation !== generation || seq.epoch !== this.host.epoch ||
        this.stamp(event) - seq.end > pace.gapMs || this.stamp(event) < seq.end ||
        at - seq.received > pace.gapMs + 100 || mode !== 'raw')) this.resetSequence();
    this.press = { at, stamp: this.stamp(event), epoch: this.host.epoch, mode, event, source, generation, consumed: false };
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
    if (press.mode === 'menu') {
      this.resetSequence();
      durationMs >= this.host.holdMs() ? this.host.select() : this.host.advance();
      return;
    }
    const policy = this.policy(), pace = GESTURE_PACES[policy.pace] || GESTURE_PACES.standard;
    if (policy.clicks && durationMs >= 8 && durationMs <= pace.tapMs) {
      const end = this.stamp(event), received = this.clock();
      const seq = this.sequence || { count: 0, start: press.stamp, source: press.source, generation: press.generation, epoch: press.epoch };
      const total = pace.totalMs * (policy.clicks / 4);
      if (end - seq.start > total) this.resetSequence();
      else {
        Object.assign(seq, { count: seq.count + 1, end, received });
        this.sequence = seq; this.host.clickVisual?.(seq.count, policy.clicks);
        if (seq.count >= policy.clicks) {
          this.resetSequence(); this.host.rawCancel(); this.host.systemMenu();
          return; // Terminal release never reaches the new menu or old game.
        }
      }
    } else this.resetSequence();
    this.host.rawUp({ ...event, durationMs });
  }
  update() {
    const policy = this.policy(), pace = GESTURE_PACES[policy.pace] || GESTURE_PACES.standard;
    if (this.sequence && this.clock() - this.sequence.received > pace.gapMs + 100) this.resetSequence();
    if (!this.press) return;
    const quiet = this.clock() - Math.max(this.press.at, this.press.confirmed ?? 0);
    if (this.press.mode === 'raw' && quiet > RAW_STUCK_MS) { this.cancel(); return; }
    const elapsed = this.clock() - this.press.at, menu = this.press.mode === 'menu';
    this.host.holdVisual(menu ? Math.min(1, elapsed / this.host.holdMs()) : policy.clicks ? 0 : Math.min(1, elapsed / 3000), menu && elapsed >= this.host.holdMs());
    if (elapsed >= 3000 && (menu || !policy.clicks) && !this.press.consumed) {
      this.press.consumed = true; this.resetSequence(); this.host.systemMenu();
    }
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
  cancel(waitForRelease = this.blocked, source = this.blockSource) {
    if (this.press?.mode === 'raw') this.host.rawCancel();
    this.press = null; this.blocked = waitForRelease; this.blockSource = source;
    this.resetSequence(); this.host.pressVisual(false);
  }
}
