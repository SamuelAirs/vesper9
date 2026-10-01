// What each voice command asks the host to do, in every context (web/engine/voice.js), and the Calibration list.
import test from "node:test";
import assert from "node:assert/strict";
import { planVoice, answer, LAMP_LEVELS, VOICE_HELP, temperatureLamps } from "../web/engine/voice.js";
import { voicePages } from "../web/apps/utilities.js";
import { CARTRIDGES } from "../web/apps/catalog.js";

const NOW = Date.UTC(2026, 9, 1, 12, 30);
const ctx = (over = {}) => ({
  scene: "dashboard", items: 8, controller: true, faulted: false, timers: [], settings: { lampLevel: "medium", sound: true, volume: 0.5, tempUnit: "C" },
  sensor: { temperature: 22.4, humidity: 45, at: NOW / 1000 - 3 }, connected: true, mic: { mode: "commands" }, now: NOW, lampsFree: true, ...over,
});
const plan = (action, over = {}, extra = {}) => planVoice({ type: "voice", heard: "computer " + action, action, ...extra }, ctx(over));
const timer = (over = {}) => ({ id: "t1", label: "FIELD TIMER", duration: 300, remaining: 120, running: true, finished: false, ...over });

test("navigation works on the dashboard, in instruments and in menus", () => {
  for (const scene of ["dashboard", "instrument", "menu"]) {
    assert.equal(plan("next", { scene }).run, "next", scene);
    assert.equal(plan("previous", { scene }).run, "previous", scene);
    assert.equal(plan("select", { scene }).run, "select", scene);
  }
  assert.equal(plan("next").report, "focus");
  assert.equal(plan("select").report, "chosen");
});

test("navigation inside a game says so and does nothing", () => {
  for (const action of ["next", "previous", "select"]) {
    const result = plan(action, { scene: "game" });
    assert.equal(result.run, null, action);
    assert.match(result.say, /NOT IN A GAME/);
  }
  assert.equal(plan("next", { items: 0 }).run, null);
});

test("next sector is a dashboard command; home, menu and resume say when they do not apply", () => {
  assert.equal(plan("sector").run, "sector");
  for (const scene of ["instrument", "game", "menu"]) assert.match(plan("sector", { scene }).say, /DASHBOARD ONLY/);
  assert.equal(plan("home", { scene: "game" }).run, "home");
  assert.match(plan("home").say, /ALREADY ON THE DASHBOARD/);
  assert.equal(plan("pause", { scene: "game" }).run, "menu");
  assert.match(plan("pause", { scene: "menu" }).say, /ALREADY OPEN/);
  assert.equal(plan("resume", { scene: "menu" }).run, "resume");
  assert.match(plan("resume", { scene: "game" }).say, /NOTHING TO RESUME/);
  assert.match(plan("resume", { scene: "menu", faulted: true }).say, /RESTART/);
});

test("opening an app works from anywhere", () => {
  for (const scene of ["dashboard", "instrument", "game", "menu"]) assert.deepEqual(
    (({ run, app }) => ({ run, app }))(plan("launch", { scene }, { app: "orbit" })), { run: "launch", app: "orbit" });
});

test("the last timer can be cancelled, paused and resumed, with reasons when it cannot", () => {
  const one = timer(), paused = timer({ running: false }), done = timer({ finished: true, running: false, remaining: 0 });
  assert.match(plan("timer_cancel").say, /NO TIMERS/);
  assert.deepEqual((({ run, op, id }) => ({ run, op, id }))(plan("timer_cancel", { timers: [timer({ id: "a" }), one] })), { run: "timer", op: "remove", id: "t1" });
  assert.equal(plan("timer_pause", { timers: [one] }).op, "toggle");
  assert.match(plan("timer_pause", { timers: [paused] }).say, /ALREADY PAUSED/);
  assert.equal(plan("timer_resume", { timers: [paused] }).op, "toggle");
  assert.match(plan("timer_resume", { timers: [one] }).say, /ALREADY RUNNING/);
  assert.match(plan("timer_resume", { timers: [done] }).say, /COMPLETE/);
  assert.equal(plan("timer_cancel", { timers: [done] }).op, "remove");
  assert.match(plan("timer_cancel", { timers: [one], controller: false }).say, /MONITOR TAB/);
});

test("dictation: start opens Field Notes; stop explains that dictation cannot hear commands", () => {
  assert.equal(plan("dictation_start").run, "dictation");
  assert.match(plan("dictation_start", { mic: { mode: "commands", unavailable: "Install" } }).say, /NOT INSTALLED/);
  assert.match(plan("dictation_stop").say, /CANNOT HEAR COMMANDS/);
  assert.equal(plan("dictation_stop", { mic: { mode: "transcribe" } }).run, "commands");
});

