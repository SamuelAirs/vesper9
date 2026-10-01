// Host lamp layer: pure frames from host state (web/engine/ambient.js), the lamp level, the
// microphone-live lamp, and the ownership hand-over in LightDirector.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HostLamps, lampFrame, levelScale, LAMP_LEVELS, DEFAULT_LAMP_LEVEL, IDLE, MIC_LAMP, MIC_RGB,
  FLASH_MS, ESCAPE_MS, EFFECT_MARGIN_MS, EFFECT_FADE_MS, micBrightness,
} from "../web/engine/ambient.js";
import { LightDirector } from "../web/engine/lights.js";
import { scaleLeds } from "../web/engine/lightshow.js";

const lamp = (v, i) => v.slice(i * 3, i * 3 + 3);
const lit = (v, i) => Math.max(...lamp(v, i)) > 0;
const sum = (v) => v.reduce((a, b) => a + b, 0);
const nine = (v) => v.length === 9 && v.every((x) => Number.isInteger(x) && x >= 0 && x <= 255);
const base = { scene: "dashboard", level: "full", ambient: true, focus: { index: 0, count: 8 }, mic: false };
// A HostLamps with its first frame already taken at t = 0.
const fresh = () => { const h = new HostLamps(); h.frame(0, base); return h; };

test("values are always nine whole numbers 0-255", () => {
  const h = new HostLamps();
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let n = 0; n < 3000; n++) {
    const now = n * 37;
    if (rnd() < 0.05) h.note(["select", "menu", "voice", "error"][Math.floor(rnd() * 4)], now);
    if (rnd() < 0.02) h.touch(now);
    if (rnd() < 0.01) h.quiet(now, 1200);
    const count = 1 + Math.floor(rnd() * 12);
    const v = h.frame(now, {
      scene: ["dashboard", "menu", "instrument", "game"][Math.floor(rnd() * 4)],
      level: ["full", "medium", "low", "off", 0.33, "bogus"][Math.floor(rnd() * 6)],
      ambient: rnd() < 0.5, reducedMotion: rnd() < 0.3, mic: rnd() < 0.5,
      focus: rnd() < 0.8 ? { index: Math.floor(rnd() * count), count } : null,
      press: rnd() < 0.3 ? { kind: rnd() < 0.5 ? "select" : "escape", elapsedMs: rnd() * 4000, holdMs: 650 } : null,
      clicks: rnd() < 0.2 ? { count: Math.floor(rnd() * 5), total: 4 } : null,
      timerRemaining: rnd() < 0.3 ? rnd() * 14 - 2 : null,
    });
    assert.ok(nine(v), JSON.stringify(v));
  }
});

test("lamp level scales everything, off yields zeros, default is not full", () => {
  assert.deepEqual(LAMP_LEVELS, { full: 1, medium: 0.5, low: 0.2, off: 0 });
  assert.notEqual(DEFAULT_LAMP_LEVEL, "full");
  const catalog = JSON.parse(readFileSync(new URL("../vesper/catalog.json", import.meta.url)));
  assert.equal(catalog.settings.lampLevel, DEFAULT_LAMP_LEVEL);
  assert.equal(catalog.settings.lampAmbient, true);
  assert.equal(levelScale("nonsense"), LAMP_LEVELS[DEFAULT_LAMP_LEVEL]);
  const scene = { focus: { index: 3, count: 8 }, press: null };
  const frames = ["full", "medium", "low", "off"].map((level) => {
    const h = fresh();
    return h.frame(1000, { ...base, ...scene, level });
  });
  assert.ok(sum(frames[0]) > sum(frames[1]) && sum(frames[1]) > sum(frames[2]) && sum(frames[2]) > 0);
  assert.deepEqual(frames[3], Array(9).fill(0));
  // The same holds for acknowledgements, hold progress, clicks and the countdown.
  const extras = [
    { press: { kind: "select", elapsedMs: 400, holdMs: 650 } },
    { clicks: { count: 2, total: 4 } },
    { timerRemaining: 8 },
  ];
  for (const extra of extras) {
    const off = lampFrame({ scene: "menu", seconds: 1, scale: 0, rest: 1, ...extra });
    assert.deepEqual(off, Array(9).fill(0));
    const full = lampFrame({ scene: "menu", seconds: 1, scale: 1, rest: 1, ...extra });
    const half = lampFrame({ scene: "menu", seconds: 1, scale: 0.5, rest: 1, ...extra });
    assert.ok(sum(full) > sum(half) && sum(half) > 0);
  }
  const h = fresh(); h.note("select", 1000);
  assert.deepEqual(h.frame(1010, { ...base, level: "off" }), Array(9).fill(0));
});

