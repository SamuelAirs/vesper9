// What a recognised voice command asks the host to do. Pure functions, so the decisions (including the
// refusals for a context where a command makes no sense) are testable without a DOM; web/main.js `voice()`
// performs the plan with the host's own functions. The phrases themselves live in vesper/commands.py.
import { formatTime, formatTemp, comfortBand } from "./math.js";
import { LAMP, fill, meter, dim, ramp } from "./lightshow.js";

export const LAMP_LEVELS = ["off", "low", "medium", "full"];
const LAMP_ANSWER_MS = 2500;

// Colour for the temperature answer: cold, comfortable, warm, hot.
export function temperatureLamps(celsius) {
  const colour = celsius < 16 ? LAMP.cyan : celsius < 26 ? LAMP.green : celsius < 30 ? LAMP.amber : LAMP.red;
  return fill(colour, 0.4);
}
const COMFORT = { dry: LAMP.amber, comfortable: LAMP.green, humid: LAMP.cyan, "very-humid": LAMP.violet };
const upper = (text) => String(text).toUpperCase();

// c: { scene: "dashboard" | "menu" | "instrument" | "game", items, controller, faulted, timers, settings,
//      sensor, connected, mic, now (ms), lampsFree }
// -> { run, say, ... }  run is what the host does (null = nothing); say is the confirmation or the reason.
export function planVoice(e, c) {
  const refuse = (say) => ({ run: null, say, refused: true });
  const act = (run, say = "", extra = {}) => ({ run, say, ...extra });
  const settings = c.settings || {};
  const needController = () => (c.controller === false ? refuse("MONITOR TAB / USE THE CONTROLLING TAB") : null);
  switch (e.action) {
    case "next":
    case "previous":
      if (c.scene === "game") return refuse("NOT IN A GAME / OPEN THE MENU FIRST");
      return c.items ? act(e.action, "", { report: "focus" }) : refuse("NOTHING TO MOVE");
    case "select":
      if (c.scene === "game") return refuse("NOT IN A GAME / OPEN THE MENU FIRST");
      return c.items ? act("select", "", { report: "chosen" }) : refuse("NOTHING TO SELECT");
    case "sector":
      return c.scene === "dashboard" ? act("sector", "", { report: "sector" }) : refuse("NEXT SECTOR / DASHBOARD ONLY");
    case "home":
      return c.scene === "dashboard" ? refuse("ALREADY ON THE DASHBOARD") : act("home");
    case "pause":
      return c.scene === "menu" ? refuse("THE MENU IS ALREADY OPEN") : act("menu");
    case "resume":
      if (c.scene !== "menu") return refuse("NOTHING TO RESUME");
      return c.faulted ? refuse("APP STOPPED / CHOOSE RESTART") : act("resume");
    case "launch":
      return act("launch", "", { app: e.app });
    case "timer":   // created by the service, which reports the result
    case "mute":
      return act(null, e.result || "");
    case "timer_cancel":
    case "timer_pause":
    case "timer_resume": {
      const blocked = needController();
      if (blocked) return blocked;
      const last = (c.timers || []).at(-1);
      if (!last) return refuse("NO TIMERS");
      const name = `${last.label} ${formatTime(last.duration)}`;
      if (e.action === "timer_cancel") return act("timer", "TIMER REMOVED / " + name, { op: "remove", id: last.id });
      if (e.action === "timer_pause") {
        if (last.finished) return refuse("TIMER IS COMPLETE / SAY CANCEL TIMER");
        if (!last.running) return refuse("TIMER ALREADY PAUSED");
        return act("timer", "TIMER PAUSED / " + name, { op: "toggle", id: last.id });
      }
      if (last.finished) return refuse("TIMER IS COMPLETE / SAY CANCEL TIMER");
      if (last.running) return refuse("TIMER ALREADY RUNNING");
      return act("timer", "TIMER RESUMED / " + name, { op: "toggle", id: last.id });
    }
    case "dictation_start": {
      const blocked = needController();
      if (blocked) return blocked;
      if (c.mic?.unavailable) return refuse("DICTATION NEEDS LOCAL SPEECH / NOT INSTALLED");
      return act("dictation", "FIELD NOTES / TRANSCRIBING");
    }
    case "dictation_stop":
      // Dictation never hears commands, so this can only be heard while dictation is off.
      return c.mic?.mode === "transcribe" ? act("commands", "DICTATION STOPPED") :
        refuse("NOT DICTATING / DICTATION CANNOT HEAR COMMANDS, STOP IT WITH THE BUTTON");
    case "lamps": {
      const blocked = needController();
      if (blocked) return blocked;
      const level = LAMP_LEVELS.includes(settings.lampLevel) ? settings.lampLevel : "medium", at = LAMP_LEVELS.indexOf(level);
      const target = e.to === "off" ? "off" : e.to === "on" ? (level === "off" ? "medium" : level)
        : LAMP_LEVELS[Math.max(0, Math.min(LAMP_LEVELS.length - 1, at + (e.to === "up" ? 1 : -1)))];
      if (target === level) return refuse(e.to === "on" ? "LAMPS ALREADY ON" : e.to === "up" ? "LAMPS ALREADY AT FULL" : "LAMPS ALREADY OFF");
      return act("setting", "LAMPS / " + upper(target), { key: "lampLevel", value: target });
    }
    case "sound": {
      const blocked = needController();
      if (blocked) return blocked;
      const on = e.to === "on";
      return settings.sound === on ? refuse("SOUND ALREADY " + (on ? "ON" : "OFF")) : act("setting", "SOUND / " + (on ? "ON" : "OFF"), { key: "sound", value: on });
    }
    case "volume": {
      const blocked = needController();
      if (blocked) return blocked;
      const volume = Number.isFinite(settings.volume) ? settings.volume : 0.25;
      const value = Math.round(Math.max(0, Math.min(1, volume + (e.to === "up" ? 0.25 : -0.25))) * 100) / 100;
      if (value === volume) return refuse(e.to === "up" ? "VOLUME ALREADY AT MAXIMUM" : "VOLUME ALREADY AT MINIMUM");
      return act("setting", "VOLUME / " + Math.round(value * 100) + "%", { key: "volume", value });
    }
    case "ask":
      return answer(e.about, c);
    default:
      return refuse("NOT A COMMAND THIS SCREEN KNOWS");
  }
}

