// PULSAR — placeholder cartridge. Its author replaces this whole file.
import { C, space, text } from "../engine/draw.js";

export class Pulsar {
  constructor(ctx) {
    this.ctx = ctx;
    this.time = 0;
    ctx.hint("This cartridge has not been installed yet.");
  }
  update(dt) {
    this.time += dt;
  }
  draw(g) {
    space(g, this.time, 0.4);
    text(g, "PULSAR", 480, 240, 42, C.ink, "center");
    text(g, "CARTRIDGE AWAITING INSTALLATION", 480, 296, 16, C.muted, "center");
  }
}
