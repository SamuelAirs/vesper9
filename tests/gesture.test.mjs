// The one menu gesture: tap, tap, hold (web/engine/input.js). The router at each pace, near misses on every
// timing boundary, the navigation rule (two thresholds), Morse keying at every speed, node timestamps in a
// burst, source ownership, the held-back saves and the snapshot helper that make apps tolerate the gesture.
import test from "node:test";
import assert from "node:assert/strict";
import { InputRouter, GESTURE_PACES, GestureTimeline, AppGuard, gestureHoldMs, playHoldMs, PLAY_HOLD_EXTRA_MS, FALLBACK_HOLD_MS, SELECT_MARGIN_MS, knockSide } from "../web/engine/input.js";
import { MorseSchool, MORSE } from "../web/apps/morse.js";
import { appContext } from "./helpers/app-context.mjs";

const PACES = Object.keys(GESTURE_PACES);

// A router with a host like main.js: `mode` raw (a game) or menu (dashboard, instrument, menu), eight
// highlightable items, and every call recorded. Time is in ms and only moves when the test says.
function rig({ pace = "standard", holdMs = 650, mode = "raw" } = {}) {
  let now = 0, index = 0;
  const log = [], items = 8;
  const host = {
    epoch: 0, mode, holdMs: () => holdMs, escapePolicy: () => ({ pace }),
    inputMode() { return this.mode; },
    pressVisual() {}, clickVisual(n) { log.push(["clicks", n]); },
    holdVisual(ratio, ready, armed) { log.push(["hold", +ratio.toFixed(3), ready, armed]); },
    advance(step = 1) { index = (((index + step) % items) + items) % items; log.push(["advance", index]); },
    select() { log.push(["select", index]); },
    rawDown: (e) => log.push(["down", e.at_us]), rawUp: (e) => log.push(["up", e.durationMs]), rawCancel: () => log.push(["cancel"]),
    focusMark: () => ({ index }),
    requestMenu(via, { focus } = {}) {
      log.push(["menu", via, focus]);
      router.cancel(router.blocked || !!router.press, router.blockSource || router.press?.event.source);
      if (focus) index = focus.index;
      this.epoch++;
    },
  };
  const router = new InputRouter(host, () => now);
  const api = {
    host, router, log, pace: GESTURE_PACES[pace],
    now: () => now, index: () => index,
    count: (name) => log.filter((e) => e === name || (Array.isArray(e) && e[0] === name)).length,
    menus: () => log.filter((e) => e[0] === "menu"),
    at(ms) { now = ms; router.update(); },
    wait(ms, step = 10) { for (let left = ms; left > 0; left -= step) { now += Math.min(step, left); router.update(); } },
    down(source = "node", generation = 1) { router.down({ source, generation, at_us: now * 1000 }); },
    up(source = "node", generation = 1) { router.up({ source, generation, at_us: now * 1000 }); },
    // a complete press: edges stamped with the node clock, the host updating every `step` ms while it is down
    press(ms, opts = {}) { api.down(opts.source, opts.generation); api.wait(ms); api.up(opts.source, opts.generation); },
  };
  return api;
}
// tap, tap, hold: taps of `tap` ms, pauses of `gap` ms, then the third press held `hold` ms (released after)
function gesture(h, { tap, gap, hold, release = true }) {
  h.press(tap); h.wait(gap); h.press(tap); h.wait(gap);
  h.down(); h.wait(hold);
  if (release) h.up();
}

