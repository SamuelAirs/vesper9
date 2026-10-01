#!/usr/bin/env bash
set -euo pipefail
vesper_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if ! command -v idf.py >/dev/null 2>&1; then
  echo 'Activate ESP-IDF v5.4.2 first. See docs/INSTALL.md.' >&2
  exit 1
fi
cd "$vesper_root/firmware"
idf.py build
