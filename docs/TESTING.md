# Reproduce the 0.2 checks

Results live in [VALIDATION.md](VALIDATION.md) and `validation/v0.2.0/`.
Original 0.1 development logs remain in the parent `validation/` directory.
All supplied physical/Pi claims are explicitly unverified unless later filled
in by the agent operating that hardware.

## Fast tests

With the project dependencies installed (`bash scripts/install-pi.sh --no-speech` is sufficient):

```bash
.venv/bin/python -m unittest discover -s tests -p 'test_*.py' -v
node --test tests/engine.test.mjs
python3 scripts/build-catalog.py --check
cc -Wall -Wextra -Werror -std=c11 firmware/host-test/protocol_test.c -o /tmp/vesper-protocol-test
/tmp/vesper-protocol-test
cc -Wall -Wextra -Werror -std=c11 -D_DEFAULT_SOURCE firmware/host-test/knock_test.c -lm -o /tmp/vesper-knock-test
/tmp/vesper-knock-test
```

Node 20+ and a C compiler are development tools, not runtime requirements.
The C final frame remains `563901117b00090000010203040506070831f4`, matching
Python's encoder for LEDS, payload `bytes(range(9))`, sequence 123.

The JS suite exercises gesture boundaries and ownership, reconnect, physical
clock domains, late light ACKs, learning migration/modes, game physics,
source-classified scores and truthful microphone status. The Python suite
covers the transport, service, persistence, settings/catalog, note pagination,
speech fault/retry/mute, sensor timestamps, timer wall-clock policy and isolated upgrade preservation/restart.

## Browser workflows and expansion

The runtime UI has no npm dependencies. Optional development automation uses
Playwright and Chromium:

```bash
npm install --no-save playwright
npx playwright install chromium
python3 scripts/build-demo.py
PYTHON="$PWD/.venv/bin/python" node tests/browser-smoke.cjs
PYTHON="$PWD/.venv/bin/python" node tests/extension-smoke.cjs
```

`TEST_BROWSER_BIN` can select an installed Chromium executable; `PLAYWRIGHT_PATH`
can select an existing Playwright module. `TEST_OUTPUT` selects the output
directory, default `test-output/`. The tests use isolated temporary databases
and localhost ports 18979/18983. They never open the real serial node.

The main workflow checks every app, physical-switch-equivalent navigation,
the tap, tap, hold menu gesture, custom timer entry, note/text paging and export,
Morse listening, retired callbacks, simulated recovery, pattern cleanup,
persistence, 720p whole-console fit, narrow-screen width and generated HTML.
The extension test installs Pulse Garden into a temporary copy and proves
catalog/alias registration, button launch, saved count, cleanup and both hosts.

Test-only headless flags must not be copied into the production kiosk. The
supplied kiosk launcher preserves its normal browser sandbox behavior.

## Recorded speech and integrated run

Install the speech extra/model and supply a 16 kHz mono PCM16 WAV file:

```bash
.venv/bin/python tests/speech-smoke.py /path/to/example.wav
PYTHON="$PWD/.venv/bin/python" SOAK_WAV=/path/to/example.wav node tests/soak.cjs
```

The optional `SOAK_WAV` fixture exercises recognition while a game is open.
Without it, the integrated run covers the game/utility/reconnect/timer paths
with capture off. The normal run lasts 1200 seconds; `SOAK_SECONDS` overrides
this for a focused shorter reproduction. It rotates apps, samples frame/RSS/
pending-request information, reconnects the controller, and ends with lights
cleared and capture off. Results are written to `soak-results.json`. RSS samples are nullable when `/proc` is unavailable or its PID mapping differs from the launched processes; do not infer memory stability from absent samples.

The recorded validation uses the Vosk repository's public example recording,
not a personal recording. The model/fixture are not bundled. Normal operation
does not save raw audio. Errors in recognized words remain possible.

## Firmware and physical qualification

The source/protocol and prebuilt node image are unchanged from 0.1.0. Their
original ESP-IDF v5.4.2 build evidence and hashes remain included. Rebuild with
`bash scripts/build-firmware.sh` only after an intended firmware/config change;
refresh images/hashes and requalify the real node afterward.

Use [INSTALL.md](INSTALL.md) and [NEXT-STEPS.md](NEXT-STEPS.md) for the actual
nine-color, button, sensor, microphone, reconnect, display and Pi-load checks.
Compiled firmware and simulated events do not establish electrical behavior.