for (const pace of PACES) {
  const p = GESTURE_PACES[pace];
  test(`${pace} pace: tap, tap, hold in a game opens the menu once, edges stay immediate, the release is consumed`, () => {
    const h = rig({ pace });
    gesture(h, { tap: Math.round(p.tapMs * 0.6), gap: Math.round(p.gapMs * 0.6), hold: playHoldMs(p) + 30 });
    assert.equal(h.menus().length, 1);
    assert.equal(h.count("down"), 3, "all three presses reached the game as they happened");
    assert.equal(h.count("up"), 2, "the third release was consumed");
    assert.equal(h.log.at(-1)[0] === "up", false, "nothing reached the game after the menu opened");
    // The menu opened when the hold reached the threshold, not at the release.
    const opened = h.log.findIndex((e) => e[0] === "menu");
    assert.ok(opened >= 0 && h.log.slice(opened).every((e) => e[0] !== "up" && e[0] !== "down"));
    // The router is usable again at once.
    h.host.mode = "raw"; h.wait(50); h.press(60);
    assert.equal(h.count("down"), 4);
  });

  test(`${pace} pace: the boundaries are exact (tap length, both pauses, hold length)`, () => {
    const run = (tap, gap1, gap2, hold) => {
      const h = rig({ pace });
      h.press(tap); h.wait(gap1); h.press(tap); h.wait(gap2); h.down(); h.wait(hold); h.up();
      return h.menus().length;
    };
    const { tapMs, gapMs } = p, holdMs = playHoldMs(p);
    assert.equal(run(tapMs, gapMs, gapMs, holdMs), 1, "every limit exactly met");
    assert.equal(run(tapMs + 1, gapMs, gapMs, holdMs + 50), 0, "first tap one millisecond too long");
    assert.equal(run(8, gapMs, gapMs, holdMs), 1, "the shortest tap counts");
    assert.equal(run(7, gapMs, gapMs, holdMs + 50), 0, "a bounce is no tap");
    assert.equal(run(tapMs, gapMs + 1, gapMs, holdMs + 50), 0, "first pause one millisecond too long");
    assert.equal(run(tapMs, gapMs, gapMs + 1, holdMs + 50), 0, "second pause one millisecond too long");
    assert.equal(run(tapMs, gapMs, gapMs, holdMs - 10), 0, "hold short of the threshold");
    // Near misses of the second tap alone.
    const h = rig({ pace });
    h.press(tapMs); h.wait(gapMs); h.press(tapMs + 1); h.wait(gapMs); h.down(); h.wait(holdMs + 100); h.up();
    assert.equal(h.menus().length, 0, "second tap one millisecond too long");
  });

  test(`${pace} pace: a game never sees a plain long hold, one tap, three taps or four taps as the gesture`, () => {
    const hold = (taps) => {
      const h = rig({ pace });
      for (let i = 0; i < taps; i++) { h.press(60); h.wait(60); }
      h.down(); h.wait(4000); h.up();
      return h.menus().length;
    };
    assert.deepEqual([0, 1, 3, 4, 6].map(hold), [0, 0, 0, 0, 0]);
    assert.equal(hold(2), 1);
  });
}

test("a press that is only a hold, for any length in a game, is an ordinary hold (Undertow is played that way)", () => {
  const h = rig();
  h.down(); h.wait(20000); h.up();
  assert.equal(h.menus().length, 0);
  assert.equal(h.log.find((e) => e[0] === "up")[1], 20000);
});

// ------------------------------------------------------------------------------------------ navigation
test("navigation: a tap moves, a hold chooses, and the plain 3 s hold is a silent fallback", () => {
  const h = rig({ mode: "menu" });
  h.press(80);
  assert.deepEqual(h.log.filter((e) => e[0] === "advance"), [["advance", 1]]);
  h.wait(400); h.down(); h.wait(700); h.up();
  assert.equal(h.count("select"), 1);
  h.wait(400); h.down(); h.wait(FALLBACK_HOLD_MS + 10); h.up();
  assert.equal(h.menus().length, 1);
  assert.equal(h.menus()[0][1], "hold", "the fallback is reported as a plain hold, not the gesture");
  assert.equal(h.menus()[0][2], null, "the fallback does not move the highlight back");
  assert.equal(h.count("select"), 1, "its release chose nothing");
});

