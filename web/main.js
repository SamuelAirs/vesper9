import { Bridge } from "./engine/bridge.js";
import { DemoBridge } from "./engine/demo.js";
import { InputRouter, GESTURE_TAPS } from "./engine/input.js";
import { Synth, BrowserMicrophone } from "./engine/audio.js";
import { Random, escapeHTML as esc, formatTime, formatSensorTemp, tempUnit } from "./engine/math.js";
import { ambient, glyph, C, text, space } from "./engine/draw.js";
import { APPS } from "./apps/registry.js";
import { DEFAULT_SETTINGS as DEFAULT, SECTORS, SYSTEM_APPS } from "./apps/catalog.js";
import { LightDirector } from "./engine/lights.js";
import { HostLamps, levelScale } from "./engine/ambient.js";
import { microphoneStatus } from "./engine/status.js";
import { planVoice } from "./engine/voice.js";
import { LOGICAL_W, LOGICAL_H, renderFactor } from "./engine/render.js";
import * as Log from "./engine/logbook.js";

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

// The dashboard's pages, from the catalog's explicit sectors: each is a named list of app ids in order.
// An app in no sector is not on the dashboard (it stays launchable by id, by voice and from the menu).
const PAGES = SECTORS.map((sector) => ({ name: sector.name, tagline: sector.tagline || "", apps: sector.apps.map((id) => APPS.find((a) => a.id === id)).filter(Boolean) }))
  .filter((page) => page.apps.length);
function locateCard(id) {
  for (let page = 0; page < PAGES.length; page++) {
    const index = PAGES[page].apps.findIndex((a) => a.id === id);
    if (index >= 0) return { page, index };
  }
  return null;
}

