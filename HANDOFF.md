# VESPER-9: start here (handoff, 2026-10-03)

Written 2026-10-03 for an agent taking over with no access to the original project chat, its
memory or its shared files. Everything those held that you need is here or in
`docs/handoff/`. Every PR fact below was checked against GitHub on 2026-10-03 at about 03:10
UTC; where the old notes said something that GitHub doesn't show, this file says so.

**Nothing on any open PR has been merged to `main`, and nothing below has been verified on the
device unless it says so.**

## 1. What Vesper 9 is

A one-button game console. Sam (GitHub `SamuelAirs`, the owner) runs it on a Raspberry Pi 5
"cyberdeck" (1024 × 600 screen, battery pack). All input comes from a small ESP32-S3 **node**
in a case: one arcade button, lamps, microphones, and taps on the case. `web/` is the browser
front end, engine and apps (games and tools), `vesper/` is the Python service the browser
talks to, `firmware/` is the ESP-IDF node firmware.

The goal Sam set: deep, replayable games, useful tools and an intuitive one-button UI. His
standing direction is that every game keeps deepening until it feels like its own game you
can sink time into, and visuals should improve across the board.

Read next, in order: `AGENTS.md` (project rules; note it still describes the old node),
`fleet-notes/START-HERE-DESKTOP.md` (set-up, the 8 verification suites, desktop vs Pi
split), `docs/ENGINE.md` (app contract), then this file's PR table.

The public web simulator is https://samuelairs.github.io/vesper9/, rebuilt by
`.github/workflows/pages.yml` from `main` on every merge. It shows only what is merged. The
repo is public, so never commit secrets, Wi-Fi details or Sam's data.

## 2. Hardware: the new node (since 2026-10-02)

Sam replaced the original node (3 lamps, 1 mic, SHT3x temperature/humidity sensor). The
original design is ditched. `main` still describes and supports only the old node; the new
node's support is on PR #19.

| Part | New node ("board 2") |
| --- | --- |
| MCU | ESP32-S3 N16R8 (16 MB flash, 8 MB PSRAM), MAC dc:da:0c:14:8f:c0 |
| Mics | Two I2S mics: left SCK/WS/SD = GPIO 4/5/6, right = GPIO 47/45/21, sampled on a shared clock |
| Lamps | Four RGB lamps. 1 (left) 7/15/16; 2: 17/18/8; 3: 9/10/11; 4 (right) 13/14/3. G and B are swapped on the device vs Sam's table; firmware handles it |
| Board LED | WS2812 on GPIO 48. An optional extra accent a game may drive, **not a fifth lamp** (Sam) |
| Button | Across GPIO 12 / GPIO 46 |
| Sensor | None. No temperature or humidity |
| Case | Fully assembled 2026-10-03, not symmetrical |

A full 16 MB flash backup of the node as found is on the Pi at
`vesper9/backups/node2-as-found-20261002-125315.bin` (never commit `backups/`).

Firmware 0.2.0 (PR #19, `scripts/build-firmware.sh 1|2`, `NODE_BOARD` in
`firmware/main/hardware.h`): board profile 2 = 4 lamps, 2 mics, no SHT3x. The node on the Pi
is flashed with the #19 firmware including KNOCK_CLIP (the Pi thread reported this; the
firmware commits on #19 came from the Pi).

