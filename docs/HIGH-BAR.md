# High Bar: skate, swing and earn your height

Release `0c1bf13` from `codex/highbar-momentum` is the current Pi trial,
deployed on 2026-10-03 after Sam's physical feedback on `b14db57`. The older
trial and its separate saves remain available for rollback. This revision
removes free swing acceleration, separates grabbing from
flipping, lengthens the web and removes manuals. The skateboarding spider,
quiet play screen, tall parks and sixteen named challenges remain.

## Controls

| Situation | Button | Case tap |
| --- | --- | --- |
| Skating | Hold to push; release to ollie | No action |
| Airborne, near a post | Fresh press and hold to grab | One tap: shove-it |
| Attached to a post | Hold to stay attached; release to let go | One regrip style award, no speed boost |
| Airborne, flipping | Quick press/release, then hold the second press; release to straighten | A second quick case tap upgrades the same shove-it to a kickflip |

The universal system menu still needs **two completed quick button presses,
then a third press held**. A first quick button tap alone never completes a
grab. Catch qualification uses the selected Calibration pace's quick-tap limit
(120/150/220 ms), plus 1 ms; the candidate post is shown immediately. The post
must still be reachable when the held press qualifies. Releasing sooner cancels
it. The second flip press takes priority over a nearby catch. The flip prefix
expires after 320 ms and cannot cross input sources or node generations.
Holding before entering reach does not automatically catch; release and press
again. Pause, cancellation and resume clear transient input intentions.

Generic case taps work by default. Optional calibrated sides only affect style
direction; neither side is required. A second case tap 120–450 ms after the
first upgrades its animation to a kickflip and needs enough remaining flight
to finish. It earns one completed trick, not both awards. Late style taps that
cannot finish are ignored. Manuals and their balance meter are removed.

## Momentum and vertical parks

Skating supplies energy. Held ground drive adds 360 game px/s², with an
820 px/s ground speed cap; ordinary slope pumping still contributes. Holding
a web supplies no drive. Gravity converts height into speed and back, while
drag gradually removes energy. A catch retains the incoming signed tangent;
nearly radial catches receive only a small compliant share bounded by the
incoming speed. Catching never injects mechanical energy or snaps the rider
inward to a shorter radius. Release uses the actual tangent, with no upward
lift, whip multiplier or regrip boost. Safety caps remain 920 px/s and 7 rad/s.

Web reach increases from 190 to 260 game pixels. Holding one post cannot climb
the park indefinitely. Each course now has sparse elevated skate decks
(3/4/5/4 in Bowl/Yard/Tower/Pipe): land, push, then launch toward the next band.
Rising through a deck is allowed; a downward crossing lands on its visible top.
Rolling off its edge retains motion. Collision, landing forecast and style
readiness use the same swept deck contact. Practice checkpoints retain the
actual deck support. The park height is preserved without restoring an aerial
energy source.

Tower's crowded lower posts are spaced outward, and its upper-left launch
post is positioned for a deliberate roll-off and longer web. The layout gives
room to release and press again instead of requiring a one-frame input gap.

The spider pushes, reaches, curls, blinks, scrambles after bails and celebrates
banks. Its eight legs, board and web follow gameplay state. Reduced motion
suppresses optional decoration. The play screen keeps compact controls, one
line readout and one context notice; full maps stay in setup and the guide.
Elevated decks are visible in both world and map views. Release/landing cues
use actual current physics, not an assumed boost or an elapsed-hold timer.

## Banking, challenges and mastery

Land upright and roll for 1.2 seconds to bank. Ollie before that roll ends to
link another air. Bailing loses the pending combo, preserving already banked
score. The last-trick overtime is eight seconds; its cutoff forfeits an
unlanded combo. Ending LINE RUN manually cannot claim an airborne target.

Different trick names increase the multiplier, capped at eight. Each name
earns at most five diminishing awards per combo; it needs a new bank to score
again. Real rotations still count after their repeat points are exhausted.

