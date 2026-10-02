// OUTPOST's sound: the voices that play each gathering tap's note, the named event cues, the
// interface ticks, and the small queue that plays cues and songbook previews on the game clock.
// The cartridge decides when something happens and asks for it by name (cue, tick); this module
// decides what it sounds like. Every sound goes through ctx.tone (hz, seconds, wave, gain).
//
// Cues and ticks are written as scale degrees, not pitches, and are played in the key and mode
// of the tune the station is playing, so a purchase in Greensleeves is in E minor and the same
// purchase in Brahms's Lullaby is in E flat major. While the player keeps a beat, a cue's notes
// fall on that beat's subdivisions instead of their own spacing. Each cue note also lights the
// lamps (outpost-lamps.js) at the place its pitch has in the cue's range, in the cue's colour.
//
// Fields used on the cartridge (`app`): c (the context), s, mel, clk, idle, queue, lastTapTone,
// groove, gaps, lastGather, phase_, and the method voices(). This module's own fields: cueFx (the
// lamp light of the latest cue note) and grooveHeard (the groove at the previous tap).
import { clamp } from "../engine/math.js";
import { LAMP } from "../engine/lightshow.js";
import { DIM_AFTER, GROOVE_MAX, VOICE } from "./outpost-rules.js";
import { midiHz, scaleUp } from "./outpost-songs.js";

// Voice levels under the lead (ctx.tone's gain): the station's extra voices sit quietly beneath it.
export const VOICE_GAIN = [0.4, 0.25, 0.45, 0.2];
export const QUEUE_MAX = 16;
// Cues play under the lead so a flourish never drowns the tune the player is tapping.
export const CUE_GAIN = 0.6;
// In full groove each tap adds a quiet bell an octave and a fifth up (the note's third partial,
// so it never clashes): the sound of being in the pocket.
export const POCKET_GAIN = 0.12;

// Scale degrees (1 = tonic, 3 = third, 5 = fifth, 8 = the octave, ...) for each mode. Pentatonic
// tunes use the major degrees; cues only use 1, 2, 3, 5 and 6 and their octaves, which are in
// every scale, so no cue ever plays a note outside the tune's key.
const DEGREES = {
  maj: [0, 2, 4, 5, 7, 9, 11], min: [0, 2, 3, 5, 7, 8, 10], dor: [0, 2, 3, 5, 7, 9, 10],
  pent: [0, 2, 4, 5, 7, 9, 11], mk: [0, 2, 4, 5, 7, 8, 11],
};
// The tonic the cues are built on: the tune's key placed between A3 and G#4, so the highest cue
// note (degree 15, two octaves up) stays under about 1.7 kHz.
export const cueBase = (mel) => 57 + ((((mel?.tonic ?? 0) - 57) % 12) + 12) % 12;
// The midi note of scale degree d (1-based; 8 is the octave) above the tune's cue base.
export function degreeMidi(mel, d) {
  const deg = DEGREES[mel?.mode] || DEGREES.maj, i = d - 1;
  return cueBase(mel) + 12 * Math.floor(i / 7) + deg[((i % 7) + 7) % 7];
}

