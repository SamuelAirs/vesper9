/* Install the documented example into an isolated copy and exercise both hosts. */
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn,execFileSync}=require('node:child_process');const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const root=path.resolve(__dirname,'..'),copy=fs.mkdtempSync(path.join(os.tmpdir(),'vesper-extension-'));
const python=process.env.PYTHON||'python3';const port=require('./free-port.cjs')(),origin='http://127.0.0.1:'+port;let server,browser,logs='';
(async()=>{
 for(const dir of ['web','vesper','scripts','examples'])fs.cpSync(path.join(root,dir),path.join(copy,dir),{recursive:true,filter:p=>!p.includes('__pycache__')});
 fs.copyFileSync(path.join(copy,'examples/pulse-app.js'),path.join(copy,'web/apps/pulse-app.js'));
 const catalogPath=path.join(copy,'vesper/catalog.json'),catalog=JSON.parse(fs.readFileSync(catalogPath));
 catalog.apps.push({id:'garden',name:'PULSE GARDEN',subtitle:'Plant signals.',description:'An ambient instrument.',controls:'PRESS TO PLANT',category:'EXPANSION / AMBIENT',glyph:4,factory:'PulseGarden',escape:'adaptive',voice:['garden'],capabilities:['button','lights','audio','progress']});
 fs.writeFileSync(catalogPath,JSON.stringify(catalog));
 const registry=path.join(copy,'web/apps/registry.js');
 fs.writeFileSync(registry,'import { PulseGarden } from "./pulse-app.js";\n'+fs.readFileSync(registry,'utf8').replace('const FACTORIES = {','const FACTORIES = { PulseGarden,'));
 execFileSync(python,['scripts/build-demo.py'],{cwd:copy});
 execFileSync(python,['-c',"from vesper.catalog import APP_IDS; from vesper.speech import COMMANDS; assert 'garden' in APP_IDS; assert COMMANDS['computer open garden']['app']=='garden'"],{cwd:copy});
 server=spawn(python,['-m','vesper.server','--simulate','--http-port',String(port),'--data',path.join(copy,'data')],{cwd:copy});server.stderr.on('data',d=>logs+=d);
 for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/state')).ok)break;}catch{}if(i===99)throw Error('Extension server did not start');await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({headless:true,executablePath:process.env.TEST_BROWSER_BIN||undefined,args:['--no-sandbox','--disable-gpu','--mute-audio']});
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const url of [origin,'file://'+path.join(copy,'VESPER-9-Simulator.html')]){
  await page.goto(url);await page.waitForFunction(()=>vesper.loaded);
  await page.evaluate(()=>{vesper.page=2;vesper.buildHome();});
  assert.equal(await page.locator('.app-card').count(),1);
  await page.keyboard.down('Space');await page.waitForTimeout(760);await page.keyboard.up('Space');
  await page.waitForFunction(()=>vesper.meta?.id==='garden');
  await page.keyboard.down('Space');await page.waitForTimeout(60);await page.keyboard.up('Space');
  await page.waitForFunction(()=>vesper.app.count===1);
  await page.evaluate(()=>vesper.home());await page.waitForFunction(()=>vesper.state.leds.every(n=>n===0));
  await page.evaluate(()=>vesper.launch('garden'));assert.equal(await page.evaluate(()=>vesper.app.count),1);
  assert.deepEqual(await page.evaluate(()=>vesper.errors),[]);
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,cartridge:'garden',catalog:true,voiceAlias:true,buttonLaunch:true,progress:true,service:true,standalone:true}));
})().catch(e=>{console.error(e);console.error(logs.slice(-2000));process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(server)server.kill('SIGTERM');fs.rmSync(copy,{recursive:true,force:true});});
