import test from "node:test";
import assert from "node:assert/strict";
import { Descent, VoiceThrottle, voiceDb, VOICE, PACE } from "../web/apps/descent.js";
import { appContext, fakeCanvas, run } from "./helpers/app-context.mjs";

const MAX_STEPS = 60 * 60 * 12; // twelve simulated minutes

// A bot that sees what a player sees: altitude, speed, fuel, drift, and where the pad is.
// It brakes just in time, and slows its descent to arrive when the pad is under it.
function botWants(app) {
  const { w, site: s } = app;
  const net = s.a - s.g;
  const vt = 0.55 * s.safe;
  const dx = ((w.padx - w.x + 720) % 480) - 240;
  const closing = w.vx - w.pv;
  let want = vt;
  if (w.alt > 6) {
    let tAlign = Math.abs(dx) < s.padHalf * 0.35 ? 0 : dx * closing > 0 ? dx / closing : 99;
    if (tAlign > 0 && s.canyon && w.alt < s.rim + 25) tAlign = 0; // inside the canyon, just go down
    want = tAlign > 0 ? Math.max(vt, w.alt / Math.max(tAlign, 0.5)) : 1e9;
  }
  const brake = (w.vy * w.vy - vt * vt) / (2 * net) >= w.alt * 0.93 - 0.5;
  return (w.vy > vt && brake) || w.vy > want + 0.4 || (w.alt < 8 && w.vy > vt);
}

function play(options = {}) {
  const ctx = appContext({ seed: options.seed ?? 7 });
  const app = new Descent(ctx);
  const mode = options.mode || "bot";
  let pressed = false;
  const set = (on) => {
    if (on && !pressed) app.down({ source: "keyboard" });
    if (!on && pressed) app.up({ source: "keyboard", durationMs: 100 });
    pressed = on;
  };
  let steps = 0, sinceEdge = 0;
  app.down({ source: "keyboard" });
  app.up({ source: "keyboard", durationMs: 50 });
  while (steps < (options.max ?? MAX_STEPS) && app.phase !== "over") {
    steps++;
    if (app.phase === "play") {
      sinceEdge = 0;
      if (mode === "bot") set(botWants(app));
    } else {
      set(false);
      sinceEdge++;
      if ((app.phase !== "brief" || app.waitBrief) && sinceEdge > 200) { app.down({}); app.up({}); sinceEdge = 0; }
    }
    app.update(1 / 60);
    if (options.onStep) options.onStep(app, ctx);
    if (options.stopAtSite && app.siteNo > options.stopAtSite) break;
    if (options.until?.(app)) break;
  }
  return { app, ctx, steps };
}

test("a competent bot clears many sites and scores far above a bot that never presses", () => {
  const scores = [];
  for (const seed of [3, 7, 11, 19]) {
    const good = play({ seed });
    const idle = play({ seed, mode: "idle" });
    scores.push([seed, good.app.total, good.app.cleared, good.app.phase, idle.app.total]);
    assert.ok(good.app.total > 2000, `seed ${seed} bot score ${good.app.total}`);
    assert.ok(good.app.cleared >= 8, `seed ${seed} sites ${good.app.cleared}`);
    assert.equal(idle.app.total, 0, "an idle lander never lands softly");
    assert.equal(idle.app.phase, "over");
  }
  if (process.env.DESCENT_REPORT) console.log(JSON.stringify(scores));
});

test("the first two sites are forgiving: the bot lands both without losing a lander", () => {
  const { app } = play({ seed: 5, stopAtSite: 2 });
  assert.ok(app.siteNo > 2);
  assert.equal(app.lives, 3);
});

test("a run ends in a loss with a saved record", () => {
  const { app, ctx } = play({ mode: "idle" });
  assert.equal(app.phase, "over");
  assert.equal(app.lives, 0);
  assert.equal(ctx.calls.saved.length, 1);
  assert.equal(ctx.calls.saved[0].last.sites, 0);
});

test("numeric state stays finite, lists stay bounded, lamps are nine whole bytes that change", () => {
  const seen = new Set();
  const { ctx } = play({
    seed: 23,
    onStep(app, c) {
      const w = app.w;
      if (w) for (const v of [w.x, w.alt, w.vy, w.vx, w.padx, app.fuel, app.total]) assert.ok(Number.isFinite(v));
      assert.ok(app.site.terrain.length === 240 && app.site.gusts.length <= 9);
      const l = c.calls.leds[c.calls.leds.length - 1];
      if (l) seen.add(l.join(","));
    },
  });
  for (const v of ctx.calls.leds) {
    assert.equal(v.length, 9);
    for (const c of v) assert.ok(Number.isInteger(c) && c >= 0 && c <= 255);
  }
  assert.ok(seen.size > 20, "lamps change during play");
});

