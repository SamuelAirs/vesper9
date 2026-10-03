// The console's low tones shake the case into a tap (scripts/tone-sweep.py on the two-microphone node):
// the synth says when one may still be arriving, and main.js drops knocks until then.
import test from "node:test";
import assert from "node:assert/strict";
import { Synth } from "../web/engine/audio.js";

function synth() {
  const node = () => ({ connect: (x) => x, start() {}, stop() {}, frequency: {}, gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} } });
  const s = new Synth();
  s.context = { state: "running", currentTime: 0, destination: {}, createOscillator: node, createGain: node };
  return s;
}

test("a low tone mutes knocks while it plays and briefly after; higher tones never do", () => {
  const s = synth(), now = performance.now();
  s.tone(440, 0.2);
  s.tone(147, 0.05);
  assert.equal(s.shaking(now), false, "147 Hz and up never registered on the case");
  s.tone(110, 0.12);
  assert.equal(s.shaking(now + 300), true, "120 ms tone + 250 ms tail");
  assert.equal(s.shaking(now + 1000), false);
});

test("a held low tone mutes knocks until it stops, then for the tail", () => {
  const s = synth();
  s.startTone(98);
  assert.equal(s.shaking(performance.now() + 60000), true);
  s.stopTone();
  const after = performance.now();
  assert.equal(s.shaking(after + 100), true);
  assert.equal(s.shaking(after + 400), false);
  s.startTone(550);
  assert.equal(s.shaking(after + 400), false);
});

test("sound off: nothing plays, so nothing is muted", () => {
  const s = synth();
  s.enabled = false;
  s.tone(70, 0.5);
  assert.equal(s.shaking(), false);
});
