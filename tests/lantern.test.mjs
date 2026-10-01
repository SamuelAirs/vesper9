import test from "node:test";
import assert from "node:assert/strict";
import { appContext } from "./helpers/app-context.mjs";
import { Hand } from "./helpers/pad.mjs";
import { Lantern, SCENES, COLOURS, SETS, LEVELS, SLEEP_MINUTES, sceneFrame, sleepFactor, sanitize } from "../web/apps/lantern.js";

const valid = (v) => v.length === 9 && v.every((n) => Number.isInteger(n) && n >= 0 && n <= 255);
const base = { scene: "steady", colour: 0, set: 0, level: 1, sunrise: 20, seed: 7 };
const peak = (v) => Math.max(...v);
const labels = (ctx) => ctx.currentActions.map((a) => a.label);
const choose = (ctx, text) => {
  const item = ctx.currentActions.find((a) => a.label.includes(text));
  assert.ok(item, `no action containing "${text}" in ${labels(ctx)}`);
  return item.run();
};
function open(options) {
  const ctx = appContext(options);
  const app = new Lantern(ctx);
  let t = 1000;
  app.clock = () => t;
  return { ctx, app, advance: (s) => { t += s * 1000; app.tick(); }, at: () => t };
}

test("scene frames are nine whole bytes for every scene, colour, level and time", () => {
  for (const scene of SCENES) for (let c = 0; c < COLOURS.length; c++) for (let l = 0; l < LEVELS.length; l++)
    for (const t of [0, 0.3, 5, 61, 599, 1800, 7200, 1e7]) {
      assert.ok(valid(sceneFrame(scene.id, { ...base, colour: c, level: l, set: c % SETS.length }, t)), `${scene.id} ${c} ${l} ${t}`);
    }
  for (const bad of [NaN, -5, Infinity, undefined, "x"]) assert.ok(valid(sceneFrame("candle", base, bad)));
  assert.ok(valid(sceneFrame("nonsense", base, 1)));
  assert.ok(valid(sceneFrame("aurora", null, 1)));
  assert.deepEqual(sceneFrame("nonsense", base, 1), Array(9).fill(0));
});

test("sustained light stays under a third of full and the lowest step is genuinely dim", () => {
  for (const scene of SCENES) for (let t = 0; t < 2000; t += 7)
    assert.ok(peak(sceneFrame(scene.id, { ...base, level: 3 }, t)) <= 0.34 * 255 + 1, scene.id);
  for (const scene of SCENES.filter((s) => s.id !== "sunrise")) for (let t = 0; t < 200; t += 3) {
    assert.ok(peak(sceneFrame(scene.id, { ...base, level: 0, colour: 2 }, t)) <= 8, scene.id + " night " + t);
  }
  assert.ok(peak(sceneFrame("steady", { ...base, level: 0 }, 0)) >= 3, "night is visible");
});

test("breathe swells, tide rolls left to right and back, aurora drifts, ember dims", () => {
  const sums = Array.from({ length: 80 }, (_, i) => sceneFrame("breathe", base, i / 10).reduce((a, b) => a + b));
  assert.ok(Math.max(...sums) > Math.min(...sums) * 2);
  const centre = (v) => (v[4] * 1 + v[7] * 2) / (v[1] + v[4] + v[7] + 1e-9);
  const start = { ...base, level: 3, colour: 3 };
  assert.ok(centre(sceneFrame("tide", start, 0)) < 0.3);
  assert.ok(centre(sceneFrame("tide", start, 8)) > 1.7);
  assert.ok(centre(sceneFrame("tide", start, 16)) < 0.3);
  assert.notDeepEqual(sceneFrame("aurora", base, 0), sceneFrame("aurora", base, 30));
  const lamps = sceneFrame("aurora", { ...base, level: 3 }, 12);
  assert.notDeepEqual(lamps.slice(0, 3), lamps.slice(6, 9));
  const emberStart = sceneFrame("ember", { ...base, level: 3 }, 0), emberEnd = sceneFrame("ember", { ...base, level: 3 }, 1800);
  assert.ok(peak(emberEnd) < peak(emberStart) * 0.4);
  assert.ok(sceneFrame("ember", { ...base, level: 3 }, 900)[0] < emberStart[0]);
});

