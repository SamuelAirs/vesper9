import { clamp } from "../engine/math.js";
import { C, text, space, banner, glyph } from "../engine/draw.js";
import { LAMP, fill, only, meter, spot, dim } from "../engine/lightshow.js";
import { GestureGuard, LampBus, lampMax, announce, drawNote } from "./game-kit.js";

// ---------------------------------------------------------------------------------------------
const GLYPH_LIVES = [LAMP.red, LAMP.red, LAMP.amber, LAMP.green];
export class GlyphVault {
  constructor(ctx) {
    this.c = ctx;
    this.lamps = new LampBus(ctx);
    this.guard = new GestureGuard(this, ctx, ["sequence", "entered", "round", "points", "lives", "focus", "wait", "scan", "flash", "order", "step", "watchTotal"]);
    this.reset();
  }
  reset() {
    this.phase = "title";
    this.ended = null;
    this.overAt = 0;
    this.sequence = [];
    this.entered = [];
    this.round = 0;
    this.points = 0;
    this.lives = 3;
    this.focus = 0;
    this.order = [0, 1, 2, 3, 4, 5];   // the order the cursor visits the glyphs
    this.step = 0;
    this.wait = 0;
    this.watchTotal = 1;
    this.scan = 0;
    this.blip = 0;
    this.scanMs = this.c.settings().scanMs || 850;
    this.flash = 0;
    this.note = ""; this.noteT = 0;
    this.t = 0;
    this.c.hint(
      "Memorize the inscription. Press as each matching glyph is highlighted.",
    );
  }
  // The cursor quickens 3% with every inscription, down to 60% of the chosen interval.
  scanSeconds() { return (this.scanMs / 1000) * Math.max(0.6, 0.97 ** this.round); }
  next() {
    this.sequence = Array.from(
      { length: Math.min(3 + Math.floor(this.round / 2), 9) },
      () => this.c.rng.int(0, 5),
    );
    this.entered = [];
    this.phase = "watch";
    // Less time to memorise as the run goes on, never less than 1.8 s plus 0.25 s a glyph.
    this.wait = this.watchTotal = Math.max(1.8 + this.sequence.length * 0.25, 2.5 + this.sequence.length * 0.4 - this.round * 0.1);
    // From the sixth inscription the cursor visits the glyphs in a shuffled order.
    this.order = [0, 1, 2, 3, 4, 5];
    if (this.round >= 5) for (let i = 5; i > 0; i--) {
      const j = this.c.rng.int(0, i); [this.order[i], this.order[j]] = [this.order[j], this.order[i]];
    }
    this.step = 0;
    this.focus = this.order[0];
    this.scan = 0;
  }
  down() {
    this.guard.mark();
    if (this.phase === "title" || this.phase === "over") {
      if (this.guard.locked()) return;
      this.guard.stash();
      this.reset();
      this.next();
      return;
    }
    if (this.phase !== "choose") return;
    if (this.focus === this.sequence[this.entered.length]) {
      this.entered.push(this.focus);
      this.c.tone(500 + this.entered.length * 65, 0.1);
      if (this.entered.length === this.sequence.length) {
        // Faster cursors pay more: 850 ms is the reference.
        this.points += Math.round((100 + this.round * 20) * 850 / (this.scanSeconds() * 1000));
        this.round++;
        this.phase = "between";
        this.wait = 1.3;
        this.lamps.flash(0.6, (e, T) => spot(e / T, dim(LAMP.green, 0.55)));
        if (this.round === 5) announce(this, "THE CURSOR NOW SCRAMBLES");
        if (this.round % 2 === 0 && this.round <= 12) announce(this, "THE INSCRIPTION GROWS TO " + Math.min(3 + this.round / 2, 9) + " GLYPHS");
        if (this.round % 4 === 0 && this.lives < 3) { this.lives++; announce(this, "ATTEMPT RESTORED"); }
      }
    } else {
      this.lives--;
      this.flash = 0.45;
      this.c.tone(110, 0.18);
      this.lamps.flash(0.3, () => fill(LAMP.red, 0.6));
      if (this.lives <= 0) {
        this.guard.end([this.points, "scan" + this.scanMs], { inscriptions: this.round, score: this.points, scanMs: this.scanMs, milestone: this.round });
        this.lamps.flash(0.6, (e, T) => fill(LAMP.red, 0.6 * (1 - e / T)));
      }
    }
  }
  up() { this.guard.release(); }
  cancel() { this.guard.rewind(); this.lamps.clear(); }
  pause() {
    this.guard.settle();
    if (this.phase !== "over" && this.phase !== "title" && this.points > 0) this.c.score(this.points, "scan" + this.scanMs);
    this.lamps.sleep();
  }
  resume() { this.lamps.wake(); }
  dispose() { this.pause(); }
  // Watching: violet fades out over the memorising time. Choosing: a progress bar across the lamps
  // (green, amber or red by attempts left) with a white tick on the third of the row the cursor
  // is in each time it moves.
  lampValues() {
    if (this.phase === "watch") return fill(LAMP.violet, 0.33 * clamp(this.wait / this.watchTotal, 0, 1));
    if (this.phase === "choose") {
      const bar = meter(this.entered.length / this.sequence.length, dim(GLYPH_LIVES[this.lives], 0.3));
      return this.blip > 0 ? lampMax(bar, only(Math.floor(this.focus / 2), LAMP.white, 0.7)) : bar;
    }
    return null;
  }
  update(dt) {
    this.t += dt;
    this.guard.tick(dt);
    this.wait -= dt;
    this.flash = Math.max(0, this.flash - dt);
    this.blip = Math.max(0, this.blip - dt);
    if (this.noteT > 0) this.noteT -= dt;
    if (this.phase === "watch" && this.wait <= 0) {
      this.phase = "choose";
      this.c.hint("The glyph cursor advances automatically. Press to select.");
    }
    if (this.phase === "between" && this.wait <= 0) this.next();
    if (this.phase === "choose") {
      this.scan += dt;
      const interval = this.scanSeconds();
      while (this.scan >= interval) {
        this.scan -= interval;
        this.step = (this.step + 1) % 6;
        this.focus = this.order[this.step];
        this.blip = 0.07;
      }
    }
    this.lamps.frame(dt, this.lampValues());
    this.c.hud([
      ["SCAN", Math.round(this.scanSeconds() * 1000) + " ms"],
      ["INSCRIPTIONS", this.round],
      ["SCORE", this.points],
      ["ATTEMPTS", this.lives > 0 ? "◇".repeat(this.lives) : "0"],
    ]);
  }
  draw(g) {
    space(g, this.t, 0.2);
    const size = Math.min(76, 700 / Math.max(1, this.sequence.length));
    for (let i = 0; i < this.sequence.length; i++) {
      const x = 480 + (i - (this.sequence.length - 1) / 2) * size;
      g.strokeStyle = C.line;
      g.strokeRect(x - 29, 102, 58, 74);
      if (
        this.phase === "watch" ||
        this.phase === "between" ||
        i < this.entered.length
      )
        glyph(
          g,
          this.sequence[i],
          x,
          139,
          17,
          i < this.entered.length ? C.ink : C.amber,
        );
      else text(g, "·", x, 139, 30, C.line, "center");
    }
    if (this.phase === "watch")
      text(
        g,
        "COMMIT THE INSCRIPTION TO MEMORY",
        480,
        239,
        22,
        C.amber,
        "center",
      );
    for (let i = 0; i < 6; i++) {
      const x = 230 + i * 100,
        selected = this.phase === "choose" && i === this.focus;
      if (selected) {
        g.fillStyle = this.flash ? C.red : C.ink;
        g.fillRect(x - 39, 295, 78, 90);
      }
      glyph(g, i, x, 340, 23, selected ? C.bg : C.muted);
      text(g, String(i + 1), x, 406, 18, C.muted, "center");
    }
    drawNote(g, this);
    text(
      g,
      this.phase === "between"
        ? "THE ARCHIVE RECOGNIZES YOU."
        : this.phase === "choose" ? "PRESS WHEN THE NEXT GLYPH LIGHTS" : "",
      480,
      476,
      22,
      C.muted,
      "center",
    );
    if (this.phase === "title")
      banner(
        g,
        "GLYPH ARCHIVE",
        "Remember an inscription. Rebuild it one symbol at a time.",
      );
    if (this.phase === "over")
      banner(
        g,
        "ARCHIVE SEALED",
        `${this.round} inscriptions decoded / ${this.points} points`,
        C.amber,
      );
  }
}
