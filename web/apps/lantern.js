// LANTERN — the three lamps as a lamp. An instrument: the owner picks a scene, colour and
// brightness with the one button and the lamps hold it until the instrument is left.
//
// Timing. An instrument gets tick() once a second, far too coarse for a slow swell, and the
// host has no per-frame hook for instruments. So this file runs one requestAnimationFrame
// loop of its own (started in the constructor, ended by dispose() or when ctx.alive() turns
// false) that recomputes the lamps about 16 times a second; the host then coalesces to its
// own ~17/s. tick() recomputes as well, so the lamps still follow time when the browser
// stops delivering frames (hidden page) or has no requestAnimationFrame (tests). All scene
// maths is the pure function sceneFrame(scene, settings, seconds); nothing here keeps a
// timer or advances state per frame.
import { LAMP, dim, blend, ramp, lightsOff } from "../engine/lightshow.js";
import { clamp, escapeHTML as esc } from "../engine/math.js";

const WARM = [255, 150, 60];
// Curated colours; the first is the default. Channel values are full strength: brightness
// scales them, so the lowest step stays dim whatever the colour.
export const COLOURS = [
  { id: "warm", name: "WARM WHITE", rgb: WARM },
  { id: "amber", name: "AMBER", rgb: LAMP.amber },
  { id: "phosphor", name: "PHOSPHOR GREEN", rgb: LAMP.green },
  { id: "cyan", name: "CYAN", rgb: LAMP.cyan },
  { id: "blue", name: "DEEP BLUE", rgb: LAMP.blue },
  { id: "violet", name: "VIOLET", rgb: LAMP.violet },
  { id: "red", name: "RED / NIGHT VISION", rgb: LAMP.red },
];
// Three-lamp sets: left, middle, right.
export const SETS = [
  { id: "dusk", name: "DUSK", rgb: [LAMP.amber, LAMP.red, LAMP.violet] },
  { id: "reef", name: "REEF", rgb: [LAMP.green, LAMP.cyan, LAMP.blue] },
  { id: "hearth", name: "HEARTH", rgb: [LAMP.red, LAMP.amber, WARM] },
  { id: "nebula", name: "NEBULA", rgb: [LAMP.violet, LAMP.blue, LAMP.cyan] },
];
// Sustained light stays at or under a third of full (the lamps are bright in a dark room).
export const LEVELS = [
  { name: "NIGHT", value: 0.025 },
  { name: "LOW", value: 0.09 },
  { name: "MEDIUM", value: 0.2 },
  { name: "HIGH", value: 0.33 },
];
export const SCENES = [
  { id: "steady", name: "STEADY" },
  { id: "set", name: "THREE-LAMP SET" },
  { id: "breathe", name: "BREATHE" },
  { id: "aurora", name: "AURORA" },
  { id: "candle", name: "CANDLE" },
  { id: "tide", name: "TIDE" },
  { id: "ember", name: "EMBER" },
  { id: "sunrise", name: "SUNRISE" },
];
export const SLEEP_MINUTES = [5, 15, 30, 60];
export const SUNRISE_MINUTES = [10, 20, 30];
export const SLEEP_FADE = 60; // seconds of fade at the end of a sleep timer
export const EMBER_SECONDS = 30 * 60; // an ember takes half an hour to burn down
const USES_COLOUR = ["steady", "breathe", "tide"];