test("scaleLeds keeps lit channels lit and ignores malformed input", () => {
  assert.deepEqual(scaleLeds([255, 100, 3, 0, 0, 0, 1, 2, 0], 0.2), [51, 20, 1, 0, 0, 0, 1, 1, 0]);
  assert.deepEqual(scaleLeds([255, 100, 3, 0, 0, 0, 1, 2, 0], 0), Array(9).fill(0));
  assert.equal(scaleLeds("x", 0.5), "x");
});

test("focus spot follows the focused item across the three lamps", () => {
  const where = (index, count) => {
    const h = new HostLamps();
    h.frame(0, { ...base, ambient: false, focus: { index, count } });
    const v = h.frame(1000, { ...base, ambient: false, focus: { index, count } });
    return [0, 1, 2].map((i) => sum(lamp(v, i)));
  };
  const first = where(0, 8), middle = where(3, 7), last = where(7, 8);
  assert.ok(first[0] > first[1] && first[1] >= first[2]);
  assert.ok(middle[1] > middle[0] && middle[1] > middle[2]);
  assert.ok(last[2] > last[1] && last[1] >= last[0]);
  assert.ok(first[0] > 0 && last[2] > 0);
  // Stepping moves the light gradually, not in a jump.
  const h = new HostLamps();
  h.frame(0, { ...base, ambient: false, focus: { index: 0, count: 8 } });
  const early = h.frame(40, { ...base, ambient: false, focus: { index: 7, count: 8 } });
  const late = h.frame(600, { ...base, ambient: false, focus: { index: 7, count: 8 } });
  assert.ok(sum(lamp(early, 2)) < sum(lamp(late, 2)));
  assert.ok(sum(lamp(late, 2)) > sum(lamp(late, 0)));
  // A single item sits in the middle; a game (no list) shows no spot.
  const one = new HostLamps();
  const v = one.frame(0, { ...base, ambient: false, focus: { index: 0, count: 1 } });
  assert.ok(lit(v, 1) && !lit(v, 0) && !lit(v, 2));
  assert.deepEqual(one.frame(10, { ...base, scene: "game", ambient: false, focus: null }), Array(9).fill(0));
});

test("hold progress fills amber left to right, then shows the menu hold in white", () => {
  const press = (elapsedMs) => lampFrame({ scene: "menu", seconds: 0, scale: 1, rest: 1, press: { kind: "select", elapsedMs, holdMs: 650 } });
  assert.deepEqual(press(40), lampFrame({ scene: "menu", seconds: 0, scale: 1, rest: 1 }), "a tap is not progress");
  const a = press(250), b = press(450), c = press(640);
  assert.ok(lit(a, 0) && !lit(a, 2));
  assert.ok(sum(b) > sum(a) && sum(c) > sum(b));
  assert.ok(lit(c, 2));
  for (const v of [a, b, c]) for (let i = 0; i < 3; i++) { const [r, g] = lamp(v, i); assert.ok(r >= g, "amber, not green"); }
  // Past the selection threshold: amber base, white counting to three seconds.
  const early = press(700), late = press(2600), done = press(ESCAPE_MS);
  assert.ok(lamp(early, 0).every((x, k) => x === lamp(early, 0)[k]) && lamp(early, 2)[2] === 0, "still amber at the right");
  assert.ok(lamp(late, 0)[2] > 100, "white at the left");
  assert.deepEqual(lamp(done, 2), lamp(done, 0), "all lamps white at three seconds");
  assert.ok(lamp(done, 1)[2] > 100);
  // A game's long hold only starts counting toward the menu after a delay.
  const game = (elapsedMs) => lampFrame({ scene: "game", seconds: 0, scale: 1, rest: 1, press: { kind: "escape", elapsedMs } });
  assert.deepEqual(game(300), Array(9).fill(0));
  assert.ok(lit(game(1200), 0));
});

