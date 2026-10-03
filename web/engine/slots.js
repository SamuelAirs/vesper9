// Save slots: up to SLOT_COUNT saves for a game that opts in (saveSlots = true on the app). The game
// still reads ctx.progress() and writes ctx.saveProgress(value); the host points both at the active
// slot. Slot 1 is the save every game already had (progress of the app's own id), so nothing is moved
// or rewritten; slots 2..SLOT_COUNT are progress of "<id>#<n>". Which slot is active per game, and when
// each slot was last saved, with the label a game may pass (ctx.saveProgress(value, { label })), is the
// progress of the reserved id "slots" (version 1, cleaned on load). No game's save format changes.
// High scores and the console logbook belong to the console, not to a slot.
export const SLOTS_VERSION = 1;
export const SLOT_COUNT = 4;
export const SLOTS_ID = "slots";
export const LABEL_MAX = 24;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const KEY = /^[a-z0-9_-]{1,40}(#[2-4])?$/;
const valid = (n) => Number.isInteger(n) && n >= 1 && n <= SLOT_COUNT;

// The progress id a slot is saved under.
export const slotKey = (app, n = 1) => (valid(n) && n > 1 ? app + "#" + n : app);

export function cleanSlots(raw) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const active = {}, at = {}, label = {};
  if (r.active && typeof r.active === "object")
    for (const [app, n] of Object.entries(r.active)) if (KEY.test(app) && !app.includes("#") && valid(n) && n > 1) active[app] = n;
  if (r.at && typeof r.at === "object")
    for (const [key, day] of Object.entries(r.at)) if (KEY.test(key) && DAY.test(day)) at[key] = day;
  if (r.label && typeof r.label === "object")
    for (const [key, text] of Object.entries(r.label)) if (KEY.test(key) && typeof text === "string" && text.trim()) label[key] = text.trim().slice(0, LABEL_MAX);
  return { v: SLOTS_VERSION, active, at, label };
}
export const activeSlot = (book, app) => (valid(book.active[app]) ? book.active[app] : 1);
export function setActive(book, app, n) {
  if (!valid(n) || activeSlot(book, app) === n) return false;
  if (n === 1) delete book.active[app]; else book.active[app] = n;
  return true;
}
// A save is "empty" when nothing was ever written to it, or it was cleared ({}).
export const isEmpty = (value) => !value || typeof value !== "object" || Object.keys(value).length === 0;
// A save landed in slot n today, with the game's label for it (undefined keeps the last one).
// Returns whether the record changed.
export function noteSaved(book, app, n, day, label) {
  const key = slotKey(app, n);
  let changed = false;
  if (book.at[key] !== day) { book.at[key] = day; changed = true; }
  const text = typeof label === "string" ? label.trim().slice(0, LABEL_MAX) : undefined;
  if (text !== undefined && (book.label[key] || "") !== text) {
    if (text) book.label[key] = text; else delete book.label[key];
    changed = true;
  }
  return changed;
}
// The first empty slot, or 0 when all are used.
export const firstEmpty = (app, progress) => {
  for (let n = 1; n <= SLOT_COUNT; n++) if (isEmpty(progress?.[slotKey(app, n)])) return n;
  return 0;
};
export function forget(book, app, n) {
  const key = slotKey(app, n);
  if (!(key in book.at) && !(key in book.label)) return false;
  delete book.at[key]; delete book.label[key];
  return true;
}
// One line for a slot's row: the label the game saved with, else its slotSummary(value), else its runs;
// then the last save date.
export function describeSlot(value, day, summary, label = "") {
  if (isEmpty(value)) return "EMPTY · NEW SAVE";
  let text = label || "";
  if (!text) try { text = typeof summary === "function" ? String(summary(value) ?? "") : ""; } catch { text = ""; }
  text = text.slice(0, 32).toUpperCase();
  if (!text) text = Number.isFinite(value.runs) && value.runs > 0 ? value.runs + (value.runs === 1 ? " RUN" : " RUNS") : "SAVED";
  return day ? text + " · " + day : text;
}
