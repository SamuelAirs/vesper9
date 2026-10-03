# High Bar: parks, flow and line mastery

The full High Bar refresh was developed on Windows and deployed as Pi trial `60adf7a` on 2026-10-03; physical play acceptance is pending. High Bar keeps the skate/bowl and rigid-bar swing equations and style-v2 score scale. The button pumps, grabs and tucks; release ollies, launches and straightens. A case tap adds optional style. The default tap uses no direction; calibrated side input only biases the manual correction or shove-it animation. Button-only play can still complete sessions, unlock parks and earn skill medals.

## How a line works

Land upright and roll for 1.2 seconds to bank. Ollie, catch another bar or start a manual before that roll ends to link more tricks. A bail loses the current line, keeping already banked score. An end-of-session or overtime cutoff in flight forfeits that unlanded line; it cannot award a free bank.

Each different trick name adds to the multiplier, capped at eight. Repeating a trick earns decreasing base points but does not increase the multiplier. Giants remain worthwhile as part of a line without becoming the whole scoring strategy.

Case taps:
- Ground: start a manual. Its balance drifts; another generic tap corrects toward centre. With sides enabled, left/right bias the correction. The button release pops an ollie out of it. A manual lasting at least 0.6 s earns its trick; five seconds is the maximum before the rider banks normally. Ignoring balance causes a bail.
- Air: one shove-it per flight, completed after at least 0.28 s. It has a broad window but needs a straighter landing (0.56 rad versus the normal 0.8). A short trajectory preview checks the actual floor, rising transitions, walls and vert return; a late tap without enough flight time does not initiate it or tighten the landing tolerance. The fourth lamp shows this same readiness rule.
- Bar: one regrip per catch, giving a small capped swing boost and a trick when released after 0.4 s. It cannot slow an already faster swing. Repeated tapping cannot farm it.

Taps have a 450 ms game cooldown. Nothing depends on exact case-tap timestamps or tap strength; node detection arrives about 100 ms late. All actions remain local and use the app context.

## Parks and modes

The four existing parks and five existing goals retain their original indexes and unlock rule (three goals open the next park). Each park also has three permanent named line challenges involving combinations of flips, transfers, gaps, clean landings and manuals.

SESSION lasts two minutes. LINE RUN names one target and lasts 45 seconds, except the Tower's TOP STYLE and CROSSOVER LINE attempts, which allow 75 seconds for climbing and a safe return. The chosen duration appears in setup, on the title and in the coach. Its separate session best is recorded only when that target was banked. This record uses the full attempt's banked score. The coach shows current-line requirements and says when they are ready to bank; a bail clears that pending progress. Selected gap bars/spans are marked in the world. PRACTICE uses the same mechanics without clock, career goals, line unlocks, medals, bests or console scores, and its result explicitly labels the absence of a career record.

The existing eight-second last-trick overtime also keeps an active manual alive; the rider still has to finish and bank before its cutoff. An unfinished manual is forfeited at that cutoff. OVER THE MOON now spans x=470 through x=1230, centred on the same pipe (760 px, previously 860 px). A Windows control-route audit repeatedly fell short of the older markers; the modest symmetric correction has a recorded banked route while retaining the gap's name, points, saved goal/line indexes and all movement physics. This is an empirical difficulty correction, not proof that every older route was impossible.

The original **session medals** still measure the whole run: bronze requires three banked trick types and one clean landing, silver four types and two clean landings, and gold five types, three clean landings and no bails. Scores alone cannot buy medals.

The refresh adds separate **line mastery** for each of the twelve targets:

- Bronze: bank the target combo.
- Silver: bank the target with at least one clean landing and at least three different trick types (or the target's higher variety requirement).
- Gold: bank the target with two clean landings in that same linked combo, no sketchy landings, and at least four types (or one above the target's variety requirement).

The two gold landings require linking another air before banking, using an ollie or manual. A bail resets the whole pending combo; it cannot contribute clean landings to a later medal. The mastery display sums the twelve medal ranks, up to 36. A strong first completion can earn silver or gold directly. A legacy completed line is kept as completed, without inventing a new clean-landing medal or timing record.

Each target records its best single matching combo. Its fastest time is measured only in a selected LINE RUN from the normal drop-in until the matching bank; full-attempt score remains the separate existing line-best record. Practice gates and later SESSION combos cannot buy a time-trial record. Goals, line completions, mastery upgrades and these new records save when earned at a bank, so leaving or restarting does not erase them. Completed-session scores and counts still require finishing the session.

### Practice and recovery

PRACTICE offers the ordinary drop-in and an authored FLAT SCHOOL start in every unlocked park, clear of an immediate bar catch. A successful bank creates a RAM-only LAST SAFE BANK checkpoint for that park. The system menu can reset there, reset to the chosen start, or toggle normal/half-speed practice. These tools change no career records. Half speed changes simulation time while menu-gesture timing, the case-tap cooldown and feedback lifetimes remain in real time. It teaches the same movement rules, with different numerical step sizes; it is not a recorded time-trial mode.

Returning from pause or an in-run guide gives a short 0.6-second settling interval. Release the button during it; gameplay resumes from the preserved state. Holding through a bail now prepares a ground crouch when the rider recovers, so the next release can ollie instead of being ignored. The camera looks ahead with velocity and eases using elapsed time rather than a fixed per-frame factor.

In setup, button tap advances and a generic case tap moves backward. Calibrated left/right can move backward/forward. A generic case tap after the result screen's brief input lockout retries the same mode; the system menu also offers explicit retry. Case taps never confirm the erase action.

The first launch shows six short teaching pages, including when riding through park/setup selection, with button-tap next and hold to ride. GAME GUIDE can be reopened and returns to the exact paused game/setup rather than restarting. Game-menu actions close the host menu so the chosen guide, restart or result is visible. In play the top coach says what the next button and tap do, marks an available airborne bar catch, reports consumed regrips and unavailable air style, then shows landing or balance safety. All guide/menu choices happen on release.

## Park identity and route reading

Each course has its own authored setting and visual palette: **Canal Commons**
(The Bowl), **Freight Exchange** (The Yard), **Uplink Spire** (The Tower), and
**Lunar Reservoir** (The Night Pipe). Course geometry, existing park IDs, bar
indexes, named gaps and the five legacy goal indexes stay stable. The scenery
is procedural and local; decorative structures are not collision objects.

The twelve lines each have a skill focus, difficulty indicator and a three-step
route brief. These describe a useful approach, not a button sequence that the
player must memorize. Bar numbers and selected gap markers correspond to the
actual physical simulation. Practice and readable route maps teach the course;
mastery still requires landing and banking a real combo.

Authored content/tuning lives in `web/apps/highbar-content.js`; rendering in
`web/apps/highbar-view.js`; physics, input and saved careers in
`web/apps/highbar.js`. This separates future park/art work from input and save
contracts without adding a dependency or asset download.

## Final-node lamps and lifetime

On the four-lamp node:
1. Speed or swing phase.
2. Landing angle safety, or manual balance danger.
3. The variety accumulated in the current line.
4. Availability of the case-tap style action, or manual correction urgency.

Every meaning also appears on screen. A three-lamp compatibility picture remains available. The optional board LED is an amber celebration of a good bank or newly completed challenge, not a fifth play lamp. Pause, cancellation and exit clear it through ctx.board; lamp writes use LampBus and the host light lifetime.

## Save compatibility

Schema 2 preserves all three private schema-1 slots, active slot, park choice, goals, historical bests, best combo and last result. Mode/guide/line/medal/style-best fields and the new lineComboBest, lineTimeBest and lineMedals arrays are independently bounded and defaulted. Old best arrays are retained, while new SESSION records use console score metric style-v2 and slot styleBest. LINE RUN has separate per-line records. Practice writes no career result. Practice pace, start and checkpoint are temporary app state. Persistence passes an immutable snapshot through AppGuard and the host acknowledged save queue; speculative menu-gesture actions are rewound without publishing them. Wait for the host save notice to clear before closing a disconnected browser.

High Bar deliberately remains a private three-slot UI in this wave. Moving these nested saves to the shell's four-slot keys needs a host-owned migration preserving all three saves and active selection; simply enabling saveSlots would not be safe.

## Acceptance and evidence

Windows automated tests cover prior physics, junk and schema-1 migration, slot isolation, no-tap play, generic and optional sides, air/manual/regrip mechanics, challenge banking, repeat scoring, practice isolation, dangerous final-flight cutoff, light/board lifetime and host-confirmed burst menu cancellation at each pace. A real-controls two-minute bot audit checks that banking and progression are achievable without case taps and that style adds risk and variety.

The extended Windows pass ran 2,200 complete two-minute deterministic attempts across all four parks and a targeted release/catch search. `tests/highbar-routes.test.mjs` retains twelve compact button/tap recordings, each replayed from the normal drop-in in SESSION, LINE RUN and PRACTICE. All 36 routes land and bank their target through actual simulation within their selected mode's clock; the current park's goals, rider positions, trick names, gap flags and scores are never injected. Practice replays verify that the same route leaves career data and console scores untouched. The deepest recorded Tower return banks at 78.43 s, within its 75 s clock plus unchanged overtime; the linked Moon route banks at 50.77 s, within 45 s plus overtime. Deterministic controllers establish achievable software routes, not comfortable human timing.

Offline Chrome screenshots at 1024x600 are simulator/layout evidence only. Real button comfort, manual balance cadence, shove-it landing fairness, four-lamp colour readability and case-tap false positives remain owner acceptance on the Pi. No Pi access, live sound/lights, firmware update or physical qualification is claimed.

