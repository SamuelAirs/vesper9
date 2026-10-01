// BALLISTA — one-button artillery. The barrel sweeps up and down by itself; pressing fixes the
// angle where the sweep is at that instant, and the length of the hold sets the power on a meter
// that rises to a peak and then falls again, so holding longer is not simply better. Releasing
// launches a survey probe under gravity and wind. Every trajectory stays drawn as a fading trace.
// The three lamps carry the shot: a spot of light follows the sweep, then they fill green, amber,
// red as power rises, follow the probe to the target, and say on which side a miss fell.
import { C, space, text, line, circle, diamond, banner } from "../engine/draw.js";
import { clamp, lerp, TAU, Random } from "../engine/math.js";
import { LAMP, lamps, fill, dim, blink, pulse, chase, spot, lightsOff } from "../engine/lightshow.js";
import { recordRun } from "../engine/kit.js";

const STEP = 1 / 60;
const GY = 450; // screen y of the datum (height 0)
const LX = 70; // launcher x
const PIVOT = 14; // barrel pivot height
const BARREL = 34;
const VMIN = 110;
const VMAX = 560;
export const RISE = 1.6; // seconds of hold from no power to the peak; the meter then falls for as long
export const MIN_HOLD = 0.18; // a shorter press is a cancelled charge: nothing launches, nothing is spent
export const SWEEP = 3.4; // seconds for one full cycle of the aim sweep
const MAX_STEPS = 60 * 18;
const HOLD_LIMIT = 9.6;
const HITSLOP = 3;
const TRACE_POINTS = 400;
const smooth = (t) => {
  const u = clamp(t, 0, 1);
  return u * u * (3 - 2 * u);
};

// ---- the physics: one function steps the probe; play, planning and tests all use it ----

export const speedOf = (power) => VMIN + (VMAX - VMIN) * power;
// Power after holding for `hold` seconds: up to the peak at RISE, then back down, repeating.
// A station with a preset power only fills as far as the preset.
export function powerAt(hold, fixed = 0) {
  if (fixed > 0) return Math.min(hold / RISE, fixed);
  const u = (hold / (2 * RISE)) % 1;
  return u < 0.5 ? 2 * u : 2 - 2 * u;
}
export const sweepFrac = (t) => 0.5 - 0.5 * Math.cos((TAU * t) / SWEEP);
export const sweepAngle = (s, t) => lerp(s.aLo, s.aHi, sweepFrac(t));

// The terrain is a height function; it is sampled every two pixels once per station and read back
// by linear interpolation, which is what the probe collides with and what is drawn.
export function heightAt(s, x) {
  const u = clamp(x, 0, 1000) / 2, i = Math.min(499, Math.floor(u)), f = u - i, h = s.height;
  return h[i] + (h[i + 1] - h[i]) * f;
}
function terrainFn(s, x) {
  let w = smooth((x - LX - 70) / 80);
  for (const t of s.targets) w *= smooth((Math.abs(x - t.cx) - t.fz) / 50);
  let h = s.noiseA * (0.55 + 0.3 * Math.sin(x * s.k1 + s.p1) + 0.15 * Math.sin(x * s.k2 + s.p2)) * w;
  for (const b of s.bumps) {
    const d = (x - b.c) / b.w;
    h += b.h * Math.exp(-d * d);
  }
  return Math.max(0, h);
}
function sampleTerrain(s) {
  s.height = new Float32Array(501);
  for (let i = 0; i < 501; i++) s.height[i] = terrainFn(s, i * 2);
  return s;
}
export const terrainAt = heightAt;
export const targetX = (t, now) => (t.amp ? t.cx + t.amp * Math.sin((TAU * now) / t.period + t.ph) : t.cx);

export function launchProbe(s, angleDeg, power, wind) {
  const a = (angleDeg * Math.PI) / 180, v = speedOf(power);
  const x = LX + Math.cos(a) * BARREL, y = PIVOT + Math.sin(a) * BARREL;
  return { x, y, px: x, py: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, n: 0, hitIdx: -1, wind };
}

function segDist(ax, ay, bx, by, px, py) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const k = l2 > 0 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
  return Math.hypot(ax + dx * k - px, ay + dy * k - py);
}

// One fixed step of a probe in flight: constant gravity, wind as a constant horizontal
// acceleration. Returns 0 flying, 1 hit target pr.hitIdx, 2 ground, 3 out of range, 4 timeout.
// `only` is a target index to test alone, or -1 for every target not yet hit.
export function flightTick(s, pr, launchT, only = -1) {
  pr.px = pr.x;
  pr.py = pr.y;
  pr.vx += pr.wind * STEP;
  pr.x += pr.vx * STEP;
  pr.vy -= s.g * STEP;
  pr.y += pr.vy * STEP;
  pr.t += STEP;
  pr.n++;
  const now = launchT + pr.t;
  for (let i = 0; i < s.targets.length; i++) {
    const tg = s.targets[i];
    if (only >= 0 ? i !== only : tg.hit) continue;
    const cx = targetX(tg, now);
    if (segDist(pr.px, pr.py, pr.x, pr.y, cx, terrainAt(s, cx) + tg.r) <= tg.r + HITSLOP) {
      pr.hitIdx = i;
      return 1;
    }
  }
  if (!(pr.y > terrainAt(s, pr.x))) return 2;
  if (!(pr.x > -30 && pr.x < 1010)) return 3;
  if (pr.n > MAX_STEPS) return 4;
  return 0;
}

export function simulate(s, angleDeg, power, wind, launchT, only = -1) {
  const pr = launchProbe(s, angleDeg, power, wind);
  let r = 0;
  while (!r) r = flightTick(s, pr, launchT, only);
  pr.result = r;
  return pr;
}
export const hitsTarget = (s, ti, angle, power, wind, launchT) =>
  simulate(s, angle, power, wind, launchT, ti).result === 1;

