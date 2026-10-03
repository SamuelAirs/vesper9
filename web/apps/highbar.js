// HIGH BAR: a one-button trick game in a skate park. The rider rolls a bowl, airs off its walls
// and swings on bars above it. One button does everything, depending on where the rider is:
//   on a bar in reach (the marked one): hold to grab it and swing (a rigid pendulum, as in Perihelion),
//   release to fly off on the tangent;
//   on the ground: hold to crouch (pumping the slope for speed), release to ollie;
//   in the air with no bar in reach: hold to tuck and flip, release to untuck and settle.
// Landing upright banks the combo after a short roll; landing crooked is a bail and loses it.
// A session is two minutes in one park. Each park has five goals; three open the next park.
// Saves keep all three existing slots (schema 2). Case taps style the line: manual, shove-it, regrip.
// Repeated tricks earn less and do not grow the multiplier. Practice teaches the same physics.
// The lamps show what the button will do: the flip's angle in the
// air (green: safe to land), the swing on a bar, the combo's roll window on the ground.
import { C } from "../engine/draw.js";
import { TAU, clamp, wrapAngle, Random } from "../engine/math.js";
import { LAMP, dim, fill, meter, spot, pulse } from "../engine/lightshow.js";
import { AppGuard } from "../engine/input.js";
import { LampBus, LOCKOUT, announce } from "./game-kit.js";

import { G, STEP, LIP_ANGLE, MAX_SPEED, FRICTION, PUMP, PUSH_MIN, OLLIE, REACH, CATCH_LAG, REGRAB, TUCK, SETTLE, LAND_TOL, ROLL, BAIL_T, SESSION, OVERTIME, HOLD_PICK, WHIP_GAIN, SLOTS, MAX_TRICKS, MAX_PARTS, REPEAT, FLIPS, FLIP_PTS, MODES, MANUAL_LIMIT, TAP_COOLDOWN, STYLE_TIME, MEDALS, GUIDE, LINES, PARKS, UNLOCK, PUSH, MIN_R, WHIP_CAP } from "./highbar-content.js";
import { HighBarView } from "./highbar-view.js";

// The park's ground as heights every STEP px, plus its lips (where the walls turn vert).
function buildPark(park) {
  const n = Math.ceil(park.w / STEP) + 1, hm = new Float32Array(n);
  const { floor: F, r: R, w: W } = park;
  const cut = R - R * Math.sin(LIP_ANGLE), lipY = F - R + R * Math.cos(LIP_ANGLE);
  for (let i = 0; i < n; i++) {
    const x = i * STEP;
    let y = F;
    if (x < R) { const u = Math.max(x, cut) - R; y = F - R + Math.sqrt(Math.max(0, R * R - u * u)); }
    else if (x > W - R) { const u = Math.min(x, W - cut) - (W - R); y = F - R + Math.sqrt(Math.max(0, R * R - u * u)); }
    for (const [c, h, wd] of park.bumps) y -= h * Math.exp(-(((x - c) / wd) ** 2));
    hm[i] = y;
  }
  return { hm, lipL: cut, lipR: W - cut, lipY };
}

// Far-off buildings behind the park, drawn with parallax: [x, width, height, lit window x, lit window y].
function skyline(park, seed) {
  const rng = new Random(9001 + seed), out = [];
  for (let x = -200; x < park.w * 0.4 + 1100; x += rng.range(50, 110)) {
    const w = rng.range(40, 90), h = rng.range(60, 220);
    out.push([x, w, h, rng.range(6, w - 10), rng.range(10, h - 12)]);
  }
  return out;
}
const fmt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const freshSlot = () => ({ runs: 0, park: 0, goals: PARKS.map(() => []), best: PARKS.map(() => 0), bestCombo: 0, last: null,
  guided: false, mode: 0, line: 0, lines: PARKS.map(() => []), medals: PARKS.map(() => 0),
  styleBest: PARKS.map(() => 0), lineBest: PARKS.map(() => [0, 0, 0]), clean: 0,
  lineComboBest: PARKS.map(() => [0, 0, 0]), lineTimeBest: PARKS.map(() => [0, 0, 0]), lineMedals: PARKS.map(() => [0, 0, 0]) });

// Preserve schema-1 slots and active selection. New skill records never overwrite old score records.
export function migrateSave(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const num = (v, lo, hi, d = 0) => (Number.isFinite(v) ? clamp(Math.floor(v), lo, hi) : d);
  const slots = [];
  for (let s = 0; s < SLOTS; s++) {
    const o = Array.isArray(src.slots) && src.slots[s] && typeof src.slots[s] === "object" ? src.slots[s] : {};
    const slot = freshSlot();
    slot.runs = num(o.runs, 0, 1e7);
    slot.bestCombo = num(o.bestCombo, 0, 1e9);
    slot.guided = o.guided === true;
    slot.mode = num(o.mode, 0, MODES.length - 1);
    slot.line = num(o.line, 0, 2);
    slot.clean = num(o.clean, 0, 1e7);
    for (let p = 0; p < PARKS.length; p++) {
      const g = Array.isArray(o.goals) && Array.isArray(o.goals[p]) ? o.goals[p] : [];
      slot.goals[p] = [...new Set(g.filter((i) => Number.isInteger(i) && i >= 0 && i < PARKS[p].goals.length))].sort();
      slot.best[p] = Array.isArray(o.best) ? num(o.best[p], 0, 1e9) : 0;
      slot.styleBest[p] = num(o.styleBest?.[p], 0, 1e9);
      slot.medals[p] = num(o.medals?.[p], 0, 3);
      slot.lines[p] = [...new Set((Array.isArray(o.lines?.[p]) ? o.lines[p] : []).filter((i) => Number.isInteger(i) && i >= 0 && i < 3))].sort();
      slot.lineBest[p] = [0, 1, 2].map((i) => num(o.lineBest?.[p]?.[i], 0, 1e9));
      slot.lineComboBest[p] = [0, 1, 2].map(i => num(o.lineComboBest?.[p]?.[i], 0, 1e9));
      slot.lineMedals[p] = [0, 1, 2].map(i => num(o.lineMedals?.[p]?.[i], 0, 3));
      slot.lineTimeBest[p] = [0, 1, 2].map(i => Number.isFinite(o.lineTimeBest?.[p]?.[i])
        ? Math.round(clamp(o.lineTimeBest[p][i], 0, SESSION + OVERTIME) * 100) / 100 : 0);
    }
    slot.park = num(o.park, 0, PARKS.length - 1);
    if (!unlocked(slot, slot.park)) slot.park = 0;
    if (o.last && typeof o.last === "object") slot.last = { score: num(o.last.score, 0, 1e9), combo: num(o.last.combo, 0, 1e9), park: String(o.last.park || "").slice(0, 24) };
    slots.push(slot);
  }
  const slot = num(src.slot, 0, SLOTS - 1);
  return finishSave({ schema: 2, slot, slots });
}
function unlocked(slot, p) { return p === 0 || slot.goals[p - 1].length >= UNLOCK; }
// The host reads runs, milestone and last at the top level: they follow the current slot.
function finishSave(save) {
  const s = save.slots[save.slot];
  save.runs = s.runs;
  save.milestone = s.goals.reduce((n, g) => n + g.length, 0);
  save.last = s.last;
  return save;
}

