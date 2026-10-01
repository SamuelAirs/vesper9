<!-- launch: subagent_type=general-purpose model=sonnet isolation=worktree description='Measure performance hot spots' -->
Your agent name is `audit-performance`. Before anything else, read `/home/sam/VESPER-9-v0.2.0-Claude/fleet/RULES.md` and follow it exactly; it explains the project, the environment on this Raspberry Pi, what you must never touch, and the report format.

## Why this task exists

VESPER-9 is a one-button console: a browser front end drawing 960 × 540 Canvas games at a fixed 60 Hz simulation step, a Python service, and an ESP32 node. It runs on a Raspberry Pi 5 (4 cores, 8 GB) in Chromium on a 1024 × 600 display, and local speech recognition shares the same CPU. Nobody has measured where the time goes on this Pi. Overnight, a fleet of agents is improving the project and adding twelve more apps, so the cheap performance wins and the real costs need to be known first. You are the **performance** investigator. Other agents are reviewing correctness of the host, games and service; you only care about cost.

## What to measure (numbers on this Pi, not guesses)

Start an isolated simulated service (see how `tests/browser-smoke.cjs` and `tests/soak.cjs` do it with `tests/free-port.cjs`) and drive it with Playwright using the system Chromium, headless, with `--mute-audio`. Then measure at least:

1. **Per-app frame cost:** for each of the six games and Signal School, time spent in the app's `update` and `draw` per frame (mean and 95th percentile, in milliseconds) over at least 20 seconds of active play driven by simulated button presses. Wrap the methods from the page, or use the host's own frame statistics if they are adequate (Node Scope shows a frame p95; find where it comes from). Also the host's own per-frame overhead outside the app.
2. **Instrument panels:** how often each instrument rewrites its DOM and how much (a `MutationObserver` count of added nodes per second works), especially panels that re-render every second or on every event. Note anything that rebuilds `innerHTML` while the user may be navigating it.
3. **Message traffic:** WebSocket messages per second and bytes per second between page and service when idle on the dashboard, in a game, and in Node Scope; what triggers them.
4. **The service:** CPU percentage and resident memory of the simulated service process when idle, in a game, and over a five-minute run rotating through all apps (read `/proc/<pid>/stat` and `status` for the process you started). Report growth, if any.
5. **Start-up:** time from navigation to `vesper.loaded`, and the size of what is loaded.
6. **Memory in the page:** JS heap at start and after the five-minute rotation.

State clearly what your set-up can and cannot tell us: headless Chromium here renders in software and is not the kiosk browser on the real display, so absolute frame times differ, but JavaScript time in `update`/`draw`, DOM churn, message counts and Python CPU are meaningful.

## What to find

From the measurements and from reading `web/main.js`, `web/engine/*.js`, `web/apps/*.js` and `vesper/server.py`, identify the concrete costs worth removing: per-frame allocations, repeated layout or style work, gradients/shadows/text rebuilt every frame, redundant re-renders, chatty events, work that continues while paused or hidden, anything quadratic. Rank them by measured cost.

## What you may change

You are primarily an investigator. You may additionally implement **small, self-contained optimisations** when all of these hold: the change is local to one function or one render path, behaviour and appearance are unchanged, the existing tests still pass (`node --test tests/*.test.mjs`, the Python suite, and `node tests/browser-smoke.cjs` after `python3 scripts/build-demo.py`), and you measured before and after. One optimisation per commit, with the before/after numbers in the commit message. Anything larger, riskier or visible goes in the report as a proposal with the expected gain. Do not restructure code, and do not touch files under `vesper/` beyond trivial hot-path fixes.

Keep your measurement scripts under `tests/audit/` (for example `tests/audit/perf-frames.cjs`) and commit them so the measurements can be repeated after tonight's changes.

## What to deliver

The report at `/home/sam/VESPER-9-v0.2.0-Claude/fleet/reports/audit-performance.md` in the format from the rules: a results table for each measurement above with the exact commands used; the ranked list of costs; what you changed (commit by commit, with numbers) and what you propose but did not do; and a one-paragraph "performance budget" recommendation that authors of new games should follow (for example a ceiling on `update` + `draw` time per frame, and things to avoid in `draw`).

Your final message to me should be a summary under 250 words: the three most expensive things you found with their numbers, what you changed, the branch name and last commit hash, and the report path.
