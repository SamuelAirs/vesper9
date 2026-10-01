# Working on VESPER-9 from the desktop

Written 2026-10-01 by the coordinating Claude session on Sam's Raspberry Pi, for a Claude
session on Sam's desktop PC. Read this first, then `AGENTS.md` and `docs/ENGINE.md`.

## What this is

VESPER-9 is Sam's one-button console: a Raspberry Pi 5 "cyberdeck" on a battery pack with a
1024 × 600 display, and an ESP32-S3 node with one arcade button, three RGB lamps, a
microphone and a temperature/humidity sensor. `web/` is the browser front end and the apps,
`vesper/` is the Python service, `firmware/` is the node firmware.

Until now all development ran on the Pi itself, with one coordinating session and
sub-agents in git worktrees. That works the Pi hard, drains the battery, and it has gone
down several times mid-task. Game and instrument work needs no hardware, so it is moving to
the desktop. **The Pi keeps everything that touches the device.**

## Division of labour

| Desktop | Pi only |
| --- | --- |
| Games, instruments, host and engine code, service code, tests, docs | The node: serial port, flashing, `scripts/node-probe.py`, `scripts/node-dev.sh` |
| Headless browser tests and screenshots in the simulator | The live console (`vesper.service`, port 8799) and Sam's data in `data/` |
| Speech benchmarks (a GPU does not change the product: recognition must run on the Pi's CPU) | Deploying: the Pi pulls `main` and restarts the service |

Nothing on the desktop can be "verified on the device". Say so in every report.

## Set up

```bash
git clone <this repository> vesper9 && cd vesper9
python3 -m venv .venv && .venv/bin/pip install -e .          # add '.[speech,refine]' only for speech work
npm install --no-save playwright && npx playwright install chromium   # browser tests and screenshots
python3 scripts/build-demo.py                                  # generates the standalone simulator
.venv/bin/python -m vesper.server --simulate                   # http://localhost:8799, Space is the button
```

Verification, all of which must pass before anything is merged to `main`:

```bash
node --test tests/*.test.mjs
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
python3 scripts/build-catalog.py --check
python3 scripts/build-demo.py
PYTHON=.venv/bin/python node tests/browser-smoke.cjs
PYTHON=.venv/bin/python node tests/extension-smoke.cjs
PYTHON=.venv/bin/python node tests/host-browser.cjs
PYTHON=.venv/bin/python node tests/voice-host.cjs
```

`scripts/dev-shot.cjs` drives any app in an isolated simulator at 1024 × 600 with button
steps (`tap`, `hold:MS`, `gesture`, `eval:`) and saves screenshots. Look at every
screenshot you take. Tests that need the speech models skip when the models are absent.

## Working rules

- `fleet-notes/RULES.md` and `fleet-notes/APP-GUIDE.md` are the rules and the app-writing
  guide the Pi's agents followed. Their absolute paths (`/home/sam/VESPER-9-v0.2.0-Claude/…`)
  and the heat rule are Pi-specific; everything else applies unchanged.
- `fleet-notes/FEEDBACK-1.md` is Sam's own reaction to every app on the real device, and
  his direction: one consistent menu gesture (done: tap, tap, hold), more lamp use, and
  **"really making every game as deep as we can"**. His favourites are Perihelion and
  Outpost. `fleet-notes/STATUS.md` is the coordinator's log, including the agreed order of
  the depth round. `fleet-notes/reports/` holds every agent's report.
- One agent per file. Each game is one file under `web/apps/` with one test file. Shared
  code (`web/main.js`, `web/engine/*`, `vesper/*`, `web/style.css`, the catalog) gets one
  owner at a time.
- Work on a branch, open a pull request or push the branch, and merge to `main` only when
  the whole verification passes. The Pi deploys from `main`, so a red `main` is a broken
  console in Sam's hands.
- Sam's saved progress must survive every change: version and migrate app saves, with a
  test that loads a save written by the previous version.
- Never commit `data/`, `backups/` (contains a firmware backup with Wi-Fi credentials),
  `models/`, virtual environments or `node_modules/`. `.gitignore` already excludes them.
- Keep evidence honest: a claim needs a test, a number or a screenshot you looked at.

## What is in flight (as of this file)

- On the Pi: `depth-perihelion` (regions, relics, probes, goals around the unchanged swing)
  is running and will land on `main` from the Pi. Do not start Perihelion work on the desktop.
- Not started, and good first desktop tasks, in the order Sam agreed:
  1. **Moonrunner** (`web/apps/runner.js`): rebuild as a smooth downhill run in the spirit
     of Alto's Adventure; the scrolling background was jerky.
  2. **Ballista** (`web/apps/ballista.js`): rebuild as a launch-for-distance game like
     Kitten Cannon, with things that bounce, slow and boost the projectile.
  3. Tideline and Outpost: more depth on what exists (Outpost just gained music, statistics,
     goals and research; see `fleet-notes/reports/depth-outpost.md`).
  4. Descent (too slow), Helix (clunky, one-way turning disliked), Pulsar (lanes make little
     sense with one button; lamps underused), Undertow (slow ramp, weak propulsion).
  5. Echo Vault and Glyph Archive: rebuild around learning something (he likes Signal
     School and would "prefer to be learning").
  6. Orbit Lock, Ricochet, Light Trial: light touch; keep Light Trial simple.
  Also wanted: more games playable with only the button and the lamps, more educational
  instruments, a gain argument for `ctx.tone`, and a lamp program that survives leaving
  Lantern.
- Pi-only and pending Sam's time: knock-on-the-case input in the node firmware.

## Getting work onto the console

Push to `main`. On the Pi the coordinator (or Sam) runs:

```bash
cd ~/VESPER-9-v0.2.0-Claude/vesper9 && git pull --ff-only
git -C ../live checkout --detach origin/main && (cd ../live && python3 scripts/build-demo.py)
systemctl --user restart vesper.service
```
