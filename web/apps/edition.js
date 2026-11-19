// The console's edition: what kind of thing the page is running on. The Pi console and the
// browser simulator are given none, and with none every function here answers as the console
// always has. The iPhone app's layer (ios/layer/15-edition.js) gives the page, before any of the
// console's code runs:
//
//   window.VESPER_EDITION = {
//     name: "handheld",            // the console's words for a handheld: handheld() is true
//     hide: ["app id", ...],       // on no sector's page, in no system-tools list, never a pick of
//                                  // the day; still launchable by id
//     add: [{ sector: "NAME", apps: ["app id", ...], tagline: "..." }],
//                                  // put apps on a sector's page, after its own; a name the
//                                  // catalog has no sector for adds one at the end
//     microphone: false,           // no MICROPHONE line in the system menu, no voice pages
//   }
//
// Words: an app's catalog entry may carry "handheld": { subtitle, description, controls }, used in
// place of its own (registry.js); a string in code is words(console's, handheld's).

const ID = /^[a-z][a-z0-9_-]{0,31}$/;
const CONSOLE = Object.freeze({ name: "console", handheld: false, hide: new Set(), add: [], microphone: true });

function clean(given) {
  if (!given || typeof given !== "object") return CONSOLE;
  const ids = (list) => (Array.isArray(list) ? list.filter((id) => typeof id === "string" && ID.test(id)) : []);
  const add = (Array.isArray(given.add) ? given.add : [])
    .filter((entry) => entry && typeof entry.sector === "string" && entry.sector.trim())
    .map((entry) => ({ sector: entry.sector.trim().toUpperCase(), apps: ids(entry.apps), tagline: typeof entry.tagline === "string" ? entry.tagline : "" }));
  return {
    name: typeof given.name === "string" ? given.name : "console",
    handheld: given.name === "handheld",
    hide: new Set(ids(given.hide)),
    add,
    microphone: given.microphone !== false,
  };
}

// Read when asked, so a test can set it; the cleaned copy is kept while the object is the same.
let seen, made = CONSOLE;
export function edition() {
  const given = globalThis.VESPER_EDITION;
  if (given !== seen) { seen = given; made = clean(given); }
  return made;
}
export const handheld = () => edition().handheld;
export const shown = (id) => !edition().hide.has(id);
// The console's words, or the handheld's on a handheld.
export const words = (onConsole, onHandheld) => (handheld() ? onHandheld : onConsole);

// The dashboard's pages: the catalog's sectors, each a named list of apps in order, without the
// hidden ones and with the edition's additions; a sector left with no app is not shown. With no
// edition this is exactly the catalog's sectors.
export function dashboardPages(sectors, apps) {
  const e = edition(), byId = (id) => apps.find((a) => a.id === id);
  const pages = sectors.map((sector) => ({ name: sector.name, tagline: sector.tagline || "", apps: sector.apps.map(byId).filter(Boolean) }));
  const placed = new Set(pages.flatMap((page) => page.apps.map((a) => a.id)));
  for (const entry of e.add) {
    let page = pages.find((p) => p.name === entry.sector);
    if (!page) pages.push((page = { name: entry.sector, tagline: entry.tagline, apps: [] }));
    for (const id of entry.apps) {
      const app = byId(id);
      if (app && !placed.has(id)) { page.apps.push(app); placed.add(id); }
    }
  }
  return pages.map((page) => ({ ...page, apps: page.apps.filter((a) => shown(a.id)) })).filter((page) => page.apps.length);
}
