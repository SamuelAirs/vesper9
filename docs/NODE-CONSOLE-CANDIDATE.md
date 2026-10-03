# Finished-node development candidate — 2026-10-02

This is a Windows-developed candidate for Sam's Raspberry Pi 5. It has **not been deployed**. The Pi still runs the recovered `f3bfaccaf19046d13738fddd96140b20127d0e98` build. Windows/browser results below are software evidence, not physical acceptance or Pi performance measurements.

## Product decisions

The final console has one arcade button, four independent RGB lamps, two microphones and an optional ESP32 board LED accent. There is no temperature/humidity sensor. **Generic case taps are the default**, including comfortable back taps. Optional calibrated left/right mode is available; new calibration trains only left and right. Historical back-labelled samples are preserved but excluded from that classifier. Unready/uncertain classification remains generic. Left/right confidence still needs testing in the finished case: a back tap can resemble a side tap, so use generic mode when it matters.

The button remains sufficient for every game. Case actions tolerate acoustic detection delay; they do not claim frame-exact timing or replace Light Trial's same-clock button measurement. Voice remains local and explicitly enabled. Microphone OFF stops streamed recognition/capture; the node can still send bounded stereo excerpts for tap detection. Raw excerpts are removed before browser delivery and are not recordings stored by this feature.

## What changed

- Stabilized native Windows health/startup/cleanup, microphone state after storage failure and monotonic service uptime. Build identity exposes the actual source hash/commit separately from reported node firmware and bundled firmware.
- Preserved the deployed low-tone tap suppression and serial port glob support while reconciling the newer platform work. The candidate includes Encyclopedia and retains retired games' source/saves without returning them to the dashboard.
- Fixed burst-delivered menu gestures: the router's source-clock decision now authorizes game rollback even if no simulation frames ran between USB edges. Normal game holds and consumed terminal releases remain intact.
- Menus: button advances, generic case tap goes to the previous choice, two deliberate generic taps go back. Previous/next sector buttons are both available. Calibration taps never move the menu while labels are being collected.
- High Bar: manuals, shove-its and regrips; variety-based combos; twelve park lines; skill medals; short line retries; practice without career farming. Old private three-slot saves and old score records survive. New session scores use `style-v2`.
- Existing games: case taps serve surveys, replay, steering, reverse choices or coaching according to the game. Four lamps retain distinct game roles; board accents clear on cancellation/pause/exit. Precision games keep button timing authoritative.
- The Stacks and Encyclopedia gain reverse case paging, bookmarks, bounded saved history/trails, and four-lamp reading feedback. Lantern and Cadence use all four lamps; Cadence's board accent identifies the downbeat.
- Exactly one new game: **Wayfinder**, a resumable expedition with three regions, supply decisions, optional research detours and equipment unlocks. Generated fields have alternative routes and are tested through actual travel/resource rules. Scores are separated by region; the dashboard explicitly labels its primary record SCOUT BEST. Its daily order accepts rescue in any region.
- Node Scope can test each of the four lamps and the board LED. Both Windows service and standalone simulators describe the final node, with no fictional environment readings.
- Packaging excludes private runtime data and parent-directory handoffs by default. Firmware helpers require the chosen board, target identity and verified full backup. No firmware source or binary was changed or flashed.

## Provenance and synchronization

| Location | Verified relationship | Remaining divergence |
| --- | --- | --- |
| Original Windows `vesper9` | `main` at `5db9ae8`; investigation notes preserved | Main is not the deployed combined console |
| GitHub `main` | `5db9ae8` at investigation fetch | Numerous draft features exist outside main |
| Windows `vesper9-development` | Local `codex/node-console`, based on recovered `f3bfacc`; explicitly reconciles current #16, #4 and #12 | Candidate commits are local; not deployed or represented as GitHub main |
| Pi `vesper9/` | Clean `main` at `5db9ae8` during investigation | Holds shared runtime data; service does not run this source |
| Pi `live/` | Service cwd/source `f3bfacc`; 152 source/config hashes and seven served assets matched | Running code remains the older candidate baseline |
| Pi `node2/` | `b9079f1`, same head as #19 at investigation | Source checkout is not a flash readback |
| ESP32 | Reported `vesper-node-0.2.0`, four lamps, two mics, board LED | Installed binary hash not read back; no flash attempted |

The recovered deployed build has a standalone verified Git bundle on Windows, independent of PR #22's incremental recovery bundle. Preserve it and the current live directory until physical acceptance and rollback checks finish. Matching main checkouts alone remains insufficient evidence of deployment synchronization.

## Evaluation and limits

Vesper has a coherent identity and a useful foundation: local services, immediate input, app lifetime protection, owned lights, bounded saves and a broad deterministic test suite. Its stronger games now support sustained learning and progression. The Stacks and the offline Encyclopedia suit a self-contained cyberdeck particularly well.

The largest remaining risks are integration and physical feel: acoustic false taps, optional directional accuracy, High Bar landing/manual cadence, display readability and Pi rendering/thermal behavior. Windows success does not settle those questions. The deployment history also needs one intentional release path; leaving many draft branches and a detached live directory as the long-term process would recreate the same ambiguity.

Use [the Pi acceptance and rollback plan](PI-ACCEPTANCE.md) before switching the service. Fresh test counts, artifacts and source identity are recorded in `WORKLOG.md` after final integration. Historical release notes and handoff dates describe their original snapshots, not this candidate's deployment status.
