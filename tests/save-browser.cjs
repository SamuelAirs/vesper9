/* Real Windows/Linux service + browser persistence across a disconnected tab.
   Isolated simulator data only; no hardware or personal saves. */
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..'), port = require('./free-port.cjs')();
const origin = 'http://127.0.0.1:' + port;
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'vesper-save-'));
const output = process.env.TEST_OUTPUT || path.join(root, 'test-output');
fs.mkdirSync(output, { recursive: true });
const python = process.env.PYTHON || 'python3';
const initialCareer = { schema: 2, slot: 1, slots: [{ runs: 11 }, { runs: 22 }, { runs: 33 }] };
execFileSync(python, ['-c', 'import json,sys; from vesper.storage import Store; s=Store(sys.argv[1]); s.put("progress",{"highbar":json.loads(sys.argv[2])}); s.close()',
  data, JSON.stringify(initialCareer)], { cwd: root, windowsHide: true });
const server = spawn(python, ['-m', 'vesper.server', '--simulate', '--http-port', String(port), '--data', data], { cwd: root });
let logs = '', browser;
server.stdout.on('data', d => logs += d); server.stderr.on('data', d => logs += d);
const pause = ms => new Promise(r => setTimeout(r, ms));
const checks = [];
const check = (name, detail) => { checks.push({ name, detail }); console.log('PASS ' + name + ' :: ' + JSON.stringify(detail)); };
(async () => {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(origin + '/api/state')).ok) break; } catch {}
    if (i === 99) throw Error('Service did not start');
    await pause(100);
  }
  browser = await chromium.launch({ headless: true, executablePath: process.env.TEST_BROWSER_BIN || undefined,
    args: ['--no-sandbox', '--disable-gpu', '--mute-audio'] });
  // Before the first state, the browser does not yet know its controller role
  // or the owner's existing saves. Holding just this frame models a slow first
  // connection while leaving the real service/WS and keyboard input running.
  const initialPage = await browser.newPage();
  let firstState = null, initialRoute = null;
  await initialPage.routeWebSocket('**/ws', route => {
    const upstream = route.connectToServer();
    upstream.onMessage(message => {
      let event; try { event = JSON.parse(message.toString()); } catch {}
      if (event?.type === 'state' && !initialRoute) { firstState = message; initialRoute = route; }
      else route.send(message);
    });
  });
  await initialPage.goto(origin); await initialPage.waitForFunction(() => window.vesper && vesper.bridge.connected);
  await initialPage.evaluate(() => vesper.launch('highbar'));
  for (let n = 0; n < 7; n++) {
    await initialPage.keyboard.down('Space'); await pause(60); await initialPage.keyboard.up('Space'); await pause(300);
  }
  const early = await initialPage.evaluate(async () => {
    await vesper.persist('progress', { app: 'highbar', value: { marker: 'initial-state-must-not-write' } });
    return { loaded: vesper.loaded, app: vesper.meta?.id || null, pending: vesper.saves.status().pending };
  });
  assert.equal(early.loaded, false); assert.equal(early.app, null); assert.equal(early.pending, 0);
  initialRoute.send(firstState);
  await initialPage.waitForFunction(() => vesper.loaded && !vesper.saves.status().pending);
  // AppGuard-deferred saves were the original failure: an empty career could
  // arrive only after the first service state and then erase all three slots.
  await pause(1600); await initialPage.waitForFunction(() => !vesper.saves.status().pending);
  const initialStored = await fetch(origin + '/api/state').then(response => response.json());
  assert.deepEqual(initialStored.progress.highbar, initialCareer);
  check('slow initial state blocks launches and premature saves, preserving all existing private slots', early);
  await initialPage.close(); await pause(250);
  const page = await browser.newPage({ viewport: { width: 1024, height: 600 } }), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin); await page.waitForFunction(() => vesper.loaded && !vesper.saves.status().pending);
  await page.evaluate(async () => {
    const { APPS } = await import('/apps/registry.js');
    const meta = APPS.find(a => a.id === 'orbit'), create = meta.create;
    meta.create = ctx => { window.saveCtx = ctx; return create(ctx); };
    vesper.launch('orbit'); meta.create = create;
    const pause = vesper.app.pause.bind(vesper.app);
    vesper.app.pause = () => { pause(); saveCtx.saveProgress({ marker: 'saved-during-disconnect-pause' }); };
    vesper.bridge.closed = true; // Hold this outage until the test explicitly reconnects.
    vesper.bridge.ws.close();
  });
  await page.waitForFunction(() => !vesper.bridge.connected && vesper.menu && vesper.saves.status().pending > 0);
  const disconnected = await page.evaluate(async () => {
    const value = { marker: 'latest-offline', runs: 7 };
    await saveCtx.saveProgress({ marker: 'older-offline', runs: 6 });
    await saveCtx.saveProgress(value); value.runs = 999;
    saveCtx.score(812); saveCtx.score(300);
    return { pending: vesper.saves.status().pending, local: vesper.state.progress.orbit,
      localScore: vesper.state.scores.orbit, disk: (await vesper.bridge.get('state')).progress.orbit,
      notice: document.getElementById('save-status').hidden };
  });
  assert.equal(disconnected.local.runs, 7); assert.equal(disconnected.localScore, 812);
  assert.notEqual(disconnected.disk?.marker, 'latest-offline'); assert.equal(disconnected.notice, false);
  check('offline pause and subsequent saves are visibly pending immutable snapshots', disconnected);
  await page.screenshot({ path: path.join(output, 'saves-waiting.png') });

  // Another controlling tab must not receive/replay the waiting tab's commands.
  const controller = await browser.newPage();
  await controller.goto(origin); await controller.waitForFunction(() => vesper.loaded && vesper.state.controller === true && !vesper.saves.status().pending);
  await controller.evaluate(() => vesper.bridge.command('progress', { app: 'orbit', value: { marker: 'other-tab', runs: 77 } }));
  await page.evaluate(() => { vesper.bridge.closed = false; vesper.bridge.connect(); });
  await page.waitForFunction(() => vesper.bridge.connected && vesper.state.controller === false);
  const monitor = await page.evaluate(async () => {
    const before = vesper.saves.status().pending;
    await saveCtx.saveProgress({ marker: 'observer-must-not-save' });
    saveCtx.score(9000);
    return { before, after: vesper.saves.status().pending, local: vesper.state.progress.orbit,
      disk: (await vesper.bridge.get('state')).progress.orbit, ready: vesper.saves.status().ready };
  });
  assert.equal(monitor.ready, false); assert.equal(monitor.before, monitor.after);
  assert.equal(monitor.local.marker, 'latest-offline'); assert.notEqual(monitor.disk?.marker, 'latest-offline');
  check('reconnect as monitor preserves pending saves without writing or accepting observer changes', monitor);
  await controller.close(); await pause(250);
  await page.evaluate(() => vesper.saveMenu());
  await page.getByRole('button', { name: 'RECONNECT THIS TAB', exact: true }).click();
  await page.waitForFunction(() => vesper.bridge.connected && vesper.state.controller === true && vesper.saveConflict);
  const conflict = await page.evaluate(async () => ({ disk: (await vesper.bridge.get('state')).progress.orbit,
    pending: vesper.saves.status().pending, ready: vesper.saves.status().ready }));
  assert.equal(conflict.disk.runs, 77); assert.ok(conflict.pending > 0); assert.equal(conflict.ready, false);
  await page.evaluate(() => vesper.saveMenu());
  await page.getByRole('button', { name: "USE THIS TAB'S WAITING SAVES", exact: true }).click();
  assert.equal((await fetch(origin + '/api/state').then(r => r.json())).progress.orbit.runs, 77, 'opening confirmation must not replace anything');
  await page.screenshot({ path: path.join(output, 'save-conflict-confirmation.png') });
  await page.getByRole('button', { name: 'CONFIRM / USE WAITING SAVES', exact: true }).click();
  await page.waitForFunction(() => !vesper.saves.status().pending && !vesper.saveConflict);
  const recovered = await page.evaluate(async () => ({ state: await vesper.bridge.get('state'), local: vesper.state.progress.orbit,
    notice: document.getElementById('save-status').hidden }));
  assert.equal(recovered.state.progress.orbit.runs, 7); assert.equal(recovered.local.runs, 7);
  assert.equal(recovered.state.scores.orbit, 812); assert.equal(recovered.notice, true);
  check('ownership change holds both copies until explicit confirmation, then ACKs chosen waiting saves', { held: conflict.disk, progress: recovered.local, score: recovered.state.scores.orbit });

  await page.evaluate(() => { vesper.bridge.closed = true; vesper.bridge.ws.close(); });
  await page.waitForFunction(() => !vesper.bridge.connected);
  await page.evaluate(() => saveCtx.saveProgress({ marker: 'decline-this-copy', runs: 8 }));
  const secondController = await browser.newPage();
  await secondController.goto(origin); await secondController.waitForFunction(() => vesper.loaded && vesper.state.controller === true && !vesper.saves.status().pending);
  await secondController.evaluate(() => vesper.bridge.command('progress', { app: 'orbit', value: { marker: 'keep-service', runs: 88 } }));
  await page.evaluate(() => { vesper.bridge.closed = false; vesper.bridge.connect(); });
  await page.waitForFunction(() => vesper.state.controller === false && vesper.saveConflict);
  await secondController.close(); await pause(250);
  await page.evaluate(() => vesper.bridge.ws.close());
  await page.waitForFunction(() => vesper.bridge.connected && vesper.state.controller === true);
  await page.evaluate(() => vesper.saveMenu());
  await page.getByRole('button', { name: 'USE SERVICE SAVES', exact: true }).click();
  await page.getByRole('button', { name: 'CONFIRM / USE SERVICE SAVES', exact: true }).click();
  await page.waitForFunction(() => !vesper.app && !vesper.menu && !vesper.saveConflict && !vesper.saves.status().pending);
  const chosenService = await page.evaluate(async () => ({ local: vesper.state.progress.orbit,
    disk: (await vesper.bridge.get('state')).progress.orbit }));
  assert.equal(chosenService.local.runs, 88); assert.equal(chosenService.disk.runs, 88);
  check('choosing service saves discards only the waiting copy and unmount cannot recreate it', chosenService);

  // The other controller can come and go entirely during an outage, so this
  // browser never receives a monitor state. Compare save baselines as well.
  await page.evaluate(() => { vesper.bridge.closed = true; vesper.bridge.ws.close(); });
  await page.waitForFunction(() => !vesper.bridge.connected);
  await page.evaluate(() => vesper.persist('progress', { app: 'orbit', value: { runs: 9 } }));
  const briefController = await browser.newPage();
  await briefController.goto(origin); await briefController.waitForFunction(() => vesper.loaded && vesper.state.controller === true && !vesper.saves.status().pending);
  await briefController.evaluate(() => vesper.bridge.command('progress', { app: 'orbit', value: { marker: 'unseen-controller', runs: 99 } }));
  await briefController.close(); await pause(250);
  await page.evaluate(() => { vesper.bridge.closed = false; vesper.bridge.connect(); });
  await page.waitForFunction(() => vesper.bridge.connected && vesper.state.controller === true && vesper.saveConflict);
  const unseen = await page.evaluate(async () => ({ disk: (await vesper.bridge.get('state')).progress.orbit,
    pending: vesper.saves.status().pending, ready: vesper.saves.status().ready }));
  assert.equal(unseen.disk.runs, 99); assert.ok(unseen.pending); assert.equal(unseen.ready, false);
  await page.evaluate(() => vesper.saveMenu());
  await page.getByRole('button', { name: 'USE SERVICE SAVES', exact: true }).click();
  await page.getByRole('button', { name: 'CONFIRM / USE SERVICE SAVES', exact: true }).click();
  await page.waitForFunction(() => !vesper.saveConflict && !vesper.saves.status().pending);
  check('baseline comparison protects newer service progress even without a monitor transition', unseen);

  // An ordinary outage with no changed service copy still recovers unattended.
  await page.evaluate(() => { vesper.bridge.closed = true; vesper.bridge.ws.close(); });
  await page.waitForFunction(() => !vesper.bridge.connected);
  await page.evaluate(() => vesper.persist('progress', { app: 'orbit', value: { runs: 100 } }));
  await page.evaluate(() => { vesper.bridge.closed = false; vesper.bridge.connect(); });
  await page.waitForFunction(() => vesper.bridge.connected && vesper.state.controller === true && !vesper.saves.status().pending);
  assert.equal(await page.evaluate(() => !!vesper.saveConflict), false);
  const ordinary = await fetch(origin + '/api/state').then(r => r.json());
  assert.equal(ordinary.progress.orbit.runs, 100);
  check('unchanged service baseline permits automatic acknowledged recovery after a normal outage', ordinary.progress.orbit);

  // A retired context cannot put an old save back after clearing/replacing a slot.
  await page.evaluate(async () => {
    vesper.home();
    await vesper.persist('progress', { app: 'orbit', value: {} });
    await saveCtx.saveProgress({ marker: 'retired' }); saveCtx.score(9999);
  });
  await page.waitForFunction(() => !vesper.saves.status().pending);
  const cleared = await page.evaluate(() => vesper.bridge.get('state'));
  assert.deepEqual(cleared.progress.orbit, {}); assert.equal(cleared.scores.orbit, 812);
  await page.reload(); await page.waitForFunction(() => vesper.loaded && !vesper.saves.status().pending);
  assert.deepEqual(await page.evaluate(() => vesper.state.progress.orbit), {});
  check('clear persists across reload and retired app callbacks cannot restore the old save', { score: cleared.scores.orbit });

  await page.evaluate(() => vesper.persist('progress', { app: 'orbit', value: { oversized: 'x'.repeat(9000) } }));
  await page.waitForFunction(() => !!vesper.saves.status().error);
  const rejected = await page.evaluate(async () => ({ status: vesper.saves.status(),
    notice: document.getElementById('save-status').hidden, disk: (await vesper.bridge.get('state')).progress.orbit }));
  assert.match(rejected.status.error, /Invalid app progress/); assert.equal(rejected.notice, false);
  assert.deepEqual(rejected.disk, {});
  await page.evaluate(() => vesper.persist('progress', { app: 'orbit', value: {} }));
  await page.waitForFunction(() => !vesper.saves.status().pending && !vesper.saves.status().error);
  check('service rejection stays visible and a corrected save can replace it', { error: rejected.status.error, pending: rejected.status.pending });

  const durable = JSON.parse(execFileSync(python, ['-c',
    'import json,sys; from vesper.storage import Store; s=Store(sys.argv[1]); print(json.dumps({"progress":s.get("progress",{}).get("orbit"),"score":s.scores().get("orbit")})); s.close()', data], { cwd: root, encoding: 'utf8' }));
  assert.deepEqual(durable, { progress: {}, score: 812 }); assert.deepEqual(errors, []);
  check('separate SQLite connection confirms durable writes and no page errors', durable);
  fs.writeFileSync(path.join(output, 'save-results.json'), JSON.stringify({ passed: true, scope: 'Development-host service/browser; not Pi or physical input', checks, errors }, null, 2));
})().catch(e => { console.error(e); console.error(logs.slice(-1500)); process.exitCode = 1; })
  .finally(async () => { if (browser) await browser.close(); await require('./browser-cleanup.cjs')(server, data); });