test("candle is irregular but identical for the same seed, different for another", () => {
  const run = (seed) => Array.from({ length: 200 }, (_, i) => sceneFrame("candle", { ...base, level: 3, seed }, i / 10));
  const a = run(5);
  assert.deepEqual(a, run(5));
  assert.notDeepEqual(a, run(6));
  const reds = a.map((v) => v[0]);
  assert.ok(new Set(reds).size > 20, "flickers");
  assert.ok(Math.max(...reds) - Math.min(...reds) > 30);
  assert.ok(a.every((v) => v[0] > 0), "never goes out");
});

test("sunrise climbs from deep red through amber to warm white", () => {
  const s = { ...base, level: 0, sunrise: 10 };
  const f = (t) => sceneFrame("sunrise", s, t);
  const first = f(0), mid = f(300), end = f(600), late = f(5000);
  assert.ok(first[0] > 0 && first[1] === 0 && first[2] === 0, "starts red " + first);
  assert.ok(peak(first) < 15);
  assert.ok(mid[1] > mid[2] * 3 && mid[0] > mid[1], "amber midway " + mid);
  assert.ok(end[2] >= 12 && end[1] > 30 && end[0] > end[1], "warm white at the end " + end);
  assert.deepEqual(end, late);
  let prev = 0;
  for (let t = 0; t <= 600; t += 10) { const sum = f(t)[0] + f(t)[1] + f(t)[2]; assert.ok(sum >= prev - 1); prev = sum; }
});

test("sleep factor holds, fades over the last minute, and reaches zero", () => {
  assert.equal(sleepFactor(900, 0), 1);
  assert.equal(sleepFactor(900, 839), 1);
  assert.ok(Math.abs(sleepFactor(900, 870) - 0.5) < 1e-9);
  assert.equal(sleepFactor(900, 900), 0);
  assert.equal(sleepFactor(900, 5000), 0);
  assert.equal(sleepFactor(0, 5), 1);
  assert.equal(sleepFactor(300, NaN), 1);
});

test("opening sends no light and offers resume only with saved choices", () => {
  const fresh = open();
  assert.equal(fresh.ctx.calls.leds.length, 0);
  assert.ok(!labels(fresh.ctx)[0].startsWith("RESUME"));
  fresh.advance(5);
  assert.equal(fresh.ctx.calls.leds.length, 0, "tick alone never lights the lamps");
  const saved = open({ progress: { schema: 1, scene: "tide", colour: 3, set: 0, level: 2, sunrise: 20 } });
  assert.equal(saved.ctx.calls.leds.length, 0);
  assert.equal(labels(saved.ctx)[0], "RESUME / TIDE / CYAN / MEDIUM");
  choose(saved.ctx, "RESUME");
  assert.ok(peak(saved.ctx.calls.leds.at(-1)) > 0);
  assert.ok(!labels(saved.ctx).some((l) => l.startsWith("RESUME")));
});

test("settings survive a save and restore round trip", () => {
  const first = open();
  choose(first.ctx, "SCENE");
  choose(first.ctx, "BREATHE");
  choose(first.ctx, "COLOUR");
  choose(first.ctx, "VIOLET");
  choose(first.ctx, "DIMMER"); // LOW to NIGHT
  const saved = first.ctx.calls.saved.at(-1);
  assert.deepEqual(saved, { schema: 1, scene: "breathe", colour: 5, set: 0, level: 0, sunrise: 20 });
  assert.ok(JSON.stringify(saved).length < 200);
  const second = open({ progress: saved });
  assert.deepEqual({ ...second.app.s, seed: 0 }, { ...first.app.s, seed: 0 });
  assert.equal(labels(second.ctx)[0], "RESUME / BREATHE / VIOLET / NIGHT");
  assert.deepEqual(sanitize({ scene: "evil", colour: 99, level: -1, sunrise: 3 }), { scene: "steady", colour: 0, set: 0, level: 1, sunrise: 20 });
});

