# Candidate acceptance and rollback

## Pending Windows momentum / CAIRN candidate

`codex/highbar-momentum` has not replaced the last verified Pi trial `b14db57`.
Before any new switch, identify the then-current release and copy its latest
private trial data after the controlling browser has acknowledged pending saves
and writes are quiescent. Use SQLite backup plus integrity/count checks. Stage
a separate release/data directory and reversible service override. Preserve
`b14db57` and its data as this candidate's rollback; the older rollback command
below deliberately targets `60adf7a` and must not be reused for the new switch.
Do not point an older release at High Bar's migrated schema-5 save. Keep model,
Encyclopedia, firmware, calibration and other private assets intact.

After an authorized switch, verify exact source/served hashes, source/data
paths, one browser, loopback listener, node connection, microphone OFF and CRC
counters. Physical priorities: quick press then second hold flips without an
accidental grab; plain hold grabs and release detaches; single/double case taps
give shove-it/kickflip; camping a post loses momentum; decks allow earned
height gain. Confirm the quieter scene and landing readability. CAIRN needs
human judgment on its difficult upper jumps and large falls. All broad tests
and builds remain on Windows; none of these are yet physical-device results.

## Current High Bar trial: spider / sky-route mastery follow-up

Sam authorized deployment, completed 2026-10-03 at approximately 17:25 UTC.
The Pi runs release `b14db571c199f91b60e23942ffc7a753f064e3c1` from
`/home/sam/VESPER-9-v0.2.0-Claude/releases/b14db571c199f91b60e23942ffc7a753f064e3c1/VESPER-9-v0.2.0/vesper9`.
Its clean source hash is
`7b8d1429dfcc07c21d9e91ec87ffd6b0995aa2598ec352ffb14e87d08ed4bf47`.
Five served assets match the Windows package. `trial-data/` beside the extracted
release contains a verified SQLite backup and private assets copied from the
latest `60adf7a` trial after closing its browser and stopping writes. The prior
trial's source, data and override remain intact. Models, Encyclopedia archive,
reader dependencies and installed firmware 0.2.0 are reused unchanged.

The base unit and `90-highbar-trial.conf` are preserved byte-for-byte.
`95-highbar-mastery.conf` changes only source/data paths. Targeted checks passed:
node connected (board 2, four lamps, two microphones), mic OFF/no capture,
CRC zero, service tasks healthy, loopback-only listener, Encyclopedia article
available, and one fresh fullscreen browser. The dashboard was visually checked.
The temperature snapshot was 57.3 C with no throttling; this is not a gameplay
performance measurement. Physical play acceptance remains pending.

Rollback for this follow-up uses
`python3 /home/sam/VESPER-9-v0.2.0-Claude/releases/b14db571c199f91b60e23942ffc7a753f064e3c1/deploy.py rollback`.
It stops the candidate, safely closes its browser, removes only the exact owned
`95-highbar-mastery.conf`, restores **60adf7a with its old trial data**, verifies
served source/node/microphone, and opens one fresh browser. Candidate progress
is retained separately. This path was reviewed; a live rollback rehearsal was
not run. Do not use the first trial's `deploy.py rollback`
for that purpose: it intentionally returns to `f3bfacc`. Keep the new schema-4
save separate; do not ask the older build to rewrite it. The external delivery
manifest records source/ZIP/bundle hashes. Private deployment evidence is in
`C:/Users/ayers/vesper9-investigation/mastery/deployment/`; no private save was
published. Further deployments require their own current-save preservation.

Acceptance priorities for the spider revision: a held flat-ground push should
quickly build speed; swings should build height and connect into prolonged
flight; catching should feel as familiar as before. Check that the screen is
quieter, the spider's poses are readable, and release/landing timing remains
comfortable. Old careers and unlocked parks must remain, with previous-rules
PBs distinguished from new flow-v4 records. Try one sky route using the selected
post markers, then link a second clean landing for gold. A matching bank should
end LINE RUN immediately, show the medal actually earned on that attempt, and
let a case tap advance or a button tap retry. Optional practice guidance should
stay out of ordinary play. These are physical checks still to do.

## First trial deployment record and procedure

The first trial switch was completed on 2026-10-03 at 14:44 UTC. At that time
the Pi ran release `60adf7ad07fff9e8969af3e1e673cca453493d67` from
`/home/sam/VESPER-9-v0.2.0-Claude/releases/60adf7ad07fff9e8969af3e1e673cca453493d67/VESPER-9-v0.2.0/vesper9`,
with a separate `trial-data/` directory beside the extracted release. The original
`live/` tree and production saves remain intact. Service identity, served source
hashes, connected node, microphone OFF, loopback listener and Encyclopedia article
reading passed targeted checks; one refreshed deck browser is connected.
Physical play acceptance below remains pending. No firmware was changed.

Rollback is prepared on the Pi: run
`python3 /home/sam/VESPER-9-v0.2.0-Claude/releases/60adf7ad07fff9e8969af3e1e673cca453493d67/deploy.py rollback`
after closing the trial browser. The helper removes only its exact service
override, checks the original unit/source/data and preserves trial progress.
It reopens the deck browser after recovery. This rollback path has been reviewed
and its prerequisites preserved; a live rollback rehearsal has not been run.
The steps below describe that first rollout and the broader acceptance work;
they are historical baseline instructions, not the next trial's data paths.

## Dependencies before a switch

