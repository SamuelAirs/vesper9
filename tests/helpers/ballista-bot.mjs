// A bot for BALLISTA, used by tests/ballista.test.mjs and to tune the balance by hand:
//   node tests/helpers/ballista-bot.mjs [runs] [seed] [skill] [lag]
// It plays through the real button edges: a tap on the title, an aim at `angle`, a hold to near
// full power, then in flight a press timed at each skip (see playRun) and thrusters when rolling
// slowly or about to roll into a sinkhole. Between runs it shops.
import { Ballista, MODULES, upCost, timeToGround, BOUNCE_VY } from "../../web/apps/ballista.js";
import { Random } from "../../web/engine/math.js";
import { appContext } from "./app-context.mjs";

const F = 1 / 60;
const tap = (app) => { app.down(); app.up(); };
const normal = (r) => { let u = 0; for (let i = 0; i < 6; i++) u += r.next(); return (u - 3) / Math.sqrt(0.5); };
function hold(app, seconds) { app.down(); for (let i = 0; i < Math.round(seconds * 60); i++) app.update(F); app.up(); }

// One run from the title, result or aim screen to the result screen. Returns the run's result.
export function playRun(app, { angle = 36, skill = 1, lag = 0, aimPad = false, jitter = new Random(5), thrust = true, skip = true, max = 60 * 200 } = {}) {
  if (app.phase !== "aim") tap(app);
  // aim: press when the sweep passes the angle on its way up, hold to near the peak
  let n = 0;
  while (app.phase === "aim" && n++ < 600) {
    const a = app.angle;
    app.update(F);
    if (a < angle && app.angle >= angle) break;
  }
  app.down();
  const target = 0.95 - (1 - skill) * jitter.range(0, 0.4);
  // with `aimPad`, it reads the strip ahead and lets go when the shot will land on a pad, booster or
  // mine (late by `lag`, so it judges a little ahead), but not for less than half power
  const lands = (power) => { const x = app.carry(app.angle, power), f = app.groundAt(x); return f && (f.k === "pad" || f.k === "boost" || f.k === "mine"); };
  for (let i = 0; i < 200 && app.power < target; i++) {
    if (aimPad && app.power >= 0.5 && lands(Math.min(1, app.power + lag / 1.1))) { for (let k = 0; k < Math.round(lag * 60); k++) app.update(F); break; }
    app.update(F);
  }
  app.up();
  // In flight it aims each skip at the middle of the perfect window, off by a normal spread that
  // grows as `skill` falls, and its press lands `lag` seconds after it decides (a human's hand and
  // the console's input path). A press that lands early is tried once more.
  let steps = 0, aimed = -1, retry = false, aim = 0, wait = -1;
  const spread = 0.02 + 0.13 * (1 - skill);
  while (app.phase === "fly" && steps++ < max) {
    const p = app.p;
    if (wait >= 0 && wait-- === 0) {
      const before = app.early;
      tap(app);
      if (app.early > before && !retry) { retry = true; aim = Math.max(0.02, aim - 0.15); }
    }
    // like a player, it reads the arc ahead: when will the pod land, and fast enough to skip?
    const tti = p.mode === "air" && Math.hypot(p.vy, Math.sqrt(2 * app.L.g * Math.max(0, p.y))) > BOUNCE_VY * 1.3 ? timeToGround(p.y, p.vy, app.L.g) : -1;
    if (skip && wait < 0 && tti >= 0 && !app.skip) {
      if (aimed !== app.R.bounces) { aimed = app.R.bounces; retry = false; aim = app.L.perfect * 0.5 + spread * normal(jitter); }
      if (tti <= aim + lag) { wait = Math.round(lag * 60); aim = -1; }
    } else if (thrust && wait < 0 && app.kicks > 0 && app.landIn() < 0 && !app.late && ((p.mode === "roll" && p.vx < 220) || (p.y < 40 && app.pitAhead()))) tap(app);
    app.update(F);
  }
  while (app.phase === "over" && app.deadT < 0.8) app.update(F);
  return app.result;
}
// Buy whatever can be bought, cheapest system first, through the workshop's own buttons.
export function shop(app) {
  hold(app, 0.6); // result -> workshop
  for (let guard = 0; guard < 40; guard++) {
    let pick = -1, cost = 1e9;
    app.sv.up.forEach((L, i) => {
      const c = L < 5 ? upCost(i, L, app.sv.mark) : 1e9;
      if (c < cost) { cost = c; pick = i; }
    });
    if (pick < 0 || cost > app.sv.salvage) break;
    while (app.cur !== pick + 1) { tap(app); app.update(F); }
    hold(app, 0.6);
  }
  // once the systems are full, build the cheapest module (built ones are fitted while slots are free)
  // with every module built too, overhaul (two holds) for the next mark
  if (app.sv.up.every((L) => L >= 5) && app.sv.mods.length === MODULES.length && app.sv.mark < 9) {
    while (app.rows()[app.cur] !== "OVERHAUL") { tap(app); app.update(F); }
    hold(app, 0.6); hold(app, 0.6);
  }
  if (app.sv.up.every((L) => L >= 5)) {
    const next = MODULES.findIndex((m) => !app.sv.mods.includes(m.id));
    if (next >= 0 && MODULES[next].cost <= app.sv.salvage) {
      while (app.rows()[app.cur] !== "MODULES") { tap(app); app.update(F); }
      hold(app, 0.6);
      while (app.mcur !== next) { tap(app); app.update(F); }
      hold(app, 0.6);
      app.mcur = MODULES.length; hold(app, 0.6);
    }
  }
  while (app.cur !== 0) { tap(app); app.update(F); }
  hold(app, 0.6); // LAUNCH
}
export function campaign(runs, seed = 3, opts = {}) {
  const ctx = appContext({ seed });
  const app = new Ballista(ctx);
  const out = [];
  const jitter = new Random(seed * 17 + 1);
  for (let r = 0; r < runs; r++) {
    const res = playRun(app, { ...opts, jitter });
    out.push({ run: r + 1, m: res.metres, earned: res.salvage, chain: res.chain, salvage: app.sv.salvage, up: app.sv.up.join(""), mods: app.sv.mods.length, mark: app.sv.mark, contracts: app.sv.cdone, zone: app.sv.far, feats: app.sv.ft.length });
    if (opts.shop !== false) shop(app);
  }
  return { app, ctx, out };
}
if (process.argv[1] && process.argv[1].endsWith("ballista-bot.mjs")) {
  const runs = Number(process.argv[2] || 40), seed = Number(process.argv[3] || 3);
  const { out } = campaign(runs, seed, { skill: Number(process.argv[4] || 1), lag: Number(process.argv[5] || 0) });
  for (const o of out) console.log(JSON.stringify(o));
}
