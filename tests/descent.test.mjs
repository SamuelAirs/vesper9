import test from "node:test";
import assert from "node:assert/strict";
import { Descent } from "../web/apps/descent.js";
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

test("an idle newcomer on site 1 has about fifteen seconds before the ground", () => {
  const app = new Descent(appContext({ seed: 3 }));
  launch(app);
  let t = 0;
  while (app.phase === "play" && t < 60) { app.update(1 / 60); t += 1 / 60; }
  assert.equal(app.phase, "crashed");
  assert.ok(t > 14, "fall took " + t.toFixed(1) + " s");
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
