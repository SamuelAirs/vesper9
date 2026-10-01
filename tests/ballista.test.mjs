import test from "node:test";
import assert from "node:assert/strict";
import {
  Ballista, buildStation, flightTick, launchProbe, robustShot, hitsTarget, sweepAngle, powerAt,
  RISE, MIN_HOLD, SWEEP,
} from "../web/apps/ballista.js";
import { Random } from "../web/engine/math.js";
import { appContext, fakeCanvas, run } from "./helpers/app-context.mjs";

const F = 1 / 60;
const MAX_STEPS = 60 * 60 * 15; // fifteen simulated minutes

// A bot that plays like a careful human: it reads the wind and the target, picks the press
// moment and hold length that hit with the most room for error, then adds timing jitter.
function plan(app) {
  const s = app.site, ti = s.targets.findIndex((t) => !t.hit);
  const tryShot = (d, h) => {
    const p = s.fixedPower || h / (RISE * 60);
    if (h < 11 || p > 1) return false;
    return hitsTarget(s, ti, sweepAngle(s, app.sweepT + d * F), p, app.wind, app.st + (d + h) * F);
  };
  let any = null;
  for (let d = 0; d <= Math.ceil(SWEEP * 60); d += 2) {
    const hs = s.fixedPower ? [Math.ceil(RISE * 60)] : Array.from({ length: 30 }, (_, i) => Math.round((0.1 + 0.03 * i) * RISE * 60));
    for (const h of hs) {
      if (!tryShot(d, h)) continue;
      const solid = s.fixedPower
        ? tryShot(d - 1, h) && tryShot(d + 1, h)
        : tryShot(d, h - 2) && tryShot(d, h + 2) && tryShot(d - 1, h) && tryShot(d + 1, h);
      if (solid) return { d, h };
      any ||= { d, h };
    }
  }
  return any;
}

// A press and release, as the host sends them.
const tapButton = (app) => { app.down({ source: "keyboard" }); app.up({ source: "keyboard", durationMs: 60 }); };

function play(options = {}) {
  const ctx = appContext({ seed: options.seed ?? 7 });
  const app = new Ballista(ctx);
  const mode = options.mode || "bot";
  const jitter = new Random((options.seed ?? 7) * 31 + 5);
  const jd = options.jd ?? Number(process.env.BALLISTA_JD ?? 3), jh = options.jh ?? Number(process.env.BALLISTA_JH ?? 5);
  let steps = 0, pending = null, wait = 0, holding = 0, idle = 0;
  const press = () => app.down({ source: "keyboard" });
  const release = (ms) => app.up({ source: "keyboard", durationMs: ms });
  press();
  release(60);
  while (steps < (options.max ?? MAX_STEPS) && app.phase !== "over") {
    steps++;
    if (app.phase === "play") {
      idle = 0;
      if (mode === "bot" && !app.flight && !app.charging) {
        if (!pending) {
          pending = plan(app) || { d: jitter.int(0, 200), h: jitter.int(15, 90) };
          pending = { d: Math.max(0, pending.d + jitter.int(-jd, jd)), h: Math.max(12, pending.h + jitter.int(-jh, jh)) };
          wait = pending.d;
        }
        if (wait === 0 && !app.btn) { press(); holding = pending.h; }
        else if (wait > 0) wait--;
      } else if (mode === "random" && !app.flight && !app.charging && !app.btn && steps % 90 === 0) {
        press();
        holding = jitter.int(15, 200);
      } else if (mode === "taps" && !app.btn && steps % 30 === 0) {
        press();
        holding = 4;
      }
      if (app.btn) {
        holding--;
        if (holding <= 0) { release(100); pending = null; }
      }
    } else {
      if (app.btn) release(50);
      pending = null;
      idle++;
      if (app.phase !== "brief" && idle > 120) { press(); release(50); idle = 0; }
    }
    app.update(F);
    if (options.onStep) options.onStep(app, ctx);
    if (options.stopAtStation && app.stationNo > options.stopAtStation) break;
  }
  return { app, ctx, steps };
}

