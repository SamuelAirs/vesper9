# depth-tideline-outpost report (desktop, 2026-10-01)

Nothing here was verified on the device. Branch `claude/tideline-outpost-depth-l5bknl`.

## What was shallow

**Tideline.** The catch itself is good, and 30 species plus legends is a long log, but every cast was the same loop with nothing to aim at besides the next unrecorded silhouette, nothing rewarded catching *well*, the time-of-day gating meant a daytime-only player could never finish, and the tension tone restarted an oscillator on every pitch step (likely clicks). Measured with bots: a naive controller with 0.23 s reaction loses almost every fish, while a predictive "human" bot with 0.2 s lag lands nearly everything at gear 0. So the catch rewards anticipation; I left its difficulty alone and added ways to play it well.

**Outpost.** Deep already. Two real problems: (1) the four instrument voices played at full level each, so a fully voiced tap was five notes at full volume; (2) the late game walled. On the bot (`tests/helpers/outpost-sim-cli.mjs`), runs 1-7 took 31, 19, 21, 49, 50, 50, 90 minutes and run 8 did not finish in four hours; the bearing tree is complete by then, so nothing new arrived either. The tap itself was also skill-free: any rhythm paid the same.

## What changed

Tideline (schema 3; schema 2 saves migrate: catches, sizes, gear, scrip and finds kept, one star for everything landed, experience worked out from the log so an existing player starts at a fitting rank):
- **Perfect catches and stars.** A catch that spends under 0.25 s outside the zone is PERFECT. Stars per landing: gold = perfect and a good size (60% of range), silver = perfect or a very big one. Scrip x1.25 / x1.6. The log shows silver and gold pips per species; catalogue score adds 1 per silver, 2 per gold, so 30/30 is no longer the end. Perfect rate on the "human" bot: about 33% at gear 0, 60% at gear 2.
- **Angler rank 1-10.** Experience per landing by rarity and stars. Each rank fills the reel 2% faster and widens the bite window by 0.04 s. Rank 2 opens the board, 3 chests, 4 rests; rank-ups are announced on the card.
- **Notice board.** Three commissions at a time, drawn from waters in reach (mostly species biting at this hour): land N of a species, N fish in a water, a species over a size, N perfect catches, salvage a chest. Paid on completion; finished notices are replaced when the tide ends. On the shore screen and in the menu.
- **Salvage chests (Stardew-style).** From rank 3, 12% of catches (+4% per lure level, +8% in storm) carry a chest that drifts at its own height in the gauge; holding it inside the zone fills its bar. Lose the fish, lose the chest. Contents: an unfound treasure (35%), chum, or scrip by water. The chest is shown on screen only: the lamp contract for the catch is unchanged and still tested frame by frame.
- **Rests.** From rank 4 each completed tide earns a rest (up to three); "REST UNTIL DUSK" moves the sky one part of the day on for this visit and re-rolls the weather, so night species are reachable in the daytime.
- **Reel clicks** (short enveloped tones, faster and higher as the meter fills) replace the sustained tension tone.

Outpost (schema 4; schema 3 saves migrate with everything kept, statistics not restarted, and a one-time "updated" card):
- **Voices mixed down.** `ctx.tone` gained an optional gain (shared engine change, see below). Voices at 0.4 / 0.25 / 0.45 / 0.2 under a lead at 0.8: a fully voiced tap sums to about 2.1 notes instead of 5.
- **Groove.** A tap within 20% of the recent beat adds a step (24 steps = full), a stumble halves it, a pause fades it. Full groove is x1.5 on taps and phrase bonuses, lights the note glow brighter and cyan on the lamp for that note, and shows as GROOVE xN in the header. New goals: IN THE POCKET (hidden), HOUSE BAND (1,000 taps in full groove). Statistics: best groove, taps in the pocket. I tried x2 first; on the bot it made no clear pacing difference either way (flare lodes dominate the run-to-run spread), and x1.5 keeps the bot's first-run pacing where it was (mean of 12 seeds: 31.3 / 23.8 / 30.1 min vs 32.3 / 21.7 / 28.0 before).
- **Constellations.** From 1,000 bearings held, the bearing tree offers CHART <NAME>: x1.3 all output each, cost 250 x 1.45^n bearings, without end. Twelve named shapes drawn faintly in the sky; later charts are "deep" and redraw them brighter. Goals FIRST LIGHT and THE WHOLE SKY.
- **Ready ratio.** "Relocation ready" asks for 2x the bearings held below 500, 1.6x below 5,000, 1.35x below 20,000, then 1.25x.
- Bot after the change (seed 1, 25% active): 30, 20, 31, 36, 53, 31, 61, 50, 98, then about 240 min for runs 10-11. The wall moved out by about three runs and the late game has a reward per run; very late runs (L > 30,000) are still several hours of mostly idle time, which suits the offline credit.