// Leave the title, then press again to leave the first briefing (it waits for a press).
function launch(app) {
  app.down(); app.up();
  run(app, 0.8);
  app.down(); app.up();
  run(app, 0.1);
}

function started(seed) {
  const ctx = appContext({ seed });
  const app = new Descent(ctx);
  launch(app);
  assert.equal(app.phase, "play");
  return { ctx, app };
}

test("lamps are green when safe, amber when fast but recoverable, red when a crash is certain", () => {
  const { ctx, app } = started(1);
  app.w.alt = 100; app.w.vy = 1;
  run(app, 1 / 60);
  let l = ctx.calls.leds.at(-1);
  assert.ok(l[1] > l[0] * 2, "green: " + l);
  app.w.alt = 100; app.w.vy = 12; app.fuel = 8;
  run(app, 1 / 60);
  l = ctx.calls.leds.at(-1);
  assert.ok(l[0] > 0 && l[1] > 0 && l[1] < l[0], "amber: " + l);
  app.w.alt = 25; app.w.vy = 30; app.fuel = 2;
  run(app, 1 / 60);
  l = ctx.calls.leds.at(-1);
  assert.ok(l[0] > l[1] * 3, "red: " + l);
});

test("the lit lamp shows which side the pad is on", () => {
  const { ctx, app } = started(2);
  app.w.vy = 0; app.w.alt = 100;
  app.w.padx = app.w.x - 120;
  run(app, 1 / 60);
  let l = ctx.calls.leds.at(-1);
  assert.ok(l[1] > 0 && l[7] * 4 < l[1] && l[1] > l[4], "pad to the left lights the left lamp: " + l);
  app.w.padx = app.w.x + 120;
  run(app, 1 / 60);
  l = ctx.calls.leds.at(-1);
  assert.ok(l[7] > 0 && l[1] * 4 < l[7] && l[7] > l[4], "pad to the right lights the right lamp: " + l);
  app.w.padx = app.w.x;
  run(app, 1 / 60);
  l = ctx.calls.leds.at(-1);
  assert.ok(l[1] > 0 && l[4] > 0 && l[7] > 0, "pad underneath lights all three: " + l);
});

test("three quick taps are three small burns and do not end the run", () => {
  const { app } = started(3);
  for (let i = 0; i < 3; i++) {
    app.down({ source: "keyboard" });
    run(app, 0.08);
    app.up({ source: "keyboard", durationMs: 80 });
    run(app, 0.1);
  }
  app.cancel();
  assert.equal(app.phase, "play");
  assert.equal(app.lives, 3);
  assert.ok(app.fuel > app.site.fuel - 1);
});

test("cancel and dispose mid-play stop the engine and leave the lamps off", () => {
  const ctx = appContext();
  let tone = 0;
  ctx.synth.startTone = () => tone++;
  ctx.synth.stopTone = () => { tone = 0; };
  const app = new Descent(ctx);
  launch(app);
  run(app, 3);
  app.down({ source: "keyboard" });
  run(app, 0.5);
  assert.equal(tone, 1);
  app.cancel();
  assert.equal(tone, 0);
  run(app, 0.2);
  assert.equal(app.burning, false);
  app.down({ source: "keyboard" });
  run(app, 0.3);
  app.dispose();
  assert.equal(tone, 0);
  assert.deepEqual(ctx.calls.leds.at(-1), Array(9).fill(0));
});

test("a press that skips the briefing does not burn until released and pressed again", () => {
  const ctx = appContext();
  const app = new Descent(ctx);
  app.down(); app.up();
  run(app, 0.8);
  app.down();
  assert.equal(app.phase, "play");
  run(app, 0.5);
  assert.equal(app.fuel, app.site.fuel);
  app.up();
  app.down();
  run(app, 0.2);
  assert.ok(app.fuel < app.site.fuel);
});

