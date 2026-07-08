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
const PAGE_TITLES = {dashboard:'لوحة التحكم', employees:'إدارة الموظفين', 'view-employee':'بيانات الموظف', evaluations:'التقييمات', 'new-evaluation':'تقييم جديد', 'cg-week':'أسبوع Creative Gene', 'cg-objections':'اعتراضات Creative Gene', 'cg-my-team':'موظفوني — Creative Gene', 'cg-frequent-errors':'المعايير الأدنى أداءً — Creative Gene', 'cg-actions-report':'تقرير الإجراءات — Creative Gene', 'cg-upload':'رفع تقييم جديد', 'cg-requests':'طلبات التقييم — Creative Gene', 'cg-pending-approval':'بانتظار الاعتماد — Creative Gene', 'view-evaluation':'تفاصيل التقييم', 'edit-evaluation':'تعديل التقييم', reports:'التقارير', 'monthly-report':'التقرير الشهري', 'actions-report':'تقرير الإجراءات المتخذة', 'errors-report':'الأخطاء المتكررة الشهرية', objections:'الاعتراضات', 'view-objection':'تفاصيل الاعتراض', 'new-objection':'تقديم اعتراض', 'audit-log':'سجل العمليات', 'quality-report':'تقرير الجودة', users:'إدارة المستخدمين', profile:'الملف الشخصي', notifications:'الإشعارات', settings:'الإعدادات', login:'تسجيل الدخول'};

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
'new-evaluation': () => renderNewEvaluation(params.dept),
'cg-week': () => renderCgWeek(params.week),
'cg-objections': renderCgObjections,
'cg-my-team': renderCgMyTeam,
'cg-frequent-errors': renderCgFrequentErrors,
'cg-actions-report': renderCgActionsReport,
'cg-upload': renderCgUpload,
'cg-requests': () => renderCgRequests(),
'cg-pending-approval': renderCgPending,
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
'quality-report': renderQualityReport,
'users': renderUsersAdmin,
'departments': () => renderDepartments(params.tab || 'depts', params.dept),
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
const ok = await SupabaseSync.pullAll(true);
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

