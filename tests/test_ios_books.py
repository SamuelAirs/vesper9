"""The books the iPhone app carries for The Stacks (ios/extras/books.py)."""
import json
import re
import runpy
import tempfile
import unittest
from pathlib import Path

from vesper import library

ROOT = Path(__file__).resolve().parents[1]
BOOKS = ROOT / "books"
CALL = re.compile(r'^window\.__vesperBooks\(("[^"]*"),(\{.*\})\);\n$', re.S)


def build(folder):
    runpy.run_path(str(ROOT / "ios/extras/books.py"))["build"](folder)


def files(folder):
    return {p.relative_to(folder).as_posix(): p.read_bytes() for p in sorted(Path(folder).rglob("*")) if p.is_file()}


def answers(data):
    """The file a script names and the answers it gives."""
    match = CALL.match(data.decode("utf-8"))
    assert match
    return json.loads(match.group(1)), json.loads(match.group(2))


class IosBooks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.folder = Path(cls.temp.name)
        build(cls.folder)
        cls.written = files(cls.folder)
        cls.scripts = {name: answers(data) for name, data in cls.written.items()}
        _, shelf = cls.scripts["books/shelf.js"]
        cls.listing, cls.parts = shelf["library"], shelf["parts"]

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def chapter(self, book, index):
        """A chapter from the scripts, found as the layer finds it."""
        first = max(start for start in self.parts[book] if start <= index)
        name, given = self.scripts["books/%s/%d.js" % (book, first)]
        self.assertEqual(name, "books/%s/%d.js" % (book, first))
        return given["library/%s/%d" % (book, index)]

    def test_the_build_writes_the_same_bytes_twice(self):
        with tempfile.TemporaryDirectory() as again:
            # A stale file from an earlier build is cleared away.
            (Path(again) / "books").mkdir()
            (Path(again) / "books" / "stale.js").write_text("x")
            build(again)
            self.assertEqual(files(again), self.written)

    def test_every_book_is_on_the_shelf(self):
        epubs = sorted(p.name for p in BOOKS.glob("*.epub"))
        self.assertEqual(len(epubs), 15)
        self.assertEqual(sorted(b["file"] for b in self.listing["books"]), epubs)
        for book in self.listing["books"]:
            self.assertIsNone(book["locked"], book["file"])
            self.assertRegex(book["id"], r"^[0-9a-f]{16}$")
            self.assertTrue(book["title"] and book["author"] and book["chapters"], book["file"])
            # Every chapter is in exactly one part, in order, and no part names another book.
            given = [path for start in self.parts[book["id"]] for path in self.scripts["books/%s/%d.js" % (book["id"], start)][1]]
            self.assertEqual(given, ["library/%s/%d" % (book["id"], i) for i in range(len(book["chapters"]))])
        self.assertEqual(len(self.written), 1 + sum(len(p) for p in self.parts.values()))
        # What the service lists, but for where the books go (there is no folder on the phone).
        with tempfile.TemporaryDirectory() as empty:
            service = library.Library(Path(empty) / "library", media=None, bundled=BOOKS).listing()
        self.assertEqual(self.listing["books"], service["books"])
        self.assertEqual(self.listing["shelf"], service["shelf"])
        self.assertIsNone(self.listing["busy"])
        self.assertEqual(self.listing["folder"], "THE CONSOLE · THIS APP CARRIES ITS 15 CLASSICS")

    def test_a_chapter_is_what_the_service_gives(self):
        with tempfile.TemporaryDirectory() as empty:
            service = library.Library(Path(empty) / "library", media=None, bundled=BOOKS)
            service.listing()
            for book in (self.listing["books"][0], self.listing["books"][7], self.listing["books"][-1]):
                last = len(book["chapters"]) - 1
                for index in sorted({0, book["start"], book["start"] + 1, last}):
                    chapter = self.chapter(book["id"], index)
                    # Through JSON, as the service sends it.
                    want = json.loads(json.dumps(service.chapter(book["id"], index), ensure_ascii=False))
                    self.assertEqual(chapter, want, "%s chapter %d" % (book["title"], index))
                    self.assertTrue(chapter["blocks"])

    def test_parts_are_small_enough_to_load_when_wanted(self):
        for name, data in self.written.items():
            if name != "books/shelf.js" and len(answers(data)[1]) > 1:
                self.assertLess(len(data), 256 * 1024, name)
        self.assertLess(len(self.written["books/shelf.js"]), 64 * 1024)


if __name__ == "__main__":
    unittest.main()
