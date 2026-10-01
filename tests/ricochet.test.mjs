import test from "node:test";
import assert from "node:assert/strict";
import { Ricochet } from "../web/apps/ricochet.js";
import { appContext, fakeCanvas, run } from "./helpers/app-context.mjs";

const G = Ricochet.GEOM;
const lampsOk = (ctx) => ctx.calls.leds.every((v) => v.length === 9 && v.every((x) => Number.isInteger(x) && x >= 0 && x <= 255));
const dark = (v) => v.every((x) => x === 0);
const fresh = (seed = 11) => { const ctx = appContext({ seed }); const app = new Ricochet(ctx); return { ctx, app }; };

// Frame-exact copy of the paddle's motion if the button goes down at frame `flipAt`
// (reversing it). Returns the worst distance from `tx` over the few frames around
// `frames` (the ball's arrival), so a plan has to be robust to a frame or two.
function simPad(app, frames, flipAt, tx) {
  const lo = G.L + app.padW / 2, hi = G.R - app.padW / 2, v0 = Ricochet.padSpeed(app.chamber) / 60;
  let x = app.px, dir = app.dir, worst = 0;
  for (let f = 0; f < frames + 4; f++) {
    if (f === flipAt) dir = -dir;
    x += dir * v0;
    if (x <= lo) { x = lo; dir = 1; } else if (x >= hi) { x = hi; dir = -1; }
    if (f >= frames - 4) worst = Math.max(worst, Math.abs(x - tx));
  }
  return worst;
}

// A bot that reads the landing prediction (what the on-screen bracket shows). It scans
// for the moment to reverse that puts the paddle under the target, with a reaction
// latency (frames) and a fixed aiming error per ball. One tap is its only verb.
function makeBot({ latency = 5, aim = 18, seed = 3 } = {}) {
  let s = seed >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  let pend = -1, lastTap = -99, bias = 0, biasFor = null;
  return (app, frame) => {
    if (app.phase !== "play") return;
    if (pend >= 0 && frame >= pend) { app.down(); app.up(); pend = -1; lastTap = frame; }
    if (app.sub !== "live" || pend >= 0 || frame - lastTap < 10 || frame % 3) return;
    let b = null;
    for (const c of app.balls) if (c.pred !== null && (!b || app.eta(c) < app.eta(b))) b = c;
    if (!b) return;
    if (biasFor !== b) { biasFor = b; bias = (rnd() * 2 - 1) * aim; }
    const T = Math.round(app.eta(b) * 60);
    const tx = Math.max(G.L + app.padW / 2, Math.min(G.R - app.padW / 2, b.pred + bias));
    if (T < latency + 3 || T > 150) return;
    const keep = simPad(app, T, 1e9, tx);
    if (keep < 20) return;
    let best = { e: keep - 6, at: -1 };
    for (let at = latency; at < T; at += 2) {
      const e = simPad(app, T, at, tx);
      if (e < best.e - 1e-9) best = { e, at };
    }
    if (best.at >= 0 && best.at <= latency + 3) pend = frame + latency;
  };
}

// Run until the ball is in play, then put it safely high in the chamber.
function toLive(app) {
  while (app.sub !== "live") run(app, 0.05);
  const b = app.balls[0];
  b.x = 480; b.y = 250; b.vx = 50; b.vy = -300; b.dirty = true;
}

// Play one run and return the app. `bot` null means never press.
function playRun({ seed = 11, seconds = 300, bot = null, stopOnOver = true } = {}) {
  const { ctx, app } = fresh(seed);
  app.down();
  run(app, seconds, (i) => { if (bot) bot(app, i); });
  return { ctx, app };
}

