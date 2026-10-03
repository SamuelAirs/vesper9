import test from 'node:test';
import assert from 'node:assert/strict';
import { Crawlspace } from '../web/apps/crawlspace.js';
import { Supper } from '../web/apps/supper.js';
import { NightGrid } from '../web/apps/nightgrid.js';
import { PocketLinks } from '../web/apps/pocketlinks.js';
import { appContext, run } from './helpers/app-context.mjs';

for (const Game of [Crawlspace, Supper, NightGrid]) test(`${Game.name}: case reverses choices safely; board shows ready release`, () => {
  const ctx = appContext({ lampCount: 4, boardLed: true, settings: { tapMode: 'generic' }, progress: { schema: 1, guided: true } });
  const app = new Game(ctx); app.start(); run(app, 1);
  const saves = ctx.calls.saved.length;
  assert.equal(app.cursor, 0);
  app.knock({ side: 'right' }); assert.equal(app.cursor, 2, 'generic treats every physical location equally');
  assert.equal(ctx.calls.saved.length, saves, 'highlight movement never purchases, attacks or commits');
  ctx.settings().tapMode = 'sides'; app.knock({ side: 'right' }); assert.equal(app.cursor, 0);
  app.down(); run(app, 0.7); app.knock({ side: 'left' });
  assert.equal(app.cursor, 0, 'a held choice cannot change under the player');
  assert.deepEqual(ctx.calls.board.at(-1), [12, 55, 22]);
  assert.equal(ctx.calls.leds.at(-1).length, 12);
  app.cancel(); app.pause(); assert.deepEqual(ctx.calls.board.at(-1), [0, 0, 0]);
});

test('Pocket Links: a case tap changes club only before aim is locked', () => {
  const ctx = appContext({ lampCount: 4, boardLed: true, progress: { schema: 1, guided: true } });
  const app = new PocketLinks(ctx); app.start();
  const club = app.club; assert.equal(app.knock(), true); assert.equal(app.club, 1 - club);
  app.down(); const aim = app.lockedAim, before = app.club;
  assert.equal(app.knock(), false); assert.equal(app.club, before); assert.equal(app.lockedAim, aim);
  app.cancel(); app.pause(); assert.deepEqual(ctx.calls.board.at(-1), [0, 0, 0]);
});
