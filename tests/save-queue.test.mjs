import test from "node:test";
import assert from "node:assert/strict";
import { SaveQueue, SAVE_QUEUE_ENTRIES, SAVE_QUEUE_BYTES } from "../web/engine/save-queue.js";

const tick = () => new Promise(resolve => setImmediate(resolve));
function rig(options = {}) {
  const sent = [], changes = [], errors = [];
  const queue = new SaveQueue({ ...options,
    send: (command, values) => new Promise((resolve, reject) => sent.push({ command, values, resolve, reject })),
    onChange: status => changes.push(status), onError: error => errors.push(error) });
  return { queue, sent, changes, errors };
}
const save = (queue, app, value) => queue.enqueue("progress", { app, value });

test("offline acceptance is RAM only and reconnect drains acknowledged saves serially", async () => {
  const { queue, sent } = rig();
  assert.deepEqual(await save(queue, "echo", { runs: 1 }), { queued: true });
  await queue.enqueue("score", { app: "echo", score: 500 });
  await tick(); assert.equal(sent.length, 0); assert.equal(queue.status().pending, 2);
  queue.setReady(true); await tick(); assert.equal(sent.length, 1);
  assert.equal(queue.status().pending, 2); assert.equal(queue.status().sending, true);
  sent[0].resolve(); await tick(); assert.equal(sent.length, 2); assert.equal(queue.status().pending, 1);
  sent[1].resolve(); await tick();
  assert.deepEqual(queue.status(), { pending: 0, bytes: 0, ready: true, sending: false, error: null });
});

test("progress coalesces by slot and scores retain max independently per metric", async () => {
  const { queue, sent } = rig();
  await save(queue, "echo", { runs: 1 }); await save(queue, "echo", { runs: 2 });
  await save(queue, "echo#2", { runs: 5 });
  await queue.enqueue("score", { app: "reaction", metric: "physical", score: 200 });
  await queue.enqueue("score", { app: "reaction", metric: "physical", score: 100 });
  await queue.enqueue("score", { app: "reaction", metric: "keyboard", score: 900 });
  assert.equal(queue.status().pending, 4);
  assert.deepEqual(queue.overlay({}).progress, { echo: { runs: 2 }, "echo#2": { runs: 5 } });
  assert.deepEqual(queue.overlay({}).scores, { "reaction:physical": 200, "reaction:keyboard": 900 });
  queue.setReady(true); await tick(); assert.deepEqual(sent[0].values, { app: "echo", value: { runs: 2 } });
});

test("newer progress written during send survives the old ACK", async () => {
  const { queue, sent } = rig(); queue.setReady(true);
  await save(queue, "runner", { milestone: 1 }); await tick();
  await save(queue, "runner", { milestone: 2 });
  sent[0].resolve(); await tick();
  assert.equal(queue.status().pending, 1); assert.equal(sent.length, 2);
  assert.deepEqual(sent[1].values.value, { milestone: 2 });
  sent[1].resolve(); await tick(); assert.equal(queue.status().pending, 0);
});

test("new higher score survives an old ACK while lower scores do not cause extra sends", async () => {
  const { queue, sent } = rig(); queue.setReady(true);
  await queue.enqueue("score", { app: "ricochet", score: 100 }); await tick();
  await queue.enqueue("score", { app: "ricochet", score: 50 });
  await queue.enqueue("score", { app: "ricochet", score: 400 });
  sent[0].resolve(); await tick(); assert.equal(sent.length, 2); assert.equal(sent[1].values.score, 400);
  sent[1].resolve(); await tick(); assert.equal(queue.status().pending, 0);
});

test("lost ACK can be retried after disconnect and stale old-generation ACK cannot clear it", async () => {
  const { queue, sent } = rig(); queue.setReady(true);
  await save(queue, "runner", { runs: 1 }); await tick();
  queue.setReady(false); await save(queue, "runner", { runs: 2 }); queue.setReady(true); await tick();
  assert.equal(sent.length, 2); assert.deepEqual(sent[1].values.value, { runs: 2 });
  sent[0].resolve(); await tick(); assert.equal(queue.status().pending, 1); assert.equal(queue.status().sending, true);
  sent[1].resolve(); await tick(); assert.equal(queue.status().pending, 0);
});

