/* Whole utility journeys through one 1024x600 browser and private simulator data.
   Optional VESPER_ZIM points to a read-only existing archive: the test links/copies
   it into private data and never edits the source. Windows/Pi physical acceptance
   is not inferred. PYTHON/PLAYWRIGHT_PATH/TEST_BROWSER_BIN select local tools. */
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..'), python = process.env.PYTHON || 'python3';
const output = path.resolve(process.env.TEST_OUTPUT || path.join(root, 'test-output/utility-polish'));
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'vesper-utility-polish-'));
fs.mkdirSync(output, { recursive: true });
execFileSync(python, ['-c', `
import os,sys
from pathlib import Path
from vesper.library import book_id
from vesper.storage import Store
d=Path(sys.argv[1]); folder=d/'library'; folder.mkdir()
body=' '.join(['The quiet instrument keeps a place among the stars.']*8)
book=folder/'polish-journey.txt'
book.write_text('POLISH JOURNEY\\n\\nCHAPTER I\\n\\n'+'\\n\\n'.join([body]*32)+'\\n\\nCHAPTER II\\n\\n'+'\\n\\n'.join([body]*16),encoding='utf-8')
ident=book_id(book,book.stat()); store=Store(d)
store.put('progress',{'library':{'v':1,'last':ident,'size':1,'auto':0,'books':{ident:{'ch':1,'para':8,'char':0,'f':0.3,'at':1790000000}},'marks':[{'book':ident,'title':'POLISH JOURNEY','ch':1,'para':8,'char':0}]}})
store.close()
if len(sys.argv)>2 and sys.argv[2]:
 target=d/'encyclopedia'; target.mkdir(); destination=target/Path(sys.argv[2]).name
 try: os.link(sys.argv[2],destination)
 except OSError:
  import shutil
  shutil.copyfile(sys.argv[2],destination)
`, data, process.env.VESPER_ZIM || ''], { cwd: root, windowsHide: true });
const port = require('./free-port.cjs')(), origin = 'http://127.0.0.1:' + port;
const server = spawn(python, ['-m', 'vesper.server', '--simulate', '--http-port', String(port), '--data', data], { cwd: root, windowsHide: true });
let logs = '', browser;
server.stdout.on('data', d => { logs += d; }); server.stderr.on('data', d => { logs += d; });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const results = [], check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + ' :: ' + JSON.stringify(detail)); };
(async () => {
  for (let n = 0; ; n++) { try { if ((await fetch(origin + '/api/state')).ok) break; } catch {}
    if (n >= 120 || server.exitCode !== null) throw Error('Owned simulator failed to start: ' + logs); await sleep(100); }
  browser = await chromium.launch({ headless: true, executablePath: process.env.TEST_BROWSER_BIN || undefined,
    args: ['--no-sandbox', '--mute-audio', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1024, height: 600 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin); await page.waitForFunction(() => window.vesper?.loaded);
  const launch = id => page.evaluate(id => vesper.launch(id), id);
  const drainSaves = () => page.waitForFunction(() => !vesper.saves.status().pending);
  const button = async (ms = 60) => { await page.keyboard.down('Space'); await page.waitForFunction(() => !!vesper.input.press);
    await page.waitForTimeout(ms); await page.keyboard.up('Space'); await page.waitForFunction(() => !vesper.input.press); };
  const choose = async label => {
    const index = await page.evaluate(label => vesper.app.rows().findIndex(row => row.label.startsWith(label)), label);
    if (index < 0) throw Error('Reader choice missing: ' + label);
    for (let n = 0; await page.evaluate(() => vesper.app.cursor) !== index; n++) {
      if (n > 450) throw Error('Reader choice cannot be reached: ' + label); await button(); await page.waitForTimeout(340); }
    await button(800);
  };
  const shot = name => page.screenshot({ path: path.join(output, name + '.png') });
  const position = () => page.evaluate(() => ({ book: vesper.app.book, article: vesper.app.article?.path,
    pos: vesper.app.pos, page: vesper.app.page, phase: vesper.app.phase }));
  const loadedReader = () => page.waitForFunction(() => vesper.app.phase === 'read' && vesper.app.layoutReady());

  await launch('library'); await page.waitForFunction(() => vesper.app.data.service === 'ok');
  await button(800); await loadedReader();
  const oldPlace = await position();
  check('Stacks opens the existing book at its stored place', oldPlace.pos.ch === 1 && oldPlace.page > 0, oldPlace);
  await shot('stacks-existing-place');
  await button(); const afterNext = await position();
  await page.waitForTimeout(450); await page.keyboard.press('KeyK');
  await page.waitForFunction(pageNumber => vesper.app.page === pageNumber, oldPlace.page);
  check('Stacks button next and generic case previous preserve navigation', afterNext.page === oldPlace.page + 1 &&
    (await position()).page === oldPlace.page, { oldPlace, afterNext, returned: await position() });
  await button(800); await choose('BOOKMARKS'); await choose('POLISH JOURNEY'); await loadedReader();
  check('an existing Stacks bookmark returns to its saved page', (await position()).page === oldPlace.page, await position());
  await page.evaluate(() => vesper.home()); await drainSaves(); await page.reload(); await page.waitForFunction(() => vesper?.loaded);
  await launch('library'); await page.waitForFunction(() => vesper.app.data.service === 'ok'); await button(800); await loadedReader();
  check('Stacks place and bookmark survive host reload', (await position()).page === oldPlace.page &&
    await page.evaluate(() => vesper.app.save.marks.length === 1), await position());

  const book = oldPlace.book; let failedReads = 0;
  const failedRoute = '**/api/library/' + book + '/0';
  await page.route(failedRoute, route => { failedReads++; return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"fixture temporarily unavailable"}' }); });
  await button(800); await choose('CHAPTERS'); await choose('SECTION 1');
  await page.waitForFunction(book => vesper.app.data.failed.has(book + ':0'), book); await page.waitForTimeout(1200);
  check('Stacks failed chapter settles rather than flooding requests', failedReads === 1, { failedReads });
  await shot('stacks-load-error'); await button(); await page.waitForTimeout(350);
  check('one intentional Stacks retry makes one new request', failedReads === 2, { failedReads });
  await page.unroute(failedRoute); await button(); await loadedReader();
  check('Stacks recovers after the chapter service returns', (await position()).pos.ch === 0, await position());

  if (process.env.VESPER_ZIM) {
    await launch('encyclopedia'); await page.waitForFunction(() => vesper.app.ready(), null, { timeout: 45000 });
    const wikiStatus = await page.evaluate(() => vesper.app.data.status);
    check('real offline archive is loaded', wikiStatus.articles > 100000 && wikiStatus.bytes > 1000000000,
      { articles: wikiStatus.articles, bytes: wikiStatus.bytes, archive: wikiStatus.file });
    await page.evaluate(() => vesper.app.open('Clayton,_Illinois', 'Clayton, Illinois', { trail: false })); await loadedReader();
    const shortArticle = await page.evaluate(() => vesper.app.current());
    check('real short article excludes hidden categories and archive footer', !/Hidden category|Category:|This page is issued/.test(JSON.stringify(shortArticle.blocks)) &&
      /village/.test(JSON.stringify(shortArticle.blocks)), { blocks: shortArticle.blocks.length, pages: await page.evaluate(() => vesper.app.layout.pages.length) });
    await shot('encyclopedia-short-article');
    // Open a known article through the real reader and service, then use normal button menus.
    await page.evaluate(() => vesper.app.open('Sun', 'Sun', { trail: false })); await loadedReader();
    await button(); await button(); const sunPlace = await position(); await shot('encyclopedia-sun');
    await button(800); await choose('BOOKMARK THIS PAGE');
    await button(800); await choose('LINKS ON THIS PAGE'); await choose('star'); await loadedReader();
    check('real Wikipedia link opens Star and retains the Sun trail', (await position()).article === 'Star' &&
      await page.evaluate(() => vesper.app.trail.at(-1).path === 'Sun'), await position());
    await shot('encyclopedia-star'); await button(800); await choose('ENCYCLOPEDIA HOME');
    await choose('RECENTLY READ'); await choose('Sun'); await loadedReader();
    check('recent article returns to its own reading place', (await position()).page === sunPlace.page, { sunPlace, current: await position() });
    await page.evaluate(() => vesper.home()); await drainSaves(); await page.reload(); await page.waitForFunction(() => vesper?.loaded);
    await launch('encyclopedia'); await page.waitForFunction(() => vesper.app.ready()); await choose('CONTINUE'); await loadedReader();
    check('real article place and bookmark survive reload', (await position()).page === sunPlace.page &&
      await page.evaluate(() => vesper.app.save.marks.some(mark => mark.path === 'Sun')), await position());
    await button(800); await choose('ENCYCLOPEDIA HOME'); await choose('RANDOM ARTICLE'); await loadedReader();
    check('random real article returns readable text', await page.evaluate(() => vesper.app.current().blocks.length > 0), await position());
    await shot('encyclopedia-random');
  }

  // The missing/offline journey is injected; real-archive reading above is kept separate.
  await page.route('**/api/encyclopedia', route => route.fulfill({ contentType: 'application/json', body: '{"status":"missing","library":true}' }));
  await launch('encyclopedia'); await page.waitForFunction(() => vesper.app.data.status.status === 'missing');
  await choose('SETUP GUIDE'); check('missing archive has an actionable setup and exit journey', await page.evaluate(() =>
    vesper.app.phase === 'notice' && vesper.app.notice.title === 'OFFLINE ENCYCLOPEDIA'), await position());
  await shot('encyclopedia-missing-guide'); await button(); await choose('LEAVE THE ENCYCLOPEDIA');
  check('missing archive can be left with the button', await page.evaluate(() => !vesper.app), {});
  await page.unroute('**/api/encyclopedia');

  await launch('lantern'); await page.getByRole('button', { name: /^COLOUR \/ / }).click();
  await button(); const nextPreview = await page.evaluate(() => ({ index: vesper.nav.index, cursor: vesper.app.cursor, colour: vesper.app.preview?.colour }));
  await page.waitForTimeout(450); await page.keyboard.press('KeyK'); await page.waitForTimeout(150);
  const previousPreview = await page.evaluate(() => ({ index: vesper.nav.index, cursor: vesper.app.cursor, colour: vesper.app.preview?.colour }));
  await page.keyboard.press('ArrowRight'); const arrowPreview = await page.evaluate(() => ({ index: vesper.nav.index, cursor: vesper.app.cursor, colour: vesper.app.preview?.colour }));
  check('Lantern preview follows button, reverse case and keyboard highlight', nextPreview.index === nextPreview.cursor &&
    previousPreview.index === previousPreview.cursor && previousPreview.colour === previousPreview.index &&
    arrowPreview.index === arrowPreview.cursor && arrowPreview.colour === arrowPreview.index, { nextPreview, previousPreview, arrowPreview });
  await shot('lantern-colour-preview'); await button(800);
  check('Lantern keeps the shown colour through button selection', await page.evaluate(() => vesper.app.s.colour === 1 && !vesper.app.preview), {});
  await page.getByRole('button', { name: /SLEEP IN 30 MIN/ }).click();
  check('Lantern sleep choice truthfully starts the timer', await page.evaluate(() => vesper.app.lit && vesper.app.sleepMin === 30), {});
  await shot('lantern-sleep'); await page.getByRole('button', { name: /CANCEL SLEEP TIMER/ }).click();
  await page.getByRole('button', { name: 'LAMPS OFF', exact: true }).click();
  check('Lantern off clears four lamps and the board accent', await page.evaluate(() =>
    !vesper.app.lit && vesper.app.last.length === 12 && vesper.app.last.every(value => value === 0) &&
    vesper.lights.boardDesired.every(value => value === 0)), {});

  await launch('cadence'); await page.getByRole('button', { name: 'TIMER', exact: true }).click();
  await page.getByRole('button', { name: /^START 5 MIN \/ LAST$/ }).click();
  await page.waitForFunction(() => vesper.state.timers.length === 1);
  await page.getByRole('button', { name: 'NEW TIMER', exact: true }).click();
  await page.getByRole('button', { name: 'START 10 MIN', exact: true }).click(); await page.waitForFunction(() => vesper.state.timers.length === 2);
  await page.getByRole('button', { name: /^NEXT TIMER/ }).click();
  check('Cadence identifies the selected timer consistently', /TIMER 1 OF 2/.test(await page.textContent('#utility-content')), await page.textContent('#utility-content'));
  await page.getByRole('button', { name: /^NEXT TIMER/ }).click();
  check('Cadence next timer changes the displayed timer number', /TIMER 2 OF 2/.test(await page.textContent('#utility-content')), await page.textContent('#utility-content'));
  await shot('cadence-two-timers');
  await page.getByRole('button', { name: 'PAUSE', exact: true }).click();
  await page.waitForFunction(() => vesper.state.timers.some(timer => !timer.running));
  check('Cadence can pause the chosen timer without stopping the other', await page.evaluate(() =>
    vesper.state.timers.filter(timer => timer.running).length === 1), await page.evaluate(() => vesper.state.timers));
  await page.getByRole('button', { name: 'ADD 1 MIN', exact: true }).click();
  await page.waitForFunction(() => vesper.state.timers.length === 2 && vesper.state.timers.some(timer => !timer.running && timer.duration > 600));
  check('Cadence adds a minute while preserving the paused timer state', await page.evaluate(() =>
    vesper.state.timers.some(timer => !timer.running && timer.duration > 600)), await page.evaluate(() => vesper.state.timers));
  await page.evaluate(() => vesper.home());
  const state = await fetch(origin + '/api/state').then(response => response.json());
  check('utility journeys finish muted with private timers preserved', state.mic.mode === 'off' && !state.device.capture && state.timers.length === 2,
    { microphone: state.mic.mode, capture: state.device.capture, timers: state.timers.length });
  check('no page or host faults', !errors.length && !(await page.evaluate(() => vesper.errors.length)), { errors });
})().catch(error => { check('utility workflow completed', false, String(error.stack || error)); console.error(logs.slice(-2000)); })
  .finally(async () => { await browser?.close().catch(() => {}); await require('./browser-cleanup.cjs')(server, data);
    fs.writeFileSync(path.join(output, 'utility-polish.json'), JSON.stringify({ evidence: 'Windows/desktop software; synthetic controls; no physical acceptance', realArchive: !!process.env.VESPER_ZIM, results }, null, 2) + '\n');
    if (results.some(result => !result.ok)) process.exitCode = 1; });
