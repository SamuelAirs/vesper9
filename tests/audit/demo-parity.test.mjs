// DemoBridge (standalone simulator) versus vesper/server.py + SimulatedDevice. Read-only comparison.
import test from "node:test";
import assert from "node:assert/strict";
globalThis.localStorage = { getItem: () => null, setItem() {} };
const { DemoBridge } = await import("../../web/engine/demo.js");

test("D1 demo accepts leds payloads the real service rejects (server.py:224 requires nine ints 0-255)", async () => {
  const d = new DemoBridge();
  for (const values of [[0.5, 0, 0, 0, 0, 0, 0, 0, 0], [300, 0, 0, 0, 0, 0, 0, 0, 0], [1, 2, 3]]) {
    await assert.rejects(d.command("leds", { values }), undefined, "demo accepted " + JSON.stringify(values));
  }
});

test("D2 demo leds does not cancel a running pattern (device.py:42 and PROTOCOL.md: LEDS cancels a pattern)", async () => {
  const d = new DemoBridge();
  const seen = [];
  d.addEventListener("event", (e) => e.detail.type === "leds" && seen.push(e.detail.values[0]));
  await d.command("pattern", { steps: [{ ms: 30, values: Array(9).fill(11) }, { ms: 30, values: Array(9).fill(22) }] });
  await d.command("leds", { values: Array(9).fill(99) });
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(seen.at(-1), 99, "pattern kept running over the explicit leds write: " + seen);
  d.pattern.forEach(clearTimeout);
});

test("D3 demo timer commands on an unknown id succeed silently (server.py:203 raises 'Timer not found')", async () => {
  const d = new DemoBridge();
  await assert.rejects(d.command("timer", { op: "toggle", id: "nope" }));
});

test("D4 demo validates pattern and reaction arguments like the service (server.py:230,241)", async () => {
  const d = new DemoBridge();
  await assert.rejects(d.command("pattern", { steps: [] }), undefined, "empty pattern");
  await assert.rejects(d.command("reaction", { trial: 1, delay: 10 }), undefined, "delay 10 ms");
  d.pattern.forEach(clearTimeout); clearTimeout(d.reaction);
});

test("D5 demo ignores unknown commands (server.py:291 raises 'Unknown command')", async () => {
  const d = new DemoBridge();
  await assert.rejects(d.command("bogus", {}));
});
