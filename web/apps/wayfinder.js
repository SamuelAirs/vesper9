import { C, text, line } from "../engine/draw.js";
import { Random, clamp } from "../engine/math.js";
import { AppGuard } from "../engine/input.js";
import { LAMP, dim } from "../engine/lightshow.js";
import { drawRowList, drawNoticePanel } from "./reader-kit.js";

// WAYFINDER: chart a connected beacon field, collect optional research and reach
// the rescue station. No reaction timer: decisions spend supplies, never time.
export const DIRECTIONS = ["NORTH", "EAST", "SOUTH", "WEST"];
const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
const EQUIPMENT = ["standard", "scanner", "porter", "pathfinder"];
const RANKS = ["SCOUT", "SURVEYOR", "NAVIGATOR"];
const unique = (a, n) => [...new Set((Array.isArray(a) ? a : []).filter((x) => Number.isInteger(x) && x >= 0 && x < n))].slice(0, n);
export const rankFor = (knowledge) => knowledge >= 40 ? 2 : knowledge >= 12 ? 1 : 0;
export const capacity = (tier, gear) => 12 + tier * 2 + (gear === "porter" ? 4 : 0);
export function neighbour(index, dir, size) {
  const x = index % size + DX[dir], y = Math.floor(index / size) + DY[dir];
  return x >= 0 && y >= 0 && x < size && y < size ? y * size + x : -1;
}
export function routeBetween(map, start, goal) {
  const costs = Array(map.size * map.size).fill(Infinity), before = Array(costs.length).fill(-1), done = new Set();
  costs[start] = 0;
  while (done.size < costs.length) {
    let at = -1;
    for (let i = 0; i < costs.length; i++) if (!done.has(i) && (at < 0 || costs[i] < costs[at])) at = i;
    if (at < 0 || !Number.isFinite(costs[at])) return [];
    if (at === goal) {
      const path = [goal];
      while (path[0] !== start) path.unshift(before[path[0]]);
      return path;
    }
    done.add(at);
    for (let d = 0; d < 4; d++) if (map.edges[at] & (1 << d)) {
      const to = neighbour(at, d, map.size), cost = costs[at] + map.terrain[to];
      if (cost < costs[to]) { costs[to] = cost; before[to] = at; }
    }
  }
  return [];
}
export function makeField(seed, tier = 0) {
  const rng = new Random(seed), size = 7 + clamp(tier | 0, 0, 2), n = size * size;
  const edges = Array(n).fill(0), terrain = Array.from({ length: n }, () => rng.int(1, 3));
  const link = (at, d) => { const to = neighbour(at, d, size); edges[at] |= 1 << d; edges[to] |= 1 << ((d + 2) % 4); };
  // A spanning tree guarantees connectivity; extra corridors provide real loops
  // and alternate routes, rather than a single mandatory maze corridor.
  const seen = new Set([0]), stack = [0];
  while (stack.length) {
    const at = stack.at(-1), choices = [0, 1, 2, 3].filter((d) => { const to = neighbour(at, d, size); return to >= 0 && !seen.has(to); });
    if (!choices.length) { stack.pop(); continue; }
    const d = choices[rng.int(0, choices.length - 1)], to = neighbour(at, d, size);
    link(at, d); seen.add(to); stack.push(to);
  }
  const missing = [];
  for (let at = 0; at < n; at++) for (const d of [1, 2]) if (neighbour(at, d, size) >= 0 && !(edges[at] & (1 << d))) missing.push([at, d]);
  for (let i = 0; i < Math.min(missing.length, Math.floor(n / 4)); i++) {
    const pick = rng.int(i, missing.length - 1); [missing[i], missing[pick]] = [missing[pick], missing[i]];
    link(...missing[i]);
  }
  const start = (size - 1) * size + Math.floor(size / 2), goal = Math.floor(size / 2);
  const map = { seed, size, edges, terrain, start, goal, route: [], beacons: [], caches: [], relics: [] };
  map.route = routeBetween(map, start, goal);
  for (let i = 1; i <= 3 + tier; i++) map.beacons.push(map.route[Math.ceil((map.route.length - 1) * i / (3 + tier))]);
  map.beacons = unique(map.beacons, n);
  // Under actual destination terrain costs, every guaranteed-route segment
  // costs at most six. Each cache returns six, so a twelve-charge battery is
  // enough to visit every beacon and the exit without taking a research detour.
  let spent = 0;
  for (let i = 1; i < map.route.length; i++) {
    const at = map.route[i];
    if (spent + terrain[at] > 6) { map.caches.push(map.route[i - 1]); spent = 0; }
    spent += terrain[at];
    if (spent === 6) { map.caches.push(at); spent = 0; }
  }
  map.relics = Array.from({ length: n }, (_, i) => i).filter((i) => !map.route.includes(i) && rng.next() < 0.24);
  if (!map.relics.length) map.relics = [Array.from({ length: n }, (_, i) => i).find((i) => !map.route.includes(i))].filter(Number.isInteger);
  return map;
}

