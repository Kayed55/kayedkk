/**
 * Evaluations Pages (List + New + View + Edit)
 */

window.UI = window.UI || {};

let _criteriaCache = null;
async function getCriteria() {
  if (!_criteriaCache) _criteriaCache = await DB.criteria.get();
  return _criteriaCache;
}

// قائمة منسدلة للملاحظات المرصودة
function buildObservedIssueSelect(selected = '', other = '') {
  const opts = window.OBSERVED_ISSUES.map(o => {
    const isPositive = o === window.NO_ISSUE_LABEL;
    const label = isPositive ? '✅ ' + o + ' (تقييم إيجابي)' : o;
    return `<option value="${o}" ${o===selected?'selected':''}>${label}</option>`;
  }).join('');
  return `<select class="form-control" id="ef-observed" required onchange="(function(s){document.getElementById('ef-observed-other-wrap').style.display = s.value==='أخرى'?'block':'none'; document.getElementById('ef-positive-hint').style.display = s.value==='${window.NO_ISSUE_LABEL}'?'block':'none';})(this)">
<option value="">-- اختر الملاحظة المرصودة --</option>${opts}</select>
<div id="ef-positive-hint" style="margin-top:8px;padding:10px 14px;background:linear-gradient(to left,#d1fae5,#ecfdf5);border:1px solid #6ee7b7;border-radius:8px;color:#065f46;font-size:13px;font-weight:600;${selected===window.NO_ISSUE_LABEL?'':'display:none'}">
✅ تقييم إيجابي - لم يتم رصد أي ملاحظات أو أخطاء، الموظف أدى مهامه بشكل صحيح.
</div>
<div id="ef-observed-other-wrap" style="margin-top:8px;${selected==='أخرى'?'':'display:none'}">
<input class="form-control" id="ef-observed-other" placeholder="اكتب وصف الملاحظة..." value="${Utils.escape(other||'')}">
</div>`;
}

function buildActionTakenSelect(selected = '', other = '') {
  const opts = window.ACTIONS_TAKEN.map(o => `<option value="${o}" ${o===selected?'selected':''}>${o}</option>`).join('');
  return `<select class="form-control" id="ef-action" required onchange="document.getElementById('ef-action-other-wrap').style.display = this.value==='أخرى'?'block':'none'">
<option value="">-- اختر الإجراء المتخذ --</option>${opts}</select>
<div id="ef-action-other-wrap" style="margin-top:8px;${selected==='أخرى'?'':'display:none'}">
<input class="form-control" id="ef-action-other" placeholder="اكتب وصف الإجراء..." value="${Utils.escape(other||'')}">
</div>`;
}

window.UI.renderEvaluations = async function() {
  const isEmp = window.currentUser.role === 'employee';
  const evals = await DB.evaluations.list(isEmp ? { employee_id: window.currentUser.id } : {});

  const rows = (await Promise.all(evals.map(async e => {
    const emp = await DB.users.getById(e.employee_id);
    const evr = await DB.users.getById(e.evaluator_id);
    return `<tr>
<td>#${e.id}</td>
<td>${Utils.escape(emp?emp.full_name:'-')}</td>
<td>${Utils.escape(evr?evr.full_name:'-')}</td>
<td>${Utils.formatDate(e.evaluation_date)}</td>
<td>${e.total_score}/100</td>
<td>${Utils.gradeBadge(Number(e.percentage))}</td>
<td>${e.approved?'<span class="badge badge-success">✓ معتمد</span>':'<span class="badge badge-warning">قيد المراجعة</span>'}</td>
<td>
<button class="btn btn-sm btn-primary" data-nav-eval="${e.id}">عرض</button>
</td>
</tr>`;
  }))).join('');

  return `
<div class="page-header">
<div><div class="page-title">التقييمات (${evals.length})</div><div class="page-subtitle">${isEmp?'تقييماتك':'جميع التقييمات'}</div></div>
${Perms.can('create_evaluation') ? '<button class="btn btn-primary" data-nav="new-evaluation">➕ تقييم جديد</button>' : ''}
</div>
<div class="card">
<table class="table">
<thead><tr><th>#</th><th>الموظف</th><th>المقيِّم</th><th>التاريخ</th><th>الدرجة</th><th>التقدير</th><th>الحالة</th><th>إجراءات</th></tr></thead>
<tbody>${rows || '<tr><td colspan="8" style="text-align:center;padding:20px">لا توجد تقييمات</td></tr>'}</tbody>
</table>
</div>`;
};

