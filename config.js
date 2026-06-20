/**
 * Supabase Configuration
 * نظام الجودة للتقييم والتدريب - شركة محزم
 *
 * هذا الملف يحتوي على مفاتيح Supabase العامة (الـ anon key).
 * هذه المفاتيح آمنة للاستخدام في الواجهة الأمامية، لأنها مقيّدة عبر Row-Level Security policies.
 *
 * لتعديل القيم:
 * 1. افتح Supabase Dashboard
 * 2. Settings → API
 * 3. انسخ Project URL و anon public key
 *
 * في Vercel: أضف هذه القيم كـ Environment Variables ثم استخدمها هنا.
 * أو ضع القيم مباشرة (آمنة - anon key ليست سرية).
 */

window.AppConfig = {
  // ⚠️ استبدل القيم التالية بمفاتيح مشروعك من Supabase
  SUPABASE_URL: 'https://hobhajqtgcyctfmcxkel.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhvYmhhanF0Z2N5Y3RmbWN4a2VsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4ODkzMDIsImV4cCI6MjA5NzQ2NTMwMn0.mTWqRmUyxShOSbwpnlHcmRU3FZ_KQ8OSLyG6sQzgmBY',

  // إعدادات التطبيق
  APP_NAME: 'نظام الجودة للتقييم والتدريب',
  COMPANY_NAME: 'شركة محزم',
  APP_VERSION: '1.0.0',

  // مفتاح localStorage لتذكر تسجيل الدخول
  AUTH_STORAGE_KEY: 'mqs_current_user'
};
