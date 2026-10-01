// TELEMETRY — the machine's own health panel. An instrument: four pages (overview, node,
// history, about) fed by GET /api/system (docs/PROTOCOL.md), and the three lamps as a quiet
// health light: left temperature, middle load and memory, right node link.
//
// Data. One request is in flight at most. The first is sent on opening, then tick() (once a
// second) starts another when the last one began 2 s ago or more. A request that has not
// answered after 10 s is abandoned (its late answer is ignored) so a hung connection cannot
// stop the panel recovering. A failed request keeps the last good payload, which the panel
// marks stale with its age; the next successful request clears the mark. dispose() stops
// polling and darkens the lamps. Nothing is stored: the history is a bounded buffer.
//
// Display. The markup of all four pages is built once; afterwards only text, colour and
// attribute changes are written, and only when the value differs. What is on screen is
// recorded in this.shown (id -> {text, level}), which is what the tests read.
//
// Thresholds (verdict level 0 normal, 1 elevated, 2 critical; see THRESHOLDS):
//   CPU temperature   warm from 70 C, critical from 80 C (a Pi 5 starts limiting at about 80
//                     and throttles hard at 85)
//   CPU utilisation   high from 70 %, critical from 90 %
//   Memory in use     high from 80 %, critical from 92 %
//   Storage free      low under 20 %, critical under 10 % or under 1 GiB
//   Throttle flags    under-voltage or throttled now: critical; frequency capped or soft
//                     temperature limit now: elevated; "occurred since boot" is only text
// Lamps use the worst verdict of what the lamp covers; a quantity the host cannot report
// is ignored, and a lamp with nothing to go on stays dark.
import { LAMP, dim, lightsOff, pulse, blink } from "../engine/lightshow.js";
import { clamp, tempValue, tempUnit, formatTemp } from "../engine/math.js";

export const THRESHOLDS = {
  tempC: [70, 80],
  cpuPercent: [70, 90],
  memPercent: [80, 92],
  diskFreePercent: [20, 10], // below the first: low, below the second: critical
  diskFreeMinBytes: 1024 ** 3,
};
export const POLL_MS = 2000;
export const ABANDON_MS = 10000; // a request this old is given up on
export const LAMP_DARK_AFTER_S = 15; // no fresh data for this long: lamps go dark
export const HISTORY_MAX = 360; // 12 minutes at one sample per 2 s
const PAGES = ["OVERVIEW", "NODE", "HISTORY", "ABOUT"];
const ERROR_WINDOW_MS = 60000;
const CPU_SMOOTH = 3; // lamp uses the mean of the last three samples

const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
const obj = (x) => (x && typeof x === "object" && !Array.isArray(x) ? x : {});
const str = (x) => (typeof x === "string" && x.trim() ? x.trim().slice(0, 80) : null);
const DASH = "—";
const orDash = (x) => (x === null || x === undefined ? DASH : String(x));
const count = (x) => (num(x) === null ? DASH : String(Math.max(0, Math.round(x))));

export function formatBytes(bytes) {
  const b = num(bytes);
  if (b === null || b < 0) return DASH;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, v = b;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return (i >= 3 ? v.toFixed(1) : Math.round(v)) + " " + units[i];
}
export function formatDuration(seconds) {
  const s = num(seconds);
  if (s === null || s < 0) return DASH;
  const d = Math.floor(s / 86400), h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60;
  if (d) return `${d} D ${h} H ${m} M`;
  if (h) return `${h} H ${m} M`;
  return m ? `${m} M ${Math.floor(s % 60)} S` : `${Math.floor(s)} S`;
}
const ageText = (seconds) => (seconds < 90 ? Math.round(seconds) + " S" : Math.round(seconds / 60) + " MIN");

// Level (0, 1, 2 or null for unknown) of a value that gets worse as it rises.
const rising = (value, [warm, critical]) => (value === null ? null : value >= critical ? 2 : value >= warm ? 1 : 0);
const worst = (...levels) => {
  const known = levels.filter((l) => l !== null);
  return known.length ? Math.max(...known) : null;
};

