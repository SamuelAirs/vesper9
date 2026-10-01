// EPHEMERIS — a small offline almanac of the sky. An instrument: four pages (now, moon,
// orrery, year) computed on the device from the date, the time and a location the owner
// chooses. Nothing here touches the network.
//
// The astronomy is a set of pure functions of a time in milliseconds (UTC, as Date.now())
// and coordinates, exported so tests can check them against published references:
//   sunPosition / sunEvents  NOAA solar position and sunrise equations (Meeus, ch. 25/28
//                            series as published by NOAA GML), zenith 90.833 degrees.
//   newMoon / fullMoon       Meeus, Astronomical Algorithms ch. 49 (main periodic terms).
//   moonState                Meeus ch. 47/48 truncated: longitude series, phase angle.
//   planetPosition           JPL "Keplerian elements for approximate positions of the major
//                            planets", table 1 (1800-2050), with rates, plus precession.
//   seasons                  Meeus ch. 27 (mean times and 24 periodic terms).
// Timing: tick() runs once a second; each page is rebuilt only when what it shows can have
// changed (the clock every second, the moon every minute, the orrery and year each day).
// The lamps are written from tick(); the instrument owns no timers of its own.
import { LAMP, dim, lightsOff, spot, meter, fill } from "../engine/lightshow.js";
import { clamp, escapeHTML as esc } from "../engine/math.js";

const RAD = Math.PI / 180;
const DAY = 86400000;
const mod = (x, m) => ((x % m) + m) % m;
const sind = (x) => Math.sin(x * RAD);
const cosd = (x) => Math.cos(x * RAD);
const jdOf = (ms) => ms / DAY + 2440587.5;
const msOf = (jd) => (jd - 2440587.5) * DAY;
const centuries = (ms) => (jdOf(ms) - 2451545) / 36525;
// Delta T (TT - UT) in seconds, Espenak/Meeus polynomial for 2005-2050; the phase and season
// series give Terrestrial Time, so the result is shifted back to UT with it.
export const deltaT = (ms) => {
  // Observed values (IERS/USNO) at 2000, 2010, 2020 and 2026, then a gentle extrapolation; the
  // Espenak polynomial for 2005-2050 over-predicts today by several seconds.
  const y = new Date(ms).getUTCFullYear() + 0.5;
  const known = [[1990, 56.9], [2000, 63.8], [2010, 66.07], [2020, 69.36], [2026, 69.2]];
  if (y >= 2026) return 69.2 + 0.2 * (y - 2026);
  if (y <= 1990) return 56.9 + 0.8 * (y - 1990);
  for (let i = 1; i < known.length; i++)
    if (y <= known[i][0]) return known[i - 1][1] + ((known[i][1] - known[i - 1][1]) * (y - known[i - 1][0])) / (known[i][0] - known[i - 1][0]);
  return 69.2;
};

// ---------------------------------------------------------------- the Sun
// Apparent longitude (deg), declination (deg) and equation of time (minutes) at an instant.
export function sunPosition(ms) {
  const T = centuries(ms);
  const L0 = mod(280.46646 + T * (36000.76983 + T * 0.0003032), 360);
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = sind(M) * (1.914602 - T * (0.004817 + 0.000014 * T)) + sind(2 * M) * (0.019993 - 0.000101 * T) + sind(3 * M) * 0.000289;
  const omega = 125.04 - 1934.136 * T;
  const lambda = mod(L0 + C - 0.00569 - 0.00478 * sind(omega), 360);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * cosd(omega);
  const decl = Math.asin(sind(eps) * sind(lambda)) / RAD;
  const y = Math.tan((eps / 2) * RAD) ** 2;
  const eqt = 4 * (y * sind(2 * L0) - 2 * e * sind(M) + 4 * e * y * sind(M) * cosd(2 * L0)
    - 0.5 * y * y * sind(4 * L0) - 1.25 * e * e * sind(2 * M)) / RAD;
  return { lambda, decl, eqt };
}

// The solar day of a place: whole days of local mean solar time (UTC + lon/15 h), which
// is well defined at any longitude, including either side of the date line.
export const solarDay = (ms, lon) => Math.floor(ms / DAY + lon / 360);

// Sunrise, sunset and solar noon (ms) of solar day D at latitude/longitude (east positive).
// status: "normal", "polarDay" (the Sun stays up) or "polarNight" (it stays down).
export function sunEvents(D, lat, lon) {
  const la = clamp(Number.isFinite(lat) ? lat : 0, -89.99, 89.99);
  const lo = Number.isFinite(lon) ? lon : 0;
  const base = (D + 0.5 - lo / 360) * DAY; // mean solar noon
  let noon = base;
  for (let i = 0; i < 3; i++) noon = base - sunPosition(noon).eqt * 60000;
  const cosHA = (decl) => (cosd(90.833) - sind(la) * sind(decl)) / (cosd(la) * cosd(decl));
  const c0 = cosHA(sunPosition(noon).decl);
  if (c0 > 1) return { status: "polarNight", noon, rise: null, set: null, length: 0 };
  if (c0 < -1) return { status: "polarDay", noon, rise: null, set: null, length: DAY };
  const at = (sign) => {
    let t = noon;
    for (let i = 0; i < 4; i++) {
      const p = sunPosition(t);
      const ha = Math.acos(clamp(cosHA(p.decl), -1, 1)) / RAD;
      t = base - p.eqt * 60000 + sign * ha * 240000;
    }
    return t;
  };
  const rise = at(-1), set = at(1);
  return { status: "normal", noon, rise, set, length: set - rise };
}

// The next sunrise or sunset after ms, looking a few solar days around: {kind, at} or null
// (polar day or night with no event nearby).
export function nextSunEvent(ms, lat, lon) {
  const D = solarDay(ms, lon);
  let best = null;
  for (let d = D - 1; d <= D + 2; d++) {
    const ev = sunEvents(d, lat, lon);
    for (const [kind, at] of [["SUNRISE", ev.rise], ["SUNSET", ev.set]])
      if (at !== null && at > ms && (!best || at < best.at)) best = { kind, at };
  }
  return best;
}

