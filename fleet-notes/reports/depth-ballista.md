# depth-ballista (desktop cloud session, branch claude/ballista-launcher-m84hzy)

**Nothing here was verified on the device.** Simulator screenshots and headless tests only.

- Rebuilt as a Kitten Cannon style distance launcher. Aim sweeps by itself; press fixes the angle, hold charges a meter that peaks and falls, release fires a pod. In flight one press does two jobs: a skip if the pod is about to touch down (a late, "perfect" press keeps nearly all its speed), otherwise a thruster (1 to 6 per run).
- Field: six zones by distance (Flats 0 m, Dunes 150, Craters 350, Spires 650, Glass 1000, Storm 1500). Bounce/boost: spring pads, boosters, mines, beacons (refill a thruster), updrafts, glass. Slow/stop: drifts, nets, sinkholes (end the run unless skipped off), headwind gusts. Scrap in the air for salvage.
- Workshop (hold on title/result): barrel, thrusters, hull, fins, magnet, five levels each, paid with salvage (5 + 1 per 8 m + 2 per scrap, plus 30 per new feat, zone bonuses, daily bonus). Pods SKIPPER / DART unlock at 4 / 8 feats. Daily run: same field and loadout for everyone on a date, goal, streak, does not touch the console best. 17 feats (2 hidden). Log page.
- Lamps: aim = amber spot following the barrel; charge = green/amber/red meter; flight = left blue height, middle zone colour by speed, right amber thrusters left; all cyan when a skip is possible (brighter and whiter at the perfect moment); middle blinks red for a sinkhole ahead of a low pod; flashes for pads, skips, blasts, nets.
- Save schema 2. The first Ballista's record (recordRun schema 1) migrates: runs carry over, last score kept as `legacy`, 20 salvage per old run (max 300). Tested with a fixture of that shape.
- Bot (tests/helpers/ballista-bot.mjs, `node tests/helpers/ballista-bot.mjs 60 3 0.6`): first runs 200-350 m, full workshop after about 35 runs, then 1500-2700 m. A player who only fires averages about 95 m.
- Known weak: the console's dashboard best for Ballista still holds the old artillery score until a run beats it in metres (the service only allows the default metric for this app). Salvage has no use once everything is bought. Pad hits are mostly luck. Sound and lamp levels unheard/unseen on hardware.
- Tests: 26 in tests/ballista.test.mjs. Full suite: 822 JS pass, 1 fail (Perihelion bot on seed 3003, also failing on main), 189 Py, catalog check, demo build, browser-smoke, extension-smoke, host-browser, voice-host pass.

## Round 2 (after Sam played it): depth and visuals

- Contracts: three standing jobs (fly N m, reach a zone, perfect skips, lifts, scrap, chain, sinkhole skip, beacons, no-thrust distance), drawn from a saved seed, harder and better paid as more are done; paid at the end of a run, withdrawn after 10 runs unmet. Tracked live top left during flight.
- Chains: pads, boosters, mines, beacons and perfect skips with no plain landing between them; best chain multiplies run salvage (x1.1 a link, up to x2). Shown top right; the middle lamp whitens as it grows.
- Modules (salvage sink): ten one-time builds (spring tuning, scrap scanner, beacon relay, net cutter, drift skids, storm sail, ablative shell, gyro, afterburner, salvage rig), two slots, a third at 12 feats.
- Overhaul: with every system at V, two holds strip them for the next mark (up to X): launch +6% and salvage +15% per mark for good, systems cost 40% more per mark. Endless tail.
- Zone VII THE BEYOND from 2600 m; fourth pod GLIDER (14 feats); feats now 23.
- Visuals: per-zone sky gradient (cached), moon, two parallax silhouette layers in each zone's own shapes, ground fill with pebbles, a capsule pod that points along its flight with fins, flame, shadow and halo, pad squish, animated boosters, rotating beacons and scrap, shock rings, screen shake, rain and lightning in the storm, glints on the glass, speed streaks, LAST and BEST flags, barrel recoil and charge glow, the result distance counts up.
- Save schema 3; schema 2 (round 1) and schema 1 (artillery) both migrate, with fixture tests.
- Bot: systems full after about 30 runs, all modules about 50, then a mark every 25-30 runs.
- Dashboard best in old units needs a service change (reported to the coordinator; vesper/ untouched).
- Tests: 33 in tests/ballista.test.mjs; full suite 829 JS pass, 1 fail (the same Perihelion bot test that fails on main); Python, catalog, demo and the four browser suites pass. Not verified on the device.
