# Continue on the actual Pi

The largest remaining uncertainty is the physical appliance. The source, simulator and automated tests have improved; actual Pi performance, four-click comfort, microphone gain/acoustics and the as-wired ESP32 remain unqualified in this environment.

## First local pass

1. Read `AGENTS.md`, `RELEASE-NOTES.md`, `VALIDATION.md`, and the installation/hardware guides. Inspect any newer local work before selecting a code base.
2. Identify the Pi OS, RAM, display/scaling, audio output and COM serial path. Preserve current code, service files, data and working firmware.
3. If the node already runs compatible VESPER protocol v1 firmware, connect and qualify it without a needless reflash. Otherwise verify the exact board, obtain a full 16 MB backup and use the existing flash/restore workflow.
4. Exercise all nine LED legs, sensor freshness, button edges, sustained holds, rapid-click profiles and idle/held reconnect cases. Test with microphone off first.
5. Try guided/listening/review lessons and ordinary play. Tune the existing timing presets if physical evidence supports a change; record the chosen values and accidental menu-trigger tradeoffs.
6. Test local speech explicitly, end muted, and measure frame/speech latency under the Pi's real cooling and power conditions. Compare a local model alternative only if the current one is inadequate.
7. Install/update the project user service with the correct existing data path; test restart and rollback. Do not enable OS autologin as an incidental change.

## Honest design limits

- Tap, tap, hold can still be typed by accident in a game played with rapid taps followed by a held press (Pulsar's long signals after two eighth notes); the hold only counts after exactly two quick taps and the game then puts back what the gesture changed. The thresholds (taps up to 150 ms, pauses up to 220 ms, hold 1000 ms at the standard pace) are a best guess and need human testing on the real button. Software tests establish state behavior, not comfort.
- The new review scheduler uses per-character attempt counts and streaks. It is not a calendar-based spaced-repetition curriculum or an educationally validated course. Word/digit lessons and free-key mode remain useful future additions.
- Game progression is deeper but still compact. Physics checks validate representative obstacle profiles and seeded flight, not every conceivable run or every player's ability. Human play-testing should guide further difficulty changes.
- Reaction numbers use the node clock for physical trials. Electrical/PWM/optical onset and debounce have not been calibrated; keyboard measurements remain approximate.
- Timers intentionally follow wall-clock deadlines, including forward/backward clock corrections. They recover after restart; no powered-off alert is possible.
- Notes page by session and line. A single extremely long dictated paragraph can still need normal panel scrolling. No search, editing, arbitrary text labels, or automatic retention deletion has been added.
- Decorated rendering and speech share Pi resources. Diagnostic frame times are useful, but the development host's headless numbers are not a Pi benchmark.
- There is no general-purpose plugin sandbox, ROM emulator, campaign editor, network multiplayer, or arbitrary game save state. Add these only for a concrete cartridge need.

The earlier handoff remains historical design context. Do not repeat already completed work simply because a historical brief still says “implement.” Record new findings and decisions in `WORKLOG.md`.