// ---------------------------------------------------------------- the Moon
const E_TERMS_COMMON = (k, T, E, M, Mp, F, Om, first) => {
  const s = (x) => sind(x);
  return first
    + 0.00208 * E * E * s(2 * M) - 0.00111 * s(Mp - 2 * F) - 0.00057 * s(Mp + 2 * F)
    + 0.00056 * E * s(2 * Mp + M) - 0.00042 * s(3 * Mp) + 0.00042 * E * s(M + 2 * F)
    + 0.00038 * E * s(M - 2 * F) - 0.00024 * E * s(2 * Mp - M) - 0.00017 * s(Om)
    - 0.00007 * s(Mp + 2 * M) + 0.00004 * s(2 * Mp - 2 * F) + 0.00004 * s(3 * M)
    + 0.00003 * s(Mp + M - 2 * F) + 0.00003 * s(2 * Mp + 2 * F) - 0.00003 * s(Mp + M + 2 * F)
    + 0.00003 * s(Mp - M + 2 * F) - 0.00002 * s(Mp - M - 2 * F) - 0.00002 * s(3 * Mp + M)
    + 0.00002 * s(4 * Mp);
};
// Instant (ms, UT) of the lunation k: whole k is a new moon, k + 0.5 a full moon.
export function moonPhaseTime(k) {
  const T = k / 1236.85;
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;
  const M = mod(2.5534 + 29.1053567 * k - 0.0000014 * T * T, 360);
  const Mp = mod(201.5643 + 385.81693528 * k + 0.0107582 * T * T + 0.00001238 * T ** 3, 360);
  const F = mod(160.7108 + 390.67050284 * k - 0.0016118 * T * T - 0.00000227 * T ** 3, 360);
  const Om = mod(124.7746 - 1.56375588 * k + 0.0020672 * T * T + 0.00000215 * T ** 3, 360);
  const full = Math.abs(k - Math.round(k)) > 0.25;
  const first = full
    ? -0.40614 * sind(Mp) + 0.17302 * E * sind(M) + 0.01614 * sind(2 * Mp) + 0.01043 * sind(2 * F)
      + 0.00734 * E * sind(Mp - M) - 0.00515 * E * sind(Mp + M)
    : -0.4072 * sind(Mp) + 0.17241 * E * sind(M) + 0.01608 * sind(2 * Mp) + 0.01039 * sind(2 * F)
      + 0.00739 * E * sind(Mp - M) - 0.00514 * E * sind(Mp + M);
  const jde = 2451550.09766 + 29.530588861 * k + 0.00015437 * T * T - 0.00000015 * T ** 3 + 0.00000000073 * T ** 4
    + E_TERMS_COMMON(k, T, E, M, Mp, F, Om, first);
  const ms = msOf(jde);
  return ms - deltaT(ms) * 1000;
}
const lunationEstimate = (ms) => Math.floor((jdOf(ms) - 2451550.09766) / 29.530588861);
// The new moons and full moons around ms: last new moon, next new moon, next full moon.
export function moonEvents(ms) {
  const k0 = lunationEstimate(ms);
  let lastNew = null, nextNew = null, nextFull = null;
  for (let k = k0 - 2; k <= k0 + 3; k++) {
    const n = moonPhaseTime(k), f = moonPhaseTime(k + 0.5);
    if (n <= ms) lastNew = n;
    else if (nextNew === null) nextNew = n;
    if (f > ms && nextFull === null) nextFull = f;
  }
  return { lastNew, nextNew, nextFull };
}
// Moon's apparent longitude (deg), main terms of Meeus ch. 47, and the phase angle (ch. 48).
export function moonState(ms) {
  const T = centuries(ms);
  const Lp = 218.3164477 + 481267.88123421 * T;
  const D = mod(297.8501921 + 445267.1114034 * T, 360);
  const M = mod(357.5291092 + 35999.0502909 * T, 360);
  const Mp = mod(134.9633964 + 477198.8675055 * T, 360);
  const F = mod(93.272095 + 483202.0175233 * T, 360);
  const lon = mod(Lp + 6.288774 * sind(Mp) + 1.274027 * sind(2 * D - Mp) + 0.658314 * sind(2 * D)
    + 0.213618 * sind(2 * Mp) - 0.185116 * sind(M) - 0.114332 * sind(2 * F) + 0.058793 * sind(2 * D - 2 * Mp)
    + 0.057066 * sind(2 * D - M - Mp) + 0.053322 * sind(2 * D + Mp) + 0.045758 * sind(2 * D - M)
    - 0.040923 * sind(M - Mp) - 0.03472 * sind(D) - 0.030383 * sind(M + Mp), 360);
  const elongation = mod(lon - sunPosition(ms).lambda, 360); // 0 new, 90 first quarter, 180 full
  const i = 180 - D - 6.289 * sind(Mp) + 2.1 * sind(M) - 1.274 * sind(2 * D - Mp) - 0.658 * sind(2 * D)
    - 0.214 * sind(2 * Mp) - 0.11 * sind(D);
  const illumination = clamp((1 + cosd(i)) / 2, 0, 1);
  return { elongation, illumination, waxing: elongation < 180 };
}
export function phaseName(elongation) {
  const e = mod(elongation, 360);
  const names = [[0, "NEW MOON"], [90, "FIRST QUARTER"], [180, "FULL MOON"], [270, "LAST QUARTER"]];
  for (const [angle, name] of names) {
    const d = Math.abs(mod(e - angle + 180, 360) - 180);
    if (d < 6.5) return name; // within about half a day of the exact phase
  }
  if (e < 90) return "WAXING CRESCENT";
  if (e < 180) return "WAXING GIBBOUS";
  if (e < 270) return "WANING GIBBOUS";
  return "WANING CRESCENT";
}
// Age in days since the last new moon.
export const moonAge = (ms) => {
  const { lastNew } = moonEvents(ms);
  return lastNew === null ? 0 : (ms - lastNew) / DAY;
};

