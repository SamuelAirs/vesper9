# VESPER-9 0.2.0 validation

Date: 2026-09-30. Scope: Linux x86-64 development host, simulated ESP32, Python 3.12, Node 24.19.0, Chromium 153.0.8010.0. The application is 0.2.0; the unchanged node firmware is 0.1.0 using protocol v1.

**No physical Pi, node, GPIO, optical timing, real microphone acoustics or OS kiosk deployment was available for this pass.** These results establish software behavior in the stated environment, not hardware qualification or Pi performance.

## Completed checks

| Check | Result | Evidence |
| --- | --- | --- |
| Python regression suite | 29 passed | [Log](validation/v0.2.0/python-tests.txt) |
| JavaScript engine suite | 33 passed | [Log](validation/v0.2.0/javascript-tests.txt) |
| C/Python protocol compatibility | Golden frame matched; host C test compiled with warnings as errors | [Frame](validation/v0.2.0/c-protocol.txt) |
| Browser workflows | All 12 apps exercised; no page errors | [Results](validation/v0.2.0/browser-results.json) |
| Added cartridge | Pulse Garden: catalog, voice alias registration, button launch, persistence, service and standalone hosts passed | [Log](validation/v0.2.0/extension-test.txt) |
| Recorded local speech | Real Vosk inference, saved session, command grammar construction, zero dropped chunks, ended muted | [Log](validation/v0.2.0/speech-test.txt) |
| Integrated service/browser run | 1200.358 seconds; reconnect and timer completed; ended muted with lights cleared | [78 samples](validation/v0.2.0/soak-results.json) |
| Firmware preservation | All 57 firmware files identical to original; four prebuilt checksums verified | [Identity report](validation/v0.2.0/firmware-identity.json) |
| Generated catalog | Checked against authoritative JSON; simulator rebuilt | `scripts/build-catalog.py --check` |

The initial 0.1.0 source also passed its original 17 Python and 14 JavaScript tests before changes. Logs directly under `validation/` are historical; this release's evidence is in `validation/v0.2.0/`.

The Python suite deliberately injects decoder/storage/final-result failures. Its expected ERROR/WARNING lines accompany successful recovery tests. An aiohttp AppKey recommendation is a non-failing warning. Installer checks use an isolated home and simulated systemd behavior; no real service was installed here.

## What the tests establish

Input checks cover click qualification, timing boundaries, source/clock ownership, immediate held game input, partial-sequence cancellation, and reconciliation of released or held buttons across resets. The final browser workflow verifies that an across-reset release only unblocks the switch; the next intended press can select Resume. Morse and Echo have explicit hold-menu policy to protect pulse answers.

Light checks cover cached-zero cleanup, effects, serialized commands and stale acknowledgments. Retired app contexts cannot redirect the console or mutate current lights. Speech tests cover worker failure, independent error notification, mute even if final-result processing fails, and intentional retry. Microphone status distinguishes request from confirmed capture and lost-link uncertainty.

Learning tests exercise saved-progress migration and new lesson modes. Game checks include representative actual-physics jump clearance and a seeded Undertow pilot; these do not replace human balancing. Utility checks cover saved-note paging/selected export, custom timer entry, stable actions, stale sensors, settings-only reset, and preserved score classes.

The main browser run covers all cartridges in the service, new menu gestures, Morse listening, notes, timers, persistence, reconnect/effect cleanup and the generated standalone file. The extension run adds a real example cartridge to an isolated copy; command alias registration is checked, not acoustic recognition of that cartridge's spoken name.

## Integrated run and measured limits

The 20-minute run rotated through all 12 apps, supplied simulated switch input, reconnected the controlling WebSocket halfway through, and observed a background timer expire. Before the timed loop it streamed the public Vosk example WAV through the actual recognizer while a game was open: three saved lines, zero reported dropped chunks, then capture off. The fixture and model are not included in the release.

There were no page or recorded app errors. Sampled outstanding requests never exceeded one; rolling frame-time p95 values ranged from 16.7 to 33.3 ms. The final checks confirmed mute, acquisition off, timer completion and dark LEDs. Recorded frame timing reflects headless browser scheduling; it is **not a Pi benchmark**. Coarse browser heap values do not establish the absence of a memory leak. Neither run collected usable Python RSS data: this development container exposes `/proc` with a different PID mapping from the launched child processes. A guard now prevents accidental sampling of an unrelated process on such hosts. No long-run RSS stability claim is made.

Final held-reset handling, control/status labels and service-upgrade correction were reviewed while the long run was already in progress. The final Python, JavaScript and browser suites cover those changes. The long run is therefore evidence for this implementation pass, not a bit-identical soak of every final file. The [final 20.1-second recovery run](validation/v0.2.0/final-recovery-results.json) used the final application: reconnect passed, the timer expired, lights cleared and capture ended off. This brief follow-up does not substitute for a long memory test.

## Visual review

Current screenshots were captured from the service browser workflow:

- [Dashboard](images/VESPER-9-Dashboard.png)
- [Complete 1280×720 console](images/VESPER-9-720p.png)
- [Signal School listening mode](images/VESPER-9-Signal-School.png)
- [Orbit Lock](images/VESPER-9-Orbit.png)
- [Narrow layout](images/VESPER-9-Mobile.png)

The 720p layout includes status, full game view and the switch deck without vertical clipping in the checked viewport. Actual display scaling, phosphor contrast and touch/button comfort still need a human on the Pi.

## Reproduce and continue

See [TESTING.md](TESTING.md) for commands and [NEXT-STEPS.md](NEXT-STEPS.md) for physical qualification and design limits. Packaging rebuilds the catalog/simulator, excludes environment/model/runtime data, checks ZIP CRCs and verifies every file against SHA-256 manifests. Physical firmware flashing is not part of that verification.
