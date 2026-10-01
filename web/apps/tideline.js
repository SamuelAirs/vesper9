// TIDELINE — a one-button angling game. Hold to charge a cast (distance picks the water),
// wait for the bite, answer it, then keep a catch zone on the fish: hold lifts the zone,
// release lets it sink, and the meter fills while the fish is inside it.
// Playable by the lamps alone: left lamp = fish below the zone, right lamp = fish above it,
// middle lamp green = fish inside it, overall brightness = how close the landing is.
import { C, space, text, line, circle, banner, wrapText } from "../engine/draw.js";
import { TAU, clamp, lerp } from "../engine/math.js";
import { LAMP, lamps, dim, ramp, spot, pulse, blink, fill, only, meter, lightsOff } from "../engine/lightshow.js";

// ---- the world ---------------------------------------------------------------------
const WATERS = [
  { name: "HALO SHALLOWS", from: 0, col: LAMP.green },
  { name: "CINDER REACH", from: 30, col: LAMP.amber },
  { name: "LANTERN DEEP", from: 55, col: LAMP.cyan },
  { name: "THE UNDERLIGHT", from: 80, col: LAMP.violet },
];
const WCOL = [C.ink, C.amber, C.cyan, "#c9a2ff"];
const WEATHER = ["CLEAR", "FOG", "ASH-FALL", "STORM"];
const WEATHER_ODDS = [40, 25, 20, 15];
const PERIODS = { D: "DAWN", d: "DAY", u: "DUSK", n: "NIGHT" };
const RARITY = ["", "COMMON", "UNCOMMON", "RARE", "VERY RARE", "LEGENDARY"];
const RARITY_WEIGHT = [0, 100, 45, 16, 5];
const RARITY_VALUE = [0, 8, 22, 55, 120, 420];
const RARITY_POINTS = [0, 1, 2, 4, 7, 15];

// Gear: levels 0..3. The catch zone's half height, the meter fill multiplier, the longest cast
// and the multiplier on rare bites.
const ZONE_H = [0.09, 0.11, 0.13, 0.15];
const REEL_MULT = [1, 1.22, 1.45, 1.75];
const CAST_MAX = [45, 65, 85, 105];
const LURE_MULT = [1, 1.6, 2.2, 2.8];
const GEAR = [
  { id: "zone", name: "CATCH GRID", desc: "A LARGER CATCH ZONE", costs: [70, 200, 520] },
  { id: "reel", name: "REEL", desc: "THE METER FILLS FASTER", costs: [90, 240, 600] },
  { id: "cast", name: "CASTER", desc: "LONGER CAST, NEW WATERS", costs: [110, 320, 760] },
  { id: "lure", name: "LURE", desc: "RARER SPECIES BITE", costs: [100, 280, 680] },
];
const CHUM_COST = 40, CHUM_CASTS = 5, CHUM_MAX = 25;
const TIDE_CASTS = 5;
const LEGEND_NEEDS = 4; // species recorded in a water before its legend will rise
const MAX_SCRIP = 99999;

// [name, water, rarity, kind, difficulty, cm min, cm max, periods ("" = any), weather boost, shape, note]
// shape: type:length:height:extras (S spines, L lantern, T streamers, R bands, H horns)
const RAW = [
  ["PALE SKIFF", 0, 1, "steady", 0.12, 18, 34, "", "", "lens:1.1:0.8:", "Drifts in straight lines. Has never been observed to hurry."],
  ["GLASS PERCH", 0, 1, "sinker", 0.2, 12, 26, "d", "", "lens:0.9:1:R", "Transparent. Its last meal is a matter of public record."],
  ["SALT WISP", 0, 1, "darter", 0.22, 8, 18, "", "", "lens:0.6:0.6:T", "Mostly a rumour with fins. Do not let it hurry you."],
  ["TIDE NEEDLE", 0, 2, "darter", 0.28, 30, 55, "Dd", "", "lens:1.9:0.35:", "Long, narrow and offended by the line."],
  ["MUDLARK", 0, 2, "sinker", 0.3, 25, 48, "", "FOG", "lens:1:1.3:S", "Prefers fog and low expectations. Both are available here."],
  ["SKITTERBACK", 0, 2, "bolter", 0.35, 20, 40, "u", "", "lens:0.9:0.9:SH", "Hovers, then leaves. The leaving is the data."],
  ["BLIND MOON-EEL", 0, 3, "fighter", 0.45, 60, 110, "n", "", "eel:1.2:1:", "Navigates by a moon it cannot see. Pulls accordingly."],
  ["THE HALO-KEEPER", 0, 5, "bolter", 0.85, 150, 210, "Du", "", "orb:1.6:1.6:R", "A ring of pale light with something attached. Logged as unlikely."],
  ["ASH MINNOW", 1, 1, "darter", 0.24, 10, 20, "", "ASH-FALL", "lens:0.6:0.6:", "Grey on grey. Counted by the handful, recorded by the one."],
  ["EMBER CARP", 1, 1, "sinker", 0.24, 25, 45, "d", "", "lens:1:1.2:R", "Warm to the touch. The water around it is not."],
  ["SLAGBACK", 1, 2, "fighter", 0.33, 40, 70, "", "", "lens:1.1:1.3:S", "Heavy for its size. Heavier for its opinions."],
  ["CINDER RAY", 1, 3, "bolter", 0.5, 55, 95, "u", "", "ray:1:1:T", "Glides, hovers, strikes. Treat the pause as the warning."],
  ["KILN EEL", 1, 3, "darter", 0.52, 70, 120, "n", "STORM", "eel:1.3:0.9:S", "Hot enough to cook, which is how it is usually found."],
  ["SOOT LANTERN", 1, 4, "bolter", 0.58, 30, 50, "n", "", "orb:0.8:0.8:L", "A lamp that has given up on being useful."],
  ["THE MAGMA PILGRIM", 1, 5, "fighter", 0.9, 180, 260, "", "", "lens:1.8:1.5:SH", "Has been travelling since before the shoreline. Does not intend to stop."],
  ["GLOW SPRAT", 2, 1, "steady", 0.2, 6, 14, "", "", "lens:0.6:0.6:L", "Small, lit and unbothered. A reliable first entry."],
  ["BELL DRIFTER", 2, 2, "sinker", 0.3, 20, 45, "", "FOG", "jelly:1:1:", "A bell with no clapper and a great deal of patience."],
  ["LURE-MAW", 2, 2, "fighter", 0.33, 40, 80, "n", "", "lens:1.1:1.4:L", "Offers light. Takes the rest."],
  ["PRISM SKATE", 2, 3, "darter", 0.5, 50, 90, "d", "", "ray:1.1:0.9:R", "Splits the daylight into three separate reports."],
  ["THREAD ANGEL", 2, 4, "bolter", 0.58, 30, 60, "u", "", "jelly:1.2:1.2:T", "Trails filaments a metre long. Do not pull on them."],
  ["DEEP CHORD", 2, 3, "fighter", 0.52, 90, 150, "", "STORM", "eel:1.5:1.2:R", "Hums at the note the line also hums at. Not a coincidence."],
  ["THE LANTERN QUEEN", 2, 5, "darter", 0.85, 200, 300, "n", "", "jelly:1.8:1.8:L", "Court is held at night. Attendance is not optional."],
  ["FROST MOTE", 3, 2, "sinker", 0.28, 10, 20, "", "", "orb:0.6:0.6:", "Colder than the water it lives in. The instrument disagrees."],
  ["GLACIER BREAM", 3, 2, "sinker", 0.32, 45, 80, "d", "", "lens:1.2:1.5:S", "Slow, wide and cold. A reliable disappointment to chefs."],
  ["VOID SPRAT", 3, 3, "darter", 0.5, 15, 30, "n", "", "lens:0.7:0.7:R", "Swims where the lamp is not. Found by the lamp, eventually."],
  ["ICE WRAITH", 3, 4, "bolter", 0.6, 60, 100, "n", "FOG", "moon:1:1:T", "Visible only as an absence in the shimmer."],
  ["TRENCH WARDEN", 3, 4, "fighter", 0.62, 100, 160, "", "", "lens:1.6:1.4:SH", "Guards nothing in particular. Does so thoroughly."],
  ["ANTIPODE", 3, 3, "darter", 0.5, 40, 70, "D", "", "moon:0.9:0.9:", "Appears to swim upward. The rest of the water disagrees."],
  ["STARLESS ANGLER", 3, 4, "fighter", 0.6, 80, 130, "n", "", "lens:1.3:1.5:L", "Fishes for you. Neither of you has explained the arrangement."],
  ["THE UNDERLIGHT TITAN", 3, 5, "fighter", 0.92, 300, 450, "", "", "ray:2:1.6:SR", "The lowest reading on the instrument. It is looking back."],
];
const SPECIES = RAW.map((r, id) => {
  const [t, len, hgt, extra] = r[9].split(":");
  return { id, name: r[0], water: r[1], rar: r[2], kind: r[3], d: r[4], min: r[5], max: r[6], times: r[7], wx: r[8],
    shape: { t, len: +len, hgt: +hgt, x: extra || "" }, note: r[10] };
});
const N = SPECIES.length;
// Legendary special rules: the Magma Pilgrim only rises in ash or storm weather.
const LEGEND_WX = { 14: ["ASH-FALL", "STORM"] };
const TREASURE = [
  { name: "SEALED CANISTER", value: 60, note: "Sealed. Warm. Not opened, on principle." },
  { name: "SURVEY BEACON", value: 90, note: "Still transmitting. Nobody is listening, which is a relief." },
  { name: "BRASS ASTROLABE", value: 75, note: "Calibrated for a sky we do not have." },
  { name: "FUSED RELAY", value: 50, note: "Somebody's last repair. It held for a while." },
  { name: "CARTOGRAPHER'S SLATE", value: 110, note: "Marked with a shoreline. The shoreline is wrong, or we are." },
  { name: "SALT-GLAZED URN", value: 140, note: "Full. The contents are listed as classified, by us." },
];