test("every action in every menu runs without throwing and keeps the list short", () => {
  const { ctx, app, advance } = open();
  const seen = new Set();
  for (const menu of ["main", "scene", "sets", "night", "colour", "sleep"]) {
    app.go(menu);
    const count = ctx.currentActions.length;
    assert.ok(count <= 8, `${menu} too long: ${labels(ctx)}`);
    assert.ok(ctx.currentActions.some((a) => /BACK|RETURN/.test(a.label)), menu + " has no way back");
    for (let i = 0; i < count; i++) {
      app.go(menu);
      const item = ctx.currentActions[i];
      seen.add(item.label.replace("● ", ""));
      if (item.label.startsWith("RETURN")) continue;
      assert.doesNotThrow(() => item.run());
      advance(1);
      assert.ok(valid(app.last));
    }
  }
  for (const word of ["STEADY LIGHT", "BREATHE", "AURORA", "CANDLE", "TIDE", "EMBER", "SUNRISE / 30", "DUSK", "NEBULA", "RED / NIGHT", "DIMMER", "BRIGHTER", "SLEEP IN 30", "OFF AFTER 60", "NO TIMER", "SLEEP TIMER", "LAMPS OFF"])
    assert.ok([...seen].some((l) => l.includes(word)), "never reached " + word);
  assert.ok(ctx.calls.leds.length > 0);
});

test("a new scene lights the lamps and changes them over time; lamps off darkens", () => {
  const { ctx, app, advance } = open();
  choose(ctx, "SCENE"); choose(ctx, "BREATHE");
  const n = ctx.calls.leds.length;
  assert.ok(n > 0 && peak(ctx.calls.leds.at(-1)) > 0);
  const seen = new Set();
  for (let i = 0; i < 16; i++) { advance(0.5); seen.add(ctx.calls.leds.at(-1).join()); }
  assert.ok(seen.size > 4, "breathe changes");
  assert.ok(ctx.calls.leds.every(valid));
  choose(ctx, "LAMPS OFF");
  assert.deepEqual(ctx.calls.leds.at(-1), Array(9).fill(0));
  advance(10);
  assert.deepEqual(ctx.calls.leds.at(-1), Array(9).fill(0));
  assert.ok(labels(ctx)[0].startsWith("RESUME") || labels(ctx)[0].startsWith("LIGHT"));
  assert.equal(app.lit, false);
});

test("a colour picked during an animated scene makes it steady; breathe keeps its scene", () => {
  const { ctx, app } = open();
  choose(ctx, "SCENE"); choose(ctx, "CANDLE");
  choose(ctx, "COLOUR"); choose(ctx, "CYAN");
  assert.equal(app.s.scene, "steady");
  choose(ctx, "SCENE"); choose(ctx, "BREATHE");
  choose(ctx, "COLOUR"); choose(ctx, "AMBER");
  assert.equal(app.s.scene, "breathe");
});

test("sleep timer holds, fades over the last minute, then leaves the lamps dark", () => {
  const { ctx, app, advance } = open();
  choose(ctx, "COLOUR"); choose(ctx, "AMBER");
  choose(ctx, "BRIGHTER"); choose(ctx, "BRIGHTER"); // LOW, MEDIUM, HIGH
  choose(ctx, "SLEEP TIMER"); choose(ctx, "OFF AFTER 15");
  assert.match(ctx.calls.content.at(-1), /15:00/);
  advance(120);
  const steady = peak(ctx.calls.leds.at(-1));
  assert.ok(steady > 50);
  assert.match(ctx.calls.content.at(-1), /13:00/);
  advance(660);
  assert.ok(Math.abs(peak(ctx.calls.leds.at(-1)) - steady) <= 1, "full until the final minute");
  advance(90);
  const half = peak(ctx.calls.leds.at(-1));
  assert.ok(half > steady * 0.4 && half < steady * 0.6, `halfway fade ${half} vs ${steady}`);
  advance(29);
  assert.ok(peak(ctx.calls.leds.at(-1)) <= 3);
  advance(2);
  assert.deepEqual(ctx.calls.leds.at(-1), Array(9).fill(0));
  assert.equal(app.lit, false);
  advance(600);
  assert.deepEqual(ctx.calls.leds.at(-1), Array(9).fill(0));
  assert.match(ctx.calls.content.at(-1), /ENDED/);
  assert.ok(labels(ctx)[0].startsWith("RESUME"));
  choose(ctx, "RESUME");
  assert.ok(peak(ctx.calls.leds.at(-1)) > 50, "resume relights after a timer");
  assert.equal(SLEEP_MINUTES.join(), "5,15,30,60");
});

