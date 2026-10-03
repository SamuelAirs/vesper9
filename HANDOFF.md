# VESPER-9 handoff (2026-10-03)

The short version, for an agent taking over. The detail lives in
[`docs/handoff/PROJECT.md`](docs/handoff/PROJECT.md): every open PR, merge order and
conflicts, Sam's decisions and verdicts, conventions. The project's notes are copied
alongside it in `docs/handoff/`.

**Where these facts come from.** The Pi's Claude session read sections 1-3 live, without
changing anything, at 2026-10-03 03:15 UTC. Its full note is
[`docs/handoff/pi/pi-state.md`](docs/handoff/pi/pi-state.md). GitHub facts were checked with
git at 03:10 UTC.

## 1. What the Pi is running

Everything is under `/home/sam/VESPER-9-v0.2.0-Claude/` on host `raspberrypi`, user `sam`.

| Folder | What it is | Branch and commit | Uncommitted |
| --- | --- | --- | --- |
| `vesper9/` | `main` checkout; also holds `data/`, `backups/`, `.venv/`, `models/` | `main` at 5db9ae8 (= `origin/main`) | none |
| `live/` | git worktree of `vesper9/`; **the console runs from here** | detached at **f3bfaccaf19046d13738fddd96140b20127d0e98** | none (`.venv`, `models` symlink into `vesper9/`) |
| `node2/` | separate clone for the second node's work | `pi/node-two-mics` at b9079f1 = PR #19's head | none |
| `fleet/` | not git: the Pi's log `STATUS.md`, `tools/`, `test-output/` | | |

**The console build f3bfacc is not on GitHub and is not for merging.** It is local branch
`pi/test-games-and-taps` in `vesper9/`, made by the Pi's `fleet/tools/bundle.py`: PR #16 at
7d468d9 as the base, then merges of #1 b9dfe20, #3 666d427, #5 3770a42, #6 b255b4c,
#11 616d7e8, #7 34fd64b, #8 e14cc9d, #15 a61e59e, #17 ac586a4, #18 d14b760, #4 370274e,
#9 6a4e351, #10 41b56e6, #12 3541f2e, #14 17c39a1, #20 ce2e650, #21 6c5cdf9 and #19 b9079f1.
#2 (Descent) is left out. Since then #4 (d78cfc0), #11 (6b75fba), #12 (c4cf082, the
Encyclopedia), #16 (923ddab) and #20 (d800b42) have moved, and the console doesn't have those
commits.

`docs/handoff/pi/` has the only off-Pi copies of:
- `pi-live-console-f3bfacc.bundle`: a git bundle of f3bfacc. Its prerequisites are the PR
  commits above. To restore it, run
  `git fetch docs/handoff/pi/pi-live-console-f3bfacc.bundle 'refs/heads/*:refs/remotes/pi/*'`.
- `tools/bundle.py` and its three resolvers (the build recipe and its conflict rules),
  `tools/knock-trace.py`, `tools/tap-direction.py`.
- `STATUS.md`: the Pi's dated log of every deploy, flash and test.

## 2. The node

