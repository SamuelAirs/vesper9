"""The book library service (vesper/library.py) and its routes and commands.

Books are built here (tiny EPUBs, text files, a Kindle My Clippings.txt), in temporary folders.
Nothing touches the network: the Standard Ebooks download is given a fake opener.
"""
import asyncio
import io
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_service_fixes import ServiceCase  # noqa: E402

from vesper import library  # noqa: E402
from vesper.library import Library, parse_book, LockedBook  # noqa: E402

CONTAINER = """<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"""


def epub(path, title="A Test Voyage", author="Ada Example", chapters=None, encryption=None, rights=False, nav=True):
    chapters = chapters or [
        ("Chapter I", ["It was a dark and quiet night between the stars.", "The probe <em>listened</em>."]),
        ("Chapter II", ["Morning came &amp; went.", "Nothing answered."]),
    ]
    manifest, spine, links = [], [], []
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("mimetype", "application/epub+zip")
        z.writestr("META-INF/container.xml", CONTAINER)
        if encryption:
            z.writestr("META-INF/encryption.xml", f"""<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"
              xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="{encryption}"/>
              <enc:CipherData><enc:CipherReference URI="OEBPS/c1.xhtml"/></enc:CipherData></enc:EncryptedData></encryption>""")
        if rights:
            z.writestr("META-INF/rights.xml", "<rights/>")
        for i, (heading, paragraphs) in enumerate(chapters, 1):
            body = "".join(f"<p>{p}</p>" for p in paragraphs)
            z.writestr(f"OEBPS/c{i}.xhtml", f"""<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title>
              <style>p {{ color: red }}</style></head><body><section><h2>{heading}</h2>{body}</section></body></html>""")
            manifest.append(f'<item id="c{i}" href="c{i}.xhtml" media-type="application/xhtml+xml"/>')
            spine.append(f'<itemref idref="c{i}"/>')
            links.append(f'<li><a href="c{i}.xhtml">{heading.upper()} (NAV)</a></li>')
        if nav:
            z.writestr("OEBPS/nav.xhtml", f"""<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
              <body><nav epub:type="toc"><ol>{''.join(links)}</ol></nav></body></html>""")
            manifest.append('<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>')
        z.writestr("OEBPS/content.opf", f"""<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0">
          <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>{title}</dc:title><dc:creator>{author}</dc:creator></metadata>
          <manifest>{''.join(manifest)}</manifest><spine>{''.join(spine)}</spine></package>""")
    return path


def se_archive(repo):
    """A GitHub source archive shaped like a Standard Ebooks repository, with a cover image."""
    out = io.BytesIO()
    root = repo + "-master/src/"
    with zipfile.ZipFile(out, "w") as z:
        z.writestr(repo + "-master/README.md", "readme")
        z.writestr(root + "mimetype", "application/epub+zip")
        z.writestr(root + "META-INF/container.xml", CONTAINER.replace("OEBPS/content.opf", "epub/content.opf"))
        z.writestr(root + "epub/images/cover.jpg", b"\xff" * 5000)
        z.writestr(root + "epub/text/titlepage.xhtml", '<html xmlns="http://www.w3.org/1999/xhtml"><body epub:type="frontmatter titlepage"><h1>Moby-Dick</h1></body></html>')
        z.writestr(root + "epub/text/chapter-1.xhtml", '<html xmlns="http://www.w3.org/1999/xhtml"><body epub:type="bodymatter z3998:fiction"><section><h2>Loomings</h2><p>Call me Ishmael.</p></section></body></html>')
        z.writestr(root + "epub/content.opf", """<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0">
          <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Moby-Dick</dc:title><dc:creator>Herman Melville</dc:creator>
          <meta name="cover" content="cover.jpg"/></metadata>
          <manifest><item id="cover.jpg" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>
          <item id="titlepage" href="text/titlepage.xhtml" media-type="application/xhtml+xml"/>
          <item id="c1" href="text/chapter-1.xhtml" media-type="application/xhtml+xml"/></manifest>
          <spine><itemref idref="titlepage"/><itemref idref="c1"/></spine></package>""")
    return out.getvalue()