export class HighBar extends HighBarView {
  constructor(ctx) {
    super();
    this.c = ctx;
    this.lamps = new LampBus(ctx);
    this.save = migrateSave(ctx.progress?.());
    this.parkId = this.slot().park;
    this.hm = null; this.hmFor = -1; this.geo = null;
    this.phase = "title";
    this.t = 0; this.pt = 0; this.pressed = false; this.armed = false;
    this.cursor = 0; this.erase = 0; // setup screen
    this.overT = 0;
    this.guide = 0;
    this.mode = this.slot().mode;
    this.note = ""; this.noteT = 0;
    this.board = 0; this.boardSent = false;
    this.hudKey = "";
    this.practiceStart = 0; this.practiceCheckpoint = null;
    this.practiceSlow = false; this.resumeT = 0;
    this.resetRun();
    this.setHint("Tap to ride. Hold for park and save slot.");
    this.guard = new AppGuard(this, ctx, { skip: ["hm", "hmFor", "geo", "sky"] });
  }
  slot() { return this.save.slots[this.save.slot]; }
  park() { return PARKS[this.parkId]; }
  setHint(s) { this.hintText = s; this.c.hint?.(s); }
  // The heightmap is rebuilt whenever the park changes (it is skipped by the rewind, so it follows parkId).
  ensurePark() {
    if (this.hmFor === this.parkId) return;
    const b = buildPark(this.park());
    this.hm = b.hm; this.geo = { lipL: b.lipL, lipR: b.lipR, lipY: b.lipY }; this.hmFor = this.parkId;
    this.sky = skyline(this.park(), this.parkId);
  }
  groundY(x) {
    const hm = this.hm, f = clamp(x / STEP, 0, hm.length - 1.001), i = Math.floor(f);
    return hm[i] + (hm[i + 1] - hm[i]) * (f - i);
  }
  slope(x) { return (this.groundY(x + 2) - this.groundY(x - 2)) / 4; }
  bend(x) { return (this.groundY(x + STEP) - 2 * this.groundY(x) + this.groundY(x - STEP)) / (STEP * STEP); }

  resetRun() {
    this.ensurePark();
    const g = this.geo;
    this.score = 0; this.clock = SESSION; this.ending = false;
    this.runTime = 0; this.resumeT = 0; this.landing = null; this.lastBank = null;
    if (this.practiceCheckpoint?.park !== this.parkId) this.practiceCheckpoint = null;
    this.p = { mode: "ground", x: g.lipL + 4, y: 0, s: 160, vx: 0, vy: 0, rot: 0, rotV: 0, tuck: false, crouch: false, vert: 0,
      bar: -1, r: 0, phi: 0, om: 0, held: 0, loops: 0, phiAcc: 0, lastBar: -1, lastBarT: 9, bailT: 0 };
    this.p.y = this.groundY(this.p.x);
    this.p.rot = Math.atan(this.slope(this.p.x));
    this.air = null;
    this.pending = null;
    this.combo = this.freshCombo();
    this.bestCombo = 0; this.newGoals = [];
    this.manual = null; this.tapAt = -Infinity; this.styleNotice = "";
    this.stats = { airs: 0, clean: 0, bails: 0, banks: 0, variety: 0, lines: 0 };
    this.lineMet = false;
    this.parts = [];
    this.popups = [];
    this.trail = [];
    this.camX = 0; this.camY = 0;
    this.placeCamera(true);
  }
  freshCombo() { return { tricks: [], sum: 0, roll: -1, giants: 0, maxFlip: 0, gaps: [],
    airs: 0, clean: false, manual: false, regrip: false, shove: false, transfers: 0,
    cleanLandings: 0, landings: 0, sketchy: 0, started: this.runTime || 0 }; }

  // ---- input -------------------------------------------------------------
  down() {
    this.guard.mark();
    if (this.pressed) return;
    this.pressed = true; this.pt = this.t;
    if (this.phase !== "play") { this.armed = !(this.phase === "over" && this.overT < LOCKOUT); return; }
    if (this.resumeT > 0) return;
    const p = this.p;
    if (p.mode === "bail") return;
    const bar = this.pickBar();
    if (bar >= 0 && p.mode !== "bar") { this.pending = { bar, t: CATCH_LAG }; return; }
    if (p.mode === "ground") p.crouch = true;
    else if (p.mode === "air") this.tuckIn();
  }
  up(e) {
    this.guard.release();
    if (!this.pressed) return;
    this.pressed = false;
    const dur = Number.isFinite(e?.durationMs) ? e.durationMs / 1000 : this.t - this.pt;
    if (this.phase !== "play") {
      // A completed ordinary selection hold is not one of the gesture's two
      // quick taps. The source-owned duration also settles burst-delivered
      // holds even when the render clock has not advanced between their edges.
      if (dur >= HOLD_PICK) this.guard.settle();
      if (this.armed) this.menuPress(dur); this.armed = false; return;
    }
    if (this.resumeT > 0) return;
    const p = this.p;
    this.pending = null;
    if (p.mode === "bar") this.letGo();
    else if (p.mode === "ground" && p.crouch) this.ollie();
    p.crouch = false; p.tuck = false;
  }
  cancel() {
    const restored = this.guard.rewind();
    this.lamps.clear();
    this.boardOff();
    this.pressed = false; this.armed = false; this.pending = null;
    if (this.p) { this.p.crouch = false; this.p.tuck = false; if (this.p.mode === "bar" && !restored) this.letGo(); }
  }
  pause() { this.guard.settle(); this.lamps.sleep(); this.boardOff(); }
  resume() { this.lamps.wake(); if (this.phase === "play") this.resumeT = 0.6; }
  dispose() { this.guard.settle(); this.lamps.sleep(); this.boardOff(); }
  menuActions() {
    const guide = { label: "GAME GUIDE", run: () => { this.guideReturn = this.phase; this.phase = "guide"; this.guide = 0; this.c.resume?.(); } };
    if (this.phase !== "play") return [
      ...(this.phase === "over" ? [{ label: this.mode === 1 ? "RETRY THIS LINE" : this.mode === 2 ? "RETRY PRACTICE" : "RIDE AGAIN", run: () => { this.start(); this.c.resume?.(); } }] : []), guide];
    return [{ label: this.mode === 2 ? "LEAVE PRACTICE" : "END SESSION", run: () => { this.finish(); this.c.resume?.(); } },
      { label: "RESTART SESSION", run: () => { this.start(); this.c.resume?.(); } },
      ...(this.mode === 2 ? [
        { label: "RESET PRACTICE START", run: () => { this.resetPractice(); this.c.resume?.(); } },
        ...(this.practiceCheckpoint?.park === this.parkId ? [{ label: "RESET TO LAST SAFE BANK", run: () => { this.resetPractice(true); this.c.resume?.(); } }] : []),
        { label: "PRACTICE PACE / " + (this.practiceSlow ? "HALF SPEED" : "NORMAL"), run: () => { this.practiceSlow = !this.practiceSlow; this.c.resume?.(); } },
        { label: "CHANGE PRACTICE START", run: () => { this.phase = "setup"; this.cursor = this.setupItems().findIndex(i => i.id === "start"); this.c.resume?.(); } },
      ] : []), guide];
  }
  // A forgiving optional style action; never a button edge or a menu choice.
  knock(event = {}) {
    if (this.phase === "guide") { this.guide = (this.guide + GUIDE.length - 1) % GUIDE.length; return; }
    if (this.phase === "setup" && !this.pressed) {
      const step = this.c.settings?.().tapMode === "sides" && event.side === "right" ? 1 : -1;
      this.cursor = (this.cursor + step + this.setupItems().length) % this.setupItems().length;
      this.erase = 0; this.c.tone?.(440, 0.03, "sine"); return;
    }
    if (this.phase === "over") { if (!this.pressed && this.overT >= LOCKOUT) this.start(); return; }
    if (this.phase !== "play" || this.resumeT > 0 || this.p.mode === "bail" || this.t - this.tapAt < TAP_COOLDOWN) return;
    this.tapAt = this.t;
    const p = this.p;
    const side = this.c.settings?.().tapMode === "sides" ? event.side : null;
    if (p.mode === "ground") {
      if (this.manual) {
        const direction = side === "left" ? -1 : side === "right" ? 1 : -Math.sign(this.manual.balance || this.manual.drift);
        this.manual.balance = clamp(this.manual.balance + direction * 0.43, -1.2, 1.2);
        this.manual.corrections++;
        this.styleNotice = Math.abs(this.manual.balance) < 0.3 ? "BALANCE CENTRED — LET IT DRIFT BEFORE TAPPING" : "MANUAL: TAP BEFORE THE BALANCE REACHES THE EDGE";
      } else {
        this.manual = { t: 0, balance: 0.12, drift: 1, corrections: 0 };
        this.combo.roll = -1;
        this.styleNotice = "MANUAL: BUTTON RELEASE POPS OUT";
      }
    } else if (p.mode === "air" && this.air && !this.air.style) {
      if (!this.canStyle()) {
        announce(this, "TOO LOW TO STYLE — LAND FIRST", 1.1); return;
      }
      this.air.style = { at: this.air.t, dir: side === "left" ? -1 : side === "right" ? 1 : (Math.sign(p.vx) || 1) };
      this.styleNotice = "SHOVE-IT: RELEASE TO STRAIGHTEN";
      this.c.tone?.(620, 0.06, "triangle");
    } else if (p.mode === "bar" && !p.regrip && p.held > 0.15) {
      p.regrip = true;
      p.om = Math.sign(p.om || 1) * Math.min(Math.abs(p.om) * 1.08 + 0.12, Math.max(Math.abs(p.om), WHIP_CAP / p.r));
      this.styleNotice = "REGRIP: RELEASE UPWARD FOR A HIGH LINE";
      this.c.tone?.(760, 0.05, "triangle");
    }
  }
  endManual() {
    const m = this.manual;
    if (!m) return;
    if (m.t >= 0.6) { this.trick("MANUAL", Math.round(80 + Math.min(m.t, MANUAL_LIMIT) * 35)); this.combo.manual = true; }
    this.manual = null;
  }
  // A fast descent can cover the old 65 px window before a shove-it completes.
  // Preview the same ground/wall boundaries, including a rising bowl transition,
  // so an accepted tap has time to finish instead of only making landing harder.
  canStyle() {
    const p = this.p;
    if (p.mode !== "air" || !this.air || this.air.style || this.air.t < 0.1) return false;
    let x = p.x, y = p.y, vx = p.vx, vy = p.vy;
    const h = STYLE_TIME / 8, g = this.geo;
    for (let i = 0; i < 8; i++) {
      if (p.vert) { vy += G * h; y += vy * h; }
      else {
        x += vx * h; y += vy * h + 0.5 * G * h * h; vy += G * h;
        if (x < g.lipL) { x = g.lipL; vx = Math.abs(vx) * 0.4; }
        if (x > g.lipR) { x = g.lipR; vx = -Math.abs(vx) * 0.4; }
      }
      if (p.vert ? vy > 0 && y >= g.lipY : y >= this.groundY(x)) return false;
    }
    return true;
  }

