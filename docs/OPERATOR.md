# Operator's field guide

## One switch, one convention

Tap to move the highlighted menu item forward. Hold until the display says **RELEASE TO SELECT**, then release. The default selection threshold is 0.65 seconds and can be adjusted in Calibration.

**One gesture opens the system menu from anywhere: tap, tap, hold.** Two quick taps, then press the button a third time and keep it down for about a second. It is the same in every game, in every instrument and on the dashboard, and it never depends on the app. The control deck's hint line counts it (`MENU: ● ○ TAP AGAIN`, `MENU: ●● NOW HOLD`), the hold bar fills during the third press, and where the host owns the lamps one lamp lights per tap and the third fills white during the hold. The menu opens as the bar reaches the end; release the button after that (the release is swallowed). The system menu contains resume/restart, dashboard, microphone modes, app-specific actions, field records, instructions, settings, and SYSTEM TOOLS (Calibration, Node Scope and Telemetry).

Timing, by the *Menu gesture timing* setting in Calibration: **standard** needs taps of at most 150 ms, pauses of at most 220 ms between the three presses and a hold of 1.0 s; **quick** 120 ms, 180 ms, 0.9 s; **relaxed** 220 ms, 320 ms, 1.1 s. The two taps must be exactly two: three quick taps then a hold is just a hold, so a game that is played with rapid taps keeps its long holds. Games get no plain-hold escape at all.

In the dashboard, instruments and menus a tap moves the highlight and a hold-and-release chooses, so the gesture's two taps move the highlight twice. When the hold reaches the gesture's threshold the menu opens, the highlight goes back where it was before the first tap and nothing is chosen. The gesture's hold must run at least 0.35 s past the selection threshold (1.0 s with the default 0.65 s selection; 1.35 s if you set the selection hold to 1.0 s), so tapping twice quickly and then holding to choose (release at 0.65 s up to just under 1 s) still chooses. A plain three-second hold also opens the system menu in these contexts, silently.

Games use immediate button edges, so a tap can jump or catch a target without waiting for a menu threshold, and the two taps and the start of the hold reach the game before the menu opens. When the host then cancels the game, it puts back everything that gesture changed: score, lives, position, a hooked fish, a lesson answer, a purchase. Only the best score already raised stays (it is a high-water mark), and Outpost keeps the signal its two taps gathered, since gathering is its whole point (a purchase needs a release, which the menu swallows). Voice is an optional navigation shortcut. Every important action is reachable using the button alone.

The dashboard is a list of sectors named in `vesper/catalog.json`, one page each with at most six cards, followed by Next Sector and System. The first three sectors hold the fourteen games (Perihelion first), then two sectors of instruments, with Chronometer and Cadence side by side. **Calibration, Node Scope and Telemetry are not on the dashboard**: open the system menu and choose SYSTEM TOOLS (Calibration is also its own entry), or say "computer open settings / diagnostics / system". **Ephemeris is retired from the dashboard**: it has no card and no voice name, but its code and tests remain and it is still registered, so it opens by id (for a developer, `vesper.launch("ephemeris")`) and can be put back by listing it in a sector. Space reproduces the physical switch. The on-screen circular switch supports holding, including inside the system menu. Cards and instrument actions also accept direct clicks. Right/down arrows advance; Escape or the PAUSE button opens or closes the menu, and so does the voice command "computer menu". All of these open the same menu with the same guarantees: held input is cancelled and its release swallowed, the app is told to cancel and pause, and the lamps go back to the host. (A knock on the case is planned to open it the same way.)

## Six games

### Orbit Lock

A satellite traces an orbital dial. Press when it crosses the amber target arc. Each successful lock gives one point, moves the target, increases speed, and gradually narrows the gate; this keeps going until forty locks. Every five locks advances a sector. From the tenth lock each new sector reverses the direction of travel, from the twentieth the gate itself drifts, and every ten locks repair one hull point. Miss feedback distinguishes early and late presses. Three misses end the run, and so do ten seconds without a lock (each costs a hull point). The result card says NEW BEST when the run beat the saved best. Press after the result to restart.

Lamps: the left lamp brightens as the satellite nears the gate and goes bright while it is inside; the middle lamp is the hull (green, amber, red); the right lamp climbs through five steps of cyan as the sector fills. A success flashes green, a completed sector flashes white, and an early miss flashes the left lamp red, a late miss the right lamp red.

### Moonrunner

A survey robot crosses a crystal plain. Press to jump, release to shorten the jump, or hold for a higher, longer arc. A small jump buffer and coyote-time window make near-edge presses forgiving. The run starts with low stones, then ridges, crystals and spires; from the sixth relic tall walls appear that a tap cannot clear (they are labelled HOLD), and from the fourteenth long mesas that need a held jump to glide across. Obstacles grow gradually taller and wider, the run speeds up, and the gaps between them tighten. Two shields absorb collisions (a short grace period follows each) and one is earned back every twelve relics; a collision with no shield ends the expedition. Score is distance traveled. Press to begin another run.

