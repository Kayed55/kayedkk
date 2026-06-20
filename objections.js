/**
 * Objections Pages
 */

window.UI = window.UI || {};

window.UI.renderObjections = async function() {
  const role = window.currentUser.role;
  let objections = [];
  if (role === 'employee') {
    objections = await DB.objections.list({ employee_id: window.currentUser.id });
  } else {
    objections = await DB.objections.list();
  }

  const rows = (await Promise.all(objections.map(async o => {
    const emp = await DB.users.getById(o.employee_id);
    return `<tr style="cursor:pointer" data-view-obj="${o.id}">
<td><strong style="color:var(--primary)">${Utils.escape(o.ref_number)}</strong></td>
<td>${Utils.escape(emp?emp.full_name:'-')}</td>
<td>#${o.evaluation_id}</td>
<td>${Utils.escape((o.reason||'').slice(0,60)) + ((o.reason||'').length>60?'...':'')}</td>
<td>${Utils.objectionStatus(o.status)}</td>
<td>${Utils.formatDate(o.created_at)}</td>
</tr>`;
  }))).join('');

  return `
<div class="page-header">
<div><div class="page-title">⚖️ الاعتراضات (${objections.length})</div><div class="page-subtitle">${role==='employee'?'اعتراضاتك':'إدارة اعتراضات الموظفين'}</div></div>
</div>
<div class="card">
<table class="table">
<thead><tr><th>الرقم المرجعي</th><th>الموظف</th><th>التقييم</th><th>السبب</th><th>الحالة</th><th>التاريخ</th></tr></thead>
<tbody>${rows || '<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--muted)">لا توجد اعتراضات</td></tr>'}</tbody>
</table>
</div>`;
};

window.UI.attachObjectionsHandlers = function() {
  document.querySelectorAll('[data-view-obj]').forEach(el => el.addEventListener('click', e => {
    e.stopPropagation();
    window.App.navigate('view-objection', { id: parseInt(el.dataset.viewObj) });
  }));
};

window.UI.renderViewObjection = async function(id) {
  const o = await DB.objections.getById(parseInt(id));
  if (!o) return '<div class="alert alert-danger">الاعتراض غير موجود</div>';
  const emp = await DB.users.getById(o.employee_id);
  const commentsHTML = (o.comments || []).map(c => `
<div style="background:#f8fafc;padding:12px 16px;border-right:3px solid var(--primary);border-radius:6px;margin-bottom:10px">
<div style="font-weight:700">${Utils.escape(c.user_name)} <span style="font-size:12px;color:var(--muted)">${Utils.roleLabel(c.role)}</span></div>
<div style="font-size:12px;color:var(--muted)">${Utils.formatDateTime(c.created_at)}</div>
<div style="margin-top:4px">${Utils.escape(c.text)}</div>
</div>`).join('');

  return `
<div class="page-header">
<div><div class="page-title">⚖️ ${Utils.escape(o.ref_number)}</div></div>
<button class="btn btn-secondary" data-nav="objections">← رجوع</button>
</div>
<div class="card">
<div class="card-body">
<div><strong>الموظف:</strong> ${Utils.escape(emp?emp.full_name:'-')}</div>
<div style="margin-top:8px"><strong>التقييم:</strong> #${o.evaluation_id}</div>
<div style="margin-top:8px"><strong>الحالة:</strong> ${Utils.objectionStatus(o.status)}</div>
<div style="margin-top:8px"><strong>التاريخ:</strong> ${Utils.formatDateTime(o.created_at)}</div>
<div style="margin-top:14px"><strong>سبب الاعتراض:</strong></div>
<div style="background:#f8fafc;padding:14px;border-radius:8px;margin-top:6px;white-space:pre-wrap">${Utils.escape(o.reason)}</div>
</div>
</div>
${commentsHTML ? `<div class="card"><div class="card-header"><div class="card-title">💬 التعليقات</div></div><div class="card-body">${commentsHTML}</div></div>` : ''}`;
};