  // A finished press on the title, setup or result screen.
  menuPress(dur) {
    const long = dur >= HOLD_PICK;
    if (this.phase === "guide") {
      if (long || ++this.guide >= GUIDE.length) {
        if (this.guideReturn) { this.phase = this.guideReturn; this.guideReturn = null; if (this.phase === "play") this.resumeT = 0.6; return; }
        this.slot().guided = true; this.persist(); this.start();
      }
      return;
    }
    if (this.phase === "title" || this.phase === "over") {
      if (long) { this.phase = "setup"; this.cursor = 0; this.erase = 0; this.setHint("Tap: next line. Hold: choose."); this.c.tone?.(520, 0.05, "triangle"); }
      else if (!this.slot().guided) { this.phase = "guide"; this.guide = 0; this.guideReturn = null; }
      else this.start();
      return;
    }
    if (this.phase !== "setup") return;
    const items = this.setupItems();
    if (!long) { this.cursor = (this.cursor + 1) % items.length; this.erase = 0; this.c.tone?.(440, 0.03, "sine"); return; }
    const id = items[this.cursor].id;
    if (id === "ride") {
      if (this.slot().guided) this.start();
      else { this.phase = "guide"; this.guide = 0; this.guideReturn = null; }
    }
    else if (id === "park") {
      const s = this.slot();
      let p = this.parkId;
      do p = (p + 1) % PARKS.length; while (!unlocked(s, p));
      this.parkId = p; s.park = p; this.practiceStart = 0; this.practiceCheckpoint = null;
      this.persist(); this.ensurePark(); this.resetRun();
      this.c.tone?.(620, 0.05, "triangle");
    } else if (id === "slot") {
      this.save.slot = (this.save.slot + 1) % SLOTS; finishSave(this.save);
      this.parkId = this.slot().park; this.mode = this.slot().mode; this.practiceStart = 0; this.practiceCheckpoint = null;
      this.persist(); this.ensurePark(); this.resetRun();
      this.c.tone?.(580, 0.05, "triangle");
    } else if (id === "erase") {
      if (!this.erase) { this.erase = 1; this.c.tone?.(300, 0.08, "square"); return; }
      this.save.slots[this.save.slot] = freshSlot(); finishSave(this.save);
      this.parkId = 0; this.mode = 0; this.practiceStart = 0; this.practiceCheckpoint = null;
      this.persist(); this.ensurePark(); this.resetRun(); this.erase = 0;
      announce(this, "SLOT " + (this.save.slot + 1) + " ERASED", 2);
      this.c.tone?.(200, 0.2, "sawtooth");
    } else if (id === "mode") { this.mode = (this.mode + 1) % MODES.length; this.slot().mode = this.mode; this.persist(); }
    else if (id === "line") { this.slot().line = (this.slot().line + 1) % 3; this.persist(); }
    else if (id === "start") { this.practiceStart = (this.practiceStart + 1) % this.practiceSpawns().length; }
    else if (id === "pace") this.practiceSlow = !this.practiceSlow;
    else if (id === "guide") { this.guideReturn = "setup"; this.phase = "guide"; this.guide = 0; }
    else if (id === "back") { this.phase = "title"; this.setHint("Tap to ride. Hold for park and save slot."); }
  }
  setupItems() {
    const s = this.slot(), used = s.runs > 0;
    return [
      { id: "ride", label: "RIDE " + this.park().name },
      { id: "park", label: "PARK: " + this.park().name },
      { id: "slot", label: "SAVE SLOT: " + (this.save.slot + 1) + (used ? "  (" + s.runs + " SESSIONS)" : "  (NEW)") },
      { id: "erase", label: this.erase ? "HOLD AGAIN TO ERASE SLOT " + (this.save.slot + 1) : "ERASE SLOT " + (this.save.slot + 1) },
      { id: "mode", label: "MODE: " + MODES[this.mode] },
      { id: "line", label: "LINE: " + this.challenge().name + (this.mode === 2 ? "  (PRACTICE TARGET)" : "  (" + this.lineSeconds() + "s)") },
      ...(this.mode === 2 ? [{ id: "start", label: "START: " + this.practiceSpawns()[this.practiceStart % this.practiceSpawns().length].name },
        { id: "pace", label: "PRACTICE PACE: " + (this.practiceSlow ? "HALF SPEED" : "NORMAL") }] : []),
      { id: "guide", label: "GAME GUIDE" },
      { id: "back", label: "BACK" },
    ];
  }

