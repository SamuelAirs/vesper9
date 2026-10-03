"""The Encyclopedia: an offline Wikipedia (a Kiwix ZIM file) read one article at a time.

The ZIM file lives in ``<data>/encyclopedia`` (``scripts/get-encyclopedia.py`` downloads Simple
English Wikipedia there). It is read with the ``libzim`` package (``pip install '.[encyclopedia]'``);
without it, or without a file, the app says what is missing. Articles are turned into the same
[kind, text] blocks as library chapters, plus the article's links and section headings, so the
one-button reader can follow links and jump to sections. Nothing is fetched by the service.
"""
import datetime
import hashlib
import html.parser
import posixpath
import re
import threading
import urllib.parse
from pathlib import Path

from .library import MAX_PARAGRAPH, MAX_PARAGRAPHS, clean

try:  # optional: the console works without it
    from libzim.reader import Archive
except ImportError:  # pragma: no cover - depends on the machine
    Archive = None

MAX_ARTICLE = 4 * 1024 * 1024   # bytes of HTML read for one article
MAX_LINKS = 300
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
          "October", "November", "December"]
# Page furniture that is not part of the text a person reads.
SKIP_CLASSES = ("infobox", "navbox", "reflist", "references", "mw-references", "metadata", "noprint",
                "thumb", "gallery", "mw-editsection", "reference", "toc", "sistersitebox", "ambox",
                "navigation-not-searchable", "mw-cite-backlink", "external")
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}


class Article(html.parser.HTMLParser):
    """Article HTML to blocks ([kind, text], kind "h" or "p"), links and sections."""
    BLOCK = {"p", "div", "li", "blockquote", "pre", "tr", "dt", "dd", "section", "article", "header",
             "footer", "aside", "table", "ul", "ol", "dl", "hr", "body", "details", "summary", "caption"}
    HEADING = {"h1", "h2", "h3", "h4", "h5", "h6"}
    SKIP_TAGS = {"script", "style", "head", "title", "svg", "math", "figure", "sup", "audio", "video", "noscript"}

    def __init__(self, here):
        super().__init__(convert_charrefs=True)
        self.here = here
        self.blocks, self.links, self.sections = [], [], []
        self.seen = set()
        self.buffer, self.stack, self.skip, self.heading = [], [], 0, 0
        self.link = None

    def flush(self):
        text = clean("".join(self.buffer))
        self.buffer = []
        if text and len(self.blocks) < MAX_PARAGRAPHS:
            kind = "h" if self.heading else "p"
            if kind == "h":
                self.sections.append([text[:120], len(self.blocks)])
            self.blocks.append([kind, text[:MAX_PARAGRAPH]])

    def skipping(self, tag, attrs):
        if tag in self.SKIP_TAGS:
            return True
        classes = (dict(attrs).get("class") or "").lower().split()
        return any(c in SKIP_CLASSES or c.startswith("infobox") or c.startswith("navbox") for c in classes)

    def handle_starttag(self, tag, attrs):
        if tag in VOID:
            if tag == "br" and not self.skip:
                self.buffer.append(" ")
            return
        skip = self.skipping(tag, attrs)
        self.stack.append((tag, skip))
        if skip:
            self.skip += 1
            return
        if self.skip:
            return
        if tag in self.HEADING:
            self.end_link()
            self.flush()
            self.heading += 1
        elif tag in self.BLOCK:
            self.end_link()
            self.flush()
        elif tag == "a":
            self.end_link()
            target = self.target(dict(attrs).get("href"))
            self.link = [target, []] if target else None
            self.at = len(self.blocks)      # the block the link sits in (the one being gathered)

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        # Close back to the matching open tag (HTML in the wild is not always well nested).
        while self.stack:
            open_tag, skip = self.stack.pop()
            if skip:
                self.skip = max(0, self.skip - 1)
            elif not self.skip:
                self.close_tag(open_tag)
            if open_tag == tag:
                break

    def close_tag(self, tag):
        if tag in self.HEADING:
            self.flush()
            self.heading = max(0, self.heading - 1)
        elif tag in self.BLOCK:
            self.flush()
        elif tag == "a":
            self.end_link()

    def end_link(self):
        if not self.link:
            return
        target, words = self.link
        title = clean("".join(words))
        if title and target not in self.seen and len(self.links) < MAX_LINKS:
            self.seen.add(target)
            self.links.append([title[:80], target, self.at])
        self.link = None

    def handle_data(self, data):
        if self.skip:
            return
        self.buffer.append(data)
        if self.link:
            self.link[1].append(data)

    def target(self, href):
        """An in-archive article path for a link, or None (external links, files, anchors)."""
        if not href or href.startswith("#"):
            return None
        parts = urllib.parse.urlsplit(href)
        if parts.scheme or parts.netloc:
            return None
        path = urllib.parse.unquote(parts.path)
        if not path:
            return None
        path = posixpath.normpath(posixpath.join(posixpath.dirname(self.here), path)).lstrip("/")
        if path.startswith("..") or path.startswith("_") or path.startswith("-/") or path.startswith("I/"):
            return None
        if re.search(r"\.(png|jpe?g|gif|svg|webp|css|js|pdf|ogg|webm)$", path, re.I):
            return None
        return path

    def result(self):
        self.close()
        self.flush()
        return self.blocks, self.links, self.sections


