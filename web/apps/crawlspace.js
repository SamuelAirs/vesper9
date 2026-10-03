// CRAWLSPACE — a deliberate, one-button homeowner roguelike. No enemy acts on a clock.
// All run state is plain data for AppGuard. Saves are bounded checkpoints, not live objects.
// Controls (after-hours-kit.js): TAP moves to the next card, HOLD and RELEASE does it.
// Lamps 1-3 are the three cards (the chosen one bright); lamp 4, when the node has one, is your health.
import { C, text, line, circle } from "../engine/draw.js";
import { clamp } from "../engine/math.js";
import { LAMP, lamps, dim, fill, ramp, blink } from "../engine/lightshow.js";
import { AppGuard } from "../engine/input.js";
import { LampBus, LOCKOUT } from "./game-kit.js";
import { HOLD, lampCount, withFourth, holdFraction, drawGuide, drawPressHelp } from "./after-hours-kit.js";

// After an action lands, presses are ignored this long so one press is one action.
export const ACTION_LOCK = 0.35;
const MAX_HEAT = 9;
const FLOOR_NAMES = ["UNDER THE KITCHEN", "THE PIPEWORK", "FOUNDATIONS"];
const INK = [C.amber, C.cyan, C.ink];
const RGB = [LAMP.amber, LAMP.cyan, LAMP.green];

const RELICS = {
  gloves: { name: "WORK GLOVES", a: "Brace blocks 3 more.", b: "Pairs with nails / tape.", short: "BRACE +3" },
  nails: { name: "BENT NAILS", a: "Brace reflects up to 4", b: "of the damage it blocks.", short: "BLOCK > THORNS" },
  tin: { name: "COFFEE TIN", a: "Every second swing", b: "hits for 4 extra damage.", short: "2ND SWING +4" },
  magnet: { name: "SCREW TRAY", a: "First brace each fight", b: "charges 2 cells, not 1.", short: "FIRST BRACE +2" },
  cable: { name: "EXTENSION LEAD", a: "+2 battery capacity.", b: "+1 cell each new fight.", short: "BATTERY +2" },
  duck: { name: "RUBBER DUCK", a: "Drill weakens this and", b: "next enemy blow by 3.", short: "DRILL > WEAKEN" },
  vac: { name: "SHOP VAC", a: "Every defeated pest", b: "restores 3 health.", short: "KILL > HEAL 3" },
  tape: { name: "DUCT TAPE", a: "Fully block: heal 1.", b: "Up to 3 heals per fight.", short: "FULL BLOCK > HEAL" },
  fuse: { name: "SPARE FUSE", a: "Drill from full battery", b: "deals 6 extra damage.", short: "FULL DRILL +6" },
  crowbar: { name: "CROWBAR", a: "Swings ignore 3 armor", b: "and hit openings +2.", short: "SWING PIERCE 3" },
  thermos: { name: "THERMOS", a: "First damaging blow", b: "each fight is reduced 4.", short: "FIRST HIT -4" },
  warranty: { name: "WARRANTY", a: "Once per run: survive", b: "a fatal blow at 12 HP.", short: "ONE SECOND CHANCE" },
  ration: { name: "BISCUIT TIN", a: "Restore 8 health.", b: "Gain 2 loose screws.", short: "HEAL 8 / SCRAP 2" },
  battery: { name: "FRESH BATTERY", a: "Fill all battery cells.", b: "Gain 3 loose screws.", short: "FULL CELLS / SCRAP 3" },
};

