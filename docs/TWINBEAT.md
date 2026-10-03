# TWINBEAT

TWINBEAT is a two-lane rhythm cartridge for VESPER's case taps. Cyan notes descend
on the left; amber notes descend on the right. Strike as a note meets the line.
Eight original synthesized transmissions teach alternation, repeated hands,
rests, subdivisions, mirrored phrases and syncopation before a longer finale.
No songs, samples, external music services or extra hardware are required.

This is a Windows-developed software candidate. No Pi rendering performance,
physical case detection, side accuracy or acoustic timing qualification is
claimed by the deterministic tests or browser simulator.

## Start and controls

The transmission console uses short button release to advance, hold release to
select and a generic case tap to move backward. With optional side mode enabled,
a right case tap advances and a left tap goes backward. The usual **tap, tap,
hold** gesture opens the system menu, including during a chart. A plain long
game hold retains its normal meaning; it never opens the menu by itself.

Choose **START CAMPAIGN** to play the highest unlocked chart, **CHART SELECT /
MEDALS** to replay, or **PRACTICE STUDIO** to study any of the eight charts.
The field manual has two pages, selected with the same button controls.

| Input mode | Play input | Career |
| --- | --- | --- |
| TWO-SIDE | Left case for cyan; right case for amber. J / L simulate those sides. | Independent side unlocks, per-chart bests and medals. |
| RHYTHM ASSIST | Any case tap, K, or the arcade button / Space plays the note shown. | All eight levels remain playable; assist has separate unlocks, bests and medals. |

TWO-SIDE requires the owner's global optional side setting. Open **Calibration >
TAP DIRECTION**, calibrate left/right, then enable **TAP MODE / LEFT / RIGHT**.
The game never changes this setting itself. On real hardware it also checks the
reported ready/available/enabled status. Standalone keyboard events can supply
explicit sides after enabling the global setting. The service-backed Windows
simulator routes J/L through synthesized stereo tap excerpts and its classifier,
so it needs simulated left/right calibration first; browser verification trained
six simulated examples per side. This is software training, not physical
calibration. A fresh save starts TWO-SIDE when available; an explicitly saved
assist preference remains assist.

Back, missing or uncertain side labels earn no directional note. The game says
**SIDE UNSURE / TRY AGAIN** rather than guessing a lane. A button in TWO-SIDE
points to assist and earns no note. Changing the global setting during a side
chart stops that attempt without scoring or saving a result; restore sides or
choose assist and restart.

## Campaign and mastery

Each completed chart yields accuracy and a normalized score from 0 to 10,000.
Accuracy is hits divided by chart notes plus extra/wrong/unsure taps. This
penalizes indiscriminate tapping without charging a second miss for a wrong
lane: a correct retry can still catch that unresolved note.

| Medal | Requirement |
| --- | --- |
| Bronze | At least 75% accuracy; clears the chart and opens the next. |
| Silver | At least 90% accuracy and at least half the chart notes judged CENTER. |
| Gold | 100% accuracy and at least 80% of the chart notes judged CENTER. |

A CENTER note earns 100 points and a caught early/late note earns 70. Each extra
tap subtracts 35 points before the normalized score is clamped. Scores use the
`sides` and `assist` metrics respectively; the catalog's primary record is
TWO-SIDE. Per-chart bests and medals give replay goals beyond the shared maximum.
Practice gives feedback and a result but does not change career saves, run
counts, scores, unlocks or the console logbook daily completion.

| Level | Transmission | Pulse | Focus |
| --- | --- | --- | --- |
| 1 | FIRST CONTACT | 72 BPM | Alternating quarter notes. |
| 2 | DOUBLE SIGNAL | 80 BPM | Repeated hands, then a side change. |
| 3 | QUIET ORBIT | 88 BPM | Rest beats inside a phrase. |
| 4 | SPLIT PULSE | 72 BPM | Eighth-note subdivisions. |
| 5 | MIRROR ARRAY | 70 BPM | Mirrored repeated-hand phrases. |
| 6 | OFFWORLD | 72 BPM | Between-beat entries. |
| 7 | LONG TRANSMISSION | 74 BPM | Longer alternating passages with rests. |
| 8 | TWIN SUNS | 75 BPM | Mixed phrases over eight bars. |

