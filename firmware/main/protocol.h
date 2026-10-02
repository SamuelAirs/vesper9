#pragma once
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#define V9_MAX_PAYLOAD 768
#define V9_MAX_FRAME (V9_MAX_PAYLOAD + 10)
enum {
  V9_HELLO = 1,
  V9_BUTTON = 2,
  V9_SENSOR = 3,
  V9_AUDIO = 4,
  V9_CUE = 5,
  V9_STATUS = 6,
  V9_ACK = 7,
  V9_KNOCK = 8,
  V9_AUDIO2 = 9,
  V9_PING = 16,
  V9_LEDS = 17,
  V9_MIC = 18,
  V9_ARM = 19,
  V9_CANCEL = 20,
  V9_PATTERN = 21,
  V9_KNOCK_SET = 22
};
static inline uint16_t v9_u16(const uint8_t *p) { return p[0] | ((uint16_t)p[1] << 8); }
static inline uint32_t v9_u32(const uint8_t *p) {
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}
static inline void v9_put16(uint8_t *p, uint16_t x) {
  p[0] = x;
  p[1] = x >> 8;
}
static inline void v9_put32(uint8_t *p, uint32_t x) {
  for (int i = 0; i < 4; i++)
    p[i] = (uint8_t)(x >> (i * 8));
}
static inline void v9_put64(uint8_t *p, uint64_t x) {
  for (int i = 0; i < 8; i++)
    p[i] = (uint8_t)(x >> (i * 8));
}
static inline uint16_t v9_crc(const uint8_t *p, size_t n) {
  uint16_t crc = 0xffff;
  for (size_t i = 0; i < n; i++) {
    crc ^= (uint16_t)p[i] << 8;
    for (int b = 0; b < 8; b++)
      crc = (uint16_t)((crc << 1) ^ ((crc & 0x8000) ? 0x1021 : 0));
  }
  return crc;
}
static inline size_t v9_encode(uint8_t *out, uint8_t kind, uint16_t seq, const uint8_t *data,
                               uint16_t len) {
  if (len > V9_MAX_PAYLOAD)
    return 0;
  out[0] = 'V';
  out[1] = '9';
  out[2] = 1;
  out[3] = kind;
  v9_put16(out + 4, seq);
  v9_put16(out + 6, len);
  if (len)
    memcpy(out + 8, data, len);
  v9_put16(out + 8 + len, v9_crc(out + 2, 6 + len));
  return len + 10;
}
typedef struct {
  uint8_t data[V9_MAX_FRAME];
  size_t length;
  uint32_t errors;
} v9_decoder;
typedef void (*v9_callback)(uint8_t kind, uint16_t seq, const uint8_t *payload, uint16_t len,
                            void *context);
static inline void v9_feed(v9_decoder *d, const uint8_t *bytes, size_t count, v9_callback callback,
                           void *context) {
  for (size_t b = 0; b < count; b++) {
    if (d->length >= V9_MAX_FRAME) {
      memmove(d->data, d->data + 1, --d->length);
      d->errors++;
    }
    d->data[d->length++] = bytes[b];
    for (;;) {
      if (d->length < 2)
        break;
      if (d->data[0] != 'V' || d->data[1] != '9') {
        memmove(d->data, d->data + 1, --d->length);
        continue;
      }
      if (d->length < 8)
        break;
      uint16_t len = v9_u16(d->data + 6);
      if (d->data[2] != 1 || len > V9_MAX_PAYLOAD) {
        memmove(d->data, d->data + 1, --d->length);
        d->errors++;
        continue;
      }
      size_t total = len + 10;
      if (d->length < total)
        break;
      if (v9_crc(d->data + 2, len + 6) != v9_u16(d->data + len + 8)) {
        memmove(d->data, d->data + 1, --d->length);
        d->errors++;
        continue;
      }
      callback(d->data[3], v9_u16(d->data + 4), d->data + 8, len, context);
      memmove(d->data, d->data + total, d->length - total);
      d->length -= total;
    }
  }
}
