// ORACLE — a chance machine: coin, dice, number, decide, and a short history.
// The result is decided from ctx.rng at the moment of the press; the tumble only reveals it.
// The tumble is a pure function of (result, seconds), see rollFrame().
import { escapeHTML as esc } from "../engine/math.js";
import { LAMP, fill, only, meter, spot, ramp, dim, pulse, blink, lightsOff } from "../engine/lightshow.js";

export const DICE = [4, 6, 8, 10, 12, 20, 100];
export const MODES = ["coin", "dice", "number", "decide"];
const MODE_NAMES = { coin: "COIN", dice: "DICE", number: "NUMBER", decide: "DECIDE" };
const NUMBER_PRESETS = [10, 20, 50, 100, 1000];
const NUMBER_SCALES = [1, 10, 100, 1000];
const HISTORY_LENGTH = 10;
export const IDLE_SECONDS = 6; // lamps go dark this long after a result lands

// Tick times of the tumble: gaps start at 40 ms and grow by 20 % each tick, so the
// wheel slows as it comes to rest. The last tick is the landing, about a second in.
export const TICK_COUNT = 10;
export const TICKS = (() => {
  const times = [];
  let at = 0, gap = 0.04;
  for (let i = 0; i < TICK_COUNT; i++) { at += gap; times.push(at); gap *= 1.2; }
  return times;
})();
export const ROLL_SECONDS = TICKS[TICK_COUNT - 1];
export const tickFrequency = (index) => Math.round(920 * Math.pow(0.92, Math.max(0, index)));

const TUMBLE_COLOURS = [LAMP.cyan, LAMP.amber, LAMP.violet, LAMP.green, LAMP.blue, LAMP.white];

// Small integer hash: stable pseudo-random faces for the tumble without touching ctx.rng.
const mix = (a, b) => {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca6b)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0xc2b2ae35) >>> 0; h ^= h >>> 13;
  return h >>> 0;
};
const faceIn = (seed, step, lo, hi) => lo + (mix(seed, step) % (hi - lo + 1));

export const clampInt = (value, lo, hi, fallback) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
export const defaultConfig = () => ({ mode: "coin", die: 6, count: 2, max: 100, decideKind: "yesno", pickN: 5 });
export function cleanConfig(saved) {
  const base = defaultConfig(), s = saved && typeof saved === "object" ? saved : {};
  return {
    mode: MODES.includes(s.mode) ? s.mode : base.mode,
    die: DICE.includes(s.die) ? s.die : base.die,
    count: clampInt(s.count, 1, 6, base.count),
    max: clampInt(s.max, 2, 99999, base.max),
    decideKind: s.decideKind === "pick" ? "pick" : "yesno",
    pickN: clampInt(s.pickN, 2, 8, base.pickN),
  };
}

// Decide a result now. Everything random in the instrument happens here.
export function makeResult(cfg, rng) {
  if (cfg.mode === "coin") {
    const tails = rng.int(0, 1) === 1;
    return { kind: "coin", side: tails ? "TAILS" : "HEADS", seed: tails ? 2 : 1 };
  }
  if (cfg.mode === "dice") {
    const values = [];
    for (let i = 0; i < cfg.count; i++) values.push(rng.int(1, cfg.die));
    const total = values.reduce((a, b) => a + b, 0), lo = cfg.count, hi = cfg.count * cfg.die;
    return { kind: "dice", sides: cfg.die, count: cfg.count, values, total, lo, hi,
      extreme: total === hi ? "max" : total === lo ? "min" : null, seed: mix(total, cfg.die) };
  }
  if (cfg.mode === "number") {
    const value = rng.int(1, cfg.max);
    return { kind: "number", value, total: value, lo: 1, hi: cfg.max,
      extreme: value === cfg.max ? "max" : value === 1 ? "min" : null, seed: mix(value, 3) };
  }
  if (cfg.decideKind === "pick") {
    const choice = rng.int(1, cfg.pickN);
    return { kind: "pick", n: cfg.pickN, choice, seed: mix(choice, cfg.pickN) };
  }
  // Yes and no are five in twelve each; "ask again" is the remaining two.
  const v = rng.int(0, 11);
  const answer = v < 5 ? "YES" : v < 10 ? "NO" : "ASK AGAIN";
  return { kind: "yesno", answer, seed: v + 7 };
}

