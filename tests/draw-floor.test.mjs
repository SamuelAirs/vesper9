// The text floor in web/engine/draw.js: with none set (the console, the simulator) every size
// passes through text() exactly as asked; with one set nothing is drawn under it.
import test from "node:test";
import assert from "node:assert/strict";
import { text, textSize, textFloor, textRows, setTextFloor, banner, ambient } from "../web/engine/draw.js";

// A canvas context that remembers each fillText with the font, alignment and colour it had.
function recorder() {
  const calls = [];
  const g = {
    font: "10px sans-serif", textAlign: "start", textBaseline: "alphabetic", fillStyle: "#000",
    strokeStyle: "#000", lineWidth: 1, globalAlpha: 1,
    fillText(value, x, y) { calls.push({ value, x, y, font: this.font, align: this.textAlign, base: this.textBaseline, color: this.fillStyle }); },
    fillRect() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, arc() {}, stroke() {}, fill() {},
    closePath() {}, rect() {}, save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
  };
  return { g, calls };
}
const SIZES = [1, 6, 8, 9, 9.5, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 22, 24, 28, 32, 42, 64, 120];
const font = (px) => `${px}px "DejaVu Sans Mono",monospace`;

test("no floor: every size is drawn as asked, and textSize() returns it", () => {
  setTextFloor(0);
  assert.equal(textFloor(), 0);
  const { g, calls } = recorder();
  for (const size of SIZES) text(g, "A" + size, 10, 20, size, "#123456", "center");
  text(g, "default", 1, 2);
  assert.deepEqual(calls.map((c) => c.font), [...SIZES.map(font), font(22)]);
  for (const c of calls.slice(0, -1)) assert.deepEqual([c.x, c.y, c.align, c.base, c.color], [10, 20, "center", "middle", "#123456"]);
  for (const size of SIZES) assert.equal(textSize(size), size);
  assert.equal(textSize(), 22);
});

test("the console's own drawings are unchanged with no floor (banner, the dashboard's orrery)", () => {
  setTextFloor(0);
  const a = recorder();
  banner(a.g, "ORBIT LOCK", "Press when the dot crosses the ring / Hold to aim", "#fff");
  ambient(a.g, 3, 450, 300);
  assert.deepEqual(a.calls.map((c) => c.font), [font(42), font(22), font(22), font(20), font(10), font(9)]);
});

test("a floor raises only what is under it, and clearing it restores every size", () => {
  setTextFloor(18.5);
  assert.equal(textFloor(), 18.5);
  const { g, calls } = recorder();
  for (const size of SIZES) text(g, "x", 0, 0, size);
  assert.deepEqual(calls.map((c) => c.font), SIZES.map((s) => font(Math.max(s, 18.5))));
  assert.equal(textSize(10), 18.5);
  assert.equal(textSize(30), 30);
  setTextFloor(0);
  const after = recorder();
  for (const size of SIZES) text(after.g, "x", 0, 0, size);
  assert.deepEqual(after.calls.map((c) => c.font), SIZES.map(font));
});

test("a floor that is not a positive number is no floor", () => {
  for (const bad of [-3, NaN, Infinity, undefined, null, "", 0]) {
    setTextFloor(bad);
    assert.equal(textFloor(), 0, String(bad));
    assert.equal(textSize(7), 7);
  }
});

test("textRows: one row, the line itself, whenever no floor is set", () => {
  setTextFloor(0);
  for (const line of ["", "short", "A line far wider than any width the game gives it, which the console draws as it always has."])
    assert.deepEqual(textRows(line, 100, 14), [line]);
});

test("textRows under a floor: even rows that fit, at most max, the rest cut", () => {
  setTextFloor(22);
  const line = "HOLD to stop the turning arrow. Keep holding: the power rises, then falls.";
  const rows = textRows(line, 600, 18);
  const per = Math.floor(600 / (22 * 0.61));
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.length <= per), JSON.stringify(rows));
  assert.equal(rows.join(" "), line);
  assert.ok(Math.abs(rows[0].length - rows[1].length) < 12, "rows are about even: " + JSON.stringify(rows));
  const cut = textRows(line, 200, 18, 2);
  assert.equal(cut.length, 2);
  assert.ok(cut[1].endsWith("…"));
  assert.deepEqual(textRows("fits", 600, 18), ["fits"]);
  setTextFloor(0);
});
