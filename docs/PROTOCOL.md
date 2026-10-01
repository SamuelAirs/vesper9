# VESPER node protocol v1

Transport: CH343 COM UART, **921600 baud, 8N1, no hardware flow control** (UART0, TX43/RX44), and from node firmware 0.1.1 also the native USB port (USB Serial/JTAG, baud setting irrelevant). Frames are identical on both. The node replies on whichever link last delivered a valid host frame; with no live host it sends HELLO/STATUS on both. UART boot noise is tolerated; application text logging on the binary UART is disabled.

## Frame

All integer and floating-point fields are little-endian. `f32` is IEEE-754 binary32.

| Offset | Size | Meaning |
| --- | ---: | --- |
| 0 | 2 | Magic bytes `0x56 0x39` (`V9`) |
| 2 | 1 | Version, `1` |
| 3 | 1 | Message type |
| 4 | 2 | Sender's sequence number, wraps at 65536 |
| 6 | 2 | Payload byte count, at most 768 |
| 8 | N | Payload |
| 8 + N | 2 | CRC-16/CCITT-FALSE, stored little-endian |

CRC: polynomial `0x1021`, initial `0xFFFF`, no reflection, no final XOR. It covers version through the final payload byte, excluding magic and the CRC itself. Test vector: ASCII `123456789` → `0x29B1`. Frames occupy N + 10 bytes.

Decoders retain partial frames, reject invalid versions/lengths/CRC, and resynchronize at magic. The node discards an unfinished host frame after 200 ms without another byte. Each endpoint sequences its own outbound messages; an ACK references the original command's sequence.

## Node → Pi

| Type | Value | Payload |
| --- | ---: | --- |
| HELLO | 1 | UTF-8 JSON status at startup |
| BUTTON | 2 | `u64 at_us, u8 pressed` |
| SENSOR | 3 | `u64 at_us, f32 temperature_c, f32 relative_humidity` |
| AUDIO | 4 | `u32 first_sample_index`, followed by signed 16-bit PCM samples |
| CUE | 5 | `u32 trial_id, u64 activated_at_us` |
| STATUS | 6 | UTF-8 JSON status, about once/s and in response to PING |
| ACK | 7 | `u16 command_sequence, u8 result, u8 command_type` |
| KNOCK | 8 | `u64 at_us, u16 peak, u8 hf` (firmware 0.1.3 and later; the first 0.1.3 build sent 10 bytes, without `hf`) |

Status fields: `fw`, `link` (`uart`, `usb` or `none`), `mic` (actual capture active, meaning audio is being streamed; listening for knocks alone is not capture), `button`, `audio_drops`, `rx_crc`, `sensor` (`addr`, `ok`, `fail`, last `err`), `leds` (nine current brightness values) and, from firmware 0.1.3, `knock`: `thr` (the threshold in use, 0 = not listening), `n` (knocks sent), `btn` (knocks dropped because a button edge was within 60 ms), `long` (sounds that started sharply but lasted, so were not knocks), `bright` (rejected as too bright, see below), and `peak` and `hf` of the latest of these. The Pi enriches browser diagnostics with its own CRC errors, observed missing audio samples, and audio byte totals.

BUTTON uses an 8 ms debounce window and timestamps the initial edge that became stable. A button held at boot is inhibited until released. CUE is timestamped immediately after the light-update call. Both timestamps use the same ESP32 monotonic clock; no USB transit-time subtraction is required for physical button reaction trials. Debounce, GPIO polling, PWM phase, and real LED response still contribute measurement uncertainty.

Audio is **16 kHz, mono, signed 16-bit little-endian**, normally 320 samples per packet (20 ms). Sample indices count transmitted source samples modulo 2³² and expose dropped chunks. The INMP441 supplies 24-bit data in the left slot of a 32-bit stereo I²S frame; firmware clocks both slots, discards the right slot, and shifts the left sample down to 16 bits. No audio packets are sent while acquisition is disabled.