window.UI.attachEvaluationsHandlers = function() {
  document.querySelectorAll('[data-nav-eval]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    window.App.navigate('view-evaluation', { id: parseInt(b.dataset.navEval) });
  }));
};

window.UI.renderNewEvaluation = async function() {
  const criteria = await getCriteria();
  if (!criteria) return '<div class="alert alert-danger">معايير التقييم غير موجودة. اتصل بالمدير.</div>';
  const employees = await DB.users.list({ role: 'employee', active: true });
  const empOpts = employees.map(e => `<option value="${e.id}">${Utils.escape(e.full_name)}</option>`).join('');
  const A = criteria.answers;

  const sectionsHTML = criteria.sections.map(s => `
<div class="card">
<div class="card-header">
<div class="card-title">${Utils.escape(s.title)} ${s.type==='critical'?'<span class="badge badge-danger" style="margin-right:8px">حرج</span>':''}</div>
<div style="color:var(--muted);font-size:13px">${s.weight} نقطة</div>
</div>
<div class="card-body" style="padding:0">
${s.subsections.map(sub => `
${s.subsections.length>1||s.type==='non-critical'?`<div class="subsection-title">${Utils.escape(sub.title)}</div>`:''}
${sub.items.map(it => `
<div class="eval-item">
<div class="eval-item-label">${Utils.escape(it.label)}</div>
<div class="eval-item-options">
<label><input type="radio" name="item-${it.key}" value="${A.OK}" checked> ✅ لا يوجد خطأ</label>
<label><input type="radio" name="item-${it.key}" value="${A.ERR}"> ❌ يوجد خطأ</label>
<label><input type="radio" name="item-${it.key}" value="${A.NA}"> ⚪ لا ينطبق</label>
</div>
</div>`).join('')}
`).join('')}
</div></div>`).join('');

  return `
<div class="page-header">
<div><div class="page-title">تقييم جديد</div><div class="page-subtitle">قم بتعبئة بيانات التقييم</div></div>
<button class="btn btn-secondary" data-nav="evaluations">← رجوع</button>
</div>
<form id="new-eval-form">
<div class="card">
<div class="card-header"><div class="card-title">📋 بيانات التقييم</div></div>
<div class="card-body">
<div class="grid grid-3">
<div class="form-group"><label class="form-label">الموظف *</label><select class="form-control" id="ef-employee" required><option value="">-- اختر --</option>${empOpts}</select></div>
<div class="form-group"><label class="form-label">تاريخ التقييم *</label><input type="date" class="form-control" id="ef-date" required value="${new Date().toISOString().substring(0,10)}"></div>
<div class="form-group"><label class="form-label">🔍 الملاحظة المرصودة *</label>${buildObservedIssueSelect()}</div>
</div>
<div class="form-group"><label class="form-label">ملاحظات إضافية</label><textarea class="form-control" id="ef-notes" rows="2"></textarea></div>
</div>
</div>
${sectionsHTML}
<div class="card" style="border:2px solid var(--warning);background:#fffbeb">
<div class="card-header" style="background:#fef3c7"><div class="card-title">⚖️ الإجراء المتخذ</div></div>
<div class="card-body">
<div class="alert alert-warning" style="margin-bottom:14px;font-size:13px">⚠️ تحديد الإجراء المتخذ إلزامي قبل اعتماد التقييم</div>
<div class="form-group"><label class="form-label">الإجراء المتخذ *</label>${buildActionTakenSelect()}</div>
</div>
</div>
<div class="card" style="position:sticky;bottom:0;z-index:10;border:2px solid var(--primary)">
<div class="card-body">
<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:14px">
<div>
<div style="font-size:13px;color:var(--muted)">الدرجة الإجمالية</div>
<div id="live-score" style="font-size:32px;font-weight:800;color:var(--primary)">100 / 100</div>
<div id="live-grade">${Utils.gradeBadge(100)}</div>
</div>
<div style="display:flex;gap:10px">
<button type="button" class="btn btn-secondary" data-nav="evaluations">إلغاء</button>
<button type="submit" class="btn btn-success" style="padding:12px 26px;font-size:15px">💾 حفظ التقييم</button>
</div>
</div>
</div>
</div>
</form>`;
};

