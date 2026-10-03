import test from "node:test";
import assert from "node:assert/strict";
import { InputRouter } from "../web/engine/input.js";
import { Random, overlaps, wrapAngle, formatTime, formatTemp, tempValue } from "../web/engine/math.js";
import { OrbitLock } from "../web/apps/orbit.js";
import { Undertow } from "../web/apps/undertow.js";
import { EchoVault } from "../web/apps/echo.js";
import { LightTrial } from "../web/apps/reaction.js";
import { GlyphVault } from "../web/apps/glyphs.js";
import { MorseSchool, decodeMorse, MORSE } from "../web/apps/morse.js";

function harness() {
  let now = 0;
  const events = [];
  const host = {
    epoch: 0,
    mode: "menu",
    holdMs: () => 650,
    inputMode() {
      return this.mode;
    },
    pressVisual() {},
    holdVisual() {},
    advance: () => events.push("advance"),
    select: () => events.push("select"),
    rawDown: (e) => events.push(["down", e]),
    rawUp: (e) => events.push(["up", e]),
    rawCancel: () => events.push("cancel"),
    requestMenu(via) {
      events.push("menu");
      this.epoch++;
    },
  };
  const router = new InputRouter(host, () => now);
  return {
    router,
    host,
    events,
    advance: (ms) => {
      now += ms;
      router.update();
    },
  };
}
function context() {
  const records = [];
  return {
    rng: new Random(1979),
    records,
    hud() {},
    hint() {},
    leds() {},
    tone() {},
    synth: { startTone() {}, stopTone() {} },
    score: (n) => records.push(n),
    best: () => 0,
    alive: () => true,
    simulated: () => true,
    settings: () => ({ morseWpm: 10 }),
    progress: () => ({}),
    saveProgress() {},
    command: async () => ({ accepted: true }),
  };
}
function ticks(game, seconds) {
  for (let i = 0; i < Math.round(seconds * 60); i++) game.update(1 / 60);
}

test("short tap advances and hold selects only on release", () => {
  const h = harness();
  h.router.down();
  h.advance(70);
  h.router.up();
  assert.deepEqual(h.events, ["advance"]);
  h.router.down();
  h.advance(700);
  assert.deepEqual(h.events, ["advance"]);
  h.router.up();
  assert.deepEqual(h.events, ["advance", "select"]);
});
test("3-second escape suppresses the release action", () => {
  const h = harness();
  h.router.down();
  h.advance(3001);
  h.router.up();
  assert.deepEqual(h.events, ["menu"]);
});
test("raw input is immediate, source-owned, and carries node duration", () => {
  const h = harness();
  h.host.mode = "raw";
  h.router.down({ source: "node", at_us: 1000 });
  assert.equal(h.events.length, 1);
  h.router.up({ source: "keyboard", at_us: 2000 });
  assert.equal(h.events.length, 1);
  h.advance(100);
  h.router.up({ source: "node", at_us: 125000 });
  assert.equal(h.events[1][1].durationMs, 124);
});
test("release does not leak into an app entered during the press", () => {
  const h = harness();
  h.router.down();
  h.advance(700);
  h.host.epoch++;
  h.router.up();
  assert.deepEqual(h.events, []);
});
test("disconnect cancellation requires a release before reuse", () => {
  const h = harness();
  h.router.down();
  h.router.cancel(true);
  h.router.down();
  h.advance(100);
  h.router.up();
  assert.deepEqual(h.events, []);
  h.router.down();
  h.advance(100);
  h.router.up();
  assert.deepEqual(h.events, ["advance"]);
});
test("deterministic random and bounded geometry", () => {
  const a = new Random(42),
    b = new Random(42);
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
  assert.ok(overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 9, w: 2, h: 2 }));
  assert.ok(
    !overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 }),
  );
  assert.ok(Math.abs(wrapAngle(Math.PI * 4 + 0.2) - 0.2) < 1e-9);
  assert.equal(formatTime(3661), "1:01:01");
  assert.equal(formatTemp(22, "F"), "71.6 °F");
  assert.equal(formatTemp(22, "C"), "22.0 °C");
  assert.equal(tempValue(-40, "F"), -40);
});
test("orbit awards alignment and ends after three misses", () => {
  const c = context(),
    g = new OrbitLock(c);
  g.down();
  g.target = g.angle;
  g.down();
  assert.equal(g.points, 1);
  for (let i = 0; i < 3; i++) {
    g.target = g.angle + Math.PI;
    g.down();
  }
  assert.equal(g.phase, "over");
  // A finished run is recorded once the menu-gesture window has passed (game-kit.js SETTLE).
  assert.deepEqual(c.records, []);
  ticks(g, 2.9);
  assert.deepEqual(c.records, [1]);
});
// Moonrunner (rebuilt as a downhill run) has its own tests in tests/runner.test.mjs.
test("flight thrust and release move in opposite directions", () => {
  const g = new Undertow(context());
  g.down();
  ticks(g, 0.3);
  assert.ok(g.vy < 0);
  g.up();
  ticks(g, 0.7);
  assert.ok(g.vy > 0);
});
test("echo playback reaches input and accepts the short-long sequence", () => {
  const g = new EchoVault(context());
  g.down();
  ticks(g, 2.3);
  assert.equal(g.phase, "listen");
  g.down();
  g.up({ durationMs: 100 });
  g.down();
  g.up({ durationMs: 500 });
  assert.equal(g.round, 1);
  ticks(g, 1.2);
  assert.equal(g.phase, "show");
  assert.equal(g.sequence.length, 3);
});
test("reaction ignores stale cues, measures node time, cancels on pause", () => {
  const c = context(),
    g = new LightTrial(c);
  g.down({});
  g.event({ type: "cue", trial: g.trial + 1, at_us: 1000 });
  assert.equal(g.phase, "wait");
  g.event({ type: "cue", trial: g.trial, at_us: 1000000 });
  g.down({ source: "node", at_us: 1234000 });
  assert.equal(g.last, 234);
  ticks(g, 0.5); // the result is held back until no menu gesture could still include this press
  assert.equal(c.records[0], 766);
  g.down({});
  g.pause();
  assert.equal(g.phase, "title");
});
test("glyph puzzle progresses only on correct selections", () => {
  const g = new GlyphVault(context());
  g.down();
  ticks(g, 4);
  assert.equal(g.phase, "choose");
  for (const id of g.sequence) {
    g.focus = id;
    g.down();
  }
  assert.equal(g.round, 1);
  assert.equal(g.points, 100);
});
test("all Morse symbols roundtrip and the learning app accepts E", () => {
  for (const [letter, code] of Object.entries(MORSE))
    assert.equal(decodeMorse(code), letter);
  assert.equal(decodeMorse("......."), "?");
  const g = new MorseSchool(context());
  g.down();
  g.up({ durationMs: 100 });
  ticks(g, 0.7);
  assert.equal(g.correct, 1);
  // One correct answer does not move the lesson on; the same letter must be repeated.
  ticks(g, 1.4);
  assert.equal(g.target, "E");
  g.down();
  g.up({ durationMs: 100 });
  ticks(g, 0.7);
  ticks(g, 1.4);
  assert.equal(g.target, "T");
});

