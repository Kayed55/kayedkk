'use strict';
const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const source=fs.readFileSync('public/js/00-supabase-sync.js','utf8');
const pages=fs.readFileSync('public/js/04-pages.js','utf8');
const gate=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve};};
function fixture(){
  const calls=[],intervals=[],timers=[];let read=async()=>({data:[],error:null});
  const ctx={console:{log(){},warn(){},error(){}},localStorage:{getItem(){return null;},setItem(){},removeItem(){}},navigator:{},
    DB:{data:{users:[],evaluations:[],evaluation_list:[],objections:[]},_persist(){}},setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){},setInterval:fn=>intervals.push(fn),
    currentPage:'evaluations',currentParams:{dept:2},hasUnsavedWork:()=>false,_FORM_PAGES:['new-evaluation','edit-evaluation','profile'],
    window:{addEventListener(){},getSessionToken:()=> 'test',invalidateDashCache(){},sb:{rpc:async(name,args)=>{calls.push([name,args]);return read(name,args);}}}};
  ctx.window.secureRead=table=>({select(){return this;},eq(key,value){this.id=value;return this;},async maybeSingle(){calls.push(['detail',this.id]);return read('detail',this.id);}});
  vm.createContext(ctx);vm.runInContext(source,ctx);
  return {ctx,sync:ctx.window.SupabaseSync,calls,intervals,timers,setRead:fn=>read=fn};
}
(async()=>{
  const f=fixture();f.sync._tableAppliedSeq.evaluation_list=1;f.ctx.DB.data.evaluation_list=[{id:1,percentage:50}];
  f.setRead(async(name,id)=>({data:name==='detail'?{id,percentage:100,items:{x:'ok'},template_snapshot:{name:'frozen'}}:[],error:null}));
  await f.sync.refreshAfterWrite({tables:[],evaluationId:1});
  assert.deepEqual(f.calls,[['detail',1]],'Saving one evaluation must not download any collection');
  assert.equal(f.ctx.DB.data.evaluations[0].percentage,100);
  assert.equal(f.ctx.DB.data.evaluation_list[0].percentage,100);
  assert.equal(f.ctx.DB.data.evaluation_list[0].template_snapshot,undefined);
  assert.equal(f.sync._tableAppliedSeq.evaluations,undefined,'A detail is not a complete collection');
  assert(!f.sync.tablesForPage('view-evaluation').includes('evaluations'));
  assert(!f.sync.tablesForPage('edit-evaluation').includes('evaluations'));
  assert(f.sync.tablesForPage('reports',{reportTab:'cg'}).includes('cg_evaluations'));
  assert(!f.sync.tablesForPage('reports',{reportTab:'cg'}).includes('evaluations'));
  await f.sync.loadEvaluation(1);assert.equal(f.calls.length,1,'Fresh detail is reused');
  const d=fixture(),g=gate();d.setRead(()=>g.promise);
  const a=d.sync.loadEvaluation(9),b=d.sync.loadEvaluation(9);assert.equal(d.calls.length,1,'Concurrent detail reads deduplicate');
  g.resolve({data:{id:9},error:null});await Promise.all([a,b]);
  const n=fixture(),old=gate();n.setRead(()=>old.promise);const stale=n.sync.loadEvaluation(9);
  n.sync._appliedSeq=++n.sync._pullSeq;n.setRead(async()=>({data:{id:9,percentage:99},error:null}));await n.sync.loadEvaluation(9,true);
  old.resolve({data:{id:9,percentage:1},error:null});await stale;assert.equal(n.ctx.DB.data.evaluations[0].percentage,99);
  const logout=fixture(),paused=gate();logout.setRead(()=>paused.promise);const ongoing=logout.sync.loadEvaluation(1);logout.sync.suspended=true;
  paused.resolve({data:{id:1},error:null});assert.equal(await ongoing,false);assert.equal(logout.ctx.DB.data.evaluations.length,0);
  const overlap=fixture(),held=gate();overlap.setRead(()=>held.promise);
  const aa=overlap.sync.pullAll(false,['evaluation_list']);const bb=overlap.sync.pullAll(false,['evaluation_list','objections']);
  assert.equal(overlap.calls.filter(c=>c[1].p_kind==='evaluation_list').length,1);
  held.resolve({data:[],error:null});await Promise.all([aa,bb]);
  const poll=fixture();poll.sync.startAutoSync();poll.sync.pullAll=async()=>true;let redraws=0;poll.sync.scheduleUIRefresh=()=>redraws++;
  await poll.intervals[0]();assert.equal(redraws,0,'Unchanged polling does not redraw');
  poll.sync.pullAll=async()=>{poll.sync._dataVersion++;return true;};await poll.intervals[0]();assert.equal(redraws,1);
  poll.ctx.currentPage='new-evaluation';await poll.intervals[0]();assert.equal(redraws,1,'No polling/redraw while completing a form');
  poll.ctx.currentPage='evaluations';poll.ctx.document={hidden:true};await poll.intervals[0]();assert.equal(redraws,1,'Hidden tab does not poll');

  // The real router must render a previously loaded Azwa list before a delayed refresh completes.
  const r=fixture();let renders=0,html='';const elements=[];
  const node=()=>({isConnected:true,setAttribute(){},remove(){this.isConnected=false;},append(){},querySelector(){return {}}});
  const content={prepend:e=>elements.push(e)};const app={set innerHTML(v){elements.forEach(e=>e.isConnected=false);html=v;},get innerHTML(){return html;}};
  r.ctx.document={title:'',getElementById:id=>id==='app'?app:node(),querySelector:s=>s==='.content'?content:null,querySelectorAll:()=>[],createElement:node};
  Object.assign(r.ctx,{_routeVersion:0,_formDirty:false,currentUser:{id:1},PAGE_TITLES:{},destroyCharts(){},renderLayout:x=>x,attachLayoutHandlers(){},attachPageHandlers(){},getSessionToken:()=> 'test'});
  for(const name of new Set(pages.match(/\brender[A-Z]\w*/g))) if(name!=='renderLayout') r.ctx[name]=()=>{renders++;return 'loaded-list';};
  r.sync._tableAppliedSeq={users:1,notifications:1,evaluation_list:1};r.sync._tableLoadedAt={users:1,notifications:1,evaluation_list:1};
  const background=gate();r.sync.pullAll=()=>background.promise;
  vm.runInContext(pages.slice(pages.indexOf('function navigate('),pages.indexOf('// جلسة المصادقة')),r.ctx);
  vm.runInContext("navigate('evaluations',{dept:4})",r.ctx);
  assert.equal(html,'loaded-list');assert.equal(renders,1);assert(!html.includes('section-loading'));
  vm.runInContext("navigate('profile')",r.ctx);const before=renders;
  r.sync._dataVersion++;background.resolve(true);await new Promise(setImmediate);
  // Mark profile as a form in this fixture, too, so background data never resets it.
  assert.equal(r.ctx.currentPage,'profile','Late refresh cannot send the user back to the previous section');
  const timeout=fixture();let captured,aborted=false;
  timeout.ctx.AbortController=AbortController;timeout.ctx.fetch=(_url,opts)=>{captured=opts;return new Promise((_,reject)=>opts.signal.addEventListener('abort',()=>{aborted=true;reject(new Error('aborted'));}));};
  const request=vm.runInContext("fetchWithReadDeadline('https://example.invalid/rpc/read_section_page')",timeout.ctx);
  timeout.timers.pop()();await assert.rejects(request,/aborted/);assert(aborted);
  timeout.ctx.fetch=async(_url,opts)=>{captured=opts;return 'saved';};
  assert.equal(await vm.runInContext("fetchWithReadDeadline('https://example.invalid/rpc/create_evaluation')",timeout.ctx),'saved');assert.equal(captured.signal,undefined);
  console.log('PASS: single-record saves, bounded reads, detail cache, authorization barriers, deduplication, nonblocking section navigation, route guards, idle polling and form protection');
})().catch(e=>{console.error(e);process.exitCode=1;});
