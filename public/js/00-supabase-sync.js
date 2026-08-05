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
  syncInterval: 120000,                                 // ★ #65-hotfix: 30s→120s (تقليل حِمل CPU الدوري 4×؛ Realtime يغطّي الحيّ)
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
  _pullSeq: 0,                   // ترقيم عمليات السحب لمنع سحب قديم من الكتابة فوق بيانات أحدث
  _appliedSeq: 0,

  // قائمة الجداول التي ستتم مزامنتها (الترتيب مهم بسبب foreign keys)
  // audit_logs مُزال عمداً: كبير (آلاف الصفوف) وغير مستخدم يومياً — يُجلب عند الطلب في صفحة السجل.
  TABLES: ['users', 'evaluation_templates', 'evaluations', 'notifications', 'objections'],
  // جداول تُجلب بأحدث N صفاً فقط (بدل الكل) — تخفيف الحمل مع إبقاء ما يلزم الواجهة.
  LIMITED_TABLES: { notifications: 300 },
  // ★ #66: TTL لكل جدول (بمفتاح readFrom) — يتخطّى الجلب الدوري إن كان الكاش طازجاً؛ force يتجاوزه دائماً.
  //   evaluation_templates ليس في Realtime (#65) → invalidateTTL يدوي عند حفظ القالب (04-pages.js).
  //   users_public حيّ عبر Realtime (#65) → TTL يقلّل تكرار autosync فقط.
  TTL_TABLES: { evaluation_templates: 24 * 60 * 60 * 1000, users_public: 60 * 60 * 1000 },
  _ttlFresh(name, ttlMs) { const t = +localStorage.getItem('qe_ttl_' + name) || 0; return (Date.now() - t) < ttlMs; },
  invalidateTTL(name) { try { localStorage.removeItem('qe_ttl_' + name); if (window.__CACHE_DEBUG__) console.log('🗑️ [ttl-invalidate] ' + name); } catch (_) {} },

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
  async pullAll(force) {
    if (!window.sb) return false;
    // مع force: لا نُعيد عملية سحب قديمة قد تكون بدأت قبل آخر كتابة (تفادي بيانات غير محدّثة)
    if (this.pendingPull && !force) return this.pendingPull;

    const self = this;
    const seq = ++this._pullSeq;   // ترتيب بدء هذه العملية
    const p = (async () => {
      try {
        console.log('⬇️ Pulling data from Supabase...');
        const results = {};

        for (const table of this.TABLES) {
          // أمان: نقرأ من users_public (view بدون كلمات السر) بدلاً من users
          // كلمات السر يجب ألا تصل للمتصفح أبداً عبر anon key.
          const readFrom = (table === 'users') ? 'users_public' : table;

          // ★ #66: تخطّي الجلب إن كان TTL طازجاً والبيانات موجودة في الذاكرة (إلا مع force) — cache-hit.
          const ttlMs = this.TTL_TABLES[readFrom];
          if (!force && ttlMs && this._ttlFresh(readFrom, ttlMs) && DB.data && Array.isArray(DB.data[table]) && DB.data[table].length) {
            results[table] = DB.data[table];
            if (window.__CACHE_DEBUG__) console.log('  ⚡ [cache-hit] ' + table + ' (TTL طازج) — تخطّي الجلب');
            continue;
          }

          // جداول محدودة: جلب أحدث N فقط (order id desc + limit) بدل ترقيم الكل — تخفيف الحمل.
          const limitN = this.LIMITED_TABLES[table];
          if (limitN) {
            let lData = null, lErr = null, lStatus = null;
            for (let attempt = 1; attempt <= 3; attempt++) {
              const res = await window.sb.from(readFrom).select('*').order('id', { ascending: false }).limit(limitN);
              lData = res.data; lErr = res.error; lStatus = res.status;
              if (!lErr) break;
              console.error(`[pullAll] Table: ${table} | Limited: ${limitN} | Status: ${lStatus} | Attempt: ${attempt}/3 | Error: ${lErr.message}`);
              if (attempt < 3) await new Promise(r => setTimeout(r, 500));
            }
            if (lErr) {
              self._lastPullError = { table: readFrom, status: lStatus, message: lErr.message, at: new Date().toISOString(), ua: (navigator && navigator.userAgent) || '' };
              console.warn(`⚠️ فشلت قراءة ${table} بعد 3 محاولات — إيقاف السحب`);
              return false;
            }
            results[table] = lData || [];
            if (ttlMs) localStorage.setItem('qe_ttl_' + readFrom, String(Date.now()));   // ★ #66
            console.log(`  ✓ [pullAll] Table: ${table} (${readFrom}) | Limited: ${limitN} | Total rows: ${(lData||[]).length}`);
            continue;
          }

          // ترقيم صفحات: PostgREST يسقف الاستجابة (افتراضياً 1000 صف)، فنقرأ على دفعات
          // بحجم PAGE حتى تُجلب كل الصفوف — وإلا تختفي الصفوف الحديثة (عالية الـid) من الكاش.
          // ملاحظة: PAGE يجب ألا يتجاوز سقف صفوف الخادم (الافتراضي 1000).
          const PAGE = 1000, MAX_PAGES = 50;   // سقف علوي: 50k صف — يمنع أي حلقة لانهائية
          let data = null, error = null, status = null;
          let all = [], pages = 0, aborted = false;
          for (let page = 0; page < MAX_PAGES; page++) {
            const start = page * PAGE, end = start + PAGE - 1;
            // إعادة محاولة ذكية داخل كل دفعة: حتى 3 محاولات بفاصل 500ms قبل الاستسلام
            let pData = null, pErr = null, pStatus = null;
            for (let attempt = 1; attempt <= 3; attempt++) {
              const res = await window.sb.from(readFrom).select('*').order('id', { ascending: true }).range(start, end);
              pData = res.data; pErr = res.error; pStatus = res.status;
              if (!pErr) break;
              console.error(`[pullAll] Table: ${table} | Page: ${page} | Status: ${pStatus} | Attempt: ${attempt}/3 | Error: ${pErr.message}`);
              if (attempt < 3) await new Promise(r => setTimeout(r, 500));
            }
            if (pErr) { error = pErr; status = pStatus; aborted = true; break; }
            const batch = pData || [];
            all = all.concat(batch);
            pages++;
            if (batch.length < PAGE) break;   // آخر دفعة (رجعت أقل من حجم الصفحة)
          }
          if (aborted) {
            // أوقف العملية كلها بدل الكتابة فوق بيانات سليمة ببيانات ناقصة/فارغة
            self._lastPullError = { table: readFrom, status: status, message: error.message, at: new Date().toISOString(), ua: (navigator && navigator.userAgent) || '' };
            console.warn(`⚠️ فشلت قراءة ${table} بعد 3 محاولات — إيقاف السحب`);
            return false;
          }
          data = all;
          console.log(`  ✓ [pullAll] Table: ${table} (${readFrom}) | Pages: ${pages} | Total rows: ${all.length}`);
          if (pages >= MAX_PAGES) console.warn(`⚠️ [pullAll] Table: ${table} — بلغ MAX_PAGES (${MAX_PAGES})؛ قد تكون هناك صفوف إضافية غير مُحمَّلة.`);
          results[table] = data || [];
          if (ttlMs) localStorage.setItem('qe_ttl_' + readFrom, String(Date.now()));   // ★ #66
        }

        // مصدر CRITERIA الآن = نموذج قسم محزم (section_based) من evaluation_templates
        // (بدلاً من criteria_config القديم — مصدر واحد للحقيقة لكل قسم)
        let criteria = null;
        if (results.evaluation_templates && results.evaluation_templates.length) {
          const row = results.evaluation_templates.find(r => r.template_type === 'section_based' && r.is_active)
                   || results.evaluation_templates.find(r => r.template_type === 'section_based');
          if (row) criteria = row.template_jsonb;
        }

        // أُلغيت آلية tombstone: حارس التسلسل (_appliedSeq) يمنع أي سحب قديم من إحياء
        // تقييم محذوف، دون حجب تقييم أُعيد إنشاؤه بمعرّف معاد (create يستخدم max(id)+1).

        // بناء data في الصيغة المتوقعة من 02-db.js
        const dbData = {
          users: results.users || [],
          evaluations: results.evaluations || [],
          notifications: results.notifications || [],
          objections: results.objections || [],
          evaluation_templates: results.evaluation_templates || [],   // ★ #58: تخزينها لـ_tplById (كانت تُشتَقّ منها criteria فقط)
          audit_logs: results.audit_logs || [],
          criteria: criteria || (window.DEFAULT_CRITERIA ? JSON.parse(JSON.stringify(window.DEFAULT_CRITERIA)) : {}),
          nextUserId: Math.max(0, ...(results.users || []).map(u => u.id)) + 1,
          nextEvalId: Math.max(0, ...(results.evaluations || []).map(e => e.id)) + 1,
          nextNotifId: Math.max(0, ...(results.notifications || []).map(n => n.id)) + 1,
          nextObjectionId: Math.max(0, ...(results.objections || []).map(o => o.id)) + 1,
          nextAuditId: Math.max(0, ...(results.audit_logs || []).map(a => a.id)) + 1
        };

        // حارس التسلسل: لا تكتب فوق بيانات طبّقها سحبٌ أحدث (سحب قديم اكتمل متأخّراً)
        if (seq < self._appliedSeq) {
          console.log('  ⏭️ تجاهل سحب قديم اكتمل متأخّراً (seq ' + seq + ' < ' + self._appliedSeq + ')');
          return true;
        }
        self._appliedSeq = seq;

        // ★ #67-B: التخزين انتقل إلى DB._persist() (IndexedDB — حصّة كبيرة، بلا تقليم) بعد إسناد DB.data أدناه،
        //   بدل نُسخ localStorage lite التي كانت تقصّ التقييمات عند تجاوز 5MB (سبب تعطّل warm SWR مع 1119 تقييم).

        // مرجع DB: ثابت عام (ليس على window) — نستخدمه المجرّد. (كان window.DB خطأً يجعل
        // الكتلة كود ميّت، فتبقى الذاكرة على نسخة localStorage المُقلّمة lite.)
        // أنشئ بنية DB.data إن لم تكن موجودة (أول إقلاع فقط) بلا دهس ذاكرة كاملة قائمة.
        if (typeof DB !== 'undefined' && DB) {
          if (typeof DB.init === 'function' && !DB.data) DB.init();
          // مصدر الحقيقة = الذاكرة: أسند البيانات الكاملة الطازجة (تُدهَس أي نسخة مُقلّمة)
          const d = DB.data;
          if (d) {
            d.users = dbData.users; d.evaluations = dbData.evaluations; d.notifications = dbData.notifications;
            d.objections = dbData.objections; d.criteria = dbData.criteria;
            d.evaluation_templates = dbData.evaluation_templates;   // ★ #58: يُفعّل _tplById (تسميات النماذج في العرض/الفلتر)
            // audit_logs لا يُسحب هنا (يُجلب عند الطلب في صفحة السجل) — لا نَدهس ما حمّلته loadAuditLog.
            d.nextUserId = dbData.nextUserId; d.nextEvalId = dbData.nextEvalId;
            d.nextNotifId = dbData.nextNotifId; d.nextObjectionId = dbData.nextObjectionId;
          }
          if (typeof DB._persist === 'function') { try { DB._persist(); } catch (_) {} }   // ★ #67-B: حفظ كامل لـIndexedDB
        }
        // ★ #67-B: سحب force = أعقب كتابة → أبطل كاش لوحة التحكم (يشمل التقييمات والاعتراضات)
        if (force && typeof window !== 'undefined' && window.invalidateDashCache) { try { window.invalidateDashCache(); } catch (_) {} }
        self._lastPullError = null;

        this.ready = true;
        this.lastSync = Date.now();
        console.log('✅ Pull complete.');
        return true;
      } catch (e) {
        console.error('❌ Pull failed:', e);
        return false;
      }
    })();

    this.pendingPull = p;
    // ننظّف pendingPull فقط إن كان لا يزال يشير لهذه العملية (يحمي عمليات force المتزامنة)
    p.then(function(){}, function(){}).then(function(){ if (self.pendingPull === p) self.pendingPull = null; });
    return p;
  },

  /**
   * ★ #58: سحب جدول واحد فقط (بدل pullAll الكامل) — يستخدمه Realtime لتقليل الحِمل
   * من O(كل الجداول) إلى O(جدول واحد). يحدّث الذاكرة (DB.data) فقط؛ لا يُعيد الحفظ لـ
   * localStorage (خفّة — الذاكرة مصدر الحقيقة، والحفظ الكامل يتم في pullAll عند الإقلاع).
   * حارس _pullSeq يمنع كتابة سحب قديم فوق أحدث.
   */
  async pullTable(table) {
    if (!window.sb || !this.TABLES.includes(table)) return false;
    const self = this;
    const seq = ++this._pullSeq;
    const readFrom = (table === 'users') ? 'users_public' : table;
    const limitN = this.LIMITED_TABLES[table];
    let rows = null;
    try {
      if (limitN) {
        const res = await window.sb.from(readFrom).select('*').order('id', { ascending: false }).limit(limitN);
        if (res.error) throw res.error;
        rows = res.data || [];
      } else {
        const PAGE = 1000, MAX_PAGES = 50; let all = [];
        for (let page = 0; page < MAX_PAGES; page++) {
          const start = page * PAGE, end = start + PAGE - 1;
          const res = await window.sb.from(readFrom).select('*').order('id', { ascending: true }).range(start, end);
          if (res.error) throw res.error;
          const batch = res.data || [];
          all = all.concat(batch);
          if (batch.length < PAGE) break;
        }
        rows = all;
      }
    } catch (e) {
      self._lastPullError = { table: readFrom, message: (e && e.message) || String(e), at: new Date().toISOString() };
      console.warn('[pullTable] فشل سحب ' + table + ': ' + ((e && e.message) || e));
      return false;
    }
    if (seq < self._appliedSeq) { console.log('  ⏭️ [pullTable] تجاهل سحب قديم (seq ' + seq + ' < ' + self._appliedSeq + ')'); return true; }
    self._appliedSeq = seq;
    if (typeof DB !== 'undefined' && DB && DB.data) {
      const d = DB.data;
      if (table === 'users') { d.users = rows; d.nextUserId = Math.max(0, ...rows.map(u => u.id || 0)) + 1; }
      else if (table === 'evaluations') { d.evaluations = rows; d.nextEvalId = Math.max(0, ...rows.map(e => e.id || 0)) + 1; }
      else if (table === 'notifications') { d.notifications = rows; d.nextNotifId = Math.max(0, ...rows.map(n => n.id || 0)) + 1; }
      else if (table === 'objections') { d.objections = rows; d.nextObjectionId = Math.max(0, ...rows.map(o => o.id || 0)) + 1; }
      else if (table === 'evaluation_templates') {
        d.evaluation_templates = rows;
        const row = rows.find(r => r.template_type === 'section_based' && r.is_active) || rows.find(r => r.template_type === 'section_based');
        if (row) d.criteria = row.template_jsonb;
      }
    }
    self._lastPullError = null;
    console.log('  ✓ [pullTable] ' + table + ' (' + rows.length + ' صف)');
    return true;
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

      // المعايير: لم تعُد تُدفع من هنا — تُحرَّر عبر RPC upsert_evaluation_template
      // (المصدر الوحيد للحقيقة = evaluation_templates لكل قسم).

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
    // مُعطّل: حلّ محلّه js/realtime-service.js (لتفادي اشتراك مزدوج). يبقى للتوافق فقط.
    console.log('ℹ️ setupRealtime المضمّن مُعطّل — تُدار الاشتراكات عبر RealtimeService');
    return;
    /* eslint-disable no-unreachable */
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

// ★ #66: أدوات تصحيح الكاش (DevTools)
window.__CACHE_DEBUG__ = window.__CACHE_DEBUG__ || false;   // فعّله: window.__CACHE_DEBUG__ = true
window.__CLEAR_CACHE__ = function () {
  try {
    Object.keys(localStorage).filter(k => k.indexOf('qe_ttl_') === 0).forEach(k => localStorage.removeItem(k));
    localStorage.removeItem('qe_system_v6');
    console.log('🧹 تم مسح الكاش (qe_ttl_* + qe_system_v6). أعد التحميل.');
  } catch (e) { console.warn(e); }
};

// ============================================
// Bootstrap: إعداد المزامنة عند تحميل الصفحة
// ★ #66: السحب الأولي يُدار في bootApp (SWR: رسم من الكاش ثم سحب خلفي) — هنا الإعداد فقط، بلا سحب حاجب مزدوج.
// ============================================
window.addEventListener('DOMContentLoaded', async () => {
  if (!window.sb) {
    console.log('ℹ️ Supabase غير مهيأ - النظام يعمل بـ localStorage فقط');
    return;
  }
  // اربط hook لدفع كل تعديل لاحق إلى Supabase
  window.SupabaseSync.hookDBSave();
  // فعّل Realtime عبر RealtimeService (لا يعتمد على اكتمال السحب)
  if (window.RealtimeService && window.RealtimeService.start) window.RealtimeService.start();
  // شغّل المزامنة الدورية الاحتياطية (كل 120s — #65)
  window.SupabaseSync.startAutoSync();
});
