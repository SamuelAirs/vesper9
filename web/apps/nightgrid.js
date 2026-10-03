// NIGHT GRID: a ten-shift neighborhood restoration puzzle for the one-button VESPER-9.
// Fictional resource units, not a simulation of electrical operating procedures.
// Controls (after-hours-kit.js): TAP moves to the next card, HOLD and RELEASE picks it.
// Lamps 1-3 are the three districts (green full power, amber covered by stored water, red short) for
// the card you are on; lamp 4, when the node has one, is the battery.
import { C, text, line, circle } from "../engine/draw.js";
import { clamp } from "../engine/math.js";
import { LAMP, lamps, dim } from "../engine/lightshow.js";
import { AppGuard } from "../engine/input.js";
import { LampBus, LOCKOUT } from "./game-kit.js";
import { HOLD, lampCount, withFourth, holdFraction, drawGuide, drawPressHelp } from "./after-hours-kit.js";

export const NIGHTGRID_SHIFTS = 10;
// A new stage ignores presses this long, so the press that ended the last stage cannot carry over.
const READY = 0.4;
const REPORT_READY = 1.5;
const NAMES = ["PORCHES", "MAIN STREET", "WATER TOWER"];
const SHORT = ["PORCHES", "MAIN ST", "TOWER"];
const POLICIES = [
  { name: "PORCHES / BOOST", first: 0, reserve: 2, detail: "Homes first. Use up to 2 battery." },
  { name: "MAIN ST / BALANCE", first: 1, reserve: 1, detail: "Shops first. Use up to 1 battery." },
  { name: "TOWER / CONSERVE", first: 2, reserve: 0, detail: "Tower first. Preserve the battery." },
];
const EVENTS = [
  { title: "PORCH LIGHTS", need: [2, 2, 2], supply: 7 },
  { title: "SUPPER RUSH", need: [3, 3, 2], supply: 8 },
  { title: "LAUNDRY NIGHT", need: [4, 2, 3], supply: 8 },
  { title: "THE LATE DINER", need: [2, 5, 3], supply: 8 },
  { title: "TOWER REFILL", need: [3, 3, 5], supply: 8 },
  { title: "MOVIE MARATHON", need: [5, 4, 3], supply: 9 },
  { title: "RAIN ON THE ROOFS", need: [4, 3, 5], supply: 8 },
  { title: "BAKERS CLOCK IN", need: [3, 6, 4], supply: 9 },
  { title: "MORNING COFFEE", need: [5, 5, 4], supply: 9 },
  { title: "DAYBREAK", need: [5, 5, 5], supply: 10 },
];

const bounded = (v, max = 1000000000) => Number.isFinite(v) ? clamp(Math.floor(v), 0, max) : 0;
const cloneGrid = (grid) => ({ ...grid, cap: grid.cap.slice(), links: grid.links.slice(), efficiency: grid.efficiency.slice(), goodwill: grid.goodwill.slice(), outages: grid.outages.slice() });
const total = (a) => a.reduce((sum, n) => sum + n, 0);
const sign = (n) => n > 0 ? "+" + n : String(n);

export function migrateSave(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const l = r.last && typeof r.last === "object" ? r.last : {};
  return {
    schema: 1,
    guided: r.guided === true,
    runs: bounded(r.runs),
    milestone: bounded(r.milestone, NIGHTGRID_SHIFTS),
    victories: bounded(r.victories),
    bestChain: bounded(r.bestChain, NIGHTGRID_SHIFTS),
    last: {
      score: bounded(l.score), shifts: bounded(l.shifts, NIGHTGRID_SHIFTS),
      service: bounded(l.service, 100), chain: bounded(l.chain, NIGHTGRID_SHIFTS),
      result: ["NEIGHBORHOOD HERO", "LIGHTS RESTORED", "ROUGH NIGHT"].includes(l.result) ? l.result : "",
    },
  };
}

