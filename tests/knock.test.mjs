// Knock on the case (docs/PROTOCOL.md KNOCK): the router hands it to the app only where button presses
// go, it leaves the menu gesture alone, Node Scope reads the node's counters and Calibration sets the
// sensitivity. The detector itself is tested in C (firmware/host-test/knock_test.c).
import test from "node:test";
import assert from "node:assert/strict";
import { InputRouter } from "../web/engine/input.js";
import { Diagnostics, Settings, TAP_TARGET, knockReadout, tapCheck, tapLabel } from "../web/apps/utilities.js";
import { appContext } from "./helpers/app-context.mjs";

function rig(mode = "raw") {
  let now = 0;
  const log = [];
  const host = {
    epoch: 0, mode, holdMs: () => 650, escapePolicy: () => ({ pace: "standard" }),
    inputMode() { return this.mode; },
    pressVisual() {}, clickVisual(n) { log.push(["clicks", n]); }, holdVisual() {},
    advance() { log.push(["advance"]); }, select() { log.push(["select"]); },
    rawDown: () => log.push(["down"]), rawUp: () => log.push(["up"]), rawCancel: () => log.push(["cancel"]),
    rawKnock: (e) => log.push(["knock", e.peak]),
    requestMenu(via) { log.push(["menu", via]); router.cancel(true, "node"); this.epoch++; },
  };
  const router = new InputRouter(host, () => now);
  return { host, router, log, wait(ms) { for (let i = 0; i < ms; i += 10) { now += 10; router.update(); } }, at: () => now };
}

test("a knock reaches the game, and only the game", () => {
  const h = rig("raw");
  assert.equal(h.router.knock({ peak: 9000, source: "node" }), true);
  assert.deepEqual(h.log, [["knock", 9000]]);
  const menu = rig("menu");
  assert.equal(menu.router.knock({ peak: 9000 }), false, "navigation contexts and menus ignore it");
  assert.deepEqual(menu.log, []);
});

test("a knock while a menu's release is awaited is ignored; after the release it counts again", () => {
  const h = rig("raw");
  h.router.cancel(true, "node");
  assert.equal(h.router.knock({ peak: 5000 }), false);
  h.router.up({ source: "node", generation: 1, at_us: 0 });
  assert.equal(h.router.knock({ peak: 5000 }), true);
});

test("a knock during a held press or between the gesture's taps changes nothing about the press or the gesture", () => {
  const h = rig("raw");
  const down = () => h.router.down({ source: "node", generation: 1, at_us: h.at() * 1000 });
  const up = () => h.router.up({ source: "node", generation: 1, at_us: h.at() * 1000 });
  down(); h.wait(60); up(); h.wait(80);
  h.router.knock({ peak: 7000 });
  down(); h.wait(60); up(); h.wait(80);
  down(); h.router.knock({ peak: 7000 });
  // Hold until the gesture fires, however long the in-game hold is set (up to 5 s).
  for (let ms = 0; ms < 5000 && !h.log.some((e) => e[0] === "menu"); ms += 10) h.wait(10);
  assert.equal(h.log.filter((e) => e[0] === "knock").length, 2);
  assert.equal(h.log.filter((e) => e[0] === "menu").length, 1, "tap, tap, hold still opens the menu");
});

test("Node Scope: knock setting, the node's counters, the last knock, and old firmware", () => {
  const r = knockReadout("medium", { thr: 4000, n: 3, btn: 2, long: 5, bright: 1, peak: 16384, hf: 42 }, { at: 0, peak: 32767 }, 2400);
  assert.equal(r.input, "MEDIUM · THRESHOLD -18.3 dBFS");
  assert.equal(r.counts, "3 SENT · 2 AT BUTTON · 5 TOO LONG · 1 TOO BRIGHT · LAST -6.0 dBFS HF 42");
  assert.equal(knockReadout("medium", { thr: 4000, n: 0, btn: 0, long: 0, peak: 0 }).counts, "0 SENT · 0 AT BUTTON · 0 TOO LONG · LAST —", "first 0.1.3 build without bright/hf");
  assert.equal(r.last, "FULL SCALE · 2 S AGO", "a clipped knock says so");
  assert.equal(knockReadout("off", { thr: 0, n: 0 }).input, "OFF · NODE NOT LISTENING");
  assert.equal(knockReadout("high", undefined).input, "HIGH · NOT IN THIS FIRMWARE");
  assert.equal(knockReadout(undefined, undefined, null).last, "NONE YET");

  const ctx = appContext({ settings: { knock: "high", lampLevel: "medium" }, state: { simulated: false, device: { connected: true } } });
  const app = new Diagnostics(ctx);
  app.event({ type: "node_status", link: "usb", fw: "vesper-node-0.1.3", sensor: {}, knock: { thr: 2000, n: 1, btn: 0, long: 0, peak: 12000 } });
  assert.match(ctx.calls.content.at(-1), /<span>KNOCK INPUT<\/span><b>HIGH · THRESHOLD -24\.3 dBFS<\/b>/);
  assert.match(ctx.calls.content.at(-1), /<span>LAST KNOCK<\/span><b>NONE YET<\/b>/);
  app.event({ type: "knock", peak: 12000, source: "node" });
  assert.match(ctx.calls.content.at(-1), /<span>LAST KNOCK<\/span><b>-8\.7 dBFS · 0 S AGO ◆<\/b>/);
  app.event({ type: "node_status", link: "usb", fw: "vesper-node-0.1.2", sensor: {} });
  assert.match(ctx.calls.content.at(-1), /NOT IN THIS FIRMWARE/);
});

