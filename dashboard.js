/**
 * Dashboard Page
 */

window.UI = window.UI || {};

window.UI.renderDashboard = async function() {
  const isEmp = window.currentUser.role === 'employee';
  const s = await DB.stats.dashboard(isEmp ? window.currentUser.id : null);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'صباح الخير' : 'مساء الخير';

  const welcomeBanner = `
<div style="background:linear-gradient(135deg,#1B202C 0%,#202E4D 50%,#06579F 100%);border-radius:16px;padding:28px;color:white;margin-bottom:24px;position:relative;overflow:hidden;box-shadow:0 10px 30px rgba(27,32,44,0.35)">
<div style="position:absolute;top:-40px;left:-40px;width:240px;height:240px;background:rgba(255,255,255,0.06);border-radius:50%"></div>
<div style="position:relative;z-index:1;display:flex;justify-content:space-between;align-items:center;gap:20px;flex-wrap:wrap">
<div>
<div style="font-size:14px;opacity:0.85;margin-bottom:4px">${greeting}</div>
<div style="font-size:26px;font-weight:800;margin-bottom:6px">${Utils.escape(window.currentUser.full_name)} 👋</div>
<div style="font-size:14px;opacity:0.9">${Utils.roleLabel(window.currentUser.role)} - ${new Date().toLocaleDateString('ar-SA',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</div>
<div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.18);font-size:13px;opacity:0.9">🌟 مرحباً بكم في <strong>${window.SYSTEM_NAME}</strong> - ${window.COMPANY_NAME}</div>
</div>
<div style="width:130px;height:auto;opacity:0.95;flex-shrink:0">${window.MAHZAM_LOGO_LIGHT_SVG}</div>
</div>
</div>`;

  const cards = `
<div class="stats-grid">
<div class="stat-card" style="background:linear-gradient(135deg,#06579F,#2378c4);color:white;border:none"><div class="stat-icon" style="background:rgba(255,255,255,0.25)">📋</div><div class="stat-value" style="color:white">${s.total}</div><div class="stat-label" style="color:rgba(255,255,255,0.9)">إجمالي التقييمات</div></div>
<div class="stat-card" style="background:linear-gradient(135deg,#10b981,#059669);color:white;border:none"><div class="stat-icon" style="background:rgba(255,255,255,0.25)">⭐</div><div class="stat-value" style="color:white">${s.avg}%</div><div class="stat-label" style="color:rgba(255,255,255,0.9)">متوسط الجودة</div></div>
<div class="stat-card" style="background:linear-gradient(135deg,#06b6d4,#0891b2);color:white;border:none"><div class="stat-icon" style="background:rgba(255,255,255,0.25)">📅</div><div class="stat-value" style="color:white">${s.today}</div><div class="stat-label" style="color:rgba(255,255,255,0.9)">تقييمات اليوم</div></div>
<div class="stat-card" style="background:linear-gradient(135deg,#f59e0b,#d97706);color:white;border:none"><div class="stat-icon" style="background:rgba(255,255,255,0.25)">📆</div><div class="stat-value" style="color:white">${s.month}</div><div class="stat-label" style="color:rgba(255,255,255,0.9)">تقييمات الشهر</div></div>
${!isEmp ? `<div class="stat-card" style="background:linear-gradient(135deg,#f59e0b,#dc2626);color:white;border:none;cursor:pointer" data-nav="objections"><div class="stat-icon" style="background:rgba(255,255,255,0.25)">⚖️</div><div class="stat-value" style="color:white">${s.objOpen||0}</div><div class="stat-label" style="color:rgba(255,255,255,0.9)">اعتراضات مفتوحة</div></div>
<div class="stat-card" style="background:linear-gradient(135deg,#64748b,#475569);color:white;border:none;cursor:pointer" data-nav="objections"><div class="stat-icon" style="background:rgba(255,255,255,0.25)">📁</div><div class="stat-value" style="color:white">${s.objClosed||0}</div><div class="stat-label" style="color:rgba(255,255,255,0.9)">اعتراضات مغلقة</div></div>` : ''}
</div>`;

  const recentRows = s.recent.length
    ? (await Promise.all(s.recent.map(async e => {
        const emp = await DB.users.getById(e.employee_id);
        const evr = await DB.users.getById(e.evaluator_id);
        return `<tr style="cursor:pointer" data-nav-eval="${e.id}">
          <td>${Utils.escape(emp ? emp.full_name : '-')}</td>
          <td>${Utils.escape(evr ? evr.full_name : '-')}</td>
          <td>${Utils.formatDate(e.evaluation_date)}</td>
          <td>${Utils.gradeBadge(Number(e.percentage))}</td>
        </tr>`;
      }))).join('')
    : '<tr><td colspan="4" style="text-align:center;padding:30px;color:var(--muted)">لا توجد تقييمات بعد</td></tr>';

  const performers = !isEmp ? `
<div class="grid grid-2" style="margin-top:20px">
<div class="card" style="border-top:4px solid var(--success)">
<div class="card-header" style="background:linear-gradient(to left,#d1fae5,transparent)"><div class="card-title">🏆 أفضل الموظفين أداءً</div></div>
<div class="card-body" style="padding:0">
${s.top.length ? s.top.map((p, idx) => `
<div style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid var(--border);cursor:pointer" data-view-emp="${p.id}">
<div style="display:flex;align-items:center;gap:12px">
<div style="display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;background:${idx===0?'#fbbf24':idx===1?'#94a3b8':idx===2?'#cd7f32':'#e2e8f0'};color:white;font-weight:800;font-size:14px">${idx+1}</div>
<div class="user-avatar" style="background:var(--success)">${Utils.getInitials(p.name)}</div>
<div><div style="font-weight:700">${Utils.escape(p.name)}</div><div style="font-size:12px;color:var(--muted)">${p.count} تقييم</div></div>
</div>
<div style="text-align:center"><div style="font-size:20px;font-weight:800;color:var(--success)">${p.avg}%</div><div style="font-size:11px;color:var(--muted)">${Utils.gradeLabel(p.avg)}</div></div>
</div>`).join('') : '<div style="padding:30px;text-align:center;color:var(--muted)">لا توجد بيانات بعد</div>'}
</div>
</div>
<div class="card" style="border-top:4px solid var(--danger)">
<div class="card-header" style="background:linear-gradient(to left,#fee2e2,transparent)">
<div class="card-title">📉 يحتاجون متابعة <span style="font-size:11px;color:var(--muted);font-weight:600;margin-right:8px">(الموظفون الراسبون فقط - آخر تقييم ≤75%)</span></div>
</div>
<div class="card-body" style="padding:0">
${s.low.length ? s.low.map((p, idx) => `
<div style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid var(--border);cursor:pointer" data-view-emp="${p.id}">
<div style="display:flex;align-items:center;gap:12px">
<div style="display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;background:var(--danger);color:white;font-weight:800;font-size:14px">⚠</div>
<div class="user-avatar" style="background:var(--danger)">${Utils.getInitials(p.name)}</div>
<div>
<div style="font-weight:700">${Utils.escape(p.name)}</div>
<div style="font-size:12px;color:var(--muted)">${p.count} تقييم • آخر تقييم: ${Utils.formatDate(p.lastEvalDate)} ${p.lastEvalApproved ? '<span style="color:var(--success);font-weight:700">✓</span>' : '<span style="color:var(--muted)">○</span>'}</div>
</div>
</div>
<div style="text-align:center">
<div style="font-size:20px;font-weight:800;color:var(--danger)">${p.lastEvalPct}%</div>
<div style="font-size:11px"><span class="badge badge-danger" style="font-size:10px">راسب</span></div>
</div>
</div>`).join('') : '<div style="padding:30px;text-align:center;color:var(--muted)">✅ لا يوجد موظفون راسبون - جميع الموظفين يجتازون التقييم 👍</div>'}
</div>
</div>
</div>` : '';

  return `
${welcomeBanner}
${cards}
${performers}
<div class="card" style="margin-top:20px">
<div class="card-header"><div class="card-title">📋 آخر التقييمات</div></div>
<div class="card-body" style="padding:0">
<table class="table">
<thead><tr><th>الموظف</th><th>المقيِّم</th><th>التاريخ</th><th>النتيجة</th></tr></thead>
<tbody>${recentRows}</tbody>
</table>
</div>
</div>`;
};

window.UI.attachDashboardHandlers = function() {
  document.querySelectorAll('[data-view-emp]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      window.App.navigate('view-employee', { id: parseInt(el.dataset.viewEmp) });
    });
  });
  document.querySelectorAll('[data-nav-eval]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      window.App.navigate('view-evaluation', { id: parseInt(el.dataset.navEval) });
    });
  });
};
