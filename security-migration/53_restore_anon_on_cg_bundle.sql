-- ============================================================================
-- Migration 53 — RESTORE anon EXECUTE on get_cg_week_bundle (إلغاء Hotfix 52)
--
-- السبب: Hotfix 52 بُني على مقدّمة خاطئة. النظام يستخدم anon key + verify_session
--   المخصّص (لا GoTrue Auth) → كل استدعاءات PostgREST تعمل بدور anon.
--   REVOKE EXECUTE FROM anon جعل get_cg_week_bundle غير قابل للاستدعاء من العميل →
--   loadCgWeekTable سقط بصمت للمسار القديم (3 fetches) → تعطّلت تحسينة PR #67-C.
--
-- الأمان محفوظ داخل الدالة: verify_session + role IN (admin, quality_officer)
--   (نفس نمط get_creative_gene_status القابلة لتنفيذ anon والعاملة اليوم).
--
-- تطبيق: شغّل الملف في Supabase SQL Editor ثم استعلام التحقّق أسفله.
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.get_cg_week_bundle(text, date) TO anon;

-- ============================================================================
-- تحقّق بعد التطبيق (إلزامي):
-- ============================================================================
-- SELECT proname, has_function_privilege('anon', oid, 'EXECUTE') AS anon_exec
-- FROM pg_proc WHERE proname = 'get_cg_week_bundle';
-- -- متوقّع: anon_exec=true (يعود get_cg_week_bundle للعمل الصحيح عبر عميل anon)
--
-- تحقّق قبولي (العميل): افتح cg-week → Network → يجب أن تظهر get_cg_week_bundle
--   (استدعاء واحد) بدل get_creative_gene_status + objections + actions.
-- ============================================================================
