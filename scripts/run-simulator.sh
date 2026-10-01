#!/usr/bin/env bash
set -euo pipefail
vesper_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$vesper_root"
if [[ ! -x .venv/bin/python ]]; then
  python3 -m venv .venv
  .venv/bin/python -m pip install -e .
fi
exec .venv/bin/python -m vesper.server --simulate "$@"
