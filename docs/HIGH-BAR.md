# High Bar: lines, style and replay

High Bar keeps the original skate/bowl and rigid-bar swing physics. The button pumps, grabs and tucks; release ollies, launches and straightens. A case tap adds optional style. The default tap uses no direction; calibrated side input only biases the manual correction or shove-it animation. Button-only play can still complete sessions, unlock parks and earn skill medals.

## How a line works

Land upright and roll for 1.2 seconds to bank. Ollie, catch another bar or start a manual before that roll ends to link more tricks. A bail loses the current line, keeping already banked score. An end-of-session or overtime cutoff in flight forfeits that unlanded line; it cannot award a free bank.

Each different trick name adds to the multiplier, capped at eight. Repeating a trick earns decreasing base points but does not increase the multiplier. Giants remain worthwhile as part of a line without becoming the whole scoring strategy.

Case taps:
- Ground: start a manual. Its balance drifts; another generic tap corrects toward centre. With sides enabled, left/right bias the correction. The button release pops an ollie out of it. A manual lasting at least 0.6 s earns its trick; five seconds is the maximum before the rider banks normally. Ignoring balance causes a bail.
- Air: one shove-it per flight, completed after at least 0.28 s. It has a broad window but needs a straighter landing (0.56 rad versus the normal 0.8). A late tap near landing does not initiate it.
- Bar: one regrip per catch, giving a small capped swing boost and a trick when released after 0.4 s. It cannot slow an already faster swing. Repeated tapping cannot farm it.

Taps have a 450 ms game cooldown. Nothing depends on exact case-tap timestamps or tap strength; node detection arrives about 100 ms late. All actions remain local and use the app context.

## Parks and modes

The four existing parks and five existing goals retain their original indexes and unlock rule (three goals open the next park). Each park also has three permanent named line challenges involving combinations of flips, transfers, gaps, clean landings and manuals.

SESSION lasts two minutes. LINE RUN lasts 45 seconds and names one target; its separate best is recorded only when that target was banked. Selected gap bars/spans are marked in the world. PRACTICE uses the same mechanics without clock, career goals, line unlocks, medals, bests or console scores.

Bronze requires three banked trick types and one clean landing. Silver requires four types and two clean landings. Gold requires five types, three clean landings and no bails in the session. Scores alone cannot buy medals.

The first launch shows six short teaching pages, with button-tap next and hold to ride. GAME GUIDE can be reopened and returns to the exact paused game/setup rather than restarting. In play the top coach says what the next button and tap do, then shows landing or balance safety. All guide/menu choices happen on release.

## Final-node lamps and lifetime

On the four-lamp node:
1. Speed or swing phase.
2. Landing angle safety, or manual balance danger.
3. The variety accumulated in the current line.
4. Availability of the case-tap style action, or manual correction urgency.

Every meaning also appears on screen. A three-lamp compatibility picture remains available. The optional board LED is an amber celebration of a good bank or newly completed challenge, not a fifth play lamp. Pause, cancellation and exit clear it through ctx.board; lamp writes use LampBus and the host light lifetime.

## Save compatibility

Schema 2 preserves all three private schema-1 slots, active slot, park choice, goals, historical bests, best combo and last result. New mode/guide/line/medal/style-best fields are independently bounded and defaulted. Old best arrays are retained, while new SESSION records use console score metric style-v2 and slot styleBest. LINE RUN has separate per-line records. Practice writes no career result.

High Bar deliberately remains a private three-slot UI in this wave. Moving these nested saves to the shell's four-slot keys needs a host-owned migration preserving all three saves and active selection; simply enabling saveSlots would not be safe.

## Acceptance and evidence

Windows automated tests cover prior physics, junk and schema-1 migration, slot isolation, no-tap play, generic and optional sides, air/manual/regrip mechanics, challenge banking, repeat scoring, practice isolation, dangerous final-flight cutoff, light/board lifetime and host-confirmed burst menu cancellation at each pace. A real-controls two-minute bot audit checks that banking and progression are achievable without case taps and that style adds risk and variety.

Offline Chrome screenshots at 1024x600 are simulator/layout evidence only. Real button comfort, manual balance cadence, shove-it landing fairness, four-lamp colour readability and case-tap false positives remain owner acceptance on the Pi. No Pi access, live sound/lights, firmware update or physical qualification is claimed.

