# knock-input: a knock on the case as a second input

Written 2026-10-01 from a cloud session (no Pi, no node). **Nothing here has been run on the
device.** The firmware compiles cleanly with ESP-IDF v5.4.2 on x86-64; the detector is tested
on synthetic signals only. Branch `claude/project-thread-79km6i`, draft PR, not merged.

## What it does

- **Firmware 0.1.3** (`firmware/main/knock.h`, `main.c`): while the host has set a threshold the
  node keeps the microphone running and looks for a knock in 1 ms blocks: a peak at or above the
  threshold and 8× the background, that has died down to 20 % (40 % if it clipped) by 40-90 ms later, 150 ms apart.
  The main loop drops any knock within 60 ms of a button edge (the switch clicks). Only
  `KNOCK` (type 8: `u64 at_us, u16 peak`) leaves the node. `KNOCK_SET` (type 22: `u16
  threshold`, 0 = off) controls it; the node resets it to 0 at boot and after 3 s without the
  host. STATUS gains `knock: {thr, n, btn, long, peak}`; STATUS `mic` still means streaming only.
  Protocol stays v1 (two new message types; older firmware answers `KNOCK_SET` as unknown).
- **Service**: setting `knock` (`off`/`low`/`medium`/`high` → 0/8000/4000/3000 since round 3, default
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
- `at_us` is estimated from the end of the 20 ms audio buffer; the event arrives about 90-120 ms
  after the knock. Fine for "knock to do X", not for rhythm-exact timing.
- Knock detection keeps the microphone (I2S) running while the console is connected, as Sam
  approved; no audio is sent unless a microphone mode asks for it.
- `tests/perihelion.test.mjs` "a planning bot crosses every region" fails on seed 3003 on this
  host with and without this branch (Node 22). Not touched here.

## Round 2, after Sam's device test (PR #4 comment, 2026-10-01)

The Pi's test: 10/10 firm knocks and 34/34 soft-to-firm taps, no doubles; no knock from 24 button
presses; speech and whistles rejected. Three problems, and what changed (still cloud-only, not
run on the node):

1. **Hard knocks clip and were sometimes judged sustained** (3 of 14). The tail window moves to
   40-90 ms and a clipped onset may keep 40 % of its level there instead of 20 %. New host case:
   a clipped knock ringing with a 12 ms decay is one hit. Verdict and event now come ~90 ms after
   the knock.
2. **Claps pass as knocks.** Level can't separate them (both clip). The node now measures `hf`,
   the brightness of the first 10 ms (synthetic: knock ring 35, clap 130), sends it with each
   KNOCK (now 11 bytes; the service still accepts the old 10) and in STATUS, and the probe prints
   it. `KNOCK_MAX_HF` in `knock.h` will reject anything brighter, but it stays off (255) until the
   real case's numbers are known: a clipped knock is brighter than the synthetic one.
3. **Thresholds were too sensitive.** Now low 16000, medium 8000, high 5000 (softest tap 10474,
   quiet room peak 2339). The probe defaults to 8000.

### Re-test (Pi thread)

Rebuild and flash this branch's head as before (`git -C ../knock-test pull`, then
`flash-node.sh`), then `node-probe.py "$NODE" --listen 3 --knock 90`:

Sam only wants soft taps, not hard knocks (2026-10-01), so the hard-knock check is dropped.

Claps counting as taps is fine with Sam ("maybe even a feature"), so `KNOCK_MAX_HF` stays off
and `hf` is only a diagnostic.

1. 15 soft taps, the way Sam would tap during a game: all should arrive, once each.
2. The console with sound up (`--http-port 8800` run as before): a minute of a game with frequent
   tones; KNOCK COUNTS in Node Scope should not rise.

Send back the tap count and peaks, and whether the game's tones raised KNOCK COUNTS.

## Round 3, after the round-2 device test

Run B showed 8000 cutting off Sam's lightest taps (reported peaks piled up just above it, a
third of taps missing), while 4000 caught 34 of 34 in round 1 and the quiet room peaks near
2300. Thresholds are now low 8000, medium 4000 (default), high 3000; the probe defaults to
4000. Tap `hf` on the real case is 48 to 126, so it stays a diagnostic. The clipped-ring
allowance did no harm (0 of 54 ordinary taps judged sustained). Still to check on the device:
the console's own tones with sound up, and a run at about 2500 to measure the lightest taps.

Confirmed on the device (threshold 2500, three spots, 127 light taps): all 127 would pass 4000, 125
pass 5000, 115 pass 8000; lightest 4123 (top of the case), no stray events in 80 s. The presets
above stand. Remaining: the console-tones check.

