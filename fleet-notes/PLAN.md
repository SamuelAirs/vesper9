# VESPER-9 0.3.0 — overnight fleet plan

Written 2026-09-30 by the coordinator (Claude Opus 5.5) for Sam. The fleet is Claude
Sonnet 5.5 agents. This file is the plan; `RULES.md` is what every agent must obey;
`STATUS.md` is the live log of what was launched, merged and deployed.

## 1. What Sam asked for

1. More games and more instruments.
2. Transcription that is more accurate than tonight's ("pretty well, a little inaccurate").
3. An answer to "how far off is voice control", and progress on it.
4. Agents hunting bugs and optimization paths.
5. Lights: the colours are wrong (positions are right), and the lamps are underused.
6. Temperatures in Fahrenheit (done tonight; a Calibration setting, default °F).

Constraints carried over from the project brief: local-only speech, no cloud or paid
services, no unrelated LLM, one button plus voice, no new hardware, microphone starts
muted and its state is always visible, user data is preserved, dictation never runs
commands.

## 2. Where things stand (verified on the Pi today)

- Node: firmware 0.1.1 built here. Button, sensor, microphone and all nine light
  outputs work. Protocol runs on both the native USB port and COM; reflashing over
  either port needs no button press. Colour legs within each lamp are still mis-mapped.
- Console: runs as the `vesper.service` user service at http://127.0.0.1:8799, 12 apps.
- Tests on this Pi: Python 29/29, JavaScript 33/33, C protocol frame, and the 12-app
  browser workflow (32 s with the system Chromium).
- Display is 1024 × 600. Only the dashboard has been fitted to it so far.
- Lights today: 22 static colour changes across all apps, no node-timed patterns, and
  nothing at all on the dashboard, menus, timers or microphone state.
- Voice commands already exist (see section 6). Dictation uses the small Vosk model.
- The project is now a local git repository (`v0.2.0-as-delivered` tag, then the
  bring-up commit). Nothing is pushed anywhere.

## 3. How the fleet is run

**Coordinator (Opus):** writes every brief, prepares shared infrastructure, is the only
one that touches the node, the service, user data and `main`, reviews and merges each
branch, reruns the whole suite after every merge, keeps `STATUS.md`.

**Agents (Sonnet 5.5):** one bounded brief each, each in its own git worktree and
branch, with named file ownership. Each must prove its work (tests it ran, numbers it
measured, screenshots it looked at) and leave a report in `fleet/reports/`.

**Guardrails**

- The live console keeps running the current build all night. Work is merged on `main`
  only after: Python tests, JavaScript tests, catalog check and the browser workflow
  pass, and the coordinator has read the diff.
- Agents never open a serial port, flash, restart or edit the service, use port 8799,
  touch `data/` or `backups/`, or install into the production `.venv`.
- After every agent returns, the coordinator checks real state (git status of `main`,
  service unit, node firmware string) rather than trusting the report.
- At most 4–5 agents at once (4 cores, 8 GB). Browser tests use auto-assigned ports and
  muted audio. The physical lamps stay dark overnight.
- Deployment at the end only if everything is green, after backing up `data/`.
  Rollback is one checkout plus a service restart, written in the morning report.

## 4. Phases

### Phase 0 — foundations (coordinator, before and just after Sam goes to bed)

| Step | What | Needs Sam |
| --- | --- | --- |
| 0.1 | Correct the colour map from Sam's nine observations; firmware 0.1.2 | yes |
| 0.2 | Two-minute voice sample through the node microphone, with consent, kept only in `data/` | yes |
| 0.3 | Git baseline (done) | no |
| 0.4 | Test tooling: shared Playwright (done), free-port allocation, muted audio, `scripts/dev-shot.cjs` to launch any app in an isolated simulator at 1024 × 600, script button input and save screenshots | no |
| 0.5 | Make cartridges single-file: per-app icon and record labels in the catalog, a reusable test context, a light-show helper; pre-register every new app as a stub so parallel branches never edit the same lines | no |
| 0.6 | `RULES.md` and the briefs | no |

### Phase 1 — audits and research (6 agents in parallel, about an hour)

| Agent | Scope | Output |
| --- | --- | --- |
| A1 host | `web/main.js`, `web/engine/*`: input router, lifecycle, light director, reconnect paths | ranked defects, each with a failing test or exact repro |
| A2 games | six games and Signal School: bugs, fairness, difficulty curves, feel | defects plus concrete tuning proposals |
| A3 service | `vesper/*.py`: concurrency, persistence, timers, speech worker, recovery | ranked defects with repro tests |
| A4 performance | per-frame cost, DOM churn in instruments, WebSocket chatter, Python CPU | measurements and the three cheapest wins |
| A5 screen fit | all 12 apps at 1024 × 600, every menu and result screen | annotated screenshots of anything clipped or cramped |
| A6 speech | candidate local recognizers against the current one on Sam's sample: word error rate, speed, memory, latency | recommendation and a working prototype |

Findings without evidence are labelled "unverified" and are not acted on until checked.
The coordinator triages the reports into a fix queue grouped by file ownership.

### Phase 2 — build (waves of up to five agents, 3–4 hours)

- **2A core fixes** — three agents by ownership: host and engine; games and Signal
  School; service. Only verified findings, each fix with a regression test.
- **2B light show** — a shared light-show layer (pulse, breathe, chase, meter, sparkle,
  colour ramps), host-level behaviour (dashboard idle glow, which item is focused, hold
  progress filling across the lamps, a clear "microphone is live" colour, timer alerts),
  a global brightness setting, then a pass over the six existing games and Signal
  School so the lamps carry real information in each.