// ---------------------------------------------------------------- the planets
// JPL table 1 (1800-2050 AD): [a, da, e, de, I, dI, L, dL, varpi, dvarpi, Omega, dOmega]
// per Julian century from J2000; au and degrees.
export const PLANETS = [
  { id: "mercury", name: "MERCURY", tag: "ME", el: [0.38709927, 0.00000037, 0.20563593, 0.00001906, 7.00497902, -0.00594749, 252.2503235, 149472.67411175, 77.45779628, 0.16047689, 48.33076593, -0.12534081] },
  { id: "venus", name: "VENUS", tag: "VE", el: [0.72333566, 0.0000039, 0.00677672, -0.00004107, 3.39467605, -0.0007889, 181.9790995, 58517.81538729, 131.60246718, 0.00268329, 76.67984255, -0.27769418] },
  { id: "earth", name: "EARTH", tag: "EA", el: [1.00000261, 0.00000562, 0.01671123, -0.00004392, -0.00001531, -0.01294668, 100.46457166, 35999.37244981, 102.93768193, 0.32327364, 0, 0] },
  { id: "mars", name: "MARS", tag: "MA", el: [1.52371034, 0.00001847, 0.0933941, 0.00007882, 1.84969142, -0.00813131, -4.55343205, 19140.30268499, -23.94362959, 0.44441088, 49.55953891, -0.29257343] },
  { id: "jupiter", name: "JUPITER", tag: "JU", el: [5.202887, -0.00011607, 0.04838624, -0.00013253, 1.30439695, -0.00183714, 34.39644051, 3034.74612775, 14.72847983, 0.21252668, 100.47390909, 0.20469106] },
  { id: "saturn", name: "SATURN", tag: "SA", el: [9.53667594, -0.0012506, 0.05386179, -0.00050991, 2.48599187, 0.00193609, 49.95424423, 1222.49362201, 92.59887831, -0.41897216, 113.66242448, -0.28867794] },
  { id: "uranus", name: "URANUS", tag: "UR", el: [19.18916464, -0.00196176, 0.04725744, -0.00004397, 0.77263783, -0.00242939, 313.23810451, 428.48202785, 170.9542763, 0.40805281, 74.01692503, 0.04240589] },
  { id: "neptune", name: "NEPTUNE", tag: "NE", el: [30.06992276, 0.00026291, 0.00859048, 0.00005105, 1.77004347, 0.00035372, -55.12002969, 218.45945325, 44.96476227, -0.32241464, 131.78422574, -0.00508664] },
];
// Heliocentric ecliptic position of a planet: {x, y, z (au), lon (deg), r (au)}. By default
// the longitude is of date (the equinox of the date, as the Sun's longitude is); pass
// {j2000: true} for the fixed J2000 ecliptic that the JPL elements are given in.
export function planetPosition(planet, ms, options = {}) {
  const T = centuries(ms);
  const el = planet.el;
  const a = el[0] + el[1] * T, e = el[2] + el[3] * T, I = el[4] + el[5] * T;
  const L = el[6] + el[7] * T, wbar = el[8] + el[9] * T, Om = el[10] + el[11] * T;
  const w = wbar - Om;
  const M = mod(L - wbar, 360) * RAD;
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 12; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  let x = (cosd(w) * cosd(Om) - sind(w) * sind(Om) * cosd(I)) * xp + (-sind(w) * cosd(Om) - cosd(w) * sind(Om) * cosd(I)) * yp;
  let y = (cosd(w) * sind(Om) + sind(w) * cosd(Om) * cosd(I)) * xp + (-sind(w) * sind(Om) + cosd(w) * cosd(Om) * cosd(I)) * yp;
  const z = (sind(w) * sind(I)) * xp + (cosd(w) * sind(I)) * yp;
  if (!options.j2000) { // general precession in longitude, 1.396971 deg per century
    const p = 1.396971 * T;
    [x, y] = [x * cosd(p) - y * sind(p), x * sind(p) + y * cosd(p)];
  }
  return { x, y, z, lon: mod(Math.atan2(y, x) / RAD, 360), r: Math.hypot(x, y, z) };
}
// Every planet for the orrery plus where it stands against the Sun in the sky.
// elongation: signed degrees, positive east of the Sun (evening sky), from the geocentric
// longitudes. sky: EVENING, MORNING, ALL NIGHT (near opposition) or GLARE (too close to the Sun).
export function planetTable(ms) {
  const earth = planetPosition(PLANETS[2], ms);
  const sunLon = mod(Math.atan2(-earth.y, -earth.x) / RAD, 360);
  return PLANETS.map((planet) => {
    const p = planetPosition(planet, ms);
    if (planet.id === "earth") return { ...planet, ...p, elongation: 0, sky: "" };
    const geo = mod(Math.atan2(p.y - earth.y, p.x - earth.x) / RAD, 360);
    const s = mod(geo - sunLon + 180, 360) - 180;
    const naked = ["mercury", "venus", "mars", "jupiter", "saturn"].includes(planet.id);
    let sky = "TELESCOPE";
    if (naked) sky = Math.abs(s) < 15 ? "GLARE" : Math.abs(s) >= 150 ? "ALL NIGHT" : s > 0 ? "EVENING" : "MORNING";
    return { ...planet, ...p, elongation: s, sky };
  });
}

// ---------------------------------------------------------------- equinoxes and solstices
const SEASON_MEAN = [
  [2451623.80984, 365242.37404, 0.05169, -0.00411, -0.00057],
  [2451716.56767, 365241.62603, 0.00325, 0.00888, -0.0003],
  [2451810.21715, 365242.01767, -0.11575, 0.00337, 0.00078],
  [2451900.05952, 365242.74049, -0.06223, -0.00823, 0.00032],
];
const SEASON_TERMS = [
  [485, 324.96, 1934.136], [203, 337.23, 32964.467], [199, 342.08, 20.186], [182, 27.85, 445267.112],
  [156, 73.14, 45036.886], [136, 171.52, 22518.443], [77, 222.54, 65928.934], [74, 296.72, 3034.906],
  [70, 243.58, 9037.513], [58, 119.81, 33718.147], [52, 297.17, 150.678], [50, 21.02, 2281.226],
  [45, 247.54, 29929.562], [44, 325.15, 31555.956], [29, 60.93, 4443.417], [18, 155.12, 67555.328],
  [17, 288.79, 4562.452], [16, 198.04, 62894.029], [14, 199.76, 31436.921], [12, 95.39, 14577.848],
  [12, 287.11, 31931.756], [12, 320.81, 34777.259], [9, 227.73, 1222.114], [8, 15.45, 16859.074],
];
// [March equinox, June solstice, September equinox, December solstice] of a year, in ms (UT).
export function seasons(year) {
  const Y = (year - 2000) / 1000;
  return SEASON_MEAN.map((c) => {
    const jde0 = c[0] + Y * (c[1] + Y * (c[2] + Y * (c[3] + Y * c[4])));
    const T = (jde0 - 2451545) / 36525;
    const W = 35999.373 * T - 2.47;
    const dl = 1 + 0.0334 * cosd(W) + 0.0007 * cosd(2 * W);
    const S = SEASON_TERMS.reduce((sum, t) => sum + t[0] * cosd(t[1] + t[2] * T), 0);
    const ms = msOf(jde0 + (0.00001 * S) / dl);
    return ms - deltaT(ms) * 1000;
  });
}