Lamps: all three lamps show the speed (green, amber, red) dimly. As the next obstacle closes, the lamps fill left to right in its colour (stone green, spire cyan, ridge amber, crystal magenta, wall white, mesa violet) and go bright in the last half second, which is when to jump. A relic blips the middle lamp white, losing a shield flashes amber, and the end fades red.

### Undertow

A small craft moves through submerged columns. Hold to apply upward thrust; release to sink. Thread the gaps without hitting a column or the upper/lower boundaries. Each successful passage gives one point. The hull takes two hits (a column or a boundary, followed by a moment of grace); the last hit ends the run, and every twelve passages repair one point. The openings start wide and narrow continuously, from the tenth passage they drift up and down, and the current quickens until the thirty-second. Sustained thrust is allowed; quick clicks open the menu in the default profile. Changes between successive column centers are bounded and failure feedback identifies the limit reached.

Lamps: the craft is a cyan spot at its depth (top lamp near the surface, bottom lamp near the floor) and the next opening is an amber spot that brightens as it arrives, so the two merge when you are lined up. Near the surface or the floor the end lamp pulses red. A passage blips the middle lamp green, a hull hit flashes red.

### Echo Vault

The vault sends a pattern of short and long pulses: a short lights the middle lamp in amber for 180 ms, a long lights all three lamps in cyan for 620 ms, and the three circles on screen mirror the lamps. After playback, reproduce the pattern: less than 350 ms is short, 350 ms or more is long. While you hold, the lamps fill left to right in amber and turn cyan at 350 ms, the sidetone steps up from 440 to 660 Hz at the same moment, and a bar on screen shows the hold against the 350 ms line. After each release the vault says what it heard (SHORT or LONG and the time). A hold within 100 ms of the line on the wrong side is forgiven as a close call while you have a wobble left (three at the start, one more every three sequences, at most four), so a run ends on a wrong memory, not on a close call.

Each correct sequence adds a chamber to the score and grows the pattern. At ten elements, new ten-element patterns keep the game going. From the third sequence playback quickens, and from the eighth the screen stops listing the pulses during playback (DARK VAULT: lamps, circles and tone only). A mismatch ends the attempt and blinks the lamps three times in the colour of the pulse that was expected (amber short, cyan long). The first sequence is deliberately simple: short, long. Hold three seconds for the menu, which includes Replay Current Signal. A mismatch identifies the expected short/long pulse.

### Light Trial

Press to arm a round, then wait for **physical light II** to turn green. Press as soon as you see it. Pressing early fails the trial. Wait times vary from 1.3 to 4.2 seconds. Results show the latest reaction time and mean/median of up to ten recent successful trials in the current timing class. Physical, keyboard, and simulator results have separate score records. Old unclassified records are retained and labelled.

After a result the three lamps glow in a grade colour for a moment (under 200 ms green, under 300 cyan, under 450 amber, slower red) and then go dark; a new best sweeps white across first. A false start alternates red on the outer lamps twice. While a trial is armed and waiting the app writes no light at all, so nothing can tip you off or disturb the node's cue. The screen also shows the grade and a bar for each of your recent trials.

Physical cue and switch timestamps come from the ESP32 clock. Screen simulation uses the simulator clock. Keyboard input in hardware mode uses approximate screen timing, so do not compare it directly with a physical-button trial. Saved points are `max(0, 1000 − milliseconds)` to fit the engine's higher-is-better score convention. This is an experiment/game, not a calibrated human-performance test. Pausing cancels an armed trial.

### Relay

The lamps play a bar of a real rhythm (the CALL), then go dark: tap it back in time (the ANSWER). The next call follows on the beat with no pause, so a run is one continuous groove; a count-in of four clicks starts it. A note on the first step of a bar lights the left lamp, a note on the beat the middle lamp and a note between beats the right lamp, each with its own pitch, so a call can be read on the lamps and heard. Taps during a call are free (tapping along is how a rhythm is learned). In an answer each tap is graded against the nearest note: PERFECT within 50 ms, GOOD within 95, CLOSE within 140; a tap that matches no note is an EXTRA and a note let by is a MISS. An answer with more slips than a quarter of its notes (one is allowed in any pattern of three or more) is lost: it costs one of three shields and the rhythm is called again. A clean answer (every note PERFECT or GOOD, no slips) scores a bonus; four clean in a row restore a shield. The first answer of a run is a warm-up. PERFECT and GOOD build the combo; every twelve raise the multiplier (up to x4). Taps are judged after taking off the console's latency calibration (`latencyMs` in settings, once Settings offers it), so a console whose taps arrive late still plays fair. After the menu is opened mid-run, the round in progress is dropped without penalty and called again after a four-beat count-in. The screen shows the rhythm's name and where it comes from, its notation with a playhead, the three lamps as they are lit, and every tap's timing in ms with a strip of the last twelve.

