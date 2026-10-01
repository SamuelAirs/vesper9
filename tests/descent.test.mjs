import test from "node:test";
import assert from "node:assert/strict";
import { Descent, VoiceThrottle, voiceDb, VOICE, FLIGHT, newWorld, extend, prune, heightAt, padUnder, speedAt } from "../web/apps/descent.js";
import { Random } from "../web/engine/math.js";
import { appContext, fakeCanvas, run } from "./helpers/app-context.mjs";
import { botWants } from "./helpers/descent-bot.mjs";

// Fly a whole run: the bot decides each frame, or nobody presses (`idle`).
function fly(options = {}) {
  const ctx = options.ctx || appContext({ seed: options.seed ?? 7 });
  const app = new Descent(ctx);
  app.down({ source: "keyboard" }); app.up({ source: "keyboard" });
  let pressed = false, t = 0;
  while (app.phase === "play" && t < (options.seconds ?? 600)) {
    const on = options.mode === "idle" ? false : botWants(app);
    if (on && !pressed) app.down({ source: "keyboard" });
    if (!on && pressed) app.up({ source: "keyboard" });
    pressed = on;
    app.update(1 / 60);
    t += 1 / 60;
    options.onStep?.(app, ctx);
  }
  return { app, ctx, t };
}
// Put the lander somewhere exact, falling, for a touchdown test.
function above(app, pad, height, vy) {
  app.x = (pad.x0 + pad.x1) / 2;
  app.alt = pad.h + height;
  app.vy = vy;
  app.pad = null;
}
const startPlay = (ctx = appContext()) => { const app = new Descent(ctx); app.down({}); app.up({}); return app; };

test("the moonscape: ground never rises faster than a lander can climb, pads are flat, and generation is repeatable", () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const w = newWorld(new Random(seed));
    extend(w, new Random(seed + 100), 4000);
    for (let i = 1; i < w.points.length; i++) {
      const a = w.points[i - 1], b = w.points[i];
      assert.ok(b.x > a.x, "points run left to right");
      assert.ok(b.h - a.h <= 0.45 * (b.x - a.x) + 1e-9, `rise ${b.h - a.h} over ${b.x - a.x} at ${a.x}`);
      assert.ok(b.h >= 0 && b.h <= 55);
    }
    for (const p of w.pads) {
      assert.ok(p.x1 - p.x0 >= 10, "pads are at least 10 m");
      for (let x = p.x0; x <= p.x1; x += 2) assert.ok(Math.abs(heightAt(w, x) - p.h) < 1e-6, "flat");
    }
    const gaps = w.pads.slice(1).map((p, i) => p.x0 - w.pads[i].x1);
    assert.ok(Math.max(...gaps) < 260, "a pad comes along within a few seconds");
    assert.ok(w.pads.some((p) => p.mult === 3), "gold pads appear");
  }
  const a = newWorld(new Random(9)), b = newWorld(new Random(9));
  assert.deepEqual(a, b);
});

test("the world is generated ahead and dropped behind, so it stays small however far you fly", () => {
  const w = newWorld(new Random(3));
  for (let x = 0; x < 20000; x += 50) { extend(w, new Random(x), x + 520); prune(w, x - 150); }
  assert.ok(w.points.length < 80, `${w.points.length} points`);
  assert.ok(w.pads.length < 12, `${w.pads.length} pads`);
});

test("a competent pilot lands many pads and scores far above one who never presses", () => {
  const rows = [];
  for (const seed of [3, 7, 11, 19]) {
    const good = fly({ seed });
    const idle = fly({ seed, mode: "idle" });
    rows.push([seed, Math.floor(good.app.score), good.app.landings, good.app.bestCombo, Math.round(good.t)]);
    assert.ok(good.app.landings >= 5, `seed ${seed} pads ${good.app.landings}`);
    assert.ok(good.app.score > 1500, `seed ${seed} score ${good.app.score}`);
    assert.ok(good.app.bestCombo >= 5);
    assert.equal(idle.app.landings, 0);
    assert.ok(idle.app.score < 100);
    assert.equal(idle.app.phase, "over");
  }
  if (process.env.DESCENT_REPORT) console.log(JSON.stringify(rows));
});

