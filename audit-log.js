/**
 * Audit Log Page
 */

window.UI = window.UI || {};

window.UI.renderAuditLog = async function() {
  if (!Perms.can('view_audit_log')) return '<div class="alert alert-danger">غير مصرح</div>';
  const logs = await DB.audit.list({ limit: 500 });

  const labels = {
    create_evaluation: 'إنشاء تقييم',
    update_evaluation: 'تعديل تقييم',
    delete_evaluation: 'حذف تقييم',
    approve_evaluation: 'اعتماد تقييم',
    submit_objection: 'تقديم اعتراض',
    resolve_objection: 'البت في اعتراض',
    create_user: 'إنشاء مستخدم',
    update_user: 'تعديل مستخدم',
    deactivate_user: 'تعطيل مستخدم',
    reset_password: 'إعادة تعيين كلمة المرور',
    change_password: 'تغيير كلمة المرور',
    login: 'تسجيل دخول',
    logout: 'تسجيل خروج',
    failed_login: 'محاولة فاشلة',
    supervisor_action: 'إجراء مشرف'
  };

  const rows = logs.map(l => `<tr>
<td>${Utils.formatDateTime(l.timestamp)}</td>
<td>${Utils.escape(l.user_name || '-')}</td>
<td>${Utils.roleBadge(l.role)}</td>
<td>${labels[l.action] || l.action}</td>
<td>${Utils.escape(l.entity_type)}${l.entity_id?' #'+l.entity_id:''}</td>
<td>${Utils.escape(l.details)}</td>
</tr>`).join('');

  return `
<div class="page-header">
<div><div class="page-title">📜 سجل العمليات</div><div class="page-subtitle">${logs.length} عملية مسجّلة</div></div>
</div>
<div class="card">
<table class="table">
<thead><tr><th>التاريخ</th><th>المستخدم</th><th>الدور</th><th>العملية</th><th>العنصر</th><th>التفاصيل</th></tr></thead>
<tbody>${rows || '<tr><td colspan="6" style="text-align:center;padding:30px">لا توجد عمليات</td></tr>'}</tbody>
</table>
</div>`;
};
