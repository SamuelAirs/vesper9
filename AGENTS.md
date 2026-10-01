# VESPER-9 0.2.0 project instructions

This is Sam's Raspberry Pi 5 console, with an already-wired ESP32-S3 node.
The second implementation pass is present in this source. Start with
`docs/RELEASE-NOTES.md`, `docs/VALIDATION.md`, `docs/NEXT-STEPS.md`, and the
current source. If supplied, `../CLAUDE-START-PROMPT.txt` directs the on-Pi
continuation. Earlier `../handoff/` briefs describe the 0.1.0 review; do not
mistake their proposed work for the current implementation status.

## Product direction

Preserve the retro/alien field-instrument identity and the one-button/voice
interface. Keyboard and mouse are useful fallbacks. No additional hardware,
cloud speech, paid services, or unrelated home-AI integration is assumed.

Four quick game clicks are the default menu gesture, with a triple-click
option and timing presets. Normal long game holds must remain available.
Morse and Echo use an explicit three-second hold to protect valid repeated
short presses. Menu navigation remains short-release next, hold-release
select. Do not add a universal hold that silently interrupts Undertow.

## Architecture and contracts

`web/` is the JS engine and apps; `vesper/` owns local services/persistence;
`firmware/` is ESP-IDF C. Protocol v1 is unchanged. Node firmware 0.1.2 (2026-09-30) corrects the pin map to the board as wired (see `docs/HARDWARE.md`; the map in `../CLAUDE-START-PROMPT.txt` is wrong), adds the native-USB link and microphone DC filtering.
`vesper/catalog.json` owns app metadata/defaults/voice aliases. Generate the
browser copy with `python3 scripts/build-catalog.py`; don't hand-edit it.
Factories are trusted JS code in `web/apps/registry.js`.

Preserve immediate source-owned edges, consumed terminal releases, node
connection generations, same-clock reaction differences, bounded audio,
independent RGB channels, background timers and explicit microphone modes.
Use the light director and app context; don't bypass lifetime or light
ownership rules. Apps are not a sandbox for arbitrary downloaded code.

## Work and verification

Proceed through authorized reversible work; preserve newer source changes,
app data and existing service configuration. Inspect this machine rather
than treating development-host tests as Pi measurements. Keep one
controlling browser tab and a loopback-only service. Startup/capture errors
must not silently enable the microphone. Dictation executes no commands.

Before replacing node firmware, identify the target and preserve a verified
full 16 MB backup with a restore command. This release retains the compatible
0.1.0 firmware; application updates do not inherently require flashing.
A blocked physical check does not block independent software work.

Record decisions, measurements and remaining work in `docs/WORKLOG.md`.
Run relevant focused regressions and integration checks. Rebuild the demo
and catalog after web/metadata changes. Rebuild firmware and hashes only
when its source/configuration changes. Package with
`scripts/package-release.py`; omit local transcripts, recordings, databases,
models, dependencies, flash backups, caches and machine secrets.

Keep evidence honest. The actual Pi/node has not been tested in the remote
development environment. Complete available work before asking for a
specific inaccessible physical observation or required permission.