test("dispose and cancel leave the lamps dark and stop the loop", () => {
  const { ctx, app, advance } = open();
  choose(ctx, "SCENE"); choose(ctx, "AURORA");
  app.cancel();
  assert.ok(peak(ctx.calls.leds.at(-1)) > 0);
  app.dispose();
  assert.deepEqual(ctx.calls.leds.at(-1), Array(9).fill(0));
  const n = ctx.calls.leds.length;
  advance(5);
  assert.equal(ctx.calls.leds.length, n, "nothing is sent after dispose");
  assert.doesNotThrow(() => app.dispose());
});

test("the frame loop runs when requestAnimationFrame exists and stops after dispose", () => {
  const queue = [];
  globalThis.requestAnimationFrame = (fn) => queue.push(fn);
  globalThis.cancelAnimationFrame = () => {};
  try {
    const { ctx, app } = open();
    // open() installs the fake clock after the constructor queued the first frame
    let t = 1000;
    app.clock = () => t;
    choose(ctx, "SCENE"); choose(ctx, "TIDE");
    const sent = ctx.calls.leds.length;
    for (let i = 0; i < 20; i++) { t += 17; queue.shift()?.(); }
    const frames = ctx.calls.leds.length - sent;
    assert.ok(frames >= 4 && frames <= 7, `about 16 a second, got ${frames} in 340 ms`);
    app.dispose();
    t += 100;
    while (queue.length) queue.shift()();
    assert.deepEqual(ctx.calls.leds.at(-1), Array(9).fill(0));
  } finally {
    delete globalThis.requestAnimationFrame;
    delete globalThis.cancelAnimationFrame;
  }
});

test("a retired context is tolerated and no NaN reaches the page", () => {
  const { ctx, app, advance } = open();
  choose(ctx, "SCENE"); choose(ctx, "TIDE");
  ctx.retire();
  assert.doesNotThrow(() => { advance(3); app.dispose(); });
  assert.ok(ctx.calls.content.every((html) => !/NaN|undefined/.test(html)));
});

// The host's highlight rules are in tests/helpers/pad.mjs (`Hand`): tapping moves the highlight and
// the app sees the raw edges, a hold runs the action, and after a list is replaced the highlight
// stays on the same id, else the same row number.
const rig = (options = {}, card = 0) => {
  const ctx = appContext(options);
  let t = 1000;
  const clock = { now: () => t, set: (v) => { t = v; } };
  const app = new Lantern(ctx);
  app.clock = () => t;
  const hand = new Hand(ctx, app, clock, { card });
  const watch = (message) => assert.equal(app.cursor, hand.index, message || "the app knows where the highlight is");
  return { ctx, app, hand, clock, watch, advance: (s) => { t += s * 1000; app.tick(); } };
};
const saved = { schema: 1, scene: "steady", colour: 0, set: 0, level: 2, sunrise: 20 };