export const GUIDE = [
  { head: "KEEP THE LIGHTS ON", lines: ["Three districts need power every shift: the porches, Main Street and the water tower.",
    "Ten shifts until dawn. Keep the neighbors happy (goodwill) to win.", "Each lamp is one district, and shows how it will do with the card you are on."],
    lamps: [{ rgb: LAMP.green, label: "PORCHES", sub: "green: full power" }, { rgb: LAMP.amber, label: "MAIN STREET", sub: "amber: water covers it" },
      { rgb: LAMP.red, label: "WATER TOWER", sub: "red: short of power" }, { rgb: LAMP.cyan, label: "BATTERY", sub: "brighter is fuller" }] },
  { head: "EACH SHIFT, TWO PICKS", lines: ["First a CREW JOB: repair a feeder, an upgrade, or fetch kits. Kits pay for work.",
    "Then ROUTING: which district gets power first, and how much battery to spend.", "TAP moves between the three cards. HOLD, then RELEASE, picks one.",
    "The board and the lamps preview exactly what each card will do."] },
  { head: "WINNING THE NIGHT", lines: ["A district left short loses goodwill. Full service wins it back.",
    "Lit shops donate repair kits. Stored water covers a short tower.", "At dawn you need 12 goodwill in total, and no district at zero.",
    "Take your time: nothing happens until you pick. GAME GUIDE in the system menu shows this again."] },
];

// The best a crew job can lead to tonight: the routing that keeps the most districts whole.
export function outlook(plan) {
  if (!plan.applied) return null;
  return [0, 1, 2].map((policy) => dispatch(plan.state, plan.event, policy))
    .sort((a, b) => b.safe - a.safe || total(a.harm) - total(b.harm) || b.points - a.points)[0];
}

export function newGrid() {
  return { cap: [2, 3, 2], links: [1, 0], efficiency: [0, 0, 0], battery: 3, batteryMax: 5,
    kits: 3, goodwill: [6, 6, 6], outages: [0, 0, 0], water: 2, shopStreak: 0,
    score: 0, chain: 0, bestChain: 0, served: 0, requested: 0, restored: 0 };
}

export function makeForecasts(rng) {
  return EVENTS.map((event, i) => {
    const need = event.need.slice();
    // The first two shifts teach the board. Later variation is visible one shift ahead.
    if (i >= 2) { const district = rng.int(0, 2); need[district] = Math.max(2, need[district] + rng.int(-1, 1)); }
    return { title: event.title, need, supply: event.supply + (i >= 3 ? rng.int(-1, 0) : 0) };
  });
}

export function needsFor(grid, event) {
  return event.need.map((n, i) => Math.max(1, n - grid.efficiency[i]));
}

// Routing uses discrete units through three limited feeders and the two neighbor ties.
// Each unit has a real source feeder; a tie cannot create power or feeder capacity.
// The priority policy gets first claim on spare capacity, after one unit per district.
export function dispatch(grid, event, policyIndex) {
  const state = cloneGrid(grid);
  const policy = POLICIES[clamp(Math.floor(policyIndex), 0, 2)];
  const need = needsFor(grid, event);
  const supplied = [0, 0, 0], feederUsed = [0, 0, 0], tieUsed = [0, 0], tieFlow = [0, 0];
  let gridLeft = Math.max(0, event.supply), batteryUsed = 0;
  const order = [policy.first, (policy.first + 1) % 3, (policy.first + 2) % 3];
  const pathFor = (from, to) => {
    if (from === to) return [];
    return from === 0 && to === 2 || from === 2 && to === 0 ? [0, 1] : [Math.min(from, to)];
  };
  const send = (to) => {
    if (gridLeft <= 0 && (batteryUsed >= policy.reserve || batteryUsed >= grid.battery)) return false;
    const donors = [to, ...[0, 1, 2].filter((i) => i !== to).sort((a, b) => Math.abs(a - to) - Math.abs(b - to))];
    for (const from of donors) {
      if (feederUsed[from] >= grid.cap[from]) continue;
      const path = pathFor(from, to);
      if (path.some((edge) => tieUsed[edge] >= grid.links[edge])) continue;
      feederUsed[from]++; supplied[to]++;
      for (const edge of path) { tieUsed[edge]++; tieFlow[edge] += from < to ? 1 : -1; }
      if (gridLeft > 0) gridLeft--; else batteryUsed++;
      return true;
    }
    return false;
  };
  for (const i of order) if (need[i] > 0) send(i);
  for (const i of order) while (supplied[i] < need[i] && send(i)) { /* one integral routed unit */ }
  const missing = need.map((n, i) => n - supplied[i]);
  const buffered = Math.min(grid.water, missing[2]);
  const harm = missing.slice(); harm[2] -= buffered;
  state.water = missing[2] ? grid.water - buffered : Math.min(3, grid.water + 1);
  const charged = Math.min(2, gridLeft, grid.batteryMax - grid.battery + batteryUsed);
  state.battery = grid.battery - batteryUsed + charged;
  const goodwillDelta = harm.map((n, i) => {
    const next = clamp(grid.goodwill[i] + (n ? -2 * n - (grid.outages[i] > 0 ? 1 : 0) : 1), 0, 8);
    state.goodwill[i] = next; state.outages[i] = n ? grid.outages[i] + 1 : 0;
    return next - grid.goodwill[i];
  });
  const safe = harm.filter((n) => n === 0).length;
  state.chain = safe === 3 ? grid.chain + 1 : 0;
  state.bestChain = Math.max(grid.bestChain, state.chain);
  state.shopStreak = missing[1] === 0 ? grid.shopStreak + 1 : 0;
  const earnedKit = state.shopStreak > 0 && state.shopStreak % 2 === 0 && state.kits < 5 ? 1 : 0;
  state.kits += earnedKit;
  const points = total(supplied) * 40 + safe * 80 + state.chain * 75;
  state.score += points; state.served += total(need) - total(harm); state.requested += total(need);
  return { state, need, supplied, missing, harm, buffered, safe, feederUsed, tieUsed, tieFlow,
    batteryUsed, charged, earnedKit, goodwillDelta, points, policyIndex, supply: event.supply };
}

