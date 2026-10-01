import { DEFAULT_SETTINGS } from "../apps/catalog.js";
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
        }
      }
    this.emit({
      type: "timers",
      timers: this.state.timers.map((t) => ({ ...t })),
    });
    if (++this.next % 5 === 0) this.sensor();
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
      this.state.leds = data.values;
      this.emit({ type: "leds", values: data.values });
    } else if (command === "reaction") {
      clearTimeout(this.reaction);
      await this.command("leds", { values: [70, 18, 0, 0, 0, 0, 0, 0, 0] });
      this.reaction = setTimeout(() => {
        this.command("leds", { values: [0, 0, 0, 30, 255, 90, 0, 0, 0] });
        this.emit({
          type: "cue",
          trial: data.trial,
          at_us: performance.now() * 1000,
          simulated: true,
          generation: 1,
        });
      }, data.delay);
    } else if (command === "cancel") {
      clearTimeout(this.reaction);
      this.pattern.forEach(clearTimeout);
      this.pattern = [];
    } else if (command === "pattern") {
      let delay = 0;
      for (let n = 0; n < (data.repeat || 1); n++)
        for (const step of data.steps) {
          this.pattern.push(
            setTimeout(
              () => this.command("leds", { values: step.values }),
              delay,
            ),
          );
          delay += step.ms;
        }
      this.pattern.push(
        setTimeout(
          () => this.command("leds", { values: Array(9).fill(0) }),
          delay,
        ),
      );
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
        if (!timer) return;
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
        }
      }
      this.save();
      this.emit({
        type: "timers",
        timers: this.state.timers.map((t) => ({ ...t })),
      });
    }
    return { accepted: true };
  }
  async get(path) {
    if (path === "history") return this.history;
    if (path.startsWith("sessions") || path.startsWith("transcript/")) return [];
    return this.state;
  }
  sendAudio() {}
}
