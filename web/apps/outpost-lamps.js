// OUTPOST's lamps: the status board, the beat guide, the note glow and the event lights, on three
// lamps (the first node) or four (the current one).
//
// The first three lamps are the status board. Left breathes with production (brighter and leaning
// cyan while machines hum). Middle fills amber toward the next goal and goes steady green when
// something is affordable. Right shows the timed thing (flare, boost, expedition), a fitting
// waiting in the workshop (a slow blue pulse) or that relocation is worth doing.
//
// A fourth lamp is the music lamp: it glows brighter as the tune goes on, takes the groove's colour
// (white, green, cyan when full), flashes on the next beat while the player keeps one (a metronome
// at their own tempo) and flickers red on a dropped beat. On three lamps the beat flash and the
// flicker borrow the left lamp while a beat is kept.
//
// Over all the lamps: each tap lights the lamp for where its note sits in the melody's range
// (brighter with groove, cyan when full); each note of a sound cue lights the lamp for its pitch in
// the cue's colour (a purchase runs green, a returning expedition cyan); events add an accent (buy,
// milestone, phrase, tune, event, prestige); and when THE CALL is answered the station's colours
// turn slowly round the lamps. A flare blinks faster as it is about to fade. After DIM_AFTER
// seconds without input everything drops to a dim version (flare and ready cues stay visible).
//
// The lamps update about 17 times a second on the node, so nothing here is shorter than about two
// of those frames.
//
// Fields used on the cartridge (`app`): c (and c.lampCount() when the console has it), s, mel,
// clk, rate, idle, phase_, ring, panel, affordN, goalFrac, fitWaiting(), flare, boosts, groove,
// gaps, lastGather, hum, noteFx ({ pos 0..1, t }), accent ({ k, t, dur }), cueFx ({ pos, rgb, t }, set by outpost-music.js), finale ({ t }), and
// this module's own breath, dimK, grooveSeen and stumble.
import { clamp } from "../engine/math.js";
import { LAMP, dim, blend, pulse, blink, ramp } from "../engine/lightshow.js";
import { DIM_AFTER, EXPED, FINALE_SEC, GROOVE_MAX, readyOf } from "./outpost-rules.js";
import { liveBeat } from "./outpost-music.js";

export const CUE_GLOW = 0.25; // seconds a cue note's light lasts
export const BEAT_FLASH = 0.13; // seconds the beat guide's flash lasts
export const STUMBLE = 0.3; // seconds the dropped-beat flicker lasts
// How early the beat flash is sent: the node's lamp throttle (as Meridian allows) plus the
// player's calibrated input latency, so the flash is seen when the finger should land.
export const LAMP_LAG = 0.035;

const latencyOf = (app) => {
  let ms = 0;
  try { ms = Number(app.c.settings?.()?.latencyMs) || 0; } catch { ms = 0; }
  return clamp(ms, -150, 300) / 1000;
};

// Once per update: ages the note glow, the cue light and the accent, notices a dropped beat, moves
// the breathing and the idle dimming on, and sends the frame to the lamps.
export function stepLamps(app, dt) {
  if (app.noteFx) { app.noteFx.t += dt; if (app.noteFx.t > 0.3) app.noteFx = null; }
  if (app.cueFx) { app.cueFx.t += dt; if (app.cueFx.t > CUE_GLOW) app.cueFx = null; }
  if (app.accent) { app.accent.t += dt; if (app.accent.t >= app.accent.dur) app.accent = null; }
  // a stumble halves the groove at a tap (a long pause that ends it clears the beat instead)
  const g = Math.floor(app.groove || 0), seen = app.grooveSeen ?? 0;
  if (seen >= 4 && g <= seen / 2 + 0.5 && app.gaps?.length && app.clk - app.lastGather < 0.05) app.stumble = STUMBLE;
  else if (app.stumble > 0) app.stumble -= dt;
  app.grooveSeen = g;
  const rateLog = clamp(Math.log10(app.rate + 1) / 12, 0, 1);
  app.breath += dt * (0.12 + 0.6 * rateLog);
  app.dimK += ((app.idle > DIM_AFTER ? 0.12 : 1) - app.dimK) * Math.min(1, dt * 0.8);
  app.c.leds(lampFrame(app));
}