test("selection fires a short flash that ends, menu open and acknowledgements differ", () => {
  const h = fresh();
  const at = (kind, age, t = 1000) => {
    const x = fresh(); x.note(kind, t);
    x.frame(t, { ...base, ambient: false, focus: null }); // the first frame starts the clock
    return x.frame(t + age, { ...base, ambient: false, focus: null });
  };
  for (const kind of Object.keys(FLASH_MS)) {
    assert.ok(sum(at(kind, 10)) > 0, kind + " shows at once");
    assert.deepEqual(at(kind, FLASH_MS[kind] + 5), Array(9).fill(0), kind + " is brief");
  }
  const select = at("select", 10), menu = at("menu", 10), error = at("error", 10), voice = at("voice", 10);
  assert.ok(lit(select, 0) && lit(select, 1) && lit(select, 2));
  assert.notDeepEqual(select, menu);
  assert.ok(error[0] > 200 && error[1] < 20, "error is red on every lamp");
  assert.deepEqual(at("error", 150), Array(9).fill(0), "error blinks twice");
  assert.ok(sum(at("error", 250)) > 0);
  assert.notDeepEqual(voice, error);
  assert.ok(!lit(voice, 2) && lit(voice, 0), "voice acknowledgement starts as a sweep from the left");
  assert.ok(lit(at("voice", 300), 2));
  // A stalled frame does not eat the flash: it is timed from the first frame that shows it.
  const late = fresh(); late.note("select", 1000);
  assert.ok(sum(late.frame(1900, { ...base, ambient: false, focus: null })) > 0);
  assert.deepEqual(late.frame(1900 + FLASH_MS.select + 5, { ...base, ambient: false, focus: null }), Array(9).fill(0));
  void h;
});

test("each click of the menu gesture lights one more lamp", () => {
  const clicks = (count, total = 4) => lampFrame({ scene: "game", seconds: 0, scale: 1, rest: 1, clicks: { count, total } });
  assert.deepEqual([1, 2, 3].map((n) => [0, 1, 2].filter((i) => lit(clicks(n), i)).length), [1, 2, 3]);
  assert.deepEqual([0, 1, 2].map((i) => lit(clicks(1), i)), [true, false, false]);
  assert.deepEqual(clicks(4), Array(9).fill(0), "the last click opens the menu (its own flash)");
  assert.deepEqual([1, 2].map((n) => [0, 1, 2].filter((i) => lit(clicks(n, 3), i)).length), [1, 2]);
});

test("ambient breathes dimly on the dashboard, and only there", () => {
  const h = new HostLamps();
  const samples = [];
  for (let t = 0; t < 16000; t += 100) samples.push(h.frame(t, { ...base, level: "full", focus: null }));
  const greens = samples.map((v) => v[1]);
  assert.ok(Math.max(...greens) > Math.min(...greens) + 20, "it breathes");
  assert.ok(Math.max(...samples.flat()) < 90, "and is dim even at full level");
  assert.ok(Math.min(...greens) > 0, "never fully dark while awake");
  for (const scene of ["menu", "instrument", "game"]) {
    const x = new HostLamps();
    assert.deepEqual(x.frame(500, { ...base, scene, focus: null }), Array(9).fill(0), scene);
  }
  // Reduced motion holds it steady.
  const calm = new HostLamps();
  const a = calm.frame(0, { ...base, reducedMotion: true, focus: null }), b = calm.frame(3000, { ...base, reducedMotion: true, focus: null });
  assert.deepEqual(a, b);
});

test("ambient off keeps navigation feedback but no glow", () => {
  const h = new HostLamps();
  assert.deepEqual(h.frame(0, { ...base, ambient: false, focus: null }), Array(9).fill(0));
  const spotted = h.frame(10, { ...base, ambient: false, focus: { index: 0, count: 8 } });
  assert.ok(lit(spotted, 0));
  assert.ok(sum(h.frame(20, { ...base, ambient: true, focus: null })) > 0);
});

test("idle fade reaches exactly zero and stays there until the next press", () => {
  const h = fresh();
  const at = (t, extra = {}) => h.frame(t, { ...base, ...extra });
  assert.ok(sum(at(IDLE.startMs - 1000)) > 0);
  const mid = sum(at(IDLE.startMs + IDLE.fadeMs / 2));
  assert.ok(mid > 0 && mid < sum(at(IDLE.startMs - 1000)));
  assert.deepEqual(at(IDLE.startMs + IDLE.fadeMs), Array(9).fill(0));
  for (let t = IDLE.startMs + IDLE.fadeMs; t < IDLE.startMs + IDLE.fadeMs + 8 * 3600e3; t += 600e3)
    assert.deepEqual(at(t), Array(9).fill(0), "dark all night at " + t);
  h.touch(9 * 3600e3);
  assert.ok(sum(at(9 * 3600e3 + 50)) > 0, "a press brings it back");
  // Acknowledgements and the countdown still show while the glow is dark.
  const late = 10 * 3600e3;
  h.note("voice", late - 50);
  assert.ok(sum(h.frame(late, { ...base })) > 0);
  assert.ok(sum(h.frame(late + 1000, { ...base, timerRemaining: 8 })) > 0);
});

