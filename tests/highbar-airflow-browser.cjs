/* One Windows-local Chrome tab, loopback simulation and a private seeded career.
   Live routes use host keyboard edges; no rider, score or physics state injection. */
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..'), python = process.env.PYTHON || 'python3';
const output = path.resolve(process.env.TEST_OUTPUT || path.join(root, 'test-output/highbar-airflow'));
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'vesper-highbar-airflow-'));
fs.mkdirSync(output, { recursive: true });
execFileSync(python, ['-c', `from vesper.storage import Store
import sys
s=Store(sys.argv[1]);s.put('progress',{'highbar':{'schema':2,'slot':0,'slots':[{'guided':False,'goals':[[0,1,2],[0,1,2],[0,1,2],[]],'styleBest':[999999,999999,999999,999999]}]}});s.close()`, data], { cwd: root, windowsHide: true });
const port = require('./free-port.cjs')(), origin = 'http://127.0.0.1:' + port;
const server = spawn(python, ['-m', 'vesper.server', '--simulate', '--http-port', String(port), '--data', data], { cwd: root, windowsHide: true });
let logs = '', browser;
server.stdout.on('data', d => logs += d); server.stderr.on('data', d => logs += d);
const sleep = ms => new Promise(r => setTimeout(r, ms)), results = [], routes = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + ' :: ' + JSON.stringify(detail)); };
(async () => {
  for (let n = 0;; n++) { try { if ((await fetch(origin + '/api/state')).ok) break; } catch {}
    if (n > 100 || server.exitCode !== null) throw Error('Owned service startup failed: ' + logs); await sleep(100); }
  browser = await chromium.launch({ headless: true, executablePath: process.env.TEST_BROWSER_BIN || undefined,
    args: ['--no-sandbox', '--mute-audio', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1024, height: 600 } }), errors = [];
  const videoStarted = Date.now();
  page.on('pageerror', e => errors.push(e.message)); await page.goto(origin); await page.waitForFunction(() => window.vesper?.loaded);
  const shot = name => page.screenshot({ path: path.join(output, name + '.png') });
  const button = async (ms = 60) => { await page.keyboard.down('Space'); await page.waitForFunction(() => !!vesper.input.press);
    await page.waitForTimeout(ms); await page.keyboard.up('Space'); await page.waitForFunction(() => !vesper.input.press); };
  const action = async label => { await page.keyboard.press('Escape'); await page.getByRole('button', { name: label, exact: true }).click(); await page.waitForFunction(() => !vesper.menu); };
  const setup = async () => { if (await page.evaluate(() => vesper.app.phase === 'play')) await action('CHANGE PRACTICE START');
    else { await page.waitForTimeout(950); await button(800); } await page.waitForFunction(() => vesper.app.phase === 'setup'); };
  const focus = async id => { const at = await page.evaluate(id => vesper.app.setupItems().findIndex(q => q.id === id), id);
    if (at < 0) throw Error('No setup choice ' + id);
    for (let n = 0; await page.evaluate(() => vesper.app.cursor) !== at; n++) { if (n > 15) throw Error('Cannot reach ' + id); await button(); await page.waitForTimeout(340); } };
  const choose = async id => { await focus(id); await button(800); };
  const words = () => page.evaluate(() => { const canvas = document.createElement('canvas'), g = canvas.getContext('2d'), calls = [];
    const write = g.fillText.bind(g); g.fillText = (s, x, y) => { calls.push({ text: String(s), x, y }); write(s, x, y); };
    vesper.app.draw(g); return calls; });
  const rewards = () => page.evaluate(() => { const s = structuredClone(vesper.app.slot()); delete s.park; delete s.line; delete s.mode; delete s.guided; return JSON.stringify(s); });
  const layout = async label => {
    const measured = await page.evaluate(() => { const a = vesper.app, rects = a.playHudRects();
      const canvas = document.createElement('canvas'), g = canvas.getContext('2d'), text = [], backgrounds = [], write = g.fillText.bind(g), fill = g.fillRect.bind(g);
      g.fillRect = (x, y, w, h) => { if (w >= 200 && h >= 30) backgrounds.push([x, y, w, h]); fill(x, y, w, h); };
      g.fillText = (s, x, y) => { const m = g.measureText(String(s)), left = g.textAlign === 'right' ? x - m.width : g.textAlign === 'center' ? x - m.width / 2 : x;
        text.push({ text: String(s), left, right: left + m.width, y }); write(s, x, y); };
      a.drawCoach(g); a.drawCombo(g); a.drawRouteCue(g);
      return { coverage: backgrounds.reduce((n, r) => n + r[2] * r[3], 0) / (960 * 540), worstCaseCoverage: rects.reduce((n, r) => n + r[2] * r[3], 0) / (960 * 540), backgrounds, text,
        marker: a.barMarker(), park: a.parkId, mode: a.p.mode, camera: [a.camX, a.camY], position: [a.p.x, a.p.y], floor: a.park().floor };
    });
    check(label + ' leaves at least 80% of world unobscured', measured.coverage <= .2 && measured.worstCaseCoverage <= .2 && measured.backgrounds.every(b => b[2] <= 640 && b[3] <= 48), measured);
    const collision = measured.text.some((a, i) => measured.text.some((b, j) => j > i && Math.abs(a.y - b.y) < 10 && a.right > b.left && b.right > a.left));
    check(label + ' has compact readable bounded text', !collision && measured.text.length <= 9 && measured.text.every(t => t.left >= 18 && t.right <= 944 && t.y >= 14 && t.y <= 524), measured.text);
    return measured;
  };
  await page.evaluate(() => vesper.launch('highbar')); await shot('title');
  const title = (await words()).map(q => q.text).join(' ');
  check('current PB and previous-rules PB remain distinct', title.includes('FLOW BEST 0') && title.includes('PREVIOUS RULES BEST 999,999'), title);
  await button(); check('first-use opens six-page guide', await page.evaluate(() => vesper.app.phase === 'guide' && vesper.app.guide === 0));
  for (let n = 0; n < 6; n++) { await shot('guide-' + (n + 1)); if (n === 3) {
      await page.keyboard.press('KeyK'); await page.waitForFunction(() => vesper.app.guide === 2); check('generic tap goes back in guide', true); await button(); await page.waitForTimeout(340); }
    await button(); await page.waitForTimeout(340); }
  check('guide enters genuine play', await page.evaluate(() => vesper.app.phase === 'play' && vesper.app.slot().guided));
  await action('GAME GUIDE'); await button(800); check('in-run guide returns to preserved play', await page.evaluate(() => vesper.app.phase === 'play'));
  await action('END SESSION'); await setup(); await choose('mode'); await choose('mode');
  check('practice has scrolling start and pace choices', await page.evaluate(() => vesper.app.setupItems().length === 10));
  await focus('back'); await shot('setup-scrolled'); await page.keyboard.press('KeyK'); await page.waitForFunction(() => vesper.app.setupItems()[vesper.app.cursor].id === 'guide');
  check('generic tap moves backward in scrolling setup', true);
  if (process.env.HIGHBAR_PREVIEW_ONLY) {
    await choose('ride'); await button(700); await page.waitForTimeout(60); await page.keyboard.down('Space');
    await page.waitForFunction(() => vesper.app.p.mode === 'bar', null, { timeout: 8000 });
    await page.waitForFunction(() => vesper.app.p.held >= .4);
    const preview = await page.evaluate(async () => {
      const { barLaunchVelocity, G } = await import('/apps/highbar-content.js');
      const a = vesper.app, p = a.p, before = JSON.stringify(p), velocity = barLaunchVelocity(p, a.park().bars[p.bar][2]);
      const canvas = document.createElement('canvas'), g = canvas.getContext('2d'), dots = [];
      g.fillRect = (x, y, w, h) => dots.push([x, y, w, h]); a.drawTrajectory(g);
      return { unchanged: JSON.stringify(p) === before, dots: dots.length, first: dots[0], held: p.held,
        expected: [p.x + velocity.vx * .055 - 1, p.y + velocity.vy * .055 + .5 * G * .055 ** 2 - 1], velocity,
        rawTangent: { vx: p.r * p.om * Math.cos(p.phi), vy: -p.r * p.om * Math.sin(p.phi) } };
    });
    check('practice arc uses exact committed release lift and final velocity cap', preview.held >= .35 && preview.dots > 0 && preview.first.slice(0, 2).every((n, i) => Math.abs(n - preview.expected[i]) < 1e-8) && Math.hypot(preview.velocity.vx, preview.velocity.vy) <= 920.000001, preview);
    check('release preview leaves real rider state untouched', preview.unchanged, preview);
    await shot('spider-committed-release-preview'); await layout('actual caught-post preview');
    await page.keyboard.up('Space'); await page.waitForFunction(() => !vesper.input.press);
    await action('CHANGE PRACTICE START'); await choose('start'); await choose('ride'); await page.waitForTimeout(700);
    await page.keyboard.press('KeyK'); await page.waitForFunction(() => !!vesper.app.manual);
    await shot('spider-manual'); await page.waitForFunction(() => vesper.app.p.mode === 'bail', null, { timeout: 12000 });
    await shot('spider-scramble-bail'); await layout('actual manual-bail recovery');
    check('live unbalanced manual exposes spider recovery pose', await page.evaluate(() => vesper.app.p.mode === 'bail' && vesper.app.landing?.kind === 'bail'));
    await page.evaluate(() => vesper.home()); const state = await fetch(origin + '/api/state').then(r => r.json());
    check('focused preview ends muted with no browser or host faults', state.mic.mode === 'off' && !state.device.capture && !errors.length && !(await page.evaluate(() => vesper.errors.length)), errors);
    return;
  }
  const baseline = await rewards();
  for (let park = 0; park < 4; park++) {
    if (park) { await setup(); await choose('park'); }
    await focus('line');
    const lineCount = await page.evaluate(async () => (await import('/apps/highbar-content.js')).LINES[vesper.app.parkId].length);
    for (let route = 0; route < lineCount; route++) {
      await shot('route-' + park + '-' + route);
      const brief = await page.evaluate(() => { const canvas = document.createElement('canvas'), g = canvas.getContext('2d'), calls = [];
        g.fillText = (s, x, y) => { if (x === 608 && y >= 230) calls.push(String(s)); }; vesper.app.draw(g);
        const rendered = calls.join(' ').replace(/\s+/g, ' '); return { park: vesper.app.parkId, line: vesper.app.slot().line,
          full: vesper.app.challenge().approach.every(s => rendered.includes(s.replace(/\s+/g, ' '))) }; });
      check('route ' + park + '/' + route + ' renders complete approach', brief.full, brief); await choose('line');
    }
    await choose('ride'); await page.waitForTimeout(800);
    await shot('park-' + park + '-skate'); await layout('park ' + park + ' skate');
    await action('RESET PRACTICE START'); await page.waitForFunction(() => vesper.app.resumeT === 0);
    // State-aware real-control pilot. Read state; send ordinary DOM keyboard edges.
    // Keep catching while airborne, release a held bar to climb, straighten the descent.
    const videoStartSeconds = (Date.now() - videoStarted) / 1000;
    let recorded;
    if (!park && process.env.TEST_RECORD_VIDEO && process.env.TEST_FFMPEG) {
      const cdp = await page.context().newCDPSession(page), frames = [];
      cdp.on('Page.screencastFrame', frame => { frames.push({ timestamp: frame.metadata.timestamp, data: frame.data });
        cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {}); });
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: 1024, maxHeight: 600, everyNthFrame: 2 });
      recorded = (async () => { await sleep(15000); await cdp.send('Page.stopScreencast'); await cdp.detach();
        const directory = path.join(output, 'video-frames'); fs.mkdirSync(directory, { recursive: true });
        const entries = [];
        for (let n = 0; n < frames.length; n++) { const name = String(n).padStart(5, '0') + '.jpg';
          fs.writeFileSync(path.join(directory, name), Buffer.from(frames[n].data, 'base64')); entries.push("file '" + name + "'");
          if (n + 1 < frames.length) entries.push('duration ' + Math.max(.001, frames[n + 1].timestamp - frames[n].timestamp)); }
        const list = path.join(directory, 'frames.txt'); fs.writeFileSync(list, entries.join('\n') + '\n');
        execFileSync(process.env.TEST_FFMPEG, ['-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-vf', 'fps=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', path.join(output, 'spider-gameplay.mp4')], { windowsHide: true });
        check('actual 15-second spider motion clip captured', frames.length > 30, { frames: frames.length }); })();
    }
    const flight = page.evaluate(async () => {
      const a = vesper.app, pause = ms => new Promise(r => setTimeout(r, ms)), start = a.runTime;
      const key = down => document.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code: 'Space', key: ' ', bubbles: true }));
      let held = false, releasedAt = -10, barAt = -1, lastBar = -1, maxHeight = 0, airTime = 0, transitions = 0;
      const seen = new Set(), marks = [], events = [];
      window.__airflowPilot = { active: true, maxHeight: 0 };
      while (a.runTime - start < 30 && a.phase === 'play') {
        const p = a.p, height = a.park().floor - p.y; maxHeight = Math.max(maxHeight, height);
        if (p.mode === 'air' && height > 500) airTime += .1;
        __airflowPilot.maxHeight = maxHeight;
        if (p.mode === 'bar' && p.bar !== lastBar) { lastBar = p.bar; barAt = a.runTime; seen.add(p.bar); transitions++; marks.push({ t: a.runTime, bar: p.bar, height }); }
        if (p.mode !== 'bar') lastBar = -1;
        let want = held;
        if (p.mode === 'ground') want = a.combo.roll >= 0 ? false : !held || a.t - a.pt < (a.parkId === 3 ? 1.2 : .7);
        if (p.mode === 'air') {
          want = a.air.t > .08 && a.air.t < 1.1 || a.pickBar() >= 0;
          if (a.pickBar() >= 0 && held && !a.pending) want = false;
        }
        if (p.mode === 'bar') want = !(p.held > (a.parkId === 0 ? 1.6 : a.parkId === 2 ? .5 : 1.2) && p.vy < -Math.min(a.parkId === 0 || a.parkId === 2 ? 550 : 350, p.r * 3));
        if (p.mode === 'bail') want = false;
        if (want !== held) { key(want); held = want; events.push([a.runTime - start, held ? 'D' : 'U']); if (!want) releasedAt = a.runTime; }
        await pause(100);
      }
      if (held) key(false); __airflowPilot.active = false;
      return { maxHeight, upperAirSeconds: airTime, bars: [...seen], transitions, marks, events,
        mode: a.p.mode, camera: [a.camX, a.camY], position: [a.p.x, a.p.y], stats: structuredClone(a.stats) };
    });
    try {
      await page.waitForFunction(() => vesper.app.p.mode === 'bar', null, { timeout: 17000 }); await shot('park-' + park + '-swing');
      await page.waitForFunction(() => vesper.app.p.mode === 'air', null, { timeout: 8000 }); await shot('park-' + park + '-flip');
      await page.waitForFunction(() => vesper.app.park().floor - vesper.app.p.y > 500 && vesper.app.p.mode === 'air', null, { timeout: 20000 });
      await shot('park-' + park + '-upper-air'); await layout('park ' + park + ' upper air');
    } catch (e) { check('park ' + park + ' live flow screenshots captured', false, String(e)); }
    const pilot = await flight;
    if (recorded) await recorded;
    routes.push({ park, videoStartSeconds, ...pilot }); check('park ' + park + ' actual controls catch and gain height', pilot.bars.length > 0 && pilot.maxHeight > 500, pilot);
    await shot('park-' + park + '-flow'); await layout('park ' + park + ' flow');
    // Some routes bank during the pilot; the Tower can stay airborne for its
    // entire duration. Only wait for the released final flight if none banked.
    if (!pilot.stats.banks) await page.waitForFunction(() => vesper.app.stats.banks > 0, null, { timeout: 18000 });
    const landed = await page.evaluate(() => ({ ...vesper.app.stats }));
    check('park ' + park + ' live flight lands and banks', landed.banks > 0, landed);
    await page.setViewportSize({ width: 960, height: 540 }); await shot('park-' + park + '-960');
    const dims = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }));
    check('park ' + park + ' fits 960x540 without overflow', dims.width <= 960 && dims.height <= 540, dims); await page.setViewportSize({ width: 1024, height: 600 });
  }
  check('actual pilot sustains upper-air flow', routes.some(r => r.upperAirSeconds >= 2 && r.bars.length >= 3), routes.map(r => ({ park: r.park, height: r.maxHeight, upperAir: r.upperAirSeconds, bars: r.bars })));
  check('practice leaves career rewards unchanged', await rewards() === baseline);
  await action('LEAVE PRACTICE'); await page.waitForTimeout(1000); await shot('practice-result');
  check('practice result labels unchanged career', (await words()).some(q => q.text === 'CAREER UNCHANGED'));
  await page.evaluate(() => vesper.home()); await page.waitForFunction(() => !vesper.saves.status().pending);
  await page.reload(); await page.waitForFunction(() => window.vesper?.loaded); await page.evaluate(() => vesper.launch('highbar'));
  check('reload retains selected park, mode and guide completion', await page.evaluate(() => vesper.app.parkId === 3 && vesper.app.mode === 2 && vesper.app.slot().guided));
  await page.evaluate(() => vesper.home()); const state = await fetch(origin + '/api/state').then(r => r.json());
  check('journey ends muted with no browser or host faults', state.mic.mode === 'off' && !state.device.capture && !errors.length && !(await page.evaluate(() => vesper.errors.length)), errors);
})().catch(e => { check('complete airflow browser journey', false, String(e.stack || e)); console.error(logs.slice(-1200)); })
.finally(async () => { await browser?.close().catch(() => {}); await require('./browser-cleanup.cjs')(server, data);
  fs.writeFileSync(path.join(output, process.env.HIGHBAR_PREVIEW_ONLY ? 'preview-browser.json' : 'highbar-airflow-browser.json'), JSON.stringify({ evidence: 'Windows Chrome / real host keyboard edges / private seeded career; no Pi or physical acceptance', rendererSha256: require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root, 'web/apps/highbar-view.js'))).digest('hex'), results, routes }, null, 2) + '\n');
  if (results.some(r => !r.ok)) process.exitCode = 1; });
