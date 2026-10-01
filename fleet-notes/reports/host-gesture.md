# host-gesture: one menu gesture everywhere, tidy dashboard

## 1. Outcome

The console now has one way into the system menu, **tap, tap, hold**, in all 26 apps and on the dashboard. It replaces the four-click gesture, the three-click option and the `escape: "hold"` three-second hold. Every game, Signal School and Cadence takes back what the two taps and the start of the hold did, and a shared test proves it for all fifteen games. The dashboard is built from explicit named sectors (games first, then instruments); Calibration, Node Scope and Telemetry moved to a SYSTEM TOOLS sub-menu; Ephemeris is retired from the dashboard. The four host fixes from `review-tools.md` are done. All the required test commands pass. Nothing was tried on the real button.

## 2. Details

### The gesture (web/engine/input.js)

| pace | tap (press, ms) | pause between presses (ms) | hold of the third press (ms) |
| --- | --- | --- | --- |
| quick | 8..120 | <= 180 | 900 |
| **standard (default)** | 8..150 | <= 220 | **1000** |
| relaxed | 8..220 | <= 320 | 1100 |

- Spacing is judged on the node's `at_us` stamps (local clock for keyboard). The hold is judged on the host clock while the press is down. If a burst delivers the whole third press at once and its stamps show a long enough hold, the gesture completes on the release instead.
- **Exactly two** quick taps arm the hold. One tap, three or more taps in a row, a slow tap or a long pause never arm it, so rapid-tap games keep their long holds. A game has no plain-hold escape at all any more.
- Input stays immediate: tests assert three `down`s and two `up`s reach the app, then `requestMenu` is called when the hold reaches the threshold, and the third release is consumed.
- Thresholds are a best guess: standard 150 / 220 / 1000 ms. I chose 1000 ms (the middle of the 0.9 to 1.2 s range) for standard, 900 for quick and 1100 for relaxed, so the three paces differ the same way their tap limits do.

### One entry point (web/main.js)

`Vesper.requestMenu(source, { focus })` is the single way into the system menu. It is called by the gesture (`"gesture"`), the Escape key (`"key"`), the PAUSE button (`"button"`), the voice command (`"voice"`), the interruptions (`"interrupt"`: link loss, node reset, hidden page) and the plain-hold fallback (`"hold"`). It restores the highlight (when asked), then `systemMenu()`/`openMenu()` cancels held input and blocks until its release, calls the app's `cancel()` then `pause()`, and releases the lamps. A future knock event only needs `case "knock": this.requestMenu("knock")`; not implemented, as asked. `host-browser.cjs` checks four live sources with a held press: menu opens, press cancelled, release consumed, nothing chosen.

### Navigation contexts: the two-threshold rule

In the dashboard, instruments and menus a tap advances and a release at or after `holdMs` (650 ms default) chooses. The gesture there:

- arms under the same tap and pause limits as in a game (taps <= `tapMs`, pauses <= `gapMs`);
- needs a hold of `max(pace hold, holdMs + 350)` (`gestureHoldMs`): 1000 ms at the defaults for quick and standard, 1100 ms relaxed; 1350 ms if `holdMs` is set to 1000, up to 1550 ms at `holdMs` 1200;
- when it completes, the host puts the highlight back where it stood before the first tap (the router takes `focusMark()` at the first press; restored by id if the list was re-rendered, else by row), opens the menu, and the release chooses nothing.

