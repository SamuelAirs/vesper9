import { CARTRIDGES, DEFAULT_SETTINGS } from "../apps/catalog.js";
// Standalone edition: the actual game engine with a browser-local simulated node.
// It never claims to perform speech recognition or to read real sensor hardware.
export class DemoBridge extends EventTarget {
  constructor() {
    super();
    this.connected = true;
    this.next = 0;
    this.reaction = null;
    this.pattern = [];
    this.pressed = false;
    this.history = [];
    this.focus = "home";
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem("vesper-demo") || "{}");
    } catch {}
    this.state = {
      type: "state",
      version: "0.2.0",
      controller: true,
      simulated: true,
      device: {
        connected: true,
        name: "STANDALONE SIMULATOR",
        capture: false,
        crcErrors: 0,
        missingSamples: 0,
        audioBytes: 0,
        button: false,
        generation: 1,
      },
      leds: Array(9).fill(0),
      mic: {
        mode: "off",
        level: 0,
        session: null,
        unavailable: "Speech requires the Pi service and a local model.",
      },
      sensor: null,
      timers: saved.timers || [],
      scores: saved.scores || {},
      progress: saved.progress || {},
      settings: { ...DEFAULT_SETTINGS, ...saved.settings },
    };
  }
  emit(event) {
    this.dispatchEvent(new CustomEvent("event", { detail: event }));
  }
  save() {
    try {
      localStorage.setItem(
        "vesper-demo",
        JSON.stringify({
          scores: this.state.scores,
          settings: this.state.settings,
          timers: this.state.timers,
          progress: this.state.progress,
        }),
      );
    } catch {}
  }
  connect() {
    queueMicrotask(() => {
      this.emit(this.state);
      this.sensor();
    });
    this.interval = setInterval(() => {
      this.tick();
    }, 1000);
  }
  sensor() {
    const t = Date.now() / 1000;
    this.state.sensor = {
      temperature: 22.4 + Math.sin(t / 95) * 0.6,
      humidity: 43 + Math.sin(t / 120) * 2,
      simulated: true,
      at: t,
    };
    this.history.push({ ...this.state.sensor });
    this.history = this.history.slice(-288);
    this.emit({ type: "sensor", ...this.state.sensor });
  }
  tick() {
    const now = Date.now() / 1000;
    for (const timer of this.state.timers)
      if (timer.running) {
        timer.remaining = Math.max(0, timer.deadline - now);
        if (!timer.remaining) {
          timer.running = false;
          timer.finished = true;
          this.emit({ type: "timer_done", timer });
          this.save();
          this.timerAlert();
        }
      }
    this.emit({
      type: "timers",
      timers: this.state.timers.map((t) => ({ ...t })),
    });
    if (++this.next % 5 === 0) this.sensor();
  }
  // Same rule as the service: gameplay keeps its lamps, the other screens get an amber blink.
  timerAlert() {
    if (!this.connected || !["home", "timers", "environment"].includes(this.focus)) return;
    this.emit({ type: "light_effect", durationMs: 1200 });
    const amber = Array(3).fill([180, 100, 0]).flat(), off = Array(9).fill(0);
    this.playPattern([{ ms: 180, values: amber }, { ms: 180, values: off }], 3);
  }
  setLeds(values) {
    this.state.leds = values;
    this.emit({ type: "leds", values });
  }
  playPattern(steps, repeat = 1) {
    this.pattern.forEach(clearTimeout);
    this.pattern = [];
    let delay = 0;
    for (let n = 0; n < repeat; n++)
      for (const step of steps) {
        this.pattern.push(setTimeout(() => this.setLeds(step.values), delay));
        delay += step.ms;
      }
    this.pattern.push(setTimeout(() => this.setLeds(Array(9).fill(0)), delay));
  }
  async command(command, data = {}) {
    if (command === "button") {
      const pressed = !!data.pressed;
      if (pressed !== this.pressed) {
        this.pressed = pressed;
        this.state.device.button = pressed;
        this.emit({
          type: "button",
          pressed,
          at_us: performance.now() * 1000,
          source: "simulator",
          generation: 1,
        });
      }
    } else if (command === "leds") {
      const values = data.values;
      if (!Array.isArray(values) || values.length !== 9 || values.some((x) => !Number.isInteger(x) || x < 0 || x > 255))
        throw new Error("Nine integer light values from 0 to 255 required");
      // As on the node, an explicit write stops any running pattern or armed cue.
      clearTimeout(this.reaction);
      this.pattern.forEach(clearTimeout);
      this.pattern = [];
      this.setLeds(values.slice());
    } else if (command === "reaction") {
      const trial = Math.trunc(Number(data.trial)), delay = Math.trunc(Number(data.delay));
      if (!(trial >= 0 && trial <= 0xFFFFFFFF) || !(delay >= 250 && delay <= 10000)) throw new Error("Invalid reaction round");
      clearTimeout(this.reaction);
      this.pattern.forEach(clearTimeout);
      this.pattern = [];
      this.setLeds([70, 18, 0, 0, 0, 0, 0, 0, 0]);
      this.reaction = setTimeout(() => {
        this.setLeds([0, 0, 0, 30, 255, 90, 0, 0, 0]);
        this.emit({
          type: "cue",
          trial,
          at_us: performance.now() * 1000,
          simulated: true,
          generation: 1,
        });
      }, delay);
    } else if (command === "cancel") {
      clearTimeout(this.reaction);
      this.pattern.forEach(clearTimeout);
      this.pattern = [];
    } else if (command === "pattern") {
      const steps = Array.isArray(data.steps) ? data.steps : [], repeat = Math.trunc(Number(data.repeat ?? 1));
      if (!(steps.length >= 1 && steps.length <= 16) || !(repeat >= 1 && repeat <= 8))
        throw new Error("Pattern must contain 1–16 steps and repeat 1–8 times");
      for (const step of steps) {
        const ms = Math.trunc(Number(step?.ms)), values = step?.values;
        if (!(ms >= 10 && ms <= 10000) || !Array.isArray(values) || values.length !== 9 ||
            values.some((v) => !Number.isInteger(v) || v < 0 || v > 255))
          throw new Error("Invalid pattern step");
      }
      clearTimeout(this.reaction);
      this.playPattern(steps, repeat);
    } else if (command === "score") {
      const key = data.metric && data.metric !== "default" ? data.app + ":" + data.metric : data.app;
      this.state.scores[key] = Math.max(
        this.state.scores[key] || 0,
        data.score,
      );
      this.save();
      this.emit({ type: "scores", scores: this.state.scores });
    } else if (command === "progress") {
      this.state.progress[data.app] = data.value;
      this.save();
    } else if (command === "settings") {
      this.state.settings[data.key] = data.value;
      this.save();
      this.emit({ type: "settings", settings: this.state.settings });
    } else if (command === "reset_settings") {
      this.state.settings = { ...DEFAULT_SETTINGS };
      this.save();
      this.emit({ type: "settings", settings: this.state.settings });
    } else if (command === "keepalive") {
      // Nothing to watch in the standalone edition.
    } else if (command === "mic") {
      if (data.mode !== "off")
        throw new Error(
          "The standalone edition simulates the node. Speech runs in the full Pi package.",
        );
    } else if (command === "timer") {
      if (data.op === "create") {
        if (this.state.timers.length >= 8)
          throw new Error("Eight timers already exist.");
        const seconds = data.seconds;
        if (!Number.isFinite(seconds) || seconds < 5 || seconds > 86400) throw new Error("Timer must be 5 seconds to 24 hours.");
        this.state.timers.push({
          id: Math.random().toString(36).slice(2),
          duration: seconds,
          remaining: seconds,
          running: true,
          finished: false,
          deadline: Date.now() / 1000 + seconds,
          label: String(data.label || "FIELD TIMER").slice(0, 32),
        });
      } else {
        const timer = this.state.timers.find((t) => t.id === data.id);
        if (!timer) throw new Error("Timer not found");
        if (data.op === "remove")
          this.state.timers = this.state.timers.filter((t) => t !== timer);
        else if (data.op === "toggle") {
          if (timer.running) {
            timer.remaining = Math.max(0, timer.deadline - Date.now() / 1000);
            timer.running = false;
          } else {
            timer.remaining = timer.remaining || timer.duration;
            timer.deadline = Date.now() / 1000 + timer.remaining;
            timer.running = true;
            timer.finished = false;
          }
        } else if (data.op === "reset") {
          timer.running = false;
          timer.remaining = timer.duration;
          timer.finished = false;
        } else throw new Error("Unknown timer action");
      }
      this.save();
      this.emit({
        type: "timers",
        timers: this.state.timers.map((t) => ({ ...t })),
      });
    } else if (command === "focus") {
      if (data.app !== "home" && !CARTRIDGES.some((a) => a.id === data.app)) throw new Error("Unknown app");
      this.focus = data.app;
    } else throw new Error("Unknown command");
    return { accepted: true };
  }
  async get(path) {
    if (path === "history") return this.history;
    if (path.startsWith("sessions") || path.startsWith("transcript/")) return [];
    return this.state;
  }
  sendAudio() {}
}
