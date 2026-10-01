// DESCENT — a one-button lander. Hold to fire the engine against gravity, release to
// fall; touch the pad slower than the safe speed with fuel to spare. The world supplies
// the sideways motion (drift, gusts, a sliding pad, a canyon), so the only decision is
// when to fall and when to burn. The three lamps are the descent instrument: colour is
// the vertical-speed verdict, and which lamp is lit says where the pad is.
//
// Voice throttle (optional). Holding the button on the title screen for a second switches the
// microphone to `analyze` and lets your voice burn the engine too: the louder you hum, the
// harder it burns, so you can hover and feather the descent in a way an on/off button cannot.
// The button still burns flat out and always wins. The microphone is only on while the
// player has chosen it; leaving the game switches it off (if this game switched it on), and a
// mute from the system menu, an error or a lost link turns the voice throttle off. With no
// signal the throttle is zero, so the game plays exactly as before.
import { C, space, text, line, circle, diamond, banner } from "../engine/draw.js";
import { clamp, lerp } from "../engine/math.js";
import { LAMP, lamps, fill, dim, blend, pulse, blink, chase, meter, lightsOff } from "../engine/lightshow.js";
import { recordRun } from "../engine/kit.js";
import { AppGuard } from "../engine/input.js";

const W = 480; // world width in metres; it wraps, and one metre is two logical pixels across
const PX = 2;
const GY = 470; // screen y of the pad datum
const HALF = 5; // lander half-width in metres, used for walls and hills
const STEP = 1 / 60;
// The descent runs this much faster than the wall clock (Sam: "way too slow to be fun"). Sites,
// speeds and fuel are designed in simulated seconds; the screen shows fuel in real seconds.
export const PACE = 2;
// Between sites (real seconds): how soon a press continues, and when the game moves on by itself.
const BRIEF_S = 1.4, NEXT_PRESS_S = 0.6, NEXT_AUTO_S = 2.2, RETRY_PRESS_S = 0.8, RETRY_AUTO_S = 2.6;
const wrapX = (x) => ((x % W) + W) % W;
const wrapD = (d) => wrapX(d + W / 2) - W / 2;
const smooth = (t) => {
  const u = clamp(t, 0, 1);
  return u * u * (3 - 2 * u);
};

// ---- voice throttle ----
// The analysis frames (about ten a second) carry 28 log bands, 60 Hz to 7 kHz, in dBFS. A voice
// is read from the loudest band between about 140 Hz and 4 kHz: that leaves out the engine's
// own 88 Hz rumble from the speaker and most hiss. The throttle is how far that sits above the
// room's noise floor, which is measured while the player is quiet and then follows the room.
export const VOICE = {
  bands: [5, 24],     // band 5 starts at 140 Hz, band 24 ends near 4 kHz
  gateDb: 12,         // this far above the floor before anything burns
  spanDb: 28,         // and this much further for a full burn
  calibrateS: 1.5,    // the first moments after switching on only learn the room
  staleS: 0.5,        // no frame for this long: the throttle falls to zero
  holdS: 0.8,         // a title-screen hold this long toggles the voice throttle
  rise: 14, fall: 9,  // smoothing rates (per second) towards the latest frame
};
const FLOOR_LO = -110, FLOOR_HI = -35;

// The voice level of one analysis frame, in dBFS, or null if the frame has nothing usable.
export function voiceDb(frame) {
  if (!frame || typeof frame !== "object") return null;
  if (Array.isArray(frame.bands) && frame.bands.length > VOICE.bands[1]) {
    let top = -Infinity;
    for (let i = VOICE.bands[0]; i <= VOICE.bands[1]; i++) if (Number.isFinite(frame.bands[i])) top = Math.max(top, frame.bands[i]);
    if (top > -Infinity) return top;
  }
  return Number.isFinite(frame.rmsDb) ? frame.rmsDb : null;
}

// Microphone ownership, the noise floor and the smoothed throttle. A class instance, so the
// menu gesture's rewind (AppGuard) leaves it alone: the microphone is real, not game state.
export class VoiceThrottle {
  constructor(ctx) {
    this.ctx = ctx;
    this.want = false;    // the player has asked for it
    this.owned = false;   // this game switched the microphone to analyze
    this.pending = false;
    this.clock = 0;
    this.reset();
  }
  reset() {
    this.floor = null;
    this.samples = 0;
    this.since = this.clock;
    this.lastAt = -Infinity;
    this.target = 0;
    this.value = 0;
    this.level = null;
  }
  get on() { return this.want && this.owned; }
  get calibrating() { return this.on && (this.floor === null || this.clock - this.since < VOICE.calibrateS); }
  get heard() { return this.on && this.clock - this.lastAt <= VOICE.staleS; }
  get throttle() { return this.on && !this.calibrating ? this.value : 0; }

  enable() {
    if (this.want) return Promise.resolve();
    if (this.ctx.state?.().controller === false) {
      this.ctx.toast?.("This is a monitor tab. It cannot start the microphone.");
      return Promise.resolve();
    }
    this.want = true;
    this.pending = true;
    this.owned = true;
    this.reset();
    let result;
    try { result = this.ctx.setMic("analyze"); } catch (error) { result = Promise.reject(error); }
    return Promise.resolve(result).then(
      () => {
        this.pending = false;
        // The service reports the mode before it answers; anything but analyze is not ours.
        const mode = this.ctx.state?.().mic?.mode;
        if (mode !== undefined && mode !== "analyze") this.drop();
      },
      () => { this.pending = false; this.drop(); },
    );
  }
  disable() {
    const owned = this.owned;
    this.drop();
    if (!owned) return Promise.resolve();
    let result;
    try { result = this.ctx.setMic("off"); } catch (error) { result = Promise.reject(error); }
    return Promise.resolve(result).catch(() => {});
  }
  // The microphone is gone (muted elsewhere, an error, a lost link): forget it, touch nothing.
  drop() {
    this.want = this.owned = this.pending = false;
    this.reset();
  }

