// SUPPER CLUB — a dinner-service resource game for one button and three real pans/lamps.
// Controls (after-hours-kit.js): TAP moves to the next pan; HOLD and RELEASE uses it (cook, plate or
// clean). While the button is down the kitchen slows right down, so a hold is also time to think.
// Lamps 1-3 are the pans; lamp 4, when the node has one, is the table that will leave soonest.
import { C, text, line, circle } from "../engine/draw.js";
import { clamp } from "../engine/math.js";
import { LAMP, lamps, dim, ramp, blink } from "../engine/lightshow.js";
import { AppGuard } from "../engine/input.js";
import { LampBus, LOCKOUT } from "./game-kit.js";
import { HOLD, lampCount, withFourth, holdFraction, drawGuide, drawPressHelp } from "./after-hours-kit.js";

// How fast the kitchen runs while the button is down (and slow-time is left).
export const SLOW = 0.18;
export const PAN_NAMES = ["RICE", "GREENS", "EGGS"];
const COOK = [6.4, 4.8, 5.6];
const READY = [7.8, 6.6, 7.2];
const INK = [C.amber, C.ink, C.cyan];
const MAX_SAVE = 999999999;
const WAVE_NAMES = ["SOFT OPEN", "THE POTLUCK", "FRIDAY RUSH", "LAST CALL"];
const GUESTS = ["JUST GOT HOME", "THE NEIGHBORS", "NIGHT SHIFT", "MOVIE NIGHT", "BOOK CLUB", "ONE MORE TABLE", "HUNGRY FRIENDS", "THE REGULARS"];

export const RECIPES = [
  { name: "Comfort rice", need: [1, 0, 0], value: 80 },
  { name: "Crispy greens", need: [0, 1, 0], value: 80 },
  { name: "Breakfast late", need: [0, 0, 1], value: 85 },
  { name: "Garden bowl", need: [1, 1, 0], value: 145 },
  { name: "Egg-fried rice", need: [1, 0, 1], value: 155 },
  { name: "Farmhouse pan", need: [0, 1, 1], value: 155 },
  { name: "Sunday supper", need: [1, 1, 1], value: 225 },
  { name: "Two to share", need: [2, 1, 1], value: 300 },
];

export const UPGRADES = [
  { id: "batch", name: "BIG PANS", lines: ["Cook two portions.", "Uses 2 stock. 20% slower.", "Good for shared orders."], icon: 0 },
  { id: "iron", name: "CAST IRON", lines: ["Ready window: +4 seconds.", "Cooking takes 15% longer.", "Wait for a better moment."], icon: 1 },
  { id: "flame", name: "HOT BURNERS", lines: ["Cooking is 25% faster.", "Ready window is 20% less.", "Faster food; watch pans."], icon: 2 },
  { id: "drawer", name: "WARMING DRAWER", lines: ["Plated food keeps 40s.", "Tray capacity: 2 to 4.", "Prepare the next ticket."], icon: 3 },
  { id: "host", name: "GOOD COMPANY", lines: ["Serving a meal adds 4s", "to every waiting table.", "Small meals buy time."], icon: 4 },
  { id: "prep", name: "MISE EN PLACE", lines: ["+3 stock in every pan.", "Planning lasts 12s.", "More room to recover."], icon: 5 },
];

export const GUIDE = [
  { head: "THREE PANS, THREE LAMPS", lines: ["Each lamp is a pan: rice, greens and eggs. The pan you are on glows brightest.",
    "TAP moves to the next pan. HOLD, then RELEASE, uses the pan you are on.", "Using an empty pan starts it cooking. Using a green pan plates the food.",
    "Amber means still cooking: wait. Red means burnt: use it to clean it out."],
    lamps: [{ rgb: LAMP.cyan, label: "RICE", sub: "cyan: empty" }, { rgb: LAMP.amber, label: "GREENS", sub: "amber: cooking" },
      { rgb: LAMP.green, label: "EGGS", sub: "green: plate it now" }, { rgb: LAMP.red, label: "NEXT TABLE", sub: "red: about to leave" }] },
  { head: "THE TICKETS", lines: ["Tables order along the top; each meal needs food from certain pans.",
    "Plated food waits on the pan's tray. A ticket goes out by itself once its food is plated.",
    "Cook only what the tickets need: plated food goes cold, and stock runs out.", "A table that waits too long leaves, and the kitchen loses goodwill."] },
  { head: "TAKE A BREATH", lines: ["While the button is down, the kitchen slows right down.",
    "So hold to think, then release on the pan you want. Releasing on a cooking pan does nothing.",
    "The slow-time meter drains as you hold and refills when you serve.", "Four services, with an upgrade between them. GAME GUIDE in the system menu shows this again."] },
];

