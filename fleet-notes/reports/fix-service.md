# fix-service: audited Python defects fixed, system health and sound analysis added

## 1. Outcome

All 16 audited defects are fixed, each with a test that failed before and passes now, plus five items from the audit's "Not done" list and several robustness gaps I found while reading the proposed patch. Two features were added as separate modules with thin hooks in `vesper/server.py`: `GET /api/system` (`vesper/health.py`) and the microphone mode `analyze` (`vesper/analysis.py`). Both are documented in `docs/PROTOCOL.md` and tested. All verification commands pass; restart with a tab connected went from about 24 s to 0.3 to 0.6 s. Nothing here was run against the real node, serial port, Pi kiosk or live service.

## 2. Details

### 2.1 Defects (audit id: fix, test)

Tests live in `tests/test_service_fixes.py` (the 34 audit tests moved there; classes `Fixed*` prove defects, `Verified*` pin checked behaviour) and `tests/test_service_features.py` (new). `tests/audit/test_audit_service.py` no longer exists; nothing under `tests/audit/` fails (the remaining files there are other agents' and are not Python tests).

I did not apply `proposed-fixes.diff` as is. Hunks kept as written: stored-settings validation, `no-cache`, offset clamp, focus reset, session reconciliation, `type() is` checks, the `allow_nan=False` guard, kiosk fall-through (then improved, see R6). Hunks changed or rejected, and why, are marked "differs".

| Id | Fix | Test |
| --- | --- | --- |
| B1 timer loop dies | `tick` wraps each pass in try/except with `logging.exception`; one pass is `tick_once`. Differs: the timer alert (`timer_done`, lamps) goes out before the save, each timer's alert stands alone, and a failed save sets `timers_dirty` and is retried next second (the diff would have marked the timer finished in memory and lost the alert when the save failed). Both long-lived tasks run under `Console.supervise`: an error or an unexpected return is logged and the task restarted with back-off (1, 2, 4 ... 30 s), so nothing ends silently. `/api/system` exposes `service.tasks` liveness. | `test_timer_loop_survives_a_transient_storage_error`; new `test_timer_alert_goes_out_even_when_the_database_fails_and_is_saved_later`, `SupervisedTasks` (2) |
| B2 heartbeat dies | Heartbeat logs each failed ping and re-raises after 3 in a row; the read loop checks `heartbeat.done()` and reconnects. Differs/extra: a shared write-failure counter in `SerialDevice.write()` (used by pings and commands) closes the port after 3 consecutive failed writes, so a port that can read but not write is torn down and reopened cleanly (the diff only covered pings). One failed write never drops the link. | `test_heartbeat_survives_one_failed_write`; new `SerialWriteFailures`: three failed writes reconnect, failed command writes count and the error still reaches the caller, one failed write keeps the link |
| B3 phantom controller | `try/finally` covers `clients.add`, the controller assignment and the first state frame. Extra: a client whose send fails or stalls is dropped through `Console.drop`, which frees the controller slot immediately (not when aiohttp's close handshake finishes); `release_controller` is idempotent. | both audit handshake tests; new `ControllerHandover.test_a_stalled_controller_loses_the_slot` |
| B4 sensor store error flaps link | `last_saved_sensor` advanced first; any store error logged. Extra: an exception while handling one packet (listener or storage) is logged as that packet's failure and no longer reaches `run()` (`device.packet`). | `test_sensor_storage_error_does_not_take_the_node_link_down`; new `test_a_listener_that_raises_does_not_drop_the_link` |
| W1 24 s restart | `on_shutdown` closes every WebSocket with GOING_AWAY (sets `closing` first, so the cleanup is not run twice); sockets use a 2 s close timeout and `run_app(shutdown_timeout=3)` is a backstop. | `test_service_restart_with_a_tab_connected_is_prompt` (subprocess); measured below |
| W2 stalled client holds up node events | Differs: instead of one task per event, each client has an `Outbox` (bounded queue plus one writer task). Frame order per client is guaranteed, memory is bounded (200 frames, then the client is dropped), and replies go through the same queue, so a command's reply can never overtake an event broadcast before it (the diff's per-event tasks would have allowed that). | `test_a_stalled_client_does_not_hold_up_the_node_event_path`; new `test_frames_to_one_client_keep_their_order_and_a_reply_follows_the_events_before_it` |
| W3 unplugged node re-announced | Disconnect emitted only when a link existed; failure logged once, then every 30th attempt. | `test_unplugged_node_is_announced_once_not_on_every_attempt`; new `test_a_node_that_stays_away_is_logged_once_not_every_attempt` |
| W4 silent preferred port | As proposed (rotate through the present candidates by consecutive failed attempts, reset on a successful connect). | `test_a_silent_preferred_port_does_not_block_a_working_alternative` |
| W5 unlisted errors drop session | Handler catches `Exception` and replies `ok: false` (unexpected ones are logged with a traceback); deep JSON gets its own error. Memory-before-disk: settings, timers and `reset_settings` now build the new value, write it, then swap it in. | both audit W5 tests (14 subcases); new `test_failed_writes_leave_memory_and_database_in_agreement` |
| W6 focus not reset | `focus = "home"` when the controller is released. | `test_focus_returns_home_when_the_controller_leaves` |
| R1 loose validation | Every command checked explicitly: `type(x) is int/bool`, strings must be `str`, lists must be lists, step/value shapes; timer `seconds` must be a plain finite number (a string `"60"` or `true` is refused) and `label` text; `app`/`metric`/`focus`/`mic mode` must be strings (unhashable values no longer reach set lookups). `allow_nan=False` in `progress` and in `Store.put`. `score` and `validate_setting` range-check before `math.isfinite` (it overflows on huge integers). Stored settings validated at start (a non-dict is ignored); stored timers validated (malformed ones dropped). Differs: the diff removed `isfinite` from `validate_setting`; I kept it after the range test. | `test_wrong_types_are_rejected_not_coerced`, `test_non_finite_progress_cannot_poison_state`, `test_stored_settings_are_trusted_without_validation`, `test_sessions_offset_overflow_is_a_client_error`; new `test_wrong_types_in_timer_commands`, `test_malformed_stored_timers_and_settings_are_ignored` |
| R2 open sessions | Closed at start-up at the last line or the start. | `test_session_rows_are_not_left_open_after_an_unclean_stop` |
| R3 static caching | `Cache-Control: no-cache` on every response, including 4xx/404 pages (the diff set it only on successful responses; the HTTPException path skipped all three headers). | `test_static_files_are_revalidated_after_an_upgrade` (5 paths); new `test_error_pages_are_not_cached_either` |
| R4 pause at expiry | Toggle on a due timer returns and lets `tick` finish it. | `test_pausing_a_timer_at_the_instant_it_expires_still_alerts` |
| R5 installer drops `--data` | Differs: parses the unit being replaced (working directory and ExecStart, with the installer's own escaping). Without `--data` it keeps the old service's effective data directory whenever that differs from what the new default would be (explicit `--data`, another checkout, simulator versus node), says so, and always prints `Data directory: ...`. An explicit `--data` that changes it prints the change. An unreadable unit falls back to the default and says which. | `test_reinstall_without_data_keeps_the_existing_data_directory`; new `InstallerKeepsData` (6) |
| R6 kiosk gives up | Waits 3 minutes (was 30 s). If the service still does not answer it prints to stderr and opens a temporary `file://` page "VESPER-9 SERVICE NOT RESPONDING" that retries every 3 s and opens the console when the service answers. Verified in headless muted Chromium against a scratch service (it navigated 2.8 s after the service came up; screenshot `fleet/work/fix-service/kiosk-wait.png`). A first attempt with a `data:` URL failed in Chromium (private-network CORS block); the file page does not have that problem. | `test_kiosk_launcher_does_not_give_up_when_the_service_is_slow`; new `KioskLauncher` (2) |

### 2.2 From the audit's "Not done / uncertain"

- **Hung browser keeps the microphone on** (real, fixed as opt-in). There is no app-level liveness traffic from the browser, and a frozen renderer still answers WebSocket pings, so a timeout cannot be enforced for the shipped browser without a front-end change. New command `keepalive` (controller only, no-op). Once a controlling tab has sent one, 20 s without any message from it while a microphone mode is active turns the microphone off and broadcasts an `error`. Tabs that never send it are unaffected. Tests: `test_a_silent_controller_that_opted_in_loses_the_microphone`, `test_keepalive_traffic_keeps_the_microphone_...`, `test_nothing_is_enforced_for_a_browser_that_never_sends_a_keepalive`, monitor tab refused.
- **Capture left on while the console says off** (fixed). `set_mic("off")` no longer returns early while the node reports capture, and the one-second tick re-sends the mute when the node reports capture for two ticks while the console is off (not while a mode change holds the lock). Test `test_capture_the_console_does_not_know_about_is_muted_again`.
- **Reload race** (fixed). A reloaded tab becomes controller at once; its commands wait (max 5 s) on the previous controller's cleanup, so that cleanup cannot undo what the new tab just did. The cleanup steps (microphone off, cancel, lamps off) now run independently, so a failure of the first no longer skips the others. Tests `ControllerHandover` (4 tests, two of them for this).
- **STATUS/HELLO that is not an object** (fixed): refused as an invalid payload, link stays up. Test `test_a_status_that_is_not_an_object_does_not_drop_the_link`.
- `reset_settings` added to the command list in `docs/PROTOCOL.md`.

### 2.3 Feature A, system health: specification as documented

`GET /api/system` is documented in the "System health" section of `docs/PROTOCOL.md` (field table, example reply). Summary: read-only strict JSON, `Cache-Control: no-cache`, the usual Host/Origin rules, always the same shape, `null` for anything the host cannot supply. Blocking reads run in `asyncio.to_thread` (`HostProbe.sample`); `vcgencmd get_throttled` only if installed, 1 s timeout, cached 5 s; no new dependency.

```
{schema:1, at, simulated,
 host:{model, cpuTempC, loadAvg:[1,5,15], cpuCount, cpuPercent, cpuPerCore:[], cpuWindowS,
       memory:{totalBytes,availableBytes}, disk:{totalBytes,freeBytes}, uptimeS,
       throttled:{raw, underVoltageNow, freqCappedNow, throttledNow, softTempLimitNow, ...Occurred} | null},
 service:{version, startedAt, uptimeS, rssBytes, pid, python, tasks:{device,timers}|null, clients, micMode},
 node:{connected, simulated, port, link, firmware, statusAgeS, capture, generation, crcErrors, missingSamples,
       audioBytes, nodeRxCrc, audioDrops, sensor:{addr,ok,fail,err}|null}}
```

CPU utilisation is since the previous call (first call: since the service started); calls under 0.5 s apart share one window. `disk` is the filesystem of the data directory. In `--simulate` mode host and service values are real, and the node block is marked: `simulated: true`, `port`/`link`/`firmware` = `"simulated"`, `sensor.simulated: true`. To support this, both device classes now keep the last status record (`status`, `status_at`, `status_age()`), as the audit's extension notes said they must.

Real output from a simulated service on a free port is in section 3.

Tests: `HostProbeTests` (fake `/proc` and `/sys` with exact values, every source missing, garbage sources, throttle decoding, `vcgencmd` timeout, shared CPU window), `SystemEndpoint` (shape, simulated marking, strict JSON, missing sources, a deliberately slow host read does not stall the event loop (max loop gap under 0.2 s while the read takes 0.5 s), POST refused, bad Host refused, a dead task is visible) and `SystemEndpointOnTheNodeLink` (firmware, link, counters and sensor diagnostics from a fake node's STATUS; null before any status).

### 2.4 Feature B, sound analysis: specification as documented

Microphone mode `analyze` is documented in "Microphone modes" and "`analysis` event" in `docs/PROTOCOL.md`. Summary:

- `{"command":"mic","mode":"analyze"}`, controller only, any other name or type refused. It needs no speech model. `Console.set_mic` skips `speech.set_mode` for it; `Speech.set_mode` still rejects the name; mode names live in `server.MIC_MODES`/`RECOGNITION_MODES`. No session is created, nothing is stored, only a 1024-sample window is kept.
- All the microphone rules apply: starts muted; `state.mic.mode` and the `mic` event change only after the node confirms capture (2.5 s); leaving the mode stops acquisition first; a node disconnect or reset, a lost controller, a failed analysis (`analysis_error` event, `state.mic.error`) or three seconds without audio end capture and return to `off`.
- Event, about every 100 ms: `{"type":"analysis","at","seq","rmsDb","peakDb","bands":[28 dB values],"pitch":{"hz","confidence"}|null,"simulated"}`. RMS and peak in dBFS over the audio since the previous frame; bands logarithmic from 60 Hz to 7 kHz (edges in `state.mic.analysis.edgesHz`), mean bin power in dB where a full-scale sine centred on a bin reads 0 dB, floor -120; pitch 60 to 800 Hz by normalised autocorrelation (McLeod) on a 4x decimated copy with parabolic interpolation, `null` below confidence 0.6 or RMS -60 dBFS.
- `state.mic` gained `modes` and `analysis` (`rate`, `bands`, `edgesHz`, `intervalMs`).
- Pure Python, no numpy. A 1024-point real FFT costs about 2 ms (computed as a 512-point complex FFT with the real-input packing trick, verified against a direct DFT); pitch about 1.5 ms. Analysis runs in `asyncio.to_thread`; only `Analyzer.feed` (cheap running sums) runs on the loop; at most one analysis is in flight and a late frame is skipped, not queued.
- Simulator: a deterministic synthetic signal (tone sweeping 110 to 700 Hz and back over 24 s at about -23 dBFS RMS, faint noise at about -71 dBFS), events carry `"simulated": true`. Browser audio frames are ignored while in `analyze`.

Tests (`test_service_features.py`): `AnalysisMath` (FFT against a direct DFT, 0 dBFS calibration, band layout, tone in the right band and quiet elsewhere, silence, RMS and peak, pitch of 8 tones from 65 to 800 Hz, harmonic tone, noise gives no pitch, tone in noise, quiet gate, analyzer cadence, synthetic source, cost bound), `AnalyzeMode` through the service (11: muted start, no speech model, nothing stored, shape and ten per second, controller-only and name checks, leaving stops events, controller disconnect, switching with recognition modes, unconfirmed start leaves everything off, browser audio ignored, analysis failure, audio stall) and `AnalyzeOnTheNodeLink` (audio frames from a fake node over the real serial transport produce events with the right pitch; link loss ends capture; no node refuses).

## 3. Verification

From the worktree root, with `PYTHON`, `PLAYWRIGHT_PATH`, `TEST_BROWSER_BIN`, `TEST_OUTPUT` as in the rules:

| Command | Result |
| --- | --- |
| `$PYTHON -m unittest tests/audit/test_audit_service.py` before the fixes | 34 tests, 21 failing (44 failing assertions), as the audit said |
| same file with the fixes (before moving it) | `Ran 34 tests` / `OK` |
| `$PYTHON -m unittest discover -s tests -p 'test_*.py'` | `Ran 131 tests in ~53 s` / `OK` (29 existing + 34 audit + 68 new), run three times, all OK |
| `node --test tests/*.test.mjs` | 133 pass, 0 fail |
| `python3 scripts/build-catalog.py --check` | exit 0 |
| `python3 scripts/build-demo.py && node tests/browser-smoke.cjs && node tests/extension-smoke.cjs && node tests/host-browser.cjs` | all exit 0 (`passed: true`; host-browser ends `PASS no uncaught page errors`); outputs in `fleet/work/fix-service/test-output.*.txt` |
| `pgrep -af "vesper.server|chromium.*headless"` at the end | only other agents' and the live service's processes; none of mine |

Measurements (scripts and raw output in `fleet/work/fix-service/`: `measure.py`, `features.txt`, `restart-before.txt`, `restart-after.txt`, `bench.txt`, `kiosk-wait.*`). The Pi was busy with other agents during all of them (load average 9 to 15, SoC at 82 C, so CPU figures are probably pessimistic).

**Restart with one tab connected** (SIGTERM to process exit, simulated service, three runs each, same script): before (`c03b453` source) 24.08 s, 23.29 s, 24.62 s; after 0.33 s, 0.28 s, 0.63 s.

**CPU cost of analysis** (service process CPU time from `/proc/<pid>/stat`, one tab connected, 20 s):
- mic off: 0.0 to 0.1 % of one core.
- `analyze` in the simulator: 10.3 % and 10.6 % in two runs (200 events in 20 s, exactly 10.0 per second). This includes the synthetic signal generator (about 2.5 %), which does not exist with the real node.
- Single-threaded benchmark of the pure analysis path for 10 s of audio (`bench.txt`): 100 frames, 0.463 s CPU = 4.6 % of one core, 4.6 ms per frame including `feed`. So the real-node cost is about 5 %, the rest of the simulator figure being the generator, JSON encoding and thread hand-offs under load.

**Real `/api/system`** from `python -m vesper.server --simulate --http-port <free>` (second call; the full JSON is also in `PROTOCOL.md`):

```
{"schema":1,"at":1790830472.053,"simulated":true,
 "host":{"model":"Raspberry Pi 5 Model B Rev 1.1","cpuTempC":82.6,"loadAvg":[14.28,15.47,14.02],"cpuCount":4,
  "cpuPercent":81.0,"cpuPerCore":[85.3,57.4,94.2,87.0],"cpuWindowS":1.03,
  "memory":{"totalBytes":8337108992,"availableBytes":6420631552},
  "disk":{"totalBytes":4168556544,"freeBytes":4164759552},"uptimeS":3961.6,
  "throttled":{"raw":"0xe0000","underVoltageNow":false,...,"freqCappedOccurred":true,"throttledOccurred":true,"softTempLimitOccurred":true}},
 "service":{"version":"0.2.0","startedAt":1790830471.0,"uptimeS":1.1,"rssBytes":42000384,"pid":86938,"python":"3.13.5",
  "tasks":{"device":true,"timers":true},"clients":0,"micMode":"off"},
 "node":{"connected":true,"simulated":true,"port":"simulated","link":"simulated","firmware":"simulated","statusAgeS":1.1,
  "capture":false,"generation":1,"crcErrors":0,"missingSamples":0,"audioBytes":0,"nodeRxCrc":null,"audioDrops":null,
  "sensor":{"simulated":true,"ok":1,"fail":0,"err":null}}}
```

(The disk figure is the temporary data directory's filesystem, a 4 GB tmpfs. The throttle flags show this Pi has been throttled and frequency-capped since boot, probably heat under the overnight load; worth a look.)

**Real `analysis` events** captured over the WebSocket in `analyze` mode (`mic` reply `ok: true`; bands abbreviated here, full in `features.txt`):

```
{"type":"analysis","seq":0,  "rmsDb":-23.0,"peakDb":-20.0,"bands":[-92.6,-100.2,...,-27.3 (band 14),...,-93.3],"pitch":{"hz":690.4,"confidence":0.97},"simulated":true}
{"type":"analysis","seq":1,  "rmsDb":-23.0,"peakDb":-20.0,"bands":[...],"pitch":{"hz":678.5,"confidence":0.99},"simulated":true}
{"type":"analysis","seq":59, "rmsDb":-23.0,"peakDb":-20.0,"bands":[...,-68.5,-27.9,-26.0,...],"pitch":{"hz":277.2,"confidence":0.98},"simulated":true}
{"type":"analysis","seq":119,"rmsDb":-23.0,"peakDb":-20.0,"bands":[...,-26.7,-20.0,-25.4,...],"pitch":{"hz":110.3,"confidence":1.0},"simulated":true}
```

The pitch falls from about 700 Hz at start to 110 Hz after 12 s, as the synthetic sweep should, and the loudest band moves with it.

## 4. Not done / uncertain

- **Front-end changes needed (I may not edit `web/`).** (1) `web/engine/status.js`: the label table has no `analyze` entry, so while analysing with capture on, `microphoneStatus` returns `{active: true, label: 'MIC OFF'}`. Add `analyze: 'ANALYZING'` to the map in the last line, e.g. `({ off: 'MIC OFF', commands: 'VOICE ON', transcribe: 'TRANSCRIBING', analyze: 'ANALYZING' })[mode]`. (2) `web/main.js` `setMic`: in the simulator it starts the browser microphone for every non-off mode; for `analyze` that is unnecessary (the service ignores browser audio and synthesises its own), so use `mode !== "off" && mode !== "analyze" && this.state.simulated`. (3) Handle the new `analysis` event (feed RESONANCE) and `analysis_error` (show `error`) in the bridge/host event switch, and request `analyze` from RESONANCE through `ctx.setMic("analyze")` and leave with `setMic("off")` when it closes (an app that leaves capture on would keep the lamp/status showing it). (4) Optional hung-browser protection: send `{"command":"keepalive"}` quietly (`bridge.command("keepalive", {}, true)`) every 5 s. (5) The `"modes"` list in `state.mic` can drive menus.
- **CPU figure under load**: the 10 % simulator figure is measured on a loaded Pi; I did not get a quiet-machine number.
- **Kiosk Chromium after a crash or power cut** (restore-pages bubble, no relaunch if the browser exits): not touched. It needs launch flags and supervision I cannot test without the kiosk; the brief only asked for the wait and the visible failure.
- **`[::1]` Host check, `WORKLOG.md`**: left alone (unreachable; outside my files). `docs/WORKLOG.md` has no entry for tonight's service changes; the coordinator may want one.
- `catalog.json` settings were not touched.
- Everything is simulator, fake serial, fake `/proc` or scratch-service evidence. Nothing proves anything about the node, USB link, microphone acoustics or the kiosk. A real node was never contacted.
- The pitch figures are accurate to about 1.5 % in tests with synthetic tones; real instruments and voices are untested.
- Per-frame cost is analysed on the default thread pool; if a front end ever wants 20 frames per second the pitch step should run at half rate first.

## 5. Branch

`worktree-agent-af2c22425cca4e5f5`, last commit `aabb1f1` ("Service: analysis and health tests, kiosk waiting page, protocol docs, keepalive and safety nets"), after `9a96fe3`.
