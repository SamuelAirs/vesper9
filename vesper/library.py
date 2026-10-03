"""The book library: local DRM-free books, read one chapter at a time by the Library app.

Books are files in one folder (``<data>/library``): EPUB (no DRM), plain text, and a Kindle
``My Clippings.txt`` (the highlights and notes a Kindle e-reader keeps). Kindle purchases are
DRM-protected and cannot be read here; such files are listed as locked with the reason, never
decrypted. Parsing uses the standard library only and is bounded (file size, members, paragraphs).

The service may also copy books in: from a USB stick (or a Kindle e-reader) mounted under
``/media``, and from a short built-in list of Standard Ebooks titles (CC0) on GitHub. Both are
started by an explicit choice in the app; nothing is fetched on its own.
"""
import hashlib
import io
import html.parser
import json
import logging
import posixpath
import re
import shutil
import threading
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path
from xml.etree import ElementTree

MAX_FILE = 64 * 1024 * 1024      # bytes: a book file larger than this is not opened
MAX_MEMBER = 8 * 1024 * 1024     # bytes read from one EPUB member (a zip bomb stops here)
MAX_CHAPTERS = 1500
MAX_PARAGRAPHS = 6000            # per chapter
MAX_PARAGRAPH = 12000            # characters in one paragraph
MAX_BOOKS = 400
READABLE = (".epub", ".txt")
# Kindle and other formats a person may well copy in: listed, with what to do about them.
LOCKED_FORMATS = {
    ".azw": "KINDLE", ".azw3": "KINDLE", ".azw4": "KINDLE", ".kfx": "KINDLE", ".kfx-zip": "KINDLE",
    ".mobi": "MOBI", ".prc": "MOBI", ".tpz": "KINDLE", ".pdf": "PDF",
}
LOCKED_REASONS = {
    "KINDLE": "A Kindle book file. Kindle purchases are protected by DRM, which this console does not "
              "remove, so it cannot be opened here. Read it on a Kindle or the Kindle app; your highlights "
              "can come over through My Clippings.txt.",
    "MOBI": "A MOBI file. If it is DRM-free (not a Kindle purchase), convert it to EPUB with Calibre on "
            "another computer and copy the EPUB in.",
    "PDF": "A PDF has fixed pages that do not fit this screen. Convert it to EPUB or plain text first.",
    "DRM": "This EPUB is protected by DRM (Adobe or a store's own), which this console does not remove. "
           "Only DRM-free EPUBs can be read here.",
    "BROKEN": "This file could not be read as a book.",
}
# Font obfuscation is not DRM: Standard Ebooks and many others use it for embedded fonts only.
FONT_OBFUSCATION = {"http://www.idpf.org/2008/embedding", "http://ns.adobe.com/pdf/enc#RC"}

