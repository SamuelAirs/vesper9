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
- Look: each region tints the sky ahead; suns glow (brighter while held, cyan for sling suns); the tether has a soft glow; a catch rings out from the sun; the probe glows and shows a flickering exhaust that lengthens with speed; the trail tapers. Primitive budget test still under 400.
- Run goals: every non-daily run draws a goal from its own generator seeded by the run count (the world's generator is untouched): loops, stalls, relics, close passes, a chain or a region, three tiers by furthest region reached, paying 3/5/7 bonus shards. 825/825 JS tests on Node 22; Perihelion 40/40 on Node 20.

## 2026-10-02 — Perihelion: fixes from the platform review (`/mnt/project-files/reviews/platform-review-2026-10-02.md`)

- Notices on the screen: the run goal, feats, first-time notes and a lost probe now show in a strip at the foot of the play area (they were only on the shell's hint line, which a full-screen layout may drop). One shows at a time; a new one waits and cuts the current one short, so a feat no longer overwrites a region name. The region name stays in its banner.
- The goal at the top right now names what it counts ("GOAL  LOOPS 1/3") with a bar that fills toward it.
- Hangar trimmed: it opens on LAUNCH (hold, hold goes back out), FEATS and LOG are one view (three feat pages, then the log), and rows with nothing to choose are hidden. A fresh save sees five rows: LAUNCH, DAILY RUN, PACE, FEATS AND LOG, GUIDE.
- Fixes from the earlier Perihelion review: a finished run's relics no longer count twice toward lifetime feats (ARCHIVIST could unlock at 23); the Cluster's lamp colour is sky blue instead of white, so the white relic and catch cues read there; dark bodies in the Binaries clear a binary's whole orbit, not just its centre.
- Not done here: the menu gesture firing mid-run belongs to the platform polish thread; separating upgrade-boosted scores waits for the console-wide meta decision.
- Planning bot over 40 seeds: 17 arrive (16 before the orbit clearance), 3 die in the Binaries (5 before). Arrival test seeds now 11, 9, 3, 13, 15 (they arrive both before and after the change). 826/826 JS tests on Node 22; Perihelion 41/41 on Node 20. Not verified on the device.

## 2026-10-02 — Perihelion on the console logbook (PR #16's cut list, `/mnt/project-files/platform-polish/platform-polish.md`)

- Feats go to the console with `ctx.feat(id, name)`; the hangar's feat pages are gone (the LOG row is back, regions and crossings only). The game still tracks feats in the save so each is reported once, and still shows new ones on the result card.
- Probes and trails now open by the furthest region reached (Ballast at the Binaries, Wisp at the Dark Field; trails at II, III, IV and an arrival). The save gains `fl`, the feat count when this landed, so nothing a player had opened is locked again.
- The daily run states its goal with `ctx.daily("Daily run: …")` and calls `ctx.dailyMet()` when met; Perihelion's own streak (`dl.streak`, `dl.last`) is dropped. The title shows ONE OF TODAY'S THREE when Perihelion is picked. Every ctx call is optional, so the game runs on a shell without #16; the PR still needs #16 merged first for the logbook to receive anything.
- The run goal and notices were already moved into the play area (previous entry).
- 827/827 JS tests on Node 22; Perihelion 42/42 on Node 20, and 42/42 on PR #16's branch. Merging with #16 conflicts only in this file. Not verified on the device.
## 2026-10-03 — Moonrunner: Sam's playtest and four lamps (desktop/cloud session)

- Sam: "maybe a little too easy now, and there are times where it feels like I should hit a perfect [slide] but I kind of bounce down the slope." Measured with bots: a fast sled skipped off the curve of crests and downslopes in 0.02 s hops even while held, and about a third of missed landings were dives only up to 0.15 rad too steep.
- Fixes: a held sled, or one on a downslope steeper than `GLUE` (0.12 rad), stays on the ground; a dive up to `STEEP_OK` (0.12 rad) steeper than the window is still perfect. A notch harder: a thud keeps only `THUD_KEEP` (55 percent) of the speed, the run starts with 35 s (was 40) and zone II gives 22 s (was 25).
- Four lamps (helpers from PR #16, merged in): on a four-lamp node the third lamp is the chain and fever and the fourth the daylight, so the landing lamp is never hidden by the fever chase. Three-lamp nodes look as before.
- Bots, 8 seeds, score (metres): precise about 48 000 (7 700); 150 ms late 34 400 (7 500); 250 ms late 6 300 (2 800, reaches V 2/8, VI 0/8); by eye 13 300 (5 300, VI 3/8); never pressing 370 in 36 s.
- Save slots (PR #16's API): `static saveSlots = true`, and `slotSummary()` labels a slot "LEVEL 5 · THE RILLES".
- Not verified on the device.

## 2026-10-02 — Moonrunner: fixes from the platform review (desktop/cloud session)

- The review (`/mnt/project-files/reviews/platform-review-2026-10-02.md`) found Moonrunner too easy and upgrade-driven: a laggy bot reached The Far Side every run, and the battery's daylight made the best score grow with grinding.
- Skill: from zone IV the dive assist weakens (`GRIP`: 60, 40, 30 percent) and the perfect window narrows (0.42, 0.38, 0.35 rad); daylight per new zone is `ZONE_T` = 25, 20, 10, 6, 4 s; V moved to 3400 m and VI to 5400 m.
- Gear: the battery became the GRAPPLE (a rille fall costs 3 s less a tier), the fever coil keeps the chain through one miss a fever, shards score nothing, and a surveyed zone pays 60 shards instead of daylight. A test checks that full gear scores the same as none. Old saves keep their tiers.
- Fixed the fever notice colour (`startsWith("FEVER")`) and the ground seams (one piece per zone, a world-fixed gradient for the blend).
- Bots, 8 seeds, score (metres): precise about 53 400 (8 600), 150 ms late 27 600 (7 600), 250 ms late 11 800 (5 700), by eye 15 000 (6 300); before, 250 ms late scored 56 percent of precise, now 22 percent. The precise bot reaches VI 8/8, 250 ms late 4/8. Runs last about 140 to 165 s (were about 250 s).
- Console logbook (PR #16's cut list): the game's own daily streak and the rank names are gone. The daily run states its goal with `ctx.daily()` and reports it with `ctx.dailyMet()` (both optional, so the game also runs without #16); the goal pays 60 shards once a day. Old saves drop the streak.
- Not verified on the device.

## 2026-10-01 — Moonrunner: depth and visuals (desktop/cloud session)

- Sam asked for better visuals across the board and games with life and depth you can sink time into. Changes stay inside `web/apps/runner.js` (the dashboard and catalog belong to another thread).
- Visuals: each zone has its own palette (sky gradient, three ridge layers, layered soil with bands), blended over the first 80 m of a zone; twinkling stars, an Earth crescent with weather (a galaxy band on the far side), craters, a sled with runners, cab and antenna, fever glow, and rings on perfect slides. The camera takes in the valley ahead.
- Depth: fever now climbs from x2 to x5 with every three further perfect slides (+2 s each); sunstones float above some crests (+4 s of daylight); every zone hides three survey beacons high above the hills (18 in all, +30 shards each, and a complete zone gives +2 s daylight to every run). New orders (sunstones, fever level, beacons); the log shows beacons per zone, sunstones and the best distance. Save schema 3 keeps old saves (new fields default to 0).
- Balance (`BALANCE_SEEDS=6`): by eye about 11 500 in 242 s; a bot timing each dive about 12 750 in 251 s; never pressing about 650 in 66 s. Gesture audit 0/60.
- Not verified on the device.

## 2026-10-01 — Moonrunner: rhythm and flow (desktop/cloud session)

- Sam: "Moonrunner doesn't quite have the right rhythm. It's really hard to get a flow going." Measured with the by-eye bot (hold over a downhill, let go over an uphill): 77 percent of its landings hit the next climb, because flights off steep upslopes sailed past the downslope, and the time between presses varied by 41 percent.
- Changes in `web/apps/runner.js`: hills come in sets of 3 to 5 matching hills (`SET`), each set's length sized to the sled's speed smoothed over 2.5 s (`TEMPO.k * speed`, within 0.8x to 2.2x of the zone's range), with the zone's height-to-length shape; a dive anywhere above a downslope closes in on it (aims 0.2 rad steeper than the slope, only steepening until 40 px above, then runs along it; 3 rad/s); diving in the air is 0.9x the sled's dive gravity; the camera also pulls back for a deep valley just ahead; `AHEAD` is 2400 px so new sets follow the speed sooner.
- By-eye bot (seeds 1-6): perfect slides 13 to 74 percent of landings, landings on a climb 77 to 7 percent, press timing variation 41 to 18 percent. Balance (`BALANCE_SEEDS=6`): by eye about 10 300 in 217 s; a bot timing each dive about 12 700 in 249 s; 150 ms late about 11 400; never pressing about 630 in 65 s.
- The daily run's hill lengths now follow each rider's speed, so riders share the date's features and draws but not the exact hills.
- Not verified on the device.

## 2026-10-01 — Moonrunner: more air, bigger hills (desktop/cloud session)

- Sam played the hill-flyer on the console: "a lot better, but it's pretty difficult. It should be closer to tiny wings. It's super hard to get air on it, and the hills are all very shallow." Measured with the by-eye bot: about 11 flights a minute, 18 percent of the time in the air.
- Changes in `web/apps/runner.js`: hills about 1.5x longer and 1.4x taller (steepest about 55 degrees, `H <= 0.9 L`); a released sled is light on the ground too (`ride.air`), so it leaves crests from about 110 km/h; a dive within 140 px above a downslope bends the sled's line toward the slope (2.2 rad/s); the perfect window is 0.5 rad; any landing keeps at least 70 percent of the flight speed.
- Balance (`BALANCE_ONLY=runner BALANCE_SEEDS=6`): by eye about 5 600 in 167 s and about half the time in the air; a bot timing each dive about 11 000 in 229 s; 150 ms late about 6 900; never pressing about 660 in 66 s.
- Not verified on the device.

## 2026-10-01 — Moonrunner reworked as a hill-flyer (desktop/cloud session)

- Sam played the downhill build: "a good mvp, but kind of a flop. The flipping is too fast and linear, and there's no sense of speed or obstacles. Maybe it should be closer to tiny wings than alto." `web/apps/runner.js` is now a Tiny Wings-style hill-flyer: hold to dive (gravity x3 on the ground for the SURVEYOR), let go to fly (x0.7 in the air); the hills are cosine half-waves between key points with a slight overall descent. A landing within 0.42 rad of a downslope is a perfect slide (x1.08 + 60 px/s, +0.5 s daylight, chain points); three in a row is fever (5 s, double points, +250 px/s top speed). The run is timed by daylight (40 s, +25 s per new zone; at night the sled coasts to a stop), which replaces crashing.
- Obstacles by zone: dust pits (II, 400 m), rilles past the crests with a throwing rim (III, 1000 m; need about 420 px/s, falling costs 8 s), boost crystals (IV, 1800 m), gas vents (V, 2800 m), all of them on the far side (VI, 4000 m). Sense of speed: camera zoom with speed and height, screen-space streaks, km/h in the HUD, the terminator darkening from the left as the daylight runs out.
- Kept: survey orders (new kinds: perfects, chain, fever, high, long, speed, pads, vent), levels, sleds (SURVEYOR, SKIMMER floats, HAULER dives), trails, workshop (magnet, battery, fever coil), daily run, zen, depot, `AppGuard`, `LampBus`. Save schema 3 migrates schema 1 (first release) and schema 2 (the downhill build: level, shards, sleds, records kept; orders of the level restart; hover pads and headlamp refunded as shards).
- Tuning was done with the bots in `tests/helpers/runner-bot.mjs`: launches off crests needed a much smaller take-off threshold (0.05 px a step, not 0.6), and flights shorter than 0.12 s do not count as landings. Balance (`BALANCE_ONLY=runner BALANCE_SEEDS=6 node tests/audit/balance.mjs`): never pressing ends at about 740 points in 65 s; diving by eye about 3 800 in about 2 minutes; a bot that times each dive about 6 900 in nearly 3 minutes; the same bot 150 ms late about 4 600.
- Not verified on the device: feel, frame smoothness on the Pi's display, lamp brightness and colours, sound levels.

## 2026-10-01 — Moonrunner rebuilt as a downhill run (desktop/cloud session)

- Sam's feedback: Moonrunner had potential but the background scrolling was jerky; make it closer to Alto's Adventure. `web/apps/runner.js` is now a one-button downhill run: tap to jump, hold in the air to flip, land flat (clean within 0.5 rad of the slope, stumble to 1.0, crash beyond). Combo, six zones (boulders from 500 m, rilles 1200 m, cables 2100 m, rims and vents 3200 m, far side 4500 m), survey orders (three per level) unlocking zen riding, two more sleds and trails, a workshop bought with shards, a daily run and a depot (hold on title or result). Save schema 2 migrates the first release's `{ schema: 1, runs, last, milestone }`.
- Jerk: the old far hills were drawn per screen slot with `distance % 110`, so their shapes changed when the slot wrapped. Every layer is now a function of world position, the terrain a Catmull-Rom curve through fixed control points, and `draw()` extrapolates the camera by the wall time since the last fixed update, so a frame that runs zero or two updates (the host's accumulator in `web/main.js`) no longer steps the picture. A host-level interpolation factor passed to `draw()` would be the cleaner general fix; not done here (shared file).
- Gesture safety moved from `GestureGuard` (fixed field list) to `AppGuard`, so `tests/gesture-apps.test.mjs` now checks every field of Moonrunner. Old Moonrunner mechanic tests (shapes, shields, hold-to-clear) were removed with the mechanics; the shared lamp, F2/F3/F4 and gesture tests now drive the new game; new tests in `tests/runner.test.mjs`.
- Balance (`BALANCE_ONLY=runner BALANCE_SEEDS=4 node tests/audit/balance.mjs`): never pressing ends at about 570 points in 28 s (zone II's first boulders); a careful bot scores about 15 000 and rides for minutes; jump timing noise of 80 ms cuts that to about 4 000, 150 ms to about 850.
- Not verified on the device: feel, frame smoothness on the Pi's display, lamp brightness and colours, sound levels.
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
## 2026-10-02 — new game: Relay, a call-and-answer rhythm game on the lamps (desktop, not verified on the device)

- The rhythm game pitched with Meridian on 2026-10-01: the lamps play a bar of a real rhythm, go dark, and the player taps it back; the next call follows on the beat, so a run is one groove. Built on the lessons of Sam's playtests: lamp-focused, one button, flowing pace, a warm-up answer and forgiving early stages.
- `web/apps/relay.js`: 25 rhythms in seven stages (pulse, eighths, syncopation, clave, waltz, swing, odd time) then cycles to 160 BPM with narrowing windows; AGAIN answers from memory from the waltz on; notation shown until a rhythm is learned. Songbook: daily, studio (practice, no shields), accelerando (4 feats), sound kits, a rhythm book (learned at 1 clean answer, mastered at 5), 15 feats, log. Save schema 1 with `migrateSave`, tested.
- Catalog: one entry (voice name "relay"; "rhythm" is Pulsar's) on PLAY III after Light Trial; registry import; `gesture-apps.test.mjs` and `test_catalog_sectors.py` game lists include it.
- Bots (4 seeds, 15 min cap; timing error sd): 30 ms plays on into cycle 25; 50 ms reaches cycles 5 to 8 in six to eight minutes; 75 ms reaches stages V to cycle 2 in three to five minutes; 100 ms loses in stages II to V within three minutes; idle ends in about 26 s. Not verified on the device: the lamps update about 17 times a second, so the tones carry the exact timing.

## 2026-10-02 — Relay after the platform review (desktop, not verified on the device)

- Latency: every tap is judged at its arrival minus the console calibration `settings.latencyMs` (clamped to -150..300 ms, 0 when absent); misses and the end of an answer wait for the same delay. A test bot whose taps arrive 60 ms late loses most PERFECTs uncalibrated and plays as with no delay when calibrated. An answer that has already lost when the next round begins is called again at once.
- Resume: opening the menu mid-run drops the round in progress unjudged and calls it again after a four-beat count-in (`gesture-apps.test.mjs` lists Relay as rebuilding on resume).
- Scores: the multiplier steps every 12 notes up to x4 (was 8 and x8) and the clean bonus is 20 a note; scores are about half what they were. Daily score goals are 8000 to 20000.

## 2026-10-02 — Relay moves its feats and daily order to the console logbook (desktop, not verified on the device)

- Per PR #16's cut list: feats are reported with `ctx.feat` (announced by the console), the daily run states its goal with `ctx.daily` and calls `ctx.dailyMet`. The songbook loses its FEATS screen, the daily streak and the feat ticker. Without PR #16 the calls are skipped and the game announces feats itself.
- Unlocks no longer count feats: ACCELERANDO opens on reaching the clave, the BELL and CHIP kits at 6 and 14 rhythms learned. The ON THE DAY feat is retired.
- Save schema 2: drops the daily streak and the daily-goal count; tested from schema 1.

## 2026-10-01 — dashboard tidy (desktop, not verified on the device)

- Sectors regrouped by kind instead of PLAY / PLAY II / PLAY III and INSTRUMENTS / II: VOYAGES (Perihelion, Outpost, Undertow, Ballista, Tideline), ARCADE (Orbit Lock, Ricochet, Moonrunner, Light Trial, Descent), MIND (Echo Vault, Glyph Archive), TOOLS (Lantern, Cadence, Oracle, Signal School), SENSORS (Atmosphere, Resonance, Field Notes). Pulsar and Helix (retired by Sam) are off the dashboard; their own pull requests remove them. Sectors may carry an optional `tagline`.
- The decorative hero became a sector header (serif sector name, tagline, the orrery) and a strip of every sector with the current one lit; with NEXT SECTOR highlighted, the sector it leads to is marked in amber. Game cards show their kind, best score and runs (or UNCHARTED); part-filled pages square off with empty bays. Headless 1024 × 600, 800 × 900 and 400 × 800 screenshots looked at.
- Storage migration `ballista_metres_v2`: the old artillery best moves to `ballista:artillery` once, so the rebuilt launcher's metres start a fresh best (tests/test_storage_migrations.py).

## 2026-10-02 — platform polish from the review (desktop, not verified on the device)

- Play mode: the console's chrome folds into a 34 px top row and a 26 px bottom row while a game runs, so on 1024 × 600 the game is shown at 960 × 540 instead of about 670 × 377. The canvas backing store follows the shown size; RENDER QUALITY (auto, sharp, fast) can draw fewer pixels. Headless Chromium at 12× CPU throttling: Perihelion's slow frames 37/147 sharp, 21/165 fast; Ballista 12/174 and 2/182. Not a Pi measurement.
- The menu gesture's final hold is 600 ms longer inside a game (1.6 s at the standard pace); menus keep 1 s. `SETTLE` is 2.8 s.
- TIMING OFFSET in Calibration (`latencyMs`, tap-along), two knocks on the case go back outside a game (needs PR #4's firmware and service), and the console logbook (today's three, streak, feats; progress id `console`, version 1).
- Report and per-game cut list: `fleet-notes/reports/platform-polish.md`.

## 2026-10-03 — Perihelion: thinner Cluster, four lamps (Sam's playtest: "good as always", but at times the suns are far too dense)

- Merged PR #16 (with PR #19's lamp count and board LED) into this branch; only `docs/WORKLOG.md` conflicted.
- Density: the Cluster was the crowded stretch, with 3.25 suns in reach on average and 3 or more 81 % of the time (20 seeds). Its gap is now 108–150 px (was 78–125), and a twin sun now appears 18 % of the time (was 35 %), giving 2.3 suns in reach, with 3 or more 33 % of the time. The other regions were already about 1.5 (the Binaries 2.4, counting each pair as two moving suns) and are unchanged. A test pins the Cluster below 2.6 on average.
- Four lamps: with `ctx.lampCount()` 4, lamps one to three show exactly what they do on the old node, and the fourth (right) is the button's lamp. In flight it is cyan while a sun is marked in reach (amber for one that burns out), brighter while held, and dark when nothing is in reach. On a tether it grows brighter and greener the better a release would be at that moment. While parked it pulses cyan. When the dark or a paced run's edge is within 170 px it blinks red. Flashes and the title, hangar and result glows use all four lamps. The board LED is not used. The GUIDE gains a LAMPS page, and guide text is 18 px so a full line fits the panel.
- Planning bot over 40 seeds: 19 arrive (17 before). The arrival test seeds are now 11, 13, 15, 19 and 23 (each arrives before and after), and the bounds test uses seed 11. 852/852 JS tests on Node 22; Perihelion 44/44 on Node 20. Not verified on the device or its four lamps.
## 2026-10-03 — Meridian after Sam's playtest: directions, four lamps (desktop, not verified on the device)

- Sam: "I don't understand it. Let's add some directions and instructions." The title is now the first lesson: a small model of the lamps where the light swings and catches the lamp it calls, with the rules in four lines. HOW TO PLAY (five pages) in the observatory; a newcomer's cursor starts on it.
- Guide light: during each run's four practice swings the light is drawn on the screen arc too, with a ring that closes on the called lamp as it arrives (both drawn the console's lag behind, as taps are judged), then PRACTICE OVER. Observatory GUIDE LIGHT: PRACTICE (default), ALWAYS, OFF; saved as `sel.guide` in schema 3 (defaults to PRACTICE).
- A line under the call in stage I and practice: "TAP AS THE LIGHT REACHES THE LEFT LAMP"; sequences say "CATCH THEM IN THE ORDER CALLED"; dark swings "TAP WHERE IT WOULD BE".
- Four lamps (`ctx.lampCount()` = 4): the swing runs across all four; calls LEFT, INNER LEFT, INNER RIGHT, RIGHT; end lamps keep the wider turn window. Bot balance on four matches three (perfect and 50 ms players play the full 10 minutes; 80 ms players reach cycles 5–7 either way). Three-lamp nodes unchanged.
- Merged PR #16; Meridian sits in the MIND sector.
## 2026-10-03 — Relay after Sam's playtest: tap marks on the line, four lamps (desktop, not verified on the device)

- Fix: the notation drew notes and taps half a step to the right of their tick while the playhead ran on the ticks, so a tap on time showed well ahead of the line. Notes now sit on their tick (`stripX`), taps where they were judged, and the answer's playhead runs the TIMING OFFSET behind, so a fresh tap meets it. Test draws the strip and checks note, tap and playhead share an x, with and without calibration.
- Latency from PR #16's `engine/latency.js`.
- Four lamps (`ctx.lampCount()` = 4): lamp 4 is the beat (count-in, a quiet pulse under the call, the stage's click in the answer, green on a clean answer, red on a slip); lamps 1–3 carry only the rhythm. Title and menu chase a bar of four. Three-lamp nodes unchanged (nine values).
- Merged PR #16; Relay sits in the MIND sector.

- Later the same night: a LAMPS sector (Meridian, Relay, Light Trial) after ARCADE, and The Stacks on TOOLS. Sectors may name a cartridge that is not in the catalog yet; it is left out until its pull request adds it, so each draft merges with its catalog entry alone. The dashboard's system menu no longer lists DASHBOARD beside RETURN TO DASHBOARD.
- 2026-10-02: Descent is on hold (Sam): off the dashboard and without its voice name; its code and saves stay and it still launches by id.
- 2026-10-03: the new node has no temperature/humidity sensor (Sam). Atmosphere is off the dashboard and voice (still registered, its history untouched); SENSORS became LISTEN (Resonance, Field Notes); the top bar's temperature/humidity readout is hidden in index.html. main.js still writes to the hidden readout, and Node Scope and Telemetry still show sensor rows.
- 2026-10-03 (platform polish): inside the system menu tap, tap, hold no longer reopens the menu (Sam: choosing DASHBOARD, the third row, opened the menu again). Save slots for games that opt in (`saveSlots = true`; `engine/slots.js`, progress ids `<id>#2..4` and `slots`); Outpost wires them first. The sensor rows are gone from the top bar code, Node Scope (it shows the lamp count and the current node's wiring), Telemetry and Calibration's TEMPERATURE unit; Atmosphere keeps its own. Not verified on the device.

## 2026-10-03 — Perihelion save slots (Sam: "most games should have save slots")

- Merged the latest PR #16 (save slots, and tap, tap, hold no longer reopening the menu); only `docs/WORKLOG.md` conflicted.
- `static saveSlots = true`: four saves, each with its own shards, upgrades, unlocks, regions and daily record. `slotSummary(value)` labels a slot's row with the furthest region and the runs ("III BINARIES · 12 RUNS", 24 characters at most, any old save shape). Slot 1 is the existing save. 859/859 JS tests on Node 22; Perihelion 45/45 on Node 20; the system menu shows SAVE SLOT / 1 OF 4 in the simulator. Not verified on the device.
- 2026-10-03: Tideline ditched (Sam): off the dashboard and voice, code and saves kept, matching PR #8's catalog change.
## 2026-10-01 — Tideline and Outpost depth (desktop, not verified on the device)

- TIDELINE save schema 3 (schema 2 migrates, with a test against a save in the old format): perfect catches and silver/gold stars per species, angler rank 1-10 from experience (schema 2 saves get experience from what they had landed), a notice board of three commissions from rank 2, salvage chests that drift through the catch gauge from rank 3, and rests (one per tide, up to three) that move the sky to the next part of the day from rank 4. The sustained tension tone is replaced by short reel clicks. Lamp scheme during the catch unchanged. Report: `fleet-notes/reports/depth-tideline-outpost.md`.
- OUTPOST save schema 4 (schema 3 migrates, fixture written by the previous build): groove (a steady beat raises tap and phrase value up to x1.5), extra voices mixed under the lead with the new `gain` argument of `ctx.tone`, constellations bought with bearings from 1000 held (x1.3 output each, without end), and a lower "relocation ready" ratio once bearings are large. Bot: the eighth relocation now takes about 50 minutes (it did not finish in four hours before).
- Shared change: `Synth.tone` takes an optional fourth `gain` argument (0..1, default 1); `docs/ENGINE.md` updated.
- After Sam's playtest ("pretty difficult"): Tideline's learner help now tapers over the first 40 landings and keeps a quarter for good, instead of ending after three; a learner's first early press per cast is forgiven.
- Visual pass inside both games: Tideline sky, shore, water, pier, angler, fish shadows, splashes and a livelier catch gauge; a daily catch (double pay, first-of-day bonus, save field `dy`). Outpost horizon glow, far planet, filled ridge and ground, signal pulses from machines, tap ripples (cyan in full groove).
- After the independent review (Tideline 5.5, "a reflex test after the help fades, then gear trivialises it"): darts, bolts and big lunges are told first (shiver, arrow, rising or falling notes, lamp shimmer); gear steps flattened and hard fish fill slower, so legends need both gear and skill; retuned against novice, practiced and sharp human-like bots and the review's 200 ms bot.
- For the console logbook (PR #16): Tideline's today's catch is stated with `ctx.daily` and met with `ctx.dailyMet` (its own first-of-day bonus removed); the field log is a five-stop page, a row of eight species per tap.
- 2026-10-03, Sam: "Tideline is what I asked for, it's just not very fun. Let's ditch it." Retired from the dashboard the way Descent went on hold: out of its sector, voice name removed, still registered (factory `Tideline`) so its code and saves stay and it launches by id.
## 2026-10-01 — knock input (cloud session, not on the device)

- Knock on the case, approved by Sam: detected on the node (firmware 0.1.3, `firmware/main/knock.h`) so only a knock event leaves it; knocks within 60 ms of a button edge are dropped on the node, which owns the button timing. Protocol v1 gains KNOCK (8) and KNOCK_SET (22); older firmware ignores the new command and the console carries on without knocks.
- Decided: the knock is a second game input (`app.knock(event)`), not a way into the menu (tap, tap, hold already works everywhere). Sensitivity is a setting (`knock`, default medium) because the right threshold depends on the case; Node Scope shows the node's counters for tuning.
- Verified here: detector host test on synthetic knocks, tones and speech; firmware builds without warnings under ESP-IDF v5.4.2 (x86-64 host); all JS, Python, catalog and browser suites. Not verified: anything on the real node or case. Device steps: `fleet-notes/reports/knock-input.md`. The prebuilt image is still 0.1.2.
- Round 2 after Sam's device test on the Pi (PR #4): hard clipped knocks were sometimes judged sustained, so the tail window moved to 40-90 ms with a 40 % allowance for a clipped onset; thresholds raised to 16000/8000/5000 (softest tap measured 10474, quiet room peak 2339); claps also pass, so the node now reports a brightness measure `hf` with each knock (KNOCK grows to 11 bytes) and a limit waits for measured values. Not yet re-run on the node.
- Round 3: Sam's lightest taps peak near 8000 and below on the device, so thresholds are back to 8000/4000/3000 (medium 4000 caught 34/34 in round 1; quiet room peak 2339).
- Round 4: in 11 minutes of button-only play at full volume the node sent 36 stray knocks, about 15 with a button edge in the same second, loud and bright. The service now also drops a knock while the button is down, from 60 ms before an edge, or up to 200 ms after one (no reflash), and counts them as `node.knockGuarded`. Pulsar leaves out a tap beat within 0.45 s of a button beat's end (about one tap beat in six), so the guard never eats an on-time tap. Not yet run on the device.
- Pulsar removed from the console at Sam's request after playing the tap lane (2026-10-01): its catalog entry and its place in the PLAY sector are gone, so it is off the dashboard and the voice command `rhythm`. The tap-lane changes are reverted; `web/apps/pulsar.js`, its tests and its registry factory stay, so restoring it is the catalog entry alone (see `fleet-notes/reports/knock-input.md`). Knock input itself stays; no game uses it now.
- 2026-10-03: knocks are ignored while the console plays a tone under 140 Hz (the Pi's beep test on the new node: only 98 and 110 Hz shook the case into taps). Tap direction for the two-microphone node: KNOCK_CLIP (type 10) carries each tap from both microphones; `vesper/tapdir.py` measures it and places it by the node's own calibration (Calibration > TAP DIRECTION), giving `side` (back, left or right; back is the main tap) on the knock event or nothing when unsure. Firmware is the Pi thread's (PR #19). Not run on the device.
- Save slots (PR #16's shell API): Meridian sets `saveSlots`; `slotSummary` shows the furthest stage and stars lit. Merged #16 again; Meridian is in #16's LAMPS sector.
## 2026-10-01 — The Stacks, a book library (desktop, not verified on the device)

- New app `library` (THE STACKS, `web/apps/library.js`) and service module `vesper/library.py` with `GET /api/library`, `GET /api/library/{book}/{chapter}` and the commands `library_import` and `library_fetch` (docs/PROTOCOL.md). Tap turns the page, hold-and-release opens the reader's menu (previous page, chapters, auto-turn at 160/220/300 words a minute, text size, shelf). Lamps: a low amber bar of the chapter, cyan filling while a hold is counted, a cyan dot walking to the next auto-turn.
- Books: DRM-free EPUB, plain text (Gutenberg licence trimmed), a Kindle `My Clippings.txt` as a book of highlights. Kindle purchases (AZW/AZW3/KFX) and DRM EPUBs are listed as locked with the reason; nothing removes DRM. Amazon withdrew Download & Transfer via USB in February 2025, so there is no legitimate export of Kindle book text.
- Reading places are saved per book in the app's progress, versioned (`v: 1`, `migrateSave`), at most 30 books (tests/library.test.mjs). The menu gesture's two taps turn pages that are taken back (AppGuard).
- The download and USB import could not be exercised from the desktop (no network to gutenberg.org here, no USB drive); both are covered by tests with fakes only.
- 2026-10-03: fifteen Standard Ebooks classics ship in `books/` (3.4 MB, text only, CC0; `scripts/pack-books.py`), listed after Sam's own books. MORE CLASSICS now fetches sixteen more Standard Ebooks titles from GitHub (which the Pi already reaches to update) instead of Project Gutenberg. The shelf is drawn as spines (width by length) with a card for the chosen book; a new book opens at its first chapter, past the title page.
- Save slots (PR #16's shell API): Relay sets `saveSlots`; `slotSummary` shows the furthest stage and rhythms learned. Merged #16 again; Relay is in #16's LAMPS sector.
