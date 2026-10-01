# tune-games: balance, lamps and legibility for the seven games

## 1. Outcome

All seven (Orbit Lock, Moonrunner, Undertow, Echo Vault, Light Trial, Glyph Archive, Signal School) were tuned, given lamp designs that carry live information, and moved to canvas text of 16 px or more (22 px or more during play). Everything is committed on the branch below, the full verification passes, and I opened a screenshot of each game at 1024 x 600. Simulator and headless browser only: I could not see the real lamps or feel the real button. The Pi shut down for heat partway through; all work was already committed, so nothing was lost.

## 2. Details

Shared pieces: `LampBus` in `web/apps/games.js` (exported, also used by `morse.js`). Each frame a game gives it a resting picture (null means dark); events (`flash`) overlay it and show at once. Values are whole numbers in steps of 8, an unchanged picture is not rewritten, `cancel()` clears, `pause()` and `dispose()` clear and stop all writes until `resume()`. Games also show a 3 s announcement (24 px, amber) when something new starts. `draw.js`: `banner` now wraps its caption at 22 px (title 42, prompt 20); signature unchanged.

Bug found only in the browser: a Glyph Archive timer named `tick` shadowed the host's one-second `tick()` hook and the host logged "is not a function". Renamed; a test now checks that no game has a field with a host-hook name.

Commits are not strictly game by game: all seven games live in two files and share `LampBus`, so I committed the `draw.js` banner, then one commit for all games, tests, catalog and docs, plus a small follow-up.

### Orbit Lock
- Play: the gate narrows and the satellite speeds up until 40 to 45 locks (they stopped at 24 and 25 before). From lock 10 each new sector reverses the direction. From lock 20 the gate drifts. Every 10 locks repair one hull point. Ten seconds without a lock costs hull, so never pressing now ends the run. The result says NEW BEST. HULL reads 0 at game over (it was empty).
- Lamps: left = amber ramp as the gate nears, bright while the satellite is inside; middle = hull (green, amber, red); right = cyan in 5 steps through the sector. Lock = green flash, sector complete = white, early miss = left lamp red, late miss = right lamp red, end = red fade. Dark on title and result.
- Canvas: removed the score number and the app-name line (the HUD shows both).

### Moonrunner
- Play: low stones first; then ridges, crystals, spires; walls (a tap cannot clear them, labelled HOLD) from relic 6; long mesas (also hold) from relic 14. Shapes grow taller and wider over 90 relics, speed 250 to 400 px/s, spacing tightens (and widens after a hold obstacle). Two shields, 1.3 s grace after a hit, one shield earned back every 12 relics. Holding is now required: a tap clears none of the launch frames for a wall or mesa, a hold clears many (tested).
- Lamps: dim speed colour (green, amber, red). As the next obstacle closes the lamps fill left to right in its colour (stone green, spire cyan, ridge amber, crystal magenta, wall white, mesa violet) and go bright in the last 0.6 s. Relic = middle lamp white blip, shield lost = amber flash, end = red fade over 0.6 s. Dark on title and result.
- Canvas: removed the "MARE / 1979-B" line.

### Undertow
- Play: hull of 2 (a column or a boundary costs one, 1.4 s grace), +1 every 12 passages up to 3. The gap narrows continuously from 270 to 100 px (it stopped at 170 after passage 28 before). Openings drift from passage 10 (amplitude up to 70 px). Speed rises to passage 43. The first gap is wide and early centre moves are small.
- Lamps: cyan spot at the craft's depth; an amber spot at the next opening that brightens as it arrives (they merge when aligned); near the surface or floor the end lamp pulses red at 4 Hz; passage = green blip, hit = red flash, end = red fade.
- Canvas: removed the "PELAGIC SURVEY" line.

### Echo Vault
- Play: the score now reflects memory. A hold on the wrong side of 350 ms but within 100 ms of it is forgiven as a close call while a "wobble" is in hand (3 at the start, +1 every 3 sequences, max 4); clear mistakes end the run. While holding, the lamps fill amber and turn cyan at 350 ms, the sidetone steps from 440 to 660 Hz, and an on-screen bar shows the hold against the line and the forgiven band. After each release the screen says HEARD SHORT or LONG and the milliseconds. Playback quickens from sequence 3 (long pulses never below 0.5 s). From sequence 8 the screen stops listing the pulses during playback (DARK VAULT: lamps, circles, tone). The three circles mirror the lamps.
- Lamps: short = middle lamp amber (180 ms), long = all three cyan (620 ms); while listening, dim violet shows how much of the signal is returned; mismatch = three blinks in the expected pulse's colour; sequence done = green sweep.
- Canvas: text 18 to 24 px.

