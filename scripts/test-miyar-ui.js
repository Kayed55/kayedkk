const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),path=require('path');
const root=path.join(__dirname,'../public/js/');const html=[],sheets=[],charts=[];
const c={console,window:{addEventListener(){}},document:{addEventListener(){},getElementById(){return {}}},localStorage:{getItem(){return null}},setTimeout(){},setInterval(){},URL,Date,Chart:function(el,config){charts.push(config)},XLSX:{utils:{book_new:()=>({}),book_append_sheet(){},json_to_sheet:r=>(sheets.push(r),{}),aoa_to_sheet:r=>(sheets.push(r),{})},writeFile(){}}};vm.createContext(c);
for(const f of ['01-constants.js','03-core.js','04-pages.js'])vm.runInContext(fs.readFileSync(root+f,'utf8'),c);
c.capture=x=>html.push(x);
vm.runInContext(`htmlToPDF=async h=>capture(h);Toast.success=()=>{};Toast.info=()=>{};Toast.error=e=>{throw Error(e)};
currentUser={id:1,role:'admin'};currentParams={};
const fixture=[79.9,80,89.5,90,99.9,100].map((percentage,i)=>({id:i+1,employee_id:i+1,evaluator_id:1,percentage,grade:'ناجح',status:'ناجح',evaluation_date:'2026-10-22',section_scores:{},items:{}}));
DB={data:{evaluations:fixture},getEvaluations:()=>fixture,getEvaluation:id=>fixture[id-1],getUser:id=>({id,full_name:'fixture '+id,department_id:2}),getUsers:()=>fixture.map(e=>({id:e.id,full_name:'fixture '+e.id,department_id:2}))};
_reportDeptId=()=>2;mahzamDeptId=()=>2;
window._qrData={from:'2026-10-01',to:'2026-10-22',conformance_rate:50,sections:[{key:'mahzam',name:'محزم',total:6,avg:90,conformance_rate:50,miyar_counts:{below:1,near:2,meets:2,excellent:1},objections:0}],officers:[]};
window._reportData=fixture.map(e=>({name:'fixture',avg:e.percentage,count:1,high:e.percentage,low:e.percentage}));
getMonthlyData=()=>window._reportData;
`,c);
(async()=>{
 await vm.runInContext('qrExportPDF()',c);vm.runInContext('qrExportXLSX()',c);
 await vm.runInContext('exportReportsPDF()',c);vm.runInContext('exportReportsXLSX()',c);
 vm.runInContext('exportListXLSX()',c);vm.runInContext('exportListPDF()',c);
 vm.runInContext("buildSectionCharts('mahzam',window._qrData.sections[0])",c);
 const labels=['دون المعيار','قريب من المعيار','مطابق للمعيار','متميز'];
 for(const report of html){for(const label of labels)assert(report.includes(label),label);assert(!report.includes('>ناجح<'));assert(!report.includes('d="None"'));}
 const donut=charts.find(x=>x.type==='doughnut');assert.deepEqual(Array.from(donut.data.labels),labels);assert.deepEqual(Array.from(donut.data.datasets[0].data),[1,2,2,1]);
 const classified=sheets.flat().filter(r=>r['التقدير']);assert(classified.length>=12);assert(classified.every(r=>labels.includes(r['التقدير'])));
 const distribution=vm.runInContext('getOverallEval(window._reportData).distribution',c);assert.deepEqual(JSON.parse(JSON.stringify(distribution)),{below:1,near:2,meets:2,excellent:1,review:0});
 vm.runInContext("getActionsReportData=()=>({evals:[{action_taken:'لا يوجد إجراء'},{action_taken:'تنبيه شفهي'}],topObservations:[],improvements:[],improvementByAction:{}})",c);
 await vm.runInContext('exportActionsReportPDF()',c);
 const actionsPdf=html.at(-1);assert(actionsPdf.includes('color:#1D5BD8\">2</div>'));assert(actionsPdf.includes('color:#d97706\">1</div>'));
 console.log('Miyar UI: PDF/Excel classifications, chart buckets, monthly distribution and logo paths passed');
})().catch(e=>{console.error(e);process.exitCode=1});
