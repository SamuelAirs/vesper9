#!/usr/bin/env python3
"""Wait for the local service before opening the dedicated console browser."""
import os
import shutil
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

URL = "http://localhost:8799"

chromium = shutil.which("chromium") or shutil.which("chromium-browser")
if not chromium:
    raise SystemExit("Chromium is not installed")
target = URL
for attempt in range(720):  # three minutes: a slow SD-card check or a restart at login
    try:
        with urllib.request.urlopen("http://127.0.0.1:8799/api/state", timeout=1) as response:
            if response.status == 200:
                break
    except OSError:
        pass
    time.sleep(.25)
else:
    # Do not leave a blank desktop: say so on the screen and keep trying from inside the browser.
    print("VESPER service did not answer for three minutes; check: journalctl --user -u vesper.service", file=sys.stderr)
    page = ("<!doctype html><meta charset=utf-8><title>VESPER-9</title><body style=\"background:#000;color:#fb3;"
            "font:24px monospace;padding:40px\"><h1>VESPER-9 SERVICE NOT RESPONDING</h1><p>Retrying every 3 seconds.</p>"
            "<p>Check: journalctl --user -u vesper.service</p><script>setInterval(()=>fetch('" + URL +
            "/api/state',{mode:'no-cache'}).then(r=>{if(r.ok)location.href='" + URL + "'}).catch(()=>{}),3000)</script>")
    target = "data:text/html;charset=utf-8," + urllib.parse.quote(page)
profile = Path.home() / ".config/vesper9/chromium"
os.execv(chromium, [chromium, "--kiosk", "--no-first-run", "--autoplay-policy=no-user-gesture-required",
                   "--user-data-dir=" + str(profile), target])
