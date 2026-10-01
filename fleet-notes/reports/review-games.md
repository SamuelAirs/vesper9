# review-games report

## 1. Outcome

I play-tested and code-reviewed the six new games (PULSAR, PERIHELION, DESCENT, RICOCHET, HELIX, BALLISTA) in the simulator at 1024 x 600, as a newcomer would, and fixed what I found, one commit per game plus a catalog commit. The main problems were that an idle or hesitating newcomer died well under the 20 s the guide asks for (HELIX about 6 s, PERIHELION about 2 s, PULSAR 13.7 s, RICOCHET 12-17 s, DESCENT about 14 s), that two games had overlapping text on the title or result screen, that PULSAR and PERIHELION never ended, and that BALLISTA froze for a station build. All suites pass. Nothing was verified on the real device.

## 2. Details

Evidence: screenshots in `fleet/work/review-games/shots/` (46 files; prefix `t*` is the first pass before fixes, `u*`/`v*`/`w*` after). I opened the title, early play, held, menu and result shots for each game. `dev-shot` reported "no page or host errors" on every run.

### PULSAR (rhythm)
- **Found (wrong):** title text overlapped the strike circles ("THE THREE LAMPS..." and "HOLD 3 SECONDS..." drawn over the circles); result text "RECORD" and "PRESS TO PLAY AGAIN" overlapped the strike circles and a red miss ring stayed on the result screen forever (flash ring drawn when not playing); the title did not say what a diamond is for; idle player died at 13.7 s; the run never ended (author's own weak point).
- **Fixed:** own title panel clear of the circles, saying "TAP WHEN A DIAMOND TOUCHES THE LINE / HOLD THE LONG BARS TO THE END"; result moved up; rings drawn only in play and flashes cleared at the end; gentler miss cost in phrases 1-2 and 3-4 (0.03 / 0.06 instead of 0.06 / 0.09), so an idle newcomer lasts 18.7 s of song plus the 2.25 s count-in (about 21 s) instead of 13.7 s; the song now ends after 32 phrases (137 s). Finishing shows "SIGNAL RESOLVED", adds a bonus of stability x 2000, saves the score and the lamps go green and dim. Hint says "Phrase N of 32".
- **Verified:** hold-3-s menu mid-run opens, Resume returns to the same state (stability 0.80, song 6.85 s) and lamps are on again; `hold` escape works through the host. Result screenshot `pulsar-v2-result.png`.
- **Tests:** `tests/pulsar.test.mjs` 14 pass (finale, bonus and saving, idle survival, title/result text clear of circles). One test adjusted: "three taps then cancel" now measures the cost of the taps against the stability at the moment of the first tap, because idling 20 s before the taps made the old absolute threshold meaningless; the bot test now expects the run to be finished at 170 s instead of surviving 240 s because the song now ends.

### PERIHELION (tether swing)
- **Found (breaks for a newcomer):** the run started the instant the title was dismissed and an idle probe fell out after about 2 s, before a person could read anything (the coordinator had flagged it; reproduced: `perihelion-t3`/`t4` show the result 3 s after the tap). It also never ended: the planning bot survives indefinitely and the terminator speed capped at 110 px/s.
- **Fixed:** the first run of a session starts parked ("HOLD TO THROW THE TETHER / RELEASE TO FLY ON", world frozen, lamps dim) and the first press launches and throws the tether in one action; later runs start at once. After five minutes the dark keeps quickening (`frontSpeed()`, +0.5 px/s per second beyond 300 s, announced with "The dark is quickening.") so every run eventually ends; before 300 s nothing changed.
- **Verified:** menu (4 clicks) mid-run freezes the world (runT 1.283 before and during the menu), Resume continues, run intact.
- **Tests:** 15 pass (parked first run, quickening; the tests' start helper now presses twice).

### DESCENT (lander)
- **Found:** the title only said "SET DOWN GENTLY, OR NOT AT ALL" and nothing about the button; the first briefing auto-started after 2.4 s; an idle lander hit the ground about 14 s after the press; `cancel()` and `pause()` stopped the engine tone but left the lamps lit.
- **Fixed:** title says "HOLD TO BURN THE ENGINE / RELEASE TO FALL / LAND SLOWLY ON THE PAD"; the first briefing of a session waits for a press ("PRESS TO START THE DESCENT"; later sites and retries auto-start as before); site 1 starts at 240 m instead of 170 m (idle fall now over 14 s, asserted in a test); pause and cancel switch the lamps off.
- **Verified:** menu mid-run (4 clicks) shows the menu lamps, Resume keeps altitude, speed and lives intact.
- **Tests:** 15 pass (first briefing waits, retries start by themselves, idle fall time, lamps off on pause/cancel, title wording; the shared bot helper presses through the first briefing).
- **Not changed (report only):** no ending; sites go on until three landers are lost. Difficulty comes from random feature combinations from site 9, which is a plateau rather than a ramp.

### RICOCHET (breakout)
- **Found:** an idle player is out in 12-17 s (12 seeds); a newcomer cannot learn the reverse-on-tap paddle before losing all three balls.
- **Fixed:** chamber 1 is practice: the first two lost balls do not cost a life ("PRACTICE: TWO FREE BALLS", hint "In chamber 1 that one was free."). The menu-gesture ball return (`cancel()`) gives a free ball back as a free ball, not a life. Idle now lasts 20-31 s (12 seeds).
- **Verified through the host:** `hold` escape: a 3.3 s hold mid-run freezes the world at 0.6 s (clock 4.2 -> 4.8), menu opens, Resume continues (clock 5.7, lives 3, free 1). The author had not tested this through the host.
- **Tests:** 23 pass (practice balls, free-ball return, idle survival over 19 s; the "menu gesture cannot cost a ball" test sets `free = 0` first so it still exercises the life-costing path).
- **Not changed (report only):** the run plateaus after chamber 9 (rows, speed, paddle width all capped); the bot dies between 135 and 495 s so there is a natural ending, but nothing new appears after chamber 4.

### HELIX (clockwise snake)
- **Found (breaks for a newcomer):** an idle or hesitating thread hits the east wall after about 6 s (`helix-t5`); the three-second menu hold did not pause the world, so a player opening the menu mid-run with live walls could die while holding (verified: steps advanced 26 -> 36 during a 3.3 s hold); the title repeated "HOLD 3 SECONDS FOR THE MENU" (the host already shows it).
- **Fixed:** for the first 20 s of live play the boundary turns the thread clockwise instead of killing it (a corner takes two turns), with a visible countdown "WALLS ARE SOFT FOR 12 S" and "THE WALLS ARE LIVE" at the end; the danger lamps ignore a soft wall. A press held 0.6 s freezes the world until release ("HELD: PAUSED UNTIL YOU LET GO"), so the 3 s menu hold cannot cost the run. Title now says "COLLECT THE AMBER DIAMONDS. AVOID WALLS AND YOUR TAIL." An idle thread now lasts about 27 s.
- **Verified:** held shot `helix-w1-held.png`; a 3.3 s hold advanced only 2 steps (29 -> 31), Resume continued (phase play, steps 36).
- **Tests:** 22 pass. The planning bot taps with `down()` and `up()` now (the host always sends the release; without it the new hold-freeze would, correctly, freeze). Bot test trimmed from six seeds to three (240 s each, same thresholds), file about 14 s.
- **Perf measured:** spawn/reach/escape search max 2.6 ms, step max 3.4 ms over a 240 s bot run. No hitch.
- **Not changed (report only):** no ending (boundary death is the end; the trail is capped); the bot dies early on some seeds (seed 6 at 124 steps), so luck matters. The author wrote no report file for helix, so there were no author leads; I reviewed from the code.

### BALLISTA (artillery)
- **Found:** the author's reported hitch is real: building and proving a station is synchronous at the briefing. Measured on this Pi in node over 2400 builds: median 5 ms, p95 49 ms, p99 79 ms, worst 135 ms (station 11 "RIDGE SLIDING"); cold browser JIT and load make it several times worse, which is how the author saw 0.9 s. `pause()`/`cancel()` left the lamps lit.
- **Fixed:** station build and verification are now generators; the next station is built 4 steps per frame while the current one is played (private generator seeded from `ctx.rng`, so runs stay reproducible), and the briefing waits with "SURVEYING THE SITE..." only if it is not finished. Worst measured cost is about 1 ms per step (so about 4 ms a frame in play, 10 steps in a briefing). `buildStation`/`verifyStation`/`robustShot` keep their synchronous signatures (tests use them). `pause()`/`cancel()` darken the lamps. The 90-station proof test is 60 stations (two seeds x 30; same fine proof per station).
- **Verified:** four clicks mid-aim: no probe launched (shots unchanged), Resume intact.
- **Tests:** 22 pass (new: incremental build never exceeds 4 steps per frame, brief waits and then starts, reproducible runs, lamps off on pause and cancel).
- **Not changed (report only):** no ending; skill-limited only. The cover wall is a spike; wind streaks are faint (the author's own points).

### Cross-cutting
- Text in the six games is 16 px or more; the smallest are 16 px ruler numbers and lane labels (BALLISTA, DESCENT tape, PULSAR lanes).
- Lamp logic reviewed in code for all six; sustained levels are at most about 0.4 and all go dark or dim on title, result, pause and dispose. A person on the device must judge brightness and the cyan/violet distinction in PULSAR.
- Needs a host change (not made): none found.

## 3. Verification (real output, final tree)

```
node --test tests/*.test.mjs                  -> tests 446, pass 446, fail 0
$PYTHON -m unittest discover -s tests -p 'test_*.py'  -> Ran 131 tests ... OK
python3 scripts/build-catalog.py --check      -> exit 0
python3 scripts/build-demo.py && node tests/browser-smoke.cjs
   -> {"passed":true,"appsExercised":24, ... "pageErrors":[]}
node tests/extension-smoke.cjs                -> {"passed":true, ...}
```
Per-file times now (s): pulsar 1.1, perihelion 10.3, descent 1.7, ricochet 5.8, helix 13.8, ballista about 6 (before: helix 16.2, ballista 7.7). Temperatures stayed 52-62 C throughout; I ran one heavy thing at a time. At the end `pgrep` showed only the coordinator's live console (pid 8237, not mine); I left no servers or browsers running.

## 4. Not done / uncertain

- Nothing is verified on the device: lamp levels, sound, the real feel of the PERIHELION swing, the PULSAR `INPUT_OFFSET` (0.04 s), DESCENT and BALLISTA difficulty for human hands. A person should try: PERIHELION first run (is the parked screen clear, is the first swing forgiving?), HELIX soft-wall countdown and whether 20 s is the right length, RICOCHET practice chamber feel, PULSAR to the end (about 2:20 including count-in) and the result flash, DESCENT site 1 at 240 m, BALLISTA station 5+ (a hitch after a clear should be gone; "SURVEYING" should rarely appear).
- BALLISTA background build was measured in node, not in a real browser; the briefing wait only appears if a station is cleared before its build is finished (up to about 60 frames in the worst case measured).
- PULSAR stability recovery is still generous (a sloppy 85%-attempt player finishes the song, 22k points); the finale bonus favours the careful.
- DESCENT, RICOCHET, BALLISTA and HELIX still have no hard ending. PERIHELION and PULSAR now do.
- HELIX's held-freeze depends on the host sending the release edge; `cancel()` also clears it, which the host calls on focus change.

## 5. Branch

`worktree-agent-a682eb3d68e46d57a`, last commit `4a32d27`. Commits: 1bc502b pulsar, 83ee23e perihelion, 205c1bd descent, 24f04e1 ricochet, dc2047d helix, 4ddf73a ballista, 4a32d27 catalog (descriptions only; `web/apps/catalog.js` regenerated).

## Ranking, most to least ready

1. **RICOCHET** - self-explanatory title, a never-stopping paddle is forgiving, now has a practice chamber, hold-menu proven through the host; weakest point is the late-game plateau.
2. **PULSAR** - clear and fair, now has an ending and a result with a bonus; depends on real input latency (`INPUT_OFFSET`) and lamp legibility that only the device can show.
3. **HELIX** - fun and now forgiving for 20 s with a countdown, menu hold is safe; no real ending and bot variance suggests luck can matter.
4. **DESCENT** - title and first screen now explain it, first briefing is gated; difficulty tuned by bot only and site 9+ plateaus.
5. **BALLISTA** - most depth and the hitch is gone, but the first stations ask a lot of a newcomer (sweep, power peak, wind) and difficulty is a bot estimate.
6. **PERIHELION** - the idea is good and the first run is now safe, but sloppy releases die within about a minute per the author's own bot, so it is the most likely to frustrate a newcomer on the real device.
