# High Bar: parks, flow and line mastery

The first High Bar refresh was deployed as Pi trial `60adf7a` on 2026-10-03. Sam's playtest found too much visual clutter, difficult acceleration and too little vertical flow. Windows candidate `aab8aa0` introduced a skateboarding spider, stronger ground and swing drive, taller connected parks and a quieter play screen. The current `codex/highbar-mastery` pass gives those upper parks authored aerial routes and more mastery goals, improves challenge completion, and fixes scoring and camera problems. Sam's direction is depth and expressive play; practice guidance remains optional and secondary. Neither follow-up has replaced the Pi trial.

The button pumps, grabs and tucks; release ollies, launches and straightens. A case tap adds optional style. The default tap uses no direction; calibrated side input only biases the manual correction or shove-it animation. Button-only play can still complete sessions, unlock parks and earn skill medals. Sam confirmed catches already feel easy: catch reach, press timing, pending-catch cancellation and regrab delay are unchanged. Holding before a post approaches does not automatically catch it.

## Speed, height and the spider

Holding on the ground now adds an active kick, including on flat concrete, beyond the old automatic cruising speed. Slope pumping still contributes. Holding a post pumps the swing; a committed release adds upward leg drive. Tangential speed and angular speed are bounded so catching very close to a post cannot become an unreadably fast orbit. Gravity, tuck/straightening, landing tolerances and the 1.2-second banking rule remain unchanged.

The swing cue distinguishes building energy, rising launch, horizontal travel
and a downward release using the actual launch velocity, including the upward
drive and speed cap. Its arrow shows departure direction. Lamp I uses the same
decision. The landing cue forecasts what happens if the rider releases now;
holding the tuck a little longer can trigger an urgent straighten cue. The
bounded forecast includes wall rebounds, changing slopes and vert returns,
uses the practice pace, and supplies no input. It assumes no later catch or
new input. Lamp II shares that forecast. A successful clean or sketchy landing
then gets brief feedback in the existing context notice.

The eight-legged rider pushes with its rear legs, reaches toward a caught post, curls into flips, blinks, scrambles after a bail and celebrates a bank. These procedural Canvas animations read gameplay state without altering it. Park silhouettes are quieter; the persistent minimap, large coach and floating trick bursts are replaced by compact controls, a line readout and at most one context notice. One post receives the catch/next marker. Full maps and route briefs remain in setup and the guide.

Tuning: held ground drive adds 360 px/s² times slope cosine; ground speed remains capped at 820 px/s. Held swings add 390 tangential px/s², bounded at 920 px/s and 7 rad/s. A release after 0.35 seconds of swinging subtracts 280 px/s from vertical velocity, with the resulting launch capped at 920 px/s. These are game units, not physical hardware measurements.

## How a line works

Land upright and roll for 1.2 seconds to bank. Ollie, catch another bar or start a manual before that roll ends to link more tricks. A bail loses the current line, keeping already banked score. An end-of-session or overtime cutoff in flight forfeits that unlanded line; it cannot award a free bank.

Each different trick name adds to the multiplier, capped at eight. Each name earns at most five diminishing awards per combo; it then needs a new bank before it can score again. Real giant counts still track the performed rotations. The bounded trick history retains distinct names, so a long swing cannot fill it and prevent a later flip or swing from counting. Giants remain worthwhile as part of a varied line.

Case taps:
- Ground: start a manual. Its balance drifts; another generic tap corrects toward centre. With sides enabled, left/right bias the correction. The button release pops an ollie out of it. A manual lasting at least 0.6 s earns its trick; five seconds is the maximum before the rider banks normally. Ignoring balance causes a bail.
- Air: one shove-it per flight, completed after at least 0.28 s. It has a broad window but needs a straighter landing (0.56 rad versus the normal 0.8). A short trajectory preview checks the actual floor, rising transitions, walls and vert return; a late tap without enough flight time does not initiate it or tighten the landing tolerance. The fourth lamp shows this same readiness rule.
- Bar: one regrip per catch, giving a small capped swing boost and a trick when released after 0.4 s. It cannot slow an already faster swing. Repeated tapping cannot farm it.

