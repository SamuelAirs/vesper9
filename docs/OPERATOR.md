# Operator's field guide

## One switch, one convention

Tap to move the highlighted menu item forward. Hold until the display says **RELEASE TO SELECT**, then release. The default selection threshold is 0.65 seconds and can be adjusted in Calibration. In menus, continue holding for three seconds to open the system menu. Games normally use four quick clicks; Signal School and Echo Vault retain a three-second hold to protect valid pulse patterns. The control deck shows the active rule. The menu contains resume/restart, dashboard, microphone modes, app-specific actions, field records, instructions, and settings.

Games use immediate button edges, so a tap can jump or catch a target without waiting for a menu threshold. Ordinary long game holds remain ordinary inputs in the default click profile. Calibration offers three-click and legacy-hold profiles plus quick/standard/relaxed timing presets. Earlier clicks can affect the game before the final click opens the menu. Voice is an optional navigation shortcut. Every important action is reachable using the button alone.

The dashboard has **Play** and **Instruments** sectors. Each contains six cards, followed by Next Sector and System. Space reproduces the physical switch. The on-screen circular switch supports holding, including inside the system menu. Cards and instrument actions also accept direct clicks. Right/down arrows advance; Escape pauses or closes the menu.

## Six games

### Orbit Lock

A satellite traces an orbital dial. Press when it crosses the amber target arc. Each successful lock gives one point, moves the target, increases speed, and gradually narrows the gate. Every five locks advances a sector. Miss feedback distinguishes early and late presses. Three misses end the run. The three lights briefly acknowledge success or failure. Press after the result to restart. Best score is saved.

### Moonrunner

A survey robot crosses a crystal plain. Press to jump, release to shorten the jump, or hold briefly for a higher arc. A small jump buffer and coyote-time window make near-edge presses forgiving. Spire, ridge, and crystal obstacle profiles have deliberate recovery spacing. Colliding with one ends the expedition. Score is distance traveled. Press to begin another run.

### Undertow

A small craft moves through submerged columns. Hold to apply upward thrust; release to sink. Thread the gaps without hitting a column or the upper/lower boundaries. Each successful passage gives one point. Sustained thrust is allowed; quick clicks open the menu in the default profile. Changes between successive column centers are bounded and failure feedback identifies the limit reached.

### Echo Vault

The vault sends a pattern of short and long pulses. The active light cycles through I, II, and III; tones and on-screen marks repeat the same information. After playback, reproduce the pattern: less than 350 ms is short, 350 ms or more is long. A short pulse is demonstrated for 180 ms, a long pulse for 620 ms.

Each correct sequence adds a chamber to the score and grows the pattern. At ten elements, new ten-element patterns keep the game going. A mismatch ends the attempt. The first sequence is deliberately simple: short, long. Hold three seconds for the menu, which includes Replay Current Signal. A mismatch identifies the expected short/long pulse.

### Light Trial

Press to arm a round, then wait for **physical light II** to turn green. Press as soon as you see it. Pressing early fails the trial. Wait times vary from 1.3 to 4.2 seconds. Results show the latest reaction time and mean/median of up to ten recent successful trials in the current timing class. Physical, keyboard, and simulator results have separate score records. Old unclassified records are retained and labelled.

Physical cue and switch timestamps come from the ESP32 clock. Screen simulation uses the simulator clock. Keyboard input in hardware mode uses approximate screen timing, so do not compare it directly with a physical-button trial. Saved points are `max(0, 1000 − milliseconds)` to fit the engine's higher-is-better score convention. This is an experiment/game, not a calibrated human-performance test. Pausing cancels an armed trial.

### Glyph Archive

Remember a short inscription of unfamiliar glyphs. Once it disappears, a cursor automatically scans six choices. Press when the required glyph is highlighted, then reconstruct the next glyph. A correct inscription advances the round, earns points, and eventually increases its length. Three mistakes end the run. Position and shape both distinguish the glyphs; color is not the sole cue. Calibration offers 600/850/1200/1600 ms scan intervals. Scores are classified by scan speed.

## Six instruments