  event(e) {
    if (!e || typeof e !== "object") return;
    if (e.type === "analysis") this.frame(e);
    else if (e.type === "analysis_error" || e.type === "offline" || e.type === "node_reset" || (e.type === "device" && e.connected === false)) {
      if (this.want) this.drop();
    } else if (e.type === "mic" && this.want && !this.pending && e.mode !== "analyze") this.drop();
  }
  frame(e) {
    if (!this.on) return;
    const level = voiceDb(e);
    if (level === null) return;
    const dt = Number.isFinite(this.lastAt) ? clamp(this.clock - this.lastAt, 0, 0.5) : 0.1;
    this.lastAt = this.clock;
    this.level = level;
    if (this.floor === null || this.clock - this.since < VOICE.calibrateS) {
      // Learning the room: the mean of the quiet frames so far.
      this.samples = this.floor === null ? 1 : this.samples + 1;
      this.floor = clamp(this.floor === null ? level : this.floor + (level - this.floor) / this.samples, FLOOR_LO, FLOOR_HI);
    } else if (level < this.floor) this.floor = clamp(lerp(this.floor, level, 0.5), FLOOR_LO, FLOOR_HI);
    else {
      // Near the floor it follows the room; well above it (a voice) it barely moves.
      const rate = level - this.floor < VOICE.gateDb ? 2 : 0.15;
      this.floor = clamp(this.floor + rate * dt, FLOOR_LO, FLOOR_HI);
    }
    this.target = clamp((level - this.floor - VOICE.gateDb) / VOICE.spanDb, 0, 1);
  }
  tick(dt) {
    this.clock += dt;
    const target = this.heard ? this.target : 0;
    const k = target > this.value ? VOICE.rise : VOICE.fall;
    this.value += (target - this.value) * clamp(k * dt, 0, 1);
    if (this.value < 0.002) this.value = 0;
  }
}

// Sideways wind as a function of time: a list of levels, eased between every `gustP` seconds.
function gustAt(s, t) {
  const n = s.gusts.length;
  if (!n) return 0;
  const k = Math.floor(t / s.gustP);
  const a = s.gusts[Math.min(k, n - 1)];
  const b = s.gusts[Math.min(k + 1, n - 1)];
  return lerp(a, b, smooth((t - k * s.gustP - (s.gustP - 1.5)) / 1.5));
}

// The shared advance for the lander's drift and the pad's slide; used for play and for planning.
function stepWorld(s, w, dt) {
  w.t += dt;
  w.vx = s.drift + gustAt(s, w.t);
  w.x = wrapX(w.x + w.vx * dt);
  if (s.padSpeed) {
    const lo = s.pc - s.padRange / 2, hi = s.pc + s.padRange / 2;
    w.padx += w.pv * dt;
    if (w.padx > hi) { w.padx = hi; w.pv = -Math.abs(w.pv); }
    if (w.padx < lo) { w.padx = lo; w.pv = Math.abs(w.pv); }
  }
}

const groundAt = (s, x) => {
  let h = 0;
  for (let d = -HALF; d <= HALF; d += HALF) h = Math.max(h, s.terrain[Math.round(wrapX(x + d) / 2) % s.terrain.length]);
  return h;
};

// What the lander would do if it burned flat out from now: touchdown speed, whether that is a
// crash, and how urgent braking is (0 plenty of room .. 1 none).
function outlook(alt, vy, fuel, g, a, safe) {
  const net = a - g;
  if (vy <= safe) return { crash: false, urgency: 0 };
  const tStop = vy / net;
  let vtd2;
  if (fuel >= tStop) {
    vtd2 = (vy * vy) / (2 * net) >= alt ? vy * vy - 2 * net * alt : 0;
  } else {
    const d1 = vy * fuel - 0.5 * net * fuel * fuel;
    vtd2 = d1 >= alt ? vy * vy - 2 * net * alt : (vy - net * fuel) ** 2 + 2 * g * (alt - d1);
  }
  const spare = alt - (vy * vy - safe * safe) / (2 * net);
  return { crash: Math.sqrt(Math.max(0, vtd2)) > safe, urgency: 1 - clamp(spare / 35, 0, 1) };
}

// The cheapest approach: coast, then brake just in time. Gives the fastest descent time and
// the fuel it takes, from which each site's fuel and starting position are set.
function planBurn(s) {
  let alt = s.H, vy = s.vy0, t = 0, fuel = 0;
  const vt = 0.6 * s.safe, net = s.a - s.g;
  while (alt > 0 && t < 120) {
    const burn = vy > vt && (vy * vy - vt * vt) / (2 * net) >= alt * 0.97;
    vy += (burn ? s.g - s.a : s.g) * STEP;
    if (burn) fuel += STEP;
    alt -= vy * STEP;
    t += STEP;
  }
  return { t, fuel };
}

