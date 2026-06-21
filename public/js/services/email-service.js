/*!
 * نظام الجودة للتقييم والتدريب - شركة محزم
 * Mahzam Quality Evaluation & Training System
 *
 * Module: EmailJS Service Layer (Universal Single-Template Edition)
 * طبقة بريد مركزية تستخدم قالبًا واحدًا (template_universal) لجميع أنواع الإشعارات.
 *
 *  ✅ قالب واحد فقط في EmailJS — يتكيّف عبر مجموعة متغيّرات موحّدة.
 *  ✅ Safe no-op — إذا كانت الإعدادات فارغة، النظام يستمر بالعمل دون كسر.
 *  ✅ Non-blocking — كل دوال الإرسال async وتُستدعى بعد نجاح الحفظ.
 *  ✅ Error-tolerant — أي فشل في الإرسال يُسجَّل في console + audit_logs.
 *
 * متغيّرات القالب الموحّد المتاحة:
 *   to_email, to_name, subject, intro_message,
 *   action_label, action_value, expires_info,
 *   additional_info, security_note,
 *   company_name, system_url
 *
 * @module email-service
 * @copyright (c) 2026 Mahzam Co.
 */
'use strict';

// ============================================
// ثوابت القالب الموحّد
// ============================================
const UNIVERSAL_TEMPLATE_ID = 'template_universal';
// ملاحظة: COMPANY_NAME معرّف عالميًا في 01-constants.js (يُحمّل قبل هذا الملف).
// لا نُعيد تعريفه هنا بـ const وإلا حدث تعارض "Identifier already declared"
// يُفشل تنفيذ الملف كله فلا يُعرَّف window.EmailService.
const SYSTEM_URL   = 'https://kayedkk.vercel.app';

// ============================================
// إعدادات EmailJS — ✏️ عدّل هذه القيم من dashboard.emailjs.com
// ============================================
const EMAILJS_CONFIG = {
  // المفاتيح الأساسية (مطلوبة) — قالب واحد لكل النظام
  publicKey:  'ecgxEwtvUHeDhEehm',           // من Account → API Keys → Public Key
  serviceId:  'service_iso6dyw',             // من Email Services → Service ID

  // تفضيلات عامة
  enabled:    true,                                       // مفتاح رئيسي لإيقاف الإرسال كله
  fromName:   'نظام الجودة - شركة محزم',
  replyTo:    '',                                         // اتركه فارغًا لاستخدام الإعداد الافتراضي
  systemName: 'نظام الجودة للتقييم والتدريب',
  companyName: COMPANY_NAME,
  logLevel:   'warn'                                      // 'silent' | 'warn' | 'info'
};

// === EmailJS DEBUG (مؤقّت) — يؤكّد أن الملف نُفِّذ فعلاً وقيمة enabled في الإنتاج ===
console.log('[EmailJS DEBUG] email-service.js loaded — enabled:', EMAILJS_CONFIG.enabled,
            '| template:', UNIVERSAL_TEMPLATE_ID, '| company:', (typeof COMPANY_NAME !== 'undefined' ? COMPANY_NAME : '(COMPANY_NAME undefined!)'));
// === END DEBUG ===