// Is there a shot that hits target `ti` and survives small errors in angle and power? For each
// angle the power is bisected on where the probe lands (short or long of the target); a hit must
// then still hit one degree either side and a little more or less power.
function* robustSteps(s, ti, wind, launchT, aStep = 0, pStep = 0.012) {
  const fixed = s.fixedPower, tg = s.targets[ti];
  const robust = (a, p) =>
    hitsTarget(s, ti, a - 1, p, wind, launchT) && hitsTarget(s, ti, a + 1, p, wind, launchT) &&
    (fixed || (hitsTarget(s, ti, a, p - pStep, wind, launchT) && hitsTarget(s, ti, a, p + pStep, wind, launchT)));
  // a quick coarse pass, then a fine one only for stations where the coarse pass finds nothing
  const passes = aStep ? [aStep] : [2.5, 1];
  for (const step of passes) for (let a = s.aLo + 0.5; a <= s.aHi; a += step) {
    yield; // one angle is a fraction of a millisecond: the caller may pause here
    if (fixed) {
      if (hitsTarget(s, ti, a, fixed, wind, launchT) && robust(a, fixed)) return { angle: a, power: fixed };
      continue;
    }
    let lo = 0.08, hi = 1;
    for (let i = 0; i < 12 && hi - lo > 0.004; i++) {
      const p = (lo + hi) / 2, pr = simulate(s, a, p, wind, launchT, ti);
      if (pr.result === 1) {
        if (robust(a, p)) return { angle: a, power: p };
        break;
      }
      const short = pr.result === 2 || pr.result === 1 ? pr.x < targetX(tg, launchT + pr.t) : pr.result === 3 && pr.x < 0;
      if (short) lo = p;
      else hi = p;
    }
  }
  return null;
}
// Runs a generator to the end and returns its value.
function drain(it) {
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}
export function robustShot(s, ti, wind, launchT, aStep = 0, pStep = 0.012) {
  return drain(robustSteps(s, ti, wind, launchT, aStep, pStep));
}

// Every target must be hittable across the station's wind (both extremes, calm and the halves), and at several
// phases of any moving target.
function* verifySteps(s) {
  const moving = s.targets.some((t) => t.amp);
  const winds = s.windA > 0 ? (moving ? [-1, 0, 1] : [-1, -0.5, 0, 0.5, 1]).map((k) => k * s.windA) : [0];
  for (let ti = 0; ti < s.targets.length; ti++) {
    const tg = s.targets[ti];
    const phases = tg.amp ? [0, tg.period / 3, (2 * tg.period) / 3] : [0];
    for (const w of winds) for (const ph of phases) if (!(yield* robustSteps(s, ti, w, ph))) return false;
  }
  return true;
}
export function verifyStation(s) {
  return drain(verifySteps(s));
}

// ---- stations ----

function draftStation(n, rng, k) {
  const fallback = k >= 99;
  const ease = fallback ? 0 : Math.pow(0.9, k);
  const level = Math.max(0, n - 8);
  const f = { r: 34, x0: 380, x1: 820, wind: 0, ridge: 0, cover: 0, moving: 0, g: 300, twin: 0, fixed: 0, aLo: 12, aHi: 78, probes: 3, noise: n >= 3 ? 1 : 0, name: "", note: "" };
  const tags = [];
  if (fallback) Object.assign(f, { r: 36, x0: 400, x1: 700, noise: 0, name: "STEADY RANGE", note: "A CLEAR SHOT." });
  else if (n === 1) Object.assign(f, { r: 62, x0: 380, x1: 780, aLo: 40, aHi: 50, probes: 4, name: "RANGING", note: "ONLY POWER MATTERS HERE. HOLD LONGER TO THROW FARTHER." });
  else if (n === 2) Object.assign(f, { r: 56, x0: 330, x1: 560, aLo: 10, aHi: 80, probes: 4, fixed: 0.7, name: "AIMING", note: "POWER IS SET. YOUR PRESS DECIDES THE ANGLE." });
  else if (n === 3) Object.assign(f, { r: 42, name: "RANGE AND AIM", note: "BOTH SKILLS TOGETHER. READ THE LAST TRACE.", probes: 4 });
  else if (n === 4) Object.assign(f, { r: 38, x0: 560, x1: 860, ridge: 1, name: "RIDGE", note: "A RIDGE BLOCKS THE LOW SHOT. LOB OVER IT." });
  else if (n === 5) Object.assign(f, { r: 38, wind: 30, name: "CROSSWIND", note: "THE WIND PUSHES THE PROBE AND CHANGES EACH SHOT." });
  else if (n === 6) Object.assign(f, { r: 36, x0: 480, x1: 780, moving: 1, wind: 14, name: "SLIDING TARGET", note: "THE TARGET SLIDES. LEAD IT." });
  else if (n === 7) Object.assign(f, { r: 36, x0: 520, x1: 860, cover: 1, name: "COVER", note: "THE TARGET SITS BEHIND A WALL. LOB STEEPLY." });
  else if (n === 8) Object.assign(f, { r: 34, g: 170, wind: 26, name: "LOW GRAVITY", note: "FLIGHTS ARE LONG AND POWER IS TOUCHY." });
  else {
    f.r = Math.max(19, 34 - level * 1.1);
    f.wind = clamp(rng.pick([0, 20, 30, 40]) + level * 1.2, 0, 56);
    if (rng.next() < 0.45) f.ridge = 1;
    else if (rng.next() < 0.35) f.cover = 1;
    if (!f.cover && rng.next() < 0.3) f.moving = 1;
    if (!f.cover && level >= 2 && rng.next() < 0.4) { f.twin = 1; f.probes = 4; f.r = Math.max(22, f.r + 3); }
    if (rng.next() < 0.25) f.g = 190;
    f.x0 = f.cover ? 520 : 400;
    f.x1 = 860;
    if (f.twin) f.moving = rng.next() < 0.25 ? 1 : 0;
    if (f.cover) tags.push("COVER");
    if (f.ridge) tags.push("RIDGE");
    if (f.twin) tags.push("TWIN TARGETS");
    if (f.moving) tags.push("SLIDING");
    if (f.g < 300) tags.push("LOW GRAVITY");
    if (f.wind > 0) tags.push("WIND");
    if (f.r < 26) tags.unshift("SMALL");
    f.name = tags.slice(0, 2).join(" ") || "DEEP RANGE";
    f.note = tags.join(", ") || "DEEPER SURVEY.";
  }
  const s = {
    n, name: f.name, note: f.note, g: fallback ? 300 : f.g, aLo: f.aLo, aHi: f.aHi, windA: Math.round(f.wind * ease),
    probes: f.probes, fixedPower: f.fixed, targets: [], bumps: [], fallback,
    noiseA: f.noise ? rng.range(6, 16) * ease : 0,
    k1: rng.range(0.012, 0.02), p1: rng.range(0, TAU), k2: rng.range(0.04, 0.07), p2: rng.range(0, TAU),
  };
  const r = f.r * (1 + (1 - ease) * 0.5);
  const amp = f.moving ? 55 * Math.max(0.4, ease) : 0;
  const mk = (cx) => {
    const t = { cx, r, amp, period: rng.range(5.5, 7.5), ph: rng.range(0, TAU), hit: false, fz: amp + r + 36 };
    s.targets.push(t);
    return t;
  };
  let first;
  if (f.twin) {
    first = mk(rng.range(340, 500));
    mk(rng.range(620, 860));
  } else first = mk(rng.range(f.x0, f.x1));
  if (f.ridge && ease > 0) {
    const c = clamp(LX + (first.cx - LX) * rng.range(0.4, 0.55), 250, first.cx - first.fz - 110);
    s.bumps.push({ c, w: rng.range(60, 85), h: rng.range(110, 160) * Math.max(0.5, ease) });
  }
  if (f.cover && ease > 0) s.bumps.push({ c: first.cx - first.fz - 50, w: 19, h: rng.range(170, 230) * Math.max(0.55, ease) });
  return sampleTerrain(s);
}