const FEATURES = {
  drift(s, rng, level) {
    s.drift = (rng.next() < 0.5 ? -1 : 1) * clamp(3 + 0.35 * s.n, 3, 7);
    s.delay = Math.max(s.delay, 3 + level * 0.15);
  },
  tight(s) { s.padHalf *= 0.78; },
  thin(s) { s.g = 0.9; s.a = 3; s.H = 120; s.tag = "THIN AIR"; s.note = "LOW GRAVITY. THE FALL IS SLOW AND FLOATY."; },
  heavy(s) { s.g = 3; s.a = 6; s.H = 220; s.tag = "HEAVY WORLD"; s.note = "HIGH GRAVITY. BRAKE EARLY."; },
  gust(s, rng, level) {
    s.gustA = 6 + level * 0.2;
    s.gusts = [0];
    for (let i = 1; i < 9; i++) s.gusts.push(rng.range(-s.gustA, s.gustA));
    s.tag = "WIND GUSTS"; s.note = "THE DRIFT CHANGES. WATCH THE LAMPS.";
  },
  moving(s, rng, level) {
    s.padSpeed = 6 + level * 0.2;
    s.padRange = 150;
    s.tag = "SLIDING PAD"; s.note = "THE PAD IS MOVING. TIME YOUR ARRIVAL.";
  },
  canyon(s) {
    s.canyon = 1; s.rim = 80; s.gap = 36; s.H = 190; s.tag = "CANYON";
    s.note = "DROP INTO THE CANYON. MIND THE WALLS.";
    s.drift = clamp(s.drift, -3, 3) || 2.5;
    s.delay = 2;
  },
};
const TITLE_HINT = "TAP TO BEGIN. HOLD ONE SECOND TO SWITCH THE VOICE THROTTLE ON OR OFF.";
const FIXED = [[], ["drift"], ["drift", "tight"], ["thin", "drift"], ["heavy", "drift"], ["gust"], ["moving"], ["drift", "canyon"]];
const BASIC = [
  ["TRAINING FLAT", "NO DRIFT. HOLD TO BURN, RELEASE TO FALL."],
  ["CROSSWIND", "THE LANDER DRIFTS. THE LAMPS SHOW THE PAD."],
  ["NARROW PAD", "A SMALLER PAD AND LESS FUEL."],
];

function buildSite(n, rng) {
  const level = Math.max(0, n - 8);
  const s = {
    n, name: "SITE", tag: "", note: "", g: 1.6, a: 4, H: n === 1 ? 240 : 170, vy0: n === 1 ? 3 : 0, safe: n === 1 ? 6 : n === 2 ? 5.5 : n === 3 ? 5 : n < 10 ? 4.5 : 4,
    drift: 0, gusts: [], gustA: 0, gustP: 5.5, padHalf: clamp(52 - 3.2 * n, 24, 50), padSpeed: 0, padRange: 0,
    canyon: 0, rim: 0, gap: 0, delay: 0, margin: 1.5, pc: rng.range(140, 340), terrain: [],
  };
  let list;
  if (n <= FIXED.length) list = FIXED[n - 1];
  else {
    const pool = ["thin", "heavy", "gust", "moving", "canyon"];
    list = ["drift", rng.pick(pool)];
    if (level > 3 && rng.next() < 0.5) list.push("tight");
    if (list.includes("gust") && rng.next() < 0.3) list.push("moving");
    if (list.includes("thin") && list.includes("heavy")) list.splice(list.indexOf("heavy"), 1);
  }
  for (const f of list) FEATURES[f](s, rng, level);
  if (n <= 3) { s.name = BASIC[n - 1][0]; s.note = BASIC[n - 1][1]; }
  else s.name = s.tag || "DEEP SURVEY";
  if (n > 8) s.note = (s.tag ? s.tag + ". " : "") + "THE SITES GROW HARDER.";
  s.margin = n === 1 ? 2.4 : n === 2 ? 2.0 : n === 3 ? 1.8 : n === 4 ? 1.7 : Math.max(1.3, 1.5 - 0.02 * level);
  if (s.canyon && s.padSpeed) s.padSpeed = 0;
  if (s.canyon) s.padHalf = Math.min(s.padHalf, s.gap - HALF - 4);
  s.scale = Math.min(2, 335 / s.H);
  // terrain, sampled every two metres
  const flat = s.canyon ? s.gap : s.padRange / 2 + s.padHalf + 10;
  const p1 = rng.range(0, 6.28), p2 = rng.range(0, 6.28), k1 = rng.int(3, 5), k2 = rng.int(7, 11);
  for (let i = 0; i < W / 2; i++) {
    const x = i * 2, d = Math.abs(wrapD(x - s.pc));
    let h;
    if (s.canyon) h = d > s.gap ? s.rim + 5 + 4 * Math.sin(k2 * x * 0.0131 + p2) : 0;
    else h = smooth((d - flat) / 45) * (7 + 12 * (0.5 + 0.5 * Math.sin((k1 * x * 6.2832) / W + p1)) * (0.65 + 0.35 * Math.sin((k2 * x * 6.2832) / W + p2)));
    s.terrain.push(Math.max(0, h));
  }
  // fuel and starting position follow from the fastest sensible descent
  const plan = planBurn(s);
  s.fuel = (plan.fuel + (s.delay * s.g) / s.a) * s.margin + 0.8;
  const arrive = plan.t + s.delay;
  const ghost = { t: 0, x: 0, vx: 0, padx: s.pc, pv: s.padSpeed ? (rng.next() < 0.5 ? -1 : 1) * s.padSpeed : 0 };
  if (s.padSpeed) ghost.padx = s.pc + rng.range(-0.4, 0.4) * s.padRange;
  const pad0 = ghost.padx, pv0 = ghost.pv;
  for (let t = 0; t < arrive; t += STEP) stepWorld(s, ghost, STEP);
  s.pad0 = pad0;
  s.pv0 = pv0;
  s.x0 = wrapX(ghost.padx - ghost.x);
  s.minTime = plan.t;
  return s;
}