test("stale rejection after reconnect does not taint current save status", async () => {
  const { queue, sent, errors } = rig(); queue.setReady(true);
  await save(queue, "echo", { runs: 1 }); await tick();
  queue.setReady(false); queue.setReady(true); await tick();
  sent[0].reject(new Error("Old socket closed")); await tick();
  assert.equal(queue.status().error, null); assert.equal(errors.length, 0);
  sent[1].resolve(); await tick(); assert.equal(queue.status().pending, 0);
});

test("server rejection remains visible, drains other keys, and retries once per explicit flush", async () => {
  const { queue, sent, errors } = rig();
  await save(queue, "echo", { runs: 1 }); await save(queue, "runner", { runs: 1 });
  queue.setReady(true); await tick(); sent[0].reject(new Error("Invalid app progress")); await tick();
  assert.equal(sent.length, 2); assert.match(queue.status().error, /Invalid app progress/);
  sent[1].resolve(); await tick();
  await save(queue, "echo", { runs: 1 }); await tick();
  assert.equal(sent.length, 2); assert.match(queue.status().error, /Invalid app progress/);
  queue.setReady(true); await save(queue, "glyphs", { runs: 1 }); await tick();
  assert.equal(sent.length, 3); assert.equal(sent[2].values.app, "glyphs");
  sent[2].resolve(); await tick(); assert.match(queue.status().error, /Invalid app progress/);
  queue.flush(); await tick(); assert.equal(sent.length, 4);
  sent[3].reject(new Error("Invalid app progress")); await tick();
  assert.equal(sent.length, 4); assert.equal(errors.length, 2); assert.equal(queue.status().pending, 1);
});

test("a corrected newer revision is attempted after the preceding revision rejects", async () => {
  const { queue, sent } = rig(); queue.setReady(true);
  await save(queue, "echo", { bad: true }); await tick(); await save(queue, "echo", { runs: 2 });
  sent[0].reject(new Error("Rejected old payload")); await tick();
  assert.equal(queue.status().error, null); assert.equal(sent.length, 2);
  assert.deepEqual(sent[1].values.value, { runs: 2 }); sent[1].resolve(); await tick();
});

test("payloads, send callbacks, status callbacks, and overlays cannot mutate queued snapshots", async () => {
  const input = { nested: { runs: 3 } }, { queue, sent, changes } = rig();
  await save(queue, "echo", input); input.nested.runs = 90;
  const inbound = { progress: { runner: { runs: 4 } }, scores: { echo: 500 } };
  const view = queue.overlay(inbound); view.progress.echo.nested.runs = 70; changes[0].pending = 50;
  assert.equal(queue.overlay({}).progress.echo.nested.runs, 3); assert.equal(queue.status().pending, 1);
  assert.deepEqual(inbound.progress, { runner: { runs: 4 } });
  queue.setReady(true); await tick(); sent[0].values.value.nested.runs = 80;
  assert.equal(queue.overlay({}).progress.echo.nested.runs, 3);
});

test("overlay preserves inbound unrelated data and maximum acknowledged score", async () => {
  const { queue } = rig(); await save(queue, "runner#3", { runs: 2 });
  await queue.enqueue("score", { app: "echo", score: 200 });
  const state = { controller: false, progress: { runner: { runs: 8 }, "runner#3": { runs: 1 } }, scores: { echo: 500, runner: 900 } };
  assert.deepEqual(queue.overlay(state), { controller: false,
    progress: { runner: { runs: 8 }, "runner#3": { runs: 2 } }, scores: { echo: 500, runner: 900 } });
});

test("entry limit rejects new keys but permits same-key coalescing without deleting older saves", async () => {
  const { queue, sent, errors } = rig({ maxEntries: 1 });
  await save(queue, "echo", { runs: 1 }); await assert.rejects(save(queue, "runner", { runs: 2 }), /full/);
  assert.equal(queue.status().pending, 1); assert.match(queue.status().error, /not queued/); assert.equal(errors.length, 1);
  await save(queue, "echo", { runs: 3 }); assert.match(queue.status().error, /not queued/);
  queue.setReady(true); await tick(); sent[0].resolve(); await tick();
  assert.equal(queue.status().pending, 0); assert.match(queue.status().error, /not queued/);
  await save(queue, "runner", { runs: 2 }); assert.equal(queue.status().error, null);
});

