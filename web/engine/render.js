// The game canvas's logical size: every app draws in these coordinates, whatever the backing store.
export const LOGICAL_W = 960;
export const LOGICAL_H = 540;
// RENDER QUALITY (Calibration): the share of the shown pixels the canvas holds.
export const RENDER_QUALITY = { auto: 1, sharp: 1, fast: 0.7 };
// `step` is AUTO's own reduction (1 until a game keeps missing frames).
export const renderFactor = (quality, step = 1) =>
  quality === "sharp" ? 1 : quality === "fast" ? RENDER_QUALITY.fast : step;
