#pragma once
// Board profiles, both ESP32-S3 N16R8. Choose at build time: idf.py -DNODE_BOARD=2 build
// (scripts/build-firmware.sh takes the number as its first argument). STATUS reports "board".
//
// Board 1: Sam's first node, confirmed against the board on 2026-09-30. Three lamps, one
// microphone, an SHT3x. LED triplets are RGB, left to right. The colour legs do not follow the
// order of the original wiring table; this map comes from Sam watching one output at a time
// (left/middle: red and green exchanged; right: red on 11, green on 9, blue on 10).
//
// Board 2: Sam's second node, wiring table of 2026-10-02. Four lamps, two microphones (left and
// right), no SHT3x (its pins carry the fourth lamp). The right microphone has its own clock pins;
// the firmware drives them with the left microphone's clocks so both sample on the same edges.
//
// On both, the arcade switch sits between NODE_BUTTON and NODE_BUTTON_RETURN; the return pin is
// driven low as its ground.
#ifndef NODE_BOARD
#define NODE_BOARD 1
#endif
#define NODE_BUTTON 12
#define NODE_BUTTON_RETURN 46
#define NODE_I2S_BCLK 4
#define NODE_I2S_WS 5
#define NODE_I2S_DIN 6
#define NODE_UART_TX 43
#define NODE_UART_RX 44
#define NODE_BAUD 921600
#define NODE_RATE 16000
#define NODE_AUDIO_SAMPLES 320
#if NODE_BOARD == 1
#define NODE_LAMPS 3
#define NODE_MICS 1
#define NODE_SENSOR 1
#define NODE_SDA 13
#define NODE_SCL 14
#define NODE_I2C_HZ 100000
static const int NODE_LEDS[9] = {15, 7, 16, 18, 17, 8, 11, 9, 10};
#elif NODE_BOARD == 2
#define NODE_LAMPS 4
#define NODE_MICS 2
#define NODE_SENSOR 0
#define NODE_I2S2_BCLK 47
#define NODE_I2S2_WS 45
#define NODE_I2S2_DIN 21
static const int NODE_LEDS[12] = {7, 15, 16, 17, 18, 8, 9, 10, 11, 13, 14, 3};
#else
#error "NODE_BOARD must be 1 or 2"
#endif
#define NODE_LED_COUNT (NODE_LAMPS * 3)
// The first eight outputs use LEDC (all it has); the rest use MCPWM generators, two per operator.
#define NODE_LEDC_COUNT 8
#define NODE_MCPWM_COUNT (NODE_LED_COUNT - NODE_LEDC_COUNT)
