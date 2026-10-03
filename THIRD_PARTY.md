# Dependencies and notices

Original VESPER source, procedural artwork, documentation, and synthesized-sound definitions use the MIT license in `LICENSE`.

| Dependency | Use | Upstream |
| --- | --- | --- |
| ESP-IDF v5.4.2 | ESP32-S3 framework and prebuilt firmware | https://github.com/espressif/esp-idf/tree/v5.4.2 |
| aiohttp | Local HTTP/WebSocket service | https://docs.aiohttp.org/ |
| pyserial | CH343 serial transport | https://pyserial.readthedocs.io/ |
| Vosk 0.3.45 | Optional local speech recognition | https://github.com/alphacep/vosk-api |
| vosk-model-small-en-us-0.15 | Optional English acoustic/language model | https://alphacephei.com/vosk/models |
| sherpa-onnx 1.13.8 | Optional runtime for the second-pass dictation model (Apache-2.0) | https://github.com/k2-fsa/sherpa-onnx |
| NumPy 2.5.3 | Optional, audio arrays for the second pass (BSD-3-Clause) | https://numpy.org/ |
| sherpa-onnx-nemo-parakeet_tdt_transducer_110m-en-36000-int8 | Optional second-pass dictation model: NVIDIA Parakeet TDT 110m in sherpa-onnx's int8 export (CC-BY-4.0) | https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models |
| esptool 4.12.0 | Firmware backup and flashing | https://github.com/espressif/esptool/tree/v4.12.0 |

Python dependencies, Chromium, and the voice model are obtained by the installer/OS and are not vendored in this archive. Their respective licenses continue to apply. The official model listing identifies the selected English model as Apache-2.0. Its download helper records a SHA-256 fingerprint of the received archive; that file is a reproducibility record, not an independently signed authenticity certificate.

The optional second-pass dictation model is NVIDIA's Parakeet TDT 110m (`nvidia/parakeet-tdt_ctc-110m`) as exported to int8 ONNX by the sherpa-onnx project. It is licensed under Creative Commons Attribution 4.0 International (CC-BY-4.0; https://creativecommons.org/licenses/by/4.0/), which requires this attribution: *Parakeet TDT 110m, copyright NVIDIA Corporation, used here as an unmodified int8 ONNX export published by k2-fsa/sherpa-onnx; the model weights are not changed by VESPER-9.* Its archive is downloaded by `scripts/get-voice-model.py` only after its SHA-256 matches the pinned value `f628312e9fdf8686374cb01a69425c41732529d540860311f16f37cbc32cfe9b`. The model is not vendored in this archive. Audio is processed in memory only and is never stored.

The included prebuilt firmware incorporates ESP-IDF and its linked components. Espressif's top-level Apache-2.0 license and upstream component license/notice files are included under `firmware/prebuilt/licenses/`, with source paths retained. That collection also contains notices for components not necessarily linked into this small application. Original upstream copyright and license text has been preserved. Full corresponding framework source is available at the versioned repository above; the VESPER firmware source and exact build configuration are included.

The optional browser test uses Playwright and an installed Chromium. Neither is required by the deployed web app. JavaScript in `web/` has no external runtime library dependencies. Fonts are local system fonts. No third-party game ROMs, sprite sheets, music recordings, or external image assets are used.

## Bundled books

`books/` holds text-only EPUBs of fifteen Standard Ebooks editions (https://standardebooks.org): public-domain texts, with the Standard Ebooks production dedicated to the public domain under CC0 1.0. See `books/README.md`.

## Encyclopedia

The Encyclopedia reads Kiwix ZIM files with `libzim` (python-libzim, GPL-3.0; https://github.com/openzim/python-libzim), an optional extra installed on the console, not bundled. No Wikipedia content ships with VESPER-9: `scripts/get-encyclopedia.py` downloads it on the console from https://download.kiwix.org. Wikipedia text is available under the Creative Commons Attribution-ShareAlike licence (https://en.wikipedia.org/wiki/Wikipedia:Copyrights); the app names the source on its home screen.
