# Finished-node refresh: what actually changed

The refresh contains a broad node-focused pass, two new games and further
playability/reliability work. Release `60adf7a`, including the dedicated High Bar
polish, was installed as a save-preserving Pi trial on 2026-10-03. The owner's
first play feedback now directs a separate Windows High Bar airflow revision.
That revision has not replaced the trial. The source table below describes the
earlier investigation; current paths and rollback are in
[Pi acceptance](PI-ACCEPTANCE.md).

## Assessment

Vesper's strongest qualities are its field-instrument identity, local services,
immediate button input, owned lamp feedback, saveable progression and useful
offline readers. High Bar has a substantial skill loop; Wayfinder adds slower
planning; Twinbeat adds a structured rhythm campaign. The Stacks and Encyclopedia
are a good fit for a self-contained console.

Its weaknesses have been uneven onboarding, shallow or poorly explained loops
in some cartridges, features developed on disconnected draft branches, and
validation that proved isolated rules better than complete journeys. This pass
found real failures by extending those journeys: menus obscuring their chosen
actions, a reader retrying failures continuously, saved article positions being
ignored, and unacknowledged saves silently disappearing on disconnect.
Independent review then caught two edge cases in the new retry path: launching
before initial saves loaded, and overwriting changes from another tab on
reconnect. Startup gating and baseline/ownership conflict resolution address
both; the regressions retain their reproductions.

The refresh improves those foundations. It does not establish that every game
is now deep, that the finished case reliably distinguishes sides, or that the
Pi renders every screen smoothly. Those need human play and physical acceptance.

## Coverage

| Area | Earlier candidate | Additional polish |
| --- | --- | --- |
| Windows development | Native startup/health, portable test runners, simulated final node, source identity, packaging and CI definition | Full-registry sustained soak, actual utility/game journeys, recorded High Bar routes and failure/reconnect tests |
| Navigation and node | Generic previous/back taps, both sector directions, optional left/right calibration, four lamps/board, preserved low-tone guard | Preview focus follows every input path; game-specific menu actions reveal the selected game screen |
| High Bar | Manuals, shove-its, regrips, variety scoring, twelve lines, medals and practice | All twelve lines demonstrated within their attempt clocks; fairer style acceptance, corrected manual overtime, coaching, first-use guidance and explicit mode records |
| Other existing games | Appropriate case actions and lamp roles across the catalog | Eight-game progression audit; Ricochet reached-room practice and immediate unlock persistence; representative actual-physics pilots |
| Readers and utilities | Stacks/Encyclopedia reverse pages, bookmarks and saved trails; four-lamp Lantern/Cadence | Bounded chapter retry, recent article resume, article-end navigation, cleaner real article text, correct lamp previews and selected timer labels |
| New games | Wayfinder and requested Twinbeat | Regression, persistence and browser verification retained; no third game added |
| Save reliability | Durable service storage, slot/lifetime protections | Acknowledged bounded retry for progress/scores and visible storage failure; hardware actions never replay |

The detailed [existing-game review](GAME-POLISH.md), [High Bar notes](HIGH-BAR.md),
and [utility report](UTILITY-POLISH.md) distinguish implemented changes from
remaining design work. Fresh final counts and artifacts are in
[validation](VALIDATION.md) and [the worklog](WORKLOG.md).

## Source relationship before the Pi trial

| Location | Evidence | Relationship |
| --- | --- | --- |
| Original Windows checkout | `C:/Users/ayers/vesper9`, main `5db9ae8`, investigation work preserved | Separate from development candidate |
| Windows development checkout | `C:/Users/ayers/vesper9-development`, `codex/console-polish`, parent candidate `b818558` | Current local candidate; final commit/hash in delivery manifest |
| GitHub main | `5db9ae8`, fetched again 2026-10-03 11:10 UTC | No push/merge performed in this polish pass |
| Pi main checkout | `vesper9/`, clean main `5db9ae8` at last check | Not the service source |
| Pi running source | `live/`, detached `f3bfacc`, service path and source/served-file hashes verified earlier | Older combined build; not synchronized to this candidate |
| Pi node source | `node2/`, `b9079f1` at last check | Source checkout, not a binary readback |
| Connected ESP32 | Reported node `0.2.0`, four lamps, two microphones, board LED | No firmware changes or flash performed |

The last Pi status check was 2026-10-03 04:54:04 UTC. Pi facts are dated evidence,
not a new device check during the polish work. GitHub was refreshed: #22 remains
open at `8aafd35`; the current heads of #4, #11, #12, #16, #19 and #20 are all
ancestors of this candidate. A deployed-source match
requires verifying the actual service and served files after an agreed trial.

## Next decisions and acceptance

1. The [save-preserving Pi trial](PI-ACCEPTANCE.md) is running. Preserve its
   progress alongside the original live source/data. Review and validate the
   owner-directed airflow revision on Windows before the next agreed switch.
2. On the deck, test generic menu/back taps, normal holds and menu cancellation;
   then High Bar, Ricochet practice, Stacks/Encyclopedia resume and Twinbeat's first
   two levels. Report misses, false taps, unclear rules and frustrating timing.
3. Enable optional side mode only after checking left/right/back confusion in
   the actual posture. Twinbeat's case-delay setting is provisional until then.
4. After ordinary play, take a brief resource/status snapshot. Keep builds,
   broad tests and benchmarks off the battery-powered Pi.
5. After acceptance, choose the authoritative candidate data directory and the
   GitHub merge path. Decide separately whether Vesper should start at login.

The most useful feedback is which existing game still feels shallow, whether
High Bar's controls are readable in motion, and whether the readers resume at
the expected place. Software fixtures cannot substitute for those observations.
