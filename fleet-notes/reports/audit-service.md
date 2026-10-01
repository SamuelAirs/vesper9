# audit-service: review of the Python service

## 1. Outcome

I read `vesper/*.py`, `scripts/install-service.py`, `scripts/kiosk.py`, both test files, `docs/PROTOCOL.md` and `docs/ENGINE.md` in full, and proved **16 defects** with failing `unittest` tests: **4 breaks, 6 wrong, 6 rough**. The tests are in `tests/audit/test_audit_service.py` (34 tests: 21 demonstrate defects and fail, 13 pin behaviour I checked and found correct and pass). No product file was touched; the normal suite still passes 29/29. I also validated every suggested fix in a scratch copy outside the repository: with the fixes applied all 34 audit tests and the existing 29 pass (diff: `fleet/work/audit-service/proposed-fixes.diff`, applies cleanly with `patch -p1`). The tests never open a serial port (a fake `serial` module and a fake node are injected) and never touch port 8799, `data/` or `backups/`.

Nothing here was verified on the real node or in the kiosk browser. Where a browser effect is claimed it is either measured in headless Chromium (finding R3) or marked "from reading the code".

## 2. Details, most important first

Line numbers refer to the source at `e3a723e`. "Test" names are in `tests/audit/test_audit_service.py`. Failing output is copied from `fleet/work/audit-service/audit-run-unfixed.txt`.

### BREAKS

**B1. The timer loop dies silently on one storage error, and no later timer ever completes.**
`vesper/server.py:294-309` (`tick`), started unsupervised at `:312`.
Owner experiences: after a single `sqlite3.OperationalError` at the moment a timer finishes (for example `database is locked` while a backup tool holds the file), the one-second loop's task ends with an exception that nobody reads until shutdown. Timers stop completing, no `timer_done`, no lamp pattern, and the Chronometer keeps showing running timers, until the service is restarted.
Test: `DefectBroadcastAndTimers.test_timer_loop_survives_a_transient_storage_error`
```
AssertionError: False is not true : tick() task is dead: later timers never complete
```
Fix: wrap one pass of the loop body in `try/except Exception: logging.exception(...)`, and add a done-callback to the tasks in `start()` that logs if they ever end. (About 6 lines.)

**B2. One failed write kills the heartbeat; the link stays "connected" while the node switches itself off.**
`vesper/device.py:210-213` (`heartbeat`), started at `:169`.
Owner experiences: `raw_send(PING)` has no error handling. A single `serial.SerialTimeoutException` (the port is opened with `write_timeout=.5`) ends the task; its exception is only collected when the link is torn down. The read loop keeps seeing the node's own STATUS frames, so `last_seen` stays fresh and the service never reconnects. The node's host watchdog is in `firmware/main/main.c:490`: after 3 s with no host frame it clears `mic_wanted`, cancels patterns and calls `lights_off()`. So the console shows the microphone live, the lamps go dark 3 s after the last command, and nothing recovers. (Firmware behaviour read from source, not observed on the board.)
Test: `DefectSerialLink.test_heartbeat_survives_one_failed_write` (full `SerialDevice.run()` against a fake node that sends STATUS on its own)
```
AssertionError: 0 not greater than or equal to 5 : only 0 PINGs in 0.6 s after one failed write: heartbeat task is dead
```
Fix: catch and log per ping, re-raise after three consecutive failures, and in the read loop add `if heartbeat.done(): heartbeat.result()` so a dead heartbeat forces a reconnect.

**B3. A tab that fails during the WebSocket handshake leaves a phantom controller; nobody can control the console until the service restarts.**
`vesper/server.py:371-375`. `console.clients.add(ws)`, the `controller` assignment and the first `await ws.send_json(state)` run before the `try:` whose `finally:` releases control (`:396-406`). If `console.state()` or that first send raises once (a tab reloaded or closed mid-handshake gives `ConnectionResetError`; a sqlite error inside `state()` does the same), the handler exits without releasing the slot. `broadcast()` only drops dead clients from `clients`, never from `controller`.
Owner experiences: every later tab, including the kiosk after a reload, is a monitor: "This is a monitor tab. Close the controlling tab, then reload." Nothing clears it.
Tests (both fail with the same message):
`DefectSessionAndControllerBookkeeping.test_failed_handshake_does_not_leave_a_phantom_controller` (state() raises once) and `...test_tab_that_vanishes_during_the_handshake_does_not_leave_a_phantom_controller` (first `send_json` raises `ConnectionResetError`)
```
AssertionError: False is not true : a dead handshake still owns the controller slot
```
Fix: move the `try:` up so it covers `clients.add`, the controller assignment and the first send (a 3-line move; the `finally` already does the right thing).

