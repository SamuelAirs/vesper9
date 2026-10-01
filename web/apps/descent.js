// DESCENT — a one-button lunar hopper. The lander flies on across the moon; hold to burn the
// engine (up), release to fall. Fuel is short, and the only fuel is on the pads: settle on one
// slower than the safe speed and you skim it, refuelling, until you lift off again before its end.
// Every first touchdown on a pad scores, more for a soft one, three times for a narrow gold pad,
// and clean landings in a row build a combo that a crash resets. Ridges have to be cleared on
// the way. The pace, the ridges and the pads get harder with distance. The three lamps are the
// descent instrument: colour is the vertical-speed verdict, and the lit lamp walks from right to
// left as the next pad comes in (all three while you are over it).
//
// Voice throttle (optional). Holding the button on the title screen for a second switches the
// microphone to `analyze` and lets your voice burn the engine too: the louder you hum, the
// harder it burns, so you can hover and feather a landing in a way an on/off button cannot.
// The button still burns flat out and always wins. The microphone is only on while the
// player has chosen it; leaving the game switches it off (if this game switched it on), and a
// mute from the system menu, an error or a lost link turns the voice throttle off. With no
// signal the throttle is zero, so the game plays exactly as with the button alone.
import { C, space, text, line, circle, diamond, banner } from "../engine/draw.js";
import { clamp, lerp } from "../engine/math.js";
import { LAMP, lamps, fill, dim, blend, pulse, blink, meter, lightsOff } from "../engine/lightshow.js";
import { recordRun } from "../engine/kit.js";
import { AppGuard } from "../engine/input.js";

const STEP = 1 / 60;
// Screen: metres to logical pixels, the ground datum, and where the lander sits across.
const PX = 3.6, VS = 6, GY = 505, LX = 250;
const TOP = 75;                  // ceiling, metres above the datum
const HALF = 4;                  // lander half-width, metres
// Flight. Burn and gravity are strong so a decision shows within a second.
export const FLIGHT = { g: 5.5, a: 13, safe: 4.5, up: 14, down: 32, fuelMax: 8, refuel: 3, bonusFuel: 1.5 };
const COMBO_MAX = 8;
const RISE = 0.45;               // steepest climb of the ground, metres up per metre across
const WRECK_S = 1.4;             // a crash, before the next lander
export const speedAt = (x) => 11 + Math.min(7, x / 450);
const difficulty = (x) => clamp(x / 3000, 0, 1);

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


// ---- the moonscape ----
// Ground is a polyline of points {x, h} (metres); pads are flat stretches of it. Generated ahead
// of the lander from the game's random source and dropped behind it, so the arrays stay small.
export function newWorld(rng) {
  const w = { points: [{ x: -200, h: 10 }, { x: 0, h: 10 }, { x: 95, h: 10 }], pads: [], cx: 95, ch: 10, n: 0 };
  w.pads.push({ x0: 0, x1: 95, h: 10, mult: 1, landed: true, start: true });
  extend(w, rng, 600);
  return w;
}
export function extend(w, rng, untilX) {
  while (w.cx < untilX) {
    const d = difficulty(w.cx);
    // Hills, sometimes a ridge to climb over.
    const hills = w.n < 3 ? 2 : rng.int(2, 4 + Math.round(2 * d));
    for (let i = 0; i < hills; i++) {
      const dx = rng.range(14, 26);
      let h = rng.range(0, 11 + 11 * d);
      if (rng.next() < 0.22 + 0.2 * d) h = rng.range(24, 36 + 16 * d);
      // Ground may fall away steeply but rises no faster than a lander can climb at speed,
      // and straight after a pad more gently still, so a late lift-off can clear it.
      h = clamp(h, w.ch - 2.2 * dx, w.ch + (i === 0 && w.n ? 0.4 : RISE) * dx);
      w.cx += dx; w.ch = clamp(h, 0, 55);
      w.points.push({ x: w.cx, h: w.ch });
    }
    // A pad: wide and plain, or (now and then) narrow and gold.
    w.n++;
    const gold = w.n > 2 && rng.next() < 0.22 + 0.1 * d;
    let width = clamp(36 - 14 * d + rng.range(-6, 6), 18, 42);
    if (gold) width = Math.max(11, width * 0.55);
    // A pad in a hollow can be no deeper than a lander can drop into and still brake.
    const h = clamp(rng.range(0, 18 + 14 * d), w.ch - 0.25 * (width + 14), w.ch + RISE * 14);
    const x0 = w.cx + 14;
    w.points.push({ x: x0, h }, { x: x0 + width, h });
    w.pads.push({ x0, x1: x0 + width, h, mult: gold ? 3 : 1, landed: false });
    w.cx = x0 + width; w.ch = h;
  }
}
export function prune(w, behindX) {
  while (w.points.length > 3 && w.points[1].x < behindX) w.points.shift();
  while (w.pads.length && w.pads[0].x1 < behindX) w.pads.shift();
}
export function heightAt(w, x) {
  const p = w.points;
  let lo = 0, hi = p.length - 1;
  if (x <= p[0].x) return p[0].h;
  if (x >= p[hi].x) return p[hi].h;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (p[m].x <= x) lo = m; else hi = m; }
  const a = p[lo], b = p[hi];
  return lerp(a.h, b.h, (x - a.x) / Math.max(1e-6, b.x - a.x));
}
// The highest ground under the lander's footprint.
export const groundUnder = (w, x) => Math.max(heightAt(w, x - HALF), heightAt(w, x), heightAt(w, x + HALF));
// The pad the lander's centre is over (feet within the pad's ends, with a little give).
export const padUnder = (w, x) => w.pads.find((p) => x - HALF * 0.5 >= p.x0 && x + HALF * 0.5 <= p.x1) || null;
// The next pad ahead that has not been landed on.
export const nextPad = (w, x) => w.pads.find((p) => !p.landed && p.x1 > x) || null;
export function maxGround(w, x0, x1) {
  let h = Math.max(heightAt(w, x0), heightAt(w, x1));
  for (const p of w.points) if (p.x > x0 && p.x < x1) h = Math.max(h, p.h);
  return h;
}