for (const pace of PACES) {
  const p = GESTURE_PACES[pace];
  test(`navigation, ${pace} pace: tap, tap, hold opens the menu, puts the highlight back, and chooses nothing`, () => {
    const h = rig({ pace, mode: "menu" });
    h.wait(300); h.press(60); h.wait(60); h.press(60); h.wait(60); h.down();
    assert.equal(h.index(), 2, "the two taps moved the highlight");
    h.wait(gestureHoldMs(p, 650) + 40); h.up();
    assert.equal(h.menus().length, 1);
    assert.deepEqual(h.menus()[0].slice(1), ["gesture", { index: 0 }], "the host is told where the highlight stood before the first tap");
    assert.equal(h.index(), 0);
    assert.equal(h.count("select"), 0, "nothing was chosen");
    assert.equal(h.count("advance"), 2, "no extra step either");
  });

  test(`navigation, ${pace} pace: a deliberate tap, tap, choose is never mistaken for the gesture (holds of 0.65 s up to just under the threshold choose)`, () => {
    for (const [tap, gap] of [[120, 350], [140, 500], [100, 250], [Math.min(p.tapMs, 140), p.gapMs], [80, 90]]) {
      for (const hold of [650, 700, 800, gestureHoldMs(p, 650) - 50]) {
        const h = rig({ pace, mode: "menu" });
        h.wait(300); h.press(tap); h.wait(gap); h.press(tap); h.wait(gap); h.down(); h.wait(hold); h.up();
        assert.equal(h.menus().length, 0, `taps ${tap} pauses ${gap} hold ${hold}`);
        assert.equal(h.count("select"), 1, `taps ${tap} pauses ${gap} hold ${hold} should choose`);
      }
    }
  });

  test(`navigation, ${pace} pace: the gesture's hold must run ${SELECT_MARGIN_MS} ms past the selection threshold, whatever it is set to`, () => {
    for (const holdMs of [450, 650, 1000, 1200]) {
      const threshold = gestureHoldMs(p, holdMs);
      assert.ok(threshold >= holdMs + SELECT_MARGIN_MS && threshold >= p.holdMs);
      const h = rig({ pace, mode: "menu", holdMs });
      h.wait(300); h.press(60); h.wait(60); h.press(60); h.wait(60); h.down(); h.wait(threshold - 20); h.up();
      assert.equal(h.menus().length, 0, `holdMs ${holdMs}: just short of ${threshold}`);
      assert.equal(h.count("select"), 1);
      const g = rig({ pace, mode: "menu", holdMs });
      g.wait(300); g.press(60); g.wait(60); g.press(60); g.wait(60); g.down(); g.wait(threshold + 20); g.up();
      assert.equal(g.menus().length, 1, `holdMs ${holdMs}: past ${threshold}`);
      assert.equal(g.count("select"), 0);
    }
  });

  test(`navigation, ${pace} pace: slower stepping (taps or pauses past the limits) never arms the hold`, () => {
    const h = rig({ pace, mode: "menu" });
    h.wait(300); h.press(p.tapMs + 20); h.wait(60); h.press(60); h.wait(60); h.down(); h.wait(2000); h.up();
    assert.equal(h.menus().length, 0);
    const g = rig({ pace, mode: "menu" });
    g.wait(300); g.press(60); g.wait(p.gapMs + 20); g.press(60); g.wait(60); g.down(); g.wait(2000); g.up();
    assert.equal(g.menus().length, 0);
  });
}

test("navigation: the highlight is restored by the mark taken at the first tap, not at the third press", () => {
  const h = rig({ mode: "menu" });
  h.wait(300);
  for (let i = 0; i < 3; i++) { h.press(60); h.wait(500); } // three ordinary steps: 0 -> 3
  h.press(60); h.wait(60); h.press(60); h.wait(60); h.down(); h.wait(1100); h.up();
  assert.deepEqual(h.menus()[0][2], { index: 3 });
  assert.equal(h.index(), 3);
});

test("the hold bar and lamps are told when the third press is being counted", () => {
  const h = rig();
  h.press(60); h.wait(60); h.press(60); h.wait(60); h.down();
  h.wait(800);
  const bars = h.log.filter((e) => e[0] === "hold");
  assert.ok(bars.length > 10 && bars.every((e) => e[3] === true), "armed from the third press");
  assert.ok(bars.at(-1)[1] > 0.45 && bars.at(-1)[1] < 0.55, "half way after half the hold");
  assert.deepEqual(h.log.filter((e) => e[0] === "clicks").map((e) => e[1]).slice(0, 2), [1, 2], "one dot per tap");
  const state = h.router.gestureState();
  assert.ok(state.armed && state.thresholdMs === 1600 && state.progress > 0.45);
  h.wait(900);
  assert.equal(h.router.gestureState().armed, false, "once the menu opened there is nothing left to count");
});

// -------------------------------------------------------------------------------- node timestamps
test("node timestamps judge the spacing: a burst of old events is read by their own clock", () => {
  const stamp = (h, at, ms, source = "node") => { h.router.down({ source, generation: 1, at_us: at * 1000 }); h.router.up({ source, generation: 1, at_us: (at + ms) * 1000 }); };
  // Delivered together, but stamped 130 ms apart on the node: a gesture's two taps. The hold is real time.
  const h = rig();
  stamp(h, 5000, 60); stamp(h, 5130, 60);
  h.router.down({ source: "node", generation: 1, at_us: 5260 * 1000 }); h.wait(1620);
  assert.equal(h.menus().length, 1);
  // Delivered together, stamped a second apart: not rapid.
  const g = rig();
  stamp(g, 0, 60); stamp(g, 1000, 60);
  g.router.down({ source: "node", generation: 1, at_us: 2000 * 1000 }); g.wait(2100);
  assert.equal(g.menus().length, 0);
  // The whole gesture arrives late, in one burst, with a hold stamped long enough: it completes on release.
  const b = rig();
  stamp(b, 9000, 60); stamp(b, 9130, 60);
  b.router.down({ source: "node", generation: 1, at_us: 9260 * 1000 });
  b.router.up({ source: "node", generation: 1, at_us: 10900 * 1000 });
  assert.equal(b.menus().length, 1);
  assert.equal(b.count("up"), 2, "the third release was consumed");
});

