-- ============================================================================
-- Hotfix #67-C — REVOKE EXECUTE from anon on get_cg_week_bundle
-- المشكلة: بعد migration 51، أظهر التحقّق anon_exec=true.
--   Supabase/Postgres يمنح EXECUTE افتراضياً (PUBLIC/anon) عند إنشاء الدالة؛
--   REVOKE FROM PUBLIC وحده لم يكفِ لأن anon دور صريح في هذا المشروع.
-- الأمان: verify_session داخل الدالة يفرض المصادقة أصلاً (الدفاع الأول قائم)؛
--   هذا الإصلاح يضيف REVOKE صريحاً لـanon (دفاع في العمق).
-- تطبيق: شغّل الملف كاملاً في Supabase SQL Editor ثم استعلام التحقّق أسفله.
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public.get_cg_week_bundle(text, date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_cg_week_bundle(text, date) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_cg_week_bundle(text, date) TO authenticated;

-- ============================================================================
-- تحقّق بعد التطبيق (إلزامي):
-- ============================================================================
-- SELECT proname,
--        has_function_privilege('authenticated', oid, 'EXECUTE') AS auth_exec,
--        has_function_privilege('anon', oid, 'EXECUTE')          AS anon_exec
-- FROM pg_proc WHERE proname = 'get_cg_week_bundle';
-- -- متوقّع: auth_exec=true · anon_exec=false
--
-- Rollback: لا يلزم (تشديد أمني فقط). لو احتيج: GRANT EXECUTE ... TO anon; (غير مُوصى).
