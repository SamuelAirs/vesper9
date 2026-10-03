# Next steps for the finished node

The current Windows candidate is `codex/highbar-momentum`, based on the
`c0633d0` deployment record. The last verified Pi source is `b14db57`; this
wave has made no Pi connection or deployment. High Bar has revised controls,
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

## 2. Stage the next recoverable trial when authorized

Package and build on Windows. First recheck the Pi's then-current source,
service paths and saves. Close the one controlling browser only after its save
queue is acknowledged, quiesce writes, and copy the latest trial data using
SQLite backup and integrity/count checks. Preserve original saves, the current
`b14db57` trial and its exact service configuration. Use a separate candidate
source/data directory and removable override; prepare a rollback that returns
to `b14db57`, not the older `60adf7a` trial.

After switching, verify source identity and served JS hashes, source/data
paths, one browser, loopback-only service, connected node, microphone OFF and
CRC counters. Keep firmware 0.2.0, models, calibration and Encyclopedia assets
unchanged. An older release must never open the candidate schema-5 save.
[PI-ACCEPTANCE.md](PI-ACCEPTANCE.md) records earlier deployments separately.

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
