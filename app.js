/**
 * Main Application Entry Point
 * نقطة الدخول الرئيسية - التوجيه (Routing) + التحكم
 */

window.App = {
  currentPage: 'login',
  currentParams: {},

  async navigate(page, params = {}) {
    this.currentPage = page;
    this.currentParams = params;
    const app = document.getElementById('app');

    // Login - بدون layout
    if (page === 'login') {
      app.innerHTML = window.UI.renderLogin();
      window.UI.attachLoginHandlers();
      return;
    }

    // التحقق من تسجيل الدخول
    if (!window.currentUser) {
      this.navigate('login');
      return;
    }

    // تحميل الإشعارات غير المقروءة
    let unread = 0;
    try {
      unread = await DB.notifications.unreadCount(window.currentUser.id);
    } catch(e) {}

    // عرض مؤشر التحميل أثناء تحميل الصفحة
    app.innerHTML = window.UI.renderLayout(
      '<div style="text-align:center;padding:40px"><div class="boot-spinner" style="margin:0 auto"></div><div style="margin-top:14px;color:var(--muted)">جاري التحميل...</div></div>',
      page,
      unread
    );
    window.UI.attachLayoutHandlers();

    // عرض الصفحة المطلوبة
    let content = '';
    try {
      content = await this._renderPage(page, params);
    } catch(err) {
      console.error('Render error:', err);
      content = `<div class="alert alert-danger">خطأ في تحميل الصفحة: ${err.message}</div>`;
    }

    const pageContent = document.getElementById('page-content');
    if (pageContent) pageContent.innerHTML = content;
    await this._attachPageHandlers(page, params);
  },

  async _renderPage(page, params) {
    switch (page) {
      case 'dashboard':       return await window.UI.renderDashboard();
      case 'employees':       return await window.UI.renderEmployees();
      case 'view-employee':   return await window.UI.renderViewEmployee(params.id);
      case 'evaluations':     return await window.UI.renderEvaluations();
      case 'new-evaluation':  return await window.UI.renderNewEvaluation();
      case 'view-evaluation': return await window.UI.renderViewEvaluation(params.id);
      case 'reports':         return await window.UI.renderReports();
      case 'monthly-report':  return await window.UI.renderMonthlyReport();
      case 'objections':      return await window.UI.renderObjections();
      case 'view-objection':  return await window.UI.renderViewObjection(params.id);
      case 'audit-log':       return await window.UI.renderAuditLog();
      case 'users':           return await window.UI.renderUsersAdmin();
      case 'profile':         return await window.UI.renderProfile();
      case 'settings':        return await window.UI.renderSettings();
      default:                return await window.UI.renderDashboard();
    }
  },

  async _attachPageHandlers(page, params) {
    switch (page) {
      case 'dashboard':       window.UI.attachDashboardHandlers(); break;
      case 'employees':       window.UI.attachEmployeesHandlers(); break;
      case 'evaluations':     window.UI.attachEvaluationsHandlers(); break;
      case 'new-evaluation':  await window.UI.attachNewEvalHandlers(); break;
      case 'view-evaluation': window.UI.attachViewEvaluationHandlers(params.id); break;
      case 'reports':         window.UI.attachReportsHandlers(); break;
      case 'monthly-report':  window.UI.attachMonthlyReportHandlers(); break;
      case 'objections':      window.UI.attachObjectionsHandlers(); break;
      case 'users':           window.UI.attachUsersHandlers(); break;
      case 'profile':         window.UI.attachProfileHandlers(); break;
    }
  },

  async start() {
    // التحقق من جلسة محفوظة
    const restored = Auth.restore();
    if (restored) {
      try {
        // التحقق أن المستخدم لا يزال موجوداً ونشطاً
        const fresh = await DB.users.getById(restored.id);
        if (fresh && fresh.is_active) {
          window.currentUser = restored;
          await this.navigate('dashboard');
          return;
        }
      } catch(e) {
        console.warn('Session check failed:', e);
      }
      Auth.logout();
    }
    this.navigate('login');
  }
};

// تشغيل التطبيق عند تحميل الصفحة
window.addEventListener('DOMContentLoaded', () => {
  // انتظار قصير للتأكد من تحميل Supabase SDK
  setTimeout(() => {
    if (!window.supabaseClient) {
      document.getElementById('app').innerHTML = `
<div style="padding:40px;text-align:center;max-width:600px;margin:80px auto;font-family:Cairo,sans-serif">
<h1 style="color:#dc2626">⚠️ خطأ في التهيئة</h1>
<p>تعذّر الاتصال بقاعدة البيانات.</p>
<p>تأكد من تحديث ملف <code>js/config.js</code> بمفاتيح Supabase الصحيحة.</p>
<p style="margin-top:20px;color:#64748b">راجع <code>README.md</code> للتعليمات.</p>
</div>`;
      return;
    }
    window.App.start().catch(err => {
      console.error('App startup failed:', err);
      document.getElementById('app').innerHTML = `
<div style="padding:40px;text-align:center;max-width:600px;margin:80px auto;font-family:Cairo,sans-serif">
<h1 style="color:#dc2626">⚠️ خطأ</h1>
<p>${err.message}</p>
</div>`;
    });
  }, 200);
});