The four park IDs, original post indexes, five career goals per park and line
IDs stay stable. Three goals unlock the next park. ROLLING LINK now asks for
two linked airs and a shove-it (a kickflip qualifies), replacing its manual
requirement. Upper sky routes are reauthored within the top band: build height
on decks first, then fly the ordered sequence without landing.

| Park / route | Ordered posts | Other requirement | Attempt clock |
| --- | --- | --- | --- |
| Bowl / CANAL SKYLINE | B7 → B9 → B8 | A flip in the same combo | 60 s |
| Yard / FREIGHT SWITCH | B14 → B15 → B13 → B11 | Five trick types | 75 s |
| Tower / CROWN CLIMB | B16 → B17 → B15 → B14 | Six transfers | 75 s |
| Pipe / LUNAR RETURN | B8 → B10 → B9 → B7 | A clean landing | 75 s |

Other linking posts are allowed. Landing resets an incomplete ordered route;
a completed route stays in the linked combo until bank or bail. A selected
post marker and a brief describe the task without adding a permanent map.

SESSION lasts two minutes. LINE RUN ends when its selected target actually
lands and banks. Original line clocks stay 45 seconds, except Tower's TOP
STYLE and CROSSOVER LINE at 75 seconds. The result shows the matching combo,
earned medal, elapsed time and PB improvements. Button tap retries; a generic
case tap advances after a successful target. Explicit menu actions also exist.

Line bronze means bank the target. Silver also needs a clean landing and at
least three trick types (or the target's higher variety). Gold requires two
clean landings in that same linked combo, no sketchy landing, and at least
four types (or one above the target's higher variety). Link another ollie
before the banking roll ends. The sixteen medal ranks sum to 48. Existing
session medals still require variety and clean landings across the whole run.
Goals, lines, medals and PBs save when earned at a bank; completed-session
counts and scores require finishing the session.

PRACTICE changes no career records. Normal drop-in, optional FLAT SCHOOL,
normal/half speed and a RAM-only last-safe-bank checkpoint remain available.
The short optional lesson supplies no pose, catch or reward. Half speed changes
simulation time; gesture and tap cooldowns use real time. Returning from pause
gives a 0.6-second settling interval and clears held actions. Setup supports
button-next and case-previous; guides and settings act on release.

## Lamps, saves and source

The four lamps communicate speed/release direction, landing forecast, combo
variety and case-style readiness. The screen also shows these meanings. The
optional board accent celebrates a bank/challenge and clears on pause,
cancellation and exit. Outputs use `LampBus` and the app context's lifetime.

Schema **5**, score class **flow-v5**, separates records earned under the new
momentum rules. All three private careers, active slot, runs, goals, unlocked
parks, completed lines, medals and last result survive. Current score/combo/time
PBs start fresh; the exact released flow-v4 PBs are archived once under
`legacyRecords.flowV4`. Existing `styleV2` and `flowV3` archives remain bounded
and unchanged. Repeated migration neither duplicates nor resets records.
The service allows 16 KiB for High Bar progress only, enough for all three
careers and three historical epochs; other apps retain their 8 KiB bound.

No personal save was used in tests. A future Pi trial must copy the **latest**
`b14db57` trial data into a new private directory after quiescing writes. Keep
the old source, data and service configuration for rollback. An older release
must never open the schema-5 working save. No firmware change is required.

Content/tuning is in `web/apps/highbar-content.js`, drawing in
`web/apps/highbar-view.js`, and gameplay/persistence in `web/apps/highbar.js`.
See [validation](VALIDATION.md) for the current revision's exact checks and
[worklog](WORKLOG.md) for historical source/deployment evidence. Old flow-v4
route recordings and timings are historical, not proof for this revision.
Windows controls, collision and browser tests do not establish Pi frame rate,
physical acoustic timing or enjoyable human difficulty. Those remain Sam's
playtest, especially the held-catch threshold and finding momentum between decks.

