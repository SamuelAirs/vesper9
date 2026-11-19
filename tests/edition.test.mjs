// The handheld edition (web/apps/edition.js, set by ios/layer/15-edition.js): with no edition the
// console reads and behaves exactly as before; a handheld hides what only the Pi can do, says the
// phone's words, and judges a case plate at the moment it is touched.
import test from "node:test";
import assert from "node:assert/strict";
import { edition, handheld, shown, words, dashboardPages } from "../web/apps/edition.js";
import { SECTORS, SYSTEM_APPS, CARTRIDGES } from "../web/apps/catalog.js";
import { APPS } from "../web/apps/registry.js";
import { Twinbeat, HIT_WINDOW } from "../web/apps/twinbeat.js";
import { LightTrial } from "../web/apps/reaction.js";
import { Settings, Timers } from "../web/apps/utilities.js";
import { appContext, fakeCanvas } from "./helpers/app-context.mjs";

const HIDDEN = ["transcribe", "resonance", "environment", "diagnostics", "telemetry", "encyclopedia"];
const HANDHELD = { name: "handheld", hide: HIDDEN, add: [], microphone: false };
// Run one test's body with the page given an edition, and take it away after.
function as(given, body) {
  globalThis.VESPER_EDITION = given;
  try { return body(); } finally { delete globalThis.VESPER_EDITION; }
}
// The dashboard as main.js built it before there was an edition.
const before = () => SECTORS.map((sector) => ({ name: sector.name, tagline: sector.tagline || "", apps: sector.apps.map((id) => APPS.find((a) => a.id === id)).filter(Boolean) }))
  .filter((page) => page.apps.length);

test("with no edition the console is the console", () => {
  assert.equal(globalThis.VESPER_EDITION, undefined);
  assert.equal(edition().name, "console");
  assert.equal(handheld(), false);
  assert.equal(edition().microphone, true);
  assert.ok(CARTRIDGES.every((a) => shown(a.id)));
  assert.equal(words("CONSOLE", "PHONE"), "CONSOLE");
  assert.deepEqual(dashboardPages(SECTORS, APPS), before());
  // The registry keeps every app's own words.
  for (const meta of CARTRIDGES) for (const key of ["subtitle", "description", "controls"]) assert.equal(APPS.find((a) => a.id === meta.id)[key], meta[key]);
  // Anything that is not an object is no edition.
  for (const odd of [null, "handheld", 3, true]) as(odd, () => assert.equal(edition().name, "console"));
});

test("a handheld hides the six apps everywhere and drops a sector left empty", () => as(HANDHELD, () => {
  assert.equal(handheld(), true);
  assert.equal(edition().microphone, false);
  assert.equal(words("CONSOLE", "PHONE"), "PHONE");
  const pages = dashboardPages(SECTORS, APPS), on = pages.flatMap((p) => p.apps.map((a) => a.id));
  for (const id of HIDDEN) { assert.equal(shown(id), false); assert.ok(!on.includes(id), id + " is on the dashboard"); }
  assert.ok(pages.every((p) => p.apps.length > 0));
  assert.ok(!pages.some((p) => p.name === "LISTEN"), "LISTEN holds only hidden apps");
  assert.deepEqual(pages.find((p) => p.name === "TOOLS").apps.map((a) => a.id), ["lantern", "cadence", "oracle", "morse", "library"]);
  // Everything else is where it was, in its order.
  const was = before().map((p) => ({ name: p.name, apps: p.apps.map((a) => a.id).filter((id) => !HIDDEN.includes(id)) })).filter((p) => p.apps.length);
  assert.deepEqual(pages.map((p) => ({ name: p.name, apps: p.apps.map((a) => a.id) })), was);
  assert.deepEqual(SYSTEM_APPS.filter(shown), ["settings"]);
}));

test("an edition can put an app on a sector's page, or on a new one, once", () => {
  const given = { ...HANDHELD, add: [{ sector: "VOYAGES", apps: ["tideline", "orbit", "nothing", "telemetry"] }, { sector: "sky", apps: ["ephemeris", "tideline"], tagline: "Up there." }] };
  as(given, () => {
    const pages = dashboardPages(SECTORS, APPS), ids = (name) => pages.find((p) => p.name === name)?.apps.map((a) => a.id);
    assert.deepEqual(ids("VOYAGES"), [...SECTORS.find((s) => s.name === "VOYAGES").apps, "tideline"], "added after the sector's own; orbit stays in ARCADE; unknown and hidden ids are ignored");
    assert.ok(ids("ARCADE").includes("orbit"));
    assert.deepEqual(ids("SKY"), ["ephemeris"]);
    assert.equal(pages.at(-1).name, "SKY");
    assert.equal(pages.at(-1).tagline, "Up there.");
  });
});

