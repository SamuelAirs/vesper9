// Cadence's TIMER tool: a front end for the service's persistent timers. Run against a stand-in
// for the service (tests/helpers/pad.mjs) with the host's highlight rules, so the press counts
// asserted here are counts of taps and holds on the one button.
import test from "node:test";
import assert from "node:assert/strict";
import { appContext } from "./helpers/app-context.mjs";
import { Hand, FakeService } from "./helpers/pad.mjs";
import { Cadence, lengthLabel, longClock, dialSeconds, dialLamps, doneFlashLamps, sanitize, TIMER_PRESETS, TIMER_MORE } from "../web/apps/cadence.js";
import { Timers } from "../web/apps/utilities.js";

const valid = (v) => v.length === 9 && v.every((n) => Number.isInteger(n) && n >= 0 && n <= 255);
const lit = (v) => v.some((n) => n > 0);
const EPOCH = 1_800_000_000;

// A Cadence with the timer tool open, a service behind it and a hand on the button.
function rig({ progress = { tool: "timer" }, store, state } = {}) {
  const ctx = appContext({ progress: { schema: 1, ...progress }, state });
  let t = 10000;
  const clock = { now: () => t, set: (v) => { t = v; } };
  const app = new Cadence(ctx);
  app.clock = () => t;
  const service = new FakeService(ctx, () => EPOCH + t / 1000, store).attach(app);
  const hand = new Hand(ctx, app, clock, { card: 0 });
  const advance = (ms) => { for (let k = 0; k < Math.ceil(ms / 250); k++) { t += Math.min(250, ms - k * 250); service.tick(); app.tick(); } };
  const rigged = { ctx, app, service, hand, clock, advance, get svc() { return service; } };
  return rigged;
}
// Open the timer tool from Cadence's tool list (it is highlighted when it was the last used).
function openTimer(r) {
  assert.equal(r.hand.label, "TIMER", "the tool list opens on the tool used last");
  r.hand.hold();
  r.hand.presses = 0;
  return r;
}
const running = (r) => r.ctx.state().timers.filter((t) => t.running && !t.finished);

test("pure helpers: labels, clocks, the dial", () => {
  assert.equal(lengthLabel(300), "5 MIN"); assert.equal(lengthLabel(3600), "1 H"); assert.equal(lengthLabel(3900), "1 H 5 MIN");
  assert.equal(lengthLabel(30), "30 S"); assert.equal(lengthLabel(750), "12 MIN 30 S"); assert.equal(lengthLabel(NaN), "0 S");
  assert.equal(longClock(12 * 60), "12:00"); assert.equal(longClock(59.2), "01:00"); assert.equal(longClock(3600), "1:00:00");
  assert.equal(longClock(-4), "00:00"); assert.equal(longClock(NaN), "00:00");
  assert.equal(dialSeconds({ tens: 1, units: 2 }), 720); assert.equal(dialSeconds(null), 0);
  for (const v of [dialLamps(0, 0), dialLamps(12, 0), dialLamps(99, 1000), dialLamps(NaN, NaN), doneFlashLamps(0), doneFlashLamps(500), doneFlashLamps(5000), doneFlashLamps(NaN)]) assert.ok(valid(v));
  assert.ok(lit(doneFlashLamps(100))); assert.ok(!lit(doneFlashLamps(500))); assert.ok(lit(doneFlashLamps(900))); assert.ok(!lit(doneFlashLamps(2400)));
  assert.ok(Math.max(...dialLamps(60, 1000)) <= 90, "dim, a third of full at most");
  assert.equal(sanitize({ lastTimer: 720 }).lastTimer, 720); assert.equal(sanitize({ lastTimer: 1 }).lastTimer, 300);
  assert.equal(sanitize({ lastTimer: "x" }).lastTimer, 300); assert.equal(sanitize({ tool: "timer" }).tool, "timer");
});

test("TIMER is a fourth tool in its own place and the other three keep theirs", () => {
  const r = rig({ progress: {} });
  assert.deepEqual(r.hand.labels, ["METRONOME", "STOPWATCH", "INTERVALS", "TIMER", "RETURN TO DASHBOARD"]);
  const again = rig({ progress: { tool: "timer" } });
  assert.equal(again.hand.label, "TIMER", "opens on the tool used last");
});

