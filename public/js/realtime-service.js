/*!
 * نظام الجودة — شركة محزم
 * RealtimeService: إدارة مركزية لاشتراكات Supabase Realtime (postgres_changes).
 *
 * النهج: عند أي حدث (INSERT/UPDATE/DELETE) على جدول مبثوث → إعادة سحب مُدمجة
 * (debounce) عبر SupabaseSync.pullAll(true) ثم إعادة رسم الصفحة الحالية فقط.
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
    TABLES: ['evaluations', 'evaluation_templates', 'creative_gene_weekly_status', 'users', 'objections', 'objection_comments', 'notifications'],
    debounceMs: 150,                                  // الافتراضي
    debounceByTable: { evaluation_templates: 250 },   // القالب يأتي على دفعات → نافذة أوسع
    selfWriteMs: 600,           // نافذة تجاهل وميض إعادة الرسم بعد كتابة محلية

    channels: [],
    started: false,
    status: 'connecting',       // connecting | connected | disconnected
    _timer: null,
    _lastLocalWrite: 0,

    // قياس الأداء (للنقطة ٧)
    stats: { events: 0, bytes: 0, peakPerSec: 0, _windowStart: 0, _windowCount: 0 },

    start() {
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
      this.TABLES.forEach(table => {
        const ch = window.sb
          .channel('rt-' + table)
          .on('postgres_changes', { event: '*', schema: 'public', table: table },
            (payload) => this._onEvent(table, payload))
          .subscribe((status) => this._onStatus(table, status));
        this.channels.push(ch);
      });
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
      clearTimeout(this._timer);
      this._timer = setTimeout(async () => {
        try { await window.SupabaseSync.pullAll(true); } catch (_) {}
        try {
          if (typeof navigate === 'function' && typeof currentPage !== 'undefined'
              && currentPage && currentPage !== 'login') {
            navigate(currentPage, (typeof currentParams !== 'undefined' ? currentParams : {}));
          }
        } catch (_) {}
      }, delay);
    },

    _onStatus(table, status) {
      // SUBSCRIBED | CLOSED | CHANNEL_ERROR | TIMED_OUT
      if (status === 'SUBSCRIBED') {
        const reconnected = (this.status === 'disconnected');
        this.status = 'connected';
        this._renderIndicator();
        // عند إعادة الاتصال: snapshot كامل يدمج ما فات أثناء الانقطاع
        if (reconnected) { console.log('🔁 إعادة اتصال Realtime — جلب snapshot'); this._scheduleRefresh(); }
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