// Everything the panel and the lamps need from one payload; pure, never throws, every field
// null when unknown. `previous` is not used: trends live in the app.
export function assess(payload) {
  const p = obj(payload), host = obj(p.host), node = obj(p.node), service = obj(p.service);
  const mem = obj(host.memory), disk = obj(host.disk), thr = obj(host.throttled), sensor = obj(node.sensor);
  const tempC = num(host.cpuTempC);
  const cpu = num(host.cpuPercent) === null ? null : clamp(host.cpuPercent, 0, 100);
  const memTotal = num(mem.totalBytes), memAvail = num(mem.availableBytes);
  const memPercent = memTotal && memAvail !== null && memTotal > 0 ? clamp(100 * (1 - memAvail / memTotal), 0, 100) : null;
  const diskTotal = num(disk.totalBytes), diskFree = num(disk.freeBytes);
  const freePercent = diskTotal && diskFree !== null && diskTotal > 0 ? clamp((100 * diskFree) / diskTotal, 0, 100) : null;
  let diskLevel = null;
  if (freePercent !== null) {
    const [low, crit] = THRESHOLDS.diskFreePercent;
    diskLevel = freePercent < crit || diskFree < THRESHOLDS.diskFreeMinBytes ? 2 : freePercent < low ? 1 : 0;
  }
  const flag = (name) => (thr[name] === true ? true : thr[name] === false ? false : null);
  const powerNow = [flag("underVoltageNow"), flag("throttledNow")], capNow = [flag("freqCappedNow"), flag("softTempLimitNow")];
  const throttleLevel = Object.keys(thr).length === 0 ? null
    : powerNow.includes(true) ? 2 : capNow.includes(true) ? 1 : 0;
  const tempLevel = rising(tempC, THRESHOLDS.tempC);
  const cpuLevel = rising(cpu, THRESHOLDS.cpuPercent);
  const memLevel = rising(memPercent, THRESHOLDS.memPercent);
  return {
    tempC, tempLevel, cpu, cpuLevel, memPercent, memLevel, freePercent, diskFree, diskTotal, diskLevel,
    throttleLevel, thr,
    thermalLevel: worst(tempLevel, throttleLevel),
    loadLevel: worst(cpuLevel, memLevel),
    connected: node.connected === true ? true : node.connected === false ? false : null,
    statusAgeS: num(node.statusAgeS),
    simulated: p.simulated === true,
    sensor: { ok: num(sensor.ok), fail: num(sensor.fail), addr: sensor.addr ?? null, err: sensor.err ?? null },
    errors: (num(node.crcErrors) || 0) + (num(node.missingSamples) || 0),
    service: { version: str(service.version) },
  };
}

// Verdict of the node link for the right lamp. `recentErrors` is how many damaged frames or
// lost samples arrived in the last minute.
export function nodeLevel(a, recentErrors) {
  if (a.connected === null) return null;
  if (a.connected === false) return "down";
  if (recentErrors >= 20 || (a.statusAgeS !== null && a.statusAgeS > 30)) return 2;
  if (recentErrors > 0 || (a.statusAgeS !== null && a.statusAgeS > 10) || (a.sensor.fail > 0 && a.sensor.ok === 0)) return 1;
  return 0;
}

// The three lamps (nine bytes). Levels: 0 dim green, 1 amber, 2 red pulsing; null dark; the
// node level "down" is a slow amber blink on a dark lamp. Peak light stays near a third.
export function healthLamps(left, middle, right, seconds) {
  const one = (level) => {
    if (level === 0) return dim(LAMP.green, 0.1);
    if (level === 1) return dim(LAMP.amber, 0.22);
    if (level === 2) return dim(LAMP.red, 0.08 + 0.25 * pulse(seconds, 0.4));
    if (level === "down") return dim(LAMP.amber, 0.25 * blink(seconds, 0.5));
    return LAMP.off;
  };
  return [left, middle, right].flatMap((l) => one(l));
}

const WORD = [["NORMAL", "WARM", "CRITICAL"], ["NORMAL", "HIGH", "CRITICAL"], ["NORMAL", "HIGH", "CRITICAL"], ["NORMAL", "LOW", "CRITICAL"]];
const COLOUR = ["var(--phosphor)", "var(--amber)", "var(--red)"];

