# Existing-game progression review — 2026-10-03

This pass reviewed the current Moonrunner, Undertow, Ricochet, Echo Vault,
Orbit Lock, Glyph Archive, Relay and Meridian source and focused regressions
on Windows DESKTOP-FD66EV2. It improves Ricochet; it does not claim every game
has received a new design pass or human balancing on the Raspberry Pi.

## Ricochet: practice the room you reached

Ricochet already had increasing chamber difficulty, run upgrades, charge cells,
feats and daily orders. Its save remembered the furthest chamber, but every
new run began in chamber 1. A player trying to learn later hardened or charge
patterns had to repeat the early chambers first. Reaching a new chamber was
only durably recorded after losing the complete run.

The system menu now offers **Ricochet / Practice Chambers**. A normal run in
progress instead shows **End Run and Practice**, which banks that run before
opening the selector. The selector initially highlights the latest chamber
already reached. A short button release advances, a generic case tap goes
back, and a hold-release selects. The selection hold follows Calibration's
hold timing. After the last chamber comes Return to Title.

Practice starts one reached chamber with that room's normal paddle width and
speed, fresh lives and no run upgrades. Existing cell bonuses remain part of
the room. Clear it to finish practice; tap on its result to replay the same
room. Losing also offers a retry of that room. Practice does not change career
scores, lifetime totals, feats, daily completion or unlocks, and does not save
a run. The ordinary tap-to-start run still begins in chamber 1.

New chamber access now saves when reached in an ordinary run, while remaining
under AppGuard's save/gesture contract. Pausing or leaving after a legitimate
new chamber therefore retains access; a canceled menu gesture cannot invent
an unlock. Existing schema 1–3 saves retain their run counts, lifetime totals,
milestones and furthest-room access without a schema change.

## Software evidence

All eight focused game suites plus `game-progression.test.mjs` passed: **219
tests**, including 16 added progression/practice checks. Dedicated practice
selector and live-game checks cover all three gesture paces. Tests also cover
custom selection timing, button-only use, reverse case navigation, single-room
clear/loss/retry, exiting to the title, records retained when ending a normal
run, and deferred-unlock rollback.

A pilot using real `down()/up()/update()` and collision code, the visible
landing bracket and a modeled paddle cleared representative early/middle/late
practice rooms with no run upgrades:

| Chamber | Broken cells | Simulated play time | Remaining lives |
| --- | ---: | ---: | ---: |
| 1 | 18 | 36.53 s | 3 |
| 4 | 24 | 63.28 s | 3 |
| 9 | 30 | 74.87 s | 3 |

These are deterministic game-clock measurements from a software pilot, not
human play time, physical controls, optical timing, or Pi performance.

Moonrunner's actual hill physics were also exercised from unlocked zones 1,
4 and 6 with a seeded pilot. It rode 2,986 / 3,016 / 2,655 metres and landed
37 / 35 / 29 perfect slides. The first two simulations ran for 60 seconds;
the final-zone run ended naturally after 55.02 seconds. This confirms these
representative starts remain traversable; it does not prove all generated
hills or every possible survey order.

## Reviewed games and remaining design limits

| Game | Current progression retained | Remaining work |
| --- | --- | --- |
| Moonrunner | Six zones, three sleds, survey orders, workshop, beacons, zen and daily rides | Human balancing of late orders and all terrain combinations; no new expedition ending added here |
| Undertow | Six zones, craft purchases, twelve sea species, refits and daily dives | Late currents, sonar visibility and craft difficulty need case/display play testing |
| Ricochet | Increasing chambers, run upgrades, charge chains, feats, daily orders; now reached-room practice | More seeds/chamber combinations and novice practice usability need human play testing |
| Echo Vault | Adaptive letter strengths, thirty-transmission shifts and twenty station contacts | No short targeted weak-letter drill added; recognizability and shift length need learner feedback |
| Orbit Lock | Perfect chains/shields, dark gates, earned Rush and Eclipse modes | Tight late timing windows require physical-display/button acceptance |
| Glyph Archive | Four symbol wings, spaced progression, restored plates and later reverse questions | Learning efficacy is not established by game fixtures |
| Relay | Seven rhythm stages, faster cycles, songbook mastery, studio, accelerando and daily play | Musical judgment and physical audio/lamp timing require human acceptance |
| Meridian | Changing swing rules, sequences, constellations, earned modes and guide options | Dark/feint lamp legibility and late timing comfort require real-lamp acceptance |

Windows evidence is retained at
`C:\Users\ayers\vesper9-investigation\polish\games-report.md` and
`games-regression.log`. No firmware build, flash, Pi process, deployment or
service restart was part of this game work.
