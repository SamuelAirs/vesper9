# Pi state for the handoff (read live on 2026-10-02 22:15 CDT / 2026-10-03 03:15 UTC)

Read-only check of Sam's Raspberry Pi 5 (`raspberrypi`, user `sam`). Nothing was changed to write this.

## What the Pi is running

Everything lives under `/home/sam/VESPER-9-v0.2.0-Claude/`.

| Folder | What it is | Branch and commit | Uncommitted |
| --- | --- | --- | --- |
| `vesper9/` | the `main` checkout of github.com/SamuelAirs/vesper9; also holds `data/`, `backups/`, `.venv/`, `models/` | `main` at 5db9ae8, level with `origin/main` | none |
| `live/` | git worktree of `vesper9`; **the console runs from here** | detached at **f3bfaccaf19046d13738fddd96140b20127d0e98** | none (`.venv` and `models` are symlinks into `vesper9/`) |
| `node2/` | separate clone for the second node's firmware and service work | `pi/node-two-mics` at b9079f1 = PR #19's head (`claude/second-node-firmware-wjv0f9`) | none |
| `fleet/` | not a git repository: the Pi log `STATUS.md`, `tools/`, `test-output/` | | |

The console build f3bfacc is **not on GitHub**. It is a local test bundle (branch `pi/test-games-and-taps` in `vesper9/`, never pushed, not for merging) made by `fleet/tools/bundle.py`: PR #16 at 7d468d9 as the base, then merges of #1 b9dfe20, #3 666d427, #5 3770a42, #6 b255b4c, #11 616d7e8, #7 34fd64b, #8 e14cc9d, #15 a61e59e, #17 ac586a4, #18 d14b760, #4 370274e, #9 6a4e351, #10 41b56e6, #12 3541f2e, #14 17c39a1, #20 ce2e650, #21 6c5cdf9 and the node work b9079f1 (PR #19). PR #2 (Descent) is left out at Sam's request. Conflict rules are in the script.

Files next to this note:
- `pi-live-console-f3bfacc.bundle`: git bundle of that commit (tip f3bfaccaf19046d13738fddd96140b20127d0e98; needs the PR branches above as prerequisites).
- `pi-fleet-tools-and-status.tar.gz`: `fleet/tools/bundle.py` with its three resolvers, `knock-trace.py`, `tap-direction.py`, and `fleet/STATUS.md` (the dated log of every deploy, flash and test on the Pi).

Since that build, these PR heads have moved and are **not** on the console: #4 d78cfc0, #11 6b75fba, #12 c4cf082, #16 923ddab, #20 d800b42. PR #22 is new.

## The node

Connected now: Sam's second node, on the native USB port, `/dev/serial/by-id/usb-Espressif_USB_JTAG_serial_debug_unit_DC:DA:0C:14:8F:C0-if00`.

