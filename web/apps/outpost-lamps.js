// OUTPOST's three lamps: the status board, the note glow and the event accents.
// Left breathes with production, middle fills toward the next purchase and goes steady green when
// one is affordable, right shows the timed thing (flare, boost, expedition) or that relocation is
// worth doing. On top of that, each tap lights the lamp for where its note sits in the melody's
// range (a short glow, brighter with groove, cyan when it is full), and events add an accent:
// buy, milestone, phrase, tune, event and prestige. After DIM_AFTER seconds without input
// everything drops to a dim version (flare and ready cues stay visible).
//
// Fields used on the cartridge (`app`): c, s, clk, rate, idle, phase_, affordN, goalFrac, flare,
// boosts, groove, noteFx ({ pos 0..1, t }), accent ({ k, t, dur }), and this module's own breath
// and dimK.
import { clamp } from "../engine/math.js";
import { LAMP, lamps, dim, pulse, blink, spot, only, chase } from "../engine/lightshow.js";
import { DIM_AFTER, EXPED, GROOVE_MAX, readyOf } from "./outpost-rules.js";

// Once per update: ages the note glow and the accent, moves the breathing and the idle dimming
// on, and sends the frame to the lamps.
export function stepLamps(app, dt) {
  if (app.noteFx) { app.noteFx.t += dt; if (app.noteFx.t > 0.3) app.noteFx = null; }
  if (app.accent) { app.accent.t += dt; if (app.accent.t >= app.accent.dur) app.accent = null; }
  const rateLog = clamp(Math.log10(app.rate + 1) / 12, 0, 1);
  app.breath += dt * (0.12 + 0.6 * rateLog);
  app.dimK += ((app.idle > DIM_AFTER ? 0.12 : 1) - app.dimK) * Math.min(1, dt * 0.8);
  app.c.leds(lampFrame(app));
}

// The nine lamp values for this moment.
export function lampFrame(app) {
  const k = app.dimK, s = app.s;
  // left: breathing, quicker with production (taps are shown by the note glow below)
  const left = dim(LAMP.green, (0.06 + 0.2 * pulse(app.breath)) * k);
  // middle: steady green when something is affordable, otherwise fills toward the next goal
  const mid = app.affordN > 0 && app.phase_ !== "intro" ? dim(LAMP.green, 0.3 * Math.max(k, 0.25)) : dim(LAMP.amber, (0.03 + 0.25 * app.goalFrac) * k);
  // right: the timed thing
  let right = LAMP.off;
  if (app.flare) right = dim(LAMP.amber, 0.5 * blink(app.clk, 3));
  else if (app.boosts.length) {
    const b = app.boosts[0], frac = clamp(b.t / b.max, 0, 1);
    right = dim(LAMP.violet, (0.1 + 0.25 * frac) * (b.t < 3 ? 0.5 + 0.5 * blink(app.clk, 4) : 1) * Math.max(k, 0.3));
  } else if (s.ex.length) {
    const e = s.ex[0], x = EXPED[e.k];
    const frac = clamp(1 - (e.end - Date.now()) / (x.sec * 1000), 0, 1);
    right = dim(LAMP.cyan, (0.04 + 0.26 * frac) * k);
  } else if (readyOf(s)) right = dim(LAMP.white, (0.08 + 0.22 * pulse(app.clk * 0.5)) * Math.max(k, 0.3));
  let v = lamps(left, mid, right);
  // the latest note glows on the lamp for its place in the tune's range: low notes left, high right
  if (app.noteFx) {
    // brighter with groove; in full groove the glow turns cyan
    const gf = Math.floor(app.groove) / GROOVE_MAX, f = 1 - app.noteFx.t / 0.3;
    const glow = spot(app.noteFx.pos, gf >= 1 ? LAMP.cyan : LAMP.white, 0.7);
    v = v.map((x, i) => Math.max(x, Math.round(glow[i] * (0.5 + 0.3 * gf) * f)));
  }
  const a = app.accent;
  if (a) {
    const f = 1 - a.t / a.dur;
    let acc = null;
    if (a.k === "buy") acc = lamps(dim(LAMP.green, 0.7 * f), dim(LAMP.green, 0.7 * f), dim(LAMP.green, 0.7 * f));
    else if (a.k === "milestone") acc = spot(a.t / a.dur, LAMP.blue, 0.8);
    else if (a.k === "phrase") acc = spot(a.t / a.dur, LAMP.cyan, 0.8).map((x) => Math.round(x * 0.6));
    else if (a.k === "tune") acc = only(chase(a.t, 9, false), LAMP.amber, 0.7 * f);
    else if (a.k === "event") acc = lamps(dim(LAMP.violet, 0.8 * f), dim(LAMP.violet, 0.8 * f), dim(LAMP.violet, 0.8 * f));
    else if (a.k === "prestige") { const w = Math.sin(clamp(a.t / a.dur, 0, 1) * Math.PI); acc = lamps(dim(LAMP.white, 0.8 * w), dim(LAMP.white, 0.8 * w), dim(LAMP.white, 0.8 * w)); }
    if (acc) v = v.map((x, i) => Math.max(x, acc[i]));
  }
  return v;
}
