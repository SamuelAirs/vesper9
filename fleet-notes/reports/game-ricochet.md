# game-ricochet (written by the coordinator from the agent's hand-back; the agent's own Write to this path was refused)

Branch worktree-agent-ae1deddfbf975dd26 @ a580ae4, merged. Simulator only.
- Breakout with a never-stopping paddle; tap reverses. Amber bracket marks the landing point. Bonus cells (wide paddle, slow ball, second ball), two-hit cells, faster balls, narrower paddle. Three lost balls end the run.
- Lamps: spot follows the lowest ball, green to amber to red as it drops; broken cell sparkles its third; lost ball washes red; cleared chamber chase.
- Escape "hold"; hold-to-slow dropped (bot scored worse with it); a hold over 0.6 s freezes the world; cancel() returns a ball lost as a gesture began.
- Bot tap-only, 8 seeds: dies 135-495 s (mean ~330 s), chambers 2-7, mean ~4300. Sloppy bot (230 ms latency): 140-340 s, ~2900. Idle out in ~15 s. Longest stretch without a broken cell 12.6 s. Landing prediction 291/300 within 8 px.
- Not done: real three-second-hold gesture through the host; bonus marker easy to miss; late-game ball gives little reaction time; straggler auto-steer untested by a human; sound not judged.
