#include "../main/protocol.h"
#include <assert.h>
#include <stdio.h>
static int count = 0;
static void got(uint8_t kind, uint16_t seq, const uint8_t *p, uint16_t n, void *ctx) {
  (void)ctx;
  assert(kind == V9_LEDS);
  assert(seq == 123);
  assert(n == 9);
  for (int i = 0; i < 9; i++)
    assert(p[i] == i);
  count++;
}
int main(void) {
  assert(v9_crc((const uint8_t *)"123456789", 9) == 0x29b1);
  uint8_t values[9] = {0, 1, 2, 3, 4, 5, 6, 7, 8}, frame[V9_MAX_FRAME];
  size_t n = v9_encode(frame, V9_LEDS, 123, values, 9);
  assert(n == 19);
  for (size_t split = 0; split <= n; split++) {
    v9_decoder d = {0};
    count = 0;
    v9_feed(&d, frame, split, got, NULL);
    v9_feed(&d, frame + split, n - split, got, NULL);
    assert(count == 1);
  }
  v9_decoder d = {0};
  uint8_t bad[V9_MAX_FRAME];
  memcpy(bad, frame, n);
  bad[10] ^= 1;
  count = 0;
  v9_feed(&d, bad, n, got, NULL);
  v9_feed(&d, frame, n, got, NULL);
  assert(count == 1 && d.errors > 0);
  for (size_t i = 0; i < n; i++)
    printf("%02x", frame[i]);
  puts("");
  return 0;
}