## Follow-up: Sam found Tideline hard (playtest 2026-10-01 evening)

The learner's help used to switch off after the third fish, and a slow-reacting bot (0.18 s, no prediction) then dropped from landing everything to 53% of commons and 35% of uncommons at gear 0. Now the help tapers over the first 40 landings (larger zone, calmer fish, fuller and slower-draining meter, a longer bite window) and a quarter of it stays for good as the new base difficulty. A learner's first early press in a cast is forgiven with a reminder instead of scaring the fish. Same bot, no gear: 100% of commons, uncommons and rares up to 20 fish; after 40, 98% commons, 81% uncommons, 23% rares (rares and legends still need skill and gear). Easy fish only for the first five catches (was three).

## Follow-up: visuals and more life (Sam, 2026-10-01: "visuals should be improved across the board")

Restyling stays inside the two games; the dashboard has its own thread.

Tideline:
- **The scene is redrawn.** A sky gradient for each part of the day with a halo round the sun or moon, a solid far shore and a nearer ridge, a water gradient with faint bands for each water (brighter when it is in reach), a shimmering reflection column, five fish shadows drifting under the surface (hidden during the catch and on the card), a planked pier and an angler with a curved rod whose tip the line now leaves from. Splashes on the cast, on the bite and on the landing. The catch gauge has a water fill and rising bubbles. Catch and card frames are 363 and 357 canvas calls (budget 400).
- **Today's catch.** Each calendar day names one species (rarity up to rare, in a water you can reach). It bites 2.5x as often, pays double scrip all day, and the first one each day pays +60 + 20 per rarity step and 1.5x experience. The shore shows TODAY'S CATCH with the water, or LANDED. Save field `dy` (schema 3; old saves just lack it). New test.

Outpost:
- **Horizon and ground.** A horizon glow that warms as the station grows (teal with the aurora), a far planet lit on one side, the ridge filled as a silhouette, and a ground gradient below the machines.
- **Signal you can see.** Two pulses rise from each working machine toward the signal count, faster and brighter as the machine works harder.
- **Taps ripple.** Each gathering tap sends a pulse out along the ground from the middle, amber normally and cyan in full groove, so the beat is visible as well as heard. Drawn only; it uses no random numbers, so the game's sequences are unchanged.
- A busy late frame is about 1,290 canvas calls, roughly 70 more than before (Outpost has no 400 cap; its line check passes).

## Shared code touched

`web/engine/audio.js`: `Synth.tone(hz, seconds, type, gain = 1)`; one multiplication, default unchanged for every other app. `docs/ENGINE.md` row updated. `docs/WORKLOG.md` entry. Nothing else outside the two games, their tests, `tests/helpers/outpost-bot.mjs` and a new fixture.

## Verification (desktop)

- `node --test tests/*.test.mjs`: 835 pass, 1 fail. The failure is `perihelion.test.mjs` "a planning bot crosses every region" on seed 3003, which fails identically on `main` without these changes.
- Python suite 189 OK (1 skipped), `build-catalog.py --check` clean, `build-demo.py`, browser-smoke (26 apps), extension-smoke, host-browser, voice-host all pass (Playwright 1.56.1 with the container's Chromium).
- Screenshots (1024 x 600) looked at: Tideline shore with notices and rank, a catch with a chest, a perfect silver card with chest, menu, notice board, log with stars; Outpost groove at x1.50 after 32 real taps through the simulator, a constellation entry in the tree, the update card. After the visual pass: Tideline shore and wait with the new scene and today's catch; Outpost mid-game with seven machines, ripples and the planet.

## For Sam to try on the console

1. Tideline: open it with your existing save. If you have landed more than a handful of fish, your rank is already above 1 and the notice board is up (shore screen, top left). Land a few fish keeping the fish inside the zone the whole way: the card should say PERFECT. Listen to the reel clicks: is that better than the old tone?
2. Tideline at rank 3+: watch for a small box drifting at the left of the gauge during a catch; steer the zone onto it.
3. Outpost: open your save, read the update card, then tap a steady beat for ten seconds or so and watch GROOVE climb to x1.50 at the top right. Buy or check the voice upgrades: are they now quiet enough under the tune?
4. Constellations appear only at 1,000 bearings held, so they may be a while away on your save.
5. Tideline: does the new shore (sky, pier, angler, shadows in the water) read well on the 7" screen? Look for TODAY'S CATCH on the shore and try to land it.
6. Outpost: tap a beat and watch the ripple run along the ground; it turns cyan in full groove. Do the rising signal pulses look busy or just alive?
