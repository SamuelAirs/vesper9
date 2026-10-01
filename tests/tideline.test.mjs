import test from "node:test";
import assert from "node:assert/strict";
import { Tideline } from "../web/apps/tideline.js";
import { Random } from "../web/engine/math.js";
import { appContext, fakeCanvas, run } from "./helpers/app-context.mjs";

const DT = 1 / 60;
const M = Tideline.model;
const SP = M.SPECIES;
const byName = (name) => SP.find((s) => s.name === name);
const OFF = Array(9).fill(0);
const sum3 = (v, i) => v[i * 3] + v[i * 3 + 1] + v[i * 3 + 2];

const make = (options = {}, hour = 10) => {
  const ctx = appContext(options);
  const app = new Tideline(ctx);
  app.nowHour = () => hour;
  return { ctx, app };
};
const tap = (app, ms = 80) => { app.down(); run(app, ms / 1000, null); app.up({ durationMs: ms }); };
const toShore = (app) => { tap(app); assert.equal(app.phase, "shore"); };
// Cast at a chosen power and wait through to the bite window.
function castTo(app, power) {
  app.down();
  run(app, 0.22 + 1.5 * power + 0.02, null);
  assert.equal(app.phase, "charge");
  app.up();
  run(app, 0.7, null);
  assert.equal(app.phase, "wait");
  let guard = 0;
  while (app.phase === "wait" && guard++ < 600) run(app, DT, null);
  assert.equal(app.phase, "bite");
}
// Hook a given species directly for catch tests.
function hookWith(app, sp) {
  app.fishSp = sp;
  app.phase = "bite"; app.phaseT = 0; app.biteFor = 1;
  app.down();
  assert.equal(app.phase, "catch");
}

// ---- a catch bot: sees the gauge (state), reacts after a delay, plays bang-bang on a PD target ----
function makeCatchBot(lag = 8, noise = 0.04, gain = 5, seed = 5) {
  const rng = new Random(seed), hist = [];
  let held = false, wait = 0;
  return (c) => {
    hist.push([c.f, c.z, c.zv]);
    const obs = hist[Math.max(0, hist.length - 1 - lag)];
    const prev = hist[Math.max(0, hist.length - 5 - lag)];
    if (wait-- <= 0) {
      wait = 2;
      const f = obs[0] + (rng.next() - 0.5) * noise;
      const vt = Math.max(-1, Math.min(1, (f - obs[1]) * gain + ((obs[0] - prev[0]) / (4 / 60)) * 0.5));
      held = obs[2] < vt;
    }
    return held;
  };
}
function modelCatch(sp, gear, seed, bot, beginner = false) {
  const rng = new Random(seed);
  const c = M.newCatch(sp, gear, rng, beginner);
  let r = 0, frames = 0;
  while (!r && frames < 60 * 120) { r = M.stepCatch(c, bot(c), rng, DT); frames++; }
  return { r, seconds: frames / 60, c };
}

// ---- a bot that plays the whole app: cast, bite, catch, card ----------------------------------
function makeDriver(app, opts = {}) {
  const bot = makeCatchBot(opts.lag ?? 8, 0.04, 5, opts.seed ?? 3);
  let stage = "idle", react = 0, castPower = 0.3, wait = 0;
  return () => {
    const ph = app.phase;
    if (ph === "title") { app.down(); app.up(); return; }
    if (ph === "shore") {
      if (!app.held) { castPower = opts.power ?? 0.3; app.down(); }
      return;
    }
    if (ph === "charge") {
      if (app.power >= castPower) app.up();
      return;
    }
    if (ph === "bite") {
      if (++react > (opts.react ?? 14) && !app.held) app.down();
      return;
    }
    react = 0;
    if (ph === "catch") {
      const want = bot(app.cur);
      if (want && !app.held) app.down();
      else if (!want && app.held) app.up();
      return;
    }
    if (ph === "card") {
      if (app.held) { app.up(); return; }
      if (app.phaseT > 1.2 && ++wait > 6) { wait = 0; app.down(); app.up(); }
      return;
    }
    stage = ph;
  };
}
function play(seed, seconds, options = {}) {
  const { ctx, app } = make({ seed, progress: options.progress });
  if (options.setup) options.setup(app);
  const drive = makeDriver(app, options);
  run(app, seconds, drive);
  return { ctx, app };
}

// ---------------------------------------------------------------------------------------
test("catalogue: about thirty species in four waters with all fields sane, legend per water", () => {
  assert.equal(SP.length, 30);
  assert.equal(new Set(SP.map((s) => s.name)).size, 30);
  for (const s of SP) {
    assert.ok(s.water >= 0 && s.water < 4 && s.rar >= 1 && s.rar <= 5 && s.max > s.min && s.min > 0);
    assert.ok(["steady", "sinker", "darter", "bolter", "fighter"].includes(s.kind), s.kind);
    assert.ok(s.d > 0 && s.d <= 1 && s.note.length > 20 && s.note.length < 100, s.name);
    assert.match(s.times, /^[DduN n]*$/);
  }
  for (let w = 0; w < 4; w++) {
    assert.equal(SP.filter((s) => s.water === w && s.rar === 5).length, 1, "one legend in water " + w);
    assert.ok(SP.some((s) => s.water === w && s.rar === 1 || s.water === w && !s.times && s.rar < 5), "an always-biting species in water " + w);
  }
  assert.ok(new Set(SP.map((s) => s.kind)).size === 5);
  assert.ok(SP.filter((s) => s.times).length >= 8, "time-of-day species");
  assert.ok(M.TREASURE.length >= 5);
});

test("zone physics: bounded, stable, with weight and a soft bounce", () => {
  const rng = new Random(9);
  const c = M.newCatch(SP[0], { zone: 0, reel: 0 }, rng, false);
  // Holding lifts with acceleration, not instantly.
  M.stepZone(c, true, DT);
  assert.ok(c.zv > 0 && c.zv < 0.1, "accelerates: " + c.zv);
  let top = 0;
  for (let i = 0; i < 300; i++) { M.stepZone(c, true, DT); top = Math.max(top, c.z); assert.ok(c.z <= 1 - c.h + 1e-9 && Number.isFinite(c.zv)); }
  assert.ok(Math.abs(c.z - (1 - c.h)) < 1e-9, "pinned at the top");
  // Release from the top: sinks, hits the floor, bounces a little, settles.
  let bounced = false, lastV = 0;
  for (let i = 0; i < 400; i++) {
    M.stepZone(c, false, DT);
    if (lastV < -0.3 && c.zv > 0) bounced = true;
    lastV = c.zv;
    assert.ok(c.z >= c.h - 1e-9 && Math.abs(c.zv) <= 1.35 + 1e-9);
  }
  assert.ok(bounced, "soft bounce at the bottom");
  assert.ok(Math.abs(c.zv) < 0.05 && c.z <= c.h + 1e-6, "settled");
  // Random mashing never leaves the gauge or goes non-finite.
  for (let i = 0; i < 6000; i++) { M.stepZone(c, rng.next() < 0.5, DT); assert.ok(c.z >= c.h - 1e-9 && c.z <= 1 - c.h + 1e-9 && Number.isFinite(c.z)); }
});

