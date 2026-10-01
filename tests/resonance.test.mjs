import test from "node:test";
import assert from "node:assert/strict";
import { appContext } from "./helpers/app-context.mjs";
import {
  Resonance, noteFromHz, median, levelLamps, spectrumLamps, tunerLamps, scopeStatus,
  BAND_COUNT, HISTORY_BINS, SUSTAIN,
} from "../web/apps/resonance.js";

// A minimal DOM: every id exists and records the text and attributes written to it.
const elements = new Map();
globalThis.document = {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, { id, textContent: "", attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, writes: 0 });
    return elements.get(id);
  },
};
const text = (id) => elements.get(id)?.textContent;

const valid = (v) => v.length === 9 && v.every((n) => Number.isInteger(n) && n >= 0 && n <= 255);
const quiet = Array(BAND_COUNT).fill(-93);
const frame = (o = {}) => ({ type: "analysis", at: 1, seq: 0, rmsDb: -40, peakDb: -35, bands: quiet, pitch: null, simulated: true, ...o });
const pitch = (hz, confidence = 0.95) => frame({ pitch: { hz, confidence } });

// A rig: the app on a context whose setMic behaves like the host and service (the mic event
// arrives before the reply, as in the real protocol).
function rig(options = {}) {
  elements.clear();
  const ctx = appContext(options);
  ctx.calls.mic = [];
  let app;
  const state = ctx.state();
  state.device = { connected: true, capture: false, ...(options.device || {}) };
  if (options.mode) { state.mic.mode = options.mode; state.device.capture = true; }
  if (options.controller === false) state.controller = false;
  ctx.setMic = (mode) => {
    ctx.calls.mic.push(mode);
    if (options.failStart && mode === "analyze") return Promise.reject(new Error("Node did not start microphone capture"));
    state.mic.mode = mode;
    state.device.capture = mode !== "off";
    app.event({ type: "mic", mode, session: null, capture: mode !== "off", error: null });
    return Promise.resolve();
  };
  app = new Resonance(ctx);
  let t = 1000;
  app.clock = () => t;
  return { ctx, app, state, advance: (ms) => { t += ms; }, labels: () => ctx.currentActions.map((a) => a.label),
    act: (label) => ctx.currentActions.find((a) => a.label.startsWith(label)).run(),
    lastLamps: () => ctx.calls.leds.at(-1), now: () => t };
}
const feed = (r, events, stepMs = 100) => events.forEach((e) => { r.advance(stepMs); r.app.event(e); });
const listen = async (r) => { await r.act("START LISTENING"); return r; };

test("note arithmetic against known frequencies", () => {
  const a4 = noteFromHz(440);
  assert.equal(a4.name + a4.octave, "A4");
  assert.equal(a4.cents, 0);
  const sharp = noteFromHz(445);
  assert.equal(sharp.name + sharp.octave, "A4");
  assert.ok(Math.abs(sharp.cents - 19.56) < 0.05, "445 Hz is about +19.6 cents: " + sharp.cents);
  const c4 = noteFromHz(261.63);
  assert.equal(c4.name + c4.octave, "C4");
  assert.ok(Math.abs(c4.cents) < 0.1);
  assert.equal(noteFromHz(466.16).name, "A#");
  assert.equal(noteFromHz(27.5).octave, 0);
  const flat = noteFromHz(430);
  assert.equal(flat.name, "A");
  assert.ok(flat.cents < -35 && flat.cents > -40, "430 Hz is flat of A4: " + flat.cents);
  // Exactly between two notes the deviation stays inside -50..+50.
  for (let hz = 60; hz < 800; hz += 0.7) assert.ok(Math.abs(noteFromHz(hz).cents) <= 50 + 1e-9);
  for (const bad of [0, -5, NaN, Infinity, null, undefined, "440"]) assert.equal(noteFromHz(bad), null);
});

test("median", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.ok(Number.isNaN(median([])));
  assert.equal(median([1, NaN, 5, 3]), 3);
});

