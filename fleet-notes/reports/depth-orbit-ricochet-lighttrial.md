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
