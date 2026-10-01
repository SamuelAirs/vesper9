// PERIHELION — a one-button momentum game. A probe coasts left to right through a
// field of small suns. Hold: it is tethered to the sun marked by the reticle and
// swings like a pendulum on a rigid line. Release: it leaves on the exact tangent.
// The lamps are the probe's instruments (height + speed in flight, swing angle on a tether).
import { C, space, text, line, circle, diamond, banner } from "../engine/draw.js";
import { TAU, clamp, lerp, wrapAngle } from "../engine/math.js";
import { LAMP, lamps, dim, ramp, spot, pulse, blink, fill, lightsOff } from "../engine/lightshow.js";
import { recordRun } from "../engine/kit.js";

const G = 240; // px/s^2, light gravity for flight and swing alike
const REACH = 275; // how far a tether can be thrown
const MIN_CATCH = 50; // a sun closer than this cannot be caught (the line would be a knot)
const BAND_TOP = 12, BAND_BOT = 528; // leaving this band ends the run
const PROBE_R = 6;
const PX_PER_MKM = 10; // distance unit: megakilometres, 10 logical pixels each
const CLEAN = 0.35; // a tether shorter than this is a stray tap, not a swing
const TAP_FREE = 0.08, TAP_FULL = 0.33; // release direction blends from "unchanged" to "tangent"
const FUSE = 2.4; // seconds an amber sun holds a tether
const CHAIN_GAP = 1.2; // seconds of free flight a chain survives
const CAM_LEAD = 300; // probe's screen x
const CATCH_LAG = 5 / 60; // the tether takes this long to engage; a shorter press never touches the course
const DASH = [7, 7];
const NO_DASH = [];
const TRAIL = 22;
const MAX_PARTS = 24;
const REASONS = {
  fall: "FELL INTO THE DARK",
  top: "LOST ABOVE THE FIELD",
  void: "STRUCK A DARK BODY",
  dark: "OVERTAKEN BY THE TERMINATOR",
};

const smooth = (x) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };

export class Perihelion {
  constructor(ctx) {
    this.c = ctx;
    this.t = 0;
    this.held = false;
    this.launches = 0; // runs started in this session; the first waits for a deliberate press
    this.ready = false;
    this.parts = new Float32Array(MAX_PARTS * 5); // x, y, vx, vy, life
    this.trail = new Float32Array(TRAIL * 2);
    this.reset();
    this.phase = "title";
    this.setHint("Hold to tether to the marked sun. Release to fly on.");
    this.c.hud([["BEST", this.c.best()]]);
  }

  // ---- run state ---------------------------------------------------------
  reset() {
    this.phase = "play";
    this.runT = 0;
    this.anchors = [];
    this.voids = [];
    this.nextId = 0;
    this.decayRun = 0;
    this.p = { x: 140, y: 220, vx: 280, vy: -70, a: null, r: 0, phi: 0, om: 0, t: 0, v0x: 0, v0y: 0, fuse: 0, lastId: -1 };
    this.addAnchor(330, 180, "steady");
    this.extend(1600);
    this.cam = this.p.x - CAM_LEAD;
    this.front = this.p.x - 400;
    this.maxX = this.p.x;
    this.scoreRaw = 0;
    this.chain = 0;
    this.bestChain = 0;
    this.catches = 0;
    this.flightT = 0;
    this.buffer = 0;
    this.catchFlash = 0;
    this.recFlash = 0;
    this.recText = 0;
    this.recorded = false;
    this.newRecord = false;
    this.best0 = this.c.best();
    this.deadT = 0;
    this.reason = "";
    this.notice = "";
    this.noticeT = 0;
    this.stage = 0;
    this.quickened = false;
    this.lastHint = "";
    this.trail.fill(0);
    this.trailN = 0;
    this.trailTick = 0;
    this.parts.fill(0);
    this.partNext = 0;
    this.tether = null; // per-tether bookkeeping, mirrored from p.a
    this.pending = null; // a thrown tether that has not landed yet
    this.pendT = 0;
  }
  setHint(message) {
    if (message === this.lastHint) return;
    this.lastHint = message;
    this.c.hint(message);
  }

