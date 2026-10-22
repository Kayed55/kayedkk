'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const calls=[];let token='session',rows=[{id:2}],rpcError=null;
const ctx={window:{getSessionToken:()=>token,sb:{rpc:async(name,args)=>{calls.push({name,args});return {data:rows,error:rpcError}}}}};vm.createContext(ctx);vm.runInContext(fs.readFileSync('public/js/secure-read.js','utf8'),ctx);
(async()=>{
const q=ctx.window.secureRead;
assert.equal((await q('evaluations').select('*').eq('employee_id',4).in('id',[2,3]).order('id',{ascending:false}).range(10,19)).data[0].id,2);
assert.equal(calls[0].name,'read_scoped_data');assert.equal(calls[0].args.p_token,'session');assert.equal(calls[0].args.p_limit,10);assert.equal(calls[0].args.p_offset,10);assert.equal(calls[0].args.p_ascending,false);assert.equal(calls[0].args.p_filters.length,2);
assert.equal((await q('evaluations').eq('id',2).maybeSingle()).data.id,2);
rows=[];assert.equal((await q('evaluations').maybeSingle()).data,null);
rows=[{id:1},{id:2}];assert((await q('evaluations').maybeSingle()).error);
token=null;const before=calls.length;assert((await q('evaluations')).error);assert.equal(calls.length,before);
token='session';rpcError={message:'denied'};assert.equal((await q('evaluations')).error.message,'denied');
const source=fs.readFileSync('public/js/04-pages.js','utf8');assert(!/window\.sb\.from\(/.test(source),'all page reads use session RPC');
let timer,refreshes=0;const rt={window:{SupabaseSync:{TABLES:['users'],pullTable:async()=>true,scheduleUIRefresh:()=>refreshes++}},document:{readyState:'loading',addEventListener(){}},setTimeout:fn=>timer=fn,clearTimeout(){},console};rt.SupabaseSync=rt.window.SupabaseSync;vm.createContext(rt);vm.runInContext(fs.readFileSync('public/js/realtime-service.js','utf8'),rt);rt.window.RealtimeService._scheduleRefresh('users');await timer();assert.equal(refreshes,1);
assert(!fs.readFileSync('public/js/realtime-service.js','utf8').includes('navigate(currentPage'),'realtime must use guarded refresh');
console.log('Secure client: session propagation, pagination, single rows, failures and guarded realtime refresh passed');
})().catch(e=>{console.error(e);process.exitCode=1});
