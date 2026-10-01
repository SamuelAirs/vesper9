<!-- launch: subagent_type=general-purpose model=sonnet isolation=worktree description='Audit Python service' -->
Your agent name is `audit-service`. Before anything else, read `/home/sam/VESPER-9-v0.2.0-Claude/fleet/RULES.md` and follow it exactly; it explains the project, the environment on this Raspberry Pi, what you must never touch, and the report format.

## Why this task exists

VESPER-9 is a one-button console: a browser front end, a Python service on a Raspberry Pi 5, and an ESP32 node reached over USB serial. The service runs unattended as a user service and holds the owner's scores, settings, timers, notes and sensor history. Overnight, a fleet of agents is improving the project, and the first step is finding real defects. You are the reviewer for the **Python service**. Other agents are separately reviewing the browser host, the games, performance and layout; stay in your lane.

## Your scope

- `vesper/server.py` (aiohttp app, WebSocket control, commands, timers, microphone modes, controller/monitor tabs)
- `vesper/device.py` (simulated node and the reconnecting serial transport; note it now accepts several comma-separated candidate ports and picks the first that exists on each attempt)
- `vesper/protocol.py`, `vesper/speech.py`, `vesper/storage.py`, `vesper/catalog.py`
- `scripts/install-service.py`, `scripts/kiosk.py`
- Their tests in `tests/test_runtime.py` and `tests/test_install.py`; `docs/PROTOCOL.md` and `docs/ENGINE.md` for intended behaviour

## What to look for

Behaviour that is actually wrong or fragile in unattended use, not style:

- asyncio hazards: tasks that can die silently, exceptions swallowed, blocking calls on the event loop, races between the serial reader, the heartbeat, WebSocket handlers and the speech worker, lock ordering, work done after cancellation.
- The serial link: reconnect after unplug, a node reset mid-session, a port that exists but never speaks the protocol, pending command futures, the generation counter, write timeouts, what happens when the port path changes between attempts.
- Command validation: every WebSocket command should reject wrong types and out-of-range values without raising an unhandled exception or corrupting stored state. Try booleans where integers are expected, huge numbers, missing fields, strings where lists are expected, unknown app ids.
- Persistence: SQLite usage, what a crash or power cut mid-write leaves behind, the 8 KiB progress limit, retention of sensor history, timers across restarts and clock changes, settings merged with new defaults after an upgrade.
- Microphone and speech: modes must start muted, a failure must never leave capture on, mode changes while the worker is busy, the bounded queue, session bookkeeping for notes.
- The HTTP surface: it must stay loopback-only; check Host/Origin handling, static file serving (path traversal), the export endpoints, and that a second tab can only monitor.
- Shutdown and restart: `close()` paths, service restart while a browser tab is connected.

## How to work

1. Read the files in scope completely.
2. Prove each suspected defect with a failing `unittest` test in a new file under `tests/audit/` (for example `tests/audit/test_audit_service.py`). `tests/test_runtime.py` shows how the existing tests drive the console with the simulated device and a temporary database; reuse those patterns. Run your file directly, for example `$PYTHON -m unittest tests/audit/test_audit_service.py -v`. The normal suite does not discover that directory, so failing tests there break nothing. Never run anything against the real serial device or the live service.
3. Do not modify any product file. Your only writes are new files under `tests/audit/` and your report. Commit them on your branch.
4. A few proven defects beat many guesses. Anything you cannot prove goes in a separate "unverified" section with the reason, or is dropped. Expect somewhere between a handful and fifteen findings; do not pad.

## What to deliver

The report at `/home/sam/VESPER-9-v0.2.0-Claude/fleet/reports/audit-service.md` in the format from the rules. For every proven finding: severity (breaks / wrong / rough), file and line, what the owner would experience, the test that demonstrates it with its actual failing output, and the smallest fix. Order by severity. Add a short section on anything in the service that would make it awkward to add (a) a small read-only system-health endpoint and (b) a new explicit microphone mode that analyses sound level and spectrum without speech recognition, because both are planned.

Your final message to me should be a summary under 250 words: number of findings by severity, the top three in one line each, the branch name and commit hash of your audit tests, and the report path.
