import { C, text, line } from "../engine/draw.js";
import { AppGuard } from "../engine/input.js";
import { LAMP, lamps, dim, meter, spot, lightsOff } from "../engine/lightshow.js";
import { clamp } from "../engine/math.js";
import { LampBus, lampMax } from "./game-kit.js";
import { SIZES, PACES, fit, layoutChapter, pageAt, pageSeconds, drawLines, drawMenuPanel, drawRowList, drawNoticePanel } from "./reader-kit.js";

// ---------------------------------------------------------------------------------------------
// ENCYCLOPEDIA: an offline Wikipedia (a Kiwix ZIM file the service reads, vesper/encyclopedia.py),
// read with one button like The Stacks. Start from the article of the day, today's date, a random
// article or the front page; at the end of an article, or from the hold menu, pick a link and go
// deeper; BACK climbs out again. The lamps: a low amber bar through the article and a cyan light
// that moves right the deeper the trail of links goes. Saved (versioned, see migrateWiki): text
// size, auto-turn, where you were and the articles read lately.

export const WIKI_VERSION = 1;
const MAX_RECENT = 20;
const MAX_TRAIL = 30;
const KEPT = 6;

const okPath = (p) => typeof p === "string" && p.length > 0 && p.length <= 512;
export function migrateWiki(raw) {
  const save = { v: WIKI_VERSION, size: 1, auto: 0, last: null, recent: [] };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return save;
  const int = (v, lo, hi, fallback) => (Number.isInteger(v) && v >= lo && v <= hi ? v : fallback);
  save.size = int(raw.size, 0, SIZES.length - 1, 1);
  save.auto = int(raw.auto, 0, PACES.length - 1, 0);
  const place = (p) => (p && okPath(p.path) ? { path: p.path, title: fit(String(p.title || p.path), 80), para: int(p.para, 0, 1e6, 0), char: int(p.char, 0, 1e6, 0) } : null);
  save.last = place(raw.last);
  const seen = new Set();
  save.recent = (Array.isArray(raw.recent) ? raw.recent : [])
    .filter((r) => r && okPath(r.path) && !seen.has(r.path) && seen.add(r.path))
    .slice(0, MAX_RECENT)
    .map((r) => ({ path: r.path, title: fit(String(r.title || r.path), 80), f: Number.isFinite(r.f) ? clamp(Math.round(r.f * 100) / 100, 0, 1) : 0 }));
  return save;
}

// Remote data and caches: class instances, which the gesture guard neither copies nor rewinds.
class Shelves {
  constructor() {
    this.status = { status: "loading" };
    this.articles = new Map();   // path -> { path, title, blocks, links, sections }
    this.pending = new Set();
    this.failed = new Map();
  }
  remember(path, article) {
    this.articles.delete(path);
    this.articles.set(path, article);
    while (this.articles.size > KEPT) this.articles.delete(this.articles.keys().next().value);
  }
}
class Pages { constructor() { this.key = ""; this.pages = []; } }

export class Encyclopedia {
  constructor(ctx) {
    this.c = ctx;
    this.data = new Shelves();
    this.layout = new Pages();
    this.lamps = new LampBus(ctx);
    this.guard = new AppGuard(this, ctx);
    this.save = migrateWiki(ctx.progress?.());
    this.phase = "home";
    this.cursor = 0;
    this.article = null;          // { path, title } being read
    this.pos = { para: 0, char: 0 };
    this.page = 0;
    this.trail = [];              // where BACK goes: [{ path, title, para, char }]
    this.notice = null;
    this.autoT = 0;
    this.held = false;
    this.pressT = 0;
    this.dirty = false;
    this.savedAt = 0;
    this.t = 0;
    this.lastHud = "";
    this.lastHint = "";
    this.loadStatus();
  }

