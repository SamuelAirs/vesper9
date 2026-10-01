import { scaleLeds } from "./lightshow.js";
// The service accepts exactly nine integers from 0 to 255. Round and clamp what an app
// supplies; a malformed array (wrong length, non-numbers) yields null and is ignored.
export function normalizeLeds(values) {
  if (!Array.isArray(values) || values.length !== 9) return null;
  const out = [];
  for (const v of values) {
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    out.push(Math.max(0, Math.min(255, Math.round(v))));
  }
  return out;
}
// Link trouble is not the payload's fault, so it must not stop the retry.
const transient = (error) => error?.timedOut || /disconnected|reconnecting/i.test(error?.message || "");
// Ownership changes bump a generation: a late ACK cannot bless a newer owner's cache.
// Effects and release go straight to the bridge (which keeps order on the socket) so they
// never wait behind a command whose reply is slow or lost.
export class LightDirector {
  constructor(command, clock = () => performance.now(), timeoutMs = 2000) {
    this.command = command; this.clock = clock; this.generation = 0; this.timeoutMs = timeoutMs;
    this.desired = Array(9).fill(0); this.sent = null; this.failed = null;
    this.busy = null; this.last = -Infinity;
    this.suspendedUntil = 0;
    // Who drives the lamps: the host layer (web/engine/ambient.js) until an app calls leds(),
    // pattern or reaction; release() hands them back. scale is the global lamp level.
    this.owner = 'host'; this.scale = 1; this.raw = null;
  }
  invalidate() { this.generation++; this.sent = null; this.failed = null; }
  // An app's plain values: take the lamps and apply the lamp level.
  set(values) {
    const next = normalizeLeds(values);
    if (!next) return;
    this.owner = 'app'; this.raw = next;
    this.desired = scaleLeds(next, this.scale);
  }
  // The host layer's values (already levelled). Ignored while an app owns the lamps.
  setHost(values) {
    if (this.owner === 'app') return false;
    const next = normalizeLeds(values);
    if (!next) return false;
    this.desired = next;
    return true;
  }
  setScale(scale) {
    this.scale = scale;
    if (this.owner === 'app' && this.raw) this.desired = scaleLeds(this.raw, scale);
  }
  // Patterns get the lamp level too. A reaction cue is node-timed at fixed colours, so it is
  // sent as is (Light Trial stays playable whatever the level).
  effect(name, data) {
    this.invalidate(); this.desired = null; this.owner = 'app'; this.raw = null;
    if (name === 'pattern' && this.scale !== 1 && Array.isArray(data?.steps))
      data = { ...data, steps: data.steps.map((step) => (normalizeLeds(step?.values) ? { ...step, values: scaleLeds(step.values, this.scale) } : step)) };
    return this.command(name, data);
  }
  release() {
    this.owner = 'host'; this.raw = null;
    this.invalidate(); this.suspendedUntil = 0; this.desired = Array(9).fill(0);
    const generation = this.generation, zero = Array(9).fill(0);
    // Both are written now; the socket delivers them in order after anything already sent.
    const cancel = this.command('cancel', {});
    const write = Promise.resolve(this.command('leds', { values: zero })).then(() => {
      if (generation === this.generation) this.sent = zero.join(',');
    });
    return Promise.all([cancel, write]).then(() => undefined);
  }
  suspend(ms) { this.invalidate(); this.suspendedUntil = this.clock() + ms; }
  observe(values) { if (values?.join(',') !== this.sent) this.sent = null; }
  // A reply that never comes must not hold the lamps for the bridge's 20 s request timeout.
  withTimeout(promise) {
    let timer;
    const limit = new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error("Light command timed out"), { timedOut: true })), this.timeoutMs);
    });
    return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
  }
  async flush(connected = true) {
    const now = this.clock();
    // A command in flight blocks only its own generation; a newer owner may write at once.
    if (!connected || this.busy === this.generation || !this.desired || now < this.suspendedUntil || now - this.last < 60) return;
    const key = this.desired.join(',');
    if (key === this.sent || key === this.failed) return;
    const values = this.desired.slice(), generation = this.generation;
    this.busy = generation; this.last = now;
    try {
      await this.withTimeout(this.command('leds', { values }));
      if (generation === this.generation) this.sent = key;
    } catch (error) {
      if (generation === this.generation) { this.sent = null; if (!transient(error)) this.failed = key; }
    } finally { if (this.busy === generation) this.busy = null; }
  }
}
