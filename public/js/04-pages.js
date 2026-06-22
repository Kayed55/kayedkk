/*!
 * نظام الجودة للتقييم والتدريب - شركة محزم
 *
 * Module: UI Pages & Exports
 * Contains: Routing, Login, Layout, Dashboard, Employees, Evaluations,
 *           Reports, Objections, Audit Log, Users, Profile, Settings,
 *           PDF & Excel export utilities
 *
 * @module pages
 * @copyright (c) 2026 Mahzam Co.
 */
'use strict';

// ============================================
// State + Router
// ============================================
let currentUser = null;
let currentPage = 'login';
let currentParams = {};
let charts = [];
// تنقّل الأقسام: تتبّع التعديلات غير المحفوظة + حارس "آخر طلب يفوز" + debounce
let _formDirty = false;
let _navToken = 0;
let _navDebounce = null;
const _FORM_PAGES = ['new-evaluation', 'edit-evaluation'];
// عناوين الأقسام — تُستخدم في الشريط العلوي وفي عنوان تبويب المتصفّح
const PAGE_TITLES = {dashboard:'لوحة التحكم', employees:'إدارة الموظفين', 'view-employee':'بيانات الموظف', evaluations:'التقييمات', 'new-evaluation':'تقييم جديد', 'view-evaluation':'تفاصيل التقييم', 'edit-evaluation':'تعديل التقييم', reports:'التقارير', 'monthly-report':'التقرير الشهري', 'actions-report':'تقرير الإجراءات المتخذة', 'errors-report':'الأخطاء المتكررة الشهرية', objections:'الاعتراضات', 'view-objection':'تفاصيل الاعتراض', 'new-objection':'تقديم اعتراض', 'audit-log':'سجل العمليات', users:'إدارة المستخدمين', profile:'الملف الشخصي', notifications:'الإشعارات', settings:'الإعدادات', login:'تسجيل الدخول'};

function destroyCharts() {
charts.forEach(c => { try { c.destroy(); } catch(e){} });
charts = [];
}

function navigate(page, params={}) {
destroyCharts();
_formDirty = false;   // صفحة جديدة = لا تعديلات معلّقة
currentPage = page;
currentParams = params;
// عنوان تبويب المتصفّح يتغيّر حسب القسم
document.title = (PAGE_TITLES[page] ? PAGE_TITLES[page] + ' | ' : '') + 'نظام الجودة - شركة محزم';
const app = document.getElementById('app');

if (page === 'login') { app.innerHTML = renderLogin(); attachLogin(); return; }
if (!currentUser) { navigate('login'); return; }

const pages = {
'dashboard': renderDashboard,
'employees': renderEmployees,
'view-employee': () => renderViewEmployee(params.id),
'evaluations': renderEvaluations,
'new-evaluation': renderNewEvaluation,
'view-evaluation': () => renderViewEvaluation(params.id),
'edit-evaluation': () => renderEditEvaluation(params.id),
'reports': renderReports,
'monthly-report': renderMonthlyReport,
'actions-report': renderActionsReport,
'errors-report': renderErrorsReport,
'objections': renderObjections,
'view-objection': () => renderViewObjection(params.id),
'new-objection': () => renderNewObjection(params.evaluation_id),
'audit-log': renderAuditLog,
'users': renderUsersAdmin,
'profile': renderProfile,
'notifications': renderNotificationsPage,
'settings': () => renderSettings(params.tab || 'form')
};
const fn = pages[page] || pages['dashboard'];
app.innerHTML = renderLayout(fn());
attachLayoutHandlers();
attachPageHandlers(page);
}

// ============================================
// جلسة المصادقة (المرحلة 1): رمز الخادم في localStorage
// ============================================
// يُرجع رمز الجلسة الصالح، أو null إن لم يوجد/انتهى.
function getSessionToken() {
const token = localStorage.getItem('mahzam_session_token');
if (!token) return null;
const exp = localStorage.getItem('mahzam_session_expires_at');
if (exp && new Date(exp).getTime() <= Date.now()) { clearSession(); return null; }
return token;
}
// مسح بيانات الجلسة (عند الخروج اليدوي أو انتهاء الرمز / 401 مستقبلي).
function clearSession() {
localStorage.removeItem('mahzam_session_token');
localStorage.removeItem('mahzam_session_expires_at');
}
if (typeof window !== 'undefined') { window.getSessionToken = getSessionToken; window.clearSession = clearSession; }

function logout() {
currentUser = null;
localStorage.removeItem('qe_current_user');
clearSession();
navigate('login');
}

// تسجيل حدث عميل في التدقيق عبر RPC (fire-and-forget) — بديل addAudit بعد سحب anon
function logEvent(action, details, entityType, entityId) {
try {
if (window.sb && window.sb.rpc) {
window.sb.rpc('log_event', {
p_session_token: (window.getSessionToken ? window.getSessionToken() : null),
p_action: action, p_entity_type: entityType || 'login',
p_entity_id: (entityId == null ? null : entityId), p_details: details || ''
}).then(function(){}, function(){});
} else if (typeof DB !== 'undefined' && DB.addAudit) {
DB.addAudit({ action: action, entity_type: entityType || 'login', entity_id: entityId || null, details: details });
}
} catch (_) {}
}

// ============================================
// تنقّل الأقسام (القائمة الجانبية): جلب طازج + مؤشّر تحميل + حُرّاس
// ============================================
// تتبّع وجود تعديلات غير محفوظة داخل صفحات النماذج فقط (يُربط مرّة واحدة)
if (!window.__dirtyTrackerBound) {
window.__dirtyTrackerBound = true;
const markDirty = e => {
if (_FORM_PAGES.indexOf(currentPage) !== -1 && e.target && e.target.closest && e.target.closest('.content')) {
_formDirty = true;
}
};
document.addEventListener('input', markDirty);
document.addEventListener('change', markDirty);
}

// نقطة الدخول الموحّدة من القائمة الجانبية (مع debounce 200ms ضد النقر المتسارع)
function navigateToSection(page, params) {
if (_navDebounce) clearTimeout(_navDebounce);
_navDebounce = setTimeout(() => _doNavigateToSection(page, params || {}), 200);
}

async function _doNavigateToSection(page, params) {
// حارس التعديلات غير المحفوظة
if (_formDirty && !confirm('لديك تعديلات لم تُحفظ. هل تريد المغادرة دون حفظ؟')) return;
_formDirty = false;
const token = ++_navToken;                    // "آخر طلب يفوز" ضد التنقّل المتسارع
const c = document.querySelector('.content'); // أبقِ القائمة والهيدر، بدّل المحتوى فقط
if (c) c.innerHTML = `<div class="section-loading"><div class="spinner"></div><div>جاري تحميل أحدث البيانات…</div></div>`;
try {
// جلب طازج من القاعدة قبل العرض (يُحدّث DB.data بالكامل = كل الأقسام)
if (window.sb && window.SupabaseSync && typeof SupabaseSync.pullAll === 'function') {
const ok = await SupabaseSync.pullAll();
if (token !== _navToken) return;            // ألغاه تنقّل أحدث
if (ok === false) { _sectionError(page, params); return; }
}
if (token !== _navToken) return;
navigate(page, params);
} catch (err) {
if (token !== _navToken) return;
console.error('section load failed:', err);
_sectionError(page, params);
}
}

function _sectionError(page, params) {
const c = document.querySelector('.content');
if (!c) return;
c.innerHTML = `<div class="section-error"><div style="font-size:44px">⚠️</div>
<div style="font-weight:800;font-size:16px">تعذّر تحميل البيانات</div>
<div style="color:var(--muted);font-size:13px">تحقّق من اتصال الإنترنت ثم أعد المحاولة.</div>
<button class="btn btn-primary" id="sec-retry">🔄 إعادة المحاولة</button></div>`;
const r = document.getElementById('sec-retry');
if (r) r.addEventListener('click', () => navigateToSection(page, params));
}

// مربّع تأكيد خطر (زر تأكيد أحمر + إلغاء) — يُرجع Promise<boolean>
function confirmDanger(message, confirmLabel) {
return new Promise(resolve => {
const body = `<div style="font-size:15px;line-height:1.9;color:var(--text)">${message}</div>`;
const footer = `<button class="btn btn-secondary" id="cd-cancel">إلغاء</button><button class="btn btn-danger" id="cd-ok">${confirmLabel||'🗑️ حذف نهائي'}</button>`;
Modal.show('⚠️ تأكيد الحذف', body, footer);
let done = false;
const finish = v => { if (done) return; done = true; Modal.close(); resolve(v); };
const ok = document.getElementById('cd-ok');
const cancel = document.getElementById('cd-cancel');
if (ok) ok.addEventListener('click', () => finish(true));
if (cancel) cancel.addEventListener('click', () => finish(false));
// إغلاق المودال بأي طريقة أخرى (× / الخلفية / Escape) = إلغاء
const ov = document.querySelector('#modal-container .modal-overlay');
if (ov) ov.addEventListener('click', e => { if (e.target === ov) finish(false); });
});
}

// معالج حذف تقييم موحّد: صلاحية → تأكيد أحمر → حذف ذرّي → تنقّل لتحديث كل الأقسام
// معالجة موحّدة لنتائج RPC المرفوضة بسبب الجلسة/الصلاحية
// تُرجع 'expired' (سجّلت الخروج) أو 'forbidden' أو null (ليس خطأ مصادقة)
function handleSessionError(message) {
const m = message || '';
if (m.indexOf('انتهت الجلسة') !== -1 || m.indexOf('الرمز غير صالح') !== -1) {
clearSession();
Toast.error('انتهت جلستك، يرجى تسجيل الدخول مجدداً');
if (typeof navigate === 'function') navigate('login');
return 'expired';
}
if (m.indexOf('ليس لديك صلاحية') !== -1 || m.indexOf('للمدير فقط') !== -1) {
Toast.error('ليس لديك صلاحية لهذه العملية');
return 'forbidden';
}
return null;
}

// حفظ معايير التقييم عبر RPC مُصادَق (admin) — يُرجع true عند النجاح
async function saveCriteriaViaRPC() {
if (window.sb && window.sb.rpc) {
const { data, error } = await window.sb.rpc('admin_update_criteria', {
p_session_token: (window.getSessionToken ? window.getSessionToken() : null),
p_criteria: CRITERIA
});
const row = (!error && Array.isArray(data) && data[0]) ? data[0] : null;
if (!row || !row.ok) { const msg=(row&&row.message)||(error&&error.message)||'تعذّر حفظ المعايير'; const h=handleSessionError(msg); if(!h) Toast.error(msg); return false; }
// مزامنة الحالة المحلية دون دفع upsert مباشر
try { DB.data.criteria = CRITERIA; localStorage.setItem(DB.KEY || 'qe_system_v6', JSON.stringify(DB.data)); } catch(_){}
return true;
}
DB.saveCriteria(CRITERIA); // مسار محلي احتياطي (بدون Supabase)
return true;
}

// حسم اعتراض عبر RPC مُصادَق (قبول/رفض) — يُرجع true عند النجاح
async function resolveObjectionViaRPC(oid, decision, resp) {
if (window.sb && window.sb.rpc) {
const { data, error } = await window.sb.rpc('admin_resolve_objection', {
p_session_token: (window.getSessionToken ? window.getSessionToken() : null),
p_objection_id: oid, p_decision: decision, p_response: resp
});
const row = (!error && Array.isArray(data) && data[0]) ? data[0] : null;
if (!row || !row.ok) { const msg=(row&&row.message)||(error&&error.message)||'تعذّر حسم الاعتراض'; const h=handleSessionError(msg); if(!h) Toast.error(msg); return false; }
if (window.SupabaseSync && SupabaseSync.pullAll) { try{ await SupabaseSync.pullAll(); }catch(_){} }
return true;
}
DB.resolveObjection(oid, decision, resp); // مسار محلي احتياطي
return true;
}

async function handleDeleteEval(btn, navTarget, navParams) {
if (!Perms.can('delete_evaluation')) { Toast.error('🚫 ليس لديك صلاحية لحذف التقييمات'); return; }
const id = parseInt(btn.dataset.delEval);
const ok = await confirmDanger('هل أنت متأكد من حذف هذا التقييم؟<br>سيُحذف <b>نهائياً</b> من جميع التقارير والإحصائيات ولوحة التحكم وملف الموظف والاعتراضات المرتبطة، <b>ولا يمكن التراجع</b>.');
if (!ok) return;
if (btn.dataset.busy === '1') return;
btn.dataset.busy = '1'; btn.disabled = true; const orig = btn.textContent; btn.textContent = 'جاري الحذف...';
const restore = () => { btn.disabled = false; btn.textContent = orig; btn.dataset.busy = '0'; };
try {
const res = await DB.deleteEvaluation(id);
if (!res || !res.ok) {
const handled = handleSessionError(res && res.message);
if (!handled) Toast.error((res && res.message) || 'تعذّر الحذف');
restore();
return;
}
Toast.success('✓ تم حذف التقييم نهائياً' + (res.deleted_objections ? ` (ومعه ${res.deleted_objections} اعتراض مرتبط)` : ''));
if (typeof navigate === 'function') navigate(navTarget || 'evaluations', navParams || {});
} catch (err) {
console.error('delete eval failed:', err);
Toast.error('تعذّر الحذف — حاول مجدداً');
restore();
}
}

// ============================================
// Login
// ============================================
function renderLogin() {
return `
<div class="login-page">
<div class="login-card">
<div class="login-logo">${MAHZAM_LOGO_SVG}</div>
<div class="login-header">
<h1 style="color:#06579F;font-weight:800">${SYSTEM_NAME}</h1>
<p style="font-size:14px;color:#475569;margin-top:8px;font-weight:600">${COMPANY_NAME} • Mahzam</p>
<div style="height:3px;width:60px;background:linear-gradient(to left,#06579F,#202E4D);margin:14px auto;border-radius:2px"></div>
</div>
<form id="login-form">
<div class="form-group">
<label class="form-label">📧 البريد الإلكتروني</label>
<input type="email" class="form-control" id="login-email" required placeholder="your.email@company.com" autocomplete="email">
</div>
<div class="form-group">
<label class="form-label">🔒 كلمة المرور</label>
<input type="password" class="form-control" id="login-password" required placeholder="••••••••" autocomplete="current-password">
</div>
<div style="text-align:left;margin-bottom:12px"><a href="#" id="forgot-pw-link" style="color:var(--primary);font-size:13px;text-decoration:none;font-weight:600">🔑 نسيت كلمة المرور؟</a></div>
<button type="submit" class="btn btn-primary" style="width:100%;padding:12px;font-size:15px">دخول</button>
</form>
<div style="margin-top:22px;padding:16px;background:linear-gradient(135deg,#06579F,#202E4D);color:white;border-radius:12px;text-align:center">
<div style="font-size:15px;font-weight:700;margin-bottom:4px">🌟 مرحباً بكم في ${SYSTEM_NAME}</div>
<div style="font-size:12px;opacity:0.9">${COMPANY_NAME} - منظومة متكاملة لإدارة جودة الأداء</div>
</div>
</div>
</div>`;
}

// State pending OTP verification (between step 1 and step 2)
let _pendingOTP = null; // { user_id, user_email, user_name, masked_email, expires_at, requested_at }
let _otpTimer = null;

function attachLogin() {
const form = document.getElementById('login-form');
if (!form) return;
// منع تكرار event listener عند إعادة الرسم
if (form.dataset.bound === '1') return;
form.dataset.bound = '1';

form.addEventListener('submit', async e => {
e.preventDefault();
const btn = form.querySelector('button[type=submit]');
const email = document.getElementById('login-email').value.trim();
const password = document.getElementById('login-password').value;
if (!Utils.validateEmail(email)) { Toast.error('البريد الإلكتروني غير صالح'); return; }
if (btn && btn.dataset.busy === '1') return;
if (btn) { btn.dataset.busy='1'; btn.disabled = true; btn.textContent = 'جاري التحقق...'; }

try {
// === الخطوة 1: طلب كود OTP من Supabase ===
let codeData = null;
if (window.sb && window.sb.rpc) {
try {
const { data, error } = await window.sb.rpc('request_login_code', { p_email: email, p_password: password });
if (error) { console.warn('RPC request_login_code error:', error.message); }
if (Array.isArray(data) && data.length) codeData = data[0];
} catch(e) { console.warn('RPC request_login_code failed:', e && e.message); }
}

// مسار احتياطي محلي (لو Supabase غير متاح)
if (!codeData) {
const local = DB.getUserByEmail(email);
if (local && local.password === password && local.is_active && local.email) {
const code = String(Math.floor(100000 + Math.random()*900000));
codeData = {
ok: true,
user_id: local.id,
user_email: local.email,
user_name: local.full_name,
masked_email: local.email.replace(/(.{2}).*(@.*)/, '$1***$2'),
code_to_send: code,
expires_at: new Date(Date.now() + 5*60*1000).toISOString(),
_local: true
};
}
}

if (!codeData || !codeData.ok) {
const msg = (codeData && codeData.message) || 'البريد الإلكتروني أو كلمة المرور غير صحيحة';
Toast.error(msg);
logEvent('failed_login', `محاولة دخول فاشلة - ${email}`);
if (btn) { btn.dataset.busy='0'; btn.disabled = false; btn.textContent = 'دخول'; }
return;
}

// === إرسال الكود عبر EmailJS ===
if (window.EmailService && typeof window.EmailService.sendLoginCodeEmail === 'function') {
try {
const sendRes = await window.EmailService.sendLoginCodeEmail(
{ email: codeData.user_email, full_name: codeData.user_name },
codeData.code_to_send, 5
);
if (sendRes && sendRes.ok) {
Toast.success('تم إرسال كود الدخول إلى بريدك');
} else {
const errMsg = (sendRes && sendRes.error) || 'تعذّر إرسال الكود';
Toast.error('⚠️ ' + errMsg + ' - تواصل مع الإدارة');
if (btn) { btn.dataset.busy='0'; btn.disabled = false; btn.textContent = 'دخول'; }
return;
}
} catch(em) {
console.error('Email send failed:', em);
Toast.error('⚠️ تعذّر إرسال الكود - تواصل مع الإدارة');
if (btn) { btn.dataset.busy='0'; btn.disabled = false; btn.textContent = 'دخول'; }
return;
}
} else {
Toast.error('⚠️ نظام البريد غير مهيّأ - راجع الإدارة');
if (btn) { btn.dataset.busy='0'; btn.disabled = false; btn.textContent = 'دخول'; }
return;
}

// تخزين بيانات OTP المعلّقة والانتقال لشاشة الإدخال
_pendingOTP = {
user_id: codeData.user_id,
user_email: codeData.user_email,
user_name: codeData.user_name,
masked_email: codeData.masked_email,
expires_at: codeData.expires_at,
requested_at: Date.now(),
_localCode: codeData._local ? codeData.code_to_send : null // للوضع المحلي فقط
};
showOTPScreen();
} catch(err) {
console.error('Login step1 error:', err);
Toast.error('حدث خطأ - حاول مرة أخرى');
if (btn) { btn.dataset.busy='0'; btn.disabled = false; btn.textContent = 'دخول'; }
}
});

// Forgot password link
const forgot = document.getElementById('forgot-pw-link');
if (forgot) forgot.addEventListener('click', e => { e.preventDefault(); showForgotPasswordModal(); });
}

// ============================================
// OTP Screen (Step 2)
// ============================================
function showOTPScreen() {
if (!_pendingOTP) { navigate('login'); return; }
const app = document.getElementById('app');
app.innerHTML = `
<div class="login-page">
<div class="login-card">
<div class="login-logo">${MAHZAM_LOGO_SVG}</div>
<div class="login-header">
<h1 style="color:#06579F;font-weight:800;font-size:22px">🔐 التحقق الثنائي</h1>
<p style="font-size:14px;color:#475569;margin-top:10px;font-weight:600">
أرسلنا كوداً مكوّناً من 6 أرقام إلى:<br>
<strong style="color:#06579F;direction:ltr;display:inline-block;margin-top:4px;font-family:monospace">${Utils.escape(_pendingOTP.masked_email)}</strong>
</p>
<div style="height:3px;width:60px;background:linear-gradient(to left,#06579F,#202E4D);margin:14px auto;border-radius:2px"></div>
</div>
<form id="otp-form">
<div class="form-group">
<label class="form-label" style="text-align:center;display:block;margin-bottom:10px">📨 أدخل الكود</label>
<input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6"
class="form-control" id="otp-code" required autocomplete="one-time-code"
placeholder="000000"
style="text-align:center;font-size:24px;letter-spacing:8px;font-family:monospace;font-weight:700;direction:ltr">
</div>
<div id="otp-status" style="text-align:center;margin-bottom:14px;font-size:13px;color:var(--muted);min-height:18px">
الكود صالح لمدة <span id="otp-countdown" style="color:#06579F;font-weight:700">5:00</span>
</div>
<button type="submit" class="btn btn-primary" style="width:100%;padding:12px;font-size:15px;margin-bottom:10px">تأكيد ودخول</button>
<button type="button" id="otp-resend" class="btn btn-secondary" style="width:100%;padding:10px;font-size:13px" disabled>إعادة إرسال الكود (<span id="resend-countdown">60</span>ث)</button>
<button type="button" id="otp-cancel" class="btn" style="width:100%;padding:8px;font-size:13px;background:transparent;color:#64748b;margin-top:8px">← الرجوع لتسجيل الدخول</button>
</form>
</div>
</div>`;
attachOTPHandlers();
}

function attachOTPHandlers() {
const form = document.getElementById('otp-form');
const codeInput = document.getElementById('otp-code');
const countdownEl = document.getElementById('otp-countdown');
const statusEl = document.getElementById('otp-status');
const resendBtn = document.getElementById('otp-resend');
const resendCountEl = document.getElementById('resend-countdown');
const cancelBtn = document.getElementById('otp-cancel');

if (codeInput) {
codeInput.focus();
codeInput.addEventListener('input', e => {
e.target.value = e.target.value.replace(/[^0-9]/g, '').slice(0,6);
});
}

// Countdown timer
if (_otpTimer) clearInterval(_otpTimer);
let resendSec = 60;
_otpTimer = setInterval(() => {
const expires = new Date(_pendingOTP.expires_at).getTime();
const remain = Math.max(0, Math.floor((expires - Date.now()) / 1000));
const mins = Math.floor(remain / 60);
const secs = remain % 60;
if (countdownEl) countdownEl.textContent = mins + ':' + String(secs).padStart(2,'0');
if (remain === 0) {
clearInterval(_otpTimer); _otpTimer = null;
if (statusEl) statusEl.innerHTML = '<span style="color:var(--danger);font-weight:700">⏰ انتهت صلاحية الكود</span>';
}
// تفعيل زر إعادة الإرسال بعد 60ث
if (resendSec > 0) {
resendSec--;
if (resendCountEl) resendCountEl.textContent = resendSec;
if (resendSec === 0 && resendBtn) {
resendBtn.disabled = false;
resendBtn.innerHTML = 'إعادة إرسال الكود';
}
}
}, 1000);

// Submit
if (form) {
form.addEventListener('submit', async e => {
e.preventDefault();
const btn = form.querySelector('button[type=submit]');
const code = (codeInput.value || '').trim();
if (code.length !== 6) { Toast.error('الكود يجب أن يكون 6 أرقام'); return; }
if (btn.dataset.busy === '1') return;
btn.dataset.busy='1'; btn.disabled = true; btn.textContent = 'جاري التحقق...';

try {
let result = null;
// مسار Supabase
if (window.sb && window.sb.rpc && !_pendingOTP._localCode) {
const { data, error } = await window.sb.rpc('verify_login_code', {
p_user_id: _pendingOTP.user_id, p_code: code
});
if (error) console.warn('verify_login_code error:', error.message);
if (Array.isArray(data) && data.length) result = data[0];
}
// مسار محلي
if (!result && _pendingOTP._localCode) {
if (_pendingOTP._localCode === code &&
new Date(_pendingOTP.expires_at).getTime() > Date.now()) {
const u = DB.getUser(_pendingOTP.user_id);
result = { ok:true, user_data: u };
} else {
result = { ok:false, message:'كود غير صحيح أو منتهي' };
}
}

if (!result || !result.ok) {
const msg = (result && result.message) || 'كود غير صحيح';
Toast.error(msg);
logEvent('failed_otp', `فشل OTP - ${_pendingOTP.user_email}`, 'login', _pendingOTP.user_id);
codeInput.value=''; codeInput.focus();
btn.dataset.busy='0'; btn.disabled = false; btn.textContent = 'تأكيد ودخول';
return;
}

// نجاح
const u = result.user_data || {};
currentUser = { id:u.id, username:u.username, full_name:u.full_name, role:u.role, email:u.email };
localStorage.setItem('qe_current_user', JSON.stringify(currentUser));
// المرحلة 1 (أمان): حفظ رمز الجلسة من الخادم — يُستخدم للتفويض في المرحلة 2.
if (result.session_token) {
localStorage.setItem('mahzam_session_token', result.session_token);
if (result.session_expires_at) localStorage.setItem('mahzam_session_expires_at', result.session_expires_at);
}
logEvent('login', `دخول مع OTP: ${u.full_name} (${u.email})`, 'login', u.id);
Toast.success('مرحباً بك ' + u.full_name);
if (_otpTimer) { clearInterval(_otpTimer); _otpTimer = null; }
_pendingOTP = null;
if (u.must_change_password) {
if (Toast.info) Toast.info('يجب تغيير كلمة المرور');
navigate('profile');
} else {
navigate('dashboard');
}
} catch(err) {
console.error('OTP verify error:', err);
Toast.error('فشل التحقق - حاول مرة أخرى');
btn.dataset.busy='0'; btn.disabled = false; btn.textContent = 'تأكيد ودخول';
}
});
}

// Resend
if (resendBtn) {
resendBtn.addEventListener('click', async () => {
if (resendBtn.disabled) return;
resendBtn.disabled = true; resendBtn.textContent = 'جاري الإرسال...';
try {
// نطلب كوداً جديداً عبر RPC مرة أخرى — يحتاج كلمة المرور، لذا نعود لشاشة الدخول
Toast.info('للحصول على كود جديد، الرجاء الدخول مرة أخرى');
if (_otpTimer) { clearInterval(_otpTimer); _otpTimer = null; }
_pendingOTP = null;
navigate('login');
} catch(e) {
console.error(e);
resendBtn.disabled = false; resendBtn.textContent = 'إعادة إرسال الكود';
}
});
}

// Cancel
if (cancelBtn) {
cancelBtn.addEventListener('click', () => {
if (_otpTimer) { clearInterval(_otpTimer); _otpTimer = null; }
_pendingOTP = null;
navigate('login');
});
}
}

// نسيت كلمة المرور - محاكاة إرسال البريد
function showForgotPasswordModal() {
const body = `<div id="forgot-step1">
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
<div class="alert alert-success" style="margin-bottom:14px">
✅ تم إنشاء كلمة مرور مؤقتة بنجاح. الرجاء استخدامها لتسجيل الدخول وتغييرها مباشرة.
</div>
<div class="form-group">
<label class="form-label">كلمة المرور المؤقتة</label>
<input class="form-control" id="fp-temp" readonly style="font-family:monospace;font-size:16px;font-weight:700;color:var(--primary);text-align:center;background:#f1f5f9">
</div>
<div style="text-align:center;font-size:13px;color:var(--muted)">انسخ كلمة المرور وسجّل الدخول بها، ثم قم بتغييرها من صفحة "الملف الشخصي"</div>
</div>`;
const footer = `<button class="btn btn-secondary" onclick="Modal.close()">إغلاق</button><button class="btn btn-primary" id="fp-send">إرسال</button>`;
Modal.show('🔑 استعادة كلمة المرور', body, footer);

document.getElementById('fp-send').addEventListener('click', async (e) => {
const btn = e.currentTarget;
if (btn.dataset.busy === '1') return;
const step1 = document.getElementById('forgot-step1');
if (!step1 || step1.style.display === 'none') return;
btn.dataset.busy = '1';
const orig = btn.textContent;
btn.disabled = true;
btn.textContent = 'جاري الإرسال...';
try {
const email = document.getElementById('fp-email').value.trim();
if (!Utils.validateEmail(email)) { Toast.error('بريد إلكتروني غير صالح'); btn.textContent = orig; btn.disabled = false; btn.dataset.busy='0'; return; }

// إعادة التعيين عبر Supabase RPC مباشرةً (يكتب في القاعدة وليس فقط localStorage)
let tempPw = null;
let resetMsg = null;
let resetUserData = null;
if (window.sb && window.sb.rpc) {
const { data, error } = await window.sb.rpc('request_password_reset', { p_email: email });
if (error) { console.warn('request_password_reset error:', error.message); resetMsg = error.message; }
if (Array.isArray(data) && data.length) {
const row = data[0];
if (row.ok) {
tempPw = row.temp_password;
resetUserData = { email: row.user_email, full_name: row.user_name };
} else {
resetMsg = row.message || 'فشلت العملية';
}
}
}
// مسار محلي احتياطي (لو Supabase غير متاح)
if (!tempPw && (!window.sb || !window.sb.rpc)) {
const u = DB.getUserByEmail(email);
if (!u) { resetMsg = 'لا يوجد حساب بهذا البريد الإلكتروني'; }
else if (!u.is_active) { resetMsg = 'الحساب معطّل، تواصل مع المدير'; }
else { tempPw = DB.resetUserPassword(u.id); resetUserData = u; }
}
if (!tempPw) {
Toast.error(resetMsg || 'تعذّر إنشاء كلمة المرور');
btn.textContent = orig; btn.disabled = false; btn.dataset.busy='0';
return;
}

// إرسال الكلمة المؤقتة عبر البريد (fire-and-forget) إن أمكن
if (resetUserData && window.EmailService && typeof window.EmailService.sendNewUserEmail === 'function') {
try { window.EmailService.sendNewUserEmail({ ...resetUserData, username: resetUserData.username || resetUserData.email, role: 'reset' }, tempPw).catch(()=>{}); } catch(_){}
}

step1.style.display = 'none';
document.getElementById('forgot-step2').style.display = 'block';
document.getElementById('fp-temp').value = tempPw;
btn.textContent = 'تم';
Toast.success('تم إنشاء كلمة المرور المؤقتة');
logEvent('password_reset_request', `طلب إعادة تعيين كلمة المرور - ${email}`, 'user');
} catch(err) {
console.error(err);
Toast.error('فشلت العملية');
btn.textContent = orig;
btn.disabled = false;
btn.dataset.busy = '0';
}
});
}

// ============================================
// Layout (Sidebar + Topbar)
// ============================================
function renderLayout(content) {
const menu = [
{ key:'dashboard', icon:'📊', label:'لوحة التحكم', roles:['admin','quality_officer','supervisor','employee'] },
{ key:'evaluations', icon:'📝', label:'التقييمات', roles:['admin','quality_officer','supervisor','employee'] },
{ key:'new-evaluation', icon:'➕', label:'تقييم جديد', roles:['admin','quality_officer'] },
{ key:'employees', icon:'👥', label:'الموظفون', roles:['admin','quality_officer','supervisor'] },
{ key:'objections', icon:'⚖️', label:'الاعتراضات', roles:['admin','quality_officer','supervisor','employee'] },
{ key:'reports', icon:'📈', label:'التقارير', roles:['admin','quality_officer','supervisor'] },
{ key:'monthly-report', icon:'📅', label:'التقرير الشهري', roles:['admin','quality_officer','supervisor'] },
{ key:'actions-report', icon:'⚖️', label:'تقرير الإجراءات', roles:['admin','quality_officer','supervisor'] },
{ key:'errors-report', icon:'❌', label:'الأخطاء المتكررة', roles:['admin','quality_officer','supervisor'] },
{ key:'audit-log', icon:'📜', label:'سجل العمليات', roles:['admin','quality_officer'] },
{ key:'users', icon:'🛡️', label:'إدارة المستخدمين', roles:['admin'] },
{ key:'settings', icon:'⚙️', label:'الإعدادات', roles:['admin'] },
{ key:'profile', icon:'👤', label:'الملف الشخصي', roles:['admin','quality_officer','supervisor','employee'] }
];

const menuHTML = menu.filter(m => m.roles.includes(currentUser.role)).map(m => `
<div class="menu-item ${currentPage === m.key ? 'active' : ''}" data-nav="${m.key}">
<span>${m.icon}</span><span>${m.label}</span>
</div>`).join('');

const unread = DB.getNotifications(currentUser.id).filter(n => !n.is_read).length;

const titles = PAGE_TITLES;

return `
<div class="layout">
<aside class="sidebar">
<button class="sidebar-close" id="sidebar-close" aria-label="إغلاق القائمة">×</button>
<div class="sidebar-header">
<div class="sidebar-logo">${MAHZAM_LOGO_LIGHT_SVG}</div>
<div class="sidebar-title">${SYSTEM_NAME}</div>
<div class="sidebar-subtitle">${COMPANY_NAME}</div>
</div>
<nav class="sidebar-menu">${menuHTML}</nav>
<div style="padding:16px 12px;border-top:1px solid rgba(255,255,255,0.1)">
<div class="menu-item" id="logout-btn"><span>🚪</span><span>تسجيل الخروج</span></div>
</div>
</aside>
<div class="sidebar-backdrop" id="sidebar-backdrop"></div>
<div class="main-content">
<header class="topbar">
<div style="display:flex;align-items:center;gap:14px">
<button class="menu-toggle" id="menu-toggle" aria-label="فتح القائمة">☰</button>
<div style="width:42px;height:42px;background:linear-gradient(135deg,#06579F,#202E4D);border-radius:10px;padding:5px;display:flex;align-items:center;justify-content:center">${MAHZAM_LOGO_LIGHT_SVG}</div>
<div>
<div class="topbar-title">${titles[currentPage] || ''}</div>
<div style="font-size:11px;color:var(--muted);font-weight:600">${SYSTEM_NAME} • ${COMPANY_NAME}</div>
</div>
</div>
<div class="topbar-actions">
<div style="position:relative;cursor:pointer;font-size:22px" data-nav="notifications">
🔔${unread > 0 ? `<span style="position:absolute;top:-4px;left:-4px;background:var(--danger);color:#fff;border-radius:50%;min-width:18px;height:18px;font-size:11px;display:flex;align-items:center;justify-content:center;padding:0 4px;font-weight:700">${unread}</span>` : ''}
</div>
<div class="user-info">
<div class="user-avatar">${Utils.getInitials(currentUser.full_name)}</div>
<div>
<div style="font-weight:700;font-size:13px">${Utils.escape(currentUser.full_name)}</div>
<div style="font-size:11px;color:var(--muted)">${Utils.roleLabel(currentUser.role)}</div>
</div>
</div>
</div>
</header>
<div class="content">${content}</div>
</div>
</div>`;
}

