import { escapeHTML as esc, formatTime } from "../engine/math.js";
import { microphoneStatus } from "../engine/status.js";
const panel = (title, body) =>
  `<div class="utility-panel"><h2>${esc(title)}</h2>${body}</div>`;
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
    this.c.content(panel('Build a field timer', `<div class="big-readout">${display}</div><p>${w.field < 6 ? 'Choose ' + fields[w.field] : 'Choose a label, then launch or save this preset.'}</p><p>${esc(w.label)} · 5 seconds to 24 hours</p>`));
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
  render() {
    if (this.wizard) { this.wizardView(); return; }
    const timers = this.c.state().timers || [];
    this.c.content(panel('Chronometer', timers.length ? timers.map(t =>
      `<div class="timer-row"><div><div class="data-label">${esc(t.label)}</div><span class="recording-tag">${t.finished ? 'COMPLETE' : t.running ? 'RUNNING' : 'PAUSED'}</span></div><div class="big-readout">${formatTime(t.remaining)}</div></div>`).join('') : '<div class="big-readout">00:00</div><p>Keep time beyond this screen. Build a custom duration or choose a preset.</p>'));
    const seconds = this.durations[this.selected];
    const actions = [
      { id: 'create', label: `CREATE TIMER / ${formatTime(seconds)}`, run: () => this.create(seconds, 'FIELD TIMER') },
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
}

export class Transcription {
  constructor(c) {
    this.c = c; this.navigation = true; this.lines = []; this.partial = '';
    this.sessions = []; this.selected = null; this.offset = 0; this.linePage = 0; this.loading = 0;
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
        if (follow) this.linePage = Math.max(0, Math.ceil(this.lines.length / 12) - 1);
      }
      this.render();
    } catch (error) { this.c.error(error); }
  }
  render() {
    const mic = this.c.state().mic || {}, active = mic.mode === 'transcribe';
    const selected = this.sessions.find(s => s.id === this.selected);
    const pages = Math.max(1, Math.ceil(this.lines.length / 12));
    this.linePage = Math.min(this.linePage, pages - 1);
    const live = active && this.selected === mic.session;
    let body = `<div class="recording-tag">${esc(microphoneStatus(this.c.state()).label)}</div>`;
    if (mic.error || mic.unavailable) body += `<p>${esc(mic.error || mic.unavailable)}</p>`;
    body += `<p>${selected ? new Date(selected.started * 1000).toLocaleString() : 'No saved note selected'} · ${live ? 'LIVE SESSION' : selected?.ended ? 'CLOSED SESSION' : 'SAVED NOTE'} · PAGE ${this.linePage + 1} / ${pages}</p>`;
    const shown = this.lines.slice(this.linePage * 12, (this.linePage + 1) * 12).join('\n');
    body += `<div class="transcript">${esc(shown) || 'The room has a story. Begin a field note.'}${live && this.linePage === pages - 1 && this.partial ? '<span class="transcript-partial">\n' + esc(this.partial) + '</span>' : ''}</div><p>Dictation saves text locally. It never executes console commands.</p>`;
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
      if (e.final && e.text) { this.partial = ''; this.load(); }
      else this.partial = e.text;
      this.render();
    } else if (e.type === 'mic') {
      if (e.mode === 'transcribe' && e.session !== this.selected) {
        this.selected = e.session; this.offset = 0; this.linePage = 0; this.lines = []; this.partial = '';
      }
      this.render(); this.load();
    } else if (e.type === 'speech_error') this.render();
  }
}

