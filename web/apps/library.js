import { C, text, line } from "../engine/draw.js";
import { AppGuard } from "../engine/input.js";
import { LAMP, lamps, dim, blend, meter, spot, lightsOff } from "../engine/lightshow.js";
import { clamp } from "../engine/math.js";
import { LampBus, lampMax } from "./game-kit.js";

// ---------------------------------------------------------------------------------------------
// THE STACKS: a book reader for one button. Books are DRM-free EPUB or text files that the service
// keeps in its library folder (vesper/library.py) and hands over one chapter at a time; a short
// guide is built in, so the app also works in the standalone simulator. Tap turns the page, a hold
// opens the reader's own menu; the menu gesture (tap, tap, hold) takes back its two page turns.
// Reading position is saved per book (versioned: see migrateSave).

export const SAVE_VERSION = 1;
const MAX_SAVED_BOOKS = 30;
export const SIZES = [
  { name: "SMALL", px: 22, lh: 31 },
  { name: "MEDIUM", px: 26, lh: 36 },
  { name: "LARGE", px: 30, lh: 41 },
];
export const PACES = [0, 160, 220, 300];   // auto-turn, words per minute; 0 is off
const AREA = { x: 60, w: 840, top: 74, h: 400 };
const CHAR_W = 0.602;                         // DejaVu Sans Mono advance per pixel of size
const CHAPTERS_KEPT = 6;

export function migrateSave(raw) {
  const save = { v: SAVE_VERSION, last: null, size: 1, auto: 0, books: {} };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return save;
  const int = (v, lo, hi, fallback) => (Number.isInteger(v) && v >= lo && v <= hi ? v : fallback);
  save.size = int(raw.size, 0, SIZES.length - 1, 1);
  save.auto = int(raw.auto, 0, PACES.length - 1, 0);
  if (typeof raw.last === "string" && raw.last.length <= 32) save.last = raw.last;
  const books = raw.books && typeof raw.books === "object" ? raw.books : {};
  const kept = Object.entries(books)
    .filter(([id, b]) => id.length <= 32 && b && typeof b === "object")
    .map(([id, b]) => [id, { ch: int(b.ch, 0, 99999, 0), para: int(b.para, 0, 1e9, 0), char: int(b.char, 0, 1e6, 0),
      f: Number.isFinite(b.f) ? clamp(Math.round(b.f * 1000) / 1000, 0, 1) : 0, at: Number.isFinite(b.at) ? Math.round(b.at) : 0 }])
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, MAX_SAVED_BOOKS);
  save.books = Object.fromEntries(kept);
  return save;
}

// Lines of one chapter at one text size, cut into pages. Each line is [kind, text, para, char].
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

