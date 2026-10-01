# review-tools: second look at the six instruments

## 1. Outcome
I used LANTERN, ORACLE, CADENCE, EPHEMERIS, RESONANCE and TELEMETRY with one button in the simulator at 1024 x 600, looked at about 45 screenshots (under `fleet/work/review-tools/shots/`), and fixed what I found. The most serious fault was shared by all six and invisible to the author tests: opened from the dashboard, each instrument started with the highlight on the row numbered like its dashboard card. RESONANCE opened on RETURN TO DASHBOARD, so a hold straight after opening left it. Everything is committed (one commit per instrument; CADENCE and LANTERN share one, see section 5). Nothing here was verified on the device or the real lamps.

## 2. Details

### Cross-cutting findings
1. **Entry highlight (breaks).** `web/main.js` `setNav` keeps the highlight on the action with the same id, otherwise on the same row number. The dashboard's items have no ids, so the first action list opens on row = card index (0-5). Reproduced in the browser: opening RESONANCE from the dashboard gave `3: START LISTENING | NEXT PAGE | CLEAR PEAK AND HISTORY | [RETURN TO DASHBOARD]`; TELEMETRY opened on REFRESH NOW; ORACLE on RETURN TO DASHBOARD. The authors' browser runs missed it because `--app` launches from an unbuilt dashboard (index 0). Fix in each instrument: publish a one-item list with the wanted first action, then the real list, which pins the highlight (ORACLE already did this after config changes, not on entry). Tests simulate the host rule for cards 0-7.
2. **Highlight after a choice (wrong).** The same rule left the highlight on an arbitrary row after a menu change: LANTERN, choosing VIOLET (row 5 of the colour list) landed on RETURN TO DASHBOARD (reproduced); CADENCE STOPWATCH opened on BACK (reproduced); EPHEMERIS, choosing the last preset, landed on RETURN TO DASHBOARD. Fix: the action that should be highlighted next takes over the id of the one just chosen. Rule used: a submenu opens on its first row, a choice returns to the row that opened the submenu (its label now shows the new value), RESET/STOP/DONE return to START.
3. **Lamps taken from the host while idle and during the system menu (rough).** Several instruments kept calling `ctx.leds` through the system menu, taking the lamps back from the menu's feedback, and CADENCE wrote all-dark on its first tick, which silences the host's focus and hold feedback. All six now yield while paused; CADENCE leaves the lamps to the host until a tool lights them (LANTERN, ORACLE, RESONANCE already did).
4. **Frame loops (rough).** LANTERN, CADENCE and TELEMETRY ran `requestAnimationFrame` forever, even dark or idle. Each now runs only while there is something to animate and ends by itself, on `dispose()` or when `ctx.alive()` is false. ORACLE and RESONANCE were already right. Tests count queued frames.

### LANTERN
Verdict as the owner: a good night light once lit; the colour submenu used to drop me on RETURN TO DASHBOARD, which would have thrown me out. Lamps stay dark until I choose, go dark on exit and when the timer ends.
- Taps to the most common task (light it and set a 30-minute timer): hold LIGHT, then SLEEP TIMER 3 taps, both before and after (list unchanged); what changed is where the highlight lands after each choice (COLOUR, BRIGHTNESS, SLEEP TIMER rows instead of an arbitrary row).
- Fixed: submenu focus; loop only while a moving scene is lit (a steady colour costs nothing between ticks); lamps yielded to the system menu, scene clock and timer carry on while paused. 4 new tests.
- Checked in the browser: candle `[23,13,3,21,11,3,17,7,2]`, tide (cyan sweep, drawing repaints), ember `[23,10,0 ...]`, sunrise at NIGHT `[3,0,0]`; "no page or host errors". Sustained light stays at or under a third of full. NIGHT is 2.5 % and the first minutes of a night-level sunrise are 3/255, maybe invisible on hardware.
- Host note: while LANTERN is dark the host's own focus lamps show (`[9,77,21,...]`, owner host); that is the host, not LANTERN lighting.

### ORACLE
Verdict: quick and fun; ROLL is under the highlight after any change.
- Taps: roll again 0 (hold), before and after; opening used to highlight RETURN TO DASHBOARD.
- Found (wrong): the host's generator is xorshift32 seeded with `Date.now()`. Over 60000 launches one millisecond apart the first D6 gave chi-square 403 (faces 8876/10506/10922/10921/9560/9215 against 10000). Fix: discard eight draws on opening (chi-square 0.0). New test over 8000 consecutive-millisecond launches: chi-square 2894 without the discard, passes with it. Results are still decided by `ctx.rng` at the press; the author's chi-square suite (coin, every die, number, pick, yes/no 5:5:2) passes. One existing test that predicted the first draws now accounts for the eight discarded.
- Looked at and fine: dashboard icon, title, coin tumbling and result, yes/no result, d6 pips, pick-one-of-5 dots, history. Holding "show result now" is pointless against a 1.04 s roll; harmless. Minor, unchanged: under DICE the footer says "BEFORE / COIN / TAILS" (history spans modes).

