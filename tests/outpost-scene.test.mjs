// OUTPOST's scene (web/apps/outpost-scene.js): drawing and the visual-only animation.
// Moved here from tests/outpost.test.mjs unchanged when the game was split into modules.
import test from "node:test";
import assert from "node:assert/strict";
import { Outpost } from "../web/apps/outpost.js";
import { resetSceneCache } from "../web/apps/outpost-scene.js";
import { NP } from "../web/apps/outpost-rules.js";
import { appContext, fakeCanvas } from "./helpers/app-context.mjs";

const T0 = 1.8e12;
const realNow = Date.now;
let wall = T0;
test.beforeEach(() => { wall = T0; Date.now = () => wall; });
test.afterEach(() => { Date.now = realNow; });

const boot = (options) => {
  const ctx = appContext(options);
  const app = new Outpost(ctx);
  return { ctx, app };
};
// A started game: the first-launch card dismissed.
const begin = (options) => {
  const made = boot(options);
  if (made.app.phase_ !== "play") { made.app.down(); made.app.up({ durationMs: 50 }); }
  return made;
};

test("update stays cheap", () => {
  const { app } = begin();
  app.s.own.fill(100); app.s.rt = 1e9; app.s.sig = 1e9; app.dirty = true;
  const g = fakeCanvas();
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 600; i++) { app.update(1 / 60); app.draw(g); }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 600;
  assert.ok(ms < 2, "update + draw averaged " + ms.toFixed(3) + " ms");
});

// A canvas that records every call on itself, fails on any non-finite number, and counts the
// gradients made, so tests can hold draw() to the performance guide.
function strictCanvas() {
  const count = { calls: 0, gradients: 0, bad: [] };
  const gradient = { addColorStop() {} };
  const target = { count, canvas: { width: 960, height: 540 } };
  return new Proxy(target, {
    get(object, key) {
      if (key in object) return object[key];
      if (key === "measureText") return () => ({ width: 100 });
      if (typeof key === "string" && /^create.*Gradient$/.test(key)) return () => { count.gradients++; return gradient; };
      return (...args) => {
        count.calls++;
        count[key] = (count[key] || 0) + 1;
        if (key === "drawImage" && args[0]?.width === 960 && args[0]?.height === 540) count.whole = (count.whole || 0) + 1;
        for (const a of args) if (typeof a === "number" && !Number.isFinite(a)) count.bad.push(String(key));
      };
    },
    set(object, key, value) { object[key] = value; return true; },
  });
}
// OffscreenCanvas for node: each layer gets its own recording canvas.
class FakeOffscreen {
  constructor(w, h) { this.width = w; this.height = h; this.g = strictCanvas(); }
  getContext() { return this.g; }
}
const withOffscreen = (on) => {
  resetSceneCache();
  if (on) globalThis.OffscreenCanvas = FakeOffscreen;
  else delete globalThis.OffscreenCanvas;
};
// Late game: every machine owned, the whole sky charted, every stage prop and the aurora up.
const late = (app) => {
  for (let i = 0; i < NP; i++) app.s.own[i] = 140 - i * 9;
  app.s.maxTier = NP - 1; app.s.sig = 3e30; app.s.rt = 1e31; app.s.lt = 1e33; app.s.cn = 30; app.s.b = 2000; app.s.L = 2000;
  app.dirty = true;
};

test("a busy late frame stays within a few hundred canvas calls and makes no gradients", () => {
  withOffscreen(true);
  try {
    const { app } = begin();
    late(app);
    const g = strictCanvas();
    for (let i = 0; i < 30; i++) { app.update(1 / 60); if (i % 5 === 0) { app.down(); app.update(1 / 60); app.up({ durationMs: 60 }); } }
    app.draw(g); // the first frame paints the cached layers (on their own canvases)
    const before = { ...g.count };
    for (let i = 0; i < 60; i++) { app.update(1 / 60); app.draw(g); }
    const per = (g.count.calls - before.calls) / 60;
    assert.ok(per < 420, "late frame made " + per.toFixed(0) + " canvas calls");
    assert.equal(g.count.gradients, 0, "gradients made on the frame");
    assert.deepEqual(g.count.bad, []);
  } finally { withOffscreen(false); }
});

test("without OffscreenCanvas everything is drawn directly and gradients are still made only once", () => {
  withOffscreen(false);
  const { app } = begin();
  late(app);
  const g = strictCanvas();
  app.update(1 / 60); app.draw(g);
  const made = g.count.gradients;
  assert.ok(made > 0);
  for (let i = 0; i < 30; i++) { app.update(1 / 60); app.draw(g); }
  assert.equal(g.count.gradients, made, "a gradient was made again");
  assert.deepEqual(g.count.bad, []);
});

test("every stage, machine, panel and card draws with finite numbers", () => {
  for (const off of [true, false]) {
    withOffscreen(off);
    try {
      const { app } = begin({ seed: 7 });
      const g = strictCanvas();
      for (let n = 0; n < NP; n++) { // grow one machine at a time: each stage and each body in turn
        app.s.own[n] = 1 + n * 11; app.s.maxTier = n; app.s.cn = n * 3; app.dirty = true;
        for (let i = 0; i < 20; i++) { app.update(1 / 60); app.draw(g); }
      }
      app.panel = { page: 0 }; app.draw(g); app.panel = { page: 1 }; app.draw(g); app.panel = { page: 2 }; app.draw(g); app.panel = null;
      app.flare = { x: 400, y: 200, t: 2, life: 4 }; app.draw(g); app.flare = null;
      for (const ph of ["intro", "news", "away", "card"]) { app.phase_ = ph; app.draw(g); }
      app.phase_ = "play";
      assert.deepEqual(g.count.bad, [], "non-finite canvas arguments (offscreen " + off + ")");
    } finally { withOffscreen(false); }
  }
});