  // ---- world -------------------------------------------------------------
  addAnchor(x, y, kind) {
    const a = { id: this.nextId++, x, y, kind, dead: false };
    this.anchors.push(a);
    this.last = a;
    return a;
  }
  // Generate suns ahead of x = limit. Gaps widen with distance; each gap is capped
  // so the next sun is always within tether reach of a probe that arrives sensibly.
  extend(limit) {
    const rng = this.c.rng;
    let guard = 0;
    while (this.last.x < limit && guard++ < 64) {
      const pr = this.last, d = clamp(pr.x / 10000, 0, 1), easy = this.nextId < 4;
      let gap = easy ? rng.range(140, 165) : rng.range(130 + 40 * d, 185 + 55 * d);
      const span = easy ? 35 : 70 + 40 * d;
      let y = clamp(pr.y + rng.range(-span, span), 110, 280);
      const dy = y - pr.y;
      if (Math.hypot(gap, dy) > 222) gap = Math.sqrt(Math.max(0, 222 * 222 - dy * dy));
      const decay = pr.x > 4800 && this.decayRun < 2 && rng.next() < 0.3;
      this.decayRun = decay ? this.decayRun + 1 : 0;
      const a = this.addAnchor(pr.x + gap, y, decay ? "decay" : "steady");
      if (pr.x > 2600 && rng.next() < 0.3 + 0.3 * d) {
        const count = pr.x > 7500 && rng.next() < 0.4 ? 2 : 1;
        for (let k = 0; k < count; k++) {
          const f = count === 1 ? 0.5 : 0.32 + 0.36 * k;
          const side = count === 2 ? (k ? 1 : -1) : rng.next() < 0.5 ? -1 : 1;
          const r = rng.range(16, 24);
          const vx = lerp(pr.x, a.x, f) + rng.range(-15, 15);
          const vy = clamp(lerp(pr.y, a.y, f) + side * rng.range(70, 115), 50, 470);
          const ok = Math.hypot(vx - pr.x, vy - pr.y) > r + 70 && Math.hypot(vx - a.x, vy - a.y) > r + 70;
          if (ok && this.voids.length < 24) this.voids.push({ x: vx, y: vy, r });
        }
      }
    }
  }
  prune() {
    const left = this.cam - 160;
    while (this.anchors.length > 3 && this.anchors[0].x < left) this.anchors.shift();
    while (this.voids.length && this.voids[0].x < left - 60) this.voids.shift();
  }

