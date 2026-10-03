#!/usr/bin/env python3
"""Download an offline Wikipedia for the Encyclopedia app: a Kiwix ZIM file, checked against the
SHA-256 Kiwix publishes next to it. Interrupted downloads resume. Run on the console:

  python3 scripts/get-encyclopedia.py                  # Simple English Wikipedia, no pictures
  python3 scripts/get-encyclopedia.py --flavour en_top_nopic   # a smaller selection of English Wikipedia
  python3 scripts/get-encyclopedia.py --list           # what is on offer, with sizes

It also needs the reader library: .venv/bin/pip install -e '.[encyclopedia]'
"""
import argparse
import hashlib
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = "https://download.kiwix.org/zim/wikipedia/"


def latest(flavour):
    with urllib.request.urlopen(INDEX, timeout=60) as response:
        listing = response.read().decode("utf-8", "replace")
    names = sorted(set(re.findall(r'href="(wikipedia_%s_(\d{4}-\d{2})\.zim)"' % re.escape(flavour), listing)), key=lambda n: n[1])
    if not names:
        sys.exit("No wikipedia_%s_*.zim in %s (try --list)" % (flavour, INDEX))
    return names[-1][0]


def offered():
    with urllib.request.urlopen(INDEX, timeout=60) as response:
        listing = response.read().decode("utf-8", "replace")
    rows = re.findall(r'href="(wikipedia_en_[a-z_]+_\d{4}-\d{2}\.zim)".*?(\d+(?:\.\d+)?[KMG])\s*$', listing, re.M)
    for name, size in rows:
        print("%-60s %s" % (name, size))


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        while block := source.read(1 << 22):
            digest.update(block)
    return digest.hexdigest()


def download(url, target):
    have = target.stat().st_size if target.exists() else 0
    request = urllib.request.Request(url, headers={"Range": "bytes=%d-" % have} if have else {})
    with urllib.request.urlopen(request, timeout=120) as response:
        if have and response.status != 206:
            have = 0            # the server ignored the range: start again
        total = have + int(response.headers.get("Content-Length") or 0)
        print("Downloading %s (%.0f MB)…" % (url.rsplit("/", 1)[-1], total / 1e6))
        shown = -1
        with target.open("ab" if have else "wb") as output:
            while block := response.read(1 << 20):
                output.write(block)
                have += len(block)
                if total and int(have * 20 / total) != shown:
                    shown = int(have * 20 / total)
                    print("  %3d%%  %.0f MB" % (have * 100 / total, have / 1e6), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--flavour", default="simple_all_nopic", help="the part after wikipedia_ (default simple_all_nopic)")
    parser.add_argument("--data", default=str(ROOT / "data" / "console"), help="the console's data folder")
    parser.add_argument("--list", action="store_true", help="list the English files on offer")
    args = parser.parse_args()
    if args.list:
        offered()
        return
    name = latest(args.flavour)
    folder = Path(args.data) / "encyclopedia"
    folder.mkdir(parents=True, exist_ok=True)
    final = folder / name
    if final.exists():
        print("Already installed:", final)
        return
    url = INDEX + name
    with urllib.request.urlopen(url + ".sha256", timeout=60) as response:
        expected = response.read().decode().split()[0].lower()
    partial = folder / (name + ".part")
    download(url, partial)
    print("Checking…")
    if sha256(partial) != expected:
        partial.unlink()
        sys.exit("Checksum mismatch: the download was removed; run again.")
    partial.rename(final)
    print("Installed:", final)
    print("Open the Encyclopedia on the console (the service picks it up without a restart).")


if __name__ == "__main__":
    main()
