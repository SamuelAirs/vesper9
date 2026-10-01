import test from "node:test";
import assert from "node:assert/strict";
import { appContext } from "./helpers/app-context.mjs";
import {
  Cadence, beatTime, tapTempo, tempoName, beatLamps, intervalState, intervalLamps, stopwatchLamps,
  formatHundredths, formatClock, bestLap, sanitize, clampBpm, SIGNATURES, PRESETS, LAMP_PATTERN,
} from "../web/apps/cadence.js";

const valid = (v) => v.length === 9 && v.every((n) => Number.isInteger(n) && n >= 0 && n <= 255);
const labels = (ctx) => ctx.currentActions.map((a) => a.label);
const choose = (ctx, text) => {
  const item = ctx.currentActions.find((a) => a.label.includes(text));
  assert.ok(item, `no action containing "${text}" in ${labels(ctx)}`);
  return item.run();
};
function open(options) {
  const ctx = appContext(options);
  const app = new Cadence(ctx);
  let t = 10000;
  app.clock = () => t;
  return { ctx, app, now: () => t, set: (v) => { t = v; }, advance: (ms) => { t += ms; app.frame(t); } };
}
// Raw button edges as the host forwards them to event().
const press = (app, at, heldMs, source = "node") => {
  app.event({ type: "button", pressed: true, source, at_us: at * 1000 });
  app.event({ type: "button", pressed: false, source, at_us: (at + heldMs) * 1000 });
};

test("beat times are start plus index times period, exactly", () => {
  assert.equal(beatTime(1000, 120, 0), 1000);
  assert.equal(beatTime(1000, 120, 500), 1000 + 250000);
  assert.equal(beatTime(0, 90, 3), 2000);
  assert.equal(beatTime(0, 120, 4, 2), 1000); // anchored at beat 2
  assert.ok(Number.isFinite(beatTime(NaN, NaN, NaN)));
});

test("500 beats at 120 BPM: the schedule has no drift and clicks land within a frame, with irregular frames", () => {
  const { ctx, app, set } = open();
  choose(ctx, "METRONOME");
  app.bpm = 120;
  const t0 = 50000;
  set(t0);
  const fired = [];
  const tones = ctx.calls.tone.length;
  choose(ctx, "START"); // sounds beat 0 at once
  fired.push({ ...app.lastBeat });
  let seed = 12345;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  let t = t0, maxGap = 0;
  const beatsWanted = 500;
  let lastCount = ctx.calls.tone.length;
  assert.equal(lastCount - tones, 1);
  while (t < t0 + beatsWanted * 500 + 100) {
    // irregular frames: mostly 16 ms, sometimes 5 ms, sometimes a 45 ms hitch
    const r = rnd();
    const gap = r < 0.1 ? 45 : r < 0.3 ? 5 + rnd() * 10 : 14 + rnd() * 6;
    maxGap = Math.max(maxGap, gap);
    t += gap;
    set(t);
    app.frame(t);
    if (ctx.calls.tone.length > lastCount) {
      lastCount = ctx.calls.tone.length;
      fired.push({ ...app.lastBeat });
    }
  }
  assert.equal(ctx.calls.tone.length - tones, fired.length);
  assert.ok(fired.length >= 500, "fired " + fired.length);
  for (const b of fired.slice(0, 500)) {
    // the due time the app computed is the ideal one to well under a millisecond
    assert.ok(Math.abs(b.due - (t0 + b.n * 500)) < 0.001, `beat ${b.n} due ${b.due}`);
    // and the click was sounded within one (worst-case) frame of it, never before the lead
    assert.ok(b.at - b.due <= maxGap + 0.001 && b.at - b.due >= -8.001, `beat ${b.n} lateness ${b.at - b.due}`);
  }
  assert.deepEqual(fired.slice(0, 500).map((b) => b.n), Array.from({ length: 500 }, (_, i) => i), "no beat skipped or doubled");
  assert.ok(Math.abs(app.lastBeat.due - (t0 + app.lastBeat.n * 500)) < 0.001);
  // 500th beat (index 499) lands at exactly t0 + 249500
  const b499 = fired.find((b) => b.n === 499);
  assert.ok(Math.abs(b499.due - (t0 + 249500)) < 0.001);
});