// ---- the catch model (pure, no drawing: tests and bots drive it directly) ------------
const ZONE_UP = 3.4, ZONE_DOWN = 2.7, ZONE_DRAG = 1.1, ZONE_VMAX = 1.35, BOUNCE = 0.35;
const FISH_LO = 0.12, FISH_HI = 0.92;

function newCatch(sp, gear, rng, beginner) {
  const h = ZONE_H[gear.zone] + (beginner ? 0.03 : 0);
  const d = sp.d * (beginner ? 0.5 : 1);
  return {
    kind: sp.kind, d, h, z: 0.5, zv: 0, f: 0.55, fv: 0, tgt: 0.55, timer: 0.4, mode: 0, t: 0,
    meter: beginner ? 0.42 : 0.32,
    fill: 0.17 * REEL_MULT[gear.reel] * (beginner ? 1.25 : 1),
    drain: (0.06 + 0.24 * d * d) * (beginner ? 0.6 : 1),
    grace: 0.8, seed: rng.next() * 6.28,
  };
}
function stepZone(c, held, dt) {
  c.zv += (held ? ZONE_UP : -ZONE_DOWN) * dt;
  c.zv /= 1 + ZONE_DRAG * dt;
  c.zv = clamp(c.zv, -ZONE_VMAX, ZONE_VMAX);
  c.z += c.zv * dt;
  const lo = c.h, hi = 1 - c.h;
  if (c.z < lo) { c.z = lo; c.zv = c.zv < -0.12 ? -c.zv * BOUNCE : 0; }
  if (c.z > hi) { c.z = hi; c.zv = c.zv > 0.12 ? -c.zv * BOUNCE : 0; }
}
// Each species moves in its own way. `fight` raises a fighter's aggression as the meter fills.
function stepFish(c, rng, dt) {
  const fight = c.kind === "fighter" ? 0.8 + 1.0 * c.meter : 1;
  let speed = (0.22 + 0.75 * Math.pow(c.d, 1.3)) * fight;
  c.timer -= dt;
  switch (c.kind) {
    case "steady":
      c.tgt = 0.5 + 0.26 * Math.sin(c.t * (0.55 + c.d) + c.seed) + 0.08 * Math.sin(c.t * 1.7 + c.seed * 2);
      speed = 0.5;
      break;
    case "sinker":
      if (c.timer <= 0) {
        c.tgt = c.f + rng.range(-0.3, 0.16);
        if (c.tgt < 0.28) c.tgt = rng.range(0.5, 0.78);
        c.timer = rng.range(1.1, 2.2);
      }
      break;
    case "darter":
      if (c.timer <= 0) {
        c.tgt = rng.range(0.16, 0.9);
        c.timer = rng.range(0.45, 1.0) / (0.6 + c.d);
      }
      speed *= 1.5;
      break;
    case "bolter":
      if (c.timer <= 0) {
        if (c.mode === 0) {
          c.mode = 1;
          c.tgt = c.f > 0.55 ? rng.range(0.16, 0.38) : rng.range(0.7, 0.9);
          c.timer = 0.7;
        } else {
          c.mode = 0;
          c.timer = rng.range(1.2, 2.2);
        }
      }
      if (c.mode === 0) { c.tgt = c.f + 0.06 * Math.sin(c.t * 5 + c.seed); speed *= 0.5; } else speed *= 2.4;
      break;
    default: // fighter
      if (c.timer <= 0) {
        c.tgt = c.f + rng.range(-0.38, 0.38) * fight;
        if (c.tgt < 0.2 || c.tgt > 0.9) c.tgt = rng.range(0.3, 0.8);
        c.timer = rng.range(0.7, 1.3) / fight;
      }
      speed *= 1.25;
  }
  const want = clamp((c.tgt - c.f) * 5, -speed, speed);
  c.fv += (want - c.fv) * Math.min(1, dt * 8);
  c.f = clamp(c.f + c.fv * dt, FISH_LO, FISH_HI);
}
const inZone = (c) => Math.abs(c.f - c.z) <= c.h;
// Advance a catch by dt. Returns 0 (going), 1 (landed) or -1 (lost).
function stepCatch(c, held, rng, dt) {
  c.t += dt;
  stepZone(c, held, dt);
  stepFish(c, rng, dt);
  if (inZone(c)) c.meter += c.fill * dt;
  else if (c.grace > 0) c.grace -= dt;
  else c.meter -= (c.drain + Math.max(0, c.t - 25) * 0.01) * dt;
  if (c.grace > 0 && inZone(c)) c.grace = Math.max(0, c.grace - dt * 0.5);
  c.meter = clamp(c.meter, 0, 1);
  if (!(c.meter > 0)) { c.meter = 0; return -1; }
  return c.meter >= 1 ? 1 : 0;
}

// ---- save format ---------------------------------------------------------------------
// schema 2: n[] catch counts and m[] largest size in tenths of a cm, per species in catalogue
// order; $ scrip; g gear levels; c chum casts left; f treasure finds bitmask; plus tallies.
// `runs`, `last` and `milestone` keep the host's record list meaningful.
function freshSave() {
  return { schema: 2, runs: 0, last: {}, milestone: 0, n: Array(N).fill(0), m: Array(N).fill(0), $: 0,
    g: [0, 0, 0, 0], c: 0, f: 0, casts: 0, landed: 0, tides: 0 };
}
const int = (v, lo, hi) => (Number.isFinite(v) ? clamp(Math.round(v), lo, hi) : lo);
function normalizeSave(raw) {
  const s = freshSave();
  if (!raw || typeof raw !== "object") return s;
  s.runs = int(raw.runs, 0, 1e6);
  if (raw.schema === 2 || raw.schema === 3) {
    // Lists from an older catalogue are padded, from a newer one cut: species keep their order.
    for (let i = 0; i < N; i++) {
      s.n[i] = int(Array.isArray(raw.n) ? raw.n[i] : 0, 0, 9999);
      s.m[i] = int(Array.isArray(raw.m) ? raw.m[i] : 0, 0, 99999);
    }
    s.$ = int(raw.$, 0, MAX_SCRIP);
    for (let i = 0; i < 4; i++) s.g[i] = int(Array.isArray(raw.g) ? raw.g[i] : 0, 0, 3);
    s.c = int(raw.c, 0, CHUM_MAX);
    s.f = int(raw.f, 0, (1 << TREASURE.length) - 1);
    s.casts = int(raw.casts, 0, 1e6);
    s.landed = int(raw.landed, 0, 1e6);
    s.tides = int(raw.tides, 0, 1e6);
  }
  return s;
}

const hash01 = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const WAVES = [262, 272, 285, 302, 325, 355, 392, 437, 490, 536];
// A jagged far shore along the horizon, drawn once as a polyline.
const RIDGE = Array.from({ length: 33 }, (_, i) => [i * 30, 250 - 6 - Math.floor(hash01(i) * 4) * 6 - (i % 7 === 3 ? 18 : 0)]);

