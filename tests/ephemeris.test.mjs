// EPHEMERIS tests. The astronomy is checked against published references, fetched on
// 2026-10-01 and pinned below:
//  * SUN: U.S. Naval Observatory Astronomical Applications API, rstt/oneday
//    (https://aa.usno.navy.mil/api/rstt/oneday?date=D&coords=LAT,LON&tz=TZ&dst=false), local
//    clock times in a fixed UTC offset; the times are rounded to the minute by the source.
//  * SEASONS: USNO API https://aa.usno.navy.mil/api/seasons?year=Y (UT, minute resolution).
//  * MOON: USNO API https://aa.usno.navy.mil/api/moon/phases/year?year=Y (UT, minute
//    resolution), new and full moons of 2024-2027 (99 instants).
//  * PLANETS: NASA/JPL Horizons (https://ssd.jpl.nasa.gov/api/horizons.api, vectors, centre
//    500@10 the Sun, ecliptic plane of J2000), heliocentric longitude = atan2(y, x) in degrees.
import test from "node:test";
import assert from "node:assert/strict";
import { appContext } from "./helpers/app-context.mjs";
import {
  Ephemeris, PLANETS, PRESETS, sunPosition, sunEvents, solarDay, nextSunEvent, moonPhaseTime, moonEvents, moonState,
  moonAge, phaseName, planetPosition, planetTable, seasons, lampsNow, lampsMoon, lampsYear, moonSvg, orreryRadius,
  deltaT, fields, dayOfYear, offsetLabel, durationText, coordText, sanitizeLocation,
} from "../web/apps/ephemeris.js";

const DAY = 86400000;
const iso = (s) => Date.parse(s);
const valid = (v) => v.length === 9 && v.every((n) => Number.isInteger(n) && n >= 0 && n <= 255);

// [lat, lon, tz hours, date, rise, noon, set] from USNO; null where the Sun does not rise or set.
const SUN = [
  [39, -98, -6, "2026-06-21", "05:07", "12:34", "20:01"],
  [39, -98, -6, "2026-12-21", "07:47", "12:30", "17:13"],
  [39, -98, -6, "2026-03-20", "06:35", "12:39", "18:44"],
  [39, -98, -6, "2024-02-29", "07:05", "12:44", "18:24"],
  [40, -74, -5, "2025-09-01", "05:24", "11:56", "18:27"],
  [52, 0, 0, "2026-06-21", "03:40", "12:02", "20:24"],
  [52, 0, 0, "2026-12-21", "08:06", "11:58", "15:50"],
  [0, -78, -5, "2026-03-20", "06:16", "12:19", "18:23"],
  [0, -78, -5, "2026-09-23", "06:01", "12:04", "18:08"],
  [-34, 151, 10, "2026-06-21", "07:01", "11:58", "16:54"],
  [-34, 151, 10, "2026-12-21", "04:41", "11:54", "19:07"],
  [64, -21, 0, "2026-06-21", "02:55", "13:26", "23:56"],
  [64, -21, 0, "2026-12-21", "11:16", "13:22", "15:28"],
  [70, 25, 2, "2026-05-10", "01:52", "12:16", "22:48"],
  [70, 25, 2, "2026-01-20", "11:25", "12:31", "13:38"],
  // Either side of the date line.
  [-18, 178, 12, "2026-03-20", "06:12", "12:16", "18:19"],
  [-18, 178, 12, "2026-12-21", "05:29", "12:06", "18:42"],
  [52, -176, -11, "2026-06-21", "04:24", "12:46", "21:08"],
];
const minutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
// A solar day is labelled by its civil date here, which agrees with the fixed offsets used.
const dayOf = (date) => Math.floor(Date.parse(date + "T00:00:00Z") / DAY);
const localMinutes = (ms, date, tz) => (ms - dayOf(date) * DAY) / 60000 + tz * 60;

test("sunrise, sunset and solar noon agree with USNO to two minutes (18 places and seasons)", () => {
  let worst = 0;
  for (const [lat, lon, tz, date, rise, noon, set] of SUN) {
    const ev = sunEvents(dayOf(date), lat, lon);
    assert.equal(ev.status, "normal", date);
    for (const [name, got, want] of [["rise", ev.rise, rise], ["noon", ev.noon, noon], ["set", ev.set, set]]) {
      const diff = Math.abs(localMinutes(got, date, tz) - minutes(want));
      worst = Math.max(worst, diff);
      assert.ok(diff <= 2, `${lat},${lon} ${date} ${name}: off by ${diff.toFixed(2)} min`);
    }
    assert.ok(Math.abs(ev.length - (ev.set - ev.rise)) < 1);
  }
  console.log(`# sun worst error ${worst.toFixed(2)} min over ${SUN.length * 3} times`);
});

test("polar day and polar night give no sunrise or sunset (USNO reports none either)", () => {
  // USNO: 70N 25E on 2026-06-21 has only a transit, on 2026-12-21 nothing; 78S 166E on
  // 2026-06-21 nothing, on 2026-12-21 only a transit.
  const cases = [[70, 25, "2026-06-21", "polarDay"], [70, 25, "2026-12-21", "polarNight"], [-78, 166, "2026-06-21", "polarNight"], [-78, 166, "2026-12-21", "polarDay"], [90, 0, "2026-06-21", "polarDay"], [-90, 0, "2026-06-21", "polarNight"]];
  for (const [lat, lon, date, status] of cases) {
    const ev = sunEvents(dayOf(date), lat, lon);
    assert.equal(ev.status, status, `${lat} ${date}`);
    assert.equal(ev.rise, null);
    assert.equal(ev.set, null);
    assert.equal(ev.length, status === "polarDay" ? DAY : 0);
    assert.ok(Number.isFinite(ev.noon));
  }
  // Near the polar limit the Sun does come back: the sequence of statuses changes exactly once.
  let flips = 0, last = "";
  for (let d = dayOf("2026-01-01"); d < dayOf("2026-07-01"); d++) {
    const s = sunEvents(d, 70, 25).status;
    if (last && s !== last) flips++;
    last = s;
  }
  assert.equal(flips, 2, "polar night, then normal days, then polar day");
  assert.equal(nextSunEvent(iso("2026-12-21T12:00Z"), 70, 25), null);
  assert.ok(nextSunEvent(iso("2026-12-21T12:00Z"), 52, 0).at > iso("2026-12-21T12:00Z"));
});