test("accent: first beat of the bar is the higher click, for every signature", () => {
  for (const sig of SIGNATURES) {
    const { ctx, app, set } = open();
    choose(ctx, "METRONOME");
    app.sig = sig; app.bpm = 120;
    set(1000);
    choose(ctx, "START");
    for (let t = 1000; t <= 1000 + sig * 2 * 500 - 100; t += 16) { set(t); app.frame(t); }
    const hz = ctx.calls.tone.map((c) => c[0]);
    assert.equal(hz.length, sig * 2, "sig " + sig);
    hz.forEach((f, i) => assert.equal(f, i % sig === 0 ? 1760 : 1175, `sig ${sig} beat ${i}`));
  }
});

test("a tempo change keeps the beat phase and the new period applies from the last beat", () => {
  const { ctx, app, set } = open();
  choose(ctx, "METRONOME");
  app.bpm = 120; set(0); choose(ctx, "START");
  for (let t = 0; t <= 1100; t += 10) { set(t); app.frame(t); } // beats 0,1,2 at 0,500,1000
  choose(ctx, "FASTER +5");
  assert.equal(app.bpm, 125);
  assert.equal(app.m.n0, 2);
  assert.equal(app.m.t0, 1000);
  assert.ok(Math.abs(beatTime(app.m.t0, app.bpm, 3, app.m.n0) - 1480) < 0.001);
});

test("a page that stops delivering frames does not machine-gun clicks afterwards", () => {
  const { ctx, app, set } = open();
  choose(ctx, "METRONOME");
  app.bpm = 120; set(0); choose(ctx, "START");
  app.frame(0);
  const before = ctx.calls.tone.length;
  set(60000); app.frame(60000); // a minute with no frames
  assert.ok(ctx.calls.tone.length - before <= 2);
  // and the beat count resumes on the grid
  assert.ok(Math.abs(app.m.lastDue % 500) < 0.001);
});

test("tap tempo: pure function and bounds", () => {
  assert.equal(tapTempo([]), null);
  assert.equal(tapTempo([0]), null);
  assert.equal(tapTempo([0, 500]), 120);
  assert.equal(tapTempo([0, 500, 1000, 1500, 2000]), 120);
  assert.equal(tapTempo([0, 600, 1200]), 100);
  assert.equal(tapTempo([0, 100, 200]), 220); // clamped
  assert.equal(tapTempo([0, 5000]), 40);
  assert.equal(tapTempo([0, 480, 1010, 1500, 1990, 2500]), tapTempo([480, 1010, 1500, 1990, 2500]), "only the last five taps count");
  assert.equal(tapTempo([NaN, 0, 500]), 120);
  assert.equal(clampBpm(NaN), 120);
});

test("tap tempo from raw button edges, with jittery taps, a restart after a pause and holds not counted", () => {
  const { ctx, app } = open();
  choose(ctx, "METRONOME");
  choose(ctx, "TAP TEMPO");
  assert.deepEqual(labels(ctx), ["DONE"]);
  let t = 100000;
  for (const jitter of [0, 8, -6, 5, -9, 4]) { press(app, t + jitter, 90); t += 461; } // ~130 BPM
  assert.ok(Math.abs(app.bpm - 130) <= 3, "bpm " + app.bpm);
  const tapped = app.bpm;
  press(app, t + 5000, 900); // a hold is a choice, not a tap
  assert.equal(app.bpm, tapped);
  assert.equal(app.tap.times.length, 5);
  press(app, t + 9000, 80); press(app, t + 9000 + 750, 80); // long pause restarts, 80 BPM
  assert.equal(app.bpm, 80);
  press(app, t + 9000 + 750 + 50, 80); // bounce ignored
  assert.equal(app.bpm, 80);
  choose(ctx, "DONE");
  assert.ok(labels(ctx).includes("START"));
  assert.equal(ctx.calls.saved.at(-1).bpm, 80);
});

test("tap tempo changes a running metronome without stopping it", () => {
  const { ctx, app, set } = open();
  choose(ctx, "METRONOME"); app.bpm = 100; set(0); choose(ctx, "START");
  assert.equal(labels(ctx)[0], "STOP");
  choose(ctx, "TAP TEMPO");
  assert.ok(app.m.running);
  press(app, 1000, 60); press(app, 1400, 60);
  assert.equal(app.bpm, 150);
  assert.ok(app.m.running);
});

