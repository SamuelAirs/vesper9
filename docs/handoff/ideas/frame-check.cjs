const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const file = process.argv[2]; const throttle = +process.argv[3]||4;
const apps = (process.argv[4]||'orbit,runner,perihelion,ballista,tideline,outpost').split(',');
(async()=>{
 const b = await chromium.launch({headless:true,args:['--no-sandbox','--mute-audio','--disable-gpu']});
 const p = await b.newPage({viewport:{width:1024,height:600}});
 const cdp = await p.context().newCDPSession(p);
 await p.goto('file://'+file); await p.waitForTimeout(1500);
 await cdp.send('Emulation.setCPUThrottlingRate',{rate:throttle});
 // dashboard idle
 for (const id of apps){
  const ok = await p.evaluate(id=>{try{vesper.launch(id);return !!vesper.app}catch(e){return String(e)}},id);
  if(ok!==true){console.log(id,'skip',ok);continue;}
  await p.waitForTimeout(800);
  await p.evaluate(()=>{vesper.softwareButton(true);setTimeout(()=>vesper.softwareButton(false),80)});
  await p.waitForTimeout(700);
  const r = await p.evaluate(async()=>{
   const a=vesper.app; const d=[],u=[]; const od=a.draw.bind(a), ou=a.update?.bind(a);
   a.draw=g=>{const t=performance.now();od(g);d.push(performance.now()-t)};
   if(ou)a.update=dt=>{const t=performance.now();ou(dt);u.push(performance.now()-t)};
   vesper.frameTimes.length=0;
   // tap occasionally to keep games alive
   for(let i=0;i<6;i++){vesper.softwareButton(true);await new Promise(r=>setTimeout(r,90));vesper.softwareButton(false);await new Promise(r=>setTimeout(r,400));}
   const s=x=>{x=x.slice().sort((a,b)=>a-b);return [x[x.length>>1]||0,x[Math.floor(x.length*.95)]||0].map(v=>+v.toFixed(2))};
   const f=vesper.frameStats();
   const ft=vesper.frameTimes;return {long:ft.filter(x=>x>20).length+'/'+ft.length,draw:s(d),update:s(u),frame:[+f.medianMs.toFixed(1),+f.p95Ms.toFixed(1)],errors:vesper.errors.length};
  });
  console.log(id.padEnd(11),JSON.stringify(r));
 }
 await p.evaluate(()=>vesper.home()); await p.waitForTimeout(500);
 await p.evaluate(()=>vesper.frameTimes.length=0); await p.waitForTimeout(3000);
 console.log('dashboard', JSON.stringify(await p.evaluate(()=>vesper.frameStats())));
 await b.close();
})();