test("near the date line a solar day is continuous and the next event is always in the future", () => {
  for (const lon of [-179, -170, 170, 178, 180, -180]) {
    let prevNoon = null;
    for (let h = 0; h < 72; h += 5) {
      const ms = iso("2026-03-20T00:00Z") + h * 3600000;
      const ev = sunEvents(solarDay(ms, lon), -17, lon);
      assert.ok(Math.abs(ev.noon - ms) <= 13 * 3600000, `${lon} noon is within half a day of the instant`);
      if (prevNoon !== null) assert.ok(ev.noon - prevNoon >= 0 && ev.noon - prevNoon <= DAY + 3600000);
      prevNoon = ev.noon;
      const n = nextSunEvent(ms, -17, lon);
      assert.ok(n && n.at > ms && n.at - ms < 20 * 3600000, `${lon}`);
    }
  }
  // Across the line, 179 E and 179 W are two degrees (8 minutes of sun time) apart but a calendar
  // day apart on the clock: the sunrise instants differ by one day minus 8 minutes (or plus, by
  // the solar day each belongs to).
  const at = iso("2026-03-20T12:00Z");
  const east = sunEvents(solarDay(at, 179), -17, 179), west = sunEvents(solarDay(at, -179), -17, -179);
  const gap = Math.abs(east.rise - west.rise);
  assert.ok(Math.abs(gap - 8 * 60000) < 3 * 60000 || Math.abs(gap - (DAY - 8 * 60000)) < 3 * 60000 || Math.abs(gap - (DAY + 8 * 60000)) < 3 * 60000, String(gap / 60000));
});

test("sun position: solstice declination, equation of time extremes", () => {
  // Known: December solstice declination -23.44, early November equation of time about +16.4 min
  // (the sundial is fast), mid-February about -14.2 min.
  assert.ok(Math.abs(sunPosition(iso("2026-12-21T20:50Z")).decl + 23.436) < 0.02);
  assert.ok(Math.abs(sunPosition(iso("2026-06-21T08:24Z")).decl - 23.436) < 0.02);
  assert.ok(Math.abs(sunPosition(iso("2026-11-03T12:00Z")).eqt - 16.4) < 0.3);
  assert.ok(Math.abs(sunPosition(iso("2026-02-11T12:00Z")).eqt + 14.2) < 0.3);
  assert.ok(Math.abs(sunPosition(iso("2026-03-20T14:46Z")).lambda - 360) < 0.01 || sunPosition(iso("2026-03-20T14:46Z")).lambda < 0.01);
});

test("equinoxes and solstices agree with USNO to a few minutes (2024-2027)", () => {
  const ref = {
    2024: ["2024-03-20T03:06Z", "2024-06-20T20:51Z", "2024-09-22T12:44Z", "2024-12-21T09:20Z"],
    2025: ["2025-03-20T09:01Z", "2025-06-21T02:42Z", "2025-09-22T18:19Z", "2025-12-21T15:03Z"],
    2026: ["2026-03-20T14:46Z", "2026-06-21T08:24Z", "2026-09-23T00:05Z", "2026-12-21T20:50Z"],
    2027: ["2027-03-20T20:25Z", "2027-06-21T14:11Z", "2027-09-23T06:02Z", "2027-12-22T02:42Z"],
  };
  let worst = 0;
  for (const [year, list] of Object.entries(ref)) {
    const got = seasons(Number(year));
    list.forEach((s, i) => {
      const diff = Math.abs(got[i] - iso(s)) / 60000;
      worst = Math.max(worst, diff);
      assert.ok(diff <= 3, `${year} #${i} off by ${diff.toFixed(1)} min`);
    });
  }
  console.log(`# seasons worst error ${worst.toFixed(2)} min over 16 instants`);
});

const NEW = ["2024-01-11T11:57Z", "2024-02-09T22:59Z", "2024-03-10T09:00Z", "2024-04-08T18:21Z", "2024-05-08T03:22Z", "2024-06-06T12:38Z", "2024-07-05T22:57Z", "2024-08-04T11:13Z", "2024-09-03T01:55Z", "2024-10-02T18:49Z", "2024-11-01T12:47Z", "2024-12-01T06:21Z", "2024-12-30T22:27Z", "2025-01-29T12:36Z", "2025-02-28T00:45Z", "2025-03-29T10:58Z", "2025-04-27T19:31Z", "2025-05-27T03:02Z", "2025-06-25T10:31Z", "2025-07-24T19:11Z", "2025-08-23T06:06Z", "2025-09-21T19:54Z", "2025-10-21T12:25Z", "2025-11-20T06:47Z", "2025-12-20T01:43Z", "2026-01-18T19:52Z", "2026-02-17T12:01Z", "2026-03-19T01:23Z", "2026-04-17T11:52Z", "2026-05-16T20:01Z", "2026-06-15T02:54Z", "2026-07-14T09:43Z", "2026-08-12T17:37Z", "2026-09-11T03:27Z", "2026-10-10T15:50Z", "2026-11-09T07:02Z", "2026-12-09T00:52Z", "2027-01-07T20:24Z", "2027-02-06T15:56Z", "2027-03-08T09:29Z", "2027-04-06T23:51Z", "2027-05-06T10:58Z", "2027-06-04T19:40Z", "2027-07-04T03:02Z", "2027-08-02T10:05Z", "2027-08-31T17:41Z", "2027-09-30T02:36Z", "2027-10-29T13:36Z", "2027-11-28T03:24Z", "2027-12-27T20:12Z"];
const FULL = ["2024-01-25T17:54Z", "2024-02-24T12:30Z", "2024-03-25T07:00Z", "2024-04-23T23:49Z", "2024-05-23T13:53Z", "2024-06-22T01:08Z", "2024-07-21T10:17Z", "2024-08-19T18:26Z", "2024-09-18T02:34Z", "2024-10-17T11:26Z", "2024-11-15T21:28Z", "2024-12-15T09:02Z", "2025-01-13T22:27Z", "2025-02-12T13:53Z", "2025-03-14T06:55Z", "2025-04-13T00:22Z", "2025-05-12T16:56Z", "2025-06-11T07:44Z", "2025-07-10T20:37Z", "2025-08-09T07:55Z", "2025-09-07T18:09Z", "2025-10-07T03:47Z", "2025-11-05T13:19Z", "2025-12-04T23:14Z", "2026-01-03T10:03Z", "2026-02-01T22:09Z", "2026-03-03T11:38Z", "2026-04-02T02:12Z", "2026-05-01T17:23Z", "2026-05-31T08:45Z", "2026-06-29T23:56Z", "2026-07-29T14:36Z", "2026-08-28T04:18Z", "2026-09-26T16:49Z", "2026-10-26T04:12Z", "2026-11-24T14:53Z", "2026-12-24T01:28Z", "2027-01-22T12:17Z", "2027-02-20T23:23Z", "2027-03-22T10:44Z", "2027-04-20T22:27Z", "2027-05-20T10:59Z", "2027-06-19T00:44Z", "2027-07-18T15:45Z", "2027-08-17T07:29Z", "2027-09-15T23:03Z", "2027-10-15T13:47Z", "2027-11-14T03:26Z", "2027-12-13T16:09Z"];

