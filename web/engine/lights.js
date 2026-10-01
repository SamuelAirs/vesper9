// Serialized ownership changes: a late ACK cannot bless a newer owner's cache.
export class LightDirector {
  constructor(command, clock = () => performance.now()) {
    this.command = command; this.clock = clock; this.generation = 0;
    this.desired = Array(9).fill(0); this.sent = null;
    this.tail = Promise.resolve(); this.busy = false; this.last = -Infinity;
    this.suspendedUntil = 0;
  }
  enqueue(operation) {
    const result = this.tail.catch(() => {}).then(operation);
    this.tail = result.catch(() => {});
    return result;
  }
  invalidate() { this.generation++; this.sent = null; }
  set(values) { this.desired = values.slice(); }
  effect(name, data) {
    this.invalidate(); this.desired = null;
    const generation = this.generation;
    return this.enqueue(() => generation === this.generation ? this.command(name, data) : undefined);
  }
  release() {
    this.invalidate(); this.suspendedUntil = 0; this.desired = Array(9).fill(0);
    const generation = this.generation;
    return this.enqueue(async () => {
      if (generation !== this.generation) return;
      await this.command('cancel', {});
      if (generation !== this.generation) return;
      await this.command('leds', { values: Array(9).fill(0) });
      if (generation === this.generation) this.sent = Array(9).fill(0).join(',');
    });
  }
  suspend(ms) { this.invalidate(); this.suspendedUntil = this.clock() + ms; }
  observe(values) { if (values?.join(',') !== this.sent) this.sent = null; }
  async flush(connected = true) {
    const now = this.clock();
    if (!connected || this.busy || !this.desired || now < this.suspendedUntil || now - this.last < 60) return;
    const key = this.desired.join(',');
    if (key === this.sent) return;
    const values = this.desired.slice(), generation = this.generation;
    this.busy = true; this.last = now;
    try {
      await this.enqueue(async () => {
        if (generation !== this.generation) return;
        await this.command('leds', { values });
        if (generation === this.generation) this.sent = key;
      });
    } catch { this.sent = null; }
    finally { this.busy = false; }
  }
}
