#pragma once
// Sam's as-wired ESP32-S3 N16R8 node, confirmed against the board on 2026-09-30.
// LED triplets are RGB, left to right. The arcade switch sits between
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
static const int NODE_LEDS[9] = {7, 15, 16, 17, 18, 8, 9, 10, 11};