  // ---- physics (pure with respect to the game, so a bot can clone a probe) ---
  stepProbe(p, dt) {
    if (p.a) {
      const sub = 4, h = dt / sub, k = G / p.r;
      for (let i = 0; i < sub; i++) {
        p.om -= 0.5 * k * Math.sin(p.phi) * h;
        p.phi += p.om * h;
        p.om -= 0.5 * k * Math.sin(p.phi) * h;
      }
      p.phi = wrapAngle(p.phi);
      p.x = p.a.x + p.r * Math.sin(p.phi);
      p.y = p.a.y + p.r * Math.cos(p.phi);
      p.vx = p.r * p.om * Math.cos(p.phi);
      p.vy = -p.r * p.om * Math.sin(p.phi);
      p.t += dt;
    } else {
      p.x += p.vx * dt;
      p.y += p.vy * dt + 0.5 * G * dt * dt;
      p.vy += G * dt;
    }
  }
  // The sun a press would catch right now (or null): the nearest one ahead of or
  // above the probe, within reach, that is not behind the last sun used.
  pickTarget(p) {
    let best = null, bestD = Infinity;
    for (const a of this.anchors) {
      if (a.dead || a.id <= p.lastId) continue;
      const dx = a.x - p.x, dy = a.y - p.y;
      if (dx < -40 || dy > 30) continue;
      const d = Math.hypot(dx, dy);
      if (d < MIN_CATCH || d > REACH || d >= bestD) continue;
      best = a; bestD = d;
    }
    return best;
  }
  // Tether at the current distance. Speed is kept; its direction becomes tangent.
  engage(p, a) {
    const dx = p.x - a.x, dy = p.y - a.y;
    const r = Math.max(1, Math.hypot(dx, dy));
    const phi = Math.atan2(dx, dy);
    const speed = Math.hypot(p.vx, p.vy);
    const along = p.vx * Math.cos(phi) - p.vy * Math.sin(phi);
    p.a = a; p.r = r; p.phi = phi; p.t = 0;
    p.om = (along >= 0 ? 1 : -1) * speed / r;
    p.v0x = p.vx; p.v0y = p.vy;
    p.fuse = a.kind === "decay" ? FUSE : Infinity;
    p.vx = p.r * p.om * Math.cos(phi);
    p.vy = -p.r * p.om * Math.sin(phi);
  }
  // Leave the tether. A swing of CLEAN seconds or more leaves exactly on the tangent.
  // A shorter tether blends back towards the velocity the probe had when it was
  // thrown, so stray taps barely bend the course. Returns { a, clean }.
  detach(p) {
    const a = p.a, d = p.t, clean = d >= CLEAN;
    const tvx = p.vx, tvy = p.vy, speed = Math.hypot(tvx, tvy);
    if (d < TAP_FULL) {
      const w = smooth((d - TAP_FREE) / (TAP_FULL - TAP_FREE));
      let bx = lerp(p.v0x, tvx, w), by = lerp(p.v0y + G * d, tvy, w);
      const m = Math.hypot(bx, by);
      if (m > 1e-6) { bx *= speed / m; by *= speed / m; p.vx = bx; p.vy = by; }
    }
    p.a = null;
    if (clean) p.lastId = a.id;
    return { a, clean };
  }
  // Why the run would end at p, or "".
  fate(p) {
    if (p.y > BAND_BOT) return "fall";
    if (p.y < BAND_TOP) return "top";
    for (const v of this.voids) {
      const dx = p.x - v.x;
      if (dx > 80 || dx < -80) continue;
      if (Math.hypot(dx, p.y - v.y) < v.r + PROBE_R) return "void";
    }
    return "";
  }

  // ---- input -------------------------------------------------------------
  down() {
    if (this.phase === "title" || (this.phase === "over" && this.deadT > 0.7)) {
      this.start();
      return;
    }
    if (this.phase !== "play") return;
    if (this.ready) {
      // The first run of a session starts parked: the first press of the run launches
      // it and throws the tether, so a newcomer has time to read the screen.
      this.ready = false;
      this.setHint("Hold to catch the marked sun. Release to fly on.");
    }
    this.held = true;
    this.buffer = 0.18;
    this.tryCatch();
  }
  up() {
    this.held = false;
    this.buffer = 0;
    this.pending = null;
    if (this.phase === "play" && this.p.a) this.releaseTether();
  }
  cancel() {
    this.up();
    this.c.leds(lightsOff());
  }
  pause() {
    this.c.leds(lightsOff());
  }
  resume() {
    this.held = false;
  }
  dispose() {
    this.held = false;
    this.c.leds(lightsOff());
  }
  start() {
    this.held = false;
    this.reset();
    this.ready = this.launches++ === 0;
    this.setHint(this.ready ? "Hold to throw a tether to the marked sun. Release to fly on." : "Hold to catch the marked sun. Release to fly on.");
    this.noticeT = 0;
    this.c.hud([["DISTANCE", "0 Mkm"], ["CHAIN", "-"], ["CAUGHT", 0], ["BEST", this.c.best()]]);
  }
  tryCatch() {
    const p = this.p;
    if (p.a || !this.held) return false;
    const a = this.pickTarget(p);
    if (!a) return false;
    this.pending = a;
    this.pendT = 0;
    this.buffer = 0;
    return true;
  }
  // The throw lands: tether at the probe's current distance.
  land() {
    const p = this.p, a = this.pending;
    this.pending = null;
    if (!a || p.a || a.dead || Math.hypot(a.x - p.x, a.y - p.y) < 8) return;
    this.engage(p, a);
    this.tether = { counted: false, flightAtCatch: this.flightT };
    this.catchFlash = 0.14;
    this.burst(a.x, a.y, 5, 90);
    this.c.tone(300 + 35 * Math.min(this.chain, 8), 0.06, "triangle");
  }
  // Throw a tether from a cloned probe the way the game does (a bot's planning step).
  settle(p, a) {
    for (let i = 0; i < Math.round(CATCH_LAG * 60) - 1; i++) this.stepProbe(p, 1 / 60);
    this.engage(p, a);
  }
  releaseTether() {
    const p = this.p, tt = this.tether;
    const { a, clean } = this.detach(p);
    this.tether = null;
    if (!clean) return;
    if (tt && !tt.counted) this.countCatch(tt);
    this.chain++;
    this.bestChain = Math.max(this.bestChain, this.chain);
    this.flightT = 0;
    if (a.kind === "decay") a.dead = true;
    this.c.tone(520 + 30 * Math.min(this.chain, 8), 0.05, "sine");
  }
  countCatch(tt) {
    tt.counted = true;
    this.catches++;
    if (tt.flightAtCatch > CHAIN_GAP) this.chain = 0;
  }

