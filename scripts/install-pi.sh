#!/usr/bin/env bash
set -euo pipefail
vesper_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$vesper_root"
speech=1
for option in "$@"; do
  case "$option" in
    --no-speech) speech=0 ;;
    *) echo "Usage: scripts/install-pi.sh [--no-speech]" >&2; exit 2 ;;
  esac
done
if ! python3 -m venv .venv; then
  echo 'Install Python venv support first: sudo apt install python3-venv' >&2
  exit 1
fi
.venv/bin/python -m pip install --upgrade pip
if [[ "$speech" == 1 ]]; then
  .venv/bin/python -m pip install -e '.[speech]'
  .venv/bin/python scripts/get-voice-model.py
else
  .venv/bin/python -m pip install -e .
fi
echo 'VESPER is installed. Try: .venv/bin/python -m vesper.server --simulate'
echo 'For hardware: .venv/bin/python -m vesper.server --port /dev/serial/by-id/YOUR_NODE'
echo 'Open http://localhost:8799 in Chromium.'
