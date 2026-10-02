// OUTPOST — a one-button incremental game. A lone survey station gathers signal.
// Tap to gather by hand; hold to open the build ring (taps step through what can be
// bought, a hold-and-release buys). Signal buys machines, machines unlock better machines,
// upgrades and synergies multiply them, "relocating" trades the whole station for permanent
// bearings and a small tree of lasting bonuses, and after that come expeditions on wall-clock
// timers and rare signal flares. The station keeps working while the game is closed: the
// next launch credits the production earned meanwhile (capped, and the cap can be raised).
//
// Every gathering tap plays the next note of a melody (a songbook of public-domain tunes plus
// seeded generated ones), so the player's own rhythm is the tempo. Finishing phrases and tunes
// pays a bonus, and the instrument can be given more voices. There is a statistics view, a goal
// list with small permanent rewards, and a research track (timers that run while closed) that
// unlocks new kinds of things: generated tunes, voices, an expedition, two late machines.
//
// Taps that keep a steady beat build GROOVE (up to x1.5 per tap and per phrase); a stumble
// halves it and a pause lets it fade. Late on, bearings left over after the tree can chart
// CONSTELLATIONS: each multiplies all output and draws itself into the sky, without end.
//
// Numbers are plain doubles clamped to BIG (1e150) everywhere they can grow, so nothing
// reaches Infinity or NaN. The save is one small JSON object (schema 4; schemas 1-3 migrate).
// The three lamps are the status board: left breathes with production, middle fills toward
// the next purchase and goes steady green when one is affordable, right shows the timed
// thing (flare, boost, expedition) or that relocation is worth doing. On top of that, each tap
// lights the lamp for where its note sits in the melody's range (a short glow), and phrase and
// tune endings add a sweep; between taps the status board is all that remains.
//
// The game is split across modules. This file is the cartridge: state, input, the build ring,
// the simulation and saving. The others never import it:
//   outpost-rules.js   tables, pure economy, formatting, save format
//   outpost-songs.js   the songbook and the tune generator
//   outpost-music.js   voices, named event cues, interface ticks, the note queue
//   outpost-lamps.js   the three lamps
//   outpost-scene.js   drawing and visual-only animation
import { clamp } from "../engine/math.js";
import { lightsOff } from "../engine/lightshow.js";
import {
  SCHEMA, BIG, MAX_OWN, MILESTONES, PRESTIGE_K, READY_MIN, READY_RATIO, AWAY_MIN, HOLD_OPEN, HOLD_BUY, HOLD_BIG, DWELL, DWELL_BIG,
  RING_IDLE, DIM_AFTER, SAVE_EVERY, SAVE_GAP, FLARE_LIFE, FLOATERS, LUMP_SEC, TAP_EASY, TAP_EASY_FRENZY, PACE_BURST,
  GROOVE_BONUS, GROOVE_MAX, GROOVE_TOL, GROOVE_MIN_GAP, GROOVE_MAX_GAP, GROOVE_FADE, CHART_REQ, CHART_MULT, CHART_MAX,
  PROD, NP, UPG, NUP, VOICE, TREE, NT, KIT, KIT_SIGNAL, AUTO_EVERY, EXPED, MAX_RELICS, GEN_ID, RES, NR, EV, GOALS, NG, STAGES, CONST,
  hasRes, resSlots, tiersOwned, dataRate, dataBonus, unlockedN, masteredN, goalFrac, chartCost, chartName, chartsOpen, stageOf,
  num, fmt, fmtRate, dur, fmtInt, fmtDate, clock, costOf, milestonesAt, nextMilestone, globalMult, prodMult, evaluate, tapParts,
  capHours, pendingOf, revealOf, readyRatio, readyOf, slotsOf, upgradeVisible, tierOpen, prodVisible, freshState, applyKit, serialize, migrate,
} from "./outpost-rules.js";
import { SONGS, NS, SCALES, noteMidi, noteName, midiHz, makeMelody, MEL, scaleUp, seeded, genName, genTune } from "./outpost-songs.js";
import { VOICE_GAIN, cue, tuneCue, tick, voiceNote, previewTune, playQueue } from "./outpost-music.js";
import { stepLamps, lampFrame } from "./outpost-lamps.js";
import { drawOutpost, stepScene, addRipple, addFloat } from "./outpost-scene.js";

// ---- the cartridge -----------------------------------------------------------
export class Outpost {
  constructor(ctx) {
    this.c = ctx;
    const loaded = migrate(ctx.progress?.());
    this.s = loaded.s;
    this.loadMelody();
    this.out = new Float64Array(NP);
    this.act = new Float64Array(NP); // smoothed 0..1 activity per machine (for motion)
    this.phase = new Float64Array(NP);
    this.flash = new Float64Array(NP); // purchase flash per machine
    this.t = 0;
    this.clk = 0; // game-seconds, advances in update()
    this.down_ = false;
    this.downAt = 0;
    this.downAge = 0;
    this.consume = false;
    this.ring = null;
    this.entries = [];
    this.idle = 0;
    this.dimK = 1;
    this.breath = 0;
    this.flick = 0;
    this.accent = null;
    this.flare = null;
    this.flareIn = 50;
    this.boosts = [];
    this.note = null;
    this.floats = Array.from({ length: FLOATERS }, () => ({ x: 0, y: 0, life: 0, v: "" }));
    this.queue = [];
    this.saveIn = SAVE_EVERY;
    this.saveCool = 0;
    this.savePending = false;
    this.autoIn = 0;
    this.secIn = 1;
    this.simSince = 0;
    this.lastLevel = -1;
    this.hudKey = "";
    this.hintKey = "";
    this.readyBlip = 0;
    this.wasAfford = false;
    this.cardT = 0;
    this.card = null;
    this.away = null;
    this.stars = 0;
    this.wallRef = Date.now();
    this.dirty = true;
    this.recalcIn = 0;
    this.rate = 0;
    this.affordN = 0;
    this.goalFrac = 0;
    this.goalName = "";
    this.recent = []; // the last few gathering taps (time and melody position before), for the menu-gesture rewind
    this.lastNoteAt = -9;
    this.lastTapTone = -1;
    this.tapTimes = [];
    this.tuneClean = true;
    this.noteFx = null; // { pos 0..1, t } the lamp glow for the latest note
    this.ripples = Array.from({ length: 6 }, () => ({ t: 9, full: false })); // tap pulses along the ground
    this.panel = null; // the statistics view: { page }
    this.news = false;
    this.newsFrom = 0; // the schema the save came from, when it shows the "updated" card
    this.groove = 0; // 0..GROOVE_MAX, this visit only
    this.gaps = []; // the last few gaps between gathering taps, for the beat
    this.lastGather = -9;
    this.charge = PACE_BURST; // the hand's reserve after the last gathering tap (see TAP_EASY)
    this.tuneK = 0; // the pace of this tune's taps so far: their summed worth, and how many
    this.tuneN = 0;
    this.stageNow = -1;
    this.nextGoal = null;
    this.goalIn = 0;
    this.pvAt = 0;

    // Offline credit: wall-clock time since the save, capped; a clock that went backwards
    // (or a save stamped in the future) earns nothing and loses nothing.
    const now = this.wallRef;
    this.recalc();
    let note = "";
    let sec = 0;
    if (!loaded.fresh && loaded.t > 0) {
      sec = (now - loaded.t) / 1000;
      if (!(sec >= 0) || loaded.t > now + 60000) { note = "CLOCK MOVED BACKWARDS - NO CREDIT"; sec = 0; }
    }
    const summary = this.creditAway(sec);
    this.collectExpeditions(now, summary);
    this.collectResearch(now, summary);
    if (loaded.from > 0 && loaded.from < SCHEMA && !loaded.fresh && (this.s.lt > 0 || this.s.taps > 0)) { // goals already met are credited quietly, once
      this.checkGoals(true);
      this.news = true;
      this.newsFrom = loaded.from;
    }
    this.unlocked = unlockedN(this.s);
    this.stageNow = stageOf(this.s);
    if (summary.sec >= AWAY_MIN || summary.found.length || summary.done.length || note) {
      summary.note = note;
      this.away = summary;
      this.phase_ = "away";
    } else this.phase_ = loaded.fresh || (this.s.lt === 0 && this.s.taps === 0) ? "intro" : this.news ? "news" : "play";
    this.updateHud(true);
    this.setHint();
    this.c.leds(this.lampValues());
  }