test("the highlight lands somewhere sensible after every choice, never on RETURN TO DASHBOARD by accident", () => {
  const { hand, watch } = rig();
  assert.match(hand.label, /^LIGHT/); watch();
  hand.hold();
  assert.match(hand.label, /^SCENE/, "after the lamps come on the highlight is on SCENE"); watch();
  hand.hold(); // the scene list opens on its first row
  assert.match(hand.label, /STEADY LIGHT/); watch();
  hand.tap(1); watch();
  assert.match(hand.label, /CANDLE/);
  hand.hold();
  assert.match(hand.label, /^SCENE/, "a choice returns to the row that opened the list"); watch();
  hand.to("COLOUR").hold();
  assert.match(hand.label, /WARM WHITE/, "a list opens on its first row"); watch();
  hand.tap(5).hold(); // VIOLET
  assert.match(hand.label, /^COLOUR/, "back on the item that opened the list"); watch();
  hand.to("SLEEP TIMER").hold();
  assert.match(hand.label, /NO TIMER/); watch();
  hand.tap(3).hold(); // OFF AFTER 30
  assert.match(hand.label, /^SLEEP TIMER/); watch();
  // scene -> sets -> choice returns to SCENE; BACK from sets lands on its parent row
  const second = rig();
  const h2 = second.hand;
  h2.hold(); h2.hold(); // light, then the scene list
  h2.to("THREE-LAMP SETS").hold();
  assert.match(h2.label, /DUSK/); second.watch();
  h2.to("BACK").hold();
  assert.match(h2.label, /THREE-LAMP SETS/); second.watch();
  h2.to("EMBER AND SUNRISE").hold();
  h2.to("BACK").hold();
  assert.match(h2.label, /EMBER AND SUNRISE/); second.watch();
  h2.to("BACK").hold();
  assert.match(h2.label, /^SCENE/);
  assert.match(h2.label, /^SCENE/); second.watch();
});

test("press counts: turning on, candle, dimmer, sleep in 30 minutes, off, a colour", () => {
  // Measured the same way on the previous menu structure (a hold on RESUME, then SCENE, COLOUR,
  // BRIGHTNESS and SLEEP TIMER as lists of choices): on 1, candle 6, dimmer 5, sleep in 30 8,
  // lamps off 5, cyan 6, and a warm steady light back from a candle 2.
  const lit = (progress = saved) => { const r = rig({ progress }); r.hand.hold(); r.hand.presses = 0; return r; };
  const counts = {};
  counts.onFresh = (() => { const r = rig(); r.hand.hold(); assert.ok(peak(r.ctx.calls.leds.at(-1)) > 0); return r.hand.presses; })();
  counts.onSaved = (() => { const r = rig({ progress: saved }); r.hand.hold(); assert.equal(r.app.lit, true); return r.hand.presses; })();
  counts.candle = (() => { const r = lit(); r.hand.to("SCENE").hold(); r.hand.to("CANDLE").hold(); assert.equal(r.app.s.scene, "candle"); return r.hand.presses; })();
  counts.dimmer = (() => { const r = lit(); r.hand.to("DIMMER").hold(); assert.equal(r.app.s.level, 1); return r.hand.presses; })();
  counts.sleep30 = (() => { const r = lit(); r.hand.to("SLEEP IN 30").hold(); assert.equal(r.app.sleepMin, 30); return r.hand.presses; })();
  counts.off = (() => { const r = lit(); r.hand.to("LAMPS OFF").hold(); assert.equal(r.app.lit, false); return r.hand.presses; })();
  counts.cyan = (() => { const r = lit(); r.hand.to("COLOUR").hold(); r.hand.to("CYAN").hold(); assert.equal(r.app.s.colour, 3); return r.hand.presses; })();
  counts.warmFromCandle = (() => { const r = lit({ ...saved, scene: "candle" }); r.hand.to("SCENE").hold(); r.hand.to("STEADY").hold(); assert.equal(r.app.s.scene, "steady"); return r.hand.presses; })();
  assert.deepEqual(counts, { onFresh: 1, onSaved: 1, candle: 3, dimmer: 2, sleep30: 4, off: 5, cyan: 10, warmFromCandle: 2 });
});