// Whether any owned machine is humming (a finished tune's hum, app.hum in seconds per machine).
export function isHumming(app) {
  const h = app.hum, own = app.s?.own;
  if (!h || !own) return false;
  for (let i = 0; i < h.length; i++) if (h[i] > 0 && own[i] > 0) return true;
  return false;
}

// 0..1: how lit the beat guide is at this moment (0 when the player is not keeping a beat).
export function beatFlash(app) {
  if (app.phase_ !== "play" || app.ring || app.panel) return 0;
  const beat = liveBeat(app);
  if (!beat) return 0;
  const x = (app.clk + LAMP_LAG + latencyOf(app) - app.lastGather) / beat, k = Math.floor(x);
  if (k < 1) return 0; // the tap itself is shown by the note glow
  const into = (x - k) * beat;
  return into < BEAT_FLASH ? 1 - into / BEAT_FLASH : 0;
}

// How many lamps the node has: 3 on the first node, 4 on the current one (ctx.lampCount() comes
// with the four-lamp console; a console without it has three).
export function lampCountOf(app) {
  let n = 3;
  try { n = Number(app.c.lampCount?.()) || 3; } catch { n = 3; }
  return n >= 4 ? 4 : 3;
}
// Count-aware versions of the lightshow helpers, so Outpost lights four lamps on a console whose
// engine predates them as well as on one that has them.
const row = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));
const lamps = (...rgbs) => rgbs.flatMap((rgb) => (rgb || LAMP.off).map((x) => Math.round(clamp(x, 0, 255))));
const spotN = (pos, rgb, width, n) => lamps(...row(n, (i) => dim(rgb, clamp(1 - Math.abs(pos * (n - 1) - i) / width, 0, 1))));
const fillN = (rgb, n) => lamps(...row(n, () => rgb));
const chaseN = (t, hz, n) => Math.floor(t * hz) % n;

// The music lamp: lamp 4 on a four-lamp node, given over to the tune. Its glow grows as the tune
// goes on (dark at the first note, brightest at the last), its colour is the groove (white, then
// green, cyan when full), it flashes on the next beat while one is kept, and flickers red on a
// dropped beat. On three lamps the beat guide and the flicker borrow the left lamp instead.
function musicLamp(app, gf) {
  const m = app.mel, len = m?.n?.length || 1, progress = clamp((app.s.sp || 0) / len, 0, 1);
  const colour = ramp(gf, [LAMP.white, LAMP.green, LAMP.cyan]);
  const awake = app.phase_ === "play" && !app.ring && !app.panel;
  let level = (0.02 + 0.1 * progress + 0.1 * gf) * app.dimK;
  if (awake && liveBeat(app)) level = Math.max(level, 0.03 + (0.3 + 0.25 * gf) * beatFlash(app));
  if (app.stumble > 0) return dim(LAMP.red, 0.35 * blink(app.stumble, 7));
  return dim(colour, level);
}