test("a seeded bot beats a player who never presses by a wide margin", () => {
  const bot = playRun({ bot: makeBot(), seconds: 360 });
  const idle = playRun({ bot: null, seconds: 360 });
  assert.equal(idle.app.phase, "over");
  assert.ok(bot.app.score > idle.app.score * 5 + 500, `bot ${bot.app.score} idle ${idle.app.score}`);
  assert.ok(bot.app.chamber >= 3, "chamber " + bot.app.chamber);
  console.log(`bot (tap only): phase ${bot.app.phase} score ${bot.app.score} chamber ${bot.app.chamber} cells ${bot.app.cellsBroken} lives ${bot.app.lives} chain x${bot.app.bestChain}`);
  console.log(`idle: score ${idle.app.score} chamber ${idle.app.chamber} cells ${idle.app.cellsBroken}`);
});

test("a sloppy bot still does better than nothing and eventually loses", () => {
  const sloppy = playRun({ bot: makeBot({ latency: 14, aim: 60, seed: 9 }), seconds: 360 });
  const idle = playRun({ bot: null, seconds: 360 });
  console.log(`sloppy bot (230 ms latency, +-60 px aim): phase ${sloppy.app.phase} score ${sloppy.app.score} chamber ${sloppy.app.chamber} lives ${sloppy.app.lives}`);
  assert.ok(sloppy.app.score > idle.app.score);
});

test("several seeds: the tap bot is competent, the idle player is not", () => {
  const out = [];
  for (const seed of [1, 2, 3, 4, 5]) {
    const bot = playRun({ seed, bot: makeBot({ seed }), seconds: 240 });
    const idle = playRun({ seed, bot: null, seconds: 240 });
    out.push(`seed ${seed}: bot ${bot.app.score}/ch${bot.app.chamber}/${bot.app.phase}  idle ${idle.app.score}/ch${idle.app.chamber}`);
    assert.ok(bot.app.score > idle.app.score, out[out.length - 1]);
  }
  console.log(out.join("\n"));
});

test("a run ends in a loss, saves once, and restarts after a pause", () => {
  const { ctx, app } = fresh(11);
  app.down();
  for (let i = 0; i < 400 * 60 && app.phase === "play"; i++) app.update(1 / 60);
  assert.equal(app.phase, "over");
  assert.equal(app.lives, 0);
  assert.equal(ctx.calls.score.length, 1);
  assert.equal(ctx.calls.saved.length, 1);
  assert.deepEqual(Object.keys(ctx.calls.saved[0].last).sort(), ["cells", "chain", "chamber", "milestone", "score"]);
  app.down();
  assert.equal(app.phase, "over", "too soon after the end");
  run(app, 1);
  app.down();
  assert.equal(app.phase, "play");
  assert.equal(app.lives, 3);
  assert.equal(app.score, 0);
  app.draw(fakeCanvas());
});

// Drive the physics directly with a ball at the highest speed, from many angles.
test("at maximum speed the ball never tunnels through a cell, the paddle or a wall", () => {
  const { app } = fresh(4);
  app.down();
  for (const chamber of [1, 3, 6, 9]) {
    app.setupChamber(chamber);
    run(app, 1.4); // serve -> live
    assert.equal(app.sub, "live");
    app.gain = 60;
    app.chamber = 20; // beyond every cap: speed is MAX_SPEED
    for (let k = 0; k < 40; k++) {
      const a = (k / 40) * Math.PI * 2 + 0.05;
      const b = app.balls[0] || (app.sub === "live" && app.balls[0]);
      if (!b) break;
      b.x = 480 + 200 * Math.cos(k); b.y = 300 + 60 * Math.sin(k);
      const s = app.speedNow();
      assert.equal(s, G.MAX_SPEED);
      b.vx = s * Math.sin(a); b.vy = -s * Math.cos(a);
      let prev = null;
      for (let i = 0; i < 240 && app.balls[0] === b; i++) {
        // Before the step the ball sits in free space; after it, never inside a cell or outside a wall.
        app.update(1 / 60);
        if (app.sub !== "live" || app.balls[0] !== b) break;
        assert.ok(b.x >= G.L + G.BALL_R - 1e-6 && b.x <= G.R - G.BALL_R + 1e-6, "x escaped " + b.x);
        assert.ok(b.y >= G.TOP + G.BALL_R - 1e-6, "y escaped " + b.y);
        assert.ok(b.y < G.LOST_Y + 20);
        for (let r = 0; r < app.rows; r++) for (let c = 0; c < G.COLS; c++) {
          if (!app.cells[r * G.COLS + c]) continue;
          const x0 = G.L + c * G.CW, y0 = G.GY + r * G.RH;
          const dx = b.x - Math.max(x0, Math.min(b.x, x0 + G.CW)), dy = b.y - Math.max(y0, Math.min(b.y, y0 + G.RH));
          assert.ok(dx * dx + dy * dy >= (G.BALL_R - 0.5) ** 2, "ball inside a cell");
        }
        // Never passes the paddle line without either meeting the paddle or being lost.
        if (prev !== null && prev + G.BALL_R <= G.PAD_Y && b.y + G.BALL_R > G.PAD_Y + 12 && b.vy > 0) {
          assert.ok(Math.abs(b.x - app.px) > app.padW / 2 + G.BALL_R * 0.7 - 1, "passed through the paddle");
        }
        prev = b.y;
        assert.ok(Math.hypot(b.vx, b.vy) <= G.MAX_SPEED + 1e-6);
      }
      app.balls = app.balls.length ? app.balls : [];
      if (app.sub !== "live") { app.setupChamber(chamber); run(app, 1.4); app.gain = 60; app.chamber = 20; }
    }
  }
});