## Pulsar tap lane (Sam's idea: tap a spot matching the lit lamp)

Telling spots apart from one microphone is not reliable: light taps at the usual spot peak 6827 to
32767 (median 9002), the top 4123 to 32742 (median 15814), the other side 13291 to 32767 (median
23607), and `hf` overlaps everywhere (40 to 103). How hard you tap moves a tap across all three.
The closest reliable version is button versus case: in Pulsar, with knock input on, beats in the
right lane (white lamp, ring on screen) are struck by tapping the case anywhere; the left and
middle lanes stay on the button (holds only there). Same rhythm per seed. A knock is judged at the
node's time of the tap (mapped onto the host clock by the button presses' own timestamps), so its
~100 ms delivery delay costs no accuracy; a tap beat waits 250 ms past its window for its knock.
The system menu has PULSAR / TAP LANE to switch it off for the session; Calibration OFF removes it.

Test on the console (sound at 100 %): play Pulsar a few phrases with the tap lane; check that right-
lane beats register as PERFECT/GOOD when tapped on time, that the button cannot strike them, and
that the game's own beats and tones do not register as taps (stray count, or Node Scope KNOCK COUNTS).

## Round 4: stray taps from the button during play

The Pi's log (11 minutes of Perihelion, Descent and Moonrunner, button only, sound at 100 %, threshold
4000): 36 knocks, about 15 with a button edge in the same second (peaks 26800 to full scale, `hf` 97
to 140), the rest with none (some in bursts). The first group is the button: a hard press bottoming out
or the release, sounding later than the node's 60 ms guard reaches. The node's `at_us` can also run
late by the microphone's buffering, which shifts a press's thump outside a symmetric 60 ms window.

Changed (service and Pulsar only; **no reflash**, firmware stays as flashed):

- The service drops a knock, by the node's own timestamps, while the button was down, from 60 ms before
  a button edge, or up to 200 ms after one. `/api/system` `node.knockGuarded` counts them; the node's
  `n` still counts everything it sent.
- Pulsar leaves out a tap beat that would come within 0.45 s of a button beat's end (about one tap
  beat in six), so the guard never swallows an on-time tap. The rest of the rhythm is unchanged.

Re-test: the same counter log during button-only play, now reading both `n` and `knockGuarded`. The
strays left are `n` minus `knockGuarded`; the ones with a button edge nearby should be gone. Any that
remain without a button edge (the bursts) are either tones or handling: one run with the sound muted
would tell which.

## Round 5: what the remaining strays are

The Pi's re-test with the button guard (9 minutes, button-only play, sound at 100 %): 14 knocks sent,
2 dropped as the button, 12 reached the games (about 1.3 a minute, down from 3). Most are not the button.

Likely cause, found offline: **the console's own tones are shaped like a tap.** `synth.tone()` rises in
8 ms and falls exponentially to silence at the tone's end, so every tone of 0.25 s or less has died
away by the detector's 40-90 ms check. Run through `knock.h` (440 Hz, sine, square and triangle at
level 12000), every tone from 0.025 s to 0.25 s is a HIT and every one of 0.4 s or more is sustained.
Almost all game sounds are 0.025 to 0.25 s (Perihelion, Descent, Pulsar, the menu tick). So whether a
tone counts depends only on how loud it reaches the microphone. Handling the case is still possible.

Next, hands-off on the Pi (Sam only needs to leave the deck alone with the volume where he plays):

```bash
.venv/bin/python scripts/tone-sweep.py          # the service running, knock input on, console at home
```

It plays each kind of game tone 3 times through the speaker with the console's envelope, plus silent
slots, and prints the taps each produced with peak and `hf`. Then, without a reflash:

- If tones produce taps and their `hf` sits below taps' (the arithmetic says a 150 Hz square or 520 Hz
  sine reads under 25; real taps measured 48 to 126), the console ignores a knock with `hf` under a
  floor set from that table.
- If `hf` overlaps, the console ignores a knock that arrives shortly after it started a sound, except
  where a game plays a sound on the tap's own beat (Pulsar's ticks), which then needs the `hf` floor or
  quieter ticks.
- If silence also produces taps, it is handling or the room, and the threshold is the lever.

## Pulsar removed (Sam, 2026-10-01: "tapping the case isn't really doing it for me … maybe ditch that game")

What changed, so it is easy to bring back:

- `web/apps/pulsar.js` is back to main's version (the tap lane is reverted); `tests/pulsar-tap.test.mjs` is
  deleted. `tests/pulsar.test.mjs` and the `Pulsar` factory in `web/apps/registry.js` stay.
