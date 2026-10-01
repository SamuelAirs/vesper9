# Fleet status (coordinator log)

Read `PLAN.md` (the plan), `RULES.md` (what every agent obeys) and `briefs/` (exact
agent prompts, with launch parameters in the first line of each file).

## How to resume after an interruption (reboot, new session)

1. `cd /home/sam/VESPER-9-v0.2.0-Claude/vesper9 && git status && git log --oneline | head` — `main` must be clean.
2. `git worktree list` and `git branch` — remove worktrees/branches left by agents that
   died mid-run unless they hold finished, committed work worth keeping
   (`git worktree remove --force <path>`, `git worktree prune`, `git branch -D <name>`).
3. Check the live console: `systemctl --user is-active vesper.service`,
   `curl -s http://127.0.0.1:8799/api/state` (node connected, firmware `vesper-node-0.1.2`).
4. Check `reports/` for audits that finished; relaunch the missing ones from `briefs/`
   with the Agent tool: `subagent_type=general-purpose`, `model=sonnet`,
   `isolation=worktree`, run from the `vesper9` directory.
5. Continue with the next unchecked item below.

## Sam's decisions (2026-09-30 evening)

- Voice sample: Sam agreed, but the first attempt confused him; he wants to record later. Nothing was kept. Use public audio tonight; tomorrow offer a simpler flow (one sentence at a time shown on the console screen).
- Slate, deploy-if-green, kiosk: no answer yet → defaults: slate as in PLAN.md,
  switch the live console only if everything passes, no kiosk.
- Lamps must stay dark and audio muted overnight.

## Progress

- [x] Phase 0.1 lamp colour map (firmware 0.1.2, confirmed by Sam)
- [x] Phase 0.3 git baseline
- [x] Phase 0.4 test tooling: Playwright in `tools/`, free ports, muted audio, `scripts/dev-shot.cjs`
- [ ] Phase 0.2 voice sample (postponed by Sam to tomorrow; needs a simpler on-screen flow)
- [x] Phase 0.5 cartridge extensibility + stubs for the 12 new apps (main 629955c); `APP-GUIDE.md` written for app authors
- [ ] Phase 1 audits: audit-host DONE (report + branch worktree-agent-af2fe1e96da83895f @804a522); audit-games, audit-service, audit-performance, audit-speech resumed after reboot via SendMessage; audit-screens launched (owns web/style.css)
- [ ] Phase 2 build waves: fix-host launched 22:54 (owns web/main.js + engine). NEXT: when audits free CPU, launch 6 game + 6 instrument agents (briefs = APP-GUIDE.md + per-app design from PLAN.md section 5), max ~5 at once; then fix-games, fix-service, light show (after fix-host merges), voice (after audit-speech), layout
- [ ] Phase 3 integration, docs, release, deploy

## Log

| Time | Event |
| --- | --- |
| 22:40 | Plan, rules, git baseline. |
| 22:41 | Launched five audits (host, games, service, performance, speech) in worktrees. |
| 22:45 | dev-shot tool committed (b54f34c). Briefs saved to `briefs/`. |
| 22:47 | Sam will reboot the Pi before bed; voice sample recording in progress. |
| 22:50 | Reboot done; session resumed; five audits resumed. |
| 22:54 | audit-host finished (10 findings). fix-host launched. Prep committed (629955c). |
| 23:05 | fix-host merged (main 5b01c5b; 59 JS / 29 Py / browser suites pass). Live console moved to pinned worktree `~/VESPER-9-v0.2.0-Claude/live` @ b54f34c with `--data vesper9/data/console`; deploy = `git -C live checkout --detach <commit>` + `python3 scripts/build-demo.py` there + `systemctl --user restart vesper.service`; rollback = same with b54f34c. |
| 23:08 | audit-games done (branch worktree-agent-abd2d6379995f1ed6 @5998c22). Launched fix-games (owns games.js, morse.js; defects only), game-pulsar, game-perihelion, game-descent. |

