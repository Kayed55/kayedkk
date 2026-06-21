/*!
 * نظام الجودة للتقييم والتدريب - شركة محزم
 * Mahzam Quality Evaluation & Training System
 *
 * Module: EmailJS Service Layer (Single-Template Edition)
 * طبقة بريد مركزية تستخدم قالبًا واحدًا في EmailJS لجميع أنواع الإشعارات.
 *
 *  ✅ قالب واحد فقط في EmailJS — يتكيّف عبر متغيّرات عامّة.
 *  ✅ Safe no-op — إذا كانت الإعدادات فارغة، النظام يستمر بالعمل دون كسر.
 *  ✅ Non-blocking — كل دوال الإرسال async وتُستدعى بعد نجاح الحفظ.
 *  ✅ Error-tolerant — أي فشل في الإرسال يُسجَّل في console + audit_logs.
 *
 * @module email-service
 * @copyright (c) 2026 Mahzam Co.
 */
'use strict';

// ============================================
// إعدادات EmailJS — ✏️ عدّل هذه القيم من dashboard.emailjs.com
// ============================================
const EMAILJS_CONFIG = {
  // المفاتيح الأساسية (مطلوبة) — قالب واحد لكل النظام
  publicKey:  'ecgxEwtvUHeDhEehm',           // من Account → API Keys → Public Key
  serviceId:  'service_iso6dyw',             // من Email Services → Service ID
  templateId: 'template_xoivmpq',            // قالب موحّد واحد لكل الأحداث الخمسة

  // تفضيلات عامة
  enabled:    true,                                       // مفتاح رئيسي لإيقاف الإرسال كله
  fromName:   'نظام الجودة - شركة محزم',
  replyTo:    '',                                         // اتركه فارغًا لاستخدام الإعداد الافتراضي
  systemName: 'نظام الجودة للتقييم والتدريب',
  companyName:'شركة محزم',
  logLevel:   'warn'                                      // 'silent' | 'warn' | 'info'
};


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
      && EMAILJS_CONFIG.templateId
      && !EMAILJS_CONFIG.templateId.startsWith('YOUR_');
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

  // --- Core sender (low-level) ---
  // ترسل عبر القالب الموحّد. غير معدية بأي استثناء.
  async function _send(eventKey, params, opts) {
    opts = opts || {};
    const recipient = (params && params.to_email) ? params.to_email : '(unknown)';

    if (!init()) {
      _log('warn', `(${eventKey}) لم يُرسَل البريد إلى ${recipient} — EmailJS غير مُهيّأ.`);
      return { ok: false, skipped: true, reason: 'not_configured' };
    }

    // متغيّرات عامّة افتراضية + متغيّرات الحدث
    const fullParams = Object.assign({
      system_name:  EMAILJS_CONFIG.systemName,
      company_name: EMAILJS_CONFIG.companyName,
      from_name:    EMAILJS_CONFIG.fromName,
      reply_to:     EMAILJS_CONFIG.replyTo || (params && params.to_email) || '',
      event_type:   eventKey,
      sent_at:      new Date().toLocaleString('ar-SA')
    }, params || {});

    try {
      const result = await window.emailjs.send(
        EMAILJS_CONFIG.serviceId,
        EMAILJS_CONFIG.templateId,
        fullParams
      );
      _log('info', `✓ تم إرسال بريد (${eventKey}) إلى ${recipient}`, result && result.status);
      _audit('email_sent', `(${eventKey}) → ${recipient}`);
      if (!opts.silent) _toast('✓ تم إرسال إشعار بريدي', 'success');
      return { ok: true, status: result && result.status, recipient: recipient };
    } catch (err) {
      const msg = (err && (err.text || err.message)) || String(err);
      _log('error', `❌ فشل إرسال البريد (${eventKey}) إلى ${recipient}:`, msg);
      _audit('email_failed', `(${eventKey}) → ${recipient}: ${msg}`);
      if (!opts.silent) _toast('⚠️ تعذّر إرسال الإشعار البريدي (تم حفظ العملية)', 'warning');
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

  // ============================================
  // الواجهة العامة - 5 دوال جاهزة للاستخدام
  // كلها تستخدم نفس القالب لكن بمتغيّرات مختلفة
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
    return _send('evaluation', {
      to_email:      employee.email,
      to_name:       employee.full_name,
      subject:       `تقييم جديد بتاريخ ${evaluation.evaluation_date} - النتيجة ${evaluation.percentage}%`,
      event_label:   'إشعار تقييم جديد',
      title:         'تم إنشاء تقييم جديد لك',
      intro:         `تم تسجيل تقييم جديد لك بنسبة ${evaluation.percentage}% (${_grade(evaluation.grade, evaluation.status)}). فيما يلي تفاصيل التقييم.`,
      field1_label:  'اسم الموظف',
      field1_value:  employee.full_name,
      field2_label:  'الرقم الوظيفي',
      field2_value:  employee.employee_number || '-',
      field3_label:  'النتيجة',
      field3_value:  `${evaluation.percentage}% (${_grade(evaluation.grade, evaluation.status)})`,
      field4_label:  'المُقيِّم',
      field4_value:  evaluator ? evaluator.full_name : '-',
      field5_label:  'تاريخ التقييم',
      field5_value:  evaluation.evaluation_date,
      notes:         evaluation.notes || '',
      action_label:  '',
      action_url:    ''
    });
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
    return _send('approval', {
      to_email:     employee.email,
      to_name:      employee.full_name,
      subject:      `تم اعتماد تقييمك بتاريخ ${evaluation.evaluation_date}`,
      event_label:  'إشعار اعتماد تقييم',
      title:        'تم اعتماد تقييمك',
      intro:        `تم اعتماد تقييمك بشكل نهائي بنسبة ${evaluation.percentage}% (${_grade(evaluation.grade, evaluation.status)}).`,
      field1_label: 'اسم الموظف',
      field1_value: employee.full_name,
      field2_label: 'النتيجة المعتمدة',
      field2_value: `${evaluation.percentage}% (${_grade(evaluation.grade, evaluation.status)})`,
      field3_label: 'تاريخ التقييم',
      field3_value: evaluation.evaluation_date,
      field4_label: 'المعتمِد',
      field4_value: approver ? approver.full_name : '-',
      field5_label: 'تاريخ الاعتماد',
      field5_value: new Date(evaluation.approved_at || Date.now()).toLocaleString('ar-SA'),
      notes:        evaluation.notes || '',
      action_label: '',
      action_url:   ''
    });
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
    return _send('action', {
      to_email:     employee.email,
      to_name:      employee.full_name,
      subject:      `إجراء جديد على تقييمك بتاريخ ${evaluation.evaluation_date}`,
      event_label:  'إجراء مشرف على تقييم',
      title:        'تم اتخاذ إجراء على تقييمك',
      intro:        `قام المشرف باتخاذ الإجراء التالي على تقييمك: ${action}.`,
      field1_label: 'اسم الموظف',
      field1_value: employee.full_name,
      field2_label: 'نوع الإجراء',
      field2_value: action,
      field3_label: 'المشرف',
      field3_value: supervisor ? supervisor.full_name : (evaluation.supervisor_action_by_name || '-'),
      field4_label: 'تاريخ التقييم',
      field4_value: evaluation.evaluation_date,
      field5_label: 'تاريخ الإجراء',
      field5_value: new Date(evaluation.supervisor_action_at || Date.now()).toLocaleString('ar-SA'),
      notes:        notes,
      action_label: '',
      action_url:   ''
    });
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
    return _send('objection', {
      to_email:     recipient.email,
      to_name:      recipient.full_name,
      subject:      `اعتراض جديد ${objection.ref_number} من ${employee ? employee.full_name : '-'}`,
      event_label:  'اعتراض جديد على تقييم',
      title:        `اعتراض جديد رقم ${objection.ref_number}`,
      intro:        `تم تقديم اعتراض جديد من قِبَل الموظف ${employee ? employee.full_name : '-'} ويحتاج إلى مراجعتك.`,
      field1_label: 'رقم الاعتراض',
      field1_value: objection.ref_number,
      field2_label: 'اسم الموظف',
      field2_value: employee ? employee.full_name : '-',
      field3_label: 'الرقم الوظيفي',
      field3_value: employee ? (employee.employee_number || '-') : '-',
      field4_label: 'رقم التقييم',
      field4_value: String(objection.evaluation_id),
      field5_label: 'تاريخ التقديم',
      field5_value: new Date(objection.created_at || Date.now()).toLocaleString('ar-SA'),
      notes:        objection.reason || '',
      action_label: '',
      action_url:   ''
    });
  }

  /**
   * sendNewUserEmail — يُستدعى بعد createUser
   * يرسل بيانات الدخول للمستخدم الجديد.
   */
  async function sendNewUserEmail(user, tempPassword) {
    if (!user) return { ok:false, skipped:true, reason:'no_user' };
    if (!user.email) {
      _log('warn', '(newUser) لا يوجد بريد للمستخدم. تم التخطي.');
      return { ok:false, skipped:true, reason:'no_email' };
    }
    const loginUrl = (typeof window !== 'undefined' && window.location)
                        ? (window.location.origin + window.location.pathname) : '';
    return _send('newUser', {
      to_email:     user.email,
      to_name:      user.full_name,
      subject:      `مرحبًا ${user.full_name} - تم إنشاء حسابك في نظام الجودة`,
      event_label:  'تفعيل حساب جديد',
      title:        `مرحبًا بك ${user.full_name}`,
      intro:        `تم إنشاء حسابك بنجاح في نظام الجودة. فيما يلي بيانات الدخول الخاصة بك.`,
      field1_label: 'الاسم الكامل',
      field1_value: user.full_name,
      field2_label: 'اسم المستخدم',
      field2_value: user.username,
      field3_label: 'الصلاحية',
      field3_value: user.role || '-',
      field4_label: 'القسم',
      field4_value: user.department || '-',
      field5_label: 'كلمة المرور المؤقتة',
      field5_value: tempPassword || '(يرجى التواصل مع الإدارة)',
      notes:        'يُرجى تغيير كلمة المرور فور أول دخول للنظام للحفاظ على أمان حسابك.',
      action_label: loginUrl ? 'الدخول إلى النظام' : '',
      action_url:   loginUrl
    });
  }

  // ============================================
  // الواجهة العامة
  // ============================================
  return {
    init: init,
    isReady: function() { _initialized || init(); return _ready; },
    isConfigured: _isConfigured,
    config: EMAILJS_CONFIG,    // للقراءة فقط (للديباغ)
    // 5 دوال الإرسال:
    sendEvaluationEmail: sendEvaluationEmail,
    sendApprovalEmail:   sendApprovalEmail,
    sendActionEmail:     sendActionEmail,
    sendObjectionEmail:  sendObjectionEmail,
    sendNewUserEmail:    sendNewUserEmail
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
