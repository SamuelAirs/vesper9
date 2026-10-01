# audit-screens: 1024 x 600 screen-fit review

## 1. Outcome

I checked 42 screens or states at 1024 x 600 and re-shot every one after the fix. 37 had a problem before: 14 instrument states pushed below the fold, 3 menus clipped, and 20 game screens whose canvas was only about 300 px tall. The other 5 were fine. All of it was fixed in `web/style.css` only. Two items need JS or HTML changes (section 3). The work is committed on the branch below, and the unit tests, demo build and browser smoke pass.

## 2. Details

### Screens checked

Shots are under `/home/sam/VESPER-9-v0.2.0-Claude/fleet/work/audit-screens/shots/`: `before/`, `after/`, and `hd/` (1280 x 720 samples). File names are `<app>-<name>.png` and are the same in each folder. The dashboard files are named `dashboard-dash1`, `dashboard-dash2` and `dashboard-sysmenu-dash`.

| Screen | Before | After | Files |
|---|---|---|---|
| Dashboard sector 1 and 2 | OK (coordinator's block) | OK, about 20 px spare | dashboard-dash1, dashboard-dash2 |
| System menu from dashboard | OK | OK | dashboard-sysmenu-dash |
| Orbit Lock title, play, game over | Canvas about 300 px tall, title and HUD on separate rows | Canvas 378 px tall, title and HUD on one row | orbit-title, orbit-play, orbit-over |
| Moonrunner, Undertow, Echo Vault, Light Trial, Glyph Archive: title and play | Same as Orbit Lock | Fixed | runner-*, drift-*, echo-*, reaction-*, glyphs-* |
| Game over / result: Moonrunner, Glyph Archive, Echo Vault, Light Trial | Same canvas problem | OK | runner-over, glyphs-over, echo-over, reaction-result |
| System menu inside a game (4 quick clicks), also with Field Record | Clipped: arcade switch and hold bar cut off | Fits whole | orbit-sysmenu-game, orbit-sysmenu-after-run |
| System menu in Signal School (9 items) | Clipped: last item and the switch off screen | Fits exactly | morse-sysmenu, morse-sysmenu-end |
| Microphone menu | OK but loose | OK | orbit-micmenu |
| How to play / help | OK | OK, slightly tighter | orbit-help |
| Signal School guided, listen, review | Canvas about 300 px | Canvas 378 px | morse-guided, morse-listen, morse-review |
| Chronometer idle and running | Title and description took about 140 px, second button row cut at the fold | Everything above the fold | timers-title, timers-running |
| Chronometer custom wizard (digits, labels) | Only the first button row visible | Whole wizard visible (10 buttons) | timers-wizard-digits, timers-wizard-labels |
| Field Notes empty and with 6 saved notes | Panel pushed down, 3 transcript lines visible | Panel plus first buttons visible, transcript 17 px | transcribe-title, transcribe-notes, transcribe-notes-end |
| Atmosphere, empty and with charts | Tiles at the fold | Tiles, panel, buttons visible. Charts need a scroll, see section 3 | environment-title, environment-chart, environment-chart-end |
| Node Scope | Table cut off | Whole table and first button row visible | diagnostics-title, diagnostics-end |
| Calibration, top and scrolled to last actions | 2 button rows visible | 6 button rows visible, all 13 actions reachable | settings-title, settings-end |

Focus visibility with the button: I stepped through every item on every long list (system menus, Chronometer, wizard, Field Notes, Atmosphere, Node Scope, Calibration) with `vesper.advance()`. I compared the focused element's rectangle with its scroll container's. It was fully visible at every step, before and after (`before-log.txt` and `after-log.txt` in `audit-screens/`). The existing `scrollIntoView({block:"nearest"})` in `main.js` already does this.

### CSS changes (`web/style.css`)

Three blocks appended under `@media (min-width: 900px) and (max-height: 640px)`. Nothing outside that query changed.

- **Instrument headers.** Category label and title share one line, the Pause/Menu button is smaller, and the description is hidden because each panel repeats its purpose. This saves about 90 px.
- **Instrument panels.** I tightened padding, line-height, button height (48 px to 34 px), timer rows, diagnostic rows and big readouts. Body text stays at 12 px or more. The transcript went from 21 px to 17 px.
- **Game screens.** The title and the HUD share one grid row, and the category eyebrow is hidden while playing. The HUD wraps instead of clipping if it grows.
- **Control deck.** I hid the decorative "INPUT / 01" caption and the "SINGLE-SWITCH INTERFACE" eyebrow. The button and the three instruction lines stay. This saves about 20 px on every screen.
- **System, mic and help menus.** I compacted padding, the heading (32 px to 24 px) and the choices (46 px to 36 px).

Text under about 11 CSS px in the DOM is only the 8 to 9 px decorative eyebrows and HUD labels. All body, button and menu text is 11 px or more. The remaining small text is drawn inside game canvases (section 3).

## 3. Needs JS or HTML changes (not done)

1. **Canvas text is too small (rough).** Games draw a 960 x 540 canvas that is letterboxed to about 672 x 378 px, a scale of 0.70. Text drawn at 12 px or less in canvas coordinates renders at 8 px or less, for example "PERIHELION ARRAY", "YOUR SIGNAL", "DOT 120 ms / DASH 360 ms", "SIX SYMBOLS...". Fix: draw canvas text at 16 px or more in `web/apps/games.js` and `web/apps/morse.js`, and in `web/engine/draw.js` if the text helper sets a minimum size.
2. **Atmosphere charts need a scroll (rough).** The two 170 px SVG charts are stacked inside one panel (`Environment.render` in `web/apps/utilities.js`). At this height they cannot be seen together with the buttons. Fix: wrap the two charts in a container with a class so CSS can put them side by side. Do not shrink the chart height below about 150 px, or the axis labels fall under 11 px.
3. **Orbit Lock HUD at game over (rough, small).** When hull reaches 0 the value is empty, so the HULL label rides high (`after/orbit-over.png`). Show a dash or `0`.
4. **Existing, not caused by this work.** At 1280 x 720 the dashboard line "SECTOR 01 / PLAY" touches the hero's bottom rule (`shots/hd/dashboard-dash1.png`). It was already like that, and 720 is outside this brief.

## 4. Verification

- I re-shot all screens with a script that wraps `scripts/dev-shot.cjs` and opened every PNG listed above. The before, after and 1280 x 720 runs all logged no page or host errors.
- `node --test tests/*.test.mjs`: 33 pass, 0 fail.
- `python3 scripts/build-demo.py`, then `node tests/browser-smoke.cjs`: `{"passed":true,"appsExercised":12, ... "full console fits 720p", ... "responsive layout", "standalone bundle"], "pageErrors":[]}`.
- 1280 x 720 spot check (`--size 1280x720`, same screen list): no errors. The screens I opened (dashboard, Orbit Lock, Chronometer) look unchanged. The new rules only apply at heights of 640 px or less.
- Cleanup: nothing of mine is still running. `pgrep` shows the live console and another agent's `vesper-audit-*` simulator, neither of which is mine.

## 5. Not done / uncertain

- All shots come from the headless Chromium simulator. Nothing was checked on the real display.
- Moonrunner, Glyph Archive and Echo Vault game-over states were forced with `app.phase='over'`, so some text fields are blank. The layout is representative but the wording is not.
- Field Notes was seeded through `eval:` and the Atmosphere history was faked. I did not check real mic or sensor data.
- In games the Pause/Menu button now sits between the title and the HUD. That is a layout choice, and it is easy to move to the far right.

## Guidance for authors of new apps (1024 x 600)

- A game canvas gets about 940 x 378 px of screen. Because of the 16:9 aspect ratio the picture is about 672 x 378, a scale of 0.70 from the 960 x 540 drawing space.
- Keep canvas text at 16 px or more in drawing coordinates so it renders at 11 px or more. Keep the key action in the central 60% of the width.
- An instrument panel has about 400 px of visible height under the one-line title. That is room for one panel of 8 to 9 lines plus 3 rows of 34 px buttons.
- Anything longer scrolls inside `main`. Button focus follows with `scrollIntoView`, so long action lists are safe, but put the most important readout first.
- The description is hidden at this height, so do not put essential information in it. Put it in the panel or the `app-readout` hint line.
- A HUD of up to about 650 px (four label and value pairs) shares the title row. A longer HUD wraps and takes height from the canvas.

## Branch

`worktree-agent-a0a2d45b15db744c6`, commit `6c8cf37` (only `web/style.css`).