Protocol v1 additions (PR #19 and #4, `docs/PROTOCOL.md` on those branches):

- LEDS / PATTERN take 9 or 12 values. MIC 2 = stereo AUDIO2 (type 9). BOARD_LED node command
  type 23, never part of LEDS/PATTERN, off unless a page sets it.
- KNOCK (from #4) and KNOCK_CLIP type 10 (node → Pi): u64 at_us, u8 pre (16), u8 channels = 2,
  176 frames interleaved s16 L,R (714 bytes), sent right before its KNOCK. Clips can be
  ignored now that tap direction is off.
- Browser WS page commands: `leds {values 9|12}`, `pattern {steps[{ms, values 9|12}], repeat}`,
  `board_led {values [r,g,b]}`; `state.lamps = {count 3|4, values, board [r,g,b]|null}`.
- Three-lamp games on the new node map left = lamp 1, middle = lamps 2+3, right = lamp 4.

## 3. How it runs and deploys

- The Pi runs the console as `vesper.service` (systemd user unit, loopback port 8799) from a
  checkout under `~/VESPER-9-v0.2.0-Claude/` (main checkout `vesper9`, live checkout `live`).
  `fleet-notes/START-HERE-DESKTOP.md` has the normal "pull `main` and restart" deploy.
- **Right now the Pi is not running `main`.** On 2026-10-03 01:19 UTC the Pi session built a
  local integration of every draft PR head (all except #2 Descent) and deployed that, with
  Sam's saves intact. That integration commit (f3bfacc per the notes) exists only on the Pi.
  Screen blanking is disabled permanently on the Pi.
- Work split. Cloud/desktop: games, engine, service code, tests, docs, headless browser tests.
  **Pi only:** node firmware, serial and flashing, the live console, Sam's data, deploys, and
  the Vosk vocabulary test (`tests/test_commands.py`; every voice name must be a word in the
  Vosk small model's vocabulary).
- The Pi's Claude session (Remote Control, folder `~/VESPER-9-v0.2.0-Claude`) is offline. When
  it couldn't push to GitHub it dropped git bundles that a cloud session pushed to #19.
- Verification before anything merges to `main` (the Pi deploys `main`; the repo has no CI):
  the 8 suites in `fleet-notes/START-HERE-DESKTOP.md`. Known state of `main` (checked
  2026-10-03): `node --test tests/*.test.mjs` passes 818 of 819; the one failure is the
  Perihelion "planning bot crosses every region" test (seed 3003), which PR #1 fixes per its
  thread.

## 4. Repo conventions

- One agent per file. Shared code (`web/main.js`, `web/engine/*`, `vesper/*`, the catalog) has
  one owner at a time. Each game is one file in `web/apps/` with one test file.
- `vesper/catalog.json` owns app metadata, sectors and voice names; regenerate the browser
  copy with `python3 scripts/build-catalog.py`, never hand-edit it.
- Saves must be versioned and migrated, with a test that loads the previous version's save.
- `docs/WORKLOG.md` is append-only: on conflict keep both sides.
- Reports must say they weren't verified on the device.
- Menu gesture everywhere: tap, tap, hold. Menu navigation: short release = next, hold release
  = select.
- Timing games read `ctx.settings().latencyMs` (TIMING OFFSET in Calibration, PR #16).
- **Save slots** (PR #16, `docs/ENGINE.md` "Save slots" on #16): a game sets
  `static saveSlots = true`; `ctx.progress()` / `saveProgress()` use the active slot; slot 1 is
  the existing save; `ctx.slot()` gives `{index, count: 4, fresh}`; optional
  `slotSummary(value)` labels the slot row; the shell owns the SAVE SLOT menu; progress ids
  are `<id>#2..4`.
- **Four lamps** (PR #16): lamp helpers and director for four lamps, `ctx.lampCount()`, a
  fourth header lamp, and the board LED as a separate accent. Game PRs merge #16's branch in to
  get them.

## 5. Open PRs (all drafts, none merged; #13 Pages is merged)

"Has #16 at" = the newest #16 commit the branch contains. #16's head is 923ddab.

| PR | What | Branch → base | Head | Has #16 at |
| --- | --- | --- | --- | --- |
| #1 | Perihelion (hangar, regions, tricks, upgrades) | `claude/project-thread-75rcgd` → main | b9dfe20 | 91e0851 |
| #2 | Descent hopper rebuild (**on hold**, off the dashboard) | `claude/project-thread-1ffgjt` → main | c43f0f3 | none |
| #3 | Moonrunner hill-flyer | `claude/project-thread-9byw8y` → main | 666d427 | 91e0851 |
| #4 | Knock (tap) input; Pulsar removed | `claude/project-thread-79km6i` → main | d78cfc0 | 7d468d9 |
| #5 | Orbit Lock, Ricochet, Light Trial | `claude/orbit-ricochet-lighttrial-b7eggj` → main | 3770a42 | 91e0851 |
| #6 | Ballista launcher | `claude/ballista-launcher-m84hzy` → main | b255b4c | 91e0851 |
| #7 | Echo Vault and Glyph Archive as learning games | `claude/learning-games-zz2pnu` → main | 34fd64b | 91e0851 |
| #8 | Tideline (ditched, hidden) and early Outpost depth | `claude/tideline-outpost-depth-l5bknl` → main | e14cc9d | none |
| #9 | Meridian (new lamp game) | `claude/new-games-w64cos` → main | 6a4e351 | 91e0851 |
| #10 | Undertow (Helix removed) | `claude/helix-undertow-ty5z3p` → main | 41b56e6 | 91e0851 |
| #11 | Dashboard sectors, catalog | `claude/dashboard-tidy-ke38p5` → main | 6b75fba | (in #16) |
| #12 | The Stacks library + Encyclopedia | `claude/library-djsrv6` → main | c4cf082 | none |
| #14 | Relay (call-and-answer rhythm) | `claude/relay-w64cos` → main | 17c39a1 | 91e0851 |
| #15 | Outpost long game (lead) | `claude/outpost-lead-kasrgw` → #8's branch | a61e59e | none |
| #16 | Platform polish (shell, menu, slots, four lamps, logbook) | `claude/platform-polish-2t56t4` → main | 923ddab | — |
| #17 | Outpost sound and lamps | `claude/outpost-sound-lamps-ab8zzw` → #15's branch | ac586a4 | none |
| #18 | Outpost visuals | `claude/outpost-visuals-kbqt4v` → #15's branch | d14b760 | none |
| #19 | New node: firmware 0.2.0, four lamps, two mics, board LED | `claude/second-node-firmware-wjv0f9` → #4's branch | b9079f1 | none |
| #20 | After Hours: Crawlspace, Supper Club, Pocket Links, Night Grid | `claude/project-thread-v82g5q` → #16's branch | d800b42 | 7d468d9 |
| #21 | High Bar skate-park trick game | `claude/swing-tricks-game-atb3k6` → #16's branch | 6c5cdf9 | a7c857a (early) |

### Per PR: state and next step

Latest playtest notes from Sam (2026-10-03 00:38 UTC) were answered by the commits named here.
None of those commits has been played on the device except as part of the Pi's 01:19 deploy,
which Sam hadn't reported on.

- **#16 platform** (owner of `web/main.js`, `web/engine/input.js`): has the menu fix (tap, tap,
  hold no longer reopens the system menu, c99feaf), the save-slot API, four lamps and the board
  LED, full-screen play, TIMING OFFSET, the console logbook, and #11 up to 6b75fba (merged in
  923ddab). **Still directional:** tap navigation outside games uses `event.side` (left/right
  moves the highlight, back pairs go back, 2e49276). Next: rework to an undirected tap (see §7),
  and restore the low-tone knock mute (see §7).
- **#11 dashboard**: sectors, Atmosphere and the temperature/humidity readout removed, Tideline
  and Descent off the dashboard, TOOLS = lantern, cadence, oracle, morse, library, encyclopedia
  (full; another tool needs a new page or a swap). Done; merges first.
- **#4 knock**: service-side knock, KNOCK_CLIP decoding, tap-direction classifier
  (`vesper/tapdir.py`) and Calibration > TAP DIRECTION, low-tone knock mute, two tap fixtures
  in `tests/fixtures/tap-direction-2026-10-0{2,3}.json`. Merged #16 up to 7d468d9 (d78cfc0).
  **The merge lost the low-tone mute**: `web/engine/audio.js` still records `shaking()`, but
  nothing calls it any more (it was in `Vesper.event()` in `web/main.js`, commit dbf08e7).
  Next: make any tap count, take TAP DIRECTION out of Settings and first-run setup, keep the
  classifier and `event.side` dormant (see §7), merge #16's newer head.
- **#19 new node**: firmware 0.2.0, service support, `scripts/node-probe.py`, console freeze
  fix (77b703e), KNOCK_CLIP firmware, and a merge of #4 at 370274e. All four Pi bundles are on
  it (bundle 4's tip b9079f1 is the head; bundles 1-3's tips a24e5c6, 77b703e, ba11dd7 are
  ancestors). Lamps, button, both mics and board LED were confirmed on the device by the Pi
  session on 2026-10-02; tap direction was tried live and dropped. Root cause of an occasional
  0.5 s node pause is unknown. Next: when #4 moves, merge it in (the Pi did this so far, but any
  session can; use a merge, not a rebase).
- **#1 Perihelion**: suns thinned in the Cluster (Sam: "too densely populated, too easy"),
  lamp 4 = the button's lamp, LAMPS guide, 4 save slots. Next: tap if it fits; Sam's playtest.
- **#3 Moonrunner**: no skipping over curves, fairer steep dives (Sam bounced where a perfect
  slide felt due), harder, four lamps, 4 save slots. Next: tap; Sam's playtest.
- **#5 Orbit Lock / Ricochet / Light Trial**: Ricochet turns faster (Sam: too hard), lamp IV
  in all three, save slots for Orbit Lock and Light Trial (not Ricochet). Next: tap; playtest.
- **#6 Ballista**: lamp 4 = landing lamp, board LED as a chain accent, save slots with their
  own workshop. Sam: "pretty much what I asked for". Next: tap; playtest.
- **#7 Echo Vault and Glyph Archive**: save slots and a four-lamp pass (lamp 4: Echo = vault,
  Glyph = card type). Waiting on Sam: is lamp 4 readable? Next: tap.
- **#8 Tideline**: Sam ditched Tideline 2026-10-03; e14cc9d hides it (code and saves kept).
  Merge it only because the Outpost stack is built on it. On the catalog/sector lines take
  #11's layout.
- **#9 Meridian**: directions, a guide light, swing across four lamps, save slots (Sam didn't
  understand the game). **#14 Relay**: tap marks on the line, lamp 4 keeps the beat, save slots
  (Sam: "my circle goes a good way before the line"; check the fix answers that). Both from the
  "Design and build new games" thread. They carry an old copy of #11's catalog test, superseded
  when #11 merges. Next: tap; playtest.
- **#10 Undertow**: fish catchable (Sam: impossible to catch), harder dives (Sam: too easy),
  lamp 4 = creature finder, save slots. Next: tap; playtest.
- **#12 The Stacks + Encyclopedia**: 15 classics, drawn shelf of spines, Standard Ebooks
  classics, offline Simple English Wikipedia (Kiwix). Sam: "so good", wants more utilities
  like it (pitched: Knot Atlas, Field Cards, Daily Dispatch; nothing built). Pi set-up still
  to do: `.venv/bin/pip install -e '.[encyclopedia]'`,
  `python3 scripts/get-encyclopedia.py --data <the live service's data folder>` (about 1 GB
  from download.kiwix.org; ask Sam first, check disk), and the Vosk check for "encyclopedia".
  Kindle purchases can't be imported (DRM); never strip DRM.
- **Outpost stack #15 → #17, #18** (mechanics contract: `docs/handoff/outpost/outpost-plan.md`
  and `docs/handoff/memory/outpost-long-game.md`): #15 is save schema 6 with sites, soundings,
  THE CALL, the workshop and save slots. #17 has lamp 4 = music lamp. **#18 (visuals) predates
  the save slots and the four-lamp pass** and its base is #15 at de4f9b0, not #15's head.
  Sam: "fun, enjoys it most". Waiting on Sam: should a second save offer later starting
  points? Next: tap (the lead decides how), merge #15's head into #17 and #18.
