import { Bridge } from "./engine/bridge.js";
import { DemoBridge } from "./engine/demo.js";
import { InputRouter } from "./engine/input.js";
import { Synth, BrowserMicrophone } from "./engine/audio.js";
import { Random, escapeHTML as esc, formatTime, formatTemp, tempUnit } from "./engine/math.js";
import { ambient, glyph, C, text, space } from "./engine/draw.js";
import { APPS } from "./apps/registry.js";
import { DEFAULT_SETTINGS as DEFAULT, SECTORS } from "./apps/catalog.js";
import { LightDirector } from "./engine/lights.js";
import { HostLamps, levelScale } from "./engine/ambient.js";
import { microphoneStatus } from "./engine/status.js";

const $ = (id) => document.getElementById(id);
// Assigning identical text still replaces the text node and dirties layout, so
// the once-a-second status refresh writes only what changed.
const setText = (id, value) => {
  const element = $(id);
  if (element.textContent !== value) element.textContent = value;
};
const ICONS = [
  '<circle cx="24" cy="24" r="16"/><ellipse cx="24" cy="24" rx="23" ry="8" transform="rotate(-35 24 24)"/><circle cx="37" cy="11" r="3" fill="currentColor"/>',
  '<path d="M5 36L17 11l12 25M17 11l12 9 13 16M9 29h24M5 42h38"/><circle cx="37" cy="9" r="4"/>',
  '<path d="M4 12q10-9 20 0t20 0M4 24q10-9 20 0t20 0M4 36q10-9 20 0t20 0"/><path d="M21 17l9 7-9 7z"/>',
  '<path d="M5 25h5v-9h5v18h6V8h6v32h6V18h5v7h5"/>',
  '<circle cx="24" cy="24" r="18"/><circle cx="24" cy="24" r="6"/><path d="M24 2v11M24 35v11M2 24h11M35 24h11"/>',
  '<path d="M24 3l20 12v23L24 46 4 34V11zM4 11l20 13 20-9M24 24v22M14 8l19 12"/>',
];
// A cartridge may bring its own card icon (catalog "icon"); otherwise "glyph" picks a shared one.
function icon(app) {
  return `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">${app.icon || ICONS[app.glyph % ICONS.length]}</svg>`;
}