export class Tideline {
  constructor(ctx) {
    this.c = ctx;
    this.t = 0;
    this.sv = normalizeSave(ctx.progress?.());
    this.phase = "title";
    this.phaseT = 0;
    this.held = false;
    this.pressT = 0;
    this.ignoreUp = false;
    this.sfx = [];
    this.gesture = { taps: [], ready: 0, shield: 0 };
    this.card = null;
    this.menu = { mode: "root", at: 0, done: false, lines: "" };
    this.bag = { visitCounted: false, tideCasts: 0, tideLanded: 0, tideNew: 0, sessionLanded: 0, firstNote: true };
    this.weather = this.pickWeather();
    this.weatherLeft = ctx.rng.int(3, 6);
    this.toneOn = false;
    this.toneStep = -1;
    this.lastHint = "";
    this.lastHud = "";
    this.cur = null; // the catch in progress
    this.fishSp = null;
    this.power = 0;
    this.dist = 0;
    this.water = 0;
    this.nibble = 0;
    this.lastLeds = lightsOff();
    this.setHint("Press to begin. Hold to cast.");
    this.refreshHud();
  }

  // ---- queries -----------------------------------------------------------------------
  nowHour() {
    const d = new Date();
    return d.getHours() + d.getMinutes() / 60;
  }
  period() {
    const h = this.nowHour();
    return h >= 5 && h < 8 ? "D" : h >= 8 && h < 17 ? "d" : h >= 17 && h < 21 ? "u" : "n";
  }
  pickWeather() {
    let r = this.c.rng.next() * 100;
    for (let i = 0; i < WEATHER.length; i++) { r -= WEATHER_ODDS[i]; if (r < 0) return WEATHER[i]; }
    return WEATHER[0];
  }
  recorded() { return this.sv.n.reduce((a, v) => a + (v > 0 ? 1 : 0), 0); }
  recordedIn(water) { return SPECIES.reduce((a, s) => a + (s.water === water && this.sv.n[s.id] > 0 ? 1 : 0), 0); }
  catScore() {
    let s = 0;
    for (const sp of SPECIES) if (this.sv.n[sp.id] > 0) s += RARITY_POINTS[sp.rar];
    for (let i = 0; i < TREASURE.length; i++) if (this.sv.f & (1 << i)) s += 2;
    return s;
  }
  castMax() { return CAST_MAX[this.sv.g[2]]; }
  waterAt(dist) {
    let w = 0;
    for (let i = 0; i < WATERS.length; i++) if (dist >= WATERS[i].from) w = i;
    return w;
  }
  beginner() { return this.sv.landed < 3; }
  timeOK(sp, period) { return !sp.times || sp.times.includes(period); }
  // Relative bite weights for a water now: [{ sp, w }]. Rarer fish rise with the lure and chum.
  candidates(water, period, weather, gearLure = this.sv.g[3], chum = this.sv.c > 0) {
    const out = [];
    for (const sp of SPECIES) {
      if (sp.water !== water || sp.rar === 5 || !this.timeOK(sp, period)) continue;
      let w = RARITY_WEIGHT[sp.rar];
      if (sp.rar >= 3) w *= LURE_MULT[gearLure] * (chum ? 1.5 : 1);
      if (sp.wx) w *= sp.wx === weather ? 3 : 0.6;
      out.push({ sp, w });
    }
    return out;
  }
  legendFor(water) { return SPECIES.find((s) => s.water === water && s.rar === 5); }
  legendReady(water, period, weather) {
    const sp = this.legendFor(water);
    if (!sp || !this.timeOK(sp, period)) return null;
    const need = LEGEND_WX[sp.id];
    if (need && !need.includes(weather)) return null;
    return this.recordedIn(water) >= LEGEND_NEEDS ? sp : null;
  }
  // What bites: returns a species, or a treasure { treasure: true, ... }.
  pickBite(water, period, weather) {
    const rng = this.c.rng;
    if (this.beginner() && water === 0) {
      const easy = SPECIES.filter((s) => s.water === 0 && s.rar === 1 && (s.kind === "steady" || s.kind === "sinker") && this.timeOK(s, period));
      return rng.pick(easy.length ? easy : [SPECIES[0]]);
    }
    if (rng.next() < (weather === "STORM" ? 0.07 : 0.05)) {
      const item = rng.int(0, TREASURE.length - 1);
      return { treasure: true, item, name: TREASURE[item].name, kind: "steady", d: 0.3, rar: 3, shape: { t: "box", len: 1, hgt: 1, x: "" } };
    }
    const lure = this.sv.g[3], chum = this.sv.c > 0;
    const legend = this.legendReady(water, period, weather);
    if (legend && rng.next() < (0.025 + 0.02 * lure) * (chum ? 2 : 1) * (weather === "STORM" ? 1.5 : 1)) return legend;
    const list = this.candidates(water, period, weather, lure, chum);
    let total = 0;
    for (const e of list) total += e.w;
    if (!(total > 0)) return SPECIES.find((s) => s.water === water && s.rar === 1) || SPECIES[0];
    let r = rng.next() * total;
    for (const e of list) { r -= e.w; if (r < 0) return e.sp; }
    return list[list.length - 1].sp;
  }
  nextCost(i) { return GEAR[i].costs[this.sv.g[i]] ?? null; }

  // ---- hints and readouts --------------------------------------------------------------
  setHint(message) {
    if (message === this.lastHint) return;
    this.lastHint = message;
    this.c.hint(message);
  }
  refreshHud() {
    const key = [this.sv.$, this.recorded(), this.weather, this.period(), this.bag.tideCasts].join("|");
    if (key === this.lastHud) return;
    this.lastHud = key;
    this.c.hud([["SCRIP", this.sv.$], ["LOG", this.recorded() + "/" + N], ["SKY", PERIODS[this.period()] + " " + this.weather], ["TIDE", this.bag.tideCasts + "/" + TIDE_CASTS]]);
  }
  tone(hz, dur, wave = "sine", delay = 0) {
    if (delay <= 0) { this.c.tone(hz, dur, wave); return; }
    if (this.sfx.length < 24) this.sfx.push({ at: this.t + delay, hz, dur, wave });
  }
  fanfare(rar, fresh, treasure) {
    const sets = [[], [523, 659], [523, 659, 784], [523, 659, 784, 1047], [392, 523, 659, 784, 1047], [262, 392, 523, 659, 784, 1047, 1319, 1568]];
    const notes = treasure ? [660, 880, 1100] : sets[clamp(rar, 1, 5)];
    notes.forEach((hz, i) => this.tone(hz, rar >= 4 ? 0.28 : 0.18, rar >= 4 ? "triangle" : "sine", i * 0.11));
    if (fresh) this.tone(1568, 0.3, "sine", notes.length * 0.11 + 0.05);
  }
  stopTension() {
    if (this.toneOn) { this.c.synth.stopTone(); this.toneOn = false; this.toneStep = -1; }
  }
  go(phase) {
    if (this.phase === "catch" && phase !== "catch") this.stopTension();
    this.phase = phase;
    this.phaseT = 0;
  }

  // ---- input ---------------------------------------------------------------------------
  down() {
    this.held = true;
    this.pressT = 0;
    this.ignoreUp = false;
    this.menu.done = false;
    switch (this.phase) {
      case "title":
        this.ignoreUp = true;
        this.toShore();
        break;
      case "wait":
        if (this.phaseT > 0.35) this.scare();
        break;
      case "bite":
        this.hook();
        break;
      case "card":
        if (this.phaseT > 0.9) { this.ignoreUp = true; this.toShore(); }
        break;
      default:
    }
  }
  up(event) {
    const dur = Number.isFinite(event?.durationMs) ? event.durationMs / 1000 : this.pressT;
    const was = this.held;
    this.held = false;
    if (!was) return;
    if (this.phase === "catch") {
      const g = this.gesture;
      if (dur < 0.25) {
        g.taps.push(this.t);
        if (g.taps.length > 3) g.taps.shift();
        const n = g.taps.length;
        // Two quick taps look like the start of the menu gesture: shield the line for a moment,
        // at most once every few seconds so tapping cannot be used to stall.
        if (n >= 2 && g.taps[n - 1] - g.taps[n - 2] < 0.7 && this.t >= g.ready) { g.shield = 1.5; g.ready = this.t + 5; }
      }
      return;
    }
    if (this.ignoreUp) { this.ignoreUp = false; return; }
    if (this.phase === "shore" && dur < 0.22) this.openMenu();
    else if (this.phase === "charge") this.castLine();
    else if (this.phase === "menu" && !this.menu.done) this.menuStep();
  }
  cancel() {
    this.held = false;
    this.ignoreUp = false;
    this.stopTension();
    if (this.phase === "charge") this.go("shore");
    if (this.phase === "menu") this.menu.done = true;
    if (this.cur) this.cur.grace = Math.max(this.cur.grace, 1.5);
    this.c.leds(lightsOff());
  }
  pause() {
    this.stopTension();
    this.c.leds(lightsOff());
  }
  resume() {
    this.held = false;
    if (this.cur) this.cur.grace = Math.max(this.cur.grace, 1.5);
  }
  dispose() {
    this.held = false;
    this.stopTension();
    this.c.leds(lightsOff());
  }

