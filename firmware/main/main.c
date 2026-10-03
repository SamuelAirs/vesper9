#include "driver/gpio.h"
#include "driver/i2s_std.h"
#include "driver/ledc.h"
#include "driver/mcpwm_prelude.h"
#include "driver/rmt_tx.h"
#include "driver/uart.h"
#include "driver/usb_serial_jtag.h"
#include "esp_err.h"
#include "esp_rom_gpio.h"
#include "esp_rom_sys.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "soc/i2s_periph.h"
#include "hardware.h"
#if NODE_SENSOR
#include "driver/i2c_master.h"
#endif
#define NODE_FIRMWARE "vesper-node-0.2.0"
#include "knock.h"
#include "protocol.h"
#include <math.h>
#include <stdatomic.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
  uint8_t kind;
  uint16_t length;
  uint8_t payload[V9_MAX_PAYLOAD];
} message;
static QueueHandle_t urgent_queue, audio_queue, knock_queue;
static atomic_bool mic_wanted = false, mic_active = false;
// Knock detection (knock.h) runs on the microphone whenever the host has set a threshold, whether or
// not audio is being streamed; only KNOCK events leave the node. The microphone task owns the
// detector and queues each verdict; the main loop, which owns the button timing, drops knocks that
// coincide with a button edge (the switch clicks) and sends the rest.
#define KNOCK_GUARD_US 60000
#define KNOCK_EDGES 32
// KNOCK_CLIP (two-microphone nodes): both channels around each knock that is sent, so the Pi can
// tell where on the case it landed. CLIP_PRE frames before the onset, CLIP_FRAMES in all.
#define CLIP_PRE 32
#define CLIP_FRAMES 176
typedef struct {
  int64_t at;
  int32_t peak;
  uint8_t hf;
  uint8_t verdict;
#if NODE_MICS == 2
  bool clip_ok;
  int16_t clip[CLIP_FRAMES * 2]; // left, right pairs
#endif
} knock_candidate;
static atomic_uint knock_threshold = 0;
static int64_t button_edges[KNOCK_EDGES] = {0};
static unsigned button_edge_next = 0;
static uint32_t knock_sent = 0, knock_button = 0, knock_sustained = 0, knock_bright = 0;
static int32_t knock_last_peak = 0, knock_last_hf = 0;
static atomic_uint audio_drops = 0;
// Sensor diagnostics for STATUS: address in use (0 = none), counts, last esp_err_t.
static atomic_int sensor_address = 0, sensor_error = 0;
static atomic_uint sensor_good = 0, sensor_bad = 0;
static i2s_chan_handle_t microphone;
#if NODE_MICS == 2
static i2s_chan_handle_t microphone2;
#endif
static atomic_bool mic_stereo = false;
#if NODE_MICS == 2
static atomic_uint mic2_errors = 0;
static atomic_int mic2_setup = 0; // esp_err_t of the second port's set-up, 0 = fine
#endif
// Wiring diagnostics for STATUS: the largest raw magnitude (top 16 bits) seen in the latest read, in
// each I2S slot of each microphone port: left port slot 0, slot 1, right port slot 0, slot 1.
static atomic_uint slot_peaks[4];
static mcpwm_cmpr_handle_t extra_comparators[NODE_MCPWM_COUNT];
static mcpwm_gen_handle_t extra_generators[NODE_MCPWM_COUNT];
static uint8_t leds[NODE_LED_COUNT] = {0};
// Protocol v1 is served on both the COM bridge (UART0) and the native USB
// port (USB Serial/JTAG). The node answers on whichever link last delivered a
// valid host frame; with no live host it announces itself on both.
enum { LINK_UART = 0, LINK_USB = 1, LINK_COUNT = 2, LINK_NONE = -1 };
static v9_decoder decoders[LINK_COUNT] = {0};
static int64_t last_byte[LINK_COUNT] = {0};
static atomic_int active_link = LINK_NONE;
static int64_t last_host = 0, last_status = 0;
static bool link_alive = false;
static bool button_raw = false, button_stable = false, button_inhibit = true;
static int64_t button_edge = 0;
static bool reaction_armed = false;
static uint32_t reaction_id = 0;
static int64_t reaction_due = 0;
static uint8_t reaction_led = 1, reaction_rgb[3] = {30, 255, 90};
typedef struct {
  uint16_t ms;
  uint8_t rgb[NODE_LED_COUNT];
} pattern_step;
static pattern_step steps[16];
static uint8_t pattern_count = 0, pattern_index = 0, pattern_repeat = 0;
static int64_t pattern_due = 0;

static void send_message(uint8_t kind, const void *data, uint16_t length, bool audio) {
  if (length > V9_MAX_PAYLOAD)
    return;
  message m = {.kind = kind, .length = length};
  if (length)
    memcpy(m.payload, data, length);
  if (xQueueSend(audio ? audio_queue : urgent_queue, &m, 0) != pdTRUE && audio)
    atomic_fetch_add(&audio_drops, 1);
}
static void ack(uint16_t sequence, uint8_t kind, uint8_t result) {
  uint8_t p[4];
  v9_put16(p, sequence);
  p[2] = result;
  p[3] = kind;
  send_message(V9_ACK, p, 4, false);
}