  start() {
    this.resetRun();
    this.clock = this.mode === 1 ? this.lineSeconds() : SESSION;
    this.phase = "play";
    if (this.mode === 2) this.placePractice(this.practiceSpawns()[this.practiceStart % this.practiceSpawns().length]);
    announce(this, this.mode === 1 ? this.challenge().name : this.mode === 2 ? "PRACTICE — NO CLOCK OR RECORDS" : this.park().name, 2.2);
    this.setHint("Near a bar: hold to swing. Ground: hold to pump, let go to ollie. Air: hold to flip.");
    this.c.tone?.(660, 0.08, "triangle");
  }
  practiceSpawns() {
    return [{ id: "drop", name: "DROP-IN" },
      ...(this.park().training ? [{ id: "training", name: "FLAT SCHOOL", ...this.park().training }] : []),
      ...(this.practiceCheckpoint?.park === this.parkId ? [{ id: "checkpoint", name: "LAST SAFE BANK", checkpoint: true }] : [])];
  }
  practiceLabel() { return this.practiceSpawns()[this.practiceStart % this.practiceSpawns().length].name; }
  placePractice(spawn) {
    if (spawn?.checkpoint && this.practiceCheckpoint?.park === this.parkId) {
      const q = this.practiceCheckpoint;
      Object.assign(this.p, { x: q.x, s: q.s, y: this.groundY(q.x), rot: Math.atan(this.slope(q.x)) });
    } else if (Number.isFinite(spawn?.x)) {
      const x = clamp(spawn.x, this.geo.lipL + 4, this.geo.lipR - 4);
      Object.assign(this.p, { x, s: clamp(spawn.speed || 220, -MAX_SPEED, MAX_SPEED), y: this.groundY(x), rot: Math.atan(this.slope(x)) });
    }
    this.placeCamera(true);
  }
  resetPractice(checkpoint = false) {
    if (this.mode !== 2) return;
    const restoring = checkpoint && this.practiceCheckpoint?.park === this.parkId;
    if (restoring) this.practiceStart = this.practiceSpawns().findIndex(spawn => spawn.checkpoint);
    this.start();
    this.resumeT = 0.6; this.pressed = false; this.armed = false;
    announce(this, restoring ? "LAST SAFE BANK — TRY THE NEXT LINK" : "PRACTICE RESET — NO RECORDS", 1.6);
  }

  // ---- the rider ---------------------------------------------------------
  // The bar a press would grab now (or -1): the nearest one within reach that is not the bar just left.
  pickBar() {
    const p = this.p, bars = this.park().bars;
    let best = -1, bestD = REACH;
    for (let i = 0; i < bars.length; i++) {
      if (i === p.lastBar && p.lastBarT < REGRAB) continue;
      // In reach now and still in reach when the grab lands.
      const d = Math.hypot(bars[i][0] - p.x, bars[i][1] - p.y);
      if (d < MIN_R || d > bestD) continue;
      const fx = p.mode === "ground" ? p.x + p.s * CATCH_LAG : p.x + p.vx * CATCH_LAG, fy = p.mode === "ground" ? p.y : p.y + p.vy * CATCH_LAG;
      if (Math.hypot(bars[i][0] - fx, bars[i][1] - fy) > REACH + 20) continue;
      if (bars[i][1] > p.y + 20) continue; // a bar below the rider's feet cannot be hung from
      best = i; bestD = d;
    }
    return best;
  }
  // A press meant for a bar that has gone out of reach does what a press there would have done.
  heldAway() {
    if (this.p.mode === "ground") this.p.crouch = true;
    else if (this.p.mode === "air") this.tuckIn();
  }
  tuckIn() {
    const p = this.p;
    p.tuck = true;
    p.tuckDir = Math.abs(p.rotV) > 0.6 ? Math.sign(p.rotV) : (p.vx >= 0 ? -1 : 1);
  }
  leaveGround() {
    const p = this.p;
    this.endManual();
    p.mode = "air"; p.crouch = false;
    if (!this.air) this.air = { t: 0, rot: 0, x0: p.x, xMin: p.x, xMax: p.x, y0: p.y, apex: p.y, fromBar: -1, ollie: false, vert: false, dir: Math.sign(p.vx) || 1 };
    if (this.combo.roll >= 0) this.combo.roll = -1;
  }
  ollie() {
    const p = this.p, m = this.slope(p.x), cos = 1 / Math.sqrt(1 + m * m), sin = m * cos;
    p.vx = p.s * cos + OLLIE * sin; p.vy = p.s * sin - OLLIE * cos;
    p.y -= 2;
    this.air = null;
    this.leaveGround();
    this.air.ollie = true;
    this.c.tone?.(330, 0.04, "triangle");
  }
  grab(i) {
    const p = this.p, [bx, by] = this.park().bars[i];
    const dx = p.x - bx, dy = p.y - by, d = Math.hypot(dx, dy);
    if (d > REACH + 40 || d < MIN_R * 0.6) return false;
    this.endManual();
    let vx = p.vx, vy = p.vy;
    if (p.mode === "ground") { const m = this.slope(p.x), cos = 1 / Math.sqrt(1 + m * m); vx = p.s * cos; vy = p.s * m * cos; }
    const r = clamp(d, MIN_R, REACH), phi = Math.atan2(dx, dy);
    const along = vx * Math.cos(phi) - vy * Math.sin(phi), speed = Math.hypot(vx, vy);
    // Air tricks finish on the grab (a flip caught on a bar counts; no landing is needed).
    const from = p.mode === "air" && this.air ? this.air.fromBar : -1;
    if (p.mode === "air" && this.air) this.endAir(true);
    if (from >= 0) {
      if (from !== i) { this.trick("TRANSFER", 300); this.combo.transfers++; this.gapBars(from, i); }
      else this.trick("REGRAB", 120);
    }
    this.gapReach(i);
    this.air = null;
    if (this.combo.roll >= 0) this.combo.roll = -1;
    Object.assign(p, { mode: "bar", bar: i, r, phi, om: (along >= 0 ? 1 : -1) * speed / r, held: 0, loops: 0, phiAcc: 0, tuck: false, crouch: false, regrip: false });
    p.x = bx + r * Math.sin(phi); p.y = by + r * Math.cos(phi);
    this.c.tone?.(520, 0.05, "triangle");
    return true;
  }
  letGo() {
    const p = this.p, i = p.bar, [bx] = this.park().bars[i];
    const whip = this.park().bars[i][2] === "whip";
    p.vx = p.r * p.om * Math.cos(p.phi); p.vy = -p.r * p.om * Math.sin(p.phi);
    if (p.held >= 0.4) this.trick("SWING", 60);
    if (p.regrip && p.held >= 0.4) { this.trick("REGRIP", 90); this.combo.regrip = true; }
    if (whip && p.held >= 0.35) {
      const sp = Math.hypot(p.vx, p.vy), s1 = Math.min(sp * WHIP_GAIN, Math.max(sp, WHIP_CAP));
      if (sp > 1) { p.vx *= s1 / sp; p.vy *= s1 / sp; }
    }
    p.rotV = clamp(-p.om, -TUCK, TUCK);
    p.mode = "air"; p.lastBar = i; p.lastBarT = 0; p.bar = -1;
    this.air = { t: 0, rot: 0, x0: p.x, xMin: p.x, xMax: p.x, y0: p.y, apex: p.y, fromBar: i, ollie: false, vert: false, dir: Math.sign(p.vx) || (p.x >= bx ? 1 : -1) };
    this.c.tone?.(400, 0.04, "sine");
  }