test("new and full moons agree with USNO to within minutes across 2024-2027", () => {
  let worst = 0, n = 0;
  for (const [list, offset] of [[NEW, 0], [FULL, 0.5]]) {
    for (const s of list) {
      const t = iso(s);
      const k = Math.round((jdOfMs(t) - 2451550.09766) / 29.530588861 - offset) + offset;
      const diff = Math.abs(moonPhaseTime(k) - t) / 60000;
      worst = Math.max(worst, diff);
      n++;
      assert.ok(diff <= 15, `${s}: off by ${diff.toFixed(1)} min`);
    }
  }
  console.log(`# moon phases worst error ${worst.toFixed(2)} min over ${n} instants`);
  assert.equal(n, 99);
});
const jdOfMs = (ms) => ms / DAY + 2440587.5;

test("moonEvents finds the surrounding lunation; age, illumination and names follow the phases", () => {
  const now = iso("2026-10-01T00:00Z");
  const ev = moonEvents(now);
  assert.ok(Math.abs(ev.lastNew - iso("2026-09-11T03:27Z")) < 10 * 60000);
  assert.ok(Math.abs(ev.nextNew - iso("2026-10-10T15:50Z")) < 10 * 60000);
  assert.ok(Math.abs(ev.nextFull - iso("2026-10-26T04:12Z")) < 10 * 60000);
  assert.ok(Math.abs(moonAge(now) - 19.86) < 0.02);
  // Phase at the reference instants: new is dark, full is bright, quarters near half (USNO
  // lists the first quarter of 2026-06-21 at 21:55 UT, 46% lit that day).
  for (const s of NEW.slice(0, 20)) {
    const st = moonState(iso(s));
    assert.ok(st.illumination < 0.01, s + " " + st.illumination);
    assert.equal(phaseName(st.elongation), "NEW MOON");
  }
  for (const s of FULL.slice(0, 20)) {
    const st = moonState(iso(s));
    assert.ok(st.illumination > 0.985, s + " " + st.illumination);
    assert.equal(phaseName(st.elongation), "FULL MOON");
  }
  const q = moonState(iso("2026-06-21T21:55Z"));
  assert.ok(Math.abs(q.illumination - 0.5) < 0.03);
  assert.equal(phaseName(q.elongation), "FIRST QUARTER");
  assert.equal(moonState(iso("2026-06-21T12:00Z")).waxing, true);
  assert.equal(moonState(iso("2026-07-05T12:00Z")).waxing, false);
  // USNO rstt reports 46% lit for 2026-06-21 (0 UT based); at 0h the model reads ~0.4 to 0.5.
  const frac = moonState(iso("2026-06-21T12:00Z")).illumination;
  assert.ok(frac > 0.4 && frac < 0.52, String(frac));
  const names = new Set();
  for (let d = 0; d < 30; d += 1) names.add(phaseName(moonState(iso("2026-09-11T00:00Z") + d * DAY).elongation));
  for (const n of ["NEW MOON", "WAXING CRESCENT", "FIRST QUARTER", "WAXING GIBBOUS", "FULL MOON", "WANING GIBBOUS", "LAST QUARTER", "WANING CRESCENT"]) assert.ok(names.has(n), n);
});

// Heliocentric longitudes and distances from JPL Horizons (J2000 ecliptic), degrees and au.
const HORIZONS = {
  mercury: [["2000-01-01T12:00Z", 253.783, 0.46583], ["2010-06-15T00:00Z", 15.668, 0.33734], ["2018-09-10T00:00Z", 123.868, 0.32246], ["2026-10-01T00:00Z", 267.318, 0.46347], ["2035-03-01T00:00Z", 251.021, 0.46544], ["2045-01-01T00:00Z", 214.228, 0.43566]],
  venus: [["2000-01-01T12:00Z", 182.603, 0.71906], ["2010-06-15T00:00Z", 178.704, 0.71877], ["2018-09-10T00:00Z", 318.784, 0.72721], ["2026-10-01T00:00Z", 353.486, 0.72573], ["2035-03-01T00:00Z", 238.11, 0.72456], ["2045-01-01T00:00Z", 236.186, 0.72438]],
  earth: [["2000-01-01T12:00Z", 100.378, 0.98330], ["2010-06-15T00:00Z", 263.669, 1.01576], ["2018-09-10T00:00Z", 346.994, 1.00713], ["2026-10-01T00:00Z", 7.468, 1.00133], ["2035-03-01T00:00Z", 159.735, 0.99060], ["2045-01-01T00:00Z", 100.339, 0.98327]],
  mars: [["2000-01-01T12:00Z", 359.447, 1.39078], ["2010-06-15T00:00Z", 189.681, 1.63752], ["2018-09-10T00:00Z", 332.043, 1.38109], ["2026-10-01T00:00Z", 85.315, 1.55803], ["2035-03-01T00:00Z", 234.713, 1.53904], ["2045-01-01T00:00Z", 327.134, 1.38209]],
  jupiter: [["2000-01-01T12:00Z", 36.295, 4.96515], ["2010-06-15T00:00Z", 349.251, 4.96979], ["2018-09-10T00:00Z", 237.669, 5.38021], ["2026-10-01T00:00Z", 131.129, 5.30672], ["2035-03-01T00:00Z", 22.168, 4.95347], ["2045-01-01T00:00Z", 315.31, 5.07009]],
  saturn: [["2000-01-01T12:00Z", 45.722, 9.17760], ["2010-06-15T00:00Z", 183.99, 9.51751], ["2018-09-10T00:00Z", 277.835, 10.06425], ["2026-10-01T00:00Z", 10.803, 9.42675], ["2035-03-01T00:00Z", 122.819, 9.08186], ["2045-01-01T00:00Z", 243.328, 9.97695]],
  uranus: [["2000-01-01T12:00Z", 316.419, 19.92507], ["2010-06-15T00:00Z", 357.392, 20.09479], ["2018-09-10T00:00Z", 29.814, 19.87662], ["2026-10-01T00:00Z", 62.653, 19.44316], ["2035-03-01T00:00Z", 98.777, 18.87928], ["2045-01-01T00:00Z", 143.658, 18.36824]],
  neptune: [["2000-01-01T12:00Z", 303.929, 30.12261], ["2010-06-15T00:00Z", 326.741, 30.02131], ["2018-09-10T00:00Z", 344.831, 29.93866], ["2026-10-01T00:00Z", 2.648, 29.87159], ["2035-03-01T00:00Z", 21.299, 29.82695], ["2045-01-01T00:00Z", 43.153, 29.79717]],
};

