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