**B4. A storage error while saving a sensor sample takes the node link down repeatedly.**
`vesper/server.py:100-105` calls `store.sensor()` unguarded inside the serial read path; `vesper/device.py:178-196` and `:257` only catch `ValueError/struct.error/UnicodeDecodeError` around packets, so any other exception reaches `run()`'s `except Exception`, which closes the port and reconnects. `last_saved_sensor` is only advanced after success, so the next sensor frame retries and fails the same way. The firmware sends a sensor frame every 5 s (`firmware/main/main.c:400`).
Owner experiences: with the disk full or the database locked, the node link drops and reconnects every ~5 s (down for the 2 s reconnect pause each time), the microphone is shut off by the disconnect handling, and every tab gets disconnect events.
Test: `DefectSerialLink.test_sensor_storage_error_does_not_take_the_node_link_down` (frames at 50 ms to fit a unit test)
```
AssertionError: 10 != 1 : serial port was reopened 9 times in 1 s
```
Fix: advance `last_saved_sensor` first and wrap the store call in `try/except sqlite3.Error: logging.warning(...)`. Also worth making `SerialDevice.packet()` treat an exception from `emit` as that packet's failure rather than a link failure.

### WRONG

**W1. Stopping or restarting the service with a tab connected stalls about 24 s.**
`vesper/server.py:416-417` (cleanup only; no `on_shutdown` hook closes the WebSockets). After SIGTERM aiohttp waits for the idle `/ws` handler; `Console.stop()` (mic off, mute, store close) only runs after that.
Owner experiences: every `systemctl --user restart vesper`, including the one `install-service.py` performs, takes about 24 s while the kiosk tab is open, and the microphone state is untouched until then.
Measured (subprocess on a free port, simulator, temporary data): SIGTERM with no tab exits in 0.12 s; with one tab connected 24.48 s, 23.76 s, 24.18 s (`fleet/work/audit-service/shutdown.txt`). With a one-function `on_shutdown` hook that closes the clients it exits in 0.23 s and 0.33 s.
Test: `DefectProcess.test_service_restart_with_a_tab_connected_is_prompt`
```
AssertionError: service still running 8 s after SIGTERM with one tab connected
```
Fix: `app.on_shutdown.append(...)` closing every `console.clients` entry with `WSCloseCode.GOING_AWAY`.

**W2. One stalled client holds up every node event, because the serial reader awaits `broadcast()`.**
`vesper/server.py:75-84`; called per packet from `Console.event`, which `SerialDevice.packet()` awaits in the read loop.
Owner experiences: `broadcast()` sends to clients one after another with a 1 s timeout each. One wedged monitor tab, or a controller tab that stops reading, delays a button press, the sensor, the audio level and the lamp echo by a full second per event until that client is timed out and closed.
Test: `DefectBroadcastAndTimers.test_a_stalled_client_does_not_hold_up_the_node_event_path`
```
AssertionError: 1.0026380170002085 not less than 0.25 : event() took 1.00s with one stalled client
```
Fix (validated): give each client its own send task (`self.schedule(self.send_to(client, event))`); per-client frame order is preserved because each `send_json` writes its frame before its first await. This matters more once a spectrum stream is added (section 3).

**W3. An unplugged (or never-speaking) node is re-announced as "disconnected" every 2 s, forever.**
`vesper/device.py:196-208`: the `finally` of every failed attempt emits `{"type":"device","connected":false}` and the `except` logs `Node link: ...` again (about 43,000 lines a day).
Owner experiences (from reading `web/main.js:668-677`, not run in a browser): each such event cancels input, invalidates the lamp cache and, if an app is open and the system menu is not, re-opens the system menu. With the cable out, an app such as the Chronometer is paused again every 2 s.
Test: `DefectSerialLink.test_unplugged_node_is_announced_once_not_on_every_attempt`
```
AssertionError: 13 not less than or equal to 1 : 13 identical disconnect events
```
Fix: emit only when the link was actually connected (`was_connected = self.connected` at the top of the `finally`); log a repeated failure once, then every N attempts.

