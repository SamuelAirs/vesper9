# VESPER-9 second implementation pass

2026-09-30. Starting from the verified 0.1.0 Codex handoff in a separate working copy. This host is Linux x86-64; the user's Raspberry Pi and physical node are unavailable. No flashing or Pi deployment is claimed. Existing firmware and pin mapping will remain unchanged unless a demonstrated protocol requirement requires it.

Goals: rapid-click menus with explicit Morse/Echo exceptions; resilient light/input/speech ownership; three learning modes; useful timer/note workflows; focused game progression and feedback; one cartridge catalog; rebuilt simulator and complete release.

The original source confirms that the light cache does not invalidate for node effects, reconnect ignores reported button state, and a failed speech worker can retain its task reference. These paths receive regression checks in this pass. Original baseline tests are run before changing code. Physical comfort, microphone quality, optical timing and Pi performance remain qualification tasks for the on-Pi agent.

## Implemented in application/service 0.2.0

The original baseline passed 17 Python and 14 JavaScript tests before changes. The complete source and simulator were then developed together; this is not just a list of instructions for a later agent.

The input router keeps game edges immediate while recognizing qualified three/four-click escapes with source, clock and scene ownership. A click already delivered to a game cannot be taken back; Morse and Echo therefore use an explicit hold exception. Settings expose timing presets instead of hiding the tradeoff. Final review found that a second scene cancellation could erase the “wait for release” state after a node reset. That state now survives ordinary cancellation, with both a unit regression and an actual host workflow check.

A shared light director now serializes effect and cleanup commands and treats cached LED values as belonging to a particular owner/generation. This resolves the deceptively subtle case where an old zero-value cache could leave a newer node effect lit. Tests also exercise delayed acknowledgments, so an old command cannot certify new-owner state. App-context mutations are guarded after a cartridge is retired.

Speech faults now stop acquisition and close the active session through a separate failure path; retry is intentional. Requested microphone mode, confirmed acquisition, errors and link uncertainty have separate displayed meanings. Recorded Vosk recognition was exercised and text saved, but some words were wrong: a successful recognition pipeline is not an accuracy guarantee.

One JSON catalog supplies the generated browser registry, backend IDs, voice aliases, defaults and control policy. The Pulse Garden example was installed into an isolated copy, then launched by switch navigation and persisted in both the service and standalone hosts. This is a useful hidden improvement: an added cartridge no longer requires several unrelated lists to agree by hand. Its implementation class still needs an explicit factory mapping; plugins are trusted project code.

Signal School now has guided, listening and adaptive-review modes with incremental saved character progress and ten-answer sessions. The utilities gained custom timer entry and labelled presets, old-note/text paging and selected export, sensor age, a diagnostic export and a settings-only reset. Each game received a focused progression or feedback change with stored field records. Runner clearance and a seeded Undertow pilot exercise the actual physics rather than just checking constants.

The 1280×720 console now keeps status, game and switch together. Visual review caught a listening-mode control label that still described keying; the mode now updates the persistent deck. The final browser pass captures the corrected layout and checks it alongside all app workflows.

The service installer preserves previous VESPER configuration and accepts the existing data directory. Review also caught that systemd “enable --now” would leave an already-running old checkout alive. Installation now explicitly restarts the unit; isolated installer tests cover active-service replacement, preserved files/data, and a missing kiosk dependency before writes. No real user service was changed here.

## Evidence and remaining dissatisfaction

See VALIDATION.md and validation/v0.2.0/ for exact counts and integrated-run results. All execution was on a Linux x86-64 development host with a simulated node. The firmware source, binaries and build metadata remain byte-identical to the original release; no new firmware build, flash, electrical test or Pi benchmark is implied.

The games still need human balancing on the real arcade switch. The review scheduler is a small attempt/streak scheduler, not a full educational curriculum. Dictation has no editor or search, and a very long unbroken paragraph can still need scrolling. Four-click menus cannot distinguish every intended game rhythm. Real microphone gain, USB recovery, display legibility and Pi load are the next evidence needed, not more speculative features. NEXT-STEPS.md and the root Codex prompt make those observations the next implementation pass.

