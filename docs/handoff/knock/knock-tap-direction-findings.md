# Tap direction on the second node: first labelled session (2026-10-02, 19:46 CDT, Pi)

Node: board 2, firmware 0.2.0 (PR #19), both microphones on one clock (sample i of each channel is the same instant). Case finished and closed. Sam tapped lightly about once a second, 25 s per spot, cued by the lamps: left side (lamp 1), right side (lamp 4), top (lamp 2). Analysis by `fleet/tools/tap-direction.py` on the live stereo stream; no audio was kept. Per-tap numbers: `knock-tap-direction-2026-10-02.json` (and the printed log `.log`).

Taps found at a 2500 peak threshold: left 31, right 35, top 33 (1 lasting sound, left). 0 missing audio frames, 0 CRC errors.

Features per tap (first 10 ms after onset):
- `level_db`: right RMS over left RMS, dB.
- `lag`: cross-correlation peak, samples (1/16000 s), positive = right later; ±24 searched, parabolic refinement.
- `onset`: first sample reaching a quarter of each channel's own peak, right minus left.

| Spot | n (clean) | level dB median (10-90 %) | lag median (10-90 %) | onset median (10-90 %) |
| --- | ---: | --- | --- | --- |
| left side | 30 | -0.5 (-1.6 to +1.3) | +2.5 (+2.0 to +3.1) | +3 (+2 to +3) |
| right side | 35 | +2.9 (+1.0 to +4.0) | +2.8 (+2.1 to +3.0) | -1 (-6 to +4) |
| top | 33 | +3.3 (+0.7 to +6.1) | +1.4 (-15.1 to +2.5) | -2 (-3 to 0) |

Reading:
- The right microphone reads about 3 dB hotter overall and the lag sits near +2.5 samples on every spot, so both have a per-node offset to calibrate out; the spots differ around those offsets.
- No single number separates the three spots (best: lag, 67 % leave-one-out).
- Together they do. Leave-one-out on these 88 taps (|lag| < 10; 9 top taps had a correlation peak at the edge and were left out): nearest centroid on standardised (level_db, lag, onset) 85 %; 5 nearest neighbours 93 % (left 28/29, right 30/35, top 24/24). Left versus right alone: 89 % (centroid).
- This is one sitting, one tapping style, trained and tested on the same session. It needs a second labelled session to test against before any threshold or classifier is fixed.

For the knock thread (owner of the classifier, thresholds, KNOCK side bytes and InputRouter direction): the node can send, per knock, the two peaks, the level difference and the lag/onset difference, all from the shared-clock stereo it already has; the node-side detector currently listens to the left microphone only.
