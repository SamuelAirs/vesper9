# ChatGPT's games ("After Hours" v1.0.0): evaluation

Reviewed 2026-10-02 from the zip Sam sent (copy: `after-hours/VESPER-9-After-Hours-v1.0.0.zip`). Nothing has been integrated, pushed or put on the console. Everything below comes from the desktop: none of it was checked on the Pi or the node.

## The short version

| Game | What it is | Verdict |
| --- | --- | --- |
| **Crawlspace** | Turn-based roguelike: three floors, bosses, 12 relics in 3 slots, heat 1–9, resumable runs | **Put on.** The deepest of the four. Speed up its choice scan first. |
| **Pocket Links** | Nine-hole mini golf: tap to change club, hold to aim, release for power; banks, water, sand, ice, slopes | **Put on.** The most immediately fun idea, and the controls suit the button well. |
| **Supper Club** | Real-time kitchen: the three lamps *are* three pans; cook and plate meals to fill tickets over four services | **Put on, then playtest.** The best fit for the lamps. Its real-time pace on the real lamps is the open question. |
| **Night Grid** | Ten-shift resource puzzle: route power to three districts | **Hold.** It plays like a spreadsheet, and the lamps are only a status readout. It's the weakest fit with the console. |

## Did they follow the kit, and did ChatGPT run the tests?

Yes on both counts.
- Each game is one folder in the kit's format (game file, tests, catalog entry, NOTES.md, screenshots). Nothing outside the folders was touched.
- I searched the source for everything the kit forbids: `Math.random`, timers, `Date.now`/`performance.now`, DOM, storage, `fetch`, `shadowBlur`, gradients, comma `export const`, and imports outside the allowed list. None turned up.
- Every game uses `AppGuard` and `LampBus` and reads `latencyMs`. Saves carry `schema`, `runs`, `milestone` and `last`, with bounded migration. None has a daily mode, an achievements screen or a hidden menu.
- ChatGPT clearly ran the repo's suites: its logs match mine exactly. I registered the four in a scratch copy of current `main`:
  - 58 of 58 of the games' own tests pass.
  - 176 of 176 menu-gesture tests pass.
  - The full JS suite gives 912 of 913. The one failure is the existing Perihelion bot test on seed 3003, which fails on `main` without these games too.
  - I repeated the games' own tests and the gesture tests on the platform-polish draft, which has the 1.6 s game hold and the latency setting. Everything passes there as well.
- Speed: at full desktop speed, update plus draw takes about 0.3 ms per frame, near the existing games. At a 10× CPU slowdown the four miss frames at about the same rate as Orbit Lock in the same run. That's not a Pi measurement.

## Per game

### Crawlspace (suggest VOYAGES)
- **Good:**
  - Real decisions every turn. Enemies show their next move, and swing, brace and drill each have visible costs.
  - 12 relics compete for 3 slots, so you build something each run.
  - There are three bosses, a proper ending, and harder "heat" houses after a win.
  - Runs resume after leaving the app.
  - ChatGPT's bot shows that mashing swing loses in 33–47 s, while reading intents wins in about 5–8 minutes.
  - The tone is funny: a dust bunny, load-bearing mold, an unpaid invoice with a personality.
- **Concern: pace.** You choose by waiting for a lamp: the three options light in turn for 1.7 s each, and the scan restarts on the left after a 1.5 s pause following every action. That works out to about 3.2 s per action on average and almost 5 s for the right-hand option. That is the slow-start problem Descent had.
- **Fix before it goes on:** let a tap step to the next option and a hold choose (the console's menu style), or at least shorten the scan to about 1 s and drop the reset to the left.

### Pocket Links (suggest ARCADE, which has room once Descent comes off)
- **Good:**
  - A clean one-button scheme: tap changes club, hold locks aim and charges power, release shoots. Power rises and falls slowly, so a late release is recoverable.
  - Nine authored holes introduce banks, carries, surfaces, ice and slopes in order, with seeded mirroring for replay.
  - The lamps show the club, the power fill and the water risk.
  - It starts fast.
- **Concerns:**
  - **Possibly too easy.** While you charge, a ring shows exactly where the ball will stop, updated 10 times a second. ChatGPT's exhaustive planner aced 6 of 9 holes and went 20 under par. A person won't play that well, but once they learn to release when the ring sits on the cup, it may become easy. A shorter or fading preview on later holes would keep it a skill.
  - Only nine layouts, varied by mirroring, so its depth is limited.

### Supper Club (suggest LAMPS)
- **Good:**
  - The best use of the node here: each lamp is a pan, and its colour (cyan empty, amber cooking, green ready, red burnt) is the game.
  - Upgrades between services and multi-ingredient tickets add real choices.
  - The first meal is ready about 4 s in.
  - Mashing serves nothing.
  - Four services make a full evening, about 3–4 minutes.
- **Concerns:**
  - It's real-time, but you act through a 1.4 s scanning cursor, so a ready pan can be up to 2.8 s away. That could feel sluggish or stressful.
  - Tapping an amber pan throws the food away, which is harsh if the lamp you saw lags the game.
  - Both need a play on the real lamps.

### Night Grid (suggest MIND, or leave off)
- **Good:**
  - A thought-through puzzle: feeder capacities, real routing through ties, forecasts, and shops that earn kits.
  - ChatGPT's planning bot wins 9 of 12 nights, and fixed or random play wins none, so skill matters.
- **Concerns:**
  - It's a board of numbers in small text.
  - Each decision takes two presses (inspect, then commit) on a 2.4 s scan.
  - The lamps only echo the screen.
  - Its NOTES.md admits it is "not a lamps-only game".
  - It's the least "Vesper" of the four and the slowest to play.

## For the four-lamp node
All four use the three lamps as three choices (actions, pans, districts) and build their values with the shared lamp helpers. They will keep working when the fourth lamp is dark. Once the four-lamp helpers land, the obvious use is the fourth lamp (or the LED board) as a status light: health or battery in Crawlspace, the club in Pocket Links, goodwill in Supper Club. That's a small change per game, not a redesign.

## Integration notes for later
- The package's INTEGRATE-ON-PI.txt and its prebuilt HTML simulator aren't needed. Integration only needs the four `cartridges/<id>` folders.
- Every game's catalog entry suggests VOYAGES. VOYAGES already has five games and holds six, so the sectors above spread them out.
- Voice words: crawlspace; supper, kitchen; golf, pocket links; night grid, nightgrid. None clashes with an existing game's.