test("the microphone lamp is steady and survives ambient off, idle fade and level off", () => {
  const h = fresh();
  const mic = (t, extra = {}) => h.frame(t, { ...base, mic: true, ...extra });
  const expected = (level) => MIC_RGB.map((c) => Math.max(1, Math.round(c * micBrightness(levelScale(level)))));
  const quiet = IDLE.startMs + IDLE.fadeMs + 1000;
  const cases = [
    [1000, {}], [1000, { ambient: false }], [quiet, {}], [quiet, { ambient: false, focus: null }],
    [quiet, { level: "off" }], [1000, { level: "off", ambient: false }], [1000, { level: "low" }],
  ];
  for (const [t, extra] of cases) {
    const v = mic(t, extra);
    assert.deepEqual(lamp(v, MIC_LAMP), expected(extra.level || "full"), JSON.stringify(extra) + " @" + t);
    assert.ok(lamp(v, MIC_LAMP)[2] > 20, "visible");
  }
  // Steady: the same colour across time, whatever else the host is doing.
  assert.equal(new Set([0, 1500, 4300, 9000].map((t) => lamp(mic(t, { ambient: false, focus: null }), MIC_LAMP).join())).size, 1);
  // Not hidden by flashes, hold progress, clicks or the countdown.
  h.note("select", 2000);
  assert.deepEqual(lamp(mic(2010), MIC_LAMP), expected("full"));
  h.note("error", 2100);
  assert.deepEqual(lamp(mic(2110), MIC_LAMP), expected("full"));
  for (const extra of [{ press: { kind: "select", elapsedMs: 2900, holdMs: 650 } }, { clicks: { count: 2, total: 4 } }, { timerRemaining: 2 }])
    assert.deepEqual(lamp(mic(5000, extra), MIC_LAMP), expected("full"));
  // The microphone lamp is dim (never the brightest thing the lamps do) and absent when not capturing.
  assert.ok(Math.max(...lamp(mic(1000), MIC_LAMP)) < 200);
  assert.deepEqual(lamp(h.frame(1100, { ...base, mic: false, ambient: false, focus: null }), MIC_LAMP), [0, 0, 0]);
  // Level off is not a mic blackout: the other lamps are dark, the mic lamp is the floor.
  const off = mic(1000, { level: "off", focus: null });
  assert.deepEqual(off.slice(0, 6), Array(6).fill(0));
  assert.ok(lit(off, MIC_LAMP));
});

test("timer: last ten seconds count down on the lamps, and the effect is not overwritten", () => {
  const frame = (remaining) => lampFrame({ scene: "dashboard", seconds: 0, scale: 1, rest: 1, timerRemaining: remaining });
  assert.deepEqual(frame(null), Array(9).fill(0));
  assert.deepEqual(frame(10.5), Array(9).fill(0));
  // Just past zero the last lamp holds until the service's completion effect arrives, then it gives up.
  assert.deepEqual([0, -1].map((r) => [0, 1, 2].filter((i) => lit(frame(r), i)).length), [1, 1]);
  assert.deepEqual(frame(-2.5), Array(9).fill(0));
  const count = (r) => [0, 1, 2].filter((i) => lit(frame(r), i)).length;
  assert.deepEqual([9.5, 7, 5, 2.5, 0.5].map(count), [3, 3, 2, 1, 1]);
  for (const r of [9.9, 5.5, 1.2]) { const [R, G] = lamp(frame(r), 0); assert.ok(R > G && R > 0, "amber"); }
  assert.ok(frame(6.95)[0] > frame(6.05)[0], "brightest just after each second");
  // Coherent with the service effect: after light_effect the glow stays out, then fades in.
  const h = fresh();
  h.touch(50000);
  const at = (t) => h.frame(t, { ...base, level: "full" });
  assert.ok(sum(at(50000)) > 0);
  h.quiet(50100, 1200);
  assert.deepEqual(at(50100), Array(9).fill(0));
  assert.deepEqual(at(50100 + 1200 + EFFECT_MARGIN_MS - 1), Array(9).fill(0));
  const resumed = sum(at(50100 + 1200 + EFFECT_MARGIN_MS + EFFECT_FADE_MS / 2));
  assert.ok(resumed > 0 && resumed < sum(at(50100 + 1200 + EFFECT_MARGIN_MS + EFFECT_FADE_MS + 100)) + 1);
  assert.ok(sum(at(50100 + 1200 + EFFECT_MARGIN_MS + EFFECT_FADE_MS)) > 0);
  // The microphone lamp is not part of the quiet window's glow.
  h.quiet(60000, 1200);
  assert.ok(lit(h.frame(60100, { ...base, mic: true }), MIC_LAMP));
});

