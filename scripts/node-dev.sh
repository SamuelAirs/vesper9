#!/usr/bin/env bash
# Development helper: build the node firmware and write it without a new
# full-flash backup. Use scripts/flash-node.sh for a first install.
set -euo pipefail
vesper_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ $# != 1 ]]; then
  echo 'Usage: scripts/node-dev.sh /dev/serial/by-id/NODE_PORT' >&2
  exit 2
fi
if ! command -v idf.py >/dev/null 2>&1; then
  # A PlatformIO Python environment on PATH prevents ESP-IDF's export.
  PATH="$(printf '%s' "$PATH" | tr ':' '\n' | grep -v platformio | paste -sd:)"
  . "${IDF_PATH:-$HOME/esp/esp-idf-v5.4.2}/export.sh" >/dev/null
fi
cd "$vesper_root/firmware"
idf.py build | tail -n 3
cd build
python -m esptool --chip esp32s3 --port "$1" --baud 460800 write_flash --flash_mode dio \
  --flash_size 16MB --flash_freq 80m 0x0 bootloader/bootloader.bin \
  0x8000 partition_table/partition-table.bin 0x10000 vesper_node.bin | grep -E 'Hash|Wrote|rror'
