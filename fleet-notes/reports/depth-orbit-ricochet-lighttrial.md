# depth-orbit-ricochet-lighttrial (cloud thread, 2026-10-01)

Branch `claude/orbit-ricochet-lighttrial-b7eggj`. Simulator and headless browser only: nothing here was verified on the device.

## Outcome
Light-touch depth for the three games Sam called fun but simple. Each keeps its core and gains a
reason to come back: feats, a daily order (same for everyone on a date) with a streak, a rank from
feats, and one new mechanic where it paid off most. Saves move to schema 2 with migration tests.
Shared pieces live in a new `web/apps/goals.js` (only these three games import it).

## Details
- Orbit Lock (`orbit.js`): perfect zone at the gate's centre (inner 30 %, at most 0.07 rad); four
  perfect locks in a row charge a shield that takes one mistimed press (not idle decay). From lock
  30 every third gate is dark: nothing on screen, only lamp I (amber ramp, white at the centre).
  15 feats (2 hidden), 4 daily-order kinds, 7 ranks. Score is still locks. The run's save is written
  through a `GestureGuard` subclass, so the gesture window rule is unchanged.
- Ricochet (`ricochet.js`): charge cells from chamber 4 (mirrored pairs on plain cells) break their
  eight neighbours; a charge can set off another; red lamp burst over the blast. 17 feats (2 hidden),
  5 daily-order kinds, 7 ranks. The chamber banner no longer overlaps BALL LOST.
- Light Trial (`reaction.js`): trials come in series of five on one clock, judged by the median; the
  best series sets a rank (NOVICE to QUICKSILVER). 10 feats (1 hidden); keyboard timing earns no
  timing feats. The day's goal is to finish a series (streak, today's best). A finished series runs
  its grade colour across the lamps. The host still writes no light while a trial is armed.
- Saves: schema 2 for all three, keeping `runs`, `last` (same keys, so the field record still reads)
  and `milestone`. Leaving mid-run keeps a daily order or feat earned on the way; the menu gesture's
  pause saves nothing.

## Verification (this branch, cloud container)
- `node --test tests/*.test.mjs`: 848 pass, 1 fail. The failure is Perihelion's planning-bot test
  (seed 3003 falls before arriving); it fails the same way on `main` before these changes.
- Python 189 OK (1 skipped), catalog check OK, demo built, browser-smoke, extension-smoke,
  host-browser, voice-host all pass.
- New tests: `tests/orbit.test.mjs` (13), `tests/reaction.test.mjs` (10), 7 more in `tests/ricochet.test.mjs`.
- Orbit bot with 50 ms timing error: 34 to 42 locks, at most 2 shield saves a run.
- Screenshots of title, play and result for each game looked at.

## Not done / uncertain
- Feel on the device: perfect-zone size, how hard dark gates are with only lamp I, charge-cell noise.
- Catalog descriptions do not mention feats/daily (catalog is shared; left alone).
- `docs/WORKLOG.md` not updated (shared file).

## Round 2 (after Sam: "life and depth", better visuals)
- Orbit Lock: RUSH (60 s, no hull, a miss costs 3 s, +4 s per sector) at 3 feats and ECLIPSE (every
  gate dark) at 6 feats. Hold on the title or result to change mode, but only once a mode is earned:
  until then a press still starts at once, so existing behaviour and tests are unchanged. Each mode keeps
  its own best; only standard sets the console's best score. 17 feats. Redrawn dial: banded planet with
  a moonlet, sector-tinted ticks, glowing gate, satellite with panels and trail, sparks and rings on locks,
  shake on a miss, a side panel with chain pips toward the shield and the rush clock.
- Ricochet: two upgrades offered after each chamber from the second (wider/quicker paddle, spare ball,
  steady chain, charged serve, heavy signal, salvage). Tap switches, hold takes, lamp I or III shows
  the highlighted card, auto-take after 8 s. 18 feats. Chamber colour themes, lit cell edges, ball and
  paddle glow, corner brackets, depth bands, shake on a lost ball or a blast.
- Light Trial: training log of the last 20 series (bars on the title, taking turns with the feats),
  discs that breathe while armed (screen only), green halo on the cue, grade colour after a result,
  and "TO BEAT" while armed.
- Verification: JS 856 pass, 1 fail (the same Perihelion bot test as on main); Python OK; catalog
  check, demo build and all four browser suites pass. Screenshots looked at for each new screen.

## Round 3 (fixes from the honest platform review)
- Orbit Lock: the gate never narrows below 0.14 rad (was 0.08). Past 45 locks the speed grows slowly
  and past 50 every other gate is dark, so a 30 ms player's run still ends. Rush opens at a best of 20
  locks and Eclipse at 25 dark gates in all, instead of after 3 and 6 feats, so one long run cannot
  open both. Feats moved to match (FAR SIDE 35, EVENT HORIZON 50, 8 dark gates). The result panel is
  at most four lines and ends above the hint line.
- Ricochet: 3 rows of cells up to chamber 4, 4 up to chamber 8, then 5, so chambers end sooner.
  A hold that pauses the game puts the paddle back on the direction it had before the press.
- Light Trial: a press more than 1.5 s after the cue says TOO SLOW and is not scored, saved or added
  to the series; the node trial is cancelled. With no press it times out by itself. The discs are
  hidden on the title so the banner no longer covers them, and the legacy-record line is gone.
- Left to the "Polish the platform from the review" thread: latency calibration, screen space, the
  menu gesture.
- Verification: JS 863 pass, 1 fail (the same Perihelion bot test as on main); Python OK; catalog
  check, demo build and all four browser suites pass. Screenshots of the Orbit result panel, a
  Ricochet chamber and the Light Trial title looked at. Not verified on the device.

## Round 4 (the console logbook, PR #16)
- Per the cut list in /mnt/project-files/platform-polish/platform-polish.md: each game's own daily
  streak, feat ticker and feat-based rank are gone. Feats go to the logbook with `ctx.feat` (Orbit at
  the recorded end of a run, through its GestureGuard; Ricochet and Light Trial at once, held by
  AppGuard during a possible menu gesture). On the days the logbook picks one of these games, it
  states its own order with `ctx.daily` and calls `ctx.dailyMet` when met; other days there is no order.
- Kept: Orbit's Rush and Eclipse (skill-opened, they play differently), Ricochet's per-run upgrades,
  Light Trial's rank from the best series median (a skill rating, not a feat count) and its log.
- Saves move to schema 3 and drop `dl`, `st.daily` and the daily/streak feat ids, with tests that
  load schema 1 and schema 2 saves. `tests/helpers/logbook-stub.mjs` stands in for the host's calls.
- Without #16 the games still run (every logbook call is optional), but no order or feat is shown
  anywhere, so PR #5 should merge after #16.
- Verification: on this branch JS 862 pass, 1 fail (Perihelion bot, as on main), Python OK, catalog
  check, demo build and all four browser suites pass. Merged with #16 in a scratch tree: JS 880 pass,
  same 1 fail; the three titles screenshotted with no page errors. Not verified on the device.
