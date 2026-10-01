# Installation and bring-up

## Updating an existing VESPER installation

Extract 0.2.0 into a new folder. Preserve your working copy and consistently back up its data while its service is stopped. The bundled node firmware is unchanged; do not reflash an already compatible VESPER node just to update the app. Point the new service at the existing data directory:

```bash
.venv/bin/python scripts/install-service.py --port /dev/serial/by-id/YOUR_COM_PORT --data /absolute/path/to/existing/data/console --kiosk
```

The installer now backs up existing VESPER service/autostart files under `backups/service-TIMESTAMP/` before replacing them, then restarts the service so an already-running installation uses the new checkout. Re-running the installer without `--data` keeps the data directory of the service it replaces (an explicit `--data`, another checkout's default, or the simulator's), prints which directory it uses and never silently switches databases; pass `--data` to change it on purpose. Inspect those backups and record your source/data paths. To roll back, stop the new user service, restore the old service/autostart files, run `systemctl --user daemon-reload`, and start the old source with its preserved data. If restoring a database backup, restore it consistently while the service is stopped. Do not delete current notes as an incidental downgrade.

## 1. Prepare the Pi

Target: Raspberry Pi 5, Raspberry Pi OS 64-bit Desktop, Python ≥ 3.10, Chromium, an attached display, and the existing ESP32-S3 N16R8 node connected through **COM**. Use a powered Pi setup suitable for your existing hardware. The software does not require the node's second USB-C port, Wi-Fi, or a wiring change.

Extract the project into a permanent location such as `~/vesper9`. Installation and kiosk paths refer to this folder; rerun the service installer if you move it.

```bash
cd ~/vesper9
sudo apt update
sudo apt install python3-venv chromium
bash scripts/install-pi.sh
```

Installation needs internet access for Python packages and the official English Vosk model (approximately 40 MB compressed). Afterward, normal operation is local. The installer uses `.venv/` and does not replace the OS Python. Use `bash scripts/install-pi.sh --no-speech` for games and instruments without recognition.

Find the node:

```bash
ls -l /dev/serial/by-id/
```

Prefer a stable `/dev/serial/by-id/...` entry over `/dev/ttyUSB0`. If the CH343 appears only as `/dev/ttyUSB0`, that path also works, but its name can change after reconnects. Serial permissions may require:

```bash
sudo usermod -aG dialout "$USER"
```

Log out and back in after changing group membership. Close serial monitors, Arduino IDE monitors, and any previous program using the COM port before flashing or starting VESPER.

## 2. Install the supplied node firmware

The Pi runtime speaks the VESPER v1 protocol; it cannot infer the format used by an existing sketch. The supplied firmware is a complete replacement for the node program and uses the existing wiring. Your board description specifies 16 MB flash and 8 MB octal PSRAM. Review `firmware/main/hardware.h` if your board variant uses nonstandard UART pins.

### Use the prebuilt firmware

```bash
cd ~/vesper9
bash scripts/flash-prebuilt.sh /dev/serial/by-id/YOUR_COM_PORT
```

This verifies the included image checksums, creates an isolated `.flash-env`, installs esptool 4.12.0, stops an active VESPER user service, reads a **full 16 MB backup**, and then writes the bootloader, partition table, and application. A failed backup stops the process before flashing. Existing backup files use timestamps. The prior service state is restored on exit.

The exact flash locations are:

| Address | Image |
| --- | --- |
| `0x0000` | `bootloader.bin` |
| `0x8000` | `partition-table.bin` |
| `0x10000` | `vesper_node.bin` |

Settings: ESP32-S3, DIO, 80 MHz flash, 16 MB. The runtime UART uses **921600 baud**; flash/backup operations use **460800 baud**.

If automatic download mode does not work on your board, hold its BOOT button while tapping RESET, release BOOT, then retry. Follow your board's existing flashing procedure. No normal arcade gesture invokes firmware flashing.

### Build from source instead

Use Espressif's ESP-IDF **v5.4.2** installation instructions for your build machine. A typical Linux setup is:

```bash
sudo apt install git wget flex bison gperf python3 python3-pip python3-venv cmake ninja-build ccache libffi-dev libssl-dev dfu-util libusb-1.0-0
mkdir -p ~/esp
git clone --branch v5.4.2 --recursive https://github.com/espressif/esp-idf.git ~/esp/esp-idf-v5.4.2
cd ~/esp/esp-idf-v5.4.2
./install.sh esp32s3
. ./export.sh
cd ~/vesper9
bash scripts/build-firmware.sh
bash scripts/flash-node.sh /dev/serial/by-id/YOUR_COM_PORT
```

The project already selects the ESP32-S3 target. Do not run an unnecessary `set-target` operation over local configuration changes. `sdkconfig.defaults` describes the N16R8 memory profile; the prebuilt directory contains the exact configuration used for its build. Firmware logs are disabled on UART0 because that UART carries binary data. Node Scope displays the useful counters.

### Restore the previous firmware

Stop VESPER and close serial monitors, choose the exact backup you want, then write the full backup at address zero:

```bash
systemctl --user stop vesper.service
.flash-env/bin/python -m esptool --chip esp32s3 --port /dev/serial/by-id/YOUR_COM_PORT --baud 460800 write_flash 0x0 backups/CHOSEN_BACKUP.bin
```

If you used the source-flash route, use `python -m esptool` from the activated ESP-IDF environment instead. Your prior application will then own the node; the VESPER Pi service should remain stopped until you reinstall its protocol firmware.