// The lamp values for this moment: nine on a three-lamp node, twelve on a four-lamp one. The
// status board is always the first three lamps (left, middle, right as described above); a fourth
// lamp is the music lamp.
export function lampFrame(app) {
  const k = app.dimK, s = app.s, gf = Math.floor(app.groove || 0) / GROOVE_MAX, n = lampCountOf(app);
  // left: breathing, quicker with production (while machines hum, the breath is brighter and leans
  // cyan: the station is working harder); on three lamps the beat guide takes it while a beat is kept
  const humming = isHumming(app);
  let left = dim(humming ? blend(LAMP.green, LAMP.cyan, 0.6) : LAMP.green, ((humming ? 0.1 : 0.06) + (humming ? 0.26 : 0.2) * pulse(app.breath)) * k);
  if (n === 3) {
    if (liveBeat(app) && app.phase_ === "play" && !app.ring && !app.panel) {
      const f = beatFlash(app);
      left = dim(ramp(gf, [LAMP.white, LAMP.green, LAMP.cyan]), 0.03 + (0.3 + 0.25 * gf) * f);
    }
    if (app.stumble > 0) left = dim(LAMP.red, 0.35 * blink(app.stumble, 7));
  }
  // middle: steady green when something is affordable, otherwise fills toward the next goal
  const mid = app.affordN > 0 && app.phase_ !== "intro" ? dim(LAMP.green, 0.3 * Math.max(k, 0.25)) : dim(LAMP.amber, (0.03 + 0.25 * app.goalFrac) * k);
  // right: the timed thing
  let right = LAMP.off;
  if (app.flare) {
    // quicker and brighter in the last part of the catch window (timed from the flare's own
    // start, so the blink never jumps about as the rate changes)
    const f = app.flare, late = f.t < Math.min(3, 0.3 * f.life);
    right = dim(LAMP.amber, (late ? 0.65 : 0.5) * blink(f.life - f.t, late ? 5 : 3));
  } else if (app.boosts.length) {
    const b = app.boosts[0], frac = clamp(b.t / b.max, 0, 1);
    right = dim(LAMP.violet, (0.1 + 0.25 * frac) * (b.t < 3 ? 0.5 + 0.5 * blink(app.clk, 4) : 1) * Math.max(k, 0.3));
  } else if (s.ex.length) {
    const e = s.ex[0], x = EXPED[e.k];
    const frac = clamp(1 - (e.end - Date.now()) / (x.sec * 1000), 0, 1);
    right = dim(LAMP.cyan, (0.04 + 0.26 * frac) * k);
  } else if (app.fitWaiting?.()) right = dim(LAMP.blue, (0.08 + 0.24 * pulse(app.clk * 0.7)) * Math.max(k, 0.3)); // a fitting waits in the workshop
  else if (readyOf(s)) right = dim(LAMP.white, (0.08 + 0.22 * pulse(app.clk * 0.5)) * Math.max(k, 0.3));
  let v = n === 4 ? lamps(left, mid, right, musicLamp(app, gf)) : lamps(left, mid, right);
  const over = (layer) => { v = v.map((x, i) => Math.max(x, layer[i])); };
  // the latest note glows on the lamp for its place in the tune's range: low notes left, high right
  if (app.noteFx) {
    // brighter with groove; in full groove the glow turns cyan
    const f = 1 - app.noteFx.t / 0.3;
    const glow = spotN(app.noteFx.pos, gf >= 1 ? LAMP.cyan : LAMP.white, 0.7, n);
    over(glow.map((x) => Math.round(x * (0.5 + 0.3 * gf) * f)));
  }
  // the latest cue note, in its cue's colour, on the lamp for its pitch
  const cf = app.cueFx;
  if (cf) over(spotN(cf.pos, cf.rgb, 0.7, n).map((x) => Math.round(x * 0.55 * (1 - cf.t / CUE_GLOW))));
  // THE CALL answered: for the finale the station's colours turn slowly round the lamps, fading
  // out over its last seconds
  if (app.finale) {
    const t = app.finale.t, fade = clamp((FINALE_SEC - t) / 4, 0, 1) * clamp(t / 1.5, 0, 1);
    const turn = n === 4 ? [LAMP.white, LAMP.cyan, LAMP.violet, LAMP.amber] : [LAMP.white, LAMP.cyan, LAMP.violet], step = Math.floor(t * 1.5);
    over(lamps(...row(n, (i) => dim(turn[(i + step) % n], 0.45 * fade))));
  }
  const a = app.accent;
  if (a) {
    const f = 1 - a.t / a.dur;
    let acc = null;
    if (a.k === "buy") acc = fillN(dim(LAMP.green, 0.7 * f), n);
    else if (a.k === "milestone") acc = spotN(a.t / a.dur, LAMP.blue, 0.8, n);
    else if (a.k === "phrase") acc = spotN(a.t / a.dur, LAMP.cyan, 0.8, n).map((x) => Math.round(x * 0.6));
    else if (a.k === "tune") acc = lamps(...row(n, (i) => (i === chaseN(a.t, 9, n) ? dim(LAMP.amber, 0.7 * f) : null)));
    // a generic event wash only when no cue is lighting the lamps with its own colour and shape
    else if (a.k === "event" && !cf) acc = fillN(dim(LAMP.violet, 0.8 * f), n);
    else if (a.k === "prestige") { const w = Math.sin(clamp(a.t / a.dur, 0, 1) * Math.PI); acc = fillN(dim(LAMP.white, 0.8 * w), n); }
    if (acc) over(acc);
  }
  return v;
}