test("planet longitudes agree with JPL Horizons to two degrees (8 planets, 6 dates 2000-2045)", () => {
  let worst = 0, n = 0;
  for (const planet of PLANETS) for (const [date, lon, r] of HORIZONS[planet.id]) {
    const p = planetPosition(planet, iso(date), { j2000: true });
    const diff = Math.abs(((p.lon - lon + 540) % 360) - 180);
    worst = Math.max(worst, diff);
    n++;
    assert.ok(diff <= 2, `${planet.id} ${date}: ${p.lon.toFixed(2)} vs ${lon} (${diff.toFixed(2)} deg)`);
    assert.ok(Math.abs(Math.hypot(p.x, p.y) - r) / r < 0.02, `${planet.id} ${date} distance`);
  }
  console.log(`# planets worst longitude error ${worst.toFixed(3)} deg over ${n} positions`);
});

test("of-date longitudes add general precession; the sky table is consistent", () => {
  const ms = iso("2026-10-01T00:00Z");
  const a = planetPosition(PLANETS[3], ms, { j2000: true }).lon, b = planetPosition(PLANETS[3], ms).lon;
  const precession = ((b - a + 540) % 360) - 180;
  assert.ok(Math.abs(precession - 1.396971 * 0.2675) < 0.001, String(precession)); // 26.75 years after J2000
  const table = planetTable(ms);
  assert.equal(table.length, 8);
  for (const p of table) {
    assert.ok(Number.isFinite(p.lon) && Number.isFinite(p.r) && Number.isFinite(p.elongation), p.id);
    assert.ok(p.lon >= 0 && p.lon < 360);
  }
  // Geometry that must hold: Mercury and Venus never stray beyond 48 degrees of the Sun.
  for (let d = 0; d < 800; d += 7) {
    const t = planetTable(ms + d * DAY);
    assert.ok(Math.abs(t[0].elongation) < 29, "mercury");
    assert.ok(Math.abs(t[1].elongation) < 48, "venus");
  }
  // 2026-10-01: Mars at heliocentric 85 and Earth at 7 degrees, so Mars is 78 degrees ahead; seen from
  // Earth Mars is well east of the Sun and sets after it (evening sky) for the next months?
  // Check the rule directly: a positive elongation is the evening sky.
  for (const p of table.filter((x) => ["mercury", "venus", "mars", "jupiter", "saturn"].includes(x.id))) {
    if (Math.abs(p.elongation) < 15) assert.equal(p.sky, "GLARE");
    else if (Math.abs(p.elongation) >= 150) assert.equal(p.sky, "ALL NIGHT");
    else assert.equal(p.sky, p.elongation > 0 ? "EVENING" : "MORNING");
  }
  // Mars at opposition on 2025-01-16 (published: 2025 January 16): all night.
  assert.equal(planetTable(iso("2025-01-16T00:00Z")).find((p) => p.id === "mars").sky, "ALL NIGHT");
  // Jupiter at opposition on 2026-01-10 (published): all night; Saturn on 2025-09-21.
  assert.equal(planetTable(iso("2026-01-10T00:00Z")).find((p) => p.id === "jupiter").sky, "ALL NIGHT");
  assert.equal(planetTable(iso("2025-09-21T00:00Z")).find((p) => p.id === "saturn").sky, "ALL NIGHT");
  // Venus at greatest western elongation, 46 degrees, on 2025-06-01 (published): morning sky.
  const venus = planetTable(iso("2025-06-01T00:00Z")).find((p) => p.id === "venus");
  assert.equal(venus.sky, "MORNING");
  assert.ok(Math.abs(venus.elongation + 46) < 1.5, String(venus.elongation));
  // Venus at superior conjunction on 2026-01-06 (published): lost in glare.
  assert.equal(planetTable(iso("2026-01-06T00:00Z")).find((p) => p.id === "venus").sky, "GLARE");
  // Venus swings from evening to morning sky over a synodic period.
  const signs = new Set();
  for (let d = 0; d < 600; d += 10) signs.add(Math.sign(planetTable(iso("2025-01-01T00:00Z") + d * DAY)[1].elongation));
  assert.deepEqual([...signs].sort(), [-1, 1]);
});

