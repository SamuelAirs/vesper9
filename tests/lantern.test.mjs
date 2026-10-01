import test from "node:test";
import assert from "node:assert/strict";
import { appContext } from "./helpers/app-context.mjs";
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
  choose(first.ctx, "BRIGHTNESS");
  choose(first.ctx, "NIGHT");
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
  for (const menu of ["main", "scene", "sets", "night", "colour", "bright", "sleep"]) {
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
  for (const word of ["STEADY LIGHT", "BREATHE", "AURORA", "CANDLE", "TIDE", "EMBER", "SUNRISE / 30", "DUSK", "NEBULA", "RED / NIGHT", "HIGH", "OFF AFTER 60", "NO TIMER", "SLEEP TIMER", "LAMPS OFF"])
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
  choose(ctx, "BRIGHTNESS"); choose(ctx, "HIGH");
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

// What the host does with the highlight after a list is replaced (web/main.js setNav): it stays
// on the action with the same id, otherwise on the same row number. Tapping moves down one.
// `card` is the row the dashboard had highlighted when the instrument was opened: the host
// starts the first list at that row number (the dashboard's items have no ids to match).
function pad(ctx, card = 0) {
  let items = null, index = card, seen = 0;
  const idOf = (i) => i.id || i.label;
  const sync = () => {
    for (; seen < ctx.calls.actions.length; seen++) {
      const next = ctx.calls.actions[seen], match = items ? next.findIndex((i) => idOf(i) === idOf(items[index])) : -1;
      index = Math.min(match >= 0 ? match : index, next.length - 1);
      items = next;
    }
  };
  return {
    tap(n = 1) { sync(); index = (index + n) % items.length; return this; },
    hold() { sync(); items[index].run(); sync(); return this; },
    get label() { sync(); return items[index].label; },
  };
}

test("the highlight lands somewhere sensible after every choice, never on RETURN TO DASHBOARD by accident", () => {
  const { ctx } = open();
  const hand = pad(ctx);
  assert.match(hand.label, /^LIGHT/);
  hand.hold();
  assert.match(hand.label, /^SCENE/);
  hand.tap(1).hold(); // COLOUR
  assert.match(hand.label, /WARM WHITE/, "a submenu opens on its first row");
  hand.tap(5).hold(); // VIOLET
  assert.match(hand.label, /^COLOUR/, "back on the item that opened the submenu");
  hand.tap(1).hold(); // BRIGHTNESS
  assert.match(hand.label, /NIGHT/);
  hand.tap(3).hold();
  assert.match(hand.label, /^BRIGHTNESS/);
  hand.tap(1).hold(); // SLEEP TIMER
  hand.tap(2).hold();
  assert.match(hand.label, /^SLEEP TIMER/);
  // scene -> sets -> choice returns to SCENE, BACK from sets lands on its parent row
  const second = open();
  const h2 = pad(second.ctx);
  h2.hold(); h2.hold(); // light, then SCENE
  h2.tap(1).hold(); // THREE-LAMP SETS
  assert.match(h2.label, /DUSK/);
  h2.tap(4).hold(); // BACK
  assert.match(h2.label, /THREE-LAMP SETS/);
  h2.tap(5).hold(); // EMBER AND SUNRISE
  h2.tap(4).hold(); // BACK
  assert.match(h2.label, /EMBER AND SUNRISE/);
  h2.tap(1).hold(); // BACK to main
  assert.match(h2.label, /^SCENE/);
  // lamps off leaves the highlight on the way out, which is what is wanted next
  h2.tap(4).hold();
  assert.match(h2.label, /^RETURN/);
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
    const { ctx } = open();
    assert.match(pad(ctx, card).label, /^LIGHT/, "card " + card);
  }
  const saved = open({ progress: { schema: 1, scene: "tide", colour: 3, set: 0, level: 2, sunrise: 20 } });
  assert.match(pad(saved.ctx, 5).label, /^RESUME/);
});
