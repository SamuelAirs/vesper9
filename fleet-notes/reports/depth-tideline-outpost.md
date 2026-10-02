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

## Follow-up: the independent review (2026-10-02) scored Tideline 5.5

The review found a cliff at landing 40: once the help faded, a 200 ms player landed only 2-47% of uncommons, while full gear landed everything. It reproduced: with the old fish, the review's 200 ms bot at no gear landed commons 79% (lowest 55%), uncommons 50% and rares 12%. From gear 2 it landed every non-legend.

What changed (model only, with the save unchanged):
- **Tells.** Darters, bolters and fighters' big lunges (0.2 or more of the gauge) are told first. The fish stops and shivers for 0.5 - 0.2 x difficulty seconds (about 0.3-0.45 s), the screen says IT WILL RISE or IT WILL DIVE with an arrow by the fish, two notes rise or fall, and the lamps shimmer. Only the direction is given, not the spot. A learner gets the hint once: "It shivers before it darts". Reading the fish now replaces reflexes as the skill.
- **Gear flattened.** Zone 0.09 / 0.10 / 0.11 / 0.12 (was up to 0.15), reel x1 / 1.15 / 1.3 / 1.45 (was up to 1.75). Rares fill at x0.85, very rares x0.7, legends x0.45. Faster fish move faster (speed 0.22 + 1.3 d^1.3) and drain more (0.06 + 0.45 d^2). Easy fish give a little more room (+0.03 (1-d)^3 on the zone).
- **Bots.** Three human-like bots: they see the fish 180-250 ms late, partly know their own zone, decide about every 100 ms, and either read the tell's direction or not. Novice: 250 ms, no tells. Practiced: 230 ms, tells. Sharp: 180 ms, tells. The review's bot is kept as the harshest case.

After the change, at the lasting quarter of help (the `bot results by species, gear and skill` table in `tests/tideline.test.mjs`):
- Novice, no gear: commons and uncommons 100%, rares 0-31%. With gear 2: rares 100%, very rares 25-44%, legends 0. Full gear alone never lands a legend.
- Practiced, no gear: everything up to very rare 81-100%, legends 0. Full gear: legends 69-100%.
- Sharp: legends 13-94% at gear 2. Skill counts for more than a gear level at the top.
- The review's 200 ms bot, no gear: commons 63-100%, uncommons 25-100%. Before, it was 55-100% and 15-100%.
- A practiced player completes the catalogue in about 82 minutes over nine visits (24 of 30 at 63 minutes).

Not addressed here: the console-wide latency calibration and the menu gesture belong to the platform polish thread. Tells make Tideline much less sensitive to latency in any case.

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
7. Tideline (after the review): hook anything but a steady fish and watch for it to shiver, with IT WILL RISE or IT WILL DIVE at the top and two notes. Move the zone that way before it goes. Does that make the harder fish feel fair rather than twitchy?
6. Outpost: tap a beat and watch the ripple run along the ground; it turns cyan in full groove. Do the rising signal pulses look busy or just alive?