test("the start list: last length first, then the dial, the common lengths, more, back", () => {
  const r = openTimer(rig());
  assert.deepEqual(r.hand.labels, ["START 5 MIN / LAST", "DIAL / TAP ADDS MINUTES", "START 5 MIN", "START 10 MIN", "START 15 MIN", "START 25 MIN", "MORE LENGTHS", "BACK"]);
  assert.ok(r.hand.labels.length <= 8);
  assert.match(r.ctx.calls.content.at(-1), /COMPUTER TIMER TWELVE MINUTES/, "voice is mentioned on the screen, once");
  assert.equal((r.ctx.calls.content.at(-1).match(/VOICE:/g) || []).length, 1);
  assert.match(r.ctx.calls.hint.at(-1), /computer timer twelve minutes/i);
});

test("press counts inside the timer tool: last length, 5, 12 and 45 minutes", () => {
  const counts = {};
  // repeat the last length: one hold
  let r = openTimer(rig({ progress: { tool: "timer", lastTimer: 720 } }));
  r.hand.hold();
  counts.last12 = r.hand.presses;
  assert.equal(running(r).length, 1); assert.equal(running(r)[0].duration, 720);

  // 5 minutes from the list: two taps and a hold
  r = openTimer(rig({ progress: { tool: "timer", lastTimer: 720 } }));
  r.hand.to("START 5 MIN").hold();
  counts.five = r.hand.presses;
  assert.equal(running(r)[0].duration, 300);

  // 12 minutes on the dial: dial, tens (1), units (2), start
  r = openTimer(rig({ progress: { tool: "timer", lastTimer: 300 } }));
  r.hand.to("DIAL").hold();
  r.hand.tap(1); r.hand.hold();       // tens: one tap, hold for NEXT
  r.hand.tap(2);                      // units: two taps
  assert.equal(r.hand.label, "START 12 MIN");
  r.hand.hold();
  counts.twelve = r.hand.presses;
  assert.equal(running(r).length, 1); assert.equal(running(r)[0].duration, 720);

  // 45 minutes: a ready-made length under MORE
  r = openTimer(rig({ progress: { tool: "timer", lastTimer: 300 } }));
  r.hand.to("MORE").hold();
  r.hand.to("START 45 MIN").hold();
  counts.fortyFive = r.hand.presses;
  assert.equal(running(r)[0].duration, 2700);

  // 45 minutes on the dial, for comparison: four taps for the tens, five for the units
  r = openTimer(rig({ progress: { tool: "timer", lastTimer: 300 } }));
  r.hand.to("DIAL").hold(); r.hand.tap(4); r.hand.hold(); r.hand.tap(5); r.hand.hold();
  counts.fortyFiveDial = r.hand.presses;
  assert.equal(running(r)[0].duration, 2700);

  assert.deepEqual(counts, { last12: 1, five: 3, twelve: 7, fortyFive: 9, fortyFiveDial: 13 });
});

test("press counts of the old Chronometer wizard, measured the same way", () => {
  const measure = (seconds) => {
    const ctx = appContext({ state: { timers: [] } });
    let t = 10000; const clock = { now: () => t, set: (v) => { t = v; } };
    const app = new Timers(ctx);
    new FakeService(ctx, () => EPOCH + t / 1000).attach(app);
    const hand = new Hand(ctx, app, clock);
    hand.to("CUSTOM TIMER").hold();
    const digits = [Math.floor(seconds / 36000), Math.floor(seconds / 3600) % 10, Math.floor(seconds / 600) % 6, Math.floor(seconds / 60) % 10, Math.floor(seconds / 10) % 6, seconds % 10];
    for (const d of digits) hand.to("DIGIT / " + d).hold();
    hand.to("START /").hold(); // label step: START is the first row
    assert.equal(ctx.state().timers.at(-1).duration, seconds);
    return hand.presses;
  };
  const wizard = { five: measure(300), twelve: measure(720), fortyFive: measure(2700) };
  // the quickest old way to a timer of 5 minutes: CHANGE DURATION twice (30 s, 1 min, 5 min), then CREATE
  const ctx = appContext({ state: { timers: [] } });
  let t = 10000; const clock = { now: () => t, set: (v) => { t = v; } };
  const app = new Timers(ctx); new FakeService(ctx, () => EPOCH + t / 1000).attach(app);
  const hand = new Hand(ctx, app, clock);
  hand.to("CHANGE DURATION").hold(); hand.hold(); hand.to("CREATE TIMER").hold();
  assert.equal(ctx.state().timers[0].duration, 300);
  assert.deepEqual({ ...wizard, cycle5: hand.presses }, { five: 20, twelve: 20, fortyFive: 20, cycle5: 7 });
});

