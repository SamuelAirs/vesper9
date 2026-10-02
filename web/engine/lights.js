import { scaleLeds, padLamps, MAX_LAMPS } from "./lightshow.js";
const byteList = (values) => {
  const out = [];
  for (const v of values) {
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    out.push(Math.max(0, Math.min(255, Math.round(v))));
  }
  return out;
};
// Lamp values from an app: nine (three lamps, as every game was written) or twelve (four lamps).
// Rounded and clamped, and always returned as twelve: a three-lamp frame leaves the fourth lamp
// dark. A malformed array (another length, non-numbers) yields null and is ignored.
export function normalizeLeds(values) {
  if (!Array.isArray(values) || (values.length !== 9 && values.length !== MAX_LAMPS * 3)) return null;
  const out = byteList(values);
  return out && padLamps(out, MAX_LAMPS);
}
// The board LED's colour: three values, or null.
export function normalizeBoard(rgb) {
  if (!Array.isArray(rgb) || rgb.length !== 3) return null;
  return byteList(rgb);
}
// Link trouble is not the payload's fault, so it must not stop the retry.
const transient = (error) => error?.timedOut || /disconnected|reconnecting/i.test(error?.message || "");
// Ownership changes bump a generation: a late ACK cannot bless a newer owner's cache.
// Effects and release go straight to the bridge (which keeps order on the socket) so they
// never wait behind a command whose reply is slow or lost.
// Internally every frame is twelve values (four lamps). What goes to the service is cut to the
// node's own count, `lamps()` (three on the first node, four on the current one), so the service
// always gets the length it accepts. The board LED (`board()` true when the node has one) is
// written separately and only while an app drives it; the host never lights it.
export class LightDirector {
  constructor(command, clock = () => performance.now(), timeoutMs = 2000, { lamps = () => 3, board = () => false } = {}) {
    this.command = command; this.clock = clock; this.generation = 0; this.timeoutMs = timeoutMs;
    this.lamps = lamps; this.hasBoard = board;
    this.desired = Array(MAX_LAMPS * 3).fill(0); this.sent = null; this.failed = null;
    this.boardDesired = [0, 0, 0]; this.boardRaw = null; this.boardSent = null; this.boardBusy = false;
    this.busy = null; this.last = -Infinity;
    this.suspendedUntil = 0;
    // Who drives the lamps: the host layer (web/engine/ambient.js) until an app calls leds(),
    // pattern or reaction; release() hands them back. scale is the global lamp level.
    this.owner = 'host'; this.scale = 1; this.raw = null;
  }
  invalidate() { this.generation++; this.sent = null; this.failed = null; this.boardSent = null; }
  // The values for the node: the frame cut (or padded) to its lamp count.
  forNode(values) { return padLamps(values, this.lamps() === MAX_LAMPS ? MAX_LAMPS : 3); }
  // An app's board LED colour (with the lamp level). It takes the lamps for the app too.
  setBoard(rgb) {
    const next = normalizeBoard(rgb);
    if (!next) return;
    this.owner = 'app'; this.boardRaw = next;
    this.boardDesired = scaleLeds(next, this.scale);
  }
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
    if (this.boardRaw) this.boardDesired = scaleLeds(this.boardRaw, scale);
  }
  // Patterns get the lamp level too. A reaction cue is node-timed at fixed colours, so it is
  // sent as is (Light Trial stays playable whatever the level).
  effect(name, data) {
    this.invalidate(); this.desired = null; this.owner = 'app'; this.raw = null;
    if (name === 'pattern' && this.scale !== 1 && Array.isArray(data?.steps))
      data = { ...data, steps: data.steps.map((step) => (normalizeLeds(step?.values) ? { ...step, values: scaleLeds(step.values, this.scale) } : step)) };
    // A pattern written for three lamps runs on four with the fourth dark, and the other way round.
    if (name === 'pattern' && Array.isArray(data?.steps))
      data = { ...data, steps: data.steps.map((step) => (normalizeLeds(step?.values) ? { ...step, values: this.forNode(step.values) } : step)) };
    return this.command(name, data);
  }
  release() {
    this.owner = 'host'; this.raw = null;
    this.invalidate(); this.suspendedUntil = 0; this.desired = Array(MAX_LAMPS * 3).fill(0);
    const generation = this.generation, zero = this.forNode([]);
    // Both are written now; the socket delivers them in order after anything already sent.
    const cancel = this.command('cancel', {});
    const write = Promise.resolve(this.command('leds', { values: zero })).then(() => {
      if (generation === this.generation) this.sent = padLamps(zero).join(',');
    });
    const writes = [cancel, write];
    // The board LED goes dark with the app that lit it.
    if (this.boardRaw || this.boardDesired.some(Boolean)) {
      this.boardRaw = null; this.boardDesired = [0, 0, 0];
      if (this.hasBoard()) writes.push(Promise.resolve(this.command('board', { values: [0, 0, 0] })).then(() => { this.boardSent = '0,0,0'; }));
    }
    return Promise.all(writes).then(() => undefined);
  }
  suspend(ms) { this.invalidate(); this.suspendedUntil = this.clock() + ms; }
  observe(values) { if (!Array.isArray(values) || padLamps(values).join(',') !== this.sent) this.sent = null; }
  // A reply that never comes must not hold the lamps for the bridge's 20 s request timeout.
  withTimeout(promise) {
    let timer;
    const limit = new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error("Light command timed out"), { timedOut: true })), this.timeoutMs);
    });
    return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
  }
  async flush(connected = true) {
    const board = this.flushBoard(connected);
    await this.flushLamps(connected);
    await board;
  }
  async flushLamps(connected) {
    const now = this.clock();
    // A command in flight blocks only its own generation; a newer owner may write at once.
    if (!connected || this.busy === this.generation || !this.desired || now < this.suspendedUntil || now - this.last < 60) return;
    const key = this.desired.join(',');
    if (key === this.sent || key === this.failed) return;
    const values = this.forNode(this.desired), generation = this.generation;
    this.busy = generation; this.last = now;
    try {
      await this.withTimeout(this.command('leds', { values }));
      if (generation === this.generation) this.sent = key;
    } catch (error) {
      if (generation === this.generation) { this.sent = null; if (!transient(error)) this.failed = key; }
    } finally { if (this.busy === generation) this.busy = null; }
  }
  // The board LED: written when it changes, one command at a time, only on a node that has it.
  async flushBoard(connected) {
    if (!connected || this.boardBusy || !this.hasBoard()) return;
    const key = this.boardDesired.join(',');
    if (key === this.boardSent) return;
    this.boardBusy = true;
    try {
      await this.withTimeout(this.command('board', { values: this.boardDesired.slice() }));
      this.boardSent = key;
    } catch (error) { this.boardSent = transient(error) ? null : key; } // a refused write is not retried until the colour changes
    finally { this.boardBusy = false; }
  }
}