export class Descent {
  constructor(ctx) {
    this.ctx = ctx;
    this.guard = new AppGuard(this, ctx); // takes back a menu gesture that reached the game (docs/ENGINE.md)
    this.voice = new VoiceThrottle(ctx);
    this.t = 0;
    this.phase = "title";
    this.pt = 0;
    this.btn = false;
    this.latched = false;
    this.burning = false;
    this.power = 0;       // engine output this step, 0..1
    this.engineTone = false;
    this.armed = false;   // a title-screen press waiting for its release: a tap starts, a hold toggles the voice
    this.downAt = 0;
    this.intro = true; // the very first briefing of a session waits for a press
    this.waitBrief = false;
    this.warnClock = 0;
    this.siteNo = 1;
    this.lives = 3;
    this.total = 0;
    this.cleared = 0;
    this.bestFuel = 0;
    this.site = null;
    this.w = null;
    this.fuel = 0;
    this.outcome = null;
    this.out = { crash: false, urgency: 0 };
    this.hudKey = "";
    this.hintKey = "";
    this.seq = 0;
    this.setHint("TITLE", TITLE_HINT);
    this.hudNow();
  }

  setHint(key, message) {
    if (key === this.hintKey) return;
    this.hintKey = key;
    this.ctx.hint(message);
  }
  hudNow() {
    const key = this.siteNo + "/" + this.lives + "/" + this.total;
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.ctx.hud([["SITE", String(this.siteNo).padStart(2, "0")], ["LANDERS", this.lives], ["SCORE", this.total]]);
  }

  // ---- input ----
  down() {
    this.guard.mark();
    this.btn = true;
    if (this.phase === "title" || (this.phase === "over" && this.pt > 1)) {
      // Decided on release: a tap starts a run, a hold switches the voice throttle.
      this.armed = true;
      this.downAt = this.t;
    } else if (this.phase === "brief" && this.pt > 0.5) {
      this.startPlay();
    } else if (this.phase === "landed" && this.pt > NEXT_PRESS_S) {
      this.siteNo++;
      this.startBrief(true);
    } else if (this.phase === "crashed" && this.lives > 0 && this.pt > RETRY_PRESS_S) {
      this.startBrief(false);
    }
  }
  up() {
    this.guard.release();
    this.btn = false;
    this.latched = false;
    if (this.armed) {
      this.armed = false;
      if (this.t - this.downAt >= VOICE.holdS) this.toggleVoice();
      else this.newRun();
    }
  }
  cancel() {
    this.guard.rewind();
    this.btn = false;
    this.latched = false;
    this.armed = false;
    this.stopEngine();
    this.ctx.leds(lightsOff());
  }
  pause() { this.guard.settle(); this.stopEngine(); this.ctx.leds(lightsOff()); }
  resume() { this.burning = false; }
  dispose() {
    this.guard.settle();
    this.stopEngine();
    this.voice.disable();
    this.ctx.leds(lightsOff());
  }
  event(e) {
    try { this.voice.event(e); } catch {}
  }
  stopEngine() {
    this.burning = false;
    this.power = 0;
    this.engineTone = false;
    this.ctx.synth.stopTone();
  }
  toggleVoice() {
    if (this.voice.want) {
      this.voice.disable();
      this.ctx.toast?.("VOICE THROTTLE OFF. THE MICROPHONE IS OFF.");
      this.ctx.tone(330, 0.12, "triangle");
    } else {
      this.voice.enable();
      this.ctx.tone(660, 0.12, "triangle");
    }
  }

  // ---- flow ----
  newRun() {
    this.siteNo = 1;
    this.lives = 3;
    this.total = 0;
    this.cleared = 0;
    this.bestFuel = 0;
    this.startBrief(true);
  }
  startBrief(fresh) {
    if (fresh || !this.site) this.site = buildSite(this.siteNo, this.ctx.rng);
    this.resetWorld();
    this.phase = "brief";
    this.pt = 0;
    this.waitBrief = this.intro && this.siteNo === 1;
    this.intro = false;
    this.stopEngine();
    this.hudNow();
    this.setHint("BRIEF" + this.siteNo, this.siteNo === 1 ? (this.waitBrief ? "PRESS TO START THE DESCENT. HOLD TO BURN, RELEASE TO FALL." : "HOLD TO BURN. KEEP THE LAMPS GREEN AT TOUCHDOWN.") : "SITE " + this.siteNo + ": " + (this.site.tag || this.site.name));
  }
  resetWorld() {
    const s = this.site;
    this.w = { t: 0, x: s.x0, vx: s.drift, padx: s.pad0, pv: s.pv0, alt: s.H, vy: s.vy0 };
    this.fuel = s.fuel;
    this.out = { crash: false, urgency: 0 };
    this.burnedOnce = false;
  }
  startPlay() {
    this.phase = "play";
    this.pt = 0;
    this.waitBrief = false;
    this.latched = this.btn; // a press that skipped the briefing does not become a burn
    this.hintKey = "";
  }
  finishRun() {
    this.ctx.score(this.total);
    recordRun(this.ctx, { score: this.total, sites: this.cleared, fuel: Math.round(this.bestFuel * 100), milestone: this.cleared });
  }