export function crewChoices(grid, forecasts, shift) {
  const upcoming = forecasts.slice(shift, shift + 3);
  const pressure = [0, 1, 2].map((i) => Math.max(...upcoming.map((e) => needsFor(grid, e)[i])) - grid.cap[i]);
  const repairs = [0, 1, 2].filter((i) => grid.cap[i] < 5).sort((a, b) => pressure[b] - pressure[a] || a - b);
  const repair = repairs.length
    ? { type: "repair", target: repairs[0], cost: 1, name: "REPAIR " + SHORT[repairs[0]], detail: "Feeder capacity +1, permanently.", benefit: "CAP " + grid.cap[repairs[0]] + " > " + (grid.cap[repairs[0]] + 1) }
    : { type: "trailer", cost: 2, name: "RESERVE TRAILER", detail: "Battery ceiling +2; charge +1.", benefit: "BATTERY CAP +2" };
  const smart = [0, 1, 2].filter((i) => grid.efficiency[i] === 0).sort((a, b) => total(upcoming.map((e) => e.need[b])) - total(upcoming.map((e) => e.need[a])) || a - b);
  const edge = grid.links[0] < grid.links[1] ? 0 : 1;
  let upgrade;
  if ((shift % 2 === 0 && smart.length) || grid.links.every((n) => n >= 2) && smart.length) {
    upgrade = { type: "smart", target: smart[0], cost: 2, name: "SMART " + SHORT[smart[0]], detail: "This district needs 1 less forever.", benefit: "DEMAND -1 / ALL SHIFTS" };
  } else if (grid.links[edge] < 2) {
    upgrade = { type: "link", target: edge, cost: 1, name: "TIE " + (edge === 0 ? "PORCH / MAIN" : "MAIN / TOWER"), detail: "Share 1 more spare feeder unit.", benefit: "TIE " + grid.links[edge] + " > " + (grid.links[edge] + 1) };
  } else {
    upgrade = { type: "trailer", cost: 2, name: "RESERVE TRAILER", detail: "Battery ceiling +2; charge +1.", benefit: "BATTERY CAP +2" };
  }
  const supply = grid.kits < 5
    ? { type: "supply", cost: 0, name: "SUPPLY RUN", detail: "Fetch 2 kits; truck uses 1 power now.", benefit: "KITS +" + Math.min(2, 5 - grid.kits) + " / POWER -1" }
    : { type: "charge", cost: 0, name: "CHARGE RESERVE", detail: "Store 2 charge; use 2 power now.", benefit: "BATTERY +" + Math.min(2, grid.batteryMax - grid.battery) + " / POWER -2" };
  return [repair, upgrade, supply].map((choice) => ({ ...choice, available: grid.kits >= choice.cost && (choice.type !== "trailer" || grid.batteryMax < 9) }));
}

export function applyCrew(grid, event, choice) {
  const state = cloneGrid(grid), nextEvent = { ...event, need: event.need.slice() };
  if (!choice.available || state.kits < choice.cost) return { state, event: nextEvent, applied: false };
  state.kits -= choice.cost;
  if (choice.type === "repair") { state.cap[choice.target] = Math.min(5, state.cap[choice.target] + 1); state.restored++; }
  if (choice.type === "smart") state.efficiency[choice.target] = 1;
  if (choice.type === "link") state.links[choice.target] = Math.min(2, state.links[choice.target] + 1);
  if (choice.type === "trailer") { state.batteryMax = Math.min(9, state.batteryMax + 2); state.battery = Math.min(state.batteryMax, state.battery + 1); }
  if (choice.type === "supply") { state.kits = Math.min(5, state.kits + 2); nextEvent.supply = Math.max(0, nextEvent.supply - 1); }
  if (choice.type === "charge") { state.battery = Math.min(state.batteryMax, state.battery + 2); nextEvent.supply = Math.max(0, nextEvent.supply - 2); }
  return { state, event: nextEvent, applied: true };
}

