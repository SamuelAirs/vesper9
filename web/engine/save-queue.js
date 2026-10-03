// A bounded, RAM-only outbox for idempotent persistence. Hardware and user
// actions never enter it. `send` must return the acknowledged service request,
// not a quiet/fire-and-forget bridge command. Acceptance means queued in RAM;
// an entry leaves only after its current revision is acknowledged.
export const SAVE_QUEUE_ENTRIES = 256;
export const SAVE_QUEUE_BYTES = 256 * 1024;

function sameJSON(left, right) {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object" || Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && sameJSON(left[key], right[key]));
}
function snapshotJSON(value) {
  const json = JSON.stringify(value, (_, item) => {
    if (typeof item === "number" && !Number.isFinite(item)) throw new Error("A save contains a non-finite number");
    return item;
  });
  return { value: JSON.parse(json), bytes: new TextEncoder().encode(json).length, json };
}

export class SaveQueue {
  constructor({ send, onChange = () => {}, onError = () => {}, maxEntries = SAVE_QUEUE_ENTRIES, maxBytes = SAVE_QUEUE_BYTES } = {}) {
    if (typeof send !== "function") throw new TypeError("SaveQueue needs an acknowledged send function");
    if (!Number.isInteger(maxEntries) || maxEntries < 1 || !Number.isInteger(maxBytes) || maxBytes < 1) throw new TypeError("Invalid save queue limits");
    this.send = send; this.onChange = onChange; this.onError = onError;
    this.maxEntries = maxEntries; this.maxBytes = maxBytes;
    this.entries = new Map(); this.bytes = 0; this.ready = false;
    this.generation = 0; this.revision = 0; this.inFlight = null; this.refused = null;
  }
  key(command, values) {
    return command === "score" ? "score:" + JSON.stringify([values?.app, values?.metric ?? "default"]) : "progress:" + String(values?.app);
  }
  status() {
    const failed = [...this.entries.values()].find(entry => entry.error);
    return { pending: this.entries.size, bytes: this.bytes, ready: this.ready, sending: !!this.inFlight,
      error: this.refused?.error || failed?.error || null };
  }
  changed() { try { this.onChange(this.status()); } catch {} }
  report(error) { try { this.onError(error instanceof Error ? error : new Error(String(error))); } catch {} }
  enqueue(command, values, { baseline } = {}) {
    let key = null;
    try {
      if (command !== "progress" && command !== "score") throw new Error("Only progress and score can be queued");
      if (!values || typeof values.app !== "string" || !values.app) throw new Error("A queued save needs an app key");
      let payload;
      if (command === "progress") {
        key = this.key(command, values);
        if (!values.value || typeof values.value !== "object" || Array.isArray(values.value)) throw new Error("Progress must be an object");
        payload = { app: values.app, value: values.value };
      } else {
        if (values.metric !== undefined && typeof values.metric !== "string") throw new Error("Invalid score class");
        key = this.key(command, values);
        if (!Number.isFinite(values.score) || values.score < 0 || values.score > 1e9) throw new Error("Invalid score");
        payload = { app: values.app, score: values.score, metric: values.metric ?? "default" };
      }
      const serialized = snapshotJSON(payload), snapshot = serialized.value, json = serialized.json;
      if (command === "progress" && (!snapshot.value || typeof snapshot.value !== "object" || Array.isArray(snapshot.value)))
        throw new Error("Progress must serialize to an object");
      const previous = this.entries.get(key);
      let firstBaseline = previous?.baseline, baselineBytes = previous?.baselineBytes || 0;
      if (command === "progress" && !previous && baseline !== undefined) {
        const stored = snapshotJSON(baseline);
        if (!stored.value || typeof stored.value !== "object" || Array.isArray(stored.value)) throw new Error("Progress baseline must be an object");
        firstBaseline = stored.value; baselineBytes = stored.bytes;
      }
      const size = serialized.bytes + baselineBytes;
      if (command === "score" && previous && previous.values.score >= snapshot.score) {
        if (this.refused?.key === key) this.refused = null;
        this.changed(); this.drain();
        return Promise.resolve({ queued: true });
      }
      // Re-saving the same rejected payload is not a correction. Keep its
      // warning and wait for a deliberate retry or changed contents.
      if (previous?.error && previous.bytes === size && JSON.stringify(previous.values) === json) {
        this.changed(); this.drain();
        return Promise.resolve({ queued: true });
      }
      if (!previous && this.entries.size >= this.maxEntries || this.bytes - (previous?.bytes || 0) + size > this.maxBytes)
        throw new Error("Save queue is full; this change was not queued");
      this.entries.set(key, { command, values: snapshot, baseline: firstBaseline, baselineBytes, bytes: size, revision: ++this.revision, error: null });
      this.bytes += size - (previous?.bytes || 0);
      if (this.refused?.key === key) this.refused = null;
      this.changed(); this.drain();
      return Promise.resolve({ queued: true });
    } catch (error) {
      this.refused = { key, error: String(error?.message || error) };
      this.changed(); this.report(error);
      return Promise.reject(error);
    }
  }
  // Root gates this with BOTH connection health and controller ownership. Every
  // readiness transition invalidates the old connection's eventual reply.
  setReady(ready) {
    const next = ready === true;
    if (next === this.ready) return;
    this.ready = next; this.generation++; this.inFlight = null;
    if (next) for (const entry of this.entries.values()) entry.error = null;
    this.changed(); this.drain();
  }
  // An explicit retry; failed entries otherwise stay visible without spinning
  // on every incoming state or every unrelated score/save.
  flush() {
    for (const entry of this.entries.values()) entry.error = null;
    this.changed(); this.drain();
    return this.inFlight?.promise || Promise.resolve(this.status());
  }
  // Only an explicit user resolution may abandon waiting saves. An operation
  // already sent cannot be undone, but its eventual reply must not touch a
  // subsequent save. The host gates readiness before resolving a conflict.
  discard() {
    this.generation++; this.inFlight = null;
    this.entries.clear(); this.bytes = 0; this.refused = null;
    this.changed();
  }
  // Call before overlaying inbound state. A matching latest payload is already
  // durable even if its reply was lost; another value requires user resolution.
  conflicts(state) {
    return [...this.entries.values()].filter(entry => {
      if (entry.command !== "progress" || entry.baseline === undefined) return false;
      const service = state?.progress?.[entry.values.app] ?? {};
      return !sameJSON(service, entry.baseline) && !sameJSON(service, entry.values.value);
    }).map(entry => entry.values.app);
  }
  drain() {
    if (!this.ready || this.inFlight) return;
    const next = [...this.entries].find(([, entry]) => !entry.error);
    if (!next) return;
    const [key, entry] = next, generation = this.generation;
    const flight = { key, revision: entry.revision, generation, promise: null };
    this.inFlight = flight; this.changed();
    flight.promise = Promise.resolve().then(() => {
      if (this.inFlight !== flight || this.generation !== generation || !this.ready) return;
      // A send callback cannot acquire and mutate the queue's own snapshot.
      return this.send(entry.command, structuredClone(entry.values));
    }).then(() => {
      if (this.inFlight !== flight || this.generation !== generation || !this.ready) return;
      const current = this.entries.get(key);
      if (current?.revision === flight.revision) {
        this.entries.delete(key); this.bytes -= current.bytes;
      }
    }, error => {
      if (this.inFlight !== flight || this.generation !== generation || !this.ready) return;
      const current = this.entries.get(key);
      if (current?.revision === flight.revision) current.error = String(error?.message || error);
      this.report(error);
    }).finally(() => {
      if (this.inFlight !== flight) return;
      this.inFlight = null; this.changed(); this.drain();
    });
  }
  // Reconnect state can be older than saves made during the interruption. Copy
  // overlays so callers cannot mutate queued payloads through application state.
  overlay(state) {
    const result = { ...state }, progress = new Map(Object.entries(state?.progress || {})), scores = new Map(Object.entries(state?.scores || {}));
    for (const entry of this.entries.values()) {
      if (entry.command === "progress") progress.set(entry.values.app, structuredClone(entry.values.value));
      else {
        const key = entry.values.metric === "default" ? entry.values.app : entry.values.app + ":" + entry.values.metric;
        scores.set(key, Math.max(Number.isFinite(scores.get(key)) ? scores.get(key) : 0, entry.values.score));
      }
    }
    result.progress = Object.fromEntries(progress); result.scores = Object.fromEntries(scores);
    return result;
  }
}
