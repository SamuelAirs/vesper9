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
  Clean Assay (300: every fifth clean passage pays 5, not 3), Sea Lure (180: sea life twice as often,
  new species first), Wide Scanner (90: log from 110 px in 0.3 s). The daily dive ignores refits.
- After the 2026-10-02 platform review: refits no longer help survival (Hull Plating and Long Sonar were
  replaced by the assay and the lure, in the same save slots), so the best passage count is skill, not
  grinding. Trench currents ease in: none on its first two columns, then a third of columns at 120 px/s^2
  rising to most at 260 by its end (the Deep stays at half the columns, 320). The zone banner moved from a
  dark band across the middle to the top edge. The menu gesture firing mid-dive is left to the platform
  thread.
- Console logbook (PR #16, so this PR needs #16 merged first): Undertow no longer keeps its own daily
  streak or feat list. The FEATS dock row and view are gone; each feat still banks 15 pearls once
  but is sent with `ctx.feat(id, name)` (the host lists and announces it). The ON THE DAY feat is
  dropped (the logbook covers it). The daily dive stays as a seeded mode: starting it states its goal
  with `ctx.daily("Daily dive: ...")`, and meeting it calls `ctx.dailyMet()` once a day. The save drops
  `dl.streak` and `dl.last`. These calls go through AppGuard (held during a possible menu gesture) and
  are optional, so the game still runs on a host without them. Undertow's own tests pass on #16's branch;
  `vesper/catalog.json` and `web/apps/catalog.js` conflict with it and need the catalog owner's merge.
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

## Undertow third pass (Sam's 2026-10-03 playtest: "good but pretty easy"; "pretty much impossible to catch a fish")
- Catching: a creature not yet in the guide is curious. It swims with the current (crosses the screen
  about 100-140 px/s slower than the columns) and holds its line instead of fleeing. Touching it (40 px)
  logs it at once; passing within 100 px fills the ring in 0.28 s, and the ring keeps what it gathered.
  Logged ones still scatter. A second creature of a species just logged no longer pays twice. A
  200 ms-lag bot steering for creatures logs 19 of 20 it meets (the test asks for over 75 %).
- Harder: speed 250 + 3.6/passage up to 440 px/s (was 235 + 3.2 up to 400); a column every 1.5 s
  falling to 1.05 s (was 1.6 to 1.15); the gap narrows from 232 to 100 px (was 250 to 105); openings
  drift from passage 6, up to 80 px (was 8, 70 px); the centre moves up to 60 + 2/passage px (cap 85).
  A 220 ms-lag bot's median dive fell from 45 to 31 passages; a 150 ms one is about the same as before.
- Four lamps (on #16's helpers, merged in): lamps 1-3 stay the depth gauge. Lamp 4 is the finder:
  green pulsing faster and brighter as an unlogged creature closes, white on a catch; otherwise white
  with a shield, a red heartbeat on the last hull, or the zone colour dimly. A three-lamp node gets the
  same nine values as before. The board LED is not used.
- Fix: the Abyss sonar could skip a column close to the craft (the ring and the column moved past each
  other in one frame); each ping now lights each column once when it reaches it.
- Shared test edited: `tests/engine.test.mjs` "a fixed-step pilot can traverse seeded layouts" now runs
  75 s instead of 120 s, because the lag-free bot meets the Deep (and dies) at about 90-150 s now.

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
