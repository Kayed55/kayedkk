/**
 * Employees Page (List + Add/Edit Modal + View)
 */

window.UI = window.UI || {};

window.UI.renderEmployees = async function() {
  let users = await DB.users.list({ role: 'employee' });
  if (window.currentUser.role === 'supervisor') {
    users = users.filter(u => u.supervisor_name === window.currentUser.full_name);
  }
  const supervisors = await DB.users.getSupervisors();
  const supOpts = supervisors.map(s => `<option value="${Utils.escape(s.full_name)}">${Utils.escape(s.full_name)}</option>`).join('');
  const deptSet = new Set();
  users.forEach(u => { if (u.department) deptSet.add(u.department); });
  const deptOpts = Array.from(deptSet).map(d => `<option value="${Utils.escape(d)}">${Utils.escape(d)}</option>`).join('');

  const rows = await Promise.all(users.map(async u => {
    const avg = await DB.evaluations.getAvgScore(u.id);
    const allEvals = await DB.evaluations.list({ employee_id: u.id });
    const count = allEvals.length;
    return `<tr data-search="${Utils.escape((u.full_name||'')+' '+(u.employee_number||'')+' '+(u.supervisor_name||'')+' '+(u.email||''))}" data-status="${u.is_active?'active':'inactive'}" data-dept="${Utils.escape(u.department||'')}" data-sup="${Utils.escape(u.supervisor_name||'')}">
<td><strong>${Utils.escape(u.employee_number||'-')}</strong></td>
<td><div style="display:flex;align-items:center;gap:10px"><div class="user-avatar">${Utils.getInitials(u.full_name)}</div><div>${Utils.escape(u.full_name)}</div></div></td>
<td><div style="font-size:13px;direction:ltr;text-align:right">${Utils.escape(u.email||'-')}</div></td>
<td>${Utils.escape(u.position||'-')}</td>
<td>👨‍💼 ${Utils.escape(u.supervisor_name||'-')}</td>
<td>${u.is_active ? '<span class="badge badge-success">✓ نشط</span>' : '<span class="badge badge-danger">✗ غير نشط</span>'}</td>
<td><div style="font-size:12px;color:var(--muted)">${Utils.formatDate(u.created_at)}</div></td>
<td>${count > 0 ? Utils.gradeBadge(avg) : '<span class="badge badge-info">لا يوجد</span>'}</td>
<td>
<button class="btn btn-sm btn-primary" data-view-emp="${u.id}">عرض</button>
${(window.currentUser.role==='admin'||window.currentUser.role==='quality_officer') ? `<button class="btn btn-sm btn-warning" data-edit-emp="${u.id}">تعديل</button>` : ''}
${(window.currentUser.role==='admin'||window.currentUser.role==='quality_officer') ? `<button class="btn btn-sm btn-info" data-reset-pw="${u.id}" title="إعادة تعيين كلمة المرور">🔑</button>` : ''}
</td>
</tr>`;
  }));

  const subtitle = window.currentUser.role === 'supervisor' ? 'موظفو فريقك التابعون لإشرافك' : 'إدارة بيانات الموظفين لمتابعة تقييماتهم';
  const noteIfNoSup = (window.currentUser.role==='admin'||window.currentUser.role==='quality_officer') && supervisors.length === 0
    ? `<div class="alert alert-warning" style="margin-bottom:14px">⚠️ لا يوجد حسابات مشرفين. أضف مشرفاً من <strong>صفحة إدارة المستخدمين</strong> قبل إضافة الموظفين.</div>`
    : '';

  return `
<div class="page-header">
<div><div class="page-title">الموظفون (${users.length})</div><div class="page-subtitle">${subtitle}</div></div>
${(window.currentUser.role==='admin'||window.currentUser.role==='quality_officer') ? '<button class="btn btn-primary" id="add-emp-btn">➕ إضافة موظف</button>' : ''}
</div>
${noteIfNoSup}
<div class="card">
<div style="padding:16px;background:#f8fafc;border-bottom:1px solid var(--border)">
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px">
<input type="text" class="form-control emp-filter" id="emp-search-name" placeholder="🔍 ابحث بالاسم...">
<input type="text" class="form-control emp-filter" id="emp-search-num" placeholder="🔢 ابحث بالرقم الوظيفي...">
<select class="form-control emp-filter" id="emp-search-sup">
<option value="">👨‍💼 جميع المشرفين</option>${supOpts}
</select>
<select class="form-control emp-filter" id="emp-search-dept">
<option value="">🏢 جميع الإدارات</option>${deptOpts}
</select>
<select class="form-control emp-filter" id="emp-search-status">
<option value="">📋 الحالة (الكل)</option>
<option value="active">✓ نشط</option>
<option value="inactive">✗ غير نشط</option>
</select>
<button class="btn btn-secondary" id="emp-clear">🔄 إعادة تعيين</button>
</div>
</div>
<div style="overflow-x:auto">
<table class="table" id="emp-table">
<thead><tr><th>الرقم الوظيفي</th><th>اسم الموظف</th><th>البريد الإلكتروني</th><th>المسمى الوظيفي</th><th>اسم المشرف</th><th>حالة الحساب</th><th>تاريخ الإنشاء</th><th>متوسط الأداء</th><th>إجراءات</th></tr></thead>
<tbody>${rows.join('') || '<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--muted)">لا يوجد موظفون</td></tr>'}</tbody>
</table>
</div>
</div>`;
};

