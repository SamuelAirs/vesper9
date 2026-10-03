import test from "node:test";
import assert from "node:assert/strict";
import { appContext } from "./helpers/app-context.mjs";
import { Telemetry, assess, nodeLevel, healthLamps, THRESHOLDS, ABANDON_MS, HISTORY_MAX, formatBytes, formatDuration } from "../web/apps/telemetry.js";

const valid = (v) => v.length === 9 && v.every((n) => Number.isInteger(n) && n >= 0 && n <= 255);
const GIB = 1024 ** 3;
const DARK = Array(9).fill(0);
const flags = (over = {}) => ({ raw: "0x0", underVoltageNow: false, freqCappedNow: false, throttledNow: false, softTempLimitNow: false,
  underVoltageOccurred: false, freqCappedOccurred: false, throttledOccurred: false, softTempLimitOccurred: false, ...over });
const payload = (host = {}, node = {}, top = {}) => ({
  schema: 1, at: 1, simulated: false,
  host: { model: "Raspberry Pi 5", cpuTempC: 52, loadAvg: [0.4, 0.3, 0.2], cpuCount: 4, cpuPercent: 12, cpuPerCore: [10, 12, 14, 12], cpuWindowS: 2,
    memory: { totalBytes: 8 * GIB, availableBytes: 6 * GIB }, disk: { totalBytes: 100 * GIB, freeBytes: 60 * GIB }, uptimeS: 7200, throttled: flags(), ...host },
  service: { version: "0.2.0", startedAt: 1, uptimeS: 3600, rssBytes: 4e7, pid: 99, python: "3.13", tasks: { device: true, timers: true }, clients: 1, micMode: "off" },
  node: { connected: true, simulated: false, port: "/dev/ttyACM0", link: "usb", firmware: "0.1.2", statusAgeS: 0.5, capture: false, generation: 1,
    crcErrors: 0, missingSamples: 0, audioBytes: 0, nodeRxCrc: 0, audioDrops: 0, sensor: { ok: 100, fail: 0, addr: 68, err: null }, ...node },
  ...top,
});
const NULLS = { schema: null, at: null, simulated: false,
  host: { model: null, cpuTempC: null, loadAvg: null, cpuCount: null, cpuPercent: null, cpuPerCore: null, cpuWindowS: null, memory: null, disk: null, uptimeS: null, throttled: null },
  service: { version: null, startedAt: null, uptimeS: null, rssBytes: null, pid: null, python: null, tasks: null, clients: null, micMode: null },
  node: { connected: null, simulated: null, port: null, link: null, firmware: null, statusAgeS: null, capture: null, generation: null, crcErrors: null,
    missingSamples: null, audioBytes: null, nodeRxCrc: null, audioDrops: null, sensor: null } };

const flush = () => new Promise((r) => setImmediate(r));
// A controllable endpoint: serve(x) sets the next reply (a payload or an Error); state.hold
// makes requests hang. The clock is fake; step(s) advances it and calls tick().
function open(first, options = {}) {
  let t = 1_000_000, current = first;
  const requests = [];
  const state = { inflight: 0, maxInflight: 0, hold: false };
  const ctx = appContext({ settings: options.settings });
  ctx.get = (path) => {
    requests.push(path);
    state.inflight++;
    state.maxInflight = Math.max(state.maxInflight, state.inflight);
    if (state.hold) return new Promise(() => {});
    const result = current instanceof Error ? Promise.reject(current) : Promise.resolve(current);
    const done = () => { state.inflight--; };
    result.then(done, done);
    return result;
  };
  const app = new Telemetry(ctx, { clock: () => t });
  return { ctx, app, requests, state, serve: (p) => { current = p; },
    step: async (seconds = 1) => { t += seconds * 1000; app.tick(); await flush(); },
    jump: (ms) => { t += ms; } };
}
const text = (app, id) => app.shown[id]?.text;
const level = (app, id) => app.shown[id]?.level;
const lastLeds = (ctx) => ctx.calls.leds.at(-1);

