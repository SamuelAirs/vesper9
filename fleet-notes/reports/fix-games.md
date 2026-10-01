# fix-games: audited game defects fixed

## 1. Outcome

All ten proven defects (F1-F10) are fixed in `web/apps/games.js` and `web/apps/morse.js`, each guarded by a regression test in the normal suite (`tests/games.test.mjs`, `tests/games-gesture.test.mjs`). Opening the system menu with the four-click gesture no longer costs a run in Orbit Lock, Glyph Archive, Moonrunner or Undertow. Nothing else (tuning, lamp choreography) was changed. All verification commands pass; simulator only, nothing was checked on the device.

## 2. Details

### Gesture tolerance design (F1)
`GestureGuard` (games.js, exported) is used by Orbit Lock, Moonrunner, Undertow and Glyph Archive.
- Every `down()` first saves a snapshot of the run (position, lives, points, timers, phase...). The last six are kept, each with its press and release time on the game's own clock (advanced in `update`).
- `cancel()` (the host calls it before opening the menu) rewinds only if the last `menuClicks` presses look like the gesture: right count (`ctx.settings().menuClicks`, so 3 or 4), each tap no longer than the pace's `tapMs`, gaps no longer than `gapMs`, total no longer than `totalMs * clicks/4`, the final press still down and no older than a tap (the host consumes the terminal release), all with 150 ms slop. Pace comes from `gesturePace`, so quick, standard and relaxed are covered. It then restores the snapshot taken at the gesture's first tap. Echo Vault and Signal School use `escape: "hold"` (no click gesture), so they are untouched.
- No input lag: edges are handled immediately as before; saving a snapshot is the only added work. `cancel()` only follows a gesture, a menu button, or an interruption, so the rewind cannot be triggered in ordinary play, and it never reaches back past the gesture's own first tap (about 1 s): a miss made before the gesture is never undone (test "a deliberate quick four-tap burst only ever rewinds to its own first tap"). The "free undo" is therefore limited to what the four gesture taps themselves caused.
- A death caused by the gesture's taps must not reach the scores either, so a finished run is recorded `SETTLE` = 2 s after it ends (longer than any gesture), or at once when the game is paused or disposed (`pause()`/`dispose()` call `settle()`). A run that ended and was replaced during the gesture waits in a backlog and is dropped again if the rewind undoes it. Consequence for the existing suite: two tests in `tests/engine.test.mjs` (orbit three misses, runner collision) asserted the score at the instant of death; they now advance 2.1 s first (orbit also asserts nothing is recorded before). Intent unchanged.
- Opening the menu mid-run submits the best score so far (F4), which is why the audit's F1 tests, which used "no score submitted" as a proxy for "run ended", now assert that only the pre-gesture score is submitted, no finished run is recorded and lives are intact.

Measured with the audit's `tests/audit/gesture.mjs` (60 seeds, standard pace, 67 ms taps; output in `fleet/work/fix-games/gesture.after.txt`; its Orbit/Glyph measure was changed from "score count rose" to "run recorded, replaced or damaged", because opening the menu now legitimately submits a score):

| game | before (audit) | after |
|---|---|---|
| Orbit Lock, runs ended or replaced | 60/60 | 0/60 |
| Glyph Archive, runs ended | 50/60 (the other 10 lost 1.8 of 3 attempts) | 0/60, 0.00 attempts lost |
| Moonrunner, ended within 20 s | 14/60 (control 2/60) | 2/60 (equals control) |
| Undertow, ended within 20 s | 0/60 | 0/60 |

Unit tests also cover 4 clicks at quick, standard and relaxed pace and 3 clicks, in all four games (16 cases), a gesture on a result screen, a death caused by the gesture, slow taps and spread-out misses (no rewind).