| | |
| --- | --- |
| Connected | Sam's second node on native USB, `/dev/serial/by-id/usb-Espressif_USB_JTAG_serial_debug_unit_DC:DA:0C:14:8F:C0-if00` |
| Firmware | **`vesper-node-0.2.0`**, read back from the node (link `usb`, 4 lamps, board LED, 0 CRC errors) |
| Board profile | **2** (`NODE_BOARD=2`, `firmware/main/hardware.h` on #19): ESP32-S3 N16R8, four RGB lamps, two INMP441 mics on one clock, button GPIO12/46, WS2812 board LED on GPIO48, no SHT3x. Built in `node2/` from ba11dd7 (the last `firmware/` commit, on #19) with `scripts/build-firmware.sh 2`, flashed over native USB. Sends KNOCK_CLIP before each KNOCK. |
| Backups | `vesper9/backups/`: `node2-as-found-20261002-125315.bin` (second node as delivered), `node-vesper-0.1.2-20261001-153459.bin` and `node-room-3.1-20260930.bin` (first node; the latter holds Wi-Fi credentials, never copy it). Restore command in `backups/RESTORE.txt`. |
| First node | Unplugged. Board 1 (3 lamps, 1 mic, SHT3x), running 0.1.3 from #4 at f0c0136. |

Verified on the device (2026-10-02/03, with Sam watching or acting):
- all twelve lamp outputs, in the right colour
- the board LED
- the button
- both mics: clean, about 100-200 rms quiet, no hum, 0 read errors
- speech through both mics averaged: one sentence and three commands heard correctly
- tap detection at threshold 4000
- KNOCK_CLIP: 89 clips for 89 knocks
- flashing over native USB

Not verified on the device:
- Tap direction failed Sam's check (left 10/10, back 5/10, right 5/10), so any tap counts now.
- No speech comparison of the mic mixes was done.
- The service's twelve-value `leds`, `pattern` and `board_led` commands were tested only
  against fakes and the simulator.

## 3. How Vesper starts

User unit `~/.config/systemd/user/vesper.service`, enabled, starts at boot:

```
WorkingDirectory=/home/sam/VESPER-9-v0.2.0-Claude/live
ExecStart=live/.venv/bin/python -m vesper.server
  --port "/dev/serial/by-id/usb-Espressif_USB_JTAG_serial_debug_unit_*,/dev/serial/by-id/usb-1a86_USB_Single_Serial_*"
  --data /home/sam/VESPER-9-v0.2.0-Claude/vesper9/data/console
Restart=on-failure
```

- The console is at http://localhost:8799 (loopback only). The port patterns pick whichever
  node is plugged in, which needs #19's service code.
- Data lives in `vesper9/data/console/vesper.sqlite3` (WAL): 20 scores and 28 app saves at the
  time of the read. Every deploy first copies it to
  `vesper9/backups/data-<stamp>-before-<commit>/`.
- Restart with `systemctl --user restart vesper.service`. Logs:
  `journalctl --user-unit vesper.service`.
- Deploy or roll back a commit:
  `git -C live checkout --detach <commit> && (cd live && python3 scripts/build-demo.py) && systemctl --user restart vesper.service`.
  Back up the data first.
- Screen blanking is off (`~/.config/autostart/vesper-no-blank.desktop`), because the node's
  button can't wake a blanked screen. The Pi runs on a battery pack, has dropped several times,
  and reboots into the same build.
- The Pi can't push to GitHub unless Sam is logged in at his desktop (the `gh` token is in his
  keyring), and `git push` hangs otherwise. Fetching works because the repo is public. When it
  can't push, the Pi hands over git bundles.
- Pi-only work: firmware, serial and flashing, the live console, Sam's data, deploys, and the
  Vosk vocabulary test (`tests/test_commands.py`).

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
   `scripts/get-encyclopedia.py --data vesper9/data/console`; neither is done and Sam hasn't
   been asked). Run the Vosk check for "encyclopedia" and confirm the result for "high bar"
   (the project notes say it passed; the Pi's report doesn't show it).
6. **Waiting on Sam:** a playtest of the f3bfacc console, an answer on Outpost's second-save
   starting points, what Pocket Links polish he wants, whether lamp 4 is readable in Echo
   Vault and Glyph Archive, and who merges.

**Known failures.** The Perihelion "planning bot crosses every region" test (seed 3003) fails
on `main`; PR #1 fixes it. On the Pi's build, Python `tests/test_catalog_sectors.py`
`test_tools_are_off_the_dashboard_...` fails: it expects `descent` and `environment` on the
dashboard, but the merged layout has neither (the drafts disagree on that test).
On the device, the 98 and 110 Hz game tones register as taps (the
mute that fixes it is lost; item 3). On 2026-10-03 00:04 UTC the node took no writes for 0.5 s;
the cause is unknown, and the 14 s reconnect it caused is fixed on #19.

**Recent test results.**

| Where | When | Result |
| --- | --- | --- |
| `main` 5db9ae8, cloud | 2026-10-03 03:10 | `node --test tests/*.test.mjs`: 818/819 pass (the Perihelion test above) |
| Pi, all drafts combined | 2026-10-02 23:33 | 1202 JS and 224 Python pass |
| Pi, PR #19 branch | 2026-10-02 22:43 | 815 JS and 204 Python pass |
| #4 head d78cfc0, knock thread | 2026-10-03 01:25 | JS, Python, catalog and browser checks pass, except the Perihelion test |
| Pi, console build f3bfacc | 2026-10-03 | 1276/1276 JS; 240/241 Python (the catalog test above) |

The browser suites can't run on the Pi. Nothing in the unfinished list has run on the device.