// Draws a station from the rng and proves it can be hit; a draft that cannot is softened and
// redrawn, and a plain calm range is the last resort.
function* buildSteps(n, rng) {
  for (let k = 0; k < 14; k++) {
    const s = draftStation(n, rng, k);
    if (yield* verifySteps(s)) {
      s.attempts = k + 1;
      return s;
    }
    yield;
  }
  const s = draftStation(n, rng, 99);
  s.attempts = 15;
  return s;
}
export function buildStation(n, rng) {
  return drain(buildSteps(n, rng));
}

const pad2 = (n) => String(n).padStart(2, "0");
const GREENISH = LAMP.green, AMBERISH = LAMP.amber, REDDISH = LAMP.red;

export class Ballista {
  constructor(ctx) {
    this.ctx = ctx;
    this.t = 0;
    this.st = 0;
    this.sweepT = 0;
    this.pt = 0;
    this.phase = "title";
    this.btn = false;
    this.latched = false;
    this.charging = false;
    this.hold = 0;
    this.power = 0;
    this.angle = 45;
    this.peaked = false;
    this.flash = 0;
    this.toneK = -1;
    this.stationNo = 1;
    this.total = 0;
    this.cleared = 0;
    this.shots = 0;
    this.hits = 0;
    this.probes = 0;
    this.reserve = 0;
    this.carried = 0;
    this.wind = 0;
    this.flight = null;
    this.launchT = 0;
    this.fx = null;
    this.last = null;
    this.advice = "";
    this.sfx = [];
    this.hudKey = "";
    this.hintKey = "";
    this.outcome = null;
    this.traces = [0, 1, 2].map(() => ({ pts: new Float32Array(TRACE_POINTS * 2), n: 0, hit: false }));
    this.ground = new Float32Array(121);
    this.job = null; // a station being built a few steps per frame: { n, it, site, done }
    this.applyPending = false;
    this.site = buildStation(1, ctx.rng);
    this.cacheGround();
    this.setHint("TITLE", "PRESS TO BEGIN. HOLD TO CHARGE, RELEASE TO LAUNCH.");
    this.hudNow();
  }

  setHint(key, message) {
    if (key === this.hintKey) return;
    this.hintKey = key;
    this.ctx.hint(message);
  }
  hudNow() {
    const key = this.stationNo + "/" + this.probes + "/" + this.total;
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.ctx.hud([["STATION", pad2(this.stationNo)], ["PROBES", this.phase === "title" ? "-" : this.probes], ["SCORE", this.total]]);
  }
  cacheGround() {
    for (let i = 0; i < this.ground.length; i++) this.ground[i] = heightAt(this.site, i * 8);
  }
  queue(list) {
    for (const [at, hz, d, w] of list) if (this.sfx.length < 12) this.sfx.push({ at: this.t + at, hz, d, w });
  }
  runSfx() {
    if (!this.sfx.length) return;
    const rest = [];
    for (const e of this.sfx) {
      if (e.at <= this.t) this.ctx.tone(e.hz, e.d, e.w);
      else rest.push(e);
    }
    this.sfx = rest;
  }