  // ---- state changes -------------------------------------------------------------------
  toShore() {
    this.go("shore");
    this.cur = null;
    this.card = null;
    this.setHint(this.sv.landed === 0 ? "Hold to charge a cast. Release to throw." : "Hold to cast. Tap for gear and log.");
  }
  castLine() {
    this.dist = Math.max(6, this.power * this.castMax());
    this.water = this.waterAt(this.dist);
    this.go("cast");
    this.tone(1000, 0.1, "sine");
    this.tone(700, 0.12, "sine", 0.08);
    this.tone(420, 0.2, "sine", 0.18);
    this.setHint("Line out. Wait for the bite.");
    if (!this.bag.visitCounted) { this.bag.visitCounted = true; this.sv.runs++; }
  }
  startWait() {
    this.go("wait");
    const rng = this.c.rng;
    this.waitFor = rng.range(1.6, 4.8);
    this.nibbleAt = rng.next() < 0.5 ? rng.range(0.7, Math.max(0.8, this.waitFor - 0.7)) : -1;
    this.nibble = 0;
    this.fishSp = this.pickBite(this.water, this.period(), this.weather);
    this.setHint("Wait for the bite. Do not press yet.");
  }
  scare() {
    this.card = { lost: true, reason: "TOO SOON. IT LEFT.", sp: null };
    this.finishCast(false);
    this.tone(260, 0.12, "triangle");
    this.go("card");
    this.setHint("Press to cast again.");
    this.afterCast();
  }
  startBite() {
    this.go("bite");
    this.biteFor = this.beginner() ? 1.6 : 1.0;
    this.tone(880, 0.08, "square");
    this.tone(1175, 0.1, "square", 0.1);
    this.tone(880, 0.08, "square", 0.22);
    this.setHint("BITE! Press now.");
  }
  hook() {
    this.cur = newCatch(this.fishSp, { zone: this.sv.g[0], reel: this.sv.g[1] }, this.c.rng, this.beginner());
    this.go("catch");
    this.tone(330, 0.07, "square");
    this.setHint("Hold lifts the zone. Keep the fish inside it.");
  }
  finishCast(landed) {
    const b = this.bag;
    b.tideCasts++;
    if (landed) b.tideLanded++;
    this.sv.casts++;
    if (this.sv.c > 0) this.sv.c--;
    if (--this.weatherLeft <= 0) { this.weather = this.pickWeather(); this.weatherLeft = this.c.rng.int(3, 6); }
  }
  escapedFish() {
    const sp = this.fishSp;
    this.card = { lost: true, reason: "IT GOT AWAY.", sp: sp && !sp.treasure ? sp : null };
    this.finishCast(false);
    this.go("card");
    this.tone(330, 0.15, "triangle");
    this.tone(247, 0.2, "triangle", 0.15);
    this.tone(185, 0.3, "triangle", 0.32);
    this.setHint("Press to cast again.");
    this.afterCast();
  }
  land() {
    const sp = this.fishSp, rng = this.c.rng, sv = this.sv;
    let card;
    if (sp.treasure) {
      const tr = TREASURE[sp.item], first = !(sv.f & (1 << sp.item));
      sv.f |= 1 << sp.item;
      const scrip = tr.value + rng.int(0, 30);
      card = { treasure: true, item: sp.item, name: tr.name, note: tr.note, isNew: first, scrip, rar: 3, sp };
      sv.$ = Math.min(MAX_SCRIP, sv.$ + scrip);
    } else {
      const frac = clamp((rng.next() + rng.next()) / 2, 0, 1);
      const size = Math.round((sp.min + (sp.max - sp.min) * frac) * 10) / 10;
      const first = sv.n[sp.id] === 0;
      const rec = !first && Math.round(size * 10) > sv.m[sp.id];
      sv.n[sp.id] = Math.min(9999, sv.n[sp.id] + 1);
      sv.m[sp.id] = Math.max(sv.m[sp.id], Math.round(size * 10));
      const scrip = Math.round(RARITY_VALUE[sp.rar] * (0.7 + 0.6 * frac) * (first ? 1.25 : 1));
      sv.$ = Math.min(MAX_SCRIP, sv.$ + scrip);
      card = { sp, name: sp.name, size, isNew: first, isRecord: rec, scrip, rar: sp.rar, note: sp.note };
      if (first) this.bag.tideNew++;
    }
    sv.landed++;
    this.bag.sessionLanded++;
    this.card = card;
    this.finishCast(true);
    this.go("card");
    this.fanfare(card.rar, card.isNew, card.treasure);
    this.setHint(card.isNew ? "New entry in the log. Press to cast again." : "Press to cast again.");
    this.afterCast();
  }
  // Tide bookkeeping and saving after every resolved cast.
  afterCast() {
    const b = this.bag;
    if (b.tideCasts >= TIDE_CASTS) {
      const bonus = b.tideLanded * 10 + (b.tideLanded === TIDE_CASTS ? 50 : 0) + b.tideNew * 20;
      this.sv.$ = Math.min(MAX_SCRIP, this.sv.$ + bonus);
      this.sv.tides++;
      if (this.card) this.card.tide = { landed: b.tideLanded, fresh: b.tideNew, bonus };
      b.tideCasts = 0; b.tideLanded = 0; b.tideNew = 0;
    }
    this.persist();
    this.refreshHud();
  }
  persist() {
    const sv = this.sv, rec = this.recorded(), score = this.catScore();
    sv.milestone = rec;
    sv.last = { recorded: rec, score, landed: sv.landed, tides: sv.tides };
    if (score > 0) this.c.score(score);
    const out = { ...sv, n: sv.n.slice(), m: sv.m.slice(), g: sv.g.slice() };
    return this.c.saveProgress?.(out)?.catch?.(this.c.error);
  }

  // ---- menu (taps step, hold chooses) -----------------------------------------------------
  openMenu() {
    this.menu = { mode: "root", at: 0, done: false, lines: "" };
    this.go("menu");
    this.setHint("Tap to step. Hold to choose.");
  }
  menuItems() {
    if (this.menu.mode === "gear") return ["BACK", ...GEAR.map((g) => g.id), "chum"];
    if (this.menu.mode === "log") return Array.from({ length: N + 2 }, (_, i) => i);
    return ["close", "gear", "log"];
  }
  menuStep() {
    this.menu.at = (this.menu.at + 1) % this.menuItems().length;
    this.tone(260, 0.03, "triangle");
  }
  menuChoose() {
    const m = this.menu, items = this.menuItems(), it = items[m.at];
    m.done = true;
    this.ignoreUp = true;
    this.tone(520, 0.08, "triangle");
    if (m.mode === "root") {
      if (it === "close") this.toShore();
      else { m.mode = it; m.at = 0; m.lines = ""; }
    } else if (m.mode === "log") { m.mode = "root"; m.at = 2; }
    else if (it === "BACK") { m.mode = "root"; m.at = 1; }
    else if (it === "chum") this.buyChum();
    else this.buyGear(GEAR.findIndex((g) => g.id === it));
  }
  buyGear(i) {
    const cost = this.nextCost(i), sv = this.sv;
    if (cost == null) { m_note(this, "ALREADY AT THE LIMIT"); this.tone(200, 0.1, "square"); return; }
    if (sv.$ < cost) { m_note(this, "NEED " + (cost - sv.$) + " MORE SCRIP"); this.tone(200, 0.1, "square"); return; }
    sv.$ -= cost;
    sv.g[i]++;
    m_note(this, GEAR[i].name + " IMPROVED");
    this.tone(660, 0.1, "triangle"); this.tone(990, 0.16, "triangle", 0.1);
    this.persist();
    this.refreshHud();
  }
  buyChum() {
    const sv = this.sv;
    if (sv.c >= CHUM_MAX) { m_note(this, "THE BUCKET IS FULL"); return; }
    if (sv.$ < CHUM_COST) { m_note(this, "NEED " + (CHUM_COST - sv.$) + " MORE SCRIP"); this.tone(200, 0.1, "square"); return; }
    sv.$ -= CHUM_COST;
    sv.c = Math.min(CHUM_MAX, sv.c + CHUM_CASTS);
    m_note(this, "CHUM LOADED");
    this.tone(660, 0.1, "triangle");
    this.persist();
    this.refreshHud();
  }
  affordable() {
    return GEAR.some((g, i) => { const c = this.nextCost(i); return c != null && this.sv.$ >= c; });
  }