### Per defect
- F1 breaks: above. Tests `F1a`, `F1b`, `gesture ...` (16), plus the extra gesture cases in `games-gesture.test.mjs`.
- F2 Moonrunner lamps red: a 0.4 s flash timer clears them (and it is cleared on reset). Test `F2` (now also checks the result screen).
- F3 no result lockout: `LOCKOUT` = 0.6 s in all five games (Echo with its own clock). Tests `F3` x5 plus `Echo Vault: the result screen has a lockout but accepts a press afterwards`.
- F4 score lost on leaving: `pause()`/`dispose()` submit the score reached (Orbit locks, Moonrunner metres, Undertow passages, Glyph points with its scan class, Echo sequences; Echo never submits zero). Tests `F4` x4, `Echo Vault: leaving mid-run...`, and the record-once tests.
- F5 Undertow: passage credited when `gate.x + 65 < 202`, exactly when the collision test ends. Tests `F5`, `F5b`. First passage now arrives about 0.4 s later than the audit's 5.8 s figure.
- F6 Orbit Lock: early means the gate is at most 4.5 rad (the placement maximum) plus 0.1 ahead, else late. Tests `F6`, `F6b`.
- F7 Echo Vault: REPLAY is offered only in show and listen (`menuActions()` returns `[]` otherwise). The audit tests F7a/F7b called `menuActions()[0]` in between/over, so I changed them to assert the action is absent and the sequence still extends; `F7c` checks replay still works while receiving and entering.
- F8 Light Trial lamps: 1.2 s dim timer, cancelled when a new trial starts or on pause so it cannot overwrite the node-driven cue lamp. Tests `F8a`, `F8b`, `F8c`.
- F9 Signal School: review answers no longer advance the guided index; listen and guided still do. Tests `F9`, `F9b`.
- F10: resume guard is `!(this.nextDelay > 0)`. Test `F10`.

Files: `web/apps/games.js`, `web/apps/morse.js`, `tests/games.test.mjs`, `tests/games-gesture.test.mjs`, `tests/engine.test.mjs` (two timing edits), `tests/audit/gesture.mjs` (measure), `tests/audit/games.test.mjs` removed (moved). `tests/audit/` keeps harness, bots, balance, gesture. Also took `tests/browser-smoke.cjs` and `scripts/dev-shot.cjs` from main commit 732c584 as the coordinator asked.

## 3. Verification (run from the worktree root)
- Audit failures first reproduced: `node --test tests/audit/games.test.mjs` gave `# fail 20` before the changes.
- `node --test tests/*.test.mjs`: `# tests 110  # pass 110  # fail 0`
- `$PYTHON -m unittest discover -s tests -p 'test_*.py'`: `Ran 29 tests ... OK`
- `python3 scripts/build-catalog.py --check`: exit 0
- `python3 scripts/build-demo.py` regenerated; `node tests/browser-smoke.cjs`: `"passed":true,"appsExercised":12 ... "pageErrors":[]`; `node tests/extension-smoke.cjs`: `"passed":true`
- `node tests/audit/balance.mjs` rerun: Orbit and Moonrunner rows identical to the audit (balance untouched). It is now much slower than 19 s on the loaded Pi.
- Browser (`scripts/dev-shot.cjs`, screenshots in `fleet/work/fix-games/shots/`; I opened orbit-3-resumed, glyphs-3-resumed, drift-3-resumed, orbit-2-menu): four clicks opened the menu mid-run in Orbit Lock, Moonrunner and Glyph Archive, and after Escape the run was intact (Orbit Lock: hull 3 diamonds, same screen; Glyph Archive: inscription still shown, 3 attempts). Undertow's menu opened in some attempts and not others under load (Pi was busy), and in the sampled run the craft had died because it was not being flown, so that run does not demonstrate resume; its behaviour rests on the unit tests.
- No processes of mine remain (`pgrep` shows only the live console and another agent's audit server).

## 4. Not done / uncertain
- Not verified on hardware. The guard uses game time with 150 ms slop; real node/USB jitter might need more (untested).
- Light Trial and Signal School get no gesture rewind (Signal School uses hold escape; Light Trial only loses a trial). A Light Trial gesture can still start and cancel reaction trials.
- The audit's unverified Light Trial early-press/ARM race is untouched (service side).
- A finished run is recorded up to 2 s late; a browser crash in that window would lose it. Intentional for the gesture design.
- Out of scope, noted: tuning, lamp redesign (next agent), `ctx.rng` seeding.

## 5. Branch
`worktree-agent-a1c8554bd43ebe154`, last commit `30dcaa2` (fix commit `7d3c9ea`).