export function migrateWayfinder(raw) {
  const o = raw && typeof raw === "object" ? raw : {}, int = (v, hi, fallback = 0) => Number.isInteger(v) && v >= 0 && v <= hi ? v : fallback;
  const save = { v: 1, knowledge: int(o.knowledge, 100000), runs: int(o.runs, 100000), rescued: int(o.rescued, 100000), gear: EQUIPMENT.includes(o.gear) ? o.gear : "standard", active: null };
  const rank = rankFor(save.knowledge);
  if (!rank || save.gear === "pathfinder" && rank < 2) save.gear = "standard";
  const a = o.active;
  if (a && Number.isInteger(a.seed) && a.seed > 0 && a.seed <= 0xffffffff && Number.isInteger(a.tier) && a.tier >= 0 && a.tier <= rank) {
    const field = makeField(a.seed, a.tier), n = field.size * field.size;
    const gear = EQUIPMENT.includes(a.gear) && (a.gear !== "pathfinder" || rank >= 2) && (a.gear === "standard" || rank >= 1) ? a.gear : "standard";
    save.active = { seed: a.seed, tier: a.tier, gear, at: int(a.at, n - 1, field.start), energy: int(a.energy, capacity(a.tier, gear), capacity(a.tier, gear)),
      steps: int(a.steps, 100000), visited: unique(a.visited, n), taken: unique(a.taken, n), relics: unique(a.relics, n).filter((x) => field.relics.includes(x)),
      beacons: unique(a.beacons, n).filter((x) => field.beacons.includes(x)), trail: (Array.isArray(a.trail) ? a.trail : []).filter((x) => Number.isInteger(x) && x >= 0 && x < n).slice(-32), scanned: unique(a.scanned, n) };
    if (!save.active.visited.includes(save.active.at)) save.active.visited.push(save.active.at);
  }
  if (o.last && typeof o.last === "object") save.last = { outcome: o.last.outcome === "rescued" ? "rescued" : "stranded", tier: int(o.last.tier, 2), steps: int(o.last.steps, 100000), relics: int(o.last.relics, 81), score: int(o.last.score, 1000000) };
  return save;
}

