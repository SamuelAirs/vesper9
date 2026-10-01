// A seeded Moonrunner player for tests and the balance audit. It plays through the game's own
// down()/up(), reads only what a player can see (the sled, the slope, boulders, rilles, cables), and
// decides a flip the way a practised player does: it tries the flip on a copy of the sled with the
// game's own physics (Moonrunner.advance) and holds only when that copy lands clean.
// `lag` (seconds, may be negative) shifts every jump: a sloppy player. `flips: false` never flips.
const TAU = Math.PI * 2;
export function runnerBot(g, { flips = true, lag = 0, margin = 0.15, jitter = null } = {}) {
  const s = { holding: false, target: 0, planned: false, wasAir: false, aim: new WeakMap() };
  const CLEAN = 0.5;
  function plan(r) {
    for (const n of [3, 2, 1]) {
      const q = { ...r };
      let t = 0;
      for (let f = 0; f < 400; f++) {
        const ev = g.advance(q, 1 / 60, t >= 0.12 && Math.abs(q.spin) < n * TAU - 0.15);
        t += 1 / 60;
        if (ev && (ev.type === "land" || ev.type === "rail")) {
          if (ev.diff <= CLEAN - margin && Math.round(Math.abs(ev.spin) / TAU) === n) return n;
          break;
        }
        if (ev && (ev.type === "fell" || ev.type === "wall")) break;
      }
    }
    return 0;
  }
  const off = (o) => { if (!jitter) return lag; if (!s.aim.has(o)) s.aim.set(o, lag + jitter()); return s.aim.get(o); };
  return function step() {
    if (g.phase !== "play") return;
    const r = g.r;
    if (r.air) {
      if (!s.wasAir) { s.wasAir = true; s.planned = false; }
      if (s.holding) { if (Math.abs(r.spin) >= s.target * TAU - 0.15) { g.up(); s.holding = false; } return; }
      if (!s.planned && flips) {
        s.planned = true;
        const n = plan(r);
        if (n) { g.down(); s.holding = true; s.target = n; }
      }
      return;
    }
    s.wasAir = false;
    if (s.holding) { g.up(); s.holding = false; }
    const v = r.v;
    let go = false;
    // Boulders that stand close together are one obstacle: aim at the middle of the group.
    const live = g.rocks.filter((k) => !k.done && !k.hit && k.x > r.x);
    if (live.length) {
      let end = live[0].x;
      for (const k of live) if (k.x - end < 130) end = k.x;
      if ((live[0].x + end) / 2 - r.x < v * (0.3 + off(live[0])) + 10) go = true;
    }
    for (const c of g.chasms) if (!c.done && c.x0 > r.x && c.x0 - r.x < v * (0.1 + off(c)) + 12) go = true;
    for (const rl of g.rails) if (rl.ya !== null && r.rail === null && rl.x0 > r.x && rl.x0 - r.x < v * (0.12 + off(rl))) go = true;
    if (go) { g.down(); g.up(); }
  };
}