static void set_leds(const uint8_t *values) {
  memcpy(leds, values, NODE_LED_COUNT);
  for (int i = 0; i < NODE_LEDC_COUNT; i++) {
    uint32_t duty = (uint32_t)lroundf(powf(values[i] / 255.0f, 2.2f) * 1023.0f);
    ledc_set_duty(LEDC_LOW_SPEED_MODE, (ledc_channel_t)i, duty);
    ledc_update_duty(LEDC_LOW_SPEED_MODE, (ledc_channel_t)i);
  }
  for (int i = 0; i < NODE_MCPWM_COUNT; i++) {
    const uint8_t value = values[NODE_LEDC_COUNT + i];
    if (value == 0)
      mcpwm_generator_set_force_level(extra_generators[i], 0, true);
    else if (value == 255)
      mcpwm_generator_set_force_level(extra_generators[i], 1, true);
    else {
      uint32_t duty = (uint32_t)lroundf(powf(value / 255.0f, 2.2f) * 1000.0f);
      if (duty < 1)
        duty = 1;
      if (duty > 999)
        duty = 999;
      mcpwm_comparator_set_compare_value(extra_comparators[i], duty);
      mcpwm_generator_set_force_level(extra_generators[i], -1, true);
    }
  }
}
// The board's own LED (a WS2812): three bytes clocked out by RMT, green first.
static rmt_channel_handle_t board_led_channel;
static rmt_encoder_handle_t board_led_encoder;
static uint8_t board_led[3] = {0}, board_led_wire[3];
static void set_board_led(uint8_t r, uint8_t g, uint8_t b) {
  board_led[0] = r;
  board_led[1] = g;
  board_led[2] = b;
  if (!board_led_channel)
    return;
  board_led_wire[0] = g;
  board_led_wire[1] = r;
  board_led_wire[2] = b;
  rmt_transmit_config_t once = {.loop_count = 0};
  rmt_transmit(board_led_channel, board_led_encoder, board_led_wire, 3, &once);
}
static void setup_board_led(void) {
  rmt_tx_channel_config_t channel = {.clk_src = RMT_CLK_SRC_DEFAULT,
                                     .gpio_num = NODE_BOARD_LED,
                                     .mem_block_symbols = 64,
                                     .resolution_hz = 10000000, // 0.1 us
                                     .trans_queue_depth = 4};
  rmt_bytes_encoder_config_t bytes = {.bit0 = {.level0 = 1, .duration0 = 3, .level1 = 0, .duration1 = 9},
                                      .bit1 = {.level0 = 1, .duration0 = 9, .level1 = 0, .duration1 = 3},
                                      .flags.msb_first = 1};
  if (rmt_new_tx_channel(&channel, &board_led_channel) != ESP_OK ||
      rmt_new_bytes_encoder(&bytes, &board_led_encoder) != ESP_OK || rmt_enable(board_led_channel) != ESP_OK) {
    board_led_channel = NULL; // a node without it still runs
    return;
  }
  set_board_led(0, 0, 0);
}
static void lights_off(void) {
  uint8_t off[NODE_LED_COUNT] = {0};
  set_leds(off);
}
// Hosts written for three lamps send nine values: left, middle, right. On four lamps the middle
// pair shows the middle value, so left stays left, right stays right and the row stays symmetric.
static void expand_lamps(const uint8_t *nine, uint8_t *out) {
#if NODE_LAMPS == 4
  memcpy(out, nine, 3);
  memcpy(out + 3, nine + 3, 3);
  memcpy(out + 6, nine + 3, 3);
  memcpy(out + 9, nine + 6, 3);
#else
  memcpy(out, nine, 9);
#endif
}

