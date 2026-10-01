#!/usr/bin/env python3
"""Download the official Apache-2.0 small English Vosk model, once."""
import hashlib
import shutil
import tempfile
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NAME = "vosk-model-small-en-us-0.15"
URL = "https://alphacephei.com/vosk/models/" + NAME + ".zip"


def main():
    destination = ROOT / "models" / NAME
    if (destination / "am").is_dir():
        print("Voice model already installed:", destination)
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=destination.parent) as temporary:
        temp = Path(temporary)
        archive = temp / "model.zip"
        print("Downloading the official small English model (about 40 MB)…")
        with urllib.request.urlopen(URL, timeout=60) as response, archive.open("wb") as output:
            shutil.copyfileobj(response, output)
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
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


if __name__ == "__main__":
    main()