test("the first hold lights the last scene, or a warm steady light the first time", () => {
  const fresh = rig();
  fresh.hand.hold();
  assert.equal(fresh.app.s.scene, "steady"); assert.equal(fresh.app.s.colour, 0);
  const l = fresh.ctx.calls.leds.at(-1);
  assert.ok(l[0] > l[1] && l[1] > l[2], "warm: red above green above blue " + l);
  assert.ok(peak(l) <= 0.34 * 255 + 1);
  const again = rig({ progress: { schema: 1, scene: "aurora", colour: 2, set: 0, level: 2, sunrise: 20 } });
  again.hand.hold();
  assert.equal(again.app.s.scene, "aurora");
  assert.equal(again.app.lit, true);
});

test("DIMMER and BRIGHTER step the level at once, stay put for repeats, and stop at the ends", () => {
  const r = rig({ progress: saved });
  r.hand.hold();
  const level = () => r.app.s.level;
  r.hand.to("DIMMER");
  const before = peak(r.ctx.calls.leds.at(-1));
  r.hand.hold();
  assert.equal(level(), 1); assert.ok(peak(r.ctx.calls.leds.at(-1)) < before, "the lamps are dimmer at once");
  assert.equal(r.hand.label, "DIMMER", "the highlight stays, so another step is one more hold");
  r.hand.hold();
  assert.equal(level(), 0);
  assert.equal(r.hand.label, "DIMMER / LOWEST");
  r.hand.hold();
  assert.equal(level(), 0, "nothing below night");
  r.hand.tap(); assert.equal(r.hand.label, "BRIGHTER");
  r.hand.hold(); r.hand.hold(); r.hand.hold();
  assert.equal(level(), LEVELS.length - 1);
  assert.equal(r.hand.label, "BRIGHTER / HIGHEST");
  r.hand.hold();
  assert.equal(level(), LEVELS.length - 1);
  assert.ok(peak(r.ctx.calls.leds.at(-1)) <= 0.34 * 255 + 1);
  // while dark a step lights the lamps at the new level
  const dark = rig({ progress: saved });
  dark.hand.to("DIMMER").hold();
  assert.equal(dark.app.lit, true); assert.equal(dark.app.s.level, 1);
});

test("SLEEP IN 30 MIN starts the timer and lights dark lamps; the row then cancels it", () => {
  const r = rig({ progress: saved });
  r.hand.to("SLEEP IN 30").hold(); // from dark: lamps on and the timer running
  assert.equal(r.app.lit, true); assert.equal(r.app.sleepMin, 30);
  assert.match(r.ctx.calls.content.at(-1), /30:00/);
  assert.match(r.hand.label, /^CANCEL SLEEP TIMER \/ 30 MIN/);
  r.advance(600);
  assert.match(r.ctx.calls.content.at(-1), /20:00/);
  r.hand.hold();
  assert.equal(r.app.sleepMin, 0); assert.equal(r.hand.label, "SLEEP IN 30 MIN");
  r.advance(60);
  assert.equal(r.app.lit, true, "cancelled: the lamps stay on");
  // the longer list still offers the other lengths, and the label shows what is set
  r.hand.to("SLEEP TIMER").hold(); r.hand.to("OFF AFTER 60").hold();
  assert.equal(r.app.sleepMin, 60);
  assert.match(r.hand.label, /^SLEEP TIMER \/ 60 MIN/);
});

test("preview on highlight: each tap shows the highlighted choice on the lamps, a hold keeps it", () => {
  const r = rig({ progress: saved });
  r.hand.hold();
  const steady = r.ctx.calls.leds.at(-1);
  r.hand.to("COLOUR").hold();
  r.watch();
  assert.deepEqual(r.ctx.calls.leds.at(-1), steady, "opening the list changes nothing");
  assert.equal(r.app.preview, null);
  const seen = [];
  for (let i = 0; i < 5; i++) { r.hand.tap(); r.watch(); seen.push(r.ctx.calls.leds.at(-1).slice(0, 3).join()); assert.ok(valid(r.ctx.calls.leds.at(-1))); }
  assert.equal(new Set(seen).size, 5, "five different colours were shown: " + seen.join(" | "));
  assert.match(r.ctx.calls.content.at(-1), /PREVIEW \/ HOLD TO KEEP/);
  assert.equal(r.app.s.colour, 0, "nothing was chosen by looking");
  assert.equal(r.ctx.calls.saved.length, 1, "nothing was saved by looking (only the first lighting saved)");
  const violet = r.ctx.calls.leds.at(-1);
  assert.equal(r.hand.label, "VIOLET");
  r.hand.hold();
  assert.equal(r.app.s.colour, 5); assert.equal(r.app.preview, null);
  assert.deepEqual(r.ctx.calls.leds.at(-1), violet, "the lamps already looked like this");
  assert.doesNotMatch(r.ctx.calls.content.at(-1), /PREVIEW/);
  assert.equal(r.ctx.calls.saved.at(-1).colour, 5);
});