test("byte limit counts UTF-8 and rejects oversized replacements atomically", async () => {
  const payload = { app: "echo", value: { label: "é" } };
  const bytes = new TextEncoder().encode(JSON.stringify(payload)).length;
  const { queue } = rig({ maxBytes: bytes });
  await queue.enqueue("progress", payload); assert.equal(queue.status().bytes, bytes);
  await assert.rejects(save(queue, "echo", { label: "éé" }), /full/);
  assert.deepEqual(queue.overlay({}).progress.echo, { label: "é" }); assert.equal(queue.status().bytes, bytes);
  await save(queue, "echo", { label: "a" }); assert.equal(queue.status().error, null); assert.equal(queue.status().bytes, bytes - 1);
});

test("unsupported commands and invalid JSON save values are rejected and reported", async () => {
  for (const [command, values] of [
    ["tone", { app: "echo", frequency: 440 }], ["progress", { app: "echo", value: [] }],
    ["progress", { app: "echo", value: { n: NaN } }], ["progress", { app: "echo", value: { n: 1n } }],
    ["progress", { app: "echo", value: new Date(0) }],
    ["score", { app: "echo", score: Infinity }], ["score", { app: "echo", score: true }],
    ["score", { app: "echo", score: 5, metric: 1n }], ["score", { app: "", score: 5 }],
  ]) {
    const { queue, sent, errors } = rig(); queue.setReady(true);
    await assert.rejects(queue.enqueue(command, values)); await tick();
    assert.equal(queue.status().pending, 0); assert.equal(sent.length, 0);
    assert.equal(errors.length, 1); assert.equal(typeof queue.status().error, "string");
  }
});

test("corrected locally invalid saves clear their own warning", async () => {
  const { queue } = rig();
  await assert.rejects(queue.enqueue("score", { app: "echo", score: NaN }));
  await queue.enqueue("score", { app: "echo", score: 500 }); assert.equal(queue.status().error, null);
  await assert.rejects(save(queue, "runner", []));
  await save(queue, "runner", { runs: 1 }); assert.equal(queue.status().error, null);
});

test("default limits hold all 35 app slots and scores with a hard bound", async () => {
  assert.equal(SAVE_QUEUE_ENTRIES, 256); assert.equal(SAVE_QUEUE_BYTES, 256 * 1024);
  const { queue } = rig();
  for (let app = 0; app < 35; app++) {
    for (let slot = 1; slot <= 4; slot++) await save(queue, `app${app}${slot === 1 ? "" : "#" + slot}`, { runs: slot });
    await queue.enqueue("score", { app: `app${app}`, score: 100 });
  }
  assert.equal(queue.status().pending, 175); assert.ok(queue.status().bytes < SAVE_QUEUE_BYTES);
});

test("readiness withdrawn before deferred send prevents the hardware-independent save command", async () => {
  const { queue, sent } = rig(); await save(queue, "echo", { runs: 1 });
  queue.setReady(true); queue.setReady(false); await tick();
  assert.equal(sent.length, 0); assert.equal(queue.status().pending, 1);
  queue.setReady(true); await tick(); assert.equal(sent.length, 1);
});

test("explicit discard clears offline saves, byte accounting, and refused-payload warnings", async () => {
  const { queue, changes } = rig({ maxEntries: 1 });
  await save(queue, "echo", { runs: 7 });
  await assert.rejects(save(queue, "runner", { runs: 2 }), /full/);
  assert.ok(queue.status().bytes > 0); assert.ok(queue.status().error);
  queue.discard();
  assert.deepEqual(queue.status(), { pending: 0, bytes: 0, ready: false, sending: false, error: null });
  assert.deepEqual(changes.at(-1), queue.status());
  assert.deepEqual(queue.overlay({ progress: { echo: { runs: 77 } } }).progress, { echo: { runs: 77 } });
});

test("discard invalidates in-flight ACKs and rejections without affecting later saves", async () => {
  for (const oldReply of ["resolve", "reject"]) {
    const { queue, sent, errors } = rig(); queue.setReady(true);
    await save(queue, "echo", { runs: 7 }); await tick();
    queue.discard();
    assert.deepEqual(queue.status(), { pending: 0, bytes: 0, ready: true, sending: false, error: null });
    await save(queue, "echo", { runs: 78 }); await tick();
    assert.equal(sent.length, 2);
    sent[0][oldReply](new Error("Reply from discarded revision")); await tick();
    assert.equal(queue.status().pending, 1); assert.equal(queue.status().sending, true);
    assert.equal(queue.status().error, null); assert.equal(errors.length, 0);
    assert.deepEqual(queue.overlay({}).progress.echo, { runs: 78 });
    sent[1].resolve(); await tick(); assert.equal(queue.status().pending, 0);
  }
});

