# Outpost map: branch `claude/tideline-outpost-depth-l5bknl` @ 146e136 (draft PR #8)

Main has moved 2 commits ahead (GitHub Pages workflow and README). Neither touches Outpost, so there
is no conflict. No other remote branch touches any Outpost file. About 10 branches edit `vesper/catalog.json`
and 4 edit `web/apps/registry.js`, so treat both as conflict hot spots. Baseline: `node --test tests/outpost.test.mjs`
gave 56 pass and 0 fail in 2.9 s (Node 22).

## Files owned by Outpost
| File | Lines | Purpose |
|---|---|---|
| `web/apps/outpost.js` | 2082 (115 KB) | The whole game in one ES module and one class (`export class Outpost`). |
| `tests/outpost.test.mjs` | 1083 | 56 tests: economy, bot pacing, ring and guard, lamps, save/offline/migration, music, groove, constellations, draw, perf. |
| `tests/helpers/outpost-bot.mjs` | 76 | Simulated mixed player (active windows plus check-ins, fake `Date.now`) for the balance tests. |
| `tests/helpers/outpost-sim-cli.mjs` | 6 | Prints the bot's run timeline (minutes to each layer and to relocation). |
| `tests/helpers/outpost-songs-cli.mjs` | 16 | Prints every melody as note names, to check against the printed music. |
| `tests/fixtures/outpost-save-v2-mid.json`, `-upgrades-v2.json`, `-save-v3-late.json` | 1 each (395 B / 1.6 KB / 916 B) | Real older saves used by the migration tests. |
| `fleet-notes/reports/game-outpost.md`, `depth-outpost.md`, `depth-tideline-outpost.md` | 40 / 11 / 63 | Design and balance history (the last report also covers Tideline). |

Sections inside `outpost.js`, with line ranges:
- 1-29: header and imports (`engine/draw.js`, `engine/math.js`, `engine/lightshow.js`). It does not use `game-kit.js`.
- 30-178: content tables: 12 machines `PROD`, upgrades `UPG`/`SYN`/`VOICE`, the 13-node `TREE`, `KIT`, `EXPED`.
- 180-327: songbook (17 public-domain tunes) and the seeded tune generator `genTune`.
- 329-419: research (`RES`, 6 projects), 38 `GOALS`, `STAGES`, 12 constellations `CONST`.
- 421-532: pure economy (cost, multipliers, `evaluate`, prestige gain, ready rule, visibility) and number formatting.
- 534-597: save `serialize` and `migrate` (schema 4; schemas 1-3 migrate and unknown future fields are kept).
- Class: 600-697 constructor and offline credit · 699-912 derived state and economy actions (buy, relocate, expeditions)
  · 914-964 research and goals · 966-1065 song playback and voices (`sound()` at 982) · 1067-1086 effects
  · 1088-1226 input, groove, gather, flare · 1228-1451 build-ring menus (main, exp, tree, songs, res, goals, reloc)
  · 1453-1473 saving · 1475-1594 `update()` sim and autobuild · 1596-1635 `lampValues()`
  · 1637-1655 HUD and hint · **1657-2077 all drawing (~420 lines)** · 2079-2082 `Outpost.music` and `Outpost.econ`
  (the test and bot API).

## Shared files that touch Outpost (one owner at a time, per `fleet-notes/START-HERE-DESKTOP.md`)
- `vesper/catalog.json` (604 lines): Outpost entry at L363-376 and sector "PLAY III" at L41. The generated copy is
  `web/apps/catalog.js` (551 lines, L300-313); never edit it by hand. Regenerate with `python3 scripts/build-catalog.py`.
- `web/apps/registry.js` (39): import at L22, list at L33. `tests/gesture-apps.test.mjs` (221): Outpost `pick` at L66
  and asserts at L152 and L156. `tests/test_catalog_sectors.py` (166): L20.