const ENEMIES = {
  dust: { name: "DUST BUNNY", quip: "It has been paying no rent.", hp: 18, shell: 0, shape: 0,
    moves: [{ label: "SIZES YOU UP", hit: 0, open: true }, { label: "SMALL NIBBLE", hit: 3 }, { label: "DUST CLOUD", hit: 4 }] },
  mouse: { name: "SOCKET MOUSE", quip: "That explains the missing screws.", hp: 26, shell: 1, shape: 1,
    moves: [{ label: "COILS TO JUMP", hit: 0 }, { label: "LONG POUNCE", hit: 8 }, { label: "CATCHES BREATH", hit: 2, open: true }] },
  cable: { name: "LOOSE WIRE", quip: "The previous owner said it was fine.", hp: 29, shell: 0, shape: 2,
    moves: [{ label: "HUMS OMINOUSLY", hit: 0 }, { label: "LIVE CONTACT", hit: 9 }, { label: "WEAK SPARK", hit: 4, open: true }] },
  can: { name: "PAINT CAN CRAB", quip: "The lid is now structural.", hp: 28, shell: 2, shape: 3,
    moves: [{ label: "SHUTS ITS LID", hit: 0, shield: 5 }, { label: "ROLLS AT YOU", hit: 6 }, { label: "STUCK ON A NAIL", hit: 0, open: true }, { label: "LID SLAM", hit: 9 }] },
  mold: { name: "LOAD-BEARING MOLD", quip: "Please do not remove that wall.", hp: 34, shell: 1, shape: 0,
    moves: [{ label: "THICKENS", hit: 0, shield: 4 }, { label: "SPORE CLOUD", hit: 8 }, { label: "AIRING OUT", hit: 0, open: true }, { label: "SECOND COAT", hit: 9 }] },
  tenant: { name: "TINY SQUATTER", quip: "It has opinions about your mortgage.", hp: 36, shell: 1, shape: 4,
    moves: [{ label: "THROWS A MUG", hit: 6 }, { label: "BUILDS A FORT", hit: 0, shield: 6 }, { label: "CLAIMS THE ROOM", hit: 10 }, { label: "TAKES A BREAK", hit: 0, open: true }] },
  sump: { name: "THE SUMP KING", quip: "The pump has formed a union.", hp: 50, shell: 1, shape: 5, boss: true,
    moves: [{ label: "BUILDS PRESSURE", hit: 0 }, { label: "PRESSURE WAVE", hit: 9 }, { label: "LEAKING SEAL", hit: 2, open: true }, { label: "PIPE SWEEP", hit: 7 }] },
  owner: { name: "THE PREVIOUS OWNER", quip: '"Just needs a coat of paint."', hp: 64, shell: 2, shape: 4, boss: true,
    moves: [{ label: "BAD WIRING", hit: 7 }, { label: "COVERS IT UP", hit: 0, shield: 7 }, { label: "HIDDEN LEAK", hit: 12 }, { label: "COFFEE BREAK", hit: 0, open: true }] },
  invoice: { name: "UNPAID INVOICE", quip: "It has accrued a personality.", hp: 80, shell: 2, shape: 6, boss: true,
    moves: [{ label: "LATE FEE", hit: 9 }, { label: "FINE PRINT", hit: 0, shield: 8 }, { label: "COMPOUND INTEREST", hit: 13 }, { label: "DUE TOMORROW", hit: 0, open: true }] },
};
const BOSSES = ["sump", "owner", "invoice"];
export const GUIDE = [
  { head: "ONE BUTTON, THREE CARDS", lines: ["Your three choices are the cards along the bottom, one per lamp.",
    "TAP to move to the next card. Its lamp lights up.", "HOLD the button, then RELEASE, to do that card.", "Nothing here moves on a clock. Take as long as you like."],
    lamps: [{ rgb: LAMP.amber, label: "LEFT CARD", sub: "swing in a fight" }, { rgb: LAMP.cyan, label: "MIDDLE CARD", sub: "brace in a fight" },
      { rgb: LAMP.green, label: "RIGHT CARD", sub: "drill in a fight" }, { rgb: LAMP.red, label: "YOUR HEALTH", sub: "green full, red low" }] },
  { head: "FIGHTING PESTS", lines: ["The pest shows what it will do after your next action.",
    "SWING hits it; armor soaks some. BRACE blocks and charges a cell.", "DRILL spends 2 cells and ignores armor. Short of cells, it RECHARGES.",
    "Brace before a big hit. Swing when it shows an OPENING."] },
  { head: "THE HOUSE", lines: ["Win a fight and pick one of three finds. You carry three relics.",
    "Between fights, choose a room: another fight or a safe room.", "Three levels, four rooms each; a boss waits in every fourth room.",
    "Your crawl is saved. HOW TO PLAY and NEW HOUSE are in the system menu."] },
];
const n = (value, low = 0, high = 1e7) => Number.isFinite(value) ? Math.floor(clamp(value, low, high)) : low;
const copy = (value) => JSON.parse(JSON.stringify(value));
const owns = (object, key) => typeof key === "string" && Object.prototype.hasOwnProperty.call(object, key);
const has = (r, id) => r.relics.includes(id);
const capacity = (r) => 4 + (has(r, "cable") ? 2 : 0);

function cleanRun(r) {
  if (!r || typeof r !== "object" || !Number.isFinite(r.hp) || !Number.isFinite(r.floor)) return null;
  const relics = Array.isArray(r.relics) ? [...new Set(r.relics.filter((id) => owns(RELICS, id) && id !== "ration" && id !== "battery"))].slice(0, 3) : [];
  const out = { hp: n(r.hp, 1, 40), maxHp: 40, cells: n(r.cells, 0, 6), scrap: n(r.scrap, 0, 999), power: n(r.power, 5, 10),
    heat: n(r.heat, 0, MAX_HEAT), floor: n(r.floor, 1, 3), room: n(r.room, 0, 3), kills: n(r.kills, 0, 99),
    turns: n(r.turns, 0, 9999), age: n(r.age, 0, 1e6), relics, warrantyUsed: r.warrantyUsed === true };
  out.cells = Math.min(out.cells, capacity(out));
  return out;
}

export function migrateSave(raw) {
  const r = raw && typeof raw === "object" ? raw : {}, last = r.last && typeof r.last === "object" ? r.last : {};
  const sv = { schema: 1, guided: r.guided === true, runs: n(r.runs, 0, 1e9), milestone: n(r.milestone, 0, 30), wins: n(r.wins, 0, 1e9),
    unlockedHeat: n(r.unlockedHeat, 0, MAX_HEAT), last: { score: n(last.score), floor: n(last.floor, 0, 3), pests: n(last.pests, 0, 99),
      relics: n(last.relics, 0, 3), heat: n(last.heat, 0, MAX_HEAT), cleared: last.cleared === true || last.cleared === "YES" ? "YES" : "NO" }, active: null };
  const a = r.active;
  if (a && typeof a === "object") {
    const run = cleanRun(a.run), view = ["combat", "route", "loot", "replace"].includes(a.view) ? a.view : null;
    const foe = a.enemy && typeof a.enemy === "object" && owns(ENEMIES, a.enemy.id) ? a.enemy : null;
    const ids = Array.isArray(a.offers) ? a.offers.slice(0, 3).filter((id) => typeof id === "string") : [];
    const offers = view === "loot" || view === "replace" ? ids.filter((id) => owns(RELICS, id)) : ids.filter((id) => ["nest", "repair", "bench", "salvage", "supply", "rewire"].includes(id));
    const pendingLoot = owns(RELICS, a.pendingLoot) && !["ration", "battery"].includes(a.pendingLoot) ? a.pendingLoot : null;
    if (run && view && (view !== "combat" || foe) && (view === "combat" || offers.length === 3) && (view !== "replace" || (run.relics.length === 3 && pendingLoot && !has(run, pendingLoot)))) {
      sv.active = { run, view, offers, routeFoe: owns(ENEMIES, a.routeFoe) && !ENEMIES[a.routeFoe].boss ? a.routeFoe : "mouse",
        enemy: foe ? { id: foe.id, hp: n(foe.hp, 1, 600), maxHp: n(foe.maxHp, 1, 600), turn: n(foe.turn, 0, 999), shield: n(foe.shield, 0, 20),
          weak: n(foe.weak, 0, 2), swings: n(foe.swings, 0, 999), braced: foe.braced === true, thermosUsed: foe.thermosUsed === true, tapeHeals: n(foe.tapeHeals, 0, 3) } : null,
        pendingLoot, rng: Number.isFinite(a.rng) ? n(a.rng, 0, 4294967295) : null };
      if (view === "replace") sv.active.offers = [...run.relics];
      if (sv.active.enemy) sv.active.enemy.hp = Math.min(sv.active.enemy.hp, sv.active.enemy.maxHp);
    }
  }
  return sv;
}