  // ---- tricks and combos ---------------------------------------------------
  trick(name, pts) {
    const c = this.combo;
    if (c.tricks.length >= MAX_TRICKS) return;
    const seen = c.tricks.filter((k) => k.name === name).length;
    const v = Math.round(pts * REPEAT[Math.min(seen, REPEAT.length - 1)] / 10) * 10;
    c.tricks.push({ name, pts: v });
    c.sum += v;
    if (name === "GIANT") c.giants++;
    this.popups.push({ text: name + " " + v, t: 0, x: this.p.x, y: this.p.y - 40 });
    if (this.popups.length > 6) this.popups.shift();
  }
  gapBars(a, b) {
    for (const g of this.park().gaps) if (g.t === "bars" && ((g.a === a && g.b === b) || (g.a === b && g.b === a))) this.gap(g);
  }
  gapReach(i) { for (const g of this.park().gaps) if (g.t === "reach" && g.a === i) this.gap(g); }
  gap(g) {
    if (this.combo.gaps.includes(g.id)) return;
    this.combo.gaps.push(g.id);
    this.trick(g.name, g.pts);
    this.c.tone?.(880, 0.08, "triangle");
  }
  // The end of a stretch of air, on a landing or a grab: flips, air time and spans.
  endAir(caught) {
    const a = this.air, p = this.p;
    if (!a) return;
    if (a.t >= 0.35) { this.combo.airs++; this.stats.airs++; }
    if (a.style && a.t - a.style.at >= STYLE_TIME) { this.trick("SHOVE-IT", 180); this.combo.shove = true; }
    const turns = Math.round(Math.abs(a.rot) / TAU);
    if (turns >= 1 && Math.abs(a.rot) >= turns * TAU - 1.0) {
      const n = Math.min(turns, FLIPS.length - 1), front = Math.sign(a.rot) === a.dir;
      this.trick(FLIPS[n] + (front ? "FRONTFLIP" : "BACKFLIP"), FLIP_PTS[n]);
      this.combo.maxFlip = Math.max(this.combo.maxFlip, turns);
    }
    if (a.vert && a.t >= 0.6) this.trick("LIP AIR", 150 + Math.round((a.y0 - a.apex) * 1.5));
    else if (!a.vert && a.t >= 1.0) this.trick("AIR", Math.round(a.t * 150));
    else if (a.ollie && a.t >= 0.35 && !caught) this.trick("OLLIE", 40);
    if (!a.vert && a.y0 - a.apex >= 220) this.trick("BIG AIR", 400);
    for (const g of this.park().gaps) if (g.t === "span" && a.xMin <= g.x1 && a.xMax >= g.x2) this.gap(g);
    this.air = null;
  }
  land() {
    const p = this.p, m = this.slope(p.x), ang = Math.atan(m);
    const off = Math.abs(wrapAngle(p.rot - ang));
    const cos = 1 / Math.sqrt(1 + m * m), sin = m * cos;
    // Landing keeps most of the speed, more of it the better the line matches the ground (transitions are forgiving).
    const along = p.vx * cos + p.vy * sin, speed = Math.hypot(p.vx, p.vy);
    const s = speed > 1 ? Math.sign(along) * speed * (0.75 + 0.25 * Math.abs(along) / speed) : along;
    p.y = this.groundY(p.x);
    const tol = this.air?.style ? LAND_TOL * 0.7 : LAND_TOL;
    if (off > tol) { this.bail("RELEASE EARLIER — MATCH THE SLOPE BEFORE TOUCHDOWN", off); return; }
    const clean = off < 0.22 && this.air?.t >= 0.35;
    const sketchy = off >= tol * 0.75;
    this.combo.landings++;
    if (clean) { this.combo.clean = true; this.combo.cleanLandings++; this.stats.clean++; }
    if (sketchy) this.combo.sketchy++;
    this.landing = { kind: clean ? "clean" : sketchy ? "sketchy" : "safe", off, t: 1.3,
      reason: clean ? "CLEAN — BODY MATCHED THE SLOPE" : sketchy ? "SKETCHY — RELEASE EARLIER FOR A CLEANER LANDING" : "SAFE — STRAIGHTEN A LITTLE MORE FOR CLEAN" };
    this.endAir(false);
    Object.assign(p, { mode: "ground", s: clamp(s, -MAX_SPEED, MAX_SPEED), rot: ang, rotV: 0, tuck: false, vert: 0 });
    if (this.combo.tricks.length) this.combo.roll = ROLL;
    this.burst(p.x, p.y, C.muted, 4);
    this.c.tone?.(180, 0.05, "triangle");
  }
  bail(reason = "LAND UPRIGHT — RELEASE IN TIME TO STRAIGHTEN", off = null) {
    const p = this.p;
    if (this.combo.tricks.length) announce(this, "BAIL! " + fmt(this.comboValue()) + " LOST", 1.6);
    else announce(this, "BAIL!", 1.2);
    this.combo = this.freshCombo();
    this.manual = null; this.stats.bails++;
    this.landing = { kind: "bail", off, t: 2.3, reason };
    this.air = null; this.pending = null;
    Object.assign(p, { mode: "bail", bailT: BAIL_T, tuck: false, crouch: false, vert: 0, s: 0, bar: -1 });
    p.y = this.groundY(p.x);
    this.burst(p.x, p.y, C.red, 8);
    this.lamps.flash(0.5, () => fill(LAMP.red, 1, this.n()));
    this.c.tone?.(110, 0.25, "sawtooth");
  }
  variety(c = this.combo) { return new Set(c.tricks.map((k) => k.name)).size; }
  comboValue() { const c = this.combo; return c.sum * Math.min(this.variety(c), 8); }
  bank() {
    const c = this.combo, value = this.comboValue(), mult = Math.min(this.variety(c), 8);
    this.score += value;
    this.bestCombo = Math.max(this.bestCombo, value);
    this.stats.banks++; this.stats.variety = Math.max(this.stats.variety, mult);
    const matched = LINES[this.parkId].map((line, i) => this.meetsLine(line, c) ? i : -1).filter(i => i >= 0);
    this.lastBank = { value, variety: this.variety(c), clean: c.cleanLandings || 0, matched,
      newBest: false, newMedal: false, time: Math.max(0, this.runTime - (c.started || 0)) };
    if (this.mode === 2 && this.p.mode === "ground" && !this.manual) {
      this.practiceCheckpoint = { park: this.parkId, x: this.p.x, s: this.p.s, rot: this.p.rot };
    }
    announce(this, (mult > 1 ? fmt(c.sum) + " x " + mult + " = " : "+") + fmt(value), 1.6);
    if (mult >= 5) {
      this.lamps.flash(0.7, (e) => spot((e * 3) % 1, LAMP.white, 0.8, this.n()));
      this.board = 0.9;
      this.c.tone?.(990, 0.12, "triangle");
    } else {
      this.lamps.flash(0.35, () => fill(LAMP.green, 1, this.n()));
      this.c.tone?.(740, 0.08, "triangle");
    }
    if (this.mode !== 2) {
      const before = JSON.stringify([this.slot().goals[this.parkId], this.slot().lines[this.parkId],
        this.slot().lineComboBest[this.parkId], this.slot().lineTimeBest[this.parkId], this.slot().lineMedals[this.parkId]]);
      this.checkGoals(c); this.checkLines(c);
      const after = JSON.stringify([this.slot().goals[this.parkId], this.slot().lines[this.parkId],
        this.slot().lineComboBest[this.parkId], this.slot().lineTimeBest[this.parkId], this.slot().lineMedals[this.parkId]]);
      if (before !== after) this.persist();
    }
    this.combo = this.freshCombo();
  }
  // Goals are met by banked combos, and the score goals by the session's score so far.
  checkGoals(c) {
    if (this.mode === 2) return;
    const park = this.park(), done = this.slot().goals[this.parkId];
    park.goals.forEach((g, i) => {
      if (done.includes(i)) return;
      const ok = (g.t === "score" && this.score >= g.n) || (g.t === "flip" && c.maxFlip >= g.n) || (g.t === "giants" && c.giants >= g.n)
        || (g.t === "count" && c.tricks.length >= g.n) || (g.t === "value" && this.comboValue() >= g.n) || (g.t === "gap" && c.gaps.includes(g.id));
      if (!ok) return;
      done.push(i); done.sort();
      this.newGoals.push(g.text);
      announce(this, "GOAL: " + g.text.toUpperCase(), 2.6);
      this.board = 1.2;
      this.c.tone?.(1180, 0.15, "triangle");
      if (done.length === UNLOCK && this.parkId + 1 < PARKS.length) this.newGoals.push("NEW PARK OPEN: " + PARKS[this.parkId + 1].name);
    });
  }
  challenge() { return LINES[this.parkId][this.slot().line]; }
  lineSeconds() { return this.challenge().seconds || 45; }
  lineRecord(park = this.parkId, line = this.slot().line) {
    const s = this.slot();
    return { best: s.lineComboBest[park][line], medal: s.lineMedals[park][line], time: s.lineTimeBest[park][line] };
  }
  masteryCount() { return this.slot().lineMedals.reduce((n, park) => n + park.reduce((a, m) => a + m, 0), 0); }
  masteryRequirements(line = this.challenge()) {
    return { silverClean: 1, silverVariety: Math.max(3, line.variety || 0),
      goldClean: 2, goldVariety: Math.max(4, (line.variety || 0) + 1) };
  }
  lineMedal(line, c) {
    if (!this.meetsLine(line, c)) return 0;
    const r = this.masteryRequirements(line), clean = c.cleanLandings || 0, variety = this.variety(c);
    return clean >= r.goldClean && variety >= r.goldVariety && !c.sketchy ? 3
      : clean >= r.silverClean && variety >= r.silverVariety ? 2 : 1;
  }
  masteryGoal(line = this.challenge()) {
    const medal = this.lineRecord().medal, r = this.masteryRequirements(line);
    return medal === 0 ? "BRONZE: BANK THE TARGET" : medal === 1
      ? "SILVER: TARGET + " + r.silverClean + " CLEAN + " + r.silverVariety + " TYPES"
      : medal === 2 ? "GOLD: TARGET + " + r.goldClean + " CLEAN + " + r.goldVariety + " TYPES · NO SKETCHY LANDINGS"
      : "GOLD MASTERED · IMPROVE THE LINE PB OR ATTEMPT TIME";
  }
  lineProgress(c = this.combo) {
    const line = this.challenge(), parts = [];
    if (line.flip) parts.push("FLIP " + Math.min(c.maxFlip, line.flip) + "/" + line.flip);
    if (line.swing) parts.push(c.tricks.some(k => k.name === "SWING") ? "SWING OK" : "NEED SWING");
    if (line.variety) parts.push("VARIETY " + Math.min(this.variety(c), line.variety) + "/" + line.variety);
    if (line.clean) parts.push(c.clean ? "CLEAN OK" : "NEED CLEAN LANDING");
    if (line.manual) parts.push(c.manual ? "MANUAL OK" : "NEED MANUAL");
    if (line.airs) parts.push("AIRS " + Math.min(c.airs, line.airs) + "/" + line.airs);
    if (line.gap) parts.push(c.gaps.includes(line.gap) ? "GAP OK" : "NEED " + this.park().gaps.find(g => g.id === line.gap).name);
    if (line.regrip) parts.push(c.regrip ? "REGRIP OK" : "NEED REGRIP");
    if (line.shove) parts.push(c.shove ? "SHOVE-IT OK" : "NEED SHOVE-IT");
    if (line.transfers) parts.push("TRANSFERS " + Math.min(c.transfers, line.transfers) + "/" + line.transfers);
    return this.meetsLine(line, c) ? "READY — LAND AND ROLL TO BANK" : parts.join(" · ");
  }
  meetsLine(line, c) {
    return (!line.flip || c.maxFlip >= line.flip) && (!line.swing || c.tricks.some((k) => k.name === "SWING"))
      && (!line.variety || this.variety(c) >= line.variety) && (!line.clean || c.clean)
      && (!line.manual || c.manual) && (!line.airs || c.airs >= line.airs)
      && (!line.gap || c.gaps.includes(line.gap)) && (!line.regrip || c.regrip)
      && (!line.shove || c.shove) && (!line.transfers || c.transfers >= line.transfers);
  }
  checkLines(c) {
    const done = this.slot().lines[this.parkId];
    LINES[this.parkId].forEach((line, i) => {
      if (!this.meetsLine(line, c)) return;
      const s = this.slot(), value = this.comboValue(), medal = this.lineMedal(line, c);
      if (value > s.lineComboBest[this.parkId][i]) {
        s.lineComboBest[this.parkId][i] = value;
        this.lastBank.newBest = true;
      }
      if (medal > s.lineMedals[this.parkId][i]) {
        s.lineMedals[this.parkId][i] = medal;
        this.lastBank.newMedal = true;
        this.newGoals.push(MEDALS[medal] + " LINE: " + line.name);
        this.board = 1.2;
      }
      // Time trials start at the normal drop-in, so practice gates and late
      // session combos cannot buy a faster record for a different route.
      if (this.mode === 1 && i === s.line && this.runTime > 0) {
        const elapsed = Math.round(Math.min(SESSION + OVERTIME, this.runTime) * 100) / 100;
        const old = s.lineTimeBest[this.parkId][i];
        if (!old || elapsed < old) { s.lineTimeBest[this.parkId][i] = elapsed; this.lastBank.newBest = true; }
      }
      if (i === this.slot().line) this.lineMet = true;
      if (done.includes(i)) return;
      done.push(i); done.sort(); this.stats.lines++;
      this.newGoals.push("LINE: " + line.name); this.board = 1.2;
      announce(this, "LINE BANKED: " + line.name, 2.5);
    });
  }