const tile = (id, label) =>
  `<div class="utility-panel" id="tm-${id}-tile" style="padding:10px 12px;border-left:3px solid var(--line)"><div class="data-label">${label}</div>` +
  `<div class="big-readout" id="tm-${id}-v" style="font-size:30px;white-space:nowrap">${DASH}</div>` +
  `<div class="data-label" id="tm-${id}-s" style="margin:4px 0 0">NO DATA</div><div class="data-label" id="tm-${id}-x" style="margin:2px 0 0;text-transform:none">&nbsp;</div></div>`;
const row = (id, label) =>
  `<div class="diag-item"><span>${label}</span><span id="tm-${id}" style="text-align:right">${DASH}</span></div>`;
const note = (id) => `<p id="tm-${id}" style="margin:0 0 4px;font-size:12px;line-height:1.35">&nbsp;</p>`;
const chart = (id, label) =>
  `<div class="utility-panel" style="padding:8px 14px"><div class="data-label" style="display:flex;justify-content:space-between"><span>${label}</span><span id="tm-${id}-v">${DASH}</span></div>` +
  `<svg viewBox="0 0 300 70" preserveAspectRatio="none" width="100%" height="54" style="display:block;color:var(--phosphor)" role="img" aria-label="${label} history">` +
  `<line x1="0" y1="69" x2="300" y2="69" stroke="var(--line)" stroke-width="1"/>` +
  `<line id="tm-${id}-ref" x1="0" y1="0" x2="300" y2="0" stroke="var(--amber)" stroke-width="1" stroke-dasharray="4 4" opacity="0.7"/>` +
  `<polyline id="tm-${id}-line" points="" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"/></svg></div>`;

const MARKUP =
  `<div id="tm-root">` +
  `<div class="data-label" id="tm-status" style="margin:0 0 6px;font-size:12px">WAITING FOR THE SERVICE</div>` +
  `<section id="tm-page-0">` +
  `<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:8px">` +
  tile("temp", "CPU TEMPERATURE") + tile("cpu", "CPU LOAD") + tile("mem", "MEMORY IN USE") + tile("disk", "STORAGE FREE") + `</div>` +
  `<div class="utility-panel" style="padding:8px 16px"><div class="diag-list" style="grid-template-columns:1fr;font-size:13px">` +
  row("power", "THROTTLING / POWER") + row("up", "HOST UPTIME") + row("svc", "SERVICE") + `</div></div></section>` +
  `<section id="tm-page-1" hidden><div class="utility-panel" style="padding:8px 16px"><div class="diag-list" style="grid-template-columns:1fr 1fr;font-size:13px">` +
  row("link", "LINK") + row("port", "PORT") + row("ltype", "LINK TYPE") + row("fw", "FIRMWARE") +
  row("crc", "CRC ERRORS") + row("miss", "MISSING AUDIO SAMPLES") + row("sensor", "SENSOR ADDRESS") + row("sread", "SENSOR READS GOOD / FAILED") +
  row("nodecrc", "NODE-SIDE CRC / AUDIO DROPS") + row("lamp", "LAMP LEVEL SETTING") + `</div></div>` +
  `<div class="utility-panel" style="padding:8px 16px;margin-top:8px">${note("n-crc")}${note("n-miss")}${note("n-sensor")}</div></section>` +
  `<section id="tm-page-2" hidden>${chart("ctemp", "CPU TEMPERATURE")}<div style="height:6px"></div>${chart("ccpu", "CPU UTILISATION")}` +
  `<div class="utility-panel" style="padding:8px 16px;margin-top:6px"><div class="diag-list" style="grid-template-columns:1fr 1fr;font-size:13px">` +
  row("fmed", "FRAME TIME MEDIAN") + row("fp95", "FRAME TIME 95TH PERCENTILE") + `</div></div></section>` +
  `<section id="tm-page-3" hidden><div class="utility-panel" style="padding:8px 16px"><div class="diag-list" style="grid-template-columns:1fr 1fr;font-size:13px">` +
  row("a-app", "APP") + row("a-svc", "SERVICE VERSION") + row("a-fw", "NODE FIRMWARE") + row("a-proto", "PROTOCOL / API SCHEMA") +
  row("a-model", "BOARD") + row("a-py", "PYTHON / PROCESS") + `</div>` +
  `<p style="margin:6px 0 2px;font-size:12px;line-height:1.35">DATA LIVES IN: <span id="tm-a-data">${DASH}</span></p>` +
  `<p style="margin:2px 0;font-size:12px;line-height:1.35">LAMPS ON THIS PAGE: LEFT TEMPERATURE, MIDDLE LOAD AND MEMORY, RIGHT NODE LINK. DIM GREEN IS NORMAL, AMBER ELEVATED, RED PULSING CRITICAL. A SLOW AMBER BLINK ON THE RIGHT LAMP MEANS THE NODE IS DISCONNECTED.</p></div></section>` +
  `</div>`;