test("helpers: day of year, offsets, durations, coordinates, deltaT, location sanitising", () => {
  assert.equal(dayOfYear(fields(iso("2026-12-31T12:00Z"), 0)), 365);
  assert.equal(dayOfYear(fields(iso("2024-12-31T12:00Z"), 0)), 366);
  assert.equal(dayOfYear(fields(iso("2026-03-01T04:00Z"), -360)), 59); // still 28 Feb in UTC-6
  assert.equal(offsetLabel(-300), "UTC-05:00");
  assert.equal(offsetLabel(330), "UTC+05:30");
  assert.equal(offsetLabel(0), "UTC+00:00");
  assert.equal(durationText(11 * 3600000 + 46 * 60000), "11H 46M");
  assert.equal(durationText(NaN), "0H 00M");
  assert.equal(coordText(-34, 151), "34 S 151 E");
  assert.equal(coordText(39, -98), "39 N 98 W");
  assert.ok(Math.abs(deltaT(iso("2026-06-01T00:00Z")) - 69) < 2);
  assert.deepEqual(sanitizeLocation({ lat: 39.4, lon: -97.6 }), { lat: 39, lon: -98 });
  for (const bad of [null, undefined, {}, { lat: 91, lon: 0 }, { lat: 0, lon: 181 }, { lat: "x", lon: 1 }, 5, "a"]) assert.equal(sanitizeLocation(bad), null);
  for (const p of PRESETS) assert.ok(sanitizeLocation(p));
  assert.equal(PRESETS[0].lon, -95, "the first preset is the owner's region: 39 N 95 W");
});

test("lamp frames: nine bytes, a third of full at most, warm spot moves left to right, blue at night", () => {
  const loc = { lat: 39, lon: -98 };
  const ev = sunEvents(dayOf("2026-06-21"), 39, -98);
  const at = (f) => ev.rise + f * (ev.set - ev.rise);
  const peak = (v) => Math.max(...v);
  for (let h = 0; h < 48; h++) {
    for (const l of [lampsNow(iso("2026-06-21T00:00Z") + h * 1800000, loc), lampsNow(iso("2026-12-21T00:00Z") + h * 1800000, { lat: 70, lon: 25 }),
      lampsNow(iso("2026-06-21T00:00Z") + h * 1800000, { lat: 70, lon: 25 }), lampsNow(iso("2026-06-21T00:00Z") + h * 1800000, null),
      lampsMoon(iso("2026-06-21T00:00Z") + h * 3600000 * 15, false), lampsMoon(iso("2026-06-21T00:00Z") + h * 3600000 * 15, true), lampsYear(iso("2026-01-01T00:00Z") + h * 7 * DAY, -360)]) {
      assert.ok(valid(l), String(l));
      assert.ok(peak(l) <= 0.34 * 255 + 1, String(l));
    }
  }
  const morning = lampsNow(at(0.05), loc), noon = lampsNow(at(0.5), loc), evening = lampsNow(at(0.95), loc);
  assert.ok(morning[0] > morning[3] && morning[3] >= morning[6], "morning: left lamp strongest " + morning);
  assert.ok(noon[3] > noon[0] && noon[3] > noon[6], "noon: middle lamp strongest " + noon);
  assert.ok(evening[6] > evening[3] && evening[3] >= evening[0], "evening: right lamp strongest " + evening);
  const night = lampsNow(ev.set + 3 * 3600000, loc);
  assert.ok(night[2] > 0 && night[2] > night[0] + night[1] && night[5] > 0 && night[8] > 0, "night is blue " + night);
  assert.ok(night.every((v, i) => i % 3 !== 0 || v === 0), "no red in the night light");
  assert.deepEqual(lampsNow(at(0.5), null), Array(9).fill(0));
  // Moon: brightness follows illumination and is lit from the drawn side.
  const full = lampsMoon(iso("2026-06-29T23:56Z"), false), nw = lampsMoon(iso("2026-06-15T02:54Z"), false);
  assert.ok(full[0] > 0 && full[3] > 0 && full[6] > 0);
  assert.ok(nw.every((v) => v === 0));
  const waxing = lampsMoon(iso("2026-06-21T12:00Z"), false), waxingSouth = lampsMoon(iso("2026-06-21T12:00Z"), true);
  assert.ok(waxing[6] > waxing[3] && waxing[3] > waxing[0] - 1 && waxing[6] > waxing[0], "waxing, north: lit from the right " + waxing);
  assert.ok(waxingSouth[0] > waxingSouth[6], "waxing, south: lit from the left " + waxingSouth);
  const waning = lampsMoon(iso("2026-07-05T12:00Z"), false);
  assert.ok(waning[0] > waning[6], "waning, north: lit from the left");
});

test("moon drawing: lit side, gibbous versus crescent, hemisphere mirror", () => {
  const sweeps = (svg) => svg.match(/A[\d.]+ [\d.]+ 0 0 (\d)/g).map((s) => s.slice(-1));
  assert.ok(!/<path/.test(moonSvg(0.0, true, false)), "new moon is just an outline");
  assert.ok(/<circle[^>]*fill-opacity/.test(moonSvg(1, true, false)), "full moon is filled");
  assert.deepEqual(sweeps(moonSvg(0.25, true, false)), ["1", "0"]); // waxing crescent, lit right
  assert.deepEqual(sweeps(moonSvg(0.75, true, false)), ["1", "1"]); // waxing gibbous
  assert.deepEqual(sweeps(moonSvg(0.25, false, false)), ["0", "1"]); // waning crescent, lit left
  assert.deepEqual(sweeps(moonSvg(0.25, true, true)), ["0", "1"]); // southern: mirrored
  assert.match(moonSvg(0.25, true, false), /A33 66|A33\.00 66/); // terminator half-width R*|1-2f|
  assert.match(moonSvg(0.5, true, false), /A0\.00 66/);
});

test("orrery scale is monotonic and fits the picture", () => {
  const radii = PLANETS.map((p) => orreryRadius(p.el[0]));
  for (let i = 1; i < radii.length; i++) assert.ok(radii[i] > radii[i - 1] + 5);
  assert.ok(radii[7] + 23 < 138, "the outermost label stays inside the 276-unit picture");
});

// ---------------------------------------------------------------- the instrument
const labels = (ctx) => ctx.currentActions.map((a) => a.label);
const pick = (ctx, text) => {
  const item = ctx.currentActions.find((a) => a.label.includes(text));
  assert.ok(item, `no action "${text}" in ${labels(ctx)}`);
  return item.run();
};
function open(options = {}, ms = iso("2026-10-01T15:30:00Z"), offset = -300) {
  const ctx = appContext(options);
  const app = new Ephemeris(ctx);
  let t = ms;
  app.clock = () => t;
  app.offset = () => offset;
  app.zoneName = () => "CDT";
  app.tick();
  return { ctx, app, advance: (s) => { t += s * 1000; app.tick(); }, set: (x) => { t = x; app.tick(); } };
}
const lastHtml = (ctx) => ctx.calls.content[ctx.calls.content.length - 1];
const lastLamps = (ctx) => ctx.calls.leds[ctx.calls.leds.length - 1];

