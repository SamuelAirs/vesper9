// Shared audit harness: a recording app context (seeded ctx.rng) and a rig that
// drives an app through the real InputRouter the way web/main.js does.
import { InputRouter } from "../../web/engine/input.js";
import { Random } from "../../web/engine/math.js";

export const DT = 1 / 60;

export function makeCtx(seed = 1979, opts = {}) {
  const log = { scores: [], saves: [], tones: [], commands: [], hints: [] };
  const ctx = {
    log,
    rng: new Random(seed),
    ledsNow: Array(9).fill(0), // what the lamps would show right now
    sidetone: false,           // sustained tone currently sounding
    hud() {},
    hint: (m) => log.hints.push(m),
    controls() {},
    tone: (hz, s, w) => log.tones.push({ hz, s, w }),
    synth: {
      startTone() { ctx.sidetone = true; },
      stopTone() { ctx.sidetone = false; },
    },
    score: (n, metric = "default") => log.scores.push({ n, metric }),
    best: () => opts.best ?? 0,
    alive: () => true,
    simulated: () => opts.simulated ?? true,
    settings: () => ({ morseWpm: 10, scanMs: 850, ...(opts.settings || {}) }),
    state: () => ({ scores: {} }),
    progress: () => opts.progress || {},
    saveProgress: (v) => {
      log.saves.push(structuredClone(v));
      if (opts.progress !== undefined) opts.progress = v;
      return Promise.resolve();
    },
    command: async (name, data) => { log.commands.push({ name, data }); return { accepted: true }; },
    error() {},
    leds: (v) => { ctx.ledsNow = v.slice(); },
  };
  return ctx;
}

// Router + host stub mirroring main.js: raw edges go to the app; when tap, tap, hold completes the router
// asks the host for the menu, which cancels held input (the app's cancel()), pauses the app and the light
// director writes zeros. `holdMs` is the selection threshold of menus (the setting).
export function makeRig(app, ctx, { pace = "standard", holdMs = 650 } = {}) {
  let now = 0;
  const rig = { now: () => now, menuOpen: 0, menu: false, via: null, focus: null, advances: 0, selects: 0 };
  const host = {
    epoch: 0,
    holdMs: () => holdMs,
    escapePolicy: () => ({ pace }),
    inputMode: () => (rig.menu ? "menu" : "raw"),
    pressVisual() {}, holdVisual() {}, clickVisual() {},
    advance() { rig.advances++; }, select() { rig.selects++; },
    rawDown: (e) => app.down?.(e),
    rawUp: (e) => app.up?.(e),
    rawCancel: () => app.cancel?.(),
    requestMenu(via, { focus } = {}) {
      rig.menuOpen++; rig.via = via; rig.focus = focus;
      // Vesper.openMenu: cancel held input (its release is swallowed), cancel the app, pause it, release the lamps.
      router.cancel(router.blocked || !!router.press, router.blockSource || router.press?.event.source);
      host.rawCancel();
      host.epoch++; rig.menu = true;
      app.pause?.();
      ctx.ledsNow = Array(9).fill(0); // LightDirector.release()
    },
  };
  const router = new InputRouter(host, () => now);
  Object.assign(rig, {
    router, host, app,
    wait(ms) { now += ms; router.update(); },
    tap(ms = 60, gap = 55, source = "node") {
      router.down({ source, generation: 1, at_us: now * 1000 }); rig.wait(ms);
      router.up({ source, generation: 1, at_us: now * 1000 }); rig.wait(gap);
    },
    // Tap, tap, then a third press held until the menu opens or `until` ms pass; the app runs throughout.
    gesture({ tap = 67, gap = 50, until = 5000, source = "node" } = {}) {
      const frames = (ms) => { for (let f = 0; f < Math.max(1, Math.round(ms / 16.7)); f++) app.update?.(DT); };
      const edge = (kind) => router[kind]({ source, generation: 1, at_us: now * 1000 });
      for (let i = 0; i < 2; i++) { edge("down"); frames(tap); rig.wait(tap); edge("up"); frames(gap); rig.wait(gap); }
      edge("down");
      for (let t = 0; t < until; t += 16.7) { rig.wait(16.7); if (rig.menuOpen) break; app.update?.(DT); }
      return rig.menuOpen > 0;
    },
    // Same order as Vesper.closeMenu(): cancel pending input, then lifecycle resume.
    resume() { rig.menu = false; host.epoch++; router.cancel(); app.resume?.(); },
  });
  return rig;
}

export function step(app, seconds) {
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) app.update(DT);
}
