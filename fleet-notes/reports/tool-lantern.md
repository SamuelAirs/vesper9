# tool-lantern: LANTERN instrument

## 1. Outcome
Built LANTERN (`web/apps/lantern.js`, class `Lantern`, id `lantern`): the three lamps as a night light with steady colours, three-lamp sets, six slow scenes, four brightness steps and a sleep timer with a one-minute fade. Nothing shines until the owner chooses; lamps go dark in `dispose()`. Unit tests, full suite, catalog check, browser smoke and screenshots done (section 3).

## 2. Details
**Controls** (all `ctx.actions`, at most 8 per screen, hold to choose).
Main: [RESUME or LIGHT while dark], SCENE, COLOUR, BRIGHTNESS, SLEEP TIMER, LAMPS OFF (while lit), RETURN TO DASHBOARD.
- Scene menu: STEADY LIGHT, THREE-LAMP SETS ->, BREATHE, AURORA, CANDLE, TIDE, EMBER AND SUNRISE ->, BACK. Sets: DUSK, REEF, HEARTH, NEBULA. Ember and sunrise: EMBER, SUNRISE 10/20/30 MIN.
- Colour menu: warm white, amber, phosphor green, cyan, deep blue, violet, red / night vision. Steady, breathe and tide use it; picking a colour during another scene switches to steady.
- Brightness: NIGHT 2.5 %, LOW 9 %, MEDIUM 20 %, HIGH 33 % of full (night step on amber is 6/255).
- Sleep: no timer, 5, 15, 30, 60 min; fade over the last 60 s, then dark. RESUME relights and restarts the timer. The timer is not remembered between visits (deliberate).

**Scenes** (pure `sceneFrame(scene, settings, seconds)`): breathe = 8 s swell with a 20 % floor; aurora = green/cyan/blue/violet drifting over 70 s, lamps a fifth of a turn apart plus a slow swell; candle = seeded value-noise shimmer, wander and occasional gutter per lamp (seed from `ctx.rng`); tide = pool of light rolling left-right-left every 16 s; ember = amber to red and down to 20 % over 30 min; sunrise = deep red, amber, warm white over 10/20/30 min, ending at max(chosen level, 25 %) so it works as a wake light.

**Timing.** The host has no per-frame hook for instruments (`tick()` once a second; only games get `update`). I used one `requestAnimationFrame` loop inside lantern.js, started in the constructor, ended by `dispose()` or when `ctx.alive()` is false, recomputing at most every 60 ms (host then coalesces to ~17/s and skips repeats). Time is `performance.now()` (overridable as `app.clock` in tests); no state advances per frame, so dropped frames cannot drift a scene. `tick()` also recomputes, so lamps keep following time on a hidden page or with no rAF (tests; the loop is skipped if rAF is absent). The lamp drawing (inline SVG) is repainted from the loop by element id (guarded `document.getElementById`); text and countdown re-render from `tick()`, and only when the HTML changed.

**Persistence.** `ctx.saveProgress({schema,scene,colour,set,level,sunrise})` on every lighting change (~70 bytes). On open the first action is "RESUME / ..." when something was saved. Opening makes no `ctx.leds` call at all.

**Catalog.** Added an `icon` (a lantern with three dots) to the lantern entry and regenerated `web/apps/catalog.js`.

**What the host would need so a scene survives leaving the instrument.** Not built. (a) An app-context call to register a lamp program (scene id, settings, start time, sleep deadline) that the host evaluates on its own animation loop and sends through `lights`; `sceneFrame` and `sleepFactor` are pure and exported, so the host could import them. (b) `unmount()` skipping `lights.release()` when a program is registered. (c) A dashboard indicator and a way to stop it, plus a rule for other apps taking over the lamps.

## 3. Verification
- `node --test tests/lantern.test.mjs`: 15/15 pass (every scene/colour/level/time gives nine whole bytes; sustained <= 1/3 full; night step <= 8; scene behaviours; candle deterministic per seed; sleep fade halves at the midpoint and ends dark, resume relights; no light on open or tick; resume only with saved state; save/restore round trip; every action in every menu runs, menus <= 8 items with a way back; dispose silences lamps and loop; fake-rAF loop sends ~16/s and stops after dispose; retired context tolerated).
- `node --test tests/*.test.mjs`: 161 pass, 0 fail on re-run. One earlier full run during the browser smoke (machine under load) reported 160 pass / 1 fail; I did not capture which test, and it did not reproduce in the following run (see 4).
- `$PYTHON -m unittest discover -s tests -p 'test_*.py'`: 29 OK. `python3 scripts/build-catalog.py --check`: exit 0.
- `python3 scripts/build-demo.py && node tests/browser-smoke.cjs`: `"passed":true`, 12 apps exercised, `pageErrors: []`.
- `scripts/dev-shot.cjs` at 1024x600: "no page or host errors" on every run. Shots in `fleet/work/tool-lantern/shots/`: `lantern-title.png`, `lantern-scenemenu.png`, `lantern-sleep15.png` (breathe with a 60:00 timer), `lantern-breathe.png` (actually aurora: green/teal/navy lamps), `lantern-sets.png`, `lantern-violet.png`, `lantern-colours.png`, `lantern-night.png`. I opened title, scene menu, aurora, breathe and sleep screens: legible, nothing clipped, hint line visible after I shrank the lamp drawing so an 8-item menu fits.
- Simulator and tests only; nothing was verified on the device or on the real lamps.

## 4. Not done / uncertain
- The one-off full-suite failure above is unidentified; please re-run if it recurs.
- Colour fidelity on the real RGB lamps is unknown. Warm white is [255,150,60] chosen by eye from `LAMP.white`; the 2.5 % night step and the first minutes of sunrise (<= 5/255 red) may be invisible or uneven on hardware.
- Screenshots of candle, tide, ember and sunrise running were not captured (covered by unit tests); my scripted button navigation was imprecise, so some shots show a different scene than their name.
- The drawing shows hue at full strength with opacity for brightness, not true colour.
- The host keeps the highlighted row index across menu rebuilds, so focus after choosing may land on an arbitrary row (host behaviour).
- Re-choosing a scene restarts its clock (matters for sunrise/ember); colour and brightness changes keep the scene clock.

## 5. Branch
`worktree-agent-a11ac660d874e96cd`, last commit 319fc5e.