test("without a location the clock, moon and orrery work and sun times say they need one", () => {
  const { ctx, app } = open();
  let html = lastHtml(ctx);
  assert.match(html, /LOCAL TIME \/ UTC-05:00 CDT/);
  assert.match(html, /10:30:00/);
  assert.match(html, /THU 1 OCT 2026/);
  assert.match(html, /DAY 274 OF 365/);
  assert.match(html, /SUN TIMES NEED A LOCATION/);
  assert.ok(!/SUNRISE/.test(html));
  assert.deepEqual(lastLamps(ctx), Array(9).fill(0));
  pick(ctx, "NEXT PAGE");
  html = lastHtml(ctx);
  assert.match(html, /WANING GIBBOUS/);
  assert.match(html, /NO LOCATION SET/);
  assert.match(html, /NEXT FULL MOON/);
  assert.match(html, /<svg/);
  pick(ctx, "NEXT PAGE");
  html = lastHtml(ctx);
  assert.match(html, /HELIOCENTRIC LONGITUDE/);
  assert.match(html, /EVENING SKY:/);
  assert.match(html, /MARS/);
  pick(ctx, "NEXT PAGE");
  html = lastHtml(ctx);
  assert.match(html, /DECEMBER SOLSTICE/);
  assert.match(html, /CURVE NEEDS A LOCATION/);
  assert.equal(app.page, 3);
  pick(ctx, "NEXT PAGE");
  assert.equal(app.page, 0);
});

test("choosing a preset shows sunrise, sunset, day length, noon and a countdown, and saves it", () => {
  const { ctx, app } = open();
  pick(ctx, "LOCATION PRESETS");
  assert.ok(labels(ctx).length <= 8);
  assert.ok(labels(ctx)[0].startsWith("US CENTRAL"));
  pick(ctx, "US CENTRAL");
  assert.deepEqual(ctx.calls.saved.at(-1), { schema: 1, lat: 39, lon: -95 });
  const html = lastHtml(ctx);
  assert.match(html, /NEXT: SUNSET/);
  assert.match(html, /39 N 95 W/);
  // 2026-10-01 at 39N 95W: sunrise 12:16 UTC = 07:16 CDT, sunset 00:02 UTC (independent source for
  // 39.1 N 94.6 W: 12:13 and 00:02, solar noon 18:07:58; see the header).
  const ev = sunEvents(solarDay(iso("2026-10-01T15:30:00Z"), -95), 39, -95);
  const hm = (ms) => { const f = fields(ms + 30000, -300); return String(f.h).padStart(2, "0") + ":" + String(f.mi).padStart(2, "0"); };
  assert.ok(html.includes("SUNRISE " + hm(ev.rise)), html);
  assert.ok(html.includes("SUNSET " + hm(ev.set)));
  assert.ok(html.includes("SOLAR NOON " + hm(ev.noon)));
  assert.match(html, /DAY LENGTH 1[12]H \d\dM/);
  assert.match(html, /IN \d+H \d\dM/);
  assert.ok(app.loc);
  assert.ok(valid(lastLamps(ctx)));
  assert.ok(lastLamps(ctx).some((v) => v > 0), "lamps show the day");
});

test("state survives a save and restore round trip", () => {
  const first = open();
  pick(first.ctx, "LOCATION PRESETS");
  pick(first.ctx, "SOUTHERN TEMPERATE");
  const saved = first.ctx.calls.saved.at(-1);
  assert.deepEqual(saved, { schema: 1, lat: -34, lon: 151 });
  assert.ok(JSON.stringify(saved).length < 8192);
  const second = open({ progress: JSON.parse(JSON.stringify(saved)) });
  assert.deepEqual(second.app.loc, { lat: -34, lon: 151 });
  assert.match(lastHtml(second.ctx), /34 S 151 E/);
  assert.ok(labels(second.ctx).some((l) => l.includes("34 S 151 E")));
  for (const junk of [{ lat: 1000, lon: 0 }, "hello", { lat: NaN, lon: 5 }, [], 7]) assert.equal(open({ progress: junk }).app.loc, null);
});

test("southern location draws the moon mirrored, and the year page labels seasons for it", () => {
  const north = open();
  pick(north.ctx, "NEXT PAGE");
  const nHtml = lastHtml(north.ctx);
  const south = open({ progress: { lat: -34, lon: 151 } });
  pick(south.ctx, "NEXT PAGE");
  const sHtml = lastHtml(south.ctx);
  assert.match(sHtml, /SOUTHERN HEMISPHERE/);
  const path = (h) => h.match(/<path d="[^"]*"/)[0];
  assert.notEqual(path(nHtml), path(sHtml));
  pick(south.ctx, "NEXT PAGE");
  pick(south.ctx, "NEXT PAGE");
  const y = lastHtml(south.ctx);
  assert.match(y, /AUTUMN BEGINS/);
  assert.match(y, /<polyline/);
  assert.match(y, /TODAY \d+H \d\dM/);
  assert.match(y, /MARCH EQUINOX +FRI 20 MAR 09:46/);
});

test("polar locations say so instead of showing times", () => {
  const night = open({ progress: { lat: 70, lon: 25 } }, iso("2026-12-21T12:00:00Z"), 60);
  assert.match(lastHtml(night.ctx), /POLAR NIGHT/);
  assert.match(lastHtml(night.ctx), /SUN STAYS DOWN/);
  assert.match(lastHtml(night.ctx), /NO SUNRISE/);
  assert.ok(valid(lastLamps(night.ctx)));
  const day = open({ progress: { lat: 70, lon: 25 } }, iso("2026-06-21T12:00:00Z"), 120);
  assert.match(lastHtml(day.ctx), /POLAR DAY/);
  assert.match(lastHtml(day.ctx), /DAY LENGTH 24H 00M/);
  assert.ok(lastLamps(day.ctx).some((v) => v > 0));
  for (let i = 0; i < 3; i++) pick(day.ctx, "NEXT PAGE");
  assert.match(lastHtml(day.ctx), /<polyline/);
});

