// The menu gesture (tap, tap, hold) reaches an app as ordinary edges before the host opens the menu and
// calls cancel(). For every registered game (Signal School included), this plays a little, performs tap,
// tap, hold through the real InputRouter, lets the host cancel, pause, and resume, and asserts that
// nothing the gesture did survived: score, lives and position-critical state are what they were just
// before the gesture's first tap, and no run, lesson, catch or purchase was saved.
// The only exceptions are the ones written in PER_APP below, each with the app's own documented reason.
// Cadence (an instrument that reads raw button edges) is checked at the end of this file.
import test from "node:test";
import assert from "node:assert/strict";
import { APPS } from "../web/apps/registry.js";
import { InputRouter } from "../web/engine/input.js";
import { Cadence } from "../web/apps/cadence.js";
import { appContext } from "./helpers/app-context.mjs";

const DT = 1 / 60;

// A deep, comparable picture of an app's plain-data state (typed arrays as arrays; class instances,
// functions and the context left out, as AppGuard leaves them out). `ignore` drops keys at any depth.
function plain(app, ignore = []) {
  const out = {};
  for (const key of Object.keys(app)) {
    const v = app[key];
    if (typeof v === "function" || key === "c" || key === "ctx" || key === "guard") continue;
    if (v && typeof v === "object" && !Array.isArray(v) && !ArrayBuffer.isView(v) && !(v instanceof Map) && !(v instanceof Set)) {
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) continue;
    }
    out[key] = v;
  }
  const seen = new WeakSet();
  return JSON.parse(JSON.stringify(out, (k, v) => {
    if (ignore.includes(k)) return undefined;
    if (ArrayBuffer.isView(v)) return Array.from(v);
    if (v instanceof Map || v instanceof Set) return [...v];
    if (v && typeof v === "object") {
      if (seen.has(v)) return "[shared]";
      if (!Array.isArray(v)) { const p = Object.getPrototypeOf(v); if (p !== Object.prototype && p !== null) return undefined; }
      seen.add(v);
    }
    if (typeof v === "number" && !Number.isFinite(v)) return String(v);
    return v;
  }));
}

// Held input and clocks: cancel() drops a held press whatever it was, and these keys are the held-press
// bookkeeping of the games. Keeping them out of the comparison does not hide any score, life or position.
const HELD = ["held", "pressing", "pressT", "heldTime", "btn", "latched", "ignoreUp", "down_", "consume", "downAt", "pending", "buffer"];
// What each app documents as surviving the gesture, and why. `only`: the app saves a fixed list of fields
// (GestureGuard) and these are the ones it promises. `ignore`: extra keys that cancel() or pause() set on
// purpose. `resume`: keys the app resets when the menu closes. `skipResume`: resume() rebuilds the screen.
const PER_APP = {
  orbit: { only: ["phase", "points", "lives", "target", "angle", "dir", "drift", "miss", "feedback"] },
  runner: { only: ["phase", "points", "distance", "y", "vy", "obstacles", "shield", "grace", "next"] },
  drift: { only: ["phase", "points", "y", "vy", "gates", "hull", "grace", "lastCenter"] },
  // A fish on the line gets 1.5 s of grace after any menu, and a menu choice that was held is cancelled.
  tideline: { ignore: ["done", "grace"] },
  // An armed trial is cancelled by every pause (the node's timing is gone), so it returns to the title.
  reaction: { skipResume: true },
  // Resuming a new letter or an echo transmission that was playing replays it from its start.
  echo: { skipResume: true },
  morse: { listenResume: true },
  // An incremental game: a tap is a gather and gathering is its whole point, so the two taps keep the signal
  // they gathered. Purchases happen only on a release, which the host consumes, and the build ring closes.
  // The picture is what a gesture must not change: the screen, the machines, upgrades, bearings and tree.
  outpost: { pick: (a) => JSON.parse(JSON.stringify({ phase: a.phase_, own: a.s.own, up: Array.from(a.s.up), b: a.s.b, L: a.s.L, tree: a.s.tree })), skipResume: true },
};

function mount(id, seed = 31) {
  const meta = APPS.find((a) => a.id === id);
  const ctx = appContext({ seed, settings: { gesturePace: "standard" } });
  return { ctx, app: meta.create(ctx), meta };
}