  // ---- derived state -----------------------------------------------------------
  recalc() {
    this.dirty = false;
    this.rate = evaluate(this.s, this.out);
    const tp = tapParts(this.s);
    this.tapMult = tp.mult;
    this.tapFrac = tp.frac;
    this.dataPS = dataRate(this.s);
    this.items = this.visibleItems();
    this.affordN = this.items.filter((it) => it.cost <= this.s.sig).length;
    let goal = null;
    for (const it of this.items) if (it.cost > this.s.sig && (!goal || it.cost < goal.cost)) goal = it;
    this.goalFrac = goal ? clamp(this.s.sig / goal.cost, 0, 1) : 1;
    this.goalName = goal ? goal.name : "";
    this.goalCost = goal ? goal.cost : 0;
  }
  surge() { let m = 1; for (const b of this.boosts) if (b.k === "surge") m = Math.max(m, b.mult); return m; }
  frenzy() { let m = 1; for (const b of this.boosts) if (b.k === "frenzy") m = Math.max(m, b.mult); return m; }
  effRate() { return num(this.rate * this.surge()); }
  grooveMult() { return 1 + GROOVE_BONUS * Math.floor(this.groove) / GROOVE_MAX; }
  // What a tap is worth now. `paced` applies the easy pace (off for rewards that are not taps).
  tapValue(paced = true) {
    const v = (this.tapMult * globalMult(this.s) + this.tapFrac * this.rate) * this.frenzy() * this.grooveMult();
    return Math.max(1, num(v)) * (paced ? this.paceNow() : 1);
  }
  // The hand's reserve now (it refills between taps), and the share of a full tap the next one gets.
  reserve() { return Math.min(PACE_BURST, this.charge + (this.clk - this.lastGather) * (this.frenzy() > 1 ? TAP_EASY_FRENZY : TAP_EASY)); }
  paceNow() { return Math.min(1, this.reserve()); }
  // Tapping faster than the easy pace just now (for the hint).
  paceFast() { return this.clk - this.lastGather < 2 && this.charge < 0.5; }
  pending() { return pendingOf(this.s); }
  visibleItems() {
    const s = this.s, list = [];
    for (let i = 0; i < NP; i++) if (prodVisible(s, i)) list.push({ type: "p", i, key: "p" + i, name: PROD[i].n, cost: costOf(s, i) });
    for (const u of UPG) if (upgradeVisible(s, u)) list.push({ type: "u", i: u.idx, key: "u" + u.idx, name: u.name, cost: u.cost });
    return list;
  }
  gainOf(it) {
    const s = this.s, base = this.rate;
    if (it.type === "p") {
      s.own[it.i]++;
      const after = evaluate(s, null);
      s.own[it.i]--;
      return (after - base) / it.cost;
    }
    s.up[it.i] = 1;
    const after = evaluate(s, null);
    s.up[it.i] = 0;
    return (after - base) / it.cost + 1e-12;
  }