test("generated stations are always solvable, across seeds and station numbers", () => {
  let fallbacks = 0, worstMs = 0, count = 0;
  for (const seed of [1, 2]) { // two seeds of 30 stations: trimmed from three to keep the suite quick
    const rng = new Random(seed);
    for (let no = 1; no <= 30; no++) {
      const t0 = Date.now();
      const s = buildStation(no, rng);
      worstMs = Math.max(worstMs, Date.now() - t0);
      count++;
      if (s.fallback) fallbacks++;
      // a finer proof than the one used to build it: nine winds and four phases of any moving target
      const winds = s.windA ? [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1].map((k) => k * s.windA) : [0];
      s.targets.forEach((tg, ti) => {
        for (const w of winds) {
          for (const ph of tg.amp ? [0, 1.5, 3, 4.5] : [0]) {
            assert.ok(robustShot(s, ti, w, ph), `seed ${seed} station ${no} target ${ti} wind ${w} phase ${ph}`);
          }
        }
        assert.ok(tg.cx - tg.amp > 250 && tg.cx + tg.amp + tg.r < 940);
      });
    }
  }
  assert.equal(count, 60);
  assert.equal(fallbacks, 0);
  assert.ok(worstMs < 1500, "worst build " + worstMs + " ms");
});

test("station 1 teaches power (any angle in its sweep works); station 2 teaches angle with preset power", () => {
  for (const seed of [4, 5, 6]) {
    const s1 = buildStation(1, new Random(seed));
    assert.equal(s1.windA, 0);
    assert.ok(s1.aHi - s1.aLo <= 10 && s1.targets[0].r >= 50);
    for (let a = s1.aLo + 0.5; a < s1.aHi; a += 1) {
      assert.ok(robustShot({ ...s1, aLo: a - 0.5, aHi: a + 0.5 }, 0, 0, 0, 1), "angle " + a);
    }
    const s2 = buildStation(2, new Random(seed));
    assert.ok(s2.fixedPower > 0 && s2.windA === 0 && s2.aHi - s2.aLo >= 60);
    // whatever the hold past the preset, the power stays at the preset, so only the angle is a decision
    assert.equal(powerAt(RISE * 3, s2.fixedPower), s2.fixedPower);
    assert.equal(powerAt(RISE * 5, s2.fixedPower), s2.fixedPower);
    const wins = [];
    for (let a = s2.aLo; a <= s2.aHi; a += 0.5) if (hitsTarget(s2, 0, a, s2.fixedPower, 0, 0)) wins.push(a);
    assert.ok(wins.length > 0 && wins.length < (s2.aHi - s2.aLo) * 1.4, "the angle matters: " + wins.length);
  }
});

test("the power meter peaks and falls, so holding too long is not best", () => {
  assert.equal(powerAt(0), 0);
  assert.ok(Math.abs(powerAt(RISE) - 1) < 1e-9);
  assert.ok(powerAt(RISE * 1.5) < powerAt(RISE * 1.1) && powerAt(RISE * 1.1) < 1);
  assert.ok(powerAt(RISE * 2 - 0.01) < 0.02);
});

test("physics is exact at the fixed step: constant gravity, wind as a constant acceleration", () => {
  const s = { ...buildStation(1, new Random(1)), targets: [] };
  s.g = 300;
  const pr = launchProbe(s, 50, 0.6, 20);
  const { x, y, vx, vy } = pr;
  const N = 90;
  for (let i = 0; i < N; i++) assert.ok(flightTick(s, pr, 0, -1) <= 2);
  assert.ok(Math.abs(pr.vx - (vx + 20 * N * F)) < 1e-9 && Math.abs(pr.vy - (vy - 300 * N * F)) < 1e-9);
  let ex = x, ey = y, evx = vx, evy = vy;
  for (let i = 0; i < N; i++) { evx += 20 * F; ex += evx * F; evy -= 300 * F; ey += evy * F; }
  assert.ok(Math.abs(pr.x - ex) < 1e-6 && Math.abs(pr.y - ey) < 1e-6);
});

test("a competent bot clears many stations and scores far above random shots", () => {
  const rows = [];
  for (const seed of [3, 7, 11, 19]) {
    const good = play({ seed });
    const random = play({ seed, mode: "random" });
    rows.push([seed, good.app.total, good.app.cleared, good.app.shots, good.app.hits, good.app.phase, random.app.total, random.app.cleared]);
    assert.ok(good.app.cleared >= 10, `seed ${seed} stations ${good.app.cleared}`);
    assert.ok(good.app.total > 3 * Math.max(1, random.app.total), `seed ${seed} ${good.app.total} vs ${random.app.total}`);
    assert.equal(random.app.phase, "over", "random shots end the run");
  }
  if (process.env.BALLISTA_REPORT) console.log(JSON.stringify(rows));
});

test("the first stations are learnable: a sloppy bot still clears stations 1 to 3", () => {
  for (const seed of [5, 9]) {
    const { app } = play({ seed, stopAtStation: 3 });
    assert.ok(app.stationNo > 3 && app.phase !== "over", `seed ${seed}`);
  }
});