static void setup_lights(void) {
  ledc_timer_config_t timer = {.speed_mode = LEDC_LOW_SPEED_MODE,
                               .duty_resolution = LEDC_TIMER_10_BIT,
                               .timer_num = LEDC_TIMER_0,
                               .freq_hz = 4000,
                               .clk_cfg = LEDC_AUTO_CLK};
  ESP_ERROR_CHECK(ledc_timer_config(&timer));
  for (int i = 0; i < NODE_LEDC_COUNT; i++) {
    ledc_channel_config_t channel = {.gpio_num = NODE_LEDS[i],
                                     .speed_mode = LEDC_LOW_SPEED_MODE,
                                     .channel = (ledc_channel_t)i,
                                     .intr_type = LEDC_INTR_DISABLE,
                                     .timer_sel = LEDC_TIMER_0,
                                     .duty = 0,
                                     .hpoint = 0};
    ESP_ERROR_CHECK(ledc_channel_config(&channel));
  }
  mcpwm_timer_handle_t pwm_timer;
  mcpwm_timer_config_t config = {.group_id = 0,
                                 .clk_src = MCPWM_TIMER_CLK_SRC_DEFAULT,
                                 .resolution_hz = 4000000,
                                 .count_mode = MCPWM_TIMER_COUNT_MODE_UP,
                                 .period_ticks = 1000};
  ESP_ERROR_CHECK(mcpwm_new_timer(&config, &pwm_timer));
  mcpwm_oper_handle_t op = NULL;
  for (int i = 0; i < NODE_MCPWM_COUNT; i++) {
    if (i % 2 == 0) { // each operator carries two comparators and two generators
      mcpwm_operator_config_t operator_config = {.group_id = 0};
      ESP_ERROR_CHECK(mcpwm_new_operator(&operator_config, &op));
      ESP_ERROR_CHECK(mcpwm_operator_connect_timer(op, pwm_timer));
    }
    mcpwm_comparator_config_t comparator_config = {.flags.update_cmp_on_tez = true};
    ESP_ERROR_CHECK(mcpwm_new_comparator(op, &comparator_config, &extra_comparators[i]));
    mcpwm_generator_config_t generator_config = {.gen_gpio_num = NODE_LEDS[NODE_LEDC_COUNT + i]};
    ESP_ERROR_CHECK(mcpwm_new_generator(op, &generator_config, &extra_generators[i]));
    ESP_ERROR_CHECK(mcpwm_generator_set_action_on_timer_event(
        extra_generators[i],
        MCPWM_GEN_TIMER_EVENT_ACTION(MCPWM_TIMER_DIRECTION_UP, MCPWM_TIMER_EVENT_EMPTY,
                                     MCPWM_GEN_ACTION_HIGH)));
    ESP_ERROR_CHECK(mcpwm_generator_set_action_on_compare_event(
        extra_generators[i],
        MCPWM_GEN_COMPARE_EVENT_ACTION(MCPWM_TIMER_DIRECTION_UP, extra_comparators[i],
                                       MCPWM_GEN_ACTION_LOW)));
    ESP_ERROR_CHECK(mcpwm_generator_set_force_level(extra_generators[i], 0, true));
  }
  ESP_ERROR_CHECK(mcpwm_timer_enable(pwm_timer));
  ESP_ERROR_CHECK(mcpwm_timer_start_stop(pwm_timer, MCPWM_TIMER_START_NO_STOP));
  lights_off();
}

static void status(uint8_t kind) {
  char data[640], lamps[NODE_LED_COUNT * 4 + 1];
  int at = 0;
  for (int i = 0; i < NODE_LED_COUNT; i++)
    at += snprintf(lamps + at, sizeof(lamps) - at, i ? ",%u" : "%u", leds[i]);
  int link = atomic_load(&active_link);
  int n = snprintf(data, sizeof(data),
                   "{\"fw\":\"" NODE_FIRMWARE "\",\"board\":%d,\"lamps\":%d,\"mics\":%d,\"link\":\"%s\",\"mic\":%s,"
                   "\"stereo\":%s,\"button\":%s,\"audio_"
                   "drops\":%u,\"rx_crc\":%lu,\"sensor\":{\"addr\":%d,\"ok\":%u,\"fail\":%u,\"err\":%d},\"leds\":[%s"
                   "],\"knock\":{\"thr\":%u,\"n\":%lu,\"btn\":%lu,\"long\":%lu,"
                   "\"bright\":%lu,\"peak\":%ld,\"hf\":%ld},\"mic2\":{\"setup\":%d,\"err\":%u},\"slots\":[%u,%u,%u,%u],\"board_led\":[%u,%u,%u]}",
                   NODE_BOARD, NODE_LAMPS, NODE_MICS,
                   link == LINK_USB ? "usb" : link == LINK_UART ? "uart" : "none",
                   atomic_load(&mic_active) ? "true" : "false",
                   atomic_load(&mic_active) && atomic_load(&mic_stereo) ? "true" : "false",
                   button_stable ? "true" : "false", atomic_load(&audio_drops),
                   (unsigned long)(decoders[LINK_UART].errors + decoders[LINK_USB].errors),
                   atomic_load(&sensor_address), atomic_load(&sensor_good), atomic_load(&sensor_bad),
                   atomic_load(&sensor_error), lamps,
                   atomic_load(&knock_threshold), (unsigned long)knock_sent, (unsigned long)knock_button,
                   (unsigned long)knock_sustained, (unsigned long)knock_bright, (long)knock_last_peak,
                   (long)knock_last_hf,
#if NODE_MICS == 2
                   atomic_load(&mic2_setup), atomic_load(&mic2_errors)
#else
                   0, 0u
#endif
                   , atomic_load(&slot_peaks[0]), atomic_load(&slot_peaks[1]), atomic_load(&slot_peaks[2]),
                   atomic_load(&slot_peaks[3]), board_led[0], board_led[1], board_led[2]);
  if (n > 0 && n < (int)sizeof(data))
    send_message(kind, data, (uint16_t)n, false);
}