const bounded = (v, max = MAX_SAVE) => typeof v === "number" && Number.isFinite(v) ? clamp(Math.floor(v), 0, max) : 0;
export function migrateSave(raw) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const last = r.last && typeof r.last === "object" && !Array.isArray(r.last) ? r.last : {};
  return {
    schema: 1, guided: r.guided === true, runs: bounded(r.runs), milestone: bounded(r.milestone, 4), wins: bounded(r.wins),
    bestMeals: bounded(r.bestMeals, 26),
    last: { score: bounded(last.score), meals: bounded(last.meals, 26), waves: bounded(last.waves, 4),
      waste: bounded(last.waste, 500), stars: bounded(last.stars, 3), won: last.won === true },
  };
}

const freshPan = () => ({ state: "empty", age: 0, count: 0, cook: 0, ready: 0, cycle: 0, cooldown: 0 });

export class Supper {
  constructor(ctx) {
    this.c = ctx;
    this.lamps = new LampBus(ctx);
    this.sv = migrateSave(ctx.progress?.());
    this.t = 0;
    this.phase = "title";
    this.phaseAt = 0;
    this.overAt = 0;
    this.cursor = 0;
    this.guide = -1;
    this.wave = 0;
    this.worldT = 0;
    this.serviceT = 0;
    this.waveClock = 0;
    this.score = 0;
    this.meals = 0;
    this.hearts = 6;
    this.waste = 0;
    this.burns = 0;
    this.missed = 0;
    this.freshMeals = 0;
    this.streak = 0;
    this.won = false;
    this.stars = 0;
    this.completedWaves = 0;
    this.mods = [];
    this.offers = [];
    this.queue = [];
    this.schedule = [];
    this.nextOrder = 0;
    this.stock = [0, 0, 0];
    this.trays = [[], [], []];
    this.pans = [freshPan(), freshPan(), freshPan()];
    this.breath = 8;
    this.lastSpeed = 1;
    this.held = false;
    this.heldT = 0;
    this.pressAt = 0;
    this.actionCooldown = 0;
    this.note = "THREE PANS. ONE BUTTON. EVERYONE WANTS DINNER.";
    this.noteT = 0;
    this.lastToneAt = -10;
    this.hudT = 0;
    this.plateFlash = [0, 0, 0];
    this.c.hint("Tap moves to the next pan. Hold and release uses it: cook when empty, plate when green. Holding slows the kitchen.");
    this.guard = new AppGuard(this, ctx);
  }

  has(id) { return this.mods.includes(id); }
  breathMax() { return this.has("prep") ? 12 : 8; }
  trayLife() { return this.has("drawer") ? 40 : 19; }
  trayMax() { return this.has("drawer") ? 4 : 2; }
  focusAt() { return this.cursor; }
  say(message, duration = 4) { this.note = message; this.noteT = duration; }
  beep(hz, wave = "triangle") {
    if (this.t - this.lastToneAt < 0.12) return;
    this.lastToneAt = this.t;
    this.c.tone(hz, 0.09, wave);
  }

  start() {
    this.mods = [];
    this.score = 0; this.meals = 0; this.hearts = 6; this.waste = 0;
    this.burns = 0; this.missed = 0; this.freshMeals = 0; this.streak = 0;
    this.serviceT = 0; this.completedWaves = 0; this.won = false; this.stars = 0;
    this.held = false; this.heldT = 0; this.actionCooldown = 0;
    this.startWave(0);
  }

  makeSchedule(wave) {
    // Authored opening teaches each pan, then real combinations. Later orders are seeded variations.
    const opening = [0, 1, 4, 3, 6];
    const decks = [[0, 1, 4, 3, 6], [3, 4, 5, 3, 4, 6], [3, 5, 6, 4, 7, 5, 6], [6, 4, 7, 5, 6, 7, 4, 6]];
    const deck = decks[wave].slice();
    if (wave > 0) {
      for (let i = deck.length - 1; i > 0; i--) {
        const j = this.c.rng.int(0, i), keep = deck[i]; deck[i] = deck[j]; deck[j] = keep;
      }
    }
    const gaps = [11.5, 9.5, 8.2, 7.4];
    return (wave === 0 ? opening : deck).map((recipe, i) => ({ recipe, at: i * gaps[wave], guest: GUESTS[(i + wave * 2) % GUESTS.length] }));
  }