function box(g, x, y, w, h, border = C.line, fill = C.dark) {
  g.fillStyle = fill; g.fillRect(x, y, w, h); g.strokeStyle = border; g.lineWidth = 1.5; g.strokeRect(x, y, w, h);
}

function building(g, index, x, y, color, lit = true) {
  const ink = color || C.muted;
  if (index === 0) {
    for (let a = 0; a < 2; a++) {
      const xx = x + a * 31;
      line(g, xx - 15, y - 13, xx, y - 28, ink, 2); line(g, xx, y - 28, xx + 15, y - 13, ink, 2);
      box(g, xx - 12, y - 13, 24, 28, ink, C.bg);
      g.fillStyle = lit ? C.amber : C.line; g.fillRect(xx - 7, y - 7, 6, 7); g.fillRect(xx + 3, y - 7, 6, 7);
      g.fillStyle = ink; g.fillRect(xx - 3, y + 5, 6, 10);
    }
  } else if (index === 1) {
    box(g, x - 13, y - 24, 55, 39, ink, C.bg);
    line(g, x - 16, y - 25, x + 45, y - 25, ink, 3);
    for (let a = 0; a < 4; a++) { g.fillStyle = lit ? C.amber : C.line; g.fillRect(x - 7 + a * 12, y - 12, 8, 12); }
    text(g, "OPEN", x + 14, y + 8, 10, lit ? C.cyan : C.line, "center");
  } else {
    box(g, x - 6, y - 29, 40, 23, ink, C.bg);
    line(g, x - 9, y - 29, x + 14, y - 37, ink, 2); line(g, x + 14, y - 37, x + 37, y - 29, ink, 2);
    line(g, x, y - 6, x - 8, y + 18, ink, 2); line(g, x + 28, y - 6, x + 36, y + 18, ink, 2);
    line(g, x - 3, y + 5, x + 31, y + 5, ink, 1);
    g.fillStyle = lit ? C.cyan : C.line; g.fillRect(x, y - 22, 28, 10);
  }
}

export class NightGrid {
  constructor(ctx) {
    this.c = ctx;
    this.lamps = new LampBus(ctx);
    this.sv = migrateSave(ctx.progress?.());
    this.t = 0; this.phase = "title"; this.stage = "crew"; this.grid = newGrid();
    this.shift = 0; this.forecasts = []; this.eventNow = null; this.choices = []; this.previews = []; this.outlooks = [];
    this.cursor = 0; this.stageAt = 0; this.guide = -1;
    this.held = false; this.pressAt = 0; this.startedAt = 0; this.overAt = 0;
    this.lastDispatch = null; this.lastWork = ""; this.result = ""; this.finalScore = 0;
    this.c.hint("Ten shifts. Pick a crew job, then route power. Tap moves between cards; hold and release picks. Press to begin.");
    this.guard = new AppGuard(this, ctx);
  }

  start() {
    this.phase = "play"; this.grid = newGrid(); this.shift = 0;
    this.forecasts = makeForecasts(this.c.rng); this.startedAt = this.t; this.lastDispatch = null;
    this.result = ""; this.finalScore = 0; this.lastWork = "";
    this.beginShift();
  }

  beginShift() {
    this.eventNow = { ...this.forecasts[this.shift], need: this.forecasts[this.shift].need.slice() };
    this.choices = crewChoices(this.grid, this.forecasts, this.shift);
    this.previews = this.choices.map((choice) => applyCrew(this.grid, this.eventNow, choice));
    this.outlooks = this.previews.map(outlook);
    this.setStage("crew");
  }

  setStage(stage) {
    this.stage = stage; this.stageAt = this.t; this.cursor = 0;
    this.c.hint(stage === "crew"
      ? "Step 1: pick a crew job. Tap moves between cards; hold and release picks. The lamps show each district's best case."
      : stage === "route"
        ? "Step 2: pick how power is shared. Lamps: green full, amber covered by water, red short."
        : "Read the shift report. Press when ready for the next shift.");
  }

  activeIndex() { return this.cursor; }

