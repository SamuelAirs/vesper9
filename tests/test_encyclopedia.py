"""The Encyclopedia service (vesper/encyclopedia.py): a small Wikipedia-like ZIM is written here with
libzim, then read back. Skipped where libzim is not installed (it is an optional extra)."""
import datetime
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_service_fixes import ServiceCase  # noqa: E402

from vesper import encyclopedia  # noqa: E402
from vesper.encyclopedia import Encyclopedia, parse_article  # noqa: E402

try:
    from libzim.writer import Creator, Item, StringProvider, Hint
except ImportError:  # pragma: no cover
    Creator = None

TODAY = datetime.date.today()
DAY = "%s %d" % (encyclopedia.MONTHS[TODAY.month - 1], TODAY.day)
FILLER = " ".join(["The sun is a star at the centre of the Solar System."] * 140)


def page(title, body):
    return f"""<!DOCTYPE html><html><head><title>{title}</title><style>p{{}}</style></head><body>
      <h1>{title}</h1>{body}</body></html>"""


ARTICLES = {
    "Sun": page("Sun", """<table class="infobox"><tr><td>Mass 2e30 kg</td></tr></table>
        <p>The <b>Sun</b> is the <a href="./Star">star</a> at the centre of the <a href="Solar_System">Solar System</a>.<sup class="reference">[1]</sup></p>
        <h2>Structure</h2><p>It is made of <a href="Hydrogen#isotopes">hydrogen</a> and <a href="./Star">more star</a>.</p>
        <p>See <a href="https://example.org/sun">an outside page</a> and <a href="_res_/sun.png">a picture</a>.</p>
        <h2>References</h2><div class="reflist"><ol><li>A reference.</li></ol></div>"""),
    "Star": page("Star", "<p>A star is a ball of plasma. " + FILLER + "</p><p>Back to the <a href='Sun'>Sun</a>.</p>"),
    "Solar_System": page("Solar System", "<p>The Solar System is the Sun and everything around it. " + FILLER + "</p>"),
    "Hydrogen": page("Hydrogen", "<p>Hydrogen is the lightest element. " + FILLER + "</p>"),
    DAY.replace(" ", "_"): page(DAY, "<p>Events on this day.</p><ul><li>1957: something happened.</li></ul>"),
    "Main_Page": page("Main Page", "<p>Welcome to the <a href='Sun'>Sun</a> encyclopedia.</p>"),
}


if Creator:
    class Page(Item):
        def __init__(self, path, title, html):
            super().__init__()
            self.path, self.title, self.html = path, title, html
        def get_path(self):
            return self.path
        def get_title(self):
            return self.title
        def get_mimetype(self):
            return "text/html"
        def get_contentprovider(self):
            return StringProvider(self.html)
        def get_hints(self):
            return {Hint.FRONT_ARTICLE: True}


def make_zim(path):
    with Creator(str(path)).config_indexing(False, "eng").config_verbose(False) as creator:
        creator.set_mainpath("Main_Page")
        for key, value in (("Title", "Tiny Wikipedia"), ("Language", "eng"), ("Date", "2026-09-01"),
                           ("Name", "tiny"), ("Creator", "tests"), ("Publisher", "tests"), ("Description", "A test archive")):
            creator.add_metadata(key, value)
        for path_, html in ARTICLES.items():
            creator.add_item(Page(path_, path_.replace("_", " "), html))
        creator.add_redirection("Sol", "Sol", "Sun", {Hint.FRONT_ARTICLE: True})


class Parsing(unittest.TestCase):
    def test_an_article_keeps_its_text_headings_and_internal_links_only(self):
        blocks, links, sections = parse_article(ARTICLES["Sun"], "Sun")
        self.assertEqual(blocks[0], ["h", "Sun"])
        self.assertEqual(blocks[1], ["p", "The Sun is the star at the centre of the Solar System."])
        text = str(blocks)
        for furniture in ("Mass 2e30", "[1]", "A reference."):
            self.assertNotIn(furniture, text)
        self.assertEqual(links, [["star", "Star", 1], ["Solar System", "Solar_System", 1], ["hydrogen", "Hydrogen", 3]])
        self.assertEqual([s[0] for s in sections], ["Sun", "Structure", "References"])
        self.assertEqual(blocks[sections[1][1]], ["h", "Structure"])

    def test_broken_html_still_gives_text(self):
        blocks, links, _ = parse_article("<p>One <a href='X'>two<p>three</b></div></span>", "")
        self.assertEqual([b[1] for b in blocks], ["One two", "three"])
        self.assertEqual(links, [["two", "X", 0]])


@unittest.skipIf(Creator is None, "libzim is not installed")
class Archive(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.folder = Path(self.temporary.name) / "encyclopedia"

    def tearDown(self):
        self.temporary.cleanup()

    def test_without_a_file_it_says_so(self):
        self.assertEqual(Encyclopedia(self.folder).status()["status"], "missing")
        with self.assertRaises(LookupError):
            Encyclopedia(self.folder).random()

    def test_status_articles_random_and_redirects(self):
        self.folder.mkdir()
        make_zim(self.folder / "tiny.zim")
        book = Encyclopedia(self.folder)
        status = book.status()
        self.assertEqual(status["status"], "ready")
        self.assertEqual(status["title"], "Tiny Wikipedia")
        self.assertEqual(status["main"], "Main_Page")
        self.assertEqual(status["onThisDay"], {"path": DAY.replace(" ", "_"), "title": DAY})
        self.assertIn(status["featured"]["path"], ("Star", "Solar_System", "Hydrogen"), "a long article")
        self.assertEqual(book.status()["featured"], status["featured"], "the same all day")
        article = book.article("Sol")
        self.assertEqual(article["path"], "Sun")
        self.assertEqual(article["links"][0], ["star", "Star", 1])
        self.assertIn(book.random()["path"], ("Star", "Solar_System", "Hydrogen"))
        with self.assertRaises(LookupError):
            book.article("Nowhere")


@unittest.skipIf(Creator is None, "libzim is not installed")
class Routes(ServiceCase):
    async def test_the_encyclopedia_routes(self):
        status = await (await self.client.get("/api/encyclopedia")).json()
        self.assertEqual(status["status"], "missing")
        folder = Path(self.temporary.name) / "encyclopedia"
        folder.mkdir()
        make_zim(folder / "tiny.zim")
        status = await (await self.client.get("/api/encyclopedia")).json()
        self.assertEqual(status["articles"] >= 6, True)
        article = await (await self.client.get("/api/encyclopedia/article", params={"path": "Sun"})).json()
        self.assertEqual(article["title"], "Sun")
        self.assertEqual((await self.client.get("/api/encyclopedia/article", params={"path": "Nowhere"})).status, 404)
        self.assertEqual((await self.client.get("/api/encyclopedia/article", params={"path": "x" * 600})).status, 400)
        self.assertEqual((await self.client.get("/api/encyclopedia/article")).status, 400)
        self.assertIn((await (await self.client.get("/api/encyclopedia/random")).json())["path"], ("Star", "Solar_System", "Hydrogen"))


if __name__ == "__main__":
    unittest.main()