test("every fish behaviour stays inside the gauge and moves in its own way", () => {
  const spread = {};
  for (const kind of ["steady", "sinker", "darter", "bolter", "fighter"]) {
    const sp = SP.find((s) => s.kind === kind);
    for (const d of [0.1, 0.5, 1]) {
      const rng = new Random(31);
      const c = M.newCatch({ ...sp, d }, { zone: 0, reel: 0 }, rng, false);
      let travel = 0, last = c.f, minF = 1, maxF = 0;
      for (let i = 0; i < 60 * 40; i++) {
        c.meter = (i % 300) / 300;
        c.t += DT;
        M.stepFish(c, rng, DT);
        assert.ok(c.f >= 0.12 - 1e-9 && c.f <= 0.92 + 1e-9 && Number.isFinite(c.f) && Number.isFinite(c.fv), `${kind} ${d} ${c.f}`);
        travel += Math.abs(c.f - last); last = c.f; minF = Math.min(minF, c.f); maxF = Math.max(maxF, c.f);
      }
      if (d === 1) spread[kind] = travel / 40;
      assert.ok(maxF - minF > 0.25, `${kind} d=${d} uses the gauge`);
    }
  }
  assert.ok(spread.darter > spread.steady * 1.5 && spread.darter > spread.sinker * 3, "darters travel more than steady fish: " + JSON.stringify(spread));
  // Bolters hover then bolt: a long-run speed histogram has both slow and fast spells.
  const rng = new Random(2), c = M.newCatch({ ...byName("CINDER RAY"), d: 0.8 }, { zone: 0, reel: 0 }, rng, false);
  let slow = 0, fast = 0;
  for (let i = 0; i < 3600; i++) { c.t += DT; M.stepFish(c, rng, DT); if (Math.abs(c.fv) < 0.12) slow++; if (Math.abs(c.fv) > 0.9) fast++; }
  assert.ok(slow > 600 && fast > 60, `hover ${slow} bolt ${fast}`);
  // A fighter fights harder as the meter fills.
  const speedAt = (meter) => {
    const r = new Random(4), f = M.newCatch(byName("SLAGBACK"), { zone: 0, reel: 0 }, r, false);
    let t = 0;
    for (let i = 0; i < 3600; i++) { f.meter = meter; f.t += DT; const before = f.f; M.stepFish(f, r, DT); t += Math.abs(f.f - before); }
    return t;
  };
  assert.ok(speedAt(0.9) > speedAt(0.1) * 1.2, `${speedAt(0.9)} vs ${speedAt(0.1)}`);
});

test("meter rules: fills inside the zone, drains outside after a short grace, lands at 1, lost at 0", () => {
  const rng = new Random(1);
  const c = M.newCatch(SP[0], { zone: 0, reel: 0 }, rng, false);
  const place = (inside) => { c.f = inside ? c.z : Math.min(0.9, c.z + c.h + 0.3); c.tgt = c.f; c.fv = 0; };
  const step = () => { const before = { f: c.f, z: c.z }; const r = M.stepCatch(c, false, rng, DT); return r; };
  c.z = 0.5; c.zv = 0; c.grace = 0;
  const m0 = c.meter;
  for (let i = 0; i < 30; i++) { c.z = 0.5; c.zv = 0; place(true); c.timer = 9; c.tgt = 0.5; M.stepCatch(c, true, rng, DT); }
  assert.ok(c.meter > m0, "fills inside");
  const m1 = c.meter;
  c.grace = 0.5;
  for (let i = 0; i < 20; i++) { c.z = 0.5; c.zv = 0; c.f = 0.9; c.fv = 0; c.tgt = 0.9; c.timer = 9; M.stepCatch(c, false, rng, DT); }
  assert.ok(Math.abs(c.meter - m1) < 1e-9, "grace holds the meter: " + (c.meter - m1));
  for (let i = 0; i < 60; i++) { c.z = 0.5; c.zv = 0; c.f = 0.9; c.fv = 0; c.tgt = 0.9; c.timer = 9; M.stepCatch(c, false, rng, DT); }
  assert.ok(c.meter < m1, "drains outside");
  // Landing and losing.
  c.meter = 0.999; c.grace = 0;
  let r = 0;
  for (let i = 0; i < 60 && !r; i++) { c.z = 0.5; c.zv = 0; c.f = 0.5; c.fv = 0; c.tgt = 0.5; c.timer = 9; r = M.stepCatch(c, false, rng, DT); }
  assert.equal(r, 1);
  c.meter = 0.002; c.grace = 0; r = 0;
  for (let i = 0; i < 60 && !r; i++) { c.z = 0.5; c.zv = 0; c.f = 0.9; c.fv = 0; c.tgt = 0.9; c.timer = 9; r = M.stepCatch(c, false, rng, DT); }
  assert.equal(r, -1);
  void step; void place;
});

test("an idle player loses the fish, in the model and in the app", () => {
  let lost = 0, n = 0;
  for (const sp of SP) for (let s = 1; s <= 6; s++) {
    const out = modelCatch(sp, { zone: 0, reel: 0 }, s, () => false);
    n++; if (out.r === -1) lost++;
  }
  assert.ok(lost / n > 0.97, `idle loses ${lost}/${n}`);
  const { app, ctx } = make({ seed: 21 });
  app.sv.landed = 5; // past the beginner assists
  toShore(app);
  castTo(app, 0.2);
  tap(app); // answer the bite, then do nothing
  assert.equal(app.phase, "catch");
  run(app, 40, null);
  assert.equal(app.phase, "card");
  assert.ok(app.card.lost && /SLACK/.test(app.card.reason));
  assert.equal(app.sv.landed, 5);
  void ctx;
});

test("bot results by species and gear (the report table)", () => {
  const rows = [];
  const pro = (s) => makeCatchBot(8, 0.04, 5, s);
  const levels = [[0, 0], [1, 1], [2, 2], [3, 3]];
  const rate = (sp, gear, n = 60) => { let w = 0; for (let s = 1; s <= n; s++) if (modelCatch(sp, gear, s, pro(s)).r === 1) w++; return w / n; };
  const table = {};
  for (const sp of SP) {
    table[sp.name] = levels.map(([z, r]) => rate(sp, { zone: z, reel: r }));
    rows.push(sp.name.padEnd(22) + (RAR[sp.rar]).padEnd(10) + sp.kind.padEnd(8) + table[sp.name].map((x) => (x * 100).toFixed(0).padStart(4) + "%").join(""));
  }
  console.log("species                rarity    kind      L0   L1   L2   L3  (gear levels all raised together)\n" + rows.join("\n"));
  const avg = (rar, lvl) => { const l = SP.filter((s) => s.rar === rar); return l.reduce((a, s) => a + table[s.name][lvl], 0) / l.length; };
  assert.ok(avg(1, 0) > 0.93, "common at L0 " + avg(1, 0));
  for (const s of SP.filter((x) => x.rar === 1)) assert.ok(table[s.name][0] > 0.85, s.name);
  assert.ok(avg(5, 0) < 0.05, "legends at L0 " + avg(5, 0));
  assert.ok(avg(5, 3) > 0.75, "legends at max gear " + avg(5, 3));
  assert.ok(avg(3, 0) < avg(1, 0) && avg(3, 1) > 0.6, `rare ${avg(3, 0)} -> ${avg(3, 1)}`);
  assert.ok(avg(4, 2) > 0.85);
  // Gear is what makes the difference: every species is at least as catchable at L3 as at L0.
  for (const sp of SP) assert.ok(table[sp.name][3] >= table[sp.name][0] - 0.05, sp.name);
});
const RAR = ["", "common", "uncommon", "rare", "v.rare", "legend"];

test("the first catches are taught: beginner assists land a clumsy bot", () => {
  let w = 0, n = 0;
  for (const sp of SP.filter((s) => s.water === 0 && s.rar === 1)) for (let s = 1; s <= 30; s++) {
    n++; if (modelCatch(sp, { zone: 0, reel: 0 }, s, makeCatchBot(13, 0.06, 2, s), true).r === 1) w++;
  }
  assert.ok(w / n > 0.9, `clumsy bot lands ${w}/${n} on the first fish`);
});