The long integrated run was started while final review continued. The final held-reset fix, control/status wording, and installer restart correction were checked by their focused regressions and final browser/unit passes afterward; the long-run evidence is not presented as a bit-identical soak of every final file.

## 2026-09-30 — first inspection on the actual Pi

- Extracted the release zip to `~/VESPER-9-v0.2.0-Claude`; all 154 handoff-manifest hashes match. No earlier VESPER checkout, data, service or autostart entry exists on this Pi.
- Pi 5 Model B Rev 1.1, 8 GB, Debian 13 (trixie) aarch64, Python 3.13.5, Node 20.20.2, Chromium 151. X11 session on HDMI-1 at **1024 × 600**, smaller than the 1280 × 720 the layout was checked at. Default sink is HDMI. Desktop autologin for `sam` and user lingering were already enabled. No throttling, 54.9 °C, EXT5V 4.93 V.
- Local runs: JavaScript engine suite 33/33, catalog check clean, C protocol golden frame `563901117b00090000010203040506070831f4`, four prebuilt firmware checksums OK. The Python suite has not run here: the dependency install has not been performed.
- Node: the cable was first on the native USB port (`303a:1001`), which re-enumerated 255 times in the first four minutes after boot. Moved to COM: CH343 `1a86:55d3`, `/dev/serial/by-id/usb-1a86_USB_Single_Serial_5CE5125730-if00`.
- **The node is not running VESPER firmware.** At 921600 baud no protocol v1 frame decodes. At 115200 it prints an ESP32-S3 ROM banner followed by `room-3.1 boot … | psram 8189 KB`, `SHT3x found`, `Wi-Fi up: 192.168.1.224`, `reading t=24.5 rh=41.9 -> 200`. It is a Wi-Fi room sensor program that posts readings. Opening the COM port resets the board each time.
- Nothing has been flashed and no backup has been read. Using VESPER on this node means replacing `room-3.1`; that is waiting on Sam's decision.

## 2026-09-30 — node backup, corrected pin map, firmware 0.1.1

- Dependencies and the small Vosk model installed with `scripts/install-pi.sh`. On this Pi: Python suite 29/29, JavaScript 33/33, catalog check clean, C golden frame unchanged.
- Full 16 MB backup of the previous `room-3.1` program read twice over COM with identical SHA-256; kept as `backups/node-room-3.1-20260930.bin` with `backups/RESTORE.txt`. It holds that program's Wi-Fi credentials and must stay out of releases. Chip: ESP32-S3 rev v0.2, 8 MB PSRAM, 16 MB flash, MAC 30:30:f9:18:af:14.
- ESP-IDF v5.4.2 (commit f5c3654a) installed in `~/esp/esp-idf-v5.4.2`. Two local traps: the zip's files were dated ~30 minutes in the future, which made ninja re-run CMake forever until they were touched; and PlatformIO's Python environment on PATH makes `install.sh`/`export.sh` refuse to run. `scripts/node-dev.sh` strips it.
- **The supplied pin map was wrong for this board.** With it, no sensor answered at any address or speed. Disassembly of the backed-up program showed `Wire.begin(13, 14)` and a pull-up input on GPIO12; Sam then supplied the wiring table: lights 7/15/16, 17/18/8, 9/10/11; switch between GPIO12 and GPIO46; SHT3x on 13/14; mic 4/5/6. `hardware.h` now matches and firmware drives GPIO46 low as the switch return. Under the old map firmware 0.1.0 would have driven the sensor bus and the switch pin as LED outputs. No LED command other than all-off was sent while the wrong map was flashed.
- Firmware 0.1.1 (protocol v1 unchanged): corrected pins; protocol also served on native USB Serial/JTAG with replies on the last active link (not yet tested on the native port); sensor addressed directly and accepted on CRC-valid data, with diagnostics in STATUS; microphone start-up discard (300 ms) and DC-blocking high-pass. Secondary USB console disabled so no text can mix into the binary link.
- Measured over COM: SHT3x at 0x44, 22.0 °C / 48 % RH, 3 good / 0 failed; microphone 16 kHz, no missing samples, zero host CRC errors. Before the filter the first 0.1 s averaged −16818 counts with full-scale spikes and took over 3 s to settle; after it the mean is within about 300 counts from the first sample and near zero after 0.5 s, quiet-room AC rms about 50–75 counts.
- Display: added a `max-height: 640px` layout; the dashboard's two card rows and actions fit 1024 × 600 without scrolling (headless screenshot). In-game and utility screens at this size are not yet checked.
- `scripts/node-probe.py` added: talks protocol v1 directly for status, sensor, button edges, LED stepping and microphone level statistics; records no audio.
- Not yet verified: any of the nine light channels, the button, native-USB operation and flashing, speech recognition, service/kiosk install.