// Event cues, by name: scale degrees, the gap between notes (seconds), each note's length, the
// wave, and the lamp colour its notes light. Rising shapes for gains, falling ones for going back.
// Sine throughout: the triangle wave belongs to the tune itself.
export const CUES = {
  ringOpen: [[5, 8], 0.05, 0.08, "sine", LAMP.white],
  sub: [[5, 6], 0.05, 0.08, "sine", LAMP.white], // into a sub-menu
  back: [[6, 5], 0.05, 0.08, "sine", LAMP.white], // back to the build ring
  panel: [[5, 8, 10], 0.05, 0.08, "sine", LAMP.white], // the statistics view opens
  mode: [[3, 6], 0.05, 0.08, "sine", LAMP.white], // the songbook's order changes
  buy: [[5, 8, 10, 12], 0.055, 0.12, "sine", LAMP.green], // signal spent on a machine or upgrade
  spend: [[3, 5, 8, 10], 0.06, 0.14, "sine", LAMP.violet], // bearings or data spent, or a team sent
  milestone: [[1, 3, 5, 8, 10, 12, 15], 0.06, 0.28, "sine", LAMP.blue],
  goal: [[8, 10, 12, 15], 0.07, 0.2, "sine", LAMP.amber],
  newTune: [[5, 6, 8, 10], 0.08, 0.2, "sine", LAMP.cyan], // a melody joins the songbook
  flareUp: [[12, 15], 0.1, 0.12, "sine", LAMP.amber], // a flare appears (high, on the right lamp, where it shows)
  flare: [[8, 10, 12, 15], 0.06, 0.24, "sine", LAMP.amber], // and is caught
  teamOut: [[1, 3, 5, 8], 0.08, 0.18, "sine", LAMP.cyan], // an expedition leaves
  teamBack: [[12, 10, 8, 12], 0.09, 0.22, "sine", LAMP.cyan], // an expedition returns
  teamRelic: [[8, 10, 12, 15, 12, 15], 0.08, 0.22, "sine", LAMP.violet], // and brings a relic
  research: [[2, 3, 5], 0.08, 0.18, "sine", LAMP.blue], // a project starts
  researchDone: [[5, 8, 9, 10, 12], 0.07, 0.24, "sine", LAMP.blue],
  relocate: [[1, 5, 8, 10, 12, 15], 0.11, 0.35, "sine", LAMP.white],
  pocket: [[8, 12, 15], 0.04, 0.1, "sine", LAMP.cyan], // the groove has just filled
};

// The player's beat (seconds) while they are keeping one, else 0.
export function liveBeat(app) {
  const g = app.gaps;
  if (!g || g.length < 2) return 0;
  const beat = g.reduce((a, b) => a + b, 0) / g.length;
  return app.clk - app.lastGather <= 2.5 * beat ? beat : 0;
}
// When a cue should start and how far apart its notes go: on its own spacing normally; on the
// player's beat while they keep one (the subdivision nearest the cue's own gap, starting on the
// next one).
export function cueTiming(app, gap) {
  const beat = liveBeat(app);
  if (!beat) return { start: app.clk, gap };
  let best = beat;
  for (let k = 2; k <= 8; k *= 2) if (Math.abs(beat / k - gap) < Math.abs(best - gap)) best = beat / k;
  const step = clamp(best, 0.04, 0.24), since = app.clk - app.lastGather;
  return { start: app.lastGather + Math.ceil(since / step - 1e-6) * step, gap: step };
}

export function cue(app, name) {
  const q = CUES[name];
  if (!q) return;
  const [deg, gap, len, wave, rgb] = q;
  const mids = deg.map((d) => degreeMidi(app.mel, d));
  const lo = Math.min(...mids), hi = Math.max(...mids);
  const at = cueTiming(app, gap);
  mids.forEach((m, i) => {
    if (app.queue.length >= QUEUE_MAX) return;
    // pitch places the light: the cue's lowest note at the left, its highest at the right
    const pos = hi > lo ? (m - lo) / (hi - lo) : 0.5;
    app.queue.push({ at: at.start + i * at.gap, hz: midiHz(m), len, wave, gain: CUE_GAIN, lamp: rgb, pos });
  });
}
// A closing flourish on a finished tune's own triad.
export function tuneCue(app, m) {
  const third = m.pcs.has((m.tonic + 3) % 12) ? 3 : 4;
  const base = m.root + 24, mids = [base, base + third, base + 7, base + 12];
  const at = cueTiming(app, 0.07);
  mids.forEach((x, i) => {
    if (app.queue.length < QUEUE_MAX) app.queue.push({ at: at.start + i * at.gap, hz: midiHz(x), len: 0.35, wave: "sine", gain: CUE_GAIN, lamp: LAMP.amber, pos: i / 3 });
  });
}
// Interface ticks, played at once: a step through the ring (up the tune's scale by position), a
// statistics page turned or closed, and the quiet "something is affordable" blip.
const STEP_DEG = [8, 9, 10, 12, 13];
export function tick(app, name, k = 0) {
  const hz = (d) => midiHz(degreeMidi(app.mel, d));
  if (name === "step") app.c.tone(hz(STEP_DEG[((k % 5) + 5) % 5]), 0.04, "sine", 0.7);
  else if (name === "page") app.c.tone(hz(10), 0.04, "sine", 0.7);
  else if (name === "close") app.c.tone(hz(5), 0.04, "sine", 0.7);
  else if (name === "afford") app.c.tone(hz(12), 0.08, "sine", 0.5);
}

