// Seeded bots. Every bot plays through the app's own down/up/update methods at
// the fixed 1/60 s step and never touches app internals except to read what a
// human could see on screen (positions, the highlighted glyph, the sequence the
// player has just been shown).
import { Random, wrapAngle, TAU } from "../../web/engine/math.js";
import { OrbitLock, orbitSpeed } from "../../web/apps/orbit.js";
import { Moonrunner } from "../../web/apps/runner.js";
import { runnerBot } from "../helpers/runner-bot.mjs";
import { Undertow } from "../../web/apps/undertow.js";
import { EchoVault } from "../../web/apps/echo.js";
import { GlyphVault } from "../../web/apps/glyphs.js";
import { MorseSchool } from "../../web/apps/morse.js";
import { makeCtx, makeRig, DT } from "./harness.mjs";

// The menu gesture, tap, tap, hold, as a human delivers it (about 65 ms taps, 50 ms gaps, then a press
// held until the menu opens), with the game still running between and during the presses. Returns when the
// menu has opened (false if it never did within five seconds).
export function gestureWithUpdates(g, rig, onFrame = () => {}, { tapMs = 67, gapMs = 50 } = {}) {
  const frames = (ms) => { for (let f = 0; f < Math.max(1, Math.round(ms / 16.7)); f++) { g.update(DT); onFrame(); } };
  const edge = (kind) => rig.router[kind]({ source: "node", generation: 1, at_us: rig.now() * 1000 });
  for (let i = 0; i < 2; i++) {
    edge("down"); frames(tapMs); rig.wait(tapMs);
    edge("up"); frames(gapMs); rig.wait(gapMs);
  }
  edge("down");
  for (let t = 0; t < 5000; t += 16.7) { rig.wait(16.7); if (rig.menuOpen) break; g.update(DT); onFrame(); }
  return rig.menuOpen > 0;
}