export class Crawlspace {
  constructor(ctx) {
    this.c = ctx;
    this.lamps = new LampBus(ctx);
    this.sv = migrateSave(ctx.progress?.());
    this.t = 0; this.phase = "title"; this.view = "combat"; this.cursor = 0; this.lock = 0; this.guide = -1;
    this.overAt = 0; this.won = false; this.run = null; this.enemy = null; this.offers = []; this.routeFoe = "mouse"; this.pendingLoot = null;
    this.log = ["One button. Three choices. A very ordinary house.", "Tap to move between cards. Hold and release to do one."];
    this.pulseHit = 0; this.pulsePlayer = 0; this.lastAction = -1; this.held = false; this.pressAt = 0;
    this.c.hint(this.sv.active ? "Press to continue your saved crawl. The system menu also offers NEW HOUSE and HOW TO PLAY." : "Press to begin. Tap moves between cards; hold and release does one. Enemies wait for you.");
    this.guard = new AppGuard(this, ctx);
  }
  start(heat = 0, resume = false) {
    this.phase = "play"; this.cursor = 0; this.lock = ACTION_LOCK; this.won = false; this.lastAction = -1;
    if (resume && this.sv.active) {
      const a = copy(this.sv.active);
      this.run = a.run; this.view = a.view; this.enemy = a.enemy; this.offers = a.offers; this.routeFoe = a.routeFoe; this.pendingLoot = a.pendingLoot;
      if (a.rng !== null && this.c.rng) this.c.rng.state = a.rng;
      this.log = ["BACK UNDER THE HOUSE", "Your health, tools and choices are just as you left them."];
      this.setHint();
      return;
    }
    this.pendingLoot = null;
    this.run = { hp: 40, maxHp: 40, cells: 2, scrap: 0, power: 5, heat: n(heat, 0, MAX_HEAT), floor: 1, room: 0,
      kills: 0, turns: 0, age: 0, relics: [], warrantyUsed: false };
    this.enterCombat("dust");
    this.log = ["A DUST BUNNY HAS CLAIMED THE CRAWLSPACE.", "It is sizing you up. Hold and release on SWING to hit it."];
    this.checkpoint();
  }
  setHint() {
    const hints = { combat: "SWING / BRACE / DRILL: tap moves to the next card, hold and release does it. Waiting is safe.",
      route: "Choose a room: tap moves, hold and release goes there. Costs are paid only when you choose.",
      loot: "Carry three relics. Choose a find, or take supplies without changing your build.",
      replace: "Your three tool slots are full. Choose the old relic to leave behind." };
    this.cursor = 0;
    this.c.hint(hints[this.view]);
  }
  selected() { return this.cursor; }
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
    if (this.phase === "title") {
      if (!this.sv.guided) { this.guide = 0; return; }
      this.start(0, !!this.sv.active); return;
    }
    if (this.phase === "over" && this.t - this.overAt < LOCKOUT) return;
    if (!long) { this.cursor = (this.cursor + 1) % 3; this.c.tone(520 + this.cursor * 60, 0.025, "triangle"); return; }
    if (this.phase === "over") {
      const k = this.cursor;
      if (k === 0) this.start(0);
      else if (k === 1 && this.won) this.start(Math.min(MAX_HEAT, this.run.heat + 1));
      else if (k === 1) this.start(this.run.heat);
      else { this.phase = "title"; this.c.hint("Press to start a new crawl."); }
      return;
    }
    if (this.lock > 0) return;
    this.choose(this.cursor);
  }
  openGuide() { this.guide = 0; this.held = false; }
  closeGuide() {
    this.guide = -1;
    if (!this.sv.guided) { this.sv.guided = true; if (this.phase !== "play") this.c.saveProgress(copy(this.sv))?.catch?.(this.c.error); }
    if (this.phase === "title") this.start(0, !!this.sv.active);
  }
  choose(index) {
    if (this.phase !== "play" || this.lock > 0) return;
    this.lastAction = index;
    if (this.view === "combat") this.act(index);
    else if (this.view === "route") this.chooseRoute(this.offers[index]);
    else if (this.view === "replace") this.swapLoot(index);
    else this.takeLoot(this.offers[index]);
    this.lock = ACTION_LOCK;
  }
  randomFoe() {
    const pool = this.run.floor === 1 ? ["mouse", "can", "cable"] : this.run.floor === 2 ? ["can", "cable", "mold"] : ["tenant", "mold", "can"];
    return pool[this.c.rng.int(0, pool.length - 1)];
  }
  enterCombat(id) {
    const r = this.run, def = ENEMIES[id];
    const hp = def.hp + (def.boss ? 0 : (r.floor - 1) * 4) + r.heat * (def.boss ? 10 : 5);
    this.enemy = { id, hp, maxHp: hp, turn: 0, shield: 0, weak: 0, swings: 0, braced: false, thermosUsed: false, tapeHeals: 0 };
    if (has(r, "cable")) r.cells = Math.min(capacity(r), r.cells + 1);
    this.view = "combat"; this.offers = [];
    this.log = [def.name, def.quip]; this.setHint();
  }
  intent() {
    const e = this.enemy, r = this.run, def = ENEMIES[e.id], move = def.moves[e.turn % def.moves.length];
    const escalation = Math.floor(e.turn / 6);
    const floorModifier = def.boss ? 0 : r.floor === 1 ? -2 : r.floor - 1;
    const hit = move.hit ? Math.max(1, move.hit + r.heat * 2 + floorModifier + escalation) : 0;
    return { ...move, hit, escalation };
  }
  preview(index) {
    const r = this.run, e = this.enemy, def = ENEMIES[e.id], intent = this.intent();
    const drill = index === 2 && r.cells >= 2;
    let raw = 0, hit = 0, armor = 0, block = 0, cells = 0, reflect = 0;
    if (index === 0) {
      raw = r.power + (intent.open ? 2 + (has(r, "crowbar") ? 2 : 0) : 0) + (has(r, "tin") && e.swings % 2 === 1 ? 4 : 0);
      armor = Math.max(0, def.shell + e.shield - (has(r, "crowbar") ? 3 : 0));
      hit = Math.max(0, raw - armor);
    } else if (index === 1) { block = 7 + (has(r, "gloves") ? 3 : 0); cells = 1 + (has(r, "magnet") && !e.braced ? 1 : 0); }
    else if (drill) { raw = 11 + (intent.open ? 2 : 0) + (has(r, "fuse") && r.cells === capacity(r) ? 6 : 0); hit = raw; cells = -2; }
    else cells = 2;
    const weak = e.weak > 0 || (drill && has(r, "duck"));
    const incoming = Math.max(0, intent.hit - (weak ? 3 : 0));
    let taken = Math.max(0, incoming - block);
    const thermos = taken > 0 && has(r, "thermos") && !e.thermosUsed;
    if (thermos) taken = Math.max(0, taken - 4);
    if (index === 1 && has(r, "nails")) reflect = Math.min(4, incoming, block);
    const lethal = hit >= e.hp;
    return { raw, hit, armor, block, cells, drill, incoming, taken: lethal ? 0 : taken, thermos: !lethal && thermos, reflect: lethal ? 0 : reflect, lethal };
  }
  act(index) {
    const r = this.run, e = this.enemy, p = this.preview(index), intent = this.intent();
    let description;
    if (index === 0) {
      e.swings++; e.hp -= p.hit;
      // A swing uses up the part of a temporary shield it reaches; shell remains intact.
      e.shield = Math.max(0, e.shield - Math.max(0, p.raw - ENEMIES[e.id].shell));
      description = "SWING: " + p.hit + " damage" + (p.hit === 0 ? "; armor absorbs it" : "");
    } else if (index === 1) {
      e.braced = true; description = "BRACE: block " + p.block + ", charge " + p.cells;
    } else if (p.drill) {
      e.hp -= p.hit;
      if (has(r, "duck")) e.weak = 2;
      description = "DRILL: " + p.hit + " damage through armor";
    } else description = "RECHARGE: gain 2 battery cells";
    r.cells = clamp(r.cells + p.cells, 0, capacity(r)); r.turns++;
    if (p.hit) this.pulseHit = 0.24;
    if (e.hp <= 0) { this.victory(); return; }
    if (p.thermos) e.thermosUsed = true;
    r.hp -= p.taken;
    if (p.taken) { this.pulsePlayer = 0.3; this.lamps.flash(0.22, () => fill(LAMP.red, 0.5)); }
    if (index === 1 && p.incoming > 0 && p.incoming <= p.block && has(r, "tape") && e.tapeHeals < 3) { r.hp = Math.min(r.maxHp, r.hp + 1); e.tapeHeals++; }
    e.hp -= p.reflect;
    e.shield = Math.min(20, e.shield + (intent.shield || 0));
    e.weak = Math.max(0, e.weak - 1); e.turn++;
    this.log = [description.toUpperCase(), (p.taken ? "YOU TAKE " + p.taken + "." : "NO HEALTH LOST.") + (p.reflect ? " NAILS RETURN " + p.reflect + "." : "") + (intent.shield ? " FOE GAINS " + intent.shield + " SHIELD." : "")];
    this.c.tone(index === 1 ? 260 : p.drill ? 390 : 310, 0.055, "triangle");
    if (r.hp <= 0 && has(r, "warranty") && !r.warrantyUsed) {
      r.hp = 12; r.warrantyUsed = true; this.log[1] = "WARRANTY HONORED. RESTORED TO 12 HEALTH.";
    }
    if (r.hp <= 0) { r.hp = 0; this.end(false); return; }
    if (e.hp <= 0) this.victory();
  }
  victory() {
    const r = this.run, def = ENEMIES[this.enemy.id];
    r.kills++; r.scrap = Math.min(999, r.scrap + 3 + r.floor + (def.boss ? 2 : 0));
    if (has(r, "vac")) r.hp = Math.min(r.maxHp, r.hp + 3);
    this.c.tone(660, 0.1, "triangle"); this.lamps.flash(0.3, () => fill(LAMP.green, 0.55));
    if (r.floor === 3 && r.room === 3) { this.end(true); return; }
    this.view = "loot";
    const pool = Object.keys(RELICS).filter((id) => !has(r, id) && id !== "ration" && id !== "battery");
    this.offers = [];
    while (this.offers.length < 2 && pool.length) { const at = this.c.rng.int(0, pool.length - 1); this.offers.push(pool.splice(at, 1)[0]); }
    this.offers.push("ration");
    this.log = [def.name + " DEALT WITH.", "+" + (3 + r.floor + (def.boss ? 2 : 0)) + " SCRAP. CHOOSE ONE USEFUL BIT OF JUNK."];
    this.setHint(); this.checkpoint();
  }
  takeLoot(id) {
    const r = this.run;
    if (!owns(RELICS, id)) return;
    if (id === "ration") { r.hp = Math.min(r.maxHp, r.hp + 8); r.scrap = Math.min(999, r.scrap + 2); }
    else if (id === "battery") { r.cells = capacity(r); r.scrap = Math.min(999, r.scrap + 3); }
    else if (!has(r, id)) {
      if (r.relics.length === 3) {
        this.pendingLoot = id; this.offers = [...r.relics]; this.view = "replace";
        this.log = ["MAKE ROOM FOR " + RELICS[id].name + ".", RELICS[id].a + " " + RELICS[id].b];
        this.setHint(); this.checkpoint(); return;
      }
      r.relics.push(id); if (id === "cable") r.cells = Math.min(capacity(r), r.cells + 2);
    }
    this.log = [RELICS[id].name + " ADDED TO YOUR KIT.", RELICS[id].a + " " + RELICS[id].b];
    this.advance();
  }
  swapLoot(index) {
    const r = this.run, old = r.relics[index], id = this.pendingLoot;
    if (!old || !id) return;
    r.relics[index] = id;
    r.cells = Math.min(capacity(r), r.cells + (id === "cable" ? 2 : 0));
    this.pendingLoot = null;
    this.log = [RELICS[id].name + " REPLACES " + RELICS[old].name + ".", "THREE TOOLS. ONE VERY PERSONAL BUILD."];
    this.advance();
  }
  advance() {
    const r = this.run;
    r.room++;
    if (r.room >= 4) {
      r.room = 0; r.floor++;
      r.hp = Math.min(r.maxHp, r.hp + 8); r.cells = Math.min(capacity(r), r.cells + 1);
      this.enterCombat(this.randomFoe());
      this.log = ["DOWN ANOTHER LEVEL. YOU TAKE A BREATHER.", "RESTORED 8 HEALTH AND 1 CELL. " + FLOOR_NAMES[r.floor - 1] + "."];
    } else if (r.room === 3) this.enterCombat(BOSSES[r.floor - 1]);
    else {
      this.view = "route"; this.routeFoe = this.randomFoe();
      this.offers = ["nest", this.c.rng.next() < 0.55 ? "repair" : "bench", this.c.rng.next() < 0.5 ? "salvage" : (this.c.rng.next() < 0.5 ? "supply" : "rewire")];
      this.setHint();
    }
    this.checkpoint();
  }
  chooseRoute(id) {
    const r = this.run;
    if (id === "nest") { this.enterCombat(this.routeFoe); this.checkpoint(); return; }
    if (id === "repair") {
      const cost = r.scrap >= 3 ? 3 : 0, heal = cost ? 12 : 5;
      r.scrap -= cost; r.hp = Math.min(r.maxHp, r.hp + heal);
      this.log = [cost ? "A PROPER PATCH JOB." : "A CUP OF TEA WILL HAVE TO DO.", "RESTORED " + heal + " HEALTH" + (cost ? " FOR 3 SCRAP." : ".")];
    } else if (id === "bench") {
      if (r.scrap >= 6 && r.power < 10) { r.scrap -= 6; r.power++; this.log = ["HAMMER IMPROVED.", "SWINGS NOW DEAL " + r.power + " BASE DAMAGE."]; }
      else { r.scrap = Math.min(999, r.scrap + 4); this.log = ["SORTED THE MYSTERY HARDWARE.", "FOUND 4 USABLE SCRAP."]; }
    } else if (id === "salvage") {
      if (r.hp <= 4) { this.log = ["THAT FLOORBOARD CAN WAIT.", "YOU NEED MORE THAN 4 HEALTH TO PRY IT OPEN."]; return; }
      r.hp -= 4; r.scrap = Math.min(999, r.scrap + 9); this.log = ["A SPLINTER. A LOT OF SCREWS.", "TRADED 4 HEALTH FOR 9 SCRAP."];
    } else if (id === "rewire") {
      if (r.cells >= 2) { r.cells -= 2; r.hp = Math.min(r.maxHp, r.hp + 10); r.scrap = Math.min(999, r.scrap + 3); this.log = ["LIGHTS BACK ON. BREATHER TAKEN.", "2 CELLS BECOME 10 HEALTH AND 3 SCRAP."]; }
      else { r.cells = Math.min(capacity(r), r.cells + 2); this.log = ["BORROWED POWER FROM THE FRIDGE.", "GAINED 2 BATTERY CELLS."]; }
    } else { r.cells = Math.min(capacity(r), r.cells + 1); r.scrap = Math.min(999, r.scrap + 4); this.log = ["THE PREVIOUS OWNER LEFT SOMETHING USEFUL.", "FOUND 4 SCRAP AND 1 CELL."]; }
    this.advance();
  }
  checkpoint() {
    if (this.phase !== "play") return;
    this.sv.active = { run: copy(this.run), view: this.view, enemy: this.enemy ? copy(this.enemy) : null, offers: [...this.offers], routeFoe: this.routeFoe, pendingLoot: this.pendingLoot, rng: this.c.rng.state };
    this.c.saveProgress(copy(this.sv))?.catch?.(this.c.error);
  }
  end(won) {
    if (this.phase === "over") return;
    const r = this.run;
    this.phase = "over"; this.won = won; this.overAt = this.t; this.cursor = 0; this.sv.active = null;
    const score = Math.round(((r.floor - 1) * 350 + r.room * 70 + r.kills * 85 + r.relics.length * 30 + (won ? 1200 + r.hp * 8 : 0)) * (1 + r.heat * 0.35));
    this.sv.runs++; if (won) this.sv.wins++;
    this.sv.milestone = Math.max(this.sv.milestone, won ? (r.heat + 1) * 3 : (r.heat * 3 + r.floor - 1));
    if (won) this.sv.unlockedHeat = Math.min(MAX_HEAT, Math.max(this.sv.unlockedHeat, r.heat + 1));
    this.sv.last = { score, floor: r.floor, pests: r.kills, relics: r.relics.length, heat: r.heat, cleared: won ? "YES" : "NO" };
    this.c.score(score); this.c.saveProgress(copy(this.sv))?.catch?.(this.c.error);
    this.c.hint(won ? "House secured. Tap to move between cards; hold and release to choose a fresh crawl or a tougher house." : "You made it back upstairs. Tap to move; hold and release to start fresh, retry this depth, or go back to the title.");
  }
  cancel() { this.guard.rewind(); this.lamps.clear(); this.held = false; }
  pause() { this.guard.settle(); this.lamps.sleep(); }
  resume() { this.lamps.wake(); }
  dispose() { this.guard.settle(); this.lamps.sleep(); if (this.phase === "play") this.checkpoint(); }
  menuActions() {
    const actions = [{ label: "HOW TO PLAY", run: () => this.openGuide() }, { label: "NEW HOUSE", run: () => { this.guide = -1; this.start(0); } }];
    if (this.sv.unlockedHeat > 0) actions.push({ label: "HEAT " + this.sv.unlockedHeat + " HOUSE", run: () => { this.guide = -1; this.start(this.sv.unlockedHeat); } });
    return actions;
  }
  update(dt) {
    this.guard.tick(dt);
    this.t += dt; this.pulseHit = Math.max(0, this.pulseHit - dt); this.pulsePlayer = Math.max(0, this.pulsePlayer - dt);
    if (this.phase === "play" && this.guide < 0) { this.run.age += dt; this.lock = Math.max(0, this.lock - dt); }
    const r = this.run;
    this.c.hud(r ? [["HEALTH", r.hp + "/" + r.maxHp], ["CELLS", r.cells + "/" + capacity(r)], ["SCRAP", r.scrap], ["LEVEL", r.floor + (r.heat ? " / HEAT " + r.heat : " / 3")]] : [["CLEARED", this.sv.wins], ["CRAWLS", this.sv.runs], ["BEST", this.c.best()]]);
    this.lamps.frame(dt, this.lampPicture());
  }
  // Lamp 4's colour: health from red (empty) to green (full), blinking when the next blow could finish you.
  healthLamp() {
    const r = this.run;
    if (!r || this.phase !== "play") return null;
    const colour = ramp(r.hp / r.maxHp, [LAMP.red, LAMP.amber, LAMP.green]);
    const danger = this.view === "combat" && Math.max(0, this.intent().hit - (this.enemy.weak ? 3 : 0)) >= r.hp;
    return dim(colour, danger ? 0.25 + 0.7 * blink(this.t, 2.5) : 0.75);
  }
  lampPicture() {
    const n = lampCount(this.c);
    if (this.guide >= 0) {
      const keys = GUIDE[0].lamps;
      return withFourth(lamps(...keys.slice(0, 3).map((k) => dim(k.rgb, 0.6))), dim(LAMP.green, 0.6), n);
    }
    if (this.phase === "title") return withFourth(lamps(...RGB.map((c, i) => dim(c, 0.08 + 0.28 * Math.max(0, Math.sin(this.t * 1.5 - i * 1.4))))), dim(LAMP.green, 0.12), n);
    // The card you are on is bright; a hold that is ready to release turns it white.
    const ready = holdFraction(this) >= 1;
    const three = lamps(...RGB.map((c, i) => dim(i === this.cursor && ready ? LAMP.white : c, i === this.cursor ? 0.95 : 0.08)));
    return withFourth(three, this.healthLamp(), n);
  }
  cards() {
    if (this.phase === "over") return [{ title: "NEW HOUSE", a: "Fresh tools. Fresh route.", b: "Normal difficulty." },
      { title: this.won ? "ONE LEVEL DEEPER" : "TRY AGAIN", a: "Start a new full run.", b: "Heat " + (this.won ? Math.min(MAX_HEAT, this.run.heat + 1) : this.run.heat) + ": tougher pests." },
      { title: "BACK UPSTAIRS", a: "Return to the title.", b: "Your record is saved." }];
    if (this.view === "loot") return this.offers.map((id) => ({ title: RELICS[id].name, a: RELICS[id].a, b: RELICS[id].b }));
    if (this.view === "replace") return this.run.relics.map((id) => ({ title: RELICS[id].name, a: "Leave this relic behind.", b: RELICS[id].short }));
    const r = this.run;
    if (this.view === "route") return this.offers.map((id) => {
      if (id === "nest") return { title: "FOLLOW THE NOISE", a: ENEMIES[this.routeFoe].name, b: "Fight for scrap + a relic." };
      if (id === "repair") return { title: r.scrap >= 3 ? "PATCH YOURSELF UP" : "CUP OF TEA", a: r.scrap >= 3 ? "Spend 3 scrap: heal 12." : "Restore 5 health.", b: "Skip this room's fight." };
      if (id === "bench") return { title: r.scrap >= 6 && r.power < 10 ? "WORKBENCH" : "SORT THE SCREWS", a: r.scrap >= 6 && r.power < 10 ? "Spend 6 scrap: swing +1." : "Gain 4 scrap.", b: "Skip this room's fight." };
      if (id === "salvage") return { title: "PRY A FLOORBOARD", a: "Lose 4 health: +9 scrap.", b: r.hp <= 4 ? "Too hurt. Choose another." : "No fight. One splinter.", disabled: r.hp <= 4 };
      if (id === "rewire") return { title: r.cells >= 2 ? "FIX THE LIGHTS" : "BORROW A CHARGER", a: r.cells >= 2 ? "Spend 2 cells: heal 10." : "Gain 2 battery cells.", b: r.cells >= 2 ? "Find 3 scrap as well." : "Skip this room's fight." };
      return { title: "OLD STORAGE BOX", a: "Gain 4 scrap and 1 cell.", b: "Skip this room's fight." };
    });
    const ps = [0, 1, 2].map((i) => this.preview(i));
    return [
      { title: "SWING", a: ps[0].hit + " damage" + (ps[0].armor ? " (armor " + ps[0].armor + ")" : ""), b: ps[0].lethal ? "Finishes foe. No hit back." : "Then take " + ps[0].taken + " damage." },
      { title: "BRACE", a: "Block " + ps[1].block + ". Gain " + ps[1].cells + " cell" + (ps[1].cells > 1 ? "s." : "."), b: "Take " + ps[1].taken + (ps[1].reflect ? ". Nails deal " + ps[1].reflect + "." : " damage." ) },
      { title: ps[2].drill ? "DRILL" : "RECHARGE", a: ps[2].drill ? ps[2].hit + " damage. Costs 2 cells." : "Gain 2 cells. No attack.", b: ps[2].lethal ? "Finishes foe. No hit back." : "Then take " + ps[2].taken + " damage." },
    ];
  }
  draw(g) {
    if (this.guide >= 0) { drawGuide(g, "CRAWLSPACE", GUIDE, this.guide, lampCount(this.c)); return; }
    g.fillStyle = C.bg; g.fillRect(0, 0, 960, 540);
    g.save();
    // A cheap structural backdrop: floor joists, brick seams and pipework.
    g.strokeStyle = C.dark; g.lineWidth = 2;
    for (let i = 0; i < 12; i++) { g.beginPath(); g.moveTo(12 + i * 88, 0); g.lineTo(12 + i * 88, 330); g.stroke(); }
    line(g, 0, 344, 960, 344, C.line, 2);
    if (this.phase === "title") { this.drawTitle(g); g.restore(); return; }
    if (this.phase === "over") this.drawOver(g);
    else {
      const r = this.run;
      text(g, "CRAWLSPACE", 26, 28, 20, C.muted);
      text(g, FLOOR_NAMES[r.floor - 1] + "  " + (r.room + 1) + "/4", 934, 28, 19, C.amber, "right");
      if (this.view === "combat") this.drawCombat(g);
      else this.drawDecision(g);
    }
    this.drawCards(g); g.restore();
    g.globalAlpha = 1;
  }
  drawTitle(g) {
    // A literal cross-section: home above, ridiculous problems below.
    line(g, 74, 139, 167, 63, C.ink, 3); line(g, 167, 63, 260, 139, C.ink, 3);
    g.strokeStyle = C.line; g.lineWidth = 3; g.strokeRect(100, 139, 135, 85); g.strokeRect(149, 173, 32, 51);
    line(g, 62, 238, 283, 238, C.amber, 2);
    this.drawPest(g, "dust", 169, 287, 0.6);
    text(g, "CRAWLSPACE", 593, 116, 45, C.ink, "center");
    text(g, "A HOUSEHOLD ROGUELIKE", 593, 166, 19, C.amber, "center");
    text(g, "The house makes a noise.", 593, 222, 22, C.ink, "center");
    text(g, "You have a hammer, a drill and a mortgage.", 593, 256, 19, C.muted, "center");
    if (this.sv.unlockedHeat > 0) text(g, "HEAT " + this.sv.unlockedHeat + " AVAILABLE IN THE SYSTEM MENU", 593, 305, 17, C.cyan, "center");
    text(g, "TAP: NEXT CARD    HOLD + RELEASE: DO IT", 480, 367, 23, C.ink, "center");
    text(g, "SWING  /  BRACE  /  DRILL", 480, 409, 21, C.cyan, "center");
    text(g, "Each card has a lamp. Enemies wait as long as you need.", 480, 445, 18, C.muted, "center");
    text(g, this.sv.active ? "PRESS TO CONTINUE YOUR SAVED CRAWL" : this.sv.guided ? "PRESS TO GO DOWNSTAIRS" : "PRESS TO LEARN HOW TO PLAY", 480, 500, 21, C.amber, "center");
  }
  drawCombat(g) {
    const r = this.run, e = this.enemy, def = ENEMIES[e.id], intent = this.intent();
    text(g, lampCount(this.c) === 4 ? "YOUR HEALTH  (LAMP 4)" : "YOUR HEALTH", 28, 78, 17, C.muted);
    text(g, r.hp + " / 40", 28, 122, 35, this.pulsePlayer > 0 ? C.red : C.ink);
    this.bar(g, 28, 151, 245, r.hp / r.maxHp, C.ink);
    text(g, "CELLS", 28, 183, 16, C.muted);
    for (let i = 0; i < capacity(r); i++) { g.fillStyle = i < r.cells ? C.cyan : C.dark; g.fillRect(101 + i * 26, 173, 18, 19); }
    text(g, "HAMMER " + r.power + "   SCRAP " + r.scrap, 28, 216, 17, C.muted);
    const relicLabel = r.relics.length ? RELICS[r.relics[(Math.floor(this.t / 3.4)) % r.relics.length]].short : "JUNK WILL BECOME YOUR BUILD";
    text(g, relicLabel, 28, 252, 17, C.cyan);
    text(g, "TURN " + (e.turn + 1) + (intent.escalation ? "  ANGRIER +" + intent.escalation : ""), 28, 286, 17, C.muted);
    this.drawPest(g, e.id, 405, 188, def.boss ? 1.08 : 0.9);
    text(g, def.name, 562, 80, 22, C.ink);
    text(g, "HP " + e.hp + "/" + e.maxHp + "    ARMOR " + def.shell + (e.shield ? " + " + e.shield : ""), 562, 117, 18, C.muted);
    this.bar(g, 562, 145, 360, e.hp / e.maxHp, C.amber);
    g.fillStyle = C.dark; g.fillRect(550, 170, 384, 92);
    text(g, "AFTER YOUR NEXT ACTION", 566, 191, 17, C.muted);
    text(g, intent.label, 566, 224, 21, intent.hit ? C.red : C.cyan);
    const hit = Math.max(0, intent.hit - (e.weak ? 3 : 0));
    text(g, hit ? "INCOMING: " + hit + " DAMAGE" : intent.shield ? "GAINS " + intent.shield + " SHIELD" : intent.open ? "OPENING: YOUR ATTACKS +2" : "NO ATTACK THIS TURN", 562, 284, 18, intent.hit ? C.amber : C.cyan);
    text(g, this.log[0], 480, 323, 18, C.ink, "center");
  }
  drawDecision(g) {
    const loot = this.view === "loot", replacing = this.view === "replace";
    text(g, replacing ? "THREE SLOTS. MAKE A CHOICE." : loot ? "SOME OF THIS JUNK IS GOOD." : "WHICH WAY THROUGH?", 480, 93, 29, C.ink, "center");
    text(g, this.log[0], 480, 135, 18, C.amber, "center");
    text(g, this.log[1], 480, 165, 18, C.muted, "center");
    text(g, "HP " + this.run.hp + "/40    CELLS " + this.run.cells + "/" + capacity(this.run) + "    SCRAP " + this.run.scrap, 480, 210, 21, C.ink, "center");
    const items = this.run.relics;
    if (!items.length) text(g, "YOUR FIRST FIND WILL SHAPE THE RUN.", 480, 267, 18, C.cyan, "center");
    else {
      const row = items.map((id) => RELICS[id].name);
      const cut = Math.ceil(row.length / 2);
      text(g, "KIT: " + row.slice(0, cut).join(" / "), 480, 256, 17, C.cyan, "center");
      if (cut < row.length) text(g, row.slice(cut).join(" / "), 480, 284, 17, C.cyan, "center");
    }
    text(g, replacing ? "CHOOSE THE RELIC TO LEAVE. THE OTHERS STAY." : loot ? "CARRY THREE RELICS. SUPPLIES NEED NO SLOT." : "FIGHTS GIVE FINDS. SAFE ROOMS KEEP YOU GOING.", 480, 325, 16, C.muted, "center");
  }
  drawOver(g) {
    text(g, this.won ? "THE HOUSE IS QUIET." : "BACK UPSTAIRS, FOR NOW.", 480, 83, 34, this.won ? C.ink : C.amber, "center");
    text(g, this.won ? "You can finally sit down. Probably." : "Some repairs will have to wait until the weekend.", 480, 132, 19, C.muted, "center");
    text(g, String(this.sv.last.score), 480, 201, 49, C.ink, "center");
    text(g, "SCORE", 480, 239, 16, C.muted, "center");
    text(g, "LEVEL " + this.run.floor + " / 3    " + this.run.kills + " PESTS    " + this.run.relics.length + " FINDS    HEAT " + this.run.heat, 480, 282, 19, C.cyan, "center");
    text(g, this.won ? "DEEPER: SAME THREE LEVELS, TOUGHER ENEMIES, MORE SCORE." : "Brace before big hits. Drill ignores armor. Spend your scrap.", 480, 323, 16, C.muted, "center");
  }
  drawCards(g) {
    const cards = this.cards(), selected = this.selected();
    for (let i = 0; i < 3; i++) {
      const x = 20 + i * 313, card = cards[i], active = i === selected;
      g.fillStyle = active ? C.dark : C.bg; g.fillRect(x, 363, 294, 143);
      g.strokeStyle = active ? INK[i] : C.line; g.lineWidth = active ? 3 : 1; g.strokeRect(x, 363, 294, 143);
      circle(g, x + 21, 385, 6, active ? INK[i] : C.line, active);
      text(g, "LAMP " + (i + 1) + (active ? "  < YOU ARE HERE" : ""), x + 38, 385, 15, active ? INK[i] : C.muted);
      text(g, card.title, x + 15, 417, card.title.length > 17 ? 18 : 21, card.disabled ? C.red : INK[i]);
      text(g, card.a, x + 15, 451, 17, card.disabled ? C.red : C.ink);
      text(g, card.b, x + 15, 477, 17, C.muted);
      if (active) { g.fillStyle = INK[i]; g.fillRect(x, 503, 294 * holdFraction(this), 4); }
    }
    drawPressHelp(g, this, 526, this.phase === "play" && this.view === "combat" ? "ACT" : "CHOOSE");
  }
  bar(g, x, y, width, value, color) {
    g.fillStyle = C.dark; g.fillRect(x, y, width, 9); g.fillStyle = color; g.fillRect(x, y, width * clamp(value, 0, 1), 9);
  }
  drawPest(g, id, x, y, scale) {
    const shape = ENEMIES[id].shape, c = this.pulseHit > 0 ? C.red : C.amber;
    g.save(); g.translate(x, y); g.scale(scale, scale); g.strokeStyle = c; g.lineWidth = 3;
    if (shape === 0) {
      for (let i = 0; i < 7; i++) { const a = i * 6.28318530718 / 7; circle(g, Math.cos(a) * 32, Math.sin(a) * 28, 22, c, false, 2); }
      circle(g, -22, -62, 14, c); circle(g, 22, -65, 12, c);
    } else if (shape === 1) {
      g.beginPath(); g.ellipse(0, 5, 47, 34, 0, 0, 6.28318530718); g.stroke(); circle(g, -25, -32, 22, c); circle(g, 24, -34, 22, c);
      line(g, 42, 19, 68, 37, c, 3); line(g, 68, 37, 53, 60, c, 3);
    } else if (shape === 2) {
      g.beginPath(); g.moveTo(-52, 52); g.bezierCurveTo(70, 50, -65, -72, 47, -27); g.stroke();
      line(g, 47, -27, 31, -61, c, 3); line(g, 47, -27, 75, -55, c, 3); line(g, 47, -27, 80, -10, c, 3);
    } else if (shape === 3 || shape === 5) {
      g.strokeRect(-41, -34, 82, 82); line(g, -49, -38, 49, -38, c, 4);
      for (const d of [-1, 1]) { line(g, d * 40, 17, d * 66, 35, c, 3); line(g, d * 66, 35, d * 62, 58, c, 3); }
      if (shape === 5) { line(g, -30, -42, -26, -67, c, 3); line(g, -26, -67, 0, -50, c, 3); line(g, 0, -50, 26, -67, c, 3); line(g, 26, -67, 30, -42, c, 3); }
    } else if (shape === 4) {
      circle(g, 0, -31, 25, c); g.strokeRect(-31, -6, 62, 64); line(g, -39, -47, 37, -47, c, 3);
      line(g, -18, 58, -23, 74, c, 3); line(g, 18, 58, 23, 74, c, 3); line(g, 33, 7, 58, 35, c, 3);
    } else {
      g.strokeRect(-43, -63, 86, 126);
      for (let i = 0; i < 5; i++) line(g, -27, -41 + i * 22, 27, -41 + i * 22, C.line, 2);
      text(g, "$", 0, 26, 50, c, "center");
    }
    circle(g, -13, -5, 4, C.ink, true); circle(g, 13, -5, 4, C.ink, true);
    g.restore();
  }
}