// What the lander would do if it burned flat out from now: whether touchdown is a crash, and how
// urgent braking is (0 plenty of room .. 1 none). alt is the height above the ground below.
function outlook(alt, vy, fuel, g, a, safe) {
  const net = a - g;
  if (vy <= safe) return { crash: false, urgency: 0 };
  const tStop = vy / net;
  let vtd2;
  if (fuel >= tStop) vtd2 = (vy * vy) / (2 * net) >= alt ? vy * vy - 2 * net * alt : 0;
  else {
    const d1 = vy * fuel - 0.5 * net * fuel * fuel;
    vtd2 = d1 >= alt ? vy * vy - 2 * net * alt : (vy - net * fuel) ** 2 + 2 * g * (alt - d1);
  }
  const spare = alt - (vy * vy - safe * safe) / (2 * net);
  return { crash: Math.sqrt(Math.max(0, vtd2)) > safe, urgency: 1 - clamp(spare / 25, 0, 1) };
}

const TITLE_HINT = "TAP TO BEGIN. HOLD ONE SECOND TO SWITCH THE VOICE THROTTLE ON OR OFF.";

export class Descent {
  constructor(ctx) {
    this.ctx = ctx;
    this.guard = new AppGuard(this, ctx); // takes back a menu gesture that reached the game (docs/ENGINE.md)
    this.voice = new VoiceThrottle(ctx);
    this.t = 0;
    this.pt = 0;
    this.phase = "title";
    this.btn = false;
    this.latched = false;
    this.armed = false;   // a title/result press waiting for its release: a tap starts, a hold toggles the voice
    this.downAt = 0;
    this.burning = false;
    this.power = 0;       // engine output this step, 0..1
    this.engineTone = false;
    this.warnClock = 0;
    this.hudKey = "";
    this.hintKey = "";
    this.best0 = this.ctx.best?.() || 0;
    this.newRun(false);
    this.phase = "title";
    this.setHint("TITLE", TITLE_HINT);
  }

  setHint(key, message) {
    if (key === this.hintKey) return;
    this.hintKey = key;
    this.ctx.hint(message);
  }
  hudNow() {
    const key = this.lives + "/" + Math.floor(this.score) + "/" + this.combo;
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.ctx.hud([["SCORE", Math.floor(this.score)], ["LANDERS", this.lives], ["COMBO", "×" + this.combo]]);
  }

