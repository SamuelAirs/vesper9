// Host test for firmware/main/knock.h with synthetic signals. These are models of a knock, a tone
// and a voice, not recordings: they check the detector's logic, not its tuning on the real case.
#include "../main/knock.h"
#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>

#define RATE 16000
#define MS(x) ((x) * RATE / 1000)
static int16_t signal[RATE * 4];
static uint32_t seed = 12345;

static double noise(void) {
  seed = seed * 1664525u + 1013904223u;
  return ((seed >> 8) / 8388608.0) - 1.0; // -1 ... 1
}
static int16_t clip(double v) { return (int16_t)(v > 32767 ? 32767 : v < -32768 ? -32768 : lround(v)); }
static void background(size_t n, double level) {
  for (size_t i = 0; i < n; i++)
    signal[i] = clip(noise() * level);
}
// A tap on a plastic case: a few cycles of ringing that die out within about 15 ms.
static void add_ring(size_t at, double amplitude, double decay_s, size_t length) {
  for (size_t i = 0; i < length && at + i < sizeof(signal) / 2; i++) {
    double t = (double)i / RATE;
    signal[at + i] = clip(signal[at + i] + amplitude * exp(-t / decay_s) * sin(2 * M_PI * 900 * t));
  }
}
static void add_knock(size_t at, double amplitude) { add_ring(at, amplitude, 0.004, MS(40)); }
// A clap: a burst of broadband noise that dies away within about 20 ms.
static void add_clap(size_t at, double amplitude) {
  for (size_t i = 0; i < (size_t)MS(60); i++) {
    double t = (double)i / RATE;
    signal[at + i] = clip(signal[at + i] + amplitude * exp(-t / 0.005) * noise());
  }
}
// A beep, with a 1 ms ramp at each end.
static void add_tone(size_t at, size_t length, double hz, double amplitude) {
  for (size_t i = 0; i < length; i++) {
    double t = (double)i / RATE, ramp = fmin(1, fmin(i, length - i) / (double)MS(1));
    signal[at + i] = clip(signal[at + i] + amplitude * ramp * sin(2 * M_PI * hz * t));
  }
}
// A syllable: a plosive click followed by a voiced vowel that lasts 200 ms.
static void add_syllable(size_t at, double amplitude) {
  add_knock(at, amplitude);
  for (size_t i = 0; i < (size_t)MS(200); i++) {
    double t = (double)i / RATE, env = fmin(1, i / (double)MS(15));
    signal[at + i] = clip(signal[at + i] + amplitude * 0.5 * env * (sin(2 * M_PI * 140 * t) + 0.5 * sin(2 * M_PI * 420 * t)));
  }
}

typedef struct {
  int hits, sustained;
  uint32_t onset[16];
  int32_t peak[16], hf[16];
} result;
static result run(size_t n, uint16_t threshold) {
  knock_detector k;
  knock_init(&k, threshold);
  result r = {0};
  for (size_t i = 0; i < n; i++) {
    knock_verdict v = knock_push(&k, signal[i]);
    if (v == KNOCK_HIT) {
      // The verdict comes KNOCK_TAIL_TO_MS after the onset, never sooner.
      assert(k.samples - k.onset >= (uint32_t)MS(KNOCK_TAIL_TO_MS) - KNOCK_BLOCK);
      r.onset[r.hits] = k.onset;
      r.hf[r.hits] = k.last_hf;
      r.peak[r.hits++] = k.last_peak;
    } else if (v == KNOCK_SUSTAINED)
      r.sustained++;
  }
  return r;
}

int main(void) {
  const size_t n = MS(1500);
  const uint16_t medium = 4000;

  // One knock in a quiet room: one hit, onset within a millisecond, its peak reported.
  background(n, 60);
  add_knock(MS(500), 20000);
  result r = run(n, medium);
  assert(r.hits == 1 && r.sustained == 0);
  assert(abs((int)r.onset[0] - MS(500)) <= MS(1));
  assert(r.peak[0] > 15000);

  // Detection off: nothing, however loud.
  r = run(n, 0);
  assert(r.hits == 0 && r.sustained == 0);

  // Too soft for the threshold: nothing. A higher sensitivity (lower threshold) hears it.
  background(n, 60);
  add_knock(MS(500), 3000);
  assert(run(n, medium).hits == 0);
  assert(run(n, 2000).hits == 1);

  // Two knocks 100 ms apart are one event (the second rings inside the first's window, so it may
  // be judged sustained: never two hits); 250 ms apart they are two.
  background(n, 60);
  add_knock(MS(300), 20000);
  add_knock(MS(400), 20000);
  assert(run(n, medium).hits <= 1);
  background(n, 60);
  add_knock(MS(300), 20000);
  add_knock(MS(550), 20000);
  r = run(n, medium);
  assert(r.hits == 2);
  assert(abs((int)r.onset[1] - MS(550)) <= MS(1));

  // A loud steady tone with a sharp start: judged sustained, never a knock.
  background(n, 60);
  add_tone(MS(400), MS(300), 1000, 12000);
  r = run(n, medium);
  assert(r.hits == 0 && r.sustained >= 1);

  // A 60 ms beep from the speaker: sustained.
  background(n, 60);
  add_tone(MS(400), MS(60), 1500, 12000);
  r = run(n, medium);
  assert(r.hits == 0 && r.sustained == 1);

  // Loud speech with a sharp plosive: sustained, never a knock.
  background(n, 60);
  add_syllable(MS(300), 10000);
  add_syllable(MS(700), 10000);
  r = run(n, medium);
  assert(r.hits == 0 && r.sustained >= 1);

  // In a noisy room the background rises: a knock that is not clearly above it is ignored, a
  // clear one still counts.
  background(n, 900);
  add_knock(MS(500), 5000);
  assert(run(n, medium).hits == 0);
  background(n, 900);
  add_knock(MS(500), 30000);
  assert(run(n, medium).hits == 1);

  // A knock right after loud speech is still heard once the speech has stopped.
  background(n, 60);
  add_syllable(MS(100), 10000);
  add_knock(MS(900), 20000);
  r = run(n, medium);
  assert(r.hits == 1 && abs((int)r.onset[0] - MS(900)) <= MS(1));

  // Clipped (full-scale) knock: still one hit.
  background(n, 60);
  add_knock(MS(500), 90000);
  r = run(n, medium);
  assert(r.hits == 1 && r.peak[0] >= 32767);

  // A hard knock that clips and rings for longer (seen on the real case: 3 of 14 such knocks were
  // judged sustained with a 20-70 ms window and no allowance for clipping): still one hit.
  background(n, 60);
  add_ring(MS(500), 200000, 0.012, MS(120));
  r = run(n, medium);
  assert(r.hits == 1 && r.sustained == 0 && r.peak[0] >= 32767);

  // Brightness: a clap (broadband) reads far brighter than a knock's ring. KNOCK_MAX_HF is not set
  // yet, so both count; the device measurements will set it.
  background(n, 60);
  add_knock(MS(300), 20000);
  add_clap(MS(900), 20000);
  r = run(n, medium);
  assert(r.hits == 2);
  printf("brightness: knock %d, clap %d\n", (int)r.hf[0], (int)r.hf[1]);
  assert(r.hf[0] < 60 && r.hf[1] > 90);

  puts("knock detector: all cases passed");
  return 0;
}