test("Calibration cycles knock sensitivity off, low, medium, high", () => {
  for (const [from, to] of [["off", "low"], ["low", "medium"], ["medium", "high"], ["high", "off"], [undefined, "high"]]) {
    const ctx = appContext({ settings: { gesturePace: "standard", lampLevel: "medium", knock: from } });
    new Settings(ctx);
    const action = ctx.currentActions.find((a) => a.id === "knock");
    assert.equal(action.label, "KNOCK SENSITIVITY / " + (from || "medium").toUpperCase());
    action.run();
    assert.deepEqual(ctx.calls.command.at(-1), ["settings", { key: "knock", value: to }]);
  }
});

test("tap direction: label each side on its lamp, save, then show where taps land", () => {
  const ctx = appContext({ settings: { gesturePace: "standard", lampLevel: "medium" },
    state: { tapDirection: { calibrated: false, label: null, pending: { left: 0, right: 0, top: 0 }, saved: {} } } });
  const app = new Settings(ctx);
  const act = (id) => ctx.currentActions.find((a) => a.id === id);
  assert.equal(act("tap-direction").label, "TAP DIRECTION / NOT CALIBRATED");
  act("tap-direction").run();
  assert.match(ctx.calls.content.at(-1), /NOT CALIBRATED/);
  act("tap-start").run();
  assert.deepEqual(ctx.calls.command.at(-1), ["tap_direction", { op: "start", side: "left" }]);
  assert.deepEqual(ctx.calls.leds.at(-1).slice(0, 3), [70, 70, 70], "the left lamp shows where to tap");
  const status = (label, pending) => app.event({ type: "tap_direction", calibrated: false, label, pending, saved: {} });
  status("left", { left: 3, right: 0, top: 0 });
  assert.match(ctx.calls.content.at(-1), /TAP THE LEFT SIDE OF THE CASE/);
  assert.match(ctx.calls.content.at(-1), new RegExp(`3 / ${TAP_TARGET}`));
  status("left", { left: TAP_TARGET, right: 0, top: 0 });
  assert.deepEqual(ctx.calls.command.at(-1), ["tap_direction", { op: "label", side: "right" }]);
  assert.deepEqual(ctx.calls.leds.at(-1).slice(6), [70, 70, 70]);
  act("tap-skip").run();
  assert.deepEqual(ctx.calls.command.at(-1), ["tap_direction", { op: "label", side: "top" }]);
  status("top", { left: TAP_TARGET, right: 4, top: TAP_TARGET });
  assert.deepEqual(ctx.calls.command.at(-1), ["tap_direction", { op: "save" }]);
  const check = { left: { right: 10, wrong: 0, unsure: 0, total: 10 }, top: { right: 8, wrong: 1, unsure: 1, total: 10 } };
  app.event({ type: "tap_direction", calibrated: true, label: null, pending: { left: 0, right: 0, top: 0 }, saved: { left: 10, top: 10 }, check });
  assert.match(ctx.calls.content.at(-1), /CALIBRATED · 10 LEFT · 10 TOP/);
  assert.match(ctx.calls.content.at(-1), /18 \/ 20 PLACED · LEFT 10\/10 · TOP 8\/10/);
  app.event({ type: "knock", peak: 9000, tap: { level_db: 0 }, side: "top", sideVotes: 4 });
  assert.match(ctx.calls.content.at(-1), /LAST TAP · TOP · 4 OF 5 AGREE/);
  app.dispose();
});

test("tap direction readouts", () => {
  assert.equal(tapLabel(null), "NO TAP YET");
  assert.equal(tapLabel({ peak: 1 }), "NO SIDE · THIS NODE SENDS NO TWO-MICROPHONE CLIP");
  assert.equal(tapLabel({ tap: {} }), "NO SIDE · NOT CALIBRATED");
  assert.equal(tapLabel({ tap: {}, sideVotes: 2 }), "UNSURE · NEIGHBOURS DISAGREE");
  assert.equal(tapCheck(null), "");
});