test("a press on the last crash screen does not start another descent", () => {
  const { app } = started(4);
  app.lives = 1;
  app.w.alt = 0.2; app.w.vy = 20;
  run(app, 0.1);
  assert.equal(app.phase, "crashed");
  run(app, 1.6);
  app.down(); app.up();
  assert.equal(app.phase, "crashed");
  assert.equal(app.lives, 0);
  run(app, 1.5);
  assert.equal(app.phase, "over");
  run(app, 1.2);
  app.down(); app.up();
  assert.equal(app.phase, "brief");
  assert.equal(app.lives, 3);
});

test("draw works in every phase and stays small", () => {
  const ctx = appContext();
  const app = new Descent(ctx);
  const g = fakeCanvas();
  app.draw(g);
  app.down(); app.up();
  app.draw(g);
  launch(app);
  run(app, 3);
  app.draw(g);
  const before = g.count.lineTo || 0;
  app.draw(g);
  assert.ok((g.count.lineTo || 0) - before < 700);
  app.w.alt = 0.2; app.w.vy = 20;
  run(app, 0.1);
  assert.equal(app.phase, "crashed");
  app.draw(g);
  run(app, 3);
  app.draw(g);
});

test("the first briefing waits for a press; later briefings and retries start by themselves", () => {
  const ctx = appContext({ seed: 8 });
  const app = new Descent(ctx);
  app.down(); app.up();
  assert.equal(app.phase, "brief");
  run(app, 20);
  assert.equal(app.phase, "brief", "a newcomer can read the briefing for as long as needed");
  assert.ok(app.waitBrief);
  const g = fakeCanvas();
  app.draw(g);
  app.down(); app.up();
  assert.equal(app.phase, "play");
  // A crash on site 1 and the retry: the briefing starts the descent on its own.
  app.w.alt = 0.2; app.w.vy = 20;
  run(app, 0.1);
  run(app, 1.6);
  app.down(); app.up();
  assert.equal(app.phase, "brief");
  assert.ok(!app.waitBrief);
  run(app, 2.6);
  assert.equal(app.phase, "play");
});

// The descent runs at PACE (Sam found the old 17 s fall "way too slow to be fun"): now about eight and a half.
test("an idle newcomer on site 1 has about eight seconds before the ground", () => {
  const app = new Descent(appContext({ seed: 3 }));
  launch(app);
  let t = 0;
  while (app.phase === "play" && t < 60) { app.update(1 / 60); t += 1 / 60; }
  assert.equal(app.phase, "crashed");
  assert.ok(t > 7.5 && t < 10, "fall took " + t.toFixed(1) + " s");
});

test("pause and cancel switch the lamps off", () => {
  for (const how of ["pause", "cancel"]) {
    const ctx = appContext({ seed: 2 });
    const app = new Descent(ctx);
    launch(app);
    run(app, 1);
    assert.ok(ctx.calls.leds.at(-1).some((v) => v > 0), "lit in play");
    app[how]();
    assert.deepEqual(ctx.calls.leds.at(-1), Array(9).fill(0), how);
  }
});

