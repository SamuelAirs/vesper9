# Outpost 0.3 and 0.4: the lead's plan for mechanics and the long game

Owner: the "Lead Outpost: mechanics and the long game" thread (PR #15, branch
`claude/outpost-lead-kasrgw`). This is the contract for the visuals thread (PR from
`outpost-scene.js`) and the sound-and-lamps thread (PR #17). Everything below is on the branch
(pushed). Nothing here was checked on the device.

## Why
The 2026-10-02 review: "Lovely musical tapping; BUY ALL automates the only decision. Taper tap
value above about 2 taps a second; give purchases real choices." Sam wants better visuals, more
mechanics and longer gameplay. Playtest lessons: pace, flow and fair difficulty matter most.

## 1. Easy pace
The hand holds a reserve of `PACE_BURST` (3) taps that refills at `TAP_EASY` (2.5/s; 8/s in a
tap frenzy). A tap spends one, or what is left, and is worth that share. Phrase bonuses take
the same share; a tune's bonus takes the average over its taps.
- `app.charge` the reserve after the last tap; `app.reserve()` now; `app.paceNow()` 0..1, the
  share the next tap gets; `app.tapValue()` includes it, `app.tapValue(false)` does not.
- Footer hint while tapping too fast: "Easy does it: a steady beat pays as well as fast tapping."

## 2. Hum: machines tuned to notes
Every machine is tuned to one pitch class (`PROD[i].pc`, 0 = C .. 11 = B; `PROD[i].short`, a
short name; `PROD[i].sky` true for sky machines, false for ground ones). Finishing a tune makes
the machines tuned to its three commonest pitch classes hum: output x`humMultOf(s)` (1.5, more
with the HARMONICS tree node, at Echo Canyon, and once the call is answered) for `humSecOf(s)`,
stacking up to `humMaxOf(s)`. A tune finished in full groove hums twice as long.
- `app.hum` Float64Array(NP): seconds of hum left per machine (this visit only, not saved).
- `app.humK[i]` the multiplier each machine has now (1 when quiet).
- Cue `"hum"` when a finished tune starts machines humming (after the tune flourish).

## 3. Sites and soundings
Relocating offers three sites (`app.s.of`, site indices). Each changes the next run's rules and
holds two SOUNDINGS to take (objectives; "survey" in the code). Every sounding is +10% output for
ever and decodes a fragment of THE CALL (once the call is whole, a sounding turns up a relic
instead). The first run is at the LANDING SITE (no rules).
- `SITES[k]`: `{ n, terrain, req, hint, rule: [lines], lore, sv: { k, t: [I, II] }, fx }`.
  `terrain` is a key for drawing: "plain", "ridge", "basin", "flats", "glacier", "canyon",
  "crater", "coast", "fumaroles", "shelf", "dunes", "silent". The scene chooses how each looks.
- `app.s.site` the site now; `app.s.sv[k]` soundings taken at site k (0..2); `surveyOf(s)` the one
  to take here: `{ k, lvl, t, v, frac, text }` (`t` null once both are taken).
- The relocation card has `card.site` (the new site) and `card.from` (the old one).
- Cues: `"survey"` (a sounding taken), `"site"` (a new site came onto the map).
- Ring: the main ring has a SOUNDINGS entry (`to: "site"`), opening a menu with id `"site"`
  (please title it, for example "SOUNDINGS"). The relocation menu lists the offered sites
  (`kind: "reloc"`, `site`).

| Site | Rules | Sounding I / II | On the map |
|---|---|---|---|
| Landing Site | none | 5 / 20 tunes | at the start |
| High Ridge | sky machines x1.5, ground x0.75 | build 60 / 150 of one sky machine (the HEAD START kit doesn't count) | at the start |
| Sink Basin | ground machines x1.5, sky x0.75 | build 60 / 150 of one ground machine (the kit doesn't count) | at the start |
| Salt Flats | taps x3, tune bonuses x3, machines x0.8 | 1,200 / 3,600 taps | at the start |
| Glacier | machines x1.4, away +8 h, taps x0.5 | 1 / 4 h running untended | 8 bearings |
| Echo Canyon | hum +0.5 and twice as long, tune bonuses x2, machines x0.9 | 15 / 45 tunes | 20 bearings |
| Crater Rim | flares twice as often, machines x0.7 | 6 / 18 flares | 40 bearings |
| Rust Coast | expeditions twice as fast, relics 50% more likely | 3 / 9 expeditions | 6 bearings and a survey team |
| Fumarole Field | data x3, research twice as fast, machines x0.9 | 25 / 75 data | 60 bearings and one research |
| Aurora Shelf | groove fills twice as fast, full groove x2, tune bonuses x2 | 400 / 1,200 taps in full groove | 150 bearings |
| Drift Dunes | machine prices rise slower, upgrades x2 | 300 / 900 purchases | 400 bearings |
| The Silent Coast | silent arrays x3 | answer the call 1 / 3 times | the whole call |

## 4. THE CALL: the long arc
A melody hidden in the signal (44 notes in C# minor), decoded four notes at a time: a fragment
per sounding at the eleven ordinary sites, eleven in all. In the simulations a player who taps a
quarter of the time and stays for each sounding hears the whole call after eight relocations (about
five to seven hours of play, with the workshop); one who taps all the time, after two to four hours. The songbook gains THE CALL once a fragment is
decoded; it plays what is decoded and a low drone (C#4) where notes are still hidden. Each
fragment comes with a log line. With all eleven, the Silent Coast comes onto the map and is
offered first; playing the call through there answers it: the finale (all output x2 for ever,
hum +0.5, and the call gains a 9-note answer phrase: "THE CALL AND ANSWER"). Play goes on
(second soundings, constellations).
- `app.s.cf` fragments decoded (0..11); `app.s.ans` is 1 once the call is answered, else 0.
- `CALL_ID` (101) is the songbook id: `app.s.sg === CALL_ID` while it plays. `app.mel.hidden[i]`
  marks a note still hidden (it plays the drone).
- `app.finale` `{ t }` for `FINALE_SEC` (12) s after the answer (for drawing), else null.
  `FINALE_SEC` is exported from outpost-rules.js: import it rather than copying the number.
- Cues: `"fragment"` (a fragment decoded), `"answer"` (the finale).
- `CALL_LOG[i]` the log line of fragment i+1; `CALL_ANSWERED` the closing line.

## 4b. The late game
"Relocation ready" (`readyOf`) asks for a gain of `readyRatio(L)` times the bearings held: 2 below
500, 1.6 below 5,000, 1.35 below 20,000 (unchanged), and past `READY_LATE` (20,000) it keeps falling
as 1.25 x (20,000 / held) ^ 0.3, to `READY_FLOOR` (0.2). With the old fixed 1.25, the runs after the
call was answered took 4 to 10 hours each in the simulations; now they stay mostly between 20 minutes
and two hours until about 26 hours of play for the quarter-time player (about 22 for one who taps
all the time).

## 4c. The workshop (0.4, save schema 6)
The review's other point: give purchases real choices. Each site's first sounding brings back the
blueprint of a fitting (its second sounding, the MK II). With `FIT_OPEN` (3) blueprints the
workshop opens: `FIT_AT` (3, 10 and 25) minutes into each run it builds a fitting, and the player
chooses which of up to three offered blueprints to fit. Fittings last until the outpost relocates.
A fitting is a share of its site's rule with no drawback, folded into `siteFx(s)`.
- `FIT[k]` belongs to `SITES[k]`: `{ n, fx: [MK I, MK II], d: [[lines], [lines]], s? }`. Names:
  SPARE PARTS, SKY RACK, GROUND RACK, SPRING KEY, NIGHT BATTERY, HUM COIL, FLARE MAST, FIELD KIT,
  SPECTROMETER, METRONOME, SAND SLED, QUIET ROOM.
- `app.s.ft` the fittings fitted this run (FIT indices, at most 3; saved). `fitMark(s, k)` 0 (no
  blueprint), 1 (MK I) or 2 (MK II); `fitName(s, k)` adds " II"; `blueprints(s)`; `workshopOpen(s)`.
- `app.fitWaiting()` a fitting waits to be chosen; `app.fitOffer()` the offered FIT indices.
- Ring: the main ring has WORKSHOP (`to: "fit"`), first after the songbook (and where the ring
  opens) while a choice waits, else just before SOUNDINGS. Its menu id is `"fit"` (please title
  it "WORKSHOP"); offered blueprints are entries of `kind: "fit"` with `k` (please make the hold
  verb "FIT"). The SOUNDINGS view has an entry (`key: "blue"`) for the site's blueprint.
- Cues: `"workshop"` (a fitting is ready to choose), `"fit"` (one was fitted).
- Notes: "BLUEPRINT: ...", "THE WORKSHOP IS OPEN: ..." (story notes), "THE WORKSHOP BUILT A
  FITTING: ...", "<NAME> FITTED: ..." (passing notes).
- Balance: over six simulated seeds the call is answered about an hour sooner than without
  fittings (5.2 to 7.0 hours for a player who taps a quarter of the time).

## 5. Console logbook (PR #16)
Outpost has no daily or feat list of its own. Milestones go to `ctx.feat(id, name)` (once each,
remembered in the save as bits of `s.fe`), and when Outpost is one of today's three it states a
musical order with `ctx.daily(text)` and calls `ctx.dailyMet()`. All optional calls, so Outpost
works with or without #16.

## 6. Smaller changes
- Ring entries: `sub` is the right-hand label only (short: "5/17", "+12", "40%"); the sub-menu
  id is `to`.
- The update card's text comes from the cartridge: `app.newsCard()` -> `{ title, lines }` (at most
  six lines of at most 52 characters). The scene still hard-codes the schema 3 text; please draw
  this instead.
- Story notes (`queueNote`: soundings, fragments, new sites, the answer) are never cut short.
  They carry `app.note.story === true`; while the ring, a view or a card covers the station, a
  story note goes back in line (`app.noteQ`) with the time it had left. A passing note (`setNote`)
  set during a story note waits its turn and is dropped if it waited over 8 s.
- Save schema 5 (adds site, sx, sv, of, cf, ans, fe); schema 6 adds ft; schemas 1-5 migrate.
