'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const src=fs.readFileSync(require('node:path').join(__dirname,'../public/js/04-pages.js'),'utf8');
const fragment=src.slice(src.indexOf('function getSessionToken()'),src.indexOf('// تسجيل حدث عميل'));
async function check(fails){
 const store=new Map([['mahzam_session_token','fixture'],['qe_current_user','{}']]);const calls=[],errors=[];let purged=false;
 const ctx={currentUser:{id:1},Date,Promise,localStorage:{getItem:k=>store.get(k),removeItem:k=>store.delete(k)},navigate:p=>calls.push(p),Toast:{error:m=>errors.push(m)},DB:{clearPrivateCache:async()=>{purged=true}},window:{SupabaseSync:{_pullSeq:3,_appliedSeq:2},sb:{rpc:async(name,args)=>{calls.push({name,args});if(fails)throw Error('offline');return {error:null}}}}};
 vm.createContext(ctx);await vm.runInContext(fragment+';logout();',ctx);
 assert.equal(store.has('mahzam_session_token'),false);assert.equal(store.has('qe_current_user'),false);assert.equal(purged,true);
 assert.equal(calls[1].name,'logout_session');assert.equal(calls[1].args.p_token,'fixture');
 assert.equal(ctx.window.SupabaseSync.suspended,true);assert.equal(ctx.window.SupabaseSync._appliedSeq,4);
 assert.equal(errors.length,fails?1:0);
}
(async()=>{await check(false);await check(true);console.log('Logout client: success and network failure passed');})().catch(e=>{console.error(e);process.exitCode=1});