test("lamps alone decide the action in every frame of simulated catches", () => {
  let frames = 0, ties = 0;
  const bright = { low: [], high: [] };
  for (const [name, seed] of [["PALE SKIFF", 1], ["SALT WISP", 2], ["CINDER RAY", 3], ["SLAGBACK", 4], ["TRENCH WARDEN", 5], ["MUDLARK", 6]]) {
    const { ctx, app } = make({ seed });
    app.sv.landed = 60;
    app.sv.g = [2, 2, 3, 0];
    toShore(app);
    castTo(app, 0.3);
    hookWith(app, byName(name));
    const bot = makeCatchBot(8, 0.04, 5, seed);
    let n = 0;
    while (app.phase === "catch" && n++ < 3600) {
      const want = bot(app.cur);
      if (want && !app.held) app.down(); else if (!want && app.held) app.up();
      app.update(DT);
      if (app.phase !== "catch") break;
      const c = app.cur, v = ctx.calls.leds.at(-1);
      assert.equal(v.length, 9);
      const L = sum3(v, 0), Mid = sum3(v, 1), R = sum3(v, 2);
      const e = c.f - c.z, inside = Math.abs(e) <= c.h;
      frames++;
      // Which lamp is lit gives the side of the zone the fish is on.
      if (Math.abs(e) > 0.006) {
        assert.ok(e > 0 ? R > L : L > R, `fish ${e > 0 ? "above" : "below"} but lamps ${v}`);
        assert.equal(R > L ? "hold" : "release", e > 0 ? "hold" : "release");
      } else ties++;
      // The middle lamp is lit, and green, exactly while the fish is inside.
      if (inside) assert.ok(Mid > 0 && v[4] > v[3] && v[4] > v[5] || c.meter < 0.22, `inside but middle ${v}`);
      else assert.equal(Mid, 0, "middle dark outside the zone");
      (c.meter < 0.3 ? bright.low : c.meter > 0.8 ? bright.high : []).push(L + Mid + R);
    }
  }
  const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  assert.ok(frames > 1200, "frames checked " + frames); // coverage of the check, not a difficulty bar
  assert.ok(ties / frames < 0.1);
  assert.ok(mean(bright.high) > mean(bright.low) * 1.2, `brightness follows the meter: ${mean(bright.low)} -> ${mean(bright.high)}`);
});

test("a player who reads only the lamps can land the easy fish", () => {
  let landed = 0, runs = 0;
  for (const name of ["PALE SKIFF", "GLASS PERCH", "GLOW SPRAT", "MUDLARK"]) for (let seed = 1; seed <= 6; seed++) {
    const { ctx, app } = make({ seed });
    app.sv.landed = 0; // beginner assists on, as for a new player
    toShore(app);
    castTo(app, 0.3);
    hookWith(app, byName(name));
    runs++;
    let n = 0;
    while (app.phase === "catch" && n++ < 3600) {
      const v = ctx.calls.leds.at(-1) || OFF;
      const hold = sum3(v, 2) > sum3(v, 0); // right lamp lit: fish above, hold. Left: release.
      if (hold && !app.held) app.down(); else if (!hold && app.held) app.up();
      app.update(DT);
    }
    if (app.card && !app.card.lost) landed++;
  }
  assert.ok(landed / runs > 0.7, `lamp-only landed ${landed}/${runs}`);
});

test("bite is signalled on the lamps (all three), by sound, and a press is needed within the window", () => {
  const { ctx, app } = make({ seed: 7 });
  app.sv.landed = 5;
  toShore(app);
  castTo(app, 0.2);
  const tones = ctx.calls.tone.length;
  run(app, 0.1, null);
  const flashes = [];
  for (let i = 0; i < 40; i++) { app.update(DT); flashes.push(ctx.calls.leds.at(-1)); if (app.phase !== "bite") break; }
  assert.ok(flashes.some((v) => sum3(v, 0) > 300 && sum3(v, 1) > 300 && sum3(v, 2) > 300), "all three lamps flash bright");
  assert.ok(ctx.calls.tone.length >= tones, "bite tones were played");
  // Miss it: the window closes and the fish is gone.
  run(app, 1.2, null);
  assert.equal(app.phase, "card");
  assert.ok(/GOT AWAY/.test(app.card.reason));
});

test("pressing early scares the fish off; the wait is short and varied", () => {
  const { app } = make({ seed: 8 });
  toShore(app);
  app.down(); run(app, 0.6, null); app.up(); run(app, 0.7, null);
  assert.equal(app.phase, "wait");
  run(app, 0.5, null);
  // A learner's first early press in a cast is forgiven with a reminder; the second is not.
  tap(app);
  assert.equal(app.phase, "wait", "forgiven while learning");
  tap(app);
  assert.equal(app.phase, "card");
  assert.ok(/TOO SOON/.test(app.card.reason));
  // An experienced angler scares it at once.
  const old = make({ seed: 8 }).app;
  old.sv.landed = 60;
  toShore(old);
  old.down(); run(old, 0.6, null); old.up(); run(old, 0.7, null);
  run(old, 0.5, null);
  tap(old);
  assert.equal(old.phase, "card");
  // Wait lengths across many casts: short (under 5 s) and varied.
  const waits = [];
  for (let i = 0; i < 40; i++) { const r = make({ seed: 100 + i }); r.app.startWait(); waits.push(r.app.waitFor); }
  assert.ok(Math.max(...waits) < 5 && Math.min(...waits) >= 1.6 && Math.max(...waits) - Math.min(...waits) > 1.5, waits.join());
});

test("cast distance decides the water, and the caster gear decides how far you can reach", () => {
  const { app } = make({ seed: 3 });
  assert.equal(app.castMax(), 45);
  assert.equal(app.waterAt(10), 0);
  assert.equal(app.waterAt(35), 1);
  assert.equal(app.waterAt(60), 2);
  assert.equal(app.waterAt(100), 3);
  toShore(app);
  app.down(); run(app, 3, null); app.up();
  assert.equal(app.water, 1, "full charge at level 0 reaches the second water");
  assert.equal(app.dist, 45);
  const near = make({ seed: 3 }); toShore(near.app);
  near.app.down(); run(near.app, 0.5, null); near.app.up();
  assert.equal(near.app.water, 0);
  const far = make({ seed: 3 }); far.app.sv.g[2] = 3; toShore(far.app);
  far.app.down(); run(far.app, 3, null); far.app.up();
  assert.equal(far.app.water, 3);
});

test("availability by water, time of day, weather, bait and rarity gates", () => {
  const { app } = make({ seed: 11 });
  const names = (water, period, weather, lure = 0, chum = false) => app.candidates(water, period, weather, lure, chum).map((e) => e.sp.name);
  assert.ok(names(0, "n", "CLEAR").includes("BLIND MOON-EEL") && !names(0, "d", "CLEAR").includes("BLIND MOON-EEL"), "the moon-eel bites only at night");
  assert.ok(names(0, "d", "CLEAR").includes("GLASS PERCH") && !names(0, "n", "CLEAR").includes("GLASS PERCH"));
  assert.ok(names(0, "u", "CLEAR").includes("SKITTERBACK") && !names(0, "D", "CLEAR").includes("SKITTERBACK"));
  assert.ok(names(3, "D", "CLEAR").includes("ANTIPODE") && !names(3, "d", "CLEAR").includes("ANTIPODE"));
  for (const w of [0, 1, 2, 3]) for (const p of ["D", "d", "u", "n"]) assert.ok(names(w, p, "CLEAR").length >= 2, `water ${w} ${p} always has something`);
  // Water keeps species apart.
  assert.ok(app.candidates(1, "d", "CLEAR").every((e) => e.sp.water === 1));
  // Legends never in the ordinary list.
  assert.ok(![0, 1, 2, 3].some((w) => app.candidates(w, "n", "STORM", 3, true).some((e) => e.sp.rar === 5)));
  // Weather boosts: fog and mudlark.
  const w = (weather, nm) => app.candidates(0, "d", weather).find((e) => e.sp.name === nm).w;
  assert.ok(w("FOG", "MUDLARK") > w("CLEAR", "MUDLARK") * 3);
  // Bait lifts rare species and leaves commons alone.
  const share = (lure, chum) => { const l = app.candidates(2, "d", "CLEAR", lure, chum); const t = l.reduce((a, e) => a + e.w, 0); return l.filter((e) => e.sp.rar >= 3).reduce((a, e) => a + e.w, 0) / t; };
  assert.ok(share(3, false) > share(0, false) * 1.8 && share(0, true) > share(0, false) * 1.2, `${share(0, false)} ${share(3, false)} ${share(0, true)}`);
  // Legends: need four of that water recorded, the right time, and (Pilgrim) the right weather.
  assert.equal(app.legendReady(0, "n", "CLEAR"), null);
  for (const s of SP.filter((x) => x.water === 0 && x.rar < 5).slice(0, 4)) app.sv.n[s.id] = 1;
  assert.equal(app.legendReady(0, "n", "CLEAR"), null, "Halo-Keeper wants dawn or dusk");
  assert.equal(app.legendReady(0, "u", "CLEAR")?.name, "THE HALO-KEEPER");
  for (const s of SP.filter((x) => x.water === 1 && x.rar < 5).slice(0, 4)) app.sv.n[s.id] = 1;
  assert.equal(app.legendReady(1, "d", "CLEAR"), null, "Pilgrim needs ash or storm");
  assert.equal(app.legendReady(1, "d", "STORM")?.name, "THE MAGMA PILGRIM");
  // Rates over many bites: legends do appear when eligible, treasure appears, and the first fish are gentle.
  const tally = { legend: 0, treasure: 0, other: 0 };
  app.sv.landed = 20;
  for (let i = 0; i < 3000; i++) { const b = app.pickBite(0, "u", "CLEAR"); if (b.treasure) tally.treasure++; else if (b.rar === 5) tally.legend++; else tally.other++; }
  assert.ok(tally.legend > 20 && tally.legend < 400 && tally.treasure > 60 && tally.treasure < 300, JSON.stringify(tally));
  const fresh = make({ seed: 5 }).app;
  for (let i = 0; i < 100; i++) { const b = fresh.pickBite(0, "n", "STORM"); assert.ok(b.rar === 1 && (b.kind === "steady" || b.kind === "sinker")); }
});