test("a run ends in a loss with a saved record", () => {
  const { app, ctx } = play({ mode: "random", seed: 2 });
  assert.equal(app.phase, "over");
  assert.equal(ctx.calls.saved.length, 1);
  const last = ctx.calls.saved[0].last;
  assert.equal(last.score, app.total);
  assert.equal(typeof last.stations, "number");
  assert.ok(ctx.calls.hint.length > 3);
});

test("stray quick taps all run long never end the run", () => {
  const { app } = play({ mode: "taps", seed: 3, max: 60 * 120 });
  assert.equal(app.phase, "play");
  assert.equal(app.shots, 0);
});

test("numeric state stays finite, lists stay bounded, lamps are nine whole bytes that change", () => {
  const seen = new Set();
  const { ctx } = play({
    seed: 23,
    onStep(app, c) {
      for (const v of [app.wind, app.hold, app.power, app.st, app.total, app.angle]) assert.ok(Number.isFinite(v));
      if (app.flight) for (const v of [app.flight.x, app.flight.y, app.flight.vx, app.flight.vy]) assert.ok(Number.isFinite(v));
      assert.ok(app.traces.length === 3 && app.traces.every((t) => t.n <= 400));
      assert.ok(app.sfx.length <= 12 && app.site.targets.length <= 3 && app.site.bumps.length <= 3);
      const l = c.calls.leds.at(-1);
      if (l) seen.add(l.join(","));
    },
  });
  for (const v of ctx.calls.leds) {
    assert.equal(v.length, 9);
    for (const c of v) assert.ok(Number.isInteger(c) && c >= 0 && c <= 255);
  }
  assert.ok(seen.size > 40, "lamps change during play: " + seen.size);
});

function started(seed = 1) {
  const ctx = appContext({ seed });
  const app = new Ballista(ctx);
  app.down(); app.up();
  run(app, 3);
  assert.equal(app.phase, "play");
  return { ctx, app };
}
const lastLeds = (ctx) => ctx.calls.leds.at(-1);
const sum = (v) => v.reduce((a, b) => a + b, 0);

test("short taps launch nothing and cost nothing; three stray taps then cancel() leave the run intact", () => {
  const { ctx, app } = started(3);
  const probes = app.probes;
  for (let i = 0; i < 3; i++) {
    app.down({ source: "node" });
    run(app, 0.05);
    app.up({ source: "node", durationMs: 50 });
    run(app, 0.2);
  }
  assert.equal(app.shots, 0);
  assert.equal(app.probes, probes);
  assert.equal(app.flight, null);
  // the fourth tap opens the menu: the host then cancels
  app.down({ source: "node" });
  app.cancel();
  assert.equal(app.phase, "play");
  assert.equal(app.probes, probes);
  assert.equal(app.shots, 0);
  const tones = ctx.calls.tone.length;
  // a hold past the threshold does launch
  app.down();
  run(app, MIN_HOLD + 0.05);
  app.up();
  assert.equal(app.shots, 1);
  assert.equal(app.probes, probes - 1);
  assert.ok(ctx.calls.tone.length > tones);
});

test("the press fixes the angle where the sweep is at that instant", () => {
  const { app } = started(4);
  run(app, 0.7);
  const expect = sweepAngle(app.site, app.sweepT);
  app.down();
  assert.ok(Math.abs(app.angle - expect) < 1e-9);
  const locked = app.angle;
  run(app, 1);
  assert.equal(app.angle, locked);
  app.up();
  assert.ok(Math.abs(app.last.angle - locked) < 1e-9);
});

test("lamps while aiming: a spot of light follows the sweep from left to right", () => {
  const { ctx, app } = started(5);
  const centre = (l) => {
    const w = [l[0] + l[1] + l[2], l[3] + l[4] + l[5], l[6] + l[7] + l[8]];
    return (w[1] + 2 * w[2]) / Math.max(1, w[0] + w[1] + w[2]);
  };
  let lo = 9, hi = -9;
  for (let i = 0; i < SWEEP * 60; i++) {
    run(app, F);
    const c = centre(lastLeds(ctx));
    lo = Math.min(lo, c);
    hi = Math.max(hi, c);
  }
  assert.ok(lo < 0.3 && hi > 1.7, `spot travelled ${lo.toFixed(2)}..${hi.toFixed(2)}`);
});

