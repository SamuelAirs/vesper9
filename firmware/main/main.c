#include "driver/gpio.h"
#include "driver/i2c_master.h"
#include "driver/i2s_std.h"
#include "driver/ledc.h"
#include "driver/mcpwm_prelude.h"
#include "driver/uart.h"
#include "driver/usb_serial_jtag.h"
#include "esp_err.h"
#include "esp_rom_sys.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "hardware.h"
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
typedef struct {
  int64_t at;
  int32_t peak;
  uint8_t hf;
  uint8_t verdict;
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
static mcpwm_cmpr_handle_t ninth_comparator;
static mcpwm_gen_handle_t ninth_generator;
static uint8_t leds[9] = {0};
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
  uint8_t rgb[9];
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
  memcpy(leds, values, 9);
  for (int i = 0; i < 8; i++) {
    uint32_t duty = (uint32_t)lroundf(powf(values[i] / 255.0f, 2.2f) * 1023.0f);
    ledc_set_duty(LEDC_LOW_SPEED_MODE, (ledc_channel_t)i, duty);
    ledc_update_duty(LEDC_LOW_SPEED_MODE, (ledc_channel_t)i);
  }
  if (values[8] == 0)
    mcpwm_generator_set_force_level(ninth_generator, 0, true);
  else if (values[8] == 255)
    mcpwm_generator_set_force_level(ninth_generator, 1, true);
  else {
    uint32_t duty = (uint32_t)lroundf(powf(values[8] / 255.0f, 2.2f) * 1000.0f);
    if (duty < 1)
      duty = 1;
    if (duty > 999)
      duty = 999;
    mcpwm_comparator_set_compare_value(ninth_comparator, duty);
    mcpwm_generator_set_force_level(ninth_generator, -1, true);
  }
}
static void lights_off(void) {
  uint8_t off[9] = {0};
  set_leds(off);
}