test("discard clears rejected records and prevents deferred sends, then accepts a fresh save", async () => {
  const { queue, sent } = rig(); queue.setReady(true);
  await save(queue, "echo", { runs: 7 }); await tick();
  sent[0].reject(new Error("Invalid app progress")); await tick();
  assert.ok(queue.status().error); queue.discard(); assert.equal(queue.status().error, null);
  const accepted = save(queue, "echo", { runs: 8 }); queue.discard(); await accepted; await tick();
  assert.equal(sent.length, 1); assert.equal(queue.status().bytes, 0);
  await save(queue, "echo", { runs: 78 }); await tick();
  assert.deepEqual(sent[1].values.value, { runs: 78 });
  sent[1].resolve(); await tick(); assert.equal(queue.status().pending, 0);
});

test("baseline conflicts distinguish unchanged service, another writer, and a lost ACK", async () => {
  const { queue, sent } = rig();
  await queue.enqueue("progress", { app: "echo", value: { runs: 7 } }, { baseline: { runs: 6 } });
  assert.deepEqual(queue.conflicts({ progress: { echo: { runs: 6 } } }), []);
  assert.deepEqual(queue.conflicts({ progress: { echo: { runs: 77 } } }), ["echo"]);
  assert.deepEqual(queue.conflicts({ progress: { echo: { runs: 7 } } }), []);
  // A direct controller reconnect needs the same pre-overlay conflict check;
  // observing an intervening monitor connection is not necessary.
  const inbound = { controller: true, progress: { echo: { runs: 77 } } };
  assert.deepEqual(queue.conflicts(inbound), ["echo"]);
  assert.equal(queue.status().ready, false); await tick(); assert.equal(sent.length, 0);
  assert.equal(inbound.progress.echo.runs, 77);
});

test("coalescing preserves the first baseline, compares key order structurally, and isolates snapshots", async () => {
  const { queue } = rig(), baseline = { runs: 1, nested: { a: 2, b: [3, 4] } };
  await queue.enqueue("progress", { app: "runner#2", value: { runs: 2 } }, { baseline });
  baseline.runs = 90; baseline.nested.b[0] = 50;
  await queue.enqueue("progress", { app: "runner#2", value: { runs: 3 } }, { baseline: { runs: 2 } });
  assert.deepEqual(queue.conflicts({ progress: { "runner#2": { nested: { b: [3, 4], a: 2 }, runs: 1 } } }), []);
  assert.deepEqual(queue.conflicts({ progress: { "runner#2": { runs: 2 } } }), ["runner#2"]);
  assert.deepEqual(queue.conflicts({ progress: { "runner#2": { runs: 3 } } }), []);
});

test("missing service progress is an empty baseline and baseline-free saves do not conflict", async () => {
  const { queue } = rig();
  await queue.enqueue("progress", { app: "echo", value: { runs: 1 } }, { baseline: {} });
  await save(queue, "runner", { runs: 7 });
  await queue.enqueue("score", { app: "echo", score: 500 }, { baseline: { score: 1 } });
  assert.deepEqual(queue.conflicts({ progress: { runner: { runs: 77 } } }), []);
  assert.deepEqual(queue.conflicts({ progress: { echo: { runs: 90 } } }), ["echo"]);
});

test("baseline bytes share the hard queue budget and an oversized baseline is rejected atomically", async () => {
  const payload = { app: "echo", value: { runs: 7 } }, baseline = { label: "é" };
  const bytes = new TextEncoder().encode(JSON.stringify(payload) + JSON.stringify(baseline)).length;
  const { queue } = rig({ maxBytes: bytes });
  await queue.enqueue("progress", payload, { baseline }); assert.equal(queue.status().bytes, bytes);
  queue.discard();
  await assert.rejects(queue.enqueue("progress", payload, { baseline: { label: "éé" } }), /full/);
  assert.equal(queue.status().bytes, 0); assert.equal(queue.status().pending, 0);
  await assert.rejects(queue.enqueue("progress", payload, { baseline: { invalid: Infinity } }), /non-finite/);
});