// ============================================
// EmailService — الواجهة العامة للنظام
// ============================================
window.EmailService = (function() {

  // --- Internal state ---
  let _initialized = false;
  let _ready       = false;

  function _isConfigured() {
    return EMAILJS_CONFIG.enabled
      && EMAILJS_CONFIG.publicKey
      && !EMAILJS_CONFIG.publicKey.startsWith('YOUR_')
      && EMAILJS_CONFIG.serviceId
      && !EMAILJS_CONFIG.serviceId.startsWith('YOUR_')
      && UNIVERSAL_TEMPLATE_ID
      && !UNIVERSAL_TEMPLATE_ID.startsWith('YOUR_');
  }

  function _log(level, ...args) {
    if (EMAILJS_CONFIG.logLevel === 'silent') return;
    if (EMAILJS_CONFIG.logLevel === 'warn' && level === 'info') return;
    const fn = (level === 'error') ? console.error
            : (level === 'warn')  ? console.warn
            : console.log;
    fn('[EmailService]', ...args);
  }

  // --- Initialization ---
  function init() {
    if (_initialized) return _ready;
    _initialized = true;

    if (typeof window.emailjs === 'undefined') {
      _log('warn', '⚠️ مكتبة EmailJS غير محمّلة. أضف <script src="https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js"></script> في index.html');
      return false;
    }

    if (!_isConfigured()) {
      _log('warn', '⚠️ EmailJS غير مُهيّأ. عدّل EMAILJS_CONFIG في public/js/services/email-service.js. الإرسال معطّل حتى يتم الإعداد.');
      return false;
    }

    try {
      window.emailjs.init({ publicKey: EMAILJS_CONFIG.publicKey });
      _ready = true;
      _log('info', '✓ EmailJS جاهز');
      return true;
    } catch (e) {
      _log('error', '❌ فشل تهيئة EmailJS:', e && e.message);
      return false;
    }
  }

  // --- Audit helper (best-effort) ---
  function _audit(action, details) {
    try {
      if (typeof DB !== 'undefined' && typeof DB.addAudit === 'function') {
        DB.addAudit({
          action: action,
          entity_type: 'email',
          details: details
        });
      }
    } catch (_) { /* ignore — لا يجب أن يكسر تدفق العمل */ }
  }

  // --- Toast helper (best-effort) ---
  function _toast(message, type) {
    try {
      if (typeof Toast !== 'undefined' && typeof Toast.show === 'function') {
        Toast.show(message, type || 'info');
      }
    } catch (_) { /* silent */ }
  }

  // --- Params builder ---
  // يُرجع كائن params بالقيم الافتراضية العامّة (company_name, system_url)
  // ثم يدمج عليها overrides الخاصة بكل حدث.
  function _buildParams(overrides) {
    return Object.assign({
      company_name: COMPANY_NAME,
      system_url:   SYSTEM_URL
    }, overrides || {});
  }

  // --- Universal sender (low-level) ---
  // ترسل عبر القالب الموحّد فقط. غير معدية بأي استثناء.
  // options: { eventKey?: string, silent?: boolean }
  async function _sendUniversal(params, options) {
    options = options || {};
    const eventKey  = options.eventKey || 'email';
    const recipient = (params && params.to_email) ? params.to_email : '(unknown)';

    if (!init()) {
      _log('warn', `(${eventKey}) لم يُرسَل البريد إلى ${recipient} — EmailJS غير مُهيّأ.`);
      return { ok: false, skipped: true, reason: 'not_configured' };
    }

    // === EmailJS DEBUG (مؤقّت — يُحذف بعد التشخيص) ===
    console.log('[EmailJS DEBUG] template:', UNIVERSAL_TEMPLATE_ID);
    console.log('[EmailJS DEBUG] params:', JSON.stringify(params, null, 2));
    const _missing = ['to_email','to_name','subject','intro_message','action_label','action_value','expires_info','additional_info','security_note','company_name','system_url']
      .filter(k => params[k] === undefined || params[k] === null || String(params[k]).trim() === '');
    if (_missing.length) console.error('[EmailJS DEBUG] MISSING/EMPTY:', _missing);
    // === END DEBUG ===

    try {
      const result = await window.emailjs.send(
        EMAILJS_CONFIG.serviceId,
        UNIVERSAL_TEMPLATE_ID,
        params
      );
      _log('info', `✓ تم إرسال بريد (${eventKey}) إلى ${recipient}`, result && result.status);
      _audit('email_sent', `(${eventKey}) → ${recipient}`);
      if (!options.silent) _toast('✓ تم إرسال إشعار بريدي', 'success');
      return { ok: true, status: result && result.status, recipient: recipient };
    } catch (err) {
      const msg = (err && (err.text || err.message)) || String(err);
      _log('error', `❌ فشل إرسال البريد (${eventKey}) إلى ${recipient}:`, msg);
      _audit('email_failed', `(${eventKey}) → ${recipient}: ${msg}`);
      if (!options.silent) _toast('⚠️ تعذّر إرسال الإشعار البريدي (تم حفظ العملية)', 'warning');
      return { ok: false, error: msg, recipient: recipient };
    }
  }

  // --- Helpers ---
  function _user(id) {
    try {
      if (typeof DB !== 'undefined' && typeof DB.getUser === 'function') {
        return DB.getUser(id) || null;
      }
    } catch (_) {}
    return null;
  }

  function _grade(grade, status) { return grade || status || ''; }

  // اسم العرض: name (إن وُجد) ثم full_name ثم البريد.
  function _name(target, fallback) {
    if (!target) return fallback || '';
    return target.name || target.full_name || target.email || fallback || '';
  }

  function _dt(value) {
    return new Date(value || Date.now()).toLocaleString('ar-SA');
  }

  // ============================================
  // الواجهة العامة - دوال الإرسال
  // كلها تمرّ عبر _sendUniversal بقالب template_universal
  // ============================================

  /**
   * sendEvaluationEmail — يُستدعى بعد createEvaluation
   */
  async function sendEvaluationEmail(evaluation) {
    if (!evaluation) return { ok:false, skipped:true, reason:'no_evaluation' };
    const employee  = _user(evaluation.employee_id);
    const evaluator = _user(evaluation.evaluator_id);
    if (!employee || !employee.email) {
      _log('warn', '(evaluation) لا يوجد بريد للموظف. تم التخطي.');
      return { ok:false, skipped:true, reason:'no_email' };
    }
    const grade = _grade(evaluation.grade, evaluation.status);
    const extra = [
      `المُقيِّم: ${evaluator ? evaluator.full_name : '-'}`,
      `الرقم الوظيفي: ${employee.employee_number || '-'}`
    ];
    if (evaluation.notes) extra.push(`ملاحظات: ${evaluation.notes}`);
    return _sendUniversal(_buildParams({
      to_email:        employee.email,
      to_name:         _name(employee),
      subject:         `تقييم جديد بتاريخ ${evaluation.evaluation_date} - النتيجة ${evaluation.percentage}%`,
      intro_message:   `تم تسجيل تقييم جديد لك بنسبة ${evaluation.percentage}% (${grade}). فيما يلي تفاصيل التقييم.`,
      action_label:    'النتيجة',
      action_value:    `${evaluation.percentage}% (${grade})`,
      expires_info:    `تاريخ التقييم: ${evaluation.evaluation_date}`,
      additional_info: extra.join(' • '),
      security_note:   'هذا إشعار رسمي من نظام الجودة.'
    }), { eventKey: 'evaluation' });
  }

  /**
   * sendApprovalEmail — يُستدعى بعد approveEvaluation
   */
  async function sendApprovalEmail(evaluation) {
    if (!evaluation) return { ok:false, skipped:true, reason:'no_evaluation' };
    const employee = _user(evaluation.employee_id);
    const approver = _user(evaluation.approved_by);
    if (!employee || !employee.email) {
      _log('warn', '(approval) لا يوجد بريد للموظف. تم التخطي.');
      return { ok:false, skipped:true, reason:'no_email' };
    }
    const grade = _grade(evaluation.grade, evaluation.status);
    return _sendUniversal(_buildParams({
      to_email:        employee.email,
      to_name:         _name(employee),
      subject:         `تم اعتماد تقييمك بتاريخ ${evaluation.evaluation_date}`,
      intro_message:   `تم اعتماد تقييمك بشكل نهائي بنسبة ${evaluation.percentage}% (${grade}).`,
      action_label:    'النتيجة المعتمدة',
      action_value:    `${evaluation.percentage}% (${grade})`,
      expires_info:    `تاريخ الاعتماد: ${_dt(evaluation.approved_at)}`,
      additional_info: `المعتمِد: ${approver ? approver.full_name : '-'} • تاريخ التقييم: ${evaluation.evaluation_date}`,
      security_note:   'هذا إشعار رسمي من نظام الجودة.'
    }), { eventKey: 'approval' });
  }

  /**
   * sendActionEmail — يُستدعى بعد recordSupervisorAction
   */
  async function sendActionEmail(evaluation, actionData) {
    if (!evaluation) return { ok:false, skipped:true, reason:'no_evaluation' };
    const employee   = _user(evaluation.employee_id);
    const supervisor = _user(evaluation.supervisor_action_by);
    if (!employee || !employee.email) {
      _log('warn', '(action) لا يوجد بريد للموظف. تم التخطي.');
      return { ok:false, skipped:true, reason:'no_email' };
    }
    const action = (actionData && actionData.action) || evaluation.supervisor_action || '-';
    const notes  = (actionData && actionData.notes)  || evaluation.supervisor_notes  || '';
    const supName = supervisor ? supervisor.full_name : (evaluation.supervisor_action_by_name || '-');
    const extra = [`المشرف: ${supName}`, `تاريخ التقييم: ${evaluation.evaluation_date}`];
    if (notes) extra.push(`ملاحظات: ${notes}`);
    return _sendUniversal(_buildParams({
      to_email:        employee.email,
      to_name:         _name(employee),
      subject:         `إجراء جديد على تقييمك بتاريخ ${evaluation.evaluation_date}`,
      intro_message:   `قام المشرف باتخاذ الإجراء التالي على تقييمك: ${action}.`,
      action_label:    'نوع الإجراء',
      action_value:    action,
      expires_info:    `تاريخ الإجراء: ${_dt(evaluation.supervisor_action_at)}`,
      additional_info: extra.join(' • '),
      security_note:   'هذا إشعار رسمي من نظام الجودة.'
    }), { eventKey: 'action' });
  }

  /**
   * sendObjectionEmail — يُستدعى بعد createObjection
   * يُرسَل إلى مسؤول الجودة / المشرف (إن وُجد).
   */
  async function sendObjectionEmail(objection, recipientUserId) {
    if (!objection) return { ok:false, skipped:true, reason:'no_objection' };
    let recipient = recipientUserId ? _user(recipientUserId) : null;
    if (!recipient && typeof DB !== 'undefined' && DB.data && Array.isArray(DB.data.users)) {
      recipient = DB.data.users.find(u => u.role === 'quality_officer' && u.is_active) ||
                  DB.data.users.find(u => u.role === 'admin' && u.is_active);
    }
    if (!recipient || !recipient.email) {
      _log('warn', '(objection) لا يوجد مستلم بريد لإشعار الاعتراض. تم التخطي.');
      return { ok:false, skipped:true, reason:'no_recipient' };
    }
    const employee = _user(objection.employee_id);
    const empName  = employee ? employee.full_name : '-';
    const extra = [
      `اسم الموظف: ${empName}`,
      `الرقم الوظيفي: ${employee ? (employee.employee_number || '-') : '-'}`,
      `رقم التقييم: ${objection.evaluation_id}`
    ];
    if (objection.reason) extra.push(`السبب: ${objection.reason}`);
    return _sendUniversal(_buildParams({
      to_email:        recipient.email,
      to_name:         _name(recipient),
      subject:         `اعتراض جديد ${objection.ref_number} من ${empName}`,
      intro_message:   `تم تقديم اعتراض جديد من قِبَل الموظف ${empName} ويحتاج إلى مراجعتك.`,
      action_label:    'رقم الاعتراض',
      action_value:    objection.ref_number,
      expires_info:    `تاريخ التقديم: ${_dt(objection.created_at)}`,
      additional_info: extra.join(' • '),
      security_note:   'هذا إشعار رسمي من نظام الجودة.'
    }), { eventKey: 'objection' });
  }

  /**
   * sendNewUserEmail — يُستدعى بعد createUser
   * يرسل بيانات الدخول للمستخدم الجديد.
   */
  async function sendNewUserEmail(target, tempPassword) {
    if (!target) return { ok:false, skipped:true, reason:'no_user' };
    if (!target.email) {
      _log('warn', '(newUser) لا يوجد بريد للمستخدم. تم التخطي.');
      return { ok:false, skipped:true, reason:'no_email' };
    }
    return _sendUniversal(_buildParams({
      to_email:        target.email,
      to_name:         _name(target),
      subject:         'بيانات حسابك الجديد',
      intro_message:   `تم إنشاء حساب جديد لك في ${COMPANY_NAME}. استخدم البيانات أدناه لتسجيل دخولك الأول.`,
      action_label:    'كلمة المرور المؤقتة',
      action_value:    tempPassword || '(يرجى التواصل مع الإدارة)',
      expires_info:    `بريدك: ${target.email}`,
      additional_info: 'يُرجى تسجيل الدخول وتغيير كلمة المرور فوراً للحفاظ على أمان حسابك.',
      security_note:   'هذه كلمة مرور مؤقتة لمرّة واحدة. لا تشاركها مع أحد.'
    }), { eventKey: 'newUser' });
  }

  /**
   * sendPasswordResetEmail — يُستدعى بعد إعادة تعيين كلمة المرور
   * @param {Object} target { email, full_name }
   * @param {string} tempPassword كلمة المرور المؤقتة
   */
  async function sendPasswordResetEmail(target, tempPassword) {
    if (!target) return { ok:false, skipped:true, reason:'no_user' };
    if (!target.email) {
      _log('warn', '(passwordReset) لا يوجد بريد للمستخدم. تم التخطي.');
      return { ok:false, skipped:true, reason:'no_email' };
    }
    return _sendUniversal(_buildParams({
      to_email:        target.email,
      to_name:         _name(target),
      subject:         'إعادة تعيين كلمة المرور',
      intro_message:   'تلقّينا طلباً لإعادة تعيين كلمة المرور الخاصة بحسابك. تم توليد كلمة مرور مؤقتة لك.',
      action_label:    'كلمة المرور المؤقتة',
      action_value:    tempPassword || '(يرجى التواصل مع الإدارة)',
      expires_info:    'يجب تغييرها فور تسجيل الدخول',
      additional_info: 'سجّل دخولك بهذه الكلمة، وسيُطلب منك تغييرها فوراً بعد الدخول.',
      security_note:   'إذا لم تطلب إعادة التعيين، تجاهل هذه الرسالة وتواصل مع إدارة النظام.'
    }), { eventKey: 'passwordReset' });
  }

  /**
   * sendLoginCodeEmail — يُستدعى أثناء تسجيل الدخول لإرسال كود OTP
   * @param {Object} target { email, full_name }
   * @param {string} code    6-digit code
   * @param {number} ttlMin  validity in minutes (default 5)
   */
  async function sendLoginCodeEmail(target, code, ttlMin) {
    if (!target || !target.email) {
      _log('warn', '(loginCode) لا يوجد بريد للمستلم. تم التخطي.');
      return { ok:false, skipped:true, reason:'no_email' };
    }
    if (!code) {
      _log('warn', '(loginCode) لا يوجد كود. تم التخطي.');
      return { ok:false, skipped:true, reason:'no_code' };
    }
    const ttl = (typeof ttlMin === 'number' && ttlMin > 0) ? ttlMin : 5;
    return _sendUniversal(_buildParams({
      to_email:        target.email,
      to_name:         _name(target),
      subject:         'رمز تسجيل الدخول',
      intro_message:   'تلقّينا طلب تسجيل دخول جديد لحسابك. استخدم الرمز التالي لإتمام عملية تسجيل الدخول.',
      action_label:    'رمز التحقّق',
      action_value:    code,
      expires_info:    `صالح لمدة ${ttl} دقائق فقط`,
      additional_info: 'أدخل هذا الرمز في الشاشة الظاهرة أمامك لإكمال تسجيل الدخول.',
      security_note:   'إذا لم تطلب تسجيل الدخول، تجاهل هذه الرسالة وغيّر كلمة المرور فوراً.'
    }), { eventKey: 'loginCode', silent: true });
  }

  /**
   * sendNotificationEmail — إشعار عام من النظام
   * @param {Object} target       { email, full_name }
   * @param {Object} notification  { title, body, type }
   */
  async function sendNotificationEmail(target, notification) {
    if (!target || !target.email) {
      _log('warn', '(notification) لا يوجد بريد للمستلم. تم التخطي.');
      return { ok:false, skipped:true, reason:'no_email' };
    }
    notification = notification || {};
    return _sendUniversal(_buildParams({
      to_email:        target.email,
      to_name:         _name(target),
      subject:         notification.title || 'إشعار جديد من النظام',
      intro_message:   notification.body,
      action_label:    'نوع الإشعار',
      action_value:    notification.type || 'إشعار عام',
      expires_info:    '',
      additional_info: 'افتح النظام لعرض التفاصيل الكاملة واتخاذ الإجراء المطلوب.',
      security_note:   'هذا إشعار رسمي من إدارة النظام.'
    }), { eventKey: 'notification' });
  }

  /**
   * sendTestEmail — رسالة فحص للتأكد من سلامة إعدادات EmailJS
   * @param {Object} target { email, name }
   */
  async function sendTestEmail(target) {
    if (!target || !target.email) {
      _log('warn', '(test) لا يوجد بريد للمستلم. تم التخطي.');
      return { ok:false, skipped:true, reason:'no_email' };
    }
    return _sendUniversal(_buildParams({
      to_email:        target.email,
      to_name:         _name(target, 'مستخدم اختبار'),
      subject:         'اختبار قالب EmailJS',
      intro_message:   'هذه رسالة اختبارية للتأكد من أن نظام البريد يعمل بشكل صحيح.',
      action_label:    'حالة النظام',
      action_value:    'OK',
      expires_info:    new Date().toLocaleString('ar-SA'),
      additional_info: 'إذا استلمت هذه الرسالة، فإن إعدادات EmailJS سليمة.',
      security_note:   'لا حاجة لأي إجراء — هذه رسالة فحص فقط.'
    }), { eventKey: 'test' });
  }

  // ============================================
  // الواجهة العامة
  // ============================================
  return {
    init: init,
    isReady: function() { _initialized || init(); return _ready; },
    isConfigured: _isConfigured,
    config: EMAILJS_CONFIG,    // للقراءة فقط (للديباغ)
    // دوال الإرسال (كلها عبر القالب الموحّد):
    sendEvaluationEmail:    sendEvaluationEmail,
    sendApprovalEmail:      sendApprovalEmail,
    sendActionEmail:        sendActionEmail,
    sendObjectionEmail:     sendObjectionEmail,
    sendNewUserEmail:       sendNewUserEmail,
    sendPasswordResetEmail: sendPasswordResetEmail,
    sendLoginCodeEmail:     sendLoginCodeEmail,
    sendNotificationEmail:  sendNotificationEmail,
    sendTestEmail:          sendTestEmail
  };
})();

// تهيئة تلقائية عند تحميل المتصفح
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){ window.EmailService.init(); });
  } else {
    setTimeout(function(){ window.EmailService.init(); }, 0);
  }
}
