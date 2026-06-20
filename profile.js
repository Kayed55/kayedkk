/**
 * Profile Page
 */

window.UI = window.UI || {};

window.UI.renderProfile = async function() {
  const u = await DB.users.getById(window.currentUser.id);
  return `
<div class="page-header">
<div><div class="page-title">👤 الملف الشخصي</div></div>
</div>
<div class="grid grid-2">
<div class="card">
<div class="card-header"><div class="card-title">معلومات الحساب</div></div>
<div class="card-body">
<form id="prof-form">
<div class="form-group"><label class="form-label">الاسم</label><input class="form-control" id="prof-name" value="${Utils.escape(u.full_name)}"></div>
<div class="form-group"><label class="form-label">البريد</label><input type="email" class="form-control" value="${Utils.escape(u.email)}" disabled></div>
<div class="form-group"><label class="form-label">الجوال</label><input class="form-control" id="prof-phone" value="${Utils.escape(u.phone||'')}"></div>
<div class="form-group"><label class="form-label">الدور</label><input class="form-control" value="${Utils.roleLabel(u.role)}" disabled></div>
<button type="submit" class="btn btn-primary">💾 حفظ</button>
</form>
</div>
</div>
<div class="card">
<div class="card-header"><div class="card-title">🔒 تغيير كلمة المرور</div></div>
<div class="card-body">
${u.must_change_password?'<div class="alert alert-warning">⚠️ يجب تغيير كلمة المرور المؤقتة</div>':''}
<form id="pw-form">
<div class="form-group"><label class="form-label">كلمة المرور الحالية</label><input type="password" class="form-control" id="pw-cur" required></div>
<div class="form-group"><label class="form-label">كلمة المرور الجديدة</label><input type="password" class="form-control" id="pw-new" required></div>
<div class="form-group"><label class="form-label">تأكيد</label><input type="password" class="form-control" id="pw-conf" required></div>
<div style="background:#f1f5f9;padding:10px;border-radius:8px;font-size:12px;color:var(--muted);margin-bottom:12px">
8 أحرف على الأقل + حرف + رقم + رمز خاص
</div>
<button type="submit" class="btn btn-warning">🔑 تغيير</button>
</form>
</div>
</div>
</div>`;
};

window.UI.attachProfileHandlers = function() {
  const f = document.getElementById('prof-form');
  if (f) f.addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await DB.users.update(window.currentUser.id, {
        full_name: document.getElementById('prof-name').value.trim(),
        phone: document.getElementById('prof-phone').value.trim()
      });
      Toast.success('تم الحفظ');
    } catch(err) { Toast.error(err.message); }
  });

  const pw = document.getElementById('pw-form');
  if (pw) pw.addEventListener('submit', async e => {
    e.preventDefault();
    const u = await DB.users.getById(window.currentUser.id);
    const cur = document.getElementById('pw-cur').value;
    const np = document.getElementById('pw-new').value;
    const cp = document.getElementById('pw-conf').value;
    if (u.password !== cur) { Toast.error('كلمة المرور الحالية غير صحيحة'); return; }
    if (np !== cp) { Toast.error('كلمتا المرور غير متطابقتين'); return; }
    if (np === cur) { Toast.error('يجب أن تختلف عن الحالية'); return; }
    const vp = Utils.validatePassword(np);
    if (!vp.valid) { Toast.error(vp.errors[0]); return; }
    try {
      await DB.users.changePassword(window.currentUser.id, np);
      Toast.success('تم تغيير كلمة المرور');
      pw.reset();
    } catch(err) { Toast.error(err.message); }
  });
};
