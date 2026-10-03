// OUTPOST's songbook: the public-domain melodies a gathering tap plays, note by note, and the
// seeded generator that composes new ones. Pure data and pure functions (no game state, no sound):
// the rules count the tunes (unlocks, the full-songbook goal, the save's per-tune play counts),
// the music module plays them, and the cartridge steps through them.
//
// Tunes may be added at the end of SONGS (the save keeps one play count per tune, by position);
// never reorder or remove one.

// ---- the songbook ------------------------------------------------------------------------
// Melodies are lists of note names (letter, optional # or b, octave; middle C is C4), with "|"
// between phrases. Note lengths are not stored: the player's taps are the rhythm. `at` is the
// lifetime signal at which the tune joins the songbook. Every tune is traditional or by a
// composer who died more than a century ago; `by` names the source.
export const SONGS = [
  { id: "twinkle", name: "TWINKLE TWINKLE", by: "FRENCH TUNE, MOZART VARIATIONS 1781", key: "C", mode: "maj", at: 0,
    notes: "C4 C4 G4 G4 A4 A4 G4 | F4 F4 E4 E4 D4 D4 C4 | G4 G4 F4 F4 E4 E4 D4 | G4 G4 F4 F4 E4 E4 D4 | C4 C4 G4 G4 A4 A4 G4 | F4 F4 E4 E4 D4 D4 C4" },
  { id: "row", name: "ROW ROW ROW YOUR BOAT", by: "TRADITIONAL, 1852", key: "C", mode: "maj", at: 100,
    notes: "C4 C4 C4 D4 E4 | E4 D4 E4 F4 G4 | C5 C5 C5 G4 G4 G4 E4 E4 E4 C4 C4 C4 | G4 F4 E4 D4 C4" },
  { id: "ode", name: "ODE TO JOY", by: "BEETHOVEN, 1824", key: "C", mode: "maj", at: 600,
    notes: "E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 E4 D4 D4 | E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 D4 C4 C4 | D4 D4 E4 C4 D4 E4 F4 E4 C4 D4 E4 F4 E4 D4 C4 D4 G3 | E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 D4 C4 C4" },
  { id: "jacques", name: "FRERE JACQUES", by: "FRENCH TRADITIONAL", key: "C", mode: "maj", at: 3e3,
    notes: "C4 D4 E4 C4 | C4 D4 E4 C4 | E4 F4 G4 | E4 F4 G4 | G4 A4 G4 F4 E4 C4 | G4 A4 G4 F4 E4 C4 | C4 G3 C4 | C4 G3 C4" },
  { id: "jingle", name: "JINGLE BELLS", by: "PIERPONT, 1857", key: "C", mode: "maj", at: 1.5e4,
    notes: "E4 E4 E4 | E4 E4 E4 | E4 G4 C4 D4 E4 | F4 F4 F4 F4 | F4 E4 E4 E4 E4 | E4 D4 D4 E4 D4 G4" },
  { id: "susanna", name: "OH SUSANNA", by: "FOSTER, 1848", key: "C", mode: "maj", at: 8e4,
    notes: "C4 D4 E4 G4 G4 A4 G4 E4 | C4 D4 E4 E4 D4 C4 D4 | C4 D4 E4 G4 G4 A4 G4 E4 | C4 D4 E4 E4 D4 D4 C4" },
  { id: "yankee", name: "YANKEE DOODLE", by: "TRADITIONAL, 1700S", key: "C", mode: "maj", at: 4e5,
    notes: "C4 C4 D4 E4 C4 E4 D4 G3 | C4 C4 D4 E4 C4 B3 | C4 C4 D4 E4 F4 E4 D4 C4 B3 G3 A3 B3 C4 C4" },
  { id: "auld", name: "AULD LANG SYNE", by: "SCOTTISH TRADITIONAL", key: "C", mode: "maj", at: 2e6,
    notes: "G3 C4 C4 C4 E4 D4 C4 D4 E4 C4 C4 E4 G4 A4 A4 | G4 E4 E4 C4 D4 C4 D4 E4 C4 A3 A3 G3 C4 | A4 G4 E4 E4 C4 D4 C4 D4 A4 G4 E4 E4 G4 A4 A4 | G4 E4 E4 C4 D4 C4 D4 E4 C4 A3 A3 G3 C4" },
  { id: "greensleeves", name: "GREENSLEEVES", by: "ENGLISH TRADITIONAL, 16TH C.", key: "E", mode: "min", at: 1e7,
    notes: "E4 G4 A4 B4 C5 B4 A4 F#4 D4 E4 F#4 G4 E4 E4 D#4 E4 F#4 D#4 B3 | E4 G4 A4 B4 C5 B4 A4 F#4 D4 E4 F#4 G4 F#4 E4 D#4 C#4 D#4 E4 | D5 D5 C#5 B4 A4 F#4 D4 E4 F#4 G4 E4 E4 D#4 E4 F#4 D#4 B3 | D5 D5 C#5 B4 A4 F#4 D4 E4 F#4 G4 F#4 E4 D#4 C#4 D#4 E4" },
  { id: "scarborough", name: "SCARBOROUGH FAIR", by: "ENGLISH BALLAD, 17TH C.", key: "E", mode: "dor", at: 5e7,
    notes: "E4 E4 B4 B4 F#4 G4 F#4 E4 | B4 D5 E5 D5 B4 C#5 A4 B4 | E5 E5 E5 D5 B4 B4 A4 G4 F#4 D4 | E4 B4 A4 G4 F#4 E4 D4 E4" },
  { id: "grace", name: "AMAZING GRACE", by: "NEW BRITAIN, 1829-35", key: "G", mode: "pent", at: 3e8,
    notes: "D4 G4 B4 G4 B4 A4 G4 E4 D4 | D4 G4 B4 G4 B4 A4 D5 | B4 D5 B4 D5 B4 G4 D4 E4 G4 G4 E4 D4 | D4 G4 B4 G4 B4 A4 G4" },
  { id: "brahms", name: "BRAHMS'S LULLABY", by: "BRAHMS, 1868", key: "Eb", mode: "maj", at: 2e9,
    notes: "G4 G4 Bb4 G4 G4 Bb4 G4 Bb4 Eb5 D5 C5 C5 Bb4 F4 G4 | Ab4 F4 F4 G4 Ab4 F4 Ab4 D5 C5 Bb4 D5 Eb5 Eb4 Eb4 | Eb5 C5 Ab4 Bb4 G4 Eb4 Ab4 Bb4 C5 Bb4 Eb4 Eb4 | Eb5 C5 Ab4 Bb4 G4 Eb4 Ab4 G4 F4 Eb4" },
  { id: "elise", name: "FUR ELISE", by: "BEETHOVEN, 1810", key: "A", mode: "min", at: 1.5e10,
    notes: "E5 D#5 E5 D#5 E5 B4 D5 C5 A4 C4 E4 A4 B4 E4 G#4 B4 C5 | E5 D#5 E5 D#5 E5 B4 D5 C5 A4 C4 E4 A4 B4 E4 C5 B4 A4" },
  { id: "minuet", name: "MINUET IN G", by: "PETZOLD, C. 1725", key: "G", mode: "maj", at: 1e11,
    notes: "D5 G4 A4 B4 C5 D5 G4 G4 E5 C5 D5 E5 F#5 G5 G4 G4 | C5 D5 C5 B4 A4 B4 C5 B4 A4 G4 F#4 G4 A4 B4 G4 A4 | B5 G5 A5 B5 G5 A5 D5 E5 F#5 D5 G5 E5 F#5 G5 D5 C#5 B4 C#5 A4 A4 B4 C#5 D5 E5 F#5 G5 F#5 E5 F#5 A5 D5 C#5 D5 | D5 G4 F#4 G4 E5 G4 F#4 G4 D5 C5 B4 A4 G4 F#4 G4 A4 D4 E4 F#4 G4 A4 B4 C5 B4 A4 B4 D5 G4 F#4 G4" },
  { id: "canon", name: "CANON IN D", by: "PACHELBEL, C. 1680", key: "D", mode: "maj", at: 8e11,
    notes: "F#5 E5 D5 C#5 B4 A4 B4 C#5 | D5 C#5 B4 A4 G4 F#4 G4 E4" },
  { id: "korobeiniki", name: "KOROBEINIKI", by: "RUSSIAN FOLK SONG, 1861", key: "E", mode: "min", at: 6e12,
    notes: "B4 F#4 G4 A4 G4 F#4 E4 E4 G4 B4 A4 G4 F#4 G4 A4 B4 G4 E4 E4 | A4 C5 E5 D5 C5 B4 G4 B4 A4 G4 F#4 F#4 G4 A4 B4 G4 E4 E4 | B4 G4 A4 F#4 G4 E4 D#4 | B4 G4 A4 F#4 G4 B4 E5 E5 D#5" },
  { id: "king", name: "MOUNTAIN KING", by: "GRIEG, 1875 (IN THE HALL OF THE MOUNTAIN KING)", key: "F#", mode: "mk", at: 5e13,
    notes: "F#4 G#4 A#4 B4 C#5 A#4 C#5 D5 A#4 D5 C#5 A#4 C#5 | F#4 G#4 A#4 B4 C#5 A#4 C#5 D5 A#4 D5 C#5 A#4 C#5" },
  // the long game: tunes that arrive after the first hundred trillion of lifetime signal
  { id: "saints", name: "WHEN THE SAINTS", by: "AMERICAN TRADITIONAL", key: "C", mode: "maj", at: 3e14,
    notes: "C4 E4 F4 G4 | C4 E4 F4 G4 | C4 E4 F4 G4 E4 C4 E4 D4 | E4 E4 D4 C4 C4 E4 G4 G4 F4 | E4 F4 G4 E4 C4 D4 C4" },
  { id: "spring", name: "SPRING", by: "VIVALDI, 1725 (THE FOUR SEASONS)", key: "E", mode: "maj", at: 2e15,
    notes: "E4 G#4 G#4 G#4 F#4 E4 B4 | B4 A4 G#4 G#4 G#4 F#4 E4 B4 | B4 A4 G#4 A4 B4 A4 G#4 F#4 D#4 B3" },
  { id: "morning", name: "MORNING MOOD", by: "GRIEG, 1875 (PEER GYNT)", key: "E", mode: "maj", at: 1.5e16,
    notes: "B4 G#4 F#4 E4 F#4 G#4 | B4 G#4 F#4 E4 F#4 G#4 F#4 G#4 | B4 G#4 B4 C#5 G#4 C#5 B4 G#4 F#4 E4" },
  { id: "largo", name: "GOING HOME", by: "DVORAK, 1893 (NEW WORLD SYMPHONY, LARGO)", key: "C", mode: "maj", at: 1e17,
    notes: "E4 G4 G4 E4 D4 C4 D4 E4 G4 E4 D4 | E4 G4 G4 E4 D4 C4 D4 E4 D4 C4 C4" },
  { id: "danube", name: "THE BLUE DANUBE", by: "J. STRAUSS II, 1866", key: "D", mode: "maj", at: 1e18,
    notes: "D4 D4 F#4 A4 A4 | A5 A5 F#5 F#5 | D4 D4 F#4 A4 A4 | A5 A5 G5 G5 | C#4 C#4 E4 B4 B4 | B5 B5 G5 G5 | C#4 C#4 E4 B4 B4 | B5 B5 F#5 F#5" },
];
export const NS = SONGS.length;
export const SCALES = { maj: [0, 2, 4, 5, 7, 9, 11], min: [0, 2, 3, 5, 7, 8, 10, 11], dor: [0, 2, 3, 5, 7, 9, 10], pent: [0, 2, 4, 7, 9], mk: [0, 2, 4, 5, 7, 8, 11] };
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export const noteMidi = (name) => {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  return m ? 12 * (Number(m[3]) + 1) + PC[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) : 60;
};
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const noteName = (m) => NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
export const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const keyPc = (k) => noteMidi(k + "4") % 12;
// A playable melody: n = midi notes, ends = index of the last note of each phrase (the final one
// is the end of the tune), pcs = the scale's pitch classes (for harmonies), root = a low tonic.
export function makeMelody(name, source, key, mode) {
  const phrases = typeof source === "string" ? source.split("|").map((p) => p.trim().split(/\s+/).map(noteMidi)) : source;
  const n = [], ends = [];
  for (const ph of phrases) { for (const m of ph) n.push(m); ends.push(n.length - 1); }
  const tonic = typeof key === "number" ? key : keyPc(key);
  const pcs = new Set(SCALES[mode].map((i) => (tonic + i) % 12));
  let lo = 127, hi = 0;
  for (const m of n) { lo = Math.min(lo, m); hi = Math.max(hi, m); }
  return { name, n, ends, pcs, tonic, lo, hi, root: 36 + tonic, mode };
}
export const MEL = SONGS.map((sg) => makeMelody(sg.name, sg.notes, sg.key, sg.mode));
// A note `steps` scale degrees above m, staying in the tune's key.
export function scaleUp(m, pcs, steps) {
  let out = m, left = steps;
  for (let guard = 0; left > 0 && guard < 24; guard++) { out++; if (pcs.has(out % 12)) left--; }
  return out;
}

