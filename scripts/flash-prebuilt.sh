#!/usr/bin/env bash
# Install the included N16R8 firmware without the full ESP-IDF toolchain.
set -euo pipefail
vesper_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ $# != 1 ]]; then
  echo 'Usage: bash scripts/flash-prebuilt.sh /dev/serial/by-id/YOUR_COM_PORT' >&2
  exit 2
fi
node_port="$1"
cd "$vesper_root/firmware/prebuilt"
sha256sum --check SHA256SUMS
if [[ ! -x "$vesper_root/.flash-env/bin/python" ]]; then
  python3 -m venv "$vesper_root/.flash-env"
fi
"$vesper_root/.flash-env/bin/python" -m pip install 'esptool==4.12.0'
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
"$vesper_root/.flash-env/bin/python" -m esptool --chip esp32s3 --port "$node_port" --baud 460800 read_flash 0x0 0x1000000 "$backup_file"
echo "Existing firmware backed up to $backup_file"
"$vesper_root/.flash-env/bin/python" -m esptool --chip esp32s3 --port "$node_port" --baud 460800 \
  write_flash --flash_mode dio --flash_size 16MB --flash_freq 80m \
  0x0 bootloader.bin 0x8000 partition-table.bin 0x10000 vesper_node.bin
echo 'VESPER node installed. Start the Pi service, then open Node Scope.'