test("a landed fish: card, record, log, scrip, saving, and the first catch is a new species", () => {
  const { ctx, app } = make({ seed: 12 });
  toShore(app);
  castTo(app, 0.2);
  hookWith(app, SP[0]);
  const c = app.cur; c.meter = 0.995; c.z = 0.5; c.f = 0.5; c.zv = 0; c.tgt = 0.5; c.timer = 9;
  run(app, 0.3, null);
  assert.equal(app.phase, "card");
  assert.ok(app.card.isNew && app.card.size >= SP[0].min && app.card.size <= SP[0].max && app.card.scrip > 0);
  assert.equal(app.sv.n[0], 1);
  assert.ok(app.sv.$ > 0);
  assert.equal(ctx.calls.saved.at(-1).n[0], 1);
  assert.ok(ctx.calls.score.length && ctx.calls.score.at(-1)[0] >= 1);
  assert.ok(ctx.calls.tone.length >= 2, "fanfare");
  app.draw(fakeCanvas());
  // Second catch of the same species may be a size record.
  app.sv.m[0] = 1;
  app.sv.landed = 6;
  app.go("shore"); castTo(app, 0.2); hookWith(app, SP[0]);
  const c2 = app.cur; c2.meter = 0.995; c2.z = 0.5; c2.f = 0.5; c2.zv = 0; c2.tgt = 0.5; c2.timer = 9;
  run(app, 0.3, null);
  assert.ok(!app.card.isNew && app.card.isRecord);
});

test("the fanfare and lamp celebration grow with rarity", () => {
  const celebrate = (rar) => {
    const { ctx, app } = make({ seed: 2 });
    app.card = { rar, isNew: false, sp: SP[0], name: "X", note: "n", size: 1, scrip: 1 };
    app.go("card");
    const before = ctx.calls.tone.length;
    app.fanfare(rar, false, false);
    app.update(DT);
    run(app, 1.5, null);
    let peak = 0, changes = new Set();
    for (let i = 0; i < 120; i++) { app.update(DT); const v = ctx.calls.leds.at(-1); peak = Math.max(peak, ...v); changes.add(v.join()); }
    return { notes: app.sfx.length + (ctx.calls.tone.length - before), peak, changes: changes.size };
  };
  const r = [1, 2, 3, 4, 5].map(celebrate);
  assert.ok(r[4].notes > r[2].notes && r[2].notes > r[0].notes, JSON.stringify(r));
  for (const x of r) assert.ok(x.peak <= 255);
});

test("a full app run: a competent bot lands fish, an idle player lands nothing", () => {
  const good = play(14, 360);
  const idle = make({ seed: 14 });
  idle.app.down(); idle.app.up();
  run(idle.app, 360, null);
  assert.ok(good.app.sv.landed >= 8, "landed " + good.app.sv.landed);
  assert.ok(good.app.recorded() >= 3, "recorded " + good.app.recorded());
  assert.equal(idle.app.sv.landed, 0);
  assert.equal(idle.app.phase, "shore");
  assert.ok(good.ctx.calls.saved.length >= 8);
  assert.ok(good.ctx.calls.score.length > 0);
});

test("session structure: five casts complete a tide with a bonus and a summary", () => {
  const { app } = make({ seed: 33 });
  app.sv.landed = 9;
  toShore(app);
  let money = app.sv.$;
  for (let i = 0; i < 5; i++) {
    if (app.phase === "card") app.toShore();
    castTo(app, 0.2); tap(app); // miss the catch by never holding
    run(app, 40, null);
  }
  assert.equal(app.sv.tides, 1);
  assert.equal(app.bag.tideCasts, 0);
  assert.ok(app.card.lost);
  void money;
  const done = make({ seed: 1 }).app;
  done.card = { rar: 1, sp: SP[0], name: "X", note: "n", size: 1, scrip: 5 };
  done.bag.tideCasts = 5; done.bag.tideLanded = 5;
  done.afterCast();
  assert.equal(done.card.tide.landed, 5);
  assert.equal(done.card.tide.bonus, 100);
});

test("the gear menu: taps step, a hold chooses, purchases change the catch, and CLOSE is first", () => {
  const { ctx, app } = make({ seed: 4 });
  toShore(app);
  tap(app, 60); // a tap at the shore opens the menu
  assert.equal(app.phase, "menu");
  assert.equal(app.menuItems()[0], "close");
  app.sv.$ = 1000;
  tap(app, 60); assert.equal(app.menu.at, 1);
  app.down(); run(app, 0.7, null); app.up(); // hold: choose GEAR
  assert.equal(app.menu.mode, "gear");
  assert.equal(app.menu.at, 0, "BACK is the first gear entry");
  tap(app, 60); // ZONE
  const zoneBefore = ZONE(app);
  app.down(); run(app, 0.7, null); app.up();
  assert.equal(app.sv.g[0], 1);
  assert.equal(app.sv.$, 1000 - 70);
  assert.ok(ZONE(app) > zoneBefore, "bigger catch zone");
  assert.equal(ctx.calls.saved.at(-1).g[0], 1);
  // Too poor: nothing happens but a message.
  app.sv.$ = 5;
  app.down(); run(app, 0.7, null); app.up();
  assert.equal(app.sv.g[0], 1);
  assert.match(app.menu.lines, /NEED/);
  // Hold on BACK, then hold on CLOSE returns to the water without charging a cast.
  tap(app, 60); tap(app, 60); tap(app, 60); tap(app, 60); tap(app, 60); // wrap to BACK (index 0)
  assert.equal(app.menu.at, 0);
  app.down(); run(app, 0.7, null); app.up();
  assert.equal(app.menu.mode, "root");
  app.menu.at = 0;
  app.down(); run(app, 0.7, null);
  assert.equal(app.phase, "shore");
  run(app, 0.5, null); // still holding: must not start charging a cast
  assert.equal(app.phase, "shore");
  app.up();
  app.draw(fakeCanvas());
});
const ZONE = (app) => M.newCatch(SP[0], { zone: app.sv.g[0], reel: app.sv.g[1] }, new Random(1), false).h;

test("each gear step does what it says", () => {
  assert.ok(M.ZONE_H.every((v, i) => i === 0 || v > M.ZONE_H[i - 1]));
  assert.ok(M.REEL_MULT.every((v, i) => i === 0 || v > M.REEL_MULT[i - 1]));
  assert.ok(M.CAST_MAX.every((v, i) => i === 0 || v > M.CAST_MAX[i - 1]));
  assert.ok(M.LURE_MULT.every((v, i) => i === 0 || v > M.LURE_MULT[i - 1]));
  const fillOf = (reel) => M.newCatch(SP[0], { zone: 0, reel }, new Random(1), false).fill;
  assert.ok(fillOf(3) > fillOf(0) * 1.5);
  const { app } = make({ seed: 2 });
  app.sv.$ = 100;
  app.buyChum();
  assert.equal(app.sv.c, 5);
  assert.equal(app.sv.$, 60);
  app.finishCast(false);
  assert.equal(app.sv.c, 4);
});