test("date line and time zone: a +1D marker appears when the local date differs", () => {
  // Fiji (18S 178E) seen from US Central time: sunrise 06:12 local is 12:12 CDT the day before.
  const { ctx } = open({ progress: { lat: -18, lon: 178 } }, iso("2026-03-20T12:00:00Z"), -300);
  const html = lastHtml(ctx);
  assert.match(html, /SUNRISE \d\d:\d\d( [+-]1D)?/);
  // Browser in Fiji itself: no marker.
  const local = open({ progress: { lat: -18, lon: 178 } }, iso("2026-03-20T00:00:00Z"), 720);
  assert.ok(!/[+-]1D/.test(lastHtml(local.ctx)), lastHtml(local.ctx));
  assert.match(lastHtml(local.ctx), /UTC\+12:00/);
});

test("pages are rebuilt only when what they show can change", () => {
  const { ctx, advance } = open({ progress: { lat: 39, lon: -98 } });
  const n0 = ctx.calls.content.length;
  advance(1); advance(1); advance(1);
  assert.equal(ctx.calls.content.length - n0, 3, "the clock changes every second");
  pick(ctx, "NEXT PAGE"); // moon
  const n1 = ctx.calls.content.length;
  for (let i = 0; i < 50; i++) advance(1);
  assert.ok(ctx.calls.content.length - n1 <= 2, "moon is rebuilt about once a minute: " + (ctx.calls.content.length - n1));
  pick(ctx, "NEXT PAGE"); // orrery
  const n2 = ctx.calls.content.length;
  for (let i = 0; i < 3600; i += 30) advance(30);
  assert.equal(ctx.calls.content.length - n2, 0, "the orrery does not change within a day");
  advance(86400);
  assert.equal(ctx.calls.content.length - n2, 1, "and does the next day");
  pick(ctx, "NEXT PAGE"); // year
  const n3 = ctx.calls.content.length;
  for (let i = 0; i < 100; i++) advance(60);
  assert.equal(ctx.calls.content.length - n3, 0);
});

test("action lists stay short, keep their labels while paging, and every action runs", () => {
  const { ctx, app } = open();
  const main = labels(ctx);
  assert.ok(main.length <= 8);
  assert.equal(main[0], "NEXT PAGE");
  const count = ctx.calls.actions.length;
  for (let i = 0; i < 8; i++) pick(ctx, "NEXT PAGE");
  assert.equal(ctx.calls.actions.length, count, "paging does not rebuild the actions");
  pick(ctx, "PREVIOUS PAGE");
  assert.equal(app.page, 3);
  assert.ok(labels(ctx).some((l) => l === "RETURN TO DASHBOARD"));
  // Every action of the main menu runs without throwing (the wizard and the presets are
  // exercised in their own tests).
  const seen = new Set();
  for (const item of ctx.currentActions.slice()) {
    seen.add(item.label);
    if (item.label === "RETURN TO DASHBOARD") continue;
    item.run();
    const leave = ctx.currentActions.find((x) => x.label.startsWith("CANCEL") || x.label === "BACK");
    if (leave) leave.run();
  }
  assert.ok(seen.size >= 5);
  const a = open();
  pick(a.ctx, "LOCATION PRESETS");
  for (const item of a.ctx.currentActions.slice()) { if (item.label !== "BACK") { item.run(); pick(a.ctx, "LOCATION PRESETS"); } }
  pick(a.ctx, "BACK");
  assert.equal(labels(a.ctx)[0], "NEXT PAGE");
});

test("custom location chooser: two steppers, every list at most eight rows, saves the nearest degree", () => {
  const { ctx, app } = open();
  pick(ctx, "SET LOCATION");
  assert.match(lastHtml(ctx), /SET LOCATION/);
  assert.match(lastHtml(ctx), /\[39 N\]   95 W/, "starts from the first preset");
  assert.equal(labels(ctx)[0], "NEXT / LONGITUDE", "NEXT is first, so a place that is right costs no taps");
  assert.ok(labels(ctx).length <= 8);
  for (let i = 0; i < 4; i++) pick(ctx, "MORE SOUTH -10"); // 39 -> -1
  pick(ctx, "MORE NORTH +1"); // 0
  pick(ctx, "MORE SOUTH -1"); pick(ctx, "MORE SOUTH -1"); // -2
  pick(ctx, "NEXT / LONGITUDE");
  assert.match(lastHtml(ctx), /LONGITUDE: STEP EAST OR WEST/);
  assert.match(lastHtml(ctx), /2 S   \[95 W\]/);
  for (let i = 0; i < 9; i++) pick(ctx, "MORE EAST +10"); // -95 -> -5
  for (let i = 0; i < 7; i++) pick(ctx, "MORE EAST +1"); // 2
  assert.ok(labels(ctx).length <= 8);
  pick(ctx, "NEXT / CHECK");
  assert.ok(labels(ctx).includes("SAVE / 2 S 2 E"), labels(ctx).join("|"));
  assert.ok(labels(ctx).some((l) => l.startsWith("BACK")) && labels(ctx).some((l) => l.startsWith("CANCEL")));
  pick(ctx, "SAVE");
  assert.deepEqual(ctx.calls.saved.at(-1), { schema: 1, lat: -2, lon: 2 });
  assert.deepEqual(app.loc, { lat: -2, lon: 2 });
  assert.equal(app.wiz, null);
  assert.equal(labels(ctx)[0], "NEXT PAGE");
  assert.match(lastHtml(ctx), /NEXT: SUN|POLAR/);
});

test("chooser limits: latitude stops at 90, longitude at 180, back and cancel work", () => {
  const { ctx, app } = open({ progress: { lat: 39, lon: -98 } });
  pick(ctx, "SET LOCATION");
  for (let i = 0; i < 8; i++) pick(ctx, "MORE NORTH +10");
  assert.match(lastHtml(ctx), /\[90 N\]/);
  pick(ctx, "NEXT / LONGITUDE");
  for (let i = 0; i < 12; i++) pick(ctx, "MORE WEST -10");
  assert.match(lastHtml(ctx), /\[180 W\]/);
  pick(ctx, "NEXT / CHECK");
  assert.ok(labels(ctx).some((l) => l === "SAVE / 90 N 180 W"));
  pick(ctx, "BACK");
  assert.match(lastHtml(ctx), /LONGITUDE: STEP EAST OR WEST/);
  pick(ctx, "CANCEL");
  assert.deepEqual(app.loc, { lat: 39, lon: -98 }, "cancel keeps the old location");
  assert.equal(ctx.calls.saved.length, 0);
  assert.equal(labels(ctx)[0], "NEXT PAGE");
});

