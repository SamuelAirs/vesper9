# Next steps for the finished node

The current Pi trial is `0c1bf13` from `codex/highbar-momentum`, deployed and
source-verified on 2026-10-03 at 22:11 UTC. High Bar has revised controls,
earned momentum, longer webs and skate decks. CAIRN is the one requested new
skill game. Remodeling another existing game remains paused at Sam's request.

## 1. Finish High Bar's physical iteration

Use [High Bar](HIGH-BAR.md) and [current validation](VALIDATION.md), not older
pumping/manual descriptions. Plain held button grabs; release detaches. Quick
button press followed by a second held press flips. Generic case tap shoves;
a deliberate double case tap kickflips. Ground taps are inert. Holding a post
must lose energy; ground skating and elevated decks supply the route upward.

Acceptance: these gestures feel distinct on the actual node, intended flips
do not snag a post, the longer web feels useful, and a good line can sustain
airtime without camping a post to gain height. Test deck landings and finding
a useful launch speed, readable spider/obstacles, and clean versus sketchy
landings. Software recordings prove possibility, not enjoyable difficulty.

## 2. Preserve the current trial and its rollback

The authorized switch copied the latest quiescent b14db57 trial saves using
SQLite backup and integrity/count checks. Its source, data and service overrides
remain intact. The new release has separate trial data and a removable
`97-highbar-momentum.conf`; its rollback returns to b14db57 with b14db57 saves.
Source identity, nine served assets, one browser, node connection, microphone
OFF and CRC zero passed targeted checks. Firmware 0.2.0, models, calibration
and Encyclopedia assets remain unchanged. Never point the older release at
migrated schema-5 saves. [PI-ACCEPTANCE.md](PI-ACCEPTANCE.md) gives the exact
rollback command. Build and broad testing remain on Windows for future changes.

## 3. Play CAIRN after the High Bar check

[CAIRN](CAIRN.md) uses hold/release jumps, short-press or generic-tap turning,
fixed solid shelves and no air steering. Substantial falls and two permanent
milestones follow Sam's decision. All 30 shelves have an actual-input Windows
completion witness; narrow upper timing windows still need human assessment.

Acceptance: deliberate timing improves success, failures are understandable,
long falls feel consequential, and reopening resumes at the earned cairn.
Check real button timing, four charge lamps and board-accent cleanup. Existing
games beyond High Bar stay unchanged until its direction is accepted.

## 4. Complete console acceptance and source reconciliation

Generic back taps remain default; optional calibrated sides should only be
enabled when real left/right/back observations support them. Test comfortable
speaker volume for false taps, menu cancellation with no lost life/progress,
all four lamp channels and board cleanup. Stacks/Encyclopedia should retain
reading positions and bookmarks. Twinbeat's acoustic timing and Wayfinder's
save/resume remain separate game checks.

During ordinary play, collect brief resource/status observations if needed;
do not benchmark or run broad suites on the battery-powered Pi. Windows
Canvas timings are not Pi FPS. Browser save recovery covers acknowledged and
bounded in-memory writes, not power loss before acknowledgement.

After physical acceptance, choose the authoritative release/data directory
and GitHub publication/merge path. Record the accepted commit, source hash,
service/data paths and archive identity. Matching a main checkout never
proves the service runs that source. Desktop autostart/kiosk behavior is a
separate decision.
