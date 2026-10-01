// A stand-in for the host's app context (docs/ENGINE.md) for cartridge tests.
// Every call is recorded so a test can assert on lamps, tones, scores and saves.
import { Random } from "../../web/engine/math.js";

export function appContext(options = {}) {
  const calls = { leds: [], tone: [], score: [], saved: [], hud: [], hint: [], controls: [], content: [], actions: [], command: [], pattern: [], toast: [] };
  let progress = options.progress || {};
  const settings = { sound: true, volume: 0.25, crt: true, reducedMotion: false, morseWpm: 10, holdMs: 650, menuClicks: 4, gesturePace: "standard", scanMs: 850, tempUnit: "F", ...(options.settings || {}) };
  const state = { simulated: true, settings, sensor: { temperature: 22, humidity: 45, at: 0 }, device: { connected: true }, mic: { mode: "off", level: 0 }, timers: [], scores: {}, progress: {}, ...(options.state || {}) };
  let best = options.best || 0, mounted = true;
  const ctx = {
    calls,
    rng: new Random(options.seed ?? 1979),
    alive: () => mounted,
    retire: () => { mounted = false; },
    simulated: () => true,
    settings: () => settings,
    knockInput: () => (settings.knock || "medium") !== "off",
    state: () => state,
    progress: () => progress,
    saveProgress: (value) => { progress = value; calls.saved.push(value); return Promise.resolve({ ok: true }); },
    best: () => best,
    score: (value, metric = "default") => { calls.score.push([value, metric]); best = Math.max(best, value); },
    leds: (values) => calls.leds.push(values.slice()),
    pattern: (steps) => { calls.pattern.push(steps); return Promise.resolve({ ok: true }); },
    tone: (...args) => calls.tone.push(args),
    synth: { startTone() {}, stopTone() {}, chime() {} },
    hud: (items) => calls.hud.push(items),
    hint: (message) => calls.hint.push(message),
    controls: (message) => calls.controls.push(message),
    content: (html) => calls.content.push(html),
    actions: (items) => { calls.actions.push(items); ctx.currentActions = items; },
    command: (name, data) => { calls.command.push([name, data]); return Promise.resolve(options.reply?.(name, data) ?? { ok: true }); },
    get: (path) => Promise.resolve(options.get?.(path) ?? {}),
    setMic: () => Promise.resolve(),
    home() {}, resume() {}, help() {}, error() {},
    toast: (message) => calls.toast.push(message),
    stats: () => ({ samples: 0, medianMs: 16.7, p95Ms: 16.7, errors: 0 }),
    downloadText() {}, download() {},
  };
  return ctx;
}

// A Canvas 2D context that accepts every call and property, counting calls, so
// draw() can run under node. `g.count.fillText`, for example, is the number of calls.
export function fakeCanvas() {
  const count = {};
  const gradient = { addColorStop() {} };
  const target = { count, canvas: { width: 960, height: 540 } };
  return new Proxy(target, {
    get(object, key) {
      if (key in object) return object[key];
      if (key === "measureText") return () => ({ width: 100 });
      if (typeof key === "string" && /^create.*(Gradient|Pattern)$/.test(key)) return () => gradient;
      return (...args) => { count[key] = (count[key] || 0) + 1; };
    },
    set(object, key, value) { object[key] = value; return true; },
  });
}

// Advance a game by whole fixed steps, as the host does.
export function run(app, seconds, each) {
  for (let i = 0, n = Math.round(seconds * 60); i < n; i++) {
    each?.(i);
    app.update(1 / 60);
  }
}
