import test from "node:test";
import assert from "node:assert/strict";
import { OrbitLock } from "../web/apps/orbit.js";
import { Moonrunner } from "../web/apps/runner.js";
import { Undertow } from "../web/apps/undertow.js";
import { EchoVault } from "../web/apps/echo.js";
import { GlyphVault } from "../web/apps/glyphs.js";
import { LightTrial } from "../web/apps/reaction.js";
import { Perihelion } from "../web/apps/perihelion.js";
import { Outpost } from "../web/apps/outpost.js";
import { Meridian } from "../web/apps/meridian.js";
import { Relay } from "../web/apps/relay.js";
import { Ballista } from "../web/apps/ballista.js";
import { Ricochet } from "../web/apps/ricochet.js";
import { appContext, run, fakeCanvas } from "./helpers/app-context.mjs";
const games = [OrbitLock, Moonrunner, Undertow, EchoVault, GlyphVault, LightTrial, Perihelion, Outpost, Meridian, Relay, Ballista, Ricochet];
const mount = (Factory, opts={}) => { const ctx=appContext({lampCount:4, boardLed:true, settings:{tapMode:"generic"},...opts});return {ctx,g:new Factory(ctx)}; };
const press = g => { g.down({source:"keyboard"}); g.up({durationMs:60,source:"keyboard"}); };
const begin = g => { press(g); while(g.phase === "intro") press(g); };
const bytes = v => v.every(x=>Number.isInteger(x)&&x>=0&&x<=255);
for(const F of games) for(const n of [3,4]) test(`${F.name}: ${n} lamps, generic input, render and board cleanup`,()=>{
 const {ctx,g}=mount(F,{lampCount:n}); g.knock({side:"unknown"});g.draw(fakeCanvas()); press(g);run(g,0.3);g.knock({side:"back"});g.draw(fakeCanvas());run(g,0.2);
 assert.ok(ctx.calls.leds.every(v=>(v.length===n*3 || n===4&&v.length===9&&v.every(x=>x===0))&&bytes(v)),JSON.stringify(ctx.calls.leds.map(v=>v.length)));
 assert.ok(ctx.calls.board.every(v=>v.length===3&&bytes(v)));
 g.cancel();g.pause();g.dispose();
 assert.ok(ctx.calls.leds.at(-1).every(x=>x===0));assert.deepEqual(ctx.calls.board.at(-1),[0,0,0]);
});

