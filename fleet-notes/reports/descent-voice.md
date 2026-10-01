# Descent: voice throttle (desktop, 2026-10-01)

Sam's direction: no temperature or humidity in games; the microphone only where it improves a game.
Descent was picked because a lander suits a slow, analogue control (the analysis frames arrive about
ten a second, so a fast reaction game would feel the lag) and an on/off button cannot hover.

- Hold the button for a second on the title (or the result screen) to switch the voice throttle on;
  a tap still starts a run. The microphone goes to `analyze` only then, and off again on the same
  hold or when leaving the game (only if Descent switched it on).
- Hum to burn: the loudest band from 140 Hz to 4 kHz, measured against the room's noise floor
  (learned in the first 1.5 s, then following the room), gives 0–100 % thrust; fuel goes with output.
  The button is still a full burn and always wins. The 88 Hz engine rumble only plays for button
  burns and is outside the band, so the speaker cannot feed the throttle.
- No signal, a mute from the menu, an analysis error or a lost link: the throttle is zero or the voice
  mode turns off, and the game plays exactly as before (tested).
- In play a VOICE gauge shows the burn; the status bar shows ANALYZING while the microphone is on.
  The game owns the lamps in play, so the host's blue microphone lamp is not shown there (as in Resonance).

Verified: `tests/descent.test.mjs` (27 tests, including a voice-only pilot that lands the first three
sites and a silent-microphone run identical to button-only), all eight suites except one Perihelion
bot test that fails identically on `main`, and simulator screenshots of the title, the hold and play.
Not verified on the device: the real microphone's levels, the gate (12 dB) and span (28 dB) above
the floor need tuning by ear on the Pi.

## Pace (after Sam played it: "still way too slow to be fun")

- The descent now runs at twice the wall clock (`PACE = 2`): site 1's free fall is about 8.5 s instead of
  17 s, and the bot's site 3 from briefing to touchdown is under 15 s. Sites, speeds and fuel are unchanged
  in simulated units; the fuel shown is real seconds of full burn.
- Briefings start after 1.4 s (was 2.4). After a landing a press continues from 0.6 s and the next site
  comes by itself at 2.2 s; after a crash a retry from 0.8 s, by itself at 2.6 s.
- The voice throttle's ~0.15 s microphone lag is now ~0.3 s of simulated time. Not verified on the device.