test("stamps that run backwards, or stamps from two clocks, never build a gesture", () => {
  const h = rig();
  h.router.down({ source: "node", generation: 1, at_us: 9e6 }); h.router.up({ source: "node", generation: 1, at_us: 9.06e6 });
  h.router.down({ source: "node", generation: 1, at_us: 1e6 }); h.router.up({ source: "node", generation: 1, at_us: 1.06e6 }); // node reset
  h.router.down({ source: "node", generation: 1, at_us: 1.2e6 }); h.wait(2100);
  assert.equal(h.menus().length, 0);
});

// ------------------------------------------------------------------------------------ ownership
test("source ownership: a release from another source, a different source, generation or epoch breaks the gesture", () => {
  for (const scenario of ["release", "source", "generation", "epoch", "connection"]) {
    const h = rig();
    h.press(60); h.wait(60);
    if (scenario === "source") h.press(60, { source: "keyboard" }); else h.press(60);
    h.wait(60);
    if (scenario === "epoch") h.host.epoch++;
    if (scenario === "connection") h.router.cancel();
    h.down(scenario === "release" ? "node" : "node", scenario === "generation" ? 2 : 1);
    if (scenario === "release") { h.router.up({ source: "keyboard", generation: 1, at_us: h.now() * 1000 }); assert.ok(h.router.press, "a keyboard release does not end a node press"); }
    h.wait(2100);
    if (scenario === "release") assert.equal(h.menus().length, 1, "the node press itself still completes");
    else assert.equal(h.menus().length, 0, scenario);
  }
  // A press from the keyboard is a whole gesture of its own, from the keyboard.
  const k = rig();
  k.press(60, { source: "keyboard" }); k.wait(60); k.press(60, { source: "keyboard" }); k.wait(60); k.down("keyboard"); k.wait(1700);
  assert.equal(k.menus().length, 1);
});

test("a node reset or a lost link in the middle of the gesture forgets it, and the held press is cancelled", () => {
  const h = rig();
  h.press(60); h.wait(60); h.press(60); h.wait(60); h.down();
  h.router.cancel(true, "node"); // main.js does this on node_reset and device loss
  h.wait(2000);
  assert.equal(h.menus().length, 0);
  h.router.reconcile(false, "node");
  h.wait(100); h.press(60);
  assert.equal(h.count("down"), 4, "input is back after the release");
});

test("repeat events (a held key) are ignored", () => {
  const h = rig();
  h.press(60); h.wait(60); h.press(60); h.wait(60);
  h.router.down({ source: "keyboard", repeat: true });
  h.down(); h.router.down({ source: "node", generation: 1, repeat: true }); h.wait(1700); h.up();
  assert.equal(h.menus().length, 1);
  assert.equal(h.count("down"), 3);
});

// The review found two quick taps and then a long press opening the menu mid-run (Undertow feathering
// thrust, Perihelion's two taps and a long swing). In a game the hold is longer; in menus it is not.
test("in a game the gesture needs the longer play hold; menus keep the shorter one", () => {
  for (const pace of PACES) {
    const p = GESTURE_PACES[pace];
    assert.equal(playHoldMs(p), p.holdMs + PLAY_HOLD_EXTRA_MS);
    const game = rig({ pace });
    gesture(game, { tap: 60, gap: 60, hold: p.holdMs + 300 });
    assert.equal(game.menus().length, 0, `${pace}: a ${p.holdMs + 300} ms swing after two taps stays in the game`);
    assert.equal(game.count("up"), 3, "and its release reached the game");
    const swing = rig({ pace });
    gesture(swing, { tap: 60, gap: 60, hold: playHoldMs(p) + 20 });
    assert.equal(swing.menus().length, 1, `${pace}: held past ${playHoldMs(p)} ms it opens`);
    const menu = rig({ pace, mode: "menu" });
    gesture(menu, { tap: 60, gap: 60, hold: gestureHoldMs(p, 650) + 20, release: false });
    assert.equal(menu.menus().length, 1, `${pace}: in a menu the shorter hold still opens it`);
  }
});

