import { C, text, line, circle, diamond, space, banner } from "../engine/draw.js";
import { AppGuard } from "../engine/input.js";
import { LAMP, fill, only, meter, spot, dim, lightsOff } from "../engine/lightshow.js";
import { recordRun, LOCKOUT, LampBus, announce, drawNote } from "./game-kit.js";

// ---------------------------------------------------------------------------------------------
// Echo Vault. A hold of 350 ms or more is long. A hold on the wrong side of that line but within
// WOBBLE_MS of it is forgiven while the player has a wobble in hand (three at the start, one more
// every three sequences, at most four), so the run ends on a mistaken memory, not on a close call.
export const ECHO_LINE = 350;
export const WOBBLE_MS = 100;
export function echoHeard(ms, expected, wobbles) {
  const side = ms >= ECHO_LINE ? 1 : 0;
  if (side === expected) return { side, ok: true, wobble: false };
  if (Math.abs(ms - ECHO_LINE) <= WOBBLE_MS && wobbles > 0) return { side, ok: true, wobble: true };
  return { side, ok: false, wobble: false };
}
// A held press longer than this is no pulse the game asks for (the longest is about 0.7 s), so the
// sidetone stops: the worst a menu gesture costs the ear is two short beeps and a tone of this length.
export const ECHO_TONE_CAP = 0.75;
export class EchoVault {
  constructor(ctx) {
    this.c = ctx;
    this.lamps = new LampBus(ctx);
    this.guard = new AppGuard(this, ctx);
    this.reset();
  }
  reset() {
    this.phase = "title";
    this.sequence = [0, 1];
    this.entered = [];
    this.round = 0;
    this.feedback = "";
    this.index = 0;
    this.lit = false;
    this.wait = 0;
    this.active = -1;
    this.held = false;
    this.holdAt = 0;
    this.stepped = false;
    this.wobbles = 3;
    this.heard = null; this.heardT = 0;
    this.note = ""; this.noteT = 0;
    this.overAt = -LOCKOUT;
    this.t = 0;
    this.c.hint("Watch the pulse pattern. Repeat short taps and longer holds.");
  }
  // Playback quickens from the third sequence: gaps shrink and long pulses shorten (never below
  // 0.5 s, well clear of the 0.35 s line).
  tempo() { return Math.max(0.55, 1 - 0.045 * Math.max(0, this.round - 2)); }
  // From the eighth sequence the screen no longer lists the pulses during playback: only the lamps,
  // the three circles and the tone carry them.
  dark() { return this.round >= 8; }
  demonstrate() {
    this.phase = "show";
    this.index = 0;
    this.lit = false;
    this.wait = 0.6;
    this.entered = [];
    this.active = -1;
    this.c.hint("Receive the signal. Your turn follows the final pulse.");
  }
  down() {
    this.guard.mark();
    if (this.phase === "title" || this.phase === "over") {
      if (this.phase === "over" && this.t - this.overAt < LOCKOUT) return;
      this.reset();
      this.demonstrate();
      return;
    }
    if (this.phase === "listen") {
      this.held = true;
      this.holdAt = this.t;
      this.stepped = false;
      this.capped = false;
      this.heard = null;
      this.c.synth.startTone(440);
    }
  }
  up(event) {
    this.guard.release();
    if (this.phase === "listen" && this.held) {
      this.held = false;
      this.c.synth.stopTone();
      const ms = event.durationMs, slot = this.entered.length, want = this.sequence[slot];
      const verdict = echoHeard(ms, want, this.wobbles);
      this.heard = { ms: Math.round(ms), side: verdict.side, ok: verdict.ok, wobble: verdict.wobble };
      this.heardT = 1.4;
      this.entered.push(verdict.ok ? want : verdict.side);
      if (!verdict.ok) {
        this.phase = "over";
        this.overAt = this.t;
        this.c.score(this.round);
        this.feedback = `PULSE ${this.entered.length}: EXPECTED ${want ? "LONG" : "SHORT"} / HEARD ${verdict.side ? "LONG" : "SHORT"} ${this.heard.ms} ms`;
        recordRun(this.c, { sequences: this.round, milestone: this.round, error: this.feedback });
        this.c.tone(100, 0.3);
        // Three blinks in the colour of the pulse that was wanted: amber short, cyan long.
        const colour = want ? LAMP.cyan : LAMP.amber;
        this.lamps.flash(1.0, (e) => (Math.floor(e / 0.167) % 2 === 0 ? fill(colour, 0.6) : lightsOff()));
      } else {
        if (verdict.wobble) {
          this.wobbles--;
          this.lamps.flash(0.25, () => fill(LAMP.amber, 0.5));
          announce(this, "CLOSE CALL FORGIVEN", 1.6);
        }
        if (this.entered.length === this.sequence.length) {
          this.round++;
          if (this.round % 3 === 0 && this.wobbles < 4) this.wobbles++;
          if (this.round === 3) announce(this, "PLAYBACK QUICKENS");
          if (this.round === 8) announce(this, "DARK VAULT / WATCH THE LAMPS");
          this.c.tone(740, 0.2);
          this.phase = "between";
          this.wait = 1;
          this.lamps.flash(0.6, (e, T) => spot(e / T, dim(LAMP.green, 0.55)));
        }
      }
    }
  }
  cancel() {
    this.guard.rewind();
    this.held = false;
    this.c.synth.stopTone();
    this.lamps.clear();
  }
  // Replay only exists while a signal is being received or entered: between rounds it would let
  // the same signal be credited twice, and after the run ended it would reopen a recorded run.
  menuActions() {
    if (this.phase !== 'show' && this.phase !== 'listen') return [];
    return [{ label: 'REPLAY CURRENT SIGNAL', run: () => {
      if (this.phase === 'show' || this.phase === 'listen') this.demonstrate();
      this.c.resume?.();
    } }];
  }
  // Leaving mid-run keeps the sequences completed so far.
  pause() {
    this.guard.settle();
    if (this.phase !== 'over' && this.round > 0) this.c.score(this.round);
    this.lamps.sleep();
  }
  dispose() { this.cancel(); this.pause(); }
  resume() {
    this.lamps.wake();
    if (this.phase === 'show') this.demonstrate();
  }
  // Resting light: during playback a short is one amber lamp and a long is a cyan bar; while you
  // hold, the lamps fill left to right (amber) and turn cyan at the 350 ms line; between pulses
  // they show how much of the signal has been returned.
  lampValues() {
    if (this.phase === "show")
      return this.lit ? (this.sequence[this.active] ? fill(LAMP.cyan, 0.4) : only(1, LAMP.amber, 0.6)) : null;
    if (this.phase === "listen") {
      if (this.held) {
        const ms = (this.t - this.holdAt) * 1000;
        return ms >= ECHO_LINE ? fill(LAMP.cyan, 0.45) : meter(ms / ECHO_LINE, dim(LAMP.amber, 0.33));
      }
      return meter(this.entered.length / this.sequence.length, dim(LAMP.violet, 0.2));
    }
    return null;
  }
  update(dt) {
    this.guard.tick(dt);
    this.t += dt;
    this.wait -= dt;
    if (this.heardT > 0) this.heardT -= dt;
    if (this.noteT > 0) this.noteT -= dt;
    if (this.held && !this.stepped && this.t - this.holdAt >= ECHO_LINE / 1000) {
      this.stepped = true;
      this.c.synth.startTone(660);   // the sidetone steps up when the hold becomes long
    }
    // Past any pulse the game asks for the tone stops, and the screen says the menu gesture is being counted.
    if (this.held && !this.capped && this.t - this.holdAt >= ECHO_TONE_CAP) { this.capped = true; this.c.synth.stopTone(); }
    if (this.held && this.capped && this.c.menuGesture?.().armed) announce(this, "MENU GESTURE / KEEP HOLDING", 0.4);
    const s = this.tempo();
    if (this.phase === "show" && this.wait <= 0) {
      if (this.lit) {
        this.lit = false;
        this.active = -1;
        this.index++;
        this.wait = Math.max(0.14, 0.28 * s);
      } else if (this.index >= this.sequence.length) {
        this.phase = "listen";
        this.c.hint("Your turn: hold under 0.35 s is short, 0.35 s or more is long.");
      } else {
        this.lit = true;
        this.active = this.index;
        this.wait = this.sequence[this.index] ? Math.max(0.5, 0.62 * s) : 0.18;
        this.c.tone(330 + (this.index % 3) * 110, this.wait);
      }
    } else if (this.phase === "between" && this.wait <= 0) {
      if (this.sequence.length < 10) this.sequence.push(this.c.rng.int(0, 1));
      else
        this.sequence = Array.from({ length: 10 }, () => this.c.rng.int(0, 1));
      this.demonstrate();
    }
    this.lamps.frame(dt, this.lampValues());
    this.c.hud([
      ["SEQUENCES", this.round],
      ["RETURNED", `${this.entered.length} / ${this.sequence.length}`],
      ["WOBBLES", this.wobbles ? "◇".repeat(this.wobbles) : "0"],
      ["BEST", this.c.best()],
    ]);
  }
  draw(g) {
    space(g, this.t, 0.3);
    // The three circles mirror the lamps: a short lights the middle one, a long lights all three.
    const pulseNow = this.phase === "show" && this.lit ? (this.sequence[this.active] ? 2 : 1) : 0;
    for (let i = 0; i < 3; i++) {
      const x = 310 + i * 170, on = pulseNow === 2 || (pulseNow === 1 && i === 1);
      circle(g, x, 150, 39, on ? C.ink : C.line, on);
      text(g, ["I", "II", "III"][i], x, 150, 22, on ? C.bg : C.muted, "center");
    }
    const size = Math.min(67, 660 / this.sequence.length), hide = this.phase === "show" && this.dark();
    for (let i = 0; i < this.sequence.length; i++) {
      const x = 480 + (i - (this.sequence.length - 1) / 2) * size,
        y = 270;
      const show = (this.phase === "show" && !hide) || i < this.entered.length;
      const color = i < this.entered.length ? C.ink : C.amber;
      if (show) {
        const long = i < this.entered.length ? this.entered[i] : this.sequence[i];
        if (long) line(g, x - 18, y, x + 18, y, color, 7);
        else circle(g, x, y, 6, color, true);
      } else diamond(g, x, y, 5, C.line);
      if (i === this.active) line(g, x - 20, y + 23, x + 20, y + 23, C.ink, 2);
    }
    text(
      g,
      this.phase === "listen"
        ? "YOUR TURN"
        : this.phase === "between"
          ? "SIGNAL ACCEPTED"
          : this.phase === "show"
            ? (hide ? "DARK VAULT / LAMPS ONLY" : "RECEIVE / REMEMBER")
            : "",
      480,
      345,
      24,
      C.muted,
      "center",
    );
    // What the vault heard on your last pulse, and a live bar for the hold in progress.
    if (this.heard && this.heardT > 0 && this.phase !== "over") {
      const h = this.heard, side = h.side ? "LONG" : "SHORT";
      text(g, `HEARD ${side} / ${h.ms} ms${h.wobble ? " / FORGIVEN" : h.ok ? "" : " / WRONG"}`, 480, 395, 24,
        h.ok ? (h.wobble ? C.amber : C.ink) : C.red, "center");
    }
    const x0 = 180, w = 600, per = w / 700, y = 470;
    g.fillStyle = "#1a2a1e";
    g.fillRect(x0, y, w, 16);
    g.fillStyle = "#4b6b44";
    g.fillRect(x0 + (ECHO_LINE - WOBBLE_MS) * per, y, WOBBLE_MS * 2 * per, 16);
    line(g, x0 + ECHO_LINE * per, y - 6, x0 + ECHO_LINE * per, y + 22, C.amber, 3);
    const ms = this.held ? (this.t - this.holdAt) * 1000 : this.heard && this.heardT > 0 ? this.heard.ms : 0;
    g.fillStyle = ms >= ECHO_LINE ? C.cyan : C.amber;
    g.fillRect(x0, y, Math.min(700, ms) * per, 16);
    text(g, "SHORT", x0, y + 40, 18, C.muted);
    text(g, "LONG", x0 + w, y + 40, 18, C.muted, "right");
    drawNote(g, this);
    if (this.phase === "title")
      banner(
        g,
        "ECHO VAULT",
        "Remember a growing sequence of short and long pulses.",
      );
    if (this.phase === "over")
      banner(
        g,
        "ECHO DIVERGED",
        `${this.feedback} / ${this.round} sequences`,
        C.amber,
      );
  }
}

