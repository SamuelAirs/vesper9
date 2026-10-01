import { escapeHTML as esc, formatTime, formatSensorTemp, formatOffset, tempOffset, clampOffset, OFFSET_STEP, tempValue, tempUnit, tempDelta, dewPoint, absoluteHumidity, feelsLike, comfortBand, extremes, trend } from "../engine/math.js";
import { LAMP, dim, fill, meter, ramp, lamps, lightsOff } from "../engine/lightshow.js";
import { microphoneStatus, recognizerLabel } from "../engine/status.js";
import { VOICE_HELP } from "../engine/voice.js";
import { CARTRIDGES } from "./catalog.js";
const panel = (title, body) =>
  `<div class="utility-panel"><h2>${esc(title)}</h2>${body}</div>`;
// The nearest running timer (smallest time left), or null when none is running.
export const nearestTimer = (timers) =>
  (timers || []).reduce((best, t) => (t.running && t.remaining > 0 && (!best || t.remaining < best.remaining) ? t : best), null);
// The host shows a timer's last ten seconds as amber lamps, three then two then one; an
// instrument that holds the lamps shows the same, so the countdown is never lost.
const COUNTDOWN_LAMP = dim(LAMP.amber, 0.35);
export const countdownLamps = (remaining) => {
  const lit = remaining > 20 / 3 ? 3 : remaining > 10 / 3 ? 2 : 1;
  return lamps(...[0, 1, 2].map((i) => (i < lit ? COUNTDOWN_LAMP : null)));
};
// Lamps for the nearest timer: a bar that drains from the right across the three lamps
// (green turning amber as time runs out), the host's countdown in the last ten seconds.
export function timerLamps(timer) {
  if (!timer || !(timer.remaining > 0)) return lightsOff();
  if (timer.remaining <= 10) return countdownLamps(timer.remaining);
  const fraction = timer.duration > 0 ? Math.min(1, timer.remaining / timer.duration) : 1;
  return meter(fraction, dim(ramp(1 - fraction, [LAMP.green, LAMP.amber]), 0.3));
}
export class Timers {
  constructor(c) {
    this.c = c; this.navigation = true; this.selected = 0;
    this.durations = [30, 60, 300, 900, 1500, 3600];
    this.labels = ['FIELD TIMER', 'TEA', 'FOCUS', 'REST', 'COOKING', 'EXPERIMENT'];
    this.presets = (c.progress().presets || []).slice(0, 6);
    this.render();
  }
  create(seconds, label) { return this.c.command('timer', { op: 'create', seconds, label }).catch(this.c.error); }
  begin() { this.wizard = { digits: [0, 0, 0, 5, 0, 0], field: 0, label: 'FIELD TIMER' }; this.render(); }
  wizardView() {
    const w = this.wizard, digits = w.digits;
    const duration = (digits[0] * 10 + digits[1]) * 3600 + (digits[2] * 10 + digits[3]) * 60 + digits[4] * 10 + digits[5];
    const display = digits.map((d, i) => `${i && i % 2 === 0 ? ':' : ''}${i === w.field ? '[' + d + ']' : d}`).join('');
    const fields = ['hours / tens', 'hours / units', 'minutes / tens', 'minutes / units', 'seconds / tens', 'seconds / units'];
    this.paint(panel('Build a field timer', `<div class="big-readout">${display}</div><p>${w.field < 6 ? 'Choose ' + fields[w.field] : 'Choose a label, then launch or save this preset.'}</p><p>${esc(w.label)} · 5 seconds to 24 hours</p>`));
    let actions = [];
    if (w.field < 6) {
      const max = [2, 9, 5, 9, 5, 9][w.field];
      actions = Array.from({ length: max + 1 }, (_, digit) => ({ id: `digit-${w.field}-${digit}`, label: 'DIGIT / ' + digit,
        run: () => { w.digits[w.field++] = digit; this.render(); } }));
    } else {
      actions = this.labels.map(label => ({ id: 'label-' + label, label: (label === w.label ? '● ' : '') + label,
        run: () => { w.label = label; this.render(); } }));
      const valid = duration >= 5 && duration <= 86400;
      if (valid) actions.unshift({ id: 'launch-custom', label: 'START / ' + formatTime(duration) + ' / ' + w.label, run: async () => {
        await this.c.command('timer', { op: 'create', seconds: duration, label: w.label }); this.wizard = null; this.render();
      } }, { id: 'save-preset', label: 'SAVE PRESET / ' + w.label, run: () => {
        this.presets = [{ seconds: duration, label: w.label }, ...this.presets.filter(p => p.seconds !== duration || p.label !== w.label)].slice(0, 6);
        this.c.saveProgress({ schema: 1, presets: this.presets })?.catch?.(this.c.error);
        this.wizard = null; this.render();
      } });
      else this.c.hint('Duration must be between 00:00:05 and 24:00:00. Go back to edit.');
    }
    if (w.field > 0) actions.push({ id: 'back-digit', label: 'BACK / PREVIOUS DIGIT', run: () => { w.field--; this.render(); } });
    actions.push({ id: 'cancel-custom', label: 'CANCEL / RETURN TO TIMERS', run: () => { this.wizard = null; this.render(); } });
    this.c.actions(actions);
  }
  paint(html) { if (html !== this.html) { this.html = html; this.c.content(html); } }
  // The lamps follow the nearest running timer. They are only taken once a timer runs, so an
  // empty Chronometer leaves the host's own lamp feedback alone.
  lamps() {
    const near = nearestTimer(this.c.state().timers);
    if (!near && !this.lit) return;
    this.lit = true;
    this.c.leds(timerLamps(near));
  }
  hero(t) {
    const fraction = t.duration > 0 ? Math.max(0, Math.min(1, t.remaining / t.duration)) : 0;
    const state = t.finished ? 'COMPLETE' : t.running ? 'RUNNING' : 'PAUSED';
    return `<div class="timer-hero"><div><div class="data-label">${esc(t.label)} · OF ${formatTime(t.duration)}</div><span class="recording-tag">${state}</span></div><div class="big-readout">${formatTime(t.remaining)}</div></div><div class="timer-bar" role="img" aria-label="${Math.round(fraction * 100)} percent remaining"><i style="width:${(fraction * 100).toFixed(1)}%"></i></div>`;
  }
  render() {
    if (this.wizard) { this.wizardView(); this.lamps(); return; }
    const timers = this.c.state().timers || [];
    const lead = nearestTimer(timers) || timers[0];
    const others = timers.filter((t) => t !== lead);
    const row = (t) => `<div class="timer-row"><div><div class="data-label">${esc(t.label)}</div><span class="recording-tag">${t.finished ? 'COMPLETE' : t.running ? 'RUNNING' : 'PAUSED'}</span></div><div class="big-readout">${formatTime(t.remaining)}</div></div>`;
    this.paint(panel('Chronometer', lead ? this.hero(lead) + others.slice(0, 3).map(row).join('') + (others.length > 3 ? `<p>+ ${others.length - 3} MORE TIMERS</p>` : '')
      : '<div class="big-readout">00:00</div><p>Keep time beyond this screen. Build a custom duration or choose a preset.</p>'));
    this.lamps();
    const seconds = this.durations[this.selected];
    const actions = [
      { id: 'create', label: `CREATE TIMER / ${formatTime(seconds)}`, run: () => this.create(this.durations[this.selected], 'FIELD TIMER') },
      { id: 'duration', label: 'CHANGE DURATION →', run: () => { this.selected = (this.selected + 1) % this.durations.length; this.render(); } },
      { id: 'custom', label: 'CUSTOM TIMER / HH:MM:SS', run: () => this.begin() },
    ];
    this.presets.forEach((p, i) => actions.push({ id: 'preset-' + i, label: 'PRESET / ' + p.label + ' / ' + formatTime(p.seconds), run: () => this.create(p.seconds, p.label) }));
    for (const timer of timers) actions.push(
      { id: 'toggle-' + timer.id, label: `${timer.running ? 'PAUSE' : 'START'} / ${timer.label} / ${formatTime(timer.duration)}`, run: () => this.c.command('timer', { op: 'toggle', id: timer.id }) },
      { id: 'remove-' + timer.id, label: `REMOVE / ${timer.label} / ${formatTime(timer.duration)}`, run: () => this.c.command('timer', { op: 'remove', id: timer.id }) },
    );
    actions.push({ id: 'home', label: 'RETURN TO DASHBOARD', run: this.c.home });
    this.c.actions(actions); this.c.hint('Tap to advance. Hold and release to choose. Timers follow the Pi clock across restarts.');
  }
  event(e) { if (e.type === 'timers' || e.type === 'state') this.render(); }
  tick() { this.render(); }
  dispose() { if (this.lit) this.c.leds(lightsOff()); }
}

