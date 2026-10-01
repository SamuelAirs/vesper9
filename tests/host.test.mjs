// Regression tests for the browser host and engine defects found by the host audit
// (fleet/reports/audit-host.md). Host-level behaviour that needs a DOM lives in host-browser.cjs.
import test from "node:test";
import assert from "node:assert/strict";
import { InputRouter, GESTURE_PACES, RAW_STUCK_MS } from "../web/engine/input.js";
import { LightDirector, normalizeLeds } from "../web/engine/lights.js";

globalThis.localStorage = { getItem: () => null, setItem() {} };
const { DemoBridge } = await import("../web/engine/demo.js");

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
  return { router, host, events, advance: (ms) => { now += ms; router.update(); }, now: () => now };
}
const count = (events, name) => events.filter((e) => Array.isArray(e) && e[0] === name).length;
const tick = () => new Promise((r) => setImmediate(r));

// F1 ---------------------------------------------------------------------------------------
test("F1 a lost node release is recovered when node_status reports the button up", () => {
  const h = harness();
  h.router.down({ source: "node", generation: 1, at_us: 1000 });
  h.advance(5000); // the release frame is lost
  h.router.reconcile(false, "node");
  assert.equal(h.router.press, null);
  assert.ok(h.events.includes("cancel"), "the game is told to drop its held input");
  h.router.down({ source: "node", generation: 1, at_us: 6000000 });
  assert.equal(count(h.events, "down"), 2, "second press must reach the game once the node reports the button is up");
});

test("F1 a status of 'up' right after a press does not cancel it, and 'down' keeps a long hold alive", () => {
  const h = harness();
  h.router.down({ source: "node", generation: 1, at_us: 1000 });
  h.advance(100);
  h.router.reconcile(false, "node"); // may have been composed before the press
  assert.ok(h.router.press, "within the grace period the press stands");
  // A long legitimate hold (Undertow): the node keeps reporting button:true once a second.
  for (let i = 0; i < 120; i++) { h.advance(1000); h.router.reconcile(true, "node"); }
  assert.ok(h.router.press, "a two minute hold confirmed by the node is never cut off");
  assert.ok(!h.events.includes("cancel"));
  h.router.up({ source: "node", generation: 1, at_us: 130e6 });
  assert.equal(count(h.events, "up"), 1);
  assert.ok(h.events.find((e) => Array.isArray(e) && e[0] === "up")[1].durationMs > 100000);
});

test("F1 node status never cancels a press that came from another source", () => {
  const h = harness();
  h.router.down({ source: "keyboard", generation: 0 });
  h.advance(2000);
  h.router.reconcile(false, "node");
  assert.ok(h.router.press, "a keyboard press in hardware mode is not the node's to cancel");
});

test("F1 a press held across a node reset still waits for its release", () => {
  const h = harness();
  h.router.cancel(true, "node"); // what main.js does on node_reset with the button down
  h.router.reconcile(true, "node");
  h.router.down({ source: "node", generation: 2 });
  assert.equal(count(h.events, "down"), 0, "blocked while still held");
  h.router.reconcile(false, "node");
  h.router.down({ source: "node", generation: 2 });
  assert.equal(count(h.events, "down"), 1);
});

test("F1 raw safety net: a press nothing confirms for 30 s is cancelled, and the 3 s timer is not used", () => {
  const h = harness();
  h.router.down({ source: "simulator", generation: 1, at_us: 1000 });
  h.advance(RAW_STUCK_MS - 1000);
  assert.ok(h.router.press, "a 29 s hold is legitimate");
  h.advance(2000);
  assert.equal(h.router.press, null);
  assert.ok(h.events.includes("cancel"));
  assert.ok(!h.events.includes("menu"));
  h.router.down({ source: "simulator", generation: 1, at_us: 40e6 });
  assert.equal(count(h.events, "down"), 2);
});