window.UI.showEmployeeModal = async function(editId = null) {
  const ed = editId ? await DB.users.getById(editId) : null;
  const supervisors = await DB.users.getSupervisors();
  const currentSup = ed ? (ed.supervisor_name||'') : '';
  const supOpts = supervisors.map(s => `<option value="${Utils.escape(s.full_name)}" ${s.full_name===currentSup?'selected':''}>${Utils.escape(s.full_name)} (${Utils.escape(s.email||'-')})</option>`).join('');
  const supDropdown = supervisors.length === 0
    ? `<div style="padding:10px;background:#fee2e2;border:1px solid #fca5a5;border-radius:8px;color:#991b1b;font-size:13px">⚠️ لا يوجد مشرفون مسجلون. أضف حساب مشرف من <strong>صفحة إدارة المستخدمين</strong> أولاً.</div>`
    : `<select class="form-control" id="ef-sup" required>
<option value="">-- اختر المشرف --</option>
${supOpts}
</select>
<div style="font-size:11px;color:var(--muted);margin-top:4px">القائمة تشمل جميع الحسابات المسجلة بصلاحية "مشرف"</div>`;

  const body = `<form id="emp-form">
<div class="alert alert-info" style="margin-bottom:16px;font-size:13px">ℹ️ سيتم إنشاء حساب دخول للموظف بالبريد الإلكتروني وكلمة المرور أدناه.</div>
<div class="grid grid-2">
<div class="form-group"><label class="form-label">اسم الموظف بالكامل *</label><input class="form-control" id="ef-name" required value="${ed?Utils.escape(ed.full_name):''}"></div>
<div class="form-group"><label class="form-label">الرقم الوظيفي *</label><input class="form-control" id="ef-num" required value="${ed?Utils.escape(ed.employee_number||''):''}" placeholder="EMP001" ${ed?'readonly':''}></div>
<div class="form-group"><label class="form-label">📧 البريد الإلكتروني *</label><input type="email" class="form-control" id="ef-email" required value="${ed?Utils.escape(ed.email||''):''}" placeholder="employee@example.com"></div>
<div class="form-group"><label class="form-label">📱 رقم الجوال</label><input class="form-control" id="ef-phone" value="${ed?Utils.escape(ed.phone||''):''}" placeholder="05xxxxxxxx"></div>
<div class="form-group"><label class="form-label">المسمى الوظيفي *</label><input class="form-control" id="ef-pos" required value="${ed?Utils.escape(ed.position||''):'موظف خدمة'}"></div>
<div class="form-group"><label class="form-label">👨‍💼 اسم المشرف *</label>${supDropdown}</div>
<div class="form-group"><label class="form-label">القسم/الإدارة</label><input class="form-control" id="ef-dept" value="${ed?Utils.escape(ed.department||''):'قسم الجودة'}"></div>
${!ed ? `<div class="form-group"><label class="form-label">🔒 كلمة المرور *</label><input type="password" class="form-control" id="ef-pass" required placeholder="8 أحرف على الأقل + حرف + رقم + رمز"></div>` : ''}
</div></form>`;
  const footer = `<button class="btn btn-secondary" onclick="Modal.close()">إلغاء</button><button class="btn btn-primary" id="ef-save">${ed?'حفظ':'إضافة'}</button>`;
  Modal.show(ed?'تعديل بيانات الموظف':'إضافة موظف جديد', body, footer);

  document.getElementById('ef-save').addEventListener('click', async () => {
    const full_name = document.getElementById('ef-name').value.trim();
    const employee_number = document.getElementById('ef-num').value.trim();
    const position = document.getElementById('ef-pos').value.trim();
    const supEl = document.getElementById('ef-sup');
    if (!supEl) { Toast.error('يجب إضافة حساب مشرف أولاً'); return; }
    const supervisor_name = supEl.value;
    const supObj = supervisors.find(s => s.full_name === supervisor_name);
    const supervisor_id = supObj ? supObj.id : null;
    const email = document.getElementById('ef-email').value.trim();
    const phone = document.getElementById('ef-phone').value.trim();
    const department = document.getElementById('ef-dept').value.trim();

    if (!full_name || !employee_number || !position || !supervisor_name || !email) {
      Toast.error('يرجى تعبئة جميع الحقول المطلوبة'); return;
    }
    if (!Utils.validateEmail(email)) { Toast.error('بريد إلكتروني غير صالح'); return; }

    try {
      if (ed) {
        await DB.users.update(editId, { full_name, employee_number, position, supervisor_name, supervisor_id, email, phone, department });
        Toast.success('تم حفظ التعديلات');
      } else {
        const password = document.getElementById('ef-pass').value;
        const vp = Utils.validatePassword(password);
        if (!vp.valid) { Toast.error(vp.errors[0]); return; }
        await DB.users.create({
          full_name, username: employee_number, password, employee_number, position,
          supervisor_name, supervisor_id, role: 'employee',
          department: department || 'قسم الجودة', email, phone, must_change_password: false
        });
        Toast.success('تم إضافة الموظف بنجاح');
      }
      Modal.close();
      window.App.navigate('employees');
    } catch(err) { Toast.error(err.message); }
  });
};