function attachLayoutHandlers() {
// idempotent: عناصر العرض جديدة بعد كل navigate (innerHTML)، لكن نضع حارس dataset.bound
// كطبقة دفاع إضافية لمنع الربط المكرر إذا تم استدعاء الدالة مرتين على نفس الـ DOM.
document.querySelectorAll('[data-nav]').forEach(el => {
if (el.dataset.bound === '1') return;
el.dataset.bound = '1';
el.addEventListener('click', () => navigateToSection(el.dataset.nav));
});
const lo = document.getElementById('logout-btn');
if (lo && lo.dataset.bound !== '1') {
lo.dataset.bound = '1';
lo.addEventListener('click', logout);
}

// === قائمة الجوال (هامبرغر + خلفية + زر إغلاق + Escape + قفل التمرير) ===
const sb = document.querySelector('.sidebar');
const bd = document.getElementById('sidebar-backdrop');
const openSidebar = () => {
if (sb) sb.classList.add('show');
if (bd) bd.classList.add('show');
document.body.classList.add('sidebar-open');
};
const closeSidebar = () => {
if (sb) sb.classList.remove('show');
if (bd) bd.classList.remove('show');
document.body.classList.remove('sidebar-open');
};
const mt = document.getElementById('menu-toggle');
if (mt && mt.dataset.bound !== '1') {
mt.dataset.bound = '1';
mt.addEventListener('click', e => {
e.stopPropagation();
(sb && sb.classList.contains('show')) ? closeSidebar() : openSidebar();
});
}
if (bd && bd.dataset.bound !== '1') {
bd.dataset.bound = '1';
bd.addEventListener('click', closeSidebar);
}
const sc = document.getElementById('sidebar-close');
if (sc && sc.dataset.bound !== '1') {
sc.dataset.bound = '1';
sc.addEventListener('click', closeSidebar);
}
// إغلاق القائمة عند اختيار عنصر تنقّل أو تسجيل الخروج (قبل إعادة الرسم)
document.querySelectorAll('.sidebar [data-nav], #logout-btn').forEach(el => {
if (el.dataset.boundClose === '1') return;
el.dataset.boundClose = '1';
el.addEventListener('click', closeSidebar);
});
// مفتاح Escape — يُربط مرّة واحدة على مستوى المستند (يعمل على عناصر اللحظة الحالية)
if (!window.__sidebarEscBound) {
window.__sidebarEscBound = true;
document.addEventListener('keydown', e => {
if (e.key === 'Escape') {
const s = document.querySelector('.sidebar');
if (s && s.classList.contains('show')) {
s.classList.remove('show');
const b = document.getElementById('sidebar-backdrop');
if (b) b.classList.remove('show');
document.body.classList.remove('sidebar-open');
}
}
});
}
}