test("Undertow survey identifies a contact without altering physics, scan credit, pearls or daily RNG",()=>{
 const {g,ctx}=mount(Undertow);begin(g);g.life=[{id:"moon",x:600,y:200,ph:0,scan:0,done:false,fl:0,vx:0}];
 const before=[g.y,g.vy,g.held,g.parked,g.points,g.dstate,g.lstate,JSON.stringify(g.R),JSON.stringify(g.life)];
 g.knock();assert.equal(g.survey.id,"moon");assert.match(g.note,/MOON JELLY/);
 assert.deepEqual([g.y,g.vy,g.held,g.parked,g.points,g.dstate,g.lstate,JSON.stringify(g.R),JSON.stringify(g.life)],before);
 const tones=ctx.calls.tone.length;g.knock();assert.equal(ctx.calls.tone.length,tones,"bounded cooldown");
 const painted=[]; const c=fakeCanvas();c.fillText=s=>painted.push(s);g.draw(c);assert.ok(painted.includes("MOON JELLY"));
 run(g,2.1);g.knock();assert.ok(ctx.calls.tone.length>tones);
});
test("Undertow button-only survey menu action is the same action",()=>{
 const {g}=mount(Undertow);begin(g);const actions=g.menuActions();assert.equal(actions.length,1);actions[0].run();assert.match(g.note,/NO UNLOGGED CONTACT/);
});
test("Echo case replay pays the existing one-second cost, is bounded and never keys an element",()=>{
 const {g}=mount(EchoVault);begin(g);g.kind="echo";g.stage="send";g.left=10;const pts=g.run.points,input=g.input;
 g.knock();assert.equal(g.left,9);assert.equal(g.stage,"listen");assert.equal(g.run.points,pts);assert.equal(g.input,input);
 g.knock();assert.equal(g.left,9);g.t+=0.61;g.knock();assert.equal(g.left,8);
 g.down();g.knock();assert.equal(g.left,8,"never interrupts a keyed element");g.up({durationMs:60});
});
test("Ricochet generic tap reverses despite any side label; sides optionally set direction",()=>{
 for(const side of [undefined,"left","right","back","unknown"]){const {g}=mount(Ricochet);g.begin();g.dir=1;g.knock({side});assert.equal(g.dir,-1);assert.equal(g.pressing,false);assert.ok(g.turnT>0);}
 const {g}=mount(Ricochet,{settings:{tapMode:"sides"}});g.begin();g.knock({side:"left"});assert.equal(g.dir,-1);g.knock({side:"right"});assert.equal(g.dir,1);g.knock({side:"unknown"});assert.equal(g.dir,-1);
 g.down();const d=g.dir;g.knock();assert.equal(g.dir,d,"no delayed tap while held/frozen");g.up();
});
test("Ricochet upgrade navigation never takes an upgrade without a button hold",()=>{
 const {g}=mount(Ricochet);g.begin();g.sub="pick";g.offer={cur:0,t:1,ids:["wide","slow"]};const mods=structuredClone(g.mods);g.knock();assert.equal(g.offer.cur,1);assert.deepEqual(g.mods,mods);assert.equal(g.pressing,false);
});
test("Ricochet delayed case turn still requires actual paddle interception",()=>{
 const {g}=mount(Ricochet);g.begin();run(g,1.3);const points=g.points,lives=g.lives;run(g,0.1);g.knock();run(g,0.5);
 assert.equal(g.points,points,"turn never awards contact points");assert.equal(g.lives,lives);assert.equal(g.sub,"live");assert.ok(g.balls[0].y>0);
});
test("Outpost case gathering retains its normal gain/cooldown and never makes a purchase",()=>{
 const {g}=mount(Outpost);g.knock();assert.equal(g.phase_,"play");const b=g.s.sig;g.knock();assert.ok(g.s.sig>b);const twin=mount(Outpost).g;press(twin);press(twin);assert.equal(g.s.sig,twin.s.sig);for(let i=0;i<12;i++){g.knock();press(twin);}assert.equal(g.s.sig,twin.s.sig,"case inputs retain the same bounded gathering reserve");
 g.panel={page:0};g.knock();assert.equal(g.panel.page,2);g.panel=null;g.openRing("tree");const before=structuredClone(g.s);g.knock();assert.deepEqual(g.s,before);
});
test("generic case menus move previous, optional right moves next, guides stay open",()=>{
 for(const [F,open,field] of [[Moonrunner,"openDepot","cur"],[Undertow,"openDock","cur"],[Perihelion,"openHangar","cur"],[Ballista,"openShop","cur"],[Meridian,"openMenu","cur"],[Relay,"openMenu","cur"]]){
  const {g,ctx}=mount(F);g[open]();g[field]=1;g.knock({side:"right"});assert.equal(g[field],0,F.name);ctx.settings().tapMode="sides";g.knock({side:"right"});assert.equal(g[field],1,F.name);
 }
 for(const [F,view] of [[Perihelion,"guide"],[Meridian,"guide"],[Relay,"book"]]){const {g}=mount(F);g.phase=F===Perihelion?"hangar":"menu";g.view=view;g.page=1;g.knock();assert.equal(g.page,0);assert.equal(g.view,view);}
});
test("precision games do not accept acoustic tap as a judged action or change node ownership",()=>{
 for(const F of [OrbitLock,Meridian,Relay,GlyphVault]){const {g,ctx}=mount(F);begin(g);const before=ctx.calls.score.length;const score=g.points??g.score??g.run?.points;g.knock();assert.equal(ctx.calls.score.length,before);assert.equal(g.points??g.score??g.run?.points,score);}
 const {g,ctx}=mount(LightTrial);g.knock();assert.equal(g.phase,"title");assert.equal(ctx.calls.command.length,0);g.down({source:"node"});assert.equal(g.phase,"wait");const before=structuredClone(ctx.calls);g.knock();run(g,0.2);assert.deepEqual(ctx.calls.command,before.command);assert.deepEqual(ctx.calls.leds,before.leds);assert.deepEqual(ctx.calls.board,before.board);assert.equal(g.phase,"wait");
});

test("case taps while a menu selection is held cannot change the highlighted choice",()=>{
 for(const [F,open] of [[Moonrunner,"openDepot"],[Undertow,"openDock"],[Perihelion,"openHangar"],[Ballista,"openShop"],[Meridian,"openMenu"],[Relay,"openMenu"]]){
  const {g}=mount(F);g[open]();const c=g.cur;g.down();g.knock();assert.equal(g.cur,c,F.name);g.up({durationMs:60});
 }
});