  // ---- simulation ----
  update(dt) {
    const step = dt > 0 && dt < 0.1 ? dt : STEP;
    this.guard.tick(step);
    this.voice.tick(step);
    this.t += step;
    this.pt += step;
    if (this.phase === "play") this.play(step * PACE, step);
    else if (this.phase === "landed" || this.phase === "crashed") this.after(step);
    else this.idleLamps();
    if (this.phase === "brief" && this.pt >= BRIEF_S && !this.waitBrief) this.startPlay();
    // Keep the survey moving: the next site, or another try, comes by itself.
    else if (this.phase === "landed" && this.pt >= NEXT_AUTO_S) { this.siteNo++; this.startBrief(true); }
    else if (this.phase === "crashed" && this.lives > 0 && this.pt >= RETRY_AUTO_S) this.startBrief(false);
  }

  // dt is simulated time, real is the wall-clock step (for warnings, which are about the player).
  play(dt, real = dt) {
    const s = this.site, w = this.w;
    stepWorld(s, w, dt);
    // The button burns flat out; otherwise the voice throttle sets the burn. Fuel goes with output.
    const pushed = this.btn && !this.latched;
    const power = this.fuel > 0 ? (pushed ? 1 : this.voice.throttle) : 0;
    const thrust = power > 0.02;
    this.power = thrust ? power : 0;
    if (thrust) {
      this.fuel = Math.max(0, this.fuel - dt * this.power);
      this.burnedOnce = true;
    }
    w.vy += (s.g - s.a * this.power) * dt;
    w.alt -= w.vy * dt;
    const ceil = s.H * 1.06;
    if (w.alt > ceil) {
      w.alt = ceil;
      if (w.vy < 0) w.vy = 0;
    }
    this.burning = thrust;
    // The rumble is the button's; a voice burn is heard already (and the rumble must not feed the microphone).
    const rumble = thrust && pushed;
    if (rumble !== this.engineTone) {
      this.engineTone = rumble;
      if (rumble) this.ctx.synth.startTone(88);
      else this.ctx.synth.stopTone();
    }
    this.out = outlook(w.alt, w.vy, this.fuel, s.g, s.a, s.safe);
    this.coach();
    this.warn(real);
    const ground = groundAt(s, w.x);
    if (!Number.isFinite(w.alt) || !Number.isFinite(w.vy)) {
      w.alt = s.H; w.vy = 0;
    } else if (w.alt <= ground) {
      w.alt = ground;
      this.touch(ground);
      return;
    }
    this.ctx.leds(this.playLamps());
  }

  // Short instructions that matter in the first two sites, then silence.
  coach() {
    const s = this.site, w = this.w;
    if (s.n > 2) {
      this.setHint("PLAY", "SAFE TOUCHDOWN UNDER " + s.safe.toFixed(1) + " M/S. LAMPS: COLOUR = SPEED, POSITION = PAD.");
      return;
    }
    if (!this.burnedOnce && w.alt > s.H * 0.5) this.setHint(this.voice.on ? "AV" : "A", this.voice.on ? "HUM TO BURN, LOUDER FOR MORE. THE BUTTON IS A FULL BURN." : "HOLD THE BUTTON TO BURN. RELEASE TO FALL.");
    else if (this.out.crash) this.setHint("B", "TOO FAST. HOLD TO BURN NOW!");
    else if (w.vy > s.safe && this.out.urgency > 0.4) this.setHint("C", "BRAKE: HOLD THE BUTTON TO SLOW DOWN.");
    else if (w.vy > s.safe) this.setHint("D", "AMBER: FASTER THAN SAFE. BRAKE BEFORE THE GROUND.");
    else this.setHint("E", s.n === 2 ? "GREEN: SAFE. THE LIT LAMP IS WHERE THE PAD IS." : "GREEN: SAFE SPEED. COAST DOWN GENTLY.");
  }

  warn(dt) {
    const w = this.w, s = this.site;
    this.warnClock -= dt;
    if (w.vy > s.safe && this.out.urgency > 0.45 && w.alt < 120 && this.warnClock <= 0) {
      this.warnClock = lerp(0.5, 0.13, this.out.urgency);
      this.ctx.tone(420 + 620 * this.out.urgency, 0.05, this.out.urgency > 0.8 ? "square" : "triangle");
    }
  }

  touch(ground) {
    const s = this.site, w = this.w;
    const dx = wrapD(w.padx - w.x);
    const onPad = ground < 0.01 && Math.abs(dx) <= s.padHalf;
    this.stopEngine();
    this.pt = 0;
    if (onPad && w.vy <= s.safe) {
      const f = clamp(this.fuel / s.fuel, 0, 1);
      const soft = clamp(1 - Math.max(0, w.vy) / s.safe, 0, 1);
      const centre = clamp(1 - Math.abs(dx) / s.padHalf, 0, 1);
      const pts = Math.round((200 + 250 * f + 150 * soft + 100 * centre) * (1 + 0.1 * (s.n - 1)));
      this.total += pts;
      this.cleared = Math.max(this.cleared, s.n);
      this.bestFuel = Math.max(this.bestFuel, f);
      if (s.n % 4 === 0 && this.lives < 3) this.lives++;
      this.outcome = { ok: true, pts, speed: Math.max(0, w.vy), fuel: f, off: Math.abs(dx), soft, centre };
      this.phase = "landed";
      this.ctx.score(this.total);
      this.setHint("LANDED", "CLEAN TOUCHDOWN. PRESS FOR THE NEXT SITE.");
      this.ctx.tone(523, 0.12, "triangle");
    } else {
      let why = "TOO FAST: " + Math.max(0, w.vy).toFixed(1) + " M/S";
      if (!onPad) why = ground > 10 && s.canyon ? "HIT THE CANYON WALL" : ground > 0.01 ? "HIT THE TERRAIN" : "MISSED THE PAD";
      this.lives--;
      this.outcome = { ok: false, why };
      this.phase = "crashed";
      this.ctx.tone(90, 0.5, "sawtooth");
      this.ctx.tone(52, 0.8, "square");
      this.setHint("CRASH", this.lives > 0 ? "LANDER LOST. PRESS TO TRY THIS SITE AGAIN." : "ALL LANDERS LOST.");
      if (this.lives <= 0) this.finishRun();
    }
    this.hudNow();
    this.seq = 0;
  }