test("lamp level steps up and down, clamps with a message, and switches off and on", () => {
  const levels = (to, lampLevel) => plan("lamps", { settings: { lampLevel } }, { to });
  assert.deepEqual(LAMP_LEVELS, ["off", "low", "medium", "full"]);
  assert.equal(levels("up", "medium").value, "full");
  assert.equal(levels("down", "medium").value, "low");
  assert.equal(levels("down", "low").value, "off");
  assert.equal(levels("off", "full").value, "off");
  assert.equal(levels("on", "off").value, "medium");
  assert.match(levels("up", "full").say, /ALREADY AT FULL/);
  assert.match(levels("down", "off").say, /ALREADY OFF/);
  assert.match(levels("on", "low").say, /ALREADY ON/);
  assert.match(levels("off", "off").say, /ALREADY OFF/);
  assert.equal(levels("up", undefined).value, "full", "an unset level counts as medium");
  assert.equal(levels("up", "medium").key, "lampLevel");
});

test("sound and volume use the host's settings command with valid values", () => {
  assert.deepEqual((({ key, value }) => ({ key, value }))(plan("sound", {}, { to: "off" })), { key: "sound", value: false });
  assert.match(plan("sound", {}, { to: "on" }).say, /ALREADY ON/);
  assert.equal(plan("sound", { settings: { sound: false } }, { to: "on" }).value, true);
  assert.equal(plan("volume", {}, { to: "up" }).value, 0.75);
  assert.equal(plan("volume", {}, { to: "down" }).value, 0.25);
  assert.match(plan("volume", { settings: { volume: 1 } }, { to: "up" }).say, /MAXIMUM/);
  assert.match(plan("volume", { settings: { volume: 0 } }, { to: "down" }).say, /MINIMUM/);
  assert.match(plan("sound", { controller: false }, { to: "off" }).say, /MONITOR TAB/);
});

test("questions are answered on screen and, when the host owns the lamps, on the lamps", () => {
  const time = plan("ask", {}, { about: "time" });
  assert.match(time.say, /^TIME \/ \d\d:\d\d · /);
  assert.equal(time.lamps, null);
  const t = plan("ask", {}, { about: "temperature" });
  assert.equal(t.say, "TEMPERATURE / 22.4 °C");
  assert.equal(t.lamps.length, 9);
  assert.equal(plan("ask", { settings: { tempUnit: "F" } }, { about: "temperature" }).say, "TEMPERATURE / 72.3 °F", "in the owner's unit");
  assert.equal(plan("ask", {}, { about: "humidity" }).say, "HUMIDITY / 45 % RH / COMFORTABLE");
  assert.equal(plan("ask", { lampsFree: false }, { about: "temperature" }).lamps, null, "an app that holds the lamps keeps them");
  assert.match(plan("ask", { sensor: null }, { about: "temperature" }).say, /NO SENSOR READING/);
  assert.match(plan("ask", { connected: false }, { about: "temperature" }).say, /STALE/);
  assert.equal(plan("ask", { connected: false }, { about: "humidity" }).lamps, null, "no lamp colour for a stale reading");
});

test("the timers question lists the running timers", () => {
  assert.equal(plan("ask", {}, { about: "timers" }).say, "NO TIMERS");
  const result = plan("ask", { timers: [timer({ remaining: 250 }), timer({ id: "b", running: false, remaining: 60 })] }, { about: "timers" });
  assert.equal(result.say, "2 TIMERS / 04:10 · 01:00 PAUSED");
  assert.equal(result.lamps.length, 9);
  assert.equal(answer("timers", ctx({ timers: [timer({ finished: true, running: false })] })).lamps, null);
});

test("temperature lamp colours follow cold, comfortable, warm and hot", () => {
  const colour = (c) => temperatureLamps(c).slice(0, 3).join();
  assert.equal(new Set([10, 20, 28, 35].map(colour)).size, 4);
});

test("the service's own results (timer started, microphone off) are shown, not repeated as actions", () => {
  assert.deepEqual(planVoice({ action: "timer", seconds: 60, heard: "x", result: "TIMER STARTED / 01:00" }, ctx()), { run: null, say: "TIMER STARTED / 01:00" });
  assert.equal(planVoice({ action: "mute", heard: "x", result: "MICROPHONE OFF" }, ctx()).run, null);
  assert.equal(planVoice({ action: "nonsense", heard: "x" }, ctx()).run, null);
});

test("Calibration lists every voice command and every app's voice name", () => {
  const pages = voicePages();
  assert.equal(pages.length, VOICE_HELP.length);
  const text = pages.map((p) => p.title + p.body).join(" ");
  for (const app of CARTRIDGES) assert.ok(text.includes(app.voice[0] + " = " + app.name), app.id);
  for (const word of ["next sector", "cancel timer", "start dictation", "lamps up", "sound off", "what time is it", "show timers", "microphone off"])
    assert.ok(text.includes(word), word);
  assert.ok(pages.every((p) => p.body.length < 4000));
});
