// A seeded Moonrunner player for tests and the balance audit. It plays through the game's own
// down()/up() and reads only what a player can see (the sled and the shape of the hills).
// On the ground it holds (dives) while the slope ahead runs downhill and lets go on the climb, so
// the sled flies off the crest. In the air it plans the way a practised player times a dive: it
// tries "float for k frames, then dive" on a copy of the sled with the game's own physics
// (Moonrunner.advance, as a probe) and keeps the first k that lands as a perfect slide. With no
// such k (or with `plan: false`) it plays by eye: it holds while there is a downhill under the
// sled and lets go over an uphill. Near a rille it stays light.
// `lag` (seconds) delays every change of the button: a sloppy player. `plan: false` never looks
// ahead and only plays by eye.
const DT = 1 / 60;
export function runnerBot(g, { lag = 0, plan = true } = {}) {
  const s = { want: false, since: 0, at: 0, flight: null };
  // Frames of floating before the dive that land perfect, or -1.
  function search(r) {
    for (let k = 0; k <= 150; k += 3) {
      const q = { ...r };
      for (let f = 0; f < 400; f++) {
        const ev = g.advance(q, DT, f >= k, true);
        if (!ev) continue;
        if (ev.type === "land") { if (ev.diff <= g.windowAt(q.x) * 0.8 && ev.th > 0.08) return k; break; }
        if (ev.type === "fell" || ev.type === "wall") break;
        if (ev.type !== "gap") break;
      }
    }
    return -1;
  }
  const rille = (r) => g.chasms.some((c) => c.x1 > r.x && c.x0 - r.x < Math.max(120, r.v * 0.35));
  function choose(r) {
    if (!r.air) { s.flight = null; return !rille(r) && g.slopeAt(r.x + r.v * 0.06) > 0.03; }
    if (plan) {
      if (!s.flight) s.flight = { k: search(r), f: 0 };
      const fl = s.flight;
      fl.f++;
      if (fl.k >= 0) return fl.f > fl.k;
    }
    if (g.chasmAt(r.x) || rille(r)) return false;
    // By eye, the one rule a Tiny Wings player learns: hold over a downhill, let go over an uphill.
    return g.slopeAt(r.x) > 0.05;
  }
  return function step() {
    if (g.phase !== "play") return;
    s.at += DT;
    const want = choose(g.r);
    if (want !== s.want) { s.want = want; s.since = s.at; }
    if (s.at - s.since < lag - 1e-9) return;
    if (s.want && !g.held) g.down();
    else if (!s.want && g.held) g.up();
  };
}