  after(dt) {
    const o = this.outcome;
    if (o.ok) {
      // touchdown sparkle: three green sweeps, then settle
      if (this.pt < 1.8) {
        const lit = chase(this.pt, 6, true);
        this.ctx.leds(lamps(...[0, 1, 2].map((i) => dim(LAMP.green, i === lit ? 0.6 : 0.12))));
      } else this.ctx.leds(fill(LAMP.green, 0.12 + 0.1 * pulse(this.t, 0.4)));
      const n = Math.floor(this.pt * 6);
      if (this.pt < 1.8 && n !== this.seq) {
        this.seq = n;
        if (n === 3) this.ctx.tone(659, 0.12, "triangle");
        if (n === 6) this.ctx.tone(784, 0.25, "triangle");
      }
    } else {
      if (this.pt < 0.7) this.ctx.leds(blink(this.pt, 9) ? fill(LAMP.red, 0.8) : lightsOff());
      else if (this.pt < 2.2) {
        const flick = 0.5 + 0.5 * Math.sin(this.t * 41) * Math.sin(this.t * 23);
        this.ctx.leds(fill(LAMP.amber, (0.04 + 0.12 * flick) * (1 - (this.pt - 0.7) / 1.5)));
      } else this.ctx.leds(fill(LAMP.red, 0.03));
    }
    // after the last lander, move on to the result screen
    if (this.phase === "crashed" && this.lives <= 0 && this.pt > 2.6) {
      this.phase = "over";
      this.pt = 0;
      this.setHint("OVER", "SURVEY ENDED. TAP TO FLY AGAIN. HOLD ONE SECOND FOR THE VOICE THROTTLE.");
    }
  }

  idleLamps() {
    const held = this.armed ? this.t - this.downAt : 0;
    if (held > 0.2) {
      this.ctx.leds(meter(clamp((held - 0.2) / (VOICE.holdS - 0.2), 0, 1), dim(LAMP.cyan, 0.5)));
      return;
    }
    this.ctx.leds(fill(this.phase === "over" ? LAMP.amber : LAMP.green, 0.02 + 0.06 * pulse(this.t, 0.25)));
  }

  // Colour is the descent-rate verdict; which lamp is lit says where the pad is.
  playLamps() {
    const w = this.w, s = this.site, o = this.out;
    let colour, level = 0.34;
    if (w.vy <= s.safe) colour = LAMP.green;
    else if (o.crash) {
      colour = LAMP.red;
      level = 0.14 + 0.36 * pulse(this.t, 3.5);
    } else colour = blend(LAMP.amber, LAMP.red, o.urgency * 0.55);
    if (this.burning) {
      const flick = 0.5 + 0.5 * Math.sin(this.t * 47) * Math.sin(this.t * 29.3);
      colour = blend(colour, [255, 90, 0], 0.2 * flick);
      level *= 0.86 + 0.28 * Math.sin(this.t * 61) * Math.sin(this.t * 17);
    }
    const dx = wrapD(w.padx - w.x), a = Math.abs(dx) / s.padHalf;
    let weights = [1, 1, 1];
    if (a > 0.8) {
      const near = a < 2.5 ? [1, 0.45, 0.1] : [1, 0.12, 0];
      weights = dx < 0 ? near : [near[2], near[1], near[0]];
    }
    return lamps(...weights.map((k) => dim(colour, clamp(level * k, 0, 0.55))));
  }

  // ---- drawing ----
  draw(g) {
    space(g, 0, 0.35);
    const s = this.site;
    if (s && this.w) {
      this.drawTerrain(g, s);
      this.drawPad(g, s);
      this.drawLander(g, s);
      this.drawInstruments(g, s);
    }
    if (this.phase === "title") banner(g, "DESCENT", "HOLD TO BURN THE ENGINE / RELEASE TO FALL / LAND SLOWLY ON THE PAD");
    else if (this.phase === "brief") this.drawBrief(g);
    else if (this.phase === "landed" || this.phase === "crashed") this.drawAfter(g);
    else if (this.phase === "over") this.drawOver(g);
    if (this.phase === "title" || this.phase === "over") this.drawVoiceOption(g);
  }

