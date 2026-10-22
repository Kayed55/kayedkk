'use strict';
const vm = require('node:vm');
const fs = require('node:fs');
const assert = require('node:assert/strict');
function fixture() {
  let read = async () => ({data:[], error:null});
  const timers=[], intervals=[], navigations=[];
  const window={addEventListener(){}, getSessionToken:()=> 'test', sb:{
    from(table){return {select(){return this;},order(){return this;},range(){return read(table);}};},
    rpc:async()=>({data:[],error:null})
  }};
  window.secureRead=window.sb.from;
  const ctx={window,DB:{data:{},_persist(){}},localStorage:{getItem(){return null;},setItem(){}},navigator:{}, console:{log(){},warn(){},error(){}},setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){},setInterval:fn=>intervals.push(fn),currentPage:'evaluations',currentParams:{dept:2},navigate:(...args)=>navigations.push(args),_formDirty:false};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync('public/js/00-supabase-sync.js','utf8'),ctx);
  return {ctx,sync:window.SupabaseSync,setRead(fn){read=fn;},timers,intervals,navigations};
}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
async function overlap(table) {
  const f=fixture(), blocked=deferred(), reached=deferred();let first=true, usersReads=0;
  f.setRead(async name=>{
    if(name==='evaluations'&&first){first=false;reached.resolve();return blocked.promise;}
    return {data:[{id:name==='users_public'?(++usersReads===1?15:20):30}],error:null};
  });
  const full=f.sync.pullAll(true);await reached.promise;
  await f.sync.pullTable(table);
  blocked.resolve({data:[{id:10}],error:null});await full;
  assert.equal(f.ctx.DB.data.evaluations[0].id,table==='evaluations'?30:10);
  assert.equal(f.ctx.DB.data.users[0].id,table==='users'?20:15);
}
(async()=>{
  await overlap('users');await overlap('evaluations');
  const f=fixture(),blocked=deferred(), reached=deferred();let first=true;
  f.setRead(async name=>{if(name==='evaluations'&&first){first=false;reached.resolve();return blocked.promise;}return {data:[{id:2}],error:null};});
  const old=f.sync.pullAll(true);await reached.promise;await f.sync.pullAll(true);
  blocked.resolve({data:[{id:1}],error:null});await old;
  assert.equal(f.ctx.DB.data.evaluations[0].id,2);
  const g=fixture(), gate=deferred();g.setRead(()=>gate.promise);
  const pending=g.sync.pullAll(true);g.sync._appliedSeq=++g.sync._pullSeq;g.sync.suspended=true;
  gate.resolve({data:[{id:99}],error:null});await pending;
  assert.equal(g.ctx.DB.data.evaluations,undefined);
  const h=fixture();h.sync.startAutoSync();h.sync.pullAll=async()=>true;
  await h.intervals[0]();h.timers.pop()();assert.equal(h.navigations.length,1);
  h.ctx._formDirty=true;await h.intervals[0]();h.timers.pop()();assert.equal(h.navigations.length,1);
  h.sync.pullAll=async()=>false;await h.intervals[0]();assert.equal(h.timers.length,0);
  console.log('PASS: per-table races, overlapping full pulls, logout barrier, autosync refresh and dirty form protection');
})().catch(e=>{console.error(e);process.exitCode=1;});