  // ---- input ----
  down() {
    this.guard.mark();
    this.btn = true;
    if (this.phase === "title" || (this.phase === "over" && this.pt > 1)) {
      // Decided on release: a tap starts a run, a hold switches the voice throttle.
      this.armed = true;
      this.downAt = this.t;
    }
  }
  up() {
    this.guard.release();
    this.btn = false;
    this.latched = false;
    if (this.armed) {
      this.armed = false;
      if (this.t - this.downAt >= VOICE.holdS) this.toggleVoice();
      else this.newRun(true);
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
  newRun(play) {
    this.world = newWorld(this.ctx.rng);
    this.x = 20;
    this.alt = 10;
    this.vy = 0;
    this.pad = this.world.pads[0]; // resting on the launch pad
    this.fuel = FLIGHT.fuelMax;
    this.lives = 3;
    this.score = 0;
    this.combo = 1;
    this.bestCombo = 1;
    this.landings = 0;
    this.wreck = 0;
    this.wreckWhy = "";
    this.lastLanding = null; // { pts, soft, mult, at } for the on-screen tally
    this.out = { crash: false, urgency: 0 };
    this.burnedOnce = false;
    this.stopEngine();
    if (play) {
      this.phase = "play";
      this.pt = 0;
      this.latched = this.btn;
      this.hintKey = "";
      this.hudNow();
    }
  }
  finishRun() {
    this.ctx.score(Math.floor(this.score));
    recordRun(this.ctx, { score: Math.floor(this.score), pads: this.landings, combo: this.bestCombo, metres: Math.round(this.x), milestone: this.landings });
  }

  // ---- simulation ----
  update(dt) {
    const step = dt > 0 && dt < 0.1 ? dt : STEP;
    this.guard.tick(step);
    this.voice.tick(step);
    this.t += step;
    this.pt += step;
    if (this.phase === "play") this.play(step);
    else this.idleLamps();
  }

  play(dt) {
    const w = this.world;
    if (this.wreck > 0) {
      this.wreck -= dt;
      this.wreckLamps();
      if (this.wreck <= 0) {
        this.respawn();
        if (this.phase === "play") this.ctx.leds(this.playLamps());
      }
      return;
    }
    const vx = speedAt(this.x);
    // The button burns flat out; otherwise the voice throttle sets the burn. Fuel goes with output.
    const pushed = this.btn && !this.latched;
    const power = this.fuel > 0 ? (pushed ? 1 : this.voice.throttle) : 0;
    this.power = power > 0.02 ? power : 0;
    if (this.power) { this.fuel = Math.max(0, this.fuel - dt * this.power); this.burnedOnce = true; }
    this.x += vx * dt;
    this.score += vx * dt * 0.2;
    if (this.pad) {
      // Skimming a pad: refuel; a burn stronger than gravity lifts off; past its end, fall.
      this.fuel = Math.min(FLIGHT.fuelMax, this.fuel + FLIGHT.refuel * dt);
      if (this.power * FLIGHT.a > FLIGHT.g) { this.pad = null; this.vy = -1; }
      else if (this.x - HALF * 0.5 > this.pad.x1) { this.pad = null; this.vy = 0; }
      else { this.alt = this.pad.h; this.vy = 0; }
    }
    if (!this.pad) {
      this.vy = clamp(this.vy + (FLIGHT.g - FLIGHT.a * this.power) * dt, -FLIGHT.up, FLIGHT.down);
      this.alt -= this.vy * dt;
      if (this.alt > TOP) { this.alt = TOP; if (this.vy < 0) this.vy = 0; }
    }
    this.sound(pushed);
    const ground = groundUnder(w, this.x);
    this.out = outlook(this.alt - ground, this.vy, this.fuel, FLIGHT.g, FLIGHT.a, FLIGHT.safe);
    this.coach();
    this.warn(dt);
    if (!Number.isFinite(this.alt) || !Number.isFinite(this.vy)) { this.alt = TOP * 0.7; this.vy = 0; }
    else if (!this.pad && this.alt <= ground) this.touch(ground);
    extend(w, this.ctx.rng, this.x + 520);
    prune(w, this.x - 150);
    this.hudNow();
    if (this.wreck > 0) this.wreckLamps();
    else this.ctx.leds(this.playLamps());
  }

  sound(pushed) {
    this.burning = this.power > 0;
    // The rumble is the button's; a voice burn is heard already (and the rumble must not feed the microphone).
    const rumble = this.burning && pushed;
    if (rumble !== this.engineTone) {
      this.engineTone = rumble;
      if (rumble) this.ctx.synth.startTone(88);
      else this.ctx.synth.stopTone();
    }
  }

  touch(ground) {
    const pad = padUnder(this.world, this.x);
    const onPad = pad && Math.abs(ground - pad.h) < 0.6;
    if (onPad && this.vy <= FLIGHT.safe) {
      this.alt = pad.h;
      const speed = Math.max(0, this.vy);
      this.vy = 0;
      this.pad = pad;
      if (!pad.landed) {
        pad.landed = true;
        const soft = clamp(1 - speed / FLIGHT.safe, 0, 1);
        const pts = Math.round((60 + 90 * soft) * pad.mult * this.combo);
        this.score += pts;
        this.landings++;
        this.lastLanding = { pts, soft, mult: pad.mult, combo: this.combo, at: this.t };
        this.combo = Math.min(COMBO_MAX, this.combo + 1);
        this.bestCombo = Math.max(this.bestCombo, this.combo);
        this.fuel = Math.min(FLIGHT.fuelMax, this.fuel + FLIGHT.bonusFuel);
        this.ctx.tone(pad.mult > 1 ? 784 : 523 + 40 * Math.min(6, this.combo), 0.12, "triangle");
      }
      return;
    }
    this.crash(onPad ? "TOO FAST: " + this.vy.toFixed(1) + " M/S" : pad ? "MISSED THE PAD" : ground > 30 ? "HIT A RIDGE" : "HIT THE GROUND");
  }

  crash(why) {
    this.stopEngine();
    this.lives--;
    this.combo = 1;
    this.wreck = WRECK_S;
    this.wreckWhy = why;
    this.wreckAt = this.t;
    this.ctx.tone(90, 0.5, "sawtooth");
    this.ctx.tone(52, 0.8, "square");
    this.setHint("CRASH" + this.lives, this.lives > 0 ? "LANDER LOST: " + why + ". THE NEXT ONE IS ON ITS WAY." : "ALL LANDERS LOST.");
    this.hudNow();
  }

  respawn() {
    if (this.lives <= 0) {
      this.finishRun();
      this.phase = "over";
      this.pt = 0;
      this.ctx.leds(lightsOff());
      this.setHint("OVER", "SURVEY ENDED. TAP TO FLY AGAIN. HOLD ONE SECOND FOR THE VOICE THROTTLE.");
      return;
    }
    const w = this.world;
    this.alt = Math.min(TOP - 4, maxGround(w, this.x - HALF, this.x + 60) + 28);
    this.vy = 0;
    this.pad = null;
    this.fuel = Math.max(this.fuel, FLIGHT.fuelMax * 0.6);
    this.latched = this.btn;
    this.hintKey = "";
  }

  // Short instructions while the player is new, then quiet.
  coach() {
    if (this.landings >= 3) {
      this.setHint("PLAY", this.fuel < 1.5 ? "LOW FUEL. LAND ON A PAD TO REFUEL." : "SAFE TOUCHDOWN UNDER " + FLIGHT.safe.toFixed(1) + " M/S. GOLD PADS SCORE THREE TIMES.");
      return;
    }
    const v = this.voice.on;
    if (this.pad && this.pad.start) this.setHint("A", v ? "HUM OR HOLD TO LIFT OFF BEFORE THE END OF THE PAD." : "HOLD TO LIFT OFF BEFORE THE END OF THE PAD.");
    else if (this.pad) this.setHint("R", "REFUELLING. LIFT OFF BEFORE THE PAD ENDS.");
    else if (this.out.crash) this.setHint("B", "TOO FAST. BURN NOW!");
    else if (this.vy > FLIGHT.safe) this.setHint("C", "AMBER: FASTER THAN SAFE. BURN BEFORE YOU TOUCH DOWN.");
    else this.setHint("D", "GREEN: SAFE SPEED. SETTLE ON THE NEXT PAD TO SCORE AND REFUEL.");
  }

  warn(dt) {
    this.warnClock -= dt;
    const above = this.alt - groundUnder(this.world, this.x);
    if (!this.pad && this.vy > FLIGHT.safe && this.out.urgency > 0.45 && above < 40 && this.warnClock <= 0) {
      this.warnClock = lerp(0.5, 0.13, this.out.urgency);
      this.ctx.tone(420 + 620 * this.out.urgency, 0.05, this.out.urgency > 0.8 ? "square" : "triangle");
    }
  }

  // ---- lamps ----
  idleLamps() {
    const held = this.armed ? this.t - this.downAt : 0;
    if (held > 0.2) {
      this.ctx.leds(meter(clamp((held - 0.2) / (VOICE.holdS - 0.2), 0, 1), dim(LAMP.cyan, 0.5)));
      return;
    }
    this.ctx.leds(fill(this.phase === "over" ? LAMP.amber : LAMP.green, 0.02 + 0.06 * pulse(this.t, 0.25)));
  }
  wreckLamps() {
    const e = WRECK_S - this.wreck;
    if (e < 0.6) this.ctx.leds(blink(e, 9) ? fill(LAMP.red, 0.8) : lightsOff());
    else this.ctx.leds(fill(LAMP.amber, 0.12 * (1 - (e - 0.6) / (WRECK_S - 0.6))));
  }
  // Colour is the vertical-speed verdict; the lit lamp walks right to left as the next pad comes in.
  playLamps() {
    const o = this.out;
    let colour, level = 0.34;
    if (this.pad) { colour = LAMP.green; level = 0.2 + 0.14 * pulse(this.t, 1.5); }
    else if (this.vy <= FLIGHT.safe) colour = LAMP.green;
    else if (o.crash) { colour = LAMP.red; level = 0.14 + 0.36 * pulse(this.t, 3.5); }
    else colour = blend(LAMP.amber, LAMP.red, o.urgency * 0.55);
    if (this.burning) {
      const flick = 0.5 + 0.5 * Math.sin(this.t * 47) * Math.sin(this.t * 29.3);
      colour = blend(colour, [255, 90, 0], 0.2 * flick);
    }
    let weights = [1, 1, 1];
    const p = nextPad(this.world, this.x);
    if (!this.pad && p && this.x < p.x0) {
      // 0 arriving .. 1 far away (about four seconds out)
      const far = clamp((p.x0 - this.x) / (speedAt(this.x) * 4), 0, 1);
      weights = [0, 1, 2].map((i) => clamp(1 - Math.abs(far * 2 - i), 0.08, 1));
    }
    if (p && p.mult > 1 && !this.pad) colour = blend(colour, LAMP.amber, 0.25);
    return lamps(...weights.map((k) => dim(colour, clamp(level * k, 0, 0.55))));
  }

  // ---- drawing ----
  sx(x) { return LX + (x - this.x) * PX; }
  sy(h) { return GY - h * VS; }
  draw(g) {
    space(g, this.x * 0.02, 0.35);
    this.drawFarHills(g);
    this.drawTerrain(g);
    this.drawLander(g);
    if (this.phase !== "title") this.drawInstruments(g);
    if (this.phase === "title") banner(g, "DESCENT", "HOLD TO BURN, RELEASE TO FALL / SETTLE SOFTLY ON THE PADS TO SCORE AND REFUEL");
    else if (this.phase === "over") this.drawOver(g);
    if (this.phase === "title" || this.phase === "over") this.drawVoiceOption(g);
  }

  // Distant hills sliding by at a third of the speed: a sense of pace.
  drawFarHills(g) {
    const shift = this.x * PX * 0.3;
    g.beginPath();
    g.moveTo(0, 540);
    for (let sx = 0; sx <= 960; sx += 16) {
      const u = (sx + shift) / 140;
      g.lineTo(sx, 330 - 40 * (0.5 + 0.5 * Math.sin(u)) * (0.6 + 0.4 * Math.sin(u * 0.37 + 1.3)));
    }
    g.lineTo(960, 540);
    g.closePath();
    g.fillStyle = "#0e1913";
    g.fill();
  }

  drawTerrain(g) {
    const w = this.world, x0 = this.x - LX / PX - 10, x1 = this.x + (960 - LX) / PX + 10;
    g.beginPath();
    g.moveTo(0, 540);
    g.lineTo(0, this.sy(heightAt(w, x0)));
    for (const p of w.points) if (p.x > x0 && p.x < x1) g.lineTo(this.sx(p.x), this.sy(p.h));
    g.lineTo(960, this.sy(heightAt(w, x1)));
    g.lineTo(960, 540);
    g.closePath();
    g.fillStyle = "#101d15";
    g.fill();
    g.strokeStyle = C.muted;
    g.lineWidth = 2;
    g.stroke();
    for (const p of w.pads) {
      if (p.x1 < x0 || p.x0 > x1) continue;
      const a = this.sx(p.x0), b = this.sx(p.x1), y = this.sy(p.h);
      const colour = p.landed ? C.line : p.mult > 1 ? C.amber : C.cyan;
      line(g, a, y, b, y, colour, 5);
      if (!p.landed) {
        const on = blink(this.t, 1.5) ? colour : C.muted;
        diamond(g, a, y - 8, 4, on, true);
        diamond(g, b, y - 8, 4, on, true);
        if (p.mult > 1) text(g, "×" + p.mult, (a + b) / 2, y - 18, 18, C.amber, "center");
      }
    }
  }

  drawLander(g) {
    const y = this.sy(this.alt), x = LX;
    if (this.phase === "play" && this.wreck > 0) {
      const e = WRECK_S - this.wreck;
      g.strokeStyle = C.red;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x - 14, y); g.lineTo(x - 4, y - 9); g.lineTo(x + 6, y - 3); g.lineTo(x + 14, y - 12);
      g.stroke();
      if (e < 0.9) circle(g, x, y - 6, 10 + e * 70, C.amber, false, 2);
      return;
    }
    // shadow on the ground below
    if (!this.pad) {
      const gy = this.sy(groundUnder(this.world, this.x));
      line(g, x - 10, gy + 2, x + 10, gy + 2, C.line, 3);
    }
    g.save();
    g.translate(x, y);
    g.rotate(clamp(-this.vy * 0.012, -0.25, 0.25) + 0.08);
    g.strokeStyle = this.out.crash && this.phase === "play" ? C.red : C.ink;
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
    g.restore();
  }

  drawInstruments(g) {
    const above = Math.max(0, this.alt - groundUnder(this.world, this.x));
    const vc = this.vy <= FLIGHT.safe ? C.ink : this.out.crash ? C.red : C.amber;
    text(g, "ALT " + above.toFixed(0).padStart(3, " ") + " M", 30, 34, 24, C.ink);
    text(g, "V/S " + (this.vy >= 0 ? "-" : "+") + Math.abs(this.vy).toFixed(1), 230, 34, 24, vc);
    text(g, "SAFE < " + FLIGHT.safe.toFixed(1) + " M/S", 30, 66, 18, C.muted);
    const fr = clamp(this.fuel / FLIGHT.fuelMax, 0, 1);
    text(g, "FUEL", 470, 34, 22, C.ink);
    g.strokeStyle = C.line;
    g.lineWidth = 2;
    g.strokeRect(535, 24, 190, 20);
    g.fillStyle = fr < 0.25 ? C.red : this.pad ? C.ink : C.cyan;
    g.fillRect(537, 26, 186 * fr, 16);
    text(g, Math.round(this.x) + " M", 930, 34, 20, C.muted, "right");
    if (this.combo > 1) text(g, "COMBO ×" + this.combo, 930, 66, 20, C.amber, "right");
    if (this.voice.on) {
      text(g, this.voice.calibrating ? "VOICE: QUIET" : this.voice.heard ? "VOICE" : "VOICE: NO SIGNAL", 470, 66, 18, this.voice.heard ? C.cyan : C.muted);
      g.strokeStyle = C.line;
      g.strokeRect(630, 58, 95, 14);
      g.fillStyle = this.engineTone ? C.amber : C.cyan;
      g.fillRect(632, 60, 91 * clamp(this.phase === "play" ? this.power : this.voice.throttle, 0, 1), 10);
    }
    const l = this.lastLanding;
    if (l && this.t - l.at < 1.6) {
      const a = 1 - (this.t - l.at) / 1.6;
      g.globalAlpha = a;
      const label = (l.soft > 0.75 ? "FEATHER " : l.soft > 0.4 ? "SOFT " : "FIRM ") + "+" + l.pts + (l.mult > 1 ? " GOLD" : "") + (l.combo > 1 ? " ×" + l.combo : "");
      text(g, label, LX, this.sy(this.alt) - 50 - 20 * (1 - a), 22, C.amber, "center");
      g.globalAlpha = 1;
    }
    if (this.wreck > 0) text(g, "LANDER LOST / " + this.wreckWhy, 480, 150, 26, C.red, "center");
  }

  drawOver(g) {
    g.fillStyle = "#0c1511ee";
    g.fillRect(170, 140, 620, 210);
    line(g, 215, 148, 745, 148, C.line);
    text(g, "SURVEY ENDED", 480, 184, 32, C.red, "center");
    text(g, "SCORE " + Math.floor(this.score) + (Math.floor(this.score) > this.best0 ? "  NEW BEST" : ""), 480, 234, 30, C.ink, "center");
    text(g, "PADS " + this.landings + "   BEST COMBO ×" + this.bestCombo + "   " + Math.round(this.x) + " M", 480, 276, 19, C.muted, "center");
    if (this.pt > 1) text(g, "TAP TO FLY AGAIN", 480, 322, 18, C.amber, "center");
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
}
