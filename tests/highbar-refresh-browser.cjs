/* Native browser art/control proof, one owned loopback service/private database.
   Existing unlocked career seeded; genuine host input and physics; Windows only.
   Draw timings measure canvas submission, including a4x Chrome CPU simulation. */
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..'), python = process.env.PYTHON || 'python3';
const output = path.resolve(process.env.TEST_OUTPUT || path.join(root, 'test-output/highbar-refresh'));
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'vesper-highbar-refresh-')); fs.mkdirSync(output, { recursive: true });
execFileSync(python, ['-c', `from vesper.storage import Store
import sys
s=Store(sys.argv[1]);s.put('progress',{'highbar':{'schema':2,'slot':0,'slots':[{'guided':False,'goals':[[0,1,2],[0,1,2],[0,1,2],[]]}]}});s.close()`, data], { cwd: root, windowsHide: true });
const port = require('./free-port.cjs')(), origin = 'http://127.0.0.1:' + port;
const server = spawn(python, ['-m', 'vesper.server', '--simulate', '--http-port', String(port), '--data', data], { cwd: root, windowsHide: true });
let logs = '', browser; server.stdout.on('data', d => logs += d); server.stderr.on('data', d => logs += d);
const sleep = ms => new Promise(r => setTimeout(r, ms)), results = [], profiles = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + ' :: ' + JSON.stringify(detail)); };
(async () => {
  for (let n = 0;; n++) { try { if ((await fetch(origin + '/api/state')).ok) break; } catch {}
    if (n > 100 || server.exitCode !== null) throw Error('Owned service startup failed: ' + logs); await sleep(100); }
  browser = await chromium.launch({headless:true, executablePath:process.env.TEST_BROWSER_BIN || undefined,
    args:['--no-sandbox','--mute-audio','--disable-gpu','--autoplay-policy=no-user-gesture-required']});
  const page = await browser.newPage({viewport:{width:1024,height:600}}), errors = [];
  page.on('pageerror', e => errors.push(e.message)); await page.goto(origin); await page.waitForFunction(() => window.vesper?.loaded);
  const shot = name => page.screenshot({path:path.join(output,name+'.png')});
  const button = async(ms=60) => { await page.keyboard.down('Space'); await page.waitForFunction(() => !!vesper.input.press);
    await page.waitForTimeout(ms); await page.keyboard.up('Space'); await page.waitForFunction(() => !vesper.input.press); };
  const action = async label => { await page.keyboard.press('Escape'); await page.getByRole('button',{name:label,exact:true}).click(); await page.waitForFunction(() => !vesper.menu); };
  const setup = async () => { if (await page.evaluate(() => vesper.app.phase === 'play')) await action('CHANGE PRACTICE START');
    else { await page.waitForTimeout(900); await button(800); } await page.waitForFunction(() => vesper.app.phase === 'setup'); };
  const focus = async id => { const at = await page.evaluate(id => vesper.app.setupItems().findIndex(q=>q.id===id),id);
    if(at<0)throw Error('No setup choice '+id);
    for(let n=0;await page.evaluate(()=>vesper.app.cursor)!==at;n++){if(n>15)throw Error('Cannot reach '+id);await button();await page.waitForTimeout(340);} };
  const choose = async id => { await focus(id); await button(800); };
  await page.evaluate(()=>vesper.launch('highbar'));
  if(process.env.HIGHBAR_FEEDBACK_ONLY){
    await button();await button(800);await action('END SESSION');await setup();await choose('mode');await choose('mode');await choose('start');await choose('ride');await page.waitForTimeout(800);
    const coach = () => page.evaluate(()=>{const c=document.createElement('canvas'),g=c.getContext('2d'),words=[];g.fillText=s=>words.push(String(s));vesper.app.drawCoach(g);return {text:words.join(' '),notice:vesper.app.styleNotice,landing:vesper.app.landing,mode:vesper.app.p.mode,manual:!!vesper.app.manual,age:vesper.app.t-vesper.app.tapAt};});
    await page.keyboard.press('KeyK');await page.waitForFunction(()=>!!vesper.app.manual);await shot('manual-action-notice');let shown=await coach();
    check('active manual shows its actual recent style notice',shown.text.includes(shown.notice)&&shown.notice.startsWith('MANUAL'),shown);
    await page.waitForTimeout(500);await page.keyboard.press('KeyK');await page.waitForFunction(()=>vesper.app.manual?.corrections===1);await shot('manual-correction-notice');shown=await coach();
    check('generic manual correction shows its actual balance advice',shown.text.includes(shown.notice)&&shown.notice.startsWith('BALANCE'),shown);
    await page.waitForTimeout(1450);shown=await coach();check('expired style advice does not linger in the coach',shown.age>=1.3&&!shown.text.includes(shown.notice),shown);
    await action('RESET PRACTICE START');await page.waitForTimeout(750);await page.keyboard.press('KeyK');await page.waitForFunction(()=>!!vesper.app.manual);
    await page.waitForFunction(()=>vesper.app.landing?.kind==='bail',null,{timeout:12000});await shot('actual-bail-reason');shown=await coach();
    check('actual bail exposes its specific bounded reason',shown.landing?.t>0&&shown.text.includes(shown.landing.reason.slice(0,51)),shown);
    await page.waitForTimeout(2500);shown=await coach();check('expired landing reason clears from the coach',!shown.landing,shown);
    await action('CHANGE PRACTICE START');await choose('start');await choose('ride');
    await page.keyboard.down('Space');await page.waitForFunction(()=>!!vesper.input.press);
    await page.waitForFunction(()=>vesper.app.runTime>=.7);await page.keyboard.up('Space');await page.waitForFunction(()=>!vesper.input.press);
    await page.waitForFunction(()=>vesper.app.runTime>=.8);await page.keyboard.down('Space');
    await page.waitForFunction(()=>vesper.app.p.mode==='bar'&&vesper.app.p.held>.2);
    await page.keyboard.press('KeyK');await page.waitForFunction(()=>vesper.app.p.regrip);await shot('actual-regrip-advice');shown=await coach();
    check('actual caught-bar regrip exposes its recent upward-release advice',shown.text.includes(shown.notice)&&shown.notice.startsWith('REGRIP'),shown);
    await page.keyboard.up('Space');await page.waitForFunction(()=>!vesper.input.press);
    await page.waitForFunction(()=>vesper.app.p.mode==='ground'&&vesper.app.landing?.t>0,null,{timeout:10000});
    await page.keyboard.press('KeyK');await page.waitForFunction(()=>!!vesper.app.manual);await shot('manual-after-landing');shown=await coach();
    check('new manual advice takes priority over a lingering landing reason',shown.landing?.t>0&&shown.manual&&shown.text.includes(shown.notice),shown);
    const dims=await page.evaluate(()=>({width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight}));check('feedback screens fit1024x600',dims.width<=1024&&dims.height<=600,dims);
    await page.evaluate(()=>vesper.home());const state=await fetch(origin+'/api/state').then(r=>r.json());
    check('feedback journey ends muted without browser faults',state.mic.mode==='off'&&!state.device.capture&&!errors.length&&!(await page.evaluate(()=>vesper.errors.length)),errors);return;
  }
  await shot('title'); await button();
  check('fresh slot presents the six-page guide', await page.evaluate(()=>vesper.app.phase==='guide'&&vesper.app.guide===0));
  for(let n=0;n<6;n++){
    if(n===3){await page.keyboard.press('KeyK');await page.waitForFunction(()=>vesper.app.guide===2);
      check('generic case tap goes to the previous guide page',await page.evaluate(()=>vesper.app.guide===2));await button();await page.waitForTimeout(340);}
    await shot('guide-'+(n+1));await button();await page.waitForTimeout(340);
  }
  check('first-use guide enters ordinary play',await page.evaluate(()=>vesper.app.phase==='play'&&vesper.app.slot().guided));
  await page.waitForTimeout(2000); await shot('bowl-session'); await action('GAME GUIDE'); await button(800);
  check('guide action returns to genuine live play',await page.evaluate(()=>vesper.app.phase==='play'&&!vesper.menu));
  await action('END SESSION');await page.waitForTimeout(950);await shot('session-result');await setup();
  await choose('mode');await focus('line');await shot('line-approach');await choose('ride');
  const pilot = await page.evaluate(async()=>{
    const pause=ms=>new Promise(r=>setTimeout(r,ms));
    const key=type=>document.dispatchEvent(new KeyboardEvent(type,{code:'Space',key:' ',bubbles:true}));
    const events=[['D',0],['U',42],['D',48],['U',84],['D',90],['U',192]];
    for(const [edge,frame]of events){while(vesper.app.runTime<frame/60)await pause(4);key(edge==='D'?'keydown':'keyup');}
    await pause(1400);
    return {lineMet:vesper.app.lineMet,record:vesper.app.lineRecord(),lastBank:vesper.app.lastBank,stats:vesper.app.stats};
  });
  check('real button route banks FIRST FLIGHT and earns a per-line record',pilot.lineMet&&pilot.record.best>0&&pilot.record.medal>0&&pilot.record.time>0,pilot);
  await action('END SESSION');await page.waitForTimeout(950);await shot('line-result');
  const report=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=960;c.height=540;const g=c.getContext('2d'),words=[],write=g.fillText.bind(g);
    g.fillText=(s,x,y)=>{words.push(String(s));write(s,x,y);};vesper.app.draw(g);return {text:words.join(' '),record:vesper.app.lineRecord(),next:vesper.app.masteryGoal()};});
  check('line report renders its earned medal, PB, time and exact next mastery target',report.text.includes('MEDAL BRONZE')&&report.text.includes('LINE PB '+report.record.best.toLocaleString('en-US'))&&report.text.includes(report.record.time+'s')&&report.text.includes(report.next),report);
  await setup();await choose('mode');
  check('practice exposes ten options with selectable start and pace', await page.evaluate(()=>vesper.app.setupItems().length===10));
  await choose('start');await focus('back');await shot('practice-scrolled-setup');await page.keyboard.press('KeyK');
  await page.waitForFunction(()=>vesper.app.setupItems()[vesper.app.cursor].id==='guide');
  check('generic case reverse moves the setup highlight',await page.evaluate(()=>vesper.app.setupItems()[vesper.app.cursor].id==='guide'));
  await choose('ride');await page.waitForTimeout(1000);
  const rewards = () => page.evaluate(()=>{const s=vesper.app.slot();return JSON.stringify({runs:s.runs,goals:s.goals,best:s.best,bestCombo:s.bestCombo,last:s.last,styleBest:s.styleBest,lines:s.lines,lineBest:s.lineBest,lineComboBest:s.lineComboBest,lineMedals:s.lineMedals,lineTimeBest:s.lineTimeBest,medals:s.medals,clean:s.clean});});
  const baseline = await rewards();
  const cdp=await page.context().newCDPSession(page);
  for(let park=0;park<4;park++) {
    await setup();if(park){await choose('park');await choose('start');}
    await focus('line');
    for(let route=0;route<3;route++){
      await shot('route-'+park+'-'+route);
      const brief=await page.evaluate(()=>{
        const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;const g=canvas.getContext('2d'),calls=[],write=g.fillText.bind(g);
        g.fillText=(s,x,y)=>{if(x===608&&y>=230)calls.push(String(s));write(s,x,y);};vesper.app.draw(g);
        const rendered=calls.join(' ').replace(/\s+/g,' ');return {park:vesper.app.parkId,line:vesper.app.slot().line,full:vesper.app.challenge().approach.every(s=>rendered.includes(s.replace(/\s+/g,' ')))};
      });check('route'+park+'/'+route+' renders its entire approach',brief.full,brief);await choose('line');
    }
    await choose('ride');await page.waitForTimeout(900);
    const live=await page.evaluate(()=>({park:vesper.app.parkId,phase:vesper.app.phase,mode:vesper.app.mode,spawn:vesper.app.practiceLabel()}));
    check('park'+park+' starts its actual practice course',live.park===park&&live.phase==='play'&&live.mode===2,live);
    await shot('park-'+park+'-play');
    await action('RESET PRACTICE START');await page.waitForTimeout(750);await page.keyboard.press('KeyK');
    await page.waitForTimeout(180); const manual=await page.evaluate(()=>!!vesper.app.manual);
    if(manual)await shot('park-'+park+'-manual');
    check('park'+park+' flat school accepts a generic manual',manual);
    await button(400);await page.waitForTimeout(100);await shot('park-'+park+'-air');
    await action('RESET PRACTICE START');await page.waitForTimeout(750);
    await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
    await page.evaluate(()=>{const a=vesper.app,draw=a.draw;window.__hbDraw={samples:[],original:draw};
      a.draw=function(g){const start=performance.now();draw.call(this,g);if(__hbDraw.samples.length<600)__hbDraw.samples.push(performance.now()-start);};});
    const started=Date.now();await page.waitForFunction(()=>__hbDraw.samples.length>=600,null,{timeout:45000});
    const profile=await page.evaluate(()=>{const s=__hbDraw.samples.slice().sort((a,b)=>a-b);vesper.app.draw=__hbDraw.original;
      return {park:vesper.app.park().name,n:s.length,medianMs:s[300],p95Ms:s[570],maxMs:s[599],raf:vesper.frameStats()};});
    profile.wallSeconds=(Date.now()-started)/1000;profiles.push(profile);check('park'+park+' bounded 4x CPU canvas draw profile',profile.n===600&&profile.p95Ms<16.7,profile);
    await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
  }
  await action('PRACTICE PACE / NORMAL'); check('half-speed practice is available through the closing console action',await page.evaluate(()=>vesper.app.practiceSlow&&!vesper.menu));
  await page.waitForTimeout(900);await shot('pipe-half-speed');await action('LEAVE PRACTICE');await page.waitForTimeout(1000);await shot('practice-result');
  check('practice leaves rewards untouched',(await rewards())===baseline);
  await page.evaluate(()=>vesper.home());await page.waitForFunction(()=>!vesper.saves.status().pending);
  await page.reload();await page.waitForFunction(()=>window.vesper?.loaded);await page.evaluate(()=>vesper.launch('highbar'));
  check('reload retains chosen park, practice mode and earned guide state',await page.evaluate(()=>vesper.app.parkId===3&&vesper.app.mode===2&&vesper.app.slot().guided));
  const dims=await page.evaluate(()=>({width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight}));
  check('all screens fit1024x600',dims.width<=1024&&dims.height<=600,dims);
  await page.evaluate(()=>vesper.home());const state=await fetch(origin+'/api/state').then(r=>r.json());
  check('journey ends muted with no page/host faults',state.mic.mode==='off'&&!state.device.capture&&!errors.length&&!(await page.evaluate(()=>vesper.errors.length)),errors);
})().catch(e=>{check('complete renderer browser journey',false,String(e.stack||e));console.error(logs.slice(-1200));})
.finally(async()=>{await browser?.close().catch(()=>{});await require('./browser-cleanup.cjs')(server,data);
  fs.writeFileSync(path.join(output,'highbar-refresh-browser.json'),JSON.stringify({evidence:'Windows browser/synthetic inputs/private seeded career; no Pi/physical acceptance',rendererSha256:require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root,'web/apps/highbar-view.js'))).digest('hex'),results,profiles},null,2)+'\n');
  if(results.some(r=>!r.ok))process.exitCode=1;});