test("something happens every few seconds: the bot touches down on a new pad at least every twelve seconds on average", () => {
  const { app, t } = fly({ seed: 3 });
  assert.ok(t / app.landings < 12, `${(t / app.landings).toFixed(1)} s per pad`);
});

test("an idle lander rolls off the launch pad and is lost within twenty seconds", () => {
  const app = startPlay();
  assert.ok(app.pad?.start, "starts resting on the launch pad");
  let t = 0;
  while (app.lives === 3 && t < 30) { app.update(1 / 60); t += 1 / 60; }
  assert.ok(t > 6 && t < 20, `lost after ${t.toFixed(1)} s`);
});

test("holding lifts off the launch pad and burns fuel; resting on a pad refuels", () => {
  const app = startPlay();
  app.down({});
  run(app, 0.5);
  assert.equal(app.pad, null);
  assert.ok(app.alt > 10.5, `alt ${app.alt}`);
  assert.ok(app.fuel < FLIGHT.fuelMax - 0.4);
  app.up({});
  const pad = app.world.pads.find((p) => !p.landed);
  above(app, pad, 0.01, 1);
  app.fuel = 2;
  run(app, 0.5);
  assert.equal(app.pad, pad);
  assert.ok(app.fuel > 2 + FLIGHT.bonusFuel + 1, `fuel ${app.fuel}`);
});

test("a soft first touchdown scores and builds the combo; the same pad scores only once; a fast one is a crash that resets it", () => {
  const app = startPlay();
  run(app, 0.1);
  const [p1, p2, p3] = app.world.pads.filter((p) => !p.landed);
  above(app, p1, 0.02, 0.5);
  run(app, 0.05);
  assert.equal(app.landings, 1);
  assert.equal(app.combo, 2);
  const soft = app.lastLanding.pts;
  assert.ok(soft >= 120 * p1.mult, `soft landing ${soft}`);
  const score = app.score;
  above(app, p1, 0.02, 0.5); // bounce on the same pad
  run(app, 0.05);
  assert.equal(app.landings, 1);
  assert.ok(app.score - score < 5, "only the distance counts");
  above(app, p2, 0.02, 4);
  run(app, 0.05);
  assert.equal(app.landings, 2);
  assert.equal(app.combo, 3);
  assert.ok(app.lastLanding.pts > 2 * 60 * p2.mult - 1, "a firm landing still scores, times the combo");
  above(app, p3, 0.02, FLIGHT.safe + 1);
  run(app, 0.05);
  assert.equal(app.lives, 2);
  assert.equal(app.combo, 1);
  assert.match(app.wreckWhy, /TOO FAST/);
});

test("a gold pad scores three times", () => {
  const app = startPlay();
  run(app, 0.1);
  extend(app.world, app.ctx.rng, 3000);
  const gold = app.world.pads.find((p) => p.mult === 3);
  above(app, gold, 0.02, 0.5);
  run(app, 0.05);
  assert.ok(app.lastLanding.pts >= 3 * 120, `${app.lastLanding.pts}`);
});

test("after a crash the next lander arrives above the ground with fuel, and the third crash ends the run with one record", () => {
  const ctx = appContext();
  const app = startPlay(ctx);
  run(app, 0.1);
  for (let k = 0; k < 3; k++) {
    app.alt = heightAt(app.world, app.x) + 0.5; app.vy = 20; app.pad = null;
    run(app, 0.05);
    assert.equal(app.lives, 2 - k);
    run(app, 1.5);
    if (app.lives > 0) {
      assert.equal(app.phase, "play");
      assert.ok(app.alt > heightAt(app.world, app.x) + 15, "respawned high");
      assert.ok(app.fuel >= FLIGHT.fuelMax * 0.6 - 1e-9);
    }
  }
  assert.equal(app.phase, "over");
  run(app, 3);
  assert.equal(ctx.calls.saved.length, 1);
  const last = ctx.calls.saved[0].last;
  assert.deepEqual(Object.keys(last).sort(), ["combo", "metres", "milestone", "pads", "score"]);
});

test("the pace rises with distance", () => {
  assert.ok(speedAt(0) >= 10 && speedAt(0) <= 12);
  assert.ok(speedAt(5000) > speedAt(0) + 5);
});