// ---------------------------------------------------------------- formatting
const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const p2 = (n) => String(n).padStart(2, "0");
// Calendar fields of ms as seen with a UTC offset in minutes.
export function fields(ms, offsetMin) {
  const d = new Date(ms + offsetMin * 60000);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), wd: d.getUTCDay(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() };
}
const dayNumber = (f) => Math.floor(Date.UTC(f.y, f.mo, f.d) / DAY);
export const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
export const dayOfYear = (f) => Math.round((Date.UTC(f.y, f.mo, f.d) - Date.UTC(f.y, 0, 1)) / DAY) + 1;
export const offsetLabel = (offsetMin) => {
  const m = Math.abs(Math.round(offsetMin));
  return "UTC" + (offsetMin < 0 ? "-" : "+") + p2(Math.floor(m / 60)) + ":" + p2(m % 60);
};
export const durationText = (ms) => {
  const m = Math.round(Math.max(0, Number.isFinite(ms) ? ms : 0) / 60000);
  return Math.floor(m / 60) + "H " + p2(m % 60) + "M";
};
export const coordText = (lat, lon) =>
  Math.abs(lat) + " " + (lat < 0 ? "S" : "N") + " " + Math.abs(lon) + " " + (lon < 0 ? "W" : "E");

export const PRESETS = [
  { name: "MID-CONTINENT US", lat: 39, lon: -98 },
  { name: "ARCTIC NORWAY", lat: 70, lon: 25 },
  { name: "NORTHERN EUROPE", lat: 52, lon: 0 },
  { name: "SUBTROPICS / FLORIDA", lat: 26, lon: -80 },
  { name: "EQUATOR / ANDES", lat: 0, lon: -78 },
  { name: "SOUTHERN TEMPERATE", lat: -34, lon: 151 },
  { name: "ANTARCTICA", lat: -78, lon: 166 },
];
export function sanitizeLocation(value) {
  if (!value || typeof value !== "object") return null;
  const lat = Math.round(Number(value.lat)), lon = Math.round(Number(value.lon));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}
const PAGES = ["NOW", "MOON", "ORRERY", "YEAR"];

// ---------------------------------------------------------------- lamp frames
const WARM = [255, 150, 60];
const MOONLIGHT = [170, 190, 255];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * clamp(t, 0, 1)));
// Where the day stands: a warm spot from the left lamp (sunrise) to the right (sunset), deep
// blue at night, a half-hour of crossfade either side. Polar day keeps the warm spot going
// round the clock, polar night a faint blue.
export function lampsNow(ms, loc) {
  if (!loc) return lightsOff();
  const ev = sunEvents(solarDay(ms, loc.lon), loc.lat, loc.lon);
  const night = fill(LAMP.blue, 0.08);
  if (ev.status === "polarNight") return fill(LAMP.blue, 0.05);
  if (ev.status === "polarDay") return spot(mod(ms / DAY + loc.lon / 360, 1), dim(WARM, 0.22), 0.8);
  const p = (ms - ev.rise) / (ev.set - ev.rise);
  const outside = p < 0 ? (ev.rise - ms) / 60000 : p > 1 ? (ms - ev.set) / 60000 : 0;
  return mix(night, spot(clamp(p, 0, 1), dim(WARM, 0.28), 0.75), 1 - outside / 30);
}
// The Moon's illuminated fraction as a meter that fills from the lit side, as drawn.
export function lampsMoon(ms, south) {
  const s = moonState(ms);
  const litRight = s.waxing !== !!south;
  const m = meter(clamp(s.illumination, 0, 1), dim(MOONLIGHT, 0.3));
  return litRight ? [...m.slice(6, 9), ...m.slice(3, 6), ...m.slice(0, 3)] : m;
}
// Year page: how far through the year, as a quiet amber meter.
export function lampsYear(ms, offsetMin) {
  const f = fields(ms, offsetMin);
  const total = isLeap(f.y) ? 366 : 365;
  return meter(dayOfYear(f) / total, dim(LAMP.amber, 0.2));
}