  // The title and result screens: the voice throttle's state, and the hold that switches it.
  drawVoiceOption(g) {
    const v = this.voice, y = 420;
    g.fillStyle = "#0c1511e8";
    g.fillRect(200, y - 26, 560, 92);
    const state = v.pending ? "STARTING THE MICROPHONE" : !v.on ? "OFF" : v.calibrating ? "ON / LISTENING TO THE ROOM, STAY QUIET" : "ON / HUM TO BURN, LOUDER BURNS HARDER";
    text(g, "VOICE THROTTLE: " + state, 480, y, 20, v.on ? C.cyan : C.muted, "center");
    const held = this.armed ? this.t - this.downAt : 0;
    if (held > 0.2) {
      const f = clamp((held - 0.2) / (VOICE.holdS - 0.2), 0, 1);
      g.strokeStyle = C.line;
      g.lineWidth = 2;
      g.strokeRect(330, y + 20, 300, 12);
      g.fillStyle = C.cyan;
      g.fillRect(332, y + 22, 296 * f, 8);
      text(g, f >= 1 ? "RELEASE TO SWITCH" : "KEEP HOLDING", 480, y + 52, 16, C.amber, "center");
    } else {
      text(g, "HOLD ONE SECOND TO SWITCH " + (v.want ? "OFF" : "ON") + ". THE MICROPHONE IS ONLY ON WHILE YOU CHOOSE IT.", 480, y + 34, 15, C.muted, "center");
      if (v.on) this.drawVoiceMeter(g, 380, y + 46, 200);
    }
  }
  // A small level meter: the voice above the room's floor, with the gate where burning starts.
  drawVoiceMeter(g, x, y, width) {
    const v = this.voice;
    g.strokeStyle = C.line;
    g.lineWidth = 2;
    g.strokeRect(x, y, width, 10);
    const lift = v.level === null || v.floor === null ? 0 : clamp((v.level - v.floor) / (VOICE.gateDb + VOICE.spanDb), 0, 1);
    g.fillStyle = v.throttle > 0.02 ? C.amber : C.muted;
    g.fillRect(x + 1, y + 1, (width - 2) * lift, 8);
    const gx = x + width * (VOICE.gateDb / (VOICE.gateDb + VOICE.spanDb));
    line(g, gx, y - 3, gx, y + 13, C.ink, 1);
  }

