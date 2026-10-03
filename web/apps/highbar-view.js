import { C, text, line, circle } from "../engine/draw.js";
import { clamp, wrapAngle } from "../engine/math.js";
import { LOCKOUT } from "./game-kit.js";
import { G, STEP, BAIL_T, ROLL, LAND_TOL, GUIDE, MODES, MEDALS, PARKS, UNLOCK } from "./highbar-content.js";

const fmt = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const unlocked = (s, p) => p === 0 || s.goals[p - 1].length >= UNLOCK;
function panel(g, x, y, w, h, accent = C.line) {
  g.fillStyle = "#0c1511ed"; g.fillRect(x, y, w, h);
  g.strokeStyle = C.line; g.lineWidth = 1; g.strokeRect(x, y, w, h);
  line(g, x, y, x + Math.min(52, w), y, accent, 2);
  line(g, x + w, y + h - 14, x + w, y + h, accent, 2);
}
const short = (value, n) => String(value).length > n ? String(value).slice(0, n - 1) + "…" : String(value);
function paragraph(g, value, x, y, width, size = 20, colour = C.ink, max = 3) {
  const words = String(value).split(/\s+/), limit = Math.max(10, Math.floor(width / (size * .62)));
  let row = "", count = 0;
  for (const word of words) {
    if (row && row.length + word.length + 1 > limit) {
      text(g, row, x, y + count * (size + 7), size, colour); row = word;
      if (++count >= max) return y + count * (size + 7);
    } else row = row ? row + " " + word : word;
  }
  if (row) text(g, short(row, limit), x, y + count++ * (size + 7), size, colour);
  return y + count * (size + 7);
}
function gauge(g, x, y, w, amount, colour) {
  g.fillStyle = C.line; g.fillRect(x, y, w, 5);
  g.fillStyle = colour; g.fillRect(x, y, w * clamp(amount, 0, 1), 5);
}

