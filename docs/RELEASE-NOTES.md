# VESPER-9 0.2.0 — the second pass

This release implements the next pass in source, rather than only supplying an improvement prompt. The app and service are 0.2.0. The compatible ESP32 protocol and supplied 0.1.0 firmware are unchanged. No physical Pi/node deployment is claimed.

## Controls and engine

- Four quick clicks open the game menu by default. Calibration offers three clicks, legacy hold, and three timing presets. Long game holds remain available in the default profile.
- Signal School and Echo Vault reserve a three-second hold because repeated short presses are valid answers. Dashboard/utility menus retain hold-to-select and a three-second system-menu hold. The actual rule is shown in the control deck.
- Raw game edges remain immediate. Earlier clicks and the final down may already affect play before a multi-click escape is recognized. Identical button streams cannot reveal intent; the app-specific policy addresses the most obvious collisions.
- A shared light director serializes effects and cleanup, invalidates cached values after ownership/reconnect changes, and prevents an old ACK from certifying a newer state.
- App-context actions are lifetime guarded. Cleanup exceptions are contained. Reported button state unblocks an idle reconnect; presses held across a reset remain suppressed until release.
- A single JSON cartridge catalog feeds generated frontend metadata, backend IDs, defaults, escape policies and voice aliases. The Pulse Garden example was exercised as an added cartridge in both hosts.
- A compact appliance layout keeps status and the switch visible; the full game view, including the control deck, fits the tested 1280×720 viewport.

## Activities

| App | Implemented improvement |
| --- | --- |
| Signal School | Guided keying, listening/visual recognition with scanned answers and replay, and adaptive review of due/weak characters. Ten-answer sessions, immediate persisted progress, migration of original totals. |
| Orbit Lock | Sector milestones, early/late miss feedback, a bounded gate/speed progression. |
| Moonrunner | Three recognizable obstacle profiles and more recovery space between them; jump reachability tested with the actual physics. |
| Undertow | Bounded successive gate movement, a gentler minimum opening, and specific limit/contact feedback. |
| Echo Vault | Response progress, expected-symbol failure feedback, replay from the menu, and protected repeated-tap answers. |
| Light Trial | Separate physical/keyboard/simulator scores and recent samples, median/mean, connection generation checks, and labelled legacy records. |
| Glyph Archive | Four scan-speed presets, frame-step-stable scanning, and scores classified by scan speed. |
| Chronometer | Button-operated HH:MM:SS wizard, meaningful preset labels, six saved custom presets, stable timer action identity. |
| Field Notes | Older-session paging, selected-note reading/export, text pages, live/final state and capture errors. No automatic deletion. |
| Atmosphere | Observation age and stale/disconnected labels; chart endpoint time reflects the actual last sample. |
| Node Scope | Connection/button/capture state, frame-time samples, speech drops, and a diagnostic export that excludes transcript text. |
| Calibration | Menu profiles, click timing, scan speed, and a settings-only reset that preserves notes and progress. |

Game field records persist a last result and milestones. Read them in the game's system menu. They are compact summaries, not full save states for an interrupted run.

## Service and upgrade work

The speech worker now fails visibly, ends acquisition/sessions through an independent error callback, and supports an intentional retry. Final-result errors cannot prevent mute. Dictation remains separate from commands; “computer menu” is now an explicit command alias. The real recorded-audio path was rerun with Vosk.

Existing SQLite data is retained. Legacy reaction scores stay stored but are not mixed with new classified results. Firmware flashing is not required merely to update an already compatible VESPER installation. The service installer backs up previous configuration and accepts `--data` to retain an existing data directory, and restarts an already-running service onto the new checkout.

See [VALIDATION.md](VALIDATION.md) for measured development-host evidence and [NEXT-STEPS.md](NEXT-STEPS.md) for hardware qualification and remaining design work.

## Claude handoff edition

The Claude transfer bundle adds root/project `CLAUDE.md` entry points and
`CLAUDE-START-PROMPT.txt`, updates the starting instructions, and preserves
those files when packaging future releases. Runtime code and firmware are
unchanged from tested 0.2.0. The original 62 regression results and integrated
run remain applicable to that implementation; this repack adds no hardware
validation claim.
