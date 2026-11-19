"""The books that ship with the console (books/), carried in the app for The Stacks.

On the console The Stacks asks the Pi's service for the shelf (/api/library) and for one chapter
at a time (/api/library/<id>/<chapter>). The app has no service, so this reads the same EPUBs with
the service's own code (vesper/library.py) and writes what it would answer as scripts beside the
page, which ios/layer/60-library.js loads when The Stacks asks:

    books/shelf.js           the shelf (the service's listing) and where each book's parts begin
    books/<id>/<part>.js     a run of a book's chapters, each as the service gives it

Each script is one call, window.__vesperBooks("<its own file>", {"<path asked>": answer, ...}):
the page is opened from a file and cannot fetch one, but it can add a <script src>. A part holds
consecutive chapters up to about PART bytes (a long chapter is a part alone), so opening a book
reads only a little of it, and the app carries a few dozen files rather than hundreds. Only
Python's standard library and this repository are needed.
"""
import json
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BOOKS = ROOT / "books"
PART = 192 * 1024
# Where The Stacks says "your books go": on the phone there is no folder to put them in.
FOLDER = "THE CONSOLE · THIS APP CARRIES ITS %d CLASSICS"


def library_module():
    sys.path.insert(0, str(ROOT))
    try:
        from vesper import library
    finally:
        sys.path.remove(str(ROOT))
    return library


def text(value):
    data = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    # Valid JSON is a valid script, but for these two characters in old engines.
    return data.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")


def script(name, answers):
    return "window.__vesperBooks(%s,{%s});\n" % (json.dumps(name), ",\n".join(
        json.dumps(path) + ":" + text(answer) for path, answer in answers))


def read():
    """The service's listing and, for each readable book, its chapters as the service answers them."""
    library = library_module()
    with tempfile.TemporaryDirectory() as empty:
        # The person's own folder is empty here, so the listing is the bundled books alone.
        service = library.Library(Path(empty) / "library", media=None, bundled=BOOKS)
        listing = service.listing()
        chapters = {}
        for book in listing["books"]:
            if not book["locked"]:
                chapters[book["id"]] = [service.chapter(book["id"], i) for i in range(len(book["chapters"]))]
    listing["busy"] = None
    listing["folder"] = FOLDER % len(chapters)
    return listing, chapters


def parts(book, chapters):
    """[(first chapter, [(path, chapter), ...]), ...]: consecutive chapters up to PART bytes."""
    out, size = [], 0
    for index, chapter in enumerate(chapters):
        path = "library/%s/%d" % (book, index)
        length = len(text(chapter).encode("utf-8"))
        if not out or size + length > PART:
            out.append((index, []))
            size = 0
        out[-1][1].append((path, chapter))
        size += length
    return out


def files():
    """{name: bytes} of every script, by its name under the Web folder."""
    listing, books = read()
    out, starts = {}, {}
    for book in sorted(books):
        starts[book] = []
        for first, answers in parts(book, books[book]):
            name = "books/%s/%d.js" % (book, first)
            starts[book].append(first)
            out[name] = script(name, answers)
    out["books/shelf.js"] = script("books/shelf.js", [("library", listing), ("parts", starts)])
    return {name: data.encode("utf-8") for name, data in out.items()}


def build(folder):
    target = Path(folder) / "books"
    if target.exists():
        shutil.rmtree(target)
    for name, data in sorted(files().items()):
        out = Path(folder) / name
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(data)


if __name__ == "__main__":
    build(sys.argv[1] if len(sys.argv) > 1 else ROOT / "ios" / "Web")
