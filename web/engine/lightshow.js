// Pure helpers for the three RGB lamps. Every function returns the nine values
// (left R,G,B, middle R,G,B, right R,G,B; 0–255) that an app passes to ctx.leds().
// Nothing here talks to the node, so it is safe in tests and in the simulator.
import { clamp } from "./math.js";

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
export const lightsOff = () => Array(9).fill(0);
// One colour per lamp; pass null (or LAMP.off) for a dark lamp.
export const lamps = (left, middle, right) =>
  [left, middle, right].flatMap((rgb) => (rgb || LAMP.off).map(byte));
export const fill = (rgb, level = 1) => lamps(dim(rgb, level), dim(rgb, level), dim(rgb, level));
export const only = (index, rgb, level = 1) =>
  lamps(...[0, 1, 2].map((i) => (i === index ? dim(rgb, level) : null)));
// A bar that fills left to right: fraction 0..1, the lamp at the edge is partly lit.
export const meter = (fraction, rgb, rest = LAMP.off) =>
  lamps(...[0, 1, 2].map((i) => blend(rest, rgb, clamp(fraction * 3 - i, 0, 1))));
// A spot of light at position 0 (left) .. 1 (right); width is in lamp spacings.
export const spot = (position, rgb, width = 0.75) =>
  lamps(...[0, 1, 2].map((i) => dim(rgb, clamp(1 - Math.abs(position * 2 - i) / width, 0, 1))));
// Colour along a list of stops, e.g. ramp(danger, [LAMP.green, LAMP.amber, LAMP.red]).
export const ramp = (t, stops) => {
  const scaled = clamp(t, 0, 1) * (stops.length - 1);
  const index = Math.min(Math.floor(scaled), stops.length - 2);
  return blend(stops[index], stops[index + 1], scaled - index);
};
// 0..1 brightness curves driven by a time in seconds.
export const pulse = (seconds, hz = 1) => 0.5 - 0.5 * Math.cos(seconds * hz * Math.PI * 2);
export const blink = (seconds, hz = 2) => (((seconds * hz) % 1) < 0.5 ? 1 : 0);
// Which lamp a running light is on: 0, 1, 2, 1, 0 … (bounce) or 0, 1, 2, 0 … (loop).
export const chase = (seconds, hz = 4, bounce = true) => {
  const step = Math.floor(seconds * hz);
  return bounce ? [0, 1, 2, 1][step % 4] : step % 3;
};
// Multiply nine lamp values by a 0..1 level. A lit channel stays lit (at least 1) while the
// level is above zero, so a dim colour never vanishes only because of rounding.
export function scaleLeds(values, level) {
  if (!Array.isArray(values) || values.length !== 9 || values.some((v) => typeof v !== "number" || !Number.isFinite(v))) return values;
  const k = clamp(level, 0, 1);
  return values.map(byte).map((v) => (v && k > 0 ? Math.max(1, Math.round(v * k)) : 0));
}
