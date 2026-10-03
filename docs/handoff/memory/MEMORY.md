# Vesper 9
- Goal: build a gaming platform with deep, replayable games, useful tools and an intuitive UI, where all input comes from one node (temperature, humidity, mic, three lights, one button). New node (2026-10-02): two mics, four lights, NO temp/humidity sensor; see Hardware.
- Repo: https://github.com/SamuelAirs/vesper9 (public since 2026-10-02)
- Owner: Sam (GitHub SamuelAirs)
- Web version: https://samuelairs.github.io/vesper9/ (GitHub Pages, rebuilt from `main` on every merge; shows only what's merged).

## Current wave (2026-10-03 00:38, Sam playtest msg cmsg_01JKQ1pw6BrQyCHQgyvunKNeHDUdSQdw4hyJrcFxVKVKxZ)
- Freeze lifted for the routed items below. Every game thread does its playtest fixes + four-lamp pass now (build on #16 lamp helpers, lamp 4 gets a real role, board LED optional accent). Nothing merges.
- Routed: Perihelion #1; Outpost lead #15 (save slots); platform #16 (menu bug + shared save slots); Undertow #10; Ballista #6 (four-lamp only); Tideline #8 DITCHED; #5 (Ricochet faster turn); Moonrunner #3; new-games #9/#14 (Meridian instructions; Relay timing); After Hours #20 (teach-yourself onboarding, Pocket Links polish); Stacks #12 (more utilities, visuals, books); dashboard #11 (remove temp/humidity tools); Outpost sound+lamps #17 (Outpost four-lamp pass); Echo Vault+Glyph Archive #7 (four-lamp pass + slots).
- TAP IN GAMES (01:25, Sam msg cmsg_01JKQ1pw6BrQyCHQgyvunKNeUztxmtxKghWiTANGh8QdK6 in Pi thread): any tap counts (no sides), he'll mainly tap the back; tap built into navigation + every game that can use it. Sent to #4 (drop direction calibration, side dormant), #16 (undirected tap navigation, clear game knock API), and game threads #1, #3, #5, #6, #7, #9/#14, #10, #15 (lead decides for Outpost), #20 (+GAME-KIT), #21, #12 (Stacks/Encyclopedia if it fits). Game API: InputRouter.knock in web/input.js on #16's branch; ignore event.side; simulator K = knock.
- Pushed (not verified on device): #6 Ballista lamp 4 = landing lamp; #1 Perihelion suns spaced + lamp 4 = button lamp + LAMPS guide + 4 save slots; #17 Outpost lamp 4 = music lamp; #10 Undertow fish catchable, harder, lamp 4 = fish finder; #8 Tideline hidden; #11 Atmosphere off, SENSORS -> LISTEN; #12 Stacks classics + spine shelf + Encyclopedia (c4cf082); #7 slots + lamp 4 (Echo = vault, Glyph = card type); #20 After Hours rework (dashboard controls, HOW TO PLAY, lamp 4 roles).
- #16 head 2dac5ea+ (contains #11 616d7e8; asked 01:24 to merge #11 6b75fba = Encyclopedia slot): menu fix, save-slot API, 4th header lamp, board LED pip, tap navigation (being reworked to undirected). Knock thread passed #16 a one-line fix to restore the low-beep stray-tap mute lost in the #4/#16 merge.
- Save-slot API (#16, docs/ENGINE.md "Save slots"): saveSlots = true; ctx.progress()/saveProgress() use active slot; slot 1 = existing save; ctx.slot() {index, count:4, fresh}; optional slotSummary(value); shell owns SAVE SLOT menu; progress ids <id>#2..4 + slots. Adopted by #15, #1, #7; relayed to #3, #5, #6, #9/#14, #10, #20.
- High Bar (skate park game) = PR #21, thread "Swing and tricks game": ARCADE page, voice "high bar" passes Pi Vosk test, 3 save slots.
- Stacks: Encyclopedia (offline Simple English Wikipedia) on #12 c4cf082; #11 6b75fba adds TOOLS slot (TOOLS now full: lantern, cadence, oracle, morse, library, encyclopedia; more tools need a new page or swap). Pi setup for next refresh: `.venv/bin/pip install -e '.[encyclopedia]'` + `scripts/get-encyclopedia.py --data <dir>` (Kiwix ~1 GB; Pi will ask Sam first) + Vosk check "encyclopedia". Other pitched: Knot Atlas, Field Cards, Daily Dispatch.
- CONSOLE 01:19: Pi deployed bundle f3bfacc with every draft head (#2 Descent left out; saves intact). Screen blanking disabled permanently. Next refresh after tap changes land.
- #4 has merged #16 in (01:25). Pi to send #19 a matching bundle afterward. Publish thread pushing bundle 4.
- Still awaiting Sam: Outpost lead's card (second save offers later starting points?); Pocket Links polish wishes; Echo/Glyph lamp 4 readability; decision 4 (Claude merges each draft after Sam OKs it [recommended] vs Sam merges); playtest of new console.

## Taps (knock thread #4, Pi thread)
- DECISION 2026-10-03 01:24: side detection OFF as input contract; any tap counts. Device calibration left-out check: back 5 right/1 wrong/4 unsure, left 10/0/0, right 5/3/2. Firmware unchanged (KNOCK + KNOCK_CLIP still sent; clips can be ignored). Classifier code kept dormant.
- History: spots were left/right/back (back primary). Session 1 (L/R/top) and session 2 (L/R/back) offline results 78-93%; files /mnt/project-files/knock-tap-direction-findings.md, knock-taps-2026-10-03.zip. Asymmetric case: back/left overlap on loudness, timing separates them; didn't hold up on device.
- Beep test (/mnt/project-files/tone-sweep-node2.log): only 98/110 Hz tones cause stray knocks; console low-tone knock mute (<~150 Hz).
- KNOCK_CLIP type 10 (node->Pi): u64 at_us, u8 pre (16), u8 channels=2, 176 frames interleaved s16 L,R (714 bytes), sent right before its KNOCK.

## Earlier 2026-10-02 (plan, decisions, done)
- Plan file: /mnt/project-files/plans/next-steps-2026-10-02.md.
- 22:26 Sam (msg cmsg_01JKQ1pw6BrQyCHQgyvunKNeEScGFm7Y5T8UUrkuouhTCR): push Pi node work as draft PR; four-lamp shell layer + engine speed fix on #16; Descent off dashboard; evaluate ChatGPT games; Pi may flash freely. 22:30 (msg cmsg_01JKQ1pw6BrQyCHQgyvunKNe2i6UoCvPhU3tHgfCKdzN6v): board LED is "just an extra thing", not a fifth lamp.
- PR #19 (https://github.com/SamuelAirs/vesper9/pull/19): Pi new-node work, base #4's branch claude/project-thread-79km6i, published by thread "Publish the new node PR" (cmsg_01JKQ1pw6BrQyCHQgyvunKNeEScGFm7Y5T8UUrkuouhTCR) from Pi git bundles. Bundle 2 (77b703e) fixes 14 s console freeze. Bundle 4 /mnt/project-files/pi-node-two-mics-4.bundle (tip b9079f1 = #4 370274e merged onto ba11dd7 KNOCK_CLIP work). Root cause of node's 0.5 s pause unknown.
- PR #20 (https://github.com/SamuelAirs/vesper9/pull/20): ChatGPT "After Hours" games ([[after-hours-games]]) on AFTER HOURS page, stacked on #16. Voice names "crawl space", "night grid".
- Protocol (#19): WS page commands leds {values 9|12}, pattern {steps[{ms, values 9|12}], repeat}, board_led {values [r,g,b]}; state.lamps = {count 3|4, values, board [r,g,b]|null}; BOARD_LED node command type 23, never in LEDS/PATTERN, off unless a page sets it.

## Hardware: new node (Sam, 2026-10-02)
- ESP32-S3 N16R8 (16 MB flash, 8 MB PSRAM), MAC dc:da:0c:14:8f:c0. Full flash backup at vesper9/backups/node2-as-found-20261002-125315.bin on the Pi.
- Two I2S mics: left SCK/WS/SD = GPIO4/5/6; right SCK/WS/SD = GPIO47/45/21.
- Four RGB lamps per Sam's table: 1 (left) 7/15/16; 2: 17/18/8; 3: 9/10/11; 4 (right) 13/14/3; G and B swapped on device vs table, firmware handles it.
- Board LED: WS2812 on GPIO48; an optional extra accent games can drive, not a fifth lamp.
- No temperature/humidity sensor; Sam ditched that node design.
- Button across GPIO12 / GPIO46.
- Firmware 0.2.0 (PR #19): board profile 2 = 4 lamps, 2 mics on a shared clock, no SHT3x; LEDS/PATTERN take 9 or 12 values; MIC 2 = stereo AUDIO2 type 9; BOARD_LED command type 23.
- Console: 3-lamp games map left=lamp 1, middle=lamps 2+3, right=lamp 4. Case fully assembled 2026-10-03 (not symmetrical).

## Conventions (from fleet-notes/START-HERE-DESKTOP.md)
- Runs on Sam's Raspberry Pi 5 cyberdeck; the Pi pulls `main` and deploys it, so merge to main only after all 8 verification suites pass. Repo has no CI.
- Cloud/desktop work: games, engine, service code, tests, docs, headless browser tests. Pi only: node firmware, serial/flashing, live console, Sam's data, deploys, Vosk vocabulary test (tests/test_commands.py).
- One agent per file; shared code (main.js, engine/*, vesper/*, catalog) has one owner at a time (main.js/input.js: #16; catalog.json: #11). Saves must be versioned and migrated with a test. Reports must say they weren't verified on the device.
- Voice names must be words in the Vosk small model's vocabulary.
- Merge order: #11, #16 (contains #11), #1, then #4 (contains #16), then #19, then games (#20 after #16). Outpost stack: #8 -> #15 -> #17 and #18. Known conflicts: docs/WORKLOG.md (append-only, keep both); #10 catalog vs #16; #12 library: TOOLS (no sector edit); #6 should land with #11; #20 catalog/sector lines vs #11; #8 Tideline-hide catalog change vs #11 (take #11's layout). Game PRs merge #16's branch in for lamp helpers. #9/#14 carry an old #11 test copy (superseded on merge).
- Known failing test: Perihelion seed-3003 bot test (fails on main; #1 fixes).
- Thread sessions can only push to their own designated branch; a new branch/PR needs Sam's own OK (attach his message by id).
- Latency calibration: PR #16 TIMING OFFSET; games read `ctx.settings().latencyMs`.
- Coordinator: message_thread context_message_ids accepts Sam's messages (incl. ones in other threads) or THIS coordinator session's own posts; point at files by path instead. fetch_project_timeline can overflow; use list_thread_sessions + fetch_thread. For a console refresh, give the Pi thread the PR branch list (list_project_prs).

## Pi access
- Sam's Pi serves Remote Control; Sam starts it with `claude remote-control` in the vesper folder. Device work goes to the existing "Run Vesper on the Pi" thread (cmsg_01JKQ1pw6BrQyCHQgyvunKNeCwe5rVk8P5SWB9nBeKdpTv, cse_016MYHLZMhLY9MvjwfuEGdFE). When the Pi is offline, message_thread is held until it reconnects.
- Pi session needs Sam's words in its own thread before flashing/installing (his 22:26 message grants flashing).
- Pi GitHub push needs Sam's desktop keyring unlocked; when he's away, Pi drops git bundles in /mnt/project-files and "Publish the new node PR" pushes them to #19.

## How Sam works
- Standing direction: every game should keep deepening until it feels like its own game you can sink time into. Visuals should improve across the board.
- Sam playtests on the console and posts feedback in the project chat (or the Pi thread). Route each game's notes to the thread that owns it.
- Playtest lessons: pace, flow/rhythm and fair difficulty matter most. Games must teach themselves (instructions, what lamps mean).
- Wants save slots in most games (new saves to test new stuff). Wants case tap used in games where it fits.
- Likes utilities like The Stacks; wants more.
- Sam likes being asked to approve a plan before a new wave of work.

## Ownership (threads)
- Perihelion PR #1 ("Polish the v0.2.0 hangar and second region"), Descent PR #2 (on hold), Moonrunner PR #3, taps PR #4 ("Build knock input for the node"), Orbit Lock+Ricochet+Light Trial PR #5, Ballista PR #6, Echo Vault+Glyph Archive PR #7, Tideline PR #8 ("Deepen Tideline and Outpost"; Tideline ditched), Meridian PR #9 + Relay PR #14 ("Design and build new games"), Undertow PR #10, dashboard + catalog PR #11 ("Tidy the dashboard layout and visuals"), The Stacks PR #12 ("Build a reading library"), Pages PR #13 (merged), platform polish PR #16 ("Polish the platform from the review"), new node PR #19, After Hours games PR #20 ("Game-making guide and Pi 3B+ check"), High Bar PR #21 ("Swing and tricks game").
- Outpost team: lead PR #15 ([[outpost-long-game]]), visuals PR #18 (outpost-scene.js), sound and lamps PR #17 (outpost-music/lamps/songs).
- Game kit guide: /mnt/project-files/game-kit/GAME-KIT.md (four lamps updated 2026-10-03; tap update asked).
- Independent review: /mnt/project-files/reviews/platform-review-2026-10-02.md. Ideas: /mnt/project-files/ideas/ideas-2026-10-02.md.
- Claude Code mod: /mnt/project-files/claude-mod/ (built for old node; can update from #19). Not touched this wave.

## Game verdicts (Sam, latest 2026-10-03)
- Good: Perihelion (sometimes too easy), Ballista, Orbit Lock, Light Trial, Pocket Links, The Stacks ("so good"). Outpost: fun, enjoys it most.
- Needs work: Undertow, Ricochet, Moonrunner, Meridian, Relay, Crawlspace/Supper Club/Night Grid.
- Ditched: Pulsar, Helix, Tideline. Shelved: Kiln. On hold: Descent (off dashboard).

## Decisions
- 2026-10-01: temperature and humidity are NOT game inputs. Mic in games only where it genuinely improves the game.
- 2026-10-01: case input is soft TAPS only.
- 2026-10-02: repo public; GitHub Pages on. New node; wants good speech, board LED controllable.
- 2026-10-02: board LED is an optional extra accent games can drive, not a fifth lamp; Descent off the dashboard; all four ChatGPT games go on.
- 2026-10-03: Tideline ditched; temp/humidity utilities removed; four-lamp pass now with playtest fixes; case finished; swing game = skate park (High Bar); Stacks Encyclopedia; The Stacks stays in TOOLS; console screen never blanks; tap direction dropped, any tap counts, tap in navigation + games.
- Library: Kindle purchases can't be imported (DRM).
