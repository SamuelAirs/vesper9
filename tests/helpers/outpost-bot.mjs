// A simulated OUTPOST player for balance tests and the report's timeline.
// It plays the real cartridge: in "active" windows it taps a steady beat (`tapRate` a second,
// relaxed: below the easy pace, so every tap counts in full) and buys at once; the rest of the
// time it is away from the screen and only checks in every `checkin` seconds.
// Date.now is replaced by a fake clock that advances with the simulation.
import { Outpost } from "../../web/apps/outpost.js";
import { appContext } from "./app-context.mjs";

const E = Outpost.econ, M = Outpost.music;
const TREE_ORDER = [0, 1, 10, 3, 5, 4, 2, 13, 6, 9, 7, 8, 12, 11];

// Between tunes, the bot picks the unlocked tune that hums the machines making the most.
function chooseTune(app) {
  const s = app.s;
  let best = s.sg, bestV = -1;
  for (let k = 0; k < M.SONGS.length; k++) {
    if (s.lt < M.SONGS[k].at) continue;
    const v = E.humMachines(M.MEL[k]).reduce((a, i) => a + (app.out[i] || 0) / (app.humK[i] || 1), 0);
    if (v > bestV * 1.0001) { bestV = v; best = k; }
  }
  if (best !== s.sg) { s.sg = best; s.sp = 0; app.loadMelody(); }
}

export function simulate({ runs = 3, maxMin = 240, active = 150, cycle = 600, checkin = 150, seed = 1, tapRate = 2, dt = 0.25, tunes = true, ready = (s) => E.readyOf(s) } = {}) {
  let wall = 1.8e12;
  const realNow = Date.now;
  Date.now = () => wall;
  try {
    const app = new Outpost(appContext({ seed }));
    app.down();
    app.up({ durationMs: 50 }); // leave the intro card
    const res = [];
    let t = 0, runStart = 0, layer = {}, nextCheck = 0, taps = 0;
    const mark = (k, v) => { if (!(k in layer)) layer[k] = Number(v.toFixed(1)); };
    for (let r = 0; r < runs; r++) {
      layer = {}; runStart = t;
      let done = false;
      while (!done && t - runStart < maxMin * 60) {
        const isActive = t % cycle < active;
        const checking = !isActive && t >= nextCheck;
        if (isActive) {
          for (taps += tapRate * dt; taps >= 1; taps--) { if (tunes && app.s.sp === 0) chooseTune(app); app.gather(); }
          app.buyAll();
        } else if (checking) { app.buyAll(); nextCheck = t + checkin; }
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
        if (ready(s) && (isActive || checking)) {
          res.push({ run: r + 1, minutes: Number(((t - runStart) / 60).toFixed(1)), gain: app.pending(), runTotal: s.rt, layer });
          if (r < runs - 1) {
            app.relocate();
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
