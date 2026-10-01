# audit-games: six games and Signal School

## 1. Outcome

I reviewed `web/apps/games.js`, `web/apps/morse.js`, their tests and `docs/OPERATOR.md`, and proved **10 defects (1 breaks, 4 wrong, 5 rough)** with 20 `node:test` cases that all fail on the current code, each for the stated reason. I measured balance with seeded bots that play through the apps' own `down`/`up`/`update` at the fixed 1/60 s step. No product file was changed. Everything is under `tests/audit/` on my branch, committed, and the existing suite still passes 33/33.

Things I looked for and did not find:
- All randomness goes through `ctx.rng`. The only wall-clock reads are the two `performance.now()` calls in Light Trial's keyboard timing path (games.js 728, 755), which are intended.
- Every game advances only on `update(1/60)`, so nothing depends on frame rate.
- No sustained tone or lamp is left on by `cancel()`/`pause()` in Echo Vault or Signal School (`cancel()` stops the tone and writes zeros, Echo 558-562, Signal School 168-171). Orbit Lock and Undertow use only short tones; I found no case of a lamp left on after the menu opens, because `Vesper.openMenu()` calls `lights.release()`.
- Every Moonrunner obstacle is clearable by a plain tap at every speed (windows in section 3). Undertow gates are always passable: a pilot cleared 528 of 528 gates in 20 simulated minutes on 40 seeds.

### Proven defects at a glance

| ID | Sev | File:line | Player experience | Test |
|---|---|---|---|---|
| F1 | breaks | games.js 52-78 (Orbit Lock), 872-898 (Glyph Archive) | Opening the menu with four clicks ends the run. Orbit Lock: 60/60 runs ended and replaced by a fresh one. Glyph Archive: 50/60 ended; the other 10 lost 1.8 of 3 attempts on average. | `F1a`, `F1b` |
| F2 | wrong | games.js 245 (Moonrunner) | All three lamps go red on death and are never cleared. They stay red through the result screen and the whole next run. | `F2` |
| F4 | wrong | Orbit 74, Moonrunner 243, Undertow 384, Echo 546, Glyph 894 | A score is submitted only when the run ends by dying. Leaving mid-run (menu, dashboard, restart) discards the best score and distance. | `F4` x4 |
| F7 | wrong | games.js 515-522, 563-566, 591-596 (Echo Vault) | REPLAY CURRENT SIGNAL during the 1 s between-rounds pause lets you enter the same signal again for a second round point. REPLAY after ECHO DIVERGED continues a run that was already recorded as over. | `F7a`, `F7b` |
| F9 | wrong | morse.js 160 | A correct answer advances the guided lesson index in every mode, and the new index is saved. After correct review answers, guided mode skips letters that were never taught. | `F9` |
| F3 | rough | Orbit 53-57, Moonrunner 177-181, Undertow 365-369, Echo 525-529, Glyph 873-877 | A press 100 ms after a run ends restarts it, so a player who is tapping rhythmically never sees the result screen. | `F3` x5 |
| F5 | rough | games.js 403-414 (Undertow) | The passage point is awarded when the gate's leading edge reaches x=210, but the collision box covers the craft until x=137 (about 0.4 s later). Dying inside that gate still scores it. | `F5` |
| F6 | rough | games.js 68 (Orbit Lock) | A press more than pi rad before the gate says "LATE / CATCH THE NEXT ORBIT". | `F6` |
| F8 | rough | games.js 718, 743 (Light Trial) | Red (early) or green (result) lamps stay lit on the idle result screen until you leave. | `F8a`, `F8b` |
| F10 | rough | morse.js 173 (with 164, 178) | `resume()` is meant to restart an interrupted listen-mode signal, but its `!this.nextDelay` guard is false after the first answer. The signal continues mid-way with its sidetone cut. | `F10` |

Also measured but not a failing test: the same four-click gesture in Moonrunner launches jumps the player did not choose. Runs ended within 20 s of the gesture: 14/60 with it against 2/60 for the same seeds without it (table under F1). Undertow is unaffected (0/60 both ways).

