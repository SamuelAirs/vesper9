// OUTPOST's scene (web/apps/outpost-scene.js): drawing and the visual-only animation.
// Moved here from tests/outpost.test.mjs unchanged when the game was split into modules.
import test from "node:test";
import assert from "node:assert/strict";
import { Outpost } from "../web/apps/outpost.js";
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