// A router host like main.js: edges to the app, requestMenu cancels held input, cancels and pauses the app.
function rig(app, pace = "standard") {
  let now = 0, menus = 0, open = false;
  const r = { cancelled: null };
  const host = {
    epoch: 0, holdMs: () => 650, escapePolicy: () => ({ pace }), inputMode: () => (open ? "menu" : "raw"),
    pressVisual() {}, holdVisual() {}, clickVisual() {}, advance() {}, select() {},
    rawDown: (e) => app.down?.(e), rawUp: (e) => app.up?.(e), rawCancel: () => app.cancel?.(),
    requestMenu() {
      menus++;
      router.cancel(router.blocked || !!router.press, router.blockSource || router.press?.event.source);
      host.rawCancel(); host.epoch++; open = true;
      r.cancelled?.();
      app.pause?.();
    },
  };
  const router = new InputRouter(host, () => now);
  Object.assign(r, {
    menus: () => menus,
    frame(n = 1) { for (let i = 0; i < n; i++) { now += 1000 / 60; router.update(); if (open) return; app.update?.(DT); } },
    press(ms) { // a full press and release, the app running
      router.down({ source: "node", generation: 1, at_us: now * 1000 });
      r.frame(Math.max(1, Math.round(ms / 16.7)));
      router.up({ source: "node", generation: 1, at_us: now * 1000 });
    },
    // tap every `every` seconds for `seconds` seconds: a little play, slower than any gesture.
    play(seconds, every = 0.55) {
      for (let t = 0; t < seconds; t += every) { r.press(70); r.frame(Math.round((every - 0.07) * 60)); }
    },
    gesture({ tap = 67, gap = 50 } = {}) {
      const edge = (k) => router[k]({ source: "node", generation: 1, at_us: now * 1000 });
      for (let i = 0; i < 2; i++) { edge("down"); r.frame(Math.max(1, Math.round(tap / 16.7))); edge("up"); r.frame(Math.max(1, Math.round(gap / 16.7))); }
      edge("down");
      for (let f = 0; f < 400 && !open; f++) r.frame();
      return open;
    },
    resume() { open = false; host.epoch++; router.cancel(); app.resume?.(); },
  });
  return r;
}

const GAMES = APPS.filter((a) => {
  const probe = a.create(appContext());
  const game = !probe.navigation;
  probe.dispose?.();
  return game;
}).map((a) => a.id);

test("every registered game is covered by the tolerance test", () => {
  assert.deepEqual(GAMES.slice().sort(), ["ballista", "descent", "drift", "echo", "glyphs", "helix", "morse", "orbit",
    "outpost", "perihelion", "pulsar", "reaction", "ricochet", "runner", "tideline"]);
});

for (const id of GAMES) {
  const spec = PER_APP[id] || {};
  for (const [pace, tap, gap] of [["standard", 67, 50], ["quick", 60, 40], ["relaxed", 150, 250]]) {
    for (const playSeconds of [0.2, 3, 9]) {
      test(`${id}: tap, tap, hold after ${playSeconds} s of play (${pace} pace), cancel, pause and resume change nothing`, () => {
        const { ctx, app } = mount(id);
        const r = rig(app, pace);
        r.play(playSeconds);
        const ignore = [...HELD, ...(spec.ignore || [])];
        const picture = () => {
          const full = plain(app, ignore);
          if (spec.pick) return spec.pick(app);
          return spec.only ? Object.fromEntries(spec.only.map((k) => [k, full[k]])) : full;
        };
        const before = picture(), rngBefore = ctx.rng.state;
        // Runs that had already ended, or writes already held back, before the first tap are saved when the
        // menu opens, as on any pause; they are not the gesture's doing.
        const g = app.guard, earlier = (g?.backlog?.length || 0) + (app.ended ? 1 : 0) + (g?.queue?.length || 0);
        const saves = ctx.calls.saved.length;
        let cancelled = null, rngCancelled = null;
        r.cancelled = () => { cancelled = picture(); rngCancelled = ctx.rng.state; };
        assert.ok(r.gesture({ tap, gap }), "the gesture opened the menu");
        assert.equal(r.menus(), 1);
        // cancel() has run (the host does it before pause()): the app is as it was before the first tap.
        if (id === "outpost") assert.equal(app.ring, null, "the build ring is closed");
        assert.deepEqual(cancelled, before, id + " differs after cancel()");
        if (!spec.only && !spec.pick) assert.equal(rngCancelled, rngBefore, "the random generator was not put back");
        // Nothing the gesture could have caused was saved: no run, lesson, catch or purchase.
        if (id === "outpost") assert.ok(ctx.calls.saved.length <= saves + 4, "only Outpost's own leave-saves (cancel and pause each save)");
        else assert.ok(ctx.calls.saved.length <= saves + earlier, `something was saved by the gesture (${ctx.calls.saved.length - saves} new, ${earlier} earlier)`);
        assert.deepEqual(picture(), spec.skipResume ? picture() : before, id + " differs after pause()");
        r.resume();
        if (!spec.skipResume && !(spec.listenResume && app.mode === "listen"))
          assert.deepEqual(picture(), before, id + " differs after resume()");
        // The game still runs afterwards.
        for (let f = 0; f < 120; f++) app.update(DT);
      });
    }
  }
}