So "tap, tap, choose" still works: a release between 650 ms and (threshold - 1 ms) chooses, however fast the taps. Measured with the router harness (`tests/gesture.test.mjs`) at all three paces: five deliberate-stepping patterns (taps 80 to 140 ms, pauses 90 to 500 ms, including taps and pauses exactly at the pace's limits) times four holds (650, 700, 800, threshold - 50 ms): all 20 per pace chose and none opened the menu. With `holdMs` 450, 650, 1000 and 1200, a hold 20 ms short of the threshold chooses and one 20 ms past it opens the menu. Slower stepping never arms. A plain 3 s hold still opens the menu silently in navigation contexts only.

Feedback: the control-deck hint line (`MENU: ●○ TAP AGAIN`, `MENU: ●● NOW HOLD`) shows the taps; the hold bar fills during the third press; in a menu, past `holdMs`, the title says RELEASE TO SELECT / KEEP HOLDING FOR MENU. Lamps (`ambient.js`): one cyan lamp per tap, left to right; during the third press the two stay lit and the right lamp fills white.

### Signal School and Echo Vault

- Signal School: the sidetone stops once a press exceeds five dot lengths (`toneCapMs`): 600 ms at 10 wpm, 960 ms at 5, 192 ms at 25. The screen then reads MENU GESTURE / KEEP HOLDING when the router says a third press is being counted (`ctx.menuGesture()`, new). A long press is still a dash. Echo Vault stops its tone at 0.75 s (`ECHO_TONE_CAP`; its longest pulse is about 0.7 s) and announces the gesture the same way. Worst case for the ear: two short beeps and one tone of that length.
- Keying never triggers it. The test keys 11 phrases (including "dot dot dash", S O S, PARIS) with nominal timing and with 25 % jitter at 5, 10, 15, 20 and 25 wpm at all three paces (more than 2000 elements): 0 menus. Why it cannot happen: a dot is only a tap if it is at most `tapMs` (150 ms at standard, so from 8 wpm up), and the dash after it is 3 units, at most 450 ms (660 ms in the relaxed pace), well under the hold. At 5 wpm a dot is 240 ms, longer than any pace's tap limit, so those dots are never taps.
- Behaviour change worth knowing: a half-keyed letter is no longer wiped when the menu opens (`pause()` used to clear it); it and its letter-gap timer keep their place.

### Per-app tolerance (all 26 apps)

`GestureTimeline` (recognition) and `AppGuard` (snapshot and put back) live in `web/engine/input.js`. `AppGuard` copies every plain-data property of an app and the context's random generator at each press, puts them all back (deleting properties made since) when `cancel()` follows the gesture, and holds `ctx.score()`/`ctx.saveProgress()` back only while a gesture that began at an earlier press could still complete (a quick tap just released, a press that may still be a tap, a third press held after two quick taps); then it lets them through, and a completed gesture drops what was made since its first tap. An ordinary save is not delayed.

| app | mechanism | what the gesture did before, and the result now |
| --- | --- | --- |
| Orbit Lock, Moonrunner, Undertow, Glyph Archive | existing `GestureGuard`, recognition rewritten; **fixed a double-record bug** | A run that had ended earlier could be recorded while the longer gesture was under way and then recorded again after the rewind restored it. Runs now carry ids, so that cannot happen. State restored, deaths during the gesture undone and never recorded. |
| Echo Vault | `AppGuard` | Pulses entered by the taps could end the run and record it. Restored. Resume replays the current signal, as before. |
| Light Trial | `AppGuard` (also gained an `up()` so the guard sees releases) | A tap at "go" could record a genuine reaction; a tap while waiting was a false start. Restored; an armed trial returns to the title on pause, as always. |
| Signal School | `AppGuard` | Dots keyed, listen-mode answers chosen, lessons advanced. Restored, including the half-keyed letter. Lesson saves held back while a gesture could still take them back. |
| Pulsar, Perihelion, Descent, Ricochet, Helix, Ballista | `AppGuard` | Stray taps cost stability, tethers flung the probe, thrust drifted the lander, a paddle reversal or a turn, a wasted shot. All restored. Helix's search tables are skipped (scratch). The freeze-on-long-hold in Helix and Ricochet stays; their "three-second" comments and Helix's hint were reworded. Ricochet's old "give a lost ball back" rule stays. |
| Tideline | `AppGuard` | At the shore, tap opened the gear menu, tap stepped, and the hold **bought the highlighted item at 650 ms**, before the gesture could complete. The purchase, a catch and the save are now taken back. Its own fish shield stays. |
| Outpost | **no change** | Taps are gathers (the point of the game); the ring opens at 0.42 s of the hold; purchases happen only on a release, which the host swallows. The test pins screen, machines, upgrades, bearings and tree. Documented exceptions: the two gathered taps keep their signal, and Outpost's own leave-saves (cancel and pause each save) happen. |
| Cadence (instrument) | `GestureTimeline` in `cadence.js`, 17 lines | Its raw button edges set a tap tempo and a lap on each short press. `cancel()` restores `tap`, `bpm`, the beat anchors and truncates laps. Slow taps or a short hold are not mistaken for the gesture. |
| Other instruments | host highlight restore | The two taps move the highlight; the host puts it back. |

`tests/gesture-apps.test.mjs` (140 tests): for each of the 15 registered games x three paces x 0.2 s / 3 s / 9 s of play, it plays through the real router, runs tap, tap, hold, and asserts, right after `cancel()`, that the full plain-data state (for the four GestureGuard games and Outpost, their documented field lists) equals the state just before the first tap, that the random generator is put back, that nothing was saved beyond runs that had already ended, and that pause and resume change nothing. The documented exceptions are in the file: reaction returns to the title, Echo and listen mode replay the signal, Tideline's menu-done and grace flags. Mutation check: removing `guard.rewind()` from Perihelion's `cancel()` fails all 9 of its cases. Snapshot cost on this machine: 0.01 to 0.1 ms per press for every game.

Not undone by design: the best score already raised (a high-water mark), and anything an app sent straight to the service (Light Trial cancels its own trial on pause). Limit: if a whole gesture arrived inside one game step (no `update` between its presses) the guard would see no hold time and not rewind; that cannot happen with a running frame loop.

### Dashboard, system menu, catalog

Sectors (`vesper/catalog.json`: `sectors` = named groups of app ids, at most six per page; `system` = the SYSTEM TOOLS list):

1. PLAY: Perihelion, Orbit Lock, Moonrunner, Pulsar, Tideline
2. PLAY II: Undertow, Descent, Ballista, Ricochet, Helix
3. PLAY III: Outpost, Light Trial, Echo Vault, Glyph Archive
4. INSTRUMENTS: Signal School, Chronometer, Cadence, Field Notes
5. INSTRUMENTS II: Atmosphere, Lantern, Resonance, Oracle

Off the dashboard: Calibration, Node Scope, Telemetry (SYSTEM TOOLS in the system menu; Calibration is also its own entry) and Ephemeris (no card, no voice name; code and tests untouched; registered, so `vesper.launch("ephemeris")` works; noted in OPERATOR.md).

Layout with seven or eight cards (measured at 1024 x 600, `fleet/work/host-gesture/shots/dashboard-eight-cards.png`): the grid is three columns, so a third row pushes NEXT SECTOR and SYSTEM (bottom at 562 px) under the control deck (top at 529 px). Validation therefore caps a page at six. The host builds pages from the groups; "return to the card you left" uses the sector and position, and an app that is not on the dashboard (a system tool) returns to where the dashboard stood. The voice command for the next sector works unchanged (it presses the sector button); `voice.js` needed no edit. Ephemeris's voice alias `moon` is gone.

- `escape`: **accepted but ignored** in `vesper/catalog.py` (a bad value is still an error), stripped from the loaded catalog and from `catalog.js`, removed from `catalog.json`. Reason: rejecting it would break older cartridges for no gain.
- `menuClicks`: removed from the defaults and from `validate_setting` (retired). The service already ignores a stored setting it cannot validate, so an existing database loads cleanly: the key is dropped, every other saved setting survives, and the stale key leaves the database with the next settings write (tested). One log line, "Ignoring stored setting 'menuClicks'", appears at each start until then (the service file is not mine to edit). The standalone simulator drops it from its saved settings too.
- Older `sectors` lists of names still load (six apps per page in catalog order).
- Calibration: description rewritten, the "GAME MENU" row removed, "CLICK TIMING" renamed MENU GESTURE TIMING.

### Part 2 host fixes (web/main.js, web/engine/math.js)

1. Launch resets the highlight (`this.nav = { items: [], index: 0 }`), so an instrument opens on its first action whichever card launched it (host-browser check).
2. `ctx.actions(items, { focus })` highlights the action with that id (or label) after the render (check: `[2,2,1,1]` for focus three, none, two, unknown id).
3. `ctx.silentTicks(true/false)` silences the host's "advance" tick (and the step-back tick); cleared on leaving the app and on launch.
4. `Random.warm()` is what the host gives each app: a murmur-hashed seed and eight discarded draws. First-draw chi-square over 100 bins and 60 000 consecutive-millisecond launches: plain `new Random` **959**; warm **84, 107, 119, 97** for draws 1, 2, 3, 8 (99 expected). `new Random(seed)` is unchanged, so every seeded test keeps its numbers.

### Tests changed to encode the new gesture (each, and why)

- `tests/ambient.test.mjs`: three tests (fuzz inputs, hold-progress "game escape" half, click lamps) rewritten for the `gesture` press kind and one lamp per tap; one new test for the third-press fill.
- `tests/engine.test.mjs`: harness `systemMenu` became `requestMenu`; replaced `quadruple menu...`, `triple profile and long-hold exception...`, `partial, overlong, mixed-source...`, `node timestamps determine timing...`, `cancelling a partial gesture...` with tap, tap, hold versions; `Morse and Echo catalogs protect...` now asserts the `escape` field is gone; `reaction ignores stale cues...` steps 0.5 s before checking the record (it is held back while a gesture could include that press).
- `tests/host.test.mjs`: harness stub; the two F9 tests (steady four-click window and its decision record) replaced by boundary tests of the new gesture and a "three or more taps never arm" decision test; added the simulator settings-migration test.
- `tests/games.test.mjs` F1a/F1b, `tests/games-gesture.test.mjs` (table of paces), `tests/games-tuning.test.mjs` (rewind restores every field), `tests/audit/harness.mjs` (`makeRig`, new `gesture()`), `tests/audit/bots.mjs` (`gestureWithUpdates`), `tests/audit/gesture.mjs` header: use tap, tap, hold.
- `tests/kit.test.mjs`: sector check for the new shape. `tests/test_commands.py`: an app that is not on the dashboard (Ephemeris) may have no voice name. `tests/test_runtime.py`, `tests/test_service_fixes.py`: `menuClicks` is retired, defaults no longer contain it, stored values are dropped.
- Browser: `browser-smoke.cjs` (first page has five cards, first card is Perihelion, orbit is card two, new in-page gesture helper), `extension-smoke.cjs` (the example needs a sector entry; it keeps the old `escape` field to prove compatibility), `host-browser.cjs` (F10 uses the sectors; many new checks), `voice-host.cjs` (sector count, first card).
- New: `tests/gesture.test.mjs` (39 tests), `tests/gesture-apps.test.mjs` (140), `tests/random.test.mjs` (4), `tests/test_catalog_sectors.py` (12).
- `scripts/dev-shot.cjs`: new step `gesture[:MS]` (tap, tap, hold until the menu opens, timed in the page) and `gesture:hold` (leave it held to look at it).

Docs updated: `README.md` (gesture table, dashboard), `docs/OPERATOR.md` (gesture, thresholds, navigation rule, dashboard, retired Ephemeris, voice table, lamps, Calibration, Signal School), `docs/ENGINE.md` (input contract, context members, catalog sectors and system list, `escape` ignored), `AGENTS.md` (product direction), `docs/DESIGN.md`, `docs/NEXT-STEPS.md`, `docs/INSTALL.md` (Node Scope path), `docs/TESTING.md`, `docs/RELEASE-NOTES.md` (old controls marked superseded). `docs/WORKLOG.md` and `docs/validation/` are left as the record of 0.2.0.

## 3. Verification

```
node --test tests/*.test.mjs                          -> tests 730, pass 730, fail 0
$PYTHON -m unittest discover -s tests -p 'test_*.py'  -> Ran 189 tests ... OK
python3 scripts/build-catalog.py --check              -> exit 0
python3 scripts/build-demo.py && node tests/browser-smoke.cjs   -> {"passed":true,"appsExercised":26,...,"pageErrors":[]}
node tests/extension-smoke.cjs                        -> {"passed":true,"cartridge":"garden",...,"standalone":true}
node tests/host-browser.cjs                           -> 29 PASS, 0 FAIL
node tests/voice-host.cjs                             -> ALL 37 PASSED
```
`PYTHON`, `PLAYWRIGHT_PATH`, `TEST_BROWSER_BIN`, `TEST_OUTPUT` as in the rules. The Pi stayed at 68 to 72 C, one heavy job at a time. `pgrep` shows no server or browser of mine left running (the live console's service is not mine).

Screenshots in `fleet/work/host-gesture/shots/` (1024 x 600; I opened and looked at them): `dashboard-sector1..5.png` (the new sectors), `dashboard-holding.png` (two taps lit, bar filling, hint "MENU: ●● NOW HOLD"), `dashboard-menu.png`, `dashboard-system-tools.png`, `dashboard-eight-cards.png`, `perihelion-menu.png`, `morse-holding.png` (sidetone cut, "MENU GESTURE / KEEP HOLDING"), `morse-menu.png`. With `scripts/dev-shot.cjs gesture` the menu opened and the app resumed with its state intact in Orbit Lock (lives 3, points 0 as before), Pulsar (score 0, stray 0), Tideline (scrip 0, gear unchanged, menu position unchanged), Perihelion, Signal School (input restored to empty, attempts 0) and Cadence (tempo 100, no taps), and on the dashboard (highlight restored to card 3 of 7, nothing launched). Simulator and headless results only.

## 4. Not done / uncertain

- **Nothing here is verified on the real button.** What Sam should try: (a) from the dashboard and from a game, tap, tap, hold with a natural rhythm: does the menu open at about a second, and does it ever fail because a pause is too long (standard allows 220 ms; relaxed 320 ms with a 1.1 s hold)? (b) on the dashboard, step twice quickly and hold to choose: it should choose between 0.65 s and 1 s, and open the menu if held longer; (c) in Pulsar, tap two quick eighth notes and then hold a long signal for over a second: that is the one known collision (the menu opens and the game puts back the last second); (d) Signal School at 10 wpm: dot dot dash should never open it, and a long hold should go silent after about 0.6 s; (e) Tideline: tap, tap, hold at the shore should buy nothing.
- The thresholds are guesses: standard 150 ms tap, 220 ms pause, 1000 ms hold; the 350 ms margin over the selection threshold; sidetone cap 5 dot lengths (Echo 0.75 s).
- A rewound game repeats roughly the last 1.1 s (the state from the first tap), by design (the old four-click gesture did the same).
- Saves made while a gesture could still complete wait at most about a second (until the chain breaks, or at once when the menu opens or the app is left).
- The knock input is not handled; `requestMenu("knock")` is the hook. The standalone `VESPER-9-Simulator.html` is regenerated by the build and not committed.
- `cadence.js` was edited (17 lines for the gesture, 4 hint strings, one import); another agent is editing it, so expect a small merge there. `docs/validation/` still holds the 0.2.0 captures that mention the four-click escape.
- Found, outside my files: the small heading in the control deck (`#control-title`) is set to "MENU GESTURE / KEEP HOLDING" but is not visible at 1024 x 600 with the current stylesheet, so that wording shows only in the hint line, bar, lamps and (Signal School, Echo Vault) on the canvas.

## 5. Branch

`worktree-agent-a944ee7ce28ed87b3`, last commit `e941437` (one earlier commit, `752bb0a`).