test("verdict thresholds", () => {
  const a = (host) => assess(payload(host));
  assert.equal(a({ cpuTempC: 69.9 }).tempLevel, 0);
  assert.equal(a({ cpuTempC: 70 }).tempLevel, 1);
  assert.equal(a({ cpuTempC: 79.9 }).tempLevel, 1);
  assert.equal(a({ cpuTempC: 80 }).tempLevel, 2);
  assert.equal(a({ cpuPercent: 69 }).cpuLevel, 0);
  assert.equal(a({ cpuPercent: 70 }).cpuLevel, 1);
  assert.equal(a({ cpuPercent: 90 }).cpuLevel, 2);
  const mem = (avail) => a({ memory: { totalBytes: 8 * GIB, availableBytes: avail * GIB } });
  assert.equal(mem(3).memLevel, 0);
  assert.equal(mem(1.4).memLevel, 1);
  assert.equal(mem(0.4).memLevel, 2);
  const disk = (free) => a({ disk: { totalBytes: 100 * GIB, freeBytes: free * GIB } });
  assert.equal(disk(50).diskLevel, 0);
  assert.equal(disk(15).diskLevel, 1);
  assert.equal(disk(5).diskLevel, 2);
  assert.equal(a({ disk: { totalBytes: 4 * GIB, freeBytes: 0.5 * GIB } }).diskLevel, 2);
  assert.equal(a({ throttled: flags({ underVoltageNow: true }) }).throttleLevel, 2);
  assert.equal(a({ throttled: flags({ softTempLimitNow: true }) }).throttleLevel, 1);
  assert.equal(a({ throttled: flags({ throttledOccurred: true }) }).throttleLevel, 0);
  assert.equal(THRESHOLDS.tempC[1], 80);
});

test("assess tolerates garbage", () => {
  for (const bad of [null, undefined, 5, "x", [], {}, NULLS, { host: 3, node: "x", service: [] },
    { host: { cpuTempC: NaN, memory: { totalBytes: 0, availableBytes: 0 }, disk: { totalBytes: "a" } } }]) {
    const a = assess(bad);
    for (const key of ["tempC", "cpu", "memPercent", "freePercent"]) assert.ok(a[key] === null || Number.isFinite(a[key]), key);
    assert.equal(a.tempLevel, null);
    assert.equal(a.connected, null);
  }
  assert.equal(formatBytes(null), "—");
  assert.equal(formatBytes(NaN), "—");
  assert.equal(formatDuration(undefined), "—");
  assert.equal(formatDuration(90061), "1 D 1 H 1 M");
});

test("healthy payload: normal verdicts, Fahrenheit, dim green lamps", async () => {
  const { app, ctx } = open(payload());
  await flush();
  assert.equal(text(app, "temp-v"), "126 °F");
  assert.equal(text(app, "temp-s"), "NORMAL");
  assert.equal(level(app, "cpu-v"), 0);
  assert.equal(text(app, "cpu-v"), "12 %");
  assert.equal(text(app, "mem-v"), "25 %");
  assert.equal(text(app, "disk-v"), "60.0 GB");
  assert.equal(text(app, "power"), "NONE");
  assert.equal(text(app, "status"), "LIVE");
  app.tick();
  const l = lastLeds(ctx);
  assert.ok(valid(l));
  for (const i of [0, 1, 2]) assert.ok(l[i * 3 + 1] > l[i * 3] && l[i * 3 + 1] > 0 && l[i * 3 + 1] <= 40, "dim green " + l);
});

test("Celsius setting is honoured", async () => {
  const { app } = open(payload(), { settings: { tempUnit: "C" } });
  await flush();
  assert.equal(text(app, "temp-v"), "52 °C");
});

test("hot payload: warm verdict, amber left lamp, middle stays green", async () => {
  const { app, ctx } = open(payload({ cpuTempC: 74 }));
  await flush();
  assert.equal(text(app, "temp-s"), "WARM");
  assert.equal(level(app, "temp-v"), 1);
  app.tick();
  const l = lastLeds(ctx);
  assert.ok(l[0] > l[1] && l[1] > 0, "amber " + l.slice(0, 3));
  assert.ok(l[4] > l[3], "middle green");
});

test("critical payload: critical verdicts, flags, red lamps that pulse", async () => {
  const hot = payload({ cpuTempC: 84, cpuPercent: 97, memory: { totalBytes: 8 * GIB, availableBytes: 0.2 * GIB },
    disk: { totalBytes: 100 * GIB, freeBytes: 4 * GIB }, throttled: flags({ underVoltageNow: true, throttledOccurred: true }) }, { crcErrors: 3 });
  const { app, ctx, jump } = open(hot);
  await flush();
  for (const id of ["temp", "cpu", "mem", "disk"]) assert.equal(text(app, id + "-s"), "CRITICAL", id);
  assert.match(text(app, "power"), /UNDER-VOLTAGE/);
  assert.equal(level(app, "power"), 2);
  const reds = new Set();
  for (let i = 0; i < 12; i++) {
    jump(300); // within the data's freshness, so only the pulse phase moves
    app.lastOkAt = app.clock();
    app.tick();
    const l = lastLeds(ctx);
    assert.ok(valid(l));
    assert.ok(l[0] > l[1] && l[3] > l[4], "red");
    assert.ok(Math.max(...l) <= 0.34 * 255 + 1);
    reds.add(l[0]);
  }
  assert.ok(reds.size > 3, "the red pulses");
});