export class Transcription {
  constructor(c) {
    this.c = c; this.navigation = true; this.lines = []; this.partial = '';
    this.provisional = new Map(); this.done = new Set();   // Vosk's finished lines waiting for their refined text
    this.sessions = []; this.selected = null; this.offset = 0; this.linePage = 0; this.loading = 0;
    this.micMode = c.state().mic?.mode; this.micSession = c.state().mic?.session;
    this.render(); this.load();
  }
  async load() {
    const generation = ++this.loading;
    try {
      const sessions = await this.c.get('sessions?offset=' + this.offset);
      if (!this.c.alive() || generation !== this.loading) return;
      this.sessions = sessions;
      if (!this.selected) this.selected = this.c.state().mic?.session || sessions[0]?.id;
      if (this.selected) {
        const follow = this.selected === this.c.state().mic?.session && this.linePage >= Math.max(0, Math.ceil(this.lines.length / 12) - 1);
        const lines = await this.c.get('transcript/' + this.selected);
        if (!this.c.alive() || generation !== this.loading) return;
        this.lines = lines.map(r => r.text);
        // The saved lines now include every refined line announced so far: drop their provisional text.
        for (const utt of this.done) this.provisional.delete(utt);
        this.done.clear();
        if (follow) this.linePage = Math.max(0, Math.ceil(this.lines.length / 12) - 1);
      }
      this.render();
    } catch (error) { this.provisional.clear(); this.done.clear(); this.c.error(error); }
  }
  render() {
    const mic = this.c.state().mic || {}, active = mic.mode === 'transcribe';
    const selected = this.sessions.find(s => s.id === this.selected);
    const pages = Math.max(1, Math.ceil(this.lines.length / 12));
    this.linePage = Math.min(this.linePage, pages - 1);
    const live = active && this.selected === mic.session;
    let body = `<div class="recording-tag">${esc(microphoneStatus(this.c.state()).label)}</div>`;
    if (mic.error || mic.unavailable) body += `<p>${esc(mic.error || mic.unavailable)}</p>`;
    else if (mic.recognizer) body += `<p>${esc(recognizerLabel(this.c.state()))}${mic.recognizer.detail ? ' · ' + esc(mic.recognizer.detail) : ''}</p>`;
    body += `<p>${selected ? new Date(selected.started * 1000).toLocaleString() : 'No saved note selected'} · ${live ? 'LIVE SESSION' : selected?.ended ? 'CLOSED SESSION' : 'SAVED NOTE'} · PAGE ${this.linePage + 1} / ${pages}</p>`;
    const shown = this.lines.slice(this.linePage * 12, (this.linePage + 1) * 12).join('\n');
    // Provisional lines (Vosk's text, replaced by the refined line) and the live partial follow the saved lines.
    const tail = live && this.linePage === pages - 1 ? [...this.provisional.values(), this.partial].filter(Boolean).join('\n') : '';
    body += `<div class="transcript">${esc(shown) || (tail ? '' : 'The room has a story. Begin a field note.')}${tail ? '<span class="transcript-partial">' + (shown ? '\n' : '') + esc(tail) + '</span>' : ''}</div><p>Dictation saves text locally. It never executes console commands.</p>`;
    this.c.content(panel('Field notes', body));
    const actions = [
      { id: 'capture', label: active ? 'STOP TRANSCRIPTION' : 'START TRANSCRIPTION', run: () => this.c.setMic(active ? 'off' : 'transcribe') },
      { id: 'refresh', label: 'REFRESH SAVED NOTES', run: () => this.load() },
    ];
    if (this.selected) actions.push({ id: 'export', label: 'EXPORT SELECTED NOTE', run: () => this.c.download('/api/export/' + this.selected) });
    if (this.linePage > 0) actions.push({ id: 'prev-text', label: 'PREVIOUS TEXT PAGE', run: () => { this.linePage--; this.render(); } });
    if (this.linePage + 1 < pages) actions.push({ id: 'next-text', label: 'NEXT TEXT PAGE', run: () => { this.linePage++; this.render(); } });
    this.sessions.slice(0, 5).forEach(session => actions.push({ id: 'note-' + session.id,
      label: (this.selected === session.id ? '● ' : '') + 'READ / ' + new Date(session.started * 1000).toLocaleString() + ' / ' + session.lines + ' LINES',
      run: () => { this.selected = session.id; this.linePage = 0; this.partial = ''; return this.load(); } }));
    if (this.offset > 0) actions.push({ id: 'newer', label: 'NEWER NOTES', run: () => { this.offset = Math.max(0, this.offset - 5); return this.load(); } });
    if (this.sessions.length > 5) actions.push({ id: 'older', label: 'OLDER NOTES', run: () => { this.offset += 5; return this.load(); } });
    actions.push({ id: 'home', label: 'RETURN TO DASHBOARD', run: this.c.home });
    this.c.actions(actions); this.c.hint('Choose a note, read its pages, or export it. Capture may continue while browsing.');
  }
  event(e) {
    if (e.type === 'speech' && (!e.session || e.session === this.selected)) {
      // A final line reloads the note, and the reload renders; only provisional text renders here.
      // With a second pass a line is announced as provisional (utt) and replaced by its final line (same utt).
      if (e.provisional) { this.provisional.set(e.utt, e.text); this.render(); }
      else if (e.final && e.utt !== undefined) {
        if (e.text) { this.done.add(e.utt); this.load(); }
        else { this.provisional.delete(e.utt); this.render(); }
      }
      else if (e.final && e.text) { this.partial = ''; this.load(); }
      else { this.partial = e.text; this.render(); }
    } else if (e.type === 'mic') {
      if (e.mode === 'transcribe' && e.session !== this.selected) {
        this.selected = e.session; this.offset = 0; this.linePage = 0; this.lines = []; this.partial = '';
        this.provisional.clear(); this.done.clear();
      }
      if (e.mode !== 'transcribe') { this.partial = ''; this.provisional.clear(); this.done.clear(); }
      // The saved notes only change when the mode or session does, not on every status message.
      const changed = e.mode !== this.micMode || e.session !== this.micSession;
      this.micMode = e.mode; this.micSession = e.session;
      this.render(); if (changed) this.load();
    } else if (e.type === 'speech_error' || e.type === 'recognizer') this.render();
  }
}