  down() {
    this.guard.mark();
    if (this.held) return;
    this.held = true; this.pressAt = this.t;
  }

  up(e = {}) {
    this.guard.release();
    if (!this.held) return;
    this.held = false;
    const seconds = Number.isFinite(e.durationMs) ? e.durationMs / 1000 : this.t - this.pressAt;
    this.press(seconds >= HOLD);
  }

  // One finished press: a tap (long = false) or a hold that was released.
  press(long) {
    if (this.guide >= 0) {
      if (!long && this.guide < GUIDE.length - 1) { this.guide++; return; }
      this.closeGuide(); return;
    }
    if (this.phase === "title") { if (this.sv.guided) this.start(); else this.guide = 0; return; }
    if (this.phase === "over") { if (this.t - this.overAt >= LOCKOUT) this.start(); return; }
    if (this.stage === "report") {
      if (this.t - this.stageAt < REPORT_READY) return;
      if (this.shift >= NIGHTGRID_SHIFTS - 1) this.end();
      else { this.shift++; this.beginShift(); }
      return;
    }
    if (this.t - this.stageAt < READY) return;
    if (!long) { this.cursor = (this.cursor + 1) % 3; this.c.tone(300 + this.cursor * 50, 0.03, "triangle"); return; }
    this.commit(this.cursor);
  }

  openGuide() { this.guide = 0; this.held = false; }
  closeGuide() {
    this.guide = -1;
    if (!this.sv.guided) { this.sv.guided = true; this.c.saveProgress(JSON.parse(JSON.stringify(this.sv)))?.catch?.(this.c.error); }
    if (this.phase === "title") this.start();
  }

  menuActions() {
    return [{ label: "GAME GUIDE", run: () => this.openGuide() }, { label: "NEW NIGHT", run: () => { this.guide = -1; this.start(); } }];
  }

  commit(index) {
    if (index < 0 || index > 2) return;
    if (this.stage === "crew") {
      const plan = this.previews[index];
      if (!plan.applied) { this.c.tone(110, 0.08, "triangle"); return; }
      this.grid = cloneGrid(plan.state); this.eventNow = { ...plan.event, need: plan.event.need.slice() };
      this.lastWork = this.choices[index].name;
      this.previews = [0, 1, 2].map((policy) => dispatch(this.grid, this.eventNow, policy));
      this.setStage("route");
      this.c.tone(340, 0.05, "triangle");
    } else if (this.stage === "route") {
      this.lastDispatch = this.previews[index]; this.grid = cloneGrid(this.lastDispatch.state);
      this.setStage("report");
      this.c.tone(this.lastDispatch.safe === 3 ? 520 : 190, 0.12, "triangle");
    }
  }

  end() {
    if (this.phase !== "play") return;
    this.phase = "over"; this.overAt = this.t; this.held = false;
    const service = Math.round(100 * this.grid.served / Math.max(1, this.grid.requested));
    const won = this.grid.goodwill.every((n) => n > 0) && total(this.grid.goodwill) >= 12;
    this.result = won ? service >= 95 ? "NEIGHBORHOOD HERO" : "LIGHTS RESTORED" : "ROUGH NIGHT";
    this.finalScore = this.grid.score + total(this.grid.goodwill) * 80 + this.grid.battery * 100 + this.grid.kits * 60;
    this.sv.runs = Math.min(1000000000, this.sv.runs + 1);
    this.sv.victories = Math.min(1000000000, this.sv.victories + (won ? 1 : 0));
    this.sv.milestone = Math.max(this.sv.milestone, this.shift + 1);
    this.sv.bestChain = Math.max(this.sv.bestChain, this.grid.bestChain);
    this.sv.last = { score: this.finalScore, shifts: this.shift + 1, service, chain: this.grid.bestChain, result: this.result };
    this.c.score(this.finalScore);
    this.c.saveProgress(JSON.parse(JSON.stringify(this.sv)))?.catch?.(this.c.error);
    this.c.hint("Ten shifts complete. Press to restore a new neighborhood.");
  }

  // What the lamps and the district boxes show: the routing on the card you are on, a crew job's
  // best routing, or the shift just finished.
  shownDispatch() {
    if (this.stage === "route") return this.previews[this.activeIndex()];
    if (this.stage === "crew") return this.outlooks[this.activeIndex()];
    return this.lastDispatch;
  }

