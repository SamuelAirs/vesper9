# Perihelion v0.2.0 review: hangar, regions, Binaries and the Beat

Reviewed `main` at c741cca (`web/apps/perihelion.js`, `tests/perihelion.test.mjs`, `docs/OPERATOR.md`, fleet report `depth-perihelion.md`). Nothing was changed in the repo. Simulations used the test file's own planning bot ("sharp") and the same bot with ±0.1 s release error ("sloppy", a stand-in for a decent human), 4 seeds each. Nothing here was played on the device.

## Swing feel: unchanged for the Standard probe

I diffed the core against the pre-journey version (a7b902d). Constants, `stepProbe`, `pickTarget`, `engage`, `detach`, the stray-tap blend, chain and multiplier rules and `frontSpeed` are the same maths. With the Standard probe and a non-moving sun, `place()` returns zero sun velocity and `p.g` is 240, so the swing reduces exactly to the old code. The Approach's world generation calls the RNG in the same order (the digest test pins it). The differences you would notice are:

- **Restart is now decided on release.** On the title and result screens a tap launches when you let go, and a press of 0.5 s or more opens the hangar. Before, the press itself launched. A quick restart is a beat later, and a habit of pressing and holding to restart now opens the hangar.
- **New sound in every swing.** A note plays at the bottom of each pass, and a fifth rings on a clean release. The physics is the same, but the game sounds different.

## Issues found

1. **The bot test fails on `main` here.** "a planning bot crosses every region…" fails on seed 3003: the perfect-play bot falls in the Dark Field at 148 s. It fails at the branch's own commit (2c51a72) too, on Node 22.22. The report says all three seeds arrived, so the result probably depends on the environment: the physics is chaotic and small floating-point differences change the run. It is also a sign that the Dark Field is a difficulty wall (see 4). Worth checking `node --test tests/perihelion.test.mjs` on the Pi.
2. **In the Cluster, a relic is invisible on the lamps.** The Cluster's flight colour is `LAMP.white`. A relic ahead is a white pulse on one lamp, a collected relic is a white sweep and a catch is a white flash. Relics first appear in the Cluster, so their only lamp cue matches the background there.
3. **Feats unlock too fast for the hangar to last.** On a fresh save, one good run (sharp bot, 200–220 s) earns 9 to 11 of the 16 feats. That unlocks both probes (at 4 and 8) and most trails in the first or second run. SHORT CUT is free: the bot crosses the Cluster in 10 to 16 catches against a goal of 16. THE EYE is hidden but comes up on its own in the Dark Field. After that run there is little left to chase.
4. **The Dark Field is a cliff.** Sloppy-bot survival when starting in each region (Standard probe) was Approach 1/4, Cluster 3/4, Binaries 1/4, Nebula 1/4 and Dark Field 0/4. The Dark Field deaths came at 2–36 s. Every sun there has a dark body (45 % have two), and the clearance is 62 px against 70 px elsewhere. All of this starts at full strength at the region's first sun.
5. **Starting at The Beat makes the arrival cheap.** From region VI the arrival is 5,500 px away. The sharp bot arrived on every seed in 33–51 s. Each arrival earns the PERIHELION feat, adds to the ARRIVALS count and pays the +400 bonus. The terminator also starts slow on a late start, because its speed depends on run time.
6. **The Beat has no beat.** Each pulsing sun has its own random period (2.2–3.2 s) and phase, so there is no shared rhythm to learn. The only thing to do is wait for each sun to light. Once tethered, a sun going dark changes nothing.
7. **Lifetime feats count the last run twice.** In `finish()`, `sv.st.relics += R.relics` runs before `checkFeats()`, and `life()` adds `R.relics` again. ARCHIVIST (25 relics) can unlock at 23 real relics, and the result card's CLOSEST line and the hangar's feat progress show inflated totals. ON THE DAY has the same double count but is harmless at n = 1.
8. **Leaving the hangar is slow.** It opens with the cursor on PROBE, and there is no back. Launching takes 6 taps to reach LAUNCH, then a hold. Cycling START through six regions takes six holds.
9. **Binaries: a dark body can sit in a sun's orbit.** `addVoid` measures clearance from the pair's centre (`r + 70`), but the suns orbit 40–55 px from it. A sun can pass within about 15 px of a dark body's edge, and so can the probe swinging from it. Ballast and Wisp often die by "LOST ABOVE THE FIELD" here, because the release carries up to about 70 px/s of the sun's velocity.
10. **Ballast plays backwards and is the hardest probe.** "Heavy" is implemented as 0.8× gravity. Low gravity makes high arcs, so the sloppy Ballast often dies off the top (6 of 24 sloppy runs). Wisp (1.25×) was the most forgiving probe for the sloppy bot in regions I and II. The probes are meant to be options, not power, but in practice they rank by difficulty.

Smaller points: a feat's name, a region's name and a hint all use the one notice line and overwrite each other. The hangar's FEATS page shows the last run's per-run progress (for example "MAGPIE 2 / 3") without saying so. Yellow (Beat) versus amber (danger) and the 2.8 s banner were already flagged in the fleet report.

## Proposed tweaks (nothing applied)

Fixes (small and safe; the swing is not touched):
- **A.** Fix the double count (7): check feats before folding the run into `sv.st`, or make `life()` read only `sv.st` after `finish`.
- **B.** Give the Cluster a lamp colour that is not white (for example pale cyan-green or soft pink), so the white relic and catch cues read against it (2).
- **C.** Clear dark bodies from a binary's whole orbit: measure clearance as `R + r + 70` from the pair's centre (9).
- **D.** Make the bot test robust: assert that 2 of 3 seeds arrive, or pick seeds that arrive on both Node versions. Record the Pi's Node version in WORKLOG (1).

Depth and replayability:
- **E. A real beat.** Give each run one tempo for The Beat (say 0.8–1.0 s per beat). Pulsing suns light on alternate beats and the lamps tick with them. A catch on the beat counts +1 chain or rings the region motif. This turns VI into a rhythm section, which suits the game's swing-sings sound.
- **F. Ramp the Dark Field.** Dark-body chance from 0.6 up to 1.0 and double bodies from 0.2 up to 0.45 across the region, with clearance staying at 70 for the first third (4).
- **G. Feat tiers.** Raise the probe unlocks (Ballast at 6, Wisp at 10) and add a late tier that cannot be earned in a first run: arrive with each probe, a chain of 25, arrive under 3:30, 10 relics in one run, a 3-day daily streak. Tighten SHORT CUT to 10 catches (3).
- **H. Arrival only counts from the Approach.** Starting later still plays the region, but no PERIHELION feat, arrival count or +400 bonus. Alternatively, the terminator's run-time clock starts at the region's usual arrival time (5).
- **I. Relics worth the detour.** 25 × multiplier is about 2.5 s of flying. Make it 60 × multiplier, or have a relic add +1 to the chain, so leaving the safe line is a real choice.
- **J. Faster hangar.** Open it with the cursor on LAUNCH and add BACK as the last row. Alternatively, a press held about 1.5 s on any row launches with the current setup (8).
- **K. Fix the Ballast name or its physics.** Either call it "Drifter" (light gravity, high arcs) or make it heavy (more gravity) and give Wisp the low gravity, so the name matches the feel (10).

Suggested order: A–D first, as one small PR with tests, then E and F (the most gameplay value), then G–K.