test("node disconnected: right lamp dark with a slow amber blink", async () => {
  const { app, ctx, jump } = open(payload({}, { connected: false }));
  await flush();
  assert.equal(text(app, "link"), "DISCONNECTED");
  const seen = new Set();
  for (let i = 0; i < 8; i++) {
    jump(500);
    app.lastOkAt = app.clock();
    app.tick();
    const l = lastLeds(ctx), right = l.slice(6, 9);
    seen.add(right.every((v) => v === 0) ? "dark" : "amber");
    if (right.some((v) => v)) assert.ok(right[0] > right[1] && right[2] === 0);
    assert.ok(l[1] > 0 && l[4] > 0, "other lamps still green");
  }
  assert.deepEqual([...seen].sort(), ["amber", "dark"]);
});

test("node page explains counters in words", async () => {
  const { app } = open(payload({}, { crcErrors: 4, missingSamples: 9, sensor: { ok: 10, fail: 2, addr: 68, err: "nack" } }));
  await flush();
  assert.equal(text(app, "crc"), "4");
  assert.match(text(app, "n-crc"), /damaged/i);
  assert.match(text(app, "n-miss"), /never arrived/i);
  assert.equal(text(app, "sensor"), undefined, "no sensor rows: the node has no sensor");
  assert.equal(text(app, "n-sensor"), undefined);
  assert.equal(text(app, "ltype"), "USB");
  assert.equal(text(app, "port"), "/dev/ttyACM0");
  assert.equal(text(app, "fw"), "0.1.2");
});

test("every field null: dashes, no NaN or undefined, dark lamps", async () => {
  const { app, ctx } = open(NULLS);
  await flush();
  app.tick();
  for (const [id, v] of Object.entries(app.shown)) assert.ok(!/NaN|undefined|null|Infinity/.test(v.text), id + ": " + v.text);
  for (const id of ["temp-v", "cpu-v", "mem-v", "disk-v", "up", "port", "fw", "crc", "miss", "a-fw", "a-svc", "link"]) assert.equal(text(app, id), "—", id);
  assert.equal(text(app, "temp-s"), "NO DATA");
  assert.equal(text(app, "power"), "NOT REPORTED");
  assert.deepEqual(lastLeds(ctx), DARK);
  assert.equal(app.history.length, 1);
});

test("simulated payload says so on screen", async () => {
  const { app } = open(payload({}, { simulated: true, firmware: "simulated" }, { simulated: true }));
  await flush();
  assert.match(text(app, "status"), /SIMULATED/);
});

test("request rejected: values kept, stale with age, lamps dark in time, recovers by itself", async () => {
  const { app, ctx, step, serve } = open(payload({ cpuTempC: 60 }));
  await flush();
  assert.equal(text(app, "status"), "LIVE");
  serve(new Error("down"));
  await step(2);
  assert.match(text(app, "status"), /^STALE \/ LAST DATA \d+ S AGO/);
  assert.equal(text(app, "temp-v"), "140 °F");
  assert.ok(lastLeds(ctx).some((v) => v > 0), "recent verdict still shown");
  await step(2); await step(2); await step(2); await step(2); await step(2); await step(2); await step(2);
  assert.match(text(app, "status"), /STALE/);
  assert.equal(text(app, "temp-v"), "140 °F");
  assert.deepEqual(lastLeds(ctx), DARK);
  serve(payload({ cpuTempC: 61 }));
  await step(2);
  assert.equal(text(app, "status"), "LIVE");
  assert.equal(text(app, "temp-v"), "142 °F");
  assert.ok(lastLeds(ctx).some((v) => v > 0));
});

test("never any data: says so, keeps trying", async () => {
  const { app, step, requests } = open(new Error("down"));
  await flush();
  assert.match(text(app, "status"), /NO DATA/);
  assert.equal(text(app, "temp-v"), "—");
  await step(2); await step(2);
  assert.equal(requests.length, 3);
  assert.match(text(app, "status"), /NO DATA/);
});

test("non-object replies count as failures", async () => {
  const { app, step, serve } = open(payload());
  await flush();
  serve("garbage");
  await step(2);
  assert.match(text(app, "status"), /STALE/);
  serve(null);
  await step(2);
  assert.match(text(app, "status"), /STALE/);
});

