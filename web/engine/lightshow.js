// Pure helpers for the RGB lamps. Every function returns the values (R,G,B per lamp, left to
// right, 0–255) that an app passes to ctx.leds(). Nothing here talks to the node, so it is safe
// in tests and in the simulator.
//
// The first node had three lamps (nine values); the current one has four (twelve). Every helper
// takes the lamp count as its last argument and defaults to three, so a game written for three
// lamps looks exactly as it did: the host leaves the fourth lamp dark. A game that uses all of
// them passes ctx.lampCount(). The ESP32's own board LED is a separate light (ctx.board()).
import { clamp } from "./math.js";

// The most lamps a node has, and the count every helper assumes unless told otherwise.
export const MAX_LAMPS = 4;
export const LEGACY_LAMPS = 3;

export const LAMP = {
  off: [0, 0, 0],
  green: [30, 255, 70],
  amber: [255, 110, 0],
  red: [255, 12, 0],
  cyan: [0, 200, 170],
  blue: [0, 40, 255],
  violet: [150, 0, 255],
  white: [255, 200, 150],
};
const byte = (value) => Math.round(clamp(value, 0, 255));
export const dim = (rgb, level) => rgb.map((channel) => byte(channel * level));
export const blend = (from, to, t) =>
  from.map((channel, i) => byte(channel + (to[i] - channel) * clamp(t, 0, 1)));
const each = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));
export const lightsOff = (n = LEGACY_LAMPS) => Array(n * 3).fill(0);
// One colour per lamp, left to right (three or four of them); pass null (or LAMP.off) for a dark lamp.
export const lamps = (...rgbs) => rgbs.flatMap((rgb) => (rgb || LAMP.off).map(byte));
export const fill = (rgb, level = 1, n = LEGACY_LAMPS) => lamps(...each(n, () => dim(rgb, level)));
export const only = (index, rgb, level = 1, n = LEGACY_LAMPS) =>
  lamps(...each(n, (i) => (i === index ? dim(rgb, level) : null)));
// A bar that fills left to right: fraction 0..1, the lamp at the edge is partly lit.
export const meter = (fraction, rgb, rest = LAMP.off, n = LEGACY_LAMPS) =>
  lamps(...each(n, (i) => blend(rest, rgb, clamp(fraction * n - i, 0, 1))));
// A spot of light at position 0 (left) .. 1 (right); width is in lamp spacings.
export const spot = (position, rgb, width = 0.75, n = LEGACY_LAMPS) =>
  lamps(...each(n, (i) => dim(rgb, clamp(1 - Math.abs(position * (n - 1) - i) / width, 0, 1))));
// Lamp values for `n` lamps from values for any number: extra lamps dark, missing ones dropped.
export const padLamps = (values, n = MAX_LAMPS) => {
  const out = Array(n * 3).fill(0);
  for (let i = 0; i < Math.min(out.length, values.length); i++) out[i] = values[i];
  return out;
};
// Colour along a list of stops, e.g. ramp(danger, [LAMP.green, LAMP.amber, LAMP.red]).
export const ramp = (t, stops) => {
  const scaled = clamp(t, 0, 1) * (stops.length - 1);
  const index = Math.min(Math.floor(scaled), stops.length - 2);
  return blend(stops[index], stops[index + 1], scaled - index);
};
// 0..1 brightness curves driven by a time in seconds.
export const pulse = (seconds, hz = 1) => 0.5 - 0.5 * Math.cos(seconds * hz * Math.PI * 2);
export const blink = (seconds, hz = 2) => (((seconds * hz) % 1) < 0.5 ? 1 : 0);
// Which lamp a running light is on: 0, 1, 2, 1, 0 … (bounce) or 0, 1, 2, 0 … (loop), over n lamps.
export const chase = (seconds, hz = 4, bounce = true, n = LEGACY_LAMPS) => {
  const step = Math.floor(seconds * hz);
  if (!bounce || n < 2) return step % n;
  const k = step % (2 * n - 2);
  return k < n ? k : 2 * n - 2 - k;
};
// Multiply lamp values (nine or twelve, or three for the board LED) by a 0..1 level. A lit channel stays lit (at least 1) while the
// level is above zero, so a dim colour never vanishes only because of rounding.
export function scaleLeds(values, level) {
  if (!Array.isArray(values) || !values.length || values.length % 3 || values.length > MAX_LAMPS * 3 || values.some((v) => typeof v !== "number" || !Number.isFinite(v))) return values;
  const k = clamp(level, 0, 1);
  return values.map(byte).map((v) => (v && k > 0 ? Math.max(1, Math.round(v * k)) : 0));
}