// ---------------------------------------------------------------- drawings
// The Moon: a disc with the terminator as an elliptical arc. Lit limb on the right when
// waxing seen from the northern hemisphere; mirrored in the southern.
export function moonSvg(illumination, waxing, south) {
  const R = 66, cx = 80, cy = 80;
  const f = clamp(illumination, 0, 1);
  const litRight = waxing !== !!south;
  let lit = "";
  if (f > 0.992) lit = `<circle cx="${cx}" cy="${cy}" r="${R}" style="fill:var(--amber);fill-opacity:.8"/>`;
  else if (f > 0.008) {
    const rx = (R * Math.abs(1 - 2 * f)).toFixed(2);
    const limb = litRight ? 1 : 0;
    const term = f < 0.5 ? (litRight ? 0 : 1) : (litRight ? 1 : 0);
    lit = `<path d="M${cx} ${cy - R}A${R} ${R} 0 0 ${limb} ${cx} ${cy + R}A${rx} ${R} 0 0 ${term} ${cx} ${cy - R}Z" style="fill:var(--amber);fill-opacity:.8"/>`;
  }
  return `<svg viewBox="0 0 160 160" width="150" height="150" role="img" aria-label="The Moon, ${Math.round(f * 100)} percent lit" style="display:block;margin:0 auto">` +
    `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="currentColor" stroke-width="2"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${R + 7}" fill="none" stroke="currentColor" stroke-opacity=".35" stroke-dasharray="2 6"/>` + lit + `</svg>`;
}
// Schematic orrery radius: logarithmic, so Mercury and Neptune both fit.
export const orreryRadius = (au) => 20 + 15 * Math.log2(Math.max(au, 0.2) / 0.387);
export function orrerySvg(table) {
  const S = 276, c = S / 2;
  const orbits = table.map((p) => `<circle cx="${c}" cy="${c}" r="${orreryRadius(p.el[0]).toFixed(1)}" fill="none" stroke="currentColor" stroke-opacity=".28"/>`).join("");
  const bodies = table.map((p) => {
    const r = orreryRadius(p.r), a = p.lon * RAD;
    const x = c + r * Math.cos(a), y = c - r * Math.sin(a);
    const earth = p.id === "earth";
    const lx = c + (r + 15) * Math.cos(a), ly = c - (r + 15) * Math.sin(a) + 5;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${earth ? 5 : 3.5}" style="fill:${earth ? "var(--amber)" : "var(--phosphor)"}"/>` +
      `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" font-size="15" fill="currentColor">${p.tag}</text>`;
  }).join("");
  const ray = `<path d="M${c} ${c}H${S - 4}" stroke="currentColor" stroke-opacity=".3" stroke-dasharray="3 5"/>`;
  return `<svg viewBox="0 0 ${S} ${S}" width="238" height="238" role="img" aria-label="The planets seen from above the Sun" style="display:block;margin:0 auto;color:#94a58d;font-family:monospace">` +
    orbits + ray + `<circle cx="${c}" cy="${c}" r="6" fill="none" stroke="var(--amber)" stroke-width="2"/><circle cx="${c}" cy="${c}" r="2" style="fill:var(--amber)"/>` + bodies + `</svg>`;
}

// ---------------------------------------------------------------- the instrument
export class Ephemeris {
  constructor(ctx) {
    this.ctx = ctx;
    this.navigation = true;
    this.clock = () => Date.now();
    this.offset = (ms) => -new Date(ms).getTimezoneOffset(); // browser UTC offset, minutes
    this.zoneName = (ms) => {
      try {
        const part = new Intl.DateTimeFormat("en-US", { timeZoneName: "short" }).formatToParts(new Date(ms)).find((x) => x.type === "timeZoneName");
        return part ? part.value : "";
      } catch { return ""; }
    };
    this.page = 0;
    this.menu = "main";
    this.wiz = null;
    this.cache = { key: "", html: "" };
    this.loc = sanitizeLocation(ctx.progress?.());
    this.dead = false;
    this.buildActions();
    this.hint();
    this.refresh();
  }

  get south() { return !!this.loc && this.loc.lat < 0; }

  // ---- pages
  nowPage(ms) {
    const off = this.offset(ms), f = fields(ms, off);
    const zone = offsetLabel(off) + (this.zoneName(ms) ? " " + this.zoneName(ms) : "");
    const clock = `${p2(f.h)}:${p2(f.mi)}:${p2(f.s)}`;
    const total = isLeap(f.y) ? 366 : 365;
    const left = `<div class="utility-panel"><div class="data-label">LOCAL TIME / ${esc(zone)}</div><div class="big-readout">${clock}</div>` +
      `<p>${WEEKDAYS[f.wd]} ${f.d} ${MONTHS[f.mo]} ${f.y} / DAY ${dayOfYear(f)} OF ${total}</p></div>`;
    if (!this.loc) {
      return `<div class="readout-grid">${left}<div class="utility-panel"><div class="data-label">SUN</div><div class="big-readout">NO LOCATION</div>` +
        `<p class="recording-tag">SUN TIMES NEED A LOCATION.</p><p>CHOOSE SET LOCATION BELOW: A PRESET OR YOUR OWN LATITUDE AND LONGITUDE. THE MOON, ORRERY AND CLOCK WORK WITHOUT ONE.</p></div></div>`;
    }
    const { lat, lon } = this.loc;
    const todayNum = dayNumber(f);
    const ev = this.todaysSun(ms, off, todayNum);
    const t = (at) => {
      if (at === null) return "--:--";
      const g = fields(at + 30000, off), shift = dayNumber(g) - todayNum;
      return `${p2(g.h)}:${p2(g.mi)}` + (shift ? (shift > 0 ? " +1D" : " -1D") : "");
    };
    let head, label;
    const nxt = nextSunEvent(ms, lat, lon);
    if (nxt) { label = "NEXT: " + nxt.kind; head = "IN " + durationText(nxt.at - ms); }
    else if (ev.status === "polarDay") { label = "POLAR DAY"; head = "SUN STAYS UP"; }
    else { label = "POLAR NIGHT"; head = "SUN STAYS DOWN"; }
    const lengthText = ev.status === "normal" ? durationText(ev.length) : ev.status === "polarDay" ? "24H 00M" : "0H 00M";
    const rise = ev.status === "normal" ? t(ev.rise) : ev.status === "polarDay" ? "NO SUNRISE" : "NO SUNRISE";
    const set = ev.status === "normal" ? t(ev.set) : "NO SUNSET";
    const right = `<div class="utility-panel"><div class="data-label">${esc(label)} / ${esc(coordText(lat, lon))}</div><div class="big-readout">${esc(head)}</div>` +
      `<p>SUNRISE ${esc(rise)} / SUNSET ${esc(set)}</p><p>DAY LENGTH ${lengthText} / SOLAR NOON ${esc(t(ev.noon))}</p></div>`;
    return `<div class="readout-grid">${left}${right}</div>` + `<div class="utility-panel">${this.dayArc(ms, ev, off)}</div>`;
  }

  // The solar day shown as "today": the one whose solar noon falls on the viewer's calendar day,
  // which keeps the table steady through the night and sensible far from the viewer's own zone.
  todaysSun(ms, off, todayNum) {
    const { lat, lon } = this.loc;
    const D0 = solarDay(ms, lon);
    let first = null;
    for (const d of [D0, D0 - 1, D0 + 1]) {
      const ev = sunEvents(d, lat, lon);
      if (dayNumber(fields(ev.noon, off)) === todayNum) return ev;
      first = first || sunEvents(D0, lat, lon);
    }
    return first;
  }