### Signal School

The target letter and its Morse pattern appear above your transmitted signal. Tap for a dot, hold for a dash, and pause between letters. Default speed is 10 WPM: dot 120 ms, dash 360 ms, with a 240 ms dot/dash threshold. Beginner gaps are intentionally forgiving: the letter completes after at least 600 ms without another press. This is practice timing, not a strict timing examination.

Letters progress through E, T, A, N, I, M and onward through the alphabet. The app reports decoded mistakes and saves totals, lesson position and per-character outcomes after each answer. Ten answers produce a session summary. WPM is adjustable from 5 to 25 in Calibration. The underlying decoder also includes digits, although this release's guided lesson sequence covers the alphabet. Lights and an optional 550 Hz sidetone follow your key.

Hold three seconds and select a learning mode:

- **Guided keying:** see the target pattern, transmit it, and repeat mistakes.
- **Listen & identify:** receive tones or visible/light pulses without seeing the answer, then press and release the highlighted choice. REPLAY repeats the signal. Choice scanning uses Calibration's scan interval.
- **Adaptive review:** transmit without the displayed pattern. Due/weak characters return sooner using an attempt-count and streak schedule. The correct pattern appears in feedback.

S and H remain valid strings of short presses; they do not open the menu in Signal School. The modes cover A–Z. Calendar-based scheduling, words and digit lessons remain future work.

### Chronometer

Choose a preset, then Create Timer. Presets are 30 seconds, 1 minute, 5 minutes, 15 minutes, 25 minutes, and 1 hour. Up to eight timers can exist at once. Pause, resume, or remove each using its labelled menu action. Custom Timer opens a six-digit HH:MM:SS wizard. Choose each digit, then a label such as TEA or FOCUS. Start it, or save one of six reusable custom presets. Back and Cancel remain available; supported duration is 5 seconds–24 hours.

The screen leads with a large readout and progress bar for the nearest running timer; the other timers (up to three) are listed below it. While Chronometer is open the lamps show that timer as a bar that drains from the right across the three lamps, green turning amber; in the last ten seconds they show the same amber three, two, one countdown as the rest of the console. A finished or paused nearest timer leaves the lamps dark. The lamps are only taken once a timer is running, and they go dark again when you leave.

Timers continue while another app is open. Completion shows a message and optionally plays a chime. On the dashboard, Chronometer, or Atmosphere, the physical lights also signal completion; games keep control of their lights. The footer shows the nearest active timer. Finished timers remain until removed and still count toward the eight-timer limit. Deadlines follow the Pi wall clock across restarts: moving the clock forward can finish one sooner, while moving it backward extends the displayed remaining time. No alarm can sound while powered off.

### Field Notes

Select Start Transcription. Speech appears first as provisional text and then as finalized lines. Final text is saved locally. Select Stop Transcription to end the session; Refresh Saved Notes updates the session list. Select READ to browse a saved session, Older/Newer Notes to page through sessions, and Previous/Next Text Page to read twelve lines at a time. Export Selected Note includes the entire chosen session. Live text follows the latest page unless you are browsing earlier pages.

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

Simulators display **SIMULATED SENSOR READINGS**. Real hardware readings and server-simulator history use different default data directories.

### Node Scope

Inspect button down/up, capture status, mic level, incoming audio bytes, CRC errors, missing audio samples, and the latest sensor values. From the node's once-a-second status it also shows the link type (USB or UART), the firmware string, and the sensor bus diagnostics added in firmware 0.1.2: the I²C address in use, the count of good and failed reads, and the last error. Those rows read AWAITING STATUS until the first status arrives and SIMULATOR on the simulator, which sends none. The current Calibration lamp level is listed too. Select a light, then cycle its test color. Changing the selected light takes effect on the next color test. The lamp level applies to these checks: at LOW they are dim, and at OFF the test action is labelled LAMPS OFF and a notice says the checks cannot light the lamps (the request is still made and the screen shows it). All Lights Off clears the test. Audio Test sends a chime to the Pi/browser's chosen output. Export Diagnostics includes device/capture/counter/frame information, but no transcript text. Frame statistics describe this browser, not calibrated button latency.

