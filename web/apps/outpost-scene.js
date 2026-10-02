// OUTPOST's scene: everything drawn on the canvas (the place and its machines, the header and
// footer readouts, the build ring, the statistics panel and the cards) and the purely visual
// animation that moves it between frames. Drawing only reads the cartridge (`app`): its saved
// state `app.s` and the fields listed below. stepScene advances the visual-only state and is
// called once per update; nothing here may change game state or draw from ctx.rng (the seeded
// sequences of flares, relics and shuffles are part of the tests).
//
// Fields read from the cartridge: c (only settings().reducedMotion), s, t, clk, phase_, ring, entries, panel, card, cardT, away,
// newsFrom, note, floats, ripples, act, phase, flash, flare, boosts, groove, hum, items, affordN,
// goalName, goalCost, goalFrac, nextGoal, refused, down_, consume, downAt; and the methods
// surge(), effRate(), tapValue(), paceNow(), grooveMult() and pending().
import { C, text, line, circle, diamond, banner, wrapText } from "../engine/draw.js";
import { TAU, clamp } from "../engine/math.js";
import { pulse, blink } from "../engine/lightshow.js";
import {
  CONST, DWELL, EXPED, GOALS, GROOVE_MAX, HOLD_BUY, NG, NP, NR, RES, RING_IDLE, STAGES, UPG, PROD, PC_NAMES, SITES, FINALE_SEC,
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
  for (const f of app.floats) if (f.life > 0) { f.life -= dt; f.y -= dt * 28; }
  if (L.fade < 1) L.fade = Math.min(1, L.fade + dt / 1.6);
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
  drawScene(g, app);
  drawHeader(g, app);
  for (const f of app.floats) {
    if (f.life <= 0) continue;
    g.globalAlpha = clamp(f.life, 0, 1);
    text(g, f.v, f.x, f.y, 22, C.ink, "center");
  }
  g.globalAlpha = 1;
  if (app.flare) drawFlare(g, app);
  if (app.finale) drawFinale(g, app);
  drawFooter(g, app);
  if (app.ring) drawRing(g, app);
  else if (app.panel) drawPanel(g, app);
  else if (app.note && app.phase_ === "play") {
    // story notes (soundings, fragments of the call, new sites) stand out in amber on a framed plate
    const story = !!app.note.story, w = Math.min(920, app.note.text.length * 13.3 + 40);
    if (story) frame(g, 480 - w / 2, 270, w, 44, "#0c1511e0");
    else { g.fillStyle = "#0c1511c0"; g.fillRect(480 - w / 2, 274, w, 36); }
    text(g, app.note.text, 480, 292, 22, story ? C.amber : C.cyan, "center");
  }
  if (app.phase_ === "intro") banner(g, "OUTPOST", "A lone station on a dark world. Tap to gather signal and play its song. Hold to build.");
  else if (app.phase_ === "news") drawNews(g, app);
  else if (app.phase_ === "away") drawAway(g, app);
  else if (app.phase_ === "card") drawCard(g, app);
}
function drawHeader(g, app) {
  const s = app.s;
  text(g, "SIGNAL", 480, 24, 16, C.muted, "center");
  let kick = 9; // seconds since the last tap's ripple: the count jumps a little on each tap
  for (const r of app.ripples) if (r.t < kick) kick = r.t;
  const k = kick < 0.18 ? 1 - kick / 0.18 : 0;
  text(g, fmt(s.sig), 480, 64, 46 + Math.round(6 * k), k > 0.5 ? C.cyan : C.ink, "center");
  const surge = app.surge() > 1 ? " x" + app.surge() : "";
  text(g, "+" + fmtRate(app.effRate()) + " /S" + surge, 480, 104, 26, app.surge() > 1 ? C.cyan : C.amber, "center");
  // the headline figures; everything else is in STATISTICS
  const star = s.fk ? "" : " *";
  text(g, "TAPS", 24, 24, 16, C.muted, "left");
  text(g, fmtInt(s.taps), 24, 50, 24, C.ink, "left");
  text(g, "BY HAND" + star, 24, 84, 16, C.muted, "left");
  text(g, fmt(s.st.hand), 24, 110, 24, C.amber, "left");
  text(g, "PER TAP", 936, 24, 16, C.muted, "right");
  // tapping faster than a steady beat earns less (easy pace): the figure warms as it drops
  const pace = typeof app.paceNow === "function" ? app.paceNow() : 1;
  text(g, "+" + fmt(app.tapValue()), 936, 50, 24, pace < 0.5 ? C.red : pace < 0.95 ? C.amber : C.ink, "right");
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
  const site = SITES[s.site];
  if (site) text(g, site.n, 24, 524, 14, C.muted, "left"); // where the outpost stands
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
// ---- the place ---------------------------------------------------------------------------------
// The place grows with the station: a ridge from the start, then a fence, power poles, huts with
// lit windows, a radar, orbiting satellites and finally an aurora. Everything that stands still
// (sky, stars, far world, constellations, ridges, props, ground, each machine's body) is painted
// once into an offscreen layer and drawn with one drawImage a frame; only what moves is drawn
// live. A new stage cross-fades in. Without OffscreenCanvas (the node tests) every painter runs
// straight onto the frame instead, so the same code runs either way. Gradients are made once per
// context and reused, never per frame.
const GY = 440; // the ground line
const SIL = "#0b130f"; // machine and hut silhouettes
const FAR = [[0, 396], [120, 384], [230, 398], [330, 376], [430, 392], [540, 380], [650, 396], [740, 382], [850, 394], [960, 386]];
const machineX = (i) => 56 + i * (848 / (NP - 1)); // twelve machines across the width
// Fleet copies behind a machine as more are owned: [owned, dx, dy, scale].
const FLEET = [[10, -26, -3, 0.42], [25, 26, -3, 0.42], [50, -13, -9, 0.32], [100, 13, -9, 0.32]];
const POLES = [40, 240, 440, 640, 840];

// Each site's look (SITES[k].terrain): the far and near ridge, sky top and horizon colours, the
// ground, the ridge's lit edge, and what else stands there. A missing field keeps the plain look.
const prof = (f, step = 30) => { const out = []; for (let x = 0; x <= 960; x += step) out.push([x, Math.round(f(x))]); return out; };
const sn = (x, p, a) => a * Math.sin((x / 960) * TAU * p);
const bowl = (x) => ((x - 480) / 480) ** 2;
const TERRAIN = {
  plain: {},
  ridge: { far: prof((x) => 330 - 120 * Math.exp(-(((x - 300) / 110) ** 2)) - 70 * Math.exp(-(((x - 560) / 90) ** 2)) + sn(x, 7, 12), 16), farEdge: "#3a4f44", near: prof((x) => 398 - 70 * Math.exp(-(((x - 640) / 150) ** 2)) + sn(x, 5, 9), 20), top: "#02060a", hz: "#1a2a30", snow: true },
  basin: { far: prof((x) => 404 - 170 * bowl(x) + sn(x, 9, 6), 20), near: prof((x) => 434 - 90 * bowl(x) + sn(x, 6, 4), 20), hz: "#24221a", ground: ["#161a10", "#050604"], edge: "#3a3a26" },
  flats: { far: prof((x) => 410 + sn(x, 2, 3)), near: prof((x) => 433 + sn(x, 4, 2)), hz: "#34403a", ground: ["#2b362e", "#111813"], edge: "#4a5c50", cracks: true },
  glacier: { far: prof((x) => 348 + sn(x, 4, 30) + sn(x, 9, 9), 16), near: prof((x) => 402 + sn(x, 3, 14), 20), hz: "#16302f", ground: ["#14221f", "#050a0a"], edge: "#3d6a66", crevasses: true },
  canyon: { near: [[0, 214], [60, 228], [110, 296], [150, 376], [190, 426], [260, 434], [700, 434], [770, 426], [810, 376], [850, 296], [900, 228], [960, 214]], hz: "#2a2318", edge: "#3a2f22", ground: ["#18140e", "#060504"], strata: true },
  crater: { far: prof((x) => 400 - 110 * Math.sqrt(Math.max(0, 1 - ((x - 480) / 400) ** 2)), 20), near: prof((x) => 428 + sn(x, 5, 5)), hz: "#2a2a20" },
  coast: { far: prof(() => 398), farFill: "#0f2a29", farEdge: "#3d726b", near: prof((x) => 440 - 44 * Math.max(0, 1 - x / 240) - 44 * Math.max(0, (x - 720) / 240), 20), hz: "#173033", sea: true },
  fumaroles: { near: prof((x) => 414 + sn(x, 4, 12) + sn(x, 11, 5), 16), hz: "#2c2219", ground: ["#1c1a12", "#070604"], vents: true },
  shelf: { far: prof((x) => 372 + (x % 240 < 130 ? 0 : 12), 10), near: prof((x) => 420 + sn(x, 2, 6)), hz: "#173033", edge: "#2c5550", aurora: true },
  dunes: { far: prof((x) => 382 + sn(x, 2, 22) + sn(x, 5, 8), 16), near: prof((x) => 416 + sn(x, 3, 16) + sn(x, 7, 5), 16), hz: "#2e2a1c", ground: ["#211e14", "#080705"], edge: "#4a4028" },
  silent: { far: prof(() => 404), near: prof(() => 436), top: "#000000", hz: "#0d2426", ground: ["#0a1212", "#020404"], edge: "#2a5a58" },
};
const VENTS = [170, 330, 610, 790];
const terrainOf = (app) => { const site = SITES[app.s && app.s.site]; return (site && TERRAIN[site.terrain]) ? site.terrain : "plain"; };

// The star field, the band of faint stars across it and the few bright ones that twinkle, from a
// fixed local sequence (visual only; ctx.rng is never touched). [x, y, size, alpha, colour]
const STARS = [], TWINKLE = [];
{
  let a = 7919;
  const r = () => (a = (a * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 120; k++) {
    const s = 0.6 + 1.4 * r() * r();
    STARS.push([r() * 960, Math.pow(r(), 1.3) * 400, s, 0.2 + 0.4 * (s / 2), r() < 0.15 ? C.cyan : r() < 0.2 ? C.amber : C.muted]);
  }
  for (let k = 0; k < 140; k++) { // the band, from low left to high right
    const u = r();
    STARS.push([u * 960, 300 - u * 230 + (r() + r() + r() - 1.5) * 40, 0.6 + 0.6 * r(), 0.12 + 0.18 * r(), C.muted]);
  }
  for (let k = 0; k < 8; k++) TWINKLE.push([40 + r() * 880, 10 + r() * 230, 1.6 + r(), r() * 6]);
}
const PEBBLES = [];
{
  let a = 104729;
  const r = () => (a = (a * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 30; k++) { const y = GY + 6 + Math.pow(r(), 0.7) * 92; PEBBLES.push([r() * 960, y, 1 + (y - GY) / 30]); }
}

const grads = new WeakMap(); // context -> name -> gradient, so no gradient is ever made twice
function gradient(g, name, make) {
  let m = grads.get(g);
  if (!m) grads.set(g, (m = new Map()));
  let v = m.get(name);
  if (!v) { v = make(); m.set(name, v); }
  return v;
}
function linear(g, name, y0, y1, stops) {
  return gradient(g, name, () => { const v = g.createLinearGradient(0, y0, 0, y1); for (const [at, col] of stops) v.addColorStop(at, col); return v; });
}
function radial(g, name, x, y, r0, r1, stops) {
  return gradient(g, name, () => { const v = g.createRadialGradient(x, y, r0, x, y, r1); for (const [at, col] of stops) v.addColorStop(at, col); return v; });
}

// An offscreen layer w x h at the frame's scale, or null where there is no OffscreenCanvas.
function surface(w, h, k) {
  if (typeof OffscreenCanvas !== "function") return null;
  try {
    const c = new OffscreenCanvas(Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)));
    const g = c.getContext("2d");
    if (!g) return null;
    g.scale(k, k);
    return { c, g };
  } catch { return null; }
}
// Once painted, a layer becomes an ImageBitmap where it can: Chromium snapshots an OffscreenCanvas
// on every drawImage, which made each small light cost as much as a whole layer.
function freeze(v) {
  if (v && typeof v.c.transferToImageBitmap === "function") { try { v.c = v.c.transferToImageBitmap(); } catch { /* keep the canvas */ } }
  return v;
}
// The scale the host draws at (1 today; sharper layers if it ever draws at a higher resolution).
function scaleOf(g) {
  const m = typeof g.getTransform === "function" ? g.getTransform() : null;
  return m && m.a > 0 ? clamp(Math.round(m.a * 4) / 4, 0.5, 3) : 1;
}
const L = { k: 0, owner: null, stage: -1, cn: -1, tr: "", back: null, prev: null, fade: 1, glow: null, aurora: null, bodies: [] };
function layers(g, app, stage) {
  const k = scaleOf(g);
  if (k !== L.k) {
    L.k = k; L.stage = -1; L.prev = null; L.bodies = [];
    L.glow = [C.amber, C.cyan, C.ink].map((col) => { const v = surface(64, 64, k); if (v) paintGlow(v.g, col); return freeze(v); });
    L.aurora = surface(960, 130, k);
    if (L.aurora) { paintAurora(L.aurora.g); freeze(L.aurora); }
  }
  const cn = app.s.cn, tr = terrainOf(app);
  if (stage !== L.stage || cn !== L.cn || tr !== L.tr || app !== L.owner) {
    const v = surface(960, 540, k);
    if (v) { paintBack(v.g, stage, cn, true, tr); freeze(v); }
    // a stage reached in play fades in over the old one; a launch or a new chart just appears
    L.prev = app === L.owner && stage !== L.stage && L.back && v ? L.back : null;
    L.fade = L.prev ? 0 : 1;
    L.back = v; L.stage = stage; L.cn = cn; L.tr = tr; L.owner = app;
  }
}
// Forget every cached layer (tests switch OffscreenCanvas on and off; the console never does).
export function resetSceneCache() { L.k = 0; L.owner = null; L.stage = -1; L.cn = -1; L.tr = ""; L.back = null; L.prev = null; L.fade = 1; L.glow = null; L.aurora = null; L.bodies = []; }
function body(i) {
  if (L.bodies[i] === undefined) {
    const v = surface(100, 150, L.k || 1);
    if (v) { v.g.translate(50, 140); paintBody(v.g, i); freeze(v); }
    L.bodies[i] = v;
  }
  return L.bodies[i];
}

// A soft round light; kind 0 amber, 1 cyan, 2 ink. Squashed into an ellipse when rx != ry.
function glow(g, kind, x, y, rx, ry, alpha) {
  if (!(alpha > 0.01)) return;
  const v = L.glow && L.glow[kind];
  g.globalAlpha = Math.min(1, alpha);
  if (v) g.drawImage(v.c, x - rx, y - ry, 2 * rx, 2 * ry);
  else { g.globalAlpha *= 0.35; g.fillStyle = kind === 1 ? C.cyan : kind === 2 ? C.ink : C.amber; g.fillRect(x - rx * 0.5, y - ry * 0.5, rx, ry); }
  g.globalAlpha = 1;
}
function paintGlow(g, col) {
  g.fillStyle = radial(g, "glow", 32, 32, 0, 32, [[0, col + "ff"], [0.22, col + "99"], [0.55, col + "2a"], [1, col + "00"]]);
  g.fillRect(0, 0, 64, 64);
}
// Three curtains of light, periodic across the width so the strip can scroll without a seam.
function paintAurora(g) {
  const cols = [C.cyan, C.amber, C.cyan];
  for (let k = 0; k < 3; k++) {
    const top = (x) => 22 + k * 16 + 12 * Math.sin((x / 960) * TAU * 2 + k * 2) + 7 * Math.sin((x / 960) * TAU * 5 - k);
    g.beginPath();
    g.moveTo(0, top(0));
    for (let x = 16; x <= 960; x += 16) g.lineTo(x, top(x));
    for (let x = 960; x >= 0; x -= 16) g.lineTo(x, top(x) + 46 + 10 * Math.sin((x / 960) * TAU * 3 + k));
    g.closePath();
    g.fillStyle = linear(g, "aur" + k, 10 + k * 16, 100 + k * 16, [[0, cols[k] + "88"], [0.35, cols[k] + "33"], [1, cols[k] + "00"]]);
    g.fill();
    g.beginPath();
    g.moveTo(0, top(0));
    for (let x = 16; x <= 960; x += 16) g.lineTo(x, top(x));
    g.strokeStyle = cols[k]; g.globalAlpha = 0.6; g.lineWidth = 1.5; g.stroke(); g.globalAlpha = 1;
  }
}

// `rich` is false when painting straight onto the frame (no OffscreenCanvas): the faint band of
// stars and the stones on the ground are left out there to keep that frame cheap.
function paintBack(g, stage, cn, rich, tr = "plain") {
  const T = TERRAIN[tr] || TERRAIN.plain, hz = T.hz || HORIZON[Math.min(stage, HORIZON.length - 1)];
  // sky: near black overhead, the console green, then the horizon glow that warms as the station grows
  g.fillStyle = linear(g, "sky" + stage + tr, 0, GY, [[0, T.top || "#050a08"], [0.5, C.bg], [1, hz]]);
  g.fillRect(0, 0, 960, GY);
  for (let k = 0, n = rich ? STARS.length : 50; k < n; k++) { const [x, y, s, a, col] = STARS[k]; g.globalAlpha = a; g.fillStyle = col; g.fillRect(x, y, s, s); }
  g.globalAlpha = 1;
  paintWorld(g, stage);
  paintCharts(g, cn);
  // the far ridge in haze, then the near ridge as a silhouette with a lit edge
  ridge(g, T.far || FAR, T.farFill || "#0f1914", T.farEdge || "#1a2a20");
  if (T.sea) { // the still sea, with long swells
    g.strokeStyle = "#2a5552"; g.lineWidth = 1; g.beginPath();
    for (let y = 404; y < GY; y += 7) for (let x = (y * 37) % 90; x < 960; x += 150) { g.moveTo(x, y); g.lineTo(x + 40 + (y % 3) * 14, y); }
    g.stroke();
    for (const x of [300, 640]) { // two old wrecks out on the water
      g.fillStyle = "#081211"; g.beginPath(); g.moveTo(x - 22, 400); g.lineTo(x + 26, 400); g.lineTo(x + 16, 410); g.lineTo(x - 14, 410); g.closePath(); g.fill();
      line(g, x, 400, x + 3, 372, "#1d3b38", 2);
    }
  }
  if (!T.sea) { // haze over the far ridge (the sea needs none)
    g.fillStyle = linear(g, "haze" + stage + tr, 370, GY, [[0, hz + "00"], [1, hz + "99"]]);
    g.fillRect(0, 370, 960, GY - 370);
  }
  ridge(g, T.near || HILLS, "#0a110d", T.edge || C.dark);
  if (T.snow) { // snow on the high peaks
    const far = T.far; g.beginPath();
    for (let k = 1; k < far.length; k++) if (far[k][1] < 290 && far[k - 1][1] < 290) { g.moveTo(far[k - 1][0], far[k - 1][1]); g.lineTo(far[k][0], far[k][1]); }
    g.strokeStyle = "#7d9a90"; g.lineWidth = 3; g.stroke();
  }
  if (T.strata) { // bands in the canyon walls
    g.strokeStyle = "#2a2219"; g.lineWidth = 1; g.beginPath();
    for (let y = 244; y < 420; y += 16) { const w = 40 + (y - 214) * 0.72; g.moveTo(0, y); g.lineTo(w, y + 4); g.moveTo(960, y); g.lineTo(960 - w, y + 4); }
    g.stroke();
  }
  if (T.vents) for (const x of VENTS) { // low mounds round each vent
    g.beginPath(); g.moveTo(x - 24, GY); g.quadraticCurveTo(x, GY - 22, x + 24, GY); g.fillStyle = "#14110b"; g.fill();
    g.strokeStyle = "#3a2f22"; g.lineWidth = 2; g.stroke();
  }
  if (stage >= 1) { // a fence of posts and one wire
    g.strokeStyle = C.line; g.lineWidth = 2;
    g.beginPath();
    for (let x = 12; x < 960; x += 48) { g.moveTo(x, GY); g.lineTo(x, GY - 16); }
    g.moveTo(0, GY - 12); g.lineTo(960, GY - 12);
    g.stroke();
  }
  if (stage >= 2) { // power poles with a sagging line
    g.strokeStyle = C.line; g.lineWidth = 2;
    g.beginPath();
    for (const x of POLES) {
      g.moveTo(x, GY); g.lineTo(x, GY - 78); g.moveTo(x - 12, GY - 72); g.lineTo(x + 12, GY - 72);
      if (x + 200 < 960) { g.moveTo(x + 12, GY - 72); g.quadraticCurveTo(x + 100, GY - 54, x + 188, GY - 72); }
    }
    g.stroke();
  }
  if (stage >= 3) for (const x of [4, 930]) { // two huts, windows lit live
    g.beginPath(); g.moveTo(x, GY); g.lineTo(x, GY - 24); g.lineTo(x + 13, GY - 34); g.lineTo(x + 26, GY - 24); g.lineTo(x + 26, GY); g.closePath();
    g.fillStyle = SIL; g.fill(); g.strokeStyle = C.line; g.lineWidth = 2; g.stroke();
  }
  if (stage >= 4) { // the radar's mast on the ridge
    line(g, 880, 398, 880, 412, C.line, 3);
    g.save(); g.translate(880, 396); g.scale(1, 0.55); circle(g, 0, 0, 34, C.line, false, 2); g.restore();
  }
  if (stage >= 5) { // the satellites' orbit
    g.save(); g.setLineDash([3, 9]); g.translate(480, 212); g.scale(1, 0.18); circle(g, 0, 0, 420, C.line, false, 2); g.restore();
  }
  // the ground: dark falling away, tracks running out from the middle, stones, and the old dashes
  const gr = T.ground || ["#121e16", "#040706"];
  g.fillStyle = linear(g, "ground" + tr, GY, 540, [[0, gr[0]], [1, gr[1]]]);
  g.fillRect(0, GY, 960, 540 - GY);
  if (T.cracks || T.crevasses) { // salt polygons, or long cracks in the ice
    g.strokeStyle = T.cracks ? "#2a362d" : "#2a4c49"; g.lineWidth = 1; g.beginPath();
    for (let k = 0; k < 18; k++) {
      const x = (k * 157) % 960, y = GY + 10 + ((k * 53) % 90);
      if (T.cracks) { g.moveTo(x, y); g.lineTo(x + 30, y - 6); g.lineTo(x + 58, y + 3); g.moveTo(x + 30, y - 6); g.lineTo(x + 34, y + 14); }
      else { g.moveTo(x, y); g.lineTo(x + 50 + (k % 4) * 20, y + 2 + (k % 3)); }
    }
    g.stroke();
  }
  g.strokeStyle = "#132017"; g.lineWidth = 1;
  g.beginPath();
  for (let k = -3; k <= 3; k++) if (k) { g.moveTo(480 + k * 36, GY + 2); g.lineTo(480 + k * 250, 540); }
  g.stroke();
  g.fillStyle = "#172419";
  if (rich) for (const [x, y, s] of PEBBLES) g.fillRect(x, y, s * 1.4, s * 0.7);
  g.strokeStyle = C.dark; g.lineWidth = 2;
  g.beginPath();
  for (let x = 30; x < 960; x += 90) { g.moveTo(x, GY + 8); g.lineTo(x + 40, GY + 8); }
  g.stroke();
}
function ridge(g, pts, fill, edge) {
  g.beginPath();
  for (let k = 0; k < pts.length; k++) (k ? g.lineTo : g.moveTo).call(g, pts[k][0], pts[k][1]);
  g.lineTo(960, GY); g.lineTo(0, GY); g.closePath();
  g.fillStyle = fill; g.fill();
  g.beginPath();
  for (let k = 0; k < pts.length; k++) (k ? g.lineTo : g.moveTo).call(g, pts[k][0], pts[k][1]);
  g.strokeStyle = edge; g.lineWidth = 2; g.stroke();
}
// A far world low in the sky: a dark banded disc lit from the right, with a thin atmosphere.
function paintWorld(g, stage) {
  const x = 800, y = 300, r = 54, lit = stage >= 6 ? C.cyan : C.muted;
  g.save();
  g.beginPath(); g.arc(x, y, r, 0, TAU); g.clip();
  g.fillStyle = radial(g, "world", x + 22, y - 10, 4, r + 26, [[0, "#2c3d33"], [0.5, "#16211b"], [1, "#0a100d"]]);
  g.fillRect(x - r, y - r, 2 * r, 2 * r);
  g.globalAlpha = 0.12; g.strokeStyle = C.line; g.lineWidth = 2;
  for (let k = -2; k <= 2; k++) { g.beginPath(); g.ellipse(x, y + k * 17, r, 5, -0.18, 0, TAU); g.stroke(); }
  g.restore();
  g.globalAlpha = 0.85;
  g.beginPath(); g.arc(x, y, r, -0.5 * Math.PI, 0.5 * Math.PI); g.arc(x + 12, y, r - 2, 0.5 * Math.PI, -0.5 * Math.PI, true);
  g.fillStyle = lit; g.fill();
  g.globalAlpha = 0.3; circle(g, x, y, r + 3, lit, false, 2);
  g.globalAlpha = 1;
}
// Charted constellations, faint in the sky: twelve places, later charts drawn over them brighter.
function paintCharts(g, n) {
  if (!n) return;
  const shown = Math.min(n, CONST.length);
  for (let k = 0; k < shown; k++) {
    const [name, stars, links] = CONST[k];
    const col = k % 6, row = Math.floor(k / 6);
    const x0 = 30 + col * 152 + (row ? 66 : 0), y0 = 176 + row * 70 + (col % 2) * 18, w = 70, h = 40;
    const deep = Math.floor((n - 1 - k) / CONST.length) + 1; // how many times this place has been charted
    g.globalAlpha = Math.min(0.75, 0.22 + 0.12 * deep);
    g.strokeStyle = deep > 1 ? C.cyan : C.line; g.lineWidth = 1;
    g.beginPath();
    for (const [a, b] of links) { g.moveTo(x0 + stars[a][0] * w, y0 + stars[a][1] * h); g.lineTo(x0 + stars[b][0] * w, y0 + stars[b][1] * h); }
    g.stroke();
    for (const [sx, sy] of stars) glow(g, deep > 1 ? 1 : 2, x0 + sx * w, y0 + sy * h, 5, 5, Math.min(0.9, 0.35 + 0.15 * deep));
    g.globalAlpha = Math.min(0.45, 0.16 + 0.08 * deep);
    text(g, name, x0 + w / 2, y0 + h + 12, 11, deep > 1 ? C.cyan : C.muted, "center");
  }
  g.globalAlpha = 1;
}

// What moves in the backdrop: twinkling stars, a meteor now and then, pole lamps, hut windows,
// the radar, the satellites and the aurora's drift. `still` is the Reduced Motion setting.
function drawLive(g, app, stage, still) {
  const t = app.t, T = TERRAIN[terrainOf(app)];
  if (T.vents) for (let k = 0; k < VENTS.length; k++) { // steam rising from each vent
    for (let j = 0; j < 2; j++) {
      const u = ((still ? 0.4 : t * 0.18) + k * 0.31 + j * 0.5) % 1;
      glow(g, 2, VENTS[k] + Math.sin(u * 5 + k) * 10 * u, GY - 14 - u * 110, 10 + 26 * u, 8 + 20 * u, 0.22 * Math.sin(Math.PI * u));
    }
  }
  g.fillStyle = C.ink;
  for (const [x, y, s, ph] of TWINKLE) { g.globalAlpha = 0.3 + 0.6 * pulse(t * 0.23 + ph); g.fillRect(x - s / 2, y - s / 2, s, s); }
  g.globalAlpha = 1;
  if (!still) { // a meteor every 17 s, somewhere new each time
    const n = Math.floor(t / 17), u = t - n * 17;
    if (u < 0.7) {
      const h = ((n * 2654435761) >>> 0) / 4294967296, x = 160 + h * 640, y = 30 + ((h * 97) % 1) * 110, d = u / 0.7;
      g.globalAlpha = 0.8 * (1 - d);
      line(g, x - 90 * d, y + 26 * d, x - 90 * d - 40, y + 26 * d + 12, C.ink, 1.5);
      g.globalAlpha = 1;
    }
  }
  if (stage >= 2) { g.fillStyle = C.amber; for (const x of POLES) if (blink(t * 0.4 + x, 1)) g.fillRect(x - 3, GY - 83, 6, 6); }
  if (stage >= 3) for (const x of [4, 930]) {
    const a = 0.55 + 0.3 * pulse(t * 0.2 + x);
    g.globalAlpha = a; g.fillStyle = C.amber; g.fillRect(x + 9, GY - 18, 8, 7); g.globalAlpha = 1;
    glow(g, 0, x + 13, GY - 14, 22, 14, a * 0.35);
  }
  if (stage >= 4) { const a = still ? 0.6 : t * 0.9; line(g, 880, 396, 880 + Math.cos(a) * 34, 396 + Math.sin(a) * 18, C.amber, 2); }
  if (stage >= 5) for (let k = 0; k < 2; k++) {
    const a = t * 0.12 + k * Math.PI, x = 480 + Math.cos(a) * 420, y = 212 + Math.sin(a) * 76;
    diamond(g, x, y, 5, C.cyan, true);
    if (blink(t * 0.5 + k * 0.5, 1)) glow(g, 1, x, y, 10, 10, 0.7);
  }
  if (stage >= 6 || T.aurora) {
    const v = L.aurora, breathe = 0.4 + 0.12 * Math.sin(t * 0.37);
    if (v) {
      const o = still ? 0 : (t * 9) % 960, y = 172 + (still ? 0 : 6 * Math.sin(t * 0.21));
      g.globalAlpha = breathe; g.drawImage(v.c, -o, y, 960, 130); g.drawImage(v.c, 960 - o, y, 960, 130);
      g.globalAlpha = 1;
    } else { g.save(); g.translate(0, 172); g.globalAlpha = breathe; paintAurora(g); g.restore(); g.globalAlpha = 1; }
  }
}

// The call answered: a cyan dawn over the horizon and rings leaving the station, while app.finale lasts.
function drawFinale(g, app) {
  const t = app.finale.t || 0, u = clamp(t / FINALE_SEC, 0, 1), fade = Math.min(1, t * 2) * (1 - u);
  glow(g, 1, 480, GY, 640, 220, 0.55 * fade);
  for (let k = 0; k < 3; k++) {
    const w = (t * 0.5 + k / 3) % 1;
    g.globalAlpha = 0.6 * fade * (1 - w);
    g.save(); g.translate(480, GY - 40); g.scale(1, 0.4); circle(g, 0, 0, 40 + w * 560, k === 1 ? C.amber : C.cyan, false, 3); g.restore();
  }
  g.globalAlpha = 1;
}
function drawFlare(g, app) {
  const f = app.flare, k = f.t / f.life, r = 12 + 10 * Math.sin(app.t * 6);
  glow(g, 0, f.x, f.y, 70 + 20 * Math.sin(app.t * 3), 70 + 20 * Math.sin(app.t * 3), 0.55);
  diamond(g, f.x, f.y, r, C.amber, true);
  circle(g, f.x, f.y, 26 + 14 * (1 - k), C.amber, false, 2);
  g.globalAlpha = 0.5; circle(g, f.x, f.y, 44 + 60 * ((app.t * 0.8) % 1), C.amber, false, 1); g.globalAlpha = 1;
  text(g, "FLARE - TAP", f.x, f.y + 44, 22, C.amber, "center");
}
function drawScene(g, app) {
  const s = app.s, stage = stageOf(s);
  const still = !!(app.c && typeof app.c.settings === "function" && app.c.settings()?.reducedMotion);
  layers(g, app, stage);
  if (L.back) {
    if (L.prev) g.drawImage(L.prev.c, 0, 0, 960, 540);
    g.globalAlpha = L.fade; g.drawImage(L.back.c, 0, 0, 960, 540); g.globalAlpha = 1;
    if (L.fade >= 1) L.prev = null;
  } else paintBack(g, stage, s.cn, false);
  drawLive(g, app, stage, still);
  // the horizon carries the groove: amber while it builds, cyan when it is full
  const gf = Math.floor(app.groove) / GROOVE_MAX;
  line(g, 0, GY, 960, GY, gf >= 1 ? C.cyan : gf > 0 ? C.line : C.line, 2);
  if (gf > 0) { g.globalAlpha = 0.25 + 0.5 * gf; line(g, 480 - 470 * gf, GY, 480 + 470 * gf, GY, gf >= 1 ? C.cyan : C.amber, 2); g.globalAlpha = 1; }
  drawRipples(g, app);
  let ghost = -1;
  for (let i = 0; i < NP; i++) { // light pools under working machines, drawn first so bodies stand in them
    if (s.own[i] > 0) glow(g, app.flash[i] > 0 || humOf(app, i) > 0 ? 1 : 0, machineX(i), GY + 3, 50, 10, 0.12 + 0.4 * app.act[i] + 0.5 * app.flash[i]);
  }
  for (let i = 0; i < NP; i++) {
    const x = machineX(i), n = s.own[i];
    if (n > 0) {
      const hum = humOf(app, i);
      // a humming machine trembles and shows the note it is tuned to; the letter blinks as it runs out
      machine(g, app, i, hum > 0 ? x + Math.sin(app.t * 47 + i) * 0.9 : x, n);
      const tone = hum > 0 && (hum > 2 || blink(app.t, 3)) ? " " + (PC_NAMES[PROD[i].pc] || "") : "";
      text(g, "x" + n + tone, x, GY + 26, 16, app.flash[i] > 0 || hum > 0 ? C.cyan : C.muted, "center");
      if (app.flash[i] > 0) {
        circle(g, x, GY - 40, 30 + 40 * (1 - app.flash[i]), C.cyan, false, 2);
        glow(g, 1, x, GY - 40, 60, 60, 0.6 * app.flash[i]);
      }
    } else if (ghost < 0 && i <= s.maxTier + 1 && prodVisible(s, i)) {
      ghost = i;
      g.save(); g.setLineDash([4, 6]); circle(g, x, GY - 30, 22, C.line, false, 2); g.restore();
      text(g, "?", x, GY - 30, 22, C.line, "center");
    }
  }
  drawPulses(g, app);
}
// Each tap sends a pulse out along the ground from the middle; cyan in full groove.
function drawRipples(g, app) {
  g.save(); g.scale(1, 0.16);
  for (const r of app.ripples) {
    if (r.t >= 1.2) continue;
    const u = r.t / 1.2;
    g.globalAlpha = 0.7 * (1 - u);
    circle(g, 480, (GY + 2) / 0.16, 30 + 460 * u, r.full ? C.cyan : C.amber, false, 3);
  }
  g.restore();
  g.globalAlpha = 1;
}
// Signal rising from each working machine toward the count at the top; faster as it works harder.
function drawPulses(g, app) {
  const s = app.s;
  for (let i = 0; i < NP; i++) {
    if (!(s.own[i] > 0)) continue;
    const x0 = machineX(i), y0 = GY - 70, a = app.act[i];
    for (let k = 0; k < 2; k++) {
      const u = (app.phase[i] * 0.25 + k / 2) % 1, f = (0.35 + 0.65 * a) * Math.sin(Math.PI * u);
      glow(g, 1, x0 + (480 - x0) * u * u, y0 + (130 - y0) * u, 6, 6, f);
    }
  }
  g.globalAlpha = 1;
}

// Seconds of hum left on machine i (0 when quiet, or before the cartridge had hum).
const humOf = (app, i) => (app.hum && app.hum[i] > 0 ? app.hum[i] : 0);
// A machine: its fleet behind it (more copies as more are owned), its body from the cache, then
// the moving part. Motion speed follows its output (act) and phase.
function machine(g, app, i, x, n) {
  const sc = 0.86 + Math.min(0.16, n / 300), v = body(i);
  for (const [need, dx, dy, k] of FLEET) {
    if (n < need) break;
    g.globalAlpha = 0.55;
    if (v) g.drawImage(v.c, x + dx - 50 * k, GY + dy - 140 * k, 100 * k, 150 * k);
    else { g.save(); g.translate(x + dx, GY + dy); g.scale(k, k); paintBody(g, i); g.restore(); }
    g.globalAlpha = 1;
  }
  if (v) g.drawImage(v.c, x - 50 * sc, GY - 140 * sc, 100 * sc, 150 * sc);
  g.save();
  g.translate(x, GY);
  g.scale(sc, sc);
  if (!v) paintBody(g, i);
  motion(g, app, i);
  g.restore();
}
// The still part of each machine, about 70 wide at most, origin at its foot. Dark fills so a
// machine hides what stands behind it; lit windows in amber.
function paintBody(g, i) {
  const ink = C.ink, ln = C.line;
  g.lineWidth = 2; g.strokeStyle = ink; g.fillStyle = SIL;
  switch (i) {
    case 0: // receiver dish: tripod, post and a box at the foot
      line(g, -14, 0, 0, -22, ln, 2); line(g, 14, 0, 0, -22, ln, 2); line(g, 0, 0, 0, -28, ink, 2);
      g.fillStyle = SIL; g.fillRect(-9, -8, 18, 8); g.strokeStyle = ln; g.strokeRect(-9, -8, 18, 8);
      break;
    case 1: { // lattice mast with guy wires
      line(g, -26, 0, 0, -70, "#22352a", 1); line(g, 26, 0, 0, -70, "#22352a", 1);
      line(g, -10, 0, 0, -96, ink, 2); line(g, 10, 0, 0, -96, ink, 2);
      g.beginPath();
      for (let k = 0; k < 5; k++) { const w0 = 10 * (1 - k / 5.5), w1 = 10 * (1 - (k + 1) / 5.5); g.moveTo(-w0, -k * 18); g.lineTo(w1, -(k + 1) * 18); g.moveTo(-w1, -(k + 1) * 18); g.lineTo(w1, -(k + 1) * 18); }
      g.strokeStyle = ln; g.lineWidth = 1.5; g.stroke();
      break;
    }
    case 2: // derrick, a crossbar and a shed with a lit window
      g.fillRect(8, -16, 22, 16); g.strokeStyle = ln; g.strokeRect(8, -16, 22, 16);
      g.fillStyle = C.amber; g.fillRect(19, -11, 6, 5);
      line(g, -16, 0, 0, -70, ink, 2); line(g, 16, 0, 0, -70, ink, 2); line(g, -8, -35, 8, -35, ln, 2); line(g, -12, -17, 12, -17, ln, 2);
      line(g, -4, -70, 4, -70, ink, 3);
      break;
    case 3: // array field: posts on a rail, the panels move
      line(g, -34, 0, 34, 0, ln, 3);
      for (let k = -1; k <= 1; k++) line(g, k * 22, 0, k * 22, -22, ln, 2);
      break;
    case 4: // borehole: a pit, a headframe and its wheel
      g.save(); g.scale(1, 0.3); g.beginPath(); g.arc(0, 0, 26, 0, TAU); g.fillStyle = "#040706"; g.fill(); g.strokeStyle = ink; g.lineWidth = 3; g.stroke(); g.restore();
      line(g, -22, -2, 0, -56, ln, 2); line(g, 22, -2, 0, -56, ln, 2);
      circle(g, 0, -56, 8, ink, false, 2);
      break;
    case 5: // observatory: a building with two windows and a dome
      g.fillRect(-30, -20, 60, 20); g.strokeStyle = ln; g.strokeRect(-30, -20, 60, 20);
      g.fillStyle = C.amber; g.fillRect(-20, -13, 6, 6); g.fillRect(14, -13, 6, 6);
      g.beginPath(); g.arc(0, -20, 26, Math.PI, TAU); g.closePath(); g.fillStyle = SIL; g.fill(); g.strokeStyle = ink; g.lineWidth = 2; g.stroke();
      break;
    case 6: // archive vault: a block of shelves, a lit door and an aerial
      g.fillRect(-26, -64, 52, 64); g.strokeStyle = ink; g.strokeRect(-26, -64, 52, 64);
      g.beginPath(); for (let k = 0; k < 4; k++) { g.moveTo(-18, -54 + k * 11); g.lineTo(18, -54 + k * 11); } g.strokeStyle = ln; g.stroke();
      g.fillStyle = C.amber; g.globalAlpha = 0.8; g.fillRect(-5, -12, 10, 12); g.globalAlpha = 1;
      line(g, 18, -64, 18, -84, ln, 2);
      break;
    case 7: // echo chamber: a dome on a step
      g.fillRect(-26, -6, 52, 6); g.strokeStyle = ln; g.strokeRect(-26, -6, 52, 6);
      g.beginPath(); g.arc(0, -6, 20, Math.PI, TAU); g.closePath(); g.fillStyle = SIL; g.fill(); g.strokeStyle = ink; g.lineWidth = 2; g.stroke();
      g.fillStyle = C.amber; g.fillRect(-3, -14, 6, 8);
      break;
    case 8: // phase lattice: three pylons with insulators
      for (let k = -1; k <= 1; k++) {
        const h = 66 + (k === 0 ? 18 : 0);
        line(g, k * 28, 0, k * 28, -h, ink, 3);
        line(g, k * 28 - 7, -h + 10, k * 28 + 7, -h + 10, ln, 2); line(g, k * 28 - 5, -h + 18, k * 28 + 5, -h + 18, ln, 2);
      }
      break;
    case 9: // deep-sky array: a great ring on an A-frame
      line(g, -20, 0, -4, -50, ln, 3); line(g, 20, 0, 4, -50, ln, 3); line(g, -12, -24, 12, -24, ln, 2);
      g.save(); g.translate(0, -56); g.scale(1, 0.55);
      g.beginPath(); g.arc(0, 0, 34, 0, TAU); g.fillStyle = "#08100c"; g.fill(); g.strokeStyle = ink; g.lineWidth = 3; g.stroke();
      circle(g, 0, 0, 22, ln, false, 2);
      g.restore();
      break;
    case 10: // zero-point listener: a caged sphere on a tripod
      line(g, -18, 0, -6, -34, ln, 2); line(g, 18, 0, 6, -34, ln, 2); line(g, 0, 0, 0, -32, ln, 2);
      g.fillRect(-12, -36, 24, 4);
      g.beginPath(); g.arc(0, -56, 20, 0, TAU); g.fillStyle = "#070d0a"; g.fill(); g.strokeStyle = ink; g.lineWidth = 2; g.stroke();
      g.save(); g.translate(0, -56);
      for (const w of [0.35, 0.75]) { g.save(); g.scale(w, 1); circle(g, 0, 0, 20, ln, false, 1.5 / w); g.restore(); }
      g.restore();
      line(g, -20, -56, 20, -56, ln, 1.5);
      break;
    default: { // silent array: a tall dark slab between two lower ones
      for (const [x0, h, w] of [[-30, 70, 16], [14, 70, 16], [-12, 112, 24]]) {
        g.fillStyle = "#050907"; g.fillRect(x0, -h, w, h);
        g.strokeStyle = ln; g.lineWidth = 1.5; g.strokeRect(x0, -h, w, h);
      }
      line(g, -12, -112, 12, -112, C.cyan, 2);
      break;
    }
  }
  g.globalAlpha = 1;
}
// The moving part of each machine, drawn live in the machine's frame.
function motion(g, app, i) {
  const a = app.act[i], ph = app.phase[i], ink = C.ink, am = C.amber, cy = C.cyan;
  switch (i) {
    case 0: // the dish nods
      g.save(); g.translate(0, -30); g.rotate(-0.7 + Math.sin(ph) * 0.3);
      g.beginPath(); g.arc(0, 0, 21, 0.15 * Math.PI, 0.85 * Math.PI); g.closePath();
      g.fillStyle = SIL; g.fill(); g.strokeStyle = ink; g.lineWidth = 2; g.stroke();
      line(g, 0, 6, 0, -16, am, 2);
      g.restore();
      break;
    case 1: { // the beacon
      const on = blink(ph * 0.5, 1);
      circle(g, 0, -100, 4, on ? am : C.line, true);
      if (on) glow(g, 0, 0, -100, 16, 16, 0.5 + 0.4 * a);
      g.globalAlpha = 0.4 + 0.4 * a; circle(g, 0, -100, 9 + 7 * (ph % 1), am, false, 1.5); g.globalAlpha = 1;
      break;
    }
    case 2: // the piston
      line(g, 0, -70, 0, -18 - 14 * (0.5 + 0.5 * Math.sin(ph * 3)), am, 3);
      break;
    case 3: { // three panels tracking the sky
      g.beginPath();
      for (let k = -1; k <= 1; k++) {
        const px = k * 22, t = Math.sin(ph * 0.7 + k) * 5;
        g.moveTo(px - 10, -16 + t); g.lineTo(px + 10, -34 - t); g.lineTo(px + 13, -28 - t); g.lineTo(px - 7, -10 + t); g.closePath();
      }
      g.fillStyle = "#14251c"; g.fill(); g.strokeStyle = ink; g.lineWidth = 2; g.stroke();
      break;
    }
    case 4: { // light rising out of the pit, the wheel turning
      g.fillStyle = cy;
      for (let k = 0; k < 4; k++) { const u = (ph * 0.5 + k / 4) % 1; g.globalAlpha = (1 - u) * (0.5 + 0.5 * a); g.fillRect(-5, -u * 80 - 1.5, 10, 3); }
      g.globalAlpha = 1;
      line(g, 0, -56, Math.cos(ph) * 8, -56 + Math.sin(ph) * 8, am, 2);
      break;
    }
    case 5: { // the slit sweeping, with a faint beam up into the sky
      const sx = Math.sin(ph * 0.6) * 16, top = -20 - Math.sqrt(26 * 26 - sx * sx);
      line(g, sx, top, sx, -22, am, 3);
      g.globalAlpha = 0.12 + 0.25 * a; line(g, sx, top, sx * 4, top - 140, am, 2); g.globalAlpha = 1;
      break;
    }
    case 6: // the scan line
      line(g, -26, -62 + ((ph * 0.4) % 1) * 60, 26, -62 + ((ph * 0.4) % 1) * 60, am, 3);
      break;
    case 7: // rings leaving the dome
      for (let k = 0; k < 3; k++) { const u = (ph * 0.5 + k / 3) % 1; g.globalAlpha = 1 - u; circle(g, 0, -10, 20 + u * 34, cy, false, 2); }
      g.globalAlpha = 1;
      break;
    case 8: { // an arc crawling between the pylons
      const j = Math.sin(ph * 2) * 5;
      g.beginPath(); g.moveTo(-28, -66); g.lineTo(-14, -72 + j); g.lineTo(0, -84); g.lineTo(14, -72 - j); g.lineTo(28, -66);
      g.strokeStyle = am; g.lineWidth = 2; g.stroke();
      glow(g, 0, 0, -84, 12, 12, 0.3 + 0.5 * a);
      break;
    }
    case 9: { // the ring turning, a beam to the sky
      g.beginPath();
      for (let k = 0; k < 8; k++) {
        const th = ph * 0.5 + (k * TAU) / 8, c = Math.cos(th), s = Math.sin(th);
        g.moveTo(c * 34, -56 + s * 18.7); g.lineTo(c * 40, -56 + s * 22);
      }
      g.strokeStyle = am; g.lineWidth = 2; g.stroke();
      g.globalAlpha = 0.5 + 0.4 * a; line(g, 0, -56, 0, -120 - 20 * a, cy, 2); g.globalAlpha = 1;
      break;
    }
    case 10: { // the core breathing, one mote circling it
      const p = 0.5 + 0.5 * Math.sin(ph * 1.3);
      glow(g, 1, 0, -56, 16 + 8 * p, 16 + 8 * p, 0.45 + 0.4 * a);
      circle(g, 0, -56, 4 + 2 * p, cy, true);
      g.fillStyle = ink; g.fillRect(Math.cos(ph) * 26 - 1.5, -56 + Math.sin(ph) * 9 - 1.5, 3, 3);
      break;
    }
    default: { // light climbing the slab, a halo leaving its top
      const u = (ph * 0.3) % 1;
      g.globalAlpha = 0.4 + 0.5 * a; g.fillStyle = cy; g.fillRect(-12, -6 - u * 104, 24, 2);
      g.globalAlpha = 0.6 * (1 - u); circle(g, 0, -112, 10 + u * 40, cy, false, 1.5);
      g.globalAlpha = 1;
      break;
    }
  }
}
// A card or panel: a dark plate, a thin border and amber corner brackets.
function frame(g, x, y, w, h, fill) {
  g.fillStyle = fill; g.fillRect(x, y, w, h);
  g.strokeStyle = C.line; g.lineWidth = 2; g.strokeRect(x, y, w, h);
  const c = 14, r = x + w, b = y + h;
  g.beginPath();
  g.moveTo(x, y + c); g.lineTo(x, y); g.lineTo(x + c, y);
  g.moveTo(r - c, y); g.lineTo(r, y); g.lineTo(r, y + c);
  g.moveTo(r, b - c); g.lineTo(r, b); g.lineTo(r - c, b);
  g.moveTo(x + c, b); g.lineTo(x, b); g.lineTo(x, b - c);
  g.strokeStyle = C.amber; g.lineWidth = 2; g.stroke();
}
function drawPanel(g, app) {
  const s = app.s, st = s.st, pg = app.panel.page;
  frame(g, 30, 140, 900, 372, "#0c1511f6");
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
// The "updated" card. The cartridge says what is new (newsCard: a title and up to six lines, each
// a string or [text, tone]); the first line is bright, the rest alternate so they read as a list.
const TONES = { ink: C.ink, muted: C.muted, amber: C.amber, cyan: C.cyan, red: C.red };
function drawNews(g, app) {
  const card = typeof app.newsCard === "function" ? app.newsCard() : null;
  const title = (card && card.title) || "OUTPOST UPDATED", lines = (card && Array.isArray(card.lines) ? card.lines : []).slice(0, 6);
  frame(g, 100, 130, 760, 330, "#0c1511f0");
  text(g, title, 480, 168, 30, C.cyan, "center");
  const step = lines.length > 5 ? 30 : 34, y0 = 216;
  lines.forEach((ln, k) => {
    const [v, tone] = Array.isArray(ln) ? ln : [ln, null];
    const last = k === lines.length - 1 && /^NOTHING WAS LOST/.test(String(v));
    text(g, String(v).slice(0, 56), 480, y0 + k * step + (last ? 8 : 0), last ? 18 : 20, TONES[tone] || (last ? C.muted : k % 2 ? C.muted : C.ink), "center");
  });
  text(g, "PRESS TO CONTINUE", 480, 424, 22, C.amber, "center");
}
function drawRing(g, app) {
  const r = app.ring, es = app.entries, e = es[r.idx];
  frame(g, 30, 140, 900, 372, "#0c1511f2");
  const title = { exp: "EXPEDITIONS", tree: "BEARING TREE", reloc: "RELOCATE", site: "SOUNDINGS", songs: "SONGBOOK", res: "RESEARCH", goals: "GOALS" }[r.menu] || "BUILD";
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
  // what a machine or its upgrade looks like, standing in the corner of the detail card
  const mi = e.kind === "prod" ? e.i : e.kind === "upg" && UPG[e.i] && UPG[e.i].kind === "prod" ? UPG[e.i].i : -1;
  if (mi >= 0 && mi < NP) showcase(g, app, mi, 862, 440);
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
function showcase(g, app, i, x, y) {
  glow(g, 0, x, y + 2, 44, 8, 0.25 + 0.3 * app.act[i]);
  line(g, x - 40, y, x + 40, y, C.line, 2);
  const v = body(i), sc = 1;
  if (v) g.drawImage(v.c, x - 50 * sc, y - 140 * sc, 100 * sc, 150 * sc);
  g.save(); g.translate(x, y); g.scale(sc, sc);
  if (!v) paintBody(g, i);
  motion(g, app, i);
  g.restore();
}
function drawAway(g, app) {
  const a = app.away;
  if (!a) return;
  frame(g, 100, 130, 760, 330, "#0c1511f0");
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
  frame(g, 100, 130, 760, 330, "#0c1511f0");
  text(g, "OUTPOST RELOCATED", 480, 168, 30, C.cyan, "center");
  text(g, "+" + c.gain + " BEARINGS", 480, 226, 40, C.ink, "center");
  text(g, "RUN SIGNAL " + fmt(c.run) + "  IN " + dur(c.secs), 480, 282, 22, C.muted, "center");
  text(g, "TOTAL BEARINGS " + c.total, 480, 312, 22, C.amber, "center");
  if (c.taps + c.hand + c.mach > 0) text(g, fmtInt(c.taps) + " TAPS   " + Math.round((100 * c.hand) / Math.max(1e-9, c.hand + c.mach)) + "% BY HAND   " + c.stage, 480, 344, 18, C.muted, "center");
  const to = SITES[c.site], from = SITES[c.from];
  if (to) text(g, "NOW AT " + to.n + (from && c.from !== c.site ? ", FROM " + from.n : ""), 480, 382, 22, C.cyan, "center");
  else text(g, "EVERYTHING ELSE STARTS AGAIN, FASTER.", 480, 382, 22, C.muted, "center");
  if (app.cardT > 1.2) text(g, app.s.b > 0 ? "PRESS TO SPEND BEARINGS" : "PRESS TO CONTINUE", 480, 424, 22, C.amber, "center");
}