// معرّف قسم محزم (section_based) — من الأقسام المُحمّلة، مع احتياط 2
function mahzamDeptId() {
const list = window._departments || [];
const d = list.find(x => x.template_type === 'section_based') || list.find(x => x.code === 'mahzam');
return d ? d.id : 2;
}
// حفظ نموذج بنود محزم عبر upsert_evaluation_template (المصدر الوحيد للحقيقة) — يُرجع true عند النجاح
async function saveCriteriaViaRPC() {
if (window.sb && window.sb.rpc) {
try { await loadDepartments(); } catch(_){}
const { data, error } = await window.sb.rpc('upsert_evaluation_template', {
p_session_token: (window.getSessionToken ? window.getSessionToken() : null),
p_department_id: mahzamDeptId(),
p_template: CRITERIA,
p_template_type: 'section_based'
});
const row = (!error && Array.isArray(data) && data[0]) ? data[0] : (data || null);
if (!row || !row.ok) { const msg=(row&&row.message)||(error&&error.message)||'تعذّر حفظ المعايير'; const h=handleSessionError(msg); if(!h) Toast.error(msg); return false; }
// مزامنة الحالة المحلية + إبطال كاش النموذج
try { DB.data.criteria = CRITERIA; localStorage.setItem(DB.KEY || 'qe_system_v6', JSON.stringify(DB.data)); } catch(_){}
try { if (window._templates) delete window._templates[mahzamDeptId()]; } catch(_){}
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
if (window.SupabaseSync && SupabaseSync.pullAll) { try{ await SupabaseSync.pullAll(true); }catch(_){} }
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
currentUser = { id:u.id, username:u.username, full_name:u.full_name, role:u.role, email:u.email, department_id:(u.department_id!=null?u.department_id:null), job_role:(u.job_role||null), supervisor_id:(u.supervisor_id!=null?u.supervisor_id:null) };
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
window._openSections = window._openSections || {};
function buildSidebarMenu() {
const role = currentUser.role;
const mId = mahzamDeptId(), cId = cgDeptId();
// مصدر القسم الموثوق: سجل المستخدم المُزامَن (users) ثم currentUser — لأن currentUser قد يُستعاد بلا department_id
const _me = (typeof DB !== 'undefined' && DB.getUser) ? DB.getUser(currentUser.id) : null;
const myDeptId = (_me && _me.department_id != null) ? _me.department_id : (currentUser.department_id != null ? currentUser.department_id : null);
if (myDeptId != null) currentUser.department_id = myDeptId; // ثبّته لبقية الجلسة (بطاقة الأسبوع...)
// قائمة مبسّطة للموظف
if (role === 'employee') {
const it = (page,icon,label) => `<div class="menu-item ${currentPage===page?'active':''}" data-nav="${page}"><span>${icon}</span><span>${label}</span></div>`;
// "رفع التقييم" لموظفي Creative Gene فقط (على أساس department_id لا الاسم)
const isCgEmp = (myDeptId != null) && (myDeptId === cId || isCreativeGeneDept(myDeptId));
const cgUp = isCgEmp ? it('cg-upload','📤','رفع تقييم') : '';
return it('dashboard','🏠','الرئيسية') + cgUp + it('evaluations','📋','تقييماتي') + it('objections','⚖️','اعتراضاتي') + it('profile','👤','حسابي');
}
const sections = [
{ key:'mahzam', label:'محزم', icon:'📊', color:'#1976d2', dept:mId, items:[
{icon:'📋', label:'التقييمات', nav:'evaluations', params:{dept:mId}},
{icon:'⚖️', label:'الاعتراضات', nav:'objections', params:{}},
{icon:'⚠️', label:'الأخطاء المتكررة', nav:'errors-report', params:{}},
{icon:'📝', label:'تقرير الإجراءات', nav:'actions-report', params:{}},
{icon:'📈', label:'التقارير', nav:'reports', params:{reportTab:'mahzam'}},
{icon:'📅', label:'التقرير الشهري', nav:'monthly-report', params:{dept:mId}} ]},
{ key:'cg', label:'Creative Gene', icon:'🎨', color:'#7b1fa2', dept:cId, items:[
{icon:'📥', label:'طلبات التقييم', nav:'cg-requests', params:{}, roles:['admin','quality_officer']},
{icon:'✅', label:'بانتظار الاعتماد', nav:'cg-pending-approval', params:{}, roles:['admin','supervisor']},
{icon:'📋', label:'التقييمات', nav:'evaluations', params:{dept:cId}},
{icon:'⚖️', label:'الاعتراضات', nav:'cg-objections', params:{}, roles:['admin','quality_officer']},
{icon:'⚠️', label:'المعايير الأدنى أداءً', nav:'cg-frequent-errors', params:{}},
{icon:'📝', label:'تقرير الإجراءات', nav:'cg-actions-report', params:{}},
{icon:'📈', label:'التقارير', nav:'reports', params:{reportTab:'cg'}},
{icon:'📅', label:'التقرير الشهري', nav:'monthly-report', params:{dept:cId}} ]}
];
const itemActive = (it) => {
if (currentPage !== it.nav) return false;
if (it.params.dept != null) return String(currentParams.dept) === String(it.params.dept);
if (it.params.reportTab) return (currentParams.reportTab||'mahzam') === it.params.reportTab;
return true;
};
let supDepts = null;
if (role === 'supervisor') supDepts = new Set(DB.getUsers({role:'employee'}).filter(e => e.supervisor_id===currentUser.id || e.supervisor_name===currentUser.full_name).map(e => e.department_id));
let html = `<div class="menu-item ${currentPage==='dashboard'?'active':''}" data-nav="dashboard"><span>🏠</span><span>الرئيسية</span></div>`;
sections.forEach(sec => {
if (role === 'supervisor' && supDepts && !supDepts.has(sec.dept)) return;
const isOpen = sec.items.some(itemActive) || window._openSections[sec.key];
const itemsHTML = sec.items.filter(it => !it.roles || it.roles.indexOf(role) !== -1).map(it => `<div class="menu-item ${itemActive(it)?'active':''}" data-nav="${it.nav}" data-navparams='${JSON.stringify(it.params)}' style="padding-right:38px;font-size:13px;${itemActive(it)?'background:'+sec.color+'22;border-right:3px solid '+sec.color:''}"><span>${it.icon}</span><span>${it.label}</span></div>`).join('');
html += `<div class="menu-section" data-section="${sec.key}">
<div class="menu-item" data-section-toggle="${sec.key}" style="font-weight:700;border-right:3px solid ${sec.color};cursor:pointer"><span>${sec.icon}</span><span style="flex:1">${sec.label}</span><span class="sec-caret" style="display:inline-block;transition:.2s;${isOpen?'':'transform:rotate(-90deg)'}">▾</span></div>
<div class="section-items" style="${isOpen?'':'display:none'}">${itemsHTML}</div>
</div>`;
});
const bottom = [];
if (role==='admin' || role==='quality_officer') bottom.push(['quality-report','📊','تقرير الجودة']);
if (role==='admin' || role==='quality_officer') bottom.push(['departments','⚙️','الأقسام والنماذج']);
bottom.push(['employees','👥','إدارة الموظفين']);
if (role==='admin' || role==='quality_officer') bottom.push(['users','🛡️','إدارة المستخدمين']);
if (role==='admin' || role==='quality_officer') bottom.push(['audit-log','📜','سجل العمليات']);
bottom.push(['profile','👤','حسابي']);
html += `<div style="margin:12px;border-top:1px solid rgba(255,255,255,0.12)"></div>`;
html += bottom.map(([k,ic,lb]) => `<div class="menu-item ${currentPage===k?'active':''}" data-nav="${k}"><span>${ic}</span><span>${lb}</span></div>`).join('');
return html;
}
function renderLayout(content) {
const menuHTML = buildSidebarMenu();

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
el.addEventListener('click', () => { let p; try { p = el.dataset.navparams ? JSON.parse(el.dataset.navparams) : undefined; } catch(_){} navigateToSection(el.dataset.nav, p); });
});
// طيّ/فتح الأقسام الرئيسية (محزم / Creative Gene)
document.querySelectorAll('[data-section-toggle]').forEach(el => {
if (el.dataset.bound === '1') return;
el.dataset.bound = '1';
el.addEventListener('click', () => {
const key = el.dataset.sectionToggle;
const wrap = el.closest('.menu-section');
const items = wrap ? wrap.querySelector('.section-items') : null;
const caret = el.querySelector('.sec-caret');
const nowOpen = items && items.style.display === 'none';
if (items) items.style.display = nowOpen ? '' : 'none';
if (caret) caret.style.transform = nowOpen ? '' : 'rotate(-90deg)';
window._openSections[key] = nowOpen;
});
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

const quickAction = dashQuickAction();
return `
${welcomeBanner}
${quickAction}
${currentUser.role === 'admin' ? cgNoSupervisorCardHTML() : ''}
<div id="dash-body"><div class="card"><div class="card-body" style="text-align:center;padding:44px"><div class="spinner"></div><div style="margin-top:12px;color:var(--muted)">جارٍ تحميل الإحصائيات…</div></div></div></div>`;
}

// زر سريع لأهم شاشة حسب الدور
function dashQuickAction() {
const role = currentUser.role;
let target, label, icon, color;
if (role === 'quality_officer') { target = 'cg-requests'; label = 'الطلبات المفتوحة'; icon = '📥'; color = '#7b1fa2'; }
else if (role === 'supervisor') { target = 'cg-pending-approval'; label = 'بانتظار الاعتماد'; icon = '✅'; color = '#f59e0b'; }
else if (role === 'employee') { return ''; }
else { target = 'cg-requests'; label = 'طلبات التقييم'; icon = '📥'; color = '#06579F'; }
return `<div style="margin-bottom:20px"><button class="btn" style="background:${color};color:#fff;padding:12px 22px;font-size:15px;box-shadow:0 4px 14px ${color}44" data-nav="${target}">${icon} ${label} ←</button></div>`;
}

// ألوان القسمين
const DASH_SECTIONS = { mahzam: { name:'محزم', icon:'📊', color:'#1976d2', soft:'#e3f2fd' }, cg: { name:'Creative Gene', icon:'🎨', color:'#7b1fa2', soft:'#f3e5f5' } };
function timeAgo(iso) {
try { const d = new Date(iso), now = new Date(), sec = Math.floor((now - d)/1000);
if (sec < 60) return 'الآن'; const min = Math.floor(sec/60); if (min < 60) return `قبل ${min} دقيقة`;
const hr = Math.floor(min/60); if (hr < 24) return `قبل ${hr} ساعة`; const day = Math.floor(hr/24);
if (day === 1) return 'أمس'; if (day < 7) return `قبل ${day} أيام`; return d.toLocaleDateString('ar-SA'); } catch(_) { return ''; }
}
function activityIcon(action) {
const a = action || '';
if (a.indexOf('create_eval') !== -1 || a === 'create_evaluation') return ['📝','#3b82f6'];
if (a.indexOf('objection') !== -1) return ['⚖️','#f59e0b'];
if (a.indexOf('take_action') !== -1 || a.indexOf('approve') !== -1) return ['✅','#22c55e'];
if (a.indexOf('delete') !== -1) return ['🗑️','#ef4444'];
if (a.indexOf('template') !== -1) return ['📋','#8b5cf6'];
if (a.indexOf('upload') !== -1) return ['📤','#0ea5e9'];
if (a.indexOf('login') !== -1) return ['🔑','#64748b'];
return ['•','#94a3b8'];
}
function statCard(icon, value, label, color, sub, navTo) {
return `<div class="card" ${navTo?`data-nav="${navTo}" style="cursor:pointer;border-top:3px solid ${color}"`:`style="border-top:3px solid ${color}"`}>
<div class="card-body" style="padding:16px">
<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px"><div style="font-size:22px">${icon}</div><div style="font-size:13px;color:var(--muted);font-weight:600">${label}</div></div>
<div style="font-size:30px;font-weight:800;color:${color};line-height:1.1">${value}</div>
${sub?`<div style="font-size:12px;color:var(--muted);margin-top:4px">${sub}</div>`:''}
</div></div>`;
}
function sectionBlockHTML(key, s) {
const cfg = DASH_SECTIONS[key];
const passPct = s.total ? Math.round(s.pass/s.total*100) : 0;
const failPct = s.total ? Math.round(s.fail/s.total*100) : 0;
const cards = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px">
${statCard('📋', s.total, 'إجمالي التقييمات', cfg.color, `هذا الشهر: ${s.month}`)}
${statCard('✅', s.pass, 'ناجح', '#16a34a', `${passPct}% من الإجمالي`)}
${statCard('❌', s.fail, 'راسب', '#dc2626', `${failPct}% من الإجمالي`)}
${statCard('⭐', s.avg + '%', 'متوسط الدرجات', '#0ea5e9', '')}
${statCard('⚖️', s.objections_open + ' / ' + s.objections_closed, 'اعتراضات (مفتوح/مغلق)', '#f59e0b', '')}
${statCard('👥', s.active_employees, 'الموظفون النشطون', '#8b5cf6', '')}
${key==='cg' ? statCard('⏳', s.pending, 'قيد الانتظار', '#eab308', 'بانتظار التقييم/الاعتماد', 'cg-requests') : ''}
</div>`;
const notes = (s.notes && s.notes.length) ? s.notes.map((n,i)=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;${i<s.notes.length-1?'border-bottom:1px dashed var(--border)':''}"><span style="font-size:13px">${i+1}. ${Utils.escape(n.note||'—')}</span><span class="badge" style="background:${cfg.soft};color:${cfg.color}">${n.count}×</span></div>`).join('') : '<div style="color:var(--muted);font-size:13px;padding:10px 0">لا توجد ملاحظات كافية حالياً.</div>';
return `<div class="card" style="border-top:4px solid ${cfg.color};margin-bottom:20px">
<div class="card-header" style="background:linear-gradient(to left,${cfg.soft},transparent)"><div class="card-title" style="font-size:18px">${cfg.icon} إحصائيات ${cfg.name}</div></div>
<div class="card-body">
${cards}
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-top:18px">
<div><div style="font-weight:700;font-size:13px;margin-bottom:6px;color:var(--muted)">📈 متوسط الدرجات (آخر 6 أسابيع)</div><div style="height:200px"><canvas id="chart-trend-${key}"></canvas></div></div>
<div><div style="font-weight:700;font-size:13px;margin-bottom:6px;color:var(--muted)">🎯 الناجحون مقابل الراسبين</div><div style="height:200px"><canvas id="chart-donut-${key}"></canvas></div></div>
<div><div style="font-weight:700;font-size:13px;margin-bottom:6px;color:var(--muted)">🏆 أعلى 5 موظفين (عدد التقييمات)</div><div style="height:200px"><canvas id="chart-bar-${key}"></canvas></div></div>
</div>
<div style="margin-top:18px"><div style="font-weight:700;font-size:14px;margin-bottom:8px">⚠️ أبرز الملاحظات المتكررة</div>${notes}</div>
</div></div>`;
}
function buildSectionCharts(key, s) {
const cfg = DASH_SECTIONS[key];
const tc = document.getElementById('chart-trend-'+key);
if (tc) charts.push(new Chart(tc, { type:'line', data:{ labels:(s.trend||[]).map(t=>t.week), datasets:[{ label:'المتوسط', data:(s.trend||[]).map(t=>t.avg), borderColor:cfg.color, backgroundColor:cfg.color+'22', tension:0.35, fill:true }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{ y:{ beginAtZero:true, max:100 } } } }));
const dc = document.getElementById('chart-donut-'+key);
if (dc) charts.push(new Chart(dc, { type:'doughnut', data:{ labels:['ناجح','راسب'], datasets:[{ data:[s.pass, s.fail], backgroundColor:['#16a34a','#dc2626'] }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'bottom'}} } }));
const bc = document.getElementById('chart-bar-'+key);
if (bc) charts.push(new Chart(bc, { type:'bar', data:{ labels:(s.top||[]).map(t=>t.name), datasets:[{ label:'تقييمات', data:(s.top||[]).map(t=>t.count), backgroundColor:cfg.color+'cc' }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{ y:{ beginAtZero:true, ticks:{ precision:0 } } } } }));
}
let _dashCache = null, _dashCacheAt = 0;
async function loadDashboard(force) {
const host = document.getElementById('dash-body');
if (!host) return;
let j = null;
if (!force && _dashCache && (Date.now() - _dashCacheAt < 60000)) j = _dashCache;
if (!j) {
try {
const { data, error } = await window.sb.rpc('get_dashboard_stats', { p_session_token: cgToken() });
j = Array.isArray(data) ? data[0] : data;
if (error || !j || !j.ok) { const m=(j&&j.message)||(error&&error.message)||'تعذّر تحميل الإحصائيات'; if(!handleSessionError(m)) host.innerHTML = `<div class="alert alert-danger">${Utils.escape(m)}</div>`; return; }
_dashCache = j; _dashCacheAt = Date.now();
} catch (e) { host.innerHTML = `<div class="alert alert-danger">${Utils.escape(e.message||'خطأ')}</div>`; return; }
}
const sections = j.sections || {};
const order = ['mahzam','cg'].filter(k => sections[k]);
let html = order.map(k => sectionBlockHTML(k, sections[k])).join('');
if (!order.length) html += '<div class="alert alert-info">لا توجد إحصائيات متاحة لعرضها.</div>';
// آخر النشاطات
const rec = j.recent || [];
const recHtml = rec.length ? rec.map(a => { const [ic,col] = activityIcon(a.action); return `<div style="display:flex;gap:12px;padding:10px 0;border-bottom:1px dashed var(--border)">
<div style="width:34px;height:34px;border-radius:50%;background:${col}22;color:${col};display:flex;align-items:center;justify-content:center;flex-shrink:0">${ic}</div>
<div style="flex:1;min-width:0"><div style="font-size:13px">${Utils.escape((a.details||a.action||'').slice(0,90))}</div><div style="font-size:11px;color:var(--muted)">${Utils.escape(a.user_name||'')} · ${timeAgo(a.at)}</div></div>
</div>`; }).join('') : '<div style="color:var(--muted);padding:12px">لا نشاطات بعد.</div>';
html += `<div class="card"><div class="card-header"><div class="card-title">🕒 آخر النشاطات</div></div><div class="card-body">${recHtml}</div></div>`;
host.innerHTML = html;
order.forEach(k => buildSectionCharts(k, sections[k]));
}

// ============================================
// م9 — تقرير الجودة
// ============================================
function renderQualityReport() {
if (!(currentUser.role==='admin'||currentUser.role==='quality_officer')) return '<div class="alert alert-danger">غير مصرح</div>';
const qos = (DB.getUsers({role:'quality_officer'})||[]);
const qoOpts = qos.map(q=>`<option value="${q.id}">${Utils.escape(q.full_name)}</option>`).join('');
return `<div class="page-header"><div><div class="page-title">📊 تقرير الجودة</div><div class="page-subtitle">الأداء العام لموظفي الجودة ونتائج التقييمات حسب القسم</div></div>
<div style="display:flex;gap:8px"><button class="btn btn-danger btn-sm" id="qr-pdf">📄 PDF</button><button class="btn btn-success btn-sm" id="qr-xlsx">📊 Excel</button></div></div>
<div class="card"><div class="card-body"><div style="display:flex;gap:12px;flex-wrap:wrap;align-items:end">
<div class="form-group" style="margin:0;min-width:160px"><label class="form-label">الفترة</label><select class="form-control" id="qr-period"><option value="month">هذا الشهر</option><option value="last">الشهر الماضي</option><option value="3m" selected>آخر 3 أشهر</option><option value="custom">مخصّص</option></select></div>
<div class="form-group qr-custom" style="margin:0;display:none"><label class="form-label">من</label><input type="date" class="form-control" id="qr-from"></div>
<div class="form-group qr-custom" style="margin:0;display:none"><label class="form-label">إلى</label><input type="date" class="form-control" id="qr-to"></div>
<div class="form-group" style="margin:0;min-width:150px"><label class="form-label">القسم</label><select class="form-control" id="qr-dept"><option value="">الكل</option><option value="2">محزم</option><option value="3">Creative Gene</option></select></div>
<div class="form-group" style="margin:0;min-width:160px"><label class="form-label">موظف الجودة</label><select class="form-control" id="qr-qo"><option value="">الكل</option>${qoOpts}</select></div>
<button class="btn btn-primary" id="qr-apply">تطبيق</button>
</div></div></div>
<div id="qr-body"><div class="card"><div class="card-body" style="text-align:center;padding:44px"><div class="spinner"></div></div></div></div>`;
}
function qrDateRange() {
const p = (document.getElementById('qr-period')||{}).value || '3m';
const today = new Date(); const iso = d => d.toISOString().substring(0,10);
if (p==='custom') return { from: (document.getElementById('qr-from')||{}).value||null, to: (document.getElementById('qr-to')||{}).value||null };
if (p==='month') return { from: iso(new Date(today.getFullYear(),today.getMonth(),1)), to: iso(today) };
if (p==='last') return { from: iso(new Date(today.getFullYear(),today.getMonth()-1,1)), to: iso(new Date(today.getFullYear(),today.getMonth(),0)) };
const f = new Date(today); f.setMonth(f.getMonth()-3); return { from: iso(f), to: iso(today) };
}
async function loadQualityReport() {
const host = document.getElementById('qr-body'); if (!host) return;
const { from, to } = qrDateRange();
const dept = (document.getElementById('qr-dept')||{}).value || null;
const qo = (document.getElementById('qr-qo')||{}).value || null;
const { data, error } = await window.sb.rpc('get_quality_report', { p_session_token: cgToken(), p_from_date: from, p_to_date: to, p_department_id: dept?parseInt(dept):null, p_quality_user_id: qo?parseInt(qo):null });
const j = Array.isArray(data)?data[0]:data;
if (error || !j || !j.ok) { const m=(j&&j.message)||(error&&error.message)||'تعذّر تحميل التقرير'; if(!handleSessionError(m)) host.innerHTML=`<div class="alert alert-danger">${Utils.escape(m)}</div>`; return; }
window._qrData = j;
const ov = j.overall, ovColor = ov>=85?'#16a34a':ov>=70?'#f59e0b':'#dc2626';
const secCards = (j.sections||[]).map(s=>{ const cfg=DASH_SECTIONS[s.key]||{color:'#475569',soft:'#eee',icon:''};
return `<div class="card" style="border-top:4px solid ${cfg.color}"><div class="card-body">
<div style="font-weight:800;font-size:16px;color:${cfg.color};margin-bottom:10px">${cfg.icon} ${Utils.escape(s.name)}</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:14px">
<div>نسبة النجاح: <b style="color:${cfg.color}">${s.pass_rate}%</b></div><div>الإجمالي: <b>${s.total}</b></div>
<div>ناجح: <b style="color:#16a34a">${s.pass}</b></div><div>راسب: <b style="color:#dc2626">${s.fail}</b></div>
<div>المتوسط: <b>${s.avg}%</b></div><div>الاعتراضات: <b>${s.objections}</b></div>
</div><div style="font-size:11px;color:var(--muted);margin-top:8px">درجة النجاح: ${s.pass_score}</div></div></div>`; }).join('');
const off = (j.officers||[]);
const offRows = off.length ? off.map(o=>`<tr><td>${Utils.escape(o.name)}</td><td style="text-align:center">${o.total}</td><td style="text-align:center">${o.mahzam}</td><td style="text-align:center">${o.cg}</td><td style="text-align:center">${o.objections}</td><td style="text-align:center">${o.accepted_rate}%</td><td style="text-align:center">${o.avg_score}%</td></tr>`).join('') : '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:16px">لا بيانات</td></tr>';
host.innerHTML = `
<div class="card" style="border-top:5px solid ${ovColor};margin-bottom:18px;background:${ovColor}0d"><div class="card-body" style="text-align:center;padding:26px">
<div style="font-size:14px;color:var(--muted);font-weight:600">النسبة العامة للجودة</div>
<div style="font-size:56px;font-weight:800;color:${ovColor};line-height:1.1">${ov}%</div>
<div style="font-size:12px;color:var(--muted)">متوسط نسب نجاح الأقسام · ${j.from} ← ${j.to}</div></div></div>
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;margin-bottom:18px">${secCards||'<div class="alert alert-info">لا أقسام</div>'}</div>
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px;margin-bottom:18px">
<div class="card"><div class="card-header"><div class="card-title">📊 مقارنة نسب النجاح</div></div><div class="card-body"><div style="height:220px"><canvas id="qr-bar"></canvas></div></div></div>
<div class="card"><div class="card-header"><div class="card-title">📈 تطور النسبة العامة (6 أسابيع)</div></div><div class="card-body"><div style="height:220px"><canvas id="qr-line"></canvas></div></div></div></div>
<div class="card"><div class="card-header"><div class="card-title">👤 أداء موظفي الجودة</div></div><div style="overflow-x:auto"><table class="table"><thead><tr><th>موظف الجودة</th><th style="text-align:center">التقييمات</th><th style="text-align:center">محزم</th><th style="text-align:center">CG</th><th style="text-align:center">اعتراضات</th><th style="text-align:center">% مقبولة</th><th style="text-align:center">متوسط الدرجات</th></tr></thead><tbody>${offRows}</tbody></table></div></div>`;
const bar = document.getElementById('qr-bar');
if (bar) charts.push(new Chart(bar, { type:'bar', data:{ labels:(j.sections||[]).map(s=>s.name), datasets:[{ label:'نسبة النجاح %', data:(j.sections||[]).map(s=>s.pass_rate), backgroundColor:(j.sections||[]).map(s=>(DASH_SECTIONS[s.key]||{}).color||'#475569') }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{ y:{ beginAtZero:true, max:100 } } } }));
const line = document.getElementById('qr-line');
if (line) charts.push(new Chart(line, { type:'line', data:{ labels:(j.line||[]).map(p=>p.week), datasets:[{ label:'النسبة العامة %', data:(j.line||[]).map(p=>p.rate), borderColor:'#7b1fa2', backgroundColor:'#7b1fa222', tension:0.35, fill:true }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{ y:{ beginAtZero:true, max:100 } } } }));
}
async function qrExportPDF() {
const j = window._qrData; if (!j) { Toast.error('طبّق التقرير أولاً'); return; }
const sec = (j.sections||[]).map(s=>`<tr><td style="padding:6px;border:1px solid #cbd5e1">${Utils.escape(s.name)}</td><td style="padding:6px;border:1px solid #cbd5e1;text-align:center">${s.pass_rate}%</td><td style="padding:6px;border:1px solid #cbd5e1;text-align:center">${s.total}</td><td style="padding:6px;border:1px solid #cbd5e1;text-align:center">${s.pass}</td><td style="padding:6px;border:1px solid #cbd5e1;text-align:center">${s.fail}</td><td style="padding:6px;border:1px solid #cbd5e1;text-align:center">${s.avg}%</td><td style="padding:6px;border:1px solid #cbd5e1;text-align:center">${s.objections}</td></tr>`).join('');
const offs = (j.officers||[]).map(o=>`<tr><td style="padding:6px;border:1px solid #cbd5e1">${Utils.escape(o.name)}</td><td style="padding:6px;border:1px solid #cbd5e1;text-align:center">${o.total}</td><td style="padding:6px;border:1px solid #cbd5e1;text-align:center">${o.mahzam}</td><td style="padding:6px;border:1px solid #cbd5e1;text-align:center">${o.cg}</td><td style="padding:6px;border:1px solid #cbd5e1;text-align:center">${o.objections}</td><td style="padding:6px;border:1px solid #cbd5e1;text-align:center">${o.accepted_rate}%</td><td style="padding:6px;border:1px solid #cbd5e1;text-align:center">${o.avg_score}%</td></tr>`).join('');
const html = `<div style="padding:24px;font-family:'Cairo',sans-serif;direction:rtl;background:white">${buildPDFHeader('📊 تقرير الجودة',`الفترة: ${j.from} ← ${j.to}`,'#7c3aed')}
<div style="text-align:center;margin:12px 0 18px"><div style="font-size:13px;color:#64748b">النسبة العامة للجودة</div><div style="font-size:40px;font-weight:800;color:#7c3aed">${j.overall}%</div></div>
<h3 style="color:#7c3aed">الأقسام</h3><table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px"><thead><tr style="background:#7c3aed;color:white"><th style="padding:8px;border:1px solid #6d28d9">القسم</th><th style="padding:8px;border:1px solid #6d28d9">نسبة النجاح</th><th style="padding:8px;border:1px solid #6d28d9">الإجمالي</th><th style="padding:8px;border:1px solid #6d28d9">ناجح</th><th style="padding:8px;border:1px solid #6d28d9">راسب</th><th style="padding:8px;border:1px solid #6d28d9">المتوسط</th><th style="padding:8px;border:1px solid #6d28d9">اعتراضات</th></tr></thead><tbody>${sec}</tbody></table>
<h3 style="color:#06579F">أداء موظفي الجودة</h3><table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:#06579F;color:white"><th style="padding:8px;border:1px solid #044a87">الموظف</th><th style="padding:8px;border:1px solid #044a87">التقييمات</th><th style="padding:8px;border:1px solid #044a87">محزم</th><th style="padding:8px;border:1px solid #044a87">CG</th><th style="padding:8px;border:1px solid #044a87">اعتراضات</th><th style="padding:8px;border:1px solid #044a87">% مقبولة</th><th style="padding:8px;border:1px solid #044a87">متوسط الدرجات</th></tr></thead><tbody>${offs}</tbody></table></div>`;
try { await htmlToPDF(html, `تقرير_الجودة_${new Date().toISOString().slice(0,10)}.pdf`); } catch(e) { Toast.error('تعذّر إنشاء PDF'); }
}
function qrExportXLSX() {
const j = window._qrData; if (!j) { Toast.error('طبّق التقرير أولاً'); return; }
const wb = XLSX.utils.book_new();
const secData = (j.sections||[]).map(s=>({'القسم':s.name,'نسبة النجاح %':s.pass_rate,'الإجمالي':s.total,'ناجح':s.pass,'راسب':s.fail,'المتوسط %':s.avg,'الاعتراضات':s.objections,'درجة النجاح':s.pass_score}));
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(secData.length?secData:[{'-':'لا بيانات'}]), 'الأقسام');
const offData = (j.officers||[]).map(o=>({'موظف الجودة':o.name,'التقييمات':o.total,'محزم':o.mahzam,'Creative Gene':o.cg,'اعتراضات':o.objections,'% مقبولة':o.accepted_rate,'متوسط الدرجات %':o.avg_score}));
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(offData.length?offData:[{'-':'لا بيانات'}]), 'موظفو الجودة');
XLSX.writeFile(wb, `تقرير_الجودة_${new Date().toISOString().slice(0,10)}.xlsx`);
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

if (!window._departments) loadDepartments(true).then(() => { if (currentPage === 'employees') navigate('employees'); });
const supervisors = DB.getSupervisors();
const supOpts = supervisors.map(s => `<option value="${Utils.escape(s.full_name)}">${Utils.escape(s.full_name)}</option>`).join('');
const deptOpts = (window._departments||[]).filter(d => d.is_active).map(d => `<option value="${d.id}">${Utils.escape(d.name)}</option>`).join('');

const rows = users.map(u => {
const avg = DB.getAvgScore(u.id);
const count = DB.data.evaluations.filter(e => e.employee_id === u.id).length;
const uDept = (window._departments||[]).find(d => d.id === u.department_id);
return `<tr data-search="${Utils.escape((u.full_name||'')+' '+(u.employee_number||'')+' '+(u.supervisor_name||'')+' '+(u.email||'')+' '+(u.department||''))}" data-status="${u.is_active?'active':'inactive'}" data-deptid="${u.department_id||''}" data-sup="${Utils.escape(u.supervisor_name||'')}">
<td><strong>${Utils.escape(u.employee_number||'-')}</strong></td>
<td><div style="display:flex;align-items:center;gap:10px"><div class="user-avatar">${Utils.getInitials(u.full_name)}</div><div>${Utils.escape(u.full_name)}</div></div></td>
<td><div style="font-size:13px;direction:ltr;text-align:right">${Utils.escape(u.email||'-')}</div></td>
<td>${u.job_title?Utils.escape(u.job_title):(u.position?'<span style="color:var(--muted)">'+Utils.escape(u.position)+'</span>':'—')}</td>
<td>${deptBadgeHTML(uDept)}</td>
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
<option value="">🏢 جميع الأقسام</option>${deptOpts}
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
<thead><tr><th>الرقم الوظيفي</th><th>اسم الموظف</th><th>البريد الإلكتروني</th><th>المسمى الوظيفي</th><th>القسم</th><th>اسم المشرف</th><th>حالة الحساب</th><th>تاريخ الإنشاء</th><th>متوسط الأداء</th><th>إجراءات</th></tr></thead>
<tbody>${rows || '<tr><td colspan="10" style="text-align:center;padding:30px;color:var(--muted)">لا يوجد موظفون</td></tr>'}</tbody>
</table>
</div>
</div>`;
}

// قائمة الأدوار الوظيفية (job_role)
const JOB_ROLES = [['real_estate_marketer','مسوّق عقاري'],['designer','مصمّم'],['social_media','سوشيال ميديا'],['seo','SEO'],['content_manager','مدير محتوى'],['quality_agent','موظف جودة']];
const JOB_TITLE_SUGGEST = { real_estate_marketer:'مسوق عقاري', designer:'مصمم', social_media:'مسؤول سوشل ميديا', seo:'مسؤول SEO', content_manager:'مدير المحتوى', quality_agent:'موظف جودة' };
// تحميل الأقسام (مع تخزين) عبر RPC
async function loadDepartments(force) {
  if (window._departments && !force) return window._departments;
  try {
    const tok = window.getSessionToken ? window.getSessionToken() : null;
    const { data } = await window.sb.rpc('list_departments', { p_session_token: tok });
    window._departments = (data && data.departments) ? data.departments : [];
  } catch (_) { window._departments = []; }
  return window._departments;
}

function onEmpDeptChange() {
const dv = parseInt((document.getElementById('ef-deptid')||{}).value);
const wrap = document.getElementById('ef-jobrole-wrap');
const isCg = dv === cgDeptId();
if (wrap) wrap.style.display = isCg ? '' : 'none';
if (!isCg) { const jr = document.getElementById('ef-jobrole'); if (jr) jr.value = ''; }
}
async function showEmployeeModal(editId=null) {
const ed = editId ? DB.getUser(editId) : null;
const depts = (await loadDepartments()).filter(d => d.is_active);
const deptOpts = depts.map(d => `<option value="${d.id}" ${ed && ed.department_id === d.id ? 'selected' : ''}>${Utils.escape(d.name)}</option>`).join('');
const _cgId = cgDeptId();
const CG_JOB_ROLES = JOB_ROLES.filter(([v]) => v !== 'quality_agent');
const jobOpts = CG_JOB_ROLES.map(([v,l]) => `<option value="${v}" ${ed && ed.job_role === v ? 'selected' : ''}>${l}</option>`).join('');
const supervisors = DB.data.users.filter(u => ['supervisor','admin'].includes(u.role) && u.is_active !== false).sort((a,b) => (a.full_name||'').localeCompare(b.full_name||'','ar'));
const currentSup = ed ? (ed.supervisor_name||'') : '';
const supOpts = supervisors.map(s => `<option value="${Utils.escape(s.full_name)}" ${s.full_name===currentSup?'selected':''}>${Utils.escape(s.full_name)} (${Utils.escape(s.role==='admin'?'مدير':'مشرف')})</option>`).join('');
const supDropdown = `<select class="form-control" id="ef-sup">
<option value="">-- بلا مشرف --</option>
${supOpts}
</select>
<div style="font-size:11px;color:var(--muted);margin-top:4px">اختياري — القائمة تشمل المشرفين والمديرين</div>`;

const body = `<form id="emp-form">
<div class="alert alert-info" style="margin-bottom:16px;font-size:13px">
ℹ️ سيتم إنشاء حساب دخول للموظف بالبريد الإلكتروني وكلمة المرور أدناه.
</div>
<div class="grid grid-2">
<div class="form-group"><label class="form-label">اسم الموظف بالكامل *</label><input class="form-control" id="ef-name" required value="${ed?Utils.escape(ed.full_name):''}" placeholder="مثال: أحمد علي محمد"></div>
<div class="form-group"><label class="form-label">الرقم الوظيفي *</label><input class="form-control" id="ef-num" required value="${ed?Utils.escape(ed.employee_number||''):''}" placeholder="مثال: EMP001" ${ed?'readonly':''}></div>
<div class="form-group"><label class="form-label">📧 البريد الإلكتروني *</label><input type="email" class="form-control" id="ef-email" required value="${ed?Utils.escape(ed.email||''):''}" placeholder="employee@example.com"></div>
<div class="form-group"><label class="form-label">📱 رقم الجوال</label><input class="form-control" id="ef-phone" value="${ed?Utils.escape(ed.phone||''):''}" placeholder="05xxxxxxxx"></div>
<div class="form-group"><label class="form-label">الوصف الوظيفي *</label><input class="form-control" id="ef-pos" required value="${ed?Utils.escape(ed.position||''):'موظف خدمة'}"></div>
<div class="form-group"><label class="form-label">👨‍💼 المشرف</label>${supDropdown}</div>
<div class="form-group"><label class="form-label">القسم * <span style="font-size:11px;color:var(--muted)">(يحدّد نموذج التقييم)</span></label><select class="form-control" id="ef-deptid" required onchange="onEmpDeptChange()"><option value="">-- اختر القسم --</option>${deptOpts}</select></div>
<div class="form-group" id="ef-jobrole-wrap" style="${ed && ed.department_id === _cgId ? '' : 'display:none'}"><label class="form-label">المسمى الوظيفي التقني (الدور) * <span style="font-size:11px;color:var(--muted)">(يحدّد نموذج التقييم)</span></label><select class="form-control" id="ef-jobrole"><option value="">-- اختر المسمى --</option>${jobOpts}</select></div>
<div class="form-group"><label class="form-label">المسمى الوظيفي المرئي <span style="font-size:11px;color:var(--muted)">(يظهر في القوائم والتقارير)</span></label><input class="form-control" id="ef-jobtitle" value="${ed?Utils.escape(ed.job_title||''):''}" placeholder="مثال: مصمم جرافيك"></div>
${!ed ? `<div style="background:#eff6ff;padding:10px;border-radius:8px;font-size:12px;color:var(--primary-dark)">🔐 ستُولَّد كلمة مرور مؤقتة تلقائياً وتُرسَل لبريد الموظف وتُعرَض لك بعد الإضافة.</div>` : ''}
</div>
${!ed ? `<div style="background:#f1f5f9;padding:10px;border-radius:8px;font-size:12px;color:var(--muted);margin-top:8px">
<strong>متطلبات كلمة المرور:</strong> 8 أحرف على الأقل، حرف واحد، رقم واحد، رمز خاص (@!#$%)
</div>` : ''}
</form>`;
const footer = `<button class="btn btn-secondary" onclick="Modal.close()">إلغاء</button><button class="btn btn-primary" id="ef-save">${ed?'حفظ':'إضافة'}</button>`;
Modal.show(ed?'تعديل بيانات الموظف':'إضافة موظف جديد', body, footer);

// اقتراح المسمى الوظيفي تلقائياً من الدور (إن كان الحقل فارغاً)
const _jrEl = document.getElementById('ef-jobrole'), _jtEl = document.getElementById('ef-jobtitle');
if (_jrEl && _jtEl) _jrEl.addEventListener('change', () => { if (!_jtEl.value.trim() && JOB_TITLE_SUGGEST[_jrEl.value]) _jtEl.value = JOB_TITLE_SUGGEST[_jrEl.value]; });

document.getElementById('ef-save').addEventListener('click', async (e) => {
const btn = e.currentTarget;
await submitWithFeedback(btn, 'جاري الحفظ...', null, async () => {
const full_name = document.getElementById('ef-name').value.trim();
const employee_number = document.getElementById('ef-num').value.trim();
const position = document.getElementById('ef-pos').value.trim();
const supervisor_name = ((document.getElementById('ef-sup')||{}).value) || '';
const supObj = DB.data.users.find(s => s.full_name === supervisor_name && ['supervisor','admin'].includes(s.role));
const supervisor_id = supObj ? supObj.id : null;
const email = document.getElementById('ef-email').value.trim();
const phone = document.getElementById('ef-phone').value.trim();
const department_id = document.getElementById('ef-deptid').value ? parseInt(document.getElementById('ef-deptid').value) : null;
const deptObj = (window._departments || []).find(d => d.id === department_id);
const department = deptObj ? deptObj.name : '';
const _isCg = isCreativeGeneDept(department_id);
const job_role = _isCg ? (document.getElementById('ef-jobrole').value || null) : null;
const job_title = ((document.getElementById('ef-jobtitle')||{}).value || '').trim();

if (!full_name || !employee_number || !position || !email) {
Toast.error('يرجى تعبئة جميع الحقول المطلوبة');
return false;
}
if (!department_id) { Toast.error('الرجاء اختيار القسم'); return false; }
if (_isCg && !job_role) { Toast.error('الرجاء اختيار المسمى الوظيفي (الدور) لموظف Creative Gene'); return false; }
if (!supervisor_name && _isCg) {
if (!confirm('⚠️ لم يتم تعيين مشرف. الإجراءات على هذا الموظف ستكون من admin فقط.\n\nهل تريد المتابعة؟')) return false;
}
// تحذير عند نقل الموظف بين الأقسام
if (ed && ed.department_id && ed.department_id !== department_id) {
if (!confirm('⚠️ تغيير قسم الموظف قد يؤثّر على النموذج المُستخدم في تقييماته الجديدة.\nالتقييمات السابقة محفوظة بـ snapshot ولن تتأثّر.\n\nهل تريد المتابعة؟')) return false;
}
if (!Utils.validateEmail(email)) { Toast.error('بريد إلكتروني غير صالح'); return false; }

const _tok = (window.getSessionToken ? window.getSessionToken() : null);
if (ed) {
if (window.sb && window.sb.rpc) {
const { data, error } = await window.sb.rpc('update_employee_profile', {
p_session_token: _tok, p_user_id: editId,
p_full_name: full_name, p_email: email, p_employee_number: employee_number,
p_position: position, p_department: department, p_phone: phone,
p_supervisor_id: supervisor_id, p_supervisor_name: supervisor_name,
p_department_id: department_id, p_job_role: job_role
});
const row = (!error && Array.isArray(data) && data[0]) ? data[0] : null;
if (!row || !row.ok) { const msg=(row&&row.message)||(error&&error.message)||'تعذّر الحفظ'; const h=handleSessionError(msg); if(!h) Toast.error(msg); return false; }
if (['admin','quality_officer'].includes(currentUser.role)) { try { await window.sb.rpc('admin_set_job_title', { p_session_token: _tok, p_user_id: editId, p_job_title: job_title }); } catch(_){} }
if (window.SupabaseSync && SupabaseSync.pullAll) { try{ await SupabaseSync.pullAll(true); }catch(_){} }
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
p_supervisor_id: supervisor_id, p_supervisor_name: supervisor_name,
p_department_id: department_id, p_job_role: job_role
});
const row = (!error && Array.isArray(data) && data[0]) ? data[0] : null;
if (!row || !row.ok) { const msg=(row&&row.message)||(error&&error.message)||'تعذّر إضافة الموظف'; const h=handleSessionError(msg); if(!h) Toast.error(msg); return false; }
if (window.SupabaseSync && SupabaseSync.pullAll) { try{ await SupabaseSync.pullAll(true); }catch(_){} }
if (['admin','quality_officer'].includes(currentUser.role) && job_title) { try { const nu = DB.data.users.find(u => u.employee_number === employee_number); if (nu) { await window.sb.rpc('admin_set_job_title', { p_session_token: _tok, p_user_id: nu.id, p_job_title: job_title }); if (window.SupabaseSync && SupabaseSync.pullAll) await SupabaseSync.pullAll(true); } } catch(_){} }
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
const isQuality = currentUser.role === 'quality_officer';
const rows = users.map(u => { const lock = isQuality && u.role === 'admin';
const dis = lock ? `disabled title="لا يمكن تعديل حسابات الأدمن" style="opacity:.5;cursor:not-allowed"` : '';
return `<tr>
<td>${u.id}</td>
<td><div style="display:flex;align-items:center;gap:10px"><div class="user-avatar">${Utils.getInitials(u.full_name)}</div>${Utils.escape(u.full_name)}</div></td>
<td>${Utils.escape(u.email||'-')}</td>
<td>${Utils.roleBadge(u.role)}</td>
<td>${Utils.escape(u.department||'-')}</td>
<td>${u.is_active ? '<span class="badge badge-success">نشط</span>' : '<span class="badge badge-danger">معطّل</span>'}</td>
<td>${Utils.formatDate(u.created_at)}</td>
<td>
<button class="btn btn-sm btn-warning" ${lock?dis:`data-edit-user="${u.id}"`}>تعديل</button>
<button class="btn btn-sm btn-info" ${lock?dis:`data-reset-pw="${u.id}" title="إعادة تعيين كلمة المرور"`}>🔑</button>
${u.is_active ? `<button class="btn btn-sm btn-danger" ${lock?dis:`data-deact-user="${u.id}"`}>تعطيل</button>` : ''}
</td>
</tr>`; }).join('');

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

function onUserDeptChange() {
const dv = parseInt((document.getElementById('usr-deptid')||{}).value);
const wrap = document.getElementById('usr-jobrole-wrap');
const isCg = dv === cgDeptId();
if (wrap) wrap.style.display = isCg ? '' : 'none';
if (!isCg) { const jr = document.getElementById('usr-jobrole'); if (jr) jr.value = ''; }
}
async function showUserModal(editId=null) {
const ed = editId ? DB.getUser(editId) : null;
if (currentUser.role==='quality_officer' && ed && ed.role==='admin') { Toast.error('لا يمكن لموظف الجودة تعديل حسابات الأدمن'); return; }
const depts = (await loadDepartments()).filter(d => d.is_active);
const deptOptsU = depts.map(d => `<option value="${d.id}" ${ed && ed.department_id === d.id ? 'selected' : ''}>${Utils.escape(d.name)}</option>`).join('');
const cgJobOptsU = JOB_ROLES.filter(([v]) => v !== 'quality_agent').map(([v,l]) => `<option value="${v}" ${ed && ed.job_role === v ? 'selected' : ''}>${l}</option>`).join('');
const _cgIdU = cgDeptId();
const supervisors = DB.data.users.filter(u => ['supervisor','admin'].includes(u.role) && u.is_active !== false);
const supOpts = supervisors.map(s => `<option value="${Utils.escape(s.full_name)}" ${ed && ed.supervisor_name===s.full_name?'selected':''}>${Utils.escape(s.full_name)} (${Utils.escape(s.role==='admin'?'مدير':'مشرف')})</option>`).join('');

const body = `<form id="usr-form">
<div class="alert alert-info" style="margin-bottom:14px;font-size:13px">
ℹ️ اختر نوع الحساب من القائمة. الحسابات المصنّفة كمشرف ستظهر تلقائياً في قائمة المشرفين عند إضافة الموظفين.
</div>
<div class="grid grid-2">
<div class="form-group"><label class="form-label">الاسم الكامل *</label><input class="form-control" id="usr-name" required value="${ed?Utils.escape(ed.full_name):''}"></div>
<div class="form-group"><label class="form-label">📧 البريد الإلكتروني *</label><input type="email" class="form-control" id="usr-email" required value="${ed?Utils.escape(ed.email||''):''}"></div>
<div class="form-group"><label class="form-label">📱 رقم الجوال</label><input class="form-control" id="usr-phone" value="${ed?Utils.escape(ed.phone||''):''}"></div>
<div class="form-group"><label class="form-label">القسم <span style="font-size:11px;color:var(--muted)">(إلزامي لغير المدير/الجودة)</span></label><select class="form-control" id="usr-deptid" onchange="onUserDeptChange()"><option value="">-- بلا قسم --</option>${deptOptsU}</select></div>
<div class="form-group" id="usr-jobrole-wrap" style="${ed && ed.department_id === _cgIdU ? '' : 'display:none'}"><label class="form-label">المسمى الوظيفي التقني (الدور) *</label><select class="form-control" id="usr-jobrole"><option value="">-- اختر --</option>${cgJobOptsU}</select></div>
<div class="form-group"><label class="form-label">الوصف الوظيفي</label><input class="form-control" id="usr-pos" value="${ed?Utils.escape(ed.position||''):''}"></div>
<div class="form-group"><label class="form-label">نوع الحساب *</label>
<select class="form-control" id="usr-role" ${ed?'disabled':''} onchange="onUserDeptChange(); document.getElementById('usr-sup-wrap').style.display = this.value==='employee'?'block':'none'; document.getElementById('usr-num-wrap').style.display = this.value==='employee'?'block':'none'">
<option value="employee" ${ed&&ed.role==='employee'?'selected':''}>👤 موظف</option>
<option value="supervisor" ${ed&&ed.role==='supervisor'?'selected':''}>👨‍💼 مشرف</option>
<option value="quality_officer" ${ed&&ed.role==='quality_officer'?'selected':''}>⚖️ موظف الجودة</option>
${currentUser.role==='admin' ? `<option value="admin" ${ed&&ed.role==='admin'?'selected':''}>👑 مدير النظام</option>` : ''}
</select>${currentUser.role==='quality_officer'?'<div style="font-size:11px;color:var(--muted);margin-top:4px">موظف الجودة لا يمكنه إنشاء حساب مدير</div>':''}</div>
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
const position = document.getElementById('usr-pos').value.trim();
const role = ed ? ed.role : document.getElementById('usr-role').value;
const department_id = document.getElementById('usr-deptid').value ? parseInt(document.getElementById('usr-deptid').value) : null;
const _deptObjU = (window._departments||[]).find(d => d.id === department_id);
const department = _deptObjU ? _deptObjU.name : '';
const _isCgU = isCreativeGeneDept(department_id);
const job_role = _isCgU ? (document.getElementById('usr-jobrole').value || null) : null;
const employee_number = (document.getElementById('usr-num')||{}).value || '';
const supervisor_name = (document.getElementById('usr-sup')||{}).value || '';
const supObj = supervisor_name ? DB.data.users.find(s => s.full_name === supervisor_name && ['supervisor','admin'].includes(s.role)) : null;
const supervisor_id = supObj ? supObj.id : null;
if (!full_name || !email) { Toast.error('يرجى تعبئة الحقول المطلوبة'); return false; }
if (!Utils.validateEmail(email)) { Toast.error('بريد إلكتروني غير صالح'); return false; }
if (['supervisor','manager','employee'].includes(role) && !department_id) { Toast.error('القسم إلزامي لدور المشرف/الموظف'); return false; }
if (_isCgU && !job_role) { Toast.error('المسمى الوظيفي إلزامي لموظفي Creative Gene'); return false; }
if (role === 'employee' && !supervisor_name && !_isCgU) { Toast.error('يجب اختيار المشرف للموظف'); return false; }

const token = (window.getSessionToken ? window.getSessionToken() : null);
if (ed) {
// تعديل عبر RPC مُصادَق
if (window.sb && window.sb.rpc) {
const { data, error } = await window.sb.rpc('admin_update_user', {
p_session_token: token, p_user_id: editId,
p_full_name: full_name, p_email: email, p_phone: phone, p_department: department, p_position: position,
p_employee_number: ed.role === 'employee' ? employee_number : null,
p_supervisor_id: supervisor_id,
p_department_id: department_id, p_job_role: job_role
});
const row = (!error && Array.isArray(data) && data[0]) ? data[0] : null;
if (!row || !row.ok) { const msg=(row&&row.message)||(error&&error.message)||'تعذّر الحفظ'; const h=handleSessionError(msg); if(!h) Toast.error(msg); return false; }
if (window.SupabaseSync && SupabaseSync.pullAll) { try{ await SupabaseSync.pullAll(true); }catch(_){} }
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
p_supervisor_id: supervisor_id,
p_department_id: department_id, p_job_role: job_role
});
const row = (!error && Array.isArray(data) && data[0]) ? data[0] : null;
if (!row || !row.ok) { const msg=(row&&row.message)||(error&&error.message)||'تعذّر إنشاء المستخدم'; const h=handleSessionError(msg); if(!h) Toast.error(msg); return false; }
tempPw = row.temp_password;
if (window.SupabaseSync && SupabaseSync.pullAll) { try{ await SupabaseSync.pullAll(true); }catch(_){} }
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
<div><div class="page-title">${Utils.escape(emp.full_name)}</div><div class="page-subtitle">المسمى: ${emp.job_title?Utils.escape(emp.job_title):'—'} | القسم: ${(() => { const d=(window._departments||[]).find(x=>x.id===emp.department_id); return d?Utils.escape(d.name):Utils.escape(emp.department||'—'); })()} | المشرف: ${Utils.escape(emp.supervisor_name||'-')}</div></div>
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
// النموذج المُستخدم — يُستنتج من template_snapshot (مُجمّد) لتقييمات Creative Gene
function usedTemplateLabel(ev) {
if (!ev || !ev.template_snapshot) return '—';
if (ev.template_type === 'section_based' || !ev.template_type) return 'نموذج محزم (بنود) — الافتراضي الأصلي';
if (ev.template_type === 'pdf_based_weekly') {
const ids = ((ev.template_snapshot.criteria)||[]).map(c => c.id);
if (ids.includes('clients_new')) return 'نموذج مسوّق عقاري';
if (ids.includes('design_quality')) return 'نموذج مصمّم';
if (ids.includes('posts')) return 'نموذج سوشيال ميديا';
if (ids.includes('ranking')) return 'نموذج SEO';
if (ids.includes('editorial_plan')) return 'نموذج مدير محتوى';
return 'النموذج الافتراضي';
}
return '—';
}
function jobTitleCell(emp) { return (emp && emp.job_title) ? Utils.escape(emp.job_title) : '<span style="color:var(--muted)">—</span>'; }
function deptBadgeHTML(dept) {
if (!dept) return '<span style="color:var(--muted)">—</span>';
const isCg = dept.template_type === 'pdf_based_weekly';
const style = isCg ? 'background:#f3e5f5;color:#7b1fa2' : 'background:#e3f2fd;color:#1976d2';
return `<span style="${style};padding:2px 8px;border-radius:12px;font-size:12px;white-space:nowrap">${Utils.escape(dept.name)}</span>`;
}
function renderEvaluations() {
const isEmp = currentUser.role === 'employee';
const isSup = currentUser.role === 'supervisor';
let evals = DB.getEvaluations(isEmp ? { employee_id: currentUser.id } : {});
const deptF = currentParams.dept ? parseInt(currentParams.dept) : null;
if (deptF) evals = evals.filter(e => { const u = DB.getUser(e.employee_id); return u && u.department_id == deptF; });
if (!window._departments && !isEmp) loadDepartments(true).then(() => { if (currentPage === 'evaluations') navigate('evaluations', currentParams); });
let deptFilterHTML = '';
if (!isEmp) {
let depts = (window._departments||[]).filter(d => d.is_active);
if (isSup) { const myD = new Set(DB.getUsers({role:'employee'}).filter(e => e.supervisor_id===currentUser.id || e.supervisor_name===currentUser.full_name).map(e => e.department_id)); depts = depts.filter(d => myD.has(d.id)); }
const opts = depts.map(d => `<option value="${d.id}" ${deptF===d.id?'selected':''}>${Utils.escape(d.name)}</option>`).join('');
deptFilterHTML = `<select class="form-control" id="eval-dept-filter" style="max-width:220px"><option value="">جميع الأقسام</option>${opts}</select>`;
}
const rows = evals.map(e => {
const emp = DB.getUser(e.employee_id);
const evr = DB.getUser(e.evaluator_id);
const dept = emp ? (window._departments||[]).find(d => d.id === emp.department_id) : null;
const canEdit = Perms.can('edit_evaluation');
const canDelete = Perms.can('delete_evaluation');
return `<tr>
<td>#${e.id}</td>
<td>${e.communication_type==='chat'?'<span title="محادثة">💬</span> ':e.communication_type==='call'?'<span title="اتصال">📞</span> ':''}${Utils.escape(emp?emp.full_name:'-')}</td>
<td>${emp&&emp.job_title?Utils.escape(emp.job_title):'<span style="color:var(--muted)">—</span>'}</td>
<td>${deptBadgeHTML(dept)}</td>
<td>${Utils.formatDate(e.evaluation_date)}</td>
<td>${Utils.escape(evr?evr.full_name:'-')}</td>
<td>${e.total_score}/100</td>
<td>${Utils.gradeBadge(e.percentage)}</td>
<td>
<button class="btn btn-sm btn-primary" data-nav-eval="${e.id}">عرض</button>
${canEdit ? `<button class="btn btn-sm btn-warning" data-edit-eval="${e.id}">تعديل</button>` : ''}
${canDelete ? `<button class="btn btn-sm btn-danger" data-del-eval="${e.id}">حذف</button>` : ''}
</td>
</tr>`;
}).join('');

const _deptObj = deptF ? (window._departments||[]).find(d => d.id === deptF) : null;
const _title = _deptObj ? `تقييمات ${Utils.escape(_deptObj.name)} (${evals.length})` : `التقييمات (${evals.length})`;
const _newEvalBtn = (currentUser.role === 'admin' || currentUser.role === 'quality_officer') ? `<button class="btn btn-primary" data-nav="new-evaluation" ${deptF?`data-navparams='{"dept":${deptF}}'`:''}>➕ تقييم جديد</button>` : '';
return `
<div class="page-header">
<div><div class="page-title">${_title}</div><div class="page-subtitle">${_deptObj?'قسم '+Utils.escape(_deptObj.name):'سجل كامل لجميع التقييمات'}</div></div>
<div style="display:flex;gap:10px;flex-wrap:wrap">
<button class="btn btn-success" id="exp-xlsx">📊 Excel</button>
<button class="btn btn-danger" id="exp-pdf">📄 PDF</button>
${_newEvalBtn}
</div>
</div>
<div class="card">
<div style="padding:14px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">
<input type="text" class="form-control" id="eval-search" placeholder="🔍 ابحث في التقييمات..." style="flex:1;min-width:200px">
${deptF ? '' : deptFilterHTML}
</div>
<div style="overflow-x:auto">
<table class="table" id="eval-table">
<thead><tr><th>#</th><th>الموظف</th><th>المسمى الوظيفي</th><th>القسم</th><th>التاريخ</th><th>المقيِّم</th><th>الدرجة</th><th>التقدير</th><th>إجراءات</th></tr></thead>
<tbody>${rows || '<tr><td colspan="9" style="text-align:center;padding:20px">لا توجد تقييمات</td></tr>'}</tbody>
</table>
</div>
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
if (window.SupabaseSync && SupabaseSync.pullAll) { try{ await SupabaseSync.pullAll(true); }catch(_){} }
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
// عرض نوع التواصل + المرجع في صفحة التفاصيل (رابط/tel/نصّ حسب النوع)
function renderCommDisplay(ev) {
const t = ev && ev.communication_type;
const ref = (ev && ev.communication_reference) || '';
if (!t && !ref) return '';
const typeLabel = t === 'chat' ? '💬 محادثة' : (t === 'call' ? '📞 اتصال' : 'غير محدّد');
const refLabel = t === 'chat' ? 'رابط المحادثة' : (t === 'call' ? 'رقم/كود المكالمة' : 'المرجع');
let refHtml;
if (!ref) refHtml = '<span style="color:var(--muted)">غير محدّد</span>';
else if (t === 'chat' && /^https?:\/\//i.test(ref)) refHtml = `<a href="${Utils.escape(ref)}" target="_blank" rel="noopener">${Utils.escape(ref)}</a>`;
else if (t === 'call' && /^[+\d][\d\s\-]{5,}$/.test(ref)) refHtml = `<a href="tel:${Utils.escape(ref.replace(/\s/g,''))}">${Utils.escape(ref)}</a>`;
else refHtml = Utils.escape(ref);
return `<div class="alert alert-info"><strong>📡 نوع التواصل:</strong> ${typeLabel} &nbsp;|&nbsp; <strong>${refLabel}:</strong> ${refHtml}</div>`;
}

// حقل "نوع التواصل" + الحقل المشروط (المرجع) — يُستخدم في نموذجي الإنشاء والتعديل
function buildCommTypeField(ev) {
const t = (ev && ev.communication_type) ? ev.communication_type : '';
const r = (ev && ev.communication_reference) ? ev.communication_reference : '';
const isChat = t === 'chat';
const lbl = isChat ? 'رابط المحادثة' : 'رقم/كود المكالمة';
const ph = isChat ? 'ألصق رابط المحادثة هنا' : 'أدخل رقم أو كود المكالمة';
return `
<div class="form-group"><label class="form-label">📡 نوع التواصل *</label>
<select class="form-control" id="ef-commtype" required data-prev="${t}" onchange="(function(s){var w=document.getElementById('ef-commref-wrap'),i=document.getElementById('ef-commref'),l=document.getElementById('ef-commref-label');if(!s.value){w.style.display='none';i.value='';s.dataset.prev='';return;}w.style.display='block';if(s.value==='chat'){l.textContent='رابط المحادثة *';i.placeholder='ألصق رابط المحادثة هنا';}else{l.textContent='رقم/كود المكالمة *';i.placeholder='أدخل رقم أو كود المكالمة';}if(s.dataset.prev&&s.dataset.prev!==s.value){i.value='';}s.dataset.prev=s.value;})(this)">
<option value="">-- اختر --</option>
<option value="chat" ${isChat?'selected':''}>💬 محادثة</option>
<option value="call" ${t==='call'?'selected':''}>📞 اتصال</option>
</select></div>
<div class="form-group" id="ef-commref-wrap" style="${t?'':'display:none'}">
<label class="form-label" id="ef-commref-label">${lbl} *</label>
<input class="form-control" id="ef-commref" placeholder="${ph}" value="${Utils.escape(r)}">
</div>`;
}

function cgDeptId() { const d = (window._departments||[]).find(x => x.template_type === 'pdf_based_weekly'); return d ? d.id : 3; }

// مركز التقييم: قسمان منفصلان بصرياً (محزم / Creative Gene)
function renderEvalHub() {
if (!window._departments) loadDepartments(true).then(() => { if (currentPage === 'new-evaluation' && !currentParams.dept) navigate('new-evaluation', {}); });
const mId = mahzamDeptId(), cId = cgDeptId();
return `
<div class="page-header"><div><div class="page-title">التقييم</div><div class="page-subtitle">اختر القسم لبدء التقييم أو إدارته</div></div></div>
<div class="card" style="border-top:4px solid var(--primary);margin-bottom:20px">
<div class="card-header" style="background:linear-gradient(to left,#e0edff,transparent)"><div class="card-title">📊 قسم محزم</div></div>
<div class="card-body" style="display:flex;gap:10px;flex-wrap:wrap">
<button class="btn btn-primary" onclick="navigate('new-evaluation',{dept:${mId}})">➕ تقييم جديد — محزم</button>
<button class="btn btn-secondary" onclick="navigate('evaluations',{dept:${mId}})">📋 تقييمات محزم</button>
<button class="btn btn-secondary" onclick="navigate('settings',{tab:'form'})">⚙️ تخصيص نموذج محزم</button>
</div></div>
<div class="card" style="border-top:4px solid #a855f7">
<div class="card-header" style="background:linear-gradient(to left,#f3e8ff,transparent)"><div class="card-title">🎨 قسم Creative Gene</div></div>
<div class="card-body" style="display:flex;gap:10px;flex-wrap:wrap">
<button class="btn btn-primary" onclick="navigate('new-evaluation',{dept:${cId}})">➕ تقييم جديد — Creative Gene</button>
<button class="btn btn-secondary" onclick="navigate('cg-week')">📄 أسبوع Creative Gene</button>
<button class="btn btn-secondary" onclick="navigate('cg-objections')">⚖️ اعتراضات Creative Gene</button>
<button class="btn btn-secondary" onclick="navigate('settings',{tab:'cg'})">⚙️ تخصيص نموذج Creative Gene</button>
</div></div>`;
}

function renderNewEvaluation(deptFilter) {
if (!deptFilter) return renderEvalHub();
deptFilter = parseInt(deptFilter);
if (!window._departments) loadDepartments(true).then(() => { if (currentPage === 'new-evaluation') navigate('new-evaluation', { dept: deptFilter }); });
const dept = (window._departments||[]).find(d => d.id === deptFilter);
const deptName = dept ? dept.name : '';
let employees = DB.getUsers({ role:'employee', active:true }).filter(e => e.department_id == deptFilter);
const empOpts = employees.map(e => `<option value="${e.id}">${Utils.escape(e.full_name)}</option>`).join('');
return `
<div class="page-header">
<div><div class="page-title">تقييم جديد — ${Utils.escape(deptName)}</div><div class="page-subtitle">اختر الموظف لبدء التقييم</div></div>
<button class="btn btn-secondary" onclick="navigate('new-evaluation',{})">← رجوع</button>
</div>
<div class="card">
<div class="card-header"><div class="card-title">📋 بيانات التقييم</div></div>
<div class="card-body">
<div class="grid grid-2">
<div class="form-group"><label class="form-label">الموظف *</label><select class="form-control" id="ef-employee" required><option value="">-- اختر --</option>${empOpts}</select></div>
<div class="form-group"><label class="form-label">تاريخ التقييم *</label><input type="date" class="form-control" id="ef-date" required value="${new Date().toISOString().substring(0,10)}"></div>
</div>
${employees.length ? '' : '<div class="alert alert-info" style="margin-top:10px">لا يوجد موظفون في هذا القسم.</div>'}
</div>
</div>
<div id="neval-body"><div class="alert alert-info">اختر الموظف لعرض نموذج التقييم.</div></div>`;
}

// جسم النموذج القطاعي (محزم) — نفس تجربة التقييم الحالية بدون بطاقة الموظف/التاريخ (أصبحت مشتركة)
function renderSectionEvalBody() {
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
return `<form id="new-eval-form">
<div class="card">
<div class="card-header"><div class="card-title">📋 تفاصيل الملاحظة</div></div>
<div class="card-body">
<div class="form-group"><label class="form-label">🔍 الملاحظة المرصودة *</label>${buildObservedIssueSelect()}</div>
${buildCommTypeField(null)}
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

// ===== الأدوات المشتركة للتفرّع حسب القسم =====
function weekStartSaturdayJS(dateStr) {
const d = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();
const off = (d.getDay() + 1) % 7; // 6=السبت → 0
d.setDate(d.getDate() - off);
return d.toISOString().substring(0, 10);
}
async function loadTemplateFor(deptId) {
window._templates = window._templates || {};
if (window._templates[deptId]) return window._templates[deptId];
const tok = window.getSessionToken ? getSessionToken() : null;
const { data } = await window.sb.rpc('get_template_for_department', { p_session_token: tok, p_department_id: parseInt(deptId) });
window._templates[deptId] = (Array.isArray(data) ? data[0] : data) || { ok:false };
return window._templates[deptId];
}
async function renderEvalBodyForEmployee(empId) {
const body = document.getElementById('neval-body');
if (!body) return;
if (!empId) { body.innerHTML = '<div class="alert alert-info">اختر الموظف لعرض نموذج التقييم.</div>'; return; }
const emp = DB.getUser(empId);
await loadDepartments();
const dept = (emp && emp.department_id) ? (window._departments || []).find(d => d.id === emp.department_id) : null;
const type = dept ? dept.template_type : 'section_based';
if (type === 'task_based_weekly') {
body.innerHTML = '<div class="card"><div class="card-body">⏳ جارٍ تحميل النموذج…</div></div>';
const tpl = await loadTemplateFor(dept.id);
if (!tpl || !tpl.ok || !tpl.exists) { body.innerHTML = '<div class="alert alert-danger">لا يوجد نموذج لهذا القسم</div>'; return; }
body.innerHTML = renderWeeklyEvalBody(dept, emp, tpl.template);
attachWeeklyHandlers(dept, emp, tpl.template);
} else if (type === 'pdf_based_weekly') {
body.innerHTML = '<div class="card"><div class="card-body">⏳ جارٍ التحميل…</div></div>';
await renderPdfEvalInto(body, emp);
} else {
body.innerHTML = renderSectionEvalBody();
attachSectionEvalHandlers();
}
}
function weeklyTaskRowHTML(dims) {
const cells = dims.map(dm => {
if (dm.type === 'choice') {
const opts = (dm.options || []).map(o => `<option value="${o}">${o}</option>`).join('');
return `<td><select class="form-control wk-dim" data-dim="${dm.id}">${opts}</select></td>`;
}
return `<td><input type="number" min="${dm.min!=null?dm.min:0}" max="${dm.max!=null?dm.max:100}" class="form-control wk-dim" data-dim="${dm.id}" value="0" style="min-width:80px"></td>`;
}).join('');
return `<tr><td><input type="text" class="form-control wk-taskname" placeholder="اسم المهمة" style="min-width:140px"></td>${cells}<td><button type="button" class="btn btn-sm btn-danger wk-del-task">✕</button></td></tr>`;
}
function renderWeeklyEvalBody(dept, emp, template) {
const job = emp.job_role;
const jobLabel = ROLE_NAMES[job] || job || '—';
const dims = (template.task_scoring && template.task_scoring.dimensions) || [];
const kpis = (template.role_kpis && template.role_kpis[job]) || [];
const ws = weekStartSaturdayJS();
const we = weekStartSaturdayJS(ws); const weD = new Date(ws + 'T00:00:00'); weD.setDate(weD.getDate() + 6);
const weStr = weD.toISOString().substring(0, 10);
const dimHead = dims.map(dm => `<th>${Utils.escape(dm.name)}</th>`).join('');
let kpiHTML;
if (!job) kpiHTML = '<div class="alert alert-warning">هذا الموظف بلا دور وظيفي — عيّن الدور من صفحة الموظفين لعرض مؤشراته.</div>';
else if (!kpis.length) kpiHTML = '<div class="alert alert-info">لا توجد مؤشرات معرّفة لهذا الدور في النموذج.</div>';
else kpiHTML = kpis.map(k => {
const hint = k.type === 'count' ? `الهدف: ${k.target!=null?k.target:'غير محدّد'}${k.lower_is_better?' — أقل أفضل':''}` : 'نسبة مئوية 0-100';
return `<div class="form-group"><label class="form-label">${Utils.escape(k.name)} <span style="color:var(--muted);font-size:12px">(${hint})</span></label><input type="number" min="0" class="form-control" data-kpi="${k.id}" placeholder="0"></div>`;
}).join('');
return `<form id="weekly-eval-form">
<div class="card"><div class="card-header"><div class="card-title">📅 التقييم الأسبوعي — ${jobLabel}</div></div>
<div class="card-body"><div class="grid grid-2">
<div class="form-group"><label class="form-label">بداية الأسبوع (السبت) *</label><input type="date" class="form-control" id="wk-start" value="${ws}"></div>
<div class="form-group"><label class="form-label">نهاية الأسبوع *</label><input type="date" class="form-control" id="wk-end" value="${weStr}"></div>
</div></div></div>
<div class="card"><div class="card-header"><div class="card-title">✅ المهام</div><button type="button" class="btn btn-sm btn-secondary" id="wk-add-task">➕ إضافة مهمة</button></div>
<div class="card-body" style="padding:0;overflow-x:auto">
<table class="table" id="wk-tasks"><thead><tr><th>المهمة</th>${dimHead}<th></th></tr></thead><tbody></tbody></table>
</div></div>
<div class="card"><div class="card-header"><div class="card-title">📊 مؤشرات الأداء (${jobLabel})</div></div><div class="card-body">${kpiHTML}</div></div>
<div class="card"><div class="card-body"><div class="form-group"><label class="form-label">ملاحظات</label><textarea class="form-control" id="wk-notes" rows="2"></textarea></div></div></div>
<div class="card" style="position:sticky;bottom:0;z-index:10;border:2px solid var(--primary)"><div class="card-body">
<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:14px">
<div><div style="font-size:13px;color:var(--muted)">النتيجة التقديرية</div><div id="wk-score" style="font-size:32px;font-weight:800;color:var(--primary)">—</div><div id="wk-grade"></div></div>
<div style="display:flex;gap:10px"><button type="button" class="btn btn-secondary" data-nav="evaluations">إلغاء</button><button type="submit" class="btn btn-success" style="padding:12px 26px;font-size:15px">💾 حفظ التقييم الأسبوعي</button></div>
</div></div></div>
</form>`;
}
function collectWeeklyTasks() {
const tasks = [];
document.querySelectorAll('#wk-tasks tbody tr').forEach(tr => {
const name = ((tr.querySelector('.wk-taskname') || {}).value || '').trim();
const o = { name: name };
tr.querySelectorAll('.wk-dim').forEach(inp => { o[inp.dataset.dim] = parseFloat(inp.value) || 0; });
tasks.push(o);
});
return tasks.filter(t => t.name || t.completion || t.timeliness || t.quality);
}
function collectWeeklyKpis() {
const k = {};
document.querySelectorAll('[data-kpi]').forEach(inp => { if (inp.value !== '') k[inp.dataset.kpi] = parseFloat(inp.value) || 0; });
return k;
}
function computeTaskBasedPreview(tasks, kpis, kpiDefs) {
let tsum = 0, tn = 0;
tasks.forEach(t => { tsum += ((+t.completion||0) + (+t.timeliness||0) + (+t.quality||0)) / 3; tn++; });
const tasksAvg = tn ? tsum / tn : 0;
let ksum = 0, kn = 0;
(kpiDefs || []).forEach(k => {
const v = kpis[k.id] != null ? kpis[k.id] : 0;
const lower = !!k.lower_is_better; let nrm;
if (k.type === 'percentage') nrm = lower ? 100 - v : v;
else { const tgt = k.target; if (tgt == null || tgt === 0) nrm = null; else if (lower) nrm = 100 - Math.max(0, v - tgt) / tgt * 100; else nrm = v / tgt * 100; }
if (nrm != null) { nrm = Math.min(100, Math.max(0, nrm)); ksum += nrm; kn++; }
});
const kpisAvg = kn ? ksum / kn : 0;
return Math.round(((tasksAvg + kpisAvg) / 2) * 100) / 100;
}
function attachWeeklyHandlers(dept, emp, template) {
const form = document.getElementById('weekly-eval-form');
if (!form) return;
const dims = (template.task_scoring && template.task_scoring.dimensions) || [];
const kpiDefs = (template.role_kpis && template.role_kpis[emp.job_role]) || [];
const tbody = form.querySelector('#wk-tasks tbody');
const updateLive = () => {
const score = computeTaskBasedPreview(collectWeeklyTasks(), collectWeeklyKpis(), kpiDefs);
document.getElementById('wk-score').textContent = score + ' / 100';
document.getElementById('wk-grade').innerHTML = Utils.gradeBadge(score);
};
const bindLive = () => { form.querySelectorAll('.wk-dim,[data-kpi]').forEach(el => { el.oninput = updateLive; el.onchange = updateLive; }); };
const addRow = () => { tbody.insertAdjacentHTML('beforeend', weeklyTaskRowHTML(dims)); bindLive(); };
form.querySelector('#wk-add-task').addEventListener('click', addRow);
tbody.addEventListener('click', e => { if (e.target.closest('.wk-del-task')) { e.target.closest('tr').remove(); updateLive(); } });
addRow();
updateLive();
form.addEventListener('submit', async e => {
e.preventDefault();
const btn = form.querySelector('button[type=submit]');
await submitWithFeedback(btn, 'جاري حفظ التقييم الأسبوعي...', null, async () => {
const tasks = collectWeeklyTasks();
if (!tasks.length) { Toast.error('أضف مهمة واحدة على الأقل'); return false; }
const ws = document.getElementById('wk-start').value, we = document.getElementById('wk-end').value;
if (!ws || !we) { Toast.error('حدّد بداية ونهاية الأسبوع'); return false; }
const kpis = collectWeeklyKpis();
const tok = window.getSessionToken ? getSessionToken() : null;
const { data, error } = await window.sb.rpc('create_weekly_evaluation', { p_session_token: tok, p_employee_id: emp.id, p_week_start: ws, p_week_end: we, p_tasks: tasks, p_kpis: kpis });
const row = (!error && Array.isArray(data) && data[0]) ? data[0] : null;
if (!row || !row.ok) { const m = (row && row.message) || (error && error.message) || 'تعذّر حفظ التقييم'; if (!handleSessionError(m)) Toast.error(m); return false; }
if (window.SupabaseSync && SupabaseSync.pullAll) { try { await SupabaseSync.pullAll(true); } catch(_){} }
try { if (row.evaluation_id && !DB.getEvaluation(row.evaluation_id) && window.sb) { const { data: ne } = await window.sb.from('evaluations').select('*').eq('id', row.evaluation_id).maybeSingle(); if (ne) { DB.data.evaluations = (DB.data.evaluations || []).filter(x => x.id !== ne.id).concat(ne); localStorage.setItem(DB.KEY, JSON.stringify(DB.data)); } } } catch(_){}
Toast.success(`تم حفظ التقييم الأسبوعي — ${row.percentage}% (${row.grade})`);
navigate('view-evaluation', { id: row.evaluation_id });
return true;
});
});
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
const empSel = document.getElementById('ef-employee');
if (!empSel) return;
empSel.addEventListener('change', () => renderEvalBodyForEmployee(parseInt(empSel.value)));
if (currentParams && currentParams.emp) { empSel.value = String(currentParams.emp); }
if (empSel.value) renderEvalBodyForEmployee(parseInt(empSel.value));
}

function attachSectionEvalHandlers() {
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

const commType = (document.getElementById('ef-commtype')||{}).value || '';
const commRef = ((document.getElementById('ef-commref')||{}).value || '').trim();
if (!commType) { Toast.error('يرجى اختيار نوع التواصل'); return false; }
if (!commRef) { Toast.error(commType==='chat' ? 'يرجى لصق رابط المحادثة' : 'يرجى إدخال رقم/كود المكالمة'); return false; }

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
p_items: items,
p_communication_type: commType,
p_communication_reference: commRef
});
const row = (!error && Array.isArray(data) && data[0]) ? data[0] : null;
if (!row || !row.ok) { const msg=(row&&row.message)||(error&&error.message)||'تعذّر حفظ التقييم'; const h=handleSessionError(msg); if(!h) Toast.error(msg); return false; }
newEvalId = row.evaluation_id; newPct = row.percentage; newGrade = row.grade;
if (window.SupabaseSync && SupabaseSync.pullAll) { try{ await SupabaseSync.pullAll(true); }catch(_){} }
// ضمان حتمي: إن لم يظهر التقييم الجديد بعد السحب (أي سباق توقيت)، اجلبه مباشرةً
// وادمجه في الذاكرة قبل فتح صفحته — حتى لا تظهر "التقييم غير موجود" إطلاقاً.
try {
  if (newEvalId && !DB.getEvaluation(newEvalId) && window.sb) {
    const { data: ne } = await window.sb.from('evaluations').select('*').eq('id', newEvalId).maybeSingle();
    if (ne) {
      DB.data.evaluations = (DB.data.evaluations || []).filter(e => e.id !== ne.id).concat(ne);
      localStorage.setItem(DB.KEY, JSON.stringify(DB.data));
    }
  }
} catch(_){}
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
communication_type: commType, communication_reference: commRef,
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
// ============================================
// Creative Gene — تقييم PDF أسبوعي (م3-ج)
// ============================================
function cgToken() { return window.getSessionToken ? getSessionToken() : null; }
function isCreativeGeneDept(deptId) {
const d = (window._departments||[]).find(x => x.id === deptId);
return !!(d && d.template_type === 'pdf_based_weekly');
}
function weekEndStr(ws) { const d = new Date(ws + 'T00:00:00'); d.setDate(d.getDate()+6); return d.toISOString().substring(0,10); }
async function fetchCgStatusRow(employeeId, weekStart) {
try { const { data } = await window.sb.from('creative_gene_weekly_status').select('*').eq('employee_id', employeeId).eq('week_start', weekStart).maybeSingle(); return data || null; }
catch(_) { return null; }
}
async function uploadCreativeGenePdf(employeeId, weekStart, file) {
if (!file) { Toast.error('اختر ملفاً'); return null; }
if (file.type !== 'application/pdf') { Toast.error('الملف يجب أن يكون PDF فقط'); return null; }
let maxMb = 20;
try { const tpl = await loadTemplateFor(cgDeptId()); if (tpl && tpl.ok && tpl.template && tpl.template.pdf_max_size_mb) maxMb = Math.min(20, tpl.template.pdf_max_size_mb); } catch(_){}
if (file.size > maxMb*1024*1024) { Toast.error(`الحد الأقصى ${maxMb} ميجابايت`); return null; }
const safe = (file.name||'file.pdf').replace(/[^\w.\-]+/g,'_');
const path = employeeId + '/' + weekStart + '/' + Date.now() + '_' + safe;
try {
const up = await window.sb.storage.from('creative-gene-pdfs').upload(path, file, { contentType:'application/pdf', upsert:false });
if (up.error) { Toast.error('تعذّر رفع الملف: ' + up.error.message); return null; }
const { data, error } = await window.sb.rpc('upload_creative_gene_pdf', { p_session_token: cgToken(), p_employee_id: employeeId, p_week_start: weekStart, p_file_path: path, p_file_name: file.name });
const row = Array.isArray(data)?data[0]:data;
if (error || !row || !row.ok) {
const m = (row&&row.message)||(error&&error.message)||'فشل تسجيل الملف';
if (!handleSessionError(m)) Toast.error(m);
try { await window.sb.storage.from('creative-gene-pdfs').remove([path]); } catch(_){}
return null;
}
Toast.success('تم رفع الملف بنجاح');
return { path: path, name: file.name };
} catch(e) { Toast.error(e.message); return null; }
}
function pickPdfAndUpload(employeeId, weekStart, onDone) {
const inp = document.createElement('input');
inp.type = 'file'; inp.accept = 'application/pdf';
inp.onchange = async () => { const f = inp.files && inp.files[0]; if (!f) return; const res = await uploadCreativeGenePdf(employeeId, weekStart, f); if (res && onDone) onDone(res); };
inp.click();
}
async function openCgPdfByEval(evalId) {
const { data, error } = await window.sb.rpc('get_pdf_download_url', { p_session_token: cgToken(), p_evaluation_id: evalId });
const row = Array.isArray(data)?data[0]:data;
if (error || !row || !row.ok || !row.url) { const m=(row&&row.message)||'تعذّر فتح الملف'; if(!handleSessionError(m)) Toast.error(m); return; }
window.open(row.url, '_blank');
}
async function openCgPdfByWeek(employeeId, weekStart) {
const { data, error } = await window.sb.rpc('get_cg_week_pdf_url', { p_session_token: cgToken(), p_employee_id: employeeId, p_week_start: weekStart });
const row = Array.isArray(data)?data[0]:data;
if (error || !row || !row.ok || !row.url) { const m=(row&&row.message)||'تعذّر فتح الملف'; if(!handleSessionError(m)) Toast.error(m); return; }
window.open(row.url, '_blank');
}

// ---- شاشة "تقييم جديد" لموظف Creative Gene ----
function actionTypeLabel(t) { return ({warning:'⚠️ تنبيه', training:'📚 تدريب', praise:'👏 إشادة', other:'📌 أخرى'})[t] || t; }
function cgNoSupervisorList() { return DB.getUsers({ role:'employee' }).filter(e => isCreativeGeneDept(e.department_id) && !e.supervisor_id); }
function cgNoSupervisorCardHTML() {
const list = cgNoSupervisorList();
if (!list.length) return '';
return `<div class="card" style="border:2px solid var(--warning);background:#fffbeb;margin-bottom:20px"><div class="card-body" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
<div><strong>⚠️ ${list.length} موظف Creative Gene بلا مشرف</strong><div style="font-size:13px;color:var(--muted)">الإجراءات عليهم من admin فقط — يُنصح بتعيين مشرف.</div></div>
<button class="btn btn-warning btn-sm" onclick="showCgNoSupervisorList()">عرض القائمة</button>
</div></div>`;
}
function showCgNoSupervisorList() {
const list = cgNoSupervisorList();
const rows = list.map(e => `<tr><td>${Utils.escape(e.full_name)}</td><td>${Utils.escape(e.employee_number||'-')}</td><td><button class="btn btn-sm btn-secondary" onclick="Modal.close();navigate('employees')">تعيين مشرف</button></td></tr>`).join('') || '<tr><td colspan="3" style="text-align:center">لا يوجد</td></tr>';
Modal.show('موظفو Creative Gene بلا مشرف', `<table class="table"><thead><tr><th>الاسم</th><th>الرقم الوظيفي</th><th></th></tr></thead><tbody>${rows}</tbody></table>`, `<button class="btn btn-secondary" onclick="Modal.close()">إغلاق</button>`);
}
function objectionDeadline(ev) {
const hours = (ev.template_snapshot && ev.template_snapshot.objection_window_hours) || 48;
if (ev.objection_deadline) return new Date(ev.objection_deadline);
const c = new Date(ev.created_at); c.setHours(c.getHours() + hours); return c;
}
function objectionWindowOpen(ev) { try { return new Date() < objectionDeadline(ev); } catch(_) { return false; } }
async function fetchObjection(evalId) { try { const { data } = await window.sb.from('creative_gene_objections').select('*').eq('evaluation_id', evalId).maybeSingle(); return data || null; } catch(_) { return null; } }
async function fetchAction(evalId) { try { const { data } = await window.sb.from('creative_gene_actions').select('*').eq('evaluation_id', evalId).order('id', { ascending:false }).limit(1); return (data && data[0]) || null; } catch(_) { return null; } }
function raiseObjectionFlow(ev, onDone) {
const dl = objectionDeadline(ev);
const remMs = dl - new Date();
const remH = Math.max(0, Math.floor(remMs/3600000)), remM = Math.max(0, Math.floor((remMs%3600000)/60000));
Modal.show('تقديم اعتراض', `
<div class="alert alert-info">⏳ الوقت المتبقّي لتقديم الاعتراض: <strong>${remH} ساعة و${remM} دقيقة</strong></div>
<div class="form-group"><label class="form-label">نص الاعتراض *</label><textarea class="form-control" id="obj-text" rows="4" placeholder="اشرح سبب اعتراضك على التقييم..."></textarea></div>`,
`<button class="btn btn-secondary" onclick="Modal.close()">إلغاء</button><button class="btn btn-warning" id="obj-submit">⚖️ إرسال الاعتراض</button>`);
document.getElementById('obj-submit').addEventListener('click', async () => {
const text = ((document.getElementById('obj-text')||{}).value || '').trim();
if (!text) { Toast.error('نص الاعتراض مطلوب'); return; }
const { data, error } = await window.sb.rpc('raise_objection', { p_session_token: cgToken(), p_evaluation_id: ev.id, p_objection_text: text });
const r = Array.isArray(data)?data[0]:data;
if (error || !r || !r.ok) { const m=(r&&r.message)||(error&&error.message)||'تعذّر تقديم الاعتراض'; if(!handleSessionError(m)) Toast.error(m); return; }
Modal.close(); Toast.success('تم تقديم الاعتراض'); if (onDone) onDone();
});
}

async function fetchCgRoleTemplate(jobRole) {
try {
let q = window.sb.from('evaluation_templates').select('*').eq('department_id', cgDeptId()).eq('is_active', true);
q = jobRole ? q.eq('job_role', jobRole) : q.is('job_role', null);
const { data } = await q.limit(1);
return (data && data[0]) ? data[0] : null;
} catch(_) { return null; }
}
async function renderPdfEvalInto(body, emp) {
const ws = (currentParams && currentParams.week) ? currentParams.week : weekStartSaturdayJS();
await loadDepartments();
// Creative Gene يتطلّب مسمى وظيفي (دور) لاختيار النموذج
if (!emp.job_role) {
body.innerHTML = `<div class="card"><div class="card-body">
<div class="alert alert-danger">لا يمكن إنشاء التقييم — الموظف <strong>${Utils.escape(emp.full_name)}</strong> بلا مسمى وظيفي. الرجاء تعيين المسمى أولاً من إدارة الموظفين.</div>
<button class="btn btn-primary" onclick="navigate('employees')">الذهاب لإدارة الموظفين</button>
</div></div>`;
return;
}
let tpl = await fetchCgRoleTemplate(emp.job_role); let usedDefault = false;
if (!tpl) { tpl = await fetchCgRoleTemplate(null); usedDefault = true; }
if (!tpl) { body.innerHTML = '<div class="alert alert-danger">لا يوجد نموذج لهذا المسمى ولا نموذج افتراضي</div>'; return; }
const criteria = (tpl.template_jsonb && tpl.template_jsonb.criteria) || [];
const actionTypes = (tpl.template_jsonb && Array.isArray(tpl.template_jsonb.allowed_action_types) && tpl.template_jsonb.allowed_action_types.length) ? tpl.template_jsonb.allowed_action_types : ['warning','training','praise','other'];
const roleLabel = ((JOB_ROLES.find(x => x[0] === emp.job_role)||[])[1]) || emp.job_role;
const tplLabel = usedDefault ? 'النموذج الافتراضي' : ('نموذج ' + roleLabel);
const row = await fetchCgStatusRow(emp.id, ws);
body.innerHTML = pdfEvalFormHTML(emp, ws, row, criteria, roleLabel, tplLabel, actionTypes);
attachPdfEvalHandlers(emp, ws, row, criteria, roleLabel, tplLabel, actionTypes);
}
function pdfEvalFormHTML(emp, ws, row, criteria, roleLabel, tplLabel, actionTypes) {
const _acts = (Array.isArray(actionTypes) && actionTypes.length) ? actionTypes : ['warning','training','praise','other'];
const st = row ? row.status : 'not_uploaded';
let fileBlock;
if (!row || st === 'not_uploaded') {
fileBlock = `<div class="alert alert-warning">🔴 لم يرفع الموظف ملف PDF لهذا الأسبوع.</div>
<button type="button" class="btn btn-secondary" id="pdf-upload-behalf">📎 رفع ملف نيابةً عن الموظف</button>`;
} else {
fileBlock = `<div class="alert ${st==='uploaded_pending'?'alert-info':'alert-success'}">${st==='uploaded_pending'?'🟡 تم رفع الملف — بانتظار التقييم':'🟢 تم تقييم هذا الأسبوع'}</div>
<button type="button" class="btn btn-primary" id="pdf-open">📄 فتح ملف PDF</button>`;
}
const canEval = row && st === 'uploaded_pending';
const evaluatedNote = st !== 'not_uploaded' && st !== 'uploaded_pending' ? `<div class="alert alert-info" style="margin-top:12px">تم تقييم هذا الأسبوع. لإعادة التقييم افتح البوابة أو احذف التقييم.</div>` : '';
const critHTML = (criteria||[]).map(c => `<div class="form-group"><label class="form-label">${Utils.escape(c.name)} <span style="color:var(--muted);font-size:12px">(0 - ${c.weight})</span></label><input type="number" min="0" max="${c.weight}" step="0.5" class="form-control pdf-crit" data-cid="${c.id}" data-weight="${c.weight}" placeholder="0 - ${c.weight}"></div>`).join('');
return `<form id="pdf-eval-form">
<div class="card"><div class="card-header"><div class="card-title">📄 التقييم الأسبوعي (PDF) — ${Utils.escape(emp.full_name)}</div></div>
<div class="card-body">
<div style="padding:10px 12px;background:#f3e8ff;border-radius:8px;margin-bottom:12px;font-size:13px">المسمى: <strong>${Utils.escape(roleLabel||'—')}</strong> &nbsp;|&nbsp; النموذج المُستخدم: <strong>${Utils.escape(tplLabel||'—')}</strong></div>
<div class="grid grid-2">
<div class="form-group"><label class="form-label">بداية الأسبوع (السبت)</label><input type="date" class="form-control" id="pdf-ws" value="${ws}"></div>
<div class="form-group"><label class="form-label">نهاية الأسبوع</label><input type="date" class="form-control" value="${weekEndStr(ws)}" disabled></div>
</div>
${fileBlock}${evaluatedNote}
</div></div>
${canEval ? `<div class="card"><div class="card-header"><div class="card-title">📝 التقييم — درجة كل معيار محدودة بوزنه</div></div><div class="card-body">
${critHTML}
<div class="form-group"><label class="form-label">الملاحظات (اختياري)</label><textarea class="form-control" id="pdf-notes" rows="3"></textarea></div>
<div style="border:2px solid var(--warning);background:#fffbeb;border-radius:10px;padding:14px;margin-top:8px">
<div style="font-weight:800;margin-bottom:4px">🎯 اتخاذ إجراء <span style="color:var(--danger)">*</span></div>
<div style="font-size:12px;color:var(--muted);margin-bottom:10px">حدّد الإجراء المطلوب — سيراجعه المشرف ويعتمده (أو يعدّله).</div>
<div class="grid grid-2">
<div class="form-group" style="margin:0"><label class="form-label">نوع الإجراء</label><select class="form-control" id="pdf-action-type">${_acts.map(t=>`<option value="${t}">${actionTypeLabel(t)}</option>`).join('')}</select></div>
<div class="form-group" style="margin:0"><label class="form-label">تفاصيل الإجراء</label><textarea class="form-control" id="pdf-action-details" rows="2" placeholder="اكتب تفاصيل الإجراء المطلوب..."></textarea></div>
</div>
</div>
<div style="padding:14px;background:#f0f7ff;border-radius:10px;display:flex;justify-content:space-between;align-items:center;margin-top:12px">
<span style="font-weight:700">الدرجة الكلية (مجموع)</span>
<span id="pdf-live-total" style="font-size:28px;font-weight:800;color:var(--primary)">—</span>
</div>
</div></div>
<div class="card" style="position:sticky;bottom:0;z-index:10;border:2px solid var(--primary)"><div class="card-body" style="display:flex;justify-content:flex-end;gap:10px">
<button type="button" class="btn btn-secondary" data-nav="evaluations">إلغاء</button>
<button type="submit" class="btn btn-success" id="pdf-save" disabled style="padding:12px 26px;font-size:15px">💾 حفظ التقييم</button>
</div></div>` : ''}
</form>`;
}
function attachPdfEvalHandlers(emp, ws, row, criteria, roleLabel, tplLabel, actionTypes) {
const form = document.getElementById('pdf-eval-form');
if (!form) return;
const wsInp = document.getElementById('pdf-ws');
if (wsInp) wsInp.addEventListener('change', async () => {
const body = document.getElementById('neval-body');
if (!body) return;
body.innerHTML = '<div class="card"><div class="card-body">⏳ جارٍ التحميل…</div></div>';
const newWs = wsInp.value;
const r = await fetchCgStatusRow(emp.id, newWs);
body.innerHTML = pdfEvalFormHTML(emp, newWs, r, criteria, roleLabel, tplLabel, actionTypes);
attachPdfEvalHandlers(emp, newWs, r, criteria, roleLabel, tplLabel, actionTypes);
});
const openBtn = document.getElementById('pdf-open');
if (openBtn) openBtn.addEventListener('click', () => openCgPdfByWeek(emp.id, ws));
const behalf = document.getElementById('pdf-upload-behalf');
if (behalf) behalf.addEventListener('click', () => pickPdfAndUpload(emp.id, ws, () => renderEvalBodyForEmployee(emp.id)));
const crits = form.querySelectorAll('.pdf-crit'), save = document.getElementById('pdf-save');
const updateTotal = () => {
let sum=0, allValid = crits.length > 0;
crits.forEach(i => { const v=parseFloat(i.value), w=parseFloat(i.dataset.weight)||0; if(!(v>=0 && v<=w)){allValid=false;} else {sum+=v;} });
const tEl = document.getElementById('pdf-live-total'); if (tEl) tEl.textContent = allValid ? (Math.round(sum*100)/100) + ' / 100' : '—';
if (save) save.disabled = !allValid;
};
crits.forEach(i => i.addEventListener('input', updateTotal));
form.addEventListener('submit', async e => {
e.preventDefault();
const btn = document.getElementById('pdf-save');
await submitWithFeedback(btn, 'جاري حفظ التقييم...', null, async () => {
const scores = {}; let ok = crits.length > 0;
crits.forEach(i => { const v=parseFloat(i.value), w=parseFloat(i.dataset.weight)||0; if(!(v>=0 && v<=w)) ok=false; scores[i.dataset.cid]=v; });
if (!ok) { Toast.error('كل درجة يجب أن تكون بين 0 والحد الأقصى للمعيار'); return false; }
if (!row || !row.pdf_file_path) { Toast.error('لا يوجد ملف PDF مرفوع'); return false; }
const notes = ((document.getElementById('pdf-notes')||{}).value || '').trim();
const actionType = ((document.getElementById('pdf-action-type')||{}).value || '').trim();
const actionDetails = ((document.getElementById('pdf-action-details')||{}).value || '').trim();
if (!actionType) { Toast.error('اختر نوع الإجراء'); return false; }
if (!actionDetails) { Toast.error('تفاصيل الإجراء مطلوبة'); return false; }
const { data, error } = await window.sb.rpc('create_evaluation', {
p_session_token: cgToken(), p_employee_id: emp.id, p_evaluation_date: ws,
p_criteria_scores: scores, p_pdf_file_path: row.pdf_file_path, p_pdf_file_name: (row.pdf_file_path||'').split('/').pop(),
p_evaluation_notes: notes, p_week_start: ws
});
const rr = (!error && Array.isArray(data) && data[0]) ? data[0] : null;
if (!rr || !rr.ok) { const m=(rr&&rr.message)||(error&&error.message)||'تعذّر حفظ التقييم'; if(!handleSessionError(m)) Toast.error(m); return false; }
if (window.SupabaseSync && SupabaseSync.pullAll) { try{ await SupabaseSync.pullAll(true); }catch(_){} }
try { if (rr.evaluation_id && !DB.getEvaluation(rr.evaluation_id) && window.sb) { const { data: ne } = await window.sb.from('evaluations').select('*').eq('id', rr.evaluation_id).maybeSingle(); if (ne) { DB.data.evaluations = (DB.data.evaluations || []).filter(x => x.id !== ne.id).concat(ne); localStorage.setItem(DB.KEY, JSON.stringify(DB.data)); } } } catch(_){}
// حفظ الإجراء الذي حدّده موظف الجودة مع التقييم
try {
const { data: ad, error: aerr } = await window.sb.rpc('cg_set_eval_action', { p_session_token: cgToken(), p_evaluation_id: rr.evaluation_id, p_action_type: actionType, p_action_details: actionDetails });
const ar = Array.isArray(ad)?ad[0]:ad;
if (aerr || !ar || !ar.ok) { if (Toast.warning) Toast.warning((ar&&ar.message)||'حُفظ التقييم لكن تعذّر حفظ الإجراء — يمكن للمشرف إضافته'); }
} catch(_) { if (Toast.warning) Toast.warning('حُفظ التقييم لكن تعذّر حفظ الإجراء'); }
Toast.success(`تم حفظ التقييم — ${rr.percentage}% (${rr.grade})`);
navigate('view-evaluation', { id: rr.evaluation_id });
return true;
});
});
}

// ---- عرض تقييم PDF ----
function renderPdfEvalView(ev) {
const emp = DB.getUser(ev.employee_id), evr = DB.getUser(ev.evaluator_id);
const pct = ev.percentage;
const dept = emp ? (window._departments||[]).find(d => d.id === emp.department_id) : null;
const crit = (ev.template_snapshot && ev.template_snapshot.criteria) || [];
const scores = ev.section_scores || ev.items || {};
const critRows = crit.filter(c => scores[c.id] != null).map(c => `<tr><td>${Utils.escape(c.name)}</td><td><strong>${scores[c.id]} / ${c.weight}</strong></td></tr>`).join('');
return `<div class="page-header"><div><div class="page-title">📄 تقييم أسبوعي (PDF)</div><div class="page-subtitle">${emp?Utils.escape(emp.full_name):''} — ${ev.week_start||''} ← ${ev.week_end||''}</div></div><button class="btn btn-secondary" data-nav="evaluations">← رجوع</button></div>
<div class="card"><div class="card-body">
<div style="padding:10px 12px;background:#f3e8ff;border-radius:8px;margin-bottom:14px;font-size:13px">المسمى: <strong>${jobTitleCell(emp)}</strong> &nbsp;|&nbsp; القسم: ${deptBadgeHTML(dept)} &nbsp;|&nbsp; النموذج المُستخدم: <strong>${usedTemplateLabel(ev)}</strong></div>
<div style="display:flex;gap:32px;flex-wrap:wrap;align-items:center">
<div><div style="font-size:13px;color:var(--muted)">الدرجة الكلية</div><div style="font-size:34px;font-weight:800;color:var(--primary)">${pct} / 100</div>${passFailBadge(pct, emp?emp.department_id:cgDeptId())}</div>
<div><div style="font-size:13px;color:var(--muted)">المُقيِّم</div><div style="font-size:16px;font-weight:600">${evr?Utils.escape(evr.full_name):'—'}</div></div>
<div><div style="font-size:13px;color:var(--muted)">تاريخ التقييم</div><div style="font-size:16px;font-weight:600">${Utils.formatDate(ev.evaluation_date)}</div></div>
<div><button class="btn btn-primary" onclick="openCgPdfByEval(${ev.id})">📄 فتح ملف PDF</button></div>
</div></div></div>
${critRows ? `<div class="card"><div class="card-header"><div class="card-title">📊 المعايير التفصيلية</div></div><div class="card-body" style="padding:0"><table class="table"><thead><tr><th>المعيار</th><th>الدرجة / الحد الأقصى</th></tr></thead><tbody>${critRows}</tbody></table></div></div>` : ''}
${ev.evaluation_notes ? `<div class="card"><div class="card-header"><div class="card-title">📝 ملاحظات المُقيّم</div></div><div class="card-body">${Utils.escape(ev.evaluation_notes)}</div></div>` : ''}
<div id="pdf-view-extra"></div>`;
}
async function loadPdfViewExtra(id) {
const host = document.getElementById('pdf-view-extra');
if (!host) return;
const ev = DB.getEvaluation(id);
if (!ev || ev.template_type !== 'pdf_based_weekly') return;
const obj = await fetchObjection(id), act = await fetchAction(id);
let html = '';
if (obj) {
const stB = objBadge(obj.status);
html += `<div class="card" style="border-right:4px solid var(--warning)"><div class="card-header"><div class="card-title">⚖️ الاعتراض</div>${stB}</div><div class="card-body"><div>${Utils.escape(obj.objection_text)}</div>${obj.reviewer_response?`<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border)"><strong>رد الجودة:</strong> ${Utils.escape(obj.reviewer_response)}</div>`:''}</div></div>`;
}
if (act) {
const sup = DB.getUser(act.supervisor_id);
html += `<div class="card" style="border-right:4px solid var(--danger)"><div class="card-header"><div class="card-title">🎯 الإجراء المتخذ</div></div><div class="card-body"><div style="display:flex;gap:20px;flex-wrap:wrap"><div><div style="font-size:12px;color:var(--muted)">النوع</div>${actionTypeLabel(act.action_type)}</div><div><div style="font-size:12px;color:var(--muted)">المشرف</div>${sup?Utils.escape(sup.full_name):'—'}</div><div><div style="font-size:12px;color:var(--muted)">التاريخ</div>${Utils.formatDate(act.taken_at)}</div></div><div style="margin-top:8px">${Utils.escape(act.action_details)}</div></div></div>`;
}
host.innerHTML = html;
}

// ملاحظة (م10): حُذفت بطاقة "تقييم هذا الأسبوع" من لوحة موظف Creative Gene —
// الرفع صار حصراً عبر خيار "رفع التقييم" في القائمة الجانبية (شاشة cg-upload).

// ---- شاشة "اعتراضات Creative Gene" (admin/quality) ----
function renderCgObjections() {
if (!(currentUser.role === 'admin' || currentUser.role === 'quality_officer')) return '<div class="alert alert-danger">غير مصرح</div>';
return `<div class="page-header"><div><div class="page-title">⚖️ اعتراضات Creative Gene</div><div class="page-subtitle">مراجعة اعتراضات الموظفين على تقييماتهم</div></div></div>
<div id="cgobj-list"><div class="card"><div class="card-body">⏳ جارٍ التحميل…</div></div></div>`;
}
function critBreakdownHTML(ev) {
const crit = (ev.template_snapshot && ev.template_snapshot.criteria) || [];
const scores = ev.section_scores || ev.items || {};
const rows = crit.filter(c => scores[c.id] != null).map(c => `<div style="display:flex;justify-content:space-between;padding:3px 0"><span>${Utils.escape(c.name)} <span style="color:var(--muted);font-size:11px">(${c.weight}%)</span></span><strong>${scores[c.id]}</strong></div>`).join('');
if (!rows) return '';
return `<div style="background:#f8fafc;padding:10px;border-radius:8px;margin-bottom:10px">${rows}<div style="display:flex;justify-content:space-between;padding-top:6px;border-top:1px solid var(--border);margin-top:4px"><strong>الدرجة الكلية</strong><strong style="color:var(--primary)">${ev.percentage}%</strong></div></div>`;
}
async function loadCgObjections() {
const host = document.getElementById('cgobj-list');
if (!host) return;
const { data, error } = await window.sb.from('creative_gene_objections').select('*').order('raised_at', { ascending:false });
if (error) { if(!handleSessionError(error.message)) host.innerHTML = `<div class="alert alert-danger">${Utils.escape(error.message)}</div>`; return; }
const objs = data || [];
const pending = objs.filter(o => o.status === 'pending');
const history = objs.filter(o => o.status !== 'pending');
const canReview = (currentUser.role==='quality_officer' || currentUser.role==='admin');
const rowHtml = (o) => { const emp = DB.getUser(o.employee_id), ev = DB.getEvaluation(o.evaluation_id);
const stB = objBadge(o.status);
const act = (o.status==='pending' && canReview)
? `<button class="btn btn-sm btn-primary" onclick="reviewObjectionModal(${o.id})">⚖️ الرد على الاعتراض</button> <button class="btn btn-sm btn-secondary" onclick="openCgPdfByEval(${o.evaluation_id})">📄</button>`
: `<button class="btn btn-sm btn-secondary" onclick="navigate('view-evaluation',{id:${o.evaluation_id}})">عرض التقييم</button> <button class="btn btn-sm btn-secondary" onclick="openCgPdfByEval(${o.evaluation_id})">📄</button>`;
return `<tr><td>${emp?Utils.escape(emp.full_name):'-'}</td><td>${ev?Utils.formatDate(ev.evaluation_date):Utils.formatDate(o.raised_at)}</td><td>${Utils.escape((o.objection_text||'').slice(0,70))}</td><td>${stB}</td><td style="white-space:nowrap">${act}</td></tr>`;
};
const table = (arr, empty) => arr.length ? `<div class="card"><div class="card-body" style="padding:0;overflow-x:auto"><table class="table"><thead><tr><th>الموظف</th><th>تاريخ التقييم</th><th>الاعتراض</th><th>الحالة</th><th></th></tr></thead><tbody>${arr.map(rowHtml).join('')}</tbody></table></div></div>` : `<div class="alert alert-info">${empty}</div>`;
host.innerHTML = `
<div class="page-header" style="margin-bottom:8px"><div class="page-title" style="font-size:16px">🟡 اعتراضات مفتوحة (${pending.length})</div></div>
${table(pending, 'لا توجد اعتراضات مفتوحة.')}
<div class="page-header" style="margin:20px 0 8px"><div class="page-title" style="font-size:16px">📚 السجل التاريخي (${history.length})</div></div>
${table(history, 'لا يوجد سجل بعد.')}`;
}
function objBadge(s) {
return s==='accepted' ? '<span class="badge badge-success">مقبول</span>'
 : s==='partial' ? '<span class="badge" style="background:#dbeafe;color:#1e40af;border:1px solid #93c5fd">قبول جزئي</span>'
 : s==='rejected' ? '<span class="badge badge-danger">مرفوض</span>'
 : '<span class="badge badge-warning">قيد المراجعة</span>';
}
// درجة نجاح القسم (م9) — من الأقسام المُحمّلة، مع افتراضي (CG=90، غيره=80)
function deptPassScore(deptId) { const d=(window._departments||[]).find(x=>x.id===deptId); return (d && d.pass_score!=null) ? d.pass_score : (deptId===cgDeptId()?90:80); }
function passFailBadge(percentage, deptId) { const ps=deptPassScore(deptId); const pass=(parseFloat(percentage)>=ps); return `<span class="badge ${pass?'badge-success':'badge-danger'}" title="درجة النجاح للقسم: ${ps}">${pass?'✅ ناجح':'❌ راسب'}</span>`; }
async function reviewObjectionModal(objId) {
if (!(currentUser.role === 'quality_officer' || currentUser.role === 'admin')) { Toast.error('مراجعة الاعتراض للجودة أو المدير فقط'); return; }
const { data } = await window.sb.from('creative_gene_objections').select('*').eq('id', objId).maybeSingle();
if (!data) { Toast.error('الاعتراض غير موجود'); return; }
if (data.status !== 'pending') { Toast.info('تمت مراجعة هذا الاعتراض مسبقاً'); return; }
const emp = DB.getUser(data.employee_id);
let ev = DB.getEvaluation(data.evaluation_id);
if (!ev && window.sb) { try { const { data:e } = await window.sb.from('evaluations').select('*').eq('id', data.evaluation_id).maybeSingle(); ev = e; } catch(_){} }
const crit = (ev && ev.template_snapshot && ev.template_snapshot.criteria) || [];
const scores = (ev && (ev.section_scores || ev.items)) || {};
const scoreInputs = crit.map(c => `<div class="form-group" style="margin-bottom:8px"><label class="form-label" style="font-size:13px">${Utils.escape(c.name)} <span style="color:var(--muted);font-size:11px">(0 - ${c.weight})</span></label><input type="number" min="0" max="${c.weight}" step="0.5" class="form-control ro-score" data-cid="${c.id}" data-weight="${c.weight}" value="${scores[c.id]!=null?scores[c.id]:''}"></div>`).join('');
Modal.show('⚖️ مراجعة اعتراض', `
<div style="margin-bottom:10px"><strong>الموظف:</strong> ${emp?Utils.escape(emp.full_name):'-'} — <strong>تاريخ التقييم:</strong> ${ev?Utils.formatDate(ev.evaluation_date):'-'} — <strong>الدرجة الحالية:</strong> ${ev?ev.percentage+'%':'-'}</div>
${ev?critBreakdownHTML(ev):''}
${ev&&ev.evaluation_notes?`<div style="margin-bottom:8px"><strong>ملاحظات المُقيّم:</strong> ${Utils.escape(ev.evaluation_notes)}</div>`:''}
<div class="alert alert-warning"><strong>نص الاعتراض:</strong> ${Utils.escape(data.objection_text)}</div>
<button class="btn btn-sm btn-secondary" onclick="openCgPdfByEval(${data.evaluation_id})" style="margin-bottom:10px">📄 فتح ملف التقييم</button>
<div class="form-group"><label class="form-label">قرار الرد *</label><select class="form-control" id="ro-decision"><option value="accepted">✅ قبول الاعتراض</option><option value="partial">➗ قبول جزئي</option><option value="rejected">❌ رفض الاعتراض</option></select></div>
<div class="form-group"><label class="form-label">نص رد الجودة *</label><textarea class="form-control" id="ro-resp" rows="3" placeholder="اكتب ردّك على الاعتراض..."></textarea></div>
<div id="ro-scores-wrap" style="border:1px dashed var(--border);border-radius:8px;padding:12px;margin-top:6px">
<label style="display:flex;align-items:center;gap:8px;font-weight:600;margin-bottom:8px;cursor:pointer"><input type="checkbox" id="ro-edit-scores"> تعديل الدرجات <span style="font-weight:400;font-size:11px;color:var(--muted)">(يُحفظ التعديل مع بقاء النموذج الأصلي في السجل)</span></label>
<div id="ro-scores" style="display:none">${scoreInputs || '<div style="color:var(--muted);font-size:13px">لا معايير متاحة للتعديل</div>'}
<div style="display:flex;justify-content:space-between;padding-top:6px;border-top:1px solid var(--border);margin-top:6px"><strong>المجموع الجديد</strong><strong id="ro-new-total" style="color:var(--primary)">—</strong></div>
</div></div>`,
`<button class="btn btn-secondary" onclick="Modal.close()">إلغاء</button><button class="btn btn-success" id="ro-submit">📨 إرسال الرد</button>`);
const wrap = document.getElementById('ro-scores'), chk = document.getElementById('ro-edit-scores'), totalEl = document.getElementById('ro-new-total'), decSel = document.getElementById('ro-decision');
const recompute = () => { let sum=0, ok=true; document.querySelectorAll('.ro-score').forEach(i=>{const v=parseFloat(i.value),w=parseFloat(i.dataset.weight)||0; if(!(v>=0&&v<=w)) ok=false; else sum+=v;}); if(totalEl) totalEl.textContent = ok?(Math.round(sum*100)/100)+' / 100':'—'; };
if (chk) chk.addEventListener('change', () => { wrap.style.display = chk.checked ? '' : 'none'; recompute(); });
if (decSel) decSel.addEventListener('change', () => { const wrp=document.getElementById('ro-scores-wrap'); if(wrp) wrp.style.display = decSel.value==='rejected' ? 'none' : ''; });
document.querySelectorAll('.ro-score').forEach(i=>i.addEventListener('input', recompute));
document.getElementById('ro-submit').addEventListener('click', async () => {
const decision = decSel.value;
const resp = (document.getElementById('ro-resp').value||'').trim();
if (!resp) { Toast.error('نص الرد مطلوب'); return; }
let newScores = null;
if (decision !== 'rejected' && chk && chk.checked) {
newScores = {}; let ok=true;
document.querySelectorAll('.ro-score').forEach(i=>{const v=parseFloat(i.value),w=parseFloat(i.dataset.weight)||0; if(!(v>=0&&v<=w)) ok=false; newScores[i.dataset.cid]=v;});
if (!ok) { Toast.error('كل درجة يجب أن تكون بين 0 والحد الأقصى للمعيار'); return; }
}
const btn = document.getElementById('ro-submit');
await submitWithFeedback(btn, 'جارٍ إرسال الرد...', null, async () => {
const { data:d, error } = await window.sb.rpc('review_objection', { p_session_token: cgToken(), p_objection_id: objId, p_response: resp, p_decision: decision, p_new_scores: newScores });
const r = Array.isArray(d)?d[0]:d;
if (error || !r || !r.ok) { const m=(r&&r.message)||(error&&error.message)||'فشل حفظ الرد'; if(!handleSessionError(m)) Toast.error(m); return false; }
if (window.SupabaseSync && SupabaseSync.pullAll) { try{ await SupabaseSync.pullAll(true); }catch(_){} }
Modal.close(); Toast.success(r.message||'تم حفظ القرار');
if (currentPage==='cg-objections') loadCgObjections(); else if (currentPage==='cg-requests') loadCgRequests();
return true;
});
});
}

// ---- المعايير الأدنى أداءً — Creative Gene (بديل "الأخطاء المتكررة") ----
function renderCgFrequentErrors() {
if (!(currentUser.role === 'admin' || currentUser.role === 'quality_officer' || currentUser.role === 'supervisor')) return '<div class="alert alert-danger">غير مصرح</div>';
let evs = (DB.data.evaluations||[]).filter(e => e.template_type === 'pdf_based_weekly');
if (currentUser.role === 'supervisor') { const my = new Set(DB.getUsers({role:'employee'}).filter(x=>x.supervisor_id===currentUser.id||x.supervisor_name===currentUser.full_name).map(x=>x.id)); evs = evs.filter(e => my.has(e.employee_id)); }
const agg = {};
evs.forEach(e => { const crit = (e.template_snapshot && e.template_snapshot.criteria) || []; const scores = e.section_scores || e.items || {};
crit.forEach(c => { const s = scores[c.id]; if (s == null) return; const w = +c.weight||0; const pct = w>0 ? (+s/w*100) : 0;
if (!agg[c.name]) agg[c.name] = { sumPct:0, count:0, sumRaw:0, weight:w }; agg[c.name].sumPct += pct; agg[c.name].count++; agg[c.name].sumRaw += +s; }); });
const rows = Object.entries(agg).map(([name,a]) => ({ name, count:a.count, avgPct: Math.round(a.sumPct/a.count*10)/10, avgRaw: Math.round(a.sumRaw/a.count*10)/10, weight:a.weight })).sort((x,y)=>x.avgPct - y.avgPct);
const body = rows.map((r,i) => `<tr>
<td><div style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:${i===0?'#ef4444':i===1?'#f59e0b':'#e2e8f0'};color:${i<2?'white':'#334155'};font-weight:700">${i+1}</div></td>
<td><strong>${Utils.escape(r.name)}</strong></td>
<td style="text-align:center">${r.count}</td>
<td style="text-align:center"><span class="badge ${r.avgPct>=85?'badge-success':(r.avgPct>=60?'badge-warning':'badge-danger')}">${r.avgPct}%</span></td>
<td style="text-align:center">${r.avgRaw} / ${r.weight}</td>
</tr>`).join('') || '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--muted)">لا توجد تقييمات بعد</td></tr>';
return `<div class="page-header"><div><div class="page-title">⚠️ المعايير الأدنى أداءً — Creative Gene</div><div class="page-subtitle">المعايير مرتّبة تصاعدياً حسب متوسط الأداء (الأضعف أولاً)</div></div></div>
<div class="card"><div style="overflow-x:auto"><table class="table"><thead><tr><th>#</th><th>المعيار</th><th style="text-align:center">عدد التقييمات</th><th style="text-align:center">متوسط الأداء</th><th style="text-align:center">متوسط الدرجة</th></tr></thead><tbody>${body}</tbody></table></div></div>`;
}
// ---- تقرير الإجراءات — Creative Gene ----
function renderCgActionsReport() {
if (!(currentUser.role === 'admin' || currentUser.role === 'quality_officer' || currentUser.role === 'supervisor')) return '<div class="alert alert-danger">غير مصرح</div>';
return `<div class="page-header"><div><div class="page-title">📝 تقرير الإجراءات — Creative Gene</div><div class="page-subtitle">الإجراءات المتخذة على تقييمات Creative Gene</div></div></div>
<div id="cg-actions-body"><div class="card"><div class="card-body">⏳ جارٍ التحميل…</div></div></div>`;
}
async function loadCgActionsReport() {
const host = document.getElementById('cg-actions-body'); if (!host) return;
await loadDepartments();
let q = window.sb.from('creative_gene_actions').select('*').order('taken_at', { ascending:false });
const { data, error } = await q;
if (error) { if(!handleSessionError(error.message)) host.innerHTML = `<div class="alert alert-danger">${Utils.escape(error.message)}</div>`; return; }
let acts = data || [];
if (currentUser.role === 'supervisor') acts = acts.filter(a => a.supervisor_id === currentUser.id);
if (!acts.length) { host.innerHTML = '<div class="alert alert-info">لا توجد إجراءات في هذا القسم.</div>'; return; }
const rows = acts.map(a => { const emp = DB.getUser(a.employee_id), sup = DB.getUser(a.supervisor_id), ev = DB.getEvaluation(a.evaluation_id);
return `<tr><td>${emp?Utils.escape(emp.full_name):'-'}</td><td>${ev?('#'+ev.id+' ('+ev.percentage+'%)'):'-'}</td><td>${actionTypeLabel(a.action_type)}</td><td>${Utils.escape(a.action_details||'')}</td><td>${sup?Utils.escape(sup.full_name):'—'}</td><td>${Utils.formatDate(a.taken_at)}</td></tr>`;
}).join('');
host.innerHTML = `<div class="card"><div style="overflow-x:auto"><table class="table"><thead><tr><th>الموظف</th><th>التقييم</th><th>نوع الإجراء</th><th>التفاصيل</th><th>المشرف</th><th>التاريخ</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}
// ---- شاشة المشرف "موظفوني — Creative Gene" ----
function renderCgMyTeam() {
if (!(currentUser.role === 'supervisor' || currentUser.role === 'admin')) return '<div class="alert alert-danger">غير مصرح</div>';
return `<div class="page-header"><div><div class="page-title">👥 موظفوني — Creative Gene</div><div class="page-subtitle">اتخاذ الإجراءات على تقييمات موظفيك</div></div></div>
<div id="cgteam-list"><div class="card"><div class="card-body">⏳ جارٍ التحميل…</div></div></div>`;
}
async function loadCgMyTeam() {
const host = document.getElementById('cgteam-list');
if (!host) return;
await loadDepartments();
let emps = DB.getUsers({ role:'employee' }).filter(e => isCreativeGeneDept(e.department_id));
if (currentUser.role === 'supervisor') emps = emps.filter(e => e.supervisor_id === currentUser.id);
if (!emps.length) { host.innerHTML = '<div class="alert alert-info">لا يوجد موظفو Creative Gene تحت إشرافك.</div>'; return; }
const lastByEmp = {};
emps.forEach(e => { const evs=(DB.data.evaluations||[]).filter(x=>x.employee_id===e.id&&x.template_type==='pdf_based_weekly').sort((a,b)=>String(b.week_start||'').localeCompare(String(a.week_start||''))); lastByEmp[e.id]=evs[0]||null; });
const evalIds = Object.values(lastByEmp).filter(Boolean).map(e=>e.id);
const objMap = {}, actMap = {};
if (evalIds.length) { try { const [{ data:objs },{ data:acts }] = await Promise.all([window.sb.from('creative_gene_objections').select('*').in('evaluation_id',evalIds), window.sb.from('creative_gene_actions').select('*').in('evaluation_id',evalIds)]); (objs||[]).forEach(o=>objMap[o.evaluation_id]=o); (acts||[]).forEach(a=>actMap[a.evaluation_id]=a); } catch(_){} }
const rows = emps.map(e => { const last = lastByEmp[e.id];
if (!last) return `<tr><td>${Utils.escape(e.full_name)}</td><td>${jobTitleCell(e)}</td><td colspan="4" style="color:var(--muted)">لا يوجد تقييم</td><td>—</td></tr>`;
const o = objMap[last.id], a = actMap[last.id];
const objCol = o ? (objBadge(o.status)) : '<span style="color:var(--muted)">—</span>';
const actCol = a ? actionTypeLabel(a.action_type) : '<span style="color:var(--muted)">—</span>';
return `<tr><td>${Utils.escape(e.full_name)}</td><td>${jobTitleCell(e)}</td><td>${last.week_start||''}</td><td><strong>${last.percentage}%</strong></td><td>${objCol}</td><td>${actCol}</td><td><button class="btn btn-sm btn-secondary" onclick="openCgPdfByEval(${last.id})">📄</button> <button class="btn btn-sm btn-danger" onclick="takeActionModal(${last.id})">🎯 إجراء</button></td></tr>`;
}).join('');
host.innerHTML = `<div class="card"><div class="card-body" style="padding:0;overflow-x:auto"><table class="table"><thead><tr><th>الموظف</th><th>المسمى الوظيفي</th><th>آخر أسبوع</th><th>الدرجة</th><th>الاعتراض</th><th>الإجراء</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}
async function takeActionModal(evalId) {
const ev = DB.getEvaluation(evalId);
if (!ev) { Toast.error('التقييم غير موجود'); return; }
const emp = DB.getUser(ev.employee_id);
const types = (ev.template_snapshot && ev.template_snapshot.allowed_action_types) || ['warning','training','praise','other'];
const obj = await fetchObjection(evalId);
const proposed = await fetchAction(evalId); // الإجراء الذي حدّده موظف الجودة
const preType = proposed ? proposed.action_type : (types[0]||'');
const preDetails = proposed ? (proposed.action_details||'') : '';
const proposer = (proposed && proposed.created_by) ? DB.getUser(proposed.created_by) : null;
Modal.show('مراجعة واعتماد التقييم', `
<div style="margin-bottom:10px"><strong>الموظف:</strong> ${emp?Utils.escape(emp.full_name):'-'} — <strong>الأسبوع:</strong> ${ev.week_start||''} — <strong>الدرجة:</strong> ${ev.percentage}% ${passFailBadge(ev.percentage, emp?emp.department_id:cgDeptId())}</div>
${critBreakdownHTML(ev)}
${ev.evaluation_notes?`<div style="margin-bottom:8px"><strong>ملاحظات المُقيّم:</strong> ${Utils.escape(ev.evaluation_notes)}</div>`:''}
<button class="btn btn-sm btn-secondary" onclick="openCgPdfByEval(${ev.id})" style="margin-bottom:10px">📄 فتح ملف التقييم</button>
${obj?`<div class="alert alert-warning"><strong>اعتراض الموظف:</strong> ${Utils.escape(obj.objection_text)}${obj.reviewer_response?'<br><strong>رد الجودة:</strong> '+Utils.escape(obj.reviewer_response):''}</div>`:''}
<div style="border:2px solid var(--warning);background:#fffbeb;border-radius:10px;padding:12px">
<div style="font-weight:800;margin-bottom:8px">🎯 الإجراء ${proposed?`<span style="font-size:11px;font-weight:400;color:var(--muted)">(اقتراح ${proposer?Utils.escape(proposer.full_name):'موظف الجودة'})</span>`:'<span style="font-size:11px;font-weight:400;color:var(--danger)">(لم يحدّده الجودة — أدخله)</span>'}</div>
<div class="form-group" style="margin-bottom:8px"><label class="form-label">نوع الإجراء *</label><select class="form-control" id="ta-type" ${proposed?'disabled':''}>${types.map(t=>`<option value="${t}" ${t===preType?'selected':''}>${actionTypeLabel(t)}</option>`).join('')}</select></div>
<div class="form-group" style="margin:0"><label class="form-label">تفاصيل الإجراء *</label><textarea class="form-control" id="ta-details" rows="3" ${proposed?'disabled':''}>${Utils.escape(preDetails)}</textarea></div>
${proposed?`<button type="button" class="btn btn-sm btn-secondary" id="ta-edit" style="margin-top:8px">✏️ تعديل الإجراء</button>`:''}
</div>`,
`<button class="btn btn-secondary" onclick="Modal.close()">إلغاء</button><button class="btn btn-success" id="ta-save">✅ اعتماد</button>`);
const editBtn = document.getElementById('ta-edit');
if (editBtn) editBtn.addEventListener('click', () => { const t=document.getElementById('ta-type'), d=document.getElementById('ta-details'); if(t)t.disabled=false; if(d){d.disabled=false; d.focus();} editBtn.style.display='none'; });
document.getElementById('ta-save').addEventListener('click', async () => {
const type = document.getElementById('ta-type').value, details = document.getElementById('ta-details').value.trim();
if (!details) { Toast.error('تفاصيل الإجراء مطلوبة'); return; }
const { data, error } = await window.sb.rpc('take_action', { p_session_token: cgToken(), p_evaluation_id: evalId, p_action_type: type, p_action_details: details, p_linked_objection_id: obj?obj.id:null });
const r = Array.isArray(data)?data[0]:data;
if (error || !r || !r.ok) { const m=(r&&r.message)||(error&&error.message)||'فشل'; if(!handleSessionError(m)) Toast.error(m); return; }
if (window.SupabaseSync && SupabaseSync.pullAll) { try{ await SupabaseSync.pullAll(true); }catch(_){} }
Modal.close(); Toast.success('تم اعتماد التقييم');
if (currentPage==='cg-pending-approval') loadCgPending(); else loadCgMyTeam();
});
}

// ---- شاشة إدارة أسبوع Creative Gene (admin/quality) ----
function renderCgWeek(weekParam) {
if (!(currentUser.role === 'admin' || currentUser.role === 'quality_officer')) return '<div class="alert alert-danger">غير مصرح</div>';
const ws = weekParam || weekStartSaturdayJS();
return `<div class="page-header"><div><div class="page-title">📄 أسبوع Creative Gene</div><div class="page-subtitle">حالة رفع وتقييم الملفات الأسبوعية</div></div></div>
<div class="card"><div class="card-body"><div class="grid grid-2">
<div class="form-group"><label class="form-label">بداية الأسبوع (السبت)</label><input type="date" class="form-control" id="cgw-date" value="${ws}"></div>
<div class="form-group"><label class="form-label">نهاية الأسبوع</label><input type="date" class="form-control" value="${weekEndStr(ws)}" disabled></div>
</div></div></div>
<div id="cgw-table"><div class="card"><div class="card-body">⏳ جارٍ التحميل…</div></div></div>
<div class="page-header" style="margin-top:24px"><div><div class="page-title" style="font-size:18px">📊 سجل تقييمات Creative Gene</div><div class="page-subtitle">جميع التقييمات الأسبوعية السابقة</div></div></div>
${cgHistoryHTML()}`;
}
function cgHistoryHTML() {
const evs = (DB.data.evaluations||[]).filter(e => e.template_type === 'pdf_based_weekly').sort((a,b)=> String(b.week_start||'').localeCompare(String(a.week_start||'')));
if (!evs.length) return '<div class="alert alert-info">لا توجد تقييمات بعد.</div>';
const rows = evs.map(e => { const emp = DB.getUser(e.employee_id); return `<tr>
<td>${emp?Utils.escape(emp.full_name):'-'}</td>
<td>${e.week_start||''} ← ${e.week_end||''}</td>
<td>${Utils.gradeBadge(e.percentage)} <span style="font-weight:700">${e.percentage}%</span></td>
<td>${e.evaluation_notes?Utils.escape(e.evaluation_notes):'<span style="color:var(--muted)">—</span>'}</td>
<td><button class="btn btn-sm btn-secondary" onclick="openCgPdfByEval(${e.id})">📄 فتح PDF</button></td>
</tr>`; }).join('');
return `<div class="card"><div class="card-body" style="padding:0;overflow-x:auto"><table class="table"><thead><tr><th>الموظف</th><th>الأسبوع</th><th>الدرجة</th><th>الملاحظات</th><th>ملف PDF</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}
async function loadCgWeekTable(ws) {
const host = document.getElementById('cgw-table');
if (!host) return;
const { data, error } = await window.sb.rpc('get_creative_gene_status', { p_session_token: cgToken(), p_week_start: ws });
if (error) { const m=error.message||'تعذّر التحميل'; if(!handleSessionError(m)) host.innerHTML = `<div class="alert alert-danger">${Utils.escape(m)}</div>`; return; }
const rows = (data||[]);
if (!rows.length) { host.innerHTML = '<div class="alert alert-info">لا يوجد موظفون في قسم Creative Gene.</div>'; return; }
// اجلب الاعتراضات/الإجراءات لتقييمات هذا الأسبوع لعرض عمودَيها بدقّة
const evalIds = rows.filter(r => r.evaluation_id).map(r => r.evaluation_id);
const objMap = {}, actMap = {};
if (evalIds.length) {
try {
const [{ data: objs }, { data: acts }] = await Promise.all([
window.sb.from('creative_gene_objections').select('*').in('evaluation_id', evalIds),
window.sb.from('creative_gene_actions').select('*').in('evaluation_id', evalIds)
]);
(objs||[]).forEach(o => objMap[o.evaluation_id] = o);
(acts||[]).forEach(a => actMap[a.evaluation_id] = a);
} catch(_){}
}
const body = rows.map(r => {
const st = r.status;
const evaluated = (st !== 'not_uploaded' && st !== 'uploaded_pending');
const badge = evaluated ? '<span class="badge badge-success">🟢 تم التقييم</span>' : (st==='uploaded_pending' ? '<span class="badge badge-warning">🟡 بانتظار التقييم</span>' : '<span class="badge badge-danger">🔴 لم يُرفع</span>');
let actions = '';
if (st === 'uploaded_pending') actions = `<button class="btn btn-sm btn-secondary" onclick="openCgPdfByWeek(${r.employee_id},'${ws}')">📄 فتح</button> <button class="btn btn-sm btn-success" onclick="navigate('new-evaluation',{dept:${cgDeptId()},emp:${r.employee_id}})">📝 تقييم</button>`;
else if (evaluated) actions = `<button class="btn btn-sm btn-secondary" onclick="openCgPdfByEval(${r.evaluation_id})">📄 فتح</button> <span style="font-weight:700;color:var(--primary)">${r.percentage}%</span>`;
else actions = `<button class="btn btn-sm btn-secondary" onclick="cgUploadBehalf(${r.employee_id},'${ws}')">📎 رفع نيابةً</button>`;
const o = objMap[r.evaluation_id], a = actMap[r.evaluation_id];
const objCol = o ? (objBadge(o.status)) : '<span style="color:var(--muted)">—</span>';
const actCol = a ? actionTypeLabel(a.action_type) : '<span style="color:var(--muted)">—</span>';
return `<tr><td>${Utils.escape(r.employee_name)}</td><td>${badge}</td><td>${objCol}</td><td>${actCol}</td><td>${actions}</td></tr>`;
}).join('');
host.innerHTML = `<div class="card"><div class="card-body" style="padding:0;overflow-x:auto"><table class="table"><thead><tr><th>الموظف</th><th>الحالة</th><th>الاعتراض</th><th>الإجراء</th><th></th></tr></thead><tbody>${body}</tbody></table></div></div>`;
}
function cgUploadBehalf(empId, ws) { pickPdfAndUpload(empId, ws, () => loadCgWeekTable(ws)); }

// ============================================================
// م7 — دورة العمل (Workflow) لتقييم Creative Gene + سجل التغييرات
// ============================================================
// الحالات السبع: [key, label, color, emoji]
const WF_STATES = [
['pending_quality','بانتظار التقييم','#0ea5e9','🔵'],
['pending_supervisor','بانتظار إجراء المشرف','#f59e0b','🟠'],
['approved','تم الاعتماد','#22c55e','🟢'],
['objection_raised','يوجد اعتراض','#ef4444','🔴'],
['closed','مغلق','#64748b','⚫']
];
function wfState(s) { return WF_STATES.find(x => x[0] === s); }
function wfStateLabel(s) { const w = wfState(s); return w ? w[1] : (s || '—'); }
function wfBadge(s) {
const w = wfState(s);
if (!w) return `<span class="badge badge-secondary">${Utils.escape(s || '—')}</span>`;
return `<span class="badge" style="background:${w[2]}22;color:${w[2]};border:1px solid ${w[2]}66;font-weight:700;white-space:nowrap">${w[3]} ${w[1]}</span>`;
}
function wfFilterOptions(sel) {
return `<option value="all" ${!sel||sel==='all'?'selected':''}>كل الحالات</option>` +
WF_STATES.map(w => `<option value="${w[0]}" ${sel===w[0]?'selected':''}>${w[3]} ${w[1]}</option>`).join('');
}
function periodRange(r) { return `${r.week_start||r.period_start||'—'} ← ${r.week_end||r.period_end||'—'}`; }

// ---- رفع ملف الطلب إلى التخزين ثم إرجاع المسار ----
async function uploadRequestPdf(file, periodStart) {
if (!file) { Toast.error('اختر ملف PDF'); return null; }
if (file.type !== 'application/pdf') { Toast.error('الملف يجب أن يكون PDF فقط'); return null; }
if (file.size > 20 * 1024 * 1024) { Toast.error('الحد الأقصى 20 ميجابايت'); return null; }
const safe = (file.name || 'file.pdf').replace(/[^\w.\-]+/g, '_');
const path = currentUser.id + '/' + periodStart + '/' + Date.now() + '_' + safe;
try {
const up = await window.sb.storage.from('creative-gene-pdfs').upload(path, file, { contentType: 'application/pdf', upsert: false });
if (up.error) { Toast.error('تعذّر رفع الملف: ' + up.error.message); return null; }
return { path: path, name: file.name };
} catch (e) { Toast.error(e.message); return null; }
}

// ---- شاشة الموظف: رفع تقييم جديد (من/إلى تاريخ ≤ 7 أيام) ----
function renderCgUpload() {
if (currentUser.role !== 'employee') return '<div class="alert alert-danger">غير مصرح</div>';
const today = new Date().toISOString().substring(0, 10);
return `<div class="page-header"><div><div class="page-title">📤 رفع تقييم جديد</div><div class="page-subtitle">ارفع ملف تقييمك الأسبوعي (PDF) لإرساله إلى موظفة الجودة</div></div><button class="btn btn-secondary" data-nav="dashboard">← رجوع</button></div>
<form id="cgup-form"><div class="card"><div class="card-body">
<div class="grid grid-2">
<div class="form-group"><label class="form-label">من تاريخ *</label><input type="date" class="form-control" id="cgup-start" max="${today}"></div>
<div class="form-group"><label class="form-label">إلى تاريخ *</label><input type="date" class="form-control" id="cgup-end" max="${today}"></div>
</div>
<div id="cgup-daysnote" style="font-size:13px;margin:-4px 0 10px;min-height:18px"></div>
<div class="form-group"><label class="form-label">ملف PDF * <span style="color:var(--muted);font-size:12px">(الحد الأقصى 20 ميجابايت)</span></label><input type="file" class="form-control" id="cgup-file" accept="application/pdf"></div>
<div class="form-group"><label class="form-label">ملاحظات (اختياري)</label><textarea class="form-control" id="cgup-notes" rows="3" placeholder="أي ملاحظات ترغب بإضافتها للجودة..."></textarea></div>
<div style="display:flex;justify-content:flex-end;gap:10px"><button type="submit" class="btn btn-success" id="cgup-submit" style="padding:11px 24px">📤 إرسال الطلب</button></div>
</div></div></form>
<div class="page-header" style="margin-top:22px"><div class="page-title" style="font-size:16px">📋 طلباتي</div></div>
<div id="cgup-mylist"><div class="card"><div class="card-body">⏳ جارٍ التحميل…</div></div></div>`;
}
function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000); }
function attachCgUpload() {
const s = document.getElementById('cgup-start'), e = document.getElementById('cgup-end'), note = document.getElementById('cgup-daysnote');
const recalc = () => {
if (!s.value || !e.value) { note.innerHTML = ''; return; }
const d = daysBetween(s.value, e.value);
if (d < 0) note.innerHTML = '<span style="color:var(--danger)">⚠️ تاريخ النهاية قبل البداية</span>';
else if (d > 6) note.innerHTML = `<span style="color:var(--danger)">⚠️ المدة ${d + 1} يوماً — يجب ألا تتجاوز 7 أيام</span>`;
else note.innerHTML = `<span style="color:var(--success)">✓ المدة ${d + 1} يوماً</span>`;
};
if (s) s.addEventListener('change', recalc);
if (e) e.addEventListener('change', recalc);
const form = document.getElementById('cgup-form');
if (form) form.addEventListener('submit', async ev => {
ev.preventDefault();
const start = s.value, end = e.value;
if (!start || !end) { Toast.error('حدّد تاريخ البداية والنهاية'); return; }
const d = daysBetween(start, end);
if (d < 0) { Toast.error('تاريخ النهاية قبل البداية'); return; }
if (d > 6) { Toast.error('الفترة يجب ألا تتجاوز 7 أيام'); return; }
const file = (document.getElementById('cgup-file').files || [])[0];
if (!file) { Toast.error('اختر ملف PDF'); return; }
const notes = (document.getElementById('cgup-notes').value || '').trim();
const btn = document.getElementById('cgup-submit');
await submitWithFeedback(btn, 'جارٍ الرفع والإرسال...', null, async () => {
const uploaded = await uploadRequestPdf(file, start);
if (!uploaded) return false;
const { data, error } = await window.sb.rpc('create_evaluation_request', {
p_session_token: cgToken(), p_period_start: start, p_period_end: end,
p_file_path: uploaded.path, p_file_name: uploaded.name, p_notes: notes
});
const r = Array.isArray(data) ? data[0] : data;
if (error || !r || !r.ok) {
const m = (r && r.message) || (error && error.message) || 'تعذّر إرسال الطلب';
if (!handleSessionError(m)) Toast.error(m);
try { await window.sb.storage.from('creative-gene-pdfs').remove([uploaded.path]); } catch (_) {}
return false;
}
if (window.SupabaseSync && SupabaseSync.pullAll) { try { await SupabaseSync.pullAll(true); } catch (_) {} }
Toast.success('تم إرسال الطلب إلى الجودة بنجاح');
navigate('cg-upload');
return true;
});
});
loadMyRequests();
}
async function loadMyRequests() {
const host = document.getElementById('cgup-mylist');
if (!host) return;
const { data, error } = await window.sb.rpc('list_workflow_requests', { p_session_token: cgToken(), p_state: 'all', p_search: null });
if (error) { if (!handleSessionError(error.message)) host.innerHTML = `<div class="alert alert-danger">${Utils.escape(error.message)}</div>`; return; }
const rows = data || [];
if (!rows.length) { host.innerHTML = '<div class="alert alert-info">لا توجد طلبات بعد. ارفع أول تقييم من الأعلى.</div>'; return; }
const body = rows.map(r => {
const canObject = r.workflow_state === 'approved' && r.objection_deadline && new Date() < new Date(r.objection_deadline) && !r.has_objection;
const objBtn = canObject ? `<button class="btn btn-sm btn-warning" onclick="objectFromRequest(${r.evaluation_id},'${r.objection_deadline||''}')">⚖️ اعتراض</button>` : '';
const viewBtn = r.evaluation_id ? `<button class="btn btn-sm btn-secondary" onclick="navigate('view-evaluation',{id:${r.evaluation_id}})">التفاصيل</button>` : '';
return `<tr><td>${periodRange(r)}</td><td>${wfBadge(r.workflow_state)}</td><td>${r.percentage != null ? '<strong>' + r.percentage + '%</strong>' : '<span style="color:var(--muted)">—</span>'}</td><td style="display:flex;gap:6px;flex-wrap:wrap">${viewBtn}${objBtn}<button class="btn btn-sm btn-secondary" onclick="openRequestDetails(${r.weekly_status_id},'${Utils.escape((r.employee_name||'').replace(/'/g,''))}','${r.workflow_state}')">🕓 السجل</button></td></tr>`;
}).join('');
host.innerHTML = `<div class="card"><div class="card-body" style="padding:0;overflow-x:auto"><table class="table"><thead><tr><th>الفترة</th><th>الحالة</th><th>الدرجة</th><th></th></tr></thead><tbody>${body}</tbody></table></div></div>`;
}
async function objectFromRequest(evalId, deadline) {
let ev = DB.getEvaluation(evalId);
if (!ev && window.sb) { try { const { data } = await window.sb.from('evaluations').select('*').eq('id', evalId).maybeSingle(); ev = data; } catch (_) {} }
if (!ev) { Toast.error('التقييم غير موجود'); return; }
if (deadline) { try { ev = Object.assign({}, ev, { objection_deadline: deadline }); } catch (_) {} }
raiseObjectionFlow(ev, () => loadMyRequests());
}

// ---- شاشة الجودة/الإدارة: طلبات التقييم (فلترة بالحالة + بحث) ----
function renderCgRequests() {
if (!(currentUser.role === 'admin' || currentUser.role === 'quality_officer')) return '<div class="alert alert-danger">غير مصرح</div>';
const sel = currentParams.state || 'pending_quality';
return `<div class="page-header"><div><div class="page-title">📥 طلبات التقييم — Creative Gene</div><div class="page-subtitle">استقبال طلبات الموظفين ومتابعة دورة التقييم</div></div></div>
<div class="card"><div class="card-body"><div style="display:flex;gap:12px;flex-wrap:wrap;align-items:end">
<div class="form-group" style="margin:0;min-width:220px"><label class="form-label">الحالة</label><select class="form-control" id="cgr-state">${wfFilterOptions(sel)}</select></div>
<div class="form-group" style="margin:0;flex:1;min-width:200px"><label class="form-label">بحث باسم الموظف</label><input type="text" class="form-control" id="cgr-search" placeholder="اكتب اسم الموظف..."></div>
</div></div></div>
<div id="cgr-list"><div class="card"><div class="card-body">⏳ جارٍ التحميل…</div></div></div>`;
}
async function loadCgRequests() {
const host = document.getElementById('cgr-list');
if (!host) return;
const state = (document.getElementById('cgr-state') || {}).value || 'pending_quality';
const search = ((document.getElementById('cgr-search') || {}).value || '').trim();
const { data, error } = await window.sb.rpc('list_workflow_requests', { p_session_token: cgToken(), p_state: state, p_search: search || null });
if (error) { if (!handleSessionError(error.message)) host.innerHTML = `<div class="alert alert-danger">${Utils.escape(error.message)}</div>`; return; }
const rows = data || [];
if (!rows.length) { host.innerHTML = '<div class="alert alert-info">لا توجد طلبات مطابقة.</div>'; return; }
const isAdmin = currentUser.role === 'admin';
const body = rows.map(r => {
const st = r.workflow_state;
let actions = '';
if (st === 'pending_quality') actions += `<button class="btn btn-sm btn-success" onclick="openRequestForEval(${r.weekly_status_id},${r.employee_id},'${r.week_start}')">📝 فتح للتقييم</button>`;
else if (st === 'objection_raised' && (currentUser.role === 'quality_officer' || currentUser.role === 'admin') && r.has_objection) actions += `<button class="btn btn-sm btn-warning" onclick="reviewObjectionByEval(${r.evaluation_id})">⚖️ الرد على الاعتراض</button>`;
if (r.evaluation_id) actions += ` <button class="btn btn-sm btn-secondary" onclick="openCgPdfByEval(${r.evaluation_id})">📄</button>`;
else actions += ` <button class="btn btn-sm btn-secondary" onclick="openCgPdfByWeek(${r.employee_id},'${r.week_start}')">📄</button>`;
actions += ` <button class="btn btn-sm btn-secondary" onclick="openRequestDetails(${r.weekly_status_id},'${Utils.escape((r.employee_name||'').replace(/'/g,''))}','${st}')">🕓</button>`;
if (isAdmin) actions += ` <button class="btn btn-sm btn-danger" onclick="deleteRequestModal(${r.weekly_status_id},'${Utils.escape((r.employee_name||'').replace(/'/g,''))}')">🗑️</button>`;
return `<tr><td>${Utils.escape(r.employee_name||'-')}</td><td>${periodRange(r)}</td><td>${wfBadge(st)}</td><td>${r.percentage != null ? '<strong>' + r.percentage + '%</strong>' : '<span style="color:var(--muted)">—</span>'}</td><td style="white-space:nowrap">${actions}</td></tr>`;
}).join('');
host.innerHTML = `<div class="card"><div class="card-body" style="padding:0;overflow-x:auto"><table class="table"><thead><tr><th>الموظف</th><th>الفترة</th><th>الحالة</th><th>الدرجة</th><th></th></tr></thead><tbody>${body}</tbody></table></div></div>`;
}
async function openRequestForEval(statusId, empId, weekStart) {
const { data, error } = await window.sb.rpc('open_evaluation_request', { p_session_token: cgToken(), p_weekly_status_id: statusId });
const r = Array.isArray(data) ? data[0] : data;
if (error || !r || !r.ok) { const m = (r && r.message) || (error && error.message) || 'تعذّر فتح الطلب'; if (!handleSessionError(m)) Toast.error(m); return; }
if (window.SupabaseSync && SupabaseSync.pullAll) { try { await SupabaseSync.pullAll(true); } catch (_) {} }
navigate('new-evaluation', { dept: cgDeptId(), emp: empId, week: weekStart });
}
async function reviewObjectionByEval(evalId) {
const { data } = await window.sb.from('creative_gene_objections').select('id').eq('evaluation_id', evalId).order('id', { ascending: false }).limit(1);
const o = (data && data[0]) || null;
if (!o) { Toast.error('الاعتراض غير موجود'); return; }
reviewObjectionModal(o.id);
}
function deleteRequestModal(statusId, empName) {
Modal.show('🗑️ حذف طلب التقييم', `
<div class="alert alert-danger">سيُحذف طلب الموظف <strong>${Utils.escape(empName || '')}</strong> نهائياً (التقييم والاعتراضات والإجراءات والملف). لا يمكن التراجع.</div>
<div class="form-group"><label class="form-label">سبب الحذف * <span style="color:var(--muted);font-size:12px">(يُسجَّل في السجل)</span></label><textarea class="form-control" id="delreq-reason" rows="3" placeholder="اذكر سبب الحذف..."></textarea></div>`,
`<button class="btn btn-secondary" onclick="Modal.close()">إلغاء</button><button class="btn btn-danger" id="delreq-ok">🗑️ حذف نهائي</button>`);
document.getElementById('delreq-ok').addEventListener('click', async () => {
const reason = (document.getElementById('delreq-reason').value || '').trim();
if (!reason) { Toast.error('يجب إدخال سبب الحذف'); return; }
const { data, error } = await window.sb.rpc('admin_delete_evaluation_request', { p_session_token: cgToken(), p_weekly_status_id: statusId, p_reason: reason });
const r = Array.isArray(data) ? data[0] : data;
if (error || !r || !r.ok) { const m = (r && r.message) || (error && error.message) || 'تعذّر الحذف'; if (!handleSessionError(m)) Toast.error(m); return; }
if (window.SupabaseSync && SupabaseSync.pullAll) { try { await SupabaseSync.pullAll(true); } catch (_) {} }
Modal.close(); Toast.success('تم حذف الطلب وتسجيل السبب'); loadCgRequests();
});
}

// ---- شاشة المشرف: بانتظار الاعتماد ----
function renderCgPending() {
if (!(currentUser.role === 'supervisor' || currentUser.role === 'admin')) return '<div class="alert alert-danger">غير مصرح</div>';
return `<div class="page-header"><div><div class="page-title">✅ بانتظار الاعتماد — Creative Gene</div><div class="page-subtitle">تقييمات موظفيك المكتملة بانتظار اعتمادك واتخاذ الإجراء</div></div></div>
<div id="cgpend-list"><div class="card"><div class="card-body">⏳ جارٍ التحميل…</div></div></div>`;
}
async function loadCgPending() {
const host = document.getElementById('cgpend-list');
if (!host) return;
const { data, error } = await window.sb.rpc('list_workflow_requests', { p_session_token: cgToken(), p_state: 'pending_supervisor', p_search: null });
if (error) { if (!handleSessionError(error.message)) host.innerHTML = `<div class="alert alert-danger">${Utils.escape(error.message)}</div>`; return; }
const rows = data || [];
if (!rows.length) { host.innerHTML = '<div class="alert alert-info">لا توجد تقييمات بانتظار اعتمادك حالياً.</div>'; return; }
const body = rows.map(r => `<tr>
<td>${Utils.escape(r.employee_name||'-')}</td><td>${periodRange(r)}</td>
<td>${r.percentage != null ? Utils.gradeBadge(r.percentage) + ' <strong>' + r.percentage + '%</strong>' : '—'}</td>
<td style="white-space:nowrap">
<button class="btn btn-sm btn-secondary" onclick="openCgPdfByEval(${r.evaluation_id})">📄</button>
<button class="btn btn-sm btn-success" onclick="takeActionModal(${r.evaluation_id})">✅ مراجعة واعتماد</button>
<button class="btn btn-sm btn-secondary" onclick="openRequestDetails(${r.weekly_status_id},'${Utils.escape((r.employee_name||'').replace(/'/g,''))}','${r.workflow_state}')">🕓</button>
</td></tr>`).join('');
host.innerHTML = `<div class="card"><div class="card-body" style="padding:0;overflow-x:auto"><table class="table"><thead><tr><th>الموظف</th><th>الفترة</th><th>الدرجة</th><th></th></tr></thead><tbody>${body}</tbody></table></div></div>`;
}

// ---- مودال: سجل التغييرات (Audit) لطلب واحد ----
async function openRequestDetails(statusId, empName, state) {
Modal.show('🕓 سجل التغييرات', '<div id="wf-audit-body" style="min-height:60px">⏳ جارٍ التحميل…</div>', `<button class="btn btn-secondary" onclick="Modal.close()">إغلاق</button>`);
const { data, error } = await window.sb.rpc('get_workflow_audit', { p_session_token: cgToken(), p_weekly_status_id: statusId });
const body = document.getElementById('wf-audit-body');
if (!body) return;
if (error) { if (!handleSessionError(error.message)) body.innerHTML = `<div class="alert alert-danger">${Utils.escape(error.message)}</div>`; return; }
const rows = data || [];
let timeline;
if (!rows.length) timeline = '<div class="alert alert-info">لا توجد سجلات لهذا الطلب (قد يكون سابقاً لنظام التدقيق).</div>';
else timeline = rows.map(r => {
const who = r.actor_name || (r.actor_role === 'system' ? 'النظام (تلقائي)' : '—');
const roleTxt = r.actor_role ? ('(' + (Utils.roleLabel ? Utils.roleLabel(r.actor_role) : r.actor_role) + ')') : '';
return `<div style="display:flex;gap:12px;padding:10px 0;border-bottom:1px dashed var(--border)">
<div style="min-width:130px;font-size:11px;color:var(--muted)">${new Date(r.created_at).toLocaleString('ar-SA')}</div>
<div style="flex:1">
<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">${wfBadge(r.from_state)}<span style="color:var(--muted)">→</span>${wfBadge(r.to_state)}</div>
<div style="font-size:12px;color:var(--muted);margin-top:4px">بواسطة <strong>${Utils.escape(who)}</strong> ${roleTxt}${r.notes ? ' — ' + Utils.escape(r.notes) : ''}</div>
</div></div>`;
}).join('');
body.innerHTML = `<div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--border)"><strong>${Utils.escape(empName || '')}</strong> &nbsp; الحالة الحالية: ${wfBadge(state)}</div>${timeline}`;
}

function renderWeeklyView(ev) {
const emp = DB.getUser(ev.employee_id); const evr = DB.getUser(ev.evaluator_id);
const sc = ev.section_scores || {}; const detail = sc.kpi_detail || [];
const pct = (sc.percentage != null ? sc.percentage : ev.percentage);
const tasks = ev.tasks || [];
const tasksRows = tasks.map(t => `<tr><td>${Utils.escape(t.name||'—')}</td><td>${t.completion||0}</td><td>${t.timeliness||0}</td><td>${t.quality||0}</td><td><strong>${Math.round(((+t.completion||0)+(+t.timeliness||0)+(+t.quality||0))/3)}</strong></td></tr>`).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--muted)">لا مهام</td></tr>';
const kpiRows = detail.map(k => `<tr><td>${Utils.escape(k.name)}</td><td>${k.value}</td><td>${k.normalized}%</td></tr>`).join('') || '<tr><td colspan="3" style="text-align:center;color:var(--muted)">—</td></tr>';
return `<div class="page-header"><div><div class="page-title">📅 تقييم أسبوعي</div><div class="page-subtitle">${emp?Utils.escape(emp.full_name):''} — ${ev.week_start||''} ← ${ev.week_end||''}</div></div><button class="btn btn-secondary" data-nav="evaluations">← رجوع</button></div>
<div class="card"><div class="card-body" style="display:flex;gap:32px;flex-wrap:wrap;align-items:center">
<div><div style="font-size:13px;color:var(--muted)">النتيجة الإجمالية</div><div style="font-size:34px;font-weight:800;color:var(--primary)">${pct}%</div>${Utils.gradeBadge(pct)}</div>
<div><div style="font-size:13px;color:var(--muted)">متوسط المهام</div><div style="font-size:24px;font-weight:700">${sc.tasks_avg!=null?sc.tasks_avg:'—'}</div></div>
<div><div style="font-size:13px;color:var(--muted)">متوسط المؤشرات</div><div style="font-size:24px;font-weight:700">${sc.kpis_avg!=null?sc.kpis_avg:'—'}</div></div>
<div><div style="font-size:13px;color:var(--muted)">المُقيِّم</div><div style="font-size:16px;font-weight:600">${evr?Utils.escape(evr.full_name):'—'}</div></div>
</div></div>
<div class="card"><div class="card-header"><div class="card-title">✅ المهام</div></div><div class="card-body" style="padding:0;overflow-x:auto"><table class="table"><thead><tr><th>المهمة</th><th>الإنجاز</th><th>الالتزام بالوقت</th><th>الجودة</th><th>المتوسط</th></tr></thead><tbody>${tasksRows}</tbody></table></div></div>
<div class="card"><div class="card-header"><div class="card-title">📊 مؤشرات الأداء</div></div><div class="card-body" style="padding:0;overflow-x:auto"><table class="table"><thead><tr><th>المؤشر</th><th>القيمة</th><th>النسبة المطبّعة</th></tr></thead><tbody>${kpiRows}</tbody></table></div></div>`;
}

function renderViewEvaluation(id) {
const ev = DB.getEvaluation(id);
if (!ev) {
// شبكة أمان: سباق توقيت (التقييم مُنشأ للتوّ) — اسحب ثم اجلب مباشرةً كخط دفاع أخير قبل اليأس
if (window.__viewEvalRetry !== id && window.sb) {
window.__viewEvalRetry = id;
(async () => {
try { if (window.SupabaseSync && SupabaseSync.pullAll) await SupabaseSync.pullAll(true); } catch(_){}
if (!DB.getEvaluation(id)) {
try { const { data: ne } = await window.sb.from('evaluations').select('*').eq('id', id).maybeSingle();
if (ne) { DB.data.evaluations = (DB.data.evaluations || []).filter(x => x.id !== ne.id).concat(ne); try { localStorage.setItem(DB.KEY, JSON.stringify(DB.data)); } catch(_){} } } catch(_){}
}
if (typeof currentPage !== 'undefined' && currentPage === 'view-evaluation' && currentParams && currentParams.id === id) navigate('view-evaluation', { id: id });
})();
return '<div class="alert alert-info">⏳ جارٍ تحميل تفاصيل التقييم…</div>';
}
window.__viewEvalRetry = null;
return '<div class="alert alert-danger">التقييم غير موجود</div>';
}
window.__viewEvalRetry = null;
if (currentUser.role === 'employee' && ev.employee_id !== currentUser.id) {
return '<div class="alert alert-danger">ليس لديك صلاحية لعرض هذا التقييم</div>';
}

if (ev.template_type === 'task_based_weekly') return renderWeeklyView(ev);
if (ev.template_type === 'pdf_based_weekly') return renderPdfEvalView(ev);

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

const _vDept = emp ? (window._departments||[]).find(d => d.id === emp.department_id) : null;
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
<div class="card" style="margin-bottom:16px"><div class="card-body" style="padding:10px 14px;font-size:13px">المسمى: <strong>${jobTitleCell(emp)}</strong> &nbsp;|&nbsp; القسم: ${deptBadgeHTML(_vDept)} &nbsp;|&nbsp; النموذج المُستخدم: <strong>${usedTemplateLabel(ev)}</strong></div></div>
<div class="stats-grid">
<div class="stat-card"><div class="stat-icon" style="background:var(--primary)">👤</div><div class="stat-value" style="font-size:16px">${Utils.escape(emp?emp.full_name:'-')}</div><div class="stat-label">الموظف</div></div>
<div class="stat-card"><div class="stat-icon" style="background:var(--info)">👨‍💼</div><div class="stat-value" style="font-size:16px">${Utils.escape(evr?evr.full_name:'-')}</div><div class="stat-label">المقيِّم</div></div>
<div class="stat-card"><div class="stat-icon" style="background:var(--success)">⭐</div><div class="stat-value">${ev.percentage}%</div><div class="stat-label">${ev.total_score}/100 - ${ev.grade}</div></div>
<div class="stat-card"><div class="stat-icon" style="background:${ev.status==='ناجح'?'var(--success)':'var(--danger)'}">${ev.status==='ناجح'?'✓':'✗'}</div><div class="stat-value" style="font-size:20px">${ev.status}</div><div class="stat-label">الحالة</div></div>
</div>
${renderCommDisplay(ev)}
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
// موزّع تقارير بتبويبين منفصلين (محزم / Creative Gene) — فصل تام بـ department_id
function renderReports() {
if (currentUser.role === 'employee') return '<div class="alert alert-danger">🚫 غير مصرح لك بعرض التقارير</div>';
const mId = mahzamDeptId(), cId = cgDeptId();
const isSup = currentUser.role === 'supervisor';
const supEmps = isSup ? DB.getUsers({ role:'employee' }).filter(e => e.supervisor_id === currentUser.id || e.supervisor_name === currentUser.full_name) : [];
const supDepts = new Set(supEmps.map(e => e.department_id));
let tabs = [];
if (!isSup) tabs = [{k:'mahzam',l:'📊 تقارير محزم'},{k:'cg',l:'🎨 تقارير Creative Gene'}];
else { if (supDepts.has(mId)) tabs.push({k:'mahzam',l:'📊 تقارير محزم'}); if (supDepts.has(cId)) tabs.push({k:'cg',l:'🎨 تقارير Creative Gene'}); }
if (!tabs.length) tabs = [{k:'mahzam',l:'📊 تقارير محزم'}];
let tab = currentParams.reportTab;
if (!tab || !tabs.some(t => t.k === tab)) {
tab = (isSup && supDepts.has(cId) && !supDepts.has(mId)) ? 'cg' : 'mahzam';
if (!tabs.some(t => t.k === tab)) tab = tabs[0].k;
}
window._reportTab = tab;
const tabBar = tabs.length > 1 ? `<div style="display:flex;gap:8px;margin-bottom:16px">${tabs.map(t => `<button class="btn ${tab===t.k?'btn-primary':'btn-secondary'}" onclick="navigate('reports',{reportTab:'${t.k}'})">${t.l}</button>`).join('')}</div>` : '';
return tabBar + (tab === 'cg' ? renderCgReports() : renderMahzamReports());
}

function renderMahzamReports() {
const period = currentParams.period || 'all'; // all, year, month, custom
const year = parseInt(currentParams.year) || new Date().getFullYear();
const month = currentParams.month || ''; // YYYY-MM
const filterSup = currentParams.sup || '';
const fromDate = currentParams.from || '';
const toDate = currentParams.to || '';

// حصر صارم بقسم محزم عبر department_id (لا الحقل النصّي القديم)
let employees = DB.getUsers({ role:'employee' }).filter(e => e.department_id === mahzamDeptId());
if (currentUser.role === 'supervisor') {
employees = employees.filter(e => e.supervisor_name === currentUser.full_name || e.supervisor_id === currentUser.id);
}
if (filterSup) employees = employees.filter(e => (e.supervisor_name||'') === filterSup);
const empIdSet = new Set(employees.map(e => e.id));

// Filter evaluations by period + حصر بموظفي محزم فقط
let allEvals = DB.data.evaluations.filter(ev => empIdSet.has(ev.employee_id));
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
job_title: e.job_title || '',
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

// Supervisor list (محزم فقط)
const supSet = new Set();
DB.getUsers({role:'employee'}).filter(u => u.department_id === mahzamDeptId()).forEach(u => { if (u.supervisor_name && u.supervisor_name !== '-') supSet.add(u.supervisor_name); });
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
<td>${e.job_title ? Utils.escape(e.job_title) : '<span style="color:var(--muted)">—</span>'}</td>
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
<thead><tr><th>الترتيب</th><th>الرقم الوظيفي</th><th>الموظف</th><th>المسمى الوظيفي</th><th>المشرف</th><th style="text-align:center">عدد التقييمات</th><th style="text-align:center">المتوسط</th><th style="text-align:center">أعلى</th><th style="text-align:center">أدنى</th><th>التقدير</th></tr></thead>
<tbody>${rows || '<tr><td colspan="10" style="text-align:center;padding:20px">لا توجد بيانات</td></tr>'}</tbody>
</table>
</div>
</div>`;
}

function renderReportsCharts() {
if (window._reportTab === 'cg') return; // تبويب CG له عرضه الخاص بلا رسوم محزم
const employees = DB.getUsers({ role:'employee' }).filter(e => e.department_id === mahzamDeptId());
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
if (window._reportTab === 'cg') return exportCgReportsXLSX();
const employees = DB.getUsers({ role:'employee' }).filter(e => e.department_id === mahzamDeptId());
const allEvals = DB.data.evaluations;
const data = employees.map(e => {
const ue = allEvals.filter(ev => ev.employee_id === e.id);
const avg = ue.length ? Math.round(ue.reduce((s,x)=>s+x.percentage,0)/ue.length*10)/10 : 0;
const high = ue.length ? Math.max(...ue.map(x=>x.percentage)) : 0;
const low = ue.length ? Math.min(...ue.map(x=>x.percentage)) : 0;
return {
'الرقم الوظيفي': e.employee_number || '-',
'اسم الموظف': e.full_name,
'المسمى الوظيفي': e.job_title || '-',
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
if (window._reportTab === 'cg') return exportCgReportsPDF();
const employees = DB.getUsers({ role:'employee' }).filter(e => e.department_id === mahzamDeptId());
const allEvals = DB.data.evaluations;
const empData = employees.map(e => {
const ue = allEvals.filter(ev => ev.employee_id === e.id);
const avg = ue.length ? Math.round(ue.reduce((s,x)=>s+x.percentage,0)/ue.length*10)/10 : 0;
const high = ue.length ? Math.max(...ue.map(x=>x.percentage)) : 0;
const low = ue.length ? Math.min(...ue.map(x=>x.percentage)) : 0;
return { employee_number:e.employee_number||'-', name:e.full_name, job_title:e.job_title||'-', supervisor:e.supervisor_name||'-', count:ue.length, avg, high, low };
}).filter(e => e.count>0).sort((a,b) => b.avg - a.avg);
if (!empData.length) { Toast.error('لا توجد بيانات للتصدير'); return; }
const overallAvg = Math.round(empData.reduce((s,e)=>s+e.avg,0)/empData.length*10)/10;
const rows = empData.map((e,i) => `<tr><td>${i+1}</td><td>${Utils.escape(e.employee_number)}</td><td>${Utils.escape(e.name)}</td><td>${Utils.escape(e.job_title)}</td><td>${Utils.escape(e.supervisor)}</td><td style="text-align:center">${e.count}</td><td style="text-align:center"><strong>${e.avg}%</strong></td><td style="text-align:center;color:#059669">${e.high}%</td><td style="text-align:center;color:#dc2626">${e.low}%</td><td>${e.avg>=85?'ناجح':'راسب'}</td></tr>`).join('');
const html = `<div style="padding:30px;font-family:'Cairo',sans-serif;direction:rtl;background:white">${buildPDFHeader('تقرير الأداء الشامل', 'تحليل أداء فريق العمل', '#06579F')}<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px"><div style="background:#dbeafe;padding:14px;border-radius:8px;text-align:center"><div style="font-size:22px;font-weight:800;color:#06579F">${empData.length}</div><div style="color:#64748b;font-size:12px">موظف تم تقييمه</div></div><div style="background:#d1fae5;padding:14px;border-radius:8px;text-align:center"><div style="font-size:22px;font-weight:800;color:#059669">${overallAvg}%</div><div style="color:#64748b;font-size:12px">المتوسط العام</div></div><div style="background:#fef3c7;padding:14px;border-radius:8px;text-align:center"><div style="font-size:22px;font-weight:800;color:#d97706">${empData.filter(e=>e.avg>=85).length}</div><div style="color:#64748b;font-size:12px">ناجح</div></div></div><table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:#06579F;color:white"><th style="padding:8px;border:1px solid #044a87">#</th><th style="padding:8px;border:1px solid #044a87">الرقم الوظيفي</th><th style="padding:8px;border:1px solid #044a87">الموظف</th><th style="padding:8px;border:1px solid #044a87">المسمى الوظيفي</th><th style="padding:8px;border:1px solid #044a87">المشرف</th><th style="padding:8px;border:1px solid #044a87">التقييمات</th><th style="padding:8px;border:1px solid #044a87">المتوسط</th><th style="padding:8px;border:1px solid #044a87">أعلى</th><th style="padding:8px;border:1px solid #044a87">أدنى</th><th style="padding:8px;border:1px solid #044a87">التقدير</th></tr></thead><tbody style="background:white">${rows.replace(/<td/g,'<td style="padding:6px;border:1px solid #cbd5e1"').replace(/style="text-align:center"/g,'style="text-align:center;padding:6px;border:1px solid #cbd5e1"').replace(/style="text-align:center;color:#059669"/g,'style="text-align:center;color:#059669;padding:6px;border:1px solid #cbd5e1"').replace(/style="text-align:center;color:#dc2626"/g,'style="text-align:center;color:#dc2626;padding:6px;border:1px solid #cbd5e1"')}</tbody></table></div>`;
await htmlToPDF(html, `تقرير_الأداء_${new Date().toISOString().slice(0,10)}.pdf`);
}

// ============================================
// تقارير Creative Gene (منفصلة تماماً بـ department_id)
// ============================================
function renderCgReports() {
const period = currentParams.period||'all', month = currentParams.month||'', fromDate = currentParams.from||'', toDate = currentParams.to||'', empF = currentParams.emp||'';
let cgEmps = DB.getUsers({ role:'employee' }).filter(e => e.department_id === cgDeptId());
if (currentUser.role === 'supervisor') cgEmps = cgEmps.filter(e => e.supervisor_id === currentUser.id || e.supervisor_name === currentUser.full_name);
const empOpts = cgEmps.map(e => `<option value="${e.id}" ${String(e.id)===String(empF)?'selected':''}>${Utils.escape(e.full_name)}</option>`).join('');
const monthSet = new Set();
(DB.data.evaluations||[]).filter(e => e.template_type==='pdf_based_weekly').forEach(e => { if (e.week_start) { const d=new Date(e.week_start); monthSet.add(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`); } });
const monthOpts = Array.from(monthSet).sort().reverse().map(m => `<option value="${m}" ${m===month?'selected':''}>${arabicMonthName(m)}</option>`).join('');
return `
<div class="page-header"><div><div class="page-title">🎨 تقارير Creative Gene</div><div class="page-subtitle">التقييمات الأسبوعية بالملفات</div></div>
<div style="display:flex;gap:8px"><button class="btn btn-success" id="rep-export-xlsx">📊 تصدير Excel</button><button class="btn btn-danger" id="rep-export-pdf">📄 تصدير PDF</button></div></div>
<div class="card" style="margin-bottom:20px"><div style="padding:16px;background:#f8fafc;border-bottom:1px solid var(--border)">
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;align-items:end">
<div class="form-group" style="margin:0"><label class="form-label" style="font-size:12px">الفترة</label><select class="form-control rep-filter" id="rep-period"><option value="all" ${period==='all'?'selected':''}>كل البيانات</option><option value="month" ${period==='month'?'selected':''}>شهر</option><option value="custom" ${period==='custom'?'selected':''}>فترة مخصصة</option></select></div>
<div class="form-group" style="margin:0;${period==='month'?'':'display:none'}" id="rep-month-wrap"><label class="form-label" style="font-size:12px">الشهر</label><select class="form-control rep-filter" id="rep-month">${monthOpts}</select></div>
<div class="form-group" style="margin:0;${period==='custom'?'':'display:none'}" id="rep-from-wrap"><label class="form-label" style="font-size:12px">من</label><input type="date" class="form-control rep-filter" id="rep-from" value="${fromDate}"></div>
<div class="form-group" style="margin:0;${period==='custom'?'':'display:none'}" id="rep-to-wrap"><label class="form-label" style="font-size:12px">إلى</label><input type="date" class="form-control rep-filter" id="rep-to" value="${toDate}"></div>
<div class="form-group" style="margin:0"><label class="form-label" style="font-size:12px">الموظف</label><select class="form-control rep-filter" id="rep-emp"><option value="">الكل</option>${empOpts}</select></div>
<button class="btn btn-secondary" id="rep-clear" style="height:42px">🔄 إعادة تعيين</button>
</div></div></div>
<div id="cg-reports-body"><div class="card"><div class="card-body">⏳ جارٍ التحميل…</div></div></div>`;
}
async function loadCgReports() {
const host = document.getElementById('cg-reports-body'); if (!host) return;
await loadDepartments();
const tpl = await loadTemplateFor(cgDeptId());
const criteria = (tpl && tpl.ok && tpl.exists && Array.isArray(tpl.template.criteria)) ? tpl.template.criteria : [];
const period = currentParams.period||'all', month = currentParams.month||'', fromDate = currentParams.from||'', toDate = currentParams.to||'', empF = currentParams.emp?parseInt(currentParams.emp):null;
let cgEmpIds = new Set(DB.getUsers({ role:'employee' }).filter(e => e.department_id === cgDeptId() && (currentUser.role!=='supervisor' || e.supervisor_id===currentUser.id || e.supervisor_name===currentUser.full_name)).map(e => e.id));
let evals = (DB.data.evaluations||[]).filter(e => e.template_type==='pdf_based_weekly' && cgEmpIds.has(e.employee_id));
if (empF) evals = evals.filter(e => e.employee_id === empF);
const inPeriod = (dstr) => { if (period==='all' || !dstr) return true; const d=new Date(dstr); if (period==='month'&&month){const[y,m]=month.split('-').map(Number);return d.getFullYear()===y&&d.getMonth()===m-1;} if (period==='custom'&&fromDate&&toDate){return d>=new Date(fromDate)&&d<=new Date(toDate);} return true; };
evals = evals.filter(e => inPeriod(e.week_start||e.evaluation_date)).sort((a,b)=> String(b.week_start||'').localeCompare(String(a.week_start||'')));
const evalIds = evals.map(e => e.id);
const objMap = {}, actMap = {};
if (evalIds.length) { try { const [{ data:objs },{ data:acts }] = await Promise.all([window.sb.from('creative_gene_objections').select('*').in('evaluation_id',evalIds), window.sb.from('creative_gene_actions').select('*').in('evaluation_id',evalIds)]); (objs||[]).forEach(o=>objMap[o.evaluation_id]=o); (acts||[]).forEach(a=>actMap[a.evaluation_id]=a); } catch(_){} }
let uploads = 0, openObj = 0;
try { const { data:st } = await window.sb.from('creative_gene_weekly_status').select('employee_id,pdf_file_path'); uploads = (st||[]).filter(s => s.pdf_file_path && cgEmpIds.has(s.employee_id)).length; } catch(_){}
try { const { data:ob } = await window.sb.from('creative_gene_objections').select('status,employee_id'); openObj = (ob||[]).filter(o => o.status==='pending' && cgEmpIds.has(o.employee_id)).length; } catch(_){}
const evalCount = evals.length;
const avg = evalCount ? Math.round(evals.reduce((s,e)=> s+(+e.percentage||0), 0)/evalCount*10)/10 : 0;
const actionsCount = Object.keys(actMap).length;
const objLabel = (o) => o ? (o.status==='accepted'?'مقبول':(o.status==='rejected'?'مرفوض':'قيد المراجعة')) : '—';
const exportRows = [];
const rowsHtml = evals.map(e => { const emp=DB.getUser(e.employee_id); const scores=e.section_scores||e.items||{}; const o=objMap[e.id], a=actMap[e.id];
const critCells = criteria.map(c => `<td style="text-align:center">${scores[c.id]!=null?scores[c.id]:'—'}</td>`).join('');
const tplLabel = usedTemplateLabel(e);
const row = { 'الموظف': emp?emp.full_name:'-', 'المسمى الوظيفي': (emp&&emp.job_title)?emp.job_title:'-', 'الأسبوع': (e.week_start||'')+' - '+(e.week_end||''), 'النموذج المُستخدم': tplLabel };
criteria.forEach(c => { row[c.name] = scores[c.id]!=null?scores[c.id]:''; });
row['الدرجة الكلية'] = e.percentage; row['الملاحظات'] = e.evaluation_notes||''; row['الاعتراض'] = objLabel(o); row['الإجراء'] = a ? actionTypeLabel(a.action_type).replace(/[^؀-ۿ ]/g,'').trim() : '—';
exportRows.push(row);
return `<tr><td>${emp?Utils.escape(emp.full_name):'-'}</td><td>${jobTitleCell(emp)}</td><td>${e.week_start||''} ← ${e.week_end||''}</td><td style="font-size:12px;color:var(--muted)">${Utils.escape(tplLabel)}</td><td><button class="btn btn-sm btn-secondary" onclick="openCgPdfByEval(${e.id})">📄 فتح</button></td>${critCells}<td style="text-align:center"><strong>${e.percentage} / 100</strong></td><td>${e.evaluation_notes?Utils.escape(e.evaluation_notes):'—'}</td><td>${objLabel(o)}</td><td>${a?actionTypeLabel(a.action_type):'—'}</td></tr>`;
}).join('');
window._cgReportData = exportRows;
const critHeaders = criteria.map(c => `<th style="text-align:center">${Utils.escape(c.name)}</th>`).join('');
host.innerHTML = `
<div class="stats-grid">
<div class="stat-card" style="background:linear-gradient(135deg,#a855f7,#7c3aed);color:white"><div class="stat-icon" style="background:rgba(255,255,255,0.25)">📎</div><div class="stat-value" style="color:white">${uploads}</div><div class="stat-label" style="color:rgba(255,255,255,0.9)">ملفات مرفوعة</div></div>
<div class="stat-card" style="background:linear-gradient(135deg,#06b6d4,#0891b2);color:white"><div class="stat-icon" style="background:rgba(255,255,255,0.25)">📋</div><div class="stat-value" style="color:white">${evalCount}</div><div class="stat-label" style="color:rgba(255,255,255,0.9)">تقييمات</div></div>
<div class="stat-card" style="background:linear-gradient(135deg,#10b981,#059669);color:white"><div class="stat-icon" style="background:rgba(255,255,255,0.25)">⭐</div><div class="stat-value" style="color:white">${avg}%</div><div class="stat-label" style="color:rgba(255,255,255,0.9)">متوسط الدرجة</div></div>
<div class="stat-card" style="background:linear-gradient(135deg,#f59e0b,#d97706);color:white"><div class="stat-icon" style="background:rgba(255,255,255,0.25)">⚖️</div><div class="stat-value" style="color:white">${openObj}</div><div class="stat-label" style="color:rgba(255,255,255,0.9)">اعتراضات مفتوحة</div></div>
<div class="stat-card" style="background:linear-gradient(135deg,#ef4444,#dc2626);color:white"><div class="stat-icon" style="background:rgba(255,255,255,0.25)">🎯</div><div class="stat-value" style="color:white">${actionsCount}</div><div class="stat-label" style="color:rgba(255,255,255,0.9)">إجراءات متخذة</div></div>
</div>
<div class="card" style="margin-top:20px"><div class="card-header"><div class="card-title">📄 التقييمات الأسبوعية</div></div>
<div style="overflow-x:auto"><table class="table"><thead><tr><th>الموظف</th><th>المسمى الوظيفي</th><th>الأسبوع</th><th>النموذج المُستخدم</th><th>PDF</th>${critHeaders}<th>الدرجة الكلية</th><th>الملاحظات</th><th>الاعتراض</th><th>الإجراء</th></tr></thead>
<tbody>${rowsHtml || `<tr><td colspan="${9+criteria.length}" style="text-align:center;padding:20px;color:var(--muted)">لا توجد بيانات</td></tr>`}</tbody></table></div></div>`;
}
function exportCgReportsXLSX() {
const data = window._cgReportData || [];
if (!data.length) { Toast.error('لا توجد بيانات للتصدير'); return; }
const ws = XLSX.utils.json_to_sheet(data);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'تقرير Creative Gene');
XLSX.writeFile(wb, `تقرير_Creative_Gene_${new Date().toISOString().slice(0,10)}.xlsx`);
Toast.success('تم تصدير ملف Excel');
}
async function exportCgReportsPDF() {
const data = window._cgReportData || [];
if (!data.length) { Toast.error('لا توجد بيانات للتصدير'); return; }
const cols = Object.keys(data[0]);
const head = cols.map(c => `<th style="padding:6px;border:1px solid #cbd5e1;background:#7c3aed;color:white">${Utils.escape(c)}</th>`).join('');
const body = data.map(r => `<tr>${cols.map(c => `<td style="padding:5px;border:1px solid #cbd5e1;text-align:center">${Utils.escape(r[c]!=null?String(r[c]):'')}</td>`).join('')}</tr>`).join('');
const html = `<div style="padding:24px;font-family:'Cairo',sans-serif;direction:rtl;background:white">${buildPDFHeader('تقرير Creative Gene','التقييمات الأسبوعية بالملفات','#7c3aed')}<table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
await htmlToPDF(html, `تقرير_Creative_Gene_${new Date().toISOString().slice(0,10)}.pdf`);
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

function getMonthlyData(monthKey, deptId) {
const [y, m] = monthKey.split('-').map(Number);
let employees = DB.getUsers({ role:'employee' });
if (deptId) employees = employees.filter(e => e.department_id === deptId);
if (currentUser.role === 'supervisor') employees = employees.filter(e => e.supervisor_id === currentUser.id || e.supervisor_name === currentUser.full_name);
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
job_title: e.job_title || '',
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
if (!window._departments) loadDepartments(true).then(() => { if (currentPage === 'monthly-report') navigate('monthly-report', currentParams); });
const deptId = currentParams.dept ? parseInt(currentParams.dept) : null;
const deptObj = deptId ? (window._departments||[]).find(d => d.id === deptId) : null;
const months = getMonthOptions();
const now = new Date();
const currentMonth = currentParams.month || `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
const monthOpts = months.map(m => `<option value="${m}" ${m===currentMonth?'selected':''}>${arabicMonthName(m)}</option>`).join('');

const data = getMonthlyData(currentMonth, deptId);
const withEvals = data.filter(d => d.count > 0);
const totalEvals = data.reduce((s,d) => s+d.count, 0);
const avgOverall = withEvals.length ? Math.round(withEvals.reduce((s,d)=>s+d.avg,0)/withEvals.length*10)/10 : 0;
const topEmp = withEvals.length ? [...withEvals].sort((a,b)=>b.avg-a.avg)[0] : null;
const needCount = withEvals.filter(d => d.avg < 85).length;

const rows = data.map(d => `<tr>
<td><strong>${Utils.escape(d.employee_number)}</strong></td>
<td><div style="display:flex;align-items:center;gap:10px"><div class="user-avatar">${Utils.getInitials(d.name)}</div>${Utils.escape(d.name)}</div></td>
<td>${d.job_title?Utils.escape(d.job_title):'<span style="color:var(--muted)">—</span>'}</td>
<td>${Utils.escape(d.supervisor)}</td>
<td style="text-align:center">${d.count}</td>
<td style="text-align:center">${d.count>0?'<strong>'+d.avg+'%</strong>':'<span class="badge badge-info">لا يوجد</span>'}</td>
<td style="text-align:center;color:var(--success);font-weight:600">${d.count>0?d.high+'%':'-'}</td>
<td style="text-align:center;color:var(--danger);font-weight:600">${d.count>0?d.low+'%':'-'}</td>
<td>${d.count>0?Utils.gradeBadge(d.avg):'<span class="badge badge-info">لم يقيّم</span>'}</td>
</tr>`).join('');

return `
<div class="page-header">
<div><div class="page-title">📅 التقرير الشهري${deptObj?' — '+Utils.escape(deptObj.name):''}</div><div class="page-subtitle">${deptObj?'قسم '+Utils.escape(deptObj.name)+' — ':''}عرض النتائج النهائية للموظفين خلال الشهر</div></div>
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
const data = getMonthlyData(monthKey, currentParams.dept ? parseInt(currentParams.dept) : null);
const rows = data.map(d => ({
'الرقم الوظيفي': d.employee_number,
'اسم الموظف': d.name,
'المسمى الوظيفي': d.job_title || '-',
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
const data = getMonthlyData(monthKey, currentParams.dept ? parseInt(currentParams.dept) : null);
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
const employees = DB.getUsers({ role:'employee' }).filter(e => e.department_id === mahzamDeptId());
const _empIds = new Set(employees.map(e => e.id));
const evals = DB.data.evaluations.filter(x => _empIds.has(x.employee_id));

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
const _mahzamIds = new Set(DB.getUsers({ role:'employee' }).filter(e => e.department_id === mahzamDeptId()).map(e => e.id));
let evals = DB.data.evaluations.filter(ev => {
const d = new Date(ev.evaluation_date);
return d.getFullYear() === y && d.getMonth() === m - 1 && _mahzamIds.has(ev.employee_id);
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
if (window.SupabaseSync && SupabaseSync.pullAll) { try{ await SupabaseSync.pullAll(true); }catch(_){} }
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
if (window.SupabaseSync && SupabaseSync.pullAll) { try{ await SupabaseSync.pullAll(true); }catch(_){} }
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
if (window.SupabaseSync && SupabaseSync.pullAll) { try{ await SupabaseSync.pullAll(true); }catch(_){} }
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
if (window.SupabaseSync && SupabaseSync.pullAll) { try{ await SupabaseSync.pullAll(true); }catch(_){} }
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
let evals = DB.getEvaluations(isEmp ? { employee_id: currentUser.id } : {});
const deptF = currentParams.dept ? parseInt(currentParams.dept) : null;
if (deptF) evals = evals.filter(e => { const u = DB.getUser(e.employee_id); return u && u.department_id == deptF; });
const rows = evals.map(e => {
const emp = DB.getUser(e.employee_id), evr = DB.getUser(e.evaluator_id);
const dept = emp ? (window._departments||[]).find(d => d.id === emp.department_id) : null;
return {
'#': e.id,
'الموظف': emp ? emp.full_name : '-',
'المسمى الوظيفي': (emp && emp.job_title) ? emp.job_title : '-',
'القسم': dept ? dept.name : '-',
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
ws['!cols'] = [{wch:5},{wch:25},{wch:18},{wch:14},{wch:25},{wch:12},{wch:18},{wch:8},{wch:8},{wch:12},{wch:8},{wch:30}];
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
let evals = DB.getEvaluations(isEmp ? { employee_id: currentUser.id } : {});
const deptF = currentParams.dept ? parseInt(currentParams.dept) : null;
if (deptF) evals = evals.filter(e => { const u = DB.getUser(e.employee_id); return u && u.department_id == deptF; });
const today = new Date();
const dateStr = `${today.getDate().toString().padStart(2,'0')}/${(today.getMonth()+1).toString().padStart(2,'0')}/${today.getFullYear()}`;

const rows = evals.map(e => {
const emp = DB.getUser(e.employee_id), evr = DB.getUser(e.evaluator_id);
const dept = emp ? (window._departments||[]).find(d => d.id === emp.department_id) : null;
const cls = e.percentage >= 85 ? '#d1fae5;color:#065f46' : '#fee2e2;color:#991b1b';
return `<tr>
<td style="padding:8px;border:1px solid #e2e8f0;text-align:center">#${e.id}</td>
<td style="padding:8px;border:1px solid #e2e8f0">${Utils.escape(emp?emp.full_name:'-')}</td>
<td style="padding:8px;border:1px solid #e2e8f0">${(emp&&emp.job_title)?Utils.escape(emp.job_title):'-'}</td>
<td style="padding:8px;border:1px solid #e2e8f0">${dept?Utils.escape(dept.name):'-'}</td>
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
<th style="padding:10px;border:1px solid #044a87">المسمى الوظيفي</th>
<th style="padding:10px;border:1px solid #044a87">القسم</th>
<th style="padding:10px;border:1px solid #044a87">المقيِّم</th>
<th style="padding:10px;border:1px solid #044a87">التاريخ</th>
<th style="padding:10px;border:1px solid #044a87">الدرجة</th>
<th style="padding:10px;border:1px solid #044a87">النسبة</th>
<th style="padding:10px;border:1px solid #044a87">التقدير</th>
<th style="padding:10px;border:1px solid #044a87">الحالة</th>
</tr>
</thead>
<tbody>${rows || '<tr><td colspan="10" style="padding:20px;text-align:center;color:#64748b">لا توجد تقييمات</td></tr>'}</tbody>
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
const canEdit = Perms.can('edit_evaluation') || (currentUser.role === 'supervisor' && ev.evaluator_id === currentUser.id);
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
${buildCommTypeField(ev)}
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

const commType = (document.getElementById('ef-commtype')||{}).value || '';
const commRef = ((document.getElementById('ef-commref')||{}).value || '').trim();
if (!commType) { Toast.error('يرجى اختيار نوع التواصل'); return false; }
if (!commRef) { Toast.error(commType==='chat' ? 'يرجى لصق رابط المحادثة' : 'يرجى إدخال رقم/كود المكالمة'); return false; }

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
p_items: items,
p_communication_type: commType,
p_communication_reference: commRef
});
const row = (!error && Array.isArray(data) && data[0]) ? data[0] : null;
if (!row || !row.ok) { const msg=(row&&row.message)||(error&&error.message)||'تعذّر حفظ التعديلات'; const h=handleSessionError(msg); if(!h) Toast.error(msg); return false; }
if (window.SupabaseSync && SupabaseSync.pullAll) { try{ await SupabaseSync.pullAll(true); }catch(_){} }
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
communication_type: commType, communication_reference: commRef,
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
// حارس: الإعدادات لـ admin و quality_officer فقط
if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'quality_officer')) {
return '<div class="alert alert-danger">🚫 غير مصرح لك بالوصول لهذه الصفحة</div>';
}
const isAdmin = currentUser.role === 'admin';
// تبويب "تعديل التقييمات" (يحوي الحذف) للأدمن فقط
const tabs = [
{ key:'form', label:'📝 نموذج محزم', icon:'📝' },
{ key:'weights', label:'🎯 النقاط والأوزان', icon:'🎯' },
{ key:'cg', label:'🎨 نموذج Creative Gene', icon:'🎨' }
];
if (isAdmin) tabs.push({ key:'evals', label:'✏️ تعديل التقييمات', icon:'✏️' });
// موظف الجودة لا يصل لتبويب evals — حوّله لـ form
if (activeTab === 'evals' && !isAdmin) activeTab = 'form';
const tabsHTML = tabs.map(t => `
<button class="btn ${activeTab === t.key ? 'btn-primary' : 'btn-secondary'}" data-nav-settings="${t.key}">${t.label}</button>
`).join('');

let body = '';
if (activeTab === 'form') body = renderSettingsForm();
else if (activeTab === 'weights') body = renderSettingsWeights();
else if (activeTab === 'cg') body = renderSettingsCg();
else if (activeTab === 'evals' && isAdmin) body = renderSettingsEvals();

return `
<div class="page-header">
<div><div class="page-title">⚙️ الإعدادات</div><div class="page-subtitle">تخصيص نموذج التقييم وإدارته</div></div>
${activeTab === 'cg' ? '' : '<button class="btn btn-danger" id="reset-criteria-btn">🔄 استعادة الإعدادات الافتراضية</button>'}
</div>
<div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap">${tabsHTML}</div>
${body}`;
}

// شبكة أمان: تأكيد وجود مفتاح لكل قسم فرعي/بند (قوالب قديمة قد تنقصها) ليبقى التعديل/الحذف ممكناً
function ensureCriteriaKeys() {
if (!CRITERIA || !Array.isArray(CRITERIA.sections)) return;
CRITERIA.sections.forEach(s => {
(s.subsections || []).forEach((sub, i) => {
if (!sub.key) sub.key = `${s.key || 'section'}_s${i + 1}`;
(sub.items || []).forEach((it, j) => { if (!it.key) it.key = `${sub.key}_i${j + 1}`; });
});
});
}

function renderSettingsForm() {
ensureCriteriaKeys();
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
<td>${e.communication_type==='chat'?'<span title="محادثة">💬</span> ':e.communication_type==='call'?'<span title="اتصال">📞</span> ':''}${Utils.escape(emp?emp.full_name:'-')}</td>
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
// إعادة الإيجاد من CRITERIA الحالي وقت الحفظ (المرجع الملتقَط قد يتقادم بعد أي مزامنة)
if (editKey) {
const target = CRITERIA.sections.find(s => s.key === editKey);
if (!target) { Toast.error('تعذّر إيجاد القسم'); return false; }
target.title = title; target.type = type; target.weight = weight;
} else {
if (CRITERIA.sections.find(s => s.key === key)) { Toast.error('المفتاح موجود مسبقاً'); return false; }
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
// إعادة إيجاد القسم من CRITERIA الحالي وقت الحفظ (تفادي المرجع المتقادم بعد المزامنة)
const curSec = CRITERIA.sections.find(s => s.key === sectionKey);
if (!curSec) { Toast.error('تعذّر إيجاد القسم'); return false; }
if (editKey) {
const target = curSec.subsections.find(sub => sub.key === editKey);
if (!target) { Toast.error('تعذّر إيجاد القسم الفرعي'); return false; }
target.title = title;
if (isNonCritical) target.weight = weight;
} else {
if (curSec.subsections.find(sub => sub.key === key)) { Toast.error('المفتاح موجود مسبقاً'); return false; }
curSec.subsections.push({ key, title, weight, items:[{ key:key+'_1', label:'بند جديد - يمكنك تعديله' }] });
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
// إعادة إيجاد القسم/الفرعي من CRITERIA الحالي وقت الحفظ (تفادي المرجع المتقادم بعد المزامنة)
const curSec = CRITERIA.sections.find(s => s.key === sectionKey);
const curSub = curSec && curSec.subsections.find(x => x.key === subKey);
if (!curSub) { Toast.error('تعذّر إيجاد القسم الفرعي'); return false; }
if (editKey) {
const target = curSub.items.find(i => i.key === editKey);
if (!target) { Toast.error('تعذّر إيجاد البند'); return false; }
target.label = label;
} else {
if (curSub.items.find(i => i.key === key)) { Toast.error('المفتاح موجود مسبقاً'); return false; }
curSub.items.push({ key, label });
}
if (!(await saveCriteriaViaRPC())) return false;
Modal.close();
Toast.success('تم الحفظ');
if (typeof navigate === 'function') navigate('settings', { tab:'form' });
return true;
});
});
}

// ---- تخصيص نموذج Creative Gene ----
function renderSettingsCg() {
const _r = currentParams.role || '';
const roleOpts = JOB_ROLES.map(([v,l]) => `<option value="${v}" ${v===_r?'selected':''}>${l}</option>`).join('');
return `<div class="card"><div class="card-body"><div class="form-group" style="margin:0"><label class="form-label">النموذج (حسب المسمى الوظيفي)</label>
<select class="form-control" id="cg-role-select" onchange="loadCgSettings(this.value)" style="max-width:320px"><option value="" ${_r?'':'selected'}>🟣 النموذج الافتراضي</option>${roleOpts}</select></div></div></div>
<div id="cg-settings-body"><div class="card"><div class="card-body">⏳ جارٍ تحميل النموذج…</div></div></div>`;
}
async function loadCgSettings(role) {
const host = document.getElementById('cg-settings-body');
if (!host) return;
await loadDepartments();
window._cgEditRole = role || null;
const tpl = await fetchCgRoleTemplate(window._cgEditRole);
if (!tpl) {
const def = await fetchCgRoleTemplate(null);
window._cgEdit = null;
host.innerHTML = `<div class="alert alert-info">لا يوجد نموذج مخصّص لهذا المسمى — سيُستخدم <strong>النموذج الافتراضي</strong> عند التقييم.</div>
${def ? '<button class="btn btn-primary" onclick="createCgRoleTemplate()">➕ إنشاء نموذج مخصّص (نسخ من الافتراضي)</button>' : '<div class="alert alert-danger">لا يوجد نموذج افتراضي</div>'}`;
return;
}
window._cgEdit = JSON.parse(JSON.stringify(tpl.template_jsonb));
if (!Array.isArray(window._cgEdit.criteria)) window._cgEdit.criteria = [];
if (!Array.isArray(window._cgEdit.allowed_action_types)) window._cgEdit.allowed_action_types = ['warning','training','praise','other'];
renderCgEditor();
}
async function createCgRoleTemplate() {
const def = await fetchCgRoleTemplate(null);
if (!def) { Toast.error('لا يوجد نموذج افتراضي'); return; }
window._cgEdit = JSON.parse(JSON.stringify(def.template_jsonb));
if (!Array.isArray(window._cgEdit.criteria)) window._cgEdit.criteria = [];
if (!Array.isArray(window._cgEdit.allowed_action_types)) window._cgEdit.allowed_action_types = ['warning','training','praise','other'];
renderCgEditor();
}
function syncCgInputs() {
const t = window._cgEdit; if (!t) return;
document.querySelectorAll('.cg-crit-name').forEach(inp => { const i=+inp.dataset.i; if (t.criteria[i]) t.criteria[i].name = inp.value; });
document.querySelectorAll('.cg-crit-weight').forEach(inp => { const i=+inp.dataset.i; if (t.criteria[i]) t.criteria[i].weight = parseFloat(inp.value)||0; });
const oh=document.getElementById('cg-obj-hours'); if (oh) t.objection_window_hours = parseInt(oh.value)||48;
const ps=document.getElementById('cg-pdf-size'); if (ps) t.pdf_max_size_mb = parseInt(ps.value)||20;
}
function renderCgEditor() {
const host = document.getElementById('cg-settings-body'); if (!host) return;
const t = window._cgEdit;
const crit = t.criteria || [];
const totalW = crit.reduce((s,c)=> s + (parseFloat(c.weight)||0), 0);
const critRows = crit.map((c,i) => `<div class="card" style="margin-bottom:8px"><div class="card-body" style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
<div class="form-group" style="flex:2;margin:0;min-width:180px"><label class="form-label">اسم المعيار</label><input class="form-control cg-crit-name" data-i="${i}" value="${Utils.escape(c.name||'')}"></div>
<div class="form-group" style="flex:1;margin:0;min-width:90px"><label class="form-label">الوزن %</label><input type="number" min="0" max="100" class="form-control cg-crit-weight" data-i="${i}" value="${c.weight}"></div>
<button class="btn btn-danger cg-crit-del" data-i="${i}">حذف</button>
</div></div>`).join('');
const types = t.allowed_action_types || [];
const typeChips = types.map((ty,i)=>`<span class="badge badge-info" style="margin:2px;font-size:13px">${Utils.escape(actionTypeLabel(ty))} <a href="#" class="cg-type-del" data-i="${i}" style="color:#fff;text-decoration:none">✕</a></span>`).join('') || '<span style="color:var(--muted)">لا يوجد</span>';
host.innerHTML = `
<div class="alert ${totalW===100?'alert-success':'alert-warning'}">مجموع الأوزان: <strong>${totalW}%</strong> ${totalW===100?'✅':'— يجب أن يساوي 100% قبل الحفظ'}</div>
<div class="card"><div class="card-header"><div class="card-title">📊 معايير التقييم</div></div><div class="card-body">
${critRows || '<div class="alert alert-info">لا توجد معايير.</div>'}
<button class="btn btn-secondary" id="cg-add-crit">➕ إضافة معيار</button>
</div></div>
<div class="card"><div class="card-header"><div class="card-title">⚙️ إعدادات متقدمة</div></div><div class="card-body">
<div class="grid grid-2">
<div class="form-group"><label class="form-label">نافذة الاعتراض (ساعات)</label><input type="number" min="1" class="form-control" id="cg-obj-hours" value="${t.objection_window_hours||48}"></div>
<div class="form-group"><label class="form-label">الحد الأقصى لحجم PDF (ميجا) <span style="color:var(--muted);font-size:11px">(الأقصى 20)</span></label><input type="number" min="1" max="20" class="form-control" id="cg-pdf-size" value="${t.pdf_max_size_mb||20}"></div>
</div>
<div class="form-group"><label class="form-label">أنواع الإجراءات المسموحة</label><div id="cg-types" style="margin-bottom:8px">${typeChips}</div>
<div style="display:flex;gap:8px"><input class="form-control" id="cg-new-type" placeholder="كود الإجراء (إنجليزي، مثل: suspension)" style="max-width:260px"><button class="btn btn-secondary" id="cg-add-type">إضافة</button></div>
</div>
</div></div>
<div style="display:flex;justify-content:flex-end"><button class="btn btn-success" id="cg-save-tpl" style="padding:12px 26px">💾 حفظ نموذج Creative Gene</button></div>
<div class="alert alert-info" style="margin-top:12px;font-size:13px">تعديل/حذف/إضافة معيار أو تغيير الأوزان لا يؤثّر على التقييمات السابقة (محفوظة بـ snapshot) — يُطبَّق على التقييمات الجديدة فقط.</div>`;
attachCgEditorHandlers();
}
function attachCgEditorHandlers() {
const addCrit = document.getElementById('cg-add-crit');
if (addCrit) addCrit.addEventListener('click', () => {
Modal.show('إضافة معيار', `
<div class="form-group"><label class="form-label">اسم المعيار *</label><input class="form-control" id="nc-name"></div>
<div class="form-group"><label class="form-label">الوزن % *</label><input type="number" min="0" max="100" class="form-control" id="nc-weight" value="0"></div>
<div class="form-group"><label class="form-label">النوع</label><select class="form-control" id="nc-type"><option value="score">درجة (0-100)</option><option value="percentage">نسبة مئوية</option></select></div>`,
`<button class="btn btn-secondary" onclick="Modal.close()">إلغاء</button><button class="btn btn-primary" id="nc-save">إضافة</button>`);
document.getElementById('nc-save').addEventListener('click', () => {
const name=document.getElementById('nc-name').value.trim(); const weight=parseFloat(document.getElementById('nc-weight').value)||0; const type=document.getElementById('nc-type').value;
if (!name) { Toast.error('اسم المعيار مطلوب'); return; }
syncCgInputs();
const id = 'c_' + name.replace(/[^\w]+/g,'_').toLowerCase() + '_' + (window._cgEdit.criteria.length+1);
window._cgEdit.criteria.push({ id, name, weight, type, min:0, max:100 });
Modal.close(); renderCgEditor();
});
});
document.querySelectorAll('.cg-crit-del').forEach(b => b.addEventListener('click', () => {
if (!confirm('حذف هذا المعيار؟ لن يؤثر على التقييمات السابقة، ولن يظهر في الجديدة.')) return;
syncCgInputs(); window._cgEdit.criteria.splice(+b.dataset.i, 1); renderCgEditor();
}));
const addType = document.getElementById('cg-add-type');
if (addType) addType.addEventListener('click', () => {
const v = (document.getElementById('cg-new-type').value||'').trim().toLowerCase().replace(/\s+/g,'_');
if (!v) { Toast.error('أدخل كود الإجراء'); return; }
syncCgInputs();
if (!window._cgEdit.allowed_action_types.includes(v)) window._cgEdit.allowed_action_types.push(v);
renderCgEditor();
});
document.querySelectorAll('.cg-type-del').forEach(a => a.addEventListener('click', (e) => {
e.preventDefault(); syncCgInputs(); window._cgEdit.allowed_action_types.splice(+a.dataset.i, 1); renderCgEditor();
}));
const save = document.getElementById('cg-save-tpl');
if (save) save.addEventListener('click', async () => {
syncCgInputs();
const t = window._cgEdit;
if (!t.criteria.length) { Toast.error('أضف معياراً واحداً على الأقل'); return; }
if (t.criteria.some(c => !c.name || !c.name.trim())) { Toast.error('كل معيار يحتاج اسماً'); return; }
const totalW = t.criteria.reduce((s,c)=> s + (parseFloat(c.weight)||0), 0);
if (Math.round(totalW) !== 100) { Toast.error(`مجموع الأوزان = ${totalW}% — يجب أن يساوي 100%`); return; }
if ((parseInt(t.pdf_max_size_mb)||20) > 20) { Toast.error('الحد الأقصى المسموح حالياً 20MB. لزيادة السقف يتطلب تعديل bucket من الخادم.'); return; }
await submitWithFeedback(save, 'جاري الحفظ...', null, async () => {
const { data, error } = await window.sb.rpc('upsert_evaluation_template', { p_session_token: cgToken(), p_department_id: cgDeptId(), p_template: t, p_template_type: 'pdf_based_weekly', p_job_role: window._cgEditRole || null });
const r = Array.isArray(data)?data[0]:data;
if (error || !r || !r.ok) { const m=(r&&r.message)||(error&&error.message)||'تعذّر الحفظ'; if(!handleSessionError(m)) Toast.error(m); return false; }
if (window._templates) delete window._templates[cgDeptId()];
Toast.success('تم حفظ نموذج Creative Gene'); return true;
});
});
}

function attachSettingsHandlers(tab) {
document.querySelectorAll('[data-nav-settings]').forEach(b => {
b.addEventListener('click', () => navigate('settings', { tab: b.dataset.navSettings }));
});
if (tab === 'cg') { loadCgSettings(currentParams.role || ''); return; }

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
// ============================================
// إدارة الأقسام والنماذج (م2-ب)
// ============================================
const ROLE_NAMES = { real_estate_marketer:'مسوّق عقاري', designer:'مصمّم', social_media:'سوشيال ميديا', seo:'SEO', content_manager:'مدير محتوى', quality_agent:'موظف جودة' };

function renderDepartments(activeTab, deptId) {
if (currentUser.role !== 'admin' && currentUser.role !== 'quality_officer') return '<div class="alert alert-danger">غير مصرح</div>';
if (!window._departments) { loadDepartments(true).then(() => { if (currentPage === 'departments') navigate('departments', { tab: activeTab, dept: deptId }); }); return '<div class="card"><div class="card-body">⏳ جارٍ التحميل…</div></div>'; }
const isAdmin = currentUser.role === 'admin' || currentUser.role === 'quality_officer';
const tab = activeTab || 'depts';
const tabsBar = `<div style="display:flex;gap:8px;margin-bottom:16px">
<button class="btn btn-sm ${tab==='depts'?'btn-primary':'btn-secondary'}" onclick="navigate('departments',{tab:'depts'})">🗂️ الأقسام</button>
<button class="btn btn-sm ${tab==='templates'?'btn-primary':'btn-secondary'}" onclick="navigate('departments',{tab:'templates',dept:${deptId||'null'}})">📋 نماذج التقييم</button></div>`;
const header = `<div class="page-header"><div><div class="page-title">🗂️ الأقسام والنماذج</div><div class="page-subtitle">إدارة الأقسام ونماذج تقييمها</div></div>
${isAdmin && tab==='depts' ? '<button class="btn btn-primary" onclick="departmentModal()">➕ إضافة قسم</button>' : ''}</div>`;
return header + tabsBar + (tab === 'templates' ? renderTemplatesTab(deptId) : renderDeptsTab(isAdmin));
}
function tmplTypeLabel(t) { return t==='task_based_weekly'?'📅 أسبوعي':(t==='section_based'?'📋 أقسام (بنود)':(t==='pdf_based_weekly'?'📄 PDF (معايير)':'—')); }
function renderDeptsTab(isAdmin) {
const canPass = currentUser.role === 'admin' || currentUser.role === 'quality_officer';
const rows = window._departments.map(d => { const ps = d.pass_score != null ? d.pass_score : 80;
return `<tr>
<td>${deptBadgeHTML(d)}</td><td><code>${Utils.escape(d.code||'-')}</code></td>
<td>${tmplTypeLabel(d.template_type)}</td>
<td style="text-align:center">${d.employee_count} موظف</td>
<td style="text-align:center">${d.templates_count!=null?d.templates_count:'—'} نموذج</td>
<td style="text-align:center"><span title="الموظف الذي يحصل على درجة أقل من هذا الرقم يعتبر راسباً في التقييم" style="cursor:help"><span class="badge badge-info" style="font-size:13px">${ps}</span> <span style="font-size:11px;color:var(--muted)">(أقل = راسب)</span></span>${canPass?` <button class="btn btn-sm btn-secondary" onclick="editPassScore(${d.id})" title="تعديل درجة النجاح">✏️</button>`:''}</td>
<td>${d.is_active?'<span class="badge badge-success">نشط</span>':'<span class="badge badge-secondary">معطّل</span>'}</td>
<td>${isAdmin?`<button class="btn btn-sm btn-warning" onclick="departmentModal(${d.id})">تعديل</button> <button class="btn btn-sm ${d.is_active?'btn-danger':'btn-success'}" onclick="setDeptActive(${d.id},${!d.is_active})">${d.is_active?'تعطيل':'تفعيل'}</button>`:'—'}</td>
</tr>`; }).join('') || '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--muted)">لا توجد أقسام</td></tr>';
return `<div class="card"><div style="overflow-x:auto"><table class="table"><thead><tr><th>القسم</th><th>الكود</th><th>نوع النموذج</th><th style="text-align:center">الموظفون</th><th style="text-align:center">النماذج</th><th style="text-align:center">درجة النجاح</th><th>الحالة</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}
function editPassScore(deptId) {
if (!(currentUser.role==='admin'||currentUser.role==='quality_officer')) { Toast.error('غير مصرح'); return; }
const d = (window._departments||[]).find(x=>x.id===deptId); if(!d){ Toast.error('القسم غير موجود'); return; }
const ps = d.pass_score!=null?d.pass_score:80;
Modal.show('درجة نجاح — '+Utils.escape(d.name), `
<div class="alert alert-info" style="font-size:13px">الموظف الذي يحصل على درجة <b>أقل</b> من هذا الرقم يُعتبر راسباً. التغيير يُعيد حساب حالة كل التقييمات (القديمة والجديدة) لهذا القسم فوراً.</div>
<div class="form-group"><label class="form-label">درجة النجاح (0 - 100) *</label><input type="number" min="0" max="100" class="form-control" id="ps-val" value="${ps}"></div>`,
`<button class="btn btn-secondary" onclick="Modal.close()">إلغاء</button><button class="btn btn-primary" id="ps-save">حفظ</button>`);
document.getElementById('ps-save').addEventListener('click', async () => {
const v = parseInt(document.getElementById('ps-val').value);
if (!(v>=0 && v<=100)) { Toast.error('أدخل رقماً بين 0 و100'); return; }
const { data, error } = await window.sb.rpc('set_department_pass_score', { p_session_token: cgToken(), p_department_id: deptId, p_pass_score: v });
const r = Array.isArray(data)?data[0]:data;
if (error || !r || !r.ok) { const m=(r&&r.message)||(error&&error.message)||'تعذّر الحفظ'; if(!handleSessionError(m)) Toast.error(m); return; }
Modal.close(); Toast.success('تم تحديث درجة النجاح'); _dashCache=null; await loadDepartments(true); navigate('departments',{tab:'depts'});
});
}
function departmentModal(id) {
const d = id ? window._departments.find(x => x.id === id) : null;
Modal.show(d?'تعديل قسم':'إضافة قسم', `
<div class="form-group"><label class="form-label">اسم القسم *</label><input class="form-control" id="dp-name" value="${d?Utils.escape(d.name):''}"></div>
<div class="form-group"><label class="form-label">الكود</label><input class="form-control" id="dp-code" value="${d?Utils.escape(d.code||''):''}"></div>
<div class="form-group"><label class="form-label">الوصف</label><input class="form-control" id="dp-desc" value="${d?Utils.escape(d.description||''):''}"></div>`,
`<button class="btn btn-secondary" onclick="Modal.close()">إلغاء</button><button class="btn btn-primary" id="dp-save">حفظ</button>`);
document.getElementById('dp-save').addEventListener('click', async () => {
const name = document.getElementById('dp-name').value.trim();
if (!name) { Toast.error('اسم القسم مطلوب'); return; }
const tok = window.getSessionToken ? getSessionToken() : null;
const args = { p_session_token: tok, p_name: name, p_code: document.getElementById('dp-code').value.trim()||null, p_description: document.getElementById('dp-desc').value.trim()||null };
if (id) args.p_id = id;
try {
const { data, error } = await window.sb.rpc(id?'update_department':'create_department', args);
const r = Array.isArray(data) ? data[0] : data;
if (error || !r || !r.ok) { const m=(r&&r.message)||(error&&error.message)||'خطأ'; if(!handleSessionError(m)) Toast.error(m); return; }
Modal.close(); Toast.success('تم الحفظ'); await loadDepartments(true); navigate('departments',{tab:'depts'});
} catch (e) { Toast.error(e.message); }
});
}
function setDeptActive(id, active) {
if (!confirm(active?'تفعيل هذا القسم؟':'تعطيل هذا القسم؟')) return;
const tok = window.getSessionToken ? getSessionToken() : null;
window.sb.rpc('set_department_active', { p_session_token: tok, p_id: id, p_active: active }).then(async ({data,error}) => {
const r = Array.isArray(data) ? data[0] : data;
if (error || !r || !r.ok) { const m=(r&&r.message)||(error&&error.message)||'خطأ'; if(!handleSessionError(m)) Toast.error(m); return; }
Toast.success('تم'); await loadDepartments(true); navigate('departments',{tab:'depts'});
}).catch(e => Toast.error(e.message));
}
function renderTemplatesTab(deptId) {
return `<div id="tmpl-tree"><div class="card"><div class="card-body">⏳ جارٍ تحميل النماذج…</div></div></div>`;
}
function cgRoleArabic(jr) { return jr ? ((JOB_ROLES.find(x => x[0] === jr)||[])[1] || jr) : 'النموذج الافتراضي'; }
async function loadTemplatesTree() {
const host = document.getElementById('tmpl-tree'); if (!host) return;
await loadDepartments();
let tmpls = [];
try { const { data } = await window.sb.from('evaluation_templates').select('id,department_id,job_role,template_type,version,is_active,template_jsonb'); tmpls = data || []; } catch(_){}
const byDept = {}; tmpls.forEach(t => { (byDept[t.department_id] = byDept[t.department_id]||[]).push(t); });
let html = '';
(window._departments||[]).forEach(d => {
const isCg = d.template_type === 'pdf_based_weekly';
const list = (byDept[d.id]||[]).sort((a,b) => (a.job_role?1:0)-(b.job_role?1:0) || String(a.job_role||'').localeCompare(String(b.job_role||'')));
if (isCg) { html += cgTemplatesCardHTML(d, list); return; }
// محزم/أخرى: عرض بسيط (النماذج الفعّالة) يقود لإعدادات النموذج
const items = list.filter(t=>t.is_active).map(t => `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid var(--border)">
<div>📄 <strong>${t.job_role?'نموذج '+Utils.escape(cgRoleArabic(t.job_role)):'النموذج الافتراضي'}</strong> <span style="color:var(--muted);font-size:12px">v${t.version}</span></div>
<div>${cgTemplateCanManage()?`<button class="btn btn-sm btn-warning" onclick="navigate('settings',{tab:'form'})">تعديل</button>`:'<span style="color:var(--muted)">عرض فقط</span>'}</div>
</div>`).join('') || '<div style="padding:14px;color:var(--muted)">لا نماذج</div>';
html += `<div class="card" style="margin-bottom:16px;border-top:4px solid #1976d2"><div class="card-header"><div class="card-title">📊 ${Utils.escape(d.name)} <span style="font-size:12px;color:var(--muted);font-weight:400">${tmplTypeLabel(d.template_type)} · ${list.filter(t=>t.is_active).length} نموذج</span></div></div><div class="card-body" style="padding:0">${items}</div></div>`;
});
host.innerHTML = html || '<div class="alert alert-info">لا توجد أقسام.</div>';
}

// ===== مدير نماذج Creative Gene (جدول + Wizard) =====
function cgTemplateCanManage() { return currentUser.role === 'admin' || currentUser.role === 'quality_officer'; }
function tplJsonb(t) { return (t && t.template_jsonb) || {}; }
function tplName(t) { return tplJsonb(t).name || (t.job_role ? 'نموذج '+cgRoleArabic(t.job_role) : 'النموذج الافتراضي'); }
function tplJobTitle(t) { return tplJsonb(t).job_title || (t.job_role ? cgRoleArabic(t.job_role) : '—'); }
function tplCriteria(t) { const c = tplJsonb(t).criteria; return Array.isArray(c) ? c : []; }
function tplWeightSum(t) { return tplCriteria(t).reduce((s,c)=>s+(parseFloat(c.weight)||0),0); }
function cgTemplatesCardHTML(d, list) {
const manage = cgTemplateCanManage();
const rows = list.map(t => {
const crit = tplCriteria(t), sum = Math.round(tplWeightSum(t)*100)/100;
const sumBadge = Math.round(sum)===100 ? `<span class="badge badge-success">${sum}</span>` : `<span class="badge badge-danger">${sum}</span>`;
const statusBadge = t.is_active ? '<span class="badge badge-success">مفعّل</span>' : '<span class="badge badge-secondary">معطّل</span>';
const isDefault = !t.job_role;
const jr = t.job_role ? `<code dir="ltr">${Utils.escape(t.job_role)}</code>` : '<span style="color:var(--muted)">— (افتراضي)</span>';
let actions = '';
if (manage) {
actions += `<button class="btn btn-sm btn-warning" onclick="openCgWizard('edit','${t.job_role||''}')">✏️ تعديل</button>`;
actions += ` <button class="btn btn-sm btn-secondary" onclick="openCgWizard('duplicate','${t.job_role||''}')">⧉ نسخ</button>`;
if (!isDefault) {
actions += ` <button class="btn btn-sm ${t.is_active?'btn-secondary':'btn-success'}" onclick="cgTemplateToggle('${t.job_role}',${!t.is_active})">${t.is_active?'⏸ تعطيل':'▶ تفعيل'}</button>`;
actions += ` <button class="btn btn-sm btn-danger" onclick="cgTemplateDelete('${t.job_role}','${Utils.escape(tplJobTitle(t)).replace(/'/g,'')}')">🗑 حذف</button>`;
}
} else actions = '<span style="color:var(--muted)">عرض فقط</span>';
return `<tr><td><strong>${Utils.escape(tplName(t))}</strong></td><td>${Utils.escape(tplJobTitle(t))}</td><td>${jr}</td><td style="text-align:center">${crit.length}</td><td style="text-align:center">${sumBadge}</td><td>${statusBadge}</td><td style="white-space:nowrap">${actions}</td></tr>`;
}).join('') || '<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--muted)">لا نماذج</td></tr>';
const addBtn = manage ? `<button class="btn btn-primary" onclick="openCgWizard('new',null)">➕ إضافة نموذج جديد</button>` : '';
return `<div class="card" style="margin-bottom:16px;border-top:4px solid #7b1fa2">
<div class="card-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px"><div class="card-title">🎨 ${Utils.escape(d.name)} <span style="font-size:12px;color:var(--muted);font-weight:400">نماذج PDF · ${list.length}</span></div>${addBtn}</div>
<div style="overflow-x:auto"><table class="table"><thead><tr><th>اسم النموذج</th><th>المسمى الوظيفي</th><th>job_role</th><th style="text-align:center">المعايير</th><th style="text-align:center">مجموع الأوزان</th><th>الحالة</th><th>إجراءات</th></tr></thead><tbody>${rows}</tbody></table></div>
</div>`;
}
const CG_DEFAULT_CRIT = [{name:'الجودة',weight:30},{name:'الإبداع',weight:25},{name:'الالتزام بالبريف',weight:20},{name:'العرض والتقديم',weight:15},{name:'التسليم في الوقت',weight:10}];
async function openCgWizard(mode, jobRole) {
if (!cgTemplateCanManage()) { Toast.error('غير مصرح'); return; }
let tpl = { name:'', job_title:'', job_role:'', criteria:[], allowed_action_types:['warning','training','praise','other'], objection_window_hours:48, pdf_max_size_mb:20 };
if (mode === 'new') {
tpl.criteria = CG_DEFAULT_CRIT.map((c,i)=>({ id:'c'+(i+1), name:c.name, weight:c.weight, type:'score', min:0, max:100 }));
} else {
const src = await fetchCgRoleTemplate(jobRole || null);
if (!src) { Toast.error('النموذج غير موجود'); return; }
const tj = src.template_jsonb || {};
tpl.name = tj.name || (jobRole ? 'نموذج '+cgRoleArabic(jobRole) : 'النموذج الافتراضي');
tpl.job_title = tj.job_title || (jobRole ? cgRoleArabic(jobRole) : '');
tpl.job_role = jobRole || '';
tpl.criteria = (Array.isArray(tj.criteria)?tj.criteria:[]).map((c,i)=>({ id:c.id||('c'+(i+1)), name:c.name||'', weight:parseFloat(c.weight)||0, type:c.type||'score', min:c.min!=null?c.min:0, max:c.max!=null?c.max:100 }));
tpl.allowed_action_types = Array.isArray(tj.allowed_action_types)?tj.allowed_action_types:tpl.allowed_action_types;
tpl.objection_window_hours = tj.objection_window_hours||48;
tpl.pdf_max_size_mb = tj.pdf_max_size_mb||20;
if (mode === 'duplicate') { tpl.name = tpl.name+' (نسخة)'; tpl.job_role=''; tpl.job_title=''; }
}
window._cgWiz = { mode, origRole: (mode==='edit'?(jobRole||''):null), step:1, tpl };
cgWizShow();
}
function cgWizShow() {
const w = window._cgWiz; if (!w) return;
const titles = { new:'➕ نموذج Creative Gene جديد', edit:'✏️ تعديل نموذج', duplicate:'⧉ نسخ نموذج' };
const stepLabel = ['1. البيانات الأساسية','2. المعايير والأوزان','3. المعاينة والحفظ'][w.step-1];
let body = `<div style="display:flex;gap:6px;margin-bottom:12px">${[1,2,3].map(s=>`<div style="flex:1;height:6px;border-radius:3px;background:${s<=w.step?'#7b1fa2':'#e2e8f0'}"></div>`).join('')}</div><div style="font-weight:700;margin-bottom:12px;color:#7b1fa2">${stepLabel}</div>`;
body += w.step===1 ? cgWizStep1HTML() : w.step===2 ? cgWizStep2HTML() : cgWizStep3HTML();
let footer = '';
if (w.step>1) footer += `<button class="btn btn-secondary" id="wiz-back">→ السابق</button>`;
footer += `<button class="btn btn-secondary" onclick="Modal.close()">إلغاء</button>`;
footer += w.step<3 ? `<button class="btn btn-primary" id="wiz-next">التالي ←</button>` : `<button class="btn btn-success" id="wiz-save">💾 حفظ النموذج</button>`;
Modal.show(titles[w.mode], body, footer);
cgWizAttach();
}
function cgWizStep1HTML() {
const w = window._cgWiz, t = w.tpl, locked = (w.mode==='edit');
return `<div class="form-group"><label class="form-label">اسم النموذج *</label><input class="form-control" id="wiz-name" value="${Utils.escape(t.name||'')}" placeholder="مثال: نموذج مصوّر فيديو"></div>
<div class="form-group"><label class="form-label">المسمى الوظيفي (بالعربي) *</label><input class="form-control" id="wiz-jtitle" value="${Utils.escape(t.job_title||'')}" placeholder="مثال: مصوّر فيديو"></div>
<div class="form-group"><label class="form-label">المعرّف التقني (job_role) * <span title="معرّف إنجليزي فريد بأحرف صغيرة وأرقام و_ فقط — يربط الموظف بالنموذج ولا يظهر للموظفين" style="cursor:help;color:#7b1fa2">ⓘ</span></label>
<input class="form-control" id="wiz-jrole" dir="ltr" value="${Utils.escape(t.job_role||'')}" placeholder="videographer" ${locked?'disabled style="background:#f1f5f9;color:#64748b"':''}>
${locked?'<div style="font-size:12px;color:var(--muted);margin-top:4px">🔒 لا يمكن تغيير المعرّف التقني لنموذج موجود (يحافظ على ربط التقييمات)</div>':'<button type="button" class="btn btn-sm btn-secondary" id="wiz-gen" style="margin-top:6px">توليد من الاسم</button>'}</div>`;
}
function cgWizStep2HTML() {
const w = window._cgWiz, crit = w.tpl.criteria;
const sum = Math.round(crit.reduce((s,c)=>s+(parseFloat(c.weight)||0),0)*100)/100, ok = Math.round(sum)===100;
const rows = crit.map((c,i)=>`<tr><td><input class="form-control wiz-cname" data-i="${i}" value="${Utils.escape(c.name||'')}" placeholder="اسم المعيار"></td><td style="width:120px"><input type="number" min="0" max="100" step="0.5" class="form-control wiz-cw" data-i="${i}" value="${c.weight}"></td><td style="width:52px"><button class="btn btn-sm btn-danger wiz-cdel" data-i="${i}">🗑</button></td></tr>`).join('');
return `<div style="overflow-x:auto"><table class="table"><thead><tr><th>اسم المعيار</th><th>الوزن</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
<button type="button" class="btn btn-secondary btn-sm" id="wiz-addcrit">➕ إضافة معيار</button>
<div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;padding:12px;border-radius:8px;background:${ok?'#f0fdf4':'#fef2f2'}"><strong>مجموع الأوزان</strong><strong id="wiz-sum" style="font-size:22px;color:${ok?'#16a34a':'#dc2626'}">${sum} / 100</strong></div>
<div id="wiz-sum-note" style="font-size:12px;margin-top:4px;color:${ok?'#16a34a':'#dc2626'}">${ok?'✓ المجموع صحيح':'⚠️ يجب أن يساوي المجموع 100 قبل الحفظ'}</div>`;
}
function cgWizStep3HTML() {
const w = window._cgWiz, t = w.tpl;
const sum = Math.round(t.criteria.reduce((s,c)=>s+(parseFloat(c.weight)||0),0)*100)/100;
const rows = t.criteria.map(c=>`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed var(--border)"><span>${Utils.escape(c.name||'—')}</span><strong>0 - ${c.weight}</strong></div>`).join('');
const warn = (w.mode!=='new') ? '<div class="alert alert-info" style="margin-top:12px;font-size:13px">ℹ️ التعديلات ستُطبَّق على التقييمات الجديدة فقط، والتقييمات السابقة تحتفظ بالنموذج القديم (snapshot).</div>' : '';
return `<div class="card"><div class="card-header"><div class="card-title">📄 ${Utils.escape(t.name||'—')} <span style="font-size:12px;color:var(--muted);font-weight:400">(كما سيراها موظف الجودة)</span></div></div><div class="card-body">
<div style="margin-bottom:10px;font-size:13px">المسمى الوظيفي: <strong>${Utils.escape(t.job_title||'—')}</strong> · المعرّف: <code dir="ltr">${Utils.escape(t.job_role||'—')}</code></div>
<div style="font-weight:700;margin-bottom:6px">المعايير (${t.criteria.length}) — الدرجة القصوى لكل معيار:</div>${rows}
<div style="display:flex;justify-content:space-between;padding-top:8px;margin-top:6px;border-top:2px solid var(--border)"><strong>المجموع</strong><strong style="color:var(--primary)">${sum} / 100</strong></div>
</div></div>${warn}`;
}
function cgWizSyncStep1() { const w=window._cgWiz;
const n=document.getElementById('wiz-name'), jt=document.getElementById('wiz-jtitle'), jr=document.getElementById('wiz-jrole');
if(n) w.tpl.name=n.value.trim(); if(jt) w.tpl.job_title=jt.value.trim();
if(jr && !jr.disabled) w.tpl.job_role=jr.value.trim().toLowerCase();
}
function cgWizSyncStep2() { const w=window._cgWiz;
document.querySelectorAll('.wiz-cname').forEach(i=>{const k=+i.dataset.i; if(w.tpl.criteria[k]) w.tpl.criteria[k].name=i.value;});
document.querySelectorAll('.wiz-cw').forEach(i=>{const k=+i.dataset.i; if(w.tpl.criteria[k]) w.tpl.criteria[k].weight=parseFloat(i.value)||0;});
}
function cgWizAttach() {
const w = window._cgWiz;
const back=document.getElementById('wiz-back'); if(back) back.addEventListener('click',()=>{ if(w.step===2)cgWizSyncStep2(); if(w.step===1)cgWizSyncStep1(); w.step--; cgWizShow(); });
const next=document.getElementById('wiz-next'); if(next) next.addEventListener('click',cgWizNext);
const save=document.getElementById('wiz-save'); if(save) save.addEventListener('click',cgWizSave);
if(w.step===1){ const gen=document.getElementById('wiz-gen'); if(gen) gen.addEventListener('click',()=>{ const src=(document.getElementById('wiz-jtitle').value||document.getElementById('wiz-name').value||''); document.getElementById('wiz-jrole').value = src.trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,''); }); }
if(w.step===2){
const add=document.getElementById('wiz-addcrit'); if(add) add.addEventListener('click',()=>{ cgWizSyncStep2(); w.tpl.criteria.push({id:'c_'+Date.now(),name:'',weight:0,type:'score',min:0,max:100}); cgWizShow(); });
document.querySelectorAll('.wiz-cdel').forEach(b=>b.addEventListener('click',()=>{ cgWizSyncStep2(); w.tpl.criteria.splice(+b.dataset.i,1); cgWizShow(); }));
const recompute=()=>{ cgWizSyncStep2(); const sum=Math.round(w.tpl.criteria.reduce((s,c)=>s+(parseFloat(c.weight)||0),0)*100)/100, ok=Math.round(sum)===100; const el=document.getElementById('wiz-sum'), note=document.getElementById('wiz-sum-note'); if(el){el.textContent=sum+' / 100'; el.style.color=ok?'#16a34a':'#dc2626';} if(note){note.textContent=ok?'✓ المجموع صحيح':'⚠️ يجب أن يساوي المجموع 100 قبل الحفظ'; note.style.color=ok?'#16a34a':'#dc2626';} };
document.querySelectorAll('.wiz-cw').forEach(i=>i.addEventListener('input',recompute));
}
}
function cgWizNext() {
const w = window._cgWiz;
if(w.step===1){ cgWizSyncStep1();
if(!w.tpl.name){ Toast.error('اسم النموذج مطلوب'); return; }
if(!w.tpl.job_title){ Toast.error('المسمى الوظيفي مطلوب'); return; }
if(w.mode!=='edit'){ if(!w.tpl.job_role){ Toast.error('المعرّف التقني (job_role) مطلوب'); return; } if(!/^[a-z0-9_]+$/.test(w.tpl.job_role)){ Toast.error('المعرّف التقني: أحرف إنجليزية صغيرة وأرقام و_ فقط'); return; } }
w.step=2; cgWizShow(); return;
}
if(w.step===2){ cgWizSyncStep2();
if(!w.tpl.criteria.length){ Toast.error('أضف معياراً واحداً على الأقل'); return; }
if(w.tpl.criteria.some(c=>!c.name||!c.name.trim())){ Toast.error('كل معيار يحتاج اسماً'); return; }
const sum=Math.round(w.tpl.criteria.reduce((s,c)=>s+(parseFloat(c.weight)||0),0));
if(sum!==100){ Toast.error(`مجموع الأوزان = ${sum} — يجب أن يساوي 100`); return; }
w.step=3; cgWizShow(); return;
}
}
async function cgWizSave() {
const w = window._cgWiz, t = w.tpl;
const sum = Math.round(t.criteria.reduce((s,c)=>s+(parseFloat(c.weight)||0),0));
if(!t.name||!t.job_title){ w.step=1; cgWizShow(); Toast.error('أكمل البيانات الأساسية'); return; }
if(sum!==100){ w.step=2; cgWizShow(); Toast.error('مجموع الأوزان يجب أن يساوي 100'); return; }
const payload = { name:t.name, job_title:t.job_title, job_role:(w.mode==='edit'?(w.origRole||null):(t.job_role||null)), criteria:t.criteria, allowed_action_types:t.allowed_action_types, objection_window_hours:t.objection_window_hours||48, pdf_max_size_mb:t.pdf_max_size_mb||20 };
const btn = document.getElementById('wiz-save');
await submitWithFeedback(btn, 'جارٍ الحفظ...', null, async () => {
let data, error;
if(w.mode==='edit'){ ({data,error} = await window.sb.rpc('upsert_evaluation_template',{ p_session_token:cgToken(), p_department_id:cgDeptId(), p_template:payload, p_template_type:'pdf_based_weekly', p_job_role:(w.origRole||null) })); }
else { ({data,error} = await window.sb.rpc('create_cg_template',{ p_session_token:cgToken(), p_department_id:cgDeptId(), p_job_role:t.job_role, p_template:payload })); }
const r = Array.isArray(data)?data[0]:data;
if(error || !r || !r.ok){ const m=(r&&r.message)||(error&&error.message)||'تعذّر الحفظ'; if(!handleSessionError(m)) Toast.error(m); return false; }
if(window._templates) delete window._templates[cgDeptId()];
Modal.close(); Toast.success(w.mode==='edit'?'تم تحديث النموذج (يُطبَّق على التقييمات الجديدة فقط)':'تم إنشاء النموذج بنجاح'); loadTemplatesTree(); return true;
});
}
function cgTemplateToggle(jobRole, active) {
if(!confirm(active?`تفعيل نموذج «${jobRole}»؟`:`تعطيل نموذج «${jobRole}»؟\n\nلن يُستخدم في التقييمات الجديدة (يعود الموظفون للنموذج الافتراضي).`)) return;
window.sb.rpc('set_cg_template_active',{ p_session_token:cgToken(), p_department_id:cgDeptId(), p_job_role:jobRole, p_active:active }).then(({data,error})=>{
const r=Array.isArray(data)?data[0]:data;
if(error||!r||!r.ok){ const m=(r&&r.message)||(error&&error.message)||'خطأ'; if(!handleSessionError(m)) Toast.error(m); return; }
if(window._templates) delete window._templates[cgDeptId()];
Toast.success('تم'); loadTemplatesTree();
}).catch(e=>Toast.error(e.message));
}
async function cgTemplateDelete(jobRole, jobTitle) {
const ok = await confirmDanger(`حذف نموذج «${Utils.escape(jobTitle||jobRole)}» نهائياً؟<br>إن كان مستخدماً في تقييمات سابقة فسيُمنع الحذف — عندها استخدم <b>التعطيل</b> بدلاً منه.`, '🗑️ حذف النموذج');
if(!ok) return;
const { data, error } = await window.sb.rpc('delete_evaluation_template',{ p_session_token:cgToken(), p_department_id:cgDeptId(), p_job_role:jobRole });
const r = Array.isArray(data)?data[0]:data;
if(error||!r||!r.ok){ const m=(r&&r.message)||(error&&error.message)||'تعذّر الحذف'; if(!handleSessionError(m)) Toast.error(m); return; }
if(window._templates) delete window._templates[cgDeptId()];
Toast.success('تم حذف النموذج'); loadTemplatesTree();
}
async function deleteCgRoleTemplate(jobRole) {
if (!confirm(`حذف نموذج «${cgRoleArabic(jobRole)}»؟\n\nالتقييمات السابقة محفوظة بـ snapshot ولن تتأثّر. التقييمات الجديدة لهذا المسمى ستستخدم النموذج الافتراضي.`)) return;
const { data, error } = await window.sb.rpc('delete_evaluation_template', { p_session_token: cgToken(), p_department_id: cgDeptId(), p_job_role: jobRole });
const r = Array.isArray(data)?data[0]:data;
if (error || !r || !(r.ok===true || r===true)) { const m=(r&&r.message)||(error&&error.message)||'تعذّر الحذف'; if(!handleSessionError(m)) Toast.error(m); return; }
Toast.success('تم حذف النموذج'); loadTemplatesTree();
}
async function saveTaskTargets(deptId) {
const t = window._templates[deptId];
const tj = JSON.parse(JSON.stringify(t.template));
document.querySelectorAll('[data-tgt]').forEach(inp => {
const parts = inp.dataset.tgt.split('|'), role = parts[0], kid = parts[1];
const val = inp.value !== '' ? parseFloat(inp.value) : null;
const kpi = (tj.role_kpis[role]||[]).find(x => x.id === kid);
if (kpi) kpi.target = val;
});
const tok = window.getSessionToken ? getSessionToken() : null;
try {
const { data, error } = await window.sb.rpc('upsert_evaluation_template', { p_session_token: tok, p_department_id: deptId, p_template: tj, p_template_type: 'task_based_weekly' });
const r = Array.isArray(data) ? data[0] : data;
if (error || !r || !r.ok) { const m=(r&&r.message)||(error&&error.message)||'خطأ'; if(!handleSessionError(m)) Toast.error(m); return; }
Toast.success('تم حفظ الأهداف'); if (window._templates) delete window._templates[deptId]; navigate('departments',{tab:'templates',dept:deptId});
} catch (e) { Toast.error(e.message); }
}

function attachPageHandlers(page) {
// حمّل الأقسام مرّة واحدة لتظهر بنود Creative Gene الصحيحة في القائمة (عزل مشرفي محزم)
if (!window._departments) { loadDepartments(true).then(() => { if (typeof navigate === 'function' && currentPage === page) navigate(page, currentParams); }); }
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

if (page === 'dashboard') {
loadDashboard();
clearInterval(window._dashTimer);
window._dashTimer = setInterval(() => { if (currentPage === 'dashboard') loadDashboard(true); else { clearInterval(window._dashTimer); } }, 60000);
}
if (page === 'reports') renderReportsCharts();
if (page === 'departments' && (currentParams.tab || 'depts') === 'templates') loadTemplatesTree();
if (page === 'cg-week') {
const ws = currentParams.week || weekStartSaturdayJS();
loadCgWeekTable(ws);
const di = document.getElementById('cgw-date');
if (di) di.addEventListener('change', () => navigate('cg-week', { week: di.value }));
}
if (page === 'cg-objections') loadCgObjections();
if (page === 'cg-my-team') loadCgMyTeam();
if (page === 'quality-report') {
loadQualityReport();
const per = document.getElementById('qr-period');
if (per) per.addEventListener('change', () => { document.querySelectorAll('.qr-custom').forEach(el => el.style.display = per.value==='custom'?'':'none'); });
const apply = document.getElementById('qr-apply'); if (apply) apply.addEventListener('click', () => loadQualityReport());
const pdf = document.getElementById('qr-pdf'); if (pdf) pdf.addEventListener('click', qrExportPDF);
const xls = document.getElementById('qr-xlsx'); if (xls) xls.addEventListener('click', qrExportXLSX);
}
if (page === 'cg-upload') attachCgUpload();
if (page === 'cg-pending-approval') loadCgPending();
if (page === 'cg-requests') {
loadCgRequests();
const st = document.getElementById('cgr-state');
if (st) st.addEventListener('change', () => loadCgRequests());
const se = document.getElementById('cgr-search');
if (se) { let t; se.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => loadCgRequests(), 300); }); }
}
if (page === 'cg-actions-report') loadCgActionsReport();
if (page === 'view-evaluation') loadPdfViewExtra(currentParams.id);
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
if (window.SupabaseSync && SupabaseSync.pullAll) { try{ await SupabaseSync.pullAll(true); }catch(_){} }
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
if (window.SupabaseSync && SupabaseSync.pullAll) { try{ await SupabaseSync.pullAll(true); }catch(_){} }
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
const dept = tr.dataset.deptid || '';
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
if (monthSel) monthSel.addEventListener('change', () => { const p = { month: monthSel.value }; if (currentParams.dept) p.dept = currentParams.dept; navigate('monthly-report', p); });
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
const df = document.getElementById('eval-dept-filter');
if (df) df.addEventListener('change', () => {
const params = Object.assign({}, currentParams);
if (df.value) params.dept = parseInt(df.value); else delete params.dept;
navigate('evaluations', params);
});
document.querySelectorAll('[data-del-eval]').forEach(b => b.addEventListener('click', async e => {
e.stopPropagation();
// حافظ على فلتر القسم الحالي بعد الحذف (وإلا عادت الشاشة تعرض كل الأقسام)
await handleDeleteEval(b, 'evaluations', currentParams.dept != null ? { dept: currentParams.dept } : {});
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
if (window._reportTab === 'cg') loadCgReports();

const applyRepFilters = () => {
const period = document.getElementById('rep-period')?.value || 'all';
const params = { period };
if (window._reportTab) params.reportTab = window._reportTab; // إبقاء التبويب الحالي
if (period === 'year') params.year = document.getElementById('rep-year')?.value;
if (period === 'month') params.month = document.getElementById('rep-month')?.value;
if (period === 'custom') { params.from = document.getElementById('rep-from')?.value; params.to = document.getElementById('rep-to')?.value; }
const s = document.getElementById('rep-sup')?.value; if (s) params.sup = s;
const em = document.getElementById('rep-emp')?.value; if (em) params.emp = em;
navigate('reports', params);
};
document.querySelectorAll('.rep-filter').forEach(el => el.addEventListener('change', applyRepFilters));
const clrBtn = document.getElementById('rep-clear');
if (clrBtn) clrBtn.addEventListener('click', () => navigate('reports', window._reportTab ? { reportTab: window._reportTab } : {}));
}
}

// ============================================