// The tap that gathers also plays the next note: a lead voice sized to the player's tempo, and
// whatever extra voices the station has learnt (a third above, an octave above, a low note at
// each phrase start, a bell partial). The extra voices are short, sine-pure and quiet (their
// gain is VOICE_GAIN), and the lead steps down a little as they join, so the full band is
// about twice as loud as one note rather than five times. In full groove a soft bell (the note's
// third partial) joins every note, and the moment the groove fills is marked with a short sparkle.
export function voiceNote(app, midi, gap, idx) {
  const full = Math.floor(app.groove || 0) >= GROOVE_MAX, was = app.grooveHeard ?? 0;
  app.grooveHeard = Math.floor(app.groove || 0);
  if (app.clk - app.lastTapTone <= 0.03) return; // faster than any hand: skip the sound, not the note
  app.lastTapTone = app.clk;
  const c = app.c, m = app.mel, s = app.s, len = clamp(gap * 1.25, 0.16, 0.55), hz = midiHz(midi);
  c.tone(hz, len, "triangle", app.voices() >= 2 ? 0.8 : 1);
  if (s.up[VOICE[0]]) c.tone(midiHz(scaleUp(midi, m.pcs, 2)), len * 0.7, "sine", VOICE_GAIN[0]);
  if (s.up[VOICE[1]]) c.tone(hz * 2, Math.min(len, 0.25), "sine", VOICE_GAIN[1]);
  if (s.up[VOICE[2]] && (idx === 0 || m.ends.includes(idx - 1))) c.tone(midiHz(m.root + 12), 0.8, "sine", VOICE_GAIN[2]);
  if (s.up[VOICE[3]]) c.tone(hz * 2.76, 0.12, "sine", VOICE_GAIN[3]);
  if (full) {
    c.tone(hz * 3, 0.1, "sine", POCKET_GAIN);
    if (was < GROOVE_MAX) cue(app, "pocket");
  }
}

// The queue: notes due at a time on the game clock, at most QUEUE_MAX waiting. Callers that only
// have pitches (previews, older call sites) still work: gain and lamp are optional.
export function queueNotes(app, notes, gap, len, wave, gain = CUE_GAIN, lamp = null) {
  notes.forEach((hz, i) => { if (app.queue.length < QUEUE_MAX) app.queue.push({ at: app.clk + i * gap, hz, len, wave, gain, lamp, pos: notes.length > 1 ? i / (notes.length - 1) : 0.5 }); });
}
// A short taste of a melody for the songbook: its first phrase, quickly, replacing any earlier
// taste. The lamps follow it, low notes left and high right, as they do when the tune is played.
export function previewTune(app, mel) {
  app.queue = app.queue.filter((q) => !q.pv);
  const n = Math.min(8, mel.ends[0] + 1);
  for (let i = 0; i < n; i++) {
    const pos = mel.hi > mel.lo ? (mel.n[i] - mel.lo) / (mel.hi - mel.lo) : 0.5;
    if (app.queue.length < QUEUE_MAX) app.queue.push({ at: app.clk + i * 0.15, hz: midiHz(mel.n[i]), len: 0.22, wave: "triangle", pv: true, lamp: LAMP.white, pos });
  }
}
// Plays what is due (silently dropped while the station has been left idle long enough to dim),
// and hands the latest note's light to the lamps.
export function playQueue(app) {
  if (!app.queue.length) return;
  const rest = [];
  for (const q of app.queue) {
    if (q.at <= app.clk) {
      if (app.idle < DIM_AFTER) {
        if (q.gain === undefined || q.gain === 1) app.c.tone(q.hz, q.len, q.wave);
        else app.c.tone(q.hz, q.len, q.wave, q.gain);
        if (q.lamp) app.cueFx = { pos: q.pos ?? 0.5, rgb: q.lamp, t: 0 };
      }
    } else rest.push(q);
  }
  app.queue = rest;
}
