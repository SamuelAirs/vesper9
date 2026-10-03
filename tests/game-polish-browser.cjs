/* Ricochet practice and HighBar guides/line setup through real host controls at1024x600.
   Seeded private career/score; normal keyboard/simulator inputs only. No Pi,
   physical-control qualification, or claims of human game balancing. */
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..'), python = process.env.PYTHON || 'python3';
const output = path.resolve(process.env.TEST_OUTPUT || path.join(root, 'test-output/game-polish'));
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'vesper-game-polish-'));
fs.mkdirSync(output, { recursive: true });
execFileSync(python, ['-c', `from vesper.storage import Store
import sys
s=Store(sys.argv[1]); s.put('progress',{'ricochet':{'schema':3,'runs':4,'milestone':9,'st':{'far':9,'cells':150,'chambers':8}},'highbar':{'schema':2,'slot':0,'slots':[{'park':2,'mode':1,'line':1,'guided':False,'goals':[[0,1,2],[0,1,2],[],[]]}]}});s.score('ricochet',5000);s.close()`, data], { cwd: root, windowsHide: true });
const port = require('./free-port.cjs')(), origin = 'http://127.0.0.1:' + port;
const server = spawn(python, ['-m', 'vesper.server', '--simulate', '--http-port', String(port), '--data', data], { cwd: root, windowsHide: true });
let logs = '', browser; server.stdout.on('data', d => { logs += d; }); server.stderr.on('data', d => { logs += d; });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const results = [], check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + ' :: ' + JSON.stringify(detail)); };
(async () => {
  for (let n = 0; ; n++) { try { if ((await fetch(origin + '/api/state')).ok) break; } catch {}
    if (n >= 100 || server.exitCode !== null) throw Error('Owned simulator failed to start: ' + logs); await sleep(100); }
  browser = await chromium.launch({ headless: true, executablePath: process.env.TEST_BROWSER_BIN || undefined,
    args: ['--no-sandbox', '--mute-audio', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1024, height: 600 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin); await page.waitForFunction(() => window.vesper?.loaded);
  const shot = name => page.screenshot({ path: path.join(output, name + '.png') });
  const drainSaves = () => page.waitForFunction(() => !vesper.saves.status().pending);
  const button = async (ms = 60) => { await page.keyboard.down('Space'); await page.waitForFunction(() => !!vesper.input.press);
    await page.waitForTimeout(ms); await page.keyboard.up('Space'); await page.waitForFunction(() => !vesper.input.press); };
  const openPractice = async () => { await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'RICOCHET / PRACTICE CHAMBERS', exact: true }).click();
    await page.waitForFunction(() => !vesper.menu && vesper.app.phase === 'practice'); };
  const snapshot = () => page.evaluate(() => ({ phase: vesper.app.phase, cursor: vesper.app.practiceCursor,
    limit: vesper.app.practiceLimit(), chamber: vesper.app.chamber, training: vesper.app.training,
    pressing: vesper.app.pressing, score: vesper.app.score, lives: vesper.app.lives, mods: vesper.app.mods }));
  await page.evaluate(() => vesper.launch('ricochet')); await page.waitForFunction(() => vesper.meta?.id === 'ricochet');
  const career = await page.evaluate(() => JSON.stringify(vesper.state.progress.ricochet));
  await shot('ricochet-title'); await openPractice(); const initial = await snapshot();
  check('existing career opens practice at the furthest reached chamber', initial.cursor === 9 && initial.limit === 9, initial);
  await shot('ricochet-practice-selector');
  await button(); check('a short button release reaches return to title after chamber9', (await snapshot()).cursor === 0, await snapshot());
  await page.waitForTimeout(450); await page.keyboard.press('KeyK');
  await page.waitForFunction(() => vesper.app.practiceCursor === 9);
  check('generic case reverse returns to chamber9', (await snapshot()).cursor === 9, await snapshot());
  const gesture = await page.evaluate(async () => {
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const key = type => document.dispatchEvent(new KeyboardEvent(type, { code: 'Space', key: ' ', bubbles: true }));
    for (let n = 0; n < 2; n++) { key('keydown'); await pause(60); key('keyup'); await pause(60); }
    key('keydown'); const until = performance.now() + 3200;
    while (!vesper.menu && performance.now() < until) await pause(20);
    key('keyup'); await pause(150);
    return { menu: !!vesper.menu, cursor: vesper.app.practiceCursor, phase: vesper.app.phase, press: !!vesper.input.press, pressing: vesper.app.pressing };
  });
  check('selector menu gesture restores the chosen chamber and consumes release', gesture.menu && gesture.cursor === 9 &&
    gesture.phase === 'practice' && !gesture.press && !gesture.pressing, gesture);
  await page.keyboard.press('Escape'); await button(800); const play = await snapshot();
  check('hold release starts actual late-chamber practice with baseline upgrades', play.phase === 'play' && play.training &&
    play.chamber === 9 && Object.values(play.mods).every(value => value === 0), play);
  await page.waitForTimeout(2500); await shot('ricochet-chamber9-practice');
  await button(); await page.waitForTimeout(500); await page.keyboard.press('KeyK'); await page.waitForTimeout(600);
  const motion = await page.evaluate(() => ({ phase: vesper.app.phase, sub: vesper.app.sub, clock: vesper.app.clock,
    balls: vesper.app.balls.map(ball => ({ x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy })), frameStats: vesper.frameStats() }));
  check('late practice advances through actual collision and render frames', motion.clock > 2 && motion.balls.length > 0 &&
    motion.balls.every(ball => Object.values(ball).every(Number.isFinite)), motion);
  await openPractice(); check('revisiting the selector keeps reached-room access', (await snapshot()).cursor === 9, await snapshot());
  await button(); await button(800); check('selector return works with button alone', (await snapshot()).phase === 'title', await snapshot());
  await page.evaluate(() => vesper.home()); await drainSaves(); const stored = await fetch(origin + '/api/state').then(response => response.json());
  check('practice leaves the existing career and best score unchanged', JSON.stringify(stored.progress.ricochet) === career &&
    stored.scores.ricochet === 5000, { progress: stored.progress.ricochet, best: stored.scores.ricochet });
  await drainSaves(); await page.reload(); await page.waitForFunction(() => window.vesper?.loaded); await page.evaluate(() => vesper.launch('ricochet'));
  await openPractice(); check('reload preserves all reached chambers', (await snapshot()).cursor === 9 && (await snapshot()).limit === 9, await snapshot());
  await shot('ricochet-selector-after-reload'); await button(); await button(800); await button();
  const ordinary = await snapshot(); check('ordinary play still starts an ordinary chamber1 run', ordinary.phase === 'play' &&
    ordinary.chamber === 1 && !ordinary.training, ordinary);
  await page.keyboard.press('Escape');
  const dims = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }));
  check('console and practice screenshots fit1024x600', dims.width <= 1024 && dims.height <= 600, dims);
  await page.evaluate(() => { vesper.home(); vesper.launch('highbar'); }); await button();
  check('HighBar first ride presents its guide', await page.evaluate(() => vesper.app.phase === 'guide' && vesper.app.guide === 0));
  for (let n = 0; n < 6; n++) {
    await shot('highbar-guide-' + (n + 1)); await button(); await page.waitForTimeout(340);
  }
  check('six guide pages lead into the selected Tower line', await page.evaluate(() => vesper.app.phase === 'play' &&
    vesper.app.parkId === 2 && vesper.app.mode === 1 && vesper.app.slot().guided && vesper.app.lineSeconds() === 75));
  await shot('highbar-line-coach');
  const action = async label => { await page.keyboard.press('Escape');
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.waitForFunction(() => !vesper.menu); };
  await action('GAME GUIDE'); const guided = await page.evaluate(() => vesper.app.phase === 'guide');
  await button(800); check('HighBar custom guide closes the console and returns to the run', guided &&
    await page.evaluate(() => !vesper.menu && vesper.app.phase === 'play'));
  await action('RESTART SESSION'); check('HighBar custom restart closes the console and resets its75second line',
    await page.evaluate(() => vesper.app.phase === 'play' && vesper.app.clock > 74 && vesper.app.clock <= 75));
  await action('END SESSION'); check('HighBar custom end closes the console onto its result',
    await page.evaluate(() => vesper.app.phase === 'over' && !vesper.menu));
  await page.waitForTimeout(900); await button(800);
  const pickSetup = async id => { const at = await page.evaluate(id => vesper.app.setupItems().findIndex(item => item.id === id), id);
    for (let n = 0; await page.evaluate(() => vesper.app.cursor) !== at; n++) {
      if (n > 12) throw Error('Cannot reach HighBar setup choice: ' + id); await button(); await page.waitForTimeout(340); }
    await button(800); };
  const setup = await page.evaluate(() => vesper.app.setupItems().find(item => item.id === 'line').label);
  check('HighBar setup shows the actual Tower line duration', setup.includes('TOP STYLE') && setup.includes('(75s)'), setup);
  await shot('highbar-tower-setup'); await pickSetup('mode'); await pickSetup('ride');
  const practice = await page.evaluate(() => vesper.app.phase === 'play' && vesper.app.mode === 2);
  await action('LEAVE PRACTICE'); check('HighBar practice starts and leaves through its closing custom action', practice &&
    await page.evaluate(() => vesper.app.phase === 'over' && !vesper.menu));
  await page.evaluate(() => vesper.home()); await drainSaves(); const state = await fetch(origin + '/api/state').then(response => response.json());
  check('journey ends muted', state.mic.mode === 'off' && !state.device.capture, { mode: state.mic.mode, capture: state.device.capture });
  check('no page or host faults', !errors.length && !(await page.evaluate(() => vesper.errors.length)), { errors });
})().catch(error => { check('practice workflow completed', false, String(error.stack || error)); console.error(logs.slice(-1500)); })
  .finally(async () => { await browser?.close().catch(() => {}); await require('./browser-cleanup.cjs')(server, data);
    fs.writeFileSync(path.join(output, 'game-polish-browser.json'), JSON.stringify({ evidence: 'Windows browser; synthetic controls; seeded private career; no physical acceptance', results }, null, 2) + '\n');
    if (results.some(result => !result.ok)) process.exitCode = 1; });
