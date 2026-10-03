// A simulated OUTPOST player for balance tests and the report's timeline.
// It plays the real cartridge: in "active" windows it taps a steady beat (`tapRate` a second,
// relaxed: below the easy pace, so every tap counts in full) and buys at once; the rest of the
// time it is away from the screen and only checks in every `checkin` seconds. It relocates to
// the first site offered (the silent coast while the call waits, else one not yet sounded) and,
// at the silent coast, plays the call to answer it. With `sound`, it follows the story: once a
// run is ready it stays for the site's next sounding while that decodes the call (or answers
// it), but never more than three times as long as the run took to be ready, nor an hour more.
// With `fits`, it chooses each fitting the workshop builds (see pickFit).
// Date.now is replaced by a fake clock that advances with the simulation.
import { Outpost } from "../../web/apps/outpost.js";
import { appContext } from "./app-context.mjs";

const E = Outpost.econ, M = Outpost.music;
const TREE_ORDER = [0, 1, 10, 3, 5, 4, 2, 13, 6, 9, 7, 8, 12, 11];

// Between tunes, the bot picks the unlocked tune that hums the machines making the most (or the
// call, where answering it is the sounding).
function chooseTune(app) {
  const s = app.s;
  if (s.site === E.SILENT && s.cf >= E.CALL_FRAGS && E.surveyOf(s).t !== null) {
    if (s.sg !== E.CALL_ID) { s.sg = E.CALL_ID; s.sp = 0; app.loadMelody(); }
    return;
  }
  let best = s.sg, bestV = -1;
  for (let k = 0; k < M.SONGS.length; k++) {
    if (s.lt < M.SONGS[k].at) continue;
    const v = E.humMachines(M.MEL[k]).reduce((a, i) => a + (app.out[i] || 0) / (app.humK[i] || 1), 0);
    if (v > bestV * 1.0001) { bestV = v; best = k; }
  }
  if (best !== s.sg) { s.sg = best; s.sp = 0; app.loadMelody(); }
}

// The bot's fitting: the offered blueprint worth most to how it plays here, roughly as a player
// would judge it: the rack for whichever kind of machine makes more, the key and the metronome
// while tapping, the battery for a player who is mostly away, and whatever speeds the sounding here.
function pickFit(app, taps) {
  const sv = E.surveyOf(app.s).k;
  let sky = 0, ground = 0, all = 0;
  for (let i = 0; i < E.NP; i++) { const v = app.out[i] || 0; all += v; if (E.PROD[i].sky) sky += v; else ground += v; }
  const share = (v) => (all > 0 ? v / all : 0);
  const want = [0.05, 0.5 * share(sky), 0.5 * share(ground), taps ? 0.35 : 0, taps ? 0.02 : 0.3, taps ? 0.15 : 0.05,
    0.1 + (sv === "flares" ? 1 : 0), 0.05 + (sv === "exp" ? 1 : 0), 0.05 + (sv === "data" ? 1 : 0),
    (taps ? 0.2 : 0) + (sv === "groove" ? 1 : 0), 0.25, share(app.out[E.NP - 1] || 0)];
  let best = null, bestV = -Infinity;
  for (const k of app.fitOffer()) if ((want[k] ?? 0) > bestV) { bestV = want[k] ?? 0; best = k; }
  return best;
}

// `progress`, when given, is a save to start from (its clock is taken as now).
// The story bot's choice among the offered sites: the silent coast while the call waits, then the
// site with the fewest soundings taken; a player who taps skips sites that want it to stay away.
function pickSite(app, taps) {
  const s = app.s;
  let best = s.of[0], bestV = -Infinity;
  for (const k of s.of) {
    const v = (k === E.SILENT && !s.ans ? 9 : 2 - s.sv[k]) - (taps && E.SITES[k].sv.k === "watch" ? 1.5 : 0);
    if (v > bestV) { bestV = v; best = k; }
  }
  return best;
}