static void command(uint8_t kind, uint16_t sequence, const uint8_t *p, uint16_t n, void *link) {
  last_host = esp_timer_get_time();
  link_alive = true;
  atomic_store(&active_link, (int)(intptr_t)link);
  switch (kind) {
  case V9_PING:
    if (n) {
      ack(sequence, kind, 1);
      return;
    }
    status(V9_STATUS);
    return;
  case V9_LEDS: {
    if (n != 9 && n != NODE_LED_COUNT) {
      ack(sequence, kind, 1);
      return;
    }
    uint8_t values[NODE_LED_COUNT];
    if (n == NODE_LED_COUNT)
      memcpy(values, p, NODE_LED_COUNT);
    else
      expand_lamps(p, values);
    pattern_count = 0;
    set_leds(values);
    break;
  }
  case V9_MIC:
    if (n != 1 || p[0] > (NODE_MICS == 2 ? 2 : 1)) {
      ack(sequence, kind, 1);
      return;
    }
    atomic_store(&mic_stereo, p[0] == 2);
    atomic_store(&mic_wanted, p[0] != 0);
    if (!p[0])
      xQueueReset(audio_queue);
    break;
  case V9_ARM:
    if (n != 12 || p[8] > 2 || v9_u32(p + 4) < 250 || v9_u32(p + 4) > 10000) {
      ack(sequence, kind, 1);
      return;
    }
    pattern_count = 0;
    reaction_id = v9_u32(p);
    reaction_due = esp_timer_get_time() + (int64_t)v9_u32(p + 4) * 1000;
    reaction_led = p[8];
    memcpy(reaction_rgb, p + 9, 3);
    reaction_armed = true;
    break;
  case V9_KNOCK_SET:
    if (n != 2 || (v9_u16(p) && (v9_u16(p) < KNOCK_MIN_THRESHOLD || v9_u16(p) > 32767))) {
      ack(sequence, kind, 1);
      return;
    }
    atomic_store(&knock_threshold, v9_u16(p));
    break;
  case V9_BOARD_LED:
    if (n != 3) {
      ack(sequence, kind, 1);
      return;
    }
    set_board_led(p[0], p[1], p[2]);
    break;
  case V9_CANCEL:
    if (n) {
      ack(sequence, kind, 1);
      return;
    }
    reaction_armed = false;
    pattern_count = 0;
    break;
  case V9_PATTERN:
    // A step is u16 ms plus nine values (three lamps) or, on a four-lamp board, twelve.
    const int step = (n >= 2 && p[1] && n == 2 + p[1] * (2 + NODE_LED_COUNT)) ? 2 + NODE_LED_COUNT : 11;
    if (n < 13 || p[0] < 1 || p[0] > 8 || p[1] < 1 || p[1] > 16 || n != 2 + p[1] * step) {
      ack(sequence, kind, 1);
      return;
    }
    for (int i = 0; i < p[1]; i++) {
      uint16_t ms = v9_u16(p + 2 + i * step);
      if (ms < 10 || ms > 10000) {
        ack(sequence, kind, 1);
        return;
      }
    }
    reaction_armed = false;
    pattern_count = p[1];
    pattern_repeat = p[0];
    pattern_index = 0;
    for (int i = 0; i < pattern_count; i++) {
      steps[i].ms = v9_u16(p + 2 + i * step);
      if (step == 11)
        expand_lamps(p + 4 + i * step, steps[i].rgb);
      else
        memcpy(steps[i].rgb, p + 4 + i * step, NODE_LED_COUNT);
    }
    set_leds(steps[0].rgb);
    pattern_due = esp_timer_get_time() + (int64_t)steps[0].ms * 1000;
    break;
  default:
    ack(sequence, kind, 2);
    return;
  }
  ack(sequence, kind, 0);
}

static void tx_task(void *unused) {
  (void)unused;
  message m;
  uint8_t frame[V9_MAX_FRAME];
  uint16_t sequence = 0;
  for (;;) {
    bool have = xQueueReceive(urgent_queue, &m, 0) == pdTRUE;
    if (!have && atomic_load(&mic_wanted))
      have = xQueueReceive(audio_queue, &m, 0) == pdTRUE;
    if (have) {
      size_t n = v9_encode(frame, m.kind, sequence++, m.payload, m.length);
      int link = atomic_load(&active_link);
      if (link != LINK_USB) {
        uart_write_bytes(UART_NUM_0, frame, n);
        uart_wait_tx_done(UART_NUM_0, pdMS_TO_TICKS(50));
      }
      // Whole frame or nothing; never stall on a USB host that is not reading.
      if (link != LINK_UART && usb_serial_jtag_is_connected())
        usb_serial_jtag_write_bytes(frame, n, pdMS_TO_TICKS(20));
    } else
      vTaskDelay(pdMS_TO_TICKS(1));
  }
}

// One-pole high-pass (about 25 Hz at 16 kHz) on the 24-bit signal: the INMP441 output carries an
// offset that decays over seconds. Returns the sample as streamed, signed 16-bit.
typedef struct {
  float in, out;
  bool primed;
} dc_filter;
static inline int16_t dc_push(dc_filter *f, int32_t raw) {
  float in = (float)(raw >> 8);
  if (!f->primed) {
    f->in = in;
    f->out = 0;
    f->primed = true;
  }
  float out = in - f->in + 0.99f * f->out;
  f->in = in;
  f->out = out;
  int32_t value = (int32_t)lroundf(out / 256.0f);
  return (int16_t)(value > 32767 ? 32767 : value < -32768 ? -32768 : value);
}