// Questions are answered on screen (no speech synthesis) and, when the host owns the lamps, on the lamps.
export function answer(about, c) {
  const unit = c.settings?.tempUnit;
  const reply = (say, lamps = null) => ({ run: "answer", say, lamps: c.lampsFree ? lamps : null, lampMs: LAMP_ANSWER_MS });
  const none = (say) => ({ run: null, say, refused: true });
  const sensor = c.sensor;
  const stale = !c.connected || !sensor?.at || c.now / 1000 - sensor.at > 15;
  if (about === "time") {
    const when = new Date(c.now);
    return reply("TIME / " + when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) + " · " +
      upper(when.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })));
  }
  if (about === "temperature" || about === "humidity") {
    if (!sensor || !Number.isFinite(sensor.temperature) || !Number.isFinite(sensor.humidity)) return none("NO SENSOR READING YET");
    const old = stale ? " / STALE READING" : "";
    if (about === "temperature") return reply("TEMPERATURE / " + formatTemp(sensor.temperature, unit) + old, stale ? null : temperatureLamps(sensor.temperature));
    const band = comfortBand(sensor.humidity);
    return reply(`HUMIDITY / ${sensor.humidity.toFixed(0)} % RH / ${band ? band.label : ""}${old}`, stale || !band ? null : fill(COMFORT[band.id], 0.35));
  }
  if (about === "timers") {
    const timers = c.timers || [];
    if (!timers.length) return reply("NO TIMERS");
    const state = (t) => (t.finished ? "COMPLETE" : t.running ? formatTime(t.remaining) : formatTime(t.remaining) + " PAUSED");
    const running = timers.filter((t) => t.running && t.remaining > 0).sort((a, b) => a.remaining - b.remaining)[0];
    let lamps = null;
    if (running) {
      const fraction = running.duration > 0 ? Math.min(1, running.remaining / running.duration) : 1;
      lamps = meter(fraction, dim(ramp(1 - fraction, [LAMP.green, LAMP.amber]), 0.3));
    }
    return reply(`${timers.length} TIMER${timers.length > 1 ? "S" : ""} / ${timers.slice(0, 4).map(state).join(" · ")}${timers.length > 4 ? " · …" : ""}`, lamps);
  }
  return none("NOTHING TO ANSWER");
}

// The commands, as shown in Calibration (docs/OPERATOR.md has the same list). `say` entries are the words after
// "computer"; <minutes>, <seconds> and <app> stand for the generated families. tests/test_commands.py checks that
// this list and vesper/commands.py describe exactly the same phrases.
export const VOICE_HELP = [
  { title: "MOVE AND CHOOSE", entries: [
    { say: ["next"], does: "Move the highlight on" },
    { say: ["back", "previous"], does: "Move the highlight back" },
    { say: ["select", "choose"], does: "Choose the highlighted item" },
    { say: ["next sector"], does: "Dashboard: show the next sector" },
    { say: ["home"], does: "Go to the dashboard" },
    { say: ["menu", "pause"], does: "Open the system menu" },
    { say: ["resume"], does: "Close the menu and carry on" },
    { say: ["microphone off"], does: "Stop listening" },
  ] },
  { title: "OPEN AN APP", entries: [
    { say: ["open <app>"], does: "Open any app by its voice name (listed below)" },
  ] },
  { title: "TIMERS AND NOTES", entries: [
    { say: ["timer <minutes> minutes"], does: "Start a timer, 1 to 120 minutes (say the number in words)" },
    { say: ["timer <seconds> seconds"], does: "Start a timer: ten, fifteen, twenty, thirty, forty five or ninety seconds" },
    { say: ["timer one hour", "timer two hours"], does: "Start a one or two hour timer" },
    { say: ["cancel timer"], does: "Remove the last timer" },
    { say: ["pause timer", "resume timer"], does: "Pause or restart the last timer" },
    { say: ["start dictation"], does: "Open Field Notes and start transcribing" },
    { say: ["stop dictation"], does: "Only heard when dictation is off: use the button to stop it" },
  ] },
  { title: "LAMPS, SOUND AND QUESTIONS", entries: [
    { say: ["lamps up", "lamps down"], does: "Lamp level one step" },
    { say: ["lamps off", "lamps on"], does: "Lamps off, or back on" },
    { say: ["sound on", "sound off"], does: "Sounds on or off" },
    { say: ["volume up", "volume down"], does: "Volume one step" },
    { say: ["what time is it"], does: "Show the time" },
    { say: ["temperature", "humidity"], does: "Show the reading, with a lamp colour" },
    { say: ["show timers"], does: "Show the running timers on screen and lamps" },
  ] },
];