export function summary(r) {
  if (!r) return "";
  switch (r.kind) {
    case "coin": return `COIN / ${r.side}`;
    case "dice": return `${r.count}D${r.sides} / ${r.count > 1 ? r.values.join("+") + " = " : ""}${r.total}`;
    case "number": return `1-${r.hi} / ${r.value}`;
    case "pick": return `OPTION ${r.choice} OF ${r.n}`;
    default: return r.answer;
  }
}

// What a half-spun wheel shows at a given tick: the same shape as a result, with other faces.
export function tumbleResult(r, step) {
  if (!r) return r;
  const seed = r.seed | 0;
  switch (r.kind) {
    case "coin": return { ...r, side: step % 2 ? "TAILS" : "HEADS" };
    case "dice": {
      const values = r.values.map((_, i) => faceIn(seed + i * 17, step, 1, r.sides));
      return { ...r, values, total: values.reduce((a, b) => a + b, 0) };
    }
    case "number": { const value = faceIn(seed, step, 1, r.hi); return { ...r, value, total: value }; }
    case "pick": return { ...r, choice: faceIn(seed, step, 1, r.n) };
    default: return { ...r, answer: ["YES", "NO", "ASK AGAIN"][faceIn(seed, step, 0, 2)] };
  }
}

// How high a roll was within its range, 0..1 (dice and number only).
export const fractionOf = (r) => (r && r.hi > r.lo ? Math.min(1, Math.max(0, (r.total - r.lo) / (r.hi - r.lo))) : 0.5);

// The lamps for a landed result, `s` seconds after landing; s < 0 means a steady image
// (no blinking), used when animation is off. Dark once the result has sat for IDLE_SECONDS.
export function resultLamps(r, s) {
  if (!r || s > IDLE_SECONDS) return lightsOff();
  const live = s >= 0;
  switch (r.kind) {
    case "coin": return r.side === "HEADS" ? only(0, LAMP.amber, 0.4) : only(2, LAMP.cyan, 0.4);
    case "yesno":
      if (r.answer === "YES") return fill(LAMP.green, 0.35);
      if (r.answer === "NO") return fill(LAMP.red, 0.35);
      return live ? fill(LAMP.amber, 0.35 * blink(s, 1.5)) : only(1, LAMP.amber, 0.4);
    case "pick": {
      const place = r.n > 1 ? (r.choice - 1) / (r.n - 1) : 0.5;
      if (!live) return spot(place, LAMP.amber, 0.8);
      // choice blinks, then a steady spot at the choice's place from left to right; repeats
      const blinks = r.choice * 0.5, at = s % (blinks + 1.2);
      if (at < blinks) return fill(LAMP.amber, 0.4 * (at % 0.5 < 0.28 ? 1 : 0));
      return spot(place, LAMP.amber, 0.8);
    }
    default: {
      const f = fractionOf(r);
      if (r.extreme === "max") {
        if (!live || s > 3) return fill(LAMP.amber, 0.35);
        return fill(LAMP.white, 0.2 + 0.5 * pulse(s, 1.6));
      }
      if (r.extreme === "min") {
        if (!live || s > 3) return only(0, LAMP.red, 0.3);
        return fill(LAMP.red, 0.45 * blink(s, 2));
      }
      return meter(Math.max(0.12, f), dim(ramp(f, [LAMP.cyan, LAMP.green, LAMP.amber]), 0.4));
    }
  }
}

// One frame of a roll: a pure function of the result and seconds since the press.
// Returns the nine lamp values, the tick count so far, whether it has landed, and the
// face the screen should show.
export function rollFrame(r, t) {
  const seconds = Number.isFinite(t) ? Math.max(0, t) : 0;
  let step = 0;
  while (step < TICK_COUNT && TICKS[step] <= seconds) step++;
  if (step >= TICK_COUNT) {
    return { step: TICK_COUNT, done: true, face: r, leds: resultLamps(r, seconds - ROLL_SECONDS) };
  }
  const colour = TUMBLE_COLOURS[mix((r?.seed | 0) + 5, step) % TUMBLE_COLOURS.length];
  return { step, done: false, face: tumbleResult(r, step), leds: only(step % 3, colour, 0.35) };
}