static void microphone_task(void *unused) {
  (void)unused;
  // INMP441: 24-bit signed signal in a 32-bit left slot. Keep stereo clocks
  // (64 bit clocks per sample), discard the empty right slot, transmit s16le.
  static int32_t raw[NODE_AUDIO_SAMPLES * 2];
  static uint8_t payload[4 + NODE_AUDIO_SAMPLES * 2];
#if NODE_MICS == 2
  // The right microphone is a second port clocked by the first, so sample i of each is the same
  // instant. Stereo goes out as AUDIO2: u32 index, then left/right pairs, half a read per message.
  static int32_t raw2[NODE_AUDIO_SAMPLES * 2];
  static int16_t left[NODE_AUDIO_SAMPLES], right[NODE_AUDIO_SAMPLES];
  dc_filter filter2 = {0};
  // The last RING frames of both channels, indexed by the detector's sample count, so a knock's clip
  // can be cut when its verdict arrives 90 ms after the onset.
#define RING 2048
  static int16_t ring[RING * 2];
#endif
  uint32_t index = 0;
  // Discard the first 300 ms after enabling (the offset is largest then).
  size_t settle = 0;
  dc_filter filter = {0};
  bool running = false;
  knock_detector knock;
  knock_init(&knock, 0);
  for (;;) {
    const bool stream = atomic_load(&mic_wanted);
    const uint16_t threshold = (uint16_t)atomic_load(&knock_threshold);
    // "mic" in STATUS is streaming to the host; listening for knocks alone is not capture.
    if (!stream && atomic_load(&mic_active)) {
      atomic_store(&mic_active, false);
      xQueueReset(audio_queue);
    }
    if (!stream && !threshold) {
      if (running) {
        i2s_channel_disable(microphone);
#if NODE_MICS == 2
        if (microphone2)
          i2s_channel_disable(microphone2);
#endif
        running = false;
      }
      vTaskDelay(pdMS_TO_TICKS(10));
      continue;
    }
    if (!running) {
#if NODE_MICS == 2
      // The clocked port first: it waits for the clocks the other one is about to start.
      if (microphone2 && i2s_channel_enable(microphone2) != ESP_OK)
        atomic_fetch_add(&mic2_errors, 1);
#endif
      if (i2s_channel_enable(microphone) != ESP_OK) {
        atomic_store(&mic_wanted, false);
        atomic_store(&knock_threshold, 0);
        continue;
      }
      running = true;
      settle = NODE_RATE * 3 / 10;
      filter.primed = false;
#if NODE_MICS == 2
      filter2.primed = false;
#endif
      knock_init(&knock, threshold);
    }
    if (stream)
      atomic_store(&mic_active, true);
    if (knock.threshold != threshold) {
      knock.threshold = threshold;
      knock_reset(&knock);
    }
    size_t bytes = 0;
    if (i2s_channel_read(microphone, raw, sizeof(raw), &bytes, 100) != ESP_OK)
      continue;
    const int64_t read_at = esp_timer_get_time();
    const size_t samples = bytes / (2 * sizeof(int32_t));
#if NODE_MICS == 2
    size_t bytes2 = 0;
    if (!microphone2 || i2s_channel_read(microphone2, raw2, bytes, &bytes2, 100) != ESP_OK || bytes2 != bytes) {
      memset(raw2, 0, sizeof(raw2));
      atomic_fetch_add(&mic2_errors, 1);
    }
#endif
    {
      uint32_t peaks[4] = {0};
      for (size_t i = 0; i < samples * 2; i++) {
        int32_t a = raw[i] >> 16;
        a = a < 0 ? -a : a;
        if ((uint32_t)a > peaks[i & 1])
          peaks[i & 1] = (uint32_t)a;
#if NODE_MICS == 2
        int32_t b = raw2[i] >> 16;
        b = b < 0 ? -b : b;
        if ((uint32_t)b > peaks[2 + (i & 1)])
          peaks[2 + (i & 1)] = (uint32_t)b;
#endif
      }
      for (int i = 0; i < 4; i++)
        atomic_store(&slot_peaks[i], peaks[i]);
    }
    v9_put32(payload, index);
    knock_verdict verdict = KNOCK_NONE;
    for (size_t i = 0; i < samples; i++) {
      const int16_t value = dc_push(&filter, raw[i * 2]);
      v9_put16(payload + 4 + i * 2, (uint16_t)value);
#if NODE_MICS == 2
      left[i] = value;
      right[i] = dc_push(&filter2, raw2[i * 2]);
#endif
      if (!settle && threshold) {
#if NODE_MICS == 2
        const uint32_t slot = (knock.samples % RING) * 2;
        ring[slot] = value;
        ring[slot + 1] = right[i];
#endif
        knock_verdict v = knock_push(&knock, value);
        if (v != KNOCK_NONE)
          verdict = v;
      }
    }
    if (settle) {
      settle -= samples < settle ? samples : settle;
      continue;
    }
    if (verdict != KNOCK_NONE) {
      // The last sample of this read was captured at about read_at; count back to the onset.
      // (At most one verdict per read: a verdict comes 90 ms after its onset and the next onset
      // is 150 ms later.)
      knock_candidate c = {.at = read_at - (int64_t)(uint32_t)(knock.samples - knock.onset) * 1000000 / NODE_RATE,
                           .peak = knock.last_peak,
                           .hf = (uint8_t)knock.last_hf,
                           .verdict = (uint8_t)verdict};
#if NODE_MICS == 2
      // The clip starts CLIP_PRE frames before the onset; all of it is still in the ring (the
      // verdict is 1440 frames after the onset, the ring holds 2048).
      const uint32_t first = knock.onset - CLIP_PRE, have = knock.samples - first;
      c.clip_ok = microphone2 && verdict == KNOCK_HIT && have >= CLIP_FRAMES && have <= RING;
      if (c.clip_ok)
        for (int f = 0; f < CLIP_FRAMES; f++) {
          const uint32_t slot = ((first + (uint32_t)f) % RING) * 2;
          c.clip[f * 2] = ring[slot];
          c.clip[f * 2 + 1] = ring[slot + 1];
        }
#endif
      xQueueSend(knock_queue, &c, 0);
    }
    if (!stream)
      continue;
    if (atomic_load(&mic_wanted) && samples) {
#if NODE_MICS == 2
      if (atomic_load(&mic_stereo)) {
        for (size_t from = 0; from < samples; from += NODE_AUDIO_SAMPLES / 2) {
          const size_t count = samples - from < NODE_AUDIO_SAMPLES / 2 ? samples - from : NODE_AUDIO_SAMPLES / 2;
          v9_put32(payload, index + (uint32_t)from);
          for (size_t i = 0; i < count; i++) {
            v9_put16(payload + 4 + i * 4, (uint16_t)left[from + i]);
            v9_put16(payload + 6 + i * 4, (uint16_t)right[from + i]);
          }
          send_message(V9_AUDIO2, payload, 4 + count * 4, true);
        }
      } else
#endif
        send_message(V9_AUDIO, payload, 4 + samples * 2, true);
    }
    index += (uint32_t)samples;
  }
}