  // ---- simulation ----------------------------------------------------------
  update(dt) {
    this.guard.tick(dt);
    this.t += dt;
    this.ensurePark();
    if (this.noteT > 0) this.noteT -= dt;
    if (this.landing) { this.landing.t -= dt; if (this.landing.t <= 0) this.landing = null; }
    if (this.phase === "play" && this.resumeT > 0) {
      this.resumeT = Math.max(0, this.resumeT - dt);
      if (this.resumeT === 0) { this.pressed = false; this.pending = null; this.p.crouch = false; this.p.tuck = false; }
    } else if (this.phase === "play") this.stepPlay(this.mode === 2 && this.practiceSlow ? dt * 0.5 : dt);
    else if (this.phase === "over") this.overT += dt;
    for (const q of this.parts) { q.t += dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vy += 400 * dt; }
    this.parts = this.parts.filter((q) => q.t < 0.6);
    if (this.phase === "play" && (this.p.mode === "air" || this.p.mode === "bar") && Math.floor(this.t * 30) !== Math.floor((this.t - dt) * 30)) {
      this.trail.push([this.p.x, this.p.y]);
      if (this.trail.length > 12) this.trail.shift();
    } else if (this.p.mode === "ground" && this.trail.length) this.trail.shift();
    for (const q of this.popups) q.t += dt;
    this.popups = this.popups.filter((q) => q.t < 1.1);
    this.stepBoard(dt);
    this.lamps.frame(dt, this.restingLamps());
    this.updateHud();
  }
  stepPlay(dt) {
    const p = this.p;
    this.runTime += dt;
    if (this.pending) { this.pending.t -= dt; if (this.pending.t <= 0) { const b = this.pending.bar; this.pending = null; if (this.pressed && !this.grab(b)) this.heldAway(); } }
    p.lastBarT += dt;
    if (p.mode === "ground") this.stepGround(dt);
    else if (p.mode === "air") this.stepAir(dt);
    else if (p.mode === "bar") this.stepBar(dt);
    else if (p.mode === "bail") {
      p.bailT -= dt;
      // Back up, rolling towards the middle of the park at a fair speed.
      if (p.bailT <= 0) { Object.assign(p, { mode: "ground", s: p.x < this.park().w / 2 ? 260 : -260, rot: Math.atan(this.slope(p.x)), rotV: 0, crouch: this.pressed }); }
    }
    if (p.mode === "ground" && this.manual) {
      const m = this.manual; m.t += dt;
      m.balance += m.drift * (0.2 + Math.abs(p.s) / MAX_SPEED * 0.32) * dt;
      if (Math.abs(m.balance) >= 1) this.bail("MANUAL DRIFT — TAP TO CENTRE BEFORE THE EDGE");
      else if (m.t >= MANUAL_LIMIT) { this.endManual(); this.combo.roll = ROLL; }
    }
    if (p.mode === "ground" && !this.manual && this.combo.roll >= 0) { this.combo.roll -= dt; if (this.combo.roll <= 0) this.bank(); }
    if (this.mode === 2) { this.placeCamera(false, dt); return; }
    this.clock -= dt;
    if (this.clock <= 0) {
      if (!this.ending) { this.ending = true; announce(this, "TIME! LAST TRICK", 2); this.c.tone?.(300, 0.2, "square"); }
      const idle = (p.mode === "ground" && !this.manual && this.combo.roll < 0) || p.mode === "bail";
      if (idle || this.clock <= -OVERTIME) this.finish();
    } else if (this.clock < 10 && Math.floor(this.clock) !== Math.floor(this.clock + dt)) this.c.tone?.(880, 0.03, "square");
    this.placeCamera(false, dt);
  }
  stepGround(dt) {
    const p = this.p, g = this.geo, sub = 4, h = dt / sub;
    for (let k = 0; k < sub; k++) {
      const m = this.slope(p.x), cos = 1 / Math.sqrt(1 + m * m), sin = m * cos;
      let a = G * sin;
      if (p.crouch && Math.sign(a) === Math.sign(p.s)) a *= PUMP;
      a -= Math.sign(p.s) * FRICTION;
      p.s += a * h;
      if (Math.abs(p.s) < PUSH_MIN && Math.abs(m) < 0.6) {
        const dir = p.s !== 0 ? Math.sign(p.s) : (p.x < this.park().w / 2 ? 1 : -1);
        p.s += dir * PUSH * h;
      }
      p.s = clamp(p.s, -MAX_SPEED, MAX_SPEED);
      p.x += p.s * cos * h;
      p.y = this.groundY(p.x);
      p.rot = Math.atan(this.slope(p.x));
      // Over the lip the wall is vert: the rider goes straight up and comes back down the same wall.
      if (p.x <= g.lipL || p.x >= g.lipR) {
        const left = p.x <= g.lipL;
        p.x = left ? g.lipL : g.lipR; p.y = g.lipY;
        p.vx = 0; p.vy = -Math.abs(p.s); p.vert = left ? -1 : 1;
        this.air = null;
        this.leaveGround();
        this.air.vert = true;
        return;
      }
      // Over a hump that falls away faster than gravity can hold the rider, the board leaves the ground.
      const y2 = p.x > g.lipL + 3 * STEP && p.x < g.lipR - 3 * STEP ? this.bend(p.x) : 0;
      if (y2 > 0 && p.s * p.s * y2 * cos * cos > G) {
        p.vx = p.s * cos; p.vy = p.s * sin;
        this.air = null;
        this.leaveGround();
        return;
      }
    }
  }
  stepAir(dt) {
    const p = this.p, a = this.air, g = this.geo;
    if (p.vert) { p.vy += G * dt; p.y += p.vy * dt; }
    else {
      p.x += p.vx * dt; p.y += p.vy * dt + 0.5 * G * dt * dt; p.vy += G * dt;
      // The walls stand straight above the lips: the rider bumps off them back into the park.
      if (p.x < g.lipL) { p.x = g.lipL; p.vx = Math.abs(p.vx) * 0.4; }
      if (p.x > g.lipR) { p.x = g.lipR; p.vx = -Math.abs(p.vx) * 0.4; }
    }
    // Rotation: a tuck spins hard; untucked, the rider turns towards the ground below at a limited rate.
    const target = p.vert ? Math.atan(this.slope(p.x + (p.vert < 0 ? 3 : -3))) : Math.atan(this.slope(p.x));
    if (p.tuck) p.rotV += (p.tuckDir * TUCK - p.rotV) * Math.min(1, 10 * dt);
    else {
      const want = clamp(wrapAngle(target - p.rot) * 5, -SETTLE, SETTLE);
      p.rotV += (want - p.rotV) * Math.min(1, 7 * dt);
    }
    p.rot += p.rotV * dt;
    if (a) { a.t += dt; a.rot += p.rotV * dt; a.apex = Math.min(a.apex, p.y); a.xMin = Math.min(a.xMin, p.x); a.xMax = Math.max(a.xMax, p.x); }
    if (p.vert) {
      if (p.vy > 0 && p.y >= g.lipY) {
        // Back in at the lip, running down the same wall.
        p.x = p.vert < 0 ? g.lipL + 1 : g.lipR - 1; p.y = g.lipY;
        const m = this.slope(p.x), cos = 1 / Math.sqrt(1 + m * m), sin = m * cos;
        const speed = Math.abs(p.vy);
        p.vx = (p.vert < 0 ? 1 : -1) * speed * Math.abs(cos); p.vy = speed * Math.abs(sin);
        p.vert = 0;
        this.land();
      }
      return;
    }
    if (p.y >= this.groundY(p.x)) this.land();
  }
  stepBar(dt) {
    const p = this.p, [bx, by] = this.park().bars[p.bar], sub = 4, h = dt / sub, k = G / p.r;
    for (let i = 0; i < sub; i++) {
      p.om -= 0.5 * k * Math.sin(p.phi) * h;
      p.phi += p.om * h; p.phiAcc += p.om * h;
      p.om -= 0.5 * k * Math.sin(p.phi) * h;
    }
    p.om *= 1 - 0.01 * dt;
    p.phi = wrapAngle(p.phi);
    p.held += dt;
    p.x = bx + p.r * Math.sin(p.phi); p.y = by + p.r * Math.cos(p.phi);
    p.vx = p.r * p.om * Math.cos(p.phi); p.vy = -p.r * p.om * Math.sin(p.phi);
    p.rot = -p.phi;
    const loops = Math.floor(Math.abs(p.phiAcc) / TAU);
    if (loops > p.loops) { p.loops = loops; this.trick("GIANT", 250); this.c.tone?.(700 + 60 * Math.min(loops, 6), 0.06, "triangle"); }
    // Swinging into the ground drops the rider onto it, judged as a landing.
    if (p.y > this.groundY(p.x) - 2) { p.lastBar = p.bar; p.lastBarT = 0; p.mode = "air"; p.bar = -1; this.land(); }
  }