// ------------------------------------------------------------------------------------ Morse keying
// Keying at the speed's own timing (dot one unit, dash three, one unit between elements, three between
// letters) never reaches the gesture, at any speed or pace; jitter of 25 % does not change that either.
const WPM = [5, 10, 15, 20, 25];
test("Morse keying at 5, 10, 15, 20 and 25 words per minute is never taken for the gesture", () => {
  const phrases = ["U", "S O S", "V", "DOT DOT DASH: I T", "E E T", "H", "S", "B", "SOS SOS", "PARIS PARIS", "I I I M"];
  let keyed = 0, longest = 0;
  for (const pace of PACES) for (const wpm of WPM) for (const jitter of [0, 0.25]) {
    const unit = 1200 / wpm;
    let seed = wpm * 7 + (jitter ? 3 : 0);
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const j = (ms) => Math.round(ms * (1 + (rnd() * 2 - 1) * jitter));
    const h = rig({ pace });
    for (const phrase of phrases) for (const ch of phrase) {
      if (!MORSE[ch]) { h.wait(j(unit * 7)); continue; }
      for (const symbol of MORSE[ch]) {
        const ms = j(unit * (symbol === "." ? 1 : 3));
        h.press(ms); keyed++; longest = Math.max(longest, ms);
        h.wait(j(unit));
      }
      h.wait(j(unit * 2)); // a letter gap is three units in all
    }
    assert.equal(h.menus().length, 0, `pace ${pace}, ${wpm} wpm, jitter ${jitter}`);
  }
  assert.ok(keyed > 2000);
  // The slowest speed's dash is 720 ms (nominal) and at most 900 ms with jitter: clear of every threshold.
  assert.ok(longest <= 900 + 1, "longest key-down " + longest);
});

test("Morse dot, dot, dash is not the gesture at any speed (and a dot is only a tap where it is short enough)", () => {
  for (const pace of PACES) for (const wpm of WPM) {
    const unit = 1200 / wpm, h = rig({ pace });
    h.press(unit); h.wait(unit); h.press(unit); h.wait(unit); h.press(unit * 3); h.wait(unit * 3);
    assert.equal(h.menus().length, 0, `${pace} ${wpm} wpm`);
  }
  // At 5 wpm a dot (240 ms) is longer than any pace's tap limit, so those dots are never taps at all.
  assert.ok(1200 / 5 > Math.max(...Object.values(GESTURE_PACES).map((p) => p.tapMs)));
  // A dot can only be a tap when it is no longer than the pace's tap limit; the dash at that speed is three
  // times as long, and it stays well short of the hold the gesture needs.
  for (const p of Object.values(GESTURE_PACES)) assert.ok(3 * p.tapMs <= p.holdMs - 200, "the longest dash that can follow two taps is clear of the hold");
});

test("Signal School stops its sidetone once a press is clearly longer than a dash, at every speed", () => {
  for (const wpm of WPM) {
    const ctx = appContext({ seed: 1, settings: { morseWpm: wpm } });
    let tone = false;
    ctx.synth.startTone = () => { tone = true; }; ctx.synth.stopTone = () => { tone = false; };
    const g = new MorseSchool(ctx);
    for (let f = 0; f < 3 * 60; f++) g.update(1 / 60);
    g.phase = "key"; g.nextDelay = 0;
    const unit = 1200 / wpm;
    g.down(); assert.ok(tone, "keying sounds the tone");
    let at = 0;
    for (; tone && at < 5000; at += 1000 / 60) g.update(1 / 60);
    assert.ok(at > unit * 3, `${wpm} wpm: the tone outlasts a dash (${Math.round(at)} ms against ${Math.round(unit * 3)})`);
    assert.ok(at <= unit * 5 + 40, `${wpm} wpm: and stops soon after (${Math.round(at)} ms)`);
    g.up({ durationMs: at + 300 });
    assert.equal(g.input.endsWith("-"), true, "a long press is still a dash");
  }
});