test("opening the instrument never starts capture", () => {
  const r = rig();
  assert.deepEqual(r.ctx.calls.mic, []);
  assert.equal(r.labels()[0], "START LISTENING");
  assert.equal(r.ctx.calls.leds.length, 0, "the lamps stay with the host until there is a reading");
  assert.equal(r.app.status.code, "muted");
  assert.match(text("rs-state"), /MUTED/);
  assert.equal(r.ctx.calls.content.length, 1);
  assert.ok(r.labels().includes("RETURN TO DASHBOARD"));
});

test("start, confirm, stop and the status text", async () => {
  const r = rig();
  await listen(r);
  assert.deepEqual(r.ctx.calls.mic, ["analyze"]);
  assert.equal(r.app.owned, true);
  assert.equal(r.app.status.code, "listening");
  assert.match(text("rs-state"), /LISTENING/);
  assert.equal(r.labels()[0], "STOP LISTENING");
  await r.act("STOP LISTENING");
  assert.deepEqual(r.ctx.calls.mic, ["analyze", "off"]);
  assert.equal(r.app.owned, false);
  assert.equal(r.app.status.code, "muted");
  assert.equal(r.labels()[0], "START LISTENING");
});

test("a request the node never confirms shows waiting, not listening", () => {
  const r = rig();
  r.state.mic.mode = "analyze"; // requested; device.capture still false
  r.app.event({ type: "mic", mode: "analyze", capture: false });
  assert.equal(r.app.status.code, "waiting");
  assert.equal(r.app.status.listening, false);
});

test("exit paths: dispose switches off only what this instrument switched on", async () => {
  // started here
  let r = rig();
  await listen(r);
  r.app.dispose();
  assert.deepEqual(r.ctx.calls.mic, ["analyze", "off"]);
  assert.ok(r.ctx.calls.leds.length && r.lastLamps().every((v) => v === 0));
  // dictation started elsewhere: opening and leaving never touches it
  r = rig({ mode: "transcribe" });
  r.app.dispose();
  assert.deepEqual(r.ctx.calls.mic, []);
  // analysis already running when opened: not ours either
  r = rig({ mode: "analyze" });
  assert.equal(r.app.status.code, "listening");
  r.app.dispose();
  assert.deepEqual(r.ctx.calls.mic, []);
  // dispose while the start request is still in flight
  r = rig();
  r.ctx.setMic = (mode) => { r.ctx.calls.mic.push(mode); return new Promise(() => {}); };
  r.act("START LISTENING");
  r.app.dispose();
  assert.deepEqual(r.ctx.calls.mic, ["analyze", "off"]);
  // dispose twice is harmless
  r = rig();
  await listen(r);
  r.app.dispose();
  r.app.dispose();
  assert.deepEqual(r.ctx.calls.mic, ["analyze", "off"]);
});

test("another mode: say so, offer to switch, switch only when asked, then own it", async () => {
  const r = rig({ mode: "transcribe" });
  assert.equal(r.app.status.code, "other");
  assert.match(r.app.status.label, /DICTATION/);
  assert.match(r.labels()[0], /^SWITCH MIC TO SCOPE \(ENDS DICTATION\)/);
  assert.deepEqual(r.ctx.calls.mic, []);
  await r.act("SWITCH MIC TO SCOPE");
  assert.deepEqual(r.ctx.calls.mic, ["analyze"]);
  assert.equal(r.app.owned, true);
  r.app.dispose();
  assert.deepEqual(r.ctx.calls.mic, ["analyze", "off"]);
});

test("a mode change from the system menu drops ownership", async () => {
  let r = rig();
  await listen(r);
  r.state.mic.mode = "off"; r.state.device.capture = false;
  r.app.event({ type: "mic", mode: "off", capture: false, error: null });
  assert.equal(r.app.owned, false);
  r.app.dispose();
  assert.deepEqual(r.ctx.calls.mic, ["analyze"], "the owner muted it; do not send another off");
  // owner switched to dictation from the menu while the scope was open
  r = rig();
  await listen(r);
  r.state.mic.mode = "transcribe";
  r.app.event({ type: "mic", mode: "transcribe", capture: true, error: null });
  r.app.dispose();
  assert.deepEqual(r.ctx.calls.mic, ["analyze"], "dictation the owner chose is not switched off");
});