  // The Sun's day as an arc over a horizon line: the Sun on the upper arc by day, on a
  // shallow lower arc by night.
  dayArc(ms, ev, off) {
    const W = 900, H = 82, cx = W / 2, hy = 44, rx = 330, ry = 34, ryn = 14;
    let marker = "";
    if (ev.status === "normal") {
      const day = ms >= ev.rise && ms <= ev.set;
      let x, y;
      if (day) {
        const p = (ms - ev.rise) / (ev.set - ev.rise);
        x = cx - rx * Math.cos(Math.PI * p); y = hy - ry * Math.sin(Math.PI * p);
      } else {
        const nightStart = ms > ev.set ? ev.set : ev.set - DAY, nightLen = DAY - ev.length;
        const q = clamp((ms - nightStart) / nightLen, 0, 1);
        x = cx + rx * Math.cos(Math.PI * q); y = hy + ryn * Math.sin(Math.PI * q);
      }
      marker = `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7" style="fill:${day ? "var(--amber)" : "none"};stroke:var(--amber);stroke-width:2"/>`;
    }
    const lab = (x, anchor, text) => `<text x="${x}" y="${H - 4}" text-anchor="${anchor}" font-size="15" fill="currentColor">${esc(text)}</text>`;
    const hm = (at) => (at === null ? "" : (() => { const g = fields(at + 30000, off); return `${p2(g.h)}:${p2(g.mi)}`; })());
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Where the Sun stands in its day" style="display:block;color:#94a58d;font-family:monospace">` +
      `<path d="M${cx - rx} ${hy}A${rx} ${ry} 0 0 1 ${cx + rx} ${hy}" fill="none" stroke="currentColor" stroke-width="2"/>` +
      `<path d="M${cx - rx} ${hy}A${rx} ${ryn} 0 0 0 ${cx + rx} ${hy}" fill="none" stroke="currentColor" stroke-opacity=".4" stroke-dasharray="3 5"/>` +
      `<path d="M${cx - rx - 70} ${hy}H${cx + rx + 70}" stroke="currentColor" stroke-opacity=".6"/>` +
      (ev.status === "normal" ? lab(cx - rx, "middle", "RISE " + hm(ev.rise)) + lab(cx, "middle", "NOON " + hm(ev.noon)) + lab(cx + rx, "middle", "SET " + hm(ev.set)) : "") +
      marker + `</svg>`;
  }

  moonPage(ms) {
    const off = this.offset(ms);
    const s = moonState(ms), ev = moonEvents(ms);
    const when = (at) => {
      if (at === null) return "--";
      const g = fields(at + 30000, off);
      return `${WEEKDAYS[g.wd]} ${g.d} ${MONTHS[g.mo]} ${p2(g.h)}:${p2(g.mi)}`;
    };
    const age = ev.lastNew === null ? 0 : (ms - ev.lastNew) / DAY;
    const view = this.loc ? (this.south ? "SOUTHERN" : "NORTHERN") + " HEMISPHERE" : "NORTHERN HEMISPHERE (NO LOCATION SET)";
    return `<div class="readout-grid"><div class="utility-panel">${moonSvg(s.illumination, s.waxing, this.south)}</div>` +
      `<div class="utility-panel"><div class="data-label">PHASE / VIEW FROM THE ${esc(view)}</div><div class="big-readout">${phaseName(s.elongation)}</div>` +
      `<p>ILLUMINATED ${Math.round(s.illumination * 100)}% / AGE ${age.toFixed(1)} DAYS</p>` +
      `<p>NEXT NEW MOON ${esc(when(ev.nextNew))}</p><p>NEXT FULL MOON ${esc(when(ev.nextFull))}</p></div></div>`;
  }

  orreryPage(ms) {
    const off = this.offset(ms), f = fields(ms, off);
    const table = planetTable(ms);
    const sky = (kind) => table.filter((p) => p.sky === kind).map((p) => p.name);
    const list = (names) => (names.length ? names.join(", ") : "NONE");
    const rows = table.map((p) =>
      `${p.name.padEnd(8)}${String(Math.round(p.lon)).padStart(3)}${String.fromCharCode(176)} ${p.r.toFixed(2).padStart(5)} AU ${p.id === "earth" ? "HOME" : p.sky}`).join("\n");
    return `<div class="readout-grid"><div class="utility-panel">${orrerySvg(table)}</div>` +
      `<div class="utility-panel"><div class="data-label">HELIOCENTRIC LONGITUDE / ${f.d} ${MONTHS[f.mo]} ${f.y}</div>` +
      `<p style="white-space:pre;margin:0 0 6px">${esc(rows)}</p>` +
      `<p>EVENING SKY: ${esc(list(sky("EVENING")))}</p><p>MORNING SKY: ${esc(list(sky("MORNING")))}</p>` +
      `<p>ALL NIGHT: ${esc(list(sky("ALL NIGHT")))} / IN GLARE: ${esc(list(sky("GLARE")))}</p></div></div>`;
  }

  yearPage(ms) {
    const off = this.offset(ms), f = fields(ms, off);
    const marks = seasons(f.y);
    const north = !this.south;
    const names = this.loc
      ? [north ? "SPRING BEGINS" : "AUTUMN BEGINS", north ? "SUMMER BEGINS" : "WINTER BEGINS", north ? "AUTUMN BEGINS" : "SPRING BEGINS", north ? "WINTER BEGINS" : "SUMMER BEGINS"]
      : ["", "", "", ""];
    const titles = ["MARCH EQUINOX", "JUNE SOLSTICE", "SEPTEMBER EQUINOX", "DECEMBER SOLSTICE"];
    const rows = marks.map((at, i) => {
      const g = fields(at + 30000, off);
      return `<p>${titles[i].padEnd(18)} ${WEEKDAYS[g.wd]} ${String(g.d).padStart(2)} ${MONTHS[g.mo]} ${p2(g.h)}:${p2(g.mi)}${names[i] ? "<br>" + esc(names[i]) : ""}</p>`;
    }).join("");
    const left = `<div class="utility-panel"><div class="data-label">${f.y} / TIMES IN ${esc(offsetLabel(off))}</div><div style="white-space:pre">${rows}</div></div>`;
    const right = this.loc
      ? `<div class="utility-panel">${this.yearCurve(ms, f, off, marks)}</div>`
      : `<div class="utility-panel"><div class="data-label">DAY LENGTH</div><div class="big-readout">NO LOCATION</div><p class="recording-tag">THE DAY-LENGTH CURVE NEEDS A LOCATION.</p><p>CHOOSE SET LOCATION BELOW.</p></div>`;
    return `<div class="readout-grid">${left}${right}</div>`;
  }