export class Wayfinder {
  constructor(ctx) {
    this.c = ctx; this.save = migrateWayfinder(ctx.progress?.());
    this.field = this.save.active ? makeField(this.save.active.seed, this.save.active.tier) : null;
    this.phase = "home"; this.cursor = 0; this.tier = rankFor(this.save.knowledge);
    this.held = false; this.hold = 0; this.t = 0; this.dirty = false; this.message = "Chart the field. Light every beacon. Find the rescue station.";
    this.guard = new AppGuard(this, ctx);
    ctx.daily?.("Daily run: light every beacon and reach rescue in any region.");
  }
  rows() {
    const r = this.save.active, rank = rankFor(this.save.knowledge);
    if (this.phase === "home") return [
      ...(r ? [{ label: "CONTINUE EXPEDITION", sub: r.beacons.length + " BEACONS · " + r.energy + " CHARGE", run: () => this.go("field") }] : []),
      { label: "NEW EXPEDITION · " + RANKS[this.tier], sub: (3 + this.tier) + " BEACONS · OPTIONAL RESEARCH DETOURS", run: () => this.go(r ? "replace" : "brief") },
      ...(rank ? [{ label: "REGION · " + RANKS[this.tier], sub: "HOLD TO CHANGE EXPEDITION TIER", run: () => { this.tier = (this.tier + 1) % (rank + 1); } },
        { label: "EQUIPMENT · " + this.save.gear.toUpperCase(), sub: "SCANNER: FREE SURVEYS · PORTER: +4 CHARGE" + (rank > 1 ? " · PATHFINDER: CHEAPER RETURN" : ""), run: () => {
          const choices = rank > 1 ? EQUIPMENT : EQUIPMENT.slice(0, 3); this.save.gear = choices[(choices.indexOf(this.save.gear) + 1) % choices.length]; this.dirty = true;
        } }] : []),
      { label: "FIELD GUIDE", sub: "ROUTES, LAMPS AND RESEARCH", run: () => this.go("guide") },
      { label: "RETURN TO DASHBOARD", run: () => this.c.home?.() }];
    if (this.phase === "replace") return [{ label: "KEEP CURRENT EXPEDITION", run: () => this.go("home") }, { label: "REPLACE IT WITH A NEW SURVEY", run: () => this.go("brief") }];
    if (this.phase === "brief") return [{ label: "BEGIN SURVEY", sub: "SUPPLY CACHES RESTORE SIX CHARGE. RESEARCH IS OPTIONAL.", run: () => this.start() }, { label: "BACK", run: () => this.go("home") }];
    if (this.phase === "guide" || this.phase === "result") return [{ label: "BACK TO EXPEDITIONS", run: () => this.go("home") }];
    if (!r) return [];
    if (this.phase === "survey") return [{ label: "RETURN TO THE FIELD", run: () => this.go("field") },
      { label: "SURVEY TWO STEPS AROUND YOU", sub: r.gear === "scanner" ? "FREE WITH SCANNER" : "COSTS ONE CHARGE", run: () => this.scan() },
      { label: "BACKTRACK", sub: "RETURN ALONG YOUR LAST CORRIDOR · NORMAL TRAVEL COST", run: () => this.backtrack() },
      { label: "SAVE AND RETURN TO EXPEDITIONS", run: () => this.go("home") }];
    return [...DIRECTIONS.map((name, d) => { const to = neighbour(r.at, d, this.field.size), open = this.field.edges[r.at] & (1 << d); return {
      label: name, sub: open ? this.placeName(to) + " · COST " + this.cost(to) : "NO CORRIDOR", run: () => this.travel(d) }; }),
      { label: "SURVEY / BACKTRACK", sub: "INSPECT THE FIELD AND RETURN ROUTE", run: () => this.go("survey") },
      { label: "SAVE AND RETURN", run: () => this.go("home") }];
  }
  go(phase) { this.phase = phase; this.cursor = 0; this.held = false; this.hold = 0; }
  start(seed = this.c.rng.int(1, 0x7fffffff)) {
    this.field = makeField(seed, this.tier);
    const gear = this.save.gear, at = this.field.start;
    this.save.active = { seed, tier: this.tier, gear, at, energy: capacity(this.tier, gear), steps: 0, visited: [at], taken: [], relics: [], beacons: [], trail: [], scanned: [] };
    this.message = "Follow the beacon coordinates. Research can wait until you have a safe return.";
    this.dirty = true; this.go("field");
  }
  cost(to) { return this.save.active.gear === "pathfinder" && this.save.active.visited.includes(to) ? 1 : this.field.terrain[to]; }
  placeName(to) {
    const r = this.save.active, f = this.field;
    if (to === f.goal) return "RESCUE STATION";
    if (f.beacons.includes(to)) return r.beacons.includes(to) ? "LIT BEACON" : "BEACON";
    if (f.caches.includes(to) && !r.taken.includes(to)) return "SUPPLY CACHE +6";
    if (f.relics.includes(to) && !r.relics.includes(to)) return "RESEARCH RELIC +3";
    return ["", "PLAIN", "RIDGE", "ION FIELD"][f.terrain[to]];
  }
  travel(dir) {
    const r = this.save.active, f = this.field;
    if (!r || !(f.edges[r.at] & (1 << dir))) { this.message = "No corridor that way. Scan another route."; return false; }
    const to = neighbour(r.at, dir, f.size), cost = this.cost(to);
    if (r.energy < cost) { this.message = "Not enough charge for that corridor. Try a cheaper route or backtrack."; return false; }
    r.trail.push(r.at); r.trail = r.trail.slice(-32); r.at = to; r.energy -= cost; r.steps++;
    if (!r.visited.includes(to)) r.visited.push(to);
    this.message = "Entered " + this.placeName(to).toLowerCase() + ".";
    if (f.caches.includes(to) && !r.taken.includes(to)) { r.taken.push(to); r.energy = Math.min(capacity(r.tier, r.gear), r.energy + 6); this.message = "Supply cache recovered. Six charge restored."; }
    if (f.relics.includes(to) && !r.relics.includes(to)) { r.relics.push(to); this.message = "Research secured. Three knowledge if you reach rescue."; }
    if (f.beacons.includes(to) && !r.beacons.includes(to)) { r.beacons.push(to); this.message = "Beacon lit. " + r.beacons.length + " of " + f.beacons.length + "."; this.c.tone?.(880, 0.08, "sine"); }
    this.dirty = true; this.cursor = 0;
    if (to === f.goal && r.beacons.length === f.beacons.length) this.finish("rescued");
    else if ([0, 1, 2, 3].every((d) => !(f.edges[to] & (1 << d)) || this.cost(neighbour(to, d, f.size)) > r.energy)) this.finish("stranded");
    return true;
  }
  backtrack() {
    const r = this.save.active, to = r.trail.at(-1);
    const dir = [0, 1, 2, 3].find((d) => neighbour(r.at, d, this.field.size) === to && (this.field.edges[r.at] & (1 << d)));
    if (dir === undefined) { this.message = "There is no previous corridor yet."; return; }
    const history = r.trail.slice(0, -1);
    this.go("field");
    if (this.travel(dir) && this.save.active) this.save.active.trail = history;
  }
  scan() {
    const r = this.save.active, price = r.gear === "scanner" ? 0 : 1;
    if (r.energy <= price) { this.message = "Keep your last charge for travel. Inspect the visible corridors instead."; return; }
    if (price && [0, 1, 2, 3].every((d) => !(this.field.edges[r.at] & (1 << d)) || this.cost(neighbour(r.at, d, this.field.size)) > r.energy - price)) {
      this.message = "A paid survey would leave no affordable exit. Keep your charge for travel.";
      return;
    }
    r.energy -= price;
    const queue = [[r.at, 0]], seen = new Set([r.at]);
    while (queue.length) {
      const [at, depth] = queue.shift(); if (!r.scanned.includes(at)) r.scanned.push(at);
      if (depth === 2) continue;
      for (let d = 0; d < 4; d++) if (this.field.edges[at] & (1 << d)) { const to = neighbour(at, d, this.field.size); if (!seen.has(to)) { seen.add(to); queue.push([to, depth + 1]); } }
    }
    this.message = "Survey charted two corridor steps around your position."; this.dirty = true; this.go("field");
  }
  finish(outcome) {
    const r = this.save.active, rescued = outcome === "rescued";
    const gained = rescued ? 4 + r.tier * 3 + r.relics.length * 3 : 0;
    const score = rescued ? 500 + r.tier * 300 + r.relics.length * 100 + r.energy * 10 + Math.max(0, 100 - r.steps) : 0;
    const before = rankFor(this.save.knowledge);
    this.save.runs++; this.save.rescued += rescued ? 1 : 0; this.save.knowledge += gained;
    this.save.last = { outcome, tier: r.tier, steps: r.steps, relics: r.relics.length, score };
    this.save.active = null; this.field = null; this.dirty = true;
    this.message = rescued ? "Rescued. +" + gained + " knowledge." + (rankFor(this.save.knowledge) > before ? " New region and equipment unlocked." : "") : "Stranded. Research was left in the field. Your expedition record is kept; try a shorter route.";
    if (rescued) { this.c.score?.(score, "region-" + r.tier); this.c.dailyMet?.(); }
    this.go("result");
  }
  down(event) { this.guard.mark(event); this.held = true; this.hold = 0; }
  up(event) {
    this.guard.release(event); if (!this.held) return; this.held = false;
    const duration = Number.isFinite(event?.durationMs) ? event.durationMs : this.hold * 1000; this.hold = 0;
    if (duration >= (this.c.settings?.()?.holdMs || 650)) this.rows()[this.cursor]?.run();
    else this.cursor = (this.cursor + 1) % Math.max(1, this.rows().length);
  }
  knock(event = {}) {
    if (this.held) return;
    if (this.phase === "field") this.go("survey");
    else if (this.phase === "survey") this.go("field");
    else { const n = this.rows().length; this.cursor = n ? (this.cursor + (this.c.settings?.()?.tapMode === "sides" && event.side === "right" ? 1 : n - 1)) % n : 0; }
  }
  cancel() { this.guard.rewind(); this.held = false; this.hold = 0; }
  flush() { if (this.dirty) { this.save = migrateWayfinder(this.save); this.c.saveProgress?.(this.save)?.catch?.(this.c.error); this.dirty = false; } }
  pause() {
    this.guard.settle(); this.flush();
    this.c.leds?.(Array((this.c.lampCount?.() === 4 ? 4 : 3) * 3).fill(0));
    this.c.board?.([0, 0, 0]);
  }
  resume() { this.held = false; this.hold = 0; }
  dispose() { this.pause(); }
  update(dt) {
    this.t += dt; this.guard.tick(dt); if (this.held) this.hold += dt;
    if (this.dirty && !this.held) this.flush();
    const r = this.save.active, values = [];
    for (let d = 0; d < (this.c.lampCount?.() === 4 ? 4 : 3); d++) {
      const to = r && neighbour(r.at, d, this.field.size), open = r && (this.field.edges[r.at] & (1 << d));
      const rgb = !open ? LAMP.off : this.cost(to) > r.energy ? LAMP.red : this.field.beacons.includes(to) ? LAMP.green : this.field.caches.includes(to) && !r.taken.includes(to) ? LAMP.cyan : r.visited.includes(to) ? LAMP.blue : LAMP.amber;
      values.push(...dim(rgb, this.phase === "field" && this.cursor === d ? 0.55 : 0.16));
    }
    this.c.leds?.(values);
    this.c.board?.(r ? dim(LAMP.cyan, 0.02 + 0.08 * r.beacons.length / this.field.beacons.length) : [0, 0, 0]);
    this.c.hud?.(r ? [["CHARGE", String(r.energy)], ["BEACONS", r.beacons.length + "/" + this.field.beacons.length], ["RESEARCH", String(r.relics.length)]] : [["RANK", RANKS[rankFor(this.save.knowledge)]], ["KNOWLEDGE", String(this.save.knowledge)], ["RESCUED", String(this.save.rescued)]]);
    this.c.hint?.("BUTTON: SCAN · HOLD: CHOOSE · CASE TAP: SURVEY / RETURN");
  }
  draw(g) {
    g.save(); g.fillStyle = C.bg; g.fillRect(0, 0, 960, 540);
    if (this.phase === "field" && this.save.active) this.drawField(g);
    else if (this.phase === "guide" || this.phase === "result") drawNoticePanel(g, { title: this.phase === "result" ? "EXPEDITION RECORD" : "WAYFINDER / FIELD GUIDE", lines: this.phase === "result" ? [this.message, "Hold to return to expeditions."] : ["Lamps: north, east, south, west. Green: beacon. Cyan: cache. Blue: visited. Red: too costly.", "Tap: next choice. Hold: choose. Case tap: survey/backtrack. Every action works with the button alone.", "Light all beacons, then rescue. Caches restore six once. Relics earn knowledge on rescue. Research unlocks regions and equipment."] }, this.t, false);
    else drawRowList(g, this.rows(), this.cursor, "WAYFINDER · " + RANKS[rankFor(this.save.knowledge)], "LOCAL EXPEDITIONS", this.message.slice(0, 78));
    g.restore();
  }
  drawField(g) {
    const f = this.field, r = this.save.active, cell = 42, x0 = 74, y0 = 68, visible = new Set([...r.visited, ...r.scanned, ...f.beacons, f.goal]);
    for (const at of r.visited) for (let d = 0; d < 4; d++) if (f.edges[at] & (1 << d)) visible.add(neighbour(at, d, f.size));
    text(g, "BEACON FIELD / " + RANKS[r.tier], 60, 30, 18, C.amber);
    for (let at = 0; at < f.edges.length; at++) {
      const x = x0 + at % f.size * cell, y = y0 + Math.floor(at / f.size) * cell;
      if (!visible.has(at)) { text(g, "·", x, y, 16, C.line, "center"); continue; }
      if (r.visited.includes(at) || r.scanned.includes(at)) for (const d of [1, 2]) if (f.edges[at] & (1 << d)) line(g, x, y, x + DX[d] * cell, y + DY[d] * cell, C.line, 2);
      const rgb = at === r.at ? C.ink : f.beacons.includes(at) ? r.beacons.includes(at) ? C.cyan : C.amber : C.muted;
      text(g, at === r.at ? "◉" : at === f.goal ? "⌂" : f.beacons.includes(at) ? "◇" : f.caches.includes(at) && !r.taken.includes(at) ? "+" : f.relics.includes(at) && !r.relics.includes(at) ? "✧" : "·", x, y, 22, rgb, "center");
    }
    const rows = this.rows();
    text(g, "ROUTE / " + (r.at % f.size + 1) + "," + (Math.floor(r.at / f.size) + 1), 540, 62, 22, C.ink);
    rows.forEach((row, i) => { const y = 112 + i * 49; if (i === this.cursor) { g.fillStyle = C.dark; g.fillRect(526, y - 21, 380, 42); } text(g, (i === this.cursor ? "▸ " : "  ") + row.label, 540, y - 4, 20, i === this.cursor ? C.ink : C.muted); text(g, row.sub || "", 564, y + 15, 13, C.muted); });
    text(g, "CHARGE " + r.energy + " / " + capacity(r.tier, r.gear) + " · " + r.gear.toUpperCase(), 60, 467, 20, r.energy < 4 ? C.red : C.cyan);
    text(g, this.message.slice(0, 86), 60, 502, 15, C.muted);
  }
}