test("lamps while charging fill green, amber, red from the left, then drain past the peak", () => {
  const { ctx, app } = started(6);
  assert.equal(app.site.fixedPower, 0);
  app.down();
  const to = (sec) => { run(app, sec - app.hold); return lastLeds(ctx); };
  let l = to(0.3);
  assert.ok(l[1] > l[0] * 2 && l[1] > 40 && sum(l.slice(3)) === 0, "first lamp green only: " + l);
  l = to(0.8);
  assert.ok(l[1] > 80 && l[3] > 40 && l[3] > l[4] && sum(l.slice(6)) === 0, "green and amber: " + l);
  l = to(RISE * 0.95);
  assert.ok(l[6] > 60 && l[6] > l[7] * 5 && l[3] > l[4], "all three, last one red: " + l);
  let flashed = false, peak = 0;
  for (let i = 0; i < 20; i++) { run(app, F); peak = Math.max(peak, sum(lastLeds(ctx))); if (app.flash > 0) flashed = true; }
  assert.ok(flashed && app.peaked, "the peak is marked");
  run(app, 0.4);
  let min = 1e9;
  for (let i = 0; i < 30; i++) { run(app, F); min = Math.min(min, sum(lastLeds(ctx))); }
  assert.ok(min < peak * 0.6, `the fill drains after the peak: ${min} vs ${peak}`);
  app.cancel();
});

function fireAt(app, shot) {
  const s = app.site;
  let guard = 0;
  while (Math.abs(sweepAngle(s, app.sweepT) - shot.angle) > 0.3 && guard++ < 2000) run(app, F);
  app.down();
  run(app, shot.power * RISE);
  app.up();
}

test("lamps in flight follow the probe toward the target; a hit flashes all three", () => {
  const { ctx, app } = started(8);
  const tg = app.site.targets[0];
  fireAt(app, robustShot(app.site, 0, 0, 0));
  assert.ok(app.flight);
  const positions = [];
  while (app.flight) {
    run(app, F);
    const l = lastLeds(ctx);
    positions.push((sum(l.slice(3, 6)) + 2 * sum(l.slice(6))) / Math.max(1, sum(l)));
  }
  assert.ok(positions[3] < 0.8 && positions.at(-3) > 1.2, `spot advances: ${positions[3]} -> ${positions.at(-3)}`);
  assert.equal(tg.hit, true, "the planned shot hit");
  let flashed = 0;
  for (let i = 0; i < 40; i++) {
    run(app, F);
    const l = lastLeds(ctx);
    if (sum(l.slice(0, 3)) > 0 && sum(l.slice(3, 6)) > 0 && sum(l.slice(6)) > 0) flashed++;
  }
  assert.ok(flashed > 15, "all three lamps lit on a hit");
});

test("a miss lights the left lamp when short and the right lamp when long", () => {
  for (const [power, side] of [[0.12, 0], [1, 2]]) {
    const { ctx, app } = started(9);
    app.angle = 45;
    app.charging = true;
    app.launch(power);
    while (app.flight) run(app, F);
    run(app, 0.1);
    assert.equal(app.last.kind, "miss");
    const l = lastLeds(ctx);
    const lit = [sum(l.slice(0, 3)), sum(l.slice(3, 6)), sum(l.slice(6))];
    assert.ok(lit[side] > 0 && lit[side] > lit[2 - side] * 3, `${side ? "long" : "short"} lamp: ${l}`);
    assert.equal(app.last.side, side ? 1 : -1);
  }
});

test("cancel() and dispose() mid-charge and mid-flight stop the tone and leave the lamps off", () => {
  for (const phase of ["charge", "flight"]) {
    const { ctx, app } = started(10);
    let stops = 0;
    ctx.synth.stopTone = () => stops++;
    app.down();
    run(app, 0.5);
    if (phase === "flight") { app.up(); run(app, 0.3); assert.ok(app.flight); }
    app.cancel();
    assert.equal(app.charging, false);
    assert.ok(stops >= 1);
    app.dispose();
    assert.deepEqual(lastLeds(ctx), Array(9).fill(0));
  }
});

test("spare probes carry into the next station", () => {
  const { app } = started(12);
  fireAt(app, robustShot(app.site, 0, 0, 0));
  while (app.flight) run(app, F);
  assert.equal(app.phase, "cleared");
  assert.ok(app.probes >= 3 && app.reserve === 2);
  run(app, 1.2);
  app.down(); app.up();
  assert.equal(app.stationNo, 2);
  assert.equal(app.probes, app.site.probes + 2);
});