test("tap edges are ignored while the system menu is open and when no tap screen is showing", () => {
  const { ctx, app } = open();
  choose(ctx, "METRONOME");
  press(app, 1000, 50); press(app, 1400, 50);
  assert.equal(app.tap.times.length, 0);
  choose(ctx, "TAP TEMPO");
  app.pause();
  press(app, 2000, 50); press(app, 2400, 50);
  assert.equal(app.tap.times.length, 0);
  app.resume();
  app.event({ type: "button", pressed: false, source: "node", at_us: 5e6 }); // stray release
  assert.equal(app.tap.times.length, 0);
});

test("lamp patterns: every signature has a readable bar, accent is amber and brightest", () => {
  for (const sig of SIGNATURES) {
    assert.equal(LAMP_PATTERN[sig].length, sig);
    for (let b = 0; b < sig; b++) for (const since of [0, 30, 200, 5000]) {
      const v = beatLamps(sig, b, since);
      assert.ok(valid(v), `${sig} ${b} ${since}`);
      const lit = [0, 1, 2].filter((i) => Math.max(...v.slice(i * 3, i * 3 + 3)) > 0);
      assert.deepEqual(lit, [LAMP_PATTERN[sig][b]]);
      assert.ok(Math.max(...v) <= 0.76 * 255 + 1);
      if (since >= 500) assert.ok(Math.max(...v) <= 0.34 * 255 + 1, "sustained light stays under a third");
    }
    const acc = beatLamps(sig, 0, 0), norm = beatLamps(sig, 1, 0);
    const [r, g, b] = acc.slice(LAMP_PATTERN[sig][0] * 3, LAMP_PATTERN[sig][0] * 3 + 3);
    assert.ok(r > 150 && g > 50 && r > g * 1.5 && b === 0, "accent is amber");
    const [nr, ng] = norm.slice(LAMP_PATTERN[sig][1] * 3, LAMP_PATTERN[sig][1] * 3 + 3);
    assert.ok(ng > nr, "ordinary beats are green");
    assert.ok(Math.max(...acc) > Math.max(...norm));
  }
  assert.deepEqual(LAMP_PATTERN[3], [0, 1, 2]);
  assert.ok(valid(beatLamps(NaN, NaN, NaN)));
  assert.deepEqual(beatLamps(4, 0, -5), Array(9).fill(0));
});

test("interval state machine: rounds, rests, no rest after the last round, done", () => {
  const cfg = { work: 20, rest: 10, rounds: 3 };
  assert.equal(intervalState(cfg, 0).phase, "work");
  assert.equal(intervalState(cfg, 0).remaining, 20);
  assert.equal(intervalState(cfg, 19.5).remaining, 0.5);
  const r = intervalState(cfg, 20);
  assert.deepEqual([r.phase, r.round, r.remaining], ["rest", 1, 10]);
  assert.deepEqual([intervalState(cfg, 30).phase, intervalState(cfg, 30).round], ["work", 2]);
  assert.deepEqual([intervalState(cfg, 70).phase, intervalState(cfg, 70).round], ["work", 3]);
  assert.equal(intervalState(cfg, 79.9).phase, "work");
  assert.equal(intervalState(cfg, 80).phase, "done");
  assert.equal(intervalState(cfg, 80).total, 80);
  assert.equal(intervalState({ work: 5, rest: 5, rounds: 1 }, 5).phase, "done");
  for (const bad of [NaN, -3, Infinity]) assert.ok(["work", "done"].includes(intervalState(cfg, bad).phase));
  assert.equal(intervalState(null, 1).phase, "work");
});