// ---- generated tunes -----------------------------------------------------------------------
// A tune is a pure function of its seed: a scale, four phrases of eight notes in an A A' B A''
// shape, mostly stepwise, an occasional leap answered by a step back, phrases that end on the
// tonic, third or fifth (the last one on the tonic), and the third phrase set higher.
const GEN_MODES = ["maj", "maj", "min", "dor", "pent"];
const GEN_ADJ = ["PALE", "AMBER", "SLOW", "LONG", "COLD", "BRIGHT", "QUIET", "FAR"];
const GEN_NOUN = ["LANTERN", "TIDE", "ORBIT", "SIGNAL", "DUNE", "BEACON", "MERIDIAN", "FROST"];
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const genName = (seed) => GEN_ADJ[seed % 8] + " " + GEN_NOUN[(seed >>> 3) % 8] + " " + (10 + ((seed >>> 6) % 90));
export function genTune(seed) {
  seed = (Number(seed) >>> 0) || 1;
  const r = seeded(seed);
  const mode = GEN_MODES[Math.floor(r() * GEN_MODES.length)];
  const sc = mode === "min" ? SCALES.min.slice(0, 7) : SCALES[mode], L = sc.length;
  const tonic = 57 + Math.floor(r() * 6); // A3..D#4, so the tune sits around 220-700 Hz
  const mod = (d) => ((d % L) + L) % L;
  const pitch = (d) => tonic + Math.floor(d / L) * 12 + sc[mod(d)];
  const stable = L === 5 ? [0, 2, 3] : [0, 2, 4];
  const lo = -1, hi = L + 2;
  const clampD = (d) => Math.min(hi, Math.max(lo, d));
  // the degree of stable class `idx` (0 tonic, 1 third, 2 fifth) nearest to `from`
  const endNear = (from, idx) => {
    let best = null;
    for (let x = lo; x <= hi; x++) if (mod(x) === stable[idx] && (best === null || Math.abs(x - from) < Math.abs(best - from))) best = x;
    return best;
  };
  // the last two notes: step onto the ending from the side we are coming from
  const finish = (out, idx) => {
    const from = out[out.length - 1], end = endNear(from, idx);
    out.push(clampD(end + (from > end ? 1 : from < end ? -1 : r() < 0.5 ? 1 : -1)), end);
    return out;
  };
  const phrase = (start, idx, len) => {
    const out = [start];
    let d = start, dir = r() < 0.5 ? 1 : -1, back = 0;
    for (let i = 1; i < len - 2; i++) {
      let step;
      if (back) { step = back; back = 0; } else {
        if (r() < 0.3) dir = -dir;
        const x = r();
        if (x < 0.1) step = 0; else if (x < 0.8) step = dir; else { step = dir * (r() < 0.6 ? 2 : 3); back = -dir; }
      }
      if (d + step < lo || d + step > hi) { dir = -dir; step = -Math.sign(step || dir) * Math.max(1, Math.abs(step)); back = 0; }
      d = clampD(d + step);
      out.push(d);
    }
    return finish(out, idx);
  };
  const vary = (src, idx) => { // same shape, two notes nudged, a new ending
    const out = src.slice(0, src.length - 2);
    for (let k = 0; k < 2; k++) { const i = 2 + Math.floor(r() * (out.length - 3)); out[i] = clampD(out[i] + (r() < 0.5 ? 1 : -1)); }
    return finish(out, idx);
  };
  const A = phrase(stable[Math.floor(r() * 3)], 1 + Math.floor(r() * 2), 8);
  const endClassA = mod(A[7]) === stable[1] ? 1 : 2;
  const B = vary(A, 3 - endClassA);
  const C = phrase(endNear(L + 1, 2), 1 + Math.floor(r() * 2), 8);
  const D = vary(A, 0);
  const phrases = [A, B, C, D].map((p) => p.map((d) => {
    let m = pitch(d);
    while (m > 84) m -= 12;
    while (m < 53) m += 12;
    return m;
  }));
  return makeMelody(genName(seed), phrases, tonic % 12, mode);
}
