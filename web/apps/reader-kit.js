import { C, text, line } from "../engine/draw.js";
import { clamp } from "../engine/math.js";

// ---------------------------------------------------------------------------------------------
// The one-button reader shared by The Stacks (library.js) and the Encyclopedia (encyclopedia.js):
// monospace layout without measureText, pages remembered by (paragraph, character), and the
// screens they share (the page, the hold menu, row lists and notices).

export const SIZES = [
  { name: "SMALL", px: 22, lh: 31 },
  { name: "MEDIUM", px: 26, lh: 36 },
  { name: "LARGE", px: 30, lh: 41 },
];
export const PACES = [0, 160, 220, 300];   // auto-turn, words per minute; 0 is off
export const AREA = { x: 60, w: 840, top: 74, h: 400 };
export const CHAR_W = 0.602;                // DejaVu Sans Mono advance per pixel of size

export const fit = (value, n) => { const s = String(value ?? ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

// Word wrap at a fixed number of columns: [line, offset of its first character in the paragraph].
export function wrap(body, cols) {
  const out = [];
  let start = 0;
  while (start < body.length) {
    while (body[start] === " ") start++;
    if (start >= body.length) break;
    let end = Math.min(body.length, start + cols);
    if (end < body.length) {
      const space = body.lastIndexOf(" ", end);
      if (space > start) end = space;
    }
    out.push([body.slice(start, end).trimEnd(), start]);
    start = end;
    if (out.length > 4000) break;
  }
  return out;
}

// Lines of one chapter at one text size, cut into pages. Each line is [kind, text, para, char, y].
export function layoutChapter(blocks, sizeIndex) {
  const size = SIZES[sizeIndex] || SIZES[1];
  const cols = Math.max(20, Math.floor(AREA.w / (size.px * CHAR_W)));
  const pages = [];
  let page = [], y = 0;
  const gap = Math.round(size.lh * 0.45);
  const put = (item, height) => {
    if (y + height > AREA.h && page.length) { pages.push(page); page = []; y = 0; }
    item.push(y);
    page.push(item);
    y += height;
  };
  (blocks || []).forEach((block, para) => {
    const kind = block?.[0] || "p", body = String(block?.[1] ?? "");
    const width = kind === "q" ? cols - 3 : cols;
    if (kind === "h" && page.length) y += gap;
    for (const [part, at] of wrap(body, width)) put([kind, part, para, at], size.lh);
    y += kind === "m" ? Math.round(gap / 3) : gap;
  });
  if (page.length) pages.push(page);
  if (!pages.length) pages.push([["m", "(this chapter is empty)", 0, 0, 0]]);
  return pages;
}

// The page whose first line is at or before (para, char).
export function pageAt(pages, para, char) {
  let found = 0;
  for (let i = 0; i < pages.length; i++) {
    const first = pages[i][0];
    if (first[2] < para || (first[2] === para && first[3] <= char)) found = i;
    else break;
  }
  return found;
}

// Seconds an auto-turned page stays up at `pace` words a minute.
export function pageSeconds(page, pace) {
  let words = 0;
  for (const item of page || []) words += item[1].split(" ").length;
  return clamp((Math.max(words, 20) / pace) * 60, 4, 240);
}

// The text of one page.
export function drawLines(g, page, sizeIndex) {
  const size = SIZES[sizeIndex] || SIZES[1];
  for (const [kind, body, , , y] of page || []) {
    const cy = AREA.top + y + size.lh / 2;
    if (kind === "h") text(g, body, 480, cy, size.px, C.amber, "center");
    else if (kind === "m") text(g, body, AREA.x, cy, Math.max(18, size.px - 6), C.muted);
    else if (kind === "q") { line(g, AREA.x + 6, cy - size.lh / 2 + 4, AREA.x + 6, cy + size.lh / 2 - 4, C.cyan, 2); text(g, body, AREA.x + size.px * CHAR_W * 3, cy, size.px, C.ink); }
    else text(g, body, AREA.x, cy, size.px, C.ink);
  }
}

// The hold menu over a dimmed page: a centred panel of labels, the chosen one lit.
export function drawMenuPanel(g, title, labels, cursor) {
  const n = Math.max(1, labels.length), rowH = Math.min(54, Math.floor(380 / n)), h = 70 + n * rowH, top = Math.round((540 - h) / 2);
  g.fillStyle = "#0c1511cc";
  g.fillRect(0, 0, 960, 540);
  g.fillStyle = C.bg;
  g.fillRect(250, top, 460, h);
  g.strokeStyle = C.line;
  g.lineWidth = 2;
  g.strokeRect(250, top, 460, h);
  text(g, title, 480, top + 32, 20, C.muted, "center");
  labels.forEach((label, i) => {
    const y = top + 80 + i * rowH, on = i === cursor;
    if (on) { g.fillStyle = C.ink; g.fillRect(270, y - rowH / 2 + 5, 420, rowH - 10); }
    text(g, label, 480, y, 22, on ? C.bg : C.ink, "center");
  });
}

// A scrolling list of rows ({ label, sub, muted, alert, progress }), five at a time.
export function drawRowList(g, rows, cursor, heading, count, foot) {
  text(g, heading, 60, 34, 18, C.amber);
  if (count) text(g, count, 900, 34, 18, C.muted, "right");
  line(g, 60, 56, 900, 56, C.line, 1);
  const visible = 5, top = clamp(cursor - 2, 0, Math.max(0, rows.length - visible));
  for (let i = top; i < Math.min(rows.length, top + visible); i++) {
    const row = rows[i], y = 74 + (i - top) * 80, on = i === cursor;
    if (on) {
      g.fillStyle = C.dark;
      g.fillRect(52, y, 856, 72);
      g.strokeStyle = C.ink;
      g.lineWidth = 2;
      g.strokeRect(52, y, 856, 72);
    }
    text(g, row.label, 76, y + 24, 24, row.muted ? C.muted : C.ink);
    if (row.sub) text(g, fit(row.sub, 70), 76, y + 52, 18, row.alert ? C.red : C.muted);
    if (row.progress !== undefined) {
      g.fillStyle = C.line;
      g.fillRect(820, y + 50, 72, 4);
      g.fillStyle = C.amber;
      g.fillRect(820, y + 50, 72 * clamp(row.progress, 0, 1), 4);
    }
  }
  if (rows.length > visible) {
    const h = 400 * visible / rows.length, y = 74 + (400 - h) * (top / Math.max(1, rows.length - visible));
    g.fillStyle = C.line;
    g.fillRect(926, y, 4, h);
  }
  if (foot) text(g, foot, 60, 500, 16, C.muted);
}

// A centred message: a title and wrapped paragraphs, with a slow ellipsis while `waiting`.
export function drawNoticePanel(g, notice, t, waiting) {
  const n = notice || { title: "", lines: [] };
  text(g, n.title, 480, 150, 30, n.end ? C.amber : C.ink, "center");
  line(g, 260, 180, 700, 180, C.line, 1);
  let y = 222;
  for (const paragraph of n.lines || []) {
    for (const [part] of wrap(String(paragraph), 58)) {
      if (y > 470) break;
      text(g, part, 480, y, 22, C.muted, "center");
      y += 32;
    }
    y += 12;
  }
  if (waiting) text(g, "· · ·".slice(0, 1 + 2 * (Math.floor(t * 2) % 3)), 480, y + 20, 24, C.amber, "center");
}