test("draw() leaves the seeded sequence alone", () => {
  // two identical games stepped identically; one is drawn every frame, the other never
  const a = begin({ seed: 11 }), b = begin({ seed: 11 });
  late(a.app); late(b.app);
  const g = strictCanvas();
  for (let i = 0; i < 300; i++) {
    a.app.update(1 / 60); b.app.update(1 / 60);
    if (i % 7 === 0) { for (const m of [a, b]) { m.app.down(); m.app.update(1 / 60); m.app.up({ durationMs: 60 }); } }
    a.app.draw(g);
  }
  assert.equal(a.ctx.rng.next(), b.ctx.rng.next());
});

test("a new stage reached in play cross-fades in over the old one", () => {
  withOffscreen(true);
  try {
    const { app } = begin();
    const g = strictCanvas();
    const layers = () => g.count.whole || 0; // whole-screen layers drawn
    app.update(1 / 60); app.draw(g);
    let n = layers(); app.draw(g);
    assert.equal(layers() - n, 1, "one backdrop a frame");
    app.s.own[0] = 5; app.dirty = true; // stage 0 -> 1
    app.update(1 / 60); app.draw(g);
    n = layers(); app.draw(g);
    assert.equal(layers() - n, 2, "the old stage under the new one while it fades in");
    for (let i = 0; i < 120; i++) app.update(1 / 60);
    app.draw(g); n = layers(); app.draw(g);
    assert.equal(layers() - n, 1, "the old stage is gone once the fade is over");
  } finally { withOffscreen(false); }
});

test("a humming machine shows the note it is tuned to beside its count", () => {
  const { app } = begin();
  app.s.own[0] = 12; app.dirty = true; app.update(1 / 60);
  const said = [];
  const g = new Proxy(fakeCanvas(), { get(o, k) { return k === "fillText" ? (v) => said.push(String(v)) : o[k]; }, set(o, k, v) { o[k] = v; return true; } });
  app.draw(g);
  assert.ok(said.includes("x12"));
  app.hum[0] = 20; said.length = 0; app.draw(g);
  assert.ok(said.includes("x12 C"), said.join("|"));
});

// fillText arguments, for the tests that read what a screen says
const sayer = () => {
  const said = [];
  const g = new Proxy(fakeCanvas(), { get(o, k) { return k === "fillText" ? (v) => said.push(String(v)) : o[k]; }, set(o, k, v) { o[k] = v; return true; } });
  return { g, said };
};

test("every site's terrain draws with finite numbers, and the footer names the site", async () => {
  const { SITES } = await import("../web/apps/outpost-rules.js");
  for (const off of [true, false]) {
    withOffscreen(off);
    try {
      const { app } = begin();
      late(app);
      for (let k = 0; k < SITES.length; k++) {
        app.s.site = k; app.dirty = true;
        const g = strictCanvas();
        for (let i = 0; i < 10; i++) { app.update(1 / 60); app.draw(g); }
        assert.deepEqual(g.count.bad, [], SITES[k].terrain);
      }
      const { g, said } = sayer();
      app.s.site = 5; app.draw(g);
      assert.ok(said.includes(SITES[5].n));
    } finally { withOffscreen(false); }
  }
});

test("the update card draws the cartridge's newsCard, and the relocation card says where the outpost went", async () => {
  const { SITES } = await import("../web/apps/outpost-rules.js");
  const { app } = begin();
  app.newsCard = () => ({ title: "OUTPOST UPDATED", lines: ["FIRST NEWS", ["SECOND NEWS", "amber"], "NOTHING WAS LOST."] });
  app.phase_ = "news";
  let { g, said } = sayer();
  app.draw(g);
  for (const v of ["OUTPOST UPDATED", "FIRST NEWS", "SECOND NEWS", "NOTHING WAS LOST."]) assert.ok(said.includes(v), v);
  app.phase_ = "card"; app.cardT = 2;
  app.card = { gain: 3, run: 1e6, secs: 600, total: 3, taps: 10, hand: 1, mach: 1, stage: "FIELD STATION", site: 5, from: 1 };
  ({ g, said } = sayer());
  app.draw(g);
  assert.ok(said.includes("NOW AT " + SITES[5].n + ", FROM " + SITES[1].n), said.join("|"));
});

test("the soundings menu is titled, and the finale draws", () => {
  const { app } = begin();
  app.ring = { menu: "site", idx: 0, hiAt: 0, last: app.clk };
  app.entries = [{ key: "back", kind: "back", label: "BACK", lines: ["TO THE BUILD RING"] }];
  const { g, said } = sayer();
  app.draw(g);
  assert.ok(said.includes("SOUNDINGS"));
  app.ring = null; app.finale = { t: 3 };
  const h = strictCanvas(); app.draw(h);
  assert.deepEqual(h.count.bad, []);
});