# More public-domain titles the app can fetch: Standard Ebooks editions (CC0), downloaded from their
# source repositories on GitHub (the console already reaches GitHub to update) and packed into a
# text-only EPUB here. The books that ship with the console are in books/ (scripts/pack-books.py).
SHELF = [
    {"id": "se-moreau", "title": "The Island of Doctor Moreau", "author": "H. G. Wells", "repo": "h-g-wells_the-island-of-doctor-moreau"},
    {"id": "se-moonmen", "title": "The First Men in the Moon", "author": "H. G. Wells", "repo": "h-g-wells_the-first-men-in-the-moon"},
    {"id": "se-lostworld", "title": "The Lost World", "author": "Arthur Conan Doyle", "repo": "arthur-conan-doyle_the-lost-world"},
    {"id": "se-hound", "title": "The Hound of the Baskervilles", "author": "Arthur Conan Doyle", "repo": "arthur-conan-doyle_the-hound-of-the-baskervilles"},
    {"id": "se-flatland", "title": "Flatland", "author": "Edwin A. Abbott", "repo": "edwin-a-abbott_flatland"},
    {"id": "se-whitefang", "title": "White Fang", "author": "Jack London", "repo": "jack-london_white-fang"},
    {"id": "se-mobydick", "title": "Moby-Dick", "author": "Herman Melville", "repo": "herman-melville_moby-dick"},
    {"id": "se-heart", "title": "Heart of Darkness", "author": "Joseph Conrad", "repo": "joseph-conrad_heart-of-darkness"},
    {"id": "se-gulliver", "title": "Gulliver's Travels", "author": "Jonathan Swift", "repo": "jonathan-swift_gullivers-travels"},
    {"id": "se-dorian", "title": "The Picture of Dorian Gray", "author": "Oscar Wilde", "repo": "oscar-wilde_the-picture-of-dorian-gray"},
    {"id": "se-carol", "title": "A Christmas Carol", "author": "Charles Dickens", "repo": "charles-dickens_a-christmas-carol"},
    {"id": "se-sawyer", "title": "The Adventures of Tom Sawyer", "author": "Mark Twain", "repo": "mark-twain_the-adventures-of-tom-sawyer"},
    {"id": "se-oz", "title": "The Wonderful Wizard of Oz", "author": "L. Frank Baum", "repo": "l-frank-baum_the-wonderful-wizard-of-oz"},
    {"id": "se-willows", "title": "The Wind in the Willows", "author": "Kenneth Grahame", "repo": "kenneth-grahame_the-wind-in-the-willows"},
    {"id": "se-meditations", "title": "Meditations", "author": "Marcus Aurelius", "repo": "marcus-aurelius_meditations_george-long"},
    {"id": "se-artofwar", "title": "The Art of War", "author": "Sun Tzu", "repo": "sun-tzu_the-art-of-war_lionel-giles"},
]
SHELF_HOSTS = ("github.com", "codeload.github.com")
MAX_DOWNLOAD = 160 * 1024 * 1024   # a source archive with its illustrations; only the text is kept


def shelf_url(item):
    return "https://github.com/standardebooks/%s/archive/refs/heads/master.zip" % item["repo"]


def allowed_host(url):
    host = (urllib.parse.urlsplit(url).hostname or "").lower()
    return urllib.parse.urlsplit(url).scheme == "https" and host in SHELF_HOSTS