- Engine modules it imports: `web/engine/draw.js` (178), `math.js` (191), `lightshow.js` (53), and `audio.js` (131) via
  `ctx.tone`. This branch added an optional `gain` argument to `audio.js`. Test harness: `tests/helpers/app-context.mjs`
  (66). Branch `project-thread-79km6i` also edits it.
- Docs: `docs/ENGINE.md` (145; the `tone` row), `docs/WORKLOG.md` (72), `fleet-notes/STATUS.md` and `FEEDBACK-1.md`.
  `docs/OPERATOR.md` has no Outpost section. `web/main.js` (1086) does not reference Outpost; the host gesture lives there.
- `scripts/build-demo.py` bundles every `web/**/*.js` automatically. Its regexes accept only
  `import { a, b } from "./x.js"` and `export const|function|class Name`, one name per declaration. No `export default`,
  `export {}` or `import * as`. Import cycles break the bundle, because exports are assigned at the end of each module.

## Current mechanics
- **Input.** A tap gathers signal and plays the next note of the current tune, so the player's rhythm is the tempo.
  A 0.42 s hold opens the build ring. In the ring, a tap steps to the next entry and a hold of at least 0.45 s chooses
  it. An entry must stay highlighted for 0.7 s first, which stops tap-tap-hold from buying anything. Relocating needs a
  sub-menu, a 1.2 s dwell and a 1.2 s hold. The ring closes after 7 s idle. The host menu gesture (tap, tap, hold) rewinds
  the notes it played (`unplay`).
- **Economy.** 12 machines, with cost x1.15 per machine owned. Owning 10/25/50/.../300 of one doubles it. There are 3 x2
  upgrades per machine, plus tap upgrades, battery banks (offline cap), Grid Sync x1.3, and +2% links between neighbouring
  machines. "Buy all" is greedy. Numbers are clamped to 1e150.
- **Prestige.** Relocation gives bearings = floor((run signal / 1.2e5)^0.25), and each bearing adds +20% output.
  Bearings buy nodes on the 13-node tree (head start, autobuild, expeditions, research slots, ...). From 1,000 bearings,
  endless constellations (x1.3 each, cost 250 x 1.45^n) are drawn into the sky.
- **Timers on the wall clock.** Expeditions (3 min to 4 h, with relics), research (6 projects, 6 min to 8 h, paid in a
  second currency, "data"), flares (tap to catch: surge, lode or tap frenzy), and offline credit (8 h cap plus upgrades,
  with a "while you were away" card).
- **Music and skill.** The songbook unlocks by lifetime signal. Shuffle and generated tunes come from research. Phrase
  and tune bonuses, mastery at 5 plays (+2%), and 4 extra voices mixed low (`VOICE_GAIN`). GROOVE: taps within 20% of the
  beat build up to x1.5. There are 38 goals (+1% output and 2 data each, some hidden) and 7 visual stages, from landing
  site to the aurora.
- **Lamps.** Left breathes with production. Middle fills amber toward the next buy, then goes steady green. Right shows
  flare, then boost, then expedition, then relocation-ready. Each note glows on a lamp by pitch (cyan in full groove),
  with accent sweeps on top. Lamps dim after 180 s idle.

## Progression and session length (bot figures from the reports; nothing verified on the device)
- No doc gives a "typical session". The design is open-ended idle play with check-ins. The balance model is a mixed
  player: 2.5 min active per 10 min, tapping 4/s, checking in every 2.5 min.
- Run 1 on the original game (before songs were added): first purchase within 8-10 s and first milestone at 0.7 min.
  The first relocation was ready at about 48 min (17.5 min fully active, 56 min casual).
- Latest (seed 1, 25% active): relocations take 30, 20, 31, 36, 53, 31, 61, 50 and 98 min, then about 240 min for runs
  10-11. Very late runs (more than 30k bearings) take hours of mostly idle time, which the offline credit covers.
- The two late machines (Zero-Point Listener and Silent Array) are never reached by the bot, so they are untested for pacing.

