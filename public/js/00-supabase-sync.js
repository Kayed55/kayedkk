/*!
 * نظام الجودة للتقييم والتدريب - شركة محزم
 *
 * Module: Supabase Sync Layer (with Realtime)
 *
 * يربط النظام بـ Supabase ويعمل كطبقة مزامنة:
 *  - عند بدء التشغيل: يجلب كل البيانات من Supabase ويضعها في localStorage
 *  - بعد كل تعديل: يدفع التغييرات إلى Supabase (في الخلفية)
 *  - Realtime: يستمع لتغييرات الجداول من أجهزة أخرى ويُحدّث الواجهة فوراً
 *  - دورياً (كل 30 ثانية): يتحقق من تحديثات (احتياطي)
 *
 * هذا الملف يجب أن يُحمَّل قبل 02-db.js
 *
 * @module supabase-sync
 * @copyright (c) 2026 Mahzam Co.
 */
'use strict';

// ============================================
// إعدادات Supabase - ✏️ عدّل هذه القيم
// ============================================
const SUPABASE_CONFIG = {
  url: 'https://hobhajqtgcyctfmcxkel.supabase.co',         // ← من Settings → API → Project URL
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhvYmhhanF0Z2N5Y3RmbWN4a2VsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4ODkzMDIsImV4cCI6MjA5NzQ2NTMwMn0.mTWqRmUyxShOSbwpnlHcmRU3FZ_KQ8OSLyG6sQzgmBY',                // ← من Settings → API → anon public key
  syncInterval: 30000,                                  // مزامنة احتياطية كل 30 ثانية
  enableAutoSync: true,                                 // فعّل/عطّل المزامنة الدورية
  enableRealtime: true,                                 // فعّل/عطّل Realtime subscriptions
  uiRefreshDebounce: 250                                // تأخير إعادة رسم الواجهة (ms)
};

// ============================================
// تهيئة Supabase Client
// ============================================
(function initSupabase() {
  if (typeof window.supabase === 'undefined') {
    console.warn('⚠️ Supabase SDK غير محمّل. أضف <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script> في index.html');
    return;
  }

  if (SUPABASE_CONFIG.url.includes('YOUR_PROJECT_ID')) {
    console.warn('⚠️ Supabase لم يتم إعداده. عدّل js/00-supabase-sync.js وأضف URL و anon key');
    return;
  }

  window.sb = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey, {
    realtime: { params: { eventsPerSecond: 10 } },
    // تجاوز كاش المتصفّح لطلبات REST — كل قراءة تُجلب طازجة من القاعدة
    global: { fetch: (url, opts) => fetch(url, Object.assign({}, opts, { cache: 'no-store' })) }
  });
  console.log('✓ Supabase client جاهز');
})();

