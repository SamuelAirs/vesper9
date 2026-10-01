import { TAU, Random } from "./math.js";
export const C = {
  bg: "#0c1511",
  ink: "#d6efa4",
  muted: "#7f9a78",
  line: "#314938",
  amber: "#e7b879",
  cyan: "#8fcbc5",
  red: "#eb947a",
  dark: "#18271b",
};
export function text(g, value, x, y, size = 22, color = C.ink, align = "left") {
  g.fillStyle = color;
  g.font = `${size}px "DejaVu Sans Mono",monospace`;
  g.textAlign = align;
  g.textBaseline = "middle";
  g.fillText(String(value), x, y);
}
export function line(g, x1, y1, x2, y2, color = C.line, width = 1) {
  g.strokeStyle = color;
  g.lineWidth = width;
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke();
}
export function circle(g, x, y, r, color = C.ink, fill = false, width = 2) {
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.lineWidth = width;
  g[fill ? "fillStyle" : "strokeStyle"] = color;
  g[fill ? "fill" : "stroke"]();
}
export function diamond(g, x, y, r, color = C.ink, fill = false) {
  g.beginPath();
  g.moveTo(x, y - r);
  g.lineTo(x + r, y);
  g.lineTo(x, y + r);
  g.lineTo(x - r, y);
  g.closePath();
  g.lineWidth = 2;
  g[fill ? "fillStyle" : "strokeStyle"] = color;
  g[fill ? "fill" : "stroke"]();
}
const random = new Random(1979);
const stars = Array.from({ length: 100 }, () => [
  random.range(0, 960),
  random.range(0, 540),
  random.range(0.5, 2),
]);
export function space(g, t = 0, density = 1) {
  g.fillStyle = C.bg;
  g.fillRect(0, 0, 960, 540);
  g.fillStyle = C.muted;
  for (let i = 0; i < stars.length * density; i++) {
    const [x, y, s] = stars[i];
    g.globalAlpha = s / 3;
    g.fillRect((x - t * 0.8 + 96000) % 960, y, s, s);
  }
  g.globalAlpha = 1;
}
export function grid(g, step = 60) {
  for (let x = 0; x <= 960; x += step) line(g, x, 0, x, 540, "#233929", 0.6);
  for (let y = 0; y <= 540; y += step) line(g, 0, y, 960, y, "#233929", 0.6);
}
export function banner(g, title, subtitle, color = C.ink) {
  g.fillStyle = "#0c1511e8";
  g.fillRect(140, 170, 680, 185);
  line(g, 195, 178, 765, 178, C.line);
  text(g, title, 480, 226, 42, color, "center");
  text(g, subtitle, 480, 283, 18, C.muted, "center");
  text(g, "PRESS TO BEGIN", 480, 325, 14, C.amber, "center");
}
export function glyph(g, index, x, y, size = 32, color = C.ink) {
  g.save();
  g.translate(x, y);
  g.strokeStyle = color;
  g.lineWidth = 2.5;
  g.beginPath();
  switch (index % 6) {
    case 0:
      g.arc(0, 0, size * 0.7, 0, TAU);
      g.moveTo(-size, 0);
      g.lineTo(size, 0);
      g.moveTo(0, -size);
      g.lineTo(0, size);
      break;
    case 1:
      g.moveTo(0, -size);
      g.lineTo(size * 0.85, size * 0.6);
      g.lineTo(-size * 0.85, size * 0.6);
      g.closePath();
      g.moveTo(-size * 0.5, 0);
      g.lineTo(size * 0.5, 0);
      break;
    case 2:
      g.arc(0, 0, size * 0.8, 0.3, TAU - 0.3);
      g.moveTo(-size * 0.3, -size * 0.4);
      g.lineTo(size * 0.4, 0);
      g.lineTo(-size * 0.3, size * 0.4);
      break;
    case 3:
      g.moveTo(-size, -size * 0.65);
      g.lineTo(size, -size * 0.65);
      g.lineTo(-size, size * 0.65);
      g.lineTo(size, size * 0.65);
      g.moveTo(0, -size);
      g.lineTo(0, size);
      break;
    case 4:
      g.moveTo(-size, -size);
      g.lineTo(0, 0);
      g.lineTo(size, -size);
      g.moveTo(0, 0);
      g.lineTo(0, size);
      g.arc(0, 0, size * 0.65, 0, Math.PI);
      break;
    case 5:
      g.rect(-size * 0.65, -size * 0.65, size * 1.3, size * 1.3);
      g.moveTo(-size, -size);
      g.lineTo(size, size);
      g.moveTo(size, -size);
      g.lineTo(-size, size);
      break;
  }
  g.stroke();
  g.restore();
}
export function ambient(g, t = 0, w = 450, h = 300) {
  g.clearRect(0, 0, w, h);
  g.save();
  g.translate(w * 0.47, h * 0.5);
  const r = Math.min(w, h) * 0.34;
  for (let i = 1; i <= 4; i++) {
    g.save();
    g.rotate(-0.4 + i * 0.15);
    g.scale(1, 0.58 + i * 0.07);
    circle(g, 0, 0, (r * i) / 3.5, C.line, false, 1);
    g.restore();
  }
  line(g, -r * 1.35, 0, r * 1.35, 0, C.line);
  line(g, 0, -r * 1.1, 0, r * 1.1, C.line);
  for (let i = 0; i < 36; i++) {
    const a = (i * TAU) / 36;
    line(
      g,
      Math.cos(a) * r * 1.2,
      Math.sin(a) * r * 1.2,
      Math.cos(a) * r * (i % 3 ? 1.23 : 1.27),
      Math.sin(a) * r * (i % 3 ? 1.23 : 1.27),
      C.line,
    );
  }
  circle(g, 0, 0, r * 0.26, C.ink);
  glyph(g, 4, 0, 0, r * 0.13, C.ink);
  const a = t * 0.04 - 0.8;
  circle(g, Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.64, 7, C.amber, true);
  circle(g, -r * 0.45, r * 0.54, 3, C.cyan, true);
  text(g, "09", -r * 1.28, -r * 0.9, 10, C.muted);
  text(g, "N", -4, -r * 1.35, 9, C.muted);
  g.restore();
}