// ============================================
// Dashboard
// ============================================
function renderDashboard() {
const isEmp = currentUser.role === 'employee';
const s = DB.getDashboardStats(isEmp ? currentUser.id : null);
const greeting = (() => {
const h = new Date().getHours();
if (h < 12) return 'صباح الخير';
if (h < 17) return 'مساء الخير';
return 'مساء الخير';
})();

const welcomeBanner = `
<div style="background:linear-gradient(135deg,#1B202C 0%,#202E4D 50%,#06579F 100%);border-radius:16px;padding:28px;color:white;margin-bottom:24px;position:relative;overflow:hidden;box-shadow:0 10px 30px rgba(27,32,44,0.35)">
<div style="position:absolute;top:-40px;left:-40px;width:240px;height:240px;background:rgba(255,255,255,0.06);border-radius:50%"></div>
<div style="position:absolute;bottom:-60px;left:30%;width:180px;height:180px;background:rgba(255,255,255,0.04);border-radius:50%"></div>
<div style="position:relative;z-index:1;display:flex;justify-content:space-between;align-items:center;gap:20px;flex-wrap:wrap">
<div>
<div style="font-size:14px;opacity:0.85;margin-bottom:4px">${greeting}</div>
<div style="font-size:26px;font-weight:800;margin-bottom:6px">${Utils.escape(currentUser.full_name)} 👋</div>
<div style="font-size:14px;opacity:0.9">${Utils.roleLabel(currentUser.role)} - ${new Date().toLocaleDateString('ar-SA',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</div>
<div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.18);font-size:13px;opacity:0.9">🌟 مرحباً بكم في <strong>${SYSTEM_NAME}</strong> - ${COMPANY_NAME}</div>
</div>
<div style="width:130px;height:auto;opacity:0.95;flex-shrink:0">${MAHZAM_LOGO_LIGHT_SVG}</div>
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

const recentRows = s.recent.length ? s.recent.map(e => {
const emp = DB.getUser(e.employee_id);
const evr = DB.getUser(e.evaluator_id);
return `<tr style="cursor:pointer" data-nav-eval="${e.id}">
<td><div style="display:flex;align-items:center;gap:10px"><div class="user-avatar">${Utils.getInitials(emp?emp.full_name:'-')}</div>${Utils.escape(emp ? emp.full_name : '-')}</div></td>
<td>${Utils.escape(evr ? evr.full_name : '-')}</td>
<td>${Utils.formatDate(e.evaluation_date)}</td>
<td>${Utils.gradeBadge(e.percentage)}</td>
</tr>`;
}).join('') : '<tr><td colspan="4" style="text-align:center;padding:30px;color:var(--muted)">لا توجد تقييمات بعد</td></tr>';

const performers = !isEmp ? `
<div class="grid grid-2" style="margin-top:20px">
<div class="card" style="border-top:4px solid var(--success)">
<div class="card-header" style="background:linear-gradient(to left,#d1fae5,transparent)"><div class="card-title">🏆 أفضل الموظفين أداءً</div></div>
<div class="card-body" style="padding:0">
${s.top.length ? s.top.map((p, idx) => `
<div style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;${idx<s.top.length-1?'border-bottom:1px solid var(--border)':''}">
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
<div class="card-title">📉 يحتاجون متابعة <span style="font-size:11px;color:var(--muted);font-weight:600;margin-right:8px">(الموظفون الراسبون فقط - آخر تقييم ≤84%)</span></div>
</div>
<div class="card-body" style="padding:0">
${s.low.length ? s.low.map((p, idx) => `
<div style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;${idx<s.low.length-1?'border-bottom:1px solid var(--border)':''};cursor:pointer" data-view-emp="${p.id}">
<div style="display:flex;align-items:center;gap:12px">
<div style="display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;background:var(--danger);color:white;font-weight:800;font-size:14px">⚠</div>
<div class="user-avatar" style="background:var(--danger)">${Utils.getInitials(p.name)}</div>
<div>
<div style="font-weight:700">${Utils.escape(p.name)}</div>
<div style="font-size:12px;color:var(--muted)">${p.count} تقييم • آخر تقييم: ${Utils.formatDate(p.lastEvalDate)} ${p.lastEvalApproved ? '<span style="color:var(--success);font-weight:700" title="معتمد">✓</span>' : '<span style="color:var(--muted)" title="غير معتمد">○</span>'}</div>
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

const quickActions = !isEmp ? `
<div class="grid grid-3" style="margin-bottom:20px">
<div class="card" style="cursor:pointer;border-right:4px solid var(--primary);transition:0.2s" data-nav="new-evaluation" onmouseover="this.style.transform='translateY(-3px)'" onmouseout="this.style.transform=''">
<div class="card-body" style="display:flex;align-items:center;gap:14px"><div style="font-size:36px">➕</div><div><div style="font-weight:700;font-size:15px">تقييم جديد</div><div style="font-size:13px;color:var(--muted)">إضافة تقييم لموظف</div></div></div>
</div>
<div class="card" style="cursor:pointer;border-right:4px solid var(--info);transition:0.2s" data-nav="monthly-report" onmouseover="this.style.transform='translateY(-3px)'" onmouseout="this.style.transform=''">
<div class="card-body" style="display:flex;align-items:center;gap:14px"><div style="font-size:36px">📅</div><div><div style="font-weight:700;font-size:15px">التقرير الشهري</div><div style="font-size:13px;color:var(--muted)">عرض النتائج الشهرية</div></div></div>
</div>
<div class="card" style="cursor:pointer;border-right:4px solid var(--success);transition:0.2s" data-nav="reports" onmouseover="this.style.transform='translateY(-3px)'" onmouseout="this.style.transform=''">
<div class="card-body" style="display:flex;align-items:center;gap:14px"><div style="font-size:36px">📈</div><div><div style="font-weight:700;font-size:15px">التقارير الشاملة</div><div style="font-size:13px;color:var(--muted)">تحليلات تفصيلية</div></div></div>
</div>
</div>` : '';

return `
${welcomeBanner}
${cards}
${quickActions}
${!isEmp ? renderQualityKPIs() : ''}
<div class="grid grid-2">
<div class="card"><div class="card-header"><div class="card-title">📈 الأداء الشهري (آخر 6 أشهر)</div></div><div class="card-body"><div class="chart-container"><canvas id="trend-chart"></canvas></div></div></div>
<div class="card"><div class="card-header"><div class="card-title">🎯 توزيع التقديرات</div></div><div class="card-body"><div class="chart-container"><canvas id="grades-chart"></canvas></div></div></div>
</div>
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
}

// ============================================
// Dashboard Quality KPIs (مؤشرات الجودة في لوحة التحكم)
// ============================================
function renderQualityKPIs() {
const evals = DB.data.evaluations;
const employees = DB.getUsers({ role:'employee' });

// 1. أكثر الأخطاء على مستوى الشركة (يتم استثناء "لا يوجد ملاحظات")
const companyErrors = {};
evals.forEach(ev => {
if (isPositiveObservation(ev)) return;
const k = ev.observed_issue === 'أخرى' ? (ev.observed_issue_other || 'أخرى') : (ev.observed_issue || ev.call_type);
if (k) companyErrors[k] = (companyErrors[k]||0)+1;
});
const topCompany = Object.entries(companyErrors).sort((a,b)=>b[1]-a[1]).slice(0,5);

// 2. أكثر الأخطاء لكل فريق (المشرف)
const byTeam = {};
evals.forEach(ev => {
if (isPositiveObservation(ev)) return;
const emp = employees.find(e => e.id === ev.employee_id);
if (!emp) return;
const team = emp.supervisor_name || 'بدون مشرف';
const k = ev.observed_issue === 'أخرى' ? (ev.observed_issue_other || 'أخرى') : (ev.observed_issue || ev.call_type);
if (!k) return;
if (!byTeam[team]) byTeam[team] = {};
byTeam[team][k] = (byTeam[team][k]||0)+1;
});
const teamRows = Object.entries(byTeam).map(([team, errors]) => {
const top = Object.entries(errors).sort((a,b)=>b[1]-a[1])[0];
const total = Object.values(errors).reduce((a,b)=>a+b, 0);
return { team, top, total };
}).sort((a,b)=>b.total-a.total).slice(0,5);

// 3. الموظفون الأعلى في تكرار الأخطاء
const empErrors = {};
evals.forEach(ev => {
if (isPositiveObservation(ev)) return;
const k = ev.observed_issue === 'أخرى' ? (ev.observed_issue_other || 'أخرى') : (ev.observed_issue || ev.call_type);
if (!k) return;
empErrors[ev.employee_id] = (empErrors[ev.employee_id]||0)+1;
});
const topErrorEmps = Object.entries(empErrors).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([id, c]) => {
const e = DB.getUser(parseInt(id));
return { id, name: e?e.full_name:'-', count:c, supervisor: e?e.supervisor_name:'-' };
});

// 4. المشرفون الأكثر متابعة (تسجيل الإجراءات)
const supActivity = {};
evals.forEach(ev => {
if (!ev.supervisor_action || !ev.supervisor_action_by_name) return;
const s = ev.supervisor_action_by_name;
supActivity[s] = (supActivity[s]||0)+1;
});
const topSupervisors = Object.entries(supActivity).sort((a,b)=>b[1]-a[1]).slice(0,5);

// 5. نسبة التحسن الشهرية (بعد الإجراءات)
const now = new Date();
const monthlyImprovement = [];
for (let i = 5; i >= 0; i--) {
const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
const y = d.getFullYear(), m = d.getMonth();
let total = 0, improved = 0;
employees.forEach(e => {
const sorted = evals.filter(ev => ev.employee_id === e.id).sort((a,b) => new Date(a.evaluation_date) - new Date(b.evaluation_date));
for (let j = 0; j < sorted.length - 1; j++) {
const before = sorted[j];
const after = sorted[j+1];
const beforeDate = new Date(before.evaluation_date);
if (beforeDate.getFullYear() !== y || beforeDate.getMonth() !== m) continue;
if (before.supervisor_action && before.supervisor_action !== 'لا يوجد إجراء') {
total++;
if (after.percentage > before.percentage) improved++;
}
}
});
const labels = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
monthlyImprovement.push({ month: labels[m], rate: total ? Math.round((improved/total)*100) : 0, total });
}
const currentImpRate = monthlyImprovement[monthlyImprovement.length-1].rate;

const html = `
<div style="background:linear-gradient(135deg,#fef3c7,#fef9c3);border-radius:14px;padding:18px;margin:24px 0 16px;border:2px solid #fde68a">
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
<div style="font-size:18px;font-weight:800;color:#92400e">📊 مؤشرات الجودة</div>
<div style="display:flex;gap:6px"><span class="badge badge-warning">${evals.length} تقييم</span> <span class="badge badge-danger">${Object.values(companyErrors).reduce((a,b)=>a+b,0)} خطأ</span></div>
</div>

<div class="grid grid-2" style="gap:14px">
<div class="card" style="border-top:3px solid #ef4444;margin:0">
<div class="card-header" style="background:#fef2f2"><div class="card-title">❌ أكثر الأخطاء على مستوى الشركة</div></div>
<div class="card-body" style="padding:0">
${topCompany.length ? topCompany.map(([k,n], i) => `
<div style="padding:10px 14px;display:flex;justify-content:space-between;align-items:center;${i<topCompany.length-1?'border-bottom:1px solid #fee2e2':''}">
<div style="display:flex;align-items:center;gap:8px"><span style="background:${i===0?'#ef4444':'#fca5a5'};color:white;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px">${i+1}</span><span style="font-weight:600">${Utils.escape(k)}</span></div>
<span class="badge badge-danger">${n}</span>
</div>`).join('') : '<div style="padding:14px;text-align:center;color:var(--muted)">لا توجد بيانات</div>'}
</div>
</div>

<div class="card" style="border-top:3px solid #7c3aed;margin:0">
<div class="card-header" style="background:#faf5ff"><div class="card-title">👥 أكثر الأخطاء لكل فريق</div></div>
<div class="card-body" style="padding:0">
${teamRows.length ? teamRows.map((t, i) => `
<div style="padding:10px 14px;${i<teamRows.length-1?'border-bottom:1px solid #ede9fe':''}">
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
<div style="font-weight:700">👨‍💼 ${Utils.escape(t.team)}</div>
<span class="badge" style="background:#ede9fe;color:#6d28d9">${t.total} خطأ</span>
</div>
<div style="font-size:12px;color:var(--muted)">أكثر خطأ: <strong>${t.top ? Utils.escape(t.top[0]) + ' (' + t.top[1] + ')' : '-'}</strong></div>
</div>`).join('') : '<div style="padding:14px;text-align:center;color:var(--muted)">لا توجد بيانات</div>'}
</div>
</div>

<div class="card" style="border-top:3px solid #f59e0b;margin:0">
<div class="card-header" style="background:#fffbeb"><div class="card-title">⚠️ الموظفون الأعلى تكراراً للأخطاء</div></div>
<div class="card-body" style="padding:0">
${topErrorEmps.length ? topErrorEmps.map((e, i) => `
<div style="padding:10px 14px;display:flex;justify-content:space-between;align-items:center;${i<topErrorEmps.length-1?'border-bottom:1px solid #fef3c7':''};cursor:pointer" data-view-emp="${e.id}">
<div style="display:flex;align-items:center;gap:10px">
<div class="user-avatar" style="background:var(--warning)">${Utils.getInitials(e.name)}</div>
<div><div style="font-weight:700">${Utils.escape(e.name)}</div><div style="font-size:11px;color:var(--muted)">${Utils.escape(e.supervisor||'-')}</div></div>
</div>
<span class="badge badge-warning">${e.count} خطأ</span>
</div>`).join('') : '<div style="padding:14px;text-align:center;color:var(--muted)">لا توجد بيانات</div>'}
</div>
</div>

<div class="card" style="border-top:3px solid #10b981;margin:0">
<div class="card-header" style="background:#f0fdf4"><div class="card-title">🌟 المشرفون الأكثر متابعة</div></div>
<div class="card-body" style="padding:0">
${topSupervisors.length ? topSupervisors.map(([sup, n], i) => `
<div style="padding:10px 14px;display:flex;justify-content:space-between;align-items:center;${i<topSupervisors.length-1?'border-bottom:1px solid #d1fae5':''}">
<div style="display:flex;align-items:center;gap:10px"><div class="user-avatar" style="background:var(--success)">${Utils.getInitials(sup)}</div><div style="font-weight:700">${Utils.escape(sup)}</div></div>
<span class="badge badge-success">${n} إجراء</span>
</div>`).join('') : '<div style="padding:14px;text-align:center;color:var(--muted)">لا توجد إجراءات مسجلة بعد</div>'}
</div>
</div>
</div>

<div class="card" style="margin-top:14px;border:2px solid #10b981;background:#f0fdf4">
<div class="card-header"><div class="card-title">📈 نسبة التحسن الشهرية بعد الإجراءات التصحيحية</div></div>
<div class="card-body" style="display:flex;align-items:center;gap:24px;flex-wrap:wrap">
<div style="text-align:center;min-width:120px">
<div style="font-size:42px;font-weight:800;color:${currentImpRate>=70?'#059669':currentImpRate>=40?'#d97706':'#dc2626'}">${currentImpRate}%</div>
<div style="font-size:12px;color:var(--muted)">الشهر الحالي</div>
</div>
<div style="flex:1;display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-start">
${monthlyImprovement.map(m => `
<div style="text-align:center;background:white;padding:10px;border-radius:8px;border:1px solid #d1fae5;min-width:80px">
<div style="font-size:11px;color:var(--muted)">${m.month}</div>
<div style="font-size:18px;font-weight:800;color:${m.rate>=70?'#059669':m.rate>=40?'#d97706':'#dc2626'}">${m.rate}%</div>
<div style="font-size:10px;color:var(--muted)">${m.total} حالة</div>
</div>
`).join('')}
</div>
</div>
</div>
</div>`;
return html;
}

function renderDashboardCharts() {
const isEmp = currentUser.role === 'employee';
const s = DB.getDashboardStats(isEmp ? currentUser.id : null);

const c1 = document.getElementById('trend-chart');
if (c1) charts.push(new Chart(c1, {
type:'line',
data:{ labels:s.trend.map(t=>t.month), datasets:[{ label:'متوسط الأداء', data:s.trend.map(t=>t.avg), borderColor:'#3b82f6', backgroundColor:'rgba(59,130,246,0.1)', tension:0.4, fill:true }] },
options:{ responsive:true, maintainAspectRatio:false, scales:{ y:{ beginAtZero:true, max:100 } } }
}));

const c2 = document.getElementById('grades-chart');
if (c2) charts.push(new Chart(c2, {
type:'doughnut',
data:{
labels:['ناجح (≥85)','راسب (≤84)'],
datasets:[{ data:[s.grades['ناجح']||0,s.grades['راسب']||0], backgroundColor:['#10b981','#ef4444'] }]
},
options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom' } } }
}));
}

// ============================================
// Employees
// ============================================
function renderEmployees() {
let users = DB.data.users.filter(u => u.role === 'employee');
// Supervisor sees only their team
if (currentUser.role === 'supervisor') {
users = users.filter(u => u.supervisor_name === currentUser.full_name);
}

const supervisors = DB.getSupervisors();
const supOpts = supervisors.map(s => `<option value="${Utils.escape(s.full_name)}">${Utils.escape(s.full_name)}</option>`).join('');
const deptSet = new Set();
users.forEach(u => { if (u.department) deptSet.add(u.department); });
const deptOpts = Array.from(deptSet).map(d => `<option value="${Utils.escape(d)}">${Utils.escape(d)}</option>`).join('');

const rows = users.map(u => {
const avg = DB.getAvgScore(u.id);
const count = DB.data.evaluations.filter(e => e.employee_id === u.id).length;
return `<tr data-search="${Utils.escape((u.full_name||'')+' '+(u.employee_number||'')+' '+(u.supervisor_name||'')+' '+(u.email||'')+' '+(u.department||''))}" data-status="${u.is_active?'active':'inactive'}" data-dept="${Utils.escape(u.department||'')}" data-sup="${Utils.escape(u.supervisor_name||'')}">
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
${(currentUser.role === 'admin' || currentUser.role === 'quality_officer') ? `<button class="btn btn-sm btn-warning" data-edit-emp="${u.id}">تعديل</button>` : ''}
${(currentUser.role === 'admin' || currentUser.role === 'quality_officer') ? `<button class="btn btn-sm btn-info" data-reset-pw="${u.id}" title="إعادة تعيين كلمة المرور">🔑</button>` : ''}
</td>
</tr>`;
}).join('');

const subtitle = currentUser.role === 'supervisor' ? 'موظفو فريقك التابعون لإشرافك' : 'إدارة بيانات الموظفين لمتابعة تقييماتهم';
const noteIfNoSup = (currentUser.role === 'admin' || currentUser.role === 'quality_officer') && supervisors.length === 0
? `<div class="alert alert-warning" style="margin-bottom:14px">⚠️ لا يوجد حسابات مشرفين. أضف مشرفاً من <strong>صفحة إدارة المستخدمين</strong> قبل إضافة الموظفين.</div>`
: '';

return `
<div class="page-header">
<div><div class="page-title">الموظفون (${users.length})</div><div class="page-subtitle">${subtitle}</div></div>
${(currentUser.role === 'admin' || currentUser.role === 'quality_officer') ? '<button class="btn btn-primary" id="add-emp-btn">➕ إضافة موظف</button>' : ''}
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
<tbody>${rows || '<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--muted)">لا يوجد موظفون</td></tr>'}</tbody>
</table>
</div>
</div>`;
}

function showEmployeeModal(editId=null) {
const ed = editId ? DB.getUser(editId) : null;
const supervisors = DB.getSupervisors();
const currentSup = ed ? (ed.supervisor_name||'') : '';
const supOpts = supervisors.map(s => `<option value="${Utils.escape(s.full_name)}" ${s.full_name===currentSup?'selected':''}>${Utils.escape(s.full_name)} (${Utils.escape(s.email||'-')})</option>`).join('');
const supDropdown = supervisors.length === 0
? `<div style="padding:10px;background:#fee2e2;border:1px solid #fca5a5;border-radius:8px;color:#991b1b;font-size:13px">
⚠️ لا يوجد مشرفون مسجلون. أضف حساب مشرف من <strong>صفحة إدارة المستخدمين</strong> أولاً.
</div>`
: `<select class="form-control" id="ef-sup" required>
<option value="">-- اختر المشرف --</option>
${supOpts}
</select>
<div style="font-size:11px;color:var(--muted);margin-top:4px">القائمة تشمل جميع الحسابات المسجلة بصلاحية "مشرف"</div>`;

const body = `<form id="emp-form">
<div class="alert alert-info" style="margin-bottom:16px;font-size:13px">
ℹ️ سيتم إنشاء حساب دخول للموظف بالبريد الإلكتروني وكلمة المرور أدناه.
</div>
<div class="grid grid-2">
<div class="form-group"><label class="form-label">اسم الموظف بالكامل *</label><input class="form-control" id="ef-name" required value="${ed?Utils.escape(ed.full_name):''}" placeholder="مثال: أحمد علي محمد"></div>
<div class="form-group"><label class="form-label">الرقم الوظيفي *</label><input class="form-control" id="ef-num" required value="${ed?Utils.escape(ed.employee_number||''):''}" placeholder="مثال: EMP001" ${ed?'readonly':''}></div>
<div class="form-group"><label class="form-label">📧 البريد الإلكتروني *</label><input type="email" class="form-control" id="ef-email" required value="${ed?Utils.escape(ed.email||''):''}" placeholder="employee@example.com"></div>
<div class="form-group"><label class="form-label">📱 رقم الجوال</label><input class="form-control" id="ef-phone" value="${ed?Utils.escape(ed.phone||''):''}" placeholder="05xxxxxxxx"></div>
<div class="form-group"><label class="form-label">المسمى الوظيفي *</label><input class="form-control" id="ef-pos" required value="${ed?Utils.escape(ed.position||''):'موظف خدمة'}"></div>
<div class="form-group"><label class="form-label">👨‍💼 اسم المشرف *</label>${supDropdown}</div>
<div class="form-group"><label class="form-label">القسم/الإدارة</label><input class="form-control" id="ef-dept" value="${ed?Utils.escape(ed.department||''):'قسم الجودة'}"></div>
${!ed ? `<div style="background:#eff6ff;padding:10px;border-radius:8px;font-size:12px;color:var(--primary-dark)">🔐 ستُولَّد كلمة مرور مؤقتة تلقائياً وتُرسَل لبريد الموظف وتُعرَض لك بعد الإضافة.</div>` : ''}
</div>
${!ed ? `<div style="background:#f1f5f9;padding:10px;border-radius:8px;font-size:12px;color:var(--muted);margin-top:8px">
<strong>متطلبات كلمة المرور:</strong> 8 أحرف على الأقل، حرف واحد، رقم واحد، رمز خاص (@!#$%)
</div>` : ''}
</form>`;
const footer = `<button class="btn btn-secondary" onclick="Modal.close()">إلغاء</button><button class="btn btn-primary" id="ef-save">${ed?'حفظ':'إضافة'}</button>`;
Modal.show(ed?'تعديل بيانات الموظف':'إضافة موظف جديد', body, footer);

document.getElementById('ef-save').addEventListener('click', async (e) => {
const btn = e.currentTarget;
await submitWithFeedback(btn, 'جاري الحفظ...', null, async () => {
const full_name = document.getElementById('ef-name').value.trim();
const employee_number = document.getElementById('ef-num').value.trim();
const position = document.getElementById('ef-pos').value.trim();
const supEl = document.getElementById('ef-sup');
if (!supEl) { Toast.error('يجب إضافة حساب مشرف أولاً من إدارة المستخدمين'); return false; }
const supervisor_name = supEl.value;
const supObj = DB.getSupervisors().find(s => s.full_name === supervisor_name);
const supervisor_id = supObj ? supObj.id : null;
const email = document.getElementById('ef-email').value.trim();
const phone = document.getElementById('ef-phone').value.trim();
const department = document.getElementById('ef-dept').value.trim();

if (!full_name || !employee_number || !position || !supervisor_name || !email) {
Toast.error('يرجى تعبئة جميع الحقول المطلوبة');
return false;
}
if (!Utils.validateEmail(email)) { Toast.error('بريد إلكتروني غير صالح'); return false; }

const _tok = (window.getSessionToken ? window.getSessionToken() : null);
if (ed) {
if (window.sb && window.sb.rpc) {
const { data, error } = await window.sb.rpc('update_employee_profile', {
p_session_token: _tok, p_user_id: editId,
p_full_name: full_name, p_email: email, p_employee_number: employee_number,
p_position: position, p_department: department, p_phone: phone,
p_supervisor_id: supervisor_id, p_supervisor_name: supervisor_name
});
const row = (!error && Array.isArray(data) && data[0]) ? data[0] : null;
if (!row || !row.ok) { const msg=(row&&row.message)||(error&&error.message)||'تعذّر الحفظ'; const h=handleSessionError(msg); if(!h) Toast.error(msg); return false; }
if (window.SupabaseSync && SupabaseSync.pullAll) { try{ await SupabaseSync.pullAll(); }catch(_){} }
} else {
const conflict = DB.getUserByEmail(email);
if (conflict && conflict.id !== editId) { Toast.error('البريد الإلكتروني مستخدم مسبقاً'); return false; }
DB.updateUser(editId, { full_name, employee_number, position, supervisor_name, supervisor_id, email, phone, department });
}
Toast.success('تم حفظ التعديلات');
} else {
if (window.sb && window.sb.rpc) {
const { data, error } = await window.sb.rpc('create_employee', {
p_session_token: _tok, p_full_name: full_name, p_email: email, p_employee_number: employee_number,
p_position: position, p_department: department, p_phone: phone,
p_supervisor_id: supervisor_id, p_supervisor_name: supervisor_name
});
const row = (!error && Array.isArray(data) && data[0]) ? data[0] : null;
if (!row || !row.ok) { const msg=(row&&row.message)||(error&&error.message)||'تعذّر إضافة الموظف'; const h=handleSessionError(msg); if(!h) Toast.error(msg); return false; }
if (window.SupabaseSync && SupabaseSync.pullAll) { try{ await SupabaseSync.pullAll(); }catch(_){} }
try { if (window.EmailService) window.EmailService.sendNewUserEmail({ email, full_name, username: employee_number, role:'employee' }, row.temp_password).catch(()=>{}); } catch(_){}
Modal.close();
Modal.show('✅ تم إضافة الموظف', `<div style="font-size:14px;line-height:1.9"><div class="alert alert-success">أُرسلت كلمة المرور المؤقتة لبريد الموظف. يمكنك نسخها:</div><div class="form-group"><input class="form-control" readonly value="${row.temp_password||''}" style="font-family:monospace;font-weight:700;text-align:center;color:var(--primary)"></div></div>`, `<button class="btn btn-primary" onclick="Modal.close(); navigate('employees')">تم</button>`);
return false;
} else {
const exists = DB.data.users.find(u => u.employee_number === employee_number);
if (exists) { Toast.error('الرقم الوظيفي مستخدم مسبقاً'); return false; }
if (DB.getUserByEmail(email)) { Toast.error('البريد الإلكتروني مستخدم مسبقاً'); return false; }
const password = document.getElementById('ef-pass') ? document.getElementById('ef-pass').value : Utils.generateTempPassword();
DB.createUser({ full_name, username: employee_number, password, employee_number, position, supervisor_name, supervisor_id, role:'employee', department: department || 'قسم الجودة', email, phone, must_change_password:true });
Toast.success('تم إضافة الموظف بنجاح');
}
}
Modal.close();
if (typeof navigate === 'function') navigate('employees');
return true;
});
});
}

// ============================================
// Users Management - إدارة المستخدمين (admin/QO)
// ============================================
function renderUsersAdmin() {
if (!Perms.can('manage_users') && currentUser.role !== 'quality_officer') return '<div class="alert alert-danger">غير مصرح</div>';
const users = DB.data.users.filter(u => u.role !== 'employee');
const rows = users.map(u => `<tr>
<td>${u.id}</td>
<td><div style="display:flex;align-items:center;gap:10px"><div class="user-avatar">${Utils.getInitials(u.full_name)}</div>${Utils.escape(u.full_name)}</div></td>
<td>${Utils.escape(u.email||'-')}</td>
<td>${Utils.roleBadge(u.role)}</td>
<td>${Utils.escape(u.department||'-')}</td>
<td>${u.is_active ? '<span class="badge badge-success">نشط</span>' : '<span class="badge badge-danger">معطّل</span>'}</td>
<td>${Utils.formatDate(u.created_at)}</td>
<td>
<button class="btn btn-sm btn-warning" data-edit-user="${u.id}">تعديل</button>
<button class="btn btn-sm btn-info" data-reset-pw="${u.id}" title="إعادة تعيين كلمة المرور">🔑</button>
${u.is_active ? `<button class="btn btn-sm btn-danger" data-deact-user="${u.id}">تعطيل</button>` : ''}
</td>
</tr>`).join('');

const counts = {
admin: users.filter(u => u.role === 'admin').length,
qo: users.filter(u => u.role === 'quality_officer').length,
sup: users.filter(u => u.role === 'supervisor').length
};

return `
<div class="page-header">
<div><div class="page-title">🛡️ إدارة المستخدمين</div><div class="page-subtitle">إدارة حسابات المديرين، موظفي الجودة، والمشرفين</div></div>
<button class="btn btn-primary" id="add-user-btn">➕ إضافة مستخدم</button>
</div>

<div class="stats-grid">
<div class="stat-card" style="background:linear-gradient(135deg,#06579F,#2378c4);color:white"><div class="stat-icon" style="background:rgba(255,255,255,0.25)">👑</div><div class="stat-value" style="color:white">${counts.admin}</div><div class="stat-label" style="color:rgba(255,255,255,0.9)">مدير النظام</div></div>
<div class="stat-card" style="background:linear-gradient(135deg,#06b6d4,#0891b2);color:white"><div class="stat-icon" style="background:rgba(255,255,255,0.25)">⚖️</div><div class="stat-value" style="color:white">${counts.qo}</div><div class="stat-label" style="color:rgba(255,255,255,0.9)">موظف الجودة</div></div>
<div class="stat-card" style="background:linear-gradient(135deg,#7c3aed,#6d28d9);color:white"><div class="stat-icon" style="background:rgba(255,255,255,0.25)">👨‍💼</div><div class="stat-value" style="color:white">${counts.sup}</div><div class="stat-label" style="color:rgba(255,255,255,0.9)">مشرف</div></div>
</div>

<div class="card">
<div style="padding:16px;background:#f8fafc;border-bottom:1px solid var(--border)">
<input type="text" class="form-control" id="user-search" placeholder="🔍 ابحث بالاسم، البريد، أو الدور...">
</div>
<div style="overflow-x:auto">
<table class="table" id="users-table">
<thead><tr><th>#</th><th>الاسم</th><th>البريد الإلكتروني</th><th>الدور</th><th>القسم</th><th>الحالة</th><th>تاريخ الإنشاء</th><th>إجراءات</th></tr></thead>
<tbody>${rows || '<tr><td colspan="8" style="text-align:center;padding:20px">لا توجد بيانات</td></tr>'}</tbody>
</table>
</div>
</div>`;
}

function showUserModal(editId=null) {
const ed = editId ? DB.getUser(editId) : null;
const supervisors = DB.getSupervisors();
const supOpts = supervisors.map(s => `<option value="${Utils.escape(s.full_name)}" ${ed && ed.supervisor_name===s.full_name?'selected':''}>${Utils.escape(s.full_name)} (${Utils.escape(s.email||'-')})</option>`).join('');

const body = `<form id="usr-form">
<div class="alert alert-info" style="margin-bottom:14px;font-size:13px">
ℹ️ اختر نوع الحساب من القائمة. الحسابات المصنّفة كمشرف ستظهر تلقائياً في قائمة المشرفين عند إضافة الموظفين.
</div>
<div class="grid grid-2">
<div class="form-group"><label class="form-label">الاسم الكامل *</label><input class="form-control" id="usr-name" required value="${ed?Utils.escape(ed.full_name):''}"></div>
<div class="form-group"><label class="form-label">📧 البريد الإلكتروني *</label><input type="email" class="form-control" id="usr-email" required value="${ed?Utils.escape(ed.email||''):''}"></div>
<div class="form-group"><label class="form-label">📱 رقم الجوال</label><input class="form-control" id="usr-phone" value="${ed?Utils.escape(ed.phone||''):''}"></div>
<div class="form-group"><label class="form-label">القسم/الإدارة</label><input class="form-control" id="usr-dept" value="${ed?Utils.escape(ed.department||''):'قسم الجودة'}"></div>
<div class="form-group"><label class="form-label">المسمى الوظيفي</label><input class="form-control" id="usr-pos" value="${ed?Utils.escape(ed.position||''):''}"></div>
<div class="form-group"><label class="form-label">نوع الحساب *</label>
<select class="form-control" id="usr-role" ${ed?'disabled':''} onchange="document.getElementById('usr-sup-wrap').style.display = this.value==='employee'?'block':'none'; document.getElementById('usr-num-wrap').style.display = this.value==='employee'?'block':'none'">
<option value="employee" ${ed&&ed.role==='employee'?'selected':''}>👤 موظف</option>
<option value="supervisor" ${ed&&ed.role==='supervisor'?'selected':''}>👨‍💼 مشرف</option>
<option value="quality_officer" ${ed&&ed.role==='quality_officer'?'selected':''}>⚖️ موظف الجودة</option>
<option value="admin" ${ed&&ed.role==='admin'?'selected':''}>👑 مدير النظام</option>
</select></div>
<div class="form-group" id="usr-num-wrap" style="${(ed && ed.role==='employee') || !ed ? '' : 'display:none'}">
<label class="form-label">الرقم الوظيفي ${(!ed)?'(للموظف)':''}</label>
<input class="form-control" id="usr-num" value="${ed?Utils.escape(ed.employee_number||''):''}" placeholder="EMP001">
</div>
<div class="form-group" id="usr-sup-wrap" style="${(ed && ed.role==='employee') || !ed ? '' : 'display:none'}">
<label class="form-label">👨‍💼 المشرف ${(!ed)?'(للموظف فقط)':''}</label>
<select class="form-control" id="usr-sup">
<option value="">-- اختر المشرف --</option>
${supOpts}
</select>
</div>
</div>
${!ed ? `<div style="background:#eff6ff;padding:10px;border-radius:8px;font-size:12px;color:var(--primary-dark);margin-top:6px">
🔐 ستُولَّد كلمة مرور مؤقتة تلقائياً على الخادم، تُرسَل لبريد المستخدم وتُعرَض لك بعد الإنشاء.
</div>` : ''}
</form>`;
const footer = `<button class="btn btn-secondary" onclick="Modal.close()">إلغاء</button><button class="btn btn-primary" id="usr-save">${ed?'حفظ':'إضافة'}</button>`;
Modal.show(ed?'تعديل بيانات المستخدم':'إضافة مستخدم جديد', body, footer);

document.getElementById('usr-save').addEventListener('click', async (e) => {
const btn = e.currentTarget;
await submitWithFeedback(btn, 'جاري الحفظ...', null, async () => {
const full_name = document.getElementById('usr-name').value.trim();
const email = document.getElementById('usr-email').value.trim();
const phone = document.getElementById('usr-phone').value.trim();
const department = document.getElementById('usr-dept').value.trim();
const position = document.getElementById('usr-pos').value.trim();
const role = document.getElementById('usr-role').value;
const employee_number = (document.getElementById('usr-num')||{}).value || '';
const supervisor_name = (document.getElementById('usr-sup')||{}).value || '';
const supObj = supervisor_name ? DB.getSupervisors().find(s => s.full_name === supervisor_name) : null;
const supervisor_id = supObj ? supObj.id : null;
if (!full_name || !email) { Toast.error('يرجى تعبئة الحقول المطلوبة'); return false; }
if (!Utils.validateEmail(email)) { Toast.error('بريد إلكتروني غير صالح'); return false; }
if (role === 'employee' && !supervisor_name) { Toast.error('يجب اختيار المشرف للموظف'); return false; }

const token = (window.getSessionToken ? window.getSessionToken() : null);
if (ed) {
// تعديل عبر RPC مُصادَق
if (window.sb && window.sb.rpc) {
const { data, error } = await window.sb.rpc('admin_update_user', {
p_session_token: token, p_user_id: editId,
p_full_name: full_name, p_email: email, p_phone: phone, p_department: department, p_position: position,
p_employee_number: ed.role === 'employee' ? employee_number : null,
p_supervisor_id: ed.role === 'employee' ? supervisor_id : null
});
const row = (!error && Array.isArray(data) && data[0]) ? data[0] : null;
if (!row || !row.ok) { const msg=(row&&row.message)||(error&&error.message)||'تعذّر الحفظ'; const h=handleSessionError(msg); if(!h) Toast.error(msg); return false; }
if (window.SupabaseSync && SupabaseSync.pullAll) { try{ await SupabaseSync.pullAll(); }catch(_){} }
} else {
const upd = { full_name, email, phone, department, position };
if (ed.role === 'employee') { upd.employee_number = employee_number; upd.supervisor_name = supervisor_name; upd.supervisor_id = supervisor_id; }
DB.updateUser(editId, upd);
}
Toast.success('تم حفظ التعديلات');
Modal.close();
if (typeof navigate === 'function') navigate(ed.role === 'employee' ? 'employees' : 'users');
return true;
} else {
// إنشاء عبر RPC مُصادَق — الكلمة المؤقتة تُولَّد على الخادم
const username = role === 'employee' && employee_number ? employee_number : email.split('@')[0];
let tempPw = null;
if (window.sb && window.sb.rpc) {
const { data, error } = await window.sb.rpc('admin_create_user', {
p_session_token: token, p_full_name: full_name, p_email: email, p_username: username, p_role: role,
p_department: department, p_position: position, p_phone: phone,
p_employee_number: role === 'employee' ? employee_number : null,
p_supervisor_id: role === 'employee' ? supervisor_id : null
});
const row = (!error && Array.isArray(data) && data[0]) ? data[0] : null;
if (!row || !row.ok) { const msg=(row&&row.message)||(error&&error.message)||'تعذّر إنشاء المستخدم'; const h=handleSessionError(msg); if(!h) Toast.error(msg); return false; }
tempPw = row.temp_password;
if (window.SupabaseSync && SupabaseSync.pullAll) { try{ await SupabaseSync.pullAll(); }catch(_){} }
} else {
tempPw = Utils.generateTempPassword();
DB.createUser({ full_name, email, phone, department, position, role, username, password: tempPw,
employee_number: role==='employee'?employee_number:'', supervisor_name: role==='employee'?supervisor_name:'-',
supervisor_id: role==='employee'?supervisor_id:null, must_change_password: true });
}
// إرسال الكلمة المؤقتة لبريد المستخدم (fire-and-forget)
try { if (window.EmailService) window.EmailService.sendNewUserEmail({ email, full_name, username, role }, tempPw).catch(()=>{}); } catch(_){}
// عرض الكلمة المؤقتة للمدير ليشاركها (تُغلق بزر تم ثم تحديث القائمة)
Toast.success('تم إنشاء المستخدم');
Modal.show('✅ تم إنشاء المستخدم', `<div style="font-size:14px;line-height:1.9"><div class="alert alert-success">أُرسلت كلمة المرور المؤقتة إلى بريد المستخدم. يمكنك أيضاً نسخها من هنا:</div><div class="form-group"><label class="form-label">كلمة المرور المؤقتة</label><input class="form-control" readonly value="${tempPw||''}" style="font-family:monospace;font-weight:700;text-align:center;color:var(--primary)"></div><div style="color:var(--muted);font-size:12px">سيُطلب منه تغييرها فور أول دخول.</div></div>`, `<button class="btn btn-primary" onclick="Modal.close(); navigate('users')">تم</button>`);
return false; // ندير المودال يدوياً
}
});
});
}

// Reset Password Modal (admin/QO)
function showResetPasswordModal(userId) {
const u = DB.getUser(userId);
if (!u) return;
const body = `<div id="rp-step1">
<div class="alert alert-warning" style="margin-bottom:14px">
⚠️ سيتم إنشاء كلمة مرور مؤقتة جديدة للمستخدم: <strong>${Utils.escape(u.full_name)}</strong> (${Utils.escape(u.email||'-')})
<br><small>سيُطلب من المستخدم تغيير كلمة المرور عند الدخول التالي.</small>
</div>
<div style="text-align:center">هل تريد المتابعة؟</div>
</div>
<div id="rp-step2" style="display:none">
<div class="alert alert-success" style="margin-bottom:14px">
✅ تم إنشاء كلمة المرور المؤقتة الجديدة
</div>
<div class="form-group">
<label class="form-label">المستخدم</label>
<input class="form-control" readonly value="${Utils.escape(u.full_name)} (${Utils.escape(u.email||'-')})">
</div>
<div class="form-group">
<label class="form-label">كلمة المرور المؤقتة</label>
<input class="form-control" id="rp-temp" readonly style="font-family:monospace;font-size:16px;font-weight:700;color:var(--primary);text-align:center;background:#f1f5f9">
</div>
<div style="text-align:center;font-size:13px;color:var(--muted)">انسخ كلمة المرور وأرسلها للمستخدم بطريقة آمنة</div>
</div>`;
const footer = `<button class="btn btn-secondary" onclick="Modal.close()">إغلاق</button><button class="btn btn-warning" id="rp-confirm">إعادة التعيين</button>`;
Modal.show('🔑 إعادة تعيين كلمة المرور', body, footer);

document.getElementById('rp-confirm').addEventListener('click', async (e) => {
const btn = e.currentTarget;
if (btn.dataset.busy === '1') return;
btn.dataset.busy = '1';
const orig = btn.textContent;
btn.disabled = true;
btn.textContent = 'جاري المعالجة...';
try {
const step1 = document.getElementById('rp-step1');
if (step1.style.display !== 'none') {
// إعادة التعيين عبر Supabase RPC مباشرةً (يكتب في القاعدة)
let tempPw = null;
let resetUser = null;
let resetMsg = null;
if (window.sb && window.sb.rpc) {
const { data, error } = await window.sb.rpc('admin_reset_password', { p_user_id: userId, p_session_token: (window.getSessionToken ? window.getSessionToken() : null) });
if (error) { console.warn('admin_reset_password error:', error.message); resetMsg = error.message; }
if (Array.isArray(data) && data.length) {
const row = data[0];
if (row.ok) { tempPw = row.temp_password; resetUser = { email: row.user_email, full_name: row.user_name }; }
else { resetMsg = row.message; }
}
}
if (!tempPw && (!window.sb || !window.sb.rpc)) {
tempPw = DB.resetUserPassword(userId);
resetUser = DB.getUser(userId);
}
if (!tempPw) {
const handled = handleSessionError(resetMsg);
if (!handled) Toast.error(resetMsg || 'تعذّر إعادة التعيين');
btn.textContent = orig; btn.disabled = false; btn.dataset.busy='0';
return;
}
// إرسال الكلمة المؤقتة عبر البريد للمستخدم
if (resetUser && resetUser.email && window.EmailService && typeof window.EmailService.sendNewUserEmail === 'function') {
try { window.EmailService.sendNewUserEmail({ ...resetUser, username: resetUser.username || resetUser.email, role: 'reset' }, tempPw).catch(()=>{}); } catch(_){}
}
step1.style.display = 'none';
document.getElementById('rp-step2').style.display = 'block';
document.getElementById('rp-temp').value = tempPw;
btn.textContent = 'تم';
Toast.success('تم إعادة تعيين كلمة المرور');
// التدقيق يُكتب على الخادم داخل admin_reset_password (لا حاجة لتدقيق عميل)
} else {
btn.textContent = orig;
btn.disabled = false;
btn.dataset.busy = '0';
}
} catch(err) {
console.error(err);
Toast.error('فشلت العملية');
btn.textContent = orig;
btn.disabled = false;
btn.dataset.busy = '0';
}
});
}

function renderViewEmployee(id) {
const emp = DB.getUser(id);
if (!emp) return '<div class="alert alert-danger">الموظف غير موجود</div>';
const evals = DB.getEvaluations({ employee_id: id });
const avg = DB.getAvgScore(id);

const rows = evals.map(e => {
const evr = DB.getUser(e.evaluator_id);
return `<tr style="cursor:pointer" data-nav-eval="${e.id}">
<td>#${e.id}</td>
<td>${Utils.formatDate(e.evaluation_date)}</td>
<td>${Utils.escape(evr ? evr.full_name : '-')}</td>
<td>${e.total_score}/100</td>
<td>${Utils.gradeBadge(e.percentage)}</td>
</tr>`;
}).join('');

// أخطاء هذا الشهر vs الشهر السابق
const now = new Date();
const thisY = now.getFullYear(), thisM = now.getMonth();
const prevDate = new Date(thisY, thisM-1, 1);
const prevY = prevDate.getFullYear(), prevM = prevDate.getMonth();

const inMonth = (ev, y, m) => { const d = new Date(ev.evaluation_date); return d.getFullYear()===y && d.getMonth()===m; };
const thisMonthEvals = evals.filter(e => inMonth(e, thisY, thisM));
const prevMonthEvals = evals.filter(e => inMonth(e, prevY, prevM));

const collectErrors = (list) => {
const counts = {};
list.forEach(e => {
if (isPositiveObservation(e)) return;
const k = e.observed_issue === 'أخرى' ? (e.observed_issue_other || 'أخرى') : (e.observed_issue || e.call_type);
if (k) counts[k] = (counts[k]||0)+1;
});
return counts;
};
const thisErrors = collectErrors(thisMonthEvals);
const prevErrors = collectErrors(prevMonthEvals);
const thisTotal = Object.values(thisErrors).reduce((a,b)=>a+b, 0);
const prevTotal = Object.values(prevErrors).reduce((a,b)=>a+b, 0);
const sortedErrors = Object.entries(thisErrors).sort((a,b)=>b[1]-a[1]);

// إجراءات المشرف
const supActions = thisMonthEvals.filter(e => e.supervisor_action).map(e => ({
eval_id: e.id, action: e.supervisor_action === 'أخرى' ? (e.supervisor_action_other||'أخرى') : e.supervisor_action,
notes: e.supervisor_notes, by: e.supervisor_action_by_name, at: e.supervisor_action_at,
percentage: e.percentage
}));

// نسبة التحسن مقارنة بالشهر السابق
const thisAvg = thisMonthEvals.length ? Math.round(thisMonthEvals.reduce((s,x)=>s+x.percentage,0)/thisMonthEvals.length*10)/10 : 0;
const prevAvg = prevMonthEvals.length ? Math.round(prevMonthEvals.reduce((s,x)=>s+x.percentage,0)/prevMonthEvals.length*10)/10 : 0;
const change = thisAvg - prevAvg;

const errorsRows = sortedErrors.map(([k, count], i) => {
const pct = thisTotal ? Math.round((count/thisTotal)*100*10)/10 : 0;
const prevCount = prevErrors[k] || 0;
const diff = count - prevCount;
return `<tr>
<td><div style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:${i<3?(i===0?'#ef4444':i===1?'#f59e0b':'#06b6d4'):'#e2e8f0'};color:white;font-weight:700">${i+1}</div></td>
<td><strong>${Utils.escape(k)}</strong></td>
<td style="text-align:center"><span class="badge badge-warning">${count}</span></td>
<td style="text-align:center">${pct}%</td>
<td style="text-align:center">${prevCount > 0 ? (diff > 0 ? `<span style="color:var(--danger)">▲ +${diff}</span>` : diff < 0 ? `<span style="color:var(--success)">▼ ${diff}</span>` : '<span style="color:var(--muted)">— ثابت</span>') : '<span style="color:var(--info)">جديد</span>'}</td>
</tr>`;
}).join('');

const supActionsHTML = supActions.length ? supActions.map(a => `<tr>
<td><strong>#${a.eval_id}</strong> (${a.percentage}%)</td>
<td><strong style="color:#6d28d9">${Utils.escape(a.action)}</strong></td>
<td>${Utils.escape(a.by||'-')}</td>
<td>${Utils.formatDateTime(a.at)}</td>
<td style="max-width:280px">${Utils.escape((a.notes||'').slice(0,120))}${(a.notes||'').length>120?'...':''}</td>
</tr>`).join('') : '<tr><td colspan="5" style="text-align:center;padding:14px;color:var(--muted)">لا توجد إجراءات مشرف هذا الشهر</td></tr>';

return `
<div class="page-header">
<div><div class="page-title">${Utils.escape(emp.full_name)}</div><div class="page-subtitle">${Utils.escape(emp.position||'')} - ${Utils.escape(emp.department||'')} | المشرف: ${Utils.escape(emp.supervisor_name||'-')}</div></div>
<button class="btn btn-secondary" data-nav="employees">← رجوع</button>
</div>
<div class="stats-grid">
<div class="stat-card"><div class="stat-icon" style="background:var(--primary)">📋</div><div class="stat-value">${evals.length}</div><div class="stat-label">إجمالي التقييمات</div></div>
<div class="stat-card"><div class="stat-icon" style="background:var(--success)">⭐</div><div class="stat-value">${avg}%</div><div class="stat-label">متوسط الأداء العام</div></div>
<div class="stat-card"><div class="stat-icon" style="background:var(--info)">📅</div><div class="stat-value">${thisAvg}%</div><div class="stat-label">متوسط الشهر الحالي</div></div>
<div class="stat-card" style="background:linear-gradient(135deg,${change>=0?'#10b981':'#ef4444'},${change>=0?'#059669':'#dc2626'});color:white"><div class="stat-icon" style="background:rgba(255,255,255,0.25)">${change>=0?'📈':'📉'}</div><div class="stat-value" style="color:white">${change>=0?'+':''}${change.toFixed(1)}%</div><div class="stat-label" style="color:rgba(255,255,255,0.9)">مقارنة بالشهر السابق</div></div>
</div>

<div class="card" style="margin-bottom:20px;border-right:4px solid #ef4444">
<div class="card-header" style="background:linear-gradient(to left,#fee2e2,transparent)"><div class="card-title">❌ أكثر الأخطاء تكراراً هذا الشهر</div></div>
<div style="padding:14px;background:#fff7ed;font-size:13px;color:var(--muted)">
الشهر الحالي: <strong>${thisTotal}</strong> خطأ في <strong>${thisMonthEvals.length}</strong> تقييم | الشهر السابق: <strong>${prevTotal}</strong> خطأ في <strong>${prevMonthEvals.length}</strong> تقييم
</div>
<table class="table">
<thead><tr><th>الترتيب</th><th>الملاحظة</th><th style="text-align:center">التكرار</th><th style="text-align:center">النسبة</th><th style="text-align:center">مقارنة بالشهر السابق</th></tr></thead>
<tbody>${errorsRows || '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--muted)">لا توجد أخطاء مرصودة هذا الشهر</td></tr>'}</tbody>
</table>
</div>

<div class="card" style="margin-bottom:20px;border-right:4px solid #7c3aed">
<div class="card-header" style="background:linear-gradient(to left,#ede9fe,transparent)"><div class="card-title">👨‍💼 إجراءات المشرف لمعالجة الأخطاء (${supActions.length})</div></div>
<table class="table">
<thead><tr><th>التقييم</th><th>الإجراء</th><th>المشرف</th><th>التاريخ</th><th>الملاحظات</th></tr></thead>
<tbody>${supActionsHTML}</tbody>
</table>
</div>

<div class="card">
<div class="card-header"><div class="card-title">📋 سجل التقييمات (${evals.length})</div></div>
<table class="table">
<thead><tr><th>#</th><th>التاريخ</th><th>المقيِّم</th><th>الدرجة</th><th>التقدير</th></tr></thead>
<tbody>${rows || '<tr><td colspan="5" style="text-align:center;padding:20px">لا توجد تقييمات</td></tr>'}</tbody>
</table>
</div>`;
}

// ============================================
// Evaluations List
// ============================================
function renderEvaluations() {
const isEmp = currentUser.role === 'employee';
const evals = DB.getEvaluations(isEmp ? { employee_id: currentUser.id } : {});

const rows = evals.map(e => {
const emp = DB.getUser(e.employee_id);
const evr = DB.getUser(e.evaluator_id);
const canDelete = Perms.can('delete_evaluation');
return `<tr>
<td>#${e.id}</td>
<td>${Utils.escape(emp?emp.full_name:'-')}</td>
<td>${Utils.escape(evr?evr.full_name:'-')}</td>
<td>${Utils.formatDate(e.evaluation_date)}</td>
<td>${e.total_score}/100</td>
<td>${Utils.gradeBadge(e.percentage)}</td>
<td>
<button class="btn btn-sm btn-primary" data-nav-eval="${e.id}">عرض</button>
${canDelete ? `<button class="btn btn-sm btn-warning" data-edit-eval="${e.id}">تعديل</button>` : ''}
${canDelete ? `<button class="btn btn-sm btn-danger" data-del-eval="${e.id}">حذف</button>` : ''}
</td>
</tr>`;
}).join('');

return `
<div class="page-header">
<div><div class="page-title">التقييمات (${evals.length})</div><div class="page-subtitle">سجل كامل لجميع التقييمات</div></div>
<div style="display:flex;gap:10px;flex-wrap:wrap">
<button class="btn btn-success" id="exp-xlsx">📊 Excel</button>
<button class="btn btn-danger" id="exp-pdf">📄 PDF</button>
${(currentUser.role === 'admin' || currentUser.role === 'supervisor') ? '<button class="btn btn-primary" data-nav="new-evaluation">➕ تقييم جديد</button>' : ''}
</div>
</div>
<div class="card">
<div style="padding:14px"><input type="text" class="form-control" id="eval-search" placeholder="🔍 ابحث في التقييمات..."></div>
<table class="table" id="eval-table">
<thead><tr><th>#</th><th>الموظف</th><th>المقيِّم</th><th>التاريخ</th><th>الدرجة</th><th>التقدير</th><th>إجراءات</th></tr></thead>
<tbody>${rows || '<tr><td colspan="7" style="text-align:center;padding:20px">لا توجد تقييمات</td></tr>'}</tbody>
</table>
</div>`;
}

// ============================================
// Observations & Actions Constants
// ============================================
const NO_ISSUE_LABEL = 'لا يوجد ملاحظات';
const OBSERVED_ISSUES = [
NO_ISSUE_LABEL,
'عدم الالتزام بسير المكالمة',
'عدم التحقق من بيانات العميل',
'ضعف شرح المنتج أو الخدمة',
'خطأ في إدخال البيانات',
'تأخر في الاستجابة',
'أخرى'
];
// تحديد ما إذا كانت الملاحظة سلبية (خطأ) أم إيجابية (لا يوجد ملاحظات)
function isPositiveObservation(ev) {
return (ev.observed_issue === NO_ISSUE_LABEL);
}
const ACTIONS_TAKEN = [
'تنبيه شفهي',
'تنبيه كتابي',
'إعادة تدريب',
'جلسة توجيهية',
'لا يوجد إجراء',
'أخرى'
];
// إجراءات المشرف بعد صدور التقييم
const SUPERVISOR_ACTIONS = [
'تنبيه شفهي',
'تنبيه كتابي',
'إعادة تدريب',
'جلسة تطوير وتحسين أداء',
'متابعة خاصة',
'لا يوجد إجراء',
'أخرى'
];

function buildObservedIssueSelect(selected='', other='') {
const opts = OBSERVED_ISSUES.map(o => {
const isPositive = o === NO_ISSUE_LABEL;
const label = isPositive ? '✅ ' + o + ' (تقييم إيجابي)' : o;
return `<option value="${o}" ${o===selected?'selected':''}>${label}</option>`;
}).join('');
return `<select class="form-control" id="ef-observed" required onchange="(function(s){document.getElementById('ef-observed-other-wrap').style.display = s.value==='أخرى'?'block':'none'; document.getElementById('ef-positive-hint').style.display = s.value==='${NO_ISSUE_LABEL}'?'block':'none';})(this)">
<option value="">-- اختر الملاحظة المرصودة --</option>
${opts}
</select>
<div id="ef-positive-hint" style="margin-top:8px;padding:10px 14px;background:linear-gradient(to left,#d1fae5,#ecfdf5);border:1px solid #6ee7b7;border-radius:8px;color:#065f46;font-size:13px;font-weight:600;${selected===NO_ISSUE_LABEL?'':'display:none'}">
✅ تقييم إيجابي - لم يتم رصد أي ملاحظات أو أخطاء، الموظف أدى مهامه بشكل صحيح.
</div>
<div id="ef-observed-other-wrap" style="margin-top:8px;${selected==='أخرى'?'':'display:none'}">
<input class="form-control" id="ef-observed-other" placeholder="اكتب وصف الملاحظة..." value="${Utils.escape(other||'')}">
</div>`;
}

function buildActionTakenSelect(selected='', other='') {
const opts = ACTIONS_TAKEN.map(o => `<option value="${o}" ${o===selected?'selected':''}>${o}</option>`).join('');
return `<select class="form-control" id="ef-action" required onchange="document.getElementById('ef-action-other-wrap').style.display = this.value==='أخرى'?'block':'none'">
<option value="">-- اختر الإجراء المتخذ --</option>
${opts}
</select>
<div id="ef-action-other-wrap" style="margin-top:8px;${selected==='أخرى'?'':'display:none'}">
<input class="form-control" id="ef-action-other" placeholder="اكتب وصف الإجراء..." value="${Utils.escape(other||'')}">
</div>`;
}

// Supervisor Action Modal - إجراء المشرف بعد التقييم
function showSupervisorActionModal(evalId) {
const ev = DB.getEvaluation(evalId);
if (!ev) return;
const emp = DB.getUser(ev.employee_id);
const isEdit = !!ev.supervisor_action;
const actOpts = SUPERVISOR_ACTIONS.map(o => `<option value="${o}" ${o===ev.supervisor_action?'selected':''}>${o}</option>`).join('');

const body = `<div class="alert alert-info" style="margin-bottom:14px;font-size:13px">
👨‍💼 إجراء المشرف على تقييم <strong>#${ev.id}</strong> للموظف <strong>${Utils.escape(emp?emp.full_name:'-')}</strong> (${ev.percentage}% - ${ev.grade})
</div>
<div class="form-group">
<label class="form-label">الإجراء المتخذ من قِبَل المشرف *</label>
<select class="form-control" id="sa-action" required onchange="document.getElementById('sa-other-wrap').style.display = this.value==='أخرى'?'block':'none'">
<option value="">-- اختر الإجراء --</option>${actOpts}
</select>
<div id="sa-other-wrap" style="margin-top:8px;${ev.supervisor_action==='أخرى'?'':'display:none'}">
<input class="form-control" id="sa-action-other" placeholder="اكتب وصف الإجراء..." value="${Utils.escape(ev.supervisor_action_other||'')}">
</div>
</div>
<div class="form-group">
<label class="form-label">ملاحظات / توصيات المشرف</label>
<textarea class="form-control" id="sa-notes" rows="4" placeholder="أضف ملاحظاتك أو توصياتك للموظف...">${Utils.escape(ev.supervisor_notes||'')}</textarea>
</div>
${ev.supervisor_action_at ? `<div style="background:#f1f5f9;padding:10px;border-radius:8px;font-size:12px;color:var(--muted)">
آخر تسجيل: ${Utils.escape(ev.supervisor_action_by_name||'-')} - ${Utils.formatDateTime(ev.supervisor_action_at)}
</div>` : ''}`;
const footer = `<button class="btn btn-secondary" onclick="Modal.close()">إلغاء</button><button class="btn btn-primary" id="sa-save">${isEdit?'تحديث':'حفظ الإجراء'}</button>`;
Modal.show('⚖️ تسجيل إجراء المشرف', body, footer);

document.getElementById('sa-save').addEventListener('click', async (e) => {
const btn = e.currentTarget;
await submitWithFeedback(btn, 'جاري الحفظ...', null, async () => {
const action = document.getElementById('sa-action').value;
const action_other = (document.getElementById('sa-action-other')||{}).value || '';
const notes = document.getElementById('sa-notes').value.trim();
if (!action) { Toast.error('يرجى اختيار الإجراء'); return false; }
if (action === 'أخرى' && !action_other.trim()) { Toast.error('يرجى كتابة وصف الإجراء'); return false; }
if (window.sb && window.sb.rpc) {
const { data, error } = await window.sb.rpc('record_supervisor_action', {
p_session_token: (window.getSessionToken ? window.getSessionToken() : null),
p_eval_id: evalId, p_action: action, p_action_other: action_other.trim(), p_notes: notes
});
const row = (!error && Array.isArray(data) && data[0]) ? data[0] : null;
if (!row || !row.ok) { const msg=(row&&row.message)||(error&&error.message)||'تعذّر تسجيل الإجراء'; const h=handleSessionError(msg); if(!h) Toast.error(msg); return false; }
if (window.SupabaseSync && SupabaseSync.pullAll) { try{ await SupabaseSync.pullAll(); }catch(_){} }
try { const ev=DB.getEvaluation(evalId); if (ev && window.EmailService) window.EmailService.sendActionEmail(ev, {action, notes}).catch(()=>{}); } catch(_){}
} else {
DB.recordSupervisorAction(evalId, { action, action_other: action_other.trim(), notes });
}
Toast.success('تم تسجيل إجراء المشرف');
Modal.close();
if (typeof navigate === 'function') navigate('view-evaluation', { id: evalId });
return true;
});
});
}

// ============================================
// New Evaluation Form
// ============================================
function renderNewEvaluation() {
const employees = DB.getUsers({ role:'employee', active:true });
const empOpts = employees.map(e => `<option value="${e.id}">${Utils.escape(e.full_name)}</option>`).join('');

const A = CRITERIA.answers;
const sectionsHTML = CRITERIA.sections.map(s => `
<div class="card">
<div class="card-header">
<div class="card-title">${Utils.escape(s.title)} ${s.type === 'critical' ? '<span class="badge badge-danger" style="margin-right:8px">حرج</span>' : ''}</div>
<div style="color:var(--muted);font-size:13px">${s.weight} نقطة</div>
</div>
<div class="card-body" style="padding:0">
${s.subsections.map(sub => `
${s.subsections.length > 1 || s.type === 'non-critical' ? `<div class="subsection-title">${Utils.escape(sub.title)} ${sub.weight ? `<span style="font-weight:400;font-size:12px">(${sub.weight} نقطة)</span>` : ''}</div>` : ''}
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
</div>
</div>`).join('');

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
}

function collectItems() {
const items = {};
CRITERIA.sections.forEach(s => s.subsections.forEach(sub => sub.items.forEach(it => {
const r = document.querySelector(`input[name="item-${it.key}"]:checked`);
items[it.key] = r ? r.value : CRITERIA.answers.OK;
})));
return items;
}

function attachNewEvalHandlers() {
const form = document.getElementById('new-eval-form');
if (!form) return;

const updateLive = () => {
const items = collectItems();
const r = calculateScores(items);
document.getElementById('live-score').textContent = `${r.totalScore} / 100`;
document.getElementById('live-grade').innerHTML = Utils.gradeBadge(r.percentage);
};

form.querySelectorAll('input[type=radio]').forEach(r => r.addEventListener('change', updateLive));

form.addEventListener('submit', async e => {
e.preventDefault();
const btn = form.querySelector('button[type=submit]');
await submitWithFeedback(btn, 'جاري حفظ التقييم...', null, async () => {
const empId = parseInt(document.getElementById('ef-employee').value);
if (!empId) { Toast.error('يرجى اختيار الموظف'); return false; }

const items = collectItems();
const r = calculateScores(items);

const observed = document.getElementById('ef-observed').value;
const observedOther = (document.getElementById('ef-observed-other')||{}).value || '';
const action = document.getElementById('ef-action').value;
const actionOther = (document.getElementById('ef-action-other')||{}).value || '';

if (!observed) { Toast.error('يرجى اختيار الملاحظة المرصودة'); return false; }
if (observed === 'أخرى' && !observedOther.trim()) { Toast.error('يرجى كتابة وصف الملاحظة'); return false; }
if (!action) { Toast.error('يرجى اختيار الإجراء المتخذ'); return false; }
if (action === 'أخرى' && !actionOther.trim()) { Toast.error('يرجى كتابة وصف الإجراء'); return false; }

let newEvalId = null, newPct = r.percentage, newGrade = r.grade;
if (window.sb && window.sb.rpc) {
const { data, error } = await window.sb.rpc('create_evaluation', {
p_session_token: (window.getSessionToken ? window.getSessionToken() : null),
p_employee_id: empId,
p_evaluation_date: document.getElementById('ef-date').value,
p_observed_issue: observed,
p_observed_issue_other: observedOther.trim(),
p_action_taken: action,
p_action_taken_other: actionOther.trim(),
p_notes: document.getElementById('ef-notes').value.trim(),
p_items: items
});
const row = (!error && Array.isArray(data) && data[0]) ? data[0] : null;
if (!row || !row.ok) { const msg=(row&&row.message)||(error&&error.message)||'تعذّر حفظ التقييم'; const h=handleSessionError(msg); if(!h) Toast.error(msg); return false; }
newEvalId = row.evaluation_id; newPct = row.percentage; newGrade = row.grade;
if (window.SupabaseSync && SupabaseSync.pullAll) { try{ await SupabaseSync.pullAll(); }catch(_){} }
// بريد (fire-and-forget) من العميل بعد نجاح الإنشاء
try { const ne = DB.getEvaluation(newEvalId); if (ne && window.EmailService) window.EmailService.sendEvaluationEmail(ne).catch(()=>{}); } catch(_){}
} else {
const newEval = DB.createEvaluation({
employee_id: empId, evaluator_id: currentUser.id,
evaluation_date: document.getElementById('ef-date').value,
call_type: observed === 'أخرى' ? observedOther.trim() : observed,
observed_issue: observed, observed_issue_other: observedOther.trim(),
action_taken: action, action_taken_other: actionOther.trim(),
notes: document.getElementById('ef-notes').value.trim(),
items: items, section_scores: r.sectionScores, total_score: r.totalScore,
percentage: r.percentage, grade: r.grade, status: r.status
});
if (newEval && newEval._duplicate) Toast.warning('تم رصد تكرار - استخدمنا التقييم السابق');
newEvalId = newEval.id;
}
Toast.success(`تم حفظ التقييم بنجاح - ${newPct}% (${newGrade})`);
if (typeof navigate === 'function') navigate('view-evaluation', { id: newEvalId });
return true;
});
});
}

// ============================================
// View Evaluation
// ============================================
function renderViewEvaluation(id) {
const ev = DB.getEvaluation(id);
if (!ev) return '<div class="alert alert-danger">التقييم غير موجود</div>';
if (currentUser.role === 'employee' && ev.employee_id !== currentUser.id) {
return '<div class="alert alert-danger">ليس لديك صلاحية لعرض هذا التقييم</div>';
}

const emp = DB.getUser(ev.employee_id);
const evr = DB.getUser(ev.evaluator_id);
const A = CRITERIA.answers;

const sectionsHTML = CRITERIA.sections.map(s => {
const score = (ev.section_scores && ev.section_scores[s.key] !== undefined) ? ev.section_scores[s.key] : 0;
return `
<div class="card">
<div class="card-header">
<div class="card-title">${Utils.escape(s.title)}</div>
<span class="badge ${score === s.weight ? 'badge-success' : score === 0 ? 'badge-danger' : 'badge-warning'}">${score} / ${s.weight}</span>
</div>
<div class="card-body" style="padding:0">
${s.subsections.map(sub => `
${s.subsections.length > 1 || s.type === 'non-critical' ? `<div class="subsection-title">${Utils.escape(sub.title)}</div>` : ''}
${sub.items.map(it => {
const ans = (ev.items && ev.items[it.key]) || A.OK;
let badge = '<span class="badge badge-success">✅ لا يوجد خطأ</span>';
if (ans === A.ERR) badge = '<span class="badge badge-danger">❌ يوجد خطأ</span>';
else if (ans === A.NA) badge = '<span class="badge badge-info">⚪ لا ينطبق</span>';
return `<div class="eval-item"><div class="eval-item-label">${Utils.escape(it.label)}</div><div>${badge}</div></div>`;
}).join('')}
`).join('')}
</div>
</div>`;
}).join('');

// تحقق من وجود اعتراض على هذا التقييم
const existingObj = DB.getObjections({ evaluation_id: ev.id }).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0];
const showObjButton = currentUser.role === 'employee' && ev.employee_id === currentUser.id && (!existingObj || (existingObj.status !== 'pending' && existingObj.status !== 'under_review'));
const showObjStatus = existingObj;

return `
<div class="page-header">
<div><div class="page-title">تقييم #${ev.id}</div><div class="page-subtitle">${Utils.escape(emp?emp.full_name:'-')} - ${Utils.formatDate(ev.evaluation_date)}</div></div>
<div style="display:flex;gap:10px;flex-wrap:wrap">
${Perms.can('edit_evaluation') || (currentUser.role === 'supervisor' && ev.evaluator_id === currentUser.id) ? `<button class="btn btn-warning" data-edit-eval="${ev.id}">✏️ تعديل</button>` : ''}
${Perms.can('approve_evaluation') && !ev.approved ? `<button class="btn btn-info" id="approve-eval-btn">✓ اعتماد التقييم</button>` : ''}
${ev.approved ? '<span class="badge badge-success" style="padding:8px 14px">✓ معتمد</span>' : ''}
${(currentUser.role === 'supervisor' && emp && emp.supervisor_name === currentUser.full_name) ? `<button class="btn btn-primary" id="sup-action-btn">⚖️ ${ev.supervisor_action?'تعديل إجراء المشرف':'تسجيل إجراء المشرف'}</button>` : ''}
${showObjButton ? `<button class="btn btn-warning" data-nav-newobj="${ev.id}">⚖️ تقديم اعتراض</button>` : ''}
${existingObj ? `<button class="btn btn-info" data-nav-obj="${existingObj.id}">⚖️ عرض الاعتراض (${Utils.escape(existingObj.ref_number)})</button>` : ''}
<button class="btn btn-success" id="single-xlsx">📊 Excel</button>
<button class="btn btn-danger" id="single-pdf">📄 PDF</button>
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

${isPositiveObservation(ev) ? `
<div class="alert" style="background:linear-gradient(to left,#d1fae5,#ecfdf5);border:2px solid #10b981;color:#065f46;padding:14px 18px;margin-bottom:18px;border-radius:12px;display:flex;align-items:center;gap:14px">
<div style="font-size:36px">✅</div>
<div>
<div style="font-size:18px;font-weight:800;margin-bottom:4px">تقييم إيجابي - لا يوجد ملاحظات</div>
<div style="font-size:13px">تمت مراجعة أداء الموظف ولم يتم رصد أي ملاحظات أو أخطاء. الموظف أدى المهام المطلوبة بالشكل الصحيح.</div>
</div>
</div>` : ''}

<div class="grid grid-2" style="margin-bottom:20px">
<div class="card" style="border-right:4px solid ${isPositiveObservation(ev)?'var(--success)':'var(--info)'}">
<div class="card-header"><div class="card-title">🔍 الملاحظة المرصودة</div></div>
<div class="card-body">
<div style="font-size:16px;font-weight:700;color:${isPositiveObservation(ev)?'var(--success)':'var(--text)'}">${isPositiveObservation(ev) ? '✅ ' : ''}${Utils.escape(ev.observed_issue || ev.call_type || '-')}</div>
${ev.observed_issue === 'أخرى' && ev.observed_issue_other ? `<div style="margin-top:8px;color:var(--muted);background:#f1f5f9;padding:10px;border-radius:8px">${Utils.escape(ev.observed_issue_other)}</div>` : ''}
</div>
</div>
<div class="card" style="border-right:4px solid var(--warning)">
<div class="card-header"><div class="card-title">⚖️ الإجراء المتخذ (من قِبَل الجودة)</div></div>
<div class="card-body">
${ev.action_taken ? `
<div style="font-size:16px;font-weight:700;color:var(--text)">${Utils.escape(ev.action_taken)}</div>
${ev.action_taken === 'أخرى' && ev.action_taken_other ? `<div style="margin-top:8px;color:var(--muted);background:#f1f5f9;padding:10px;border-radius:8px">${Utils.escape(ev.action_taken_other)}</div>` : ''}
` : '<div style="color:var(--danger);font-weight:600">⚠️ لم يتم تحديد الإجراء بعد</div>'}
</div>
</div>
</div>

<div class="card" style="margin-bottom:20px;border-right:4px solid #7c3aed">
<div class="card-header" style="background:linear-gradient(to left,#ede9fe,transparent)"><div class="card-title">👨‍💼 إجراء المشرف</div></div>
<div class="card-body">
${ev.supervisor_action ? `
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-bottom:14px">
<div style="background:#f8fafc;padding:12px;border-radius:8px">
<div style="font-size:12px;color:var(--muted);margin-bottom:4px">الإجراء</div>
<div style="font-weight:700;color:#6d28d9">⚖️ ${Utils.escape(ev.supervisor_action === 'أخرى' ? (ev.supervisor_action_other||'أخرى') : ev.supervisor_action)}</div>
</div>
<div style="background:#f8fafc;padding:12px;border-radius:8px">
<div style="font-size:12px;color:var(--muted);margin-bottom:4px">المشرف</div>
<div style="font-weight:700">👤 ${Utils.escape(ev.supervisor_action_by_name||'-')}</div>
</div>
<div style="background:#f8fafc;padding:12px;border-radius:8px">
<div style="font-size:12px;color:var(--muted);margin-bottom:4px">التاريخ والوقت</div>
<div style="font-weight:700">📅 ${Utils.formatDateTime(ev.supervisor_action_at)}</div>
</div>
</div>
${ev.supervisor_notes ? `<div style="background:#fef3c7;border-right:3px solid var(--warning);padding:12px;border-radius:8px"><strong>ملاحظات / توصيات المشرف:</strong><br>${Utils.escape(ev.supervisor_notes).replace(/\n/g,'<br>')}</div>` : ''}
` : `<div style="text-align:center;padding:20px;color:var(--muted)">
<div style="font-size:32px;margin-bottom:8px">⏳</div>
لم يتم تسجيل إجراء المشرف بعد
${(currentUser.role === 'supervisor' && emp && emp.supervisor_name === currentUser.full_name) ? '<div style="margin-top:10px"><button class="btn btn-primary btn-sm" id="sup-action-empty-btn">⚖️ تسجيل الإجراء الآن</button></div>' : ''}
</div>`}
</div>
</div>

${sectionsHTML}`;
}

// ============================================
// Reports
// ============================================
function renderReports() {
const period = currentParams.period || 'all'; // all, year, month, custom
const year = parseInt(currentParams.year) || new Date().getFullYear();
const month = currentParams.month || ''; // YYYY-MM
const filterDept = currentParams.dept || '';
const filterSup = currentParams.sup || '';
const fromDate = currentParams.from || '';
const toDate = currentParams.to || '';

let employees = DB.getUsers({ role:'employee' });
if (currentUser.role === 'supervisor') {
employees = employees.filter(e => e.supervisor_name === currentUser.full_name);
}
if (filterDept) employees = employees.filter(e => (e.department||'') === filterDept);
if (filterSup) employees = employees.filter(e => (e.supervisor_name||'') === filterSup);

// Filter evaluations by period
let allEvals = DB.data.evaluations.slice();
if (period === 'year') {
allEvals = allEvals.filter(ev => new Date(ev.evaluation_date).getFullYear() === year);
} else if (period === 'month' && month) {
const [y, m] = month.split('-').map(Number);
allEvals = allEvals.filter(ev => { const d = new Date(ev.evaluation_date); return d.getFullYear()===y && d.getMonth()===m-1; });
} else if (period === 'custom' && fromDate && toDate) {
const f = new Date(fromDate), t = new Date(toDate);
allEvals = allEvals.filter(ev => { const d = new Date(ev.evaluation_date); return d >= f && d <= t; });
}

const empData = employees.map(e => {
const ue = allEvals.filter(ev => ev.employee_id === e.id);
const sumP = ue.reduce((s,x)=>s+x.percentage,0);
const high = ue.length ? Math.max(...ue.map(x=>x.percentage)) : 0;
const low = ue.length ? Math.min(...ue.map(x=>x.percentage)) : 0;
return {
id: e.id,
employee_number: e.employee_number || '-',
name: e.full_name,
supervisor: e.supervisor_name || '-',
department: e.department || '-',
position: e.position || '-',
count: ue.length,
avg: ue.length ? Math.round(sumP/ue.length*10)/10 : 0,
high, low
};
}).filter(e => e.count > 0).sort((a,b) => b.avg - a.avg);

const totalEmps = employees.length;
const totalEvals = allEvals.length;
const overallAvg = empData.length ? Math.round(empData.reduce((s,e)=>s+e.avg,0)/empData.length*10)/10 : 0;
const excellent = empData.filter(e => e.avg >= 85).length;
const needFollow = empData.filter(e => e.avg <= 84).length;

// Period label
let periodLabel = 'كل البيانات';
if (period === 'year') periodLabel = `سنة ${year}`;
else if (period === 'month' && month) periodLabel = arabicMonthName(month);
else if (period === 'custom' && fromDate && toDate) periodLabel = `${Utils.formatDate(fromDate)} → ${Utils.formatDate(toDate)}`;

// Available year list
const allYears = new Set([new Date().getFullYear()]);
DB.data.evaluations.forEach(ev => allYears.add(new Date(ev.evaluation_date).getFullYear()));
const yearOpts = Array.from(allYears).sort().reverse().map(y => `<option value="${y}" ${y===year?'selected':''}>${y}</option>`).join('');

// Department list
const deptSet = new Set();
DB.getUsers({role:'employee'}).forEach(u => { if (u.department) deptSet.add(u.department); });
const deptOpts = Array.from(deptSet).map(d => `<option value="${d}" ${d===filterDept?'selected':''}>${d}</option>`).join('');

// Supervisor list
const supSet = new Set();
DB.getUsers({role:'employee'}).forEach(u => { if (u.supervisor_name && u.supervisor_name !== '-') supSet.add(u.supervisor_name); });
const supOpts = Array.from(supSet).map(s => `<option value="${s}" ${s===filterSup?'selected':''}>${s}</option>`).join('');

// Month options
const monthSet = new Set();
DB.data.evaluations.forEach(ev => { const d = new Date(ev.evaluation_date); monthSet.add(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`); });
const now2 = new Date();
monthSet.add(`${now2.getFullYear()}-${String(now2.getMonth()+1).padStart(2,'0')}`);
const monthOpts = Array.from(monthSet).sort().reverse().map(m => `<option value="${m}" ${m===month?'selected':''}>${arabicMonthName(m)}</option>`).join('');

const rows = empData.map((e, i) => `<tr>
<td><div style="display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;background:${i<3?(i===0?'#fbbf24':i===1?'#94a3b8':'#cd7f32'):'#e2e8f0'};color:white;font-weight:700">${i+1}</div></td>
<td><strong>${Utils.escape(e.employee_number)}</strong></td>
<td><div style="display:flex;align-items:center;gap:10px"><div class="user-avatar">${Utils.getInitials(e.name)}</div>${Utils.escape(e.name)}</div></td>
<td>${Utils.escape(e.supervisor)}</td>
<td style="text-align:center">${e.count}</td>
<td style="text-align:center"><strong>${e.avg}%</strong></td>
<td style="text-align:center;color:var(--success);font-weight:600">${e.high}%</td>
<td style="text-align:center;color:var(--danger);font-weight:600">${e.low}%</td>
<td>${Utils.gradeBadge(e.avg)}</td>
</tr>`).join('');

return `
<div class="page-header">
<div><div class="page-title">التقارير والإحصائيات</div><div class="page-subtitle">${periodLabel} - تحليل شامل لأداء فريق العمل</div></div>
<div style="display:flex;gap:8px">
<button class="btn btn-success" id="rep-export-xlsx">📊 تصدير Excel</button>
<button class="btn btn-danger" id="rep-export-pdf">📄 تصدير PDF</button>
</div>
</div>

<div class="card" style="margin-bottom:20px">
<div style="padding:16px;background:#f8fafc;border-bottom:1px solid var(--border)">
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;align-items:end">
<div class="form-group" style="margin:0">
<label class="form-label" style="font-size:12px">الفترة الزمنية</label>
<select class="form-control rep-filter" id="rep-period">
<option value="all" ${period==='all'?'selected':''}>كل البيانات</option>
<option value="year" ${period==='year'?'selected':''}>تقرير سنوي</option>
<option value="month" ${period==='month'?'selected':''}>تقرير شهري</option>
<option value="custom" ${period==='custom'?'selected':''}>فترة مخصصة</option>
</select>
</div>
<div class="form-group" style="margin:0;${period==='year'?'':'display:none'}" id="rep-year-wrap">
<label class="form-label" style="font-size:12px">السنة</label>
<select class="form-control rep-filter" id="rep-year">${yearOpts}</select>
</div>
<div class="form-group" style="margin:0;${period==='month'?'':'display:none'}" id="rep-month-wrap">
<label class="form-label" style="font-size:12px">الشهر</label>
<select class="form-control rep-filter" id="rep-month">${monthOpts}</select>
</div>
<div class="form-group" style="margin:0;${period==='custom'?'':'display:none'}" id="rep-from-wrap">
<label class="form-label" style="font-size:12px">من</label>
<input type="date" class="form-control rep-filter" id="rep-from" value="${fromDate}">
</div>
<div class="form-group" style="margin:0;${period==='custom'?'':'display:none'}" id="rep-to-wrap">
<label class="form-label" style="font-size:12px">إلى</label>
<input type="date" class="form-control rep-filter" id="rep-to" value="${toDate}">
</div>
<div class="form-group" style="margin:0">
<label class="form-label" style="font-size:12px">القسم/الإدارة</label>
<select class="form-control rep-filter" id="rep-dept">
<option value="">الكل</option>${deptOpts}
</select>
</div>
<div class="form-group" style="margin:0">
<label class="form-label" style="font-size:12px">المشرف</label>
<select class="form-control rep-filter" id="rep-sup">
<option value="">الكل</option>${supOpts}
</select>
</div>
<button class="btn btn-secondary" id="rep-clear" style="height:42px">🔄 إعادة تعيين</button>
</div>
</div>
</div>

<div class="stats-grid">
<div class="stat-card" style="background:linear-gradient(135deg,#06579F,#2378c4);color:white"><div class="stat-icon" style="background:rgba(255,255,255,0.25)">👥</div><div class="stat-value" style="color:white">${totalEmps}</div><div class="stat-label" style="color:rgba(255,255,255,0.9)">إجمالي الموظفين</div></div>
<div class="stat-card" style="background:linear-gradient(135deg,#06b6d4,#0891b2);color:white"><div class="stat-icon" style="background:rgba(255,255,255,0.25)">📋</div><div class="stat-value" style="color:white">${totalEvals}</div><div class="stat-label" style="color:rgba(255,255,255,0.9)">إجمالي التقييمات</div></div>
<div class="stat-card" style="background:linear-gradient(135deg,#10b981,#059669);color:white"><div class="stat-icon" style="background:rgba(255,255,255,0.25)">⭐</div><div class="stat-value" style="color:white">${overallAvg}%</div><div class="stat-label" style="color:rgba(255,255,255,0.9)">المتوسط العام</div></div>
<div class="stat-card" style="background:linear-gradient(135deg,#f59e0b,#d97706);color:white"><div class="stat-icon" style="background:rgba(255,255,255,0.25)">🏆</div><div class="stat-value" style="color:white">${excellent}</div><div class="stat-label" style="color:rgba(255,255,255,0.9)">ناجح (≥85%)</div></div>
<div class="stat-card" style="background:linear-gradient(135deg,#ef4444,#dc2626);color:white"><div class="stat-icon" style="background:rgba(255,255,255,0.25)">⚠️</div><div class="stat-value" style="color:white">${needFollow}</div><div class="stat-label" style="color:rgba(255,255,255,0.9)">يحتاجون متابعة</div></div>
</div>

<div class="grid grid-2">
<div class="card">
<div class="card-header"><div class="card-title">📊 مقارنة أداء الموظفين</div></div>
<div class="card-body"><div class="chart-container" style="height:380px"><canvas id="cmp-chart"></canvas></div></div>
</div>
<div class="card">
<div class="card-header"><div class="card-title">🎯 توزيع التقديرات</div></div>
<div class="card-body"><div class="chart-container" style="height:380px"><canvas id="dist-chart"></canvas></div></div>
</div>
</div>

<div class="card" style="margin-top:20px">
<div class="card-header"><div class="card-title">🏆 ترتيب الموظفين حسب الأداء</div></div>
<div style="overflow-x:auto">
<table class="table" id="rep-table">
<thead><tr><th>الترتيب</th><th>الرقم الوظيفي</th><th>الموظف</th><th>المشرف</th><th style="text-align:center">عدد التقييمات</th><th style="text-align:center">المتوسط</th><th style="text-align:center">أعلى</th><th style="text-align:center">أدنى</th><th>التقدير</th></tr></thead>
<tbody>${rows || '<tr><td colspan="9" style="text-align:center;padding:20px">لا توجد بيانات</td></tr>'}</tbody>
</table>
</div>
</div>`;
}

function renderReportsCharts() {
const employees = DB.getUsers({ role:'employee' });
const empData = employees.map(e => {
const ue = DB.data.evaluations.filter(ev => ev.employee_id === e.id);
return {
name: e.full_name,
avg: ue.length ? Math.round(ue.reduce((s,x)=>s+x.percentage,0)/ue.length*10)/10 : 0,
count: ue.length
};
}).filter(e => e.count > 0).sort((a,b) => b.avg - a.avg);

const c = document.getElementById('cmp-chart');
if (c && empData.length) charts.push(new Chart(c, {
type:'bar',
data:{
labels: empData.map(e=>e.name),
datasets:[{ label:'متوسط الأداء %', data: empData.map(e=>e.avg), backgroundColor: empData.map(e => e.avg>=85?'#10b981':'#ef4444'), borderRadius:6 }]
},
options:{ responsive:true, maintainAspectRatio:false, indexAxis:'y', plugins:{legend:{display:false}}, scales:{ x:{ beginAtZero:true, max:100 } } }
}));

// Distribution chart
const buckets = { passed:0, failed:0 };
empData.forEach(e => {
if (e.avg>=85) buckets.passed++;
else buckets.failed++;
});
const d = document.getElementById('dist-chart');
if (d) charts.push(new Chart(d, {
type:'doughnut',
data:{
labels:['ناجح (≥85)','راسب (≤84)'],
datasets:[{ data:[buckets.passed,buckets.failed], backgroundColor:['#10b981','#ef4444'] }]
},
options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'bottom'}} }
}));
}

// ============================================
// تصدير التقارير - Excel & PDF
// ============================================
function exportReportsXLSX() {
const employees = DB.getUsers({ role:'employee' });
const allEvals = DB.data.evaluations;
const data = employees.map(e => {
const ue = allEvals.filter(ev => ev.employee_id === e.id);
const avg = ue.length ? Math.round(ue.reduce((s,x)=>s+x.percentage,0)/ue.length*10)/10 : 0;
const high = ue.length ? Math.max(...ue.map(x=>x.percentage)) : 0;
const low = ue.length ? Math.min(...ue.map(x=>x.percentage)) : 0;
return {
'الرقم الوظيفي': e.employee_number || '-',
'اسم الموظف': e.full_name,
'المسمى الوظيفي': e.position || '-',
'اسم المشرف': e.supervisor_name || '-',
'عدد التقييمات': ue.length,
'المتوسط %': avg,
'أعلى نتيجة %': high,
'أدنى نتيجة %': low,
'التقدير': ue.length ? (avg>=85?'ناجح':'راسب') : '-'
};
}).filter(r => r['عدد التقييمات'] > 0).sort((a,b) => b['المتوسط %'] - a['المتوسط %']);
if (!data.length) { Toast.error('لا توجد بيانات للتصدير'); return; }
const ws = XLSX.utils.json_to_sheet(data);
ws['!cols'] = [{wch:15},{wch:25},{wch:20},{wch:20},{wch:14},{wch:12},{wch:12},{wch:12},{wch:14}];
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'تقرير الأداء');
XLSX.writeFile(wb, `تقرير_الأداء_${new Date().toISOString().slice(0,10)}.xlsx`);
Toast.success('تم تصدير ملف Excel');
}

async function exportReportsPDF() {
const employees = DB.getUsers({ role:'employee' });
const allEvals = DB.data.evaluations;
const empData = employees.map(e => {
const ue = allEvals.filter(ev => ev.employee_id === e.id);
const avg = ue.length ? Math.round(ue.reduce((s,x)=>s+x.percentage,0)/ue.length*10)/10 : 0;
const high = ue.length ? Math.max(...ue.map(x=>x.percentage)) : 0;
const low = ue.length ? Math.min(...ue.map(x=>x.percentage)) : 0;
return { employee_number:e.employee_number||'-', name:e.full_name, position:e.position||'-', supervisor:e.supervisor_name||'-', count:ue.length, avg, high, low };
}).filter(e => e.count>0).sort((a,b) => b.avg - a.avg);
if (!empData.length) { Toast.error('لا توجد بيانات للتصدير'); return; }
const overallAvg = Math.round(empData.reduce((s,e)=>s+e.avg,0)/empData.length*10)/10;
const rows = empData.map((e,i) => `<tr><td>${i+1}</td><td>${Utils.escape(e.employee_number)}</td><td>${Utils.escape(e.name)}</td><td>${Utils.escape(e.supervisor)}</td><td style="text-align:center">${e.count}</td><td style="text-align:center"><strong>${e.avg}%</strong></td><td style="text-align:center;color:#059669">${e.high}%</td><td style="text-align:center;color:#dc2626">${e.low}%</td><td>${e.avg>=85?'ناجح':'راسب'}</td></tr>`).join('');
const html = `<div style="padding:30px;font-family:'Cairo',sans-serif;direction:rtl;background:white">${buildPDFHeader('تقرير الأداء الشامل', 'تحليل أداء فريق العمل', '#06579F')}<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px"><div style="background:#dbeafe;padding:14px;border-radius:8px;text-align:center"><div style="font-size:22px;font-weight:800;color:#06579F">${empData.length}</div><div style="color:#64748b;font-size:12px">موظف تم تقييمه</div></div><div style="background:#d1fae5;padding:14px;border-radius:8px;text-align:center"><div style="font-size:22px;font-weight:800;color:#059669">${overallAvg}%</div><div style="color:#64748b;font-size:12px">المتوسط العام</div></div><div style="background:#fef3c7;padding:14px;border-radius:8px;text-align:center"><div style="font-size:22px;font-weight:800;color:#d97706">${empData.filter(e=>e.avg>=85).length}</div><div style="color:#64748b;font-size:12px">ناجح</div></div></div><table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:#06579F;color:white"><th style="padding:8px;border:1px solid #044a87">#</th><th style="padding:8px;border:1px solid #044a87">الرقم الوظيفي</th><th style="padding:8px;border:1px solid #044a87">الموظف</th><th style="padding:8px;border:1px solid #044a87">المشرف</th><th style="padding:8px;border:1px solid #044a87">التقييمات</th><th style="padding:8px;border:1px solid #044a87">المتوسط</th><th style="padding:8px;border:1px solid #044a87">أعلى</th><th style="padding:8px;border:1px solid #044a87">أدنى</th><th style="padding:8px;border:1px solid #044a87">التقدير</th></tr></thead><tbody style="background:white">${rows.replace(/<td/g,'<td style="padding:6px;border:1px solid #cbd5e1"').replace(/style="text-align:center"/g,'style="text-align:center;padding:6px;border:1px solid #cbd5e1"').replace(/style="text-align:center;color:#059669"/g,'style="text-align:center;color:#059669;padding:6px;border:1px solid #cbd5e1"').replace(/style="text-align:center;color:#dc2626"/g,'style="text-align:center;color:#dc2626;padding:6px;border:1px solid #cbd5e1"')}</tbody></table></div>`;
await htmlToPDF(html, `تقرير_الأداء_${new Date().toISOString().slice(0,10)}.pdf`);
}

// ============================================
// Monthly Report - التقرير الشهري
// ============================================
function getMonthOptions() {
const months = new Set();
DB.data.evaluations.forEach(ev => {
const d = new Date(ev.evaluation_date);
months.add(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
});
const now = new Date();
months.add(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`);
return Array.from(months).sort().reverse();
}

function getMonthlyData(monthKey) {
const [y, m] = monthKey.split('-').map(Number);
const employees = DB.getUsers({ role:'employee' });
return employees.map(e => {
const evs = DB.data.evaluations.filter(ev => {
if (ev.employee_id !== e.id) return false;
const d = new Date(ev.evaluation_date);
return d.getFullYear() === y && d.getMonth() === m - 1;
});
const avg = evs.length ? Math.round(evs.reduce((s,x)=>s+x.percentage,0)/evs.length*10)/10 : 0;
const high = evs.length ? Math.max(...evs.map(x=>x.percentage)) : 0;
const low = evs.length ? Math.min(...evs.map(x=>x.percentage)) : 0;
return {
id: e.id,
employee_number: e.employee_number || '-',
name: e.full_name,
position: e.position || '-',
supervisor: e.supervisor_name || '-',
department: e.department || '-',
count: evs.length,
avg, high, low
};
});
}

function arabicMonthName(monthKey) {
const [y, m] = monthKey.split('-').map(Number);
const names = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
return `${names[m-1]} ${y}`;
}

// التقييم العام: متوسط نتائج جميع الموظفين المقيمين خلال الشهر
function getOverallEval(monthlyData) {
const evaluated = monthlyData.filter(d => d.count > 0);
const finalAvg = evaluated.length ? Math.round(evaluated.reduce((s,d)=>s+d.avg,0)/evaluated.length*10)/10 : 0;
const totalEvals = evaluated.reduce((s,d) => s+d.count, 0);
const distribution = { passed:0, failed:0 };
evaluated.forEach(d => {
if (d.avg >= 85) distribution.passed++;
else distribution.failed++;
});
const byDept = {};
evaluated.forEach(d => {
const dept = d.department || 'بدون قسم';
if (!byDept[dept]) byDept[dept] = { count:0, totalAvg:0 };
byDept[dept].count++;
byDept[dept].totalAvg += d.avg;
});
const deptSummary = Object.entries(byDept).map(([dept, x]) => ({
dept, count: x.count, avg: Math.round(x.totalAvg/x.count*10)/10
})).sort((a,b) => b.avg - a.avg);
return { employees: evaluated, finalAvg, totalEvals, distribution, deptSummary };
}

function renderMonthlyReport() {
const months = getMonthOptions();
const now = new Date();
const currentMonth = currentParams.month || `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
const monthOpts = months.map(m => `<option value="${m}" ${m===currentMonth?'selected':''}>${arabicMonthName(m)}</option>`).join('');

const data = getMonthlyData(currentMonth);
const withEvals = data.filter(d => d.count > 0);
const totalEvals = data.reduce((s,d) => s+d.count, 0);
const avgOverall = withEvals.length ? Math.round(withEvals.reduce((s,d)=>s+d.avg,0)/withEvals.length*10)/10 : 0;
const topEmp = withEvals.length ? [...withEvals].sort((a,b)=>b.avg-a.avg)[0] : null;
const needCount = withEvals.filter(d => d.avg < 85).length;

const rows = data.map(d => `<tr>
<td><strong>${Utils.escape(d.employee_number)}</strong></td>
<td><div style="display:flex;align-items:center;gap:10px"><div class="user-avatar">${Utils.getInitials(d.name)}</div>${Utils.escape(d.name)}</div></td>
<td>${Utils.escape(d.position)}</td>
<td>${Utils.escape(d.supervisor)}</td>
<td style="text-align:center">${d.count}</td>
<td style="text-align:center">${d.count>0?'<strong>'+d.avg+'%</strong>':'<span class="badge badge-info">لا يوجد</span>'}</td>
<td style="text-align:center;color:var(--success);font-weight:600">${d.count>0?d.high+'%':'-'}</td>
<td style="text-align:center;color:var(--danger);font-weight:600">${d.count>0?d.low+'%':'-'}</td>
<td>${d.count>0?Utils.gradeBadge(d.avg):'<span class="badge badge-info">لم يقيّم</span>'}</td>
</tr>`).join('');

return `
<div class="page-header">
<div><div class="page-title">📅 التقرير الشهري</div><div class="page-subtitle">عرض النتائج النهائية للموظفين خلال الشهر</div></div>
<div style="display:flex;gap:8px">
<button class="btn btn-success" id="mr-export-xlsx">📊 تصدير Excel</button>
<button class="btn btn-danger" id="mr-export-pdf">📄 تصدير PDF</button>
</div>
</div>

<div class="card" style="margin-bottom:20px">
<div style="padding:16px;background:#f8fafc;border-bottom:1px solid var(--border)">
<div class="grid grid-2" style="gap:14px;align-items:end">
<div class="form-group" style="margin:0">
<label class="form-label">اختر الشهر</label>
<select class="form-control" id="mr-month">${monthOpts}</select>
</div>
<div style="font-size:14px;color:var(--muted);background:white;padding:10px 14px;border-radius:8px;border:1px solid var(--border)">
الشهر المعروض: <strong style="color:var(--primary)">${arabicMonthName(currentMonth)}</strong>
</div>
</div>
</div>
</div>

<div class="stats-grid">
<div class="stat-card" style="background:linear-gradient(135deg,#06579F,#2378c4);color:white"><div class="stat-icon" style="background:rgba(255,255,255,0.25)">👥</div><div class="stat-value" style="color:white">${data.length}</div><div class="stat-label" style="color:rgba(255,255,255,0.9)">إجمالي الموظفين</div></div>
<div class="stat-card" style="background:linear-gradient(135deg,#06b6d4,#0891b2);color:white"><div class="stat-icon" style="background:rgba(255,255,255,0.25)">📋</div><div class="stat-value" style="color:white">${totalEvals}</div><div class="stat-label" style="color:rgba(255,255,255,0.9)">تقييمات هذا الشهر</div></div>
<div class="stat-card" style="background:linear-gradient(135deg,#10b981,#059669);color:white"><div class="stat-icon" style="background:rgba(255,255,255,0.25)">⭐</div><div class="stat-value" style="color:white">${avgOverall}%</div><div class="stat-label" style="color:rgba(255,255,255,0.9)">متوسط الأداء</div></div>
<div class="stat-card" style="background:linear-gradient(135deg,#f59e0b,#d97706);color:white"><div class="stat-icon" style="background:rgba(255,255,255,0.25)">🏆</div><div class="stat-value" style="color:white;font-size:14px;line-height:1.2">${topEmp?Utils.escape(topEmp.name):'-'}</div><div class="stat-label" style="color:rgba(255,255,255,0.9)">أفضل أداء${topEmp?' ('+topEmp.avg+'%)':''}</div></div>
<div class="stat-card" style="background:linear-gradient(135deg,#ef4444,#dc2626);color:white"><div class="stat-icon" style="background:rgba(255,255,255,0.25)">⚠️</div><div class="stat-value" style="color:white">${needCount}</div><div class="stat-label" style="color:rgba(255,255,255,0.9)">يحتاجون متابعة</div></div>
</div>

${(()=>{
const oe = getOverallEval(data);
if (!oe.employees.length) return '';
const gc = oe.finalAvg>=85?'#10b981':'#ef4444';
const gl = oe.finalAvg>=85?'ناجح':'راسب';
return `
<div style="background:linear-gradient(135deg,#1B202C 0%,#202E4D 50%,#06579F 100%);color:white;margin-bottom:20px;display:flex;align-items:center;padding:22px 28px;gap:22px;border-radius:14px;box-shadow:0 8px 25px rgba(27,32,44,0.3);flex-wrap:wrap">
<div style="font-size:54px">📊</div>
<div style="flex:1;min-width:200px">
<div style="font-size:13px;opacity:0.95;font-weight:600">مؤشر رئيسي لملخص التقرير الشهري للإدارة</div>
<div style="font-size:22px;font-weight:800;color:white;margin:4px 0">التقييم النهائي العام للموظفين</div>
<div style="font-size:13px;opacity:0.9">متوسط نتائج <strong>${oe.employees.length}</strong> موظف مقيم خلال ${arabicMonthName(currentMonth)} • <strong>${oe.totalEvals}</strong> تقييم</div>
</div>
<div style="text-align:center;background:rgba(255,255,255,0.18);padding:18px 30px;border-radius:14px;border:2px solid rgba(255,255,255,0.25)">
<div style="font-size:46px;font-weight:800;color:white;line-height:1">${oe.finalAvg}%</div>
<div style="font-size:12px;color:rgba(255,255,255,0.95);margin-top:6px;font-weight:700">${gl}</div>
</div>
</div>

<div class="card" style="margin-bottom:20px;border:2px solid #1B202C;background:linear-gradient(to bottom,#f8fafc,white)">
<div class="card-header" style="background:linear-gradient(135deg,#1B202C,#06579F);color:white">
<div class="card-title" style="color:white">📊 التقييم العام للموظفين</div>
</div>
<div class="card-body" style="padding:14px 18px;background:#f1f5f9;border-bottom:1px solid var(--border);font-size:13px">
✓ ${oe.distribution.passed} ناجح • ✗ ${oe.distribution.failed} راسب
${oe.deptSummary.length>1?`<div style="margin-top:10px"><strong>حسب القسم:</strong> ${oe.deptSummary.map(d => `${d.dept}: ${d.avg}% (${d.count})`).join(' • ')}</div>`:''}
</div>
<div style="overflow-x:auto">
<table class="table" style="margin:0">
<thead style="background:#f8fafc"><tr><th style="text-align:center">#</th><th>الرقم</th><th>الموظف</th><th>القسم</th><th>المشرف</th><th style="text-align:center">التقييمات</th><th style="text-align:center">المتوسط</th><th>التقدير</th></tr></thead>
<tbody>${oe.employees.map((e,i)=>`<tr>
<td style="text-align:center"><strong>${i+1}</strong></td>
<td><strong>${Utils.escape(e.employee_number)}</strong></td>
<td>${Utils.escape(e.name)}</td>
<td>${Utils.escape(e.department||'-')}</td>
<td>${Utils.escape(e.supervisor)}</td>
<td style="text-align:center">${e.count}</td>
<td style="text-align:center"><strong style="color:${e.avg>=85?'#059669':'#dc2626'}">${e.avg}%</strong></td>
<td>${Utils.gradeBadge(e.avg)}</td>
</tr>`).join('')}</tbody>
<tfoot style="background:linear-gradient(to left,#e0e7ff,#f1f5f9);border-top:2px solid #1B202C">
<tr>
<td colspan="6" style="text-align:left;padding:14px 18px;font-weight:800;color:#1B202C">📊 التقييم النهائي العام (متوسط جميع الموظفين)</td>
<td style="text-align:center"><strong style="font-size:18px;color:${gc}">${oe.finalAvg}%</strong></td>
<td>${Utils.gradeBadge(oe.finalAvg)}</td>
</tr>
</tfoot>
</table>
</div>
</div>`;
})()}

<div class="card">
<div style="padding:16px;background:#f8fafc;border-bottom:1px solid var(--border)">
<div class="grid grid-3" style="gap:12px">
<input type="text" class="form-control mr-filter" id="mr-search-name" placeholder="🔍 ابحث باسم الموظف...">
<input type="text" class="form-control mr-filter" id="mr-search-num" placeholder="🔢 ابحث بالرقم الوظيفي...">
<input type="text" class="form-control mr-filter" id="mr-search-sup" placeholder="👤 ابحث باسم المشرف...">
</div>
</div>
<div style="overflow-x:auto">
<table class="table" id="mr-table">
<thead><tr><th>الرقم الوظيفي</th><th>الموظف</th><th>المسمى</th><th>المشرف</th><th style="text-align:center">عدد التقييمات</th><th style="text-align:center">المتوسط الشهري</th><th style="text-align:center">أعلى</th><th style="text-align:center">أدنى</th><th>التقدير</th></tr></thead>
<tbody>${rows || '<tr><td colspan="9" style="text-align:center;padding:20px">لا يوجد موظفون</td></tr>'}</tbody>
</table>
</div>
</div>`;
}

function renderMonthlyReportCharts() { /* placeholder */ }

function exportMonthlyReportXLSX() {
const now = new Date();
const monthKey = currentParams.month || `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
const data = getMonthlyData(monthKey);
const rows = data.map(d => ({
'الرقم الوظيفي': d.employee_number,
'اسم الموظف': d.name,
'المسمى الوظيفي': d.position,
'اسم المشرف': d.supervisor,
'عدد التقييمات': d.count,
'المتوسط الشهري %': d.count?d.avg:'-',
'أعلى نتيجة %': d.count?d.high:'-',
'أدنى نتيجة %': d.count?d.low:'-',
'التقدير': d.count?(d.avg>=85?'ناجح':'راسب'):'لم يقيّم'
}));
const ws = XLSX.utils.json_to_sheet(rows);
ws['!cols'] = [{wch:15},{wch:25},{wch:20},{wch:20},{wch:14},{wch:14},{wch:12},{wch:12},{wch:14}];
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, arabicMonthName(monthKey));
XLSX.writeFile(wb, `التقرير_الشهري_${monthKey}.xlsx`);
Toast.success('تم تصدير ملف Excel');
}

async function exportMonthlyReportPDF() {
const now = new Date();
const monthKey = currentParams.month || `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
const data = getMonthlyData(monthKey);
const withEvals = data.filter(d => d.count>0);
const avg = withEvals.length ? Math.round(withEvals.reduce((s,d)=>s+d.avg,0)/withEvals.length*10)/10 : 0;
const totalEvals = data.reduce((s,d) => s+d.count, 0);

const trows = data.map(d => `<tr><td style="padding:6px;border:1px solid #cbd5e1;text-align:center">${Utils.escape(d.employee_number)}</td><td style="padding:6px;border:1px solid #cbd5e1">${Utils.escape(d.name)}</td><td style="padding:6px;border:1px solid #cbd5e1">${Utils.escape(d.position)}</td><td style="padding:6px;border:1px solid #cbd5e1">${Utils.escape(d.supervisor)}</td><td style="padding:6px;border:1px solid #cbd5e1;text-align:center">${d.count}</td><td style="padding:6px;border:1px solid #cbd5e1;text-align:center"><strong>${d.count?d.avg+'%':'-'}</strong></td><td style="padding:6px;border:1px solid #cbd5e1;text-align:center;color:#059669">${d.count?d.high+'%':'-'}</td><td style="padding:6px;border:1px solid #cbd5e1;text-align:center;color:#dc2626">${d.count?d.low+'%':'-'}</td><td style="padding:6px;border:1px solid #cbd5e1">${d.count?(d.avg>=85?'ناجح':'راسب'):'لم يقيّم'}</td></tr>`).join('');

const html = `<div style="padding:30px;font-family:'Cairo',sans-serif;direction:rtl;background:white">${buildPDFHeader('التقرير الشهري للأداء', arabicMonthName(monthKey), '#06579F')}<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px"><div style="background:#dbeafe;padding:14px;border-radius:8px;text-align:center"><div style="font-size:22px;font-weight:800;color:#06579F">${data.length}</div><div style="color:#64748b;font-size:12px">إجمالي الموظفين</div></div><div style="background:#cffafe;padding:14px;border-radius:8px;text-align:center"><div style="font-size:22px;font-weight:800;color:#0891b2">${totalEvals}</div><div style="color:#64748b;font-size:12px">تقييمات الشهر</div></div><div style="background:#d1fae5;padding:14px;border-radius:8px;text-align:center"><div style="font-size:22px;font-weight:800;color:#059669">${avg}%</div><div style="color:#64748b;font-size:12px">المتوسط العام</div></div></div><table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr style="background:#06579F;color:white"><th style="padding:8px;border:1px solid #044a87">الرقم الوظيفي</th><th style="padding:8px;border:1px solid #044a87">الموظف</th><th style="padding:8px;border:1px solid #044a87">المسمى</th><th style="padding:8px;border:1px solid #044a87">المشرف</th><th style="padding:8px;border:1px solid #044a87">التقييمات</th><th style="padding:8px;border:1px solid #044a87">المتوسط</th><th style="padding:8px;border:1px solid #044a87">أعلى</th><th style="padding:8px;border:1px solid #044a87">أدنى</th><th style="padding:8px;border:1px solid #044a87">التقدير</th></tr></thead><tbody style="background:white">${trows}</tbody></table></div>`;
await htmlToPDF(html, `التقرير_الشهري_${monthKey}.pdf`);
}

// ============================================
// Actions Report - تقرير الإجراءات المتخذة
// ============================================
function getActionsReportData() {
const evals = DB.data.evaluations;
const employees = DB.getUsers({ role:'employee' });

// 1. عدد الملاحظات لكل موظف (يتم استثناء "لا يوجد ملاحظات")
const perEmployee = employees.map(e => {
const ev = evals.filter(x => x.employee_id === e.id && (x.observed_issue || x.call_type) && !isPositiveObservation(x));
const obsTypes = {};
const acts = {};
ev.forEach(x => {
const key = x.observed_issue === 'أخرى' ? (x.observed_issue_other || 'أخرى') : (x.observed_issue || x.call_type || '-');
obsTypes[key] = (obsTypes[key]||0)+1;
const a = x.action_taken === 'أخرى' ? (x.action_taken_other || 'أخرى') : (x.action_taken || 'لم يحدد');
acts[a] = (acts[a]||0)+1;
});
return {
id: e.id,
employee_number: e.employee_number || '-',
name: e.full_name,
supervisor: e.supervisor_name || '-',
position: e.position || '-',
total: ev.length,
top_obs: Object.entries(obsTypes).sort((a,b)=>b[1]-a[1])[0],
top_act: Object.entries(acts).sort((a,b)=>b[1]-a[1])[0]
};
}).filter(r => r.total > 0).sort((a,b) => b.total - a.total);

// 2. أكثر الملاحظات تكراراً (يتم استثناء "لا يوجد ملاحظات")
const obsCounts = {};
evals.forEach(e => {
if (isPositiveObservation(e)) return;
const k = e.observed_issue === 'أخرى' ? (e.observed_issue_other || 'أخرى') : (e.observed_issue || e.call_type);
if (k) obsCounts[k] = (obsCounts[k]||0)+1;
});
const topObservations = Object.entries(obsCounts).sort((a,b)=>b[1]-a[1]);

// 3. الإجراءات حسب نوع الملاحظة
const actionsByObs = {};
evals.forEach(e => {
if (isPositiveObservation(e)) return;
const k = e.observed_issue === 'أخرى' ? (e.observed_issue_other || 'أخرى') : (e.observed_issue || e.call_type);
const a = e.action_taken === 'أخرى' ? (e.action_taken_other || 'أخرى') : (e.action_taken || 'لم يحدد');
if (!k || !a) return;
if (!actionsByObs[k]) actionsByObs[k] = {};
actionsByObs[k][a] = (actionsByObs[k][a]||0)+1;
});

// 4. نسبة التحسن بعد الإجراء (لكل موظف اتخذ بحقه إجراء)
const improvements = [];
employees.forEach(e => {
const sorted = evals.filter(x => x.employee_id === e.id).sort((a,b)=>new Date(a.evaluation_date)-new Date(b.evaluation_date));
for (let i = 0; i < sorted.length - 1; i++) {
const before = sorted[i];
const after = sorted[i+1];
if (before.action_taken && before.action_taken !== 'لا يوجد إجراء') {
const change = after.percentage - before.percentage;
improvements.push({
employee_id: e.id,
employee_name: e.full_name,
action: before.action_taken === 'أخرى' ? (before.action_taken_other || 'أخرى') : before.action_taken,
before_pct: before.percentage,
after_pct: after.percentage,
change,
before_date: before.evaluation_date,
after_date: after.evaluation_date
});
}
}
});

// تجميع التحسن حسب نوع الإجراء
const improvementByAction = {};
improvements.forEach(im => {
if (!improvementByAction[im.action]) improvementByAction[im.action] = { count:0, totalChange:0, improved:0, worsened:0 };
improvementByAction[im.action].count++;
improvementByAction[im.action].totalChange += im.change;
if (im.change > 0) improvementByAction[im.action].improved++;
else if (im.change < 0) improvementByAction[im.action].worsened++;
});
Object.keys(improvementByAction).forEach(a => {
const x = improvementByAction[a];
x.avgChange = Math.round((x.totalChange/x.count)*10)/10;
x.improvementRate = Math.round((x.improved/x.count)*100);
});

return { perEmployee, topObservations, actionsByObs, improvements, improvementByAction };
}

function renderActionsReport() {
const data = getActionsReportData();

// Employee rows
const empRows = data.perEmployee.map(e => `<tr>
<td><strong>${Utils.escape(e.employee_number)}</strong></td>
<td><div style="display:flex;align-items:center;gap:8px"><div class="user-avatar">${Utils.getInitials(e.name)}</div>${Utils.escape(e.name)}</div></td>
<td>${Utils.escape(e.supervisor)}</td>
<td style="text-align:center"><strong>${e.total}</strong></td>
<td>${e.top_obs ? Utils.escape(e.top_obs[0]) + ' <span class="badge badge-info">'+e.top_obs[1]+'</span>' : '-'}</td>
<td>${e.top_act ? Utils.escape(e.top_act[0]) + ' <span class="badge badge-warning">'+e.top_act[1]+'</span>' : '-'}</td>
</tr>`).join('');

// Top observations rows
const obsRows = data.topObservations.map(([obs, count], i) => {
const actions = data.actionsByObs[obs] || {};
const actionsHTML = Object.entries(actions).sort((a,b)=>b[1]-a[1]).map(([a, n]) => `<span class="badge badge-warning" style="margin:2px">${Utils.escape(a)}: ${n}</span>`).join('');
return `<tr>
<td><div style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:${i===0?'#fbbf24':i===1?'#94a3b8':i===2?'#cd7f32':'#e2e8f0'};color:white;font-weight:700">${i+1}</div></td>
<td><strong>${Utils.escape(obs)}</strong></td>
<td style="text-align:center"><span class="badge badge-info" style="font-size:14px;padding:6px 12px">${count}</span></td>
<td>${actionsHTML || '-'}</td>
</tr>`;
}).join('');

// Improvement table
const impRows = Object.entries(data.improvementByAction).sort((a,b)=>b[1].improvementRate-a[1].improvementRate).map(([action, m]) => `<tr>
<td><strong>${Utils.escape(action)}</strong></td>
<td style="text-align:center">${m.count}</td>
<td style="text-align:center;color:var(--success);font-weight:700">${m.improved}</td>
<td style="text-align:center;color:var(--danger);font-weight:700">${m.worsened}</td>
<td style="text-align:center"><strong style="color:${m.avgChange>=0?'var(--success)':'var(--danger)'}">${m.avgChange>=0?'+':''}${m.avgChange}%</strong></td>
<td style="text-align:center">
<div style="display:flex;align-items:center;gap:8px;justify-content:center">
<div style="width:80px;background:#e2e8f0;border-radius:4px;height:8px;overflow:hidden">
<div style="width:${m.improvementRate}%;height:100%;background:${m.improvementRate>=70?'var(--success)':m.improvementRate>=40?'var(--warning)':'var(--danger)'}"></div>
</div>
<strong>${m.improvementRate}%</strong>
</div>
</td>
</tr>`).join('');

const totalEvals = DB.data.evaluations.length;
const totalWithAction = DB.data.evaluations.filter(e => e.action_taken).length;
const totalObs = data.topObservations.reduce((s,[,n]) => s+n, 0);
const improved = data.improvements.filter(im => im.change > 0).length;
const overallImpRate = data.improvements.length ? Math.round((improved/data.improvements.length)*100) : 0;

return `
<div class="page-header">
<div><div class="page-title">⚖️ تقرير الإجراءات المتخذة</div><div class="page-subtitle">تحليل الملاحظات المرصودة والإجراءات ونسبة التحسن</div></div>
<div style="display:flex;gap:8px">
<button class="btn btn-success" id="ar-export-xlsx">📊 تصدير Excel</button>
<button class="btn btn-danger" id="ar-export-pdf">📄 تصدير PDF</button>
</div>
</div>

<div class="stats-grid">
<div class="stat-card" style="background:linear-gradient(135deg,#06579F,#2378c4);color:white"><div class="stat-icon" style="background:rgba(255,255,255,0.25)">📋</div><div class="stat-value" style="color:white">${totalEvals}</div><div class="stat-label" style="color:rgba(255,255,255,0.9)">إجمالي التقييمات</div></div>
<div class="stat-card" style="background:linear-gradient(135deg,#06b6d4,#0891b2);color:white"><div class="stat-icon" style="background:rgba(255,255,255,0.25)">🔍</div><div class="stat-value" style="color:white">${totalObs}</div><div class="stat-label" style="color:rgba(255,255,255,0.9)">ملاحظات مرصودة</div></div>
<div class="stat-card" style="background:linear-gradient(135deg,#f59e0b,#d97706);color:white"><div class="stat-icon" style="background:rgba(255,255,255,0.25)">⚖️</div><div class="stat-value" style="color:white">${totalWithAction}</div><div class="stat-label" style="color:rgba(255,255,255,0.9)">إجراءات متخذة</div></div>
<div class="stat-card" style="background:linear-gradient(135deg,#10b981,#059669);color:white"><div class="stat-icon" style="background:rgba(255,255,255,0.25)">📈</div><div class="stat-value" style="color:white">${overallImpRate}%</div><div class="stat-label" style="color:rgba(255,255,255,0.9)">نسبة التحسن العامة</div></div>
</div>

<div class="grid grid-2">
<div class="card">
<div class="card-header"><div class="card-title">📊 أنواع الملاحظات الأكثر تكراراً</div></div>
<div class="card-body"><div class="chart-container" style="height:340px"><canvas id="ar-obs-chart"></canvas></div></div>
</div>
<div class="card">
<div class="card-header"><div class="card-title">⚖️ توزيع الإجراءات المتخذة</div></div>
<div class="card-body"><div class="chart-container" style="height:340px"><canvas id="ar-act-chart"></canvas></div></div>
</div>
</div>

<div class="card" style="margin-top:20px">
<div class="card-header"><div class="card-title">🔝 الملاحظات الأكثر تكراراً والإجراءات المرتبطة بها</div></div>
<div style="overflow-x:auto">
<table class="table">
<thead><tr><th>الترتيب</th><th>الملاحظة المرصودة</th><th style="text-align:center">عدد التكرار</th><th>الإجراءات المتخذة</th></tr></thead>
<tbody>${obsRows || '<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--muted)">لا توجد بيانات</td></tr>'}</tbody>
</table>
</div>
</div>

<div class="card" style="margin-top:20px">
<div class="card-header"><div class="card-title">📈 نسبة التحسن بعد الإجراءات</div></div>
<div style="padding:14px;background:#f8fafc;font-size:13px;color:var(--muted)">
يقارن هذا الجدول النتيجة قبل اتخاذ الإجراء بالنتيجة في التقييم التالي للموظف نفسه.
</div>
<div style="overflow-x:auto">
<table class="table">
<thead><tr><th>الإجراء</th><th style="text-align:center">عدد الحالات</th><th style="text-align:center">تحسن</th><th style="text-align:center">تراجع</th><th style="text-align:center">متوسط التغير</th><th style="text-align:center">نسبة التحسن</th></tr></thead>
<tbody>${impRows || '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--muted)">لا توجد بيانات كافية لقياس التحسن</td></tr>'}</tbody>
</table>
</div>
</div>

<div class="card" style="margin-top:20px">
<div class="card-header"><div class="card-title">👥 الملاحظات والإجراءات حسب الموظف</div></div>
<div style="padding:14px;background:#f8fafc;border-bottom:1px solid var(--border)">
<input type="text" class="form-control" id="ar-search" placeholder="🔍 ابحث عن موظف...">
</div>
<div style="overflow-x:auto">
<table class="table" id="ar-table">
<thead><tr><th>الرقم الوظيفي</th><th>الموظف</th><th>المشرف</th><th style="text-align:center">إجمالي الملاحظات</th><th>أكثر ملاحظة</th><th>أكثر إجراء</th></tr></thead>
<tbody>${empRows || '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--muted)">لا توجد بيانات</td></tr>'}</tbody>
</table>
</div>
</div>`;
}

function renderActionsReportCharts() {
const data = getActionsReportData();
const obsLabels = data.topObservations.slice(0,6).map(([k]) => k);
const obsCounts = data.topObservations.slice(0,6).map(([,n]) => n);

const c1 = document.getElementById('ar-obs-chart');
if (c1) charts.push(new Chart(c1, {
type:'bar',
data:{ labels: obsLabels, datasets:[{ label:'عدد الملاحظات', data: obsCounts, backgroundColor:['#ef4444','#f59e0b','#06b6d4','#3b82f6','#7c3aed','#10b981'], borderRadius:6 }] },
options:{ indexAxis:'y', responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{x:{beginAtZero:true}} }
}));

const actsCount = {};
DB.data.evaluations.forEach(e => {
const a = e.action_taken === 'أخرى' ? (e.action_taken_other||'أخرى') : e.action_taken;
if (a) actsCount[a] = (actsCount[a]||0)+1;
});
const actLabels = Object.keys(actsCount);
const actData = Object.values(actsCount);
const c2 = document.getElementById('ar-act-chart');
if (c2) charts.push(new Chart(c2, {
type:'doughnut',
data:{ labels: actLabels, datasets:[{ data: actData, backgroundColor:['#f59e0b','#ef4444','#7c3aed','#06b6d4','#94a3b8','#10b981'] }] },
options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'bottom'}} }
}));
}

function exportActionsReportXLSX() {
const data = getActionsReportData();
const wb = XLSX.utils.book_new();

// Sheet 1: Per employee
const empData = data.perEmployee.map(e => ({
'الرقم الوظيفي': e.employee_number, 'الاسم': e.name, 'المسمى': e.position, 'المشرف': e.supervisor,
'عدد الملاحظات': e.total,
'أكثر ملاحظة': e.top_obs ? e.top_obs[0]+' ('+e.top_obs[1]+')' : '-',
'أكثر إجراء': e.top_act ? e.top_act[0]+' ('+e.top_act[1]+')' : '-'
}));
const ws1 = XLSX.utils.json_to_sheet(empData);
ws1['!cols'] = [{wch:15},{wch:25},{wch:20},{wch:20},{wch:14},{wch:35},{wch:35}];
XLSX.utils.book_append_sheet(wb, ws1, 'ملاحظات وإجراءات حسب الموظف');

// Sheet 2: Top observations
const obsData = data.topObservations.map(([obs, count], i) => ({
'الترتيب': i+1, 'الملاحظة المرصودة': obs, 'عدد التكرار': count,
'الإجراءات المرتبطة': Object.entries(data.actionsByObs[obs]||{}).map(([a,n]) => `${a}:${n}`).join(' | ')
}));
const ws2 = XLSX.utils.json_to_sheet(obsData);
ws2['!cols'] = [{wch:10},{wch:35},{wch:14},{wch:50}];
XLSX.utils.book_append_sheet(wb, ws2, 'الملاحظات الأكثر تكراراً');

// Sheet 3: Improvement by action
const impData = Object.entries(data.improvementByAction).map(([action, m]) => ({
'الإجراء': action, 'عدد الحالات': m.count, 'تحسن': m.improved, 'تراجع': m.worsened,
'متوسط التغير %': m.avgChange, 'نسبة التحسن %': m.improvementRate
}));
const ws3 = XLSX.utils.json_to_sheet(impData);
ws3['!cols'] = [{wch:20},{wch:14},{wch:10},{wch:10},{wch:14},{wch:14}];
XLSX.utils.book_append_sheet(wb, ws3, 'نسبة التحسن');

XLSX.writeFile(wb, `تقرير_الإجراءات_${new Date().toISOString().slice(0,10)}.xlsx`);
Toast.success('تم تصدير التقرير');
}

async function exportActionsReportPDF() {
const data = getActionsReportData();
const totalEvals = DB.data.evaluations.length;
const totalObs = data.topObservations.reduce((s,[,n]) => s+n, 0);
const improved = data.improvements.filter(im => im.change > 0).length;
const overallImpRate = data.improvements.length ? Math.round((improved/data.improvements.length)*100) : 0;

const obsRows = data.topObservations.map(([obs, count], i) => `<tr><td style="padding:6px;border:1px solid #cbd5e1;text-align:center">${i+1}</td><td style="padding:6px;border:1px solid #cbd5e1">${Utils.escape(obs)}</td><td style="padding:6px;border:1px solid #cbd5e1;text-align:center"><strong>${count}</strong></td><td style="padding:6px;border:1px solid #cbd5e1">${Object.entries(data.actionsByObs[obs]||{}).map(([a,n])=>`${a}: ${n}`).join('، ')}</td></tr>`).join('');

const impRows = Object.entries(data.improvementByAction).map(([action, m]) => `<tr><td style="padding:6px;border:1px solid #cbd5e1">${Utils.escape(action)}</td><td style="padding:6px;border:1px solid #cbd5e1;text-align:center">${m.count}</td><td style="padding:6px;border:1px solid #cbd5e1;text-align:center;color:#059669">${m.improved}</td><td style="padding:6px;border:1px solid #cbd5e1;text-align:center;color:#dc2626">${m.worsened}</td><td style="padding:6px;border:1px solid #cbd5e1;text-align:center"><strong style="color:${m.avgChange>=0?'#059669':'#dc2626'}">${m.avgChange>=0?'+':''}${m.avgChange}%</strong></td><td style="padding:6px;border:1px solid #cbd5e1;text-align:center"><strong>${m.improvementRate}%</strong></td></tr>`).join('');

const html = `<div style="padding:30px;font-family:'Cairo',sans-serif;direction:rtl;background:white">
${buildPDFHeader('⚖️ تقرير الإجراءات المتخذة', 'تحليل الإجراءات التصحيحية ونسبة التحسن', '#06579F')}
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:18px">
<div style="background:#dbeafe;padding:12px;border-radius:8px;text-align:center"><div style="font-size:20px;font-weight:800;color:#06579F">${totalEvals}</div><div style="color:#64748b;font-size:11px">إجمالي التقييمات</div></div>
<div style="background:#cffafe;padding:12px;border-radius:8px;text-align:center"><div style="font-size:20px;font-weight:800;color:#0891b2">${totalObs}</div><div style="color:#64748b;font-size:11px">ملاحظات مرصودة</div></div>
<div style="background:#fef3c7;padding:12px;border-radius:8px;text-align:center"><div style="font-size:20px;font-weight:800;color:#d97706">${DB.data.evaluations.filter(e => e.action_taken).length}</div><div style="color:#64748b;font-size:11px">إجراءات متخذة</div></div>
<div style="background:#d1fae5;padding:12px;border-radius:8px;text-align:center"><div style="font-size:20px;font-weight:800;color:#059669">${overallImpRate}%</div><div style="color:#64748b;font-size:11px">نسبة التحسن</div></div>
</div>

<h2 style="font-size:16px;color:#06579F;margin:14px 0 8px">🔝 الملاحظات الأكثر تكراراً</h2>
<table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:18px">
<thead><tr style="background:#06579F;color:white"><th style="padding:8px;border:1px solid #044a87">#</th><th style="padding:8px;border:1px solid #044a87">الملاحظة</th><th style="padding:8px;border:1px solid #044a87">التكرار</th><th style="padding:8px;border:1px solid #044a87">الإجراءات</th></tr></thead>
<tbody>${obsRows || '<tr><td colspan="4" style="padding:14px;text-align:center;color:#94a3b8">لا توجد بيانات</td></tr>'}</tbody>
</table>

<h2 style="font-size:16px;color:#06579F;margin:14px 0 8px">📈 نسبة التحسن حسب نوع الإجراء</h2>
<table style="width:100%;border-collapse:collapse;font-size:11px">
<thead><tr style="background:#06579F;color:white"><th style="padding:8px;border:1px solid #044a87">الإجراء</th><th style="padding:8px;border:1px solid #044a87">الحالات</th><th style="padding:8px;border:1px solid #044a87">تحسن</th><th style="padding:8px;border:1px solid #044a87">تراجع</th><th style="padding:8px;border:1px solid #044a87">متوسط التغير</th><th style="padding:8px;border:1px solid #044a87">نسبة التحسن</th></tr></thead>
<tbody>${impRows || '<tr><td colspan="6" style="padding:14px;text-align:center;color:#94a3b8">لا توجد بيانات كافية</td></tr>'}</tbody>
</table>
</div>`;
await htmlToPDF(html, `تقرير_الإجراءات_${new Date().toISOString().slice(0,10)}.pdf`);
}

// ============================================
// Monthly Recurring Errors Report - الأخطاء المتكررة الشهرية
// ============================================
function getErrorsReportData(monthKey, filters={}) {
const [y, m] = monthKey.split('-').map(Number);
let evals = DB.data.evaluations.filter(ev => {
const d = new Date(ev.evaluation_date);
return d.getFullYear() === y && d.getMonth() === m - 1;
});

if (filters.department || filters.supervisor) {
const emps = DB.getUsers({ role:'employee' });
evals = evals.filter(ev => {
const e = emps.find(x => x.id === ev.employee_id);
if (!e) return false;
if (filters.department && e.department !== filters.department) return false;
if (filters.supervisor && e.supervisor_name !== filters.supervisor) return false;
return true;
});
}

const obsCounts = {};
let positiveCount = 0;
evals.forEach(ev => {
if (isPositiveObservation(ev)) { positiveCount++; return; }
const k = ev.observed_issue === 'أخرى' ? (ev.observed_issue_other || 'أخرى') : (ev.observed_issue || ev.call_type);
if (k) obsCounts[k] = (obsCounts[k]||0)+1;
});
const total = Object.values(obsCounts).reduce((a,b)=>a+b, 0);
const sorted = Object.entries(obsCounts).sort((a,b)=>b[1]-a[1]);
return { evals, obsCounts, total, sorted, positiveCount };
}

function renderErrorsReport() {
const months = getMonthOptions();
const now = new Date();
const currentMonth = currentParams.month || `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
const filterDept = currentParams.dept || '';
const filterSup = currentParams.sup || '';

const monthOpts = months.map(m => `<option value="${m}" ${m===currentMonth?'selected':''}>${arabicMonthName(m)}</option>`).join('');

const deptSet = new Set();
DB.getUsers({role:'employee'}).forEach(u => { if (u.department) deptSet.add(u.department); });
const deptOpts = Array.from(deptSet).map(d => `<option value="${d}" ${d===filterDept?'selected':''}>${d}</option>`).join('');

const supSet = new Set();
DB.getUsers({role:'employee'}).forEach(u => { if (u.supervisor_name && u.supervisor_name !== '-') supSet.add(u.supervisor_name); });
const supOpts = Array.from(supSet).map(s => `<option value="${s}" ${s===filterSup?'selected':''}>${s}</option>`).join('');

const data = getErrorsReportData(currentMonth, { department: filterDept, supervisor: filterSup });

// Compare with previous month
const prev = new Date(parseInt(currentMonth.split('-')[0]), parseInt(currentMonth.split('-')[1])-2, 1);
const prevKey = `${prev.getFullYear()}-${String(prev.getMonth()+1).padStart(2,'0')}`;
const prevData = getErrorsReportData(prevKey, { department: filterDept, supervisor: filterSup });

const rows = data.sorted.map(([obs, count], i) => {
const pct = data.total ? Math.round((count/data.total)*100*10)/10 : 0;
const prevCount = prevData.obsCounts[obs] || 0;
const diff = count - prevCount;
const diffHTML = prevCount > 0 ?
(diff > 0 ? `<span style="color:var(--danger)">▲ +${diff}</span>` :
diff < 0 ? `<span style="color:var(--success)">▼ ${diff}</span>` :
`<span style="color:var(--muted)">— ثابت</span>`)
: '<span style="color:var(--info)">جديد</span>';
return `<tr>
<td><div style="display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;background:${i<3?(i===0?'#ef4444':i===1?'#f59e0b':'#06b6d4'):'#e2e8f0'};color:white;font-weight:700">${i+1}</div></td>
<td><strong>${Utils.escape(obs)}</strong></td>
<td style="text-align:center"><span class="badge badge-info" style="font-size:14px;padding:6px 12px">${count}</span></td>
<td style="text-align:center"><strong>${pct}%</strong></td>
<td style="text-align:center">
<div style="display:flex;align-items:center;gap:8px;justify-content:center">
<div style="width:120px;background:#e2e8f0;border-radius:4px;height:10px;overflow:hidden">
<div style="width:${pct}%;height:100%;background:linear-gradient(to left,#ef4444,#f59e0b)"></div>
</div>
</div>
</td>
<td style="text-align:center">${diffHTML} <small style="color:var(--muted)">(الشهر السابق: ${prevCount})</small></td>
</tr>`;
}).join('');

const totalEmps = DB.getUsers({role:'employee'}).filter(e => {
if (filterDept && e.department !== filterDept) return false;
if (filterSup && e.supervisor_name !== filterSup) return false;
return true;
}).length;

return `
<div class="page-header">
<div><div class="page-title">❌ تقرير الأخطاء المتكررة - ${arabicMonthName(currentMonth)}</div><div class="page-subtitle">أكثر الملاحظات المرصودة تكراراً خلال الشهر</div></div>
<div style="display:flex;gap:8px">
<button class="btn btn-success" id="er-export-xlsx">📊 تصدير Excel</button>
<button class="btn btn-danger" id="er-export-pdf">📄 تصدير PDF</button>
</div>
</div>

<div class="card" style="margin-bottom:20px">
<div style="padding:16px;background:#f8fafc;border-bottom:1px solid var(--border)">
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px">
<div class="form-group" style="margin:0">
<label class="form-label" style="font-size:12px">الشهر</label>
<select class="form-control er-filter" id="er-month">${monthOpts}</select>
</div>
<div class="form-group" style="margin:0">
<label class="form-label" style="font-size:12px">الإدارة/القسم</label>
<select class="form-control er-filter" id="er-dept"><option value="">الكل</option>${deptOpts}</select>
</div>
<div class="form-group" style="margin:0">
<label class="form-label" style="font-size:12px">المشرف</label>
<select class="form-control er-filter" id="er-sup"><option value="">الكل</option>${supOpts}</select>
</div>
<button class="btn btn-secondary" id="er-clear" style="height:42px;margin-top:20px">🔄 إعادة تعيين</button>
</div>
</div>
</div>

<div class="stats-grid">
<div class="stat-card" style="background:linear-gradient(135deg,#ef4444,#dc2626);color:white"><div class="stat-icon" style="background:rgba(255,255,255,0.25)">❌</div><div class="stat-value" style="color:white">${data.total}</div><div class="stat-label" style="color:rgba(255,255,255,0.9)">إجمالي الأخطاء</div></div>
<div class="stat-card" style="background:linear-gradient(135deg,#10b981,#059669);color:white"><div class="stat-icon" style="background:rgba(255,255,255,0.25)">✅</div><div class="stat-value" style="color:white">${data.positiveCount||0}</div><div class="stat-label" style="color:rgba(255,255,255,0.9)">تقييمات إيجابية</div></div>
<div class="stat-card" style="background:linear-gradient(135deg,#06579F,#2378c4);color:white"><div class="stat-icon" style="background:rgba(255,255,255,0.25)">📋</div><div class="stat-value" style="color:white">${data.evals.length}</div><div class="stat-label" style="color:rgba(255,255,255,0.9)">تقييمات الشهر</div></div>
<div class="stat-card" style="background:linear-gradient(135deg,#06b6d4,#0891b2);color:white"><div class="stat-icon" style="background:rgba(255,255,255,0.25)">🔍</div><div class="stat-value" style="color:white">${data.sorted.length}</div><div class="stat-label" style="color:rgba(255,255,255,0.9)">أنواع الأخطاء</div></div>
<div class="stat-card" style="background:linear-gradient(135deg,#f59e0b,#d97706);color:white"><div class="stat-icon" style="background:rgba(255,255,255,0.25)">👥</div><div class="stat-value" style="color:white">${totalEmps}</div><div class="stat-label" style="color:rgba(255,255,255,0.9)">موظفون مشمولون</div></div>
</div>

<div class="card">
<div class="card-header"><div class="card-title">📊 ترتيب الأخطاء (من الأعلى للأقل)</div></div>
<div class="card-body"><div class="chart-container" style="height:380px"><canvas id="er-chart"></canvas></div></div>
</div>

<div class="card" style="margin-top:20px">
<div class="card-header"><div class="card-title">🔝 جدول الأخطاء المتكررة</div></div>
<div style="overflow-x:auto">
<table class="table">
<thead><tr><th>الترتيب</th><th>الملاحظة المرصودة</th><th style="text-align:center">عدد التكرار</th><th style="text-align:center">النسبة</th><th style="text-align:center">المؤشر</th><th>مقارنة مع الشهر السابق</th></tr></thead>
<tbody>${rows || '<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--muted)">لا توجد أخطاء مرصودة في هذا الشهر</td></tr>'}</tbody>
</table>
</div>
</div>`;
}

function renderErrorsReportCharts() {
const now = new Date();
const monthKey = currentParams.month || `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
const data = getErrorsReportData(monthKey, { department: currentParams.dept || '', supervisor: currentParams.sup || '' });
const top = data.sorted.slice(0, 8);
const c = document.getElementById('er-chart');
if (c && top.length) charts.push(new Chart(c, {
type:'bar',
data:{ labels: top.map(([k])=>k), datasets:[{ label:'عدد التكرار', data: top.map(([,n])=>n), backgroundColor:['#ef4444','#f59e0b','#06b6d4','#3b82f6','#7c3aed','#10b981','#64748b','#94a3b8'], borderRadius:6 }] },
options:{ indexAxis:'y', responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{ x:{ beginAtZero:true } } }
}));
}

function exportErrorsReportXLSX() {
const now = new Date();
const monthKey = currentParams.month || `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
const data = getErrorsReportData(monthKey, { department: currentParams.dept || '', supervisor: currentParams.sup || '' });
const rows = data.sorted.map(([obs, count], i) => ({
'الترتيب': i+1,
'الملاحظة المرصودة': obs,
'عدد التكرار': count,
'النسبة %': data.total ? Math.round((count/data.total)*100*10)/10 : 0
}));
const ws = XLSX.utils.json_to_sheet(rows);
ws['!cols'] = [{wch:10},{wch:35},{wch:14},{wch:12}];
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, `أخطاء_${monthKey}`);
XLSX.writeFile(wb, `الأخطاء_المتكررة_${monthKey}.xlsx`);
Toast.success('تم تصدير التقرير');
}

async function exportErrorsReportPDF() {
const now = new Date();
const monthKey = currentParams.month || `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
const data = getErrorsReportData(monthKey, { department: currentParams.dept || '', supervisor: currentParams.sup || '' });
const rows = data.sorted.map(([obs, count], i) => {
const pct = data.total ? Math.round((count/data.total)*100*10)/10 : 0;
return `<tr><td style="padding:6px;border:1px solid #cbd5e1;text-align:center">${i+1}</td><td style="padding:6px;border:1px solid #cbd5e1">${Utils.escape(obs)}</td><td style="padding:6px;border:1px solid #cbd5e1;text-align:center"><strong>${count}</strong></td><td style="padding:6px;border:1px solid #cbd5e1;text-align:center">${pct}%</td></tr>`;
}).join('');
const html = `<div style="padding:30px;font-family:'Cairo',sans-serif;direction:rtl;background:white">
${buildPDFHeader('❌ تقرير الأخطاء المتكررة', arabicMonthName(monthKey), '#dc2626')}
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:18px">
<div style="background:#fee2e2;padding:14px;border-radius:8px;text-align:center"><div style="font-size:22px;font-weight:800;color:#dc2626">${data.total}</div><div style="color:#64748b;font-size:12px">إجمالي الأخطاء</div></div>
<div style="background:#dbeafe;padding:14px;border-radius:8px;text-align:center"><div style="font-size:22px;font-weight:800;color:#06579F">${data.evals.length}</div><div style="color:#64748b;font-size:12px">تقييمات الشهر</div></div>
<div style="background:#cffafe;padding:14px;border-radius:8px;text-align:center"><div style="font-size:22px;font-weight:800;color:#0891b2">${data.sorted.length}</div><div style="color:#64748b;font-size:12px">أنواع الأخطاء</div></div>
</div>
<table style="width:100%;border-collapse:collapse;font-size:12px">
<thead><tr style="background:#dc2626;color:white"><th style="padding:8px;border:1px solid #b91c1c">#</th><th style="padding:8px;border:1px solid #b91c1c">الملاحظة</th><th style="padding:8px;border:1px solid #b91c1c">التكرار</th><th style="padding:8px;border:1px solid #b91c1c">النسبة</th></tr></thead>
<tbody>${rows || '<tr><td colspan="4" style="padding:14px;text-align:center;color:#94a3b8">لا توجد بيانات</td></tr>'}</tbody>
</table>
</div>`;
await htmlToPDF(html, `الأخطاء_المتكررة_${monthKey}.pdf`);
}

// ============================================
// Objections - الاعتراضات
// ============================================
function renderObjections() {
const role = currentUser.role;
let objections = [];
if (role === 'employee') {
objections = DB.getObjections({ employee_id: currentUser.id });
} else if (role === 'supervisor') {
objections = DB.getObjections({ supervisor_name: currentUser.full_name });
} else {
objections = DB.getObjections();
}

const counts = {
pending: objections.filter(o => o.status === 'pending').length,
under_review: objections.filter(o => o.status === 'under_review').length,
accepted: objections.filter(o => o.status === 'accepted').length,
rejected: objections.filter(o => o.status === 'rejected').length
};
const open = counts.pending + counts.under_review;
const closed = counts.accepted + counts.rejected;

const rows = objections.map(o => {
const emp = DB.getUser(o.employee_id);
const ev = DB.getEvaluation(o.evaluation_id);
return `<tr style="cursor:pointer" data-view-obj="${o.id}">
<td><strong style="color:var(--primary)">${Utils.escape(o.ref_number)}</strong></td>
<td><div style="display:flex;align-items:center;gap:8px"><div class="user-avatar">${Utils.getInitials(emp?emp.full_name:'-')}</div>${Utils.escape(emp?emp.full_name:'-')}</div></td>
<td>${ev ? '#'+ev.id+' ('+ev.percentage+'%)' : '-'}</td>
<td>${Utils.escape((o.reason||'').slice(0,60)) + ((o.reason||'').length>60?'...':'')}</td>
<td>${Utils.objectionStatus(o.status)}</td>
<td>${Utils.formatDate(o.created_at)}</td>
<td>${(o.attachments||[]).length>0?'<span class="badge badge-info">📎 '+o.attachments.length+'</span>':'-'}</td>
</tr>`;
}).join('');

return `
<div class="page-header">
<div><div class="page-title">⚖️ الاعتراضات</div><div class="page-subtitle">${role==='employee'?'اعتراضاتك على التقييمات':'إدارة اعتراضات الموظفين'}</div></div>
</div>

<div class="stats-grid">
<div class="stat-card" style="background:linear-gradient(135deg,#f59e0b,#d97706);color:white"><div class="stat-icon" style="background:rgba(255,255,255,0.25)">⏳</div><div class="stat-value" style="color:white">${counts.pending}</div><div class="stat-label" style="color:rgba(255,255,255,0.9)">قيد الانتظار</div></div>
<div class="stat-card" style="background:linear-gradient(135deg,#06b6d4,#0891b2);color:white"><div class="stat-icon" style="background:rgba(255,255,255,0.25)">🔍</div><div class="stat-value" style="color:white">${counts.under_review}</div><div class="stat-label" style="color:rgba(255,255,255,0.9)">قيد المراجعة</div></div>
<div class="stat-card" style="background:linear-gradient(135deg,#10b981,#059669);color:white"><div class="stat-icon" style="background:rgba(255,255,255,0.25)">✓</div><div class="stat-value" style="color:white">${counts.accepted}</div><div class="stat-label" style="color:rgba(255,255,255,0.9)">مقبول</div></div>
<div class="stat-card" style="background:linear-gradient(135deg,#ef4444,#dc2626);color:white"><div class="stat-icon" style="background:rgba(255,255,255,0.25)">✗</div><div class="stat-value" style="color:white">${counts.rejected}</div><div class="stat-label" style="color:rgba(255,255,255,0.9)">مرفوض</div></div>
<div class="stat-card" style="background:linear-gradient(135deg,#06579F,#2378c4);color:white"><div class="stat-icon" style="background:rgba(255,255,255,0.25)">📊</div><div class="stat-value" style="color:white">${open}/${closed}</div><div class="stat-label" style="color:rgba(255,255,255,0.9)">مفتوحة/مغلقة</div></div>
</div>

<div class="card">
<div style="padding:16px;background:#f8fafc;border-bottom:1px solid var(--border)">
<div class="grid grid-3" style="gap:12px">
<select class="form-control obj-filter" id="obj-filter-status">
<option value="">جميع الحالات</option>
<option value="pending">قيد الانتظار</option>
<option value="under_review">قيد المراجعة</option>
<option value="accepted">مقبول</option>
<option value="rejected">مرفوض</option>
</select>
<input type="text" class="form-control obj-filter" id="obj-filter-ref" placeholder="🔎 ابحث برقم الاعتراض...">
<input type="text" class="form-control obj-filter" id="obj-filter-name" placeholder="🔍 ابحث باسم الموظف...">
</div>
</div>
<table class="table" id="obj-table">
<thead><tr><th>الرقم المرجعي</th><th>الموظف</th><th>التقييم</th><th>السبب</th><th>الحالة</th><th>التاريخ</th><th>المرفقات</th></tr></thead>
<tbody>${rows || '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--muted)">لا توجد اعتراضات</td></tr>'}</tbody>
</table>
</div>`;
}

function renderNewObjection(evaluationId) {
if (!Perms.can('submit_objection')) return '<div class="alert alert-danger">غير مصرح لك بتقديم اعتراض</div>';
const ev = DB.getEvaluation(evaluationId);
if (!ev) return '<div class="alert alert-danger">التقييم غير موجود</div>';
if (ev.employee_id !== currentUser.id) return '<div class="alert alert-danger">لا يمكنك الاعتراض على تقييم موظف آخر</div>';

// تحقق من اعتراض قائم
const existing = DB.getObjections({ evaluation_id: evaluationId, employee_id: currentUser.id }).find(o => o.status==='pending' || o.status==='under_review');
if (existing) return `<div class="alert alert-warning">يوجد اعتراض مفتوح على هذا التقييم (${existing.ref_number}). <a href="#" data-nav-obj="${existing.id}">عرض الاعتراض</a></div>`;

return `
<div class="page-header">
<div><div class="page-title">⚖️ تقديم اعتراض</div><div class="page-subtitle">اعتراض على التقييم #${ev.id} - ${ev.percentage}%</div></div>
<button class="btn btn-secondary" data-nav-eval="${evaluationId}">← رجوع</button>
</div>

<div class="card">
<div class="card-body">
<div class="alert alert-info" style="margin-bottom:18px">
<strong>ℹ️ معلومات التقييم:</strong><br>
التاريخ: ${Utils.formatDate(ev.evaluation_date)} | النسبة: ${ev.percentage}% | التقدير: ${ev.grade}
</div>

<form id="obj-form">
<div class="form-group">
<label class="form-label">سبب الاعتراض <span style="color:var(--danger)">*</span></label>
<textarea class="form-control" id="obj-reason" rows="6" required placeholder="اكتب سبب اعتراضك بالتفصيل..."></textarea>
</div>

<div class="form-group">
<label class="form-label">إرفاق ملفات (اختياري - حد أقصى 5MB لكل ملف)</label>
<input type="file" class="form-control" id="obj-files" multiple accept="image/*,.pdf,.doc,.docx">
<div id="obj-files-preview" style="margin-top:10px;font-size:13px"></div>
</div>

<div style="display:flex;gap:10px;margin-top:20px">
<button type="button" class="btn btn-primary" id="obj-submit">📤 تقديم الاعتراض</button>
<button type="button" class="btn btn-secondary" data-nav-eval="${evaluationId}">إلغاء</button>
</div>
</form>
</div>
</div>`;
}

function attachNewObjectionHandlers(evaluationId) {
const filesInput = document.getElementById('obj-files');
const preview = document.getElementById('obj-files-preview');
let attachments = [];

if (filesInput) {
filesInput.addEventListener('change', async (e) => {
const files = Array.from(e.target.files);
attachments = [];
for (const f of files) {
if (f.size > 5 * 1024 * 1024) {
Toast.error(`الملف "${f.name}" يتجاوز 5MB`);
continue;
}
const dataUrl = await new Promise(res => {
const r = new FileReader();
r.onload = () => res(r.result);
r.readAsDataURL(f);
});
attachments.push({ name: f.name, type: f.type, size: f.size, data: dataUrl });
}
preview.innerHTML = attachments.length ?
attachments.map((a,i) => `<div style="padding:8px;background:#f1f5f9;border-radius:6px;margin-bottom:4px;display:flex;justify-content:space-between"><span>📎 ${Utils.escape(a.name)} <span style="color:var(--muted)">(${Utils.formatBytes(a.size)})</span></span></div>`).join('')
: '';
});
}

const submit = document.getElementById('obj-submit');
if (submit) submit.addEventListener('click', async (e) => {
const btn = e.currentTarget;
await submitWithFeedback(btn, 'جاري الإرسال...', null, async () => {
const reason = document.getElementById('obj-reason').value.trim();
if (!reason || reason.length < 10) { Toast.error('يجب كتابة سبب الاعتراض بشكل واضح (10 أحرف على الأقل)'); return false; }
let objId = null, objRef = null;
if (window.sb && window.sb.rpc) {
const { data, error } = await window.sb.rpc('create_objection', {
p_session_token: (window.getSessionToken ? window.getSessionToken() : null),
p_evaluation_id: parseInt(evaluationId), p_reason: reason, p_attachments: attachments
});
const row = (!error && Array.isArray(data) && data[0]) ? data[0] : null;
if (!row || !row.ok) { const msg=(row&&row.message)||(error&&error.message)||'تعذّر تقديم الاعتراض'; const h=handleSessionError(msg); if(!h) Toast.error(msg); return false; }
objId = row.objection_id; objRef = row.ref_number;
if (window.SupabaseSync && SupabaseSync.pullAll) { try{ await SupabaseSync.pullAll(); }catch(_){} }
try { const ob=DB.getObjection(objId); if (ob && window.EmailService) window.EmailService.sendObjectionEmail(ob).catch(()=>{}); } catch(_){}
Toast.success(`تم تقديم الاعتراض بنجاح (${objRef})`);
} else {
const obj = DB.createObjection({ evaluation_id: parseInt(evaluationId), employee_id: currentUser.id, reason, attachments });
if (obj && obj._duplicate) Toast.warning('تم رصد طلب مكرر - استخدمنا الاعتراض السابق');
else Toast.success(`تم تقديم الاعتراض بنجاح (${obj.ref_number})`);
objId = obj.id;
}
if (typeof navigate === 'function') navigate('view-objection', { id: objId });
return true;
});
});
}

function renderViewObjection(id) {
const o = DB.getObjection(parseInt(id));
if (!o) return '<div class="alert alert-danger">الاعتراض غير موجود</div>';
const emp = DB.getUser(o.employee_id);
const ev = DB.getEvaluation(o.evaluation_id);
const isOwner = currentUser.id === o.employee_id;
const canManage = Perms.can('manage_objections');
const supName = emp ? emp.supervisor_name : '';
const canSupervisorView = currentUser.role === 'supervisor' && currentUser.full_name === supName;

if (!isOwner && !canManage && !canSupervisorView) return '<div class="alert alert-danger">غير مصرح لك بعرض هذا الاعتراض</div>';

const isOpen = o.status === 'pending' || o.status === 'under_review';
const commentsHTML = (o.comments || []).map(c => `
<div style="background:${c.is_resolution?'#fef3c7':'#f8fafc'};padding:12px 16px;border-right:3px solid ${c.is_resolution?'var(--warning)':'var(--primary)'};border-radius:6px;margin-bottom:10px">
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
<div><strong>${Utils.escape(c.user_name)}</strong> <span style="font-size:12px;color:var(--muted)">${Utils.roleLabel(c.role)}</span></div>
<div style="font-size:12px;color:var(--muted)">${Utils.formatDateTime(c.created_at)}</div>
</div>
<div>${Utils.escape(c.text)}</div>
${c.is_resolution ? '<div style="margin-top:6px"><span class="badge badge-warning">قرار البت</span></div>' : ''}
</div>`).join('');

const attachHTML = (o.attachments || []).map((a, i) => `
<a href="${a.data}" download="${Utils.escape(a.name)}" style="display:inline-block;padding:10px 14px;background:#dbeafe;color:#06579F;border-radius:8px;text-decoration:none;font-weight:600;margin:4px">📎 ${Utils.escape(a.name)} (${Utils.formatBytes(a.size)})</a>
`).join('');

const resolveButtons = (canManage && isOpen) ? `
<div class="card" style="margin-top:20px;border:2px solid var(--warning)">
<div class="card-header" style="background:#fef3c7"><div class="card-title">⚖️ البت في الاعتراض</div></div>
<div class="card-body">
<div class="form-group">
<label class="form-label">رد موظف الجودة <span style="color:var(--danger)">*</span></label>
<textarea class="form-control" id="obj-response" rows="4" placeholder="اكتب الرد على الاعتراض..."></textarea>
</div>
${o.status === 'pending' ? `<button class="btn btn-info" id="obj-mark-review" style="margin-left:8px">🔍 تحت المراجعة</button>` : ''}
<button class="btn btn-success" id="obj-accept">✓ قبول الاعتراض</button>
<button class="btn btn-danger" id="obj-reject">✗ رفض الاعتراض</button>
</div>
</div>` : '';

const addCommentArea = (isOpen && (canManage || isOwner || canSupervisorView)) ? `
<div class="card" style="margin-top:20px">
<div class="card-header"><div class="card-title">💬 إضافة تعليق</div></div>
<div class="card-body">
<div class="form-group">
<textarea class="form-control" id="obj-comment" rows="3" placeholder="اكتب تعليقك..."></textarea>
</div>
<button class="btn btn-primary" id="obj-add-comment">إضافة تعليق</button>
</div>
</div>` : '';

return `
<div class="page-header">
<div>
<div class="page-title">⚖️ ${Utils.escape(o.ref_number)}</div>
<div class="page-subtitle">اعتراض على التقييم #${o.evaluation_id} - ${Utils.formatDate(o.created_at)}</div>
</div>
<button class="btn btn-secondary" data-nav="objections">← رجوع</button>
</div>

<div class="grid grid-2">
<div class="card">
<div class="card-header"><div class="card-title">📋 معلومات الاعتراض</div></div>
<div class="card-body">
<div style="margin-bottom:14px"><strong>الرقم المرجعي:</strong> <span style="color:var(--primary);font-weight:800">${Utils.escape(o.ref_number)}</span></div>
<div style="margin-bottom:14px"><strong>الموظف:</strong> ${Utils.escape(emp?emp.full_name:'-')} (${Utils.escape(emp?emp.employee_number:'-')})</div>
<div style="margin-bottom:14px"><strong>المشرف:</strong> ${Utils.escape(emp?emp.supervisor_name:'-')}</div>
<div style="margin-bottom:14px"><strong>التقييم:</strong> #${o.evaluation_id} - ${ev?ev.percentage+'%':'-'}</div>
<div style="margin-bottom:14px"><strong>الحالة:</strong> ${Utils.objectionStatus(o.status)}</div>
<div style="margin-bottom:14px"><strong>تاريخ التقديم:</strong> ${Utils.formatDateTime(o.created_at)}</div>
${o.resolved_at ? `<div style="margin-bottom:14px"><strong>تاريخ البت:</strong> ${Utils.formatDateTime(o.resolved_at)}</div>` : ''}
${o.resolved_by ? `<div style="margin-bottom:14px"><strong>تم البت بواسطة:</strong> ${Utils.escape((DB.getUser(o.resolved_by)||{}).full_name||'-')}</div>` : ''}
</div>
</div>

<div class="card">
<div class="card-header"><div class="card-title">📝 سبب الاعتراض</div></div>
<div class="card-body">
<div style="background:#f8fafc;padding:14px;border-radius:8px;line-height:1.8;white-space:pre-wrap">${Utils.escape(o.reason)}</div>
${attachHTML ? `<div style="margin-top:14px"><strong>المرفقات:</strong><div style="margin-top:8px">${attachHTML}</div></div>` : ''}
</div>
</div>
</div>

<div class="card" style="margin-top:20px">
<div class="card-header"><div class="card-title">💬 سجل التعليقات والإجراءات (${(o.comments||[]).length})</div></div>
<div class="card-body">
${commentsHTML || '<div style="text-align:center;color:var(--muted);padding:14px">لا توجد تعليقات بعد</div>'}
</div>
</div>

${resolveButtons}
${addCommentArea}
`;
}

function attachObjectionHandlers(id) {
const oid = parseInt(id);
const review = document.getElementById('obj-mark-review');
if (review) review.addEventListener('click', async (e) => {
const btn = e.currentTarget;
await submitWithFeedback(btn, 'جاري المعالجة...', null, async () => {
if (window.sb && window.sb.rpc) {
const { data, error } = await window.sb.rpc('mark_objection_under_review', {
p_session_token: (window.getSessionToken ? window.getSessionToken() : null), p_objection_id: oid
});
const row = (!error && Array.isArray(data) && data[0]) ? data[0] : null;
if (!row || !row.ok) { const msg=(row&&row.message)||(error&&error.message)||'تعذّر التحويل'; const h=handleSessionError(msg); if(!h) Toast.error(msg); return false; }
if (window.SupabaseSync && SupabaseSync.pullAll) { try{ await SupabaseSync.pullAll(); }catch(_){} }
} else {
DB.updateObjection(oid, { status: 'under_review' });
}
Toast.success('تم تحويل الاعتراض إلى قيد المراجعة');
if (typeof navigate === 'function') navigate('view-objection', { id: oid });
return true;
});
});
const accept = document.getElementById('obj-accept');
if (accept) accept.addEventListener('click', async (e) => {
const btn = e.currentTarget;
await submitWithFeedback(btn, 'جاري القبول...', null, async () => {
const resp = document.getElementById('obj-response').value.trim();
if (!resp) { Toast.error('يجب كتابة رد على الاعتراض'); return false; }
if (!(await resolveObjectionViaRPC(oid, 'accepted', resp))) return false;
Toast.success('تم قبول الاعتراض');
if (typeof navigate === 'function') navigate('view-objection', { id: oid });
return true;
});
});
const reject = document.getElementById('obj-reject');
if (reject) reject.addEventListener('click', async (e) => {
const btn = e.currentTarget;
await submitWithFeedback(btn, 'جاري الرفض...', null, async () => {
const resp = document.getElementById('obj-response').value.trim();
if (!resp) { Toast.error('يجب كتابة رد على الاعتراض'); return false; }
if (!(await resolveObjectionViaRPC(oid, 'rejected', resp))) return false;
Toast.success('تم رفض الاعتراض');
if (typeof navigate === 'function') navigate('view-objection', { id: oid });
return true;
});
});
const addC = document.getElementById('obj-add-comment');
if (addC) addC.addEventListener('click', async (e) => {
const btn = e.currentTarget;
await submitWithFeedback(btn, 'جاري الإضافة...', null, async () => {
const text = document.getElementById('obj-comment').value.trim();
if (!text) { Toast.error('اكتب التعليق'); return false; }
if (window.sb && window.sb.rpc) {
const { data, error } = await window.sb.rpc('add_objection_comment', {
p_session_token: (window.getSessionToken ? window.getSessionToken() : null), p_objection_id: oid, p_text: text
});
const row = (!error && Array.isArray(data) && data[0]) ? data[0] : null;
if (!row || !row.ok) { const msg=(row&&row.message)||(error&&error.message)||'تعذّر إضافة التعليق'; const h=handleSessionError(msg); if(!h) Toast.error(msg); return false; }
if (window.SupabaseSync && SupabaseSync.pullAll) { try{ await SupabaseSync.pullAll(); }catch(_){} }
} else {
DB.addObjectionComment(oid, text);
}
Toast.success('تم إضافة التعليق');
if (typeof navigate === 'function') navigate('view-objection', { id: oid });
return true;
});
});
}

// ============================================
// Audit Log - سجل العمليات
// ============================================
function renderAuditLog() {
if (!Perms.can('view_audit_log')) return '<div class="alert alert-danger">غير مصرح بالعرض</div>';
const logs = DB.getAuditLogs();
const actionLabels = {
create_evaluation:'إنشاء تقييم', update_evaluation:'تعديل تقييم', delete_evaluation:'حذف تقييم', approve_evaluation:'اعتماد تقييم',
submit_objection:'تقديم اعتراض', resolve_objection:'البت في اعتراض', review_objection:'مراجعة اعتراض',
create_user:'إنشاء مستخدم', update_user:'تعديل مستخدم', deactivate_user:'تعطيل مستخدم'
};
const actionColors = {
create_evaluation:'#10b981', update_evaluation:'#f59e0b', delete_evaluation:'#ef4444', approve_evaluation:'#06b6d4',
submit_objection:'#7c3aed', resolve_objection:'#1e40af', review_objection:'#0891b2',
create_user:'#10b981', update_user:'#f59e0b', deactivate_user:'#ef4444'
};

const rows = logs.map(l => `<tr data-search="${Utils.escape((l.user_name||'')+' '+(l.action||'')+' '+(l.details||''))}">
<td>${Utils.formatDateTime(l.timestamp)}</td>
<td><div style="display:flex;align-items:center;gap:8px"><div class="user-avatar" style="width:28px;height:28px;font-size:11px">${Utils.getInitials(l.user_name)}</div>${Utils.escape(l.user_name)}</div></td>
<td>${Utils.roleBadge(l.role)}</td>
<td><span class="badge" style="background:${(actionColors[l.action]||'#64748b')}22;color:${actionColors[l.action]||'#64748b'}">${actionLabels[l.action]||l.action}</span></td>
<td>${Utils.escape(l.entity_type)}${l.entity_id?' #'+l.entity_id:''}</td>
<td>${Utils.escape(l.details)}</td>
</tr>`).join('');

const todayCount = logs.filter(l => new Date(l.timestamp).toDateString() === new Date().toDateString()).length;
const uniqueUsers = new Set(logs.map(l => l.user_id)).size;

return `
<div class="page-header">
<div><div class="page-title">📜 سجل العمليات</div><div class="page-subtitle">سجل كامل بجميع العمليات داخل النظام</div></div>
<button class="btn btn-success" id="audit-export">📊 تصدير Excel</button>
</div>

<div class="stats-grid">
<div class="stat-card" style="background:linear-gradient(135deg,#06579F,#2378c4);color:white"><div class="stat-icon" style="background:rgba(255,255,255,0.25)">📋</div><div class="stat-value" style="color:white">${logs.length}</div><div class="stat-label" style="color:rgba(255,255,255,0.9)">إجمالي العمليات</div></div>
<div class="stat-card" style="background:linear-gradient(135deg,#10b981,#059669);color:white"><div class="stat-icon" style="background:rgba(255,255,255,0.25)">📅</div><div class="stat-value" style="color:white">${todayCount}</div><div class="stat-label" style="color:rgba(255,255,255,0.9)">عمليات اليوم</div></div>
<div class="stat-card" style="background:linear-gradient(135deg,#06b6d4,#0891b2);color:white"><div class="stat-icon" style="background:rgba(255,255,255,0.25)">👥</div><div class="stat-value" style="color:white">${uniqueUsers}</div><div class="stat-label" style="color:rgba(255,255,255,0.9)">مستخدمين نشطين</div></div>
</div>

<div class="card">
<div style="padding:16px;background:#f8fafc;border-bottom:1px solid var(--border)">
<input type="text" class="form-control" id="audit-search" placeholder="🔍 ابحث في السجل (المستخدم، العملية، التفاصيل)...">
</div>
<div style="overflow-x:auto">
<table class="table" id="audit-table">
<thead><tr><th>التاريخ والوقت</th><th>المستخدم</th><th>الدور</th><th>العملية</th><th>العنصر</th><th>التفاصيل</th></tr></thead>
<tbody>${rows || '<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--muted)">لا توجد عمليات مسجلة</td></tr>'}</tbody>
</table>
</div>
</div>`;
}

function exportAuditLogXLSX() {
const logs = DB.getAuditLogs();
const actionLabels = {
create_evaluation:'إنشاء تقييم', update_evaluation:'تعديل تقييم', delete_evaluation:'حذف تقييم', approve_evaluation:'اعتماد تقييم',
submit_objection:'تقديم اعتراض', resolve_objection:'البت في اعتراض', review_objection:'مراجعة اعتراض',
create_user:'إنشاء مستخدم', update_user:'تعديل مستخدم', deactivate_user:'تعطيل مستخدم'
};
const data = logs.map(l => ({
'التاريخ والوقت': Utils.formatDateTime(l.timestamp),
'المستخدم': l.user_name,
'الدور': Utils.roleLabel(l.role),
'العملية': actionLabels[l.action] || l.action,
'النوع': l.entity_type,
'الرقم': l.entity_id || '-',
'التفاصيل': l.details
}));
const ws = XLSX.utils.json_to_sheet(data);
ws['!cols'] = [{wch:18},{wch:20},{wch:14},{wch:16},{wch:14},{wch:10},{wch:50}];
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'سجل العمليات');
XLSX.writeFile(wb, `سجل_العمليات_${new Date().toISOString().slice(0,10)}.xlsx`);
Toast.success('تم تصدير السجل');
}

// ============================================
// Profile
// ============================================
function renderProfile() {
const u = DB.getUser(currentUser.id);
return `
<div class="page-header">
<div><div class="page-title">الملف الشخصي</div><div class="page-subtitle">إدارة بياناتك الشخصية</div></div>
</div>
<div class="grid grid-2">
<div class="card">
<div class="card-header"><div class="card-title">👤 البيانات الشخصية</div></div>
<div class="card-body">
<form id="profile-form">
<div class="form-group"><label class="form-label">الاسم الكامل</label><input class="form-control" id="pf-name" value="${Utils.escape(u.full_name)}"></div>
<div class="form-group"><label class="form-label">البريد الإلكتروني</label><input type="email" class="form-control" id="pf-email" value="${Utils.escape(u.email||'')}"></div>
<div class="form-group"><label class="form-label">رقم الجوال</label><input class="form-control" id="pf-phone" value="${Utils.escape(u.phone||'')}"></div>
<div class="form-group"><label class="form-label">القسم</label><input class="form-control" value="${Utils.escape(u.department||'')}" disabled></div>
<div class="form-group"><label class="form-label">الدور</label><input class="form-control" value="${Utils.roleLabel(u.role)}" disabled></div>
<button type="submit" class="btn btn-primary">💾 حفظ التعديلات</button>
</form>
</div>
</div>
<div class="card">
<div class="card-header"><div class="card-title">🔒 تغيير كلمة المرور</div></div>
<div class="card-body">
${u.must_change_password ? '<div class="alert alert-warning" style="margin-bottom:14px">⚠️ يجب تغيير كلمة المرور المؤقتة قبل المتابعة</div>' : ''}
<form id="pw-form">
<div class="form-group"><label class="form-label">كلمة المرور الحالية</label><input type="password" class="form-control" id="pw-cur" required autocomplete="current-password"></div>
<div class="form-group"><label class="form-label">كلمة المرور الجديدة</label><input type="password" class="form-control" id="pw-new" required autocomplete="new-password"></div>
<div class="form-group"><label class="form-label">تأكيد كلمة المرور</label><input type="password" class="form-control" id="pw-conf" required autocomplete="new-password"></div>
<div style="background:#f1f5f9;padding:12px;border-radius:8px;font-size:13px;color:var(--muted);margin-bottom:14px;border-right:3px solid var(--primary)">
<strong style="color:var(--text)">سياسة كلمة المرور:</strong>
<ul style="margin:6px 0 0 18px;padding:0;list-style:disc inside">
<li>8 أحرف على الأقل</li>
<li>حرف واحد على الأقل (A-Z, a-z)</li>
<li>رقم واحد على الأقل (0-9)</li>
<li>رمز خاص واحد على الأقل (@!#$%^&*)</li>
</ul>
</div>
<button type="submit" class="btn btn-warning">🔑 تغيير كلمة المرور</button>
</form>
</div>
</div>
</div>`;
}

function attachProfileHandlers() {
const pf = document.getElementById('profile-form');
if (pf) pf.addEventListener('submit', async e => {
e.preventDefault();
const btn = pf.querySelector('button[type=submit]');
await submitWithFeedback(btn, 'جاري الحفظ...', null, async () => {
const email = document.getElementById('pf-email').value.trim();
if (!Utils.validateEmail(email)) { Toast.error('بريد إلكتروني غير صالح'); return false; }
const pfName = document.getElementById('pf-name').value.trim();
const pfPhone = document.getElementById('pf-phone').value.trim();
if (window.sb && window.sb.rpc) {
const { data, error } = await window.sb.rpc('update_own_profile', {
p_session_token: (window.getSessionToken ? window.getSessionToken() : null),
p_full_name: pfName, p_email: email, p_phone: pfPhone
});
const row = (!error && Array.isArray(data) && data[0]) ? data[0] : null;
if (!row || !row.ok) { const msg=(row&&row.message)||(error&&error.message)||'تعذّر الحفظ'; const h=handleSessionError(msg); if(!h) Toast.error(msg); return false; }
if (window.SupabaseSync && SupabaseSync.pullAll) { try{ await SupabaseSync.pullAll(); }catch(_){} }
} else {
DB.updateUser(currentUser.id, { full_name: pfName, email, phone: pfPhone });
}
currentUser.full_name = pfName; currentUser.email = email;
localStorage.setItem('qe_current_user', JSON.stringify(currentUser));
Toast.success('تم حفظ التعديلات');
if (typeof navigate === 'function') navigate('profile');
return true;
});
});

const pw = document.getElementById('pw-form');
if (pw) pw.addEventListener('submit', async e => {
e.preventDefault();
const btn = pw.querySelector('button[type=submit]');
await submitWithFeedback(btn, 'جاري التغيير...', null, async () => {
const cur = document.getElementById('pw-cur').value;
const np = document.getElementById('pw-new').value;
const cp = document.getElementById('pw-conf').value;
if (np !== cp) { Toast.error('كلمتا المرور غير متطابقتين'); return false; }
if (np === cur) { Toast.error('كلمة المرور الجديدة يجب أن تختلف عن الحالية'); return false; }
const vp = Utils.validatePassword(np);
if (!vp.valid) { Toast.error(vp.errors[0]); return false; }
// التغيير عبر RPC آمنة في Supabase (تتحقق من القديمة ثم تُحدِّث ذرياً)
let ok = false;
if (window.sb && window.sb.rpc) {
try {
const { data, error } = await window.sb.rpc('change_password', { p_user_id: currentUser.id, p_old_password: cur, p_new_password: np });
ok = !error && data === true;
} catch(e) { console.warn('RPC change_password failed:', e && e.message); }
} else {
const u = DB.getUser(currentUser.id);
if (u && u.password === cur) { DB.changePassword(currentUser.id, np); ok = true; }
}
if (!ok) { Toast.error('كلمة المرور الحالية غير صحيحة'); return false; }
// تحديث محلي خفيف (الـ pull التلقائي سيُزامن باقي الحقول)
try { const u2 = DB.getUser(currentUser.id); if (u2) { u2.must_change_password = false; u2.password_changed_at = new Date().toISOString(); DB.save(); } } catch(_) {}
Toast.success('تم تغيير كلمة المرور بنجاح');
pw.reset();
return true;
});
});
}

// ============================================
// Notifications
// ============================================
function renderNotificationsPage() {
const notifs = DB.getNotifications(currentUser.id);
// تعليم مقروءة: محلياً فوراً + على الخادم عبر RPC (fire-and-forget)
try { (DB.data.notifications||[]).forEach(n => { if (n.user_id === currentUser.id) n.is_read = true; }); } catch(_){}
if (window.sb && window.sb.rpc) { try { window.sb.rpc('mark_notifications_read', { p_session_token: (window.getSessionToken ? window.getSessionToken() : null) }).then(function(){},function(){}); } catch(_){} }
else { DB.markAllRead(currentUser.id); }

return `
<div class="page-header">
<div><div class="page-title">الإشعارات</div><div class="page-subtitle">${notifs.length} إشعار</div></div>
</div>
<div class="card">
${notifs.length ? notifs.map(n => `
<div style="padding:14px 18px;border-bottom:1px solid var(--border);${n.is_read?'':'background:#fefce8'}">
<div style="display:flex;justify-content:space-between;align-items:start;gap:14px">
<div style="flex:1"><div style="font-weight:700;margin-bottom:4px">${Utils.escape(n.title)}</div><div style="color:var(--muted);font-size:14px">${Utils.escape(n.message)}</div></div>
<div style="font-size:12px;color:var(--muted);white-space:nowrap">${Utils.timeAgo(n.created_at)}</div>
</div>
</div>`).join('') : '<div style="padding:30px;text-align:center;color:var(--muted)">لا توجد إشعارات</div>'}
</div>`;
}

// ============================================
// Excel & PDF Export
// ============================================
function exportListXLSX() {
const isEmp = currentUser.role === 'employee';
const evals = DB.getEvaluations(isEmp ? { employee_id: currentUser.id } : {});
const rows = evals.map(e => {
const emp = DB.getUser(e.employee_id), evr = DB.getUser(e.evaluator_id);
return {
'#': e.id,
'الموظف': emp ? emp.full_name : '-',
'المقيِّم': evr ? evr.full_name : '-',
'التاريخ': e.evaluation_date,
'الملاحظة المرصودة': e.observed_issue === 'أخرى' ? (e.observed_issue_other || 'أخرى') : (e.observed_issue || e.call_type || ''),
'الإجراء المتخذ': e.action_taken === 'أخرى' ? (e.action_taken_other || 'أخرى') : (e.action_taken || ''),
'الدرجة': e.total_score,
'النسبة %': e.percentage,
'التقدير': e.grade,
'الحالة': e.status,
'ملاحظات': e.notes || ''
};
});
const ws = XLSX.utils.json_to_sheet(rows);
ws['!cols'] = [{wch:5},{wch:25},{wch:25},{wch:12},{wch:18},{wch:8},{wch:8},{wch:12},{wch:8},{wch:30}];
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'التقييمات');
XLSX.writeFile(wb, `تقييمات_${new Date().toISOString().substring(0,10)}.xlsx`);
Toast.success('تم تصدير الملف بنجاح');
}

function exportSingleXLSX(id) {
const ev = DB.getEvaluation(id); if (!ev) return;
const emp = DB.getUser(ev.employee_id), evr = DB.getUser(ev.evaluator_id);
const A = CRITERIA.answers;
const observedDisplay = ev.observed_issue === 'أخرى' ? (ev.observed_issue_other||'أخرى') : (ev.observed_issue || ev.call_type || '-');
const actionDisplay = ev.action_taken === 'أخرى' ? (ev.action_taken_other||'أخرى') : (ev.action_taken || '-');
const summary = [
['رقم التقييم', ev.id], ['الموظف', emp?emp.full_name:'-'], ['المقيِّم', evr?evr.full_name:'-'],
['التاريخ', ev.evaluation_date], ['الملاحظة المرصودة', observedDisplay], ['الإجراء المتخذ', actionDisplay],
['الدرجة', `${ev.total_score}/100`], ['النسبة', `${ev.percentage}%`],
['التقدير', ev.grade], ['الحالة', ev.status], ['ملاحظات إضافية', ev.notes||'-']
];
const details = [];
CRITERIA.sections.forEach(s => s.subsections.forEach(sub => sub.items.forEach(it => {
const ans = (ev.items && ev.items[it.key]) || A.OK;
details.push({ 'القسم':s.title, 'القسم الفرعي':sub.title, 'البند':it.label, 'النتيجة':ans });
})));
const wb = XLSX.utils.book_new();
const ws1 = XLSX.utils.aoa_to_sheet([['الحقل','القيمة'], ...summary]);
ws1['!cols'] = [{wch:18},{wch:50}];
XLSX.utils.book_append_sheet(wb, ws1, 'الملخص');
const ws2 = XLSX.utils.json_to_sheet(details);
ws2['!cols'] = [{wch:35},{wch:25},{wch:60},{wch:15}];
XLSX.utils.book_append_sheet(wb, ws2, 'التفاصيل');
XLSX.writeFile(wb, `تقييم_${ev.id}_${emp?emp.full_name:''}.xlsx`);
Toast.success('تم تصدير الملف بنجاح');
}

// بناء فوتر PDF احترافي يظهر في كل صفحة
function buildPDFFooter() {
const today = new Date();
const dateStr = `${today.getDate().toString().padStart(2,'0')}/${(today.getMonth()+1).toString().padStart(2,'0')}/${today.getFullYear()}`;
const timeStr = `${today.getHours().toString().padStart(2,'0')}:${today.getMinutes().toString().padStart(2,'0')}`;
return `
<div style="border-top:2px solid #06579F;padding-top:10px;background:linear-gradient(to bottom, #f8fafc, #ffffff)">
<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 14px">
<div style="display:flex;align-items:center;gap:10px">
<div style="width:46px;height:46px;background:linear-gradient(135deg,#06579F,#1B202C);border-radius:10px;padding:5px;display:flex;align-items:center;justify-content:center">${MAHZAM_LOGO_LIGHT_SVG}</div>
<div>
<div style="font-size:13px;font-weight:800;color:#06579F">${SYSTEM_NAME}</div>
<div style="font-size:10px;color:#1B202C;font-weight:600">${COMPANY_NAME} • Mahzam Co.</div>
</div>
</div>
<div style="text-align:center">
<div style="font-size:11px;color:#1e293b;font-weight:600">📅 ${dateStr} - ⏰ ${timeStr}</div>
<div style="font-size:9px;color:#64748b;margin-top:2px">تاريخ ووقت إنشاء التقرير</div>
</div>
<div style="text-align:left">
<div style="font-size:10px;color:#64748b">تم إنشاؤه آلياً</div>
<div style="font-size:9px;color:#94a3b8;margin-top:2px">© ${today.getFullYear()} ${COMPANY_NAME} - جميع الحقوق محفوظة</div>
</div>
</div>
</div>`;
}

// رأس PDF موحد يستخدم في جميع التقارير
function buildPDFHeader(title, subtitle, accentColor) {
const ac = accentColor || '#06579F';
return `<div style="text-align:center;margin-bottom:18px;border-bottom:3px solid ${ac};padding-bottom:14px;display:flex;align-items:center;justify-content:space-between;gap:14px">
<div style="width:80px;height:80px;flex-shrink:0">${MAHZAM_LOGO_SVG}</div>
<div style="flex:1">
<div style="color:#1B202C;font-size:12px;font-weight:700;margin-bottom:4px">${COMPANY_NAME} • Mahzam Co.</div>
<h1 style="color:${ac};font-size:22px;margin:0">${title}</h1>
${subtitle ? `<div style="color:#64748b;font-size:13px;margin-top:6px;font-weight:600">${subtitle}</div>` : ''}
<div style="color:#94a3b8;font-size:11px;margin-top:4px">${SYSTEM_NAME} - ${new Date().toLocaleDateString('ar-SA')}</div>
</div>
<div style="width:80px;flex-shrink:0;text-align:left">
<div style="background:${ac};color:white;padding:6px 10px;border-radius:6px;font-size:10px;font-weight:700">تقرير رسمي</div>
</div>
</div>`;
}

// تحويل عنصر HTML إلى PDF مع دعم العربية وفوتر احترافي على كل صفحة
// إعدادات PDF بمقاس A4 احترافي
const PDF_CONFIG = {
A4_WIDTH_MM: 210, A4_HEIGHT_MM: 297, MARGIN_MM: 12,
CONTENT_WIDTH_PX: 720, RENDER_SCALE: 2.5, JPEG_QUALITY: 0.95
};

// CSS داخلي لمنع قص المحتوى عبر الصفحات
const PDF_PRINT_CSS = `<style>
* { box-sizing: border-box !important; }
.card, table, .alert, .stat-card { page-break-inside: avoid !important; break-inside: avoid !important; }
h1, h2, h3 { page-break-after: avoid !important; break-after: avoid !important; }
tr, thead { page-break-inside: avoid !important; break-inside: avoid !important; }
thead { display: table-header-group !important; }
tfoot { display: table-footer-group !important; }
table { border-collapse: collapse !important; width: 100% !important; max-width: 100% !important; table-layout: fixed; }
td, th { word-wrap: break-word; overflow-wrap: break-word; }
img, svg { max-width: 100% !important; height: auto !important; }
body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
</style>`;

async function htmlToPDF(htmlContent, filename) {
const { jsPDF } = window.jspdf;
const cfg = PDF_CONFIG;

const pdf = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4', compress:true });

// إنشاء حاوية المحتوى بعرض A4 محسوب
const wrap = document.createElement('div');
wrap.style.cssText = `position:fixed;left:-10000px;top:0;width:${cfg.CONTENT_WIDTH_PX}px;padding:0;background:white;font-family:'Cairo',sans-serif;direction:rtl;color:#1e293b;line-height:1.5;font-size:12px`;
wrap.innerHTML = PDF_PRINT_CSS + '<div>' + htmlContent + '</div>';
document.body.appendChild(wrap);

const footerEl = document.createElement('div');
footerEl.style.cssText = `position:fixed;left:-10000px;top:0;width:${cfg.CONTENT_WIDTH_PX}px;background:white;font-family:'Cairo',sans-serif;direction:rtl`;
footerEl.innerHTML = buildPDFFooter();
document.body.appendChild(footerEl);

try {
if (document.fonts && document.fonts.ready) {
try { await document.fonts.ready; } catch(e) {}
}

const [contentCanvas, footerCanvas] = await Promise.all([
html2canvas(wrap, { scale:cfg.RENDER_SCALE, useCORS:true, backgroundColor:'#ffffff', logging:false, windowWidth:cfg.CONTENT_WIDTH_PX, imageTimeout:0 }),
html2canvas(footerEl, { scale:cfg.RENDER_SCALE, useCORS:true, backgroundColor:'#ffffff', logging:false, windowWidth:cfg.CONTENT_WIDTH_PX, imageTimeout:0 })
]);

const contentImg = contentCanvas.toDataURL('image/jpeg', cfg.JPEG_QUALITY);
const footerImg = footerCanvas.toDataURL('image/jpeg', cfg.JPEG_QUALITY);

const pdfW = cfg.A4_WIDTH_MM, pdfH = cfg.A4_HEIGHT_MM;
const margin = cfg.MARGIN_MM;
const imgW = pdfW - margin*2;

// أبعاد الفوتر
const footerH = (footerCanvas.height * imgW) / footerCanvas.width;
const footerGap = 3; // مسافة فاصلة قبل الفوتر

// منطقة المحتوى المتاحة بعد حجز مساحة الفوتر
const contentAreaH = pdfH - margin*2 - footerH - footerGap;

// أبعاد المحتوى الكاملة
const contentImgH = (contentCanvas.height * imgW) / contentCanvas.width;

// عدد الصفحات المطلوبة
const totalPages = Math.max(1, Math.ceil(contentImgH / contentAreaH));

for (let p = 0; p < totalPages; p++) {
if (p > 0) pdf.addPage();

// إدراج صورة المحتوى مع إزاحة لإظهار الشريحة المناسبة لهذه الصفحة
const yOffset = margin - (p * contentAreaH);
pdf.addImage(contentImg, 'JPEG', margin, yOffset, imgW, contentImgH, undefined, 'FAST');

// تغطية أعلى الصفحة بالأبيض (لإخفاء فيض الصورة فوق الهامش)
pdf.setFillColor(255, 255, 255);
pdf.rect(0, 0, pdfW, margin, 'F');

// تغطية أسفل منطقة المحتوى (لإخفاء فيض الصورة في منطقة الفوتر)
pdf.rect(0, margin + contentAreaH, pdfW, pdfH - (margin + contentAreaH), 'F');

// خط فاصل قبل الفوتر
pdf.setDrawColor(226, 232, 240);
pdf.setLineWidth(0.3);
pdf.line(margin, margin + contentAreaH + footerGap/2, pdfW - margin, margin + contentAreaH + footerGap/2);

// إدراج الفوتر في أسفل كل صفحة
const footerY = pdfH - margin - footerH;
pdf.addImage(footerImg, 'JPEG', margin, footerY, imgW, footerH, undefined, 'FAST');

// رقم الصفحة (أرقام إنجليزية - مدعومة في jsPDF بدون خط خاص)
pdf.setFontSize(8);
pdf.setTextColor(100, 116, 139);
pdf.text(`Page ${p + 1} / ${totalPages}`, pdfW / 2, pdfH - 2, { align:'center' });
}

pdf.save(filename);
} finally {
document.body.removeChild(wrap);
document.body.removeChild(footerEl);
}
}

function exportListPDF() {
const isEmp = currentUser.role === 'employee';
const evals = DB.getEvaluations(isEmp ? { employee_id: currentUser.id } : {});
const today = new Date();
const dateStr = `${today.getDate().toString().padStart(2,'0')}/${(today.getMonth()+1).toString().padStart(2,'0')}/${today.getFullYear()}`;

const rows = evals.map(e => {
const emp = DB.getUser(e.employee_id), evr = DB.getUser(e.evaluator_id);
const cls = e.percentage >= 85 ? '#d1fae5;color:#065f46' : '#fee2e2;color:#991b1b';
return `<tr>
<td style="padding:8px;border:1px solid #e2e8f0;text-align:center">#${e.id}</td>
<td style="padding:8px;border:1px solid #e2e8f0">${Utils.escape(emp?emp.full_name:'-')}</td>
<td style="padding:8px;border:1px solid #e2e8f0">${Utils.escape(evr?evr.full_name:'-')}</td>
<td style="padding:8px;border:1px solid #e2e8f0;text-align:center">${Utils.formatDate(e.evaluation_date)}</td>
<td style="padding:8px;border:1px solid #e2e8f0;text-align:center">${e.total_score}/100</td>
<td style="padding:8px;border:1px solid #e2e8f0;text-align:center;font-weight:700">${e.percentage}%</td>
<td style="padding:8px;border:1px solid #e2e8f0;text-align:center"><span style="background:${cls};padding:3px 10px;border-radius:999px;font-size:12px;font-weight:700">${e.grade}</span></td>
<td style="padding:8px;border:1px solid #e2e8f0;text-align:center">${e.status}</td>
</tr>`;
}).join('');

const totalAvg = evals.length ? Math.round(evals.reduce((s,e)=>s+e.percentage,0)/evals.length*10)/10 : 0;
const passed = evals.filter(e => e.status === 'ناجح').length;
const failed = evals.length - passed;

const html = `
${buildPDFHeader('📊 تقرير التقييمات', `تاريخ التقرير: ${dateStr}`, '#06579F')}
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:20px">
<div style="background:#dbeafe;padding:14px;border-radius:10px;text-align:center"><div style="font-size:24px;font-weight:800;color:#06579F">${evals.length}</div><div style="font-size:12px;color:#475569">إجمالي التقييمات</div></div>
<div style="background:#d1fae5;padding:14px;border-radius:10px;text-align:center"><div style="font-size:24px;font-weight:800;color:#065f46">${totalAvg}%</div><div style="font-size:12px;color:#475569">متوسط الأداء</div></div>
<div style="background:#cffafe;padding:14px;border-radius:10px;text-align:center"><div style="font-size:24px;font-weight:800;color:#0e7490">${passed}</div><div style="font-size:12px;color:#475569">ناجح</div></div>
<div style="background:#fee2e2;padding:14px;border-radius:10px;text-align:center"><div style="font-size:24px;font-weight:800;color:#991b1b">${failed}</div><div style="font-size:12px;color:#475569">راسب</div></div>
</div>
<table style="width:100%;border-collapse:collapse;font-size:12px">
<thead>
<tr style="background:#06579F;color:white">
<th style="padding:10px;border:1px solid #044a87">#</th>
<th style="padding:10px;border:1px solid #044a87">الموظف</th>
<th style="padding:10px;border:1px solid #044a87">المقيِّم</th>
<th style="padding:10px;border:1px solid #044a87">التاريخ</th>
<th style="padding:10px;border:1px solid #044a87">الدرجة</th>
<th style="padding:10px;border:1px solid #044a87">النسبة</th>
<th style="padding:10px;border:1px solid #044a87">التقدير</th>
<th style="padding:10px;border:1px solid #044a87">الحالة</th>
</tr>
</thead>
<tbody>${rows || '<tr><td colspan="8" style="padding:20px;text-align:center;color:#64748b">لا توجد تقييمات</td></tr>'}</tbody>
</table>
<div style="margin-top:20px;padding:10px;text-align:center;color:#64748b;font-size:11px;border-top:1px solid #e2e8f0">
تم إنشاء هذا التقرير من نظام الجودة للتقييم والتدريب | شركة محزم - ${dateStr}
</div>`;

Toast.info('جاري إنشاء ملف PDF...');
htmlToPDF(html, `تقرير_التقييمات_${today.toISOString().substring(0,10)}.pdf`)
.then(() => Toast.success('تم تصدير ملف PDF بنجاح'))
.catch(err => { console.error(err); Toast.error('فشل التصدير: ' + err.message); });
}

function exportSinglePDF(id) {
const ev = DB.getEvaluation(id);
if (!ev) return;
const emp = DB.getUser(ev.employee_id), evr = DB.getUser(ev.evaluator_id);
const A = CRITERIA.answers;
const today = new Date();
const dateStr = `${today.getDate().toString().padStart(2,'0')}/${(today.getMonth()+1).toString().padStart(2,'0')}/${today.getFullYear()}`;

const gradeColor = ev.percentage >= 85 ? '#10b981' : '#ef4444';

const sectionsHTML = CRITERIA.sections.map(s => {
const score = (ev.section_scores && ev.section_scores[s.key] !== undefined) ? ev.section_scores[s.key] : 0;
const scoreCls = score === s.weight ? '#d1fae5;color:#065f46' : score === 0 ? '#fee2e2;color:#991b1b' : '#fef3c7;color:#92400e';
return `
<div style="margin-bottom:14px;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">
<div style="padding:10px 14px;background:#f1f5f9;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center">
<div style="font-weight:700;font-size:13px;color:#1e293b">${Utils.escape(s.title)} ${s.type === 'critical' ? '<span style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:999px;font-size:11px;margin-right:6px">حرج</span>' : ''}</div>
<span style="background:${scoreCls};padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700">${score} / ${s.weight}</span>
</div>
<div>
${s.subsections.map(sub => `
${s.subsections.length > 1 || s.type === 'non-critical' ? `<div style="padding:6px 12px;background:#dbeafe;color:#06579F;font-size:12px;font-weight:700">📁 ${Utils.escape(sub.title)} ${sub.weight ? `<span style="font-weight:400;font-size:11px;opacity:0.7">(${sub.weight} نقطة)</span>` : ''}</div>` : ''}
${sub.items.map(it => {
const ans = (ev.items && ev.items[it.key]) || A.OK;
let badge = '<span style="background:#d1fae5;color:#065f46;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700">✓ لا يوجد خطأ</span>';
if (ans === A.ERR) badge = '<span style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700">✗ يوجد خطأ</span>';
else if (ans === A.NA) badge = '<span style="background:#cffafe;color:#0e7490;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700">○ لا ينطبق</span>';
return `<div style="padding:7px 14px;border-top:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:11px">
<div style="flex:1">${Utils.escape(it.label)}</div>
<div style="white-space:nowrap">${badge}</div>
</div>`;
}).join('')}
`).join('')}
</div>
</div>`;
}).join('');

const html = `
${buildPDFHeader('📋 تقرير تقييم الجودة', `رقم التقييم: #${ev.id} - تاريخ الطباعة: ${dateStr}`, '#06579F')}

<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px">
<div style="background:#f8fafc;padding:12px;border-radius:10px;border:1px solid #e2e8f0">
<div style="font-size:11px;color:#64748b;margin-bottom:4px">الموظف المُقيَّم</div>
<div style="font-size:14px;font-weight:700;color:#1e293b">👤 ${Utils.escape(emp?emp.full_name:'-')}</div>
${emp && emp.email ? `<div style="font-size:11px;color:#64748b;margin-top:4px">${Utils.escape(emp.email)}</div>` : ''}
</div>
<div style="background:#f8fafc;padding:12px;border-radius:10px;border:1px solid #e2e8f0">
<div style="font-size:11px;color:#64748b;margin-bottom:4px">المقيِّم</div>
<div style="font-size:14px;font-weight:700;color:#1e293b">👨‍💼 ${Utils.escape(evr?evr.full_name:'-')}</div>
${evr && evr.email ? `<div style="font-size:11px;color:#64748b;margin-top:4px">${Utils.escape(evr.email)}</div>` : ''}
</div>
<div style="background:#f8fafc;padding:12px;border-radius:10px;border:1px solid #e2e8f0">
<div style="font-size:11px;color:#64748b;margin-bottom:4px">تاريخ التقييم</div>
<div style="font-size:14px;font-weight:700;color:#1e293b">📅 ${Utils.formatDate(ev.evaluation_date)}</div>
</div>
<div style="background:#f8fafc;padding:12px;border-radius:10px;border:1px solid #e2e8f0">
<div style="font-size:11px;color:#64748b;margin-bottom:4px">الملاحظة المرصودة</div>
<div style="font-size:14px;font-weight:700;color:#1e293b">🔍 ${Utils.escape(ev.observed_issue === 'أخرى' ? (ev.observed_issue_other||'أخرى') : (ev.observed_issue || ev.call_type || '-'))}</div>
</div>
<div style="background:#fffbeb;padding:12px;border-radius:10px;border:1px solid #fde68a;grid-column:span 2">
<div style="font-size:11px;color:#64748b;margin-bottom:4px">الإجراء المتخذ</div>
<div style="font-size:14px;font-weight:700;color:#92400e">⚖️ ${Utils.escape(ev.action_taken === 'أخرى' ? (ev.action_taken_other||'أخرى') : (ev.action_taken || 'لم يحدد'))}</div>
</div>
</div>

<div style="background:linear-gradient(135deg,${gradeColor},${gradeColor}dd);color:white;padding:20px;border-radius:12px;margin-bottom:14px;text-align:center">
<div style="font-size:13px;opacity:0.9;margin-bottom:4px">النتيجة النهائية</div>
<div style="font-size:42px;font-weight:800;line-height:1">${ev.percentage}%</div>
<div style="font-size:14px;margin-top:6px">${ev.total_score} / 100 نقطة - <strong>${ev.grade}</strong></div>
<div style="font-size:12px;margin-top:4px;opacity:0.9">الحالة: ${ev.status}</div>
</div>

${ev.notes ? `<div style="background:#cffafe;color:#0e7490;padding:12px;border-radius:10px;margin-bottom:14px;font-size:12px"><strong>ملاحظات:</strong> ${Utils.escape(ev.notes)}</div>` : ''}

<div style="font-size:16px;font-weight:700;color:#1e293b;margin-bottom:10px;padding:10px;background:#f1f5f9;border-radius:8px">📊 تفاصيل بنود التقييم</div>
${sectionsHTML}

<div style="margin-top:20px;padding:10px;text-align:center;color:#64748b;font-size:11px;border-top:1px solid #e2e8f0">
تم إنشاء هذا التقرير من نظام الجودة للتقييم والتدريب | شركة محزم - ${dateStr}
</div>`;

Toast.info('جاري إنشاء ملف PDF...');
const fname = `تقييم_${ev.id}_${emp?emp.full_name.replace(/\s+/g,'_'):''}.pdf`;
htmlToPDF(html, fname)
.then(() => Toast.success('تم تصدير ملف PDF بنجاح'))
.catch(err => { console.error(err); Toast.error('فشل التصدير: ' + err.message); });
}

// ============================================
// Edit Evaluation
// ============================================
function renderEditEvaluation(id) {
const ev = DB.getEvaluation(id);
if (!ev) return '<div class="alert alert-danger">التقييم غير موجود</div>';
const canEdit = currentUser.role === 'admin' || (currentUser.role === 'supervisor' && ev.evaluator_id === currentUser.id);
if (!canEdit) return '<div class="alert alert-danger">ليس لديك صلاحية لتعديل هذا التقييم</div>';

const employees = DB.getUsers({ role:'employee', active:true });
const empOpts = employees.map(e => `<option value="${e.id}" ${e.id === ev.employee_id ? 'selected' : ''}>${Utils.escape(e.full_name)}</option>`).join('');

const A = CRITERIA.answers;
const sectionsHTML = CRITERIA.sections.map(s => `
<div class="card">
<div class="card-header">
<div class="card-title">${Utils.escape(s.title)} ${s.type === 'critical' ? '<span class="badge badge-danger" style="margin-right:8px">حرج</span>' : ''}</div>
<div style="color:var(--muted);font-size:13px">${s.weight} نقطة</div>
</div>
<div class="card-body" style="padding:0">
${s.subsections.map(sub => `
${s.subsections.length > 1 || s.type === 'non-critical' ? `<div class="subsection-title">${Utils.escape(sub.title)} ${sub.weight ? `<span style="font-weight:400;font-size:12px">(${sub.weight} نقطة)</span>` : ''}</div>` : ''}
${sub.items.map(it => {
const cur = (ev.items && ev.items[it.key]) || A.OK;
return `<div class="eval-item">
<div class="eval-item-label">${Utils.escape(it.label)}</div>
<div class="eval-item-options">
<label><input type="radio" name="item-${it.key}" value="${A.OK}" ${cur===A.OK?'checked':''}> ✅ لا يوجد خطأ</label>
<label><input type="radio" name="item-${it.key}" value="${A.ERR}" ${cur===A.ERR?'checked':''}> ❌ يوجد خطأ</label>
<label><input type="radio" name="item-${it.key}" value="${A.NA}" ${cur===A.NA?'checked':''}> ⚪ لا ينطبق</label>
</div>
</div>`;
}).join('')}
`).join('')}
</div>
</div>`).join('');

return `
<div class="page-header">
<div><div class="page-title">تعديل تقييم #${ev.id}</div><div class="page-subtitle">تعديل بيانات التقييم وإعادة احتسابها</div></div>
<button class="btn btn-secondary" data-nav-eval="${ev.id}">← إلغاء</button>
</div>
<form id="edit-eval-form" data-eval-id="${ev.id}">
<div class="card">
<div class="card-header"><div class="card-title">📋 بيانات التقييم</div></div>
<div class="card-body">
<div class="grid grid-3">
<div class="form-group"><label class="form-label">الموظف *</label><select class="form-control" id="ef-employee" required>${empOpts}</select></div>
<div class="form-group"><label class="form-label">تاريخ التقييم *</label><input type="date" class="form-control" id="ef-date" required value="${ev.evaluation_date}"></div>
<div class="form-group"><label class="form-label">🔍 الملاحظة المرصودة *</label>${buildObservedIssueSelect(ev.observed_issue||'', ev.observed_issue_other||'')}</div>
</div>
<div class="form-group"><label class="form-label">ملاحظات إضافية</label><textarea class="form-control" id="ef-notes" rows="2">${Utils.escape(ev.notes||'')}</textarea></div>
</div>
</div>
${sectionsHTML}
<div class="card" style="border:2px solid var(--warning);background:#fffbeb">
<div class="card-header" style="background:#fef3c7"><div class="card-title">⚖️ الإجراء المتخذ</div></div>
<div class="card-body">
<div class="alert alert-warning" style="margin-bottom:14px;font-size:13px">⚠️ تحديد الإجراء المتخذ إلزامي قبل اعتماد التقييم</div>
<div class="form-group"><label class="form-label">الإجراء المتخذ *</label>${buildActionTakenSelect(ev.action_taken||'', ev.action_taken_other||'')}</div>
</div>
</div>
<div class="card" style="position:sticky;bottom:0;z-index:10;border:2px solid var(--warning)">
<div class="card-body">
<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:14px">
<div>
<div style="font-size:13px;color:var(--muted)">الدرجة الإجمالية</div>
<div id="live-score" style="font-size:32px;font-weight:800;color:var(--warning)">${ev.total_score} / 100</div>
<div id="live-grade">${Utils.gradeBadge(ev.percentage)}</div>
</div>
<div style="display:flex;gap:10px">
<button type="button" class="btn btn-secondary" data-nav-eval="${ev.id}">إلغاء</button>
<button type="submit" class="btn btn-warning" style="padding:12px 26px;font-size:15px">💾 حفظ التعديلات</button>
</div>
</div>
</div>
</div>
</form>`;
}

function attachEditEvalHandlers() {
const form = document.getElementById('edit-eval-form');
if (!form) return;
const evalId = parseInt(form.dataset.evalId);

const updateLive = () => {
const items = collectItems();
const r = calculateScores(items);
document.getElementById('live-score').textContent = `${r.totalScore} / 100`;
document.getElementById('live-grade').innerHTML = Utils.gradeBadge(r.percentage);
};

form.querySelectorAll('input[type=radio]').forEach(r => r.addEventListener('change', updateLive));

form.addEventListener('submit', async e => {
e.preventDefault();
const btn = form.querySelector('button[type=submit]');
await submitWithFeedback(btn, 'جاري حفظ التعديلات...', null, async () => {
const empId = parseInt(document.getElementById('ef-employee').value);
if (!empId) { Toast.error('يرجى اختيار الموظف'); return false; }
const items = collectItems();
const r = calculateScores(items);

const observed = document.getElementById('ef-observed').value;
const observedOther = (document.getElementById('ef-observed-other')||{}).value || '';
const action = document.getElementById('ef-action').value;
const actionOther = (document.getElementById('ef-action-other')||{}).value || '';

if (!observed) { Toast.error('يرجى اختيار الملاحظة المرصودة'); return false; }
if (observed === 'أخرى' && !observedOther.trim()) { Toast.error('يرجى كتابة وصف الملاحظة'); return false; }
if (!action) { Toast.error('يرجى اختيار الإجراء المتخذ'); return false; }
if (action === 'أخرى' && !actionOther.trim()) { Toast.error('يرجى كتابة وصف الإجراء'); return false; }

// تعديل عبر RPC مُصادَق — الدرجة تُعاد احتسابها على الخادم (لا نمرّر درجات)
if (window.sb && window.sb.rpc) {
const { data, error } = await window.sb.rpc('admin_update_evaluation', {
p_session_token: (window.getSessionToken ? window.getSessionToken() : null),
p_eval_id: evalId,
p_employee_id: empId,
p_evaluation_date: document.getElementById('ef-date').value,
p_observed_issue: observed,
p_observed_issue_other: observedOther.trim(),
p_action_taken: action,
p_action_taken_other: actionOther.trim(),
p_notes: document.getElementById('ef-notes').value.trim(),
p_items: items
});
const row = (!error && Array.isArray(data) && data[0]) ? data[0] : null;
if (!row || !row.ok) { const msg=(row&&row.message)||(error&&error.message)||'تعذّر حفظ التعديلات'; const h=handleSessionError(msg); if(!h) Toast.error(msg); return false; }
if (window.SupabaseSync && SupabaseSync.pullAll) { try{ await SupabaseSync.pullAll(); }catch(_){} }
Toast.success(`تم حفظ التعديلات — النتيجة المعاد احتسابها ${row.percentage}% (${row.grade})`);
} else {
// مسار محلي احتياطي
DB.updateEvaluation(evalId, {
employee_id: empId,
evaluation_date: document.getElementById('ef-date').value,
call_type: observed === 'أخرى' ? observedOther.trim() : observed,
observed_issue: observed, observed_issue_other: observedOther.trim(),
action_taken: action, action_taken_other: actionOther.trim(),
notes: document.getElementById('ef-notes').value.trim(),
items: items, section_scores: r.sectionScores, total_score: r.totalScore,
percentage: r.percentage, grade: r.grade, status: r.status
});
DB.createNotification({ user_id: empId, title: 'تم تعديل تقييمك', message: `تم تحديث تقييمك إلى ${r.percentage}% - ${r.grade}`, type: 'info' });
Toast.success(`تم حفظ التعديلات بنجاح - ${r.percentage}% (${r.grade})`);
}
if (typeof navigate === 'function') navigate('view-evaluation', { id: evalId });
return true;
});
});
}

// ============================================
// Settings Page
// ============================================
function renderSettings(activeTab) {
const tabs = [
{ key:'form', label:'📝 نموذج التقييم', icon:'📝' },
{ key:'weights', label:'🎯 النقاط والأوزان', icon:'🎯' },
{ key:'evals', label:'✏️ تعديل التقييمات', icon:'✏️' }
];
const tabsHTML = tabs.map(t => `
<button class="btn ${activeTab === t.key ? 'btn-primary' : 'btn-secondary'}" data-nav-settings="${t.key}">${t.label}</button>
`).join('');

let body = '';
if (activeTab === 'form') body = renderSettingsForm();
else if (activeTab === 'weights') body = renderSettingsWeights();
else if (activeTab === 'evals') body = renderSettingsEvals();

return `
<div class="page-header">
<div><div class="page-title">⚙️ الإعدادات</div><div class="page-subtitle">تخصيص نموذج التقييم وإدارته</div></div>
<button class="btn btn-danger" id="reset-criteria-btn">🔄 استعادة الإعدادات الافتراضية</button>
</div>
<div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap">${tabsHTML}</div>
${body}`;
}

function renderSettingsForm() {
const sectionsHTML = CRITERIA.sections.map(s => `
<div class="card">
<div class="card-header">
<div style="flex:1">
<div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:6px">${Utils.escape(s.title)} ${s.type === 'critical' ? '<span class="badge badge-danger">حرج</span>' : '<span class="badge badge-info">غير حرج</span>'}</div>
<div style="font-size:12px;color:var(--muted)">المفتاح: ${s.key} | الوزن: ${s.weight} نقطة | الأقسام الفرعية: ${s.subsections.length}</div>
</div>
<div style="display:flex;gap:8px">
<button class="btn btn-sm btn-primary" data-edit-section="${s.key}">✏️</button>
<button class="btn btn-sm btn-success" data-add-sub="${s.key}">➕ قسم فرعي</button>
${CRITERIA.sections.length > 1 ? `<button class="btn btn-sm btn-danger" data-del-section="${s.key}">🗑️</button>` : ''}
</div>
</div>
<div class="card-body" style="padding:0">
${s.subsections.map(sub => `
<div style="padding:12px 16px;border-bottom:1px solid var(--border);background:#f8fafc">
<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">
<div style="flex:1">
<div style="font-weight:700;color:var(--primary)">📁 ${Utils.escape(sub.title)} ${sub.weight ? `<span style="font-weight:400;font-size:12px;color:var(--muted)">(${sub.weight} نقطة)</span>` : ''}</div>
<div style="font-size:11px;color:var(--muted)">${sub.key} - ${sub.items.length} بند</div>
</div>
<div style="display:flex;gap:6px">
<button class="btn btn-sm btn-primary" data-edit-sub="${s.key}|${sub.key}">✏️</button>
<button class="btn btn-sm btn-success" data-add-item="${s.key}|${sub.key}">➕ بند</button>
${s.subsections.length > 1 ? `<button class="btn btn-sm btn-danger" data-del-sub="${s.key}|${sub.key}">🗑️</button>` : ''}
</div>
</div>
${sub.items.map(it => `
<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 14px;background:white;border:1px solid var(--border);border-radius:6px;margin-bottom:6px;gap:10px">
<div style="flex:1;font-size:13px">${Utils.escape(it.label)}</div>
<div style="display:flex;gap:6px">
<button class="btn btn-sm btn-primary" data-edit-item="${s.key}|${sub.key}|${it.key}">✏️</button>
${sub.items.length > 1 ? `<button class="btn btn-sm btn-danger" data-del-item="${s.key}|${sub.key}|${it.key}">🗑️</button>` : ''}
</div>
</div>`).join('')}
</div>`).join('')}
</div>
</div>`).join('');

return `
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
<div style="color:var(--muted);font-size:14px">📊 إجمالي: ${CRITERIA.sections.length} قسم | ${CRITERIA.sections.reduce((s,sec) => s + sec.subsections.length, 0)} قسم فرعي | ${CRITERIA.sections.reduce((s,sec) => s + sec.subsections.reduce((ss,sub)=>ss+sub.items.length, 0), 0)} بند</div>
<button class="btn btn-success" id="add-section-btn">➕ إضافة قسم رئيسي</button>
</div>
${sectionsHTML}`;
}

function renderSettingsWeights() {
const totalWeight = CRITERIA.sections.reduce((s,sec) => s+sec.weight, 0);
return `
<div class="alert alert-info">
ℹ️ يجب أن يكون مجموع أوزان الأقسام الرئيسية = <strong>100 نقطة</strong>. الحالي: <strong>${totalWeight}</strong>
</div>
${totalWeight !== 100 ? '<div class="alert alert-warning">⚠️ تحذير: مجموع النقاط لا يساوي 100. هذا قد يؤدي إلى نتائج غير متوقعة.</div>' : ''}
<form id="weights-form">
${CRITERIA.sections.map(s => `
<div class="card">
<div class="card-header">
<div class="card-title">${Utils.escape(s.title)}</div>
<span class="badge ${s.type === 'critical' ? 'badge-danger' : 'badge-info'}">${s.type === 'critical' ? 'حرج' : 'غير حرج'}</span>
</div>
<div class="card-body">
<div class="form-group">
<label class="form-label">وزن القسم الرئيسي (نقطة)</label>
<input type="number" step="0.5" min="0" max="100" class="form-control" name="weight-${s.key}" value="${s.weight}" required>
</div>
${s.type === 'non-critical' ? `
<div style="margin-top:14px">
<div style="font-weight:700;margin-bottom:10px;color:var(--primary)">أوزان الأقسام الفرعية:</div>
<div class="grid grid-2">
${s.subsections.map(sub => `
<div class="form-group">
<label class="form-label">${Utils.escape(sub.title)}</label>
<input type="number" step="0.5" min="0" class="form-control" name="subweight-${s.key}-${sub.key}" value="${sub.weight || 0}" required>
</div>`).join('')}
</div>
<div style="font-size:13px;color:var(--muted);margin-top:6px">مجموع الأقسام الفرعية: ${s.subsections.reduce((sum,sub)=>sum+(sub.weight||0), 0)} نقطة</div>
</div>` : ''}
</div>
</div>`).join('')}
<button type="submit" class="btn btn-primary" style="padding:12px 30px;font-size:15px">💾 حفظ الأوزان</button>
</form>`;
}

function renderSettingsEvals() {
const evals = DB.getEvaluations({});
const rows = evals.map(e => {
const emp = DB.getUser(e.employee_id);
const evr = DB.getUser(e.evaluator_id);
return `<tr>
<td>#${e.id}</td>
<td>${Utils.escape(emp?emp.full_name:'-')}</td>
<td>${Utils.escape(evr?evr.full_name:'-')}</td>
<td>${Utils.formatDate(e.evaluation_date)}</td>
<td>${e.total_score}/100</td>
<td>${Utils.gradeBadge(e.percentage)}</td>
<td>
<button class="btn btn-sm btn-primary" data-nav-eval="${e.id}">👁️ عرض</button>
<button class="btn btn-sm btn-warning" data-edit-eval="${e.id}">✏️ تعديل</button>
<button class="btn btn-sm btn-danger" data-del-eval="${e.id}">🗑️ حذف</button>
</td>
</tr>`;
}).join('');

return `
<div class="alert alert-info">ℹ️ من هنا يمكنك تعديل أو حذف أي تقييم سابق. سيتم إرسال إشعار للموظف عند تعديل تقييمه.</div>
<div class="card">
<div class="card-header"><div class="card-title">📝 جميع التقييمات (${evals.length})</div></div>
<table class="table">
<thead><tr><th>#</th><th>الموظف</th><th>المقيِّم</th><th>التاريخ</th><th>الدرجة</th><th>التقدير</th><th>إجراءات</th></tr></thead>
<tbody>${rows || '<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--muted)">لا توجد تقييمات</td></tr>'}</tbody>
</table>
</div>`;
}

// ====== Settings Modal helpers ======
function showSectionModal(editKey=null) {
const ed = editKey ? CRITERIA.sections.find(s => s.key === editKey) : null;
const body = `<form id="sec-form">
<div class="form-group"><label class="form-label">مفتاح القسم (إنجليزي بدون مسافات) *</label><input class="form-control" id="sf-key" required value="${ed?Utils.escape(ed.key):''}" ${ed?'readonly':''} placeholder="section5"></div>
<div class="form-group"><label class="form-label">عنوان القسم *</label><input class="form-control" id="sf-title" required value="${ed?Utils.escape(ed.title):''}"></div>
<div class="form-group"><label class="form-label">النوع *</label>
<select class="form-control" id="sf-type">
<option value="critical" ${ed&&ed.type==='critical'?'selected':''}>حرج (كل البنود يجب أن تكون صحيحة)</option>
<option value="non-critical" ${ed&&ed.type==='non-critical'?'selected':''}>غير حرج (محسوب بالنسبة)</option>
</select></div>
<div class="form-group"><label class="form-label">الوزن (نقطة) *</label><input type="number" step="0.5" min="0" class="form-control" id="sf-weight" required value="${ed?ed.weight:25}"></div>
</form>`;
const footer = `<button class="btn btn-secondary" onclick="Modal.close()">إلغاء</button><button class="btn btn-primary" id="sf-save">${ed?'حفظ':'إضافة'}</button>`;
Modal.show(ed?'تعديل القسم الرئيسي':'إضافة قسم رئيسي', body, footer);

document.getElementById('sf-save').addEventListener('click', async (e) => {
const btn = e.currentTarget;
await submitWithFeedback(btn, 'جاري الحفظ...', null, async () => {
const key = document.getElementById('sf-key').value.trim();
const title = document.getElementById('sf-title').value.trim();
const type = document.getElementById('sf-type').value;
const weight = parseFloat(document.getElementById('sf-weight').value);
if (!key || !title) { Toast.error('يرجى تعبئة كل الحقول'); return false; }
if (!ed && CRITERIA.sections.find(s => s.key === key)) { Toast.error('المفتاح موجود مسبقاً'); return false; }

if (ed) {
ed.title = title; ed.type = type; ed.weight = weight;
} else {
CRITERIA.sections.push({
key, title, type, weight,
subsections:[{ key:key+'_default', title:'القسم الفرعي الافتراضي', weight: type === 'non-critical' ? weight : undefined, items:[{ key:key+'_default_1', label:'بند جديد - يمكنك تعديله' }] }]
});
}
if (!(await saveCriteriaViaRPC())) return false;
Modal.close();
Toast.success('تم الحفظ');
if (typeof navigate === 'function') navigate('settings', { tab:'form' });
return true;
});
});
}

function showSubsectionModal(sectionKey, editKey=null) {
const sec = CRITERIA.sections.find(s => s.key === sectionKey);
if (!sec) return;
const ed = editKey ? sec.subsections.find(sub => sub.key === editKey) : null;
const isNonCritical = sec.type === 'non-critical';
const body = `<form id="sub-form">
<div class="form-group"><label class="form-label">مفتاح القسم الفرعي *</label><input class="form-control" id="sbf-key" required value="${ed?Utils.escape(ed.key):''}" ${ed?'readonly':''}></div>
<div class="form-group"><label class="form-label">العنوان *</label><input class="form-control" id="sbf-title" required value="${ed?Utils.escape(ed.title):''}"></div>
${isNonCritical ? `<div class="form-group"><label class="form-label">الوزن (نقطة) *</label><input type="number" step="0.5" min="0" class="form-control" id="sbf-weight" required value="${ed?(ed.weight||0):0}"></div>` : ''}
</form>`;
const footer = `<button class="btn btn-secondary" onclick="Modal.close()">إلغاء</button><button class="btn btn-primary" id="sbf-save">${ed?'حفظ':'إضافة'}</button>`;
Modal.show(ed?'تعديل القسم الفرعي':'إضافة قسم فرعي', body, footer);

document.getElementById('sbf-save').addEventListener('click', async (e) => {
const btn = e.currentTarget;
await submitWithFeedback(btn, 'جاري الحفظ...', null, async () => {
const key = document.getElementById('sbf-key').value.trim();
const title = document.getElementById('sbf-title').value.trim();
const weight = isNonCritical ? parseFloat(document.getElementById('sbf-weight').value) : undefined;
if (!key || !title) { Toast.error('يرجى تعبئة كل الحقول'); return false; }
if (!ed && sec.subsections.find(sub => sub.key === key)) { Toast.error('المفتاح موجود مسبقاً'); return false; }

if (ed) {
ed.title = title;
if (isNonCritical) ed.weight = weight;
} else {
sec.subsections.push({ key, title, weight, items:[{ key:key+'_1', label:'بند جديد - يمكنك تعديله' }] });
}
if (!(await saveCriteriaViaRPC())) return false;
Modal.close();
Toast.success('تم الحفظ');
if (typeof navigate === 'function') navigate('settings', { tab:'form' });
return true;
});
});
}

function showItemModal(sectionKey, subKey, editKey=null) {
const sec = CRITERIA.sections.find(s => s.key === sectionKey);
const sub = sec && sec.subsections.find(x => x.key === subKey);
if (!sub) return;
const ed = editKey ? sub.items.find(i => i.key === editKey) : null;
const body = `<form id="item-form">
<div class="form-group"><label class="form-label">مفتاح البند *</label><input class="form-control" id="itf-key" required value="${ed?Utils.escape(ed.key):''}" ${ed?'readonly':''}></div>
<div class="form-group"><label class="form-label">نص البند *</label><textarea class="form-control" id="itf-label" rows="3" required>${ed?Utils.escape(ed.label):''}</textarea></div>
</form>`;
const footer = `<button class="btn btn-secondary" onclick="Modal.close()">إلغاء</button><button class="btn btn-primary" id="itf-save">${ed?'حفظ':'إضافة'}</button>`;
Modal.show(ed?'تعديل البند':'إضافة بند جديد', body, footer);

document.getElementById('itf-save').addEventListener('click', async (e) => {
const btn = e.currentTarget;
await submitWithFeedback(btn, 'جاري الحفظ...', null, async () => {
const key = document.getElementById('itf-key').value.trim();
const label = document.getElementById('itf-label').value.trim();
if (!key || !label) { Toast.error('يرجى تعبئة كل الحقول'); return false; }
if (!ed && sub.items.find(i => i.key === key)) { Toast.error('المفتاح موجود مسبقاً'); return false; }

if (ed) {
ed.label = label;
} else {
sub.items.push({ key, label });
}
if (!(await saveCriteriaViaRPC())) return false;
Modal.close();
Toast.success('تم الحفظ');
if (typeof navigate === 'function') navigate('settings', { tab:'form' });
return true;
});
});
}

function attachSettingsHandlers(tab) {
document.querySelectorAll('[data-nav-settings]').forEach(b => {
b.addEventListener('click', () => navigate('settings', { tab: b.dataset.navSettings }));
});

const reset = document.getElementById('reset-criteria-btn');
if (reset) reset.addEventListener('click', async (e) => {
if (!confirm('سيتم إعادة جميع الإعدادات إلى القيم الافتراضية. هل أنت متأكد؟')) return;
const btn = e.currentTarget;
await submitWithFeedback(btn, 'جاري الاستعادة...', null, async () => {
DB.resetCriteria(); if (!(await saveCriteriaViaRPC())) return false;
Toast.success('تمت استعادة الإعدادات الافتراضية');
if (typeof navigate === 'function') navigate('settings', { tab: 'form' });
return true;
});
});

if (tab === 'form') {
const addSecBtn = document.getElementById('add-section-btn');
if (addSecBtn) addSecBtn.addEventListener('click', () => showSectionModal());

document.querySelectorAll('[data-edit-section]').forEach(b => b.addEventListener('click', () => showSectionModal(b.dataset.editSection)));
document.querySelectorAll('[data-del-section]').forEach(b => b.addEventListener('click', async (e) => {
if (!confirm('سيتم حذف القسم وجميع بنوده. هل أنت متأكد؟')) return;
const btn = e.currentTarget;
await submitWithFeedback(btn, 'جاري الحذف...', null, async () => {
CRITERIA.sections = CRITERIA.sections.filter(s => s.key !== b.dataset.delSection);
if (!(await saveCriteriaViaRPC())) return false;
Toast.success('تم الحذف');
if (typeof navigate === 'function') navigate('settings', { tab:'form' });
return true;
});
}));
document.querySelectorAll('[data-add-sub]').forEach(b => b.addEventListener('click', () => showSubsectionModal(b.dataset.addSub)));
document.querySelectorAll('[data-edit-sub]').forEach(b => b.addEventListener('click', () => {
const [sk, subk] = b.dataset.editSub.split('|');
showSubsectionModal(sk, subk);
}));
document.querySelectorAll('[data-del-sub]').forEach(b => b.addEventListener('click', async (e) => {
const [sk, subk] = b.dataset.delSub.split('|');
if (!confirm('سيتم حذف القسم الفرعي وجميع بنوده. هل أنت متأكد؟')) return;
const btn = e.currentTarget;
await submitWithFeedback(btn, 'جاري الحذف...', null, async () => {
const s = CRITERIA.sections.find(x => x.key === sk);
s.subsections = s.subsections.filter(x => x.key !== subk);
if (!(await saveCriteriaViaRPC())) return false;
Toast.success('تم الحذف');
if (typeof navigate === 'function') navigate('settings', { tab:'form' });
return true;
});
}));
document.querySelectorAll('[data-add-item]').forEach(b => b.addEventListener('click', () => {
const [sk, subk] = b.dataset.addItem.split('|');
showItemModal(sk, subk);
}));
document.querySelectorAll('[data-edit-item]').forEach(b => b.addEventListener('click', () => {
const [sk, subk, itk] = b.dataset.editItem.split('|');
showItemModal(sk, subk, itk);
}));
document.querySelectorAll('[data-del-item]').forEach(b => b.addEventListener('click', async (e) => {
const [sk, subk, itk] = b.dataset.delItem.split('|');
if (!confirm('هل تريد حذف هذا البند؟')) return;
const btn = e.currentTarget;
await submitWithFeedback(btn, 'جاري الحذف...', null, async () => {
const s = CRITERIA.sections.find(x => x.key === sk);
const sub = s.subsections.find(x => x.key === subk);
sub.items = sub.items.filter(i => i.key !== itk);
if (!(await saveCriteriaViaRPC())) return false;
Toast.success('تم الحذف');
if (typeof navigate === 'function') navigate('settings', { tab:'form' });
return true;
});
}));
}

if (tab === 'weights') {
const form = document.getElementById('weights-form');
if (form) form.addEventListener('submit', async e => {
e.preventDefault();
const btn = form.querySelector('button[type=submit]');
await submitWithFeedback(btn, 'جاري الحفظ...', null, async () => {
const fd = new FormData(form);
CRITERIA.sections.forEach(s => {
const w = parseFloat(fd.get('weight-' + s.key));
if (!isNaN(w)) s.weight = w;
if (s.type === 'non-critical') {
s.subsections.forEach(sub => {
const sw = parseFloat(fd.get(`subweight-${s.key}-${sub.key}`));
if (!isNaN(sw)) sub.weight = sw;
});
}
});
if (!(await saveCriteriaViaRPC())) return false;
Toast.success('تم حفظ الأوزان');
if (typeof navigate === 'function') navigate('settings', { tab:'weights' });
return true;
});
});
}

if (tab === 'evals') {
document.querySelectorAll('[data-nav-eval]').forEach(b => b.addEventListener('click', e => {
e.stopPropagation();
navigate('view-evaluation', { id: parseInt(b.dataset.navEval) });
}));
document.querySelectorAll('[data-edit-eval]').forEach(b => b.addEventListener('click', e => {
e.stopPropagation();
navigate('edit-evaluation', { id: parseInt(b.dataset.editEval) });
}));
document.querySelectorAll('[data-del-eval]').forEach(b => b.addEventListener('click', async e => {
e.stopPropagation();
await handleDeleteEval(b, 'settings', { tab:'evals' });
}));
}
}

// ============================================
// Page Handlers
// ============================================
function attachPageHandlers(page) {
document.querySelectorAll('[data-nav-eval]').forEach(el => {
el.addEventListener('click', e => {
if (e.target.dataset && (e.target.dataset.delEval || e.target.dataset.viewEmp)) return;
navigate('view-evaluation', { id: parseInt(el.dataset.navEval) });
});
});

// Navigation: data-view-emp works globally (dashboard, employees, KPIs)
document.querySelectorAll('[data-view-emp]').forEach(el => {
el.addEventListener('click', e => { e.stopPropagation(); navigate('view-employee', { id: parseInt(el.dataset.viewEmp) }); });
});

// Navigation: objections / new-objection
document.querySelectorAll('[data-nav-obj]').forEach(el => {
el.addEventListener('click', e => { e.stopPropagation(); navigate('view-objection', { id: parseInt(el.dataset.navObj) }); });
});
document.querySelectorAll('[data-view-obj]').forEach(el => {
el.addEventListener('click', e => { e.stopPropagation(); navigate('view-objection', { id: parseInt(el.dataset.viewObj) }); });
});
document.querySelectorAll('[data-nav-newobj]').forEach(el => {
el.addEventListener('click', e => { e.stopPropagation(); navigate('new-objection', { evaluation_id: parseInt(el.dataset.navNewobj) }); });
});

if (page === 'dashboard') renderDashboardCharts();
if (page === 'reports') renderReportsCharts();
if (page === 'monthly-report') renderMonthlyReportCharts();
if (page === 'actions-report') renderActionsReportCharts();
if (page === 'errors-report') renderErrorsReportCharts();
if (page === 'profile') attachProfileHandlers();
if (page === 'new-evaluation') attachNewEvalHandlers();
if (page === 'edit-evaluation') attachEditEvalHandlers();
if (page === 'settings') attachSettingsHandlers(currentParams.tab || 'form');
if (page === 'new-objection') attachNewObjectionHandlers(currentParams.evaluation_id);
if (page === 'view-objection') attachObjectionHandlers(currentParams.id);

// approve evaluation button
const apprBtn = document.getElementById('approve-eval-btn');
if (apprBtn) apprBtn.addEventListener('click', async (e) => {
const btn = e.currentTarget;
await submitWithFeedback(btn, 'جاري الاعتماد...', null, async () => {
const id = parseInt(currentParams.id);
if (window.sb && window.sb.rpc) {
const { data, error } = await window.sb.rpc('approve_evaluation', {
p_session_token: (window.getSessionToken ? window.getSessionToken() : null), p_eval_id: id
});
const row = (!error && Array.isArray(data) && data[0]) ? data[0] : null;
if (!row || !row.ok) { const msg=(row&&row.message)||(error&&error.message)||'تعذّر الاعتماد'; const h=handleSessionError(msg); if(!h) Toast.error(msg); return false; }
if (window.SupabaseSync && SupabaseSync.pullAll) { try{ await SupabaseSync.pullAll(); }catch(_){} }
try { const ev=DB.getEvaluation(id); if (ev && window.EmailService) window.EmailService.sendApprovalEmail(ev).catch(()=>{}); } catch(_){}
} else {
DB.approveEvaluation(id);
}
Toast.success('تم اعتماد التقييم');
if (typeof navigate === 'function') navigate('view-evaluation', { id: id });
return true;
});
});

// Supervisor action button
const supBtn = document.getElementById('sup-action-btn');
if (supBtn) supBtn.addEventListener('click', () => showSupervisorActionModal(parseInt(currentParams.id)));
const supBtn2 = document.getElementById('sup-action-empty-btn');
if (supBtn2) supBtn2.addEventListener('click', () => showSupervisorActionModal(parseInt(currentParams.id)));

if (page === 'objections') {
const filterObj = () => {
const status = document.getElementById('obj-filter-status')?.value || '';
const ref = (document.getElementById('obj-filter-ref')?.value || '').trim().toLowerCase();
const name = (document.getElementById('obj-filter-name')?.value || '').trim().toLowerCase();
document.querySelectorAll('#obj-table tbody tr').forEach(tr => {
const cells = tr.querySelectorAll('td');
if (cells.length < 5) return;
const rRef = (cells[0].textContent || '').toLowerCase();
const rName = (cells[1].textContent || '').toLowerCase();
const rStatus = (cells[4].textContent || '');
const okS = !status || (status==='pending' && rStatus.includes('انتظار')) || (status==='under_review' && rStatus.includes('مراجعة')) || (status==='accepted' && rStatus.includes('مقبول')) || (status==='rejected' && rStatus.includes('مرفوض'));
const okR = !ref || rRef.includes(ref);
const okN = !name || rName.includes(name);
tr.style.display = (okS && okR && okN) ? '' : 'none';
});
};
document.querySelectorAll('.obj-filter').forEach(el => el.addEventListener('input', filterObj));
document.querySelectorAll('.obj-filter').forEach(el => el.addEventListener('change', filterObj));
}

if (page === 'users') {
const s = document.getElementById('user-search');
if (s) s.addEventListener('input', () => {
const q = s.value.toLowerCase();
document.querySelectorAll('#users-table tbody tr').forEach(tr => {
tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
});
});
const addBtn = document.getElementById('add-user-btn');
if (addBtn) addBtn.addEventListener('click', () => showUserModal());
document.querySelectorAll('[data-edit-user]').forEach(b => b.addEventListener('click', e => {
e.stopPropagation();
showUserModal(parseInt(b.dataset.editUser));
}));
document.querySelectorAll('[data-reset-pw]').forEach(b => b.addEventListener('click', e => {
e.stopPropagation();
showResetPasswordModal(parseInt(b.dataset.resetPw));
}));
document.querySelectorAll('[data-deact-user]').forEach(b => b.addEventListener('click', async e => {
e.stopPropagation();
const btn = b;
const id = parseInt(b.dataset.deactUser);
const u = DB.getUser(id);
if (!u) return;
if (id === currentUser.id) { Toast.error('لا يمكنك تعطيل حسابك'); return; }
if (!confirm(`هل تريد تعطيل حساب: ${u.full_name}؟`)) return;
await submitWithFeedback(btn, 'جاري التعطيل...', null, async () => {
if (window.sb && window.sb.rpc) {
const { data, error } = await window.sb.rpc('admin_set_user_active', { p_session_token: (window.getSessionToken?window.getSessionToken():null), p_user_id: id, p_active: false });
const row = (!error && Array.isArray(data) && data[0]) ? data[0] : null;
if (!row || !row.ok) { const msg=(row&&row.message)||(error&&error.message)||'تعذّر التعطيل'; const h=handleSessionError(msg); if(!h) Toast.error(msg); return false; }
if (window.SupabaseSync && SupabaseSync.pullAll) { try{ await SupabaseSync.pullAll(); }catch(_){} }
} else { DB.deactivateUser(id); }
Toast.success('تم تعطيل المستخدم');
if (typeof navigate === 'function') navigate('users');
return true;
});
}));
}

if (page === 'errors-report') {
const apply = () => {
const month = document.getElementById('er-month')?.value;
const dept = document.getElementById('er-dept')?.value;
const sup = document.getElementById('er-sup')?.value;
const params = {};
if (month) params.month = month;
if (dept) params.dept = dept;
if (sup) params.sup = sup;
navigate('errors-report', params);
};
document.querySelectorAll('.er-filter').forEach(el => el.addEventListener('change', apply));
const clr = document.getElementById('er-clear');
if (clr) clr.addEventListener('click', () => navigate('errors-report', {}));
const xls = document.getElementById('er-export-xlsx');
if (xls) xls.addEventListener('click', exportErrorsReportXLSX);
const pdf = document.getElementById('er-export-pdf');
if (pdf) pdf.addEventListener('click', exportErrorsReportPDF);
}

if (page === 'actions-report') {
const s = document.getElementById('ar-search');
if (s) s.addEventListener('input', () => {
const q = s.value.toLowerCase();
document.querySelectorAll('#ar-table tbody tr').forEach(tr => {
tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
});
});
const xls = document.getElementById('ar-export-xlsx');
if (xls) xls.addEventListener('click', exportActionsReportXLSX);
const pdf = document.getElementById('ar-export-pdf');
if (pdf) pdf.addEventListener('click', exportActionsReportPDF);
}

if (page === 'audit-log') {
const s = document.getElementById('audit-search');
if (s) s.addEventListener('input', () => {
const q = s.value.toLowerCase();
document.querySelectorAll('#audit-table tbody tr').forEach(tr => {
tr.style.display = (tr.dataset.search || '').toLowerCase().includes(q) ? '' : 'none';
});
});
const exp = document.getElementById('audit-export');
if (exp) exp.addEventListener('click', exportAuditLogXLSX);
}

// زر تعديل التقييم - عام لكل الصفحات
document.querySelectorAll('[data-edit-eval]').forEach(b => b.addEventListener('click', e => {
e.stopPropagation();
navigate('edit-evaluation', { id: parseInt(b.dataset.editEval) });
}));

if (page === 'employees') {
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
const okName = !qn || name.includes(qn);
const okNum = !qnum || num.includes(qnum);
const okSup = !qsup || sup === qsup;
const okDept = !qdept || dept === qdept;
const okStatus = !qstatus || status === qstatus;
tr.style.display = (okName && okNum && okSup && okDept && okStatus) ? '' : 'none';
});
};
document.querySelectorAll('.emp-filter').forEach(inp => {
inp.addEventListener('input', filterEmps);
inp.addEventListener('change', filterEmps);
});
const clrEmp = document.getElementById('emp-clear');
if (clrEmp) clrEmp.addEventListener('click', () => {
['emp-search-name','emp-search-num','emp-search-sup','emp-search-dept','emp-search-status'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
filterEmps();
});
document.querySelectorAll('[data-view-emp]').forEach(b => b.addEventListener('click', e => {
e.stopPropagation();
navigate('view-employee', { id: parseInt(b.dataset.viewEmp) });
}));
document.querySelectorAll('[data-edit-emp]').forEach(b => b.addEventListener('click', e => {
e.stopPropagation();
showEmployeeModal(parseInt(b.dataset.editEmp));
}));
document.querySelectorAll('[data-reset-pw]').forEach(b => b.addEventListener('click', e => {
e.stopPropagation();
showResetPasswordModal(parseInt(b.dataset.resetPw));
}));
const addBtn = document.getElementById('add-emp-btn');
if (addBtn) addBtn.addEventListener('click', () => showEmployeeModal());
}

if (page === 'monthly-report') {
const filterMR = () => {
const qn = (document.getElementById('mr-search-name')?.value || '').trim().toLowerCase();
const qnum = (document.getElementById('mr-search-num')?.value || '').trim().toLowerCase();
const qsup = (document.getElementById('mr-search-sup')?.value || '').trim().toLowerCase();
document.querySelectorAll('#mr-table tbody tr').forEach(tr => {
const cells = tr.querySelectorAll('td');
if (cells.length < 4) return;
const num = (cells[0].textContent || '').toLowerCase();
const name = (cells[1].textContent || '').toLowerCase();
const sup = (cells[3].textContent || '').toLowerCase();
const okName = !qn || name.includes(qn);
const okNum = !qnum || num.includes(qnum);
const okSup = !qsup || sup.includes(qsup);
tr.style.display = (okName && okNum && okSup) ? '' : 'none';
});
};
document.querySelectorAll('.mr-filter').forEach(inp => inp.addEventListener('input', filterMR));
const monthSel = document.getElementById('mr-month');
if (monthSel) monthSel.addEventListener('change', () => navigate('monthly-report', { month: monthSel.value }));
const xlsBtn = document.getElementById('mr-export-xlsx');
if (xlsBtn) xlsBtn.addEventListener('click', exportMonthlyReportXLSX);
const pdfBtn = document.getElementById('mr-export-pdf');
if (pdfBtn) pdfBtn.addEventListener('click', exportMonthlyReportPDF);
}

if (page === 'evaluations') {
const s = document.getElementById('eval-search');
if (s) s.addEventListener('input', () => {
const q = s.value.toLowerCase();
document.querySelectorAll('#eval-table tbody tr').forEach(tr => {
tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
});
});
document.querySelectorAll('[data-del-eval]').forEach(b => b.addEventListener('click', async e => {
e.stopPropagation();
await handleDeleteEval(b, 'evaluations');
}));
const xls = document.getElementById('exp-xlsx');
if (xls) xls.addEventListener('click', exportListXLSX);
const pdf = document.getElementById('exp-pdf');
if (pdf) pdf.addEventListener('click', exportListPDF);
}

if (page === 'view-evaluation') {
const xls = document.getElementById('single-xlsx');
if (xls) xls.addEventListener('click', () => exportSingleXLSX(currentParams.id));
const pdf = document.getElementById('single-pdf');
if (pdf) pdf.addEventListener('click', () => exportSinglePDF(currentParams.id));
}

if (page === 'reports') {
const xlsBtn = document.getElementById('rep-export-xlsx');
if (xlsBtn) xlsBtn.addEventListener('click', exportReportsXLSX);
const pdfBtn = document.getElementById('rep-export-pdf');
if (pdfBtn) pdfBtn.addEventListener('click', exportReportsPDF);

const applyRepFilters = () => {
const period = document.getElementById('rep-period')?.value || 'all';
const params = { period };
if (period === 'year') params.year = document.getElementById('rep-year')?.value;
if (period === 'month') params.month = document.getElementById('rep-month')?.value;
if (period === 'custom') { params.from = document.getElementById('rep-from')?.value; params.to = document.getElementById('rep-to')?.value; }
const d = document.getElementById('rep-dept')?.value; if (d) params.dept = d;
const s = document.getElementById('rep-sup')?.value; if (s) params.sup = s;
navigate('reports', params);
};
document.querySelectorAll('.rep-filter').forEach(el => el.addEventListener('change', applyRepFilters));
const clrBtn = document.getElementById('rep-clear');
if (clrBtn) clrBtn.addEventListener('click', () => navigate('reports', {}));
}
}

// ============================================