def pack_source(files):
    """A Standard Ebooks source tree ({path: bytes}, paths ending .../src/<epub file>) to a text-only EPUB:
    the text, styles and package, without images and fonts (the console reads text only)."""
    src = {}
    for name, data in files.items():
        parts = name.split("/")
        if "src" not in parts:
            continue
        rest = "/".join(parts[parts.index("src") + 1:])
        if rest and not rest.startswith("epub/images/") and not rest.startswith("epub/fonts/"):
            src[rest] = data
    if "META-INF/container.xml" not in src or "epub/content.opf" not in src:
        raise ValueError("not a Standard Ebooks source")
    opf = src["epub/content.opf"].decode("utf-8")
    opf = re.sub(r'<item\b[^>]*media-type="(?:image|font)/[^"]*"[^>]*/>\s*', "", opf)
    opf = re.sub(r'<item\b[^>]*href="(?:images|fonts)/[^"]*"[^>]*/>\s*', "", opf)
    opf = re.sub(r'<meta\b[^>]*name="cover"[^>]*/>\s*', "", opf)
    src["epub/content.opf"] = opf.encode("utf-8")
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(zipfile.ZipInfo("mimetype"), b"application/epub+zip", compress_type=zipfile.ZIP_STORED)
        for name in sorted(src):
            if name != "mimetype":
                info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
                archive.writestr(info, src[name], compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    return out.getvalue()


def pack_archive(data):
    """A GitHub source archive (zip bytes) of a Standard Ebooks repository to a text-only EPUB."""
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        files = {}
        for info in archive.infolist():
            if info.is_dir() or "/src/" not in info.filename or "/src/epub/images/" in info.filename or "/src/epub/fonts/" in info.filename:
                continue
            if info.file_size > MAX_MEMBER:
                raise ValueError("member too large")
            files[info.filename] = archive.read(info)
    return pack_source(files)


# ---- text extraction --------------------------------------------------------------------------

def clean(text):
    return re.sub(r"\s+", " ", text).strip()[:MAX_PARAGRAPH]


class Blocks(html.parser.HTMLParser):
    """XHTML to a list of [kind, text] blocks: "h" for headings, "p" for everything else."""
    BLOCK = {"p", "div", "li", "blockquote", "pre", "tr", "dt", "dd", "section", "article", "header",
             "footer", "aside", "figcaption", "table", "ul", "ol", "dl", "hr", "body", "hgroup", "nav"}
    HEADING = {"h1", "h2", "h3", "h4", "h5", "h6"}
    SKIP = {"script", "style", "head", "title", "svg", "math", "rt", "rp"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.blocks, self.buffer, self.skip, self.heading = [], [], 0, 0

    def flush(self):
        text = clean("".join(self.buffer))
        self.buffer = []
        if text and len(self.blocks) < MAX_PARAGRAPHS:
            kind = "h" if self.heading else "p"
            # Consecutive heading lines (CHAPTER I / THE TITLE) read as one heading.
            if kind == "h" and self.blocks and self.blocks[-1][0] == "h" and self.joinable and len(self.blocks[-1][1]) + len(text) < 100:
                self.blocks[-1][1] = (self.blocks[-1][1] + " · " + text)[:MAX_PARAGRAPH]
            else:
                self.blocks.append([kind, text])
            self.joinable = kind == "h"

    joinable = False

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.skip += 1
        elif tag in self.HEADING:
            self.flush()
            self.heading += 1
        elif tag in self.BLOCK:
            self.flush()
        elif tag == "br":
            self.buffer.append(" ")

    def handle_startendtag(self, tag, attrs):
        if tag == "br":
            self.buffer.append(" ")
        elif tag in self.BLOCK:
            self.flush()

    def handle_endtag(self, tag):
        if tag in self.SKIP:
            self.skip = max(0, self.skip - 1)
        elif tag in self.HEADING:
            self.flush()
            self.heading = max(0, self.heading - 1)
            return
        elif tag in self.BLOCK:
            self.flush()

    def handle_data(self, data):
        if not self.skip:
            self.buffer.append(data)

    def close(self):
        super().close()
        self.flush()
        return self.blocks


def xhtml_blocks(markup):
    parser = Blocks()
    try:
        parser.feed(markup)
        return parser.close()
    except Exception:
        return parser.blocks


def local(tag):
    return tag.rsplit("}", 1)[-1]


def read_member(archive, name):
    info = archive.getinfo(name)
    if info.file_size > MAX_MEMBER:
        raise ValueError("member too large")
    with archive.open(info) as handle:
        return handle.read(MAX_MEMBER + 1)[:MAX_MEMBER]


def epub_drm(archive):
    names = set(archive.namelist())
    if "META-INF/rights.xml" in names:
        return True
    if "META-INF/encryption.xml" in names:
        try:
            root = ElementTree.fromstring(read_member(archive, "META-INF/encryption.xml"))
        except Exception:
            return True
        for element in root.iter():
            if local(element.tag) == "EncryptionMethod" and element.get("Algorithm") not in FONT_OBFUSCATION:
                return True
    return False


def parse_epub(path):
    """Returns (meta, chapters) where chapters is [{"title", "blocks"}]; raises LockedBook."""
    with zipfile.ZipFile(path) as archive:
        if epub_drm(archive):
            raise LockedBook("DRM")
        container = ElementTree.fromstring(read_member(archive, "META-INF/container.xml"))
        rootfile = next((e.get("full-path") for e in container.iter() if local(e.tag) == "rootfile"), None)
        if not rootfile:
            raise ValueError("no package document")
        opf = ElementTree.fromstring(read_member(archive, rootfile))
        base = posixpath.dirname(rootfile)
        meta = {"title": "", "author": ""}
        manifest, spine, toc_id, nav_href = {}, [], None, None
        for element in opf.iter():
            name = local(element.tag)
            if name == "title" and not meta["title"]:
                meta["title"] = clean(element.text or "")
            elif name == "creator" and not meta["author"]:
                meta["author"] = clean(element.text or "")
            elif name == "item":
                href = posixpath.normpath(posixpath.join(base, urllib.parse.unquote(element.get("href", ""))))
                manifest[element.get("id")] = (href, element.get("media-type", ""))
                if "nav" in (element.get("properties") or "").split():
                    nav_href = href
            elif name == "spine":
                toc_id = element.get("toc")
            elif name == "itemref" and element.get("linear", "yes") != "no":
                spine.append(element.get("idref"))
        titles = toc_titles(archive, manifest.get(toc_id, (None,))[0], nav_href)
        chapters = []
        for idref in spine:
            href, kind = manifest.get(idref, (None, ""))
            if not href or "html" not in kind or href == nav_href:
                continue
            try:
                markup = read_member(archive, href).decode("utf-8", "replace")
            except (KeyError, ValueError):
                continue
            blocks = xhtml_blocks(markup)
            if not blocks:
                continue
            heading = next((b[1] for b in blocks[:4] if b[0] == "h"), "")
            chapters.append({"title": titles.get(href) or heading or "", "blocks": blocks,
                             "body": "bodymatter" in markup[:4000]})
            if len(chapters) >= MAX_CHAPTERS:
                break
    return meta, chapters


def toc_titles(archive, ncx_href, nav_href):
    """Chapter titles by document, from the EPUB 3 nav or the EPUB 2 NCX (the first entry wins)."""
    titles = {}
    try:
        if nav_href:
            parser = NavTitles(posixpath.dirname(nav_href))
            parser.feed(read_member(archive, nav_href).decode("utf-8", "replace"))
            for href, title in parser.links:
                titles.setdefault(href, title)
        if ncx_href and not titles:
            root = ElementTree.fromstring(read_member(archive, ncx_href))
            folder = posixpath.dirname(ncx_href)
            for point in root.iter():
                if local(point.tag) != "navPoint":
                    continue
                label = next((clean("".join(t.itertext())) for t in point if local(t.tag) == "navLabel"), "")
                src = next((t.get("src", "") for t in point if local(t.tag) == "content"), "")
                href = posixpath.normpath(posixpath.join(folder, urllib.parse.unquote(src.split("#")[0])))
                if label:
                    titles.setdefault(href, label)
    except Exception:
        pass
    return titles


class NavTitles(html.parser.HTMLParser):
    def __init__(self, folder):
        super().__init__(convert_charrefs=True)
        self.folder, self.links, self.href, self.text, self.depth = folder, [], None, [], 0

    def handle_starttag(self, tag, attrs):
        if tag == "nav":
            kind = dict(attrs).get("epub:type", "") or dict(attrs).get("role", "")
            self.depth += 1 if ("toc" in kind or self.depth) else 0
        elif tag == "a" and self.depth:
            href = dict(attrs).get("href", "")
            self.href = posixpath.normpath(posixpath.join(self.folder, urllib.parse.unquote(href.split("#")[0])))
            self.text = []

    def handle_endtag(self, tag):
        if tag == "nav" and self.depth:
            self.depth -= 1
        elif tag == "a" and self.href:
            title = clean("".join(self.text))
            if title:
                self.links.append((self.href, title))
            self.href = None

    def handle_data(self, data):
        if self.href:
            self.text.append(data)


CHAPTER_LINE = re.compile(r"^(chapter|book|part|letter|stave|canto)\b[\s.:]*[\w\-]*", re.I)


def decode_text(raw):
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("latin-1")


def parse_text(path):
    text = decode_text(Path(path).read_bytes()).replace("\r\n", "\n").replace("\r", "\n")
    # Project Gutenberg plain texts: keep what is between the START and END markers.
    start = re.search(r"^\*\*\* ?START OF (THE|THIS) PROJECT GUTENBERG.*$", text, re.M | re.I)
    end = re.search(r"^\*\*\* ?END OF (THE|THIS) PROJECT GUTENBERG.*$", text, re.M | re.I)
    if start:
        text = text[start.end():end.start() if end and end.start() > start.end() else len(text)]
    lines = text.split("\n")
    title = next((clean(l) for l in lines if clean(l)), Path(path).stem)
    paragraphs = [clean(p) for p in re.split(r"\n\s*\n", text)]
    paragraphs = [p for p in paragraphs if p][: MAX_PARAGRAPHS * 20]
    chapters, current = [], None
    for paragraph in paragraphs:
        if len(paragraph) < 80 and CHAPTER_LINE.match(paragraph):
            current = {"title": paragraph, "blocks": [["h", paragraph]]}
            chapters.append(current)
            continue
        if current is None or len(current["blocks"]) >= 400:
            current = {"title": "", "blocks": []}
            chapters.append(current)
        current["blocks"].append(["p", paragraph])
        if len(chapters) > MAX_CHAPTERS:
            break
    chapters = [c for c in chapters if c["blocks"]][:MAX_CHAPTERS]
    return {"title": title[:120], "author": ""}, chapters


CLIP_HEAD = re.compile(r"^(?P<title>.*?)(?:\s*\((?P<author>[^()]*)\))?\s*$")


def parse_clippings(path):
    """A Kindle e-reader's My Clippings.txt: highlights and notes, one chapter per book."""
    text = decode_text(Path(path).read_bytes()).replace("\r\n", "\n").replace("﻿", "")
    books, seen = {}, set()
    for entry in text.split("=========="):
        lines = [l.strip() for l in entry.strip().split("\n")]
        if len(lines) < 3 or not lines[0]:
            continue
        head, info, body = lines[0], lines[1], clean(" ".join(lines[2:]))
        if not body or "bookmark" in info.lower():
            continue
        match = CLIP_HEAD.match(head)
        title = clean(match.group("title")) or head
        author = clean(match.group("author") or "")
        key = (title, body)
        if key in seen:        # the Kindle keeps every edit of a highlight; show each text once
            continue
        seen.add(key)
        where = clean(info.lstrip("- ").split("|")[0] if "|" in info else info.lstrip("- "))
        book = books.setdefault(title, {"title": title + (" · " + author if author else ""), "blocks": [["h", title]]})
        if author and len(book["blocks"]) == 1:
            book["blocks"].append(["m", author])
        if len(book["blocks"]) < MAX_PARAGRAPHS:
            book["blocks"].append(["m", where.upper()])
            book["blocks"].append(["q" if "note" not in info.lower() else "p", body])
    chapters = list(books.values())[:MAX_CHAPTERS]
    return {"title": "Kindle Highlights", "author": "%d books" % len(chapters)}, chapters


class LockedBook(Exception):
    def __init__(self, reason):
        super().__init__(reason)
        self.reason = reason


def is_clippings(path):
    return Path(path).name.lower().replace("_", " ") in ("my clippings.txt",)


def parse_book(path):
    path = Path(path)
    suffix = path.suffix.lower()
    if suffix in LOCKED_FORMATS:
        raise LockedBook(LOCKED_FORMATS[suffix])
    if path.stat().st_size > MAX_FILE:
        raise ValueError("file too large")
    if suffix == ".epub":
        return parse_epub(path)
    if is_clippings(path):
        return parse_clippings(path)
    return parse_text(path)


# ---- the library folder -----------------------------------------------------------------------

def book_id(path, stat):
    return hashlib.sha1(("%s|%d" % (path.name, stat.st_size)).encode()).hexdigest()[:16]


def words(blocks):
    return sum(len(b[1].split()) for b in blocks)


class Library:
    def __init__(self, folder, media="/media", bundled=None):
        self.folder = Path(folder)
        self.bundled = Path(bundled) if bundled else None   # books that ship with the console (read-only)
        self.media = Path(media) if media else None
        self.cache = {}          # path -> (signature, entry)
        self.parsed = {}         # id -> (signature, chapters), at most two books kept
        self.downloads = {}      # shelf id -> "downloading" | "done" | "failed: ..."
        self.lock = threading.Lock()   # listing and chapter run in worker threads; one at a time

    def files(self):
        """The person's own books first, then the bundled ones they do not already have a copy of."""
        found, names = [], set()
        for folder in (self.folder, self.bundled):
            if folder is None:
                continue
            try:
                if folder == self.folder:
                    folder.mkdir(parents=True, exist_ok=True)
                entries = sorted(p for p in folder.iterdir() if p.is_file() and not p.name.startswith("."))
            except OSError:
                continue
            for p in entries:
                if p.suffix.lower() in READABLE + tuple(LOCKED_FORMATS) and p.name not in names:
                    names.add(p.name)
                    found.append(p)
        return found[:MAX_BOOKS]

    def entry(self, path):
        stat = path.stat()
        signature = (stat.st_size, stat.st_mtime_ns)
        cached = self.cache.get(path)
        if cached and cached[0] == signature:
            return cached[1]
        ident = book_id(path, stat)
        entry = {"id": ident, "file": path.name, "bundled": self.bundled is not None and path.parent == self.bundled, "format": path.suffix.lower().lstrip(".").upper(),
                 "title": path.stem.replace("_", " "), "author": "", "chapters": [], "words": 0, "locked": None}
        try:
            meta, chapters = parse_book(path)
            entry.update(title=meta["title"] or entry["title"], author=meta["author"],
                         chapters=[c["title"][:120] for c in chapters], words=sum(words(c["blocks"]) for c in chapters),
                         # Where a new reader starts: the first chapter of the story, past the title page and imprint.
                         start=next((i for i, c in enumerate(chapters) if c.get("body")), 0))
            if is_clippings(path):
                entry["format"] = "KINDLE NOTES"
            if not chapters:
                entry["locked"] = "BROKEN"
            self.keep(ident, signature, chapters)
        except LockedBook as locked:
            entry["locked"] = locked.reason
        except Exception as exc:
            logging.info("Library: %s not readable: %s", path.name, exc)
            entry["locked"] = "BROKEN"
        if entry["locked"]:
            entry["reason"] = LOCKED_REASONS[entry["locked"]]
        self.cache[path] = (signature, entry)
        return entry

    def keep(self, ident, signature, chapters):
        self.parsed.pop(ident, None)
        self.parsed[ident] = (signature, chapters)
        while len(self.parsed) > 2:
            self.parsed.pop(next(iter(self.parsed)))

    def listing(self):
        with self.lock:
            return self._listing()

    def chapter(self, ident, index):
        with self.lock:
            return self._chapter(ident, index)

    def _listing(self):
        books = []
        for path in self.files():
            try:
                books.append(self.entry(path))
            except OSError:
                continue
        live = set(self.files())
        for gone in [p for p in self.cache if p not in live]:
            del self.cache[gone]
        held = {b["file"] for b in books}
        shelf = [{**{k: v for k, v in item.items() if k != "repo"}, "status": self.downloads.get(item["id"]) or
                  ("on shelf" if self.shelf_file(item) in held else "")} for item in SHELF]
        return {"books": books, "folder": str(self.folder), "shelf": shelf}

    def _chapter(self, ident, index):
        for path in self.files():
            entry = self.entry(path)
            if entry["id"] != ident:
                continue
            if entry["locked"]:
                raise LockedBook(entry["locked"])
            signature, chapters = self.parsed.get(ident, (None, None))
            if chapters is None or signature != self.cache[path][0]:
                _, chapters = parse_book(path)
                self.keep(ident, self.cache[path][0], chapters)
            if not 0 <= index < len(chapters):
                raise IndexError("no such chapter")
            chapter = chapters[index]
            return {"id": ident, "chapter": index, "count": len(chapters), "title": chapter["title"], "blocks": chapter["blocks"]}
        raise KeyError("no such book")

    # ---- bringing books in --------------------------------------------------------------------

    @staticmethod
    def shelf_file(item):
        slug = re.sub(r"[^a-z0-9]+", "-", item["title"].lower()).strip("-")
        return "%s-%s.epub" % (slug[:60], item["id"])

    def fetch(self, item_id, opener=None):
        """Download one Standard Ebooks title from the built-in shelf into the folder as an EPUB (blocking)."""
        item = next((i for i in SHELF if i["id"] == item_id), None)
        if item is None:
            raise ValueError("Unknown book")
        target = self.folder / self.shelf_file(item)
        if target.exists():
            self.downloads[item_id] = "done"
            return target
        self.downloads[item_id] = "downloading"
        partial = target.with_suffix(".part")
        try:
            self.folder.mkdir(parents=True, exist_ok=True)
            request = urllib.request.Request(shelf_url(item), headers={"User-Agent": "VESPER-9 library (personal console)"})
            with (opener or urllib.request.urlopen)(request, timeout=40) as response:
                final = response.geturl() if hasattr(response, "geturl") else shelf_url(item)
                if not allowed_host(final):
                    raise ValueError("redirected away from GitHub")
                data = response.read(MAX_DOWNLOAD + 1)
            if len(data) > MAX_DOWNLOAD:
                raise ValueError("download too large")
            partial.write_bytes(pack_archive(data))
            with zipfile.ZipFile(partial) as archive:
                if "META-INF/container.xml" not in archive.namelist():
                    raise ValueError("not an EPUB")
            partial.replace(target)
            self.downloads[item_id] = "done"
            return target
        except Exception as exc:
            self.downloads[item_id] = "failed: " + (str(exc) or type(exc).__name__)[:80]
            raise
        finally:
            if partial.exists():
                partial.unlink()

    def media_files(self):
        """Readable books and Kindle clippings on mounted drives (a USB stick, a Kindle e-reader)."""
        found = []
        if not self.media or not self.media.is_dir():
            return found
        stack = [(self.media, 0)]
        while stack and len(found) < MAX_BOOKS:
            folder, depth = stack.pop()
            try:
                children = sorted(folder.iterdir())
            except OSError:
                continue
            for child in children:
                if child.name.startswith("."):
                    continue
                try:
                    if child.is_dir() and not child.is_symlink() and depth < 4:
                        stack.append((child, depth + 1))
                    elif child.is_file() and child.suffix.lower() in READABLE and child.stat().st_size <= MAX_FILE:
                        found.append(child)
                except OSError:
                    continue
        return found

    def import_media(self):
        """Copy books from mounted drives into the library; returns how many were new."""
        self.folder.mkdir(parents=True, exist_ok=True)
        copied = 0
        for source in self.media_files():
            name = source.name
            if is_clippings(source):
                name = "My Clippings.txt"
            target = self.folder / name
            try:
                if target.exists() and target.stat().st_size == source.stat().st_size and not is_clippings(source):
                    continue
                if is_clippings(source) and target.exists() and target.read_bytes() == source.read_bytes():
                    continue
                shutil.copyfile(source, target.with_suffix(target.suffix + ".part"))
                target.with_suffix(target.suffix + ".part").replace(target)
                copied += 1
            except OSError as exc:
                logging.info("Library: could not copy %s: %s", source, exc)
        return copied


def dumps(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False)
