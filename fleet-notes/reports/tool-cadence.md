# tool-cadence: CADENCE

## 1. Outcome
Built CADENCE (`web/apps/cadence.js`): metronome with tap tempo, stopwatch with laps, and work/rest intervals, all driven by the three lamps. 21 new tests, 269 JS tests, 29 Python tests, catalog check, browser smoke and extension smoke pass. Nothing was verified on the device.

## 2. Details
**Input finding (the one-button problem).** `main.js` `inputMode()` reads `app.navigation` dynamically (so toggling it would switch to raw `down`/`up`), but that is undocumented, would hide the instrument stage, and in raw mode the adaptive "four quick clicks" escape would swallow tap-tempo taps. I did not use it. A legitimate channel exists: `Vesper.event()` forwards every host event, including `{type:"button", pressed, source, at_us}`, to `app.event()` in every mode, after navigation has handled it. CADENCE uses those edges. A press shorter than `holdMs` is a tap, stamped at the press time (node `at_us` where present); a longer one is a menu choice and is not counted. The action list keeps one focused item (DONE on the tap screen, STOP while the stopwatch runs), so a short press's "advance" is a no-op and a hold chooses it. Edges are ignored while the system menu is open, and a release with no matching press is ignored (the release of the hold that chose an action arrives after `run()`).
Host additions that would still help: a way for an instrument to suppress the 210 Hz "advance" tick on short presses (it sounds alongside the click during tap tempo), and documentation that `event()` receives button edges.

**Metronome.** 40 to 220 BPM: FASTER +5 / SLOWER -5 / FINE +1 / FINE -1, TAP TEMPO (mean of the last five taps; a gap over 2 s restarts; presses under 200 ms apart ignored; works while running), signatures 2, 3, 4, 6. Accent click 1760 Hz, others 1175 Hz (`ctx.tone`, square, 35 ms). Beat n is due at `t0 + (n - n0) * period` by multiplication; a tempo change re-anchors at the last sounded beat so phase is kept. A beat counts as due up to half a frame early. A beat more than 150 ms late (hidden page) is skipped, not clicked.
Lamps: one lamp per beat, a decaying flash on a base level; green normally, amber and brighter on the accent. Patterns: 2 = L R; 3 = L M R; 4 = L M R M; 6 = L M R L M R with beat 4 a softer amber. Sustained level at most a third of full.

**Stopwatch.** Hundredths display, last 5 laps shown with split and total, best marked in amber, up to 200 kept. Running: tap = lap (stamped at the press), hold = stop (stamped at the press, not the release). Stopped: RESUME, RESET, BACK. Lamps: dim green spot sweeping once per 2 s; amber flash on all three on a lap; dim amber middle lamp when stopped with a time.

**Intervals.** Presets FOCUS 25/5 x4, TABATA 20/10 x8, MINUTE 60/30 x6, and CUSTOM (work 10 s to 30 min, rest 5 s to 10 min, rounds 1 to 20; each item steps to its next value when chosen). No rest after the last round. Pause/resume and stop. Lamps: a bar draining right lamp first (left lamp last), green work, cyan rest, blinking amber in the last min(5, max(2, 25%)) seconds, a flash at each change, a green pulse for 8 s at the end. Tones: work start 660 then 990 Hz, rest start 990 then 660, countdown beeps at 3, 2, 1 for periods over 6 s, end 660/880/1320. Screen: WORK/REST at 92 px, mm:ss at 72 px.

**Pause (system menu open).** Metronome keeps clicking and the interval keeps its time and tones (the work period must not silently stall); the stopwatch keeps counting (computed from the clock). All three stop writing lamps while the menu is open so the menu keeps them, and take them back on resume. `dispose()` stops everything, saves, and turns lamps off.

**Navigation shape.** Tool list (last-used tool first), then per-tool lists of 8 or fewer. While a tool runs there is deliberately no "back to dashboard": stop first, or use the system menu (3 s hold). Saved with `saveProgress`: bpm, signature, last preset, custom values, last tool.

## 3. Verification
- `node --test tests/cadence.test.mjs`: 21 pass. `node --test tests/*.test.mjs`: 269 pass, 0 fail. `$PYTHON -m unittest discover -s tests -p 'test_*.py'`: 29 OK. `python3 scripts/build-catalog.py --check`: ok.
- Drift test (fake clock, 500 beats at 120 BPM, irregular frames of 5 to 45 ms): all 500 beats sounded in order, none skipped or doubled; due-time error against `start + n*500` is 0 ms (asserted under 0.001). Click lateness against due time ranged -8.0 to +36.8 ms. That is the real resolution: `ctx.tone` cannot be scheduled ahead, so a click lands on a frame.
- Browser (1024 x 600, `scripts/dev-shot.cjs`): "no page or host errors" on every run. Real raw edges reached tap tempo (taps roughly 600 ms apart gave 91 BPM) and laps (3 in the stopwatch shot). Shots in `fleet/work/tool-cadence/shots/`: cadence-menu, -metro, -metro-run, -tap, -stopwatch, -stopwatch-stopped, -intervals, -work, -work-amber, -rest, -done. I opened menu, metro-run, tap, stopwatch, intervals and work-amber. Not opened: metro, stopwatch-stopped, rest, done. I fixed misaligned lap columns after the first stopwatch shot.
- `build-demo.py` then `browser-smoke.cjs`: passed (12 apps). `extension-smoke.cjs`: passed.

## 4. Not done / uncertain
- Audio and lamp output go through a browser and a USB link; there is constant latency I cannot measure here. Click and lamp may not line up with each other or with the owner's hand.
- Click lateness is up to a frame (about 17 ms at 60 fps) and more on a slow frame. Not measured on the Pi.
- Lamp colours, brightness, and whether the third-level amber reads from across a room are unchecked on the real lamps; shots show only the on-screen lamp dots.
- Tap tempo: finishing needs a deliberate hold; a hold under 650 ms counts as a tap.
- The host's "advance" tick sounds alongside clicks during tap tempo.
- The dashboard icon (metronome with sound arcs) was never looked at.
- `pgrep` shows the live console process (not mine); none of mine remain.

## 5. Branch
`worktree-agent-acb02ee9d10a5e57a`, commit `4895de5`. Files: `web/apps/cadence.js`, `tests/cadence.test.mjs`, `vesper/catalog.json`, `web/apps/catalog.js`.