test("a ball hitting the paddle at full speed always comes back up", () => {
  const { app } = fresh(2);
  app.down();
  run(app, 1.4);
  app.chamber = 20; app.gain = 60;
  app.cells.fill(0); app.cells[0] = { hp: 1, hard: false, bonus: "" }; app.remaining = 1;
  let caught = 0;
  for (let k = 0; k < 30; k++) {
    const b = app.balls[0];
    assert.ok(b, "ball exists");
    const off = ((k % 11) - 5) / 6 * (app.padW / 2);
    b.x = Math.max(G.L + 10, Math.min(G.R - 10, app.px + off - app.dir * 0)); b.y = 380;
    const s = app.speedNow();
    b.vx = 0; b.vy = s; b.dirty = true;
    const touches = app.touches;
    // Hold the paddle still by fixing its position each frame so only the bounce is tested.
    for (let i = 0; i < 60 && app.touches === touches; i++) { const px = app.px; app.update(1 / 60); app.px = px; b.x = Math.max(G.L + 9, b.x); }
    if (app.touches > touches) caught++;
    assert.ok(b.vy < 0, "rebounds upward");
    assert.ok(Math.abs(b.vy) >= 0.29 * Math.hypot(b.vx, b.vy), "minimum vertical share");
  }
  assert.equal(caught, 30);
});

test("rebound angle follows where the ball lands on the paddle", () => {
  const { app } = fresh(2);
  app.down();
  run(app, 1.4);
  const b = app.balls[0];
  const half = app.padW / 2;
  const out = [];
  for (const off of [-0.9, -0.4, 0, 0.4, 0.9]) {
    b.x = app.px + off * half; b.y = G.PAD_Y - G.BALL_R - 1; b.vx = 0; b.vy = 200;
    app.paddleHit(b);
    out.push(b.vx);
  }
  assert.ok(out[0] < out[1] && out[1] < out[3] && out[3] < out[4], out.join(","));
  assert.ok(out[0] < 0 && out[4] > 0);
});

