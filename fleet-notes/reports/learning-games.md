# learning-games (desktop, 2026-10-01; branch claude/learning-games-zz2pnu)

## Outcome

Echo Vault and Glyph Archive are rebuilt as learning games, as Sam asked ("would prefer to be learning").
Echo Vault teaches Morse by keying words against a timer; Glyph Archive teaches real symbol systems
(Braille, Greek, chemical elements, the radio alphabet) with fast match / no-match cards. Both use one
spaced-practice model (`web/apps/learning.js`), migrate the old saves, and pass all eight suites except one
Perihelion bot test that also fails on `main` in this environment. **Nothing here was verified on the device.**

## Second pass: depth and visuals (Sam, 2026-10-01 23:05: "their own game that you can sink time into")

- Both games: a rank from experience (Echo CADET to LEGEND OF THE BAND, Glyph NOVICE to LOREMASTER), one
  daily contract (same all day, +150 XP) and feats (13 Echo, 12 Glyph). Shared helpers `rankOf`, `dayIndex`,
  `dailyFor`, `award` in `learning.js`. New save fields (xp, contracts, feats, daily; Echo stations; Glyph
  plates) migrate inside schema 2, with tests; full saves stay well under 8 KiB.
- Echo Vault: the last word of each 30-word shift is a far station's call sign (contact, double points);
  keying it logs the station (20 to find). The vault door's 30 tumblers fill as words clear, the key trace
  scrolls as a scope with sparks, the timer is a travelling packet. Hold on the title: code card, then the
  logbook (stations and feats), then back.
- Glyph Archive: each wing is split into plates (Braille 3, Greek 4, Elements 4, Phonetic 4); a plate is
  restored (+100 XP) when every entry on it reaches strength 3. New hall backdrop, slabs slide in, verdict
  stamp, combo pips, wax seals. Holding past the last wing opens the archivist's desk (rank, all plates,
  feats); a tap goes back.

## Third pass: the platform review (2026-10-02)

- Echo unlock pacing: strengths now settle once per session from each item's whole-session record
  (`tally` / `settle` in `learning.js`), not per answer, so one slip no longer cancels the step. A weak item
  answered from memory 4+ times at 75%+ goes straight to strength 2. A bot that slips on 10% of letters now
  opens a fifth letter after its first shift and keeps opening one a shift (test, three seeds).
- Glyph Archive: the first time-out in a row costs no seal and is not a spaced-practice miss (the next one
  in a row does cost a seal); weak entries get 0.8 s more; the shortest window is 2.2 s (was 1.5). New
  "which of two" cards from card 5: a symbol and two meanings, tap for the upper, hold for the lower.

## Details

**Echo Vault** (`web/apps/echo.js`, whole file replaced)
- A run is a shift of 30 transmissions. Each is a word (or, while letters are few, a code group) made only of
  open letters; key it letter by letter (tap a dot, hold a dash; the dash line is two Morse units at the
  Calibration speed). A right letter is accepted the moment its code is complete; a wrong element is a miss at
  once (its code is then shown and played on the lamps, and it costs a second); an unfinished letter counts
  as sent after a 1 s pause. Three shields; a transmission that runs out costs one. Thirty cleared = VAULT OPENED.
- Teaching: starts with E T A N (Signal School's order), each introduced on a NEW LETTER card (shown, played
  twice, then asked alone twice). One more letter opens after a run once every letter in play has strength 2
  (the newest 1). Letters Signal School has taught are open too: it reads `progress.morse.index` and never writes it.
- Hints fade with strength: code at once at strength 0, after 1.5 s at 1, 3 s at 2, 5 s at 3, only after a miss
  at 4 and 5. An answer with the code showing does not strengthen a letter (except the very first meeting).
- Something new through the shift: echo transmissions from the 7th (heard, not shown; key back what you heard;
  a 1 s hold or the menu plays it again for a second of the timer), priority traffic every 5th from the 11th
  (double points, 25% less time), every third an echo from the 15th, longer words from the 19th; think time per
  letter shrinks from 2.6 s to 0.6 s. A shield returns every 8 cleared words.
- Title: the 26-letter wall with strength bars, bests, days practised. Hold on title/result for the code card.
- Lamps: playback (dot = middle amber, dash = all cyan, as Signal School); key down = lamp I amber, all cyan past
  the dash line; otherwise the transmission timer as an emptying bar (green, amber, pulsing red; violet for
  priority); green sweep per letter, red sweep then the right code after a miss, red blinks when a word is lost.