Stages (25 rhythms): I Pulse (four on the floor, half time, backbeat, heartbeat), II Eighths (straight eighths, offbeats, rock beat, cha-cha-cha), III Syncopation (tresillo, habanera, Charleston, cinquillo), IV Clave (son 3-2 and 2-3, rumba, bossa nova; two bars each, the click marks only the bars), V Waltz (waltz, mazurka, hemiola), VI Swing (shuffle, swing ride, triplets), VII Odd time (5/8 as 3+2, 7/8 as 2+2+3 and 3+2+2), then cycles of everything, faster (to 160 BPM) with the windows narrowing to six tenths. Each stage first calls its own rhythms in order, then mixes in earlier ones. From the waltz on, some answers are followed by AGAIN, FROM MEMORY: a second answer with no call (worth double). A rhythm's notation stays on screen during its answer until it has been answered cleanly once (and always in the first two stages); after that it is played by heart.

Controls beyond play: on the title and result screens a tap starts and a hold of half a second opens the SONGBOOK (tap: next line, hold: choose). RELAY is the run and the only mode that writes the console score. DAILY: the same rhythms for everyone on a date, with a goal; when Relay is one of the console's three games of the day, that goal is its order in the logbook. STUDIO: ten rounds of the rhythms you have met but not mastered, with notation and the click, no shields, no score. ACCELERANDO (opens on reaching the clave): every rhythm met, three BPM faster each round. SOUND KIT: wood; bell and chip at 6 and 14 rhythms learned. RHYTHMS: the book of all 25, hidden until heard, learned at one clean answer and mastered at five. LOG: totals. Feats (fourteen, two hidden) go to the console's logbook, which announces them; the game keeps no feat list or streak of its own.

Lamps: the call lights each note on its lamp in amber; the answer is dark but for a faint cyan downbeat on the left lamp and the player's taps (white, green or amber by grade; red on a slip). Save: schema 2 (drops the daily streak, now the console's).

### Glyph Archive

Remember a short inscription of unfamiliar glyphs. Once it disappears, a cursor automatically scans six choices. Press when the required glyph is highlighted, then reconstruct the next glyph. A correct inscription advances the round, earns points, and increases its length (from three glyphs up to nine). Three mistakes end the run, and an attempt is restored every fourth inscription. The cursor quickens by 3% with every inscription, down to 60% of the chosen interval, the memorising time shrinks slowly, and from the sixth inscription the cursor visits the glyphs in a shuffled order. Points per inscription scale with the cursor speed (850 ms is the reference). Position and shape both distinguish the glyphs; color is not the sole cue. Calibration offers 600/850/1200/1600 ms scan intervals. Scores are classified by scan speed.

Lamps: while the inscription is shown the lamps fade out over the memorising time; while you choose they are a progress bar across the row (green, amber or red by attempts left), with a white tick on the third of the row the cursor is in each time it moves.

### Perihelion

A probe coasts right through small suns. Hold: it is tethered to the sun marked by the diamond and swings like a pendulum. Release: it leaves on the tangent. Chains of clean releases raise the multiplier (x1 to x5). The terminator, a wall of dark, sweeps up from behind and quickens after five minutes. This core is unchanged.

The journey: six regions, announced by a banner, a flash of the region's colour on the lamps and three notes. I The Approach (the original field), II The Cluster (500 Mkm of track, suns crowd close, some with twins), III The Binaries (900 of track, paired suns orbit each other; the tether follows and the release carries the sun's velocity), IV The Nebula (1350, a current pushes the probe in free flight; streaks show how), V The Dark Field (1800, dark bodies crowd the lanes; passing within a short distance of one scores style points), VI The Beat (2250, some suns pulse and can be caught only while lit). At 2800 Mkm of track is the perihelion: the run ends as an arrival with a 400 point bonus. (Track distance is not the score: the score is multiplied by the chain.) Relics (a small cross) float off the safe line from the cluster on; flying through one pays 25 points times the multiplier. Sling suns (dashed cyan ring, chevron) add 8% speed to a clean release. Each new mechanic is explained once in the hint line.

Controls beyond play: on the title and result screens a tap launches and a hold of half a second or more (a ring fills at the top right) opens the HANGAR. In the hangar a tap moves down the list and a hold chooses. PROBE: Standard, Ballast (heavy: flatter flights, slow swing; 4 feats) and Wisp (light: quick swing, steep arcs; 8 feats). START: begin in any region already reached (not for the console record). TRAIL: cosmetic, unlocked at 1, 3, 6 and 10 feats. DAILY RUN: the same world for everyone on a date, with a goal drawn from the date; it never touches the console's best distance. FEATS: sixteen named goals with progress (two are hidden: a hint is shown). LOG: regions reached and the best crossing time of each. Only a plain run from the start with the Standard probe raises the console's best distance; the others keep personal bests of their own in the save.

