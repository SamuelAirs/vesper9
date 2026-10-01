# Hardware profile

This profile reflects the supplied, already-working wiring. No rewiring is part of the software design.

## Pin mapping

| Component | Signal | ESP32-S3 GPIO |
| --- | --- | ---: |
| INMP441 | SCK / I²S BCLK | 4 |
| INMP441 | WS / LRCLK | 5 |
| INMP441 | SD / data into ESP32 | 6 |
| Arcade switch | Active-low input to ground | 7 |
| SHT3x | SDA | 8 |
| SHT3x | SCL | 9 |
| Left LED | Red / green / blue | 14 / 13 / 12 |
| Middle LED | Red / green / blue | 11 / 10 / 18 |
| Right LED | Red / green / blue | 17 / 16 / 15 |
| COM UART0 | TX / RX, board-profile assumption | 43 / 44 |

Mic VDD and sensor VIN are on 3.3 V. INMP441 L/R is grounded, selecting the left channel. The button uses the ESP32 internal pull-up and closes to ground. RGB common cathodes go to ground, with one existing 430 Ω resistor per color leg. All grounds are common. GPIO3 and GPIO46 remain unused.

The SHT3x is expected at `0x44`; firmware also probes `0x45`. It uses a high-repeatability single-shot measurement every five seconds and verifies both sensor CRC bytes before publishing. The Pi does not display a fabricated reading when no valid sensor packet has arrived.

## Nine independent light channels

ESP32-S3 provides eight LEDC channels. This firmware assigns the first eight color legs to LEDC and the ninth (right blue, GPIO15) to an MCPWM generator. That preserves independent brightness for all nine existing legs without requiring another controller.

Both implementations target 4 kHz PWM. LEDC uses 10-bit duty; MCPWM uses a 1000-count period. The 0–255 protocol values pass through an approximate gamma-2.2 mapping. Common-cathode LEDs are driven active-high. These light values are perceptual brightness commands, not calibrated optical color measurements.

## Microphone

The COM connector transports serial bytes rather than a USB microphone audio class. Firmware samples the INMP441 over I²S and sends framed PCM to the Pi. The Pi performs recognition, keeping the node focused on I/O and timing.

Off disables I²S acquisition and outgoing audio and drops queued recognition audio. It does not disconnect 3.3 V power from the physical mic module. On startup, link loss, or capture setup failure, the intended state is muted. Actual capture status is reported independently of the requested mode.

## Board memory and ports

The supplied profile selects 16 MB DIO flash and 8 MB octal PSRAM at 80 MHz. The application does not depend on a large frame buffer in PSRAM. The partition layout contains NVS, PHY initialization space, and one 4 MB application slot; the remainder is unused. OTA updates are not implemented.

UART43/44 is the usual S3 UART0 mapping used for a COM bridge, but the exact board schematic was not supplied. Those two definitions, along with every external pin, live in `firmware/main/hardware.h`. The native USB port, radio, GPIO3, and GPIO46 are unused by the application.

## First physical qualification

Compilation verifies APIs and target compatibility, not electrical behavior. On the actual assembled node, verify each channel in Node Scope, audible/visible Morse timing, sensible sensor readings, voice input level, a 30-second timer during gameplay, and recovery after unplug/replug. Keep the full-flash backup made by the installer until this check is complete.

Official peripheral documentation: [I²S](https://docs.espressif.com/projects/esp-idf/en/v5.4.2/esp32s3/api-reference/peripherals/i2s.html), [LEDC](https://docs.espressif.com/projects/esp-idf/en/v5.4.2/esp32s3/api-reference/peripherals/ledc.html), [MCPWM](https://docs.espressif.com/projects/esp-idf/en/v5.4.2/esp32s3/api-reference/peripherals/mcpwm.html).