// Twinbeat, two-side, chart 1. Steps the song to `at` and taps the plate of the note there.
function twinbeat(settings = {}) {
  const ctx = appContext({ lampCount: 4, settings: { tapMode: "sides", holdMs: 650, ...settings } });
  const app = new Twinbeat(ctx);
  assert.equal(app.mode, "sides");
  app.start(0);
  return app;
}
function strikeAt(app, index, lateMs, source) {
  const note = app.chart.notes[index];
  for (let n = 0; app.songTime < note.at + lateMs / 1000 - 1e-8 && n < 10000; n++) app.update(Math.min(1 / 60, note.at + lateMs / 1000 - app.songTime));
  return app.strike(note.side, { side: note.side, source, at_us: 1e9 + index, generation: 1 }, "case");
}

test("Twinbeat on a handheld judges a plate at the moment it is touched", () => {
  // The console: a node knock is heard late, so the case delay (100 ms) comes off; a simulated knock gets none.
  const node = strikeAt(twinbeat(), 0, 100, "node");
  assert.equal(node.kind, "center");
  assert.ok(Math.abs(node.error) < 0.005);
  const simulated = strikeAt(twinbeat(), 0, 0, "simulator");
  assert.equal(simulated.kind, "center");
  assert.ok(Math.abs(simulated.error) < 0.005);
  as(HANDHELD, () => {
    // A plate tapped on the note is on time; one tapped 100 ms late is late, never pulled back by a case delay.
    const onTime = strikeAt(twinbeat(), 0, 0, "simulator");
    assert.equal(onTime.kind, "center");
    assert.ok(Math.abs(onTime.error) < 0.005);
    const late = strikeAt(twinbeat(), 0, 100, "simulator");
    assert.equal(late.kind, "close");
    assert.ok(Math.abs(late.error - 0.1) < 0.005, "error " + late.error);
    // The plates share the button's measured TIMING OFFSET: taps that land 40 ms late are on time.
    const offset = strikeAt(twinbeat({ latencyMs: 40 }), 0, 40, "simulator");
    assert.equal(offset.kind, "center");
    assert.ok(Math.abs(offset.error) < 0.005);
    // A note that nobody plays is missed one hit window after it, with no case delay added.
    const app = twinbeat(), note = app.chart.notes[0];
    for (let n = 0; app.songTime < note.at + HIT_WINDOW + 0.02 && n < 10000; n++) app.update(1 / 60);
    assert.equal(app.judgements[0], "miss");
  });
  // On the console the same note is still open then, waiting for a late node knock.
  const app = twinbeat(), note = app.chart.notes[0];
  for (let n = 0; app.songTime < note.at + HIT_WINDOW + 0.02 && n < 10000; n++) app.update(1 / 60);
  assert.equal(app.judgements[0], null);
});

test("Twinbeat's console screen: no case delay line on a handheld, the phone's words", () => {
  const home = () => { const app = twinbeat(); app.go("home"); return app; };
  const labels = (app) => app.rows().map((r) => r.label);
  assert.ok(labels(home()).some((l) => l.startsWith("CASE DELAY ESTIMATE · 100 MS")));
  const ctx = appContext({ lampCount: 4, settings: { tapMode: "generic" } });
  as(HANDHELD, () => {
    const app = home();
    assert.ok(!labels(app).some((l) => l.includes("CASE DELAY")));
    assert.ok(labels(app).includes("FIELD MANUAL"));
    app.start(0);
    assert.equal(app.c.calls.controls.at(-1), "LEFT / RIGHT CASE PLATE");
    const assist = new Twinbeat(ctx);
    assert.equal(assist.mode, "assist");
    assert.equal(assist.rows().find((r) => r.label.startsWith("INPUT MODE")).sub, "TWO-SIDE: CALIBRATION > CASE PLATES > LEFT / RIGHT");
    assist.cycleMode();
    assert.equal(assist.message, "Set CASE PLATES to LEFT / RIGHT in Calibration. Assist works now.");
    assist.start(0);
    assert.equal(ctx.calls.controls.at(-1), "EITHER CASE PLATE / BUTTON · RHYTHM ASSIST");
    // Every page of the manual draws.
    for (const page of [0, 1]) { assist.go("guide"); assist.guidePage = page; assist.draw(fakeCanvas()); }
  });
  const console = twinbeat();
  assert.equal(console.c.calls.controls.at(-1), "LEFT / RIGHT CASE TAP · J / L ON KEYBOARD");
});