  // ---- the service --------------------------------------------------------------------------
  loadStatus() {
    Promise.resolve()
      .then(() => this.c.get("encyclopedia"))
      .then((status) => {
        if (!this.c.alive?.()) return;
        this.data.status = status && typeof status.status === "string" ? status : { status: "offline" };
      })
      .catch(() => { if (this.c.alive?.()) this.data.status = { status: "offline" }; });
  }
  ready() { return this.data.status.status === "ready"; }
  want(path) {
    const d = this.data;
    if (!okPath(path) || d.articles.has(path) || d.pending.has(path) || d.failed.has(path)) return;   // a tap clears a failure to try again
    d.pending.add(path);
    Promise.resolve()
      .then(() => this.c.get("encyclopedia/article?path=" + encodeURIComponent(path)))
      .then((a) => {
        if (!Array.isArray(a?.blocks)) throw new Error("no text");
        const links = (Array.isArray(a.links) ? a.links : []).filter((l) => Array.isArray(l) && okPath(l[1])).slice(0, 300);
        const sections = (Array.isArray(a.sections) ? a.sections : []).filter((s) => Array.isArray(s) && Number.isInteger(s[1])).slice(0, 120);
        d.remember(path, { path, title: String(a.title || path), blocks: a.blocks, links, sections });
      })
      .catch((error) => d.failed.set(path, String(error?.message || error).slice(0, 80)))
      .finally(() => d.pending.delete(path));
  }
  current() { return this.article ? this.data.articles.get(this.article.path) || null : null; }
  pages() {
    const a = this.current();
    if (!a) { if (this.article) this.want(this.article.path); return null; }
    if (this.article.title !== a.title) { this.article.title = a.title; this.markRead(); }   // "Front page" becomes its real name
    const key = a.path + ":" + this.save.size;
    if (this.layout.key !== key) { this.layout.key = key; this.layout.pages = layoutChapter(a.blocks, this.save.size); }
    return this.layout.pages;
  }
  layoutReady() { return !!this.article && this.layout.key === this.article.path + ":" + this.save.size; }
  settlePage() {
    const pages = this.pages();
    if (!pages) return null;
    this.page = pageAt(pages, this.pos.para, this.pos.char);
    const first = pages[this.page][0];
    this.pos = { para: first[2], char: first[3] };
    return pages;
  }
  fraction() {
    const pages = this.layoutReady() ? this.layout.pages : null;
    return pages && pages.length > 1 ? this.page / (pages.length - 1) : 0;
  }

  // ---- rows of the list screens ---------------------------------------------------------------
  rows() {
    const s = this.data.status, a = this.current();
    if (this.phase === "menu") {
      const back = this.trail[this.trail.length - 1];
      return [
        { label: "RESUME READING", run: () => this.go("read") },
        { label: "PREVIOUS PAGE", run: () => { this.go("read"); this.turn(-1); } },
        { label: "LINKS ON THIS PAGE", run: () => this.go("links") },
        { label: "SECTIONS" + (a?.sections?.length ? " · " + a.sections.length : ""), run: () => this.go("sections") },
        ...(back ? [{ label: "BACK TO " + fit(back.title, 22).toUpperCase(), run: () => this.back() }] : []),
        { label: "AUTO-TURN · " + (PACES[this.save.auto] ? PACES[this.save.auto] + " WPM" : "OFF"), stay: true,
          run: () => { this.save.auto = (this.save.auto + 1) % PACES.length; this.autoT = 0; this.dirty = true; } },
        { label: "TEXT · " + SIZES[this.save.size].name, stay: true, run: () => { this.save.size = (this.save.size + 1) % SIZES.length; this.dirty = true; } },
        { label: "ENCYCLOPEDIA HOME", run: () => this.home() },
      ];
    }
    if (this.phase === "links") {
      const links = this.linksByPage();
      return [{ label: "BACK TO THE PAGE", run: () => this.go("read") },
        ...links.map(([title, path, , here]) => ({ label: fit(title, 52), sub: here ? "ON THIS PAGE" : "FURTHER ON", run: () => this.follow(path, title) }))];
    }
    if (this.phase === "sections") {
      return [{ label: "BACK TO THE PAGE", run: () => this.go("read") },
        ...(a?.sections || []).map(([title, at]) => ({ label: fit(title, 52), sub: "SECTION", run: () => this.jump(at) }))];
    }
    if (this.phase === "recent") {
      return [{ label: "BACK", run: () => this.go("home") },
        ...this.save.recent.map((r) => ({ label: fit(r.title, 52), sub: r.f >= 0.99 ? "READ TO THE END" : Math.round(r.f * 100) + "% READ", progress: r.f,
          run: () => this.open(r.path, r.title, { trail: false }) }))];
    }
    // Home.
    if (!this.ready()) return [{ label: "LEAVE THE ENCYCLOPEDIA", sub: "BACK TO THE DASHBOARD", run: () => this.c.home?.() }];
    const rows = [];
    const last = this.save.last;
    if (last) rows.push({ label: "CONTINUE · " + fit(last.title, 40), sub: "WHERE YOU LEFT OFF", run: () => this.open(last.path, last.title, { pos: last, trail: false }) });
    if (s.featured) rows.push({ label: "ARTICLE OF THE DAY", sub: fit(s.featured.title, 60), run: () => this.open(s.featured.path, s.featured.title, { trail: false }) });
    if (s.onThisDay) rows.push({ label: "ON THIS DAY", sub: fit(s.onThisDay.title, 60), run: () => this.open(s.onThisDay.path, s.onThisDay.title, { trail: false }) });
    rows.push({ label: "RANDOM ARTICLE", sub: "SOMEWHERE NEW", run: () => this.random() });
    if (s.main) rows.push({ label: "FRONT PAGE", sub: fit(s.title, 60), run: () => this.open(s.main, "Front page", { trail: false }) });
    if (this.save.recent.length) rows.push({ label: "RECENTLY READ", sub: this.save.recent.length + " ARTICLES", run: () => this.go("recent", 1) });
    rows.push({ label: "LEAVE THE ENCYCLOPEDIA", sub: "BACK TO THE DASHBOARD", run: () => this.c.home?.() });
    return rows;
  }
  // Links in the order they appear, those on the page being read first: [title, path, block, onPage].
  linksByPage() {
    const a = this.current(), pages = this.layoutReady() ? this.layout.pages : null;
    if (!a) return [];
    const page = pages?.[this.page] || [];
    const lo = page[0]?.[2] ?? 0, hi = page[page.length - 1]?.[2] ?? -1;
    const here = [], later = [], earlier = [];
    for (const [title, path, block] of a.links) {
      const at = Number.isInteger(block) ? block : 0;
      (at >= lo && at <= hi ? here : at > hi ? later : earlier).push([title, path, at, at >= lo && at <= hi]);
    }
    return [...here, ...later, ...earlier].slice(0, 120);
  }

