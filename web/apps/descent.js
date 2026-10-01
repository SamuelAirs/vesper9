// DESCENT — a one-button lander. Hold to fire the engine against gravity, release to
// fall; touch the pad slower than the safe speed with fuel to spare. The world supplies
// the sideways motion (drift, gusts, a sliding pad, a canyon), so the only decision is
// when to fall and when to burn. The three lamps are the descent instrument: colour is
// the vertical-speed verdict, and which lamp is lit says where the pad is.
import { C, space, text, line, circle, diamond, banner } from "../engine/draw.js";
import { clamp, lerp } from "../engine/math.js";
import { LAMP, lamps, fill, dim, blend, pulse, blink, chase, lightsOff } from "../engine/lightshow.js";
import { recordRun } from "../engine/kit.js";

const W = 480; // world width in metres; it wraps, and one metre is two logical pixels across
const PX = 2;
const GY = 470; // screen y of the pad datum
const HALF = 5; // lander half-width in metres, used for walls and hills
const STEP = 1 / 60;
const wrapX = (x) => ((x % W) + W) % W;
const wrapD = (d) => wrapX(d + W / 2) - W / 2;
const smooth = (t) => {
  const u = clamp(t, 0, 1);
  return u * u * (3 - 2 * u);
};

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
const FIXED = [[], ["drift"], ["drift", "tight"], ["thin", "drift"], ["heavy", "drift"], ["gust"], ["moving"], ["drift", "canyon"]];
const BASIC = [
  ["TRAINING FLAT", "NO DRIFT. HOLD TO BURN, RELEASE TO FALL."],
  ["CROSSWIND", "THE LANDER DRIFTS. THE LAMPS SHOW THE PAD."],
  ["NARROW PAD", "A SMALLER PAD AND LESS FUEL."],
];

function buildSite(n, rng) {
  const level = Math.max(0, n - 8);
  const s = {
    n, name: "SITE", tag: "", note: "", g: 1.6, a: 4, H: 170, vy0: n === 1 ? 3 : 0, safe: n === 1 ? 6 : n === 2 ? 5.5 : n === 3 ? 5 : n < 10 ? 4.5 : 4,
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
    this.t = 0;
    this.phase = "title";
    this.pt = 0;
    this.btn = false;
    this.latched = false;
    this.burning = false;
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
    this.setHint("TITLE", "PRESS TO BEGIN. HOLD TO BURN, RELEASE TO FALL.");
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
    this.btn = true;
    if (this.phase === "title" || (this.phase === "over" && this.pt > 1)) {
      this.newRun();
    } else if (this.phase === "brief" && this.pt > 0.5) {
      this.startPlay();
    } else if (this.phase === "landed" && this.pt > 1.2) {
      this.siteNo++;
      this.startBrief(true);
    } else if (this.phase === "crashed" && this.lives > 0 && this.pt > 1.4) {
      this.startBrief(false);
    }
  }
  up() {
    this.btn = false;
    this.latched = false;
  }
  cancel() {
    this.btn = false;
    this.latched = false;
    this.stopEngine();
  }
  pause() { this.stopEngine(); }
  resume() { this.burning = false; }
  dispose() {
    this.stopEngine();
    this.ctx.leds(lightsOff());
  }
  stopEngine() {
    this.burning = false;
    this.ctx.synth.stopTone();
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
    this.stopEngine();
    this.hudNow();
    this.setHint("BRIEF" + this.siteNo, this.siteNo === 1 ? "HOLD TO BURN. KEEP THE LAMPS GREEN AT TOUCHDOWN." : "SITE " + this.siteNo + ": " + (this.site.tag || this.site.name));
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
    this.t += step;
    this.pt += step;
    if (this.phase === "play") this.play(step);
    else if (this.phase === "landed" || this.phase === "crashed") this.after(step);
    else this.idleLamps();
    if (this.phase === "brief" && this.pt >= 2.4) this.startPlay();
  }

  play(dt) {
    const s = this.site, w = this.w;
    stepWorld(s, w, dt);
    const thrust = this.btn && !this.latched && this.fuel > 0;
    if (thrust) {
      this.fuel = Math.max(0, this.fuel - dt);
      this.burnedOnce = true;
    }
    w.vy += (thrust ? s.g - s.a : s.g) * dt;
    w.alt -= w.vy * dt;
    const ceil = s.H * 1.06;
    if (w.alt > ceil) {
      w.alt = ceil;
      if (w.vy < 0) w.vy = 0;
    }
    if (thrust !== this.burning) {
      this.burning = thrust;
      if (thrust) this.ctx.synth.startTone(88);
      else this.ctx.synth.stopTone();
    }
    this.out = outlook(w.alt, w.vy, this.fuel, s.g, s.a, s.safe);
    this.coach();
    this.warn(dt);
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
    if (!this.burnedOnce && w.alt > s.H * 0.5) this.setHint("A", "HOLD THE BUTTON TO BURN. RELEASE TO FALL.");
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
      this.setHint("OVER", "SURVEY ENDED. PRESS TO FLY AGAIN.");
    }
  }

  idleLamps() {
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
    if (this.phase === "title") banner(g, "DESCENT", "SET DOWN GENTLY, OR NOT AT ALL");
    else if (this.phase === "brief") this.drawBrief(g);
    else if (this.phase === "landed" || this.phase === "crashed") this.drawAfter(g);
    else if (this.phase === "over") this.drawOver(g);
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
          const f = 12 + 9 * (0.5 + 0.5 * Math.sin(this.t * 55)) + 4 * Math.sin(this.t * 31);
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
    text(g, this.fuel.toFixed(1) + " S", 812, 34, 22, fr < 0.2 ? C.red : C.muted);
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
    text(g, "FUEL " + s.fuel.toFixed(1) + " S   SAFE UNDER " + s.safe.toFixed(1) + " M/S", 480, 272, 18, C.muted, "center");
    text(g, "DESCENT BEGINS", 480, 304, 18, C.muted, "center");
  }

  drawAfter(g) {
    const o = this.outcome;
    this.panel(g, 150, 170);
    if (o.ok) {
      text(g, "CLEAN TOUCHDOWN", 480, 192, 32, C.ink, "center");
      text(g, "SPEED " + o.speed.toFixed(1) + " M/S   FUEL " + Math.round(o.fuel * 100) + "%   OFF CENTRE " + o.off.toFixed(0) + " M", 480, 238, 19, C.muted, "center");
      text(g, "+" + o.pts, 480, 276, 28, C.amber, "center");
      if (this.pt > 1.2) text(g, "PRESS FOR SITE " + (this.siteNo + 1), 480, 318, 20, C.amber, "center");
    } else {
      text(g, "LANDER LOST", 480, 192, 32, C.red, "center");
      text(g, o.why, 480, 246, 22, C.muted, "center");
      if (this.pt > 1.4 && this.lives > 0) text(g, "PRESS TO TRY THE SITE AGAIN", 480, 300, 20, C.amber, "center");
    }
  }

  drawOver(g) {
    this.panel(g, 140, 210);
    text(g, "SURVEY ENDED", 480, 184, 32, C.red, "center");
    text(g, "SCORE " + this.total, 480, 234, 30, C.ink, "center");
    text(g, "SITES CLEARED " + this.cleared + "   BEST " + Math.max(this.total, this.ctx.best?.() || 0), 480, 276, 19, C.muted, "center");
    if (this.pt > 1) text(g, "PRESS TO FLY AGAIN", 480, 322, 18, C.amber, "center");
  }
}
