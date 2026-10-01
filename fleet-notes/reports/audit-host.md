# audit-host report

## 1. Outcome

I reviewed `web/main.js`, `web/engine/*.js`, `web/index.html`, the existing engine tests and the browser smoke test. I compared `demo.js` read-only against `vesper/server.py` and `vesper/device.py`. I proved 10 findings: 2 "breaks", 4 "wrong" and 4 "rough". Product files are untouched. The audit tests are committed on the branch below. Before finishing I checked that none of my server or browser processes were still running.

The Pi rebooted mid-task and nothing had been saved. I redid the tests from the code I had already read.

Evidence per finding: F1 to F6 each have a failing test or script with its real output quoted. F7 to F10 are rough items I did not write tests for: F7 rests on the fault-menu labels printed in my first browser run and on reading the code, and F8 to F10 rest on reading the code only.

## 2. Details (most important first)

### F1. breaks: a lost button release freezes the game until some unrelated event
`web/engine/input.js:19,38,75-78` and `web/main.js:699-702`.
- **User experience:** if one node BUTTON release frame is lost (CRC drop), `router.press` stays set. Every later press is dropped by `if (... this.press) return`. Raw-mode game input is dead.
- **Why nothing recovers it:** `node_status` (about once a second, with `button:false`) only calls `reconcile()`, and `reconcile()` only clears `blocked`, not `press`. In the default 4-click profile the 3 s timer fires only for `menu || !policy.clicks`, so raw-mode games never time out.
- **Recovery:** only a disconnect, window blur, menu open or app change clears it.
- **Tests:** `H1` and `H2` in `tests/audit/host.test.mjs`.
  ```
  H1: second press must reach the game once the node reports the button is up
  H2: press still pending after 60 s
  ```
- **Fix:** in `reconcile`, when `pressed === false` and a press is outstanding from that source, call `this.cancel()`. Optionally add a raw-mode watchdog that cancels a press older than about 10 s.

### F2. breaks: one unanswered light command stalls lamp cleanup for up to 20 s
`web/engine/lights.js:9-12,21-31` and `web/engine/bridge.js:66-69`.
- **Mechanism:** `enqueue` serialises every light operation, including `release()`, behind the previous one. If a `leds` reply never arrives, `release()` waits for the bridge's 20 s request timeout.
- **User experience:** leaving an app or opening the menu does not send cancel/zero for up to 20 s. A pattern or colour keeps running on the lamps, and `flush` is `busy` for the same period.
- **Test:** `H3`.
  ```
  release must reach the service without waiting for the hung command; sent=leds
  ```
- **Fix:** make `release()` and `effect()` bypass or race the queue, for example by sending `cancel` immediately. Alternatively give director commands a short timeout of about 2 s.

### F3. wrong: a rejected light payload is retried every 60 ms indefinitely
`web/engine/lights.js:47`.
- **Mechanism:** the `catch` sets `sent = null` while `desired` is unchanged. So a payload the service permanently rejects is re-sent after every 60 ms throttle, with a server error each time.
- **Cause:** the real service accepts only nine integers from 0 to 255 (`server.py:224`). An app that passes a float or an out-of-range value triggers this.
- **Test:** `H4`.
  ```
  director sent the same rejected payload 100 times in ~6 s
  ```
- **Fix:** remember the failed key (`this.failed = key`) and skip it until `desired` changes or the connection generation changes. Optionally clamp or round in `ctx.leds`.

### F4. wrong: the standalone simulator is lenient where the real service is strict
`web/engine/demo.js:101-220`. There is one test per gap in `tests/audit/demo-parity.test.mjs`.
- **D1:** `leds` accepts floats, out-of-range values and short arrays. The service rejects them (`server.py:224`). This hides F3-type bugs in the simulator.
- **D2:** `leds` does not cancel a running pattern. The service does (`device.py:42`, `PROTOCOL.md`).
- **D3:** a `timer` command with an unknown id returns success. The service raises `Timer not found`.
- **D4:** empty patterns and a 10 ms reaction delay are accepted. The service validates both (`server.py:230,241`).
- **D5:** unknown commands are accepted. The service raises `Unknown command`.
- **Not tested:** the demo never plays the amber timer-complete light effect the service does (`server.py:303`). I noted this from reading only.
- **Fix:** port the same validation into `DemoBridge.command` and have its `leds` handler clear the pattern timers.

### F5. wrong: the "RESUME" entry can be dead
`web/main.js:511-513,525-531,762`. Real-browser script `tests/audit/host-browser.cjs`.
- **Mechanism:** after an app exception, the fault menu blocks `closeMenu()` via `faulted`. A 3 s hold, a voice "pause" or the Pause button calls `systemMenu()`, which replaces the fault menu. Its first item, "RESUME / MOONRUNNER", does nothing while `faulted`.
- **Result:** the menu stays open and the item silently no-ops.
- **Script output:**
  ```
  FAIL B1 first item of the replaced menu (RESUME / MOONRUNNER) does something :: menu still open after choosing it: true
  ```