test("the ball can never settle into a horizontal or vertical loop", () => {
  const { app } = fresh(6);
  app.down();
  run(app, 1.4);
  const b = app.balls[0];
  for (const [vx, vy] of [[300, 0], [300, 1e-9], [-300, 0.5], [0, -300], [0.001, 300], [0, 0]]) {
    b.vx = vx; b.vy = vy; app.fixMin(b);
    const sp = Math.hypot(b.vx, b.vy);
    assert.ok(Math.abs(b.vy) / sp >= 0.299, `vy share for ${vx},${vy}`);
    assert.ok(Math.abs(b.vx) / sp >= 0.049, `vx share for ${vx},${vy}`);
  }
  // Play many random games: some ball must always keep making progress.
  let worstGap = 0, worstQuiet = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const random = (a, i) => { if (a.phase === "play" && i % (40 + (seed * 7) % 50) === 0) a.down(); };
    const { app: a1 } = fresh(seed);
    a1.down();
    run(a1, 200, (i) => { random(a1, i); worstGap = Math.max(worstGap, ...a1.balls.map((x) => x.idle)); });
    // A bot that always aims at the middle of the paddle is the worst case for loops.
    const { app: a2 } = fresh(seed);
    const bot = makeBot({ seed });
    a2.down();
    run(a2, 300, (i) => { bot(a2, i); worstQuiet = Math.max(worstQuiet, a2.quiet); });
  }
  assert.ok(worstGap < 15, "a ball went " + worstGap + " s without meeting the paddle");
  assert.ok(worstQuiet < 30, "a chamber stalled for " + worstQuiet + " s without a cell breaking");
  console.log(`longest spell without a broken cell: ${worstQuiet.toFixed(1)} s`);
});

test("the landing bracket matches where the ball really crosses paddle height", () => {
  const { app } = fresh(8);
  app.down();
  run(app, 1.4);
  const b = app.balls[0];
  let checked = 0, close = 0, worst = 0;
  for (let k = 0; k < 300; k++) {
    app.setupChamber(1 + (k % 7));
    run(app, 1.3);
    const ball = app.balls[0];
    ball.x = 200 + ((k * 137) % 560); ball.y = 330 + ((k * 53) % 120);
    const a = ((k * 0.61803) % 1) * Math.PI * 2;
    const s = app.speedNow();
    ball.vx = s * Math.sin(a); ball.vy = s * Math.cos(a) * (k % 3 ? -1 : 1);
    app.fixMin(ball);
    app.predict(ball);
    if (ball.pred === null) continue;
    const predicted = ball.pred;
    // Real motion with the paddle parked outside the chamber, so it never interferes.
    app.px = -5000;
    let crossed = null;
    for (let i = 0; i < 1600 && crossed === null; i++) {
      const before = ball.y;
      app.advance(ball, 1 / 60, false);
      if (before + G.BALL_R < G.PAD_Y && ball.y + G.BALL_R >= G.PAD_Y && ball.vy > 0) crossed = ball.x;
    }
    assert.notEqual(crossed, null);
    checked++;
    const err = Math.abs(crossed - predicted);
    if (err < 8) close++;
    worst = Math.max(worst, err);
  }
  assert.ok(checked > 200, "checked " + checked);
  // A ball can break a cell and later return through its space; those few differ.
  assert.ok(close / checked > 0.95, `${close}/${checked} within 8 px (one frame of travel)`);
  console.log(`landing prediction: ${close}/${checked} within 8 px (one frame of travel) of the real crossing (worst ${worst.toFixed(0)} px)`);
});

test("scoring: cells score with a chain multiplier that resets at the paddle", () => {
  const { app } = fresh(3);
  app.down();
  run(app, 1.4);
  app.cells.fill(0);
  for (let c = 0; c < 4; c++) app.cells[c] = { hp: 1, hard: false, bonus: "" };
  app.cells[5] = { hp: 2, hard: true, bonus: "" };
  app.remaining = 5;
  app.score = 0;
  app.damage(0); app.damage(1); app.damage(2);
  assert.equal(app.score, 10 * 1 + 10 * 2 + 10 * 3);
  app.damage(5); assert.equal(app.score, 60, "first hit on a hard cell does not break it");
  app.damage(5); assert.equal(app.score, 60 + 25 * 4);
  app.paddleHit(app.balls[0]);
  assert.equal(app.multiplier, 1);
});