### CADENCE
Verdict: a real metronome, no drift, usable one-handed; opening STOPWATCH used to highlight BACK.
- Taps: stopwatch START before 2 (landed on BACK), after 1 (0 if last used); intervals START before 2 (landed on CUSTOM SETUP), after 1 (0 if last used); metronome START 0 both.
- Changed on purpose: the tool list reordered itself by recency; rows that move cannot be learned. It is now fixed (METRONOME, STOPWATCH, INTERVALS, RETURN) and the highlight starts on the last used tool. The author's assertion "last-used tool is first" was changed in the same commit.
- Also fixed: DONE in custom setup and stopping an interval used to land on BACK or PRESET (now START); RESET lands on START; a paused interval darkened the lamps (now one dim amber lamp); loop and lamp ownership.
- No way back while a tool runs: **acceptable**. In a navigation instrument quick taps never open the menu (`input.js`, mode "menu"); a three-second hold always does ("MENU: HOLD 3s" is on every screen) and DASHBOARD is a row there; STOP then BACK also works. I added "Hold three seconds for the system menu" to the hints of the running metronome, tap tempo and intervals (the stopwatch had it). Rows are not added while running because a one-row list is what lets a tap mean LAP.
- Drift in the browser: 31 clicks at 120 BPM over 15 s, `ctx.tone` timestamps minus the first-click grid: 0 to +9.2 ms, no accumulation (headless, muted).
- The stopwatch counts through the system menu: 00:02.69 before, 00:10.19 after about 7 s in it; the lamps were the host's while it was open.
- Looked at: tool list, metronome stopped and running, tap tempo, stopwatch ready, running and stopped, intervals ready, work, rest, done, dashboard icon. Legible, nothing clipped.

### EPHEMERIS
Verdict: handsome and correct; entering a location with 12-row digit lists was a chore and the preset was 12 minutes off for me.
- Independent check, 2026-10-01 (api.sunrise-sunset.org and USNO moon phases, fetched today): at 39.1 N 94.6 W the source gives sunrise 12:13:22 UTC, sunset 00:02:33, solar noon 18:07:58; EPHEMERIS gives 12:14:32, 00:00:49, 18:07:59 (within 2 minutes; noon to the second; the sources model the horizon a little differently). USNO: last quarter 3 Oct 13:25 UT, new moon 10 Oct 15:50 UT, full moon 26 Oct 04:12 UT; EPHEMERIS: new 15:50:09, full 04:11:59, today 72 % lit and waning gibbous. Screen at 39 N 95 W: sunrise 07:16, sunset 19:02 CDT; September equinox 22 Sep 19:06 CDT (USNO 23 Sep 00:05 UT); Saturn all night (opposition 4 Oct).
- Fixed: the first preset was 39 N 98 W, now US CENTRAL 39 N 95 W (3 degrees of longitude is 12 minutes of sun time). The chooser had digit lists of 12 rows; it is now two steppers (NEXT first, then +1, -1, +10, -10, CANCEL: 6 to 7 rows, signed so no N/S toggle). Choosing a preset or saving lands on NEXT PAGE; BACK returns to the row that opened the list; opens on NEXT PAGE from any card; lamps yield to the menu. 2 new tests, 2 rewritten (wizard) and the preset assertions updated.
- Taps: next page 0; first-time US central: 2 taps and 2 holds (preset list, first row). A custom place is 5 to 15 short holds against 12-row digit lists before.
- Looked at: now (arc and sun marker), moon (drawing correct for waning gibbous, lit limb left), orrery, year curve, presets, chooser. Southern hemisphere moon and polar pages: unit-tested only.