Still to launch: game-ricochet, game-helix, game-ballista; tool-lantern, tool-cadence, tool-ephemeris, tool-oracle (no service work); tool-resonance, tool-telemetry (need service changes: wait for audit-service + fix-service); tune-games (balance + lamps in existing games, after fix-games merges; uses audit-games proposals); lights-host (dashboard glow, focus, hold progress, mic-live, timer alert, brightness setting; main.js + lights; after fix-host, now possible); voice (after audit-speech); cross-review; integration; docs; deploy.
| 23:25 | audit-screens merged (60fa70c). Browser-smoke four-click step was load-flaky; fixed (main 732c584). Running: audit-service, audit-performance, audit-speech, fix-games, game-pulsar/perihelion/descent. Unmerged follow-ups from audit-screens report: canvas text sizes in games.js/morse.js/draw.js (give to tune-games), Atmosphere charts side by side, Orbit HULL empty at game over. |
| 23:35 | game-pulsar merged (main 05bac24, 71 JS tests). Launched game-ricochet, game-helix. Coordinator merge helper: `fleet/tools/merge.sh <branch> "<subject>" "<body>"` (merges, runs all suites, undoes on failure). Still to launch: game-ballista; tool-lantern/cadence/ephemeris/oracle; then service-dependent ones. |
| 23:55 | Merged: game-descent (4e9cf02), fix-games (c03b453; 133 JS tests). Launched lights-host (owns main.js, lights.js, Calibration, settings), tune-games (owns games.js, morse.js, draw.js text), game-ballista. Running also: audit-service, audit-performance, audit-speech, game-perihelion, game-ricochet, game-helix. To launch next: tool-lantern, tool-cadence, tool-ephemeris, tool-oracle; after audit-service: fix-service then tool-resonance, tool-telemetry; after audit-speech: voice. Then Atmosphere/Node Scope improvements (utilities.js, after lights-host merges), cross-review, integration tests for 24 apps, docs, deploy. |
| 23:45 | Merged game-perihelion (cb1844c, 146 JS tests). audit-service done (16 defects; branch worktree-agent-a422913482f099b5e). Launched fix-service (owns vesper/, adds GET /api/system and mic mode `analyze`), tool-lantern, tool-oracle. Running: audit-performance, audit-speech, game-ricochet, game-helix, game-ballista, lights-host, tune-games, fix-service, tool-lantern, tool-oracle. To launch: tool-cadence, tool-ephemeris; after fix-service merges: tool-resonance, tool-telemetry; after audit-speech: voice; Atmosphere/Node Scope upgrade (utilities.js) after lights-host merges. Review notes: PERIHELION idle probe dies in ~2 s (check newcomer experience in cross-review); PULSAR run never ends for forgiving player. |
| 00:00 | Merged tool-lantern (fd19a43, 161 JS tests). Pi hit the soft temperature limit (82 C, throttled=0xe0008, load 16): hold new launches until load < 8; keep at most ~6 agents from now on. |
| 00:25 | All six new games merged (pulsar, perihelion, descent, ricochet, helix, ballista), plus lights-host (8554e37), tool-lantern, tool-oracle. Running: audit-performance, audit-speech, tune-games, fix-service. Launching tool-cadence, tool-ephemeris. |
| 01:00 | Merged: game-ricochet, audit-performance (conflict in main.js status() resolved by hand, 7da6bf6), fix-service (4b15513; Python suite now 131), host wiring for analyze/keepalive (55965d5). Launched tool-cadence, tool-ephemeris, tune-instruments (owns utilities.js), tool-resonance, tool-telemetry. Still running: audit-speech (long), tune-games. Remaining after these: voice (needs audit-speech), cross-review of 12 new apps, integration tests for 24 apps (browser-smoke exercises only the original 12), docs/version 0.3.0, soak, deploy to `live`. Note for morning: keepalive means a hidden/minimised browser tab may lose the microphone after ~20 s+ (Chrome throttles hidden timers); kiosk is unaffected. |
| 01:20 | PI SHUT DOWN (heat; too many agents). |
| Oct 1 08:17 | Resumed. main verified (294 JS / 131 Py / browser suites). Merged tool-ephemeris (2668a50), tool-telemetry (5c8ba87), tune-instruments (9d52c02; 365 JS tests). browser-smoke now exercises all 24 apps (eac727d). |
| 08:27 | DEPLOYED main eac727d to `live` (data backed up to vesper9/backups/data-before-0.3-*). Verified on real node: connected usb, fw 0.1.2, sensor ok, mic off, 6 scores intact. Rollback: `git -C live checkout --detach b54f34c && systemctl --user restart vesper.service`. |
| 08:28 | Resumed tune-games (abb06b2242f0b4428) and audit-speech (a8ab75e5d8678ee89) via SendMessage. RULE FROM NOW: max 2-3 agents, check temp. Remaining: merge tune-games; voice (commands expansion + dictation per audit-speech); cross-review of new apps; docs + version 0.3.0 + release notes + VALIDATION; redeploy; collect Sam's feedback from real device; voice sample with on-screen flow. |
| 08:40 | tune-games merged (aca9251, 428 JS tests) and deployed to live. Next: review-games, review-tools (one at a time alongside audit-speech), then voice. |
| 09:10 | review-games merged and deployed (fd848d3, 446 JS tests). Next: review-tools; voice after audit-speech. |
| 09:36 | Sam is restarting the Pi again. main clean at fd848d3 = live. Running at the time: review-tools (a7fcc4bdbfe40d1ce; 6 commits on its branch, unmerged, no report yet) and audit-speech (a8ab75e5d8678ee89; results in fleet/speech-bench/results, no report yet). AFTER RESTART: check reports/, resume both with SendMessage if unfinished, merge review-tools with fleet/tools/merge.sh, deploy to live, then launch voice (command expansion + dictation per audit-speech), then docs/version 0.3.0/release notes/VALIDATION and Sam's voice sample with an on-screen flow. Max 2-3 agents. |
| 09:50 | review-tools merged and deployed (5c56644, 462 JS tests). Only audit-speech still running. Host follow-ups from review-tools report: reset highlight in launch; focus argument for ctx.actions; quiet-tick hook for CADENCE; Random seeding; persistent lamp program. |
| Oct 1 10:25 | Restarted again. main = live = 5c56644 (462 JS / 131 Py). audit-speech never wrote a report (3 interruptions): coordinator wrote reports/audit-speech.md from its results and decided: Vosk live + Parakeet TDT 110m second pass (sherpa_onnx 1.13.8 + numpy 2.5.3 installed in vesper9/.venv; model copied to vesper9/models/). Launched `voice` (ad94844df9a9f2186): two-pass dictation + expanded voice commands; owns speech.py, server.py, main.js voice handling, Transcription/Settings in utilities.js. Merged agent worktrees cleaned up (audit branches with unmerged failing-test commits kept as branches). AFTER voice: merge + deploy; host polish from review-tools report (reset highlight in launch, focus arg for ctx.actions, quiet-tick hook for CADENCE, Random seeding, persistent lamp program for LANTERN); version 0.3.0, RELEASE-NOTES, WORKLOG, VALIDATION, NEXT-STEPS, release zip; voice sample with on-screen flow if Sam wants. |
| Oct 1 11:25 | ROUND 2 after Sam's feedback (fleet/FEEDBACK-1.md). main 5c3314d has stubs for TIDELINE (fishing) and OUTPOST (idle), 26 apps, 5 sector names (third page temporarily mixed). Running (3 agents, the cap): voice (ad94844df9a9f2186), game-outpost (acd29f913dad48bb1), game-tideline (a0f9447dfc7360ec5). live still 5c56644. |