### Light Trial
- Play: grade word (SHARP, GOOD, STEADY, SLOW) and NEW BEST on the result, a bar per recent result, a "keyboard timing is approximate" note.
- Lamps: result = all three in a grade colour for 1.2 s (green under 200 ms, cyan under 300, amber under 450, else red), then dark; a new best sweeps white left to right first. False start = left and right alternate red twice, middle stays dark. While armed and waiting (`wait` and `go`) the host writes no lamp at all (a test records the writes); arming writes zeros once. `cancel()` leaves the lamps alone while a trial is armed.
- Note: in the simulator the service itself lights the left lamp amber while armed. That comes from `vesper/server.py` and the demo node, not from this app.

### Glyph Archive
- Play: the cursor quickens 3% per inscription (floor 60% of the chosen scan). From inscription 6 it visits glyphs in a shuffled order. Sequences grow from 3 to 9 (was 7). Memorising time shrinks slowly. An attempt is restored every 4th inscription. Points scale by 850 / current scan ms.
- Lamps: memorising = violet fading out over the memorising time; choosing = progress bar (green, amber or red by attempts left) with a white tick on the third of the row the cursor is in; correct inscription = green sweep; miss = red flash; end = red fade.
- Canvas: glyph numbers 18 px, prompts 22 px.

### Signal School
- Play: guided and listen modes move to the next letter only after two correct answers in a row (two pips show it). The alphabet takes about 5 sessions instead of under 3. Hold gauge bar on screen (amber dot, cyan past the dash line). The summary shows letters learned. Removed the app-name line.
- Lamps: keying = lamp I amber at once, all three cyan at the dash threshold (2 units), then a dimming gap countdown; right answer = green sweep; wrong = red sweep right to left, then the correct signal on the middle lamp (amber blink per dot, cyan per dash; the pause before the next letter lengthens to fit). Listen mode = dot is the middle lamp amber, dash is all three cyan; the answer scan = a white spot that follows the highlighted answer. Review mode uses the keying and teaching lamps.

## 3. Before / after (bots)

Bots: `tests/audit/` (updated, see section 5). 40 seeds, 1200 s cap unless noted. alive20 = runs still alive at 20 s. Before = the code at `c03b453`.

**Orbit Lock** (locks)

| policy | before mean / median, run | after mean / median, run |
|---|---|---|
| perfect timing | 1250 (never loses) | 1406 (never loses; 3-frame gate) |
| competent sd 40 ms | 42.8 / 42, 50 s | 43.6 / 43, 59 s |
| average sd 80 ms | 25.5 / 26, 34 s | 35.5 / 36, 52 s |
| naive sd 150 ms | 17.9 / 18, 27 s (alive20 34/40) | 26.4 / 27, 42 s (40/40) |
| never press | 0, never ends | 0, ends at 30 s |
| press every 1.0 s / 2.1 s / mash 8 Hz | 0 / 0 / 0 | 3.1 / 2.5 / 0 |

Gate width in time: 640 ms falling to 107 ms and flat from lock 24 before; 870 ms falling to 47 ms at lock 45 now.

**Moonrunner** (metres). The audit's bot redrew its timing error every frame and fired on the first lucky draw, which made its stated sd meaningless. I fixed it (one draw per obstacle) and re-measured the old game too ("before" = old game, fixed bot, 600 s cap, 40 seeds).

| policy | before: median, run (alive20) | after: median, run (alive20) |
|---|---|---|
| sd 40 ms | 10668 m, 39/40 survive 600 s | 3041 m, 206 s (40/40), none reach 1200 s |
| sd 80 ms | 173 m, 14 s (14/40) | 1464 m, 107 s (40/40) |
| sd 100 ms | 74 m, 6 s (3/40) | 720 m, 60 s (40/40) |
| sd 150 ms | 62 m, 5 s (1/40) | 280 m, 26 s (34/40) |
| never press / always hold | 49 m, 4 s | 101 m, 10 s |
| tap every 1.0 s / mash 8 Hz | 128 m / 51 m | 192 m / 177 m |

