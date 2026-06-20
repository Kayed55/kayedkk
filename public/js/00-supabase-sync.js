/*!
 * نظام الجودة للتقييم والتدريب - شركة محزم
 *
 * Module: Supabase Sync Layer
 *
 * يربط النظام بـ Supabase ويعمل كطبقة مزامنة:
 *  - عند بدء التشغيل: يجلب كل البيانات من Supabase ويضعها في localStorage
 *  - بعد كل تعديل: يدفع التغييرات إلى Supabase (في الخلفية)
 *  - دورياً (كل 30 ثانية): يتحقق من تحديثات من أجهزة أخرى
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
  syncInterval: 30000,                                  // مزامنة كل 30 ثانية
  enableAutoSync: true                                  // فعّل/عطّل المزامنة التلقائية
};

// ============================================
// تهيئة Supabase Client
// ============================================
(function initSupabase() {
  if (typeof window.supabase === 'undefined') {
    console.warn('⚠️ Supabase SDK غير محمّل. تأكد من إضافة <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script> في index.html');
    return;
  }

  if (SUPABASE_CONFIG.url.includes('YOUR_PROJECT_ID')) {
    console.warn('⚠️ Supabase لم يتم إعداده. عدّل js/00-supabase-sync.js وأضف URL و anon key');
    return;
  }

  window.sb = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
  console.log('✓ Supabase client جاهز');
})();

// ============================================
// طبقة المزامنة
// ============================================
window.SupabaseSync = {
  ready: false,
  lastSync: null,
  syncInProgress: false,

  // قائمة الجداول التي ستتم مزامنتها (الترتيب مهم بسبب foreign keys)
  TABLES: ['users', 'criteria_config', 'evaluations', 'notifications', 'objections', 'audit_logs'],

  /**
   * جلب جميع البيانات من Supabase وحفظها في localStorage
   * يُستدعى مرة عند بدء التشغيل
   */
  async pullAll() {
    if (!window.sb) return false;
    try {
      console.log('⬇️ Pulling data from Supabase...');
      const results = {};

      for (const table of this.TABLES) {
        const { data, error } = await window.sb.from(table).select('*').order('id', { ascending: true });
        if (error) {
          console.warn(`⚠️ Failed to pull ${table}:`, error.message);
          continue;
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
      this.ready = true;
      this.lastSync = Date.now();
      console.log('✅ Pull complete. Data ready in localStorage.');
      return true;
    } catch (e) {
      console.error('❌ Pull failed:', e);
      return false;
    }
  },

  /**
   * دفع كل البيانات الحالية في localStorage إلى Supabase (Bulk upsert)
   */
  async pushAll() {
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
   * مزامنة دورية في الخلفية
   * يدفع البيانات المحلية إلى Supabase ثم يسحب أي تحديثات جديدة
   */
  startAutoSync() {
    if (!SUPABASE_CONFIG.enableAutoSync) return;
    setInterval(async () => {
      if (this.syncInProgress) return;
      await this.pushAll();
      await this.pullAll();
      // إعادة تحميل DB من localStorage بعد المزامنة
      if (window.DB && typeof window.DB.init === 'function') {
        window.DB.init();
      }
    }, SUPABASE_CONFIG.syncInterval);
    console.log(`🔄 Auto-sync enabled (every ${SUPABASE_CONFIG.syncInterval / 1000}s)`);
  },

  /**
   * Hook بعد كل تعديل في DB لدفع التغييرات لـ Supabase
   * يُستدعى تلقائياً من خلال wrapping DB.save
   */
  hookDBSave() {
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

  // 2. إعادة تحميل DB ليأخذ البيانات الجديدة
  if (window.DB && typeof window.DB.init === 'function') {
    window.DB.init();
  }

  // 3. اربط hook لدفع كل تعديل لاحق إلى Supabase
  window.SupabaseSync.hookDBSave();

  // 4. شغّل المزامنة الدورية
  window.SupabaseSync.startAutoSync();
});