test("interval lamps: bar drains across the lamps, green work, cyan rest, amber at the end", () => {
  const cfg = { work: 60, rest: 30, rounds: 2 };
  const at = (s, since = 9999) => intervalLamps(intervalState(cfg, s), since, 0);
  const full = at(0), half = at(30), low = at(55);
  assert.ok(valid(full) && valid(half) && valid(low));
  assert.ok(full[1] > 0 && full[4] > 0 && full[7] > 0, "all three lit at the start of work");
  assert.ok(full[1] > full[0] && full[1] > full[2], "work is green");
  assert.ok(half[7] === 0 && half[1] > 0 && half[4] > 0, "right lamp out by half");
  assert.ok(low[4] === 0 && low[7] === 0 && low[0] + low[1] > 0, "only the left lamp near the end");
  const rest = at(60);
  assert.ok(rest[2] > 0 && rest[0] === 0 && rest[1] > 0, "rest is cyan");
  const amber = at(57);
  assert.ok(amber[0] > amber[1] && amber[1] > 0, "amber in the last seconds");
  let drained = 3;
  for (let s = 0; s < 55; s += 0.5) {
    const v = at(s), sum = (i) => v[i * 3] + v[i * 3 + 1] + v[i * 3 + 2];
    assert.ok(sum(0) >= sum(1) - 1 && sum(1) >= sum(2) - 1, "lamps go out right to left at " + s);
    drained = Math.min(drained, sum(0) > 0 ? 3 : 0);
    assert.ok(Math.max(...v) <= 0.34 * 255 + 1, "sustained under a third");
  }
  assert.ok(Math.max(...at(0, 10)) > Math.max(...full), "flash at a change");
  assert.ok(valid(intervalLamps({ phase: "done" }, 0, 2)));
  assert.deepEqual(intervalLamps({ phase: "done" }, 0, 20), Array(9).fill(0));
  assert.ok(valid(intervalLamps(null, 0, 0)));
});

test("an interval session runs through every period with a distinct tone at each change and the end", () => {
  const { ctx, app, set } = open();
  choose(ctx, "INTERVALS");
  choose(ctx, "CUSTOM SETUP");
  // cycle work 45 -> 60? set directly through the chooser until it reads 10 S
  while (!labels(ctx).includes("WORK / 10 S")) choose(ctx, "WORK");
  while (!labels(ctx).includes("REST / 5 S")) choose(ctx, "REST");
  while (!labels(ctx).includes("ROUNDS / 2")) choose(ctx, "ROUNDS");
  choose(ctx, "DONE");
  assert.equal(ctx.calls.saved.at(-1).custom.work, 10);
  set(0); choose(ctx, "START");
  assert.deepEqual(labels(ctx), ["PAUSE", "STOP"]);
  const seen = [];
  for (let t = 0; t <= 26000; t += 16) {
    set(t); app.frame(t);
    const st = intervalState(app.iv.cfg, app.ivSeconds(t));
    if (!seen.length || seen.at(-1) !== st.key) seen.push(st.key);
  }
  assert.deepEqual(seen, ["w1", "r1", "w2", "done"]);
  assert.equal(app.iv.running, false);
  assert.deepEqual(labels(ctx), ["FINISHED / CLEAR"]);
  const hz = ctx.calls.tone.map((c) => c[0]);
  assert.ok(hz.includes(1320), "end chord");
  assert.ok(hz.filter((f) => f === 880).length >= 3, "countdown beeps in the last seconds");
  // work-start (660->990), rest-start (990->660) and the end (660,880,1320) differ
  const first = hz.slice(0, 2), rest = hz.slice(hz.indexOf(990, 2), hz.indexOf(990, 2) + 2);
  assert.deepEqual(first, [660, 990]);
  assert.deepEqual(rest, [990, 660]);
});

test("intervals: pause freezes the clock; a menu does not stop the schedule; presets cycle", () => {
  const { ctx, app, set } = open();
  choose(ctx, "INTERVALS");
  assert.ok(labels(ctx).some((l) => l.includes("PRESET / FOCUS")));
  choose(ctx, "PRESET"); choose(ctx, "PRESET");
  assert.ok(labels(ctx).some((l) => l.includes("PRESET / MINUTE")));
  choose(ctx, "PRESET");
  assert.ok(labels(ctx).some((l) => l.includes("PRESET / CUSTOM")));
  choose(ctx, "PRESET"); choose(ctx, "PRESET");
  assert.ok(labels(ctx).some((l) => l.includes("PRESET / TABATA")));
  set(0); choose(ctx, "START");
  set(5000); app.frame(5000);
  choose(ctx, "PAUSE");
  set(20000); app.frame(20000);
  assert.ok(Math.abs(app.ivSeconds(20000) - 5) < 0.01);
  choose(ctx, "RESUME");
  set(23000); app.frame(23000);
  assert.ok(Math.abs(app.ivSeconds(23000) - 8) < 0.01);
  // system menu: time still passes, but the lamps are not written
  app.pause();
  const n = ctx.calls.leds.length;
  set(25000); app.frame(25000);
  assert.equal(ctx.calls.leds.length, n, "no lamp writes while the menu is open");
  assert.ok(Math.abs(app.ivSeconds(25000) - 10) < 0.01);
  app.resume();
  assert.ok(ctx.calls.leds.length > n, "lamps come back on resume");
  assert.equal(PRESETS.length, 3);
});

