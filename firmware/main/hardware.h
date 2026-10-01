#pragma once
// Sam's as-wired ESP32-S3 N16R8 node, confirmed against the board on 2026-09-30.
// LED triplets are RGB, left to right. The colour legs do not follow the
// order of the original wiring table; this map comes from Sam watching one
// output at a time on 2026-09-30 (left/middle: red and green exchanged;
// right: red on 11, green on 9, blue on 10). The arcade switch sits between
// NODE_BUTTON and NODE_BUTTON_RETURN; the return pin is driven low as its ground.
#define NODE_BUTTON 12
#define NODE_BUTTON_RETURN 46
#define NODE_I2S_BCLK 4
#define NODE_I2S_WS 5
#define NODE_I2S_DIN 6
#define NODE_SDA 13
#define NODE_SCL 14
#define NODE_I2C_HZ 100000
#define NODE_UART_TX 43
#define NODE_UART_RX 44
#define NODE_BAUD 921600
#define NODE_RATE 16000
#define NODE_AUDIO_SAMPLES 320
static const int NODE_LEDS[9] = {15, 7, 16, 18, 17, 8, 11, 9, 10};