const byte = (v) => Math.round(clamp(Number.isFinite(v) ? v : 0, 0, 255));
const smooth = (x) => x * x * (3 - 2 * x);
// Deterministic noise in 0..1 from an integer lattice, smoothly interpolated: the candle's
// irregularity is a function of (seed, lamp, time), so a test sees the same flame twice.
const lattice = (seed, n) => {
  let h = Math.imul((n | 0) ^ Math.imul(seed | 0, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
};
export const noise = (seed, x) => {
  const i = Math.floor(x), f = smooth(x - i);
  return lattice(seed, i) * (1 - f) + lattice(seed, i + 1) * f;
};
const fold = (rgbs, level) => rgbs.flatMap((rgb) => dim(rgb, clamp(level, 0, 1)).map(byte));
const AURORA = [LAMP.green, LAMP.cyan, LAMP.blue, LAMP.violet, LAMP.cyan, LAMP.green];

export function sanitize(raw) {
  const o = raw && typeof raw === "object" ? raw : {};
  const index = (v, n, d = 0) => (Number.isInteger(v) && v >= 0 && v < n ? v : d);
  return {
    scene: SCENES.some((s) => s.id === o.scene) ? o.scene : "steady",
    colour: index(o.colour, COLOURS.length),
    set: index(o.set, SETS.length),
    level: index(o.level, LEVELS.length, 1),
    sunrise: SUNRISE_MINUTES.includes(o.sunrise) ? o.sunrise : 20,
  };
}

// Nine lamp values for a scene `seconds` after it was started. s: { scene, colour, set,
// level, sunrise, seed } with the indexes used above. Pure and total: any input gives nine
// whole numbers 0..255.
export function sceneFrame(scene, s, seconds) {
  const t = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const st = { ...sanitize(s), seed: Number.isFinite(s?.seed) ? s.seed | 0 : 1 };
  const level = LEVELS[st.level].value;
  const rgb = COLOURS[st.colour].rgb;
  switch (scene) {
    case "steady":
      return fold([rgb, rgb, rgb], level);
    case "set":
      return fold(SETS[st.set].rgb, level);
    case "breathe": {
      // An eight-second swell, with the floor at a fifth so it never goes fully dark.
      const p = 0.5 - 0.5 * Math.cos((t / 8) * Math.PI * 2);
      return fold([rgb, rgb, rgb], level * (0.2 + 0.8 * smooth(p)));
    }
    case "aurora":
      // Colour drifts through green, cyan, blue and violet, a fifth of a turn apart per lamp,
      // with a slow second swell so the lamps never move in step.
      return [0, 1, 2].flatMap((i) => {
        const phase = (t / 70 + i * 0.2) % 1;
        const swell = 0.7 + 0.3 * Math.sin((t / 19 + i * 0.27) * Math.PI * 2);
        return dim(ramp(phase, AURORA), clamp(level * swell, 0, 1)).map(byte);
      });
    case "candle":
      // Fast shimmer plus a slow wander and an occasional gutter, independent per lamp.
      return [0, 1, 2].flatMap((i) => {
        const seed = st.seed * 7 + i * 101;
        const shimmer = noise(seed, t * 7), wander = noise(seed + 1, t * 1.3);
        const gutter = noise(seed + 2, t * 0.45) > 0.86 ? 0.55 : 1;
        const f = clamp((0.5 + 0.28 * wander + 0.22 * shimmer) * gutter, 0, 1);
        return dim(blend([255, 70, 4], [255, 150, 40], f), level * (0.35 + 0.65 * f)).map(byte);
      });
    case "tide": {
      // A pool of light rolling left to right and back every 16 seconds.
      const position = 0.5 - 0.5 * Math.cos((t / 16) * Math.PI * 2);
      return [0, 1, 2].flatMap((i) => {
        const near = clamp(1 - Math.abs(position * 2 - i) / 0.95, 0, 1);
        return dim(rgb, level * (0.08 + 0.92 * smooth(near))).map(byte);
      });
    }
    case "ember": {
      // Amber fading to red and down to a fifth of the chosen level over half an hour.
      const p = clamp(t / EMBER_SECONDS, 0, 1);
      return [0, 1, 2].flatMap((i) => {
        const glow = 0.88 + 0.12 * Math.sin(t / 5 + i * 2.1);
        return dim(blend(LAMP.amber, [200, 14, 0], p), level * (1 - 0.8 * p) * glow).map(byte);
      });
    }
    case "sunrise": {
      // Deep red, amber, then warm white. The ramp climbs to at least a quarter of full so it
      // is a real wake light even if the dimmest step was chosen; the left lamp leads.
      const total = Math.max(60, st.sunrise * 60);
      const high = Math.max(level, 0.25), low = 0.02;
      return [0, 1, 2].flatMap((i) => {
        const p = clamp((t / total) * 1.2 - 0.075 * i, 0, 1);
        return dim(ramp(p, [LAMP.red, LAMP.amber, WARM]), low + (high - low) * p).map(byte);
      });
    }
    default:
      return lightsOff();
  }
}

// 1 until the last SLEEP_FADE seconds of a sleep timer, then down to 0.
export function sleepFactor(totalSeconds, elapsedSeconds) {
  if (!(totalSeconds > 0)) return 1;
  const left = totalSeconds - (Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0);
  return clamp(left / Math.min(SLEEP_FADE, totalSeconds), 0, 1);
}

const mmss = (seconds) => {
  const s = Math.max(0, Math.ceil(seconds));
  return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
};

export class Lantern {
  constructor(ctx) {
    this.ctx = ctx;
    this.navigation = true;
    const saved = ctx.progress?.();
    this.hasSaved = !!saved?.scene;
    this.s = { ...sanitize(saved), seed: ctx.rng.int(1, 65535) };
    this.lit = false; // nothing shines until the owner chooses
    this.asleep = false;
    this.sceneStart = 0;
    this.sleepMin = 0;
    this.sleepStart = 0;
    this.menu = "main";
    this.last = lightsOff();
    this.lastHtml = "";
    this.lastFrameAt = -1e9;
    this.dead = false;
    this.clock = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
    this.render();
    this.buildActions();
    this.startLoop();
  }

  startLoop() {
    if (typeof requestAnimationFrame !== "function") return;
    const loop = () => {
      if (this.dead || !this.ctx.alive()) return;
      try {
        const now = this.clock();
        if (now - this.lastFrameAt >= 60) this.refresh(now);
      } catch {}
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  // Send the lamps for the current moment. Called from the frame loop and from tick().
  refresh(now = this.clock()) {
    this.lastFrameAt = now;
    if (!this.lit) return;
    let factor = 1;
    if (this.sleepMin) {
      const total = this.sleepMin * 60, elapsed = (now - this.sleepStart) / 1000;
      if (elapsed >= total) {
        this.lit = false;
        this.asleep = true;
        this.show(lightsOff());
        this.render();
        this.buildActions();
        return;
      }
      factor = sleepFactor(total, elapsed);
    }
    const values = sceneFrame(this.s.scene, this.s, (now - this.sceneStart) / 1000);
    this.show(factor >= 1 ? values : values.map((v) => byte(v * factor)));
  }

  show(values) {
    this.last = values;
    this.ctx.leds(values);
    this.paint();
  }

  // Colour the drawing of the lamps without rebuilding the page.
  paint() {
    if (typeof document === "undefined") return;
    try {
      for (let i = 0; i < 3; i++) {
        const el = document.getElementById("lantern-lamp-" + i);
        if (el) {
          el.setAttribute("fill", this.swatch(i));
          el.setAttribute("fill-opacity", this.opacity(i));
        }
      }
    } catch {}
  }
  // The drawing shows the hue at full strength and the brightness as opacity: at the dimmest
  // step the real lamp is nearly dark, which would make a picture of it black.
  swatch(i) {
    const v = this.last.slice(i * 3, i * 3 + 3), peak = Math.max(...v, 1);
    return `rgb(${v.map((c) => Math.round((c / peak) * 255)).join(",")})`;
  }
  opacity(i) {
    const peak = Math.max(...this.last.slice(i * 3, i * 3 + 3));
    return peak ? (0.2 + 0.8 * Math.min(1, peak / 90)).toFixed(2) : "0";
  }

  summary() {
    const name = SCENES.find((x) => x.id === this.s.scene)?.name || "STEADY";
    const what = this.s.scene === "set" ? SETS[this.s.set].name
      : this.s.scene === "sunrise" ? this.s.sunrise + " MIN"
      : USES_COLOUR.includes(this.s.scene) ? COLOURS[this.s.colour].name : "";
    return what && what !== name ? name + " / " + what : name;
  }

  sleepText(now = this.clock()) {
    if (this.asleep) return "ENDED";
    if (!this.sleepMin) return "OFF";
    if (!this.lit) return this.sleepMin + " MIN";
    return mmss(this.sleepMin * 60 - (now - this.sleepStart) / 1000);
  }

  render() {
    const name = SCENES.find((x) => x.id === this.s.scene)?.name || "";
    const status = this.lit ? "LAMPS ON" : this.asleep ? "TIMER ENDED / DARK" : "LAMPS DARK";
    const colourName = USES_COLOUR.includes(this.s.scene) ? COLOURS[this.s.colour].name
      : this.s.scene === "set" ? SETS[this.s.set].name : "SET BY SCENE";
    const lamps = [0, 1, 2].map((i) =>
      `<circle id="lantern-lamp-${i}" cx="${60 + i * 100}" cy="26" r="20" fill="${this.swatch(i)}" fill-opacity="${this.opacity(i)}"/>` +
      `<circle cx="${60 + i * 100}" cy="26" r="22.5" fill="none" stroke="currentColor" stroke-width="2"/>`).join("");
    const html =
      `<div class="readout-grid">` +
      `<div class="utility-panel"><div class="data-label">SCENE</div><div class="big-readout">${esc(name)}</div>` +
      `<p>${esc(colourName)} · ${esc(LEVELS[this.s.level].name)}</p></div>` +
      `<div class="utility-panel"><div class="data-label">SLEEP TIMER</div><div class="big-readout">${esc(this.sleepText())}</div>` +
      `<p class="recording-tag">${esc(status)}</p></div></div>` +
      `<div class="utility-panel"><svg viewBox="0 0 320 52" width="320" height="52" role="img" aria-label="The three lamps in their current colours" style="display:block;margin:0 auto;color:#657b5b">${lamps}</svg></div>`;
    if (html !== this.lastHtml) {
      this.lastHtml = html;
      this.ctx.content(html);
    }
  }

  // Switch the lamps on with the current settings. The scene clock restarts when asked; a
  // sleep timer that was waiting (or had ended) restarts as the lamps come on.
  light(restartScene = true) {
    const now = this.clock();
    if (restartScene || !this.lit) this.sceneStart = now;
    if (!this.lit) this.sleepStart = now;
    this.lit = true;
    this.asleep = false;
    this.persist();
    this.refresh(now);
    this.render();
  }

  persist() {
    const { scene, colour, set, level, sunrise } = this.s;
    this.ctx.saveProgress({ schema: 1, scene, colour, set, level, sunrise })?.catch?.(this.ctx.error);
  }

  off() {
    this.lit = false;
    this.asleep = false;
    this.show(lightsOff());
    this.render();
  }

  choose(change, restartScene = true) {
    Object.assign(this.s, change);
    this.menu = "main";
    this.light(restartScene);
    this.buildActions();
  }

  go(menu) {
    this.menu = menu;
    this.buildActions();
  }

  setSleep(minutes) {
    this.sleepMin = minutes;
    this.sleepStart = this.clock();
    this.asleep = false;
    this.menu = "main";
    this.render();
    this.buildActions();
  }

  buildActions() {
    const mark = (on) => (on ? "● " : "");
    const back = { id: "back", label: "BACK", run: () => this.go("main") };
    const backToScenes = { id: "back-scene", label: "BACK", run: () => this.go("scene") };
    const scene = (id, name = SCENES.find((x) => x.id === id).name) =>
      ({ id: "scene-" + id, label: mark(this.s.scene === id) + name, run: () => this.choose({ scene: id }) });
    let items;
    switch (this.menu) {
      case "scene":
        items = [
          scene("steady", "STEADY LIGHT"),
          { id: "sets", label: mark(this.s.scene === "set") + "THREE-LAMP SETS →", run: () => this.go("sets") },
          scene("breathe"), scene("aurora"), scene("candle"), scene("tide"),
          { id: "night", label: "EMBER AND SUNRISE →", run: () => this.go("night") },
          back,
        ];
        break;
      case "sets":
        items = [
          ...SETS.map((set, i) => ({ id: "set-" + set.id, label: mark(this.s.scene === "set" && this.s.set === i) + set.name,
            run: () => this.choose({ scene: "set", set: i }) })),
          backToScenes,
        ];
        break;
      case "night":
        items = [
          scene("ember", "EMBER / SLOW BURN-DOWN"),
          ...SUNRISE_MINUTES.map((m) => ({ id: "sunrise-" + m, label: mark(this.s.scene === "sunrise" && this.s.sunrise === m) + "SUNRISE / " + m + " MIN",
            run: () => this.choose({ scene: "sunrise", sunrise: m }) })),
          backToScenes,
        ];
        break;
      case "colour":
        items = [
          ...COLOURS.map((c, i) => ({ id: "colour-" + c.id, label: mark(this.s.colour === i && USES_COLOUR.includes(this.s.scene)) + c.name,
            // Steady, breathe and tide take a colour; any other scene becomes steady.
            run: () => this.choose({ colour: i, scene: USES_COLOUR.includes(this.s.scene) ? this.s.scene : "steady" }, false) })),
          back,
        ];
        break;
      case "bright":
        items = [
          ...LEVELS.map((l, i) => ({ id: "level-" + i, label: mark(this.s.level === i) + l.name,
            run: () => this.choose({ level: i }, false) })),
          back,
        ];
        break;
      case "sleep":
        items = [
          { id: "sleep-off", label: mark(!this.sleepMin) + "NO TIMER", run: () => this.setSleep(0) },
          ...SLEEP_MINUTES.map((m) => ({ id: "sleep-" + m, label: mark(this.sleepMin === m) + "OFF AFTER " + m + " MIN",
            run: () => this.setSleep(m) })),
          back,
        ];
        break;
      default:
        items = [];
        if (!this.lit)
          items.push({ id: "resume", label: (this.hasSaved || this.asleep ? "RESUME / " : "LIGHT / ") + this.summary() + " / " + LEVELS[this.s.level].name, run: () => { this.light(); this.buildActions(); } });
        items.push(
          { id: "scene", label: "SCENE / " + (SCENES.find((x) => x.id === this.s.scene)?.name || ""), run: () => this.go("scene") },
          { id: "colour", label: "COLOUR →", run: () => this.go("colour") },
          { id: "bright", label: "BRIGHTNESS / " + LEVELS[this.s.level].name, run: () => this.go("bright") },
          { id: "sleep", label: "SLEEP TIMER / " + (this.sleepMin ? this.sleepMin + " MIN" : "OFF"), run: () => this.go("sleep") },
        );
        if (this.lit) items.push({ id: "off", label: "LAMPS OFF", run: () => { this.off(); this.buildActions(); } });
        items.push({ id: "home", label: "RETURN TO DASHBOARD", run: this.ctx.home });
    }
    this.ctx.actions(items);
    this.ctx.hint("Tap to advance. Hold and release to choose. The lamps go dark when you leave.");
  }

  tick() {
    this.refresh();
    this.render();
  }
  cancel() {}
  dispose() {
    this.dead = true;
    try {
      if (typeof cancelAnimationFrame === "function" && this.raf) cancelAnimationFrame(this.raf);
    } catch {}
    this.lit = false;
    this.ctx.leds(lightsOff());
  }
}