test("a cleared chamber advances; new chambers bring bonuses, hard cells, speed and a narrower paddle", () => {
  const { ctx, app } = fresh(5);
  app.down();
  run(app, 1.4);
  const w1 = app.padW, sp1 = app.speedNow();
  app.cells.fill(0); app.remaining = 1; app.cells[0] = { hp: 1, hard: false, bonus: "" };
  app.damage(0);
  run(app, 0.1);
  assert.equal(app.sub, "clear");
  assert.ok(app.score >= 100);
  run(app, 3);
  assert.equal(app.chamber, 2);
  assert.equal(app.sub, "serve");
  let bonus = 0;
  for (const c of app.cells) if (c && c.bonus) bonus++;
  assert.ok(bonus >= 2 && bonus % 2 === 0, "mirrored bonus pairs " + bonus);
  // Layouts are mirror-symmetric and the later ones are harder.
  for (let ch = 1; ch <= 12; ch++) {
    app.setupChamber(ch);
    for (let r = 0; r < app.rows; r++) for (let c = 0; c < 6; c++) {
      assert.equal(!!app.cells[r * 12 + c], !!app.cells[r * 12 + 11 - c], `ch ${ch} row ${r}`);
    }
    assert.ok(app.remaining >= 8 && app.remaining <= 96);
  }
  app.setupChamber(8);
  assert.ok(app.cells.some((c) => c && c.hp === 2), "hard cells by chamber 8");
  assert.ok(app.padTarget() < w1, "narrower paddle");
  assert.ok(Ricochet.baseSpeed(8) > Ricochet.baseSpeed(1));
  assert.ok(app.speedNow() > sp1);
  assert.ok(ctx.calls.tone.length > 0);
});

test("bonuses: wide paddle, slow ball and a second ball", () => {
  const { app } = fresh(7);
  app.down();
  run(app, 1.4);
  const w = app.padW, s = app.speedNow();
  app.applyBonus("wide");
  run(app, 1);
  assert.ok(app.padW > w);
  app.applyBonus("slow");
  assert.ok(app.speedNow() < s);
  assert.ok(Math.abs(Math.hypot(app.balls[0].vx, app.balls[0].vy) - app.speedNow()) < 1e-6);
  app.applyBonus("multi");
  assert.equal(app.balls.length, 2);
  app.applyBonus("multi"); app.applyBonus("multi");
  assert.equal(app.balls.length, 3, "at most three balls");
  run(app, 16);
  assert.equal(app.pw.wide, 0);
  assert.equal(app.pw.slow, 0);
});

test("a long hold freezes the world, harmlessly, and release resumes it", () => {
  const { app } = fresh(2);
  app.down();
  run(app, 3);
  toLive(app);
  const lives = app.lives;
  app.down();
  run(app, G.FREEZE_AFTER + 0.1);
  const snap = [app.px, app.balls[0].x, app.balls[0].y, app.clock];
  run(app, 2.6); // a full three-second hold in all
  assert.deepEqual([app.px, app.balls[0].x, app.balls[0].y, app.clock], snap, "world frozen while held");
  assert.equal(app.phase, "play");
  assert.equal(app.lives, lives);
  app.up();
  run(app, 0.5);
  assert.notEqual(app.balls[0].y, snap[2], "resumed on release");
  // A tap is far shorter than the freeze and never freezes anything.
  app.down(); run(app, 0.12); app.up();
  assert.equal(app.frozen, false);
});

test("a tap reverses the paddle immediately and it bounces off the walls on its own", () => {
  const { app } = fresh(2);
  app.down();
  run(app, 0.2);
  const d = app.dir;
  app.down(); app.up();
  assert.equal(app.dir, -d);
  const seen = new Set();
  run(app, 8, () => seen.add(app.dir));
  assert.equal(seen.size, 2, "walls turned it round");
  assert.ok(app.px >= G.L + app.padW / 2 - 1e-6 && app.px <= G.R - app.padW / 2 + 1e-6);
});

