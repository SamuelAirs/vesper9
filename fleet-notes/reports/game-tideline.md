# game-tideline report

## 1. Outcome

TIDELINE is built from scratch as `web/apps/tideline.js` (one module; only `export class Tideline`, plus a static `Tideline.model` for tests), with `tests/tideline.test.mjs` (28 tests) and an updated catalog entry (icon, record labels, description, controls). Full node suite 490/490, Python suite OK, catalog in sync, browser smoke passes (26 apps), dev-shot reports "no page or host errors". Nothing was verified on the device.

## 2. Details

**How a catch plays.** From the shore, a tap (under 0.22 s) opens the menu and a hold charges a cast (1.5 s to full; the bar is marked with the waters in reach). Release throws; a longer charge lands farther, which picks the water. A short wait (1.6 to 4.8 s, sometimes a fake nibble) ends in a bite: bobber dip, "BITE" on screen, all three lamps flash, three square tones. Press within 1.0 s (1.6 s while learning); pressing early scares it off. The catch is a vertical gauge: a zone with weight (acceleration up while held, gravity down, drag, soft bounce at both ends) and a fish marker; a meter beside it fills while the fish is inside the zone and drains outside; full lands the fish, empty loses it. Five behaviours: steady (slow sine), sinker (drifts, bias downward), darter (fast random targets), bolter (hovers, then bolts across the gauge), fighter (fights harder as the meter fills). The first three landed catches use a bigger zone, slower drain and gentle fish. A tension tone sounds while the fish is in the zone and steps up in pitch with the meter. The card shows the drawing, name, size, NEW SPECIES or SIZE RECORD, field note, scrip, and a tide summary every fifth cast.