// What a draw() paints, as text.
function painted(app) {
  const out = [];
  const g = new Proxy({}, { get: (t, k) => (k === "fillText" ? (s) => out.push(String(s)) : k === "measureText" ? () => ({ width: 100 }) : k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  app.draw(g);
  return out;
}
function lightTrial(ms) {
  const ctx = appContext({ lampCount: 4 }), g = new LightTrial(ctx);
  g.down({});
  g.event({ type: "cue", trial: g.trial, at_us: 1e6, generation: 0 });
  g.down({ source: "simulator", at_us: 1e6 + ms * 1000, generation: 0 });
  for (let i = 0; i < 30; i++) g.update(1 / 60); // past the gesture window, so the score is sent
  return { g, ctx };
}

test("Light Trial on a handheld: a touch time, said to be one, never kept as the node's", () => {
  const console = lightTrial(250);
  assert.equal(console.g.metric, "simulator");
  assert.deepEqual(console.ctx.calls.hud.at(-1).find(([k]) => k === "CLOCK"), ["CLOCK", "SIMULATOR"]);
  assert.ok(!painted(console.g).some((s) => /TOUCH/.test(s)));
  as(HANDHELD, () => {
    const { g, ctx } = lightTrial(250);
    assert.equal(g.metric, "simulator", "kept apart from the node's clock (physical)");
    assert.deepEqual(ctx.calls.score.at(-1), [750, "simulator"]);
    assert.deepEqual(ctx.calls.hud.at(-1).find(([k]) => k === "CLOCK"), ["CLOCK", "TOUCH"]);
    assert.ok(painted(g).includes("TOUCH TIME / DISPLAY AND TOUCH DELAY INCLUDED"));
    // A node series brought over from the console is labelled as the node's.
    const brought = new LightTrial(appContext({ progress: { bs: { physical: 231 } } }));
    assert.ok(painted(brought).some((s) => s.includes("BEST SERIES 231 ms (NODE)")));
  });
  const brought = new LightTrial(appContext({ progress: { bs: { physical: 231 } } }));
  assert.ok(painted(brought).some((s) => /BEST SERIES 231 ms$/.test(s)));
});

test("Calibration on a handheld: one CASE PLATES row instead of knock sensitivity and tap direction, no voice pages", () => {
  const ids = (ctx) => ctx.currentActions.map((a) => a.id);
  const consoleCtx = appContext({ settings: { gesturePace: "standard", lampLevel: "medium", knock: "medium" } });
  new Settings(consoleCtx);
  for (const id of ["knock", "tap-direction", "voice-help"]) assert.ok(ids(consoleCtx).includes(id), id);
  assert.ok(!ids(consoleCtx).includes("case-plates"));
  assert.match(consoleCtx.calls.content.at(-1), /computer/);
  as(HANDHELD, () => {
    for (const [settings, label, command] of [
      [{ knock: "medium", tapMode: "generic" }, "CASE PLATES / GENERIC", { key: "tapMode", value: "sides" }],
      [{ knock: "medium", tapMode: "sides" }, "CASE PLATES / LEFT / RIGHT", { key: "tapMode", value: "generic" }],
      [{ knock: "off", tapMode: "generic" }, "CASE PLATES / OFF", { key: "knock", value: "medium" }],
    ]) {
      const ctx = appContext({ settings: { gesturePace: "standard", lampLevel: "medium", ...settings } });
      new Settings(ctx);
      for (const id of ["knock", "tap-direction", "voice-help"]) assert.ok(!ids(ctx).includes(id), id);
      // What does work on a phone stays: the drawn lamps follow the lamp level and the glow.
      for (const id of ["sound", "volume", "crt", "reduced-motion", "morse-wpm", "select-hold", "lamp-level", "lamp-ambient", "gesture-pace", "timing", "render", "scan-speed", "reset-settings", "home"])
        assert.ok(ids(ctx).includes(id), id);
      const row = ctx.currentActions.find((a) => a.id === "case-plates");
      assert.equal(row.label, label);
      row.run();
      assert.deepEqual(ctx.calls.command.at(-1), ["settings", command]);
      assert.doesNotMatch(ctx.calls.content.at(-1), /computer|microphone/);
    }
  });
});

test("Chronometer's line: the Pi's clock on the console, the phone's own on a handheld", () => {
  const hint = () => { const ctx = appContext(); new Timers(ctx); return ctx.calls.hint.at(-1); };
  assert.match(hint(), /Timers follow the Pi clock across restarts\.$/);
  as(HANDHELD, () => assert.match(hint(), /Timers keep time while VESPER is closed\.$/));
});
