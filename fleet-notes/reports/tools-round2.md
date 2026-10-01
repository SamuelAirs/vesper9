# tools-round2: Cadence timer, Lantern, Field Notes, Atmosphere offset

## 1. Outcome

All four complaints are addressed in code, tests and screenshots; everything is committed on one branch, one commit per instrument. Cadence has a TIMER tool (a front end for the service's persistent timers) that makes "a timer of N minutes is running" 1 to 9 presses for the lengths people use; Lantern lights on the first hold and previews scenes and colours on highlight; Field Notes is a fixed-row view that follows the dictation and reads by whole pages; Atmosphere has a case temperature offset (half-degree steps) applied to every derived value. The status bar and the voice answer to "temperature" need a two-line edit in files I do not own (section 3, exact diffs). All suites pass in the simulator; nothing was verified on the device or the real lamps.

## 2. Details

### 2.1 Cadence TIMER (`web/apps/cadence.js`, `web/style.css`, `docs/OPERATOR.md`)

Design: the service's timers (`timer` command, `timers` in state) are the only engine; Cadence reads `ctx.state().timers`, works out the time left from its own clock between the service's per-second reports, and sends `create`, `toggle` and `remove`. TIMER is the fourth tool (METRONOME, STOPWATCH, INTERVALS keep their places).

Start list (no timer running), in this order: `START <last length> / LAST` (5 min the first time, remembered in progress as `lastTimer`), `DIAL / TAP ADDS MINUTES`, `START 5 MIN`, `START 10 MIN`, `START 15 MIN`, `START 25 MIN`, `MORE LENGTHS` (30, 45, 20 min, 1 h, 3 min, 1 min, 30 s), `BACK`. Eight rows. The dial is two single-action screens: tens (each tap adds 10 min, hold to go on) then minutes (each tap adds 1 min, hold to start; at 00 the action reads BACK). Taps are counted from the raw button edges, exactly as tap tempo does. Labels are never asked for; the timer is named after its length ("12 MIN"). One line on every timer screen: `VOICE: SAY "COMPUTER TIMER TWELVE MINUTES" AT ANY TIME`.

Running view: the chosen or nearest timer large (84 px) with label, state, progress bar; the next two below it. Actions: `PAUSE`/`RESUME`, `ADD 1 MIN`, `CANCEL TIMER`, `NEW TIMER`, `NEXT TIMER` (when more than one), `BACK`. The highlight stays on the row used (so ADD 1 MIN twice is two holds). A finished timer reads DONE with `DISMISS` and `RESTART`. When the kind of screen changes under the hand (a timer started by voice, one finishing, the last one removed) the highlight goes to the first row (one-item list published first, as elsewhere).

ADD 1 MIN: the service has no add operation (ops are create, toggle, reset, remove). A replacement timer for (time left + 60 s) with the same label is created, paused again if the old one was paused, and the old one removed once the new one is seen; if the create is refused (eight timers) nothing is lost. The id changes and for an instant both exist. Suggested follow-up (server.py, not mine): an `add` op.

Lamps while the tool is open (the app owns them then, so the host's countdown is not shown; I show the same one): a bar draining from the right across the three lamps for the nearest running timer (`timerLamps` from `utilities.js`: green to amber, the host's amber 3-2-1 in the last ten seconds), three amber blinks when one finishes (the service plays its own blink only when the dashboard, Chronometer or Atmosphere is focused, `server.py` `tick_once`), then one dim amber lamp until dismissed, one dim lamp when paused, nothing (the lamps stay with the host) when no timer exists. Dial: a dim cyan bar of the minutes so far, a touch brighter on each tap. No frame loop for the timer (the host's `tick()` is enough); only the tap and finish flashes wake one. Browser check: with a 5 min timer the real lamp values were `[5,38,11,5,38,11,5,37,11]` (medium level).

Menu gesture (`cancel()`): taps that changed something (a lap, a tempo, a dial minute) are recorded with an undo; `cancel()` takes back up to three of them when each is within 1 s of the next and the last ends where the cancelled press began. Tests: two laps taken by quick taps and a hold are removed and the stopwatch keeps running; an old lap (5 s earlier) is kept; three tap-tempo taps restore the previous tempo; two dial taps are subtracted; a gesture repeated three times on a running timer sends no command and changes no timer. A timer is only ever started, paused, added to or removed by choosing an action, which a gesture never does.

Press counts (taps plus holds, measured by `tests/timer-tool.test.mjs` with a stand-in for the host's highlight rules and the service, asserted exactly):

| Task, from the timer tool open with the first row highlighted | New TIMER | Old Chronometer |
| --- | --- | --- |
| same length as last time | 1 | no equivalent (7 for 5 min by CHANGE DURATION twice, tapping round to CREATE) |
| 5 minutes | 3 (1 if 5 min was the last length) | 20 by the wizard; 7 by the quick path |
| 10 / 15 / 25 minutes | 4 / 5 / 6 | 20 by the wizard (each) |
| 12 minutes | 7 (DIAL: tap, hold; tens: tap, hold; minutes: 2 taps, hold) | 20 |
| 45 minutes | 9 (MORE LENGTHS then 45) or 13 on the dial | 20 |
| 3 minutes | 7 on the dial | 20 |

Opening the tool: from the dashboard one hold launches Cadence, then one hold if TIMER was the last tool used (up to 3 taps and a hold otherwise, once). The old wizard numbers are higher than my first estimate (13 for 12 minutes) because the host keeps the highlight on the same row number after each digit, so the next digit list starts wherever the last choice was; the test drives the real `Timers` class through the same highlight rules. Voice ("computer timer twelve minutes") is 0 presses.

Choices that cost something: 5 minutes is 3 presses, not 2, because DIAL sits second (the custom case is more expensive than the extra tap on four presets). The dial caps at 99 minutes (hours are in MORE LENGTHS; voice reaches two hours), wraps after nine, and has no "minus": an overshoot is fixed by wrapping or by starting and cancelling.

Tests: `tests/timer-tool.test.mjs` (25) against a fake service (create, pause, resume, add time, cancel, completion with blink and DONE/RESTART/DISMISS, restart with timers restored from the store, slow service, refused create at eight timers, several timers and NEXT TIMER, a timer started by voice while the tool is open, last length persisted, dial, every action on every screen), plus the press counts, the gesture tests and the lamp checks. Existing `tests/cadence.test.mjs` changed in the same commit only to include TIMER in the tool list (list text, the tap count from INTERVALS to METRONOME, the tool loop).

### 2.2 Lantern (`web/apps/lantern.js`)

What was tricky (walked with the button): the first hold lit the lamps but then every change was a trip into a list chosen blind (scene list 8 rows, brightness list, sleep list), the highlight in lists started on the first row so choosing something near the current value took many taps, and nothing showed on the lamps until the choice was made.

Now: the first hold lights the last scene (or a warm steady light at LOW the first time). The main list is short and fixed: `SCENE`, `DIMMER`, `BRIGHTER`, `SLEEP IN 30 MIN`, `LAMPS OFF`, `COLOUR`, `SLEEP TIMER`, `RETURN TO DASHBOARD` (while dark `LIGHT` or `RESUME` leads and LAMPS OFF is absent; the highlight lands on SCENE after turning on). DIMMER and BRIGHTER step the level at once and stay under the finger. SLEEP IN 30 MIN lights dark lamps and starts the timer, then reads CANCEL SLEEP TIMER; the SLEEP TIMER list keeps 5, 15, 30, 60 and NO TIMER. SCENE and COLOUR open lists that preview: a tap moves the highlight and the lamps show the highlighted choice at once (moving scenes move in the preview too; the page says PREVIEW / HOLD TO KEEP), a hold keeps it, leaving with BACK, a system menu, or dispose never keeps a preview and the lamps go back (or dark). The scene list is STEADY, CANDLE, BREATHE, AURORA, TIDE, SETS ->, EMBER AND SUNRISE ->, BACK; sets and ember/sunrise also preview. Every scene, colour, set, timer length and level is still reachable (brightness through DIMMER/BRIGHTER instead of a list).

How preview works: the host does not tell apps where its highlight is, but forwards the raw button edges after it has acted on them. Lantern counts short releases (as Cadence does), keeps its own `cursor` for the highlight, sets it from the rule the host uses whenever it publishes a list and corrects it whenever an action runs. A hold always runs the action the host really had selected, so a desync can only mis-preview, never mis-commit. Tests assert `app.cursor == host highlight` through the main list, scene list, sets and the card-index launch cases. Taps after a cancelled hold are not counted (the release has no recorded press). Taps while the system menu is open are ignored.

Press counts (same method; the previous menu structure measured by running the file as committed before my change through the same harness; start state: warm steady medium saved, lamps just lit):

| Task | Before | After |
| --- | --- | --- |
| turn on a warm light (fresh install) | 1 | 1 |
| switch to candle | 6 | 3 (hold SCENE, tap, hold) |
| make it dimmer (one step) | 5 | 2 (tap, hold) |
| sleep in 30 minutes | 8 | 4 (3 taps, hold) |
| lamps off | 5 | 5 |
| warm steady light back from a saved candle | 2 | 2 |
| cyan (colour list) | 6 | 10 |

Colour got worse (COLOUR is deliberately low in the list: scene, level and sleep are what a lamp is used for, and the colour is remembered), but it is now previewed live.

Tests: `tests/lantern.test.mjs` (29) keeps the pure scene tests untouched and restructures the flow tests (the old `BRIGHTNESS` list steps became DIMMER/BRIGHTER, the old highlight test was rewritten for the new lists with the shared hand), and adds preview (lamps change per tap, nothing saved by looking, restore on back, dark stays dark, moving scenes animate in preview and the loop ends), cursor equals host highlight, the gesture (nothing chosen or saved), stray edges.

### 2.3 Field Notes (`Transcription` in `web/apps/utilities.js`, `web/style.css`)

Two-pass behaviour is unchanged: the `event()` handling of provisional, refined, empty and plain finals, the `done`/`provisional` bookkeeping, and `load()` are as before; `tests/transcription.test.mjs` passes with one assertion changed (it matched `hello wurld\nand a partial` in one pre-wrapped block; every line is now its own row, so it checks order and adds that the provisional row is marked `~` in `fn-prov` and the live partial `>` in `fn-live`).

Presentation at 1024 x 600: the note is NOTE_ROWS = 5 rows of 24 px monospace, 58 columns plus a 2-character gutter, in a view of fixed height (6.5 em) with no scrolling. Dictating: the view always shows the last five rows, newest last, older rows leaving at the top (faded edge), a long utterance shows its end; saved lines phosphor green, Vosk's finished line amber with `~`, the live partial dim italic with `>` and a blinking caret (marks as well as colour). Recording indicator: `REC` with a pulsing dot (steady with Reduced Motion) while capturing, `WAIT` while the microphone starts or the link is lost, `IDLE` when off, plus the status label and the unchanged `RECOGNISER / ...` line. Reading: whole pages of five rows with `PAGE n / N`, first action `NEXT TEXT PAGE` (one hold per page, wraps; past the last page of the session being dictated it returns to the live view), `PREVIOUS TEXT PAGE`, start/stop, `EXPORT SELECTED NOTE`, `SAVED NOTES`. Stopping opens the note on its last page. While dictating the list is `STOP TRANSCRIPTION`, `PREVIOUS TEXT PAGE`, `SAVED NOTES`, `RETURN TO DASHBOARD`; paging back is not dragged away by new text. `SAVED NOTES` is its own screen: five `READ` rows, `OLDER/NEWER NOTES`, `BACK TO THE NOTE`; choosing a note returns to its first page. `REFRESH SAVED NOTES` is gone (the list reloads whenever it opens); export is kept. Long sessions: rows of the saved lines are cached per load (200 partial updates on 20,000 lines in under 400 ms in the test).

`tests/browser-smoke.cjs` gained one step (click `SAVED NOTES` before `OLDER NOTES`): the list moved to its own screen; everything else it checks (older notes, select, next page, export) is unchanged.

Tests: `tests/fieldnotes.test.mjs` (13): wrapping, the view never grows and always ends with the newest line over 40 lines, long partial, kinds told apart, indicator states, action lists, paging row for row, one hold per page, paging back and returning to live, stop opens the last page, the notes list and export, escaping, large session.

### 2.4 Atmosphere case offset (`web/engine/math.js`, `vesper/catalog.json`, `vesper/catalog.py`, `web/apps/catalog.js`, `Environment` and `Diagnostics`)

Setting `tempOffset`: Celsius, added to the sensor temperature, steps of 0.5, -10 to +5, default 0; stored with the other settings (catalog settings block only; validated in `catalog.py`: finite number, in range, multiple of 0.5, bool refused; regenerated `catalog.js`). Atmosphere gets `CASE OFFSET COOLER / <new offset>`, `CASE OFFSET WARMER / <new offset>` and (when set) `CASE OFFSET / CLEAR`; the reading, extremes and charts change as the service broadcasts the setting. It is shown on the temperature panel (`CASE -4.5 °F`) and in the status line ("CASE OFFSET ... APPLIED TO TEMPERATURE (HISTORY STORED RAW)"). `math.js` is the one place: `tempOffset(settings)`, `correctTemp`, `correctReading`, `formatSensorTemp`, `formatOffset`, `clampOffset`. Applied in Atmosphere (reading, dew point, feels like, absolute humidity, today low/high, the temperature chart; trend arrows are unchanged because a constant cancels) and Node Scope's sensor row. History and the stored rows stay raw (asserted). `formatTemp` itself stays raw on purpose: Telemetry's CPU temperature uses it and must not be offset. Telemetry's node page shows no sensor temperature (only the Pi's CPU temperature), so there was nothing to correct there.

Humidity (what correcting temperature alone does and does not fix): warm air holds more vapour, so a sensor warmed by its case reads a lower relative humidity than the room. Subtracting the offset fixes the displayed temperature and the values derived from it, but not the RH reading. Worked example (26.0 C and 40 % RH measured, offset -3 C): shown 23.0 C and 40 %; dew point from the corrected temperature and measured RH 8.7 C, absolute humidity 8.2 g/m3. If the case merely warmed the room's air by 3 C, the room's real dew point is the one from the raw pair (11.4 C), real absolute humidity 9.7 g/m3 and real RH about 47.9 %. So, as the brief asked (derived values from the corrected temperature), dew point, absolute humidity and the comfort band read low by about that much, and the comfort band looks drier than the room. The physically stricter alternative (re-reference RH to the corrected temperature, keeping dew point invariant) is a few lines in `math.js`; I did not do it because the brief did not ask for an RH change and it assumes the case only heats air that is in the room (unverified). Feels-like uses the corrected temperature with the measured RH.

### 2.5 Retiring Chronometer from the dashboard (not done by me, ready)

`Timers` (factory `Timers`, id `timers`) still works and is registered (`registry.js` untouched; tests still cover it). To drop it from the dashboard the catalog owner has to: (a) remove or hide the `timers` entry in `vesper/catalog.json` `apps` (and take its slot out of `sectors`); the browser-smoke test (`vesper.launch("timers")` in the timer step) and other tests that open `timers` then need the id kept or the step moved to `cadence`; keeping the entry registered but hidden from the dashboard (e.g. a flag that `main.js` skips when building the grid) avoids touching them; (b) move the voice alias `"timer"` from the `timers` entry's `voice` list to `cadence`'s (today `voice: ["metronome"]`) and regenerate with `scripts/build-catalog.py`; (c) the alias must land on the timer tool: Cadence now has `openTool(id)` (`app.openTool("timer")`; ids `metro`, `stop`, `int`, `timer`), so the host should call `this.app.openTool?.(tool)` right after `launch` for an alias that names a tool (a change in `main.js`/`voice.js`, not mine; without it "computer open timer" opens Cadence on the tool used last); (d) `server.py` `tick_once` plays the completion blink only for focus `home`, `timers`, `environment`: Cadence blinks on its own, but if the node-timed blink is wanted while Cadence is open add `cadence` there; (e) `docs/OPERATOR.md` voice table row (`open ... timer ...` says CHRONOMETER) and `ambient.js` comments mention Chronometer. Cadence's catalog description ("A metronome with tap tempo, a stopwatch with laps, and work/rest intervals shown on the lamps.") should gain "and a timer"; that is an app entry, so I left it.

## 3. Edits needed in files I do not own (not made)

Status bar, `web/main.js`: line 5 `import { Random, escapeHTML as esc, formatTime, formatTemp, tempUnit } from "./engine/math.js";` becomes `... formatTime, formatSensorTemp, tempUnit ...` (formatTemp is used only there), and in `status()` (about line 914) `? formatTemp(s.sensor.temperature, unit)` becomes `? formatSensorTemp(s.sensor.temperature, unit, 1, s.settings)`. (Without the fourth argument the helper reads `window.vesper.state.settings`, so `formatSensorTemp(s.sensor.temperature, unit)` also works.)

Voice answer, `web/engine/voice.js`: line 4 import `formatTemp` becomes `formatSensorTemp, correctTemp`; line 121 `reply("TEMPERATURE / " + formatTemp(sensor.temperature, unit) + old, stale ? null : temperatureLamps(sensor.temperature))` becomes `reply("TEMPERATURE / " + formatSensorTemp(sensor.temperature, unit, 1, c.settings) + old, stale ? null : temperatureLamps(correctTemp(sensor.temperature, c.settings)))`. (`c.settings` is the settings object there: line 108 reads `c.settings?.tempUnit`.) I checked in the real simulator: after `tempOffset` was set, Atmosphere showed the corrected value and the status bar still showed the raw `72.8 °F`, so these two edits are what is left; a voice test would need the same.

For whoever owns the `Settings` class: `tempOffset` is accepted by the service and `reset_settings` returns it to 0, but Calibration has no row for it (by design: it is adjusted from Atmosphere).

## 4. Verification

- `node --test tests/*.test.mjs`: 595 tests, 595 pass (541 in this checkout before my changes; 54 new).
- `/home/sam/VESPER-9-v0.2.0-Claude/vesper9/.venv/bin/python -m unittest discover -s tests -p 'test_*.py'`: Ran 177 tests, OK (includes a new `tempOffset` validation check in `tests/test_runtime.py`).
- `python3 scripts/build-catalog.py --check`: exit 0.
- `python3 scripts/build-demo.py && node tests/browser-smoke.cjs`: `{"passed":true,"appsExercised":26,...,"pageErrors":[]}`; `node tests/extension-smoke.cjs`: `"passed":true`; `node tests/host-browser.cjs`: 12 PASS, 0 FAIL; `node tests/voice-host.cjs`: ALL 37 PASSED.
- Screenshots at 1024 x 600 (all opened and looked at; `scripts/dev-shot.cjs` reported "no page or host errors" every time), in `/home/sam/VESPER-9-v0.2.0-Claude/fleet/work/tools-round2/shots/`: `cadence-t0-tools`, `t1-start`, `t2-running`, `t3-added`, `t4-new`, `t5-dial-tens`, `t6-dial-units`; `lantern-l0-dark`, `l1-lit`, `l2-scenes`, `l3-preview-candle`, `l4-preview-aurora`, `l5-kept`, `l6-dimmer`, `l7-sleep30`; `transcribe-n0-empty`, `n1-read-page1`, `n2-read-page2`, `n3-notes-list`, `n4-live`; `environment-a0-raw`, `a1-offset`; `diagnostics-d1-nodescope`. Things I fixed after looking: Atmosphere's "CORRECTED" label wrapped the temperature heading (now a small "CASE -4.5 °F" beside the value), its hint ran to two lines, the notes list had a tall empty panel and its hint was hidden under the deck.
- The Field Notes screenshots use text injected into the app object through `eval` (`vesper.app.lines` etc.): the simulator has no dictation, so these are layout proofs, not a real dictation run.
- Heat: the Pi read 60.9 to 72.5 C during the runs; I ran one heavy thing at a time. `pgrep` shows nothing of mine left (only the live console and unrelated shells).
- Existing tests changed (reason in the same commit): `tests/instruments.test.mjs` (Atmosphere action ids now include the offset rows), `tests/cadence.test.mjs` (tool list has TIMER), `tests/transcription.test.mjs` (one assertion: order instead of adjacent text), `tests/browser-smoke.cjs` (one extra click), `tests/lantern.test.mjs` (flow tests for the new lists; pure scene tests untouched). No assertion was removed without a replacement covering the same behaviour.

## 5. Not done / uncertain

- Nothing here ran on the device, with the real lamps, or on the owner's real dictation. Real-lamp brightness of the dial, the timer bar and the previews is unverified (dim by construction: sustained at or under a third of full; tested).
- Lantern's preview depends on the host forwarding raw button edges after acting on them and on its highlight rule (`setNav`); both hold in the real host code I read and in the simulator, but a host change to either would degrade previews (never commits).
- Field Notes assumes 24 px DejaVu Sans Mono at 58 columns fits the panel (it does here at 1024 x 600); with a wider fallback font the rows are clipped, not wrapped. Five rows is the most that fits above the three action rows at 1024 x 600; the live view has two actions fewer and could take one more row.
- First open of Cadence on a new installation still lands on METRONOME (changing the default would alter existing tests' starting point); TIMER is remembered after first use.
- `ADD 1 MIN` is create-then-remove (see 2.1).
- The offset's RH consequence (2.4) is a documented limitation, not a fix.
- The service's node-timed completion blink is not played when Cadence is focused; Cadence blinks the lamps itself.

## 6. Branch

`worktree-agent-a28598539fb8a1e2a`, last commit `74d0ce6`. Commits: `035752a` Atmosphere offset, `f4c7525` Cadence TIMER, `ddb10d3` Lantern, `4b484e8` Field Notes, `74d0ce6` Atmosphere display tweak.