  // ---- simulation --------------------------------------------------------
  multiplier() {
    return 1 + Math.min(4, Math.floor(this.chain / 2));
  }
  update(dt) {
    this.t += dt;
    if (this.phase === "play") { if (!this.ready) this.stepPlay(dt); }
    else if (this.phase === "over") {
      this.deadT += dt;
      this.stepParts(dt);
    }
    this.c.leds(this.lampValues());
    if (this.phase !== "play") this.c.hud([["BEST", this.c.best()]]);
  }
  stepPlay(dt) {
    const p = this.p;
    this.runT += dt;
    this.catchFlash = Math.max(0, this.catchFlash - dt);
    this.recFlash = Math.max(0, this.recFlash - dt);
    this.recText = Math.max(0, this.recText - dt);
    this.noticeT = Math.max(0, this.noticeT - dt);
    if (this.pending) {
      this.pendT += dt;
      if (this.pendT >= CATCH_LAG - 1e-9) this.land();
    } else if (this.held && !p.a && this.buffer > 0) {
      this.buffer -= dt;
      this.tryCatch();
    }
    if (!p.a) this.flightT += dt;
    this.stepProbe(p, dt);
    if (p.a) {
      const tt = this.tether;
      if (tt && !tt.counted && p.t >= CLEAN) this.countCatch(tt);
      if (p.a.kind === "decay" && p.t >= FUSE) {
        const a = p.a;
        this.releaseTether();
        a.dead = true;
        this.burst(a.x, a.y, 10, 140);
        this.c.tone(180, 0.1, "square");
        this.held = false;
      }
    } else if (this.chain > 0 && this.flightT > CHAIN_GAP) this.chain = 0;
    // The terminator: a wall of dark sweeping up from behind, so stalling costs.
    this.front += this.frontSpeed() * dt;
    let why = this.fate(p);
    if (!why && p.x < this.front + 8) why = "dark";
    if (why) { this.crash(why); return; }
    if (p.x > this.maxX) {
      this.scoreRaw += ((p.x - this.maxX) * this.multiplier()) / PX_PER_MKM;
      this.maxX = p.x;
    }
    const score = Math.floor(this.scoreRaw);
    if (!this.recorded && this.best0 > 0 && score > this.best0) {
      this.recorded = true;
      this.recFlash = 1.0;
      this.recText = 2.2;
      this.c.synth.chime();
    }
    this.stageEvents();
    this.cam += (p.x - CAM_LEAD - this.cam) * Math.min(1, dt * 4);
    this.extend(p.x + 1500);
    this.prune();
    if (++this.trailTick % 3 === 0) this.pushTrail(p.x, p.y);
    this.stepParts(dt);
    this.c.hud([
      ["DISTANCE", score + " Mkm"],
      ["CHAIN", this.chain > 0 ? this.chain + "  x" + this.multiplier() : "-"],
      ["CAUGHT", this.catches],
      ["BEST", Math.max(this.c.best(), score)],
    ]);
    if (this.noticeT > 0) this.setHint(this.notice);
    else if (p.a) this.setHint(p.a.kind === "decay" ? "This sun is burning out. Release." : "Release to fly on the tangent.");
    else this.setHint(this.pickTarget(p) ? "Hold to catch the marked sun." : "Coasting. No sun in reach.");
  }
  // How fast the dark sweeps up, px/s. It rises to 110 over the first six minutes;
  // after five minutes it keeps quickening until nobody can outrun it, so a run ends.
  frontSpeed() {
    return Math.min(110, 36 + 0.2 * this.runT) + 0.5 * Math.max(0, this.runT - 300);
  }
  stageEvents() {
    if (this.runT > 300 && !this.quickened) {
      this.quickened = true;
      this.notice = "The dark is quickening.";
      this.noticeT = 4;
      this.c.tone(660, 0.1, "sine");
    }
    const x = this.maxX;
    const notes = [
      [1800, "Dark bodies ahead. Steer clear."],
      [4100, "Amber suns burn out. Do not linger."],
      [7000, "Dark bodies come in pairs."],
      [10000, "The gaps widen."],
    ];
    while (this.stage < notes.length && x > notes[this.stage][0]) {
      this.notice = notes[this.stage][1];
      this.noticeT = 4;
      this.stage++;
      this.c.tone(660, 0.1, "sine");
    }
  }
  crash(why) {
    const p = this.p;
    this.phase = "over";
    this.reason = why;
    this.deadT = 0;
    this.held = false;
    this.tether = null;
    this.pending = null;
    this.burst(p.x, p.y, 16, 160);
    const score = Math.floor(this.scoreRaw);
    this.c.score(score);
    this.c.tone(70, 0.4, "sawtooth");
    this.newRecord = score > 0 && score > this.best0;
    this.result = { mkm: score, chain: this.bestChain, catches: this.catches, reason: REASONS[why] || why, milestone: Math.floor(score / 100) };
    recordRun(this.c, this.result);
    this.setHint("Press to launch again.");
    this.c.hud([["DISTANCE", score + " Mkm"], ["BEST CHAIN", this.bestChain], ["CAUGHT", this.catches], ["BEST", this.c.best()]]);
  }
  burst(x, y, n, speed) {
    for (let i = 0; i < n; i++) {
      const k = this.partNext++ % MAX_PARTS, o = k * 5, a = (i / n) * TAU + this.t;
      this.parts[o] = x; this.parts[o + 1] = y;
      this.parts[o + 2] = Math.cos(a) * speed * (0.5 + (i % 3) * 0.25);
      this.parts[o + 3] = Math.sin(a) * speed * (0.5 + (i % 3) * 0.25);
      this.parts[o + 4] = 0.5;
    }
  }
  stepParts(dt) {
    for (let k = 0; k < MAX_PARTS; k++) {
      const o = k * 5;
      if (this.parts[o + 4] <= 0) continue;
      this.parts[o] += this.parts[o + 2] * dt;
      this.parts[o + 1] += this.parts[o + 3] * dt;
      this.parts[o + 4] -= dt;
    }
  }
  pushTrail(x, y) {
    const n = TRAIL;
    this.trail.copyWithin(0, 2);
    this.trail[(n - 1) * 2] = x;
    this.trail[(n - 1) * 2 + 1] = y;
    this.trailN = Math.min(n, this.trailN + 1);
  }