export function simulate({ runs = 3, maxMin = 240, active = 150, cycle = 600, checkin = 150, seed = 1, tapRate = 2, dt = 0.25, tunes = true, ready = (s) => E.readyOf(s), progress, sound = false, fits = true } = {}) {
  let wall = 1.8e12;
  const realNow = Date.now;
  Date.now = () => wall;
  try {
    const app = new Outpost(appContext({ seed, progress: progress && { ...progress, t: wall } }));
    app.down();
    app.up({ durationMs: 50 }); // leave the intro card
    const res = [];
    let t = 0, runStart = 0, layer = {}, nextCheck = 0, taps = 0;
    const mark = (k, v) => { if (!(k in layer)) layer[k] = Number(v.toFixed(1)); };
    for (let r = 0; r < runs; r++) {
      layer = {}; runStart = t;
      let done = false, readyAt = null;
      while (!done && t - runStart < maxMin * 60) {
        const isActive = t % cycle < active;
        const checking = !isActive && t >= nextCheck;
        if (isActive) {
          for (taps += tapRate * dt; taps >= 1; taps--) { if (tunes && app.s.sp === 0) chooseTune(app); app.idle = 0; app.gather(); }
          app.buyAll();
        } else if (checking) { app.buyAll(); nextCheck = t + checkin; }
        if (fits && (isActive || checking)) while (app.fitWaiting()) { const k = pickFit(app, active > 0); if (k === null || !app.fit(k)) break; }
        if (app.s.tree[5] > 0 && app.s.ex.length < app.s.tree[5] && (isActive || checking)) {
          if (!app.launch(app.s.rt > 3e7 && E.hasRes(app.s, 3) ? 3 : app.s.rt > 3e5 ? 2 : 1)) app.launch(app.s.rt > 3e5 ? 2 : 1);
        }
        if (isActive || checking) for (let k = 0; k < E.NR; k++) app.startResearch(k); // the bot always starts what it can afford
        app.update(dt);
        wall += dt * 1000;
        t += dt;
        const s = app.s, m = (t - runStart) / 60;
        if (s.own[0] > 0) mark("first machine", m);
        if (s.own[2] > 0) mark("core drill", m);
        if (s.own[5] > 0) mark("observatory", m);
        if (s.own[9] > 0) mark("deep-sky", m);
        if (s.up.some((x, i) => x && E.UPG[i].kind === "prod")) mark("first upgrade", m);
        if (s.own.some((n) => n >= 10)) mark("first milestone", m);
        if (s.up.some((x, i) => x && E.UPG[i].kind === "syn")) mark("first synergy", m);
        if (s.st.md > 0) mark("first tune", m);
        if (s.gl.length > 0) mark("first goal", m);
        if (s.gl.length >= 10) mark("10 goals", m);
        if (s.rs.length || s.rd.length) mark("research started", m);
        if (s.rd.length) mark("research done", m);
        if (s.up.some((x, i) => x && E.UPG[i].kind === "voice")) mark("first voice", m);
        if (E.unlockedN(s) >= 8) mark("8 tunes", m);
        if (s.own[10] > 0) mark("zero-point listener", m);
        if (E.revealOf(s)) mark("relocation shown", m);
        if (E.readyOf(s)) mark("relocation ready", m);
        if (E.pendingOf(s) >= 100) mark("100 bearings", m);
        if (s.own[11] > 0) mark("silent array", m);
        const story = sound && E.surveyOf(s).t !== null && (s.site === E.SILENT ? !s.ans : s.cf < E.CALL_FRAGS);
        if (ready(s) && readyAt === null) readyAt = t - runStart;
        if (ready(s) && (isActive || checking) && !(story && t - runStart < Math.min(3 * readyAt, readyAt + 3600))) {
          res.push({ run: r + 1, minutes: Number(((t - runStart) / 60).toFixed(1)), gain: app.pending(), runTotal: s.rt, layer });
          if (r < runs - 1) {
            app.relocate(sound ? pickSite(app, active > 0) : undefined);
            app.phase_ = "play";
            for (let k = 0; k < 3; k++) for (const n of TREE_ORDER) while (app.buyNode(n)) { /* spend every bearing */ }
            while (app.chartNext()) { /* then constellations with what is left */ }
          }
          done = true;
        }
      }
      if (!done) { res.push({ run: r + 1, minutes: null, rt: app.s.rt, layer, own: app.s.own.slice() }); break; }
    }
    return { res, app };
  } finally {
    Date.now = realNow;
  }
}
