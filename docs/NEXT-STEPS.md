# Next steps for the finished node

The current candidate is developed on Windows in `codex/console-polish`, based
on `codex/node-console` at `b818558`. It is not deployed. Read
[the candidate](NODE-CONSOLE-CANDIDATE.md), [validation](VALIDATION.md),
[the worklog](WORKLOG.md), and [the trial/rollback plan](PI-ACCEPTANCE.md).
Earlier release notes describe earlier hardware and must not drive a flash.

## 1. Review and stage one recoverable release

Agree the candidate with Sam before changing the running console. Recheck the
actual service working directory, source identity, data path and node identity.
The last read-only Pi snapshot was `live/` at detached `f3bfacc`, separate from
`vesper9/` main at `5db9ae8`. Preserve both and the exact service configuration.
Verify the candidate manifest after transfer; use a consistent private copy of
saves for the trial. No firmware update is needed. All builds and broad tests
stay on Windows.

Acceptance: the chosen commit/source hash matches the files actually served by
the Pi; the service stays loopback-only with one controlling browser, the node
connected, microphone off, original saves retained and rollback ready.

## 2. Test controls in the finished case

Generic taps remain the default. Check comfortable back taps for previous menu
item/page, deliberate double taps for back, button next and hold-release select.
Test tap/tap/hold and resume inside games, and verify normal game holds remain
available. Exercise four independent RGB lamps and the board LED. There is no
temperature/humidity sensor to qualify.

Acceptance: deliberate input works at a comfortable speaker volume; speaker
sounds do not create actions; cancellation costs no life or purchase; all four
lamp channels and the board accent clear on exit. Keep optional sides off until
actual left/right/back confusion counts support enabling them.

## 3. Play revised games and readers

High Bar needs human judgment on manuals, landings, coaching and line pace;
software routes establish reachability, not enjoyable difficulty. Ricochet's
reached-chamber practice should be easy to find and useful for learning.
Wayfinder needs exploration/save-resume feedback. Twinbeat needs real acoustic
timing and optional side accuracy, starting with the first two levels; assist
and side careers stay separate. Exactly two new games were added.

The Stacks should reopen existing positions/bookmarks. Encyclopedia should
resume recent articles, follow/return along links, and offer a useful choice at
article end. Stage its verified archive and matching ARM reader wheel separately.
Lantern previews should follow either navigation direction; Cadence should
identify the timer selected.

Acceptance: old saves remain recognizable, results survive restart, and Sam can
identify frustrating controls, unclear rules or shallow loops. The
[game review](GAME-POLISH.md) distinguishes audited games from games that received
deeper new mechanics.

## 4. Qualify interruptions and Pi resources

Waiting progress/scores remain in the controlling browser's bounded RAM queue
until acknowledged. Keep that tab open during an outage; the notice and save
status menu report waiting or failed writes. Hardware commands are never
replayed. This protects temporary link loss, not browser/power loss before ACK.
If the service copy changed or another tab controlled the console, use the save
status menu to compare the choice and explicitly confirm which copy to keep.
The menu can reconnect this tab after the other controlling tab closes.

After ordinary play, collect a brief frame/resource/status snapshot, with no Pi
benchmark or broad suite. Inspect stutter, audio, cooling, battery behavior, CRC
counters and microphone state. Windows/Chromium timing is not a Pi result. Local
speech vocabulary and POSIX shutdown remain separate on-target checks.

## 5. Promote deliberately

After physical acceptance, select the authoritative candidate data directory and
GitHub PR/merge path, retaining original saves and rollback artifacts. Record
the accepted commit, source hash, service path and release archive hash. Decide
separately whether the deck should launch into Vesper at login; this pass does
not change desktop autologin or kiosk startup.
