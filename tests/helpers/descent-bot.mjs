// A Descent pilot that sees what a player sees (height, speed, fuel, the ground and pads ahead) and
// answers "burn now?" each frame. It lands on every pad it can and lifts off near each pad's end.
import { FLIGHT, speedAt, nextPad, maxGround } from "../../web/apps/descent.js";

export function botWants(app, { skill = 1 } = {}) {
  const { world: w, x, alt, vy } = app;
  const vx = speedAt(x);
  if (app.pad) return x > app.pad.x1 - (vx * 0.5 + 6);
  const p = nextPad(w, x);
  const net = FLIGHT.a - FLIGHT.g;
  // The fastest descent from which a full burn still arrives gently at `floor`.
  const brake = (floor) => Math.sqrt(Math.max(0, 2 * net * 0.5 * (alt - floor))) + FLIGHT.safe * 0.45 * skill;
  let want;
  if (p && x > p.x0 + 1 && x < p.x1 - 4) want = brake(p.h);
  else if (p && p.x0 - x < vx * 3.2) {
    // Approach: clear the ground before the pad, and be low by the time it starts.
    const clear = maxGround(w, x - 5, p.x0 + 1) + 3;
    const reach = (p.x0 + 2 - x) / vx;            // seconds until over the pad
    const floor = Math.max(clear, p.h);
    want = Math.min(brake(floor), Math.max(0.5, (alt - p.h) / Math.max(0.4, reach)));
    if (alt < clear) want = -3;
  } else {
    const target = maxGround(w, x - 5, x + vx * 2.4 + 10) + 8;
    want = clamp((alt - target) * 0.7, -11, 6);
  }
  return vy > want;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