## 2. Details

Failing output is copied from `fleet/work/audit-games/games.test.out.txt`. To reproduce: `node --test tests/audit/games.test.mjs`.

### F1 (breaks): the four-click menu gesture destroys a run in Orbit Lock and Glyph Archive

- **How it happens.** `docs/ENGINE.md` says all four downs reach the game, three ups reach it, then `cancel()` is called. Orbit Lock treats every press outside the gate as a miss with no grace (lines 66-77), so three taps spend all three lives. `recordRun` and `ctx.score` run, and the fourth tap lands in `phase === "over"`, where line 53 calls `reset()` and starts a new run. The menu then opens on that fresh run. Glyph Archive does the same (lines 888-897).
- **What the player sees.** Choosing RESUME returns to a different run than the one they paused.
- **Measured** (`tests/audit/gesture.mjs`; 60 seeds, gesture at a random moment, pace "standard", taps of 67 ms and gaps of 50 ms):

| game | measure | control | after gesture |
|---|---|---|---|
| Orbit Lock | run ended and recorded, fresh run started (gesture at 15-45 s) | 0/60 (perfect-timing bot never loses) | **60/60** |
| Orbit Lock | mean locks in the run that was ended | - | 8.8 |
| Glyph Archive | run ended (gesture during the first inscription) | 0/60 | **50/60** |
| Glyph Archive | attempts lost in the runs that survived | 0 | 1.80 of 3 |
| Moonrunner | run ended within 20 s of the gesture (competent bot) | 2/60 | 14/60 |
| Undertow | run ended within 20 s of the gesture (competent bot) | 0/60 | 0/60 |

