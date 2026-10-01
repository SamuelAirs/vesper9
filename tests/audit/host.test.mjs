// Audit tests for the browser host and engine. Run: node --test tests/audit/host.test.mjs
// Each failing test demonstrates a defect; they are not part of the normal suite.
import test from "node:test";
import assert from "node:assert/strict";
import { InputRouter } from "../../web/engine/input.js";
import { LightDirector } from "../../web/engine/lights.js";
import { Bridge } from "../../web/engine/bridge.js";

function harness(mode = "raw", policy = { clicks: 4, pace: "standard" }) {
  let now = 0;
  const events = [];
  const host = {
    epoch: 0, mode,
    holdMs: () => 650,
    inputMode() { return this.mode; },
    escapePolicy: () => policy,
    pressVisual() {}, holdVisual() {},
    advance: () => events.push("advance"), select: () => events.push("select"),
    rawDown: (e) => events.push(["down", e]), rawUp: (e) => events.push(["up", e]),
    rawCancel: () => events.push("cancel"),
    systemMenu() { events.push("menu"); this.epoch++; },
  };
  const router = new InputRouter(host, () => now);
  return { router, host, events, advance: (ms) => { now += ms; router.update(); } };
}
const downs = (events) => events.filter((e) => Array.isArray(e) && e[0] === "down").length;

test("H1 a lost node release leaves a raw-mode press stuck; node_status cannot clear it", () => {
  const h = harness();
  h.router.down({ source: "node", generation: 1, at_us: 1000 });
  // The release frame is lost (CRC error). The node later reports button:false in STATUS,
  // which main.js routes to router.reconcile(false, 'node').
  h.advance(5000);
  h.router.reconcile(false, "node");
  h.router.down({ source: "node", generation: 1, at_us: 6000000 });
  assert.equal(downs(h.events), 2, "second press must reach the game once the node reports the button is up");
});

test("H2 a lost release in raw mode is never recovered by the 3 s timer in the default click profile", () => {
  const h = harness();
  h.router.down({ source: "node", generation: 1, at_us: 1000 });
  h.advance(60000);
  assert.ok(h.events.includes("menu") || h.router.press === null, "press still pending after 60 s");
});

test("H3 a hung light command blocks release(), so leaving an app cannot zero the lamps", async () => {
  const sent = [];
  const l = new LightDirector((name) => {
    sent.push(name);
    if (name === "leds" && sent.length === 1) return new Promise(() => {}); // reply never arrives
    return Promise.resolve();
  }, () => 1000);
  l.set(Array(9).fill(90));
  l.flush();
  await new Promise((r) => setImmediate(r));
  l.release();
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(sent.includes("cancel"), "release must reach the service without waiting for the hung command; sent=" + sent);
});

test("H4 a permanently rejected leds payload is retried every 60 ms forever", async () => {
  let now = 0, calls = 0;
  const l = new LightDirector(async () => { calls++; throw new Error("Nine integer light values from 0 to 255 required"); }, () => now);
  l.set([0.5, 0, 0, 0, 0, 0, 0, 0, 0]);
  for (let i = 0; i < 100; i++) { now += 61; await l.flush(); }
  assert.ok(calls <= 5, "director sent the same rejected payload " + calls + " times in ~6 s");
});

test("H5 Bridge: a quiet command whose payload has a 'command' key overrides the command name", async () => {
  const sent = [];
  globalThis.WebSocket = class { static OPEN = 1; constructor() { this.readyState = 1; } send(m) { sent.push(JSON.parse(m)); } };
  const b = new Bridge(); b.connected = true; b.ws = new WebSocket();
  await b.command("score", { command: "reset_settings" }, true);
  assert.equal(sent[0].command, "score");
});
