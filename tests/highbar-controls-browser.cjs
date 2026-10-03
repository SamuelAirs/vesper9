/* Windows-local real keyboard control witnesses. One private loopback service and one page.
   Careers are seeded unlocked; rider/velocity/score/physics states are never injected. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn,execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'), output=path.resolve(process.env.TEST_OUTPUT || path.join(root,'test-output/highbar-controls'));fs.mkdirSync(output,{recursive:true});
// Optional bounded follow-up, e.g. TEST_PARKS=2 for the zero-based Tower park.
// Core control checks remain enabled; the default still visits all four parks.
const parks=process.env.TEST_PARKS ? [...new Set(process.env.TEST_PARKS.trim().split(/[\s,]+/).map(Number))] : [0,1,2,3];
if(!parks.length||parks.some(n=>!Number.isInteger(n)||n<0||n>3))throw Error('TEST_PARKS must contain zero-based park indices 0–3');
const {chromium}=require(process.env.PLAYWRIGHT_PATH || 'playwright'), python=process.env.PYTHON || 'python3';
const data=fs.mkdtempSync(path.join(os.tmpdir(),'vesper-controls-')),port=require(root+'/tests/free-port.cjs')(),origin='http://127.0.0.1:'+port;
execFileSync(python,['-c',"from vesper.storage import Store\nimport sys\ns=Store(sys.argv[1]);s.put('progress',{'highbar':{'schema':5,'slot':0,'slots':[{'scoreVersion':'flow-v5','guided':True,'mode':2,'goals':[[0,1,2],[0,1,2],[0,1,2],[0,1,2]]}]}});s.close()",data],{cwd:root,windowsHide:true});
const server=spawn(python,['-m','vesper.server','--simulate','--http-port',String(port),'--data',data],{cwd:root,windowsHide:true});let logs='',browser,page;server.stdout.on('data',d=>logs+=d);server.stderr.on('data',d=>logs+=d);
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),results=[],pilots=[],errors=[];
const assetHashes=Object.fromEntries(['highbar.js','highbar-content.js','highbar-view.js'].map(name=>[name,require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root,'web/apps',name))).digest('hex')]));
const check=(name,ok,detail)=>{results.push({name,ok:!!ok,detail});console.log((ok?'PASS ':'FAIL ')+name+' '+JSON.stringify(detail));};
(async()=>{
 for(let i=0;;i++){try{if((await fetch(origin+'/api/state')).ok)break;}catch{}if(i>100)throw Error(logs);await sleep(100);}
 browser=await chromium.launch({headless:true,executablePath:process.env.TEST_BROWSER_BIN || undefined,args:['--mute-audio','--disable-gpu']});
 page=await browser.newPage({viewport:{width:1024,height:600}});page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);await page.waitForFunction(()=>vesper?.loaded);
 await page.evaluate(()=>vesper.launch('highbar'));
 const shot=async name=>page.screenshot({path:path.join(output,name+'.png')});
 const action=async label=>{await page.keyboard.press('Escape');await page.getByRole('button',{name:label,exact:true}).click();await page.waitForFunction(()=>!vesper.menu);};
 const down=async()=>{await page.keyboard.down('Space');await page.waitForFunction(()=>vesper.app.pressed);};
 const up=async()=>{await page.keyboard.up('Space');await page.waitForFunction(()=>!vesper.app.pressed);};
 const button=async ms=>{await down();await page.waitForTimeout(ms);await up();};
 const sample=()=>page.evaluate(()=>{const a=vesper.app,g=document.createElement('canvas').getContext('2d'),words=[],rects=[];const fill=g.fillRect.bind(g);
  g.fillText=s=>words.push(String(s));g.fillRect=(x,y,w,h)=>{if(w>=200&&h>=30)rects.push([x,y,w,h]);fill(x,y,w,h);};a.drawCoach(g);a.drawCombo(g);a.drawRouteCue(g);
  return {mode:a.p.mode,position:[a.p.x,a.p.y],height:a.park().floor-a.p.y,support:a.p.support,pressed:a.pressed,action:a.pressAction,tuck:a.p.tuck,style:a.air?.style,words,coverage:rects.reduce((n,q)=>n+q[2]*q[3],0)/(960*540),marker:a.barMarker(),stats:a.stats,lamps:a.restingLamps(),camera:[a.camX,a.camY]};});
 const reset=async()=>{await action('RESET PRACTICE START');await page.waitForFunction(()=>vesper.app.resumeT===0);};
 await shot('title');await action('FLAT SCHOOL');await page.waitForFunction(()=>vesper.app.resumeT===0);await shot('flat-ground');
 const before=await sample();await page.keyboard.press('KeyK');await page.waitForTimeout(180);const noManual=await sample();
 check('actual generic ground case is inert',noManual.mode==='ground'&&!noManual.style&&!noManual.words.some(s=>/MANUAL/.test(s)),noManual);
 await reset();await button(60);await page.waitForFunction(()=>vesper.app.p.mode==='air');await down();await page.waitForFunction(()=>vesper.app.p.tuck);await shot('button-second-hold-flip');const flip=await sample();check('actual quick tap then second hold flips',flip.action==='flip'&&flip.tuck,flip);await up();await page.waitForFunction(()=>!vesper.app.p.tuck);
 await reset();await down();await page.waitForTimeout(350);const push=await sample();await up();await page.waitForFunction(()=>vesper.app.p.mode==='air');await down();await page.waitForTimeout(80);const plain=await sample();check('long ground push then plain air hold does not flip',push.action==='skate'&&!plain.tuck&&plain.action!=='flip',plain);await up();
 await reset();await button(300);await page.waitForFunction(()=>vesper.app.air?.t>.11);await page.keyboard.press('KeyK');await page.waitForFunction(()=>vesper.app.air?.style?.kind==='shove');await page.waitForTimeout(135);await page.keyboard.press('KeyK');await page.waitForFunction(()=>vesper.app.air?.style?.kind==='kickflip');await shot('case-double-kickflip');const kick=await sample();check('actual generic case double tap upgrades kickflip',kick.style.kind==='kickflip',kick);
 await page.waitForFunction(()=>vesper.app.p.mode==='ground',null,{timeout:5000});const landed=await page.evaluate(()=>structuredClone(vesper.app.combo));await page.waitForFunction(()=>vesper.app.stats.banks>0,null,{timeout:5000});const bank=await page.evaluate(()=>vesper.app.lastBank);check('actual kickflip lands and banks without shove duplicate',landed.tricks.some(t=>t.name==='KICKFLIP')&&!landed.tricks.some(t=>t.name==='SHOVE-IT'),{landed,bank});await shot('kickflip-bank');
 await reset();await button(60);await page.waitForFunction(()=>vesper.app.p.mode==='air');await page.keyboard.press('Escape');await page.waitForFunction(()=>!!vesper.menu);await page.keyboard.press('Escape');await page.waitForFunction(()=>!vesper.menu&&vesper.app.resumeT===0);await down();const resumed=await sample();check('actual menu pause clears quick-tap flip intent',!resumed.tuck&&resumed.action!=='flip',resumed);await up();
 // Actual public menu/setup controls select every park; a state-aware keyboard pilot skates/catches/releases.
 for(const park of parks){
  await action('CHANGE PRACTICE START');
  const focus=async id=>{for(let i=0;await page.evaluate(id=>vesper.app.setupItems()[vesper.app.cursor].id!==id,id);i++){if(i>20)throw Error('focus '+id);await button(55);await page.waitForTimeout(300);}};
  await focus('park');while(await page.evaluate(()=>vesper.app.parkId)!==park){await button(650);await page.waitForTimeout(350);}
  await shot('park-'+park+'-deck-map');await focus('start');while(await page.evaluate(()=>vesper.app.practiceStart)!==0){await button(650);await page.waitForTimeout(350);}
  await focus('ride');await button(650);await page.waitForFunction(()=>vesper.app.phase==='play');await shot('park-'+park+'-deck-world');
  const flight=page.evaluate(async()=>{const a=vesper.app,start=a.runTime,sleep=ms=>new Promise(r=>setTimeout(r,ms));let held=false,pressedAt=0,releasedAt=-5,lastBar=-1,seen=[],decks=[],maxHeight=0;
   const send=value=>{document.dispatchEvent(new KeyboardEvent(value?'keydown':'keyup',{code:'Space',key:' ',bubbles:true}));held=value;if(value)pressedAt=a.runTime;else releasedAt=a.runTime;};
   while(a.runTime-start<14&&a.phase==='play'){const p=a.p;maxHeight=Math.max(maxHeight,a.park().floor-p.y);if(p.support&&!decks.includes(p.support))decks.push(p.support);
    if(p.mode==='bar'&&!seen.includes(p.bar))seen.push(p.bar);let want=held;
    if(p.mode==='ground')want=a.combo.roll>=0?held:(held?a.runTime-pressedAt<.75:true);
    else if(p.mode==='bar')want=!(p.held>.25&&p.vy<-Math.min(220,p.r*2));
    else if(p.mode==='air')want=!!a.pending||(a.pickBar()>=0&&(!a.lastButtonTap||a.t-a.lastButtonTap.at>.33));
    else want=false;
    if(want!==held)send(want);await sleep(45);
   }if(held)send(false);return {park:a.parkId,seen,decks,maxHeight,stats:structuredClone(a.stats),position:[a.p.x,a.p.y],evidence:'real-time DOM keyboard edges, observed state only; no rider mutation'};
  });
  try{await page.waitForFunction(()=>vesper.app.p.mode==='bar'&&vesper.app.p.held>.08,null,{timeout:16000});await shot('park-'+park+'-held-web');
   const held=await sample();check('park '+park+' actual qualified hold catches a web',held.mode==='bar'&&held.pressed,held);
   await page.waitForFunction(()=>vesper.app.p.mode==='air',null,{timeout:16000});await shot('park-'+park+'-released-web');
  }catch(e){check('park '+park+' held-web capture',false,String(e));}
  const witness=await flight;pilots.push(witness);check('park '+park+' real controls catch and travel',witness.seen.length>0&&witness.maxHeight>200,witness);
  const state=await sample();check('park '+park+' HUD under14percent',state.coverage<.14,state);await shot('park-'+park+'-actual-pilot');
 }
 await page.setViewportSize({width:960,height:540});await shot('compact-960x540');await page.evaluate(()=>vesper.home());const state=await fetch(origin+'/api/state').then(r=>r.json());check('ends muted and without page/host errors',!errors.length&&state.mic.mode==='off'&&!(await page.evaluate(()=>vesper.errors.length)),{errors,mic:state.mic.mode});
})().catch(e=>{check('journey exception',false,String(e.stack));process.exitCode=1;}).finally(async()=>{await browser?.close().catch(()=>{});await require(root+'/tests/browser-cleanup.cjs')(server,data);fs.writeFileSync(path.join(output,'highbar-controls-browser.json'),JSON.stringify({evidence:'Windows local Chrome one-page actual keyboard controls. Unlocked seeded career only; no Pi/device validation.',parks,rendererSha256:assetHashes['highbar-view.js'],assetHashes,results,pilots},null,2));if(results.some(q=>!q.ok))process.exitCode=1;});