  startWave(wave) {
    this.wave = wave; this.waveClock = 0; this.cursor = 0; this.worldT = 0;
    this.phase = "play"; this.phaseAt = this.t;
    this.pans = [freshPan(), freshPan(), freshPan()]; this.trays = [[], [], []];
    this.schedule = this.makeSchedule(wave); this.nextOrder = 0; this.queue = [];
    const needs = [0, 0, 0];
    for (const order of this.schedule) RECIPES[order.recipe].need.forEach((v, i) => { needs[i] += v; });
    this.stock = needs.map((n) => n + (wave === 0 ? 3 : 2) + (this.has("prep") ? 3 : 0));
    this.breath = this.breathMax(); this.actionCooldown = 0;
    this.spawnOrders();
    if (wave === 0) {
      this.beginPan(0); this.pans[0].age = 3.2;
      this.say("RICE is already cooking. When its lamp turns GREEN, hold and release to plate it.", 8);
    } else if (wave === 1) this.say("POTLUCK: combine pans. Plated food completes tickets automatically.", 7);
    else if (wave === 2) this.say("FRIDAY RUSH: watch the forecast. Two-to-share needs 2 rice.", 7);
    else this.say("LAST CALL: eight tables, then we close. Make it count.", 6);
    this.c.hint("TAP: next pan. HOLD + RELEASE: use it (EMPTY cooks, GREEN plates, RED cleans). The kitchen slows while you hold.");
  }

  spawnOrders() {
    while (this.nextOrder < this.schedule.length && this.queue.length < 4 && this.schedule[this.nextOrder].at <= this.waveClock) {
      const plan = this.schedule[this.nextOrder++];
      const patience = [52, 43, 38, 34][this.wave] + (plan.recipe === 7 ? 7 : 0);
      this.queue.push({ recipe: plan.recipe, guest: plan.guest, patience, maxPatience: patience });
    }
  }

  beginPan(index) {
    const p = this.pans[index];
    if (!this.stock[index]) { this.say(PAN_NAMES[index] + " stock is empty. Work the other pans."); this.beep(150); return false; }
    const amount = this.has("batch") ? Math.min(2, this.stock[index]) : 1;
    this.stock[index] -= amount;
    p.state = "cook"; p.age = 0; p.count = amount; p.cycle++;
    p.cook = COOK[index] * (this.has("batch") && amount > 1 ? 1.2 : 1) * (this.has("iron") ? 1.15 : 1) * (this.has("flame") ? 0.75 : 1);
    p.ready = (READY[index] - this.wave * 0.28 + (this.has("iron") ? 4 : 0)) * (this.has("flame") ? 0.8 : 1);
    p.cooldown = 0;
    return true;
  }

  down() {
    this.guard.mark();
    if (this.held) return;
    this.held = true; this.heldT = 0; this.pressAt = this.t;
  }

  up(e = {}) {
    this.guard.release();
    if (!this.held) return;
    const seconds = Number.isFinite(e.durationMs) ? e.durationMs / 1000 : this.heldT;
    this.held = false; this.heldT = 0;
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
    if (this.phase === "upgrade" && this.t - this.phaseAt < 0.8) return;
    if (!long) { this.cursor = (this.cursor + 1) % 3; this.beep(330 + this.cursor * 70); return; }
    if (this.phase === "upgrade") { this.chooseUpgrade(this.cursor); return; }
    if (this.phase === "play" && this.actionCooldown <= 0) this.act(this.cursor);
  }

  openGuide() { this.guide = 0; this.held = false; this.heldT = 0; }
  closeGuide() {
    this.guide = -1;
    if (!this.sv.guided) { this.sv.guided = true; this.c.saveProgress(JSON.parse(JSON.stringify(this.sv)))?.catch?.(this.c.error); }
    if (this.phase === "title") this.start();
  }

  menuActions() {
    return [{ label: "GAME GUIDE", run: () => this.openGuide() }, { label: "NEW SERVICE", run: () => { this.guide = -1; this.start(); } }];
  }

