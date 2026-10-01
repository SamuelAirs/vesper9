# game-descent report

## 1. Outcome
Built DESCENT (`web/apps/descent.js`): a one-button lander with an open-ended run of procedurally varied sites, a catalog icon and record labels, and `tests/descent.test.mjs` (12 tests). All checks pass. Branch `worktree-agent-add47b612b515b740`, commit `9e16374`.

## 2. Details
Play: hold fires the engine (constant acceleration, 1 fuel-second per second), release to fall. Touch the pad under the safe vertical speed. Sideways motion is purely the world's (a function of time), so the player times arrival: slowing the descent delays it until the pad is underneath. Each site's start position puts the pad under the lander at (fastest sensible descent time + a per-site delay), so the player must hover/slow by that delay. Fuel is sized from a simulated ideal descent times a margin (2.4 on site 1 down to 1.3).
Sites: 1 flat pad, no drift, safe 6 m/s; 2 crosswind, safe 5.5; 3 narrow pad; 4 thin gravity; 5 heavy gravity; 6 gusts; 7 sliding pad; 8 canyon (walls crash); 9+ random combinations, shrinking pad, tighter fuel, safe 4. Three landers; a crash replays the same site; an extra lander every 4th site cleared (cap 3). Score per landing = (200 + 250*fuel + 150*softness + 100*centring) * (1 + 0.1*(site-1)). A press that skipped the briefing is latched and does not burn until released. A press on the final crash screen cannot restart (a real bug my harness exposed; fixed, tested).

Lamps: colour is the descent-rate verdict. Green while speed is at or under safe. Amber (sliding toward orange-red as braking room runs out) when over safe but recoverable by burning flat out now. Red and pulsing when even a full burn with the fuel left cannot reach a safe touchdown speed. The lit lamp is the pad position: pad under the lander lights all three; pad left lights the left lamp (middle 45% if near, 12% if far), mirrored for right. Engine firing adds a warm flicker. Clean landing: green sweep left-right-left then soft green breathing. Crash: red strobe 0.7 s, amber embers fade, dim red. Title, briefing and result: very dim breathing green/amber. Sustained level about a third of full, capped at 0.55. Off in dispose().
Sound: 88 Hz tone while burning (startTone/stopTone); accelerating warning beeps when unsafe, urgent and below 120 m; landing arpeggio; crash growl.
Menu: `adaptive`. Three stray taps are three tiny burns (tested).
Canvas text is 16+ logical px, 22+ for play-time readouts; site/landers/score live in the host HUD (score repeated only on the result screen).

## 3. Verification
- `node --test tests/*.test.mjs`: 70 pass, 0 fail.
- Python suite: 29 OK (one run under heavy load showed 1 error that did not reproduce on two reruns; not investigated).
- `python3 scripts/build-catalog.py --check`: in sync.
- `node scripts/dev-shot.cjs` at 1024x600: "no page or host errors".
- `python3 scripts/build-demo.py && node tests/browser-smoke.cjs`: passed (12 apps, no page errors).
- Bot (sees altitude, speed, fuel, drift, pad position; brakes just in time, slows to arrive over the pad), seeds 3/7/11/19, up to 12 simulated minutes: scores 14004 / 6333 / 12193 / 15787, sites cleared 18 / 10 / 16 / 19. Never-press bot: 0 on every seed, game over after three crashes. Bot descents take 16-24 s with 20-60% fuel left; it fails on sliding-pad sites. (`DESCENT_REPORT=1 node --test tests/descent.test.mjs`)
- Screenshots in `fleet/work/game-descent/shots/`: descent-title, -brief, -brake, -p1, -canyon-brief, -canyon-play, -gust, -crash, -over. The host header's three lamp discs show lamp colours. Later sites were reached with a dev-shot `eval:` setting `vesper.app.siteNo`.
- Also committed `scripts/dev-shot.cjs` and `tests/browser-smoke.cjs` from main commit 732c584 as instructed.

## 4. Not done / uncertain
- Difficulty is tuned by bot only; no human has played it. Heavy-gravity and gust sites have the tightest fuel and may be harsh; early sites may be easy for a practised player.
- The touchdown marker assumes the present descent rate (floor 3 m/s), so it swings as the player pulses the engine.
- Far-range pad direction on the lamps is subtle (middle lamp at 12%).
- The clean-landing panel was not re-shot after the final font changes (seen earlier, and covered by tests).
- Nothing verified on the real node, lamps or speakers; sound levels untested.
- No ending; sites continue indefinitely.

## 5. Branch
`worktree-agent-add47b612b515b740`, last commit `9e16374`.