  // Lamp 4: the battery, brighter the fuller (after the card you are on), a faint red when empty.
  batteryLamp(n) {
    if (n < 4 || this.phase !== "play") return null;
    const grid = this.shownDispatch()?.state || this.grid;
    return grid.battery ? dim(LAMP.cyan, 0.15 + 0.75 * grid.battery / grid.batteryMax) : dim(LAMP.red, 0.15);
  }

  lampPicture() {
    const n = lampCount(this.c);
    if (this.guide >= 0) return withFourth(lamps(...GUIDE[0].lamps.slice(0, 3).map((k) => dim(k.rgb, 0.55))), dim(LAMP.cyan, 0.55), n);
    if (this.phase === "title") return withFourth(lamps(dim(LAMP.green, 0.3), dim(LAMP.amber, 0.32), dim(LAMP.cyan, 0.3)), dim(LAMP.cyan, 0.2), n);
    if (this.phase === "over") return withFourth(lamps(...this.grid.goodwill.map((v) => dim(v > 0 ? LAMP.green : LAMP.red, 0.15 + 0.07 * v))), null, n);
    const shown = this.shownDispatch();
    const three = shown ? lamps(...shown.harm.map((harm, i) => dim(harm ? LAMP.red : shown.missing[i] ? LAMP.amber : LAMP.green, harm ? 0.7 : 0.45)))
      : lamps(dim(LAMP.red, 0.3), dim(LAMP.red, 0.3), dim(LAMP.red, 0.3));
    return withFourth(three, this.batteryLamp(n), n);
  }

  update(dt) {
    this.guard.tick(dt);
    this.t += dt;
    this.c.hud([["SHIFT", this.phase === "title" ? "10 TO DAWN" : (this.shift + 1) + "/10"],
      ["BATTERY", this.grid.battery + "/" + this.grid.batteryMax], ["KITS", this.grid.kits],
      ["STABLE", this.grid.chain]]);
    this.lamps.frame(dt, this.lampPicture());
  }

  draw(g) {
    if (this.guide >= 0) { drawGuide(g, "NIGHT GRID", GUIDE, this.guide, lampCount(this.c)); return; }
    g.fillStyle = C.bg; g.fillRect(0, 0, 960, 540);
    if (this.phase === "title") { this.drawTitle(g); return; }
    if (this.phase === "over") { this.drawOver(g); return; }
    text(g, "NIGHT GRID", 24, 28, 22, C.ink);
    text(g, this.eventNow.title, 480, 28, 24, C.amber, "center");
    text(g, "SHIFT " + String(this.shift + 1).padStart(2, "0") + " / 10", 936, 28, 18, C.muted, "right");
    line(g, 24, 48, 936, 48);
    this.drawBoard(g);
    if (this.stage === "report") this.drawReport(g); else this.drawChoices(g);
  }

