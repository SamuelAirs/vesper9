#!/usr/bin/env bash
# Coordinator: merge an agent branch into main, run every suite on the result,
# and undo the merge if anything fails.  merge.sh <branch> "<subject>" ["<body>"]
set -uo pipefail
cd /home/sam/VESPER-9-v0.2.0-Claude/vesper9 || exit 2
branch="$1"; subject="$2"; body="${3:-}"
[ -z "$(git status --short)" ] || { echo "main is dirty"; git status --short | head; exit 2; }
before=$(git rev-parse HEAD)
echo "files: $(git diff --name-only main...$branch | tr '\n' ' ')"
git merge -q --no-ff "$branch" -m "$subject" -m "$body" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01C49JuJZet9HgXQxAj15hHu" || { echo "MERGE CONFLICT"; git diff --name-only --diff-filter=U; exit 3; }
export PLAYWRIGHT_PATH=$HOME/VESPER-9-v0.2.0-Claude/fleet/tools/node_modules/playwright TEST_BROWSER_BIN=/usr/bin/chromium PYTHON=$PWD/.venv/bin/python TEST_OUTPUT=$HOME/VESPER-9-v0.2.0-Claude/fleet/test-output
fail=0
node --test tests/*.test.mjs > /tmp/merge-js.log 2>&1 || fail=1; grep -E "^# (pass|fail)" /tmp/merge-js.log | tr '\n' ' '; echo
$PYTHON -m unittest discover -s tests -p 'test_*.py' > /tmp/merge-py.log 2>&1 || fail=1; tail -1 /tmp/merge-py.log
python3 scripts/build-catalog.py --check || { echo "catalog stale"; fail=1; }
python3 scripts/build-demo.py > /dev/null || fail=1
node tests/browser-smoke.cjs > /tmp/merge-browser.log 2>&1 || fail=1; grep -oE '"passed":(true|false),"appsExercised":[0-9]+' /tmp/merge-browser.log || grep -vE "^INFO" /tmp/merge-browser.log | head -8
node tests/extension-smoke.cjs > /tmp/merge-ext.log 2>&1 || fail=1; grep -oE '"passed":(true|false)' /tmp/merge-ext.log || grep -vE "^INFO" /tmp/merge-ext.log | head -8
if [ $fail = 1 ]; then echo "FAILED: undoing merge"; grep -E "^not ok|Error" /tmp/merge-js.log | head -10; git reset -q --hard "$before"; exit 1; fi
echo "MERGED $(git log --oneline | head -1)"