  // ---- economy actions ---------------------------------------------------------
  // kind: h = by hand (taps and tune bonuses), m = machines, o = credited while away, b = bonuses
  gain(x, kind = "m") {
    x = num(x);
    const s = this.s, st = s.st;
    s.sig = Math.min(BIG, s.sig + x);
    s.rt = Math.min(BIG, s.rt + x);
    s.lt = Math.min(BIG, s.lt + x);
    if (kind === "h") { st.hand = Math.min(BIG, st.hand + x); st.rhand = Math.min(BIG, st.rhand + x); }
    else if (kind === "m") { st.mach = Math.min(BIG, st.mach + x); st.rmach = Math.min(BIG, st.rmach + x); }
    else if (kind === "o") st.off = Math.min(BIG, st.off + x);
    else st.bon = Math.min(BIG, st.bon + x);
  }
  buyProd(i) {
    const s = this.s;
    if (!(i >= 0 && i < NP) || s.own[i] >= MAX_OWN || !tierOpen(s, i)) return false;
    const cost = costOf(s, i);
    if (s.sig < cost) return false;
    s.st.buys++;
    const before = milestonesAt(s.own[i]);
    s.sig -= cost;
    s.own[i]++;
    s.maxTier = Math.max(s.maxTier, i);
    this.flash[i] = 1;
    this.dirty = true;
    this.recalc();
    if (milestonesAt(s.own[i]) > before) this.milestoneFx(PROD[i].n + " x" + s.own[i] + ": OUTPUT DOUBLED");
    return true;
  }
  buyUpg(idx) {
    const s = this.s, u = UPG[idx];
    if (!u || s.up[idx] || s.sig < u.cost) return false;
    s.sig -= u.cost;
    s.up[idx] = 1;
    s.st.buys++;
    this.dirty = true;
    this.recalc();
    return true;
  }
  // Greedy: affordable upgrades first (best gain per cost), then machines by gain per cost.
  buyAll() {
    let n = 0;
    for (let guard = 0; guard < 600; guard++) {
      const aff = this.items.filter((it) => it.cost <= this.s.sig);
      if (!aff.length) break;
      let best = null, bestG = -1;
      for (const it of aff) {
        const g = this.gainOf(it) * (it.type === "u" ? 1.5 : 1);
        if (g > bestG) { bestG = g; best = it; }
      }
      if (!best || !(best.type === "p" ? this.buyProd(best.i) : this.buyUpg(best.i))) break;
      n++;
    }
    return n;
  }
  buyNode(k) {
    const s = this.s, nd = TREE[k];
    if (!nd || s.tree[k] >= nd.max) return false;
    const cost = nd.cost(s.tree[k]);
    if (s.b < cost) return false;
    s.b -= cost;
    s.tree[k]++;
    s.st.buys++;
    if (k === 0) this.applyKitNow();
    this.dirty = true;
    this.recalc();
    return true;
  }
  chartNext() {
    const s = this.s;
    if (!chartsOpen(s) || s.cn >= CHART_MAX) return false;
    const cost = chartCost(s.cn);
    if (s.b < cost) return false;
    s.b -= cost;
    s.cn++;
    s.st.buys++;
    this.setNote("CHARTED " + chartName(s.cn - 1) + "  ALL OUTPUT x" + CHART_MULT, 4.5);
    this.dirty = true;
    this.recalc();
    return true;
  }
  applyKitNow() {
    const s = this.s;
    s.sig += KIT_SIGNAL[s.tree[0]] - KIT_SIGNAL[Math.max(0, s.tree[0] - 1)];
    applyKit(s);
  }
  relocate() {
    const s = this.s, p = this.pending();
    if (p < 1) return false;
    const stats = { signal: fmt(s.lt), bearings: s.L + p, relocations: s.runs + 1 };
    this.card = { gain: p, run: s.rt, secs: s.play, total: s.L + p, taps: s.st.rtaps, hand: s.st.rhand, mach: s.st.rmach, stage: STAGES[stageOf(s)] };
    if (s.st.fr === 0 || s.play < s.st.fr) s.st.fr = Math.max(1, Math.floor(s.play));
    s.st.rtaps = 0; s.st.rhand = 0; s.st.rmach = 0;
    s.b = Math.min(1e9, s.b + p);
    s.L = Math.min(1e9, s.L + p);
    s.runs++;
    s.milestone = s.L;
    s.last = stats;
    s.own.fill(0);
    s.up.fill(0);
    s.sig = KIT_SIGNAL[s.tree[0]];
    s.rt = 0;
    s.ex = [];
    s.play = 0;
    applyKit(s);
    this.boosts.length = 0;
    this.flare = null;
    this.flareIn = 40;
    this.ring = null;
    this.phase_ = "card";
    this.cardT = 0;
    this.accent = { k: "prestige", t: 0, dur: 2.4 };
    cue(this, "relocate");
    this.dirty = true;
    this.recalc();
    this.save(true);
    return true;
  }
  // Credit production earned while closed (or paused for long). Returns the summary.
  creditAway(sec) {
    const cap = capHours(this.s) * 3600;
    const sum = { sec: 0, gain: 0, capped: false, found: [], relics: 0, note: "", data: 0, done: [] };
    if (!(sec > 0)) return sum;
    const used = Math.min(sec, cap);
    sum.capped = sec > cap;
    sum.sec = used;
    sum.gain = num(this.rate * used);
    this.gain(sum.gain, "o");
    sum.data = dataRate(this.s) * used;
    this.s.dat = Math.min(1e12, this.s.dat + sum.data);
    this.s.st.ta = Math.min(1e15, this.s.st.ta + used);
    this.dirty = true;
    return sum;
  }
  collectExpeditions(now, sum) {
    const s = this.s;
    const keep = [];
    for (const e of s.ex) {
      const x = EXPED[e.k];
      if (e.end > now + x.sec * 1000 + 60000) e.end = now + x.sec * 1000; // clock went backwards: never wait longer than the trip
      if (now >= e.end) {
        const reward = num(this.rate * x.mins * 60);
        this.gain(reward, "b");
        s.dat = Math.min(1e12, s.dat + x.data * dataBonus(s));
        let relic = false;
        if (s.relics < MAX_RELICS && this.c.rng.next() < x.relic) { s.relics++; relic = true; }
        const rec = { name: x.n, reward, relic };
        if (sum) sum.found.push(rec);
        else this.expeditionBack(rec);
      } else keep.push(e);
    }
    s.ex = keep;
    this.dirty = true;
  }
  expeditionBack(rec) {
    this.setNote(rec.name + " RETURNED: +" + fmt(rec.reward) + (rec.relic ? " AND A RELIC" : ""), 5);
    this.accent = { k: "event", t: 0, dur: 0.7 };
    cue(this, rec.relic ? "teamRelic" : "teamBack");
    this.save(true);
  }
  launch(k) {
    const s = this.s, x = EXPED[k];
    if (!x || !s.tree[5] || s.ex.length >= slotsOf(s) || (x.res !== undefined && !hasRes(s, x.res))) return false;
    s.ex.push({ k, end: Date.now() + x.sec * 1000 });
    s.st.ex++;
    cue(this, "teamOut");
    this.save(true);
    return true;
  }

  // ---- research and goals ---------------------------------------------------------------
  startResearch(k) {
    const s = this.s, r = RES[k];
    if (!r || hasRes(s, k) || s.rs.some((e) => e.k === k) || s.rs.length >= resSlots(s) || !r.need(s) || s.dat < r.data) return false;
    s.dat -= r.data;
    s.rs.push({ k, end: Date.now() + r.sec * 1000 });
    cue(this, "research");
    this.save(true);
    return true;
  }
  // Finishes projects whose time has come (on the wall clock, so also while closed).
  collectResearch(now, sum) {
    const s = this.s, keep = [];
    for (const e of s.rs) {
      const r = RES[e.k];
      if (e.end > now + r.sec * 1000 + 60000) e.end = now + r.sec * 1000; // clock went backwards
      if (now >= e.end) {
        if (!hasRes(s, e.k)) s.rd.push(e.k);
        if (sum) sum.done.push(r.n);
        else { this.setNote("RESEARCH COMPLETE: " + r.n, 5); this.accent = { k: "event", t: 0, dur: 0.7 }; cue(this, "researchDone"); this.save(true); }
        this.dirty = true;
      } else keep.push(e);
    }
    s.rs = keep;
  }
  // Credits every goal that is met. Quietly (no messages) when loading an older save.
  checkGoals(quiet) {
    const s = this.s;
    let n = 0, last = null;
    for (let i = 0; i < NG; i++) {
      if (s.gl.includes(i)) continue;
      if (GOALS[i].v(s) >= GOALS[i].t) { s.gl.push(i); s.dat = Math.min(1e12, s.dat + 2 * dataBonus(s)); n++; last = GOALS[i]; }
    }
    if (n) {
      this.dirty = true;
      if (!quiet) {
        this.setNote("GOAL: " + last.n + (n > 1 ? " AND " + (n - 1) + " MORE" : "") + "  +" + n + "% OUTPUT", 4.5);
        this.accent = { k: "event", t: 0, dur: 0.7 };
        cue(this, "goal");
        this.saveSoon();
      }
    }
    let best = null, bf = -1;
    for (let i = 0; i < NG; i++) {
      const g = GOALS[i];
      if (g.hid || s.gl.includes(i)) continue;
      const f = goalFrac(s, g);
      if (f > bf) { bf = f; best = i; }
    }
    this.nextGoal = best;
  }