## 3. First console launch

```bash
cd ~/vesper9
.venv/bin/python -m vesper.server --port /dev/serial/by-id/YOUR_COM_PORT
```

Open `http://localhost:8799` in Chromium on the Pi. The link should read **NODE LINK ACTIVE**, and the microphone starts **OFF**. The server binds only `127.0.0.1`; this is a local appliance, not a network remote-control server. Keep one controlling tab. Additional tabs are monitors and cannot change the node.

Choose **Next sector → Node Scope**, then:

1. Tap and release the arcade button. Confirm the focus advances once per press. Hold and release to select.
2. Select each light and cycle red, green, blue, white, and off. Confirm left/middle/right match the labels.
3. Confirm temperature and humidity populate within several seconds. The firmware probes SHT3x addresses `0x44` and `0x45`.
4. Enable voice in the microphone menu. Speak normally near the INMP441; confirm the mic meter responds. Say “computer home.”
5. Start Field Notes, dictate a short sentence, stop, refresh saved notes, and export it.
6. Open Light Trial and test the physical middle light. Disconnect and reconnect the node once; games should pause and the microphone should return to off.

These steps qualify physical behavior that cannot be established by compiling or desktop simulation.

## 4. Automatic startup and kiosk

Stop the manually launched server with Ctrl-C before enabling the service:

```bash
.venv/bin/python scripts/install-service.py --port /dev/serial/by-id/YOUR_COM_PORT --kiosk
```

The Python user service starts at user login. Chromium enters kiosk mode at graphical desktop login. Enable **Desktop Autologin** through Raspberry Pi OS settings if you want the console to appear after boot without typing. This does not create a system-wide root service or alter OS login settings automatically.

```bash
systemctl --user status vesper.service
journalctl --user -u vesper.service -f
systemctl --user restart vesper.service
```

At login the kiosk launcher waits up to three minutes for the service. If it still does not answer, the browser opens a "VESPER-9 SERVICE NOT RESPONDING" page that retries every three seconds and opens the console as soon as the service is up (the launcher also prints a note to its stderr). Restarting the service with the console open takes about a second: open tabs are closed first and reconnect by themselves.

Alt-F4 closes the kiosk window. To disable automatic startup:

```bash
systemctl --user disable --now vesper.service
rm ~/.config/autostart/vesper.desktop
```

For a speech-enabled desktop simulator, install normally and run `.venv/bin/python -m vesper.server --simulate`. In that mode, voice uses the browser's permitted microphone, with audio sent only to the local Python service. The standalone HTML file has no recognition service.

## Audio, display, and files

- Select the Pi's HDMI or USB audio device in the OS. There is no speaker attached to the supplied ESP32 wiring. Every game can be played with sound disabled.
- The entire console game layout, including status and controls, was checked at 1280 × 720. The game canvas scales to the available middle pane; utility content scrolls while the control deck stays visible on desktop. Qualify actual Pi display scaling and legibility.
- Data defaults to `data/console/vesper.sqlite3`; server simulation uses `data/simulator/vesper.sqlite3`. Pass `--data /some/path` to use another location.
- Back up the data directory while the service is stopped, including any SQLite sidecar files. Transcript exports are ordinary browser downloads.
- Keep the Pi clock correct. Timer deadlines use the OS wall clock to survive service restarts. A timer that expires while the service is off reports completion after restart; the powered-off console cannot sound an alert.
- Scores, settings, transcripts, and timers persist. A game's in-progress run does not resume after power loss. Morse progress saves after each answer; game field summaries save at completed results.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Permission denied opening serial | `dialout` group, new login, correct device path. |
| Node disconnected | COM port, firmware version, 921600 baud, another process holding serial, board reset. |
| All hardware input works but no sound | OS output device; Calibration → Sound; enable Chromium autoplay via supplied kiosk launcher. A regular browser may need one mouse/keyboard interaction. |
| Voice unavailable | Run the installer without `--no-speech`, or `.venv/bin/pip install -e '.[speech]'` followed by `.venv/bin/python scripts/get-voice-model.py`. |
| Commands recognized inconsistently | Say an exact phrase after “computer”; try nearer the microphone and reduce speaker volume. Command mode and dictation are separate. |
| No mic level | Node Scope → Capture, INMP441 left slot, supplied pin map, actual I²S behavior. The mic is not a USB audio device over COM. |
| CRC errors or missing samples increase | USB cable/link stability, another serial program, host load. Node button events have priority over audio; occasional audio loss is counted. |
| Button appears stuck after reconnect | Release it once. A held switch is suppressed across reset until released. An already released switch is reconciled from node status; its next fresh press should work. |
| Timer action does not work in a second tab | Close the controller tab, then reload the remaining tab to claim control. |
| Speech is slow while games run | Start with the supplied small model. Check Pi CPU load, cooling, and power. Frame-rate/recognition performance on this particular Pi is not yet measured. |
| Firmware won't start after flashing | N16R8 memory profile and board variant; review `sdkconfig.defaults` and `hardware.h`, or restore the saved flash. |

Official references: [ESP-IDF v5.4.2 setup](https://docs.espressif.com/projects/esp-idf/en/v5.4.2/esp32s3/get-started/index.html), [Vosk installation](https://alphacephei.com/vosk/install), [Vosk models](https://alphacephei.com/vosk/models).