  // ---- input ----
  down() {
    this.btn = true;
    if (this.phase === "title" || (this.phase === "over" && this.pt > 1)) this.newRun();
    else if (this.phase === "brief" && this.pt > 0.5 && !this.applyPending) this.startPlay();
    else if (this.phase === "cleared" && this.pt > 1) {
      this.stationNo++;
      this.startBrief();
    } else if (this.phase === "failed" && this.pt > 1.2) {
      this.phase = "over";
      this.pt = 0;
      this.setHint("OVER", "SURVEY ENDED. PRESS TO TRY AGAIN.");
    } else if (this.phase === "play") {
      if (this.latched || this.flight) this.latched = true;
      else this.beginCharge();
    }
  }
  up() {
    this.btn = false;
    this.latched = false;
    if (!this.charging) return;
    if (this.hold >= MIN_HOLD) this.launch(this.power);
    else {
      this.cancelCharge();
      this.ctx.tone(260, 0.04, "triangle");
      this.advice = "TOO SHORT: NOTHING LAUNCHED. HOLD TO CHARGE.";
      this.hintKey = "";
    }
  }
  cancel() {
    this.btn = false;
    this.latched = false;
    this.cancelCharge();
    this.ctx.leds(lightsOff());
  }
  pause() {
    this.cancelCharge();
    this.ctx.leds(lightsOff());
  }
  resume() {
    this.btn = false;
    this.latched = false;
  }
  dispose() {
    this.cancelCharge();
    this.ctx.leds(lightsOff());
  }
  cancelCharge() {
    this.charging = false;
    this.hold = 0;
    this.power = 0;
    this.toneK = -1;
    this.ctx.synth.stopTone();
  }
  beginCharge() {
    this.charging = true;
    this.hold = 0;
    this.power = 0;
    this.peaked = false;
    this.flash = 0;
    this.toneK = -1;
    this.angle = sweepAngle(this.site, this.sweepT); // the instant of the press fixes the angle
  }

  // ---- flow ----
  newRun() {
    this.stationNo = 1;
    this.total = 0;
    this.cleared = 0;
    this.shots = 0;
    this.hits = 0;
    this.reserve = 0;
    this.last = null;
    this.startBrief();
  }
  // Building a station proves every target can be hit, which can take over a hundred milliseconds
  // in one go. So the next station is built a few steps per frame while the current one is played
  // (from a private generator seeded from ctx.rng, so a run stays reproducible), and a brief only
  // waits if the build is not finished yet.
  makeJob(n) {
    return { n, it: buildSteps(n, new Random(this.ctx.rng.int(1, 0x3fffffff))), site: null, done: false };
  }
  pump(job, steps) {
    for (let i = 0; i < steps && !job.done; i++) {
      const r = job.it.next();
      if (r.done) { job.site = r.value; job.done = true; }
    }
  }
  startBrief() {
    this.cancelCharge();
    this.phase = "brief";
    this.pt = 0;
    this.flight = null;
    this.fx = null;
    if (!this.job || this.job.n !== this.stationNo) this.job = this.makeJob(this.stationNo);
    this.applyPending = true;
    if (this.job.done) this.applySite();
    else {
      this.hudNow();
      this.setHint("SURVEY" + this.stationNo, "STATION " + this.stationNo + ": SURVEYING THE SITE...");
    }
  }
  applySite() {
    this.applyPending = false;
    this.site = this.job.site;
    this.cacheGround();
    this.probes = this.site.probes + this.reserve;
    this.carried = this.reserve;
    this.reserve = 0;
    this.wind = this.site.windA ? this.ctx.rng.range(-this.site.windA, this.site.windA) : 0;
    this.flight = null;
    this.fx = null;
    this.advice = "";
    this.st = 0;
    for (const tr of this.traces) { tr.n = 0; tr.hit = false; }
    this.last = null;
    this.pt = 0;
    this.hudNow();
    this.setHint("BRIEF" + this.stationNo, "STATION " + this.stationNo + ": " + this.site.name + ". " + this.site.note);
  }
  startPlay() {
    this.phase = "play";
    this.pt = 0;
    if (!this.job || this.job.n !== this.stationNo + 1) this.job = this.makeJob(this.stationNo + 1);
    this.latched = this.btn; // a press that skipped the briefing does not become a charge
    this.hintKey = "";
  }
  nextWind() {
    const a = this.site.windA;
    return a ? this.ctx.rng.range(-a, a) : 0;
  }
  launch(power) {
    const s = this.site;
    this.charging = false;
    this.hold = 0;
    this.ctx.synth.stopTone();
    this.probes--;
    this.shots++;
    this.last = { angle: this.angle, power, x: 0, y: 0, kind: "", dist: 0, side: 0 };
    this.flight = launchProbe(s, this.angle, power, this.wind);
    this.launchT = this.st;
    this.fx = null;
    const tr = this.traces.pop();
    this.traces.unshift(tr);
    tr.n = 1;
    tr.hit = false;
    tr.pts[0] = this.flight.x;
    tr.pts[1] = this.flight.y;
    this.ctx.tone(62, 0.22, "sine");
    this.ctx.tone(124, 0.08, "triangle");
    this.hudNow();
    this.hintKey = "";
  }
  finishFlight(res) {
    const s = this.site, pr = this.flight, now = this.launchT + pr.t, last = this.last;
    const tr = this.traces[0];
    this.flight = null;
    last.x = pr.x;
    last.y = Math.max(0, pr.y);
    if (res === 1) {
      const tg = s.targets[pr.hitIdx];
      tg.hit = true;
      tr.hit = true;
      const left = s.targets.filter((t) => !t.hit).length;
      const pts = Math.round((100 + 70 * this.probes + (this.shots === 1 ? 60 : 0)) * (1 + 0.1 * (s.n - 1)));
      this.total += pts;
      this.hits++;
      last.kind = "hit";
      last.pts = pts;
      this.ctx.score(this.total);
      this.fx = { kind: "hit", t: 0 };
      this.queue([[0, 659, 0.12, "triangle"], [0.1, 880, 0.12, "triangle"], [0.2, 1175, 0.2, "triangle"]]);
      this.hudNow();
      if (!left) {
        this.cleared = Math.max(this.cleared, s.n);
        this.reserve = Math.min(2, this.probes);
        this.phase = "cleared";
        this.pt = 0;
        this.setHint("CLEARED", this.probes > 0 ? "STATION CLEARED. SPARE PROBES CARRY FORWARD. PRESS TO CONTINUE." : "STATION CLEARED. PRESS TO CONTINUE.");
        this.queue([[0.45, 523, 0.14, "triangle"], [0.6, 659, 0.14, "triangle"], [0.75, 784, 0.14, "triangle"], [0.9, 1047, 0.3, "triangle"]]);
        return;
      }
      this.advice = "HIT! " + left + " TARGET" + (left > 1 ? "S" : "") + " LEFT.";
    } else {
      // which side did it fall: compared with the nearest target that is still standing
      let near = null, nd = 1e9;
      for (const t of s.targets) {
        if (t.hit) continue;
        const d = Math.abs(pr.x - targetX(t, now));
        if (d < nd) { nd = d; near = t; }
      }
      const cx = near ? targetX(near, now) : pr.x;
      const side = pr.x < cx ? -1 : 1;
      const out = res === 3 && pr.x > 0;
      last.kind = "miss";
      last.side = side;
      last.dist = nd;
      const blocked = res === 2 && terrainAt(s, pr.x) > 28 && side < 0;
      const units = Math.round(nd / 10);
      this.advice = blocked ? "BLOCKED BY THE TERRAIN. TRY A HIGHER ARC." : (side < 0 ? "SHORT BY " : "LONG BY ") + units + (side < 0 ? ". MORE POWER OR A HIGHER ARC." : ". LESS POWER OR A LOWER ARC.");
      if (out) this.advice = "LONG BY " + units + ". LESS POWER.";
      this.fx = { kind: "miss", t: 0, side, near: near ? nd < near.r * 3 + 40 : false, far: Math.min(1, nd / 400) };
      const close = this.fx.near;
      this.queue(close ? [[0, 262, 0.16, "triangle"], [0.14, 220, 0.24, "triangle"]] : [[0, 165, 0.22, "triangle"], [0.18, 110, 0.32, "sine"]]);
      if (this.probes <= 0) {
        this.phase = "failed";
        this.pt = 0;
        this.outcome = { why: blocked ? "BLOCKED BY THE TERRAIN" : (side < 0 ? "SHORT BY " : "LONG BY ") + units };
        this.setHint("FAILED", "OUT OF PROBES. THE SURVEY ENDS HERE.");
        this.finishRun();
        this.queue([[0.5, 220, 0.2, "sawtooth"], [0.75, 165, 0.2, "sawtooth"], [1, 110, 0.5, "sawtooth"]]);
        this.hudNow();
        return;
      }
    }
    this.wind = this.nextWind(); // the wind changes between shots
    this.hintKey = "";
  }
  finishRun() {
    this.ctx.score(this.total);
    recordRun(this.ctx, {
      score: this.total, stations: this.cleared, shots: this.shots,
      accuracy: this.shots ? Math.round((100 * this.hits) / this.shots) : 0, milestone: this.cleared,
    });
  }