The old game flipped from "forever" to "seconds" between sd 40 and 80 ms. Now run length steps 206 / 107 / 60 / 26 s. Degenerate policies last longer than before (the shields) but score about 6% of the competent bot or less. Speed makes tap windows wider, so the difficulty comes from size, shape and spacing, not speed.

**Undertow** (passages)

| policy | before median, run | after median, run |
|---|---|---|
| pilot every 50 ms, brakes | 528, never loses | 672, never loses (capped) |
| every 150 ms | 528, never loses | 102, 193 s |
| every 250 ms, brakes | 528, never loses | 46, 95 s |
| every 400 ms, brakes | 10, 28 s (alive20 29/40) | 32, 71 s (40/40) |
| every 250 ms, no braking | 1, 8 s (1/40) | 12, 33 s (38/40) |
| never press / hold | 0, 1 s | 0, 3 s |
| blind rhythms | 0 to 1 | 0 to 3 |

A frame-speed pilot (50 ms) still never loses: a superhuman bot, not something I tried to remove.

**Echo Vault** (sequences)

| policy | before mean / median, run | after mean / median, run |
|---|---|---|
| perfect memory, steady keyer (short 150+-50, long 600+-120) | 14.8 / 11, 127 s | 61 / 66, 820 s (15/40 hit the cap) |
| perfect memory, moderate keyer (180+-70, 540+-100), 600 s cap | 6.8 / 5, 40 s | 39.7 / 48.5, 600 s |
| perfect memory, sloppy keyer (220+-110, 480+-150) | 1.3 / 1, 8 s (alive20 6/40) | 2.9 / 2, 14 s (19/40) |
| 97% memory per pulse, steady keyer | not measured | 8.6 / 6, 49 s (moderate keyer: 9.4 / 7) |
| 90% memory per pulse, steady keyer | not measured | 3.6 / 2, 15 s |
| random, always short, always long | 0 to 0.2 | 0.1 to 0.4 |
| every hold exactly 330 ms / 370 ms | not measured | 3.1 / 2.0 |

Honest reading: near-misses are forgiven, so a keyer with ordinary variation now scores by memory. A really sloppy keyer (sd above 100 ms with a biased long hold) still ends early; the gauge and the heard indicator are the answer for a human, and a bot cannot use them.

**Glyph Archive** (inscriptions): perfect memory never loses at any scan, before or after, but the count now depends on scan (73 / 58 / 45 / 36 at 600 / 850 / 1200 / 1600 ms in 1200 s; before 59 / 47 / 37 / 29). Memory-limited players still get the same inscriptions at every scan (90% memory: 7 to 8 before and after), but a slow-reaction player (350 +- 120 ms, 90% memory) gets 4.3 at 600 ms against 7.7 at 850 ms, so scan speed matters where it should. Mash 5 Hz 0.1, press every 1 s 0.3, unchanged.

**Signal School** (letters taught after 3 sessions of 10 answers, keyer sd 35 ms): at 10 WPM the old game taught 30 (the whole alphabet and more), now 14.9. Accuracy by WPM unchanged (5: 100%, 10: 100%, 15: 96%, 20: 89%, 25: 80%); the high-speed problem is not fixed (section 4).

Gesture audit (`tests/audit/gesture.mjs`, 60 seeds): 0/60 runs ended, replaced or damaged in all four guarded games; 0.00 attempts lost in Glyph Archive.

### Scoring scale (old high scores)
- Orbit Lock, Undertow, Echo Vault, Signal School: same unit; old bests stay reachable. Undertow and Echo runs are easier early, so old bests will fall sooner.
- Moonrunner: still metres, but speed is 250 to 400 px/s (was 290 to 450) and shields extend runs. Old bests of a few hundred metres become easy to beat.
- Glyph Archive: points are multiplied by 850 / current scan ms and the cursor quickens, so the same inscription count pays more (about 1.4 times at inscription 12). Old per-scan bests will be beaten earlier. Light Trial: unchanged.

## 4. Not done / weakest

