// The case temperature offset: one setting applied wherever a sensor temperature is shown or
// derived from, history left raw, other temperatures (the CPU) untouched.
import test from "node:test";
import assert from "node:assert/strict";
import { clampOffset, tempOffset, correctTemp, correctReading, formatSensorTemp, formatTemp, formatOffset, dewPoint, absoluteHumidity, feelsLike } from "../web/engine/math.js";
import { Environment, Diagnostics } from "../web/apps/utilities.js";
import { appContext } from "./helpers/app-context.mjs";

const NOW = 1000;
const near = (a, b, t, m) => assert.ok(Math.abs(a - b) <= t, `${m || ""} got ${a}, expected ${b}`);
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
const history = Array.from({ length: 40 }, (_, i) => ({ at: NOW - 3600 + i * 90, temperature: 26 + i * 0.01, humidity: 40 }));
const context = (offset, unit = "C", sensor = { temperature: 26, humidity: 40, at: NOW - 2 }) =>
  appContext({ settings: { tempUnit: unit, tempOffset: offset }, state: { sensor, device: { connected: true } }, get: (p) => (p === "history" ? history : []) });

test("offset helpers: half-degree steps, clamped, default zero", () => {
  assert.equal(tempOffset({}), 0); assert.equal(tempOffset(undefined), 0);
  assert.equal(clampOffset(-2.2), -2); assert.equal(clampOffset(-2.3), -2.5);
  assert.equal(clampOffset(99), 5); assert.equal(clampOffset(-99), -10);
  assert.equal(clampOffset(NaN), 0); assert.equal(Object.is(clampOffset(-0), 0), true);
  assert.equal(correctTemp(26, { tempOffset: -2.5 }), 23.5);
  assert.ok(Number.isNaN(correctTemp(NaN, { tempOffset: -2 })));
  assert.equal(correctReading({ temperature: 26, humidity: 40 }, { tempOffset: -3 }).temperature, 23);
  assert.equal(correctReading(null, { tempOffset: -3 }), null);
  assert.equal(formatSensorTemp(26, "C", 1, { tempOffset: -2.5 }), "23.5 °C");
  assert.equal(formatSensorTemp(26, "F", 1, { tempOffset: -2.5 }), "74.3 °F");
  assert.equal(formatTemp(26, "C"), "26.0 °C", "formatTemp is raw: the CPU temperature must not be corrected");
  assert.equal(formatOffset(-2.5, "C"), "−2.5 °C"); assert.equal(formatOffset(-2.5, "F"), "−4.5 °F"); assert.equal(formatOffset(0, "C"), "0.0 °C");
});

test("the shared helper reads the host's settings when none are passed (status bar, voice answer)", () => {
  globalThis.vesper = { state: { settings: { tempOffset: -1.5 } } };
  try { assert.equal(formatSensorTemp(26, "C"), "24.5 °C"); assert.equal(correctTemp(26), 24.5); }
  finally { delete globalThis.vesper; }
  assert.equal(correctTemp(26), 26);
});

test("Atmosphere applies the offset to the reading, derived values, extremes and charts, and says so", async () => {
  const raw = context(0), fixed = context(-3);
  const a = new Environment(raw); a.clock = () => NOW; await settle(); a.render();
  const b = new Environment(fixed); b.clock = () => NOW; await settle(); b.render();
  const h0 = raw.calls.content.at(-1), h1 = fixed.calls.content.at(-1);
  assert.match(h0, /26\.0<small> °C/); assert.match(h1, /23\.0<small> °C/);
  assert.doesNotMatch(h0, /CASE OFFSET/, "no offset, no note");
  assert.match(h1, /CASE OFFSET −3\.0 °C APPLIED TO TEMPERATURE \(HISTORY STORED RAW\)/);
  assert.match(h1, /CASE −3\.0 °C<\/small>/);
  // Dew point and absolute humidity use the corrected temperature with the measured humidity.
  near(dewPoint(23, 40), 8.7, 0.1);
  assert.ok(h1.includes(dewPoint(23, 40).toFixed(1) + " °C"), "dew point from the corrected temperature");
  assert.ok(h0.includes(dewPoint(26, 40).toFixed(1) + " °C"));
  assert.ok(h1.includes(absoluteHumidity(23, 40).toFixed(1) + " g/m³"));
  // Today's low and high move by the offset, the stored rows and the reading do not.
  const lowRaw = Math.min(...history.map((r) => r.temperature));
  assert.ok(h1.includes((lowRaw - 3).toFixed(1) + " °C"), "today's low shifted");
  assert.equal(history[0].temperature, 26, "history stays raw");
  assert.equal(raw.state().sensor.temperature, 26, "the reading itself is not rewritten");
  assert.equal(fixed.state().sensor.temperature, 26);
});

test("Atmosphere feels-like uses the corrected temperature", () => {
  const sensor = { temperature: 33, humidity: 70, at: NOW - 2 };
  const raw = context(0, "C", sensor), fixed = context(-5, "C", sensor);
  const a = new Environment(raw); a.clock = () => NOW; a.render();
  const b = new Environment(fixed); b.clock = () => NOW; b.render();
  assert.ok(raw.calls.content.at(-1).includes(feelsLike(33, 70).celsius.toFixed(1) + " °C"));
  assert.ok(fixed.calls.content.at(-1).includes(feelsLike(28, 70).celsius.toFixed(1) + " °C"));
});

test("Atmosphere offset actions step by half a degree, clamp, and clear", async () => {
  const ctx = context(-2);
  const app = new Environment(ctx); app.clock = () => NOW; await settle();
  assert.deepEqual(ctx.currentActions.map((x) => x.id), ["range", "refresh", "off-down", "off-up", "off-zero", "home"]);
  ctx.currentActions.find((x) => x.id === "off-down").run();
  ctx.currentActions.find((x) => x.id === "off-up").run();
  ctx.currentActions.find((x) => x.id === "off-zero").run();
  assert.deepEqual(ctx.calls.command.map((c) => c[1].value), [-2.5, -1.5, 0]);
  assert.ok(ctx.calls.command.every((c) => c[0] === "settings" && c[1].key === "tempOffset"));
  const edge = context(5); const e = new Environment(edge); e.clock = () => NOW;
  edge.currentActions.find((x) => x.id === "off-up").run();
  assert.equal(edge.calls.command.at(-1)[1].value, 5, "clamped at the top of the range");
  // Live: the shown value follows the setting when the service broadcasts it.
  ctx.state().settings.tempOffset = -4; app.event({ type: "settings" });
  assert.match(ctx.calls.content.at(-1), /22\.0<small> °C/);
});

test("Node Scope shows the corrected sensor temperature and the offset", () => {
  const ctx = context(-2, "C");
  new Diagnostics(ctx);
  assert.match(ctx.calls.content.at(-1), /24\.0 °C \(CASE OFFSET −2\.0 °C\)/);
});
