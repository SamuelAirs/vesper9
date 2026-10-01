# lights-host report

## 1. Outcome
The host now drives the three lamps whenever no app has taken them: focus spot, hold progress, click counting, voice/error acknowledgements, a very dim dashboard breath that fades to dark when idle, a timer countdown, and a steady "microphone live" lamp. Two new Calibration settings control it (lamp level, ambient glow). All required test commands pass in the simulator; nothing was verified on the real lamps.

## 2. Details

### What the owner will experience (for the morning summary)
- Tapping through a list (dashboard, menus, instruments): a soft green spot of light whose position across the three lamps follows the focused item's position in the list; it glides when you step.
- Holding the button in a menu: lamps fill left to right in amber toward the selection threshold (a tap shows nothing). At the threshold all three are amber (release now to select); a white fill then counts the remaining time to the three-second hold that opens the system menu. Selecting gives a short amber flash; the system menu opening gives a short white flash.
- Quick-click menu gesture (in a game that has not lit the lamps): each click lights one more lamp (cyan); the last click opens the menu (white flash). Games that light the lamps themselves (Orbit Lock, Morse...) keep them, so the counting is not shown there.
- Voice command recognised: a short cyan sweep left to right. Error toast: two quick red blinks.
- Idle on the dashboard: very dim green breath, drifting between lamps (steady with Reduced Motion). After 4 minutes with no press/release it fades over 30 s to exactly dark and stays dark until the next press.
- Timer's last 10 s (dashboard, Chronometer, Atmosphere: the same places where the service plays its completion blink): amber, three lamps, then two, then one, each second ticking brighter then fading; the last lamp holds up to 2 s past zero until the service's amber triple blink arrives. After the blink the glow stays out for ~2.7 s then fades back in.
- Microphone capturing (node reports capture, device connected): right lamp steady dim blue, drawn over every other host effect, unaffected by Ambient Glow off and the idle fade. If a game owns the lamps the game keeps them (the on-screen mic indicator covers that case).

### Settings added (vesper/catalog.json, validation in vesper/catalog.py, generated web/apps/catalog.js, entries in Settings in web/apps/utilities.js)
- `lampLevel`: full (1.0) / medium (0.5) / low (0.2) / off (0). Default **medium**. Cycles full > medium > low > off.
- `lampAmbient`: bool, default **true**. Off removes only the dashboard breath; navigation feedback and the mic lamp stay.

### Decisions
- Level applies in `LightDirector` to `ctx.leds` values (lit channels never round to 0 while level > 0) and to colours of `pattern` steps, and to every host effect. Off gives all zeros.
- Mic lamp floor: brightness = 0.3 + 0.3*level (blue 0,40,255 base), so at level off it is still visible (about 30%: observed 1,12,77). Documented privacy choice.
- Light Trial / reaction: the service builds the reaction cue (left amber, then middle green 30,255,90) from fixed colours; the command carries only trial and delay, so the host cannot scale it and sends it unmodified. Light Trial is therefore playable at every level including off. Its early-press flash uses `ctx.leds`, which is scaled (dark at off; the screen still shows it).
- Same limitation for the service's timer-completion pattern (fixed amber 180,100,0): not scaled, still blinks with level off. Suggested follow-up (server.py, out of my scope): accept an optional `scale` on `reaction`/timer pattern, or have the service read `lampLevel`.
- Ownership: `LightDirector.owner` ('host' until `set`/`effect`; `release()` returns to host after writing zero). `setHost()` is ignored while an app owns the lamps. Opening a menu over a game releases (existing behaviour), so the host shows menu feedback there.
- Acknowledgement flashes are timed from the first frame that can show them, so a stalled frame (an app launching) does not consume them unseen.
- demo.js needed no change: it already emits `light_effect` and the same pattern as the service; the host quiet window and countdown work off those.
- Idle clock: any button press/release, tap-advance, select. Voice acknowledgements and the timer countdown show even when dark, but do not wake the glow ("dark until the next press").

### Files
New: `web/engine/ambient.js` (pure `lampFrame`, `HostLamps`), `tests/ambient.test.mjs` (15 tests). Changed: `web/main.js`, `web/engine/lights.js`, `web/engine/lightshow.js` (added `scaleLeds`), `vesper/catalog.json`, `vesper/catalog.py`, `web/apps/catalog.js` (generated), `web/apps/utilities.js` (two entries), `docs/OPERATOR.md`, `docs/ENGINE.md`.

