#pragma once
// Knock detection on the microphone signal: a sharp tap on the case. Pure C with no ESP-IDF
// dependency, so firmware/host-test/knock_test.c runs the same code on a development host.
//
// The detector sees the same 16 kHz signed 16-bit samples the node streams (after the DC filter)
// and works in 1 ms blocks of 16 samples, keeping the peak and the mean absolute level of each.
//  - Onset: a block whose peak reaches the threshold set by the host AND is at least KNOCK_RATIO
//    times the background (a slow average of the mean level of quiet blocks).
//  - Verdict, 70 ms after the onset: a knock is short. The mean level from 20 to 70 ms after the
//    onset must have fallen to KNOCK_DECAY_PCT % of the mean level of the first 10 ms. Speech, a
//    whistle or a beep from the speaker keep going and are reported as KNOCK_SUSTAINED instead.
//  - Nothing new can start until KNOCK_REFRACTORY_MS after an onset (so one knock is one event).
// Whether a knock coincided with a button edge (the switch itself clicks) is decided by the caller,
// which owns the button timing. All tuning lives in these constants and the host's threshold.
#include <stdbool.h>
#include <stdint.h>

#define KNOCK_BLOCK 16          // samples per block: 1 ms at 16 kHz
#define KNOCK_RATIO 8           // onset peak / background mean level
#define KNOCK_FLOOR_MIN 16      // background never counts as quieter than this (an idle room is not silent)
#define KNOCK_BODY_MS 10        // the knock itself
#define KNOCK_TAIL_FROM_MS 20   // window that must have gone quiet...
#define KNOCK_TAIL_TO_MS 70     // ...and when the verdict is given
#define KNOCK_DECAY_PCT 20      // tail mean level, at most this percentage of the body's
#define KNOCK_REFRACTORY_MS 150 // from one onset to the next possible one
#define KNOCK_MIN_THRESHOLD 256 // the host's threshold: 0 (off) or 256 ... 32767
#define KNOCK_FLOOR_SHIFT 8     // background follows quiet blocks with a 256 ms time constant

typedef enum { KNOCK_NONE = 0, KNOCK_HIT = 1, KNOCK_SUSTAINED = 2 } knock_verdict;
enum { KNOCK_IDLE = 0, KNOCK_CANDIDATE = 1, KNOCK_REFRACTORY = 2 };

typedef struct {
  uint16_t threshold;     // peak level for an onset; 0 = detection off
  uint32_t samples;       // samples pushed so far (wraps)
  int32_t floor_q8;       // background mean level, 24.8 fixed point; -1 until the first block
  int fill;
  int32_t block_peak;
  int32_t block_sum;
  uint32_t block_first;   // sample count at the first sample of this block that reached the threshold
  bool block_hit;
  int phase;
  int blocks;             // blocks since the onset block
  int32_t peak;           // highest block peak of the current candidate
  int32_t body_sum, tail_sum;
  int body_n, tail_n;
  uint32_t onset;         // sample count at the onset of the last verdict
  int32_t last_peak;      // its peak
} knock_detector;

static inline void knock_init(knock_detector *k, uint16_t threshold) {
  *k = (knock_detector){0};
  k->threshold = threshold;
  k->floor_q8 = -1;
}

// Restart from silence (the microphone was just enabled, or the threshold changed). Keeps the threshold.
static inline void knock_reset(knock_detector *k) { knock_init(k, k->threshold); }

static inline void knock_follow_floor(knock_detector *k, int32_t mean) {
  if (k->floor_q8 < 0)
    k->floor_q8 = mean << 8;
  else
    k->floor_q8 += ((mean << 8) - k->floor_q8) >> KNOCK_FLOOR_SHIFT;
}

// One sample. Returns a verdict at most once per candidate, KNOCK_TAIL_TO_MS after its onset;
// k->onset and k->last_peak then describe it.
static inline knock_verdict knock_push(knock_detector *k, int16_t sample) {
  int32_t a = sample < 0 ? -(int32_t)sample : sample;
  if (k->fill == 0) {
    k->block_peak = 0;
    k->block_sum = 0;
    k->block_hit = false;
  }
  if (a > k->block_peak)
    k->block_peak = a;
  k->block_sum += a;
  if (k->threshold && !k->block_hit && a >= k->threshold) {
    k->block_hit = true;
    k->block_first = k->samples;
  }
  k->samples++;
  if (++k->fill < KNOCK_BLOCK)
    return KNOCK_NONE;
  k->fill = 0;
  const int32_t peak = k->block_peak, mean = k->block_sum / KNOCK_BLOCK;
  switch (k->phase) {
  case KNOCK_IDLE: {
    if (k->floor_q8 < 0) {
      knock_follow_floor(k, mean);
      return KNOCK_NONE;
    }
    int32_t floor = k->floor_q8 >> 8;
    if (floor < KNOCK_FLOOR_MIN)
      floor = KNOCK_FLOOR_MIN;
    if (k->threshold && k->block_hit && peak >= KNOCK_RATIO * floor) {
      k->phase = KNOCK_CANDIDATE;
      k->blocks = 0;
      k->peak = peak;
      k->onset = k->block_first;
      k->body_sum = mean;
      k->body_n = 1;
      k->tail_sum = 0;
      k->tail_n = 0;
    } else
      knock_follow_floor(k, mean);
    return KNOCK_NONE;
  }
  case KNOCK_CANDIDATE:
    k->blocks++;
    if (k->blocks < KNOCK_BODY_MS) {
      k->body_sum += mean;
      k->body_n++;
      if (peak > k->peak)
        k->peak = peak;
    } else if (k->blocks >= KNOCK_TAIL_FROM_MS) {
      k->tail_sum += mean;
      k->tail_n++;
    }
    if (k->blocks < KNOCK_TAIL_TO_MS - 1)
      return KNOCK_NONE;
    k->phase = KNOCK_REFRACTORY;
    k->last_peak = k->peak;
    // tail mean / body mean <= DECAY_PCT / 100, without division.
    if ((int64_t)k->tail_sum * k->body_n * 100 <= (int64_t)k->body_sum * k->tail_n * KNOCK_DECAY_PCT)
      return KNOCK_HIT;
    // Something loud and lasting: let the background rise towards it, so a steady loud
    // sound does not produce a stream of candidates.
    k->floor_q8 = (k->tail_sum / k->tail_n) << 8;
    return KNOCK_SUSTAINED;
  default:
    k->blocks++;
    if (k->blocks >= KNOCK_REFRACTORY_MS - 1) {
      k->phase = KNOCK_IDLE;
      knock_follow_floor(k, mean);
    }
    return KNOCK_NONE;
  }
}
