// Field Notes at 1024 x 600 without a mouse: the newest lines stay in a fixed view while dictating,
// saved notes are read a whole page at a time, provisional and refined text look different, and
// a recording indicator says whether the microphone is on. (The two-pass behaviour itself is in
// transcription.test.mjs.)
import test from "node:test";
import assert from "node:assert/strict";
import { Transcription, wrapText, noteRows, notePageCount, NOTE_ROWS, NOTE_COLS } from "../web/apps/utilities.js";
import { appContext } from "./helpers/app-context.mjs";
import { Hand } from "./helpers/pad.mjs";

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
const words = (n, start = 0) => Array.from({ length: n }, (_, i) => "word" + (start + i)).join(" ");

function notes({ saved = [], mic = { mode: "transcribe", session: "s1", recognizer: { engine: "vosk+parakeet", refine: "ready", detail: null } }, capture = true, settings, sessions } = {}) {
  const store = { saved: saved.slice() };
  const list = sessions || [{ id: "s1", started: 1700000000, lines: saved.length, ended: mic.mode !== "transcribe" ? 1700000100 : null }];
  const ctx = appContext({
    settings,
    state: { mic, device: { connected: true, capture } },
    get: (path) => (path.startsWith("sessions") ? list : path.startsWith("transcript/") ? (path.endsWith("/s1") ? store.saved : []).map((text) => ({ text })) : []),
  });
  const app = new Transcription(ctx);
  return { ctx, app, store };
}
const html = (ctx) => ctx.calls.content.at(-1);
const unescape = (text) => text.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const viewRows = (ctx) => [...html(ctx).matchAll(/<div class="fn-row fn-(\w+)"><span class="fn-gutter">([^<]*)<\/span>([^<]*)/g)].map((m) => ({ kind: m[1], gutter: unescape(m[2]), text: unescape(m[3]) }));
// The host updates its state before it tells the app about a microphone change.
const micEvent = (ctx, app, mic) => { ctx.state().mic = { ...ctx.state().mic, ...mic }; app.event({ type: "mic", ...mic }); };
const ids = (ctx) => ctx.currentActions.map((a) => a.id);
const run = (ctx, id) => ctx.currentActions.find((a) => a.id === id).run();

test("wrapping: exact columns, long words are cut, empty text still takes a row", () => {
  const rows = wrapText(words(40), NOTE_COLS);
  assert.ok(rows.every((r) => r.length <= NOTE_COLS) && rows.length >= 4);
  assert.equal(rows.join(" "), words(40), "no word lost or split");
  assert.deepEqual(wrapText("x".repeat(130), 58).map((r) => r.length), [58, 58, 14]);
  assert.deepEqual(wrapText("", 58), [""]); assert.deepEqual(wrapText(null, 58), [""]);
  assert.deepEqual(wrapText("  spaced   out  ", 58), ["spaced out"]);
  const lines = noteRows([{ text: words(30), kind: "saved" }, { text: "short", kind: "saved" }]);
  assert.equal(lines.filter((r) => r.first).length, 2, "one gutter mark per line");
  assert.equal(notePageCount(0), 1); assert.equal(notePageCount(5), 1); assert.equal(notePageCount(6), 2); assert.equal(notePageCount(26), 6);
});

test("dictating: a fixed view always ends with the newest line and never grows", async () => {
  const saved = [];
  const { ctx, app, store } = notes({ saved }); await settle();
  assert.match(html(ctx), /LISTENING/);
  for (let i = 0; i < 40; i++) {
    store.saved.push("line " + i + " " + words(i % 9));
    app.event({ type: "speech", text: store.saved.at(-1), final: true, session: "s1", engine: "vosk" });
    await settle();
    const rows = viewRows(ctx);
    assert.ok(rows.length <= NOTE_ROWS, `view has ${rows.length} rows`);
    assert.ok(rows.at(-1).text.length > 0);
    assert.ok(rows.map((r) => r.text).join(" ").includes("line " + i), `the newest line ${i} is in view without scrolling`);
    assert.ok(html(ctx).includes("fn-follow"));
  }
  assert.equal(viewRows(ctx).length, NOTE_ROWS, "a full view once there is enough text");
  assert.ok(!viewRows(ctx).map((r) => r.text).join(" ").includes("line 5 "), "older lines have scrolled off the top");
  assert.match(html(ctx), /style="height:6\.5em"/, "fixed height: five rows of 1.3 em");
});