// Called by the main loop for each queued verdict, once no button edge can still arrive inside its
// guard window. A knock within KNOCK_GUARD_US of any raw button edge (press, release or bounce) is
// the switch itself and is dropped.
static void knock_decide(const knock_candidate *c) {
  knock_last_peak = c->peak;
  knock_last_hf = c->hf;
  if (c->verdict == KNOCK_SUSTAINED) {
    knock_sustained++;
    return;
  }
  if (c->verdict != KNOCK_HIT) {
    knock_bright++;
    return;
  }
  for (int i = 0; i < KNOCK_EDGES; i++) {
    int64_t edge = button_edges[i];
    if (edge && edge >= c->at - KNOCK_GUARD_US && edge <= c->at + KNOCK_GUARD_US) {
      knock_button++;
      return;
    }
  }
  if (!link_alive || !atomic_load(&knock_threshold))
    return;
  knock_sent++;
  uint8_t p[11];
  v9_put64(p, (uint64_t)c->at);
  v9_put16(p + 8, (uint16_t)(c->peak > 32767 ? 32767 : c->peak));
  p[10] = c->hf;
  send_message(V9_KNOCK, p, 11, false);
#if NODE_MICS == 2
  if (c->clip_ok) {
    static uint8_t clip[10 + CLIP_FRAMES * 4];
    v9_put64(clip, (uint64_t)c->at);
    clip[8] = CLIP_PRE;
    clip[9] = 2;
    for (int i = 0; i < CLIP_FRAMES * 2; i++)
      v9_put16(clip + 10 + i * 2, (uint16_t)c->clip[i]);
    send_message(V9_KNOCK_CLIP, clip, sizeof(clip), false);
  }
#endif
}

#if NODE_SENSOR
static uint8_t sensor_crc(const uint8_t *p) {
  uint8_t crc = 0xff;
  for (int i = 0; i < 2; i++) {
    crc ^= p[i];
    for (int b = 0; b < 8; b++)
      crc = (uint8_t)((crc << 1) ^ ((crc & 0x80) ? 0x31 : 0));
  }
  return crc;
}
static void sensor_task(void *unused) {
  (void)unused;
  i2c_master_bus_handle_t bus;
  i2c_master_bus_config_t bus_config = {.i2c_port = I2C_NUM_0,
                                        .sda_io_num = NODE_SDA,
                                        .scl_io_num = NODE_SCL,
                                        .clk_source = I2C_CLK_SRC_DEFAULT,
                                        .glitch_ignore_cnt = 7,
                                        .flags.enable_internal_pullup = true};
  esp_err_t bus_error = i2c_new_master_bus(&bus_config, &bus);
  if (bus_error != ESP_OK) {
    atomic_store(&sensor_error, bus_error);
    vTaskDelete(NULL);
  }
  // i2c_master_probe() reported phantom devices on undriven lines during
  // bring-up, so it is not used. Address both candidates directly and accept
  // a device only once it returns CRC-valid data.
  i2c_master_dev_handle_t sensor = NULL;
  int address = 0x44;
  for (;;) {
    if (!sensor) {
      i2c_device_config_t cfg = {.dev_addr_length = I2C_ADDR_BIT_LEN_7,
                                 .device_address = address,
                                 .scl_speed_hz = NODE_I2C_HZ};
      if (i2c_master_bus_add_device(bus, &cfg, &sensor) != ESP_OK)
        sensor = NULL;
    }
    if (sensor) {
      uint8_t request[2] = {0x24, 0x00}, result[6];
      esp_err_t err = i2c_master_transmit(sensor, request, 2, 100);
      vTaskDelay(pdMS_TO_TICKS(20));
      if (err == ESP_OK)
        err = i2c_master_receive(sensor, result, 6, 100);
      if (err == ESP_OK && sensor_crc(result) == result[2] && sensor_crc(result + 3) == result[5]) {
        float t = -45.0f + 175.0f * ((result[0] << 8) | result[1]) / 65535.0f;
        float rh = 100.0f * ((result[3] << 8) | result[4]) / 65535.0f;
        uint8_t p[16];
        v9_put64(p, esp_timer_get_time());
        memcpy(p + 8, &t, 4);
        memcpy(p + 12, &rh, 4);
        send_message(V9_SENSOR, p, 16, false);
        atomic_store(&sensor_address, address);
        atomic_fetch_add(&sensor_good, 1);
        atomic_store(&sensor_error, ESP_OK);
      } else {
        atomic_fetch_add(&sensor_bad, 1);
        atomic_store(&sensor_error, err != ESP_OK ? err : ESP_ERR_INVALID_CRC);
        if (err != ESP_OK) {
          i2c_master_bus_rm_device(sensor);
          sensor = NULL;
          atomic_store(&sensor_address, 0);
          address = address == 0x44 ? 0x45 : 0x44;
          vTaskDelay(pdMS_TO_TICKS(500));
          continue;
        }
      }
    }
    vTaskDelay(pdMS_TO_TICKS(5000));
  }
}
#endif