Later levels lower the quarter-note pulse while adding subdivisions. Every
adjacent note across both lanes remains at least 400 ms apart. There are no
simultaneous chords, sustained note requirements or detector-speed rolls.

## Timing, audio and lamps

The accepted window is provisionally ±180 ms, with CENTER at ±80 ms. The game
judges in its own paused browser simulation clock, using event arrival. Node
`at_us` values are used only as bounded duplicate identities, never subtracted
from song or browser time. A given event can credit one unresolved note at most.

**CASE DELAY ESTIMATE** offers 0/50/100/150/200 ms, initially 100 ms. It corrects
only native `source: node` case arrivals; this is a provisional detector
allowance, not an acoustic measurement. Keyboard/simulator case taps have no
acoustic correction. Assist button input uses the console's separate timing
offset. Miss retirement includes the same delay allowance, so a corrected late
case arrival can still be caught. Physical latency and speaker-induced false
taps need observation in the finished case, including calibration for the
player's posture.

The soundtrack is synthesized in bounded short envelopes. All emitted tones
are at least 196 Hz, above the host's below-140-Hz knock suppression boundary.
Expired scheduled notes are skipped rather than replayed in a burst. This
avoids knowingly disabling taps with a bass soundtrack; it does not establish
that the actual speaker cannot trigger the physical acoustic detector.

Four lamps form two independent pairs: lamps 1/2 cyan for LEFT, lamps 3/4 amber
for RIGHT. The optional board LED marks the downbeat. With three lamps, the
outer lamps carry left/right and the middle gives a dim shared accent. None of
these cues replace the visible lanes. Cancel, pause and exit clear all lamps
and the board LED. Pause freezes the chart; resume gives two count-in beats
while the chart stays frozen, then continues the same unresolved notes.

## Save and implementation contract

`Twinbeat` is the registered factory in `web/apps/twinbeat.js`. It uses the
existing app context and `AppGuard`, owns no worker or timer, and uses no device
command directly. It supports the host's four save slots through
`static saveSlots = true` and a bounded `slotSummary()`.

Version-one progress contains `mode`, `caseOffsetMs`, `runs`, `milestone`, a
bounded `last` result and `careers.assist` / `careers.sides`. Each career is
exactly eight records containing `cleared`, `best`, `accuracy`, `medal` and
`runs`. Sanitization rejects invalid values and detached late-level unlocks.
The save remains below the service's 8 KiB limit. Active charts are not resume
saves: an interrupted attempt can restart, while accepted finished charts save
their outcomes immediately through the gesture guard. Settings are read-only.

For tests/browser inspection: `phase` is `home`, `songs`, `guide`, `play` or
`result`; `cursor` selects a row returned by `rows()`; `mode` is `assist` or
`sides`; `level` is zero-based; `practice` marks the studio. `songTime` is seconds
with a negative four-beat initial count-in. `chart.notes` entries contain
`at`, `side`, `accent` and `beat`. `judgements` contains null, `center`, `close`
or `miss`. `stats` contains hits, center, misses, faults, combo, maxCombo and
points. `output.resumeLeft` holds the separate resume countdown. `start(level,
practice)` checks locks and availability; normal user entry goes through the
canvas menu.

## Software verification and remaining acceptance

`tests/twinbeat.test.mjs` has 33 passing focused tests on native Windows Node
24.21.0. They cover all eight charts through actual side, generic and button
input; all eight native-arrival charts with a 100 ms provisional delay; timing
boundaries, full first-note early window, delayed miss retirement, wrong and
uncertain labels, duplicate/refractory input, independent persistence, medals,
practice isolation, owned output cleanup, count-in recovery and audio bounds.
Six real `InputRouter` scenarios perform quick/standard/relaxed menu gestures
during active play and across a finished chart, checking rollback, deferred
saves and consumed terminal releases. Additional tests cover system-menu
actions and drawing all screens.

Root integration records generated-catalog/demo, full-suite and real-browser
evidence in `docs/WORKLOG.md` / `docs/VALIDATION.md`. Those checks remain software
evidence. Before promoting a candidate, check acoustic classification and
speaker false taps, repeated-hand comfort at the 400 ms spacing, timing
fairness, pause recovery, lamps 1–4 and the board accent on the actual Pi/node.
Assistance remains available if side labels are unreliable.