  // ---- lamps -------------------------------------------------------------
  danger(y) {
    return clamp((Math.abs(y - 270) - 120) / 130, 0, 1);
  }
  lampValues() {
    const p = this.p;
    if (this.phase === "title" || this.ready) return spot(0.5 + 0.5 * Math.sin(this.t * 0.7), dim(LAMP.green, 0.1));
    if (this.phase === "over") {
      if (this.deadT < 1.4) return fill(LAMP.red, 0.32 * (1 - this.deadT / 1.4));
      if (this.newRecord) return fill(LAMP.amber, 0.08 + 0.1 * pulse(this.t, 0.5));
      return spot(0.5 + 0.5 * Math.sin(this.t * 0.5), dim(LAMP.green, 0.07));
    }
    if (this.recFlash > 0) {
      const on = blink(1 - this.recFlash, 5);
      return fill(on ? LAMP.white : LAMP.amber, on ? 0.8 : 0.1);
    }
    if (this.catchFlash > 0) return fill(LAMP.white, 0.7);
    const danger = this.danger(p.y);
    if (p.a) {
      let level = 0.4;
      if (p.a.kind === "decay" && FUSE - p.t < 0.8) level = blink(this.runT, 8) ? 0.5 : 0.08;
      const pos = 0.5 + 0.5 * Math.sin(p.phi);
      return spot(pos, dim(ramp(danger, [LAMP.cyan, LAMP.amber, LAMP.red]), level), 0.8);
    }
    const f = clamp((Math.hypot(p.vx, p.vy) - 180) / 240, 0, 1);
    const col = ramp(danger, [LAMP.green, LAMP.amber, LAMP.red]);
    const scale = 0.38 * (danger > 0.7 ? 0.65 + 0.35 * blink(this.runT, 4) : 1);
    return lamps(...[0, 1, 2].map((i) => dim(col, scale * (0.1 + 0.9 * clamp(f * 3 - i, 0, 1)))));
  }