- **Fix:** in `systemMenu`, when `this.faulted`, omit RESUME. Better, route `systemMenu` to `fail()`'s menu while faulted.

### F6. wrong: the timer badge keeps a frozen countdown when the link drops
`web/main.js:659-666,803-806`.
- **Mechanism:** remaining time is only updated by `timers` events from the service. On `offline` the badge keeps showing the last value with no stale marker. The `Timers` app does the same.
- **Script output:**
  ```
  FAIL B4 ... before="1 TIMER / 02:00" after 3 s offline="1 TIMER / 02:00"
  ```
- **Fix:** compute `remaining` locally from `deadline - Date.now()/1000` for running timers. Loopback means the same clock. At minimum, mark the badge stale while `device.connected` is false.

### F7. rough: a duplicate restart entry in the fault menu
`web/main.js:617-619`. The menu lists "RESTART APP" and "RESTART / NAME", which do the same thing. Seen in the labels printed by my first browser run (`["RESTART APP","RESTART / MOONRUNNER","DASHBOARD"]`) and in the code. Fix: drop the first entry when `this.app` is set.

### F8. rough: `tick`, `pause` and `resume` exceptions have no recovery menu
`web/main.js:124-127`. `lifecycle()` only toasts these exceptions. `docs/ENGINE.md` says app exceptions open the recovery menu. A throwing `tick()` toasts every second. Fix: call `fail()` for `tick` and `resume`, and keep the containment for `cancel` and `dispose`. Code reading only; no test.

### F9. rough: the click gesture drops the click that overruns the time window
`web/engine/input.js:51-53`. When `end - seq.start > total`, the sequence is reset and the current click is not counted as the start of a new one. By my reading of the code, a steady rhythm of about 300 ms per click at standard pace never opens the menu however many clicks follow. This may be a deliberate design choice. No test. Suggested fix: restart the sequence with this click as count 1.

### F10. rough: returning to the dashboard always focuses the first card
`web/main.js:44,317`. `homeIndex` is declared but never used, and `buildHome()` always passes `containerIndex = 0`. After playing item 6, a one-button user needs five taps to get back to it. Code reading only; no test.

## 3. Verification

Commands run from the worktree root, with these results.

```
node --test tests/*.test.mjs                      -> 33 pass, 0 fail (baseline, before my tests)
node --test tests/audit/host.test.mjs             -> H1-H5 all failed as written
node --test tests/audit/demo-parity.test.mjs      -> D1-D5 all failed (all five gaps present)
PYTHON=... PLAYWRIGHT_PATH=... TEST_BROWSER_BIN=/usr/bin/chromium TEST_OUTPUT=fleet/work/audit-host/test-output node tests/audit/host-browser.cjs
   -> FAIL B1, FAIL B4 (as quoted above)
```

- **H5 is not a finding:** a quiet bridge command with a `command` key in its payload overrides the command name. No caller does this, so it is theoretical. It remains in `host.test.mjs` and fails there, so someone running that file will see one failure that is not a finding.
- **Browser script:** it launches Chromium muted and uses an isolated simulator on a free port. All results are simulator and headless-browser results, not device results.
- **Checks I dropped:** two earlier browser checks (duplicate menu labels, and the first press after a reconnect being accepted) passed, so I removed them from the script. They are not defects.
- **Cleanup:** my first browser run left a simulator and Chromium alive. I found those by their `/tmp/vesper-audit-*` data directory and their Playwright profile, killed only those, and confirmed with `pgrep` that none remained. The live console process was not touched.

## 4. Not done / uncertain

- **Node STATUS cadence and the first press after reconnect:** the protocol doc says STATUS comes about once a second, so `blocked` should clear within about a second of a reconnect. The simulator check passed, so I did not report it.
- **Controller takeover race:** not proven. If a reloaded page connects before the server notices the old socket closed, the new page is a "monitor" with no retry (`bridge.js`, `server.py:372`). This needs two real sockets and timing I could not control here.
- **Faulted menu throws:** if `menuActions()` throws inside `fail()`, the host is left faulted with no menu. No current app does this, so it is theoretical.
- **`ctx.get`:** it is not guarded by `alive()`. It is harmless, so I did not report it.
- **Quiet commands from a monitor tab:** they produce error toasts. Seen in code only.
- **Hardware:** nothing here was verified on the device.

## 5. Branch

`worktree-agent-af2fe1e96da83895f`, commit `804a522`. Files: `tests/audit/host.test.mjs`, `tests/audit/demo-parity.test.mjs`, `tests/audit/host-browser.cjs`.

## Top three for someone playing with one button on the real device

1. **F1.** A lost release freezes the game's input until the user opens a menu or something disconnects.
2. **F2.** A hung light reply leaves lamp cleanup waiting up to 20 s, so lamps may stay lit after leaving an app.
3. **F5.** After a crash, "RESUME" can be a silent dead entry in the replaced menu. The user sees input that appears dead, the same symptom as F1.