## 2026-09-30 (late) — native USB, colours, Fahrenheit, service, repository

- Native USB port (`303a:1001`) qualified with firmware 0.1.1: one stable enumeration, protocol, sensor and 8 s of microphone audio with zero missing samples and zero CRC errors; a full reflash through it needs no button. The reconnect storm seen at first belonged to the previous program. The service now takes both port paths as candidates.
- `scripts/install-service.py` wrote `WorkingDirectory="…"`; systemd 257 rejects the quoted form ("not absolute") so the unit could not start. Fixed; service installed and enabled (no kiosk).
- Lamp colours: Sam watched one output at a time (`node-probe.py --identify`, button-paced). Left and middle had red and green exchanged; the right lamp is red 11, green 9, blue 10. Firmware 0.1.2 carries the corrected map; Sam confirmed all-red, all-green, all-blue and white on all three lamps. Prebuilt images and hashes refreshed.
- Temperature unit setting (`tempUnit`, default F) for the status bar, Atmosphere, Node Scope and Calibration; readings stay Celsius in transport and storage.
- Browser workflow and extension tests pass on this Pi with Playwright 1.63 driving the system Chromium 151 (32 s). Tests now take a free port each and mute audio so several checkouts can run them at once.
- Project placed under local git: `v0.2.0-as-delivered`, then bring-up commits. The generated simulator is no longer tracked.
- Sam's feedback after playing: fun; the lamps are underused; dictation a little inaccurate; wants more games and instruments. Plan for the overnight agent fleet: `../fleet/PLAN.md`.

## 2026-10-01 — two new button-and-lamp games: Meridian and Kiln (desktop, not verified on the device)

- Sam asked for more games that need only the button and the lamps, like Light Trial. Pitched Meridian, Kiln and Relay (a rhythm-teaching game, not built).
- MERIDIAN (`web/apps/meridian.js`): a pendulum of light across the lamps; tap as it crosses the middle lamp. Judged in time (45/90/140 ms), five stages (swing, red pass, drift, eclipse, feint) then faster cycles with narrowing windows; observatory with daily, sprint, eclipse, light colours, 15 feats, log. Save schema 1.
- KILN (`web/apps/kiln.js`): hold to heat, release early because the heat coasts by rate times inertia; land in the band. Clean single hold doubles the score. Five clays (pyrometer, porcelain, raku wander, ash draughts) then open kilns; the yard with daily, trial, lamps-only, glaze shelf, 15 feats, log. Save schema 1.
- New dashboard page LAMPS: Light Trial, Meridian, Kiln (PLAY III keeps Outpost, Echo Vault, Glyph Archive). Shared tests updated: game list in `gesture-apps.test.mjs`, sector layout in `test_catalog_sectors.py`.
- Bots (seeded): Meridian with 40 ms timing error reaches stage V or beyond on three seeds; 140 ms error loses in under two minutes; idle ends in about 9 s. Kiln with 0.02 heat error reaches the open kilns; 0.12 cracks out early; idle ends in about 31 s.
- Unverified: feel, pace and lamp legibility on the real lamps (the host sends at most ~17 lamp changes a second, so the swinging spot moves in steps); voice names "pendulum" and "pottery" against the Vosk vocabulary (the model is not on the desktop; `tests/test_commands.py` checks it on the Pi).

## 2026-10-01 (night) — after Sam's playtest: Kiln shelved, Meridian moved onto the lamps

