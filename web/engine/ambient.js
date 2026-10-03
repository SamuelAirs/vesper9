// What the host does with the lamps while no app has taken them: a soft focus spot,
// hold and click feedback, short acknowledgements, a very dim phosphor breath on the
// dashboard, a countdown for a timer's last ten seconds, and the microphone-live lamp.
// Everything here is pure logic from host state and a time in milliseconds to nine (three
// lamps) or twelve (four lamps) whole numbers 0–255. The board LED is never touched here. The host (web/main.js) only feeds it state and writes the result.
import { clamp } from "./math.js";
import { LAMP, dim, blend, lamps, lightsOff, meter, spot, pulse, scaleLeds } from "./lightshow.js";

// Global lamp level: a multiplier for everything the lamps do (host effects, plain leds
// values, pattern colours). The reaction cue is node-timed at fixed colours and is not scaled.
export const LAMP_LEVELS = { full: 1, medium: 0.5, low: 0.2, off: 0 };
export const DEFAULT_LAMP_LEVEL = "medium";
export const levelScale = (level) =>
  typeof level === "number" ? clamp(level, 0, 1)
    : Object.hasOwn(LAMP_LEVELS, level) ? LAMP_LEVELS[level] : LAMP_LEVELS[DEFAULT_LAMP_LEVEL];

// No input for IDLE.startMs, then the host layer fades to exactly dark over IDLE.fadeMs.
export const IDLE = { startMs: 4 * 60 * 1000, fadeMs: 30 * 1000 };
export const SELECT_DEAD_MS = 150;   // taps are not hold progress
export const ESCAPE_MS = 3000;       // the silent plain-hold fallback that navigation contexts keep
export const COUNTDOWN_S = 10;
// After a timer-completion effect the node pattern runs ~1.1 s; the host layer stays out for
// that plus a margin, then fades back in so the glow never overwrites the effect's end.
export const EFFECT_MARGIN_MS = 1500;
export const EFFECT_FADE_MS = 2000;
// Microphone live lamp (the rightmost lamp, steady blue: index 2 on three lamps, 3 on four). It scales with the level but never below
// a floor, so the privacy signal is visible even with the lamp level set to off.
export const MIC_LAMP = 2;
export const micLamp = (n = 3) => n - 1;
export const MIC_RGB = LAMP.blue;
export const MIC_FLOOR = 0.3;
export const micBrightness = (scale) => MIC_FLOOR + 0.3 * clamp(scale, 0, 1);

const GREEN = LAMP.green, CYAN = LAMP.cyan;
// How long each acknowledgement lasts, ms.
export const FLASH_MS = { select: 260, menu: 320, voice: 380, error: 320 };

const whole = (values) => values.map((v) => Math.max(0, Math.min(255, Math.round(v))));

const each = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));
function flashLayer(flash, n) {
  if (!flash || !(flash.age >= 0) || flash.age >= (FLASH_MS[flash.kind] || 0)) return null;
  const t = flash.age / FLASH_MS[flash.kind], fade = 1 - t;
  switch (flash.kind) {
    case "select": return lamps(...Array(n).fill(dim(LAMP.amber, fade)));
    case "menu": return lamps(...Array(n).fill(dim(LAMP.white, fade * 0.8)));
    case "voice": return spot(t, CYAN, 0.8, n);
    case "error": {
      const on = flash.age < 120 || (flash.age >= 200 && flash.age < 320);
      return on ? lamps(...Array(n).fill(LAMP.red)) : lightsOff(n);
    }
    default: return null;
  }
}
// Hold progress. "select" is a menu press working towards a choice: amber fills, and past the selection
// threshold white counts to the silent three-second fallback. "gesture" is the third press of the menu
// gesture (tap, tap, hold): the two tap lamps stay lit and the right lamp fills white towards the menu.
function pressLayer(press, n) {
  if (!press) return null;
  const e = press.elapsedMs;
  if (press.kind === "select") {
    if (e < SELECT_DEAD_MS) return null;
    if (e < press.holdMs) return meter((e - SELECT_DEAD_MS) / (press.holdMs - SELECT_DEAD_MS), LAMP.amber, LAMP.off, n);
    // Past the selection threshold: amber stays (release selects) while white counts to the menu hold.
    return meter((e - press.holdMs) / Math.max(1, ESCAPE_MS - press.holdMs), LAMP.white, LAMP.amber, n);
  }
  if (press.kind === "gesture") {
    const fraction = clamp(e / Math.max(1, press.holdMs), 0, 1);
    // The two tap lamps stay lit, any lamp between is dim, and the rightmost fills towards the menu.
    return lamps(dim(CYAN, 0.55), dim(CYAN, 0.55), ...each(n - 3, () => dim(CYAN, 0.2)), blend(dim(CYAN, 0.2), LAMP.white, fraction));
  }
  return null;
}
// One lamp per tap of the gesture, left to right; the third lamp is the hold (pressLayer).
function clickLayer(clicks, n) {
  if (!clicks || !(clicks.count > 0)) return null;
  const lit = Math.min(2, clicks.count);
  return lamps(...each(n, (i) => (i < lit ? dim(CYAN, 0.55) : null)));
}
// Last ten seconds of a running timer: three, two, then one lamp, brightest on each second.
// The service finishes timers on a one-second tick, so for up to two seconds past zero the last
// lamp stays up (rather than flickering back to the glow) until the completion effect arrives.
export const COUNTDOWN_GRACE_S = 2;
function countdownLayer(remaining, n) {
  if (!Number.isFinite(remaining) || remaining <= -COUNTDOWN_GRACE_S || remaining > COUNTDOWN_S) return null;
  // All lamps, then one fewer for each equal share of the ten seconds, down to one.
  let lit = 1;
  for (let k = n - 1; k >= 1; k--) if (remaining > COUNTDOWN_S * k / n) { lit = k + 1; break; }
  const tick = remaining > 0 ? remaining % 1 : 0, level = 0.18 + 0.4 * tick * tick;
  return lamps(...each(n, (i) => (i < lit ? dim(LAMP.amber, level) : null)));
}
function restLayer(m, n) {
  if (!(m.rest > 0)) return null;
  const out = Array(n * 3).fill(0);
  const add = (rgbs) => rgbs.forEach((rgb, i) => rgb.forEach((c, k) => { out[i * 3 + k] = Math.max(out[i * 3 + k], c); }));
  if (m.ambient && m.scene === "dashboard") {
    // A slow breath, a little out of phase from lamp to lamp.
    const breath = (i) => (m.calm ? 0.14 : 0.06 + 0.2 * pulse(m.seconds - i * 1.2, 1 / 8));
    add(each(n, (i) => dim(GREEN, breath(i))));
  }
  if (m.spot != null) {
    const s = spot(m.spot, GREEN, 0.75, n);
    add(each(n, (i) => dim(s.slice(i * 3, i * 3 + 3), 0.6)));
  }
  return out.map((v) => v * m.rest);
}