  act(index) {
    const p = this.pans[index];
    if (p.cooldown > 0) return;
    this.actionCooldown = 0.35;
    if (p.state === "empty") {
      if (this.trays[index].length >= this.trayMax()) { this.say("Tray full. Let a ticket use " + PAN_NAMES[index].toLowerCase() + " before cooking more."); return; }
      if (this.beginPan(index)) { this.beep(240 + index * 65); this.say(PAN_NAMES[index] + " cooking. Watch the other pans.", 2.2); }
      return;
    }
    // A quarter-second grace either side of the ready window is intentionally generous.
    if (p.age >= p.cook - 0.25 && p.age <= p.cook + p.ready + 0.25) {
      const count = Math.min(p.count, this.trayMax() - this.trays[index].length);
      if (!count) { this.say("No tray space. Wait for a matching meal to go out.", 3); return; }
      const quality = clamp(1 - Math.max(0, p.age - p.cook) / p.ready * 0.45, 0.55, 1);
      for (let n = 0; n < count; n++) this.trays[index].push({ age: 0, quality });
      p.count -= count;
      if (!p.count) { p.state = "empty"; p.age = 0; p.cooldown = 0.5; }
      this.plateFlash[index] = 0.45;
      this.beep(620 + index * 90);
      this.say(PAN_NAMES[index] + " plated" + (quality > 0.85 ? " — lovely and fresh." : ".") + (p.count ? " One portion remains in the pan." : ""), 2.5);
      this.completeMeals();
      return;
    }
    // Releasing on a pan that is still cooking does nothing, so a hold to think is always safe.
    if (p.age < p.cook - 0.25) {
      this.say(PAN_NAMES[index] + " is still cooking. Wait for its lamp to turn GREEN.", 3);
      this.beep(200);
      return;
    }
    this.waste += p.count; this.burns++; this.streak = 0;
    this.say("Burnt " + PAN_NAMES[index].toLowerCase() + " cleared. Start a fresh pan when it is empty.", 3.5);
    p.count = 0; p.state = "empty"; p.age = 0; p.cooldown = 1.2;
    this.beep(105, "sawtooth");
  }

  completeMeals() {
    // Oldest complete ticket gets served. Incomplete tickets never steal components from another meal.
    for (let k = 0; k < this.queue.length;) {
      const order = this.queue[k], recipe = RECIPES[order.recipe];
      if (!recipe.need.every((n, i) => this.trays[i].length >= n)) { k++; continue; }
      let quality = 0, portions = 0;
      recipe.need.forEach((n, i) => {
        for (let j = 0; j < n; j++) {
          const item = this.trays[i].shift();
          quality += item.quality * (1 - 0.6 * item.age / this.trayLife()); portions++;
        }
      });
      quality /= portions;
      const isFresh = quality >= 0.74;
      this.streak++; this.meals++; if (isFresh) this.freshMeals++;
      const tip = Math.round(recipe.value * (0.4 * quality + 0.25 * order.patience / order.maxPatience));
      this.score += recipe.value + tip + Math.min(5, this.streak) * 10;
      this.breath = Math.min(this.breathMax(), this.breath + (isFresh ? 2 : 1));
      this.queue.splice(k, 1);
      if (this.has("host")) for (const guest of this.queue) guest.patience = Math.min(guest.maxPatience, guest.patience + 4);
      this.say(recipe.name.toUpperCase() + " served! " + (isFresh ? "Fresh food, happy people." : "A warm meal still counts."), 3);
      this.beep(isFresh ? 880 : 740);
    }
  }

  finishWave() {
    this.completedWaves = this.wave + 1;
    // End-of-service leftovers count as waste, making overproduction visible in the closing record.
    this.pans.forEach((p) => { if (p.state === "burnt") this.burns++; this.waste += p.count; });
    this.trays.forEach((tray) => { this.waste += tray.length; });
    this.pans = [freshPan(), freshPan(), freshPan()]; this.trays = [[], [], []];
    if (this.wave === 3) { this.end(true); return; }
    this.phase = "upgrade"; this.phaseAt = this.t; this.cursor = 0;
    this.held = false; this.heldT = 0;
    const available = UPGRADES.map((u, i) => i).filter((i) => !this.has(UPGRADES[i].id));
    for (let i = available.length - 1; i > 0; i--) {
      const j = this.c.rng.int(0, i), item = available[i]; available[i] = available[j]; available[j] = item;
    }
    this.offers = available.slice(0, 3);
    this.c.hint("Choose one kitchen improvement. TAP moves between cards; HOLD and RELEASE picks one.");
    this.say("A breath between services. Choose what this kitchen becomes.", 5);
  }

  chooseUpgrade(index) {
    if (this.phase !== "upgrade" || !Number.isInteger(this.offers[index])) return;
    this.mods.push(UPGRADES[this.offers[index]].id);
    this.beep(560);
    this.startWave(this.wave + 1);
  }

  end(won) {
    if (this.phase === "over") return;
    this.phase = "over"; this.overAt = this.t; this.won = won;
    this.held = false; this.heldT = 0;
    this.stars = won ? (this.meals >= 24 && this.waste <= 9 ? 3 : this.meals >= 20 ? 2 : 1) : 0;
    if (won) this.score += 300 + this.hearts * 100 + this.stars * 200;
    this.sv.runs = Math.min(MAX_SAVE, this.sv.runs + 1);
    this.sv.wins = Math.min(MAX_SAVE, this.sv.wins + (won ? 1 : 0));
    this.sv.milestone = Math.max(this.sv.milestone, this.completedWaves);
    this.sv.bestMeals = Math.max(this.sv.bestMeals, this.meals);
    this.sv.last = { score: this.score, meals: this.meals, waves: this.completedWaves, waste: Math.min(500, this.waste), stars: this.stars, won };
    this.c.score(this.score);
    this.c.saveProgress(JSON.parse(JSON.stringify(this.sv)))?.catch?.(this.c.error);
    this.c.hint(won ? "Dinner is done. Press for a new service and a different kitchen build." : "Read the tickets, cook only what you need, and wait for green. Press to try again.");
    this.beep(won ? 990 : 130);
  }