test("analysis_error: shown, ownership dropped, can start again", async () => {
  const r = rig();
  await listen(r);
  feed(r, [frame({ rmsDb: -20 })]);
  r.state.mic.mode = "off"; r.state.device.capture = false;
  r.app.event({ type: "analysis_error", error: "Analysis failed: no audio for 3 s" });
  assert.equal(r.app.status.code, "error");
  assert.match(text("rs-detail"), /no audio/);
  assert.equal(r.app.owned, false);
  assert.equal(r.labels()[0], "START LISTENING");
  assert.ok(r.lastLamps().every((v) => v === 0));
  r.app.dispose();
  assert.deepEqual(r.ctx.calls.mic, ["analyze"]);
  r.app.event({ type: "analysis_error" }); // after dispose: ignored
});

test("start request that fails shows the reason and owns nothing", async () => {
  const r = rig({ failStart: true });
  await listen(r);
  assert.equal(r.app.owned, false);
  assert.equal(r.app.status.code, "error");
  assert.match(text("rs-detail"), /did not start/);
  r.app.dispose();
  assert.deepEqual(r.ctx.calls.mic, ["analyze"]);
});

test("lost link, reset and reconnect", async () => {
  const r = rig();
  await listen(r);
  feed(r, [frame({ rmsDb: -20 })]);
  r.state.device.connected = false;
  r.app.event({ type: "offline" });
  assert.equal(r.app.status.code, "link");
  assert.equal(r.app.status.listening, false);
  assert.ok(r.lastLamps().every((v) => v === 0));
  assert.equal(r.app.owned, false);
  // reconnect: the service starts muted
  r.state.device.connected = true; r.state.device.capture = false; r.state.mic.mode = "off";
  r.app.event({ type: "state" });
  assert.equal(r.app.status.code, "muted");
  r.app.dispose();
  assert.deepEqual(r.ctx.calls.mic, ["analyze"]);
});

test("monitor tab: cannot start, says so, touches nothing", () => {
  const r = rig({ controller: false });
  assert.equal(r.app.status.code, "monitor");
  assert.match(text("rs-state"), /MONITOR/);
  r.act("START LISTENING");
  assert.deepEqual(r.ctx.calls.mic, []);
  assert.equal(r.ctx.calls.toast.length, 1);
  r.app.dispose();
  assert.deepEqual(r.ctx.calls.mic, []);
});

test("panel is built once per page; ten updates a second only touch attributes", async () => {
  const r = rig();
  await listen(r);
  const contentBefore = r.ctx.calls.content.length, actionsBefore = r.ctx.calls.actions.length;
  const events = [];
  for (let i = 0; i < 600; i++) events.push(frame({ rmsDb: -50 + (i % 40), peakDb: -45 + (i % 40), bands: quiet.map((v, k) => v + ((i + k) % 30)), pitch: i % 3 ? { hz: 220 + (i % 7), confidence: 0.9 } : null }));
  feed(r, events);
  assert.equal(r.ctx.calls.content.length, contentBefore, "no markup rebuilt by data");
  assert.equal(r.ctx.calls.actions.length, actionsBefore, "no action list rebuilt by data");
  for (let p = 0; p < 3; p++) {
    r.act("NEXT PAGE");
    feed(r, events.slice(0, 50));
  }
  assert.equal(r.ctx.calls.content.length, contentBefore + 3, "one build per page change");
  assert.equal(r.ctx.calls.actions.length, actionsBefore, "labels never change on page change");
  r.app.dispose();
});

test("level page: readout, peak hold, bar and bounded history", async () => {
  const r = rig();
  await listen(r);
  assert.match(r.ctx.calls.content.at(-1), /id="rs-db"/);
  feed(r, [frame({ rmsDb: -23, peakDb: -20 })]);
  assert.equal(text("rs-db"), "-23.0 dBFS");
  assert.match(text("rs-peak"), /-20\.0/);
  feed(r, [frame({ rmsDb: -40, peakDb: -38 })]);
  assert.match(text("rs-peak"), /-20\.0/, "peak is held");
  r.advance(3500);
  feed(r, [frame({ rmsDb: -40, peakDb: -38 })]);
  assert.match(text("rs-peak"), /-38\.0/, "and released after a while");
  feed(r, [frame({ rmsDb: -120, peakDb: -120 })]);
  assert.equal(text("rs-db"), "< -100 dBFS");
  // a long session keeps a bounded history; the chart string is non-empty and finite
  feed(r, Array.from({ length: 5000 }, (_, i) => frame({ rmsDb: -60 + (i % 50), peakDb: -50 + (i % 50) })), 100);
  assert.ok(r.app.hist.length <= HISTORY_BINS);
  const points = elements.get("rs-hist-rms").attrs.points;
  assert.ok(points.split(" ").length <= HISTORY_BINS + 1);
  assert.ok(!/NaN|Infinity/.test(points));
  r.act("CLEAR PEAK");
  assert.equal(r.app.hist.length, 0);
  r.app.dispose();
});

