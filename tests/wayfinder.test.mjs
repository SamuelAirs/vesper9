import test from "node:test";
import assert from "node:assert/strict";
import { Wayfinder, makeField, migrateWayfinder, neighbour, rankFor, capacity } from "../web/apps/wayfinder.js";
import { appContext, fakeCanvas, run } from "./helpers/app-context.mjs";

const mount = (progress, lamps = 4) => {
  const ctx = appContext({ progress }), boards = [];
  ctx.lampCount = () => lamps; ctx.board = (v) => boards.push(v);
  return { ctx, app: new Wayfinder(ctx), boards };
};
const follow = (app, path) => {
  for (const to of path.slice(1)) {
    const from = app.save.active.at;
    const d = [0, 1, 2, 3].find((dir) => neighbour(from, dir, app.field.size) === to);
    assert.equal(app.travel(d), true, `travel ${from} -> ${to}`);
  }
};
const press = (app, seconds) => { app.down({}); run(app, seconds); app.up({ durationMs: seconds * 1000 }); run(app, .05); };

test("300 generated fields are connected, contain alternative routes and can be rescued using actual travel and resource rules", () => {
  for (let tier = 0; tier <= 2; tier++) for (let seed = 1; seed <= 100; seed++) {
    const field = makeField(seed, tier), n = field.size ** 2, seen = new Set([field.start]), queue = [field.start];
    let edges = 0;
    for (let at = 0; at < n; at++) for (let d = 0; d < 4; d++) if (field.edges[at] & (1 << d)) {
      const to = neighbour(at, d, field.size); assert.ok(to >= 0); assert.ok(field.edges[to] & (1 << ((d + 2) % 4))); edges++;
    }
    while (queue.length) { const at = queue.shift(); for (let d = 0; d < 4; d++) if (field.edges[at] & (1 << d)) { const to = neighbour(at, d, field.size); if (!seen.has(to)) { seen.add(to); queue.push(to); } } }
    assert.equal(seen.size, n); assert.ok(edges / 2 >= n + Math.floor(n / 4) - 1);
    assert.equal(field.beacons.length, 3 + tier); assert.ok(field.relics.length > 0); assert.deepEqual(makeField(seed, tier), field);
    const { app } = mount({ knowledge: 40 }); app.tier = tier; app.start(seed);
    follow(app, field.route);
    assert.equal(app.phase, "result", `tier${tier} seed${seed}`); assert.equal(app.save.last.outcome, "rescued"); assert.ok(app.save.last.score > 0);
  }
});

test("caches and relics are one-use; movement spends destination cost and preserves a real backtrack route", () => {
  const { app } = mount(); app.start(7);
  const f = app.field, target = f.route[1], d = [0,1,2,3].find((x) => neighbour(f.start, x, f.size) === target);
  const before = app.save.active.energy;
  app.travel(d); assert.equal(app.save.active.energy, before - f.terrain[target] + (f.caches.includes(target) ? 6 : 0));
  app.go("survey"); app.backtrack(); assert.equal(app.save.active.at, f.start); assert.equal(app.save.active.trail.length, 0);
  const cache = f.caches[0]; app.save.active.at = cache; app.save.active.taken = [cache]; app.save.active.energy = 8;
  const neighbor = [0,1,2,3].find((x) => f.edges[cache] & (1 << x));
  app.travel(neighbor); const far = app.save.active.at, remaining = app.save.active.energy;
  app.travel((neighbor + 2) % 4); assert.equal(app.save.active.energy, remaining - f.terrain[cache]); assert.equal(app.save.active.taken.filter((x) => x === cache).length, 1); assert.notEqual(far, cache);
});

test("generic case taps inspect and return without spending charge; every option is available with the button alone", () => {
  const { app } = mount(); app.start(11);
  const state = JSON.stringify(app.save.active);
  app.knock({ side: "right" }); assert.equal(app.phase, "survey"); assert.equal(JSON.stringify(app.save.active), state);
  assert.ok(app.rows().some((r) => r.label === "BACKTRACK"));
  app.knock(); assert.equal(app.phase, "field"); assert.equal(JSON.stringify(app.save.active), state);
  while (app.rows()[app.cursor].label !== "SURVEY / BACKTRACK") press(app, .08);
  press(app, .8); assert.equal(app.phase, "survey");
});

test("save and resume reproduce the exact field, energy, trail, collected research and lights; malformed saves stay bounded", () => {
  const { app, ctx } = mount(); app.start(9001); follow(app, app.field.route.slice(0, 4)); app.guard.settle(); app.flush();
  const raw = JSON.parse(JSON.stringify(ctx.calls.saved.at(-1))), b = mount(raw);
  assert.deepEqual(b.app.field, app.field); assert.deepEqual(b.app.save.active, app.save.active);
  b.app.go("field"); run(b.app, .1); assert.ok(b.ctx.calls.leds.at(-1).length === 12); assert.ok(b.boards.at(-1).some((v) => v > 0));
  b.app.draw(fakeCanvas()); b.app.dispose(); assert.deepEqual(b.ctx.calls.leds.at(-1), Array(12).fill(0)); assert.deepEqual(b.boards.at(-1), [0,0,0]);
  const clean = migrateWayfinder({ knowledge: Infinity, gear: "pathfinder", active: { seed: -1, tier: 99 } });
  assert.equal(clean.active, null); assert.equal(clean.gear, "standard");
  const large = migrateWayfinder({ knowledge: 40, active: { seed: 2, tier: 2, visited: Array(100000).fill(1), trail: Array(100000).fill(2), energy: 1e8 } });
  assert.ok(new TextEncoder().encode(JSON.stringify(large)).length < 8192); assert.ok(large.active.energy <= capacity(2, "standard"));
});