test("F1 menu-mode behaviour is unchanged: a 3 s hold opens the menu, short press advances", () => {
  const h = harness("menu");
  h.router.down({ source: "node", generation: 1, at_us: 1000 });
  h.advance(100);
  h.router.up({ source: "node", generation: 1, at_us: 101000 });
  assert.deepEqual(h.events, ["advance"]);
  h.router.down({ source: "node", generation: 1, at_us: 500000 });
  h.advance(3100);
  assert.ok(h.events.includes("menu"));
});

// F2 ---------------------------------------------------------------------------------------
test("F2 release goes out at once even when a light command never gets its reply", async () => {
  const sent = [];
  const l = new LightDirector((name) => {
    sent.push(name);
    if (name === "leds" && sent.length === 1) return new Promise(() => {}); // reply never arrives
    return Promise.resolve();
  }, () => 1000);
  l.set(Array(9).fill(90));
  l.flush();
  await tick();
  l.release();
  await tick();
  assert.deepEqual(sent, ["leds", "cancel", "leds"], "cancel and the zero write are not queued behind the hung command");
});

test("F2 effects are not queued behind a hung command either", async () => {
  const sent = [];
  const l = new LightDirector((name) => { sent.push(name); return name === "leds" ? new Promise(() => {}) : Promise.resolve({ ok: true }); }, () => 1000);
  l.flush();
  await tick();
  assert.deepEqual(await l.effect("pattern", { steps: [] }), { ok: true });
  assert.deepEqual(sent, ["leds", "pattern"]);
});

test("F2 a hung ordinary write times out so later writes are not blocked for 20 s", async () => {
  let now = 0, calls = 0;
  const l = new LightDirector(() => { calls++; return new Promise(() => {}); }, () => now, 20);
  l.set(Array(9).fill(5));
  now = 100; const first = l.flush();
  await tick();
  now = 200; await l.flush(); assert.equal(calls, 1, "still waiting on the first reply");
  await first;
  l.set(Array(9).fill(6));
  now = 300; l.flush(); await tick();
  assert.equal(calls, 2, "after the short timeout the director writes again");
});

test("F2 a new owner may write while the previous owner's command is still unanswered", async () => {
  let now = 0; const sent = [];
  const l = new LightDirector((name, data) => { sent.push(name); return name === "leds" && sent.length === 1 ? new Promise(() => {}) : Promise.resolve(); }, () => now);
  l.set(Array(9).fill(5)); now = 100; l.flush(); await tick();
  l.invalidate(); l.set(Array(9).fill(7)); now = 200; l.flush(); await tick();
  assert.deepEqual(sent, ["leds", "leds"]);
});

// F3 ---------------------------------------------------------------------------------------
test("F3 a rejected payload is not retried until the desired values change", async () => {
  let now = 0, calls = 0;
  const l = new LightDirector(async () => { calls++; throw new Error("Nine integer light values from 0 to 255 required"); }, () => now);
  l.set(Array(9).fill(7));
  for (let i = 0; i < 100; i++) { now += 61; await l.flush(); }
  assert.equal(calls, 1);
  l.set(Array(9).fill(8));
  now += 61; await l.flush();
  assert.equal(calls, 2, "new values are tried");
  l.invalidate(); // new owner or reconnect
  now += 61; await l.flush();
  assert.equal(calls, 3);
});

test("F3 link trouble is retried, a rejection is not", async () => {
  let now = 0, calls = 0;
  const l = new LightDirector(async () => { calls++; throw new Error("Console service is reconnecting"); }, () => now);
  l.set(Array(9).fill(7));
  for (let i = 0; i < 5; i++) { now += 61; await l.flush(); }
  assert.equal(calls, 5);
});

