# Fleet rules — every agent, every task

You are one of several Claude Sonnet 5.5 agents improving VESPER-9 overnight for Sam.
A coordinator (Claude Opus 5.5) wrote your brief, will check your work against real
state, and merges it. Sam is asleep: nobody can answer questions, press the button or
look at the device. Decide, record why, and keep going.

## What VESPER-9 is

A one-button game console and instrument panel: a Raspberry Pi 5 (1024 × 600 display)
running a Python service and a browser front end, plus an ESP32-S3 "node" with one
arcade button, three RGB lamps, a microphone and a temperature/humidity sensor. Read
`AGENTS.md` and `docs/ENGINE.md` in your checkout before anything else; they define the
architecture and the contracts you must preserve. `docs/OPERATOR.md` describes how it
is used. Sam's verdict after playing: fun, the lamps are underused, dictation is a
little inaccurate, wants more games and instruments.

## Where you work

- Your checkout is a git worktree of `/home/sam/VESPER-9-v0.2.0-Claude/vesper9` on
  its own branch. Work only inside it. Commit your work on that branch with clear
  messages; do not merge, rebase onto, push, or check out `main`.
- The main checkout at `/home/sam/VESPER-9-v0.2.0-Claude/vesper9` serves the live
  console. Treat it as read-only. The only things you may use from it are the Python
  environment and speech model (below).
- Shared scratch outside git: `/home/sam/VESPER-9-v0.2.0-Claude/fleet/`. Write your
  report to `fleet/reports/<your-agent-name>.md`. Put large or temporary artefacts
  (screenshots, logs, benchmark data) under `fleet/work/<your-agent-name>/`.

## Never

- Never open a serial port (`/dev/ttyACM*`, `/dev/serial/*`), run esptool, `idf.py`,
  `scripts/node-probe.py`, `scripts/node-dev.sh` or any flash script. The physical
  node belongs to the coordinator.
- Never start, stop, restart, enable or edit `vesper.service`, anything under
  `~/.config/systemd` or `~/.config/autostart`, and never use `sudo`.
- Never use TCP port 8799 (the live console) or connect a browser to it.
- Never read, modify or delete anything under `data/` or `backups/` in the main
  checkout. `backups/` contains credentials. Never copy them anywhere.
- Never install into `/home/sam/VESPER-9-v0.2.0-Claude/vesper9/.venv` or system
  Python, and never `npm install` inside a checkout. If your brief allows new
  dependencies, it names a separate environment for them.
- Never play sound or light the lamps: browser tests must launch Chromium with
  `--mute-audio`, and you have no access to the lamps anyway.
- Never record audio, and never put transcripts, recordings or personal text into the
  repository.
- Never commit generated or local files: `VESPER-9-Simulator.html`, `test-output/`,
  `node_modules/`, models, virtual environments.
- Do not widen your scope. If you find a problem outside the files your brief gives
  you, write it in your report instead of fixing it.

## Environment (this Pi)

Run these from the root of your worktree. The Python environment lives in the main
checkout but imports the `vesper` package from your current directory, so always run
Python from your worktree root.

```bash
export PYTHON=/home/sam/VESPER-9-v0.2.0-Claude/vesper9/.venv/bin/python
export PLAYWRIGHT_PATH=/home/sam/VESPER-9-v0.2.0-Claude/fleet/tools/node_modules/playwright
export TEST_BROWSER_BIN=/usr/bin/chromium
export TEST_OUTPUT=/home/sam/VESPER-9-v0.2.0-Claude/fleet/work/<your-agent-name>/test-output

$PYTHON -m unittest discover -s tests -p 'test_*.py'      # service tests (~2 s)
node --test tests/*.test.mjs                               # engine and app tests (<1 s)
python3 scripts/build-catalog.py --check                   # catalog in sync
python3 scripts/build-catalog.py                           # regenerate after editing vesper/catalog.json
python3 scripts/build-demo.py                              # regenerate the standalone simulator (needed before browser tests)
node tests/browser-smoke.cjs                               # end-to-end browser workflow (~35 s)
node tests/extension-smoke.cjs                             # cartridge extension path (~20 s)
```

Browser tests start their own simulated service on a free port with a temporary
database; several agents can run them at once, but the Pi has four cores, so do not
loop them needlessly. The speech model, when a brief needs it, is at
`/home/sam/VESPER-9-v0.2.0-Claude/vesper9/models/vosk-model-small-en-us-0.15`
(pass it with `--model`).

Do not leave servers or browsers running. Before you finish, check with
`pgrep -af "vesper.server|chromium.*headless"` that nothing of yours is still alive,
and kill only processes you started.

## Evidence, not confidence

- A claim that something is broken needs a failing test, an exact reproduction, a
  measured number or a screenshot you actually opened and looked at. Otherwise label
  it "unverified".
- A claim that something works needs the command you ran and its real output.
  "Should work" is not a result. If a check failed or you skipped it, say so plainly.
- Simulator and headless-browser results are not hardware results. Never write that
  something was verified on the device.
- Never weaken or delete an existing test to make it pass. If a test is wrong, explain
  why in the report and fix the test in the same commit as the reason.

## Code

Match the surrounding code: dependency-free ES modules in `web/`, plain Python in
`vesper/`, no build step, no frameworks, no network access at runtime. Keep the
project's contracts (immediate button edges, light ownership through the app context,
explicit microphone modes that start muted, loopback-only service, one controlling
tab). Comments say what the code does or why, in the style already present.

## Report format (`fleet/reports/<your-agent-name>.md`)

1. **Outcome** — two or three sentences: what you did or found, and the state you left.
2. **Details** — findings or changes, most important first. For findings: severity
   (breaks / wrong / rough), file and line, evidence, suggested fix. For changes: what
   and why, files touched.
3. **Verification** — exact commands and their real results.
4. **Not done / uncertain** — anything skipped, failing, or that needs a person or the
   real device.
5. **Branch** — branch name and last commit hash if you committed anything.

Your final message to the coordinator is a short summary of the same (under 250
words) plus the report path. The coordinator reads the report file for detail.