**W4. A preferred port that exists but never speaks the protocol blocks the working alternative.**
`vesper/device.py:157`: every attempt takes the first candidate that exists. The live unit passes two (native USB and COM). If the first is present but silent, the service reopens it every 6 s (4 s stale rule plus 2 s pause) and never tries the second.
Owner experiences: "NODE LINK LOST" while a working path exists.
Test: `DefectSerialLink.test_a_silent_preferred_port_does_not_block_a_working_alternative`
```
AssertionError: False is not true : never connected; ports tried: ['/dev/fake-usb']
```
Fix (validated): count failed attempts and index into the existing candidates with it (`present[failed % len(present)]`), resetting the counter on a successful connect.

**W5. Errors the handler does not list drop the sender's session instead of returning an error reply.**
`vesper/server.py:394` catches `ValueError, TypeError, KeyError, ConnectionError, asyncio.TimeoutError, struct.error` only. Anything else (OSError family, sqlite3.Error, OverflowError, RecursionError) leaves the handler; aiohttp drops the connection and, if it was the controller, the `finally` mutes the mic and clears the lamps.
Reachable from the shipped UI under fault: `serial.SerialTimeoutException` (a write exceeding `write_timeout=.5`) during any `leds`/`cancel` command, and `sqlite3.OperationalError` during `settings`, `timer`, `progress` or `score`. Also reachable from any non-browser client: an integer too large for `float()` (timer seconds, score, setting value), `1e999` in `reaction`/`pattern` (`int(inf)`), and 50,000 nested brackets (`json.loads` RecursionError). The shipped browser itself cannot emit those numeric forms (`JSON.stringify` writes `null` for Infinity and exponent notation for large numbers), so that half is rough.
Tests: `DefectCommandValidation.test_device_and_storage_errors_get_an_error_reply_not_a_dropped_session` (6 sub-cases) and `...test_out_of_range_numbers_get_an_error_reply_not_a_dropped_session` (8 sub-cases); all give
```
AssertionError: <WSMsgType.CLOSED: 257> is not an instance of <class 'dict'> : server dropped the connection (257) instead of replying
```
Fix: `except Exception as exc` in the handler (still replies `ok: false`). Also in `command()` write to the store before mutating `self.settings`/`self.timers`, because today the in-memory state changes first and a failing `put` leaves memory and database disagreeing (from reading `:278-279` and `:195-218`, not asserted by a test).

**W6. `console.focus` is not reset when the controlling tab leaves.**
`vesper/server.py:289` sets it; nothing resets it on disconnect (`:398-406`); `tick()` only pulses the lamps for a finished timer when focus is `home`, `timers` or `environment` (`:303`).
Owner experiences: if the browser closes or crashes while a game is open, a timer that ends afterwards never lights the lamps, the only alert left with no browser.
Test: `DefectSessionAndControllerBookkeeping.test_focus_returns_home_when_the_controller_leaves`
```
AssertionError: 'runner' != 'home'
```
Fix: `console.focus = "home"` next to `console.controller = None`.

### ROUGH

