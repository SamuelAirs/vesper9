---
name: high-bar-game
description: HIGH BAR skate-park trick game (Sam's swing-tricks idea, 2026-10-03): draft PR #21, where it lives, design choices, what waits
metadata:
  type: project
  modified: 2026-10-03T01:02:47.337Z
---

2026-10-03 Sam (after playing Perihelion) asked for a Perihelion-like swing game that feels like a skate park or jungle, scored on tricks. Pitch accepted 00:45 UTC; he picked the skate park.

- DRAFT PR #21 (https://github.com/SamuelAirs/vesper9/pull/21), branch claude/swing-tricks-game-atb3k6, base = PR #16 branch claude/platform-polish-2t56t4 (four-lamp ctx). Retarget to main after #16. Owned by thread "Swing tricks game".
- id `highbar`, ARCADE page (6th slot; conflicts with #11's Descent removal, so keep both), voice "high bar" / "skate".
- One button by context: hold near a bar to swing, on the ground to pump (release = ollie), in the air to tuck and flip. Combo = sum × trick count, banks after a 1.2 s roll, lost on a bail. 2-minute sessions; 4 parks × 5 goals, 3 goals open the next park; 3 save slots on the setup screen (hold on the title).
- Bot playtest: a perfect bot rarely banks (one long combo per session) and scores 40k+, so it may be too easy. Tune it after Sam plays.
- Not tried on the console. Merge waits for Sam's playtest.

Related: [[after-hours-games]], [[game-kit-guide]]
