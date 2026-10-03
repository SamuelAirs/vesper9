// OUTPOST's sound: the voices that play each gathering tap's note, the named event cues, the
// interface ticks, and the small queue that plays cues and songbook previews on the game clock.
// The cartridge decides when something happens and asks for it by name (cue, tick); this module
// decides what it sounds like. Every sound goes through ctx.tone (hz, seconds, wave, gain).
//
// Fields used on the cartridge (`app`): c (the context), s, mel, clk, idle, queue, lastTapTone,
// and the method voices().
import { clamp } from "../engine/math.js";
import { DIM_AFTER, VOICE } from "./outpost-rules.js";
import { midiHz, scaleUp } from "./outpost-songs.js";

// Voice levels under the lead (ctx.tone's gain): the station's extra voices sit quietly beneath it.
export const VOICE_GAIN = [0.4, 0.25, 0.45, 0.2];
export const QUEUE_MAX = 16;

// Event cues, by name: notes (hz), the gap between them, each note's length, and the wave.
export const CUES = {
  ringOpen: [[330, 440], 0.05, 0.08, "sine"],
  sub: [[330, 392], 0.05, 0.08, "sine"], // into a sub-menu
  back: [[392, 330], 0.05, 0.08, "sine"], // back to the build ring
  panel: [[392, 523], 0.05, 0.08, "sine"], // the statistics view opens
  mode: [[440, 554], 0.05, 0.08, "sine"], // the songbook's order changes
  buy: [[392, 494, 587, 784], 0.055, 0.14, "triangle"], // signal spent on a machine or upgrade
  spend: [[330, 440, 554, 659], 0.06, 0.16, "triangle"], // bearings or data spent, or a team sent
  milestone: [[523, 659, 784, 1047, 1319], 0.07, 0.3, "triangle"],
  goal: [[659, 784, 988], 0.07, 0.2, "sine"],
  newTune: [[523, 659, 784], 0.08, 0.2, "sine"], // a melody joins the songbook
  flareUp: [[880, 1175], 0.1, 0.12, "sine"], // a flare appears
  flare: [[784, 988, 1175, 1568], 0.06, 0.25, "sine"], // and is caught
  teamOut: [[330, 392, 494], 0.08, 0.2, "triangle"], // an expedition leaves
  teamBack: [[587, 784, 988], 0.09, 0.25, "sine"], // an expedition returns
  teamRelic: [[659, 784, 988, 1319], 0.09, 0.25, "sine"], // and brings a relic
  research: [[294, 392, 494], 0.08, 0.2, "triangle"], // a project starts
  researchDone: [[523, 659, 784, 1047], 0.08, 0.25, "sine"],
  relocate: [[392, 523, 659, 784, 1047, 1319], 0.1, 0.35, "sine"],
};
export function cue(app, name) {
  const q = CUES[name];
  if (q) queueNotes(app, q[0], q[1], q[2], q[3]);
}
// A closing flourish on a finished tune's own triad.
export function tuneCue(app, m) {
  const third = m.pcs.has((m.tonic + 3) % 12) ? 3 : 4;
  const base = m.root + 24;
  queueNotes(app, [base, base + third, base + 7, base + 12].map(midiHz), 0.07, 0.35, "sine");
}
// Interface ticks, played at once: a step through the ring (pitch by position), a statistics page
// turned or closed, and the quiet "something is affordable" blip.
export function tick(app, name, k = 0) {
  if (name === "step") app.c.tone(440 + 40 * (k % 5), 0.04, "sine");
  else if (name === "page") app.c.tone(520, 0.04, "sine");
  else if (name === "close") app.c.tone(330, 0.04, "sine");
  else if (name === "afford") app.c.tone(988, 0.08, "sine");
}

// The tap that gathers also plays the next note: a lead voice sized to the player's tempo, and
// whatever extra voices the station has learnt (a third above, an octave above, a low note at
// each phrase start, a bell partial). The extra voices are short, sine-pure and quiet (their
// gain is VOICE_GAIN), and the lead steps down a little as they join, so the full band is
// about twice as loud as one note rather than five times.
export function voiceNote(app, midi, gap, idx) {
  if (app.clk - app.lastTapTone <= 0.03) return; // faster than any hand: skip the sound, not the note
  app.lastTapTone = app.clk;
  const c = app.c, m = app.mel, s = app.s, len = clamp(gap * 1.25, 0.16, 0.55), hz = midiHz(midi);
  c.tone(hz, len, "triangle", app.voices() >= 2 ? 0.8 : 1);
  if (s.up[VOICE[0]]) c.tone(midiHz(scaleUp(midi, m.pcs, 2)), len * 0.7, "sine", VOICE_GAIN[0]);
  if (s.up[VOICE[1]]) c.tone(hz * 2, Math.min(len, 0.25), "sine", VOICE_GAIN[1]);
  if (s.up[VOICE[2]] && (idx === 0 || m.ends.includes(idx - 1))) c.tone(midiHz(m.root + 12), 0.8, "sine", VOICE_GAIN[2]);
  if (s.up[VOICE[3]]) c.tone(hz * 2.76, 0.12, "sine", VOICE_GAIN[3]);
}

// The queue: notes due at a time on the game clock, at most QUEUE_MAX waiting.
export function queueNotes(app, notes, gap, len, wave) {
  notes.forEach((hz, i) => { if (app.queue.length < QUEUE_MAX) app.queue.push({ at: app.clk + i * gap, hz, len, wave }); });
}
// A short taste of a melody for the songbook: its first phrase, quickly, replacing any earlier taste.
export function previewTune(app, mel) {
  app.queue = app.queue.filter((q) => !q.pv);
  const n = Math.min(8, mel.ends[0] + 1);
  for (let i = 0; i < n; i++) if (app.queue.length < QUEUE_MAX) app.queue.push({ at: app.clk + i * 0.15, hz: midiHz(mel.n[i]), len: 0.22, wave: "triangle", pv: true });
}
// Plays what is due (silently dropped while the station has been left idle long enough to dim).
export function playQueue(app) {
  if (!app.queue.length) return;
  const rest = [];
  for (const q of app.queue) {
    if (q.at <= app.clk) { if (app.idle < DIM_AFTER) app.c.tone(q.hz, q.len, q.wave); } else rest.push(q);
  }
  app.queue = rest;
}