- **#20 After Hours** (four games ChatGPT built from the game kit; original zip review in
  `docs/handoff/after-hours/REVIEW.md`): reworked after Sam didn't understand Crawlspace,
  Supper Club or Night Grid: tap = next choice, hold 0.5 s and release = do it, HOW TO PLAY on
  first launch, lamp 4 roles, Crawlspace save slots. Pocket Links "needs a little polish":
  Sam never said what. Next: tap; Sam's playtest. Retarget to `main` after #16 merges.
- **#21 High Bar** (Sam's swing-tricks idea; he picked the skate park): ARCADE page, voice
  "high bar" / "skate" (passes the Pi's Vosk test), 3 save slots. A perfect bot scores 40k+,
  so it may be too easy. Built on an early #16 (a7c857a): merge #16's head in before relying
  on save-slot labels or lamp changes. Next: tap; Sam's playtest; retarget after #16.
- **#2 Descent**: on hold since 2026-10-01 ("still not very fun"). Don't restart unless Sam asks.

## 6. Merge order and known conflicts

Order: **#11, #16 (contains #11), #1, #4 (after merging #16's head), #19, then games**
(#20 and #21 after #16; #8 before #15, then #17 and #18). Re-run the 8 suites after each.

Known conflicts:
- `docs/WORKLOG.md` everywhere: append-only, keep both sides.
- Catalog and sector lines: take #11's layout. #10 catalog vs #16; #20 catalog/sector lines vs
  #11; #8's Tideline-hide vs #11; #21's ARCADE slot vs #11's Descent removal (keep both). #12
  adds to TOOLS, no sector edit. #6 should land with #11.
- #16's `main.js` / `input.js` vs #4's knock code (#4 already merged #16 at 7d468d9).
- #9 and #14 carry an old #11 test copy (superseded on merge).

**Still undecided by Sam:** who merges. Recommended: Claude merges each draft after Sam OKs
that game on the console; the alternative is Sam merges.

## 7. The interrupted wave: tap in navigation and games

At 2026-10-03 01:24 UTC Sam decided (after calibrating tap direction live: back 5 right / 1
wrong / 4 unsure, left 10/0/0, right 5/3/2):

> "tapping between left and right isn't really distinguished. Let's change it to just any tap
> is registered, and I'll mainly tap the back of the case. Make sure tap is built into the
> games that can use it as well as navigation"

Every thread was told at 01:25 and almost every one then stopped on the organization's usage
spend limit (01:27). **None of this is on GitHub yet**; no app on any branch implements
`knock()`. What's left:

1. **#4 (service side):** every detected knock counts as a tap, whatever its side. Take TAP
   DIRECTION out of Settings and out of first-run setup, so taps need no calibration. Keep
   `vesper/tapdir.py` and `event.side` dormant (they cost nothing). Firmware needs no change;
   KNOCK and KNOCK_CLIP are still sent.
2. **#16 (navigation and API):** stop using `event.side` in `InputRouter.knock()`
   (`web/engine/input.js`, not `web/input.js` as some notes say). Pick one mapping for an
   undirected tap that can't collide with tap, tap, hold; the suggestion was one knock = next
   row, two knocks = back. Document in `docs/ENGINE.md` that any knock is a tap and games must
   ignore `side`. In the simulator K is a knock (J/I/L can become plain knocks).
3. **#16 (lost fix):** put the low-tone mute back in `Vesper.event()` in `web/main.js`:
   `if (e.type === "knock" && this.synth.shaking()) { this.knocksMuted = (this.knocksMuted || 0) + 1; return; }`
   with `web/engine/audio.js`'s `noteShake()`/`shaking()` from #4 (dbf08e7). The Pi's beep
   test (`docs/handoff/knock/tone-sweep-node2.log`) showed only 98 and 110 Hz tones shake the
   case into taps; the mute covers tones under 140 Hz plus 250 ms.
4. **Games:** each game that can use a tap gets one through `knock(event)` (ignore
   `event.side`; expect it 90 to 120 ms after the tap; games must still work with no knocks).
   Sent to #1, #3, #5, #6, #7, #9/#14, #10, #15 (lead decides for Outpost), #20 (and the game
   kit guide), #21, and #12 if it fits.
5. Then the Pi rebuilds and redeploys the console, and #19 merges #4's new head.

## 8. Sam's decisions and verdicts

Decisions:
- 2026-10-01: temperature and humidity are not game inputs; the mic only where it genuinely
  improves a game; case input is soft taps only.
- 2026-10-02: repo public, GitHub Pages on. New node; wants good speech and a controllable
  board LED. Board LED is an optional extra accent, not a fifth lamp. Descent off the
  dashboard. All four ChatGPT games go on (AFTER HOURS page).
- 2026-10-03: Tideline ditched. Temperature/humidity utilities removed. Four-lamp pass done
  together with playtest fixes. Case finished. Swing game = skate park (High Bar). Stacks gets
  the Encyclopedia and stays in TOOLS. Console screen never blanks. Tap direction dropped; any
  tap counts; tap in navigation and games. Most games should have save slots.

Verdicts (latest 2026-10-03):
- Good: Perihelion (sometimes too easy), Ballista, Orbit Lock, Light Trial, Pocket Links,
  The Stacks ("so good"). Outpost: fun, the one he enjoys most.
- Needs work: Undertow, Ricochet, Moonrunner, Meridian, Relay, Crawlspace, Supper Club,
  Night Grid.
- Ditched: Pulsar, Helix, Tideline. Shelved: Kiln. On hold: Descent.

How Sam works: he playtests on the console and posts per-game notes; pace, flow, rhythm and
fair difficulty matter most; games must teach themselves (instructions, what the lamps mean).
He likes being asked to approve a plan before a new wave of work.

## 9. Waiting on Sam

1. Playtest of the console as deployed 2026-10-03 01:19 (every draft), and later of the tap
   wave once it lands.
2. Who merges (see §6).
3. Outpost: should a second save offer later starting points?
4. Pocket Links: what polish he wants.
5. Echo Vault / Glyph Archive: is lamp 4 readable?
6. OK to download the ~1 GB Encyclopedia on the Pi.
7. A usage limit raise, or the next usage period, before threads can resume (the 01:27 stop).

## 10. Files in `docs/handoff/`

Copied from the project's shared folder on 2026-10-03 (paths in them that start with
`/mnt/project-files/` refer to these copies). Screenshots, the Pi git bundles (all on #19),
the raw tap-clip zip (its data is in #4's test fixtures) and the original After Hours zip
(its games are on #20) were left out.

- `game-kit/GAME-KIT.md` (+ `beacon/` reference game): the self-contained guide for outside
  chatbots to build Vesper games, updated 2026-10-03 for four lamps and save slots (the tap
  update was asked for but not done).
- `plans/next-steps-2026-10-02.md`: the plan and playtest checklist Sam approved.
- `reviews/`: independent platform review and Perihelion review (2026-10-02).
- `knock/`: knock device-test history (rounds 1-5, tap direction), tap-direction findings and
  session data, the beep test log.
- `outpost/`: Outpost mechanics plan (the contract for #17/#18) and map.
- `after-hours/REVIEW.md`: review of ChatGPT's After Hours games.
- `ideas/`: game, UI and performance ideas pitched 2026-10-02, and a frame-time check script.
- `platform-polish/platform-polish.md`: #16's notes.
- `claude-mod/`: `vesper-link`, a Claude Code mod plus Python bridge that gives Claude Code a
  Vesper look with the node's lamps and push-to-talk. Built for the old node, verified only
  off-device, never in this repo before. `INSTALL-PROMPT.md` is for an agent installing it.
- `memory/`: the project's memory notes as they stood (MEMORY.md is the index). They were
  written for agents inside the project chat; ids like `cmsg_…` refer to that chat and aren't
  readable from here. Where they differ from this file, this file was checked against GitHub.
