/**
 * Users Management Page
 */

window.UI = window.UI || {};

window.UI.renderUsersAdmin = async function() {
  const users = (await DB.users.list()).filter(u => u.role !== 'employee');
  const rows = users.map(u => `<tr>
<td>${u.id}</td>
<td>${Utils.escape(u.full_name)}</td>
<td><div style="font-size:13px;direction:ltr;text-align:right">${Utils.escape(u.email||'-')}</div></td>
<td>${Utils.roleBadge(u.role)}</td>
<td>${u.is_active?'<span class="badge badge-success">نشط</span>':'<span class="badge badge-danger">معطّل</span>'}</td>
<td>${Utils.formatDate(u.created_at)}</td>
<td>
<button class="btn btn-sm btn-warning" data-edit-user="${u.id}">تعديل</button>
<button class="btn btn-sm btn-info" data-reset-pw="${u.id}">🔑</button>
</td>
</tr>`).join('');

  return `
<div class="page-header">
<div><div class="page-title">🛡️ إدارة المستخدمين</div><div class="page-subtitle">إدارة الحسابات (مدير، موظف جودة، مشرف)</div></div>
<button class="btn btn-primary" id="add-user-btn">➕ إضافة مستخدم</button>
</div>
<div class="card">
<table class="table">
<thead><tr><th>#</th><th>الاسم</th><th>البريد</th><th>الدور</th><th>الحالة</th><th>تاريخ الإنشاء</th><th>إجراءات</th></tr></thead>
<tbody>${rows || '<tr><td colspan="7" style="text-align:center;padding:20px">لا توجد بيانات</td></tr>'}</tbody>
</table>
</div>`;
};

window.UI.showUserModal = async function(editId = null) {
  const ed = editId ? await DB.users.getById(editId) : null;
  const body = `<form id="usr-form">
<div class="grid grid-2">
<div class="form-group"><label class="form-label">الاسم الكامل *</label><input class="form-control" id="usr-name" required value="${ed?Utils.escape(ed.full_name):''}"></div>
<div class="form-group"><label class="form-label">📧 البريد *</label><input type="email" class="form-control" id="usr-email" required value="${ed?Utils.escape(ed.email||''):''}"></div>
<div class="form-group"><label class="form-label">📱 الجوال</label><input class="form-control" id="usr-phone" value="${ed?Utils.escape(ed.phone||''):''}"></div>
<div class="form-group"><label class="form-label">القسم</label><input class="form-control" id="usr-dept" value="${ed?Utils.escape(ed.department||''):'قسم الجودة'}"></div>
<div class="form-group"><label class="form-label">المسمى</label><input class="form-control" id="usr-pos" value="${ed?Utils.escape(ed.position||''):''}"></div>
<div class="form-group"><label class="form-label">الدور *</label>
<select class="form-control" id="usr-role" ${ed?'disabled':''}>
<option value="supervisor" ${ed&&ed.role==='supervisor'?'selected':''}>👨‍💼 مشرف</option>
<option value="quality_officer" ${ed&&ed.role==='quality_officer'?'selected':''}>⚖️ موظف الجودة</option>
<option value="admin" ${ed&&ed.role==='admin'?'selected':''}>👑 مدير</option>
</select></div>
${!ed?`<div class="form-group"><label class="form-label">🔒 كلمة المرور *</label><input type="password" class="form-control" id="usr-pass" required placeholder="8 أحرف + حرف + رقم + رمز"></div>`:''}
</div>
</form>`;
  const footer = `<button class="btn btn-secondary" onclick="Modal.close()">إلغاء</button><button class="btn btn-primary" id="usr-save">${ed?'حفظ':'إضافة'}</button>`;
  Modal.show(ed?'تعديل':'إضافة مستخدم جديد', body, footer);

  document.getElementById('usr-save').addEventListener('click', async () => {
    const data = {
      full_name: document.getElementById('usr-name').value.trim(),
      email: document.getElementById('usr-email').value.trim(),
      phone: document.getElementById('usr-phone').value.trim(),
      department: document.getElementById('usr-dept').value.trim(),
      position: document.getElementById('usr-pos').value.trim(),
      role: document.getElementById('usr-role').value
    };
    if (!data.full_name || !data.email) { Toast.error('الحقول المطلوبة'); return; }
    if (!Utils.validateEmail(data.email)) { Toast.error('بريد غير صالح'); return; }
    try {
      if (ed) {
        await DB.users.update(editId, data);
        Toast.success('تم الحفظ');
      } else {
        const password = document.getElementById('usr-pass').value;
        const vp = Utils.validatePassword(password);
        if (!vp.valid) { Toast.error(vp.errors[0]); return; }
        await DB.users.create({
          ...data, password, username: data.email.split('@')[0], must_change_password: false
        });
        Toast.success('تم الإضافة');
      }
      Modal.close();
      window.App.navigate('users');
    } catch(err) { Toast.error(err.message); }
  });
};

window.UI.attachUsersHandlers = function() {
  const add = document.getElementById('add-user-btn');
  if (add) add.addEventListener('click', () => window.UI.showUserModal());
  document.querySelectorAll('[data-edit-user]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    window.UI.showUserModal(parseInt(b.dataset.editUser));
  }));
  document.querySelectorAll('[data-reset-pw]').forEach(b => b.addEventListener('click', async e => {
    e.stopPropagation();
    const id = parseInt(b.dataset.resetPw);
    if (confirm('إعادة تعيين كلمة المرور؟')) {
      try {
        const pw = await DB.users.resetPassword(id);
        alert(`كلمة المرور المؤقتة:\n\n${pw}`);
        Toast.success('تم');
      } catch(err) { Toast.error(err.message); }
    }
  }));
};