### Calibration

Adjust optional sound, volume, phosphor scan-line texture, decorative motion, Morse speed, and selection hold time. Reduced Motion freezes the decorative dashboard orrery; it does not remove movement essential to gameplay. All settings persist locally. Settings Reset restores controls/appearance without deleting notes, timers or learning progress. Click timing presets are experimental until tried on your physical button.

## The three lamps

The lamps are part of using the console, not only of the games. Whenever no app has taken them (the dashboard, the system and microphone menus, and any instrument or game that has not lit them) the host drives them:

| When | What you see |
| --- | --- |
| Moving through a list | A soft green spot of light; its position across the three lamps follows the focused item's position in the list, and glides when you tap to the next one. |
| Holding the button in a menu | The lamps fill left to right in amber as the hold approaches the selection threshold. At the threshold they are fully amber (release now to select); a white fill then counts toward the three-second hold that opens the system menu. A tap shows nothing. |
| Selecting | A short amber flash on all three lamps. Opening the system menu is a short white flash. |
| Quick-click menu gesture, in a game that has not lit the lamps | Each click lights one more lamp (cyan); the last click opens the menu. |
| A voice command was recognised | A short cyan sweep from left to right. |
| An error toast | Two quick red blinks on all three lamps. |
| Idle on the dashboard | A very dim green breath, slowly drifting from lamp to lamp (steady if Reduced Motion is on). After four minutes without a press or release the glow and the focus spot fade over 30 seconds to fully dark and stay dark until the next press. |
| Timer in its last ten seconds (dashboard, Chronometer or Atmosphere, where the service plays the completion effect) | Amber: three lamps, then two, then one, each second ticking brighter and fading. The service's amber triple blink follows; the glow stays out for a few seconds afterwards and then fades back in. |
| Microphone capturing | The right lamp shows a steady dim blue for as long as the node reports that it is capturing (not merely that commands or transcription were requested). It sits on top of every other effect and is not affected by the Ambient Glow setting or the idle fade. |

Apps keep full authority. The moment a game or instrument lights the lamps, or starts a pattern or the Light Trial cue, the host effects above stop, including the microphone lamp (the on-screen microphone indicator still shows capture); they return when the app is left or the menu opens. Leaving an app still turns its lamps off.

Two Calibration settings control this. **Lamp level** (full, medium, low, off; default medium) multiplies everything the lamps do: the host effects, an app's plain light values and the colours inside an app's patterns. Off darkens all of it, except the microphone lamp, which never drops below a dim floor (about a third of full brightness) so that live capture stays visible. The Light Trial cue (the middle lamp turning green) and the amber timer-completion blink are played by the node from colours fixed in the service, so the level does not change them; Light Trial stays playable at every level, and a timer completion still blinks even with the level off. **Ambient glow** (on/off, default on) switches off only the dashboard breath; navigation feedback and the microphone lamp remain.

## Voice vocabulary

Enable **Voice Commands** in the microphone menu first. Speak one exact phrase, then allow a short silence for recognition to finish.

| Phrase | Action |
| --- | --- |
| computer home | Dashboard |
| computer pause / computer menu | System menu |
| computer resume | Resume app |
| computer microphone off | Stop acquisition and recognition |
| computer open orbit / runner / drift / echo / lights / glyphs | Launch the corresponding game |
| computer open morse / timer / notes / environment / diagnostics / settings | Open the corresponding instrument |
| computer timer one minute | Create a 60-second timer |
| computer timer five minutes | Create a 5-minute timer |
| computer timer fifteen minutes | Create a 15-minute timer |
| computer timer twenty five minutes | Create a 25-minute timer |

Opening Field Notes by voice does not itself start transcription; use its Start action. To switch directly from command mode to dictation, choose Transcribe in the microphone menu. Muting means voice cannot turn itself back on; use the button.

The model is English, local, and intentionally small. It is not a conversational assistant. Short commands are generally easier than free dictation, but accuracy on the actual mic and room remains to be evaluated.