- Sam: Kiln is not very good; Meridian has potential if it focuses only on the lights (the screen says left, middle or right and you tap as the light swings through). Kiln is removed from the catalog, registry and dashboard (its last version is commit 1d02a77 on this branch); the LAMPS page is gone and Meridian sits on PLAY III with Light Trial.
- Meridian now: full swings end lamp to end lamp; the screen calls LEFT, MIDDLE or RIGHT and shows three still sockets, never the moving light. Each catch calls a new lamp (lead 0.55 s). Windows widened for the lamps' ~17 Hz updates (60/110/170 ms, end lamps x1.35). Stage III is now TEMPO (pace changes) instead of off-centre drift; feints turn back before the far lamp. Save schema unchanged (1).
- Bot: 50 ms timing error reaches the cycles on three seeds; 80 ms reaches stages III to V; 150 ms loses in under 20 s; idle ends in about 12 s. Not verified on the device.

## 2026-10-01 (late) — Meridian deepened: sequences, timing readout, the sky

- Sam: every game should have life and depth, and visuals should improve across the board.
- New stage VI SEQUENCE: about half the calls are two lamps at once (LEFT · RIGHT), caught in order for a bonus of 50 per lamp times the multiplier; a miss breaks it. Cycles call up to three. New feat IN ORDER (5 sequences in a run).
- Timing readout: every catch shows its error in ms (EARLY/LATE), a strip under the lamps keeps the last twelve, and the result screen gives the run's average.
- The sky: six constellations of eight stars in the observatory (SKY row), lit across runs, a star per stage cleared and one per two sequences. New feat STARGAZER (a whole constellation). Save schema 2; a schema 1 save starts with a star per stage reached (`migrateSave`, tested).
- Visuals: the call pops in, sockets flash the grade and ripple, a combo ring fills toward the next multiplier, a stage progress bar, the travel arc between the sockets, lit stars behind the title and result screens.
- Bot (6 seeds, 10 min cap): 30 and 50 ms timing error reach cycles 12 to 14; 80 ms reaches cycles 2 to 6 in four to six minutes. Not verified on the device.

## 2026-10-02 — Meridian after the platform review (desktop, not verified on the device)

- Latency: a tap is judged at its arrival minus 35 ms of lamp lag (the console writes the lamps at most every 60 ms and waits for an acknowledgement) and minus the console-wide calibration `settings.latencyMs` once Settings offers it (clamped to -150..300 ms, 0 when absent). A lapse waits for the same delay, and an end lamp's lapse now waits for its wider window too.
- The lamp shows a red swing exactly when the screen calls one (it used to go red on swings that never reached the called lamp). The called-lamp marker is brighter (0.16 to 0.24, breathing) so it reads on the real lamps.
- In the simulator, where there are no lamps, the three sockets show the lamps at full size.
- Bot (6 seeds, taps on the visible light): 80 ms timing error now reaches cycles 5 to 8.

## 2026-10-02 — Meridian moves its feats and daily order to the console logbook (desktop, not verified on the device)

- Following the review rule Sam agreed with and PR #16's cut list: feats are reported once each with `ctx.feat` (the console announces them), and the daily run states its goal with `ctx.daily` and says when it is met with `ctx.dailyMet`. The observatory loses its FEATS screen, the daily streak and the feat ticker on the result screen. Without PR #16 (no logbook) the calls are skipped and the game announces feats itself.
- Unlocks no longer count feats: SPRINT opens on reaching Tempo, ECLIPSE on reaching Eclipse, the lights at 4, 12 and 24 stars. The ON THE DAY feat is retired.
- Save schema 3: drops the daily streak and the daily-goal count; tested from schemas 1 and 2.
- PR #16's TIMING OFFSET matches the agreed contract (`latencyMs`, positive late, -150..300, 0 when absent); Meridian keeps its own reader so it runs before #16 lands.

## 2026-10-01 — dashboard tidy (desktop, not verified on the device)

- Sectors regrouped by kind instead of PLAY / PLAY II / PLAY III and INSTRUMENTS / II: VOYAGES (Perihelion, Outpost, Undertow, Ballista, Tideline), ARCADE (Orbit Lock, Ricochet, Moonrunner, Light Trial, Descent), MIND (Echo Vault, Glyph Archive), TOOLS (Lantern, Cadence, Oracle, Signal School), SENSORS (Atmosphere, Resonance, Field Notes). Pulsar and Helix (retired by Sam) are off the dashboard; their own pull requests remove them. Sectors may carry an optional `tagline`.
- The decorative hero became a sector header (serif sector name, tagline, the orrery) and a strip of every sector with the current one lit; with NEXT SECTOR highlighted, the sector it leads to is marked in amber. Game cards show their kind, best score and runs (or UNCHARTED); part-filled pages square off with empty bays. Headless 1024 × 600, 800 × 900 and 400 × 800 screenshots looked at.
- Storage migration `ballista_metres_v2`: the old artillery best moves to `ballista:artillery` once, so the rebuilt launcher's metres start a fresh best (tests/test_storage_migrations.py).