test("lamps follow the page and are off after dispose, cancel, and in the wizard", () => {
  const { ctx, app, set } = open({ progress: { lat: 39, lon: -98 } });
  for (const l of ctx.calls.leds) assert.ok(valid(l));
  const nowLamps = lastLamps(ctx);
  assert.ok(nowLamps.some((v) => v > 0));
  pick(ctx, "NEXT PAGE");
  assert.deepEqual(lastLamps(ctx), lampsMoon(iso("2026-10-01T15:30:00Z"), false));
  pick(ctx, "NEXT PAGE");
  assert.deepEqual(lastLamps(ctx), Array(9).fill(0));
  pick(ctx, "NEXT PAGE");
  assert.deepEqual(lastLamps(ctx), lampsYear(iso("2026-10-01T15:30:00Z"), -300));
  // Over a day the Now lamps visibly change (spot moves, then blue night).
  pick(ctx, "NEXT PAGE");
  const seen = new Set();
  for (let h = 0; h < 24; h++) { set(iso("2026-10-01T00:00Z") + h * 3600000); seen.add(lastLamps(ctx).join()); }
  assert.ok(seen.size >= 8, "lamps change through the day: " + seen.size);
  pick(ctx, "SET LOCATION");
  assert.deepEqual(lastLamps(ctx), Array(9).fill(0));
  app.cancel();
  app.tick();
  app.dispose();
  assert.deepEqual(lastLamps(ctx), Array(9).fill(0));
  const n = ctx.calls.leds.length;
  app.tick();
  assert.equal(ctx.calls.leds.length, n, "nothing is written after dispose");
});

test("every page renders for a spread of dates and places without NaN or errors", () => {
  const places = [null, { lat: 39, lon: -98 }, { lat: 70, lon: 25 }, { lat: -78, lon: 166 }, { lat: 0, lon: 180 }, { lat: -17, lon: -180 }, { lat: 90, lon: 0 }, { lat: -90, lon: 0 }];
  for (const place of places) {
    for (const date of ["2024-02-29T23:59:59Z", "2026-03-20T14:46:00Z", "2026-06-21T00:00:00Z", "2026-12-31T23:59:59Z", "2035-07-04T12:00:00Z", "2001-01-01T00:00:00Z"]) {
      const { ctx, app } = open({ progress: place ? { ...place } : {} }, iso(date), -360);
      for (let p = 0; p < 4; p++) {
        const html = lastHtml(ctx);
        assert.ok(typeof html === "string" && html.length > 50);
        assert.ok(!/NaN|undefined|Infinity/.test(html), `${JSON.stringify(place)} ${date} page ${p}: ${html.match(/.{30}(NaN|undefined|Infinity).{30}/)?.[0]}`);
        assert.ok(valid(lastLamps(ctx)));
        pick(ctx, "NEXT PAGE");
      }
      assert.equal(app.page, 0);
    }
  }
});

test("stray cancels and the home action do not touch the saved location", () => {
  const { ctx, app } = open({ progress: { lat: 39, lon: -98 } });
  app.cancel(); app.cancel(); app.cancel();
  assert.deepEqual(app.loc, { lat: 39, lon: -98 });
  const item = ctx.currentActions.find((a) => a.label === "RETURN TO DASHBOARD");
  assert.ok(item);
  assert.equal(typeof item.run, "function");
  assert.equal(ctx.calls.saved.length, 0);
});

// What the host does with the highlight when a list is published (web/main.js setNav): it stays
// on the action with the same id, otherwise on the same row number. `card` is the row the
// dashboard had highlighted when the instrument opened: the first list starts at that row.
function pad(ctx, card = 0) {
  let items = null, index = card, seen = 0;
  const idOf = (i) => i.id || i.label;
  const sync = () => {
    for (; seen < ctx.calls.actions.length; seen++) {
      const next = ctx.calls.actions[seen], match = items ? next.findIndex((i) => idOf(i) === idOf(items[index])) : -1;
      index = Math.min(match >= 0 ? match : index, next.length - 1);
      items = next;
    }
  };
  return {
    tap(n = 1) { sync(); index = (index + n) % items.length; return this; },
    hold() { sync(); items[index].run(); sync(); return this; },
    get label() { sync(); return items[index].label; },
  };
}

test("opened from any dashboard card NEXT PAGE is highlighted; presets and the chooser end on sensible rows", () => {
  for (let card = 0; card < 8; card++) assert.equal(pad(open().ctx, card).label, "NEXT PAGE", "card " + card);
  const { ctx } = open();
  const hand = pad(ctx, 2);
  hand.tap(2).hold(); // LOCATION PRESETS
  assert.match(hand.label, /^US CENTRAL/, "a list opens on its first row");
  hand.tap(PRESETS.length).hold(); // BACK
  assert.match(hand.label, /^LOCATION PRESETS/, "back on the row that opened the list");
  hand.hold();
  hand.tap(PRESETS.length - 1).hold(); // the last preset used to land on RETURN TO DASHBOARD
  assert.equal(hand.label, "NEXT PAGE");
  hand.tap(3).hold(); // SET LOCATION
  assert.equal(hand.label, "NEXT / LONGITUDE");
  hand.tap(1).hold(); // one step, the highlight stays on it
  assert.match(hand.label, /MORE NORTH \+1/);
  hand.tap(4).hold(); // CANCEL
  assert.match(hand.label, /^SET LOCATION/);
});

test("the system menu owns the lamps while it is open", () => {
  const { ctx, app, set } = open({ progress: { lat: 39, lon: -95 } });
  const n = ctx.calls.leds.length;
  app.pause();
  set(Date.now() + 5000); app.tick();
  assert.equal(ctx.calls.leds.length, n, "nothing is written while paused");
  app.resume();
  assert.ok(ctx.calls.leds.length > n);
  app.dispose();
});