- Hardware: the real lamps and button are unverified. The host coalesces lamp writes (about 17 per second) and lag of 60 ms or more is possible, so Orbit Lock's "inside the gate" accent and Moonrunner's "bright for the last 0.6 s" may feel late. For the morning: Orbit Lock gate accent and the reversal; Moonrunner walls and mesas (is holding obvious, are the hold colours white and violet readable?); Undertow two-spot alignment; Echo Vault gauge, sidetone step, 100 ms forgiveness and DARK VAULT (from sequence 8, may be too harsh); Light Trial that no lamp changes between arming and the cue; Glyph Archive shuffled cursor; Signal School wrong-answer replay.
- Shield, hull and wobble counts and ramp rates are tuned to bots with Gaussian timing; they are assumptions about people.
- Signal School's high-WPM threshold (fixed 2 units) is unchanged. A frame-speed Undertow pilot and perfect-memory Echo and Glyph bots never lose. Light Trial has no bot.
- Light Trial, Signal School and Echo Vault have no gesture rewind (hold escape or no clicks), as before. The new fields in the four guarded games are in their guarded fields and a test checks each is restored.
- A timing-dependent test in `tests/host.test.mjs` ("F2 a hung ordinary write times out...", about lights.js, not mine) failed in 2 of about 5 full runs when the Pi was busy; it passes on rerun.
- Commits are not per game (section 2). The last commit predates the Pi shutdown; I did not rerun the full suite after the shutdown (main has moved on and is not merged here).

## 5. Test changes (each with its reason)

Existing tests that encoded the old tuning, edited in the same commit:
- `tests/engine.test.mjs`: "runner collision" sets `g.shield = 0` (first hits are now absorbed). "runner challenge shapes" expects five shapes at 10 relics (was 3). "flight gate changes" expects `gap >= 100` (was 170, the old floor). "learning app accepts E" now needs two correct answers before T.
- `tests/games.test.mjs`: Moonrunner kills set `shield = 0`; Undertow kills set `hull = 1` (F2, F3, F5). F2's last check now requires no death red in the next run instead of dark, because a run in progress shows the dim speed colour.
- `tests/games-gesture.test.mjs`: same shield and hull setup in the killers. F9b: one correct answer must not advance the lesson, two do.
- `tests/audit/bots.mjs`, `balance.mjs`: bots use the games' own speed and geometry (drift, reversal, shapes with holds, per-obstacle noise), Echo recall and fixed-hold policies, an alive20 column, and `BALANCE_SEEDS`, `BALANCE_CAP`, `BALANCE_ONLY` to run less.

New: `tests/games-tuning.test.mjs` (63 tests): LampBus behaviour; per game, lamp writes are nine whole numbers 0 to 255, vary during play, are dark on title and result screens, off after cancel, pause and dispose and silent afterwards; Light Trial writes nothing while armed or waiting; each new mechanic is reachable (reversal and drift, idle decay, walls and mesas need a hold and a tap fails, shields, hull, drifting gates, wobbles, the sidetone step, tempo and dark vault, scrambled cursor, point scaling, mastery); lamp content per game; canvas text never below 16 px; no field shadows a host hook; the gesture rewind restores every new field in the four guarded games.

## 6. Verification (worktree root, after the last commit)

- `node --test tests/*.test.mjs`: `# tests 196 # pass 196 # fail 0` on the clean runs (flaky host test above).
- `$PYTHON -m unittest discover -s tests -p 'test_*.py'`: `Ran 29 tests ... OK`.
- `python3 scripts/build-catalog.py --check`: exit 0. I edited the `description` of orbit, runner, drift, echo and morse in `vesper/catalog.json` and regenerated `web/apps/catalog.js`; `controls` text unchanged.
- `python3 scripts/build-demo.py`, `node tests/browser-smoke.cjs`: `"passed":true,"appsExercised":12 ... "pageErrors":[]`; `node tests/extension-smoke.cjs`: `"passed":true`.
- Balance outputs in `fleet/work/tune-games/`: `balance.before2.txt`, `balance.after.txt`, `runner.before.fixed.txt`, `gesture.after.txt`.
- Screenshots (1024 x 600, opened and read) in `fleet/work/tune-games/shots/`: orbit, runner, drift (Undertow), echo, reaction (Light Trial), glyphs, morse; title, play and result for each. Text is readable and nothing is clipped. Lamp values read with `eval:` during play matched the design. A few early screenshots predate small text changes (Echo result line, Light Trial caption, Signal School retry wording); I re-shot `reaction-result` and `morse-wrong` afterwards.
- Cleanup: only the live console's `vesper.server` is running; none of mine remain.

## 7. Branch

`worktree-agent-abb06b2242f0b4428`, last commit `a8e9c3d` (earlier `16325ab` banner, `c282e09` games, tests, catalog, docs).