test("running timer: large readout, drains, pause, resume, add a minute, cancel", () => {
  const r = openTimer(rig({ progress: { tool: "timer", lastTimer: 600 } }));
  r.hand.hold(); // START 10 MIN
  assert.deepEqual(r.hand.labels, ["PAUSE", "ADD 1 MIN", "CANCEL TIMER", "NEW TIMER", "BACK"]);
  assert.match(r.ctx.calls.content.at(-1), /cad-timer-big[^>]*>10:00</);
  assert.match(r.ctx.calls.content.at(-1), /RUNNING/);
  r.advance(125000);
  assert.match(r.ctx.calls.content.at(-1), /cad-timer-big[^>]*>07:5[45]</);
  // pause
  r.hand.hold();
  assert.equal(r.hand.label, "RESUME", "PAUSE became RESUME on the same row");
  assert.equal(r.ctx.state().timers[0].running, false);
  const frozen = r.ctx.state().timers[0].remaining;
  r.advance(60000);
  assert.equal(r.ctx.state().timers[0].remaining, frozen, "a paused timer does not drain");
  assert.match(r.ctx.calls.content.at(-1), /PAUSED/);
  // resume
  r.hand.hold();
  assert.equal(r.hand.label, "PAUSE"); assert.equal(r.ctx.state().timers[0].running, true);
  // add a minute: a new timer for the time left plus 60 s replaces the old one, label kept
  const left = r.ctx.state().timers[0].remaining, oldId = r.ctx.state().timers[0].id;
  r.hand.tap(); assert.equal(r.hand.label, "ADD 1 MIN");
  r.hand.hold();
  assert.equal(r.ctx.state().timers.length, 1, "the old timer is gone");
  const added = r.ctx.state().timers[0];
  assert.notEqual(added.id, oldId); assert.equal(added.label, "10 MIN");
  assert.ok(Math.abs(added.duration - (Math.ceil(left) + 60)) <= 1, `duration ${added.duration} vs ${left} + 60`);
  assert.equal(r.hand.label, "ADD 1 MIN", "the highlight stays, so +1 MIN again is one more hold");
  r.hand.hold();
  assert.ok(Math.abs(r.ctx.state().timers[0].duration - (Math.ceil(left) + 120)) <= 2);
  // cancel
  r.hand.tap(); assert.equal(r.hand.label, "CANCEL TIMER");
  r.hand.hold();
  assert.equal(r.ctx.state().timers.length, 0);
  assert.equal(r.hand.label, "START 10 MIN / LAST", "back on the start list, first row");
});

test("adding a minute to a paused timer keeps it paused; to a finished one starts a minute", () => {
  let r = openTimer(rig({ progress: { tool: "timer", lastTimer: 300 } }));
  r.hand.hold(); r.advance(30000); r.hand.hold(); // paused at 4:30
  r.hand.to("ADD 1 MIN").hold();
  const t = r.ctx.state().timers[0];
  assert.equal(r.ctx.state().timers.length, 1); assert.equal(t.running, false);
  assert.ok(Math.abs(t.remaining - 330) <= 1, String(t.remaining));
  r = openTimer(rig({ progress: { tool: "timer", lastTimer: 60 } }));
  r.hand.hold(); r.advance(61000);
  assert.equal(r.hand.label, "DISMISS");
  assert.deepEqual(r.hand.labels, ["DISMISS", "RESTART 1 MIN", "NEW TIMER", "BACK"]);
});