static void setup_lights(void) {
  ledc_timer_config_t timer = {.speed_mode = LEDC_LOW_SPEED_MODE,
                               .duty_resolution = LEDC_TIMER_10_BIT,
                               .timer_num = LEDC_TIMER_0,
                               .freq_hz = 4000,
                               .clk_cfg = LEDC_AUTO_CLK};
  ESP_ERROR_CHECK(ledc_timer_config(&timer));
  for (int i = 0; i < 8; i++) {
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
  mcpwm_oper_handle_t op;
  mcpwm_operator_config_t operator_config = {.group_id = 0};
  ESP_ERROR_CHECK(mcpwm_new_operator(&operator_config, &op));
  ESP_ERROR_CHECK(mcpwm_operator_connect_timer(op, pwm_timer));
  mcpwm_comparator_config_t comparator_config = {.flags.update_cmp_on_tez = true};
  ESP_ERROR_CHECK(mcpwm_new_comparator(op, &comparator_config, &ninth_comparator));
  mcpwm_generator_config_t generator_config = {.gen_gpio_num = NODE_LEDS[8]};
  ESP_ERROR_CHECK(mcpwm_new_generator(op, &generator_config, &ninth_generator));
  ESP_ERROR_CHECK(mcpwm_generator_set_action_on_timer_event(
      ninth_generator,
      MCPWM_GEN_TIMER_EVENT_ACTION(MCPWM_TIMER_DIRECTION_UP, MCPWM_TIMER_EVENT_EMPTY,
                                   MCPWM_GEN_ACTION_HIGH)));
  ESP_ERROR_CHECK(mcpwm_generator_set_action_on_compare_event(
      ninth_generator, MCPWM_GEN_COMPARE_EVENT_ACTION(MCPWM_TIMER_DIRECTION_UP, ninth_comparator,
                                                      MCPWM_GEN_ACTION_LOW)));
  ESP_ERROR_CHECK(mcpwm_generator_set_force_level(ninth_generator, 0, true));
  ESP_ERROR_CHECK(mcpwm_timer_enable(pwm_timer));
  ESP_ERROR_CHECK(mcpwm_timer_start_stop(pwm_timer, MCPWM_TIMER_START_NO_STOP));
  lights_off();
}

static void status(uint8_t kind) {
  char data[512];
  int link = atomic_load(&active_link);
  int n = snprintf(data, sizeof(data),
                   "{\"fw\":\"vesper-node-0.1.3\",\"link\":\"%s\",\"mic\":%s,\"button\":%s,\"audio_"
                   "drops\":%u,\"rx_crc\":%lu,\"sensor\":{\"addr\":%d,\"ok\":%u,\"fail\":%u,\"err\":%d},\"leds\":[%"
                   "u,%u,%u,%u,%u,%u,%u,%u,%u],\"knock\":{\"thr\":%u,\"n\":%lu,\"btn\":%lu,\"long\":%lu,"
                   "\"bright\":%lu,\"peak\":%ld,\"hf\":%ld}}",
                   link == LINK_USB ? "usb" : link == LINK_UART ? "uart" : "none",
                   atomic_load(&mic_active) ? "true" : "false", button_stable ? "true" : "false",
                   atomic_load(&audio_drops),
                   (unsigned long)(decoders[LINK_UART].errors + decoders[LINK_USB].errors),
                   atomic_load(&sensor_address), atomic_load(&sensor_good), atomic_load(&sensor_bad),
                   atomic_load(&sensor_error), leds[0], leds[1],
                   leds[2], leds[3], leds[4], leds[5], leds[6], leds[7], leds[8],
                   atomic_load(&knock_threshold), (unsigned long)knock_sent, (unsigned long)knock_button,
                   (unsigned long)knock_sustained, (unsigned long)knock_bright, (long)knock_last_peak,
                   (long)knock_last_hf);
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
  case V9_LEDS:
    if (n != 9) {
      ack(sequence, kind, 1);
      return;
    }
    pattern_count = 0;
    set_leds(p);
    break;
  case V9_MIC:
    if (n != 1 || p[0] > 1) {
      ack(sequence, kind, 1);
      return;
    }
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
  case V9_CANCEL:
    if (n) {
      ack(sequence, kind, 1);
      return;
    }
    reaction_armed = false;
    pattern_count = 0;
    break;
  case V9_PATTERN:
    if (n < 13 || p[0] < 1 || p[0] > 8 || p[1] < 1 || p[1] > 16 || n != 2 + p[1] * 11) {
      ack(sequence, kind, 1);
      return;
    }
    for (int i = 0; i < p[1]; i++) {
      uint16_t ms = v9_u16(p + 2 + i * 11);
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
      steps[i].ms = v9_u16(p + 2 + i * 11);
      memcpy(steps[i].rgb, p + 4 + i * 11, 9);
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

static void microphone_task(void *unused) {
  (void)unused;
  // INMP441: 24-bit signed signal in a 32-bit left slot. Keep stereo clocks
  // (64 bit clocks per sample), discard the empty right slot, transmit s16le.
  int32_t raw[NODE_AUDIO_SAMPLES * 2];
  uint8_t payload[4 + NODE_AUDIO_SAMPLES * 2];
  uint32_t index = 0;
  // The INMP441 output starts with a large offset that decays over seconds.
  // Discard the first 300 ms after enabling and remove DC with a one-pole
  // high-pass (about 25 Hz at 16 kHz) on the 24-bit signal.
  size_t settle = 0;
  float previous_in = 0, previous_out = 0;
  bool primed = false, running = false;
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
        running = false;
      }
      vTaskDelay(pdMS_TO_TICKS(10));
      continue;
    }
    if (!running) {
      if (i2s_channel_enable(microphone) != ESP_OK) {
        atomic_store(&mic_wanted, false);
        atomic_store(&knock_threshold, 0);
        continue;
      }
      running = true;
      settle = NODE_RATE * 3 / 10;
      primed = false;
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
    v9_put32(payload, index);
    knock_verdict verdict = KNOCK_NONE;
    for (size_t i = 0; i < samples; i++) {
      float in = (float)(raw[i * 2] >> 8);
      if (!primed) {
        previous_in = in;
        previous_out = 0;
        primed = true;
      }
      float out = in - previous_in + 0.99f * previous_out;
      previous_in = in;
      previous_out = out;
      int32_t value = (int32_t)lroundf(out / 256.0f);
      if (value > 32767)
        value = 32767;
      if (value < -32768)
        value = -32768;
      v9_put16(payload + 4 + i * 2, (uint16_t)(int16_t)value);
      if (!settle && threshold) {
        knock_verdict v = knock_push(&knock, (int16_t)value);
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
      xQueueSend(knock_queue, &c, 0);
    }
    if (!stream)
      continue;
    index += (uint32_t)samples;
    if (atomic_load(&mic_wanted) && samples)
      send_message(V9_AUDIO, payload, 4 + samples * 2, true);
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
}

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
  xTaskCreate(tx_task, "v9_tx", 4096, NULL, 12, NULL);
  xTaskCreate(microphone_task, "v9_mic", 8192, NULL, 8, NULL);
  xTaskCreate(sensor_task, "v9_sensor", 4096, NULL, 3, NULL);
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
    knock_candidate candidate;
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
      button_inhibit = button_stable;
    }
    if (reaction_armed && now >= reaction_due) {
      uint8_t values[9] = {0};
      memcpy(values + reaction_led * 3, reaction_rgb, 3);
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
