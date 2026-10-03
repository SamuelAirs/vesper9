# VESPER-9 handoff (2026-10-03)

The short version, for an agent taking over. The detail lives in
[`docs/handoff/PROJECT.md`](docs/handoff/PROJECT.md): every open PR, merge order and
conflicts, Sam's decisions and verdicts, conventions. The project's notes are copied
alongside it in `docs/handoff/`.

**Where these facts come from.** The Pi's Claude session went offline at 02:25 UTC on
2026-10-03, so nothing on the Pi could be checked live for this file. Pi and node facts come
from that session's last reports in the project chat (times in UTC). GitHub facts were
checked with git at 03:10 UTC. Anything marked *unchecked* needs a look on the Pi.

## 1. What the Pi is running

| | |
| --- | --- |
| Folder | `~/VESPER-9-v0.2.0-Claude` on host `raspberrypi`. The repo is `~/VESPER-9-v0.2.0-Claude/vesper9` (inferred from paths like `vesper9/backups/…`); the deploy recipe in `fleet-notes/START-HERE-DESKTOP.md` also uses a `live` checkout beside it. |
| Branch | **Not `main`.** A local integration branch built on the Pi from every open draft PR head except #2 (Descent), merged in the order #16 (contains #11), #1, #4, #19, then the games. Its name was never reported. |
| Commit | f3bfacc, deployed 2026-10-03 01:19 (per the project notes; the Pi's own report doesn't give the hash). This commit **exists only on the Pi**. |
| PR heads it used | The heads around 01:11. Four PRs got new commits after the deploy, so the console lacks them: #4 d78cfc0, #11 6b75fba, #12 c4cf082 (the Encyclopedia) and #16 923ddab. #20 d800b42 (01:14) may or may not be in. Current heads are in `docs/handoff/PROJECT.md` §5. |
| Uncommitted or unpushed | *Unchecked.* The Pi's node work lives on a local branch `pi/node-two-mics`. All four bundles it handed over are on PR #19 (head b9079f1). The Pi couldn't push directly because the GitHub login sits in Sam's locked desktop keyring. Nothing later was reported. |
| Sam's data | Saves were reported intact after the 01:19 deploy. |

To see the true state, run on the Pi: `git -C ~/VESPER-9-v0.2.0-Claude/vesper9 status`,
`git log -1`, `git branch -vv`, and the same in `../live`.

## 2. The node