export class Vesper {
  constructor(bridge) {
    this.bridge = bridge;
    this.state = {
      simulated: true,
      settings: { ...DEFAULT },
      scores: {},
      progress: {},
      timers: [],
      mic: { mode: "off" },
      device: { connected: false },
    };
    this.synth = new Synth();
    this.browserMic = new BrowserMicrophone(bridge);
    this.input = new InputRouter(this);
    this.epoch = 0;
    this.token = 0;
    this.app = null;
    this.meta = null;
    this.page = 0;
    this.nav = { items: [], index: 0 };
    this.menu = null;
    this.paused = false;
    this.active = true;
    this.clock = 0;
    this.accumulator = 0;
    this.last = 0;
    this.hudValue = "";
    this.lights = new LightDirector((cmd, data) => this.bridge.command(cmd, data));
    // Host-owned lamp feedback (navigation, holds, clicks, acknowledgements, ambient, mic live).
    this.hostLamps = new HostLamps();
    this.clickState = null;
    this.frameTimes = [];
    this.ambientStep = -1;
    this.loaded = false;
    this.errors = [];
    this.g = $("game").getContext("2d", { alpha: false });
    this.ag = $("ambient").getContext("2d");
    this.buildHome();
    this.bind();
    bridge.addEventListener("event", (e) => this.event(e.detail));
    bridge.connect();
    requestAnimationFrame((t) => this.frame(t));
    this.keepaliveCount = 0;
    this.clockTask = setInterval(() => {
      setText("clock", new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }));
      this.status();
      this.lifecycle("tick");
      // Lets the service notice a hung controlling tab and stop the microphone (docs/PROTOCOL.md).
      if (++this.keepaliveCount % 5 === 0 && this.loaded && this.state.controller !== false && this.state.device)
        this.bridge.command("keepalive", {}, true)?.catch?.(() => {});
    }, 1000);
  }
  escapePolicy() {
    return { clicks: this.meta?.escape === "hold" ? 0 : (this.state.settings.menuClicks ?? 4), pace: this.state.settings.gesturePace || "standard" };
  }
  menuHint() {
    const p = this.escapePolicy();
    return !this.app || this.app.navigation || !p.clicks ? "MENU: HOLD 3s" : `MENU: ${p.clicks} QUICK CLICKS`;
  }
  clickVisual(count, total) {
    this.clickState = count ? { count, total } : null;
    if ($("escape-hint")) $("escape-hint").textContent = count ? `MENU: ${count} / ${total}` : this.menuHint();
  }
  inputMode() {
    return this.menu || !this.app || this.app.navigation ? "menu" : "raw";
  }
  holdMs() {
    return this.state.settings.holdMs;
  }
  pressVisual(pressed) {
    for (const id of ["arcade", "menu-arcade"])
      $(id).classList.toggle("down", pressed);
    if (!pressed) {
      for (const id of ["hold-fill", "menu-hold-fill"])
        $(id).style.width = "0%";
      $("control-title").textContent = "SINGLE-SWITCH INTERFACE";
    }
  }
  holdVisual(ratio, ready) {
    for (const id of ["hold-fill", "menu-hold-fill"])
      $(id).style.width = ratio * 100 + "%";
    $("control-title").textContent =
      ready ? "RELEASE TO SELECT" : ratio >= 1 ? "RELEASE THE SWITCH" : "SINGLE-SWITCH INTERFACE";
  }
  rawDown(e) {
    try {
      this.app?.down?.(e);
    } catch (error) {
      this.fail(error);
    }
  }
  rawUp(e) {
    try {
      this.app?.up?.(e);
    } catch (error) {
      this.fail(error);
    }
  }
  rawCancel() {
    this.lifecycle("cancel");
    this.synth.stopTone();
  }
  // tick and resume run while the player is looking at the app, so a throw there opens the
  // recovery menu. cancel, pause and dispose run during teardown or while a menu is being
  // built, so they stay contained to a toast.
  lifecycle(name) {
    if (this.faulted && name === "tick") return; // the app already failed; do not repeat it each second
    try { this.app?.[name]?.(); }
    catch (error) {
      if (name === "tick" || name === "resume") this.fail(error);
      else { this.errors.push(`${name}: ${error.message}`); this.toast(`${name}: ${error.message}`); }
    }
  }
  softwareButton(pressed) {
    if (this.state.controller === false)
      return this.toast(
        "Monitor tab. Reload after closing the controlling tab.",
      );
    this.synth.unlock();
    if (this.state.simulated)
      this.bridge.command("button", { pressed }, true).catch(() => {});
    else
      this.event({
        type: "button",
        pressed,
        source: "keyboard",
        at_us: performance.now() * 1000,
      });
  }
  bind() {
    const bindButton = (element) => {
      element.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        element.setPointerCapture(e.pointerId);
        this.softwareButton(true);
      });
      element.addEventListener("pointerup", () => this.softwareButton(false));
      element.addEventListener("pointercancel", () => {
        this.softwareButton(false);
        this.input.cancel();
      });
      element.addEventListener("contextmenu", (e) => e.preventDefault());
    };
    bindButton($("arcade"));
    bindButton($("menu-arcade"));
    bindButton($("game"));
    document.addEventListener("keydown", (e) => {
      if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (!e.repeat) this.softwareButton(true);
      }
      if (e.code === "Escape") {
        e.preventDefault();
        this.menu ? this.closeMenu() : this.systemMenu();
      }
      if (
        ["ArrowRight", "ArrowDown"].includes(e.code) &&
        this.inputMode() === "menu"
      ) {
        e.preventDefault();
        this.advance();
      }
    });
    document.addEventListener("keyup", (e) => {
      if (
        e.code === "Space" &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)
      ) {
        e.preventDefault();
        this.softwareButton(false);
      }
    });
    window.addEventListener("blur", () => {
      if (this.input.press?.event.source !== "node") {
        this.softwareButton(false);
        this.input.cancel();
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this.softwareButton(false);
        this.input.cancel();
        if (this.app && !this.menu) this.systemMenu();
      }
    });
    $("arcade").addEventListener("click", (e) => {
      if (e.detail === 0) {
        this.softwareButton(true);
        setTimeout(() => this.softwareButton(false), 70);
      }
    });
    $("brand").addEventListener("click", (e) => {
      e.preventDefault();
      this.home();
    });
    $("mic-button").addEventListener("click", () => this.micMenu());
    $("pause-button").addEventListener("click", () => this.systemMenu());
    $("menu-overlay").addEventListener("keydown", (e) => {
      if (e.key !== "Tab") return;
      const buttons = [...$("menu-overlay").querySelectorAll("button")];
      if (!buttons.length) return;
      if (e.shiftKey && document.activeElement === buttons[0]) {
        e.preventDefault();
        buttons.at(-1).focus();
      } else if (!e.shiftKey && document.activeElement === buttons.at(-1)) {
        e.preventDefault();
        buttons[0].focus();
      }
    });
  }
  setNav(items, containerIndex = null) {
    const prior = this.menu ? this.menu.prior : this.nav;
    const previousId = prior.items[prior.index]?.id;
    const matchingIndex = previousId ? items.findIndex(item => item.id === previousId) : -1;
    const nav = {
      items,
      index: Math.min(
        containerIndex ?? (matchingIndex >= 0 ? matchingIndex : prior.index) ?? 0,
        Math.max(0, items.length - 1),
      ),
    };
    if (this.menu) this.menu.prior = nav;
    else this.nav = nav;
    items.forEach((item, index) => {
      item.element.onclick = () => {
        this.synth.unlock();
        nav.index = index;
        this.updateFocus(nav);
        this.activate(item);
      };
    });
    this.updateFocus(nav);
  }
  activate(item) {
    if (!item) return;
    this.input.cancel();
    try {
      const result = item.run();
      if (result?.catch) result.catch((error) => this.errorToast(error.message));
    } catch (error) {
      this.errorToast(error.message);
    }
  }
  updateFocus(nav = this.nav) {
    nav.items.forEach((item, index) => {
      item.element.classList.toggle("is-focused", index === nav.index);
      item.element.setAttribute(
        "aria-current",
        index === nav.index ? "true" : "false",
      );
    });
    if (!this.app && !this.menu)
      $("focus-counter").textContent =
        String(nav.index + 1).padStart(2, "0") +
        " — " +
        String(nav.items.length).padStart(2, "0");
  }
  advance() {
    this.hostLamps.touch(performance.now());
    if (!this.nav.items.length) return;
    this.nav.index = (this.nav.index + 1) % this.nav.items.length;
    this.updateFocus();
    this.nav.items[this.nav.index].element.scrollIntoView({
      block: "nearest",
      behavior: "instant",
    });
    this.synth.tone(210, 0.025, "triangle");
  }
  select() {
    this.hostLamps.touch(performance.now());
    this.hostLamps.note("select", performance.now());
    this.activate(this.nav.items[this.nav.index]);
  }
  get cartridges() {
    return APPS.length;
  }
  buildHome(index = 0) {
    const collection = APPS.slice(this.page * 6, this.page * 6 + 6);
    $("app-grid").innerHTML = collection
      .map(
        (app, i) =>
          `<button class="app-card" type="button" data-app="${app.id}"><span class="card-number">${String(i + 1).padStart(2, "0")}</span><span class="app-icon">${icon(app)}</span><span class="card-name">${app.name}</span><span class="card-desc">${app.subtitle}</span></button>`,
      )
      .join("");
    const pages = Math.ceil(APPS.length / 6),
      names = SECTORS;
    const name = names[this.page] || "EXPANSION";
    $("collection-title").textContent =
      name + " / " + collection.length + " CHANNELS";
    $("sector-label").textContent =
      "SECTOR " + String(this.page + 1).padStart(2, "0") + " / " + name;
    $("sector-button").textContent =
      "NEXT SECTOR → " + (names[(this.page + 1) % pages] || "EXPANSION");
    const nav = [...$("app-grid").querySelectorAll("button")].map(
      (element, i) => ({ element, run: () => this.launch(collection[i].id) }),
    );
    nav.push(
      {
        element: $("sector-button"),
        run: () => {
          this.page = (this.page + 1) % pages;
          this.buildHome();
        },
      },
      { element: $("system-button"), run: () => this.systemMenu() },
    );
    this.setNav(nav, index);
  }
  home() {
    // Come back to the card the player just left, on its own sector.
    const left = this.meta ? APPS.findIndex((a) => a.id === this.meta.id) : -1;
    this.closeMenu(false);
    this.unmount();
    if (left >= 0) this.page = Math.floor(left / 6);
    $("console").classList.remove("playing");
    $("dashboard").hidden = false;
    $("application").hidden = true;
    this.buildHome(left >= 0 ? left % 6 : 0);
    this.nav.items[this.nav.index]?.element.scrollIntoView({ block: "nearest", behavior: "instant" });
    this.hint("TAP TO ADVANCE · HOLD & RELEASE TO ENTER");
    this.bridge.command("focus", { app: "home" }, true);
    this.clickVisual(0);
    window.scrollTo(0, 0);
  }
  unmount() {
    this.faulted = false;
    this.input.cancel();
    this.lifecycle("dispose");
    this.synth.stopTone();
    this.token++;
    this.epoch++;
    this.app = null;
    this.meta = null;
    this.accumulator = 0;
    this.paused = false;
    this.lights.release().catch(() => {});
    this.hudValue = "";
    this.hudLabels = "";
  }
  launch(id) {
    const meta = APPS.find((a) => a.id === id);
    if (!meta) return;
    this.closeMenu(false);
    this.unmount();
    this.meta = meta;
    const token = this.token;
    const alive = () => this.token === token;
    let lastContent = null;
    const guarded = fn => (...args) => alive() ? fn(...args) : undefined;
    const command = (cmd, data) => {
      if (!alive()) return Promise.resolve({ ignored: true });
      if (["reaction", "pattern", "cancel"].includes(cmd)) return this.lights.effect(cmd, data);
      return this.bridge.command(cmd, data);
    };
    $("dashboard").hidden = true;
    $("application").hidden = false;
    $("app-category").textContent = meta.category;
    $("app-title").textContent = meta.name;
    $("app-description").textContent = meta.description;
    $("hud").innerHTML = "";
    this.hudLabels = "";
    $("utility-content").innerHTML = "";
    $("utility-actions").innerHTML = "";
    $("app-readout").textContent = "";
    this.hint(meta.controls);
    this.synth.unlock();
    const ctx = {
      rng: new Random(),
      synth: { startTone: guarded(hz => this.synth.startTone(hz)), stopTone: guarded(() => this.synth.stopTone()), chime: guarded(() => this.synth.chime()) },
      alive: () => this.token === token,
      state: () => this.state,
      settings: () => this.state.settings,
      simulated: () => this.state.simulated,
      command,
      get: (path) => this.bridge.get(path),
      best: (metric = "default") => this.state.scores[metric === "default" ? meta.id : meta.id + ":" + metric] || 0,
      score: (score, metric = "default") => {
        if (alive()) this.bridge.command("score", { app: meta.id, score, metric }, true);
      },
      progress: () => this.state.progress?.[meta.id] || {},
      saveProgress: (value) => {
        if (!alive()) return Promise.resolve({ ignored: true });
        this.state.progress[meta.id] = value;
        return this.bridge.command("progress", { app: meta.id, value }, true);
      },
      tone: guarded((...args) => this.synth.tone(...args)),
      leds: (values) => {
        if (alive()) this.lights.set(values);
      },
      pattern: steps => command("pattern", { steps }),
      hud: guarded(items => this.hud(items)),
      controls: guarded(message => this.hint(message)),
      hint: (message) => {
        if (this.token === token) $("app-readout").textContent = message;
      },
      content: (html) => {
        // Panels re-render on every sensor/level event; skip identical markup.
        if (this.token === token && html !== lastContent) {
          lastContent = html;
          $("utility-content").innerHTML = html;
        }
      },
      actions: (items) => {
        if (this.token !== token) return;
        const container = $("utility-actions");
        const unchanged =
          container.children.length === items.length &&
          [...container.children].every(
            (button, i) => button.textContent === items[i].label,
          );
        if (!unchanged)
          container.innerHTML = items
            .map(
              (item) =>
                `<button type="button" class="utility-button">${esc(item.label)}</button>`,
            )
            .join("");
        this.setNav(
          [...$("utility-actions").children].map((element, i) => ({
            element,
            id: items[i].id || items[i].label,
            run: guarded(items[i].run),
          })),
        );
      },
      home: guarded(() => this.home()),
      resume: guarded(() => this.closeMenu()),
      help: guarded(message => this.help(message)),
      toast: guarded(message => this.toast(message)),
      error: guarded(error => this.toast(error.message || String(error))),
      setMic: mode => alive() ? this.setMic(mode) : Promise.resolve(),
      stats: () => this.frameStats(),
      downloadText: guarded((name, text) => {
        const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
        const a = document.createElement("a"); a.href = url; a.download = name; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }),
      download: (url) => {
        if (!alive()) return;
        const link = document.createElement("a");
        link.href = url;
        link.download = "";
        link.click();
      },
    };
    try {
      this.app = meta.create(ctx);
    } catch (error) {
      this.fail(error);
      return;
    }
    $("game-stage").hidden = !!this.app.navigation;
    $("utility-stage").hidden = !this.app.navigation;
    $("hud").hidden = !!this.app.navigation;
    $("console").classList.toggle("playing", !this.app.navigation);
    window.scrollTo(0, 0);
    this.bridge.command("focus", { app: meta.id }, true);
    this.clickVisual(0);
  }
  hint(message) {
    $("control-hint").textContent = message;
  }
  hud(items) {
    const key = JSON.stringify(items);
    if (key === this.hudValue) return;
    this.hudValue = key;
    // Same labels as before: update the changed values in place instead of
    // rebuilding every readout (Moonrunner changes its distance ~12 times a second).
    const box = $("hud"), labels = items.map(([label]) => label).join("\n");
    if (labels === this.hudLabels && box.children.length === items.length) {
      items.forEach(([, value], i) => {
        const strong = box.children[i].lastElementChild, text = String(value);
        if (strong.textContent !== text) strong.textContent = text;
      });
      return;
    }
    this.hudLabels = labels;
    box.innerHTML = items
      .map(
        ([label, value]) =>
          `<div class="hud-item"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`,
      )
      .join("");
  }
  openMenu(title, description, choices) {
    if (!this.menu) {
      const press = this.input.press;
      this.input.cancel(this.input.blocked || !!press, this.input.blockSource || press?.event.source);
      this.rawCancel();
      this.lifecycle("pause");
      this.lights.release().catch(() => {});
      this.menu = { prior: this.nav, focus: document.activeElement };
      this.paused = true;
    }
    this.epoch++;
    $("menu-title").textContent = title;
    $("menu-description").textContent = description;
    $("menu-actions").innerHTML = choices
      .map(
        (item) =>
          `<button class="menu-choice" type="button">${esc(item.label)}</button>`,
      )
      .join("");
    $("menu-overlay").hidden = false;
    this.nav = {
      index: 0,
      items: [...$("menu-actions").children].map((element, i) => ({
        element,
        run: choices[i].run,
      })),
    };
    this.nav.items.forEach(
      (item, index) =>
        (item.element.onclick = () => {
          this.synth.unlock();
          this.nav.index = index;
          this.activate(item);
        }),
    );
    this.updateFocus();
    this.nav.items[0]?.element.focus({ preventScroll: true });
  }
  closeMenu(resume = true) {
    if (!this.menu || (this.faulted && resume)) return;
    const menu = this.menu;
    this.menu = null;
    this.nav = menu.prior;
    this.paused = false;
    this.epoch++;
    this.input.cancel();
    $("menu-overlay").hidden = true;
    this.updateFocus();
    if (resume) this.lifecycle("resume");
    this.clickVisual(0);
    if (!this.faulted && menu.focus?.isConnected) menu.focus.focus({ preventScroll: true });
  }
  systemMenu() {
    if (this.faulted) return this.faultMenu(); // RESUME is blocked while faulted, so never offer it
    this.hostLamps.note("menu", performance.now());
    const mic = this.state.mic.mode;
    this.openMenu("System channel", "Tap to move. Hold and release to choose. " + this.menuHint(), [
      {
        label: this.app ? "RESUME / " + this.meta.name : "RETURN TO DASHBOARD",
        run: () => this.closeMenu(),
      },
      ...(this.app ? [{ label: "RESTART / " + this.meta.name, run: () => this.launch(this.meta.id) }, ...(this.app.menuActions?.() || []),
        ...(this.state.progress?.[this.meta.id]?.runs ? [{ label: 'FIELD RECORD / ' + this.state.progress[this.meta.id].runs + ' ENTRIES', run: () => this.fieldRecord() }] : [])] : []),
      { label: "DASHBOARD", run: () => this.home() },
      { label: "MICROPHONE / " + mic.toUpperCase(), run: () => this.micMenu() },
      {
        label: this.meta ? "HOW TO PLAY / CONTROLS" : "HOW TO USE VESPER",
        run: () =>
          this.help(
            this.meta
              ? this.meta.description + " " + this.menuHint() + ". Rapid clicks can also affect gameplay before the menu opens."
              : "Tap to move between items. Hold and release to select. Games use quick menu clicks; Signal School and Echo Vault reserve a three-second hold. Space or the on-screen arcade button also works. The second dashboard sector contains the instruments.",
          ),
      },
      { label: "CALIBRATION / SETTINGS", run: () => this.launch("settings") },
    ]);
  }
  fieldRecord() {
    const saved = this.state.progress?.[this.meta?.id] || {}, last = saved.last || {};
    const labels = { locks: 'Locks', metres: 'Metres', relics: 'Relics', passages: 'Passages', sequences: 'Sequences', inscriptions: 'Inscriptions', milliseconds: 'Reaction / ms', metric: 'Timing source', scanMs: 'Scan / ms', reason: 'Last signal', error: 'Last signal', ...(this.meta?.record || {}) };
    const detail = Object.entries(labels).filter(([key]) => last[key] !== undefined).map(([key,label]) => `${label}: ${last[key]}`).join('. ');
    this.help(`${saved.runs || 0} field entries. Highest milestone: ${saved.milestone || 0}. Last entry — ${detail || 'No result yet.'}`);
  }
  micMenu() {
    this.openMenu(
      "Listening channel",
      this.state.mic.unavailable
        ? "Local speech is not installed in this edition. See the included setup guide."
        : "Commands use “computer”. Transcription saves text and does not execute commands.",
      [
        {
          label: "MICROPHONE OFF",
          run: () => this.setMic("off").then(() => this.closeMenu()),
        },
        {
          label: "VOICE COMMANDS",
          run: () => this.setMic("commands").then(() => this.closeMenu()),
        },
        {
          label: "TRANSCRIBE / FIELD NOTES",
          run: () =>
            this.setMic("transcribe").then(() => this.launch("transcribe")),
        },
        { label: "BACK", run: () => this.systemMenu() },
      ],
    );
  }
  help(message) {
    this.openMenu("Operator notes", message, [
      { label: "BACK", run: () => this.systemMenu() },
      { label: "RESUME", run: () => this.closeMenu() },
    ]);
  }
  async setMic(mode) {
    try {
      if (mode === "off") this.browserMic.stop();
      await this.bridge.command("mic", { mode });
      // Analysis needs no browser audio: the simulated service synthesises its own signal.
      if (mode !== "off" && mode !== "analyze" && this.state.simulated) {
        try {
          await this.browserMic.start();
        } catch (error) {
          await this.bridge.command("mic", { mode: "off" });
          throw new Error(
            "Browser microphone could not start: " + error.message,
          );
        }
      }
    } catch (error) {
      this.errorToast(error.message);
      throw error;
    }
  }
  // An error toast also gets a brief red double blink on the lamps the host owns.
  errorToast(message) {
    this.hostLamps.note("error", performance.now());
    this.toast(message);
  }
  toast(message) {
    $("toast").textContent = message;
    $("toast").hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => ($("toast").hidden = true), 6500);
  }
  fail(error) {
    if (this.faulted) return;
    this.faulted = true;
    console.error(error);
    this.errors.push(error.message);
    this.faultMessage = error.message;
    this.paused = true;
    this.synth.stopTone();
    this.faultMenu();
  }
  faultMenu() {
    let extra = [];
    try { extra = this.app?.menuActions?.() || []; } catch {}
    const runs = this.state.progress?.[this.meta?.id]?.runs;
    this.openMenu("Application stopped", this.faultMessage || "", [
      // One restart entry: named for the app when it mounted, generic when it never did.
      { label: this.app ? "RESTART / " + this.meta.name : "RESTART APP", run: () => this.launch(this.meta.id) },
      ...(this.app ? [...extra, ...(runs ? [{ label: 'FIELD RECORD / ' + runs + ' ENTRIES', run: () => this.fieldRecord() }] : [])] : []),
      { label: "DASHBOARD", run: () => this.home() },
    ]);
  }
  settings() {
    this.synth.enabled = this.state.settings.sound;
    this.synth.volume = this.state.settings.volume;
    if (!this.synth.enabled) this.synth.stopTone();
    $("console").classList.toggle("crt", this.state.settings.crt);
    this.lights.setScale(levelScale(this.state.settings.lampLevel));
  }
  lightVisual(values) {
    if (!Array.isArray(values) || values.length !== 9) return;
    for (let i = 0; i < 3; i++) {
      const rgb = values.slice(i * 3, i * 3 + 3),
        on = Math.max(...rgb) > 0,
        lamp = $("lamp-" + i);
      lamp.style.background = on ? `rgb(${rgb.join(",")})` : "";
      lamp.style.color = on ? "#0d180d" : "";
      lamp.style.boxShadow = on ? `0 0 13px rgba(${rgb.join(",")},.3)` : "";
      lamp.setAttribute(
        "aria-label",
        ["Left", "Middle", "Right"][i] + " light " + (on ? "on" : "off"),
      );
    }
  }
  event(e) {
    switch (e.type) {
      case "state":
        this.state = {
          ...e,
          settings: { ...DEFAULT, ...e.settings },
          progress: e.progress || {},
        };
        this.loaded = true;
        this.settings();
        this.lightVisual(e.leds);
        this.status();
        this.input.cancel(!!e.device.button, e.simulated ? "simulator" : "node");
        this.lights.invalidate();
        break;
      case "offline":
        this.state.device.connected = false;
        this.lights.invalidate();
        this.browserMic.stop();
        this.input.cancel();
        this.status();
        if (this.app && !this.menu) this.systemMenu();
        this.toast("Console service disconnected. Reconnecting…");
        break;
      case "device":
        Object.assign(this.state.device, e);
        this.lights.invalidate();
        this.status();
        if (!e.connected) {
          this.input.cancel(true, this.state.simulated ? "simulator" : "node");
          this.browserMic.stop();
          if (this.app && !this.menu) this.systemMenu();
        }
        break;
      case "node_reset":
        this.lights.invalidate();
        this.input.cancel(true, this.state.simulated ? "simulator" : "node");
        if (this.app && !this.menu) this.systemMenu();
        break;
      case "button":
        this.hostLamps.touch(performance.now());
        this.state.device.button = e.pressed;
        if (e.pressed) {
          this.synth.unlock();
          this.input.down(e);
        } else this.input.up(e);
        break;
      case "sensor":
        this.state.sensor = e;
        this.status();
        break;
      case "leds":
        this.state.leds = e.values;
        this.lights.observe(e.values);
        this.lightVisual(e.values);
        break;
      case "node_status":
        this.input.reconcile(e.button, this.state.simulated ? "simulator" : "node");
        this.state.device.button = e.button;
        this.state.device.generation = e.generation;
        this.lights.observe(e.leds);
        this.state.device.capture = e.mic;
        this.state.device.audioBytes =
          e.audioBytes ?? this.state.device.audioBytes;
        this.state.device.crcErrors =
          e.crcErrors ?? this.state.device.crcErrors;
        this.state.device.missingSamples =
          e.missingSamples ?? this.state.device.missingSamples;
        if (e.leds) this.lightVisual(e.leds);
        break;
      case "mic":
        this.state.mic = {
          ...this.state.mic,
          mode: e.mode,
          session: e.session,
          error: e.error || null,
        };
        this.state.device.capture = e.capture;
        if (e.mode === "off") this.browserMic.stop();
        this.status();
        break;
      case "light_effect":
        this.lights.suspend(e.durationMs);
        this.hostLamps.quiet(performance.now(), e.durationMs);
        break;
      case "speech_error":
        this.state.mic.error = e.error;
        this.status();
        this.errorToast(e.error);
        break;
      case "level":
        this.state.mic.level = e.value;
        this.state.mic.droppedChunks = e.droppedChunks ?? this.state.mic.droppedChunks;
        $("level-fill").style.width = Math.min(100, e.value * 450) + "%";
        break;
      case "scores":
        this.state.scores = e.scores;
        break;
      case "settings":
        this.state.settings = { ...DEFAULT, ...e.settings };
        this.settings();
        this.status();
        this.input.resetSequence();
        this.clickVisual(0);
        break;
      case "timers":
        this.state.timers = e.timers;
        this.status();
        break;
      case "timer_done":
        this.toast(e.timer.label + " complete.");
        this.synth.chime();
        break;
      case "error":
        this.errorToast(e.error);
        break;
      case "voice":
        this.hostLamps.note("voice", performance.now());
        this.toast("HEARD / " + e.heard);
        if (e.action === "launch") this.launch(e.app);
        else if (e.action === "home") this.home();
        else if (e.action === "pause") this.systemMenu();
        else if (e.action === "resume") this.closeMenu();
        break;
    }
    try {
      this.app?.event?.(e);
    } catch (error) {
      this.fail(error);
    }
  }
  status() {
    const s = this.state,
      connected = s.device.connected;
    $("link-dot").classList.toggle("live", connected);
    setText("link-text", connected
      ? s.simulated
        ? "SIMULATED NODE"
        : "NODE LINK ACTIVE"
      : "NODE DISCONNECTED");
    setText("mode-tag",
      s.controller === false
        ? "MONITOR"
        : s.simulated
          ? "SIMULATOR"
          : "HARDWARE");
    const unit = (s.settings || DEFAULT).tempUnit;
    setText("temp-mini", s.sensor
      ? formatTemp(s.sensor.temperature, unit)
      : "— " + tempUnit(unit));
    setText("rh-mini", s.sensor
      ? s.sensor.humidity.toFixed(0) + " % RH"
      : "— % RH");
    const stale = !connected || !s.sensor?.at || Date.now() / 1000 - s.sensor.at > 15;
    $("temp-mini").classList.toggle("stale", stale);
    $("rh-mini").classList.toggle("stale", stale);
    const tempTitle = stale ? "Last reading / stale or unavailable" : "Live reading";
    if ($("temp-mini").title !== tempTitle) $("temp-mini").title = tempTitle;
    const micStatus = microphoneStatus(s), active = micStatus.active;
    $("mic-button").classList.toggle("active", active);
    setText("mic-text", micStatus.label);
    setText("mic-dot", active ? "●" : "○");
    if (!active && $("level-fill").style.width !== "0%") $("level-fill").style.width = "0%";
    // The service counts on its own clock (same machine), so a running timer's remaining time
    // is derived from its deadline and keeps moving even when the link is down.
    const now = Date.now() / 1000;
    for (const t of s.timers) if (t.running && Number.isFinite(t.deadline)) t.remaining = Math.max(0, t.deadline - now);
    const running = s.timers.filter((t) => t.running);
    setText("timer-badge", running.length
      ? `${running.length} TIMER${running.length > 1 ? "S" : ""} / ${formatTime(Math.min(...running.map((t) => t.remaining)))}${connected ? "" : " / STALE"}`
      : "NO ACTIVE TIMERS");
    $("timer-badge").classList.toggle("stale", !connected && running.length > 0);
    $("timer-badge").title = connected ? "" : "Service link is down; time is estimated locally";
  }
  // While no app has taken the lamps, the host layer decides what they show.
  driveHostLamps(now) {
    if (this.lights.owner !== "host") return;
    const s = this.state, press = this.input.press;
    const scene = this.menu ? "menu" : !this.app ? "dashboard" : this.app.navigation ? "instrument" : "game";
    let hold = null;
    if (press && !press.consumed) {
      const elapsedMs = this.input.clock() - press.at;
      if (press.mode === "menu") hold = { kind: "select", elapsedMs, holdMs: this.holdMs() };
      else if (!this.escapePolicy().clicks) hold = { kind: "escape", elapsedMs };
    }
    // A timer's countdown belongs where the service plays the completion effect.
    let remaining = null;
    if (s.device.connected && (!this.meta || ["timers", "environment"].includes(this.meta.id))) {
      const left = s.timers.filter((t) => t.running && Number.isFinite(t.deadline)).map((t) => t.deadline - Date.now() / 1000);
      if (left.length) remaining = Math.min(...left);
    }
    this.lights.setHost(this.hostLamps.frame(now, {
      scene, level: s.settings.lampLevel, ambient: s.settings.lampAmbient, reducedMotion: s.settings.reducedMotion,
      focus: scene !== "game" && this.nav.items.length ? { index: this.nav.index, count: this.nav.items.length } : null,
      press: hold, clicks: this.clickState, timerRemaining: remaining,
      // Confirmed capture from the node, not the requested mode.
      mic: !!s.device.connected && !!s.device.capture,
    }));
  }
  frameStats() {
    const ordered = this.frameTimes.slice().sort((a,b) => a-b);
    return { samples: ordered.length, medianMs: ordered[Math.floor(ordered.length * .5)] || 0,
      p95Ms: ordered[Math.floor(ordered.length * .95)] || 0, errors: this.errors.length };
  }
  frame(now) {
    const dt = Math.min(0.1, Math.max(0, (now - (this.last || now)) / 1000));
    if (this.last && !document.hidden) {
      this.frameTimes.push(now - this.last);
      if (this.frameTimes.length > 600) this.frameTimes.shift();
    }
    this.last = now;
    this.input.update();
    this.driveHostLamps(now);
    this.lights.flush(this.state.device.connected && this.state.controller !== false);
    if (!document.hidden) {
      if (!this.app) {
        // The orrery's only motion is a dot drifting about 4 px/s, so a redraw
        // every 100 ms looks identical and lets the browser idle in between
        // (once per second when motion is reduced, since the picture is static).
        const reduced = this.state.settings.reducedMotion;
        const step = Math.floor(reduced ? now / 1000 : now / 100);
        if (step !== this.ambientStep) {
          this.ambientStep = step;
          ambient(this.ag, reduced ? 0 : now / 1000, 450, 300);
        }
      } else if (!this.app.navigation && !this.faulted) {
        if (!this.paused) {
          this.accumulator += dt;
          let steps = 0;
          try {
            while (this.accumulator >= 1 / 60 && steps++ < 6) {
              this.app.update?.(1 / 60);
              this.accumulator -= 1 / 60;
            }
          } catch (error) {
            this.fail(error);
          }
        }
        try {
          this.g.setTransform(1, 0, 0, 1, 0, 0);
          this.g.globalAlpha = 1;
          this.app.draw?.(this.g);
        } catch (error) {
          this.fail(error);
        }
      }
    }
    requestAnimationFrame((t) => this.frame(t));
  }
}

const bridge = window.VESPER_STANDALONE ? new DemoBridge() : new Bridge();
const consoleApp = new Vesper(bridge);
// Read-only debugging surface for browser integration tests and local developers.
window.vesper = consoleApp;
