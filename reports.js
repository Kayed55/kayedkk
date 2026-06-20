/**
 * Reports & Monthly Report Pages
 */

window.UI = window.UI || {};

function arabicMonthName(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  const names = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  return `${names[m-1]} ${y}`;
}

window.UI.renderReports = async function() {
  const employees = await DB.users.list({ role: 'employee' });
  const allEvals = await DB.evaluations.list();

  const empData = employees.map(e => {
    const ue = allEvals.filter(ev => ev.employee_id === e.id);
    const avg = ue.length ? Math.round(ue.reduce((s,x)=>s+Number(x.percentage),0)/ue.length*10)/10 : 0;
    return {
      id: e.id,
      employee_number: e.employee_number || '-',
      name: e.full_name,
      supervisor: e.supervisor_name || '-',
      count: ue.length,
      avg
    };
  }).filter(e => e.count > 0).sort((a,b) => b.avg - a.avg);

  const totalEvals = allEvals.length;
  const overallAvg = empData.length ? Math.round(empData.reduce((s,e)=>s+e.avg,0)/empData.length*10)/10 : 0;
  const excellent = empData.filter(e => e.avg >= 81).length;
  const needFollow = empData.filter(e => e.avg <= 75).length;

  const rows = empData.map((e, i) => `<tr>
<td>${i+1}</td>
<td><strong>${Utils.escape(e.employee_number)}</strong></td>
<td>${Utils.escape(e.name)}</td>
<td>${Utils.escape(e.supervisor)}</td>
<td style="text-align:center">${e.count}</td>
<td style="text-align:center"><strong>${e.avg}%</strong></td>
<td>${Utils.gradeBadge(e.avg)}</td>
</tr>`).join('');

  return `
<div class="page-header">
<div><div class="page-title">📈 التقارير والإحصائيات</div><div class="page-subtitle">تحليل شامل لأداء الفريق</div></div>
<div style="display:flex;gap:8px">
<button class="btn btn-success" id="rep-export-xlsx">📊 تصدير Excel</button>
<button class="btn btn-danger" id="rep-export-pdf">📄 تصدير PDF</button>
</div>
</div>
<div class="stats-grid">
<div class="stat-card"><div class="stat-icon" style="background:var(--primary)">👥</div><div class="stat-value">${employees.length}</div><div class="stat-label">الموظفون</div></div>
<div class="stat-card"><div class="stat-icon" style="background:var(--info)">📋</div><div class="stat-value">${totalEvals}</div><div class="stat-label">إجمالي التقييمات</div></div>
<div class="stat-card"><div class="stat-icon" style="background:var(--success)">⭐</div><div class="stat-value">${overallAvg}%</div><div class="stat-label">المتوسط العام</div></div>
<div class="stat-card"><div class="stat-icon" style="background:var(--warning)">🏆</div><div class="stat-value">${excellent}</div><div class="stat-label">ناجح (≥81%)</div></div>
<div class="stat-card"><div class="stat-icon" style="background:var(--danger)">⚠️</div><div class="stat-value">${needFollow}</div><div class="stat-label">راسب (≤75%)</div></div>
</div>
<div class="card">
<div class="card-header"><div class="card-title">🏆 ترتيب الموظفين حسب الأداء</div></div>
<table class="table" id="rep-table">
<thead><tr><th>#</th><th>الرقم الوظيفي</th><th>الموظف</th><th>المشرف</th><th>التقييمات</th><th>المتوسط</th><th>التقدير</th></tr></thead>
<tbody>${rows || '<tr><td colspan="7" style="text-align:center;padding:20px">لا توجد بيانات</td></tr>'}</tbody>
</table>
</div>`;
};

window.UI.attachReportsHandlers = function() {
  const xls = document.getElementById('rep-export-xlsx');
  if (xls) xls.addEventListener('click', async () => {
    const employees = await DB.users.list({ role: 'employee' });
    const allEvals = await DB.evaluations.list();
    const data = employees.map(e => {
      const ue = allEvals.filter(ev => ev.employee_id === e.id);
      const avg = ue.length ? Math.round(ue.reduce((s,x)=>s+Number(x.percentage),0)/ue.length*10)/10 : 0;
      return {
        'الرقم الوظيفي': e.employee_number || '-',
        'اسم الموظف': e.full_name,
        'المسمى الوظيفي': e.position || '-',
        'اسم المشرف': e.supervisor_name || '-',
        'عدد التقييمات': ue.length,
        'المتوسط %': avg,
        'التقدير': avg>=81?'ناجح':avg>=76?'جيد جداً':ue.length?'راسب':'-'
      };
    }).filter(r => r['عدد التقييمات'] > 0);
    XLSXExport.exportRows(data, 'تقرير الأداء', `تقرير_الأداء_${new Date().toISOString().slice(0,10)}.xlsx`);
  });

  const pdf = document.getElementById('rep-export-pdf');
  if (pdf) pdf.addEventListener('click', async () => {
    const html = document.getElementById('page-content').innerHTML;
    const cleanHtml = PDFExport.buildHeader('📊 تقرير الأداء الشامل', 'تحليل أداء فريق العمل') + html;
    try {
      Toast.info('جاري إنشاء PDF...');
      await PDFExport.toPDF(cleanHtml, `تقرير_الأداء_${new Date().toISOString().slice(0,10)}.pdf`);
      Toast.success('تم التصدير');
    } catch(err) { Toast.error('فشل التصدير: ' + err.message); }
  });
};