// The card's small kind label: the part of the category after the slash ("PLAY / MOMENTUM" → MOMENTUM).
const kind = (app) => (app.category.split("/").pop() || "").trim();
const isGame = (app) => app.category.startsWith("PLAY");
function standing(best, runs) {
  const parts = [];
  if (best > 0) parts.push("BEST " + Math.round(best).toLocaleString("en-US"));
  if (runs > 0) parts.push(runs + (runs === 1 ? " RUN" : " RUNS"));
  return parts.length ? parts.join(" · ") : "UNCHARTED";
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
    this.renderScale = 1;
    this.renderSteps = new Map();
    this.renderWindow = null;
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
  // The one menu gesture, everywhere: tap, tap, hold (engine/input.js). Only its pace is a setting.
  escapePolicy() {
    return { pace: this.state.settings.gesturePace || "standard" };
  }
  menuHint() {
    return "MENU: TAP · TAP · HOLD";
  }
  // The control deck's click indicator: a dot per tap so far, then the hold.
  clickVisual(count) {
    this.clickState = count ? { count } : null;
    const dots = "●".repeat(count) + "○".repeat(Math.max(0, GESTURE_TAPS - count));
    if ($("escape-hint")) $("escape-hint").textContent = count ? `MENU: ${dots} ${count < GESTURE_TAPS ? "TAP AGAIN" : "NOW HOLD"}` : this.menuHint();
  }
  // Where the highlight stands, so a menu gesture that moved it with its two taps can put it back.
  focusMark() {
    if (this.menu) return null;
    const item = this.nav.items[this.nav.index];
    return { index: this.nav.index, id: item?.id };
  }
  restoreFocus(mark) {
    const nav = this.nav;
    if (!mark || !nav.items.length) return;
    // The app may have re-rendered its list since: find the same action by id, else the same row.
    const byId = mark.id !== undefined ? nav.items.findIndex((item) => item.id === mark.id) : -1;
    nav.index = Math.min(byId >= 0 ? byId : mark.index, nav.items.length - 1);
    this.updateFocus(nav);
  }
  // The single way into the system menu from wherever the player is. The gesture (tap, tap, hold), the
  // Escape key, the on-screen PAUSE button, the voice command, an interruption and any later trigger (a
  // knock on the case) all call this, so they all get the same guarantees: held input is cancelled and its
  // release swallowed, the app is told to cancel() and then pause(), the lamps go back to the host, and the
  // highlight a gesture's taps moved is put back. `source` says who asked; `focus` is a focusMark().
  requestMenu(source = "api", { focus = null } = {}) {
    if (focus && !this.menu) this.restoreFocus(focus);
    this.systemMenu();
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
  // ratio: progress of the press towards its goal; ready: a release would choose now (menus);
  // armed: the press is the third of tap, tap, hold and the bar is counting towards the menu.
  holdVisual(ratio, ready, armed = false) {
    for (const id of ["hold-fill", "menu-hold-fill"])
      $(id).style.width = ratio * 100 + "%";
    $("control-title").textContent =
      armed ? (ready ? "RELEASE TO SELECT / KEEP HOLDING FOR MENU" : "MENU GESTURE / KEEP HOLDING")
        : ready ? "RELEASE TO SELECT" : "SINGLE-SWITCH INTERFACE";
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
  rawKnock(e) {
    try {
      this.app?.knock?.(e);
    } catch (error) {
      this.fail(error);
    }
  }
  // Two knocks on the case outside a game (engine/input.js knock()): close the system menu, step an
  // instrument back to its own previous page (its back() returns true), or leave it for the dashboard;
  // on the dashboard, go to the previous sector.
  back(source = "api") {
    if (this.menu) { this.closeMenu(); return; }
    if (this.app) {
      let handled = false;
      try { handled = !!this.app.back?.(); } catch (error) { this.fail(error); return; }
      if (!handled) this.home();
      return;
    }
    if (PAGES.length > 1) {
      this.page = (this.page + PAGES.length - 1) % PAGES.length;
      this.buildHome();
    }
  }
  // The first of two knocks: say what a second one would do.
  knockVisual(waiting) {
    if (!$("escape-hint")) return;
    if (waiting) $("escape-hint").textContent = "KNOCK AGAIN: BACK";
    else if (!this.clickState) $("escape-hint").textContent = this.menuHint();
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
  // K on the keyboard: a knock on the case, for the simulator and for trying a game without the node.
  softwareKnock() {
    if (this.state.controller === false) return;
    if (this.state.simulated) this.bridge.command("knock", {}, true).catch(() => {});
    else this.event({ type: "knock", at_us: performance.now() * 1000, peak: 20000, source: "keyboard" });
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
      if (e.code === "KeyK" && !e.repeat) {
        e.preventDefault();
        this.softwareKnock();
      }
      if (e.code === "Escape") {
        e.preventDefault();
        this.menu ? this.closeMenu() : this.requestMenu("key");
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
    window.addEventListener("resize", () => this.fitCanvas());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this.softwareButton(false);
        this.input.cancel();
        if (this.app && !this.menu) this.requestMenu("interrupt");
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
    $("pause-button").addEventListener("click", () => this.requestMenu("button"));
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
    this.tick();
  }
  // The short tone that confirms a step. An app whose taps are musical (a tap tempo, a stopwatch)
  // silences it with ctx.silentTicks(true); launching or leaving an app resets that.
  tick() {
    if (!this.silentTicks) this.synth.tone(210, 0.025, "triangle");
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
    const collection = PAGES[this.page]?.apps || [];
    $("app-grid").innerHTML = collection
      .map(
        (app, i) =>
          `<button class="app-card" type="button" data-app="${app.id}"><span class="card-number">${String(i + 1).padStart(2, "0")} · ${esc(kind(app))}</span><span class="app-icon">${icon(app)}</span><span class="card-name">${app.name}</span><span class="card-desc">${app.subtitle}</span><span class="card-stat"></span></button>`,
      )
      .join("") + '<div class="app-slot" aria-hidden="true">◇ OPEN BAY</div>'.repeat((3 - (collection.length % 3)) % 3);
    const pages = PAGES.length;
    const sector = PAGES[this.page] || { name: "EXPANSION" };
    const next = PAGES[(this.page + 1) % pages];
    $("collection-title").textContent = collection.length + (collection.length === 1 ? " CHANNEL" : " CHANNELS");
    $("sector-label").textContent =
      "SECTOR " + String(this.page + 1).padStart(2, "0") + " / " + sector.name;
    $("sector-title").textContent = sector.name.charAt(0) + sector.name.slice(1).toLowerCase();
    $("sector-tagline").textContent = sector.tagline || "";
    // Every sector at a glance: this one lit, the one NEXT SECTOR goes to marked. The tabs are a
    // pointer shortcut only; the button reaches every sector through NEXT SECTOR.
    $("sector-strip").innerHTML = PAGES.map((p, i) =>
      `<button type="button" tabindex="-1" class="sector-tab${i === this.page ? " is-current" : ""}${pages > 1 && i === (this.page + 1) % pages ? " is-next" : ""}" data-page="${i}">${esc(p.name)}</button>`).join("");
    $("sector-strip").querySelectorAll("button").forEach((tab) => {
      tab.onclick = () => { this.page = Number(tab.dataset.page); this.buildHome(); };
    });
    $("sector-button").textContent = "NEXT SECTOR → " + (next?.name || "EXPANSION");
    this.cardStats();
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
  // Each game card carries its standing: the best score and the runs logged, or UNCHARTED.
  // Instruments keep their subtitle alone. Rewritten in place when scores or progress arrive.
  cardStats() {
    for (const card of $("app-grid").querySelectorAll(".app-card")) {
      const app = APPS.find((a) => a.id === card.dataset.app);
      const stat = card.querySelector(".card-stat");
      if (!app || !stat) continue;
      const value = isGame(app) ? standing(this.state.scores?.[app.id], this.state.progress?.[app.id]?.runs) : "";
      if (stat.textContent !== value) stat.textContent = value;
      card.classList.toggle("is-uncharted", value === "UNCHARTED");
    }
  }
  home() {
    // Come back to the card the player just left, on its own sector. An app that is not on the
    // dashboard (a system tool opened from the menu) returns to where the dashboard stood before.
    const found = this.meta ? locateCard(this.meta.id) : null;
    const left = found || this.returnTo || { page: this.page, index: 0 };
    this.closeMenu(false);
    this.unmount();
    this.page = Math.min(left.page, PAGES.length - 1);
    this.stage();
    $("dashboard").hidden = false;
    $("application").hidden = true;
    this.buildHome(left.index);
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
    this.silentTicks = false;
  }
  launch(id) {
    const meta = APPS.find((a) => a.id === id);
    if (!meta) return;
    this.closeMenu(false);
    if (!this.app) this.returnTo = { page: this.page, index: this.nav.index };
    this.unmount();
    // The new app starts with nothing highlighted from the last screen: its first action is row 0.
    this.nav = { items: [], index: 0 };
    this.meta = meta;
    if (!SYSTEM_APPS.includes(meta.id)) this.lastApp = meta.id;
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
      rng: Random.warm(),
      // True while the app's taps are musical: the host's own step tick would sound with them.
      silentTicks: guarded((on = true) => { this.silentTicks = !!on; }),
      // Whether knock-on-the-case input is switched on (Calibration). An app that uses knock() can say so.
      knockInput: () => (this.state.settings.knock || "medium") !== "off",
      // The menu gesture as the router sees it right now (a third press being counted), for apps
      // that show or sound something on a long press (the Morse sidetone).
      menuGesture: () => (alive() ? this.input.gestureState() : { armed: false, elapsedMs: 0, thresholdMs: 0, progress: 0 }),
      synth: { startTone: guarded(hz => this.synth.startTone(hz)), stopTone: guarded(() => this.synth.stopTone()), chime: guarded(() => this.synth.chime()) },
      alive: () => this.token === token,
      state: () => this.state,
      settings: () => this.state.settings,
      simulated: () => this.state.simulated,
      command,
      get: (path) => this.bridge.get(path),
      best: (metric = "default") => this.state.scores[metric === "default" ? meta.id : meta.id + ":" + metric] || 0,
      score: (score, metric = "default") => {
        if (!alive()) return;
        this.bridge.command("score", { app: meta.id, score, metric }, true);
        const book = this.logbook();
        if (Log.noteScore(book, meta.id, score, metric)) this.orderMet(meta);
      },
      // The console logbook (engine/logbook.js). today(): this game's order for today, or null when
      // it is not one of today's three. daily(text): state the game's own order (a daily run).
      // dailyMet(): the game's own order is met. feat(id, name): a feat, kept once.
      today: () => {
        const p = Log.pickOf(this.logbook(), meta.id);
        return p ? { goal: p.goal, done: !!p.done, own: !!p.own } : null;
      },
      daily: (text) => {
        if (alive() && Log.ownOrder(this.logbook(), meta.id, text)) this.saveBook();
      },
      dailyMet: () => {
        if (alive() && Log.meetOrder(this.logbook(), meta.id)) this.orderMet(meta);
      },
      feat: (id, name) => {
        if (!alive()) return false;
        const book = this.logbook();
        if (!Log.addFeat(book, meta.id, id, name, book.day)) return false;
        this.saveBook();
        this.toast("FEAT · " + String(name || id).toUpperCase() + " · " + meta.name);
        return true;
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
      // An instrument that switches between its panel and the canvas (navigation true or false) says so.
      restage: guarded(() => { this.input.cancel(this.input.blocked || !!this.input.press, this.input.blockSource || this.input.press?.event.source); this.accumulator = 0; this.stage(); }),
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
      // `focus` names the action (by id, or label when it has none) to highlight after this render.
      actions: (items, { focus } = {}) => {
        if (this.token !== token) return;
        const container = $("utility-actions");
        // A long list (Calibration, Node Scope) goes to three columns so it fits above the fold.
        container.classList.toggle("dense", items.length > 10);
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
        const entries = [...$("utility-actions").children].map((element, i) => ({
          element,
          id: items[i].id || items[i].label,
          run: guarded(items[i].run),
        }));
        const at = focus === undefined ? -1 : entries.findIndex((item) => item.id === focus);
        this.setNav(entries, at >= 0 ? at : null);
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
    this.stage();
    window.scrollTo(0, 0);
    this.bridge.command("focus", { app: meta.id }, true);
    this.clickVisual(0);
  }
  // Which stage the app shows: the canvas (a game, or an instrument in a raw-input moment such as
  // Calibration's tap-along) or its panel. Play mode folds the console's chrome away (style.css).
  stage() {
    const nav = !!this.app?.navigation, playing = !!this.app && !nav;
    $("game-stage").hidden = nav;
    $("utility-stage").hidden = !nav;
    $("hud").hidden = nav;
    $("console").classList.toggle("playing", playing);
    document.body.classList.toggle("playing", playing);
    this.fitCanvas();
  }
  // The game canvas holds the pixels it is shown at (times the device pixel ratio, at most twice the
  // logical 960 × 540) and no more: anything beyond that is painted and then thrown away when the
  // browser scales the picture down. Apps keep drawing in 960 × 540; frame() applies the scale.
  // RENDER QUALITY in Calibration: SHARP draws every shown pixel, FAST draws 70% of them and lets the
  // browser scale up, AUTO starts sharp and steps down while a game keeps missing frames (adaptRender).
  fitCanvas() {
    const canvas = $("game");
    if (!this.app || this.app.navigation) return;
    const box = canvas.getBoundingClientRect();
    if (!(box.width > 0 && box.height > 0)) return;
    const shown = Math.min(box.width / LOGICAL_W, box.height / LOGICAL_H) * (window.devicePixelRatio || 1);
    const scale = Math.max(0.35, Math.min(2, shown * renderFactor(this.state.settings.renderQuality, this.autoRender())));
    const w = Math.round(LOGICAL_W * scale), h = Math.round(LOGICAL_H * scale);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    this.renderScale = w / LOGICAL_W;
  }
  // AUTO's current step for this app (remembered for the session, so a heavy game starts where it settled).
  autoRender() {
    return this.state.settings.renderQuality === "auto" || !this.state.settings.renderQuality ? this.renderSteps.get(this.meta?.id) ?? 1 : 1;
  }
  // AUTO: after the first second of a game, judge each 2-second window. When more than a quarter of
  // its frames missed (over 20 ms), draw 15% fewer pixels, down to 55% of the shown size. It never
  // steps back up during a session: a picture that sharpens and blurs by turns is worse than either.
  adaptRender(frameMs) {
    const quality = this.state.settings.renderQuality || "auto";
    if (quality !== "auto" || !this.app || this.app.navigation || this.paused) { this.renderWindow = null; return; }
    const w = (this.renderWindow ||= { skip: 60, n: 0, slow: 0 });
    if (w.skip > 0) { w.skip--; return; }
    w.n++;
    if (frameMs > 20) w.slow++;
    if (w.n < 120) return;
    const step = this.autoRender();
    if (w.slow / w.n > 0.25 && step > 0.56) {
      this.renderSteps.set(this.meta.id, Math.max(0.55, step * 0.85));
      this.fitCanvas();
      w.skip = 30;
    }
    w.n = w.slow = 0;
  }
  // The console logbook, started for today (a new date picks a new three).
  logbook() {
    this.book ||= Log.cleanLogbook(this.state.progress?.console);
    const games = PAGES.flatMap((p) => p.apps).filter(isGame).map((a) => a.id);
    if (Log.ensureDay(this.book, Log.dateKey(), games, (id) => this.state.scores?.[id] || 0)) {
      this.saveBook();
      this.todayLine();
    }
    return this.book;
  }
  saveBook() {
    if (!this.loaded || this.state.controller === false) return;
    this.state.progress.console = this.book;
    this.bridge.command("progress", { app: "console", value: this.book }, true)?.catch?.(() => {});
  }
  orderMet(meta) {
    this.saveBook();
    this.todayLine();
    const book = this.book, n = Log.doneCount(book);
    this.toast("TODAY'S ORDER MET · " + meta.name + (n === Log.PICKS ? " · ALL THREE" : " · " + n + " OF " + Log.PICKS));
  }
  // The dashboard's one line for today: the three games and which are done, and the streak.
  todayLine() {
    const el = $("today-line");
    if (!el || !this.book) return;
    const book = this.book, name = (id) => APPS.find((a) => a.id === id)?.name || id;
    const days = Log.streak(book, book.day);
    const value = book.picks.length ? "TODAY · " + book.picks.map((p) => (p.done ? "◆ " : "◇ ") + name(p.a)).join("  ") +
      (days ? "  · STREAK " + days : "") : "";
    if (el.textContent !== value) el.textContent = value;
  }
  // The logbook in the system menu: today's three (each one launches), the streak, the feats.
  logbookMenu() {
    const book = this.logbook(), name = (id) => APPS.find((a) => a.id === id)?.name || id;
    const days = Log.streak(book, book.day), done = Log.doneCount(book);
    const recent = book.feats.slice(-6).reverse().map((f) => f.n + " (" + name(f.a) + ")").join(", ");
    this.openMenu("Logbook", `Today's three: ${done} of ${Log.PICKS} met. ${days ? "Streak: " + days + (days === 1 ? " day." : " days.") : "Meet one order to start a streak."} Feats: ${book.feats.length}${recent ? ". Latest: " + recent + "." : "."}`, [
      ...book.picks.map((p) => ({ label: (p.done ? "◆ " : "◇ ") + name(p.a) + " / " + p.goal.toUpperCase(), run: () => this.launch(p.a) })),
      { label: "BACK", run: () => this.systemMenu() },
    ]);
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
    this.openMenu("System channel", "Tap to move. Hold and release to choose. Open it: tap, tap, hold.", [
      {
        label: this.app ? "RESUME / " + this.meta.name : "CLOSE MENU",
        run: () => this.closeMenu(),
      },
      // The last app played, one choice away from the dashboard.
      ...(!this.app && this.lastApp && APPS.some((a) => a.id === this.lastApp) ? [{ label: "CONTINUE / " + APPS.find((a) => a.id === this.lastApp).name, run: () => this.launch(this.lastApp) }] : []),
      ...(this.app ? [{ label: "RESTART / " + this.meta.name, run: () => this.launch(this.meta.id) }, ...(this.app.menuActions?.() || []),
        ...(this.state.progress?.[this.meta.id]?.runs ? [{ label: 'FIELD RECORD / ' + this.state.progress[this.meta.id].runs + ' ENTRIES', run: () => this.fieldRecord() }] : [])] : []),
      ...(this.app ? [{ label: "DASHBOARD", run: () => this.home() }] : []),
      { label: "LOGBOOK / TODAY " + Log.doneCount(this.logbook()) + " OF " + Log.PICKS, run: () => this.logbookMenu() },
      { label: "MICROPHONE / " + mic.toUpperCase(), run: () => this.micMenu() },
      {
        label: this.meta ? "HOW TO PLAY / CONTROLS" : "HOW TO USE VESPER",
        run: () =>
          this.help(
            this.meta
              ? this.meta.description + " To open the menu from anywhere: tap, tap, then press and hold for about a second. The two taps and the hold reach the app first; when the menu opens, the app puts back anything they changed."
              : "Tap to move between items. Hold and release to select. To open the system menu from anywhere, in any app: tap, tap, then press and hold for about a second. Space or the on-screen arcade button also works. The dashboard's sectors are " + PAGES.map((p) => p.name.charAt(0) + p.name.slice(1).toLowerCase()).join(", ") + ": the games come first, then the instruments. Calibration, Node Scope and Telemetry are under SYSTEM TOOLS in the system menu.",
          ),
      },
      { label: "CALIBRATION / SETTINGS", run: () => this.launch("settings") },
      ...(SYSTEM_APPS.length ? [{ label: "SYSTEM TOOLS", run: () => this.systemTools() }] : []),
    ]);
  }
  // The apps that are not on the dashboard: calibration and the two diagnostic tools.
  systemTools() {
    const apps = SYSTEM_APPS.map((id) => APPS.find((a) => a.id === id)).filter(Boolean);
    this.openMenu("System tools", apps.map((a) => a.name + ": " + a.subtitle).join(" "), [
      ...apps.map((app) => ({ label: app.name, run: () => this.launch(app.id) })),
      { label: "BACK", run: () => this.systemMenu() },
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
  // A recognised voice command. The service has already created a timer or muted the microphone; everything
  // else is done here with the host's own functions (advance, select, the sector button, launch, home,
  // the timer and settings commands), never by simulating the button. engine/voice.js decides what a command
  // means in the current context; one that makes no sense here says so instead of doing something else.
  voice(e) {
    this.hostLamps.note("voice", performance.now());
    const plan = planVoice(e, {
      scene: this.menu ? "menu" : !this.app ? "dashboard" : this.app.navigation ? "instrument" : "game",
      items: this.nav.items.length, controller: this.state.controller, faulted: !!this.faulted,
      timers: this.state.timers, settings: this.state.settings, sensor: this.state.sensor,
      connected: !!this.state.device?.connected, mic: this.state.mic, now: Date.now(),
      lampsFree: this.lights.owner === "host",
    });
    const label = () => {
      const element = this.nav.items[this.nav.index]?.element;
      return (element?.querySelector?.(".card-name") || element)?.textContent?.replace(/\s+/g, " ").trim().toUpperCase() || "";
    };
    let say = plan.say;
    const failed = (error) => this.errorToast(error.message || String(error));
    switch (plan.run) {
      case "next": this.advance(); break;
      case "previous": this.stepBack(); break;
      case "select": say = "SELECT / " + label(); this.select(); break;
      case "sector": this.nav.items.find((item) => item.element === $("sector-button"))?.run(); break;
      case "home": this.home(); break;
      case "menu": this.requestMenu("voice"); break;
      case "resume": this.closeMenu(); break;
      case "launch": this.launch(plan.app); break;
      case "timer": this.bridge.command("timer", { op: plan.op, id: plan.id }).catch(failed); break;
      case "setting": this.bridge.command("settings", { key: plan.key, value: plan.value }).catch(failed); break;
      case "dictation": this.setMic("transcribe").then(() => this.launch("transcribe")).catch(() => {}); break;
      case "commands": this.setMic("commands").catch(() => {}); break;
      case "answer": this.answerLamps(plan); break;
    }
    if (plan.report === "focus") say = label();
    else if (plan.report === "sector") say = $("sector-label").textContent;
    this.toast("HEARD / " + e.heard + (say ? " → " + say : ""));
  }
  stepBack() {
    this.hostLamps.touch(performance.now());
    if (!this.nav.items.length) return;
    this.nav.index = (this.nav.index + this.nav.items.length - 1) % this.nav.items.length;
    this.updateFocus();
    this.nav.items[this.nav.index].element.scrollIntoView({ block: "nearest", behavior: "instant" });
    this.tick();
  }
  // A short lamp answer, only while the host owns the lamps; they are handed back when it ends.
  answerLamps(plan) {
    if (!plan.lamps) return;
    const mount = this.token;
    this.lights.effect("pattern", { steps: [{ ms: plan.lampMs, values: plan.lamps }], repeat: 1 }).catch(() => {});
    setTimeout(() => {
      if (this.token === mount && this.lights.owner === "app" && this.lights.raw === null) this.lights.release().catch(() => {});
    }, plan.lampMs + 300);
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
    this.fitCanvas();
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
        this.book = Log.cleanLogbook(this.state.progress.console);
        this.logbook();
        this.cardStats();
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
        if (this.app && !this.menu) this.requestMenu("interrupt");
        this.toast("Console service disconnected. Reconnecting…");
        break;
      case "device":
        Object.assign(this.state.device, e);
        this.lights.invalidate();
        this.status();
        if (!e.connected) {
          this.input.cancel(true, this.state.simulated ? "simulator" : "node");
          this.browserMic.stop();
          if (this.app && !this.menu) this.requestMenu("interrupt");
        }
        break;
      case "node_reset":
        this.lights.invalidate();
        this.input.cancel(true, this.state.simulated ? "simulator" : "node");
        if (this.app && !this.menu) this.requestMenu("interrupt");
        break;
      case "button":
        this.hostLamps.touch(performance.now());
        this.state.device.button = e.pressed;
        if (e.pressed) {
          this.synth.unlock();
          this.input.down(e);
        } else this.input.up(e);
        break;
      case "knock":
        this.hostLamps.touch(performance.now());
        this.input.knock(e);
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
      case "recognizer":
        this.state.mic = { ...this.state.mic, recognizer: { engine: e.engine, refine: e.refine, detail: e.detail } };
        this.status();
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
        this.cardStats();
        this.todayLine();
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
        this.voice(e);
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
      ? formatSensorTemp(s.sensor.temperature, unit, 1, s.settings || DEFAULT)
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
      // The third press of tap, tap, hold fills the right lamp; any other menu press fills towards a choice.
      if (press.armed) hold = { kind: "gesture", elapsedMs, holdMs: this.input.thresholdMs(press) };
      else if (press.mode === "menu") hold = { kind: "select", elapsedMs, holdMs: this.holdMs() };
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
      this.adaptRender(now - this.last);
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
          const scale = this.renderScale || 1;
          this.g.setTransform(scale, 0, 0, scale, 0, 0);
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
