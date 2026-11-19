import { C, text, textSize, textFloor, line, circle } from "../engine/draw.js";
import { clamp } from "../engine/math.js";
import { LOCKOUT } from "./game-kit.js";
import { G, STEP, BAIL_T, ROLL, LAND_TOL, STYLE_TIME, GUIDE, MODES, MEDALS, PARKS, LINES, UNLOCK, barLaunchVelocity, platformContact } from "./highbar-content.js";

const fmt = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const unlocked = (s, p) => p === 0 || s.goals[p - 1].length >= UNLOCK;
function panel(g, x, y, w, h, accent = C.line) {
  g.fillStyle = "#0c1511ed"; g.fillRect(x, y, w, h);
  g.strokeStyle = C.line; g.lineWidth = 1; g.strokeRect(x, y, w, h);
  line(g, x, y, x + Math.min(52, w), y, accent, 2);
  line(g, x + w, y + h - 14, x + w, y + h, accent, 2);
}
const short = (value, n) => String(value).length > n ? String(value).slice(0, n - 1) + "…" : String(value);
// Under a text floor (the iPhone app) a line is cut to what fits `width` at the size really drawn;
// without one, as the console always drew it.
const clip = (value, width, size) => textFloor() ? short(value, Math.floor(width / (textSize(size) * .61))) : String(value);
const fits = (n, width, size) => textFloor() ? Math.min(n, Math.floor(width / (textSize(size) * .61))) : n;
// How many rows paragraph() takes for `value` (the same wrap).
function rows(value, width, size, max = 3) {
  size = textSize(size);
  const words = String(value).split(/\s+/), limit = Math.max(10, Math.floor(width / (size * .62)));
  let row = "", count = 0;
  for (const word of words) {
    if (row && row.length + word.length + 1 > limit) { row = word; if (++count >= max) return count; }
    else row = row ? row + " " + word : word;
  }
  return count + (row ? 1 : 0);
}
function paragraph(g, value, x, y, width, size = 20, colour = C.ink, max = 3) {
  size = textSize(size); // wrap and space the rows at the size they are drawn
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
  quietMotion() { return !!this.c.settings?.()?.reducedMotion; }
  masteryTotal() { return LINES.reduce((n, lines) => n + lines.length * 3, 0); }
  draw(g) {
    this.ensurePark(); this.drawSkyline(g);
    g.save(); g.translate(-Math.round(this.camX), -Math.round(this.camY)); this.drawPark(g);
    if (this.phase === "play" || this.phase === "over") {
      if (this.mode === 2 && this.phase === "play") this.drawTrajectory(g);
      g.fillStyle = this.theme().accent;
      if (!this.quietMotion()) for (let i = 0; i < this.trail.length; i++) { const q = this.trail[i]; g.globalAlpha = .08 + .35 * i / this.trail.length; g.fillRect(q[0] - 1, q[1] - 14, 3, 3); }
      g.globalAlpha = 1; this.drawRider(g);
    }
    if (!this.quietMotion()) for (const q of this.parts) { g.globalAlpha = 1 - q.t / .6; g.fillStyle = q.color; g.fillRect(q.x - 2, q.y - 2, 4, 4); }
    g.globalAlpha = 1;
    // Trick bursts belong in the compact line readout, never over the rider.
    g.restore();
    if (this.phase !== "play") { g.fillStyle = "#09120ce0"; g.fillRect(0, 0, 960, 540); }
    if (this.phase === "play") {
      this.drawCoach(g); this.drawCombo(g);
      this.drawRouteCue(g);
    } else if (this.phase === "title") this.drawTitle(g);
    else if (this.phase === "setup") this.drawSetup(g);
    else if (this.phase === "over") this.drawOver(g);
    else if (this.phase === "guide") this.drawGuide(g);
  }
  drawSkyline(g) {
    const park = this.park(), theme = this.theme();
    g.fillStyle = theme.sky; g.fillRect(0, 0, 960, 540);
    g.fillStyle = theme.secondary; g.globalAlpha = .2;
    for (let i = 0; i < 18; i++) g.fillRect((i * 193 + 73 - this.camX * .04 + 9600) % 960, (i * 83 + 31 - this.camY * .025 + 5400) % 540, 1, 1);
    const mx = 810 - this.camX * .025, my = 100 - this.camY * .025;
    circle(g, mx, my, this.parkId === 3 ? 58 : 25, theme.secondary, false, 1);
    if (this.parkId === 3) line(g, mx - 70, my + 9, mx + 70, my - 9, theme.secondary);
    // Low-contrast silhouettes carry park identity without resembling catchable bars.
    const base = 500 - (this.camY - Math.max(0, park.h - 540)) * .12;
    g.globalAlpha = .65; g.fillStyle = theme.far;
    for (let i = -1; i < 8; i++) {
      const x = i * 160 - (this.camX * .12 % 160), h = 70 + ((i + 17) * 37 % 100);
      if (park.id === "pipe") { g.beginPath(); g.moveTo(x - 10, base + 80); g.lineTo(x + 36, base - h); g.lineTo(x + 120, base + 80); g.closePath(); g.fill(); }
      else if (park.id === "bowl") { g.fillRect(x, base - h + 30, 90, h + 60); circle(g, x + 45, base - h + 30, 45, theme.far, true); }
      else { g.fillRect(x, base - h, park.id === "tower" ? 46 : 112, h + 80); if (park.id === "yard") line(g, x - 12, base - h - 14, x + 130, base - h - 14, theme.far, 3); }
    }
    g.globalAlpha = 1;
  }
  drawPark(g) {
    const park = this.park(), theme = this.theme(), hm = this.hm;
    const i0 = Math.max(0, Math.floor((this.camX - 20) / STEP)), i1 = Math.min(hm.length - 1, Math.ceil((this.camX + 980) / STEP)), bottom = Math.max(park.h, this.camY + 560);
    const left = Math.min(i0 * STEP, this.camX - 20), right = Math.max(i1 * STEP, this.camX + 980);
    g.beginPath(); g.moveTo(left, bottom); g.lineTo(left, hm[i0]); for (let i = i0; i <= i1; i += 2) g.lineTo(i * STEP, hm[i]);
    g.lineTo(i1 * STEP, hm[i1]); g.lineTo(right, hm[i1]); g.lineTo(right, bottom); g.closePath(); g.fillStyle = theme.ground; g.fill();
    for (let depth = 0; depth < 2; depth++) { g.beginPath(); for (let i = i0; i <= i1; i += 3) { if (i === i0) g.moveTo(i * STEP, hm[i] + depth * 9); else g.lineTo(i * STEP, hm[i] + depth * 9); } g.strokeStyle = depth ? C.line : theme.accent; g.lineWidth = depth ? 1 : 3; g.stroke(); }
    const geo = this.geo; line(g, geo.lipL, geo.lipY, geo.lipL, geo.lipY - 600, C.line, 2); line(g, geo.lipR, geo.lipY, geo.lipR, geo.lipY - 600, C.line, 2);
    circle(g, geo.lipL, geo.lipY, 5, theme.secondary, true); circle(g, geo.lipR, geo.lipY, 5, theme.secondary, true);
    for (const deck of park.platforms || []) {
      if (deck.x2 < this.camX - 20 || deck.x1 > this.camX + 980 || deck.y < this.camY - 20 || deck.y > this.camY + 560) continue;
      g.fillStyle = theme.ground; g.fillRect(deck.x1, deck.y, deck.x2 - deck.x1, 11);
      line(g, deck.x1, deck.y, deck.x2, deck.y, theme.accent, 3);
      line(g, deck.x1, deck.y + 11, deck.x2, deck.y + 11, C.line);
      line(g, deck.x1 + 10, deck.y + 11, deck.x1 + 22, deck.y + 21, C.line);
      line(g, deck.x2 - 10, deck.y + 11, deck.x2 - 22, deck.y + 21, C.line);
    }
    const marker = this.barMarker(), target = marker.index;
    for (let i = 0; i < park.bars.length; i++) {
      const [x, y, kind] = park.bars[i]; if (x < this.camX - 50 || x > this.camX + 1010 || y < this.camY - 50 || y > this.camY + 600) continue;
      const ground = this.groundY(x), col = kind === "whip" ? C.amber : theme.accent;
      g.globalAlpha = .28; line(g, x, y + 7, x, Math.min(ground, this.camY + 560), theme.accent); g.globalAlpha = 1;
      line(g, x - 21, y, x + 21, y, col, 4); line(g, x - 21, y + 6, x + 21, y + 6, C.line); circle(g, x - 21, y, 3, col, true); circle(g, x + 21, y, 3, col, true);
      if (i === target) {
        if (marker.catchable) circle(g, x, y, 25, C.ink, false, 2);
        else { line(g, x - 7, y - 27, x, y - 34, col, 2); line(g, x, y - 34, x + 7, y - 27, col, 2); }
        text(g, (marker.catchable ? "CATCH " : "NEXT ") + "B" + (i + 1), x, y - 49, 16, marker.catchable ? C.ink : col, "center");
      }
    }
    for (const m of park.landmarks || []) {
      if (m.x < this.camX - 120 || m.x > this.camX + 1080 || m.y < this.camY - 120 || m.y > this.camY + 580) continue;
      g.globalAlpha = .16;
      if (m.kind === "moon") circle(g, m.x, m.y, 38, theme.secondary, false, 1);
      else if (m.kind === "tank") { g.strokeStyle = theme.accent; g.strokeRect(m.x - 30, m.y - 30, 60, 55); circle(g, m.x, m.y - 30, 30, theme.accent); }
      else if (m.kind === "gantry") { line(g, m.x - 70, m.y + 75, m.x - 70, m.y - 35, theme.accent, 2); line(g, m.x + 70, m.y + 75, m.x + 70, m.y - 35, theme.accent, 2); line(g, m.x - 90, m.y - 35, m.x + 90, m.y - 35, theme.accent, 3); line(g, m.x + 25, m.y - 35, m.x + 25, m.y + 20, theme.secondary); }
      else { line(g, m.x, m.y, m.x, m.y - 48, theme.accent, 2); circle(g, m.x, m.y - 48, 5, theme.secondary); line(g, m.x - 22, m.y - 20, m.x + 22, m.y - 20, theme.accent); }
      g.globalAlpha = 1;
    }
    if (this.mode === 1) {
      const gap = park.gaps.find(q => q.id === this.challenge().gap);
      if (gap?.t === "span") { const y = park.floor - 42; line(g, gap.x1, y, gap.x1, y + 18, C.amber, 2); line(g, gap.x2, y, gap.x2, y + 18, C.amber, 2); }
    }
  }
  barMarker() {
    if (this.phase !== "play" || this.p.mode === "bail") return { index: -1, catchable: false };
    const catchable = this.p.mode === "air" && this.pressAction !== "flip" ? this.pickBar() : -1;
    if (catchable >= 0) return { index: catchable, catchable: true };
    const route = this.mode === 1 ? this.routeTarget?.() : -1;
    if (Number.isInteger(route) && route >= 0) return { index: route, catchable: false };
    const p = this.p, bars = this.park().bars, originY = p.mode === "bar" ? bars[p.bar][1] : p.y;
    let index = -1, best = Infinity;
    for (let i = 0; i < bars.length; i++) {
      const [x, y] = bars[i], dx = Math.abs(x - p.x), dy = originY - y;
      if (i === p.bar && p.mode === "bar" || i === p.lastBar && p.lastBarT < .45 || dy < 20 || dx > 500) continue;
      const distance = Math.hypot(dx * 1.2, dy);
      if (distance < best) { best = distance; index = i; }
    }
    return { index, catchable: false };
  }
  drawTrajectory(g) {
    const p = this.p; if (p.mode !== "air" && p.mode !== "bar") return;
    let vx = p.vx, vy = p.vy; if (p.mode === "bar") ({ vx, vy } = barLaunchVelocity(p, this.park().bars[p.bar][2]));
    g.fillStyle = this.theme().secondary; g.globalAlpha = .55;
    let x0 = p.x, y0 = p.y;
    for (let i = 1; i <= 18; i++) {
      const t = i * .055, x = p.x + (p.vert ? 0 : vx * t), y = p.y + vy * t + .5 * G * t * t;
      if (p.vert ? vy + G * t > 0 && y >= this.geo.lipY : x < this.geo.lipL || x > this.geo.lipR || y > this.groundY(x) || platformContact(this.park().platforms, x0, y0, x, y)) break;
      g.fillRect(x - 1, y - 1, 3, 3); x0 = x; y0 = y;
    }
    g.globalAlpha = 1;
  }
  drawRider(g) {
    const p = this.p, theme = this.theme(), low = p.tuck || p.crouch, bail = p.mode === "bail", quiet = this.quietMotion();
    const speed = p.mode === "ground" ? p.s : p.vx, reach = Math.min(p.r, 85);
    const happy = this.noteT > 0 && this.lastBank && !this.combo.tricks.length && !bail;
    if (p.mode === "bar") { const [bx, by] = this.park().bars[p.bar]; line(g, bx, by, p.x + reach * Math.sin(p.rot), p.y - reach * Math.cos(p.rot), theme.accent, 2); }
    g.save(); g.translate(p.x, p.y); g.rotate(bail && !quiet ? p.rot + (BAIL_T - p.bailT) * 9 : p.rot); g.scale(1.35, 1.35);
    const col = bail ? C.red : C.ink, cy = low ? -23 : -29;
    const style = this.air?.style, turn = style ? clamp((this.air.t - style.at) / STYLE_TIME, 0, 1) : 0;
    const kick = style?.kind === "kickflip", spin = Math.cos(turn * Math.PI * (kick ? 4 : 2)), nose = kick ? Math.sin(turn * Math.PI * 2) * 7 : 0;
    line(g, -19 * spin, -3 + nose, 19 * spin, -3 - nose, theme.secondary, 4);
    line(g, -19 * spin, -3 + nose, -23 * spin, -6 + nose, theme.secondary, 3);
    line(g, 19 * spin, -3 - nose, 23 * spin, -6 - nose, theme.secondary, 3);
    circle(g, -12, 2 + nose, 3, theme.accent, true); circle(g, 12, 2 - nose, 3, theme.accent, true);
    // Four independently articulated pairs: rear legs grip the deck, front legs
    // kick, reach, wave or tuck. Animation reads simulation state without changing it.
    for (const side of [-1, 1]) for (let i = 0; i < 4; i++) {
      const wave = quiet ? 0 : Math.sin(this.t * (bail ? 19 : 6 + Math.min(9, Math.abs(speed) / 90)) + i * 1.5 + side), ax = side * (7 + i), ay = cy - 7 + i * 5;
      let kneeX = side * (22 + i * 2), kneeY = cy - 17 + i * 9, footX = side * (28 - i * 4), footY = i < 2 ? cy - 9 + i * 10 : -5;
      if (p.mode === "bar" && i < 2) { kneeY = cy - 20 - i * 7; footY = -reach / 1.35; footX = side * (9 + i * 5); }
      else if (low && p.mode === "air") { kneeX = side * (14 + i); kneeY = cy - 11 + i * 7; footX = side * 8; footY = cy + 6; }
      else if (kick && turn < 1 && i < 2) { kneeY = cy - 20 + i * 8; footX = side * 27; footY = cy - 6; }
      else if (p.crouch && i < 2) { kneeY += wave * 8; footY = -5 + wave * 10; footX += wave * 7 * (speed < 0 ? -1 : 1); }
      else if ((happy || bail) && i < 3) { kneeY += wave * 8; footY = cy - 16 + wave * 10; }
      else if (p.mode === "air" && i < 2) { footY = cy - 14 + wave * 3; }
      line(g, ax, ay, kneeX, kneeY, col, 2.5); line(g, kneeX, kneeY, footX, footY, col, 2.5);
      if (i < 2) line(g, footX, footY, footX - side * 4, footY - 3, col, 2);
    }
    g.fillStyle = theme.accent; g.beginPath(); g.ellipse(0, cy, low ? 13 : 14, low ? 12 : 10, 0, 0, Math.PI * 2); g.fill();
    circle(g, 0, cy - 12, 12, col, true);
    const blink = !quiet && this.t % 4 > 3.84 && !bail && !happy;
    for (const ex of [-5, 5]) {
      if (bail) { line(g, ex - 2, cy - 17, ex + 2, cy - 13, theme.sky, 2); line(g, ex - 2, cy - 13, ex + 2, cy - 17, theme.sky, 2); }
      else if (blink || happy) { g.beginPath(); g.arc(ex, cy - 14, 3, Math.PI, Math.PI * 2); g.strokeStyle = theme.sky; g.lineWidth = 2; g.stroke(); }
      else { circle(g, ex, cy - 15, 4, theme.sky, true); circle(g, ex + (speed >= 0 ? 1 : -1), cy - 16, 1.5, C.ink, true); }
    }
    if (happy) { g.beginPath(); g.arc(0, cy - 9, 3, 0, Math.PI); g.strokeStyle = theme.sky; g.lineWidth = 1.5; g.stroke(); }
    g.restore();
  }
  drawMap(g, x, y, w, h, live = false) {
    const park = this.park(), theme = this.theme(), sx = w / park.w, sy = h / park.h;
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); g.beginPath();
    for (let i = 0; i <= 80; i++) { const wx = park.w * i / 80, yy = y + this.groundY(wx) * sy; if (i === 0) g.moveTo(x, yy); else g.lineTo(x + wx * sx, yy); }
    g.strokeStyle = theme.accent; g.lineWidth = 2; g.stroke();
    for (const b of park.bars) { const bx = x + b[0] * sx, by = y + b[1] * sy; line(g, bx, by, bx, y + this.groundY(b[0]) * sy, C.line); line(g, bx - 4, by, bx + 4, by, b[2] === "whip" ? C.amber : theme.secondary, 2); }
    for (const deck of park.platforms || []) line(g, x + deck.x1 * sx, y + deck.y * sy, x + deck.x2 * sx, y + deck.y * sy, theme.accent, 2);
    const route = this.mode === 1 ? this.routeProgress?.() : null;
    if (route) {
      let previous;
      for (const index of route.bars) {
        const b = park.bars[index], bx = x + b[0] * sx, by = y + b[1] * sy;
        if (previous) { g.globalAlpha = .6; line(g, previous[0], previous[1], bx, by, theme.secondary); g.globalAlpha = 1; }
        circle(g, bx, by, 4, theme.secondary, false, 1);
        if (textSize(11) <= 16) text(g, "B" + (index + 1), bx + 6, by - 3, 11, C.ink);
        previous = [bx, by];
      }
    }
    if (live) { g.strokeStyle = C.muted; g.lineWidth = 1; g.strokeRect(x + this.camX * sx, y + this.camY * sy, 960 * sx, 540 * sy); circle(g, x + this.p.x * sx, y + this.p.y * sy, 3, C.ink, true); }
    g.restore();
  }
  // All fixed play HUD rectangles together cover less than 14% of 960x540.
  // The route map and detailed instruction remain in setup / the game guide.
  playHudRects() { return [[18, 14, 640, 38], [674, 14, 268, 38], [18, 476, 390, 48], [428, 488, 514, 36]]; }
  drawCoach(g) {
    const p = this.p, col = this.theme().accent, bar = p.mode === "air" && this.pressAction !== "flip" ? this.pickBar() : -1, release = p.mode === "bar" ? this.releaseAdvice?.() : null,
      flight = p.mode === "air" ? this.flightAdvice?.() : null; let action;
    if (this.resumeT > 0) action = "RESUMING / RELEASE BUTTON";
    else if (p.mode === "bail") action = "RECOVERING / NEXT LINE";
    else if (release) action = release.phase === "rise" ? "RELEASE: CLIMB ↑" : release.phase === "travel" ? "RELEASE: CROSS " + (release.direction < 0 ? "←" : "→") : "RELEASE: DESCEND";
    else if (p.mode === "bar") action = "SWING";
    else if (p.mode === "air" && p.tuck) action = flight?.urgent ? "RELEASE: STRAIGHTEN" : "FLIPPING";
    else if (bar >= 0) action = (this.pending ? "CATCHING B" : this.pressed ? "RELEASE / PRESS: B" : "PRESS + HOLD: B") + (bar + 1);
    else if (p.mode === "air") action = flight?.urgent ? "RELEASE: STRAIGHTEN" : "AIR";
    else action = p.crouch ? "BUILDING SPEED" : "SKATING";
    panel(g, 18, 14, 640, 38, col); text(g, action, 32, 34, 20, C.ink);
    let label = "SPEED", value = Math.abs(p.s || Math.hypot(p.vx, p.vy)) / 820, colour = col;
    if (flight) { label = flight.urgent ? "RELEASE" : flight.kind === "clean" ? "CLEAN" : flight.kind === "safe" ? "SAFE" : flight.kind === "sketchy" ? "SKETCHY" : "LAND RISK"; value = 1 - flight.off / (this.air?.style ? LAND_TOL * .7 : LAND_TOL); colour = flight.kind === "bail" || flight.urgent ? C.red : flight.kind === "sketchy" ? C.amber : C.cyan; }
    else if (p.mode === "air") { label = "AIR"; value = 0; colour = C.muted; }
    else if (this.combo.roll >= 0) { label = "BANKING"; value = 1 - this.combo.roll / ROLL; colour = C.amber; }
    else if (release) { label = release.phase === "rise" ? "UPWARD" : release.phase === "travel" ? "CROSS" : "DOWNWARD"; value = Math.hypot(release.vx, release.vy) / 820; colour = release.phase === "fall" ? C.amber : col; }
    else if (p.mode === "bar") { label = "SWING"; value = Math.abs(Math.sin(p.phi)); }
    else if (p.mode === "bail") { label = "RECOVER"; value = 1 - p.bailT / BAIL_T; colour = C.red; }
    panel(g, 674, 14, 268, 38, colour); text(g, label, 689, 34, 16, colour); gauge(g, 818, 32, 108, value, colour);
    const style = p.mode === "bar" && !p.regrip && p.held > .15 ? "REGRIP" : this.canKickflip?.() ? "KICKFLIP" : p.mode === "air" && !this.air?.style && this.canStyle() ? "SHOVE-IT" : "";
    if (style) text(g, "TAP: " + style, 643, 34, 15, col, "right");
  }
  drawCombo(g) {
    const c = this.combo, col = this.theme().accent;
    if (!c.tricks.length) {
      if (this.lastBank && this.noteT > 0) { panel(g, 18, 476, 390, 48, col); text(g, "BANKED " + fmt(this.lastBank.value), 32, 501, 21, col); }
      return;
    }
    panel(g, 18, 476, 390, 48, col);
    text(g, fmt(c.sum) + " x" + Math.min(this.variety(c), 8), 32, 491, 22, c.roll >= 0 ? C.amber : C.ink);
    const label = c.roll >= 0 ? "ROLL TO BANK" : "LINE";
    text(g, short(c.tricks.at(-1).name, fits(20, 360 - (label.length + 2) * textSize(15) * .61, 17)), 392, 513, 17, col, "right");
    text(g, label, 32, 513, 15, C.muted);
    if (c.roll >= 0) gauge(g, 258, 488, 134, 1 - c.roll / ROLL, C.amber);
  }
  drawRouteCue(g) {
    let cue = "", col = this.theme().accent; const lesson = this.lessonCue?.();
    // Exactly one contextual notice. Detailed route progress lives outside play.
    if (this.landing?.t > 0 && this.landing.reason && this.p.mode === "bail") { cue = this.landing.reason; col = C.red; }
    else if (this.landing?.t > 0 && this.p.mode === "ground") { cue = this.landing.kind === "clean" ? "CLEAN LANDING / ROLL TO BANK" : this.landing.kind === "sketchy" ? "SKETCHY LANDING / NEXT ONE CLEAN" : "LANDED / ROLL TO BANK"; col = this.landing.kind === "sketchy" ? C.amber : col; }
    else if (this.styleNotice && this.t - this.tapAt >= 0 && this.t - this.tapAt < 1.3 && (this.p.regrip || this.air?.style)) cue = this.styleNotice;
    else if (lesson) cue = lesson;
    else if (this.noteT > 0) { cue = this.note; col = C.amber; }
    else if (this.mode === 1) {
      const route = this.routeProgress?.(), next = this.routeTarget?.();
      cue = route && !route.complete && next >= 0 ? short(route.name, 24) + " " + route.step + "/" + route.total + " / B" + (next + 1) : this.challengeCue?.() || (this.lineMet ? "BANKED / " + this.challenge().name : this.meetsLine(this.challenge(), this.combo) ? "READY / LAND + ROLL TO BANK" : "TARGET / " + this.challenge().name);
    }
    else {
      const marker = this.barMarker();
      if (marker.index >= 0) {
        const [x, y] = this.park().bars[marker.index];
        if (y - this.camY < 85 || x - this.camX < 30 || x - this.camX > 930) cue = "NEXT " + (y - this.camY < 85 ? "↑" : x - this.camX < 30 ? "←" : "→") + " B" + (marker.index + 1);
      }
      if (!cue && this.mode === 2 && this.practiceSlow) cue = "PRACTICE / HALF SPEED";
    }
    if (cue) { panel(g, 428, 488, 514, 36, col); text(g, short(cue, fits(45, 492, 17)), 441, 507, 17, col); }
  }
  menuHeader(g, heading, sub) { text(g, "HIGH BAR / " + (this.park().district || "OFFWORLD FIELD COURSE"), 36, 32, 16, this.theme().accent); text(g, heading, 36, 76, 38, C.ink); if (sub) text(g, sub, 36, 112, 18, C.muted); }
  footer(g, value) { panel(g, 28, 492, 904, 34, this.theme().accent); text(g, value, 480, 510, 20, C.amber, "center"); }
  drawTitle(g) {
    const s = this.slot(), park = this.park(), col = this.theme().accent; this.menuHeader(g, "SKATE THE SIGNAL", "SLOT " + (this.save.slot + 1) + " / " + MODES[this.mode] + " / " + park.name);
    panel(g, 28, 139, 510, 337, col); text(g, "PARK GOALS / " + s.goals[this.parkId].length + " OF 5", 46, 162, 19, col); this.drawGoals(g, 202, 46, 476, 49);
    panel(g, 554, 139, 378, 337, col); text(g, park.name, 574, 166, 28, C.ink); paragraph(g, park.tagline || park.text, 574, 200, 336, 18, C.muted, 2); this.drawMap(g, 576, 253, 332, 131);
    const rec = this.lineRecord?.();
    text(g, "MEDAL " + MEDALS[this.mode === 1 && rec ? rec.medal : s.medals[this.parkId]] + " / LINES " + s.lines[this.parkId].length + "/" + LINES[this.parkId].length, 574, 401, 18, col);
    const archive = s.legacyRecords?.flowV4 || s.legacyRecords?.flowV3 || s.legacyRecords?.styleV2;
    const prior = archive?.flowBest?.[this.parkId] ?? archive?.styleBest?.[this.parkId];
    if (prior) text(g, "PREVIOUS RULES BEST " + fmt(prior), 574, 424, 14, C.muted);
    text(g, clip(this.mode === 2 ? "PRACTICE / RECORDS STAY SAFE" : this.mode === 1 && rec ? "LINE PB " + fmt(rec.best) : "FLOW BEST " + fmt((s.flowBest || s.styleBest)[this.parkId]), 352, 18), 574, 447, 18, C.amber);
    this.footer(g, (s.guided ? "TAP: RIDE" : "TAP: LEARN AND RIDE") + "  ·  HOLD: SETUP / MASTERY " + (this.masteryCount?.() || 0) + "/" + this.masteryTotal());
  }
  drawGoals(g, y0, x = 300, width = 500, step = 26) { if (textFloor()) step = Math.max(step, textSize(18) * 2 + 11); const done = this.slot().goals[this.parkId]; for (let i = 0; i < this.park().goals.length; i++) { const ok = done.includes(i), yy = y0 + i * step; circle(g, x + 6, yy, 5, ok ? this.theme().accent : C.muted, ok, 1); paragraph(g, this.park().goals[i].text, x + 23, yy, width - 23, 18, ok ? this.theme().accent : C.ink, 2); } }
  drawSetup(g) {
    const park = this.park(), col = this.theme().accent, ch = this.challenge(); this.menuHeader(g, "PARK + LINE", "CHOOSE A COURSE, A CHALLENGE, OR AN UNTIMED WARMUP");
    panel(g, 28, 137, 546, 339, col); const items = this.setupItems(), first = Math.max(0, Math.min(this.cursor - 6, items.length - 8)), last = Math.min(items.length, first + 8);
    for (let i = first; i < last; i++) { const yy = 163 + (i - first) * 38, on = i === this.cursor; if (on) { g.fillStyle = col; g.fillRect(40, yy - 15, 522, 31); } text(g, (on ? "> " : "  ") + short(items[i].label, fits(40, 506, 20)), 48, yy, 20, on ? C.bg : C.ink); }
    if (items.length > 8) text(g, (first > 0 ? "↑ " : "") + (this.cursor + 1) + "/" + items.length + (last < items.length ? " ↓" : ""), 558, 457, 15, col, "right");
    panel(g, 590, 137, 342, 339, col); text(g, park.name, 608, 163, 27, C.ink);
    if (items[this.cursor]?.id === "line" && ch.approach) {
      text(g, short(ch.name, fits(24, 316, 20)), 608, 203, 20, col);
      let ay = 0;
      for (let i = 0; i < Math.min(3, ch.approach.length); i++) {
        const step = (i + 1) + ". " + ch.approach[i], y = textFloor() ? Math.max(236 + i * 74, ay) : 236 + i * 74;
        if (textFloor() && y + (rows(step, 307, 18) - 1) * (textSize(18) + 7) > 440) break;
        ay = paragraph(g, step, 608, y, 307, 18, C.ink, 3) + 6;
      }
    } else { this.drawMap(g, 609, 187, 304, 76); text(g, short(ch.name, fits(24, 316, 20)), 608, 282, 20, col); paragraph(g, this.mode === 2 ? this.practiceLabel?.() || park.routeTip || ch.text : ch.text, 608, 337, 306, 18, C.ink, 3); }
    const record = this.lineRecord?.(); text(g, clip((this.mode === 2 ? "UNTIMED" : this.lineSeconds() + "s") + " / " + (record ? MEDALS[record.medal] + " / " + fmt(record.best) : ch.skill || "BANK YOUR LINE"), 316, 17), 608, 465, 17, C.amber);
    const open = PARKS.filter((_, i) => unlocked(this.slot(), i)).length; this.footer(g, "TAP: NEXT  ·  CASE: PREVIOUS  ·  HOLD: CHOOSE / " + open + "/4 PARKS");
  }
  drawOver(g) {
    const s = this.slot(), col = this.theme().accent, result = this.mode === 1 ? this.attemptResult : null;
    this.menuHeader(g, this.mode === 2 ? "PRACTICE COMPLETE" : result ? "LINE BANKED" : this.mode === 1 ? "LINE REPORT" : "SESSION REPORT", (result?.name || this.park().name) + " / SLOT " + (this.save.slot + 1));
    panel(g, 28, 138, 397, 338, col); text(g, this.mode === 2 ? "PRACTICE SCORE" : "BANKED SCORE", 49, 166, 18, col); text(g, fmt(this.score), 49, 214, 48, C.ink); line(g, 49, 251, 402, 251);
    text(g, "BEST COMBO", 49, 279, 18, C.muted); text(g, fmt(this.bestCombo), 401, 279, 22, C.amber, "right"); text(g, "CLEAN / BANKS / BAILS", 49, 319, 17, C.muted); text(g, this.stats.clean + " / " + this.stats.banks + " / " + this.stats.bails, 49, 352, 27, col);
    const rec = this.lineRecord?.(); text(g, this.mode === 2 ? "CAREER UNCHANGED" : result ? "TARGET COMPLETE" : "MEDAL " + MEDALS[this.mode === 1 && rec ? rec.medal : s.medals[this.parkId]], 49, 400, 20, col); text(g, "LINES " + s.lines[this.parkId].length + "/" + LINES[this.parkId].length + " / GOALS " + s.goals[this.parkId].length + "/5", 49, 447, 18, C.muted);
    panel(g, 441, 138, 491, 338, col); text(g, result ? "EARNED / " + MEDALS[result.medal] : this.mode === 1 ? "NEXT ATTEMPT" : "NEXT SIGNAL", 460, 165, 20, C.amber);
    const next = this.mode === 1 ? this.challenge().text : this.park().goals.find((_, i) => !s.goals[this.parkId].includes(i))?.text;
    if (result) {
      text(g, short(result.name, 27), 461, 210, 26, C.ink);
      text(g, "TARGET COMBO " + fmt(result.value), 461, 252, 20, col);
      text(g, result.time + "s" + (result.timeImproved ? " / FASTEST" : "") + (result.bestImproved ? " / COMBO PB" : ""), 911, 281, 17, C.amber, "right");
    } else paragraph(g, this.mode === 2 ? "Try a clean air. Land and roll to bank, or ollie again to link the next air." : next || "All park goals banked. Try a new line or another park.", 461, 205, 450, 22, C.ink, 3);
    line(g, 461, 301, 911, 301);
    if (this.mode === 2) paragraph(g, "No clock. No career rewards. Your progress and records remain safe.", 461, 328, 449, 20, col, 3);
    else if (this.mode === 1) {
      text(g, result?.medalImproved ? "NEW MEDAL / NEXT TIER" : result?.bestImproved || result?.timeImproved ? "PERSONAL BEST / NEXT TIER" : "NEXT MASTERY TIER", 461, 329, 18, col);
      paragraph(g, this.masteryGoal?.() || "BRONZE: BANK THE TARGET", 461, 365, 448, 20, C.ink, 3);
    }
    else if (this.newGoals.length) {
      let ny = 0;
      for (let i = 0; i < Math.min(3, this.newGoals.length); i++) {
        const goal = "NEW / " + this.newGoals[i], y = textFloor() ? Math.max(327 + i * 43, ny) : 327 + i * 43;
        if (textFloor() && y + (rows(goal, 448, 18, 2) - 1) * (textSize(18) + 7) > 462) break;
        ny = paragraph(g, goal, 461, y, 448, 18, col, 2) + 6;
      }
    }
    else paragraph(g, this.mode === 1 ? this.masteryGoal?.() || "Bank the target. Land upright and let the roll window finish." : "Different tricks grow the multiplier. Clean landings build your skill medal.", 461, 328, 448, 20, col, 3);
    if (this.mode === 1 && rec) text(g, clip("LINE PB " + fmt(rec.best) + (rec.time ? " / " + rec.time + "s" : "") + " / MASTERY " + (this.masteryCount?.() || 0) + "/" + this.masteryTotal(), 452, 17), 461, 450, 17, C.amber);
    this.footer(g, this.overT >= LOCKOUT ? result ? "TAP: RETRY  ·  CASE: NEXT LINE  ·  HOLD: SETUP" : "TAP / CASE: RIDE AGAIN  ·  HOLD: SETUP" : "LINE SETTLING…");
  }
  drawGuide(g) {
    const page = GUIDE[this.guide], col = this.theme().accent; this.menuHeader(g, page[0], "FIELD GUIDE / " + (this.guide + 1) + " OF " + GUIDE.length); panel(g, 28, 137, 904, 339, col); const y = 216;
    if (this.guide === 0 || this.guide === 3) { line(g, 230, y + 29, 360, y + 60, col, 2); line(g, 360, y + 60, 730, y + 60, col, 2); for (let i = 0; i < 12; i++) circle(g, 355 + i * 23, y + 20 - Math.sin(i / 11 * Math.PI) * 64, 2, C.amber, true); text(g, this.guide === 3 ? "LAND → ROLL 1.2s → BANK" : "PUMP → OLLIE → STRAIGHTEN", 480, y - 51, 20, col, "center"); if (this.guide === 3) gauge(g, 630, y + 14, 125, .7, C.amber); }
    else if (this.guide === 1) { circle(g, 480, y - 28, 7, col, true); circle(g, 480, y - 28, 66, col, false, 1); line(g, 480, y - 28, 523, y + 33, C.ink, 3); line(g, 523, y + 33, 605, y - 13, C.amber, 2); text(g, "CATCH / SWING / TANGENT RELEASE", 480, y + 77, 20, col, "center"); }
    else if (this.guide === 2) for (let i = 0; i < 3; i++) { const x = 190 + i * 290; g.strokeStyle = col; g.lineWidth = 2; g.strokeRect(x - 37, y - 24, 74, 48); for (let j = 0; j < 4; j++) circle(g, x - 24 + j * 16, y - 10, 4, col); circle(g, x + 38, y + 7, 11, C.amber); circle(g, x + 38, y + 7, 18, C.amber, false, 1); text(g, ["SHOVE-IT", "KICKFLIP", "REGRIP"][i], x, y + 57, 20, col, "center"); }
    else if (this.guide === 4) for (let i = 0; i < 3; i++) { const x = 70 + i * 295; panel(g, x, y - 40, 265, 86, col); text(g, MODES[i], x + 133, y - 15, 21, C.ink, "center"); text(g, ["120s / PARK GOALS", "TIMED / ONE TARGET", "UNTIMED / WARMUP"][i], x + 133, y + 17, 15, col, "center"); }
    else for (let i = 0; i < 4; i++) { const x = 195 + i * 190; circle(g, x, y, 26, col, false, 2); circle(g, x, y, 17, i % 2 ? C.amber : col, true); text(g, ["I", "II", "III", "IV"][i], x, y + 49, 20, C.ink, "center"); }
    let yy = 339; for (let i = 1; i < page.length; i++) yy = paragraph(g, page[i], 60, yy, 843, 20, C.ink, 2) + 6; this.footer(g, "TAP: NEXT  ·  CASE: PREVIOUS  ·  HOLD: RIDE / RETURN");
  }
}