void app_main(void) {
  urgent_queue = xQueueCreate(24, sizeof(message));
  audio_queue = xQueueCreate(12, sizeof(message));
  knock_queue = xQueueCreate(4, sizeof(knock_candidate));
  if (!urgent_queue || !audio_queue || !knock_queue)
    abort();
  gpio_config_t button = {.pin_bit_mask = 1ULL << NODE_BUTTON,
                          .mode = GPIO_MODE_INPUT,
                          .pull_up_en = GPIO_PULLUP_ENABLE,
                          .pull_down_en = GPIO_PULLDOWN_DISABLE,
                          .intr_type = GPIO_INTR_DISABLE};
  gpio_config_t button_return = {.pin_bit_mask = 1ULL << NODE_BUTTON_RETURN,
                                 .mode = GPIO_MODE_OUTPUT,
                                 .pull_up_en = GPIO_PULLUP_DISABLE,
                                 .pull_down_en = GPIO_PULLDOWN_DISABLE,
                                 .intr_type = GPIO_INTR_DISABLE};
  ESP_ERROR_CHECK(gpio_config(&button_return));
  gpio_set_level(NODE_BUTTON_RETURN, 0);
  ESP_ERROR_CHECK(gpio_config(&button));
  esp_rom_delay_us(200);
  button_raw = button_stable = gpio_get_level(NODE_BUTTON) == 0;
  button_inhibit = button_stable;
  button_edge = esp_timer_get_time();
  setup_lights();
  setup_board_led();
  uart_config_t uart = {.baud_rate = NODE_BAUD,
                        .data_bits = UART_DATA_8_BITS,
                        .parity = UART_PARITY_DISABLE,
                        .stop_bits = UART_STOP_BITS_1,
                        .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
                        .source_clk = UART_SCLK_DEFAULT};
  ESP_ERROR_CHECK(uart_param_config(UART_NUM_0, &uart));
  ESP_ERROR_CHECK(
      uart_set_pin(UART_NUM_0, NODE_UART_TX, NODE_UART_RX, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE));
  ESP_ERROR_CHECK(uart_driver_install(UART_NUM_0, 4096, 0, 0, NULL, 0));
  usb_serial_jtag_driver_config_t usb = {.tx_buffer_size = 4096, .rx_buffer_size = 4096};
  ESP_ERROR_CHECK(usb_serial_jtag_driver_install(&usb));
  i2s_chan_config_t channel = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0, I2S_ROLE_MASTER);
  channel.dma_desc_num = 6;
  channel.dma_frame_num = NODE_AUDIO_SAMPLES;
  ESP_ERROR_CHECK(i2s_new_channel(&channel, NULL, &microphone));
  i2s_std_config_t mic = {
      .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(NODE_RATE),
      .slot_cfg =
          I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_32BIT, I2S_SLOT_MODE_STEREO),
      .gpio_cfg = {.mclk = I2S_GPIO_UNUSED,
                   .bclk = NODE_I2S_BCLK,
                   .ws = NODE_I2S_WS,
                   .dout = I2S_GPIO_UNUSED,
                   .din = NODE_I2S_DIN,
                   .invert_flags = {.mclk_inv = false, .bclk_inv = false, .ws_inv = false}}};
  ESP_ERROR_CHECK(i2s_channel_init_std_mode(microphone, &mic));
#if NODE_MICS == 2
  // The right microphone: a second port in slave mode on its own pins, and the first port's clock
  // outputs routed to those same pins as well. A failure here leaves a one-microphone node, reported
  // in STATUS, rather than a node that cannot start.