## Round 2 queue (do in this order, max 3 agents, watch temperature)
1. Merge voice; deploy.
2. HOST: one universal menu gesture, two quick taps then hold ~1 s, in every app and context (replace escape adaptive/hold; update input.js, main.js, GestureGuard users, docs, hints). Plus host polish from review-tools (reset highlight on launch, focus arg for ctx.actions, quiet-tick hook, Random seeding, persistent lamp program for LANTERN). Plus dashboard regrouping: catalog sectors as explicit groups; remove Node Scope, Calibration, Telemetry and Ephemeris from the dashboard (keep reachable from the system menu, except Ephemeris: drop); fold Chronometer into Cadence with a fast timer flow; Atmosphere grouped with sensor readouts + temperature offset setting for case heat.
3. KNOCK INPUT (approved by Sam): firmware detects a sharp knock on the case from the mic and sends only a knock event; reject knocks coincident with button edges; coordinator-only firmware work; needs Sam to test. Protocol addition.
4. Split web/apps/games.js into one file per game (mechanical), then per-game reworks: Moonrunner -> smooth downhill run like Alto's Adventure; Ballista -> Kitten Cannon style distance launcher; Descent faster; Helix responsive / not one-way; Pulsar lamp-first rhythm; Undertow faster ramp + propulsion; Echo Vault -> teaches Morse; Glyph Archive -> learning; Perihelion more depth; Orbit Lock/Ricochet leave.
5. More lamp-and-button-only games (Light Trial family). More educational instruments; Signal School depth; Field Notes paging; Lantern simpler.
6. Docs, version 0.3.0, release notes, validation, release zip.
| 12:15 | Merged game-outpost, game-tideline, voice (main 54dcd73: 541 JS / 177 Py). Deployed to live. No agents running. Next: queue item 2 (universal menu gesture + host polish + dashboard regroup). |
| 12:20 | Launched host-gesture (a944ee7ce28ed87b3: tap-tap-hold everywhere, host fixes, explicit dashboard sectors; owns main.js, input.js, catalog apps/sectors) and tools-round2 (a28598539fb8a1e2a: timer tool in Cadence, simpler Lantern, Field Notes paging, temperature offset; owns cadence.js, lantern.js, utilities.js classes, catalog settings block). After both merge: retire Chronometer from dashboard and point voice alias "timer" at Cadence; then knock firmware (coordinator, needs Sam), then games.js split + reworks. |
| 12:50 | Sam: tapping in OUTPOST opened the menu (four-click gesture). Hotfix: outpost escape=hold (main 62239db, deployed). host-gesture will remove the escape field: resolve the catalog conflict in its favour. |
| 12:55 | Sam's direction for round 3: depth in every game, as deep as we can (he enjoys OUTPOST). Fold this into queue item 4: after games.js is split per game, each game gets a dedicated "depth" agent (progression systems, unlocks, persistent goals, variety, lamp use), in addition to the specific reworks he asked for. |
| 13:10 | Launched depth-outpost (a9b0e1a0d74598222): musical taps + songbook, statistics, more depth; must migrate Sam's existing save. 3 agents running (cap). Agreed round-3 order: Perihelion; Moonrunner (downhill rebuild) and Ballista (distance launcher rebuild); Outpost/Tideline; Descent, Helix, Pulsar, Undertow; Echo Vault and Glyph Archive as learning games; Orbit Lock, Ricochet, Light Trial light touch. |
| 13:20 | tools-round2 merged (5f19a28, 595 JS / 177 Py) and deployed. TODO after host-gesture merges: status bar (main.js) and voice temperature answer (voice.js) must use formatSensorTemp (diffs in reports/tools-round2.md); drop timers from dashboard, alias 'timer' -> cadence + app.openTool('timer'). Running: host-gesture, depth-outpost. |
| 13:35 | host-gesture merged with conflict resolution (Cadence undo gated on gesture match), follow-ups done (offset in status bar + voice, Chronometer retired, 'timer' alias -> cadence); main 66b6cf9: 784 JS / 189 Py; deployed. Running: depth-outpost only. NEXT: knock firmware (coordinator + Sam), games.js split, then depth round in agreed order. |
| 13:40 | Launched split-games (ace55474126128993: mechanical split of games.js into orbit/runner/undertow/echo/reaction/glyphs.js + game-kit.js) and depth-perihelion (a63bfa337a3ff6763). With depth-outpost that is 3 agents (cap). After split merges: Moonrunner downhill rebuild (runner.js), Ballista distance-launcher rebuild, then the rest per agreed order. Knock firmware waits for Sam's availability. |
| 13:45 | Pi restarted again (uptime 1 min at 13:44). main = live = 66b6cf9, clean. Resumed depth-outpost, split-games, depth-perihelion via SendMessage. |
| 14:00 | Merged depth-outpost (2239a6f) and split-games (8581583): 800 JS / 189 Py. Deployed 8581583. Sam: Pi runs from a BATTERY PACK (cyberdeck); the 13:43 outage was power. Running: depth-perihelion only. Sam proposes a GitHub repo so agents can run on his desktop PC with GPU. |