// Procedural art: cull world objects, cap maps at80segments, practice arcs at18.
// No shadows, filters, downloaded artwork or simulation mutations.
export class HighBarView {
  theme() { return this.park().theme || { sky: C.bg, far: C.dark, ground: C.dark, accent: C.cyan, secondary: C.amber }; }
  draw(g) {
    this.ensurePark(); this.drawSkyline(g);
    g.save(); g.translate(-Math.round(this.camX), -Math.round(this.camY)); this.drawPark(g);
    if (this.phase === "play" || this.phase === "over") {
      if (this.mode === 2 && this.phase === "play") this.drawTrajectory(g);
      g.fillStyle = this.theme().accent;
      for (let i = 0; i < this.trail.length; i++) { const q = this.trail[i]; g.globalAlpha = .08 + .35 * i / this.trail.length; g.fillRect(q[0] - 1, q[1] - 14, 3, 3); }
      g.globalAlpha = 1; this.drawRider(g);
    }
    for (const q of this.parts) { g.globalAlpha = 1 - q.t / .6; g.fillStyle = q.color; g.fillRect(q.x - 2, q.y - 2, 4, 4); }
    g.globalAlpha = 1;
    // A landing can award several tricks at once. Stack that bounded burst
    // instead of printing AIR, BIG AIR and a flip on the same baseline.
    for (let i = 0; i < this.popups.length; i++) {
      const q = this.popups[i]; let row = 0;
      for (let j = 0; j < i; j++) {
        const earlier = this.popups[j];
        if (Math.abs(q.x - earlier.x) < 180 && Math.abs(q.y - earlier.y) < 60 && Math.abs(q.t - earlier.t) < .15) row++;
      }
      text(g, q.text, q.x, q.y - q.t * 40 - row * 20, 16, C.amber, "center");
    }
    g.restore();
    if (this.phase !== "play") { g.fillStyle = "#09120ce0"; g.fillRect(0, 0, 960, 540); }
    if (this.phase === "play") {
      this.drawCoach(g); this.drawCombo(g);
      if (this.noteT > 0) { const w = Math.min(850, this.note.length * 11 + 34); panel(g, 480 - w / 2, 147, w, 34, C.amber); text(g, short(this.note, 73), 480, 165, 18, C.amber, "center"); }
    } else if (this.phase === "title") this.drawTitle(g);
    else if (this.phase === "setup") this.drawSetup(g);
    else if (this.phase === "over") this.drawOver(g);
    else if (this.phase === "guide") this.drawGuide(g);
  }
  drawSkyline(g) {
    const park = this.park(), theme = this.theme(); g.fillStyle = theme.sky; g.fillRect(0, 0, 960, 540);
    g.fillStyle = theme.secondary;
    for (let i = 0; i < 40; i++) { const x = (i * 193 + 73 - this.camX * .06 + 9600) % 960, y = (i * 83 + 31 - this.camY * .035 + 5400) % 540; g.globalAlpha = i % 3 ? .18 : .4; g.fillRect(x, y, i % 3 ? 1 : 2, 1); }
    g.globalAlpha = .25; const mx = 810 - this.camX * .04, my = 110 - this.camY * .04;
    circle(g, mx, my, this.parkId === 3 ? 66 : 34, theme.secondary, false, 1); line(g, mx - 82, my + 12, mx + 82, my - 12, theme.secondary); g.globalAlpha = 1;
    const base = 480 - this.camY * .12;
    for (let i = -1; i < 13; i++) {
      const x = i * 100 - (this.camX * .15 % 100), h = 90 + ((i + 17) * 37 % 140);
      g.fillStyle = theme.far;
      if (this.parkId === 3) { g.beginPath(); g.moveTo(x - 20, base + 100); g.lineTo(x + 25, base - h); g.lineTo(x + 94, base - h + 60); g.lineTo(x + 120, base + 100); g.closePath(); g.fill(); }
      else g.fillRect(x, base - h, 74, h + 100);
      if (park.id === "tower") { line(g, x + 5, base - h, x + 69, base - h, theme.accent); line(g, x + 37, base - h - 40, x + 37, base - h, theme.far, 3); }
      else if (park.id === "yard") { line(g, x, base - h - 20, x + 86, base - h - 20, theme.far, 4); line(g, x + 5, base - h - 20, x + 5, base - h - 80, theme.far, 4); }
      else if (park.id === "bowl") circle(g, x + 37, base - h, 30, theme.far, true);
      else line(g, x, base - h, x + 74, base - h + 30, theme.secondary, 1);
      g.fillStyle = theme.secondary; g.globalAlpha = .25; for (let j = 0; j < 3; j++) g.fillRect(x + 12 + j * 18, base - h + 22, 4, 8); g.globalAlpha = 1;
    }
    g.globalAlpha = .48; g.fillStyle = theme.far;
    for (let i = -1; i < 9; i++) { const x = i * 145 - (this.camX * .3 % 145); g.fillRect(x, 380 - this.camY * .18, 5, 260); line(g, x, 397 - this.camY * .18, x + 120, 397 - this.camY * .18, theme.far, 3); }
    g.globalAlpha = 1;
    if (park.id === "tower") {
      const x = 600 - this.camX * .2, y = 500 - this.camY * .15;
      g.globalAlpha = .25; line(g, x - 85, y, x - 30, y - 550, theme.accent); line(g, x + 85, y, x + 30, y - 550, theme.accent);
      for (let i = 0; i < 7; i++) { const yy = y - i * 75, half = 80 - i * 7; line(g, x - half, yy, x + half - 7, yy - 75, theme.accent); line(g, x + half, yy, x - half + 7, yy - 75, theme.accent); }
      g.globalAlpha = 1;
    }
  }
  drawPark(g) {
    const park = this.park(), theme = this.theme(), hm = this.hm;
    const i0 = Math.max(0, Math.floor((this.camX - 20) / STEP)), i1 = Math.min(hm.length - 1, Math.ceil((this.camX + 980) / STEP)), bottom = Math.max(park.h, this.camY + 560);
    g.beginPath(); g.moveTo(i0 * STEP, bottom); for (let i = i0; i <= i1; i += 2) g.lineTo(i * STEP, hm[i]);
    g.lineTo(i1 * STEP, hm[i1]); g.lineTo(i1 * STEP, bottom); g.closePath(); g.fillStyle = theme.ground; g.fill();
    for (let depth = 0; depth < 3; depth++) { g.beginPath(); for (let i = i0; i <= i1; i += 3) { if (i === i0) g.moveTo(i * STEP, hm[i] + depth * 9); else g.lineTo(i * STEP, hm[i] + depth * 9); } g.strokeStyle = depth ? C.line : theme.accent; g.lineWidth = depth ? 1 : 3; g.stroke(); }
    for (let x = Math.ceil(this.camX / 96) * 96; x < this.camX + 960; x += 96) { const y = this.groundY(x); line(g, x, y + 22, x + 25, y + 22, C.line); line(g, x, y + 24, x, y + 44, C.line); }
    const geo = this.geo; line(g, geo.lipL, geo.lipY, geo.lipL, geo.lipY - 600, C.line, 2); line(g, geo.lipR, geo.lipY, geo.lipR, geo.lipY - 600, C.line, 2);
    circle(g, geo.lipL, geo.lipY, 5, theme.secondary, true); circle(g, geo.lipR, geo.lipY, 5, theme.secondary, true);
    const target = this.phase === "play" && this.p.mode !== "bar" && this.p.mode !== "bail" ? this.pickBar() : -1;
    for (let i = 0; i < park.bars.length; i++) {
      const [x, y, kind] = park.bars[i]; if (x < this.camX - 50 || x > this.camX + 1010 || y < this.camY - 50 || y > this.camY + 600) continue;
      const ground = this.groundY(x), col = kind === "whip" ? C.amber : theme.accent;
      line(g, x - 5, y + 5, x - 5, ground, C.line, 2); line(g, x + 5, y + 5, x + 5, ground, C.line, 2);
      for (let yy = y + 48; yy < Math.min(ground, this.camY + 560); yy += 120) line(g, x - 5, yy, x + 5, yy + 36, C.line);
      line(g, x - 21, y, x + 21, y, col, 4); line(g, x - 21, y + 6, x + 21, y + 6, C.line); circle(g, x - 21, y, 3, col, true); circle(g, x + 21, y, 3, col, true);
      text(g, "B" + (i + 1), x, y - 22, 14, col, "center");
      if (i === target) { circle(g, x, y, 24, C.ink, false, 2); line(g, x - 32, y, x - 26, y, C.ink, 2); line(g, x + 26, y, x + 32, y, C.ink, 2); }
      if (this.p.mode === "bar" && this.p.bar === i) circle(g, x, y, 18, theme.secondary, false, 2);
    }
    for (const m of park.landmarks || []) {
      if (m.x < this.camX - 120 || m.x > this.camX + 1080 || m.y < this.camY - 120 || m.y > this.camY + 580) continue;
      g.globalAlpha = .5;
      if (m.kind === "moon") circle(g, m.x, m.y, 38, theme.secondary, false, 1);
      else if (m.kind === "tank") { g.strokeStyle = theme.accent; g.strokeRect(m.x - 30, m.y - 30, 60, 55); circle(g, m.x, m.y - 30, 30, theme.accent); }
      else if (m.kind === "gantry") { line(g, m.x - 70, m.y + 75, m.x - 70, m.y - 35, theme.accent, 2); line(g, m.x + 70, m.y + 75, m.x + 70, m.y - 35, theme.accent, 2); line(g, m.x - 90, m.y - 35, m.x + 90, m.y - 35, theme.accent, 3); line(g, m.x + 25, m.y - 35, m.x + 25, m.y + 20, theme.secondary); }
      else { line(g, m.x, m.y, m.x, m.y - 48, theme.accent, 2); circle(g, m.x, m.y - 48, 5, theme.secondary); line(g, m.x - 22, m.y - 20, m.x + 22, m.y - 20, theme.accent); }
      text(g, short(m.label || "", 24), m.x, m.y + 22, 13, theme.accent, "center"); g.globalAlpha = 1;
    }
    if (this.mode === 1) {
      const gap = park.gaps.find(q => q.id === this.challenge().gap);
      if (gap?.t === "span") { const y = park.floor - 100; line(g, gap.x1, y, gap.x2, y, C.amber, 2); text(g, gap.name, (gap.x1 + gap.x2) / 2, y - 20, 18, C.amber, "center"); }
      else if (gap) for (const i of [gap.a, gap.b]) if (i !== undefined) { const [x, y] = park.bars[i]; circle(g, x, y, 34, C.amber, false, 1); }
    }
  }
  drawTrajectory(g) {
    const p = this.p; if (p.mode !== "air" && p.mode !== "bar") return;
    let vx = p.vx, vy = p.vy; if (p.mode === "bar") { vx = p.r * p.om * Math.cos(p.phi); vy = -p.r * p.om * Math.sin(p.phi); }
    g.fillStyle = this.theme().secondary; g.globalAlpha = .55;
    for (let i = 1; i <= 18; i++) { const t = i * .055, x = p.x + vx * t, y = p.y + vy * t + .5 * G * t * t; if (x < this.geo.lipL || x > this.geo.lipR || y > this.groundY(x)) break; g.fillRect(x - 1, y - 1, 3, 3); }
    g.globalAlpha = 1;
  }
  drawRider(g) {
    const p = this.p, theme = this.theme();
    if (p.mode === "bar") { const [bx, by] = this.park().bars[p.bar], reach = ((p.tuck || p.crouch ? 8 : 14) + 30) * 1.35; line(g, bx, by, p.x + reach * Math.sin(p.rot), p.y - reach * Math.cos(p.rot), theme.accent, 3); }
    g.save(); g.translate(p.x, p.y); g.rotate(p.mode === "bail" ? p.rot + (BAIL_T - p.bailT) * 9 : p.rot); g.scale(1.35, 1.35);
    const col = p.mode === "bail" ? C.red : C.ink, low = p.tuck || p.crouch, hip = low ? -13 : -19, shoulder = low ? -24 : -34, lean = low ? 6 : -2;
    const spin = this.air?.style ? Math.cos((this.air.t - this.air.style.at) * 12) : 1, nose = this.manual ? this.manual.balance * 4 : 0;
    line(g, -15 * spin, -3 + nose, 15 * spin, -3 - nose, theme.secondary, 4); circle(g, -10, 1 + nose, 2, theme.secondary, true); circle(g, 10, 1 - nose, 2, theme.secondary, true);
    line(g, -7, -5, -10, hip + 7, col, 3); line(g, -10, hip + 7, 0, hip, col, 3); line(g, 7, -5, 8, hip + 8, col, 3); line(g, 8, hip + 8, 0, hip, col, 3);
    line(g, 0, hip, lean, shoulder, theme.accent, 5);
    if (p.mode === "bar") { line(g, lean, shoulder + 4, -5, shoulder - 9, col, 2); line(g, -5, shoulder - 9, 1, shoulder - 17, col, 2); line(g, lean, shoulder + 4, 8, shoulder - 7, col, 2); line(g, 8, shoulder - 7, 1, shoulder - 17, col, 2); }
    else { line(g, lean, shoulder + 4, -12, shoulder + 9, col, 2); line(g, -12, shoulder + 9, -17, shoulder + 3, col, 2); line(g, lean, shoulder + 4, 11, shoulder + 8, col, 2); line(g, 11, shoulder + 8, 16, shoulder + 2, col, 2); }
    circle(g, lean, shoulder - 8, 6, col, false, 2); line(g, lean - 3, shoulder - 10, lean + 5, shoulder - 10, theme.secondary, 2); g.restore();
  }
  drawMap(g, x, y, w, h, live = false) {
    const park = this.park(), theme = this.theme(), sx = w / park.w, sy = h / park.h;
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); g.beginPath();
    for (let i = 0; i <= 80; i++) { const wx = park.w * i / 80, yy = y + this.groundY(wx) * sy; if (i === 0) g.moveTo(x, yy); else g.lineTo(x + wx * sx, yy); }
    g.strokeStyle = theme.accent; g.lineWidth = 2; g.stroke();
    for (const b of park.bars) { const bx = x + b[0] * sx, by = y + b[1] * sy; line(g, bx, by, bx, y + this.groundY(b[0]) * sy, C.line); line(g, bx - 4, by, bx + 4, by, b[2] === "whip" ? C.amber : theme.secondary, 2); }
    if (live) { g.strokeStyle = C.muted; g.lineWidth = 1; g.strokeRect(x + this.camX * sx, y + this.camY * sy, 960 * sx, 540 * sy); circle(g, x + this.p.x * sx, y + this.p.y * sy, 3, C.ink, true); }
    g.restore();
  }
  drawCoach(g) {
    const p = this.p, col = this.theme().accent, bar = this.pickBar(); let action, instruction;
    if (this.resumeT > 0) { action = "READY / RESUMING"; instruction = "Release the button. Your line is safe."; }
    else if (p.mode === "bail") { action = "RECOVERING"; instruction = "Banked points are safe. Find the next line."; }
    else if (this.manual) { action = "MANUAL / BALANCE"; instruction = "CASE: BALANCE  ·  BUTTON: OLLIE"; }
    else if (p.mode === "bar") { action = "SWING / RELEASE TO FLY"; instruction = "HOLD: SWING  ·  CASE: " + (p.regrip ? "REGRIP USED" : p.held > .15 ? "REGRIP" : "WAIT FOR REGRIP"); }
    else if (bar >= 0) { action = "BAR " + (bar + 1) + " IN REACH / HOLD TO CATCH"; instruction = "The ring marks the catch. Release to fly."; }
    else if (p.mode === "air") { action = p.tuck ? "FLIPPING / RELEASE TO STRAIGHTEN" : "AIR / HOLD TO FLIP"; instruction = "CASE: " + (this.air?.style ? "SHOVE-IT IN FLIGHT" : this.canStyle() ? "SHOVE-IT READY" : "WAIT FOR MORE AIR"); }
    else { action = p.crouch ? "PUMPING / RELEASE TO OLLIE" : "ROLL / HOLD TO PUMP"; instruction = "RELEASE: OLLIE  ·  CASE: MANUAL"; }
    if (!(this.resumeT > 0)) {
      if (this.landing?.t > 0 && this.landing.reason && (p.mode === "bail" || (p.mode === "ground" && !this.manual))) instruction = this.landing.reason;
      else if (this.styleNotice && this.t - this.tapAt >= 0 && this.t - this.tapAt < 1.3 &&
        ((this.manual && /^(MANUAL|BALANCE)/.test(this.styleNotice)) ||
         (p.mode === "air" && this.air?.style && this.styleNotice.startsWith("SHOVE-IT")) ||
         (p.mode === "bar" && p.regrip && this.styleNotice.startsWith("REGRIP")))) instruction = this.styleNotice;
    }
    panel(g, 18, 14, 604, 88, col); text(g, action, 34, 36, 20, C.ink); text(g, short(instruction, 52), 34, 62, 18, col);
    let label = "SPEED", value = Math.abs(p.s || Math.hypot(p.vx, p.vy)) / 820, colour = col;
    if (this.manual) { label = "BALANCE"; value = 1 - Math.abs(this.manual.balance); colour = value < .3 ? C.red : C.cyan; }
    else if (p.mode === "air") { const risk = Math.abs(wrapAngle(p.rot - Math.atan(this.slope(p.x)))); value = 1 - risk / (this.air?.style ? LAND_TOL * .7 : LAND_TOL); label = risk < .22 ? "CLEAN ANGLE" : value > 0 ? "SAFE ANGLE" : "STRAIGHTEN"; colour = value > 0 ? C.cyan : C.amber; }
    else if (this.combo.roll >= 0) { label = "BANKING"; value = 1 - this.combo.roll / ROLL; colour = C.amber; }
    else if (p.mode === "bar") { label = "SWING"; value = Math.abs(Math.sin(p.phi)); }
    text(g, label, 34, 86, 14, colour); gauge(g, 165, 83, 432, value, colour);
    if (this.manual) { line(g, 381, 79, 381, 92, C.muted); circle(g, 381 + clamp(this.manual.balance, -1, 1) * 211, 85, 4, colour, true); }
    panel(g, 640, 14, 302, 126, col); text(g, this.park().name + (this.mode === 2 ? " / PRACTICE" : ""), 654, 31, 14, col); this.drawMap(g, 656, 44, 270, 64, true);
    text(g, this.mode === 2 ? (this.practiceSlow ? "HALF SPEED / " : "") + "RELEASE ARC ESTIMATE" : "COURSE / YOU + CAMERA", 655, 125, 12, C.muted);
    if (this.mode === 1) { panel(g, 18, 108, 604, 32, C.amber); text(g, short((this.lineMet ? "BANKED " : "") + this.challenge().name, 22), 32, 125, 17, C.amber); text(g, short(this.lineMet ? "TARGET COMPLETE" : this.lineProgress(), 33), 610, 125, 16, col, "right"); }
    if (this.landing?.t > 0 && p.mode === "ground") text(g, this.landing.kind.toUpperCase() + " LANDING", 480, 438, 20, this.landing.kind === "sketchy" ? C.amber : col, "center");
  }
  drawCombo(g) {
    const c = this.combo;
    if (!c.tricks.length) {
      if (this.lastBank) { panel(g, 18, 482, 924, 42, this.theme().accent); text(g, "BANKED " + fmt(this.lastBank.value) + " / " + this.lastBank.variety + " TRICKS", 35, 503, 20, this.theme().accent); text(g, this.lastBank.newMedal ? "NEW LINE MEDAL" : this.lastBank.newBest ? "NEW PERSONAL BEST" : "CLEAN " + this.lastBank.clean, 923, 503, 20, C.amber, "right"); }
      return;
    }
    panel(g, 18, 462, 924, 62, this.theme().accent); text(g, fmt(c.sum) + " × " + Math.min(this.variety(c), 8), 35, 484, 24, c.roll >= 0 ? C.amber : C.ink);
    const names = c.tricks.slice(-3).map(q => q.name).join(" + "); text(g, short((c.tricks.length > 3 ? "… + " : "") + names, 57), 923, 484, 18, this.theme().accent, "right");
    text(g, c.roll >= 0 ? "ROLL TO BANK / " + Math.ceil(Math.max(0, c.roll) * 10) / 10 + "s" : "UNBANKED / KEEP THE LINE", 35, 511, 16, C.muted);
    if (c.roll >= 0) gauge(g, 460, 508, 460, 1 - c.roll / ROLL, C.amber); else text(g, "DIFFERENT TRICKS GROW YOUR MULTIPLIER", 923, 511, 15, C.muted, "right");
  }
  menuHeader(g, heading, sub) { text(g, "HIGH BAR / " + (this.park().district || "OFFWORLD FIELD COURSE"), 36, 32, 16, this.theme().accent); text(g, heading, 36, 76, 38, C.ink); if (sub) text(g, sub, 36, 112, 18, C.muted); }
  footer(g, value) { panel(g, 28, 492, 904, 34, this.theme().accent); text(g, value, 480, 510, 20, C.amber, "center"); }
  drawTitle(g) {
    const s = this.slot(), park = this.park(), col = this.theme().accent; this.menuHeader(g, "SKATE THE SIGNAL", "SLOT " + (this.save.slot + 1) + " / " + MODES[this.mode] + " / " + park.name);
    panel(g, 28, 139, 510, 337, col); text(g, "PARK GOALS / " + s.goals[this.parkId].length + " OF 5", 46, 162, 19, col); this.drawGoals(g, 202, 46, 476, 49);
    panel(g, 554, 139, 378, 337, col); text(g, park.name, 574, 166, 28, C.ink); paragraph(g, park.tagline || park.text, 574, 200, 336, 18, C.muted, 2); this.drawMap(g, 576, 253, 332, 131);
    const rec = this.lineRecord?.();
    text(g, "MEDAL " + MEDALS[this.mode === 1 && rec ? rec.medal : s.medals[this.parkId]] + " / LINES " + s.lines[this.parkId].length + "/3", 574, 410, 18, col);
    text(g, this.mode === 2 ? "PRACTICE / RECORDS STAY SAFE" : this.mode === 1 && rec ? "LINE PB " + fmt(rec.best) : "SESSION BEST " + fmt(s.styleBest[this.parkId]), 574, 447, 18, C.amber);
    this.footer(g, (s.guided ? "TAP: RIDE" : "TAP: LEARN AND RIDE") + "  ·  HOLD: SETUP / MASTERY " + (this.masteryCount?.() || 0) + "/36");
  }
  drawGoals(g, y0, x = 300, width = 500, step = 26) { const done = this.slot().goals[this.parkId]; for (let i = 0; i < this.park().goals.length; i++) { const ok = done.includes(i), yy = y0 + i * step; circle(g, x + 6, yy, 5, ok ? this.theme().accent : C.muted, ok, 1); paragraph(g, this.park().goals[i].text, x + 23, yy, width - 23, 18, ok ? this.theme().accent : C.ink, 2); } }
  drawSetup(g) {
    const park = this.park(), col = this.theme().accent, ch = this.challenge(); this.menuHeader(g, "PARK + LINE", "CHOOSE A COURSE, A CHALLENGE, OR AN UNTIMED WARMUP");
    panel(g, 28, 137, 546, 339, col); const items = this.setupItems(), first = Math.max(0, Math.min(this.cursor - 6, items.length - 8)), last = Math.min(items.length, first + 8);
    for (let i = first; i < last; i++) { const yy = 163 + (i - first) * 38, on = i === this.cursor; if (on) { g.fillStyle = col; g.fillRect(40, yy - 15, 522, 31); } text(g, (on ? "> " : "  ") + short(items[i].label, 40), 48, yy, 20, on ? C.bg : C.ink); }
    if (items.length > 8) text(g, (first > 0 ? "↑ " : "") + (this.cursor + 1) + "/" + items.length + (last < items.length ? " ↓" : ""), 558, 457, 15, col, "right");
    panel(g, 590, 137, 342, 339, col); text(g, park.name, 608, 163, 27, C.ink);
    if (items[this.cursor]?.id === "line" && ch.approach) {
      text(g, short(ch.name, 24), 608, 203, 20, col);
      for (let i = 0; i < Math.min(3, ch.approach.length); i++) paragraph(g, (i + 1) + ". " + ch.approach[i], 608, 236 + i * 74, 307, 18, C.ink, 3);
    } else { this.drawMap(g, 609, 187, 304, 76); text(g, short(ch.name, 24), 608, 282, 20, col); paragraph(g, this.mode === 2 ? this.practiceLabel?.() || park.routeTip || ch.text : ch.text, 608, 337, 306, 18, C.ink, 3); }
    const record = this.lineRecord?.(); text(g, (this.mode === 2 ? "UNTIMED" : this.lineSeconds() + "s") + " / " + (record ? MEDALS[record.medal] + " / " + fmt(record.best) : ch.skill || "BANK YOUR LINE"), 608, 465, 17, C.amber);
    const open = PARKS.filter((_, i) => unlocked(this.slot(), i)).length; this.footer(g, "TAP: NEXT  ·  CASE: PREVIOUS  ·  HOLD: CHOOSE / " + open + "/4 PARKS");
  }
  drawOver(g) {
    const s = this.slot(), col = this.theme().accent; this.menuHeader(g, this.mode === 2 ? "PRACTICE COMPLETE" : this.mode === 1 ? "LINE REPORT" : "SESSION REPORT", this.park().name + " / SLOT " + (this.save.slot + 1));
    panel(g, 28, 138, 397, 338, col); text(g, this.mode === 2 ? "PRACTICE SCORE" : "BANKED SCORE", 49, 166, 18, col); text(g, fmt(this.score), 49, 214, 48, C.ink); line(g, 49, 251, 402, 251);
    text(g, "BEST COMBO", 49, 279, 18, C.muted); text(g, fmt(this.bestCombo), 401, 279, 22, C.amber, "right"); text(g, "CLEAN / BANKS / BAILS", 49, 319, 17, C.muted); text(g, this.stats.clean + " / " + this.stats.banks + " / " + this.stats.bails, 49, 352, 27, col);
    const rec = this.lineRecord?.(); text(g, this.mode === 2 ? "CAREER UNCHANGED" : "MEDAL " + MEDALS[this.mode === 1 && rec ? rec.medal : s.medals[this.parkId]], 49, 400, 20, col); text(g, "LINES " + s.lines[this.parkId].length + "/3 / GOALS " + s.goals[this.parkId].length + "/5", 49, 447, 18, C.muted);
    panel(g, 441, 138, 491, 338, col); text(g, this.mode === 1 ? (this.lineMet ? "CHALLENGE BANKED" : "NEXT ATTEMPT") : "NEXT SIGNAL", 460, 165, 20, C.amber);
    const next = this.mode === 1 ? this.challenge().text : this.park().goals.find((_, i) => !s.goals[this.parkId].includes(i))?.text;
    paragraph(g, this.mode === 2 ? "Try a clean air. Land and roll to bank, then link the next air with a manual." : next || "All park goals banked. Try a new line or another park.", 461, 205, 450, 22, C.ink, 3); line(g, 461, 301, 911, 301);
    if (this.mode === 2) paragraph(g, "No clock. No career rewards. Your progress and records remain safe.", 461, 328, 449, 20, col, 3);
    else if (this.mode === 1) {
      text(g, this.lastBank?.newMedal ? "NEW LINE MEDAL / NEXT TIER" : this.lastBank?.newBest ? "PERSONAL BEST / NEXT TIER" : "NEXT MASTERY TIER", 461, 329, 18, col);
      paragraph(g, this.masteryGoal?.() || "BRONZE: BANK THE TARGET", 461, 365, 448, 20, C.ink, 3);
    }
    else if (this.newGoals.length) for (let i = 0; i < Math.min(3, this.newGoals.length); i++) paragraph(g, "NEW / " + this.newGoals[i], 461, 327 + i * 43, 448, 18, col, 2);
    else paragraph(g, this.mode === 1 ? this.masteryGoal?.() || "Bank the target. Land upright and let the roll window finish." : "Different tricks grow the multiplier. Clean landings build your skill medal.", 461, 328, 448, 20, col, 3);
    if (this.mode === 1 && rec) text(g, "LINE PB " + fmt(rec.best) + (rec.time ? " / " + rec.time + "s" : "") + " / MASTERY " + (this.masteryCount?.() || 0) + "/36", 461, 450, 17, C.amber);
    this.footer(g, this.overT >= LOCKOUT ? "TAP / CASE: RIDE AGAIN  ·  HOLD: SETUP" : "LINE SETTLING…");
  }
  drawGuide(g) {
    const page = GUIDE[this.guide], col = this.theme().accent; this.menuHeader(g, page[0], "FIELD GUIDE / " + (this.guide + 1) + " OF " + GUIDE.length); panel(g, 28, 137, 904, 339, col); const y = 216;
    if (this.guide === 0 || this.guide === 3) { line(g, 230, y + 29, 360, y + 60, col, 2); line(g, 360, y + 60, 730, y + 60, col, 2); for (let i = 0; i < 12; i++) circle(g, 355 + i * 23, y + 20 - Math.sin(i / 11 * Math.PI) * 64, 2, C.amber, true); text(g, this.guide === 3 ? "LAND → ROLL 1.2s → BANK" : "PUMP → OLLIE → STRAIGHTEN", 480, y - 51, 20, col, "center"); if (this.guide === 3) gauge(g, 630, y + 14, 125, .7, C.amber); }
    else if (this.guide === 1) { circle(g, 480, y - 28, 7, col, true); circle(g, 480, y - 28, 66, col, false, 1); line(g, 480, y - 28, 523, y + 33, C.ink, 3); line(g, 523, y + 33, 605, y - 13, C.amber, 2); text(g, "CATCH / SWING / TANGENT RELEASE", 480, y + 77, 20, col, "center"); }
    else if (this.guide === 2) for (let i = 0; i < 3; i++) { const x = 190 + i * 290; g.strokeStyle = col; g.lineWidth = 2; g.strokeRect(x - 37, y - 24, 74, 48); for (let j = 0; j < 4; j++) circle(g, x - 24 + j * 16, y - 10, 4, col); circle(g, x + 38, y + 7, 11, C.amber); circle(g, x + 38, y + 7, 18, C.amber, false, 1); text(g, ["MANUAL", "SHOVE-IT", "REGRIP"][i], x, y + 57, 20, col, "center"); }
    else if (this.guide === 4) for (let i = 0; i < 3; i++) { const x = 70 + i * 295; panel(g, x, y - 40, 265, 86, col); text(g, MODES[i], x + 133, y - 15, 21, C.ink, "center"); text(g, ["120s / PARK GOALS", "TIMED / ONE TARGET", "UNTIMED / WARMUP"][i], x + 133, y + 17, 15, col, "center"); }
    else for (let i = 0; i < 4; i++) { const x = 195 + i * 190; circle(g, x, y, 26, col, false, 2); circle(g, x, y, 17, i % 2 ? C.amber : col, true); text(g, ["I", "II", "III", "IV"][i], x, y + 49, 20, C.ink, "center"); }
    let yy = 339; for (let i = 1; i < page.length; i++) yy = paragraph(g, page[i], 60, yy, 843, 20, C.ink, 2) + 6; this.footer(g, "TAP: NEXT  ·  CASE: PREVIOUS  ·  HOLD: RIDE / RETURN");
  }
}
