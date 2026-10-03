# Vesper 9: an independent review (2026-10-02)

**What was reviewed:** main plus all 14 open draft PRs merged together locally, played in the simulator at 1024x600 (the 7" screen's size). Each game was played by small bots that see the game and press the button with human-like lag (150–250 ms), and each game's source was read. I formed this view before reading any other thread's notes.

**What this is not:** nothing was checked on the Pi, the node or the real lamps. Bots measure fairness and pacing well, but they can't judge feel. Where my scores disagree with Sam's own playtest (Ballista, Orbit Lock), trust the playtest about feel and treat the numbers here as a pointer to *why* a game may stall later.

Screenshots referenced below are in [platform-2026-10-02/](platform-2026-10-02/).

---

## The short version

Vesper 9 has a genuinely good core. Most games turn one button into something expressive. Perihelion's tether, Moonrunner's dive-and-fly, Ricochet's "the paddle never stops", Meridian's pendulum on the lamps and Relay's real rhythms are all ideas worth keeping. There are no crashes, page errors or soft-locks in any of it.

What holds it back is mostly the **platform**, not the games:

1. **Every game plays in about 40% of the screen.**
2. **The timing games ignore input and lamp delay**, which the real device will add.
3. **The same meta (daily order, feats, ranks, a hangar-style upgrade menu) is bolted onto 12 of 14 games**, and it is often bigger than the game.
4. **Fourteen unmerged branches now conflict with each other.**

Fix those four and every game gets better at once.

---

## Platform findings, ranked

### 1. The games are letterboxed into a small box (biggest single win)
- The 960x540 game canvas is fitted into a 949x377 box (`web/style.css:1214`, `object-fit: contain`).
- So the game is drawn at about **670x377, with dark bars at both sides**. That is roughly 40% of the 1024x600 screen ([letterboxed-game.png](platform-2026-10-02/letterboxed-game.png)).
- 18 px game text lands at about 12 px on a 7" panel.
- The header, sensor strip, HUD, description line and footer take the rest.
- **Fix:** in play, collapse the chrome (drop the sensor strip and description line, slim the footer) and give the canvas the screen's own shape, so games can use the full width.
- This also matches the earlier performance finding: render at the screen's real size.

### 2. Timing games don't compensate for latency
- **Relay** judges a tap at the frame it arrives (`relay.js:315`). Its windows are ±50/95/140 ms.
  - With a steady +60 ms delay (plausible for USB, serial and audio), the bot fell from completing a full cycle to dying at Waltz.
  - The result screen already *measures* "53 ms LATE" but never uses that number.
- **Meridian:**
  - Lamp writes are limited to one every 60 ms and wait for an acknowledgement (`engine/lights.js:79`), so the visible lamp trails the game clock by about 50 ms in the simulator, and the node adds its own delay.
  - Tapping on the *visible* light averaged 43 ms late, which cut PERFECTs from 82% to 65%.
- **Orbit Lock** shrinks its window to about ±23 ms (`orbit.js:21`), at the edge of human timing even before any latency.
- **Tideline:** see its section below.
- **Fix:** one console-wide **latency calibration** in Settings (tap along to a beat, store the offset), applied by every timing game. Relay and Meridian matter most.

### 3. The same meta everywhere, and it is too big
- 12 of 14 games each carry their own daily order and feat list, and most add ranks, contracts, upgrades or modules.
- Each hides its own hub behind "hold on the title" (hangar, observatory, songbook, depot, workshop…), stepped one tap per row:
  - Ballista's workshop has 13 rows.
  - Moonrunner's depot has 8 rows.
  - Tideline's log has 32 entries.
- Upgrades in Moonrunner (longer clock) and Ballista (salvage arrives fast) mean **the best score grows with grinding rather than skill**.
- One Orbit Lock run earned 12 of 17 feats and unlocked both extra modes.
- **Fix:**
  - Lift daily orders and feats into one console-level layer, for example a "today's three" panel on the dashboard (already in the ideas list).
  - Let each game keep only the progression that changes how it plays.
  - Cap or separate upgrade-boosted scores.

### 4. The menu gesture collides with natural play
- Tap, tap, then a hold of about 1 s opens the system menu mid-run in **Undertow** (feathering thrust) and **Perihelion** (two quick taps, then a long swing).
- The rewind works, so you lose nothing, but the menu still opening mid-dive breaks flow.
- Cadence has the same risk: two quick laps followed by a hold to stop.
- The other way round, under load the gesture sometimes failed and its taps went into the game.
- **Fix:** while a run is live, require a longer final hold (for example 1.6 s), or require both taps to be very short.

### 5. Merge debt
- Nothing is on main yet, and the 14 drafts now conflict. Merging them in order, I hit conflicts in:
  - `vesper/catalog.json`
  - `web/apps/registry.js`
  - `vesper/server.py`
  - the game lists in three test files
  - `docs/WORKLOG.md`
- **Meridian and Relay can't both go in ARCADE**: a sector holds at most 6 apps (`vesper/catalog.py:67`). I put Relay in MIND to get a build.
- After merging, 2 JS tests fail on the game lists.
- **Fix:** merge now, one at a time, with one owner for the catalog. Every day this waits, the next conflict gets worse.

### 6. Smaller platform polish
- **The system menu on the dashboard** lists both "RETURN TO DASHBOARD" and "DASHBOARD".
- **Footer hints contradict the app:**
  - In Cadence's stopwatch the footer says "TAP NEXT", but a tap takes a lap.
  - On the Stacks shelf it says "TAP: NEXT PAGE".
- **Field Notes** shows `.venv/bin/pip install -e '.[speech]'` to the player ([field-notes-dev-command.png](platform-2026-10-02/field-notes-dev-command.png)).
- **Settings and Node Scope** lists run off the bottom of the panel ([node-scope-cut-off.png](platform-2026-10-02/node-scope-cut-off.png)).
- **Reaching a MIND game** from the dashboard takes about 15 taps and 2 holds. A "Continue" tile would cover most visits.

---

## Game scorecard

| Game | Score | Verdict | The one fix |
|---|---|---|---|
| **Perihelion** | 7 | The best idea here: a real physics toy with a skill ceiling, buried under meta | Put the run goal and notices *inside* the play area; trim the hangar |
| **Meridian** | 7 | The most original; good pacing; the lamps really are the playfield | Compensate lamp latency; make the called-lamp marker visible (it is cyan at 0.08, `meridian.js:637`) |
| **Moonrunner** | 7 | Has flow now; too easy and too upgrade-driven | Make zones IV–VI demand skill; a laggy bot reached The Far Side in all 3 runs |
| **Relay** | 7 | A real rhythm game built on real rhythms; scores inflate | Latency calibration; a 4-beat count-in when you resume |
| **Ballista** | 6.5 | Best first minute; luck outweighs skill | Press near touchdown should never spend a thruster (`ballista.js:32`); show landing pads before launch |
| **Undertow** | 6 | Tight handling; spike at the Trench | Ease the Trench currents in; move the zone banner off the play lane (`undertow.js:991`) |
| **Orbit Lock** | 6 | Clean and readable; skill compresses at about 40 locks | Stop narrowing at about 0.14 rad; fix the clipped result panel ([orbit-result-clipped.png](platform-2026-10-02/orbit-result-clipped.png)) |
| **Ricochet** | 6 | The smartest one-button control; chambers drag | Shorter chambers; a hold should pause without reversing (`ricochet.js:327`) |
| **Echo Vault** | 6 | A good Morse trainer; new letters almost never unlock | Two shifts at 90%+ were still stuck on E T A N ([echo-stalled-at-4-letters.png](platform-2026-10-02/echo-stalled-at-4-letters.png)); credit a letter by session accuracy, not "any single miss cancels it" |
| **Outpost** | 5.5 | Lovely musical tapping; BUY ALL automates the only decision | Taper tap value above about 2 taps a second (tapping faster earned 3x more, a fatigue trap); give purchases real choices |
| **Tideline** | 5.5 | The early game is fixed, but there is a cliff at landing 40, then gear trivialises it | After the assist fades (`tideline.js:56`), a 200 ms reaction player lands only 2–47% of uncommons; full gear lands 100% of everything. Retune with a laggy bot |
| **Glyph Archive** | 5 | Real content on a shallow yes/no loop | The 1.5 s window punishes slow recall, not wrong recall; add "which of two" cards |
| **Light Trial** | 5 (as an instrument: 8) | An honest reaction test with little game | A press 3 s after the cue still counts toward the median; add a timeout |
| **Descent** (on hold) | 4 | The voice throttle is the one place the mic truly helps | Keeping it on hold is right; if revived, start with wide, low pads |

Small bugs worth a line each:
- Moonrunner's fever notice never draws cyan (`runner.js:1341` compares to "FEVER", but the text is "FEVER x2").
- The ground draws in 300 px chunks with visible seams.
- Light Trial's title banner overlaps the discs, and its "LEGACY RECORD RETAINED" line is jargon.
- Meridian colours a swing red on the lamp even when the screen says it's safe.
- Meridian can't really be played in the simulator: the light only shows in the 24 px header circles ([meridian-in-simulator.png](platform-2026-10-02/meridian-in-simulator.png)).

## Tools

- **The Stacks: the strongest one-button tool.** Readable, with auto-turn and Gutenberg fetching.
- **Cadence:** useful.
- **Lantern:** a useful night light, but its action list reorders after a choice, which breaks muscle memory.
- **Atmosphere:** a good read-only dashboard.
- **Oracle:** fun, but every roll is a 0.6 s hold; tap-to-roll would make people reach for it.
- **Resonance:** more novelty than tool; it shows a large empty chart with the mic off.
- **Signal School:** clean, and it shares progress with Echo Vault.

---

## What I'd do next, in order

1. **Merge the drafts** to main one at a time, settling the catalog sectors (Relay or Meridian needs a new home).
2. **Give games the full screen** in play.
3. **Add a latency calibration** in Settings, used by Relay, Meridian, Orbit Lock and Tideline.
4. **Make the menu gesture harder to trigger mid-run.**
5. **Consolidate the meta:** one console-wide daily and feats layer, and slimmer per-game hubs.
6. Then the per-game fixes above, starting with **Tideline's catch tuning** and **Echo Vault's unlock pacing**: these are the two places a normal player hits a wall that skill can't fix.