| | |
| --- | --- |
| Hardware | The second node: ESP32-S3 N16R8 (MAC dc:da:0c:14:8f:c0), four RGB lamps, two I2S mics, WS2812 board LED on GPIO 48, one button, **no temperature/humidity sensor**. Pin map: `docs/handoff/PROJECT.md` §2. |
| Firmware | `vesper-node-0.2.0` built with board profile `NODE_BOARD=2` (`scripts/build-firmware.sh 2`), from PR #19's source. That is the firmware the Pi built; the version string wasn't read back from the node in any report. |
| Flash history | First flash 2026-10-02 18:09; reflashed 19:40 with the green/blue swap fixed; reflashed 2026-10-03 00:58 with the corrected KNOCK_CLIP (#19 commit ba11dd7). |
| Backup | Full 16 MB backup of the node as found: `vesper9/backups/node2-as-found-20261002-125315.bin` on the Pi. It held a factory MicroPython demo. Never commit `backups/`. |

Verified on the device (the Pi session's reports):

- **Lamps and board LED:** all four lamps right after the colour fix (Sam: "Everything worked perfectly", 2026-10-02 19:41). The board LED is a separate command, off unless a game sets it.
- **Button:** working (stepped through all 12 lamp outputs).
- **Mics:** both clean and in sync after the right mic was rewired (2026-10-02 19:35). Before that the left had mains hum and the right sent zeros.
- **Speech:** three commands recognised exactly; one sentence had a single word wrong ("jumped" for "jumps").
- **Taps (knock):** detection works, and every one of 89 KNOCK_CLIPs arrived. Tap *direction* failed live (Sam's calibration placed back and right taps right only about half the time), so Sam dropped it: any tap counts.
- **Beep test:** only the two deepest console tones (98 and 110 Hz) shake the case into a false tap.
- **Known problem:** on 2026-10-03 00:04 the node stopped accepting messages for about 0.5 s, and the console took 14 s to reconnect. The reconnect was fixed (#19 commit 77b703e, deployed 00:11), but the pause's cause is unknown.

## 3. How Vesper starts

- `vesper.service` is a systemd **user** unit. It starts at login and runs the Python service
  (`vesper.server`) from the repo's `.venv`, serving the console on loopback port 8799.
  Chromium opens it in kiosk mode at desktop login. Both come from
  `scripts/install-service.py --port <serial port> --data <dir> --kiosk` (`docs/INSTALL.md`).
- The exact ExecStart, serial port and `--data` directory on this Pi were never reported
  (*unchecked*): see `systemctl --user cat vesper.service`. The repo default for data is
  `data/console/vesper.sqlite3`. Re-running the installer without `--data` keeps the existing
  data directory.
- Control:
  `systemctl --user status|restart|stop vesper.service`,
  `journalctl --user -u vesper.service -f`.
  Stop the service before flashing (`scripts/flash-node.sh` does this and backs up first).
- Deploying from `main` (the normal path, not what's on the Pi now):
  `git pull --ff-only`, check out `origin/main` in `../live`, run
  `python3 scripts/build-demo.py` there, then `systemctl --user restart vesper.service`.
- Screen blanking is off for good (changed 2026-10-03 01:20, survives reboots), because the
  node's button can't wake the screen. The console volume was set to 0 on 2026-10-01; it may
  have been changed since.
- Pi-only work: firmware, serial and flashing, the live console, Sam's data, deploys, and the
  Vosk vocabulary test (`tests/test_commands.py`; voice names must be in the Vosk small model's
  vocabulary).

## 4. What remains

**PR dependencies.** All 20 PRs are drafts, and nothing is merged since #13. Merge order:
#11, then #16 (contains #11), #1, #4 (after it takes #16's head), #19 (based on #4), then the
games. #20 and #21 are based on #16. The Outpost stack is #8 (Tideline hidden) → #15 → #17
and #18. Conflicts and per-PR detail are in `docs/handoff/PROJECT.md` §5-6. Sam hasn't said
who merges; the recommendation is that Claude merges each game after he OKs it on the
console.

**Unfinished work** (stopped at 01:27 when the organization hit its usage spend limit):

1. **Any tap counts (#4):** drop side detection and the TAP DIRECTION setup; keep the
   classifier dormant.
2. **Undirected tap navigation (#16):** `InputRouter.knock()` in `web/engine/input.js`
   still uses `event.side`. Document that games must ignore `side`.
3. **Low-tone knock mute (#16):** it was lost when #4 merged #16. Put back the check in
   `Vesper.event()` (`web/main.js`) that drops knocks while `this.synth.shaking()`.
4. **Tap in games:** no game implements `knock()` yet. The list of games and the API notes
   are in `docs/handoff/PROJECT.md` §7.
5. **On the Pi:** redeploy after 1-4 land, then merge #4's new head into #19. Install the
   Encyclopedia after Sam OKs a ~1 GB download (`pip install -e '.[encyclopedia]'`,
   `scripts/get-encyclopedia.py --data <dir>`). Run the Vosk check for "encyclopedia" and
   confirm the result for "high bar" (the project notes say it passed; the Pi's report doesn't
   show it).
6. **Waiting on Sam:** a playtest of the 01:19 console, an answer on Outpost's second-save
   starting points, what Pocket Links polish he wants, whether lamp 4 is readable in Echo
   Vault and Glyph Archive, and who merges.

**Known failures.** The Perihelion "planning bot crosses every region" test (seed 3003) fails
on `main`; PR #1 fixes it. The node's 0.5 s pause has no known cause.

**Recent test results.**

| Where | When | Result |
| --- | --- | --- |
| `main` 5db9ae8, cloud | 2026-10-03 03:10 | `node --test tests/*.test.mjs`: 818/819 pass (the Perihelion test above) |
| Pi, all drafts combined | 2026-10-02 23:33 | 1202 JS and 224 Python pass |
| Pi, PR #19 branch | 2026-10-02 22:43 | 815 JS and 204 Python pass |
| #4 head d78cfc0, knock thread | 2026-10-03 01:25 | JS, Python, catalog and browser checks pass, except the Perihelion test |
| Pi, 01:19 deploy | 2026-10-03 | no counts reported |

The browser suites can't run on the Pi. Nothing in the unfinished list has run on the device.
