# knock-input: a knock on the case as a second input

Written 2026-10-01 from a cloud session (no Pi, no node). **Nothing here has been run on the
device.** The firmware compiles cleanly with ESP-IDF v5.4.2 on x86-64; the detector is tested
on synthetic signals only. Branch `claude/project-thread-79km6i`, draft PR, not merged.

## What it does

- **Firmware 0.1.3** (`firmware/main/knock.h`, `main.c`): while the host has set a threshold the
  node keeps the microphone running and looks for a knock in 1 ms blocks: a peak at or above the
  threshold and 8× the background, that has died down to 20 % by 20-70 ms later, 150 ms apart.
  The main loop drops any knock within 60 ms of a button edge (the switch clicks). Only
  `KNOCK` (type 8: `u64 at_us, u16 peak`) leaves the node. `KNOCK_SET` (type 22: `u16
  threshold`, 0 = off) controls it; the node resets it to 0 at boot and after 3 s without the
  host. STATUS gains `knock: {thr, n, btn, long, peak}`; STATUS `mic` still means streaming only.
  Protocol stays v1 (two new message types; older firmware answers `KNOCK_SET` as unknown).
- **Service**: setting `knock` (`off`/`low`/`medium`/`high` → 0/8000/4000/2000, default
  medium), sent on connect and re-sent whenever STATUS disagrees; `knock` events broadcast;
  `knock` command for the simulator; `/api/system` `node.knock`.
- **Browser**: `InputRouter.knock()` hands it to the app's optional `knock(event)` only where a
  raw button edge would go (a game, no menu, no pending release); never part of tap, tap, hold;
  does not open the menu. `ctx.knockInput()`. K on the keyboard knocks. Calibration: KNOCK
  SENSITIVITY. Node Scope: KNOCK INPUT, KNOCK COUNTS, LAST KNOCK.
- **No game uses it yet.** That is the next step once the device test says it is reliable.
- `scripts/node-probe.py --knock SECONDS [--threshold N]` qualifies it without the service.

The prebuilt image in `firmware/prebuilt/` is still the tested 0.1.2; build 0.1.3 from source on
the Pi (below). Apps 0.2.0 keep working with 0.1.2: no knocks arrive and Node Scope says so.

## Test on the device (Pi, about 15 minutes)

```bash
# 1. A separate checkout of the branch; live and main are untouched.
cd ~/VESPER-9-v0.2.0-Claude/vesper9
git fetch origin claude/project-thread-79km6i
git worktree add ../knock-test FETCH_HEAD
cd ../knock-test
NODE=/dev/serial/by-id/usb-1a86_USB_Single_Serial_5CE5125730-if00   # the COM port in WORKLOG

# 2. Build and flash 0.1.3. flash-node.sh reads a full 16 MB backup first and restarts the service after.
. ~/esp/esp-idf-v5.4.2/export.sh   # if it refuses: drop PlatformIO from PATH first, as scripts/node-dev.sh does
bash scripts/flash-node.sh "$NODE"

# 3. Talk to the node directly for 60 s, at the medium threshold.
systemctl --user stop vesper.service
../vesper9/.venv/bin/python scripts/node-probe.py "$NODE" --listen 3 --knock 60
```

During those 60 s, and note what prints:

1. Knock firmly on the case with a knuckle, about once a second, ten times. Expect one `KNOCK`
   line per knock, never two. Note the peaks.
2. Tap softly ten times. Note how many print; this decides the sensitivity.
3. Press the button ten times (taps and a few holds), without knocking. Expect `BUTTON` lines and
   **no** `KNOCK`; the final `btn` counter shows how many the button guard caught.
4. Talk, whistle, and clap near the node. Expect no `KNOCK` (`long` may rise).
5. Knock, then press the button about half a second later. Expect the knock to count.

Repeat with `--threshold 2000` or `--threshold 8000` if (2) was too few or too many. Then the
full console:

```bash
../vesper9/.venv/bin/python -m vesper.server --port "$NODE" --data /tmp/knock-data --http-port 8800
# open http://localhost:8800, System menu > SYSTEM TOOLS > Node Scope: knock and watch LAST KNOCK.
# Calibration > KNOCK SENSITIVITY changes it live. Play a game with sound up and check KNOCK COUNTS
# does not rise from its own tones. Ctrl+C when done.
systemctl --user start vesper.service
```

`/tmp/knock-data` keeps Sam's real data out of the test. To go back to 0.1.2: `bash
scripts/flash-prebuilt.sh "$NODE"` from the main checkout (it also backs up first).

What to send back: the peaks from (1) and (2), whether (3), (4) and (5) behaved, and the final
`KNOCKS … node counters` line.

## Known limits and risks

- Thresholds and timing are design values. The probe output from the real case decides them; the
  constants are at the top of `knock.h`.
- A short, loud beep (under about 30 ms) from a speaker close to the node could pass as a knock;
  step 4 of the console test checks this.
- `at_us` is estimated from the end of the 20 ms audio buffer; the event arrives about 70-100 ms
  after the knock. Fine for "knock to do X", not for rhythm-exact timing.
- Knock detection keeps the microphone (I2S) running while the console is connected, as Sam
  approved; no audio is sent unless a microphone mode asks for it.
- `tests/perihelion.test.mjs` "a planning bot crosses every region" fails on seed 3003 on this
  host with and without this branch (Node 22). Not touched here.
