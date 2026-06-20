/**
 * Settings Page (admin only)
 */

window.UI = window.UI || {};

window.UI.renderSettings = async function() {
  if (!Perms.can('manage_settings')) return '<div class="alert alert-danger">غير مصرح</div>';
  return `
<div class="page-header">
<div><div class="page-title">⚙️ الإعدادات</div></div>
</div>
<div class="card">
<div class="card-header"><div class="card-title">معلومات النظام</div></div>
<div class="card-body">
<div><strong>اسم النظام:</strong> ${window.SYSTEM_NAME}</div>
<div style="margin-top:8px"><strong>الشركة:</strong> ${window.COMPANY_NAME}</div>
<div style="margin-top:8px"><strong>الإصدار:</strong> ${window.AppConfig.APP_VERSION}</div>
<div style="margin-top:8px"><strong>قاعدة البيانات:</strong> Supabase</div>
</div>
</div>
<div class="card">
<div class="card-header"><div class="card-title">📋 معايير التقييم</div></div>
<div class="card-body">
<p>معايير التقييم محفوظة في جدول <code>criteria_config</code> في Supabase.</p>
<p>للتعديل، يمكنك تشغيل SQL مباشرة في Supabase Dashboard.</p>
</div>
</div>`;
};
