# VESPER-9 0.2.0 validation

> Current finished-node candidate (2026-10-02): see [candidate status and product decisions](NODE-CONSOLE-CANDIDATE.md). Developed and verified on Windows; Pi deployment and physical acceptance remain pending. Older implementation/firmware/sensor notes below describe their historical snapshots.

## Extended console polish — 2026-10-03

Native Windows `DESKTOP-FD66EV2`, branch `codex/console-polish`, parent candidate
`b818558`. All agents were GPT-6.1 Sol. No Pi connection, deployment, restart,
firmware build or flash occurred during this pass.

| Check | Fresh result |
| --- | --- |
| `scripts/check.py` | Exit 0: 275 Python tests (273 pass, 2 expected skips); 1,508 JS tests pass; generated catalog fresh |
| High Bar | 73 focused tests; 12 real-control recorded routes replayed in SESSION, their timed LINE RUN, and PRACTICE (36 route/mode combinations) |
| Existing game audit | Eight games reviewed; 219 focused regressions including 16 new Ricochet practice/progression tests; actual physics pilots for Ricochet rooms 1/4/9 and Moonrunner zones 1/4/6 |
| Save queue | 23 focused tests: bounded immutable snapshots/baselines, score maximum, coalescing, ACK generations, rejection/retry, explicit discard and conflicting service state |
| Save browser | 10 complete scenarios pass against a real isolated service and independent SQLite connection, including delayed initial state, offline pause saves, ordinary reconnect, observer ownership, both confirmed conflict choices, an unseen intervening controller, retired context/clear, rejection and recovery |
| Release browser regression | 35-app service/standalone smoke, extension example, host 36/36, injected voice 37/37 and Twinbeat 29/29 pass on the final runtime |
| Utilities | 109 focused JS and 21 Python checks pass; 25 real-host browser checks use the staged real Wikipedia archive and private book/timer fixtures |
| Game browser | 21 Ricochet/High Bar journey checks and 12 screenshots at 1024×600; no injected physical-device claims |
| Sustained final rotation | 1200.64 seconds, 35/35 apps, 78 samples; reconnect and timer complete, no app/page errors, ends muted; same source hash as the package |

Final evidence is under `C:/Users/ayers/vesper9-investigation/polish/`:
`release-check.log`, `save-verified/`, `release-browser/`, and `release-soak/`.
The final worklog records the completed soak and release artifacts. Earlier
pre-fix results remain under their own names. Two attempted soaks were stopped
when runtime fixes were added; they are not counted as completed long runs.

The Python skips remain the missing local Vosk model vocabulary and the POSIX
shutdown check unavailable on Windows. Synthetic controls and deterministic
routes establish software behavior and reachability, not physical case timing,
human difficulty, real lamps, speech recognition or Pi frame/thermal behavior.

## Twinbeat follow-up verification — 2026-10-03

The second requested new game, [Twinbeat](TWINBEAT.md), is implemented on the same
Windows development branch. No Pi access, deployment or firmware change occurred
in this follow-up. These results supersede the software counts of the initial
candidate below; its Pi observations remain an earlier read-only snapshot.

| Check | Fresh result |
| --- | --- |
| `scripts/check.py` | Exit 0: 274 Python tests, 2 expected skips; 1,421 JS tests pass; catalog freshness passes |
| Twinbeat deterministic tests | 33/33: eight charts with side/generic/button play, estimated native arrival delay, score/unlock separation, practice, wrong/duplicate taps, cleanup, all three gesture paces during play and across finish |
| Twinbeat real-host browser | 29/29: timed assist and calibrated simulated-side clears, separate durable scores, reload/unlocks, live calibration status, menu rollback/resume, custom actions, 1024×600 fit, no page errors |
| Existing browser smoke | 35 registered apps, service and standalone, pass with no page errors |
| Existing host browser | 34/34 pass, including the preserved low-tone filter and source/score separation |
| Visual review | Both lanes, home, result, pause/count-in and both manual pages at 1024×600 |
| Service score regression | Real WebSocket commands, API state and independent database connection verify Twinbeat assist/sides, High Bar style-v2 and Wayfinder region-0/1/2; invalid cross-game classes remain rejected |

Evidence: `C:/Users/ayers/vesper9-investigation/wave/twinbeat-final-check.log`,
`twinbeat-browser/` and `twinbeat-regressions/`. An initial browser failure exposed
the missing service score classes; its historical log is retained separately.
The service simulator needs synthetic left/right calibration before its J/L
events can exercise the classifier. This establishes the software path only.
Case accuracy, speaker-induced taps, acoustic timing and Pi rendering still
require the physical acceptance steps in [PI-ACCEPTANCE.md](PI-ACCEPTANCE.md).

## Initial Windows candidate verification — 2026-10-03

Host: Windows `DESKTOP-FD66EV2`; Python 3.11.5, Node 24.21.0, Chrome 154,
Playwright 1.57, libzim 3.13.0. Development branch: `codex/node-console` in
`C:\Users\ayers\vesper9-development`. The release manifest records the committed
source identity; this working branch is not GitHub main or the Pi's live source.

| Check | Fresh result |
| --- | --- |
| `scripts/check.py` | Exit 0: 273 Python tests, 2 expected skips; 1,379 JS tests all pass; catalog freshness passes |
| Python skips | Local Vosk model vocabulary unavailable; POSIX graceful SIGTERM cannot be established on Windows |
| Browser smoke | All 34 registered apps, service and standalone, no page errors |
| Browser extension | Source/catalog/voice registration, button launch, persistence, service and standalone pass |
| Browser host | 34/34, including burst and held-terminal gesture rollback, single cancellation, reverse navigation, low-tone gate and score classes |
| Injected voice events | 37/37; this does not validate acoustic speech recognition |
| Soak | 60.195 seconds, passes, ends muted; no Pi benchmark claim |
| Real Encyclopedia | Verified 1,094,936,257-byte Kiwix archive, 400,061 articles; Sun→Star, random lookup, bookmarks/trail across reload pass |
| Layout | Windows Chrome 1024×600 screenshots of dashboard, Node Scope, games and utilities reviewed |
| Firmware | No firmware source/config/binary changes, builds or flashing |

Evidence is retained outside Git at
`C:\Users\ayers\vesper9-investigation\wave`: `final-check.log`,
`browser-reviewed/summary.json`, `browser-reviewed/host-browser.json`,
`utilities-newgame-report.md`, `highbar-report.md`, `game-node-report.md`,
`service-report.md`, and the screenshot directories. Later review corrected a
double-cancel bar release, a paid-survey softlock, legacy demo lamp mapping,
retained ZIM exception references and Windows' coarse simulator clock. Their
regressions are in the final passing suite. Earlier failing logs are historical.

A centralized read-only Pi check at 2026-10-03 04:54:04 UTC found the same live
`f3bfacc`, service PID 1128, one browser client, connected node 0.2.0, microphone
off/capture false, zero CRC/missing samples, 55.6°C and no throttling. Pi `main`
and GitHub `main` remain `5db9ae8`; node2 remains `b9079f1`. aarch64/glibc 2.41
matches the staged reader wheel's platform requirements; its import on the Pi
is still untested. No deployment/restart/flash occurred.

## Historical validation


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