**Glyph Archive** (`web/apps/glyphs.js`, whole file replaced; class name `GlyphVault` kept)
- Four wings: BRAILLE (26, taught a-j, k-t, u-z, w), GREEK (24 letters and names), ELEMENTS (40 symbols with
  atomic numbers), PHONETIC (ALFA to ZULU). Hold on the title to change wing.
- A card shows a symbol and a meaning: tap = MATCH, hold 0.4 s = NO MATCH (answered the moment the hold gets
  there; the lamps fill red while you hold). A card left alone is wrong. 30 cards a session, three seals; a seal
  returns every 10 right in a row; every 10th card is a relic (triple points). From card 9, stronger entries
  are also asked meaning first. Wrong pairs are picked to be confusable (Braille one or two dots apart, symbols
  sharing a letter); after a mistake the right pairing is shown.
- New entries: four on the first session, then two more each session while every open entry has been met and
  at most four are weak. A true pair recognised is what strengthens an entry.
- Lamps: the card timer in the wing's colour (amber on a relic), pulsing red in its last quarter; red filling
  while a hold heads for NO MATCH; green sweep / red blinks for right / wrong; wing colour breathing on a new entry.

**Spaced practice** (`web/apps/learning.js`, new): per item `[strength 0-5, due session, hits, misses]`;
strength rises at most once a session and only when due or weak; a miss drops one step at most once a session;
intervals 0, 1, 2, 4, 7, 12 sessions.

**Saves**: both are schema 2. `migrateEcho` / `migrateGlyphs` load nothing, the first release's `recordRun`
shape (`{schema:1, runs, last, milestone}`; runs and milestone carry over) and schema 2; malformed records are
dropped. A full save is under 2 KB (Echo) and 6 KB (all four wings). The field record keeps `runs`, `last`,
`milestone`, so the host's FIELD RECORD still works (catalog `record` labels added).

**Shared files touched (minimal)**: `vesper/catalog.json` (these two entries only: subtitle, description,
controls, category PLAY / LEARNING, record labels) and the regenerated `web/apps/catalog.js`; the old-mechanics
tests for these two games in `tests/engine.test.mjs`, `games.test.mjs`, `games-gesture.test.mjs`,
`games-tuning.test.mjs` were rewritten for the new games (same properties: result lockout, score on leaving,
gesture rewind, lamps, legibility); `tests/gesture-apps.test.mjs` now compares Glyph Archive's whole state
(it uses AppGuard now). No engine, host or service change. Scores still use the `default` metric (the old
`glyphs:scan*` scores stay in the database, unused); old Echo bests (sequence counts) are below new scores.

## Verification (desktop container, not the Pi)

- Second pass: `node --test tests/*.test.mjs` 842 pass, same 1 Perihelion failure; echo 20 and glyph 15
  tests; the other seven suites pass; new screenshots (Echo title, code card, logbook, play, result; Glyph
  title, play, result, desk) opened and checked, logbook column clipping fixed.
- First pass: `node --test tests/*.test.mjs`: 837 pass, 1 fail. The failure is Perihelion's planning-bot test (seed 3003
  falls); it fails the same way on unmodified `main` here.
- `tests/echo.test.mjs` 17 and `tests/glyphs.test.mjs` 13 tests: migration from the old save, Signal School
  letters, keying, hint fading, spacing, unlocks, competent vs idle bots, lamps, three stray taps, lockout.
  Bots: a competent Echo player opens the vault on three seeds (scores > 2000), an idle one is sealed at 0;
  Glyph competent (97%) completes 30 cards on three seeds and scores over 3x a guesser.
- Python 189 OK (1 skipped); `build-catalog.py --check` clean; `build-demo.py`; browser-smoke (26 apps),
  extension-smoke, host-browser, voice-host all pass.
- Screenshots at 1024 x 600 (opened and checked): Echo title, new letter, play, echo, result, code card;
  Glyph title (Braille, Greek), new entry, play (Braille, Elements, Greek), hold, reverse, result. "No page or
  host errors". Copies in the project files under `learning-games/`.

## Not done / uncertain

- Not played on the node: dash line and gaps by feel, lamp levels, how Greek and the Braille cells read on
  the 7-inch screen, whether 30 cards / 30 transmissions is the right session length.
- `tests/audit/balance.mjs` and `tests/audit/gesture.mjs` (manual audit scripts, not in the suites) still
  drive the old mechanics of these two games and would fail if run.
- Contract and feat thresholds are guesses until Sam plays them; the streak only feeds the week feats.