export class Telemetry {
  constructor(ctx, options = {}) {
    this.ctx = ctx;
    this.navigation = true;
    this.clock = options.clock || (() => Date.now()); // tests pass a fake clock
    this.page = 0;
    this.shown = {}; // id -> {text, level}: what is on screen
    this.attrs = {}; // "id|name" -> value
    this.dom = {};
    this.last = null; // last good payload
    this.a = assess(null);
    this.lastOkAt = null;
    this.failing = false;
    this.inflight = false;
    this.sentAt = -1e9;
    this.token = 0;
    this.polls = 0;
    this.history = []; // {temp, cpu}
    this.cpuRecent = [];
    this.errorLog = []; // {at, n}
    this.lastFrameAt = -1e9;
    this.dead = false;
    this.lamps = lightsOff();
    ctx.content(MARKUP);
    this.buildActions();
    ctx.hint("Tap to advance. Hold and release to choose. The lamps are the health light: left temperature, middle load, right node link.");
    this.refresh();
    this.poll();
    this.startLoop();
  }

  // ---- data -------------------------------------------------------------------------
  poll() {
    if (this.dead || !this.ctx.alive()) return;
    const now = this.clock();
    if (this.inflight) {
      if (now - this.sentAt < ABANDON_MS) return;
      this.token++; // give up on the hung request; its late answer is ignored
      this.failing = true;
    }
    const token = ++this.token;
    this.inflight = true;
    this.sentAt = now;
    this.polls++;
    let request;
    try { request = Promise.resolve(this.ctx.get("system")); } catch (error) { request = Promise.reject(error); }
    request.then((payload) => this.arrived(token, payload), () => this.arrived(token, undefined));
  }

  arrived(token, payload) {
    if (token !== this.token || this.dead || !this.ctx.alive()) return; // abandoned or disposed
    this.inflight = false;
    const good = payload && typeof payload === "object" && !Array.isArray(payload);
    if (!good) {
      this.failing = true;
    } else {
      this.failing = false;
      const now = this.clock();
      this.last = payload;
      this.lastOkAt = now;
      this.a = assess(payload);
      this.record(now);
    }
    this.refresh();
    this.sendLamps();
  }

  record(now) {
    const a = this.a;
    this.history.push({ temp: a.tempC, cpu: a.cpu });
    if (this.history.length > HISTORY_MAX) this.history.shift();
    if (a.cpu !== null) {
      this.cpuRecent.push(a.cpu);
      if (this.cpuRecent.length > CPU_SMOOTH) this.cpuRecent.shift();
    }
    this.errorLog.push({ at: now, n: a.errors });
    while (this.errorLog.length > 1 && now - this.errorLog[0].at > ERROR_WINDOW_MS) this.errorLog.shift();
    if (this.errorLog.length > 40) this.errorLog.splice(0, this.errorLog.length - 40);
  }

  recentErrors() {
    const log = this.errorLog;
    if (log.length < 2) return 0;
    return Math.max(0, log[log.length - 1].n - log[0].n); // a restart (counter reset) reads as 0
  }

  age(now = this.clock()) {
    return this.lastOkAt === null ? null : Math.max(0, (now - this.lastOkAt) / 1000);
  }
  isStale(now = this.clock()) {
    const age = this.age(now);
    return age !== null && (this.failing || age > (POLL_MS * 3) / 1000);
  }