export const gauss = (r, sigma) => {
  const u = Math.max(1e-12, r.next()), v = r.next();
  return sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
};
export const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
export const median = (a) => {
  if (!a.length) return NaN;
  const s = a.slice().sort((x, y) => x - y), n = s.length;
  return (s[Math.floor((n - 1) / 2)] + s[Math.floor(n / 2)]) / 2;
};
export const pct = (a, p) => {
  if (!a.length) return NaN;
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

// ---------------------------------------------------------------- Orbit Lock
// policy: {kind:"timed", sigma} | {kind:"never"} | {kind:"rhythm", period}
export function playOrbit(seed, policy, maxSeconds = 1200) {
  const c = makeCtx(seed), g = new OrbitLock(c), br = new Random(seed * 7919 + 13);
  g.down();
  let t = 0, frame = 0, off = null, key = "", log = [];
  while (g.phase === "play" && t < maxSeconds) {
    let press = false;
    if (policy.kind === "rhythm") press = frame > 0 && frame % Math.round(policy.period * 60) === 0;
    if (policy.kind === "timed") {
      const k = g.points + ":" + g.lives;
      if (k !== key) { key = k; off = gauss(br, policy.sigma); }
      // the gate may slide (drift) and the satellite may travel either way, so use the game's own geometry
      const speed = Math.max(0.5, orbitSpeed(g.points) - g.drift * g.dir);
      const d = g.ahead(); // radians until the gate centre, in the direction of travel
      // one frame of slack so a zero-jitter bot cannot step over the gate between two 1/60 s frames
      press = off >= 0 ? d / speed <= off + DT : d >= TAU - (-off + DT) * speed && d < TAU;
    }
    if (press) {
      const before = g.points;
      g.down();
      if (g.points > before) log.push(t);
    }
    g.update(DT); t += DT; frame++;
  }
  return { points: g.points, seconds: t, over: g.phase === "over", lives: g.lives, locks: log };
}

// ----------------------------------------------------------------- Moonrunner
// The hill-flyer (rebuilt 2026-10-01). policy: {kind:"timed", sigmaFrames} (dives timed on a copy of
// the sled; every change of the button lands sigmaFrames late) | eye (dives by eye, no planning) |
// never | hold | rhythm(period) | mash(hz).
export function playRunner(seed, policy, maxSeconds = 1200, gestureAt = null) {
  const c = makeCtx(seed), g = new Moonrunner(c);
  const rig = makeRig(g, c);
  g.down(); g.up();
  const bot = policy.kind === "timed" ? runnerBot(g, { lag: policy.sigmaFrames / 60 }) : policy.kind === "eye" ? runnerBot(g, { plan: false }) : null;
  let t = 0, frame = 0, releaseAt = -1, gestureDone = gestureAt === null, tGesture = null;
  const at = {}; // time (s) at which each zone was first reached
  while (g.phase === "play" && t < maxSeconds) {
    if (!gestureDone && t >= gestureAt) {
      gestureDone = true;
      gestureWithUpdates(g, rig, () => { t += DT; frame++; });
      rig.resume(); tGesture = t;
      if (g.phase !== "play") break;
    }
    if (releaseAt === frame) { g.up(); releaseAt = -1; }
    if (bot) bot();
    else if (policy.kind === "hold") { if (frame === 0) g.down(); }
    else if (policy.kind === "rhythm") { if (frame % Math.round(policy.period * 60) === 0) { g.down(); releaseAt = frame + 3; } }
    else if (policy.kind === "mash") { if (frame % Math.round(60 / policy.hz) === 0) { g.down(); releaseAt = frame + 2; } }
    g.update(DT); t += DT; frame++;
    at[g.zone] ??= t;
  }
  return { at, metres: Math.floor(g.R.m), score: g.scoreNow(), perfects: g.R.perfects, fevers: g.R.fevers, seconds: t, over: g.phase === "over", tGesture };
}

// ------------------------------------------------------------------- Undertow
// policy: {kind:"pilot", every, brake} | never | hold | duty(period, fraction)
export function playUndertow(seed, policy, maxSeconds = 1200, gestureAt = null) {
  const c = makeCtx(seed), g = new Undertow(c);
  const rig = makeRig(g, c);
  g.down();
  let t = 0, frame = 0, gestureDone = gestureAt === null, tGesture = null;
  const at = {};
  const set = (v) => { if (v && !g.held) g.down(); else if (!v && g.held) g.up(); };
  while (g.phase === "play" && t < maxSeconds) {
    if (!gestureDone && t >= gestureAt) {
      gestureDone = true;
      gestureWithUpdates(g, rig, () => { t += DT; frame++; });
      rig.resume(); tGesture = t;
      if (g.phase !== "play") break;
    }
    if (policy.kind === "pilot") {
      if (frame % policy.every === 0) {
        const target = g.gates.find((q) => q.x + 65 > 202)?.center || 270;
        set(g.y + g.vy * policy.brake > target);
      }
    } else if (policy.kind === "never") set(false);
    else if (policy.kind === "hold") set(true);
    else if (policy.kind === "duty") {
      const p = Math.round(policy.period * 60);
      set(frame % p < p * policy.fraction);
    }
    g.update(DT); t += DT; frame++;
    at[g.points] ??= t;
  }
  return { at, points: g.points, seconds: t, over: g.phase === "over", reason: g.reason, tGesture };
}

// ------------------------------------------------------------------ Echo Vault
// policy: {kind:"memory", short:[mu,sd], long:[mu,sd]} | random | allShort | allLong
export function playEcho(seed, policy, maxSeconds = 1200) {
  const c = makeCtx(seed), g = new EchoVault(c), br = new Random(seed * 17 + 3);
  g.down();
  let t = 0, shown = [], roundStart = [0], pendingUp = -1, pendingMs = 0, frame = 0;
  let toEnter = null, i = 0, nextAt = 0;
  while (g.phase !== "over" && t < maxSeconds) {
    if (g.phase === "show") { shown = g.sequence.slice(); toEnter = null; }
    if (g.phase === "listen") {
      if (!toEnter) { toEnter = shown.slice(); i = 0; nextAt = t + 0.4; }
      if (pendingUp < 0 && t >= nextAt && i < toEnter.length) {
        let v = toEnter[i];
        if (policy.kind === "random") v = br.int(0, 1);
        if (policy.recall !== undefined && br.next() > policy.recall) v = br.int(0, 1); // a pulse forgotten
        if (policy.kind === "allShort") v = 0;
        if (policy.kind === "allLong") v = 1;
        const [mu, sd] = v ? policy.long || [600, 120] : policy.short || [150, 50];
        pendingMs = Math.max(20, mu + gauss(br, sd));
        if (policy.kind === "fixed") pendingMs = policy.ms; // a degenerate keyer: the same hold every time
        g.down(); pendingUp = t + pendingMs / 1000;
      }
      if (pendingUp >= 0 && t >= pendingUp) {
        g.up({ durationMs: pendingMs }); pendingUp = -1; i++; nextAt = t + 0.12 + br.range(0, 0.15);
      }
    }
    if (g.round === roundStart.length) roundStart.push(t);
    g.update(DT); t += DT; frame++;
  }
  return { rounds: g.round, seconds: t, over: g.phase === "over", roundStart, len: g.sequence.length };
}

// ---------------------------------------------------------------- Glyph Archive
// policy: {kind:"memory", react:[mu,sd], recall:p} | mash(hz) | rhythm(period)
export function playGlyph(seed, policy, scanMs = 850, maxSeconds = 1200) {
  const c = makeCtx(seed, { settings: { scanMs } }), g = new GlyphVault(c), br = new Random(seed * 53 + 9);
  g.down();
  let t = 0, frame = 0, seen = null, pressAt = -1, lastFocus = -1, roundStart = [], plan = -1, planPos = -1;
  while (g.phase !== "over" && t < maxSeconds) {
    if (g.phase === "watch") { seen = g.sequence.slice(); }
    if (g.phase !== "choose") { lastFocus = -1; pressAt = -1; }
    if (g.phase === "choose") {
      if (policy.kind === "memory") {
        const need = g.entered.length;
        if (planPos !== need) { planPos = need; plan = br.next() < policy.recall ? seen[need] : br.int(0, 5); }
        if (g.focus !== lastFocus) {
          lastFocus = g.focus;
          if (g.focus === plan) pressAt = t + Math.max(0, policy.react[0] + gauss(br, policy.react[1])) / 1000;
        }
        if (pressAt >= 0 && t >= pressAt) { pressAt = -1; planPos = -1; g.down(); }
      } else if (policy.kind === "mash") {
        if (frame % Math.round(60 / policy.hz) === 0) g.down();
      } else if (policy.kind === "rhythm") {
        if (frame % Math.round(policy.period * 60) === 0) g.down();
      }
    }
    g.update(DT); t += DT; frame++;
    if (g.round > roundStart.length) roundStart.push(t);
  }
  return { rounds: g.round, points: g.points, seconds: t, over: g.phase === "over", roundStart };
}

// --------------------------------------------------------------- Signal School
// Plays guided keying with a human keyer: absolute timing noise, independent of WPM.
export function playMorse(seed, wpm, { noiseMs = 35, sessions = 3, mode = "guided", progress } = {}) {
  const opts = { settings: { morseWpm: wpm }, progress: progress ?? {} };
  const c = makeCtx(seed, opts), g = new MorseSchool(c), br = new Random(seed * 211 + 1);
  const unit = 1200 / wpm;
  let t = 0, answered = 0, ok = 0, firstSession = null;
  const MORSE = { E: ".", T: "-", A: ".-", N: "-.", I: "..", M: "--", S: "...", O: "---", R: ".-.", K: "-.-", D: "-..", U: "..-", G: "--.", W: ".--", H: "....", B: "-...", F: "..-.", L: ".-..", P: ".--.", J: ".---", C: "-.-.", X: "-..-", Y: "-.--", Q: "--.-", V: "...-", Z: "--.." };
  g.start(mode);
  let doneSessions = 0, sessionStart = 0;
  const wait = (s) => { const n = Math.round(s * 60); for (let i = 0; i < n; i++) { g.update(DT); t += DT; } };
  while (doneSessions < sessions && t < 3600) {
    if (g.summary) {
      doneSessions++; if (firstSession === null) firstSession = t - sessionStart;
      sessionStart = t; g.down(); continue; // press starts another session
    }
    if (g.phase === "key" && g.nextDelay <= 0 && g.input === "" && g.gap <= 0) {
      const target = g.target, a0 = g.attempts;
      for (const s of MORSE[target]) {
        const hold = Math.max(15, (s === "." ? unit : 3 * unit) + gauss(br, noiseMs));
        g.down(); wait(hold / 1000); g.up({ durationMs: hold }); wait(Math.max(0.03, unit / 1000 + gauss(br, 0.03)));
      }
      while (g.attempts === a0 && t < 3600) wait(1 / 60);
      answered++; if (g.lastAccepted) ok++;
    } else wait(1 / 60);
  }
  return { answered, ok, seconds: t, firstSession, index: g.index, learning: g.learning };
}