Lamps: in flight, the colour is the region (green, white, violet, blue, magenta, yellow) turning amber and red toward the edge of the band as before, and the fill from the left is speed. In the nebula the colour is paler where the current lifts and deeper where it presses down. On a tether a cyan spot sweeps with the swing angle. A relic ahead pulses white on one lamp and a dark body ahead blinks red on one lamp: the left lamp means above you, the right lamp below, the middle level. Before a pulsing sun the lamps are a bar that drains from the right while it is lit; while it is dark the middle lamp blinks faster as it is about to relight. A catch is a white flash, a relic a quick white sweep left to right, a region change a swell of its colour, a record a white and amber flash. Title, hangar and result glow dimly in the colour of the furthest region reached.

Sound: the swing sings a note each time it passes the bottom, higher with speed (a pentatonic scale); a clean release rings the note and its fifth; a relic is a rising pair; a near pass a short high tick; each region has its own three-note motif. Listen for the note at the bottom: releasing there opens a hidden feat.

Save: a versioned record (schema 2) that keeps the original run count, last result and milestone, and adds the furthest region, best crossing times, feats, relics, selections and the daily record. A save from the first release loads unchanged.

## Six instruments

### Signal School

The target letter and its Morse pattern appear above your transmitted signal. Tap for a dot, hold for a dash, and pause between letters. Default speed is 10 WPM: dot 120 ms, dash 360 ms, with a 240 ms dot/dash threshold. Beginner gaps are intentionally forgiving: the letter completes after at least 600 ms without another press. This is practice timing, not a strict timing examination.

Letters progress through E, T, A, N, I, M and onward through the alphabet. In guided and listen modes a letter moves on only after it has been answered correctly twice in a row (two pips beside the letter show this), so the whole alphabet takes about five sessions at 10 WPM. The app reports decoded mistakes and saves totals, lesson position and per-character outcomes after each answer. Ten answers produce a session summary. WPM is adjustable from 5 to 25 in Calibration. The underlying decoder also includes digits, although this release's guided lesson sequence covers the alphabet. Lights and an optional 550 Hz sidetone follow your key (the tone stops once a press is clearly longer than a dash, five dot lengths, so a menu gesture is two short beeps and at most one tone of that length; at 10 WPM that is 600 ms. The screen then says MENU GESTURE / KEEP HOLDING while it is being counted): while you hold, lamp I lights amber at once and all three turn cyan at the dash threshold (twice the dot length), so you see the moment a hold becomes a dash; after you release, the lamps dim over the letter gap. A right answer sweeps green across the lamps; a wrong one sweeps red and then replays the correct signal on the middle lamp, one amber blink per dot and one cyan blink per dash.

Open the menu (tap, tap, hold) and select a learning mode:

- **Guided keying:** see the target pattern, transmit it, and repeat mistakes.
- **Listen & identify:** receive tones or visible/light pulses without seeing the answer (a dot is the middle lamp in amber, a dash all three lamps in cyan), then press and release the highlighted choice; a white lamp spot follows the highlighted choice. REPLAY repeats the signal. Choice scanning uses Calibration's scan interval.
- **Adaptive review:** transmit without the displayed pattern. Due/weak characters return sooner using an attempt-count and streak schedule. The correct pattern appears in feedback.

S and H remain valid strings of short presses; they do not open the menu in Signal School. The modes cover A–Z. Calendar-based scheduling, words and digit lessons remain future work.

### Chronometer

