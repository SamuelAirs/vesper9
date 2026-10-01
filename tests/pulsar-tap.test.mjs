// Pulsar's tap lane: with knock input on, beats in the right lane are struck by tapping the case.
// Knocks arrive late (the node decides about 90 ms after the tap) and are judged at the node's time.
import test from "node:test";
import assert from "node:assert/strict";
import { Pulsar } from "../web/apps/pulsar.js";
import { appContext, fakeCanvas, run } from "./helpers/app-context.mjs";

const OFFSET = Pulsar.INPUT_OFFSET;
const NODE_MS = -5000; // the node's clock runs 5 s behind the host's in these tests
const tapCtx = (seed, extra = {}) => appContext({ seed, settings: { knock: "medium" }, ...extra });
// Host ms follow the game's own animation clock, so knock timing is exact and deterministic.
const rig = (app) => { app.clock = () => app.t * 1000; return app; };
const press = (app, lagMs = 3) => app.down({ at_us: (app.t * 1000 - lagMs + NODE_MS) * 1000 });

// A bot that presses for button beats and taps the case for tap beats; each knock reaches the game
// `knockLagMs` after the tap, stamped with the node's time of the tap.
function play(app, seconds, { knockLagMs = 100, jitter = 0.03 } = {}) {
  let s = 99;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const knocks = [];
  let pressing = false, release = 0, plan = null;
  press(app);
  run(app, seconds, () => {
    while (knocks.length && app.t * 1000 >= knocks[0].arrive) app.knock({ at_us: knocks.shift().at_us, peak: 9000 });
    if (app.phase !== "play") return;
    if (pressing && app.song - OFFSET >= release) { app.up(); pressing = false; }
    if (!plan || plan.state !== "pending") {
      plan = app.notes.find((n) => n.state === "pending" && !n.bot) || null;
      if (plan) { plan.bot = true; plan.aim = plan.t + (plan.tap ? 0 : OFFSET) + (rnd() * 2 - 1) * jitter; }
    }
    if (plan && app.song >= plan.aim) {
      if (plan.tap) {
        const at = app.t * 1000;
        knocks.push({ arrive: at + knockLagMs, at_us: (at + NODE_MS) * 1000 });
        plan = null;
      } else if (!pressing) {
        press(app);
        pressing = true;
        release = plan.len > 0 ? plan.t + plan.len : app.song - OFFSET + 0.06;
        plan = null;
      }
    }
  });
}

test("knock input off: no tap lane, and a knock does nothing", () => {
  const app = rig(new Pulsar(appContext({ seed: 4 })));
  assert.equal(app.tapMode, false);
  press(app);
  run(app, 20);
  assert.ok(app.notes.every((n) => !n.tap));
  const before = { score: app.score, stray: app.stray };
  app.knock({ at_us: 1, peak: 9000 });
  assert.deepEqual({ score: app.score, stray: app.stray }, before);
  assert.deepEqual(app.menuActions(), [], "no TAP LANE choice without knock input");
});

test("knock input on: the right lane is struck by the case, with the same rhythm and no holds there", () => {
  const rhythm = (ctx) => {
    const app = rig(new Pulsar(ctx));
    press(app);
    run(app, 80, () => app.notes.forEach((n) => { if (n.state === "pending") n.state = "done"; }));
    return app;
  };
  const plain = rhythm(appContext({ seed: 12 })), tapped = rhythm(tapCtx(12));
  assert.equal(tapped.tapMode, true);
  assert.equal(tapped.notes.map((n) => n.t.toFixed(3) + n.lane).join(), plain.notes.map((n) => n.t.toFixed(3) + n.lane).join());
  assert.ok(tapped.notes.some((n) => n.tap), "some beats are tap beats");
  for (const n of tapped.notes) {
    assert.equal(n.tap, n.lane === 2);
    if (n.tap) assert.equal(n.len, 0, "a tap beat is never a hold");
  }
});

test("a late knock is judged when the tap happened; the button cannot strike a tap beat", () => {
  const app = rig(new Pulsar(tapCtx(5)));
  press(app); // begin; also tells the game how the node's clock lines up with ours
  const target = () => app.notes.find((n) => n.state === "pending" && n.tap);
  run(app, 0.1);
  while (!target()) run(app, 0.5, () => app.notes.forEach((n) => { if (!n.tap && n.state === "pending" && n.t < app.song + 2) n.state = "done"; }));
  const n = target();
  for (const x of app.notes) if (x !== n && x.t < n.t + 1) x.state = "done";
  // The button at exactly the right moment is a stray input, not a hit.
  run(app, n.t - app.song + OFFSET);
  const stray = app.stray;
  press(app); app.up();
  assert.equal(n.state, "pending");
  assert.equal(app.stray, stray + 1);
  // The tap at the right moment, reported 110 ms later: perfect.
  const tapAt = app.t * 1000 - OFFSET * 1000;
  run(app, 0.11);
  assert.equal(n.state, "pending", "still waiting for the knock, not yet a miss");
  app.knock({ at_us: (tapAt + NODE_MS) * 1000, peak: 9000 });
  assert.equal(n.state, "done");
  assert.equal(app.judge.text, "PERFECT");
});

test("an unanswered tap beat becomes a miss only after its grace for a late knock", () => {
  const app = rig(new Pulsar(tapCtx(5)));
  press(app);
  run(app, 40, () => { for (const n of app.notes) if (!n.tap && n.state === "pending") n.state = "done"; });
  const missed = app.notes.filter((n) => n.tap && n.state === "missed");
  assert.ok(missed.length > 0);
  assert.ok(app.counts.miss >= missed.length);
});

test("a bot that taps the case for tap beats clears the song, even with knocks arriving 120 ms late", () => {
  const app = rig(new Pulsar(tapCtx(11)));
  play(app, 175, { knockLagMs: 120 });
  assert.equal(app.phase, "over");
  assert.ok(app.cleared, "signal resolved");
  assert.ok(app.accuracy > 0.9, "accuracy " + app.accuracy);
  assert.ok(app.stray < 5, "stray inputs " + app.stray);
});

test("before any press calibrates the clocks a knock is assumed to be about 100 ms old", () => {
  const app = rig(new Pulsar(tapCtx(3)));
  assert.equal(app.knockLateness({ at_us: 123 }), Pulsar.TAP_LATENCY);
  press(app, 2);
  run(app, 1);
  assert.ok(Math.abs(app.knockLateness({ at_us: (app.t * 1000 - 90 + NODE_MS) * 1000 }) - 0.088) < 0.001, "90 ms, less the 2 ms the press took to arrive");
});

test("the TAP LANE menu choice switches the lane off for the session, and draws without errors", () => {
  const ctx = tapCtx(8);
  const app = rig(new Pulsar(ctx));
  const g = fakeCanvas();
  app.draw(g);
  const [choice] = app.menuActions();
  assert.match(choice.label, /TAP LANE ON/);
  choice.run();
  assert.equal(app.tapMode, false);
  assert.equal(app.phase, "title");
  assert.match(app.menuActions()[0].label, /TAP LANE OFF/);
  app.menuActions()[0].run();
  assert.equal(app.tapMode, true);
  press(app);
  run(app, 30, () => app.draw(g));
  assert.ok(ctx.calls.leds.every((v) => v.length === 9));
});