// ---------------------------------------------------------------- line art

const PIPS = {
  1: [[28, 28]], 2: [[18, 18], [38, 38]], 3: [[18, 18], [28, 28], [38, 38]],
  4: [[18, 18], [38, 18], [18, 38], [38, 38]], 5: [[18, 18], [38, 18], [28, 28], [18, 38], [38, 38]],
  6: [[18, 17], [38, 17], [18, 28], [38, 28], [18, 39], [38, 39]],
};
const OUTLINES = {
  4: "28,6 52,50 4,50", 8: "28,4 52,28 28,52 4,28", 10: "28,4 50,22 42,50 14,50 6,22",
  12: "28,4 51,21 42,50 14,50 5,21", 20: "28,4 50,16 50,40 28,52 6,40 6,16",
};
function dieTile(sides, value) {
  const label = String(value);
  if (sides === 6 && PIPS[value]) {
    return `<svg viewBox="0 0 56 56" width="62" height="62" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="48" height="48" rx="8"/>${PIPS[value].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.6" fill="currentColor" stroke="none"/>`).join("")}</svg>`;
  }
  const shape = OUTLINES[sides] ? `<polygon points="${OUTLINES[sides]}"/>` : '<rect x="4" y="10" width="48" height="36" rx="6"/>';
  const size = label.length > 2 ? 14 : 19;
  return `<svg viewBox="0 0 56 56" width="62" height="62" fill="none" stroke="currentColor" stroke-width="2">${shape}<text x="28" y="${sides === 4 ? 40 : 33}" text-anchor="middle" font-size="${size}" fill="currentColor" stroke="none" font-family="monospace">${esc(label)}</text></svg>`;
}
function coinArt(side, squash) {
  const rx = Math.max(3, 26 * squash).toFixed(1);
  return `<svg viewBox="0 0 56 56" width="108" height="108" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="28" cy="28" rx="${rx}" ry="26"/><ellipse cx="28" cy="28" rx="${Math.max(2, rx - 5).toFixed(1)}" ry="21" stroke-dasharray="2 4"/><text x="28" y="37" text-anchor="middle" font-size="${squash > 0.5 ? 26 : 0}" fill="currentColor" stroke="none" font-family="monospace">${side === "HEADS" ? "H" : "T"}</text></svg>`;
}
function pickArt(n, choice) {
  const dots = [];
  for (let i = 1; i <= n; i++) {
    const x = 14 + (i - 1) * (n > 1 ? 172 / (n - 1) : 0);
    dots.push(`<circle cx="${x.toFixed(1)}" cy="20" r="${i === choice ? 9 : 6}" ${i === choice ? 'fill="currentColor"' : ""}/>`);
  }
  return `<svg viewBox="0 0 200 40" width="230" height="46" fill="none" stroke="currentColor" stroke-width="2">${dots.join("")}</svg>`;
}

// ---------------------------------------------------------------- panel text

const describe = (cfg) => {
  if (cfg.mode === "coin") return "COIN";
  if (cfg.mode === "dice") return `${cfg.count} × D${cfg.die}`;
  if (cfg.mode === "number") return `NUMBER 1-${cfg.max}`;
  return cfg.decideKind === "pick" ? `PICK ONE OF ${cfg.pickN}` : "YES / NO";
};
const faceText = (r) => {
  switch (r.kind) {
    case "coin": return { big: r.side, sub: "" };
    case "dice": return { big: String(r.total), sub: r.count > 1 ? r.values.join(" + ") + " = " + r.total : `ONE D${r.sides}` };
    case "number": return { big: String(r.value), sub: `OF 1 TO ${r.hi}` };
    case "pick": return { big: String(r.choice), sub: `OPTION ${r.choice} OF ${r.n}` };
    default: return { big: r.answer, sub: r.answer === "ASK AGAIN" ? "THE DARK WILL NOT SAY. ROLL AGAIN." : "" };
  }
};
function artFor(r, step) {
  switch (r.kind) {
    case "coin": return coinArt(r.side, step == null ? 1 : Math.abs(Math.cos(step * 1.3)) * 0.9 + 0.1);
    case "dice": return `<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;max-width:470px">${r.values.map((v) => dieTile(r.sides, v)).join("")}</div>`;
    case "pick": return pickArt(r.n, r.choice);
    default: return "";
  }
}