test("spectrum page: 28 bars, slow-falling peaks, frequency axis", async () => {
  const r = rig();
  await listen(r);
  r.act("NEXT PAGE");
  const html = r.ctx.calls.content.at(-1);
  for (let i = 0; i < BAND_COUNT; i++) assert.ok(html.includes(`id="rs-b${i}"`) && html.includes(`id="rs-k${i}"`));
  for (const label of ["100 Hz", "200 Hz", "500 Hz", "1 kHz", "2 kHz", "5 kHz"]) assert.ok(html.includes(label), label);
  const loud = quiet.map((v, i) => (i === 10 ? -25 : v));
  feed(r, [frame({ bands: loud })]);
  const tall = Number(elements.get("rs-b10").attrs.height), peakY = Number(elements.get("rs-k10").attrs.y1);
  assert.ok(tall > 100 && Number(elements.get("rs-b3").attrs.height) < 20);
  feed(r, [frame({ bands: quiet })], 100);
  assert.equal(Number(elements.get("rs-b10").attrs.height) < 20, true, "bar drops at once");
  assert.ok(Number(elements.get("rs-k10").attrs.y1) > peakY && Number(elements.get("rs-k10").attrs.y1) < 150 - 40, "peak falls slowly");
  r.app.dispose();
});

test("tuner: smoothing, outliers, blanking", async () => {
  const r = rig();
  await listen(r);
  r.act("NEXT PAGE"); r.act("NEXT PAGE");
  assert.match(r.ctx.calls.content.at(-1), /id="rs-needle"/);
  feed(r, [pitch(440)]);
  assert.equal(text("rs-note"), "—", "needs a few confident estimates first");
  feed(r, [pitch(440.5), pitch(439.6)]);
  assert.equal(text("rs-note"), "A4");
  assert.match(text("rs-hz"), /^44\d\.\d HZ$/);
  // one wild estimate is ignored by the median
  feed(r, [pitch(880)]);
  assert.equal(text("rs-note"), "A4");
  assert.ok(Math.abs(r.app.note.cents) < 5);
  // unclear frames hold the note briefly, then blank it
  feed(r, [frame(), frame(), frame()]);
  assert.equal(text("rs-note"), "A4");
  feed(r, [frame()]);
  assert.equal(text("rs-note"), "—");
  assert.equal(elements.get("rs-needle").attrs.opacity, "0");
  // low confidence counts as unclear
  feed(r, [pitch(440, 0.3), pitch(440, 0.5), pitch(440, 0.7), pitch(440, 0.79)]);
  assert.equal(text("rs-note"), "—");
  // 445 Hz reads sharp by about 19.6 cents
  feed(r, [pitch(445), pitch(445.2), pitch(444.9), pitch(445.1)]);
  assert.equal(text("rs-note"), "A4");
  assert.match(text("rs-cents"), /^SHARP \+19\.\d CENTS$/);
  assert.ok(Number(elements.get("rs-needle").attrs.x1) > 240);
  // a jittery 261.6 Hz is steady C4 and the label does not flicker
  feed(r, [frame()], 100); feed(r, [frame(), frame(), frame()]);
  const seen = new Set();
  for (let i = 0; i < 40; i++) { feed(r, [pitch(261.63 * (1 + ((i * 7) % 5 - 2) * 0.0008))]); if (i > 3) seen.add(text("rs-note")); }
  assert.deepEqual([...seen], ["C4"]);
  r.app.dispose();
});