test("Signal School keeps the partial letter and its place when a gesture is taken back", () => {
  const ctx = appContext({ seed: 2, settings: { morseWpm: 10 } });
  const g = new MorseSchool(ctx);
  g.phase = "key"; g.nextDelay = 0; g.input = ""; g.gap = 0;
  const tapKey = (ms) => { g.down(); for (let i = 0; i < Math.round(ms / 16.7); i++) g.update(1 / 60); g.up({ durationMs: ms }); };
  tapKey(120); for (let i = 0; i < 5; i++) g.update(1 / 60);
  assert.equal(g.input, ".");
  // tap, tap, hold: two more dots, then the host cancels and pauses
  for (let i = 0; i < 2; i++) { tapKey(80); for (let f = 0; f < 3; f++) g.update(1 / 60); }
  g.down(); for (let f = 0; f < 60; f++) g.update(1 / 60);
  g.cancel(); g.pause(); g.resume();
  assert.equal(g.input, ".", "the letter keyed before the gesture is as it was");
});

// -------------------------------------------------------------------------- timeline and the guard
test("GestureTimeline.match needs two quick taps and a third press held, nothing else", () => {
  const line = (settings = {}) => new GestureTimeline(() => settings);
  const fill = (l, spec) => spec.forEach(([at, up]) => { l.mark(at, at); if (up !== undefined) l.release(up); });
  let l = line(); fill(l, [[0, 0.07], [0.12, 0.19], [0.24]]);
  assert.equal(l.match(1.3)?.state, 0, "returns the first press");
  l = line(); fill(l, [[0, 0.07], [0.12, 0.19], [0.24]]); assert.equal(l.match(0.5), null, "hold not long enough yet");
  l = line(); fill(l, [[0, 0.4], [0.5, 0.57], [0.62]]); assert.equal(l.match(1.7), null, "a first press that was no tap");
  l = line(); fill(l, [[0, 0.07], [0.8, 0.87], [0.92]]); assert.equal(l.match(2), null, "a pause too long");
  l = line(); fill(l, [[0, 0.07], [0.12, 0.19]]); assert.equal(l.match(1.3), null, "two presses only");
  l = line(); fill(l, [[0, 0.07], [0.12, 0.19], [0.24, 0.3]]); assert.equal(l.match(1.3), null, "the third press was released: not the gesture");
  l = line(); fill(l, [[9, 9.05], [0, 0.07], [0.12, 0.19], [0.24]]); assert.equal(l.match(1.3)?.state, 0, "earlier presses do not matter");
  l = line({ gesturePace: "relaxed" }); fill(l, [[0, 0.2], [0.4, 0.6], [0.9]]); assert.equal(l.match(2.1)?.state, 0, "relaxed pace accepts slower taps");
});

test("GestureTimeline.possible says when no gesture that began earlier can still complete", () => {
  const l = new GestureTimeline(() => ({}));
  assert.equal(l.possible(0), false);
  l.mark(0, 0); assert.equal(l.possible(0.1), true, "a press that may still be a tap");
  assert.equal(l.possible(0.5), false, "a press held too long to be a tap and no taps before it");
  l.release(0.07); assert.equal(l.possible(0.2), true, "between taps");
  assert.equal(l.possible(0.6), false, "the pause ran out");
  const t = new GestureTimeline(() => ({}));
  t.mark(0, 0); t.release(0.07); t.mark(0.12, 1); t.release(0.19); t.mark(0.24, 2);
  assert.equal(t.possible(0.9), true, "a third press after two quick taps");
  assert.equal(t.possible(3), false, "held past the gesture");
  t.release(0.7); // held for 0.46 s: not a tap, not the hold
  assert.equal(t.possible(0.8), false, "a third press that was released early is no gesture");
});

test("AppGuard holds back saves only while a gesture could still take them back, and drops what a gesture made", () => {
  const ctx = appContext({ seed: 3 });
  const app = { c: ctx, points: 0, list: [1], held: false };
  const guard = new AppGuard(app, ctx);
  const press = (ms, after = 0.06) => { guard.mark(); app.held = true; for (let i = 0; i < Math.round(ms * 60); i++) guard.tick(1 / 60); guard.release(); app.held = false; for (let i = 0; i < Math.round(after * 60); i++) guard.tick(1 / 60); };
  // No press around: saved at once.
  ctx.saveProgress({ a: 1 }); assert.equal(ctx.calls.saved.length, 1);
  // Between the two taps of a gesture: held back, then released when the chain breaks (no third press).
  press(0.07); ctx.saveProgress({ a: 2 }); ctx.score(5);
  assert.equal(ctx.calls.saved.length, 1); assert.equal(ctx.calls.score.length, 0);
  for (let i = 0; i < 60; i++) guard.tick(1 / 60);
  assert.equal(ctx.calls.saved.length, 2); assert.equal(ctx.calls.score.length, 1, "released once no gesture could include it");
  // A whole gesture: what the app saved from its first tap on is dropped, the state is put back.
  app.points = 10; app.list = [1, 2];
  guard.mark(); app.points = 11; app.list.push(3); app.held = true; for (let i = 0; i < 4; i++) guard.tick(1 / 60); guard.release();
  for (let i = 0; i < 3; i++) guard.tick(1 / 60);
  app.extra = "created later";
  ctx.saveProgress({ purchase: true });
  press(0.07);
  guard.mark(); app.points = 99; for (let i = 0; i < 70; i++) guard.tick(1 / 60);
  assert.equal(guard.rewind(), true);
  assert.equal(app.points, 10); assert.deepEqual(app.list, [1, 2]); assert.equal("extra" in app, false, "a property made since is gone");
  guard.settle();
  assert.ok(!ctx.calls.saved.some((v) => v.purchase), "the purchase the gesture made was never saved");
});

