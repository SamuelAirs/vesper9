# Platform polish from the 2026-10-02 review

Branch `claude/platform-polish-2t56t4`, built on the dashboard branch (PR #11). Desktop and
headless-browser work only: **nothing here was checked on the Pi, the node or the real lamps.**

## What changed in the shell

1. **Games get the screen.** In play the chrome folds into a 34 px top row and a 26 px bottom
   row; on 1024 × 600 the 960 × 540 game is shown at its own size (was about 670 × 377).
2. **The canvas draws at the size it is shown.** Backing store = shown size × device pixel
   ratio (at most 2×). RENDER QUALITY: auto (default; steps down 15 % at a time, to 55 %, when a
   game keeps missing frames), sharp, fast (70 %). Apps still draw in 960 × 540.
   Headless Chromium with 12× CPU throttling, the games on main: Perihelion slow frames
   37/147 sharp vs 21/165 fast; Ballista 12/174 vs 2/182. Not a Pi measurement.
3. **The menu gesture's hold is 1.6 s inside a game** (standard pace; +600 ms on every pace).
   Menus and the dashboard keep 1 s. `SETTLE` in game-kit.js is now 2.8 s.
4. **TIMING OFFSET** in Calibration: a tap-along (100 BPM, 4 listen + 16 tap beats, click,
   screen pulse and lamps). Saves `latencyMs` (−150..300, positive = taps register late).
   Read it with `latencyMs(ctx.settings())` from `web/engine/latency.js`.
5. **Two knocks on the case go back** outside a game (menu closes, instrument page steps back
   or leaves, dashboard goes to the previous sector). Built on PR #4's knock events; a lone
   knock, a knock near a press or knocks too far apart do nothing.
6. **Console logbook** (`web/engine/logbook.js`): today's three games, one streak, one feat
   list for the whole console, on the dashboard's TODAY line and the system menu's LOGBOOK.
   New context calls: `ctx.today()`, `ctx.daily(text)`, `ctx.dailyMet()`, `ctx.feat(id, name)`.
7. Smaller: the dashboard's system menu no longer lists RETURN TO DASHBOARD and DASHBOARD
   (it is CLOSE MENU now) and offers CONTINUE / the last app; Calibration's list fits (three
   columns for lists over ten rows); Node Scope's rows are tighter; the toast sits at the top in
   play; `math.js` exports one name per line (the Pages build dropped `OFFSET_STEP`).

## For the game threads: what to cut or move

The rule the review recommends and the shell now supports: **keep only progression that changes
how the game plays.** Daily streaks, feat lists, feat tickers, feat-based ranks and title-screen
"hold for the hub" menus move to the console (or go). Per game:

| Game | Cut or move | Keep |
| --- | --- | --- |
| Perihelion (#1) | Its own daily streak and the feat list in the hangar: send feats with `ctx.feat`; state the daily run's goal with `ctx.daily()` and call `ctx.dailyMet()`. Put the run goal and notices inside the play area. | The daily seeded run as a mode, probes, start region (they change play). |
| Ballista (#6) | Daily streak and feat list (56 feat mentions); trim the 13-row workshop. Separate or cap upgrade-boosted bests. | Modules that change the flight. Press near touchdown must never spend a thruster. |
| Moonrunner (#3) | Daily streak and rank; the depot's longer-clock upgrade (score from grinding). | Zones; make IV–VI demand skill. |
| Orbit Lock, Ricochet, Light Trial (#5) | `goals.js` daily streak, feat ticker and feat ranks: replace with `ctx.feat` / `ctx.daily`. | Extra modes only if they play differently. Orbit: stop narrowing at about 0.14 rad. |
| Undertow (#10) | Daily streak and feat list; move the zone banner off the play lane. | The Trench, eased in. |
| Echo Vault, Glyph Archive (#7) | Contracts, ranks and streaks (16–17 contract mentions each). | Lesson progress: it is the learning. Echo: credit a letter by session accuracy. |
| Tideline (#8) | The daily goal and the 32-entry log as a menu: move the daily to `ctx.daily`. | Gear only if retuned so it does not trivialise catches. |
| Outpost (#8 / new threads) | No daily or feats today; report milestones with `ctx.feat` instead of adding a list. BUY ALL automates the only decision. | Purchases, once they are real choices. |
| Meridian (#9), Relay (#14) | Daily streak and feat list: use `ctx.feat` / `ctx.daily`. | Apply `latencyMs` (agreed key and sign); Meridian adds its fixed 35 ms for the lamp throttle. |
| Descent (on hold) | Nothing. | |

Other per-game items the shell cannot fix: Cadence's footer says TAP NEXT where a tap takes a
lap, and the Stacks shelf says TAP: NEXT PAGE (both are the apps' own `ctx.controls` text);
Field Notes shows a `.venv/bin/pip` command to the player.

## Merge notes

- Four lamps and the board LED follow PR #19's protocol (`state.lamps`, the `leds` event's `lamps`,
  `board_led`). Against the service on main the console stays at three lamps and never sends
  `board_led`. Not yet run against PR #19's service.

- Merge after PR #11 (this branch contains its two commits).
- PR #4 adds the same `rawKnock`, `softwareKnock`, K key, `knockInput` and `case "knock"` as
  this branch; keep this branch's `InputRouter.knock()` (it adds the menu back). Until #4 lands
  no knock events reach the browser, so the back gesture is inert.
- `vesper/catalog.json` gains two settings (`latencyMs`, `renderQuality`); the service accepts
  progress for the reserved id `console`.
- `scripts/build-demo.py` exports only the first name of `export const A = 1, B = 2`. Cadence
  (`BPM_MIN, BPM_MAX`, `TIMER_MIN, TIMER_MAX`) and utilities (`NOTE_ROWS, NOTE_COLS`) still use
  that form; harmless while only their own module reads them.
