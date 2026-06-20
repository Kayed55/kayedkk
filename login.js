/**
 * Login Page
 */

window.UI = window.UI || {};

window.UI.renderLogin = function() {
  return `
<div class="login-page">
  <div class="login-card">
    <div class="login-logo">${window.MAHZAM_LOGO_SVG}</div>
    <div class="login-header">
      <h1 style="color:#06579F;font-weight:800">${window.SYSTEM_NAME}</h1>
      <p style="font-size:14px;color:#475569;margin-top:8px;font-weight:600">${window.COMPANY_NAME} • Mahzam</p>
      <div style="height:3px;width:60px;background:linear-gradient(to left,#06579F,#202E4D);margin:14px auto;border-radius:2px"></div>
    </div>
    <form id="login-form">
      <div class="form-group">
        <label class="form-label">📧 البريد الإلكتروني</label>
        <input type="email" class="form-control" id="login-email" required placeholder="admin@example.com" autocomplete="email">
      </div>
      <div class="form-group">
        <label class="form-label">🔒 كلمة المرور</label>
        <input type="password" class="form-control" id="login-password" required placeholder="••••••••" autocomplete="current-password">
      </div>
      <div style="text-align:left;margin-bottom:12px"><a href="#" id="forgot-pw-link" style="color:var(--primary);font-size:13px;text-decoration:none;font-weight:600">🔑 نسيت كلمة المرور؟</a></div>
      <button type="submit" class="btn btn-primary" style="width:100%;padding:12px;font-size:15px">دخول</button>
    </form>
    <div style="margin-top:22px;padding:16px;background:linear-gradient(135deg,#06579F,#202E4D);color:white;border-radius:12px;text-align:center">
      <div style="font-size:15px;font-weight:700;margin-bottom:4px">🌟 مرحباً بكم في ${window.SYSTEM_NAME}</div>
      <div style="font-size:12px;opacity:0.9">${window.COMPANY_NAME} - منظومة متكاملة لإدارة جودة الأداء</div>
    </div>
    <details style="margin-top:14px">
      <summary style="cursor:pointer;font-size:12px;color:var(--muted);font-weight:600">عرض الحسابات التجريبية</summary>
      <div class="alert alert-info" style="margin-top:8px;font-size:12px">
        المدير: <code>admin@example.com / Admin@123</code><br>
        موظف الجودة: <code>quality@example.com / Quality@123</code><br>
        المشرف: <code>supervisor@example.com / Super@123</code><br>
        موظف: <code>emp001@example.com / Emp@123A!</code>
      </div>
    </details>
  </div>
</div>`;
};

window.UI.attachLoginHandlers = function() {
  const form = document.getElementById('login-form');
  if (!form) return;

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    try {
      const user = await Auth.login(email, password);
      Toast.success('مرحباً بك ' + user.full_name);
      if (user.must_change_password) {
        Toast.warning('يجب تغيير كلمة المرور');
        window.App.navigate('profile');
      } else {
        window.App.navigate('dashboard');
      }
    } catch(err) {
      Toast.error(err.message);
    }
  });

  const forgot = document.getElementById('forgot-pw-link');
  if (forgot) forgot.addEventListener('click', e => {
    e.preventDefault();
    window.UI.showForgotPasswordModal();
  });
};

window.UI.showForgotPasswordModal = function() {
  const body = `
<div id="forgot-step1">
  <div class="alert alert-info" style="margin-bottom:14px;font-size:13px">
    📧 أدخل البريد الإلكتروني المسجل، وسيتم إنشاء كلمة مرور مؤقتة وعرضها لك (محاكاة لإرسال البريد).
    <br><small style="color:var(--muted)">في الأنظمة الحقيقية، يتم إرسال الرمز عبر البريد الإلكتروني.</small>
  </div>
  <div class="form-group">
    <label class="form-label">البريد الإلكتروني</label>
    <input type="email" class="form-control" id="fp-email" placeholder="your@email.com" autocomplete="email">
  </div>
</div>
<div id="forgot-step2" style="display:none">
  <div class="alert alert-success" style="margin-bottom:14px">✅ تم إنشاء كلمة مرور مؤقتة. استخدمها لتسجيل الدخول وغيّرها مباشرة.</div>
  <div class="form-group">
    <label class="form-label">كلمة المرور المؤقتة</label>
    <input class="form-control" id="fp-temp" readonly style="font-family:monospace;font-size:16px;font-weight:700;color:var(--primary);text-align:center;background:#f1f5f9">
  </div>
</div>`;
  const footer = `<button class="btn btn-secondary" onclick="Modal.close()">إغلاق</button><button class="btn btn-primary" id="fp-send">إرسال</button>`;
  Modal.show('🔑 استعادة كلمة المرور', body, footer);

  document.getElementById('fp-send').addEventListener('click', async () => {
    const step1 = document.getElementById('forgot-step1');
    if (step1.style.display !== 'none') {
      const email = document.getElementById('fp-email').value.trim();
      try {
        const tempPw = await Auth.forgotPassword(email);
        step1.style.display = 'none';
        document.getElementById('forgot-step2').style.display = 'block';
        document.getElementById('fp-temp').value = tempPw;
        const btn = document.getElementById('fp-send');
        btn.textContent = 'تم';
        btn.disabled = true;
      } catch(err) {
        Toast.error(err.message);
      }
    }
  });
};