test("AppGuard keeps shared references, leaves instances and the context alone, and puts the random generator back", () => {
  const ctx = appContext({ seed: 4 });
  const shared = { n: 1 };
  class Bus { constructor() { this.value = 7; } }
  const app = { c: ctx, a: [shared], b: shared, bus: new Bus(), table: new Uint8Array(4), m: new Map([[1, { x: 1 }]]) };
  const guard = new AppGuard(app, ctx);
  const before = ctx.rng.state;
  guard.mark(); // the gesture's first tap
  shared.n = 2; app.a.push(9); app.bus.value = 8; app.table[0] = 5; app.m.get(1).x = 2; ctx.rng.next();
  for (let i = 0; i < 4; i++) guard.tick(1 / 60);
  guard.release();
  for (let i = 0; i < 3; i++) guard.tick(1 / 60);
  guard.mark(); for (let i = 0; i < 4; i++) guard.tick(1 / 60); guard.release();
  for (let i = 0; i < 3; i++) guard.tick(1 / 60);
  guard.mark(); for (let i = 0; i < 66; i++) guard.tick(1 / 60);
  assert.equal(guard.rewind(), true);
  assert.equal(app.a[0], app.b, "a property that pointed into another still does");
  assert.equal(app.a[0].n, 1); assert.equal(app.a.length, 1);
  assert.equal(app.bus.value, 8, "a class instance is shared, not restored");
  assert.equal(app.table[0], 0); assert.equal(app.m.get(1).x, 1);
  assert.equal(app.c, ctx);
  assert.equal(ctx.rng.state, before);
});

test("AppGuard snapshots are cheap enough to take at every press", () => {
  const ctx = appContext({ seed: 5 });
  const app = { c: ctx, notes: Array.from({ length: 400 }, (_, i) => ({ t: i, len: 0, lane: i % 3, state: "pending" })), grid: new Uint8Array(4000), phrases: Array.from({ length: 40 }, (_, i) => ({ i })) };
  const guard = new AppGuard(app, ctx);
  const t0 = performance.now();
  for (let i = 0; i < 200; i++) guard.snapshot();
  const each = (performance.now() - t0) / 200;
  assert.ok(each < 2, `a snapshot of a large game takes ${each.toFixed(3)} ms`);
});