  finish() {
    if (this.phase !== "play") return;
    const p = this.p;
    // Last trick still has to land. Ending in flight cannot turn an unsafe line into a free bank.
    if (this.combo.tricks.length && p.mode === "ground" && !this.manual) this.bank();
    else this.combo = this.freshCombo();
    this.manual = null;
    this.phase = "over"; this.overT = 0; this.pressed = false; this.pending = null;
    const s = this.slot(), park = this.park();
    if (this.mode === 2) { this.setHint("Practice over. Tap to ride again; hold for setup."); return; }
    s.runs++;
    if (this.mode === 0) s.styleBest[this.parkId] = Math.max(s.styleBest[this.parkId], this.score);
    if (this.mode === 1 && this.lineMet) s.lineBest[this.parkId][s.line] = Math.max(s.lineBest[this.parkId][s.line], this.score);
    const medal = this.stats.variety >= 5 && this.stats.clean >= 3 && this.stats.bails === 0 ? 3
      : this.stats.variety >= 4 && this.stats.clean >= 2 ? 2 : this.stats.variety >= 3 && this.stats.clean >= 1 ? 1 : 0;
    s.medals[this.parkId] = Math.max(s.medals[this.parkId], medal);
    s.clean += this.stats.clean;
    s.bestCombo = Math.max(s.bestCombo, this.bestCombo);
    s.last = { score: this.score, combo: this.bestCombo, park: park.name };
    s.park = this.parkId;
    this.checkGoals(this.freshCombo());
    finishSave(this.save);
    if (this.mode === 0) this.c.score?.(this.score, "style-v2");
    this.persist();
    this.setHint("Tap to ride again. Hold for park and save slot.");
    this.c.tone?.(520, 0.2, "triangle");
  }
  persist() { this.c.saveProgress?.(structuredClone(finishSave(this.save)))?.catch?.(this.c.error); }