  drawBoard(g) {
    const index = this.activeIndex();
    const planned = this.stage === "crew" ? this.previews[index] : null;
    const board = planned?.applied ? planned.state : this.grid;
    const shown = this.shownDispatch();
    const four = lampCount(this.c) === 4;
    const event = planned?.applied ? planned.event : this.eventNow;
    const need = needsFor(board, event);
    const next = this.forecasts[this.shift + 1];
    const forecastNeed = next ? needsFor(board, next) : null;
    box(g, 388, 67, 184, 54, C.cyan);
    text(g, (this.stage === "crew" ? "GRID AFTER " : "GRID ") + event.supply, 480, 84, this.stage === "crew" ? 20 : 23, C.cyan, "center");
    text(g, "BATTERY " + board.battery + "/" + board.batteryMax + (four ? "  (LAMP 4)" : ""), 480, 107, 14, C.muted, "center");
    text(g, this.stage === "crew" ? "WORK PREVIEW" : "LIVE SUPPLIES", 48, 77, 16, this.stage === "crew" ? C.amber : C.muted);
    text(g, (this.stage === "crew" ? "KITS AFTER " : "KITS ") + board.kits + "/5", 48, 103, 20, C.amber);
    text(g, next ? "NEXT GRID " + next.supply : "DAWN IS NEXT", 868, 84, 18, C.muted, "right");
    text(g, next ? next.title : "KEEP THEM GLOWING", 868, 108, 14, C.muted, "right");
    const centers = [168, 480, 792];
    line(g, 480, 121, 480, 134, C.cyan, 2);
    line(g, 168, 134, 792, 134, C.line, 2);
    for (let i = 0; i < 3; i++) {
      line(g, centers[i], 134, centers[i], 185, shown && shown.supplied[i] ? C.cyan : C.line, 2);
      box(g, centers[i] - 33, 143, 66, 25, C.line, C.bg);
      text(g, "CAP " + board.cap[i], centers[i], 156, 16, C.ink, "center");
    }
    for (let edge = 0; edge < 2; edge++) {
      const x = (centers[edge] + centers[edge + 1]) / 2;
      g.setLineDash(board.links[edge] ? [] : [5, 5]);
      line(g, centers[edge], 179, centers[edge + 1], 179, board.links[edge] ? C.cyan : C.line, board.links[edge] ? 2 : 1);
      g.setLineDash([]);
      box(g, x - 41, 168, 82, 22, C.line, C.bg);
      const flow = shown?.tieFlow[edge] || 0;
      text(g, flow ? (flow > 0 ? "> " : "< ") + Math.abs(flow) + "/" + board.links[edge] : "TIE " + board.links[edge], x, 179, 16, board.links[edge] ? C.cyan : C.muted, "center");
    }
    for (let i = 0; i < 3; i++) {
      const x = 24 + i * 312, status = shown ? shown.harm[i] ? C.red : shown.missing[i] ? C.amber : C.ink : C.ink;
      box(g, x, 194, 288, 127, status === C.ink ? C.line : status);
      text(g, "LAMP " + (i + 1) + "  " + NAMES[i], x + 144, 212, 18, status, "center");
      building(g, i, x + 39, 262, status, !shown || shown.harm[i] === 0);
      text(g, shown ? shown.supplied[i] + " / " + need[i] : "NEED " + need[i], x + 172, 251, 27, status, "center");
      const verdict = shown ? shown.harm[i] ? "SHORT " + shown.harm[i] : shown.missing[i] ? "WATER COVERS IT" : "FULL POWER" : "NOT ENOUGH KITS";
      text(g, shown && this.stage === "crew" ? "AT BEST: " + verdict : verdict, x + 175, 275, 15, shown ? status : C.red, "center");
      text(g, "NEXT " + (forecastNeed ? forecastNeed[i] : "-") + "  GOODWILL " + (shown ? shown.state.goodwill[i] : board.goodwill[i]) + "/8", x + 144, 300, 17, C.muted, "center");
    }
    text(g, this.stage === "crew" ? "STEP 1 OF 2: PICK TONIGHT'S CREW JOB" : this.stage === "route" ? "STEP 2 OF 2: PICK HOW POWER IS SHARED" : "SHIFT COMPLETE", 24, 338, 15, C.cyan);
    text(g, "SHOP STREAK " + (board.shopStreak % 2) + "/2  |  WATER " + board.water + "/3", 936, 338, 17, C.muted, "right");
  }

  drawChoices(g) {
    const selected = this.activeIndex();
    for (let i = 0; i < 3; i++) {
      const x = 24 + i * 312, active = i === selected;
      const available = this.stage === "route" || this.choices[i].available;
      const color = available ? active ? C.amber : C.muted : C.red;
      box(g, x, 358, 288, 108, active ? color : C.line, active ? "#253221" : C.dark);
      if (active) { g.fillStyle = color; g.fillRect(x, 358, 5, 108); }
      if (this.stage === "crew") {
        const choice = this.choices[i];
        text(g, choice.name, x + 144, 380, 17, color, "center");
        text(g, choice.cost ? (available ? "USE " : "NEED ") + choice.cost + " KIT" + (choice.cost > 1 ? "S" : "") : "NO KIT COST", x + 144, 410, 18, C.ink, "center");
        text(g, choice.benefit, x + 144, 439, 17, C.muted, "center");
      } else {
        const preview = this.previews[i];
        text(g, POLICIES[i].name, x + 144, 380, 17, color, "center");
        text(g, "SAFE " + preview.safe + "/3   BATT " + sign(preview.charged - preview.batteryUsed), x + 144, 410, 18, C.ink, "center");
        text(g, "GOODWILL " + preview.goodwillDelta.map(sign).join(" / "), x + 144, 439, 17, preview.safe === 3 ? C.muted : C.red, "center");
      }
      if (active) { g.fillStyle = C.amber; g.fillRect(x + 1, 462, 286 * holdFraction(this), 3); }
    }
    const detail = this.stage === "crew" ? this.choices[selected].detail : POLICIES[selected].detail + "  +" + this.previews[selected].points + " pts";
    text(g, detail, 480, 487, 18, C.ink, "center");
    drawPressHelp(g, this, 520, this.stage === "crew" ? "DO THIS JOB" : "ROUTE POWER");
  }