  // ---- simulation ----------------------------------------------------------------------
  update(dt) {
    this.t += dt;
    this.phaseT += dt;
    if (this.held) this.pressT += dt;
    if (this.sfx.length) {
      const keep = [];
      for (const s of this.sfx) { if (this.t >= s.at) this.c.tone(s.hz, s.dur, s.wave); else keep.push(s); }
      this.sfx = keep;
    }
    switch (this.phase) {
      case "shore":
        if (this.held && !this.ignoreUp && this.pressT >= 0.22) { this.go("charge"); this.setHint("Release to cast. Longer reaches farther water."); }
        break;
      case "charge":
        this.power = clamp((this.pressT - 0.22) / 1.5, 0, 1);
        break;
      case "cast":
        if (this.phaseT > 0.6) this.startWait();
        break;
      case "wait":
        if (this.nibbleAt >= 0 && this.phaseT > this.nibbleAt) { this.nibble = 0.35; this.nibbleAt = -1; }
        this.nibble = Math.max(0, this.nibble - dt);
        if (this.phaseT >= this.waitFor) this.startBite();
        break;
      case "bite":
        if (this.phaseT >= this.biteFor) this.escapedFish();
        break;
      case "catch":
        this.stepCatchPhase(dt);
        break;
      case "menu": {
        const m = this.menu;
        if (this.held && !m.done && !this.ignoreUp && this.pressT >= (this.c.settings?.().holdMs || 650) / 1000) this.menuChoose();
        break;
      }
      default:
    }
    this.lastLeds = this.lampValues();
    this.c.leds(this.lastLeds);
    this.refreshHud();
  }
  stepCatchPhase(dt) {
    const c = this.cur;
    if (!c) { this.toShore(); return; }
    const g = this.gesture;
    if (g.shield > 0) { g.shield -= dt; c.grace = Math.max(c.grace, 0.2); }
    const r = stepCatch(c, this.held, this.c.rng, dt);
    this.updateTension(c);
    if (r === 1) this.land();
    else if (r === -1) {
      this.card = { lost: true, reason: "THE LINE WENT SLACK.", sp: this.fishSp && !this.fishSp.treasure ? this.fishSp : null };
      this.finishCast(false);
      this.go("card");
      this.tone(330, 0.15, "triangle"); this.tone(247, 0.2, "triangle", 0.15); this.tone(185, 0.3, "triangle", 0.32);
      this.setHint("Press to cast again.");
      this.afterCast();
    }
  }
  // The tension tone sounds while the fish is inside the zone and its pitch follows the meter.
  updateTension(c) {
    if (inZone(c)) {
      const step = Math.round(c.meter * 10);
      if (!this.toneOn || step !== this.toneStep) { this.c.synth.startTone(160 + step * 38); this.toneOn = true; this.toneStep = step; }
    } else this.stopTension();
  }

  // ---- lamps ---------------------------------------------------------------------------
  // The catch display. Position tells the action; brightness tells the progress:
  //   fish below the zone   -> left lamp (release)         fish above the zone -> right lamp (hold)
  //   fish inside the zone  -> middle lamp green, and a dim side lamp on the side of the zone's
  //                            centre where the fish sits (keep steering)
  //   brightness grows with the meter; below a fifth of the meter the lit lamps flicker red.
  catchLamps(c) {
    const e = c.f - c.z, inside = Math.abs(e) <= c.h;
    const base = 0.18 + 0.22 * c.meter;
    const danger = c.meter < 0.22;
    const flick = danger ? (blink(this.t, 8) ? 1 : 0.5) : 1;
    const side = e >= 0 ? 2 : 0;
    const out = Array(9).fill(0);
    const set = (lamp, rgb, level) => { const v = dim(rgb, level); for (let k = 0; k < 3; k++) out[lamp * 3 + k] = v[k]; };
    if (inside) {
      set(1, danger ? LAMP.red : LAMP.green, (base + 0.12) * flick);
      if (Math.abs(e) > 0.006) set(side, danger ? LAMP.red : LAMP.green, 0.12 * flick);
    } else {
      const far = clamp((Math.abs(e) - c.h) / 0.25, 0, 1);
      const col = danger ? LAMP.red : ramp(1 - clamp(c.meter / 0.6, 0, 1), [LAMP.amber, LAMP.amber, LAMP.red]);
      set(side, col, base * (0.8 + 0.2 * far) * flick);
    }
    return out;
  }
  cardLamps() {
    const k = this.card, t = this.phaseT;
    if (!k) return spot(0.5, dim(LAMP.cyan, 0.08));
    if (k.lost) return t < 1.2 ? fill(LAMP.red, 0.3 * (1 - t / 1.2)) : spot(0.5 + 0.5 * Math.sin(this.t * 0.5), dim(LAMP.cyan, 0.05));
    const r = k.rar;
    const span = 1.2 + 0.5 * r;
    if (t > span) return fill(r >= 4 ? LAMP.amber : LAMP.green, 0.05 + 0.05 * pulse(this.t, 0.5));
    if (k.isNew && t < 0.35) return fill(LAMP.white, 0.7);
    if (k.treasure) return lamps(...[0, 1, 2].map((i) => dim(LAMP.amber, 0.2 + 0.4 * blink(t + i * 0.1, 5))));
    switch (r) {
      case 1: return meter(clamp(t / 0.8, 0, 1), dim(LAMP.green, 0.35));
      case 2: return only(Math.floor(t * 5) % 3, LAMP.cyan, 0.4);
      case 3: return only([0, 1, 2, 1][Math.floor(t * 6) % 4], LAMP.amber, 0.45 + 0.2 * blink(t, 3));
      case 4: return blink(t, 4) ? fill(LAMP.violet, 0.5) : only(Math.floor(t * 8) % 3, LAMP.violet, 0.35);
      default: return blink(t, 6) ? fill(LAMP.white, 0.85) : fill(LAMP.amber, 0.12 + 0.3 * (1 - t / span));
    }
  }
  lampValues() {
    const t = this.t;
    switch (this.phase) {
      case "title":
      case "shore":
        return spot(0.5 + 0.5 * Math.sin(t * 0.6), dim(LAMP.cyan, 0.09), 0.8);
      case "charge": {
        const p = this.power, col = ramp(p, [LAMP.green, LAMP.amber, LAMP.cyan, LAMP.violet]);
        return meter(p, dim(col, p >= 1 ? 0.3 + 0.1 * blink(t, 6) : 0.36));
      }
      case "cast":
        return spot(clamp(this.phaseT / 0.6, 0, 1), dim(LAMP.white, 0.5), 0.8);
      case "wait":
        return lamps(null, dim(LAMP.cyan, 0.05 + 0.05 * pulse(t, 0.5) + this.nibble), null);
      case "bite":
        return blink(this.phaseT, 7) ? fill(LAMP.white, 0.9) : fill(LAMP.amber, 0.12);
      case "catch":
        return this.cur ? this.catchLamps(this.cur) : lightsOff();
      case "card":
        return this.cardLamps();
      case "menu":
        return only(this.menu.at % 3, LAMP.cyan, 0.14 + 0.1 * pulse(t, 1));
      default:
        return lightsOff();
    }
  }

