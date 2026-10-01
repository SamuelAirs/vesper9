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

## 2026-10-01 — Perihelion swing polish (Sam's notes after the depth round)

- Solid tether: when no sun ahead, above or level is in reach, the diamond marks the nearest sun below and the probe pivots over it on the rigid line. Suns above still win, so the Approach plays as before whenever one is in reach. Physics, constants and release are unchanged.
- No trajectory drawn: the dashed aim line and the swing-path circle are gone; only the diamond marks the target. The probe's drawn heading now eases toward its velocity instead of snapping at a catch.
- Directions: hangar GUIDE row (controls, chain and score, daily run and streak, hangar); a bar under the multiplier counts down the 1.2 s chain window; first-time notes when the chain reaches 2 and when it is lost; the daily streak reads "Days in a row" and shows 0 after a missed day.
- Balance effect (planning bot, 8 seeds, development host): chains run much longer (best chain about 90–130 against 10–30), so the multiplier sits near x5 and scores are about 1.6x the old ones; old console bests will fall easily. The bot arrives on fewer seeds (its one-catch planner grabs suns below and swings under the band), so the arrival test now uses seeds 17 and 123. On main the old arrival test already failed on seed 3003 here (Node 22.22). Feel unverified on the device.

## 2026-10-01 (evening) — Perihelion tricks, going back, paced runs (Sam: "a lot of fun")

- Tricks (flat points, not multiplied): STALL (swing stops above level; 15–30, two per tether), LOOP (25, three per tether), SKIP (10 per unused sun passed over, up to 3), BACKTRACK (10, once per sun). Feats HANG TIME and LOOP THE LOOP (18 feats now). With the multiplier applied, loops alone were about half the planning bot's score (it loops by accident on fast close catches), so points are flat: about 10 % of a bot run.
- Going back: heading left, the diamond marks the nearest sun behind (also the fallback when nothing is ahead), limited to 400 px behind the furthest point (in a paced run also the screen's left edge). A sun already used keeps the chain but does not add to it.
- Paced runs: hangar PACE row (OFF, STEADY 100 px/s, BRISK 135 px/s). The camera never moves slower than the pace; the left edge replaces the terminator. Each pace keeps its own best (`pp` in the save); never the console best; daily runs are never paced.
- Bot arrival test seeds now 11, 3003, 123 (the bot plays differently with backtracking). 822/822 JS tests on the development host. Paces and trick values unverified on the device.

## 2026-10-01 (night) — Perihelion: no chain or route points, smooth lock (Sam)

- Score is now distance (1 per Mkm) plus STALL, LOOP, relics (25), near passes (8) and the arrival (400). The chain multiplier, SKIP and BACKTRACK are gone; the chain remains a stat for the HUD, feats and daily goals. Console bests from earlier builds are on the old multiplied scale and will not be beaten easily.
- Smooth lock: a landed tether stays slack (the amber dashed line) while the probe still closes on the sun and locks at the closest point of its path, so speed and direction carry straight into the swing. It locks at once when the probe is already moving away, at 50 px from the sun, or after 0.6 s slack (then it turns as before). The lock radius is now set by the path rather than by when you press.
- Planning bot (forward only now; it does not use backtracking): 3 of 12 seeds arrive (it was about 6 of 10 before the lock change, on a longer slack 2 of 10). Most losses are dark bodies, struck while slack or in the tighter swings. Arrival test: at least two of seeds 17, 123, 9, 55, 3003 (three arrive here, on Node 22 and 20). Whether the lock is harder for a person is unknown until Sam plays it.
- Reverted the same evening: Sam found the slack lock hard to read ("difficult to tell when a tether will deploy, sometimes really slow"). The tether engages again a fixed 5 frames after the press at the current distance; the scoring changes stay. Forward-only planning bot: 10 of 16 seeds arrive; arrival test needs three of seeds 11, 5, 41, 9, 33 (all five arrive here, Node 22 and 20).

## 2026-10-01 (late) — Perihelion lives and upgrades (Sam: "lives, plus some upgrades… or lives are an upgrade")

- Lives are an upgrade: SPARE PROBE (3, 8, 16 shards) gives up to three spares. A lost probe relaunches parked 190 px before the first sun ahead of the furthest point (the original opening's offset and velocity), with dark bodies cleared from that stretch and the terminator pushed back; distance already scored is not scored again.
- Shards: 1 per 200 Mkm flown, 1 per relic, 5 for an arrival; spent in the hangar's new UPGRADES view. Other upgrades: LONG LINE (reach +20 px, two levels), RELIC MAGNET (+14 px pickup, two), DARK BRAKE (terminator −10 %, two), COOLANT (amber fuse +0.6 s, two). Save adds `shards` and `up`. Daily runs use no upgrades. Upgraded plain runs still set the console best.
- 824/824 JS tests on Node 22; Perihelion 39/39 on Node 20. Prices unverified in play.