test("a timer that finishes: blink on the lamps, DONE on the screen, dismiss or restart", () => {
  const r = openTimer(rig({ progress: { tool: "timer", lastTimer: 30 } }));
  r.hand.hold();
  r.advance(29000);
  const before = r.ctx.calls.leds.length;
  r.advance(1500);
  assert.match(r.ctx.calls.content.at(-1), /cad-timer-big[^>]*>DONE</);
  const blinks = r.ctx.calls.leds.slice(before).filter(lit);
  assert.ok(blinks.length >= 1 && blinks.every(valid));
  assert.ok(blinks.some((v) => v[0] > 0 && v[0] === v[3] && v[3] === v[6]), "all three lamps blink together");
  assert.deepEqual(r.hand.labels, ["DISMISS", "RESTART 30 S", "NEW TIMER", "BACK"]);
  r.advance(4000);
  assert.deepEqual(r.ctx.calls.leds.at(-1).slice(0, 3), [0, 0, 0], "after the blink one dim lamp waits for the dismissal");
  assert.ok(lit(r.ctx.calls.leds.at(-1)));
  r.hand.tap(); assert.equal(r.hand.label, "RESTART 30 S");
  r.hand.hold();
  assert.equal(r.ctx.state().timers[0].running, true); assert.equal(r.ctx.state().timers[0].finished, false);
  assert.deepEqual(r.hand.labels.slice(0, 3), ["PAUSE", "ADD 1 MIN", "CANCEL TIMER"]);
  r.advance(31000); r.hand.hold(); // DISMISS
  assert.equal(r.ctx.state().timers.length, 0);
});

test("the lamps drain with the nearest timer and show the host's last ten seconds", () => {
  const r = openTimer(rig({ progress: { tool: "timer", lastTimer: 3600 } }));
  assert.equal(r.ctx.calls.leds.length, 0, "no timer: the lamps stay with the host");
  r.hand.hold(); // an hour
  let leds = r.ctx.calls.leds.at(-1);
  assert.ok(valid(leds)); assert.ok(leds.slice(0, 3).every((v) => v > 0) && leds.slice(6, 9).every((v) => v > 0), "full bar at the start");
  assert.ok(Math.max(...leds) <= 100, "about a third of full at most");
  r.advance(40 * 60 * 1000);
  leds = r.ctx.calls.leds.at(-1);
  assert.ok(leds[0] > 0 && leds[3] > 0 && leds[6] === 0 || leds[6] < leds[0], "the right lamp goes first");
  // a nearer timer takes the lamps; a farther one does not
  r.ctx.command("timer", { op: "create", seconds: 40, label: "SHORT" });
  r.advance(1000);
  leds = r.ctx.calls.leds.at(-1);
  assert.ok(valid(leds)); assert.ok(lit(leds));
  r.advance(31000); // 8 s left: the amber 3-2-1 countdown the host shows elsewhere
  leds = r.ctx.calls.leds.at(-1);
  assert.ok(leds[0] > 0 && leds[1] > 0 && leds[1] > leds[2], "amber (red channel above green)");
  assert.ok(leds.every((v, i) => i % 3 !== 2 || v === 0), "no blue");
  r.advance(5000);
  leds = r.ctx.calls.leds.at(-1);
  assert.ok([0, 3, 6].filter((i) => leds[i] > 0).length <= 2, "two lamps in the last seconds");
  r.app.dispose();
  assert.deepEqual(r.ctx.calls.leds.at(-1), Array(9).fill(0));
  assert.ok(r.ctx.state().timers.length === 2, "closing the app leaves the service timers running");
});