  // ---- drawing -------------------------------------------------------------------------
  draw(g) {
    const t = this.t, ph = this.phase;
    if (ph === "menu") { this.drawMenu(g); return; }
    this.drawScene(g);
    if (ph === "title") {
      banner(g, "TIDELINE", "CAST, WAIT, ANSWER, LAND");
      g.fillStyle = "#0c1511e8"; g.fillRect(150, 372, 660, 98);
      text(g, "LAMPS  LEFT = FISH BELOW   MIDDLE = ON IT   RIGHT = FISH ABOVE", 480, 392, 17, C.cyan, "center");
      text(g, "HOLD = CAST / LIFT ZONE    TAP = GEAR AND LOG", 480, 420, 17, C.muted, "center");
      text(g, "LOG " + this.recorded() + " OF " + N + " RECORDED", 480, 450, 18, C.amber, "center");
    } else if (ph === "shore") this.drawShore(g);
    else if (ph === "charge") this.drawCharge(g);
    else if (ph === "bite") {
      const k = blink(t, 6);
      text(g, "BITE", 480, 140, 64, k ? C.amber : C.ink, "center");
      text(g, "PRESS NOW", 480, 190, 26, C.amber, "center");
    } else if (ph === "wait") text(g, this.water >= 0 ? WATERS[this.water].name : "", 480, 60, 22, C.muted, "center");
    else if (ph === "catch") this.drawCatch(g);
    else if (ph === "card") this.drawCard(g);
  }
  bobberXY() {
    const d = this.dist;
    return [260 + 4.2 * d, 440 - 1.55 * d];
  }
  drawScene(g) {
    const t = this.t, per = this.period(), day = per === "d";
    space(g, t, per === "n" ? 0.5 : 0.25);
    // Sun or ringed moon.
    if (day) {
      circle(g, 790, 100, 30, C.amber, false, 2);
      for (let i = 0; i < 12; i++) { const a = i * TAU / 12; line(g, 790 + Math.cos(a) * 38, 100 + Math.sin(a) * 38, 790 + Math.cos(a) * 50, 100 + Math.sin(a) * 50, C.amber, 2); }
    } else {
      circle(g, 790, 100, 28, C.muted, false, 2);
      g.save();
      g.translate(790, 100); g.rotate(-0.4); g.scale(1, 0.28);
      circle(g, 0, 0, 52, C.line, false, 3);
      g.restore();
    }
    // Far shore and horizon.
    g.beginPath();
    g.moveTo(RIDGE[0][0], RIDGE[0][1]);
    for (let i = 1; i < RIDGE.length; i++) g.lineTo(RIDGE[i][0], RIDGE[i][1]);
    g.strokeStyle = C.line; g.lineWidth = 2; g.stroke();
    line(g, 0, 250, 960, 250, C.muted, 2);
    // The water: broken lines that drift.
    g.setLineDash([36, 22]);
    for (let i = 0; i < WAVES.length; i++) {
      g.lineDashOffset = -(t * (6 + i * 2.5)) * (i % 2 ? 1 : -1);
      line(g, 0, WAVES[i] + Math.sin(t * 0.8 + i) * 1.5, 960, WAVES[i] + Math.sin(t * 0.8 + i) * 1.5, i < 4 ? "#233929" : C.line, 2);
    }
    g.setLineDash([]); g.lineDashOffset = 0;
    this.drawWeather(g);
    // Pier, post and rod.
    line(g, 0, 428, 200, 428, C.muted, 4);
    line(g, 40, 428, 40, 470, C.line, 3); line(g, 120, 428, 120, 470, C.line, 3); line(g, 190, 428, 190, 470, C.line, 3);
    line(g, 120, 420, 205, 345, C.amber, 3);
    // Line and bobber.
    const showLine = ["cast", "wait", "bite", "catch"].includes(this.phase);
    if (showLine) this.drawLine(g);
  }
  drawLine(g) {
    const [bx0, by0] = this.bobberXY(), t = this.t, ph = this.phase;
    let bx = bx0, by = by0;
    if (ph === "cast") {
      const k = clamp(this.phaseT / 0.6, 0, 1);
      bx = lerp(205, bx0, k); by = lerp(345, by0, k) - Math.sin(k * Math.PI) * 120;
    } else if (ph === "wait") by += Math.sin(t * 2) * 1.5 + this.nibble * 14;
    else if (ph === "bite") by += 12 * blink(this.phaseT, 7);
    else if (ph === "catch") bx += Math.sin(t * 17) * 2.5;
    g.beginPath();
    g.moveTo(205, 345);
    g.quadraticCurveTo((205 + bx) / 2, Math.max(345, by) + (ph === "catch" ? 4 : 38), bx, by - 6);
    g.strokeStyle = C.ink; g.lineWidth = 1.5; g.stroke();
    if (ph === "wait" || ph === "bite") {
      const r = (t * 14) % 28;
      g.globalAlpha = 1 - r / 28;
      g.save(); g.translate(bx, by + 4); g.scale(1, 0.35); circle(g, 0, 0, 8 + r, C.cyan, false, 2); g.restore();
      g.globalAlpha = 1;
    }
    circle(g, bx, by, 7, C.amber, true);
    line(g, bx, by - 7, bx, by - 17, C.amber, 2);
    if (ph === "bite") text(g, "!", bx, by - 38, 34, C.red, "center");
  }
  drawWeather(g) {
    const w = this.weather, t = this.t;
    if (w === "FOG") {
      g.globalAlpha = 0.08; g.fillStyle = C.ink;
      for (let i = 0; i < 4; i++) g.fillRect(((t * 8 + i * 300) % 1200) - 240, 262 + i * 34, 420, 20);
      g.globalAlpha = 1;
    } else if (w === "ASH-FALL") {
      g.fillStyle = C.muted;
      for (let i = 0; i < 20; i++) g.fillRect((hash01(i) * 960 + t * 14) % 960, (hash01(i + 40) * 540 + t * (20 + hash01(i + 9) * 18)) % 540, 3, 3);
    } else if (w === "STORM") {
      const k = (t * 0.37) % 4;
      if (k < 0.18 && this.phase !== "catch") {
        g.beginPath(); g.moveTo(560, 0); g.lineTo(540, 70); g.lineTo(570, 80); g.lineTo(520, 180); g.lineTo(535, 250);
        g.strokeStyle = C.cyan; g.lineWidth = 3; g.stroke();
      }
      g.strokeStyle = C.line; g.lineWidth = 1;
      for (let i = 0; i < 14; i++) { const x = (hash01(i + 70) * 960 + t * 40) % 960, y = (hash01(i + 90) * 250 + t * 260) % 250; g.beginPath(); g.moveTo(x, y); g.lineTo(x - 6, y + 14); g.stroke(); }
    }
  }
  drawShore(g) {
    text(g, "HOLD TO CAST", 480, 60, 28, C.amber, "center");
    text(g, "TAP FOR GEAR AND LOG", 480, 94, 20, C.muted, "center");
    if (this.affordable()) text(g, "GEAR AVAILABLE", 480, 126, 20, C.cyan, "center");
    text(g, "REACH " + this.castMax() + "   " + WATERS[this.waterAt(this.castMax())].name, 480, 498, 18, C.muted, "center");
  }
  drawCharge(g) {
    const x0 = 230, w = 500, y = 456, max = this.castMax(), p = this.power, d = p * max, wi = this.waterAt(d);
    text(g, WATERS[wi].name, 480, 60, 30, WCOL[wi], "center");
    g.fillStyle = "#0c1511"; g.fillRect(x0, y, w, 22);
    g.fillStyle = WCOL[wi]; g.fillRect(x0, y, w * p, 22);
    g.strokeStyle = C.muted; g.lineWidth = 2; g.strokeRect(x0, y, w, 22);
    for (let i = 0; i < WATERS.length; i++) {
      if (WATERS[i].from >= max) break;
      if (i) line(g, x0 + (WATERS[i].from / max) * w, y - 6, x0 + (WATERS[i].from / max) * w, y + 28, C.ink, 2);
      const mid = (WATERS[i].from + Math.min(max, WATERS[i + 1]?.from ?? max)) / 2;
      text(g, ["I", "II", "III", "IV"][i], x0 + (mid / max) * w, y + 40, 18, C.muted, "center");
    }
    const [bx, by] = [260 + 4.2 * Math.max(6, d), 440 - 1.55 * Math.max(6, d)];
    circle(g, bx, by, 8, C.amber, false, 2);
  }
  drawCatch(g) {
    const c = this.cur;
    if (!c) return;
    const GX = 770, GW = 56, Y0 = 60, Y1 = 470, len = Y1 - Y0;
    const yOf = (v) => Y1 - v * len;
    g.fillStyle = "#0c1511d8"; g.fillRect(GX - 60, Y0 - 24, 170, len + 106);
    // Gauge with the catch zone and the fish.
    g.strokeStyle = C.muted; g.lineWidth = 3; g.strokeRect(GX - GW / 2, Y0, GW, len);
    const inside = inZone(c);
    const zt = yOf(c.z + c.h), zh = c.h * 2 * len;
    g.globalAlpha = inside ? 0.6 : 0.35; g.fillStyle = inside ? "#3f9a58" : "#6b5a30";
    g.fillRect(GX - GW / 2 + 2, zt, GW - 4, zh);
    g.globalAlpha = 1;
    g.strokeStyle = inside ? C.ink : C.amber; g.lineWidth = 3; g.strokeRect(GX - GW / 2 + 2, zt, GW - 4, zh);
    const fy = yOf(c.f);
    this.drawShape(g, this.fishSp.shape, GX, fy, 1 / Math.max(1, this.fishSp.shape.len, this.fishSp.shape.hgt), inside ? C.ink : C.red, 3);
    // Progress meter.
    const mx = GX + 52;
    g.strokeStyle = C.muted; g.lineWidth = 3; g.strokeRect(mx, Y0, 20, len);
    g.fillStyle = c.meter < 0.22 ? C.red : c.meter > 0.8 ? C.cyan : C.ink;
    g.fillRect(mx + 3, Y1 - c.meter * (len - 6) - 3, 14, c.meter * (len - 6));
    // Lamp mirror.
    const lv = this.lastLeds;
    for (let i = 0; i < 3; i++) {
      const col = `rgb(${Math.min(255, lv[i * 3] * 2.4)},${Math.min(255, lv[i * 3 + 1] * 2.4)},${Math.min(255, lv[i * 3 + 2] * 2.4)})`;
      circle(g, GX - 30 + i * 30, Y1 + 30, 11, "#233929", false, 2);
      circle(g, GX - 30 + i * 30, Y1 + 30, 8, col, true);
    }
    text(g, c.meter < 0.22 ? "LINE FAILING" : inside ? "ON IT" : c.f > c.z ? "FISH ABOVE" : "FISH BELOW", 400, 60, 28, c.meter < 0.22 ? C.red : inside ? C.ink : C.amber, "center");
    text(g, "HOLD LIFTS THE ZONE", 400, 96, 20, C.muted, "center");
  }
  cardScale(sh, s) { return clamp(s / Math.max(sh.len, sh.hgt, 0.9), 1.6, s); }
  drawCard(g) {
    const k = this.card;
    if (!k) return;
    g.fillStyle = "#0c1511f0"; g.fillRect(100, 40, 760, 460);
    g.strokeStyle = C.line; g.lineWidth = 2; g.strokeRect(100, 40, 760, 460);
    if (k.lost) {
      text(g, k.reason, 480, 90, 32, C.red, "center");
      if (k.sp) {
        this.drawShape(g, k.sp.shape, 480, 230, this.cardScale(k.sp.shape, 3), C.line, 3);
        text(g, this.sv.n[k.sp.id] > 0 ? k.sp.name : "UNIDENTIFIED SHAPE", 480, 340, 26, C.muted, "center");
      }
      if (this.phaseT > 0.7) text(g, "PRESS TO CAST AGAIN", 480, 468, 22, C.amber, "center");
      return;
    }
    const head = k.treasure ? (k.isNew ? "NEW FIND" : "SALVAGED") : k.isNew ? "NEW SPECIES RECORDED" : k.isRecord ? "NEW SIZE RECORD" : "LANDED";
    text(g, head, 480, 80, 32, k.isNew || k.isRecord ? C.cyan : C.ink, "center");
    this.drawShape(g, k.sp.shape, 290, 210, this.cardScale(k.sp.shape, 3.4), k.rar >= 4 ? C.amber : C.ink, 3);
    text(g, k.name, 600, 150, k.name.length > 16 ? 24 : 30, C.ink, "center");
    if (!k.treasure) {
      text(g, k.size.toFixed(1) + " CM", 600, 200, 34, C.amber, "center");
      text(g, RARITY[k.rar] + "  " + WATERS[k.sp.water].name, 600, 240, 18, C.muted, "center");
    } else text(g, "NOT A FISH", 600, 200, 26, C.amber, "center");
    wrapText(k.note, 52).forEach((ln, i) => text(g, ln, 480, 330 + i * 28, 21, C.muted, "center"));
    text(g, "+" + k.scrip + " SCRIP", 480, 396, 24, C.amber, "center");
    if (k.tide) text(g, "TIDE COMPLETE  " + k.tide.landed + " LANDED  +" + k.tide.bonus, 480, 432, 20, C.cyan, "center");
    if (this.phaseT > 0.9) text(g, "PRESS TO CAST AGAIN", 480, 472, 20, C.amber, "center");
  }

