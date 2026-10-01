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

## Undertow second pass: life, refits, field guide, visuals (after Sam's "keep deepening" note)
- Sea life: 12 species, two per zone (Silver Shoal, Moon Jelly; Kelp Darter, Spotted Ray; Ribbon Eel, Blue
  Shoal; Lantern Fish, Ghost Jelly; Vent Eel, Ember Shoal; Black Angler, Devil Ray). One arrives every
  2.2-4.4 s, unlogged species more often. Flying within 70 px for 0.45 s logs it (amber ring fills) and
  banks 10 pearls; fish and schools shy away from the craft. Purely a side goal: creatures never hit.
  Their generator is separate from the column generator, so the daily dive and the bots are unchanged.
- Refits at the dock (REFIT row): Pearl Magnet (2 levels, 120/260: collect radius 22 -> 34 -> 46 px),
  Hull Plating (300: +1 starting hull), Long Sonar (180: ping every 1.1 s, columns lit longer),
  Wide Scanner (90: log from 110 px in 0.3 s). The daily dive ignores refits.
- Field guide (GUIDE row): zones down the side, both species with drawings once logged. Feats 16 now:
  NATURALIST (6 species) and FIELD GUIDE (all 12).
- Depth gauge in metres (top right), deepest dive kept in the save and shown on title, result and log.
  Entering a zone shows its name large in a band for about 3 s instead of the small note.
- Visuals per zone: light rays in the Shallows, swaying kelp in the Kelp Run, far walls and a far ceiling in
  the Trench, blinking violet plankton and a headlight cone in the Abyss, vent chimneys with smoke in the
  Vent Field, falling red snow in the Deep; a far ridge everywhere. Columns now have a lit edge, a shaded
  side, lip caps and the zone's growth (barnacles, kelp, strata, crystals, glowing cracks). The craft has
  fins, a cockpit window and a blinking stern light. The result card suggests the next thing to buy.
- Save schema 3 (adds `up`, `sp`, `dm`); schema 1 and schema 2 saves migrate, with tests.

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
- After the second pass: `node --test tests/*.test.mjs` 803 pass, 1 fail (the same Perihelion bot test);
  Python OK; catalog --check OK; build-demo OK; browser-smoke, extension-smoke, host-browser, voice-host pass.
- Before the Helix removal: `node --test tests/*.test.mjs`: 839 pass, 1 fail: the Perihelion bot test, which fails identically on main.
- Python 189 OK (1 skipped); catalog --check OK; build-demo OK; browser-smoke, extension-smoke,
  host-browser, voice-host all pass.

## Weakest / unverified
- Feel on the device: thrust strength; whether chasing creatures for the guide pulls the craft into
  columns too often; draw cost of the new scenery on the Pi 5 (bounded: 6 creatures, about 13 kelp fronds,
  4 vents, 70 plankton, but not measured there).
- Refit prices (90-300) are guesses, as are the craft prices.
- Pearl costs (150/400) are a guess from a bot that collects about 60-130 pearls a dive.
- The Deep is hard: the bot dies there on most seeds. Helix TWIN is much easier for the bot than SPIRAL.
- Sound levels (no gain control in ctx.tone).