test("research unlocks meaningful equipment and regions; stranding grants no research; free scans do not spend charge", () => {
  assert.equal(rankFor(11), 0); assert.equal(rankFor(12), 1); assert.equal(rankFor(40), 2);
  const { app } = mount({ knowledge: 12, gear: "scanner" }); app.start(41);
  const energy = app.save.active.energy; app.scan(); assert.equal(app.save.active.energy, energy); assert.ok(app.save.active.scanned.length > 1);
  app.finish("stranded"); assert.equal(app.save.knowledge, 12); assert.equal(app.save.rescued, 0);
  const porter = mount({ knowledge: 40, gear: "porter" }).app; porter.start(2); assert.equal(porter.save.active.energy, 20);
  const pathfinder = mount({ knowledge: 40, gear: "pathfinder" }).app; pathfinder.start(2); pathfinder.save.active.visited.push(pathfinder.field.route[1]); assert.equal(pathfinder.cost(pathfinder.field.route[1]), 1);
});

test("a paid survey cannot strand the expedition by consuming charge needed for every exit", () => {
  const { app } = mount(); app.start(3);
  for (const d of [3,1,3,1,3,1,3]) assert.equal(app.travel(d), true);
  assert.equal(app.save.active.at, 44); assert.equal(app.save.active.energy, 2);
  app.go("survey"); const before = JSON.stringify(app.save.active); app.scan();
  assert.equal(JSON.stringify(app.save.active), before); assert.match(app.message, /no affordable exit/);
  const expedition = app.save.active; app.backtrack(); assert.equal(expedition.at, 45); assert.equal(app.save.last.outcome, "stranded");
});

test("unaffordable beacon and cache directions stay red rather than advertising usable resources", () => {
  const { app, ctx } = mount(); app.start(700);
  const path = app.field.route; app.save.active.at = path.at(-2); app.save.active.energy = 0;
  const d = [0,1,2,3].find((dir) => neighbour(app.save.active.at, dir, app.field.size) === path.at(-1));
  app.cursor = d; run(app, .1); const frame = ctx.calls.leds.at(-1).slice(d * 3, d * 3 + 3);
  assert.ok(frame[0] > frame[1] * 4 && frame[0] > frame[2] * 4);
});

test("pause clears all lamps and board; resume restores owned expedition guidance", () => {
  const { app, ctx, boards } = mount(); app.start(700); run(app, .1);
  assert.ok(ctx.calls.leds.at(-1).some((v) => v > 0)); assert.ok(boards.at(-1).some((v) => v > 0));
  app.pause(); assert.deepEqual(ctx.calls.leds.at(-1), Array(12).fill(0)); assert.deepEqual(boards.at(-1), [0,0,0]);
  app.resume(); run(app, .1); assert.ok(ctx.calls.leds.at(-1).some((v) => v > 0)); assert.ok(boards.at(-1).some((v) => v > 0));
});

test("tap tap hold cancel returns the expedition and its saves to before the first tap", () => {
  const { app, ctx } = mount(); app.start(700); app.guard.settle(); app.flush();
  const before = JSON.stringify(app.save), saves = ctx.calls.saved.length;
  press(app, .08); press(app, .08); app.down({}); run(app, 1.7); app.cancel(); app.pause();
  assert.equal(JSON.stringify(app.save), before); assert.equal(ctx.calls.saved.length, saves); assert.equal(app.held, false);
  run(app, .2); assert.ok(ctx.calls.leds.every((a) => a.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)));
  const legacy = mount({}, 3); legacy.app.start(701); run(legacy.app, .1); assert.equal(legacy.ctx.calls.leds.at(-1).length, 9);
});

test("the menu gesture consumes a release that would rescue; a plain hold rescues and completes the daily", () => {
  const ctx = appContext(); let daily = 0; ctx.dailyMet = () => daily++;
  const game = new Wayfinder(ctx); game.start(700); const route = game.field.route;
  follow(game, route.slice(0, -1)); game.guard.settle(); game.flush();
  const d = [0,1,2,3].find((dir) => neighbour(game.save.active.at, dir, game.field.size) === route.at(-1));
  game.cursor = (d + 4) % 6; const before = JSON.stringify(game.save), saves = ctx.calls.saved.length;
  press(game, .08); press(game, .08); game.down({}); run(game, 1.7); game.cancel(); game.pause();
  assert.equal(JSON.stringify(game.save), before); assert.equal(ctx.calls.saved.length, saves); assert.equal(ctx.calls.score.length, 0); assert.equal(daily, 0);
  game.cursor = d; press(game, .8); run(game, 1); assert.equal(game.phase, "result"); assert.equal(daily, 1); assert.equal(ctx.calls.score.length, 1);
});