CLIPPINGS = """﻿The Left Hand of Darkness (Le Guin, Ursula K.)
- Your Highlight on page 12 | Location 180-182 | Added on Monday, 3 March 2025 21:04:11

Light is the left hand of darkness.
==========
The Left Hand of Darkness (Le Guin, Ursula K.)
- Your Highlight on page 12 | Location 180-182 | Added on Monday, 3 March 2025 21:04:11

Light is the left hand of darkness.
==========
Dune (Herbert, Frank)
- Your Bookmark on Location 900 | Added on Tuesday, 4 March 2025 08:00:00


==========
Dune (Herbert, Frank)
- Your Note on Location 1201 | Added on Tuesday, 4 March 2025 08:01:00

Fear is the mind-killer, remember this.
==========
"""


class Parsing(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.dir = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def test_an_epub_gives_its_title_author_and_chapters_as_text_blocks(self):
        meta, chapters = parse_book(epub(self.dir / "a.epub"))
        self.assertEqual(meta, {"title": "A Test Voyage", "author": "Ada Example"})
        self.assertEqual([c["title"] for c in chapters], ["CHAPTER I (NAV)", "CHAPTER II (NAV)"])
        self.assertEqual(chapters[0]["blocks"], [["h", "Chapter I"], ["p", "It was a dark and quiet night between the stars."],
                                                 ["p", "The probe listened."]])
        self.assertEqual(chapters[1]["blocks"][1], ["p", "Morning came & went."])

    def test_without_a_table_of_contents_the_first_heading_names_the_chapter(self):
        _, chapters = parse_book(epub(self.dir / "a.epub", nav=False))
        self.assertEqual(chapters[0]["title"], "Chapter I")

    def test_font_obfuscation_is_not_drm_but_real_encryption_and_adobe_rights_are(self):
        meta, chapters = parse_book(epub(self.dir / "fonts.epub", encryption="http://www.idpf.org/2008/embedding"))
        self.assertEqual(len(chapters), 2)
        for name, kwargs in (("aes.epub", {"encryption": "http://www.w3.org/2001/04/xmlenc#aes128-cbc"}), ("adobe.epub", {"rights": True})):
            with self.assertRaises(LockedBook) as caught:
                parse_book(epub(self.dir / name, **kwargs))
            self.assertEqual(caught.exception.reason, "DRM")

    def test_kindle_files_are_locked_with_the_reason_never_opened(self):
        for suffix in (".azw", ".azw3", ".kfx"):
            path = self.dir / ("bought" + suffix)
            path.write_bytes(b"\0" * 64)
            with self.assertRaises(LockedBook) as caught:
                parse_book(path)
            self.assertEqual(caught.exception.reason, "KINDLE")

    def test_a_gutenberg_text_loses_its_licence_and_splits_at_chapter_lines(self):
        path = self.dir / "story.txt"
        path.write_text("The Project Gutenberg eBook of Something\n\nlicence words\n\n*** START OF THE PROJECT GUTENBERG EBOOK SOMETHING ***\n\n"
                        "THE TITLE\n\nCHAPTER I.\n\nFirst line\nwrapped here.\n\nSecond.\n\nCHAPTER II.\n\nThird.\n\n"
                        "*** END OF THE PROJECT GUTENBERG EBOOK SOMETHING ***\n\nmore licence\n")
        meta, chapters = parse_book(path)
        self.assertEqual(meta["title"], "THE TITLE")
        self.assertEqual([c["title"] for c in chapters], ["", "CHAPTER I.", "CHAPTER II."])
        self.assertEqual(chapters[1]["blocks"], [["h", "CHAPTER I."], ["p", "First line wrapped here."], ["p", "Second."]])
        self.assertNotIn("licence", str(chapters))

    def test_kindle_clippings_become_one_chapter_per_book_without_duplicates_or_bookmarks(self):
        path = self.dir / "My Clippings.txt"
        path.write_text(CLIPPINGS, encoding="utf-8")
        meta, chapters = parse_book(path)
        self.assertEqual(meta["title"], "Kindle Highlights")
        self.assertEqual([c["title"] for c in chapters], ["The Left Hand of Darkness · Le Guin, Ursula K.", "Dune · Herbert, Frank"])
        texts = [b[1] for b in chapters[0]["blocks"]]
        self.assertEqual(texts.count("Light is the left hand of darkness."), 1)
        self.assertIn(["p", "Fear is the mind-killer, remember this."], chapters[1]["blocks"])

    def test_a_broken_file_is_listed_as_unreadable(self):
        (self.dir / "broken.epub").write_bytes(b"not a zip")
        books = Library(self.dir, media=None).listing()["books"]
        self.assertEqual(books[0]["locked"], "BROKEN")
        self.assertTrue(books[0]["reason"])


class Folder(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.lib = Library(self.root / "library", media=self.root / "media")

    def tearDown(self):
        self.temporary.cleanup()

    def test_listing_and_chapters(self):
        self.lib.folder.mkdir()
        epub(self.lib.folder / "voyage.epub")
        (self.lib.folder / "bought.azw3").write_bytes(b"x")
        (self.lib.folder / "notes.docx").write_bytes(b"x")
        listing = self.lib.listing()
        self.assertEqual([b["file"] for b in listing["books"]], ["bought.azw3", "voyage.epub"])
        locked, book = listing["books"]
        self.assertEqual(locked["locked"], "KINDLE")
        self.assertIn("DRM", locked["reason"])
        self.assertEqual(book["chapters"], ["CHAPTER I (NAV)", "CHAPTER II (NAV)"])
        self.assertEqual(book["words"], 3 + 9 + 3 + 2 + 4 + 2)
        self.assertEqual(len(book["id"]), 16)
        chapter = self.lib.chapter(book["id"], 1)
        self.assertEqual((chapter["chapter"], chapter["count"]), (1, 2))
        with self.assertRaises(IndexError):
            self.lib.chapter(book["id"], 2)
        with self.assertRaises(KeyError):
            self.lib.chapter("0" * 16, 0)
        with self.assertRaises(LockedBook):
            self.lib.chapter(locked["id"], 0)
        self.assertEqual(len(listing["shelf"]), len(library.SHELF))

    def test_import_from_a_usb_drive_copies_books_and_kindle_clippings_once(self):
        stick = self.root / "media" / "sam" / "KINDLE" / "documents"
        stick.mkdir(parents=True)
        epub(stick / "found.epub")
        (stick / "My Clippings.txt").write_text(CLIPPINGS)
        (stick / "bought.azw3").write_bytes(b"x")
        self.assertEqual(self.lib.import_media(), 2)
        self.assertEqual(sorted(p.name for p in self.lib.folder.iterdir()), ["My Clippings.txt", "found.epub"])
        self.assertEqual(self.lib.import_media(), 0, "a second import copies nothing new")

    def test_fetch_packs_a_standard_ebooks_archive_from_github_into_a_text_only_epub(self):
        body = se_archive("herman-melville_moby-dick")

        class Response:
            def __init__(self, url, data):
                self.url, self.data = url, data
            def geturl(self):
                return self.url
            def read(self, n):
                return self.data[:n]
            def __enter__(self):
                return self
            def __exit__(self, *a):
                return False

        seen = []
        def github(request, timeout):
            seen.append(request.full_url)
            return Response("https://codeload.github.com/standardebooks/herman-melville_moby-dick/zip/refs/heads/master", body)
        target = self.lib.fetch("se-mobydick", opener=github)
        self.assertEqual(seen, ["https://github.com/standardebooks/herman-melville_moby-dick/archive/refs/heads/master.zip"])
        with zipfile.ZipFile(target) as packed:
            names = packed.namelist()
            self.assertEqual(names[0], "mimetype")
            self.assertEqual(packed.getinfo("mimetype").compress_type, zipfile.ZIP_STORED)
            self.assertFalse(any("images/" in n for n in names), names)
            self.assertNotIn("cover", packed.read("epub/content.opf").decode())
        meta, chapters = parse_book(target)
        self.assertEqual(meta["title"], "Moby-Dick")
        entry = next(b for b in self.lib.listing()["books"] if b["file"] == target.name)
        self.assertEqual(entry["start"], 1, "a new reader starts at the story, past the title page")
        status = {i["id"]: i["status"] for i in self.lib.listing()["shelf"]}
        self.assertEqual(status["se-mobydick"], "done")
        self.assertNotIn("repo", self.lib.listing()["shelf"][0])
        with self.assertRaises(ValueError):
            self.lib.fetch("se-hound", opener=lambda r, timeout: Response("https://elsewhere.example/x.zip", body))
        self.assertFalse(any(p.name.endswith(".part") for p in self.lib.folder.iterdir()))
        with self.assertRaises(Exception):
            self.lib.fetch("se-oz", opener=lambda r, timeout: Response("https://github.com/x", b"<html>busy</html>"))
        self.assertTrue(self.lib.downloads["se-oz"].startswith("failed"))
        with self.assertRaises(ValueError):
            self.lib.fetch("../../etc")

    def test_bundled_books_follow_the_persons_own_and_a_copy_of_the_same_file_wins(self):
        bundled = self.root / "books"
        bundled.mkdir()
        epub(bundled / "shared.epub", title="Bundled Copy")
        epub(bundled / "only-bundled.epub", title="Only Bundled")
        self.lib.folder.mkdir()
        epub(self.lib.folder / "shared.epub", title="My Copy")
        lib = Library(self.lib.folder, media=None, bundled=bundled)
        books = lib.listing()["books"]
        self.assertEqual([(b["title"], b["bundled"]) for b in books], [("My Copy", False), ("Only Bundled", True)])
        self.assertEqual(lib.chapter(books[1]["id"], 0)["blocks"][0], ["h", "Chapter I"])

    def test_the_books_that_ship_with_the_console_all_open(self):
        shipped = sorted((Path(__file__).resolve().parents[1] / "books").glob("*.epub"))
        self.assertGreaterEqual(len(shipped), 15)
        for path in shipped:
            meta, chapters = parse_book(path)
            self.assertTrue(meta["title"] and meta["author"], path.name)
            self.assertGreater(sum(library.words(c["blocks"]) for c in chapters), 15000, path.name)
            self.assertTrue(any(c.get("body") for c in chapters), path.name)


class Routes(ServiceCase):
    async def test_the_library_routes_and_commands(self):
        folder = Path(self.temporary.name) / "library"
        folder.mkdir(exist_ok=True)
        epub(folder / "voyage.epub")
        response = await self.client.get("/api/library")
        listing = await response.json()
        book = listing["books"][0]
        self.assertEqual(book["title"], "A Test Voyage")
        chapter = await (await self.client.get(f"/api/library/{book['id']}/0")).json()
        self.assertEqual(chapter["blocks"][0], ["h", "Chapter I"])
        self.assertEqual((await self.client.get(f"/api/library/{book['id']}/9")).status, 404)
        self.assertEqual((await self.client.get("/api/library/nothex/0")).status, 400)
        ws, _ = await self.connect()
        bad = await self.rpc(ws, "library_fetch", item="../../x")
        self.assertFalse(bad["ok"])
        self.console.library.media = Path(self.temporary.name) / "no-media"
        reply = await self.rpc(ws, "library_import")
        self.assertTrue(reply["ok"])
        for _ in range(50):
            event = await asyncio.wait_for(ws.receive_json(), 3)
            if event.get("type") == "library":
                break
        self.assertEqual(event, {"type": "library", "op": "import", "ok": True, "copied": 0})
        await ws.close()


if __name__ == "__main__":
    unittest.main()
