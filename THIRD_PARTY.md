# Dependencies and notices

Original VESPER source, procedural artwork, documentation, and synthesized-sound definitions use the MIT license in `LICENSE`.

| Dependency | Use | Upstream |
| --- | --- | --- |
| ESP-IDF v5.4.2 | ESP32-S3 framework and prebuilt firmware | https://github.com/espressif/esp-idf/tree/v5.4.2 |
| aiohttp | Local HTTP/WebSocket service | https://docs.aiohttp.org/ |
| pyserial | CH343 serial transport | https://pyserial.readthedocs.io/ |
| Vosk 0.3.45 | Optional local speech recognition | https://github.com/alphacep/vosk-api |
| vosk-model-small-en-us-0.15 | Optional English acoustic/language model | https://alphacephei.com/vosk/models |
| esptool 4.12.0 | Firmware backup and flashing | https://github.com/espressif/esptool/tree/v4.12.0 |

Python dependencies, Chromium, and the voice model are obtained by the installer/OS and are not vendored in this archive. Their respective licenses continue to apply. The official model listing identifies the selected English model as Apache-2.0. Its download helper records a SHA-256 fingerprint of the received archive; that file is a reproducibility record, not an independently signed authenticity certificate.

The included prebuilt firmware incorporates ESP-IDF and its linked components. Espressif's top-level Apache-2.0 license and upstream component license/notice files are included under `firmware/prebuilt/licenses/`, with source paths retained. That collection also contains notices for components not necessarily linked into this small application. Original upstream copyright and license text has been preserved. Full corresponding framework source is available at the versioned repository above; the VESPER firmware source and exact build configuration are included.

The optional browser test uses Playwright and an installed Chromium. Neither is required by the deployed web app. JavaScript in `web/` has no external runtime library dependencies. Fonts are local system fonts. No third-party game ROMs, sprite sheets, music recordings, or external image assets are used.
