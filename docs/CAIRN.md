# CAIRN

An original fixed vertical climb for VESPER's one button. A small four-legged
field pilgrim carries its pack up 30 solid stone shelves to a light at 365 metres.
There are no purchases, stat upgrades, random replacement levels or air steering.
The route, jump law and consequences stay consistent so precision, position,
wall rebounds and recovery become the player's skills.

## Play

- Hold the button, then release to leap in the facing direction. Power increases
  smoothly from a small hop at 180 ms to maximum at 950 ms; further holding keeps
  maximum power. The small bar above the creature and all four lamps show charge.
- A release shorter than 180 ms turns on the ground. The arrow and eyes show
  facing before committing. A generic case tap also turns on the ground; optional
  calibrated left/right labels face that way. Neither input can steer in flight.
- Shelves have solid undersides and sides. Hitting one can spoil a jump. The
  visible side walls return some horizontal speed, permitting deliberate rebounds.
- Tap/tap/hold opens the ordinary system menu. Plain long holds charge normally.
  Pause keeps the exact live position and flight; cancelling a charge never jumps.
- Tap on the title continues. Hold there for at least 650 ms starts from the foot.
  The system menu also offers a new base ascent or return to the last earned cairn.
  After the summit, tap to start another base ascent.

The four sections are **The Rootwork**, **The Hollow Choir**, **The Glass Orchard**
and **The Last Antenna**. Broad early transfers become exposed traverses, side-wall
returns and small upper needles. The camera reveals several ledges above the
player, tracks ascent smoothly and keeps the creature visible during fast falls.
There are no trajectory overlays or constant coaching prompts.

Two cairns are permanent milestones, at **98.5 m** and **211 m**, earned only by
landing on their shelves. A fall can lose many ledges; after falling 22 m below
the current run's cairn, the creature returns to it. Before the first cairn, a
mistake can return all the way to the foot. Starting a fresh base ascent keeps
career milestones but earns that run's fall protection again.

Leaving and reopening the game resumes at the last earned cairn, **not the most
recent ordinary ledge**. This preserves the consequence of a miss across reloads.
The exact live pose survives a menu pause. A hold begun in flight never becomes
a queued jump when landing.

## Records and persistence

`Cairn` is exported by `web/apps/cairn.js`; physics and immutable route data live in
`cairn-content.js`, drawing in `cairn-view.js`. The app uses `AppGuard`, `LampBus`
and the lifetime-owned context for every output. No microphone modes, external
services or firmware changes are involved.

Schema 1 identifies `physicsVersion: "cairn-v1"`. The bounded save contains:

- `runs`, `summits`, permanent `checkpoint` (0–2), and `milestone` for host records.
- `highest`: highest **landed** height in world pixels (10 pixels = 1 metre).
  A new landed personal best calls the default score metric in whole metres.
- `bestSeconds`: fastest uninterrupted ascent that started at the foot. A reload
  or explicit start from a cairn cannot set this record. Menu pauses freeze time.
- `last`: `{ height, seconds, jumps, falls, summit }`, with `height` in **metres**.
- `active`: only the earned cairn's canonical position and bounded elapsed/run
  counts. Velocity, current ledge, charge, button state and time-record eligibility
  are never restored from disk.

CAIRN uses the host's four independent save slots. The host menu can start a
fresh career without replacing the earned cairns in another slot. Selection
survives reload; records in the shared scoreboard remain shared, as in other
games using host slots.

Unknown physics versions lose active position, checkpoint eligibility and timed
records while retaining bounded historical counts/height. Malformed values are
sanitized without passing through arbitrary fields. Accepted landings save during
play; disposal also saves the current run's counts. Cairn/summit awards that happen
during a menu gesture are deferred and rolled back with the whole live state.

## Windows evidence, 2026-10-03

`tests/cairn.test.mjs` has **24 passing focused regressions**. Its recorded route
uses ordinary down/up edges through the actual `InputRouter`, with real fixed-step
physics, from the foot through every shelf and all four sections to the summit.
It writes no pose, checkpoint or completion flag. The 29-leap witness completes in
50.05 simulated seconds with zero falls. Independent continuations from both
cairns also reach the summit through button input. This proves reachability; it
does not measure human difficulty or achieved device frame rate.

Concrete failure witnesses from the same route lose 85 m before landing at the
foot, and about 121 m / 137 m before the first / second cairn catches the fall.
Repeating maximum charge does not complete the route. Sample legal charge windows
at the exact recorded departure positions, measured in 60 Hz frame increments:

| Landing shelf | Legal hold frames | Sampled release times |
| --- | --- | --- |
| 1 | 30–45 | 500–750 ms |
| 6 | 39–48 | 650–800 ms |
| 18 | 38–39 | 633–650 ms |
| 25 / 26 | 39–44 | 650–733 ms |
| 28 | 38–43 | 633–717 ms |

These windows depend on departure position; they are measurements, not automatic
aim assistance or claims that every route must use those exact holds. The narrow
upper transfer is deliberate and still needs physical play assessment.

The focused suite also verifies solid underside/lateral/fast-fall contacts,
no airborne charge inheritance, generic/optional-side turning, all gesture paces,
burst-delivered source timestamps, no ghost release, deferred cairn and summit
awards, no duplicate completion, safe checkpoint resume, bounded malformed saves,
four-lamp ownership and bounded render/particle work. The existing shared gesture
suite's nine Cairn cases pass without state-ignore exceptions.

`tests/cairn-browser.cjs` serves only the source web directory on a temporary
Windows loopback port and opens one disposable Chrome page. It uses normal DOM
keyboard events and deterministic host frames to climb all 29 transfers, render
all four regions and the summit, exercise menu rollback, and reload a browser-local
save from shelf 12 back to cairn 1. It also switches to a fresh host slot,
reloads that selection, then restores the original earned career through the
visible slot picker. It verifies microphone off, no JavaScript
errors, zero 1024×600 document overflow and no charge/velocity on reload.
Screenshots and `journey.json` are outside the repository at
`C:\Users\ayers\vesper9-investigation\cairn\`.

Run the focused test with `node --test tests/cairn.test.mjs`. For the optional
browser journey set `PLAYWRIGHT_PATH`, `TEST_BROWSER_BIN` and an external
`TEST_OUTPUT`, then run `node tests/cairn-browser.cjs`. It requires an available
Playwright installation; it does not build or use the standalone demo artifact.

This is Windows source/simulator evidence. No Pi connection, deployment, firmware
write or physical button/lamp acceptance was performed for this work. Human
difficulty, physical timing comfort and the device's real rendering rate remain
unverified.