  // ---- the song of the outpost --------------------------------------------------------------
  loadMelody() {
    const s = this.s;
    if (s.sg === GEN_ID) this.mel = genTune(s.gs);
    else {
      if (!(s.sg >= 0 && s.sg < NS) || s.lt < SONGS[s.sg].at) s.sg = 0;
      this.mel = MEL[s.sg];
    }
    if (!(s.sp >= 0 && s.sp < this.mel.n.length)) s.sp = 0;
  }
  voices() { let n = 0; for (const k of VOICE) if (this.s.up[k]) n++; return n; }
  // k: the share of a full tap this note's tap was worth (the easy pace)
  playNote(k = 1) {
    const s = this.s, m = this.mel, st = s.st;
    if (s.sp >= m.n.length) s.sp = 0;
    const idx = s.sp, midi = m.n[idx], gap = this.clk - this.lastNoteAt;
    this.recent.push({ at: this.clk, sp: idx, sg: s.sg, gs: s.gs });
    if (this.recent.length > 6) this.recent.shift();
    if (idx === 0) { this.tuneClean = true; this.tuneK = 0; this.tuneN = 0; } else if (gap > 1.6) this.tuneClean = false;
    this.tuneK += k; this.tuneN++;
    this.lastNoteAt = this.clk;
    voiceNote(this, midi, gap, idx); // the tap's note, with the station's voices (outpost-music.js)
    this.noteFx = { pos: m.hi > m.lo ? clamp((midi - m.lo) / (m.hi - m.lo), 0, 1) : 0.5, t: 0 };
    st.nt = Math.min(1e12, st.nt + 1);
    s.sp = idx + 1;
    if (idx >= m.n.length - 1) this.finishTune();
    else if (m.ends.includes(idx)) this.finishPhrase(k);
  }
  finishPhrase(k = 1) {
    const s = this.s;
    s.st.ph++;
    this.gain(this.tapValue(false) * k * 2 * (1 + 0.5 * s.tree[10]), "h");
    this.accent = { k: "phrase", t: 0, dur: 0.4 };
    this.dirty = true;
  }
  finishTune() {
    const s = this.s, m = this.mel, st = s.st, len = m.n.length, pp = 1 + 0.5 * s.tree[10];
    // paced by the tune's taps, or playing faster would pay more tunes a minute
    const lump = (this.effRate() * LUMP_SEC * len * (1 + 0.25 * this.voices()) + this.tapValue(false) * len * 0.15) * pp * (this.tuneN ? this.tuneK / this.tuneN : 1);
    this.gain(lump, "h");
    st.md++;
    let first = false, mastered = false;
    if (s.sg === GEN_ID) st.gen++;
    else { first = s.sc[s.sg] === 0; s.sc[s.sg]++; mastered = s.sc[s.sg] === 5; }
    s.dat = Math.min(1e12, s.dat + (first ? 1 : 0.2) * dataBonus(s));
    if (this.tuneClean && len >= 16) s.ev |= EV.perfect;
    this.accent = { k: "tune", t: 0, dur: 1 };
    this.setNote(mastered ? m.name + " MASTERED  +2% OUTPUT" : (first ? "FIRST PLAYING: " : "TUNE COMPLETE: ") + m.name + "  +" + fmt(lump), 4);
    tuneCue(this, m); // a closing flourish on the tune's own triad
    this.nextTune();
    this.dirty = true;
    this.saveSoon();
  }
  nextTune() {
    const s = this.s, rng = this.c.rng;
    s.sp = 0;
    const can = [];
    for (let i = 0; i < NS; i++) if (s.lt >= SONGS[i].at) can.push(i);
    const gen = hasRes(s, 0);
    if (s.sm === 1) {
      const pool = can.slice();
      if (gen) pool.push(GEN_ID);
      const others = pool.filter((x) => x !== s.sg), from = others.length ? others : pool;
      const pick = from[rng.int(0, from.length - 1)];
      if (pick === GEN_ID) { s.gs = rng.int(1, 4e9); s.sg = GEN_ID; } else s.sg = pick;
    } else if (s.sm === 2 && gen) { s.gs = rng.int(1, 4e9); s.sg = GEN_ID; }
    this.loadMelody();
  }
  // Takes back the last k gathering taps' place in the melody (their signal stays). Used when
  // a press turned out to be part of a menu gesture rather than playing.
  unplay(k) {
    const s = this.s;
    if (k <= 0 || !this.recent.length) return;
    k = Math.min(k, this.recent.length);
    const first = this.recent[this.recent.length - k];
    this.recent.length -= k;
    if (first.sg !== s.sg || (s.sg === GEN_ID && first.gs !== s.gs)) { s.sg = first.sg; s.gs = first.gs; this.loadMelody(); }
    s.sp = first.sp;
    this.noteFx = null;
  }

  // ---- effects ------------------------------------------------------------------
  setNote(textValue, secs = 3) { this.note = { text: textValue, t: secs }; }
  milestoneFx(label) {
    this.accent = { k: "milestone", t: 0, dur: 0.9 };
    this.setNote("MILESTONE - " + label, 3.5);
    cue(this, "milestone");
  }

  // ---- input --------------------------------------------------------------------
  down() {
    this.idle = 0;
    this.down_ = true;
    this.downAt = this.clk;
    this.consume = false;
    this.downAge = this.ring ? this.clk - this.ring.hiAt : 0;
    if (this.phase_ === "intro") { this.phase_ = "play"; this.consume = true; this.setHint(); return; }
    if (this.phase_ === "away") { this.phase_ = this.news ? "news" : "play"; this.away = null; this.consume = true; this.setHint(); return; }
    if (this.phase_ === "news") { this.phase_ = "play"; this.news = false; this.consume = true; this.setHint(); return; }
    if (this.phase_ === "card") {
      if (this.cardT > 1.2) {
        this.phase_ = "play"; this.consume = true;
        if (this.s.b > 0) this.openRing("tree");
        this.setHint();
      } else this.consume = true;
      return;
    }
    if (this.ring) { this.ring.last = this.clk; return; }
    if (this.panel) return; // the statistics view: a tap turns the page, a hold closes it (see up)
    this.gather();
  }
  up(event) {
    if (!this.down_) return;
    this.down_ = false;
    this.idle = 0;
    const heldMs = Number.isFinite(event?.durationMs) ? event.durationMs : (this.clk - this.downAt) * 1000;
    const held = heldMs / 1000;
    if (this.consume) { this.consume = false; return; }
    if (this.panel) {
      if (held >= HOLD_BUY) { this.panel = null; this.setHint(); } else this.panel.page = (this.panel.page + 1) % 3;
      tick(this, held >= HOLD_BUY ? "close" : "page");
      return;
    }
    if (!this.ring) return;
    this.ring.last = this.clk;
    const e = this.entries[this.ring.idx];
    const need = e?.hold || HOLD_BUY;
    if (held < need) { // a tap steps to the next entry
      this.step();
      return;
    }
    this.choose(e, held);
  }
  // How many of the latest gathering taps belonged to a menu gesture (a few quick taps and the
  // press that is being held): their notes are taken back so the tune does not skip ahead.
  gestureTaps() {
    const r = this.recent;
    let k = 0, t = this.downAt;
    for (let i = r.length - 1; i >= 0 && k < 3; i--) {
      if (r[i].at >= this.downAt - 1e-6) { k++; continue; } // the held press itself (unless the ring took it back already)
      if (t - r[i].at > 1.0) break;
      k++; t = r[i].at;
    }
    return k;
  }
  cancel() {
    if (this.down_ && this.phase_ === "play" && !this.panel) this.unplay(this.gestureTaps());
    this.down_ = false;
    this.consume = false;
    this.panel = null;
    this.ring = null;
    this.save(true);
    this.c.leds(lightsOff());
  }
  pause() {
    this.down_ = false;
    this.panel = null;
    this.ring = null;
    this.save(true);
    this.c.leds(lightsOff());
  }
  resume() {
    this.down_ = false;
    this.syncWall(Date.now());
  }
  dispose() {
    this.down_ = false;
    this.panel = null;
    this.ring = null;
    this.save(true);
    this.c.leds(lightsOff());
  }

