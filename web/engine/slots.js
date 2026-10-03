// Save slots: up to SLOT_COUNT saves for a game that opts in (saveSlots = true on the app). The game
// still reads ctx.progress() and writes ctx.saveProgress(value); the host points both at the active
// slot. Slot 1 is the save every game already had (progress of the app's own id), so nothing is moved
// or rewritten; slots 2..SLOT_COUNT are progress of "<id>#<n>". Which slot is active per game, and when
// each slot was last saved, is the progress of the reserved id "slots" (version 1, cleaned on load).
// High scores and the console logbook belong to the console, not to a slot.
export const SLOTS_VERSION = 1;
export const SLOT_COUNT = 4;
export const SLOTS_ID = "slots";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const KEY = /^[a-z0-9_-]{1,40}(#[2-9])?$/;
const valid = (n) => Number.isInteger(n) && n >= 1 && n <= SLOT_COUNT;

// The progress id a slot is saved under.
export const slotKey = (app, n = 1) => (valid(n) && n > 1 ? app + "#" + n : app);

export function cleanSlots(raw) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const active = {}, at = {};
  if (r.active && typeof r.active === "object")
    for (const [app, n] of Object.entries(r.active)) if (KEY.test(app) && !app.includes("#") && valid(n) && n > 1) active[app] = n;
  if (r.at && typeof r.at === "object")
    for (const [key, day] of Object.entries(r.at)) if (KEY.test(key) && DAY.test(day)) at[key] = day;
  return { v: SLOTS_VERSION, active, at };
}
export const activeSlot = (book, app) => (valid(book.active[app]) ? book.active[app] : 1);
export function setActive(book, app, n) {
  if (!valid(n) || activeSlot(book, app) === n) return false;
  if (n === 1) delete book.active[app]; else book.active[app] = n;
  return true;
}
// A save is "empty" when nothing was ever written to it, or it was cleared ({}).
export const isEmpty = (value) => !value || typeof value !== "object" || Object.keys(value).length === 0;
export function noteSaved(book, app, n, day) {
  const key = slotKey(app, n);
  if (book.at[key] === day) return false;
  book.at[key] = day;
  return true;
}
export function forget(book, app, n) {
  const key = slotKey(app, n);
  if (!(key in book.at)) return false;
  delete book.at[key];
  return true;
}
// One line for a slot's row: the app's own summary when it gives one, else its runs, and the save date.
export function describeSlot(value, day, summary) {
  if (isEmpty(value)) return "EMPTY · NEW SAVE";
  let text = "";
  try { text = typeof summary === "function" ? String(summary(value) ?? "") : ""; } catch { text = ""; }
  text = text.slice(0, 32).toUpperCase();
  if (!text) text = Number.isFinite(value.runs) && value.runs > 0 ? value.runs + (value.runs === 1 ? " RUN" : " RUNS") : "SAVED";
  return day ? text + " · " + day : text;
}