window.UI.attachNewEvalHandlers = async function() {
  const criteria = await getCriteria();
  if (!criteria) return;
  const form = document.getElementById('new-eval-form');
  if (!form) return;

  const collectItems = () => {
    const items = {};
    criteria.sections.forEach(s => s.subsections.forEach(sub => sub.items.forEach(it => {
      const r = document.querySelector(`input[name="item-${it.key}"]:checked`);
      items[it.key] = r ? r.value : criteria.answers.OK;
    })));
    return items;
  };

  const updateLive = () => {
    const r = Utils.calculateScores(collectItems(), criteria);
    document.getElementById('live-score').textContent = `${r.totalScore} / 100`;
    document.getElementById('live-grade').innerHTML = Utils.gradeBadge(r.percentage);
  };

  form.querySelectorAll('input[type=radio]').forEach(r => r.addEventListener('change', updateLive));

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const empId = parseInt(document.getElementById('ef-employee').value);
    if (!empId) { Toast.error('يرجى اختيار الموظف'); return; }

    const observed = document.getElementById('ef-observed').value;
    const observedOther = (document.getElementById('ef-observed-other')||{}).value || '';
    const action = document.getElementById('ef-action').value;
    const actionOther = (document.getElementById('ef-action-other')||{}).value || '';

    if (!observed) { Toast.error('يرجى اختيار الملاحظة المرصودة'); return; }
    if (observed === 'أخرى' && !observedOther.trim()) { Toast.error('يرجى كتابة وصف الملاحظة'); return; }
    if (!action) { Toast.error('يرجى اختيار الإجراء المتخذ'); return; }
    if (action === 'أخرى' && !actionOther.trim()) { Toast.error('يرجى كتابة وصف الإجراء'); return; }

    const items = collectItems();
    const r = Utils.calculateScores(items, criteria);

    try {
      const newEval = await DB.evaluations.create({
        employee_id: empId,
        evaluator_id: window.currentUser.id,
        evaluation_date: document.getElementById('ef-date').value,
        call_type: observed === 'أخرى' ? observedOther.trim() : observed,
        observed_issue: observed,
        observed_issue_other: observedOther.trim(),
        action_taken: action,
        action_taken_other: actionOther.trim(),
        notes: document.getElementById('ef-notes').value.trim(),
        items,
        section_scores: r.sectionScores,
        total_score: r.totalScore,
        percentage: r.percentage,
        grade: r.grade,
        status: r.status
      });
      Toast.success(`تم حفظ التقييم - ${r.percentage}% (${r.grade})`);
      window.App.navigate('view-evaluation', { id: newEval.id });
    } catch(err) { Toast.error('فشل حفظ التقييم: ' + err.message); }
  });
};

