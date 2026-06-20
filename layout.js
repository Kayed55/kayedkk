/**
 * Main Layout - Sidebar + Topbar
 */

window.UI = window.UI || {};

window.UI.renderLayout = function(content, currentPage, unread = 0) {
  const u = window.currentUser;
  const menu = [
    { key: 'dashboard',       icon: '📊', label: 'لوحة التحكم',     roles: ['admin','quality_officer','supervisor','employee'] },
    { key: 'evaluations',     icon: '📝', label: 'التقييمات',        roles: ['admin','quality_officer','supervisor','employee'] },
    { key: 'new-evaluation',  icon: '➕', label: 'تقييم جديد',       roles: ['admin','quality_officer'] },
    { key: 'employees',       icon: '👥', label: 'الموظفون',          roles: ['admin','quality_officer','supervisor'] },
    { key: 'objections',      icon: '⚖️', label: 'الاعتراضات',        roles: ['admin','quality_officer','supervisor','employee'] },
    { key: 'reports',         icon: '📈', label: 'التقارير',          roles: ['admin','quality_officer','supervisor'] },
    { key: 'monthly-report',  icon: '📅', label: 'التقرير الشهري',    roles: ['admin','quality_officer','supervisor'] },
    { key: 'audit-log',       icon: '📜', label: 'سجل العمليات',     roles: ['admin','quality_officer'] },
    { key: 'users',           icon: '🛡️', label: 'إدارة المستخدمين',  roles: ['admin','quality_officer'] },
    { key: 'profile',         icon: '👤', label: 'الملف الشخصي',     roles: ['admin','quality_officer','supervisor','employee'] }
  ];

  const menuHTML = menu.filter(m => m.roles.includes(u.role)).map(m => `
    <div class="menu-item ${currentPage === m.key ? 'active' : ''}" data-nav="${m.key}">
      <span>${m.icon}</span><span>${m.label}</span>
    </div>`).join('');

  const titles = {
    dashboard:'لوحة التحكم', employees:'إدارة الموظفين',
    'view-employee':'بيانات الموظف', evaluations:'التقييمات',
    'new-evaluation':'تقييم جديد', 'view-evaluation':'تفاصيل التقييم',
    'edit-evaluation':'تعديل التقييم', reports:'التقارير',
    'monthly-report':'التقرير الشهري', objections:'الاعتراضات',
    'view-objection':'تفاصيل الاعتراض', 'new-objection':'تقديم اعتراض',
    'audit-log':'سجل العمليات', users:'إدارة المستخدمين',
    profile:'الملف الشخصي', notifications:'الإشعارات', settings:'الإعدادات'
  };

  return `
<div class="layout">
  <aside class="sidebar">
    <div class="sidebar-header">
      <div class="sidebar-logo">${window.MAHZAM_LOGO_LIGHT_SVG}</div>
      <div class="sidebar-title">${window.SYSTEM_NAME}</div>
      <div class="sidebar-subtitle">${window.COMPANY_NAME}</div>
    </div>
    <nav class="sidebar-menu">${menuHTML}</nav>
    <div style="padding:16px 12px;border-top:1px solid rgba(255,255,255,0.1)">
      <div class="menu-item" id="logout-btn"><span>🚪</span><span>تسجيل الخروج</span></div>
    </div>
  </aside>
  <div class="main-content">
    <header class="topbar">
      <div style="display:flex;align-items:center;gap:14px">
        <div style="width:42px;height:42px;background:linear-gradient(135deg,#06579F,#202E4D);border-radius:10px;padding:5px;display:flex;align-items:center;justify-content:center">${window.MAHZAM_LOGO_LIGHT_SVG}</div>
        <div>
          <div class="topbar-title">${titles[currentPage] || ''}</div>
          <div style="font-size:11px;color:var(--muted);font-weight:600">${window.SYSTEM_NAME} • ${window.COMPANY_NAME}</div>
        </div>
      </div>
      <div class="topbar-actions">
        <div style="position:relative;cursor:pointer;font-size:22px" data-nav="notifications">
          🔔${unread > 0 ? `<span style="position:absolute;top:-4px;left:-4px;background:var(--danger);color:#fff;border-radius:50%;min-width:18px;height:18px;font-size:11px;display:flex;align-items:center;justify-content:center;padding:0 4px;font-weight:700">${unread}</span>` : ''}
        </div>
        <div class="user-info">
          <div class="user-avatar">${Utils.getInitials(u.full_name)}</div>
          <div>
            <div style="font-weight:700;font-size:13px">${Utils.escape(u.full_name)}</div>
            <div style="font-size:11px;color:var(--muted)">${Utils.roleLabel(u.role)}</div>
          </div>
        </div>
      </div>
    </header>
    <div class="content" id="page-content">${content}</div>
  </div>
</div>`;
};

window.UI.attachLayoutHandlers = function() {
  document.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', () => window.App.navigate(el.dataset.nav));
  });
  const logout = document.getElementById('logout-btn');
  if (logout) logout.addEventListener('click', () => {
    Auth.logout();
    window.App.navigate('login');
  });
};