  update(dt) {
    this.guard.tick(dt);
    this.t += dt;
    this.noteT = Math.max(0, this.noteT - dt);
    this.actionCooldown = Math.max(0, this.actionCooldown - dt);
    this.plateFlash = this.plateFlash.map((v) => Math.max(0, v - dt));
    if (this.held) this.heldT += dt;
    if (this.phase === "play" && this.guide < 0) {
      const planning = this.held && this.breath > 0;
      if (planning) this.breath = Math.max(0, this.breath - dt);
      const speed = planning ? SLOW : 1;
      this.lastSpeed = speed;
      const step = dt * speed;
      this.worldT += step; this.waveClock += step; this.serviceT += dt;
      for (const p of this.pans) {
        p.cooldown = Math.max(0, p.cooldown - step);
        if (p.state === "empty") continue;
        p.age += step;
        p.state = p.age < p.cook ? "cook" : p.age <= p.cook + p.ready ? "ready" : "burnt";
      }
      for (const tray of this.trays) {
        for (const item of tray) item.age += step;
        while (tray.length && tray[0].age >= this.trayLife()) {
          tray.shift(); this.waste++; this.streak = 0;
          this.say("A plated portion went cold. Cook toward the tickets.", 3.5);
        }
      }
      for (let i = this.queue.length - 1; i >= 0; i--) {
        this.queue[i].patience -= step;
        if (this.queue[i].patience <= 0) {
          this.queue.splice(i, 1); this.hearts--; this.missed++; this.streak = 0;
          this.say("A table left hungry. Recover with the next meal.", 4);
          this.beep(140);
        }
      }
      this.spawnOrders();
      // Stored components can fulfill a newly arriving ticket without an extra confirm press.
      this.completeMeals();
      if (this.hearts <= 0 && this.serviceT >= 30) this.end(false);
      else if (!this.queue.length && this.nextOrder === this.schedule.length) this.finishWave();
    }

    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = 0.2;
      this.c.hud([["SERVICE", (this.wave + 1) + " / 4"], ["MEALS", this.meals], ["GOODWILL", Math.max(0, this.hearts) + " / 6"], ["TIPS", this.score]]);
    }
    this.lamps.frame(dt, this.lampState());
  }

  // Lamp 4: the table that will leave soonest, green with time to spare, red and blinking near the end.
  tableLamp() {
    if (this.phase !== "play" || !this.queue.length) return null;
    const urgency = Math.min(...this.queue.map((o) => o.patience / o.maxPatience));
    const colour = ramp(urgency, [LAMP.red, LAMP.amber, LAMP.green]);
    return dim(colour, urgency < 0.25 ? 0.2 + 0.7 * blink(this.t, 3) : 0.6);
  }

  lampState() {
    const n = lampCount(this.c);
    if (this.guide >= 0) return withFourth(lamps(...GUIDE[0].lamps.slice(0, 3).map((k) => dim(k.rgb, 0.55))), dim(LAMP.green, 0.4), n);
    return withFourth(this.panLamps(), this.tableLamp(), n);
  }

  panLamps() {
    if (this.phase === "title") return lamps(dim(LAMP.amber, 0.22), dim(LAMP.green, 0.25 + Math.sin(this.t * 2) * 0.08), dim(LAMP.cyan, 0.22));
    if (this.phase === "over") return lamps(...[0, 1, 2].map((i) => dim(this.won ? LAMP.green : LAMP.amber, this.won && i < this.stars ? 0.8 : 0.15)));
    const focus = this.focusAt();
    if (this.phase === "upgrade") return lamps(...[0, 1, 2].map((i) => dim(i === focus ? LAMP.white : LAMP.cyan, i === focus ? 0.7 : 0.15)));
    return lamps(...this.pans.map((p, i) => {
      if (this.plateFlash[i] > 0) return dim(LAMP.white, 0.8);
      const colour = p.state === "burnt" ? LAMP.red : p.state === "ready" ? LAMP.green : p.state === "cook" ? LAMP.amber : LAMP.cyan;
      let level = i === focus ? 0.92 : p.state === "ready" ? 0.4 : 0.17;
      if (p.state === "burnt") level = (i === focus ? 0.65 : 0.25) + Math.sin(this.t * 5) * 0.12;
      return dim(colour, level);
    }));
  }

  draw(g) {
    g.globalAlpha = 1;
    if (this.guide >= 0) { drawGuide(g, "SUPPER CLUB", GUIDE, this.guide, lampCount(this.c)); return; }
    g.fillStyle = C.bg; g.fillRect(0, 0, 960, 540);
    if (this.phase === "title") { this.drawTitle(g); return; }
    if (this.phase === "upgrade") { this.drawUpgrade(g); return; }
    if (this.phase === "over") { this.drawResult(g); return; }
    this.drawService(g);
  }

  drawHeader(g, left, right) {
    text(g, "SUPPER CLUB", 28, 30, 27, C.ink);
    text(g, left, 288, 30, 17, C.amber);
    text(g, right, 930, 30, 18, C.muted, "right");
    line(g, 28, 54, 932, 54, C.line);
  }

  foodIcon(g, type, x, y, size, color = INK[type]) {
    g.save(); g.translate(x, y); g.strokeStyle = color; g.fillStyle = color; g.lineWidth = 2;
    if (type === 0) {
      for (let i = 0; i < 7; i++) { const a = i * 2.4; g.beginPath(); g.ellipse(Math.cos(a) * size * 0.4, Math.sin(a) * size * 0.3, size * 0.18, size * 0.075, a, 0, Math.PI * 2); g.fill(); }
    } else if (type === 1) {
      for (let i = 0; i < 3; i++) { g.beginPath(); g.ellipse((i - 1) * size * 0.28, Math.abs(i - 1) * size * 0.15, size * 0.22, size * 0.42, (i - 1) * 0.65, 0, Math.PI * 2); g.stroke(); }
      line(g, 0, -size * 0.1, 0, size * 0.5, color, 2);
    } else {
      g.beginPath(); g.ellipse(0, 0, size * 0.57, size * 0.44, -0.3, 0, Math.PI * 2); g.stroke();
      circle(g, 0, 0, size * 0.19, color, true);
    }
    g.restore();
  }

  drawTitle(g) {
    text(g, "AFTER A LONG DAY, EVERYONE NEEDS", 480, 50, 17, C.muted, "center");
    text(g, "SUPPER CLUB", 480, 110, 65, C.ink, "center");
    text(g, "A small kitchen. A full house. Your kind of chaos.", 480, 166, 19, C.amber, "center");
    const cols = [190, 480, 770];
    for (let i = 0; i < 3; i++) {
      circle(g, cols[i], 244, 46, INK[i], false, 2);
      line(g, cols[i] + 43, 260, cols[i] + 72, 271, INK[i], 5);
      this.foodIcon(g, i, cols[i], 243, 43);
      text(g, PAN_NAMES[i], cols[i], 309, 22, INK[i], "center");
    }
    text(g, "TAP: next pan.  HOLD + RELEASE: use it.", 480, 358, 20, C.ink, "center");
    text(g, "EMPTY starts cooking. GREEN plates. AMBER: wait. RED: clean.", 480, 390, 18, C.muted, "center");
    text(g, "The kitchen slows while you hold, so you can think.", 480, 420, 18, C.cyan, "center");
    line(g, 180, 450, 780, 450, C.line);
    text(g, (this.sv.guided ? "PRESS TO OPEN" : "PRESS TO LEARN HOW TO PLAY") + "  ·  FOUR SERVICES / ABOUT FOUR MINUTES", 480, 485, 19, C.amber, "center");
    text(g, "Best service " + this.c.best() + "  /  " + this.sv.wins + " happy closings", 480, 518, 14, C.muted, "center");
  }

  drawService(g) {
    this.drawHeader(g, (this.wave + 1) + "/4  " + WAVE_NAMES[this.wave], this.meals + " MEALS  /  " + this.score);
    text(g, this.noteT > 0 ? this.note : "Green pans can wait a little. Plan the next complete meal.", 480, 79, 16, this.noteT > 0 ? C.amber : C.muted, "center");
    text(g, lampCount(this.c) === 4 ? "THE TICKETS  (LAMP 4: THE TABLE CLOSEST TO LEAVING)" : "THE TICKETS", 28, 112, 13, C.muted);
    text(g, "GOODWILL " + "●".repeat(Math.max(0, this.hearts)) + "○".repeat(Math.max(0, 6 - this.hearts)), 932, 112, 15, this.hearts < 3 ? C.red : C.ink, "right");
    for (let k = 0; k < 4; k++) {
      const x = 28 + k * 230, order = this.queue[k];
      g.fillStyle = C.dark; g.fillRect(x, 131, 214, 118);
      if (!order) { text(g, k ? "table open" : "a moment to prep", x + 107, 187, 14, C.muted, "center"); continue; }
      const recipe = RECIPES[order.recipe], urgency = order.patience / order.maxPatience;
      text(g, order.guest, x + 10, 149, 14, C.muted);
      text(g, recipe.name, x + 10, 174, 18, C.ink);
      let itemX = x + 24;
      recipe.need.forEach((n, i) => {
        if (!n) return;
        this.foodIcon(g, i, itemX, 205, 18, this.trays[i].length >= n ? INK[i] : C.muted);
        text(g, n, itemX + 18, 207, 18, this.trays[i].length >= n ? C.ink : C.muted);
        itemX += 61;
      });
      g.fillStyle = C.line; g.fillRect(x + 10, 231, 194, 5);
      g.fillStyle = urgency < 0.25 ? C.red : C.amber; g.fillRect(x + 10, 231, 194 * clamp(urgency, 0, 1), 5);
      if (urgency < 0.25) text(g, Math.ceil(order.patience) + "s", x + 201, 151, 14, C.red, "right");
    }
    const focus = this.focusAt();
    for (let i = 0; i < 3; i++) this.drawPan(g, i, 28 + i * 308, focus === i);
    const planning = this.held && this.breath > 0;
    text(g, planning ? "SLOWED" : "SLOW-TIME", 28, 510, 16, planning ? C.cyan : C.muted);
    g.fillStyle = C.line; g.fillRect(130, 506, 80, 8);
    g.fillStyle = C.cyan; g.fillRect(130, 506, 80 * this.breath / this.breathMax(), 8);
    const p = this.pans[focus], verb = p.state === "empty" ? "COOK " + PAN_NAMES[focus] : p.state === "ready" ? "PLATE " + PAN_NAMES[focus] : p.state === "burnt" ? "CLEAN THE PAN" : "WAIT, STILL COOKING";
    drawPressHelp(g, this, 510, verb, "HOLD + RELEASE: " + verb);
    const next = this.schedule[this.nextOrder];
    text(g, next ? "NEXT: " + RECIPES[next.recipe].name.toUpperCase() + " / " + Math.max(0, Math.ceil(next.at - this.waveClock)) + "s" : "LAST ORDERS ARE IN.", 930, 510, 14, C.muted, "right");
  }

  drawPan(g, index, x, focused) {
    const p = this.pans[index], cx = x + 145;
    const col = p.state === "ready" ? C.ink : p.state === "burnt" ? C.red : p.state === "cook" ? C.amber : C.cyan;
    g.fillStyle = focused ? "#213326" : C.dark; g.fillRect(x, 270, 288, 216);
    g.strokeStyle = focused ? C.ink : C.line; g.lineWidth = focused ? 2 : 1; g.strokeRect(x, 270, 288, 216);
    text(g, (focused ? "▸ " : "  ") + "LAMP " + (index + 1) + "  " + PAN_NAMES[index], x + 14, 292, 18, focused ? C.ink : C.muted);
    text(g, "STOCK " + this.stock[index], x + 272, 292, 16, this.stock[index] ? C.muted : C.red, "right");
    circle(g, cx, 348, 38, col, false, 3);
    circle(g, cx, 348, 31, C.line, false, 1);
    line(g, cx + 35, 360, cx + 64, 371, col, 5);
    if (p.state !== "empty") this.foodIcon(g, index, cx, 348, 37, p.state === "burnt" ? C.red : INK[index]);
    else text(g, p.cooldown > 0 ? "…" : "+", cx, 348, 33, C.line, "center");
    if (p.count > 1) text(g, "×" + p.count, cx + 59, 336, 18, C.ink);
    if (p.state === "cook" && !this.c.settings?.()?.reducedMotion) {
      const offset = Math.sin(this.t * 3 + index) * 3;
      line(g, cx - 10, 308, cx - 7 + offset, 300, C.muted);
      line(g, cx + 7, 308, cx + 10 + offset, 298, C.muted);
    }
    let message, progress;
    if (p.state === "empty") { message = p.cooldown > 0 ? "RINSING…" : "EMPTY / USE TO COOK"; progress = 0; }
    else if (p.state === "cook") { message = "COOKING / " + Math.ceil(p.cook - p.age) + "s"; progress = p.age / p.cook; }
    else if (p.state === "ready") { message = "READY / USE TO PLATE"; progress = 1 - (p.age - p.cook) / p.ready; }
    else { message = "BURNT / USE TO CLEAN"; progress = 1; }
    text(g, message, cx, 403, 17, col, "center");
    g.fillStyle = C.line; g.fillRect(x + 18, 422, 252, 6);
    g.fillStyle = col; g.fillRect(x + 18, 422, 252 * clamp(progress, 0, 1), 6);
    text(g, "PLATED", x + 14, 456, 14, C.muted);
    for (let j = 0; j < this.trayMax(); j++) {
      const item = this.trays[index][j], trayX = x + 97 + j * 39;
      circle(g, trayX, 456, 13, item ? INK[index] : C.line, false, 1);
      if (item) {
        this.foodIcon(g, index, trayX, 456, 14);
        g.fillStyle = item.age / this.trayLife() > 0.7 ? C.red : INK[index];
        g.fillRect(trayX - 11, 475, 22 * (1 - item.age / this.trayLife()), 2);
      }
    }
    if (focused) { g.fillStyle = C.amber; g.fillRect(x, 267, 288 * holdFraction(this), 3); }
  }

  drawUpgrade(g) {
    this.drawHeader(g, "SERVICE " + (this.wave + 1) + " COMPLETE", this.meals + " MEALS SERVED");
    text(g, "MAKE THIS KITCHEN YOURS", 480, 106, 30, C.ink, "center");
    text(g, "Pantry refills next service. Choose one improvement.", 480, 150, 18, C.muted, "center");
    const focus = this.focusAt();
    for (let i = 0; i < 3; i++) {
      const u = UPGRADES[this.offers[i]], x = 28 + i * 308;
      g.fillStyle = i === focus ? "#213326" : C.dark; g.fillRect(x, 202, 288, 232);
      g.strokeStyle = i === focus ? C.ink : C.line; g.lineWidth = i === focus ? 2 : 1; g.strokeRect(x, 202, 288, 232);
      text(g, "0" + (i + 1), x + 20, 235, 16, C.muted);
      circle(g, x + 144, 261, 22, i === focus ? C.amber : C.line, false, 2);
      if (u.id === "batch") { circle(g, x + 136, 259, 7, C.amber); circle(g, x + 152, 263, 7, C.amber); }
      else text(g, ["I", "II", "III"][i], x + 144, 261, 15, C.amber, "center");
      text(g, u.name, x + 144, 309, 20, i === focus ? C.ink : C.muted, "center");
      u.lines.forEach((part, j) => text(g, part, x + 144, 352 + j * 25, 17, C.muted, "center"));
    }
    drawPressHelp(g, this, 474, "CHOOSE");
    text(g, this.mods.length ? "YOUR KITCHEN: " + this.mods.map((id) => UPGRADES.find((u) => u.id === id).name).join(" + ") : "Different tools change what is worth cooking ahead.", 480, 514, 13, C.muted, "center");
  }

  drawResult(g) {
    this.drawHeader(g, "THE CHECK", "BEST " + this.c.best());
    text(g, this.won ? "CLOSING TIME. YOU MADE IT." : "THE KITCHEN WENT QUIET.", 480, 114, 32, this.won ? C.ink : C.amber, "center");
    text(g, this.won ? "You made a little place people wanted to come back to." : "Tomorrow is another dinner service.", 480, 161, 18, C.muted, "center");
    for (let i = 0; i < 3; i++) {
      circle(g, 390 + i * 90, 221, 25, i < this.stars ? C.amber : C.line, false, 2);
      text(g, "★", 390 + i * 90, 220, 27, i < this.stars ? C.amber : C.line, "center");
    }
    text(g, this.score, 480, 298, 58, C.ink, "center");
    text(g, this.meals + " MEALS  /  " + this.freshMeals + " FRESH  /  " + this.completedWaves + " SERVICES", 480, 360, 20, C.cyan, "center");
    text(g, this.waste + " portions wasted  ·  " + this.missed + " tables left", 480, 398, 17, C.muted, "center");
    text(g, this.mods.length ? this.mods.map((id) => UPGRADES.find((u) => u.id === id).name).join(" + ") : "A humble kitchen, and room to grow.", 480, 437, 15, C.muted, "center");
    text(g, this.t - this.overAt < LOCKOUT ? "CLOSING THE TILL…" : "PRESS FOR A NEW SERVICE", 480, 494, 22, C.amber, "center");
  }

  cancel() {
    this.guard.rewind();
    this.lamps.clear();
    this.held = false; this.heldT = 0;
    this.c.synth?.stopTone?.();
  }
  pause() { this.guard.settle(); this.lamps.sleep(); this.held = false; this.heldT = 0; this.c.synth?.stopTone?.(); }
  resume() { this.lamps.wake(); }
  dispose() { this.guard.settle(); this.lamps.sleep(); this.c.synth?.stopTone?.(); }
}
