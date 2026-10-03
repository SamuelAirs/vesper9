#!/usr/bin/env python3
"""Download an offline Wikipedia for the Encyclopedia app: a Kiwix ZIM file, checked against the
SHA-256 Kiwix publishes next to it. Interrupted downloads resume. Run on the console:

  python3 scripts/get-encyclopedia.py                  # Simple English Wikipedia, no pictures
  python3 scripts/get-encyclopedia.py --flavour en_top_mini    # a smaller selection of English Wikipedia
  python3 scripts/get-encyclopedia.py --list           # what is on offer, with sizes

It also needs the reader library: .venv/bin/pip install -e '.[encyclopedia]'
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = "https://download.kiwix.org/zim/wikipedia/"
MAX_DOWNLOAD = 2 * 1024 ** 3
DISK_RESERVE = 64 * 1024 ** 2
MAX_INDEX = 2 * 1024 ** 2


def listing():
    with urllib.request.urlopen(INDEX, timeout=30) as response:
        body = response.read(MAX_INDEX + 1)
    if len(body) > MAX_INDEX:
        raise ValueError("archive listing is too large")
    return body.decode("utf-8", "replace")


def latest(flavour):
    if flavour.startswith("simple_"):  # Accept the original console's spelling.
        flavour = "en-simple_" + flavour[7:]
    if not re.fullmatch(r"[a-z][a-z0-9_-]{0,60}", flavour):
        raise ValueError("invalid archive flavour")
    names = sorted(set(re.findall(r'href="(wikipedia_%s_(\d{4}-\d{2})\.zim)"' % re.escape(flavour), listing())), key=lambda n: n[1])
    if not names:
        raise ValueError("No wikipedia_%s_*.zim in %s (try --list)" % (flavour, INDEX))
    return names[-1][0]


def offered():
    rows = re.findall(r'href="(wikipedia_(?:en|en-simple)_[a-z_]+_\d{4}-\d{2}\.zim)".*?(\d+(?:\.\d+)?[KMG])\s*$', listing(), re.M)
    for name, size in rows:
        print("%-60s %s" % (name, size))


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        while block := source.read(1 << 22):
            digest.update(block)
    return digest.hexdigest()


def published_hash(url):
    with urllib.request.urlopen(url + ".sha256", timeout=30) as response:
        raw = response.read(1025)
    value = raw.decode("ascii").split()[0] if raw else ""
    if len(raw) > 1024 or not re.fullmatch(r"[0-9a-fA-F]{64}", value):
        raise ValueError("the published SHA-256 is invalid")
    return value.lower()


def download(url, target, max_bytes=MAX_DOWNLOAD):
    """Bounded streaming; incomplete bytes remain .part for a later retry."""
    target = Path(target)
    if target.is_symlink():
        raise ValueError("partial archive must not be a symbolic link")
    have = target.stat().st_size if target.exists() else 0
    if have > max_bytes:
        raise ValueError("partial archive exceeds the download limit")
    request = urllib.request.Request(url, headers={"Range": "bytes=%d-" % have} if have else {})
    with urllib.request.urlopen(request, timeout=60) as response:
        length = response.headers.get("Content-Length", "")
        if not length.isdecimal():
            raise ValueError("archive size is missing or invalid")
        remaining = int(length)
        if response.status == 206:
            match = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+)", response.headers.get("Content-Range", ""))
            if not match or int(match[1]) != have or int(match[2]) < have or int(match[3]) != int(match[2]) + 1 or remaining != int(match[2]) - have + 1:
                raise ValueError("archive resume range is invalid")
            total = int(match[3])
        elif response.status == 200:
            have, total = 0, remaining
        else:
            raise ValueError("unexpected archive response")
        if total <= 0 or total > max_bytes:
            raise ValueError("archive exceeds the download limit")
        if shutil.disk_usage(target.parent).free < remaining + DISK_RESERVE:
            raise ValueError("not enough disk space for the archive and safety reserve")
        print("Downloading %s (%.0f MB)…" % (url.rsplit("/", 1)[-1], total / 1e6))
        shown = -1
        with target.open("ab" if have else "wb") as output:
            while block := response.read(min(1 << 20, total - have + 1)):
                if have + len(block) > total:
                    raise ValueError("archive response exceeds its declared size")
                output.write(block)
                have += len(block)
                if total and int(have * 20 / total) != shown:
                    shown = int(have * 20 / total)
                    print("  %3d%%  %.0f MB" % (have * 100 / total, have / 1e6), flush=True)
            output.flush()
            os.fsync(output.fileno())
        if have != total:
            raise ValueError("archive response was truncated; partial download kept")
    return total


def install_archive(folder, name, max_bytes=MAX_DOWNLOAD):
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    if not re.fullmatch(r"wikipedia_[a-z0-9_-]+_\d{4}-\d{2}\.zim", name):
        raise ValueError("invalid archive filename")
    lock = folder / (name + ".lock")
    try:
        with lock.open("x", encoding="ascii") as held:
            held.write(str(os.getpid()))
    except FileExistsError as error:
        raise ValueError("archive setup is already running; if interrupted, remove its .lock file before retrying") from error
    try:
        return _install_archive(folder, name, max_bytes)
    finally:
        lock.unlink()


def _install_archive(folder, name, max_bytes):
    url, final, partial = INDEX + name, folder / name, folder / (name + ".part")
    expected = published_hash(url)
    if final.exists():
        if final.is_symlink() or final.stat().st_size > max_bytes or sha256(final) != expected:
            raise ValueError("existing archive does not match the published checksum; it was preserved")
        print("Already installed and verified:", final)
        return final
    if partial.is_symlink():
        raise ValueError("partial archive must not be a symbolic link")
    if partial.exists() and partial.stat().st_size <= max_bytes and sha256(partial) == expected:
        total = partial.stat().st_size
    else:
        total = download(url, partial, max_bytes)
    print("Checking…")
    if sha256(partial) != expected:
        raise ValueError("checksum mismatch; partial archive kept. Remove or move its .part file before retrying")
    # Same-folder hard linking publishes verified bytes atomically without
    # overwriting an existing archive, including one another installer just made.
    os.link(partial, final)
    partial.unlink()
    (folder / (name + ".sha256")).write_text(expected + "  " + name + "\n", encoding="ascii")
    (folder / (name + ".source.json")).write_text(json.dumps({"url": url, "sha256": expected, "bytes": total}, indent=2), encoding="utf-8")
    print("Installed:", final)
    return final


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--flavour", default="simple_all_nopic", help="the part after wikipedia_ (default simple_all_nopic)")
    parser.add_argument("--data", default=str(ROOT / "data" / "console"), help="the console's data folder")
    parser.add_argument("--list", action="store_true", help="list the English files on offer")
    parser.add_argument("--max-bytes", type=int, default=MAX_DOWNLOAD, help="download size ceiling (default 2 GiB)")
    args = parser.parse_args()
    try:
        if args.max_bytes <= 0:
            raise ValueError("download limit must be positive")
        if args.list:
            offered()
        else:
            install_archive(Path(args.data) / "encyclopedia", latest(args.flavour), args.max_bytes)
            print("Open the Encyclopedia and choose CHECK AGAIN; no service restart is needed.")
    except (OSError, ValueError, UnicodeError) as error:
        parser.exit(1, "Encyclopedia setup: %s\n" % error)


if __name__ == "__main__":
    main()
