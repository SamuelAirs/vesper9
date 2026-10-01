export const TAU = Math.PI * 2;
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const wrapAngle = (a) => ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
export const overlaps = (a, b) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
// The murmur3 finaliser: every input bit changes about half of the output bits.
export const mixSeed = (n) => {
  let x = n >>> 0;
  x ^= x >>> 16; x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return x >>> 0;
};
export class Random {
  constructor(seed = Date.now()) {
    this.state = seed >>> 0 || 0x9e3779b9;
  }
  // The generator the host gives an app at launch. xorshift32 started from nearby seeds (two launches a
  // few milliseconds apart, as Date.now() gives) produces alike first outputs (chi-square 403 over 60000
  // consecutive-millisecond launches), so the seed is hashed and a few draws are discarded. An explicit
  // seed (tests) is mixed the same way, so it stays reproducible. Plain `new Random(seed)` is unchanged.
  static warm(seed) {
    const entropy = seed !== undefined ? seed
      : (Date.now() ^ Math.floor((typeof performance !== "undefined" ? performance.now() : 0) * 1000)
        ^ (typeof crypto !== "undefined" && crypto.getRandomValues ? crypto.getRandomValues(new Uint32Array(1))[0] : 0));
    const random = new Random(mixSeed(entropy));
    for (let i = 0; i < 8; i++) random.next();
    return random;
  }
  next() {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state / 4294967296;
  }
  range(a, b) {
    return a + (b - a) * this.next();
  }
  int(a, b) {
    return Math.floor(this.range(a, b + 1));
  }
  pick(items) {
    return items[this.int(0, items.length - 1)];
  }
}
export const formatTime = (seconds) => {
  const s = Math.max(0, Math.ceil(seconds));
  return (
    (s >= 3600 ? Math.floor(s / 3600) + ":" : "") +
    String(Math.floor(s / 60) % 60).padStart(2, "0") +
    ":" +
    String(s % 60).padStart(2, "0")
  );
};
// Readings are transported and stored in Celsius; only the display converts.
export const tempValue = (celsius, unit) =>
  unit === "F" ? (celsius * 9) / 5 + 32 : celsius;
export const tempUnit = (unit) => (unit === "F" ? "°F" : "°C");
export const formatTemp = (celsius, unit, digits = 1) =>
  tempValue(celsius, unit).toFixed(digits) + " " + tempUnit(unit);
// ---- Case temperature offset ----
// The sensor sits in a warm case, so the owner can subtract its self-heating. The offset is a
// setting (`tempOffset`, degrees Celsius, steps of 0.5) applied here, to a sensor reading only
// when it is displayed or derived from: stored history and the service stay raw. Other
// temperatures (the Pi's CPU) must keep using formatTemp, which never applies it.
export const OFFSET_MIN = -10, OFFSET_MAX = 5, OFFSET_STEP = 0.5;
export const clampOffset = (v) =>
  Number.isFinite(v) ? Math.max(OFFSET_MIN, Math.min(OFFSET_MAX, Math.round(v / OFFSET_STEP) * OFFSET_STEP)) + 0 : 0;
// The offset in force: from the settings object given, else from the host's own state
// (window.vesper, set by main.js), else zero.
export const tempOffset = (settings) => {
  const s = settings ?? globalThis.vesper?.state?.settings;
  return clampOffset(s && typeof s === "object" ? s.tempOffset : 0);
};
// A raw sensor temperature in Celsius, corrected. Non-numbers pass through unchanged.
export const correctTemp = (celsius, settings) =>
  Number.isFinite(celsius) ? celsius + tempOffset(settings) : celsius;
// A copy of a sensor reading with its temperature corrected (humidity is left as measured).
export const correctReading = (sensor, settings) =>
  sensor && typeof sensor === "object" && Number.isFinite(sensor.temperature)
    ? { ...sensor, temperature: correctTemp(sensor.temperature, settings), rawTemperature: sensor.temperature }
    : sensor;
// Display a raw sensor temperature with the offset applied.
export const formatSensorTemp = (celsius, unit, digits = 1, settings) =>
  formatTemp(correctTemp(celsius, settings), unit, digits);
// The offset as text in the display unit, with its sign: "-2.0 °C", "-3.6 °F".
export const formatOffset = (offsetC, unit) => {
  const v = tempDelta(clampOffset(offsetC), unit);
  return (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1) + " " + tempUnit(unit);
};
export const escapeHTML = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

// ---- Atmosphere helpers (pure; inputs in Celsius and percent relative humidity) ----

// A temperature difference (a rate or a span) converts without the +32 offset.
export const tempDelta = (celsiusDelta, unit) => (unit === "F" ? (celsiusDelta * 9) / 5 : celsiusDelta);

