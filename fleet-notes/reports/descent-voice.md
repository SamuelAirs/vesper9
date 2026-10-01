# Descent: lunar hopper and voice throttle (desktop, 2026-10-01)

Sam's direction: no temperature or humidity in games; the microphone only where it improves a game.
After playing: the separate-site Descent was "still way too slow to be fun", and doubling its speed
did not fix it. The loop was the problem: one long fall per site, one decision (when to burn),
sideways drift you could not control, then pass or fail.

## Rebuild: a hopper

- The lander flies on across a scrolling moonscape (11 m/s, rising to 18). Hold to burn, release to fall.
- Fuel (8 s of burn) only comes from pads: settle on one under 4.5 m/s and you skim it, refuelling, until
  you lift off before its end. A first touchdown scores 60–150 by softness, x3 on a narrow gold pad,
  times a combo (up to x8) that a crash resets. Distance adds a little.
- Ridges must be climbed in time; ground never rises faster than a lander can climb (0.45 m per m),
  and a hollow pad is never deeper than a lander can drop into and brake. Pads every few seconds;
  speed, ridges and narrow pads grow with distance. Three landers; a lost one is replaced in 1.4 s.
- Lamps: colour = vertical-speed verdict (green safe, amber fast, red certain crash); the lit lamp
  walks right to left as the next pad arrives, tinted amber for gold; a soft green pulse on a pad.
- Records: score, pads, best combo, metres.
- The generated world lives in plain arrays bounded by pruning, so AppGuard snapshots stay small.

## Voice throttle

Hold the button a second on the title or result screen to switch the microphone to `analyze`; hum to
burn (loudest band 140 Hz–4 kHz above the room's learned noise floor, 12 dB gate, 28 dB span). The
button is a full burn and always wins; the 88 Hz rumble plays only for button burns. Silence, a mute,
an error or a lost link: zero throttle or voice mode off, and the game plays exactly as button-only.

## Evidence

`tests/descent.test.mjs` (28 tests; bot in `tests/helpers/descent-bot.mjs`): on seeds 3/7/11/19 the bot
lands 7–15 pads per run, 1.5–2 minutes, a pad every few seconds; an idle lander scores under 100.
All eight suites pass except the Perihelion bot test (seed 3003) that fails identically on `main`.
Simulator screenshots of title and flight looked at. Not verified on the device: feel, difficulty,
and the microphone thresholds need Sam's hands on the Pi.