// ============================================
// طبقة المزامنة
// ============================================
window.SupabaseSync = {
  ready: false,
  lastSync: null,
  syncInProgress: false,
  pendingPull: null,             // promise لمنع pulls متزامنة
  uiRefreshTimer: null,          // debounce timer لإعادة الرسم
  realtimeChannels: [],          // قنوات Realtime المفتوحة
  _hooked: false,                // علم لمنع hook مزدوج
  deletedEvalIds: [],            // tombstones: تقييمات حُذفت في هذه الجلسة لا يجب أن تعود عبر أي pull متأخّر
  writeViaRpcOnly: true,         // 2-ب-2: تعطيل رفع pushAll المباشر — الكتابة عبر RPCs فقط

  // قائمة الجداول التي ستتم مزامنتها (الترتيب مهم بسبب foreign keys)
  TABLES: ['users', 'criteria_config', 'evaluations', 'notifications', 'objections', 'audit_logs'],

  /**
   * إعادة رسم الصفحة الحالية مع debounce لتفادي الرسم المتكرر
   *
   * Fix (2026-06): كانت الدالة تستخدم window.currentPage / window.currentParams
   *   لكنّ تصاريح `let currentPage = ...` في 04-pages.js لا تُنشئ خصائص على
   *   كائن window (بخلاف var/function). نتيجة ذلك كانت الشروط تفشل دائماً
   *   ولم تُعَد رسم الواجهة عند وصول أحداث Realtime، مما أدى إلى عدم ظهور
   *   تعديلات الحفظ والاعتماد إلا بعد تحديث الصفحة.
   *   الحل: قراءة المتغيرات من نطاق السكربت العام مباشرةً (lexical scope)
   *   بدلاً من window.X مع حماية بـ typeof لو لم يُحمَّل 04-pages.js بعد.
   */
  scheduleUIRefresh() {
    if (this.uiRefreshTimer) clearTimeout(this.uiRefreshTimer);
    this.uiRefreshTimer = setTimeout(() => {
      this.uiRefreshTimer = null;
      try {
        // نقرأ المتغيرات من نطاق السكربت العام، لا من window
        const _nav = (typeof navigate === 'function') ? navigate : null;
        const _page = (typeof currentPage !== 'undefined') ? currentPage : null;
        const _params = (typeof currentParams !== 'undefined') ? currentParams : {};
        if (_nav && _page && _page !== 'login') {
          _nav(_page, _params);
        }
      } catch (e) {
        console.warn('UI refresh failed:', e && e.message);
      }
    }, SUPABASE_CONFIG.uiRefreshDebounce);
  },

  /**
   * جلب جميع البيانات من Supabase وحفظها في localStorage
   * - يستخدم pendingPull لمنع pulls متزامنة (deduplication)
   */
  async pullAll() {
    if (!window.sb) return false;
    if (this.pendingPull) return this.pendingPull;

    this.pendingPull = (async () => {
      try {
        console.log('⬇️ Pulling data from Supabase...');
        const results = {};

        for (const table of this.TABLES) {
          // أمان: نقرأ من users_public (view بدون كلمات السر) بدلاً من users
          // كلمات السر يجب ألا تصل للمتصفح أبداً عبر anon key.
          const readFrom = (table === 'users') ? 'users_public' : table;
          const { data, error } = await window.sb.from(readFrom).select('*').order('id', { ascending: true });
          if (error) {
            // أوقف العملية كلها بدل الكتابة فوق بيانات سليمة ببيانات ناقصة/فارغة
            console.warn(`⚠️ Failed to pull ${table} — aborting pull:`, error.message);
            return false;
          }
          results[table] = data || [];
          console.log(`  ✓ ${table}: ${data.length} rows`);
        }

        // تحويل criteria_config إلى الصيغة المتوقعة في DB
        let criteria = null;
        if (results.criteria_config && results.criteria_config.length) {
          const row = results.criteria_config.find(r => r.config_key === 'criteria');
          if (row) criteria = row.config_value;
        }

        // استبعاد التقييمات المحذوفة محلياً (tombstones) تحسّباً لأي pull قديم in-flight
        if (this.deletedEvalIds.length && Array.isArray(results.evaluations)) {
          results.evaluations = results.evaluations.filter(e => this.deletedEvalIds.indexOf(e.id) === -1);
          if (Array.isArray(results.objections)) {
            results.objections = results.objections.filter(o => this.deletedEvalIds.indexOf(o.evaluation_id) === -1);
          }
        }

        // بناء data في الصيغة المتوقعة من 02-db.js
        const dbData = {
          users: results.users || [],
          evaluations: results.evaluations || [],
          notifications: results.notifications || [],
          objections: results.objections || [],
          audit_logs: results.audit_logs || [],
          criteria: criteria || (window.DEFAULT_CRITERIA ? JSON.parse(JSON.stringify(window.DEFAULT_CRITERIA)) : {}),
          nextUserId: Math.max(0, ...(results.users || []).map(u => u.id)) + 1,
          nextEvalId: Math.max(0, ...(results.evaluations || []).map(e => e.id)) + 1,
          nextNotifId: Math.max(0, ...(results.notifications || []).map(n => n.id)) + 1,
          nextObjectionId: Math.max(0, ...(results.objections || []).map(o => o.id)) + 1,
          nextAuditId: Math.max(0, ...(results.audit_logs || []).map(a => a.id)) + 1
        };

        // حفظ في localStorage بنفس مفتاح DB
        localStorage.setItem('qe_system_v6', JSON.stringify(dbData));

        // إعادة تحميل DB ليعكس البيانات الجديدة في الذاكرة
        if (window.DB && typeof window.DB.init === 'function') {
          window.DB.init();
        }

        this.ready = true;
        this.lastSync = Date.now();
        console.log('✅ Pull complete.');
        return true;
      } catch (e) {
        console.error('❌ Pull failed:', e);
        return false;
      } finally {
        this.pendingPull = null;
      }
    })();

    return this.pendingPull;
  },

  /**
   * دفع كل البيانات الحالية في localStorage إلى Supabase
   */
  async pushAll() {
    // المرحلة 2-ب-2: الرفع المباشر معطّل — كل الكتابات تمرّ عبر RPCs مُصادَقة.
    // pullAll (القراءة) يبقى فعّالاً. (للتراجع: أعد writeViaRpcOnly=false)
    if (this.writeViaRpcOnly) return true;
    if (!window.sb) return false;
    if (this.syncInProgress) return false;
    this.syncInProgress = true;

    try {
      const raw = localStorage.getItem('qe_system_v6');
      if (!raw) return false;
      const data = JSON.parse(raw);

      console.log('⬆️ Pushing data to Supabase...');

      // المستخدمون
      if (data.users && data.users.length) {
        const { error } = await window.sb.from('users').upsert(data.users, { onConflict: 'id' });
        if (error) console.warn('Users sync:', error.message);
        else console.log(`  ✓ users: ${data.users.length}`);
      }

      // التقييمات
      if (data.evaluations && data.evaluations.length) {
        const { error } = await window.sb.from('evaluations').upsert(data.evaluations, { onConflict: 'id' });
        if (error) console.warn('Evaluations sync:', error.message);
        else console.log(`  ✓ evaluations: ${data.evaluations.length}`);
      }

      // الإشعارات
      if (data.notifications && data.notifications.length) {
        const { error } = await window.sb.from('notifications').upsert(data.notifications, { onConflict: 'id' });
        if (error) console.warn('Notifications sync:', error.message);
      }

      // الاعتراضات
      if (data.objections && data.objections.length) {
        const { error } = await window.sb.from('objections').upsert(data.objections, { onConflict: 'id' });
        if (error) console.warn('Objections sync:', error.message);
      }

      // سجل العمليات (آخر 100 فقط لتقليل الحمل)
      if (data.audit_logs && data.audit_logs.length) {
        const recent = data.audit_logs.slice(-100);
        const { error } = await window.sb.from('audit_logs').upsert(recent, { onConflict: 'id' });
        if (error) console.warn('Audit sync:', error.message);
      }

      // المعايير
      if (data.criteria) {
        const { error } = await window.sb.from('criteria_config').upsert({
          config_key: 'criteria',
          config_value: data.criteria,
          updated_at: new Date().toISOString()
        }, { onConflict: 'config_key' });
        if (error) console.warn('Criteria sync:', error.message);
      }

      this.lastSync = Date.now();
      console.log('✅ Push complete.');
      return true;
    } catch (e) {
      console.error('❌ Push failed:', e);
      return false;
    } finally {
      this.syncInProgress = false;
    }
  },

  /**
   * المزامنة الدورية (احتياطية - Realtime يغطيها عادةً)
   */
  startAutoSync() {
    if (!SUPABASE_CONFIG.enableAutoSync) return;
    setInterval(async () => {
      if (this.syncInProgress || this.pendingPull) return;
      await this.pushAll();
      await this.pullAll();
    }, SUPABASE_CONFIG.syncInterval);
    console.log(`🔄 Auto-sync enabled (every ${SUPABASE_CONFIG.syncInterval / 1000}s)`);
  },

  /**
   * إعداد Realtime subscriptions لكل جدول
   * عند أي تغيير: pullAll() ثم scheduleUIRefresh()
   */
  setupRealtime() {
    if (!window.sb) return;
    if (!SUPABASE_CONFIG.enableRealtime) {
      console.log('ℹ️ Realtime معطّل في الإعدادات');
      return;
    }
    if (this.realtimeChannels.length > 0) {
      console.log('ℹ️ Realtime channels مُفعّلة بالفعل');
      return;
    }

    this.TABLES.forEach(table => {
      const channel = window.sb
        .channel(`public:${table}`)
        .on('postgres_changes',
          { event: '*', schema: 'public', table: table },
          async (payload) => {
            // تجاهل الأحداث أثناء عملية push محلية لتفادي حلقات
            if (this.syncInProgress) return;
            console.log(`🔔 Realtime ${table} ${payload.eventType}`);
            await this.pullAll();
            this.scheduleUIRefresh();
          }
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            console.log(`📡 Realtime مُفعّل: ${table}`);
          }
        });
      this.realtimeChannels.push(channel);
    });
  },

  /**
   * إغلاق كل قنوات Realtime
   */
  teardownRealtime() {
    if (!window.sb) return;
    this.realtimeChannels.forEach(ch => {
      try { window.sb.removeChannel(ch); } catch (_) {}
    });
    this.realtimeChannels = [];
  },

  /**
   * Hook بعد كل تعديل في DB لدفع التغييرات لـ Supabase
   * - idempotent: لن يُربط مرتين
   */
  hookDBSave() {
    if (this._hooked) return;
    if (!window.DB || typeof window.DB.save !== 'function') {
      console.warn('⚠️ DB غير جاهز، لن يتم hook الـ save');
      return;
    }
    const originalSave = window.DB.save.bind(window.DB);
    window.DB.save = (...args) => {
      const result = originalSave(...args);
      // دفع غير متزامن (لا ننتظر النتيجة)
      this.pushAll().catch(e => console.warn('Background push failed:', e.message));
      return result;
    };
    this._hooked = true;
    console.log('✓ DB.save hooked - كل تعديل سيُدفع لـ Supabase تلقائياً');
  }
};

// ============================================
// Bootstrap: تشغيل المزامنة عند تحميل الصفحة
// ============================================
window.addEventListener('DOMContentLoaded', async () => {
  if (!window.sb) {
    console.log('ℹ️ Supabase غير مهيأ - النظام يعمل بـ localStorage فقط');
    return;
  }

  // 1. اسحب البيانات من Supabase أولاً (لتجاوز ما في localStorage)
  await window.SupabaseSync.pullAll();

  // 2. اربط hook لدفع كل تعديل لاحق إلى Supabase
  window.SupabaseSync.hookDBSave();

  // 3. فعّل Realtime subscriptions
  window.SupabaseSync.setupRealtime();

  // 4. شغّل المزامنة الدورية الاحتياطية
  window.SupabaseSync.startAutoSync();

  // 5. إعادة رسم الصفحة الحالية بعد المزامنة الأولى
  window.SupabaseSync.scheduleUIRefresh();
});