test("preview: leaving a list without choosing puts the lamps back, dark lamps go dark again", () => {
  const r = rig({ progress: saved });
  r.hand.hold();
  const before = r.ctx.calls.leds.at(-1);
  r.hand.to("SCENE").hold(); r.hand.tap(2); // BREATHE
  assert.notDeepEqual(r.ctx.calls.leds.at(-1), before);
  r.hand.to("BACK").hold();
  assert.equal(r.app.preview, null);
  assert.deepEqual(r.ctx.calls.leds.at(-1), before, "back to the chosen scene");
  assert.equal(r.app.s.scene, "steady");
  // dark: browsing shows the lamps, backing out darkens them
  const d = rig({ progress: saved });
  d.hand.to("SCENE").hold();
  assert.equal(d.ctx.calls.leds.length, 0, "opening a list while dark lights nothing");
  d.hand.tap(1);
  assert.ok(peak(d.ctx.calls.leds.at(-1)) > 0, "a tap shows the candidate");
  d.hand.to("BACK").hold();
  assert.deepEqual(d.ctx.calls.leds.at(-1), Array(9).fill(0));
  assert.equal(d.app.lit, false);
});

test("preview shows moving scenes moving, and they stop with the preview", () => {
  const queue = [];
  globalThis.requestAnimationFrame = (fn) => queue.push(fn);
  globalThis.cancelAnimationFrame = () => {};
  try {
    const r = rig({ progress: saved });
    r.hand.hold();
    r.hand.to("SCENE").hold();
    assert.equal(queue.length, 0, "steady needs no frames");
    r.hand.tap(1); // CANDLE
    assert.equal(queue.length, 1, "previewing a candle runs the loop");
    let t = r.clock.now();
    const seen = new Set();
    for (let i = 0; i < 40; i++) { t += 70; r.clock.set(t); queue.shift()?.(); seen.add(r.ctx.calls.leds.at(-1).join()); }
    assert.ok(seen.size > 6, "the candle flickers in the preview");
    r.hand.to("STEADY LIGHT");
    while (queue.length) queue.shift()();
    assert.equal(queue.length, 0, "the loop ended by itself on a steady preview");
  } finally {
    delete globalThis.requestAnimationFrame;
    delete globalThis.cancelAnimationFrame;
  }
});

test("the app's idea of the highlight matches the host's through lists, sets and taps", () => {
  const r = rig({ progress: saved });
  r.watch();
  r.hand.hold(); r.watch();
  for (let i = 0; i < 12; i++) { r.hand.tap(); r.watch("main list tap " + i); }
  r.hand.to("SCENE").hold(); r.watch();
  for (let i = 0; i < 9; i++) { r.hand.tap(); r.watch("scene list tap " + i); }
  r.hand.to("THREE-LAMP SETS").hold(); r.watch();
  for (let i = 0; i < 6; i++) { r.hand.tap(); r.watch("sets tap " + i); }
  r.hand.to("NEBULA").hold(); r.watch();
  assert.equal(r.app.s.set, 3);
});