export class Oracle {
  constructor(ctx) {
    this.c = ctx;
    this.navigation = true;
    this.cfg = cleanConfig(ctx.progress?.());
    // The host seeds its generator (xorshift32) with the launch time in milliseconds, and the
    // first outputs of nearby seeds are strongly alike: over 60000 launches a millisecond apart
    // the first D6 gave chi-square 403 (a fair die gives about 5), the 1 coming up 11 % too
    // rarely. Eight draws thrown away mix it fully (chi-square 0.0).
    for (let i = 0; i < 8; i++) ctx.rng.next();
    this.view = "main";
    this.result = null;
    this.history = [];
    this.tally = { HEADS: 0, TAILS: 0 };
    this.rolling = false;
    this.t0 = 0;
    this.shown = 0;
    this.landedAt = null;
    this.dark = true;
    this.raf = 0;
    this.active = false;
    this.disposed = false;
    this.numberScale = 10;
    // The first list is parked on ROLL too: the host would otherwise start the highlight on the
    // row numbered like the dashboard card that opened ORACLE (RETURN TO DASHBOARD, 5th card).
    this.refocus = true;
    this.onFrame = () => this.frame();
    this.render();
  }

  // ---- time and animation ------------------------------------------------
  now() { return typeof performance !== "undefined" ? performance.now() : Date.now(); }
  animated() {
    return typeof requestAnimationFrame === "function" && !this.c.settings?.().reducedMotion;
  }
  startLoop() {
    if (this.raf || this.disposed || !this.animated()) return;
    this.raf = requestAnimationFrame(this.onFrame);
  }
  stopLoop() {
    if (this.raf && typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.active = false;
  }
  frame() {
    this.raf = 0;
    if (this.disposed || !this.c.alive()) { this.active = false; return; }
    try { this.step(); } catch (error) { this.active = false; }
    if (this.active) this.startLoop();
  }
  // Advance the roll or the afterglow to the present moment.
  step() {
    const now = this.now();
    if (this.rolling) {
      const f = rollFrame(this.result, (now - this.t0) / 1000);
      if (f.step > this.shown) {
        this.c.tone(tickFrequency(f.step - 1), 0.03, "triangle");
        this.shown = f.step;
        if (!f.done) this.panel(f.face, f.step);
      }
      if (f.done) this.land(false); else { this.dark = false; this.c.leds(f.leds); }
    } else if (this.landedAt != null) {
      const s = (now - this.landedAt) / 1000;
      if (s > IDLE_SECONDS) { this.darken(); this.active = false; return; }
      this.dark = false;
      this.c.leds(resultLamps(this.result, s));
    } else this.active = false;
  }
  darken() {
    this.dark = true;
    this.c.leds(lightsOff());
  }

  // ---- rolling -----------------------------------------------------------
  roll() {
    if (this.rolling) { this.skip(); return; }
    const r = makeResult(this.cfg, this.c.rng);
    this.result = r;
    this.view = "main";
    this.history.unshift(r);
    if (this.history.length > HISTORY_LENGTH) this.history.length = HISTORY_LENGTH;
    if (!this.animated()) { this.land(false); return; }
    this.rolling = true;
    this.t0 = this.now();
    this.shown = 0;
    this.landedAt = null;
    this.active = true;
    this.panel(tumbleResult(r, 0), 0);
    this.actions();
    this.c.hint("The wheel is turning. Hold to show the result at once.");
    this.startLoop();
  }
  skip() {
    if (this.rolling) this.land(false);
  }
  land(quiet) {
    const r = this.result;
    this.rolling = false;
    this.landedAt = this.now();
    if (r?.kind === "coin") this.tally[r.side] = (this.tally[r.side] || 0) + 1;
    if (!quiet && r) {
      this.landingTone(r);
      this.dark = false;
      this.c.leds(resultLamps(r, this.animated() ? 0 : -1));
      this.active = this.animated();
      this.startLoop();
    }
    this.render();
  }
  landingTone(r) {
    let hz = 660;
    if (r.extreme === "max") hz = 1175;
    else if (r.extreme === "min") hz = 196;
    else if (r.kind === "coin") hz = r.side === "HEADS" ? 660 : 495;
    else if (r.kind === "yesno") hz = r.answer === "YES" ? 784 : r.answer === "NO" ? 330 : 523;
    this.c.tone(hz, 0.22, "sine");
  }

  // ---- panel -------------------------------------------------------------
  panel(face, step) {
    const r = face || this.result;
    const title = esc(describe(this.cfg));
    let big = "READY", sub = "PRESS ROLL", art = "";
    if (r) { ({ big, sub } = faceText(r)); art = artFor(r, step); }
    else if (this.cfg.mode === "coin") sub = "TOSS A COIN";
    const bigSize = big.length > 6 ? 56 : 84;
    const shown = this.rolling ? this.history.slice(1) : this.history;
    let foot;
    if (this.cfg.mode === "coin") {
      const h = this.tally.HEADS, t = this.tally.TAILS;
      foot = `TALLY / HEADS ${h} · TAILS ${t} · TOSSES ${h + t}`;
    } else {
      const last = shown.slice(r && !this.rolling ? 1 : 0, 4).map(summary);
      foot = last.length ? "BEFORE / " + last.join("  ·  ") : "BEFORE / NOTHING YET";
    }
    const tag = this.rolling ? "TUMBLING" : r ? "RESULT" : "STANDING BY";
    this.c.content(
      `<div class="utility-panel"><h2>${title}</h2>` +
      `<div style="display:flex;align-items:center;justify-content:space-between;gap:18px;min-height:128px">` +
      `<div style="min-width:0"><div class="data-label">${tag}</div>` +
      `<div class="big-readout" style="font-size:${bigSize}px;line-height:1.05">${esc(big)}</div>` +
      `<div class="recording-tag" style="min-height:20px">${esc(sub)}</div></div>` +
      `<div style="flex:none;color:var(--amber)">${art}</div></div>` +
      `<p style="margin:6px 0 0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${esc(foot)}</p></div>`);
  }
  historyPanel() {
    const rows = this.history.map((r, i) =>
      `<div style="padding:3px 0;border-bottom:1px solid var(--line);font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><span style="color:var(--muted)">${String(i + 1).padStart(2, "0")}</span>&nbsp;&nbsp;${esc(summary(r))}</div>`);
    this.c.content(
      `<div class="utility-panel"><h2>HISTORY / LAST ${HISTORY_LENGTH}</h2>` +
      (rows.length ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 24px">${rows.join("")}</div>` : '<div class="big-readout" style="font-size:36px">NOTHING YET</div><p>Results from this session appear here, newest first.</p>') +
      "</div>");
  }

  // ---- state changes -----------------------------------------------------
  save() {
    try { this.c.saveProgress({ schema: 1, ...this.cfg })?.catch?.(() => {}); } catch (error) { /* progress is a convenience */ }
  }
  setConfig(change) {
    this.cfg = cleanConfig({ ...this.cfg, ...change });
    this.result = null;
    this.landedAt = null;
    this.view = "main";
    this.refocus = true;
    if (!this.dark) this.darken();
    this.save();
    this.render();
  }
  go(view) { this.refocus = true; this.view = view; this.render(); }

  render() {
    if (this.view === "history") this.historyPanel(); else this.panel(this.result, null);
    this.actions();
  }
  actions() {
    const cfg = this.cfg, back = { id: "back", label: "BACK", run: () => this.go("main") };
    const home = { id: "home", label: "RETURN TO DASHBOARD", run: this.c.home };
    let list, hint = "Tap to move. Hold and release to choose.";
    if (this.rolling) {
      list = [{ id: "skip", label: "SHOW RESULT NOW", run: () => this.skip() }];
      hint = "The wheel is turning. Hold to show the result at once.";
    } else switch (this.view) {
      case "history": list = [back, home]; hint = "Newest first. The last ten results of this session."; break;
      case "mode":
        list = MODES.map((m) => ({ id: "mode-" + m, label: (m === cfg.mode ? "● " : "") + MODE_NAMES[m], run: () => this.setConfig({ mode: m }) }));
        list.push(back); break;
      case "dice":
        list = [{ id: "die-type", label: `DIE TYPE / D${cfg.die}`, run: () => this.go("die") },
          { id: "die-count", label: `NUMBER OF DICE / ${cfg.count}`, run: () => this.go("count") }, back]; break;
      case "die":
        list = DICE.map((d) => ({ id: "die-" + d, label: (d === cfg.die ? "● " : "") + "D" + d, run: () => this.setConfig({ die: d }) }));
        list.push(back); break;
      case "count":
        list = [1, 2, 3, 4, 5, 6].map((n) => ({ id: "count-" + n, label: (n === cfg.count ? "● " : "") + n + (n === 1 ? " DIE" : " DICE"), run: () => this.setConfig({ count: n }) }));
        list.push(back); break;
      case "range":
        list = NUMBER_PRESETS.map((m) => ({ id: "range-" + m, label: (m === cfg.max ? "● " : "") + "1 TO " + m, run: () => this.setConfig({ max: m }) }));
        list.push({ id: "range-custom", label: "CHOOSE UPPER BOUND", run: () => this.go("scale") }, back); break;
      case "scale":
        list = NUMBER_SCALES.map((s) => ({ id: "scale-" + s, label: s === 1 ? "UNITS / 2 TO 7" : "x" + s + " / " + 1 * s + " TO " + 7 * s,
          run: () => { this.numberScale = s; this.go("figure"); } }));
        list.push(back); break;
      case "figure": {
        const s = this.numberScale;
        list = [1, 2, 3, 4, 5, 6, 7].filter((n) => n * s >= 2).map((n) => ({ id: "fig-" + n, label: `UP TO ${n * s}`, run: () => this.setConfig({ max: n * s }) }));
        list.push(back); break;
      }
      case "decide":
        list = [{ id: "yesno", label: (cfg.decideKind === "yesno" ? "● " : "") + "YES / NO / ASK AGAIN", run: () => this.setConfig({ decideKind: "yesno" }) },
          { id: "pick", label: (cfg.decideKind === "pick" ? "● " : "") + "PICK ONE OF N", run: () => this.go("pickn") }, back]; break;
      case "pickn":
        list = [2, 3, 4, 5, 6, 7, 8].map((n) => ({ id: "pickn-" + n, label: (n === cfg.pickN && cfg.decideKind === "pick" ? "● " : "") + "ONE OF " + n, run: () => this.setConfig({ decideKind: "pick", pickN: n }) }));
        list.push(back); break;
      default: {
        const change = {
          coin: { id: "reset", label: "RESET TALLY", run: () => { this.tally = { HEADS: 0, TAILS: 0 }; this.render(); } },
          dice: { id: "change", label: "CHANGE DICE / " + describe(cfg), run: () => this.go("dice") },
          number: { id: "change", label: "CHANGE RANGE / 1-" + cfg.max, run: () => this.go("range") },
          decide: { id: "change", label: "CHANGE QUESTION / " + describe(cfg), run: () => this.go("decide") },
        }[cfg.mode];
        list = [{ id: "roll", label: (this.result ? "ROLL AGAIN / " : "ROLL / ") + describe(cfg), run: () => this.roll() }, change,
          { id: "mode", label: "CHANGE MODE / " + MODE_NAMES[cfg.mode], run: () => this.go("mode") },
          { id: "history", label: "HISTORY / LAST " + HISTORY_LENGTH, run: () => this.go("history") }, home];
      }
    }
    // The host keeps focus by action id or index; park it on the first item first, so that
    // every new list (ROLL on the main one) starts focused on its first action.
    if (this.refocus && !this.rolling) this.c.actions([list[0]]);
    this.refocus = false;
    this.c.actions(list);
    this.c.hint(hint);
  }

  // ---- host hooks --------------------------------------------------------
  tick() {
    if (this.rolling || this.dark || this.landedAt == null) return;
    if ((this.now() - this.landedAt) / 1000 > IDLE_SECONDS) this.darken();
  }
  pause() {
    if (this.rolling) this.land(true);
    this.stopLoop();
    this.dark = true;
    this.c.leds(lightsOff());
  }
  resume() { this.render(); }
  cancel() {}
  dispose() {
    this.disposed = true;
    this.rolling = false;
    this.stopLoop();
    this.c.leds(lightsOff());
  }
}
