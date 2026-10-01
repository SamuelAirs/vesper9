# Writing a VESPER-9 cartridge (for the agents building new apps tonight)

Read `fleet/RULES.md` first, then `docs/ENGINE.md` in your checkout (lifecycle, input
contract, app context). This guide is the part specific to tonight's work.

## What you are given

Your cartridge is already registered. In your checkout you will find:

- `web/apps/<id>.js` — a placeholder class with the right export name. Replace the whole
  file. This file is yours alone.
- An entry for your app in `vesper/catalog.json` (name, subtitle, description,
  controls, category, voice alias, escape policy, capabilities). You may edit **your own
  entry only**; after any edit run `python3 scripts/build-catalog.py` and commit the
  regenerated `web/apps/catalog.js` with it. Useful optional fields:
  - `"icon"`: SVG shapes for the dashboard card, drawn in a 48 × 48 box with
    `stroke="currentColor"` inherited (look at `ICONS` in `web/main.js` for the style:
    thin line drawings, no fills except small dots).
  - `"record"`: display names for the keys of your saved result, e.g.
    `{"metres": "Metres", "catches": "Anchors caught"}`.
  - `"escape"`: `"adaptive"` (four quick clicks open the system menu; long holds are
    yours) or `"hold"` (a three-second hold opens the menu; rapid taps are yours).
    Choose the one that does not collide with how your app is played.
  - `"voice"`: one lower-case everyday English word that the small speech model is
    likely to know; it becomes "computer open <word>".
- `web/apps/registry.js` already imports your class. Do not edit it.

Do not edit any other file under `web/` or `vesper/` unless your brief says so. In
particular not `web/main.js`, `web/style.css`, `web/engine/*`, other apps, or shared
tests. If you need something from the host that does not exist, work without it and
say so in your report.

## Hard technical rules

- One ES module. Only `import { a, b } from "../engine/<file>.js";` named imports
  (the standalone bundler understands nothing else: no default exports, no
  `export { … }` lists, no dynamic import, no top-level await). Export your class with
  `export class Name`.
- No network, no `localStorage`, no timers of your own for game logic. A game's world
  advances only in `update(dt)` with `dt = 1/60`; an instrument refreshes in `tick()`
  (once a second) or on events, and may use `performance.now()`/`Date.now()` for
  display clocks.
- Randomness only through `ctx.rng` (`next()`, `range(a, b)`, `int(a, b)`, `pick(list)`)
  so runs are reproducible in tests.
- Never throw from `update`, `draw`, `down`, `up`, `event`, `tick`. Guard against
  `NaN`, empty lists and division by zero. Keep every list bounded.
- Tolerate `cancel()` at any moment (held input is dropped, sidetone stops) and
  `dispose()` at any moment (lamps off, tones off, nothing left running).
- The system-menu gesture reaches you first: with `"adaptive"`, up to three quick taps
  arrive as ordinary input before the fourth opens the menu and `cancel()` is called.
  Three stray taps must never end a run or destroy progress outright.
- Save with `ctx.score(number)` (higher is better) and `recordRun(ctx, result)` from
  `../engine/kit.js` at the end of a run; instruments keep small state with
  `ctx.saveProgress(object)` (under 8 KiB of JSON).
- Text put into `ctx.content(html)` must be escaped with `escapeHTML` from
  `../engine/math.js` unless it is a literal you wrote.

## The three lamps are part of the design

The device has three RGB lamps in a row (left, middle, right). The owner's complaint is
that existing apps barely use them. In your app they must carry information or
feedback continuously, not flash a fixed colour twice a minute. Use
`web/engine/lightshow.js` (read it; it is short): `LAMP` colours, `lamps(l, m, r)`,
`fill`, `only`, `meter(fraction, rgb)`, `spot(position, rgb)`,
`ramp(t, [stops])`, `pulse`, `blink`, `chase`, `dim`, `blend`, `lightsOff()`.
Call `ctx.leds(values)` as often as you like from `update` (the host sends at most
about 17 changes a second and skips repeats). Rules:

- Lamps off in `dispose()`, and off or dim-idle on title and result screens.
- Keep levels moderate: the lamps are bright in a dark room. Sustained light should
  stay around a third of full; full brightness only for short accents.
- The game must be fully playable with the lamps unplugged and with sound off.

