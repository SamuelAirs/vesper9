#!/usr/bin/env python3
"""Download the local speech models, once each; anything already present is left alone.

  * the official Apache-2.0 small English Vosk model (live text and voice commands);
  * the optional second-pass dictation model, NVIDIA Parakeet TDT 110m in sherpa-onnx's int8 export
    (CC-BY-4.0, attribution in THIRD_PARTY.md), whose archive is checked against a pinned SHA-256.

  python3 scripts/get-voice-model.py              both
  python3 scripts/get-voice-model.py --no-refine  Vosk only
  python3 scripts/get-voice-model.py --refine-only
"""
import argparse
import hashlib
import shutil
import sys
import tarfile
import tempfile
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NAME = "vosk-model-small-en-us-0.15"
URL = "https://alphacephei.com/vosk/models/" + NAME + ".zip"

REFINE_NAME = "sherpa-onnx-nemo-parakeet_tdt_transducer_110m-en-36000-int8"
REFINE_URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/" + REFINE_NAME + ".tar.bz2"
REFINE_SHA256 = "f628312e9fdf8686374cb01a69425c41732529d540860311f16f37cbc32cfe9b"
REFINE_FILES = ("encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt")
REFINE_EXTRA = ("README.md", "LICENSE", "NOTICE", "LICENSE.txt")      # kept when the archive has them


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        while block := source.read(1 << 20):
            digest.update(block)
    return digest.hexdigest()


def download(url, target):
    with urllib.request.urlopen(url, timeout=60) as response, target.open("wb") as output:
        shutil.copyfileobj(response, output)


def get_vosk():
    destination = ROOT / "models" / NAME
    if (destination / "am").is_dir():
        print("Voice model already installed:", destination)
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=destination.parent) as temporary:
        temp = Path(temporary)
        archive = temp / "model.zip"
        print("Downloading the official small English model (about 40 MB)…")
        download(URL, archive)
        digest = sha256(archive)
        with zipfile.ZipFile(archive) as z:
            for member in z.infolist():
                resolved = (temp / member.filename).resolve()
                if not resolved.is_relative_to(temp.resolve()) or not member.filename.startswith(NAME + "/"):
                    raise ValueError("Unexpected path in model archive")
            z.extractall(temp)
        if destination.exists():
            raise SystemExit("An incomplete destination exists. Rename it before retrying: " + str(destination))
        shutil.move(str(temp / NAME), destination)
        (destination / "download-sha256.txt").write_text(digest + "  " + URL + "\n")
    print("Local speech is ready:", destination)


def refine_complete(directory):
    return all((directory / name).is_file() and (directory / name).stat().st_size > 0 for name in REFINE_FILES)


def get_refine():
    destination = ROOT / "models" / REFINE_NAME
    if refine_complete(destination):
        print("Second-pass dictation model already installed:", destination)
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=destination.parent) as temporary:
        temp = Path(temporary)
        archive = temp / "model.tar.bz2"
        print("Downloading the second-pass dictation model (about 108 MB, CC-BY-4.0, NVIDIA)…")
        download(REFINE_URL, archive)
        digest = sha256(archive)
        if digest != REFINE_SHA256:
            raise SystemExit("The second-pass model archive does not match the pinned SHA-256 and was discarded.\n"
                             "  expected " + REFINE_SHA256 + "\n  received " + digest)
        staged = temp / "staged"
        staged.mkdir()
        wanted = {REFINE_NAME + "/" + name: name for name in (*REFINE_FILES, *REFINE_EXTRA)}
        with tarfile.open(archive, "r:bz2") as tar:
            for member in tar:
                # Only the named regular files are read; nothing else in the archive is written anywhere.
                if member.name in wanted and member.isreg():
                    with tar.extractfile(member) as source, (staged / wanted[member.name]).open("wb") as output:
                        shutil.copyfileobj(source, output)
        if not refine_complete(staged):
            raise SystemExit("The second-pass model archive is missing files: " + ", ".join(n for n in REFINE_FILES if not (staged / n).is_file()))
        (staged / "download-sha256.txt").write_text(digest + "  " + REFINE_URL + "\n")
        if destination.exists():
            shutil.rmtree(destination)       # only an incomplete earlier attempt can be here
        shutil.move(str(staged), destination)
    print("Second-pass dictation is ready:", destination)
    print("Install its Python package too:  .venv/bin/pip install -e '.[refine]'")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--no-refine", action="store_true", help="fetch only the Vosk model")
    parser.add_argument("--refine-only", action="store_true", help="fetch only the second-pass model")
    args = parser.parse_args()
    if args.no_refine and args.refine_only:
        sys.exit("Choose at most one of --no-refine and --refine-only")
    if not args.refine_only:
        get_vosk()
    if not args.no_refine:
        get_refine()


if __name__ == "__main__":
    main()