test("dictating: a long utterance shows its end, the live partial has a caret and its own style", async () => {
  const { ctx, app } = notes({ saved: ["an earlier line"] }); await settle();
  const long = words(60);
  app.event({ type: "speech", text: long, final: false, session: "s1" });
  const rows = viewRows(ctx);
  assert.equal(rows.length, NOTE_ROWS);
  assert.ok(rows.at(-1).text.endsWith("word59"), "the end of the partial is in view");
  assert.ok(rows.every((r) => r.kind === "live"));
  assert.equal((html(ctx).match(/fn-caret/g) || []).length, 1, "one caret, on the last row");
  assert.ok(html(ctx).lastIndexOf("fn-caret") > html(ctx).lastIndexOf("fn-row"));
  // provisional (Vosk's finished line) is its own kind, between the saved lines and the partial
  app.event({ type: "speech", text: "vosk final words", final: false, provisional: true, utt: 3, session: "s1" });
  app.event({ type: "speech", text: "next one", final: false, session: "s1" });
  const kinds = viewRows(ctx);
  assert.deepEqual(kinds.slice(-2).map((r) => r.kind), ["prov", "live"]);
  assert.deepEqual(kinds.slice(-2).map((r) => r.gutter), ["~", ">"]);
  assert.equal(kinds.slice(-2)[0].text, "vosk final words");
});

test("saved, provisional and live text are told apart by more than colour", async () => {
  const css = ["fn-saved", "fn-prov", "fn-live"];
  const { ctx, app } = notes({ saved: ["saved line"] }); await settle();
  app.event({ type: "speech", text: "prov", final: false, provisional: true, utt: 1, session: "s1" });
  app.event({ type: "speech", text: "live", final: false, session: "s1" });
  const rows = viewRows(ctx);
  assert.equal(new Set(rows.map((r) => r.gutter)).size, 3);
  assert.deepEqual(new Set(rows.map((r) => "fn-" + r.kind)), new Set(css));
});

