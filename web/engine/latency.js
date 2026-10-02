// Console-wide input timing offset (TIMING OFFSET in Calibration, measured by the tap-along in
// web/apps/tapsync.js). `latencyMs` is positive when taps register late: USB, serial, the node's own
// debounce and the screen all add delay before a game sees a press. A timing game judges a tap at
// (arrival time - latencyMs), in its own clock. 0 when absent.
export const LATENCY_MIN_MS = -150;
export const LATENCY_MAX_MS = 300;
export const latencyMs = (settings) => {
  const v = settings?.latencyMs;
  return Number.isFinite(v) ? Math.max(LATENCY_MIN_MS, Math.min(LATENCY_MAX_MS, Math.round(v))) : 0;
};
// The same offset in seconds, for games that keep their clock in seconds.
export const latencySec = (settings) => latencyMs(settings) / 1000;
