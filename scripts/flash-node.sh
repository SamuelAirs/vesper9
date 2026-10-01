#!/usr/bin/env bash
set -euo pipefail
vesper_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ $# != 1 ]]; then
  echo 'Usage: scripts/flash-node.sh /dev/serial/by-id/YOUR_COM_PORT' >&2
  exit 2
fi
node_port="$1"
if ! command -v idf.py >/dev/null 2>&1; then
  echo 'Activate ESP-IDF v5.4.2 first. See docs/INSTALL.md.' >&2
  exit 1
fi
cd "$vesper_root/firmware"
idf.py build
service_was_active=0
if systemctl --user is-active --quiet vesper.service 2>/dev/null; then
  service_was_active=1
  systemctl --user stop vesper.service
fi
restore_service() {
  if [[ "$service_was_active" == 1 ]]; then systemctl --user start vesper.service; fi
}
trap restore_service EXIT
mkdir -p "$vesper_root/backups"
backup_file="$vesper_root/backups/node-before-vesper-$(date +%Y%m%d-%H%M%S).bin"
python -m esptool --chip esp32s3 --port "$node_port" --baud 460800 read_flash 0x0 0x1000000 "$backup_file"
echo "Existing firmware backed up to $backup_file"
idf.py -p "$node_port" -b 460800 flash
echo 'VESPER node flashed. The microphone starts off.'
