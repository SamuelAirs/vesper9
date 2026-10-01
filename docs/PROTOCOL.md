# VESPER node protocol v1

Transport: CH343 COM UART, **921600 baud, 8N1, no hardware flow control**. Firmware uses UART0 with board-profile TX43/RX44. The native USB port is not used. UART boot noise is tolerated; application text logging on the binary UART is disabled.

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

Status fields: `fw`, `mic` (actual capture active), `button`, `audio_drops`, `rx_crc`, and `leds` (nine current brightness values). The Pi enriches browser diagnostics with its own CRC errors, observed missing audio samples, and audio byte totals.

BUTTON uses an 8 ms debounce window and timestamps the initial edge that became stable. A button held at boot is inhibited until released. CUE is timestamped immediately after the light-update call. Both timestamps use the same ESP32 monotonic clock; no USB transit-time subtraction is required for physical button reaction trials. Debounce, GPIO polling, PWM phase, and real LED response still contribute measurement uncertainty.

Audio is **16 kHz, mono, signed 16-bit little-endian**, normally 320 samples per packet (20 ms). Sample indices count transmitted source samples modulo 2³² and expose dropped chunks. The INMP441 supplies 24-bit data in the left slot of a 32-bit stereo I²S frame; firmware clocks both slots, discards the right slot, and shifts the left sample down to 16 bits. No audio packets are sent while acquisition is disabled.

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

ARM delay: 250–10000 ms; light index 0–2. ARM cancels a running pattern. A cue clears all lights and activates the chosen light, then emits CUE. LEDS cancels a pattern but does not cancel an armed reaction; CANCEL explicitly does so.

PATTERN: 1–16 steps, duration 10–10000 ms per step, repeat 1–8. It cancels an armed reaction and starts immediately. Lights turn off after the final repeat. CANCEL cancels scheduling but does not itself change LED values; the host sends lights-off when exiting an app.

The Pi sends PING every second. With no valid host frame for three seconds, the node disables acquisition, clears audio scheduling, cancels cues/patterns, and turns off the lights. The Pi declares a stale node link after four seconds and reconnects. Real-time button/control packets have priority over bounded audio queues.

## Bandwidth budget

PCM payload alone is 32000 bytes/s. At 50 packets/s, headers/indices add approximately 700 bytes/s. A 921600 8N1 UART has a theoretical ceiling of 92160 bytes/s in each direction, leaving headroom for sensor/status/control packets and USB scheduling. This is a design budget, not a measured throughput guarantee for the user's cable and board.

## Browser/service messages

The browser uses JSON over `/ws`. A command includes `command`, its payload fields, and optional **`requestId`**. Replies use `{type: "reply", id: requestId, ok: true, data: ...}` or `ok: false, error: ...`. Timer identifiers use their separate `id` field. Fire-and-forget commands omit `requestId`; validation errors are still reported.

Example:

```json
{"requestId":27,"command":"timer","op":"toggle","id":"f93bc72a60a1"}
```

Supported command names: `leds`, `pattern`, `reaction`, `cancel`, `button` (simulation only), `mic`, `timer`, `score`, `progress`, `settings`, `focus`. There is no shell command or arbitrary file-write operation.

`/api/state`, `/api/history`, `/api/sessions`, `/api/transcript/{session}`, and `/api/export/{session}` provide local reads. The first WebSocket tab is the controller; additional tabs monitor events. Cross-origin requests and unexpected Host headers are rejected.
