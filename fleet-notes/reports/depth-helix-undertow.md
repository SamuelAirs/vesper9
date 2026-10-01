# depth-helix-undertow (Undertow deepened; Helix removed) (cloud thread, branch claude/helix-undertow-ty5z3p)

Nothing here was verified on the device. Everything below comes from unit tests, seeded bots and
simulator screenshots at 1024 x 600.

## Undertow (`web/apps/undertow.js`)
- Pace: first column 0.8 s into a dive (was 1.4 s), columns every 1.6 s falling to 1.15 s (was 2.35 to 1.75),
  current 235 px/s rising to 400 (was 170 to 320). Openings drift from passage 8 (was 10).
- Thrust: against a fall it bites 1.7x, sinking against a climb 1.25x, so the craft answers at once.
  Exhaust flame and bubbles while held; plankton and the floor scroll with the current.
- First dive of a session holds its depth until the first press (or 3 s), like Perihelion.
- Zones: Shallows 0, Kelp Run 8 (pearls, drift), Trench 20 (vertical currents, shown as chevrons),
  Abyss 34 (dark water, sonar ping every 1.6 s, brighter amber lamp), Vent Field 50 (breathing openings),
  the Deep 70 (all). Pilot bot reaches them at about 15, 33, 51, 69 and 92 s.
- Clean passages (a third of the opening clear on both sides) build a streak; every 5 pays 3 pearls.
  Shield bubbles from the Trench take one hit. Hull +1 every 12 passages as before.
- Dock (hold 0.5 s on title or result): DIVE, CRAFT (Skiff; Dart 150 pearls, Bulwark 400), START zone
  (any reached; not scored to the console), DAILY dive (seeded by date, goal, streak), FEATS (14, 2 hidden,
  15 pearls each), LOG.
- Save schema 2; migrates the schema-1 save written by recordRun (runs, last, milestone kept;
  the reached zone is inferred from the best milestone). Switched from GestureGuard to AppGuard.
- Lamps unchanged in meaning (cyan depth spot, amber next opening, red at the edges) plus blue on the side a
  current pushes toward, white spot while shielded, a zone-coloured chase on entering a zone.

## Helix: removed
Sam's playtest (2026-10-01): "Helix is not good, let's ditch it." The two-way rebuild that was on this
branch (commit 2da736b and part of b68e604) is dropped, and Helix is taken out of the console:
`web/apps/helix.js`, `tests/helix.test.mjs`, its catalog entry (with the voice alias "snake") and its place
in the PLAY II sector, its import in `web/apps/registry.js`, and the game lists in
`tests/gesture-apps.test.mjs` and `tests/test_catalog_sectors.py`. Sam's Helix scores and save stay in the
database untouched. To bring the first-release Helix back: `git checkout c741cca -- web/apps/helix.js
tests/helix.test.mjs`, then restore the catalog entry, sector slot, registry import and the two test lists
from that same commit and run `python3 scripts/build-catalog.py`.

## Shared files touched (minimal)
- `vesper/catalog.json` + regenerated `web/apps/catalog.js`: both games' description/controls; Undertow's
  record labels (pearls, zone).
- `tests/engine.test.mjs`, `tests/games-gesture.test.mjs`, `tests/games-tuning.test.mjs`: Undertow now starts a
  dive on the release of a title tap (hold opens the dock), so three tests that started a dive with a bare
  press now tap first; one test that assumed GestureGuard's fixed 2 s recording delay allows AppGuard's
  shorter window for Undertow.

## Verification (cloud container)
- `node --test tests/*.test.mjs`: 839 pass, 1 fail: the Perihelion bot test, which fails identically on main.
- Python 189 OK (1 skipped); catalog --check OK; build-demo OK; browser-smoke, extension-smoke,
  host-browser, voice-host all pass.

## Weakest / unverified
- Feel on the device: thrust strength, the 180 ms left-turn hold, Helix pace at 0.10 s per step.
- Pearl costs (150/400) are a guess from a bot that collects about 60-130 pearls a dive.
- The Deep is hard: the bot dies there on most seeds. Helix TWIN is much easier for the bot than SPIRAL.
- Sound levels (no gain control in ctx.tone).
