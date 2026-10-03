# Reproduce the 0.2 checks

## Current Windows development workflow

Use Python 3.11+ and Node 24. The Pi is the target; development tools and broad
tests run on Windows. Start in the development checkout, preserve production data,
and use a private virtual environment:

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -e '.[encyclopedia]'
$env:NODE = (Get-Command node).Source
.venv\Scripts\python scripts/check.py
```

Optional browser checks need the Node Playwright module and Chrome/Chromium. An
existing installation can be selected with `PLAYWRIGHT_PATH` and
`TEST_BROWSER_BIN`; no browser download is needed when Chrome is already installed.

```powershell
npm install --no-save --package-lock=false playwright
$env:TEST_BROWSER_BIN = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
.venv\Scripts\python scripts/check-browser.py
```

The runner builds the catalog and standalone simulator, then runs app smoke,
extension, host, injected voice-event, Twinbeat, save recovery, utility and game
journeys, and a 60-second smoke soak. Logs and JSON go
to ignored `test-output/browser/`; `--only host-browser` selects one check.
`scripts/check.py` runs native Python/JS regressions with time limits. Vosk's
model-vocabulary check is skipped without a local model, and Windows cannot prove
the POSIX graceful-SIGTERM check. GitHub CI defines Windows/Linux jobs; local
results do not imply that remote CI has run.

The browser runner also includes `--only twinbeat-browser` for the two-lane
drumming game's actual host routing, separate assist/side records, progression,
pause/resume and 1024×600 layout. These use simulated/keyboard input and private
data, not the physical microphones. `tests/twinbeat.test.mjs` covers chart timing,
judgement and campaign rules deterministically.

`--only save-browser` exercises real service/database acknowledgement, initial
state loading, disconnected saves, competing controllers, both confirmed save
choices, changed baselines, rejection and retry. `--only utility-polish` covers
Stacks/Lantern/Cadence and optional real Encyclopedia journeys; set `VESPER_ZIM`
to an existing archive to include the latter. It links/copies that archive into
private test data and never edits the source archive. `--only game-polish-browser`
checks Ricochet practice and High Bar teaching/menu flows.

`--only highbar-controls-browser` verifies held grabs, two-press flips,
case shove-it/kickflip, menu cancellation and all four parks through real
keyboard inputs. `--only highbar-mastery-browser` checks every route brief,
ordered upper routes, finite attempt results/retry/next, all three historical
score archives, optional practice isolation and screen/lamp consistency. It
also records 240 update/draw samples per park with Chrome CPU throttling at 4x;
those measure Windows JavaScript/Canvas submission, not Pi or GPU frame time.
The old `highbar-refresh-browser` and `highbar-airflow-browser` commands now
delegate to the current controls journey; their earlier reports are historical.
Deterministic ordinary-drop-in target/gold recordings live in
`tests/helpers/highbar-flow-routes.mjs`; the High Bar `.test.mjs` files
cover route physics and source-owned gesture cancellation separately.

`--only cairn-browser` follows all 30 shelves through actual keyboard events
and deterministic host frames, checks menu rewind and milestone-only reload,
and captures all four regions. See [CAIRN](CAIRN.md) for timing and limitations.
The app smoke also mounts every factory in the generated standalone file,
independently of the source service's module graph.

The short soak is a smoke check, not full-catalog sustained coverage. For the
release rotation through every registered app, use:

```powershell
.venv\Scripts\python scripts/check-browser.py --only soak --soak-seconds 1200
```

It records source identity, visited apps, frame/heap samples, a WebSocket
reconnect, timer completion and microphone-off state. Results are Windows
simulator evidence, not Pi measurements. RSS is null where the runner cannot
establish a matching Linux process; it does not substitute another PID's memory.

Each browser test starts its own loopback service on a free port and temporary
database. Port 8799 is rejected as an explicit test port. Cleanup terminates only
that test's owned process tree, including the Windows Python venv launcher, before
removing its private temporary directory. Do not point these tests at the Pi.

For a display-sized capture, set `PYTHON` to the virtual environment interpreter
and use `node scripts/dev-shot.cjs --size 1024x600 --steps "shot:dashboard"`.
Images prove layout/rendering, not optical/acoustic behavior, physical tap accuracy
or Raspberry Pi frame rate. See [candidate acceptance](PI-ACCEPTANCE.md).

## Historical validation commands

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

The finished node last reported firmware 0.2.0. Protocol v1 remains compatible;
the bundled 0.1.2 prebuilt is for the older board and must not be flashed onto
the finished four-lamp node. Its historical build evidence and hashes remain
included. Rebuild with
`bash scripts/build-firmware.sh` only after an intended firmware/config change;
refresh images/hashes and requalify the real node afterward.

Use [INSTALL.md](INSTALL.md) and [NEXT-STEPS.md](NEXT-STEPS.md) for the actual
four-lamp, board-accent, button, case-tap, microphone, reconnect and display checks.
The current node has no temperature/humidity sensor. Take only brief Pi status
observations during normal play; keep broad testing and builds on Windows.
Compiled firmware and simulated events do not establish electrical behavior.
