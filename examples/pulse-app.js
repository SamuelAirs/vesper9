// Copy into web/apps/, then register as shown in docs/ENGINE.md.
import { C, space, text, circle } from "../engine/draw.js";

export class PulseGarden {
  constructor(ctx) {
    this.ctx = ctx;
    this.time = 0;
    this.pulses = [];
    this.count = ctx.progress().count || 0;
    ctx.hint("Press to plant a signal. Use the displayed quick-click gesture for the menu.");
  }
  down() {
    this.count++;
    this.ctx.saveProgress({ count: this.count })?.catch?.(this.ctx.error);
    this.pulses.push({
      x: this.ctx.rng.range(120, 840),
      y: this.ctx.rng.range(100, 430),
      age: 0,
    });
    this.ctx.tone(this.ctx.rng.range(240, 700), 0.15, "sine");
    this.ctx.leds([40, 120, 30, 40, 120, 30, 40, 120, 30]);
  }
  update(dt) {
    this.time += dt;
    for (const pulse of this.pulses) pulse.age += dt;
    this.pulses = this.pulses.filter((pulse) => pulse.age < 2);
    if (!this.pulses.some((pulse) => pulse.age < 0.2))
      this.ctx.leds(Array(9).fill(0));
    this.ctx.hud([["SIGNALS PLANTED", this.count]]);
  }
  draw(g) {
    space(g, this.time, 0.2);
    for (const pulse of this.pulses) {
      g.globalAlpha = Math.max(0, 1 - pulse.age / 2);
      circle(g, pulse.x, pulse.y, 8 + pulse.age * 70, C.ink);
    }
    g.globalAlpha = 1;
    text(g, "PULSE GARDEN / AN EXPANSION CARTRIDGE", 32, 32, 13, C.muted);
  }
  dispose() {
    this.ctx.leds(Array(9).fill(0));
  }
}