window.UI.attachEmployeesHandlers = function() {
  const filterEmps = () => {
    const qn = (document.getElementById('emp-search-name')?.value || '').trim().toLowerCase();
    const qnum = (document.getElementById('emp-search-num')?.value || '').trim().toLowerCase();
    const qsup = (document.getElementById('emp-search-sup')?.value || '').trim();
    const qdept = (document.getElementById('emp-search-dept')?.value || '').trim();
    const qstatus = (document.getElementById('emp-search-status')?.value || '').trim();
    document.querySelectorAll('#emp-table tbody tr').forEach(tr => {
      const cells = tr.querySelectorAll('td');
      if (cells.length < 4) return;
      const num = (cells[0].textContent || '').toLowerCase();
      const name = (cells[1].textContent || '').toLowerCase();
      const sup = tr.dataset.sup || '';
      const dept = tr.dataset.dept || '';
      const status = tr.dataset.status || '';
      const ok = (!qn || name.includes(qn)) &&
                 (!qnum || num.includes(qnum)) &&
                 (!qsup || sup === qsup) &&
                 (!qdept || dept === qdept) &&
                 (!qstatus || status === qstatus);
      tr.style.display = ok ? '' : 'none';
    });
  };
  document.querySelectorAll('.emp-filter').forEach(inp => {
    inp.addEventListener('input', filterEmps);
    inp.addEventListener('change', filterEmps);
  });
  const clrBtn = document.getElementById('emp-clear');
  if (clrBtn) clrBtn.addEventListener('click', () => {
    ['emp-search-name','emp-search-num','emp-search-sup','emp-search-dept','emp-search-status'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    filterEmps();
  });
  document.querySelectorAll('[data-view-emp]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    window.App.navigate('view-employee', { id: parseInt(b.dataset.viewEmp) });
  }));
  document.querySelectorAll('[data-edit-emp]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    window.UI.showEmployeeModal(parseInt(b.dataset.editEmp));
  }));
  document.querySelectorAll('[data-reset-pw]').forEach(b => b.addEventListener('click', async e => {
    e.stopPropagation();
    const id = parseInt(b.dataset.resetPw);
    const u = await DB.users.getById(id);
    if (!u) return;
    if (confirm(`إعادة تعيين كلمة المرور للمستخدم: ${u.full_name}؟`)) {
      try {
        const tempPw = await DB.users.resetPassword(id);
        alert(`كلمة المرور المؤقتة الجديدة:\n\n${tempPw}\n\nأرسلها للمستخدم بطريقة آمنة.`);
        Toast.success('تم إعادة التعيين');
      } catch(err) { Toast.error(err.message); }
    }
  }));
  const addBtn = document.getElementById('add-emp-btn');
  if (addBtn) addBtn.addEventListener('click', () => window.UI.showEmployeeModal());
};

