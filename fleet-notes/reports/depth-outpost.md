# depth-outpost (saved by the coordinator from the agent's hand-back; branch worktree-agent-a9b0e1a0d74598222 @ 1ac4b6c)

- Musical taps: each gathering tap plays the next note of a melody; 17 public-domain tunes + seeded generated tunes; phrase and tune completion bonuses; mastery after five plays (+2% each); songbook in the build ring with previews; loop / shuffle / endless generated order.
- Tunes transcribed from memory only (least certain; listen first): Twinkle, Row Row, Frere Jacques, Jingle Bells, Oh Susanna, Yankee Doodle, Fur Elise. Others checked against thesession.org / Wikipedia LilyPond / ABC collections. Dump: `node tests/helpers/outpost-songs-cli.mjs`.
- Statistics: headline TAPS, BY HAND, PER TAP, BEARINGS; three pages (all time, this run, music and field); figures that began at migration are starred "counted since 1 Oct 2026".
- Depth: 34 goals (+1% output, 2 data each), research (6 wall-clock projects, 6 min to 8 h, second resource "data"), 2 late machines, 4 instrument voices, 3 tree nodes, 7-stage backdrop. Relocation-ready hint now at twice held bearings.
- Pacing (bot, minutes to relocation ready) mixed: 30.6, 19.4, 21.4, 48.9, 49.7, 50.3 (old 50, 15, 7.4, 8.8). Late machines never reached by the bot: unmeasured.
- Save: schema 3, migrates the current save (fixture from old code); late save under 4 KB.
- Tests: 557 JS pass on its branch; browser/Python suites were run before the restart only.
- Unverified: all sound (no gain control in ctx.tone, so extra voices may be too loud); lamps; gesture rewind not tested against main's tap-tap-hold.
- Host wish: ctx.tone gain argument and start-ahead time.
