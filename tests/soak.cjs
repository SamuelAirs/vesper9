/* Bounded integrated service/browser soak. No hardware or personal data. */
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const port=require('./free-port.cjs')(),origin='http://127.0.0.1:'+port;
const root=path.resolve(__dirname,'..'), seconds=Number(process.env.SOAK_SECONDS||1200);
const output=process.env.TEST_OUTPUT||path.join(root,'test-output'), data=fs.mkdtempSync(path.join(os.tmpdir(),'vesper-soak-'));
fs.mkdirSync(output,{recursive:true});
const server=spawn(process.env.PYTHON||'python3',['-m','vesper.server','--simulate','--http-port',String(port),'--data',data],{cwd:root});
let logs='',browser;server.stderr.on('data',d=>logs+=d);server.stdout.on('data',d=>logs+=d);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
// Some development containers expose a /proc mount from a different PID namespace.
// Never report a different process's RSS as the Python service's memory.
const procMatches=(()=>{try{return Number(/^Pid:\s+(\d+)/m.exec(fs.readFileSync('/proc/self/status','utf8'))?.[1])===process.pid;}catch{return false;}})();
(async()=>{
 for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/state')).ok)break;}catch{}if(i===99)throw Error('Server did not start');await pause(100);}
 browser=await chromium.launch({headless:true,executablePath:process.env.TEST_BROWSER_BIN||undefined,args:['--no-sandbox','--disable-gpu','--mute-audio','--autoplay-policy=no-user-gesture-required']});
 const page=await browser.newPage({viewport:{width:1280,height:720}}), errors=[],samples=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin);await page.waitForFunction(()=>vesper.loaded);
 const build=await page.evaluate(()=>vesper.state.build), startedUtc=new Date().toISOString();
 await page.evaluate(async()=>{await vesper.bridge.command('settings',{key:'sound',value:false});await vesper.bridge.command('timer',{op:'create',seconds:15,label:'SOAK TIMER'});vesper.launch('runner');});
 let speech=null;
 if(process.env.SOAK_WAV){
  const wav=fs.readFileSync(process.env.SOAK_WAV);let at=12,pcm;
  while(at+8<=wav.length){const n=wav.readUInt32LE(at+4);if(wav.toString('ascii',at,at+4)==='data'){pcm=wav.subarray(at+8,at+8+n);break;}at+=8+n+(n%2);}
  assert.ok(pcm);
  await page.evaluate(async b64=>{
   await vesper.bridge.command('mic',{mode:'transcribe'});
   const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
   for(let i=0;i<bytes.length;i+=640){vesper.bridge.sendAudio(bytes.slice(i,i+640));await new Promise(r=>setTimeout(r,20));}
   await new Promise(r=>setTimeout(r,400));await vesper.bridge.command('mic',{mode:'off'});
  },pcm.toString('base64'));
  speech=await page.evaluate(async()=>({state:(await vesper.bridge.get('state')).mic,sessions:await vesper.bridge.get('sessions')}));
  assert.equal(speech.state.mode,'off');assert.equal(speech.state.droppedChunks,0);assert.ok(speech.sessions[0]?.lines>0);
 }
 // Read the current registry: the old fixed twelve-app rotation omitted the
 // newer games and readers, so even a long run never exercised their lifetimes.
 const apps=await page.evaluate(async()=>{
  const {APPS}=await import('/apps/registry.js');
  return ['highbar','twinbeat','wayfinder',...APPS.map(app=>app.id)].filter((id,index,all)=>all.indexOf(id)===index);
 });
 const started=Date.now(), visited=new Set();
 let cycle=-1,reconnected=false, strokes=0;
 while(Date.now()-started<seconds*1000){
  const elapsed=(Date.now()-started)/1000,next=Math.floor(elapsed/20);
  if(next!==cycle){
   cycle=next;const id=apps[cycle%apps.length];visited.add(id);
   await page.evaluate(id=>vesper.launch(id),id);
   // Several current cartridges select their first canvas row with a hold.
   // Exercise actual input rather than leaving those games on their title.
   if(['twinbeat','wayfinder','crawlspace','supper','nightgrid','pocketlinks'].includes(id)){
    await page.evaluate(()=>vesper.softwareButton(true));await pause(800);
    await page.evaluate(()=>vesper.softwareButton(false));
   }
  }
  if(elapsed>seconds/2&&!reconnected){
   reconnected=true;await page.evaluate(()=>{vesper.bridge.ws.close();});
   await page.waitForFunction(()=>vesper.bridge.connected&&vesper.state.controller!==false&&vesper.state.device.connected);
   await page.evaluate(()=>vesper.closeMenu());
  }
  await page.evaluate(()=>{if(vesper.inputMode()==='raw')vesper.softwareButton(true);});
  await pause(cycle%2?220:70);
  await page.evaluate(()=>vesper.softwareButton(false));
  if(++strokes%3===0)await page.evaluate(()=>{if(vesper.inputMode()==='raw')vesper.softwareKnock();});
  const sample=await page.evaluate(()=>({app:vesper.meta?.id,phase:vesper.app?.phase||vesper.app?.phase_||null,frames:vesper.frameStats(),errors:vesper.errors.slice(),pending:vesper.bridge.pending.size,mic:vesper.state.mic.mode,heap:performance.memory?.usedJSHeapSize||null}));
  if(!samples.length||elapsed-samples.at(-1).elapsed>=15){
   let rss=null;try{if(procMatches)rss=Number(/VmRSS:\s+(\d+)/.exec(fs.readFileSync('/proc/'+server.pid+'/status','utf8'))?.[1])||null;}catch{}
   samples.push({elapsed:Math.round(elapsed),...sample,pythonRssKiB:rss});
   fs.writeFileSync(path.join(output,'soak-progress.json'),JSON.stringify({startedUtc,build,elapsed:Math.round(elapsed),visitedApps:[...visited],sample:samples.at(-1)},null,2));
  }
  assert.deepEqual(sample.errors,[]);assert.deepEqual(errors,[]);assert.ok(sample.pending<10);assert.equal(sample.mic,'off');
  await pause(900);
 }
 await page.evaluate(()=>vesper.home());await page.waitForFunction(()=>vesper.state.leds.every(n=>n===0));
 const state=await page.evaluate(()=>vesper.bridge.get('state'));
 assert.equal(state.mic.mode,'off');assert.equal(state.device.capture,false);assert.equal(state.timers[0].finished,true);
 if(seconds>=apps.length*20)assert.equal(visited.size,apps.length,'a complete-duration soak must visit every current cartridge');
 const result={passed:true,scope:'Development-host simulated node; not Pi/hardware',startedUtc,build,browser:await browser.version(),durationSeconds:(Date.now()-started)/1000,registeredApps:apps,visitedApps:[...visited],reconnected,recordedSpeech:speech?{passed:true,savedLines:speech.sessions[0].lines,droppedChunks:speech.state.droppedChunks}:null,timerCompleted:true,endsMuted:true,samples,pageErrors:errors};
 fs.writeFileSync(path.join(output,'soak-results.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify({passed:true,durationSeconds:result.durationSeconds,samples:samples.length,recordedSpeech:result.recordedSpeech,endsMuted:true}));
})().catch(e=>{console.error(e);console.error(logs.slice(-1800));process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();await require('./browser-cleanup.cjs')(server,data);});