def parse_article(markup, here=""):
    parser = Article(here)
    try:
        parser.feed(markup)
    except Exception:
        pass
    return parser.result()


class Encyclopedia:
    def __init__(self, folder):
        self.folder = Path(folder)
        self.lock = threading.Lock()
        self.archive = None
        self.opened = None        # (path, size, mtime) of the open archive
        self.today = {}           # date -> {path, title}

    def find(self):
        try:
            files = [p for p in self.folder.glob("*.zim") if p.is_file()]
        except OSError:
            return None
        return max(files, key=lambda p: p.stat().st_mtime, default=None)   # the newest download

    def open(self):
        """The archive, opened once and again only when the file changes; None if there is none."""
        path = self.find()
        if path is None or Archive is None:
            self.archive, self.opened = None, None
            return None
        stat = path.stat()
        key = (str(path), stat.st_size, stat.st_mtime_ns)
        if self.opened != key:
            self.archive, self.opened, self.today = Archive(str(path)), key, {}
        return self.archive

    def status(self):
        with self.lock:
            base = {"folder": str(self.folder), "library": Archive is not None}
            if Archive is None:
                return {**base, "status": "nolib"}
            try:
                archive = self.open()
            except Exception as exc:
                return {**base, "status": "broken", "error": str(exc)[:120]}
            if archive is None:
                return {**base, "status": "missing"}
            meta = lambda key: self.metadata(archive, key)
            main = archive.main_entry.get_redirect_entry() if archive.has_main_entry and archive.main_entry.is_redirect else (
                archive.main_entry if archive.has_main_entry else None)
            today = datetime.date.today()
            day = self.find_title(archive, "%s %d" % (MONTHS[today.month - 1], today.day))
            return {**base, "status": "ready", "file": Path(self.opened[0]).name, "bytes": self.opened[1],
                    "title": meta("Title") or "Encyclopedia", "language": meta("Language"), "date": meta("Date"),
                    "articles": archive.article_count, "main": main.path if main else None,
                    "featured": self.featured(archive, today.isoformat()), "onThisDay": day}

    @staticmethod
    def metadata(archive, key):
        try:
            return bytes(archive.get_metadata(key)).decode("utf-8", "replace")[:200]
        except Exception:
            return ""

    @staticmethod
    def find_title(archive, title):
        for probe in (lambda: archive.get_entry_by_title(title), lambda: archive.get_entry_by_path(title.replace(" ", "_"))):
            try:
                entry = probe()
                entry = entry.get_redirect_entry() if entry.is_redirect else entry
                return {"path": entry.path, "title": entry.title}
            except Exception:
                continue
        return None

    @staticmethod
    def readable(entry, least):
        """The entry itself (redirects followed) if it is an article of at least `least` bytes, else None."""
        try:
            for _ in range(4):
                if not entry.is_redirect:
                    break
                entry = entry.get_redirect_entry()
            item = entry.get_item()
            if not item.mimetype.startswith("text/html") or item.size < least:
                return None
            return entry
        except Exception:
            return None

    def featured(self, archive, date):
        """An article of the day: chosen from the date, so it is the same all day and new tomorrow."""
        if date in self.today:
            return self.today[date]
        count = getattr(archive, "all_entry_count", 0) or archive.entry_count
        seed = int(hashlib.sha256(date.encode()).hexdigest()[:12], 16)
        found = None
        for attempt in range(400):
            try:
                entry = archive._get_entry_by_id((seed + attempt * 7919) % max(1, count))
            except Exception:
                break
            entry = self.readable(entry, 6000)
            if entry is not None and entry.path != getattr(archive.main_entry, "path", None) and not re.match(r"^\d", entry.title):
                found = {"path": entry.path, "title": entry.title}
                break
        self.today = {date: found}
        return found

    def random(self):
        with self.lock:
            archive = self.open()
            if archive is None:
                raise LookupError("no encyclopedia")
            for _ in range(60):
                entry = self.readable(archive.get_random_entry(), 2500)
                if entry is not None:
                    return {"path": entry.path, "title": entry.title}
            raise LookupError("no article found")

    def article(self, path):
        with self.lock:
            archive = self.open()
            if archive is None:
                raise LookupError("no encyclopedia")
            try:
                entry = archive.get_entry_by_path(path)
            except KeyError:
                raise LookupError("no such article")
            entry = self.readable(entry, 0)
            if entry is None:
                raise LookupError("not an article")
            item = entry.get_item()
            markup = bytes(item.content)[:MAX_ARTICLE].decode("utf-8", "replace")
        blocks, links, sections = parse_article(markup, entry.path)
        # Lead with the title as a heading when the article's own heading was not in its body.
        if not blocks or blocks[0][0] != "h":
            blocks.insert(0, ["h", entry.title])
            sections = [[t, i + 1] for t, i in sections]
            links = [[t, p, i + 1] for t, p, i in links]
        return {"path": entry.path, "title": entry.title, "blocks": blocks, "links": links, "sections": sections}