// 0.2 regressions: exercise state transitions, not implementation-shaped snapshots.
import { LightDirector } from '../web/engine/lights.js';
import { migrateLearning, reviewLetter } from '../web/apps/morse.js';
import { nextGate } from '../web/apps/undertow.js';
import { reactionSummary } from '../web/apps/reaction.js';
import { Timers, Transcription, sensorStatus } from '../web/apps/utilities.js';
import { CARTRIDGES } from '../web/apps/catalog.js';

function rapid(h, count, duration = 60, gap = 55, source = 'node', generation = 1) {
  for (let i=0; i<count; i++) {
    h.router.down({ source, generation }); h.advance(duration); h.router.up({ source, generation }); h.advance(gap);
  }
}
// Tap, tap, then a third press held for `hold` ms (to completion of the gesture when long enough).
function gesture(h, hold = 1700, tap = 60, gap = 55, source = 'node', generation = 1) {
  rapid(h, 2, tap, gap, source, generation);
  h.router.down({ source, generation }); h.advance(hold); h.router.up({ source, generation });
}
function rapidHarness(pace = 'standard') {
  const h = harness(); h.host.mode = 'raw';
  h.host.escapePolicy = () => ({ pace });
  return h;
}
test('tap, tap, hold delivers raw downs immediately and consumes only the terminal release', () => {
  const h = rapidHarness(); gesture(h);
  assert.equal(h.events.filter(e => Array.isArray(e) && e[0] === 'down').length, 3, 'all three presses reached the game at once');
  assert.equal(h.events.filter(e => Array.isArray(e) && e[0] === 'up').length, 2, 'only the two taps released into the game');
  assert.equal(h.events.filter(e => e === 'menu').length, 1);
  assert.equal(h.events.at(-1), 'menu');
});
test('four quick clicks, a plain long hold and three taps then a hold are not the menu gesture in a game', () => {
  const four = rapidHarness(); rapid(four, 4); assert.ok(!four.events.includes('menu'));
  const hold = rapidHarness(); hold.router.down(); hold.advance(3001); hold.router.up(); assert.ok(!hold.events.includes('menu'), 'a game has no plain-hold escape');
  const three = rapidHarness(); rapid(three, 3); three.router.down(); three.advance(1500); three.router.up(); assert.ok(!three.events.includes('menu'));
  const one = rapidHarness(); rapid(one, 1); one.router.down(); one.advance(1500); one.router.up(); assert.ok(!one.events.includes('menu'));
});
test('sustained gameplay holds remain ordinary holds in click profile', () => {
  const h = rapidHarness(); h.router.down(); h.advance(6500); h.router.up();
  assert.ok(!h.events.includes('menu')); assert.equal(h.events[1][1].durationMs, 6500);
});
test('partial, overlong, mixed-source, repeated-key and expired gestures do not escape', () => {
  for (const scenario of ['gap','tap','source','generation','epoch','short']) {
    const h = rapidHarness(); rapid(h, 1);
    if (scenario === 'gap') h.advance(300);
    if (scenario === 'tap') rapid(h, 1, 300);
    else rapid(h, 1);
    if (scenario === 'epoch') h.host.epoch++;
    const hold = scenario === 'short' ? 600 : 1500;
    h.router.down({ source: scenario === 'source' ? 'keyboard' : 'node', generation: scenario === 'generation' ? 2 : 1 });
    h.advance(hold);
    h.router.up({ source: scenario === 'source' ? 'keyboard' : 'node', generation: scenario === 'generation' ? 2 : 1 });
    assert.ok(!h.events.includes('menu'), scenario);
  }
  const h = rapidHarness();
  for(let i=0;i<5;i++) h.router.down({repeat:true});
  assert.equal(h.events.length,0);
});
test('node timestamps determine timing even if packets arrive together', () => {
  const h = rapidHarness();
  const press = (at, ms) => { h.router.down({source:'node',at_us:at*1000,generation:1}); h.router.up({source:'node',at_us:(at+ms)*1000,generation:1}); };
  for(let i=0;i<3;i++) press(i*1000, 60);
  h.advance(1500);
  assert.ok(!h.events.includes('menu'), 'one-second real gaps are not a gesture');
  h.router.cancel();
  // Two taps 130 ms apart on the node's clock arrive in one burst, then the third press is held for real.
  press(10000, 60); press(10130, 60);
  h.router.down({source:'node',at_us:10260*1000,generation:1}); h.advance(1700);
  assert.ok(h.events.includes('menu'));
});
test('reconnect reconciles an already released button without swallowing a fresh press', () => {
  const h = harness(); h.router.cancel(true, 'node'); h.router.reconcile(false, 'node');
  h.router.down({source:'node'}); h.advance(60); h.router.up({source:'node'});
  assert.deepEqual(h.events,['advance']);
  h.router.cancel(true,'node'); h.router.reconcile(true,'node');
  h.router.up({source:'keyboard'}); assert.equal(h.router.blocked,true);
  h.router.up({source:'node'}); assert.equal(h.router.blocked,false);
});
test('cancelling a partial gesture removes it from the resumed scene', () => {
  const h=rapidHarness(); rapid(h,2);h.router.cancel();h.router.down();h.advance(1500);h.router.up();
  assert.ok(!h.events.includes('menu'));
});
test('light effect release writes off even when the previous ordinary value was off', async () => {
  let physical=Array(9).fill(0), now=0;
  const l=new LightDirector(async(name,data)=>{ if(name==='leds')physical=data.values; if(name==='pattern')physical=Array(9).fill(99); },()=>now);
  await l.flush();await l.effect('pattern',{});assert.equal(physical[0],99);
  await l.release();assert.deepEqual(physical,Array(9).fill(0));
  physical=Array(9).fill(50);l.observe(physical);now=100;await l.flush();assert.equal(physical[0],0);
});
// The service applies a command when it receives it; only the reply is late. Later writes go out in order.
test('late light ACK cannot overwrite a new generation cache or final output', async () => {
  let resolve, physical=[], delayed=true;
  const l=new LightDirector(async(name,data)=>{
    if(name==='leds') {physical=data.values;if(delayed){delayed=false;await new Promise(r=>resolve=r);}}
  });
  l.set(Array(9).fill(80));const pending=l.flush();await Promise.resolve();await Promise.resolve();
  const release=l.release();resolve();await pending;await release;
  assert.deepEqual(physical,Array(9).fill(0));assert.equal(l.sent,Array(12).fill(0).join(','));
});
test('Morse migrates history and saves each accepted learning outcome before exit', () => {
  const c=context();let saved;c.progress=()=>({index:0,correct:7,attempts:10});c.saveProgress=v=>{saved=structuredClone(v);};
  const g=new MorseSchool(c);g.down();g.up({durationMs:80});ticks(g,.7);
  assert.equal(saved.schema,2);assert.equal(saved.correct,8);assert.equal(saved.characters.E.seen,1);
  assert.equal(migrateLearning({index:8}).index,8);
});
test('listening mode demonstrates, offers replay, and accepts a scanned answer', () => {
  const g=new MorseSchool(context());g.start('listen');assert.equal(g.phase,'signal');ticks(g,1.2);
  assert.equal(g.phase,'choose');assert.ok(g.choices.includes('REPLAY'));
  g.focus=g.choices.indexOf(g.target);g.down();g.up({durationMs:80});assert.equal(g.sessionCorrect,1);
});
test('adaptive review prioritizes a due weak character and completes bounded sessions', () => {
  const p=migrateLearning({characters:{E:{seen:4,correct:4,streak:4,due:32},T:{seen:3,correct:0,streak:0,due:2}}});
  assert.equal(reviewLetter(p),'T');const c=context();c.progress=()=>p;
  const g=new MorseSchool(c);g.start('review');assert.equal(g.target,'T');
  for(let i=0;i<10;i++){g.answer(g.target);ticks(g,1.3);}
  assert.equal(g.summary,true);assert.equal(g.sessionAttempts,10);
});
test('flight gate changes are bounded and a fixed-step pilot can traverse seeded layouts', () => {
  const rng=new Random(91);let center=270;
  for(let i=0;i<1000;i++){const gate=nextGate(center,i,rng);assert.ok(Math.abs(gate.center-center)<=85.001);assert.ok(gate.gap>=100);center=gate.center;}
  const g=new Undertow(context());g.down();
  for(let i=0;i<120*60&&g.phase==='play';i++){
    const target=g.gates.find(gate=>gate.x+65>202)?.center||270;
    // Aim with braking distance, retaining the same binary acceleration controls.
    g.held=g.y+g.vy*.42>target;
    g.update(1/60);
  }
  assert.equal(g.phase,'play');assert.ok(g.points>35);
});
test('reaction classes stay separate and a reboot invalidates a pending trial', () => {
  const c=context(),g=new LightTrial(c),scores=[];c.score=(n,metric)=>scores.push({n,metric});
  g.down({});g.event({type:'cue',trial:g.trial,at_us:1e6,generation:2});g.down({source:'node',at_us:1.25e6,generation:2});
  assert.equal(scores[0].metric,'physical');assert.equal(g.buckets.simulator.length,0);
  g.down({});g.event({type:'cue',trial:g.trial,at_us:2e6,generation:2});g.down({source:'node',at_us:1e4,generation:3});
  assert.equal(g.phase,'title');assert.equal(scores.length,1);
  assert.deepEqual(reactionSummary([200,400,300,100]),{count:4,mean:250,median:250,best:100});
});
test('Morse and Echo are not special in the catalog any more, and repeated taps still work', () => {
  for(const id of ['morse','echo'])assert.equal(CARTRIDGES.find(a=>a.id===id).escape,undefined,'the per-app escape policy is gone');
  const g=new EchoVault(context());g.phase='listen';g.sequence=[0,0,0,0];
  for(let i=0;i<4;i++){g.down();g.up({durationMs:60});}assert.equal(g.round,1);
});
test('sensor age and disconnect cannot present an old value as live', () => {
  const s={sensor:{at:100},device:{connected:true},simulated:false};
  assert.match(sensorStatus(s,110),/^LIVE/);assert.match(sensorStatus(s,120),/^STALE/);
  s.device.connected=false;assert.match(sensorStatus(s,102),/^STALE/);
});

import { microphoneStatus } from '../web/engine/status.js';
test('microphone status never equates a requested mute with confirmed acquisition off', () => {
  assert.equal(microphoneStatus({mic:{mode:'off',error:'mute failed'},device:{connected:true,capture:true}}).label,'CAPTURE STOPPING');
  assert.equal(microphoneStatus({mic:{mode:'transcribe'},device:{connected:false,capture:true}}).label,'MIC UNKNOWN / LINK LOST');
  assert.equal(microphoneStatus({mic:{mode:'off'},device:{connected:true,capture:false}}).label,'MIC OFF');
  assert.equal(microphoneStatus({mic:{mode:'commands'},device:{connected:true,capture:false}}).label,'MIC WAITING');
});

test('ordinary scene cancellation preserves an outstanding release requirement', () => {
  const h=harness();h.router.cancel(true,'node');h.router.cancel();
  assert.equal(h.router.blocked,true);h.router.up({source:'node'});assert.equal(h.router.blocked,false);
});