**R1. Validation is looser than the rest of the code (and unlike `leds`/`settings`).**
`server.py:229, 234, 240, 250`, `storage.py:34`, `server.py:270`, `:355`, `:47`.
- Booleans, numeric strings and floats are coerced: `{"score": true}` writes `1.0` to the high-score table, `reaction trial: true` and `delay: "500"` are accepted, `pattern repeat: "2"` and `true` are accepted, `{"pressed": "false"}` presses the simulated switch. Test `DefectCommandValidation.test_wrong_types_are_rejected_not_coerced` (7 sub-cases): `AssertionError: 'orbit' unexpectedly found in {'orbit': 1.0} : score=true was stored as a high score`. Fix: `type(x) is int` / `type(x) is bool` checks like the ones `leds` and `validate_setting` already use.
- `progress` accepts `NaN`/`Infinity` (Python's json does), after which `/api/state` and every new tab's state frame are not valid JSON for `JSON.parse`. Not reachable from the shipped UI. Test `test_non_finite_progress_cannot_poison_state`: `AssertionError: /api/state is not strict JSON after a progress write: invalid JSON constant NaN`. Fix: `json.dumps(value, allow_nan=False)`.
- `/api/sessions?offset=99999999999999999999` reaches SQLite as an oversize integer and returns 500. Test `test_sessions_offset_overflow_is_a_client_error`: `AssertionError: 500 not found in (200, 400)`. Fix: clamp the offset.
- Settings read from the database at startup are merged over the defaults without `validate_setting` (`:47`). Test `DefectUpgradeAndStorage.test_stored_settings_are_trusted_without_validation`: `AssertionError: 2 not found in (0, 3, 4)`. Fix: validate each stored key and skip invalid ones.

**R2. A crash or power cut during dictation leaves the session open for ever.**
`vesper/storage.py:44-52`; nothing reconciles at startup. Notes show `ended = NULL` for ever.
Test: `DefectSessionAndControllerBookkeeping.test_session_rows_are_not_left_open_after_an_unclean_stop`
```
AssertionError: unexpectedly None : session still open after restart
```
Fix: in `Store.__init__`, `UPDATE sessions SET ended=COALESCE((SELECT MAX(at) FROM lines WHERE session=sessions.id), started) WHERE ended IS NULL`.

**R3. Static files carry ETag and Last-Modified but no Cache-Control, so a persistent kiosk profile can keep serving the old UI after an upgrade.**
`vesper/server.py:328-340` (middleware), `:415` (static).
Measured with headless Chromium (muted) and a persistent profile against a scratch server using the same aiohttp `FileResponse`/`add_static` calls (`fleet/work/audit-service/stale-cache.txt`, reproduce with `run_stale.sh`): files 40 days old on first fetch; after the content changed, a new browser session on the same profile showed the old page (`build-1`) and the service saw no request for `/` or `/app.js`. With `Cache-Control: no-cache` the same experiment shows `build-2` (a 304 round trip). The freshness window is 10% of the file's age, so it is short for files modified tonight and grows with the age of the install.
Test: `DefectHttp.test_static_files_are_revalidated_after_an_upgrade` (5 paths)
```
AssertionError: False is not true : Cache-Control is ''
```
Fix: `response.headers["Cache-Control"] = "no-cache"` in `local_only`.

**R4. Pausing a timer in the instant after it expires strands it at 00:00 without alerting.**
`vesper/server.py:204-207`: the toggle between the deadline and the next once-a-second tick stores `remaining=0, running=False, finished=False`; `tick()` only looks at running timers, so `timer_done` and the lamp pattern never fire. Window under one second.
Test: `DefectBroadcastAndTimers.test_pausing_a_timer_at_the_instant_it_expires_still_alerts`
```
AssertionError: True is not false : timer stranded at zero without finishing: {... 'remaining': 0, ..., 'running': False, 'finished': False}
```
Fix: in the running branch of `toggle`, if `time.time() >= timer["deadline"]` return and let `tick()` finish it.

**R5. Re-running the installer without `--data` silently points the service at the checkout's empty data directory.**
`scripts/install-service.py:26-28`: the unit is regenerated from the current arguments only. Adding `--kiosk` later without repeating `--data` drops it; scores, timers and notes appear to be gone (the old unit survives only under `backups/service-*`).
Test: `DefectInstaller.test_reinstall_without_data_keeps_the_existing_data_directory`
```
AssertionError: '/tmp/.../existing-data' not found in '[Unit]\n... ExecStart="/tmp/.../python" "-m" "vesper.server" "--port" "/dev/test-node" ...' : second install dropped the data directory
```
Fix: when `--data` is absent and the existing unit has one, carry it over (or refuse and say so).

**R6. The kiosk launcher gives up after 30 s and leaves a blank desktop.**
`scripts/kiosk.py:12-21`. If the service is slow (SD check after a power cut, restarting at login) the script exits; nothing relaunches it before the next login. `web/engine/bridge.js:51` already reconnects every 1.5 s, so launching anyway is safe.
Test: `DefectKiosk.test_kiosk_launcher_does_not_give_up_when_the_service_is_slow`
```
AssertionError: kiosk launcher exited without starting the browser: VESPER service did not start; check journalctl --user -u vesper.service
```
Fix: print a note and fall through to `os.execv` instead of `SystemExit`.

### Checked and found correct (tests pass)

`VerifiedProcess`, `VerifiedSerialLink`, `VerifiedService` in the same file:
- HTTP listener answers on 127.0.0.1 and refuses the machine's LAN address (real subprocess).
- Host rules (`evil.test`, `localhost.evil.test`, `127.0.0.1.evil.test`, `0.0.0.0`, `localhost.` all 403) and Origin rules (`null`, other ports, other hosts all 403; same origin 200).
- Static traversal: eight encodings (`/../`, `%2e%2e`, `..%2f`, `//etc/passwd`, backslashes, via `/ws/../`) never return a file outside `web/`.
- A second tab cannot send commands (leds, mic, settings, score, button) and cannot inject audio bytes.
- Microphone starts muted; a failed enable (no model) leaves device, speech and session off and creates no session row; controller disconnect mutes the mic and clears the lamps.
- Unconfirmed mute closes the port so the node watchdog takes over, ends the session, leaves the console off.
- Node HELLO mid-session turns the microphone off; reconnect after unplug sends MIC 0, CANCEL, LEDS 0 first and bumps the generation; pending command futures fail within a second when the link drops and `pending` is emptied.
- Progress limit: exactly 8192 characters accepted, 8193 rejected, unknown or wrongly typed app ids rejected. 40 malformed payload shapes (wrong types, missing fields, out-of-range values, unknown commands) all return `ok: false` without raising.
- Settings from an older version are merged with new defaults.
- Measured, not a problem here: SQLite commits on this Pi's NVMe: p50 ~1.6 ms, p99 ~10 ms, max 17 ms over 900 writes (`measure_commit_latency.py`); creating the Vosk recognizer on the event loop stalled it at most 44 ms with the real model (no audio recorded or played).

## 3. Extension notes

**(a) Small read-only system-health endpoint.** Adding a route is easy (the `local_only` middleware applies automatically; a route registered after `add_static("/")` still matches, I checked). What makes it awkward:
1. The service keeps no node-status record. `SerialDevice.packet()` (`device.py:245-256`) broadcasts HELLO/STATUS fields (`fw`, `link`, sensor diagnostics) and keeps only `mic`, `pressed`, `leds`. A health payload with firmware and link type needs a stored `last_status` and a `last_seen` age on both `SerialDevice` and `SimulatedDevice` (they are duck-typed with no shared base, and `Console.state()` reads attributes directly).
2. `Console.state()` is not cheap enough to poll: it reads the database on the event loop (`scores()`, `get("progress")`) and runs `speech.availability()` (module lookup plus stat). Health needs its own light path.
3. Host metrics (CPU temperature, load, memory, disk, throttling) are blocking file reads or a `vcgencmd` subprocess. The only off-loop pattern is `asyncio.to_thread` (speech, serial); the SQLite connection is thread-bound, so off-loop work cannot touch the store.
4. Nothing exposes whether the service is healthy: no event-loop lag, start time, queue depth (`speech.queue.qsize()` exists but is not surfaced), failed-broadcast count, or task liveness. Because `device.run()` and `tick()` are unsupervised (B1), a health endpoint would be the only way to see them die: fix B1 first, then report `Console.tasks[i].done()`.
5. Browser frame time (planned for TELEMETRY) is not known to the service, and the only write path is a controller-only WebSocket command; a read-only endpoint cannot receive it.

**(b) An explicit analyse-only microphone mode (level and spectrum, no recognition, nothing stored).**
1. Mode names are hard-coded in two places that must agree: `Console.set_mic` (`server.py:138`) and `Speech.set_mode` (`speech.py:45`), plus the browser. `set_mic` calls `speech.set_mode(mode)` for every non-off mode (`:168`), which requires Vosk and the model (`availability()`, `speech.py:33-38`) and raises `invalid microphone mode` for an unknown name. A new mode needs a branch in `set_mic` between "recognition modes" and "analysis modes", and it must work with the speech extra not installed; `state()["mic"]["unavailable"]` must not report the speech text for it.
2. Keep the existing safety order: mute, switch workers, then enable the node and wait up to 2.5 s for `STATUS.mic`, with cleanup on any exception. That sequence (`server.py:137-187`) is reusable as is, but it is one 50-line method with try/except/finally, so edit it carefully and keep "a failure leaves capture off".
3. Audio fan-out is in `Console.event` (`:88-99`): every chunk goes to `speech.feed` (ignored when the speech worker is off) and an RMS level is computed at most 10 times a second. A spectrum needs a second consumer and a new event type. Measured here: a 512-point windowed FFT in pure Python (no numpy in the dependencies) costs 3.3 ms per frame, about 3% of one core at 10 frames/s; run it in `asyncio.to_thread` or keep it at 10 frames/s or fewer.
4. Every event goes through the sequential `broadcast()` that the serial reader awaits (W2). Ten to twenty spectrum frames a second multiplies the exposure; fix W2 first.
5. Notes bookkeeping is already safe: only `"transcribe"` creates a session (`:169-170`), so an analyse mode stores nothing, provided it is not folded into that branch.

## 4. Verification

Run from the worktree root with `PYTHON=/home/sam/VESPER-9-v0.2.0-Claude/vesper9/.venv/bin/python`.

| Command | Result |
| --- | --- |
| `$PYTHON -m unittest discover -s tests -p 'test_*.py'` | `Ran 29 tests in 3.723s` / `OK` (before and after my work; the audit directory is not discovered) |
| `$PYTHON -m unittest tests/audit/test_audit_service.py -v` | `Ran 34 tests in 28.692s` / `FAILED (failures=44)`: 21 tests fail (44 failing assertions counting sub-tests), 13 pass. Per-test list: `fleet/work/audit-service/audit-summary-unfixed.txt`; full output: `audit-run-unfixed.txt` |
| Same two commands in a scratch copy with `proposed-fixes.diff` applied | `Ran 34 tests` / `OK`, and `Ran 29 tests` / `OK` (my first draft of the R2 fix deleted empty sessions, which broke two existing tests; I dropped that part, so no existing test needs changing) |
| `patch -p1 --dry-run < fleet/work/audit-service/proposed-fixes.diff` in the worktree | applies cleanly to 6 files; not applied |
| `bash fleet/work/audit-service/run_stale.sh` | shipped headers: old page served, no request to the service; with `Cache-Control: no-cache`: new page |
| `probe_shutdown.py`, `probe_fix.py` | 24.48 s, 23.76 s, 24.18 s with a tab; 0.12 s without; 0.23 s and 0.33 s with the on_shutdown fix |
| `measure_commit_latency.py`, `fft_cost.py` | numbers quoted above |

Everything ran against the simulator, a fake `serial` module or scratch servers on free ports with temporary databases. At the end `pgrep` showed none of my processes (other agents' `vesper.server --simulate` processes and the live service were left alone).

## 5. Not done / uncertain

Not proven, so not counted as findings:
- **Hung browser keeps the microphone on.** `ENGINE.md` says capture stops on "controlling-tab disconnect or host watchdog expiry". The service has no browser-liveness check (only the node's watchdog exists), and a frozen renderer still answers WebSocket pings at the network layer. Needs a hung tab to confirm; the test would be "controller silent for N s turns the mic off", and N is a product decision.
- **Capture left on while the console says off.** `set_mic("off")` returns early when `Console.mode` is already `off` (`server.py:141-142`), nothing compares `STATUS.mic` with the console mode, and the cleanup mute after a failed start is wrapped in `suppress(Exception)` (`:179-180`). It takes two failures in a row (start accepted but unconfirmed, then the cleanup mute lost), so I could not show it is reachable and did not write a test.
- **Kiosk Chromium after a power cut or a crash** (restore-pages bubble, no relaunch if the browser exits): `kiosk.py` passes none of the usual suppression flags and nothing supervises it. Not run.
- **Reload race:** a closing controller's cleanup (mic off, CANCEL, lamps zero, `server.py:398-406`) can run after a new tab has already become controller. Timing dependent; not reproduced.
- A STATUS or HELLO payload that is valid JSON but not an object raises `AttributeError` in `device.packet()` and drops the link; needs a CRC-valid malformed frame from the node, so theoretical.
- Considered and dropped: the `[::1]` host check (`server.py:331`) rejects `[::1]:8799` but the server binds IPv4 only, so it is unreachable; `reset_settings` is a command missing from the list in `docs/PROTOCOL.md` (docs only); a lost final audio chunk on stop (the node is muted first, so the queue drains before the flush).
- Timer clock-change behaviour was read against its documented policy and left alone.
- All simulator and fake-node results: none of this proves anything about the real node, USB link or Chromium kiosk.

## 6. Branch

`worktree-agent-a422913482f099b5e`, last commit `3dd8db5` ("Audit tests: add the realistic handshake-failure trigger"), after `fac21e9`. Only `tests/audit/test_audit_service.py` was added. Supporting scripts and outputs are under `fleet/work/audit-service/` (outside git).