#ifdef NODE_MIC2_MASTER
  // Diagnostic build: the right microphone on its own clocks (not sample-aligned with the left).
  i2s_chan_config_t channel2 = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_1, I2S_ROLE_MASTER);
#else
  i2s_chan_config_t channel2 = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_1, I2S_ROLE_SLAVE);
#endif
  channel2.dma_desc_num = 6;
  channel2.dma_frame_num = NODE_AUDIO_SAMPLES;
  esp_err_t second = i2s_new_channel(&channel2, NULL, &microphone2);
  if (second == ESP_OK) {
    i2s_std_config_t mic2 = mic;
    mic2.gpio_cfg.bclk = NODE_I2S2_BCLK;
    mic2.gpio_cfg.ws = NODE_I2S2_WS;
    mic2.gpio_cfg.din = NODE_I2S2_DIN;
    second = i2s_channel_init_std_mode(microphone2, &mic2);
  }
#ifdef NODE_MIC2_MASTER
  if (second != ESP_OK) {
    microphone2 = NULL;
    atomic_store(&mic2_setup, second);
  }
#else
  if (second == ESP_OK) {
    gpio_set_direction(NODE_I2S2_BCLK, GPIO_MODE_INPUT_OUTPUT);
    esp_rom_gpio_connect_out_signal(NODE_I2S2_BCLK, i2s_periph_signal[0].m_rx_bck_sig, false, false);
    gpio_set_direction(NODE_I2S2_WS, GPIO_MODE_INPUT_OUTPUT);
    esp_rom_gpio_connect_out_signal(NODE_I2S2_WS, i2s_periph_signal[0].m_rx_ws_sig, false, false);
  } else {
    microphone2 = NULL;
    atomic_store(&mic2_setup, second);
  }
#endif
#endif
  xTaskCreate(tx_task, "v9_tx", 4096, NULL, 12, NULL);
  xTaskCreate(microphone_task, "v9_mic", 8192, NULL, 8, NULL);
#if NODE_SENSOR
  xTaskCreate(sensor_task, "v9_sensor", 4096, NULL, 3, NULL);
#endif
  status(V9_HELLO);
  uint8_t incoming[256];
  for (;;) {
    int64_t now = esp_timer_get_time();
    for (int link = 0; link < LINK_COUNT; link++) {
      v9_decoder *d = &decoders[link];
      if (d->length && now - last_byte[link] > 200000) {
        d->length = 0;
        d->errors++;
      }
      int n = link == LINK_UART ? uart_read_bytes(UART_NUM_0, incoming, sizeof(incoming), 0)
                                : usb_serial_jtag_read_bytes(incoming, sizeof(incoming), 0);
      if (n > 0) {
        v9_feed(d, incoming, n, command, (void *)(intptr_t)link);
        last_byte[link] = now;
      }
    }
    bool pressed = gpio_get_level(NODE_BUTTON) == 0;
    if (pressed != button_raw) {
      button_raw = pressed;
      button_edge = now;
      button_edges[button_edge_next++ % KNOCK_EDGES] = now;
    }
    static knock_candidate candidate; // with a clip it is about 720 bytes: keep it off the main task stack
    if (xQueuePeek(knock_queue, &candidate, 0) == pdTRUE && now >= candidate.at + KNOCK_GUARD_US &&
        xQueueReceive(knock_queue, &candidate, 0) == pdTRUE)
      knock_decide(&candidate);
    if (button_raw != button_stable && now - button_edge >= 8000) {
      button_stable = button_raw;
      if (!button_stable)
        button_inhibit = false;
      if (!button_inhibit) {
        uint8_t p[9];
        v9_put64(p, button_edge);
        p[8] = button_stable;
        send_message(V9_BUTTON, p, 9, false);
      }
    }
    if (link_alive && now - last_host > 3000000) {
      link_alive = false;
      atomic_store(&active_link, LINK_NONE);
      atomic_store(&mic_wanted, false);
      atomic_store(&knock_threshold, 0);
      reaction_armed = false;
      pattern_count = 0;
      lights_off();
      set_board_led(0, 0, 0);
      button_inhibit = button_stable;
    }
    if (reaction_armed && now >= reaction_due) {
      // light_index is one of the three logical lamps (left, middle, right) on every board.
      uint8_t nine[9] = {0}, values[NODE_LED_COUNT];
      memcpy(nine + reaction_led * 3, reaction_rgb, 3);
      expand_lamps(nine, values);
      set_leds(values);
      uint64_t activated = esp_timer_get_time();
      reaction_armed = false;
      uint8_t p[12];
      v9_put32(p, reaction_id);
      v9_put64(p + 4, activated);
      send_message(V9_CUE, p, 12, false);
    }
    if (pattern_count && now >= pattern_due) {
      pattern_index++;
      if (pattern_index >= pattern_count) {
        pattern_index = 0;
        if (--pattern_repeat == 0) {
          pattern_count = 0;
          lights_off();
        }
      }
      if (pattern_count) {
        set_leds(steps[pattern_index].rgb);
        pattern_due = now + (int64_t)steps[pattern_index].ms * 1000;
      }
    }
    if (now - last_status >= 1000000) {
      status(V9_STATUS);
      last_status = now;
    }
    vTaskDelay(pdMS_TO_TICKS(1));
  }
}