// --- ownership ---------------------------------------------------------------------------
function director() {
  const calls = [];
  let now = 1000;
  const d = new LightDirector((name, data) => { calls.push([name, data]); return Promise.resolve({}); }, () => (now += 100));
  return { d, calls };
}
const HOST = [0, 40, 0, 0, 0, 0, 0, 0, 0];
const APP = [200, 0, 0, 0, 0, 0, 0, 0, 90];
const wrote = (calls) => calls.filter(([n]) => n === "leds").map(([, data]) => data.values.join());

test("an app taking the lamps silences the host layer; leaving restores it", async () => {
  const { d, calls } = director();
  assert.equal(d.owner, "host");
  assert.ok(d.setHost(HOST));
  await d.flush();
  assert.deepEqual(wrote(calls), [HOST.join()]);
  d.set(APP);
  assert.equal(d.owner, "app");
  assert.equal(d.setHost(HOST), false, "host values are ignored while an app owns the lamps");
  await d.flush();
  assert.equal(wrote(calls).at(-1), APP.join());
  await d.flush();
  d.setHost([0, 0, 50, 0, 0, 0, 0, 0, 0]);
  await d.flush();
  assert.equal(wrote(calls).at(-1), APP.join(), "no host write leaked");
  // Leaving the app still turns the lamps off first, then the host may drive them again.
  await d.release();
  assert.equal(d.owner, "host");
  assert.deepEqual(calls.slice(-2).map(([n]) => n), ["cancel", "leds"]);
  assert.equal(calls.at(-1)[1].values.join(), Array(9).fill(0).join());
  assert.ok(d.setHost(HOST));
  await d.flush();
  assert.equal(wrote(calls).at(-1), HOST.join());
});

test("patterns and reactions also take the lamps", async () => {
  for (const name of ["pattern", "reaction", "cancel"]) {
    const { d } = director();
    d.setHost(HOST);
    await d.effect(name, name === "pattern" ? { steps: [{ ms: 100, values: APP }] } : { trial: 1, delay: 500 });
    assert.equal(d.owner, "app", name);
    assert.equal(d.setHost(HOST), false, name);
    assert.equal(d.desired, null);
    await d.release();
    assert.equal(d.owner, "host");
  }
});

test("lamp level applies to plain values and pattern colours, not to the reaction cue", async () => {
  const { d, calls } = director();
  d.setScale(0.5);
  d.set([200, 100, 0, 0, 0, 0, 1, 0, 255]);
  await d.flush();
  assert.equal(calls.at(-1)[1].values.join(), "100,50,0,0,0,0,1,0,128");
  d.setScale(0.2); // a changed level re-applies to what the app last asked for
  assert.equal(d.desired.join(), "40,20,0,0,0,0,1,0,51");
  await d.effect("pattern", { repeat: 2, steps: [{ ms: 100, values: [255, 255, 255, 0, 0, 0, 10, 0, 0] }, { ms: 50, values: Array(9).fill(0) }] });
  const sent = calls.at(-1)[1];
  assert.equal(sent.repeat, 2);
  assert.equal(sent.steps[0].values.join(), "51,51,51,0,0,0,2,0,0");
  assert.equal(sent.steps[0].ms, 100);
  assert.equal(sent.steps[1].values.join(), Array(9).fill(0).join());
  d.setScale(0);
  await d.effect("pattern", { steps: [{ ms: 100, values: APP }] });
  assert.equal(calls.at(-1)[1].steps[0].values.join(), Array(9).fill(0).join(), "off silences patterns");
  const cue = { trial: 5, delay: 1500 };
  await d.effect("reaction", cue);
  assert.deepEqual(calls.at(-1), ["reaction", cue], "Light Trial's cue stays visible at every level");
  // A malformed step is left for the service to reject.
  await d.effect("pattern", { steps: [{ ms: 100, values: [1, 2] }] });
  assert.deepEqual(calls.at(-1)[1].steps[0].values, [1, 2]);
});
