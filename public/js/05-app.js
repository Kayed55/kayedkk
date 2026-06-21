/*!
 * نظام الجودة للتقييم والتدريب - شركة محزم
 *
 * Module: Application Bootstrap
 * Initializes the database and starts the router based on saved session.
 *
 * Fix (2026-06): يحلّ مشكلة "تسجيل الدخول لا يعمل إلا بعد تحديث الصفحة"
 *   - السبب: 05-app.js كان يُشغَّل فوراً (قبل DOMContentLoaded) فيقرأ
 *     localStorage الفارغ/القديم ويعرض شاشة الدخول قبل أن يكمل
 *     00-supabase-sync.js عملية pullAll()، فيتم التحقق من كلمة السر
 *     مقابل بيانات قديمة فيفشل الدخول حتى تحديث الصفحة.
 *   - الحلّ: انتظار DOMContentLoaded ثم انتظار pullAll() (وهي idempotent
 *     عبر pendingPull) قبل تهيئة DB وإظهار شاشة الدخول.
 *
 * @module app
 * @copyright (c) 2026 Mahzam Co.
 */
'use strict';

async function bootApp() {
  // 1) انتظر اكتمال جلب البيانات من Supabase (إن كان مُهيّأ) قبل تهيئة DB.
  //    pullAll() آمنة للنداء المتزامن لأنها تستخدم pendingPull للتمييز.
  try {
    if (window.sb && window.SupabaseSync && typeof window.SupabaseSync.pullAll === 'function') {
      await window.SupabaseSync.pullAll();
    }
  } catch (e) {
    console.warn('Supabase pull failed at boot, falling back to local cache:', e && e.message);
  }

  // 2) تهيئة قاعدة البيانات (تقرأ localStorage الذي حُدِّث للتو من Supabase).
  DB.init();

  // 3) تحديد الوجهة وفق وجود جلسة محفوظة.
  const saved = localStorage.getItem('qe_current_user');
  if (saved) {
    try {
      currentUser = JSON.parse(saved);
      navigate('dashboard');
    } catch (e) {
      navigate('login');
    }
  } else {
    navigate('login');
  }
}

// تشغيل بعد جاهزية DOM فقط — لتفادي race condition مع 00-supabase-sync.js
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootApp);
} else {
  bootApp();
}
