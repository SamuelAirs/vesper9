// OUTPOST's scene: everything drawn on the canvas (the place and its machines, the header and
// footer readouts, the build ring, the statistics panel and the cards) and the purely visual
// animation that moves it between frames. Drawing only reads the cartridge (`app`): its saved
// state `app.s` and the fields listed below. stepScene advances the visual-only state and is
// called once per update; nothing here may change game state or draw from ctx.rng (the seeded
// sequences of flares, relics and shuffles are part of the tests).
//
// Fields read from the cartridge: s, t, clk, phase_, ring, entries, panel, card, cardT, away,
// newsFrom, note, floats, ripples, act, phase, flash, flare, boosts, groove, items, affordN,
// goalName, goalCost, goalFrac, nextGoal, refused, down_, consume, downAt; and the methods
// surge(), effRate(), tapValue(), grooveMult() and pending().
import { C, space, text, line, circle, diamond, banner, wrapText } from "../engine/draw.js";
import { TAU, clamp } from "../engine/math.js";
import { pulse, blink } from "../engine/lightshow.js";
import {
  CHART_REQ, CONST, DWELL, EXPED, GOALS, GROOVE_MAX, HOLD_BUY, NG, NP, NR, RES, RING_IDLE, STAGES,
  capHours, clock, dur, fmt, fmtDate, fmtInt, fmtRate, goalFrac, masteredN, pendingOf, prodVisible, readyOf, revealOf, stageOf, unlockedN,
} from "./outpost-rules.js";
import { NS } from "./outpost-songs.js";

const FREE_KINDS = ["close", "back", "sub", "panel", "mode", "song", "songnew"]; // entries that cost nothing to choose
// Horizon colour by stage: cold at first, warmer with the town, the aurora's teal at the end.
const HORIZON = ["#16231c", "#1a271d", "#20291d", "#2a2a1c", "#2a2a20", "#1c2a2c", "#173033"];
const HILLS = [[0, 424], [90, 408], [170, 418], [260, 394], [350, 412], [450, 400], [560, 416], [660, 398], [760, 414], [850, 402], [960, 420]];

// The visual-only animation, once per update: machine motion (act follows each machine's output,
// phase turns faster as it works harder), purchase flashes, floating numbers, tap ripples, the
// message line and the ring's "NOT NOW".
export function stepScene(app, dt) {
  for (let i = 0; i < NP; i++) {
    const target = app.out[i] > 0 ? clamp(Math.log10(1 + app.out[i]) / 8, 0.08, 1) : 0;
    app.act[i] += (target - app.act[i]) * Math.min(1, dt * 2);
    app.phase[i] += dt * (0.3 + 1.6 * app.act[i]);
    if (app.flash[i] > 0) app.flash[i] = Math.max(0, app.flash[i] - dt * 2);
  }
  for (const f of app.floats) if (f.life > 0) { f.life -= dt; f.y -= dt * 40; }
  for (const r of app.ripples) if (r.t < 9) r.t += dt;
  if (app.note) { app.note.t -= dt; if (app.note.t <= 0) app.note = null; }
  if (app.refused && app.clk - app.refused > 0.4) app.refused = 0;
}
// A tap pulse along the ground. Drawn only; reuses the oldest slot and draws no random numbers.
export function addRipple(app) {
  let slot = app.ripples[0];
  for (const r of app.ripples) if (r.t > slot.t) slot = r;
  slot.t = 0; slot.full = Math.floor(app.groove) >= GROOVE_MAX;
}
// A floating number (the cartridge chooses where; it reuses a spent slot, else the oldest).
export function addFloat(app, textValue, x, y) {
  let slot = app.floats[0];
  for (const f of app.floats) { if (f.life <= 0) { slot = f; break; } if (f.life < slot.life) slot = f; }
  slot.x = x; slot.y = y; slot.life = 1.1; slot.v = textValue;
}