## 2026-10-02 — platform polish from the review (desktop, not verified on the device)

- Play mode: the console's chrome folds into a 34 px top row and a 26 px bottom row while a game runs, so on 1024 × 600 the game is shown at 960 × 540 instead of about 670 × 377. The canvas backing store follows the shown size; RENDER QUALITY (auto, sharp, fast) can draw fewer pixels. Headless Chromium at 12× CPU throttling: Perihelion's slow frames 37/147 sharp, 21/165 fast; Ballista 12/174 and 2/182. Not a Pi measurement.
- The menu gesture's final hold is 600 ms longer inside a game (1.6 s at the standard pace); menus keep 1 s. `SETTLE` is 2.8 s.
- TIMING OFFSET in Calibration (`latencyMs`, tap-along), two knocks on the case go back outside a game (needs PR #4's firmware and service), and the console logbook (today's three, streak, feats; progress id `console`, version 1).
- Report and per-game cut list: `fleet-notes/reports/platform-polish.md`.

## 2026-10-03 — Meridian after Sam's playtest: directions, four lamps (desktop, not verified on the device)

- Sam: "I don't understand it. Let's add some directions and instructions." The title is now the first lesson: a small model of the lamps where the light swings and catches the lamp it calls, with the rules in four lines. HOW TO PLAY (five pages) in the observatory; a newcomer's cursor starts on it.
- Guide light: during each run's four practice swings the light is drawn on the screen arc too, with a ring that closes on the called lamp as it arrives (both drawn the console's lag behind, as taps are judged), then PRACTICE OVER. Observatory GUIDE LIGHT: PRACTICE (default), ALWAYS, OFF; saved as `sel.guide` in schema 3 (defaults to PRACTICE).
- A line under the call in stage I and practice: "TAP AS THE LIGHT REACHES THE LEFT LAMP"; sequences say "CATCH THEM IN THE ORDER CALLED"; dark swings "TAP WHERE IT WOULD BE".
- Four lamps (`ctx.lampCount()` = 4): the swing runs across all four; calls LEFT, INNER LEFT, INNER RIGHT, RIGHT; end lamps keep the wider turn window. Bot balance on four matches three (perfect and 50 ms players play the full 10 minutes; 80 ms players reach cycles 5–7 either way). Three-lamp nodes unchanged.
- Merged PR #16; Meridian sits in the MIND sector.

- Later the same night: a LAMPS sector (Meridian, Relay, Light Trial) after ARCADE, and The Stacks on TOOLS. Sectors may name a cartridge that is not in the catalog yet; it is left out until its pull request adds it, so each draft merges with its catalog entry alone. The dashboard's system menu no longer lists DASHBOARD beside RETURN TO DASHBOARD.
- 2026-10-02: Descent is on hold (Sam): off the dashboard and without its voice name; its code and saves stay and it still launches by id.
- 2026-10-03: the new node has no temperature/humidity sensor (Sam). Atmosphere is off the dashboard and voice (still registered, its history untouched); SENSORS became LISTEN (Resonance, Field Notes); the top bar's temperature/humidity readout is hidden in index.html. main.js still writes to the hidden readout, and Node Scope and Telemetry still show sensor rows.
- 2026-10-03 (platform polish): inside the system menu tap, tap, hold no longer reopens the menu (Sam: choosing DASHBOARD, the third row, opened the menu again). Save slots for games that opt in (`saveSlots = true`; `engine/slots.js`, progress ids `<id>#2..4` and `slots`); Outpost wires them first. The sensor rows are gone from the top bar code, Node Scope (it shows the lamp count and the current node's wiring), Telemetry and Calibration's TEMPERATURE unit; Atmosphere keeps its own. Not verified on the device.
