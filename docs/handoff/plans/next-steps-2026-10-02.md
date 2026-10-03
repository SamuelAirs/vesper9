# Vesper 9: next steps (2 Oct 2026)

I polled all 20 working threads at 19:46 UTC. Every one is idle. Nothing is running, and nothing new starts until you OK it. All 18 drafts pass their tests except one Perihelion bot test that also fails on main (PR #1 fixes it). Nothing is merged except the Pages publish (#13), and you haven't tried any of it on the console yet.

The console on the Pi already runs every draft together, on the new node. Three-lamp games show left on lamp 1, middle on lamps 2 and 3 together, and right on lamp 4. So you can test everything now, before the case is finished.

## The order

1. **Now: a few decisions** (list below). They let the cloud threads do groundwork while you test, without changing any game you're testing.
2. **You playtest the current drafts.** The case doesn't need to be finished. Outpost first.
3. **When the case is final: one tap sitting** in "Run Vesper on the Pi", about 10 minutes.
4. **Merge what passed**, in order: dashboard #11, platform #16, Perihelion #1, knock #4, the new-node PR, then each game you OK'd. Tideline #8 goes before the Outpost stack (#15, then #17 and #18), because Outpost is built on it.
5. **Tap direction lands.** A classifier built from your tap data, then menus and games can use left / right / top.
6. **Four-lamp pass, one game at a time**, done together with each game's playtest fixes so each game is reworked once. ChatGPT's games get integrated in the same pass, so their lamp code is fixed once too.

What runs in the cloud while you test (only with your OK on decision 3):
- Platform thread: a shared four-lamp layer in the shell, so games can move to four lamps one at a time (three-lamp games keep working, with lamp 4 dark). Plus the engine speed fix from the ideas list: draw at the screen's real size and pause the game behind the menu. Both help every game and change nothing you'd notice until a game moves over.
- Dashboard thread: hide the temperature/humidity readouts and retire Atmosphere when the node has no sensor, and show four lamps in the header.

## Decisions for you

1. **Push the new-node work to GitHub?** The firmware and service changes (board profiles, the green/blue fix, four lamps, stereo mics, board LED) exist only on the Pi. Pushing them as a draft PR on top of the knock PR lets the mod, game kit and four-lamp work read the real protocol. *Recommend: yes.*
2. **Board LED:** a status light (dim green when the console is connected, red while a mic is live) *(recommended)*, or off unless a game uses it.
3. **Start the four-lamp groundwork and the engine speed fix now?** (described above) *Recommend: yes.*
4. **Who merges:** I merge each draft in order once you've OK'd that game after playing it *(recommended)*, or you merge.
5. **Dashboard:** keep Light Trial (it's due a four-lamp "which lamp lit" version) and hide Descent while it's on hold? *Recommend: yes to both.*
6. **ChatGPT games:** put one folder per game in project files (for example `chatgpt-games/`) or upload a zip in chat, and say whether ChatGPT ran the repo's tests.

These can wait until after testing: which new game ideas to build (Signal Box, Three Suns, Curfew and Pass the Node all get better with four lamps and tap direction); whether left/right taps should steer Ricochet's paddle or give Relay two-hand rhythms; and when to try the Claude Code mod (needs decision 1 first).

## Playtest checklist

Post notes in the project chat, a line or two per game, and I'll route each to its thread. For every game: minutes played, what kept you playing, what got in the way, and whether the lamp colours read clearly on the new lamps.

### 1. Outpost (30 to 40 minutes, on your migrated save)
- An update card says what's new. Your signal, machines and relocations survived.
- Steady beat for 20 s, then flat out for 20 s. Steady should feel right; flat out should feel pointless rather than punishing. Does the left lamp's beat flash land just before your tap?
- Hold for the menu ring and play a SONGBOOK tune. The machines on its notes should look busier afterwards.
- SOUNDINGS: is the goal clear? When relocation is ready, do the three sites' rules read well enough to choose?
- With 3 or more blueprints, WORKSHOP opens 3 minutes into a run. Is HOLD TO FIT clear?
- Sound: chimes in key with the tune (including Greensleeves) and not too loud; the full-groove bell not shrill; the hum and THE CALL's drone audible but not muddy.
- Lamps: purchase (green) and expedition (cyan) runs readable; the blue "fitting waiting" pulse distinct from the purple boost.
- Visuals: a late game with every machine and the aurora stays smooth; glows look smooth, not blocky; each relocation site looks different; nothing cramped or overlapping; amber story notes readable.
- Report: minutes played, relocations made, one line on what kept you playing, one on what got in the way.

### 2. Platform and dashboard (about 10 minutes)
- Full-screen play: the game fills the 7" screen, text is readable, top and bottom bars are fine.
- Calibration > RENDER QUALITY in Perihelion: AUTO vs SHARP vs FAST. Smoother? Is FAST too blurry?
- Calibration > TIMING OFFSET: tap along and note the ms it shows (Meridian and Relay use it).
- Tap, tap, hold in a game now needs 1.6 s. Too long? Does it open by accident in Undertow or Perihelion?
- The TODAY line and System menu > LOGBOOK: keep or change?
- Dashboard: the sector strip and amber "next" tab; do the six pages (Voyages, Arcade, Lamps, Mind, Tools, Sensors) feel right; do cards show best and runs after a game?

### 3. Reworked games waiting on your verdict
- **Tideline** (its verdict also gates merging Outpost): with a fresh save, is the early game easier? Hook a fast fish: do the shiver and IT WILL RISE/DIVE make moving early feel fair? Does TODAY'S CATCH show on the shore and pay double? Does the field log step a row per tap? Does the shore read on the 7" screen?
- **Moonrunner:** is the I-III rhythm easy to fall into? Do zones IV-VI feel hard but fair? Are 2.5-minute runs too short (they were 4)? Is the middle lamp's green/amber perfect-landing cue readable?
- **Meridian:** are the end lamps fair to time? Is the called-lamp marker visible on the real lamps?
- **Relay:** does tapping back feel on time? Is stage I too slow?

### 4. The rest, when you have time
- **Perihelion:** the solid tether, STALL and LOOP tricks, going back; a STEADY or BRISK run; buy SPARE PROBE I; the goal bar and notice strip; the hangar opens on LAUNCH. Is the Cluster's sky-blue lamp distinct from the Nebula's deep blue?
- **Ballista:** does landing the marker on a pad pay off? Are early and late skip presses fair (a press near touchdown should never spend a thruster)? Do the weaker upgrades make progress too slow? Are the skies readable?
- **Undertow:** does thrust answer quickly enough? Does the Trench (around passage 20) still feel like a wall? Can you log a creature by flying close until the amber ring fills? Are refit prices (90 to 300 pearls) fair? Is the new scenery smooth?
- **Orbit Lock:** one long run. Is the late game (dark gates from lock 30) fair? Is the perfect zone too tight?
- **Ricochet:** reach chamber 4 or later. Do the charge cells feel good? Is the upgrade pick clear (tap switches, hold takes)? Does hold-to-pause keep the paddle's direction?
- **Light Trial:** one series of five, plus one deliberately late press (it should say TOO SLOW and not count). The lamps should stay dark until the cue.
- **Echo Vault:** 2 or 3 shifts. Does a fifth letter open after the first? Does dash vs dot timing feel right?
- **Glyph Archive:** one Braille and one Greek session. Readable on the 7" screen? Card pace right? Do the which-of-two cards make sense (tap = upper, hold = lower)?
- **The Stacks:** read the guide, tap pages, hold for the menu, change text size and auto-turn, leave and come back (your place should be kept). Try GET FREE CLASSICS > Frankenstein (needs internet). Optional: IMPORT FROM USB DRIVE with an EPUB, or a Kindle's My Clippings.
- Optional: open `chrome://gpu` on the Pi and say whether canvas is hardware accelerated.

## Tap sitting, once the case is final (about 10 minutes)

Tell "Run Vesper on the Pi" the case is done and it will walk you through:
- About 2 minutes of lamp-cued light taps: left side, right side, top, then your usual spot.
- A minute of handling and typing near the node with no taps, and a minute hands-off with game tones playing (the beep test).
- A speech check: a few spoken commands and one dictated sentence in Transcription.

From that data the threads set a new tap threshold for the quieter case and check whether left, right and top separate cleanly.
