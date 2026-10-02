// The console's logbook: one daily layer and one feat list for every game, kept by the host
// instead of by each game (the platform review, 2026-10-02: 12 of 14 games carried their own daily
// order, feat list and rank). Saved as the progress of the reserved app id "console".
//
// TODAY'S THREE: each date picks three games from the dashboard's game sectors, the same for the
// whole day. Each pick carries an order. A game may state its own (ctx.daily), and say when it is met
// (ctx.dailyMet); otherwise the order is generic and the host judges it from ctx.score: reach 60 %
// of your best, or finish a run when there is no best yet. A day with at least one order met keeps
// the streak; meeting all three is a full day.
// FEATS: a game reports a feat once (ctx.feat); the logbook keeps the latest MAX_FEATS, by game.
export const LOGBOOK_VERSION = 1;
export const PICKS = 3, MAX_FEATS = 60, MAX_DAYS = 45, TARGET_SHARE = 0.6;

const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
const num = (v) => (Number.isFinite(v) ? v : 0);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ymd = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
export const dateKey = (d = new Date()) => ymd(d);
export function dayBefore(key) {
  const [y, m, d] = key.split("-").map(Number);
  return ymd(new Date(y, m - 1, d - 1));
}
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

// A logbook from whatever was saved (nothing, an older or damaged record): always version 1, valid.
export function cleanLogbook(raw) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const day = DAY.test(r.day) ? r.day : "";
  const picks = day && Array.isArray(r.picks) ? r.picks.slice(0, PICKS).filter((p) => p && typeof p.a === "string" && p.a).map((p) => ({
    a: str(p.a, 40), goal: str(p.goal, 80), target: Math.max(0, num(p.target)), own: p.own ? 1 : 0, done: p.done ? 1 : 0,
  })) : [];
  const met = {};
  if (r.met && typeof r.met === "object")
    for (const [k, v] of Object.entries(r.met).sort().slice(-MAX_DAYS)) if (DAY.test(k) && num(v) > 0) met[k] = Math.min(PICKS, Math.floor(num(v)));
  const seen = new Set(), feats = [];
  for (const f of Array.isArray(r.feats) ? r.feats : []) {
    if (!f || typeof f.a !== "string" || typeof f.i !== "string") continue;
    const key = f.a + "/" + f.i;
    if (seen.has(key)) continue;
    seen.add(key);
    feats.push({ a: str(f.a, 40), i: str(f.i, 40), n: str(f.n, 40) || str(f.i, 40), d: DAY.test(f.d) ? f.d : "" });
  }
  return { v: LOGBOOK_VERSION, day, picks, met, feats: feats.slice(-MAX_FEATS) };
}

// The three games for `key`, from `games` (ids in dashboard order). Stable for the date; never repeats.
export function pickToday(key, games) {
  const pool = games.slice(), out = [];
  let h = hash("today/" + key);
  while (out.length < PICKS && pool.length) {
    h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
    out.push(pool.splice(h % pool.length, 1)[0]);
  }
  return out;
}
const genericGoal = (best) => (best > 0 ? { goal: "Score " + Math.ceil(best * TARGET_SHARE) + " or more", target: Math.ceil(best * TARGET_SHARE) } : { goal: "Finish a run", target: 0 });

// Start the day if it has turned: today's picks with generic orders from each game's best (`bestOf`).
// Returns whether anything changed.
export function ensureDay(book, key, games, bestOf = () => 0) {
  if (book.day === key && book.picks.length) return false;
  book.day = key;
  book.picks = pickToday(key, games).map((a) => ({ a, ...genericGoal(num(bestOf(a))), own: 0, done: 0 }));
  return true;
}
export const pickOf = (book, app) => book.picks.find((p) => p.a === app) || null;
// A game states its own order for today (its daily run, a seeded challenge). Kept unless already met.
export function ownOrder(book, app, goal) {
  const p = pickOf(book, app), text = str(goal, 80);
  if (!p || p.done || !text || (p.own && p.goal === text)) return false;
  p.goal = text; p.own = 1;
  return true;
}
function meet(book, p) {
  if (!p || p.done) return false;
  p.done = 1;
  book.met[book.day] = book.picks.filter((x) => x.done).length;
  const keys = Object.keys(book.met).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_DAYS))) delete book.met[k];
  return true;
}
// The game says today's order is met.
export const meetOrder = (book, app) => meet(book, pickOf(book, app));
// A score arrived: it meets a generic order that it reaches. Own orders are met only by the game.
export function noteScore(book, app, score, metric = "default") {
  const p = pickOf(book, app);
  if (!p || p.done || p.own || !Number.isFinite(score) || score <= 0) return false;
  if (p.target > 0 && (metric !== "default" || score < p.target)) return false;
  return meet(book, p);
}
// A feat, once per game and id. Returns whether it is new.
export function addFeat(book, app, id, name, key) {
  const i = str(String(id ?? ""), 40);
  if (!i || book.feats.some((f) => f.a === app && f.i === i)) return false;
  book.feats.push({ a: str(app, 40), i, n: str(String(name || i), 40), d: key });
  if (book.feats.length > MAX_FEATS) book.feats.splice(0, book.feats.length - MAX_FEATS);
  return true;
}
// Days in a row, ending today or yesterday, with at least one order met.
export function streak(book, key) {
  let day = book.met[key] ? key : dayBefore(key), n = 0;
  while (book.met[day]) { n++; day = dayBefore(day); }
  return n;
}
export const doneCount = (book) => book.picks.filter((p) => p.done).length;
