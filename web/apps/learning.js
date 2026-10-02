// ---------------------------------------------------------------------------------------------
// Spaced practice shared by the two learning games (Echo Vault and Glyph Archive).
//
// Every item a player learns (a Morse letter, a Braille cell, an element symbol) keeps a small
// record [strength, due, hits, misses]. Strength runs 0 to 5. It rises by one at most once per
// session, and only when the item is answered from memory (no hint shown) while it is due or still
// weak, so mastery needs practice spread over several sessions rather than one long sitting. A
// miss drops it one step and makes it due again at once. A stronger item waits longer before it is
// due: SPACING[strength] sessions. Records are arrays so a whole deck stays well under the 8 KiB
// that app progress may use.
export const SPACING = [0, 1, 2, 4, 7, 12];
export const MASTERED = 5;

export const validRecord = (raw) => Array.isArray(raw) && raw.length === 4 && raw.every((v) => Number.isFinite(v));
export function record(table, key) {
  return validRecord(table[key]) ? table[key] : (table[key] = [0, 0, 0, 0]);
}
// A correct answer from memory. `raised` remembers what already rose this session. Returns whether
// the strength rose.
export function credit(table, key, session, raised) {
  const r = record(table, key);
  r[2] = Math.min(9999, r[2] + 1);
  if (raised[key] || r[0] >= MASTERED || (r[1] > session && r[0] >= 2)) return false;
  r[0] += 1;
  r[1] = session + SPACING[r[0]];
  raised[key] = true;
  return true;
}
// A correct answer that needed the hint: counted, but it does not strengthen anything.
export function assisted(table, key) {
  const r = record(table, key);
  r[2] = Math.min(9999, r[2] + 1);
}
// A miss. It always counts; the strength drops one step at most once per session (`dropped`), so a
// bad moment costs a step, not everything. A later answer from memory in the same session may still
// earn the session's one step back.
export function fault(table, key, session, raised, dropped) {
  const r = record(table, key);
  r[3] = Math.min(9999, r[3] + 1);
  if (dropped[key]) return false;
  dropped[key] = true;
  r[0] = Math.max(0, r[0] - 1);
  r[1] = session;
  return true;
}
// How much an item wants practice now: weak, due and never-seen items come up more often.
export function need(table, key, session) {
  const r = table[key];
  if (!Array.isArray(r)) return 4;
  return 1 + (r[0] < 2 ? 2 : 0) + (r[1] <= session ? 2 : 0) + (r[2] + r[3] === 0 ? 2 : 0);
}
export const strength = (table, key) => (Array.isArray(table[key]) ? table[key][0] : 0);

// Pick one of `items` with probability proportional to weight(item), using the game's seeded rng.
export function weightedPick(rng, items, weight) {
  if (!items.length) return undefined;
  let total = 0;
  const w = items.map((item) => { const v = Math.max(0, Number(weight(item)) || 0); total += v; return v; });
  if (total <= 0) return items[rng.int(0, items.length - 1)];
  let x = rng.next() * total;
  for (let i = 0; i < items.length; i++) { x -= w[i]; if (x < 0) return items[i]; }
  return items[items.length - 1];
}

// Days practised: a streak of consecutive local days, and the total. `today` is "YYYY-MM-DD".
export function localDay(now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
export function practiseDay(days, today) {
  const out = { last: typeof days?.last === "string" ? days.last : "", streak: Math.max(0, days?.streak | 0), total: Math.max(0, days?.total | 0) };
  if (out.last === today) return out;
  const gap = out.last ? Math.round((Date.parse(today) - Date.parse(out.last)) / 86400000) : NaN;
  out.streak = gap === 1 ? out.streak + 1 : 1;
  out.total += 1;
  out.last = today;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Long-term goals shared by both games: a rank from experience, one contract a day, and feats.
// A rank table is [[xp needed, name], ...] in rising order.
export function rankOf(xp, ranks) {
  let i = 0;
  while (i + 1 < ranks.length && xp >= ranks[i + 1][0]) i++;
  const at = ranks[i][0], next = ranks[i + 1]?.[0];
  return { index: i, name: ranks[i][1], at, next, fraction: next ? Math.min(1, (xp - at) / (next - at)) : 1 };
}
// A stable small number from a day ("YYYY-MM-DD"), so the day's contract is the same all day.
export function dayIndex(day, n) {
  let h = 2166136261;
  for (const ch of String(day)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return n > 0 ? (h >>> 0) % n : 0;
}
// Today's contract: kept while it is still today, otherwise a fresh one.
export function dailyFor(daily, today, count) {
  return daily && daily.day === today && Number.isInteger(daily.id) && daily.id >= 0 && daily.id < count
    ? { day: today, id: daily.id, done: !!daily.done } : { day: today, id: dayIndex(today, count), done: false };
}
// Feats are kept as a list of ids; returns the names of those newly earned.
export function award(feats, list, check) {
  const got = [];
  for (const f of list) if (!feats.includes(f.id) && check(f.id)) { feats.push(f.id); got.push(f.name); }
  return got;
}

// ---------------------------------------------------------------------------------------------
// Settling a session as a whole. Both games count each item's answers during a session (`tally`) and
// change strengths once, when it ends (`settle`), from how that session went for the item: mostly right
// from memory and it rises (straight to 2 for a weak item answered from memory four or more times, so a good
// first session already opens the next letters); mostly wrong and it drops a step; anything between leaves it
// due again soon. One slip among many good answers no longer cancels the step.
// `how` is "clean" (from memory), "helped" (the hint was showing) or "miss".
export function tally(table, tallies, key, how) {
  const r = record(table, key), t = tallies[key] || (tallies[key] = [0, 0, 0]);
  if (how === "miss") { r[3] = Math.min(9999, r[3] + 1); t[2]++; }
  else { r[2] = Math.min(9999, r[2] + 1); t[how === "clean" ? 0 : 1]++; }
}
export const RISE_AT = 0.75;
export function settle(table, tallies, session) {
  const gained = [], revisit = [];
  for (const [key, t] of Object.entries(tallies)) {
    const [clean, helped, miss] = t, total = clean + helped + miss;
    if (!total) continue;
    const r = record(table, key), right = (clean + helped) / total;
    if (clean >= 1 && right >= RISE_AT && r[0] < MASTERED && (r[1] <= session || r[0] < 2)) {
      r[0] = r[0] < 2 && clean >= 4 ? 2 : r[0] + 1;
      r[1] = session + SPACING[r[0]];
      gained.push(key);
      continue;
    }
    if (!miss) continue;
    revisit.push(key);
    if (right < 0.5 && miss >= 2) r[0] = Math.max(0, r[0] - 1);
    r[1] = Math.min(r[1], session + 1);
  }
  return { gained, revisit };
}
