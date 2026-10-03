// Tuned instruments: Atmosphere formulas against published values, min/max and trend from a
// synthetic history, and the five original instruments rendering through the app context.
import test from "node:test";
import assert from "node:assert/strict";
import { dewPoint, absoluteHumidity, heatIndexF, feelsLike, comfortBand, extremes, trend, tempDelta } from "../web/engine/math.js";
import { Timers, Transcription, Environment, Diagnostics, Settings, comfortLamps, countdownLamps, timerLamps, nearestTimer, sensorBus, sensorFreshness } from "../web/apps/utilities.js";
import { appContext } from "./helpers/app-context.mjs";

const near = (actual, expected, tolerance, message) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message || ""} got ${actual}, expected ${expected} +/- ${tolerance}`);

test("dew point matches Magnus/standard psychrometric tables", () => {
  // Alduchov & Eskridge (1996) constants; table values from the usual dew-point charts (0.1 C).
  near(dewPoint(20, 50), 9.3, 0.1, "20 C 50 %");
  near(dewPoint(25, 60), 16.7, 0.1, "25 C 60 %");
  near(dewPoint(30, 40), 14.9, 0.1, "30 C 40 %");
  near(dewPoint(0, 100), 0, 1e-9, "saturated air: dew point equals temperature");
  near(dewPoint(-10, 100), -10, 1e-9, "saturated below freezing");
  assert.equal(dewPoint(20, 0), null);
  assert.equal(dewPoint(80, 50), null);
  assert.equal(dewPoint(NaN, 50), null);
});

test("absolute humidity matches saturation vapour density tables", () => {
  // Saturation vapour density, Engineering ToolBox / CRC: 0 C 4.85, 20 C 17.3, 25 C 23.0, 30 C 30.4 g/m3.
  near(absoluteHumidity(0, 100), 4.85, 0.05, "0 C");
  near(absoluteHumidity(20, 100), 17.3, 0.1, "20 C");
  near(absoluteHumidity(25, 100), 23.0, 0.1, "25 C");
  near(absoluteHumidity(30, 100), 30.4, 0.1, "30 C");
  near(absoluteHumidity(25, 50), 11.5, 0.1, "half of saturation");
  assert.equal(absoluteHumidity(25, 0), 0);
  assert.equal(absoluteHumidity(25, 120), null);
});

test("heat index matches the NWS chart and is null outside its range", () => {
  // NWS Heat Index chart (weather.gov/safety/heat-index), whole degrees F.
  near(heatIndexF(80, 40), 80, 1, "80 F 40 %");
  near(heatIndexF(90, 50), 95, 1, "90 F 50 %");
  near(heatIndexF(90, 70), 106, 1, "90 F 70 %");
  near(heatIndexF(100, 50), 118, 1, "100 F 50 %");
  near(heatIndexF(110, 40), 136, 1, "110 F 40 %");
  assert.equal(heatIndexF(79.9, 70), null, "below 80 F");
  assert.equal(heatIndexF(90, 39), null, "below 40 % RH");
  assert.equal(heatIndexF(125, 50), null, "above the chart");
  assert.equal(heatIndexF(NaN, 50), null);
});

test("feels-like is the heat index when defined, else the plain temperature", () => {
  const warm = feelsLike(32.2, 70); // 90 F, 70 %
  assert.equal(warm.heat, true);
  near(warm.celsius * 9 / 5 + 32, 106, 1);
  assert.deepEqual(feelsLike(22, 45), { celsius: 22, heat: false });
  assert.deepEqual(feelsLike(30, 20), { celsius: 30, heat: false }, "hot but dry: no heat index");
  assert.equal(feelsLike(NaN, 50), null);
});

test("comfort bands", () => {
  const id = (h) => comfortBand(h)?.id;
  assert.equal(id(10), "dry"); assert.equal(id(29.9), "dry");
  assert.equal(id(30), "comfortable"); assert.equal(id(59.9), "comfortable");
  assert.equal(id(60), "humid"); assert.equal(id(69.9), "humid");
  assert.equal(id(70), "very-humid"); assert.equal(id(100), "very-humid");
  assert.equal(comfortBand(NaN), null);
});

// A synthetic day: one row every five minutes, temperature rising 1.2 C/hour for the last hour.
const NOW = 1_800_000_000;
const history = [];
for (let i = 288; i >= 0; i--) {
  const at = NOW - i * 300, hours = (at - NOW) / 3600;
  history.push({ at, temperature: 20 + (hours > -1 ? 1.2 * hours : -1.2), humidity: 40 + (hours > -1 ? -3 * hours : 3) });
}

test("min, max and their times from a history", () => {
  const rows = [{ at: 100, temperature: 20, humidity: 40 }, { at: 200, temperature: 25, humidity: 50 }, { at: 300, temperature: 18, humidity: 45 }, { at: 400, temperature: 22, humidity: 41 }];
  const e = extremes(rows, "temperature");
  assert.deepEqual(e.min, { value: 18, at: 300 });
  assert.deepEqual(e.max, { value: 25, at: 200 });
  assert.deepEqual(extremes(rows, "temperature", 250).max, { value: 22, at: 400 }, "since filters older rows");
  assert.equal(extremes([], "temperature"), null);
  assert.equal(extremes(rows, "temperature", 1000), null);
  assert.equal(extremes([{ at: 1, temperature: NaN }], "temperature"), null);
});

test("trend over the last hour: rate, arrow and refusal without data", () => {
  const rising = trend(history, "temperature", NOW, 0.3);
  near(rising.rate, 1.2, 0.01); assert.equal(rising.arrow, "↑"); assert.equal(rising.steady, false);
  const drying = trend(history, "humidity", NOW, 1.5);
  near(drying.rate, -3, 0.01); assert.equal(drying.arrow, "↓");
  const flat = trend(history.map((r) => ({ ...r, temperature: 21 })), "temperature", NOW, 0.3);
  near(flat.rate, 0, 1e-9); assert.equal(flat.arrow, "→"); assert.equal(flat.steady, true);
  assert.equal(trend(history.slice(-2), "temperature", NOW, 0.3), null, "two samples");
  assert.equal(trend(history.slice(-4), "temperature", NOW, 0.3), null, "samples span under 20 minutes");
  assert.equal(trend([], "temperature", NOW, 0.3), null);
  near(tempDelta(1.2, "F"), 2.16, 1e-9); assert.equal(tempDelta(1.2, "C"), 1.2);
});

const lit = (leds) => leds.some((v) => v > 0);
const contextAt = (extra = {}) => {
  const ctx = appContext({ settings: extra.settings, state: { sensor: { temperature: 22, humidity: 45, at: NOW - 3 }, device: { connected: true }, timers: [], ...(extra.state || {}) }, get: (path) => (path === "history" ? history : []) });
  return ctx;
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

test("Atmosphere shows derived values in Fahrenheit and Celsius", async () => {
  for (const unit of ["F", "C"]) {
    const ctx = contextAt({ settings: { tempUnit: unit } });
    const app = new Environment(ctx); app.clock = () => NOW; await settle(); app.render();
    const html = ctx.calls.content.at(-1);
    assert.match(html, /DEW POINT/); assert.match(html, /FEELS LIKE/); assert.match(html, /ABS\. HUMIDITY/);
    assert.match(html, /TODAY LOW/); assert.match(html, /TODAY HIGH/);
    assert.match(html, unit === "F" ? /71\.6<small> °F/ : /22\.0<small> °C/);
    assert.match(html, unit === "F" ? /TEMPERATURE °F/ : /TEMPERATURE °C/);
    assert.match(html, /COMFORTABLE/);
    assert.match(html, /g\/m³/);
    assert.match(html, / AIR TEMP/, "22 C is below the heat index range");
    // Dew point of 22 C 45 %: 9.5 C = 49.1 F (psychrometric tables give 9.5 to 9.6 C).
    assert.match(html, unit === "F" ? /49\.1 °F/ : /9\.5 °C/);
    assert.match(html, /↑/, "temperature trend arrow");
  }
});

test("Atmosphere: warm and humid room reports heat index, hot and dry does not", async () => {
  const ctx = contextAt({ state: { sensor: { temperature: 32.2, humidity: 70, at: NOW - 2 } } });
  const app = new Environment(ctx); app.clock = () => NOW; await settle(); app.render();
  assert.match(ctx.calls.content.at(-1), /HEAT INDEX/);
  assert.match(ctx.calls.content.at(-1), /VERY HUMID/);
  ctx.state().sensor = { temperature: 32.2, humidity: 20, at: NOW - 2 }; app.render();
  assert.match(ctx.calls.content.at(-1), / AIR TEMP/);
  assert.match(ctx.calls.content.at(-1), /DRY/);
});

test("Atmosphere lamps: steady dim comfort colour, dark when stale, dark on dispose", async () => {
  const colours = {};
  for (const [humidity, id] of [[20, "dry"], [45, "comfortable"], [65, "humid"], [80, "very-humid"]]) {
    const ctx = contextAt({ state: { sensor: { temperature: 22, humidity, at: NOW - 2 } } });
    const app = new Environment(ctx); app.clock = () => NOW; app.render();
    const leds = ctx.calls.leds.at(-1);
    assert.equal(leds.length, 9); assert.ok(leds.every((v) => Number.isInteger(v) && v >= 0 && v <= 255));
    assert.ok(Math.max(...leds) <= 70, "dim: well under a third of full");
    assert.deepEqual(leds.slice(0, 3), leds.slice(3, 6)); assert.deepEqual(leds.slice(3, 6), leds.slice(6, 9));
    colours[id] = leds.join();
    assert.deepEqual(comfortLamps(humidity), leds);
    for (let i = 0; i < 5; i++) app.tick();
    assert.equal(ctx.calls.leds.at(-1).join(), leds.join(), "steady over ticks");
    app.dispose(); assert.ok(!lit(ctx.calls.leds.at(-1)));
  }
  assert.equal(new Set(Object.values(colours)).size, 4, "four distinct colours");
  const stale = contextAt({ state: { sensor: { temperature: 22, humidity: 45, at: NOW - 600 } } });
  const app = new Environment(stale); app.clock = () => NOW; app.render();
  assert.ok(!lit(stale.calls.leds.at(-1)), "a stale reading leaves the lamps dark");
  assert.ok(!lit(comfortLamps(NaN)));
});

test("Atmosphere keeps the timer countdown in a timer's last ten seconds", () => {
  const ctx = contextAt({ state: { timers: [{ id: "a", label: "T", running: true, remaining: 4, duration: 60 }] } });
  const app = new Environment(ctx); app.clock = () => NOW; app.render();
  assert.deepEqual(ctx.calls.leds.at(-1), countdownLamps(4));
  assert.deepEqual(countdownLamps(4).filter((v) => v > 0).length > 0, true);
});

test("Atmosphere range action, charts side by side, no rebuild when nothing changed", async () => {
  const requests = [];
  const ctx = appContext({ settings: { tempUnit: "F" }, state: { sensor: { temperature: 22, humidity: 45, at: NOW - 3 }, device: { connected: true } }, get: (path) => { requests.push(path); return path === "history" ? history : []; } });
  const app = new Environment(ctx); app.clock = () => NOW; await settle();
  assert.equal(ctx.currentActions.map((a) => a.id).join(), "range,refresh,off-down,off-up,home");
  assert.equal((ctx.calls.content.at(-1).match(/<svg/g) || []).length, 2);
  assert.match(ctx.calls.content.at(-1), /atmo-charts/);
  assert.match(ctx.calls.content.at(-1), /24 HOURS/);
  const before = ctx.calls.content.length;
  for (let i = 0; i < 10; i++) { app.tick(); app.event({ type: "sensor" }); }
  assert.equal(ctx.calls.content.length, before, "identical markup is not sent again");
  const labels = ctx.currentActions.map((a) => a.label);
  ctx.currentActions[0].run(); await settle();
  assert.match(ctx.currentActions[0].label, /RANGE \/ 7 DAYS/);
  assert.ok(requests.some((p) => p.startsWith("history?hours=168")), requests.join());
  assert.match(ctx.calls.content.at(-1), /7 DAYS/);
  assert.match(ctx.calls.content.at(-1), /ONLY THE LAST 24 H IS AVAILABLE/, "a service that returns 24 hours is described honestly");
  ctx.currentActions[0].run(); await settle();
  assert.match(ctx.currentActions[0].label, /30 DAYS/);
  ctx.currentActions[0].run(); await settle();
  assert.deepEqual(ctx.currentActions.map((a) => a.label), labels);
  app.dispose();
});

test("Atmosphere with a long history labels days and tolerates empty or bad history", async () => {
  const long = [];
  for (let i = 0; i < 720; i++) long.push({ at: NOW - (719 - i) * 3600, temperature: 18 + 4 * Math.sin(i / 20), humidity: 40 + 10 * Math.cos(i / 30) });
  const ctx = appContext({ state: { sensor: { temperature: 22, humidity: 45, at: NOW - 3 }, device: { connected: true } }, get: (path) => (path === "history" ? long.slice(-288) : path.startsWith("history?hours=720") ? long : []) });
  const app = new Environment(ctx); app.clock = () => NOW; app.range = "30d"; await app.load();
  assert.ok(!/ONLY THE LAST/.test(ctx.calls.content.at(-1)), "full coverage has no warning");
  for (const bad of [{}, null, [{ at: "x" }], []]) {
    const c2 = appContext({ get: () => bad });
    const a2 = new Environment(c2); a2.clock = () => NOW; await settle(); a2.render(); a2.tick(); a2.dispose();
    assert.match(c2.calls.content.at(-1), /Collecting/);
  }
});

test("sensorFreshness changes at most once a minute", () => {
  const state = { sensor: { at: 1000 }, device: { connected: true }, simulated: false };
  assert.equal(sensorFreshness(state, 1003), sensorFreshness(state, 1014));
  assert.match(sensorFreshness(state, 1003), /^LIVE \/ UPDATED JUST NOW/);
  assert.match(sensorFreshness({ ...state, simulated: true }, 1003), /^SIMULATED/);
  assert.match(sensorFreshness(state, 1100), /^STALE \/ LAST READING 1 MIN AGO/);
  assert.equal(sensorFreshness(state, 1100), sensorFreshness(state, 1110));
  assert.match(sensorFreshness({ ...state, device: { connected: false } }, 1002), /^STALE/);
  assert.equal(sensorFreshness({ device: {} }, 1), "NO RECENT READING");
});

test("Node Scope shows link, firmware, the lamps and the lamp level, and no sensor rows", () => {
  const ctx = appContext({ settings: { lampLevel: "low" }, state: { simulated: false, device: { connected: true, name: "VESPER-9", generation: 2 } } });
  const app = new Diagnostics(ctx);
  assert.match(ctx.calls.content.at(-1), /AWAITING STATUS/);
  app.event({ type: "node_status", link: "usb", fw: "0.1.2", sensor: { addr: 68, ok: 120, fail: 3, err: 0x107 }, button: false });
  const html = ctx.calls.content.at(-1);
  assert.match(html, /<span>LINK<\/span><b>USB<\/b>/);
  assert.match(html, /<span>FIRMWARE<\/span><b>0\.1\.2<\/b>/);
  assert.doesNotMatch(html, /SENSOR/, "the node has no temperature/humidity sensor");
  assert.match(html, /<span>LAMPS<\/span><b>3<\/b>/);
  assert.match(html, /<span>LAMP LEVEL<\/span><b>LOW<\/b>/);
  assert.match(html, /CHANNEL CHECKS ARE DIM/);
  assert.match(html, /LEFT 15\/7\/16/, "pin map follows docs/HARDWARE.md");
  app.event({ type: "node_status", link: "uart", fw: "0.1.2" });
  assert.match(ctx.calls.content.at(-1), /<b>UART<\/b>/);
  app.event({ type: "node_reset" });
  assert.match(ctx.calls.content.at(-1), /AWAITING STATUS/);
  const four = appContext({ state: { device: { connected: true } } });
  four.lampCount = () => 4; four.hasBoardLed = () => true;
  new Diagnostics(four);
  assert.match(four.calls.content.at(-1), /<span>LAMPS<\/span><b>4 \+ BOARD LED<\/b>/);
  assert.match(four.calls.content.at(-1), /mic R 47\/45\/21/, "the current node's wiring");
  assert.deepEqual(sensorBus(undefined), { bus: "—", error: "—" });
  assert.equal(sensorBus({ addr: 68, ok: 1, fail: 0, err: 0 }).error, "NONE");
});

test("Node Scope channel check at lamp level off says so", () => {
  const ctx = appContext({ settings: { lampLevel: "off" } });
  const app = new Diagnostics(ctx);
  assert.match(ctx.calls.content.at(-1), /LAMP LEVEL IS OFF/);
  const test = () => ctx.currentActions.find((a) => a.id === "test-colour");
  assert.match(test().label, /LAMPS OFF/);
  test().run();
  assert.equal(ctx.calls.toast.length, 1);
  assert.match(ctx.calls.toast[0], /OFF in Calibration/);
  assert.deepEqual(ctx.calls.leds.at(-1).slice(0, 3), [180, 0, 0], "the request is still made; the host applies the level");
});

test("Node Scope at a normal level: stable ids, original labels, quiet re-rendering", () => {
  const ctx = appContext({ settings: { lampLevel: "medium" } });
  const app = new Diagnostics(ctx);
  assert.equal(ctx.currentActions.find((a) => a.id === "test-colour").label, "TEST COLOUR / OFF");
  const ids = ctx.currentActions.map((a) => a.id);
  assert.ok(ids.every(Boolean) && new Set(ids).size === ids.length);
  ctx.currentActions.find((a) => a.id === "select-light").run();
  ctx.currentActions.find((a) => a.id === "test-colour").run();
  assert.deepEqual(ctx.currentActions.map((a) => a.id), ids, "ids survive label changes");
  assert.equal(ctx.calls.toast.length, 0);
  const before = ctx.calls.content.length;
  for (let i = 0; i < 20; i++) { app.tick(); app.event({ type: "level" }); app.event({ type: "node_status", link: "usb", fw: "0.1.2", sensor: { addr: 68, ok: 1, fail: 0, err: 0 } }); }
  assert.equal(ctx.calls.content.length, before + 1, "only the first node_status changes the markup");
  ctx.currentActions.find((a) => a.id === "lights-off").run();
  app.dispose(); assert.ok(!lit(ctx.calls.leds.at(-1)));
  for (const action of ctx.currentActions) if (action.id !== "home") assert.doesNotThrow(() => action.run());
});

test("Chronometer: large nearest readout, drain lamps, countdown, off on dispose", () => {
  const timers = [
    { id: "a", label: "TEA", running: true, remaining: 120, duration: 300, finished: false },
    { id: "b", label: "FOCUS", running: true, remaining: 30, duration: 1500, finished: false },
  ];
  const ctx = appContext({ state: { timers } });
  const app = new Timers(ctx);
  const html = ctx.calls.content.at(-1);
  assert.match(html, /timer-hero/);
  assert.match(html, /FOCUS · OF 25:00/);
  assert.ok(html.indexOf("00:30") < html.indexOf("TEA"), "the nearest timer comes first");
  assert.equal(nearestTimer(timers).id, "b");
  assert.equal(nearestTimer([{ running: false, remaining: 5 }]), null);
  // The drain bar: full timer lights three lamps, half a timer one and a half, nothing at zero.
  const full = timerLamps({ running: true, remaining: 3600, duration: 3600 });
  assert.ok(full[0] > 0 && full[3] > 0 && full[6] > 0);
  const half = timerLamps({ running: true, remaining: 1800, duration: 3600 });
  assert.ok(half[0] > 0 && half[3] > 0 && half[6] === 0, "right lamp drains first");
  const nearly = timerLamps({ running: true, remaining: 100, duration: 3600 });
  assert.ok(nearly[0] > 0 && nearly[3] === 0 && nearly[6] === 0, "only the left lamp is left");
  assert.ok(Math.max(...full) <= 100, "sustained light stays well under a third");
  // The last ten seconds follow the host's amber 3, 2, 1 countdown.
  const count = (leds) => [0, 3, 6].filter((i) => leds[i] > 0).length;
  assert.equal(count(countdownLamps(9)), 3); assert.equal(count(countdownLamps(5)), 2); assert.equal(count(countdownLamps(2)), 1);
  assert.deepEqual(timerLamps({ running: true, remaining: 9, duration: 600 }), countdownLamps(9));
  assert.ok(!lit(timerLamps({ running: false, finished: true, remaining: 0, duration: 60 })));
  assert.ok(ctx.calls.leds.length > 0 && lit(ctx.calls.leds.at(-1)));
  // Quiet when nothing changed, stable ids, nothing lit after dispose.
  const before = ctx.calls.content.length;
  for (let i = 0; i < 10; i++) app.tick();
  assert.equal(ctx.calls.content.length, before);
  const ids = ctx.currentActions.map((a) => a.id);
  app.tick(); assert.deepEqual(ctx.currentActions.map((a) => a.id), ids);
  for (const action of ctx.currentActions) if (action.id !== "home") assert.doesNotThrow(() => action.run());
  app.dispose(); assert.ok(!lit(ctx.calls.leds.at(-1)));
});

test("Chronometer without timers does not take the lamps", () => {
  const ctx = appContext(); const app = new Timers(ctx);
  assert.match(ctx.calls.content.at(-1), /00:00/);
  app.tick(); app.dispose();
  assert.equal(ctx.calls.leds.length, 0);
});

test("Chronometer: many timers stay compact and the wizard still works", () => {
  const timers = Array.from({ length: 8 }, (_, i) => ({ id: "t" + i, label: "T" + i, running: i === 3, remaining: 60 + i, duration: 120 }));
  const ctx = appContext({ state: { timers } });
  const app = new Timers(ctx);
  assert.equal((ctx.calls.content.at(-1).match(/class="timer-row"/g) || []).length, 3);
  assert.match(ctx.calls.content.at(-1), /\+ 4 MORE TIMERS/);
  ctx.currentActions.find((a) => a.id === "custom").run();
  assert.match(ctx.calls.content.at(-1), /Build a field timer/);
  app.tick(); assert.match(ctx.calls.content.at(-1), /Build a field timer/);
  ctx.currentActions.find((a) => a.id === "cancel-custom").run();
  assert.match(ctx.calls.content.at(-1), /timer-hero/);
});

test("Field Notes does not reload on repeated identical mic messages", async () => {
  const paths = [];
  const ctx = appContext({ state: { mic: { mode: "off" } }, get: (path) => { paths.push(path); return path.startsWith("sessions") ? [{ id: "s1", started: 1, lines: 0 }] : []; } });
  const app = new Transcription(ctx); await settle();
  const loads = paths.length;
  for (let i = 0; i < 5; i++) app.event({ type: "mic", mode: "off", session: undefined });
  await settle();
  assert.equal(paths.length, loads, "no refetch while mode and session are unchanged");
  app.event({ type: "mic", mode: "transcribe", session: "s2" }); await settle();
  assert.ok(paths.length > loads, "a new session is fetched");
  const renders = ctx.calls.content.length;
  app.event({ type: "speech", text: "hello", final: false, session: "s2" });
  app.event({ type: "speech", text: "hello", final: false, session: "s2" });
  assert.equal(ctx.calls.content.length, renders + 2);
  const ids = ctx.currentActions.map((a) => a.id);
  assert.ok(ids.every(Boolean));
});

test("Calibration: every action has a stable id and runs", () => {
  const ctx = appContext({ settings: { gesturePace: "standard", lampLevel: "medium" } });
  const app = new Settings(ctx);
  const ids = ctx.currentActions.map((a) => a.id);
  assert.ok(ids.every(Boolean) && new Set(ids).size === ids.length, ids.join());
  for (const id of ["lamp-level", "lamp-ambient"]) assert.ok(ids.includes(id), "lamp settings are untouched");
  for (const action of ctx.currentActions) if (action.id !== "home") assert.doesNotThrow(() => action.run());
});