(Cadence's TIMER tool now does the same job with far fewer presses and is the one to use; Chronometer stays installed and working and can be removed from the dashboard.)

Choose a preset, then Create Timer. Presets are 30 seconds, 1 minute, 5 minutes, 15 minutes, 25 minutes, and 1 hour. Up to eight timers can exist at once. Pause, resume, or remove each using its labelled menu action. Custom Timer opens a six-digit HH:MM:SS wizard. Choose each digit, then a label such as TEA or FOCUS. Start it, or save one of six reusable custom presets. Back and Cancel remain available; supported duration is 5 seconds–24 hours.

The screen leads with a large readout and progress bar for the nearest running timer; the other timers (up to three) are listed below it. While Chronometer is open the lamps show that timer as a bar that drains from the right across the three lamps, green turning amber; in the last ten seconds they show the same amber three, two, one countdown as the rest of the console. A finished or paused nearest timer leaves the lamps dark. The lamps are only taken once a timer is running, and they go dark again when you leave.

Timers continue while another app is open. Completion shows a message and optionally plays a chime. On the dashboard, Chronometer, or Atmosphere, the physical lights also signal completion; games keep control of their lights. The footer shows the nearest active timer. Finished timers remain until removed and still count toward the eight-timer limit. Deadlines follow the Pi wall clock across restarts: moving the clock forward can finish one sooner, while moving it backward extends the displayed remaining time. No alarm can sound while powered off.

### Cadence

Four tools: METRONOME (with tap tempo), STOPWATCH (a tap takes a lap), INTERVALS (work and rest rounds) and TIMER. Cadence opens on the tool you used last.

**Timer** is the console's everyday timer and replaces Chronometer's wizard. It is a front end for the same service timers (they keep running after you leave Cadence, survive a restart and finish with the usual message and chime). With no timer running the screen offers, in this order: START (the length used last, 5 minutes the first time), DIAL, START 5, 10, 15 and 25 MIN, MORE LENGTHS (30, 45, 20 and 60 minutes, 3 and 1 minute, 30 seconds) and BACK. One hold starts any ready-made length. DIAL is for any other length up to 99 minutes: on the tens screen each tap adds ten minutes and a hold moves on; on the minutes screen each tap adds one minute and a hold starts the timer (twelve minutes is one tap, a hold, two taps and a hold). Digits wrap after nine; leaving the minutes screen at 00 minutes (the single action reads BACK) returns to the start list. Labels are never asked for: the timer is named after its length. Saying “computer timer twelve minutes” starts one at any time, from any screen.

With a timer running the screen shows it large (the one started last, or the nearest to finishing; NEXT TIMER steps through the others, up to eight) with a progress bar and the next two beneath it. Actions: PAUSE or RESUME, ADD 1 MIN (a minute on what is left; the service has no add operation, so a replacement timer for the time left plus a minute is started and the old one removed, keeping its label), CANCEL TIMER, NEW TIMER, NEXT TIMER (when more than one) and BACK. The highlight stays on the row you chose, so ADD 1 MIN twice is two holds. A finished timer reads DONE with DISMISS and RESTART. The lamps while the Timer tool is open are a bar draining from the right across the three lamps (green turning amber) for the nearest running timer, the same amber three, two, one in its last ten seconds that the rest of the console shows, three amber blinks when one finishes (the service plays its own blink only on the dashboard, Chronometer and Atmosphere), then one dim amber lamp until it is dismissed. While the dial is open the lamps are a cyan bar of the minutes so far.

Cadence listens to raw button edges for tap tempo, laps and the dial. If the host takes quick taps followed by a hold as the system menu (or four quick taps in a game), the taps that arrived first as ordinary input (up to three, no more than a second apart, the last ending where the held press began) are taken back when Cadence is told to cancel: laps removed, the tempo restored, the dial minutes subtracted. A gesture never starts, pauses, adds to or removes a timer, because those are only done by choosing an action.

### Lantern

The three lamps as a lamp. Nothing shines until you choose, and the lamps go dark when you leave. The first hold (LIGHT, or RESUME when something was saved) lights the last scene, or a warm steady light at a low level the first time. The list is short and keeps its places: SCENE, DIMMER, BRIGHTER, SLEEP IN 30 MIN, LAMPS OFF, COLOUR, SLEEP TIMER, RETURN TO DASHBOARD (while dark, LIGHT or RESUME takes the front and LAMPS OFF is absent). DIMMER and BRIGHTER move the level one of four steps (NIGHT, LOW, MEDIUM, HIGH) at once, and the highlight stays on the row, so another step is one more hold; the row names the end of the range (DIMMER / LOWEST). SLEEP IN 30 MIN lights dark lamps and starts a 30 minute timer, then reads CANCEL SLEEP TIMER; SLEEP TIMER lists 5, 15, 30 and 60 minutes and NO TIMER. The lamps fade over the last minute of any timer.

SCENE and COLOUR open lists that **preview**: the list opens on its first row, every tap moves the highlight and the lamps show the highlighted choice at once (the screen says PREVIEW / HOLD TO KEEP), and a hold keeps it. The choice in force is marked ●. Moving scenes (candle, breathe, aurora, tide, ember, sunrise) move in the preview too. Leaving a list with BACK, or opening the system menu, never keeps a preview: the lamps return to what was chosen (or go dark if they were dark). Scenes: STEADY, CANDLE, BREATHE, AURORA, TIDE, and THREE-LAMP SETS (dusk, reef, hearth, nebula) and EMBER AND SUNRISE (ember; sunrise over 10, 20 or 30 minutes) one list further, each with preview. Colours: warm white, amber, phosphor green, cyan, deep blue, violet, red for night vision; a colour picked during a scene that does not use colour makes it a steady light. Lantern follows the highlight from the raw button edges the host also sends; it takes taps only while the system menu is closed.

### Field Notes

Select Start Transcription. Speech appears first as live text from the Vosk recogniser. When you pause, that line stays on screen as provisional text while the more accurate second pass (Parakeet, if installed) re-transcribes it, usually within about half a second, and then the refined line, with capital letters and punctuation, replaces it. Only the refined line is saved, once; if the second pass is absent, fails or times out for an utterance, Vosk's own text for that utterance is saved instead and dictation carries on. The line `RECOGNISER / …` on the Field Notes screen says which recognisers are in use, and the top bar reads `TRANSCRIBING / LOADING` while the second-pass model loads (the first transcription after a start or a long idle; dictation works meanwhile). Audio is held in memory only for the utterance being spoken (cut at a pause after about 20 s, never beyond 30 s) and is discarded as soon as its line is final; no audio is ever written to disk. Final text is saved locally. Select Stop Transcription to end the session.

The note is drawn as five rows of large fixed-width text (58 characters a row) in a view of fixed height, so nothing ever scrolls. While dictating, the view follows the newest lines: the newest is always the last row, older rows leave at the top, and a long utterance shows its end. The kind of text is marked in the margin as well as by colour: saved lines in phosphor green with no mark, Vosk's finished line waiting for its refined text in amber with `~`, and the live partial in dim italics with `>` and a blinking caret. The recording indicator at the top left reads REC (a pulsing dot, steady with Reduced Motion) while the node is capturing, WAIT (hollow, amber) while the microphone starts or is lost, and IDLE when it is off; beside it the status label and, below, the `RECOGNISER / …` line. While dictating the actions are STOP TRANSCRIPTION first, PREVIOUS TEXT PAGE (read back; new text does not pull you away), SAVED NOTES and RETURN TO DASHBOARD.

Reading is by whole pages of five rows with `PAGE n / N` at the top right, never a scrolling panel. The first action is NEXT TEXT PAGE (one hold per page; it wraps from the last page to the first, and past the last page of a note being dictated it returns to the live view), then PREVIOUS TEXT PAGE (wraps the other way), START or STOP TRANSCRIPTION, EXPORT SELECTED NOTE (the entire chosen session) and SAVED NOTES. Stopping a session opens it on its last page. SAVED NOTES is its own short screen: READ for each of five notes (the ● marks the note on screen), OLDER and NEWER NOTES, and BACK TO THE NOTE; choosing a note returns to its first page. The list reloads each time it is opened. Rows are cut at word boundaries, a word longer than a row is cut, and a line longer than a page runs on to the next page.

Transcription continues after leaving the app until explicitly stopped, muted through the system menu, the controlling browser disconnects, or the service/node resets. The top bar says **TRANSCRIBING** throughout. Saying a console command during dictation simply transcribes it. Stop using the switch; dictation does not interpret “computer microphone off” as a command.

### Atmosphere

Displays the latest temperature (in the unit chosen in Calibration) and relative humidity, each with its change over the last hour as an arrow and a rate (steady below 0.3 °C or 1.5 % per hour; "collecting" until about 20 minutes of samples exist). Beside them:

- **Comfort**: DRY below 30 % RH, COMFORTABLE 30 to 60 %, HUMID 60 to 70 %, VERY HUMID above 70 % (EPA indoor guidance 30 to 50 %, ASHRAE 55 and mould guidance cap at 60 %).
- **Dew point**: Magnus formula with the Alduchov and Eskridge constants (−45 to 60 °C).
- **Feels like**: the US National Weather Service heat index (Rothfusz regression with the NWS humidity adjustments) when it is defined, which is 80 °F (26.7 °C) to 120 °F and 40 % RH or more. Outside that range the plain air temperature is shown and marked AIR TEMP, because the formula gives nonsense there.
- **Absolute humidity** in g/m³ (Bolton saturation vapour pressure and the ideal gas law; it is a density, so it does not change with the temperature unit).
- **Today low / high** since local midnight, with their times. They come from the stored five-minute averages plus the live reading, so a brief spike shorter than five minutes is smoothed out.

The three lamps show the comfort band quietly while Atmosphere is open: amber dry, green comfortable, cyan humid, violet very humid, all three the same dim colour (about a quarter of full before the Calibration lamp level). A reading older than two minutes, or a disconnected node, leaves the lamps dark. In a timer's last ten seconds they show the amber countdown instead. They go dark when you leave.

The Range action cycles the two charts (shown side by side, axes in the chosen unit) between 24 HOURS, 7 DAYS and 30 DAYS. The Pi stores about one sample per 30 seconds and retains 30 days, but `/api/history` currently returns only the last 24 hours in five-minute averages. The 7 and 30 day views ask for `/api/history?hours=H&bucket=S`; until the service understands it they show those 24 hours with the note "ONLY THE LAST 24 H IS AVAILABLE". Early in a new installation there will not yet be enough history for a line chart. History reloads once a minute; Refresh History reloads it now. The status line marks values stale after 15 seconds without a new sample or whenever the node is disconnected, then counts the age in minutes. Stale values remain visible as last readings.

**Case offset.** The sensor sits inside a warm case and reads a little hot. CASE OFFSET COOLER and CASE OFFSET WARMER (Atmosphere's last actions before the dashboard) move a correction in steps of 0.5 °C between −10 and +5 °C (default 0; the setting is `tempOffset`, always stored in Celsius), and CASE OFFSET / CLEAR returns it to zero. The label of each action shows the offset that choosing it would give, and the big reading changes as soon as you choose. The correction is added to the sensor temperature wherever it is shown or used: the big reading, dew point, feels like, today low/high, the temperature chart, Node Scope's sensor row, and (through `formatSensorTemp`/`correctTemp` in `web/engine/math.js`) the status bar and the voice answer to “temperature”. While an offset is in force Atmosphere says so on the temperature panel and in the status line. Stored history stays raw, the correction is applied only when drawing it. Humidity is not changed. Warming air lowers its relative humidity, so a sensor in a warm case also reads drier than the room; correcting the temperature alone does not fix that, and dew point and absolute humidity are computed from the corrected temperature with the measured humidity (they will read lower than the room's true values by the amount the humidity is under-read). Telemetry's CPU temperature is a different temperature and is never offset.

Simulators display **SIMULATED SENSOR READINGS**. Real hardware readings and server-simulator history use different default data directories.

### Node Scope

Inspect button down/up, capture status, mic level, incoming audio bytes, CRC errors, missing audio samples, and the latest sensor values. From the node's once-a-second status it also shows the link type (USB or UART), the firmware string, and the sensor bus diagnostics added in firmware 0.1.2: the I²C address in use, the count of good and failed reads, and the last error. Those rows read AWAITING STATUS until the first status arrives and SIMULATOR on the simulator, which sends none. The current Calibration lamp level is listed too. Select a light, then cycle its test color. Changing the selected light takes effect on the next color test. The lamp level applies to these checks: at LOW they are dim, and at OFF the test action is labelled LAMPS OFF and a notice says the checks cannot light the lamps (the request is still made and the screen shows it). All Lights Off clears the test. Audio Test sends a chime to the Pi/browser's chosen output. Export Diagnostics includes device/capture/counter/frame information, but no transcript text. Frame statistics describe this browser, not calibrated button latency.

### Calibration

Adjust optional sound, volume, phosphor scan-line texture, decorative motion, Morse speed, selection hold time and menu-gesture timing. Reduced Motion freezes the decorative dashboard orrery; it does not remove movement essential to gameplay. All settings persist locally. Settings Reset restores controls/appearance without deleting notes, timers or learning progress. The gesture timing presets are a best guess until tried on your physical button.

## The three lamps

The lamps are part of using the console, not only of the games. Whenever no app has taken them (the dashboard, the system and microphone menus, and any instrument or game that has not lit them) the host drives them:

| When | What you see |
| --- | --- |
| Moving through a list | A soft green spot of light; its position across the three lamps follows the focused item's position in the list, and glides when you tap to the next one. |
| Holding the button in a menu | The lamps fill left to right in amber as the hold approaches the selection threshold. At the threshold they are fully amber (release now to select); a white fill then counts toward the silent three-second fallback hold that opens the system menu. A tap shows nothing. |
| Selecting | A short amber flash on all three lamps. Opening the system menu is a short white flash. |
| Menu gesture (tap, tap, hold), wherever the host owns the lamps | Each tap lights one lamp (cyan), left to right; during the third press the two stay lit and the right lamp fills white until the menu opens. |
| A voice command was recognised | A short cyan sweep from left to right. |
| An error toast | Two quick red blinks on all three lamps. |
| Idle on the dashboard | A very dim green breath, slowly drifting from lamp to lamp (steady if Reduced Motion is on). After four minutes without a press or release the glow and the focus spot fade over 30 seconds to fully dark and stay dark until the next press. |
| Timer in its last ten seconds (dashboard, Chronometer or Atmosphere, where the service plays the completion effect) | Amber: three lamps, then two, then one, each second ticking brighter and fading. The service's amber triple blink follows; the glow stays out for a few seconds afterwards and then fades back in. |
| Microphone capturing | The right lamp shows a steady dim blue for as long as the node reports that it is capturing (not merely that commands or transcription were requested). It sits on top of every other effect and is not affected by the Ambient Glow setting or the idle fade. |

Apps keep full authority. The moment a game or instrument lights the lamps, or starts a pattern or the Light Trial cue, the host effects above stop, including the microphone lamp (the on-screen microphone indicator still shows capture); they return when the app is left or the menu opens. Leaving an app still turns its lamps off.

Two Calibration settings control this. **Lamp level** (full, medium, low, off; default medium) multiplies everything the lamps do: the host effects, an app's plain light values and the colours inside an app's patterns. Off darkens all of it, except the microphone lamp, which never drops below a dim floor (about a third of full brightness) so that live capture stays visible. The Light Trial cue (the middle lamp turning green) and the amber timer-completion blink are played by the node from colours fixed in the service, so the level does not change them; Light Trial stays playable at every level, and a timer completion still blinks even with the level off. **Ambient glow** (on/off, default on) switches off only the dashboard breath; navigation feedback and the microphone lamp remain.

## Voice vocabulary

Enable **Voice Commands** in the microphone menu first. Say **computer** and then one phrase, then allow a short silence for recognition to finish. The top bar reads VOICE ON. Every recognised command plays the cyan lamp sweep and shows a toast, `HEARD / computer next → ORBIT LOCK`, with what it did. A command that makes no sense where you are (for example `select` inside a game) says why in the same toast and changes nothing. The same list is in Calibration under **Voice Commands**, one page per group. Dictation never hears commands; saying one while transcribing only transcribes it.

Move and choose (the dashboard, instruments and menus; inside a game these say "not in a game"):

| Phrase | Action |
| --- | --- |
| computer next | Move the highlight to the next item (the toast names it) |
| computer back / computer previous | Move the highlight to the previous item |
| computer select / computer choose | Choose the highlighted item, as a hold-and-release does |
| computer next sector | Dashboard only: show the next sector |
| computer home | Dashboard |
| computer pause / computer menu | System menu |
| computer resume | Close the menu and carry on |
| computer microphone off | Stop acquisition and recognition |

Apps, by the voice name in the catalog (any app, from anywhere):

| Phrase | Action |
| --- | --- |
| computer open orbit / runner / drift / echo / lights / glyphs | ORBIT LOCK, MOONRUNNER, UNDERTOW, ECHO VAULT, LIGHT TRIAL, GLYPH ARCHIVE |
| computer open rhythm / swing / lander / breakout / snake / launcher | PULSAR, PERIHELION, DESCENT, RICOCHET, HELIX, BALLISTA |
| computer open morse / timer / notes / environment / diagnostics / settings | SIGNAL SCHOOL, CHRONOMETER, FIELD NOTES, ATMOSPHERE, NODE SCOPE, CALIBRATION |
| computer open relay | RELAY |
| computer open lamp / metronome / sound / dice / system | LANTERN, CADENCE, RESONANCE, ORACLE, TELEMETRY (Ephemeris has no voice name: it is retired from the dashboard) |

Timers and notes:

| Phrase | Action |
| --- | --- |
| computer timer five minutes | Start a timer. Any whole number of minutes from one to one hundred twenty, said in words: "timer one minute", "timer twenty five minutes", "timer one hundred twenty minutes" ("one hundred and five" also works) |
| computer timer thirty seconds | Start a timer of ten, fifteen, twenty, thirty, forty five or ninety seconds |
| computer timer one hour / computer timer two hours | Start a one or two hour timer |
| computer cancel timer | Remove the most recently created timer, running, paused or finished |
| computer pause timer / computer resume timer | Pause it or restart it; says so if it is already paused, running or complete |
| computer start dictation | Open Field Notes and start transcribing, as the microphone menu's Transcribe does |
| computer stop dictation | Commands and dictation are never listening at the same time, so this is only heard while dictation is off, and says so. Stop dictation with the button (Field Notes, or the microphone menu) |

Lamps, sound and questions:

| Phrase | Action |
| --- | --- |
| computer lamps up / computer lamps down | Lamp level one step (off, low, medium, full) |
| computer lamps off / computer lamps on | Lamps off, or back to medium |
| computer sound on / computer sound off | Sounds on or off |
| computer volume up / computer volume down | Volume one quarter step |
| computer what time is it | Toast with the time and date |
| computer temperature / computer humidity | Toast with the reading in the Calibration unit (the humidity with its comfort band), and the lamps glow a colour for a moment if the host owns them: blue-green cold, green comfortable, amber warm, red hot; humidity amber dry, green comfortable, cyan humid, violet very humid. A stale reading is labelled and does not light the lamps |
| computer show timers | Toast listing the running timers and the lamps show the nearest one |

Timer creation and microphone off are done by the service; everything else is done by the controlling browser tab with the same functions the button uses (a second, monitoring tab changes nothing). Opening Field Notes by voice with `open notes` does not itself start transcription; `start dictation` does. Muting means voice cannot turn itself back on; use the button.

Phrases are spoken forms of the words in a fixed grammar, so a command is recognised only if you say one exactly; anything else is ignored. To avoid accidental triggers a command is also ignored when the recogniser's least certain word scores below 0.7 (`COMMAND_MIN_CONF` in `vesper/speech.py`). On synthesised test voices the full list was understood 99.7 % of the time clean and 96 % with the quiet, noisy test microphone (this is not the owner's voice); the weakest spot is number words that sound alike (nineteen / ninety, fifteen / fifty, forty / four), so check the confirmation toast after a timer and say `cancel timer` if it is wrong. An unrecognised command is silently ignored: just say it again.

The model is English, local, and intentionally small. It is not a conversational assistant. Short commands are generally easier than free dictation, but accuracy on the actual mic and room remains to be evaluated.