window.UI.renderMonthlyReport = async function() {
  const now = new Date();
  const currentMonth = window.App.currentParams.month || `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const [y, m] = currentMonth.split('-').map(Number);

  const employees = await DB.users.list({ role: 'employee' });
  const allEvals = await DB.evaluations.list();

  const data = employees.map(e => {
    const evs = allEvals.filter(ev => {
      if (ev.employee_id !== e.id) return false;
      const d = new Date(ev.evaluation_date);
      return d.getFullYear() === y && d.getMonth() === m - 1;
    });
    const avg = evs.length ? Math.round(evs.reduce((s,x)=>s+Number(x.percentage),0)/evs.length*10)/10 : 0;
    return {
      id: e.id,
      employee_number: e.employee_number || '-',
      name: e.full_name,
      position: e.position || '-',
      supervisor: e.supervisor_name || '-',
      department: e.department || '-',
      count: evs.length,
      avg
    };
  });

  const evaluated = data.filter(d => d.count > 0);
  const finalAvg = evaluated.length ? Math.round(evaluated.reduce((s,d)=>s+d.avg,0)/evaluated.length*10)/10 : 0;
  const totalEvals = data.reduce((s,d) => s+d.count, 0);

  // Month options
  const monthSet = new Set();
  allEvals.forEach(ev => {
    const d = new Date(ev.evaluation_date);
    monthSet.add(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
  });
  monthSet.add(currentMonth);
  const monthOpts = Array.from(monthSet).sort().reverse().map(m => `<option value="${m}" ${m===currentMonth?'selected':''}>${arabicMonthName(m)}</option>`).join('');

  const overallRows = evaluated.map((e,i) => `<tr>
<td style="text-align:center"><strong>${i+1}</strong></td>
<td><strong>${Utils.escape(e.employee_number)}</strong></td>
<td>${Utils.escape(e.name)}</td>
<td>${Utils.escape(e.department)}</td>
<td>${Utils.escape(e.supervisor)}</td>
<td style="text-align:center">${e.count}</td>
<td style="text-align:center"><strong>${e.avg}%</strong></td>
<td>${Utils.gradeBadge(e.avg)}</td>
</tr>`).join('');

  return `
<div class="page-header">
<div><div class="page-title">📅 التقرير الشهري</div><div class="page-subtitle">${arabicMonthName(currentMonth)}</div></div>
<div style="display:flex;gap:8px">
<button class="btn btn-success" id="mr-export-xlsx">📊 Excel</button>
<button class="btn btn-danger" id="mr-export-pdf">📄 PDF</button>
</div>
</div>
<div class="card" style="margin-bottom:20px">
<div style="padding:16px;background:#f8fafc">
<select class="form-control" id="mr-month" style="max-width:300px">${monthOpts}</select>
</div>
</div>
<div style="background:linear-gradient(135deg,#1B202C,#202E4D,#06579F);color:white;padding:22px 28px;border-radius:14px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center;gap:20px;flex-wrap:wrap">
<div>
<div style="font-size:14px;opacity:0.9">📊 التقييم النهائي العام للموظفين</div>
<div style="font-size:24px;font-weight:800;margin-top:4px">${evaluated.length} موظف مقيم</div>
<div style="font-size:13px;opacity:0.85;margin-top:4px">${totalEvals} تقييم خلال ${arabicMonthName(currentMonth)}</div>
</div>
<div style="text-align:center;background:rgba(255,255,255,0.18);padding:18px 32px;border-radius:14px;border:2px solid rgba(255,255,255,0.25)">
<div style="font-size:48px;font-weight:800;line-height:1">${finalAvg}%</div>
<div style="font-size:12px;margin-top:6px;font-weight:700">${Utils.gradeLabel(finalAvg)}</div>
</div>
</div>
<div class="card">
<div class="card-header"><div class="card-title">📋 جميع الموظفين المقيمين</div></div>
<table class="table">
<thead><tr><th>#</th><th>الرقم</th><th>الموظف</th><th>القسم</th><th>المشرف</th><th>التقييمات</th><th>المتوسط</th><th>التقدير</th></tr></thead>
<tbody>${overallRows || '<tr><td colspan="8" style="text-align:center;padding:20px">لا يوجد موظفون مقيمون</td></tr>'}</tbody>
</table>
</div>`;
};

window.UI.attachMonthlyReportHandlers = function() {
  const sel = document.getElementById('mr-month');
  if (sel) sel.addEventListener('change', () => window.App.navigate('monthly-report', { month: sel.value }));

  const xls = document.getElementById('mr-export-xlsx');
  if (xls) xls.addEventListener('click', () => Toast.info('جاري تصدير Excel...'));

  const pdf = document.getElementById('mr-export-pdf');
  if (pdf) pdf.addEventListener('click', async () => {
    try {
      Toast.info('جاري إنشاء PDF...');
      const html = PDFExport.buildHeader('📅 التقرير الشهري', '') + document.getElementById('page-content').innerHTML;
      await PDFExport.toPDF(html, `التقرير_الشهري_${new Date().toISOString().slice(0,10)}.pdf`);
      Toast.success('تم التصدير');
    } catch(err) { Toast.error(err.message); }
  });
};
