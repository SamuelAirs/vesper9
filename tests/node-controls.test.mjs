import test from 'node:test';
import assert from 'node:assert/strict';
import { InputRouter, AppGuard, GESTURE_PACES } from '../web/engine/input.js';
import { OrbitLock } from '../web/apps/orbit.js';
import { Diagnostics } from '../web/apps/utilities.js';
import { appContext } from './helpers/app-context.mjs';

// Node stamps can cover seconds while the browser receives every edge in one task.
// Verify actual game state and persisted effects, not just that the menu appeared.
for (const pace of Object.keys(GESTURE_PACES)) for (const kind of ['orbit', 'appguard']) {
  test(`${pace}: ${kind} restores a menu gesture delivered in one USB burst`, () => {
    let confirmed = false, menus = 0;
    const ctx = appContext({ settings: { gesturePace: pace } });
    ctx.cancelGesture = () => confirmed;
    let app;
    if (kind === 'orbit') {
      app = new OrbitLock(ctx); app.begin();
      Object.assign(app, { points: 5, angle: 0, target: Math.PI, lives: 3, shield: 0 });
    } else {
      app = { value: 0 }; app.guard = new AppGuard(app, ctx);
      app.down = () => { app.guard.mark(); app.value++; ctx.score(app.value); ctx.saveProgress({ value: app.value }); };
      app.up = () => app.guard.release(); app.cancel = () => app.guard.rewind(); app.pause = () => app.guard.settle();
    }
    const before = kind === 'orbit' ? [app.phase, app.points, app.lives, app.angle, app.target] : [app.value];
    const host = {
      epoch: 0, inputMode: () => 'raw', holdMs: () => 650, escapePolicy: () => ({ pace }),
      pressVisual() {}, clickVisual() {}, holdVisual() {},
      rawDown: e => app.down(e), rawUp: e => app.up(e), rawCancel: () => app.cancel(),
      requestMenu(via) {
        confirmed = via === 'gesture';
        try { router.cancel(); app.cancel(); app.pause(); menus++; } finally { confirmed = false; }
      },
    };
    const router = new InputRouter(host, () => 0);
    for (const [pressed, ms] of [[true, 0], [false, 50], [true, 100], [false, 150], [true, 200], [false, 2400]]) {
      router[pressed ? 'down' : 'up']({ source: 'node', generation: 4, at_us: ms * 1000 });
    }
    assert.equal(menus, 1);
    assert.deepEqual(kind === 'orbit' ? [app.phase, app.points, app.lives, app.angle, app.target] : [app.value], before);
    assert.deepEqual(ctx.calls.score, kind === 'orbit' ? [[5, 'default']] : [], 'only the pre-gesture high-water score may persist');
    assert.deepEqual(ctx.calls.saved, [], 'gesture-caused death never records a run');
  });
}

test('generic navigation steps back immediately, ignores ringing, and never joins node generations', () => {
  let now = 1000, index = 3, back = 0;
  const host = { epoch: 0, inputMode: () => 'menu', escapePolicy: () => ({ tapMode: 'generic' }),
    advance: step => index += step, back: () => back++ };
  const r = new InputRouter(host, () => now);
  const knock = (generation = 1, side = 'right') => r.knock({ source: 'node', generation, side, at_us: now * 1000 });
  assert.equal(knock(), true); assert.equal(index, 2, 'generic ignores a stale direction');
  now += 50; assert.equal(knock(), false); assert.equal(index, 2);
  now += 200; knock(2); assert.equal(back, 0, 'reconnect is not a second tap'); assert.equal(index, 1);
  now += 250; knock(2); assert.equal(back, 1); assert.equal(index, 1, 'second tap backs out instead of stepping');
});

test('ordinary cancel cannot use confirmed-gesture rollback', () => {
  const ctx = appContext(), app = { value: 0 }; const guard = new AppGuard(app, ctx);
  for (let n = 0; n < 3; n++) { guard.mark(); app.value++; if (n < 2) guard.release(); }
  assert.equal(guard.rewind(), false); assert.equal(app.value, 3);
});

test('Node Scope addresses lamp four and the board LED independently and clears both', () => {
  const ctx = appContext({ lampCount: 4, boardLed: true }), scope = new Diagnostics(ctx);
  const choose = id => ctx.currentActions.find(item => item.id === id).run();
  for (let n = 0; n < 3; n++) choose('select-light');
  choose('test-colour');
  assert.deepEqual(ctx.calls.leds.at(-1), [0, 0, 0, 0, 0, 0, 0, 0, 0, 180, 0, 0]);
  assert.deepEqual(ctx.calls.board.at(-1), [0, 0, 0]);
  choose('select-light'); choose('test-colour');
  assert.deepEqual(ctx.calls.leds.at(-1), Array(12).fill(0));
  assert.deepEqual(ctx.calls.board.at(-1), [0, 180, 0]);
  choose('lights-off'); assert.ok(ctx.calls.leds.at(-1).every(v => v === 0));
  assert.deepEqual(ctx.calls.board.at(-1), [0, 0, 0]); scope.dispose();
});