test("numeric state stays finite and lamps are nine whole bytes in range", () => {
  fly({ seed: 19, onStep(app, ctx) {
    for (const v of [app.x, app.alt, app.vy, app.fuel, app.score]) assert.ok(Number.isFinite(v));
    const l = ctx.calls.leds.at(-1);
    assert.equal(l.length, 9);
    assert.ok(l.every((v) => Number.isInteger(v) && v >= 0 && v <= 255));
    ctx.calls.leds.length = 0;
  } });
});

test("lamps are green when safe and red when a crash is certain", () => {
  const app = startPlay();
  run(app, 0.2);
  const g = app.ctx.calls.leds.at(-1);
  assert.ok(g[1] > g[0], "green on the pad");
  app.pad = null; app.alt = heightAt(app.world, app.x) + 8; app.vy = 25; app.fuel = 0;
  app.update(1 / 60);
  const r = app.ctx.calls.leds.at(-1);
  assert.ok(r[0] >= r[1] && r[0] > 0, "red");
});

test("cancel, pause and dispose stop the engine and leave the lamps off", () => {
  for (const how of ["cancel", "pause", "dispose"]) {
    let stopped = 0;
    const ctx = appContext();
    ctx.synth.stopTone = () => { stopped++; };
    const app = startPlay(ctx);
    app.down({});
    run(app, 0.3);
    assert.ok(app.burning);
    app[how]();
    assert.ok(!app.burning && stopped > 0, how);
    assert.deepEqual(ctx.calls.leds.at(-1), Array(9).fill(0), how);
  }
});

test("a press that starts the run does not burn until it is released and pressed again", () => {
  const app = new Descent(appContext());
  app.down({});
  app.up({});
  assert.equal(app.phase, "play");
  run(app, 0.3);
  assert.equal(app.power, 0);
});

test("draw works on the title, in flight, in a wreck and on the result screen", () => {
  const app = new Descent(appContext());
  const g = fakeCanvas();
  app.draw(g);
  app.down({}); app.up({});
  run(app, 1);
  app.draw(g);
  app.alt = heightAt(app.world, app.x); app.vy = 20; app.pad = null;
  run(app, 0.1);
  assert.ok(app.wreck > 0);
  app.draw(g);
  app.lives = 1; app.alt = heightAt(app.world, app.x) + 2; app.vy = 20; app.wreck = 0;
  run(app, 2);
  assert.equal(app.phase, "over");
  app.draw(g);
  assert.ok(g.count.fillText > 10);
});

test("the title says what the button does", () => {
  const rows = [];
  const g = fakeCanvas();
  const spy = new Proxy(g, { get(o, k) { return k === "fillText" ? (t) => rows.push(t) : o[k]; } });
  new Descent(appContext()).draw(spy);
  const all = rows.join(" ");
  assert.match(all, /HOLD TO BURN/);
  assert.match(all, /RELEASE TO FALL/);
  assert.match(all, /PADS/);
});