  // Line-art silhouettes. A shape is { t, len, hgt, x }; they face right, centred on (x, y).
  drawShape(g, sh, x, y, s, color, width) {
    const L = 24 * s * sh.len, H = 9 * s * sh.hgt;
    g.strokeStyle = color; g.lineWidth = width;
    g.beginPath();
    switch (sh.t) {
      case "eel": {
        const seg = (L * 2.3) / 4;
        for (let pass = 0; pass < 2; pass++) {
          const off = pass * H * 0.9;
          g.moveTo(x + L, y - H * 0.4 + off);
          for (let i = 0; i < 4; i++) g.quadraticCurveTo(x + L - seg * (i + 0.5), y - H * 0.4 + off + (i % 2 ? 1 : -1) * H * 0.9, x + L - seg * (i + 1), y - H * 0.4 + off);
        }
        g.moveTo(x + L, y - H * 0.4); g.lineTo(x + L, y + H * 0.5);
        g.moveTo(x + L * 0.7, y - H * 0.1); g.arc(x + L * 0.7 - 2, y - H * 0.1, Math.max(1.5, s * 1.6), 0, TAU);
        break;
      }
      case "ray":
        g.moveTo(x + L, y); g.lineTo(x - L * 0.1, y - H * 2.3); g.lineTo(x - L * 0.7, y); g.lineTo(x - L * 0.1, y + H * 2.3); g.closePath();
        g.moveTo(x - L * 0.7, y); g.lineTo(x - L * 1.6, y + H * 0.3);
        break;
      case "orb": {
        const r = Math.max(L, H) * 0.8;
        g.arc(x, y, r, 0, TAU);
        g.moveTo(x - r, y + r * 0.3); g.lineTo(x - r * 1.6, y + r * 0.7);
        g.moveTo(x - r * 0.4, y + r); g.lineTo(x - r * 0.6, y + r * 1.6);
        g.moveTo(x + r * 0.2 + 2, y - r * 0.2); g.arc(x + r * 0.2, y - r * 0.2, Math.max(1.5, s * 1.5), 0, TAU);
        break;
      }
      case "moon":
        g.arc(x, y, H * 1.9 + 4, 0.7, TAU - 0.7);
        g.arc(x + H * 0.9, y, H * 1.5 + 2, TAU - 0.9, 0.9, true);
        break;
      case "jelly": {
        const r = L * 0.8;
        g.arc(x, y - H * 0.4, r, Math.PI, TAU);
        g.lineTo(x - r, y - H * 0.4);
        for (let i = 0; i < 4; i++) {
          const tx = x - r * 0.75 + i * r * 0.5;
          g.moveTo(tx, y - H * 0.4); g.quadraticCurveTo(tx + (i % 2 ? 6 : -6) * s, y + H * 0.8, tx, y + H * 1.8);
        }
        break;
      }
      case "box":
        g.rect(x - 28 * s * 0.8, y - 16 * s * 0.8, 56 * s * 0.8, 36 * s * 0.8);
        g.moveTo(x - 28 * s * 0.8, y - 2 * s * 0.8); g.lineTo(x + 28 * s * 0.8, y - 2 * s * 0.8);
        g.moveTo(x + 3 * s, y + 2 * s); g.arc(x, y + 2 * s, 3 * s, 0, TAU);
        break;
      default: // lens: a fish
        g.moveTo(x + L, y);
        g.bezierCurveTo(x + L * 0.5, y - H * 1.5, x - L * 0.4, y - H * 1.3, x - L * 0.75, y - H * 0.25);
        g.lineTo(x - L * 1.25, y - H * 0.9); g.lineTo(x - L * 1.05, y); g.lineTo(x - L * 1.25, y + H * 0.9); g.lineTo(x - L * 0.75, y + H * 0.25);
        g.bezierCurveTo(x - L * 0.4, y + H * 1.3, x + L * 0.5, y + H * 1.5, x + L, y);
        g.moveTo(x + L * 0.5 + 2, y - H * 0.2); g.arc(x + L * 0.5, y - H * 0.2, Math.max(1.5, s * 1.6), 0, TAU);
    }
    const ex = sh.x;
    if (ex) {
      if (ex.includes("S")) for (let i = 0; i < 3; i++) { g.moveTo(x + L * (0.2 - i * 0.3), y - H * 1.2); g.lineTo(x + L * (0.1 - i * 0.3), y - H * 1.2 - 7 * s); }
      if (ex.includes("L")) { g.moveTo(x + L * 0.6, y - H * 1.1); g.quadraticCurveTo(x + L * 0.9, y - H * 2.4, x + L * 1.3, y - H * 1.9); g.moveTo(x + L * 1.3 + 3 * s, y - H * 1.9); g.arc(x + L * 1.3, y - H * 1.9, 3 * s, 0, TAU); }
      if (ex.includes("T")) { g.moveTo(x - L * 1.1, y); g.lineTo(x - L * 1.9, y - H * 0.7); g.moveTo(x - L * 1.1, y); g.lineTo(x - L * 2, y + H * 0.5); }
      if (ex.includes("R")) { g.moveTo(x - L * 0.1, y - H * 0.8); g.lineTo(x - L * 0.1, y + H * 0.8); g.moveTo(x - L * 0.4, y - H * 0.7); g.lineTo(x - L * 0.4, y + H * 0.7); }
      if (ex.includes("H")) { g.moveTo(x + L * 0.75, y - H * 0.6); g.lineTo(x + L * 0.95, y - H * 1.5); g.moveTo(x + L * 0.5, y - H * 0.9); g.lineTo(x + L * 0.6, y - H * 1.7); }
    }
    g.stroke();
  }

