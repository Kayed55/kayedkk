/*!
 * نظام الجودة — شركة محزم
 * RealtimeService: إدارة مركزية لاشتراكات Supabase Realtime (postgres_changes).
 *
 * النهج (#58): عند أي حدث (INSERT/UPDATE/DELETE) على جدول مبثوث → سحب مُدمج (debounce)
 * للجدول المتغيّر فقط عبر SupabaseSync.pullTable(table) ثم إعادة رسم الصفحة الحالية.
 * (قناة واحدة مدموجة لكل الجداول + cooldown على catch-up لتفادي عاصفة استنزاف الـpool.)
 * هذا idempotent (لا تطبيق مزدوج) ويعتمد حارس التسلسل _appliedSeq لمنع
 * كتابة سحب قديم فوق بيانات أحدث.
 *
 * الأمان: لا يُشترك إطلاقاً في sessions/login_codes. جدول users يُبثّ بقائمة
 * أعمدة بلا password (يُضبط في القاعدة عبر publication).
 *
 * @module realtime-service
 * @copyright (c) 2026 Mahzam Co.
 */
'use strict';

(function () {
  const RealtimeService = {
    // الجداول المبثوثة — A: evaluations | B: evaluation_templates | C: users, objections, objection_comments, notifications
    TABLES: ['evaluations', 'evaluation_templates', 'creative_gene_weekly_status', 'creative_gene_objections', 'creative_gene_actions', 'users', 'objections', 'objection_comments', 'notifications'],
    debounceMs: 150,                                  // الافتراضي
    debounceByTable: { evaluation_templates: 250 },   // القالب يأتي على دفعات → نافذة أوسع
    selfWriteMs: 600,           // نافذة تجاهل وميض إعادة الرسم بعد كتابة محلية

    channels: [],
    ENABLED: true,        // ★ #58: حارس تعطيل سريع (rollback فوري: RealtimeService.ENABLED=false ثم reload)
    _lastCatchup: 0,      // ★ #58: cooldown على catch-up بعد إعادة الاتصال (يمنع عاصفة أثناء التذبذب)
    _pendingTables: null, // ★ #58: الجداول المتغيّرة المُنتظِرة للسحب المُدمج
    started: false,
    status: 'connecting',       // connecting | connected | disconnected
    _timer: null,
    _lastLocalWrite: 0,

    // قياس الأداء (للنقطة ٧)
    stats: { events: 0, bytes: 0, peakPerSec: 0, _windowStart: 0, _windowCount: 0 },

    start() {
      // ★ #58: استُعيد Realtime بذكاء (pullTable + قناة مدموجة + cooldown). تعطيل فوري: ENABLED=false ثم reload.
      if (!this.ENABLED) { console.info('RealtimeService معطّل (ENABLED=false)'); return; }
      if (this.started) return;
      // ننتظر جاهزية sb + طبقة المزامنة
      if (!window.sb || !window.SupabaseSync || !window.SupabaseSync.pullAll) {
        setTimeout(() => this.start(), 300);
        return;
      }
      this.started = true;
      this._ensureIndicator();
      this._subscribeAll();
      console.log('📡 RealtimeService بدأ — جداول:', this.TABLES.join(', '));
    },

    _subscribeAll() {
      // ★ #58: قناة واحدة مدموجة (WebSocket واحد) بعدّة listeners بدل 9 قنوات — تقليل ضغط اتصالات Realtime.
      let ch = window.sb.channel('rt-all');
      this.TABLES.forEach(table => {
        ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: table },
          (payload) => this._onEvent(table, payload));
      });
      ch.subscribe((status) => this._onStatus(status));
      this.channels = [ch];
    },

    _onEvent(table, payload) {
      // قياس
      this.stats.events++;
      try { this.stats.bytes += JSON.stringify(payload).length; } catch (_) {}
      const now = Date.now();
      if (now - this.stats._windowStart >= 1000) { this.stats._windowStart = now; this.stats._windowCount = 0; }
      this.stats._windowCount++;
      if (this.stats._windowCount > this.stats.peakPerSec) this.stats.peakPerSec = this.stats._windowCount;

      console.log('🔔 RT', table, payload.eventType, '(events=' + this.stats.events + ')');
      this._scheduleRefresh(table);
    },

    // إعادة سحب مُدمجة ثم إعادة رسم الصفحة الحالية فقط (نافذة الدمج حسب الجدول)
    _scheduleRefresh(table) {
      const delay = (table && this.debounceByTable[table]) || this.debounceMs;
      if (table) { this._pendingTables = this._pendingTables || new Set(); this._pendingTables.add(table); }
      clearTimeout(this._timer);
      this._timer = setTimeout(async () => {
        // ★ #58: سحب الجداول المتغيّرة فقط (pullTable) بدل pullAll الكامل — كسر عاصفة الحِمل.
        const MANAGED = (window.SupabaseSync && SupabaseSync.TABLES) || [];
        const pend = Array.from(this._pendingTables || []); this._pendingTables = new Set();
        try {
          for (const t of pend) { if (MANAGED.indexOf(t) >= 0) { try { await window.SupabaseSync.pullTable(t); } catch (_) {} } }
          // جداول غير مُدارة (CG/objection_comments) → لا سحب؛ صفحات CG تجلب بياناتها عند الطلب، وإعادة الرسم أدناه تكفي.
        } catch (_) {}
        try {
          if (typeof navigate === 'function' && typeof currentPage !== 'undefined'
              && currentPage && currentPage !== 'login') {
            navigate(currentPage, (typeof currentParams !== 'undefined' ? currentParams : {}));
          }
        } catch (_) {}
      }, delay);
    },

    _onStatus(status) {
      // SUBSCRIBED | CLOSED | CHANNEL_ERROR | TIMED_OUT  (قناة واحدة مدموجة)
      if (status === 'SUBSCRIBED') {
        const reconnected = (this.status === 'disconnected');
        this.status = 'connected';
        this._renderIndicator();
        // ★ #58: catch-up كامل بعد انقطاع، مع cooldown 10s يمنع عاصفة أثناء التذبذب.
        //   (supabase-js يتكفّل بإعادة اتصال السوكِت بـbackoff داخلي؛ هنا نحدّ من كلفة الـcatch-up فقط.)
        if (reconnected) {
          const now = Date.now();
          if (now - (this._lastCatchup || 0) > 10000) {
            this._lastCatchup = now;
            console.log('🔁 إعادة اتصال Realtime — pullAll catch-up');
            clearTimeout(this._timer);
            this._timer = setTimeout(async () => {
              try { await window.SupabaseSync.pullAll(true); } catch (_) {}
              try { if (typeof navigate === 'function' && typeof currentPage !== 'undefined' && currentPage && currentPage !== 'login') navigate(currentPage, (typeof currentParams !== 'undefined' ? currentParams : {})); } catch (_) {}
            }, this.debounceMs);
          } else { console.log('⏳ تخطّي catch-up (cooldown 10s) — تذبذب اتصال'); }
        }
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        this.status = 'disconnected';
        this._renderIndicator();
      }
    },

    // يُستدعى اختيارياً بعد كتابة محلية لتقليل الوميض (لا يمنع المزامنة)
    notifyLocalWrite() { this._lastLocalWrite = Date.now(); },

    // ---- مؤشّر الاتصال ----
    _ensureIndicator() {
      if (document.getElementById('rt-indicator')) return;
      const el = document.createElement('div');
      el.id = 'rt-indicator';
      el.style.cssText = [
        'position:fixed', 'bottom:12px', 'left:12px', 'z-index:9999',
        'display:flex', 'align-items:center', 'gap:6px',
        'padding:6px 10px', 'border-radius:20px', 'font-size:12px',
        'font-family:inherit', 'font-weight:600', 'box-shadow:0 2px 8px rgba(0,0,0,.15)',
        'background:#fff', 'color:#333', 'transition:opacity .3s', 'cursor:default', 'user-select:none'
      ].join(';');
      el.innerHTML = '<span id="rt-dot" style="width:9px;height:9px;border-radius:50%;background:#f0ad4e;display:inline-block"></span><span id="rt-text">جارٍ الاتصال…</span>';
      document.body.appendChild(el);
      this._renderIndicator();
    },

    _renderIndicator() {
      const dot = document.getElementById('rt-dot');
      const txt = document.getElementById('rt-text');
      if (!dot || !txt) return;
      if (this.status === 'connected') {
        dot.style.background = '#2ecc71'; txt.textContent = 'متصل لحظياً';
      } else if (this.status === 'disconnected') {
        dot.style.background = '#e74c3c'; txt.textContent = 'غير متصل — إعادة المحاولة…';
      } else {
        dot.style.background = '#f0ad4e'; txt.textContent = 'جارٍ الاتصال…';
      }
    },

    // ملخّص قياس الأداء (النقطة ٧)
    report() {
      const avg = this.stats.events ? Math.round(this.stats.bytes / this.stats.events) : 0;
      const r = { events: this.stats.events, avgPayloadBytes: avg, peakEventsPerSec: this.stats.peakPerSec, tables: this.TABLES.slice() };
      console.table(r);
      return r;
    }
  };

  window.RealtimeService = RealtimeService;

  // بدء ذاتي احتياطي (idempotent) — يكفي أيضاً لو لم يستدعِه تسلسل التهيئة
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => RealtimeService.start());
  } else {
    RealtimeService.start();
  }
})();