test("the title says what the button does", () => {
  const rows = [];
  const g = fakeCanvas();
  const spy = new Proxy(g, { get(o, k) { return k === "fillText" ? (t) => rows.push(t) : o[k]; } });
  new Descent(appContext()).draw(spy);
  const all = rows.join(" ");
  assert.match(all, /HOLD TO BURN/);
  assert.match(all, /RELEASE TO FALL/);
  assert.match(all, /LAND SLOWLY/);
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
  assert.equal(app.phase, "brief", "a short press starts");
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

test("a voice burn is proportional, uses fuel in proportion, and makes no engine rumble", async () => {
  const ctx = micContext();
  let rumble = 0;
  ctx.synth.startTone = () => { rumble++; };
  const app = new Descent(ctx);
  await holdOnTitle(app);
  runWithVoice(app, 2, null); // learn the room on the title
  app.down({}); app.up({});
  runWithVoice(app, 0.6, null);
  app.down({}); app.up({}); // start the descent from the first briefing
  assert.equal(app.phase, "play");
  const half = -90 + VOICE.gateDb + VOICE.spanDb / 2;
  runWithVoice(app, 0.5, half);
  const fuel0 = app.fuel, vy0 = app.w.vy;
  runWithVoice(app, 1, half);
  const used = fuel0 - app.fuel;
  assert.ok(Math.abs(app.power - 0.5) < 0.08, `power ${app.power}`);
  assert.ok(Math.abs(used - 0.5 * PACE) < 0.1, `fuel used ${used}`);
  const s = app.site;
  const dv = app.w.vy - vy0;
  assert.ok(Math.abs(dv - (s.g - s.a * 0.5) * PACE) < 0.5, `half a burn: dv ${dv}`);
  assert.equal(rumble, 0, "no rumble for the voice");
  app.down({});
  app.update(1 / 60);
  assert.equal(app.power, 1, "the button is a full burn");
  assert.equal(rumble, 1);
});

test("a hovering voice pilot lands the opening sites", async () => {
  // Proportional control: aim for a gentle descent speed and ask for just the burn that holds it.
  const ctx = micContext({ seed: 5 });
  const app = new Descent(ctx);
  await holdOnTitle(app);
  runWithVoice(app, 2, null);
  app.down({}); app.up({});
  let landed = 0, steps = 0;
  while (steps++ < 60 * 240 && app.siteNo <= 3 && app.phase !== "over") {
    const level = () => {
      if (app.phase !== "play") return null;
      const { w, site: s } = app;
      const want = w.alt > 25 ? 0.8 * s.safe + w.alt / 12 : 0.5 * s.safe;
      const need = clamp01((s.g + (w.vy - want) * 1.5) / s.a);
      return need > 0 ? -90 + VOICE.gateDb + need * VOICE.spanDb : null;
    };
    if (app.phase === "landed" && app.pt > 1.3) { landed++; app.down({}); app.up({}); }
    if (app.phase === "crashed" && app.pt > 1.5) { app.down({}); app.up({}); }
    if (app.phase === "brief" && app.waitBrief) { app.down({}); app.up({}); }
    runWithVoice(app, 0.1, level);
  }
  assert.ok(landed >= 3, `landed ${landed}`);
  assert.equal(app.lives, 3, "without losing a lander");
});
function clamp01(x) { return Math.max(0, Math.min(1, x)); }

test("with the voice throttle on but the microphone silent, the game plays exactly as with the button alone", async () => {
  const runFor = async (voice) => {
    const ctx = micContext({ seed: 11 });
    const app = new Descent(ctx);
    if (voice) await holdOnTitle(app);
    const trace = [];
    app.down({}); app.up({});
    for (let i = 0; i < 60 * 40; i++) {
      if (app.phase === "brief" && app.waitBrief) { app.down({}); app.up({}); }
      if (app.phase === "play") { if (i % 90 === 0) app.down({}); if (i % 90 === 40) app.up({}); }
      app.update(1 / 60);
      if (app.w) trace.push(+app.w.alt.toFixed(4));
    }
    return trace;
  };
  assert.deepEqual(await runFor(true), await runFor(false));
});

test("the title shows the voice throttle option and how to switch it", () => {
  const rows = [];
  const g = fakeCanvas();
  const spy = new Proxy(g, { get(o, k) { return k === "fillText" ? (t) => rows.push(t) : o[k]; } });
  new Descent(micContext()).draw(spy);
  assert.match(rows.join(" "), /VOICE THROTTLE: OFF/);
  assert.match(rows.join(" "), /HOLD ONE SECOND TO SWITCH ON/);
});

test("the survey keeps moving: a landing leads to the next site and a crash to a retry without a press", () => {
  const { app } = play({ seed: 5, until: (a) => a.phase === "landed" }); // lands site 1, then waits
  assert.equal(app.phase, "landed");
  run(app, 2.3);
  assert.equal(app.siteNo, 2);
  assert.ok(app.phase === "brief" || app.phase === "play");
  const idle = new Descent(appContext({ seed: 3 }));
  idle.down({}); idle.up({});
  idle.down({}); idle.up({});
  for (let i = 0; i < 60 * 30 && idle.phase !== "crashed"; i++) { idle.update(1 / 60); if (idle.phase === "brief" && idle.waitBrief && idle.pt > 0.6) { idle.down({}); idle.up({}); } }
  assert.equal(idle.phase, "crashed");
  run(idle, 2.7);
  assert.ok(idle.phase === "brief" || idle.phase === "play", idle.phase);
  assert.equal(idle.lives, 2);
});

test("a whole site, briefing to touchdown, takes well under fifteen seconds for the bot", () => {
  let start = null, took = null;
  play({ seed: 7, stopAtSite: 3, onStep(app) {
    if (app.siteNo === 3 && app.phase === "brief" && start === null) start = app.t;
    if (app.siteNo === 3 && app.phase === "landed" && took === null) took = app.t - start;
  } });
  assert.ok(took !== null && took < 15, "site 3 took " + took);
});
