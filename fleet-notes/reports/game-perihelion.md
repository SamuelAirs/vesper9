# game-perihelion report

## 1. Outcome
PERIHELION is built: web/apps/perihelion.js, tests/perihelion.test.mjs, catalog entry with icon and record labels, regenerated web/apps/catalog.js. A planning bot survives five simulated minutes on seeds 11 and 202 and two minutes on 3003. All 72 node tests, 29 Python tests, the catalog check and browser-smoke pass. Nothing was verified on the device.

## 2. Details
How it plays: the probe coasts right under light gravity (G=240 px/s2). Pressing throws a tether at the reticle-marked sun (nearest sun ahead of or above, within 275 px, never one behind the last sun used). It lands after 5 frames at the probe's current distance, keeps its speed and swings as a pendulum. Release leaves exactly on the tangent. A tether under 0.35 s is a stray tap: a press under 80 ms never touches the course, and 80-330 ms blends the release velocity back toward the pre-catch velocity. Amber suns burn out after 2.4 s. Dark bodies (from distance 2600) kill on touch, in pairs from 7500, and gaps widen up to 10000. A "terminator" wall sweeps up from behind (36 px/s rising to 110) so stalling on a sun costs. Falling out below, drifting off the top, a void or the terminator ends the run. On-screen notices announce each new element (about x=1800, 4100, 7000, 10000).

Scoring: unit Mkm (10 logical px). Multiplier x1..x5 = 1 + chain/2 (max +4). The chain counts clean (>=0.35 s) releases whose next catch came within 1.2 s of free flight; a stray tap neither raises nor breaks it. Result screen: distance, best chain, anchors caught, record flag. Saved with ctx.score and recordRun (keys mkm, chain, catches, reason).

Energy note: catches keep speed and gravity is conservative, so total energy is constant for a whole run. "Drifting off the top" is therefore only reachable from an over-fast start (guarded, not tuned).

Lamps, exactly:
- Free flight: colour is height (green within 120 px of band centre, amber toward the edges, red near the edge, pulsing above 70% danger). Left-to-right fill is speed (lamp i lit at 0.1 + 0.9*clamp(3f - i), f from 180 to 420 px/s). Level about 38%.
- Tethered: one cyan spot sweeping the three lamps with sin(angle around the sun), left when the probe is left of the sun. Colour shifts amber/red with height danger. Blinks in the last 0.8 s of an amber sun's fuse. Level 40%.
- Catch: 0.14 s white fill at 70%. New record (passing the previous best): 1 s white/amber flash on all three at 5 Hz.
- Death: red fill fading over 1.4 s. Title/result: dim slow spot (amber glow after a record). cancel, pause and dispose write lamps off.

## 3. Verification (real results)
- `node --test tests/*.test.mjs`: tests 72, pass 72, fail 0 (about 16 s total; the bot makes the perihelion file slow).
- Python unittest: Ran 29 tests OK. `build-catalog.py --check` clean. `build-demo.py` then `tests/browser-smoke.cjs`: passed true, pageErrors [].
- `scripts/dev-shot.cjs` at 1024x600: "no page or host errors" on every run. Shots in fleet/work/game-perihelion/shots/: perihelion-title.png, perihelion-play1.png, perihelion-swing.png, perihelion-play2.png, perihelion-over.png, perihelion-late1/2/3.png (late = state moved by eval to x~5200 to show amber suns and the multiplier). I opened title, play1, swing, over, late1 and late2: legible, nothing clipped. Void bodies were seen only faintly under the result panel; no clean shot of one in play.
- Bot numbers: planning bot (simulates the game's own physics two catches deep). Seed 11, 300 s: 8156 Mkm, 120 catches, best chain 10, survived. Seed 202, 300 s (tuning run; committed test uses 150 s): 10141 Mkm, 128 catches, best chain 42, survived. Seed 3003, 120 s: survived. Idle probe dies at about 2.3 s with 53 Mkm. Bot exceeds 20x idle.
- Sloppy bots (tuning runs, not committed): one-catch lookahead with release error +-0.1 s and 6 frames lag died at 24-68 s. Two-catch bot with +-0.1 s error died at 33-164 s, with +-0.2 s at 28-40 s.
- Energy test: relative drift under 1e-3 over 60 s of swinging, radius constant to 1e-9, release radial component under 1e-9, speed kept. Three 80 ms taps then cancel: within 15 px of an untouched probe (about 6 px measured), no catches counted, run alive.
- Perf: node micro-benchmark (update plus a quarter of draws on a fake canvas) 0.16 ms per frame. Real canvas cost not measured. Draw uses under 400 primitives.
- Coordinator note applied: `git checkout 732c584 -- tests/browser-smoke.cjs scripts/dev-shot.cjs`, committed with my work.

## 4. Not done / weak
- No device test. Lamp brightness and colours unseen on hardware, only unit-tested.
- Human feel unverified. Sloppy bots die within about a minute, so it may be harsh for a newcomer. Tuning knobs: G, REACH, void chance/radius, terminator speed.
- "Gaps crossable" is shown by the bot surviving, not proven.
- Voids are dark with a red outline and X; low contrast risk on the real display.
- The canvas is small on the host page, so text and shapes are as large as the rules allow but still small.

## 5. Branch
worktree-agent-aef6b5333bdad0660, last commit 0a4ca58.