Sound: `ctx.tone(hz, seconds, waveform)` for events (waveforms `sine`, `square`,
`triangle`, `sawtooth`), `ctx.synth.startTone(hz)` / `stopTone()` for a held tone,
`ctx.synth.chime()`. Keep it sparse and in the instrument's quiet, synthesized style.

## Look and feel

An alternate-1979 alien survey instrument: phosphor green and warm amber line art on
near-black, monospace capitals for labels, sparse geometric shapes, no cartoon
characters, no emoji, no photographic or glossy effects. Use the palette `C` and the
helpers in `web/engine/draw.js` (`text`, `line`, `circle`, `diamond`, `space`, `grid`,
`banner`, `glyph`). Draw in the 960 × 540 logical space. On the owner's 1024 × 600
display the game canvas is measured at 0.70 scale (672 × 378 real pixels), so a 14-pixel
label renders under 10 pixels and is hard to read: use 16 logical pixels as the minimum for
any text, 22 or more for anything the player must read during play, line widths 2 or more
for anything the player must track, and keep critical things away from the outer 20 pixels.
The host already shows your app's name, the HUD row and the hint line outside the canvas,
so do not repeat them inside it.

Every game has: a title state (use `banner`), play, and a result state that shows the
score and what to press next; `ctx.hud([[label, value], …])` for two to four live
readouts; `ctx.hint(text)` for the one-line prompt; rising difficulty with something
new to notice at least every 30–45 seconds for the first few minutes; a first 20
seconds that a newcomer survives.

Instruments set `this.navigation = true`, render with `ctx.content(html)` using the
existing panel classes (`utility-panel`, `readout-grid`, `big-readout`, `data-label`,
`recording-tag`; see `web/apps/utilities.js` for how they are used) and offer every
function through `ctx.actions([{ id, label, run }, …])`: tap moves to the next action,
hold-and-release chooses it. Keep action lists short (eight or fewer on a screen; use
sub-menus), put the most used action first, always include a way back to the
dashboard, and do not rebuild the action list on every tick (the host keeps focus only
when labels are unchanged). At 1024 × 600 an instrument has room for roughly a title
plus about 300 pixels of content above its actions, so keep the important readout at
the top.

## Performance budget

Target well under 2 ms for `update` + `draw` together on this Pi. In `draw`: no
gradients or shadows created per frame, no `measureText` in loops, no per-frame array
or closure allocation in hot loops, no more than a few hundred primitives. Reuse
objects; cap particle counts.

## Proving it works (required before you finish)

1. **Unit tests** in `tests/<id>.test.mjs` using `tests/helpers/app-context.mjs`
   (`appContext`, `fakeCanvas`, `run`). At minimum, for a game: a seeded bot that plays
   competently for several simulated minutes and reaches a clearly better score than a
   bot that never presses; a run that ends in a loss; no `NaN` in any numeric state;
   bounded list lengths; `cancel()` and `dispose()` mid-play leave lamps off; three
   quick taps followed by `cancel()` do not end the run; lamp values are always nine
   whole numbers 0–255 and actually change during play. For an instrument: every
   action runs without throwing, state survives a save/restore round trip, and the
   lamps are off after `dispose()`.
2. **The whole suite:** `node --test tests/*.test.mjs`, the Python suite and
   `python3 scripts/build-catalog.py --check`.
3. **In the browser at 1024 × 600** with `scripts/dev-shot.cjs` (read its header):
   screenshots of the title, at least three moments of real play driven by button
   steps, and the result screen, saved under `fleet/work/<agent>/shots/`. Open each
   with the Read tool and look at it critically: is it legible at this size, is
   anything clipped, does it look like part of this console? Fix what you see and
   re-shoot. The run must report "no page or host errors".
4. `python3 scripts/build-demo.py && node tests/browser-smoke.cjs` still passes. (If it
   fails only at the four-click menu step, your checkout predates a test fix: run
   `git checkout 732c584 -- tests/browser-smoke.cjs scripts/dev-shot.cjs` and commit it.)

Commit your app file, your test file and (if changed) your catalog entry with the
regenerated `web/apps/catalog.js`. Nothing else.

## Report

`fleet/reports/<agent>.md` in the format from the rules, plus: how the app plays in
three or four sentences, exactly what each lamp shows, the bot results (numbers), the
screenshot file names, and an honest list of what you think is weakest.