test("several timers: the nearest leads, NEXT TIMER steps through them, others are listed", () => {
  const r = openTimer(rig({ progress: { tool: "timer", lastTimer: 1500 } }));
  r.hand.hold();
  r.hand.to("NEW TIMER").hold();
  r.hand.to("START 5 MIN").hold();
  assert.equal(r.ctx.state().timers.length, 2);
  assert.match(r.ctx.calls.content.at(-1), /cad-timer-big[^>]*>05:00</, "the one just started is shown");
  assert.match(r.ctx.calls.content.at(-1), /25 MIN/); assert.match(r.ctx.calls.content.at(-1), /1 OF 2/);
  assert.ok(r.hand.labels.some((l) => l.startsWith("NEXT TIMER")));
  r.hand.to("NEXT TIMER").hold();
  assert.match(r.ctx.calls.content.at(-1), /cad-timer-big[^>]*>2[45]:\d\d</);
  // acting on the large timer only
  r.hand.to("CANCEL").hold();
  assert.equal(r.ctx.state().timers.length, 1); assert.equal(r.ctx.state().timers[0].duration, 300);
});

test("a timer started elsewhere (voice) while the tool is open replaces the start list", () => {
  const r = openTimer(rig());
  assert.equal(r.hand.label, "START 5 MIN / LAST");
  r.ctx.command("timer", { op: "create", seconds: 720, label: "FIELD TIMER" });
  assert.deepEqual(r.hand.labels.slice(0, 3), ["PAUSE", "ADD 1 MIN", "CANCEL TIMER"]);
  assert.match(r.ctx.calls.content.at(-1), /12:00/);
});

test("a labelled-free start: the label is made from the length and never asked for", () => {
  const r = openTimer(rig({ progress: { tool: "timer", lastTimer: 90 } }));
  r.hand.hold();
  assert.deepEqual(r.svc.commands.at(-1), ["timer", { op: "create", seconds: 90, label: "1 MIN 30 S" }]);
  assert.ok(!r.hand.labels.some((l) => /LABEL|TEA|FOCUS/.test(l)));
});

test("slow service: the screen says STARTING until the timer arrives, then shows it", () => {
  const r = openTimer(rig({ progress: { tool: "timer", lastTimer: 600 } }));
  r.svc.hold();
  r.hand.hold();
  assert.match(r.ctx.calls.content.at(-1), /STARTING/); assert.deepEqual(r.hand.labels, ["BACK"]);
  r.svc.flush();
  assert.match(r.ctx.calls.content.at(-1), /cad-timer-big[^>]*>(10:00|09:5\d)</); assert.equal(r.hand.labels[0], "PAUSE");
});

test("a refused start (eight timers) is reported and leaves the screen sensible", () => {
  const errors = [];
  const r = openTimer(rig({ progress: { tool: "timer", lastTimer: 600 } }));
  r.ctx.error = (e) => errors.push(e.message);
  for (let i = 0; i < 8; i++) r.ctx.command("timer", { op: "create", seconds: 600, label: "X" + i });
  r.hand.to("NEW TIMER").hold();
  return (async () => {
    await r.hand.hold(); // START 10 MIN / LAST
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(r.ctx.state().timers.length, 8);
    assert.match(errors.join(), /Eight timers/);
    // adding a minute needs a ninth: refused, and the old timer survives
    r.hand.to("ADD 1 MIN"); await r.hand.hold(); await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(r.ctx.state().timers.length, 8);
    assert.ok(r.ctx.state().timers.every((t) => t.duration === 600));
  })();
});

test("service restart: timers come back from the database and the tool carries on", () => {
  const r = openTimer(rig({ progress: { tool: "timer", lastTimer: 900 } }));
  r.hand.hold(); r.advance(60000);
  const id = r.ctx.state().timers[0].id;
  r.ctx.command("timer", { op: "create", seconds: 120, label: "TEA" });
  r.hand.to("NEXT TIMER").hold();
  const service = r.svc.restart();
  assert.equal(r.ctx.state().timers.length, 2);
  assert.ok(r.ctx.state().timers.some((t) => t.id === id));
  r.advance(1000);
  assert.match(r.ctx.calls.content.at(-1), /14:5[0-9]|13:5[0-9]|14:0\d/);
  assert.ok(lit(r.ctx.calls.leds.at(-1)));
  // a restart with nothing stored shows the start list
  const empty = rig({ progress: { tool: "timer" } });
  openTimer(empty);
  assert.equal(empty.hand.label, "START 5 MIN / LAST");
  assert.ok(service);
});