test("polling is paced, never overlaps, abandons a hung request, stops on dispose", async () => {
  const h = open(payload());
  await flush();
  assert.equal(h.requests.length, 1);
  await h.step(1);
  assert.equal(h.requests.length, 1, "not before two seconds");
  await h.step(1);
  assert.equal(h.requests.length, 2);
  for (let i = 0; i < 20; i++) await h.step(1);
  assert.equal(h.requests.length, 12, "one request per two seconds");
  assert.ok(h.requests.every((p) => p === "system"));
  assert.equal(h.state.maxInflight, 1);
  h.state.hold = true;
  await h.step(2);
  const before = h.requests.length;
  await h.step(2); await h.step(2); await h.step(2);
  assert.equal(h.requests.length, before, "nothing new while one is outstanding");
  await h.step(ABANDON_MS / 1000);
  assert.equal(h.requests.length, before + 1, "hung request given up on and retried");
  const n = h.requests.length;
  h.app.dispose();
  await h.step(10); await h.step(10);
  assert.equal(h.requests.length, n, "no polling after dispose");
});

test("a late answer after dispose is ignored", async () => {
  const ctx = appContext();
  let resolve;
  ctx.get = () => new Promise((r) => { resolve = r; });
  const app = new Telemetry(ctx, { clock: () => 0 });
  app.dispose();
  resolve(payload());
  await flush();
  assert.equal(app.last, null);
  assert.deepEqual(lastLeds(ctx), DARK);
});

test("a ctx.get that throws is a failed request", async () => {
  const ctx = appContext();
  ctx.get = () => { throw new Error("boom"); };
  const app = new Telemetry(ctx, { clock: () => 5 });
  await flush();
  assert.match(text(app, "status"), /NO DATA/);
  assert.doesNotThrow(() => { app.tick(); app.dispose(); });
});

test("history is bounded; charts and frame times fill in", async () => {
  const h = open(payload());
  h.ctx.stats = () => ({ samples: 100, medianMs: 16.7, p95Ms: 16.7, errors: 0 });
  await flush();
  for (let i = 0; i < HISTORY_MAX + 50; i++) {
    h.serve(payload({ cpuTempC: 40 + (i % 40), cpuPercent: i % 100 }));
    await h.step(2);
  }
  assert.equal(h.app.history.length, HISTORY_MAX);
  assert.ok(h.app.cpuRecent.length <= 3 && h.app.errorLog.length <= 40);
  assert.match(h.app.attrs["ctemp-line|points"], /^[\d.,\- ]+$/);
  assert.equal(text(h.app, "fmed"), "16.7 MS");
  assert.equal(text(h.app, "fp95"), "16.7 MS");
  assert.match(text(h.app, "ctemp-v"), /LAST/);
});

test("node verdict levels", () => {
  const a = (extra = {}) => assess(payload({}, extra));
  assert.equal(nodeLevel(a(), 0), 0);
  assert.equal(nodeLevel(a(), 3), 1);
  assert.equal(nodeLevel(a(), 25), 2);
  assert.equal(nodeLevel(a({ statusAgeS: 12 }), 0), 1);
  assert.equal(nodeLevel(a({ statusAgeS: 45 }), 0), 2);
  assert.equal(nodeLevel(a({ connected: false }), 0), "down");
  assert.equal(nodeLevel(a({ connected: null }), 0), null);
  assert.equal(nodeLevel(a({ sensor: { ok: 0, fail: 5 } }), 0), 0, "the node has no sensor: its reads say nothing");
});

test("rising counters turn the right lamp amber; old steady counts and restarts do not", async () => {
  const h = open(payload({}, { crcErrors: 5 }));
  await flush();
  await h.step(2);
  h.app.tick();
  let l = lastLeds(h.ctx);
  assert.ok(l[7] > l[6], "green with an old steady count");
  h.serve(payload({}, { crcErrors: 9 }));
  await h.step(2);
  h.app.tick();
  l = lastLeds(h.ctx);
  assert.ok(l[6] > 0 && l[6] > l[7], "amber after new errors");
  h.serve(payload({}, { crcErrors: 0 }));
  await h.step(2);
  assert.equal(h.app.recentErrors(), 0);
});

test("healthLamps: nine whole bytes, quiet, dark when unknown", () => {
  for (const l of [0, 1, 2, null, "down"]) for (const m of [0, 1, 2, null]) for (const r of [0, 1, 2, null, "down"]) for (let s = 0; s < 6; s += 0.37) {
    const v = healthLamps(l, m, r, s);
    assert.ok(valid(v));
    assert.ok(Math.max(...v) <= 0.34 * 255 + 1);
  }
  assert.deepEqual(healthLamps(null, null, null, 1), DARK);
});

