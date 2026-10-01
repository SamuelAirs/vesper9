// The one-button hand and a stand-in for the service's timers, for tests that count presses.
//
// `Hand` does what web/main.js does with an instrument's action list: tapping moves the
// highlight to the next action (and the app also sees the raw edges), hold-and-release chooses
// it (the host runs the action, then forwards the release). After a list is replaced the
// highlight stays on the action with the same id, else on the same row number (`setNav`).
// Every tap and every hold counts one press.
export class Hand {
  constructor(ctx, app, clock, { card = 0, holdMs = 650 } = {}) {
    this.ctx = ctx; this.app = app; this.clock = clock; this.holdMs = holdMs;
    this.items = null; this.index = card; this.seen = 0; this.presses = 0; this.log = [];
    this.stamp = 5000;
  }
  sync() {
    for (; this.seen < this.ctx.calls.actions.length; this.seen++) {
      const next = this.ctx.calls.actions[this.seen];
      const id = (i) => i.id || i.label;
      const match = this.items ? next.findIndex((i) => id(i) === id(this.items[this.index])) : -1;
      this.index = Math.min(match >= 0 ? match : this.index, next.length - 1);
      this.items = next;
    }
  }
  get label() { this.sync(); return this.items[this.index].label; }
  get labels() { this.sync(); return this.items.map((i) => i.label); }
  edge(pressed, at) { this.app.event?.({ type: "button", pressed, source: "node", at_us: at * 1000 }); }
  tap(n = 1, gapMs = 250) {
    for (let k = 0; k < n; k++) {
      this.sync();
      const at = this.stamp;
      this.edge(true, at);
      // the host advances on the release of a short press, then forwards the edge to the app
      this.clock.set(this.clock.now() + 90);
      this.index = (this.index + 1) % this.items.length;
      this.edge(false, at + 90);
      this.stamp += 90 + gapMs; this.clock.set(this.clock.now() + gapMs);
      this.presses++; this.log.push("tap");
    }
    this.sync();
    return this;
  }
  hold(ms = this.holdMs + 50) {
    this.sync();
    const at = this.stamp, item = this.items[this.index];
    this.edge(true, at);
    this.clock.set(this.clock.now() + ms);
    const result = item.run(); // the host selects on the release, before the app sees it
    this.edge(false, at + ms);
    this.stamp += ms + 400; this.clock.set(this.clock.now() + 400);
    this.presses++; this.log.push("hold " + item.label);
    this.sync();
    return result;
  }
  // Move the highlight to the row whose label contains `text` by tapping, counting the taps.
  to(text) {
    this.sync();
    for (let guard = 0; guard < 40 && !this.label.includes(text); guard++) this.tap();
    if (!this.label.includes(text)) throw new Error(`no row "${text}" in ${this.labels}`);
    return this;
  }
}

// The service's timers (vesper/server.py `timer_command` and `tick_once`), kept in memory.
// `now` is seconds. `store` stands for the database: `restart()` builds a new service from it.
export class FakeService {
  constructor(ctx, clockSeconds, store = { timers: [] }) {
    this.ctx = ctx; this.now = clockSeconds; this.store = store; this.listeners = []; this.queue = null;
    this.timers = JSON.parse(JSON.stringify(store.timers));
    this.commands = [];
    ctx.command = (name, data) => this.command(name, data);
    this.publish(false);
  }
  attach(app) { this.listeners.push(app); return this; }
  pub() { return this.timers.map((t) => ({ ...t, remaining: t.running ? Math.max(0, t.deadline - this.now()) : t.remaining })); }
  publish(emit = true) {
    this.ctx.state().timers = this.pub();
    if (emit) for (const app of this.listeners) app.event?.({ type: "timers", timers: this.ctx.state().timers });
  }
  save() { this.store.timers = JSON.parse(JSON.stringify(this.timers)); }
  command(name, data) {
    this.commands.push([name, { ...data }]);
    if (name !== "timer") return Promise.resolve({ ok: true });
    try {
      const timers = this.timers, op = data.op;
      if (op === "create") {
        const seconds = data.seconds;
        if (!Number.isFinite(seconds) || seconds < 5 || seconds > 86400) throw new Error("Timer duration must be 5 seconds to 24 hours");
        if (timers.length >= 8) throw new Error("Eight timers are already present. Remove a finished timer first.");
        timers.push({ id: "t" + (this.seq = (this.seq || 0) + 1) + Math.random().toString(36).slice(2, 6), label: String(data.label ?? "FIELD TIMER").slice(0, 32), duration: seconds, remaining: seconds, deadline: this.now() + seconds, running: true, finished: false });
      } else {
        const t = timers.find((x) => x.id === data.id);
        if (!t) throw new Error("Timer not found");
        if (op === "toggle") {
          if (t.running) { t.remaining = Math.max(0, t.deadline - this.now()); t.running = false; }
          else { if (t.remaining <= 0) t.remaining = t.duration; Object.assign(t, { running: true, finished: false, deadline: this.now() + t.remaining }); }
        } else if (op === "reset") Object.assign(t, { remaining: t.duration, running: false, finished: false });
        else if (op === "remove") timers.splice(timers.indexOf(t), 1);
        else throw new Error("Unknown timer action");
      }
    } catch (error) { return Promise.reject(error); }
    this.save();
    if (this.queue) this.queue.push(1); else this.publish();
    return Promise.resolve({ ok: true });
  }
  // Delay the broadcasts of commands until flush(), as a slow link would.
  hold() { this.queue = []; }
  flush() { this.queue = null; this.publish(); }
  // The service's once-a-second pass: finish due timers, announce them, broadcast.
  tick() {
    for (const t of this.timers) if (t.running && this.now() >= t.deadline) {
      Object.assign(t, { running: false, remaining: 0, finished: true });
      for (const app of this.listeners) app.event?.({ type: "timer_done", timer: { ...t } });
    }
    this.save();
    if (this.timers.length) this.publish();
  }
  // The service starts again from the database: same timers, a new state, the page told.
  restart() {
    const next = new FakeService(this.ctx, this.now, this.store);
    next.listeners = this.listeners;
    next.seq = this.seq;
    for (const app of this.listeners) app.event?.({ type: "state", state: this.ctx.state() });
    return next;
  }
}
