import test from "node:test";
import assert from "node:assert/strict";
import { HighBar } from "../web/apps/highbar.js";
import { appContext } from "./helpers/app-context.mjs";

import { ROUTES, SKY_ROUTES, SKY_GOLD } from "./helpers/highbar-flow-routes.mjs";

for (const route of [...ROUTES, ...SKY_ROUTES]) for (const mode of [0, 1, 2]) {
  test(`park ${route.park + 1} / line ${route.line + 1} banks through actual controls in ${["SESSION", "LINE RUN", "PRACTICE"][mode]}`, () => {
    const ctx = appContext({ settings: { knock: "medium" } });
    const app = new HighBar(ctx);
    app.slot().guided = true;
    // The audit exercises unlocked parks without manufacturing the current park's goals.
    app.slot().goals = [0, 1, 2, 3].map(p => p < route.park ? [0, 1, 2] : []);
    app.parkId = route.park; app.slot().line = route.line; app.mode = mode; app.start();
    const before = structuredClone(app.save), target = app.challenge();
    let targetBanks = 0;
    const bank = app.bank.bind(app);
    app.bank = () => { if (app.meetsLine(target, app.combo)) targetBanks++; bank(); };
    const events = route.input.split(" ").map(s => [Number(s.slice(1)), s[0]]);
    let next = 0;
    for (let frame = 0; frame < route.frames && app.phase === "play"; frame++) {
      while (events[next]?.[0] === frame) {
        const [, action] = events[next++];
        if (action === "D") app.down({ source: "keyboard" });
        else if (action === "U") app.up({ source: "keyboard", durationMs: (app.t - app.pt) * 1000 });
        else app.knock();
      }
      app.update(1 / 60);
    }
    assert.ok(targetBanks > 0, target.name + " must actually land and bank within this mode's clock");
    assert.ok(app.score > 0);
    if (mode === 1) {
      assert.equal(app.lineMet, true); assert.equal(app.phase, "over");
      assert.equal(app.attemptResult.line, route.line); assert.equal(targetBanks, 1);
      assert.ok(app.attemptResult.value > 0); assert.equal(app.slot().runs, 1);
      assert.ok(app.runTime <= app.lineSeconds(), "matching bank ends inside the ordinary attempt clock");
    }
    if (mode !== 2) assert.ok(app.slot().lines[route.park].includes(route.line));
    app.finish(); app.guard.settle();
    if (mode === 2) {
      assert.deepEqual(app.save, before, "the same route in practice changes no career data");
      assert.equal(ctx.calls.saved.length, 0); assert.equal(ctx.calls.score.length, 0);
    } else if (mode === 1) {
      assert.equal(app.slot().lineBest[route.park][route.line], app.score);
      assert.equal(ctx.calls.score.length, 0, "short attempts never enter the session leaderboard");
    } else assert.deepEqual(ctx.calls.score.at(-1), [app.score, "flow-v4"]);
  });
}

for (const route of SKY_GOLD) for (const mode of [0, 1, 2]) {
  test(`sky route ${route.park + 1} links actual clean landings for gold in ${["SESSION", "LINE RUN", "PRACTICE"][mode]}`, () => {
    const ctx = appContext({ settings: { knock: "medium" } }), app = new HighBar(ctx);
    app.slot().guided = true; app.slot().goals = [0, 1, 2, 3].map(p => p < route.park ? [0, 1, 2] : []);
    app.parkId = route.park; app.slot().line = 3; app.mode = mode; app.start();
    const before = structuredClone(app.save), events = route.input.split(" ").map(s => [+s.slice(1), s[0]]);
    let next = 0, goldBank = null;
    const bank = app.bank.bind(app);
    app.bank = () => { if (app.meetsLine(app.challenge(), app.combo)) goldBank = structuredClone(app.combo); bank(); };
    for (let frame = 0; frame < route.frames && app.phase === "play"; frame++) {
      while (events[next]?.[0] === frame) {
        const action = events[next++][1];
        if (action === "D") app.down({ source: "node" });
        else app.up({ source: "node", durationMs: (app.t - app.pt) * 1000 });
      }
      app.update(1 / 60);
    }
    assert.ok(goldBank, "the upper sequence must bank in the same linked combo");
    assert.equal(app.lineMedal(app.challenge(), goldBank), 3);
    assert.ok(goldBank.cleanLandings >= 2); assert.equal(goldBank.sketchy, 0); assert.equal(app.stats.bails, 0);
    if (mode === 1) { assert.equal(app.phase, "over"); assert.equal(app.attemptResult.medal, 3); }
    if (mode !== 2) assert.equal(app.slot().lineMedals[route.park][3], 3);
    app.finish(); app.guard.settle();
    if (mode === 2) { assert.deepEqual(app.save, before); assert.equal(ctx.calls.saved.length, 0); }
  });
}

test("all sixteen attempt clocks are explicit, preserving original limits and allowing upper routes", () => {
  const app = new HighBar(appContext());
  for (let park = 0; park < 4; park++) for (let line = 0; line < 4; line++) {
    app.parkId = park; app.slot().line = line; app.mode = 1; app.start();
    const seconds = line === 3 ? park === 0 ? 60 : 75 : park === 2 && line > 0 ? 75 : 45;
    assert.equal(app.clock, seconds);
    assert.match(app.setupItems().find(item => item.id === "line").label, new RegExp(seconds + "s"));
  }
});