test("stopwatch: laps stamped at the press, best lap marked, stop at the press, resume and reset", () => {
  const { ctx, app, set } = open();
  choose(ctx, "STOPWATCH");
  assert.deepEqual(labels(ctx), ["START", "BACK"]);
  set(1000); choose(ctx, "START");
  assert.deepEqual(labels(ctx), ["STOP"]);
  // laps at 3.0 s, 5.5 s, 9.0 s after the start; the press happens at `at`, the release 80 ms later
  for (const at of [4000, 6500, 10000]) {
    set(at); app.event({ type: "button", pressed: true, source: "keyboard" });
    set(at + 80); app.event({ type: "button", pressed: false, source: "keyboard" });
  }
  assert.deepEqual(app.sw.laps.map((l) => l.total), [3000, 5500, 9000]);
  assert.deepEqual(app.sw.laps.map((l) => l.split), [3000, 2500, 3500]);
  assert.equal(bestLap(app.sw.laps), 1);
  app.frame(now(app));
  const html = ctx.calls.content.at(-1);
  assert.match(html, /LAP 2 BEST/);
  assert.match(html, /00:03\.50/);
  // a hold stops the watch at the moment of the press
  set(12000); app.event({ type: "button", pressed: true, source: "keyboard" });
  set(12700); choose(ctx, "STOP"); app.event({ type: "button", pressed: false, source: "keyboard" });
  assert.equal(app.swElapsed(20000), 11000);
  assert.equal(app.sw.laps.length, 3, "the hold was not a lap");
  assert.deepEqual(labels(ctx), ["RESUME", "RESET", "BACK"]);
  set(30000); app.frame(30000);
  assert.equal(app.swElapsed(30000), 11000, "stopped watch holds still");
  choose(ctx, "RESUME");
  assert.ok(Math.abs(app.swElapsed(32000) - 13000) < 1);
  app.sw.running = false; app.sw.before = 13000; app.build();
  choose(ctx, "RESET");
  assert.equal(app.swElapsed(), 0);
  assert.equal(app.sw.laps.length, 0);
  function now(a) { return a.clock(); }
});

test("stopwatch keeps counting while the system menu is open and the lap list is bounded", () => {
  const { ctx, app, set } = open();
  choose(ctx, "STOPWATCH"); set(0); choose(ctx, "START");
  app.pause();
  set(65432); app.tick();
  assert.equal(app.swElapsed(65432), 65432);
  app.resume();
  for (let i = 0; i < 300; i++) { set(70000 + i * 300); app.lap(app.clock()); }
  assert.equal(app.sw.laps.length, 200);
  assert.ok(valid(stopwatchLamps(1234, 100, true)));
  assert.ok(Math.max(...stopwatchLamps(1234, 9999, true)) <= 0.34 * 255 + 1);
  assert.ok(Math.max(...stopwatchLamps(1234, 0, true)) > Math.max(...stopwatchLamps(1234, 9999, true)), "lap flash");
  assert.deepEqual(stopwatchLamps(0, NaN, false), Array(9).fill(0));
  // the sweep moves
  assert.notDeepEqual(stopwatchLamps(0, 9999, true), stopwatchLamps(1000, 9999, true));
});

test("formatting", () => {
  assert.equal(formatHundredths(0), "00:00.00");
  assert.equal(formatHundredths(61234), "01:01.23");
  assert.equal(formatHundredths(NaN), "00:00.00");
  assert.equal(formatClock(90), "01:30");
  assert.equal(formatClock(0.2), "00:01");
  assert.equal(formatClock(0), "00:00");
  assert.equal(tempoName(40), "LARGO");
  assert.equal(tempoName(120), "ALLEGRO");
  assert.equal(tempoName(220), "PRESTISSIMO");
});