test("the menu gesture cannot cost a ball: a three-second hold, or a burst of taps, then cancel", () => {
  const { ctx, app } = fresh(9);
  app.down();
  run(app, 3);
  toLive(app);
  const lives = app.lives;
  // A burst of quick taps then cancel: still playing, nothing lost, lamps dark.
  app.down(); app.up(); run(app, 0.1); app.down(); app.up(); run(app, 0.1); app.down(); app.up();
  app.cancel();
  assert.equal(app.phase, "play");
  assert.equal(app.lives, lives);
  assert.ok(dark(ctx.calls.leds.at(-1)));
  // The ball is about to be lost when the hold that opens the menu begins.
  const doomed = () => { const b = app.balls[0]; b.x = G.L + 30; b.y = G.PAD_Y - 40; b.vx = 0.01; b.vy = 300; app.px = G.R - 100; app.dir = 1; };
  doomed();
  app.down();
  run(app, 3.1); // the whole hold
  assert.equal(app.sub, "dying", "ball was lost at the start of the hold and the world froze");
  assert.equal(app.lives, lives - 1);
  app.cancel(); // the system menu opens
  assert.equal(app.lives, lives, "ball returned");
  assert.equal(app.sub, "serve");
  assert.equal(app.phase, "play");
  // The same on the very last ball: the run must not end or be saved.
  run(app, 3);
  toLive(app);
  app.lives = 1;
  doomed();
  app.down();
  run(app, 3.1);
  assert.equal(app.lives, 0);
  assert.equal(app.phase, "play", "the last ball is not finalised while held");
  app.cancel();
  assert.equal(app.lives, 1);
  assert.equal(app.phase, "play");
  assert.equal(ctx.calls.saved.length, 0);
  assert.equal(ctx.calls.score.length, 0);
});

test("cancel and dispose in any state leave the lamps off", () => {
  for (const when of [0, 0.5, 4, 30]) {
    const { ctx, app } = fresh(3);
    app.down();
    run(app, when, (i) => { if (i % 50 === 0) app.down(); });
    app.down();
    app.cancel();
    assert.ok(dark(ctx.calls.leds.at(-1)), "after cancel at " + when);
    run(app, 0.2);
    app.dispose();
    assert.ok(dark(ctx.calls.leds.at(-1)), "after dispose at " + when);
  }
  const { ctx, app } = fresh(3);
  app.dispose();
  assert.ok(dark(ctx.calls.leds.at(-1)));
});

test("no NaN, bounded lists, and valid lamp values over a long mixed run", () => {
  const { ctx, app } = fresh(13);
  app.down();
  const bot = makeBot();
  let maxBalls = 0, maxDrops = 0;
  const finite = (o) => Object.values(o).every((v) => typeof v !== "number" || Number.isFinite(v));
  run(app, 600, (i) => {
    bot(app, i);
    if (app.phase === "over" && i % 300 === 0) app.down();
    if (i % 977 === 0) app.applyBonus("multi");
    maxBalls = Math.max(maxBalls, app.balls.length);
    maxDrops = Math.max(maxDrops, app.drops.length);
    if (i % 600 === 0) {
      assert.ok(finite(app), "app numbers finite");
      for (const b of app.balls) assert.ok(finite(b));
    }
  });
  assert.ok(maxBalls <= 3 && maxDrops <= 8);
  assert.ok(finite(app));
  assert.ok(lampsOk(ctx));
  assert.ok(ctx.calls.hud.at(-1).length >= 2 && ctx.calls.hud.at(-1).length <= 4);
});