// Dew point, Magnus formula with the Sonntag (1990) / Alduchov & Eskridge (1996) constants:
// a = 17.625, b = 243.04 degC. Good to about 0.4 degC from -45 to 60 degC; needs RH > 0.
// Returns null outside that range or for non-numbers.
export function dewPoint(celsius, humidity) {
  if (!Number.isFinite(celsius) || !Number.isFinite(humidity)) return null;
  if (celsius < -45 || celsius > 60 || humidity <= 0 || humidity > 100) return null;
  const a = 17.625, b = 243.04;
  const gamma = Math.log(humidity / 100) + (a * celsius) / (b + celsius);
  return (b * gamma) / (a - gamma);
}

// Absolute humidity in g/m3: saturation vapour pressure from Bolton (1980),
// es = 6.112 exp(17.67 T / (T + 243.5)) hPa, then rho = 216.74 e / (273.15 + T) (ideal gas
// for water vapour). Valid -30 to 60 degC; null outside it.
export function absoluteHumidity(celsius, humidity) {
  if (!Number.isFinite(celsius) || !Number.isFinite(humidity)) return null;
  if (celsius < -30 || celsius > 60 || humidity < 0 || humidity > 100) return null;
  const saturation = 6.112 * Math.exp((17.67 * celsius) / (celsius + 243.5));
  return (216.74 * (saturation * humidity) / 100) / (273.15 + celsius);
}

// Heat index in Fahrenheit: the US National Weather Service procedure (Rothfusz 1990
// regression with the NWS low/high humidity adjustments, Steadman's simple formula first).
// Defined only for 80 F and above, 40 % RH and above, up to 120 F; null otherwise.
export function heatIndexF(fahrenheit, humidity) {
  if (!Number.isFinite(fahrenheit) || !Number.isFinite(humidity)) return null;
  if (fahrenheit < 80 || fahrenheit > 120 || humidity < 40 || humidity > 100) return null;
  const T = fahrenheit, R = humidity;
  const simple = 0.5 * (T + 61 + (T - 68) * 1.2 + R * 0.094);
  if ((simple + T) / 2 < 80) return simple;
  let hi = -42.379 + 2.04901523 * T + 10.14333127 * R - 0.22475541 * T * R - 0.00683783 * T * T
    - 0.05481717 * R * R + 0.00122874 * T * T * R + 0.00085282 * T * R * R - 0.00000199 * T * T * R * R;
  if (R < 13 && T <= 112) hi -= ((13 - R) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17);
  else if (R > 85 && T <= 87) hi += ((R - 85) / 10) * ((87 - T) / 5);
  return hi;
}

// "Feels like" in Celsius: the heat index where it is defined (above 26.7 C / 80 F and 40 % RH),
// otherwise the plain air temperature. `heat` says which one it is.
export function feelsLike(celsius, humidity) {
  if (!Number.isFinite(celsius)) return null;
  const hi = heatIndexF((celsius * 9) / 5 + 32, humidity);
  return hi === null ? { celsius, heat: false } : { celsius: ((hi - 32) * 5) / 9, heat: true };
}

// Indoor comfort by relative humidity: below 30 % dry (static, dry skin), 30-60 % comfortable
// (EPA indoor guidance 30-50 %, ASHRAE 55 and mould guidance cap at 60 %), 60-70 % humid, above
// very humid. Lower bound inclusive.
export function comfortBand(humidity) {
  if (!Number.isFinite(humidity)) return null;
  if (humidity < 30) return { id: "dry", label: "DRY", note: "BELOW 30 % RH" };
  if (humidity < 60) return { id: "comfortable", label: "COMFORTABLE", note: "30-60 % RH" };
  if (humidity < 70) return { id: "humid", label: "HUMID", note: "60-70 % RH" };
  return { id: "very-humid", label: "VERY HUMID", note: "ABOVE 70 % RH" };
}

// Minimum and maximum of `key` among rows (`at` in seconds) from `since` on, each with its time.
export function extremes(rows, key, since = -Infinity) {
  let min = null, max = null;
  for (const row of rows || []) {
    const v = row?.[key], at = row?.at;
    if (!Number.isFinite(v) || !Number.isFinite(at) || at < since) continue;
    if (!min || v < min.value) min = { value: v, at };
    if (!max || v > max.value) max = { value: v, at };
  }
  return min && { min, max };
}

// Least-squares slope of `key` over the last `windowSec` before `now`, in units per hour.
// Needs three samples spanning at least a third of the window; otherwise null. `steady` is the
// rate magnitude below which the arrow is level.
export function trend(rows, key, now, steady, windowSec = 3600) {
  const points = (rows || []).filter((r) => Number.isFinite(r?.[key]) && Number.isFinite(r?.at) && r.at >= now - windowSec && r.at <= now + 60);
  if (points.length < 3) return null;
  const t0 = points[0].at, span = points.at(-1).at - t0;
  if (span < windowSec / 3) return null;
  const n = points.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of points) { const x = (p.at - t0) / 3600, y = p[key]; sx += x; sy += y; sxx += x * x; sxy += x * y; }
  const denominator = n * sxx - sx * sx;
  if (denominator <= 0) return null;
  const rate = (n * sxy - sx * sy) / denominator;
  return { rate, arrow: Math.abs(rate) < steady ? "→" : rate > 0 ? "↑" : "↓", steady: Math.abs(rate) < steady };
}