**Lamp scheme (stated on the title screen).** Left lamp = fish below the zone (release), right lamp = fish above (hold), middle lamp green = fish inside the zone (plus a dim side lamp on the side of the zone's centre where the fish sits). Brightness rises with the meter (0.18 to 0.40 of full); below a fifth of the meter the lit lamps turn red and flicker (never fully dark, so position still reads). Other phases: charge fills left to right with a colour per water; wait is a slow cyan breath on the middle lamp; bite is all three flashing white; landed has a pattern per rarity (green sweep, cyan chase, amber bounce, violet flashes, white/amber flares for a legend), a white flash first for a new species, amber triplets for treasure; lost fades red. The gauge on screen also mirrors the lamps as three small circles.

**Depth.**
- 30 species (26 plus one legend per water) in 4 waters (Halo Shallows, Cinder Reach, Lantern Deep, The Underlight), each with rarity, size range, behaviour, preferred periods (dawn, day, dusk, night; 13 are time-gated), weather boost, silhouette and a field note. Plus 6 treasures that are not fish.
- Weather (clear, fog, ash-fall, storm) changes every 3 to 6 casts, boosts some species; the Magma Pilgrim rises only in ash or storm.
- A legend needs 4 species recorded in its water, the right time/weather, then a small per-cast chance (raised by lure, chum, storm).
- Gear in the in-game menu (taps step, hold chooses; CLOSE or BACK is always the first entry): catch grid (zone size), reel (meter fill), caster (reach: level 1 opens the third water, 2 the fourth), lure (rarer bites), and chum (5 casts of better odds). Costs 70 to 760 scrip.
- Field log: 8 by 4 grid of silhouettes ("?" until caught), largest size, count, and hints for missing species (water, time, weather; "beyond your cast" if the water is out of reach). Score is a weighted catalogue score (1/2/4/7/15 by rarity, +2 per treasure).
- Session: a "tide" is five casts; finishing it pays a bonus and shows a summary.
- Save: schema 2, about 1 KB late game (test limit 1,500 bytes; host limit 8,192). Older or odd saves normalise safely.

**Menu-gesture safety.** `cancel()` keeps the catch and grants 1.5 s without drain; so does `resume()` after the system menu. Two quick taps during a catch grant a 1.5 s shield (at most once per 5 s, so tapping cannot stall forever). Tested: 3 taps, 4 taps, and two taps plus a one-second hold, each followed by `cancel()`, keep the fish.

## 3. Verification

- `node --test tests/tideline.test.mjs`: 28 pass. Covers catalogue sanity, zone physics (bounded, bounce, settle), every behaviour in range and distinct, meter rules, idle player loses (model: over 97% of 180 catches; app flow too), bot table, beginner assists, lamp-only (per frame: the lit side lamp matches the fish's true side, middle lamp lit and green exactly while inside, brightness follows meter; a lamp-reading player lands the easy fish more than 70% of the time), bite flashes, early press, wait range, water by cast distance, availability by water/time/weather/bait/legend gates, card/records/save, rarity celebration, full-app bot vs idle, tide, gear menu, save/migration/size, gesture tolerance, cancel/dispose in all 8 phases, lamp bytes and moderation, primitive budget (play frames under 300; the log screen is about 490, a non-play screen), treasure, weather.
- `node --test tests/*.test.mjs`: 490 pass, 0 fail. `python -m unittest discover -s tests`: OK. `build-catalog.py --check`: in sync. `build-demo.py` then `node tests/browser-smoke.cjs`: `"passed":true`, 26 apps, no page errors.
- Bot table (competent bot, 0.13 s reaction; gear levels raised together; 60 trials each; full table in `fleet/work/game-tideline/bot-table.txt`):

| Species | L0 | L1 | L2 | L3 |
| --- | --- | --- | --- | --- |
| commons (8) | 98 to 100% | 100% | 100% | 100% |
| uncommon, e.g. Slagback | 48 to 100% | 100% | 100% | 100% |
| rare, e.g. Kiln Eel | 5 to 90% | 75 to 100% | 100% | 100% |
| very rare, e.g. Soot Lantern | 3 to 32% | 75 to 100% | 100% | 100% |
| Halo-Keeper | 0% | 68% | 100% | 100% |
| Magma Pilgrim | 0% | 15% | 87% | 100% |
| Lantern Queen | 0% | 5% | 28% | 90% |
| Underlight Titan | 0% | 15% | 83% | 98% |

- Simulated skilled player buying gear when affordable, fishing the best reachable water, a different time of day every ten minutes: 30 of 30 after 473 casts, about 81 minutes of play (24 of 30 at about 62 min). A real player will be slower.
- Screenshots (1024 by 600, `fleet/work/game-tideline/shots/`): `tideline-title.png`, `-shore.png`, `-charge.png`, `-chargefar.png`, `-cast.png`, `-wait.png`, `-bite.png`, `-catch1.png`, `-catch2.png`, `-catchnight.png`, `-catchqueen.png`, `-card.png`, `-legend.png`, `-legend2.png`, `-lost.png`, `-menu.png`, `-gear.png`, `-log.png`. I opened title, charge, chargefar, catch1, catchnight, bite, card, legend, legend2, lost, gear and log. Fixed from them: title text over the pier, charge bar too near the edge, oversized silhouettes on the legend card and gauge. `-legend`, `-card` and `-menu` predate those fixes (`-menu` actually shows the shore); I did not re-open `-cast`, `-wait`, `-shore`, `-catch2`.

## 4. Not done / uncertain

- Difficulty is tuned against a bot, not a person. The catch is sensitive to reaction delay: a bot with 0.23 s lag and a naive controller failed even easy fish at gear 0 (the first three catches have assists). Play it and say whether early catches feel hard. Knobs: `ZONE_UP`/`ZONE_DOWN`, `fill` and `drain` in `newCatch`, per-species `d`.
- Time-gated species follow the real clock, so a daytime-only player cannot finish the log; hints say so.
- No hardware check: lamp brightness and the tension tone's feel are unconfirmed. The tone restarts the oscillator on each pitch step (the host's `startTone`), which may click.
- The log screen draws about 490 primitives (static, not during play).
- A tap at the shore opens the game menu, so four quick clicks from the shore step the game menu before the system menu opens. Harmless but untested on device.
- Treasure and legend odds (5%, and 2.5 to 6%) are guesses.

## 5. Branch

Branch `worktree-agent-a0f9447dfc7360ec5`, commit `bf5c130`.