// ---- voice throttle ----
// A context whose setMic behaves like the host: the service reports the mode (a mic event) before it answers.
function micContext(options = {}) {
  const ctx = appContext(options);
  ctx.calls.mic = [];
  ctx.setMic = (mode) => { ctx.calls.mic.push(mode); ctx.state().mic.mode = mode; return Promise.resolve(); };
  return ctx;
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
// An analysis frame: a quiet room at about -90 dBFS in every band, with `voice` dB in the band at 300 Hz.
const BANDS = 28;
function frame(voice = null, extra = {}) {
  const bands = Array(BANDS).fill(-90);
  if (voice !== null) bands[9] = voice;
  return { type: "analysis", rmsDb: voice ?? -85, peakDb: voice ?? -80, bands, ...extra };
}
async function holdOnTitle(app, seconds = 1) {
  app.down({ source: "keyboard" });
  run(app, seconds);
  app.up({ source: "keyboard" });
  await tick();
}
// Feed frames ten a second while the game runs.
function runWithVoice(app, seconds, level) {
  for (let i = 0, n = Math.round(seconds * 60); i < n; i++) {
    if (i % 6 === 0) app.event(frame(typeof level === "function" ? level(app) : level));
    app.update(1 / 60);
  }
}

test("the voice level is the loudest band from 140 Hz to 4 kHz; the engine's 88 Hz rumble is left out", () => {
  const bands = Array(BANDS).fill(-90);
  bands[2] = -20; // 88 Hz, the engine tone
  assert.equal(voiceDb({ bands }), -90);
  bands[12] = -41;
  assert.equal(voiceDb({ bands }), -41);
  assert.equal(voiceDb({ rmsDb: -50 }), -50, "falls back to the overall level");
  assert.equal(voiceDb({}), null);
  assert.equal(voiceDb(null), null);
});

test("the throttle learns the room, rises with a voice above the floor, and falls when the voice or the signal stops", async () => {
  const ctx = micContext();
  const v = new VoiceThrottle(ctx);
  await v.enable();
  assert.ok(v.on);
  const feed = (seconds, level) => { for (let i = 0; i < seconds * 10; i++) { v.event(frame(level)); for (let k = 0; k < 6; k++) v.tick(1 / 60); } };
  feed(2, null);
  assert.ok(!v.calibrating);
  assert.ok(Math.abs(v.floor + 90) < 0.5, `floor ${v.floor}`);
  assert.equal(v.throttle, 0, "a quiet room burns nothing");
  feed(1, -90 + VOICE.gateDb - 2);
  assert.equal(v.throttle, 0, "below the gate burns nothing");
  feed(1, -90 + VOICE.gateDb + VOICE.spanDb / 2);
  assert.ok(Math.abs(v.throttle - 0.5) < 0.08, `half voice ${v.throttle}`);
  feed(1, -30);
  assert.ok(v.throttle > 0.95, `full voice ${v.throttle}`);
  const before = v.floor;
  feed(10, -30);
  assert.ok(v.floor - before < 3, "a long hum barely moves the floor");
  assert.ok(v.throttle > 0.9);
  for (let k = 0; k < 90; k++) v.tick(1 / 60); // frames stop: half a second of grace, then the burn fades
  assert.equal(v.throttle, 0, "no signal, no burn");
  feed(1, null);
  assert.equal(v.throttle, 0);
});

test("the throttle is zero until the player chooses it, and while the room is being learned", () => {
  const v = new VoiceThrottle(micContext());
  v.event(frame(-20));
  v.tick(0.5);
  assert.equal(v.throttle, 0);
  assert.equal(v.on, false);
});

test("a tap on the title starts a run; a one-second hold switches the voice throttle on and off", async () => {
  const ctx = micContext();
  const app = new Descent(ctx);
  await holdOnTitle(app, 1);
  assert.equal(app.phase, "title", "a hold does not start a run");
  assert.deepEqual(ctx.calls.mic, ["analyze"]);
  assert.ok(app.voice.on);
  await holdOnTitle(app, 1);
  assert.deepEqual(ctx.calls.mic, ["analyze", "off"]);
  assert.ok(!app.voice.on);
  await holdOnTitle(app, 0.3);
  assert.equal(app.phase, "play", "a short press starts");
  assert.deepEqual(ctx.calls.mic, ["analyze", "off"], "and leaves the microphone alone");
});

test("leaving the game switches the microphone off only if the game switched it on", async () => {
  const ctx = micContext();
  const app = new Descent(ctx);
  app.dispose();
  assert.deepEqual(ctx.calls.mic, [], "never turned on, never touched");
  const ctx2 = micContext();
  const app2 = new Descent(ctx2);
  await holdOnTitle(app2);
  app2.dispose();
  await tick();
  assert.deepEqual(ctx2.calls.mic, ["analyze", "off"]);
});

test("a mute from elsewhere, an analysis error or a lost link turns the voice throttle off without touching the microphone", async () => {
  for (const event of [{ type: "mic", mode: "off" }, { type: "analysis_error", error: "x" }, { type: "device", connected: false }, { type: "offline" }]) {
    const ctx = micContext();
    const app = new Descent(ctx);
    await holdOnTitle(app);
    assert.ok(app.voice.on);
    app.event(event);
    assert.ok(!app.voice.on, event.type);
    app.dispose();
    assert.deepEqual(ctx.calls.mic, ["analyze"], event.type + ": the game no longer owns the microphone");
  }
});

test("a monitor tab or a refused microphone leaves the voice throttle off", async () => {
  const ctx = micContext({ state: { controller: false } });
  const app = new Descent(ctx);
  await holdOnTitle(app);
  assert.ok(!app.voice.on);
  assert.deepEqual(ctx.calls.mic, []);
  assert.match(ctx.calls.toast.join(" "), /monitor tab/);
  const ctx2 = micContext();
  ctx2.setMic = () => Promise.reject(new Error("no"));
  const app2 = new Descent(ctx2);
  await holdOnTitle(app2);
  assert.ok(!app2.voice.on);
});

test("the menu gesture's hold on the title neither starts a run nor switches the microphone", () => {
  const ctx = micContext();
  const app = new Descent(ctx);
  app.down({}); app.update(1 / 60); app.up({});        // tap one starts a run (taken back below)
  app.down({}); app.update(1 / 60); app.up({});
  app.down({});
  run(app, 1.1);
  app.cancel(); // the host opens the menu before the release
  app.pause();
  assert.equal(app.phase, "title");
  assert.deepEqual(ctx.calls.mic, []);
  app.resume();
  app.up({});
  assert.deepEqual(ctx.calls.mic, []);
  assert.equal(app.phase, "title");
});

test("the title shows the voice throttle option and how to switch it", () => {
  const rows = [];
  const g = fakeCanvas();
  const spy = new Proxy(g, { get(o, k) { return k === "fillText" ? (t) => rows.push(t) : o[k]; } });
  new Descent(micContext()).draw(spy);
  assert.match(rows.join(" "), /VOICE THROTTLE: OFF/);
  assert.match(rows.join(" "), /HOLD ONE SECOND TO SWITCH ON/);
});


// Learn the room on the title, then start a run.
async function voiceRun(seed = 7) {
  const ctx = micContext({ seed });
  let rumble = 0;
  ctx.synth.startTone = () => { rumble++; };
  const app = new Descent(ctx);
  await holdOnTitle(app);
  runWithVoice(app, 2, null);
  app.down({}); app.up({});
  return { app, ctx, rumble: () => rumble };
}

test("a voice burn is proportional, uses fuel in proportion, and makes no engine rumble", async () => {
  const { app, rumble } = await voiceRun();
  assert.equal(app.phase, "play");
  app.pad = null; app.alt = 60; app.vy = 0;
  const half = -90 + VOICE.gateDb + VOICE.spanDb / 2;
  runWithVoice(app, 0.5, half);
  const fuel0 = app.fuel, vy0 = app.vy;
  runWithVoice(app, 1, half);
  assert.ok(Math.abs(app.power - 0.5) < 0.08, `power ${app.power}`);
  assert.ok(Math.abs(fuel0 - app.fuel - 0.5) < 0.08, `fuel used ${fuel0 - app.fuel}`);
  const dv = app.vy - vy0;
  assert.ok(Math.abs(dv - (FLIGHT.g - FLIGHT.a * 0.5)) < 0.6, `half a burn: dv ${dv}`);
  assert.equal(rumble(), 0, "no rumble for the voice");
  app.down({});
  app.update(1 / 60);
  assert.equal(app.power, 1, "the button is a full burn");
  assert.equal(rumble(), 1);
});

test("a voice pilot can hold a hover that the button alone can only approximate", async () => {
  const { app } = await voiceRun();
  app.pad = null; app.alt = 60; app.vy = 0;
  const hover = -90 + VOICE.gateDb + VOICE.spanDb * (FLIGHT.g / FLIGHT.a);
  runWithVoice(app, 1, hover);
  const vys = [];
  for (let i = 0; i < 60; i++) { runWithVoice(app, 1 / 60, hover); vys.push(app.vy); }
  assert.ok(Math.max(...vys.map(Math.abs)) < 0.8, `steady: ${Math.max(...vys.map(Math.abs))}`);
});

test("with the voice throttle on but the microphone silent, the game plays exactly as with the button alone", async () => {
  const trace = async (voice) => {
    const ctx = micContext({ seed: 11 });
    const app = new Descent(ctx);
    if (voice) await holdOnTitle(app);
    const out = [];
    app.down({}); app.up({});
    let pressed = false;
    for (let i = 0; i < 60 * 40 && app.phase === "play"; i++) {
      const on = botWants(app);
      if (on && !pressed) app.down({}); if (!on && pressed) app.up({});
      pressed = on;
      app.update(1 / 60);
      out.push(+app.alt.toFixed(4));
    }
    return out;
  };
  const a = await trace(true), b = await trace(false);
  assert.ok(a.length > 600);
  assert.deepEqual(a, b);
});