test("draw runs in every state without throwing and within a bounded number of primitives", () => {
  const g = fakeCanvas();
  const { ctx, app } = started(14);
  app.draw(g);
  new Ballista(appContext({ seed: 2 })).draw(g);
  app.down(); run(app, 0.7); app.draw(g); app.up();
  for (let i = 0; i < 40; i++) { run(app, F); app.draw(g); }
  while (app.flight) run(app, F);
  app.draw(g);
  for (const phase of ["cleared", "failed", "over", "brief"]) { app.phase = phase; app.outcome = { why: "X" }; app.draw(g); }
  for (const phase of ["play", "brief"]) {
    app.phase = phase;
    const before = g.count.lineTo + g.count.moveTo + g.count.arc + g.count.fillText;
    app.draw(g);
    const frame = g.count.lineTo + g.count.moveTo + g.count.arc + g.count.fillText - before;
    assert.ok(frame < 400, phase + " frame primitives " + frame);
  }
  assert.ok(ctx.calls.hud.length > 0 && ctx.calls.hint.length > 0);
});

test("the next station is built a few steps per frame during play, never in one go", () => {
  const ctx = appContext({ seed: 12 });
  const app = new Ballista(ctx);
  tapButton(app); // title -> brief
  run(app, 3.2);
  assert.equal(app.phase, "play");
  assert.ok(app.job && app.job.n === 2, "station 2 is being built");
  let calls = 0, worst = 0, frames = 0;
  const it = app.job.it;
  const next = it.next.bind(it);
  it.next = () => { calls++; return next(); };
  while (!app.job.done && frames < 2000) {
    const before = calls;
    app.update(1 / 60);
    worst = Math.max(worst, calls - before);
    frames++;
  }
  assert.ok(app.job.done, "finished within " + frames + " frames");
  assert.ok(worst <= 4, "at most 4 generator steps in a frame during play: " + worst);
  assert.ok(app.job.site.targets.length >= 1 && app.job.site.attempts >= 1);
  assert.equal(app.phase, "play", "building does not disturb the station being played");
});

test("a brief waits for an unfinished build, shows that it is surveying, and then starts normally", () => {
  const ctx = appContext({ seed: 5 });
  const app = new Ballista(ctx);
  tapButton(app);
  run(app, 3.2);
  const g = fakeCanvas();
  // Force a clear of station 1 at once, before station 2 has had time to build.
  app.job = app.makeJob(2);
  app.phase = "cleared"; app.pt = 2;
  app.stationNo = 1;
  tapButton(app);
  assert.equal(app.stationNo, 2);
  assert.equal(app.phase, "brief");
  assert.ok(app.applyPending, "the station is not ready yet");
  app.draw(g);
  tapButton(app); // too early: cannot start play on a station that does not exist
  assert.equal(app.phase, "brief");
  let frames = 0;
  while (app.applyPending && frames < 3000) { app.update(1 / 60); frames++; }
  assert.ok(!app.applyPending);
  assert.match(ctx.calls.hint.at(-1), /STATION 2: /);
  assert.doesNotMatch(ctx.calls.hint.at(-1), /SURVEYING/, "the hint moves on to the briefing");
  assert.equal(app.site.n, 2);
  assert.ok(app.probes >= 3);
  app.draw(g);
  run(app, 3);
  assert.equal(app.phase, "play");
});

test("a run is reproducible: the same seed and the same inputs give the same stations", () => {
  const seq = (seed) => {
    const out = [];
    play({ seed, stopAtStation: 4, onStep: (app) => { if (app.site && out[out.length - 1] !== app.site.n + ":" + app.site.targets[0].cx.toFixed(2)) out.push(app.site.n + ":" + app.site.targets[0].cx.toFixed(2)); } });
    return out.join("|");
  };
  assert.equal(seq(31), seq(31));
  assert.notEqual(seq(31), seq(32));
});

test("pause() and cancel() switch the lamps off while aiming, charging and in flight", () => {
  for (const how of ["pause", "cancel"]) {
    const ctx = appContext({ seed: 9 });
    const app = new Ballista(ctx);
    tapButton(app);
    run(app, 3.3);
    assert.equal(app.phase, "play");
    assert.ok(ctx.calls.leds.at(-1).some((v) => v > 0), "aim spot is lit");
    app[how]();
    assert.deepEqual(ctx.calls.leds.at(-1), Array(9).fill(0), how + " while aiming");
    app.down({}); run(app, 0.5);
    assert.ok(ctx.calls.leds.at(-1).some((v) => v > 0), "charge is lit");
    app[how]();
    assert.deepEqual(ctx.calls.leds.at(-1), Array(9).fill(0), how + " while charging");
    assert.equal(app.charging, false);
  }
});