export function sensorStatus(state, now = Date.now() / 1000) {
  const sensor = state.sensor;
  if (!sensor?.at) return 'NO RECENT READING';
  const age = Math.max(0, Math.floor(now - sensor.at));
  return `${!state.device.connected || age > 15 ? 'STALE / LAST READING' : state.simulated ? 'SIMULATED / UPDATED' : 'LIVE / UPDATED'} ${age}s AGO`;
}
export class Environment {
  constructor(c) {
    this.c = c;
    this.navigation = true;
    this.history = [];
    this.render();
    this.load();
  }
  async load() {
    try {
      const h = await this.c.get("history");
      if (this.c.alive()) {
        this.history = h;
        this.render();
      }
    } catch (error) {
      this.c.error(error);
    }
  }
  chart(key, color, label) {
    if (this.history.length < 2)
      return `<p>Collecting ${label.toLowerCase()} history. Samples are stored every 30 seconds.</p>`;
    const values = this.history.map((r) => r[key]),
      low = Math.min(...values) - 0.5,
      high = Math.max(...values) + 0.5,
      first = this.history[0].at,
      last = this.history.at(-1).at;
    const points = this.history
      .map(
        (r) =>
          `${45 + ((r.at - first) / (last - first)) * 640},${140 - ((r[key] - low) / (high - low)) * 110}`,
      )
      .join(" ");
    return `<svg class="history-chart" viewBox="0 0 710 175" role="img" aria-label="${label} over the recorded portion of the last 24 hours"><path d="M45 25V145H685" stroke="#657b5b" fill="none"/><polyline points="${points}" stroke="${color}" stroke-width="2" fill="none"/><g fill="#a9ba9c" font-family="monospace" font-size="13"><text x="3" y="35">${high.toFixed(1)}</text><text x="3" y="143">${low.toFixed(1)}</text><text x="45" y="170">${esc(new Date(first * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))}</text><text x="610" y="170">${esc(new Date(last * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))}</text></g></svg>`;
  }
  render() {
    const sensor = this.c.state().sensor;
    this.c.content(
      `<div class="readout-grid"><div class="utility-panel"><div class="data-label">TEMPERATURE</div><div class="big-readout">${sensor ? sensor.temperature.toFixed(1) : "—"}<small> °C</small></div></div><div class="utility-panel"><div class="data-label">HUMIDITY</div><div class="big-readout">${sensor ? sensor.humidity.toFixed(1) : "—"}<small> %</small></div></div></div>` +
        panel(
          "The atmosphere around you",
          `<p class="recording-tag">${sensorStatus(this.c.state())}</p><p>${this.c.simulated() ? "SIMULATED SENSOR READINGS" : "SHT3x / local measurements"} · 24-hour history · 30-day retention.</p>` +
            this.chart(
              "temperature",
              "#d6efa4",
              "Temperature in degrees Celsius",
            ) +
            this.chart("humidity", "#8fcbc5", "Relative humidity in percent"),
        ),
    );
    this.c.actions([
      { label: "REFRESH HISTORY", run: () => this.load() },
      { label: "RETURN TO DASHBOARD", run: this.c.home },
    ]);
    this.c.hint("Tap to advance. Hold and release to choose.");
  }
  event(e) {
    if (["sensor", "device"].includes(e.type)) this.render();
  }
  tick() { this.render(); }
}