test("the recording indicator: REC while capturing, WAIT while the microphone starts, IDLE when off", () => {
  const rec = notes();
  assert.match(html(rec.ctx), /fn-rec fn-rec-on"><i><\/i>REC/);
  assert.match(html(rec.ctx), /TRANSCRIBING/);
  const wait = notes({ capture: false });
  assert.match(html(wait.ctx), /fn-rec fn-rec-wait"><i><\/i>WAIT/);
  assert.match(html(wait.ctx), /MIC WAITING/);
  const off = notes({ mic: { mode: "off" }, capture: false });
  assert.match(html(off.ctx), /fn-rec fn-rec-off"><i><\/i>IDLE/);
  const still = notes({ settings: { reducedMotion: true } });
  assert.match(html(still.ctx), /fn-rec-on fn-still/, "no pulsing with reduced motion");
  assert.match(html(rec.ctx), /RECOGNISER \/ VOSK LIVE \+ PARAKEET FINAL/, "the recogniser line is kept");
  const err = notes({ mic: { mode: "off", error: "Microphone <failed>" }, capture: false });
  assert.match(html(err.ctx), /Microphone &lt;failed&gt;/);
});

test("while dictating the first action stops it, and the list is short", async () => {
  const { ctx } = notes({ saved: ["one", "two"] }); await settle();
  assert.equal(ctx.currentActions[0].label, "STOP TRANSCRIPTION");
  assert.ok(ctx.currentActions.length <= 5, ids(ctx).join());
  assert.ok(ids(ctx).includes("notes") && ids(ctx).includes("home"));
  const off = notes({ mic: { mode: "off" }, capture: false, saved: ["one"] }); await settle();
  assert.ok(off.ctx.currentActions.some((a) => a.label === "START TRANSCRIPTION"));
});

test("reading: whole pages, a page indicator, nothing split, nothing lost, nothing scrolls", async () => {
  const saved = Array.from({ length: 26 }, (_, i) => "note line " + i + " " + words(i % 12));
  const { ctx, app } = notes({ saved, mic: { mode: "off" }, capture: false }); await settle();
  const all = noteRows(saved.map((text) => ({ text, kind: "saved" })));
  const pages = notePageCount(all.length);
  assert.ok(pages >= 6);
  const seen = [];
  for (let p = 0; p < pages; p++) {
    assert.match(html(ctx), new RegExp(`PAGE ${p + 1} / ${pages}`));
    const rows = viewRows(ctx);
    assert.ok(rows.length <= NOTE_ROWS && rows.length > 0);
    if (p < pages - 1) assert.equal(rows.length, NOTE_ROWS, "every page but the last is full");
    seen.push(...rows.map((r) => r.text));
    assert.ok(!html(ctx).includes("fn-follow"), "reading is not the following view");
    if (p < pages - 1) { run(ctx, "next-text"); }
  }
  assert.deepEqual(seen, all.map((r) => r.text), "the pages together are the note, row for row");
  assert.equal(app.linePage, pages - 1);
  run(ctx, "next-text");
  assert.equal(app.linePage, 0, "forward from the last page wraps to the first");
  run(ctx, "prev-text");
  assert.equal(app.linePage, pages - 1, "back from the first page wraps to the last");
});

test("reading a long note takes one hold per page, from a note that was just opened", async () => {
  const saved = Array.from({ length: 26 }, (_, i) => "line " + i);
  const { ctx, app } = notes({ saved, mic: { mode: "off" }, capture: false }); await settle();
  let t = 0;
  const hand = new Hand(ctx, app, { now: () => t, set: (v) => { t = v; } });
  assert.equal(hand.label, "NEXT TEXT PAGE", "the first action is the next page");
  for (let p = 1; p < 6; p++) hand.hold();
  assert.equal(hand.presses, 5);
  assert.match(html(ctx), /PAGE 6 \/ 6/);
  assert.equal(hand.label, "NEXT TEXT PAGE", "the highlight never left it");
});

test("paging back from the live view and returning to it", async () => {
  const saved = Array.from({ length: 30 }, (_, i) => "saved " + i);
  const { ctx, app } = notes({ saved }); await settle();
  assert.ok(html(ctx).includes("fn-follow"));
  assert.deepEqual(ids(ctx), ["capture", "prev-text", "notes", "home"]);
  run(ctx, "prev-text");
  assert.ok(!html(ctx).includes("fn-follow"), "reading back");
  assert.ok(ids(ctx).includes("next-text") && ids(ctx).includes("export"));
  const earlier = viewRows(ctx).map((r) => r.text).join(" ");
  assert.ok(!earlier.includes("saved 29"));
  // new text arriving does not drag the reader away from the page
  app.event({ type: "speech", text: "fresh words", final: false, session: "s1" });
  assert.equal(viewRows(ctx).map((r) => r.text).join(" "), earlier);
  // forward to the last page, then past it: back to following the newest lines
  for (let i = 0; i < 20 && !html(ctx).includes("fn-follow"); i++) run(ctx, "next-text");
  assert.ok(html(ctx).includes("fn-follow"), "past the last page it follows again");
  assert.ok(viewRows(ctx).map((r) => r.text).join(" ").includes("fresh words"));
});

test("stopping opens the note on its last page; a new session follows live again", async () => {
  const saved = Array.from({ length: 20 }, (_, i) => "spoken " + i);
  const { ctx, app } = notes({ saved }); await settle();
  micEvent(ctx, app, { mode: "off", session: undefined }); await settle();
  assert.ok(!html(ctx).includes("fn-follow"));
  const pages = notePageCount(noteRows(saved.map((text) => ({ text, kind: "saved" }))).length);
  assert.match(html(ctx), new RegExp(`PAGE ${pages} / ${pages}`));
  assert.ok(viewRows(ctx).map((r) => r.text).join(" ").includes("spoken 19"), "what was just said is on screen");
  micEvent(ctx, app, { mode: "transcribe", session: "s2" }); await settle();
  assert.ok(html(ctx).includes("fn-follow"), "the new session is followed");
  assert.match(html(ctx), /LISTENING/);
  assert.equal(app.reading, false);
});

test("the note list is its own short screen: choose a note, page through it, export it", async () => {
  const sessions = Array.from({ length: 8 }, (_, i) => ({ id: "n" + i, started: 1700000000 + i * 1000, lines: 3 + i, ended: 1 }));
  const downloads = [];
  const ctx = appContext({
    state: { mic: { mode: "off" }, device: { connected: true } },
    get: (path) => (path.startsWith("sessions") ? sessions.slice(Number(path.split("=")[1]) || 0) : path.startsWith("transcript/") ? Array.from({ length: 14 }, (_, i) => ({ text: path.slice(11) + " row " + i })) : []),
  });
  ctx.download = (url) => downloads.push(url);
  const app = new Transcription(ctx); await settle();
  assert.ok(!ids(ctx).some((i) => i.startsWith("note-")), "the note screen does not carry the list");
  run(ctx, "notes"); await settle();
  assert.deepEqual(ids(ctx).slice(0, 5), ["n0", "n1", "n2", "n3", "n4"].map((i) => "note-" + i));
  assert.ok(ids(ctx).includes("older") && ids(ctx).includes("back"));
  assert.ok(ctx.currentActions.length <= 8);
  run(ctx, "older"); await settle();
  assert.equal(app.offset, 5);
  assert.ok(ids(ctx).includes("newer"));
  run(ctx, "note-n6"); await settle();
  assert.equal(app.selected, "n6"); assert.equal(app.screen, "text"); assert.equal(app.linePage, 0);
  assert.match(html(ctx), /n6 row 0/); assert.match(html(ctx), /PAGE 1 \/ 3/);
  run(ctx, "export");
  assert.deepEqual(downloads, ["/api/export/n6"]);
  run(ctx, "notes"); run(ctx, "back");
  assert.equal(app.screen, "text");
});

test("lines are escaped and the page never shows NaN or undefined", async () => {
  const { ctx, app } = notes({ saved: ["<b>bold</b> & \"quotes\" <script>alert(1)</script>"] }); await settle();
  assert.doesNotMatch(html(ctx), /<script>|<b>bold/);
  assert.match(html(ctx), /&lt;b&gt;bold/);
  for (const e of [{ type: "speech", text: undefined, final: false }, { type: "speech", text: null, final: true }, { type: "mic" }, { type: "recognizer" }, { type: "speech_error" }])
    assert.doesNotThrow(() => app.event(e));
  assert.ok(ctx.calls.content.every((h) => !/NaN|undefined/.test(h)));
});

test("a very long session is cheap to redraw", async () => {
  const saved = Array.from({ length: 20000 }, (_, i) => "line " + i + " " + words(8));
  const { ctx, app } = notes({ saved }); await settle();
  const t0 = performance.now();
  for (let i = 0; i < 200; i++) app.event({ type: "speech", text: "partial " + i, final: false, session: "s1" });
  const ms = performance.now() - t0;
  assert.ok(ms < 400, `200 partial updates on 20000 lines took ${ms.toFixed(0)} ms`);
  assert.match(html(ctx), /partial 199/);
});