export function drawOutpost(g, app) {
  space(g, app.t * 3, 0.5);
  drawScene(g, app);
  drawHeader(g, app);
  for (const f of app.floats) {
    if (f.life <= 0) continue;
    g.globalAlpha = clamp(f.life, 0, 1);
    text(g, f.v, f.x, f.y, 22, C.ink, "center");
  }
  g.globalAlpha = 1;
  if (app.flare) drawFlare(g, app);
  drawFooter(g, app);
  if (app.ring) drawRing(g, app);
  else if (app.panel) drawPanel(g, app);
  else if (app.note && app.phase_ === "play") text(g, app.note.text, 480, 232, 22, C.cyan, "center");
  if (app.phase_ === "intro") banner(g, "OUTPOST", "A lone station on a dark world. Tap to gather signal and play its song. Hold to build.");
  else if (app.phase_ === "news") drawNews(g, app);
  else if (app.phase_ === "away") drawAway(g, app);
  else if (app.phase_ === "card") drawCard(g, app);
}
function drawHeader(g, app) {
  const s = app.s;
  text(g, "SIGNAL", 480, 24, 16, C.muted, "center");
  text(g, fmt(s.sig), 480, 64, 46, C.ink, "center");
  const surge = app.surge() > 1 ? " x" + app.surge() : "";
  text(g, "+" + fmtRate(app.effRate()) + " /S" + surge, 480, 104, 26, app.surge() > 1 ? C.cyan : C.amber, "center");
  // the headline figures; everything else is in STATISTICS
  const star = s.fk ? "" : " *";
  text(g, "TAPS", 24, 24, 16, C.muted, "left");
  text(g, fmtInt(s.taps), 24, 50, 24, C.ink, "left");
  text(g, "BY HAND" + star, 24, 84, 16, C.muted, "left");
  text(g, fmt(s.st.hand), 24, 110, 24, C.amber, "left");
  text(g, "PER TAP", 936, 24, 16, C.muted, "right");
  text(g, "+" + fmt(app.tapValue()), 936, 50, 24, C.ink, "right");
  text(g, s.L > 0 ? "BEARINGS" : "BEST RATE" + star, 936, 84, 16, C.muted, "right");
  text(g, s.L > 0 ? s.b + " / " + s.L : fmtRate(s.st.peak) + " /S", 936, 110, 24, C.amber, "right");
  if (app.groove >= 1) {
    const gf = Math.floor(app.groove) / GROOVE_MAX;
    text(g, "GROOVE x" + app.grooveMult().toFixed(2), 936, 140, 16, gf >= 1 ? C.cyan : C.muted, "right");
    g.fillStyle = C.dark; g.fillRect(836, 148, 100, 5);
    g.fillStyle = gf >= 1 ? C.cyan : C.amber; g.fillRect(836, 148, 100 * gf, 5);
  }
  let y = 150;
  for (const b of app.boosts) { text(g, (b.k === "surge" ? "SURGE x" : "TAP x") + b.mult + " " + clock(b.t), 24, y, 16, C.cyan, "left"); y += 22; }
  for (const e of s.ex) { text(g, EXPED[e.k].n + " " + clock((e.end - Date.now()) / 1000), 24, y, 16, C.cyan, "left"); y += 22; }
  for (const e of s.rs) { if (y < 240) text(g, "LAB " + RES[e.k].n + " " + clock((e.end - Date.now()) / 1000), 24, y, 16, C.cyan, "left"); y += 22; }
}
function drawFooter(g, app) {
  const s = app.s;
  if (app.ring || app.panel || app.phase_ !== "play") return;
  if (app.nextGoal !== null) {
    const gl = GOALS[app.nextGoal];
    text(g, "GOAL  " + gl.n + "  " + Math.floor(goalFrac(s, gl) * 100) + "%", 480, 160, 16, C.cyan, "center");
  }
  if (app.goalName) {
    text(g, "NEXT  " + app.goalName + "  " + fmt(app.goalCost), 480, 492, 22, app.affordN > 0 ? C.ink : C.muted, "center");
    g.fillStyle = C.dark; g.fillRect(260, 510, 440, 8);
    g.fillStyle = app.affordN > 0 ? C.ink : C.amber; g.fillRect(260, 510, 440 * app.goalFrac, 8);
  } else if (app.items.length && app.affordN > 0) text(g, "HOLD TO BUILD", 480, 492, 22, C.ink, "center");
  const p = app.pending();
  if (revealOf(s)) text(g, readyOf(s) ? "RELOCATION READY  +" + p : "RELOCATION POSSIBLE  +" + p, 480, 134, 18, readyOf(s) ? C.cyan : C.muted, "center");
  else if (app.affordN > 0 && app.phase_ === "play") text(g, "HOLD TO BUILD", 480, 134, 18, C.ink, "center");
}
// The place grows with the station: a ridge from the start, then a fence, power poles, huts with
// lit windows, a radar, orbiting satellites and finally an aurora. Faint line art behind the machines.
// Charted constellations, faint in the sky: twelve places, later charts drawn over them brighter.
function drawSky(g, app) {
  const n = app.s.cn;
  if (!n) return;
  const shown = Math.min(n, CONST.length);
  for (let k = 0; k < shown; k++) {
    const [, stars, links] = CONST[k];
    const col = k % 6, row = Math.floor(k / 6);
    const x0 = 30 + col * 160 + (row ? 70 : 0), y0 = 176 + row * 70 + (col % 2) * 18, w = 70, h = 40;
    const deep = Math.floor((n - 1 - k) / CONST.length) + 1; // how many times this place has been charted
    g.globalAlpha = Math.min(0.75, 0.22 + 0.12 * deep);
    g.strokeStyle = deep > 1 ? C.cyan : C.line; g.lineWidth = 1;
    g.beginPath();
    for (const [a, b] of links) { g.moveTo(x0 + stars[a][0] * w, y0 + stars[a][1] * h); g.lineTo(x0 + stars[b][0] * w, y0 + stars[b][1] * h); }
    g.stroke();
    g.fillStyle = deep > 1 ? C.cyan : C.ink;
    for (const [sx, sy] of stars) g.fillRect(x0 + sx * w - 1.5, y0 + sy * h - 1.5, 3, 3);
  }
  g.globalAlpha = 1;
}
function drawBackdrop(g, app, stage) {
  const gy = 440, t = app.t;
  // a horizon glow that warms as the station grows, and the aurora's colour once it comes
  const glow = g.createLinearGradient(0, 250, 0, gy);
  glow.addColorStop(0, "#0c151100");
  glow.addColorStop(1, HORIZON[Math.min(stage, HORIZON.length - 1)]);
  g.fillStyle = glow; g.fillRect(0, 250, 960, gy - 250);
  // a far world low in the sky, lit on one side
  g.globalAlpha = 0.5;
  circle(g, 800, 300, 54, "#141f1a", true);
  g.beginPath(); g.arc(800, 300, 54, -0.5 * Math.PI, 0.5 * Math.PI); g.arc(812, 300, 52, 0.5 * Math.PI, -0.5 * Math.PI, true);
  g.fillStyle = stage >= 6 ? C.cyan : C.muted; g.fill();
  g.globalAlpha = 1;
  drawSky(g, app);
  // the ridge as a dark silhouette with a lit edge
  g.beginPath();
  HILLS.forEach((p, k) => (k ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
  g.lineTo(960, gy); g.lineTo(0, gy); g.closePath();
  g.fillStyle = "#0a110d"; g.fill();
  g.lineWidth = 2; g.strokeStyle = C.dark;
  g.beginPath();
  HILLS.forEach((p, k) => (k ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
  g.stroke();
  if (stage >= 1) { // a fence of posts and one wire
    g.strokeStyle = C.line;
    g.beginPath();
    for (let x = 12; x < 960; x += 48) { g.moveTo(x, gy); g.lineTo(x, gy - 16); }
    g.moveTo(0, gy - 12); g.lineTo(960, gy - 12);
    g.stroke();
  }
  if (stage >= 2) { // power poles with a sagging line
    g.strokeStyle = C.line;
    g.beginPath();
    for (let x = 40; x < 960; x += 200) {
      g.moveTo(x, gy); g.lineTo(x, gy - 78); g.moveTo(x - 12, gy - 72); g.lineTo(x + 12, gy - 72);
      if (x + 200 < 960) { g.moveTo(x + 12, gy - 72); g.quadraticCurveTo(x + 100, gy - 54, x + 188, gy - 72); }
    }
    g.stroke();
    for (let x = 40; x < 960; x += 200) circle(g, x, gy - 80, 3, blink(t * 0.4 + x, 1) ? C.amber : C.line, true);
  }
  if (stage >= 3) { // two huts with a lit window each
    for (const x of [14, 920]) {
      g.strokeStyle = C.line;
      g.strokeRect(x, gy - 34, 30, 34);
      line(g, x - 4, gy - 34, x + 15, gy - 48, C.line, 2); line(g, x + 15, gy - 48, x + 34, gy - 34, C.line, 2);
      g.fillStyle = C.amber; g.globalAlpha = 0.5 + 0.3 * pulse(t * 0.2 + x);
      g.fillRect(x + 8, gy - 24, 8, 8);
      g.globalAlpha = 1;
    }
  }
  if (stage >= 4) { // a radar turning on the ridge
    const a = t * 0.9;
    line(g, 880, 396, 880 + Math.cos(a) * 34, 396 + Math.sin(a) * 18, C.line, 2);
    g.save(); g.scale(1, 0.55); circle(g, 880, 396 / 0.55, 34, C.line, false, 2); g.restore();
  }
  if (stage >= 5) { // an orbit with two satellites
    g.save(); g.setLineDash([3, 9]); g.scale(1, 0.18); circle(g, 480, 1180, 420, C.line, false, 2); g.restore();
    for (let k = 0; k < 2; k++) {
      const a = t * 0.12 + k * Math.PI;
      diamond(g, 480 + Math.cos(a) * 420, 212 + Math.sin(a) * 76, 5, C.cyan, true);
    }
  }
  if (stage >= 6) { // the aurora
    g.globalAlpha = 0.35;
    for (let k = 0; k < 3; k++) {
      g.beginPath();
      for (let x = 0; x <= 960; x += 24) {
        const y = 168 + k * 16 + 14 * Math.sin(x * 0.012 + t * 0.4 + k) + 8 * Math.sin(x * 0.03 - t * 0.3);
        if (x) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.strokeStyle = k === 1 ? C.amber : C.cyan; g.lineWidth = 2; g.stroke();
    }
    g.globalAlpha = 1;
  }
}
function drawPanel(g, app) {
  const s = app.s, st = s.st, pg = app.panel.page;
  g.fillStyle = "#0c1511f6"; g.fillRect(30, 140, 900, 372);
  g.strokeStyle = C.line; g.lineWidth = 2; g.strokeRect(30, 140, 900, 372);
  text(g, "STATISTICS  " + ["ALL TIME", "THIS RUN", "MUSIC AND FIELD"][pg] + "  " + (pg + 1) + "/3", 54, 164, 18, C.amber, "left");
  const star = s.fk ? "" : "*", p = pendingOf(s);
  const tp = app.tapValue();
  const cells = pg === 0 ? [
    ["TAPS", fmtInt(s.taps)], ["BY HAND", fmt(st.hand) + star], ["BY MACHINES", fmt(st.mach) + star], ["CREDITED AWAY", fmt(st.off) + star],
    ["BONUSES", fmt(st.bon) + star], ["SIGNAL PER TAP", "+" + fmt(tp)], ["PEAK RATE", fmtRate(st.peak) + " /S" + star], ["TIME PLAYED", dur(st.tp) + star],
    ["TIME AWAY", dur(st.ta) + star], ["PURCHASES", fmtInt(st.buys) + star]]
    : pg === 1 ? [
    ["TAPS THIS RUN", fmtInt(st.rtaps) + star], ["BY HAND", fmt(st.rhand) + star], ["BY MACHINES", fmt(st.rmach) + star], ["RUN SIGNAL", fmt(s.rt)],
    ["RUN TIME", dur(s.play)], ["BEARINGS ON OFFER", "+" + p], ["RELOCATIONS", String(s.runs)], ["FASTEST MOVE", st.fr ? dur(st.fr) + star : "NONE YET"],
    ["STAGE", STAGES[stageOf(s)]], ["LIFETIME SIGNAL", fmt(s.lt)]]
    : [
    ["NOTES PLAYED", fmtInt(st.nt) + star], ["TUNES COMPLETED", fmtInt(st.md) + star], ["PHRASES", fmtInt(st.ph) + star], ["TUNES UNLOCKED", unlockedN(s) + " / " + NS],
    ["TUNES MASTERED", masteredN(s) + " / " + NS], ["FLARES CAUGHT", fmtInt(st.fl) + star], ["EXPEDITIONS SENT", fmtInt(st.ex) + star], ["GOALS MET", s.gl.length + " / " + NG],
    ["RESEARCH DONE", s.rd.length + " / " + NR], ["BEST GROOVE", (st.gb >= GROOVE_MAX ? "FULL" : Math.floor(st.gb) + " / " + GROOVE_MAX) + "  " + fmtInt(st.gt) + " IN THE POCKET"]];
  cells.forEach((c, k) => {
    const col = k % 2, row = Math.floor(k / 2), x = 54 + col * 440, y = 196 + row * 56;
    text(g, c[0], x, y, 16, C.muted, "left");
    text(g, c[1], x, y + 26, 24, c[1].startsWith("NONE") ? C.muted : C.ink, "left");
  });
  text(g, s.fk ? "FOUNDED " + fmtDate(s.f) : "* COUNTED SINCE " + fmtDate(s.f), 54, 496, 16, C.muted, "left");
  text(g, "TAP: NEXT PAGE   HOLD: CLOSE", 906, 496, 16, C.muted, "right");
}
function drawNews(g, app) {
  const s = app.s;
  g.fillStyle = "#0c1511f0"; g.fillRect(100, 130, 760, 330);
  g.strokeStyle = C.line; g.lineWidth = 2; g.strokeRect(100, 130, 760, 330);
  text(g, "OUTPOST UPDATED", 480, 168, 30, C.cyan, "center");
  if (app.newsFrom >= 3) { // from schema 3: groove and constellations
    text(g, "KEEP A STEADY BEAT TO BUILD GROOVE", 480, 218, 22, C.ink, "center");
    text(g, "FULL GROOVE: EVERY TAP AND PHRASE x1.5", 480, 250, 22, C.muted, "center");
    text(g, "AT " + CHART_REQ + " BEARINGS THE TREE CAN CHART CONSTELLATIONS", 480, 290, 20, C.ink, "center");
    text(g, "THE EXTRA VOICES ARE QUIETER UNDER THE TUNE", 480, 322, 20, C.muted, "center");
    text(g, "NOTHING WAS LOST.", 480, 366, 18, C.muted, "center");
    text(g, "PRESS TO CONTINUE", 480, 424, 22, C.amber, "center");
    return;
  }
  text(g, "TAPS NOW PLAY MELODIES", 480, 218, 22, C.ink, "center");
  text(g, "HOLD, THEN SONGBOOK, TO CHOOSE THE TUNE", 480, 250, 22, C.muted, "center");
  text(g, "STATISTICS, GOALS AND RESEARCH ARE NEW", 480, 290, 22, C.ink, "center");
  if (s.gl.length) text(g, s.gl.length + " GOALS ALREADY MET: +" + s.gl.length + "% OUTPUT", 480, 322, 22, C.amber, "center");
  text(g, "NOTHING WAS LOST. COUNTING STARTS " + fmtDate(s.f), 480, 366, 18, C.muted, "center");
  text(g, "PRESS TO CONTINUE", 480, 424, 22, C.amber, "center");
}
function drawFlare(g, app) {
  const f = app.flare, k = f.t / f.life, r = 12 + 10 * Math.sin(app.t * 6);
  diamond(g, f.x, f.y, r, C.amber, true);
  circle(g, f.x, f.y, 26 + 14 * (1 - k), C.amber, false, 2);
  text(g, "FLARE - TAP", f.x, f.y + 44, 22, C.amber, "center");
}
function drawScene(g, app) {
  const s = app.s, gy = 440;
  drawBackdrop(g, app, stageOf(s));
  const ground = g.createLinearGradient(0, gy, 0, 540);
  ground.addColorStop(0, "#111c15"); ground.addColorStop(1, "#070b09");
  g.fillStyle = ground; g.fillRect(0, gy, 960, 540 - gy);
  line(g, 0, gy, 960, gy, C.line, 2);
  for (let x = 30; x < 960; x += 90) line(g, x, gy + 8, x + 40, gy + 8, C.dark, 2);
  drawRipples(g, app, gy);
  drawPulses(g, app, gy);
  let ghost = -1;
  for (let i = 0; i < NP; i++) {
    const x = 56 + i * (848 / (NP - 1)), n = s.own[i]; // twelve machines across the width
    if (n > 0) {
      structure(g, app, i, x, gy, n);
      text(g, "x" + n, x, gy + 26, 16, app.flash[i] > 0 ? C.cyan : C.muted, "center");
      if (app.flash[i] > 0) circle(g, x, gy - 40, 30 + 40 * (1 - app.flash[i]), C.cyan, false, 2);
    } else if (ghost < 0 && i <= s.maxTier + 1 && prodVisible(s, i)) {
      ghost = i;
      g.save(); g.setLineDash([4, 6]); circle(g, x, gy - 30, 22, C.line, false, 2); g.restore();
      text(g, "?", x, gy - 30, 22, C.line, "center");
    }
  }
}
// Each tap sends a pulse out along the ground from the middle; cyan in full groove.
function drawRipples(g, app, gy) {
  g.save(); g.scale(1, 0.16);
  for (const r of app.ripples) {
    if (r.t >= 1.2) continue;
    const u = r.t / 1.2;
    g.globalAlpha = 0.7 * (1 - u);
    circle(g, 480, (gy + 2) / 0.16, 30 + 460 * u, r.full ? C.cyan : C.amber, false, 3);
  }
  g.restore();
  g.globalAlpha = 1;
}
// Signal rising from each working machine toward the count at the top; faster as it works harder.
function drawPulses(g, app, gy) {
  const s = app.s;
  g.fillStyle = C.cyan;
  for (let i = 0; i < NP; i++) {
    if (!(s.own[i] > 0)) continue;
    const x0 = 56 + i * (848 / (NP - 1)), y0 = gy - 70, a = app.act[i];
    for (let k = 0; k < 2; k++) {
      const u = (app.phase[i] * 0.25 + k / 2) % 1;
      const x = x0 + (480 - x0) * u * u, y = y0 + (130 - y0) * u;
      g.globalAlpha = (0.25 + 0.55 * a) * Math.sin(Math.PI * u);
      g.fillRect(x - 2, y - 2, 4, 4);
    }
  }
  g.globalAlpha = 1;
}
// Each machine is a few lines; motion speed follows its output (act) and phase.
function structure(g, app, i, x, y, n) {
  const a = app.act[i], ph = app.phase[i], sc = 0.85 + Math.min(0.3, n / 150);
  g.save();
  g.translate(x, y);
  g.scale(sc, sc);
  const ink = C.ink, am = C.amber, cy = C.cyan;
  switch (i) {
    case 0: // dish on a post, nodding
      line(g, 0, 0, 0, -26, ink, 2);
      g.save(); g.translate(0, -30); g.rotate(-0.7 + Math.sin(ph) * 0.3);
      g.beginPath(); g.arc(0, 0, 21, 0.15 * Math.PI, 0.85 * Math.PI); g.strokeStyle = ink; g.lineWidth = 2; g.stroke();
      line(g, 0, 6, 0, -16, am, 2);
      g.restore();
      break;
    case 1: // lattice mast with a beacon
      line(g, -10, 0, 0, -96, ink, 2); line(g, 10, 0, 0, -96, ink, 2);
      for (let k = 1; k < 5; k++) { const w = 10 * (1 - k / 5.5); line(g, -w, -k * 18, w, -k * 18, C.line, 2); }
      circle(g, 0, -100, 4, blink(ph * 0.5, 1) ? am : C.line, true);
      g.globalAlpha = 0.4 + 0.4 * a; circle(g, 0, -100, 9 + 7 * (ph % 1), am, false, 1.5); g.globalAlpha = 1;
      break;
    case 2: { // derrick with a piston
      line(g, -16, 0, 0, -70, ink, 2); line(g, 16, 0, 0, -70, ink, 2); line(g, -8, -35, 8, -35, C.line, 2);
      const pis = -18 - 14 * (0.5 + 0.5 * Math.sin(ph * 3));
      line(g, 0, -70, 0, pis, am, 3);
      break;
    }
    case 3: // a row of tilted panels
      for (let k = -1; k <= 1; k++) {
        const px = k * 24, t = Math.sin(ph * 0.7 + k) * 5;
        line(g, px - 10, -16 + t, px + 10, -34 - t, ink, 2); line(g, px + 10, -34 - t, px + 14, -26 - t, ink, 2);
        line(g, px, 0, px, -22, C.line, 2);
      }
      break;
    case 4: { // borehole: pit with a rising glow
      g.save(); g.scale(1, 0.3); circle(g, 0, 0, 26, ink, false, 3); g.restore();
      for (let k = 0; k < 4; k++) { const u = ((ph * 0.5 + k / 4) % 1); g.globalAlpha = 1 - u; line(g, -4, -u * 80, 4, -u * 80, cy, 3); }
      g.globalAlpha = 1;
      break;
    }
    case 5: { // dome with a slit
      g.beginPath(); g.arc(0, -4, 30, Math.PI, TAU); g.strokeStyle = ink; g.lineWidth = 2; g.stroke();
      line(g, -30, -4, 30, -4, ink, 2);
      const sx = Math.sin(ph * 0.6) * 18;
      line(g, sx, -34, sx, -6, am, 3);
      break;
    }
    case 6: { // archive block with scanning rows
      g.strokeStyle = ink; g.lineWidth = 2; g.strokeRect(-26, -64, 52, 64);
      for (let k = 0; k < 4; k++) line(g, -18, -52 + k * 14, 18, -52 + k * 14, C.line, 2);
      const sy = -62 + ((ph * 0.4) % 1) * 60;
      line(g, -26, sy, 26, sy, am, 3);
      break;
    }
    case 7: { // echo chamber: rings leaving a dome
      g.beginPath(); g.arc(0, 0, 20, Math.PI, TAU); g.strokeStyle = ink; g.lineWidth = 2; g.stroke();
      for (let k = 0; k < 3; k++) { const u = (ph * 0.5 + k / 3) % 1; g.globalAlpha = 1 - u; circle(g, 0, -4, 20 + u * 36, cy, false, 2); }
      g.globalAlpha = 1;
      break;
    }
    case 8: { // three pylons and a crawling arc
      for (let k = -1; k <= 1; k++) line(g, k * 28, 0, k * 28, -66 - (k === 0 ? 18 : 0), ink, 3);
      const j = Math.sin(ph * 2) * 5;
      line(g, -28, -66, -14, -72 + j, am, 2); line(g, -14, -72 + j, 0, -84, am, 2);
      line(g, 0, -84, 14, -72 - j, am, 2); line(g, 14, -72 - j, 28, -66, am, 2);
      break;
    }
    default: { // the great ring, turning
      g.save(); g.translate(0, -50); g.scale(1, 0.55); circle(g, 0, 0, 40, ink, false, 3); g.restore();
      for (let k = 0; k < 8; k++) { const th = ph * 0.5 + (k * TAU) / 8; line(g, Math.cos(th) * 40, -50 + Math.sin(th) * 22, Math.cos(th) * 46, -50 + Math.sin(th) * 25, am, 2); }
      line(g, 0, -50, 0, -110 - 20 * a, cy, 2);
      break;
    }
  }
  g.restore();
  if (n >= 10) { g.save(); g.translate(x - 34, y); g.scale(0.5, 0.5); mini(g, i); g.restore(); }
  if (n >= 25) { g.save(); g.translate(x + 34, y); g.scale(0.5, 0.5); mini(g, i); g.restore(); }
}
function mini(g, i) { // a small post and head, standing for "more of these"
  line(g, 0, 0, 0, -40 - (i % 3) * 10, C.muted, 3);
  circle(g, 0, -44 - (i % 3) * 10, 7, C.muted, false, 2);
}
function drawRing(g, app) {
  const r = app.ring, es = app.entries, e = es[r.idx];
  g.fillStyle = "#0c1511f2";
  g.fillRect(30, 140, 900, 372);
  g.strokeStyle = C.line; g.lineWidth = 2; g.strokeRect(30, 140, 900, 372);
  const title = { exp: "EXPEDITIONS", tree: "BEARING TREE", reloc: "RELOCATE", songs: "SONGBOOK", res: "RESEARCH", goals: "GOALS" }[r.menu] || "BUILD";
  text(g, title, 54, 164, 18, C.amber, "left");
  text(g, r.menu === "res" ? "DATA " + Math.floor(app.s.dat) : "SIGNAL " + fmt(app.s.sig), 906, 164, 18, C.muted, "right");
  // list window of up to 6 rows
  const rows = 6, first = clamp(r.idx - 2, 0, Math.max(0, es.length - rows));
  for (let k = 0; k < rows && first + k < es.length; k++) {
    const it = es[first + k], y = 204 + k * 46, sel = first + k === r.idx;
    if (sel) { g.fillStyle = "#1c3322"; g.fillRect(44, y - 20, 420, 40); g.strokeStyle = it.aff ? C.ink : C.muted; g.lineWidth = 2; g.strokeRect(44, y - 20, 420, 40); }
    const col = it.kind === "close" || it.kind === "back" || it.kind === "info" ? C.muted : it.aff ? C.ink : C.line;
    text(g, (it.aff ? "> " : "  ") + it.label.slice(0, 21), 54, y, 22, sel && !it.aff ? C.muted : col, "left");
    if (it.sub) text(g, it.sub, 456, y, 16, it.aff ? C.amber : C.line, "right");
  }
  if (first + rows < es.length) text(g, "...", 254, 484, 22, C.muted, "center");
  if (!e) return;
  // detail card
  const dwellNeed = e.dwell || DWELL, locked = e.kind !== "close" && e.kind !== "back" && app.clk - r.hiAt < dwellNeed;
  text(g, e.label, 500, 204, 26, C.ink, "left");
  if (e.big) text(g, e.big, 500, 250, 32, e.aff ? C.ink : C.amber, "left");
  if (e.cost > 0 && !e.aff && e.kind !== "node" && e.kind !== "chart") text(g, "NEED " + fmt(e.cost - app.s.sig) + " MORE", 500, 288, 22, C.muted, "left");
  let y = e.cost > 0 && !e.aff && e.kind !== "node" ? 326 : 296;
  for (const ln of e.lines) for (const part of wrapText(ln, 29).slice(0, 2)) { text(g, part, 500, y, 22, C.muted, "left"); y += 28; }
  // hold bar
  const need = e.hold || HOLD_BUY;
  const held = app.down_ && !app.consume ? clamp((app.clk - app.downAt) / need, 0, 1) : 0;
  g.fillStyle = C.dark; g.fillRect(500, 458, 400, 14);
  g.fillStyle = locked ? C.amber : e.aff || FREE_KINDS.includes(e.kind) ? C.ink : C.muted;
  g.fillRect(500, 458, 400 * held, 14);
  const free = FREE_KINDS.includes(e.kind);
  const verb = { sub: "OPEN", panel: "OPEN", mode: "CHANGE", song: "PLAY", songnew: "COMPOSE", research: "START", reloc: "RELOCATE", launch: "CHOOSE", node: "CHOOSE" }[e.kind] || "BUY";
  const label = app.refused ? "NOT NOW" : e.kind === "close" ? "HOLD TO CLOSE" : e.kind === "back" ? "HOLD TO GO BACK" : e.kind === "info" ? "NOTHING TO DO" : locked ? "STEADY..." : e.aff || free ? "HOLD TO " + verb : "CANNOT AFFORD YET";
  text(g, label, 500, 492, 18, app.refused ? C.red : locked ? C.amber : C.ink, "left");
  text(g, "TAP: NEXT", 906, 492, 18, C.muted, "right");
  // an auto-close countdown in the corner
  const left = RING_IDLE - (app.clk - r.last);
  if (left < 3) text(g, "CLOSING " + Math.ceil(left), 906, 188, 16, C.red, "right");
}
function drawAway(g, app) {
  const a = app.away;
  if (!a) return;
  g.fillStyle = "#0c1511f0"; g.fillRect(100, 130, 760, 330);
  g.strokeStyle = C.line; g.lineWidth = 2; g.strokeRect(100, 130, 760, 330);
  text(g, "WHILE YOU WERE AWAY", 480, 168, 26, C.amber, "center");
  let y = 206;
  if (a.sec > 0) {
    text(g, dur(a.sec), 480, y, 32, C.ink, "center"); y += 44;
    text(g, "+" + fmt(a.gain) + " SIGNAL", 480, y, 32, C.ink, "center"); y += 34;
    if (a.capped) { text(g, "CAPPED AT " + capHours(app.s) + " H OF STORAGE", 480, y, 18, C.muted, "center"); y += 26; }
    if (a.data >= 0.5) { text(g, "+" + Math.floor(a.data) + " DATA", 480, y, 18, C.muted, "center"); y += 26; }
  }
  for (const f of a.found.slice(0, 2)) { text(g, f.name + " RETURNED +" + fmt(f.reward) + (f.relic ? " + RELIC" : ""), 480, y, 22, C.cyan, "center"); y += 30; }
  for (const n of a.done.slice(0, 1)) { text(g, "RESEARCH COMPLETE: " + n, 480, y, 22, C.cyan, "center"); y += 30; }
  if (a.note) { text(g, a.note, 480, y, 22, C.red, "center"); y += 30; }
  text(g, "PRESS TO CONTINUE", 480, 432, 22, C.amber, "center");
}
function drawCard(g, app) {
  const c = app.card;
  if (!c) return;
  g.fillStyle = "#0c1511f0"; g.fillRect(100, 130, 760, 330);
  g.strokeStyle = C.line; g.lineWidth = 2; g.strokeRect(100, 130, 760, 330);
  text(g, "OUTPOST RELOCATED", 480, 168, 30, C.cyan, "center");
  text(g, "+" + c.gain + " BEARINGS", 480, 226, 40, C.ink, "center");
  text(g, "RUN SIGNAL " + fmt(c.run) + "  IN " + dur(c.secs), 480, 282, 22, C.muted, "center");
  text(g, "TOTAL BEARINGS " + c.total, 480, 312, 22, C.amber, "center");
  if (c.taps + c.hand + c.mach > 0) text(g, fmtInt(c.taps) + " TAPS   " + Math.round((100 * c.hand) / Math.max(1e-9, c.hand + c.mach)) + "% BY HAND   " + c.stage, 480, 344, 18, C.muted, "center");
  text(g, "EVERYTHING ELSE STARTS AGAIN, FASTER.", 480, 382, 22, C.muted, "center");
  if (app.cardT > 1.2) text(g, app.s.b > 0 ? "PRESS TO SPEND BEARINGS" : "PRESS TO CONTINUE", 480, 424, 22, C.amber, "center");
}