window.UI.renderViewEvaluation = async function(id) {
  const ev = await DB.evaluations.getById(parseInt(id));
  if (!ev) return '<div class="alert alert-danger">التقييم غير موجود</div>';
  if (window.currentUser.role === 'employee' && ev.employee_id !== window.currentUser.id) {
    return '<div class="alert alert-danger">ليس لديك صلاحية لعرض هذا التقييم</div>';
  }
  const emp = await DB.users.getById(ev.employee_id);
  const evr = await DB.users.getById(ev.evaluator_id);
  const isPositive = window.isPositiveObservation(ev);

  return `
<div class="page-header">
<div><div class="page-title">تقييم #${ev.id}</div><div class="page-subtitle">${Utils.escape(emp?emp.full_name:'-')} - ${Utils.formatDate(ev.evaluation_date)}</div></div>
<div style="display:flex;gap:10px;flex-wrap:wrap">
${Perms.can('approve_evaluation') && !ev.approved ? `<button class="btn btn-info" id="approve-eval-btn">✓ اعتماد التقييم</button>` : ''}
${ev.approved ? '<span class="badge badge-success" style="padding:8px 14px">✓ معتمد</span>' : ''}
<button class="btn btn-secondary" data-nav="evaluations">← رجوع</button>
</div>
</div>
<div class="stats-grid">
<div class="stat-card"><div class="stat-icon" style="background:var(--primary)">👤</div><div class="stat-value" style="font-size:16px">${Utils.escape(emp?emp.full_name:'-')}</div><div class="stat-label">الموظف</div></div>
<div class="stat-card"><div class="stat-icon" style="background:var(--info)">👨‍💼</div><div class="stat-value" style="font-size:16px">${Utils.escape(evr?evr.full_name:'-')}</div><div class="stat-label">المقيِّم</div></div>
<div class="stat-card"><div class="stat-icon" style="background:var(--success)">⭐</div><div class="stat-value">${ev.percentage}%</div><div class="stat-label">${ev.total_score}/100 - ${ev.grade}</div></div>
<div class="stat-card"><div class="stat-icon" style="background:${ev.status==='ناجح'?'var(--success)':'var(--danger)'}">${ev.status==='ناجح'?'✓':'✗'}</div><div class="stat-value" style="font-size:20px">${ev.status}</div><div class="stat-label">الحالة</div></div>
</div>
${ev.notes ? `<div class="alert alert-info"><strong>ملاحظات إضافية:</strong> ${Utils.escape(ev.notes)}</div>` : ''}
${isPositive ? `
<div class="alert" style="background:linear-gradient(to left,#d1fae5,#ecfdf5);border:2px solid #10b981;color:#065f46;padding:14px 18px;margin-bottom:18px;border-radius:12px;display:flex;align-items:center;gap:14px">
<div style="font-size:36px">✅</div>
<div>
<div style="font-size:18px;font-weight:800;margin-bottom:4px">تقييم إيجابي - لا يوجد ملاحظات</div>
<div style="font-size:13px">تمت مراجعة أداء الموظف ولم يتم رصد أي ملاحظات أو أخطاء.</div>
</div>
</div>` : ''}
<div class="grid grid-2" style="margin-bottom:20px">
<div class="card" style="border-right:4px solid ${isPositive?'var(--success)':'var(--info)'}">
<div class="card-header"><div class="card-title">🔍 الملاحظة المرصودة</div></div>
<div class="card-body">
<div style="font-size:16px;font-weight:700;color:${isPositive?'var(--success)':'var(--text)'}">${isPositive?'✅ ':''}${Utils.escape(ev.observed_issue || ev.call_type || '-')}</div>
${ev.observed_issue === 'أخرى' && ev.observed_issue_other ? `<div style="margin-top:8px;color:var(--muted);background:#f1f5f9;padding:10px;border-radius:8px">${Utils.escape(ev.observed_issue_other)}</div>` : ''}
</div>
</div>
<div class="card" style="border-right:4px solid var(--warning)">
<div class="card-header"><div class="card-title">⚖️ الإجراء المتخذ</div></div>
<div class="card-body">
${ev.action_taken ? `
<div style="font-size:16px;font-weight:700;color:var(--text)">${Utils.escape(ev.action_taken)}</div>
${ev.action_taken === 'أخرى' && ev.action_taken_other ? `<div style="margin-top:8px;color:var(--muted);background:#f1f5f9;padding:10px;border-radius:8px">${Utils.escape(ev.action_taken_other)}</div>` : ''}
` : '<div style="color:var(--danger);font-weight:600">⚠️ لم يتم تحديد الإجراء بعد</div>'}
</div>
</div>
</div>`;
};

window.UI.attachViewEvaluationHandlers = function(id) {
  const apprBtn = document.getElementById('approve-eval-btn');
  if (apprBtn) apprBtn.addEventListener('click', async () => {
    try {
      await DB.evaluations.approve(parseInt(id));
      Toast.success('تم اعتماد التقييم');
      window.App.navigate('view-evaluation', { id: parseInt(id) });
    } catch(err) { Toast.error(err.message); }
  });
};
