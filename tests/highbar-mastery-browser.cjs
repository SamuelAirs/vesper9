/* One Windows-local Chrome tab, loopback simulation and a private seeded career.
   UI and Flat School use real-time keyboard edges. Recorded routes are deterministic
   60Hz host-event/InputRouter fixtures, without rider, score or physics-state injection. */
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..'), python = process.env.PYTHON || 'python3';
const output = path.resolve(process.env.TEST_OUTPUT || path.join(root, 'test-output/highbar-mastery'));
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'vesper-highbar-mastery-'));
fs.mkdirSync(output, { recursive: true });
execFileSync(python, ['-c', `from vesper.storage import Store
import sys
s=Store(sys.argv[1]);s.put('progress',{'highbar':{'schema':3,'slot':0,'slots':[{'scoreVersion':'style-v2','guided':False,'goals':[[0,1,2],[0,1,2],[0,1,2],[]],'styleBest':[999999,999999,999999,999999]},{'scoreVersion':'flow-v3','flowBest':[555555,0,0,0],'legacyRecords':{'styleV2':{'styleBest':[111111,0,0,0]}}}]}});s.close()`, data], { cwd: root, windowsHide: true });
const port = require('./free-port.cjs')(), origin = 'http://127.0.0.1:' + port;
const server = spawn(python, ['-m', 'vesper.server', '--simulate', '--http-port', String(port), '--data', data], { cwd: root, windowsHide: true });
let logs = '', browser, page;
server.stdout.on('data', d => logs += d); server.stderr.on('data', d => logs += d);
const sleep = ms => new Promise(r => setTimeout(r, ms)), results = [], routes = [], profiles = process.env.TEST_PROFILE_FROM ? JSON.parse(fs.readFileSync(process.env.TEST_PROFILE_FROM, 'utf8')).profiles : [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + ' :: ' + JSON.stringify(detail)); };
(async () => {
  for (let n = 0;; n++) { try { if ((await fetch(origin + '/api/state')).ok) break; } catch {}
    if (n > 100 || server.exitCode !== null) throw Error('Owned service startup failed: ' + logs); await sleep(100); }
  browser = await chromium.launch({ headless: true, executablePath: process.env.TEST_BROWSER_BIN || undefined,
    args: ['--no-sandbox', '--mute-audio', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'] });
  page = await browser.newPage({ viewport: { width: 1024, height: 600 } }), errors = [];
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
    check(label + ' leaves at least 86% of world unobscured', measured.coverage < .14 && measured.worstCaseCoverage < .14 && measured.backgrounds.every(b => b[2] <= 640 && b[3] <= 48), measured);
    const collision = measured.text.some((a, i) => measured.text.some((b, j) => j > i && Math.abs(a.y - b.y) < 10 && a.right > b.left && b.right > a.left));
    check(label + ' has compact readable bounded text', !collision && measured.text.length <= 9 && measured.text.every(t => t.left >= 18 && t.right <= 944 && t.y >= 14 && t.y <= 524), measured.text);
    return measured;
  };
  const sample = () => page.evaluate(() => {
    const a = vesper.app, canvas = document.createElement('canvas'), g = canvas.getContext('2d'), words = [];
    g.fillText = s => words.push(String(s)); a.drawCoach(g); a.drawRouteCue(g);
    const launch = a.releaseAdvice(), flight = a.flightAdvice(), lamps = a.restingLamps(), cache = a.flightAdvice();
    return { words, launch, flight, lamps, cacheReused: !flight || cache === flight, mode: a.p.mode,
      lesson: a.lesson, lessonCue: a.lessonCue(), landing: a.landing, style: a.styleNotice, n: a.n() };
  });
  const advice = async label => {
    const s = await sample(), labels = { build: 'BUILD', rise: 'UPWARD', travel: 'CROSS', fall: 'WAIT' };
    check(label + ' screen uses the shared launch and landing advice',
      (!s.launch || s.words.includes(labels[s.launch.phase])) && (!s.flight || s.words.includes(s.flight.urgent ? 'RELEASE' : { clean: 'CLEAN', safe: 'SAFE', sketchy: 'SKETCHY', bail: 'LAND RISK' }[s.flight.kind])) && s.cacheReused, s);
    if (s.n === 4 && s.launch) {
      const a = s.lamps.slice(0, 3), green = a[1] > a[0] && a[1] > a[2], amber = a[0] > a[1] && a[1] > a[2], cyan = a[1] > a[0] && a[2] > a[0];
      check(label + ' first lamp shares the visible release phase', s.launch.phase === 'rise' ? green : s.launch.phase === 'travel' ? cyan : amber, a);
    }
    return s;
  };
  const recorded = await import(require('node:url').pathToFileURL(path.join(root, 'tests/helpers/highbar-flow-routes.mjs')).href);
  const replay = async route => {
    await focus('ride');
    await page.evaluate(route => {
      window.__masteryRoute = { done: false, events: [], samples: [], observations: {}, evidence: 'deterministic 60Hz browser fixture through host.event/InputRouter; no rider or reward injection' };
      const a=vesper.app, start=a.start;
      a.start=function() {
        start.call(this); this.start=start;
        const update=this.update, tokens=route.input.split(' ').map(s=>({edge:s[0],frame:Number(s.slice(1))})), at=performance.now(); let frame=0,index=0;
        this.update=function(dt) {
          while(index<tokens.length && tokens[index].frame===frame) {
            const token=tokens[index++], event={source:'mastery-fixture',at_us:(at+frame/60*1000)*1000};
            vesper.event(token.edge==='T' ? {...event,type:'knock'} : {...event,type:'button',pressed:token.edge==='D'});
            __masteryRoute.events.push([this.runTime,token.edge]);
          }
          update.call(this,dt);
          const release=this.releaseAdvice(),flight=this.flightAdvice(),id=release?.phase||(flight&&'flight-'+flight.kind);
          if(id&&!__masteryRoute.observations[id]) {
            const g=document.createElement('canvas').getContext('2d'),words=[];g.fillText=s=>words.push(String(s));this.drawCoach(g);
            __masteryRoute.observations[id]={release,flight,words,lamps:this.restingLamps().slice(0,3)};
          }
          if(frame%6===0) __masteryRoute.samples.push({time:this.runTime,route:this.routeProgress(),position:[this.p.x,this.p.y],phase:release?.phase});
          frame++;
          if(this.phase!=='play'||frame>route.frames+180) {
            this.update=update;
            vesper.event({type:'button',pressed:false,source:'mastery-fixture',at_us:(at+frame/60*1000)*1000});
            Object.assign(__masteryRoute,{done:true,result:this.attemptResult,lineMet:this.lineMet,phase:this.phase,stats:structuredClone(this.stats),record:this.lineRecord()});
          }
        };
      };
    },route);
    await page.keyboard.down('Space'); await page.waitForFunction(() => !!vesper.input.press); await page.waitForTimeout(800); await page.keyboard.up('Space'); await page.waitForFunction(() => vesper.app.phase==='play');
    if (route.line === 3) { await page.waitForFunction(() => vesper.app.p.mode === 'bar', null, {timeout: 5000}); await shot('sky-spider-attached-' + route.park); await advice('sky catch ' + route.park); await layout('sky catch ' + route.park); }
    if (route.line === 3) { await page.waitForFunction(()=>vesper.app.p.mode==='air'&&vesper.app.park().floor-vesper.app.p.y>700,null,{timeout:12000}); await shot('sky-route-air-' + route.park); await layout('upper sky route ' + route.park); }
    await page.waitForFunction(() => __masteryRoute.done, null, { timeout: route.frames / 60 * 1000 + 12000 });
    const result = await page.evaluate(() => __masteryRoute); routes.push({ park: route.park, line: route.line, ...result }); return result;
  };
  await page.evaluate(() => vesper.launch('highbar')); await shot('title');
  const migration = await page.evaluate(() => ({ schema: vesper.app.save.schema, current: vesper.app.slot().flowBest,
    style: vesper.app.save.slots[0].legacyRecords.styleV2.styleBest[0], flow: vesper.app.save.slots[1].legacyRecords.flowV3.flowBest[0], oldStyle: vesper.app.save.slots[1].legacyRecords.styleV2.styleBest[0], total: vesper.app.masteryTotal() }));
  check('current rules preserve both historical epochs and expand mastery', migration.schema === 4 && migration.current.every(n => n === 0) && migration.style === 999999 && migration.flow === 555555 && migration.oldStyle === 111111 && migration.total === 48, migration);
  const cdp = await page.context().newCDPSession(page);
  if (!process.env.TEST_ROUTE_ONLY) {
  await button(); await page.waitForFunction(() => vesper.app.phase === 'guide');
  const pages = await page.evaluate(async () => (await import('/apps/highbar-content.js')).GUIDE.length);
  for (let n = 0; n < pages; n++) { await shot('guide-' + (n + 1)); await button(); await page.waitForTimeout(340); }
  check('reference guide returns to actual play', await page.evaluate(() => vesper.app.phase === 'play'));
  await action('RESTART IN FLAT SCHOOL'); await page.waitForFunction(() => vesper.app.resumeT === 0);
  const practiceBefore = await rewards(); let teaching = await sample(); await shot('flat-school');
  check('optional flat school starts with one compact context cue', teaching.lesson?.stage === 0 && teaching.words.includes(teaching.lessonCue), teaching);
  await page.keyboard.down('Space'); await page.waitForFunction(() => vesper.app.lesson.stage >= 1);
  await shot('flat-speed'); teaching = await sample(); check('real ground hold earns the speed exercise', teaching.lesson.stage === 1, teaching);
  await page.keyboard.up('Space'); await page.waitForFunction(() => vesper.app.p.mode === 'air'); await shot('flat-ollie'); await advice('flat ollie');
  await page.waitForFunction(() => vesper.app.p.mode === 'ground' && vesper.app.landing?.kind === 'clean', null, { timeout: 15000 });
  await shot('flat-clean-landing'); teaching = await sample(); check('actual clean landing receives clear visible credit', teaching.words.includes('CLEAN LANDING / ROLL TO BANK'), teaching);
  await page.waitForFunction(() => vesper.app.lesson.stage >= 3, null, { timeout: 15000 }); await shot('flat-bank');
  check('actual practice bank advances the optional exercise', await page.evaluate(() => vesper.app.lesson.stage === 3 && vesper.app.stats.banks > 0));
  check('practice exercises never change career rewards', await rewards() === practiceBefore);
  await action('GAME GUIDE'); await button(800); check('in-run guide preserves the live practice', await page.evaluate(() => vesper.app.phase === 'play' && vesper.app.mode === 2));
  await page.keyboard.down('Space'); await page.keyboard.press('Escape'); await page.keyboard.up('Space');
  const cancel = await page.evaluate(() => ({ pressed: vesper.app.pressed, pending: vesper.app.pending, board: vesper.app.boardSent }));
  check('pause consumes the held release and clears game action ownership', !cancel.pressed && !cancel.pending && !cancel.board, cancel);
  await page.keyboard.press('Escape'); await page.waitForFunction(() => !vesper.menu);

  for (let park = 0; park < 4; park++) {
    await setup(); if (park) await choose('park'); await focus('line');
    const count = await page.evaluate(async () => (await import('/apps/highbar-content.js')).LINES[vesper.app.parkId].length);
    for (let target = 0; target < count; target++) {
      await shot('brief-' + park + '-' + target);
      const rendered = (await words()).map(q => q.text).join(' ').replace(/\s+/g, ' ');
      const brief = await page.evaluate(() => vesper.app.challenge().approach);
      check('park ' + park + ' target ' + target + ' complete route brief', brief.every(q => rendered.includes(q.replace(/\s+/g, ' '))), brief);
      await choose('line');
    }
    await choose('line'); await choose('line'); await choose('line'); await choose('mode'); await choose('mode'); await focus('ride');
    await shot('sky-map-' + park); await choose('mode'); await choose('line');
    await choose('ride'); await page.waitForTimeout(800); await shot('park-' + park); await layout('park ' + park);
    if (!process.env.TEST_PROFILE_FROM) {
    if (process.env.TEST_CPU_READY) while (!fs.existsSync(process.env.TEST_CPU_READY)) await sleep(1000);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.evaluate(() => {
      const a = vesper.app, draw = a.draw, update = a.update; window.__profile = { draw: [], update: [], originalDraw: draw, originalUpdate: update };
      a.draw = function(g) { const at = performance.now(); draw.call(this, g); if (__profile.draw.length < 240) __profile.draw.push(performance.now() - at); };
      a.update = function(dt) { const at = performance.now(); update.call(this, dt); if (__profile.update.length < 240) __profile.update.push(performance.now() - at); };
    });
    await page.waitForFunction(() => __profile.draw.length >= 240 && __profile.update.length >= 240, null, { timeout: 35000 });
    const profile = await page.evaluate(() => { const a = vesper.app, p = __profile, stats = values => { const s = values.slice().sort((a, b) => a - b); return { n: s.length, median: s[120], p95: s[228], max: s[239] }; };
      a.draw = p.originalDraw; a.update = p.originalUpdate; return { park: a.parkId, draw: stats(p.draw), update: stats(p.update), host: vesper.frameStats() }; });
    profiles.push(profile); check('park ' + park + ' bounded 4x Chrome submission profile', profile.draw.p95 + profile.update.p95 < 16.7, profile);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    }
    await page.setViewportSize({ width: 960, height: 540 }); await shot('park-' + park + '-960');
    const dims = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight]);
    check('park ' + park + ' fits 960x540', dims[0] <= 960 && dims[1] <= 540, dims); await page.setViewportSize({ width: 1024, height: 600 });
  }
  await setup(); await choose('park'); await choose('mode'); await choose('mode');
  } else { await button(); await page.waitForFunction(()=>vesper.app.phase==='guide'); for(let n=0;n<6;n++){await button();await page.waitForTimeout(340);} await action('END SESSION'); await setup(); await choose('mode'); }
  let result = await replay(recorded.FIRST_FLIGHT); await shot('first-flight-earned');
  check('deterministic host input route finishes a banked line immediately', result.phase === 'over' && result.lineMet && result.result?.line === 0 && result.result.value > 0, {phase:result.phase,result:result.result,stats:result.stats});
  check('earned result renders its target, medal and combo', (await words()).some(q => q.text === 'LINE BANKED') && (await words()).some(q => q.text === 'TARGET COMBO ' + result.result.value.toLocaleString('en-US')));
  await page.waitForTimeout(1000); await action('RETRY THIS LINE'); check('explicit retry starts the same target with a fresh attempt', await page.evaluate(() => vesper.app.phase === 'play' && vesper.app.slot().line === 0 && !vesper.app.attemptResult));
  await action('END SESSION'); await setup(); result = await replay(recorded.FIRST_FLIGHT); await page.waitForTimeout(1000);
  await action('NEXT LINE'); check('menu next line starts the next target', await page.evaluate(() => vesper.app.phase === 'play' && vesper.app.slot().line === 1 && !vesper.app.attemptResult));
  await action('END SESSION'); await setup(); await choose('line'); await choose('line'); await choose('line');
  result = await replay(recorded.FIRST_FLIGHT); await page.waitForTimeout(1000); await page.keyboard.press('KeyK'); await page.waitForFunction(()=>vesper.app.phase==='play'&&vesper.app.slot().line===1);
  check('generic case advances after a successful finite attempt', await page.evaluate(() => vesper.app.phase === 'play' && vesper.app.slot().line === 1));
  await action('END SESSION'); await setup(); await choose('line'); await choose('line'); await focus('ride'); await shot('skyline-selected-map');
  const cachedActive = process.env.TEST_ACTIVE_PROFILE_FROM ? JSON.parse(fs.readFileSync(process.env.TEST_ACTIVE_PROFILE_FROM,'utf8')).profiles.find(p=>p.modes?.air>30) : null;
  if (!cachedActive) {
  if (process.env.TEST_AIR_CPU_READY) while (!fs.existsSync(process.env.TEST_AIR_CPU_READY)) await sleep(1000);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.evaluate(() => {
    const a = vesper.app, draw = a.draw, update = a.update; window.__activeProfile = { draw: [], update: [], modes: {}, originalDraw: draw, originalUpdate: update };
    a.draw = function(g) { const at = performance.now(); draw.call(this, g); if (__activeProfile.draw.length < 600) __activeProfile.draw.push(performance.now() - at); };
    a.update = function(dt) { const mode = this.p.mode, at = performance.now(); update.call(this, dt); if (__activeProfile.update.length < 600) { __activeProfile.update.push(performance.now() - at); __activeProfile.modes[mode] = (__activeProfile.modes[mode] || 0) + 1; } };
  });
  }
  result = await replay(recorded.SKY_ROUTES[0]); await shot('skyline-earned');
  check('deterministic host input route completes and banks the ordered upper route', result.phase === 'over' && result.result?.line === 3 && result.result.medal >= 1 && result.samples.some(s => s.route?.complete), {phase:result.phase,result:result.result,stats:result.stats});
  const activeProfile = cachedActive || await page.evaluate(() => {
    const a = vesper.app, p = __activeProfile, stats = values => { const s = values.slice().sort((a,b)=>a-b); return {n:s.length, median:s[Math.floor(s.length*.5)],p95:s[Math.floor(s.length*.95)],max:s.at(-1)}; };
    a.draw=p.originalDraw; a.update=p.originalUpdate; return {park:a.parkId, rate:4, draw:stats(p.draw),update:stats(p.update),modes:p.modes};
  }); profiles.push(activeProfile); await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
  check('actual upper-route 4x profile includes airborne forecasting', activeProfile.modes.air > 30 && activeProfile.draw.p95 + activeProfile.update.p95 < 16.7, activeProfile);
  const observationValues=Object.values(result.observations), phaseLabels={build:'BUILD',rise:'UPWARD',travel:'CROSS',fall:'WAIT'};
  check('actual upper-route screen and lamps share observed release advice', observationValues.filter(s=>s.release).length >= 2 && observationValues.every(s=>!s.release || (s.words.includes(phaseLabels[s.release.phase]) && (s.release.phase==='rise' ? s.lamps[1]>s.lamps[0]&&s.lamps[1]>s.lamps[2] : s.release.phase==='travel' ? s.lamps[1]>s.lamps[0]&&s.lamps[2]>s.lamps[0] : s.lamps[0]>s.lamps[1]&&s.lamps[1]>s.lamps[2]))), result.observations);
  const earned = JSON.stringify(result.result); await page.waitForTimeout(1000); await shot('skyline-earned-settled');
  check('earned attempt remains immutable while the result settles', await page.evaluate(() => JSON.stringify(vesper.app.attemptResult)) === earned);
  await page.evaluate(() => vesper.home()); await page.waitForFunction(() => !vesper.saves.status().pending);
  await page.reload(); await page.waitForFunction(() => window.vesper?.loaded); await page.evaluate(() => vesper.launch('highbar'));
  check('reload retains new upper-route result and selected target', await page.evaluate(() => vesper.app.slot().line === 3 && vesper.app.slot().lines[0].includes(3) && vesper.app.lineRecord().medal > 0 && vesper.app.save.schema === 4));
  await page.evaluate(() => vesper.home()); const state = await fetch(origin + '/api/state').then(r => r.json());
  check('mastery journey ends muted with no browser or host faults', state.mic.mode === 'off' && !state.device.capture && !errors.length && !(await page.evaluate(() => vesper.errors.length)), errors);
})().catch(async e => { if(page){ await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{}); check('failure context',false,await page.evaluate(()=>({phase:vesper.app.phase,cursor:vesper.app.cursor,line:vesper.app.slot().line,mode:vesper.app.mode,pressed:vesper.app.pressed,blocked:vesper.input.blocked,input:vesper.input.press,route:window.__masteryRoute,errors:vesper.errors})).catch(()=>null));} check('complete mastery browser journey', false, String(e.stack || e)); console.error(logs.slice(-1200)); })
.finally(async () => { await browser?.close().catch(() => {}); await require('./browser-cleanup.cjs')(server, data);
  fs.writeFileSync(path.join(output, 'highbar-mastery-browser.json'), JSON.stringify({ evidence: 'Windows Chrome / real-time host keyboard UI and Flat School; recorded routes use deterministic 60Hz host event/InputRouter fixtures / private historical seeded career; no Pi or physical acceptance', profileSources: [process.env.TEST_PROFILE_FROM,process.env.TEST_ACTIVE_PROFILE_FROM].filter(Boolean).map(file=>({file,rendererSha256:JSON.parse(fs.readFileSync(file,'utf8')).rendererSha256})), rendererSha256: require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root, 'web/apps/highbar-view.js'))).digest('hex'), results, routes, profiles }, null, 2) + '\n');
  if (results.some(r => !r.ok)) process.exitCode = 1; });
