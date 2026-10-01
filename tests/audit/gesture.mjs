// What the menu gesture (tap, tap, hold) costs a player in each game. The original games take it back, so all of these should be zero.
// Run: node tests/audit/gesture.mjs
// Paired design: the same seed is played twice with the same competent bot, once
// undisturbed (control) and once with the gesture injected at a random moment.
import { Random } from "../../web/engine/math.js";
import { OrbitLock } from "../../web/apps/orbit.js";
import { GlyphVault } from "../../web/apps/glyphs.js";
import { makeCtx, makeRig, DT } from "./harness.mjs";
import { playRunner, playUndertow, gestureWithUpdates, mean } from "./bots.mjs";

const N = 60;
const row = (c) => console.log("| " + c.join(" | ") + " |");
row(["game", "measure", "control", "after gesture"]); row(["---", "---", "---", "---"]);

// Moonrunner and Undertow: the bot is competent and survives 1200 s undisturbed
// (see balance.mjs), so any death after the gesture is caused by it.
for (const [name, play, pol] of [["Moonrunner", playRunner, { kind: "timed", sigmaFrames: 2.4 }],
  ["Undertow", playUndertow, { kind: "pilot", every: 3, brake: 0.42 }]]) {
  let ctrlDead = 0, gestDead = 0;
  for (let s = 1; s <= N; s++) {
    const at = 10 + new Random(s).range(0, 50);
    const a = play(s, pol, at + 20), b = play(s, pol, at + 20, at);
    if (a.over) ctrlDead++;
    if (b.over) gestDead++;
  }
  row([name, `runs ended within 20 s of a gesture at a random time (n=${N})`, `${ctrlDead}/${N}`, `${gestDead}/${N}`]);
}

// Orbit Lock and Glyph Archive: the taps are judged immediately by the game.
{
  let ended = 0, progress = [];
  for (let s = 1; s <= N; s++) {
    const c = makeCtx(s), g = new OrbitLock(c), rig = makeRig(g, c), br = new Random(s);
    g.down();
    const stopAt = 15 + br.range(0, 30);
    for (let t = 0; t < stopAt && g.phase === "play"; t += DT) {
      const sp = 1.25 + Math.min(g.points, 25) * 0.07;
      const d = (((g.target - g.angle) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      if (d / sp <= DT) g.down();
      g.update(DT);
    }
    const p0 = g.points, l0 = g.lives, runs0 = c.log.saves.length;
    gestureWithUpdates(g, rig); rig.resume();
    // Hurt = a run was recorded as finished, a fresh run replaced it, or lives/locks changed.
    if (c.log.saves.length > runs0 || g.phase !== "play" || g.lives !== l0 || g.points < p0) ended++;
    progress.push(p0);
  }
  row(["Orbit Lock", `run ended, replaced or damaged after a gesture at 15-45 s (n=${N})`, "0/" + N + " (perfect-timing bot never loses)", `${ended}/${N}`]);
  row(["Orbit Lock", "mean locks in the run that the gesture ended", "-", mean(progress).toFixed(1)]);
}
{
  let ended = 0, lost = [];
  for (let s = 1; s <= N; s++) {
    const c = makeCtx(s), g = new GlyphVault(c), rig = makeRig(g, c);
    g.down();
    for (let f = 0; f < 60 * 4 && g.phase !== "choose"; f++) g.update(DT);
    const runs0 = c.log.saves.length, round0 = g.round;
    gestureWithUpdates(g, rig); rig.resume();
    if (c.log.saves.length > runs0 || g.round !== round0 || g.phase !== "choose") ended++;
    else lost.push(3 - g.lives);
  }
  row(["Glyph Archive", `run ended, replaced or damaged after a gesture during the first inscription (n=${N})`, "0/" + N, `${ended}/${N}`]);
  row(["Glyph Archive", "attempts lost in the runs the gesture did not end", "0", mean(lost).toFixed(2) + " of 3 on average"]);
}
