const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('public/js/05-app.js','utf8');
const boot = source.slice(source.indexOf('async function bootApp()'), source.indexOf('// تحديد الوجهة'));
async function checkBoot(token, ok, sdk=true) {
  const calls=[];
  const ctx={window:{sb:sdk?{}:null,getSessionToken:()=>token,SupabaseSync:{hookDBSave(){},pullAll:async()=>{calls.push('pull');return ok;}},showBootFailure:()=>calls.push('failure')},
    DB:{KEY:'test',init:()=>calls.push('init')},_IDB:{available:()=>true,remove:()=>new Promise(()=>{})},localStorage:{removeItem:()=>{}},
    _showBootOverlay:()=>calls.push('show'),_hideBootOverlay:()=>calls.push('hide'),routeInitial:()=>calls.push('route'),loadDepartments:()=>{},clearTimeout:()=>{},console:{warn:()=>{}}};
  vm.createContext(ctx);vm.runInContext(boot,ctx);
  await Promise.race([ctx.bootApp(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Boot blocked by IndexedDB')),100))]);
  return calls;
}
(async()=>{
 assert.deepEqual(await checkBoot(null,false),['show','init','route','hide']);
 assert.deepEqual(await checkBoot('token',true),['show','init','pull','route','hide']);
 assert.deepEqual(await checkBoot('token',false),['show','init','pull','failure']);
 assert.deepEqual(await checkBoot(null,false,false),['show','failure']);
 const scripts=[];let exports=0;const errors=[];
 const ctx={window:{exportListXLSX:()=>exports++},Toast:{error:e=>errors.push(e)},setTimeout,clearTimeout,Map,document:{createElement:()=>({remove(){}}),head:{appendChild:s=>scripts.push(s)}}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('public/js/lazy-exports.js','utf8'),ctx);
 assert.equal(scripts.length,0);
 const a=ctx.window.exportListXLSX(),b=ctx.window.exportListXLSX();
 assert.equal(scripts.length,1);ctx.window.XLSX={};scripts[0].onload();await Promise.all([a,b]);assert.equal(exports,2);
 delete ctx.window.XLSX;
 // New context models a failed initial download, followed by a retry.
 const retryCtx={...ctx,window:{exportListXLSX:()=>exports++}};vm.createContext(retryCtx);vm.runInContext(fs.readFileSync('public/js/lazy-exports.js','utf8'),retryCtx);
 const c=retryCtx.window.exportListXLSX();scripts.at(-1).onerror();await c;assert.equal(errors.length,1);
 const d=retryCtx.window.exportListXLSX();retryCtx.window.XLSX={};scripts.at(-1).onload();await d;assert.equal(exports,3);
 const html=fs.readFileSync('public/index.html','utf8');
 for(const m of html.matchAll(/<script([^>]+)src="([^"]+)"/g)){assert.match(m[1],/defer/);assert.ok(m[2].startsWith('/'));}
 assert.ok(!html.includes('xlsx-0.18.5.js'));
 console.log('PASS: immediate login, blocked storage, authenticated boot, fail-closed startup, lazy exports, concurrent loading and retry');
})().catch(e=>{console.error(e);process.exitCode=1;});