  burst(x, y, color, n) {
    for (let i = 0; i < n && this.parts.length < MAX_PARTS; i++) {
      this.parts.push({ x, y, vx: this.c.rng.range(-120, 120), vy: this.c.rng.range(-160, -40), t: 0, color });
    }
  }
  placeCamera(snap, dt = 1 / 60) {
    const park = this.park(), p = this.p;
    const vx = p.mode === "ground" ? p.s / Math.sqrt(1 + this.slope(p.x) ** 2) : p.vx;
    const ahead = clamp(vx * 0.16, -110, 110);
    let lookY = p.y + clamp(p.vy * 0.15, -85, 65);
    if (p.mode === "ground" || p.mode === "bail") lookY = p.y;
    else if (p.mode === "air" && p.vy < 0) lookY = Math.min(lookY, p.y - Math.min(130, p.vy * p.vy / (2 * G)));
    const tx = clamp(p.x + ahead - 480, 0, Math.max(0, park.w - 960));
    const ty = clamp(lookY - 300, Math.min(0, park.h - 540) - 360, Math.max(0, park.h - 540));
    const k = snap ? 1 : 1 - Math.exp(Math.log(0.88) * 60 * dt);
    this.camX += (tx - this.camX) * k; this.camY += (ty - this.camY) * k;
  }

  // ---- lamps ----------------------------------------------------------------
  n() { const n = this.c.lampCount?.(); return n === 4 ? 4 : 3; }
  restingLamps() {
    const n = this.n(), p = this.p;
    if (this.phase === "title" || this.phase === "setup") return fill(LAMP.green, 0.15 + 0.35 * pulse(this.t, 0.4), n);
    if (this.phase === "over") return fill(LAMP.amber, 0.3, n);
    if (p.mode === "bail") return fill(LAMP.red, 0.4, n);
    if (this.phase === "guide") return spot(this.guide / (GUIDE.length - 1), LAMP.cyan, 0.45, n);
    if (n === 4) {
      const out = Array(12).fill(0), lamp = (i, rgb, level) => out.splice(i * 3, 3, ...dim(rgb, level));
      const target = Math.atan(this.slope(p.x)), off = Math.abs(wrapAngle(p.rot - target));
      lamp(0, p.mode === "bar" ? LAMP.cyan : LAMP.green,
        p.mode === "bar" ? 0.2 + 0.65 * Math.abs(Math.sin(p.phi)) : Math.min(0.85,
          (p.mode === "ground" ? Math.abs(p.s) : Math.hypot(p.vx, p.vy)) / MAX_SPEED));
      const risk = this.manual ? Math.abs(this.manual.balance) : p.mode === "air" ? off / (this.air?.style ? LAND_TOL * 0.7 : LAND_TOL) : 0;
      lamp(1, risk > 0.8 ? LAMP.red : risk > 0.4 ? LAMP.amber : LAMP.green, 0.25 + Math.min(0.65, risk * 0.5));
      lamp(2, LAMP.violet, 0.1 + Math.min(0.75, this.variety() * 0.13));
      const ready = p.mode === "ground" || (p.mode === "bar" && !p.regrip && p.held > 0.15)
        || this.canStyle();
      lamp(3, this.manual ? LAMP.amber : ready ? LAMP.cyan : LAMP.off,
        this.manual ? 0.25 + 0.65 * Math.abs(this.manual.balance) : ready ? 0.25 + 0.25 * pulse(this.t, 1) : 0);
      return out;
    }
    if (this.manual) return spot(0.5 + this.manual.balance * 0.5, Math.abs(this.manual.balance) > 0.8 ? LAMP.red : LAMP.amber, 0.7, n);
    if (p.mode === "bar") {
      const whip = this.park().bars[p.bar][2] === "whip";
      return spot(0.5 + 0.5 * Math.sin(p.phi), whip ? LAMP.amber : LAMP.cyan, 0.8, n);
    }
    if (p.mode === "air") {
      // The flip's angle to the ground below: centred and green is a safe landing.
      const target = Math.atan(this.slope(p.x)), off = wrapAngle(p.rot - target);
      const ok = Math.abs(off) <= LAND_TOL * 0.85;
      return spot(clamp(0.5 + off / TAU, 0, 1), ok ? LAMP.green : (p.tuck ? LAMP.violet : LAMP.red), 0.8, n);
    }
    if (this.combo.roll >= 0) return meter(this.combo.roll / ROLL, LAMP.amber, LAMP.off, n);
    return meter(Math.abs(p.s) / MAX_SPEED, LAMP.green, LAMP.off, n).map((v) => Math.round(v * 0.6));
  }
  stepBoard(dt) {
    if (this.board > 0) {
      this.board -= dt;
      if (!this.boardSent) { this.c.board?.(dim(LAMP.amber, 1)); this.boardSent = true; }
      if (this.board <= 0) this.boardOff();
    }
  }
  boardOff() { this.board = 0; if (this.boardSent) { this.c.board?.([0, 0, 0]); this.boardSent = false; } }
  updateHud() {
    const items = this.phase === "play"
      ? [["SCORE", fmt(this.score)], ["TIME", this.mode === 2 ? "PRACTICE" : this.clock > 0 ? Math.ceil(this.clock) + "s" : "LAST"], ["PARK", this.park().name]]
      : [["SLOT", String(this.save.slot + 1)], ["BEST", fmt(this.slot().styleBest[this.parkId])], ["GOALS", this.save.milestone + "/" + PARKS.length * 5]];
    const key = this.phase + "|" + this.mode + "|" + items.join("|");
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.c.hud?.(items);
    this.c.controls?.(this.phase === "guide" ? "BUTTON: NEXT PAGE · CASE: PREVIOUS · HOLD: RIDE / RETURN" : this.phase === "play"
      ? "HOLD: PUMP / GRAB / TUCK · RELEASE: OLLIE / FLY / SETTLE · CASE TAP: STYLE"
      : this.phase === "setup" ? "BUTTON: NEXT · CASE: PREVIOUS · HOLD: CHOOSE"
      : "BUTTON TAP: RIDE · HOLD: SETUP");
  }

}