  // ---- actions ------------------------------------------------------------------------------
  go(phase, cursor = 0) { this.phase = phase; this.cursor = cursor; if (phase === "read") this.autoT = 0; }
  home() { this.flush(); this.go("home"); this.loadStatus(); }
  open(path, title, { pos = null, trail = true } = {}) {
    if (!okPath(path)) return;
    if (trail && this.article) {
      this.trail.push({ path: this.article.path, title: this.article.title, ...this.pos });
      if (this.trail.length > MAX_TRAIL) this.trail.shift();
    }
    if (!trail) this.trail = [];
    this.article = { path, title: String(title || path) };
    this.pos = pos ? { para: pos.para | 0, char: pos.char | 0 } : { para: 0, char: 0 };
    this.page = 0;
    this.go("read");
    this.settlePage();
    this.markRead();
  }
  follow(path, title) { this.c.tone?.(990, 0.05, "sine"); this.open(path, title); }
  back() {
    const to = this.trail.pop();
    if (!to) return;
    this.article = { path: to.path, title: to.title };
    this.pos = { para: to.para, char: to.char };
    this.go("read");
    this.settlePage();
    this.c.tone?.(520, 0.05, "sine");
    this.markRead();
  }
  jump(block) { this.pos = { para: block | 0, char: 0 }; this.go("read"); this.settlePage(); this.markRead(); }
  random() {
    this.notice = { title: "RANDOM ARTICLE", lines: ["Picking somewhere new…"], wait: true, back: "home" };
    this.phase = "notice";
    Promise.resolve()
      .then(() => this.c.get("encyclopedia/random"))
      .then((r) => {
        if (!this.c.alive?.() || this.phase !== "notice") return;
        if (!okPath(r?.path)) throw new Error("nothing found");
        this.notice = null;
        this.open(r.path, r.title, { trail: false });
      })
      .catch(() => { if (this.c.alive?.() && this.phase === "notice") this.notice = { title: "RANDOM ARTICLE", lines: ["No article came back. Try again."], back: "home" }; });
  }
  turn(dir) {
    const pages = this.pages();
    if (!pages) { if (this.article) this.data.failed.delete(this.article.path); return; }
    if (dir > 0 && this.page + 1 >= pages.length) {
      // The end of the article: where next?
      this.markRead(1);
      if (this.current()?.links.length) { this.go("links", 1); this.c.tone?.(660, 0.05, "sine"); }
      return;
    }
    if (dir < 0 && this.page === 0) return;
    this.page += dir;
    const first = pages[this.page][0];
    this.pos = { para: first[2], char: first[3] };
    this.autoT = 0;
    this.c.tone?.(dir > 0 ? 1500 : 1100, 0.012, "triangle");
    this.lamps.flash(0.32, (e, total, base) => lampMax(base, spot(dir > 0 ? e / total : 1 - e / total, LAMP.white, 0.6).map((v) => v * 0.25)));
    this.markRead();
  }
  markRead(f) {
    if (!this.article) return;
    const { path, title } = this.article;
    this.save.last = { path, title: fit(title, 80), para: this.pos.para, char: this.pos.char };
    const was = this.save.recent.find((r) => r.path === path);
    const read = Math.max(was?.f || 0, f ?? this.fraction());
    this.save.recent = [{ path, title: fit(title, 80), f: Math.round(read * 100) / 100 }, ...this.save.recent.filter((r) => r.path !== path)].slice(0, MAX_RECENT);
    this.dirty = true;
  }
  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    this.savedAt = this.t;
    this.save = migrateWiki(this.save);
    Promise.resolve(this.c.saveProgress?.(this.save)).catch(() => {});
  }

  // ---- input --------------------------------------------------------------------------------
  holdMs() { const v = this.c.settings?.()?.holdMs; return Number.isFinite(v) ? clamp(v, 450, 1200) : 650; }
  down() { this.guard.mark(); this.held = true; this.pressT = 0; }
  up(event) {
    this.guard.release();
    if (!this.held) return;
    this.held = false;
    const ms = Number.isFinite(event?.durationMs) ? event.durationMs : this.pressT * 1000;
    this.pressT = 0;
    if (ms >= this.holdMs()) this.choose(); else this.step();
  }
  cancel() { this.guard.rewind(); this.held = false; this.pressT = 0; }
  step() {
    if (this.phase === "read") { this.turn(1); return; }
    if (this.phase === "notice") {
      if (this.notice?.wait) return;
      this.go(this.notice?.back || "home");
      this.notice = null;
      return;
    }
    const n = this.rows().length;
    this.cursor = n ? (this.cursor + 1) % n : 0;
    this.c.tone?.(700, 0.015, "triangle");
  }
  choose() {
    if (this.phase === "read") { this.go("menu"); this.c.tone?.(660, 0.04, "sine"); return; }
    if (this.phase === "notice") { this.step(); return; }
    const row = this.rows()[this.cursor];
    if (!row) return;
    this.c.tone?.(880, 0.04, "sine");
    row.run();
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

  // ---- simulation ---------------------------------------------------------------------------
  update(dt) {
    this.t += dt;
    this.guard.tick(dt);
    if (this.held) this.pressT += dt;
    if (this.article && (this.phase === "read" || this.phase === "menu" || this.phase === "links") && !this.layoutReady()) this.settlePage();
    if (this.phase === "read") {
      const pace = PACES[this.save.auto], pages = this.layoutReady() ? this.layout.pages : null;
      if (pace && pages && !this.held) {
        this.autoT += dt;
        if (this.autoT >= pageSeconds(pages[this.page], pace)) this.turn(1);
      }
    }
    if (this.dirty && this.t - this.savedAt > 3) this.flush();
    this.lamps.frame(dt, this.ambient());
    this.status();
  }
  ambient() {
    const hold = this.held ? clamp(this.pressT * 1000 / this.holdMs(), 0, 1) : 0;
    let base;
    if (this.article && this.phase !== "home" && this.phase !== "recent" && this.phase !== "notice") {
      base = meter(Math.max(0.08, this.fraction()), dim(LAMP.amber, 0.22));
      // How deep down the trail of links: a cyan light that moves right with each link followed.
      if (this.trail.length) base = lampMax(base, spot(clamp(this.trail.length / 6, 0, 1), dim(LAMP.cyan, 0.28)));
      const pace = PACES[this.save.auto], pages = this.layoutReady() ? this.layout.pages : null;
      if (pace && pages && this.phase === "read") base = lampMax(base, only3(clamp(this.autoT / pageSeconds(pages[this.page], pace), 0, 1)));
    } else if (this.phase === "notice") {
      base = lamps(null, dim(LAMP.green, 0.12 + (this.notice?.wait ? 0.08 * Math.sin(this.t * 4) : 0)), null);
    } else {
      const n = Math.max(1, this.rows().length - 1);
      base = spot(clamp(this.cursor / n, 0, 1), dim(LAMP.green, 0.2));
    }
    if (hold > 0.1) base = base.map((v, i) => Math.round(v + (dim(LAMP.cyan, 0.3)[i % 3] - v) * hold));
    return base;
  }
  status() {
    let hud, hint;
    if (this.phase === "read" && this.article) {
      const pages = this.layoutReady() ? this.layout.pages : null;
      hud = [["PAGE", pages ? (this.page + 1) + "/" + pages.length : "…"], ["DEPTH", String(this.trail.length)], ["READ", Math.round(this.fraction() * 100) + "%"]];
      hint = "TAP: NEXT PAGE · HOLD & RELEASE: LINKS, SECTIONS, BACK";
    } else {
      const s = this.data.status;
      hud = [["ARTICLES", s.articles ? Number(s.articles).toLocaleString("en-US") : "—"]];
      hint = this.phase === "notice" ? (this.notice?.wait ? "WORKING…" : "TAP OR HOLD TO GO ON") : "TAP: NEXT · HOLD & RELEASE: CHOOSE";
    }
    const key = JSON.stringify(hud);
    if (key !== this.lastHud) { this.lastHud = key; this.c.hud?.(hud); }
    if (hint !== this.lastHint) { this.lastHint = hint; this.c.hint?.(hint); }
  }

  // ---- drawing ------------------------------------------------------------------------------
  draw(g) {
    g.save();
    g.fillStyle = C.bg;
    g.fillRect(0, 0, 960, 540);
    if (this.phase === "read" || this.phase === "menu") this.drawPage(g);
    else if (this.phase === "notice") drawNoticePanel(g, this.notice, this.t, this.notice?.wait);
    else if (this.phase === "home") this.drawHome(g);
    else this.drawList(g);
    if (this.phase === "menu") drawMenuPanel(g, "ENCYCLOPEDIA", this.rows().map((r) => r.label), this.cursor);
    if (this.held) {
      const hold = clamp(this.pressT * 1000 / this.holdMs(), 0, 1);
      g.fillStyle = hold >= 1 ? C.cyan : C.line;
      g.fillRect(60, 528, 840 * hold, 4);
    }
    g.restore();
  }
  drawPage(g) {
    const title = this.article?.title || "";
    text(g, fit(title, 46).toUpperCase(), 60, 34, 18, C.muted);
    line(g, 60, 56, 900, 56, C.line, 1);
    const pages = this.layoutReady() ? this.layout.pages : null;
    if (!pages) {
      const failed = this.article && this.data.failed.get(this.article.path);
      text(g, failed ? "THIS ARTICLE COULD NOT BE LOADED" : "LOOKING IT UP…", 480, 250, 24, failed ? C.red : C.amber, "center");
      if (failed) text(g, "TAP TO TRY AGAIN · HOLD FOR THE MENU", 480, 290, 18, C.muted, "center");
      return;
    }
    text(g, (this.page + 1) + " / " + pages.length, 900, 34, 18, C.muted, "right");
    drawLines(g, pages[this.page], this.save.size);
    line(g, 60, 486, 900, 486, C.line, 1);
    const f = this.fraction();
    g.fillStyle = C.dark;
    g.fillRect(60, 500, 840, 6);
    g.fillStyle = C.amber;
    g.fillRect(60, 500, 840 * f, 6);
    // The trail: a dot for each article behind this one.
    const depth = Math.min(this.trail.length, 12);
    for (let i = 0; i < depth; i++) { g.fillStyle = C.cyan; g.fillRect(60 + i * 14, 514, 8, 8); }
    const links = this.current()?.links.length || 0, last = this.page + 1 >= pages.length;
    text(g, last && links ? "TAP: WHERE NEXT? · " + links + " LINKS" : links + " LINKS", 900, 518, 16, last ? C.cyan : C.muted, "right");
    if (!depth) text(g, "ENCYCLOPEDIA", 60, 518, 16, C.muted);
  }
  drawHome(g) {
    const s = this.data.status;
    if (!this.ready()) {
      const why = {
        loading: ["Opening the encyclopedia…"],
        offline: ["The encyclopedia service is not running here. It works on the console, where the Pi keeps an offline copy of Wikipedia."],
        nolib: ["The reader library is missing on the console.", "On the Pi: .venv/bin/pip install -e '.[encyclopedia]'"],
        missing: ["No encyclopedia file yet. On the Pi, run:", "python3 scripts/get-encyclopedia.py --data " + fit(String(s.folder || "").replace(/\/encyclopedia$/, ""), 60),
          "It downloads Simple English Wikipedia, text only, into " + fit(s.folder, 60) + "."],
        broken: ["The encyclopedia file could not be opened: " + fit(s.error, 80), "Run scripts/get-encyclopedia.py again."],
      }[s.status] || ["Unknown state."];
      drawNoticePanel(g, { title: "ENCYCLOPEDIA", lines: why }, this.t, s.status === "loading");
      const rows = this.rows();
      text(g, "HOLD: " + rows[0].label, 480, 500, 18, C.amber, "center");
      return;
    }
    text(g, fit(String(s.title || "ENCYCLOPEDIA").toUpperCase(), 40), 60, 30, 18, C.amber);
    text(g, (s.articles ? Number(s.articles).toLocaleString("en-US") + " ARTICLES" : "") + (s.date ? " · " + s.date : ""), 900, 30, 18, C.muted, "right");
    line(g, 60, 52, 900, 52, C.line, 1);
    const rows = this.rows(), visible = 6, top = clamp(this.cursor - 2, 0, Math.max(0, rows.length - visible));
    for (let i = top; i < Math.min(rows.length, top + visible); i++) {
      const row = rows[i], y = 66 + (i - top) * 70, on = i === this.cursor;
      if (on) {
        g.fillStyle = C.dark;
        g.fillRect(52, y, 856, 62);
        g.strokeStyle = C.ink;
        g.lineWidth = 2;
        g.strokeRect(52, y, 856, 62);
      }
      text(g, ICONS[row.label.split(" · ")[0]] || "◇", 80, y + 31, 24, on ? C.amber : C.muted, "center");
      text(g, row.label, 110, y + 21, 22, C.ink);
      if (row.sub) text(g, fit(row.sub, 64), 110, y + 46, 18, row.label === "ARTICLE OF THE DAY" || row.label === "ON THIS DAY" ? C.cyan : C.muted);
    }
    text(g, "TEXT FROM WIKIPEDIA CONTRIBUTORS · CC BY-SA · VIA KIWIX", 480, 500, 14, C.muted, "center");
  }
  drawList(g) {
    const a = this.current(), rows = this.rows();
    const heading = this.phase === "recent" ? "RECENTLY READ" : fit(String(a?.title || "").toUpperCase(), 36) + (this.phase === "sections" ? " · SECTIONS" : " · LINKS");
    const atEnd = this.phase === "links" && this.layoutReady() && this.page + 1 >= this.layout.pages.length;
    const count = this.phase === "links" ? (atEnd ? "WHERE NEXT?" : rows.length - 1 + " LINKS") : this.phase === "sections" ? rows.length - 1 + " SECTIONS" : "";
    drawRowList(g, rows, this.cursor, heading, count, this.phase === "links" && this.trail.length ? "DEPTH " + this.trail.length + " · BACK IS IN THE HOLD MENU" : "");
  }
}

const ICONS = { "CONTINUE": "▸", "ARTICLE OF THE DAY": "☼", "ON THIS DAY": "◷", "RANDOM ARTICLE": "⁂", "FRONT PAGE": "▤", "RECENTLY READ": "↺", "LEAVE THE ENCYCLOPEDIA": "←" };
// The auto-turn countdown on the right-hand lamp.
function only3(fraction) { return lamps(null, null, dim(LAMP.cyan, 0.08 + 0.2 * fraction)); }