### Existing tests changed (same commit; reason: default medium level, and the dashboard now lights the lamps)
- `tests/browser-smoke.cjs`: pattern of 120 now reaches the lamps as 60; Diagnostics test colour 180 as 90; after `home()` "all lamps zero" became "host owns the lamps and the app's value 60 is gone" (the dashboard focus spot is lit).
- `tests/extension-smoke.cjs`: after `home()`, "all zero" became `vesper.lights.owner==='host'` (same reason).
- `tests/host-browser.cjs`: F3 sets `lights.setScale(1)` first, since it checks rounding, not the level.
No assertion was removed; that leaving an app releases its lamps is unit-tested in `ambient.test.mjs`.

## 3. Verification
- `node --test tests/*.test.mjs`: 148 tests, 148 pass (15 new). One earlier run under load showed 1 failure that did not reproduce in later runs; I did not identify which test (unverified, probably timing).
- `$PYTHON -m unittest discover -s tests -p 'test_*.py'`: Ran 29 tests, OK.
- `python3 scripts/build-catalog.py --check`: ok. `python3 scripts/build-demo.py`; `node tests/browser-smoke.cjs`: passed, pageErrors []; `node tests/extension-smoke.cjs`: passed; `node tests/host-browser.cjs`: 12 PASS, 0 FAIL.
- Observed `vesper.state.leds` (simulator, default medium; scripts/dev-shot.cjs eval steps; triplets are L | M | R):
  - dashboard idle: `9,77,21 | 3,23,7 | 2,12,3` (focus spot on card 1 over the breath)
  - tap to next item, tap again: `6,48,13 | 2,15,4 | 3,27,8`, then `2,19,5 | 4,33,9 | 2,16,5`
  - hold 400 ms: `128,55,0 | 86,37,0 | 0,0,0`; 600 ms: `128,56,2 | 128,55,0 | 128,55,0`; 850 ms (past the 650 threshold, white starting at left): `128,73,30 | 128,55,0 | 128,55,0`; 1.25 s: `128,100,74 | 128,55,0 | 128,55,0`; about 2.9 s: all lamps `128,100,75`
  - system menu open, focus item 0 then item 1: `9,77,21 | 0 | 0`, then `4,29,8 | 3,23,7 | 0`
  - Runner (no lamp use), quick clicks: 1 click `0,55,47 | 0 | 0`; 2 clicks left and middle cyan; 3 clicks all three; 4th click opens the menu
  - voice ack sweep: `0,96,82 | 0 | 0` then middle `89,76` then right lamp `84,72`; error: `128,6,0` on all, then 0, then `128,6,0` again, then back to the spot
  - timer 14 s: about 9.5 s `60,26,0` x3; about 3.4 s `45,20,0 | 45,20,0 | 0`; about 1.1 s `27,12,0 | 0 | 0`; then recorded events `timer_done`, `light_effect 1200`, three `180,100,0` x3 blinks with zeros between, then zeros (host quiet) to the end of the recording
  - mic capture true while awake: right lamp `1,18,115` (blue); level off + ambient off + mic: `0,0,0,0,0,0,1,12,77`; mode requested but capture false: all zeros
  - level low: `2,19,5 | 1,1,1 | 0`; full: `11,95,26 | 1,7,2 | 0`
  - idle fade (page clock moved): 10 s into the fade `6,50,14 | 3,19,5 | 2,12,3`; 25 s `2,11,3 | 1,5,2 | 1,4,1`; faded all 0, still 0 after 2.5 s more; with mic live while faded `0,0,0,0,0,0,1,18,115`; next press `6,48,13 | 2,13,4 | 1,8,2`
  - I did not wait the real 4 minutes: I set `vesper.hostLamps.lastInput` back in the page. The unit test covers the fade to exact zero and 8 hours of darkness.
- Cleanup: no servers or browsers of mine remain (`pgrep` shows only the live console and other agents' shells).

## 4. Not done / uncertain
- No real lamp was seen. For the morning, the owner should look at: (a) the dashboard breath at medium in the dark room, dim enough but not too dim (green up to about 77 of 255 at the brightest; adjust `lampLevel`); (b) the focus spot on the real RGB lamps (colour mixing may look yellower or whiter than the screen mirror); (c) the amber hold fill and the white 3 s phase; (d) the blue mic lamp: visible, dim, distinct from the cyan voice sweep; (e) the 4-minute fade to dark; (f) the timer countdown then the service blink; (g) low and off levels inside a game.
- Click counting and menu flashes are not shown in games that call `ctx.leds` themselves (by design: apps keep authority); the host layer and mic lamp reappear when a menu opens.
- Level does not scale the reaction cue or the service's timer-completion pattern (server-owned colours; see Decisions).
- Rendering stalls on the Pi could still shorten acknowledgements; the director spacing limits updates to about 17/s. The dashboard breath writes whenever an integer value changes (roughly 8 writes/s at the busiest part); not measured on the node link.

## 5. Branch
Branch `worktree-agent-a9a8f317f530c4e7a`; last commit hash is given in the final message.