// m: { scene: "dashboard" | "menu" | "instrument" | "game", seconds, scale (0..1), rest (0..1),
//      ambient, calm, spot (0..1 | null), press, clicks, flash, timerRemaining, mic, lamps (3 or 4) }
// Highest layer that has something to show wins the whole row; the microphone lamp goes on top.
export function lampFrame(m) {
  const n = m.lamps === 4 ? 4 : 3;
  const layer = flashLayer(m.flash, n) || pressLayer(m.press, n) || clickLayer(m.clicks, n)
    || countdownLayer(m.timerRemaining, n) || restLayer(m, n) || lightsOff(n);
  const out = whole(scaleLeds(whole(layer), m.scale));
  if (m.mic) {
    const rgb = dim(MIC_RGB, micBrightness(m.scale));
    out.splice(micLamp(n) * 3, 3, ...rgb.map((v) => Math.max(1, v)));
  }
  return whole(out);
}

// Holds the little state the pure frame needs: last input, recent acknowledgements, the quiet
// window after a timer effect, and the smoothed position of the focus spot.
export class HostLamps {
  constructor() {
    this.lastInput = null; this.flash = null; this.quietFrom = -Infinity; this.quietUntil = -Infinity;
    this.pos = null; this.lastFrame = null;
  }
  touch(now) { this.lastInput = now; }
  // An acknowledgement is timed from the first frame that can show it, so a stalled frame
  // (an app launching) does not use up its few hundred milliseconds unseen.
  note(kind, now) { if (FLASH_MS[kind]) this.flash = { kind, at: now, shown: null }; }
  // The service started its timer-completion pattern (light_effect): stay out of its way.
  quiet(now, durationMs) { this.quietFrom = now; this.quietUntil = now + durationMs + EFFECT_MARGIN_MS; }
  idleFactor(now) {
    if (this.lastInput == null) return 1;
    const over = now - this.lastInput - IDLE.startMs;
    return over <= 0 ? 1 : over >= IDLE.fadeMs ? 0 : 1 - over / IDLE.fadeMs;
  }
  quietFactor(now) {
    if (now < this.quietFrom) return 1;
    if (now < this.quietUntil) return 0;
    return clamp((now - this.quietUntil) / EFFECT_FADE_MS, 0, 1);
  }
  // s: scene, level (name or number), ambient, reducedMotion, focus {index,count}|null, press,
  //    clicks, timerRemaining, mic.
  frame(now, s) {
    if (this.lastInput == null) this.lastInput = now;
    const target = !s.focus ? null : s.focus.count <= 1 ? 0.5 : clamp(s.focus.index / (s.focus.count - 1), 0, 1);
    if (target == null) this.pos = null;
    else {
      const dt = this.lastFrame == null ? 1000 : clamp(now - this.lastFrame, 0, 100);
      this.pos = this.pos == null ? target : this.pos + (target - this.pos) * (1 - Math.exp(-dt / 70));
    }
    this.lastFrame = now;
    if (this.flash && this.flash.shown == null) this.flash.shown = Math.max(now, this.flash.at);
    const flash = this.flash && { kind: this.flash.kind, age: now - this.flash.shown };
    return lampFrame({
      scene: s.scene, seconds: now / 1000, scale: levelScale(s.level),
      rest: this.idleFactor(now) * this.quietFactor(now),
      ambient: s.ambient !== false, calm: !!s.reducedMotion, spot: this.pos,
      press: s.press || null, clicks: s.clicks || null, flash,
      timerRemaining: s.timerRemaining ?? null, mic: !!s.mic, lamps: s.lamps,
    });
  }
}