test("actions: stable list, all run, content built once while polling and paging", async () => {
  const h = open(payload());
  await flush();
  assert.equal(h.ctx.calls.content.length, 1);
  const actionCalls = h.ctx.calls.actions.length;
  const labels = h.ctx.currentActions.map((a) => a.label);
  assert.ok(labels.length <= 8 && labels.at(-1) === "RETURN TO DASHBOARD");
  for (const action of h.ctx.currentActions) assert.doesNotThrow(() => action.run());
  for (let i = 0; i < 20; i++) await h.step(1);
  assert.equal(h.ctx.calls.content.length, 1, "content is built once");
  assert.equal(h.ctx.calls.actions.length, actionCalls, "action list is not rebuilt");
  assert.deepEqual(h.ctx.currentActions.map((a) => a.label), labels);
  // four rows are all it takes (the screen has room for the hint line under them): next and
  // previous reach every page in at most two steps
  assert.deepEqual(labels, ["NEXT PAGE →", "PREVIOUS PAGE", "REFRESH NOW", "RETURN TO DASHBOARD"]);
  const [next, previous] = h.ctx.currentActions;
  next.run(); next.run();
  assert.equal(h.app.attrs["page-2|hidden"], false);
  assert.equal(h.app.attrs["page-0|hidden"], true);
  next.run();
  assert.equal(h.app.attrs["page-3|hidden"], false);
  next.run();
  assert.equal(h.app.attrs["page-0|hidden"], false);
  previous.run();
  assert.equal(h.app.attrs["page-3|hidden"], false);
});

test("dispose leaves the lamps dark; later calls are harmless", async () => {
  const h = open(payload({ cpuTempC: 90 }));
  await flush();
  h.app.tick();
  assert.ok(lastLeds(h.ctx).some((v) => v > 0));
  h.app.dispose();
  assert.deepEqual(lastLeds(h.ctx), DARK);
  assert.doesNotThrow(() => { h.app.tick(); h.app.cancel(); h.app.dispose(); });
  assert.deepEqual(lastLeds(h.ctx), DARK);
});

test("payload text never enters markup", async () => {
  const h = open(payload({}, { port: "<img src=x onerror=alert(1)>", firmware: "<b>" }));
  await flush();
  h.app.cancel();
  assert.ok(!h.ctx.calls.content.some((c) => c.includes("onerror")));
  assert.equal(text(h.app, "port"), "<img src=x onerror=alert(1)>"); // written with textContent
});

// What the host does with the highlight when a list is published (web/main.js setNav): it stays
// on the action with the same id, otherwise on the same row number. `card` is the row the
// dashboard had highlighted when the instrument opened: the first list starts at that row.
function highlighted(ctx, card) {
  let items = null, index = card;
  const idOf = (i) => i.id || i.label;
  for (const next of ctx.calls.actions) {
    const match = items ? next.findIndex((i) => idOf(i) === idOf(items[index])) : -1;
    index = Math.min(match >= 0 ? match : index, next.length - 1);
    items = next;
  }
  return items[index].label;
}

test("opened from any dashboard card NEXT PAGE is highlighted, not REFRESH NOW or RETURN TO DASHBOARD", () => {
  for (let card = 0; card < 8; card++) assert.equal(highlighted(open(payload()).ctx, card), "NEXT PAGE →", "card " + card);
});

test("frames are requested only while a lamp pulses or blinks, and not while the system menu is open", async () => {
  const queue = [];
  globalThis.requestAnimationFrame = (fn) => queue.push(fn);
  globalThis.cancelAnimationFrame = () => {};
  try {
    const rig = open(payload());
    await flush();
    assert.equal(queue.length, 0, "a healthy panel needs no frames");
    rig.serve(payload({ cpuTempC: 85 }));
    await rig.step(2);
    assert.equal(queue.length, 1, "critical pulses red, which needs frames");
    rig.app.pause();
    const n = rig.ctx.calls.leds.length;
    while (queue.length) queue.shift()();
    await rig.step(2);
    assert.equal(rig.ctx.calls.leds.length, n, "nothing is written while paused");
    assert.equal(queue.length, 0);
    rig.app.resume();
    assert.ok(rig.ctx.calls.leds.length > n);
    assert.equal(queue.length, 1);
    rig.serve(payload());
    await rig.step(2);
    while (queue.length) queue.shift()();
    assert.equal(queue.length, 0, "the loop ends when the verdict is steady again");
    rig.app.dispose();
    assert.deepEqual(lastLeds(rig.ctx), DARK);
  } finally {
    delete globalThis.requestAnimationFrame;
    delete globalThis.cancelAnimationFrame;
  }
});