### RESONANCE
Verdict: clear and honest about the microphone; opening it on RETURN TO DASHBOARD was a trap.
- Mic checks in the browser (`vesper.state.mic.mode`): after open `off`; after START LISTENING `analyze`, `device.capture true`; after RETURN TO DASHBOARD `off`; after the system menu's DASHBOARD `off`; menu MICROPHONE OFF `off` with the screen showing MUTED. Inside the standalone bundle (`VESPER-9-Simulator.html` driven in Chromium): open `off`, listening `analyze`, after DASHBOARD `off`, no page errors. Not testable here: leaving while another mode was started elsewhere, since this checkout has no speech model; the author's unit tests cover it and pass.
- Fixed: entry highlight; lamps yielded while the menu is open; text raised (axis, notes, status detail 12 to 14 px logical); spectrum bars now leave room so a loud bar no longer covers the "MIDDLE LAMP" label (seen in the screenshot). 2 new tests.
- Looked at: level, spectrum, tuner (simulator). At -49.8 cents the tuner needle covers the "-50" label; cosmetic.

### TELEMETRY
Verdict: a calm health page; opening highlighted REFRESH NOW, and the overview pushed the hint line under the footer.
- Fixed: entry highlight; the four direct "PAGE / x" rows (redundant with NEXT PAGE, two screen rows) replaced with PREVIOUS PAGE, so four rows, every page at most two steps away, hint visible on every page; loop only while a lamp pulses or blinks; lamps yielded to the menu. The author's action-list test was updated for the new rows.
- Thresholds suit a Pi 5 at 50-60 C normal: amber from 70 C, red from 80 C (where it limits itself); the simulator showed 154 F for this Pi. No hysteresis: a reading hovering at 70 C flickers green and amber. Null, failing request and recovery paths: 23 author tests still pass; I did not break the service in the browser.
- Looked at: overview, node, history, about.

## 3. Verification (from the worktree)
- `node --test tests/*.test.mjs`: 462 tests, 462 pass, 0 fail.
- `$PYTHON -m unittest discover -s tests -p 'test_*.py'`: OK.
- `python3 scripts/build-catalog.py --check`: exit 0 (no catalog entry needed a change).
- `python3 scripts/build-demo.py && node tests/browser-smoke.cjs`: `"passed":true`, `pageErrors: []`. `node tests/extension-smoke.cjs`: `"passed":true`.
- CPU temperature stayed 59 to 69 C, one heavy run at a time. `pgrep` shows only the live console's `vesper.server` (not mine). `VESPER-9-Simulator.html` is untracked and ignored.

## 4. Not done / uncertain
- Hardware: lamp brightness and colour, click latency and drift on the real node, speech-model paths of RESONANCE, the host tick tone alongside CADENCE clicks.
- RESONANCE's level and spectrum scales were set from the synthetic signal; check with a real voice.
- Southern-hemisphere moon and polar EPHEMERIS pages not looked at in the browser.
- TELEMETRY has no hysteresis; ORACLE's history footer mixes modes.
- No test was deleted. Existing assertions changed with their reasons above: CADENCE list order, ORACLE first draws, TELEMETRY action rows, EPHEMERIS chooser and preset coordinates.

## 5. Branch
`worktree-agent-a7fcc4bdbfe40d1ce`, last commit `ffbe9cc`. Commits: `3afff67` LANTERN, `5615aa2` CADENCE and LANTERN (entry highlight), `d0b5c0c` ORACLE, `a5f0938` EPHEMERIS, `310503e` RESONANCE (plus a CADENCE RESET fix), `ffbe9cc` TELEMETRY.

## Host changes I recommend, most valuable first
1. **Reset the highlight when an app opens** (`web/main.js` `launch`): set `this.nav = { items: [], index: 0 }` before the app builds its first list. Today every instrument opens on the row numbered like its dashboard card unless it works around it (these six now do; other apps using `ctx.actions` still have the fault).
2. **A focus argument for `ctx.actions`** (`{ focus: id }`) so apps need not borrow ids to place the highlight after a menu change.
3. **Tick tone for CADENCE.** `advance()` in `web/main.js` plays `this.synth.tone(210, 0.025, "triangle")` on every short press, which sounds with tap-tempo and lap presses and with the metronome clicks. Needed: an optional app method checked before the tone, for example `if (!this.app?.quietAdvance?.()) this.synth.tone(...)`, or a context call `ctx.silentTicks(true)` that `launch`/`unmount` reset. CADENCE would return true on the tap-tempo screen and while the stopwatch runs (and could on a running metronome). The tone itself is unchanged.
4. **Seed the host generator better**: `new Random()` uses `Date.now()` with xorshift32, whose first outputs for nearby seeds are alike (chi-square 403 over 60000 consecutive-ms launches). Discarding a few draws in the `Random` constructor fixes it for every app; ORACLE now protects itself.
5. **Lamp program that survives leaving an instrument** (LANTERN's request), and `ctx.releaseLamps()` so an idle instrument can hand the lamps back to the host feedback (ORACLE and CADENCE stay app-owned and dark once used).