  // ---- drawing -----------------------------------------------------------
  draw(g) {
    space(g, this.cam * 0.25, 0.5);
    this.drawField(g);
    if (this.phase === "title") {
      banner(g, "PERIHELION", "SWING BETWEEN SMALL SUNS");
      text(g, "HOLD = TETHER     RELEASE = FLY ON", 480, 392, 18, C.muted, "center");
      if (this.c.best() > 0) text(g, "BEST " + this.c.best() + " Mkm", 480, 422, 18, C.amber, "center");
    } else if (this.phase === "over") this.drawResult(g);
    else this.drawOverlay(g);
    if (this.ready) {
      g.fillStyle = "#0c1511e8";
      g.fillRect(190, 300, 580, 110);
      text(g, "HOLD TO THROW THE TETHER", 480, 336, 28, C.amber, "center");
      text(g, "RELEASE TO FLY ON", 480, 376, 22, C.muted, "center");
    }
  }
  drawField(g) {
    const cam = this.cam, p = this.p;
    // Safe band edges.
    g.setLineDash(DASH);
    line(g, 0, BAND_TOP, 960, BAND_TOP, "#6b3a2e", 1.5);
    line(g, 0, BAND_BOT, 960, BAND_BOT, "#6b3a2e", 1.5);
    g.setLineDash(NO_DASH);
    const target = this.phase === "play" && !p.a ? this.pickTarget(p) : this.phase === "title" ? this.pickTarget(p) : null;
    for (const v of this.voids) {
      const x = v.x - cam;
      if (x < -60 || x > 1020) continue;
      circle(g, x, v.y, v.r, "#050806", true);
      circle(g, x, v.y, v.r, C.red, false, 2.5);
      line(g, x - v.r * 0.6, v.y - v.r * 0.6, x + v.r * 0.6, v.y + v.r * 0.6, C.red, 2);
      line(g, x - v.r * 0.6, v.y + v.r * 0.6, x + v.r * 0.6, v.y - v.r * 0.6, C.red, 2);
    }
    for (const a of this.anchors) {
      const x = a.x - cam;
      if (x < -40 || x > 1000) continue;
      const decay = a.kind === "decay";
      const col = a.dead ? C.line : decay ? C.amber : C.ink;
      circle(g, x, a.y, 14, col, false, 3);
      circle(g, x, a.y, 5, col, true);
      if (decay && !a.dead) {
        g.setLineDash(DASH);
        circle(g, x, a.y, 22, C.amber, false, 2);
        g.setLineDash(NO_DASH);
      }
      if (decay && p.a === a) {
        g.beginPath();
        g.arc(x, a.y, 28, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(1 - p.t / FUSE, 0, 1));
        g.strokeStyle = C.red;
        g.lineWidth = 4;
        g.stroke();
      }
    }
    if (target) {
      const tx = target.x - cam, px = p.x - cam;
      g.setLineDash(DASH);
      line(g, px, p.y, tx, target.y, C.muted, 2);
      g.setLineDash(NO_DASH);
      diamond(g, tx, target.y, 25 + 3 * pulse(this.t, 1.5), C.cyan);
    }
    if (this.pending && !p.a) {
      g.setLineDash(DASH);
      line(g, p.x - cam, p.y, this.pending.x - cam, this.pending.y, C.amber, 2);
      g.setLineDash(NO_DASH);
    }
    if (p.a) {
      const ax = p.a.x - cam;
      g.globalAlpha = 0.35;
      circle(g, ax, p.a.y, p.r, C.line, false, 1.5);
      g.globalAlpha = 1;
      line(g, ax, p.a.y, p.x - cam, p.y, C.amber, 4);
    }
    // Trail, then probe.
    const n = this.trailN;
    for (let i = TRAIL - n; i < TRAIL - 1; i++) {
      g.globalAlpha = ((i - (TRAIL - n)) / n) * 0.55;
      line(g, this.trail[i * 2] - cam, this.trail[i * 2 + 1], this.trail[i * 2 + 2] - cam, this.trail[i * 2 + 3], C.amber, 3);
    }
    g.globalAlpha = 1;
    if (this.phase !== "over") this.drawProbe(g, p.x - cam, p.y, Math.atan2(p.vy, p.vx));
    // Particles.
    for (let k = 0; k < MAX_PARTS; k++) {
      const o = k * 5, life = this.parts[o + 4];
      if (life <= 0) continue;
      g.globalAlpha = clamp(life * 2, 0, 1);
      g.fillStyle = C.amber;
      g.fillRect(this.parts[o] - cam - 1.5, this.parts[o + 1] - 1.5, 3, 3);
    }
    g.globalAlpha = 1;
    // Terminator.
    const fx = this.front - cam;
    if (fx > 0) {
      g.globalAlpha = 0.8;
      g.fillStyle = "#040705";
      g.fillRect(0, 0, Math.min(960, fx), 540);
      g.globalAlpha = 1;
      g.setLineDash(DASH);
      line(g, fx, 0, fx, 540, C.red, 2);
      g.setLineDash(NO_DASH);
    }
  }
  drawProbe(g, x, y, ang) {
    g.save();
    g.translate(x, y);
    g.rotate(ang);
    g.beginPath();
    g.moveTo(16, 0);
    g.lineTo(-10, -10);
    g.lineTo(-4, 0);
    g.lineTo(-10, 10);
    g.closePath();
    g.fillStyle = C.amber;
    g.fill();
    g.restore();
  }
  drawOverlay(g) {
    const p = this.p;
    const gap = p.x - this.front;
    if (gap < 220) {
      g.globalAlpha = 0.5 + 0.5 * blink(this.t, 4);
      text(g, "DARK CLOSING", 30, 60, 22, C.red);
      g.globalAlpha = 1;
    }
    if (this.multiplier() > 1) text(g, "x" + this.multiplier(), 480, 44, 30, C.amber, "center");
    if (this.recText > 0) text(g, "NEW DISTANCE RECORD", 480, 80, 22, C.cyan, "center");
    // Height gauge on the right edge: where the probe sits in its safe band.
    const gy = clamp(p.y, BAND_TOP, BAND_BOT);
    line(g, 934, BAND_TOP, 934, BAND_BOT, C.line, 3);
    line(g, 934, 150, 934, 390, C.muted, 5);
    diamond(g, 934, gy, 9, this.danger(p.y) > 0.5 ? C.red : C.ink, true);
  }
  drawResult(g) {
    const r = this.result || { mkm: 0, chain: 0, catches: 0, reason: "" };
    g.fillStyle = "#0c1511ee";
    g.fillRect(190, 110, 580, 320);
    line(g, 240, 120, 720, 120, C.line);
    text(g, "PROBE LOST", 480, 160, 38, C.red, "center");
    text(g, r.reason, 480, 203, 18, C.muted, "center");
    text(g, "DISTANCE", 300, 250, 18, C.muted);
    text(g, r.mkm + " Mkm", 660, 250, 26, C.ink, "right");
    text(g, "BEST CHAIN", 300, 290, 18, C.muted);
    text(g, r.chain, 660, 290, 26, C.ink, "right");
    text(g, "ANCHORS CAUGHT", 300, 330, 18, C.muted);
    text(g, r.catches, 660, 330, 26, C.ink, "right");
    const record = this.newRecord;
    text(g, record ? "NEW DISTANCE RECORD" : "BEST " + this.c.best() + " Mkm", 480, 372, 18, record ? C.cyan : C.amber, "center");
    if (this.deadT > 0.7) text(g, "PRESS TO LAUNCH AGAIN", 480, 406, 18, C.amber, "center");
  }
}