window.UI.renderViewEmployee = async function(id) {
  const emp = await DB.users.getById(id);
  if (!emp) return '<div class="alert alert-danger">الموظف غير موجود</div>';
  const evals = await DB.evaluations.list({ employee_id: id });
  const avg = await DB.evaluations.getAvgScore(id);

  const rows = (await Promise.all(evals.map(async e => {
    const evr = await DB.users.getById(e.evaluator_id);
    return `<tr style="cursor:pointer" data-nav-eval="${e.id}">
<td>#${e.id}</td>
<td>${Utils.formatDate(e.evaluation_date)}</td>
<td>${Utils.escape(evr ? evr.full_name : '-')}</td>
<td>${e.total_score}/100</td>
<td>${Utils.gradeBadge(Number(e.percentage))}</td>
</tr>`;
  }))).join('');

  return `
<div class="page-header">
<div><div class="page-title">${Utils.escape(emp.full_name)}</div><div class="page-subtitle">${Utils.escape(emp.position||'')} - ${Utils.escape(emp.department||'')} | المشرف: ${Utils.escape(emp.supervisor_name||'-')}</div></div>
<button class="btn btn-secondary" data-nav="employees">← رجوع</button>
</div>
<div class="stats-grid">
<div class="stat-card"><div class="stat-icon" style="background:var(--primary)">📋</div><div class="stat-value">${evals.length}</div><div class="stat-label">إجمالي التقييمات</div></div>
<div class="stat-card"><div class="stat-icon" style="background:var(--success)">⭐</div><div class="stat-value">${avg}%</div><div class="stat-label">متوسط الأداء</div></div>
<div class="stat-card"><div class="stat-icon" style="background:var(--info)">📧</div><div class="stat-value" style="font-size:13px;word-break:break-all">${Utils.escape(emp.email||'-')}</div><div class="stat-label">البريد الإلكتروني</div></div>
<div class="stat-card"><div class="stat-icon" style="background:var(--warning)">📱</div><div class="stat-value" style="font-size:14px">${Utils.escape(emp.phone||'-')}</div><div class="stat-label">رقم الجوال</div></div>
</div>
<div class="card">
<div class="card-header"><div class="card-title">📋 سجل التقييمات (${evals.length})</div></div>
<table class="table">
<thead><tr><th>#</th><th>التاريخ</th><th>المقيِّم</th><th>الدرجة</th><th>التقدير</th></tr></thead>
<tbody>${rows || '<tr><td colspan="5" style="text-align:center;padding:20px">لا توجد تقييمات</td></tr>'}</tbody>
</table>
</div>`;
};
