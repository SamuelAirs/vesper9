#!/usr/bin/env bash
set -euo pipefail
vesper_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ $# != 3 ]]; then
  echo 'Usage: scripts/flash-node.sh BOARD PORT EXPECTED_MAC (activate ESP-IDF or install esptool==4.12.0 first)' >&2
  exit 2
fi
exec python "$vesper_root/scripts/flash-node.py" --board "$1" --port "$2" --expected-mac "$3"
