#!/usr/bin/env python3
"""Pack Standard Ebooks source repositories into the text-only EPUBs that ship in books/.

    git clone --depth 1 https://github.com/standardebooks/h-g-wells_the-time-machine
    python3 scripts/pack-books.py h-g-wells_the-time-machine [more clones ...]

Each clone becomes books/<repository name>.epub: the text without illustrations or fonts (the
console reads text only). Standard Ebooks dedicate their editions to the public domain (CC0).
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from vesper.library import pack_source, parse_book  # noqa: E402


def main(clones):
    out = ROOT / "books"
    out.mkdir(exist_ok=True)
    for clone in map(Path, clones):
        files = {str(p.relative_to(clone.parent)).replace("\\", "/"): p.read_bytes()
                 for p in (clone / "src").rglob("*") if p.is_file()}
        target = out / (clone.name + ".epub")
        target.write_bytes(pack_source(files))
        meta, chapters = parse_book(target)
        print(f"{target.name}: {meta['title']} / {meta['author']}, {len(chapters)} sections, {target.stat().st_size // 1024} KiB")


if __name__ == "__main__":
    main(sys.argv[1:])