test("save, reload, migration, and size late in the game", () => {
  const { ctx, app } = make({ seed: 6 });
  app.sv.n[3] = 4; app.sv.m[3] = 481; app.sv.$ = 321; app.sv.g = [1, 2, 3, 1]; app.sv.f = 5; app.sv.casts = 40; app.sv.landed = 30;
  app.persist();
  const saved = JSON.parse(JSON.stringify(ctx.calls.saved.at(-1)));
  const again = new Tideline(appContext({ progress: saved }));
  assert.deepEqual(again.sv.n, app.sv.n);
  assert.deepEqual(again.sv.m, app.sv.m);
  assert.equal(again.sv.$, 321);
  assert.deepEqual(again.sv.g, [1, 2, 3, 1]);
  assert.equal(again.sv.f, 5);
  assert.equal(again.recorded(), 1);
  assert.equal(saved.last.recorded, 1);
  // Older and strange saves are accepted safely.
  for (const raw of [undefined, null, 5, "x", [], {}, { schema: 1, runs: 3, last: { metres: 4 } }, { schema: 2, n: "bad", m: [1], g: [9, -2, "a", null], $: -5, c: 1e9, f: -1 },
    { schema: 2, n: Array(10).fill(2), m: Array(80).fill(7), $: NaN }, { schema: 99, n: [1] }]) {
    const s = M.normalizeSave(raw);
    assert.equal(s.n.length, 30); assert.equal(s.m.length, 30); assert.equal(s.g.length, 4);
    assert.ok(s.g.every((v) => v >= 0 && v <= 3) && s.$ >= 0 && s.c >= 0 && s.c <= 25 && s.f >= 0);
    for (const v of [...s.n, ...s.m, s.$]) assert.ok(Number.isInteger(v));
    new Tideline(appContext({ progress: raw ?? {} }));
  }
  assert.equal(M.normalizeSave({ schema: 1, runs: 3 }).runs, 3);
  assert.equal(M.normalizeSave({ schema: 2, n: Array(10).fill(2) }).n[20], 0, "a short list is padded");
  // The late game: everything caught many times, everything bought, huge sizes.
  const late = new Tideline(appContext());
  late.sv.n.fill(9999); late.sv.m.fill(99999); late.sv.$ = 99999; late.sv.g = [3, 3, 3, 3]; late.sv.f = 63; late.sv.casts = 999999; late.sv.landed = 999999; late.sv.tides = 99999; late.sv.runs = 99999;
  late.persist();
  const size = JSON.stringify(late.c.calls.saved.at(-1)).length;
  assert.ok(size < 1500, "late game save is " + size + " bytes");
  assert.ok(size < 8192);
});

test("a simulated player: how long the catalogue takes, with upgrades bought as they become affordable", () => {
  const rows = [];
  const rng = new Random(2026);
  const { app } = make({ seed: 77 });
  const skill = (s) => makeCatchBot(8, 0.04, 5, s);
  let casts = 0, seconds = 0, hourClock = 8, milestone80 = 0, session = 0, sessionSeconds = 0;
  const buy = () => {
    const order = [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3];
    for (const i of order) { const cost = app.nextCost(i); if (cost != null && app.sv.$ >= cost && !(i === 3 && app.sv.g[2] < 1)) { app.sv.$ -= cost; app.sv.g[i]++; } }
  };
  while (app.recorded() < 30 && casts < 6000) {
    const per = hourClock;
    app.nowHour = () => per;
    // The player fishes the reachable water with the most species still missing right now.
    let water = 0, bestN = -1;
    for (let w = 0; w <= app.waterAt(app.castMax()); w++) {
      const missing = app.candidates(w, app.period(), app.weather).filter((e) => app.sv.n[e.sp.id] === 0).length + (app.legendReady(w, app.period(), app.weather) && app.sv.n[app.legendFor(w).id] === 0 ? 2 : 0) + rng.next() * 0.5;
      if (missing > bestN) { bestN = missing; water = w; }
    }
    app.dist = water ? [0, 33, 60, 85][water] : 20; app.water = water;
    const sp = app.pickBite(water, app.period(), app.weather);
    app.fishSp = sp;
    const gear = { zone: app.sv.g[0], reel: app.sv.g[1] };
    const out = modelCatch(sp, gear, casts + 1000, skill(casts + 5), app.beginner());
    seconds += 3.3 + 0.8 + out.seconds + 3;
    sessionSeconds += 3.3 + 0.8 + out.seconds + 3;
    casts++;
    if (out.r === 1) app.land(); else app.finishCast(false);
    app.go("shore");
    app.bag.tideCasts = 0;
    buy();
    // Sessions of about ten minutes, at a different time of day each time.
    if (sessionSeconds > 600) { sessionSeconds = 0; session++; hourClock = [6, 9, 12, 15, 18, 20, 22, 2][session % 8]; }
    if (!milestone80 && app.recorded() >= 24) milestone80 = seconds / 60;
  }
  rows.push(`recorded ${app.recorded()}/30 after ${casts} casts, about ${(seconds / 60).toFixed(0)} minutes of play over ${session + 1} ten-minute visits (24 of 30 at ${milestone80.toFixed(0)} min); gear ${app.sv.g.join("/")}, scrip ${app.sv.$}`);
  console.log(rows.join("\n"));
  assert.ok(app.recorded() >= 29, "a skilled, patient player completes (nearly) the whole catalogue: " + app.recorded());
  assert.ok(seconds / 60 > 45, "not finished in under three quarters of an hour: " + seconds / 60);
  assert.ok(milestone80 > 15, "the first 24 take real time: " + milestone80);
  void rng;
});

test("three quick taps, four, or two-taps-and-a-hold then cancel never lose a hooked fish", () => {
  const trial = (inputs) => {
    const { ctx, app } = make({ seed: 18 });
    app.sv.landed = 10;
    toShore(app);
    castTo(app, 0.25);
    hookWith(app, byName("MUDLARK"));
    app.cur.meter = 0.25; app.cur.grace = 0;
    inputs(app);
    return app;
  };
  const taps = (n, gap = 90) => (app) => { for (let i = 0; i < n; i++) { app.down(); run(app, 0.07, null); app.up({ durationMs: 70 }); run(app, gap / 1000, null); } };
  for (const n of [3, 4]) {
    const app = trial((a) => { taps(n)(a); a.cancel(); });
    assert.equal(app.phase, "catch", n + " taps then cancel keeps the catch");
    assert.equal(app.sv.landed, 10);
  }
  // Two quick taps, then a hold of about a second (the new gesture), then cancel.
  const app = trial((a) => { taps(2)(a); a.down(); run(a, 1.05, null); a.cancel(); });
  assert.equal(app.phase, "catch", "the new gesture does not lose the fish");
  assert.ok(app.cur.meter > 0, "meter " + app.cur.meter);
  // Pause (the menu opened) and resume: a second of grace.
  app.pause(); app.resume();
  assert.ok(app.cur.grace >= 1.4);
  run(app, 1.2, null);
  assert.equal(app.phase, "catch");
  // And shield cannot be farmed: tapping nonstop does not make the line immortal.
  const farm = trial((a) => { a.cur.meter = 0.3; a.cur.f = 0.9; a.cur.tgt = 0.9; });
  let alive = true;
  for (let i = 0; i < 60 * 20 && alive; i++) {
    if (i % 12 === 0) { farm.down(); } if (i % 12 === 6) farm.up({ durationMs: 100 });
    farm.cur && (farm.cur.f = 0.92, farm.cur.tgt = 0.92, farm.cur.fv = 0);
    farm.update(DT);
    alive = farm.phase === "catch";
  }
  assert.ok(!alive, "constant tapping with the fish far away still loses it eventually");
});