  // ---- simulation ----
  update(dt) {
    const step = dt > 0 && dt < 0.1 ? dt : STEP;
    this.t += step;
    this.pt += step;
    this.sweepT += step;
    if (this.site) this.st += step;
    if (this.fx) this.fx.t += step;
    if (this.flash > 0) this.flash -= step;
    this.runSfx();
    if (this.phase === "play") this.play(step);
    else if (this.phase === "cleared" || this.phase === "failed") this.after();
    else this.idleLamps();
    if (this.job && !this.job.done) {
      this.pump(this.job, this.phase === "brief" ? 10 : 4); // about a millisecond a step
      if (this.job.done && this.applyPending) this.applySite();
    }
    if (this.phase === "brief" && this.pt >= 2.8 && !this.applyPending) this.startPlay();
  }

  play(step) {
    const s = this.site;
    if (this.charging) {
      this.hold += step;
      if (this.hold > HOLD_LIMIT) this.cancelCharge();
      else {
        const p = powerAt(this.hold, s.fixedPower);
        const rising = s.fixedPower > 0 || (this.hold / (2 * RISE)) % 1 < 0.5;
        if (!s.fixedPower && !rising && !this.peaked) {
          this.peaked = true;
          this.flash = 0.14;
          this.ctx.tone(1175, 0.07, "triangle");
        } else if (rising && this.peaked) this.peaked = false;
        this.power = p;
        const k = Math.floor(p * 20);
        if (k !== this.toneK) {
          this.toneK = k;
          this.ctx.synth.startTone(170 * Math.pow(2, k / 10));
        }
      }
    }
    if (this.flight) {
      const pr = this.flight;
      const res = flightTick(s, pr, this.launchT);
      if (!Number.isFinite(pr.x) || !Number.isFinite(pr.y)) { pr.x = 0; pr.y = 0; }
      const tr = this.traces[0];
      if (pr.n % 3 === 0 && tr.n < TRACE_POINTS) {
        tr.pts[tr.n * 2] = pr.x;
        tr.pts[tr.n * 2 + 1] = pr.y;
        tr.n++;
      }
      if (res) {
        if (tr.n < TRACE_POINTS) { tr.pts[tr.n * 2] = pr.x; tr.pts[tr.n * 2 + 1] = Math.max(0, pr.y); tr.n++; }
        this.finishFlight(res);
      }
    }
    if (this.phase === "play") {
      this.coach();
      this.ctx.leds(this.playLamps());
    }
  }

  coach() {
    const s = this.site;
    if (this.charging) {
      if (s.fixedPower) this.setHint("C2", "RELEASE TO LAUNCH. THE ANGLE WAS FIXED WHEN YOU PRESSED.");
      else if (this.peaked) this.setHint("C3", "PAST THE PEAK: POWER IS FALLING. RELEASE TO LAUNCH.");
      else this.setHint("C1", s.n === 1 ? "RELEASE TO LAUNCH. HOLD LONGER FOR MORE POWER." : "RELEASE TO LAUNCH. THE METER PEAKS, THEN FALLS.");
    } else if (this.flight) this.setHint("F", "PROBE IN FLIGHT. THE LAMPS FOLLOW IT TO THE TARGET.");
    else if (this.advice) this.setHint("A" + this.shots + this.advice.length, this.advice);
    else if (s.n === 1) this.setHint("S1", "PRESS AND HOLD: THE LONGER YOU HOLD, THE FARTHER IT FLIES.");
    else if (s.n === 2) this.setHint("S2", "PRESS WHEN THE BARREL POINTS WHERE YOU WANT IT.");
    else this.setHint("S", "PRESS FIXES THE ANGLE. HOLD SETS THE POWER.");
  }

