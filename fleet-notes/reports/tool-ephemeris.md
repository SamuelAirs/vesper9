# tool-ephemeris — EPHEMERIS (offline almanac of the sky)

## 1. Outcome
Built the EPHEMERIS instrument from scratch: four pages (Now, Moon, Orrery, Year), all computed on the device with no network, with pure astronomy functions tested against USNO and JPL Horizons values fetched tonight. All tests pass; the browser smoke passes; screenshots reviewed. Committed on the branch below.

## 2. Details
Files: `web/apps/ephemeris.js` (replaced), `tests/ephemeris.test.mjs` (new), `vesper/catalog.json` (own entry: added `icon`) and regenerated `web/apps/catalog.js`.

Algorithms (pure functions of a time in ms, exported):
- Sun: NOAA solar position and sunrise equations (zenith 90.833, iterated). A "solar day" is whole days of local mean solar time, so the date line needs no special case. The Now page shows the solar day whose noon falls on the viewer's calendar day, with a `+1D`/`-1D` marker when a time falls on another calendar day. Polar day and night are explicit statuses.
- Moon: Meeus ch. 49 new and full moon times (main periodic terms, Delta T applied); Meeus ch. 47/48 truncated longitude and phase angle for illumination, waxing and name. Age is measured from the computed last new moon.
- Planets: JPL approximate Keplerian elements with rates (table 1, 1800-2050), Kepler solved by Newton iteration, general precession added for longitudes of date. Mercury to Neptune. Evening, morning, all night and glare come from the signed geocentric elongation (15 and 150 degree limits).
- Seasons: Meeus ch. 27, 24 periodic terms.
Location: seven presets by latitude band (first is mid-continent US 39 N 98 W; nothing is assumed, the page says sun times need a location until one is chosen) and a wizard (N/S, tens, units; E/W, hundreds, tens, units; limits enforced, list starts at current value). Saved with `ctx.saveProgress({schema, lat, lon})`. Local time shows the browser UTC offset and zone name.
Redraw: Now every second, Moon every minute, Orrery and Year once per day (a test counts `content` calls). Paging does not rebuild the actions (stable labels keep focus).

Lamps:
- Now: a warm spot moves left to right from sunrise to sunset (peak about 0.28 of full), deep blue at night (0.08), half-hour crossfades; polar day a warm spot circling the day, polar night faint blue; no location is dark.
- Moon: a pale meter filling from the lit side as drawn (mirrored for the southern hemisphere), peak 0.3.
- Orrery: dark. Year: a dim amber meter of the fraction of the year elapsed. Wizard dark. `dispose()` writes zeros and later ticks write nothing.

## 3. Verification (references fetched 2026-10-01; cited in the test file header)
- Sun: USNO `rstt/oneday`, 18 place/date cases (39N 98W, 52N 0E, equator, 34S 151E, 64N Iceland, 70N Norway, Fiji 18S 178E, Aleutians 52N 176W, NYC, leap day): worst error 0.58 minute over 54 times (rise, noon, set). Polar day and night agree with USNO (no rise or set) at 70N and 78S.
- Seasons: USNO `seasons`, 2024-2027, 16 instants: worst 0.93 minute.
- Moon: USNO `moon/phases/year`, 99 new and full moons 2024-2027: worst 1.51 minutes. Illumination near 0 at new, above 98.5% at full, 50% within 3% at the first quarter.
- Planets: JPL Horizons heliocentric vectors, 8 planets x 6 dates 2000-2045: worst 0.143 degree, distances within 2%. Sky logic checked against published events: Mars opposition 2025-01-16, Jupiter 2026-01-10, Saturn 2025-09-21 (all "all night"); Venus greatest western elongation 2025-06-01 (-45.8 vs 46 published, morning); Venus superior conjunction 2026-01-06 (glare). Screenshot on 2026-10-01 shows Saturn all night (opposition 2026-10-04).
- `node --test tests/*.test.mjs`: 274 tests, 274 pass (26 are EPHEMERIS). Python suite: 29 OK. `build-catalog.py --check`: in sync. `build-demo.py` + `node tests/browser-smoke.cjs`: passed, no page errors.
- Screenshots in `fleet/work/tool-ephemeris/shots/`: `ephemeris-now-nolocation.png`, `ephemeris-now.png`, `ephemeris-presets.png`, `ephemeris-moon.png`, `ephemeris-orrery.png`, `ephemeris-year.png` (and `ephemeris-south-now.png`, which actually shows the dashboard card with the new icon after a mis-aimed tap). `dev-shot` reported "no page or host errors". I fixed what I saw: orrery and year pages overflowed the fold (resized), year-curve label overlapped the curve (moved), "-1D" shown for tonight's sunrise (now uses the day whose noon is today), preset list clipped (page swaps to a short note while it is open).

## 4. Not done / uncertain
- Not verified on the device; simulator and headless browser only. The simulator's browser clock was UTC-05:00 CDT.
- Not tested visually: southern-hemisphere moon in the browser (unit-tested for path flags and lamp mirror) and a polar location (unit-tested text only).
- Moon illumination ignores lunar latitude and distance corrections (about 1%). Planetary-argument corrections of the phase times (a few seconds) omitted. Uranus and Neptune have no sky status (marked TELESCOPE).
- Wizard digit lists have 10 entries plus back and cancel (12 actions), like the Chronometer's; the host appears to keep the previous focus index when a menu changes, so entering the preset list can start the highlight on the third item.
- Out of scope, noticed: `scripts/dev-shot.cjs` needs `PYTHON` set to the venv interpreter in worktrees without `.venv`.

## 5. Branch
`worktree-agent-ab01b26ecebaa47d6`, last commit `ceb96c6`.