## Proposed split: the file is one 2082-line class, so it cannot be divided cleanly as it stands
Three agents editing `outpost.js` at the same time would conflict on every merge. The code does have clean seams,
though (data/rules, class logic, drawing, sound/lamps). So I recommend two phases.

**Phase 0: a move-only extraction (one agent, about an hour; behaviour must not change, as with `split-games`).**
- `web/apps/outpost-rules.js`: lines 30-597, minus the songbook. Content tables, pure economy, formatting, save and
  migrate. Imports only from the engine.
- `web/apps/outpost-music.js`: lines 180-327 (songs and `genTune`), plus `sound()` and a named cue table that replaces
  the scattered `this.arp([...])` calls (buy, milestone, relocate, flare, research, goal, ...).
- `web/apps/outpost-lamps.js`: `lampValues(app)` (lines 1596-1635).
- `web/apps/outpost-scene.js`: `drawOutpost(g, app)` (lines 1657-2077), plus `stepScene(app, dt)` for the visual-only
  animation now in `update()` (lines 1561-1573: act, phase, flash, floats, ripples). `HORIZON`, `HILLS` and
  `FREE_KINDS` move here.
- `outpost.js` keeps the class, input, ring builders, sim and saving, and still exposes `Outpost.music` and
  `Outpost.econ`, so the tests and the bot stay unchanged. The new modules import from `outpost-rules.js` and never from
  `outpost.js` (to avoid a cycle). Split the tests the same way into new files under `tests/`.
- Gate: all 56 tests pass unchanged, then `build-catalog.py --check`, `build-demo.py` and `browser-smoke.cjs` pass.

**Phase 1: three parallel agents, each owning a disjoint set of files.**
- **A: mechanics and the long game (lead).** Owns `outpost.js`, `outpost-rules.js`, `tests/outpost.test.mjs`, the bot,
  the CLIs and fixtures, plus the Outpost line in `tests/gesture-apps.test.mjs` and the catalog entry (edited once, at
  the end). Only A bumps `SCHEMA`, edits `migrate`/`serialize`, or adds saved fields, always with a fixture from the
  previous build. Example work: late-game pacing (the runs over 4 h), the two late machines nobody reaches, new layers,
  meta-progression.
- **B: visuals and scene.** Owns `outpost-scene.js` and `tests/outpost-scene.test.mjs`. Draw is read-only on game
  state, and visual randomness must not use `ctx.rng`, because seeded sequences are part of the tests. B also owns the
  `update + draw < 2 ms` test. Known debt for B: `drawBackdrop` (L1746) and `drawScene` (L1875) create 2 linear
  gradients every frame, against the APP-GUIDE budget. A busy late frame is about 1,290 canvas calls, and the guide asks
  for "a few hundred".
- **C: audio and lamp feedback.** Owns `outpost-music.js`, `outpost-lamps.js` and `tests/outpost-music.test.mjs`
  (melody, voice, lamp and groove-glow tests). Example work: song content, voice timbres, event cues, making better
  use of the lamps (Sam: "the lamps are underused"). The levels are unheard and unseen so far. C needs approval to
  touch `engine/audio.js` or `lightshow.js` (both shared); the report's wish list includes a start-ahead time for `tone`.
- **Contracts.** A may add exports to `outpost-rules.js` but must not rename or remove any during the round. A keeps
  the app fields that B and C read (`s`, `ring`, `entries`, `panel`, `card`, `away`, `note`, `noteFx`, `accent`, `groove`,
  `boosts`, `flare`, `clk`, `t`, `phase_`) and the entry shape (`label, sub, big, lines, aff, cost, kind, hold, dwell`).
  New accent or cue kinds are strings that A emits and C interprets. If B or C needs persisted state, they ask A.

**If phase 0 is skipped:** A owns `outpost.js` outright. B and C work only in new files (a scene layer and a
music/lamp module that take `(g, app)` or `(app)`), and A adds the 2-3 call sites at the end. That is workable for new
content, but B cannot restyle the ring, panels or cards, and C cannot retune cues, without editing A's file.