const fit = (value, n) => { const s = String(value ?? ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

const GUIDE = { id: "guide", title: "The Reader's Guide", author: "VESPER-9", format: "GUIDE", locked: null, chapters: [
  "Welcome to the Stacks", "Reading with one button", "Adding books", "About Kindle books"] };
const GUIDE_TEXT = [
  [["h", "Welcome to the Stacks"],
    ["p", "This is the console's library. It reads books that belong to you and carry no copy protection: EPUB files, plain text files, and the highlights a Kindle e-reader keeps in its My Clippings file."],
    ["p", "The shelf lists every book in the library folder, with how far you have read. Your place is kept for each book, so you can leave for a game and come back to the same page."],
    ["p", "Turn the page now to learn the controls."]],
  [["h", "Reading with one button"],
    ["p", "Tap the button to turn to the next page. At the end of a chapter the next one follows."],
    ["p", "Press and hold, then let go, to open the reader's menu. While you hold, the lamps fill with cyan; let go once they are full. From the menu you can go back a page, jump to a chapter, change the text size, or set the pages to turn on their own."],
    ["p", "Auto-turn turns each page after the time it takes to read it at the pace you choose: 160, 220 or 300 words a minute. A tap still turns the page at once."],
    ["p", "The three lamps show how far through the chapter you are, as a low amber bar. With auto-turn on, a small cyan light walks across them until the page turns."],
    ["p", "As everywhere on the console, tap, tap and hold opens the system menu. The two taps turn two pages; the library turns them back when the menu opens."]],
  [["h", "Adding books"],
    ["p", "Free classics. Choose GET FREE CLASSICS on the shelf for a list of public-domain books from Project Gutenberg. Hold on a title to fetch it. The console needs its internet connection for this."],
    ["p", "From a USB drive. Put EPUB or text files on a USB stick, plug it into the console, and choose IMPORT FROM USB DRIVE. A Kindle e-reader plugged in by USB works too: its My Clippings file comes over as a book of your highlights and notes."],
    ["p", "By hand. Any EPUB or text file copied into the library folder appears on the shelf. The folder is shown at the foot of the shelf."],
    ["p", "Good sources of free, DRM-free books: Standard Ebooks (carefully produced public-domain editions), Project Gutenberg, and stores that sell without DRM, such as Tor's and Baen's own stores. Download the EPUB on another computer and bring it over on a USB drive."]],
  [["h", "About Kindle books"],
    ["p", "Books bought from the Kindle store are protected by DRM. Amazon offers no way to take their text out to another reader, and since February 2025 it no longer offers the Download & Transfer via USB files at all. This console does not remove DRM, so Kindle purchases stay on the Kindle and in the Kindle app."],
    ["p", "What can come over: your highlights and notes. A Kindle e-reader keeps them in documents/My Clippings.txt. Plug the Kindle in and choose IMPORT FROM USB DRIVE, and they appear as a book called Kindle Highlights, one chapter for each title."],
    ["p", "Books you sent to your Kindle yourself (Send to Kindle) are your own files: copy the original EPUB in instead. Many Kindle books are also public domain classics that you can fetch for free from the shelf."]],
];

// Remote data and caches live in class instances, which the gesture guard neither copies nor rewinds.
class Stacks {
  constructor() {
    this.service = "loading";     // "loading" | "ok" | "offline"
    this.books = [];
    this.shelf = [];
    this.folder = "";
    this.busy = null;
    this.chapters = new Map();     // "book:ch" -> { title, blocks, count }
    this.pending = new Set();
    this.failed = new Map();       // "book:ch" -> message
    GUIDE_TEXT.forEach((blocks, ch) => this.chapters.set("guide:" + ch, { title: GUIDE.chapters[ch], blocks, count: GUIDE_TEXT.length }));
  }
  remember(key, chapter) {
    this.chapters.delete(key);
    this.chapters.set(key, chapter);
    for (const k of this.chapters.keys()) {
      if (this.chapters.size <= CHAPTERS_KEPT + GUIDE_TEXT.length) break;
      if (!k.startsWith("guide:")) this.chapters.delete(k);
    }
  }
}
class Pages {
  constructor() { this.key = ""; this.pages = []; }
}

export class Library {
  constructor(ctx) {
    this.c = ctx;
    this.data = new Stacks();
    this.layout = new Pages();
    this.lamps = new LampBus(ctx);
    this.guard = new AppGuard(this, ctx);
    this.save = migrateSave(ctx.progress?.());
    this.phase = "shelf";
    this.cursor = 0;            // highlighted row on the shelf, store, chapter list or menu
    this.shelfCursor = 0;
    this.book = null;           // id of the open book
    this.pos = { ch: 0, para: 0, char: 0 };
    this.page = 0;
    this.autoT = 0;
    this.notice = null;         // { title, lines, back }
    this.held = false;
    this.pressT = 0;
    this.dirty = false;
    this.savedAt = 0;
    this.t = 0;
    this.lastHud = "";
    this.lastHint = "";
    const last = this.save.last;
    this.refresh(() => {
      // Back on the shelf at the book read last.
      const at = this.rows().findIndex((r) => r.book?.id === last);
      if (at >= 0 && this.phase === "shelf" && this.cursor === 0) this.cursor = this.shelfCursor = at;
    });
  }

  // ---- data from the service ---------------------------------------------------------------
  refresh(then) {
    Promise.resolve()
      .then(() => this.c.get("library"))
      .then((listing) => {
        if (!this.c.alive?.()) return;
        if (!listing || !Array.isArray(listing.books)) { this.data.service = "offline"; return; }
        this.data.service = "ok";
        this.data.books = listing.books.slice(0, 400);
        this.data.shelf = Array.isArray(listing.shelf) ? listing.shelf.slice(0, 40) : [];
        this.data.folder = String(listing.folder || "");
        this.data.busy = listing.busy || null;
        then?.();
      })
      .catch(() => { if (this.c.alive?.()) this.data.service = "offline"; });
  }
  bookMeta(id = this.book) {
    return id === "guide" ? GUIDE : this.data.books.find((b) => b.id === id) || null;
  }
  chapterCount(id = this.book) {
    const meta = this.bookMeta(id);
    return Math.max(1, meta?.chapters?.length || 1);
  }
  want(ch) {
    const key = this.book + ":" + ch, data = this.data;
    if (data.chapters.has(key) || data.pending.has(key) || this.book === "guide" || ch < 0 || ch >= this.chapterCount()) return;
    data.pending.add(key);
    data.failed.delete(key);
    Promise.resolve()
      .then(() => this.c.get("library/" + this.book + "/" + ch))
      .then((chapter) => {
        if (!Array.isArray(chapter?.blocks)) throw new Error("no text");
        data.remember(key, { title: String(chapter.title || ""), blocks: chapter.blocks, count: chapter.count | 0 });
      })
      .catch((error) => data.failed.set(key, String(error?.message || error).slice(0, 80)))
      .finally(() => data.pending.delete(key));
  }
  // The pages of the chapter being read, laid out for the current text size (null while loading).
  pages() {
    const key = this.book + ":" + this.pos.ch, chapter = this.data.chapters.get(key);
    if (!chapter) { this.want(this.pos.ch); return null; }
    const layoutKey = key + ":" + this.save.size;
    if (this.layout.key !== layoutKey) {
      this.layout.key = layoutKey;
      this.layout.pages = layoutChapter(chapter.blocks, this.save.size);
    }
    return this.layout.pages;
  }
  settlePage() {
    const pages = this.pages();
    if (!pages) return null;
    this.page = pageAt(pages, this.pos.para, this.pos.char);
    const first = pages[this.page][0];
    this.pos = { ch: this.pos.ch, para: first[2], char: first[3] };
    return pages;
  }

  // ---- rows of the list screens ------------------------------------------------------------
  rows() {
    const d = this.data;
    if (this.phase === "menu") {
      return [
        { label: "RESUME READING", run: () => this.go("read") },
        { label: "PREVIOUS PAGE", run: () => { this.go("read"); this.turn(-1); } },
        { label: "CHAPTERS", run: () => this.go("chapters", this.pos.ch + 1) },
        { label: "AUTO-TURN · " + (PACES[this.save.auto] ? PACES[this.save.auto] + " WPM" : "OFF"), stay: true,
          run: () => { this.save.auto = (this.save.auto + 1) % PACES.length; this.autoT = 0; this.dirty = true; } },
        { label: "TEXT · " + SIZES[this.save.size].name, stay: true,
          run: () => { this.save.size = (this.save.size + 1) % SIZES.length; this.dirty = true; } },
        { label: "BACK TO THE SHELF", run: () => this.toShelf() },
      ];
    }
    if (this.phase === "chapters") {
      const meta = this.bookMeta(), names = meta?.chapters || [];
      return [{ label: "BACK TO THE PAGE", run: () => this.go("read") },
        ...names.map((name, i) => ({ label: fit(name || "SECTION " + (i + 1), 52), sub: "CHAPTER " + (i + 1) + (i === this.pos.ch ? " · READING" : ""),
          run: () => this.open(this.book, { ch: i, para: 0, char: 0 }) }))];
    }
    if (this.phase === "store") {
      return [{ label: "BACK TO THE SHELF", run: () => this.toShelf() },
        ...d.shelf.map((item) => ({ label: fit(item.title, 52), sub: fit(item.author, 30) + " · " + storeStatus(item.status),
          run: () => this.fetch(item) }))];
    }
    const rows = [GUIDE, ...d.books].map((book) => ({ book, label: fit(book.title, 52), sub: this.shelfLine(book), run: () => this.openBook(book) }));
    if (d.service === "ok") {
      rows.push({ label: "GET FREE CLASSICS", sub: "PUBLIC-DOMAIN BOOKS FROM PROJECT GUTENBERG", run: () => this.go("store", 1) });
      rows.push({ label: "IMPORT FROM USB DRIVE", sub: "EPUB, TEXT AND KINDLE MY CLIPPINGS", run: () => this.importUsb() });
    }
    rows.push({ label: "LEAVE THE LIBRARY", sub: "BACK TO THE DASHBOARD", run: () => this.c.home?.() });
    return rows;
  }
  shelfLine(book) {
    const parts = [];
    if (book.author) parts.push(fit(book.author, 26));
    if (book.locked) parts.push("LOCKED · " + (book.locked === "KINDLE" ? "KINDLE DRM" : book.locked));
    else {
      const read = this.save.books[book.id];
      parts.push(book.format);
      parts.push(read ? (read.f >= 0.995 ? "FINISHED" : Math.max(1, Math.round(read.f * 100)) + "% READ") : "UNREAD");
    }
    return parts.join(" · ");
  }

  // ---- actions -----------------------------------------------------------------------------
  go(phase, cursor = 0) {
    this.phase = phase;
    this.cursor = cursor;
    if (phase === "read") this.autoT = 0;
  }
  toShelf() {
    this.flush();
    this.phase = "shelf";
    this.cursor = this.shelfCursor;
    this.refresh();
  }
  openBook(book) {
    if (book.locked) {
      this.notice = { title: fit(book.title, 40), lines: [book.reason || "This book cannot be opened here."], back: "shelf" };
      this.phase = "notice";
      return;
    }
    const saved = this.save.books[book.id];
    this.open(book.id, saved ? { ch: Math.min(saved.ch, this.chapterCount(book.id) - 1), para: saved.para, char: saved.char } : { ch: 0, para: 0, char: 0 });
  }
  open(id, pos) {
    this.shelfCursor = this.phase === "shelf" ? this.cursor : this.shelfCursor;
    this.book = id;
    this.pos = { ...pos };
    this.page = 0;
    this.save.last = id;
    this.go("read");
    this.settlePage();
    this.markRead();
  }
  turn(dir) {
    const pages = this.pages();
    if (!pages) { this.data.failed.delete(this.book + ":" + this.pos.ch); return; }
    const count = this.chapterCount();
    let target = null;
    if (dir > 0 && this.page + 1 < pages.length) target = { ch: this.pos.ch, ...firstOf(pages[this.page + 1]) };
    else if (dir > 0 && this.pos.ch + 1 < count) target = { ch: this.pos.ch + 1, para: 0, char: 0 };
    else if (dir < 0 && this.page > 0) target = { ch: this.pos.ch, ...firstOf(pages[this.page - 1]) };
    else if (dir < 0 && this.pos.ch > 0) target = { ch: this.pos.ch - 1, para: 1e9, char: 0 };
    if (!target) {
      if (dir > 0) {
        this.notice = { title: "THE END", lines: [fit(this.bookMeta()?.title, 60), "Hold to go back to the shelf, or tap to stay on the last page."], back: "read", end: true };
        this.phase = "notice";
        this.markRead(1);
      }
      return;
    }
    const newChapter = target.ch !== this.pos.ch;
    this.pos = target;
    this.autoT = 0;
    if (this.settlePage() && newChapter) this.c.tone?.(520, 0.05, "sine");
    else this.c.tone?.(dir > 0 ? 1500 : 1100, 0.012, "triangle");
    this.lamps.flash(0.32, (e, total, base) => lampMax(base, spot(dir > 0 ? e / total : 1 - e / total, LAMP.white, 0.6).map((v) => v * 0.25)));
    this.markRead();
  }
  fraction() {
    const pages = this.layout.key.startsWith(this.book + ":" + this.pos.ch + ":") ? this.layout.pages : null;
    const within = pages && pages.length > 1 ? this.page / (pages.length - 1) : 0;
    return clamp((this.pos.ch + within) / this.chapterCount(), 0, 1);
  }
  markRead(f) {
    if (!this.book) return;
    this.save.books[this.book] = { ch: this.pos.ch, para: Math.min(this.pos.para, 1e9), char: this.pos.char,
      f: Math.round((f ?? this.fraction()) * 1000) / 1000, at: Math.round(Date.now() / 1000) };
    this.dirty = true;
  }
  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    this.savedAt = this.t;
    this.save = migrateSave(this.save);
    Promise.resolve(this.c.saveProgress?.(this.save)).catch(() => {});
  }
  fetch(item) {
    if (item.status === "on shelf" || item.status === "done") { this.notice = { title: fit(item.title, 40), lines: ["Already on the shelf."], back: "store" }; this.phase = "notice"; return; }
    if (this.data.busy) { this.notice = { title: "ONE AT A TIME", lines: ["The library is still bringing in another book. Try again in a moment."], back: "store" }; this.phase = "notice"; return; }
    this.data.busy = "fetch";
    item.status = "downloading";
    this.c.tone?.(880, 0.05, "sine");
    Promise.resolve(this.c.command("library_fetch", { item: item.id }))
      .catch((error) => {
        this.data.busy = null;
        item.status = "failed: " + String(error?.message || error).slice(0, 60);
      });
  }
  importUsb() {
    this.notice = { title: "IMPORT FROM USB DRIVE", lines: ["Looking for EPUB and text books, and Kindle clippings, on the drives plugged into the console…"], back: "shelf", wait: true };
    this.phase = "notice";
    this.data.busy = "import";
    Promise.resolve(this.c.command("library_import", {}))
      .catch((error) => {
        this.data.busy = null;
        this.notice = { title: "IMPORT FROM USB DRIVE", lines: ["The import did not start: " + String(error?.message || error).slice(0, 80)], back: "shelf" };
      });
  }

  // ---- input -------------------------------------------------------------------------------
  holdMs() {
    const v = this.c.settings?.()?.holdMs;
    return Number.isFinite(v) ? clamp(v, 450, 1200) : 650;
  }
  down() {
    this.guard.mark();
    this.held = true;
    this.pressT = 0;
  }
  up(event) {
    this.guard.release();
    if (!this.held) return;
    this.held = false;
    const ms = Number.isFinite(event?.durationMs) ? event.durationMs : this.pressT * 1000;
    this.pressT = 0;
    if (ms >= this.holdMs()) this.choose();
    else this.step();
  }
  cancel() {
    this.guard.rewind();
    this.held = false;
    this.pressT = 0;
  }
  step() {
    if (this.phase === "read") { this.turn(1); return; }
    if (this.phase === "notice") {
      if (this.notice?.wait && this.data.busy) return;
      this.phase = this.notice?.back || "shelf";
      if (this.phase === "shelf") this.cursor = this.shelfCursor;
      this.notice = null;
      return;
    }
    const n = this.rows().length;
    this.cursor = n ? (this.cursor + 1) % n : 0;
    if (this.phase === "shelf") this.shelfCursor = this.cursor;
    this.c.tone?.(700, 0.015, "triangle");
  }
  choose() {
    if (this.phase === "read") { this.go("menu", 0); this.c.tone?.(660, 0.04, "sine"); return; }
    if (this.phase === "notice") {
      if (this.notice?.wait && this.data.busy) return;
      if (this.notice?.end) { this.notice = null; this.toShelf(); return; }
      this.step();
      return;
    }
    const row = this.rows()[this.cursor];
    if (!row) return;
    this.c.tone?.(880, 0.04, "sine");
    row.run();
  }
  event(e) {
    if (e?.type !== "library") return;
    this.data.busy = null;
    if (e.op === "import" && this.notice?.wait) {
      this.notice = { title: "IMPORT FROM USB DRIVE", back: "shelf", lines: e.ok
        ? [e.copied ? "Copied " + e.copied + (e.copied === 1 ? " book" : " books") + " to the library." : "Found nothing new. Books must be EPUB or text files on a drive plugged into the console."]
        : ["The import failed: " + String(e.error || "").slice(0, 80)] };
    }
    if (e.op === "fetch" && !e.ok && this.phase === "store") {
      this.notice = { title: "DOWNLOAD FAILED", back: "store", lines: ["The book could not be fetched: " + String(e.error || "").slice(0, 80), "The console needs its internet connection for this."] };
      this.phase = "notice";
    }
    this.refresh();
  }
  pause() { this.guard.settle(); this.flush(); }
  resume() { this.held = false; this.pressT = 0; }
  dispose() {
    this.guard.settle();
    this.flush();
    this.lamps.clear();
    this.lamps.sleep();
    this.c.leds?.(lightsOff());
  }

  // ---- simulation --------------------------------------------------------------------------
  update(dt) {
    this.t += dt;
    this.guard.tick(dt);
    if (this.held) this.pressT += dt;
    if ((this.phase === "read" || this.phase === "menu" || this.phase === "chapters") && this.book && !this.layoutReady()) this.settlePage();
    if (this.phase === "read") {
      const pace = PACES[this.save.auto];
      const pages = this.layoutReady() ? this.layout.pages : null;
      if (pace && pages && !this.held) {
        this.autoT += dt;
        if (this.autoT >= this.pageSeconds(pages[this.page], pace)) this.turn(1);
      }
      if (pages && this.page + 2 >= pages.length) this.want(this.pos.ch + 1);
    }
    if (this.dirty && this.t - this.savedAt > 3) this.flush();
    this.lamps.frame(dt, this.ambient());
    this.status();
  }
  layoutReady() {
    return this.layout.key === this.book + ":" + this.pos.ch + ":" + this.save.size;
  }
  pageSeconds(page, pace) {
    let words = 0;
    for (const item of page || []) words += item[1].split(" ").length;
    return clamp((Math.max(words, 20) / pace) * 60, 4, 240);
  }
  ambient() {
    const hold = this.held ? clamp(this.pressT * 1000 / this.holdMs(), 0, 1) : 0;
    let base;
    if (this.phase === "read" || this.phase === "menu" || this.phase === "chapters") {
      const pages = this.layoutReady() ? this.layout.pages : null;
      const inChapter = pages && pages.length > 1 ? this.page / (pages.length - 1) : 0;
      base = meter(Math.max(0.08, inChapter), dim(LAMP.amber, 0.22));
      const pace = PACES[this.save.auto];
      if (pace && pages && this.phase === "read") base = lampMax(base, spot(clamp(this.autoT / this.pageSeconds(pages[this.page], pace), 0, 1), dim(LAMP.cyan, 0.25)));
    } else {
      const n = Math.max(1, this.rows().length - 1);
      base = this.phase === "notice" ? lamps(null, dim(LAMP.green, 0.12), null) : spot(clamp(this.cursor / n, 0, 1), dim(LAMP.green, 0.2));
    }
    if (hold > 0.1) base = base.map((v, i) => Math.round(v + (dim(LAMP.cyan, 0.3)[i % 3] - v) * hold));
    return base;
  }
  status() {
    const meta = this.bookMeta();
    let hud, hint;
    if (this.phase === "read" && meta) {
      const pages = this.layoutReady() ? this.layout.pages : null;
      hud = [["CHAPTER", (this.pos.ch + 1) + "/" + this.chapterCount()], ["PAGE", pages ? (this.page + 1) + "/" + pages.length : "…"], ["READ", Math.round(this.fraction() * 100) + "%"]];
      hint = "TAP: NEXT PAGE · HOLD & RELEASE: READER MENU";
    } else if (this.phase === "notice") {
      hud = [["BOOKS", String(this.data.books.length + 1)]];
      hint = this.notice?.wait && this.data.busy ? "WORKING…" : "TAP OR HOLD TO GO ON";
    } else {
      hud = [["BOOKS", String(this.data.books.length + 1)]];
      if (this.phase === "store") hud.push(["FETCHING", this.data.busy === "fetch" ? "YES" : "—"]);
      hint = "TAP: NEXT · HOLD & RELEASE: CHOOSE";
    }
    const key = JSON.stringify(hud);
    if (key !== this.lastHud) { this.lastHud = key; this.c.hud?.(hud); }
    if (hint !== this.lastHint) { this.lastHint = hint; this.c.hint?.(hint); }
  }

  // ---- drawing -----------------------------------------------------------------------------
  draw(g) {
    g.save();
    g.fillStyle = C.bg;
    g.fillRect(0, 0, 960, 540);
    if (this.phase === "read" || this.phase === "menu") this.drawPage(g);
    else if (this.phase === "notice") this.drawNotice(g);
    else this.drawList(g);
    if (this.phase === "menu") this.drawMenu(g);
    if (this.held) {
      const hold = clamp(this.pressT * 1000 / this.holdMs(), 0, 1);
      g.fillStyle = hold >= 1 ? C.cyan : C.line;
      g.fillRect(60, 528, 840 * hold, 4);
    }
    g.restore();
  }
  drawPage(g) {
    const meta = this.bookMeta(), size = SIZES[this.save.size];
    const chapter = this.data.chapters.get(this.book + ":" + this.pos.ch);
    const title = chapter?.title || meta?.chapters?.[this.pos.ch] || "SECTION " + (this.pos.ch + 1);
    text(g, fit(title, 50).toUpperCase(), 60, 34, 18, C.muted);
    line(g, 60, 56, 900, 56, C.line, 1);
    const pages = this.layoutReady() ? this.layout.pages : null;
    if (!pages) {
      const failed = this.data.failed.get(this.book + ":" + this.pos.ch);
      text(g, failed ? "THIS CHAPTER COULD NOT BE LOADED" : "RETRIEVING CHAPTER " + (this.pos.ch + 1) + "…", 480, 250, 24, failed ? C.red : C.amber, "center");
      if (failed) text(g, "TAP TO TRY AGAIN · HOLD FOR THE MENU", 480, 290, 18, C.muted, "center");
      return;
    }
    text(g, (this.page + 1) + " / " + pages.length, 900, 34, 18, C.muted, "right");
    for (const [kind, body, , , y] of pages[this.page] || []) {
      const cy = AREA.top + y + size.lh / 2;
      if (kind === "h") text(g, body, 480, cy, size.px, C.amber, "center");
      else if (kind === "m") text(g, body, AREA.x, cy, Math.max(18, size.px - 6), C.muted);
      else if (kind === "q") { line(g, AREA.x + 6, cy - size.lh / 2 + 4, AREA.x + 6, cy + size.lh / 2 - 4, C.cyan, 2); text(g, body, AREA.x + size.px * CHAR_W * 3, cy, size.px, C.ink); }
      else text(g, body, AREA.x, cy, size.px, C.ink);
    }
    line(g, 60, 486, 900, 486, C.line, 1);
    const f = this.fraction();
    g.fillStyle = C.dark;
    g.fillRect(60, 500, 840, 6);
    g.fillStyle = C.amber;
    g.fillRect(60, 500, 840 * f, 6);
    const pace = PACES[this.save.auto];
    text(g, fit(meta?.title, 44).toUpperCase(), 60, 518, 16, C.muted);
    text(g, (pace ? "AUTO " + pace + " WPM · " : "") + Math.round(f * 100) + "%", 900, 518, 16, pace ? C.cyan : C.muted, "right");
    if (pace && this.phase === "read") {
      g.fillStyle = C.cyan;
      g.fillRect(60, 57, 840 * clamp(this.autoT / this.pageSeconds(pages[this.page], pace), 0, 1), 2);
    }
  }
  drawMenu(g) {
    const rows = this.rows();
    g.fillStyle = "#0c1511cc";
    g.fillRect(0, 0, 960, 540);
    g.fillStyle = C.bg;
    g.fillRect(250, 90, 460, 70 + rows.length * 54);
    g.strokeStyle = C.line;
    g.lineWidth = 2;
    g.strokeRect(250, 90, 460, 70 + rows.length * 54);
    text(g, "READER", 480, 122, 20, C.muted, "center");
    rows.forEach((row, i) => {
      const y = 170 + i * 54, on = i === this.cursor;
      if (on) { g.fillStyle = C.ink; g.fillRect(270, y - 22, 420, 44); }
      text(g, row.label, 480, y, 22, on ? C.bg : C.ink, "center");
    });
  }
  drawList(g) {
    const rows = this.rows(), d = this.data;
    const heading = this.phase === "store" ? "FREE CLASSICS · PROJECT GUTENBERG" : this.phase === "chapters" ? fit(this.bookMeta()?.title, 44).toUpperCase() : "THE STACKS";
    text(g, heading, 60, 34, 18, C.amber);
    const count = this.phase === "shelf" ? (d.books.length + 1) + " VOLUMES" : this.phase === "chapters" ? this.chapterCount() + " CHAPTERS" : rows.length - 1 + " TITLES";
    text(g, count, 900, 34, 18, C.muted, "right");
    line(g, 60, 56, 900, 56, C.line, 1);
    const visible = 5, top = clamp(this.cursor - 2, 0, Math.max(0, rows.length - visible));
    for (let i = top; i < Math.min(rows.length, top + visible); i++) {
      const row = rows[i], y = 74 + (i - top) * 80, on = i === this.cursor;
      if (on) {
        g.fillStyle = C.dark;
        g.fillRect(52, y, 856, 72);
        g.strokeStyle = C.ink;
        g.lineWidth = 2;
        g.strokeRect(52, y, 856, 72);
      }
      const locked = row.book?.locked;
      text(g, row.label, 76, y + 24, 24, locked ? C.muted : on ? C.ink : C.ink);
      if (row.sub) text(g, fit(row.sub, 70), 76, y + 52, 18, locked ? C.red : C.muted);
      if (row.book && !locked) {
        const read = this.save.books[row.book.id]?.f || 0;
        g.fillStyle = C.line;
        g.fillRect(820, y + 50, 72, 4);
        g.fillStyle = C.amber;
        g.fillRect(820, y + 50, 72 * read, 4);
      }
    }
    if (rows.length > visible) {
      const h = 400 * visible / rows.length, y = 74 + (400 - h) * (top / Math.max(1, rows.length - visible));
      g.fillStyle = C.line;
      g.fillRect(926, y, 4, h);
    }
    let foot = "";
    if (this.phase === "shelf") foot = d.service === "offline" ? "BOOK SERVICE OFFLINE · ONLY THE GUIDE IS HERE" : d.service === "loading" ? "OPENING THE STACKS…" : "FOLDER · " + fit(d.folder, 60);
    if (this.phase === "store") foot = "FETCHING NEEDS THE CONSOLE'S INTERNET CONNECTION";
    if (foot) text(g, foot, 60, 500, 16, C.muted);
  }
  drawNotice(g) {
    const n = this.notice || { title: "", lines: [] };
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
    if (n.wait && this.data.busy) text(g, "· · ·".slice(0, 1 + 2 * (Math.floor(this.t * 2) % 3)), 480, y + 20, 24, C.amber, "center");
  }
}

function firstOf(page) { return { para: page[0][2], char: page[0][3] }; }
function storeStatus(status) {
  if (!status) return "HOLD TO FETCH";
  if (status === "done" || status === "on shelf") return "ON THE SHELF";
  if (status === "downloading") return "FETCHING…";
  return "FAILED · HOLD TO RETRY";
}
