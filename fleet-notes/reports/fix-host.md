# fix-host report

## 1. Outcome

Nine of the ten audited defects are fixed (F1-F8, F10), each with a regression test. F9 was measured and the behaviour is deliberately left unchanged. `tests/audit/` is gone: nothing with a proof remains unfixed. Everything passes (section 3). Results are from unit tests, the simulator and headless Chromium only, not the device.

## 2. Details

Files touched: `web/main.js`, `web/engine/input.js`, `lights.js`, `demo.js`, `tests/host.test.mjs` (new), `tests/host-browser.cjs` (moved from `tests/audit/`, extended), `tests/engine.test.mjs` (one test, see F2).

- **F1 lost release.** `InputRouter.reconcile` now cancels an outstanding press from the same source when the node reports the button up (ignored for the first 250 ms after the press, in case the STATUS was composed before it). A STATUS that says "down" stamps the press as confirmed. A raw-mode press with no confirmation for 30 s (`RAW_STUCK_MS`) is cancelled in `update()`. Undertow-style holds are safe: a hold the node keeps confirming is never cut off (tested over 2 minutes), and an unconfirmed keyboard/simulator hold lasts 30 s. A press from another source (keyboard in hardware mode) is never cancelled by node status. Held-across-reset (`blocked`) is unchanged and tested. Tests: five `F1` tests in `host.test.mjs`, plus browser check "F1 lost release recovered...".
- **F2 hung light command.** `LightDirector` no longer serialises through a queue. `effect()` and `release()` send immediately (the socket keeps order). `release()` sends cancel and the zero write without awaiting between. A director write has a 2 s timeout, and an in-flight command blocks only its own generation. Tests: four `F2` tests. The existing test "late light ACK cannot overwrite..." modelled a service that applies a command only when the reply is released, which only made sense with a queue. I changed the mock to apply the command on receipt and delay only the reply (same assertions), in the same commit.
- **F3 rejected payload retried.** A rejected key is remembered in `failed` and skipped until `desired` changes or `invalidate()` runs. Timeouts and disconnect/reconnecting errors are not treated as rejections and are retried. `normalizeLeds` (exported) rounds, clamps and returns null for malformed input (wrong length, non-number, NaN/Infinity); `LightDirector.set` uses it, so `ctx.leds` ignores malformed arrays. Tests: three `F3` tests plus browser checks on the real `ctx.leds`.
- **F4 simulator parity.** `demo.js` now matches `server.py` on: leds validation, leds cancelling patterns and armed cues, unknown timer id/action, pattern/reaction validation (1-16 steps, repeat 1-8, ms 10-10000, reaction delay 250-10000), unknown commands, and `focus` (validated against the catalog). It plays the amber timer-complete effect (`light_effect` 1200 ms plus 3x amber/off 180 ms) on focus home/timers/environment, as `server.py:303` does. Internal pattern steps use a private writer so they do not cancel themselves. Tests: seven `F4` tests.
- **F5 + F7 fault menu.** `systemMenu()` returns the fault menu while `faulted`, so there is no dead RESUME. `fail()` builds it through the new `faultMenu()`. It has one restart entry: "RESTART / NAME" when the app mounted, "RESTART APP" only when creation threw. `menuActions()` throwing no longer leaves the host faulted without a menu. Browser checks F5 (x3) and F7.
- **F6 offline timers.** `status()` recomputes `remaining` from `deadline` for running timers every second, so the badge and `state.timers` keep counting. While disconnected the badge reads `... / STALE`, gets the `stale` class and a title. Browser check F6 (before `02:00`, after 3 s offline `01:58 / STALE`).
- **F8 tick/resume.** `lifecycle()` sends `tick` and `resume` exceptions to `fail()`. `cancel`, `pause` and `dispose` stay contained (toast). `pause` runs while a menu is being built, so calling `fail()` there would re-enter `openMenu`. Once faulted, `tick` is no longer called, so the menu opens once. `closeMenu` no longer steals focus back from the fault menu. Browser checks F8 (tick: one error entry after 3 s; resume).
- **F10 dashboard focus.** `home()` records the leaving app's catalog index, sets the sector and focuses that card (`buildHome(index)`), and scrolls it into view. The unused `homeIndex` is removed. Browser check F10.
- **F9 click gesture: left as is.** The measurement is `steadyClicks` in `host.test.mjs`: 150-400 ms per click, three presets, with a 7-seed LCG jitter of 0/20/35 % (script in scratchpad). I implemented restart-with-the-overrunning-click and ran the same matrix. Steady tempos opened the menu at exactly the same tempos, because a steady rhythm is decided by whether `3*period + tap` fits the window. At 20 % jitter the standard preset at 275 ms opened 5 times per 40 clicks either way. Restart only differs with irregular rhythms, where it would act as a sliding window and so trigger more easily during rapid tapping, with no gain for the target user. The audit's "300 ms never opens at standard" is true and intended: the standard cut-off is between 250 and 275 ms per click, quick between 200 and 225 ms, and relaxed beyond 400 ms. The tests pin that table.
- **H5** (quiet command payload overriding the command name) was deleted as a non-defect.

## 3. Verification

```
node --test tests/*.test.mjs                  -> tests 59, pass 59, fail 0   (was 37; 22 new)
$PYTHON -m unittest discover -s tests -p 'test_*.py' -> Ran 29 tests ... OK
python3 scripts/build-catalog.py --check      -> exit 0
python3 scripts/build-demo.py && node tests/browser-smoke.cjs -> {"passed":true,"appsExercised":12,...,"pageErrors":[]}
node tests/extension-smoke.cjs                -> {"passed":true,"cartridge":"garden",...}
node tests/host-browser.cjs                   -> 12 PASS, 0 FAIL
```

Before the fixes, the audit's failing H1-H4 and D1-D5 and browser B1/B4 failed as the audit reported. The same assertions are now in `host.test.mjs` and `host-browser.cjs` and pass. I did not re-run the new F5/F7/F8/F10 browser checks against the pre-fix code, so I have not shown those checks fail without the fix. `git status` is clean. `pgrep` shows the live console (pid 1123, not mine) and a simulator (pid 20380) with its Chromium from `/tmp/vesper-audit-*`, which the audit agent left behind. I did not touch either.

## 4. Not done / uncertain

- `tests/host-browser.cjs` is not part of the standard verification list. Run: `PYTHON=... PLAYWRIGHT_PATH=... TEST_BROWSER_BIN=... node tests/host-browser.cjs`.
- The commits are grouped by file, not strictly one defect each: the light, input and demo fixes are separate commits. The `git rm` of `tests/audit/*` and the move of the browser script landed in the F2/F3 commit. All new tests are in the last commit.
- The `Timers` app (`web/apps/utilities.js`, not mine) shows its own list. Since `status()` now updates `state.timers[].remaining` every second, it should pick up the live value if it re-reads state on `tick`. I did not check it.
- Seen but not changed: `lifecycle("pause")` exceptions are still only toasted (reason above). The 30 s raw watchdog does not apply to menu-mode presses, which already have the 3 s hold. A quiet-command error toast on a monitor tab is unchanged. The simulator's `mic` and `settings` commands are still more lenient than the service. `settings` was not on the audit list.
- A later lamp system can rely on `LightDirector.effect/release/set`, `normalizeLeds` and `withTimeout`. The `enqueue`/`tail` members are gone. Nothing else in the repo used them.
- Nothing here was verified on the hardware.

## 5. Branch

`worktree-agent-ad333d3aa9ac726de`, last commit `c98ab2b`.