KNOCK is a sharp knock on the case, found by the node in its own microphone signal (`firmware/main/knock.h`, tested by `firmware/host-test/knock_test.c`). While KNOCK_SET holds a non-zero threshold, the node runs the microphone continuously whether or not the host has asked for audio, and only KNOCK events leave it; nothing about the sound is sent. A knock is a 1 ms block whose peak reaches the threshold and at least 8 times the background level, whose sound has died away by 40 to 90 ms later to 20 % of the level of the first 10 ms, or 40 % if the onset clipped (speech, a whistle or a tone from the speaker do not), at least 150 ms after the previous one, and not within 60 ms of any button edge, press, release or bounce (the switch itself clicks). `at_us` is the onset on the same clock as BUTTON and CUE, estimated from the end of the 20 ms microphone buffer that held it; `peak` is the highest 1 ms peak of the first 10 ms (16-bit sample units, as streamed audio). `hf` (0 … 255) is the brightness of those 10 ms: the mean sample-to-sample change as a percentage of the mean level, about 35 for a 900 Hz ring and about 130 for broadband noise such as a clap. A limit on it (`KNOCK_MAX_HF`) is in place but not yet set. The event is sent about 90 ms after the onset. Measured on the real case (PR #4): light taps peak around 8000 and below, firm ones clip, a quiet room peaks near 2300; `hf` for taps is 48 to 126, so it does not separate claps, which count as taps by choice.

ACK result `0` means accepted, `1` invalid payload, `2` unknown command. Acceptance of MIC means the request was accepted; the service also waits for `STATUS.mic` before showing successful capture startup.

## Pi → node

| Type | Value | Payload and effect |
| --- | ---: | --- |
| PING | 16 | Empty; returns STATUS rather than ACK |
| LEDS | 17 | Nine `u8`: L.R, L.G, L.B, M.R, M.G, M.B, R.R, R.G, R.B |
| MIC | 18 | One `u8`: `0` stops capture, `1` starts |
| ARM | 19 | `u32 trial_id, u32 delay_ms, u8 light_index, u8 r, u8 g, u8 b` |
| CANCEL | 20 | Empty; cancels scheduled reaction and pattern |
| PATTERN | 21 | `u8 repeat, u8 step_count`, then steps of `u16 ms` + nine `u8` light values |
| KNOCK_SET | 22 | `u16 threshold`: `0` stops knock detection, `256` … `32767` sets the peak a knock must reach (firmware 0.1.3 and later) |

ARM delay: 250–10000 ms; light index 0–2. ARM cancels a running pattern. A cue clears all lights and activates the chosen light, then emits CUE. LEDS cancels a pattern but does not cancel an armed reaction; CANCEL explicitly does so.

PATTERN: 1–16 steps, duration 10–10000 ms per step, repeat 1–8. It cancels an armed reaction and starts immediately. Lights turn off after the final repeat. CANCEL cancels scheduling but does not itself change LED values; the host sends lights-off when exiting an app.

KNOCK_SET starts at 0 after boot. The service sends it after connecting, and again whenever a STATUS reports a different `thr` (the node also returns it to 0 after losing the host), so the setting survives resets and link loss. Firmware older than 0.1.3 answers KNOCK_SET with ACK result `2` and its STATUS has no `knock`; the service sends nothing further to it. The thresholds for the `knock` setting are `low` 8000, `medium` 4000 (about −18 dBFS) and `high` 3000; `off` sends 0.

The Pi sends PING every second. With no valid host frame for three seconds, the node disables acquisition and knock detection, clears audio scheduling, cancels cues/patterns, and turns off the lights. The Pi declares a stale node link after four seconds and reconnects. Real-time button/control packets have priority over bounded audio queues.

## Bandwidth budget

PCM payload alone is 32000 bytes/s. At 50 packets/s, headers/indices add approximately 700 bytes/s. A 921600 8N1 UART has a theoretical ceiling of 92160 bytes/s in each direction, leaving headroom for sensor/status/control packets and USB scheduling. This is a design budget, not a measured throughput guarantee for the user's cable and board.

## Browser/service messages

The browser uses JSON over `/ws`. A command includes `command`, its payload fields, and optional **`requestId`**. Replies use `{type: "reply", id: requestId, ok: true, data: ...}` or `ok: false, error: ...`. Timer identifiers use their separate `id` field. Fire-and-forget commands omit `requestId`; validation errors are still reported.

Example:

```json
{"requestId":27,"command":"timer","op":"toggle","id":"f93bc72a60a1"}
```

Supported command names: `leds`, `pattern`, `reaction`, `cancel`, `button` (simulation only), `knock` (simulation only: a knock with peak 20000, unless the `knock` setting is `off`), `mic`, `timer`, `score`, `progress`, `settings`, `reset_settings`, `focus`, `keepalive`. There is no shell command or arbitrary file-write operation.

Every command is type-checked: a field of the wrong type (a boolean or a numeric string where an integer is required, a non-finite number, a list where text is required) is refused, never coerced. Any failure of a command, including a node write timeout or a database error, is answered with `ok: false` and an `error` text, and the WebSocket session stays open. A command from a tab that is not the controller is answered with `ok: false`.

`/api/state`, `/api/system`, `/api/history`, `/api/sessions`, `/api/transcript/{session}`, and `/api/export/{session}` provide local reads. The first WebSocket tab is the controller; additional tabs monitor events. The controller slot is released as soon as the controlling tab leaves for any reason (close, reload, crash, a connection that stops accepting data, a failed handshake), and the next tab to connect takes it; that tab's first command waits (up to 5 s) for the previous controller's cleanup (microphone off, lamps off) to finish. Cross-origin requests and unexpected Host headers are rejected. Every response carries `Cache-Control: no-cache` so the browser revalidates the user interface after the console is updated in place.

`{"type":"knock","at_us":N,"peak":P,"source":"node"|"simulator","generation":G}` is broadcast for every KNOCK. The `knock` setting (`off`, `low`, `medium`, `high`; default `medium`) chooses the node's threshold.

### Microphone modes

`{"command":"mic","mode":M}` with `M` one of:

| Mode | Effect |
| --- | --- |
| `off` | Capture stopped. Also the state at every start, after any failure, and after the controlling tab leaves. |
| `commands` | Voice commands (needs the speech extra and model). |
| `transcribe` | Dictation into a stored field-notes session (needs the speech extra and model). |
| `analyze` | Level, spectrum and pitch only. No speech model is needed. Nothing is recognised, no session or text is stored, no audio is kept beyond a 64 ms working window and none leaves the service. |

All modes follow the same rules. Only the controlling tab can request one, and any other mode name or type is refused (`ok: false`). The mode in `state.mic.mode` and in the `mic` event changes only once the node has confirmed capture (`state.device.capture`); a request that is not confirmed within 2.5 s fails, and capture is switched off again. Leaving a mode (a request for `off` or another mode) stops acquisition first. Any failure ends capture: a node disconnect or reset, a lost controlling tab, an error in the worker, and, in `analyze`, a computation error or three seconds without audio (reported as an `analysis_error` event and in `state.mic.error` until the next explicit request). A request for `off` while the console already says off still mutes a node that reports capture, and the service re-sends the mute by itself if the node reports capture while the console says off.

`state.mic` carries `mode`, `level`, `session`, `unavailable` (the speech-extra problem, if any; irrelevant to `analyze`), `error`, `modes` (the accepted names) and `analysis`, the constants of the analyzer: `{"rate": 16000, "bands": 28, "edgesHz": [29 band edges, 60 … 7000], "intervalMs": 100}`. Band `i` spans `edgesHz[i]` to `edgesHz[i+1]` Hz; the edges are logarithmically spaced.

`state.mic.recognizer` is `{"engine": "vosk" | "vosk+parakeet", "refine": "unavailable" | "idle" | "loading" | "ready" | "failed", "detail": text | null}`: which recognisers dictation uses. `unavailable` means the optional second pass is not installed (`detail` says what is missing), `idle` that it is installed and loads when transcription starts, `loading` that it is loading in the background (dictation already works with Vosk), `ready` that it is loaded, and `failed` that it could not load or failed repeatedly (`detail` has the reason; dictation continues with Vosk alone). Every change is also broadcast as `{"type":"recognizer","engine":…,"refine":…,"detail":…}`.

#### `speech` event (modes `transcribe`)

`{"type":"speech","text":T,"final":false,"mode":"transcribe"}` is Vosk's live partial text. A finished utterance depends on the recognisers:

- With the second pass, Vosk's final text is announced as `{"type":"speech","text":T,"final":false,"provisional":true,"utt":N,"mode":"transcribe"}` and stays provisional (shown, not stored). The final line follows, usually within about half a second, as `{"type":"speech","text":T2,"final":true,"utt":N,"engine":"second-pass"|"vosk","mode":"transcribe","session":S}` with the same `utt`. `engine` is `vosk` when the second pass failed, timed out, returned nothing or was skipped because it was behind, and the text is then Vosk's own. A final with empty text clears the provisional line. Finals arrive in `utt` order, one per utterance.
- Without it: only `{"type":"speech","text":T,"final":true,"engine":"vosk","mode":"transcribe","session":S}` (no `utt`, nothing provisional), as before.

Only `final: true` events are saved to the notes database, once each, in the session that is open when the final is produced. Stopping dictation or switching mode first finishes every open utterance (a pending second pass is awaited for at most 15 s, then Vosk's text is used) and so saves the last words before the session ends. Utterance audio is held in memory only until its line is final, cut at a pause after about 20 s and never longer than 30 s; no audio is written to disk.

#### `voice` event (mode `commands`)

`{"type":"voice","heard":"computer timer five minutes","action":"timer","seconds":300,"confidence":0.97,"result":"TIMER STARTED / 05:00"}` is broadcast when the grammar-constrained recogniser finishes an utterance that is exactly one phrase of the grammar (`vesper/commands.py`) and its least certain word scored at least `COMMAND_MIN_CONF` (`vesper/speech.py`). Anything else is dropped. `heard` is the phrase; `confidence` the lowest word confidence (0 to 1); the remaining fields depend on `action`:

| `action` | Fields | Done by |
| --- | --- | --- |
| `next`, `previous`, `select`, `sector`, `home`, `pause`, `resume` | none | the host: `advance`, a step back, `select`, the dashboard's sector button, `home`, `systemMenu`, `closeMenu` |
| `launch` | `app` (catalog id) | the host: `launch` |
| `timer` | `seconds` (5 to 7200) | the service creates it (`timer_command`) and broadcasts `timers`; `result` says `TIMER STARTED / mm:ss` |
| `timer_cancel`, `timer_pause`, `timer_resume` | none | the host, on the most recently created timer, with the `timer` command (`remove`, `toggle`) |
| `dictation_start`, `dictation_stop` | none | the host: `mic transcribe` then open Field Notes; `dictation_stop` is only heard while dictation is off and only explains that |
| `lamps` (`to`: `up`, `down`, `off`, `on`), `sound` (`to`: `on`, `off`), `volume` (`to`: `up`, `down`) | `to` | the host, with the `settings` command (`lampLevel`, `sound`, `volume`) |
| `ask` | `about`: `time`, `temperature`, `humidity`, `timers` | the host: a toast and, if it owns the lamps, a 2.5 s lamp pattern |
| `mute` | none | the service switches the microphone off; `result` is `MICROPHONE OFF` |

Voice events within 0.7 s of the previous one are dropped. Only the controlling tab changes settings and timers; any tab shows the toast. Nothing is recognised as a command in `transcribe` mode, whatever is said.

In `--simulate` mode there is no node microphone. In `analyze` the service generates its own clearly synthetic signal (a tone sweeping slowly between 110 and 700 Hz and back, 24 s per round trip, at about -23 dBFS RMS over faint noise); `analysis` events then carry `"simulated": true`. Audio frames sent by the browser are ignored while in `analyze`, so a front end need not start the browser microphone for it.

#### `analysis` event (mode `analyze` only, about ten per second)

```json
{"type":"analysis","at":1790830482.28,"seq":0,"rmsDb":-23.0,"peakDb":-20.0,
 "bands":[-92.6,-100.2,…,-93.3],"pitch":{"hz":690.4,"confidence":0.97},"simulated":true}
```

| Field | Meaning |
| --- | --- |
| `at` | Unix time the event was produced. |
| `seq` | Counts frames since capture started (starts at 0). Gaps mean frames were skipped because analysis was running behind. |
| `rmsDb`, `peakDb` | RMS and peak sample level of the audio since the previous frame, in dBFS (0 = full-scale 16-bit; a full-scale sine has RMS -3.0). Floor -120. `peakDb >= rmsDb`. |
| `bands` | 28 numbers, one per band (lowest first), in dB: mean power per spectrum bin inside the band of a 64 ms Hann-windowed frame (1024 samples, 15.6 Hz per bin), where a full-scale sine centred on a bin reads 0 dB. Range -120 … 0. A flat noise floor therefore reads flat. |
| `pitch` | `{"hz": fundamental in Hz (60 … 800), "confidence": 0 … 1}` from normalised autocorrelation, or `null` when there is no clear pitch (confidence below 0.6, or RMS below -60 dBFS). Accurate to about 1.5 %. |
| `simulated` | `true` when the signal is the simulator's synthetic one. |

The ordinary `level` event (`{"type":"level","value":rms 0…1,"droppedChunks":n}`) continues in every capture mode. `{"type":"analysis_error","error":text}` is broadcast when analysis fails; the mode then returns to `off`.

#### `keepalive`

`{"command":"keepalive"}` from the controlling tab is a no-op that answers `ok: true`. It is optional. Once a controlling tab has sent one, the service treats 20 s without any message from that tab, while a microphone mode is active, as a hung browser (a frozen renderer still answers network-level pings) and switches the microphone off, broadcasting `{"type":"error","error":…}`. A front end that wants this protection sends `keepalive` (without `requestId`) every 5 s. Tabs that never send it are not affected.

### System health: `GET /api/system`

Read-only JSON for instruments such as TELEMETRY. It is cheap enough to poll about once a second: host files are read off the event loop and `vcgencmd get_throttled` (if installed, with a 1 s timeout) at most every 5 s. Every field is present in every reply; a value the host cannot supply is `null`, and the reply is strict JSON (never `NaN`). The request must satisfy the same Host/Origin rules as every other route.

```json
{"schema":1,"at":1790830472.053,"simulated":true,
 "host":{"model":"Raspberry Pi 5 Model B Rev 1.1","cpuTempC":82.6,"loadAvg":[14.28,15.47,14.02],"cpuCount":4,
   "cpuPercent":81.0,"cpuPerCore":[85.3,57.4,94.2,87.0],"cpuWindowS":1.03,
   "memory":{"totalBytes":8337108992,"availableBytes":6420631552},
   "disk":{"totalBytes":4168556544,"freeBytes":4164759552},"uptimeS":3961.6,
   "throttled":{"raw":"0xe0000","underVoltageNow":false,"freqCappedNow":false,"throttledNow":false,"softTempLimitNow":false,
     "underVoltageOccurred":false,"freqCappedOccurred":true,"throttledOccurred":true,"softTempLimitOccurred":true}},
 "service":{"version":"0.2.0","startedAt":1790830471.0,"uptimeS":1.1,"rssBytes":42000384,"pid":86938,"python":"3.13.5",
   "tasks":{"device":true,"timers":true},"clients":0,"micMode":"off"},
 "node":{"connected":true,"simulated":true,"port":"simulated","link":"simulated","firmware":"simulated","statusAgeS":1.1,
   "capture":false,"generation":1,"crcErrors":0,"missingSamples":0,"audioBytes":0,"nodeRxCrc":null,"audioDrops":null,
   "sensor":{"simulated":true,"ok":1,"fail":0,"err":null}}}
```

| Field | Meaning |
| --- | --- |
| `schema` | Payload version, currently `1`. `at` is the Unix time of the reply. |
| `simulated` | `true` when the service runs with `--simulate`. Host and service values are then still real; only the node block is simulated. |
| `host.model` | Board model from the device tree. |
| `host.cpuTempC` | SoC temperature in degrees C (`/sys/class/thermal`, else `vcgencmd`). |
| `host.loadAvg` | 1, 5 and 15 minute load averages. |
| `host.cpuCount` | Logical CPUs. |
| `host.cpuPercent`, `cpuPerCore` | Utilisation (0 … 100) overall and per core, since the previous call. `cpuWindowS` is the length of that window in seconds. The first call after the service starts covers the time since it started. Calls less than 0.5 s apart return the same window. |
| `host.memory` | `totalBytes` and `availableBytes` (`MemAvailable`). |
| `host.disk` | `totalBytes` and `freeBytes` of the filesystem that holds the data directory. |
| `host.uptimeS` | Host uptime in seconds. |
| `host.throttled` | Raspberry Pi power and thermal flags from `vcgencmd get_throttled`: the hexadecimal word in `raw` and the booleans `underVoltage`, `freqCapped`, `throttled`, `softTempLimit`, each as `...Now` and `...Occurred` (since boot). `null` without `vcgencmd`. |
| `service.version`, `startedAt`, `uptimeS`, `rssBytes`, `pid`, `python` | The service process: version, start time (Unix), seconds running, resident memory in bytes, process id and Python version. |
| `service.tasks` | Whether the long-lived tasks (`device`, `timers`) are alive. They are restarted automatically if they fail; `false` is therefore brief or a bug. |
| `service.clients`, `micMode` | Connected browser tabs and the current microphone mode. |
| `node.connected`, `simulated` | Link state, and whether the node is the simulator. |
| `node.port` | Serial device in use; `"simulated"` in the simulator. |
| `node.link` | Link type from the node's last status: `uart`, `usb` or `none` (`"simulated"` in the simulator). |
| `node.firmware` | Firmware string `fw` from the node's last status (`"simulated"` in the simulator). `null` until the node has sent one. |
| `node.statusAgeS` | Seconds since that status arrived. |
| `node.capture`, `generation` | Whether the node reports microphone capture, and the node boot generation. |
| `node.crcErrors`, `missingSamples`, `audioBytes` | The service's own count of bad frames, missing audio samples and audio bytes received. |
| `node.nodeRxCrc`, `audioDrops` | The node's own `rx_crc` and `audio_drops` counters. |
| `node.knock` | The node's knock counters from STATUS (`thr`, `n`, `btn`, `long`, `bright`, `peak`, `hf`), or `null` for firmware without knock detection. |
| `node.sensor` | The node's sensor diagnostics (`addr`, `ok`, `fail`, last `err`); `{"simulated": true, …}` in the simulator. |