test("the lamps follow the ball, warm as it drops, and react to events", () => {
  const { ctx, app } = fresh(2);
  app.down();
  run(app, 1.4);
  const b = app.balls[0];
  const frame = () => ctx.calls.leds.at(-1);
  const setBall = (x, y) => { b.x = x; b.y = y; b.vx = 0.01; b.vy = 1; app.lampOutput(); return frame(); };
  const left = setBall(G.L + 20, 200), right = setBall(G.R - 20, 200), middle = setBall(480, 200);
  assert.ok(left[0] + left[1] > 0 && left[6] + left[7] + left[8] === 0, "left");
  assert.ok(right[6] + right[7] > 0 && right[0] + right[1] + right[2] === 0, "right");
  assert.ok(middle[3] + middle[4] > 0 && middle[3] > middle[0] / 2 - 1 || middle[4] > 0, "middle");
  const high = setBall(480, 80), low = setBall(480, 470);
  assert.ok(high[4] > high[3], "green when high");
  assert.ok(low[3] > low[4], "red when low");
  const hue = (v) => v[4] / Math.max(1, v[3] + v[4]);
  const mid = setBall(480, 280);
  assert.ok(hue(high) > hue(mid) && hue(mid) > hue(low), "warms monotonically");
  // Sparkle on the lamp over the third of the lattice that lost a cell.
  const before = setBall(G.L + 20, 300).slice();
  app.cells[0] = { hp: 1, hard: false, bonus: "" }; app.remaining++;
  app.damage(0);
  app.lampOutput();
  const after = frame();
  assert.ok(after[0] + after[1] + after[2] > before[0] + before[1] + before[2] || after[2] > before[2], "sparkle on the left lamp");
  // Lost ball washes red.
  const seen = new Set();
  b.y = G.LOST_Y + 30; b.vy = 100;
  run(app, 0.4, () => seen.add(frame().join()));
  const wash = frame();
  assert.equal(app.sub, "dying");
  assert.ok(wash[0] > wash[1] && wash[3] > wash[4] && wash[6] > wash[7] && wash[0] > 0, "red wash " + wash);
  // A cleared chamber runs a chase.
  app.setupChamber(2); run(app, 1.4);
  app.cells.fill(0); app.remaining = 1; app.cells[0] = { hp: 1, hard: false, bonus: "" }; app.damage(0);
  const chased = new Set();
  run(app, 1.5, () => chased.add(frame().join()));
  assert.ok(chased.size >= 4, "chase frames " + chased.size);
  assert.ok(lampsOk(ctx));
  const distinct = new Set(ctx.calls.leds.map((v) => v.join()));
  assert.ok(distinct.size > 20, "lamps change during play: " + distinct.size);
});

test("sustained lamp light stays moderate", () => {
  const { ctx, app } = fresh(4);
  app.down();
  run(app, 90, makeBot().bind(null, app));
  const peak = Math.max(...ctx.calls.leds.map((v) => Math.max(...v)));
  const sum = ctx.calls.leds.reduce((a, v) => a + v.reduce((x, y) => x + y, 0), 0) / ctx.calls.leds.length;
  console.log(`lamps: peak channel ${peak}, mean of nine values ${(sum / 9).toFixed(1)}`);
  assert.ok(sum / 9 < 85);
});

test("title and result draw, lamps idle dim, and a draw touches a bounded number of primitives", () => {
  const { ctx, app } = fresh(2);
  const g = fakeCanvas();
  app.update(1 / 60);
  app.draw(g);
  assert.ok(Math.max(...ctx.calls.leds.at(-1)) < 60, "title lamps dim");
  app.down();
  run(app, 20);
  const g2 = fakeCanvas();
  app.draw(g2);
  const prims = Object.values(g2.count).reduce((a, b) => a + b, 0);
  assert.ok(prims < 900, "primitives " + prims);
  const o = playRun({ seconds: 400 });
  o.app.draw(fakeCanvas());
  assert.equal(o.app.phase, "over");
  assert.ok(Math.max(...o.ctx.calls.leds.at(-1)) < 60, "result lamps dim");
});

test("update plus draw is cheap", () => {
  const { app } = fresh(2);
  app.down();
  const bot = makeBot();
  const g = fakeCanvas();
  const t0 = performance.now();
  run(app, 60, (i) => bot(app, i));
  for (let i = 0; i < 600; i++) app.draw(g);
  const ms = (performance.now() - t0) / (3600 + 600);
  console.log(`update+draw (fake canvas, this machine): ${ms.toFixed(3)} ms per call`);
  assert.ok(ms < 2);
});