  drawReport(g) {
    const r = this.lastDispatch;
    box(g, 24, 358, 912, 130, r.safe === 3 ? C.cyan : C.amber);
    text(g, r.safe === 3 ? "THE NEIGHBORHOOD KEEPS GLOWING" : "A TOUGH CHOICE. ANOTHER SHIFT TO MAKE IT RIGHT.", 480, 385, 22, r.safe === 3 ? C.cyan : C.amber, "center");
    text(g, "+" + r.points + " POINTS    STABLE CHAIN " + this.grid.chain + "    BATTERY " + sign(r.charged - r.batteryUsed), 480, 421, 20, C.ink, "center");
    const detail = r.earnedKit ? "Main Street stayed lit: the shops donated a repair kit." : r.buffered ? "Stored water covered " + r.buffered + " missing tower power. Refill it soon." : this.shift < 3 ? "Dawn goal: 12 total goodwill, with no district at zero." : "All three safe grows a bonus. Repeated shortages hurt goodwill.";
    text(g, detail, 480, 456, 17, C.muted, "center");
    text(g, this.t - this.stageAt >= REPORT_READY ? this.shift === 9 ? "PRESS FOR YOUR DAWN REPORT" : "PRESS WHEN READY FOR SHIFT " + (this.shift + 2) : "SHIFT RECORDED", 480, 520, 18, C.amber, "center");
  }

  drawTitle(g) {
    text(g, "VESPER MUNICIPAL / NIGHT DESK", 480, 62, 16, C.muted, "center");
    text(g, "NIGHT GRID", 480, 133, 62, C.ink, "center");
    text(g, "Keep the neighborhood glowing.", 480, 187, 24, C.cyan, "center");
    const xx = [250, 465, 680];
    line(g, 266, 303, 696, 303, C.cyan, 2);
    for (let i = 0; i < 3; i++) {
      line(g, xx[i] + 15, 278, xx[i] + 15, 307, C.cyan, 2);
      building(g, i, xx[i], 259, C.ink, true);
      circle(g, xx[i] + 15, 303, 5, C.amber, true);
      text(g, NAMES[i], xx[i] + 15, 333, 16, C.muted, "center");
    }
    text(g, "REPAIR FEEDERS. SHARE POWER. SAVE THE BATTERY.", 480, 392, 21, C.ink, "center");
    text(g, "10 shifts. Finish with 12 goodwill; nobody at zero.", 480, 425, 19, C.muted, "center");
    text(g, "TAP: NEXT CARD    HOLD + RELEASE: PICK IT", 480, 461, 18, C.cyan, "center");
    text(g, this.sv.guided ? "PRESS TO TAKE THE NIGHT SHIFT" : "PRESS TO LEARN HOW TO PLAY", 480, 510, 22, C.amber, "center");
  }

  drawOver(g) {
    text(g, "DAWN / DISPATCH COMPLETE", 480, 56, 18, C.muted, "center");
    text(g, this.result, 480, 115, 38, this.result === "ROUGH NIGHT" ? C.amber : C.cyan, "center");
    text(g, this.finalScore, 480, 183, 56, C.ink, "center");
    text(g, "SERVICE " + this.sv.last.service + "%  |  BEST STABLE CHAIN " + this.grid.bestChain, 480, 239, 20, C.muted, "center");
    for (let i = 0; i < 3; i++) {
      const x = 180 + i * 300;
      building(g, i, x - 15, 315, this.grid.goodwill[i] > 0 ? C.ink : C.red, this.grid.goodwill[i] > 0);
      text(g, NAMES[i], x, 362, 18, C.ink, "center");
      text(g, "GOODWILL " + this.grid.goodwill[i] + "/8", x, 392, 18, this.grid.goodwill[i] > 3 ? C.cyan : C.amber, "center");
    }
    text(g, this.result === "ROUGH NIGHT" ? "Need 12 total goodwill, with every district above zero." : "You kept the town together until daylight.", 480, 453, 18, C.muted, "center");
    text(g, "BEST " + this.c.best() + "   /   PRESS FOR A NEW NIGHT", 480, 512, 20, C.amber, "center");
  }

  cancel() { this.guard.rewind(); this.lamps.clear(); this.held = false; this.c.synth?.stopTone?.(); }
  pause() { this.guard.settle(); this.lamps.sleep(); this.held = false; this.c.synth?.stopTone?.(); }
  resume() { this.lamps.wake(); }
  dispose() { this.guard.settle(); this.lamps.sleep(); this.c.synth?.stopTone?.(); }
}