  drawTerrain(g, s) {
    const n = s.terrain.length;
    g.beginPath();
    g.moveTo(0, 540);
    for (let i = 0; i <= n; i++) g.lineTo(i * 2 * PX, GY - s.terrain[i % n] * s.scale);
    g.lineTo(960, 540);
    g.closePath();
    g.fillStyle = "#101d15";
    g.fill();
    g.strokeStyle = C.muted;
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i <= n; i++) {
      const y = GY - s.terrain[i % n] * s.scale;
      if (i) g.lineTo(i * 2 * PX, y);
      else g.moveTo(0, y);
    }
    g.stroke();
  }

  drawPad(g, s) {
    const w = this.w, x = w.padx * PX, h = s.padHalf * PX;
    line(g, x - h, GY, x + h, GY, C.amber, 5);
    const on = blink(this.t, 1.5) ? C.amber : C.muted;
    diamond(g, x - h, GY - 8, 4, on, true);
    diamond(g, x + h, GY - 8, 4, on, true);
    // where the lander will be when it reaches the ground at its present descent rate
    if (this.phase === "play") {
      const tt = Math.min(40, w.alt / Math.max(3, w.vy));
      const px = wrapX(w.x + w.vx * tt) * PX;
      diamond(g, px, GY + 16, 6, C.cyan, false);
      line(g, px, GY + 24, px, GY + 34, C.cyan, 2);
    }
  }

  drawLander(g, s) {
    const w = this.w;
    const y = GY - w.alt * s.scale;
    const sx = w.x * PX;
    const crashed = this.phase === "crashed" || (this.phase === "over" && this.outcome && !this.outcome.ok);
    const draws = sx < 30 ? [sx, sx + 960] : sx > 930 ? [sx, sx - 960] : [sx];
    for (const x of draws) {
      g.save();
      g.translate(x, y);
      if (crashed) {
        g.strokeStyle = C.red;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(-14, 0); g.lineTo(-4, -9); g.lineTo(6, -3); g.lineTo(14, -12);
        g.moveTo(-8, -2); g.lineTo(0, 0); g.lineTo(10, -2);
        g.stroke();
        if (this.pt < 0.9) circle(g, 0, -6, 10 + this.pt * 70, C.amber, false, 2);
      } else {
        const body = this.out.crash && this.phase === "play" ? C.red : C.ink;
        g.strokeStyle = body;
        g.lineWidth = 2.5;
        g.beginPath();
        g.moveTo(-9, -9); g.lineTo(-6, -24); g.lineTo(6, -24); g.lineTo(9, -9); g.closePath();
        g.moveTo(-9, -9); g.lineTo(-15, 0); g.moveTo(9, -9); g.lineTo(15, 0);
        g.moveTo(-18, 0); g.lineTo(-11, 0); g.moveTo(11, 0); g.lineTo(18, 0);
        g.moveTo(-4, -9); g.lineTo(4, -9);
        g.stroke();
        if (this.burning) {
          const f = (12 + 9 * (0.5 + 0.5 * Math.sin(this.t * 55)) + 4 * Math.sin(this.t * 31)) * (0.35 + 0.65 * this.power);
          g.fillStyle = C.amber;
          g.beginPath();
          g.moveTo(-5, -8); g.lineTo(0, -8 + f); g.lineTo(5, -8);
          g.closePath();
          g.fill();
        }
      }
      g.restore();
    }
  }

  drawInstruments(g, s) {
    const w = this.w, play = this.phase === "play";
    const safe = w.vy <= s.safe;
    const vc = safe ? C.ink : this.out.crash ? C.red : C.amber;
    text(g, "ALT " + Math.max(0, w.alt).toFixed(0).padStart(3, " ") + " M", 30, 34, 26, C.ink);
    text(g, "V/S " + (w.vy >= 0 ? "-" : "+") + Math.abs(w.vy).toFixed(1) + " M/S", 250, 34, 26, play ? vc : C.ink);
    text(g, "SAFE < " + s.safe.toFixed(1), 30, 68, 22, C.muted);
    // fuel bar
    const fr = clamp(this.fuel / s.fuel, 0, 1);
    text(g, "FUEL", 540, 34, 22, C.ink);
    g.strokeStyle = C.line;
    g.lineWidth = 2;
    g.strokeRect(605, 24, 190, 20);
    g.fillStyle = fr < 0.2 ? C.red : C.cyan;
    g.fillRect(607, 26, 186 * fr, 16);
    text(g, (this.fuel / PACE).toFixed(1) + " S", 812, 34, 22, fr < 0.2 ? C.red : C.muted);
    if (this.voice.on) {
      // The engine output gauge: the voice's share, or the button's full burn.
      text(g, this.voice.calibrating ? "VOICE: QUIET" : this.voice.heard ? "VOICE" : "VOICE: NO SIGNAL", 540, 100, 18, this.voice.heard ? C.cyan : C.muted);
      g.strokeStyle = C.line;
      g.lineWidth = 2;
      g.strokeRect(700, 91, 95, 14);
      g.fillStyle = this.engineTone ? C.amber : C.cyan;
      g.fillRect(702, 93, 91 * clamp(play ? this.power : this.voice.throttle, 0, 1), 10);
    }
    const lateral = s.drift || s.gusts.length || s.padSpeed;
    if (lateral) text(g, "DRIFT " + (w.vx >= 0 ? "+" : "-") + Math.abs(w.vx).toFixed(1), 250, 68, 22, C.muted);
    if (s.gusts.length) text(g, "WIND " + (w.vx > s.drift + 1 ? ">>" : w.vx < s.drift - 1 ? "<<" : "--"), 540, 68, 22, C.amber);
    // vertical speed tape: downward speed 0..40 m/s, with the safe band shaded
    const top = 100, bottom = 440, k = (bottom - top) / 40;
    g.strokeStyle = C.line;
    g.lineWidth = 2;
    g.strokeRect(926, top, 14, bottom - top);
    g.fillStyle = "#2f7a44";
    g.fillRect(927, top + 1, 12, Math.min(s.safe, 40) * k);
    for (let v = 10; v < 40; v += 10) line(g, 922, top + v * k, 944, top + v * k, C.line, 1);
    text(g, "0", 912, top, 16, C.muted, "right");
    text(g, "40", 912, bottom, 16, C.muted, "right");
    const my = top + clamp(w.vy, 0, 40) * k;
    g.fillStyle = vc;
    g.beginPath();
    g.moveTo(924, my); g.lineTo(906, my - 8); g.lineTo(906, my + 8);
    g.closePath();
    g.fill();
  }

  panel(g, y, h) {
    g.fillStyle = "#0c1511ee";
    g.fillRect(170, y, 620, h);
    line(g, 215, y + 8, 745, y + 8, C.line);
  }

  drawBrief(g) {
    const s = this.site;
    this.panel(g, 150, 150);
    text(g, "SITE " + String(s.n).padStart(2, "0") + " / " + s.name, 480, 190, 30, C.ink, "center");
    text(g, s.note, 480, 240, 20, C.amber, "center");
    text(g, "FUEL " + (s.fuel / PACE).toFixed(1) + " S   SAFE UNDER " + s.safe.toFixed(1) + " M/S", 480, 272, 18, C.muted, "center");
    if (this.waitBrief) text(g, "PRESS TO START THE DESCENT", 480, 304, 20, C.amber, "center");
    else text(g, "DESCENT BEGINS", 480, 304, 18, C.muted, "center");
  }

  drawAfter(g) {
    const o = this.outcome;
    this.panel(g, 150, 170);
    if (o.ok) {
      text(g, "CLEAN TOUCHDOWN", 480, 192, 32, C.ink, "center");
      text(g, "SPEED " + o.speed.toFixed(1) + " M/S   FUEL " + Math.round(o.fuel * 100) + "%   OFF CENTRE " + o.off.toFixed(0) + " M", 480, 238, 19, C.muted, "center");
      text(g, "+" + o.pts, 480, 276, 28, C.amber, "center");
      if (this.pt > NEXT_PRESS_S) text(g, "PRESS FOR SITE " + (this.siteNo + 1), 480, 318, 20, C.amber, "center");
    } else {
      text(g, "LANDER LOST", 480, 192, 32, C.red, "center");
      text(g, o.why, 480, 246, 22, C.muted, "center");
      if (this.pt > RETRY_PRESS_S && this.lives > 0) text(g, "PRESS TO TRY THE SITE AGAIN", 480, 300, 20, C.amber, "center");
    }
  }

  drawOver(g) {
    this.panel(g, 140, 210);
    text(g, "SURVEY ENDED", 480, 184, 32, C.red, "center");
    text(g, "SCORE " + this.total, 480, 234, 30, C.ink, "center");
    text(g, "SITES CLEARED " + this.cleared + "   BEST " + Math.max(this.total, this.ctx.best?.() || 0), 480, 276, 19, C.muted, "center");
    if (this.pt > 1) text(g, "TAP TO FLY AGAIN", 480, 322, 18, C.amber, "center");
  }
}