  // Groove: a tap close to the recent beat adds a step, a stumble halves it, a long gap ends it.
  beatTap() {
    const s = this.s, gap = this.clk - this.lastGather;
    this.lastGather = this.clk;
    if (gap > GROOVE_MAX_GAP) { this.gaps.length = 0; this.groove = 0; return; }
    if (gap < GROOVE_MIN_GAP) { this.groove = Math.floor(this.groove / 2); return; }
    if (this.gaps.length >= 2) {
      const beat = this.gaps.reduce((a, b) => a + b, 0) / this.gaps.length;
      if (Math.abs(gap / beat - 1) <= GROOVE_TOL) this.groove = Math.min(GROOVE_MAX, Math.floor(this.groove) + 1);
      else this.groove = Math.floor(this.groove / 2);
    }
    this.gaps.push(gap);
    if (this.gaps.length > 4) this.gaps.shift();
    s.st.gb = Math.max(s.st.gb, Math.floor(this.groove));
    if (this.groove >= GROOVE_MAX) { s.ev |= EV.groove; s.st.gt = Math.min(1e15, s.st.gt + 1); }
  }
  gather() {
    const s = this.s, have = this.reserve(), k = Math.min(1, have);
    this.charge = have - k;
    this.beatTap();
    const v = this.tapValue(false) * k;
    this.gain(v, "h");
    s.taps = Math.min(1e12, s.taps + 1);
    s.st.rtaps++;
    this.dirty = true;
    this.tapTimes.push(this.clk);
    if (this.tapTimes.length > 12) this.tapTimes.shift();
    if (this.tapTimes.length === 12 && this.clk - this.tapTimes[0] < 1.8) s.ev |= EV.presto;
    this.playNote(k);
    addRipple(this);
    addFloat(this, "+" + fmt(v), 480 + this.c.rng.range(-70, 70), 215 + this.c.rng.range(-8, 8));
    if (this.flare) this.catchFlare();
  }
  catchFlare() {
    const r = this.c.rng.next(), s = this.s;
    if (this.flare.life - this.flare.t < 1.5) s.ev |= EV.quick;
    s.st.fl++;
    if (hasRes(s, 2)) s.dat = Math.min(1e12, s.dat + 2 * dataBonus(s));
    this.flare = null;
    this.accent = { k: "event", t: 0, dur: 0.7 };
    cue(this, "flare");
    if (r < 0.55) {
      this.boosts.push({ k: "surge", t: 30, max: 30, mult: 7 });
      this.setNote("FLARE CAUGHT - SURGE x7 FOR 30 S", 4);
    } else if (r < 0.8) {
      const g = this.effRate() * 600 + this.tapValue(false) * 40;
      this.gain(g, "b");
      this.setNote("FLARE CAUGHT - LODE +" + fmt(g), 4);
    } else {
      this.boosts.push({ k: "frenzy", t: 15, max: 15, mult: 30 });
      this.setNote("FLARE CAUGHT - TAPS x30 FOR 15 S", 4);
    }
    if (this.boosts.length > 4) this.boosts.shift();
    this.dirty = true;
    void s;
  }