test("the last length is remembered and survives a restart of the app", () => {
  const r = openTimer(rig({ progress: { tool: "timer" } }));
  r.hand.to("DIAL").hold(); r.hand.tap(2); r.hand.hold(); r.hand.tap(7); r.hand.hold();
  assert.equal(r.ctx.state().timers[0].duration, 27 * 60);
  const saved = r.ctx.calls.saved.at(-1);
  assert.equal(saved.lastTimer, 1620); assert.equal(saved.tool, "timer");
  const next = rig({ progress: saved });
  openTimer(next);
  assert.equal(next.hand.label, "START 27 MIN / LAST");
});

test("the dial: taps add minutes and ten minutes, lamps count along, mistakes are fixed cheaply", () => {
  const r = openTimer(rig());
  r.hand.to("DIAL").hold();
  assert.deepEqual(r.hand.labels, ["TENS SET / NEXT"]);
  assert.match(r.ctx.calls.content.at(-1), /cad-dial-on">0</);
  r.hand.tap(3);
  assert.match(r.ctx.calls.content.at(-1), /cad-dial-on">3</);
  assert.ok(lit(r.ctx.calls.leds.at(-1)), "the lamps count along");
  const tensLamps = r.ctx.calls.leds.at(-1);
  r.hand.hold(); // units
  assert.deepEqual(r.hand.labels, ["START 30 MIN"], "thirty minutes already: START, not BACK");
  r.hand.tap(1);
  assert.match(r.ctx.calls.content.at(-1), /cad-dial-on">1</);
  const unitsLamps = r.ctx.calls.leds.at(-1);
  assert.notDeepEqual(unitsLamps, tensLamps, "the bar grows with each tap");
  assert.ok(Math.max(...unitsLamps) <= 90);
});

test("the dial: a stage is a single action, so the host's own tap does nothing to the highlight", () => {
  const r = openTimer(rig());
  r.hand.to("DIAL").hold();
  r.hand.tap(2);
  assert.equal(r.app.tm.dial.tens, 2);
  assert.equal(r.hand.items.length, 1);
  r.hand.hold();
  assert.equal(r.app.tm.dial.stage, 1);
  r.hand.tap(9); assert.equal(r.app.tm.dial.units, 9);
  r.hand.tap(1); assert.equal(r.app.tm.dial.units, 0, "units wrap after nine");
  assert.equal(r.hand.label, "START 20 MIN");
  r.hand.tap(5);
  r.hand.hold();
  assert.equal(r.svc.commands.at(-1)[1].seconds, 25 * 60);
});

test("the dial leaves cleanly at zero: BACK returns to the start list", () => {
  const r = openTimer(rig());
  r.hand.to("DIAL").hold(); r.hand.hold(); // tens stay 0, on to the units
  assert.deepEqual(r.hand.labels, ["BACK"]);
  r.hand.hold();
  assert.equal(r.hand.label, "DIAL / TAP ADDS MINUTES", "back on the row it came from");
  assert.equal(r.svc.commands.length, 0);
});

test("MORE LENGTHS lists every ready-made length once and returns to its own row", () => {
  const r = openTimer(rig());
  r.hand.to("MORE").hold();
  assert.equal(r.hand.labels.length, TIMER_MORE.length + 1);
  assert.deepEqual(r.hand.labels.slice(0, -1), TIMER_MORE.map((s) => "START " + lengthLabel(s)));
  assert.ok(r.hand.labels.length <= 8);
  r.hand.to("BACK").hold();
  assert.equal(r.hand.label, "MORE LENGTHS");
  assert.equal(TIMER_PRESETS.length, 4);
});

test("every timer screen runs every action without throwing and keeps the lamps valid", () => {
  const r = openTimer(rig());
  const seen = new Set();
  const visit = (depth) => {
    if (depth > 4) return;
    for (const item of [...r.ctx.currentActions]) {
      if (/RETURN TO DASHBOARD|^BACK$/.test(item.label) && depth > 1) continue;
      if (seen.size > 300) return;
      seen.add(item.label);
      item.run();
      r.advance(700);
      assert.ok(valid(r.ctx.calls.leds.at(-1) || Array(9).fill(0)));
      assert.ok(r.ctx.calls.content.every((h) => !/NaN|undefined/.test(h)));
      visit(depth + 1);
    }
  };
  visit(1);
  assert.ok(seen.size > 8);
});

// ---- the menu gesture ----

test("two quick taps and a hold taken as the menu gesture leave no lap, tempo or dial minute behind", () => {
  // stopwatch: laps are taken back
  let r = rig({ progress: { tool: "stop" } });
  r.hand.hold(); r.hand.hold(); // open STOPWATCH, START
  r.advance(2000);
  r.hand.tap(1, 250); r.hand.tap(1, 250); // two quick taps: two laps
  assert.equal(r.app.sw.laps.length, 2);
  r.app.event({ type: "button", pressed: true, source: "node", at_us: 9e6 }); // the hold begins
  r.app.cancel(); // the host took it as the menu gesture
  assert.equal(r.app.sw.laps.length, 0, "the laps made by the gesture are undone");
  assert.equal(r.app.sw.running, true, "the stopwatch itself is untouched");

  // laps taken long before are kept
  r = rig({ progress: { tool: "stop" } });
  r.hand.hold(); r.hand.hold(); r.advance(2000);
  r.hand.tap(1, 250); r.advance(5000); // a lap, then a pause of five seconds
  r.app.event({ type: "button", pressed: true, source: "node", at_us: 9e6 });
  r.app.cancel();
  assert.equal(r.app.sw.laps.length, 1, "an old lap is not part of the gesture");

  // tap tempo: the tempo goes back
  r = rig({ progress: { tool: "metro", bpm: 100 } });
  r.hand.hold(); r.hand.to("TAP TEMPO").hold();
  const before = r.app.bpm;
  r.hand.tap(1, 300); r.hand.tap(1, 300); r.hand.tap(1, 300);
  assert.notEqual(r.app.bpm, before, "three taps set a tempo");
  r.app.event({ type: "button", pressed: true, source: "node", at_us: 9e6 });
  r.app.cancel();
  assert.equal(r.app.bpm, before, "the gesture's taps are taken back");

  // the dial: minutes go back
  r = rig({ progress: { tool: "timer" } });
  r.hand.hold(); r.hand.to("DIAL").hold(); r.hand.hold(); // units stage
  r.hand.tap(2, 250);
  assert.equal(r.app.tm.dial.units, 2);
  r.app.event({ type: "button", pressed: true, source: "node", at_us: 9e6 });
  r.app.cancel();
  assert.equal(r.app.tm.dial.units, 0);
  assert.equal(r.svc.commands.length, 0, "no timer was created");
});

test("a gesture cannot start, pause, add to or remove a service timer", () => {
  const r = openTimer(rig({ progress: { tool: "timer", lastTimer: 600 } }));
  r.hand.hold();
  const commands = r.svc.commands.length, snapshot = JSON.stringify(r.ctx.state().timers);
  for (const row of [0, 1, 2]) {
    r.hand.tap(1, 250); r.hand.tap(1, 250);
    r.app.event({ type: "button", pressed: true, source: "node", at_us: 9e6 + row });
    r.app.cancel();
  }
  assert.equal(r.svc.commands.length, commands);
  assert.equal(JSON.stringify(r.ctx.state().timers), snapshot);
});

test("cancel with nothing to take back, or after the system menu, does nothing and never throws", () => {
  const r = openTimer(rig());
  r.app.cancel(); r.app.cancel();
  r.app.pause(); r.app.cancel(); r.app.resume();
  r.app.dispose(); r.app.cancel();
  assert.deepEqual(r.ctx.calls.leds.at(-1) || Array(9).fill(0), Array(9).fill(0));
});

test("openTool lets the host land on the timer directly", () => {
  const r = rig({ progress: {} });
  r.app.openTool("timer");
  assert.equal(r.hand.label, "START 5 MIN / LAST");
  r.app.openTool("nonsense");
  assert.equal(r.hand.label, "START 5 MIN / LAST");
});
