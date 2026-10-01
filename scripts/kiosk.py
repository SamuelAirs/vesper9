#!/usr/bin/env python3
"""Wait for the local service before opening the dedicated console browser."""
import os
import shutil
import time
import urllib.request
from pathlib import Path

chromium = shutil.which("chromium") or shutil.which("chromium-browser")
if not chromium:
    raise SystemExit("Chromium is not installed")
for attempt in range(120):
    try:
        with urllib.request.urlopen("http://127.0.0.1:8799/api/state", timeout=1) as response:
            if response.status == 200:
                break
    except OSError:
        pass
    time.sleep(.25)
else:
    raise SystemExit("VESPER service did not start; check journalctl --user -u vesper.service")
profile = Path.home() / ".config/vesper9/chromium"
os.execv(chromium, [chromium, "--kiosk", "--no-first-run", "--autoplay-policy=no-user-gesture-required",
                   "--user-data-dir=" + str(profile), "http://localhost:8799"])
