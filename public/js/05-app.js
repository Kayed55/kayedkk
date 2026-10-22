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

// ============================================
// تتبّع الأخطاء (بديل خفيف عن Sentry): console.error + تجميع في audit_logs
// ============================================
let _lastErrReport = 0;
function reportClientError(msg, where) {
  try {
    const now = Date.now();
    if (now - _lastErrReport < 4000) return;   // throttle لتفادي الإغراق
    _lastErrReport = now;
    console.error('[client_error]', msg, where || '');
    if (window.sb && window.sb.rpc) {
      // عبر RPC log_event (anon لم يعد يكتب مباشرة في الجداول)
      window.sb.rpc('log_event', {
        p_session_token: (window.getSessionToken ? window.getSessionToken() : null),
        p_action: 'client_error',
        p_entity_type: 'client',
        p_entity_id: null,
        p_details: String(msg).slice(0, 500) + (where ? ' @ ' + String(where).slice(0, 200) : '')
      }).then(function(){}, function(){});   // best-effort
    }
  } catch (_) { /* ignore */ }
}
window.addEventListener('error', function(e){ reportClientError(e.message || 'error', (e.filename||'') + ':' + (e.lineno||'')); });
window.addEventListener('unhandledrejection', function(e){ reportClientError((e.reason && e.reason.message) || e.reason || 'unhandledrejection', 'promise'); });

// ★ #66: SWR عند الإقلاع — ارسم فوراً من كاش localStorage ثم حدّث بالخلفية (يزيل round-trip الحاجب من سيدني).
async function bootApp() {
  _showBootOverlay();
  try {
    // Never load a previous user's persisted data, or wait for IndexedDB to open.
    if (!window.sb) throw new Error('تعذّر تحميل خدمة الاتصال');
    DB.init();
    DB._hadCache = false;
    DB._storageType = (typeof _IDB !== 'undefined' && _IDB.available()) ? 'indexeddb' : 'localStorage';
    try { localStorage.removeItem(DB.KEY); } catch (_) {}
    if (typeof _IDB !== 'undefined' && _IDB.available()) _IDB.remove(DB.KEY).catch(function(){});
    const token = window.getSessionToken && window.getSessionToken();
    if (token) {
      // Only authorized, complete results may become visible.
      const ok = await window.SupabaseSync.pullAll();
      if (!ok) throw new Error('تعذّر تحميل البيانات');
      if (typeof loadDepartments === 'function') loadDepartments();
    }
    routeInitial();
    clearTimeout(window.bootWatchdog);
    _hideBootOverlay();
  } catch (e) {
    console.warn('[boot]', e && e.message);
    clearTimeout(window.bootWatchdog);
    if (window.showBootFailure) window.showBootFailure();
  }
}

// تحديد الوجهة وفق وجود جلسة محفوظة (منطق الإقلاع الأصلي — يُعاد استخدامه في المسارين).
function routeInitial() {
  const saved = localStorage.getItem('qe_current_user');
  if (saved && (!window.sb || (window.getSessionToken && window.getSessionToken()))) {
    try { currentUser = JSON.parse(saved); navigate('dashboard'); }
    catch (e) { navigate('login'); }
  } else {
    navigate('login');
  }
}

// ★ #66: سحب خلفي غير حاجب + مؤشّر «جاري التحديث…» (Read-path فقط — لا يمسّ مسار الكتابة).
async function backgroundSync() {
  if (!(window.sb && window.SupabaseSync && typeof window.SupabaseSync.pullAll === 'function')) return;
  _showUpdatingBar();
  try {
    const ok = await window.SupabaseSync.pullAll();
    if (ok !== false && window.SupabaseSync.scheduleUIRefresh) window.SupabaseSync.scheduleUIRefresh();
    _hideUpdatingBar();
  } catch (e) {
    console.warn('[backgroundSync] فشل التحديث الخلفي — يبقى الكاش، سيُعاد في الدورة (120s):', e && e.message);
    _hideUpdatingBar();   // إخفاء صامت — لا رسالة خطأ مقلقة
  }
}

// --- مؤشّر «جاري التحديث…» (شريط علوي 3px) + معالجة offline (إضافة 1) ---
function _showUpdatingBar() {
  const bar = document.getElementById('updating-bar');
  if (!bar) return;
  const offline = (navigator && navigator.onLine === false);
  const txt = bar.querySelector('#updating-text');
  if (txt) txt.textContent = offline ? 'غير متصل — يُعرض من الكاش' : 'جاري التحديث…';
  bar.style.background = offline ? 'rgba(245,158,11,.75)' : 'rgba(59,130,246,.6)';   // كهرماني عند offline، أزرق فاتح عند الاتصال
  bar.style.display = 'block';
  // إجبار reflow قبل ضبط الشفافية ليعمل الانتقال
  void bar.offsetWidth;
  bar.style.opacity = '1';
}
function _hideUpdatingBar() {
  const bar = document.getElementById('updating-bar');
  if (!bar) return;
  bar.style.opacity = '0';                       // fade-out 300ms عبر CSS transition
  setTimeout(() => { bar.style.display = 'none'; }, 320);
}
function _showBootOverlay() { const o = document.getElementById('boot-overlay'); if (o) o.style.display = 'flex'; }
function _hideBootOverlay() { const o = document.getElementById('boot-overlay'); if (o) o.style.display = 'none'; }

// تشغيل بعد جاهزية DOM فقط — لتفادي race condition مع 00-supabase-sync.js
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootApp);
} else {
  bootApp();
}

// ============================================
// تحديث تلقائي عند نشر نسخة جديدة (يحلّ كاش التبويبات المفتوحة بلا Cmd+Shift+R)
// ============================================
(function setupAutoUpdate() {
  function parseV(text) { var m = text.match(/04-pages\.js\?v=(\d+)/); return m ? parseInt(m[1], 10) : null; }
  // النسخة المُحمّلة حالياً من وسم السكربت نفسه
  var loaded = (function () {
    try { var s = document.querySelector('script[src*="04-pages.js"]'); return s ? parseV(s.src) : null; } catch (_) { return null; }
  })();
  if (!loaded) return;
  var busy = false, triggered = false;
  async function check() {
    if (busy || triggered || (typeof hasUnsavedWork === 'function' && hasUnsavedWork()) || document.querySelector('#modal-container .modal-overlay')) return; busy = true;
    try {
      var res = await fetch('/?_cv=' + Date.now(), { cache: 'no-store' });
      var deployed = parseV(await res.text());
      if (deployed && deployed > loaded) {
        triggered = true;
        try { if (window.Toast && Toast.info) Toast.info('🔄 تتوفّر نسخة محدّثة — يُعاد التحميل…'); } catch (_) {}
        setTimeout(function () { if (typeof hasUnsavedWork === 'function' && hasUnsavedWork()) { triggered=false; return; } location.reload(); }, 1500);
      }
    } catch (_) {} finally { busy = false; }
  }
  setInterval(check, 180000); // كل 3 دقائق
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') check(); });
  window.addEventListener('focus', check);
  setTimeout(check, 5000); // فحص مبكّر بعد الإقلاع
})();