1. Finish Windows regressions, browser checks, generated catalog/demo and a manifest-verified release ZIP. Record the candidate commit and source hash, ZIP SHA-256 and recoverable Git bundle.
2. Use a brief centralized SSH check to re-read `vesper.service`, live HEAD/status, connected node identity and free disk space. Stop if they differ from the recorded baseline. Keep the Pi on external power for transfer/acceptance.
3. Preserve the exact user service unit/drop-ins and existing `live/` tree. The rollback source is `f3bfaccaf19046d13738fddd96140b20127d0e98`; do not reset it to main. Preserve the as-found 16 MB firmware backup and its restore instructions; do not read or publish that private backup.
4. Stage the ZIP under a new `/home/sam/VESPER-9-v0.2.0-Claude/releases/<candidate-commit>/` directory. Verify transferred file SHA-256 and the release manifest on the Pi; source/hash checks are targeted, no build or suite runs there.
5. Stage optional Encyclopedia content separately from source. The verified Windows archive is Simple English Wikipedia without pictures, September 2026, 1,094,936,257 bytes, SHA-256 `ee93790aa7907c41570b0861fa15c3645bbcf6da208fd2a426a62459231a66f4`. Its provenance sidecar must accompany it. Check free space for both candidate and rollback data. The separately staged reader wheel is `libzim-3.13.0-cp313-cp313-manylinux_2_27_aarch64.manylinux_2_28_aarch64.whl` (10,613,591 bytes), SHA-256 `3379aeebfc7fc21b13f9b7e2e1cb802ef39edf28732387fe2249cc208d51e0b3`. Verify aarch64, CPython 3.13 and glibc >=2.27 on the Pi before using it. Install only that matching prebuilt dependency into the candidate's private dependency directory; never compile it on the Pi.

## Save-preserving trial

Create a private candidate data directory rather than pointing the trial at the only production save copy. Use SQLite's online backup API to copy `vesper9/data/console/vesper.sqlite3` consistently; do not copy an open database without its transaction state. Copy local library metadata/content and other required private assets into that trial directory, or retain verified read-only content references. Never include them in Git or the release ZIP. Preserve all original databases, recordings, models and calibration files.

The current service uses `live/.venv/bin/python`, loopback port 8799, the native-USB/CH340 serial glob pair and data at `vesper9/data/console`. Keep its existing port/serial/desktop options. Point a reversible service override at the new source and **candidate** data directory; use the existing compatible Python dependencies plus a private candidate dependency directory for any added reader wheel. Do not change the shared environment in place merely to enable Encyclopedia.

Before starting: close extra controlling browser tabs. Restart once after approval, then reopen/refresh the deck browser. Verify service health, loopback-only binding, connected firmware/counts, microphone OFF, no capture, CRC counters, and the new source identity through `/api/system`. Hash the served JS against the release manifest. This is what establishes a deployed-source match; a service-active flag alone does not.

## Sam's physical checks

1. **Menus, two minutes:** button next; generic back-case tap previous; double case tap back; previous and next sector; hold-release select. In a game, tap/tap/hold then resume: confirm no lost life, purchase or accidental launch. Try an ordinary long game hold too.
2. **Light/sound check:** Node Scope, lamps 1–4 red/green/blue, then board LED, then all off. Set a comfortable lamp level. With mic OFF, play a game with bass sounds and verify they do not cause case actions; deliberately tap during quiet gaps.
3. **High Bar:** try FLAT SCHOOL practice at normal speed, then half speed; manual with comfortable generic back taps, ollie out, and reset to the last safe bank. Play a button-only Bowl session and one styled LINE RUN; check four-lamp cue readability, camera motion and landing feedback. Earn a goal/line, leave before the session ends, and reopen after the save notice clears: the earned challenge should remain. Open tap/tap/hold while swinging, return, release during the brief settling interval, and resume without losing the line. Confirm all three old private saves remain recognizable. Try Tower ascent and a Night Pipe crossing if comfortable; report which catch/release feels too narrow, whether route hints help, and whether the display or sound makes taps difficult. Automated routes do not establish the human difficulty of those late gold challenges.
4. **Readers/utilities:** reopen an old Stacks position, page backward, bookmark and resume. Open a real Encyclopedia article, follow a link and return after restarting the app. Check four-beat Cadence lamps/downbeat and Lantern's fourth lamp.
5. **Wayfinder and one favorite game:** finish an expedition or intentionally abandon one, resume saved travel and try an equipment/region unlock. In an existing game, confirm the case action helps without replacing its core skill.
6. **Optional sides only after generic passes:** calibrate left/right in your actual posture. Try ten left, ten right and ten comfortable back taps; record wrong-direction/unsure counts. Return to generic if back taps are misclassified. This optional mode is not required for completion.
   **Twinbeat:** after side calibration, play its first two levels using comfortable left/right taps. Check that note arrivals, audible cues and strike feedback agree; compare its provisional CASE DELAY settings if hits feel consistently late. Report uncertain/wrong-side taps and any speaker-triggered notes. Try the separately scored assist mode with back taps and with the button. Verify pause/resume gives a count-in and unlocks survive closing/reopening. Software timing windows do not establish acoustic latency or directional accuracy on the finished case.
7. **Pi resources:** after ordinary play, capture a brief `/api/system` and Node Scope frame summary. Report stutter, temperature/throttling, audio problems and battery behavior. Do not run a benchmark or broad suite on the Pi.

## Rollback and promotion

If the candidate fails, stop its service, preserve its trial data directory, restore the saved unit/drop-in byte-for-byte, reload the user daemon and start the original live service. Reopen its browser, verify `f3bfacc` served files, original data path, node connected, mic OFF and lights responsive. Original saves were never overwritten; trial progress remains available for recovery even though it is not shown by the old build.

After acceptance, decide whether the candidate data becomes the new authoritative data directory. Keep the former production data and candidate backup until both save migration and a restart have been checked. Choose a GitHub PR/merge path for the tested candidate, then record the accepted commit/source hash and Pi service path. Kiosk/autostart behavior is a separate preference: the prior session started at the desktop; this wave does not enable autologin or kiosk startup incidentally.