test("lamps: level bar", () => {
  const silent = levelLamps(0, 0, true), mid = levelLamps(0.5, 0, true), loud = levelLamps(0.8, 0, true), full = levelLamps(1, 0, true);
  for (const v of [silent, mid, loud, full, levelLamps(NaN, NaN), levelLamps(-3, 9), levelLamps(0.5, 1)]) assert.ok(valid(v), v.join());
  assert.ok(silent[1] > 0 && silent[3] === 0 && silent[6] === 0, "a faint glimmer on the left only");
  assert.ok(silent[1] < 8);
  assert.ok(mid[1] > mid[4] && mid[4] > 0 && mid[7] === 0, "bar fills left to right");
  assert.ok(loud[1] > 0 && loud[4] > 0 && loud[7] > 0);
  assert.ok(full[3] > full[4], "red near full scale on the right");
  assert.ok(full[6] > 3 * full[7], "right lamp turns red at full scale");
  assert.ok(mid[1] > mid[0] && mid[0] < 40, "left lamp is green at mid level");
  for (const v of [mid, loud, full]) assert.ok(Math.max(...v) <= 255 * (SUSTAIN + 0.02), "sustained light stays moderate");
  assert.ok(Math.max(...levelLamps(1, 1)) > 2 * Math.max(...full), "the accent is brighter");
  assert.equal(Math.max(...levelLamps(1, 1)), Math.round(255 * 0.85));
});

test("lamps: spectrum thirds", () => {
  assert.deepEqual(spectrumLamps(0, 0, 0), Array(9).fill(0));
  const low = spectrumLamps(1, 0, 0), high = spectrumLamps(0, 0, 1);
  assert.ok(low[0] > 0 && low.slice(3).every((v) => v === 0));
  assert.ok(high[8] > 0 && high.slice(0, 6).every((v) => v === 0));
  assert.ok(valid(spectrumLamps(NaN, 2, -1)));
});

test("lamps: tuner", () => {
  assert.deepEqual(tunerLamps(null), Array(9).fill(0));
  const inTune = tunerLamps(0), edge = tunerLamps(5), nearFlat = tunerLamps(-10), farFlat = tunerLamps(-45), farSharp = tunerLamps(45);
  assert.ok(inTune[4] > 200 * SUSTAIN && inTune[3] < inTune[4] && inTune[0] === 0 && inTune[6] === 0 && inTune[7] === 0, "middle lamp green");
  assert.deepEqual(edge, tunerLamps(-5));
  assert.ok(nearFlat[0] > 0 && nearFlat.slice(3).every((v) => v === 0), "flat: left amber only");
  assert.ok(farFlat[0] > nearFlat[0], "brighter the further off");
  assert.ok(farSharp[6] > 0 && farSharp.slice(0, 6).every((v) => v === 0), "sharp: right amber only");
  assert.ok(Math.max(...farFlat) <= 255 * (SUSTAIN + 0.02));
  assert.ok(valid(tunerLamps(Infinity)) && valid(tunerLamps(-50)));
});

test("lamps follow the page and the data through the app, and go dark", async () => {
  const r = rig();
  await listen(r);
  feed(r, [frame({ rmsDb: -20, peakDb: -15 })]);
  const levelLeds = r.lastLamps();
  assert.ok(valid(levelLeds) && levelLeds.some((v) => v > 0));
  r.act("NEXT PAGE");
  feed(r, [frame({ bands: quiet.map((v, i) => (i < 5 ? -25 : v)) })]);
  const organ = r.lastLamps();
  assert.ok(organ[0] > 10 && organ[3] <= 10 && organ[6] === 0, "bass lights the low lamp: " + organ.join());
  r.act("NEXT PAGE");
  feed(r, [pitch(440), pitch(440), pitch(440)]);
  assert.deepEqual(r.lastLamps(), tunerLamps(0));
  feed(r, [pitch(430), pitch(430), pitch(430), pitch(430), pitch(430)]);
  assert.deepEqual(r.lastLamps(), tunerLamps(r.app.note.cents));
  assert.ok(r.app.note.cents < -30 && r.lastLamps()[0] > 0);
  for (const l of r.ctx.calls.leds) assert.ok(valid(l));
  // no pitch: dark
  feed(r, [frame(), frame(), frame(), frame()]);
  assert.deepEqual(r.lastLamps(), Array(9).fill(0));
  r.app.dispose();
  assert.deepEqual(r.lastLamps(), Array(9).fill(0));
});

