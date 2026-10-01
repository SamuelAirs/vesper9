# game-pulsar report

## 1. Outcome
Built PULSAR, a one-button rhythm game (`web/apps/pulsar.js`), with tests and a catalog entry (icon, record labels, `"escape": "hold"`). Unit suite, Python suite and catalog check pass; browser smoke fails at line 79 both with and without my change (see section 4). Committed on the branch.

## 2. Details
How it plays: three lanes of beats fall to a strike line. Tap short diamonds, hold long bars head to tail. Phrases are 8 beats, generated from `ctx.rng` as the clock reaches them, independent of the player, so a seed reproduces a run. Phrases 1-2: 80 BPM quarters; 3-4: 84 BPM with off-beats; 5-6: 90 BPM with holds; 7+: 96 BPM rising 4 BPM per phrase to 132, longer holds from phrase 11. Each new element is announced on screen. Timing is judged on the sim clock (`song`, accumulated dt) at `song - INPUT_OFFSET` (0.04 s, documented constant, also `Pulsar.INPUT_OFFSET`). Windows start at perfect 0.10 s / good 0.20 s and tighten to 0.065 / 0.14. Combo multiplier x1 to x4 (every 10). Stability: -0.06/-0.09 per miss, +0.03 perfect, +0.018 good, -0.015 for a stray press. It ends at 0 with a result screen (score, best combo, accuracy, phrases) and saves via `ctx.score` and `recordRun`. A hold completes automatically when its tail passes; letting go within 0.22 s of the tail counts. Early release is a drop. A 3 s hold in play is one stray press (-1.5% stability), then nothing. `cancel()` drops a hold without penalty.

Sound: quiet triangle pulse each beat (lower on bar downbeats); a hit plays the note's pentatonic pitch (A minor, A3 to C5; lane = register: LOW/MID/HIGH); holds use `synth.startTone`; misses give a short low square; missed beats stay silent.

Lamps (left/middle/right = LOW/MID/HIGH lane), priority per lane: 
- result flash: green perfect, amber good, red miss/drop (about 0.2-0.3 s, full-ish accent);
- held signal: steady 30% green (amber if good) with slight shimmer, blinking in the last 0.3 s as a release cue;
- swell: 0.4 s before a beat the lane's lamp rises to about 50%, cyan for a tap, violet for a hold (so beat type is readable by lamp);
- breath: all lamps dim, pulsing with each beat; stronger when nothing is due within 1 s (between phrases); shifts toward red as stability falls below 35%.
Title: slow cyan breath. Result: dim red breath. `cancel()` and `dispose()` write all zeros. The play screen also mirrors the three lamps as dots under the lanes.

## 3. Verification
- `node --test tests/*.test.mjs`: 71 pass, 0 fail (12 new in `tests/pulsar.test.mjs`).
- `python -m unittest discover -s tests -p 'test_*.py'`: 29 OK. `build-catalog.py --check`: OK.
- Bots (seed 11, 240 s sim): perfect-ish bot (+-40 ms): 175,984 pts, best combo 458, 100% accuracy, reached phrase 61, never failed. Idle player: dies at 13.7 s (phrase 3), 0 pts. Sloppy bot (85% attempts, +-130 ms): still alive at 240 s, 36,479 pts, 66% accuracy. Poor bot (50% attempts): dead in phrase 5, 1,600 pts.
- Browser at 1024x600 via `scripts/dev-shot.cjs`, "no page or host errors" on every run. Shots in `fleet/work/game-pulsar/shots/`: `pulsar-title.png`, `pulsar-play1.png` (quarter notes, perfect), `pulsar-play2.png`, `pulsar-play3.png` (combo x4), `pulsar-late1.png` (hold in progress, violet lamp), `pulsar-late3.png`, `pulsar-result.png`. I opened them. The first pass had 14 px labels that were tiny at the real scale (canvas is shown at 0.55x), so I enlarged fonts (16-56) and lanes and re-shot. Hold appears in late1 only; I did not capture a miss or good frame in the final layout.
- `python3 scripts/build-demo.py && node tests/browser-smoke.cjs`: FAILS at `tests/browser-smoke.cjs:79` (the "four quick taps open the menu" check, on the Runner app). The same failure occurs on an unmodified copy of the parent commit (`git archive HEAD~1`), with load average about 13 from other agents. Likely timing under load; unverified. It never reaches Pulsar.

## 4. Not done / uncertain
- Browser smoke failure above; not retried at low load.
- Nothing tested on the device. Real USB latency is unknown; tune `INPUT_OFFSET` (top of `pulsar.js`) after playing. Sound levels untested by ear.
- Weakest: the run is endless after phrase ~13 (tempo caps at 132 BPM with the same density), so a good player has no ending. Off-beat runs have no pattern repeats, so it feels random, not musical. Lamp colour distinction (cyan vs violet swell) is untested on real lamps. No pause-resume re-sync of the beat tick (pause just freezes). Stability recovery is generous: an 85%-attempt sloppy player survives forever.

## 5. Branch
`worktree-agent-ad38878cce2bd352d`, commit `ea02273`.

## Addendum (coordinator note)
Took tests/browser-smoke.cjs and scripts/dev-shot.cjs from 732c584; browser-smoke now exits 0 (supersedes the failure in section 3/4). Removed in-canvas score/combo/phrase readouts (host HUD and hint show them); remaining play text is 22+ except lane labels and title lines (16). Unit suite: pulsar 12/12, full 71 pass. Shot: pulsar-final.png.