test("F3 ctx.leds values are rounded and clamped; malformed arrays are ignored", () => {
  assert.deepEqual(normalizeLeds([0.5, 1.4, 254.6, 300, -20, 255, 0, 12, 99.99]), [1, 1, 255, 255, 0, 255, 0, 12, 100]);
  for (const bad of [null, undefined, "x", [1, 2, 3], Array(10).fill(0), [NaN, 0, 0, 0, 0, 0, 0, 0, 0], ["1", 0, 0, 0, 0, 0, 0, 0, 0], [Infinity, 0, 0, 0, 0, 0, 0, 0, 0]])
    assert.equal(normalizeLeds(bad), null, JSON.stringify(bad));
  const l = new LightDirector(async () => {}, () => 0);
  l.set(Array(9).fill(9));
  l.set([1, 2, 3]);
  assert.deepEqual(l.desired, Array(9).fill(9), "malformed input leaves the desired lamps alone");
  l.set([0.5, 400, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(l.desired, [1, 255, 0, 0, 0, 0, 0, 0, 0]);
});

// F4 ---------------------------------------------------------------------------------------
test("F4 demo leds payloads are validated like the service", async () => {
  const d = new DemoBridge();
  for (const values of [[0.5, 0, 0, 0, 0, 0, 0, 0, 0], [300, 0, 0, 0, 0, 0, 0, 0, 0], [-1, 0, 0, 0, 0, 0, 0, 0, 0], [1, 2, 3], undefined])
    await assert.rejects(d.command("leds", { values }), /Nine integer/, JSON.stringify(values));
  await d.command("leds", { values: Array(9).fill(255) });
});

test("F4 demo leds cancels a running pattern", async () => {
  const d = new DemoBridge();
  const seen = [];
  d.addEventListener("event", (e) => e.detail.type === "leds" && seen.push(e.detail.values[0]));
  await d.command("pattern", { steps: [{ ms: 30, values: Array(9).fill(11) }, { ms: 30, values: Array(9).fill(22) }] });
  await d.command("leds", { values: Array(9).fill(99) });
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(seen.at(-1), 99, "pattern kept running over the explicit leds write: " + seen);
});

test("F4 demo pattern still plays all its steps and ends dark", async () => {
  const d = new DemoBridge();
  const seen = [];
  d.addEventListener("event", (e) => e.detail.type === "leds" && seen.push(e.detail.values[0]));
  await d.command("pattern", { repeat: 2, steps: [{ ms: 20, values: Array(9).fill(11) }, { ms: 20, values: Array(9).fill(22) }] });
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(seen, [11, 22, 11, 22, 0]);
});

test("F4 demo timer commands on an unknown id or action are rejected", async () => {
  const d = new DemoBridge();
  await assert.rejects(d.command("timer", { op: "toggle", id: "nope" }), /Timer not found/);
  await d.command("timer", { op: "create", seconds: 60 });
  await assert.rejects(d.command("timer", { op: "explode", id: d.state.timers[0].id }), /Unknown timer action/);
});

test("F4 demo validates pattern and reaction arguments like the service", async () => {
  const d = new DemoBridge();
  const ok = { ms: 100, values: Array(9).fill(1) };
  await assert.rejects(d.command("pattern", { steps: [] }), /Pattern must contain/);
  await assert.rejects(d.command("pattern", { steps: Array(17).fill(ok) }), /Pattern must contain/);
  await assert.rejects(d.command("pattern", { steps: [ok], repeat: 9 }), /Pattern must contain/);
  await assert.rejects(d.command("pattern", { steps: [{ ms: 5, values: ok.values }] }), /Invalid pattern step/);
  await assert.rejects(d.command("pattern", { steps: [{ ms: 100, values: [1, 2] }] }), /Invalid pattern step/);
  await assert.rejects(d.command("pattern", { steps: [{ ms: 100, values: Array(9).fill(1.5) }] }), /Invalid pattern step/);
  await assert.rejects(d.command("reaction", { trial: 1, delay: 10 }), /Invalid reaction round/);
  await assert.rejects(d.command("reaction", { trial: 1, delay: 20000 }), /Invalid reaction round/);
  await assert.rejects(d.command("reaction", { trial: -1, delay: 500 }), /Invalid reaction round/);
  await d.command("reaction", { trial: 1, delay: 250 });
  d.pattern.forEach(clearTimeout); clearTimeout(d.reaction);
});

test("F4 demo rejects unknown commands and unknown focus targets", async () => {
  const d = new DemoBridge();
  await assert.rejects(d.command("bogus", {}), /Unknown command/);
  await assert.rejects(d.command("focus", { app: "nope" }), /Unknown app/);
  await d.command("focus", { app: "home" });
  await d.command("focus", { app: "reaction" });
  assert.equal(d.focus, "reaction");
});

test("F4 demo plays the amber timer-complete effect on the dashboard, but not during gameplay", async () => {
  for (const [focus, expected] of [["home", true], ["timers", true], ["environment", true], ["reaction", false]]) {
    const d = new DemoBridge();
    const events = [];
    d.addEventListener("event", (e) => events.push(e.detail));
    d.focus = focus;
    d.state.timers.push({ id: "t", label: "T", duration: 5, remaining: 5, running: true, finished: false, deadline: Date.now() / 1000 - 1 });
    d.tick();
    await new Promise((r) => setTimeout(r, 30));
    const effect = events.find((e) => e.type === "light_effect");
    assert.equal(!!effect, expected, focus);
    if (expected) {
      assert.equal(effect.durationMs, 1200);
      assert.deepEqual(events.find((e) => e.type === "leds").values, [180, 100, 0, 180, 100, 0, 180, 100, 0]);
    } else assert.ok(!events.some((e) => e.type === "leds"));
    d.pattern.forEach(clearTimeout);
  }
});

// F9 ---------------------------------------------------------------------------------------
// Steady clicking: click k goes down at k*P and is released 80 ms (or the pace's limit) later.
// The menu opens on the fourth click only if the whole run fits the pace's total window.
function steadyClicks(pace, period, jitter = 0, n = 40) {
  let now = 0, opened = 0, seed = 7;
  const host = { epoch: 0, holdMs: () => 650, inputMode: () => "raw", escapePolicy: () => ({ clicks: 4, pace }),
    pressVisual() {}, holdVisual() {}, rawDown() {}, rawUp() {}, rawCancel() {}, advance() {}, select() {}, systemMenu() { opened++; } };
  const router = new InputRouter(host, () => now);
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const tap = Math.min(80, GESTURE_PACES[pace].tapMs - 10);
  let t = 0;
  for (let i = 0; i < n; i++) {
    now = t; router.down({ source: "node", generation: 1, at_us: t * 1000 });
    now = t + tap; router.up({ source: "node", generation: 1, at_us: (t + tap) * 1000 });
    t += period * (1 + (rnd() * 2 - 1) * jitter);
    now = t; router.update();
  }
  return { opened, tap };
}

test("F9 steady clicking opens the menu exactly when four clicks fit the preset's window", () => {
  const table = [];
  for (const pace of Object.keys(GESTURE_PACES)) {
    const p = GESTURE_PACES[pace];
    for (let period = 150; period <= 400; period += 25) {
      const { opened, tap } = steadyClicks(pace, period);
      const fits = 3 * period + tap <= p.totalMs && period - tap <= p.gapMs;
      table.push(`${pace}@${period}ms:${opened}`);
      assert.equal(opened > 0, fits, `${pace} at ${period} ms per click opened ${opened} times`);
      if (fits) assert.equal(opened, 10, "every group of four opens the menu once");
    }
  }
});

test("F9 decision recorded: the overrunning click stays dropped (restarting with it measured no easier)", () => {
  // Measured with both variants at 150-400 ms per click, three presets, 0/20/35 % jitter: the
  // restart variant opened the menu at the same tempos, so the gesture is left as designed.
  // At the standard preset the cut-off is between 250 and 275 ms per click.
  assert.ok(steadyClicks("standard", 275).opened === 0 && steadyClicks("standard", 250).opened > 0);
});
