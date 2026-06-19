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
  SUPABASE_URL: 'https://YOUR_PROJECT_ID.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR_ANON_PUBLIC_KEY_HERE',

  // إعدادات التطبيق
  APP_NAME: 'نظام الجودة للتقييم والتدريب',
  COMPANY_NAME: 'شركة محزم',
  APP_VERSION: '1.0.0',

  // مفتاح localStorage لتذكر تسجيل الدخول
  AUTH_STORAGE_KEY: 'mqs_current_user'
};
