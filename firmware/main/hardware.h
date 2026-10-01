#pragma once
// Sam's as-wired ESP32-S3 N16R8 node. LED triplets are RGB, left to right.
#define NODE_BUTTON 7
#define NODE_I2S_BCLK 4
#define NODE_I2S_WS 5
#define NODE_I2S_DIN 6
#define NODE_SDA 8
#define NODE_SCL 9
#define NODE_UART_TX 43
#define NODE_UART_RX 44
#define NODE_BAUD 921600
#define NODE_RATE 16000
#define NODE_AUDIO_SAMPLES 320
static const int NODE_LEDS[9] = {14, 13, 12, 11, 10, 18, 17, 16, 15};
