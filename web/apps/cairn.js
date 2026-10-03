import { AppGuard } from "../engine/input.js";
import { LAMP, dim, fill, meter, spot } from "../engine/lightshow.js";
import { LampBus } from "./game-kit.js";
import { CAIRN_PHYSICS as P, PLATFORMS, CHECKPOINTS, SUMMIT, REGIONS, regionAt, chargeFor, launchFor, migrateSave as cleanSave } from "./cairn-content.js";
import { CairnView } from "./cairn-view.js";
export function migrateSave(raw) { return cleanSave(raw); }

export class Cairn extends CairnView {
  static saveSlots = true;
  constructor(ctx) {
    super(); this.c = ctx; this.lamps = new LampBus(ctx); this.save = migrateSave(ctx.progress?.());
    this.phase = "title"; this.t = 0; this.held = false; this.pressT = 0; this.armed = false;
    this.charge = 0; this.elapsed = 0; this.jumps = 0; this.falls = 0;
    this.anchor = 0; this.eligible = false; this.camera = 0; this.parts = []; this.note = ""; this.noteT = 0;
    this.impact = 0; this.hudKey = ""; this.overT = 0; this.peak = 0; this.region = 0;
    this.p = { x: 230, y: 0, vx: 0, vy: 0, facing: 1, ground: 0 }; this.safe = { platform: 0, x: 230, facing: 1 };
    this.guard = new AppGuard(this, ctx);
    this.setHint("Tap to climb. Hold / release to jump; a short tap turns.");
  }
  setHint(value) { this.c.hint?.(value); }
  start(fresh = false) {
    const active = !fresh && this.save.active;
    this.anchor = fresh ? 0 : active ? active.anchor : this.save.checkpoint;
    const platform = PLATFORMS[active ? active.platform : CHECKPOINTS[this.anchor]];
    this.p = { x: active ? active.x : platform.id ? platform.x + platform.w / 2 : 230, y: platform.y,
      vx: 0, vy: 0, facing: active ? active.facing : 1, ground: platform.id };
    this.safe = { platform: platform.id, x: this.p.x, facing: this.p.facing };
    this.elapsed = active ? active.seconds : 0; this.jumps = active ? active.jumps : 0; this.falls = active ? active.falls : 0;
    this.eligible = !active && platform.id === 0; this.peak = platform.y; this.phase = "play";
    this.region = regionAt(platform.y);
    this.camera = Math.max(0, platform.y - 110); this.parts = []; this.charge = 0; this.held = false; this.armed = false;
    this.overT = 0; this.impact = 0;
    if (!active) this.save.runs = Math.min(1e7, this.save.runs + 1);
    this.note = platform.id ? "A PLACE REMEMBERED" : "THE ROOTWORK"; this.noteT = 2.5;
    this.setHint("Hold: charge · release: leap · short tap / case tap: turn · no air steering");
    this.persist();
  }
  down() {
    this.guard.mark();
    if (this.held || !this.lamps.live) return;
    this.held = true; this.pressT = this.t;
    this.armed = this.phase === "play" ? this.p.ground >= 0 : this.phase !== "over" || this.overT >= 0.7;
  }
  up(event = {}) {
    this.guard.release();
    if (!this.held) return;
    const seconds = Number.isFinite(event.durationMs) ? Math.max(0, event.durationMs / 1000) : this.t - this.pressT;
    this.held = false; this.charge = 0;
    const armed = this.armed; this.armed = false;
    if (!armed || !this.lamps.live) return;
    if (this.phase === "title") { this.start(seconds >= 0.65); return; }
    if (this.phase === "over") { this.start(true); return; }
    if (this.phase !== "play" || this.p.ground < 0) return;
    if (seconds < P.tap) { this.turn(); return; }
    const velocity = launchFor(seconds);
    this.p.vx = velocity.vx * this.p.facing; this.p.vy = velocity.vy; this.p.ground = -1;
    this.jumps = Math.min(1e7, this.jumps + 1); this.peak = this.p.y;
    this.dust(this.p.x, this.p.y, 5); this.c.tone?.(210 + chargeFor(seconds) * 180, 0.045, "sine", 0.07);
  }
  turn(side) {
    if (this.phase !== "play" || this.p.ground < 0) return;
    this.p.facing = side === "left" ? -1 : side === "right" ? 1 : -this.p.facing;
    this.safe.facing = this.p.facing;
  }
  knock(event = {}) {
    if (this.held || !this.lamps.live) return;
    this.turn(this.c.settings?.().tapMode === "sides" ? event.side : undefined);
  }
  cancel() {
    this.guard.rewind(); this.held = false; this.armed = false; this.charge = 0;
    this.lamps.clear(); this.lamps.boardKey = "";
  }
  pause() { this.held = false; this.armed = false; this.charge = 0; this.guard.settle(); this.lamps.sleep(); this.lamps.boardKey = ""; }
  resume() { this.lamps.wake(); }
  dispose() { this.held = false; this.armed = false; this.charge = 0; this.guard.settle(); if (this.phase === "play") this.persist(); this.lamps.sleep(); this.lamps.boardKey = ""; }
  menuActions() {
    return [{ label: "NEW ASCENT FROM THE FOOT", run: () => { this.start(true); this.c.resume?.(); } },
      ...(this.save.checkpoint ? [{ label: "RETURN TO LAST CAIRN", run: () => {
        this.save.active = null; this.start(false); this.c.resume?.();
      } }] : [])];
  }
  update(dt) {
    if (!this.lamps.live) return;
    const step = Math.min(1 / 30, Math.max(0, Number.isFinite(dt) ? dt : 0));
    this.guard.tick(step); this.t += step; this.noteT = Math.max(0, this.noteT - step); this.impact = Math.max(0, this.impact - step);
    if (this.phase === "over") this.overT += step;
    if (this.phase === "play") {
      this.elapsed = Math.min(86400, this.elapsed + step);
      this.charge = this.held && this.armed && this.p.ground >= 0 ? chargeFor(this.t - this.pressT) : 0;
      if (this.p.ground < 0) {
        // Eight fixed microsteps at 60 Hz; collision travel remains below four pixels even in a long fall.
        const n = Math.ceil(step / (1 / 480));
        for (let i = 0; i < n && this.p.ground < 0 && this.phase === "play"; i++) this.physics(step / n);
      }
      this.peak = Math.max(this.peak, this.p.y);
      if (this.anchor && this.p.y < PLATFORMS[CHECKPOINTS[this.anchor]].y - 220) this.recover();
      const target = Math.max(0, Math.min(SUMMIT - 100, this.p.y - 110));
      this.camera += (target - this.camera) * Math.min(1, step * 5);
      // A terminal-speed fall must never outrun the lower edge of the viewport.
      this.camera = Math.max(0, Math.min(this.camera, this.p.y + 15));
    }
    for (const p of this.parts) { p.x += p.vx * step; p.y += p.vy * step; p.vy -= 230 * step; p.life -= step; }
    this.parts = this.parts.filter(p => p.life > 0);
    this.lighting(step); this.hud();
  }
  physics(dt) {
    const p = this.p, r = P.radius, h = P.height;
    p.vy = Math.max(-P.maxFall, p.vy - P.gravity * dt);
    const oldX = p.x, oldY = p.y;
    p.x += p.vx * dt;
    if (p.x < P.left + r || p.x > P.right - r) {
      p.x = Math.max(P.left + r, Math.min(P.right - r, p.x)); p.vx *= -0.4; this.impact = 0.14;
    }
    for (const s of PLATFORMS) {
      if (oldY >= s.y - 0.001 || oldY + h <= s.y - s.h + 0.001) continue;
      if (oldX + r <= s.x && p.x + r > s.x) { p.x = s.x - r; p.vx = -Math.abs(p.vx) * 0.35; this.impact = 0.14; }
      else if (oldX - r >= s.x + s.w && p.x - r < s.x + s.w) { p.x = s.x + s.w + r; p.vx = Math.abs(p.vx) * 0.35; this.impact = 0.14; }
    }
    p.y += p.vy * dt;
    for (const s of PLATFORMS) {
      if (p.x + r <= s.x || p.x - r >= s.x + s.w) continue;
      if (p.vy <= 0 && oldY >= s.y - 0.001 && p.y <= s.y) { this.land(s); break; }
      if (p.vy > 0 && oldY + h <= s.y - s.h + 0.001 && p.y + h >= s.y - s.h) {
        p.y = s.y - s.h - h; p.vy = 0; this.impact = 0.18;
      }
    }
  }
  land(s) {
    const drop = this.peak - s.y;
    if (drop > 300) { this.falls = Math.min(1e7, this.falls + 1); this.note = "STILL HERE."; this.noteT = 1.7; }
    this.p.y = s.y; this.p.vx = 0; this.p.vy = 0; this.p.ground = s.id;
    // A press begun in flight cannot become a charged jump merely by landing.
    this.armed = false; this.charge = 0;
    this.safe = { platform: s.id, x: this.p.x, facing: this.p.facing };
    this.dust(this.p.x, s.y, drop > 250 ? 8 : 4); this.impact = 0.18;
    this.c.tone?.(s.checkpoint ? 520 : 175, 0.045, "sine", 0.045);
    if (s.checkpoint > this.anchor) {
      this.anchor = s.checkpoint; this.save.checkpoint = Math.max(this.save.checkpoint, this.anchor); this.save.milestone = this.save.checkpoint;
      this.note = "CAIRN " + this.anchor + " / REMEMBERED"; this.noteT = 3.2;
    } else if (regionAt(s.y) !== this.region) {
      this.note = REGIONS[regionAt(s.y)].name; this.noteT = 2;
    }
    this.region = regionAt(s.y);
    if (s.y > this.save.highest) { this.save.highest = s.y; this.c.score?.(Math.floor(s.y / 10)); }
    if (s.summit) this.finish(); else this.persist();
  }
  recover() {
    const s = PLATFORMS[CHECKPOINTS[this.anchor]];
    this.falls = Math.min(1e7, this.falls + 1);
    this.p = { x: s.x + s.w / 2, y: s.y, vx: 0, vy: 0, ground: s.id, facing: 1 };
    this.safe = { platform: s.id, x: this.p.x, facing: 1 }; this.peak = s.y;
    this.held = false; this.armed = false; this.charge = 0;
    this.note = "THE CAIRN HOLDS."; this.noteT = 2.4; this.camera = Math.max(0, s.y - 110); this.persist();
  }
  finish() {
    this.phase = "over"; this.overT = 0; this.held = false; this.armed = false; this.charge = 0;
    this.save.summits = Math.min(1e7, this.save.summits + 1); this.save.highest = SUMMIT;
    if (this.eligible && (!this.save.bestSeconds || this.elapsed < this.save.bestSeconds)) this.save.bestSeconds = this.elapsed;
    this.save.last = { height: SUMMIT / 10, seconds: this.elapsed, jumps: this.jumps, falls: this.falls, summit: true };
    this.save.active = null; this.note = "A LIGHT ANSWERS."; this.noteT = 6;
    this.persist();
    this.setHint("Summit reached. Tap for a new ascent. Best ascent counts an uninterrupted climb from the foot.");
  }
  persist() {
    // Only cairns survive leaving the game; ordinary ledges are deliberately not save points.
    // The exact live pose is retained by pause(), but neither velocity nor a charged press is serialized.
    if (this.phase === "play") {
      const p = PLATFORMS[CHECKPOINTS[this.anchor]];
      this.save.active = { platform: p.id, x: p.id ? p.x + p.w / 2 : 230, facing: this.p.facing,
        seconds: this.elapsed, jumps: this.jumps, falls: this.falls, anchor: this.anchor };
    }
    this.c.saveProgress?.(structuredClone(this.save))?.catch?.(this.c.error);
  }
  dust(x, y, count) {
    if (this.c.settings?.().reducedMotion) return;
    for (let i = 0; i < count && this.parts.length < 36; i++) this.parts.push({ x, y: y + 2, vx: (i - count / 2) * 17,
      vy: 30 + (i * 19 % 55), life: 0.32 + (i % 3) * 0.09 });
  }
  lighting(dt) {
    const n = Math.max(3, Math.min(4, this.c.lampCount?.() || 4));
    const picture = this.phase === "over" ? fill(LAMP.amber, 0.5, n)
      : this.phase === "title" ? fill(LAMP.cyan, 0.12, n)
      : this.p.ground >= 0 ? this.held && this.armed ? meter(this.charge, LAMP.amber, dim(LAMP.cyan, 0.08), n)
        : spot(this.p.facing > 0 ? 1 : 0, LAMP.green, 1.4, n)
      : fill(this.p.vy >= 0 ? LAMP.cyan : LAMP.violet, 0.18 + 0.2 * Math.min(1, Math.abs(this.p.vy) / 700), n);
    this.lamps.frame(dt, picture);
    const board = this.phase === "over" ? dim(LAMP.amber, 0.45) : this.impact > 0 ? dim(LAMP.cyan, 0.3) : [0, 0, 0];
    const key = board.join(); if (key !== this.lamps.boardKey) { this.lamps.boardKey = key; this.c.board?.(board); }
  }
  hud() {
    const height = Math.max(0, Math.floor(this.p.y / 10)), best = Math.floor(this.save.highest / 10);
    const key = `${height}/${best}/${this.save.summits}`;
    if (key !== this.hudKey) { this.hudKey = key; this.c.hud?.([["HEIGHT", `${height}m`], ["HIGHEST", `${best}m`], ["SUMMITS", this.save.summits]]); }
  }
}
