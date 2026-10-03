#!/usr/bin/env bash
# Build the node firmware for one board profile (firmware/main/hardware.h).
# Usage: scripts/build-firmware.sh [1|2]   (1: the first node, three lamps and one microphone;
#                                           2: the second node, four lamps and two microphones)
# Each board builds into its own directory, firmware/build-board1 or firmware/build-board2.
set -euo pipefail
vesper_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
board="${1:-1}"
if [[ "$board" != 1 && "$board" != 2 ]]; then
  echo 'Usage: scripts/build-firmware.sh [1|2]' >&2
  exit 2
fi
if ! command -v idf.py >/dev/null 2>&1; then
  # A PlatformIO Python environment on PATH prevents ESP-IDF's export.
  PATH="$(printf '%s' "$PATH" | tr ':' '\n' | grep -v platformio | paste -sd:)"
  . "${IDF_PATH:-$HOME/esp/esp-idf-v5.4.2}/export.sh" >/dev/null
fi
cd "$vesper_root/firmware"
idf.py -B "build-board$board" -DNODE_BOARD="$board" build
