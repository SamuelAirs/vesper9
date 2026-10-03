import { text, line, circle } from "../engine/draw.js";
import { PLATFORMS, REGIONS, SUMMIT, regionAt } from "./cairn-content.js";

const time = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
export class CairnView {
  draw(g) {
    const region = REGIONS[regionAt(this.camera + 120)], screen = y => 470 - y + this.camera;
    g.save(); g.fillStyle = region.bg; g.fillRect(0, 0, 960, 540);
    // An instrument's quiet engraved border and a distant, continuous geological column.
    g.strokeStyle = region.rock; g.lineWidth = 1; g.strokeRect(42, 20, 876, 500);
    for (let i = 0; i < 34; i++) {
      const x = 77 + ((i * 193) % 807), y = ((i * 97 + this.camera * 0.13) % 540 + 540) % 540;
      g.globalAlpha = 0.25 + (i % 3) * 0.1; g.fillStyle = region.edge; g.fillRect(x, y, i % 4 ? 1 : 2, 2);
    }
    g.globalAlpha = 1;
    // The side walls are real: they return some horizontal speed on contact.
    line(g, 64, 88, 64, 499, region.rock, 3); line(g, 896, 88, 896, 499, region.rock, 3);
    for (let i = 0; i < 8; i++) {
      const x = 85 + i * 118, top = 80 + (i * 71 % 210) + Math.sin(this.camera * 0.0008 + i) * 35;
      g.fillStyle = region.rock; g.globalAlpha = 0.15;
      g.beginPath(); g.moveTo(x - 45, 540); g.lineTo(x - 10, top); g.lineTo(x + 16, top - 26); g.lineTo(x + 52, 540); g.fill();
    }
    g.globalAlpha = 1;
    for (const s of PLATFORMS) {
      const y = screen(s.y); if (y < -65 || y > 580) continue;
      const style = REGIONS[regionAt(s.y)];
      g.fillStyle = style.rock; g.beginPath(); g.moveTo(s.x, y); g.lineTo(s.x + s.w, y);
      g.lineTo(s.x + s.w - 5, y + s.h); g.lineTo(s.x + s.w * 0.62, y + s.h + 9);
      g.lineTo(s.x + 6, y + s.h); g.closePath(); g.fill();
      line(g, s.x, y + 0.5, s.x + s.w, y + 0.5, style.edge, 2);
      for (let j = 15; j < s.w; j += 23) line(g, s.x + j, y + 5, s.x + j - 5, y + 10, style.bg);
      if (s.checkpoint) this.cairn(g, s.x + s.w - 24, y, s.checkpoint <= this.save.checkpoint, style.ink);
      else if (s.summit) {
        const x = s.x + s.w - 24; line(g, x, y, x, y - 105, style.edge, 2);
        circle(g, x, y - 112, 8, style.ink); circle(g, x, y - 112, this.phase === "over" ? 19 : 13, style.rock);
        line(g, x - 18, y - 87, x + 18, y - 87, style.edge); line(g, x - 12, y - 78, x + 12, y - 78, style.edge);
      } else if (s.id % 3 === 1) {
        const x = s.x + 10;
        if (regionAt(s.y) === 2) { line(g, x, y, x + 4, y - 22, style.edge); line(g, x + 4, y - 22, x + 10, y - 10, style.edge); }
        else { line(g, x, y, x - 3, y - 12, style.edge); circle(g, x - 3, y - 14, 2, style.edge, true); }
      }
    }
    for (const part of this.parts) { g.globalAlpha = Math.min(1, part.life * 3); g.fillStyle = region.ink; g.fillRect(part.x, screen(part.y), 2, 2); }
    g.globalAlpha = 1;
    this.creature(g, this.p.x, screen(this.p.y), region.ink);
    // Height ruler and a small permanent map; the next ledges remain the dominant information.
    for (let y = Math.ceil((this.camera - 60) / 100) * 100; y < this.camera + 460; y += 100) {
      const sy = screen(y); if (sy < 40 || sy > 500 || y < 0) continue;
      line(g, 45, sy, 53, sy, region.edge); text(g, Math.round(y / 10), 37, sy, 10, region.edge, "right");
    }
    line(g, 931, 76, 931, 470, region.rock, 2);
    for (const r of REGIONS) { const y = 470 - r.at / SUMMIT * 394; line(g, 926, y, 936, y, region.edge); }
    circle(g, 931, 470 - Math.min(SUMMIT, Math.max(0, this.p.y)) / SUMMIT * 394, 3, region.ink, true);
    text(g, "CAIRN", 66, 43, 16, region.ink); text(g, region.name, 890, 43, 12, region.edge, "right");
    if (this.noteT > 0 && this.phase === "play") text(g, this.note, 480, 80, 14, region.ink, "center");
    if (this.phase === "play") {
      text(g, this.p.ground >= 0 ? this.held && this.armed ? "CHARGING" : (this.p.facing > 0 ? "FACING RIGHT  ›" : "‹  FACING LEFT") : this.p.vy > 0 ? "COMMITTED" : "FALLING", 480, 515, 12, region.edge, "center");
      text(g, time(this.elapsed), 888, 515, 12, region.edge, "right");
    }
    if (this.phase === "title") {
      g.fillStyle = region.bg; g.globalAlpha = 0.94; g.fillRect(225, 108, 510, 260); g.globalAlpha = 1;
      text(g, "C A I R N", 480, 151, 42, region.ink, "center");
      text(g, "A small thing. A very tall place.", 480, 197, 15, region.edge, "center");
      text(g, "Hold to charge. Release to leap.", 480, 243, 18, region.ink, "center");
      text(g, "Short tap turns. No steering in the air.", 480, 272, 14, region.edge, "center");
      text(g, this.save.active || this.save.checkpoint ? "TAP: CONTINUE     HOLD: NEW ASCENT" : "TAP TO BEGIN", 480, 322, 16, region.ink, "center");
      if (this.save.summits) text(g, `${this.save.summits} SUMMITS${this.save.bestSeconds ? "  /  BEST " + time(this.save.bestSeconds) : ""}`, 480, 352, 12, region.edge, "center");
    }
    if (this.phase === "over") {
      g.fillStyle = region.bg; g.globalAlpha = 0.93; g.fillRect(130, 160, 430, 155); g.globalAlpha = 1;
      text(g, "A LIGHT ANSWERS.", 345, 195, 29, region.ink, "center");
      text(g, `${time(this.elapsed)}  ·  ${this.jumps} LEAPS  ·  ${this.falls} FALLS`, 345, 239, 16, region.edge, "center");
      text(g, "Tap for another ascent.", 345, 282, 15, region.ink, "center");
    }
    g.restore();
  }
  cairn(g, x, y, lit, ink) {
    for (let i = 0; i < 3; i++) { g.fillStyle = lit ? ink : "#637778"; g.fillRect(x - 9 + i * 2, y - 5 - i * 7, 18 - i * 4, 5); }
    if (lit) { line(g, x, y - 24, x, y - 39, ink); circle(g, x, y - 42, 2, ink, true); }
  }
  creature(g, x, y, ink) {
    const ground = this.p.ground >= 0, crouch = ground ? this.charge * 5 : 0, facing = this.p.facing;
    g.save(); g.translate(x, y); g.scale(facing, 1);
    // A round, two-eyed field pilgrim with a little pack and four springy legs.
    g.strokeStyle = ink; g.lineWidth = 2;
    const sway = ground ? 0 : Math.sin(this.t * 15) * 3;
    for (let i = 0; i < 4; i++) {
      const root = -6 + i * 4, toe = -12 + i * 8;
      g.beginPath(); g.moveTo(root, -8 + crouch); g.lineTo(toe, -5 - (i % 2 ? sway : -sway)); g.lineTo(toe + 2, ground ? 0 : 2 + sway); g.stroke();
    }
    g.fillStyle = "#17262a"; g.fillRect(-13, -22 + crouch, 8, 13); g.strokeRect(-13, -22 + crouch, 8, 13);
    g.fillStyle = ink; g.beginPath(); g.ellipse(1, -16 + crouch, 10, 10 - crouch * 0.35, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#122026"; g.fillRect(4, -20 + crouch, 3, 4); g.fillRect(9, -19 + crouch, 2, 3);
    line(g, -1, -25 + crouch, -4, -32 + crouch, ink); circle(g, -4, -33 + crouch, 2, ink, true);
    if (ground) {
      g.fillStyle = ink; g.beginPath(); g.moveTo(21, -13); g.lineTo(16, -16); g.lineTo(16, -10); g.closePath(); g.fill();
    }
    g.restore();
    if (ground && this.held && this.armed) {
      g.fillStyle = "#20322e"; g.fillRect(x - 24, y - 49, 48, 4); g.fillStyle = "#edc997"; g.fillRect(x - 24, y - 49, 48 * this.charge, 4);
    }
  }
}