- Read back from the node through the service: firmware `vesper-node-0.2.0`, link `usb`, 4 lamps, a board LED, 0 CRC errors.
- Board profile 2 (`NODE_BOARD=2`, `firmware/main/hardware.h` on PR #19): ESP32-S3 N16R8, four RGB lamps, two INMP441 microphones on one clock, button on GPIO12/46, board WS2812 on GPIO48, no SHT3x. The image on the node was built in `node2/` from commit ba11dd7 (the last commit touching `firmware/`), `scripts/build-firmware.sh 2`, flashed over the native USB port with no buttons. It sends KNOCK_CLIP before each KNOCK.
- Verified on the device with Sam watching or acting (2026-10-02): all twelve lamp outputs, in the right colour after the green/blue exchange; the board LED; the button (it stepped a 12-step check); both microphones (clean, about 100 to 200 rms in a quiet room, no hum, 0 read errors); speech through both microphones averaged (one sentence and three commands heard correctly); tap detection at threshold 4000; KNOCK_CLIP (89 clips for 89 knocks); flashing over native USB.
- Not verified: tap direction as an input (Sam's calibration check: left 10/10, back 5/10, right 5/10; he has decided any tap counts, no sides); a speech comparison of the microphone mixes; the service's twelve-value lamp commands and `board_led` on the real node (tested against fakes and the simulator only); PATTERN with twelve values on the node.
- The first node (board 1, three lamps, one microphone, SHT3x, MAC 30:30:F9:18:AF:14) is unplugged. It runs 0.1.3 from PR #4's branch at f0c0136, not 0.2.0.
- Flash backups in `vesper9/backups/`: `node2-as-found-20261002-125315.bin` (the second node as delivered, factory MicroPython), `node-vesper-0.1.2-20261001-153459.bin` (first node), `node-room-3.1-20260930.bin` (first node as found; contains Wi-Fi credentials, keep local). Restore command in `backups/RESTORE.txt`.

## How Vesper starts

User service `~/.config/systemd/user/vesper.service`, enabled, starts at boot:

```
WorkingDirectory=/home/sam/VESPER-9-v0.2.0-Claude/live
ExecStart=live/.venv/bin/python -m vesper.server
  --port "/dev/serial/by-id/usb-Espressif_USB_JTAG_serial_debug_unit_*,/dev/serial/by-id/usb-1a86_USB_Single_Serial_*"
  --data /home/sam/VESPER-9-v0.2.0-Claude/vesper9/data/console
Restart=on-failure
```

- Console: http://localhost:8799 (loopback only). The port patterns pick whichever node is plugged in; they need the service code from PR #19.
- Data: `vesper9/data/console/vesper.sqlite3` (WAL). Right now 20 scores and 28 app saves. Every deploy copied it first to `vesper9/backups/data-<stamp>-before-<commit>/`.
- Restart: `systemctl --user restart vesper.service`. Logs: `journalctl --user-unit vesper.service`.
- Deploy a commit: `git -C live checkout --detach <commit> && (cd live && python3 scripts/build-demo.py) && systemctl --user restart vesper.service`. Roll back the same way.
- Screen blanking is off (`~/.config/autostart/vesper-no-blank.desktop`), because the node's button cannot wake a blanked screen.
- The Pi runs on a battery pack and has dropped several times; it reboots into the same build.

## What remains, from the Pi's side

- **GitHub login on the Pi.** `gh` keeps its token in Sam's desktop keyring. When he is not logged in at the Pi, `gh` and `git push` hang; fetching works because the repository is public. PR #19 was published by a cloud thread from git bundles.
- **Recent test results on the Pi for f3bfacc:** JavaScript 1276 of 1276. Python 240 of 241: `tests/test_catalog_sectors.py` `test_tools_are_off_the_dashboard_...` expects `descent` and `environment` on the dashboard, and the merged layout has neither (the drafts' tests disagree). The browser suites (`tests/*.cjs`) cannot run in a remote-control session on the Pi (no Playwright browser).
- **Dependencies between drafts:** #19 is stacked on #4. #16 and #4 both rewrote Settings in `web/apps/utilities.js` and the knock handling in `web/engine/input.js` and `web/main.js`; the bundle script keeps both Settings additions and takes #16's knock handling. #4 is merging #16 to settle that, after which #19 needs #4 merged in again.
- **Unfinished:** Sam's decision that any tap counts (no sides) is with the knock, platform and game threads and not on the console yet. The Encyclopedia on #12 needs `pip install -e '.[encyclopedia]'` (libzim) and a download of about 1 GB from download.kiwix.org on the Pi; neither is done, and Sam has not been asked.
- **Known device findings still open:** the two deepest game tones (98 Hz and 110 Hz) register as taps through the case (PR #4 has a console-side mute, not yet confirmed on the device); on 2026-10-02 19:04 the node took no writes for half a second during Undertow, cause unknown (the 14 s reconnect it caused is fixed on #19).