test("cancel and dispose leave the lamps off and tones stopped at any moment", () => {
  for (const when of ["title", "shore", "charge", "wait", "bite", "catch", "card", "menu"]) {
    const { ctx, app } = make({ seed: 19 });
    let stops = 0;
    ctx.synth.stopTone = () => { stops++; };
    app.sv.landed = 5;
    if (when !== "title") toShore(app);
    if (when === "charge") { app.down(); run(app, 0.6, null); }
    if (when === "wait") { app.down(); run(app, 0.4, null); app.up(); run(app, 0.8, null); }
    if (when === "bite" || when === "catch" || when === "card") { castTo(app, 0.2); }
    if (when === "catch") { hookWith(app, SP[0]); run(app, 0.5, null); }
    if (when === "card") { app.escapedFish(); }
    if (when === "menu") { tap(app, 60); }
    assert.equal(app.phase, when, when);
    app.cancel();
    assert.deepEqual(ctx.calls.leds.at(-1), OFF, "cancel " + when);
    run(app, 0.3, null);
    app.dispose();
    assert.deepEqual(ctx.calls.leds.at(-1), OFF, "dispose " + when);
    assert.ok(!app.held);
    app.draw(fakeCanvas());
  }
});

test("lamps are nine whole bytes, moderate for sustained light, and change during play", () => {
  const { ctx } = play(23, 240);
  const seen = new Set();
  let peak = 0;
  const sustained = [];
  for (const v of ctx.calls.leds) {
    assert.equal(v.length, 9);
    for (const x of v) { assert.ok(Number.isInteger(x) && x >= 0 && x <= 255, String(v)); peak = Math.max(peak, x); }
    seen.add(v.join());
    sustained.push(Math.max(...v));
  }
  assert.ok(seen.size > 60, "lamps vary: " + seen.size);
  assert.ok(peak > 150, "accents reach high: " + peak);
  sustained.sort((a, b) => a - b);
  assert.ok(sustained[Math.floor(sustained.length * 0.9)] <= 140, "90% of frames at or below about half: " + sustained[Math.floor(sustained.length * 0.9)]);
});

test("every state draws, lists stay bounded, no NaN, and play stays within the primitive budget", () => {
  const { app } = make({ seed: 24 });
  app.sv.landed = 5;
  app.sv.n.fill(1); app.sv.f = 63;
  const g = fakeCanvas();
  const prims = () => Object.values(g.count).reduce((a, b) => a + b, 0);
  const worst = {};
  const measure = (name) => { for (const k of Object.keys(g.count)) delete g.count[k]; app.draw(g); worst[name] = Math.max(worst[name] || 0, prims()); };
  measure("title");
  tap(app); measure("shore");
  app.down(); run(app, 1, null); measure("charge");
  app.up(); run(app, 0.3, null); measure("cast");
  run(app, 0.6, null); measure("wait");
  for (const weather of ["CLEAR", "FOG", "ASH-FALL", "STORM"]) { app.weather = weather; measure("scene " + weather); }
  let guard = 0;
  while (app.phase === "wait" && guard++ < 600) run(app, DT, null);
  measure("bite");
  for (const sp of SP) {
    hookWith(app, sp);
    run(app, 0.4, null);
    measure("catch");
    for (const k of ["z", "zv", "f", "fv", "meter"]) assert.ok(Number.isFinite(app.cur[k]), k);
    app.cur.meter = 0.999; app.cur.f = app.cur.z;
    run(app, 0.2, null);
    app.up();
    measure("card");
    app.go("shore");
    app.phase = "bite"; app.phaseT = 0; app.biteFor = 1;
  }
  app.escapedFish(); measure("lost card");
  app.openMenu(); measure("menu");
  app.menu.mode = "gear"; measure("gear");
  app.menu.mode = "log"; for (let i = 0; i < 32; i++) { app.menu.at = i; measure("log"); }
  for (const k of ["catch", "card", "wait", "shore", "title", "charge", "bite"]) assert.ok(worst[k] < 400, `${k} primitives ${worst[k]}`);
  assert.ok(app.sfx.length <= 24);
  console.log("primitives per frame:", JSON.stringify(worst));
});

test("the log shows progress and honest hints for unrecorded species", () => {
  const { app } = make({ seed: 25 });
  const hint = app.hintFor(byName("THE LANTERN QUEEN"));
  assert.match(hint, /LANTERN DEEP|BEYOND/);
  assert.match(app.hintFor(byName("BLIND MOON-EEL")), /NIGHT/);
  assert.match(app.hintFor(byName("MUDLARK")), /FOG/);
  app.sv.g[2] = 3;
  assert.match(app.hintFor(byName("ICE WRAITH")), /UNDERLIGHT/);
  assert.equal(app.recorded(), 0);
  assert.equal(app.catScore(), 0);
  app.sv.n[0] = 1; app.sv.n[7] = 1; app.sv.f = 3;
  assert.equal(app.recorded(), 2);
  assert.equal(app.catScore(), 1 + 15 + 4);
});

test("a treasure is not a fish: it pays scrip and fills a find slot", () => {
  const { app } = make({ seed: 26 });
  app.sv.landed = 9;
  toShore(app);
  castTo(app, 0.2);
  app.fishSp = { treasure: true, item: 2, name: "BRASS ASTROLABE", kind: "steady", d: 0.3, rar: 3, shape: { t: "box", len: 1, hgt: 1, x: "" } };
  app.down(); assert.equal(app.phase, "catch");
  const c = app.cur; c.meter = 0.999; c.f = c.z;
  run(app, 0.2, null);
  assert.equal(app.phase, "card");
  assert.ok(app.card.treasure && app.card.isNew && app.sv.f === 4 && app.sv.$ >= 75);
  assert.equal(app.recorded(), 0);
  app.draw(fakeCanvas());
});

test("weather changes over casts and the pause/resume path is safe", () => {
  const { app } = make({ seed: 27 });
  const seen = new Set([app.weather]);
  for (let i = 0; i < 80; i++) { app.finishCast(false); seen.add(app.weather); }
  assert.ok(seen.size >= 3, [...seen].join());
  app.pause(); app.resume(); app.cancel(); app.dispose();
});