// ---- CADENCE: two taps and a hold must not leave a stray tap tempo or lap --------------------------------
function cadence() {
  const ctx = appContext({ seed: 5, settings: { gesturePace: "standard" } });
  const app = new Cadence(ctx);
  let now = 1000;
  app.clock = () => now;
  return { ctx, app, advance: (ms) => { now += ms; }, now: () => now };
}
function edges(c, kind, source = "node") {
  c.app.event({ type: "button", pressed: kind === "down", source, at_us: c.now() * 1000 });
}
function cadenceGesture(c) {
  for (let i = 0; i < 2; i++) { edges(c, "down"); c.advance(70); edges(c, "up"); c.advance(60); }
  edges(c, "down"); c.advance(1000);
  c.app.cancel(); c.app.pause();  // the host: cancel the held input, then pause
  edges(c, "up");                 // its release arrives anyway (the router swallowed it, the event still goes by)
  c.app.resume();
}
test("Cadence: tap, tap, hold leaves no tap tempo behind", () => {
  const c = cadence(), app = c.app;
  app.tool = "tap"; app.bpm = 100;
  const tap = JSON.stringify(app.tap), bpm = app.bpm;
  cadenceGesture(c);
  assert.equal(app.bpm, bpm, "the two taps set a tempo");
  assert.equal(JSON.stringify(app.tap), tap, "the two taps were remembered");
});
test("Cadence: tap, tap, hold leaves no lap on a running stopwatch", () => {
  const c = cadence(), app = c.app;
  app.tool = "stop";
  app.sw = { running: true, startAt: c.now(), before: 0, laps: [{ split: 5, total: 5 }], lapAt: -1e9, startedAt: c.now() };
  cadenceGesture(c);
  assert.equal(app.sw.laps.length, 1, "a stray lap was left by the gesture");
});
test("Cadence: ordinary taps and laps outside a gesture are kept", () => {
  const c = cadence(), app = c.app;
  app.tool = "tap";
  for (const gap of [500, 500, 500]) { edges(c, "down"); c.advance(70); edges(c, "up"); c.advance(gap); }
  assert.ok(app.tap.times.length >= 3);
  c.app.cancel();           // a cancel with no gesture behind it undoes nothing
  assert.ok(app.tap.times.length >= 3);
  app.tool = "stop"; app.sw = { running: true, startAt: c.now(), before: 0, laps: [], lapAt: -1e9, startedAt: c.now() };
  edges(c, "down"); c.advance(70); edges(c, "up"); c.advance(300);
  c.app.cancel();
  assert.equal(app.sw.laps.length, 1);
});
test("Cadence: a hold that is too short, or taps that are too slow, are not taken for the gesture", () => {
  const c = cadence(), app = c.app;
  app.tool = "stop"; app.sw = { running: true, startAt: c.now(), before: 0, laps: [], lapAt: -1e9, startedAt: c.now() };
  for (let i = 0; i < 2; i++) { edges(c, "down"); c.advance(70); edges(c, "up"); c.advance(400); }  // pauses too long
  edges(c, "down"); c.advance(1000);
  c.app.cancel();
  assert.equal(app.sw.laps.length, 2, "slow taps were rewound as a gesture");
});