  after() {
    const ok = this.phase === "cleared";
    if (ok) {
      if (this.pt < 1.8) {
        const lit = chase(this.pt, 6, true);
        this.ctx.leds(lamps(...[0, 1, 2].map((i) => dim(LAMP.green, i === lit ? 0.55 : 0.1))));
      } else this.ctx.leds(fill(LAMP.green, 0.1 + 0.08 * pulse(this.t, 0.4)));
    } else {
      if (this.pt < 0.7) this.ctx.leds(blink(this.pt, 8) ? fill(LAMP.red, 0.6) : lightsOff());
      else this.ctx.leds(fill(LAMP.red, 0.04 + 0.04 * pulse(this.t, 0.5)));
      if (this.pt > 4) {
        this.phase = "over";
        this.pt = 0;
        this.setHint("OVER", "SURVEY ENDED. PRESS TO TRY AGAIN.");
      }
    }
  }

  // ---- lamps ----
  idleLamps() {
    if (this.phase === "brief") this.ctx.leds(spot(sweepFrac(this.sweepT), dim(LAMP.green, 0.12)));
    else this.ctx.leds(fill(this.phase === "over" ? LAMP.red : LAMP.green, 0.02 + 0.05 * pulse(this.t, 0.25)));
  }
  playLamps() {
    if (this.charging) return this.chargeLamps();
    if (this.flight) return this.flightLamps();
    if (this.fx && this.fx.t < (this.fx.kind === "hit" ? 1.8 : 1.7)) return this.fxLamps();
    return spot(sweepFrac(this.sweepT), dim(LAMP.green, 0.34));
  }
  // The meter: green, amber, red lamps fill from the left as power rises; past the peak the fill
  // drains again and its edge pulses, so the fall is visible without the screen.
  chargeLamps() {
    if (this.flash > 0) return fill(LAMP.white, 0.4);
    const p = this.power, s = this.site;
    const falling = !s.fixedPower && (this.hold / (2 * RISE)) % 1 >= 0.5;
    const mod = falling ? 0.5 + 0.5 * pulse(this.t, 5) : 1;
    const cols = [GREENISH, AMBERISH, REDDISH];
    return lamps(...cols.map((c, i) => dim(c, 0.42 * clamp(p * 3 - i, 0, 1) * mod)));
  }
  // In flight the spot runs from the left lamp to the right as the probe covers the distance to
  // the target; once it is past the target the spot turns amber.
  flightLamps() {
    const pr = this.flight, s = this.site, now = this.launchT + pr.t;
    let tg = null;
    for (const t of s.targets) {
      if (t.hit) continue;
      tg = t;
      if (targetX(t, now) + t.r >= pr.x) break;
    }
    const cx = tg ? targetX(tg, now) : 900;
    const pos = clamp((pr.x - LX) / Math.max(50, cx - LX), 0, 1);
    const past = tg && pr.x > cx + tg.r;
    const v = spot(pos, dim(past ? LAMP.amber : LAMP.cyan, 0.38));
    const base = dim(LAMP.amber, 0.06);
    for (let c = 0; c < 3; c++) v[6 + c] = Math.max(v[6 + c], base[c]);
    return v;
  }
  // A hit flashes all three; a miss lights the lamp on the side where it fell (left short,
  // right long), brighter and amber when close, dimmer and red when far.
  fxLamps() {
    const f = this.fx;
    if (f.kind === "hit") {
      if (f.t < 1.2) return blink(f.t, 5) ? fill(LAMP.green, 0.5) : fill(LAMP.white, 0.12);
      return fill(LAMP.green, 0.3 * (1 - (f.t - 1.2) / 0.6));
    }
    const fade = Math.max(0, 1 - f.t / 1.7);
    const col = f.near ? LAMP.amber : LAMP.red;
    const level = (f.near ? 0.5 : 0.28 + 0.12 * (1 - f.far)) * (f.t < 0.3 ? (blink(f.t, 8) ? 1 : 0.4) : Math.sqrt(fade));
    const side = f.side < 0 ? 0 : 2;
    const cell = [null, null, null];
    cell[side] = dim(col, level);
    if (f.near) cell[1] = dim(col, level * 0.3);
    return lamps(...cell);
  }

  // ---- drawing ----
  draw(g) {
    space(g, 0, 0.3);
    const s = this.site;
    this.drawWindStreaks(g);
    this.drawTerrain(g);
    if (this.phase !== "title") this.drawTargets(g, s);
    this.drawTraces(g);
    this.drawLauncher(g, s);
    this.drawProbe(g);
    if (this.phase !== "title") this.drawInstruments(g, s);
    if (this.phase === "title") {
      banner(g, "BALLISTA", "LAUNCH PROBES THROUGH THE WIND");
      text(g, "HOLD TO CHARGE   RELEASE TO LAUNCH", 480, 392, 22, C.muted, "center");
    } else if (this.phase === "brief") this.drawBrief(g, s);
    else if (this.phase === "cleared") this.drawCleared(g);
    else if (this.phase === "failed") this.drawFailed(g);
    else if (this.phase === "over") this.drawOver(g);
  }

  panel(g, y, h) {
    g.fillStyle = "#0c1511ee";
    g.fillRect(170, y, 620, h);
    line(g, 215, y + 8, 745, y + 8, C.line);
  }

