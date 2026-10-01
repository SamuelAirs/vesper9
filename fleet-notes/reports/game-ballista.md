# game-ballista report

## 1. Outcome
BALLISTA (`web/apps/ballista.js`, id `ballista`) is a finished one-button artillery game with a lamp-based power meter, an endless run of proven stations, tests, catalog icon and record labels. All suites pass in the worktree; nothing was verified on the device.

## 2. Details
**How it plays.** A launcher on the left; the barrel sweeps up and down by itself (3.4 s cosine sweep, slow at the ends). Pressing fixes the angle where the sweep is at that instant; the hold sets the power on a meter that rises to a peak at 1.6 s and then falls again (period 3.2 s), so holding too long is not best. Release launches a probe under constant gravity and a per-shot wind (constant horizontal acceleration, shown as an arrow and a number, redrawn at random between shots). The last three traces stay drawn (newest bright, older dashed and fainter) with impact marks and a "SHORT 42" / "LONG 16" label (units of 10 px, with a ruler under the ground), plus the last shot's angle and power as "LAST 50° 25%" and a cyan tick on the power bar. A hold under 0.18 s cancels: nothing launches, nothing is spent, so three stray taps before the menu are harmless. 3 or 4 probes per station. Spare probes carry (up to 2) into the next station and add score. Running out of probes ends the run.

**Stations.** 1 RANGING: sweep only 40-50 degrees, huge target, no wind, so only power matters. 2 AIMING: power preset (the meter stops at the preset), wide sweep, so only angle matters. 3 both. 4 ridge. 5 crosswind. 6 sliding target. 7 cover (target behind a spire, needs a lob). 8 low gravity with wind. 9+ random combinations of ridge/cover, moving, twin targets, low gravity, wind and shrinking targets, escalating with the station number. Every station is verified at build time and redrawn, softened, or replaced by a plain range if it cannot be proven.

**Lamps.**
- Aiming: a dim green spot sweeping left to right with the aim (left = low angle).
- Charging: left lamp green, middle amber, right red, filling from the left in proportion to power (brightness max about 0.42). At the peak all three flash white once; past it the fill drains and pulses at 5 Hz.
- Flight: a cyan spot runs from the left to the right lamp with the probe's horizontal progress toward the nearest standing target; it turns amber once the probe passes the target. The right lamp has a faint amber glow as the target marker.
- Hit: all three flash green/white for 1.2 s, then fade. Station clear: green chase.
- Miss: left lamp = fell short, right lamp = fell long. Close misses are bright amber with the middle lamp faintly lit; far misses are dim red. Fades over 1.7 s.
- Title/briefing/over: dim pulse (the briefing shows a faint sweeping spot). Failed: red blink then dim red. `dispose()` writes zeros.

**Sound.** Charging: stepped rising tone (170 Hz upward in 20 steps via `startTone`), a short high blip at the peak, launch thump (62 Hz sine plus 124 Hz triangle), a rising three-note hit, a descending two-note miss (higher and shorter when close), a clear arpeggio, a descending sawtooth at the end of the run.

**Files:** `web/apps/ballista.js`, `tests/ballista.test.mjs`, `vesper/catalog.json` (own entry: icon, record keys score/stations/shots/accuracy), regenerated `web/apps/catalog.js`.

## 3. Verification
- `node --test tests/*.test.mjs`: 151 tests, 151 pass (about 27 s total; the ballista file is most of that because it runs bot sessions and the station proof).
- `python -m unittest discover -s tests -p 'test_*.py'`: 29 tests OK. `python3 scripts/build-catalog.py --check`: clean.
- `python3 scripts/build-demo.py && node tests/browser-smoke.cjs`: `passed: true`, 12 apps, no page errors.
- Station proof: 90 stations (3 seeds x stations 1-30) built from `ctx.rng`; 0 fell back to the plain range. Each target is checked, with a finer test than the one used to build (9 winds from -A to +A, 4 phases of any moving target), for a shot that still hits at +-1 degree of angle and +-0.012 power (about +-19 ms of hold). Build cost over 600 stations averaged about 45 ms, worst seen about 0.9 s (moving target plus ridge), at the station change.
- Bot (planner reading wind and target, then human-like jitter: press +-3 frames, hold +-5 frames), seeds 3/7/11/19: stations cleared 17/29/10/33, scores 12979/29353/6218/35905, hits/shots 20/34, 37/67, 11/19, 43/86; all four runs ended in a loss. Random-hold bot: score 0 and 0 stations on all four seeds. With near-zero jitter (+-1/+-2 frames) the bot never lost in 15 simulated minutes (80+ stations), so skill is the limit. The same bot clears stations 1-3 on seeds 5 and 9.
- Other tests: no NaN in any state; trace buffers (400 points), sfx queue and lists bounded; lamps always nine whole bytes and take more than 40 distinct values; lamp tests for aim sweep, charge fill and drain, flight spot, hit flash, short/long miss; cancel()/dispose() mid-charge and mid-flight stop the tone and leave lamps at zero; three quick taps plus cancel() leave the run intact; stray taps for 2 minutes launch nothing; physics matches the discrete recurrence exactly; spare probes carry; per-frame draw primitive count under 400.
- Browser: `scripts/dev-shot.cjs` at 1024x600, "no page or host errors" on every run. Shots in `fleet/work/game-ballista/shots/`: ballista-title, -aim, -charge, -peak, -flight, -after1 (station cleared), -miss, -cancel, -failed, -over, -cover, -coverflight, -late (twin targets, ridge, wind arrow), all `.png`. I opened title, charge, peak, after1, tapcancel, miss, over, coverflight and late. A first round showed the range labels colliding with the bottom instrument row and the title text overlapping the target; both fixed and re-shot. The later cover-wall width change (15 to 19) was not re-shot.

## 4. Not done / uncertain
- Not verified on the device: lamp levels, the feel of the 3.4 s sweep and 1.6 s meter, and the sound (tests only record tone calls).
- Difficulty is a bot estimate. Real hands may be noisier than a +-50 ms bot, so station 3 onward could be hard for a newcomer; knobs are `RISE`, `SWEEP` and the radii in `draftStation`.
- A station build can hitch the frame for up to about 0.9 s at the briefing in rare moving-plus-ridge stations.
- Weakest: the cover wall is a spike rather than a cliff; wind streaks are faint; the sky is empty on easy stations; the title has no demo shot.
- Out of scope, noted: shared `banner()` prints a 14 px "PRESS TO BEGIN" (under the 16 px guideline).

## 5. Branch
`worktree-agent-acd00f74124902711`, last commit `d8b9088`.
