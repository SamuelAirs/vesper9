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
// Scenes whose lamps change from frame to frame; the others are a fixed colour and need no loop.
const ANIMATED = ["breathe", "aurora", "candle", "tide", "ember", "sunrise"];

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

// How the one button reaches all this (see buildActions). The first hold lights the lamps (the
// last scene, or a warm steady light the first time). The main list is short and fixed: SCENE,
// DIMMER, BRIGHTER, SLEEP IN 30 MIN, LAMPS OFF, COLOUR, SLEEP TIMER. DIMMER and BRIGHTER change
// the level at once, so each step is seen on the lamps. SCENE and COLOUR open lists whose
// highlight starts on the first row and PREVIEWS: every tap moves the highlight, and the
// lamps show the highlighted choice at once; a hold keeps it (the one in force is marked ●). The app learns of taps from the
// raw button edges the host forwards to event() after it has moved the highlight, and keeps its
// own count of where the highlight is (`cursor`), checked against every action it publishes
// and corrected whenever one is chosen. A preview is never saved: leaving a list, the system
// menu gesture or a dispose all leave the lamps as they were chosen.
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
    this.paused = false; // the system menu is open: it owns the lamps
    this.chosen = null; // id of the action that was run last (see focusOn)
    this.preview = null; // a choice shown on the lamps while its row is highlighted
    this.previewStart = 0;
    this.items = []; // the actions as last published, and where the host's highlight is
    this.cursor = 0;
    this.down = null; // the press in progress, for counting taps
    this.clock = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
    this.render();
    this.buildActions("first", true);
  }

  animating() {
    const scene = this.preview?.scene || this.s.scene;
    return (this.lit || !!this.preview) && !this.paused && ANIMATED.includes(scene);
  }

  // One frame loop, alive only while the lamps show a scene that moves: a steady colour or a
  // dark lamp costs nothing between ticks. light(), setPreview() and resume() start it; it
  // ends by itself, and on dispose() or when ctx.alive() turns false.
  startLoop() {
    if (this.raf || this.dead || !this.animating() || typeof requestAnimationFrame !== "function") return;
    const loop = () => {
      this.raf = 0;
      if (this.dead || !this.ctx.alive() || !this.animating()) return;
      try {
        const now = this.clock();
        if (now - this.lastFrameAt >= 60) this.refresh(now);
      } catch {}
      if (this.animating()) this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  // Send the lamps for the current moment. Called from the frame loop and from tick().
  refresh(now = this.clock()) {
    this.lastFrameAt = now;
    if (!this.lit && !this.preview) return;
    let factor = 1;
    if (this.sleepMin && this.lit) {
      const total = this.sleepMin * 60, elapsed = (now - this.sleepStart) / 1000;
      if (elapsed >= total) {
        this.lit = false;
        this.asleep = true;
        this.preview = null;
        this.show(lightsOff());
        this.render();
        this.buildActions();
        return;
      }
      factor = sleepFactor(total, elapsed);
    }
    const p = this.preview;
    const values = p
      ? sceneFrame(p.scene || this.s.scene, { ...this.s, ...p }, (now - this.previewStart) / 1000)
      : sceneFrame(this.s.scene, this.s, (now - this.sceneStart) / 1000);
    this.show(factor >= 1 ? values : values.map((v) => byte(v * factor)));
  }

  // Show `choice` ({ scene, colour, set, level, sunrise } in part) on the lamps without
  // keeping it, or go back to what was chosen (null).
  setPreview(choice) {
    const same = JSON.stringify(choice) === JSON.stringify(this.preview);
    if (same) return;
    this.preview = choice;
    this.previewStart = this.clock();
    if (choice) this.refresh(this.previewStart);
    else if (this.lit) this.refresh(this.previewStart);
    else this.show(lightsOff());
    this.render();
    this.startLoop();
  }

  show(values) {
    this.last = values;
    if (!this.paused) this.ctx.leds(values);
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
    const p = this.preview ? { ...this.s, ...this.preview } : this.s;
    const name = SCENES.find((x) => x.id === p.scene)?.name || "";
    const status = this.preview ? "PREVIEW / HOLD TO KEEP" : this.lit ? "LAMPS ON" : this.asleep ? "TIMER ENDED / DARK" : "LAMPS DARK";
    const colourName = USES_COLOUR.includes(p.scene) ? COLOURS[p.colour].name
      : p.scene === "set" ? SETS[p.set].name : "SET BY SCENE";
    const lamps = [0, 1, 2].map((i) =>
      `<circle id="lantern-lamp-${i}" cx="${60 + i * 100}" cy="26" r="20" fill="${this.swatch(i)}" fill-opacity="${this.opacity(i)}"/>` +
      `<circle cx="${60 + i * 100}" cy="26" r="22.5" fill="none" stroke="currentColor" stroke-width="2"/>`).join("");
    const html =
      `<div class="readout-grid">` +
      `<div class="utility-panel"><div class="data-label">SCENE</div><div class="big-readout">${esc(name)}</div>` +
      `<p>${esc(colourName)} · ${esc(LEVELS[p.level].name)}</p></div>` +
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
    this.preview = null;
    this.persist();
    this.refresh(now);
    this.render();
    this.startLoop();
  }

  persist() {
    const { scene, colour, set, level, sunrise } = this.s;
    this.ctx.saveProgress({ schema: 1, scene, colour, set, level, sunrise })?.catch?.(this.ctx.error);
  }

  off() {
    this.lit = false;
    this.asleep = false;
    this.preview = null;
    this.show(lightsOff());
    this.render();
  }

  // `want` is the action the highlight should land on in the list that follows (see focusOn).
  choose(change, restartScene = true, want = "scene") {
    Object.assign(this.s, change);
    this.menu = "main";
    this.light(restartScene);
    this.buildActions(want);
  }

  go(menu, want = "first") {
    this.menu = menu;
    this.setPreview(null); // a list opens on the current choice: nothing to preview yet
    this.buildActions(want);
  }

  // A step of brightness, kept at the ends of the range. The lamps light if they were dark.
  stepLevel(dir) {
    this.choose({ level: clamp(this.s.level + dir, 0, LEVELS.length - 1) }, false, dir < 0 ? "dimmer" : "brighter");
  }

  // Set (or, with 0, cancel) the sleep timer. A timer needs lamps to put out, so choosing one
  // while dark lights them.
  setSleep(minutes, want = "sleepmenu") {
    if (minutes && !this.lit) this.light(false);
    this.sleepMin = minutes;
    this.sleepStart = this.clock();
    this.asleep = false;
    this.menu = "main";
    this.render();
    this.buildActions(want);
  }

  // ---- the highlight, as the host keeps it ----

  // The host reports every button edge here after acting on it. A short press moved its
  // highlight to the next action, so the preview follows.
  event(e) {
    if (!e || e.type !== "button" || this.paused || this.dead) return;
    if (e.pressed) {
      if (e.repeat) return;
      const node = Number.isFinite(e.at_us);
      this.down = { stamp: node ? e.at_us / 1000 : this.clock(), node, arrival: this.clock() };
      return;
    }
    const d = this.down;
    this.down = null;
    if (!d) return; // a release whose press the host took for something else
    const dur = d.node && Number.isFinite(e.at_us) ? e.at_us / 1000 - d.stamp : this.clock() - d.arrival;
    if (!(dur >= 0) || dur >= (Number.isFinite(this.ctx.settings?.().holdMs) ? this.ctx.settings().holdMs : 650)) return;
    if (!this.items.length) return;
    this.cursor = (this.cursor + 1) % this.items.length;
    this.setPreview(this.items[this.cursor].preview || null);
  }
  // The host dropped held input (the system menu gesture, or focus moving). Taps it let
  // through already moved the highlight, so the preview stays with the highlight.
  cancel() { this.down = null; }

  // The host keeps the highlight on the action with the same id, else on the same row number,
  // which after a menu change is an arbitrary row (once it was RETURN TO DASHBOARD). So the
  // action that should be highlighted next takes over the id of the one just chosen. `want` is
  // an id or "first". On opening (`park`) the highlight would otherwise start on the row
  // numbered like the dashboard card that was chosen (RESONANCE used to open on RETURN TO
  // DASHBOARD), so a one-item list is published first, which pins the highlight to the target.
  // The new list's highlight position is worked out here too (`cursor`).
  focusOn(items, want, park = false) {
    const target = want === "first" ? items[0] : items.find((i) => i.id === want);
    const before = this.items[this.cursor]?.id;
    if (target && this.chosen) {
      for (const item of items) if (item !== target && item.id === this.chosen) item.id += "~";
      target.id = this.chosen;
    }
    for (const item of items) {
      const run = item.run;
      item.run = () => { this.chosen = item.id; this.cursor = Math.max(0, items.indexOf(item)); return run(); };
    }
    if (park && target) this.ctx.actions([target]);
    const matching = before === undefined ? -1 : items.findIndex((i) => i.id === before);
    this.cursor = target ? items.indexOf(target) : Math.min(matching >= 0 ? matching : this.cursor, items.length - 1);
    this.items = items;
  }

  buildActions(want = null, park = false) {
    const mark = (on) => (on ? "● " : "");
    const back = (to, from) => ({ id: "back-" + to, label: "BACK", run: () => this.go(to, from) });
    const keep = (item) => item; // an item with a `preview` shows on the lamps while highlighted
    const withScene = (id, name = SCENES.find((x) => x.id === id).name) =>
      keep({ id: "scene-" + id, label: mark(this.s.scene === id) + name, preview: { scene: id }, run: () => this.choose({ scene: id }) });
    let items, hint = "Tap to advance. Hold and release to choose. The lamps go dark when you leave.";
    switch (this.menu) {
      case "scene":
        items = [
          withScene("steady", "STEADY LIGHT"), withScene("candle"), withScene("breathe"), withScene("aurora"), withScene("tide"),
          { id: "sets", label: mark(this.s.scene === "set") + "THREE-LAMP SETS →", run: () => this.go("sets") },
          { id: "night", label: mark(this.s.scene === "ember" || this.s.scene === "sunrise") + "EMBER AND SUNRISE →", run: () => this.go("night") },
          back("main", "scene"),
        ];
        hint = "Tap to see each scene on the lamps. Hold and release to keep the one showing.";
        break;
      case "sets":
        items = [
          ...SETS.map((set, i) => keep({ id: "set-" + set.id, label: mark(this.s.scene === "set" && this.s.set === i) + set.name,
            preview: { scene: "set", set: i }, run: () => this.choose({ scene: "set", set: i }) })),
          back("scene", "sets"),
        ];
        hint = "Tap to see each set on the lamps. Hold and release to keep the one showing.";
        break;
      case "night":
        items = [
          withScene("ember", "EMBER / SLOW BURN-DOWN"),
          ...SUNRISE_MINUTES.map((m) => keep({ id: "sunrise-" + m, label: mark(this.s.scene === "sunrise" && this.s.sunrise === m) + "SUNRISE / " + m + " MIN",
            preview: { scene: "sunrise", sunrise: m }, run: () => this.choose({ scene: "sunrise", sunrise: m }) })),
          back("scene", "night"),
        ];
        hint = "Tap to see each one on the lamps. Hold and release to keep the one showing.";
        break;
      case "colour":
        items = [
          ...COLOURS.map((c, i) => {
            // Steady, breathe and tide take a colour; any other scene becomes steady.
            const scene = USES_COLOUR.includes(this.s.scene) ? this.s.scene : "steady";
            return keep({ id: "colour-" + c.id, label: mark(this.s.colour === i && USES_COLOUR.includes(this.s.scene)) + c.name,
              preview: { colour: i, scene }, run: () => this.choose({ colour: i, scene }, false, "colour") });
          }),
          back("main", "colour"),
        ];
        hint = "Tap to see each colour on the lamps. Hold and release to keep the one showing.";
        break;
      case "sleep":
        items = [
          { id: "sleep-off", label: mark(!this.sleepMin) + "NO TIMER", run: () => this.setSleep(0) },
          ...SLEEP_MINUTES.map((m) => ({ id: "sleep-" + m, label: mark(this.sleepMin === m) + "OFF AFTER " + m + " MIN",
            run: () => this.setSleep(m) })),
          back("main", "sleepmenu"),
        ];
        break;
      default:
        items = [];
        if (!this.lit)
          items.push({ id: "power", label: (this.hasSaved || this.asleep ? "RESUME / " : "LIGHT / ") + this.summary() + " / " + LEVELS[this.s.level].name, run: () => { this.light(); this.buildActions("scene"); } });
        items.push(
          { id: "scene", label: "SCENE / " + (SCENES.find((x) => x.id === this.s.scene)?.name || ""), run: () => this.go("scene") },
          { id: "dimmer", label: this.s.level === 0 ? "DIMMER / LOWEST" : "DIMMER", run: () => this.stepLevel(-1) },
          { id: "brighter", label: this.s.level === LEVELS.length - 1 ? "BRIGHTER / HIGHEST" : "BRIGHTER", run: () => this.stepLevel(1) },
          { id: "sleep30", label: this.sleepMin && this.lit ? "CANCEL SLEEP TIMER / " + this.sleepMin + " MIN" : "SLEEP IN 30 MIN", run: () => this.setSleep(this.sleepMin && this.lit ? 0 : 30, "sleep30") },
        );
        if (this.lit) items.push({ id: "off", label: "LAMPS OFF", run: () => { this.off(); this.buildActions("home"); } });
        items.push(
          { id: "colour", label: "COLOUR / " + COLOURS[this.s.colour].name, run: () => this.go("colour") },
          { id: "sleepmenu", label: "SLEEP TIMER / " + (this.sleepMin ? this.sleepMin + " MIN" : "OFF"), run: () => this.go("sleep") },
          { id: "home", label: "RETURN TO DASHBOARD", run: this.ctx.home },
        );
    }
    this.focusOn(items, want, park);
    this.ctx.actions(items);
    this.ctx.hint(hint);
  }
  tick() {
    this.refresh();
    this.render();
  }
  // While the system menu is open it owns the lamps; the timer and the scene clock go on, and
  // the lamps return, in step, when it closes.
  pause() { this.paused = true; this.down = null; }
  resume() {
    this.paused = false;
    this.down = null;
    if (this.lit || this.preview) { this.ctx.leds(this.last); this.refresh(); this.startLoop(); }
  }
  dispose() {
    this.dead = true;
    try {
      if (typeof cancelAnimationFrame === "function" && this.raf) cancelAnimationFrame(this.raf);
    } catch {}
    this.lit = false;
    this.preview = null;
    this.ctx.leds(lightsOff());
  }
}
