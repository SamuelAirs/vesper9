/* TWINBEAT through the real host at the console's 1024 x 600 display size.
   Windows/Linux browser software evidence only: no physical case, Pi frame-rate
   or acoustic timing claim. Uses one tab, owned loopback service/private data.
   PYTHON=... PLAYWRIGHT_PATH=... TEST_BROWSER_BIN=... node tests/twinbeat-browser.cjs */
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.env.TEST_OUTPUT || path.join(root, 'test-output/twinbeat-browser'));
const port = require('./free-port.cjs')();
const origin = 'http://127.0.0.1:' + port;
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'vesper-twinbeat-browser-'));
fs.mkdirSync(output, { recursive: true });
const server = spawn(process.env.PYTHON || 'python3', ['-m', 'vesper.server', '--simulate', '--http-port', String(port), '--data', data], { cwd: root, windowsHide: true });
let logs = '', browser;
server.stdout.on('data', d => { logs += d; });
server.stderr.on('data', d => { logs += d; });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + ' :: ' + JSON.stringify(detail));
};

(async () => {
  for (let i = 0; ; i++) {
    try { if ((await fetch(origin + '/api/state')).ok) break; } catch {}
    if (i >= 100 || server.exitCode !== null) throw Error('Owned simulator failed to start: ' + logs);
    await sleep(100);
  }
  browser = await chromium.launch({ headless: true, executablePath: process.env.TEST_BROWSER_BIN || undefined,
    args: ['--no-sandbox', '--mute-audio', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1024, height: 600 } });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(origin);
  await page.waitForFunction(() => window.vesper?.loaded);
  const shot = name => page.screenshot({ path: path.join(output, name + '.png') });
  const button = async (ms = 60) => {
    await page.keyboard.down('Space');
    await page.waitForFunction(() => !!vesper.input.press);
    await page.waitForTimeout(ms);
    await page.keyboard.up('Space');
    await page.waitForFunction(() => !vesper.input.press);
  };
  const setting = async (key, value) => {
    await page.evaluate(([key, value]) => vesper.bridge.command('settings', { key, value }), [key, value]);
    await page.waitForFunction(([key, value]) => vesper.state.settings[key] === value, [key, value]);
  };
  const launch = async () => {
    await page.evaluate(() => { vesper.home(); vesper.launch('twinbeat'); });
    await page.waitForFunction(() => vesper.meta?.id === 'twinbeat' && !vesper.faulted);
    await page.waitForTimeout(250);
  };
  const chooseHome = async expression => {
    const index = await page.evaluate(expression => vesper.app.rows().findIndex(row =>
      new RegExp(expression, 'i').test(row.label)), expression);
    if (index < 0) throw Error('Home action not found: ' + expression);
    for (let i = 0; i < index; i++) { await button(); await page.waitForTimeout(300); }
    await button(800);
  };
  const fit = async name => {
    const dimensions = await page.evaluate(() => {
      const ids = ['application', 'game', 'control-hint', 'arcade', 'pause-button'];
      return { viewport: [innerWidth, innerHeight], document: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
        elements: ids.map(id => { const e = document.getElementById(id), r = e?.getBoundingClientRect();
          return { id, visible: !!e && !e.hidden && !!r?.width && !!r?.height,
            rect: r ? [r.left, r.top, r.right, r.bottom] : null }; }) };
    });
    const visible = dimensions.elements.filter(e => e.visible);
    check(name + ': full console fits 1024x600', dimensions.document[0] <= 1024 && dimensions.document[1] <= 600 &&
      visible.every(e => e.rect[0] >= -1 && e.rect[1] >= -1 && e.rect[2] <= 1025 && e.rect[3] <= 601), dimensions);
  };
  // Pilot only reads the chart/song clock. Inputs still cross the normal keyboard,
  // WebSocket simulator and host router. It never edits a judgement or run clock.
  const pilot = async mode => {
    await page.evaluate(mode => {
      const pilot = window.__pilot = { mode, sent: [], finished: false, started: performance.now(), error: null };
      pilot.knocks = [];
      const originalKnock = vesper.app.knock?.bind(vesper.app);
      if (originalKnock) vesper.app.knock = event => { pilot.knocks.push({ side: event.side || null,
        source: event.source, songTime: vesper.app.songTime }); return originalKnock(event); };
      const key = (code, type = 'keydown') => document.dispatchEvent(new KeyboardEvent(type, { code,
        key: code === 'Space' ? ' ' : code.slice(3).toLowerCase(), bubbles: true }));
      const loop = () => {
        try {
          const app = vesper.app;
          if (!app || vesper.meta?.id !== 'twinbeat') throw Error('Pilot lost cartridge');
          if (app.phase !== 'play') { pilot.finished = true; return; }
          if (performance.now() - pilot.started > 75000) throw Error('Pilot timed out');
          if (!vesper.menu && !app.output.resumeLeft) {
            for (let index = 0; index < app.chart.notes.length; index++) {
              const note = app.chart.notes[index];
              if (pilot.sent.includes(index) || app.songTime < note.at + 0.035) continue;
              pilot.sent.push(index);
              const code = mode === 'sides' ? (note.side === 'left' ? 'KeyJ' : 'KeyL') : 'Space';
              key(code);
              if (code === 'Space') setTimeout(() => key(code, 'keyup'), 45);
              else key(code, 'keyup');
            }
          }
          pilot.frame = requestAnimationFrame(loop);
        } catch (error) { pilot.error = String(error); pilot.finished = true; }
      };
      pilot.frame = requestAnimationFrame(loop);
    }, mode);
  };
  const waitPilot = async () => {
    await page.waitForFunction(() => window.__pilot?.finished, null, { timeout: 80000 });
    await page.waitForTimeout(550);
    return page.evaluate(() => ({ pilot: window.__pilot, phase: vesper.app.phase,
      progress: vesper.state.progress.twinbeat || {}, stats: vesper.frameStats() }));
  };
  const gesture = () => page.evaluate(async () => {
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const key = type => document.dispatchEvent(new KeyboardEvent(type, { code: 'Space', key: ' ', bubbles: true }));
    for (let i = 0; i < 2; i++) { key('keydown'); await pause(60); key('keyup'); await pause(60); }
    key('keydown');
    const until = performance.now() + 3200;
    while (!vesper.menu && performance.now() < until) await pause(20);
    const opened = !!vesper.menu;
    key('keyup');
    await pause(150);
    return { opened, inputPress: !!vesper.input.press, blocked: vesper.input.blocked,
      songTime: vesper.app.songTime, mode: vesper.app.mode, phase: vesper.app.phase };
  });

  // Integration cases are kept here so every input uses the actual host router.
  await launch();
  await shot('title-assist');
  await fit('title');
  check('generic default offers button-only rhythm assist', await page.evaluate(() => vesper.app.mode === 'assist'),
    await page.evaluate(() => ({ phase: vesper.app.phase, mode: vesper.app.mode, tapMode: vesper.state.settings.tapMode })));

  // START CAMPAIGN is the first home row. Hold/release selects it on canvas.
  await button(800);
  check('button hold starts the first campaign chart', await page.evaluate(() => vesper.app.phase === 'play' && vesper.app.level === 0),
    await page.evaluate(() => ({ phase: vesper.app.phase, level: vesper.app.level })));
  await pilot('assist');
  await page.waitForTimeout(4200);
  await shot('play-assist');
  await fit('assist play');
  const assist = await waitPilot();
  check('real-time button-only chart clear saves and unlocks', !assist.pilot.error && assist.phase === 'result' &&
    assist.progress.careers?.assist?.[0]?.cleared && !assist.progress.careers?.sides?.[0]?.cleared,
    { sent: assist.pilot.sent.length, phase: assist.phase, progress: assist.progress, frameStats: assist.stats });
  await shot('result-assist');
  await fit('assist result');
  const storedAssist = await fetch(origin + '/api/state').then(response => response.json());
  check('service received the assist career and score', storedAssist.progress.twinbeat?.careers?.assist?.[0]?.cleared &&
    storedAssist.scores['twinbeat:assist'] > 0 && !storedAssist.scores['twinbeat:sides'],
    { progress: storedAssist.progress.twinbeat, scores: storedAssist.scores });
  await page.reload();
  await page.waitForFunction(() => window.vesper?.loaded);
  await launch();
  const reloaded = await page.evaluate(() => {
    const save = vesper.state.progress.twinbeat;
    vesper.app.start(1);
    return { save, phase: vesper.app.phase, level: vesper.app.level };
  });
  check('reload retains the earned unlock and chart2 starts', reloaded.save?.careers?.assist?.[0]?.cleared &&
    reloaded.phase === 'play' && reloaded.level === 1, reloaded);

  // An ordinary long game hold stays gameplay; only two taps followed by a hold
  // opens the menu. Restart keeps this separate from the clear/persistence run.
  await launch();
  await button(800);
  await button(2100);
  check('plain game hold does not open the system menu', await page.evaluate(() => !vesper.menu),
    await page.evaluate(() => ({ phase: vesper.app.phase, menu: !!vesper.menu })));
  await launch();
  await button(800);
  await page.evaluate(() => {
    const app = vesper.app, down = app.down.bind(app);
    window.__beforeGesture = null;
    app.down = (...args) => {
      window.__beforeGesture ||= { songTime: app.songTime, judgements: JSON.stringify(app.judgements),
        save: JSON.stringify(vesper.state.progress.twinbeat || {}) };
      return down(...args);
    };
  });
  const gestured = await gesture();
  const rewind = await page.evaluate(() => ({ before: window.__beforeGesture,
    after: { songTime: vesper.app.songTime, judgements: JSON.stringify(vesper.app.judgements),
      save: JSON.stringify(vesper.state.progress.twinbeat || {}) }, menuIndex: vesper.nav.index }));
  check('tap tap hold rolls back gameplay and consumes terminal release', gestured.opened && !gestured.inputPress &&
    !gestured.blocked && rewind.menuIndex === 0 && rewind.before.judgements === rewind.after.judgements &&
    rewind.before.save === rewind.after.save && Math.abs(rewind.before.songTime - rewind.after.songTime) < 0.04,
    { gestured, rewind });
  await shot('system-menu');
  const frozen = await page.evaluate(() => vesper.app.songTime);
  await page.waitForTimeout(650);
  check('menu pauses the song clock', await page.evaluate(() => vesper.app.songTime) === frozen, { songTime: frozen });
  await page.keyboard.press('Escape');
  const resumed = await page.evaluate(() => ({ songTime: vesper.app.songTime, resumeLeft: vesper.app.output.resumeLeft,
    judgements: JSON.stringify(vesper.app.judgements) }));
  await page.keyboard.press('KeyK');
  await page.waitForTimeout(300);
  const duringResume = await page.evaluate(() => ({ songTime: vesper.app.songTime, resumeLeft: vesper.app.output.resumeLeft,
    judgements: JSON.stringify(vesper.app.judgements) }));
  check('resume counts in while chart stays frozen and taps are ignored', resumed.resumeLeft > 0 &&
    duringResume.resumeLeft < resumed.resumeLeft && duringResume.songTime === resumed.songTime &&
    duringResume.judgements === resumed.judgements, { resumed, duringResume });
  await shot('resume-countin');

  // J/L service input is deliberately classified from synthetic stereo clips;
  // train those clips through the normal calibration commands in private data.
  await page.evaluate(() => vesper.home());
  for (const [index, side, key] of [[0, 'left', 'KeyJ'], [1, 'right', 'KeyL']]) {
    await page.evaluate(([index, side]) => vesper.bridge.command('tap_direction', {
      op: index ? 'label' : 'start', side }), [index, side]);
    for (let count = 1; count <= 6; count++) {
      await page.keyboard.press(key);
      await page.waitForFunction(async ([side, count]) => {
        const state = await fetch('/api/state').then(response => response.json());
        return state.tapDirection.pending[side] >= count;
      }, [side, count]);
    }
  }
  await page.evaluate(() => vesper.bridge.command('tap_direction', { op: 'save' }));
  const calibrated = await fetch(origin + '/api/state').then(response => response.json());
  check('synthetic side calibration is ready before two-side play', calibrated.tapDirection.ready,
    { calibration: calibrated.tapDirection, syntheticClipsOnly: true });
  check('saved calibration updates host state without reload', await page.evaluate(() => vesper.state.tapDirection.ready),
    await page.evaluate(() => vesper.state.tapDirection));
  await setting('tapMode', 'sides');
  await launch();
  await chooseHome('INPUT MODE');
  check('input mode switches through the real canvas menu', await page.evaluate(() => vesper.app.mode === 'sides'),
    await page.evaluate(() => ({ mode: vesper.app.mode, phase: vesper.app.phase, tapMode: vesper.state.settings.tapMode })));
  // Starting the clean side career uses chart1 even though assist unlocked chart2.
  await launch();
  await button(800);
  check('two-side career starts independently at chart1', await page.evaluate(() => vesper.app.mode === 'sides' &&
    vesper.app.phase === 'play' && vesper.app.level === 0),
    await page.evaluate(() => ({ phase: vesper.app.phase, level: vesper.app.level, mode: vesper.app.mode })));
  await pilot('sides');
  await page.waitForTimeout(4200);
  await shot('play-two-side');
  await fit('two-side play');
  const sides = await waitPilot();
  check('real-time J/L chart clear earns the separate two-side career', !sides.pilot.error && sides.phase === 'result' &&
    sides.progress.careers?.sides?.[0]?.cleared && sides.progress.careers?.assist?.[0]?.cleared,
    { sent: sides.pilot.sent.length, acceptedKnocks: sides.pilot.knocks, phase: sides.phase,
      progress: sides.progress, frameStats: sides.stats });
  check('real host receives both left and right simulated case taps', sides.pilot.knocks.some(event => event.side === 'left') &&
    sides.pilot.knocks.some(event => event.side === 'right') && sides.pilot.knocks.every(event => event.source === 'simulator'),
    sides.pilot.knocks);
  await shot('result-two-side');
  await fit('two-side result');
  const storedSides = await fetch(origin + '/api/state').then(response => response.json());
  check('service keeps separate assist and two-side scores', storedSides.scores['twinbeat:assist'] > 0 &&
    storedSides.scores['twinbeat:sides'] > 0 && storedSides.progress.twinbeat?.careers?.sides?.[0]?.cleared,
    { scores: storedSides.scores, progress: storedSides.progress.twinbeat });
  await page.reload();
  await page.waitForFunction(() => window.vesper?.loaded);
  await launch();
  check('reload retains the two-side input mode and both earned careers', await page.evaluate(() =>
    vesper.app.mode === 'sides' && vesper.state.progress.twinbeat.careers.assist[0].cleared &&
    vesper.state.progress.twinbeat.careers.sides[0].cleared),
    await page.evaluate(() => ({ mode: vesper.app.mode, progress: vesper.state.progress.twinbeat })));
  await button(800);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'TWINBEAT CONSOLE', exact: true }).click();
  check('custom console menu action closes and wakes the cartridge', await page.evaluate(() => !vesper.menu &&
    vesper.app.phase === 'home' && vesper.app.output.live),
    await page.evaluate(() => ({ menu: !!vesper.menu, phase: vesper.app.phase, live: vesper.app.output.live })));
  await button(800);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'RESTART THIS CHART', exact: true }).click();
  check('custom restart menu action closes and restarts the chart', await page.evaluate(() => !vesper.menu &&
    vesper.app.phase === 'play' && vesper.app.output.live && vesper.app.songTime < 0),
    await page.evaluate(() => ({ menu: !!vesper.menu, phase: vesper.app.phase, live: vesper.app.output.live,
      songTime: vesper.app.songTime })));
  await page.evaluate(() => vesper.bridge.command('tap_direction', { op: 'clear' }));
  check('clearing calibration invalidates host state without reload', await page.evaluate(() =>
    vesper.state.tapDirection.ready === false && vesper.state.tapDirection.calibrated === false),
    await page.evaluate(() => vesper.state.tapDirection));

  // A settings change cannot strand the player in unavailable directional input.
  await setting('tapMode', 'generic');
  await launch();
  check('generic setting falls back to playable assist', await page.evaluate(() => vesper.app.mode === 'assist'),
    await page.evaluate(() => ({ mode: vesper.app.mode, tapMode: vesper.state.settings.tapMode })));
  await page.evaluate(() => { window.__retiredTwinbeat = vesper.app; vesper.home(); });
  const retired = await page.evaluate(() => {
    const app = window.__retiredTwinbeat, before = JSON.stringify(vesper.state.progress.twinbeat);
    app.update?.(1 / 60); app.down?.({ source: 'keyboard' }); app.up?.({ source: 'keyboard' }); app.knock?.({ side: 'left' });
    return { current: vesper.meta?.id || null, saveUnchanged: before === JSON.stringify(vesper.state.progress.twinbeat),
      board: vesper.lights.boardDesired };
  });
  check('retired cartridge cannot mutate current saves or relaunch itself', retired.current === null && retired.saveUnchanged, retired);

  const health = await fetch(origin + '/api/state').then(response => response.json());
  check('ends with microphone off and no capture', health.mic.mode === 'off' && !health.device.capture,
    { microphone: health.mic.mode, capture: health.device.capture });
  const hostErrors = await page.evaluate(() => vesper.errors || []);
  check('no uncaught page or host errors', !pageErrors.length && !hostErrors.length, { pageErrors, hostErrors });
})().catch(error => {
  check('browser workflow completed', false, String(error.stack || error));
  console.error(logs.slice(-2000));
}).finally(async () => {
  await browser?.close().catch(() => {});
  await require('./browser-cleanup.cjs')(server, data);
  fs.writeFileSync(path.join(output, 'twinbeat-browser.json'), JSON.stringify({ environment: { platform: process.platform,
    viewport: [1024, 600], source: 'owned loopback simulator', physicalAcceptance: false }, results }, null, 2) + '\n');
  if (results.some(result => !result.ok)) process.exitCode = 1;
});