  // ---- lamps ------------------------------------------------------------------------
  lampValues(now = this.clock()) {
    const age = this.age(now);
    if (age === null || age > LAMP_DARK_AFTER_S) return lightsOff();
    const a = this.a;
    const smooth = this.cpuRecent.length ? this.cpuRecent.reduce((s, v) => s + v, 0) / this.cpuRecent.length : null;
    const load = worst(rising(smooth, THRESHOLDS.cpuPercent), a.memLevel);
    return healthLamps(a.thermalLevel, load, nodeLevel(a, this.recentErrors()), now / 1000);
  }

  startLoop() {
    if (typeof requestAnimationFrame !== "function") return;
    const loop = () => {
      if (this.dead || !this.ctx.alive()) return;
      try {
        const now = this.clock();
        if (now - this.lastFrameAt >= 60) this.sendLamps(now);
      } catch {}
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
  sendLamps(now = this.clock()) {
    this.lastFrameAt = now;
    this.lamps = this.lampValues(now);
    this.ctx.leds(this.lamps);
  }

  // ---- display ----------------------------------------------------------------------
  element(id) {
    if (typeof document === "undefined") return null;
    let el = this.dom[id];
    if (!el || !el.isConnected) el = this.dom[id] = document.getElementById("tm-" + id);
    return el || null;
  }
  set(id, text, level = null) {
    const prev = this.shown[id];
    if (prev && prev.text === text && prev.level === level) return;
    this.shown[id] = { text, level };
    try {
      const el = this.element(id);
      if (!el) return;
      if (!prev || prev.text !== text) el.textContent = text;
      if (!prev || prev.level !== level) el.style.color = level === null ? "" : COLOUR[level];
    } catch {}
  }
  attr(id, name, value) {
    const key = id + "|" + name;
    if (this.attrs[key] === value) return;
    this.attrs[key] = value;
    try {
      const el = this.element(id);
      if (!el) return;
      if (name === "hidden") el.hidden = value;
      else if (name === "tile") el.style.borderLeftColor = value;
      else el.setAttribute(name, value);
    } catch {}
  }

  refresh() {
    try { this.paint(); } catch {}
  }
  paint() {
    const a = this.a, s = this.ctx.settings?.() || {}, unit = s.tempUnit === "C" ? "C" : "F";
    const now = this.clock(), age = this.age(now), stale = this.isStale(now);
    for (let i = 0; i < PAGES.length; i++) this.attr("page-" + i, "hidden", i !== this.page);
    this.attr("root", "style", stale ? "opacity:0.6" : "");
    // status line
    let status;
    if (age === null) status = this.failing ? "NO DATA / SERVICE NOT ANSWERING / RETRYING" : "WAITING FOR THE SERVICE";
    else if (stale) status = `STALE / LAST DATA ${ageText(age)} AGO / RETRYING`;
    else status = "LIVE" + (a.simulated ? " / NODE VALUES ARE SIMULATED" : "");
    if (age !== null && stale && a.simulated) status += " / SIMULATED NODE";
    this.set("status", status, age === null ? 1 : stale ? 1 : a.simulated ? 1 : 0);

    // overview tiles
    const tileOf = (id, text, level, kind, extra) => {
      this.set(id + "-v", text, level);
      this.set(id + "-s", level === null ? "NO DATA" : WORD[kind][level], level);
      this.set(id + "-x", extra);
      this.attr(id + "-tile", "tile", level === null ? "var(--line)" : COLOUR[level]);
    };
    tileOf("temp", a.tempC === null ? DASH : formatTemp(a.tempC, unit, 0), a.tempLevel, 0, "LIMITS ITSELF AT " + Math.round(tempValue(80, unit)) + tempUnit(unit));
    const load1 = num(obj(this.last?.host).loadAvg?.[0]);
    tileOf("cpu", a.cpu === null ? DASH : Math.round(a.cpu) + " %", a.cpuLevel, 1, load1 === null ? "LOAD AVG " + DASH : "LOAD AVG " + load1.toFixed(2));
    const memT = num(obj(obj(this.last?.host).memory).totalBytes), memA = num(obj(obj(this.last?.host).memory).availableBytes);
    tileOf("mem", a.memPercent === null ? DASH : Math.round(a.memPercent) + " %", a.memLevel, 2, a.memPercent === null ? DASH : formatBytes(memT - memA) + " OF " + formatBytes(memT));
    tileOf("disk", a.freePercent === null ? DASH : formatBytes(a.diskFree), a.diskLevel, 3, a.freePercent === null ? DASH : Math.round(a.freePercent) + " % OF " + formatBytes(a.diskTotal));

    // power flags
    const thr = a.thr;
    const names = { underVoltageNow: "UNDER-VOLTAGE", throttledNow: "THROTTLED", freqCappedNow: "FREQUENCY CAPPED", softTempLimitNow: "SOFT TEMP LIMIT" };
    if (a.throttleLevel === null) this.set("power", "NOT REPORTED", null);
    else {
      const now_ = Object.keys(names).filter((k) => thr[k] === true).map((k) => names[k]);
      const was = Object.keys(names).filter((k) => thr[k.replace("Now", "Occurred")] === true && thr[k] !== true).map((k) => names[k]);
      if (now_.length) this.set("power", "NOW: " + now_.join(", "), a.throttleLevel);
      else if (was.length) this.set("power", "OK NOW / SINCE BOOT: " + was.join(", "), 1);
      else this.set("power", "NONE", 0);
    }
    const host = obj(this.last?.host), svc = obj(this.last?.service);
    this.set("up", formatDuration(host.uptimeS));
    this.set("svc", `${a.service.version ? "V" + a.service.version : DASH} / UP ${formatDuration(svc.uptimeS)}`);

    this.paintNode(s);
    this.paintHistory(unit, now);
    this.paintAbout();
  }

  paintNode(settings) {
    const a = this.a, node = obj(this.last?.node), sensor = obj(node.sensor);
    const link = a.connected === null ? DASH : a.connected ? "CONNECTED" : "DISCONNECTED";
    this.set("link", link, a.connected === null ? null : a.connected ? 0 : 1);
    this.set("port", orDash(str(node.port)));
    this.set("ltype", orDash(str(node.link)?.toUpperCase()));
    this.set("fw", orDash(str(node.firmware)));
    const crc = num(node.crcErrors), miss = num(node.missingSamples);
    this.set("crc", count(crc), crc > 0 ? 1 : crc === 0 ? 0 : null);
    this.set("miss", count(miss), miss > 0 ? 1 : miss === 0 ? 0 : null);
    const addr = typeof sensor.addr === "number" ? "0x" + sensor.addr.toString(16).toUpperCase() : str(sensor.addr);
    this.set("sensor", orDash(addr));
    const ok = num(sensor.ok), fail = num(sensor.fail);
    this.set("sread", `${count(ok)} / ${count(fail)}`, fail > 0 ? 1 : null);
    this.set("nodecrc", `${count(node.nodeRxCrc)} / ${count(node.audioDrops)}`);
    this.set("lamp", String(settings.lampLevel || DASH).toUpperCase());
    const clean = crc === 0 && miss === 0 && !(fail > 0);
    this.set("n-crc",
      crc === null ? "CRC ERRORS: NOT REPORTED."
        : crc === 0 ? (clean ? "ALL CLEAN: NO DAMAGED MESSAGES, NO LOST AUDIO, SENSOR ANSWERING." : "CRC ERRORS: NONE. EVERY MESSAGE ARRIVED INTACT.")
          : `CRC ERRORS: ${crc} MESSAGE(S) ARRIVED DAMAGED AND WERE DROPPED. A FEW AFTER A CABLE KNOCK ARE HARMLESS; A COUNT THAT KEEPS CLIMBING MEANS A POOR USB CABLE OR PORT.`,
      crc > 0 ? 1 : null);
    this.set("n-miss",
      miss === null ? "MISSING SAMPLES: NOT REPORTED."
        : miss === 0 ? "MISSING SAMPLES: NONE."
          : `MISSING SAMPLES: ${miss} AUDIO SAMPLE(S) NEVER ARRIVED. SPEECH AND ANALYSIS MAY STUTTER; THE LINK OR THE PI WAS BUSY.`,
      miss > 0 ? 1 : null);
    this.set("n-sensor",
      fail > 0 ? `SENSOR: ${fail} READ(S) FAILED${sensor.err ? " (LAST: " + String(sensor.err).slice(0, 40) + ")" : ""}. CHECK ITS WIRING.`
        : ok > 0 ? "SENSOR: ANSWERING NORMALLY." : "SENSOR: NO READINGS REPORTED.",
      fail > 0 ? 1 : null);
    // when everything is fine one line says so; the others only appear when they have news
    this.attr("n-miss", "hidden", clean || miss === 0);
    this.attr("n-sensor", "hidden", clean || !(fail > 0 || ok === null || ok === 0));
  }

  paintHistory(unit, now) {
    const h = this.history, W = 300, H = 68;
    const line = (key, lo, hi) => {
      const pts = [];
      const n = h.length;
      for (let i = 0; i < n; i++) {
        const v = h[i][key];
        if (v === null) continue;
        const x = n > 1 ? (i / (n - 1)) * W : W;
        pts.push(x.toFixed(1) + "," + (H - clamp((v - lo) / (hi - lo), 0, 1) * H + 1).toFixed(1));
      }
      return pts.join(" ");
    };
    this.attr("ctemp-line", "points", line("temp", 30, 90));
    this.attr("ccpu-line", "points", line("cpu", 0, 100));
    this.attr("ctemp-ref", "y1", String(H + 1 - ((80 - 30) / 60) * H));
    this.attr("ctemp-ref", "y2", String(H + 1 - ((80 - 30) / 60) * H));
    this.attr("ccpu-ref", "y1", String(H + 1 - 0.9 * H));
    this.attr("ccpu-ref", "y2", String(H + 1 - 0.9 * H));
    const span = h.length * (POLL_MS / 1000);
    const spanText = h.length ? " / LAST " + (span < 90 ? Math.round(span) + " S" : Math.round(span / 60) + " MIN") : "";
    this.set("ctemp-v", (this.a.tempC === null ? DASH : formatTemp(this.a.tempC, unit, 0)) + spanText);
    this.set("ccpu-v", (this.a.cpu === null ? DASH : Math.round(this.a.cpu) + " %") + spanText);
    let stats = null;
    try { stats = this.ctx.stats?.(); } catch {}
    const ms = (v) => (num(v) !== null && v > 0 ? v.toFixed(1) + " MS" : DASH);
    this.set("fmed", stats && stats.samples > 0 ? ms(stats.medianMs) : DASH);
    this.set("fp95", stats && stats.samples > 0 ? ms(stats.p95Ms) : DASH);
  }

  paintAbout() {
    const p = obj(this.last), node = obj(p.node), svc = obj(p.service), host = obj(p.host);
    this.set("a-app", "TELEMETRY 1.0");
    this.set("a-svc", orDash(str(svc.version)));
    this.set("a-fw", orDash(str(node.firmware)));
    this.set("a-proto", `V1 / SCHEMA ${count(p.schema)}`);
    this.set("a-model", orDash(str(host.model)?.toUpperCase()));
    this.set("a-py", `${orDash(str(svc.python))} / PID ${count(svc.pid)}`);
    this.set("a-data", str(svc.dataDir) || str(svc.dataPath) || "NOT REPORTED BY THE SERVICE (THE STORAGE FIGURE IS THAT FOLDER'S DISK)");
  }

  // ---- actions ----------------------------------------------------------------------
  buildActions() {
    const go = (i) => () => { this.page = i; this.refresh(); };
    this.ctx.actions([
      { id: "next", label: "NEXT PAGE →", run: () => go((this.page + 1) % PAGES.length)() },
      { id: "overview", label: "PAGE / OVERVIEW", run: go(0) },
      { id: "node", label: "PAGE / NODE", run: go(1) },
      { id: "history", label: "PAGE / HISTORY", run: go(2) },
      { id: "about", label: "PAGE / ABOUT", run: go(3) },
      { id: "refresh", label: "REFRESH NOW", run: () => { this.sentAt = -1e9; this.poll(); } },
      { id: "home", label: "RETURN TO DASHBOARD", run: this.ctx.home },
    ]);
  }

  tick() {
    if (this.dead) return;
    const now = this.clock();
    if (now - this.sentAt >= POLL_MS - 100) this.poll();
    this.refresh();
    this.sendLamps(now);
  }
  cancel() {}
  dispose() {
    this.dead = true;
    this.token++;
    try {
      if (typeof cancelAnimationFrame === "function" && this.raf) cancelAnimationFrame(this.raf);
    } catch {}
    this.ctx.leds(lightsOff());
  }
}
