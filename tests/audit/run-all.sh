#!/bin/bash
# Run every performance audit script in sequence from the repository root.
# Usage: AUDIT_OUT=/path/to/out tests/audit/run-all.sh
# Needs PYTHON, PLAYWRIGHT_PATH and TEST_BROWSER_BIN as in fleet/RULES.md.
cd "$(dirname "$0")/../.." || exit 1
export AUDIT_OUT=${AUDIT_OUT:-test-output/audit}
mkdir -p "$AUDIT_OUT"
uptime > "$AUDIT_OUT/load-start.txt"
node tests/audit/perf-startup.cjs > "$AUDIT_OUT/startup.log" 2>&1
FRAME_SECONDS=${FRAME_SECONDS:-25} node tests/audit/perf-frames.cjs > "$AUDIT_OUT/frames.log" 2>&1
STATE_SECONDS=${STATE_SECONDS:-20} MODEL=${MODEL:-} node tests/audit/perf-states.cjs > "$AUDIT_OUT/states.log" 2>&1
node tests/audit/perf-soak.cjs > "$AUDIT_OUT/soak.log" 2>&1
uptime > "$AUDIT_OUT/load-end.txt"
echo done > "$AUDIT_OUT/DONE"