- **2C six new games** — one agent each (section 5).
- **2D six new instruments** — one agent each (section 5).
- **2E voice** — command grammar expansion with confidence gating and feedback; then
  the dictation engine change A6 recommends, if it clearly wins.
- **2F layout** — the fixes A5 found, owning `style.css`.

Definition of done for an app: one file plus its test; playable start to finish with
one button; a seeded automated playthrough proving it can be both won and lost with no
NaN or unbounded growth; purposeful light and sound use that also works silent and
dark; score and field record saved; screenshots at 1024 × 600 that the agent has
actually looked at; no page errors.

### Phase 3 — integration and release (coordinator plus two agents, about 90 minutes)

- **3A cross-review:** every new app is play-tested and code-reviewed by a different
  agent than its author; fixes applied.
- **3B integration:** browser workflow, extension and soak tests updated for 24 apps;
  a 20–30 minute soak on the Pi.
- **3C documents:** operator guide, engine guide, release notes 0.3.0, validation with
  real Pi numbers, next steps; version bump; release zip.
- **3D deploy:** back up data, switch the live service, verify the real node through
  the service (sensor, microphone capture, light commands acknowledged, firmware
  string), leave the rollback command.
- **Morning report:** what is running, what changed, how each thing was verified, and
  the short list that needs Sam's eyes and hands.

## 5. Proposed slate

**Games — sector "PLAY II"**

| Name | One-button idea | What the lamps do |
| --- | --- | --- |
| PULSAR | Rhythm: beats run down three lanes to a strike line; tap on the beat, hold for long notes; generated music | The three lamps are the three lanes; hit quality flashes green, amber or red |
| PERIHELION | Hold to tether to the nearest anchor and swing, release to fly | Speed and altitude as colour; flash on each catch |
| DESCENT | Lander: hold to burn against gravity, set down softly on the pad with limited fuel | A real descent-rate indicator: green safe, amber fast, red too fast |
| RICOCHET | Breakout with a paddle that never stops; tap reverses it | Ball position left, middle, right; brick hits sparkle |
| HELIX | Snake: tap turns clockwise; collect fragments, grow, speed up | Which side the next fragment is on |
| BALLISTA | The aim sweeps by itself; hold to charge, release to launch at targets through wind | A power meter filling across the three lamps |

Alternates if the night goes well: ASCENT (wall-jump climber), STRATA (stacker).

**Instruments — sector "INSTRUMENTS II"**

| Name | What it is | Service work needed |
| --- | --- | --- |
| LANTERN | The lamps as a lamp: colours, brightness, scenes (breathe, aurora, candle, sunrise), night-light with auto-off | none |
| CADENCE | Metronome with tap tempo, stopwatch with laps, work/rest interval trainer | none |
| EPHEMERIS | Offline astronomy: clock, moon phase, sunrise and sunset for your location, a small orrery | none |
| RESONANCE | Sound scope: level meter, spectrum, loudness history, tuner | a new explicit "analyze" microphone mode (no recognition, nothing stored) |
| ORACLE | Dice, coin, random pick, yes/no, with the lamps "rolling" | none |
| TELEMETRY | Pi and node health: CPU temperature and load, memory, disk, throttling, link and firmware details, frame time | a small read-only system endpoint |

Alternates: RESPIRE (breathing pacer), BEACON (flash any message in Morse), MANIFEST
(voice checklist), TALLY (counters).

**Existing apps:** Atmosphere gains dew point, feels-like, min/max and 7/30-day views;
Node Scope shows link type, firmware and sensor diagnostics; Calibration gains light
brightness.

## 6. Voice control: where it is and where it goes

It already exists. Choose VOICE COMMANDS in the microphone menu, then say one of:
`computer home`, `computer pause` / `computer menu`, `computer resume`,
`computer microphone off`, `computer open <orbit | runner | drift | echo | lights |
glyphs | morse | timer | notes | environment | diagnostics | settings>`,
`computer timer <one | five | fifteen | twenty five> minute(s)`.
Recognition is restricted to exactly these phrases, which is why it is far more
reliable than free dictation.

Tonight's work (2E): navigation by voice (next, select, back, next sector), timers of
any length plus cancel, start/stop notes, lamp colours, spoken-number settings, simple
queries answered on screen (time, temperature), rejection of low-confidence matches,
and a visible/audible acknowledgement. Not planned: voice as a game input (the
half-second recognition delay makes it unplayable) and anything involving a language
model.

Dictation accuracy (A6 then 2E): candidates are microphone level normalization, larger
Vosk models, and a second, more accurate recognizer that re-transcribes each finished
sentence while Vosk keeps providing the live text. The decision is made on measured
error rate, speed and memory on this Pi with Sam's own voice through the node's
microphone, not on published numbers.

## 7. Risks

- **Parallel edits colliding.** Mitigated by worktrees, file ownership and
  pre-registered stubs; the coordinator resolves what remains.
- **Agents overstating results.** Evidence is required, cross-review is by a different
  agent, and the coordinator reruns everything itself.
- **A bad build on the live console.** Nothing is deployed unless green; data is backed
  up; rollback is documented.
- **Speech models too slow for the Pi.** Measured before integration; the current
  recognizer stays as the fallback.
- **Things only a person can judge** (fun, comfort, how the lamps look, microphone
  acoustics) stay explicitly unverified and go on the morning list.