  // ---- the build ring ---------------------------------------------------------------
  openRing(menu = "main") {
    if (this.dirty) this.recalc();
    this.ring = { menu, idx: 0, hiAt: this.clk, last: this.clk };
    this.entries = [];
    this.rebuild(true);
    cue(this, "ringOpen");
    this.setHint();
  }
  closeRing() {
    this.ring = null;
    this.queue = this.queue.filter((q) => !q.pv); // a tune tasted in the songbook stops when the ring closes
    this.save(true);
    this.setHint();
  }
  // Sorted: close, buy-all, affordable (best gain per cost first), sub-menus, then a few
  // previews of what is nearly affordable. Never more than about a dozen entries.
  buildMain() {
    const s = this.s, list = [{ key: "close", kind: "close", label: "CLOSE", lines: ["BACK TO THE STATION"], hold: HOLD_BUY }];
    const aff = this.items.filter((it) => it.cost <= s.sig);
    for (const it of aff) it.g = this.gainOf(it) * (it.type === "u" ? 1.5 : 1);
    aff.sort((a, b) => b.g - a.g);
    // the views come right after CLOSE, so they are one tap away when nothing is affordable
    list.push({ key: "stats", kind: "panel", label: "STATISTICS", aff: true, big: fmt(s.taps) + " TAPS", lines: ["TOTALS, THIS RUN, MUSIC", "AND FIELD RECORDS."] });
    list.push({ key: "songs", kind: "sub", sub: "songs", label: "SONGBOOK", aff: true, big: unlockedN(s) + " / " + NS + " TUNES", lines: ["NOW: " + this.mel.name, "CHOOSE WHAT YOUR TAPS PLAY."] });
    if (aff.length >= 2) {
      list.push({ key: "all", kind: "all", label: "BUY ALL AFFORDABLE", aff: true, big: aff.length + " ITEMS", lines: ["SPEND SIGNAL ON EVERYTHING", "WORTH BUYING, BEST FIRST"], cost: 0 });
    }
    for (const it of aff.slice(0, 7)) list.push(this.itemEntry(it, true));
    if (s.tree[5] > 0) list.push({ key: "exp", kind: "sub", sub: "exp", label: "EXPEDITIONS", aff: s.ex.length < slotsOf(s), big: s.ex.length + " / " + slotsOf(s) + " OUT", lines: ["SEND A TEAM OUT ON A TIMER.", "THEY RETURN WITH FINDINGS."] });
    if (s.lt >= 2000 || s.rd.length || s.rs.length) {
      const can = s.rs.length < resSlots(s) && RES.some((r, k) => !hasRes(s, k) && !s.rs.some((e) => e.k === k) && r.need(s) && s.dat >= r.data);
      list.push({ key: "res", kind: "sub", sub: "res", label: "RESEARCH", aff: can, big: Math.floor(s.dat) + " DATA", lines: ["SLOW PROJECTS THAT UNLOCK", "NEW THINGS. THEY RUN AWAY."] });
    }
    list.push({ key: "goals", kind: "sub", sub: "goals", label: "GOALS", aff: false, big: s.gl.length + " / " + NG + " DONE", lines: ["EACH ONE IS +1% OUTPUT FOR EVER.", "SOME ARE HIDDEN."] });
    if (s.L > 0 || s.b > 0 || s.runs > 0) {
      const can = TREE.some((nd, k) => s.L >= nd.req && s.tree[k] < nd.max && s.b >= nd.cost(s.tree[k])) || (chartsOpen(s) && s.cn < CHART_MAX && s.b >= chartCost(s.cn));
      list.push({ key: "tree", kind: "sub", sub: "tree", label: "BEARING TREE", aff: can, big: s.b + " BEARINGS", lines: ["SPEND BEARINGS ON LASTING", "BONUSES. KEPT FOR EVER."] });
    }
    const p = this.pending();
    if (revealOf(s)) list.push({ key: "reloc", kind: "sub", sub: "reloc", label: "RELOCATE OUTPOST", aff: readyOf(s), big: "+" + p + " BEARINGS", lines: ["START OVER ELSEWHERE AND", "KEEP PERMANENT BEARINGS."] });
    const prev = this.items.filter((it) => it.cost > s.sig).sort((a, b) => a.cost - b.cost).slice(0, 3);
    for (const it of prev) list.push(this.itemEntry(it, false));
    return list;
  }
  itemEntry(it, aff) {
    const s = this.s;
    if (it.type === "p") {
      const i = it.i, n = s.own[i], each = PROD[i].r * prodMult(s, i) * globalMult(s);
      const nm = nextMilestone(n);
      return { key: it.key, kind: "prod", i, label: PROD[i].n, sub: "x" + n, aff, cost: it.cost, big: "COST " + fmt(it.cost),
        lines: ["OWNED " + n + "  EACH " + fmtRate(each) + " /S", PROD[i].fx.toUpperCase(), nm ? "NEXT x2 AT " + nm + " OWNED" : "ALL MILESTONES MET"] };
    }
    const u = UPG[it.i];
    return { key: it.key, kind: "upg", i: it.i, label: u.name, sub: "UPG", aff, cost: u.cost, big: "COST " + fmt(u.cost), lines: [u.eff] };
  }
  buildExp() {
    const s = this.s, list = [{ key: "back", kind: "back", label: "BACK", lines: ["TO THE BUILD RING"], hold: HOLD_BUY }];
    const now = Date.now();
    for (const e of s.ex) {
      const x = EXPED[e.k];
      list.push({ key: "act" + e.end, kind: "info", label: x.n, sub: clock((e.end - now) / 1000), aff: false, big: "OUT " + clock((e.end - now) / 1000),
        lines: ["EXPECTED " + fmt(this.rate * x.mins * 60)] });
    }
    EXPED.forEach((x, k) => {
      const free = s.ex.length < slotsOf(s);
      list.push({ key: "go" + k, kind: "launch", k, label: x.n, sub: dur(x.sec), aff: free, big: "RETURNS ~" + fmt(this.rate * x.mins * 60),
        lines: [free ? "BACK IN " + dur(x.sec) : "NO FREE TEAM", "WORTH " + x.mins + " MIN OF OUTPUT", x.relic ? Math.round(x.relic * 100) + "% CHANCE OF A RELIC" : "NO RELICS ON SHORT TRIPS"] });
    });
    return list;
  }
  buildTree() {
    const s = this.s, list = [{ key: "back", kind: "back", label: "BACK", lines: ["TO THE BUILD RING"], hold: HOLD_BUY }];
    const nodes = [];
    TREE.forEach((nd, k) => {
      if (s.L < nd.req) return;
      const lvl = s.tree[k];
      if (lvl >= nd.max) { nodes.push({ key: "n" + k, kind: "info", label: nd.n, sub: "MAX", aff: false, sort: 2, big: "COMPLETE", lines: [nd.eff(lvl - 1)] }); return; }
      const cost = nd.cost(lvl), aff = s.b >= cost;
      nodes.push({ key: "n" + k, kind: "node", k, label: nd.n, sub: "L" + lvl + "/" + nd.max, aff, cost, sort: aff ? 0 : 1, big: "COST " + cost + " BEARINGS", lines: [nd.eff(lvl), "YOU HAVE " + s.b + " BEARINGS"] });
    });
    nodes.sort((a, b) => a.sort - b.sort || (a.cost || 0) - (b.cost || 0));
    if (chartsOpen(s) && s.cn < CHART_MAX) {
      const cost = chartCost(s.cn);
      nodes.push({ key: "chart", kind: "chart", label: "CHART " + chartName(s.cn), sub: "SKY " + s.cn, aff: s.b >= cost, cost, big: "COST " + cost + " BEARINGS",
        lines: ["ALL OUTPUT x" + CHART_MULT + ", FOR EVER.", s.cn + " CHARTED SO FAR: x" + fmt(Math.pow(CHART_MULT, s.cn)), "YOU HAVE " + s.b + " BEARINGS"] });
    } else if (s.L >= CHART_REQ / 2) nodes.push({ key: "chartl", kind: "info", label: "CONSTELLATIONS", sub: "LOCKED", aff: false, big: "AT " + CHART_REQ + " BEARINGS", lines: ["HOLD " + CHART_REQ + " BEARINGS IN ALL", "TO START CHARTING THE SKY."] });
    return list.concat(nodes);
  }
  buildSongs() {
    const s = this.s, gen = hasRes(s, 0);
    const list = [{ key: "back", kind: "back", label: "BACK", lines: ["TO THE BUILD RING"], hold: HOLD_BUY }];
    const modes = ["LOOP THIS TUNE", "SHUFFLE TUNES", "ENDLESS NEW TUNES"];
    list.push({ key: "mode", kind: "mode", label: "ORDER", sub: ["LOOP", "SHUFFLE", "NEW"][s.sm], aff: true, big: modes[s.sm], lines: ["HOLD TO CHANGE WHAT PLAYS", "AFTER A TUNE IS FINISHED."] });
    for (let i = 0; i < NS; i++) {
      if (s.lt < SONGS[i].at) continue;
      list.push({ key: "s" + i, kind: "song", i, cur: s.sg === i, label: SONGS[i].name, sub: s.sc[i] >= 5 ? "MASTER" : s.sc[i] + "X", aff: true,
        big: s.sg === i ? "PLAYING" : "PLAY THIS", lines: [SONGS[i].by, "PLAYED " + s.sc[i] + " TIMES", s.sc[i] >= 5 ? "MASTERED: +2% OUTPUT" : "MASTER AT 5 PLAYS: +2% OUTPUT"] });
    }
    if (gen) {
      list.push({ key: "gen", kind: "song", i: GEN_ID, cur: s.sg === GEN_ID, label: genName(s.gs), sub: "SEED", aff: true, big: s.sg === GEN_ID ? "PLAYING" : "PLAY THIS",
        lines: ["COMPOSED FROM A SEED.", "THE SAME NAME IS ALWAYS", "THE SAME TUNE."] });
      list.push({ key: "newgen", kind: "songnew", label: "COMPOSE A NEW TUNE", aff: true, big: "NEW SEED", lines: ["MAKES A TUNE NOBODY HAS", "HEARD, AND PLAYS IT."] });
    }
    let shown = 0;
    for (let i = 0; i < NS && shown < 2; i++) {
      if (s.lt >= SONGS[i].at) continue;
      shown++;
      list.push({ key: "l" + i, kind: "info", label: "LOCKED TUNE", sub: "???", aff: false, big: "AT " + fmt(SONGS[i].at) + " SIGNAL", lines: ["KEEP GATHERING TO HEAR IT."] });
    }
    return list;
  }
  buildRes() {
    const s = this.s, now = Date.now();
    const list = [{ key: "back", kind: "back", label: "BACK", lines: ["TO THE BUILD RING"], hold: HOLD_BUY }];
    list.push({ key: "data", kind: "info", label: "DATA", sub: String(Math.floor(s.dat)), aff: false, big: Math.floor(s.dat) + " DATA",
      lines: ["+" + (this.dataPS * 60).toFixed(2) + " A MINUTE FROM THE MACHINES.", "GOALS, NEW TUNES AND EXPEDITIONS ADD MORE."] });
    for (const e of s.rs) {
      const left = (e.end - now) / 1000;
      list.push({ key: "rs" + e.k, kind: "info", label: RES[e.k].n, sub: clock(left), aff: false, big: "DONE IN " + clock(left), lines: [RES[e.k].fx, "IT RUNS WHILE YOU ARE AWAY."] });
    }
    const free = s.rs.length < resSlots(s);
    RES.forEach((r, k) => {
      if (hasRes(s, k) || s.rs.some((e) => e.k === k)) return;
      const ok = r.need(s), aff = ok && free && s.dat >= r.data;
      list.push({ key: "r" + k, kind: ok ? "research" : "info", k, label: r.n, sub: ok ? r.data + " DATA" : "LOCKED", aff, big: ok ? "COST " + r.data + " DATA" : "LOCKED",
        lines: ok ? [r.fx, "TAKES " + dur(r.sec), free ? "YOU HAVE " + Math.floor(s.dat) + " DATA" : "NO FREE BENCH"] : [r.hint] });
    });
    if (s.rd.length) list.push({ key: "done", kind: "info", label: "COMPLETED", sub: s.rd.length + "/" + NR, aff: false, big: s.rd.length + " / " + NR, lines: s.rd.map((k) => RES[k].n).slice(0, 3) });
    return list;
  }
  buildGoals() {
    const s = this.s, list = [{ key: "back", kind: "back", label: "BACK", lines: ["TO THE BUILD RING"], hold: HOLD_BUY }];
    const open = [];
    for (let i = 0; i < NG; i++) if (!s.gl.includes(i) && !GOALS[i].hid) open.push(i);
    open.sort((a, b) => goalFrac(s, GOALS[b]) - goalFrac(s, GOALS[a]));
    for (const i of open.slice(0, 5)) {
      const g = GOALS[i], pct = Math.floor(goalFrac(s, g) * 100);
      list.push({ key: "g" + i, kind: "info", label: g.n, sub: pct + "%", aff: false, big: pct + "% DONE", lines: [g.d, fmt(Math.min(g.v(s), g.t)) + " OF " + fmt(g.t), "REWARD +1% OUTPUT, 2 DATA"] });
    }
    for (let i = 0; i < NG; i++) if (GOALS[i].hid && !s.gl.includes(i)) list.push({ key: "h" + i, kind: "info", label: "HIDDEN GOAL", sub: "???", aff: false, big: "???", lines: ["HINT: " + GOALS[i].hint] });
    list.push({ key: "gdone", kind: "info", label: "COMPLETED", sub: s.gl.length + "/" + NG, aff: false, big: s.gl.length + " / " + NG, lines: ["+" + s.gl.length + "% OUTPUT SO FAR."] });
    return list;
  }
  buildReloc() {
    const p = this.pending(), s = this.s;
    return [
      { key: "back", kind: "back", label: "BACK", lines: ["STAY HERE FOR NOW"], hold: HOLD_BUY },
      { key: "go", kind: "reloc", label: "RELOCATE NOW", aff: true, big: "+" + p + " BEARINGS", hold: HOLD_BIG, dwell: DWELL_BIG,
        lines: ["MACHINES AND SIGNAL ARE LOST.", "BEARINGS, TREE, RELICS KEPT.", "TOTAL AFTER: " + (s.L + p) + " BEARINGS"] },
    ];
  }
  rebuild(initial = false) {
    const r = this.ring;
    if (!r) return;
    const old = this.entries[r.idx]?.key;
    const m = r.menu;
    this.entries = m === "exp" ? this.buildExp() : m === "tree" ? this.buildTree() : m === "reloc" ? this.buildReloc() : m === "songs" ? this.buildSongs()
      : m === "res" ? this.buildRes() : m === "goals" ? this.buildGoals() : this.buildMain();
    let idx = this.entries.findIndex((e) => e.key === old);
    if (idx < 0) {
      idx = m === "main" ? this.entries.findIndex((e) => e.kind === "prod" || e.kind === "upg") : m === "songs" ? this.entries.findIndex((e) => e.cur) : this.entries.findIndex((e) => e.aff);
      if (idx < 0 || (initial && m === "main" && !this.entries[idx].aff)) idx = 0;
    }
    r.idx = clamp(idx, 0, this.entries.length - 1);
    r.hiAt = this.clk;
  }
  step() {
    const r = this.ring;
    if (!r || !this.entries.length) return;
    r.idx = (r.idx + 1) % this.entries.length;
    r.hiAt = this.clk;
    const e = this.entries[r.idx];
    if (r.menu === "songs" && e?.kind === "song") previewTune(this, e.i === GEN_ID ? genTune(this.s.gs) : MEL[e.i]);
    else tick(this, "step", r.idx);
  }
  choose(e, held) {
    const r = this.ring;
    if (!r || !e) return;
    if (e.kind !== "close" && e.kind !== "back" && this.downAge < (e.dwell || DWELL)) { // a stray hold on a fresh highlight does nothing
      this.refused = this.clk;
      return;
    }
    void held;
    let ok = false;
    switch (e.kind) {
      case "close": this.closeRing(); return;
      case "back": r.menu = "main"; this.rebuild(); cue(this, "back"); return;
      case "all": ok = this.buyAll() > 0; break;
      case "prod": ok = this.buyProd(e.i); break;
      case "upg": ok = this.buyUpg(e.i); break;
      case "node": ok = this.buyNode(e.k); break;
      case "chart": ok = this.chartNext(); break;
      case "launch": ok = this.launch(e.k); break;
      case "sub": r.menu = e.sub; r.idx = 0; this.entries = []; this.rebuild(true); cue(this, "sub"); return;
      case "panel": this.ring = null; this.panel = { page: 0 }; cue(this, "panel"); this.setHint(); return;
      case "mode": this.s.sm = (this.s.sm + 1) % (hasRes(this.s, 0) ? 3 : 2); this.rebuild(); cue(this, "mode"); return;
      case "song": {
        const s = this.s;
        if (e.i === GEN_ID) s.sg = GEN_ID; else if (s.lt >= SONGS[e.i].at) s.sg = e.i; else break;
        s.sp = 0; this.recent.length = 0; this.loadMelody();
        this.setNote("NOW PLAYING: " + this.mel.name, 3.5);
        this.closeRing();
        return;
      }
      case "songnew": {
        const s = this.s;
        s.gs = this.c.rng.int(1, 4e9); s.sg = GEN_ID; s.sp = 0; this.recent.length = 0; this.loadMelody();
        this.rebuild();
        previewTune(this, this.mel);
        return;
      }
      case "research": ok = this.startResearch(e.k); break;
      case "reloc": this.relocate(); return;
      default: break;
    }
    if (ok) {
      this.accent = this.accent?.k === "milestone" ? this.accent : { k: "buy", t: 0, dur: 0.35 };
      if (e.kind !== "node" && e.kind !== "launch" && e.kind !== "research" && e.kind !== "chart") cue(this, "buy");
      else cue(this, "spend");
      this.saveSoon();
    } else this.refused = this.clk;
    this.rebuild();
  }

