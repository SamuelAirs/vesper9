// A bot for BALLISTA, used by tests/ballista.test.mjs and to tune the balance by hand:
//   node tests/helpers/ballista-bot.mjs [runs] [seed]
// It plays through the real button edges: a tap on the title, an aim at `angle`, a hold to near
// full power, then in flight a press late in each skip window (a perfect skip, with some jitter)
// and thrusters when rolling slowly or about to roll into a sinkhole. Between runs it shops.
import { Ballista, SKIP_WIN, UPGRADES } from "../../web/apps/ballista.js";
import { Random } from "../../web/engine/math.js";
import { appContext } from "./app-context.mjs";

const F = 1 / 60;
const tap = (app) => { app.down(); app.up(); };
function hold(app, seconds) { app.down(); for (let i = 0; i < Math.round(seconds * 60); i++) app.update(F); app.up(); }

// One run from the title, result or aim screen to the result screen. Returns the run's result.
export function playRun(app, { angle = 36, skill = 1, jitter = new Random(5), thrust = true, skip = true, max = 60 * 200 } = {}) {
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
  for (let i = 0; i < 200 && app.power < target; i++) app.update(F);
  app.up();
  let steps = 0, skipped = -1;
  while (app.phase === "fly" && steps++ < max) {
    const p = app.p;
    const tti = app.skipWindow();
    const want = app.L.perfect * (skill >= 1 ? 0.6 : 0.6 + jitter.range(0, 3 * (1 - skill)));
    if (skip && tti >= 0 && !app.skip && tti <= Math.min(SKIP_WIN, want) && skipped !== app.R.bounces) { skipped = app.R.bounces; tap(app); }
    else if (thrust && app.kicks > 0 && tti < 0 && ((p.mode === "roll" && p.vx < 220) || (p.y < 40 && app.pitAhead()))) tap(app);
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
      const c = L < 5 ? UPGRADES[i].cost[L] : 1e9;
      if (c < cost) { cost = c; pick = i; }
    });
    if (pick < 0 || cost > app.sv.salvage) break;
    while (app.cur !== pick + 1) { tap(app); app.update(F); }
    hold(app, 0.6);
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
    out.push({ run: r + 1, m: res.metres, salvage: app.sv.salvage, up: app.sv.up.join(""), zone: app.sv.far, feats: app.sv.ft.length });
    if (opts.shop !== false) shop(app);
  }
  return { app, ctx, out };
}
if (process.argv[1] && process.argv[1].endsWith("ballista-bot.mjs")) {
  const runs = Number(process.argv[2] || 40), seed = Number(process.argv[3] || 3);
  const { out } = campaign(runs, seed, { skill: Number(process.argv[4] || 1) });
  for (const o of out) console.log(JSON.stringify(o));
}