Taps have a 450 ms game cooldown. Nothing depends on exact case-tap timestamps or tap strength; node detection arrives about 100 ms late. All actions remain local and use the app context.

## Parks and modes

The four existing parks and five existing goals retain their original indexes and unlock rule (three goals open the next park). Each park has four permanent named line challenges involving combinations of flips, transfers, gaps, clean landings and manuals. The fourth is an upper sky route:

| Park / route | Airborne sequence | Additional bank requirement |
| --- | --- | --- |
| Bowl / CANAL SKYLINE | B4 → B7 → B9 | A flip in the same combo; 60-second attempt |
| Yard / FREIGHT SWITCH | B8 → B15 → B12 → B11 | Five different trick types; 75-second attempt |
| Tower / CROWN CLIMB | B12 → B14 → B15 → B17 | Six transfers in the combo; 75-second attempt |
| Pipe / LUNAR RETURN | B4 → B5 → B8 → B10 | A clean landing; 75-second attempt |

Catch those posts in order without landing; other linking posts are allowed.
An unfinished sequence resets on landing. A completed sequence earns a named
gap worth 1,200–2,000 base points and stays in the pending combo while the rider
links another air for gold. A bail loses it. Banking clears the sequence for a
new attempt. The selected next post is marked without adding a persistent map.
These routes use the existing taller geometry and unchanged catch/physics rules.

SESSION lasts two minutes. LINE RUN names one target and allows 45 seconds for the original lines, except the Tower's TOP STYLE and CROSSOVER LINE attempts, which allow 75 seconds. The new sky routes use the clocks above. The attempt ends when its target combo lands and completes the roll to bank. Earlier unrelated banks do not finish it. Manually ending a line attempt cannot skip the banking roll or claim an airborne combo. The result preserves the actual matching combo, earned medal, elapsed time and PB improvements; a later small combo cannot replace the celebration. Button tap retries the same target; a generic case tap advances to the next line in that park after the result lockout. The system menu also offers explicit retry and next-line actions.

The duration appears in setup and on the title. The separate full-attempt score record is written only when the selected target was banked; its single-combo and time PBs remain distinct. The compact route notice names one missing requirement or the next mastery tier to pursue before banking; a bail clears pending progress. Selected gap bars/spans are marked in the world. PRACTICE uses the same mechanics without clock, career goals, line unlocks, medals, bests or console scores, and its result explicitly labels the absence of a career record.

The existing eight-second last-trick overtime also keeps an active manual alive; the rider still has to finish and bank before its cutoff. An unfinished manual is forfeited at that cutoff. OVER THE MOON retains the first refresh's x=470 through x=1230 span, centred on the pipe. Current recorded routes finish every target within its ordinary clock, without needing overtime.

The original **session medals** still measure the whole run: bronze requires three banked trick types and one clean landing, silver four types and two clean landings, and gold five types, three clean landings and no bails. Scores alone cannot buy medals.

There is separate **line mastery** for each of the sixteen targets:

- Bronze: bank the target combo.
- Silver: bank the target with at least one clean landing and at least three different trick types (or the target's higher variety requirement).
- Gold: bank the target with two clean landings in that same linked combo, no sketchy landings, and at least four types (or one above the target's variety requirement).

The two gold landings require linking another air before banking, using an ollie or manual. A bail resets the whole pending combo; it cannot contribute clean landings to a later medal. The mastery display sums the sixteen medal ranks, up to 48. A strong first completion can earn silver or gold directly. A legacy completed line is kept as completed, without inventing a new clean-landing medal or timing record.

Each target records its best single matching combo. Its fastest time is measured only in a selected LINE RUN from the normal drop-in until the matching bank; full-attempt score remains the separate existing line-best record. Practice gates and later SESSION combos cannot buy a time-trial record. Goals, line completions, mastery upgrades and these new records save when earned at a bank, so leaving or restarting does not erase them. Completed-session scores and counts still require finishing the session.

### Practice and recovery

PRACTICE offers the ordinary drop-in and an authored FLAT SCHOOL start in every unlocked park, clear of an immediate bar catch. A successful bank creates a RAM-only LAST SAFE BANK checkpoint for that park. The system menu can reset there, reset to the chosen start, or toggle normal/half-speed practice. These tools change no career records. Half speed changes simulation time while menu-gesture timing, the case-tap cooldown and feedback lifetimes remain in real time. It teaches the same movement rules, with different numerical step sizes; it is not a recorded time-trial mode.

FLAT SCHOOL now teaches by riding: build speed, release an ollie, land clean
and bank, then catch a post and bank a swing. One short contextual instruction
follows actual movement and bank events; it never injects a catch, position or
reward. The lesson is temporary and restarts with that practice start. A
system-menu shortcut opens it directly; choosing it during a run explicitly
restarts in Flat School. Learning changes no career save or selected career mode.

Returning from pause or an in-run guide gives a short 0.6-second settling interval. Release the button during it; gameplay resumes from the preserved state. Holding through a bail prepares a ground crouch when the rider recovers, so the next release can ollie instead of being ignored. The camera looks ahead with velocity and eases using elapsed time. A side margin keeps the whole rotated spider visible during fast wall rebounds; it changes framing, not park collisions.

In setup, button tap advances and a generic case tap moves backward. Calibrated left/right can move backward/forward. After a successful LINE RUN, a generic case tap advances to the next target; on other results it retries the same mode. The system menu also offers explicit retry. Case taps never confirm the erase action.

The first launch shows six short teaching pages, including when riding through park/setup selection, with button-tap next and hold to ride. GAME GUIDE can be reopened and returns to the exact paused game/setup rather than restarting. Game-menu actions close the host menu so the chosen guide, restart or result is visible. In play the compact top strip says what the next button and tap do and shows landing or balance safety. A single world marker distinguishes a reachable catch from the next post. All guide/menu choices happen on release.

## Park identity and route reading

Each course has its own authored setting and visual palette: **Canal Commons**
(The Bowl), **Freight Exchange** (The Yard), **Uplink Spire** (The Tower), and
**Lunar Reservoir** (The Night Pipe). Their vertical spans grow by 950, 1,050,
700 and 1,000 game pixels respectively. The parks now have 9, 15, 17 and 12
posts, including open upper ladders and two new Pipe entry posts. Original
geometry is translated vertically and upper routes are appended. Park IDs,
original bar indexes, named gaps and the five legacy goal indexes stay stable.
Tower's named TOP RUNG (B12) and Pipe's SUMMIT (B4) remain challenge milestones;
new sky posts rise above them. The camera follows higher launches. Scenery is
procedural and local; decorative structures are not collision objects.

The sixteen lines each have a skill focus, difficulty indicator and a three-step
route brief. These describe a useful approach, not a button sequence that the
player must memorize. Bar numbers and selected gap markers correspond to the
actual physical simulation. Practice and readable route maps teach the course;
mastery still requires landing and banking a real combo.

The spider's swing thread meets its rotated reaching legs, and its eyes and
kick follow actual travel direction. The existing reduced-motion setting
suppresses optional blinking, waving and trails while retaining readable play
poses. The dashboard icon now depicts the same skateboard-and-spider identity.

Authored content/tuning lives in `web/apps/highbar-content.js`; rendering in
`web/apps/highbar-view.js`; physics, input and saved careers in
`web/apps/highbar.js`. This separates future park/art work from input and save
contracts without adding a dependency or asset download.

## Final-node lamps and lifetime

On the four-lamp node:
1. Speed or actual launch direction/height phase.
2. The release-now landing forecast, or manual balance danger.
3. The variety accumulated in the current line.
4. Availability of the case-tap style action, or manual correction urgency.

Every meaning also appears on screen. A three-lamp compatibility picture remains available. The optional board LED is an amber celebration of a good bank or newly completed challenge, not a fifth play lamp. Pause, cancellation and exit clear it through ctx.board; lamp writes use LampBus and the host light lifetime.

## Save compatibility

Schema 4 preserves all three private careers, active slot, park choice, goals, unlocked lines, skill medals, run counts and last result. Old line indexes stay fixed; the new fourth column starts empty. New SESSION scores use console metric `flow-v4` and slot `flowBest`, separating the new sky bonuses and repeat-scoring rules. Old `best` and `styleBest` remain intact. Previous best combo and per-line score/combo/time records are preserved once under bounded `legacyRecords.styleV2` and, when present, `legacyRecords.flowV3`; the corresponding current PBs start fresh. Loading again does not reset them or duplicate archives. Direct migration from style-v2 creates no fictional flow-v3 history. The title labels the nearest previous score epoch separately. A maximal three-career save with both full historical archives is tested against the service's 8 KiB JSON limit.

LINE RUN retains separate per-line records. Practice writes no career result. Practice pace, start and checkpoint are temporary app state. Persistence passes an immutable snapshot through AppGuard and the host acknowledged save queue; speculative menu-gesture actions are rewound without publishing them. Wait for the host save notice to clear before closing a disconnected browser. When staging this revision on the Pi, copy the latest trial saves into a new private data directory and retain the older trial intact; an older release should not be pointed at a migrated save.

High Bar deliberately remains a private three-slot UI in this wave. Moving these nested saves to the shell's four-slot keys needs a host-owned migration preserving all three saves and active selection; simply enabling saveSlots would not be safe.

## Acceptance and evidence

Windows automated tests cover junk and schema-1/2 migration, slot isolation, no-tap play, generic and optional sides, air/manual/regrip mechanics, challenge banking, repeat scoring, practice isolation, dangerous final-flight cutoff, light/board lifetime and host-confirmed burst menu cancellation at each pace. A real-controls two-minute bot audit checks that banking and progression remain achievable without case taps. A paired landing test verifies that adding an accepted shove-it still requires a straighter landing.

`tests/helpers/highbar-flow-routes.mjs` contains sixteen button/tap recordings replayed by `tests/highbar-routes.test.mjs` in SESSION, LINE RUN and PRACTICE. All 48 combinations land and bank their target from the normal drop-in within the selected clock; rider positions, trick names, gap flags and scores are never injected. Four further gold recordings each link multiple clean landings in the same combo and pass in all three modes (12 more route/mode combinations). The four sky golds bank in 20.68, 24.32, 21.55 and 23.73 seconds. Practice replays leave career data and console scores untouched. A separate linked Bowl route earns the original three golds. Earlier style-v2 searches and timings in the worklog are historical evidence for the previous release.

Twelve additional independent tests cover useful acceleration in every flat start, unchanged press-to-catch behavior, short-radius swing bounds, save limits and gesture rewind. Four actual-input recordings each sustain at least eight seconds of free flight across multiple catches and flips, then land and bank that same chain without a bail. A non-predictive feedback pilot using 100–200 ms old observations fails its selected policies; perfect-state recordings establish reachability, not comfortable human reaction windows. Keep physical feedback authoritative, especially for fast swing release and long descents.

Windows Chrome screenshots at 1024x600 and 960x540 are simulator/layout evidence only. Real button comfort, manual balance cadence, shove-it landing fairness, four-lamp colour readability and case-tap false positives remain owner acceptance on the Pi. This follow-up performs no Pi access, live sound/lights, firmware update or physical qualification. See [validation](VALIDATION.md) for current results and [the worklog](WORKLOG.md) for source and deployment history.