test("the menu gesture: two quick taps then a hold change nothing that was chosen", () => {
  const r = rig({ progress: saved });
  r.hand.hold();
  const chosen = JSON.stringify({ ...r.app.s, seed: 0 }), saves = r.ctx.calls.saved.length, shown = r.ctx.calls.leds.at(-1);
  r.hand.to("COLOUR").hold();
  r.hand.tap(1, 250); r.hand.tap(1, 250); // two quick taps: the highlight moved twice, so did the preview
  assert.equal(r.app.preview?.colour, 2);
  r.app.event({ type: "button", pressed: true, source: "node", at_us: 9e6 }); // the hold begins
  r.app.cancel(); // the host took it as the menu gesture
  r.app.pause();
  assert.equal(JSON.stringify({ ...r.app.s, seed: 0 }), chosen, "nothing chosen");
  assert.equal(r.ctx.calls.saved.length, saves, "nothing saved");
  r.app.resume();
  assert.ok(r.app.lit);
  // the release that ends the cancelled hold is not a tap
  const cursor = r.app.cursor;
  r.app.event({ type: "button", pressed: false, source: "node", at_us: 9.5e6 });
  assert.equal(r.app.cursor, cursor);
  // leaving the list the usual way restores the lamps
  r.hand.to("BACK").hold();
  assert.deepEqual(r.ctx.calls.leds.at(-1), shown);
});

test("stray and missing edges never throw or move the highlight", () => {
  const r = rig({ progress: saved });
  for (const bad of [null, {}, { type: "button" }, { type: "button", pressed: false }, { type: "sensor" }, { type: "button", pressed: true, repeat: true }])
    assert.doesNotThrow(() => r.app.event(bad));
  assert.equal(r.app.cursor, 0);
  r.app.pause();
  r.app.event({ type: "button", pressed: true, source: "node", at_us: 1 });
  r.app.event({ type: "button", pressed: false, source: "node", at_us: 2 });
  assert.equal(r.app.cursor, 0, "taps heard while the system menu is open are not ours");
  r.app.resume(); r.app.dispose();
  assert.doesNotThrow(() => r.app.event({ type: "button", pressed: true, source: "node", at_us: 3 }));
});

test("a steady colour runs no frame loop; a moving scene does, and it ends with the lamps", () => {
  const queue = [];
  globalThis.requestAnimationFrame = (fn) => queue.push(fn);
  globalThis.cancelAnimationFrame = () => {};
  try {
    const { ctx, app } = open();
    assert.equal(queue.length, 0, "nothing runs on opening");
    choose(ctx, "LIGHT");
    assert.equal(queue.length, 0, "steady light needs no frames");
    choose(ctx, "SCENE"); choose(ctx, "CANDLE");
    assert.equal(queue.length, 1);
    choose(ctx, "LAMPS OFF");
    while (queue.length) queue.shift()();
    assert.equal(queue.length, 0, "the loop ended by itself");
    choose(ctx, "LIGHT");
    assert.equal(queue.length, 1, "relighting restarts it");
    app.dispose();
    while (queue.length) queue.shift()();
    assert.equal(queue.length, 0);
  } finally {
    delete globalThis.requestAnimationFrame;
    delete globalThis.cancelAnimationFrame;
  }
});

test("while the system menu is open the lamps are left to it, and return when it closes", () => {
  const { ctx, app, advance } = open();
  choose(ctx, "SCENE"); choose(ctx, "TIDE");
  app.pause();
  const n = ctx.calls.leds.length;
  advance(3);
  assert.equal(ctx.calls.leds.length, n, "nothing is written while paused");
  app.resume();
  assert.ok(ctx.calls.leds.length > n && peak(ctx.calls.leds.at(-1)) > 0);
  app.pause(); app.dispose();
  assert.deepEqual(ctx.calls.leds.at(-1), Array(9).fill(0), "dispose darkens even when paused");
});

test("opened from any dashboard card the first action is highlighted, not RETURN TO DASHBOARD", () => {
  for (let card = 0; card < 8; card++) {
    const { hand, watch } = rig({}, card);
    assert.match(hand.label, /^LIGHT/, "card " + card); watch("card " + card);
  }
  for (let card = 0; card < 8; card++) assert.match(rig({ progress: saved }, card).hand.label, /^RESUME/);
});