export function sensorStatus(state, now = Date.now() / 1000) {
  const sensor = state.sensor;
  if (!sensor?.at) return 'NO RECENT READING';
  const age = Math.max(0, Math.floor(now - sensor.at));
  return `${!state.device.connected || age > 15 ? 'STALE / LAST READING' : state.simulated ? 'SIMULATED / UPDATED' : 'LIVE / UPDATED'} ${age}s AGO`;
}
// How old a reading is, in words that change at most once a minute (the page re-renders only when
// its markup changes, so a ticking "12s AGO" would rebuild the panel every second).
const ageWords = (age) => (age <= 15 ? 'JUST NOW' : age < 60 ? 'UNDER A MINUTE AGO' : age < 3600 ? Math.floor(age / 60) + ' MIN AGO' : Math.floor(age / 3600) + ' H AGO');
export function sensorFreshness(state, now = Date.now() / 1000) {
  const sensor = state.sensor;
  if (!sensor?.at) return 'NO RECENT READING';
  const age = Math.max(0, now - sensor.at);
  if (!state.device?.connected || age > 15) return 'STALE / LAST READING ' + ageWords(age);
  return (state.simulated ? 'SIMULATED' : 'LIVE') + ' / UPDATED ' + ageWords(age);
}

const RANGES = {
  '24h': { label: '24 HOURS', hours: 24, bucket: 300 },
  '7d': { label: '7 DAYS', hours: 168, bucket: 3600 },
  '30d': { label: '30 DAYS', hours: 720, bucket: 10800 },
};
const RANGE_ORDER = ['24h', '7d', '30d'];
// A quiet steady colour for the comfort band; the host applies the global lamp level on top.
const COMFORT_COLOUR = { dry: LAMP.amber, comfortable: LAMP.green, humid: LAMP.cyan, 'very-humid': LAMP.violet };
const COMFORT_LEVEL = 0.25;
export const comfortLamps = (humidity) => {
  const band = comfortBand(humidity);
  return band ? fill(COMFORT_COLOUR[band.id], COMFORT_LEVEL) : lightsOff();
};
const clockText = (seconds) => new Date(seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dateText = (seconds) => new Date(seconds * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' });
const spanText = (seconds) => (seconds < 7200 ? Math.max(1, Math.round(seconds / 60)) + ' MIN' : seconds < 172800 ? Math.round(seconds / 3600) + ' H' : Math.round(seconds / 86400) + ' DAYS');
const validRow = (r) => r && [r.at, r.temperature, r.humidity].every(Number.isFinite);

export class Environment {
  constructor(c) {
    this.c = c;
    this.navigation = true;
    this.range = '24h';
    this.day = [];
    this.series = {};
    this.ticks = 0;
    this.loading = 0;
    this.html = null;
    this.clock = () => Date.now() / 1000;
    this.render();
    this.load();
  }
  rows(raw) { return Array.isArray(raw) ? raw.filter(validRow).slice(-2000) : []; }
  // The service returns the last 24 hours in five-minute averages. A longer range asks for
  // `history?hours=H&bucket=S`; a service that does not know it (today's) answers with the
  // same 24 hours, which the page then shows with a note about what is missing.
  async load() {
    const generation = ++this.loading, range = this.range;
    try {
      const day = this.rows(await this.c.get('history'));
      let rows = day;
      if (range !== '24h') {
        const r = RANGES[range], longer = this.rows(await this.c.get(`history?hours=${r.hours}&bucket=${r.bucket}`));
        if (longer.length) rows = longer;
      }
      if (!this.c.alive() || generation !== this.loading) return;
      this.day = day;
      this.series[range] = rows;
      this.render();
    } catch (error) { this.c.error(error); }
  }
  chart(rows, key, color, title, convert, digits, minSpan) {
    if (rows.length < 2) return `<div><div class="data-label">${title}</div><p>Collecting history. Samples are stored every 30 seconds.</p></div>`;
    const W = 470, H = 102, L = 46, R = 8, T = 8, B = 22, pw = W - L - R, ph = H - T - B;
    const values = rows.map((r) => convert(r[key]));
    let low = Math.min(...values), high = Math.max(...values);
    if (high - low < minSpan) { const mid = (high + low) / 2; low = mid - minSpan / 2; high = mid + minSpan / 2; }
    const pad = (high - low) * 0.08; low -= pad; high += pad;
    const first = rows[0].at, last = rows.at(-1).at, span = Math.max(1, last - first);
    const x = (at) => L + ((at - first) / span) * pw, y = (v) => T + ph - ((v - low) / (high - low)) * ph;
    const points = rows.map((r, i) => `${x(r.at).toFixed(1)},${y(values[i]).toFixed(1)}`).join(' ');
    const stamp = span > 36 * 3600 ? dateText : clockText;
    const grid = [0, 0.5, 1].map((f) => { const v = low + (high - low) * f, py = y(v).toFixed(1);
      return `<path d="M${L} ${py}H${W - R}" stroke="#657b5b" stroke-opacity="${f === 0 ? 0.9 : 0.35}" fill="none"/><text x="${L - 4}" y="${(+py + 4).toFixed(1)}" text-anchor="end">${v.toFixed(digits)}</text>`; }).join('');
    return `<div><div class="data-label">${title}</div><svg class="history-chart atmo-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}, ${esc(RANGES[this.range].label.toLowerCase())}"><g fill="#a9ba9c" font-family="monospace" font-size="12">${grid}</g><polyline points="${points}" stroke="${color}" stroke-width="2" fill="none"/><g fill="#a9ba9c" font-family="monospace" font-size="12"><text x="${L}" y="${H - 5}">${esc(stamp(first))}</text><text x="${L + pw / 2}" y="${H - 5}" text-anchor="middle">${esc(stamp((first + last) / 2))}</text><text x="${W - R}" y="${H - 5}" text-anchor="end">${esc(stamp(last))}</text></g></svg></div>`;
  }
  trendText(t, digits, unit) {
    if (!t) return 'TREND / COLLECTING';
    return `${t.arrow} ${t.rate >= 0 ? '+' : '−'}${Math.abs(t.rate).toFixed(digits)} ${unit}/H${t.steady ? ' · STEADY' : ''}`;
  }
  // The lamps carry the comfort band as a steady dim colour, or the host's countdown in a
  // timer's last ten seconds. A stale or missing reading leaves them dark rather than guessing.
  lamps(live, now) {
    const near = nearestTimer(this.c.state().timers);
    if (near && near.remaining <= 10) this.c.leds(countdownLamps(near.remaining));
    else this.c.leds(live && this.c.state().device?.connected && now - live.at <= 120 ? comfortLamps(live.humidity) : lightsOff());
  }
  render() {
    const state = this.c.state(), unit = this.c.settings().tempUnit, now = this.clock();
    const sensor = state.sensor;
    const live = sensor && Number.isFinite(sensor.temperature) && Number.isFinite(sensor.humidity) ? sensor : null;
    // The case offset is applied to everything shown or derived here; history stays raw.
    const off = tempOffset(this.c.settings());
    const t = live ? live.temperature + off : undefined, h = live?.humidity, u = tempUnit(unit);
    const recent = live && Number.isFinite(live.at) && live.at > (this.day.at(-1)?.at ?? 0) ? [...this.day, live] : this.day;
    const midnight = new Date(now * 1000).setHours(0, 0, 0, 0) / 1000;
    const rawToday = extremes(recent, 'temperature', midnight);
    const today = rawToday && { min: { ...rawToday.min, value: rawToday.min.value + off }, max: { ...rawToday.max, value: rawToday.max.value + off } };
    const tTrend = trend(recent, 'temperature', now, 0.3), hTrend = trend(recent, 'humidity', now, 1.5);
    const dew = live ? dewPoint(t, h) : null, feels = live ? feelsLike(t, h) : null, absolute = live ? absoluteHumidity(t, h) : null;
    const band = live ? comfortBand(h) : null;
    const T = (celsius) => (celsius === null || celsius === undefined ? '—' : tempValue(celsius, unit).toFixed(1));
    const cell = (label, value, sub = '') => `<div><div class="data-label">${label}</div><div class="atmo-value">${value}${sub ? `<small> ${sub}</small>` : ''}</div></div>`;
    const head = (label, aside) => `<div class="data-label atmo-head"><span>${label}</span><span class="atmo-aside">${aside}</span></div>`;
    const top = `<div class="atmo-top"><div class="utility-panel">${head('TEMPERATURE' + (off ? ' · CORRECTED ' + esc(formatOffset(off, unit)) : ''), live ? this.trendText(tTrend && { ...tTrend, rate: tempDelta(tTrend.rate, unit) }, 1, u) : '')}<div class="big-readout">${T(t)}<small> ${u}</small></div></div>`
      + `<div class="utility-panel">${head('HUMIDITY', live ? this.trendText(hTrend, 1, '%') : '')}<div class="big-readout">${live ? h.toFixed(1) : '—'}<small> %</small></div></div>`
      + `<div class="utility-panel atmo-${band ? band.id : 'none'}">${head('COMFORT', band ? band.note : 'NO READING')}<div class="big-readout atmo-verdict">${band ? band.label : '—'}</div></div></div>`;
    const derived = '<div class="utility-panel atmo-derived">'
      + cell('DEW POINT', dew === null ? '—' : T(dew) + ' ' + u)
      + cell('FEELS LIKE', feels ? T(feels.celsius) + ' ' + u : '—', feels ? (feels.heat ? 'HEAT INDEX' : 'AIR TEMP') : '')
      + cell('ABS. HUMIDITY', absolute === null ? '—' : absolute.toFixed(1) + ' g/m³')
      + cell('TODAY LOW', today ? T(today.min.value) + ' ' + u : '—', today ? 'AT ' + esc(clockText(today.min.at)) : '')
      + cell('TODAY HIGH', today ? T(today.max.value) + ' ' + u : '—', today ? 'AT ' + esc(clockText(today.max.at)) : '')
      + '</div>';
    const rows = this.series[this.range] || this.day, r = RANGES[this.range];
    const covered = rows.length > 1 ? rows.at(-1).at - rows[0].at : 0;
    let note = '';
    if (covered > 0 && covered < r.hours * 3600 * 0.8) note = this.range === '24h' ? ` · ${spanText(covered)} OF HISTORY SO FAR` : ` · ONLY THE LAST ${spanText(covered)} IS AVAILABLE`;
    const degrees = unit === 'F' ? '°F' : '°C';
    const charts = `<div class="atmo-charts">${this.chart(rows, 'temperature', '#d6efa4', 'TEMPERATURE ' + degrees + ' · ' + r.label, (v) => tempValue(v + off, unit), 1, unit === 'F' ? 2 : 1)}${this.chart(rows, 'humidity', '#8fcbc5', 'HUMIDITY % · ' + r.label, (v) => v, 0, 4)}</div>`;
    const offsetNote = off ? ` · CASE OFFSET ${esc(formatOffset(off, unit))} APPLIED TO TEMPERATURE (HISTORY STORED RAW)` : '';
    const status = `<p class="recording-tag atmo-status">${esc(sensorFreshness(state, now))} · ${this.c.simulated() ? 'SIMULATED SENSOR READINGS' : 'SHT3x / LOCAL MEASUREMENTS'}${note}${offsetNote}</p>`;
    const html = top + derived + `<div class="utility-panel atmo-history">${status}${charts}</div>`;
    if (html !== this.html) { this.html = html; this.c.content(html); }
    this.lamps(live, now);
    this.c.actions([
      { id: 'range', label: 'RANGE / ' + r.label, run: () => { this.range = RANGE_ORDER[(RANGE_ORDER.indexOf(this.range) + 1) % RANGE_ORDER.length]; this.render(); this.load(); } },
      { id: 'refresh', label: 'REFRESH HISTORY', run: () => this.load() },
      { id: 'off-down', label: 'CASE OFFSET COOLER / ' + formatOffset(off - OFFSET_STEP, unit), run: () => this.setOffset(off - OFFSET_STEP) },
      { id: 'off-up', label: 'CASE OFFSET WARMER / ' + formatOffset(off + OFFSET_STEP, unit), run: () => this.setOffset(off + OFFSET_STEP) },
      ...(off ? [{ id: 'off-zero', label: 'CASE OFFSET / CLEAR ' + formatOffset(off, unit), run: () => this.setOffset(0) }] : []),
      { id: 'home', label: 'RETURN TO DASHBOARD', run: this.c.home },
    ]);
    this.c.hint(`Case offset corrects the sensor's self-heating (steps of 0.5 °C). Feels like: NWS heat index from ${unit === "F" ? "80 °F" : "26.7 °C"} and 40 % RH, else air temperature. The lamps show comfort.`);
  }
  setOffset(value) {
    return this.c.command('settings', { key: 'tempOffset', value: clampOffset(value) }).catch(this.c.error);
  }
  event(e) {
    if (['sensor', 'device', 'settings', 'timers'].includes(e.type)) this.render();
  }
  tick() {
    if (++this.ticks % 60 === 0) this.load();
    this.render();
  }
  dispose() { this.c.leds(lightsOff()); }
}

const LAMP_SCALE = { full: 1, medium: 0.5, low: 0.2, off: 0 };
// esp_err_t values the sensor driver is likely to report (esp_err.h).
const ESP_ERRORS = { 0: 'NONE', '-1': 'FAIL', 0x101: 'NO MEMORY', 0x102: 'INVALID ARGUMENT', 0x103: 'INVALID STATE', 0x104: 'INVALID SIZE', 0x105: 'NOT FOUND', 0x106: 'NOT SUPPORTED', 0x107: 'TIMEOUT', 0x108: 'INVALID RESPONSE', 0x109: 'BAD CRC' };
// The node's sensor diagnostics (firmware 0.1.2 status: addr, ok, fail, err) as two display strings.
export function sensorBus(sensor) {
  if (!sensor || typeof sensor !== 'object') return { bus: '—', error: '—' };
  const { addr, ok, fail, err } = sensor;
  const count = (n) => (Number.isFinite(n) ? n : '—');
  const bus = !Number.isFinite(addr) || addr === 0 ? `NOT FOUND · ${count(fail)} FAIL` : `0x${addr.toString(16).toUpperCase()} · ${count(ok)} OK · ${count(fail)} FAIL`;
  const error = !Number.isFinite(err) ? '—' : err === 0 ? 'NONE' : (ESP_ERRORS[err] ? ESP_ERRORS[err] + ' ' : '') + '(' + (err < 0 ? '-' : '') + '0x' + Math.abs(err).toString(16) + ')';
  return { bus, error };
}

export class Diagnostics {
  constructor(c) {
    this.c = c;
    this.navigation = true;
    this.led = 0;
    this.colour = 0;
    this.lastButton = "—";
    this.node = null;
    this.lastLevel = -Infinity;
    this.html = null;
    this.colours = [
      [0, 0, 0],
      [180, 0, 0],
      [0, 180, 0],
      [0, 0, 180],
      [100, 100, 100],
    ];
    this.names = ["OFF", "RED", "GREEN", "BLUE", "WHITE"];
    this.render();
  }
  level() {
    const level = this.c.settings().lampLevel;
    return LAMP_SCALE[level] === undefined ? 'medium' : level;
  }
  render() {
    const s = this.c.state(),
      d = s.device || {},
      sensor = s.sensor,
      level = this.level(),
      node = this.node,
      bus = sensorBus(node?.sensor);
    const waiting = s.simulated ? 'SIMULATOR' : d.connected ? 'AWAITING STATUS' : '—';
    const rows = [
      ["NODE", d.connected ? "CONNECTED" : "DISCONNECTED"],
      ["SOURCE", s.simulated ? "SIMULATOR" : "ESP32-S3"],
      ["LINK", node?.link ? String(node.link).toUpperCase() : waiting],
      ["FIRMWARE", node?.fw ? String(node.fw) : waiting],
      ["BUTTON", d.button ? "DOWN" : "UP"],
      ["NODE IDENTITY", (d.name || "—") + " · CONN " + (d.generation || 0)],
      ["SENSOR BUS", node ? bus.bus : waiting],
      ["SENSOR LAST ERROR", node ? bus.error : waiting],
      ["SENSOR", sensor ? `${formatSensorTemp(sensor.temperature, this.c.settings().tempUnit, 1, this.c.settings())}${tempOffset(this.c.settings()) ? ' (CASE OFFSET ' + formatOffset(tempOffset(this.c.settings()), this.c.settings().tempUnit) + ')' : ''} / ${sensor.humidity.toFixed(1)}%` : "NO READING"],
      ["LAMP LEVEL", level.toUpperCase()],
      ["FRAME / p95", (this.c.stats?.().p95Ms || 0).toFixed(1) + " ms"],
      ["SPEECH DROPS", s.mic?.droppedChunks || 0],
      ["MIC MODE", s.mic?.mode || "off"],
      ["CAPTURE", !d.connected ? "UNKNOWN / NO LINK" : d.capture ? "ACTIVE" : "OFF"],
      ["MIC LEVEL", Math.round((s.mic?.level || 0) * 100) + "%"],
      ["AUDIO BYTES", d.audioBytes || 0],
      ["CRC ERRORS", d.crcErrors || 0],
      ["MISSING SAMPLES", d.missingSamples || 0],
    ];
    const notice = level === 'off' ? '<p class="recording-tag">LAMP LEVEL IS OFF (CALIBRATION): CHANNEL CHECKS CANNOT LIGHT THE LAMPS.</p>'
      : level === 'low' ? '<p class="recording-tag">LAMP LEVEL IS LOW (CALIBRATION): CHANNEL CHECKS ARE DIM.</p>' : '';
    const html = panel(
      "Node instruments",
      `<div class="diag-list">${rows.map(([k, v]) => `<div class="diag-item"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}</div>${notice}<p>Button GPIO 12/46 · mic 4/5/6 · sensor SDA 13 / SCL 14.<br>LED R/G/B: LEFT 15/7/16 · MIDDLE 18/17/8 · RIGHT 11/9/10.</p>`,
    );
    if (html !== this.html) { this.html = html; this.c.content(html); }
    this.c.actions([
      { id: "report", label: "EXPORT DIAGNOSTICS", run: () => { const t = this.c.state(); this.c.downloadText("vesper-diagnostics.json", JSON.stringify({ version: t.version, simulated: t.simulated, device: t.device, node: this.node, lampLevel: this.level(), microphone: { mode: t.mic?.mode, error: t.mic?.error, droppedChunks: t.mic?.droppedChunks }, sensor: t.sensor, frames: this.c.stats?.() }, null, 2)); } },
      {
        id: "select-light",
        label: "SELECT LIGHT / " + ["LEFT", "MIDDLE", "RIGHT"][this.led],
        run: () => {
          this.led = (this.led + 1) % 3;
          this.render();
        },
      },
      {
        id: "test-colour",
        label: "TEST COLOUR / " + this.names[this.colour] + (level === 'off' ? " / LAMPS OFF" : ""),
        run: () => {
          this.colour = (this.colour + 1) % this.colours.length;
          const values = Array(9).fill(0);
          values.splice(this.led * 3, 3, ...this.colours[this.colour]);
          this.c.leds(values);
          if (this.colour && this.level() === 'off') this.c.toast("Lamp level is OFF in Calibration, so this channel check cannot light the lamp.");
          this.render();
        },
      },
      {
        id: "lights-off",
        label: "ALL LIGHTS OFF",
        run: () => {
          this.colour = 0;
          this.c.leds(Array(9).fill(0));
          this.render();
        },
      },
      {
        id: "mic",
        label: s.mic?.mode === "commands" ? "DISABLE MIC" : "ENABLE VOICE / MIC METER",
        run: () => { const mode = this.c.state().mic?.mode; this.c.setMic(mode === "commands" ? "off" : "commands"); },
      },
      {
        id: "audio-test",
        label: "PLAY AUDIO TEST",
        run: () => {
          this.c.synth.chime();
          this.c.toast("Tone sent to the Pi/browser audio output.");
        },
      },
      { id: "home", label: "RETURN TO DASHBOARD", run: this.c.home },
    ]);
    this.c.hint("Tap to advance. Hold and release to run a check.");
  }
  event(e) {
    if (e.type === "button") {
      this.lastButton = e.pressed ? "DOWN" : "UP";
      this.render();
    } else if (e.type === "node_status") {
      this.node = { link: e.link, fw: e.fw, sensor: e.sensor };
      this.render();
    } else if (e.type === "node_reset" || (e.type === "device" && e.connected === false)) {
      this.node = null;
      this.render();
    } else if (e.type === "level") {
      // The level arrives about eight times a second; twice a second is enough to read.
      const now = performance.now();
      if (now - this.lastLevel >= 500) { this.lastLevel = now; this.render(); }
    } else if (["device", "sensor", "mic", "settings"].includes(e.type)) this.render();
  }
  tick() { this.render(); }
  dispose() {
    this.c.leds(Array(9).fill(0));
  }
}


// The voice command list, one category per page. The spoken forms are the generated families in
// vesper/commands.py; the app names come from the catalog.
export function voicePages() {
  const shown = (say) => 'computer ' + say.replace(/<(minutes|seconds)>/, '(NUMBER)').replace('<app>', '(APP)');
  return VOICE_HELP.map((page) => {
    let body = page.entries.map((entry) => `<p><strong>“${esc(entry.say.map(shown).join('” or “'))}”</strong> · ${esc(entry.does)}</p>`).join('');
    if (page.title === 'OPEN AN APP')
      body += `<p>${CARTRIDGES.map((app) => esc(app.voice[0]) + ' = ' + esc(app.name)).join(' · ')}</p>`;
    return { title: page.title, body };
  });
}
export class Settings {
  constructor(c) {
    this.c = c;
    this.navigation = true;
    this.voicePage = null;
    this.render();
  }
  renderVoice() {
    const pages = voicePages(), page = pages[this.voicePage];
    this.c.content(panel('Voice commands ' + (this.voicePage + 1) + ' / ' + pages.length + ' · ' + page.title,
      `${this.voicePage === 0 ? '<p>Choose VOICE COMMANDS in the microphone menu, say “computer” and then the phrase, then pause. Dictation never runs commands.</p>' : ''}${page.body}`));
    this.c.actions([
      { id: 'voice-next', label: 'NEXT PAGE', run: () => { this.voicePage = (this.voicePage + 1) % pages.length; this.render(); } },
      { id: 'voice-back', label: 'BACK TO CALIBRATION', run: () => { this.voicePage = null; this.render(); } },
      { id: 'home', label: 'RETURN TO DASHBOARD', run: this.c.home },
    ]);
    this.c.hint('Tap to advance. Hold and release to turn the page.');
  }
  setting(key, value) {
    this.c.command("settings", { key, value }).catch(this.c.error);
  }
  render() {
    if (this.voicePage !== null) return this.renderVoice();
    const s = this.c.settings();
    this.c.content(
      panel(
        "Adjust the instrument",
        "<p>Every setting is reachable with the arcade button. Voice uses the prefix <strong>“computer”</strong>. Sound plays through the Pi or browser audio output.</p><p>Games use four quick clicks for the menu by default. Signal School and Echo Vault reserve a three-second hold to protect their tap patterns. Menus use a three-second hold too. The microphone always starts muted after a service restart.</p>",
      ),
    );
    this.c.actions([
      {
        id: "sound",
        label: "SOUND / " + (s.sound ? "ON" : "OFF"),
        run: () => this.setting("sound", !s.sound),
      },
      {
        id: "volume",
        label: "VOLUME / " + Math.round(s.volume * 100) + "%",
        run: () =>
          this.setting(
            "volume",
            s.volume >= 0.99 ? 0 : Math.round((s.volume + 0.25) * 100) / 100,
          ),
      },
      {
        id: "crt",
        label: "PHOSPHOR TEXTURE / " + (s.crt ? "ON" : "OFF"),
        run: () => this.setting("crt", !s.crt),
      },
      {
        id: "reduced-motion",
        label: "REDUCED MOTION / " + (s.reducedMotion ? "ON" : "OFF"),
        run: () => this.setting("reducedMotion", !s.reducedMotion),
      },
      {
        id: "morse-wpm",
        label: "MORSE / " + s.morseWpm + " WPM",
        run: () =>
          this.setting("morseWpm", s.morseWpm >= 25 ? 5 : s.morseWpm + 5),
      },
      {
        id: "select-hold",
        label: "SELECT HOLD / " + s.holdMs + " ms",
        run: () =>
          this.setting("holdMs", s.holdMs >= 1000 ? 450 : s.holdMs + 100),
      },
      { id: 'temp-unit', label: 'TEMPERATURE / ' + (s.tempUnit === 'F' ? 'FAHRENHEIT' : 'CELSIUS'),
        run: () => this.setting('tempUnit', s.tempUnit === 'F' ? 'C' : 'F') },
      { id: 'menu-clicks', label: 'GAME MENU / ' + (s.menuClicks ? s.menuClicks + ' QUICK CLICKS' : 'HOLD 3s'),
        run: () => this.setting('menuClicks', s.menuClicks === 4 ? 3 : s.menuClicks === 3 ? 0 : 4) },
      { id: 'lamp-level', label: 'LAMP LEVEL / ' + String(s.lampLevel || 'medium').toUpperCase(),
        run: () => this.setting('lampLevel', ({ full: 'medium', medium: 'low', low: 'off', off: 'full' })[s.lampLevel] || 'full') },
      { id: 'lamp-ambient', label: 'AMBIENT GLOW / ' + (s.lampAmbient === false ? 'OFF' : 'ON'),
        run: () => this.setting('lampAmbient', s.lampAmbient === false) },
      { id: 'gesture-pace', label: 'CLICK TIMING / ' + s.gesturePace.toUpperCase(),
        run: () => this.setting('gesturePace', ({ quick: 'standard', standard: 'relaxed', relaxed: 'quick' })[s.gesturePace]) },
      { id: 'scan-speed', label: 'ANSWER SCAN / ' + s.scanMs + ' ms',
        run: () => this.setting('scanMs', ({ 600: 850, 850: 1200, 1200: 1600, 1600: 600 })[s.scanMs] || 850) },
      { id: 'reset-settings', label: this.confirmReset ? 'CONFIRM / RESET SETTINGS ONLY' : 'RESET SETTINGS…', run: () => {
        if (this.confirmReset) { this.confirmReset = false; return this.c.command('reset_settings'); }
        this.confirmReset = true; this.render();
      } },
      { id: "voice-help", label: "VOICE COMMANDS", run: () => { this.voicePage = 0; this.render(); } },
      { id: "home", label: "RETURN TO DASHBOARD", run: this.c.home },
    ]);
    this.c.hint("Tap to advance. Hold and release to change a setting.");
  }
  event(e) {
    if (e.type === "settings") this.render();
  }
}