- **Failing output:** F1a `AssertionError ... expected: 0, actual: 1` (message: run was ended and its score recorded by the gesture); F1b the same.
- **Smallest suggested fix** (not applied or tested): in Orbit Lock and Glyph Archive ignore a press that arrives within about 0.35 s of the previous one (the gesture's maximum tap gap is 220 ms). Also snapshot lives, points and target before each press, and have `cancel()` restore the snapshot if a press happened in the last 0.6 s. A player who pauses a good run then loses at most the one real press.
- **Moonrunner:** `pause()` could put the runner back on the ground and clear the buffered jump; it does neither today (the game defines no `pause()`).

### F2 (wrong): Moonrunner leaves the lamps red

- games.js 245 calls `leds([160,20,0, ...])` on death. Orbit Lock clears its flash with the `flash` timer (line 83); Moonrunner has no equivalent. The next `down()` calls `reset()`, which touches no lamp.
- **Failing output:** `lamps are still red 160,20,0,160,20,0,160,20,0`, two seconds into the next run.
- **Fix:** a flash timer (about 0.4 s) that writes zeros when it expires.

### F4 (wrong): score submitted only on death

- `ctx.score` is called in the death, miss and mismatch handlers only. A player who reaches a record and then picks DASHBOARD or RESTART from the menu loses it, because four of the games define no `dispose()` and nothing saves in `cancel()`/`pause()`.
- **Failing output, all four:** `no score was submitted although the run had progress`.
- **Fix:** call `ctx.score` from `pause()` when the run has progress. The server keeps `MAX(score)`, so repeated submission is harmless.

### F7 (wrong): Echo Vault REPLAY re-credits a signal and can revive an ended run

- `menuActions()` (line 563) calls `demonstrate()` in any phase.
- In the "between" phase this skips the sequence extension at line 592, so the same signal is entered again. **Failing output (F7a):** `same two-pulse signal credited again: round=2` (expected 1).
- After "over" it puts the game back in "show" and then "listen", and a correct entry sets the phase to "between". **Failing output (F7b):** `run was recorded as over with 0, then continued: round=1`.
- **Fix:** offer REPLAY only while `phase` is "show" or "listen".

### F9 (wrong): Signal School advances the guided lesson from other modes

- Line 160 does `this.index++` on any accepted answer, then line 166 saves it.
- Review mode targets letters from `reviewLetter()`, normally earlier lessons, so each correct review answer moves the guided position forward. The next guided session starts further along the alphabet than the player has been taught. Listen mode is consistent (its target is `LESSONS[index]`); review mode is not.
- **Failing output:** `guided position moved from 2 to 5; letters A, N, I would never be taught`.
- **Fix:** `if (accepted && this.mode !== 'review') this.index++`.

### F3 (rough): no result lockout

- The five games reset on any press while `phase !== "play"`.
- **Failing output, all five:** `the result screen was dismissed by a reflex press and a new run began` (Echo: `'show' !== 'over'`).
- A tapping rhythm is how Orbit Lock, Moonrunner, Undertow and Glyph Archive are played, so the next press after death usually arrives within 100-300 ms.
- **Fix:** ignore presses for about 0.6 s after the phase becomes "over".

### F5 (rough): Undertow scores a gate that killed you

- Credit at line 403 (`gate.x < 210`) comes before the craft has left the column; the collision test at 409-410 stays live until `gate.x + 65 <= 202`.
- **Failing output:** `died inside the gate but scored 1` (expected 0).
- **Fix:** credit when `gate.x + 65 < 202`.

### F6 (rough): Orbit Lock says LATE for an early press

- Line 68 uses `wrapAngle(angle - target) < 0` to mean early. The new target is placed `range(1.2, 4.5)` rad ahead, so beyond pi the wrap flips sign.
- **Failing output:** `feedback was: LATE / CATCH THE NEXT ORBIT` for a press with the satellite 4 rad before the gate.
- **Fix:** use `((target - angle) mod 2pi)`: if it is below pi the press was early, otherwise late.

### F8 (rough): Light Trial lamps stay lit

- Line 718 sets red (early), line 743 sets green (result); nothing clears them until the next press starts a new trial.
- **Failing output:** `lamps still lit 10 s after the result: 20,100,20,20,100,20,20,100,20` and `... after the early press: 150,15,0,0,0,0,150,15,0`.
- **Fix:** a 1.2 s timer that writes zeros.

### F10 (rough): listen-mode resume does not restart the interrupted signal

- `nextDelay` is only ever decremented, so after the first answer it holds a tiny negative number. `resume()`'s `!this.nextDelay` is then false and the replay is skipped.
- **Failing output:** `signal resumed mid-way at pulse 3 with its sidetone cut instead of restarting`.
- **Fix:** `!(this.nextDelay > 0)`.

### Unverified

- **Light Trial early press racing the arm command.** `down()` in "wait" sends `cancel` while the service may still be issuing `reaction`, which is LEDS then ARM as two device commands. If the cancel overtakes ARM the node could still fire a cue and turn lamp II green while the app shows TOO EARLY. I could not exercise the service or node, so I cannot say whether the ordering is guaranteed.
- **Orbit Lock gate-window precision on hardware.** From 25 locks the gate is 107 ms wide in time, so extra latency on the button path would matter. I measured nothing on the device.
- **Everything here is simulator-level.** None of it says how the physical switch feels.

## 3. Balance measurements

From `node tests/audit/balance.mjs` (full output in `fleet/work/audit-games/balance.out.txt`). 40 seeds per row, runs cut at 1200 simulated seconds, fixed 1/60 s step. "sd" is the Gaussian timing noise of the simulated human.

### Orbit Lock (score = locks)

| policy | mean | median | p10 / p90 | median run length |
|---|---|---|---|---|
| perfect timing | 1250 | 1248 | 1238 / 1266 | 1200 s (never loses) |
| competent (sd 40 ms) | 42.8 | 42 | 29 / 60 | 50 s |
| average (sd 80 ms) | 25.5 | 26 | 18 / 33 | 34 s |
| naive (sd 150 ms) | 17.9 | 18 | 12 / 25 | 27 s |
| never press | 0 | 0 | 0 / 0 | never ends (1200 s) |
| press every 1.0 s / 2.1 s / mash 8 Hz | 0 | 0 | 0 / 0 | 3 s / 6 s / 0 s |

- The gate's time-width in ms is 640, 438, 308, 217, 151, 109 at 0, 5, 10, 15, 20, 24 locks, and 107 from 25 locks onward.
- Window and speed both stop changing at 24 and 25 locks. A competent player reaches the 5th lock at 7.9 s and the 25th at 33.8 s; after that nothing new happens.
- No degenerate policy scores. Not pressing never ends the run.

### Moonrunner (score = metres)

| policy | mean | median | p10 / p90 | median run length |
|---|---|---|---|---|
| competent (sd 40 ms) | 20500 | 21468 | 21466 / 21471 | 38 of 40 survive 1200 s |
| average (sd 80 ms) | 292 | 196 | 74 / 796 | 16 s |
| naive (sd 150 ms) | 63 | 51 | 50 / 100 | 4 s |
| never press / always hold / tap every 2.25 s | 49 | 49 | 49 / 49 | 4 s |
| mash 8 Hz / mash 4 Hz | 51 / 50 | 51 / 50 | - | 4 s |
| tap every 1.0 s | 144 | 128 | 102 / 212 | 11 s |

- **Clearing windows** (launch timing that clears, one frame = 16.7 ms, from the real physics):

| shape | speed 290 px/s (0 relics) | speed 450 px/s (16+ relics) |
|---|---|---|
| SPIRE | tap 200 ms, hold 617 ms | tap 267 ms, hold 350 ms |
| RIDGE | tap 233 ms, hold 683 ms | tap 350 ms, hold 417 ms |
| CRYSTAL | tap 233 ms, hold 650 ms | tap 317 ms, hold 383 ms |

  Every shape is clearable by a plain tap at every speed, so the advertised "hold for a higher jump" is never required.
- **Cliff, not ramp.** sd 40 ms never dies in 20 minutes; sd 80 ms dies in a median 16 s.
- **Timeline.** The 1st / 3rd / 16th relic arrive at 4.5 / 8.6 / 37.0 s. Shapes vary after 3 relics; speed caps after 16. Obstacle spacing is 2.0-2.5 s at every speed, so at the cap the gap is about 1000 px, and nothing else changes.

### Undertow (score = passages)

| policy | mean | median | median run length |
|---|---|---|---|
| pilot deciding every 50 / 150 / 250 ms, with braking | 528 | 528 | 1200 s (never loses) |
| pilot deciding every 400 ms, with braking | 11.4 | 10 | 28 s |
| pilot deciding every 250 ms, no braking | 1.7 | 1 | 8 s |
| never press / always hold | 0 | 0 | 1 s |
| blind hover, 6 of 15 frames held / 12 of 30 / 50% duty | 0 / 1.3 / 0 | 0 / 1 / 0 | 6 / 8 / 2 s |

- The 1st / 20th (speed cap) / 28th (gap floor) passage arrive at 5.8 / 47.6 / 65.7 s.
- A pilot that decides within 250 ms and brakes never loses, and nothing changes after about 66 s. The cliff sits between 250 ms and 400 ms decision cadence. A fixed-rhythm tapper cannot score.

### Echo Vault (score = sequences)

| policy | mean | median | p10 / p90 | median run length |
|---|---|---|---|---|
| perfect memory, steady keyer (short 150 +- 50, long 600 +- 120 ms) | 14.8 | 11 | 5 / 30 | 127 s |
| perfect memory, sloppy keyer (short 220 +- 110, long 480 +- 150 ms) | 1.3 | 1 | 0 / 3 | 8 s |
| random taps/holds | 0.2 | 0 | 0 / 1 | 3 s |
| always short / always long | 0 / 0.2 | 0 | - | 3 s |

- Seed 1, steady keyer: rounds start at 0, 3, 9, 15, 22, 31, 41, 52, 65, 77, 92 s, and the sequence reaches length 10 at round 8.
- The difficulty is how a hold is classified against the 350 ms threshold, not memory: both keyers have perfect memory and score 14.8 against 1.3. Nothing tells the player when a hold crosses 350 ms.

### Glyph Archive (score = inscriptions)

| scan | perfect memory, reaction 150 +- 50 ms | memory 90% per glyph | memory 75% per glyph |
|---|---|---|---|
| 600 ms | 59.5 (never loses) | 7.0 | 3.6 |
| 850 ms | 47.0 (never loses) | 7.1 | 3.6 |
| 1200 ms | 36.5 (never loses) | 7.1 | 3.6 |
| 1600 ms | 29.4 (never loses) | 7.1 | 3.6 |

- Mashing at 5 Hz scores 0.1; pressing every 1.0 s scores 0.3.
- Seed 1, perfect memory at 850 ms: inscriptions complete at 12, 23, 37, 53, 69, 89, 103, 126, 154, 183, 206, 234, 256, 285 s.
- The scan interval only changes the rate. Imperfect-memory players score the same at every setting, so the per-scan score classes reward nothing. Length reaches its maximum of 7 at round 8; after that nothing new happens.

### Signal School, guided keying (keyer sd 35 ms, 20 seeds, 3 sessions of 10 answers)

| WPM | dot / dash / threshold (ms) | accuracy | first session | guided index after 30 answers |
|---|---|---|---|---|
| 5 | 240 / 720 / 480 | 100% | 33 s | 30 |
| 10 | 120 / 360 / 240 | 100% | 25 s | 30 |
| 15 | 80 / 240 / 160 | 97% | 23 s | 29.1 |
| 20 | 60 / 180 / 120 | 89% | 22 s | 26.6 |
| 25 | 48 / 144 / 96 | 78% | 22 s | 23.3 |

- Above 15 WPM the fixed `2 * unit` threshold becomes the limit at this keying noise. The 35 ms noise is my assumption, not a measured human value.
- At 10 WPM all 26 letters are passed in under three sessions (about 75 s of play) with no mastery check. Review mode exists to compensate, but F9 means review itself moves the guided index.
- The letter gap is a fixed 0.6 s (`max(3 * unit / 1000, .6)`), which is 12.5 units at 25 WPM.

## 4. Proposals

Ranked by value for effort. Lamp values are 0-255 true RGB (colour order confirmed in firmware 0.1.2). Timing-critical cues must not rely on `ctx.leds()`: the host coalesces those writes to about 17 per second, so a lamp can lag by 60 ms or more. Use `ctx.leds()` for ambient state that tolerates that lag, and `ctx.pattern()` for node-timed finite sequences. Quantise ambient brightness to steps of 8 so the director's dedupe works. Write flashes through one override timer (counted down in `update`) that restores the ambient value when it expires. Because `Vesper.openMenu()` releases the lamps, re-issue the ambient state in `resume()`.

### Orbit Lock

1. **Lamps (anticipation, hull, which side the error was on).**
   - Left lamp = approach ramp. Amber (255, 140, 0) scaled by `clamp(1 - tToGate / 1.2, 0, 1)`, with `tToGate = ((target - angle) mod 2pi) / speed`. It peaks as the satellite reaches the gate.
   - Middle lamp = hull, constant at about level 60: 3 lives green (0, 160, 40), 2 amber (200, 120, 0), 1 red (200, 20, 0).
   - Right lamp = streak inside the sector. Cyan (0, 150, 200) at brightness 0, 50, 100, 150, 200 for `points % 5` = 0 to 4. On the 5th lock hold all three white for 0.4 s.
   - Event overrides for 0.15 s: a lock flashes all three green. A miss flashes only the left lamp red if early and only the right lamp red if late, using the F6-corrected rule.
2. **Late-game escalation.** Window and speed stop changing at 24-25 locks; perfect timing never loses. Every 5 locks beyond 25, flip the direction of travel or add a decoy gate. Re-measure with `balance.mjs`.
3. **"NEW BEST" on the result banner** when `points > ctx.best()` (data already available).

### Moonrunner

1. **Lamps (speed and proximity).**
   - Base colour is speed: dim (about level 40) green at 290 px/s, amber at 370, red at 450.
   - The lamps fill left to right as the next obstacle nears: I under 1.5 s to contact, II under 1.0 s, III under 0.5 s. The fill colour is the shape: SPIRE cyan, RIDGE amber, CRYSTAL magenta (200, 40, 160).
   - A relic passed blips the middle lamp white for 80 ms. Death fades red to off over 1.5 s, which also fixes F2.
2. **Make the hold matter.** Add a tall obstacle or hanging bar that needs more than the tap apex (about 93 px), so only a held jump (apex about 179 px) clears it, from about relic 6. Shorten the 2.0-2.5 s spacing toward 1.2-1.8 s as speed rises; it is currently independent of speed.
3. **"NEW BEST" and relics on the result banner,** with a 0.6 s input lockout (F3).

### Undertow

1. **Lamps (depth meter and boundary danger).**
   - Map craft `y` in [22, 518] onto the lamps by crossfade: brightness `max(0, 1 - |y - yk| / 250)` for `yk` = 90 (left), 270 (middle), 450 (right), colour cyan (0, 110, 160).
   - When `y < 70` or `y > 470` the nearest end lamp turns red and pulses at about 4 Hz, a warning before the SURFACE or DEPTH LIMIT death.
   - Passing a gate blips the middle lamp green for 100 ms. A crash fades all three red to off over 1 s. Keep the existing dim cyan on hold as an additive base.
2. **Escalation after 66 s.** Everything stops changing at passage 20 (speed) and 28 (gap). Make gates move (a slow sine on `center`) and lower the gap floor from 170 toward 140 over passages 28 to 60.
3. **Fix F5, then add a near-miss bonus** (passages cleared with `|y - center| < gap / 2 - 30` count double) if you want something to chase.

### Echo Vault

1. **Lamps as a hold gauge (also the most valuable gameplay change here).**
   - While the key is held in the listen phase, fill the lamps left to right: I at 120 ms, II at 230 ms, III at 350 ms, amber (255, 170, 0) throughout, switching all three to cyan (0, 200, 255) at 350 ms. The player sees the instant a hold becomes long.
   - Pair it with a sidetone step from 440 Hz to 660 Hz at 350 ms. The measured difficulty is this classification (1.3 against 14.8 sequences).
   - During playback show a short as a 180 ms amber blip and a long as a 620 ms cyan blip on the middle lamp, instead of the current `index % 3` position, which carries no information.
   - After a mismatch blink the lamps three times in the colour of the pulse that was expected (amber short, cyan long).
2. **Fix F7.** Beyond round 8 every round is a fresh random 10-pulse sequence; speed playback up about 5% per round from round 8 so the game keeps escalating.
3. **A thin hold-time bar on screen** that fills to the 350 ms line, for players not watching the lamps.

### Light Trial

1. **Lamps (grade the result, then go dark).**
   - After a result, show all three lamps in a grade colour for 1.2 s, then off: under 200 ms green (0, 220, 60), under 300 ms cyan, under 450 ms amber, otherwise red. This also resolves F8.
   - A new personal best (`score > ctx.best(metric)`) sweeps white left to right with `ctx.pattern()` in three 120 ms steps.
   - A false start flashes the left and right lamps red alternately twice, then off. Keep the middle lamp strictly for the cue so it never carries other information.
2. **Show the last five results as a mini histogram** on screen.
3. **Show the timing class and an "approximate" note for keyboard timing** on the result screen; the HUD "CLOCK" label is easy to miss.

I did not run a bot on Light Trial: the cue timing belongs to the node and service, so there is no meaningful offline policy to measure.

### Glyph Archive

1. **Lamps (progress, attempts, cursor tick).**
   - Choose phase: the lamps are a progress bar of `entered / sequence.length` across the three lamps with fractional brightness (4 of 7 entered shows I full, II about 70%, III off). Colour green (0, 200, 60) with 3 attempts left, amber with 2, red with 1.
   - A 60 ms white tick on the lamp for the cursor's current third (glyphs 0-1 left, 2-3 middle, 4-5 right) at each cursor advance gives a rhythm to anticipate; the scan interval is at least 600 ms, well above lamp latency.
   - Watch phase: dim the lamps evenly to off over the `2.5 + 0.4 * length` seconds of memorisation.
2. **Make the scan interval matter.** At every scan setting an imperfect-memory player scores the same, and a perfect one never loses. Either speed the cursor up about 4% per inscription, or multiply points by `850 / scanMs`.
3. **Fix F1 and F3,** and add a seventh symbol or a decoy highlight beyond round 8, where length stops at 7.

### Signal School

1. **Lamps (live dot/dash gauge, gap countdown, show the right rhythm).**
   - While the key is held: lamp I lights at once (amber (255, 170, 0) means a dot). At the threshold (`2 * unit`) lamps II and III join and the colour turns cyan (0, 200, 255), so the player sees when the hold will count as a dash. Same idea as Echo Vault.
   - After release, show the 0.6 s letter-gap countdown by dimming all three lamps from amber to off.
   - On a wrong answer, play the correct signal on the middle lamp with `ctx.pattern()` (dot = `unit` ms, dash = `3 * unit` ms, `unit` gap), so the lamps teach the rhythm. Correct: a green sweep left to right. Wrong: a red sweep right to left.
   - In listen mode keep the pulse on the middle lamp; while scanning answers, show the focus position with the thirds mapping from Glyph Archive.
2. **Fix F9, then require mastery before advancing.** Move the guided index only after two consecutive correct answers for a letter. Today 10 WPM passes the whole alphabet in about 75 s.
3. **Fix the dot/dash decision at high speed.** At keying noise sd 35 ms accuracy falls to 89% at 20 WPM and 78% at 25 WPM with the fixed `2 * unit` threshold. Adapt the threshold to the player's own median dot, or cap WPM until the player is reliable at the current one.

## 5. Verification

Commands run from the worktree root, with real results:

- `node --test tests/*.test.mjs` gave `# tests 33  # pass 33  # fail 0` (the existing suite, unchanged).
- `node --test tests/audit/games.test.mjs` gave `# tests 20  # pass 0  # fail 20`. I read each failure message (listed in section 2 and in `fleet/work/audit-games/games.test.out.txt`) and checked it fails for the stated reason. Two of the F3 cases first failed with `g.up is not a function` because my test called `up()` on games that have none; I fixed the test, not the product.
- `node tests/audit/balance.mjs` took about 19 s; output in `fleet/work/audit-games/balance.out.txt`.
- `node tests/audit/gesture.mjs`; output in `fleet/work/audit-games/gesture.out.txt`.
- `git status --short` showed only the new `tests/audit/` directory; no product file was touched.
- My first "perfect timing" Orbit Lock bot could step over the gate between two frames. It scored 496 locks; after I gave it one frame of slack it scored 1250, and the figures above come from the fixed bot.

## 6. Not done / uncertain

- **Nothing here was checked on the device.** Feel of the switch, lamp latency and node timing are untested.
- **The simulated humans are assumptions.** Timing noise of 40, 80 and 150 ms, keyer noise of 35 ms and the memory probabilities are my own choices. They show where each game's cliff is, not where a real player lands; a human play-test should set the real values.
- **Suggested fixes are untested.** I wrote them from reading the code and applied none. Add regression tests beside `tests/engine.test.mjs` when a fix lands; the tests in `tests/audit/games.test.mjs` can be moved there as they start to pass.
- **Out of my lane, noted only:** `ctx.rng` in `web/main.js` is `new Random()` seeded from `Date.now()`, so a live game cannot be replayed from a seed; my tests are deterministic only because the harness injects its own.
- **Not measured:** Light Trial under a bot, and Echo Vault or Signal School across the three-second hold escape.
- The harness (`tests/audit/harness.mjs`) mirrors `web/main.js`'s menu handling (cancel, pause, lamp release) in a stub; it is not the real host.

## 7. Branch

Branch `worktree-agent-abd2d6379995f1ed6`; the commit hash is in my final message and in `git log -1` (the commit is made after this report is written).

Committed files: `tests/audit/harness.mjs`, `tests/audit/bots.mjs`, `tests/audit/balance.mjs`, `tests/audit/gesture.mjs`, `tests/audit/games.test.mjs`.