// ---- schema 3: stars, perfect catches, rank, notice board, chests, rests ---------------------
// A save exactly as the schema 2 game (before stars and ranks) wrote it, after an evening of play.
const SCHEMA2_SAVE = {
  schema: 2, runs: 6, last: { recorded: 9, score: 15, landed: 41, tides: 9 }, milestone: 9,
  n: [7, 5, 3, 2, 1, 0, 0, 0, 6, 4, 2, 0, 0, 0, 0, 3, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  m: [331, 254, 171, 498, 412, 0, 0, 0, 197, 441, 655, 0, 0, 0, 0, 133, 402, 701, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  $: 214, g: [1, 1, 1, 0], c: 2, f: 1, casts: 47, landed: 41, tides: 9,
};
const land = (app, sp, { perfect = true, chest = false } = {}) => {
  app.go("shore"); app.phase = "bite"; app.phaseT = 0; app.biteFor = 1; app.fishSp = sp;
  app.down();
  const c = app.cur;
  c.meter = 0.995; c.z = 0.5; c.f = 0.5; c.zv = 0; c.tgt = 0.5; c.timer = 9;
  c.out = perfect ? 0 : 1;
  if (chest) c.chest = { at: 0, y: 0.5, y0: 0.5, p: 1, on: true, got: true, gone: false, ph: 0, heard: true };
  run(app, 0.2, null);
  app.up();
  assert.equal(app.phase, "card");
  return app.card;
};

test("a schema 2 save migrates: catches, gear and scrip kept, one star each, rank from the past", () => {
  const { ctx, app } = make({ seed: 40, progress: JSON.parse(JSON.stringify(SCHEMA2_SAVE)) });
  const sv = app.sv;
  assert.equal(sv.schema, 3);
  assert.deepEqual(sv.n, SCHEMA2_SAVE.n);
  assert.deepEqual(sv.m, SCHEMA2_SAVE.m);
  assert.equal(sv.$, 214); assert.deepEqual(sv.g, [1, 1, 1, 0]); assert.equal(sv.c, 2); assert.equal(sv.f, 1);
  assert.equal(sv.landed, 41); assert.equal(sv.tides, 9); assert.equal(sv.runs, 6);
  assert.deepEqual(sv.q, SCHEMA2_SAVE.n.map((v) => (v > 0 ? 1 : 0)));
  assert.ok(sv.xp > 0 && app.rank() >= 3, "an evening of play counts: xp " + sv.xp + " rank " + app.rank());
  assert.equal(sv.b.length, 3, "the board is up for a migrated player");
  assert.equal(app.catScore(), (() => { let s = 0; for (const sp of SP) if (sv.n[sp.id]) s += [0, 1, 2, 4, 7, 15][sp.rar]; return s + 2; })(), "the score is unchanged by migration");
  // Round trip through the new format.
  app.persist();
  const saved = JSON.parse(JSON.stringify(ctx.calls.saved.at(-1)));
  assert.equal(saved.schema, 3);
  const again = new Tideline(appContext({ progress: saved }));
  for (const k of ["n", "m", "q", "g", "b"]) assert.deepEqual(again.sv[k], sv[k], k);
  for (const k of ["$", "xp", "r", "pf", "ch", "bn", "landed"]) assert.equal(again.sv[k], sv[k], k);
  // Junk in the new fields is cleaned.
  const odd = M.normalizeSave({ ...saved, q: [9, -1, "x"], xp: -4, r: 99, b: [{ k: "zz" }, { k: "sp", s: 7 }, { k: "sp", s: 20, n: 50, p: 70 }, 4, null], pf: NaN });
  assert.ok(odd.q.every((v, i) => v >= 0 && v <= 3 && (sv.n[i] > 0) === (v > 0)));
  assert.equal(odd.xp, 0); assert.equal(odd.r, M.REST_MAX); assert.equal(odd.pf, 0);
  assert.equal(odd.b.length, 1, "the legend (species 7) and an unknown kind are dropped, a wild count is clamped: " + JSON.stringify(odd.b));
  assert.ok(odd.b[0].p <= odd.b[0].n && odd.b[0].n <= 9);
});

test("perfect catches and stars: kept in the zone is perfect, gold needs perfect and size", () => {
  assert.equal(M.qualityOf(true, 0.7), 3);
  assert.equal(M.qualityOf(true, 0.3), 2);
  assert.equal(M.qualityOf(false, 0.9), 2);
  assert.equal(M.qualityOf(false, 0.5), 1);
  // In the model: an idle zone with a still fish in it stays perfect; a fish left alone outside does not.
  const rng = new Random(3);
  const c = M.newCatch(SP[0], { zone: 0, reel: 0 }, rng, false);
  c.f = c.z = 0.5; c.kind = "none";
  assert.ok(M.perfectCatch(c));
  for (let i = 0; i < 60; i++) M.stepCatch(c, false, rng, DT);
  assert.ok(!M.perfectCatch(c) && c.out > 0.25, "drifted out for " + c.out);
  // In the app: the card shows stars, the log keeps the best, perfect pays more.
  const { app } = make({ seed: 41 });
  app.sv.landed = 5;
  const plain = land(app, SP[0], { perfect: false });
  const clean = land(app, SP[0], { perfect: true });
  assert.ok(!plain.perfect && clean.perfect && clean.q >= 2, JSON.stringify([plain.q, clean.q]));
  assert.equal(app.sv.q[0], Math.max(plain.q, clean.q));
  assert.equal(app.sv.pf, 1);
  let golds = 0;
  for (let i = 0; i < 40; i++) if (land(app, SP[1], { perfect: true }).q === 3) golds++;
  assert.ok(golds > 5 && golds < 40, "gold also needs a good size: " + golds + "/40");
  assert.equal(app.sv.q[1], 3);
  app.draw(fakeCanvas());
  app.openMenu(); app.menu.mode = "log"; app.draw(fakeCanvas());
});

test("angler rank: experience from landings, ranks open the board, chests and rests in turn", () => {
  assert.equal(M.rankOf(0), 1);
  assert.equal(M.rankOf(M.RANK_XP[1]), 2);
  assert.equal(M.rankOf(1e9), 10);
  const { app } = make({ seed: 42 });
  assert.equal(app.rank(), 1);
  assert.equal(app.sv.b.length, 0, "no board for a new player");
  assert.deepEqual(app.menuItems(), ["close", "gear", "log"], "a new player sees the old menu");
  assert.equal(app.chestChance(), 0);
  let ups = [];
  for (let i = 0; i < 80 && app.rank() < 4; i++) { const k = land(app, SP[i % 3], { perfect: i % 2 === 0 }); if (k.rankUp) ups.push(k.rankUp); app.draw(fakeCanvas()); }
  assert.deepEqual(ups.slice(0, 3), [2, 3, 4], "ranks are announced on the card");
  assert.ok(app.rank() >= 4);
  assert.equal(app.sv.b.length, 3, "the board went up at rank 2");
  assert.deepEqual(app.menuItems(), ["close", "board", "gear", "log", "rest"]);
  app.sv.landed = 9;
  assert.ok(app.chestChance() > 0.1);
  const fill = (rank) => M.newCatch(SP[0], { zone: 0, reel: 0, rank }, new Random(1), false).fill;
  assert.ok(fill(9) > fill(1) * 1.1, "rank strengthens the reel a little");
});

test("the notice board: notices in reach, progress on landings, paid when done, replaced at the tide", () => {
  const { app } = make({ seed: 43 });
  app.sv.xp = M.RANK_XP[1];
  app.fillBoard();
  const b = app.sv.b;
  assert.equal(b.length, 3);
  for (const nt of b) {
    assert.ok(app.noticeText(nt).length > 6);
    if (nt.k === "sp" || nt.k === "sz") { assert.ok(SP[nt.s].water <= app.reachWater() && SP[nt.s].rar <= 3, JSON.stringify(nt)); }
    if (nt.k === "wt") assert.ok(nt.s <= app.reachWater());
    assert.ok(nt.$ > 0 && nt.n >= 1);
  }
  // Many boards: every kind turns up, never a duplicate on one board.
  const kinds = new Set();
  app.sv.n.fill(1); // size notices are only for species already in the log
  for (let i = 0; i < 60; i++) { app.sv.b = []; app.sv.xp = M.RANK_XP[3]; app.fillBoard(); for (const nt of app.sv.b) kinds.add(nt.k); assert.equal(new Set(app.sv.b.map((x) => x.k + x.s)).size, app.sv.b.length); }
  assert.deepEqual([...kinds].sort(), ["ch", "pf", "sp", "sz", "wt"]);
  // Complete a species notice.
  app.sv.b = [{ k: "sp", s: 1, n: 2, p: 0, x: 0, $: 80, d: 0 }, { k: "wt", s: 0, n: 3, p: 1, x: 0, $: 60, d: 0 }, { k: "ch", s: 0, n: 1, p: 0, x: 0, $: 90, d: 0 }];
  app.sv.landed = 9;
  land(app, SP[1]);
  assert.equal(app.sv.b[0].p, 1);
  const money = app.sv.$;
  const card = land(app, SP[1]);
  assert.equal(card.notices.length, 2, "the species notice and the water notice finish together");
  assert.ok(app.sv.$ >= money + 80 + 60);
  assert.equal(app.sv.bn, 2);
  const chestCard = land(app, SP[2], { chest: true });
  assert.ok(chestCard.chest && chestCard.chest.scrip > 0 && app.sv.ch === 1);
  assert.ok(chestCard.notices.some((nt) => nt.k === "ch"));
  app.draw(fakeCanvas());
  // The tide ends: done notices come down and new ones go up.
  app.bag.tideCasts = 4; land(app, SP[0]);
  assert.equal(app.sv.b.length, 3);
  assert.ok(app.sv.b.every((nt) => !nt.d));
  app.openMenu(); app.menu.at = app.menuItems().indexOf("board"); app.menuChoose();
  assert.equal(app.menu.mode, "board");
  app.draw(fakeCanvas());
  app.menuChoose();
  assert.equal(app.menu.mode, "root");
});

test("salvage chests: appear during the catch, fill only inside the zone, sink away if ignored", () => {
  const rng = new Random(9);
  const c = M.newCatch(SP[0], { zone: 0, reel: 0, chest: true }, rng, false);
  assert.ok(c.chest && c.chest.at >= 1.2 && c.chest.at <= 3.5);
  c.kind = "none";
  // Hold the zone on the chest: it is salvaged within a few seconds of appearing.
  let got = false;
  for (let i = 0; i < 60 * 8 && !got; i++) { c.z = c.chest.on ? c.chest.y : 0.5; c.f = c.z; M.stepCatch(c, false, rng, DT); got = c.chest.got; c.meter = 0.5; }
  assert.ok(got);
  // Ignore it: it decays and sinks.
  const d = M.newCatch(SP[0], { zone: 0, reel: 0, chest: true }, rng, false);
  d.chest.y = 0.85;
  for (let i = 0; i < 60 * 15; i++) { d.z = 0.2; d.zv = 0; d.f = 0.2; d.meter = 0.5; M.stepChest(d, DT); d.t += DT; }
  assert.ok(d.chest.gone && !d.chest.got && d.chest.p === 0);
  // In the app: no chest below rank 3; at rank 3, about one catch in seven or eight has one.
  const { app } = make({ seed: 44 });
  app.sv.landed = 9; app.sv.xp = M.RANK_XP[2];
  let seen = 0;
  for (let i = 0; i < 300; i++) { app.go("shore"); app.phase = "bite"; app.phaseT = 0; app.biteFor = 1; app.fishSp = SP[0]; app.down(); if (app.cur.chest) seen++; app.up(); app.cancel(); }
  assert.ok(seen > 20 && seen < 70, "chests " + seen + "/300");
  // A chest on screen draws; losing the fish loses the chest.
  const fresh = make({ seed: 48 }).app;
  fresh.sv.landed = 9; fresh.sv.xp = M.RANK_XP[2];
  hookWith(fresh, SP[0]);
  fresh.cur.chest = { at: 0, y: 0.5, y0: 0.5, p: 0.5, on: true, got: false, gone: false, ph: 0 };
  fresh.draw(fakeCanvas());
  fresh.cur.meter = 0.001; fresh.cur.f = 0.9; fresh.cur.z = 0.1; fresh.cur.grace = 0;
  run(fresh, 0.2, null);
  assert.ok(fresh.card.lost && !fresh.card.chest);
});

test("rests: earned one per tide from rank 4, at most three, each moves the sky on", () => {
  const { app } = make({ seed: 45 }, 10);
  app.sv.landed = 9;
  app.sv.r = 0;
  for (let i = 0; i < 5; i++) app.finishCast(false), app.afterCast();
  assert.equal(app.sv.r, 0, "below rank 4 a tide earns no rest");
  app.sv.xp = M.RANK_XP[3];
  for (let t = 0; t < 4; t++) for (let i = 0; i < 5; i++) app.finishCast(false), app.afterCast();
  assert.equal(app.sv.r, M.REST_MAX);
  assert.equal(app.period(), "d");
  app.openMenu(); app.menu.at = app.menuItems().indexOf("rest"); app.menuChoose();
  assert.equal(app.period(), "u", "rested from day to dusk");
  assert.equal(app.sv.r, M.REST_MAX - 1);
  assert.ok(app.rest() && app.rest());
  assert.equal(app.period(), "D", "dusk, night, then dawn");
  assert.ok(!app.rest(), "no rests left");
  app.draw(fakeCanvas());
  // Night fish can now be hooked by a daytime player.
  assert.ok(app.candidates(1, "n", "CLEAR").some((e) => e.sp.name === "KILN EEL"));
});

test("the reel clicks with short tones while the fish is in the zone; no sustained tone is used", () => {
  const { ctx, app } = make({ seed: 46 });
  let started = 0;
  ctx.synth.startTone = () => { started++; };
  app.sv.landed = 9;
  toShore(app); castTo(app, 0.2); hookWith(app, SP[0]);
  const c = app.cur; c.kind = "none";
  const before = ctx.calls.tone.length;
  for (let i = 0; i < 60; i++) { c.f = c.z; app.update(DT); }
  const clicks = ctx.calls.tone.slice(before).filter((t) => t[1] < 0.05);
  assert.ok(clicks.length >= 3 && clicks.length <= 9, "clicks in one second: " + clicks.length);
  assert.equal(started, 0);
});

test("a competent bot's first hour: ranks climb, the board pays, perfect catches happen", () => {
  // The bot lands a fish every 15 s or so, faster than a person; with mid gear it is sometimes perfect.
  const { app } = play(47, 3600, { power: 0.3, setup: (a) => { a.sv.g = [2, 2, 0, 0]; } });
  const sv = app.sv;
  console.log(`one hour: rank ${app.rank()} (xp ${sv.xp}), landed ${sv.landed}, perfect ${sv.pf}, notices ${sv.bn}, chests ${sv.ch}, stars ${app.starsTotal()}, scrip ${sv.$}`);
  assert.ok(app.rank() >= 5, "rank " + app.rank());
  assert.ok(sv.pf > 5, "perfect " + sv.pf);
  assert.ok(app.rank() < 10, "rank 10 is not reached in an hour");
});

test("the learning curve: help tapers over the first forty fish instead of ending after three", () => {
  const { app } = make({ seed: 50 });
  const rate = (landed, rar, lag) => {
    app.sv.landed = landed;
    let w = 0, n = 0;
    for (const sp of SP.filter((s) => s.rar === rar)) for (let s = 0; s < 8; s++) {
      const out = modelCatch(sp, { zone: 0, reel: 0 }, 900 + s, makeCatchBot(lag, 0.06, 5, s), app.assist());
      n++; if (out.r === 1) w++;
    }
    return w / n;
  };
  const pct = (x) => Math.round(x * 100) + "%";
  const rows = [0, 5, 10, 20, 40, 100].map((l) => { const r = [1, 2, 3].map((rar) => pct(rate(l, rar, 11))); return [l, app.assist().toFixed(2), ...r]; });
  console.log("landed / assist / common / uncommon / rare (slow-reacting bot, no gear):", JSON.stringify(rows));
  assert.ok(app.assist() >= 0.25 && app.learning() === 0);
  for (const l of [0, 10, 20]) assert.ok(rate(l, 1, 11) >= 0.9 && rate(l, 2, 11) >= 0.8, "a learner keeps landing at " + l);
  assert.ok(rate(100, 1, 11) >= 0.8, "commons stay landable without gear");
  assert.ok(rate(100, 3, 11) < 0.6, "rare fish still need skill or gear");
});

test("today's catch: one species a day in reach, bites more, pays double, first one pays a bonus once", () => {
  const { app } = make({ seed: 61 });
  app.sv.landed = 50;
  app.today = () => 20261001;
  const d = app.daily();
  assert.ok(d && !d.treasure && d.rar <= 4 && app.reachWater() >= d.water, "today's species is catchable: " + d.name);
  assert.equal(app.daily(), d, "same species all day");
  const days = new Set();
  for (let k = 0; k < 30; k++) { app.today = () => 20261001 + k; days.add(app.daily().id); }
  assert.ok(days.size >= 3, "it changes from day to day: " + days.size);
  app.today = () => 20261001;
  const other = SP.find((s) => !s.treasure && s.rar === d.rar && s.id !== d.id) || SP.find((s) => !s.treasure && s.id !== d.id);
  const first = land(app, d);
  assert.ok(first.daily && first.dailyBonus === 60 + 20 * d.rar, "first daily pays a bonus");
  assert.equal(app.sv.dy, 20261001);
  assert.ok(app.dailyDone());
  const again = land(app, d);
  assert.ok(again.daily && again.dailyBonus === 0, "bonus once a day");
  const plain = land(app, other);
  assert.ok(!plain.daily);
  // The day rolls over: the bonus is available again and the save keeps the day.
  const back = M.normalizeSave(JSON.parse(JSON.stringify(app.sv)));
  assert.equal(back.dy, 20261001);
  app.today = () => 20261002;
  assert.ok(!app.dailyDone());
  app.draw(fakeCanvas());
});