  // ---- menus ---------------------------------------------------------------------------
  drawMenu(g) {
    const m = this.menu, items = this.menuItems();
    space(g, this.t, 0.3);
    const holdFrac = this.held && !m.done ? clamp(this.pressT / ((this.c.settings?.().holdMs || 650) / 1000), 0, 1) : 0;
    if (m.mode === "log") { this.drawLog(g, holdFrac); return; }
    text(g, m.mode === "gear" ? "GEAR" : "TIDELINE", 480, 56, 34, C.ink, "center");
    text(g, "SCRIP " + this.sv.$ + "    LOG " + this.recorded() + "/" + N, 480, 96, 22, C.amber, "center");
    items.forEach((it, i) => {
      const y = 160 + i * 52, sel = i === m.at;
      if (sel) { g.strokeStyle = C.cyan; g.lineWidth = 2; g.strokeRect(150, y - 24, 660, 46); g.fillStyle = "#2f7a4655"; g.fillRect(152, y - 22, 656 * holdFrac, 42); }
      let label, right = "", col = sel ? C.ink : C.muted;
      if (m.mode === "root") label = { close: "CLOSE  BACK TO THE WATER", gear: "GEAR", log: "FIELD LOG  " + this.recorded() + " OF " + N + " RECORDED" }[it];
      else if (it === "BACK") label = "BACK";
      else if (it === "chum") { label = "CHUM"; right = this.sv.c ? this.sv.c + " CASTS LEFT  " + CHUM_COST + " MORE" : CHUM_COST + " SCRIP"; }
      else {
        const gi = GEAR.findIndex((x) => x.id === it), gr = GEAR[gi], lv = this.sv.g[gi], cost = this.nextCost(gi);
        label = gr.name + "  " + "#".repeat(lv) + "-".repeat(3 - lv);
        right = cost == null ? "MAX" : cost + " SCRIP";
        if (cost != null && this.sv.$ >= cost) col = sel ? C.cyan : C.ink;
      }
      text(g, label, 172, y, 22, col);
      if (right) text(g, right, 790, y, 20, col, "right");
    });
    if (m.mode === "gear") {
      const it = items[m.at], gr = GEAR.find((x) => x.id === it);
      text(g, gr ? gr.desc : it === "chum" ? "RARER BITES FOR " + CHUM_CASTS + " CASTS" : "", 480, 440, 22, C.muted, "center");
    }
    if (m.lines) text(g, m.lines, 480, 484, 22, C.cyan, "center");
    text(g, "TAP STEPS    HOLD CHOOSES", 480, 516, 18, C.muted, "center");
  }
  hintFor(sp) {
    const w = WATERS[sp.water];
    const reach = CAST_MAX.findIndex((v) => v > w.from);
    const where = this.sv.g[2] >= reach ? "IN " + w.name : "BEYOND YOUR CAST: FAR WATER";
    const when = sp.times ? "  AT " + sp.times.split("").map((c) => PERIODS[c]).join(" OR ") : "";
    const wx = sp.wx ? "  LIKES " + sp.wx : "";
    return where + when + wx;
  }
  drawLog(g, holdFrac) {
    const m = this.menu, cols = 8, cw = 104, ch = 74, x0 = 60, y0 = 90;
    text(g, "FIELD LOG  " + this.recorded() + " OF " + N + " RECORDED", 480, 44, 30, C.ink, "center");
    for (let i = 0; i < N + 2; i++) {
      const cx = x0 + (i % cols) * cw + cw / 2, cy = y0 + Math.floor(i / cols) * ch + ch / 2;
      const sel = i === m.at;
      if (sel) { g.strokeStyle = C.cyan; g.lineWidth = 2; g.strokeRect(cx - cw / 2 + 4, cy - ch / 2 + 4, cw - 8, ch - 8); }
      if (i < N) {
        const sp = SPECIES[i];
        if (this.sv.n[i] > 0) this.drawShape(g, sp.shape, cx, cy, 0.62, sp.rar === 5 ? C.amber : C.ink, 2);
        else text(g, "?", cx, cy, 26, C.line, "center");
      } else if (i === N) text(g, "FINDS", cx, cy - 8, 18, C.amber, "center"), text(g, this.findCount() + "/" + TREASURE.length, cx, cy + 14, 20, C.amber, "center");
      else text(g, "CLOSE", cx, cy, 20, C.muted, "center");
    }
    g.fillStyle = "#2f7a4655";
    if (holdFrac) g.fillRect(60, 410, 840 * holdFrac, 6);
    const i = m.at;
    if (i < N) {
      const sp = SPECIES[i], n = this.sv.n[i];
      if (n > 0) {
        text(g, sp.name + "   " + RARITY[sp.rar], 480, 440, 24, C.ink, "center");
        text(g, "LARGEST " + (this.sv.m[i] / 10).toFixed(1) + " CM    LANDED " + n, 480, 470, 20, C.amber, "center");
        text(g, sp.note, 480, 500, 17, C.muted, "center");
      } else {
        text(g, "NOT YET RECORDED", 480, 440, 24, C.muted, "center");
        text(g, this.hintFor(sp), 480, 476, 18, C.cyan, "center");
      }
    } else if (i === N) {
      text(g, "FINDS THAT WERE NOT FISH: " + this.findCount() + " OF " + TREASURE.length, 480, 450, 22, C.amber, "center");
      text(g, "CATALOGUE SCORE " + this.catScore(), 480, 484, 20, C.muted, "center");
    } else text(g, "HOLD TO CLOSE", 480, 460, 24, C.ink, "center");
    text(g, "TAP BROWSES  HOLD CLOSES", 480, 524, 16, C.muted, "center");
  }
  findCount() {
    let n = 0;
    for (let i = 0; i < TREASURE.length; i++) if (this.sv.f & (1 << i)) n++;
    return n;
  }
}
function m_note(app, message) { app.menu.lines = message; }

// Pure model and data, for tests and tools.
Tideline.model = { newCatch, stepCatch, stepZone, stepFish, inZone, normalizeSave, freshSave, SPECIES, WATERS, GEAR, TREASURE, CAST_MAX, ZONE_H, REEL_MULT, LURE_MULT, WEATHER, LEGEND_NEEDS, TIDE_CASTS };
