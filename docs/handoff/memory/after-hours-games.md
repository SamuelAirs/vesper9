---
name: after-hours-games
description: ChatGPT's four games from the game kit ("After Hours"): where they are, controls, lamp-4 roles, what's pending (updated 2026-10-03)
metadata:
  type: project
  modified: 2026-10-03T01:11:37.581Z
---

2026-10-02 Sam sent ChatGPT's games built from [[game-kit-guide]]. Zip + review: /mnt/project-files/after-hours/ (REVIEW.md). Sam: add all four. Draft PR #20 (branch claude/project-thread-v82g5q, base = PR #16 branch claude/platform-polish-2t56t4; retarget to main after #16 merges). AFTER HOURS sector after MIND. Merge waits for Sam's playtest.

2026-10-03 first playtest: Sam didn't understand Crawlspace, Supper Club or Night Grid. Pocket Links was "really good, needs a little polish" (unspecified; asked him what). Rework pushed as 8ca3640, plus merge ce2e650 of #16's newer commits:
- Shared web/apps/after-hours-kit.js: tap = next choice; hold 0.5 s and release = do it (the release-based choice keeps the menu gesture safe). Scanning cursor removed. HOW TO PLAY on first launch (save flag `guided`, schema still 1) and in the system menu.
- Lamp 4 (only when ctx.lampCount() is 4): Crawlspace = health (blinks when the next hit is lethal), Supper = table closest to leaving, Night Grid = battery, Pocket Links = where the shot stops (green cup / amber nearer / red water). Board LED unused.
- Supper: the world slows while the button is down; releasing on a cooking pan is harmless.
- Save slots: only Crawlspace opts in (one house per slot; new slot 2-4 skips the guide). In-game menu item is GAME GUIDE (console already has HOW TO PLAY / CONTROLS). Head d800b42.
- GAME-KIT.md updated 2026-10-03: four lamps, teach-yourself rule, tap/hold-release scheme, save slots.
- Tests 66 for the four games; the full JS suite fails only the known Perihelion seed-3003 test.
