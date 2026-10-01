# depth-perihelion (saved by the coordinator from the agent's hand-back; branch worktree-agent-a63bfa337a3ff6763 @ 2c51a72)

- Core untouched (constants, tether, release, camera, first region's world pinned by digest test).
- Journey of six regions: I Approach (0), II Cluster (5000 px, relics start), III Binaries (9000, moving pivots), IV Nebula (13500, current in free flight), V Dark Field (18000, near-pass style), VI The Beat (22500, pulsing suns), arrival at the perihelion 28000 px (+400, result card).
- Sling sun (+8% speed on clean release, cap 460 px/s); relics off the line.
- Hangar (hold >= 0.5 s on title/result): probes Standard / Ballast (4 feats) / Wisp (8 feats), start from any region reached, trails, daily run with streak, 16 feats (2 hidden), log of regions and best crossing times. Only a plain Standard run from the start touches the console best score.
- Behaviour change: on title/result/hangar a press is decided on release (tap launches, hold opens hangar).
- Save schema 2 migrates the first-release save (tested); under 4 KiB.
- Lamps: region colour shifting amber/red toward the band edge, fill = speed; cyan swing spot when tethered; relic side pulse white; dark body side blink red; pulsing-sun bar; accents.
- Sound: discrete tones only (no bend): note at the bottom of each pass, fifth on clean release, region motifs.
- Bot: all 3 seeds arrive in 205-217 s; sloppy bot dies in every region (2-115 s). Idle scores 53.
- Tests: 34 in its file (17.5 s); full suite 803 JS, 189 Py, browser suites pass on its branch.
- Unverified / weak: feel and lamps on device; binaries and the beat most speculative; a throw at a sun that goes dark is wasted; yellow vs amber danger hard to tell apart; region banners cover the top for 2.8 s; some region screenshots predate final drawing tweaks. Cut: heavy-star and comet anchors, one-per-run events.