test("every action on every screen runs without throwing and lamps are always nine bytes", () => {
  const { ctx, app, set, now } = open();
  const visit = (depth) => {
    if (depth > 3) return;
    for (const item of [...ctx.currentActions]) {
      if (/RETURN TO DASHBOARD|STOP|FINISHED/.test(item.label)) continue;
      item.run();
      set(now() + 137); app.frame(now());
      assert.ok(valid(ctx.calls.leds.at(-1) || Array(9).fill(0)));
      const html = ctx.calls.content.at(-1);
      assert.ok(typeof html === "string" && !/undefined|NaN/.test(html), html);
      visit(depth + 1);
    }
  };
  for (const tool of ["METRONOME", "STOPWATCH", "INTERVALS"]) {
    // return to the tool list between tools
    if (!labels(ctx).includes(tool)) { for (const k of ["STOP", "FINISHED / CLEAR", "BACK"]) { const x = ctx.currentActions.find((a) => a.label === k); if (x) x.run(); } }
    choose(ctx, tool);
    visit(1);
    app.m.running = false; app.sw.running = false; app.iv.running = false; app.iv.paused = false; app.iv.doneAt = -1;
    app.tool = "menu"; app.build();
  }
  app.cancel(); app.pause(); app.resume();
  for (const bad of [null, {}, { type: "button" }, { type: "sensor" }, { type: "button", pressed: false }]) app.event(bad);
  assert.ok(ctx.calls.leds.every(valid));
  assert.ok(ctx.calls.content.every((h) => !/NaN|undefined/.test(h)));
});

test("preferences survive a save/restore round trip", () => {
  const a = open();
  choose(a.ctx, "METRONOME");
  choose(a.ctx, "FASTER +5"); choose(a.ctx, "FASTER +5");
  choose(a.ctx, "BEATS"); // 4 -> 6
  choose(a.ctx, "BACK");
  choose(a.ctx, "INTERVALS");
  choose(a.ctx, "PRESET");
  const saved = JSON.parse(JSON.stringify(a.ctx.calls.saved.at(-1)));
  assert.equal(saved.bpm, 110);
  assert.equal(saved.sig, 6);
  assert.equal(saved.preset, "tabata");
  assert.ok(JSON.stringify(saved).length < 8192);
  const b = open({ progress: saved });
  assert.equal(b.app.bpm, 110);
  assert.equal(b.app.sig, 6);
  assert.equal(b.app.preset, "tabata");
  assert.equal(b.app.lastTool, "int");
  assert.equal(labels(b.ctx)[0], "INTERVALS", "last-used tool is first");
  // garbage progress is repaired
  for (const junk of [null, 5, "x", { bpm: "fast", sig: 5, preset: "zzz", custom: { work: 7 } }, { bpm: 9999 }]) {
    const s = sanitize(junk);
    assert.ok(s.bpm >= 40 && s.bpm <= 220 && SIGNATURES.includes(s.sig));
    assert.doesNotThrow(() => new Cadence(appContext({ progress: junk })));
  }
  assert.equal(sanitize({ bpm: 9999 }).bpm, 220);
});

test("dispose leaves the lamps off and nothing running; the frame loop does not touch lamps afterwards", () => {
  const { ctx, app, set } = open();
  choose(ctx, "METRONOME"); set(0); choose(ctx, "START");
  for (let t = 0; t < 1000; t += 16) { set(t); app.frame(t); }
  assert.ok(ctx.calls.leds.some((v) => v.some((n) => n > 0)));
  app.dispose();
  assert.deepEqual(ctx.calls.leds.at(-1), Array(9).fill(0));
  assert.equal(app.m.running, false);
  const tones = ctx.calls.tone.length;
  app.tick(); app.event({ type: "button", pressed: true, source: "node", at_us: 1 });
  assert.equal(ctx.calls.tone.length, tones);
});

test("three stray taps and a cancel do not disturb a running stopwatch or metronome", () => {
  const { ctx, app, set } = open();
  choose(ctx, "STOPWATCH"); set(0); choose(ctx, "START");
  app.event({ type: "button", pressed: true, source: "node", at_us: 1e6 });
  app.cancel();
  for (let i = 0; i < 3; i++) press(app, 2000 + i * 200, 60);
  assert.ok(app.sw.running);
  assert.equal(app.sw.laps.length, 3);
  app.pause(); app.resume();
  assert.ok(app.sw.running);
});