export class Diagnostics {
  constructor(c) {
    this.c = c;
    this.navigation = true;
    this.led = 0;
    this.colour = 0;
    this.lastButton = "—";
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
  render() {
    const s = this.c.state(),
      d = s.device || {},
      sensor = s.sensor;
    const rows = [
      ["NODE", d.connected ? "CONNECTED" : "DISCONNECTED"],
      ["SOURCE", s.simulated ? "SIMULATOR" : "ESP32-S3"],
      ["BUTTON", d.button ? "DOWN" : "UP"],
      ["NODE IDENTITY", d.name || "—"],
      ["CONNECTION", d.generation || 0],
      ["FRAME / p95", (this.c.stats?.().p95Ms || 0).toFixed(1) + " ms"],
      ["SPEECH DROPS", s.mic?.droppedChunks || 0],
      ["MIC MODE", s.mic?.mode || "off"],
      ["CAPTURE", !d.connected ? "UNKNOWN / NO LINK" : d.capture ? "ACTIVE" : "OFF"],
      ["MIC LEVEL", Math.round((s.mic?.level || 0) * 100) + "%"],
      ["AUDIO BYTES", d.audioBytes || 0],
      ["CRC ERRORS", d.crcErrors || 0],
      ["MISSING SAMPLES", d.missingSamples || 0],
      [
        "SENSOR",
        sensor
          ? `${sensor.temperature.toFixed(1)} °C / ${sensor.humidity.toFixed(1)}%`
          : "NO READING",
      ],
    ];
    this.c.content(
      panel(
        "Node instruments",
        `<div class="diag-list">${rows.map(([k, v]) => `<div class="diag-item"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}</div><p>Button GPIO 7 · mic 4/5/6 · sensor 8/9.<br>LED order: LEFT 14/13/12 · MIDDLE 11/10/18 · RIGHT 17/16/15 (R/G/B).</p>`,
      ),
    );
    this.c.actions([
      { id: "report", label: "EXPORT DIAGNOSTICS", run: () => this.c.downloadText("vesper-diagnostics.json", JSON.stringify({ version: s.version, simulated: s.simulated, device: s.device, microphone: { mode: s.mic?.mode, error: s.mic?.error, droppedChunks: s.mic?.droppedChunks }, sensor: s.sensor, frames: this.c.stats?.() }, null, 2)) },
      {
        label: "SELECT LIGHT / " + ["LEFT", "MIDDLE", "RIGHT"][this.led],
        run: () => {
          this.led = (this.led + 1) % 3;
          this.render();
        },
      },
      {
        label: "TEST COLOUR / " + this.names[this.colour],
        run: () => {
          this.colour = (this.colour + 1) % this.colours.length;
          const values = Array(9).fill(0);
          values.splice(this.led * 3, 3, ...this.colours[this.colour]);
          this.c.leds(values);
          this.render();
        },
      },
      {
        label: "ALL LIGHTS OFF",
        run: () => {
          this.colour = 0;
          this.c.leds(Array(9).fill(0));
          this.render();
        },
      },
      {
        label:
          s.mic?.mode === "commands"
            ? "DISABLE MIC"
            : "ENABLE VOICE / MIC METER",
        run: () =>
          this.c.setMic(s.mic?.mode === "commands" ? "off" : "commands"),
      },
      {
        label: "PLAY AUDIO TEST",
        run: () => {
          this.c.synth.chime();
          this.c.toast("Tone sent to the Pi/browser audio output.");
        },
      },
      { label: "RETURN TO DASHBOARD", run: this.c.home },
    ]);
    this.c.hint("Tap to advance. Hold and release to run a check.");
  }
  event(e) {
    if (e.type === "button") {
      this.lastButton = e.pressed ? "DOWN" : "UP";
      this.render();
    } else if (
      ["level", "node_status", "device", "sensor", "mic"].includes(e.type)
    )
      this.render();
  }
  dispose() {
    this.c.leds(Array(9).fill(0));
  }
}

export class Settings {
  constructor(c) {
    this.c = c;
    this.navigation = true;
    this.render();
  }
  setting(key, value) {
    this.c.command("settings", { key, value }).catch(this.c.error);
  }
  render() {
    const s = this.c.settings();
    this.c.content(
      panel(
        "Adjust the instrument",
        "<p>Every setting is reachable with the arcade button. Voice uses the prefix <strong>“computer”</strong>. Sound plays through the Pi or browser audio output.</p><p>Games use four quick clicks for the menu by default. Signal School and Echo Vault reserve a three-second hold to protect their tap patterns. Menus use a three-second hold too. The microphone always starts muted after a service restart.</p>",
      ),
    );
    this.c.actions([
      {
        label: "SOUND / " + (s.sound ? "ON" : "OFF"),
        run: () => this.setting("sound", !s.sound),
      },
      {
        label: "VOLUME / " + Math.round(s.volume * 100) + "%",
        run: () =>
          this.setting(
            "volume",
            s.volume >= 0.99 ? 0 : Math.round((s.volume + 0.25) * 100) / 100,
          ),
      },
      {
        label: "PHOSPHOR TEXTURE / " + (s.crt ? "ON" : "OFF"),
        run: () => this.setting("crt", !s.crt),
      },
      {
        label: "REDUCED MOTION / " + (s.reducedMotion ? "ON" : "OFF"),
        run: () => this.setting("reducedMotion", !s.reducedMotion),
      },
      {
        label: "MORSE / " + s.morseWpm + " WPM",
        run: () =>
          this.setting("morseWpm", s.morseWpm >= 25 ? 5 : s.morseWpm + 5),
      },
      {
        label: "SELECT HOLD / " + s.holdMs + " ms",
        run: () =>
          this.setting("holdMs", s.holdMs >= 1000 ? 450 : s.holdMs + 100),
      },
      { id: 'menu-clicks', label: 'GAME MENU / ' + (s.menuClicks ? s.menuClicks + ' QUICK CLICKS' : 'HOLD 3s'),
        run: () => this.setting('menuClicks', s.menuClicks === 4 ? 3 : s.menuClicks === 3 ? 0 : 4) },
      { id: 'gesture-pace', label: 'CLICK TIMING / ' + s.gesturePace.toUpperCase(),
        run: () => this.setting('gesturePace', ({ quick: 'standard', standard: 'relaxed', relaxed: 'quick' })[s.gesturePace]) },
      { id: 'scan-speed', label: 'ANSWER SCAN / ' + s.scanMs + ' ms',
        run: () => this.setting('scanMs', ({ 600: 850, 850: 1200, 1200: 1600, 1600: 600 })[s.scanMs] || 850) },
      { id: 'reset-settings', label: this.confirmReset ? 'CONFIRM / RESET SETTINGS ONLY' : 'RESET SETTINGS…', run: () => {
        if (this.confirmReset) { this.confirmReset = false; return this.c.command('reset_settings'); }
        this.confirmReset = true; this.render();
      } },
      {
        label: "VOICE COMMANDS",
        run: () =>
          this.c.help(
            "Say “computer open orbit”, “computer open morse”, “computer home”, “computer pause”, “computer resume”, or “computer timer five minutes”. Enable commands in the microphone menu first. During transcription, speech is saved as text and never runs commands.",
          ),
      },
      { label: "RETURN TO DASHBOARD", run: this.c.home },
    ]);
    this.c.hint("Tap to advance. Hold and release to change a setting.");
  }
  event(e) {
    if (e.type === "settings") this.render();
  }
}