  yearCurve(ms, f, off, marks) {
    const { lat, lon } = this.loc;
    const W = 440, H = 214, x0 = 40, x1 = W - 12, y0 = 34, y1 = H - 40;
    const jan1 = Date.UTC(f.y, 0, 1), total = isLeap(f.y) ? 366 : 365;
    const lengthAt = (dayIdx) => {
      const t = jan1 + (dayIdx + 0.5) * DAY - lon * (DAY / 360); // local solar noon of that day
      return sunEvents(solarDay(t, lon), lat, lon).length / 3600000;
    };
    const pts = [];
    for (let d = 0; d <= total; d += 4) pts.push([d, lengthAt(Math.min(d, total - 1))]);
    const lo = Math.min(...pts.map((p) => p[1])), hi = Math.max(...pts.map((p) => p[1]));
    const span = Math.max(hi - lo, 0.5), mid = (hi + lo) / 2;
    const vmin = mid - span / 2, vmax = mid + span / 2;
    const X = (d) => x0 + ((x1 - x0) * d) / total, Y = (h) => y1 - ((y1 - y0) * (h - vmin)) / (vmax - vmin);
    const line = pts.map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(" ");
    const doy = dayOfYear(f) - 1, now = lengthAt(clamp(doy, 0, total - 1));
    const months = "JFMAMJJASOND".split("").map((m, i) => `<text x="${X(Date.UTC(f.y, i, 15) / DAY - jan1 / DAY).toFixed(1)}" y="${H - 18}" text-anchor="middle" font-size="14" fill="currentColor">${m}</text>`).join("");
    const ticks = marks.map((at) => `<path d="M${X((at - jan1) / DAY).toFixed(1)} ${y1}v6" stroke="var(--amber)" stroke-width="2"/>`).join("");
    const hh = (h) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)}H ${p2(m % 60)}M`; };
    const nx = X(doy + 0.5), ny = Y(now);
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Length of the day through the year, today marked" style="display:block;color:#94a58d;font-family:monospace">` +
      `<path d="M${x0} ${y0 - 4}V${y1}H${x1}" fill="none" stroke="currentColor" stroke-opacity=".6"/>` +
      `<text x="${x0 + 6}" y="14" font-size="15" fill="var(--amber)">TODAY ${esc(hh(now))}</text>` +
      `<text x="${x0 + 6}" y="32" font-size="14" fill="currentColor">MAX ${esc(hh(hi))} / MIN ${esc(hh(lo))}</text>` +
      `<polyline points="${line}" fill="none" stroke="var(--phosphor)" stroke-width="2"/>` +
      `<path d="M${nx.toFixed(1)} ${y0}V${y1}" stroke="var(--amber)" stroke-dasharray="3 4"/>` +
      `<circle cx="${nx.toFixed(1)}" cy="${ny.toFixed(1)}" r="5" style="fill:var(--amber)"/>` +
      ticks + months + `</svg>`;
  }

  // While the preset list is open the page is replaced by a short note, so that the whole
  // list of choices fits on the screen.
  presetPage() {
    const now = this.loc ? "NOW " + coordText(this.loc.lat, this.loc.lon) : "NO LOCATION SET";
    return `<div class="utility-panel"><div class="data-label">LOCATION PRESETS / ${esc(now)}</div>` +
      `<p>EACH PRESET IS A PLACE IN A LATITUDE BAND. IT IS NOT YOUR POSITION: THE INSTRUMENT HAS NO WAY TO KNOW WHERE IT IS. HOLD ON ONE TO USE IT.</p></div>`;
  }

  // ---- rendering and lamps
  pageKey(ms) {
    if (this.menu === "preset") return "preset";
    const loc = this.loc ? this.loc.lat + "," + this.loc.lon : "-";
    const off = this.offset(ms);
    const day = dayNumber(fields(ms, off));
    return [this.page, loc, off, this.page === 0 ? Math.floor(ms / 1000) : this.page === 1 ? Math.floor(ms / 60000) : day].join("|");
  }

  render(ms = this.clock()) {
    if (this.dead) return;
    if (this.wiz) return;
    const key = this.pageKey(ms);
    if (key === this.cache.key) return;
    let html = "";
    try {
      if (this.menu === "preset") html = this.presetPage();
      else html = [this.nowPage, this.moonPage, this.orreryPage, this.yearPage][this.page].call(this, ms);
    } catch (error) {
      html = '<div class="utility-panel"><h2>EPHEMERIS</h2><p>The almanac could not be computed for this date.</p></div>';
    }
    this.cache = { key, html };
    this.ctx.content(html);
  }

  updateLamps(ms = this.clock()) {
    if (this.dead) return;
    let values;
    try {
      if (this.wiz) values = lightsOff();
      else if (this.page === 0) values = lampsNow(ms, this.loc);
      else if (this.page === 1) values = lampsMoon(ms, this.south);
      else if (this.page === 3) values = lampsYear(ms, this.offset(ms));
      else values = lightsOff();
    } catch { values = lightsOff(); }
    this.ctx.leds(values);
  }

  refresh() {
    const ms = this.clock();
    this.render(ms);
    this.updateLamps(ms);
  }

  hint() {
    this.ctx.hint(this.wiz ? "Tap to advance. Hold and release to choose a digit."
      : `Page ${this.page + 1} of 4: ${PAGES[this.page]}. Tap to advance. Hold and release to choose.`);
  }

  setPage(page) {
    this.page = mod(page, PAGES.length);
    this.cache = { key: "", html: "" };
    this.hint();
    this.refresh();
  }

  // ---- location chooser
  begin() {
    const cur = this.loc || { lat: PRESETS[0].lat, lon: PRESETS[0].lon };
    const la = Math.abs(cur.lat), lo = Math.abs(cur.lon);
    this.wiz = { step: 0, ns: cur.lat < 0 ? "S" : "N", ew: cur.lon < 0 ? "W" : "E",
      d: [Math.floor(la / 10), la % 10, Math.floor(lo / 100), Math.floor(lo / 10) % 10, lo % 10] };
    this.hint();
    this.wizardView();
    this.refresh();
  }

  wizValue() {
    const w = this.wiz, [a, b, c, d, e] = w.d;
    const lat = (a * 10 + b) * (w.ns === "S" ? -1 : 1);
    const lon = (c * 100 + d * 10 + e) * (w.ew === "W" ? -1 : 1);
    return { lat: clamp(lat, -90, 90), lon: clamp(lon, -180, 180) };
  }

  wizardView() {
    const w = this.wiz, [a, b, c, d, e] = w.d;
    const mark = (i, text) => (w.step === i ? "[" + text + "]" : text);
    const display = `${mark(1, a)}${mark(2, b)} ${mark(0, w.ns)}  ${mark(4, c)}${mark(5, d)}${mark(6, e)} ${mark(3, w.ew)}`;
    const prompts = ["LATITUDE: NORTH OR SOUTH", "LATITUDE: TENS OF DEGREES", "LATITUDE: UNITS", "LONGITUDE: EAST OR WEST",
      "LONGITUDE: HUNDREDS", "LONGITUDE: TENS", "LONGITUDE: UNITS", "CHECK AND SAVE"];
    this.ctx.content(`<div class="utility-panel"><div class="data-label">SET LOCATION / NEAREST DEGREE</div><div class="big-readout">${esc(display)}</div>` +
      `<p class="recording-tag">${prompts[w.step]}</p><p>THE CHOICE LIST STARTS AT THE CURRENT VALUE. LATITUDE 0-90, LONGITUDE 0-180.</p></div>`);
    const items = [];
    const rotate = (list, current) => {
      const i = Math.max(0, list.indexOf(current));
      return [...list.slice(i), ...list.slice(0, i)];
    };
    const advance = (apply) => () => { apply(); w.step++; this.wizardView(); this.refresh(); };
    switch (w.step) {
      case 0: for (const v of rotate(["N", "S"], w.ns)) items.push({ id: "wiz-ns-" + v, label: v === "N" ? "NORTH" : "SOUTH", run: advance(() => { w.ns = v; }) }); break;
      case 1: for (const v of rotate([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], w.d[0])) items.push({ id: "wiz-lat10-" + v, label: "DIGIT / " + v, run: advance(() => { w.d[0] = v; if (v === 9) w.d[1] = 0; }) }); break;
      case 2: for (const v of rotate(a === 9 ? [0] : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], w.d[1])) items.push({ id: "wiz-lat1-" + v, label: "DIGIT / " + v, run: advance(() => { w.d[1] = v; }) }); break;
      case 3: for (const v of rotate(["E", "W"], w.ew)) items.push({ id: "wiz-ew-" + v, label: v === "E" ? "EAST" : "WEST", run: advance(() => { w.ew = v; }) }); break;
      case 4: for (const v of rotate([0, 1], w.d[2])) items.push({ id: "wiz-lon100-" + v, label: "DIGIT / " + v, run: advance(() => { w.d[2] = v; }) }); break;
      case 5: for (const v of rotate(c === 1 ? [0, 1, 2, 3, 4, 5, 6, 7, 8] : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], w.d[3])) items.push({ id: "wiz-lon10-" + v, label: "DIGIT / " + v, run: advance(() => { w.d[3] = v; if (c === 1 && v === 8) w.d[4] = 0; }) }); break;
      case 6: for (const v of rotate(c === 1 && d === 8 ? [0] : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], w.d[4])) items.push({ id: "wiz-lon1-" + v, label: "DIGIT / " + v, run: advance(() => { w.d[4] = v; }) }); break;
      default: {
        const v = this.wizValue();
        items.push({ id: "wiz-save", label: "SAVE / " + coordText(v.lat, v.lon), run: () => this.setLocation(v) });
      }
    }
    if (w.step > 0) items.push({ id: "wiz-back", label: "BACK / PREVIOUS DIGIT", run: () => { w.step--; this.wizardView(); this.refresh(); } });
    items.push({ id: "wiz-cancel", label: "CANCEL / KEEP " + (this.loc ? coordText(this.loc.lat, this.loc.lon) : "NO LOCATION"), run: () => this.endWizard() });
    this.ctx.actions(items);
  }

  endWizard() {
    this.wiz = null;
    this.menu = "main";
    this.cache = { key: "", html: "" };
    this.buildActions();
    this.hint();
    this.refresh();
  }

  setLocation(value) {
    const loc = sanitizeLocation(value);
    if (!loc) return;
    this.loc = loc;
    this.wiz = null;
    this.menu = "main";
    this.ctx.saveProgress({ schema: 1, lat: loc.lat, lon: loc.lon })?.catch?.(this.ctx.error);
    this.cache = { key: "", html: "" };
    this.buildActions();
    this.hint();
    this.refresh();
  }

  // ---- actions
  buildActions() {
    const ctx = this.ctx;
    let items;
    if (this.menu === "preset") {
      items = [
        ...PRESETS.map((p, i) => ({ id: "preset-" + i, label: `${p.name} / ${coordText(p.lat, p.lon)}`, run: () => this.setLocation(p) })),
        { id: "preset-back", label: "BACK", run: () => { this.menu = "main"; this.buildActions(); this.cache = { key: "", html: "" }; this.refresh(); } },
      ];
    } else {
      items = [
        { id: "next", label: "NEXT PAGE", run: () => this.setPage(this.page + 1) },
        { id: "previous", label: "PREVIOUS PAGE", run: () => this.setPage(this.page - 1) },
        { id: "preset", label: "LOCATION PRESETS →", run: () => { this.menu = "preset"; this.buildActions(); this.refresh(); } },
        { id: "custom", label: this.loc ? "SET LOCATION / " + coordText(this.loc.lat, this.loc.lon) : "SET LOCATION / LATITUDE, LONGITUDE", run: () => this.begin() },
        { id: "home", label: "RETURN TO DASHBOARD", run: ctx.home },
      ];
    }
    ctx.actions(items);
  }

  tick() { this.refresh(); }
  cancel() {}
  dispose() {
    this.dead = true;
    this.ctx.leds(lightsOff());
  }
}