- `vesper/catalog.json`: the `pulsar` entry and its place in the PLAY sector (between `runner` and
  `tideline`) are removed, so it is off the dashboard and the voice command `rhythm` no longer opens it.
  `web/apps/catalog.js` regenerated.
- Tests that listed it: `tests/test_catalog_sectors.py` (GAMES) and `tests/gesture-apps.test.mjs` (the
  registered games); `tests/browser-smoke.cjs` now takes the first sector's size from the catalog.
- `docs/OPERATOR.md` voice table no longer lists `rhythm`.
- Saved Pulsar records are not touched.

To restore: put this entry back in `vesper/catalog.json` `apps` (before `perihelion`) and `"pulsar"`
back in the PLAY sector, run `python3 scripts/build-catalog.py`, and revert the two test lists.

```json
{
  "id": "pulsar",
  "name": "PULSAR",
  "subtitle": "Keep time with a dying star.",
  "description": "Beats fall down three lanes toward the strike line. Tap on the beat; hold through the long signals. The song lasts about two minutes, if you keep the signal stable.",
  "controls": "TAP ON THE BEAT \u00b7 HOLD LONG SIGNALS \u00b7 LAMPS SWELL FIRST",
  "category": "PLAY / RHYTHM",
  "glyph": 3,
  "factory": "Pulsar",
  "voice": [
    "rhythm"
  ],
  "capabilities": [
    "button",
    "lights",
    "audio",
    "progress"
  ],
  "icon": "<path d=\"M4 24h9l4-12 6 24 5-18 3 6h13\"/><circle cx=\"24\" cy=\"24\" r=\"21\" stroke-dasharray=\"2 5\"/><circle cx=\"43\" cy=\"24\" r=\"2\" fill=\"currentColor\"/>",
  "record": {
    "score": "Score",
    "combo": "Best combo",
    "accuracy": "Accuracy %",
    "phrases": "Phrases reached"
  }
}
```

Knock input itself stays (firmware, service, Calibration, Node Scope, `app.knock(event)`); no game uses
it now.

## Two-microphone node: tap direction and the low-tone fix (2026-10-03, cloud session)

**Beep test** (Pi, new node, finished case, full volume, threshold 4000, `scripts/tone-sweep.py`): only the
two deep tones registered, 98 Hz 0.1 s square (5 in 3 plays) and 110 Hz 0.12 s triangle (5 in 3), peaks
30000 to full scale, `hf` 82 to 118, inside real taps' range. Every tone from 147 Hz up, 70 Hz 0.05 s and all
silent slots gave none. The speaker shakes the case. Fix: the synth records when it plays a tone under
140 Hz (and holds one), and the console drops knocks until 250 ms after it ends (`web/engine/audio.js`,
`web/main.js`).

**Tap direction.** The Pi's first labelled session (31 left, 35 right, 33 top, all detected; features only,
`tests/fixtures/tap-direction-2026-10-02.json`): level difference, cross-correlation lag and onset
difference between the microphones. Each tap left out in turn is placed 90/98 by the 5 nearest others, but a
calibration from the first half of each spot places the second half only 27/50 (and 37/48 the other way):
tapping drifts within one sitting. Left (onset +2 to +4) and top (-1 to -4) separate cleanly; right taps
scatter in onset and overlap top in level. So:

- The node sends the raw tap, not features: **KNOCK_CLIP** (type 10, just before its KNOCK, 16 + 160
  frames from both microphones). The Pi thread owns that firmware (PR #19). All measuring and deciding is in
  the service (`vesper/tapdir.py`) and can change without a reflash.
- The side comes from this node's own calibration (Calibration > TAP DIRECTION: ten taps on each side, lit
  on that side's lamp), by the 5 nearest labelled taps; fewer than 3 agreeing means no side (unsure). Each
  calibration is checked tap by tap when saved and shows the result.
- Knock events gain `tap` (the measurements), `sideVotes` and `side`. Games and the menu get them through
  `knock(event)` unchanged; a game must still work without a side.

Test on the device once the KNOCK_CLIP firmware is on the node: Calibration > TAP DIRECTION > CALIBRATE, ten
light taps where each lamp shows, then tap each side a few times and read LAST TAP. Then recalibrate in a
second sitting and compare: the check line and how often LAST TAP is right tell whether three sides are
dependable or only left against the rest.

**Spots changed (Sam, 2026-10-03):** left side, right side and **back**, not top. Back is the most comfortable
and is the main tap; left and right are there for games. `side` is now `back`, `left` or `right`; calibration
asks for the back first (middle lamp), then left and right. The first session's top taps stay in the test
fixture as a stand-in only; the second labelled session decides how well back separates.
