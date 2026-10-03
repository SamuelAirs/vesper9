// What Orbit Lock, Ricochet and Light Trial share around their goals. The daily layer, the streak and
// the feat list belong to the console's logbook (engine/logbook.js, through ctx.today, ctx.daily,
// ctx.dailyMet and ctx.feat); each game only decides when one of its feats is met and, on the days the
// logbook picks it, states an order of its own and says when it is met.
import { C, text } from "../engine/draw.js";

export const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
export const hashText = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const ymd = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
// Today's date on the console's clock, as YYYY-MM-DD.
export const dateKey = () => ymd(new Date());
// Feat ids from a save, unknown and repeated ones dropped.
export const cleanFeats = (ft, ids) => (Array.isArray(ft) ? ft.filter((id, i) => ids.includes(id) && ft.indexOf(id) === i) : []);

// Feats whose progress has reached the goal and are not yet in `have`. Each feat is
// { id, name, text, n, prog(game), hidden? }.
export function newlyMet(feats, have, game) {
  return feats.filter((f) => !have.includes(f.id) && f.prog(game) >= f.n).map((f) => f.id);
}
// Today's order for this game: `order` ({ text, ... }) when the logbook picked the game today and the
// order is not met yet, stated to the logbook so its TODAY line reads it; otherwise null.
export function todayOrder(ctx, order) {
  const pick = ctx.today?.();
  if (!pick || pick.done) return null;
  ctx.daily?.(order.text);
  return order;
}
// Send feats ([[id, name], ...]) to the logbook, which keeps each once.
export function reportFeats(ctx, list) {
  for (const [id, name] of list) ctx.feat?.(id, name);
}
// A dark panel behind lines of text drawn over the playfield.
export function panel(g, y0, y1) {
  g.fillStyle = "#0c1511e8";
  g.fillRect(140, y0, 680, y1 - y0);
}
// One line for a title screen: today's order when the game has one, or that it was met.
export function drawToday(g, ctx, order, y) {
  if (order) text(g, "TODAY: " + order.text, 480, y, 18, C.amber, "center");
  else if (ctx.today?.()?.done) text(g, "TODAY'S ORDER MET", 480, y, 18, C.cyan, "center");
  else return false;
  return true;
}