// ------------------------------------------------------------------------------- knocks on the case
// Two knocks go back outside a game; one stray knock, a knock near a button press, or knocks too far
// apart never do. In a game a knock is the game's, as PR #4 defined it.
function knockRig(mode = "menu") {
  const h = rig({ mode });
  const backs = [], raw = [];
  h.host.back = (via) => backs.push(via);
  h.host.rawKnock = (e) => raw.push(e);
  h.host.knockVisual = (on) => h.log.push(["knock", on]);
  h.knock = (side, at = h.now()) => h.router.knock({ source: "node", generation: 1, at_us: at * 1000, ...(side ? { side, sideVotes: 5 } : {}) });
  return Object.assign(h, { backs, raw });
}
test("two knocks go back in menus, the dashboard and instruments", () => {
  const h = knockRig();
  h.wait(1000);
  assert.equal(h.knock(), false);
  assert.deepEqual(h.log.at(-1), ["knock", true], "the first knock says a second would go back");
  h.wait(300);
  assert.equal(h.knock(), true);
  assert.deepEqual(h.backs, ["knock"]);
  // Right after a back, nothing counts for a second.
  h.wait(200); h.knock(); h.wait(250); h.knock();
  assert.equal(h.backs.length, 1);
  h.wait(1200); h.knock(); h.wait(250); h.knock();
  assert.equal(h.backs.length, 2);
});
test("one stray knock, knocks too close or too far apart, or near a press, never go back", () => {
  const lone = knockRig(); lone.wait(1000); lone.knock(); lone.wait(3000);
  assert.equal(lone.backs.length, 0);
  assert.deepEqual(lone.log.at(-1), ["knock", false], "the hint clears once a second knock can no longer come");
  const slow = knockRig(); slow.wait(1000); slow.knock(); slow.wait(800); slow.knock();
  assert.equal(slow.backs.length, 0, "800 ms apart is two separate knocks");
  const quick = knockRig(); quick.wait(1000); quick.knock(); quick.wait(60); quick.knock();
  assert.equal(quick.backs.length, 0, "60 ms apart is one ringing knock");
  const pressed = knockRig(); pressed.wait(1000); pressed.press(60); pressed.wait(100); pressed.knock(); pressed.wait(250); pressed.knock();
  assert.equal(pressed.backs.length, 0, "knocks just after a press are the switch, not the player");
  const between = knockRig(); between.wait(1000); between.knock(); between.wait(100); between.press(60); between.wait(100); between.knock();
  assert.equal(between.backs.length, 0, "a press between the knocks breaks the pair");
  const held = knockRig(); held.wait(1000); held.down(); held.wait(600); held.knock(); held.wait(250); held.knock();
  assert.equal(held.backs.length, 0, "never while the button is down");
});
test("in a game a knock goes to the game and never goes back", () => {
  const h = knockRig("raw");
  h.wait(1000); h.knock(); h.wait(250); h.knock();
  assert.equal(h.backs.length, 0);
  assert.equal(h.raw.length, 2);
  assert.equal(h.count("down"), 0, "a knock is not a press");
});

test("inside the system menu tap, tap, hold chooses the third row and never reopens the menu", () => {
  for (const pace of PACES) {
    const p = GESTURE_PACES[pace];
    const h = rig({ pace, mode: "menu" });
    h.host.gestureOff = () => true;
    // Sam's case: two taps down to DASHBOARD, then a hold well past the gesture's, and a release.
    gesture(h, { tap: 60, gap: 60, hold: gestureHoldMs(p, 650) + 400 });
    assert.equal(h.menus().length, 0, pace);
    assert.deepEqual(h.log.filter((e) => e[0] === "select"), [["select", 2]], pace);
    assert.ok(!h.log.some((e) => e[0] === "hold" && e[3]), "the bar never counts towards the menu");
    // Even a very long hold only chooses: no silent fallback over the menu.
    h.wait(400); h.down(); h.wait(FALLBACK_HOLD_MS + 200); h.up();
    assert.equal(h.menus().length, 0, pace);
    assert.equal(h.count("select"), 2, pace);
  }
});

test("knock sides: left and right move the highlight, back and unknown pair up to go back", () => {
  assert.equal(knockSide({ side: "left" }), "left");
  assert.equal(knockSide({ side: "top" }), "back", "the old name for the back spot");
  assert.equal(knockSide({ side: "middle" }), null);
  assert.equal(knockSide({}), null);
  const h = knockRig();
  h.wait(1000);
  assert.equal(h.knock("right"), true);
  assert.equal(h.index(), 1);
  h.wait(500); h.knock("left"); h.wait(500); h.knock("left");
  assert.equal(h.index(), 7, "left from the first row wraps to the last");
  assert.equal(h.backs.length, 0, "moving never goes back");
  // A lone back knock only arms; a second (back or unsure) goes back.
  h.wait(1200); h.knock("back");
  assert.deepEqual(h.log.at(-1), ["knock", true]);
  h.wait(300); h.knock();
  assert.deepEqual(h.backs, ["knock"]);
  // A side knock between two back knocks breaks the pair.
  h.wait(1500); h.knock("back"); h.wait(200); h.knock("right"); h.wait(200); h.knock("back");
  assert.equal(h.backs.length, 1);
  // Near a press, side knocks are the switch too.
  const pressed = knockRig(); pressed.wait(1000); pressed.press(60); pressed.wait(100); pressed.knock("right");
  assert.equal(pressed.index(), 1, "only the press moved it");
});
test("in a game the knock carries its side, with top read as back", () => {
  const h = knockRig("raw");
  h.wait(1000); h.knock("left"); h.knock("top"); h.knock();
  assert.deepEqual(h.raw.map((e) => e.side ?? null), ["left", "back", null]);
  assert.equal(h.index(), 0, "the host never moves in a game");
});
