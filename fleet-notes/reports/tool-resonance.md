# tool-resonance: RESONANCE sound scope

## Outcome
Built RESONANCE (`web/apps/resonance.js`): Level, Spectrum and Tuner pages over the service's `analyze` microphone mode. Icon added to the catalog entry; a small synthetic `analyze` generator added to `web/engine/demo.js` so it also works in the standalone simulator. All suites pass; screenshots reviewed.

## Details
- Pages: Level (dBFS readout, peak hold 3 s, bar meter, 2-minute history of level and peak, honest "re full scale, not SPL" wording); Spectrum (28 bars, peaks falling 25 dB/s, axis 100 Hz..5 kHz, lamp-third dividers); Tuner (median of last 5 estimates with confidence >= 0.8, shown after 3, held through 3 unclear frames, blank at the 4th; note, Hz, cents, needle with +-5 cent in-tune zone).
- Panel markup is built once per page; events change only attributes/text by id (test: 600 events -> 0 content rebuilds, 0 action rebuilds). Dynamic text goes in via textContent.
- Lamps: Level = bar across three lamps, green to amber, red above 85 % of the -60..0 dBFS scale, faint left glimmer while listening, peak accent (peak >= -6 dBFS) to 85 % brightness for 0.4 s, sustained <= 30 %. Spectrum = low (amber), middle (green), high (cyan) thirds, fast attack, slow release. Tuner = middle green within 5 cents, left amber flat, right amber sharp, brighter further off (8 % .. 30 %), dark with no pitch. Lamps are not touched until there is a reading; dark when not listening, stale, link lost, error; off in dispose.
- Microphone rules: opening never calls setMic; first action START LISTENING; status line says MUTED / STARTING / WAITING FOR CAPTURE / LISTENING (only when mic.mode is analyze and device.capture) / NO DATA / ERROR / LINK LOST / MONITOR TAB / BUSY with another mode (action becomes "SWITCH MIC TO SCOPE (ENDS DICTATION)"). `owned` is set only by this instrument's own start and dropped on any mic/offline/error event that shows another mode; dispose sends `off` only when owned (also while a start is in flight). Late frames after a stop are dropped. Simulated signal labelled on screen.
- Files: web/apps/resonance.js, tests/resonance.test.mjs, vesper/catalog.json (own entry: icon), web/apps/catalog.js (regenerated), web/engine/demo.js (mic branch + `setAnalysis` + `syntheticAnalysis` at file end).

## Verification
- `node --test tests/*.test.mjs`: 273 pass, 0 fail (25 in resonance.test.mjs: note arithmetic 440 Hz = A4 0 cents, 445 Hz = +19.6, 261.63 = C4; smoothing; null/silence/full-scale/NaN frames; analysis_error; lost link; monitor tab; every exit path's mic bookkeeping; lamp values for all pages).
- Python unittest: OK. `build-catalog.py --check`: clean. `build-demo.py` + `node tests/browser-smoke.cjs`: passed, no page errors.
- `scripts/dev-shot.cjs --app resonance` at 1024x600: "no page or host errors". After `home`, real host state was `off false` (mic switched off on leaving). Shots in `fleet/work/tool-resonance/shots/`: resonance-title.png, -level.png, -spectrum.png, -tuner.png (viewed; legible, nothing clipped).
- demo.js generator checked under node: 28 bands, simulated, mic events on/off, other modes still refused.

## Not done / uncertain
- Not tried on hardware: real microphone levels (spectrum range -100..-20 dB and level lamp scale -60..0 are set from the synthetic signal and analysis.py's stated ranges); lamp brightness unseen.
- Whistle accuracy depends on the service's pitch (1.5 %), so cents readings are coarse.
- The standalone edition's bundle was only covered by the existing smoke test, not by driving RESONANCE inside it.
- Spectrum page leaves little spare height; fits at 1024x600.

## Branch
worktree-agent-a7e55ec21c6cf9263
