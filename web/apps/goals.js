// Goals between runs for Orbit Lock, Ricochet and Light Trial: named feats, a daily order that is the
// same for everyone on the same date, a streak of days, and a rank earned from feats. Each game keeps
// its own list and save; this file only holds the pieces they share, in the pattern Perihelion uses.
import { C, text } from "../engine/draw.js";

export const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
export const hashText = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const ymd = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
// Today's date on the console's clock, as YYYY-MM-DD.
export const dateKey = () => ymd(new Date());
export function dayBefore(key) {
  const [y, m, d] = key.split("-").map(Number);
  return ymd(new Date(y, m - 1, d - 1));
}
// The daily part of a save: { d: day of the last order tried, done: met that day, streak, last: day last met }.
export function cleanDaily(raw) {
  const dl = raw && typeof raw === "object" ? raw : {};
  const day = (v) => (typeof v === "string" ? v.slice(0, 10) : "");
  return { d: day(dl.d), done: dl.done ? 1 : 0, streak: Math.max(0, Math.floor(num(dl.streak))), last: day(dl.last) };
}
// The order for `key` is met: mark the day and extend (or restart) the streak. Returns whether this was new.
export function meetDaily(dl, key) {
  if (dl.d === key && dl.done) return false;
  dl.streak = dl.last && dayBefore(key) === dl.last ? dl.streak + 1 : 1;
  dl.d = key; dl.done = 1; dl.last = key;
  return true;
}
export const dailyDone = (dl, key) => dl.d === key && dl.done === 1;
// The streak still counts today if the last order met was today or yesterday.
export const liveStreak = (dl, key) => (dl.last === key || dl.last === dayBefore(key) ? dl.streak : 0);
// Feat ids from a save, unknown and repeated ones dropped.
export const cleanFeats = (ft, ids) => (Array.isArray(ft) ? ft.filter((id, i) => ids.includes(id) && ft.indexOf(id) === i) : []);

// Feats whose progress has reached the goal and are not yet in `have`. Each feat is
// { id, name, text, n, prog(game), hidden?, hint? }.
export function newlyMet(feats, have, game) {
  return feats.filter((f) => !have.includes(f.id) && f.prog(game) >= f.n).map((f) => f.id);
}
// The visible feat closest to done, as a line for a result screen ("" when none is under way).
export function closestFeat(feats, have, game) {
  let best = null, frac = 0;
  for (const f of feats) {
    if (have.includes(f.id) || f.hidden) continue;
    const k = Math.min(f.prog(game), f.n) / f.n;
    if (k > frac && k < 1) { frac = k; best = f; }
  }
  if (!best) return "";
  const p = Math.floor(Math.min(best.prog(game), best.n) * 10) / 10;
  return "CLOSEST FEAT: " + best.name + "  " + p + " / " + best.n;
}
// A rank earned from the number of feats: [[need, name], ...] in rising order.
export function rankOf(ranks, count) {
  let name = ranks[0][1];
  for (const [need, label] of ranks) if (count >= need) name = label;
  return name;
}
export function nextRank(ranks, count) {
  return ranks.find(([need]) => need > count) || null;
}

// One feat at a time on a title screen, stepping through the list every few seconds, so the
// whole list can be read without any input. Earned feats are bright, hidden ones show their hint.
export function drawFeatTicker(g, feats, have, t, y, period = 3) {
  const i = Math.floor(t / period) % feats.length, f = feats[i], got = have.includes(f.id);
  const name = f.hidden && !got ? "? ? ?" : f.name;
  const about = f.hidden && !got ? f.hint : f.text;
  text(g, (got ? "◆ " : "◇ ") + name + "  " + (i + 1) + "/" + feats.length, 480, y, 18, got ? C.amber : C.muted, "center");
  text(g, about, 480, y + 24, 16, got ? C.ink : C.muted, "center");
}
// A dark panel behind lines of text drawn over the playfield.
export function panel(g, y0, y1) {
  g.fillStyle = "#0c1511e8";
  g.fillRect(140, y0, 680, y1 - y0);
}