  drawWindStreaks(g) {
    const w = this.phase === "title" ? 0 : this.wind;
    if (Math.abs(w) < 2) return;
    g.globalAlpha = 0.28;
    g.strokeStyle = C.muted;
    g.lineWidth = 2;
    const len = 12 + Math.abs(w) * 0.5;
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const x = (((i * 173 + this.t * w * 2.2) % 960) + 960) % 960;
      const y = 90 + i * 57 + (i % 2) * 20;
      g.moveTo(x, y);
      g.lineTo(x + len, y);
    }
    g.stroke();
    g.globalAlpha = 1;
  }

  drawTerrain(g) {
    const n = this.ground.length;
    g.beginPath();
    g.moveTo(0, 540);
    for (let i = 0; i < n; i++) g.lineTo(i * 8, GY - this.ground[i]);
    g.lineTo(960, 540);
    g.closePath();
    g.fillStyle = "#101d15";
    g.fill();
    g.strokeStyle = C.muted;
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      if (i) g.lineTo(i * 8, GY - this.ground[i]);
      else g.moveTo(0, GY - this.ground[i]);
    }
    g.stroke();
    // survey marks: one tick per ten units of ten pixels across the datum
    g.strokeStyle = C.line;
    g.lineWidth = 2;
    g.beginPath();
    for (let x = 100; x < 960; x += 100) {
      g.moveTo(x, GY + 4);
      g.lineTo(x, GY + 12);
    }
    g.stroke();
    for (let x = 200; x < 960; x += 200) text(g, x / 10, x, GY + 28, 16, C.muted, "center");
  }

  drawTargets(g, s) {
    for (const t of s.targets) {
      const x = targetX(t, this.st), y = GY - terrainAt(s, x) - t.r;
      if (t.hit) {
        circle(g, x, y, t.r, C.line, false, 2);
        line(g, x - t.r * 0.5, y - t.r * 0.5, x + t.r * 0.5, y + t.r * 0.5, C.muted, 2);
        line(g, x - t.r * 0.5, y + t.r * 0.5, x + t.r * 0.5, y - t.r * 0.5, C.muted, 2);
        continue;
      }
      circle(g, x, y, t.r, C.amber, false, 3);
      circle(g, x, y, t.r * 0.55, C.amber, false, 2);
      circle(g, x, y, 4, C.amber, true);
      if (this.fx && this.fx.kind === "hit" && this.fx.t < 0.8 && this.last && Math.abs(this.last.x - x) < t.r + 90) {
        circle(g, x, y, t.r + this.fx.t * 70, C.ink, false, 2);
      }
    }
    // a hit's burst on a target that has just been removed from play
    if (this.fx && this.fx.kind === "hit" && this.fx.t < 0.8 && this.last) {
      for (const t of s.targets) {
        if (!t.hit) continue;
        const x = targetX(t, this.st);
        if (Math.abs(this.last.x - x) < t.r + 90) circle(g, x, GY - terrainAt(s, x) - t.r, t.r + this.fx.t * 70, C.ink, false, 2);
      }
    }
  }

  drawTraces(g) {
    const dash = [6, 8];
    for (let k = this.traces.length - 1; k >= 0; k--) {
      const tr = this.traces[k];
      if (tr.n < 2) continue;
      g.save();
      g.globalAlpha = k === 0 ? 0.95 : k === 1 ? 0.5 : 0.28;
      g.strokeStyle = tr.hit ? C.ink : C.cyan;
      g.lineWidth = k === 0 ? 3 : 2;
      if (k) g.setLineDash(dash);
      g.beginPath();
      g.moveTo(tr.pts[0], GY - tr.pts[1]);
      for (let i = 1; i < tr.n; i++) g.lineTo(tr.pts[i * 2], GY - tr.pts[i * 2 + 1]);
      g.stroke();
      g.restore();
      // where it came down
      if (!this.flight || k) {
        const x = tr.pts[(tr.n - 1) * 2], y = GY - Math.max(0, tr.pts[(tr.n - 1) * 2 + 1]);
        if (!tr.hit && y > 0) {
          g.globalAlpha = k === 0 ? 1 : 0.4;
          line(g, x - 8, y - 8, x + 8, y + 8, C.red, 3);
          line(g, x - 8, y + 8, x + 8, y - 8, C.red, 3);
          g.globalAlpha = 1;
        }
      }
    }
    const l = this.last;
    if (l && !this.flight && this.traces[0].n > 1) {
      const x = clamp(l.x, 90, 860), y = clamp(GY - l.y - 26, 70, GY - 30);
      if (l.kind === "hit") text(g, "HIT", x, y, 22, C.ink, "center");
      else text(g, (l.side < 0 ? "SHORT " : "LONG ") + Math.round(l.dist / 10), x, y, 22, C.red, "center");
    }
  }

  drawLauncher(g, s) {
    const live = this.phase === "play" && !this.flight;
    const ang = this.charging ? this.angle : sweepAngle(s, this.sweepT);
    const a = (ang * Math.PI) / 180, px = LX, py = GY - PIVOT;
    const col = this.charging ? C.amber : C.ink;
    g.strokeStyle = C.muted;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(px - 30, GY);
    g.lineTo(px - 16, GY - 10);
    g.lineTo(px + 16, GY - 10);
    g.lineTo(px + 30, GY);
    g.stroke();
    if (live) {
      g.save();
      g.globalAlpha = this.charging ? 0.8 : 0.45;
      g.strokeStyle = this.charging ? C.amber : C.cyan;
      g.lineWidth = 2;
      g.setLineDash([3, 9]);
      g.beginPath();
      g.moveTo(px + Math.cos(a) * BARREL, py - Math.sin(a) * BARREL);
      g.lineTo(px + Math.cos(a) * 170, py - Math.sin(a) * 170);
      g.stroke();
      g.restore();
    }
    line(g, px, py, px + Math.cos(a) * BARREL, py - Math.sin(a) * BARREL, col, 7);
    circle(g, px, py, 9, C.bg, true);
    circle(g, px, py, 9, col, false, 3);
    this.drawAng = ang;
  }

  drawProbe(g) {
    const pr = this.flight;
    if (!pr) return;
    const y = GY - pr.y;
    if (y < 14) {
      g.fillStyle = C.cyan;
      g.beginPath();
      g.moveTo(pr.x, 8);
      g.lineTo(pr.x - 9, 24);
      g.lineTo(pr.x + 9, 24);
      g.closePath();
      g.fill();
    } else circle(g, pr.x, y, 6, C.ink, true);
  }

  drawInstruments(g, s) {
    // probe pips, top left
    for (let i = 0; i < this.probes; i++) diamond(g, 40 + i * 26, 34, 8, i >= this.probes - this.carried ? C.amber : C.ink, true);
    // wind, top centre
    if (s.windA > 0 && this.phase !== "title") {
      const w = this.wind, len = (w / 56) * 110;
      text(g, "WIND", 330, 34, 22, C.muted, "right");
      line(g, 370, 34, 590, 34, C.line, 2);
      line(g, 480, 24, 480, 44, C.line, 2);
      const x2 = 480 + len;
      line(g, 480, 34, x2, 34, C.amber, 5);
      const d = w >= 0 ? 1 : -1;
      g.fillStyle = C.amber;
      g.beginPath();
      g.moveTo(x2 + d * 14, 34);
      g.lineTo(x2, 24);
      g.lineTo(x2, 44);
      g.closePath();
      g.fill();
      text(g, (w >= 0 ? ">> " : "<< ") + Math.round(Math.abs(w) / 5), 612, 34, 22, C.amber);
    } else if (this.phase !== "title") text(g, "WIND CALM", 480, 34, 22, C.muted, "center");
    // bottom row: angle, power meter, last shot
    const play = this.phase === "play";
    const ang = this.drawAng ?? 45;
    text(g, "ANGLE " + Math.round(ang), 30, 510, 22, this.charging ? C.amber : C.ink);
    const bx = 290, bw = 330, by = 499;
    g.strokeStyle = C.line;
    g.lineWidth = 2;
    g.strokeRect(bx, by, bw, 22);
    const p = this.charging ? this.power : 0;
    if (p > 0) {
      g.fillStyle = p < 0.4 ? "#3fae5d" : p < 0.75 ? C.amber : C.red;
      g.fillRect(bx + 2, by + 2, (bw - 4) * p, 18);
      const falling = !s.fixedPower && (this.hold / (2 * RISE)) % 1 >= 0.5;
      const hx = bx + 2 + (bw - 4) * p;
      g.fillStyle = C.ink;
      g.beginPath();
      if (falling) { g.moveTo(hx - 8, by + 11); g.lineTo(hx + 4, by + 3); g.lineTo(hx + 4, by + 19); }
      else { g.moveTo(hx + 8, by + 11); g.lineTo(hx - 4, by + 3); g.lineTo(hx - 4, by + 19); }
      g.closePath();
      g.fill();
    }
    if (s.fixedPower) {
      const sx = bx + 2 + (bw - 4) * s.fixedPower;
      line(g, sx, by - 4, sx, by + 26, C.amber, 3);
    } else line(g, bx + bw - 2, by - 5, bx + bw - 2, by + 27, C.amber, 3);
    if (this.last && play) {
      const lx = bx + 2 + (bw - 4) * this.last.power;
      line(g, lx, by - 6, lx, by + 28, C.cyan, 3);
    }
    text(g, this.charging ? Math.round(this.power * 100) + "%" : "POWER", bx + bw + 14, 510, 22, this.charging ? C.amber : C.muted);
    if (this.last) text(g, "LAST " + Math.round(this.last.angle) + "° " + Math.round(this.last.power * 100) + "%", 930, 510, 22, C.cyan, "right");
  }

  drawBrief(g, s) {
    if (this.applyPending) {
      this.panel(g, 110, 100);
      text(g, "STATION " + pad2(this.stationNo), 480, 150, 30, C.ink, "center");
      text(g, "SURVEYING THE SITE...", 480, 198, 20, C.amber, "center");
      return;
    }
    this.panel(g, 110, 176);
    text(g, "STATION " + pad2(s.n) + " / " + s.name, 480, 150, 30, C.ink, "center");
    text(g, s.note.length > 52 ? s.note.slice(0, s.note.lastIndexOf(" ", 52)) : s.note, 480, 198, 20, C.amber, "center");
    if (s.note.length > 52) text(g, s.note.slice(s.note.lastIndexOf(" ", 52) + 1), 480, 224, 20, C.amber, "center");
    const w = s.windA ? "WIND UP TO " + Math.round(s.windA / 5) : "NO WIND";
    text(g, this.probes + " PROBES" + (this.carried ? " (" + this.carried + " CARRIED)" : "") + "   " + w, 480, 262, 18, C.muted, "center");
  }
  drawCleared(g) {
    this.panel(g, 70, 150);
    text(g, "STATION CLEARED", 480, 110, 32, C.ink, "center");
    const l = this.last;
    text(g, "+" + (l ? l.pts : 0) + "   " + this.probes + " PROBE" + (this.probes === 1 ? "" : "S") + " SPARE" + (this.reserve ? ", " + this.reserve + " CARRIED" : ""), 480, 158, 22, C.amber, "center");
    if (this.pt > 1) text(g, "PRESS FOR STATION " + (this.stationNo + 1), 480, 196, 20, C.amber, "center");
  }
  drawFailed(g) {
    this.panel(g, 70, 130);
    text(g, "OUT OF PROBES", 480, 110, 32, C.red, "center");
    text(g, this.outcome ? this.outcome.why : "", 480, 154, 22, C.muted, "center");
  }
  drawOver(g) {
    this.panel(g, 90, 220);
    text(g, "SURVEY ENDED", 480, 134, 32, C.red, "center");
    text(g, "SCORE " + this.total, 480, 184, 30, C.ink, "center");
    text(g, "STATIONS CLEARED " + this.cleared + "   BEST " + Math.max(this.total, this.ctx.best?.() || 0), 480, 226, 19, C.muted, "center");
    text(g, "PROBES " + this.shots + "   HITS " + this.hits, 480, 256, 19, C.muted, "center");
    if (this.pt > 1) text(g, "PRESS TO TRY AGAIN", 480, 296, 20, C.amber, "center");
  }
}
