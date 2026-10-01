import test from "node:test";
import assert from "node:assert/strict";
import { LAMP, lamps, fill, only, meter, spot, ramp, pulse, chase, lightsOff, blend } from "../web/engine/lightshow.js";
import { recordRun } from "../web/engine/kit.js";
import { APPS } from "../web/apps/registry.js";
import { SECTORS } from "../web/apps/catalog.js";
import { appContext, fakeCanvas, run } from "./helpers/app-context.mjs";

test("light helpers always return nine whole bytes", () => {
  const samples = [lightsOff(), fill(LAMP.amber, 0.37), only(1, LAMP.red), lamps(LAMP.green, null, LAMP.blue),
    meter(0.5, LAMP.green), meter(7, LAMP.green), meter(-1, LAMP.green), spot(0.5, LAMP.cyan), spot(2, LAMP.cyan),
    fill(ramp(0.5, [LAMP.green, LAMP.amber, LAMP.red]), pulse(0.123))];
  for (const values of samples) {
    assert.equal(values.length, 9);
    for (const v of values) assert.ok(Number.isInteger(v) && v >= 0 && v <= 255, String(values));
  }
});
test("meter fills left to right and spot follows position", () => {
  assert.deepEqual(meter(0, LAMP.white), lightsOff());
  assert.deepEqual(meter(1 / 3, LAMP.green), only(0, LAMP.green));
  assert.deepEqual(meter(1, LAMP.green), fill(LAMP.green));
  assert.deepEqual(spot(0, LAMP.red, 0.75), only(0, LAMP.red));
  assert.deepEqual(spot(1, LAMP.red, 0.75), only(2, LAMP.red));
  assert.deepEqual(blend(LAMP.off, LAMP.red, 2), LAMP.red);
  assert.deepEqual([0, 0.25, 0.5, 0.75, 1].map((t) => chase(t, 4)), [0, 1, 2, 1, 0]);
});
test("recordRun counts runs and keeps the best milestone", async () => {
  const ctx = appContext({ progress: { runs: 2, milestone: 9 } });
  await recordRun(ctx, { milestone: 4, metres: 120 });
  assert.deepEqual(ctx.progress(), { schema: 1, runs: 3, last: { milestone: 4, metres: 120 }, milestone: 9 });
});
test("every registered cartridge mounts, runs and disposes under the test context", () => {
  assert.equal(APPS.length % 6, 0);
  assert.equal(SECTORS.length, APPS.length / 6);
  for (const meta of APPS) {
    const ctx = appContext();
    const app = meta.create(ctx);
    if (app.navigation) {
      assert.ok(ctx.calls.actions.length, meta.id + " offers actions");
      app.tick?.();
    } else {
      run(app, 2);
      app.draw(fakeCanvas());
      app.down?.({ source: "keyboard" });
      run(app, 0.2);
      app.up?.({ source: "keyboard", durationMs: 200 });
      app.cancel?.();
      run(app, 1);
      app.draw(fakeCanvas());
    }
    app.pause?.(); app.resume?.(); app.dispose?.();
  }
});