  // ---- saving ----------------------------------------------------------------------------
  saveSoon() { this.savePending = true; }
  save(force = false) {
    if (!force && this.saveCool > 0) { this.savePending = true; return; }
    this.savePending = false;
    this.saveCool = SAVE_GAP;
    this.saveIn = SAVE_EVERY;
    const s = this.s;
    const level = Math.floor(20 * Math.log10(1 + s.lt));
    if (level > this.lastLevel) { this.lastLevel = level; this.c.score?.(level); }
    try { this.c.saveProgress?.({ ...serialize(s, Date.now()), runs: s.runs })?.catch?.(() => {}); } catch { /* the host reports save failures */ }
  }
  // Production the sim did not see: wall time minus game time since the last sync.
  syncWall(now) {
    const gap = (now - this.wallRef) / 1000 - this.simSince;
    this.wallRef = now;
    this.simSince = 0;
    if (!(gap > 10)) return;
    const sum = this.creditAway(gap);
    if (sum.sec >= 60 && this.phase_ === "play") { this.away = sum; this.phase_ = "away"; this.ring = null; }
  }

  // ---- simulation ---------------------------------------------------------------------------
  update(dt) {
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.5);
    const s = this.s;
    this.clk += dt;
    this.t += dt;
    this.simSince += dt;
    this.idle += dt;
    this.recalcIn -= dt;
    if (this.dirty || this.recalcIn <= 0) { this.recalc(); this.recalcIn = 0.2; }
    s.play += dt;
    s.st.tp += dt;
    // production, and the slow trickle of data
    const eff = this.effRate();
    this.gain(eff * dt, "m");
    if (eff > s.st.peak) s.st.peak = eff;
    s.dat = Math.min(1e12, s.dat + this.dataPS * dt);
    // boosts and flare
    for (let i = this.boosts.length - 1; i >= 0; i--) { this.boosts[i].t -= dt; if (this.boosts[i].t <= 0) this.boosts.splice(i, 1); }
    if (this.flare) { this.flare.t -= dt; if (this.flare.t <= 0) this.flare = null; }
    else if (s.rt >= 150 && this.phase_ === "play" && !this.ring && !this.panel) {
      this.flareIn -= dt;
      if (this.flareIn <= 0) {
        const lvl = s.tree[7];
        const life = FLARE_LIFE * (1 + 0.25 * lvl) * (hasRes(s, 2) ? 1.4 : 1);
        this.flare = { x: this.c.rng.range(160, 800), y: this.c.rng.range(150, 300), t: life, life };
        this.flareIn = this.c.rng.range(50, 130) * 0.75 ** lvl;
        cue(this, "flareUp");
      }
    }
    // groove fades once the beat has stopped
    if (this.groove > 0) {
      const beat = this.gaps.length ? this.gaps.reduce((a, b) => a + b, 0) / this.gaps.length : 0.5;
      if (this.clk - this.lastGather > Math.max(1.2, 2.5 * beat)) this.groove = Math.max(0, this.groove - GROOVE_FADE * dt);
    }
    // held press opens the ring
    if (this.down_ && !this.ring && !this.panel && !this.consume && this.phase_ === "play" && this.clk - this.downAt >= HOLD_OPEN) {
      this.consume = true;
      const last = this.recent[this.recent.length - 1];
      if (last && last.at === this.downAt) this.unplay(1); // the press that opens the ring does not play a note
      this.openRing("main");
    }
    if (this.ring) {
      if (this.clk - this.ring.last > RING_IDLE && !this.down_) this.closeRing();
      else if (Math.floor(this.clk * 4) !== Math.floor((this.clk - dt) * 4)) { // keep affordability fresh without reshuffling
        const e = this.entries[this.ring.idx];
        if (e && (e.kind === "prod" || e.kind === "upg")) e.aff = e.cost <= s.sig;
      }
    } else if (this.phase_ === "play" && s.tree[4] > 0) {
      this.autoIn -= dt;
      if (this.autoIn <= 0) { this.autoIn = AUTO_EVERY[s.tree[4]]; this.autoBuild(); }
    }
    if (this.card !== null && this.phase_ === "card") this.cardT += dt;
    // timers on the wall clock, about once a second
    this.secIn -= dt;
    if (this.secIn <= 0) {
      this.secIn = 1;
      const now = Date.now();
      this.syncWall(now);
      if (s.ex.length) this.collectExpeditions(now, null);
      if (s.rs.length) this.collectResearch(now, null);
      this.checkGoals(false);
      const un = unlockedN(s);
      if (un > this.unlocked) { this.unlocked = un; this.setNote("NEW MELODY: " + SONGS[un - 1].name, 4.5); cue(this, "newTune"); }
      const sgNow = stageOf(s);
      if (sgNow > this.stageNow && this.phase_ === "play") this.setNote("THE STATION GROWS: " + STAGES[sgNow], 4.5);
      this.stageNow = sgNow;
      this.updateHud(false);
      this.setHint();
    }
    playQueue(this); // queued cues and previews that are due (outpost-music.js)
    // quiet "something is affordable" blip, at most every half minute and never while idle-dim
    const aff = this.affordN > 0;
    this.readyBlip -= dt;
    if (aff && !this.wasAfford && this.readyBlip <= 0 && this.idle < DIM_AFTER && this.phase_ === "play" && !this.ring && s.rt > 20) {
      tick(this, "afford");
      this.readyBlip = 30;
    }
    this.wasAfford = aff;
    stepScene(this, dt); // visual-only animation (outpost-scene.js)
    // autosave
    if (this.saveCool > 0) this.saveCool -= dt;
    this.saveIn -= dt;
    if (this.saveIn <= 0 || (this.savePending && this.saveCool <= 0)) this.save(true);
    stepLamps(this, dt); // lamps (outpost-lamps.js)
  }
  autoBuild() {
    const s = this.s;
    let best = -1, bestCost = Infinity;
    for (const it of this.items) {
      if (it.type === "p" && it.cost <= s.sig && it.cost < bestCost) { best = it; bestCost = it.cost; }
    }
    if (s.tree[4] >= 2) for (const it of this.items) if (it.type === "u" && it.cost <= s.sig && it.cost < bestCost) { best = it; bestCost = it.cost; }
    if (best === -1) return;
    if (best.type === "p") this.buyProd(best.i); else this.buyUpg(best.i);
    this.saveSoon();
  }

  // ---- lamps (outpost-lamps.js) ---------------------------------------------------------------
  lampValues() { return lampFrame(this); }

  // ---- text readouts ----------------------------------------------------------------------------
  updateHud(force) {
    const s = this.s;
    const items = [["SIGNAL", fmt(s.sig)], ["RATE", fmtRate(this.effRate()) + "/S"]];
    if (s.L > 0) items.push(["BEARINGS", s.b + " / " + s.L]);
    const key = items.map((x) => x.join("")).join("|");
    if (force || key !== this.hudKey) { this.hudKey = key; this.c.hud(items); }
  }
  setHint() {
    let h;
    if (this.phase_ === "intro" || this.phase_ === "away" || this.phase_ === "news") h = "Press to continue.";
    else if (this.panel) h = "Tap: next page. Hold, then release: close.";
    else if (this.phase_ === "card") h = "Press to continue.";
    else if (this.ring) h = "Tap: next entry. Hold, then release: choose.";
    else if (this.flare) h = "Signal flare. Tap now to catch it.";
    else if (this.paceFast()) h = "Easy does it: a steady beat pays as well as fast tapping.";
    else if (this.affordN > 0) h = "Something is affordable. Hold to build.";
    else h = "Tap to gather signal and play the song. Hold to open the build ring.";
    if (h !== this.hintKey) { this.hintKey = h; this.c.hint(h); }
  }


  // ---- drawing (outpost-scene.js) ------------------------------------------------------------------
  draw(g) { drawOutpost(g, this); }
}
Outpost.music = { SONGS, MEL, GEN_ID, makeMelody, genTune, genName, scaleUp, midiHz, noteName, noteMidi, seeded, SCALES };
Outpost.econ = { RES, GOALS, STAGES, VOICE, EV, NR, NG, NS, NT, hasRes, tierOpen, tiersOwned, dataRate, masteredN, unlockedN, stageOf, fmtInt, fmtDate, revealOf, fmt, fmtRate, dur, costOf, prodMult, globalMult, evaluate, tapParts, capHours, pendingOf, readyOf, migrate, serialize, freshState, applyKit,
  PROD, UPG, TREE, EXPED, READY_RATIO, MILESTONES, SCHEMA, BIG, PRESTIGE_K, READY_MIN, KIT, NUP, NP, milestonesAt,
  readyRatio, chartCost, chartName, chartsOpen, CONST, CHART_REQ, CHART_MULT, CHART_MAX, GROOVE_MAX, VOICE_GAIN };
