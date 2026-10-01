<!-- launch: subagent_type=general-purpose model=sonnet isolation=worktree description='Audit host and engine' -->
Your agent name is `audit-host`. Before anything else, read `/home/sam/VESPER-9-v0.2.0-Claude/fleet/RULES.md` and follow it exactly; it explains the project, the environment on this Raspberry Pi, what you must never touch, and the report format.

## Why this task exists

VESPER-9 is a one-button console (browser front end + Python service + ESP32 node). Its owner played it tonight and liked it. Overnight, a fleet of agents is improving it, and the first step is finding real defects before anyone builds on top of them. You are the reviewer for the browser **host and engine**. Other agents are separately reviewing the games, the Python service, performance and screen layout, so stay in your lane.

## Your scope

- `web/main.js` (the host: navigation, app lifecycle, menus, status, events)
- `web/engine/*.js` (input router, light director, bridge, demo bridge, audio, draw, math, status)
- `web/index.html` only as far as it affects the above
- How these are exercised by `tests/engine.test.mjs` and `tests/browser-smoke.cjs`

You are looking for behaviour that is actually wrong, not style. The areas most likely to hide defects:

- The input router: click-sequence menu gesture (3 or 4 quick clicks), the hold-to-select threshold, the three-second hold escape, source/epoch/generation ownership, `cancel()`, releases arriving after an app change, settings changing mid-press, keyboard and node events interleaving.
- App lifecycle: mount, pause/resume, dispose, the "retired context" guard, exceptions thrown by an app in `update`, `draw`, `down`, `up`, `event`, `tick`, and the recovery menu.
- The light director: generations, the cached "sent" value, `release()`, `suspend()`, effects versus plain `leds()`, behaviour across disconnect and reconnect.
- The bridge: reconnect, request/reply correlation, replies that never arrive, controller versus monitor tabs, what the page does when the service restarts underneath it.
- Parity between `demo.js` (the standalone simulator's fake service) and what the real service does for the same commands (compare with `vesper/server.py`, read-only).
- Timers, microphone status and sensor staleness as displayed by the host.

## How to work

1. Read the files in scope completely, and `docs/ENGINE.md` for the intended contracts.
2. For each suspected defect, prove it. Preferred proof is a failing test written with `node:test` in a new file under `tests/audit/` (for example `tests/audit/host.test.mjs`); look at `tests/engine.test.mjs` for how the existing tests build a harness. That directory is not part of the normal suite, so failing tests there break nothing. Where a defect only shows in a real browser, write a small Playwright script under `tests/audit/` that runs against an isolated simulator (see how `tests/browser-smoke.cjs` starts one with `tests/free-port.cjs`) and include its real output.
3. Do not modify any product file. Your only writes are new files under `tests/audit/` and your report. Commit the audit tests on your branch.
4. Quality over quantity. A short list of proven defects is worth far more than a long list of maybes. If you cannot prove something, either drop it or list it in a clearly separate "unverified" section with the reason you could not prove it. Expect to end with somewhere between a handful and fifteen findings; do not pad.

## What to deliver

The report at `/home/sam/VESPER-9-v0.2.0-Claude/fleet/reports/audit-host.md` in the format from the rules. For every proven finding give: severity (breaks / wrong / rough), file and line, what a user would experience, the test name or script that demonstrates it with its actual failing output, and the smallest fix you would make. Order by severity. End with the three findings you think matter most to someone playing with one button on the real device.

Your final message to me should be a summary under 250 words: how many findings by severity, the top three in one line each, the branch name and commit hash of your audit tests, and the report path.