test("silence, full scale and odd frames never throw", async () => {
  const r = rig();
  await listen(r);
  const odd = [
    frame({ rmsDb: -120, peakDb: -120, bands: Array(28).fill(-120) }),
    frame({ rmsDb: 0, peakDb: 0, bands: Array(28).fill(0), pitch: { hz: 800, confidence: 1 } }),
    frame({ rmsDb: NaN, peakDb: undefined, bands: [NaN, "x"], pitch: { hz: NaN, confidence: "high" } }),
    frame({ bands: null, pitch: 5 }), frame({ bands: [] }), { type: "analysis" }, null, undefined, "x", { type: "analysis", rmsDb: 3, peakDb: 99 },
    frame({ pitch: { hz: 0, confidence: 1 } }), frame({ pitch: { hz: -100, confidence: 1 } }), frame({ pitch: { hz: 1e9, confidence: 1 } }),
  ];
  for (let p = 0; p < 3; p++) {
    for (const e of odd) { r.advance(100); r.app.event(e); }
    r.act("NEXT PAGE");
  }
  for (const l of r.ctx.calls.leds) assert.ok(valid(l));
  for (const el of elements.values()) {
    assert.ok(!/NaN|Infinity|undefined/.test(el.textContent), el.id + ": " + el.textContent);
    for (const v of Object.values(el.attrs)) assert.ok(!/NaN|Infinity|undefined/.test(String(v)), el.id + ": " + v);
  }
  r.app.dispose();
});

test("no data for a while is shown and lamps go dark; frames after a stop are dropped", async () => {
  const r = rig();
  await listen(r);
  feed(r, [frame({ rmsDb: -20 })]);
  r.advance(3000);
  r.app.tick();
  assert.equal(r.app.status.code, "nodata");
  assert.ok(r.lastLamps().every((v) => v === 0));
  feed(r, [frame({ rmsDb: -20 })]);
  assert.equal(r.app.status.code, "listening");
  await r.act("STOP LISTENING");
  const before = r.ctx.calls.leds.length;
  feed(r, [frame({ rmsDb: -10 })]);
  assert.equal(r.ctx.calls.leds.length, before, "a late frame lights nothing");
  assert.equal(text("rs-db"), "— dBFS");
  r.app.dispose();
});

test("simulated signal is labelled", async () => {
  const r = rig();
  await listen(r);
  feed(r, [frame({ simulated: true })]);
  assert.match(text("rs-sim"), /SIMULATED/);
  feed(r, [frame({ simulated: false })]);
  assert.equal(text("rs-sim"), "");
  r.app.dispose();
});

test("page choice survives a save and restore; every action runs", async () => {
  const r = rig();
  r.act("NEXT PAGE");
  const saved = r.ctx.calls.saved.at(-1);
  assert.deepEqual(saved, { schema: 1, page: 1 });
  const again = rig({ progress: JSON.parse(JSON.stringify(saved)) });
  assert.match(again.ctx.calls.content.at(-1), /id="rs-b0"/);
  assert.equal(rig({ progress: { page: 99 } }).app.page, 0);
  assert.equal(rig({ progress: null }).app.page, 0);
  for (const label of ["START LISTENING", "NEXT PAGE", "CLEAR PEAK AND HISTORY", "STOP LISTENING", "RETURN TO DASHBOARD"]) await r.act(label);
  r.app.cancel(); r.app.pause(); r.app.resume(); r.app.tick();
  r.app.dispose();
  r.app.tick(); r.app.event(frame());
});

test("scopeStatus honours the host's confirmed capture", () => {
  const base = { device: { connected: true, capture: true }, mic: { mode: "analyze" } };
  assert.equal(scopeStatus(base).listening, true);
  assert.equal(scopeStatus({ ...base, device: { connected: true, capture: false } }).listening, false);
  assert.equal(scopeStatus({ ...base, device: { connected: false, capture: true } }).code, "link");
  assert.equal(scopeStatus({ device: {}, mic: {} }).code, "muted");
  assert.equal(scopeStatus(undefined).code, "muted");
});
