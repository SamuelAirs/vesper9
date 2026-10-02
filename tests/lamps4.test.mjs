// Four lamps and the board LED (web/engine/lightshow.js, lights.js, ambient.js): every three-lamp
// call looks as before with the fourth lamp dark, helpers cover four lamps when asked, what reaches
// the service fits the node's lamp count, and the board LED is separate, off unless an app drives it.
import test from "node:test";
import assert from "node:assert/strict";
import { LAMP, lamps, fill, only, meter, spot, chase, lightsOff, padLamps, scaleLeds, MAX_LAMPS } from "../web/engine/lightshow.js";
import { LightDirector, normalizeLeds, normalizeBoard } from "../web/engine/lights.js";
import { lampFrame } from "../web/engine/ambient.js";

test("three-lamp helpers are unchanged; the count argument gives four", () => {
  assert.equal(fill(LAMP.red).length, 9);
  assert.equal(fill(LAMP.red, 1, 4).length, 12);
  assert.deepEqual(only(3, LAMP.blue, 1, 4).slice(9), LAMP.blue);
  assert.deepEqual(lightsOff(), Array(9).fill(0));
  assert.deepEqual(lightsOff(4), Array(12).fill(0));
  assert.equal(lamps(LAMP.red, null, null, LAMP.cyan).length, 12);
  // meter: half way lights two of four; spot at the right end is the fourth lamp.
  const m = meter(0.5, [100, 100, 100], LAMP.off, 4);
  assert.deepEqual([m[0], m[3], m[6], m[9]], [100, 100, 0, 0]);
  const sp = spot(1, [200, 0, 0], 0.75, 4);
  assert.deepEqual([sp[0], sp[3], sp[6], sp[9]], [0, 0, 0, 200]);
  assert.deepEqual(spot(0.5, [200, 0, 0]).filter((_, i) => i % 3 === 0), [0, 200, 0], "three lamps as before");
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((k) => chase(k / 4, 4, true, 4)), [0, 1, 2, 3, 2, 1, 0]);
  assert.deepEqual([0, 1, 2, 3, 4].map((k) => chase(k / 4)), [0, 1, 2, 1, 0], "three lamps as before");
  assert.deepEqual(padLamps([1, 2, 3, 4, 5, 6, 7, 8, 9]), [1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 0, 0]);
  assert.equal(scaleLeds(Array(12).fill(200), 0.5).join(), Array(12).fill(100).join());
  assert.equal(MAX_LAMPS, 4);
});

test("the director pads a nine-value frame and sends the node's own length", async () => {
  const calls = [];
  let count = 3, now = 0;
  const d = new LightDirector(async (name, data) => { calls.push([name, data]); }, () => (now += 100), 2000, { lamps: () => count });
  d.set([10, 0, 0, 0, 10, 0, 0, 0, 10]);
  assert.deepEqual(d.desired, [10, 0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0]);
  await d.flush();
  assert.equal(calls.at(-1)[1].values.length, 9, "a three-lamp node gets nine");
  count = 4; d.invalidate();
  await d.flush();
  assert.deepEqual(calls.at(-1)[1].values, [10, 0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0], "a four-lamp node gets twelve, the fourth dark");
  d.set(fill(LAMP.green, 1, 4));
  await d.flush();
  assert.equal(calls.at(-1)[1].values.length, 12);
  await d.effect("pattern", { steps: [{ ms: 100, values: Array(9).fill(50) }] });
  assert.equal(calls.at(-1)[1].steps[0].values.length, 12, "a three-lamp pattern runs on four lamps");
  count = 3;
  await d.effect("pattern", { steps: [{ ms: 100, values: Array(12).fill(50) }] });
  assert.equal(calls.at(-1)[1].steps[0].values.length, 9, "a four-lamp pattern still runs on the old node");
  await d.release();
  assert.ok(calls.some(([name, data]) => name === "leds" && data.values.length === 9 && data.values.every((v) => v === 0)));
  assert.equal(normalizeLeds(Array(15).fill(0)), null, "the board LED is not a fifth lamp");
});

test("the board LED is a separate extra: never sent unless an app sets it and the node has one", async () => {
  const calls = [];
  let board = false, now = 0;
  const d = new LightDirector(async (name, data) => { calls.push([name, data]); }, () => (now += 100), 2000, { lamps: () => 4, board: () => board });
  d.set(fill(LAMP.red, 1, 4));
  await d.flush();
  assert.ok(!calls.some(([name]) => name === "board"), "nothing lights the board LED on its own");
  d.setBoard([0, 0, 255]);
  await d.flush();
  assert.ok(!calls.some(([name]) => name === "board"), "a node without one is never sent it");
  board = true;
  await d.flush();
  assert.deepEqual(calls.filter(([name]) => name === "board").at(-1)[1].values, [0, 0, 255]);
  const n = calls.length; await d.flush();
  assert.equal(calls.filter(([name]) => name === "board").length, 1, "an unchanged colour is not resent");
  d.setScale(0.5);
  await d.flush();
  assert.deepEqual(calls.filter(([name]) => name === "board").at(-1)[1].values, [0, 0, 128], "the lamp level applies");
  await d.release();
  assert.deepEqual(calls.filter(([name]) => name === "board").at(-1)[1].values, [0, 0, 0], "dark again when the app is left");
  assert.equal(normalizeBoard([1, 2]), null);
  assert.ok(n > 0);
});

test("the host's own lamp layer covers four lamps, with the microphone on the rightmost", () => {
  const base = { scene: "dashboard", seconds: 3, scale: 1, rest: 1, ambient: true, calm: false, spot: null };
  assert.equal(lampFrame(base).length, 9, "three lamps by default, exactly as before");
  const four = lampFrame({ ...base, lamps: 4 });
  assert.equal(four.length, 12);
  assert.ok(four.slice(9).some((v) => v > 0), "the dashboard breath reaches the fourth lamp");
  const mic = lampFrame({ ...base, rest: 0, lamps: 4, mic: true });
  assert.ok(mic.slice(9).some((v) => v > 0) && mic.slice(0, 9).every((v) => v === 0));
  const gesture = lampFrame({ ...base, lamps: 4, press: { kind: "gesture", elapsedMs: 1600, holdMs: 1600 } });
  assert.deepEqual(gesture.slice(9), [255, 200, 150], "the rightmost lamp fills white towards the menu");
  const countdown = (r) => lampFrame({ ...base, rest: 0, lamps: 4, timerRemaining: r }).filter((_, i) => i % 3 === 0).filter((v) => v > 0).length;
  assert.deepEqual([9.5, 7, 4.5, 2].map(countdown), [4, 3, 2, 1]);
});
